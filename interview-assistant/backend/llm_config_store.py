"""Per-user LLM provider configuration (OpenAI-compatible)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data" / "llm_configs"

# 主流 OpenAI 兼容服务商预设（前端列表 + 默认端点/模型）
PROVIDER_PRESETS: list[dict[str, Any]] = [
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "hint": "在 DeepSeek 开放平台获取 API 密钥",
        "docs_url": "https://platform.deepseek.com/api_keys",
        "default_base_url": "https://api.deepseek.com",
        "default_model": "deepseek-chat",
    },
    {
        "id": "doubao",
        "name": "豆包",
        "hint": "在火山引擎方舟 / 豆包开放平台获取 API 密钥与接入点",
        "docs_url": "https://console.volcengine.com/ark",
        "default_base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "default_model": "",
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "hint": "在 OpenAI 或兼容 OpenAI 格式的开放平台获取 API 密钥",
        "docs_url": "https://platform.openai.com/api-keys",
        "default_base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini",
    },
    {
        "id": "gemini",
        "name": "Gemini",
        "hint": "使用 Google AI Studio 的 API Key；端点为 OpenAI 兼容地址",
        "docs_url": "https://aistudio.google.com/apikey",
        "default_base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "default_model": "gemini-2.0-flash",
    },
    {
        "id": "qwen",
        "name": "千问",
        "hint": "在阿里云百炼 / DashScope 获取 API 密钥（OpenAI 兼容模式）",
        "docs_url": "https://bailian.console.aliyun.com/",
        "default_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus",
    },
    {
        "id": "kimi",
        "name": "Kimi",
        "hint": "在月之暗面 Moonshot 开放平台获取 API 密钥",
        "docs_url": "https://platform.moonshot.cn/console/api-keys",
        "default_base_url": "https://api.moonshot.cn/v1",
        "default_model": "moonshot-v1-8k",
    },
]

_PRESET_MAP = {p["id"]: p for p in PROVIDER_PRESETS}


def _path(user_id: str) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in (user_id or "demo"))
    return DATA_DIR / f"{safe}.json"


def _default_store() -> dict:
    return {
        "active_provider": "deepseek",
        "providers": {
            p["id"]: {
                "api_key": "",
                "model_id": p["default_model"],
                "base_url": p["default_base_url"],
            }
            for p in PROVIDER_PRESETS
        },
    }


def load_user_llm_config(user_id: str) -> dict:
    path = _path(user_id)
    data = _default_store()
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                if raw.get("active_provider"):
                    data["active_provider"] = str(raw["active_provider"])
                providers = raw.get("providers") or {}
                if isinstance(providers, dict):
                    for pid, conf in providers.items():
                        if not isinstance(conf, dict):
                            continue
                        slot = data["providers"].setdefault(
                            pid,
                            {"api_key": "", "model_id": "", "base_url": ""},
                        )
                        if "api_key" in conf:
                            slot["api_key"] = str(conf.get("api_key") or "")
                        if "model_id" in conf:
                            slot["model_id"] = str(conf.get("model_id") or "")
                        if "base_url" in conf:
                            slot["base_url"] = str(conf.get("base_url") or "")
        except Exception:
            pass
    return data


def save_user_llm_config(user_id: str, data: dict) -> dict:
    current = load_user_llm_config(user_id)
    active = str(data.get("active_provider") or current["active_provider"] or "deepseek")
    current["active_provider"] = active

    incoming = data.get("providers")
    if isinstance(incoming, dict):
        for pid, conf in incoming.items():
            if not isinstance(conf, dict):
                continue
            slot = current["providers"].setdefault(
                str(pid),
                {"api_key": "", "model_id": "", "base_url": ""},
            )
            if "model_id" in conf:
                slot["model_id"] = str(conf.get("model_id") or "").strip()
            if "base_url" in conf:
                slot["base_url"] = str(conf.get("base_url") or "").strip()
            # 空字符串表示不改 Key（前端掩码场景）；显式 null/清空用特殊标记
            if "api_key" in conf:
                key = conf.get("api_key")
                if key is None:
                    continue
                key = str(key).strip()
                if key and not _is_masked_key(key):
                    slot["api_key"] = key
                elif key == "":
                    # 允许显式清空：传 clear_api_key
                    pass
            if conf.get("clear_api_key"):
                slot["api_key"] = ""

    path = _path(user_id)
    path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return current


def _is_masked_key(key: str) -> bool:
    return "*" in key or key.startswith("sk-***") or key.endswith("****")


def mask_api_key(key: str) -> str:
    key = (key or "").strip()
    if not key:
        return ""
    if len(key) <= 8:
        return "*" * len(key)
    return key[:3] + "***" + key[-4:]


def public_config_view(user_id: str) -> dict:
    """前端展示：预设列表 + 当前配置（Key 脱敏）。"""
    store = load_user_llm_config(user_id)
    providers_out = []
    for preset in PROVIDER_PRESETS:
        pid = preset["id"]
        conf = store["providers"].get(pid) or {}
        key = conf.get("api_key") or ""
        providers_out.append(
            {
                **preset,
                "configured": bool(key),
                "api_key_masked": mask_api_key(key),
                "model_id": conf.get("model_id") or preset["default_model"],
                "base_url": conf.get("base_url") or preset["default_base_url"],
            }
        )
    # 自定义服务商（不在预设里）也带上
    for pid, conf in store["providers"].items():
        if pid in _PRESET_MAP:
            continue
        key = conf.get("api_key") or ""
        providers_out.append(
            {
                "id": pid,
                "name": pid,
                "hint": "自定义 OpenAI 兼容服务商",
                "docs_url": "",
                "default_base_url": conf.get("base_url") or "",
                "default_model": conf.get("model_id") or "",
                "configured": bool(key),
                "api_key_masked": mask_api_key(key),
                "model_id": conf.get("model_id") or "",
                "base_url": conf.get("base_url") or "",
            }
        )
    return {
        "active_provider": store.get("active_provider") or "deepseek",
        "providers": providers_out,
    }


def resolve_active_credentials(user_id: str | None) -> dict | None:
    """返回当前用户激活服务商凭证；未配置 API Key 则 None。"""
    if not user_id:
        return None
    store = load_user_llm_config(user_id)
    pid = store.get("active_provider") or "deepseek"
    conf = store["providers"].get(pid) or {}
    api_key = (conf.get("api_key") or "").strip()
    if not api_key:
        return None
    preset = _PRESET_MAP.get(pid) or {}
    base_url = (conf.get("base_url") or preset.get("default_base_url") or "").strip()
    model_id = (conf.get("model_id") or preset.get("default_model") or "").strip()
    return {
        "provider": pid,
        "api_key": api_key,
        "base_url": base_url.rstrip("/") if base_url else "",
        "model_id": model_id,
    }
