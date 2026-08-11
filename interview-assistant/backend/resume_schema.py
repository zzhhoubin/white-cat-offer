"""可扩展的简历结构化 Schema：模块注册制，抽取与模板共用同一契约。"""

from __future__ import annotations

from copy import deepcopy
from typing import Any

# 模块按默认模板渲染顺序排列；新增模块只需追加定义并在模板中挂区块
RESUME_MODULES: list[dict[str, Any]] = [
    {
        "id": "basics",
        "label": "基础信息",
        "required": True,
        "fields": {
            "name": {"type": "string", "label": "姓名"},
            "phone": {"type": "string", "label": "电话"},
            "email": {"type": "string", "label": "邮箱"},
            "city": {"type": "string", "label": "城市"},
            "target_role": {"type": "string", "label": "求职意向"},
            "links": {"type": "string_list", "label": "链接"},
        },
    },
    {
        "id": "summary",
        "label": "个人简介",
        "required": False,
        "fields": {
            "bullets": {"type": "string_list", "label": "简介要点"},
        },
    },
    {
        "id": "experience",
        "label": "工作/实习经历",
        "required": False,
        "item": {
            "company": {"type": "string", "label": "公司"},
            "title": {"type": "string", "label": "职位"},
            "start": {"type": "string", "label": "开始时间"},
            "end": {"type": "string", "label": "结束时间"},
            "location": {"type": "string", "label": "地点"},
            "bullets": {"type": "string_list", "label": "工作要点"},
        },
    },
    {
        "id": "projects",
        "label": "项目经历",
        "required": False,
        "item": {
            "name": {"type": "string", "label": "项目名称"},
            "role": {"type": "string", "label": "项目职务/角色"},
            "company": {"type": "string", "label": "所在公司"},
            "start": {"type": "string", "label": "开始时间"},
            "end": {"type": "string", "label": "结束时间"},
            "intro": {"type": "string", "label": "项目简介"},
            "responsibilities": {"type": "string_list", "label": "项目职责"},
            "achievements": {"type": "string_list", "label": "项目业绩"},
            "bullets": {"type": "string_list", "label": "无标签时的要点（兼容）"},
        },
    },
    {
        "id": "education",
        "label": "教育背景",
        "required": False,
        "item": {
            "school": {"type": "string", "label": "学校"},
            "degree": {"type": "string", "label": "学历"},
            "major": {"type": "string", "label": "专业"},
            "start": {"type": "string", "label": "开始时间"},
            "end": {"type": "string", "label": "结束时间"},
            "extras": {"type": "string_list", "label": "补充（GPA/课程等）"},
        },
    },
    {
        "id": "skills",
        "label": "技能",
        "required": False,
        "item": {
            "group": {"type": "string", "label": "分组"},
            "items": {"type": "string_list", "label": "技能项"},
        },
    },
    {
        "id": "honors",
        "label": "荣誉/证书",
        "required": False,
        "item": {
            "title": {"type": "string", "label": "名称"},
            "date": {"type": "string", "label": "时间"},
            "note": {"type": "string", "label": "说明"},
        },
    },
]

DEFAULT_TEMPLATE_ID = "system-default"
DEFAULT_MODULE_ORDER = [m["id"] for m in RESUME_MODULES]

# ---- 多维度评分定义（书写质量，满分合计 100 + 加减分 → 总分 0–110）----
SCORE_DIMENSIONS = [
    {"id": "structure", "label": "结构与格式", "max": 15, "desc": "布局、页数、章节名、ATS 兼容"},
    {"id": "completeness", "label": "信息完整度", "max": 15, "desc": "必备信息与加分项是否齐全"},
    {"id": "expression", "label": "表达质量", "max": 20, "desc": "强动词、STAR、具体性、语言质量"},
    {"id": "quantification", "label": "量化与证据", "max": 20, "desc": "数据密度、类型多样性、可验证性"},
    {"id": "credibility", "label": "专业可信度", "max": 15, "desc": "时间线、技能-经历一致、术语准确"},
    {"id": "differentiation", "label": "差异化亮点", "max": 15, "desc": "独特性、深度、影响力"},
]

