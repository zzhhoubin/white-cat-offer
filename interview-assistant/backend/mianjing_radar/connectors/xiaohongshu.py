"""小红书连接器 —— 调用本机 MediaCrawler 采集面经笔记。

需要：
  - MediaCrawler 已安装到 MEDIACRAWLER_HOME（默认 ~/.mediacrawler）
  - 已在配置中写入有效的 web_session cookie

两种模式：
  - driver：自动 shell out 跑 MediaCrawler（需 cookie 已配）
  - cache：读取已生成的历史 JSON 文件
"""
import json
import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from .base import BaseConnector
from ..models import RealQuestion, SearchResult
from config import settings

logger = logging.getLogger(__name__)


class XiaoHongShuConnector(BaseConnector):
    source_type = "xiaohongshu"
    source_label = "小红书"

    def __init__(self, mediacrawler_home: str = "", web_session: str = ""):
        self.mc_home = mediacrawler_home or getattr(settings, "mediacrawler_home", "")
        self.web_session = web_session or getattr(settings, "xhs_web_session", "")

    def search(self, keywords: list[str], limit: int = 15) -> SearchResult:
        result = SearchResult(
            source_type=self.source_type,
            source_label=self.source_label,
            status="empty",
            raw_count=0,
        )

        if not self.mc_home or not Path(self.mc_home).exists():
            result.status = "degraded"
            result.error = "MediaCrawler 未安装（MEDIACRAWLER_HOME 未配置或路径不存在）"
            return result

        if not self.web_session:
            result.status = "degraded"
            result.error = "未配置小红书 web_session cookie"
            return result

        # 优先读缓存（MediaCrawler 跑一次要 30-60 秒，太慢了）
        notes = self._load_latest_cache()
        if not notes:
            # 首次：无缓存，尝试跑一次 MediaCrawler
            logger.info("No XHS cache found, running MediaCrawler for '%s'...", keywords[0] if keywords else "")
            try:
                self._run_search(keywords[0] if keywords else "")
                notes = self._load_latest_cache()
            except Exception as e:
                logger.warning("MediaCrawler run failed: %s", e)
                result.status = "degraded"
                result.error = f"MediaCrawler 运行失败: {e}"
                return result

        if not notes:
            result.status = "degraded"
            result.error = "未找到小红书搜索结果"
            return result

        questions = self._extract_questions(notes, limit)
        result.questions = questions
        result.raw_count = len(notes)
        result.status = "ok" if questions else "degraded"
        return result

    def _run_search(self, keyword: str) -> list[dict]:
        """shell out 跑 MediaCrawler。"""
        python = str(Path(self.mc_home) / "venv" / "Scripts" / "python.exe")
        main_py = str(Path(self.mc_home) / "main.py")

        if not Path(python).exists() or not Path(main_py).exists():
            raise FileNotFoundError("MediaCrawler venv/main.py not found")

        cmd = [
            python, main_py,
            "--platform", "xhs",
            "--lt", "cookie",
            "--type", "search",
            "--keywords", f"{keyword} 面经",
            "--save_data_option", "json",
            "--get_comment", "no",
        ]

        logger.info("Running MediaCrawler: %s", " ".join(cmd))
        proc = subprocess.run(
            cmd,
            cwd=self.mc_home,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            # 检查 stderr 中有用的错误
            err = proc.stderr[-500:] if proc.stderr else "unknown"
            raise RuntimeError(f"MediaCrawler exited {proc.returncode}: {err}")

        return self._load_latest_cache()

    def _load_latest_cache(self) -> list[dict]:
        """读取最新一次 MediaCrawler 生成的小红书 JSON。"""
        json_dir = Path(self.mc_home) / "data" / "xhs" / "json"
        if not json_dir.exists():
            return []

        files = sorted(json_dir.glob("search_contents_*.json"), reverse=True)
        if not files:
            return []

        with open(files[0], encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []

    @staticmethod
    def _extract_questions(notes: list[dict], limit: int) -> list[RealQuestion]:
        """从小红书笔记中提取面经题。"""
        questions: list[RealQuestion] = []
        seen = set()
        source_url_prefix = "https://www.xiaohongshu.com/explore/"

        for note in notes:
            if len(questions) >= limit:
                break

            note_id = note.get("note_id", "")
            desc = note.get("desc", "") or note.get("title", "") or note.get("display_title", "")
            title = note.get("display_title", "")
            full_text = f"{title} {desc}"

            # 提取题目
            extracted = _extract_q_from_text(full_text)
            for q_text in extracted:
                if len(questions) >= limit:
                    break
                norm = q_text.lower().replace(" ", "")
                if norm not in seen:
                    seen.add(norm)
                    questions.append(
                        RealQuestion(
                            text=q_text,
                            source_type="xiaohongshu",
                            source_label="小红书",
                            source_url=f"{source_url_prefix}{note_id}",
                            evidence=full_text[:200],
                            points=[],
                            anchor="",
                        )
                    )

        return questions


def _extract_q_from_text(text: str) -> list[str]:
    """从一段文本中提取面经题目。"""
    qs: list[str] = []
    seen = set()

    patterns = [
        # 编号题：1. xxx？ 或 1、xxx？
        re.compile(r"(?:^|\n)\s*(\d{1,2})[\.\、\)）]\s*(.{6,150}?[？?])"),
        # 被引号包裹
        re.compile(r"[《「「](.{8,120}?[？?])[》」」]"),
        # 面试/高频/真题 后跟题目
        re.compile(r"(?:面试题|高频题|真题|面经题|必问题)[：:]\s*(.{8,150}?[？?])"),
        # 直接问句
        re.compile(r"([一-鿿][一-鿿\w\s]{6,120}?[？?])"),
    ]

    for pat in patterns:
        for m in pat.finditer(text):
            q_text = m.group(2) if pat is patterns[0] else m.group(1)
            q_text = q_text.strip().strip("，。；,!; ")
            if 6 <= len(q_text) <= 150 and q_text not in seen:
                seen.add(q_text)
                qs.append(q_text)

    return qs[:10]
