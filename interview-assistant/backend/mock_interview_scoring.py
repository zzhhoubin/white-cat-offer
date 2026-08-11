"""Scoring and report helpers for AI mock interviews (LLM only)."""

import json
import time

from mock_interview_report_html import build_html_report

from config import settings
from llm_utils import get_llm_model, LLMServiceError, openai_client, require_llm_config

DIMENSION_NAMES = [
    "专业能力",
    "沟通表达",
    "逻辑思维",
    "应变能力",
    "文化匹配",
    "成长潜力",
]


def score_answer(
    *,
    role: str,
    jd_text: str,
    resume_context: str,
    question: str,
    answer_text: str,
    intent: str = "",
    reference_answer: str = "",
) -> dict:
    """Return a normalized per-answer score payload."""
    require_llm_config()
    try:
        client = openai_client()
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": _SYSTEM_SCORER},
                {
                    "role": "user",
                    "content": _score_prompt(
                        role=role,
                        jd_text=jd_text,
                        resume_context=resume_context,
                        question=question,
                        answer_text=answer_text,
                        intent=intent,
                        reference_answer=reference_answer,
                    ),
                },
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        return _normalize_score(data, question, answer_text, reference_answer, intent)
    except Exception as exc:
        raise LLMServiceError(f"评分失败：{exc}") from exc


def build_report(session: dict, answers: list[dict]) -> dict:
    scores = [float(item.get("score") or 0) for item in answers]
    total = _clamp(sum(scores) / len(scores) if scores else 0)
    dimensions = []
    for name in DIMENSION_NAMES:
        values = [
            float((item.get("dimension_scores") or {}).get(name) or 0)
            for item in answers
            if (item.get("dimension_scores") or {}).get(name) is not None
        ]
        score = _clamp(sum(values) / len(values) if values else total)
        dimensions.append({"name": name, "score": score, "comment": _dimension_comment(name, score)})

    weak = [d["name"] for d in dimensions if d["score"] < 70]
    summary = _summary(total, len(answers), session.get("role") or "目标岗位", weak)
    action_plan = _build_action_plan(answers, dimensions, session.get("role") or "目标岗位")
    report = {
        "generated_at": time.time(),
        "total_score": total,
        "recommendation": _recommendation(total),
        "summary": summary,
        "dimensions": dimensions,
        "rounds": _group_by_round(answers),
        "items": [_report_item(item, idx) for idx, item in enumerate(answers, start=1)],
        "question_catalog": _question_catalog(answers),
        "action_plan": action_plan,
        "action_items": _flatten_action_plan(action_plan),
    }
    report["markdown"] = _markdown(session, report, answers)
    report["html"] = build_html_report(session, report, answers)
    return report


_SYSTEM_SCORER = """你是资深面试官和面试辅导教练。请根据题目、候选人回答、简历/JD上下文，对候选人的真实回答评分。

规则：
1. 只评价候选人的回答质量，不要编造候选人没有说过的经历。
2. 参考回答必须基于候选人简历/JD中的真实经历个性化撰写，缺失事实用「（此处需结合你的真实经历补充）」标记。
3. 分数必须是 0-100 的整数，要有区分度：优秀 85-95，一般 50-65，较差 30-45，不要全部集中在 70-80。
4. improvements 写具体不足（避免空泛如「回答不够具体」），optimization_tips 写可执行优化建议（如 STAR 重组步骤）。
5. 只返回 JSON，格式：
{
  "score": 78,
  "dimension_scores": {
    "专业能力": 80, "沟通表达": 75, "逻辑思维": 76,
    "应变能力": 70, "文化匹配": 78, "成长潜力": 74
  },
  "answer_summary": "一句话概括候选人回答要点",
  "strengths": ["..."],
  "improvements": ["..."],
  "optimization_tips": ["..."],
  "reference_answer": "..."
}"""


def _score_prompt(**kwargs) -> str:
    return f"""目标岗位：{kwargs['role'] or '未指定'}

JD：
{kwargs['jd_text'] or '（未提供）'}

候选人素材：
{kwargs['resume_context'] or '（暂无素材）'}

面试题：
{kwargs['question']}

考察点：
{kwargs['intent'] or '未标注'}

候选人回答：
{kwargs['answer_text']}

已有参考回答：
{kwargs['reference_answer'] or '（暂无）'}

请按要求输出评分 JSON。"""


def _empty_score_payload(question: str, intent: str, reference_answer: str) -> dict:
    return {
        "score": 0,
        "dimension_scores": {name: 0 for name in DIMENSION_NAMES},
        "answer_summary": "",
        "strengths": [],
        "improvements": ["评分数据不完整"],
        "optimization_tips": [],
        "reference_answer": reference_answer or _fallback_reference(question, intent),
    }


