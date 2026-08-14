"""系统题库：只读 interview.db 的 question_depth_answers，把 8 段 Markdown 切成 5 个 Tab。"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
_DEFAULT_DB = Path(r"D:\Interview_question\data\interview.db")
_LOCAL_DB = _BACKEND_DIR / "data" / "interview.db"
SKILL_PATH = _BACKEND_DIR / "skills" / "question_bank" / "full_analysis.md"

DEPTH_MARK = "### 1. 基础标准答案"
DEPTH_TIMEOUT_SEC = 180
_P0_LIMIT = 10

_AI_L2 = {"AI 算法方向"}
_AI_L3 = {"大模型算法", "NLP", "机器学习", "AI 产品"}
_AI_KEYS = ("AI", "大模型", "Agent", "智能体")

_HEADING_RE = re.compile(r"^###\s+(.+?)\s*$", re.M)
_ORAL_KEYS = ("定基调", "核心拆解", "落地实践", "总结收尾", "核心讲解", "拔高收尾")
_FOLLOWUP_RE = re.compile(
    r"\d+\.\s*\*\*追问\*\*[：:]\s*(.+?)\n\s*-\s*\*\*考察意图\*\*[：:]\s*(.+?)\n\s*-\s*\*\*回答要点\*\*[：:]\s*(.+?)(?=\n\d+\.\s*\*\*追问|\Z)",
    re.S,
)
_EXTEND_KEYS = (
    ("concepts", "相关核心概念"),
    ("cases", "真实业务案例"),
    ("tradeoffs", "权衡与取舍"),
    ("learn", "进一步学习建议"),
)


def interview_db_path() -> Path:
    raw = (os.getenv("INTERVIEW_DB_PATH") or "").strip()
    if raw:
        return Path(raw)
    if _DEFAULT_DB.is_file():
        return _DEFAULT_DB
    return _LOCAL_DB


def job_hits_sys(job_l1: str = "", job_l2: str = "", job_l3: str = "") -> bool:
    l2 = (job_l2 or "").strip()
    l3 = (job_l3 or "").strip()
    if l2 in _AI_L2 or l3 in _AI_L3:
        return True
    blob = f"{l2} {l3}"
    return any(k in blob for k in _AI_KEYS)


def _strip_stem(text: str) -> str:
    return re.sub(r"^\d+\.\s*", "", (text or "").strip(), count=1)


def _norm_stem(text: str) -> str:
    return re.sub(r"\s+", "", _strip_stem(text)).lower()


def studio_fingerprint(role: str, resume_text: str, materials_blob: str = "") -> str:
    raw = f"{(role or '').strip()}\n{(resume_text or '').strip()}\n{(materials_blob or '').strip()}"
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:16]


def materials_fingerprint_blob(materials: list | None) -> str:
    parts = []
    for item in materials or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("title") or "").strip()
        content = str(item.get("content") or "").strip()
        if name or content:
            parts.append(f"{name}\n{content}")
    return "\n---\n".join(parts)


def merge_depth_answers(old_questions: list, new_items: list[dict]) -> list[dict]:
    """新题干生成后，按题干复用已入库的深度解析。"""
    old_map = {}
    for q in old_questions or []:
        if isinstance(q, dict):
            stem, ans, qid = q.get("question") or "", q.get("answer") or "", q.get("question_id") or ""
        else:
            stem, ans, qid = q.question or "", q.answer or "", q.question_id or ""
        if DEPTH_MARK in ans:
            old_map[_norm_stem(stem)] = (qid, ans)
    out = []
    for item in new_items or []:
        cloned = dict(item)
        hit = old_map.get(_norm_stem(cloned.get("question") or ""))
        if hit:
            cloned["question_id"] = hit[0]
            cloned["answer"] = hit[1]
        else:
            cloned["answer"] = ""
        out.append(cloned)
    return out


def split_depth_md(md: str) -> dict | None:
    """8 段 Markdown → 5 Tab。缺 DEPTH_MARK 则返回 None。"""
    body = (md or "").strip()
    if DEPTH_MARK not in body:
        return None
    sections = _split_sections(body)
    oral_raw = _pick(sections, "2. 结构化口述框架", "结构化口述框架")
    follow_raw = _pick(sections, "7. 面试官追问", "面试官追问")
    extend_raw = _pick(sections, "8. 深度扩展", "深度扩展")
    return {
        "reference": {
            "standard_answer": _pick(sections, "1. 基础标准答案", "基础标准答案"),
            "oral_framework": _parse_oral(oral_raw),
        },
        "depth": {
            "deep_dive": _pick(sections, "3. 深度解析", "深度解析"),
            "pitfalls_md": _pick(sections, "4. 常见避坑", "常见避坑"),
            "bonus_md": _pick(sections, "5. 加分表达", "加分表达"),
        },
        "variants": {
            "tree_md": _pick(sections, "6. 题目变体树", "题目变体树"),
        },
        "followups": _parse_followups(follow_raw),
        "extend": _parse_extend(extend_raw),
    }


def _pack_sys_row(row) -> dict:
    return {
        "id": str(row["id"]),
        "question": _strip_stem(row["question"] or ""),
        "topic": row["topic"] or "",
        "direction": row["direction"] or "",
        "source": "sys",
        "tabs": split_depth_md(row["answer_md"] or ""),
    }


def _fetch_ok_rows(path: Path, fetch_limit: int = 50):
    sql = """
        SELECT q.id, q.question, q.direction, q.topic, a.answer_md
        FROM question_depth_answers a
        JOIN interview_questions q ON q.id = a.question_id
        WHERE a.status = 'ok'
        ORDER BY a.generated_at
        LIMIT ?
    """
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    try:
        return con.execute(sql, (fetch_limit,)).fetchall()
    finally:
        con.close()


# UI 二级方向 → interview_questions.direction 精确值（禁止模糊包含匹配）
FEATURED_DIRECTION_MAP = {
    "AI算法与模型研发": ("AI算法与模型研发",),
    "AI应用开发与Agent": ("AI应用开发与Agent",),
    "机器学习": ("机器学习",),
    "计算机视觉": ("计算机视觉",),
    "数据结构与算法": ("数据结构和算法",),
    "数据结构和算法": ("数据结构和算法",),
    "操作系统": ("操作系统",),
    "计算机网络": ("计算机网络",),
    "计算机组成原理": ("计算机组成原理",),
    "前端基础": ("前端",),
    "前端": ("前端",),
    "前端框架": ("Web前端开发",),
    "前端工程化": ("前端工程化专题",),
    "Android": ("安卓原生开发专题",),
    "iOS": ("iOS原生开发专题",),
    "鸿蒙": ("鸿蒙原生开发专题",),
    "Java": ("Java语言及生态", "Java"),
    "Python": ("Python",),
    "Go": ("Go语言及生态专题",),
    "C++": ("C++专题", "C/C++"),
    "数据库": ("关系型数据库",),
    "大数据": ("大数据生态",),
    "数据分析": ("数据分析",),
    "系统设计": ("系统架构设计",),
    "测试开发": ("测试",),
    "质量保障": ("测试理论与基础",),
    "项目经验": ("项目经历与实战复盘",),
    "行为面试": ("行为面试与岗位匹配",),
}


def _featured_directions(l2: str) -> tuple[str, ...]:
    l2 = (l2 or "").strip()
    if not l2:
        return ()
    mapped = FEATURED_DIRECTION_MAP.get(l2)
    if mapped:
        return mapped
    return (l2,)


def list_featured(*, l1: str = "", l2: str = "", limit: int = 100) -> dict:
    """按二级方向精确匹配 interview_questions.direction，只读已解析深度答案。"""
    path = interview_db_path()
    dirs = _featured_directions(l2)
    if not dirs:
        return {"match": "miss", "questions": [], "count": 0, "db": str(path)}
    if not path.is_file():
        return {
            "match": "error",
            "questions": [],
            "count": 0,
            "error": f"系统题库不存在：{path}",
            "db": str(path),
        }

    limit = max(1, min(int(limit or 100), 200))
    placeholders = ",".join("?" * len(dirs))
    sql = f"""
        SELECT q.id, q.question, q.direction, q.topic, a.answer_md
        FROM question_depth_answers a
        JOIN interview_questions q ON q.id = a.question_id
        WHERE a.status = 'ok' AND q.direction IN ({placeholders})
        ORDER BY a.generated_at
        LIMIT ?
    """
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    try:
        rows = con.execute(sql, (*dirs, limit)).fetchall()
    finally:
        con.close()

    allowed = set(dirs)
    questions = [_pack_sys_row(row) for row in rows if (row["direction"] or "") in allowed]
    if not questions:
        return {"match": "miss", "questions": [], "count": 0, "db": str(path), "directions": list(dirs)}
    return {
        "match": "exact",
        "questions": questions,
        "count": len(questions),
        "db": str(path),
        "directions": list(dirs),
    }


def list_sys_questions(*, job_l1: str, job_l2: str, job_l3: str, limit: int = _P0_LIMIT) -> dict:
    """兼容旧岗位匹配：命中 AI 岗则返回已解析系统题。"""
    path = interview_db_path()
    if not job_hits_sys(job_l1, job_l2, job_l3):
        return {"match": "miss", "questions": [], "count": 0, "db": str(path)}
    if not path.is_file():
        return {
            "match": "error",
            "questions": [],
            "count": 0,
            "error": f"系统题库不存在：{path}",
            "db": str(path),
        }
    limit = max(1, min(int(limit or _P0_LIMIT), 30))
    questions = [_pack_sys_row(row) for row in _fetch_ok_rows(path, limit)]
    return {"match": "exact", "questions": questions, "count": len(questions), "db": str(path)}


def generate_depth_md(*, question: str, role: str, resume_text: str) -> str:
    from llm_utils import LLMServiceError, get_llm_model, openai_client, require_llm_config

    if not SKILL_PATH.is_file():
        raise LLMServiceError(f"解析 skill 不存在：{SKILL_PATH}")
    skill = SKILL_PATH.read_text(encoding="utf-8")
    user = (
        "请按系统规定的 Markdown 结构，对下面这道面试题做完整深度解析。"
        "不要省略任何章节，不要包一层代码块。\n\n"
        f"目标岗位：{role or '未指定'}\n"
        "候选人简历（节选，禁止编造简历中没有的事实）：\n"
        f"{(resume_text or '')[:4000]}\n\n"
        f"题目：\n{question}"
    )
    require_llm_config()
    try:
        client = openai_client()
        resp = client.with_options(timeout=DEPTH_TIMEOUT_SEC).chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": skill},
                {"role": "user", "content": user},
            ],
            temperature=0.3,
            max_tokens=8192,
        )
        text = _strip_fence(resp.choices[0].message.content or "")
    except Exception as exc:
        from llm_utils import LLMServiceError as Err

        if isinstance(exc, Err):
            raise
        name = type(exc).__name__
        msg = str(exc)
        if "timeout" in name.lower() or "timeout" in msg.lower() or "timed out" in msg.lower():
            raise Err("生成超时，请重试") from exc
        raise Err(f"生成解析失败：{exc}") from exc
    if DEPTH_MARK not in text:
        raise LLMServiceError("模型未按 8 段结构返回解析")
    return text


def _split_sections(md: str) -> dict[str, str]:
    matches = list(_HEADING_RE.finditer(md))
    out: dict[str, str] = {}
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(md)
        out[m.group(1).strip()] = md[start:end].strip()
    return out


def _pick(sections: dict[str, str], *prefixes: str) -> str:
    for key, val in sections.items():
        for p in prefixes:
            if key == p or key.startswith(p):
                return val
    return ""


def _parse_oral(raw: str) -> list[dict]:
    if not raw.strip():
        return []
    parts: list[dict] = []
    current = None
    buf: list[str] = []
    for line in raw.splitlines():
        hit = None
        for key in _ORAL_KEYS:
            if re.match(rf"^\*\*{re.escape(key)}\*\*", line.strip()):
                hit = key
                rest = re.sub(rf"^\*\*{re.escape(key)}\*\*\s*", "", line.strip())
                break
        if hit:
            if current:
                parts.append({"step": current, "text": "\n".join(buf).strip()})
            current = hit
            buf = [rest] if rest else []
        else:
            buf.append(line)
    if current:
        parts.append({"step": current, "text": "\n".join(buf).strip()})
    if not parts:
        return [{"step": "口述框架", "text": raw.strip()}]
    return parts


def _parse_followups(raw: str) -> list[dict]:
    items = []
    for m in _FOLLOWUP_RE.finditer(raw or ""):
        items.append(
            {
                "question": m.group(1).strip(),
                "intent": m.group(2).strip(),
                "key_points": m.group(3).strip(),
            }
        )
    if items:
        return items[:6]
    if (raw or "").strip():
        return [{"question": "面试官可能的追问", "intent": "", "key_points": raw.strip()}]
    return []


def _parse_extend(raw: str) -> dict:
    out = {"concepts": "", "cases": "", "tradeoffs": "", "learn": "", "body_md": (raw or "").strip()}
    if not raw.strip():
        return out
    found = []
    for field, title in _EXTEND_KEYS:
        m = re.search(rf"[-*]?\s*\*\*{re.escape(title)}\*\*[：:]?\s*", raw)
        if m:
            found.append((m.start(), m.end(), field))
    found.sort()
    for i, (_, end, field) in enumerate(found):
        stop = found[i + 1][0] if i + 1 < len(found) else len(raw)
        out[field] = raw[end:stop].strip()
    return out


def _strip_fence(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n", "", t)
        if t.endswith("```"):
            t = t[: t.rfind("```")].rstrip()
    return t.strip()
