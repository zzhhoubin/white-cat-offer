"""简历 PDF 结构化解析 Skill v3 — 基于 references/resume-parser-skill.md v3.0。

将 PDF 原始文本通过 LLM Skill Prompt 解析为结构化 JSON，再映射到内部 structured 格式。
SKILL_SYSTEM_PROMPT 严格覆盖 skill 文档的 10 个部分，不得遗漏。
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from llm_utils import LLMServiceError, get_llm_model, openai_client, require_llm_config
from resume_schema import normalize_structured

logger = logging.getLogger(__name__)

# ============================================================
# System Prompt — 对应 resume-parser-skill.md 第 1～10 部分（完整）
# ============================================================

SKILL_SYSTEM_PROMPT = """你是一名资深简历解析专家（resume-structure-parser-v3）。请严格按下列 10 个部分执行，不得遗漏任何部分。

════════════════════════════════════
## 1. Skill 元信息
════════════════════════════════════
名称：resume-structure-parser-v3
版本：3.0
触发场景：当用户上传 PDF 简历文本，或提供简历原始文本内容，要求提取简历信息时自动触发。
核心目标：精准识别简历的结构化模块，剔除所有非正文噪音（包括页码），精准提取个人介绍的 8 个子字段并严格校验格式，对长文本进行智能格式化，细化项目经历字段（含次级标题），并自动去除重复内容，输出标准 JSON 格式数据。

════════════════════════════════════
## 2. 输入格式要求
════════════════════════════════════
你收到的是 PDF 解析出的原始纯文本。注意：解析 PDF 时需优先去除页眉页脚；若为扫描件需先经 OCR 处理。请基于该纯文本完成结构化提取。

════════════════════════════════════
## 3. 核心指令：噪音清洗（严格剔除以下内容）
════════════════════════════════════
在开始结构化分割之前，必须执行「语义降噪」，丢弃以下非正文内容：

1. 页码与分页符：如 1/5、第 1 页、Page 1 of 3、--- 1 --- 等单独出现的页码标记，以及因 PDF 分页产生的冗余空行。
2. 平台水印与标签：如「猎聘」「智联招聘」「Boss直聘」「简历编号」「更新于」「下载于」等。
3. 免责声明与法律条款：如「该人选信息仅供公司招聘使用…」「严禁以招聘以外的任何目的…」「申请此职位表明您已阅读并同意…」等。
4. 通用公司简介（非个人经历）：若遇到对公司整体的通用描述（如「阿里巴巴集团经营多元化的互联网业务…」「由XXX成立于XXX年…」），一律剔除，仅保留候选人具体的岗位头衔、所在部门及具体职责描述。判定技巧：描述「公司多么厉害」而非「我做了什么」→ 丢弃。
5. 无关的图标或特殊字符乱码：如 [image]、乱码符号等。
6. OCR 重复段落：同一经历多次出现，只保留更完整的一条。

════════════════════════════════════
## 4. 个人介绍子字段：一级下钻与格式规范
════════════════════════════════════
从简历的「个人信息/个人概况/基本信息」区域中，精确提取以下 8 个子字段，并严格校验格式：

| 子字段 | 识别关键词锚点 | 格式规范与校验规则 |
|--------|----------------|-------------------|
| name | 姓名、名字、Name | 中文：2-4 个汉字，不含标点（如「张、三」错误）。英文：字母组合，可含空格或点号（如 Robert J. Downey）。禁止混入「性别」「年龄」等属性值。 |
| phone | 电话、手机、联系方式、Mobile、Phone | 中国大陆：11 位数字，以 1 开头。支持 +86 / (86)。剔除座机号。 |
| email | 邮箱、Email、E-mail、电子邮件 | 标准格式 xxx@xxx.xxx，支持常见域名。 |
| work_years | 工作年限、工作经验、工作年数、工龄、Years of Experience | 以「年」为单位（如 5年、3-5年）。原文未写明时可根据工作经历时间跨度推算并标注 (推算)。 |
| location | 所在地、所在城市、城市、Location、City | 提取城市名称；详细地址仅取城市级。 |
| education_level | 学历、教育程度、最高学历、学位、Education | 取最高学历：博士、硕士、本科、大专等；与教育经历交叉验证。 |
| age | 年龄、Age | 纯数字，单位为「岁」；可由出生年份推算并标注 (推算)。 |
| birth_date | 出生日期、出生年月、生日、Date of Birth、DOB | YYYY-MM 或 YYYY年MM月；精确到日则 YYYY-MM-DD。 |

