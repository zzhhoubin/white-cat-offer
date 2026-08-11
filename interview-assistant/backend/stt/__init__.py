"""STT provider 工厂：根据配置返回对应的语音识别会话。"""

import asyncio

from config import settings
from stt.base import STTSession


def create_stt_session(loop: asyncio.AbstractEventLoop) -> STTSession:
    provider = (settings.stt_provider or "aliyun").strip().lower()
    if provider == "aliyun":
        from stt.aliyun import AliyunSTTSession

        return AliyunSTTSession(loop)
    if provider == "tencent":
        from stt.tencent import TencentSTTSession

        return TencentSTTSession(loop)
    if provider == "whisper":
        from stt.whisper import WhisperSTTSession

        return WhisperSTTSession(loop)
    if provider == "funasr":
        from stt.funasr import FunASRSTTSession

        return FunASRSTTSession(loop)

    raise RuntimeError(f"未知的 STT_PROVIDER：{provider}（可选 aliyun / tencent / whisper / funasr）")


__all__ = ["create_stt_session", "STTSession"]