# ---- 批注严重度 ----
ANNOTATION_SEVERITY = ["error", "warning", "info"]

# ---- 布局块类型 ----
LAYOUT_BLOCK_TYPES = [
    "header",       # 姓名大标题
    "contact",      # 联系方式行
    "section_title",# 章节标题（工作经历/教育背景等）
    "item_header",  # 经历/项目条目标题（公司+职位+时间）
    "field_label",  # 标签：值（项目职务：xxx）
    "bullet",       # 分点描述
    "paragraph",    # 普通段落
    "separator",    # 分割线
]


def empty_structured() -> dict[str, Any]:
    return {
        "schema_version": 1,
        "template_id": DEFAULT_TEMPLATE_ID,
        "module_order": list(DEFAULT_MODULE_ORDER),
        "basics": {
            "name": "",
            "phone": "",
            "email": "",
            "city": "",
            "target_role": "",
            "links": [],
        },
        "summary": {"bullets": []},
        "experience": [],
        "projects": [],
        "education": [],
        "skills": [],
        "honors": [],
        "certificates": [],
        "languages": [],
        "others": "",
        "_skillsHtml": "",
        "_othersHtml": "",
        "needs_confirmation": [],
        "extras": {},  # 未注册模块可放这里，保持向前兼容
        # ---- 新增字段 ----
        "score_detail": {       # 由 quality_report 派生（总分 0–110）
            "total": 0,
            "base": 0,
            "bonus": 0,
            "penalty": 0,
            "grade": "",
            "dimensions": {d["id"]: 0 for d in SCORE_DIMENSIONS},
            "summary": "",
        },
        "quality_report": {},   # 完整书写质量评分报告
        "annotations": [],      # LLM 批注列表 [{id,title,body,severity,quote,section,suggestion}]
        "layout_blocks": [],    # 原始排版块 [{type,text,style,children}]
    }


def _as_str(v: Any) -> str:
    if v is None:
        return ""
    return str(v).strip()


def _as_str_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        s = v.strip()
        return [s] if s else []
    if isinstance(v, list):
        out = []
        for x in v:
            s = _as_str(x)
            if s:
                out.append(s)
        return out
    return []


