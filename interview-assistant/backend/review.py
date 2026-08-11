"""面试后复盘（PRD 8.6）：记录每场（实时辅助 / 模拟面试）会话识别到的问题与回答提纲。

核心链路：实时辅助识别问题 -> 写入复盘会话 -> 用户复盘时把好问题回填专属题库。

存储：单用户 JSON 文件 data/reviews.json。
"""

import json
import os
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any

_DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
_STORE_PATH = os.path.join(_DATA_DIR, "reviews.json")


def _now() -> float:
    return time.time()


@dataclass
class ReviewItem:
    item_id: str
    transcript: str  # 识别到的问题原文
    qtype: str = ""  # 问题类型（考察点）
    outline: Any = ""  # 系统给出的回答提纲（历史数据可能是 str，新数据多为 dict）
    created_at: float = field(default_factory=_now)


@dataclass
class ReviewSession:
    session_id: str
    mode: str = "realtime"  # realtime | mock
    started_at: float = field(default_factory=_now)
    ended_at: float = 0.0
    items: list = field(default_factory=list)  # list[ReviewItem]
    report: dict = field(default_factory=dict)


class ReviewStore:
    def __init__(self, user_id: str = "demo-user"):
        self.user_id = user_id or "demo-user"
        self.store_path = _STORE_PATH if self.user_id == "demo-user" else _user_store_path(self.user_id)
        self.sessions: list[ReviewSession] = []
        self._load()

    def _load(self):
        if not os.path.exists(self.store_path):
            return
        try:
            with open(self.store_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.sessions = []
            for s in data.get("sessions", []):
                items = [
                    ReviewItem(
                        item_id=it.get("item_id") or uuid.uuid4().hex[:8],
                        transcript=it.get("transcript", ""),
                        qtype=it.get("qtype", ""),
                        outline=it.get("outline", ""),
                        created_at=it.get("created_at", 0.0),
                    )
                    for it in s.get("items", [])
                ]
                self.sessions.append(
                    ReviewSession(
                        session_id=s.get("session_id") or uuid.uuid4().hex[:8],
                        mode=s.get("mode", "realtime"),
                        started_at=s.get("started_at", 0.0),
                        ended_at=s.get("ended_at", 0.0),
                        items=items,
                        report=s.get("report", {}) or {},
                    )
                )
        except Exception:
            self.sessions = []

    def _save(self):
        os.makedirs(os.path.dirname(self.store_path), exist_ok=True)
        with open(self.store_path, "w", encoding="utf-8") as f:
            json.dump(
                {"sessions": [self._session_dict(s) for s in self.sessions]},
                f,
                ensure_ascii=False,
                indent=2,
            )

    @staticmethod
    def _session_dict(s: ReviewSession) -> dict:
        d = asdict(s)
        return d

    # ---------------- 写入（供 WebSocket 会话调用）----------------
    def start_session(self, mode: str = "realtime") -> str:
        sid = uuid.uuid4().hex[:8]
        self.sessions.append(ReviewSession(session_id=sid, mode=mode))
        self._save()
        return sid

    def add_item(self, session_id: str, transcript: str, qtype: str = "", outline: str = "") -> None:
        for s in self.sessions:
            if s.session_id == session_id:
                s.items.append(
                    ReviewItem(
                        item_id=uuid.uuid4().hex[:8],
                        transcript=transcript,
                        qtype=qtype,
                        outline=outline,
                    )
                )
                self._save()
                return

    def end_session(self, session_id: str) -> None:
        for s in self.sessions:
            if s.session_id == session_id:
                s.ended_at = _now()
                # 丢弃没有任何问题记录的空会话，避免列表里全是空壳
                if not s.items:
                    self.sessions = [x for x in self.sessions if x.session_id != session_id]
                self._save()
                return

    # ---------------- 读取 / 管理（供 REST 调用）----------------
    def list_summaries(self) -> list[dict]:
        out = []
        for s in sorted(self.sessions, key=lambda x: x.started_at, reverse=True):
            out.append(
                {
                    "session_id": s.session_id,
                    "mode": s.mode,
                    "started_at": s.started_at,
                    "ended_at": s.ended_at,
                    "count": len(s.items),
                }
            )
        return out

    def get(self, session_id: str) -> dict | None:
        for s in self.sessions:
            if s.session_id == session_id:
                return self._session_dict(s)
        return None

    def get_item(self, session_id: str, item_id: str) -> ReviewItem | None:
        for s in self.sessions:
            if s.session_id == session_id:
                for it in s.items:
                    if it.item_id == item_id:
                        return it
        return None

    def generate_report(self, session_id: str) -> dict | None:
        """生成轻量复盘报告。

        当前实时辅助只记录面试官问题和系统提纲，没有候选人完整回答，因此这里评估的是
        「复盘准备质量」：覆盖广度、回答结构、素材引用和风险意识。后续接入模拟面试回答记录后，
        可升级为真正的逐题回答评分。
        """
        for s in self.sessions:
            if s.session_id != session_id:
                continue
            report = _build_report(s)
            s.report = report
            self._save()
            return report
        return None

    def delete(self, session_id: str) -> bool:
        before = len(self.sessions)
        self.sessions = [s for s in self.sessions if s.session_id != session_id]
        if len(self.sessions) != before:
            self._save()
            return True
        return False


def _build_report(session: ReviewSession) -> dict:
    items = session.items or []
    question_count = len(items)
    qtypes = sorted({it.qtype for it in items if it.qtype})
    outline_texts = [_outline_to_text(it.outline) for it in items]
    has_personal_ref = sum(1 for text in outline_texts if "需补充" not in text and ("项目" in text or "经历" in text))
    has_risk = sum(1 for text in outline_texts if "风险" in text or "risk" in text.lower())

    coverage_score = _clamp(58 + min(question_count, 8) * 5 + len(qtypes) * 2)
    structure_score = _clamp(62 + _avg([min(len(text), 500) / 500 * 28 for text in outline_texts]))
    evidence_score = _clamp(55 + (has_personal_ref / max(question_count, 1)) * 30)
    risk_score = _clamp(58 + (has_risk / max(question_count, 1)) * 28)
    total = round(_avg([coverage_score, structure_score, evidence_score, risk_score]))

    dimensions = [
        {
            "name": "问题覆盖",
            "score": coverage_score,
            "comment": f"本场记录 {question_count} 个问题，覆盖 {len(qtypes)} 类考察点。",
        },
        {
            "name": "回答结构",
            "score": structure_score,
            "comment": "提纲越完整，现场回答越容易形成“结论-例子-结果”的闭环。",
        },
        {
            "name": "素材引用",
            "score": evidence_score,
            "comment": "高分回答需要更多来自简历、项目库或真实经历的证据。",
        },
        {
            "name": "风险意识",
            "score": risk_score,
            "comment": "复盘时要标记不可编造、需补充和容易被追问的点。",
        },
    ]

    item_reports = [_item_report(it, idx) for idx, it in enumerate(items, start=1)]
    report = {
        "generated_at": _now(),
        "total_score": total,
        "level": _level(total),
        "summary": _summary(total, question_count, qtypes),
        "dimensions": dimensions,
        "items": item_reports,
    }
    report["markdown"] = _report_markdown(session, report)
    return report


def _item_report(item: ReviewItem, index: int) -> dict:
    text = _outline_to_text(item.outline)
    score = _clamp(60 + min(len(text), 420) / 420 * 25 + (5 if item.qtype else 0))
    improvements = [
        "补充一个真实项目或经历作为例子，避免只讲方法论。",
        "用“背景-行动-结果-复盘”的顺序整理成 60-90 秒口头答案。",
    ]
    if "需补充" in text:
        improvements.insert(0, "提纲中仍有“需补充”内容，面试前应替换为真实事实和数字。")
    return {
        "item_id": item.item_id,
        "index": index,
        "question": item.transcript,
        "qtype": item.qtype,
        "score": score,
        "strengths": ["问题已归类并形成可复盘提纲。"],
        "improvements": improvements,
        "reference_answer": _reference_answer(item),
    }


def _reference_answer(item: ReviewItem) -> str:
    qtype = item.qtype or "通用问题"
    return (
        f"这道题属于「{qtype}」。建议先直接回应问题，再给出一个真实案例："
        "说明背景和你的角色，讲清关键行动与取舍，最后用结果指标或复盘收获收束。"
        "如果当前素材不足，请明确标注待补充事实，不要临场编造。"
    )


def _summary(total: int, question_count: int, qtypes: list[str]) -> str:
    if question_count == 0:
        return "本场暂无可复盘问题，建议先完成一次实时辅助或模拟面试。"
    base = f"本场记录 {question_count} 个问题，覆盖{('、'.join(qtypes) if qtypes else '若干')}考察点。"
    if total >= 85:
        return base + "整体准备度较高，下一步重点是把参考提纲压缩成更自然的口头表达。"
    if total >= 70:
        return base + "已有基本复盘素材，建议补强真实案例、量化结果和追问准备。"
    return base + "当前更像问题清单，建议先补齐个人素材和 STAR 框架后再练习。"


def _report_markdown(session: ReviewSession, report: dict) -> str:
    lines = [
        "# 面试复盘报告",
        "",
        f"- 会话 ID：{session.session_id}",
        f"- 模式：{session.mode}",
        f"- 总分：{report['total_score']} / 100（{report['level']}）",
        f"- 总结：{report['summary']}",
        "",
        "## 维度评分",
    ]
    for dim in report["dimensions"]:
        lines.append(f"- {dim['name']}：{dim['score']} / 100。{dim['comment']}")
    lines.extend(["", "## 逐题复盘"])
    for item in report["items"]:
        lines.extend(
            [
                f"### {item['index']}. {item['question']}",
                f"- 类型：{item['qtype'] or '未分类'}",
                f"- 评分：{item['score']} / 100",
                f"- 参考回答：{item['reference_answer']}",
                "- 改进建议：",
            ]
        )
        lines.extend(f"  - {suggestion}" for suggestion in item["improvements"])
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _outline_to_text(outline: Any) -> str:
    if isinstance(outline, str):
        return outline
    if isinstance(outline, dict):
        parts = []
        for value in outline.values():
            if isinstance(value, list):
                parts.extend(str(x) for x in value)
            else:
                parts.append(str(value))
        return "\n".join(parts)
    return str(outline or "")


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _clamp(value: float, low: int = 0, high: int = 100) -> int:
    return round(max(low, min(high, value)))


def _level(score: int) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 60:
        return "C"
    return "D"


def _user_store_path(user_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", user_id)
    return os.path.join(_DATA_DIR, "users", safe, "reviews.json")
