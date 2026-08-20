import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from mianjing_store import list_companies, list_feed, mianjing_db_path


def test_feed_requires_job():
    out = list_feed(job_l3="")
    assert out["items"] == []
    assert out["total"] == 0


def test_feed_java_same_job():
    if not mianjing_db_path().is_file():
        return
    out = list_feed(job_l3="Java", limit=5)
    assert out["items"]
    assert all(item["job_l3"] == "Java" for item in out["items"])
    first = out["items"][0]
    assert first["title"]
    assert "content" in first
    assert "company" in first


def test_feed_unknown_company_empty():
    if not mianjing_db_path().is_file():
        return
    out = list_feed(job_l3="Java", company="不存在的公司xyz999")
    assert out["items"] == []
    assert out["total"] == 0


def test_feed_pagination():
    if not mianjing_db_path().is_file():
        return
    a = list_feed(job_l3="Java", offset=0, limit=3)
    b = list_feed(job_l3="Java", offset=3, limit=3)
    if len(a["items"]) < 3:
        return
    ids_a = [x["id"] for x in a["items"]]
    ids_b = [x["id"] for x in b["items"]]
    assert ids_a != ids_b
    assert a["has_more"] is True


def test_companies_lookup():
    if not mianjing_db_path().is_file():
        return
    assert list_companies(q="") == []
    names = list_companies(q="腾讯")
    assert names
    assert any("腾讯" in n for n in names)