def _normalize_score(data: dict, question: str, answer_text: str, reference_answer: str, intent: str) -> dict:
    fallback = _empty_score_payload(question, intent, reference_answer)
    dimensions = data.get("dimension_scores") if isinstance(data.get("dimension_scores"), dict) else {}
    normalized_dimensions = {
        name: _clamp(dimensions.get(name, fallback["dimension_scores"][name]))
        for name in DIMENSION_NAMES
    }
    strengths = data.get("strengths") if isinstance(data.get("strengths"), list) else fallback["strengths"]
    improvements = data.get("improvements") if isinstance(data.get("improvements"), list) else fallback["improvements"]
    optimization_tips = (
        data.get("optimization_tips") if isinstance(data.get("optimization_tips"), list) else fallback["optimization_tips"]
    )
    answer_summary = str(data.get("answer_summary") or "").strip() or _fallback_summary(answer_text)
    return {
        "score": _clamp(data.get("score", fallback["score"])),
        "dimension_scores": normalized_dimensions,
        "answer_summary": answer_summary,
        "strengths": [str(item) for item in strengths[:4]] or fallback["strengths"],
        "improvements": [str(item) for item in improvements[:4]] or fallback["improvements"],
        "optimization_tips": [str(item) for item in optimization_tips[:4]] or fallback["optimization_tips"],
        "reference_answer": str(data.get("reference_answer") or fallback["reference_answer"]),
    }


def _fallback_summary(answer_text: str) -> str:
    text = (answer_text or "").strip()
    if not text:
        return "（未作答）"
    return text if len(text) <= 120 else text[:117] + "..."


def _group_by_round(answers: list[dict]) -> list[dict]:
    rounds: dict[str, list] = {}
    labels = {"hr": "HR 面", "business": "业务主管面", "final": "终面"}
    for item in answers:
        key = item.get("round_key") or "general"
        rounds.setdefault(key, []).append(item)
    result = []
    for key, items in rounds.items():
        scores = [float(i.get("score") or 0) for i in items if i.get("score")]
        avg = _clamp(sum(scores) / len(scores) if scores else 0)
        result.append(
            {
                "round_key": key,
                "round_label": labels.get(key, "综合"),
                "score": avg,
                "items": [_report_item(i, i.get("index", 0)) for i in items],
            }
        )
    return result


def _question_catalog(answers: list[dict]) -> list[dict]:
    return [
        {
            "index": idx,
            "question": item.get("question", ""),
            "intent": item.get("intent", ""),
            "round_key": item.get("round_key", ""),
        }
        for idx, item in enumerate(answers, start=1)
    ]


def _build_action_plan(answers: list[dict], dimensions: list[dict], role: str) -> dict:
    low_items = sorted(answers, key=lambda x: float(x.get("score") or 0))[:3]
    top_issues = []
    for item in low_items:
        q = (item.get("question") or "")[:36]
        score = _clamp(item.get("score", 0))
        tip = (item.get("improvements") or [""])[0]
        top_issues.append(f"「{q}…」（{score} 分）：{tip}" if tip else f"「{q}…」（{score} 分）需重点复盘。")

    phrasing_tips: list[str] = []
    for item in answers:
        for tip in item.get("optimization_tips") or []:
            if tip and tip not in phrasing_tips:
                phrasing_tips.append(str(tip))
        if len(phrasing_tips) >= 4:
            break
    if not phrasing_tips:
        phrasing_tips.append("用「背景-任务-行动-结果」四句话组织每段项目经历，避免只罗列职责。")

    weak_dims = [d["name"] for d in dimensions if d["score"] < 70][:3]
    materials = []
    if weak_dims:
        materials.append(f"针对薄弱维度（{'、'.join(weak_dims)}）准备 2 个可量化案例。")
    materials.append(f"整理与{role}岗位 JD 对齐的项目关键词与业务指标。")
    materials.append("准备 3 个可能被追问的难点及你的应对策略。")

    return {
        "top_issues": top_issues[:3] or ["本轮暂无低分题，可继续打磨高压追问下的表达节奏。"],
        "phrasing_tips": phrasing_tips[:3],
        "materials": materials[:3],
    }


def _flatten_action_plan(action_plan: dict) -> list[str]:
    items: list[str] = []
    for issue in action_plan.get("top_issues") or []:
        items.append(issue)
    for tip in action_plan.get("phrasing_tips") or []:
        items.append(f"话术优化：{tip}")
    for material in action_plan.get("materials") or []:
        items.append(f"备考材料：{material}")
    return items[:8]


