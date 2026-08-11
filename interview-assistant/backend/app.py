"""FastAPI 应用：同时服务 Web 前端（REST）和桌面端（WebSocket 实时音频）。

REST（Web 端用）：
    GET  /api/health
    GET  /api/config                 -> {mock_mode}
    GET  /api/assets                 -> 当前素材库
    POST /api/resume/text            -> {text} 解析简历文本
    POST /api/resume/file            -> multipart 文件解析
    DELETE /api/assets               -> 清空素材库
    GET  /api/reviews                -> 复盘会话列表
    GET  /api/reviews/{sid}          -> 单场复盘详情（含问题/提纲）
    DELETE /api/reviews/{sid}        -> 删除复盘会话
    POST /api/reviews/{sid}/to-bank  -> {item_id} 把复盘问题回填专属题库
    GET  /api/projects?role=         -> 项目市场（未购买只返回标题/简介）
    POST /api/projects               -> 上传项目（进入待审核）
    GET  /api/projects/purchased     -> 我购买的项目
    GET  /api/projects/mine          -> 我上传的项目（含销量/收益）
    GET  /api/projects/income        -> 我的收益汇总
    GET  /api/projects/{pid}         -> 项目详情（按是否购买脱敏）
    POST /api/projects/{pid}/purchase-> 模拟购买并解锁
    POST /api/projects/{pid}/review  -> {action:approve|reject} 演示审核
    POST /api/projects/{pid}/to-assets-> 已购项目加入素材库
    POST /api/mock-interview/next    -> {history:[{question,answer}]} 取下一题

WebSocket（桌面端用）：
    /ws/session?mode=realtime        -> 实时辅助：识别问题并生成回答提纲
    /ws/session?mode=mock            -> 模拟面试：只转写候选人回答，不生成提纲
"""

import json
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import lru_cache

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from answer_generator import generate_outline
from config import settings
from interview_questions import next_question
from llm_utils import (
    LLMNotConfiguredError,
    LLMServiceError,
    get_llm_model,
    openai_client,
    require_llm_config,
    set_llm_user,
)
from llm_config_store import public_config_view, save_user_llm_config, resolve_active_credentials
from material_store import MaterialStore
from mock_interview_store import MockInterviewStore
from project_store import ProjectStore
from question_bank import (
    BANK_CUSTOM,
    BANK_GENERAL,
    BANK_PERSONAL,
    QuestionBankStore,
    generate as generate_personal_questions,
    generate_custom,
    generate_general,
)
from question_detector import guess_question_type, is_question
from resume_parser import (
    annotate_resume,
    clean_resume_text,
    extract_deterministic_resume,
    extract_structured_resume,
    extract_text,
    parse_resume,
    score_resume_content,
    structured_resume_plain_text,
)
from resume_parser_skill import parse_resume_with_skill
from resume_schema import normalize_structured
from review import ReviewStore
from saas_auth import AuthService, AuthUser, DEMO_USER_ID
from stt import create_stt_session

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    provider = (settings.stt_provider or "").strip().lower()
    if provider == "funasr":
        async def _preload_funasr() -> None:
            try:
                from stt.funasr import preload_models

                await preload_models(asyncio.get_running_loop())
                print("  FunASR: 模型已预加载")
            except Exception as exc:
                print(f"  FunASR: 预加载失败（首次语音时会重试）— {exc}")

        asyncio.create_task(_preload_funasr())
    yield


app = FastAPI(title="AI 面试助手后端", lifespan=lifespan)

# 开发期放开跨域，方便 Vite(5173) 和 Electron(file://) 访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    logger.exception("Unhandled error on %s", request.url.path)
    if request.url.path.startswith("/api/resume/"):
        return JSONResponse(
            status_code=200,
            content={"error": f"服务器错误：{exc}", "assets": []},
        )
    return JSONResponse(status_code=500, content={"detail": f"服务器错误：{exc}"})

# SaaS 过渡架构：
# - AuthService 用 SQLite 管理用户/Token；
# - 素材、题库、复盘按 user_id 分区，Demo 用户继续复用旧 JSON 文件；
# - 项目市场保持全局，但购买/上传按 user_id 隔离。
auth = AuthService()
projects = ProjectStore()


@lru_cache(maxsize=512)
def _material_store(user_id: str) -> MaterialStore:
    return MaterialStore(user_id)


def _clear_material_store_cache(user_id: str) -> None:
    _material_store.cache_clear()
    _material_store(user_id)


@lru_cache(maxsize=512)
def _question_bank(user_id: str) -> QuestionBankStore:
    return QuestionBankStore(user_id)


@lru_cache(maxsize=512)
def _review_store(user_id: str) -> ReviewStore:
    return ReviewStore(user_id)


@lru_cache(maxsize=512)
def _mock_interviews(user_id: str) -> MockInterviewStore:
    return MockInterviewStore(user_id)


