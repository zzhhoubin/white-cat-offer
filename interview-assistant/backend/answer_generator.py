"""回答提纲生成：调用 DeepSeek（OpenAI 兼容接口）生成参考答案 + 回答结构。"""

import json

from config import settings
from llm_utils import get_llm_model, LLMServiceError, async_openai_client, require_llm_config
from question_detector import guess_question_type

_SYSTEM_PROMPT = """你是中文线上面试的实时辅助助手。面试官刚提出一个问题，你要快速给出两块内容：
1）可直接口述的「参考答案」；2）便于扫读的「回答结构」。

严格遵守：
1. answer：口语化完整参考回答，约 120–220 字，像候选人在现场说话；优先结合简历真实经历，简历未覆盖处写「需补充」，不要编造具体事实、数字或公司名。
2. structure：3–5 条回答结构要点，每条一句话，帮助候选人按框架组织语言。
3. 你只是辅助，不替候选人发言；答案应自然，避免书面腔和万能模板感。
4. 只返回一个 JSON 对象，不要任何额外文字，格式如下：
{
  "question_type": "问题类型",
  "intent": "面试官想考察什么（一句话）",
  "answer": "口语化完整参考答案",
  "structure": ["结构第1点", "第2点", "第3点"],
  "keywords": ["关键词1", "关键词2"],
  "personal_refs": ["可引用的个人经历要点（来自简历，没有则写 需补充）"],
  "example": "一句话开场示范（口语化，20字内）",
  "risk": "风险提示（一句话，没有则写 无）"
}"""


def _build_user_prompt(question: str, context_text: str = "") -> str:
    resume = (context_text or settings.resume_text).strip() or (
        "（用户尚未提供简历，相关个人经历请标注 需补充）"
    )
    return f"""【候选人相关个人素材（已按问题检索）】
{resume}

【面试官问题】
{question}

请生成参考答案与回答结构 JSON。"""


def _normalize_outline(data: dict, question: str) -> dict:
    data.setdefault("question_type", guess_question_type(question))
    answer = (data.get("answer") or "").strip()
    if not answer:
        # 兼容旧模型输出：用开场 + 结构拼一段可读答案
        parts = []
        if (data.get("example") or "").strip():
            parts.append(str(data["example"]).strip())
        structure = data.get("structure") or []
        if isinstance(structure, list) and structure:
            parts.append("。".join(str(s).strip() for s in structure if str(s).strip()) + "。")
        data["answer"] = "\n".join(parts).strip()
    if not isinstance(data.get("structure"), list):
        data["structure"] = []
    return data


async def generate_outline(question: str, context_text: str = "") -> dict:
    """根据问题 + 检索到的个人素材生成参考答案与结构（LLM only）。"""
    require_llm_config()
    try:
        client = await async_openai_client()
        resp = await client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": _build_user_prompt(question, context_text)},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content or "{}"
        data = json.loads(content)
        return _normalize_outline(data, question)
    except Exception as exc:
        raise LLMServiceError(f"生成回答提纲失败：{exc}") from exc
