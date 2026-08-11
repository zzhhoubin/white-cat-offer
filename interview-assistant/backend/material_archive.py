"""资料库：原始文档 + 归档卡片。"""

from __future__ import annotations

import json
import logging
import os
import re
import time
import uuid
from typing import Any

from sqlalchemy import delete, select

from config import settings
from database import SessionLocal
from llm_utils import LLMNotConfiguredError, get_llm_model, openai_client, require_llm_config
from models import MaterialCard, MaterialDoc

logger = logging.getLogger(__name__)

_ARCHIVE_SYSTEM = """你是简历与面试资料归档助手。把用户上传的资料拆成若干「资料卡片」。
只返回纯 JSON（不要 markdown）：
{
  "cards": [
    {
      "card_type": "experience|project_evidence|skill|metric|other",
      "title": "短标题",
      "summary": "2-4句摘要",
      "bullets": ["要点"],
      "tags": ["标签"],
      "evidence_quote": "原文摘录，勿编造",
      "confidence": 0.0
    }
  ]
}
规则：只依据原文；不足处少造卡片；中文为主。"""


def _new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"


def _ensure_dir(user_id: str) -> str:
    root = settings.material_docs_dir
    path = os.path.join(root, user_id)
    os.makedirs(path, exist_ok=True)
    return path


def _doc_dict(row: MaterialDoc) -> dict[str, Any]:
    return {
        "doc_id": row.doc_id,
        "filename": row.filename,
        "mime": row.mime,
        "ext": row.ext,
        "doc_type": row.doc_type,
        "status": row.status,
        "raw_text": row.raw_text,
        "created_at": row.created_at,
        "text_len": len(row.raw_text or ""),
    }


def _card_dict(row: MaterialCard) -> dict[str, Any]:
    return {
        "card_id": row.card_id,
        "doc_id": row.doc_id,
        "card_type": row.card_type,
        "title": row.title,
        "summary": row.summary,
        "bullets": row.bullets or [],
        "tags": row.tags or [],
        "evidence_quote": row.evidence_quote,
        "confidence": row.confidence,
        "status": row.status,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def save_document(
    user_id: str,
    *,
    filename: str,
    raw_bytes: bytes,
    raw_text: str,
    mime: str = "",
    doc_type: str = "other",
) -> dict[str, Any]:
    now = time.time()
    doc_id = _new_id("md_")
    ext = os.path.splitext(filename or "")[1].lower().lstrip(".")
    folder = _ensure_dir(user_id)
    storage_path = os.path.join(folder, f"{doc_id}.{ext or 'bin'}")
    with open(storage_path, "wb") as f:
        f.write(raw_bytes or b"")
    text = (raw_text or "").strip()
    status = "parsed" if text else "uploaded"
    row = MaterialDoc(
        doc_id=doc_id,
        user_id=user_id,
        filename=filename or "未命名",
        mime=mime or "",
        ext=ext,
        storage_path=storage_path,
        raw_text=text,
        doc_type=doc_type or "other",
        status=status,
        created_at=now,
    )
    with SessionLocal() as db:
        db.add(row)
        db.commit()
        db.refresh(row)
        return _doc_dict(row)


def list_documents(user_id: str, *, include_text: bool = False) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        rows = db.scalars(
            select(MaterialDoc)
            .where(MaterialDoc.user_id == user_id)
            .order_by(MaterialDoc.created_at.desc())
        ).all()
        out = []
        for r in rows:
            d = _doc_dict(r)
            if not include_text:
                d.pop("raw_text", None)
            out.append(d)
        return out


def get_document(user_id: str, doc_id: str) -> MaterialDoc | None:
    with SessionLocal() as db:
        row = db.get(MaterialDoc, doc_id)
        if not row or row.user_id != user_id:
            return None
        return row


def list_cards(user_id: str, *, doc_id: str | None = None) -> list[dict[str, Any]]:
    with SessionLocal() as db:
        q = select(MaterialCard).where(MaterialCard.user_id == user_id)
        if doc_id:
            q = q.where(MaterialCard.doc_id == doc_id)
        rows = db.scalars(q.order_by(MaterialCard.updated_at.desc())).all()
        return [_card_dict(r) for r in rows]


def patch_card(user_id: str, card_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
    now = time.time()
    with SessionLocal() as db:
        row = db.get(MaterialCard, card_id)
        if not row or row.user_id != user_id:
            return None
        for key in ("title", "summary", "card_type", "evidence_quote", "status"):
            if key in fields and fields[key] is not None:
                setattr(row, key, str(fields[key]))
        if "bullets" in fields and isinstance(fields["bullets"], list):
            row.bullets = [str(x) for x in fields["bullets"] if str(x).strip()]
        if "tags" in fields and isinstance(fields["tags"], list):
            row.tags = [str(x) for x in fields["tags"] if str(x).strip()]
        if "confidence" in fields and fields["confidence"] is not None:
            try:
                row.confidence = float(fields["confidence"])
            except (TypeError, ValueError):
                pass
        row.updated_at = now
        db.commit()
        db.refresh(row)
        return _card_dict(row)


def _safe_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                data = json.loads(m.group(0))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass
    raise ValueError("模型返回非 JSON")


def _fallback_cards(filename: str, text: str) -> list[dict[str, Any]]:
    snippet = (text or "").strip()[:1200]
    return [
        {
            "card_type": "other",
            "title": filename or "未命名资料",
            "summary": snippet[:400] or "（无正文）",
            "bullets": [],
            "tags": [],
            "evidence_quote": snippet[:500],
            "confidence": 0.5,
        }
    ]


def _llm_cards(filename: str, text: str) -> list[dict[str, Any]]:
    require_llm_config()
    client = openai_client()
    resp = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": _ARCHIVE_SYSTEM},
            {
                "role": "user",
                "content": f"文件名：{filename}\n\n正文：\n{(text or '')[:12000]}",
            },
        ],
        temperature=0.3,
        max_tokens=2500,
    )
    raw = _safe_json((resp.choices[0].message.content or "").strip())
    cards = raw.get("cards") if isinstance(raw.get("cards"), list) else []
    out = []
    for c in cards[:20]:
        if not isinstance(c, dict):
            continue
        title = str(c.get("title") or "").strip()
        if not title:
            continue
        out.append(
            {
                "card_type": str(c.get("card_type") or "other").strip() or "other",
                "title": title,
                "summary": str(c.get("summary") or "").strip(),
                "bullets": [str(x).strip() for x in (c.get("bullets") or []) if str(x).strip()],
                "tags": [str(x).strip() for x in (c.get("tags") or []) if str(x).strip()],
                "evidence_quote": str(c.get("evidence_quote") or "").strip(),
                "confidence": float(c.get("confidence") or 0.7),
            }
        )
    return out or _fallback_cards(filename, text)


