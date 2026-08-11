"""面经双来源合并逻辑单测（mock 雷达，不发起真实网络请求）。"""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from mianjing_generator import enrich_with_radar, generate_mock, RADAR_TIMEOUT_SEC


def test_radar_timeout_enlarged():
    assert RADAR_TIMEOUT_SEC >= 120
    assert RADAR_TIMEOUT_SEC <= 300


def test_enrich_real_before_llm_and_both_groups():
    data = generate_mock("数据分析师")
    data["_radar_enriched"] = False
    data["questions"] = [
        {"text": "AI题1", "source_type": "llm", "source_label": "AI 生成"},
        {"text": "AI题2", "source_type": "llm", "source_label": "AI 生成"},
    ]
    data["questionGroups"] = [
        {"label": "真实面经题", "tag": "真实面经", "source_type": "real", "questions": [], "pending": True},
        {"label": "AI 生成参考题", "tag": "AI 生成", "source_type": "llm", "questions": data["questions"]},
    ]

    fake_qs = [
        SimpleNamespace(
            text="牛客真题1？",
            source_label="牛客网",
            source_url="https://www.nowcoder.com/discuss/1",
            evidence="原文片段",
            points=["要点A"],
            anchor="项目X",
        ),
        SimpleNamespace(
            text="知乎真题2？",
            source_label="知乎",
            source_url="https://www.zhihu.com/p/2",
            evidence="",
            points=[],
            anchor="",
        ),
    ]
    fake_result = {
        "questions": fake_qs,
        "sources": [{"type": "nowcoder", "label": "牛客网", "count": 1, "status": "ok"}],
        "summary": ["牛客网：召回 1 条"],
        "gaps": [],
    }

    with patch("mianjing_radar.pipeline.crawl_real_questions", return_value=fake_result):
        out = enrich_with_radar(data, "数据分析师", {"basics": {"name": "测"}})

    assert out["_radar_enriched"] is True
    assert [q["text"] for q in out["questions"][:2]] == ["牛客真题1？", "知乎真题2？"]
    assert out["questions"][0]["source_type"] == "real"
    assert out["questions"][-1]["source_type"] == "llm"

    groups = out["questionGroups"]
    assert len(groups) == 2
    assert groups[0]["source_type"] == "real"
    assert groups[1]["source_type"] == "llm"
    assert len(groups[0]["questions"]) == 2
    assert len(groups[1]["questions"]) == 2
    assert groups[0]["questions"][0]["source_label"] == "牛客网"
    assert groups[1]["questions"][0]["source_label"] == "AI 生成"


def test_enrich_empty_real_still_keeps_two_groups():
    data = {
        "_radar_enriched": False,
        "questions": [{"text": "仅AI", "source_type": "llm", "source_label": "AI 生成"}],
        "dataSources": {"summary": [], "gaps": ["采集中…"]},
        "sourceList": {"牛客/网页": [], "GitHub": [], "小红书": []},
    }
    empty = {"questions": [], "sources": [], "summary": ["未找到"], "gaps": ["未配置 cookie"]}
    with patch("mianjing_radar.pipeline.crawl_real_questions", return_value=empty):
        out = enrich_with_radar(data, "后端工程师", {})

    assert out["_radar_enriched"] is True
    assert len(out["questionGroups"]) == 2
    assert out["questionGroups"][0]["source_type"] == "real"
    assert out["questionGroups"][0]["questions"] == []
    assert len(out["questionGroups"][1]["questions"]) == 1
    assert "暂未抓取" in out["questionsNote"] or "暂未" in out["questionsNote"]


if __name__ == "__main__":
    test_radar_timeout_enlarged()
    test_enrich_real_before_llm_and_both_groups()
    test_enrich_empty_real_still_keeps_two_groups()
    print("OK: all mianjing enrich tests passed")
