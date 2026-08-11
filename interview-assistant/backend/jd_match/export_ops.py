# -*- coding: utf-8 -*-
"""模块 E / A 增强：JD URL 抓取、衍生物料、分析报告导出。"""

from __future__ import annotations

import json
import logging
import re
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from jd_match import _llm_json, _str_list
from jd_match.prompts import (
    JD_URL_EXTRACT_SYSTEM_PROMPT,
    JD_URL_EXTRACT_USER_TEMPLATE,
    MATERIALS_SYSTEM_PROMPT,
    MATERIALS_USER_TEMPLATE,
)

logger = logging.getLogger(__name__)


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript") and self._skip > 0:
            self._skip -= 1

    def handle_data(self, data):
        if self._skip:
            return
        t = (data or "").strip()
        if t:
            self._chunks.append(t)

    def text(self) -> str:
        return "\n".join(self._chunks)


def fetch_url_text(url: str, *, timeout: int = 20) -> str:
    """抓取 URL 并提取可见文本（stdlib，无额外依赖）。"""
    u = (url or "").strip()
    if not u:
        raise ValueError("URL 为空")
    if not re.match(r"^https?://", u, re.I):
        raise ValueError("仅支持 http/https 链接")
    req = Request(
        u,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; WhiteCatJobMatch/1.0; +local)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            charset = "utf-8"
            ctype = resp.headers.get_content_charset()
            if ctype:
                charset = ctype
            html = raw.decode(charset, errors="ignore")
    except HTTPError as e:
        raise ValueError(f"抓取失败 HTTP {e.code}") from e
    except URLError as e:
        raise ValueError(f"抓取失败：{e.reason}") from e
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"抓取失败：{e}") from e

    parser = _HTMLTextExtractor()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        # 回退：粗暴去标签
        text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", html)
        text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text[:50000]

    text = parser.text()
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:50000]


def fetch_jd_from_url(url: str) -> dict[str, Any]:
    """
    A 增强：URL → 原始文本 → LLM 清洗为 JD 正文。
    提示词：JD_URL_EXTRACT_*
    """
    raw = fetch_url_text(url)
    if len(raw) < 40:
        raise ValueError("页面文本过少，无法提取 JD")
    # 控制送入模型长度
    raw_for_llm = raw if len(raw) <= 20000 else raw[:20000] + "\n…（已截断）"
    user = JD_URL_EXTRACT_USER_TEMPLATE.format(url=url.strip(), raw_text=raw_for_llm)
    data = _llm_json(JD_URL_EXTRACT_SYSTEM_PROMPT, user, temperature=0.1, max_tokens=4000)
    jd_text = str(data.get("jd_text") or "").strip()
    if not jd_text:
        raise ValueError(str(data.get("notes") or "未能从链接提取有效 JD"))
    return {
        "jd_text": jd_text,
        "job_title": str(data.get("job_title") or "").strip(),
        "company": str(data.get("company") or "").strip(),
        "notes": str(data.get("notes") or "").strip(),
        "source_url": url.strip(),
    }


def generate_materials(
    *,
    resume_text: str,
    analysis: dict,
) -> dict[str, Any]:
    """衍生物料 + 求职信要点（提示词：MATERIALS_*）。"""
    text = (resume_text or "").strip()
    if not text:
        raise ValueError("简历内容为空")
    if len(text) > 14000:
        text = text[:14000] + "\n…（已截断）"

    jd = analysis.get("jd_parsed") if isinstance(analysis.get("jd_parsed"), dict) else {}
    basic = jd.get("basic_info") if isinstance(jd.get("basic_info"), dict) else {}
    match_summary = {
        "overall_score": analysis.get("overall_score") or analysis.get("score"),
        "score_level": analysis.get("score_level"),
        "summary": analysis.get("summary"),
        "competitive_advantages": analysis.get("competitive_advantages") or [],
        "skill_gaps": analysis.get("skill_gaps") or [],
        "gap_analysis": analysis.get("gap_analysis") or {},
        "hard_gate": analysis.get("hard_gate") or {},
    }
    jd_summary = {
        "basic_info": basic,
        "hard_requirements": (jd.get("hard_requirements") or [])[:8],
        "core_competencies": (jd.get("core_competencies") or [])[:8],
        "salary_range": basic.get("salary_range"),
        "risks": (jd.get("risks") or [])[:5],
    }
    user = MATERIALS_USER_TEMPLATE.format(
        match_summary_json=json.dumps(match_summary, ensure_ascii=False),
        jd_summary_json=json.dumps(jd_summary, ensure_ascii=False),
        resume_text=text,
    )
    raw = _llm_json(MATERIALS_SYSTEM_PROMPT, user, temperature=0.35, max_tokens=5000)
    return _norm_materials(raw)


