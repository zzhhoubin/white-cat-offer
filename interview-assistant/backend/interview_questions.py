"""模拟面试出题（PRD 8.4）：基于个人素材让 AI 扮演面试官出题/追问（LLM only）。"""

import json

from config import settings
from llm_utils import get_llm_model, LLMServiceError, openai_client, require_llm_config

_SYSTEM = """你是资深技术面试官，正在面试一名候选人。请根据候选人简历素材、目标岗位、JD 和已问过的问题，提出「下一个」面试问题。

规则：
1. 一次只问一个问题，口语化、像真人面试官。
2. 优先围绕候选人真实项目深挖（背景、个人贡献、难点、结果指标）。
3. 适当穿插行为面试、动机类问题。
4. 不要重复已问过的问题。

只返回 JSON：{"question": "下一个问题", "intent": "考察点", "is_followup": true/false}"""


def next_question(
    resume_context: str,
    asset_titles: list[str],
    history: list[dict],
    role: str = "",
    jd_text: str = "",
) -> dict:
    """生成下一道面试题。history 为 [{question, answer}] 列表。"""
    require_llm_config()
    try:
        client = openai_client()
        asked = "\n".join(f"- {h.get('question','')}（候选人回答：{h.get('answer','')[:80]}）" for h in history)
        user_prompt = f"""目标岗位：
{role or '未指定'}

招聘 JD：
{(jd_text or '（未提供）')[:4000]}

候选人简历素材：
{resume_context or '（暂无，可问通用问题）'}

候选人项目标题：
{'、'.join(asset_titles[:8]) if asset_titles else '（暂无）'}

已问过的问题及回答：
{asked or '（还没开始）'}

请给出下一个面试问题。"""
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.6,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        if not data.get("question"):
            raise LLMServiceError("LLM 返回空题目")
        return data
    except Exception as exc:
        if isinstance(exc, LLMServiceError):
            raise
        raise LLMServiceError(f"生成面试题失败：{exc}") from exc
