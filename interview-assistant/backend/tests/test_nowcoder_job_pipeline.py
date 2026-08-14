# -*- coding: utf-8 -*-
"""Unit tests for nowcoder job pipeline helpers (no network)."""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from mianjing_radar.nowcoder_job_pipeline import (
    resolve_role_config,
    phase3_structure,
    _looks_like_interview,
)


def test_resolve_product_manager():
    cfg = resolve_role_config("\u4ea7\u54c1\u7ecf\u7406", "\u4ea7\u54c1", "IT")
    assert cfg["job_id"] == 11210
    assert "\u4ea7\u54c1\u7ecf\u7406" in cfg["title_include"]


def test_resolve_frontend():
    cfg = resolve_role_config(
        "\u524d\u7aef\u5de5\u7a0b\u5e08",
        "\u524d\u7aef & \u79fb\u52a8\u7aef",
        "IT",
    )
    assert cfg["job_id"] == 11201


def test_resolve_unknown_uses_l2_fallback():
    cfg = resolve_role_config("rare-role", "\u4ea7\u54c1", "IT")
    assert cfg["job_id"] == 11210


def test_looks_like_interview_and_structure():
    cfg = resolve_role_config("\u4ea7\u54c1\u7ecf\u7406", "\u4ea7\u54c1", "")
    title = "oppo \u4ea7\u54c1\u7ecf\u7406 \u4e00\u9762"
    text = (
        "\u4e00\u9762 \u7ea6 40 \u5206\u949f\n"
        "1. \u81ea\u6211\u4ecb\u7ecd\n"
        "2. \u5982\u4f55\u505a\u9700\u6c42\u5206\u6790\uff1f\n"
        "\u8ffd\u95ee\uff1a\n"
        "- \u7528\u8fc7\u54ea\u4e9b\u5de5\u5177\uff1f\n"
        "3. \u63cf\u8ff0\u4e00\u6b21\u9879\u76ee\u63a8\u8fdb\u7ecf\u5386\uff1f\n"
    )
    assert _looks_like_interview(text, title, cfg)
    items, stats = phase3_structure(
        [
            {
                "title": title,
                "text": text,
                "url": "https://www.nowcoder.com/discuss/1",
                "date": "2026-08-01",
            }
        ],
        cfg,
    )
    assert stats["rows"] == 1
    assert items[0]["campus"] in ("\u6821\u62db", "\u975e\u6821\u62db")
    assert items[0]["company"] == "oppo"
    assert "\u81ea\u6211\u4ecb\u7ecd" in items[0]["questions"]
