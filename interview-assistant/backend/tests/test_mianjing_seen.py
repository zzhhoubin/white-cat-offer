# -*- coding: utf-8 -*-
"""Seen-ids helpers for mianjing re-fetch (no network)."""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from mianjing_radar.nowcoder_job_pipeline import (
    _cache_key,
    _mark_seen,
    _read_seen,
    _reset_seen,
    _normalize_post_id,
    SEEN_DIR,
)


def test_normalize_strips_query():
    assert (
        _normalize_post_id("https://www.nowcoder.com/discuss/1?x=1")
        == "https://www.nowcoder.com/discuss/1"
    )


def test_mark_seen_accumulates_and_reset(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "mianjing_radar.nowcoder_job_pipeline.SEEN_DIR",
        tmp_path / "seen",
    )
    key = _cache_key("l1", "l2", "产品经理")
    _reset_seen(key)
    assert _read_seen(key)["seen_ids"] == []

    _mark_seen(key, ["https://www.nowcoder.com/discuss/a", "https://www.nowcoder.com/discuss/b?q=1"])
    ids = _read_seen(key)["seen_ids"]
    assert ids == [
        "https://www.nowcoder.com/discuss/a",
        "https://www.nowcoder.com/discuss/b",
    ]

    _mark_seen(key, ["https://www.nowcoder.com/discuss/b", "https://www.nowcoder.com/discuss/c"])
    ids2 = _read_seen(key)["seen_ids"]
    assert ids2 == [
        "https://www.nowcoder.com/discuss/a",
        "https://www.nowcoder.com/discuss/b",
        "https://www.nowcoder.com/discuss/c",
    ]

    _reset_seen(key)
    assert _read_seen(key)["seen_ids"] == []
