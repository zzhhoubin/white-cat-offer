import unittest

from mock_interview_report_html import build_html_report


class MockInterviewHtmlReportTest(unittest.TestCase):
    def test_build_html_contains_sections(self):
        session = {"session_id": "abc123", "role": "数据分析师", "company_name": "测试公司"}
        report = {
            "total_score": 78,
            "recommendation": "推荐录用",
            "summary": "整体表现良好。",
            "dimensions": [{"name": "专业能力", "score": 80, "comment": "达标"}],
            "rounds": [],
            "question_catalog": [{"index": 1, "question": "自我介绍", "intent": "表达"}],
            "action_plan": {
                "top_issues": ["补充量化结果"],
                "phrasing_tips": ["用 STAR 结构"],
                "materials": ["准备项目案例"],
            },
        }
        answers = [
            {
                "question": "自我介绍",
                "answer_text": "我有十年经验",
                "answer_summary": "十年经验",
                "score": 80,
                "strengths": ["表达清楚"],
                "improvements": ["补充指标"],
                "optimization_tips": ["补充 STAR"],
                "reference_answer": "参考回答",
            }
        ]
        html = build_html_report(session, report, answers)
        self.assertIn("<!DOCTYPE html>", html)
        self.assertIn("数据分析师", html)
        self.assertIn("逐轮详细反馈", html)
        self.assertIn("面试题目合集", html)
        self.assertIn("核心考察点", html)
        self.assertNotIn("得分</th>", html)


if __name__ == "__main__":
    unittest.main()
