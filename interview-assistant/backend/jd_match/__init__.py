# -*- coding: utf-8 -*-
"""岗位匹配分析流水线：A JD解析 → B 简历画像 → C 匹配引擎。"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from llm_utils import get_llm_model, openai_client, require_llm_config

from jd_match.prompts import (
    DIM_LABELS,
    JD_PARSE_SYSTEM_PROMPT,
    JD_PARSE_USER_TEMPLATE,
    MATCH_ENGINE_SYSTEM_PROMPT,
    MATCH_ENGINE_USER_TEMPLATE,
    RESUME_PROFILE_SYSTEM_PROMPT,
    RESUME_PROFILE_USER_TEMPLATE,
    WEIGHTS_JUNIOR,
    WEIGHTS_SENIOR,
)

logger = logging.getLogger(__name__)

DIM_KEYS = list(DIM_LABELS.keys())


def _safe_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                data = json.loads(m.group(0))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass
    raise ValueError("模型返回非 JSON")


def _clip(v: Any, lo: int = 0, hi: int = 100) -> int:
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        n = 0
    return max(lo, min(hi, n))


def _llm_json(system: str, user: str, *, temperature: float = 0.2, max_tokens: int = 4500) -> dict:
    """调用大模型并解析 JSON；system/user 必须为调用方显式传入的提示词。"""
    require_llm_config()
    client = openai_client()
    resp = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    return _safe_json(resp.choices[0].message.content or "{}")


def _str_list(v: Any, limit: int = 12) -> list[str]:
    if not isinstance(v, list):
        return []
    out = []
    for x in v:
        s = str(x).strip() if x is not None else ""
        if s:
            out.append(s)
        if len(out) >= limit:
            break
    return out


# ---- B：从现有 structured 派生画像（无 LLM）----

def build_resume_profile_from_structured(structured: dict | None) -> dict[str, Any] | None:
    if not isinstance(structured, dict):
        return None
    basics = structured.get("basics") if isinstance(structured.get("basics"), dict) else {}
    education = structured.get("education") if isinstance(structured.get("education"), list) else []
    experience = structured.get("experience") if isinstance(structured.get("experience"), list) else []
    projects = structured.get("projects") if isinstance(structured.get("projects"), list) else []
    skills = structured.get("skills") if isinstance(structured.get("skills"), list) else []
    summary = structured.get("summary") if isinstance(structured.get("summary"), dict) else {}

    edu0 = education[0] if education and isinstance(education[0], dict) else {}
    hard_skills = []
    for s in skills:
        if isinstance(s, str) and s.strip():
            hard_skills.append({"name": s.strip(), "level": "了解", "evidence": "技能列表"})
        elif isinstance(s, dict):
            name = str(s.get("name") or s.get("skill") or "").strip()
            if name:
                hard_skills.append({
                    "name": name,
                    "level": str(s.get("level") or "了解").strip() or "了解",
                    "evidence": "技能列表",
                })

    timeline = []
    for e in experience:
        if not isinstance(e, dict):
            continue
        bullets = e.get("bullets") if isinstance(e.get("bullets"), list) else []
        bullets = [str(b).strip() for b in bullets if str(b).strip()]
        timeline.append({
            "company": str(e.get("company") or "").strip(),
            "title": str(e.get("title") or e.get("role") or "").strip(),
            "duration": str(e.get("date") or e.get("duration") or e.get("period") or "").strip(),
            "responsibilities": bullets,
            "achievements": [],
            "tools_used": [],
            "role_weight": "未知",
        })
    for p in projects:
        if not isinstance(p, dict):
            continue
        resp = p.get("responsibilities") if isinstance(p.get("responsibilities"), list) else []
        ach = p.get("achievements") if isinstance(p.get("achievements"), list) else []
        bullets = p.get("bullets") if isinstance(p.get("bullets"), list) else []
        timeline.append({
            "company": str(p.get("name") or p.get("project") or "项目").strip(),
            "title": str(p.get("role") or "项目经历").strip(),
            "duration": str(p.get("date") or p.get("duration") or "").strip(),
            "responsibilities": [str(x).strip() for x in (resp or bullets) if str(x).strip()],
            "achievements": [str(x).strip() for x in ach if str(x).strip()],
            "tools_used": [],
            "role_weight": "未知",
        })

    if not timeline and not hard_skills and not (basics.get("name") or "").strip():
        return None

    # 粗算能力分（确定性启发，供匹配引擎参考；最终以匹配 LLM 为准）
    n_exp = len(experience)
    n_proj = len(projects)
    n_skill = len(hard_skills)
    has_metrics = any(re.search(r"\d", b) for e in experience if isinstance(e, dict) for b in (e.get("bullets") or []))
    cap = {
        "dimensions": [
            {"name": "专业技能", "score": min(90, 40 + n_skill * 5)},
            {"name": "行业经验", "score": min(85, 35 + n_exp * 12)},
            {"name": "项目成果", "score": min(90, 40 + n_proj * 10 + (15 if has_metrics else 0))},
            {"name": "管理能力", "score": 45},
            {"name": "学习能力", "score": 60},
            {"name": "沟通协作", "score": 55},
        ]
    }

    issues = []
    if n_exp == 0 and n_proj == 0:
        issues.append({"type": "数据缺失", "description": "缺少工作/项目经历"})
    if not has_metrics and (n_exp or n_proj):
        issues.append({"type": "数据缺失", "description": "经历描述中量化成果偏少"})

    return {
        "personal_info": {
            "name": str(basics.get("name") or "").strip(),
            "years_of_experience": 0,
            "education": {
                "degree": str(edu0.get("degree") or "").strip(),
                "major": str(edu0.get("major") or "").strip(),
                "school": str(edu0.get("school") or "").strip(),
            },
        },
        "career_timeline": timeline,
        "skill_inventory": {
            "hard_skills": hard_skills[:40],
            "soft_skills": [],
        },
        "achievement_data": [],
        "potential_issues": issues,
        "capability_profile": cap,
        "summary_bullets": list(summary.get("bullets") or [])[:8] if isinstance(summary, dict) else [],
        "source": "structured",
    }


def parse_jd(jd_text: str) -> dict[str, Any]:
    """模块 A：JD 解析 + 风险筛查（LLM，提示词见 prompts.JD_PARSE_*）。"""
    jd = (jd_text or "").strip()
    if not jd:
        raise ValueError("JD 内容为空")
    if len(jd) > 12000:
        jd = jd[:12000] + "\n…（已截断）"
    user = JD_PARSE_USER_TEMPLATE.format(jd_text=jd)
    # 提示词显式传入：JD_PARSE_SYSTEM_PROMPT / JD_PARSE_USER_TEMPLATE
    raw = _llm_json(JD_PARSE_SYSTEM_PROMPT, user, temperature=0.15, max_tokens=4000)
    return _norm_jd(raw)


def build_resume_profile(resume_text: str, structured: dict | None = None) -> dict[str, Any]:
    """模块 B：优先 structured 派生；否则 LLM（提示词见 prompts.RESUME_PROFILE_*）。"""
    from_struct = build_resume_profile_from_structured(structured)
    if from_struct:
        return from_struct

    text = (resume_text or "").strip()
    if not text:
        raise ValueError("简历内容为空")
    if len(text) > 18000:
        text = text[:18000] + "\n…（已截断）"
    user = RESUME_PROFILE_USER_TEMPLATE.format(resume_text=text)
    raw = _llm_json(RESUME_PROFILE_SYSTEM_PROMPT, user, temperature=0.15, max_tokens=4000)
    raw["source"] = "llm"
    return raw


def _resolve_level_band(jd: dict) -> str:
    basic = jd.get("basic_info") if isinstance(jd.get("basic_info"), dict) else {}
    level = str(basic.get("level") or "").strip()
    if any(k in level for k in ("高级", "资深", "专家", "管理", "总监", "经理", "Lead", "Senior")):
        return "高级"
    if any(k in level for k in ("初级", "实习", "应届", "Junior", "助理")):
        return "初级"
    # 默认按高级权重中的「经验向」与初级折中：年限要求高则高级
    for h in jd.get("hard_requirements") or []:
        if not isinstance(h, dict):
            continue
        req = str(h.get("requirement") or "")
        if re.search(r"[5-9]\s*年|[1-9]\d\s*年", req):
            return "高级"
    return "初级"


def _norm_jd(raw: dict) -> dict[str, Any]:
    basic = raw.get("basic_info") if isinstance(raw.get("basic_info"), dict) else {}
    risks = []
    for r in raw.get("risks") or []:
        if not isinstance(r, dict):
            continue
        risks.append({
            "type": str(r.get("type") or "内容风险").strip(),
            "level": str(r.get("level") or "中").strip(),
            "description": str(r.get("description") or "").strip(),
            "suggestion": str(r.get("suggestion") or "").strip(),
        })
    return {
        "basic_info": {
            "job_title": str(basic.get("job_title") or "").strip(),
            "company": str(basic.get("company") or "").strip(),
            "industry": str(basic.get("industry") or "").strip(),
            "level": str(basic.get("level") or "未知").strip(),
            "location": str(basic.get("location") or "").strip(),
            "work_type": str(basic.get("work_type") or "").strip(),
            "salary_range": str(basic.get("salary_range") or "").strip(),
        },
        "hard_requirements": [x for x in (raw.get("hard_requirements") or []) if isinstance(x, dict)],
        "bonus_requirements": [x for x in (raw.get("bonus_requirements") or []) if isinstance(x, dict)],
        "core_competencies": [x for x in (raw.get("core_competencies") or []) if isinstance(x, dict)],
        "implicit_requirements": [x for x in (raw.get("implicit_requirements") or []) if isinstance(x, dict)],
        "culture_signals": raw.get("culture_signals") if isinstance(raw.get("culture_signals"), dict) else {},
        "risks": risks,
    }


def _norm_match(raw: dict, weights: dict[str, float], level_band: str) -> dict[str, Any]:
    dims_in = raw.get("dimension_scores") if isinstance(raw.get("dimension_scores"), dict) else {}
    dimension_scores: dict[str, Any] = {}
    weighted_sum = 0.0
    dimensions_list = []

    for key in DIM_KEYS:
        w = float(weights[key])
        src = dims_in.get(key) if isinstance(dims_in.get(key), dict) else {}
        score = _clip(src.get("score"))
        weighted = round(score * w, 1)
        weighted_sum += weighted
        dimension_scores[key] = {
            "score": score,
            "weight": w,
            "weighted": weighted,
            "detail": str(src.get("detail") or "").strip(),
            "label": DIM_LABELS[key],
        }
        dimensions_list.append({
            "id": key,
            "name": DIM_LABELS[key],
            "score": score,
            "weight": int(round(w * 100)),
            "weighted": weighted,
            "detail": dimension_scores[key]["detail"],
            "highlights": [],
            "gaps": [],
            "suggestions": [],
        })

    overall = _clip(raw.get("overall_score") if raw.get("overall_score") is not None else round(weighted_sum))
    # 以服务端重算为准
    overall = _clip(round(weighted_sum))

    score_level = str(raw.get("score_level") or "").strip()
    if not score_level:
        if overall >= 80:
            score_level = "较高匹配"
        elif overall >= 60:
            score_level = "中等匹配"
        elif overall >= 40:
            score_level = "较低匹配"
        else:
            score_level = "高风险不匹配"

    hard_gate = raw.get("hard_gate") if isinstance(raw.get("hard_gate"), dict) else {}
    culture = raw.get("culture_fit_detail") if isinstance(raw.get("culture_fit_detail"), dict) else {}

    gap = raw.get("gap_analysis") if isinstance(raw.get("gap_analysis"), dict) else {}
    critical = [x for x in (gap.get("critical_gaps") or []) if isinstance(x, dict)][:8]
    minor = [x for x in (gap.get("minor_gaps") or []) if isinstance(x, dict)][:8]

    # 兼容旧前端字段
    grade = "A" if overall >= 75 else "B" if overall >= 50 else "C"

    return {
        "schema_version": 2,
        "overall_score": overall,
        "score": overall,  # 兼容旧字段
        "score_level": score_level,
        "grade": grade,
        "level_band": level_band,
        "summary": str(raw.get("summary") or "").strip(),
        "dimension_scores": dimension_scores,
        "dimensions": dimensions_list,  # 兼容旧 ResultView
        "competitive_advantages": _str_list(raw.get("competitive_advantages"), 8),
        "skill_gaps": _str_list(raw.get("skill_gaps"), 8),
        "gap_analysis": {
            "critical_gaps": critical,
            "minor_gaps": minor,
        },
        "culture_fit_detail": culture,
        "hard_gate": {
            "passed": bool(hard_gate.get("passed", True)),
            "high_risk": bool(hard_gate.get("high_risk", False)),
            "notes": _str_list(hard_gate.get("notes"), 8),
        },
        # 旧字段占位，避免前端崩
        "missing_critical": [str(x.get("gap") or "") for x in critical if x.get("gap")],
        "extra_strengths": _str_list(raw.get("competitive_advantages"), 8),
        "optimizations": [],
    }


def run_match(jd: dict, resume_profile: dict) -> dict[str, Any]:
    """模块 C：匹配引擎（LLM，提示词见 prompts.MATCH_ENGINE_*）。"""
    level_band = _resolve_level_band(jd)
    weights = WEIGHTS_SENIOR if level_band == "高级" else WEIGHTS_JUNIOR
    user = MATCH_ENGINE_USER_TEMPLATE.format(
        level_band=level_band,
        weights_json=json.dumps(weights, ensure_ascii=False),
        jd_json=json.dumps(jd, ensure_ascii=False),
        resume_profile_json=json.dumps(resume_profile, ensure_ascii=False),
    )
    raw = _llm_json(MATCH_ENGINE_SYSTEM_PROMPT, user, temperature=0.25, max_tokens=4500)
    return _norm_match(raw, weights, level_band)


def analyze_jd_match(
    *,
    resume_text: str,
    jd_text: str,
    structured: dict | None = None,
) -> dict[str, Any]:
    """
    完整一期流水线：
    A. JD 解析+风险（LLM + JD_PARSE_* 提示词）
    B. 简历画像（structured 优先，否则 LLM + RESUME_PROFILE_*）
    C. 多维匹配（LLM + MATCH_ENGINE_*）
    """
    jd = parse_jd(jd_text)
    profile = build_resume_profile(resume_text, structured)
    match = run_match(jd, profile)
    return {
        **match,
        "jd_parsed": jd,
        "resume_profile": {
            "source": profile.get("source"),
            "capability_profile": profile.get("capability_profile"),
            "potential_issues": profile.get("potential_issues") or [],
            "personal_info": profile.get("personal_info") or {},
        },
    }
