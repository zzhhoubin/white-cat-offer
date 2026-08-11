"""Shared LLM client helpers — use per-user AI provider config only (no .env fallback)."""

from __future__ import annotations

from contextvars import ContextVar

_llm_user_id: ContextVar[str | None] = ContextVar("llm_user_id", default=None)


class LLMNotConfiguredError(RuntimeError):
    """Raised when the current user has no LLM API Key configured."""


class LLMServiceError(RuntimeError):
    """Raised when an LLM API call fails."""


def set_llm_user(user_id: str | None) -> None:
    """Bind current request user for subsequent openai_client() / get_llm_model()."""
    _llm_user_id.set(user_id)


def get_llm_user() -> str | None:
    return _llm_user_id.get()


def resolve_llm_credentials() -> tuple[str, str, str]:
    """Return (base_url, api_key, model_id) from the bound user's AI provider config."""
    user_id = _llm_user_id.get()
    if user_id:
        try:
            from llm_config_store import resolve_active_credentials

            cred = resolve_active_credentials(user_id)
            if cred and cred.get("api_key"):
                return cred["base_url"], cred["api_key"], cred["model_id"]
        except Exception:
            pass
    return "", "", ""


def get_llm_model() -> str:
    return resolve_llm_credentials()[2]


def require_llm_config() -> None:
    _, api_key, _ = resolve_llm_credentials()
    if not api_key:
        raise LLMNotConfiguredError(
            "未配置 LLM API Key。请在「我的 → AI 服务商」中填写并设为默认。"
        )


def openai_client():
    require_llm_config()
    from openai import OpenAI

    base_url, api_key, _ = resolve_llm_credentials()
    return OpenAI(api_key=api_key, base_url=base_url or None)


async def async_openai_client():
    require_llm_config()
    from openai import AsyncOpenAI

    base_url, api_key, _ = resolve_llm_credentials()
    return AsyncOpenAI(api_key=api_key, base_url=base_url or None)
