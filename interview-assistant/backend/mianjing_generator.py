"""面经备考包生成器 —— 基于 LLM 生成结构化备考包。

完整版会调用 InterviewRadar 的 Python 脚本（网搜 → connector → 抽题 → pipeline），
当前 MVP 版直接用 LLM 结合简历数据生成备考包。
"""

import json
import logging
import uuid
from datetime import datetime, timezone

from llm_utils import get_llm_model, openai_client
from config import settings

logger = logging.getLogger(__name__)

# 备考包 JSON Schema（传给 LLM 的 system prompt）
SYSTEM_PROMPT = """你是一位资深面试教练和技术面试官。根据候选人的简历和目标岗位，生成一份完整的面试备考包。

你必须返回严格的 JSON 格式，不要包含 markdown 代码块标记，只返回纯 JSON。

JSON 结构如下（所有字段必填）：
{
  "targetRole": "目标岗位",
  "roleAliases": ["岗位别名1", "岗位别名2"],
  "positioning": {
    "summary": "一句话候选人定位（1-2句中文）",
    "evidences": [
      {
        "title": "项目/经历名称（含公司名）",
        "points": ["证据点1", "证据点2", "证据点3"]
      }
    ]
  },
  "gapAnalysis": {
    "dimensions": [
      {
        "dimension": "能力维度名",
        "current": "简历当前表现",
        "risk": "面试风险",
        "suggestion": "准备建议"
      }
    ]
  },
  "dataSources": {
    "summary": ["来源描述1", "来源描述2"],
    "gaps": ["数据缺口描述1"]
  },
  "questions": [
    {
      "text": "题目文字",
      "sources": [
        {"label": "来源描述", "url": "https://...", "evidence": "原文证据片段"}
      ],
      "points": ["回答要点1", "回答要点2"],
      "anchor": "可挂简历锚点描述"
    }
  ],
  "questionLabel": "高频题",
  "questionsNote": "如有数据来源限制可在此说明，无则留空",
  "followUpChains": [
    {
      "theme": "主题名",
      "project": "简历项目名",
      "seedQuestion": "种子题文字",
      "followups": ["追问1", "追问2", "追问3", "追问4", "追问5"],
      "focusPoints": ["准备重点1", "准备重点2"]
    }
  ],
  "selfIntro": "60-90秒自我介绍草稿（2-3段中文口语稿）",
  "sprintPlan": [
    {"day": 1, "theme": "Day 1 主题", "items": ["行动项1", "行动项2"]}
  ],
  "resumeImprovements": [
    {"title": "项目/经历名", "content": "补强的简历表述"}
  ],
  "sourceList": {
    "牛客/网页": [{"url": "https://...", "note": "说明"}],
    "GitHub": [],
    "小红书": []
  },
  "checklist": [
    "面试前速查项1",
    "面试前速查项2"
  ]
}

生成规则：
1. positioning.evidences 必须有 3 个，从简历中提取最亮眼的项目
2. gapAnalysis.dimensions 至少覆盖 5 个维度（如：技术硬实力、业务分析框架、A/B实验与统计学、指标体系搭建、产品思维、机器学习等，根据岗位调整）
3. questions 生成 15-24 道题，每题必须包含 sources/points/anchor
4. followUpChains 生成 3-4 条，每条 5 个追问，必须锚定简历中的具体项目
5. sprintPlan 必须有 7 天（Day 1-7）
6. resumeImprovements 至少 3 条
7. checklist 至少 15 项
8. 所有内容用中文，技术名词可保留英文
9. selfIntro 用第一人称"我"，语气自然口语化
10. 题目来源标记为"AI 生成"；真实面经由后台雷达采集后单独成组，优先级高于 AI 生成题"""


RADAR_TIMEOUT_SEC = 180  # 优先牛客模式通常 1–2 分钟内完成


