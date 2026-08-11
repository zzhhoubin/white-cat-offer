"""共享 Playwright 浏览器实例 —— 复用浏览器避免多次启动。"""
import logging
from contextlib import contextmanager

logger = logging.getLogger(__name__)

_browser = None
_playwright = None


def _get_browser():
    """获取或创建全局 Playwright Chromium 浏览器实例。"""
    global _browser, _playwright
    if _browser is None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError("playwright 未安装，请执行: pip install playwright && playwright install chromium")
        _playwright = sync_playwright().start()
        _browser = _playwright.chromium.launch(
            headless=True,
            args=[
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        logger.info("Playwright browser launched")
    return _browser


@contextmanager
def new_page(timeout_ms: int = 15000):
    """创建一个带超时的浏览器页面上下文。"""
    browser = _get_browser()
    context = browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        locale="zh-CN",
        extra_http_headers={
            "Accept-Language": "zh-CN,zh;q=0.9",
        },
    )
    page = context.new_page()
    page.set_default_timeout(timeout_ms)
    try:
        yield page
    finally:
        page.close()
        context.close()


def fetch_text(url: str, timeout_ms: int = 12000, wait_selector: str = None) -> str:
    """用 Playwright 获取页面全文（渲染后）。"""
    with new_page(timeout_ms) as page:
        try:
            page.goto(url, wait_until="domcontentloaded")
        except Exception:
            # 超时也尝试读内容
            pass
        if wait_selector:
            try:
                page.wait_for_selector(wait_selector, timeout=5000)
            except Exception:
                pass
        # 额外等待动态内容
        page.wait_for_timeout(1000)
        text = page.inner_text("body").strip()
        return text


def search_and_get_urls(search_url: str, link_selector: str, base_domain: str, max_results: int = 10) -> list[str]:
    """用 Playwright 执行搜索，提取结果 URL。

    search_url: 搜索引擎搜索 URL
    link_selector: 搜索结果项的链接选择器
    base_domain: 过滤用（排除搜索引擎自身链接）
    max_results: 最大结果数
    """
    urls = []
    with new_page() as page:
        try:
            page.goto(search_url, wait_until="domcontentloaded")
        except Exception:
            pass
        page.wait_for_timeout(2000)

        # 获取所有链接
        links = page.query_selector_all("a[href]")
        for link in links:
            href = link.get_attribute("href") or ""
            # 跳过搜索引擎自身链接和空链接
            if not href or not href.startswith("http"):
                continue
            if base_domain in href or "bing.com" in href or "baidu.com" in href:
                continue
            if any(skip in href for skip in ("login", "signin", "register", "captcha")):
                continue
            if href not in urls:
                urls.append(href)
            if len(urls) >= max_results:
                break

    return urls
