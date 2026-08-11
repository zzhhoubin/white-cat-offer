"""Web 连接器 —— 直接搜索知乎/CSDN/掘金站内，抓取页面提取面经题。"""
import logging
import re
from urllib.parse import quote

from .base import BaseConnector
from ..models import RealQuestion, SearchResult
from ..browser import new_page, fetch_text

logger = logging.getLogger(__name__)

# 站内搜索模板：(搜索URL模板, 结果链接选择器, 来源标签)
_SITE_SEARCHES = [
    # 知乎
    (
        "https://www.zhihu.com/search?type=content&q={query}",
        ".List-item a[href*='/answer/'], .SearchResult-Card a[href*='/p/'], .RichText a[href*='zhihu.com']",
        "知乎",
    ),
    # CSDN
    (
        "https://so.csdn.net/so/search?q={query}",
        ".search-list .limit_width a, .search-list a[href*='blog.csdn.net']",
        "CSDN",
    ),
    # 掘金
    (
        "https://juejin.cn/search?query={query}&type=0",
        ".result-list a[href*='/post/'], .entry-list a[href*='/post/']",
        "掘金",
    ),
]


class WebConnector(BaseConnector):
    source_type = "web"
    source_label = "网页"

    def search(self, keywords: list[str], limit: int = 10) -> SearchResult:
        result = SearchResult(
            source_type=self.source_type,
            source_label=self.source_label,
            status="empty",
            raw_count=0,
        )

        questions: list[RealQuestion] = []
        seen = set()
        urls_tried = set()

        # 每个关键词 + 每个站点组合
        for kw in keywords[:3]:
            if len(questions) >= limit:
                break
            search_query = f"{kw} 面试"

            for search_tpl, link_sel, site_label in _SITE_SEARCHES:
                if len(questions) >= limit:
                    break
                try:
                    urls = self._site_search(search_tpl.format(query=quote(search_query)), link_sel)
                    for url in urls:
                        if url in urls_tried:
                            continue
                        urls_tried.add(url)
                        if len(questions) >= limit:
                            break
                        try:
                            text = fetch_text(url, timeout_ms=10000)
                            extracted = self._extract_questions(text, url)
                            # 打上来源站点标签
                            for q in extracted:
                                q.source_label = site_label
                                norm = q.text.lower().replace(" ", "")
                                if norm not in seen:
                                    seen.add(norm)
                                    questions.append(q)
                                    result.raw_count += 1
                        except Exception as e:
                            logger.debug("%s page fetch failed: %s %s", site_label, url, e)
                            continue
                except Exception as e:
                    logger.warning("Site search %s failed for '%s': %s", site_label, kw, e)
                    continue

        result.questions = questions[:limit]
        if questions:
            result.status = "ok"
        return result

    @staticmethod
    def _site_search(search_url: str, link_selector: str) -> list[str]:
        """用 Playwright 在站点内搜索，返回结果页中的文章 URL。"""
        urls: list[str] = []
        try:
            with new_page(timeout_ms=15000) as page:
                try:
                    page.goto(search_url, wait_until="domcontentloaded", timeout=10000)
                except Exception:
                    pass
                page.wait_for_timeout(3000)

                # 从结果列表中提取文章链接
                try:
                    links = page.query_selector_all(link_selector)
                    for link in links[:15]:
                        href = (link.get_attribute("href") or "").strip()
                        if href.startswith("/"):
                            # 补全域名
                            if "zhihu.com" in search_url:
                                href = f"https://www.zhihu.com{href}"
                            elif "csdn.net" in search_url:
                                href = f"https://so.csdn.net{href}" if href.startswith("/so/") else href
                            elif "juejin.cn" in search_url:
                                href = f"https://juejin.cn{href}"
                        if href.startswith("http") and href not in urls:
                            urls.append(href)
                except Exception:
                    pass

                # 如果选择器没匹配到，用 JS 从 DOM 找所有外链
                if not urls:
                    try:
                        domain = search_url.split("/")[2]
                        js_code = (
                            "(function() {"
                            "  const as = document.querySelectorAll('a[href]');"
                            "  const result = [];"
                            "  for (const a of as) {"
                            "    const h = a.getAttribute('href') || '';"
                            "    if (h.startsWith('http') && !h.includes('" + domain + "')) {"
                            "      result.push(h);"
                            "      if (result.length >= 10) break;"
                            "    }"
                            "  }"
                            "  return result;"
                            "})()"
                        )
                        all_urls = page.evaluate(js_code)
                        urls = list(all_urls)
                    except Exception:
                        pass
        except Exception:
            pass

        return urls[:5]

    @staticmethod
    def _extract_questions(text: str, source_url: str) -> list[RealQuestion]:
        """从页面文本中提取面试题。"""
        text = re.sub(r"\s+", " ", text)

        questions: list[RealQuestion] = []
        seen = set()

        patterns = [
            re.compile(r"(?:^|\n)\s*(\d{1,2})[\.\、\)）]\s*(.{6,150}?[？?])"),
            re.compile(r"(?:Q\d*|问\d*)[:：]\s*(.{6,150}?[？?])"),
            re.compile(r"[""\"](.{8,120}?[？?])[""\"]"),
            re.compile(r"(?:面试官问|面试题|高频题|真题|题目)[:：]?\s*(.{8,150}?[？?])"),
            re.compile(r"([一-鿿][一-鿿\w\s]{6,120}?[？?])"),
        ]

        for pat in patterns:
            for m in pat.finditer(text):
                q_text = m.group(2) if pat is patterns[0] else m.group(1)
                q_text = q_text.strip()
                q_text = re.sub(r"<[^>]+>", "", q_text)
                q_text = q_text.strip("，。；,!; ")

                if len(q_text) < 6 or len(q_text) > 150:
                    continue
                if re.match(
                    r"^(这是|所以|因此|但是|然而|因为|如果|首先|其次|最后|另外|总之|大家|欢迎|谢谢|感谢|关注|点赞|收藏|转发|分享)",
                    q_text,
                ):
                    continue

                norm = q_text.lower().replace(" ", "")
                if norm in seen:
                    continue
                seen.add(norm)

                questions.append(
                    RealQuestion(
                        text=q_text,
                        source_type="web",
                        source_label="公开网页",
                        source_url=source_url,
                        evidence=q_text,
                        points=[],
                        anchor="",
                    )
                )

        return questions