def generate(resume_data: dict, target_role: str, resume_name: str = "") -> dict:
    """根据简历数据 + 目标岗位生成备考包。

    resume_data: 结构化简历数据（来自 material store 的 assets + resume_text）
    target_role: 目标岗位方向
    resume_name: 简历名称

    返回: 与前端 MJ 组件 data 字段对应的 dict
    """
    client = openai_client()

    # 从 resume_data 提取关键信息
    structured = resume_data.get("structured", {}) if isinstance(resume_data, dict) else {}
    resume_text = resume_data.get("resume_text", "") if isinstance(resume_data, dict) else ""

    # 如果 resume_data 本身就是 structured 数据
    if not structured and isinstance(resume_data, dict):
        if "basics" in resume_data or "experience" in resume_data:
            structured = resume_data

    # 构建简历摘要
    resume_summary = _build_resume_summary(structured, resume_text, resume_name)

    user_prompt = f"""请为以下候选人生成面试备考包。

目标岗位：{target_role}

候选人简历信息：
{resume_summary}

请严格按照 system prompt 中的 JSON 结构生成完整的备考包。直接返回 JSON，不要包含任何其他文字。"""

    try:
        response = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
            max_tokens=8192,
        )
        raw = response.choices[0].message.content.strip()
        # 清理可能的 markdown 代码块
        if raw.startswith("```"):
            lines = raw.split("\n")
            # 去掉第一行 (```json 或 ```) 和最后一行 (```)
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].startswith("```"):
                lines = lines[:-1]
            raw = "\n".join(lines)

        data = json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error("LLM returned invalid JSON: %s", str(e)[:200])
        raise ValueError(f"LLM 返回的 JSON 格式有误，请重试: {e}") from e
    except Exception as e:
        logger.exception("LLM generation failed")
        raise

    # ---- 给 LLM 题目打上来源标签 ----
    llm_questions = data.get("questions", [])
    for q in llm_questions:
        q["source_type"] = "llm"
        q["source_label"] = "AI 生成"
        # 统一 sources，便于前端展示
        if not q.get("sources"):
            q["sources"] = [{"label": "AI 生成（基于简历与岗位）", "url": "", "evidence": ""}]
    data["questions"] = llm_questions

    # ---- 双分组：真实面经（优先，先占位）+ AI 生成 ----
    data["questionGroups"] = [
        {
            "label": "真实面经题",
            "tag": "真实面经",
            "source_type": "real",
            "questions": [],
            "pending": True,
        },
        {
            "label": "AI 生成参考题",
            "tag": "AI 生成",
            "source_type": "llm",
            "questions": llm_questions,
            "pending": False,
        },
    ]

    # ---- 补充默认字段 ----
    data.setdefault("targetRole", target_role)
    data.setdefault("roleAliases", [])
    data["questionsNote"] = "真实面经采集中，优先展示完成后的真实来源题目；下方为 AI 根据简历与岗位生成的参考题"
    data.setdefault("checklist", [])
    data.setdefault("sourceList", {"牛客/网页": [], "GitHub": [], "小红书": []})
    data.setdefault("dataSources", {
        "summary": ["AI 已根据简历与岗位生成参考题"],
        "gaps": ["真实面经（牛客/小红书等）采集中…"],
    })
    # 标记：雷达尚未采集
    data["_radar_enriched"] = False

    return data


