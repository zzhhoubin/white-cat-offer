"""面经雷达数据模型。"""
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RealQuestion:
    """从真实数据源采集到的一道面经题。"""
    text: str
    source_type: str           # "nowcoder" | "github" | "web" | "xiaohongshu"
    source_label: str          # 人类可读的来源名，如 "牛客网" / "GitHub" / "网页"
    source_url: str = ""
    evidence: str = ""         # 原文证据片段
    points: list[str] = field(default_factory=list)
    anchor: str = ""           # 可挂简历锚点


@dataclass
class SearchResult:
    """单次采集结果。"""
    source_type: str
    source_label: str
    status: str                # "ok" | "degraded" | "empty"
    questions: list[RealQuestion] = field(default_factory=list)
    raw_count: int = 0         # 爬到的原始帖子数
    error: str = ""
