"""Persistent store for AI mock interview sessions."""

import time
import uuid

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from config import settings
from database import SessionLocal
from mock_interview_engine import (
    _question_limit_for_scope,
    advance_after_response,
    analyze_answer,
    build_followup_question,
    initial_state,
    next_question,
    prepare_session,
)
from llm_utils import LLMNotConfiguredError, LLMServiceError, set_llm_user
from mock_interview_scoring import build_report, score_answer
from models import MockInterviewAnswer, MockInterviewSession


def _report_ready(report) -> bool:
    return isinstance(report, dict) and bool(report.get("generated_at"))


class MockInterviewStore:
    def __init__(self, user_id: str):
        self.user_id = user_id

    def create_session(
        self,
        *,
        role: str = "后端工程师",
        jd_text: str = "",
        company_name: str = "",
        language: str = "zh",
        scope: str = "full",
        source_bank: str = "personal",
        question_limit: int = 0,
        resume_context: str = "",
    ) -> dict:
        set_llm_user(self.user_id)
        scope = _normalize_scope(scope)
        language = _normalize_language(language)
        limit = int(question_limit or 0) or _question_limit_for_scope(scope)
        state = initial_state(scope=scope, language=language, company_name=company_name)
        state = prepare_session(
            role=(role or "后端工程师").strip()[:120],
            jd_text=(jd_text or "").strip(),
            resume_context=resume_context,
            state=state,
        )
        session = MockInterviewSession(
            session_id=uuid.uuid4().hex[:8],
            user_id=self.user_id,
            role=(role or "后端工程师").strip()[:120],
            jd_text=(jd_text or "").strip(),
            company_name=(company_name or "").strip()[:160],
            language=language,
            scope=scope,
            source_bank=_normalize_source(source_bank),
            question_limit=max(1, min(limit, settings.mock_interview_max_questions)),
            interview_state=state,
            status="active",
            current_question={},
            started_at=time.time(),
        )
        with SessionLocal() as db:
            db.add(session)
            db.commit()
            db.refresh(session)
            return self._session_dict(session)

    def get(self, session_id: str) -> dict | None:
        session = self._load(session_id)
        return self._session_dict(session) if session else None

    def list_summaries(self) -> list[dict]:
        with SessionLocal() as db:
            rows = db.scalars(
                select(MockInterviewSession)
                .where(MockInterviewSession.user_id == self.user_id)
                .options(selectinload(MockInterviewSession.answers))
                .order_by(MockInterviewSession.started_at.desc())
            ).all()
        return [self._summary_dict(row) for row in rows]

    def set_current_question(self, session_id: str, question: dict) -> dict | None:
        with SessionLocal() as db:
            session = self._load_for_update(db, session_id)
            if not session:
                return None
            session.current_question = question or {}
            db.commit()
            db.refresh(session)
            return self._session_dict(session)

    def update_interview_state(self, session_id: str, state: dict) -> dict | None:
        with SessionLocal() as db:
            session = self._load_for_update(db, session_id)
            if not session:
                return None
            session.interview_state = state or {}
            db.commit()
            db.refresh(session)
            return self._session_dict(session)

    def add_answer(
        self,
        session_id: str,
        question: dict,
        answer_text: str,
        *,
        score: dict | None = None,
    ) -> dict | None:
        with SessionLocal() as db:
            session = self._load_for_update(db, session_id)
            if not session:
                return None
            if session.status != "active":
                raise ValueError("本场模拟面试已结束")
            if len(session.answers) >= session.question_limit:
                raise ValueError("本场模拟面试题目数已达上限")

            scoring = score or {}
            answer = MockInterviewAnswer(
                answer_id=uuid.uuid4().hex[:8],
                session_id=session.session_id,
                index=len(session.answers) + 1,
                question=(question.get("question") or "").strip(),
                question_id=question.get("question_id") or "",
                intent=question.get("intent") or "",
                round_key=question.get("round") or "",
                answer_text=(answer_text or "").strip(),
                score=float(scoring.get("score") or 0),
                dimension_scores=scoring.get("dimension_scores") or {},
                strengths=scoring.get("strengths") or [],
                improvements=scoring.get("improvements") or [],
                reference_answer=scoring.get("reference_answer") or question.get("answer") or "",
                created_at=time.time(),
            )
            session.current_question = {}
            session.answers.append(answer)
            db.commit()
            db.refresh(answer)
            return self._answer_dict(answer)

    def score_all_answers(self, session_id: str, resume_context: str) -> dict | None:
        with SessionLocal() as db:
            session = self._load_for_update(db, session_id)
            if not session:
                return None
            for answer in session.answers:
                if answer.score and answer.score > 0:
                    continue
                scoring = score_answer(
                    role=session.role,
                    jd_text=session.jd_text,
                    resume_context=resume_context,
                    question=answer.question,
                    answer_text=answer.answer_text,
                    intent=answer.intent,
                    reference_answer=answer.reference_answer,
                )
                answer.score = float(scoring.get("score") or 0)
                answer.dimension_scores = scoring.get("dimension_scores") or {}
                answer.answer_summary = scoring.get("answer_summary") or ""
                answer.strengths = scoring.get("strengths") or []
                answer.improvements = scoring.get("improvements") or []
                answer.optimization_tips = scoring.get("optimization_tips") or []
                answer.reference_answer = scoring.get("reference_answer") or answer.reference_answer
            db.commit()
            db.refresh(session)
            return self._session_dict(session)

    def finish_session(
        self,
        session_id: str,
        resume_context: str = "",
        *,
        with_report: bool = False,
    ) -> dict | None:
        """结束会话。默认只改状态（快）；with_report=True 时同步评分并生成报告。"""
        set_llm_user(self.user_id)
        if with_report and resume_context:
            self.score_all_answers(session_id, resume_context)
        with SessionLocal() as db:
            session = self._load_for_update(db, session_id)
            if not session:
                return None
            session.status = "finished"
            session.ended_at = session.ended_at or time.time()
            session.current_question = {}
            if with_report:
                data = self._session_dict(session)
                report = build_report(data, data["answers"])
                session.overall_score = float(report.get("total_score") or 0)
                session.summary = report.get("summary") or ""
                session.dimensions = report.get("dimensions") or []
                session.report = report
            db.commit()
            db.refresh(session)
            return self._session_dict(session)

    def generate_report(self, session_id: str, resume_context: str = "") -> dict | None:
        session = self.get(session_id)
        if session and _report_ready(session.get("report")):
            return session["report"]
        finished = self.finish_session(session_id, resume_context, with_report=True)
        return finished.get("report") if finished else None

    def delete(self, session_id: str) -> bool:
        with SessionLocal() as db:
            session = self._load_for_update(db, session_id)
            if not session:
                return False
            db.delete(session)
            db.commit()
            return True

    def get_answer(self, session_id: str, answer_id: str) -> dict | None:
        session = self._load(session_id)
        if not session:
            return None
        for answer in session.answers:
            if answer.answer_id == answer_id:
                return self._answer_dict(answer)
        return None

    def to_review_detail(self, session_id: str) -> dict | None:
        session = self.get(session_id)
        if not session:
            return None
        return {
            "session_id": session["session_id"],
            "mode": "mock",
            "source": "mock_interview",
            "started_at": session["started_at"],
            "ended_at": session["ended_at"],
            "role": session["role"],
            "jd_text": session["jd_text"],
            "status": session["status"],
            "items": [self._review_item(answer) for answer in session["answers"]],
            "report": session.get("report") or {},
        }

    def process_answer(
        self,
        session_id: str,
        question: dict,
        answer_text: str,
        *,
        resume_context: str,
        asset_titles: list[str],
    ) -> dict:
        """Save answer, analyze, optionally produce next question. No per-answer scoring."""
        set_llm_user(self.user_id)
        session = self.get(session_id)
        if not session:
            return {"error": "会话不存在"}
        if session["status"] != "active":
            return {"error": "本场模拟面试已结束", "done": True, "session": session}

        item = self.add_answer(session_id, question, answer_text)
        session = self.get(session_id)
        history = [
            {
                "question": a["question"],
                "answer": a["answer_text"],
                "round": a.get("round_key", ""),
            }
            for a in session["answers"]
        ]
        state = session.get("interview_state") or {}
        try:
            decision = analyze_answer(
                state=state,
                role=session["role"],
                jd_text=session["jd_text"],
                resume_context=resume_context,
                question=question.get("question", ""),
                answer_text=answer_text,
                intent=question.get("intent", ""),
            )
        except (LLMNotConfiguredError, LLMServiceError) as exc:
            return {"error": str(exc)}
        state = decision.get("state") or state
        self.update_interview_state(session_id, state)
        session = self.get(session_id)

        result = {
            "ok": True,
            "action": decision.get("action", "next"),
            "transition": decision.get("transition", ""),
            "answer": item,
            "session": session,
            "done": False,
            "next_question": None,
        }

        if decision.get("action") == "followup":
            followup = build_followup_question(state, decision["followup_question"], history)
            self.set_current_question(session_id, followup)
            result["next_question"] = followup
            return result

        if decision.get("action") == "finished" or len(session["answers"]) >= session["question_limit"]:
            finished = self.finish_session(session_id, resume_context)
            result["done"] = True
            result["action"] = "finished"
            result["session"] = finished
            result["report"] = finished.get("report") if finished else {}
            return result

        try:
            nq = next_question(
                state=state,
                role=session["role"],
                jd_text=session["jd_text"],
                resume_context=resume_context,
                asset_titles=asset_titles,
                history=history,
            )
        except (LLMNotConfiguredError, LLMServiceError) as exc:
            return {"error": str(exc)}
        if nq:
            self.set_current_question(session_id, nq)
            result["next_question"] = nq
            if decision.get("action") == "round_done":
                result["transition"] = decision.get("transition", "")
        else:
            finished = self.finish_session(session_id, resume_context)
            result["done"] = True
            result["action"] = "finished"
            result["session"] = finished
            result["report"] = finished.get("report") if finished else {}
        return result

    def fetch_next_question(
        self,
        session_id: str,
        *,
        resume_context: str,
        asset_titles: list[str],
    ) -> dict:
        set_llm_user(self.user_id)
        session = self.get(session_id)
        if not session:
            return {"error": "会话不存在"}
        if session["status"] != "active":
            return {"done": True, "error": "本场模拟面试已结束", "session": session}

        current = session.get("current_question") or {}
        if current.get("question"):
            return {"ok": True, **current, "done": False}

        history = [
            {
                "question": a["question"],
                "answer": a["answer_text"],
                "round": a.get("round_key", ""),
            }
            for a in session["answers"]
        ]
        if len(history) >= session["question_limit"]:
            finished = self.finish_session(session_id, resume_context)
            return {"done": True, "session": finished, "report": finished.get("report") if finished else {}}

        state = session.get("interview_state") or {}
        try:
            nq = next_question(
                state=state,
                role=session["role"],
                jd_text=session["jd_text"],
                resume_context=resume_context,
                asset_titles=asset_titles,
                history=history,
            )
        except (LLMNotConfiguredError, LLMServiceError) as exc:
            return {"error": str(exc)}
        if not nq:
            finished = self.finish_session(session_id, resume_context)
            return {"done": True, "session": finished, "report": finished.get("report") if finished else {}}
        self.set_current_question(session_id, nq)
        return {"ok": True, **nq, "done": False}

    def skip_current_question(
        self,
        session_id: str,
        *,
        resume_context: str,
        asset_titles: list[str],
    ) -> dict:
        """Skip current question without follow-up; advance to next main question."""
        set_llm_user(self.user_id)
        session = self.get(session_id)
        if not session:
            return {"error": "会话不存在"}
        if session["status"] != "active":
            return {"error": "本场模拟面试已结束", "done": True, "session": session}

        question = session.get("current_question") or {}
        if not question.get("question"):
            return {"error": "请先获取面试题"}

        skip_score = {
            "score": 0,
            "dimension_scores": {},
            "strengths": [],
            "improvements": ["本题已跳过，建议在复盘后单独练习"],
            "reference_answer": "",
        }
        item = self.add_answer(session_id, question, "[已跳过]", score=skip_score)
        session = self.get(session_id)
        history = [
            {
                "question": a["question"],
                "answer": a["answer_text"],
                "round": a.get("round_key", ""),
            }
            for a in session["answers"]
        ]
        state = session.get("interview_state") or {}
        decision = advance_after_response(state)
        state = decision.get("state") or state
        self.update_interview_state(session_id, state)
        session = self.get(session_id)

        result = {
            "ok": True,
            "action": decision.get("action", "next"),
            "transition": decision.get("transition", ""),
            "answer": item,
            "session": session,
            "done": False,
            "next_question": None,
        }

        if decision.get("action") == "finished" or len(session["answers"]) >= session["question_limit"]:
            finished = self.finish_session(session_id, resume_context)
            result["done"] = True
            result["action"] = "finished"
            result["session"] = finished
            result["report"] = finished.get("report") if finished else {}
            return result

        try:
            nq = next_question(
                state=state,
                role=session["role"],
                jd_text=session["jd_text"],
                resume_context=resume_context,
                asset_titles=asset_titles,
                history=history,
            )
        except (LLMNotConfiguredError, LLMServiceError) as exc:
            return {"error": str(exc)}
        if nq:
            self.set_current_question(session_id, nq)
            result["next_question"] = nq
        else:
            finished = self.finish_session(session_id, resume_context)
            result["done"] = True
            result["action"] = "finished"
            result["session"] = finished
            result["report"] = finished.get("report") if finished else {}
        return result

    def _load(self, session_id: str) -> MockInterviewSession | None:
        with SessionLocal() as db:
            return db.scalar(
                select(MockInterviewSession)
                .where(
                    MockInterviewSession.user_id == self.user_id,
                    MockInterviewSession.session_id == session_id,
                )
                .options(selectinload(MockInterviewSession.answers))
            )

    def _load_for_update(self, db, session_id: str) -> MockInterviewSession | None:
        return db.scalar(
            select(MockInterviewSession)
            .where(
                MockInterviewSession.user_id == self.user_id,
                MockInterviewSession.session_id == session_id,
            )
            .options(selectinload(MockInterviewSession.answers))
        )

    def _summary_dict(self, session: MockInterviewSession) -> dict:
        return {
            "session_id": session.session_id,
            "mode": "mock",
            "source": "mock_interview",
            "role": session.role,
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "count": len(session.answers),
            "status": session.status,
            "total_score": round(session.overall_score or 0),
        }

    def _session_dict(self, session: MockInterviewSession) -> dict:
        return {
            "session_id": session.session_id,
            "user_id": session.user_id,
            "role": session.role,
            "jd_text": session.jd_text,
            "company_name": getattr(session, "company_name", "") or "",
            "language": getattr(session, "language", "zh") or "zh",
            "scope": getattr(session, "scope", "full") or "full",
            "source_bank": session.source_bank,
            "question_limit": session.question_limit,
            "interview_state": session.interview_state or {},
            "status": session.status,
            "current_question": session.current_question or {},
            "started_at": session.started_at,
            "ended_at": session.ended_at,
            "overall_score": session.overall_score,
            "summary": session.summary,
            "dimensions": session.dimensions or [],
            "report": session.report or {},
            "answers": [self._answer_dict(answer) for answer in session.answers],
        }

    @staticmethod
    def _answer_dict(answer: MockInterviewAnswer) -> dict:
        return {
            "answer_id": answer.answer_id,
            "session_id": answer.session_id,
            "index": answer.index,
            "question": answer.question,
            "question_id": answer.question_id,
            "intent": answer.intent,
            "round_key": getattr(answer, "round_key", "") or "",
            "answer_text": answer.answer_text,
            "answer_summary": getattr(answer, "answer_summary", "") or "",
            "score": round(answer.score or 0),
            "dimension_scores": answer.dimension_scores or {},
            "strengths": answer.strengths or [],
            "improvements": answer.improvements or [],
            "optimization_tips": getattr(answer, "optimization_tips", None) or [],
            "reference_answer": answer.reference_answer,
            "created_at": answer.created_at,
        }

    @staticmethod
    def _review_item(answer: dict) -> dict:
        return {
            "item_id": answer["answer_id"],
            "transcript": answer["question"],
            "qtype": answer.get("intent", ""),
            "outline": answer.get("reference_answer", ""),
            "answer_text": answer.get("answer_text", ""),
            "answer_summary": answer.get("answer_summary", ""),
            "score": answer.get("score", 0),
            "dimension_scores": answer.get("dimension_scores") or {},
            "strengths": answer.get("strengths") or [],
            "improvements": answer.get("improvements") or [],
            "optimization_tips": answer.get("optimization_tips") or [],
            "reference_answer": answer.get("reference_answer", ""),
            "created_at": answer.get("created_at", 0.0),
        }


def _normalize_source(source_bank: str) -> str:
    value = (source_bank or "personal").strip().lower()
    if value in {"general", "personal", "custom"}:
        return value
    return "personal"


def _normalize_scope(scope: str) -> str:
    value = (scope or "full").strip().lower()
    allowed = {"full", "hr", "business", "final", "project_deep_dive"}
    return value if value in allowed else "full"


def _normalize_language(language: str) -> str:
    value = (language or "zh").strip().lower()
    return "en" if value == "en" else "zh"
