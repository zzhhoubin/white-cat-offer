"""腾讯云实时语音识别 provider。

依赖腾讯云语音 SDK：
    pip install tencentcloud-speech-sdk-python
凭证：在腾讯云控制台获取 AppId / SecretId / SecretKey。

SDK 同样是回调 + 线程模型，这里把识别结果桥接到 asyncio.Queue。
"""

import asyncio

from config import settings
from stt.base import STTSession

# 中文 16k 实时识别引擎
_ENGINE_MODEL_TYPE = "16k_zh"


class TencentSTTSession(STTSession):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        super().__init__(loop)
        self._recognizer = None

    async def start(self) -> None:
        if not (settings.tencent_appid and settings.tencent_secret_id and settings.tencent_secret_key):
            raise RuntimeError(
                "未配置 TENCENT_APPID / TENCENT_SECRET_ID / TENCENT_SECRET_KEY，无法启动腾讯云语音识别。"
            )

        try:
            from tencentcloud.common import credential
            from tencentcloud.asr import speech_recognizer
        except ImportError as exc:
            raise RuntimeError(
                "未安装腾讯云语音 SDK，请先 pip install tencentcloud-speech-sdk-python"
            ) from exc

        loop = self._loop
        queue = self.final_queue

        class _Listener(speech_recognizer.SpeechRecognitionListener):
            def on_recognition_start(self, response):
                pass

            def on_sentence_begin(self, response):
                pass

            def on_recognition_result_change(self, response):
                pass  # 中间结果忽略，只取整句

            def on_sentence_end(self, response):
                try:
                    text = response["result"]["voice_text_str"].strip()
                except Exception:
                    text = ""
                if text:
                    asyncio.run_coroutine_threadsafe(queue.put(text), loop)

            def on_recognition_complete(self, response):
                pass

            def on_fail(self, response):
                pass

        cred = credential.Credential(settings.tencent_secret_id, settings.tencent_secret_key)
        recognizer = speech_recognizer.SpeechRecognizer(
            settings.tencent_appid, cred, _ENGINE_MODEL_TYPE, _Listener()
        )
        recognizer.set_voice_format(1)  # 1 = pcm
        recognizer.set_filter_modal(0)
        recognizer.set_filter_punc(0)
        recognizer.set_need_vad(1)

        await loop.run_in_executor(None, recognizer.start)
        self._recognizer = recognizer
        self._started = True

    async def feed(self, pcm: bytes) -> None:
        if not self._started or self._recognizer is None:
            return
        await self._loop.run_in_executor(None, self._recognizer.write, pcm)

    async def stop(self) -> None:
        if self._recognizer is not None:
            try:
                await self._loop.run_in_executor(None, self._recognizer.stop)
            except Exception:
                pass
        self._started = False