def _norm_materials(raw: dict) -> dict[str, Any]:
    guide = raw.get("cover_letter_guide") if isinstance(raw.get("cover_letter_guide"), dict) else {}
    structure = []
    for s in guide.get("structure") or []:
        if not isinstance(s, dict):
            continue
        structure.append({
            "section": str(s.get("section") or "").strip(),
            "point": str(s.get("point") or "").strip(),
            "template": str(s.get("template") or "").strip(),
        })
    intro = raw.get("self_intro") if isinstance(raw.get("self_intro"), dict) else {}
    questions = []
    for q in raw.get("interview_questions") or []:
        if not isinstance(q, dict):
            continue
        questions.append({
            "question": str(q.get("question") or "").strip(),
            "intent": str(q.get("intent") or "").strip(),
            "answer_hint": str(q.get("answer_hint") or "").strip(),
        })
        if len(questions) >= 12:
            break
    salary = raw.get("salary_negotiation") if isinstance(raw.get("salary_negotiation"), dict) else {}
    return {
        "cover_letter_guide": {
            "structure": structure,
            "word_count": str(guide.get("word_count") or "300-500字"),
            "tone": str(guide.get("tone") or "专业、真诚、不卑不亢"),
            "full_draft": str(guide.get("full_draft") or "").strip(),
        },
        "self_intro": {
            "one_minute": str(intro.get("one_minute") or "").strip(),
            "three_minute": str(intro.get("three_minute") or "").strip(),
        },
        "interview_questions": questions,
        "salary_negotiation": {
            "range_hint": str(salary.get("range_hint") or "").strip(),
            "talking_points": _str_list(salary.get("talking_points"), 8),
            "cautions": _str_list(salary.get("cautions"), 6),
        },
        "linkedin_summary": str(raw.get("linkedin_summary") or "").strip(),
    }