def normalize_structured(data: dict[str, Any] | None) -> dict[str, Any]:
    """把 LLM/客户端 JSON 规范为 Schema 形态，丢弃无法识别的噪声字段。"""
    base = empty_structured()
    if not isinstance(data, dict):
        return base

    src = data.get("resume") if isinstance(data.get("resume"), dict) else data

    basics_in = src.get("basics") if isinstance(src.get("basics"), dict) else {}
    base["basics"] = {
        "name": _as_str(basics_in.get("name")),
        "phone": _as_str(basics_in.get("phone")),
        "email": _as_str(basics_in.get("email")),
        "city": _as_str(basics_in.get("city")),
        "target_role": _as_str(basics_in.get("target_role") or basics_in.get("intention")),
        "links": _as_str_list(basics_in.get("links")),
        "_status": _as_str(basics_in.get("_status") or basics_in.get("status")),
        "_birthday": _as_str(basics_in.get("_birthday") or basics_in.get("birthday") or basics_in.get("birth_date")),
        "_age": _as_str(basics_in.get("_age") or basics_in.get("age")),
        "_workYears": _as_str(basics_in.get("_workYears") or basics_in.get("work_years")),
        "_educationLevel": _as_str(basics_in.get("_educationLevel") or basics_in.get("education_level")),
        "_website": _as_str(basics_in.get("_website") or basics_in.get("website")),
        "_avatarUrl": _as_str(basics_in.get("_avatarUrl") or basics_in.get("avatarUrl")),
    }

    summary_in = src.get("summary")
    if isinstance(summary_in, dict):
        base["summary"] = {"bullets": _as_str_list(summary_in.get("bullets"))}
    elif isinstance(summary_in, list):
        base["summary"] = {"bullets": _as_str_list(summary_in)}
    elif isinstance(summary_in, str) and summary_in.strip():
        base["summary"] = {"bullets": [summary_in.strip()]}

    exp_out = []
    for item in src.get("experience") or []:
        if not isinstance(item, dict):
            continue
        bullets = _as_str_list(item.get("bullets") or item.get("highlights"))
        row = {
            "company": _as_str(item.get("company")),
            "title": _as_str(item.get("title") or item.get("role")),
            "start": _as_str(item.get("start") or item.get("start_date")),
            "end": _as_str(item.get("end") or item.get("end_date")),
            "location": _as_str(item.get("location")),
            "bullets": bullets,
        }
        html = _as_str(item.get("_html"))
        if html:
            row["_html"] = html
        elif bullets:
            row["_html"] = "".join(f"<p>{b}</p>" for b in bullets)
        if row["company"] or row["title"] or row["bullets"]:
            exp_out.append(row)
    base["experience"] = exp_out

    proj_out = []
    for item in src.get("projects") or []:
        if not isinstance(item, dict):
            continue
        responsibilities = _as_str_list(
            item.get("responsibilities") or item.get("duties") or item.get("职责")
        )
        achievements = _as_str_list(
            item.get("achievements") or item.get("results") or item.get("业绩")
        )
        bullets = _as_str_list(item.get("bullets") or item.get("highlights"))
        # 兼容：只有 bullets 时视为职责要点
        if not responsibilities and bullets:
            responsibilities = list(bullets)
            bullets = []
        row = {
            "name": _as_str(item.get("name") or item.get("title") or item.get("project_name")),
            "role": _as_str(
                item.get("role") or item.get("title_role") or item.get("position") or item.get("职务")
            ),
            "company": _as_str(item.get("company") or item.get("org") or item.get("所在公司")),
            "start": _as_str(item.get("start") or item.get("start_date")),
            "end": _as_str(item.get("end") or item.get("end_date")),
            "intro": _as_str(item.get("intro") or item.get("description") or item.get("简介")),
            "intro_title": _as_str(item.get("intro_title") or item.get("project_intro_title")),
            "responsibilities": responsibilities,
            "responsibilities_title": _as_str(
                item.get("responsibilities_title") or item.get("project_responsibilities_title")
            ),
            "achievements": achievements,
            "achievements_title": _as_str(
                item.get("achievements_title") or item.get("project_achievements_title")
            ),
            "bullets": bullets,
        }
        html = _as_str(item.get("_html"))
        if html:
            row["_html"] = html
        else:
            parts = []
            if row["intro_title"] or row["intro"]:
                if row["intro_title"]:
                    parts.append(f"<p><strong>{row['intro_title']}</strong></p>")
                if row["intro"]:
                    parts.append(f"<p>{row['intro']}</p>")
            if responsibilities:
                if row["responsibilities_title"]:
                    parts.append(f"<p><strong>{row['responsibilities_title']}</strong></p>")
                parts.extend(f"<p>{x}</p>" for x in responsibilities)
            if achievements:
                if row["achievements_title"]:
                    parts.append(f"<p><strong>{row['achievements_title']}</strong></p>")
                parts.extend(f"<p>{x}</p>" for x in achievements)
            if parts:
                row["_html"] = "".join(parts)
        if (
            row["name"]
            or row["intro"]
            or row["responsibilities"]
            or row["achievements"]
            or row["bullets"]
        ):
            proj_out.append(row)
    base["projects"] = proj_out

    edu_out = []
    for item in src.get("education") or []:
        if not isinstance(item, dict):
            continue
        row = {
            "school": _as_str(item.get("school") or item.get("institution")),
            "degree": _as_str(item.get("degree")),
            "major": _as_str(item.get("major")),
            "start": _as_str(item.get("start") or item.get("start_date")),
            "end": _as_str(item.get("end") or item.get("end_date")),
            "extras": _as_str_list(item.get("extras") or item.get("details")),
        }
        if row["school"] or row["degree"] or row["major"]:
            edu_out.append(row)
    base["education"] = edu_out

    skills_out = []
    skills_in = src.get("skills")
    if isinstance(skills_in, dict):
        # {"语言": ["Python"], ...}
        for group, items in skills_in.items():
            row = {"group": _as_str(group), "items": _as_str_list(items)}
            if row["items"]:
                skills_out.append(row)
    elif isinstance(skills_in, list):
        for item in skills_in:
            if isinstance(item, str) and item.strip():
                skills_out.append({"group": "技能", "items": [item.strip()]})
            elif isinstance(item, dict):
                row = {
                    "group": _as_str(item.get("group") or item.get("category") or "技能"),
                    "items": _as_str_list(item.get("items") or item.get("skills")),
                }
                if row["items"]:
                    skills_out.append(row)
    base["skills"] = skills_out

    honors_out = []
    for item in src.get("honors") or src.get("awards") or []:
        if isinstance(item, str) and item.strip():
            honors_out.append({"title": item.strip(), "date": "", "note": ""})
            continue
        if not isinstance(item, dict):
            continue
        row = {
            "title": _as_str(item.get("title") or item.get("name")),
            "date": _as_str(item.get("date")),
            "note": _as_str(item.get("note") or item.get("description")),
        }
        if row["title"]:
            honors_out.append(row)
    base["honors"] = honors_out

    certificates_out = []
    for item in src.get("certificates") or src.get("certs") or []:
        if isinstance(item, str) and item.strip():
            certificates_out.append(
                {"name": item.strip(), "issuer": "", "date": "", "expiry": "", "credentialId": "", "note": ""}
            )
            continue
        if not isinstance(item, dict):
            continue
        row = {
            "name": _as_str(item.get("name") or item.get("title")),
            "issuer": _as_str(item.get("issuer")),
            "date": _as_str(item.get("date")),
            "expiry": _as_str(item.get("expiry")),
            "credentialId": _as_str(item.get("credentialId") or item.get("credential_id")),
            "note": _as_str(item.get("note")),
        }
        if row["name"]:
            certificates_out.append(row)
    base["certificates"] = certificates_out

    languages_out = []
    for item in src.get("languages") or []:
        if isinstance(item, str) and item.strip():
            languages_out.append({"name": item.strip(), "level": "", "cert": "", "note": ""})
            continue
        if not isinstance(item, dict):
            continue
        row = {
            "name": _as_str(item.get("name") or item.get("language")),
            "level": _as_str(item.get("level") or item.get("proficiency")),
            "cert": _as_str(item.get("cert") or item.get("certificate")),
            "note": _as_str(item.get("note")),
        }
        if row["name"]:
            languages_out.append(row)
    base["languages"] = languages_out

    if isinstance(src.get("others"), str):
        base["others"] = _as_str(src.get("others"))
    elif isinstance(src.get("others"), dict):
        base["others"] = _as_str(src["others"].get("content") or src["others"].get("text"))
    base["_skillsHtml"] = _as_str(src.get("_skillsHtml"))
    base["_othersHtml"] = _as_str(src.get("_othersHtml"))

    base["needs_confirmation"] = _as_str_list(src.get("needs_confirmation"))
    if isinstance(src.get("extras"), dict):
        base["extras"] = deepcopy(src["extras"])

    # 完整书写质量报告
    qr = src.get("quality_report")
    if isinstance(qr, dict) and (qr.get("total") or qr.get("dimensions")):
        base["quality_report"] = qr

    # 多维度评分（兼容旧五维 key：仅保留仍在 SCORE_DIMENSIONS 中的）
    sd = src.get("score_detail")
    if isinstance(sd, dict) and (sd.get("total") or sd.get("dimensions")):
        dims = sd.get("dimensions") if isinstance(sd.get("dimensions"), dict) else {}
        flat = {}
        for d in SCORE_DIMENSIONS:
            v = dims.get(d["id"])
            if isinstance(v, dict):
                try:
                    flat[d["id"]] = int(v.get("score") or 0)
                except (TypeError, ValueError):
                    flat[d["id"]] = 0
            else:
                try:
                    flat[d["id"]] = int(v or 0)
                except (TypeError, ValueError):
                    flat[d["id"]] = 0
        try:
            total = int(sd.get("total") or 0)
        except (TypeError, ValueError):
            total = 0

        def _as_int(v: Any) -> int:
            try:
                return int(v or 0)
            except (TypeError, ValueError):
                return 0

        base["score_detail"] = {
            "total": max(0, min(110, total)),
            "base": _as_int(sd.get("base")),
            "bonus": _as_int(sd.get("bonus")),
            "penalty": _as_int(sd.get("penalty")),
            "grade": _as_str(sd.get("grade")),
            "dimensions": flat,
            "summary": _as_str(sd.get("summary") or sd.get("brief")),
        }

    # LLM 批注
    ann_src = src.get("annotations")
    if isinstance(ann_src, list):
        ann_out = []
        for a in ann_src:
            if not isinstance(a, dict):
                continue
            severity = _as_str(a.get("severity") or "info")
            if severity not in ANNOTATION_SEVERITY:
                severity = "info"
            ann_out.append({
                "id": _as_str(a.get("id") or f"a-{len(ann_out)}"),
                "title": _as_str(a.get("title")),
                "body": _as_str(a.get("body")),
                "severity": severity,
                "quote": _as_str(a.get("quote")),
                "section": _as_str(a.get("section")),
                "suggestion": _as_str(a.get("suggestion") or a.get("fix")),
            })
        base["annotations"] = ann_out

    # 布局块
    lb = src.get("layout_blocks")
    if isinstance(lb, list) and lb:
        base["layout_blocks"] = _normalize_layout_blocks(lb)

    order = src.get("module_order")
    if isinstance(order, list) and order:
        known = set(DEFAULT_MODULE_ORDER)
        # 尊重原简历章节顺序：只保留已识别模块，不把空模块强行插回默认顺序
        seen = []
        for x in order:
            if x in known and x not in seen:
                seen.append(x)
        # 原文未声明顺序时，把已有内容的模块按默认序补在末尾（仅补「有内容」的）
        for x in DEFAULT_MODULE_ORDER:
            if x in seen:
                continue
            if x == "basics" and any(base["basics"].values()):
                seen.append(x)
            elif x == "summary" and base["summary"]["bullets"]:
                seen.append(x)
            elif x in ("experience", "projects", "education", "skills", "honors", "certificates", "languages") and base.get(x):
                seen.append(x)
            elif x == "others" and (base.get("others") or base.get("_othersHtml")):
                seen.append(x)
        # 把 skill 产出但未在 DEFAULT_MODULE_ORDER 的模块补上
        for x in ("certificates", "languages", "others"):
            if x in seen:
                continue
            if x == "others" and (base.get("others") or base.get("_othersHtml")):
                seen.append(x)
            elif x != "others" and base.get(x):
                seen.append(x)
        base["module_order"] = seen or list(DEFAULT_MODULE_ORDER)

    return base


