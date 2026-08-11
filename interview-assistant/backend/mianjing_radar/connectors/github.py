"""GitHub 连接器 —— 搜索公开面试题库仓库。

不需要认证，但受 rate limit 限制（60 req/h）。
"""
import json
import logging
import re
import urllib.request
from urllib.parse import quote, urlencode

from .base import BaseConnector
from ..models import RealQuestion, SearchResult

logger = logging.getLogger(__name__)

# 面经相关仓库（公开、无需认证）
_SEED_REPOS = [
    "https://raw.githubusercontent.com/CyC2018/CS-Notes/master/notes/README.md",
    "https://raw.githubusercontent.com/Snailclimb/JavaGuide/master/README.md",
    "https://raw.githubusercontent.com/doocs/advanced-java/master/README.md",
    "https://raw.githubusercontent.com/AobingJava/JavaFamily/master/README.md",
    "https://raw.githubusercontent.com/forthespada/InterviewGuide/main/README.md",
    "https://raw.githubusercontent.com/0voice/interview_internal_reference/master/README.md",
    "https://raw.githubusercontent.com/afatcoder/LeetcodeTop/master/README.md",
    "https://raw.githubusercontent.com/lietoumai/Awsome-Data-Science-Interview/main/README.md",
    "https://raw.githubusercontent.com/datawhalechina/daily-interview/master/README.md",
]


class GithubConnector(BaseConnector):
    source_type = "github"
    source_label = "GitHub"

    def search(self, keywords: list[str], limit: int = 20) -> SearchResult:
        result = SearchResult(
            source_type=self.source_type,
            source_label=self.source_label,
            status="empty",
            raw_count=0,
        )

        questions: list[RealQuestion] = []
        # 构建搜索查询：目标岗位 + 关键词
        queries = list(keywords)[:5]

        # 先尝试 GitHub code search API（无需认证，rate limit 60/h）
        for q in queries:
            if len(questions) >= limit:
                break
            try:
                fetched = self._search_github(q, limit - len(questions))
                questions.extend(fetched)
                result.raw_count += len(fetched)
            except Exception as e:
                logger.warning("GitHub search failed for %s: %s", q, e)

        # 如果搜索结果不够，从种子仓库直接拉取匹配的题目
        if len(questions) < limit:
            try:
                fetched = self._scrape_seed_repos(keywords, limit - len(questions))
                questions.extend(fetched)
                result.raw_count += len(fetched)
            except Exception as e:
                logger.warning("GitHub seed repos failed: %s", e)

        result.questions = questions
        if questions:
            result.status = "ok"
        elif result.raw_count > 0:
            result.status = "degraded"
            result.error = f"匹配到 {result.raw_count} 条但相关度不足"

        return result

    def _search_github(self, query: str, limit: int) -> list[RealQuestion]:
        """通过 GitHub REST API 搜索代码。"""
        url = f"https://api.github.com/search/code?q={quote(query + ' 面试')}&per_page={min(limit, 10)}"
        req = urllib.request.Request(
            url,
            headers={"Accept": "application/vnd.github.v3+json", "User-Agent": "MianJingRadar/1.0"},
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        questions: list[RealQuestion] = []
        for item in data.get("items", [])[:limit]:
            repo = item.get("repository", {}).get("full_name", "")
            path = item.get("path", "")
            html_url = item.get("html_url", "")
            raw_url = f"https://raw.githubusercontent.com/{repo}/master/{path}"
            # 尝试读取文件内容
            try:
                text = self._fetch_raw(raw_url)
                # 从内容中提取面经题
                extracted = self._extract_questions_from_text(text, query, html_url)
                questions.extend(extracted)
            except Exception:
                continue

        return questions

    def _scrape_seed_repos(self, keywords: list[str], limit: int) -> list[RealQuestion]:
        """从种子仓库的已知面试题文件里匹配（带相关性过滤）。"""
        questions: list[RealQuestion] = []
        kw_pattern = "|".join(re.escape(k) for k in keywords if len(k) > 1)

        # 构建相关性关键词集合（用于过滤）
        relevance_terms = set()
        for k in keywords:
            k = k.strip().lower()
            if len(k) > 1:
                relevance_terms.add(k)
        # 从完整关键词中提取独立词（2-4字的中文词）
        for k in list(relevance_terms):
            for i in range(0, len(k) - 1):
                seg = k[i:i+2]
                if len(seg) >= 2:
                    relevance_terms.add(seg)

        for raw_url in _SEED_REPOS:
            if len(questions) >= limit:
                break
            try:
                text = self._fetch_raw(raw_url)
                extracted = self._extract_questions_from_text(text, kw_pattern, raw_url)
                # 相关性过滤：题目必须包含至少一个关键词片段
                if relevance_terms:
                    extracted = [
                        q for q in extracted
                        if any(term in q.text.lower() for term in relevance_terms)
                    ]
                questions.extend(extracted[: limit - len(questions)])
            except Exception:
                continue

        return questions

    @staticmethod
    def _fetch_raw(url: str, timeout: int = 20) -> str:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "MianJingRadar/1.0"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")

    @staticmethod
    def _extract_questions_from_text(text: str, context: str, source_url: str) -> list[RealQuestion]:
        """从 Markdown 文本中提取面经题目。

        面经题目通常以编号、问号结尾的行出现，或以 `###` 标题形式出现。
        """
        questions: list[RealQuestion] = []
        lines = text.split("\n")

        # 常见题型模式
        patterns = [
            # ### 1. 题目文字？
            re.compile(r"^#{1,4}\s*\d*[\.\、\s]*[" "「]?(.+?[？?])[" "」]?\s*$"),
            # 1. 题目文字？
            re.compile(r"^\d+[\.\、\)]\s*(.+?[？?])\s*$"),
            # - **题目文字？** 或 - 题目文字？
            re.compile(r"^[-*]\s+(?:\*\*)?(.+?[？?])(?:\*\*)?\s*$"),
            # - [ ] 题目文字？
            re.compile(r"^[-*]\s*\[.\]\s*(.+?[？?])\s*$"),
        ]

        seen_texts = set()

        for line in lines:
            line = line.strip()
            if len(line) < 6 or len(line) > 200:
                continue

            # 跳过纯链接、代码、表格
            if line.startswith(("http", "|", "```", "![", "<!--")):
                continue

            for pat in patterns:
                m = pat.match(line)
                if m:
                    q_text = m.group(1).strip()
                    # 清理 markdown 标记
                    q_text = re.sub(r"\*\*([^*]+)\*\*", r"\1", q_text)
                    q_text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", q_text)
                    q_text = q_text.strip()

                    if len(q_text) < 4 or len(q_text) > 150:
                        continue
                    # 去重
                    norm = q_text.lower().replace(" ", "")
                    if norm in seen_texts:
                        continue
                    seen_texts.add(norm)

                    questions.append(
                        RealQuestion(
                            text=q_text,
                            source_type="github",
                            source_label="GitHub 面试题库",
                            source_url=source_url,
                            evidence=line[:200],
                            points=[],
                            anchor="",
                        )
                    )
                    break

        return questions
