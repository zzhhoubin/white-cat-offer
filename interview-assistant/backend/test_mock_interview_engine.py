import json
import unittest
from unittest.mock import MagicMock, patch

from llm_utils import LLMNotConfiguredError
from mock_interview_engine import (
    analyze_answer,
    initial_state,
    next_question,
    prepare_session,
)
from mock_interview_scoring import build_report, score_answer


def _mock_completion(content: dict):
    message = MagicMock()
    message.content = json.dumps(content, ensure_ascii=False)
    choice = MagicMock()
    choice.message = message
    resp = MagicMock()
    resp.choices = [choice]
    return resp


class MockInterviewEngineTest(unittest.TestCase):
    @patch("mock_interview_engine.get_llm_model", return_value="deepseek-chat")
    @patch("mock_interview_engine.require_llm_config")
    @patch("mock_interview_engine.openai_client")
    def test_prepare_and_first_question(self, mock_client_fn, _req, _model):
        client = MagicMock()
        mock_client_fn.return_value = client
        client.chat.completions.create.side_effect = [
            _mock_completion({"summary": "围绕数据分析岗位准备"}),
            _mock_completion({"question": "请做个自我介绍", "intent": "表达与匹配度"}),
        ]
        state = initial_state(scope="hr", language="zh", company_name="测试公司")
        state = prepare_session(
            role="数据分析师",
            jd_text="负责用户增长分析",
            resume_context="10年数据分析经验",
            state=state,
        )
        self.assertTrue(state.get("prepared"))
        q = next_question(
            state=state,
            role="数据分析师",
            jd_text="负责用户增长分析",
            resume_context="10年数据分析经验",
            asset_titles=["会员项目"],
            history=[],
        )
        self.assertIn("question", q)
        self.assertEqual(q["round"], "hr")

    @patch("mock_interview_engine.get_llm_model", return_value="deepseek-chat")
    @patch("mock_interview_engine.require_llm_config")
    @patch("mock_interview_engine.openai_client")
    def test_followup_on_short_answer(self, mock_client_fn, _req, _model):
        client = MagicMock()
        mock_client_fn.return_value = client
        client.chat.completions.create.return_value = _mock_completion(
            {"followup": "请举一个具体例子，说明你的个人角色、关键行动和结果指标。"}
        )
        state = initial_state(scope="hr", language="zh", company_name="")
        decision = analyze_answer(
            state=state,
            role="数据分析师",
            jd_text="JD",
            resume_context="简历",
            question="为什么看这个岗位？",
            answer_text="感兴趣",
            intent="动机",
        )
        self.assertEqual(decision["action"], "followup")
        self.assertTrue(decision.get("followup_question"))

    def test_report_has_rounds(self):
        session = {"session_id": "abc", "role": "数据分析师"}
        answers = [
            {
                "answer_id": "1",
                "index": 1,
                "question": "自我介绍",
                "intent": "表达",
                "round_key": "hr",
                "answer_text": "我有十年经验",
                "score": 80,
                "dimension_scores": {},
                "improvements": [],
                "reference_answer": "参考",
            }
        ]
        report = build_report(session, answers)
        self.assertIn("rounds", report)
        self.assertIn("recommendation", report)
        self.assertIn("question_catalog", report)
        self.assertIn("action_plan", report)


class MockInterviewScoringTest(unittest.TestCase):
    @patch("mock_interview_scoring.get_llm_model", return_value="deepseek-chat")
    @patch("mock_interview_scoring.require_llm_config")
    @patch("mock_interview_scoring.openai_client")
    def test_score_returns_normalized_payload(self, mock_client_fn, _req, _model):
        client = MagicMock()
        mock_client_fn.return_value = client
        client.chat.completions.create.return_value = _mock_completion(
            {
                "score": 78,
                "dimension_scores": {
                    "专业能力": 80,
                    "沟通表达": 75,
                    "逻辑思维": 76,
                    "应变能力": 70,
                    "文化匹配": 78,
                    "成长潜力": 74,
                },
                "answer_summary": "描述了订单系统优化案例",
                "strengths": ["有具体案例"],
                "improvements": ["补充量化指标"],
                "optimization_tips": ["用 STAR 结构重组回答"],
                "reference_answer": "按 STAR 结构回答。",
            }
        )
        result = score_answer(
            role="后端工程师",
            jd_text="负责接口开发和性能优化",
            resume_context="订单系统性能优化项目",
            question="讲一个你最有代表性的项目。",
            answer_text="背景是订单系统接口慢。我负责定位瓶颈，然后优化 SQL 和缓存，最后响应时间下降 35%。",
            intent="项目深挖",
            reference_answer="按 STAR 结构回答。",
        )
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 100)
        self.assertIn("专业能力", result["dimension_scores"])
        self.assertIn("optimization_tips", result)

    def test_llm_not_configured_raises(self):
        with patch("mock_interview_scoring.require_llm_config", side_effect=LLMNotConfiguredError("未配置")):
            with self.assertRaises(LLMNotConfiguredError):
                score_answer(
                    role="后端工程师",
                    jd_text="JD",
                    resume_context="简历",
                    question="问题",
                    answer_text="回答",
                )

    def test_build_report_contains_markdown_and_items(self):
        session = {"session_id": "demo123", "role": "后端工程师"}
        answers = [
            {
                "answer_id": "a1",
                "question": "请做自我介绍。",
                "intent": "表达结构",
                "answer_text": "我有后端开发经验，负责过订单系统。",
                "answer_summary": "介绍了后端与订单系统经验",
                "score": 72,
                "dimension_scores": {
                    "专业能力": 72,
                    "沟通表达": 75,
                    "逻辑思维": 70,
                    "应变能力": 68,
                    "文化匹配": 74,
                    "成长潜力": 71,
                },
                "strengths": ["表达清楚"],
                "improvements": ["补充量化结果"],
                "optimization_tips": ["补充项目指标"],
                "reference_answer": "结合真实经历说明背景、行动和结果。",
            }
        ]
        report = build_report(session, answers)
        self.assertEqual(report["total_score"], 72)
        self.assertEqual(len(report["items"]), 1)
        self.assertEqual(len(report["dimensions"]), 6)
        self.assertIn("面试题目合集", report["markdown"])
        self.assertIn("<!DOCTYPE html>", report["html"])


if __name__ == "__main__":
    unittest.main()
