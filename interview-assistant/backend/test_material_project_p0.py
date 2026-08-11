"""P0 smoke: material docs/cards + resume projects bind (no LLM)."""

from __future__ import annotations

import os
import tempfile

from database import Base, engine, init_db
from material_archive import archive_document, list_cards, save_document
from project_library import bind_cards, list_projects, sync_from_structured


def test_material_and_project_flow():
    init_db()
    uid = "test-archive-user"
    text = "负责支付系统重构，QPS 提升 30%，技术栈 Java / Redis。"
    with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as tmp:
        tmp.write(text.encode("utf-8"))
        path = tmp.name
    try:
        with open(path, "rb") as f:
            raw = f.read()
        doc = save_document(uid, filename="pay.txt", raw_bytes=raw, raw_text=text, mime="text/plain")
        assert doc["doc_id"]
        archived = archive_document(uid, doc["doc_id"], force=True)
        assert archived["cards"]
        cards = list_cards(uid)
        assert len(cards) >= 1
        projects = sync_from_structured(
            uid,
            projects=[
                {
                    "name": "支付重构",
                    "role": "后端",
                    "start": "2023.01",
                    "end": "2023.12",
                    "intro": "支付核心链路",
                    "responsibilities": ["重构清算"],
                    "achievements": ["QPS+30%"],
                }
            ],
            source_resume_id="resume_test",
            replace=True,
        )
        assert len(projects) == 1
        pid = projects[0]["project_id"]
        bound = bind_cards(uid, pid, [cards[0]["card_id"]])
        assert cards[0]["card_id"] in bound["card_ids"]
        listed = list_projects(uid, source_resume_id="resume_test")
        assert listed[0]["card_ids"]
    finally:
        if os.path.exists(path):
            os.remove(path)


if __name__ == "__main__":
    test_material_and_project_flow()
    print("ok")