混合场景：如「姓名：慕容楠性别：女年龄：30」，必须按标点/语义分割，严禁将性别或年龄混入姓名。

════════════════════════════════════
## 5. 结构分割与识别规则
════════════════════════════════════
清洗完噪音后，依据以下规则对剩余正文进行模块切分：

| 模块名称 | 识别的关键词锚点 | 提取字段 |
|----------|------------------|----------|
| 个人介绍 | 个人信息、个人概况、基本信息、关于我、联系方式 | 上述 8 个子字段（见第 4 节） |
| 工作经历 | 工作经历、工作经验、Work Experience、Professional Experience | company, title, start_date, end_date, is_current, responsibilities（保留完整描述） |
| 项目经历 | 项目经历、项目经验、Projects、项目（结合时间线） | 见第 7 节细化字段（含次级标题） |
| 教育经历 | 教育经历、教育背景、Education、Academic | school, major, degree, start_date, end_date |
| 技能/证书 | 技能、语言能力、专业技能、证书、Skill、Languages | skill_list[]、certifications[]、languages[{name,level,cert}] |

════════════════════════════════════
## 6. 信息抽取与格式化约束（核心升级）
════════════════════════════════════
### 6.1 精准姓名提取（符合中英文规范）
- 中文姓名：仅包含中文汉字（如 张伟），不得包含标点。
- 英文姓名：仅包含英文字母、空格、点号，不得包含下划线或数字。
- 混合场景：必须智能分割 name / gender / age，严禁属性混入姓名。

### 6.2 长文本智能格式化（保证可读性）
对于 responsibilities（工作职责）和 project 下的描述字段：
- 断句：根据句号、分号、数字序号（1. 2. 3.）分段，确保每条描述独立成句（换行分隔）。
- 分段：大段无格式纯文本按语义逻辑拆为清晰列表或段落。
- **保留序号**：每段前的有序序号（1. 2. 3. / 1、2、3）或无序标识（-、•、·、→、► 等）必须与原文一致地保留在该段文本开头，严禁删除或改写序号。
- 原文保留：格式化仅限调整标点和换行，严禁删减、改写或概括原文中的任何实质性词汇。

### 6.3 内容去重机制（禁止重复）
解析完成后必须执行全局去重：同一内容多次识别则删除重复项，优先保留描述更完整、更详细的那一条，并在 deduplication_log 中记录。

### 6.4 项目经历次级标题与序号（重要）
项目经历下常有次级标题与带序号的正文，例如：
- 项目概述 / 项目介绍 / 项目描述
- 负责内容 / 项目职责 / 本人职责
- 项目成果 / 项目业绩 / 取得成果
提取时：
1. 将对应正文分别写入 project_intro / project_responsibilities / project_achievements；
2. **必须保留原文次级标题**，分别写入 project_intro_title / project_responsibilities_title / project_achievements_title（使用简历中的原标题用语）；
3. 次级标题下的具体条目若带有「1. 2. 3.」或「• - →」等标识，**必须原样保留在字段正文中**（可用换行分隔多条，每条以原文序号开头）；
4. 若某段无明确次级标题，该段 title 可用默认「项目概述」「项目职责」「项目成果」，但正文与序号仍完整保留。

### 6.5 工作经历序号
工作经历 responsibilities 同样：按原文换行分段，每段前保留与原文一致的有序或无序序号。

════════════════════════════════════
## 7. 升级后的输出结构（标准 JSON Schema）
════════════════════════════════════
特别针对个人介绍进行 8 个子字段下钻；项目经历细化介绍/职责/成果，并携带次级标题字段。
只输出 JSON，不要 Markdown 代码围栏。

