"""项目资料包：LLM 分析（简历描述优化 / 口头介绍 / 深挖题）。"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from llm_utils import get_llm_model, openai_client, require_llm_config

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """你是资深面试教练与简历顾问。根据「项目资料包」中的简历项目信息与用户上传资料，做结构化分析。

只返回纯 JSON（不要 markdown 代码块），结构如下：
{
  "resume_desc": {
    "name": "项目名称",
    "role": "本人角色",
    "intro": "1-2 句项目背景与目标",
    "responsibilities": ["职责要点1", "职责要点2"],
    "achievements": ["可量化业绩1", "可量化业绩2"],
    "bullets": ["可选补充 bullet"]
  },
  "oral_script": "90-120 秒面试口头项目介绍话术，第一人称，口语自然，含背景-职责-难点-结果",
  "deep_questions": [
    {
      "question": "深挖问题",
      "intent": "考察点",
      "tip": "回答提示（1-2 句）"
    }
  ]
}

规则：
1. resume_desc 用书面简历语气，短句、可扫读；有数据则量化，没有则标「待确认」勿编造。
2. oral_script 用口语，便于直接说；不要念 bullet 列表。
3. deep_questions 生成 6-8 道，覆盖架构/权衡/失败/指标/协作/个人贡献。
4. 全部中文（专有名词可保留英文）。
5. 仅依据给定材料；材料不足处在 tip 或 achievements 中标明「待补充」。"""


def _safe_json(text: str) -> dict:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                data = json.loads(m.group(0))
                if isinstance(data, dict):
                    return data
            except json.JSONDecodeError:
                pass
    raise ValueError("模型返回非 JSON")


def _norm_analysis(raw: dict) -> dict:
    rd = raw.get("resume_desc") if isinstance(raw.get("resume_desc"), dict) else {}
    qs = raw.get("deep_questions") if isinstance(raw.get("deep_questions"), list) else []
    deep = []
    for q in qs[:10]:
        if not isinstance(q, dict):
            continue
        question = str(q.get("question") or q.get("q") or "").strip()
        if not question:
            continue
        deep.append(
            {
                "question": question,
                "intent": str(q.get("intent") or "").strip(),
                "tip": str(q.get("tip") or "").strip(),
            }
        )
    return {
        "resume_desc": {
            "name": str(rd.get("name") or "").strip(),
            "role": str(rd.get("role") or "").strip(),
            "intro": str(rd.get("intro") or "").strip(),
            "responsibilities": [str(x).strip() for x in (rd.get("responsibilities") or []) if str(x).strip()],
            "achievements": [str(x).strip() for x in (rd.get("achievements") or []) if str(x).strip()],
            "bullets": [str(x).strip() for x in (rd.get("bullets") or []) if str(x).strip()],
        },
        "oral_script": str(raw.get("oral_script") or "").strip(),
        "deep_questions": deep,
    }


def analyze_project_pack(
    *,
    pack_name: str,
    resume_project: dict | None,
    materials: list[dict],
) -> dict[str, Any]:
    """调用用户配置的 LLM，返回规范化 analysis。"""
    require_llm_config()
    proj = resume_project or {}
    mat_blocks = []
    for i, m in enumerate(materials or [], 1):
        if not isinstance(m, dict):
            continue
        title = str(m.get("name") or m.get("title") or f"资料{i}")
        content = str(m.get("content") or m.get("facts") or "").strip()
        mat_blocks.append(f"### 资料 {i}: {title}\n{content or '（无正文，仅文件名）'}")

    user_prompt = (
        f"资料包名称：{pack_name or '未命名'}\n\n"
        f"## 简历项目（可为空）\n{json.dumps(proj, ensure_ascii=False, indent=2)}\n\n"
        f"## 上传资料\n" + ("\n\n".join(mat_blocks) if mat_blocks else "（暂无资料）")
    )

    client = openai_client()
    resp = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.4,
        max_tokens=3500,
    )
    text = (resp.choices[0].message.content or "").strip()
    raw = _safe_json(text)
    return _norm_analysis(raw)
