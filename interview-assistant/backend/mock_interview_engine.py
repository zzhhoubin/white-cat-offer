"""Mock interview engine driven by mock_interview skill rules (LLM only)."""

from __future__ import annotations

import json
from pathlib import Path

from config import settings
from llm_utils import get_llm_model, LLMServiceError, openai_client, require_llm_config

SKILL_DIR = Path(__file__).resolve().parent / "skills" / "mock_interview"

ROUND_META = {
    "hr": {"label": "HR 面", "label_en": "HR Round", "limit": 5, "role": "资深 HR"},
    "business": {"label": "业务主管面", "label_en": "Hiring Manager", "limit": 7, "role": "业务负责人"},
    "final": {"label": "终面", "label_en": "Executive Round", "limit": 4, "role": "VP/总监"},
}

SCOPE_ROUNDS = {
    "full": ["hr", "business", "final"],
    "hr": ["hr"],
    "business": ["business"],
    "final": ["final"],
    "project_deep_dive": ["business"],
}

ROUND_TRANSITIONS = {
    "hr": "感谢你的回答，接下来由我们的业务负责人来和你聊聊，请稍等。",
    "business": "好的，你的专业能力我大概了解了。最后一轮是我们 VP 来和你聊，主要看看整体的匹配度。",
}


def _read_skill(name: str) -> str:
    path = SKILL_DIR / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""


def _round_label(round_key: str, language: str) -> str:
    meta = ROUND_META.get(round_key, {})
    return meta.get("label_en" if language == "en" else "label", round_key)


def _question_limit_for_scope(scope: str) -> int:
    rounds = SCOPE_ROUNDS.get(scope, SCOPE_ROUNDS["full"])
    if scope == "project_deep_dive":
        return 6
    return sum(ROUND_META[r]["limit"] for r in rounds)


def initial_state(*, scope: str, language: str, company_name: str) -> dict:
    rounds = SCOPE_ROUNDS.get(scope, SCOPE_ROUNDS["full"])
    return {
        "scope": scope,
        "language": language,
        "company_name": (company_name or "").strip(),
        "rounds": rounds,
        "round_index": 0,
        "round_question_index": 0,
        "followup_depth": 0,
        "main_questions_in_round": 0,
        "prepared": False,
        "prep_summary": "",
    }


def prepare_session(*, role: str, jd_text: str, resume_context: str, state: dict) -> dict:
    """Analyze JD/resume before interview (system-side prepare)."""
    require_llm_config()
    state = dict(state or {})
    try:
        client = openai_client()
        prompt = f"""你是面试教练。根据 JD 和简历，用 3-5 句话总结：
1. 岗位核心要求
2. 候选人强项（面试可引导）
3. 风险点（面试官可能追问）
4. 本轮面试重点

目标岗位：{role}
JD：
{jd_text[:4000]}
简历素材：
{resume_context[:4000]}

只返回 JSON：{{"summary":"..."}}"""
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": _read_skill("interview-questions.md")},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        state["prepared"] = True
        state["prep_summary"] = str(data.get("summary") or "").strip() or f"围绕{role}进行模拟面试。"
    except Exception as exc:
        raise LLMServiceError(f"模拟面试准备失败：{exc}") from exc
    return state


def _current_round(state: dict) -> str:
    rounds = state.get("rounds") or SCOPE_ROUNDS["full"]
    idx = int(state.get("round_index") or 0)
    if idx >= len(rounds):
        return ""
    return rounds[idx]


def analyze_answer(
    *,
    state: dict,
    role: str,
    jd_text: str,
    resume_context: str,
    question: str,
    answer_text: str,
    intent: str = "",
) -> dict:
    """Decide follow-up vs advance. No scoring during interview."""
    state = dict(state or {})
    depth = int(state.get("followup_depth") or 0)
    if depth < 3:
        followup = _llm_followup(
            state=state,
            role=role,
            jd_text=jd_text,
            resume_context=resume_context,
            question=question,
            answer_text=answer_text,
            intent=intent,
        )
        if followup:
            state["followup_depth"] = depth + 1
            return {
                "action": "followup",
                "transition": "",
                "followup_question": followup,
                "state": state,
            }

    state["followup_depth"] = 0
    state["main_questions_in_round"] = int(state.get("main_questions_in_round") or 0) + 1
    state["round_question_index"] = int(state.get("round_question_index") or 0) + 1

    round_key = _current_round(state)
    round_limit = ROUND_META.get(round_key, {}).get("limit", 5)
    if state["main_questions_in_round"] >= round_limit:
        transition = ROUND_TRANSITIONS.get(round_key, "")
        if state.get("language") == "en" and round_key == "hr":
            transition = "Thanks. Next, our hiring manager will speak with you."
        state["round_index"] = int(state.get("round_index") or 0) + 1
        state["round_question_index"] = 0
        state["main_questions_in_round"] = 0
        state["followup_depth"] = 0
        if _current_round(state):
            return {"action": "round_done", "transition": transition, "state": state}
        return {"action": "finished", "transition": transition, "state": state}

    return {"action": "next", "transition": "", "state": state}