```json
{
  "status": "success",
  "cleaned_raw_text": "清洗后用于参考的纯文本前500字符...",
  "parsed_data": {
    "personal_info": {
      "name": "",
      "phone": "",
      "email": "",
      "work_years": "",
      "location": "",
      "education_level": "",
      "age": "",
      "birth_date": ""
    },
    "work_experience": [
      {
        "id": 1,
        "company": "",
        "title": "",
        "start_date": "",
        "end_date": "",
        "is_current": false,
        "responsibilities": "格式化后的完整职责描述（已去重，若与项目重复则标注）..."
      }
    ],
    "project_experience": [
      {
        "id": 1,
        "project_name": "",
        "role": "",
        "start_date": "",
        "end_date": "",
        "project_intro_title": "项目概述",
        "project_intro": "一个医药公司与医生的推荐系统",
        "project_responsibilities_title": "负责内容",
        "project_responsibilities": "1.本人负责算法优化。\n2.负责算法开发",
        "project_achievements_title": "项目成果",
        "project_achievements": "1.将点击率提升了20%\n2.系统已上线。"
      }
    ],
    "education": [
      {
        "id": 1,
        "school": "",
        "major": "",
        "degree": "",
        "start_date": "",
        "end_date": ""
      }
    ],
    "skills": {
      "skill_list": ["Python", "SQL"],
      "certifications": ["PMP"],
      "languages": [{"name": "英语", "level": "流利", "cert": "CET-6"}]
    }
  },
  "unmatched_text": "未能归类的零散文本（如有）",
  "deduplication_log": "记录去重操作，如：'项目X与工作经历Y内容重复，已移除工作经历中的重复项'"
}
```

说明：project_responsibilities / project_achievements / work responsibilities 字段内，**每行保留原文有序或无序序号**（如 `1.` `2.` `-` `•`）。

════════════════════════════════════
## 8. 特殊场景处理规则（增强版）
════════════════════════════════════
1. 未识别到模块：若某个模块完全缺失（如无「项目经历」），对应数组返回空 []，严禁强行将其他模块内容填入。
2. 个人介绍字段缺失：若某个子字段（如 birth_date）在原文中未出现，对应值设为空字符串 ""，严禁用其他字段的值强行填充。
3. 项目经历字段切分：若原文没有明确分「介绍」「职责」「成果」，请尽力根据语义切分；若无法切分，则将全部内容放入 project_intro，project_responsibilities 与 project_achievements 设为 ""，对应 title 可空，严禁丢弃任何原文。
4. 公司介绍鉴别：遇到「阿里巴巴集团经营多元化的互联网业务…」这类描述直接丢弃，只保留「阿里巴巴（中国）有限公司」作为公司名称。
5. 归属地信息：出现在个人信息中 → location；出现在某段工作经历描述中 → 附在 responsibilities 末尾，不单独提取。
6. 工作年限与年龄推算：原文未写明时可根据教育毕业年份与工作起始年份差值推算，并标注 (推算)。

════════════════════════════════════
## 9. 示例交互（Few-Shot 参考）
════════════════════════════════════
输入文本片段：
```
个人信息 姓名：李思睿 性别：男 电话：138xxxx 邮箱：xxx@xx.com
所在城市：北京 学历：硕士 年龄：30 出生年月：1995-03
（后续为页码 1/5）
工作经历：
1. 美团 产品经理
- 负责需求分析...
项目经历：
项目A：智能推荐系统
  项目概述：一个医药公司与医生的推荐系统
  负责内容（or项目职责）：1.本人负责算法优化。
                        2.负责算法开发
  项目成果（or项目业绩）：1.将点击率提升了20%
                        2.系统已上线。
```

正确解析行为：
- 丢弃：1/5 页码。
- 个人介绍：精准提取 8 个子字段——name: 李思睿、phone: 138xxxx、email: xxx@xx.com、location: 北京、education_level: 硕士、age: 30、birth_date: 1995-03、work_years:（若未直接写，可根据教育和工作时间推算并标注 (推算)）。
- 项目经历：正确切分项目标题（智能推荐系统）；project_intro_title=「项目概述」，project_intro=一个医药公司与医生的推荐系统；project_responsibilities_title=「负责内容」（或原文「项目职责」），project_responsibilities 内保留序号：`1.本人负责算法优化。` 与 `2.负责算法开发`（换行分隔）；project_achievements_title=「项目成果」（或原文「项目业绩」），project_achievements 内保留序号：`1.将点击率提升了20%` 与 `2.系统已上线。`。**回填时次级标题与每条前的有序/无序序号都必须保留。**
- 格式化：将工作经历的职责列表按原文换行分段，每段前保留和原文一样的有序或无序序号（如 `-`）。

