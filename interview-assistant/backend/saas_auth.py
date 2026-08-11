"""SaaS authentication and tenant identification backed by SQLAlchemy."""

import hashlib
import secrets
import time
from dataclasses import dataclass

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from config import settings
from database import SessionLocal, init_db
from models import AuthToken, User

DEMO_USER_ID = "demo-user"
DEMO_USER = {
    "user_id": DEMO_USER_ID,
    "username": "demo",
    "email": "demo@example.com",
    "is_admin": True,
}


@dataclass
class AuthUser:
    user_id: str
    username: str
    email: str
    is_admin: bool = False

    def to_dict(self) -> dict:
        return {
            "user_id": self.user_id,
            "username": self.username,
            "email": self.email,
            "is_admin": self.is_admin,
        }


class AuthService:
    def __init__(self):
        init_db()
        self._ensure_first_admin()

    def register(self, username: str, email: str, password: str) -> dict:
        username = (username or "").strip()
        email = (email or "").strip().lower()
        if not username or not email or not password:
            return {"ok": False, "error": "用户名、邮箱和密码不能为空"}
        if len(password) < 6:
            return {"ok": False, "error": "密码至少 6 位"}

        user_id = secrets.token_hex(8)
        salt, password_hash = _hash_password(password)
        user = User(
            user_id=user_id,
            username=username,
            email=email,
            password_hash=password_hash,
            password_salt=salt,
            is_admin=False,
            created_at=time.time(),
        )
        try:
            with SessionLocal() as db:
                db.add(user)
                db.commit()
            token = self._issue_token(user_id)
            return {"ok": True, "token": token, "user": self.get_user(user_id).to_dict()}
        except IntegrityError:
            return {"ok": False, "error": "用户名或邮箱已存在"}

    def login(self, username_or_email: str, password: str) -> dict:
        account = (username_or_email or "").strip().lower()
        with SessionLocal() as db:
            user = db.scalar(
                select(User).where(
                    or_(
                        func.lower(User.username) == account,
                        func.lower(User.email) == account,
                    )
                )
            )
        if not user or not _verify_password(password, user.password_salt, user.password_hash):
            return {"ok": False, "error": "账号或密码错误"}
        token = self._issue_token(user.user_id)
        return {"ok": True, "token": token, "user": _model_to_user(user).to_dict()}

    def get_user(self, user_id: str) -> AuthUser | None:
        if user_id == DEMO_USER_ID:
            return AuthUser(**DEMO_USER)
        with SessionLocal() as db:
            user = db.get(User, user_id)
        return _model_to_user(user) if user else None

    def list_users(self) -> list[dict]:
        with SessionLocal() as db:
            rows = db.execute(
                select(
                    User.user_id,
                    User.username,
                    User.email,
                    User.is_admin,
                    User.created_at,
                    func.max(AuthToken.created_at).label("last_login_at"),
                    func.count(AuthToken.token).label("token_count"),
                )
                .outerjoin(AuthToken, User.user_id == AuthToken.user_id)
                .group_by(User.user_id, User.username, User.email, User.is_admin, User.created_at)
                .order_by(User.created_at.desc())
            ).all()

        users = [
            {
                "user_id": row.user_id,
                "username": row.username,
                "email": row.email,
                "is_admin": bool(row.is_admin),
                "created_at": row.created_at,
                "last_login_at": row.last_login_at,
                "token_count": row.token_count,
            }
            for row in rows
        ]
        if not settings.require_auth:
            users.insert(0, {**DEMO_USER, "created_at": 0, "last_login_at": None, "token_count": 1})
        return users

    def stats(self) -> dict:
        now = time.time()
        with SessionLocal() as db:
            user_count = db.scalar(select(func.count(User.user_id))) or 0
            admin_count = db.scalar(select(func.count(User.user_id)).where(User.is_admin.is_(True))) or 0
            active_tokens = db.scalar(select(func.count(AuthToken.token)).where(AuthToken.expires_at > now)) or 0
        if not settings.require_auth:
            user_count += 1
            admin_count += 1
            active_tokens += 1
        return {
            "user_count": user_count,
            "admin_count": admin_count,
            "active_tokens": active_tokens,
            "require_auth": settings.require_auth,
            "database_url": settings.database_url,
        }

    def user_from_token(self, token: str) -> AuthUser | None:
        token = (token or "").strip()
        if token == "demo-user-token" and not settings.require_auth:
            return AuthUser(**DEMO_USER)
        now = time.time()
        with SessionLocal() as db:
            auth_token = db.scalar(
                select(AuthToken)
                .where(AuthToken.token == token)
                .where(AuthToken.expires_at > now)
            )
            if not auth_token:
                return None
            user = auth_token.user
        return _model_to_user(user) if user else None

    def _issue_token(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        row = AuthToken(
            token=token,
            user_id=user_id,
            created_at=time.time(),
            expires_at=time.time() + settings.token_ttl_hours * 3600,
        )
        with SessionLocal() as db:
            db.add(row)
            db.commit()
        return token

    def _ensure_first_admin(self) -> None:
        if not settings.first_admin_password:
            return
        with SessionLocal() as db:
            exists = db.scalar(select(User).where(User.is_admin.is_(True)).limit(1))
            if exists:
                return
            salt, password_hash = _hash_password(settings.first_admin_password)
            db.add(
                User(
                    user_id=secrets.token_hex(8),
                    username=settings.first_admin_username,
                    email=settings.first_admin_email.lower(),
                    password_hash=password_hash,
                    password_salt=salt,
                    is_admin=True,
                    created_at=time.time(),
                )
            )
            db.commit()


def _hash_password(password: str) -> tuple[str, str]:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return salt, digest.hex()


def _verify_password(password: str, salt: str, expected: str) -> bool:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return secrets.compare_digest(digest.hex(), expected)


def _model_to_user(user: User) -> AuthUser:
    return AuthUser(
        user_id=user.user_id,
        username=user.username,
        email=user.email,
        is_admin=bool(user.is_admin),
    )
