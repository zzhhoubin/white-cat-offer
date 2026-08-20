"""只读 mianjing.db：按岗位/公司分页拉面经。"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
_DEFAULT_DB = Path(r"D:\Interview_question\data\mianjing.db")
_LOCAL_DB = _BACKEND_DIR / "data" / "mianjing.db"


def mianjing_db_path() -> Path:
    raw = (os.getenv("MIANJING_DB_PATH") or "").strip()
    if raw:
        return Path(raw)
    if _DEFAULT_DB.is_file():
        return _DEFAULT_DB
    return _LOCAL_DB


def _connect(path: Path) -> sqlite3.Connection:
    con = sqlite3.connect(str(path))
    con.row_factory = sqlite3.Row
    return con


def _pack(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "url": row["url"] or "",
        "title": (row["title"] or "").strip() or "（无标题）",
        "company": (row["company"] or "").strip() or "未明确面试公司",
        "job_l1": row["job_l1"] or "",
        "job_l2": row["job_l2"] or "",
        "job_l3": row["job_l3"] or "",
        "content": row["content"] or "",
        "posted_at": row["posted_at"] or "",
        "campus": row["campus"] or "",
    }


def list_feed(*, job_l3: str = "", company: str = "", offset: int = 0, limit: int = 10) -> dict:
    path = mianjing_db_path()
    job_l3 = (job_l3 or "").strip()
    company = (company or "").strip()
    offset = max(0, int(offset or 0))
    limit = max(1, min(int(limit or 10), 30))
    empty = {
        "items": [],
        "total": 0,
        "offset": offset,
        "limit": limit,
        "has_more": False,
        "db": str(path),
    }
    if not job_l3:
        return empty
    if not path.is_file():
        empty["error"] = f"面经库不存在：{path}"
        return empty

    where = "status = 'active' AND job_l3 = ?"
    args: list = [job_l3]
    if company:
        where += " AND company = ?"
        args.append(company)

    con = _connect(path)
    try:
        total = con.execute(f"SELECT COUNT(*) FROM mianjing WHERE {where}", args).fetchone()[0]
        rows = con.execute(
            f"""
            SELECT id, url, title, company, job_l1, job_l2, job_l3, content, posted_at, campus
            FROM mianjing
            WHERE {where}
            ORDER BY posted_at DESC, id
            LIMIT ? OFFSET ?
            """,
            (*args, limit, offset),
        ).fetchall()
    finally:
        con.close()

    items = [_pack(r) for r in rows]
    return {
        "items": items,
        "total": int(total),
        "offset": offset,
        "limit": limit,
        "has_more": offset + len(items) < int(total),
        "db": str(path),
    }


def list_companies(*, q: str = "", limit: int = 20) -> list[str]:
    path = mianjing_db_path()
    q = (q or "").strip()
    if not q or not path.is_file():
        return []
    limit = max(1, min(int(limit or 20), 50))
    con = _connect(path)
    try:
        rows = con.execute(
            """
            SELECT company, COUNT(*) AS c
            FROM mianjing
            WHERE company IS NOT NULL AND trim(company) != '' AND company LIKE ?
            GROUP BY company
            ORDER BY c DESC
            LIMIT ?
            """,
            (f"%{q}%", limit),
        ).fetchall()
    finally:
        con.close()
    return [r["company"] for r in rows if r["company"]]
