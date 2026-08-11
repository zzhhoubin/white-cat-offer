# -*- coding: utf-8 -*-
"""模块 D：经历优先级、优化方案、ATS、应用确认生成优化简历。"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from jd_match import _llm_json, _str_list
from jd_match.prompts import (
    APPLY_OPTIMIZE_SYSTEM_PROMPT,
    APPLY_OPTIMIZE_USER_TEMPLATE,
    ATS_CHECK_SYSTEM_PROMPT,
    ATS_CHECK_USER_TEMPLATE,
    EXPERIENCE_PRIORITY_SYSTEM_PROMPT,
    EXPERIENCE_PRIORITY_USER_TEMPLATE,
    OPTIMIZATION_PLAN_SYSTEM_PROMPT,
    OPTIMIZATION_PLAN_USER_TEMPLATE,
)

logger = logging.getLogger(__name__)

_TIER_ORDER = {"第一梯队": 0, "第二梯队": 1, "第三梯队": 2, "建议隐藏": 3}


def _extract_experiences(resume_text: str, structured: dict | None) -> list[dict]:
    items: list[dict] = []
    if isinstance(structured, dict):
        for i, e in enumerate(structured.get("experience") or []):
            if not isinstance(e, dict):
                continue
            bullets = e.get("bullets") if isinstance(e.get("bullets"), list) else []
            items.append({
                "id": f"exp-{i}",
                "kind": "experience",
                "company": str(e.get("company") or "").strip(),
                "title": str(e.get("title") or e.get("role") or "").strip(),
                "duration": str(e.get("date") or e.get("duration") or e.get("period") or "").strip(),
                "text": "\n".join(str(b) for b in bullets if str(b).strip()),
            })
        for i, p in enumerate(structured.get("projects") or []):
            if not isinstance(p, dict):
                continue
            parts = []
            for key in ("intro", "responsibilities", "achievements", "bullets"):
                v = p.get(key)
                if isinstance(v, list):
                    parts.extend(str(x) for x in v if str(x).strip())
                elif v:
                    parts.append(str(v))
            items.append({
                "id": f"proj-{i}",
                "kind": "project",
                "company": str(p.get("name") or p.get("project") or "").strip(),
                "title": str(p.get("role") or "项目").strip(),
                "duration": str(p.get("date") or p.get("duration") or "").strip(),
                "text": "\n".join(parts),
            })
    if items:
        return items

    chunks = [c.strip() for c in re.split(r"\n{2,}", resume_text or "") if c.strip()]
    for i, c in enumerate(chunks[:12]):
        items.append({
            "id": f"blk-{i}",
            "kind": "block",
            "company": "",
            "title": c.split("\n", 1)[0][:40],
            "duration": "",
            "text": c[:800],
        })
    return items


def _norm_tiers(raw: dict, experiences: list[dict]) -> dict[str, Any]:
    by_id = {e["id"]: e for e in experiences}
    tiers = []
    for t in raw.get("tiers") or []:
        if not isinstance(t, dict):
            continue
        eid = str(t.get("id") or "").strip()
        src = by_id.get(eid) or {}
        tier = str(t.get("tier") or "第三梯队").strip()
        if tier not in _TIER_ORDER:
            tier = "第三梯队"
        scores = t.get("scores") if isinstance(t.get("scores"), dict) else {}
        tiers.append({
            "id": eid or src.get("id") or f"unk-{len(tiers)}",
            "title": str(t.get("title") or src.get("title") or "").strip(),
            "company": str(t.get("company") or src.get("company") or "").strip(),
            "tier": tier,
            "priority_score": max(0, min(100, int(t.get("priority_score") or 0))),
            "scores": {
                "relevance": int(scores.get("relevance") or 0),
                "achievement_quality": int(scores.get("achievement_quality") or 0),
                "recency": int(scores.get("recency") or 0),
                "level_fit": int(scores.get("level_fit") or 0),
            },
            "reason": str(t.get("reason") or "").strip(),
            "display_advice": str(t.get("display_advice") or "").strip(),
        })
    tiers.sort(key=lambda x: (_TIER_ORDER.get(x["tier"], 9), -x["priority_score"]))
    return {
        "tiers": tiers,
        "summary": str(raw.get("summary") or "").strip(),
    }


def _norm_optimization_plan(raw: dict) -> dict[str, Any]:
    plan = raw.get("optimization_plan") if isinstance(raw.get("optimization_plan"), dict) else raw
    sections = []
    for i, s in enumerate(plan.get("sections") or []):
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or f"sec-{i + 1}").strip()
        change_type = str(s.get("change_type") or "表达优化").strip()
        if change_type not in ("表达优化", "事实补充"):
            change_type = "表达优化"
        conf = s.get("needs_confirmation")
        if not isinstance(conf, list):
            conf = []
        conf = [str(x).strip() for x in conf if str(x).strip()]
        optimized = str(s.get("optimized") or "").strip()
        if not optimized:
            continue
        sections.append({
            "id": sid,
            "section": str(s.get("section") or f"优化项{i + 1}").strip(),
            "change_type": change_type,
            "original": str(s.get("original") or "").strip(),
            "optimized": optimized,
            "reason": str(s.get("reason") or "").strip(),
            "needs_confirmation": conf,
        })
        if len(sections) >= 20:
            break
    return {
        "strategy_summary": str(plan.get("strategy_summary") or "").strip(),
        "sections": sections,
    }


def _norm_ats(raw: dict) -> dict[str, Any]:
    checks = []
    for c in raw.get("checks") or []:
        if not isinstance(c, dict):
            continue
        status = str(c.get("status") or "警告").strip()
        checks.append({
            "item": str(c.get("item") or "").strip(),
            "status": status,
            "detail": str(c.get("detail") or "").strip(),
            "suggestion": str(c.get("suggestion") or "").strip(),
        })
    try:
        score = int(raw.get("ats_score") or 0)
    except (TypeError, ValueError):
        score = 0
    return {"ats_score": max(0, min(100, score)), "checks": checks}


def rank_experiences(
    *,
    jd_parsed: dict,
    analysis: dict,
    resume_text: str,
    structured: dict | None = None,
) -> dict[str, Any]:
    """经历优先级排序（提示词：EXPERIENCE_PRIORITY_*）。"""
    experiences = _extract_experiences(resume_text, structured)
    if not experiences:
        return {"tiers": [], "summary": "未识别到可排序的经历"}

    gaps = analysis.get("skill_gaps") or analysis.get("missing_critical") or []
    overall = analysis.get("overall_score")
    if overall is None:
        overall = analysis.get("score") or 0
    user = EXPERIENCE_PRIORITY_USER_TEMPLATE.format(
        jd_json=json.dumps(jd_parsed or {}, ensure_ascii=False),
        overall_score=overall,
        gaps_json=json.dumps(gaps, ensure_ascii=False),
        experiences_json=json.dumps(experiences, ensure_ascii=False),
    )
    raw = _llm_json(EXPERIENCE_PRIORITY_SYSTEM_PROMPT, user, temperature=0.2, max_tokens=3500)
    return _norm_tiers(raw, experiences)


def build_optimization_plan(
    *,
    jd_parsed: dict,
    analysis: dict,
    tiers: dict,
    resume_text: str,
) -> dict[str, Any]:
    """反向定制优化方案（提示词：OPTIMIZATION_PLAN_*）。"""
    text = (resume_text or "").strip()
    if len(text) > 16000:
        text = text[:16000] + "\n…（已截断）"
    match_summary = {
        "overall_score": analysis.get("overall_score") or analysis.get("score"),
        "score_level": analysis.get("score_level"),
        "summary": analysis.get("summary"),
        "competitive_advantages": analysis.get("competitive_advantages") or [],
        "skill_gaps": analysis.get("skill_gaps") or [],
        "gap_analysis": analysis.get("gap_analysis") or {},
        "hard_gate": analysis.get("hard_gate") or {},
    }
    user = OPTIMIZATION_PLAN_USER_TEMPLATE.format(
        match_summary_json=json.dumps(match_summary, ensure_ascii=False),
        jd_json=json.dumps(jd_parsed or {}, ensure_ascii=False),
        tiers_json=json.dumps(tiers or {}, ensure_ascii=False),
        resume_text=text,
    )
    raw = _llm_json(OPTIMIZATION_PLAN_SYSTEM_PROMPT, user, temperature=0.3, max_tokens=5000)
    return _norm_optimization_plan(raw)


def check_ats(
    *,
    resume_text: str,
    jd_parsed: dict | None = None,
    context: dict | None = None,
) -> dict[str, Any]:
    """ATS 检测（提示词：ATS_CHECK_*）。"""
    text = (resume_text or "").strip()
    if not text:
        raise ValueError("简历内容为空")
    if len(text) > 16000:
        text = text[:16000] + "\n…（已截断）"

    keywords = []
    jd = jd_parsed or {}
    for h in jd.get("hard_requirements") or []:
        if isinstance(h, dict) and h.get("requirement"):
            keywords.append(str(h["requirement"]))
    for c in jd.get("core_competencies") or []:
        if isinstance(c, dict) and c.get("competency"):
            keywords.append(str(c["competency"]))
    for b in jd.get("bonus_requirements") or []:
        if isinstance(b, dict) and b.get("requirement"):
            keywords.append(str(b["requirement"]))

    user = ATS_CHECK_USER_TEMPLATE.format(
        jd_keywords_json=json.dumps(keywords[:40], ensure_ascii=False),
        resume_text=text,
        context_json=json.dumps(context or {}, ensure_ascii=False),
    )
    raw = _llm_json(ATS_CHECK_SYSTEM_PROMPT, user, temperature=0.15, max_tokens=2500)
    return _norm_ats(raw)


def apply_optimization(
    *,
    resume_text: str,
    optimization_plan: dict,
    confirmations: dict[str, str] | None = None,
) -> dict[str, Any]:
    """根据用户确认生成优化版简历（提示词：APPLY_OPTIMIZE_*）。"""
    text = (resume_text or "").strip()
    if not text:
        raise ValueError("简历内容为空")
    if len(text) > 16000:
        text = text[:16000] + "\n…（已截断）"

    plan = optimization_plan if isinstance(optimization_plan, dict) else {}
    sections = plan.get("sections") if isinstance(plan.get("sections"), list) else []
    conf = confirmations if isinstance(confirmations, dict) else {}

    # 过滤：事实补充且 rejected/pending → 不交给模型作为可写入项（仍传但标注）
    norm_conf = {}
    for s in sections:
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or "")
        status = str(conf.get(sid) or "pending").strip().lower()
        if status not in ("accepted", "rejected", "pending"):
            status = "pending"
        # 表达优化默认视为 accepted
        if s.get("change_type") == "表达优化" and status == "pending":
            status = "accepted"
        norm_conf[sid] = status

    user = APPLY_OPTIMIZE_USER_TEMPLATE.format(
        resume_text=text,
        sections_json=json.dumps(sections, ensure_ascii=False),
        confirmations_json=json.dumps(norm_conf, ensure_ascii=False),
    )
    raw = _llm_json(APPLY_OPTIMIZE_SYSTEM_PROMPT, user, temperature=0.25, max_tokens=5500)
    md = str(raw.get("optimized_resume_md") or "").strip()
    change_log = []
    for c in raw.get("change_log") or []:
        if not isinstance(c, dict):
            continue
        change_log.append({
            "section": str(c.get("section") or "").strip(),
            "before": str(c.get("before") or "").strip(),
            "after": str(c.get("after") or "").strip(),
            "note": str(c.get("note") or "").strip(),
        })
    if not md:
        raise ValueError("未生成优化版简历")
    return {
        "optimized_resume_md": md,
        "change_log": change_log,
        "confirmations_applied": norm_conf,
    }


def run_reconstruct(
    *,
    resume_text: str,
    analysis: dict,
    structured: dict | None = None,
    context: dict | None = None,
) -> dict[str, Any]:
    """
    二期一键：经历优先级 → 优化方案 → ATS。
    提示词均在 prompts.py 显式定义。
    """
    text = (resume_text or "").strip()
    if not text:
        raise ValueError("简历内容为空")
    jd_parsed = analysis.get("jd_parsed") if isinstance(analysis.get("jd_parsed"), dict) else {}
    if not jd_parsed:
        raise ValueError("缺少 JD 解析结果，请先完成岗位匹配分析")

    tiers = rank_experiences(
        jd_parsed=jd_parsed,
        analysis=analysis,
        resume_text=text,
        structured=structured,
    )
    optimization_plan = build_optimization_plan(
        jd_parsed=jd_parsed,
        analysis=analysis,
        tiers=tiers,
        resume_text=text,
    )
    ats = check_ats(resume_text=text, jd_parsed=jd_parsed, context=context)
    return {
        "experience_priority": tiers,
        "optimization_plan": optimization_plan,
        "ats": ats,
    }