def _normalize_layout_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """规范化布局块列表。"""
    out: list[dict[str, Any]] = []
    for b in blocks:
        if not isinstance(b, dict):
            continue
        btype = _as_str(b.get("type") or "paragraph")
        if btype not in LAYOUT_BLOCK_TYPES:
            btype = "paragraph"
        text = _as_str(b.get("text"))
        style = b.get("style") if isinstance(b.get("style"), dict) else {}
        children = (
            _normalize_layout_blocks(b["children"])
            if isinstance(b.get("children"), list)
            else []
        )
        if text or children:
            out.append({
                "type": btype,
                "text": text,
                "style": style,
                "children": children,
            })
    return out


def structured_to_plain_text(structured: dict[str, Any]) -> str:
    """将结构化简历压成纯文本，供素材库/下游检索复用。"""
    s = normalize_structured(structured)
    lines: list[str] = []
    b = s["basics"]
    head = " · ".join(x for x in [b.get("name"), b.get("phone"), b.get("email"), b.get("city"), b.get("target_role")] if x)
    if head:
        lines.append(head)
    if b.get("links"):
        lines.append("链接：" + " · ".join(b["links"]))

    if s["summary"]["bullets"]:
        lines.append("个人简介")
        lines.extend(f"- {x}" for x in s["summary"]["bullets"])

    if s["experience"]:
        lines.append("工作经历")
        for e in s["experience"]:
            lines.append(
                " · ".join(
                    x
                    for x in [
                        e.get("company"),
                        e.get("title"),
                        f"{e.get('start', '')}-{e.get('end', '')}".strip("-"),
                        e.get("location"),
                    ]
                    if x
                )
            )
            lines.extend(f"- {x}" for x in e.get("bullets") or [])

    if s["projects"]:
        lines.append("项目经历")
        for p in s["projects"]:
            lines.append(
                " · ".join(
                    x
                    for x in [
                        p.get("name"),
                        p.get("role"),
                        p.get("company"),
                        f"{p.get('start', '')}-{p.get('end', '')}".strip("-"),
                    ]
                    if x
                )
            )
            if p.get("intro"):
                lines.append(f"项目简介：{p['intro']}")
            if p.get("responsibilities"):
                lines.append("项目职责：")
                lines.extend(f"- {x}" for x in p["responsibilities"])
            if p.get("achievements"):
                lines.append("项目业绩：")
                lines.extend(f"- {x}" for x in p["achievements"])
            lines.extend(f"- {x}" for x in p.get("bullets") or [])

    if s["education"]:
        lines.append("教育背景")
        for e in s["education"]:
            lines.append(
                " · ".join(
                    x
                    for x in [
                        e.get("school"),
                        e.get("degree"),
                        e.get("major"),
                        f"{e.get('start', '')}-{e.get('end', '')}".strip("-"),
                    ]
                    if x
                )
            )
            lines.extend(f"- {x}" for x in e.get("extras") or [])

    if s["skills"]:
        lines.append("技能")
        for g in s["skills"]:
            lines.append(f"{g.get('group') or '技能'}：{' / '.join(g.get('items') or [])}")

    if s["honors"]:
        lines.append("荣誉证书")
        for h in s["honors"]:
            lines.append(
                " · ".join(x for x in [h.get("title"), h.get("date"), h.get("note")] if x)
            )

    return "\n".join(lines).strip()