def _recommendation(score: int) -> str:
    if score >= 85:
        return "强烈推荐"
    if score >= 75:
        return "推荐录用"
    if score >= 60:
        return "待定"
    return "不推荐"


def _report_item(item: dict, index: int) -> dict:
    return {
        "item_id": item.get("answer_id"),
        "index": index,
        "question": item.get("question", ""),
        "qtype": item.get("intent", ""),
        "intent": item.get("intent", ""),
        "round_key": item.get("round_key", ""),
        "score": _clamp(item.get("score", 0)),
        "answer_summary": item.get("answer_summary") or _fallback_summary(item.get("answer_text", "")),
        "strengths": item.get("strengths") or [],
        "improvements": item.get("improvements") or [],
        "optimization_tips": item.get("optimization_tips") or [],
        "reference_answer": item.get("reference_answer", ""),
        "answer_text": item.get("answer_text", ""),
    }


def _markdown(session: dict, report: dict, answers: list[dict]) -> str:
    lines = [
        "# AI 模拟面试报告",
        "",
        f"- 会话 ID：{session.get('session_id', '')}",
        f"- 目标岗位：{session.get('role') or '未指定'}",
        f"- 综合评分：{report['total_score']} / 100",
        f"- 录用建议：{report['recommendation']}",
        f"- 综合评价：{report['summary']}",
        "",
        "## 能力维度评分",
    ]
    for dim in report["dimensions"]:
        lines.append(f"- {dim['name']}：{dim['score']} / 100。{dim['comment']}")
    lines.extend(["", "## 逐轮详细反馈"])
    for rnd in report.get("rounds") or []:
        lines.append(f"### {rnd.get('round_label', '综合')}（{rnd.get('score', 0)} 分）")
        for item in rnd.get("items") or []:
            lines.extend(
                [
                    f"#### {item.get('question', '')}",
                    f"- 评分：{item.get('score', 0)} / 100",
                    f"- 回答概要：{item.get('answer_summary', '')}",
                    f"- 优点：{'；'.join(item.get('strengths') or [])}",
                    f"- 不足：{'；'.join(item.get('improvements') or [])}",
                    f"- 优化建议：{'；'.join(item.get('optimization_tips') or [])}",
                    "",
                ]
            )
    lines.extend(["", "## 面试题目合集"])
    for entry in report.get("question_catalog") or []:
        lines.append(f"- {entry.get('index')}. {entry.get('question', '')}（考察：{entry.get('intent') or '未标注'}）")
    lines.extend(["", "## 备考行动清单"])
    plan = report.get("action_plan") or {}
    lines.append("### 最需要加强")
    for item in plan.get("top_issues") or []:
        lines.append(f"- {item}")
    lines.append("### 话术优化")
    for item in plan.get("phrasing_tips") or []:
        lines.append(f"- {item}")
    lines.append("### 推荐准备材料")
    for item in plan.get("materials") or []:
        lines.append(f"- {item}")
    return "\n".join(lines).strip() + "\n"


def _fallback_reference(question: str, intent: str) -> str:
    prefix = f"这道题主要考察{intent}。" if intent else "这道题适合用结构化案例回答。"
    return (
        f"{prefix} 建议先直接回应问题，再给出一个真实案例：说明背景、你的角色、关键行动、结果指标和复盘收获。"
        "缺失事实请用（此处需结合你的真实经历补充）标记。"
    )


def _dimension_comment(name: str, score: int) -> str:
    if score >= 85:
        return f"{name}表现较好，继续保持具体、真实、可验证。"
    if score >= 70:
        return f"{name}基本达标，可以补充更多细节和岗位相关证据。"
    return f"{name}仍需加强，建议用真实案例和量化结果重新打磨。"


def _summary(total: int, count: int, role: str, weak: list[str]) -> str:
    base = f"本轮围绕{role}完成 {count} 道题。"
    if count == 0:
        return "本轮暂无回答，请完成至少一道题后再生成报告。"
    if total >= 85:
        return base + "整体回答成熟，最大优势是案例完整、表达有结构；下一步重点是压缩表达并准备高压追问。"
    if total >= 70:
        suffix = f"最需改进：{'、'.join(weak)}。" if weak else "建议继续补充岗位相关案例与量化结果。"
        return base + "已具备基础竞争力，" + suffix
    return base + "当前回答偏粗略，最需改进的是 STAR 结构、岗位匹配证据和量化结果。"


def _clamp(value, low: int = 0, high: int = 100) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = 0
    return round(max(low, min(high, number)))
