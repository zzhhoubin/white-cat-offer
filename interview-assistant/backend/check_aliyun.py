"""阿里云语音识别连通性自检。

填好 backend/.env 里的 Appkey + AK/SK（或 Token）后运行：
    python check_aliyun.py
能看到 Token 换取是否成功、配置是否齐全。
"""

from config import settings
from stt.aliyun import _resolve_token


def main() -> None:
    print(f"STT_PROVIDER     = {settings.stt_provider}")
    print(f"MOCK_MODE        = {settings.mock_mode}")
    print(f"ALIYUN_NLS_APPKEY= {'已填' if settings.nls_appkey else '【缺失】'}")
    has_token = bool(settings.nls_token)
    has_aksk = bool(settings.nls_access_key_id and settings.nls_access_key_secret)
    print(f"凭证方式          = {'显式 Token' if has_token else 'AK/SK 自动换取' if has_aksk else '【都没填】'}")

    if not settings.nls_appkey:
        print("\n[X] 缺少 ALIYUN_NLS_APPKEY，请先在 .env 填写。")
        return
    if not (has_token or has_aksk):
        print("\n[X] 既没填 Token 也没填 AK/SK，无法连接。")
        return

    try:
        token = _resolve_token()
    except Exception as exc:  # noqa: BLE001
        print(f"\n[X] 换取 Token 失败：{exc}")
        print("    请检查 AccessKey 是否正确、是否开通了智能语音交互服务。")
        return

    if token:
        print(f"\n[OK] Token 获取成功（前 8 位：{token[:8]}...）。阿里云配置可用，可启动后端。")
    else:
        print("\n[X] 未拿到 Token，请检查配置。")


if __name__ == "__main__":
    main()