def archive_document(user_id: str, doc_id: str, *, force: bool = False) -> dict[str, Any]:
    """对文档生成资料卡；默认替换该文档下旧卡。"""
    with SessionLocal() as db:
        doc = db.get(MaterialDoc, doc_id)
        if not doc or doc.user_id != user_id:
            raise ValueError("文档不存在")
        text = (doc.raw_text or "").strip()
        if not text:
            raise ValueError("文档无正文，无法归档")
        filename = doc.filename
        existing = db.scalars(
            select(MaterialCard).where(
                MaterialCard.user_id == user_id,
                MaterialCard.doc_id == doc_id,
            )
        ).all()
        if existing and not force:
            return {
                "doc_id": doc_id,
                "cards": [_card_dict(c) for c in existing],
                "created": False,
                "note": "已有卡片；传 force=true 可重建",
            }

    try:
        specs = _llm_cards(filename, text)
    except LLMNotConfiguredError:
        specs = _fallback_cards(filename, text)
    except Exception as exc:  # noqa: BLE001
        logger.warning("archive llm failed, fallback: %s", exc)
        specs = _fallback_cards(filename, text)

    now = time.time()
    with SessionLocal() as db:
        db.execute(
            delete(MaterialCard).where(
                MaterialCard.user_id == user_id,
                MaterialCard.doc_id == doc_id,
            )
        )
        rows = []
        for spec in specs:
            row = MaterialCard(
                card_id=_new_id("mc_"),
                user_id=user_id,
                doc_id=doc_id,
                card_type=spec["card_type"],
                title=spec["title"],
                summary=spec["summary"],
                bullets=spec["bullets"],
                tags=spec["tags"],
                evidence_quote=spec["evidence_quote"],
                confidence=float(spec.get("confidence") or 0.7),
                status="draft",
                created_at=now,
                updated_at=now,
            )
            db.add(row)
            rows.append(row)
        doc = db.get(MaterialDoc, doc_id)
        if doc:
            doc.status = "parsed"
        db.commit()
        for r in rows:
            db.refresh(r)
        return {
            "doc_id": doc_id,
            "cards": [_card_dict(r) for r in rows],
            "created": True,
        }