def advance_after_response(state: dict) -> dict:
    """Advance state after a main answer or skip. Never triggers follow-up."""
    state = dict(state or {})
    state["followup_depth"] = 0
    state["main_questions_in_round"] = int(state.get("main_questions_in_round") or 0) + 1
    state["round_question_index"] = int(state.get("round_question_index") or 0) + 1

    round_key = _current_round(state)
    round_limit = ROUND_META.get(round_key, {}).get("limit", 5)
    if state["main_questions_in_round"] >= round_limit:
        transition = ROUND_TRANSITIONS.get(round_key, "")
        if state.get("language") == "en" and round_key == "hr":
            transition = "Thanks. Next, our hiring manager will speak with you."
        state["round_index"] = int(state.get("round_index") or 0) + 1
        state["round_question_index"] = 0
        state["main_questions_in_round"] = 0
        state["followup_depth"] = 0
        if _current_round(state):
            return {"action": "round_done", "transition": transition, "state": state}
        return {"action": "finished", "transition": transition, "state": state}

    return {"action": "next", "transition": "", "state": state}


def _llm_followup(**kwargs) -> str | None:
    require_llm_config()
    state = kwargs["state"]
    round_key = _current_round(state)
    meta = ROUND_META.get(round_key, {})
    try:
        client = openai_client()
        prompt = f"""当前轮次：{meta.get('label', round_key)}
题目：{kwargs['question']}
考察点：{kwargs.get('intent') or '未标注'}
候选人回答：{kwargs['answer_text']}

规则：若回答笼统、有空洞、值得深挖，给一句追问；否则返回空字符串。
语言：{'English' if state.get('language') == 'en' else '中文'}
只返回 JSON：{{"followup": "追问或空字符串"}}"""
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": _read_skill("interview-questions.md")},
                {"role": "user", "content": prompt},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        followup = str(data.get("followup") or "").strip()
        return followup or None
    except Exception as exc:
        raise LLMServiceError(f"生成追问失败：{exc}") from exc


def next_question(
    *,
    state: dict,
    role: str,
    jd_text: str,
    resume_context: str,
    asset_titles: list[str],
    history: list[dict],
) -> dict | None:
    """Generate the next main interview question for current round (LLM only)."""
    require_llm_config()
    state = dict(state or {})
    round_key = _current_round(state)
    if not round_key:
        return None

    q_index = int(state.get("round_question_index") or 0)
    try:
        meta = ROUND_META[round_key]
        asked = "\n".join(
            f"- [{h.get('round', '')}] {h.get('question', '')}"
            for h in history[-12:]
        )
        company = state.get("company_name") or "目标公司"
        lang = "English" if state.get("language") == "en" else "中文"
        assets_hint = ""
        if asset_titles:
            assets_hint = f"\n候选人项目素材标题：{'、'.join(asset_titles[:5])}"
        user_prompt = f"""你正在扮演：{meta['role']}
当前轮次：{meta['label']}
目标岗位：{role}
公司：{company}
JD：{(jd_text or '')[:3000]}
准备摘要：{state.get('prep_summary') or ''}
简历素材：{resume_context[:3000]}
已问过：{asked or '（暂无）'}{assets_hint}

请出下一道主题题（不是追问），语言：{lang}
只返回 JSON：{{"question":"...","intent":"考察点"}}"""
        client = openai_client()
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": _read_skill("interview-questions.md")},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.6,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        if not data.get("question"):
            raise LLMServiceError("LLM 返回空题目")
        return _pack_question(state, round_key, data, q_index, history)
    except LLMServiceError:
        raise
    except Exception as exc:
        raise LLMServiceError(f"生成面试题失败：{exc}") from exc


def _pack_question(state: dict, round_key: str, item: dict, q_index: int, history: list[dict]) -> dict:
    total = _question_limit_for_scope(state.get("scope", "full"))
    index = len(history) + 1
    return {
        "question": item.get("question", "请做一个简短的自我介绍。"),
        "intent": item.get("intent", "综合考察"),
        "round": round_key,
        "round_label": _round_label(round_key, state.get("language", "zh")),
        "is_followup": False,
        "index": index,
        "total": total,
        "done": False,
    }


def build_followup_question(state: dict, followup_text: str, history: list[dict]) -> dict:
    round_key = _current_round(state)
    total = _question_limit_for_scope(state.get("scope", "full"))
    return {
        "question": followup_text,
        "intent": "追问",
        "round": round_key,
        "round_label": _round_label(round_key, state.get("language", "zh")),
        "is_followup": True,
        "index": len(history) + 1,
        "total": total,
        "done": False,
    }
