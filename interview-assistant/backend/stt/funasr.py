"""FunASR 流式语音识别 provider（本地推理，进程级模型单例）。"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import TYPE_CHECKING

from config import settings
from stt.base import STTSession

if TYPE_CHECKING:
    from funasr import AutoModel as AutoModelType

logger = logging.getLogger(__name__)

_thread_lock = threading.Lock()
_asr_model: "AutoModelType | None" = None
_punc_model: "AutoModelType | None" = None


def _extract_text(result) -> str:
    if not result:
        return ""
    if isinstance(result, dict):
        return str(result.get("text") or result.get("sentence") or "").strip()
    if isinstance(result, list):
        if not result:
            return ""
        if isinstance(result[0], dict):
            return str(result[0].get("text") or result[0].get("sentence") or "").strip()
        return str(result[0]).strip()
    return str(result).strip()


def _load_asr_model():
    global _asr_model
    if _asr_model is not None:
        return _asr_model
    with _thread_lock:
        if _asr_model is not None:
            return _asr_model
        try:
            from funasr import AutoModel
        except ImportError as exc:
            raise RuntimeError("未安装 FunASR 依赖，请先 pip install funasr numpy torch") from exc
        logger.info("Loading FunASR streaming model: %s", settings.funasr_model)
        _asr_model = AutoModel(
            model=settings.funasr_model,
            disable_update=True,
        )
        return _asr_model


def _load_punc_model():
    global _punc_model
    if not settings.funasr_punc_model:
        return None
    if _punc_model is not None:
        return _punc_model
    with _thread_lock:
        if _punc_model is not None:
            return _punc_model
        from funasr import AutoModel

        logger.info("Loading FunASR punctuation model: %s", settings.funasr_punc_model)
        _punc_model = AutoModel(
            model=settings.funasr_punc_model,
            disable_update=True,
        )
        return _punc_model


def _apply_punc(text: str) -> str:
    if not text.strip():
        return text
    model = _load_punc_model()
    if model is None:
        return text
    try:
        result = model.generate(input=text)
        return _extract_text(result) or text
    except Exception:
        logger.exception("FunASR punctuation failed")
        return text


async def preload_models(loop: asyncio.AbstractEventLoop) -> None:
    """后端启动时预加载模型，避免首次语音会话长时间等待。"""
    await loop.run_in_executor(None, _load_asr_model)
    if settings.funasr_punc_model:
        await loop.run_in_executor(None, _load_punc_model)
    logger.info("FunASR models ready")


class FunASRSTTSession(STTSession):
    def __init__(self, loop: asyncio.AbstractEventLoop):
        super().__init__(loop)
        self._model = None
        self._buffer = bytearray()
        self._cache: dict = {}
        self._transcript = ""
        self._last_emitted = ""
        self._chunk_size = list(settings.funasr_chunk_size)
        self._encoder_lookback = settings.funasr_encoder_chunk_look_back
        self._decoder_lookback = settings.funasr_decoder_chunk_look_back
        center = self._chunk_size[1] if len(self._chunk_size) > 1 else 10
        self._bytes_per_chunk = center * 960 * 2
        self._infer_lock = asyncio.Lock()
        self._flush_task: asyncio.Task | None = None
        self._stopping = False

    async def start(self) -> None:
        self._model = await self._loop.run_in_executor(None, _load_asr_model)
        self._started = True
        self._stopping = False
        self._schedule_flush()

    async def feed(self, pcm: bytes) -> None:
        if not pcm:
            return
        self._buffer.extend(pcm)
        if self._started:
            self._schedule_flush()

    def _schedule_flush(self) -> None:
        if self._flush_task and not self._flush_task.done():
            return
        self._flush_task = self._loop.create_task(self._flush_worker())

    async def _flush_worker(self) -> None:
        try:
            while len(self._buffer) >= self._bytes_per_chunk and (self._started or self._stopping):
                chunk = bytes(self._buffer[: self._bytes_per_chunk])
                del self._buffer[: self._bytes_per_chunk]
                await self._infer(chunk, is_final=False)
        except Exception as exc:
            logger.exception("FunASR flush failed")
            await self.error_queue.put(str(exc))

    async def _infer(self, pcm: bytes, *, is_final: bool) -> None:
        if self._model is None:
            return

        import numpy as np

        audio = (
            np.frombuffer(pcm, dtype=np.int16).astype("float32") / 32768.0
            if pcm
            else np.zeros(0, dtype="float32")
        )

        def _run():
            return self._model.generate(
                input=audio,
                cache=self._cache,
                is_final=is_final,
                chunk_size=self._chunk_size,
                encoder_chunk_look_back=self._encoder_lookback,
                decoder_chunk_look_back=self._decoder_lookback,
            )

        async with self._infer_lock:
            try:
                result = await self._loop.run_in_executor(None, _run)
            except Exception as exc:
                logger.exception("FunASR inference failed")
                await self.error_queue.put(str(exc))
                return
            delta = _extract_text(result)
            if delta:
                self._transcript += delta
            await self._emit_transcript()

    async def _emit_transcript(self) -> None:
        if self._transcript and self._transcript != self._last_emitted:
            self._last_emitted = self._transcript
            await self.final_queue.put(self._transcript)

    async def stop(self) -> None:
        self._stopping = True
        self._started = False
        if self._flush_task and not self._flush_task.done():
            await self._flush_task
        try:
            if self._buffer and self._model is not None:
                chunk = bytes(self._buffer)
                self._buffer.clear()
                await self._infer(chunk, is_final=True)
            elif self._model is not None and self._transcript:
                await self._infer(b"", is_final=True)
            if self._transcript and settings.funasr_punc_model:
                punctuated = await self._loop.run_in_executor(None, _apply_punc, self._transcript)
                if punctuated != self._transcript:
                    self._transcript = punctuated
                    self._last_emitted = ""
                    await self._emit_transcript()
        except Exception as exc:
            logger.exception("FunASR stop failed")
            await self.error_queue.put(str(exc))
        finally:
            self._stopping = False
