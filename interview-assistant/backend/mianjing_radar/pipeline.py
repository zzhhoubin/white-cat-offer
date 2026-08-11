"""面经雷达采集管道 —— 编排多源采集 → 去重 → 输出。

默认 mode=priority：只跑牛客（已验证可出题），避免多源串行拖垮总超时。
mode=full：牛客 + 小红书 + GitHub + 网页（调试/后台二次补全用）。
"""
import logging
from typing import Optional

from config import settings
from .connectors.github import GithubConnector
from .connectors.nowcoder import NowCoderConnector
from .connectors.web import WebConnector
from .connectors.xiaohongshu import XiaoHongShuConnector
from .models import RealQuestion, SearchResult

logger = logging.getLogger(__name__)


def _seed_keywords(target_role: str, resume_data: Optional[dict] = None) -> list[str]:
    """从目标岗位 + 简历数据生成种子搜索关键词。"""
    keywords = [target_role]

    ALIASES: dict[str, list[str]] = {
        "数据分析师": [
            "数据分析面试", "SQL面试题", "数据分析常见面试题",
            "AB测试面试", "指标体系面试", "业务分析面试",
            "数据异动分析", "用户画像面试",
        ],
        "数据科学家": [
            "数据科学面试", "机器学习面试题", "统计面试题",
            "AB实验面试", "因果推断面试", "Python数据科学面试",
        ],
        "数据工程师": [
            "数据工程面试", "大数据面试题", "Spark面试",
            "Flink面试", "数据仓库面试", "ETL面试题",
        ],
        "商业分析师": [
            "商业分析面试", "经营分析面试", "SQL面试题",
            "业务分析面试题", "数据分析思维面试",
        ],
    }

    added = ALIASES.get(target_role, [])
    if not added:
        for key, vals in ALIASES.items():
            if key in target_role or target_role in key:
                added = vals
                break

    if not added:
        added = [
            f"{target_role} 面试题",
            f"{target_role} 面经",
            f"{target_role} 面试经验",
            f"{target_role} 常见面试题",
        ]

    keywords.extend(added)

    if resume_data:
        structured = resume_data.get("structured", {}) if isinstance(resume_data, dict) else {}
        if not structured and isinstance(resume_data, dict):
            if "basics" in resume_data or "experience" in resume_data:
                structured = resume_data

        skills = structured.get("skills", [])
        for group in skills:
            items = group.get("items", []) if isinstance(group, dict) else []
            for item in items[:5]:
                if len(item) > 1 and item not in keywords:
                    keywords.append(f"{item} 面试")

    return keywords[:8]


def crawl_real_questions(
    target_role: str,
    resume_data: Optional[dict] = None,
    limit: int = 15,
    mode: str = "priority",
) -> dict:
    """从公开网络源采集真实面经题目。

    mode:
      - priority: 仅牛客，关键词少，保证面经页能较快拿到真实题
      - full: 全源（慢，易超时）
    """
    kw_n = 2 if mode == "priority" else 4
    keywords = _seed_keywords(target_role, resume_data)[:kw_n]
    logger.info("MianJingRadar mode=%s keywords: %s", mode, keywords)
    per_source_limit = min(limit, 10 if mode == "priority" else 8)

    results: list[SearchResult] = []
    nc_cookie = getattr(settings, "nowcoder_cookie", "") or ""
    xhs_session = getattr(settings, "xhs_web_session", "") or ""

    # --- 牛客（主源）---
    if nc_cookie:
        try:
            nc = NowCoderConnector(cookie=nc_cookie)
            r = nc.search(keywords, limit=per_source_limit)
            results.append(r)
            logger.info("NowCoder: status=%s count=%d", r.status, len(r.questions))
        except Exception as e:
            logger.exception("NowCoder connector crashed")
            results.append(SearchResult(
                source_type="nowcoder", source_label="牛客网",
                status="degraded", error=str(e),
            ))
    else:
        results.append(SearchResult(
            source_type="nowcoder", source_label="牛客网",
            status="degraded", error="未配置 NOWCODER_COOKIE",
        ))

    nc_count = len(results[-1].questions) if results else 0

    # --- 补充源：仅 full，或 priority 下牛客几乎没货时用小红书缓存兜底 ---
    run_secondary = mode == "full" or nc_count == 0
    if run_secondary:
        if xhs_session:
            try:
                xhs = XiaoHongShuConnector()
                r = xhs.search(keywords, limit=per_source_limit)
                results.append(r)
                logger.info("XHS: status=%s count=%d", r.status, len(r.questions))
            except Exception as e:
                logger.exception("XHS connector crashed")
                results.append(SearchResult(
                    source_type="xiaohongshu", source_label="小红书",
                    status="degraded", error=str(e),
                ))
        else:
            results.append(SearchResult(
                source_type="xiaohongshu", source_label="小红书",
                status="degraded", error="未配置 XHS_WEB_SESSION",
            ))

        if mode == "full":
            try:
                gh = GithubConnector()
                r = gh.search(keywords, limit=per_source_limit)
                results.append(r)
                logger.info("GitHub: status=%s count=%d", r.status, len(r.questions))
            except Exception as e:
                logger.exception("GitHub connector crashed")
                results.append(SearchResult(
                    source_type="github", source_label="GitHub",
                    status="degraded", error=str(e),
                ))

            try:
                web = WebConnector()
                r = web.search(keywords, limit=per_source_limit)
                results.append(r)
                logger.info("Web: status=%s count=%d", r.status, len(r.questions))
            except Exception as e:
                logger.exception("Web connector crashed")
                results.append(SearchResult(
                    source_type="web", source_label="公开网页",
                    status="degraded", error=str(e),
                ))

    # --- 去重合并：牛客结果优先 ---
    all_questions: list[RealQuestion] = []
    seen = set()
    ordered = sorted(results, key=lambda r: 0 if r.source_type == "nowcoder" else 1)
    for r in ordered:
        for q in r.questions:
            norm = q.text.lower().replace(" ", "").replace("？", "?").replace("！", "!")
            if norm not in seen:
                seen.add(norm)
                all_questions.append(q)

    if len(all_questions) > limit:
        all_questions = all_questions[:limit]

    sources = []
    for r in results:
        sources.append({
            "type": r.source_type,
            "label": r.source_label,
            "count": len(r.questions),
            "status": r.status,
            "error": r.error if r.status == "degraded" else "",
        })

    summary = []
    gaps = []
    if all_questions:
        from collections import Counter
        cnt = Counter(q.source_label for q in all_questions)
        for label, c in cnt.items():
            summary.append(f"{label}：召回 {c} 条相关题目")
    else:
        summary.append("未找到公开面经题目（可能因网络限制或搜索关键词未命中）")

    if not nc_cookie:
        gaps.append("牛客网：未配置 NOWCODER_COOKIE，跳过")
    if mode == "priority":
        gaps.append("采集模式：优先牛客（其它源未全开，避免超时）")
    elif not xhs_session:
        gaps.append("小红书：未配置 XHS_WEB_SESSION，跳过")

    return {
        "questions": all_questions,
        "sources": sources,
        "summary": summary,
        "gaps": gaps,
    }