def enrich_with_radar(data: dict, target_role: str, structured: dict) -> dict:
    """【后台调用】用雷达管道采集真实面经题，合并到已生成的 data 中。

    真实面经优先于 AI 生成题；两组均保留并打来源标签。
    此函数可能耗时数分钟（网络爬取），应在后台线程中调用。
    """
    if data.get("_radar_enriched"):
        return data

    real_questions = []
    radar_summary = []
    radar_gaps = []
    radar_result = None

    try:
        from mianjing_radar.pipeline import crawl_real_questions
        import concurrent.futures

        # 不可用 with ThreadPoolExecutor：超时后 shutdown(wait=True) 会一直等爬虫，导致前端永不更新
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
        try:
            future = pool.submit(
                crawl_real_questions,
                target_role=target_role,
                resume_data=structured,
                limit=15,
                mode="priority",
            )
            try:
                radar_result = future.result(timeout=RADAR_TIMEOUT_SEC)
            except concurrent.futures.TimeoutError:
                logger.warning("Radar crawl timed out after %ss", RADAR_TIMEOUT_SEC)
                radar_gaps.append(f"真实面经采集超时（>{RADAR_TIMEOUT_SEC}s）")
                radar_result = None
        finally:
            pool.shutdown(wait=False, cancel_futures=True)

        if radar_result:
            radar_summary = radar_result.get("summary", [])
            radar_gaps = list(radar_result.get("gaps", []) or []) + radar_gaps
            for rq in radar_result.get("questions", []):
                label = rq.source_label or "真实面经"
                real_questions.append({
                    "text": rq.text,
                    "sources": [{
                        "label": label,
                        "url": rq.source_url,
                        "evidence": rq.evidence,
                    }],
                    "points": rq.points or ["结合简历项目准备回答"],
                    "anchor": rq.anchor or "",
                    "source_type": "real",
                    "source_label": label,
                })
    except Exception as e:
        logger.warning("Radar crawl failed: %s", e)
        radar_gaps.append(f"真实面经采集失败：{e}")
        radar_result = None

    # ---- 抽出 AI 题（排除已有 real）----
    existing = data.get("questions", []) or []
    llm_questions = [q for q in existing if q.get("source_type") != "real"]
    for q in llm_questions:
        q["source_type"] = "llm"
        q.setdefault("source_label", "AI 生成")

    # ---- 合并：真实优先 ----
    data["questions"] = real_questions + llm_questions

    data["questionGroups"] = [
        {
            "label": "真实面经题",
            "tag": "真实面经",
            "source_type": "real",
            "questions": real_questions,
            "pending": False,
        },
        {
            "label": "AI 生成参考题",
            "tag": "AI 生成",
            "source_type": "llm",
            "questions": llm_questions,
            "pending": False,
        },
    ]

    # 更新数据来源概况
    ds = data.get("dataSources", {}) or {}
    existing_summary = [s for s in (ds.get("summary") or []) if "采集中" not in str(s)]
    existing_gaps = [g for g in (ds.get("gaps") or []) if "采集中" not in str(g)]
    ds["summary"] = radar_summary + existing_summary
    if not any("AI" in str(s) for s in ds["summary"]):
        ds["summary"].append(f"AI 生成参考题：{len(llm_questions)} 题")
    ds["gaps"] = radar_gaps + existing_gaps
    data["dataSources"] = ds

    # 更新来源列表
    source_list = data.get("sourceList", {"牛客/网页": [], "GitHub": [], "小红书": []})
    for rq in real_questions:
        src_label = rq.get("source_label", "")
        src_url = (rq.get("sources") or [{}])[0].get("url", "")
        if not src_url:
            continue
        if "GitHub" in src_label or "github" in src_label.lower():
            bucket = "GitHub"
        elif "小红书" in src_label:
            bucket = "小红书"
        else:
            bucket = "牛客/网页"
        if not any(s.get("url") == src_url for s in source_list.get(bucket, [])):
            source_list.setdefault(bucket, []).append({
                "url": src_url,
                "note": rq.get("text", "")[:40],
            })
    data["sourceList"] = source_list

    data["_radar_enriched"] = True

    if real_questions:
        data["questionsNote"] = f"以下优先展示 {len(real_questions)} 道真实面经，其后为 AI 根据简历与岗位生成的参考题"
        data["questionLabel"] = "高频题（真实面经优先）"
    else:
        data["questionsNote"] = "真实面经暂未抓取到数据，当前展示 AI 根据简历与岗位生成的参考题"

    logger.info(
        "Radar enrichment done: %d real + %d llm questions",
        len(real_questions),
        len(llm_questions),
    )
    return data


def _build_resume_summary(structured: dict, resume_text: str, resume_name: str) -> str:
    """把结构化简历数据转成 LLM 可读的文本摘要。"""
    lines = []
    if resume_name:
        lines.append(f"简历名称：{resume_name}")

    basics = structured.get("basics", {})
    if basics:
        name = basics.get("name", "")
        title = basics.get("target_role") or basics.get("title", "")
        email = basics.get("email", "")
        phone = basics.get("phone", "")
        city = basics.get("city", "")
        status = basics.get("_status", "")
        parts = []
        if name:
            parts.append(f"姓名：{name}")
        if title:
            parts.append(f"职位：{title}")
        if city:
            parts.append(f"城市：{city}")
        if email:
            parts.append(f"邮箱：{email}")
        if phone:
            parts.append(f"电话：{phone}")
        if status:
            parts.append(f"状态：{status}")
        if parts:
            lines.extend(parts)
        # 个人总结/技能
        summary = basics.get("summary", "")
        if summary:
            lines.append(f"个人总结：{summary}")

    # 技能
    skills = structured.get("skills", [])
    if skills:
        skill_lines = []
        for g in skills:
            group_name = g.get("group", "")
            items = g.get("items", [])
            if group_name and items:
                skill_lines.append(f"{group_name}：{', '.join(items)}")
        if skill_lines:
            lines.append("技能：")
            lines.extend(skill_lines)

    # 经历
    experience = structured.get("experience", [])
    if experience:
        lines.append("工作经历：")
        for exp in experience:
            company = exp.get("company", "")
            title_e = exp.get("title", "")
            start = exp.get("start", "")
            end = exp.get("end", "")
            desc = exp.get("description", "")
            bullets = exp.get("bullets", [])
            lines.append(f"- {company} | {title_e} | {start} - {end}")
            if desc:
                lines.append(f"  {desc}")
            for b in bullets:
                lines.append(f"  · {b}")

    # 项目
    projects = structured.get("projects", [])
    if projects:
        lines.append("项目经历：")
        for proj in projects:
            name_p = proj.get("name", "")
            role = proj.get("role", "")
            desc = proj.get("description", "")
            bullets = proj.get("bullets", [])
            lines.append(f"- {name_p}" + (f"（{role}）" if role else ""))
            if desc:
                lines.append(f"  {desc}")
            for b in bullets:
                lines.append(f"  · {b}")

    # 教育
    education = structured.get("education", [])
    if education:
        lines.append("教育背景：")
        for edu in education:
            school = edu.get("school", "")
            degree = edu.get("degree", "")
            major = edu.get("major", "")
            start = edu.get("start", "")
            end = edu.get("end", "")
            lines.append(f"- {school} | {degree} | {major} | {start} - {end}")

    # 如果结构化数据太少，补上原始文本
    if len(lines) < 5 and resume_text:
        lines.append(f"简历原文：{resume_text[:3000]}")

    return "\n".join(lines)


