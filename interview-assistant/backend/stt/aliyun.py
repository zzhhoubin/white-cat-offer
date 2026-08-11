"""阿里云实时语音识别（NLS / 智能语音交互）provider。

阿里云 NLS 的 Python SDK 是回调 + 独立线程模型，这里把「识别到完整句子」
的回调桥接到 asyncio.Queue，方便上层 await 消费。
"""

import asyncio
import json
import time

from config import settings
from stt.base import STTSession

# Token 缓存：避免每次建链都重新换取（Token 默认 24h 有效）
_token_cache = {"token": "", "expire": 0.0}


def _create_token_from_ak() -> str:
    """用 AccessKey ID/Secret 调用 CreateToken，返回临时 Token 并缓存。"""
    now = time.time()
    # 提前 5 分钟过期，避免临界点失效
    if _token_cache["token"] and _token_cache["expire"] - 300 > now:
        return _token_cache["token"]

    from aliyunsdkcore.client import AcsClient
    from aliyunsdkcore.request import CommonRequest

    client = AcsClient(
        settings.nls_access_key_id, settings.nls_access_key_secret, "cn-shanghai"
    )
    req = CommonRequest()
    req.set_method("POST")
    req.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
    req.set_version("2019-02-28")
    req.set_action_name("CreateToken")
    resp = json.loads(client.do_action_with_exception(req))
    token_info = resp["Token"]
    _token_cache["token"] = token_info["Id"]
    _token_cache["expire"] = float(token_info["ExpireTime"])
    return token_info["Id"]


def _resolve_token() -> str:
    """优先用显式填写的 Token，否则用 AK/SK 自动换取。"""
    if settings.nls_token:
        return settings.nls_token
    if settings.nls_access_key_id and settings.nls_access_key_secret:
        return _create_token_from_ak()
    return ""


class AliyunSTTSession(STTSession):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        super().__init__(loop)
        self._transcriber = None

    async def start(self) -> None:
        if not settings.nls_appkey:
            raise RuntimeError(
                "未配置 ALIYUN_NLS_APPKEY，无法启动阿里云语音识别。"
            )
        token = await self._loop.run_in_executor(None, _resolve_token)
        if not token:
            raise RuntimeError(
                "未获取到阿里云 Token：请填写 ALIYUN_NLS_TOKEN，"
                "或填写 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET 让程序自动换取。"
            )

        import nls  # 延迟导入，未选用该 provider 时不强依赖

        def _on_sentence_end(message, *args):
            try:
                payload = json.loads(message)
                text = payload.get("payload", {}).get("result", "").strip()
            except Exception:
                text = ""
            if text:
                asyncio.run_coroutine_threadsafe(
                    self.final_queue.put(text), self._loop
                )

        self._transcriber = nls.NlsSpeechTranscriber(
            url=settings.nls_url,
            token=token,
            appkey=settings.nls_appkey,
            on_sentence_end=_on_sentence_end,
        )
        await self._loop.run_in_executor(
            None,
            lambda: self._transcriber.start(
                aformat="pcm",
                sample_rate=settings.sample_rate,
                enable_intermediate_result=False,
                enable_punctuation_prediction=True,
                enable_inverse_text_normalization=True,
            ),
        )
        self._started = True

    async def feed(self, pcm: bytes) -> None:
        if not self._started or self._transcriber is None:
            return
        await self._loop.run_in_executor(None, self._transcriber.send_audio, pcm)

    async def stop(self) -> None:
        if self._transcriber is not None:
            try:
                await self._loop.run_in_executor(None, self._transcriber.stop)
            except Exception:
                pass
        self._started = False
