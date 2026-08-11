"""STT 抽象接口：所有语音识别 provider 的统一契约。

上层（app.py）只依赖这个接口，不关心底层是阿里云/腾讯云/本地 Whisper。
用法：
    s = create_stt_session(loop)   # 见 stt/__init__.py
    await s.start()
    await s.feed(pcm_bytes)         # 持续喂 16k/16bit/单声道 PCM
    text = await s.final_queue.get()  # 拿到一句完整识别结果
    await s.stop()
"""

import asyncio


class STTSession:
    """语音识别会话基类。识别到「完整一句」时放入 final_queue。"""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        self.final_queue: "asyncio.Queue[str]" = asyncio.Queue()
        self.error_queue: "asyncio.Queue[str]" = asyncio.Queue()
        self._started = False

    async def start(self) -> None:  # pragma: no cover - 由子类实现
        self._started = True

    async def feed(self, pcm: bytes) -> None:  # pragma: no cover
        return

    async def stop(self) -> None:  # pragma: no cover
        self._started = False

    def push_mock_text(self, text: str) -> None:
        """注入一句模拟/外部识别结果（mock 模式或文本输入用）。"""
        self.final_queue.put_nowait(text)


class NullSTTSession(STTSession):
    """Mock 模式专用：不连接任何云服务，识别结果完全来自 push_mock_text。"""

    async def start(self) -> None:
        self._started = True

    async def feed(self, pcm: bytes) -> None:
        return

    async def stop(self) -> None:
        self._started = False
