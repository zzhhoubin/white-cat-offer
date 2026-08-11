"""数据源连接器基类。"""
from abc import ABC, abstractmethod
from ..models import SearchResult


class BaseConnector(ABC):
    """所有数据源连接器的抽象基类。"""

    source_type: str = ""
    source_label: str = ""

    @abstractmethod
    def search(self, keywords: list[str], limit: int = 20) -> SearchResult:
        """根据关键词搜索面经题目。"""
        ...