def _bearer_token(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header.split(" ", 1)[1].strip()
    return request.headers.get("x-demo-token", "")


def current_user(request: Request) -> AuthUser:
    user = auth.user_from_token(_bearer_token(request))
    if user:
        set_llm_user(user.user_id)
        return user
    if not settings.require_auth:
        demo = auth.get_user(DEMO_USER_ID)
        if demo:
            set_llm_user(demo.user_id)
            return demo
    raise HTTPException(status_code=401, detail="请先登录")


def current_admin(user: AuthUser = Depends(current_user)) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


# ----------------------------- REST -----------------------------
class RegisterBody(BaseModel):
    username: str
    email: str
    password: str


class LoginBody(BaseModel):
    username_or_email: str
    password: str


class ResumeText(BaseModel):
    text: str


class MockHistory(BaseModel):
    history: list[dict] = []


class CreateMockInterview(BaseModel):
    role: str = "后端工程师"
    jd_text: str = ""
    company_name: str = ""
    language: str = "zh"
    scope: str = "full"
    source_bank: str = BANK_PERSONAL
    question_limit: int = 0


class SubmitMockAnswer(BaseModel):
    answer_text: str


class UpdateQuestion(BaseModel):
    question: str | None = None
    answer: str | None = None


class CustomBankBody(BaseModel):
    jd_text: str


class SessionSysBody(BaseModel):
    role: str = ""
    years: str = "1-3"
    limit: int = 12


class SessionFromAssetsBody(BaseModel):
    role: str = ""
    years: str = "1-3"
    resume_text: str = ""
    materials: list[dict] = []


class SessionFromJdBody(BaseModel):
    role: str = ""
    years: str = "1-3"
    jd_text: str = ""


class AddToBank(BaseModel):
    item_id: str


class AddQuestionBody(BaseModel):
    question: str
    answer: str = ""


class CreateProject(BaseModel):
    title: str
    target_roles: list[str] = []
    difficulty: str = "进阶"
    project_type: str = ""
    tags: list[str] = []
    preview_summary: str = ""
    full_content: str = ""
    price: float = 0.0
    originality: str = ""


class ReviewAction(BaseModel):
    action: str  # approve | reject


class MianJingGenerateBody(BaseModel):
    structured: dict = {}
    target_role: str


# ---- 面经备考包 ----
from mianjing_generator import generate as generate_mianjing, generate_mock

_mianjing_store: dict[str, dict] = {}


@app.post("/api/mianjing/generate")
def generate_mianjing_package(body: MianJingGenerateBody, user: AuthUser = Depends(current_user)):
    """生成面经备考包（LLM 同步返回，雷达后台补数据）"""
    structured = body.structured or {}
    target_role = body.target_role.strip()
    if not target_role:
        raise HTTPException(status_code=400, detail="目标岗位不能为空")

    try:
        data = generate_mianjing({"structured": structured}, target_role)
    except Exception as e:
        logger.exception("MianJing generation failed")
        data = generate_mock(target_role)

    pkg_id = "mj_" + str(int(datetime.now(timezone.utc).timestamp() * 1000))
    pkg = {
        "id": pkg_id,
        "target_role": target_role,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "user_id": user.user_id,
        "data": data,
    }
    _mianjing_store[pkg_id] = pkg

    # 后台线程：采集真实面经，完成后更新 store
    import threading
    def _enrich():
        try:
            from mianjing_generator import enrich_with_radar
            enriched = enrich_with_radar(data, target_role, structured)
            _mianjing_store[pkg_id]["data"] = enriched
            logger.info("MianJing %s enriched with radar data", pkg_id)
        except Exception as e:
            logger.exception("Background radar enrichment failed for %s", pkg_id)

    threading.Thread(target=_enrich, daemon=True).start()

    return pkg


@app.get("/api/mianjing")
def list_mianjing(user: AuthUser = Depends(current_user)):
    """列出当前用户的所有面经"""
    items = [
        {"id": v["id"], "target_role": v["target_role"], "created_at": v["created_at"]}
        for v in _mianjing_store.values()
        if v.get("user_id") == user.user_id
    ]
    return {"packages": sorted(items, key=lambda x: x["created_at"], reverse=True)}


@app.get("/api/mianjing/{mid}")
def get_mianjing(mid: str, user: AuthUser = Depends(current_user)):
    pkg = _mianjing_store.get(mid)
    if not pkg or pkg.get("user_id") != user.user_id:
        raise HTTPException(status_code=404, detail="面经不存在")
    return pkg


@app.delete("/api/mianjing/{mid}")
def delete_mianjing(mid: str, user: AuthUser = Depends(current_user)):
    pkg = _mianjing_store.get(mid)
    if not pkg or pkg.get("user_id") != user.user_id:
        raise HTTPException(status_code=404, detail="面经不存在")
    del _mianjing_store[mid]
    return {"ok": True}


@app.post("/api/debug/radar-test")
def debug_radar_test(user: AuthUser = Depends(current_user)):
    """调试端点：同步执行雷达管道，返回采集结果和错误。"""
    import traceback
    try:
        from mianjing_radar.pipeline import crawl_real_questions
        result = crawl_real_questions("数据分析师", limit=10)
        questions = [{"text": q.text, "source_label": q.source_label, "source_url": q.source_url} for q in result.get("questions", [])]
        return {
            "ok": True,
            "questions_count": len(questions),
            "questions": questions[:5],
            "sources": result.get("sources", []),
            "summary": result.get("summary", []),
            "gaps": result.get("gaps", []),
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


@app.post("/api/auth/register")
def register(body: RegisterBody):
    result = auth.register(body.username, body.email, body.password)
    if not result.get("ok"):
        return result
    return result


@app.post("/api/auth/login")
def login(body: LoginBody):
    return auth.login(body.username_or_email, body.password)


@app.get("/api/auth/me")
def me(user: AuthUser = Depends(current_user)):
    return {"user": user.to_dict(), "require_auth": settings.require_auth}


class LlmConfigBody(BaseModel):
    active_provider: str = ""
    providers: dict = {}


class ProjectPackAnalyzeBody(BaseModel):
    pack_name: str = ""
    resume_project: dict | None = None
    materials: list[dict] = []


class JdMatchAnalyzeBody(BaseModel):
    resume_text: str = ""
    jd_text: str = ""
    structured: dict | None = None


class JdMatchReconstructBody(BaseModel):
    resume_text: str = ""
    analysis: dict = {}
    structured: dict | None = None
    context: dict | None = None


class JdMatchApplyOptimizeBody(BaseModel):
    resume_text: str = ""
    optimization_plan: dict = {}
    confirmations: dict[str, str] | None = None


class JdMatchFetchJdBody(BaseModel):
    url: str = ""


class JdMatchMaterialsBody(BaseModel):
    resume_text: str = ""
    analysis: dict = {}


class JdMatchExportBody(BaseModel):
    analysis: dict = {}
    reconstruct: dict | None = None
    materials: dict | None = None
    resume_name: str = ""
    format: str = "markdown"  # markdown | json | both


class MaterialCardPatchBody(BaseModel):
    title: str | None = None
    summary: str | None = None
    card_type: str | None = None
    bullets: list[str] | None = None
    tags: list[str] | None = None
    evidence_quote: str | None = None
    status: str | None = None
    confidence: float | None = None


class MaterialArchiveBody(BaseModel):
    force: bool = False


class ResumeProjectsSyncBody(BaseModel):
    projects: list[dict] = []
    source_resume_id: str = ""
    replace: bool = True


class ProjectBindBody(BaseModel):
    card_ids: list[str] = []
    replace: bool = False


@app.get("/api/me/llm-config")
def get_llm_config(user: AuthUser = Depends(current_user)):
    return public_config_view(user.user_id)


@app.put("/api/me/llm-config")
def put_llm_config(body: LlmConfigBody, user: AuthUser = Depends(current_user)):
    save_user_llm_config(
        user.user_id,
        {
            "active_provider": body.active_provider,
            "providers": body.providers or {},
        },
    )
    return public_config_view(user.user_id)


@app.post("/api/me/llm-config/test")
def test_llm_config(user: AuthUser = Depends(current_user)):
    """用当前激活服务商发一条极简请求，验证连通性。"""
    set_llm_user(user.user_id)
    try:
        require_llm_config()
        client = openai_client()
        model = get_llm_model()
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=8,
            temperature=0,
        )
        text = (resp.choices[0].message.content or "").strip()
        return {"ok": True, "model": model, "reply": text[:80]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/config")
def get_config(user: AuthUser = Depends(current_user)):
    cred = resolve_active_credentials(user.user_id)
    user_ok = bool(cred and cred.get("api_key"))
    return {
        "mock_mode": False,
        "llm_configured": user_ok,
        "llm_model": (cred or {}).get("model_id") or "",
        "llm_source": "user" if user_ok else "none",
        "stt_provider": settings.stt_provider,
        "require_auth": settings.require_auth,
        "mock_interview_voice_enabled": settings.mock_interview_voice_enabled,
        "user": user.to_dict(),
    }


@app.get("/api/admin/overview")
def admin_overview(_: AuthUser = Depends(current_admin)):
    auth_stats = auth.stats()
    project_stats = projects.platform_summary()
    return {
        "auth": auth_stats,
        "projects": project_stats,
        "runtime": {
            "mock_mode": False,
            "llm_configured": False,
            "stt_provider": settings.stt_provider,
            "llm_model": "",
            "llm_note": "per-user AI providers only",
            "storage": "sqlite-auth + per-user-json",
        },
    }


@app.get("/api/admin/users")
def admin_users(_: AuthUser = Depends(current_admin)):
    return {"users": auth.list_users()}


@app.get("/api/assets")
def get_assets(user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    return {"resume_text": store.resume_text, "assets": store.to_dicts()}


@app.delete("/api/assets")
def clear_assets(user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    store.clear()
    return {"assets": []}


@app.delete("/api/assets/{asset_id}")
def delete_asset(asset_id: str, user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    if not store.remove_asset(asset_id):
        raise HTTPException(status_code=404, detail="素材不存在")
    return {"ok": True, "assets": store.to_dicts()}


@app.post("/api/materials/extract")
async def extract_material_file(file: UploadFile = File(...), user: AuthUser = Depends(current_user)):
    """解析上传资料为纯文本，供资料包分析使用（不入库简历素材）。"""
    import asyncio

    _ = user  # auth only
    filename = file.filename or "unnamed"
    suffix = os.path.splitext(filename)[1].lower() or ".txt"
    if suffix in (".ppt", ".pptx", ".doc"):
        raise HTTPException(
            status_code=400,
            detail=f"暂不支持 {suffix}，请先转为 PDF / DOCX / TXT / MD 后再上传",
        )

    tmp_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name
        text = await asyncio.to_thread(extract_text, tmp_path)
        text = (text or "").strip()
        if not text:
            raise HTTPException(
                status_code=400,
                detail="未能提取到文本（扫描版 PDF 或空文件，请换可复制文本的 PDF/DOCX/TXT）",
            )
        # 单份资料截断，避免撑爆 LLM 上下文
        max_chars = 20000
        truncated = len(text) > max_chars
        if truncated:
            text = text[:max_chars]
        return {
            "ok": True,
            "filename": filename,
            "text": text,
            "chars": len(text),
            "truncated": truncated,
        }
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("material extract failed (%s): %s", filename, exc)
        raise HTTPException(status_code=500, detail=f"文件解析失败：{exc}") from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.post("/api/project-packs/analyze")
def analyze_project_pack_api(body: ProjectPackAnalyzeBody, user: AuthUser = Depends(current_user)):
    """分析项目资料包：简历描述 / 口头介绍 / 深挖题。"""
    set_llm_user(user.user_id)
    try:
        from project_pack_analyzer import analyze_project_pack

        analysis = analyze_project_pack(
            pack_name=body.pack_name or "",
            resume_project=body.resume_project,
            materials=body.materials or [],
        )
        return {"ok": True, "analysis": analysis}
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("project pack analyze failed")
        raise HTTPException(status_code=500, detail=f"分析失败：{e}") from e


@app.post("/api/jd-match/analyze")
def analyze_jd_match_api(body: JdMatchAnalyzeBody, user: AuthUser = Depends(current_user)):
    """岗位匹配度分析（JD解析 → 简历画像 → 多维匹配）。"""
    set_llm_user(user.user_id)
    try:
        from jd_match_analyzer import analyze_jd_match

        analysis = analyze_jd_match(
            resume_text=body.resume_text or "",
            jd_text=body.jd_text or "",
            structured=body.structured if isinstance(body.structured, dict) else None,
        )
        return {"ok": True, "analysis": analysis}
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("jd match analyze failed")
        raise HTTPException(status_code=500, detail=f"分析失败：{e}") from e


@app.post("/api/jd-match/reconstruct")
def jd_match_reconstruct_api(body: JdMatchReconstructBody, user: AuthUser = Depends(current_user)):
    """二期：经历优先级 + 优化方案 + ATS。"""
    set_llm_user(user.user_id)
    try:
        from jd_match.reconstruct import run_reconstruct

        result = run_reconstruct(
            resume_text=body.resume_text or "",
            analysis=body.analysis if isinstance(body.analysis, dict) else {},
            structured=body.structured if isinstance(body.structured, dict) else None,
            context=body.context if isinstance(body.context, dict) else None,
        )
        return {"ok": True, **result}
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("jd match reconstruct failed")
        raise HTTPException(status_code=500, detail=f"重构分析失败：{e}") from e


@app.post("/api/jd-match/apply-optimize")
def jd_match_apply_optimize_api(body: JdMatchApplyOptimizeBody, user: AuthUser = Depends(current_user)):
    """二期：用户确认后生成优化版简历 Markdown。"""
    set_llm_user(user.user_id)
    try:
        from jd_match.reconstruct import apply_optimization

        result = apply_optimization(
            resume_text=body.resume_text or "",
            optimization_plan=body.optimization_plan if isinstance(body.optimization_plan, dict) else {},
            confirmations=body.confirmations if isinstance(body.confirmations, dict) else None,
        )
        return {"ok": True, **result}
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("jd match apply optimize failed")
        raise HTTPException(status_code=500, detail=f"生成优化简历失败：{e}") from e


@app.post("/api/jd-match/fetch-jd")
def jd_match_fetch_jd_api(body: JdMatchFetchJdBody, user: AuthUser = Depends(current_user)):
    """三期：从 URL 抓取并清洗 JD 文本。"""
    set_llm_user(user.user_id)
    try:
        from jd_match.export_ops import fetch_jd_from_url

        result = fetch_jd_from_url(body.url or "")
        return {"ok": True, **result}
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("jd match fetch jd failed")
        raise HTTPException(status_code=500, detail=f"抓取 JD 失败：{e}") from e


@app.post("/api/jd-match/materials")
def jd_match_materials_api(body: JdMatchMaterialsBody, user: AuthUser = Depends(current_user)):
    """三期：求职信要点 + 自我介绍 + 面试追问 + 薪资谈判 + LinkedIn 摘要。"""
    set_llm_user(user.user_id)
    try:
        from jd_match.export_ops import generate_materials

        materials = generate_materials(
            resume_text=body.resume_text or "",
            analysis=body.analysis if isinstance(body.analysis, dict) else {},
        )
        return {"ok": True, "materials": materials}
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("jd match materials failed")
        raise HTTPException(status_code=500, detail=f"生成配套物料失败：{e}") from e


@app.post("/api/jd-match/export-report")
def jd_match_export_report_api(body: JdMatchExportBody, user: AuthUser = Depends(current_user)):
    """三期：导出分析报告（Markdown / JSON）。"""
    try:
        from jd_match.export_ops import build_export_bundle

        bundle = build_export_bundle(
            analysis=body.analysis if isinstance(body.analysis, dict) else {},
            reconstruct=body.reconstruct if isinstance(body.reconstruct, dict) else None,
            materials=body.materials if isinstance(body.materials, dict) else None,
            resume_name=body.resume_name or "",
        )
        fmt = (body.format or "both").lower()
        out: dict = {"ok": True}
        if fmt in ("markdown", "md", "both"):
            out["report_markdown"] = bundle["report_markdown"]
        if fmt in ("json", "both"):
            out["report_json"] = bundle["report_json"]
        return out
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("jd match export failed")
        raise HTTPException(status_code=500, detail=f"导出失败：{e}") from e


# ----------------------------- 资料库卡片 / 项目库 -----------------------------
@app.post("/api/material-docs")
async def upload_material_doc(
    file: UploadFile = File(...),
    doc_type: str = "other",
    user: AuthUser = Depends(current_user),
):
    """上传资料到资料库（落盘 + 抽字）。"""
    import asyncio

    from material_archive import save_document

    raw = await file.read()
    suffix = os.path.splitext(file.filename or "")[1] or ".txt"
    tmp_path = ""
    text = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        text = await asyncio.to_thread(extract_text, tmp_path)
        text = (text or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.warning("material doc extract failed (%s): %s", file.filename, exc)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    doc = save_document(
        user.user_id,
        filename=file.filename or "未命名",
        raw_bytes=raw,
        raw_text=text,
        mime=file.content_type or "",
        doc_type=doc_type or "other",
    )
    return {"ok": True, "doc": doc}


@app.get("/api/material-docs")
def list_material_docs(include_text: bool = False, user: AuthUser = Depends(current_user)):
    from material_archive import list_documents

    return {"docs": list_documents(user.user_id, include_text=include_text)}


@app.post("/api/material-docs/{doc_id}/archive")
def archive_material_doc(
    doc_id: str,
    body: MaterialArchiveBody | None = None,
    user: AuthUser = Depends(current_user),
):
    set_llm_user(user.user_id)
    from material_archive import archive_document

    force = bool(body.force) if body else False
    try:
        return {"ok": True, **archive_document(user.user_id, doc_id, force=force)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/material-cards")
def get_material_cards(doc_id: str | None = None, user: AuthUser = Depends(current_user)):
    from material_archive import list_cards

    return {"cards": list_cards(user.user_id, doc_id=doc_id)}


@app.patch("/api/material-cards/{card_id}")
def patch_material_card(
    card_id: str,
    body: MaterialCardPatchBody,
    user: AuthUser = Depends(current_user),
):
    from material_archive import patch_card

    updated = patch_card(user.user_id, card_id, body.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(status_code=404, detail="卡片不存在")
    return {"ok": True, "card": updated}


@app.post("/api/resume-projects/from-resume")
def sync_resume_projects(body: ResumeProjectsSyncBody, user: AuthUser = Depends(current_user)):
    from project_library import sync_from_structured

    if not body.projects:
        raise HTTPException(status_code=400, detail="projects 为空")
    projects = sync_from_structured(
        user.user_id,
        projects=body.projects,
        source_resume_id=body.source_resume_id or "",
        replace=bool(body.replace),
    )
    return {"ok": True, "projects": projects, "count": len(projects)}


@app.get("/api/resume-projects")
def get_resume_projects(
    source_resume_id: str | None = None,
    user: AuthUser = Depends(current_user),
):
    from project_library import list_projects

    return {"projects": list_projects(user.user_id, source_resume_id=source_resume_id)}


@app.post("/api/resume-projects/{project_id}/bind")
def bind_project_cards(
    project_id: str,
    body: ProjectBindBody,
    user: AuthUser = Depends(current_user),
):
    from project_library import bind_cards

    try:
        project = bind_cards(
            user.user_id,
            project_id,
            body.card_ids or [],
            replace=bool(body.replace),
        )
        return {"ok": True, "project": project}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.delete("/api/resume-projects/{project_id}/bind/{card_id}")
def unbind_project_card(
    project_id: str,
    card_id: str,
    user: AuthUser = Depends(current_user),
):
    from project_library import unbind_card

    try:
        project = unbind_card(user.user_id, project_id, card_id)
        return {"ok": True, "project": project}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e


@app.post("/api/resume-projects/{project_id}/optimize")
def optimize_resume_project(project_id: str, user: AuthUser = Depends(current_user)):
    set_llm_user(user.user_id)
    from project_library import optimize_project

    try:
        result = optimize_project(user.user_id, project_id)
        return {"ok": True, **result}
    except LLMNotConfiguredError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        logger.exception("resume project optimize failed")
        raise HTTPException(status_code=500, detail=f"优化失败：{e}") from e



def _ingest_resume_text(store, raw: str, layout_blocks: list | None = None, user_id: str | None = None) -> dict:
    """抽取结构化简历 + 素材；正文以结构化回填为准。"""
    # 线程池内 ContextVar 可能丢失，显式绑定当前用户 LLM 配置
    if user_id:
        set_llm_user(user_id)
    cleaned, raw_text = clean_resume_text(raw)
    source = cleaned or raw_text
    if not source.strip():
        return {"error": "未能得到可用于抽取的文本", "assets": [], "resume_text_raw": raw_text}

    structured = None
    struct_error = ""

    # ── 1. 优先使用 Skill Parser（基于 resume-parser-skill.md）──
    try:
        structured = parse_resume_with_skill(source)
        logger.info("Skill parser succeeded")
    except Exception as skill_exc:  # noqa: BLE001
        logger.warning("Skill parser failed, fallback to legacy: %s", skill_exc)
        # ── 2. 回退到原有 extract_structured_resume ──
        try:
            structured = extract_structured_resume(source)
        except Exception as exc:  # noqa: BLE001
            struct_error = str(exc)
            logger.warning("Legacy structured extract failed, fallback to deterministic: %s", exc)
            # ── 3. 最终回退到纯规则抽取 ──
            try:
                structured = normalize_structured(extract_deterministic_resume(source))
                structured.setdefault("needs_confirmation", []).append(
                    f"结构化降级为规则抽取：{exc}"
                )
            except Exception as det_exc:  # noqa: BLE001
                logger.exception("Deterministic extract also failed")
                structured = normalize_structured({})
                struct_error = f"{exc}；规则抽取失败：{det_exc}"

    plain = structured_resume_plain_text(structured) if structured else ""
    store_text = plain or cleaned or raw_text

    # ---- 多维度书写质量评分（skill 量规，总分 0–110）----
    quality_report: dict = {}
    score_detail = {"total": 0, "dimensions": {}, "summary": ""}
    if plain:
        try:
            from resume_quality import quality_report_to_score_detail

            quality_report = score_resume_content(plain, structured)
            score_detail = quality_report_to_score_detail(quality_report)
        except Exception as exc:
            logger.warning("Resume scoring failed: %s", exc)
    if structured and isinstance(structured, dict):
        structured["quality_report"] = quality_report
        structured["score_detail"] = score_detail

    # ---- 注入 pymupdf 样式布局块（纸面还原用） ----
    if layout_blocks and structured and isinstance(structured, dict):
        if not structured.get("layout_blocks"):
            structured["layout_blocks"] = layout_blocks

    # ---- 智能批注 ----
    llm_annotations: list = []
    if plain:
        try:
            llm_annotations = annotate_resume(plain, structured)
        except Exception as exc:
            logger.warning("Resume annotation failed: %s", exc)
    if structured and isinstance(structured, dict) and llm_annotations:
        # 合并前端标注（如有）和 LLM 批注
        existing = structured.get("annotations") or []
        structured["annotations"] = existing + llm_annotations

    assets: list = []
    asset_error = ""
    try:
        assets = parse_resume(store_text)
    except (LLMNotConfiguredError, LLMServiceError) as exc:
        asset_error = str(exc)
        assets = []

    store.set_resume(store_text, assets)
    result = {
        "assets": store.to_dicts(),
        "count": len(store.assets),
        "resume_text": store.resume_text,
        "resume_text_raw": raw_text,
        "structured": structured,
    }
    warnings = [w for w in (struct_error, asset_error) if w]
    if warnings:
        result["warning"] = "；".join(warnings)
    return result


@app.post("/api/resume/text")
def upload_resume_text(body: ResumeText, user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    raw = (body.text or "").strip()
    if not raw:
        return {"error": "简历内容为空", "assets": []}
    try:
        return _ingest_resume_text(store, raw, user_id=user.user_id)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Resume text ingest failed for user %s", user.user_id)
        return {"error": f"解析失败：{exc}", "assets": []}


@app.post("/api/resume/file")
async def upload_resume_file(file: UploadFile = File(...), user: AuthUser = Depends(current_user)):
    """PDF 抽取 + 深度分析（由分析台「分析」按钮调用，上传页不再调用）。"""
    import asyncio

    try:
        store = _material_store(user.user_id)
        set_llm_user(user.user_id)
        suffix = os.path.splitext(file.filename or "")[1] or ".txt"
        tmp_path = ""
        content = ""
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(await file.read())
                tmp_path = tmp.name
            content = await asyncio.to_thread(extract_text, tmp_path)
            content = content.strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Resume file extract failed (%s): %s", file.filename, exc)
            return {"error": f"文件解析失败：{exc}", "assets": []}
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)

        if not content:
            return {"error": "未能从文件中提取到文本（扫描版 PDF 或旧版 .doc 需先转为 .docx/.txt）", "assets": []}

        result = await asyncio.to_thread(
            _ingest_resume_text, store, content, None, user.user_id
        )
        result["filename"] = file.filename
        return result
    except Exception as exc:  # noqa: BLE001
        logger.exception("Resume upload failed for user %s", user.user_id)
        return {"error": f"上传失败：{exc}", "assets": []}


@app.get("/api/questions")
def list_questions(user: AuthUser = Depends(current_user)):
    """兼容旧接口：返回专属（personal）题库。"""
    qbank = _question_bank(user.user_id)
    return {"questions": qbank.to_dicts(BANK_PERSONAL)}


@app.get("/api/question-banks")
def get_all_question_banks(user: AuthUser = Depends(current_user)):
    qbank = _question_bank(user.user_id)
    return qbank.snapshot()


@app.get("/api/question-banks/general")
def get_general_bank(role: str = "后端工程师", user: AuthUser = Depends(current_user)):
    qbank = _question_bank(user.user_id)
    role = (role or "后端工程师").strip()
    if role != qbank.general_role or not qbank.general:
        try:
            items = generate_general(role)
        except (LLMNotConfiguredError, LLMServiceError, ValueError) as exc:
            return {"error": str(exc), "questions": [], "count": 0}
        qbank.replace_bank(BANK_GENERAL, items, role=role)
    return {
        "bank": BANK_GENERAL,
        "role": qbank.general_role,
        "questions": qbank.to_dicts(BANK_GENERAL),
        "count": len(qbank.general),
        "auto_loaded": True,
    }


@app.get("/api/question-banks/personal")
def get_personal_bank(user: AuthUser = Depends(current_user)):
    qbank = _question_bank(user.user_id)
    return {
        "bank": BANK_PERSONAL,
        "questions": qbank.to_dicts(BANK_PERSONAL),
        "count": len(qbank.personal),
    }


@app.get("/api/question-banks/custom")
def get_custom_bank(user: AuthUser = Depends(current_user)):
    qbank = _question_bank(user.user_id)
    return {
        "bank": BANK_CUSTOM,
        "jd_text": qbank.custom_jd,
        "questions": qbank.to_dicts(BANK_CUSTOM),
        "count": len(qbank.custom),
    }


@app.post("/api/questions/generate")
@app.post("/api/question-banks/personal/generate")
def generate_question_bank(user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    qbank = _question_bank(user.user_id)
    try:
        items = generate_personal_questions(store.assets, store.resume_text)
    except (LLMNotConfiguredError, LLMServiceError, ValueError) as exc:
        return {"error": str(exc), "questions": [], "count": 0}
    qbank.replace_bank(BANK_PERSONAL, items)
    return {
        "bank": BANK_PERSONAL,
        "questions": qbank.to_dicts(BANK_PERSONAL),
        "count": len(qbank.personal),
    }


@app.post("/api/question-banks/custom/generate")
def generate_custom_bank(body: CustomBankBody, user: AuthUser = Depends(current_user)):
    qbank = _question_bank(user.user_id)
    jd = (body.jd_text or "").strip()
    if not jd:
        return {"error": "JD 内容为空", "questions": [], "count": 0}
    try:
        items = generate_custom(jd)
    except (LLMNotConfiguredError, LLMServiceError) as exc:
        return {"error": str(exc), "questions": [], "count": 0}
    qbank.replace_bank(BANK_CUSTOM, items, jd_text=jd)
    return {
        "bank": BANK_CUSTOM,
        "jd_text": qbank.custom_jd,
        "questions": qbank.to_dicts(BANK_CUSTOM),
        "count": len(qbank.custom),
    }


@app.post("/api/question-banks/session/sys")
def session_sys_questions(body: SessionSysBody, user: AuthUser = Depends(current_user)):
    """第1页：本地系统题库即时返回，不调用 LLM。"""
    from system_question_bank import query_system_questions

    role = (body.role or "").strip() or "通用"
    years = (body.years or "").strip() or "1-3"
    result = query_system_questions(role=role, years=years, limit=body.limit or 12)
    return {
        "ok": True,
        "bank": "sys",
        "role": role,
        "years": years,
        "match": result["match"],
        "questions": result["questions"],
        "count": result["count"],
    }


@app.post("/api/question-banks/session/from-assets")
def session_from_assets(body: SessionFromAssetsBody, user: AuthUser = Depends(current_user)):
    """第2页懒加载：按简历+材料生成（进入该页才调用）。"""
    from types import SimpleNamespace

    set_llm_user(user.user_id)
    role = (body.role or "").strip()
    years = (body.years or "").strip() or "1-3"
    resume_text = (body.resume_text or "").strip()
    materials = body.materials or []
    if not resume_text and not materials:
        return {"ok": False, "error": "请先选择简历或材料", "questions": [], "count": 0}

    assets = []
    for m in materials[:12]:
        if not isinstance(m, dict):
            continue
        content = str(m.get("content") or "").strip()
        title = str(m.get("name") or m.get("title") or "材料").strip()
        assets.append(
            SimpleNamespace(
                asset_type=str(m.get("kind") or m.get("asset_type") or "材料"),
                title=title,
                content=content[:5000],
            )
        )

    prefix = f"目标岗位：{role or '未指定'}\n该岗位工作年数：{years}\n\n"
    qbank = _question_bank(user.user_id)
    try:
        items = generate_personal_questions(assets, prefix + resume_text)
    except (LLMNotConfiguredError, LLMServiceError, ValueError) as exc:
        return {"ok": False, "error": str(exc), "questions": [], "count": 0}
    qbank.replace_bank(BANK_PERSONAL, items)
    return {
        "ok": True,
        "bank": "resume",
        "questions": qbank.to_dicts(BANK_PERSONAL),
        "count": len(qbank.personal),
    }


@app.post("/api/question-banks/session/from-jd")
def session_from_jd(body: SessionFromJdBody, user: AuthUser = Depends(current_user)):
    """第3页懒加载：按 JD 生成（进入该页才调用）。"""
    set_llm_user(user.user_id)
    role = (body.role or "").strip()
    years = (body.years or "").strip() or "1-3"
    jd = (body.jd_text or "").strip()
    if not jd:
        return {"ok": False, "error": "JD 内容为空", "questions": [], "count": 0}

    wrapped = f"目标岗位：{role or '未指定'}\n该岗位工作年数：{years}\n\n招聘 JD：\n{jd}"
    qbank = _question_bank(user.user_id)
    try:
        items = generate_custom(wrapped)
    except (LLMNotConfiguredError, LLMServiceError) as exc:
        return {"ok": False, "error": str(exc), "questions": [], "count": 0}
    qbank.replace_bank(BANK_CUSTOM, items, jd_text=jd)
    return {
        "ok": True,
        "bank": "jd",
        "jd_text": qbank.custom_jd,
        "questions": qbank.to_dicts(BANK_CUSTOM),
        "count": len(qbank.custom),
    }


@app.post("/api/questions")
def add_question(body: AddQuestionBody, user: AuthUser = Depends(current_user)):
    q = (body.question or "").strip()
    if not q:
        return {"ok": False, "error": "问题不能为空"}
    qbank = _question_bank(user.user_id)
    item = qbank.add(question=q, answer=(body.answer or "").strip())
    return {"ok": True, "question_id": item.question_id, "questions": qbank.to_dicts()}


@app.put("/api/questions/{qid}")
def update_question(qid: str, body: UpdateQuestion, user: AuthUser = Depends(current_user)):
    qbank = _question_bank(user.user_id)
    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    ok = qbank.update(qid, fields)
    return {"ok": ok, "questions": qbank.to_dicts()}


@app.delete("/api/questions/{qid}")
def delete_question(qid: str, user: AuthUser = Depends(current_user)):
    qbank = _question_bank(user.user_id)
    ok = qbank.delete(qid)
    return {"ok": ok, "questions": qbank.to_dicts()}


# ----------------------------- 面试复盘 -----------------------------
@app.get("/api/reviews")
def list_reviews(user: AuthUser = Depends(current_user)):
    reviews = _review_store(user.user_id)
    mock_sessions = _mock_interviews(user.user_id).list_summaries()
    sessions = reviews.list_summaries() + mock_sessions
    sessions.sort(key=lambda item: item.get("started_at", 0), reverse=True)
    return {"sessions": sessions}


@app.get("/api/reviews/{sid}")
def get_review(sid: str, user: AuthUser = Depends(current_user)):
    reviews = _review_store(user.user_id)
    data = reviews.get(sid)
    if data is None:
        data = _mock_interviews(user.user_id).to_review_detail(sid)
    if data is None:
        return {"error": "会话不存在"}
    return data


@app.post("/api/reviews/{sid}/report")
def generate_review_report(sid: str, user: AuthUser = Depends(current_user)):
    reviews = _review_store(user.user_id)
    report = reviews.generate_report(sid)
    if report is None:
        report = _mock_interviews(user.user_id).generate_report(
            sid,
            resume_context=_build_context_from_all(_material_store(user.user_id)),
        )
    if report is None:
        return {"error": "会话不存在"}
    return {"ok": True, "report": report}


@app.get("/api/reviews/{sid}/report")
def get_review_report(sid: str, user: AuthUser = Depends(current_user)):
    reviews = _review_store(user.user_id)
    data = reviews.get(sid)
    if data is None:
        mock = _mock_interviews(user.user_id).get(sid)
        if mock is None:
            return {"error": "会话不存在"}
        report = mock.get("report") or _mock_interviews(user.user_id).generate_report(
            sid,
            resume_context=_build_context_from_all(_material_store(user.user_id)),
        )
        return {"ok": True, "report": report}
    report = data.get("report") or reviews.generate_report(sid)
    return {"ok": True, "report": report}


@app.delete("/api/reviews/{sid}")
def delete_review(sid: str, user: AuthUser = Depends(current_user)):
    reviews = _review_store(user.user_id)
    ok = reviews.delete(sid)
    mock_ok = _mock_interviews(user.user_id).delete(sid)
    sessions = reviews.list_summaries() + _mock_interviews(user.user_id).list_summaries()
    sessions.sort(key=lambda item: item.get("started_at", 0), reverse=True)
    return {"ok": ok or mock_ok, "sessions": sessions}


@app.post("/api/reviews/{sid}/to-bank")
def review_item_to_bank(sid: str, body: AddToBank, user: AuthUser = Depends(current_user)):
    reviews = _review_store(user.user_id)
    qbank = _question_bank(user.user_id)
    item = reviews.get_item(sid, body.item_id)
    if item is not None:
        answer = item.outline if isinstance(item.outline, str) else json.dumps(item.outline, ensure_ascii=False, indent=2)
        q = qbank.add(question=item.transcript, answer=answer)
        return {"ok": True, "question_id": q.question_id, "questions": qbank.to_dicts()}
    mock_item = _mock_interviews(user.user_id).get_answer(sid, body.item_id)
    if mock_item is None:
        return {"ok": False, "error": "记录不存在"}
    q = qbank.add(question=mock_item["question"], answer=mock_item.get("reference_answer") or "")
    return {"ok": True, "question_id": q.question_id, "questions": qbank.to_dicts()}


@app.post("/api/mock-interview/next")
def mock_interview_next(body: MockHistory, user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    qbank = _question_bank(user.user_id)
    idx = len(body.history or [])
    # 优先用专属题库按序出题（题库→模拟面试联动）
    if qbank.questions:
        if idx >= len(qbank.questions):
            return {"done": True, "from_bank": True}
        q = qbank.questions[idx]
        return {
            "question": q.question,
            "question_id": q.question_id,
            "answer": q.answer,
            "from_bank": True,
            "index": idx + 1,
            "total": len(qbank.questions),
            "done": False,
        }
    # 题库为空时回退到即时生成
    context = _build_context_from_all(store)
    titles = [a.title for a in store.assets]
    q = next_question(context, titles, body.history or [])
    q["from_bank"] = False
    q["done"] = False
    return q


@app.post("/api/mock-interviews")
def create_mock_interview(body: CreateMockInterview, user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    jd_text = (body.jd_text or "").strip()
    if not (store.resume_text or "").strip() and not store.assets:
        return {"error": "请先上传简历或素材"}
    set_llm_user(user.user_id)
    try:
        session = _mock_interviews(user.user_id).create_session(
            role=body.role,
            jd_text=jd_text,
            company_name=body.company_name,
            language=body.language,
            scope=body.scope,
            source_bank=body.source_bank,
            question_limit=body.question_limit,
            resume_context=_build_context_from_all(store),
        )
    except (LLMNotConfiguredError, LLMServiceError) as exc:
        return {"error": str(exc)}
    return {"ok": True, "session": session}


@app.get("/api/mock-interviews/{sid}")
def get_mock_interview(sid: str, user: AuthUser = Depends(current_user)):
    session = _mock_interviews(user.user_id).get(sid)
    if session is None:
        return {"error": "会话不存在"}
    return {"ok": True, "session": session}


@app.post("/api/mock-interviews/{sid}/next")
def next_mock_interview_question(sid: str, user: AuthUser = Depends(current_user)):
    # sync 接口可能跑在与 Depends 不同的线程，须在本函数内重新绑定
    set_llm_user(user.user_id)
    mock_store = _mock_interviews(user.user_id)
    material_store = _material_store(user.user_id)
    question = mock_store.fetch_next_question(
        sid,
        resume_context=_build_context_from_all(material_store),
        asset_titles=[a.title for a in material_store.assets],
    )
    if question.get("error") and not question.get("done"):
        return question
    return question


@app.post("/api/mock-interviews/{sid}/answers")
def submit_mock_interview_answer(sid: str, body: SubmitMockAnswer, user: AuthUser = Depends(current_user)):
    set_llm_user(user.user_id)
    mock_store = _mock_interviews(user.user_id)
    session = mock_store.get(sid)
    if session is None:
        return {"error": "会话不存在"}
    answer_text = (body.answer_text or "").strip()
    if not answer_text:
        return {"error": "回答不能为空"}
    question = session.get("current_question") or {}
    if not question.get("question"):
        return {"error": "请先获取面试题"}

    material_store = _material_store(user.user_id)
    result = mock_store.process_answer(
        sid,
        question,
        answer_text,
        resume_context=_build_context_from_all(material_store),
        asset_titles=[a.title for a in material_store.assets],
    )
    return result


@app.post("/api/mock-interviews/{sid}/outline")
async def mock_interview_outline(sid: str, user: AuthUser = Depends(current_user)):
    set_llm_user(user.user_id)
    mock_store = _mock_interviews(user.user_id)
    session = mock_store.get(sid)
    if session is None:
        return {"error": "会话不存在"}
    if session.get("status") != "active":
        return {"error": "当前没有进行中的题目"}
    question = session.get("current_question") or {}
    qtext = (question.get("question") or "").strip()
    if not qtext:
        return {"error": "请先获取面试题"}
    material_store = _material_store(user.user_id)
    context = _build_context(material_store, qtext)
    try:
        outline = await generate_outline(qtext, context)
    except (LLMNotConfiguredError, LLMServiceError) as exc:
        return {"error": str(exc)}
    return {"ok": True, "outline": outline, "question": qtext}


@app.post("/api/mock-interviews/{sid}/skip")
def skip_mock_interview_question(sid: str, user: AuthUser = Depends(current_user)):
    set_llm_user(user.user_id)
    material_store = _material_store(user.user_id)
    result = _mock_interviews(user.user_id).skip_current_question(
        sid,
        resume_context=_build_context_from_all(material_store),
        asset_titles=[a.title for a in material_store.assets],
    )
    return result


def _bg_mock_interview_report(user_id: str, sid: str) -> None:
    """后台生成评分报告（结束接口快速返回后异步跑）。"""
    try:
        set_llm_user(user_id)
        material_store = _material_store(user_id)
        _mock_interviews(user_id).generate_report(
            sid,
            resume_context=_build_context_from_all(material_store),
        )
    except Exception:
        logging.exception("mock interview report background failed sid=%s user=%s", sid, user_id)


@app.post("/api/mock-interviews/{sid}/finish")
def finish_mock_interview(
    sid: str,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(current_user),
):
    set_llm_user(user.user_id)
    material_store = _material_store(user.user_id)
    # 只改会话状态，评分报告丢到后台，避免结束面试卡住
    session = _mock_interviews(user.user_id).finish_session(
        sid,
        resume_context=_build_context_from_all(material_store),
        with_report=False,
    )
    if session is None:
        return {"error": "会话不存在"}
    from mock_interview_store import _report_ready

    if not _report_ready(session.get("report")):
        background_tasks.add_task(_bg_mock_interview_report, user.user_id, sid)
    return {"ok": True, "session": session, "report": session.get("report") or {}, "report_pending": True}


@app.get("/api/mock-interviews/{sid}/report.html")
def get_mock_interview_report_html(sid: str, user: AuthUser = Depends(current_user)):
    from fastapi.responses import HTMLResponse
    from mock_interview_store import _report_ready

    set_llm_user(user.user_id)
    mock_store = _mock_interviews(user.user_id)
    session = mock_store.get(sid)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    material_store = _material_store(user.user_id)
    report = session.get("report") if _report_ready(session.get("report")) else None
    if not report:
        report = mock_store.generate_report(
            sid,
            resume_context=_build_context_from_all(material_store),
        )
    html_content = (report or {}).get("html") or ""
    if not html_content:
        raise HTTPException(status_code=404, detail="报告尚未生成")
    return HTMLResponse(content=html_content)


@app.get("/api/mock-interviews/{sid}/report")
def get_mock_interview_report(sid: str, user: AuthUser = Depends(current_user)):
    from mock_interview_store import _report_ready

    set_llm_user(user.user_id)
    mock_store = _mock_interviews(user.user_id)
    session = mock_store.get(sid)
    if session is None:
        return {"error": "会话不存在"}
    material_store = _material_store(user.user_id)
    report = session.get("report") if _report_ready(session.get("report")) else None
    if not report:
        report = mock_store.generate_report(
            sid,
            resume_context=_build_context_from_all(material_store),
        )
    return {"ok": True, "report": report}


# ----------------------------- 我的项目库 -----------------------------
@app.get("/api/projects")
def list_projects(role: str | None = None, user: AuthUser = Depends(current_user)):
    return {
        "projects": projects.list_market(user.user_id, role),
        "roles": projects.available_roles(),
    }


@app.post("/api/projects")
def create_project(body: CreateProject, user: AuthUser = Depends(current_user)):
    p = projects.create(user.user_id, user.username, body.model_dump())
    return {"ok": True, "project_id": p.project_id, "status": p.status}


@app.get("/api/projects/purchased")
def my_purchased_projects(user: AuthUser = Depends(current_user)):
    return {"projects": projects.my_purchases(user.user_id)}


@app.get("/api/projects/mine")
def my_uploaded_projects(user: AuthUser = Depends(current_user)):
    return {"projects": projects.my_uploads(user.user_id)}


@app.get("/api/projects/income")
def my_income(user: AuthUser = Depends(current_user)):
    return projects.income_summary(user.user_id)


@app.get("/api/projects/{pid}")
def get_project(pid: str, user: AuthUser = Depends(current_user)):
    data = projects.get(pid, user.user_id)
    if data is None:
        return {"error": "项目不存在"}
    return data


@app.post("/api/projects/{pid}/purchase")
def purchase_project(pid: str, user: AuthUser = Depends(current_user)):
    return projects.purchase(pid, user.user_id)


@app.post("/api/projects/{pid}/review")
def review_project(pid: str, body: ReviewAction, user: AuthUser = Depends(current_user)):
    if not user.is_admin:
        return {"ok": False, "error": "需要管理员权限"}
    return projects.review(pid, body.action)


@app.delete("/api/projects/{pid}")
def delist_project(pid: str, user: AuthUser = Depends(current_user)):
    ok = projects.delist(pid, user.user_id)
    return {"ok": ok, "projects": projects.my_uploads(user.user_id)}


@app.post("/api/projects/{pid}/to-assets")
def project_to_assets(pid: str, user: AuthUser = Depends(current_user)):
    store = _material_store(user.user_id)
    data = projects.get(pid, user.user_id)
    if data is None:
        return {"ok": False, "error": "项目不存在"}
    if data.get("locked"):
        return {"ok": False, "error": "请先购买后再加入素材库"}
    a = store.add_asset(
        {
            "asset_type": "项目",
            "title": data["title"],
            "content": data.get("full_content") or data.get("preview_summary", ""),
            "keywords": data.get("tags", []),
            "source": "project_library",
        }
    )
    return {"ok": True, "asset_id": a.asset_id, "note": "已加入素材库，请结合你的真实经历改写后使用。"}


# --------------------------- 检索辅助 ---------------------------
def _build_context(store: MaterialStore, question: str) -> str:
    hits = store.retrieve(question, top_k=3)
    return _format_assets(hits)


def _build_context_from_all(store: MaterialStore) -> str:
    return _format_assets(store.assets[:5])


def _format_assets(assets) -> str:
    if not assets:
        return ""
    lines = []
    for a in assets:
        kw = ("｜关键词：" + "、".join(a.keywords)) if a.keywords else ""
        lines.append(f"- [{a.asset_type}] {a.title}：{a.content}{kw}")
    return "\n".join(lines)


# --------------------------- WebSocket ---------------------------
async def _ws_send(ws: WebSocket, obj: dict):
    await ws.send_text(json.dumps(obj, ensure_ascii=False))


@app.websocket("/ws/session")
async def ws_session(ws: WebSocket):
    await ws.accept()
    import asyncio

    mode = ws.query_params.get("mode", "realtime")  # realtime | mock
    token = ws.query_params.get("token", "")
    user = auth.user_from_token(token) or auth.get_user(DEMO_USER_ID)
    set_llm_user(user.user_id if user else None)
    store = _material_store(user.user_id)
    reviews = _review_store(user.user_id)
    loop = asyncio.get_running_loop()
    session = create_stt_session(loop)
    consumer: "asyncio.Task | None" = None
    error_consumer: "asyncio.Task | None" = None
    # 复盘会话 ID（仅实时辅助记录问题，模拟面试转写的是回答不记录）
    rv = {"sid": None, "answer_mode": "outline", "jd_text": ""}

    cred = resolve_active_credentials(user.user_id) if user else None
    await _ws_send(ws, {
        "type": "ready",
        "mock": False,
        "llm_configured": bool(cred and cred.get("api_key")),
        "stt_provider": settings.stt_provider,
        "mode": mode,
        "user": user.to_dict(),
    })
    await _ws_send(ws, {"type": "assets", "assets": store.to_dicts()})

    def _realtime_context(question: str) -> str:
        base = _build_context(store, question)
        jd = (rv.get("jd_text") or "").strip()
        if not jd:
            return base
        return f"{base}\n\n【目标岗位 / JD】\n{jd}".strip()

    async def consume():
        while True:
            text = await session.final_queue.get()
            await _ws_send(ws, {"type": "transcript", "text": text})
            # 模拟面试：转写的是候选人的回答，不生成提纲
            if mode == "mock":
                continue
            if not is_question(text):
                continue
            qtype = guess_question_type(text)
            await _ws_send(
                ws,
                {
                    "type": "question_detected",
                    "question": text,
                    "question_type": qtype,
                },
            )
            await _ws_send(
                ws,
                {"type": "info", "text": f"识别到问题（{qtype}），生成提纲中…"},
            )
            try:
                outline = await generate_outline(text, _realtime_context(text))
            except (LLMNotConfiguredError, LLMServiceError) as exc:
                await _ws_send(ws, {"type": "error", "text": str(exc)})
                continue
            await _ws_send(ws, {"type": "answer", "question": text, "outline": outline})
            # 落入复盘记录
            if rv["sid"]:
                reviews.add_item(rv["sid"], text, qtype, outline)

    async def consume_errors():
        while True:
            err = await session.error_queue.get()
            await _ws_send(ws, {"type": "error", "text": f"语音识别：{err}"})

    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            # 二进制音频帧
            if msg.get("bytes") is not None:
                await session.feed(msg["bytes"])
                continue
            # 文本指令
            raw = msg.get("text")
            if not raw:
                continue
            try:
                cmd = json.loads(raw)
            except json.JSONDecodeError:
                await _ws_send(ws, {"type": "error", "text": "无效指令"})
                continue

            ctype = cmd.get("type")
            if ctype == "start":
                rv["answer_mode"] = (cmd.get("answer_mode") or "outline").strip() or "outline"
                rv["jd_text"] = (cmd.get("jd_text") or "").strip()
                await session.start()
                if consumer is None:
                    consumer = loop.create_task(consume())
                if error_consumer is None:
                    error_consumer = loop.create_task(consume_errors())
                if mode == "realtime" and rv["sid"] is None:
                    rv["sid"] = reviews.start_session("realtime")
                await _ws_send(ws, {"type": "info", "text": "会话已开始，正在监听…"})
            elif ctype == "stop":
                await session.stop()
                if rv["sid"]:
                    reviews.end_session(rv["sid"])
                    rv["sid"] = None
                await _ws_send(ws, {"type": "info", "text": "会话已结束"})
            elif ctype == "simulate":
                text = (cmd.get("text") or "").strip()
                if text:
                    if consumer is None:
                        consumer = loop.create_task(consume())
                    if error_consumer is None:
                        error_consumer = loop.create_task(consume_errors())
                    if mode == "realtime" and rv["sid"] is None:
                        rv["sid"] = reviews.start_session("realtime")
                    session.push_mock_text(text)
            else:
                await _ws_send(ws, {"type": "error", "text": f"未知指令：{ctype}"})
    except WebSocketDisconnect:
        pass
    finally:
        if consumer:
            consumer.cancel()
        if error_consumer:
            error_consumer.cancel()
        if rv["sid"]:
            reviews.end_session(rv["sid"])
            rv["sid"] = None
        await session.stop()


if __name__ == "__main__":
    import uvicorn

    print("=" * 56)
    print(" AI 面试助手 - 后端 (FastAPI)")
    print(f"  地址: http://{settings.host}:{settings.port}")
    print(f"  STT: {settings.stt_provider} | LLM: 用户「AI 服务商」配置（无 .env 回退）")
    print("=" * 56)
    uvicorn.run(app, host=settings.host, port=settings.port)