def schema_prompt_block() -> str:
    """生成给 LLM 的 Schema 说明（随 RESUME_MODULES 自动扩展）。"""
    parts = [
        "任务是「原样归档」而不是「改写优化」：内容、措辞、条目划分必须与上传简历一致。",
        "只抽取简历中真实存在的模块字段；忽略水印、页眉页脚、广告、模板网站声明、页码等非简历内容。",
        "禁止编造、润色、扩写、缩写、合并多条、拆分一条、翻译、改数字或改公司/学校名。",
        "缺失字段用空字符串或空数组；吃不准是否原文所有时放入 needs_confirmation，仍不要改写正文。",
        "返回 JSON 对象，顶层字段如下：",
        '{',
        '  "module_order": ["按原简历出现顺序排列的模块 id"],',
        '  "basics": {"name","phone","email","city","target_role","links":[]},',
        '  "summary": {"bullets":[]},',
        '  "experience": [{"company","title","start","end","location","bullets":[]}],',
        '  "projects": [{',
        '    "name","role","company","start","end",',
        '    "intro","responsibilities":[],"achievements":[],"bullets":[]',
        "  }],",
        '  "education": [{"school","degree","major","start","end","extras":[]}],',
        '  "skills": [{"group","items":[]}],',
        '  "honors": [{"title","date","note"}],',
        '  "needs_confirmation": [],',
        '  "layout_blocks": [',
        '    {"type":"header|contact|section_title|item_header|field_label|bullet|paragraph|separator",',
        '     "text":"原文逐字摘录","style":{},"children":[]}',
        "  ]",
        "}",
        "模块 id 说明：",
    ]
    for m in RESUME_MODULES:
        parts.append(f"- {m['id']}（{m['label']}）")
    parts.extend([
        "",
        "layout_blocks 要求（重要，用于纸面还原视图）：",
        "- 按原文行序逐块归档，保留原文的视觉层次",
        "- type 取值：header(姓名大字)/contact(联系方式行)/section_title(章节标题加粗)/item_header(经历/项目条目标题-公司职位时间)/field_label(标签:值)/bullet(分点描述)/paragraph(普通段落)/separator(分割线)",
        "- text 必须原文逐字摘录，禁止改写或合并",
        "- style 可包含 bold/italic/size 等排版提示，无特别格式时用 {}",
        "- 每条 bullet 单独成块，保留编号格式",
        "- module_order 必须反映原简历章节顺序；原简历没有的模块不要硬造进顺序（可省略）。",
        "项目经历特别规则（非常重要）：",
        "- 中文简历常见标签：项目职务/角色、所在公司、项目简介、项目职责、项目业绩；按标签填入对应字段。",
        "- responsibilities 只放「本项目」职责条文；achievements 只放明确的业绩条；intro 放简介原文。",
        "- 若原文没有独立「项目业绩」标题，但业绩写在职责句中，则整句留在 responsibilities，achievements 置空，禁止臆造拆分。",
        "- 严禁把其它项目或「工作经历」里的句子填进当前项目。多项目时逐项对齐名称后再摘录下属段落。",
        "- 无标签的纯 bullet 项目，才使用 bullets 字段。",
    ])
    return "\n".join(parts)


