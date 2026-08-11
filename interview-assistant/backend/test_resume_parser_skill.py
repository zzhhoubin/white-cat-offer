"""Skill v3：10 段 prompt、次级标题与序号回填。"""

from resume_parser_skill import SKILL_SYSTEM_PROMPT, _to_bullets, map_skill_to_structured


def test_prompt_has_ten_sections():
    assert "Skill 元信息" in SKILL_SYSTEM_PROMPT
    assert "输入格式要求" in SKILL_SYSTEM_PROMPT
    assert "噪音清洗" in SKILL_SYSTEM_PROMPT
    assert "个人介绍子字段" in SKILL_SYSTEM_PROMPT
    assert "结构分割与识别规则" in SKILL_SYSTEM_PROMPT
    assert "信息抽取与格式化约束" in SKILL_SYSTEM_PROMPT
    assert "输出结构" in SKILL_SYSTEM_PROMPT
    assert "特殊场景处理规则" in SKILL_SYSTEM_PROMPT
    assert "示例交互" in SKILL_SYSTEM_PROMPT
    assert "执行检查清单" in SKILL_SYSTEM_PROMPT
    assert "次级标题" in SKILL_SYSTEM_PROMPT
    assert "有序序号" in SKILL_SYSTEM_PROMPT or "有序或无序" in SKILL_SYSTEM_PROMPT
    assert "1.本人负责算法优化" in SKILL_SYSTEM_PROMPT or "1.本人负责算法优化。" in SKILL_SYSTEM_PROMPT


def test_to_bullets_keeps_ordered_markers():
    lines = _to_bullets("1.本人负责算法优化。\n2.负责算法开发")
    assert lines[0].startswith("1.")
    assert lines[1].startswith("2.")
    assert "算法优化" in lines[0]
    assert "算法开发" in lines[1]


def test_to_bullets_keeps_unordered_markers():
    lines = _to_bullets("- 负责需求分析\n• 推动上线")
    assert lines[0].startswith("-")
    assert lines[1].startswith("•")


def test_project_fillback_titles_and_numbers():
    out = map_skill_to_structured(
        {
            "status": "success",
            "parsed_data": {
                "personal_info": {
                    "name": "李思睿",
                    "phone": "13800138000",
                    "email": "a@b.com",
                    "work_years": "",
                    "location": "北京",
                    "education_level": "硕士",
                    "age": "30",
                    "birth_date": "1995-03",
                },
                "work_experience": [],
                "project_experience": [
                    {
                        "project_name": "智能推荐系统",
                        "role": "",
                        "start_date": "",
                        "end_date": "",
                        "project_intro_title": "项目概述",
                        "project_intro": "一个医药公司与医生的推荐系统",
                        "project_responsibilities_title": "负责内容",
                        "project_responsibilities": "1.本人负责算法优化。\n2.负责算法开发",
                        "project_achievements_title": "项目成果",
                        "project_achievements": "1.将点击率提升了20%\n2.系统已上线。",
                    }
                ],
                "education": [],
                "skills": {"skill_list": [], "certifications": []},
            },
        }
    )
    html = out["projects"][0]["_html"]
    assert "<strong>项目概述</strong>" in html
    assert "<strong>负责内容</strong>" in html
    assert "<strong>项目成果</strong>" in html
    assert "1.本人负责算法优化" in html
    assert "2.负责算法开发" in html
    assert "1.将点击率提升了20%" in html
    assert "2.系统已上线" in html
    # 序号未被剥除
    assert "算法优化。</p>" in html or "算法优化。" in html
    assert not any(
        x in html
        for x in ["<p>本人负责算法优化", "<p>负责算法开发"]  # 不应出现去掉序号的纯正文行作为唯一形式
    ) or ("1.本人负责算法优化" in html)


def test_name_strips_gender_tail():
    out = map_skill_to_structured(
        {
            "parsed_data": {
                "personal_info": {"name": "慕容楠性别：女", "phone": "", "email": ""},
                "work_experience": [],
                "project_experience": [],
                "education": [],
                "skills": {"skill_list": [], "certifications": []},
            }
        }
    )
    assert out["basics"]["name"] == "慕容楠"