def generate_mock(target_role: str, resume_name: str = "") -> dict:
    """无简历时的 mock 生成（用于测试前端 UI）"""
    import random
    data = {
        "targetRole": target_role,
        "roleAliases": [],
        "positioning": {
            "summary": f"具备扎实的{target_role}能力，拥有丰富的项目实战经验和数据驱动决策能力。",
            "evidences": [
                {
                    "title": "核心项目一",
                    "points": ["主导关键业务指标提升", "搭建完整数据分析体系", "适合回答业务分析框架类问题"],
                },
                {
                    "title": "核心项目二",
                    "points": ["从0到1搭建分析平台", "推动数据驱动产品迭代", "适合回答指标体系搭建类问题"],
                },
                {
                    "title": "核心技术能力",
                    "points": ["精通SQL和Python数据分析", "熟悉A/B实验设计与评估", "适合回答技术实现类问题"],
                },
            ],
        },
        "gapAnalysis": {
            "dimensions": [
                {"dimension": "SQL硬实力", "current": "简历未显式突出", "risk": "面试必考窗口函数", "suggestion": "刷牛客SQL题库，准备复杂案例"},
                {"dimension": "A/B实验", "current": "有实践经验", "risk": "方法论细节可能被追问", "suggestion": "系统梳理假设检验知识体系"},
                {"dimension": "业务分析框架", "current": "经验丰富", "risk": "框架迁移能力待验证", "suggestion": "熟练掌握逻辑树、杜邦分析法"},
                {"dimension": "指标体系", "current": "有多业务线经验", "risk": "缺乏系统性表达", "suggestion": "用OSM框架包装经验"},
                {"dimension": "产品思维", "current": "跨部门协作经验", "risk": "数据驱动产品的案例表述不足", "suggestion": "准备完整案例"},
                {"dimension": "机器学习", "current": "简历有提及但未展开", "risk": "大厂必问基础原理", "suggestion": "复习XGBoost/随机森林原理"},
            ],
        },
        "dataSources": {
            "summary": ["LLM 生成（Mock 降级数据）"],
            "gaps": ["LLM API 调用失败或返回格式异常，使用本地模板数据"],
        },
        "questions": [
            {
                "text": f"请做一下自我介绍",
                "sources": [{"label": "通用面经", "url": "", "evidence": "几乎所有面试的第一道题"}],
                "points": ["突出核心能力和匹配度", "按STAR法则组织项目经历", "控制在60-90秒"],
                "anchor": "用你最亮眼的项目作为开场证据",
            },
            {
                "text": "你做过的最有挑战性的项目是什么？",
                "sources": [{"label": "通用面经", "url": "", "evidence": "项目深挖类高频题"}],
                "points": ["按背景-挑战-行动-结果展开", "突出你的思考和决策过程", "用数据量化成果"],
                "anchor": "选择最能体现你核心能力的项目",
            },
            {
                "text": "如何处理数据异常/指标异动？",
                "sources": [{"label": "通用面经", "url": "", "evidence": "数据分析师必考题"}],
                "points": ["先确认数据口径和准确性", "按维度拆解下钻", "内部因素和外部因素穷举"],
                "anchor": "准备一个真实的异动归因案例",
            },
        ],
        "questionLabel": "Mock 题",
        "questionsNote": "⚠️ 这是 Mock 数据，用于测试前端展示。正式使用时请配置 LLM API Key 并确保有简历数据。",
        "followUpChains": [
            {
                "theme": "核心业务指标优化",
                "project": "你的核心项目",
                "seedQuestion": "你做过的最有挑战性的项目是什么？",
                "followups": [
                    "这个项目的背景是什么？你承担什么角色？",
                    "你在项目中遇到的最大困难是什么？如何解决的？",
                    "如果重新做这个项目，你会怎么改进？",
                    "这个项目的成果如何衡量？有哪些量化指标？",
                    "这个项目经验如何迁移到我们的业务场景？",
                ],
                "focusPoints": ["准备真实数据对比", "强调你的决策过程", "展示闭环思维"],
            },
        ],
        "selfIntro": f"面试官你好，我是一名{target_role}。\n\n我有X年的相关工作经验，擅长数据分析、业务洞察和数据驱动决策。在之前的工作中，我主导了多个核心项目，通过数据分析帮助业务实现了显著增长。\n\n我不仅精通SQL和Python等技术工具，更重要的是我能够将数据洞察转化为可落地的业务策略。我相信我的经验能够为贵团队带来价值。",
        "sprintPlan": [
            {"day": 1, "theme": "SQL + 基础知识", "items": ["刷SQL题库10题", "复习核心概念", "整理项目经历"]},
            {"day": 2, "theme": "统计学 + A/B实验", "items": ["复习假设检验", "整理A/B实验案例", "准备实验设计回答框架"]},
            {"day": 3, "theme": "业务分析框架", "items": ["异动归因框架演练", "指标体系搭建练习", "准备项目复盘案例"]},
            {"day": 4, "theme": "项目深挖", "items": ["逐个项目STAR法则包装", "准备追问回答", "整理量化成果数据"]},
            {"day": 5, "theme": "机器学习 + 综合", "items": ["复习常见算法原理", "费米问题练习", "整理技术知识点"]},
            {"day": 6, "theme": "模拟面试", "items": ["60秒自我介绍练习", "找朋友模拟面试", "准备反问问题"]},
            {"day": 7, "theme": "查漏补缺", "items": ["回看薄弱知识点", "整理作品和数据证据", "阅读目标公司动态"]},
        ],
        "resumeImprovements": [
            {"title": "项目经历", "content": "用STAR法则重写每个项目：Situation（背景）→ Task（任务）→ Action（行动）→ Result（量化结果）"},
            {"title": "技能部分", "content": "显式列出SQL、Python、Tableau等具体工具，并标注熟练程度；补充统计学和A/B实验相关技能"},
            {"title": "个人总结", "content": "用1-2句话突出你的差异化和核心竞争力，避免使用「认真负责」「学习能力强」等空泛表述"},
        ],
        "sourceList": {
            "牛客/网页": [],
            "GitHub": [],
            "小红书": [],
        },
        "checklist": [
            "60秒自我介绍已练习10遍以上",
            "3个最强项目已按STAR法则准备好",
            "准备3个真实trade-off/失败/返工案例",
            "准备好目标岗位必会5道高频题",
            "准备4个高质量反问问题",
            "整理好可展示的作品/数据/流程图",
            "确认面试时间、地点、形式",
            "研究公司和团队背景",
            "准备纸质简历3份",
            "提前测试设备（视频面试）",
            "准备舒适得体的着装",
            "提前15分钟到达（或上线）",
            "准备好纸笔做笔记",
            "面试后24小时内发送感谢邮件",
            "复盘面试中的亮点和不足",
        ],
    }
    # 给 mock 题目打上 source 标签
    for q in data["questions"]:
        q["source_type"] = "llm"
        q["source_label"] = "AI 生成（Mock）"
    data["questionGroups"] = [
        {
            "label": "真实面经题",
            "tag": "真实面经",
            "source_type": "real",
            "questions": [],
            "pending": False,
        },
        {
            "label": "AI 生成参考题",
            "tag": "AI 生成",
            "source_type": "llm",
            "questions": data["questions"],
            "pending": False,
        },
    ]
    data["questionsNote"] = "Mock 降级：仅含 AI 参考题（真实面经需正常生成流程采集）"
    data["_radar_enriched"] = True
    return data