# ---- 评分 Prompt（完整量规在 resume_quality/；此处仅作兼容占位）----
SCORE_SYSTEM_PROMPT = (
    "书写质量评分请使用 resume_quality 包内 SKILL_PROMPT + scoring-rubric，"
    "由 resume_quality.score_resume_content 调用。"
)


# ---- 批注 Prompt ----
ANNOTATION_SYSTEM_PROMPT = """你是资深简历优化顾问。请逐段审阅简历，找出写得不好的地方并给出具体批注。

要求：
1. 每条批注必须包含：被批注的原文引用(quote)、所属模块(section)、严重程度(severity)、问题标题(title)、问题详述(body)、修改建议(suggestion)
2. severity 取值：error(硬伤-错别字/时间矛盾/信息缺失)、warning(可优化-弱表述/缺量化/空泛/冗余)、info(建议-可锦上添花的改进)
3. quote 从原文逐字摘录，不超过60字
4. section 取值：basics/summary/experience/projects/education/skills/honors
5. 每条批注独立，id 用 a-序号
6. 优先找真实存在的硬性问题，不要泛泛而谈

重点检查（对齐书写质量量规）：
- 结构/ATS：非标准章节名、特殊符号、疑似多栏/表格导致的信息碎片
- 完整度：缺联系方式、意向岗位、教育或经历模块
- 弱动词：负责、参与、协助、做一些；Responsible for / Involved in
- AI 套话：赋能、抓手、闭环、底层逻辑、颗粒度、对齐、护城河 等无具体上下文堆砌
- 量化缺失：无数字的「大幅提升/显著优化」；经历 bullet 缺少可验证指标
- 可信度：时间线重叠/空白未说明；技能列表无经历证据；「精通」缺乏支撑
- 亮点：同质化模板表述、深度/影响力未展开
- 语言：错别字、语法错误、术语不当
- 冗余：技能列 Office/Excel 等基础项

返回纯 JSON：
{
  "annotations": [
    {"id":"a-1","title":"...","body":"...","severity":"warning","quote":"原文","section":"experience","suggestion":"改写建议"}
  ]
}"""
