# -*- coding: utf-8 -*-
"""简历 × 岗位匹配度分析（兼容入口）。

实现已迁移至 jd_match 包（A JD解析 → B 简历画像 → C 匹配引擎）。
所有 LLM 提示词显式写在 jd_match/prompts.py。
"""

from __future__ import annotations

from typing import Any

from jd_match import analyze_jd_match as _analyze


def analyze_jd_match(
    *,
    resume_text: str,
    jd_text: str,
    structured: dict | None = None,
) -> dict[str, Any]:
    """调用岗位匹配流水线，返回规范化分析结果。"""
    return _analyze(
        resume_text=resume_text,
        jd_text=jd_text,
        structured=structured,
    )
