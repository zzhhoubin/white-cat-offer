"""PDF 抽字：水印条件化，避免误杀「京东」「扫码」正文。"""

from resume_parser import _is_resume_watermark_block, _light_normalize_extracted_text, clean_resume_text


def test_watermark_keeps_company_and_scan_metrics():
    assert _is_resume_watermark_block("京东商城") is True
    assert _is_resume_watermark_block("招聘专用") is True
    assert _is_resume_watermark_block("扫码下载完整简历") is True
    assert _is_resume_watermark_block("➢ 京东 经营分析 2020.10 — 2023.04") is False
    assert (
        _is_resume_watermark_block(
            "【背景】充电场站贴快电二维码，主要围绕码样式测试，扫码转化漏斗进行优化"
        )
        is False
    )
    assert _is_resume_watermark_block("从0到1搭建京东小家业务指标体系") is False


def test_light_normalize_keeps_year_dates():
    src = "➢ 能链智电 商业分析 2023.04 — 至今\n➢ 2011.9-2014.7 长江大学"
    out = _light_normalize_extracted_text(src)
    assert "2023.04" in out
    assert "2011.9-2014.7" in out
    assert "\n3.04" not in out


def test_clean_line_engine_skips_aggressive_date_split():
    raw = (
        "<!--extract_engine:pymupdf_blocks-->\n"
        "基础信息\n"
        "➢ 能链智电 商业分析 2023.04 — 至今\n"
        "【经营分析】：搭建日/周/月报\n"
    )
    cleaned, _ = clean_resume_text(raw)
    assert "2023.04" in cleaned
    assert "023.04" not in cleaned.replace("2023.04", "")
