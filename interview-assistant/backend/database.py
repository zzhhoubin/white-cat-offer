"""Database engine/session setup for the SaaS backend."""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from config import settings


def _normalize_database_url(url: str) -> str:
    if url.startswith("sqlite:///"):
        raw = url.replace("sqlite:///", "", 1)
        if raw.startswith("/"):
            return url
        path = os.path.abspath(os.path.join(os.path.dirname(__file__), raw))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return f"sqlite:///{path}"
    return url


DATABASE_URL = _normalize_database_url(settings.database_url)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def _migrate_mock_interview_columns() -> None:
    """Add new mock-interview columns for existing SQLite databases."""
    if not DATABASE_URL.startswith("sqlite"):
        return
    from sqlalchemy import text

    alters = [
        "ALTER TABLE mock_interview_sessions ADD COLUMN company_name VARCHAR(160) DEFAULT ''",
        "ALTER TABLE mock_interview_sessions ADD COLUMN language VARCHAR(10) DEFAULT 'zh'",
        "ALTER TABLE mock_interview_sessions ADD COLUMN scope VARCHAR(40) DEFAULT 'full'",
        "ALTER TABLE mock_interview_sessions ADD COLUMN interview_state JSON",
        "ALTER TABLE mock_interview_answers ADD COLUMN round_key VARCHAR(20) DEFAULT ''",
        "ALTER TABLE mock_interview_answers ADD COLUMN answer_summary TEXT DEFAULT ''",
        "ALTER TABLE mock_interview_answers ADD COLUMN optimization_tips JSON",
    ]
    with engine.begin() as conn:
        for stmt in alters:
            try:
                conn.execute(text(stmt))
            except Exception:
                pass


def init_db() -> None:
    # Import models so SQLAlchemy registers metadata before create_all.
    import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_mock_interview_columns()
