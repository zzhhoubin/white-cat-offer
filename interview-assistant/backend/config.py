"""集中管理后端配置。所有密钥从环境变量 / .env 读取，避免硬编码。"""

import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

# 始终从 backend/.env 加载，避免从仓库根目录启动时读不到配置
_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"), override=False)


def _get_bool(key: str, default: bool) -> bool:
    val = os.getenv(key)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _funasr_chunk_size() -> list[int]:
    return [int(x) for x in os.getenv("FUNASR_CHUNK_SIZE", "0,10,5").split(",")]


@dataclass
class Settings:
    # WebSocket 服务监听地址
    host: str = os.getenv("WS_HOST", "127.0.0.1")
    port: int = int(os.getenv("WS_PORT", "8765"))

    # 已废弃：全局 Mock 模式关闭，所有能力依赖真实 STT / LLM 配置
    mock_mode: bool = _get_bool("MOCK_MODE", False)

    # SaaS 基础配置：默认保持 Demo 免登录；部署时将 REQUIRE_AUTH=true。
    database_url: str = os.getenv(
        "DATABASE_URL",
        "sqlite:///./data/app.db",
    )
    require_auth: bool = _get_bool("REQUIRE_AUTH", False)
    token_ttl_hours: int = int(os.getenv("TOKEN_TTL_HOURS", "168"))
    first_admin_username: str = os.getenv("FIRST_ADMIN_USERNAME", "admin")
    first_admin_password: str = os.getenv("FIRST_ADMIN_PASSWORD", "")
    first_admin_email: str = os.getenv("FIRST_ADMIN_EMAIL", "admin@example.com")

    # 语音识别 STT 提供商：aliyun | tencent | whisper | funasr（换厂商只改这一项 + 对应密钥）
    stt_provider: str = os.getenv("STT_PROVIDER", "aliyun")

    # —— 阿里云实时语音识别（NLS / 智能语音交互）——
    nls_url: str = os.getenv(
        "ALIYUN_NLS_URL", "wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1"
    )
    nls_appkey: str = os.getenv("ALIYUN_NLS_APPKEY", "")
    nls_token: str = os.getenv("ALIYUN_NLS_TOKEN", "")
    # 也可用 AK/SK 自动换取 token（二选一，优先使用上面的 token）
    nls_access_key_id: str = os.getenv("ALIYUN_ACCESS_KEY_ID", "")
    nls_access_key_secret: str = os.getenv("ALIYUN_ACCESS_KEY_SECRET", "")

    # —— 腾讯云实时语音识别 ——（pip install tencentcloud-speech-sdk-python）
    tencent_appid: str = os.getenv("TENCENT_APPID", "")
    tencent_secret_id: str = os.getenv("TENCENT_SECRET_ID", "")
    tencent_secret_key: str = os.getenv("TENCENT_SECRET_KEY", "")

    # —— 本地 Whisper（离线，pip install faster-whisper numpy）——
    whisper_model: str = os.getenv("WHISPER_MODEL", "small")
    whisper_device: str = os.getenv("WHISPER_DEVICE", "cpu")

    # —— FunASR 流式（本地，pip install funasr numpy）——
    funasr_model: str = os.getenv("FUNASR_MODEL", "paraformer-zh-streaming")
    funasr_punc_model: str = os.getenv("FUNASR_PUNC_MODEL", "ct-punc")
    # chunk_size: [unused, center, lookahead]，单位 60ms；[0,10,5] ≈ 600ms 粒度 + 300ms 前瞻
    funasr_chunk_size: list[int] = field(default_factory=_funasr_chunk_size)
    funasr_encoder_chunk_look_back: int = int(os.getenv("FUNASR_ENCODER_CHUNK_LOOK_BACK", "4"))
    funasr_decoder_chunk_look_back: int = int(os.getenv("FUNASR_DECODER_CHUNK_LOOK_BACK", "1"))

    # 音频参数（必须与桌面端采集保持一致）
    sample_rate: int = int(os.getenv("SAMPLE_RATE", "16000"))

    # AI 模拟面试
    mock_interview_default_questions: int = int(os.getenv("MOCK_INTERVIEW_DEFAULT_QUESTIONS", "8"))
    mock_interview_max_questions: int = int(os.getenv("MOCK_INTERVIEW_MAX_QUESTIONS", "12"))
    mock_interview_voice_enabled: bool = _get_bool("MOCK_INTERVIEW_VOICE_ENABLED", True)

    # LLM 凭证已改为用户在前端「我的 → AI 服务商」配置，不再从 .env 读取
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""

    # 用户简历 / 个人素材（Demo 阶段用一段文本占位，后续接素材库）
    resume_text: str = os.getenv("RESUME_TEXT", "")

    # MinerU PDF 解析（需 Python 3.10–3.13；本项目统一用 D:/quant/venv）
    mineru_enabled: bool = _get_bool("MINERU_ENABLED", True)
    mineru_python: str = os.getenv("MINERU_PYTHON", "")  # 空则用当前解释器
    mineru_backend: str = os.getenv("MINERU_BACKEND", "pipeline")
    mineru_method: str = os.getenv("MINERU_METHOD", "auto")
    mineru_model_source: str = os.getenv("MINERU_MODEL_SOURCE", "modelscope")
    mineru_ocr_images: bool = _get_bool("MINERU_OCR_IMAGES", True)
    mineru_timeout_sec: int = int(os.getenv("MINERU_TIMEOUT_SEC", "600"))

    # 项目库平台服务费比例（作者分成 = 1 - 该比例）。临时值，可随时调整。
    project_platform_rate: float = float(os.getenv("PROJECT_PLATFORM_RATE", "0.2"))

    # 资料库原始文件落盘目录（相对 backend/）
    material_docs_dir: str = os.getenv(
        "MATERIAL_DOCS_DIR",
        os.path.join(_BACKEND_DIR, "data", "material_docs"),
    )

    # —— 面经雷达：牛客/小红书 cookie（可选，不配则只走 LLM + 公开源）——
    nowcoder_cookie: str = os.getenv("NOWCODER_COOKIE", "")
    xhs_web_session: str = os.getenv("XHS_WEB_SESSION", "")
    # MediaCrawler 安装路径（小红书 driver 模式用）
    mediacrawler_home: str = os.getenv("MEDIACRAWLER_HOME", os.path.expanduser("~/.mediacrawler"))

settings = Settings()
