"""简历书写质量评分（整包 skill 量规 → LLM JSON）。"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from llm_utils import get_llm_model, openai_client, require_llm_config

logger = logging.getLogger(__name__)

_DIR = Path(__file__).resolve().parent

DIM_SPECS: list[dict[str, Any]] = [
    {"id": "structure", "label": "结构与格式", "max": 15},
    {"id": "completeness", "label": "信息完整度", "max": 15},
    {"id": "expression", "label": "表达质量", "max": 20},
    {"id": "quantification", "label": "量化与证据", "max": 20},
    {"id": "credibility", "label": "专业可信度", "max": 15},
    {"id": "differentiation", "label": "差异化亮点", "max": 15},
]

DIM_IDS = [d["id"] for d in DIM_SPECS]
DIM_MAX = {d["id"]: d["max"] for d in DIM_SPECS}

# 旧五维 / 中文名 / 别名 → 新六维（LLM 常仍返回旧 key 或中文）
_DIM_ALIASES: dict[str, str] = {
    "structure": "structure",
    "completeness": "completeness",
    "expression": "expression",
    "quantification": "quantification",
    "credibility": "credibility",
    "differentiation": "differentiation",
    # 旧五维
    "impact": "quantification",
    "conciseness": "expression",
    "ats": "structure",
    "language": "expression",
    # 中文
    "结构与格式": "structure",
    "结构格式": "structure",
    "信息完整度": "completeness",
    "完整度": "completeness",
    "表达质量": "expression",
    "量化与证据": "quantification",
    "量化证据": "quantification",
    "影响力表达": "quantification",
    "专业可信度": "credibility",
    "可信度": "credibility",
    "差异化亮点": "differentiation",
    "差异化与亮点": "differentiation",
    "简洁度": "expression",
    "ats友好度": "structure",
    "ATS友好度": "structure",
    "语言质量": "expression",
}

_GRADE_TABLE = [
    (90, "优秀", "elite"),
    (75, "良好", "strong"),
    (60, "合格", "proficient"),
    (40, "待改进", "developing"),
    (0, "不合格", "needs_work"),
]


def _read_text(name: str) -> str:
    path = _DIR / name
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("resume_quality missing %s: %s", name, exc)
        return ""


def _build_system_prompt() -> str:
    parts = [
        _read_text("SKILL_PROMPT.md"),
        "\n\n---\n# scoring-rubric.md\n\n",
        _read_text("scoring-rubric.md"),
        "\n\n---\n# dimension-guide.md\n\n",
        _read_text("dimension-guide.md"),
        "\n\n---\n# report_schema.md\n\n",
        _read_text("report_schema.md"),
        "\n\n---\n# score-report-template.md（信息完备性参考）\n\n",
        _read_text("score-report-template.md"),
    ]
    return "".join(parts)


def extract_scoring_context(structured: dict | None) -> dict[str, str]:
    """从解析结果抽取可选上下文；缺失字段不返回。"""
    if not isinstance(structured, dict):
        return {}
    basics = structured.get("basics") if isinstance(structured.get("basics"), dict) else {}
    extras = structured.get("extras") if isinstance(structured.get("extras"), dict) else {}

    def pick(*vals: Any) -> str:
        for v in vals:
            if v is None:
                continue
            s = str(v).strip()
            if s:
                return s
        return ""

    ctx: dict[str, str] = {}
    target_role = pick(basics.get("target_role"), basics.get("intention"), extras.get("target_role"))
    if target_role:
        ctx["target_role"] = target_role

    level = pick(
        basics.get("level"),
        basics.get("seniority"),
        basics.get("job_level"),
        basics.get("_educationLevel"),
        basics.get("education_level"),
        extras.get("level"),
        extras.get("seniority"),
        extras.get("job_level"),
    )
    if level:
        ctx["level"] = level

    industry = pick(basics.get("industry"), extras.get("industry"))
    if industry:
        ctx["industry"] = industry

    city = pick(basics.get("city"))
    if city:
        ctx["city"] = city

    exp = structured.get("experience") if isinstance(structured.get("experience"), list) else []
    titles = []
    for e in exp[:3]:
        if not isinstance(e, dict):
            continue
        t = pick(e.get("title"), e.get("role"), e.get("position"))
        if t:
            titles.append(t)
    if titles:
        ctx["recent_titles"] = "、".join(titles)

    if exp:
        ctx["experience_count"] = str(len(exp))
    projects = structured.get("projects") if isinstance(structured.get("projects"), list) else []
    if projects:
        ctx["project_count"] = str(len(projects))

    return ctx


def _grade_for(total: int) -> tuple[str, str]:
    for threshold, label, key in _GRADE_TABLE:
        if total >= threshold:
            return label, key
    return "不合格", "needs_work"


def _clip_int(v: Any, lo: int, hi: int) -> int:
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        n = 0
    return max(lo, min(hi, n))


def _score_to_max(raw_score: Any, mx: int) -> int:
    """将模型分数压到 0–mx。若明显是百分制（>mx），按 score/100*mx 折算。"""
    try:
        n = float(raw_score)
    except (TypeError, ValueError):
        return 0
    if n < 0:
        return 0
    if n <= mx:
        return int(round(n))
    # 百分制或误把 0–100 写进满分 15/20 的维
    if n <= 100:
        return int(round(n / 100.0 * mx))
    return mx


def _as_str_list(v: Any, limit: int = 8) -> list[str]:
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for x in v:
        s = str(x).strip() if x is not None else ""
        if s:
            out.append(s)
        if len(out) >= limit:
            break
    return out


def _coerce_dimensions_map(raw_dims: Any) -> dict[str, Any]:
    """把 LLM 各种 dimensions 形态收成 {canonical_id: src}。"""
    out: dict[str, Any] = {}
    if isinstance(raw_dims, dict):
        items = raw_dims.items()
    elif isinstance(raw_dims, list):
        items = []
        for it in raw_dims:
            if not isinstance(it, dict):
                continue
            key = it.get("id") or it.get("key") or it.get("name") or it.get("label") or it.get("dimension")
            items.append((key, it))
    else:
        return out

    for key, val in items:
        if key is None:
            continue
        kid = str(key).strip()
        canonical = _DIM_ALIASES.get(kid) or _DIM_ALIASES.get(kid.lower())
        if not canonical:
            continue
        # 同一 canonical 多次出现时：保留已有非空分数，避免旧别名覆盖新 key
        if canonical in out and isinstance(out[canonical], dict):
            prev = out[canonical].get("score")
            new_score = val.get("score") if isinstance(val, dict) else val
            try:
                if prev is not None and float(prev) > 0 and (new_score is None or float(new_score or 0) == 0):
                    continue
            except (TypeError, ValueError):
                pass
        out[canonical] = val
    return out


def normalize_quality_report(raw: dict | None) -> dict[str, Any]:
    """规范化报告并服务端重算 base/total。"""
    raw = raw if isinstance(raw, dict) else {}
    dims_in = _coerce_dimensions_map(raw.get("dimensions"))
    dimensions: dict[str, Any] = {}
    scores: list[int] = []

    for spec in DIM_SPECS:
        did = spec["id"]
        mx = spec["max"]
        src = dims_in.get(did)
        if isinstance(src, dict):
            score = _score_to_max(src.get("score", src.get("points", src.get("value"))), mx)
            evidence = _as_str_list(src.get("evidence"))
            suggestions = _as_str_list(src.get("suggestions"))
            level = str(src.get("level") or "").strip()
        else:
            # 兼容扁平数字
            score = _score_to_max(src, mx)
            evidence, suggestions, level = [], [], ""
        if not level:
            # 粗映射到等级文案
            ratio = score / mx if mx else 0
            if ratio >= 0.85:
                level = "优秀"
            elif ratio >= 0.65:
                level = "良好"
            elif ratio >= 0.45:
                level = "合格"
            elif ratio >= 0.25:
                level = "待改进"
            else:
                level = "不合格"
        dimensions[did] = {
            "score": score,
            "max": mx,
            "level": level,
            "evidence": evidence,
            "suggestions": suggestions,
        }
        scores.append(score)

    base = sum(scores)

    bonus_items = []
    for it in raw.get("bonus_items") or []:
        if not isinstance(it, dict):
            continue
        pts = _clip_int(it.get("points"), 0, 10)
        name = str(it.get("name") or "").strip()
        if name and pts:
            bonus_items.append({
                "name": name,
                "points": pts,
                "evidence": str(it.get("evidence") or "").strip(),
            })
    penalty_items = []
    for it in raw.get("penalty_items") or []:
        if not isinstance(it, dict):
            continue
        pts = _clip_int(it.get("points"), 0, 10)
        name = str(it.get("name") or "").strip()
        if name and pts:
            penalty_items.append({
                "name": name,
                "points": pts,
                "evidence": str(it.get("evidence") or "").strip(),
            })

    bonus = _clip_int(raw.get("bonus"), 0, 10)
    if bonus_items:
        bonus = min(10, sum(i["points"] for i in bonus_items))
    penalty = _clip_int(raw.get("penalty"), 0, 10)
    if penalty_items:
        penalty = min(10, sum(i["points"] for i in penalty_items))

    total = max(0, min(110, base + bonus - penalty))
    grade, grade_key = _grade_for(total)

    improvements = []
    for it in raw.get("top_improvements") or []:
        if isinstance(it, str) and it.strip():
            improvements.append({
                "title": it.strip(),
                "impact": "中",
                "before": "",
                "after": "",
                "detail": "",
            })
        elif isinstance(it, dict):
            improvements.append({
                "title": str(it.get("title") or "").strip(),
                "impact": str(it.get("impact") or "中").strip() or "中",
                "before": str(it.get("before") or "").strip(),
                "after": str(it.get("after") or "").strip(),
                "detail": str(it.get("detail") or "").strip(),
            })
        if len(improvements) >= 25:
            break

    radar = scores
    if isinstance(raw.get("radar"), list) and len(raw["radar"]) == 6:
        try:
            radar = [_clip_int(raw["radar"][i], 0, DIM_SPECS[i]["max"]) for i in range(6)]
        except Exception:
            radar = scores

    summary = str(raw.get("summary") or "").strip()
    return {
        "total": total,
        "base": base,
        "bonus": bonus,
        "penalty": penalty,
        "grade": grade,
        "grade_key": grade_key,
        "dimensions": dimensions,
        "bonus_items": bonus_items,
        "penalty_items": penalty_items,
        "top_strengths": _as_str_list(raw.get("top_strengths"), 3),
        "top_improvements": improvements,
        "action_items": _as_str_list(raw.get("action_items"), 12),
        "summary": summary,
        "radar": radar,
    }


def quality_report_to_score_detail(report: dict[str, Any]) -> dict[str, Any]:
    """派生列表/旧面板用的 score_detail（总分 0–110，维度为各维得分）。"""
    dims = report.get("dimensions") or {}
    flat: dict[str, int] = {}
    for did in DIM_IDS:
        src = dims.get(did)
        mx = DIM_MAX[did]
        if isinstance(src, dict):
            flat[did] = _score_to_max(src.get("score"), mx)
        else:
            flat[did] = _score_to_max(src, mx)
    return {
        "total": _clip_int(report.get("total"), 0, 110),
        "base": _clip_int(report.get("base"), 0, 100),
        "bonus": _clip_int(report.get("bonus"), 0, 10),
        "penalty": _clip_int(report.get("penalty"), 0, 10),
        "grade": str(report.get("grade") or ""),
        "dimensions": flat,
        "summary": str(report.get("summary") or ""),
    }


def empty_quality_report(summary: str = "") -> dict[str, Any]:
    dims = {
        d["id"]: {"score": 0, "max": d["max"], "level": "不合格", "evidence": [], "suggestions": []}
        for d in DIM_SPECS
    }
    return {
        "total": 0,
        "base": 0,
        "bonus": 0,
        "penalty": 0,
        "grade": "不合格",
        "grade_key": "needs_work",
        "dimensions": dims,
        "bonus_items": [],
        "penalty_items": [],
        "top_strengths": [],
        "top_improvements": [],
        "action_items": [],
        "summary": summary,
        "radar": [0] * 6,
    }


def score_resume_content(plain_text: str, structured: dict | None = None) -> dict[str, Any]:
    """
    调 LLM 按 skill 量规评分。
    返回 quality_report；同时兼容调用方取 score_detail 字段时使用 quality_report_to_score_detail。
    为保持 app.py 简单，本函数返回 score_detail 形状，并把完整报告放在 quality_report 键？
    —— 改为返回完整 report，由调用方写入 structured.quality_report 与 score_detail。
    """
    text = (plain_text or "").strip()[:12000]
    if len(text) < 40:
        return empty_quality_report("简历内容过短，无法评分")

    require_llm_config()
    client = openai_client()
    ctx = extract_scoring_context(structured)
    ctx_lines = []
    label_map = {
        "target_role": "求职意向",
        "level": "职级/资历",
        "industry": "行业",
        "city": "城市",
        "recent_titles": "近期职位",
        "experience_count": "工作经历条数",
        "project_count": "项目经历条数",
    }
    for k, v in ctx.items():
        ctx_lines.append(f"- {label_map.get(k, k)}：{v}")
    ctx_block = "\n".join(ctx_lines) if ctx_lines else "（解析结果未提供求职意向/职级等字段，按通用标准评分）"

    user_msg = (
        "请对以下简历进行六维度书写质量评分。\n\n"
        "【硬性约束】\n"
        "1. dimensions 必须且仅含这 6 个英文 key：structure, completeness, expression, "
        "quantification, credibility, differentiation（禁止用中文名，禁止用 impact/ats/language 等旧 key）。\n"
        "2. 各维 score 必须是「得分」不是百分制：structure/completeness/credibility/differentiation "
        "为 0–15；expression/quantification 为 0–20。禁止出现 90/100 这类超出该维满分的 score。\n"
        "3. 六维都要打分，不能只填 completeness。\n"
        "4. top_improvements 至少 10 条、最多 25 条；按影响高→中→低排序；"
        "每条尽量含 title、impact、before（原文）、after（改写）、detail。\n"
        "5. 只输出一个 JSON 对象，字段见 report_schema。\n\n"
        f"## 解析上下文（仅供参考，缺失已忽略）\n{ctx_block}\n\n"
        f"## 简历正文\n{text}"
    )

    try:
        system_prompt = _build_system_prompt()
        system_prompt += (
            "\n\n---\n# 输出硬约束（必须遵守）\n"
            "- dimensions 六键：structure(0-15), completeness(0-15), expression(0-20), "
            "quantification(0-20), credibility(0-15), differentiation(0-15)。\n"
            "- score 不得超过该维 max；不要输出 0-100 百分制维分。\n"
            "- 禁止旧五维 key：impact/conciseness/ats/language。\n"
            "- top_improvements：至少 10 条、最多 25 条，覆盖表达/量化/结构/可信/亮点等多类问题。\n"
        )
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw_content = resp.choices[0].message.content or "{}"
        data = json.loads(raw_content)
        report = normalize_quality_report(data)
        # 便于排查：原始维分若曾超满分，规范化后会折算
        raw_dims = data.get("dimensions") if isinstance(data.get("dimensions"), dict) else {}
        if raw_dims:
            logger.info(
                "resume quality raw dim keys=%s normalized=%s",
                list(raw_dims.keys()),
                {k: report["dimensions"][k]["score"] for k in DIM_IDS},
            )
        return report
    except Exception as exc:
        logger.warning("resume quality score failed: %s", exc)
        return empty_quality_report("评分服务暂不可用")
