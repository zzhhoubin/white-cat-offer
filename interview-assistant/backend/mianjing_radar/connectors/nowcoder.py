"""牛客网连接器 —— 抓取讨论区面经帖。

用 Playwright 无头浏览器渲染 SPA 页面 + 提取面经题目。
需要登录 cookie（从浏览器 F12 → Application → Cookies 复制 NOWCODER_ID 和 gr_user_id）。
"""
import logging
import re
from urllib.parse import quote

from .base import BaseConnector
from ..models import RealQuestion, SearchResult
from ..browser import new_page, fetch_text

logger = logging.getLogger(__name__)


class NowCoderConnector(BaseConnector):
    source_type = "nowcoder"
    source_label = "牛客网"

    def __init__(self, cookie: str = ""):
        self.cookie = cookie

    def search(self, keywords: list[str], limit: int = 15) -> SearchResult:
        result = SearchResult(
            source_type=self.source_type,
            source_label=self.source_label,
            status="empty",
            raw_count=0,
        )

        if not self.cookie:
            result.status = "degraded"
            result.error = "未配置牛客网 cookie（在 .env 中设置 NOWCODER_COOKIE）"
            return result

        questions: list[RealQuestion] = []
        seen = set()

        for kw in keywords[:3]:
            if len(questions) >= limit:
                break
            try:
                post_urls = self._search_posts(kw, n=8)
                for url in post_urls:
                    if len(questions) >= limit:
                        break
                    try:
                        text = fetch_text(url, timeout_ms=10000)
                        extracted = self._extract_questions(text, url)
                        for q in extracted:
                            norm = q.text.lower().replace(" ", "")
                            if norm not in seen:
                                seen.add(norm)
                                questions.append(q)
                                result.raw_count += 1
                    except Exception as e:
                        logger.debug("NowCoder post fetch failed %s: %s", url, e)
                        continue
            except Exception as e:
                logger.warning("NowCoder search failed for '%s': %s", kw, e)
                continue

        result.questions = questions[:limit]
        if questions:
            result.status = "ok"
        return result

    def _search_posts(self, kw: str, n: int = 8) -> list[str]:
        """用 Playwright 渲染牛客搜索 SPA，提取讨论帖 URL。"""
        search_url = f"https://www.nowcoder.com/search?type=post&query={quote(kw + ' 面经')}"
        urls: list[str] = []

        with new_page() as page:
            # 注入 cookie
            for item in self.cookie.split(";"):
                item = item.strip()
                if "=" in item:
                    name, value = item.split("=", 1)
                    page.context.add_cookies([{
                        "name": name,
                        "value": value,
                        "domain": ".nowcoder.com",
                        "path": "/",
                    }])

            try:
                page.goto(search_url, wait_until="domcontentloaded")
            except Exception:
                pass
            # 等待搜索结果渲染
            page.wait_for_timeout(3000)

            # 尝试多种选择器找到讨论帖链接
            content = page.content()

            # 查找 /discuss/ 链接
            pattern = re.compile(r'href="(/discuss/\d+)"')
            seen = set()
            for m in pattern.finditer(content):
                path = m.group(1)
                if path not in seen:
                    seen.add(path)
                    urls.append(f"https://www.nowcoder.com{path}")

            # 如果没找到，尝试从页面元素提取
            if not urls:
                links = page.query_selector_all("a[href*='/discuss/']")
                for link in links:
                    href = link.get_attribute("href") or ""
                    if "/discuss/" in href:
                        if href.startswith("/"):
                            href = f"https://www.nowcoder.com{href}"
                        if href not in urls:
                            urls.append(href)

        logger.info("NowCoder search '%s': found %d post URLs", kw, len(urls))
        return urls[:n]

    @staticmethod
    def _extract_questions(text: str, source_url: str) -> list[RealQuestion]:
        """从帖子全文提取面经题。"""
        questions: list[RealQuestion] = []
        seen = set()

        # 面经题常见模式
        patterns = [
            re.compile(r"(?:^|\n)\s*(\d{1,2})[\.\、\)）]\s*(.{6,150}?[？?])"),
            re.compile(r"(?:Q\d*|问\d*)[:：]\s*(.{6,150}?[？?])"),
            re.compile(r"(?:面试官问|面试题|题目|真题|高频题)[:：]?\s*(.{8,150}?[？?])"),
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
                    r"^(这是|所以|因此|但是|然而|因为|如果|首先|其次|最后|另外|总之|大家|欢迎|谢谢|感谢|关注|点赞|收藏|转发)",
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
                        source_type="nowcoder",
                        source_label="牛客网",
                        source_url=source_url,
                        evidence=q_text,
                        points=[],
                        anchor="",
                    )
                )

        return questions