════════════════════════════════════
## 10. 执行检查清单（LLM 需自检）
════════════════════════════════════
输出前请逐项确认：
□ 是否已将页眉页脚中的「页码」完全删除？
□ 个人介绍的 8 个子字段是否完整提取，且每个字段均通过格式校验？
□ 提取的姓名是否符合中英文规范，且未混入「性别」等属性？
□ 针对长文本（职责/项目描述），是否已进行适当的断句和分段，且未丢失原文词汇？
□ 项目经历是否已尽量拆分为「介绍、职责、成果」三个维度，并且保留了次级标题？
□ 项目/工作经历各条目前的有序序号（1.2.3.）或无序标识（•、-、→ 等）是否已原样保留？
□ 是否已完成全局去重检查，并在输出中记录了去重日志？
□ 工作年限和年龄若为推算值，是否已标注 (推算)？

开始解析：请将待处理的简历纯文本按用户消息处理，并只输出第 7 节规定的 JSON。
"""


def _call_skill_llm(text: str, max_chars: int = 20000) -> dict[str, Any]:
    """调用 LLM 用 Skill Prompt 解析简历文本。"""
    require_llm_config()
    client = openai_client()
    truncated = text[:max_chars] if len(text) > max_chars else text
    logger.info("Skill LLM: input %d chars", len(truncated))

    resp = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": SKILL_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    "请按 Skill 第 1～10 部分完整规则解析以下简历原文。"
                    "要求：内容不缺失、不乱码、不串模块；长文本只断句换行不删词；"
                    "项目经历必须保留次级标题；条目必须保留原文有序/无序序号；输出合法 JSON。\n\n"
                    f"{truncated}"
                ),
            },
        ],
        temperature=0.0,
        response_format={"type": "json_object"},
    )
    raw = resp.choices[0].message.content or "{}"
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            return json.loads(m.group(0))
        raise LLMServiceError(f"Skill 解析返回非 JSON：{raw[:200]}")


def _as_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (dict, list)):
        return ""
    return str(v).strip()


def _field(obj: Any, *keys: str, default: str = "") -> str:
    """从 dict 取第一个非空字段。"""
    if not isinstance(obj, dict):
        return default
    for k in keys:
        s = _as_str(obj.get(k))
        if s:
            return s
    return default


def _to_bullets(text: Any) -> list[str]:
    """拆成多行，**保留**原文有序/无序序号（1. 2. • - 等），禁止剥除。"""
    if isinstance(text, list):
        return [_as_str(x) for x in text if _as_str(x)]
    t = _as_str(text)
    if not t:
        return []
    t = t.replace("\r\n", "\n")
    lines = [ln.strip() for ln in t.split("\n") if ln.strip()]
    if len(lines) > 1:
        return lines
    # 单行内多个「1.xxx 2.xxx」：在下一个数字序号前切开，序号留在后段开头
    parts = re.split(r"(?=(?:(?<!\d)\d+[\.\)、]\s*))", t)
    parts = [p.strip().rstrip("；;").strip() for p in parts if p.strip()]
    if len(parts) > 1:
        return parts
    return [t]


def _to_rich_html(text: Any) -> str:
    """回填 HTML：每行原样保留序号。"""
    bullets = _to_bullets(text)
    return "".join(f"<p>{b}</p>" for b in bullets) if bullets else ""


def _section_html(title: str, body: Any) -> str:
    """回填时保留次级标题 + 带序号正文。"""
    bullets = _to_bullets(body)
    title = _as_str(title)
    if not bullets and not title:
        return ""
    parts: list[str] = []
    if title:
        parts.append(f"<p><strong>{title}</strong></p>")
    parts.extend(f"<p>{b}</p>" for b in bullets)
    return "".join(parts)


def _build_status(pi: dict) -> str:
    parts: list[str] = []
    edu = _field(pi, "education_level")
    years = _field(pi, "work_years")
    age = _field(pi, "age")
    if edu:
        parts.append(edu)
    if years:
        parts.append(years if "年" in years else f"{years}年经验")
    if age:
        parts.append(age if "岁" in age else f"{age}岁")
    return " · ".join(parts)


def map_skill_to_structured(skill_output: dict) -> dict:
    """将 Skill v3 LLM 输出映射为 internal structured 格式。"""
    if not isinstance(skill_output, dict):
        skill_output = {}
    data = skill_output.get("parsed_data") or skill_output
    if not isinstance(data, dict):
        data = {}
    pi = data.get("personal_info") if isinstance(data.get("personal_info"), dict) else {}

    structured: dict[str, Any] = {
        "schema_version": 1,
        "origin": "upload",
        "template_id": "system-default",
    }

    name = _field(pi, "name")
    name = re.sub(r"(性别|年龄|岁|男|女).*$", "", name).strip()

    structured["basics"] = {
        "name": name,
        "phone": _field(pi, "phone"),
        "email": _field(pi, "email"),
        "city": _field(pi, "location", "city"),
        "target_role": "",
        "links": [],
        "_status": _build_status(pi),
        "_birthday": _field(pi, "birth_date", "birthday"),
        "_age": _field(pi, "age"),
        "_workYears": _field(pi, "work_years"),
        "_educationLevel": _field(pi, "education_level"),
    }

    structured["summary"] = {"bullets": []}

    experience = []
    for e in data.get("work_experience") or []:
        if not isinstance(e, dict):
            continue
        resp = e.get("responsibilities")
        bullets = _to_bullets(resp)
        row = {
            "company": _field(e, "company"),
            "title": _field(e, "title", "role", "position"),
            "start": _field(e, "start_date", "start"),
            "end": _field(e, "end_date", "end") or ("至今" if e.get("is_current") else ""),
            "location": _field(e, "location"),
            "bullets": bullets,
            "_html": _to_rich_html(resp),
        }
        if row["company"] or row["title"] or row["bullets"]:
            experience.append(row)
    structured["experience"] = experience

    projects = []
    for p in data.get("project_experience") or []:
        if not isinstance(p, dict):
            continue
        intro = _field(p, "project_intro", "intro")
        duties = p.get("project_responsibilities") or p.get("responsibilities")
        ach = p.get("project_achievements") or p.get("achievements")

        intro_title = _field(p, "project_intro_title", "intro_title") or ("项目概述" if intro else "")
        duties_title = _field(p, "project_responsibilities_title", "responsibilities_title") or (
            "项目职责" if _to_bullets(duties) else ""
        )
        ach_title = _field(p, "project_achievements_title", "achievements_title") or (
            "项目成果" if _to_bullets(ach) else ""
        )

        # 回填 HTML：次级标题 + 内容一并写入编辑器描述
        html = (
            _section_html(intro_title, intro)
            + _section_html(duties_title, duties)
            + _section_html(ach_title, ach)
        )

        row = {
            "name": _field(p, "project_name", "name"),
            "role": _field(p, "role"),
            "company": _field(p, "company"),
            "start": _field(p, "start_date", "start"),
            "end": _field(p, "end_date", "end"),
            "intro": intro,
            "intro_title": intro_title,
            "responsibilities": _to_bullets(duties),
            "responsibilities_title": duties_title,
            "achievements": _to_bullets(ach),
            "achievements_title": ach_title,
            "bullets": [],
            "_html": html,
        }
        if row["name"] or row["intro"] or row["responsibilities"] or row["achievements"]:
            projects.append(row)
    structured["projects"] = projects

    education = []
    for e in data.get("education") or []:
        if not isinstance(e, dict):
            continue
        row = {
            "school": _field(e, "school"),
            "degree": _field(e, "degree"),
            "major": _field(e, "major"),
            "start": _field(e, "start_date", "start"),
            "end": _field(e, "end_date", "end"),
            "extras": [],
        }
        if row["school"] or row["degree"] or row["major"]:
            education.append(row)
    structured["education"] = education

    skills_block = data.get("skills") if isinstance(data.get("skills"), dict) else {}
    skill_list = skills_block.get("skill_list") or []
    if isinstance(skill_list, str):
        skill_list = [x.strip() for x in re.split(r"[,，、/|]", skill_list) if x.strip()]
    skill_items = [_as_str(x) for x in skill_list if _as_str(x)]
    structured["skills"] = [{"group": "专业技能", "items": skill_items}] if skill_items else []
    structured["_skillsHtml"] = (
        "<p>" + "、".join(skill_items) + "</p>" if skill_items else ""
    )

    certs = skills_block.get("certifications") or data.get("certificates") or []
    structured["certificates"] = []
    for c in certs:
        if isinstance(c, str) and c.strip():
            structured["certificates"].append(
                {"name": c.strip(), "issuer": "", "date": "", "expiry": "", "credentialId": "", "note": ""}
            )
        elif isinstance(c, dict) and _field(c, "name", "title"):
            structured["certificates"].append(
                {
                    "name": _field(c, "name", "title"),
                    "issuer": _field(c, "issuer"),
                    "date": _field(c, "date"),
                    "expiry": _field(c, "expiry"),
                    "credentialId": _field(c, "credentialId", "credential_id"),
                    "note": _field(c, "note"),
                }
            )

    languages = skills_block.get("languages") or data.get("languages") or []
    structured["languages"] = []
    for la in languages:
        if isinstance(la, str) and la.strip():
            structured["languages"].append({"name": la.strip(), "level": "", "cert": "", "note": ""})
        elif isinstance(la, dict) and _field(la, "name", "language"):
            structured["languages"].append(
                {
                    "name": _field(la, "name", "language"),
                    "level": _field(la, "level", "proficiency"),
                    "cert": _field(la, "cert", "certificate"),
                    "note": _field(la, "note"),
                }
            )

    structured["honors"] = []

    unmatched = _as_str(skill_output.get("unmatched_text"))
    dedup = _as_str(skill_output.get("deduplication_log"))
    # 未归类文本多为页眉页脚/噪声，不写入「其他」，避免干扰简历内容
    structured["others"] = ""
    structured["_othersHtml"] = ""

    order = ["basics"]
    for mid, key in (
        ("skills", "skills"),
        ("experience", "experience"),
        ("projects", "projects"),
        ("education", "education"),
        ("certificates", "certificates"),
        ("languages", "languages"),
    ):
        if structured.get(key):
            order.append(mid)
    structured["module_order"] = order

    structured["extras"] = {
        "extraction": "skill_parser_v3",
        "deduplication_log": dedup,
        "skill_status": _as_str(skill_output.get("status")) or "success",
    }
    if unmatched:
        structured["extras"]["discarded_unmatched"] = True

    return structured


def parse_resume_with_skill(text: str) -> dict:
    """Skill v3 解析简历文本 → internal structured 格式。"""
    text = (text or "").strip()
    if not text:
        return normalize_structured({})

    logger.info("Skill v3: start, text=%d chars", len(text))
    skill_output = _call_skill_llm(text)
    if not isinstance(skill_output, dict):
        raise LLMServiceError("Skill 解析结果不是对象")

    structured = map_skill_to_structured(skill_output)
    normalized = normalize_structured(structured)

    preview = _as_str(skill_output.get("cleaned_raw_text")) or text[:500]
    dedup = _as_str(skill_output.get("deduplication_log"))
    extras = normalized.setdefault("extras", {})
    if isinstance(extras, dict):
        extras["extraction"] = "skill_parser_v3"
        extras["skill_cleaned_text_preview"] = preview
        if dedup:
            extras["deduplication_log"] = dedup

    logger.info(
        "Skill v3: done name=%s exp=%d proj=%d edu=%d skills=%d certs=%d",
        (normalized.get("basics") or {}).get("name"),
        len(normalized.get("experience") or []),
        len(normalized.get("projects") or []),
        len(normalized.get("education") or []),
        len(normalized.get("skills") or []),
        len(normalized.get("certificates") or []),
    )
    return normalized