def build_report_markdown(
    *,
    analysis: dict,
    reconstruct: dict | None = None,
    materials: dict | None = None,
    resume_name: str = "",
) -> str:
    """组装完整分析报告 Markdown（无 LLM）。"""
    a = analysis or {}
    lines: list[str] = []
    lines.append("# 岗位匹配分析报告")
    if resume_name:
        lines.append(f"\n**简历**：{resume_name}")
    score = a.get("overall_score") if a.get("overall_score") is not None else a.get("score")
    lines.append(f"\n**总分**：{score}/100")
    if a.get("score_level"):
        lines.append(f"**等级**：{a.get('score_level')}")
    if a.get("level_band"):
        lines.append(f"**权重档**：{a.get('level_band')}岗")
    if a.get("summary"):
        lines.append(f"\n## 一句话结论\n\n{a['summary']}")

    jd = a.get("jd_parsed") if isinstance(a.get("jd_parsed"), dict) else {}
    basic = jd.get("basic_info") if isinstance(jd.get("basic_info"), dict) else {}
    if basic:
        lines.append("\n## JD 摘要\n")
        lines.append(
            "- "
            + " · ".join(
                str(basic.get(k) or "")
                for k in ("job_title", "company", "level", "location", "salary_range")
                if basic.get(k)
            )
        )

    risks = jd.get("risks") or []
    if risks:
        lines.append("\n## 岗位风险\n")
        for r in risks:
            if not isinstance(r, dict):
                continue
            lines.append(
                f"- **[{r.get('level')}] {r.get('type')}**：{r.get('description')} "
                f"（建议：{r.get('suggestion') or '—'}）"
            )

    dims = a.get("dimensions") or []
    if not dims and isinstance(a.get("dimension_scores"), dict):
        dims = [
            {
                "name": (v or {}).get("label") or k,
                "score": (v or {}).get("score"),
                "weight": int(round(float((v or {}).get("weight") or 0) * 100)),
                "detail": (v or {}).get("detail"),
            }
            for k, v in a["dimension_scores"].items()
        ]
    if dims:
        lines.append("\n## 多维评分\n")
        for d in dims:
            lines.append(
                f"- **{d.get('name')}**：{d.get('score')}（权重 {d.get('weight')}%）"
                + (f" — {d.get('detail')}" if d.get("detail") else "")
            )

    adv = a.get("competitive_advantages") or []
    if adv:
        lines.append("\n## 竞争优势\n")
        for x in adv:
            lines.append(f"- {x}")
    gaps = a.get("skill_gaps") or []
    if gaps:
        lines.append("\n## 能力短板\n")
        for x in gaps:
            lines.append(f"- {x}")

    gap = a.get("gap_analysis") if isinstance(a.get("gap_analysis"), dict) else {}
    for title, key in (("关键差距与策略", "critical_gaps"), ("次要差距与策略", "minor_gaps")):
        items = gap.get(key) or []
        if not items:
            continue
        lines.append(f"\n## {title}\n")
        for g in items:
            if not isinstance(g, dict):
                continue
            lines.append(f"- **{g.get('gap')}**（{g.get('severity') or ''}）")
            if g.get("strategy"):
                lines.append(f"  - 策略：{g['strategy']}")

    culture = a.get("culture_fit_detail") if isinstance(a.get("culture_fit_detail"), dict) else {}
    if culture:
        lines.append("\n## 文化适配\n")
        if culture.get("culture_fit_score") is not None:
            lines.append(f"- 分数：{culture.get('culture_fit_score')}")
        ana = culture.get("analysis") if isinstance(culture.get("analysis"), dict) else {}
        if ana.get("suggestion"):
            lines.append(f"- 建议：{ana['suggestion']}")

    recon = reconstruct or {}
    tiers = (recon.get("experience_priority") or {}).get("tiers") or []
    if tiers:
        lines.append("\n## 经历优先级\n")
        for t in tiers:
            lines.append(
                f"- **{t.get('tier')}** {t.get('company') or ''} {t.get('title') or ''} "
                f"（{t.get('priority_score')}分）— {t.get('reason') or ''}"
            )

    ats = recon.get("ats") if isinstance(recon.get("ats"), dict) else None
    if ats:
        lines.append(f"\n## ATS 检测（{ats.get('ats_score')}/100）\n")
        for c in ats.get("checks") or []:
            if not isinstance(c, dict):
                continue
            lines.append(f"- **{c.get('item')}** [{c.get('status')}]：{c.get('detail')}")
            if c.get("suggestion"):
                lines.append(f"  - 建议：{c['suggestion']}")

    plan = recon.get("optimization_plan") if isinstance(recon.get("optimization_plan"), dict) else None
    if plan:
        lines.append("\n## 优化方案摘要\n")
        if plan.get("strategy_summary"):
            lines.append(plan["strategy_summary"] + "\n")
        for s in (plan.get("sections") or [])[:12]:
            if not isinstance(s, dict):
                continue
            lines.append(f"### {s.get('section')}（{s.get('change_type')}）")
            if s.get("original"):
                lines.append(f"- 原文：{s['original']}")
            lines.append(f"- 优化：{s.get('optimized')}")
            if s.get("reason"):
                lines.append(f"- 原因：{s['reason']}")

    if recon.get("optimized_resume_md"):
        lines.append("\n## 优化版简历\n")
        lines.append(recon["optimized_resume_md"])

    mats = materials or {}
    if mats:
        lines.append("\n## 求职配套物料\n")
        cl = mats.get("cover_letter_guide") if isinstance(mats.get("cover_letter_guide"), dict) else {}
        if cl.get("full_draft"):
            lines.append("### 求职信草稿\n")
            lines.append(cl["full_draft"] + "\n")
        if cl.get("structure"):
            lines.append("### 求职信写作要点\n")
            for s in cl["structure"]:
                lines.append(f"- **{s.get('section')}**：{s.get('point')}")
                if s.get("template"):
                    lines.append(f"  - 示例：{s['template']}")
        intro = mats.get("self_intro") if isinstance(mats.get("self_intro"), dict) else {}
        if intro.get("one_minute"):
            lines.append("\n### 1分钟自我介绍\n")
            lines.append(intro["one_minute"] + "\n")
        if intro.get("three_minute"):
            lines.append("\n### 3分钟自我介绍\n")
            lines.append(intro["three_minute"] + "\n")
        qs = mats.get("interview_questions") or []
        if qs:
            lines.append("\n### 面试追问预判\n")
            for q in qs:
                lines.append(f"- **Q**：{q.get('question')}")
                if q.get("intent"):
                    lines.append(f"  - 考察：{q['intent']}")
                if q.get("answer_hint"):
                    lines.append(f"  - 提示：{q['answer_hint']}")
        sal = mats.get("salary_negotiation") if isinstance(mats.get("salary_negotiation"), dict) else {}
        if sal.get("range_hint") or sal.get("talking_points"):
            lines.append("\n### 薪资谈判参考\n")
            if sal.get("range_hint"):
                lines.append(sal["range_hint"] + "\n")
            for p in sal.get("talking_points") or []:
                lines.append(f"- {p}")
        if mats.get("linkedin_summary"):
            lines.append("\n### LinkedIn 摘要\n")
            lines.append(mats["linkedin_summary"] + "\n")

    lines.append("\n---\n*由岗位匹配分析生成*\n")
    return "\n".join(lines)


def build_export_bundle(
    *,
    analysis: dict,
    reconstruct: dict | None = None,
    materials: dict | None = None,
    resume_name: str = "",
) -> dict[str, Any]:
    """导出包：Markdown 报告 + JSON 结构化数据。"""
    md = build_report_markdown(
        analysis=analysis,
        reconstruct=reconstruct,
        materials=materials,
        resume_name=resume_name,
    )
    payload = {
        "resume_name": resume_name,
        "analysis": analysis,
        "reconstruct": reconstruct or {},
        "materials": materials or {},
    }
    return {
        "report_markdown": md,
        "report_json": payload,
    }
