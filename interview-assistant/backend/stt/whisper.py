"""本地 Whisper 语音识别 provider（离线、免云服务）。

依赖：
    pip install faster-whisper numpy
首次使用会自动下载模型权重（WHISPER_MODEL，默认 small）。

实现说明：实时流式识别用本地模型较难做到逐字低延迟，这里采用
「定时窗口」策略：累积约 N 秒音频后整段转写一次，配合 VAD 过滤静音。
延迟换来零云成本和数据不出本机，适合内测/隐私敏感场景。
"""

import asyncio

from config import settings
from stt.base import STTSession

# 每累积约这么多秒的音频转写一次
_WINDOW_SECONDS = 3.0


class WhisperSTTSession(STTSession):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        super().__init__(loop)
        self._model = None
        self._buffer = bytearray()
        self._task: "asyncio.Task | None" = None
        self._bytes_per_window = int(settings.sample_rate * 2 * _WINDOW_SECONDS)

    async def start(self) -> None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "未安装本地 Whisper 依赖，请先 pip install faster-whisper numpy"
            ) from exc

        self._model = await self._loop.run_in_executor(
            None,
            lambda: WhisperModel(
                settings.whisper_model,
                device=settings.whisper_device,
                compute_type="int8",
            ),
        )
        self._started = True
        self._task = self._loop.create_task(self._flush_loop())

    async def feed(self, pcm: bytes) -> None:
        if not self._started:
            return
        self._buffer.extend(pcm)

    async def _flush_loop(self) -> None:
        while self._started:
            await asyncio.sleep(0.5)
            if len(self._buffer) >= self._bytes_per_window:
                chunk = bytes(self._buffer)
                self._buffer.clear()
                await self._transcribe(chunk)

    async def _transcribe(self, pcm: bytes) -> None:
        import numpy as np

        audio = np.frombuffer(pcm, dtype=np.int16).astype("float32") / 32768.0

        def _run():
            segments, _ = self._model.transcribe(audio, language="zh", vad_filter=True)
            return "".join(seg.text for seg in segments).strip()

        try:
            text = await self._loop.run_in_executor(None, _run)
        except Exception:
            text = ""
        if text:
            await self.final_queue.put(text)

    async def stop(self) -> None:
        self._started = False
        if self._task:
            self._task.cancel()
            self._task = None
        # 转写残余音频
        if self._buffer and self._model is not None:
            chunk = bytes(self._buffer)
            self._buffer.clear()
            await self._transcribe(chunk)
