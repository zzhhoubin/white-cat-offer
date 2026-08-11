"""个人素材库存储与检索（PRD 8.2 / 11.3）。"""

import re
import time
import uuid
from dataclasses import asdict, dataclass, field

from sqlalchemy import delete, select

from database import SessionLocal
from models import AssetRecord, UserProfile


@dataclass
class Asset:
    asset_id: str
    asset_type: str          # 项目 / 经历 / 技能 / 指标 / 风险点
    title: str
    content: str
    keywords: list = field(default_factory=list)
    possible_followups: list = field(default_factory=list)
    confidence: float = 0.8
    source: str = "resume"


class MaterialStore:
    def __init__(self, user_id: str = "demo-user"):
        self.user_id = user_id or "demo-user"
        self.resume_text: str = ""
        self.assets: list[Asset] = []
        self._load()

    # ---------- 持久化 ----------
    def _load(self) -> None:
        with SessionLocal() as db:
            profile = db.get(UserProfile, self.user_id)
            rows = db.scalars(
                select(AssetRecord)
                .where(AssetRecord.user_id == self.user_id)
                .order_by(AssetRecord.created_at.asc())
            ).all()
        self.resume_text = profile.resume_text if profile else ""
        self.assets = [_record_to_asset(row) for row in rows]

    def _save(self) -> None:
        now = time.time()
        with SessionLocal() as db:
            profile = db.get(UserProfile, self.user_id)
            if profile:
                profile.resume_text = self.resume_text
                profile.updated_at = now
            else:
                db.add(UserProfile(user_id=self.user_id, resume_text=self.resume_text, updated_at=now))
            db.execute(delete(AssetRecord).where(AssetRecord.user_id == self.user_id))
            for asset in self.assets:
                db.add(_asset_to_record(asset, self.user_id, now))
            db.commit()

    # ---------- 写入 ----------
    def set_resume(self, text: str, assets: list[dict]) -> None:
        self.resume_text = text or ""
        self.assets = []
        seen_ids: set[str] = set()
        for a in assets:
            asset_id = str(a.get("asset_id") or uuid.uuid4().hex[:8])
            while asset_id in seen_ids:
                asset_id = uuid.uuid4().hex[:8]
            seen_ids.add(asset_id)
            self.assets.append(
                Asset(
                    asset_id=asset_id,
                    asset_type=str(a.get("asset_type") or "经历"),
                    title=str(a.get("title") or "未命名"),
                    content=str(a.get("content") or ""),
                    keywords=_as_str_list(a.get("keywords")),
                    possible_followups=_as_str_list(a.get("possible_followups")),
                    confidence=_safe_float(a.get("confidence"), 0.8),
                    source=str(a.get("source") or "resume"),
                )
            )
        self._save()

    def add_asset(self, asset: dict) -> "Asset":
        a = Asset(
            asset_id=asset.get("asset_id") or uuid.uuid4().hex[:8],
            asset_type=str(asset.get("asset_type") or "项目"),
            title=str(asset.get("title") or "未命名"),
            content=str(asset.get("content") or ""),
            keywords=_as_str_list(asset.get("keywords")),
            possible_followups=_as_str_list(asset.get("possible_followups")),
            confidence=_safe_float(asset.get("confidence"), 0.8),
            source=str(asset.get("source") or "project_library"),
        )
        self.assets.append(a)
        self._save()
        return a

    def remove_asset(self, asset_id: str) -> bool:
        before = len(self.assets)
        self.assets = [a for a in self.assets if a.asset_id != asset_id]
        if len(self.assets) == before:
            return False
        self._save()
        return True

    def clear(self) -> None:
        self.resume_text, self.assets = "", []
        self._save()

    # ---------- 检索 ----------
    def to_dicts(self) -> list[dict]:
        return [asdict(a) for a in self.assets]

    def retrieve(self, query: str, top_k: int = 3) -> list[Asset]:
        """基于关键词重叠的简单检索，返回最相关的素材。"""
        if not self.assets:
            return []
        q_tokens = self._tokenize(query)
        if not q_tokens:
            return self.assets[:top_k]

        scored = []
        for a in self.assets:
            haystack = " ".join([a.title, a.content, " ".join(a.keywords)])
            a_tokens = self._tokenize(haystack)
            overlap = len(q_tokens & a_tokens)
            # 关键词直接命中加权
            kw_hit = sum(1 for k in a.keywords if k and k in query)
            score = overlap + kw_hit * 2
            if score > 0:
                scored.append((score, a))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [a for _, a in scored[:top_k]]

    @staticmethod
    def _tokenize(text: str) -> set:
        if not text:
            return set()
        # 中文按 2-gram，英文/数字按词，兼顾中英文检索
        text = text.lower()
        words = set(re.findall(r"[a-z0-9]+", text))
        zh = re.sub(r"[^\u4e00-\u9fff]", "", text)
        bigrams = {zh[i : i + 2] for i in range(len(zh) - 1)}
        return words | bigrams


def _safe_float(value, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_str_list(value) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item is not None and str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _record_to_asset(row: AssetRecord) -> Asset:
    return Asset(
        asset_id=row.asset_id,
        asset_type=row.asset_type,
        title=row.title,
        content=row.content,
        keywords=row.keywords or [],
        possible_followups=row.possible_followups or [],
        confidence=row.confidence,
        source=row.source,
    )


def _asset_to_record(asset: Asset, user_id: str, now: float) -> AssetRecord:
    return AssetRecord(
        asset_id=asset.asset_id,
        user_id=user_id,
        asset_type=asset.asset_type,
        title=asset.title,
        content=asset.content,
        keywords=asset.keywords or [],
        possible_followups=asset.possible_followups or [],
        confidence=asset.confidence,
        source=asset.source,
        created_at=now,
    )
