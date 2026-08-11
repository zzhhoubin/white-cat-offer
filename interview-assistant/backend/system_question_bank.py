"""本地系统题库：按岗位 / 年数匹配，不调用 LLM。"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_DATA_PATH = Path(__file__).resolve().parent / "data" / "system_question_bank.json"


@lru_cache(maxsize=1)
def _load_raw() -> list[dict[str, Any]]:
    try:
        data = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("system question bank missing: %s", _DATA_PATH)
        return []
    except json.JSONDecodeError as exc:
        logger.warning("system question bank invalid JSON: %s", exc)
        return []
    items = data.get("questions") if isinstance(data, dict) else data
    return [x for x in (items or []) if isinstance(x, dict)]


def reload_bank() -> None:
    _load_raw.cache_clear()


def _role_hit(item: dict, role: str) -> bool:
    role_l = (role or "").strip().lower()
    if not role_l:
        return item.get("role") == "*"
    if item.get("role") == "*":
        return True
    names = [str(item.get("role") or "")] + list(item.get("role_aliases") or [])
    for name in names:
        n = name.strip().lower()
        if not n:
            continue
        if n == role_l or n in role_l or role_l in n:
            return True
    return False


def _seniority_hit(item: dict, years: str) -> bool:
    y = (years or "").strip() or "1-3"
    allowed = item.get("seniority") or []
    if not allowed:
        return True
    return y in allowed


def _norm_item(item: dict) -> dict[str, Any]:
    return {
        "id": str(item.get("id") or ""),
        "question_id": str(item.get("id") or ""),
        "question": str(item.get("question") or "").strip(),
        "answer": str(item.get("answer") or "").strip(),
        "category": str(item.get("category") or "高频考点"),
        "difficulty": str(item.get("difficulty") or item.get("level") or "中级"),
        "level": str(item.get("difficulty") or item.get("level") or "中级"),
        "source": "system",
    }


def query_system_questions(
    *,
    role: str,
    years: str = "1-3",
    limit: int = 12,
) -> dict[str, Any]:
    """返回匹配题目。match: exact | weak | fallback。"""
    all_items = _load_raw()
    limit = max(1, min(int(limit or 12), 30))

    exact = [x for x in all_items if _role_hit(x, role) and x.get("role") != "*" and _seniority_hit(x, years)]
    if exact:
        picked = exact[:limit]
        return {"match": "exact", "questions": [_norm_item(x) for x in picked], "count": len(picked)}

    weak = [x for x in all_items if _role_hit(x, role) and x.get("role") != "*"]
    if weak:
        picked = weak[:limit]
        return {"match": "weak", "questions": [_norm_item(x) for x in picked], "count": len(picked)}

    fallback = [x for x in all_items if x.get("role") == "*"]
    # 再补一些通用行为题不够时用任意初级题
    if len(fallback) < limit:
        extra = [x for x in all_items if x not in fallback]
        fallback = fallback + extra
    picked = fallback[:limit]
    return {"match": "fallback", "questions": [_norm_item(x) for x in picked], "count": len(picked)}
