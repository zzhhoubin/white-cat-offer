"""简历解析（PRD 8.2）：从简历文本/文件中抽取结构化个人素材（LLM only）。"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from config import settings
from llm_utils import get_llm_model, LLMServiceError, openai_client, require_llm_config
from resume_schema import (
    ANNOTATION_SYSTEM_PROMPT,
    DEFAULT_MODULE_ORDER,
    normalize_structured,
    schema_prompt_block,
    structured_to_plain_text,
)

# 整行命中即视为无效（水印/声明/模板站点等）
_INVALID_LINE_RE = re.compile(
    r"(水印|仅供.?预览|仅供.?参考|内部资料|机密文件|confidential|watermark|"
    r"简历模板|超级简历|五百丁|乔布简历|简历本|稀饭简历|应届生求职网|"
    r"扫码下载|点击下载完整|广告|禁止商用|文档来自)",
    re.I,
)
_PAGE_NOISE_RE = re.compile(
    r"^(第?\s*\d+\s*[页頁]|page\s*\d+(\s*/\s*\d+)?|\d+\s*/\s*\d+|[-–—]\s*\d+\s*[-–—])$",
    re.I,
)
_SYMBOL_ONLY_RE = re.compile(r"^[\s\-_=*·•|｜/\\~〜]+$")
_WATERMARK_FRAG_RE = re.compile(
    r"^(专用|招聘专用|城\s*招聘专用|东商城\s*招聘专用|京东商城|京东商|东商城|电专用|京)$"
)

# 猎聘等「值在前 / 标签在后」常见字段
_LAYOUT_LABELS = (
    "所在公司",
    "项目职务",
    "项目简介",
    "项目职责",
    "项目业绩",
    "公司行业",
    "所在地区",
    "下属人数",
    "职责业绩",
    "工作描述",
    "学历",
    "专业",
)
_LAYOUT_LABEL_ALT = "|".join(_LAYOUT_LABELS)
_PIPE_LABEL_RE = re.compile(
    rf"^\s*(?P<val>[^|｜\n]+?)\s*[|｜]\s*(?P<label>{_LAYOUT_LABEL_ALT})：\s*$"
)
_GLUED_LABEL_RE = re.compile(
    rf"(?P<val>[^\n：:]{{1,80}}?)(?P<label>{_LAYOUT_LABEL_ALT})：\s*$"
)
_INLINE_PIPE_LABEL_RE = re.compile(
    rf"^\s*(?P<val>.+?)\s*[|｜]\s*(?P<label>{_LAYOUT_LABEL_ALT})：\s*$"
)
_ORPHAN_LABEL_RE = re.compile(rf"^({_LAYOUT_LABEL_ALT})：\s*$")
# 仅短字段允许「上一行是值、本行是空标签」
_PRE_VALUE_LABELS = frozenset(
    {"所在公司", "项目职务", "公司行业", "所在地区", "下属人数", "学历", "专业", "项目简介"}
)
# 业绩偶尔值在标签前（一行短结果），简介/职责禁止吞上一行
_PRE_VALUE_SHORT_LABELS = frozenset({"项目业绩"})
_DATE_LINE_RE = re.compile(
    r"^(?P<period>\d{4}\s*[./年]\s*\d{1,2}\s*[-–—~～至到]+\s*"
    r"(?:\d{4}\s*[./年]\s*\d{1,2}|至今))\s*$"
)
_PROJECT_HEADER_RE = re.compile(
    r"^(?P<start>\d{4}\s*[./年]\s*\d{1,2})\s*[-–—~～至到]+\s*"
    r"(?P<end>\d{4}\s*[./年]\s*\d{1,2}|至今)\s+"
    r"(?P<name>\S.+)$"
)
_JD_WATERMARK_RE = re.compile(r"京东商城|招聘专用")
# 强水印：可整块丢弃（短声明/页眉碎片）
_WM_STRONG_RE = re.compile(
    r"招聘专用|仅供.?预览|仅供.?参考|仅供公司招聘|严禁以招聘|"
    r"下载完整|文档来自|内部资料|机密文件|confidential|watermark|城\s*招聘",
    re.I,
)
_WM_SCAN_PROMO_RE = re.compile(r"扫码(?:下载|查看|获取|关注)|请扫码")
_MARKDOWN_ENGINES = frozenset(
    {"mineru", "pdfmux", "edgeparse", "opendataloader", "pymupdf4llm"}
)
_PAGE_HEADER_Y_MAX = 55


def _is_resume_watermark_block(text: str, *, y0: float = 999.0) -> bool:
    """判断 PDF block 是否为水印/页眉碎片。禁止用「京东」「扫码」裸匹配误杀正文。"""
    t = (text or "").strip()
    if not t:
        return False
    compact = re.sub(r"\s+", "", t)

    if _WM_STRONG_RE.search(t):
        return True

    # 京东：仅短水印行 / 页眉短碎片 / 「京东商城招聘专用」类，正文含公司名一律保留
    if "京东" in t or "东商城" in t:
        if re.fullmatch(r"京东(?:商城)?|东商城|京东商", compact):
            return True
        if y0 <= _PAGE_HEADER_Y_MAX and len(compact) <= 20:
            return True
        if len(compact) <= 30 and re.search(r"京东(?:商城)?\s*(?:招聘专用|专用)", t):
            return True
        return False

    # 扫码：仅宣传短句，保留「扫码转化」等业务描述
    if "扫码" in t:
        if _WM_SCAN_PROMO_RE.search(t) and len(compact) <= 24:
            return True
        if len(compact) <= 8 and compact in ("扫码", "请扫码"):
            return True
        return False

    # 孤立广告词短行
    if len(compact) <= 16 and re.fullmatch(r"广告|禁止|商用|预览|预览版|禁止商用", compact):
        return True
    return False


def _light_normalize_extracted_text(text: str) -> str:
    """行式引擎轻量归一：只修邮箱断行与空白，避免激进规则拆坏日期（如 2023.04）。"""
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"@\s*\n\s*", "@", t)
    t = re.sub(r"(?<=@)([^\s\n]+)\n\s*(\.[A-Za-z]{2,})", r"\1\2", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


_SECTION_HEADERS = (
    "个人信息",
    "目前职业概况",
    "职业发展意向",
    "工作经历",
    "项目经历",
    "教育经历",
    "教育背景",
    "语言能力",
    "自我评价",
    "附加信息",
    "技能",
    "荣誉",
)


def _extract_pdf_pymupdf(file_path: str) -> str:
    """pymupdf block 提取：过滤水印 + 坐标排序 + 智能断行重连。猎聘等中文简历首选。"""
    import fitz

    doc = fitz.open(file_path)
    part_texts: list[str] = []
    for pi, page in enumerate(doc, start=1):
        blocks = page.get_text("blocks")
        content: list[tuple[float, float, str]] = []  # (y, x, text)
        for b in blocks:
            x0, y0 = b[0], b[1]
            t = (b[4] or "").strip()
            if not t:
                continue
            if x0 <= 5 or x0 >= 480:
                continue
            if y0 <= _PAGE_HEADER_Y_MAX and any(kw in t for kw in ("简历编号", "更新")):
                continue
            if _is_resume_watermark_block(t, y0=y0):
                continue
            # 处理段落内的换行（block内\n通常分割日期/标题等，用空格替换）
            t = t.replace("\n", " ").replace("  ", " ")
            if t:
                content.append((round(y0 / 3), round(x0 / 3), t))

        if not content:
            continue
        content.sort(key=lambda c: (c[0], c[1]))

        # 智能重连：同列（X接近）且同Y → 接续段落；不同列 → 换行
        # 特殊：上一行是日期段（如 2017/05-2019/03），当前行是公司名 → 加空格合并
        _DATE_ONLY_RE = re.compile(r"^\d{4}\s*[./年]\s*\d{1,2}\s*[-–—~～至到]+\s*(?:\d{4}\s*[./年]\s*\d{1,2}|至今)$")
        lines: list[str] = []
        prev_y = -99
        prev_x = -99
        for y, x, t in content:
            same_row = (y - prev_y <= 1)
            same_col = abs(x - prev_x) <= 6
            if lines and same_row:
                prev = lines[-1]
                if _DATE_ONLY_RE.match(prev) and not _DATE_ONLY_RE.match(t):
                    # 日期行 + 公司/项目名 → 用空格合并
                    lines[-1] = prev + " " + t
                    prev_y = y
                    prev_x = x
                    continue
                if same_col:
                    if prev and not re.search(r"[。！？）》\d，、；：]$", prev):
                        lines[-1] = prev + t
                        prev_y = y
                        prev_x = x
                        continue
            lines.append(t)
            prev_y = y
            prev_x = x

        if lines:
            part_texts.append(f"--- 第{pi}页 ---\n" + "\n".join(lines))
    return "\n\n".join(part_texts)


def _extract_styled_layout_blocks(file_path: str) -> list[dict]:
    """从 pymupdf span 提取带字体/坐标样式的布局块，用于前端纸面还原。"""
    import fitz

    doc = fitz.open(file_path)
    all_blocks: list[dict] = []
    for pi, page in enumerate(doc, start=1):
        d = page.get_text("dict")
        page_items: list[dict] = []  # {x, y, text, size, color, font}

        for b in d.get("blocks") or []:
            if b.get("type") != 0:
                continue
            for line in b.get("lines") or []:
                spans = line.get("spans") or []
                if not spans:
                    continue

                # 取第一个 span 的样式作为整行样式
                first = spans[0]
                text = "".join(s.get("text", "") for s in spans).strip()
                if not text:
                    continue

                x0 = first.get("bbox", [0])[0]
                y0 = first.get("bbox", [0])[1]

                # 过滤水印
                if x0 <= 5 or x0 >= 480:
                    continue
                if y0 <= _PAGE_HEADER_Y_MAX and any(kw in text for kw in ("简历编号", "更新")):
                    continue
                if _is_resume_watermark_block(text, y0=y0):
                    continue
                if first.get("font", "").startswith("SimHei"):
                    continue

                font_size = first.get("size", 10.5)
                color_int = first.get("color", 0)
                color_hex = f"#{color_int:06x}" if color_int else "#000000"
                flags = first.get("flags", 0)
                is_bold = bool(flags & 16)

                # 推断块类型
                if font_size >= 13 and ("经历" in text or "概况" in text or "意向" in text or "信息" in text or "背景" in text or "能力" in text or "评价" in text or "技能" in text or "信息" in text):
                    btype = "section_title"
                elif font_size >= 13:
                    btype = "header"
                elif x0 <= 80:
                    btype = "field_label"
                elif re.match(r"^\d{4}\s*[./–—]", text):
                    btype = "item_header"
                elif re.match(r"^\d+\s*[)）、.．]", text) or text.startswith("、") or re.match(r"^[·•●-]", text):
                    btype = "bullet"
                else:
                    btype = "paragraph"

                page_items.append({
                    "x": round(x0, 1),
                    "y": round(y0, 1),
                    "text": text,
                    "size": round(font_size, 1),
                    "color": color_hex,
                    "bold": is_bold,
                    "type": btype,
                })

        if not page_items:
            continue
        # 按 Y, X 排序
        page_items.sort(key=lambda it: (round(it["y"] / 2), round(it["x"] / 2)))

        # 同列断行重连
        merged: list[dict] = []
        for it in page_items:
            if (
                merged
                and abs(it["y"] - merged[-1]["y"]) < 16  # close Y
                and abs(it["x"] - merged[-1]["x"]) < 10  # same X column
                and it["size"] == merged[-1]["size"]
                and not re.search(r"[。！？）》\d，、；：]$", merged[-1]["text"])
            ):
                merged[-1]["text"] += it["text"]
                merged[-1]["y"] = it["y"]  # update to latest Y
            else:
                merged.append(dict(it))

        # 去重相邻完全相同的行
        filtered: list[dict] = []
        for it in merged:
            if filtered and it["text"] == filtered[-1]["text"]:
                continue
            filtered.append(it)

        all_blocks.extend(filtered)

    return all_blocks


def _extract_pdf_pymupdf_dict(file_path: str) -> str:
    """span 级排序：部分简洁 PDF 更优，复杂分栏可能打乱。"""
    import fitz

    doc = fitz.open(file_path)
    parts: list[str] = []
    for i, page in enumerate(doc, start=1):
        d = page.get_text("dict")
        rows: list[tuple[float, float, str]] = []
        for b in d.get("blocks") or []:
            if b.get("type") != 0:
                continue
            for line in b.get("lines") or []:
                spans = line.get("spans") or []
                text = "".join(s.get("text") or "" for s in spans).strip()
                if not text:
                    continue
                x0 = min((s.get("bbox") or [0, 0, 0, 0])[0] for s in spans) if spans else 0
                y0 = min((s.get("bbox") or [0, 0, 0, 0])[1] for s in spans) if spans else 0
                rows.append((round(y0 / 2), round(x0 / 2), text))
        rows.sort()
        lines = [t for _, _, t in rows]
        if lines:
            parts.append(f"--- 第{i}页 ---\n" + "\n".join(lines))
    return "\n\n".join(parts)


def _extract_pdf_pymupdf4llm(file_path: str) -> str:
    try:
        import pymupdf4llm
    except ImportError:
        return ""
    md = (pymupdf4llm.to_markdown(file_path) or "").strip()
    if not md:
        return ""
    # 去掉部分 markdown 噪声，保留正文
    md = re.sub(r"^#{1,6}\s*", "", md, flags=re.M)
    md = re.sub(r"\*+", "", md)
    return md


def _extract_pdf_pdfplumber(file_path: str) -> str:
    try:
        import pdfplumber
    except ImportError:
        return ""
    parts: list[str] = []
    with pdfplumber.open(file_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            # x_tolerance/y_tolerance 改善阅读顺序
            t = (page.extract_text(x_tolerance=2, y_tolerance=3) or "").strip()
            if t:
                parts.append(f"--- 第{i}页 ---\n{t}")
    return "\n\n".join(parts)


def _extract_pdf_pypdf(file_path: str) -> str:
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    parts: list[str] = []
    for i, page in enumerate(reader.pages, start=1):
        t = (page.extract_text() or "").strip()
        if t:
            parts.append(f"--- 第{i}页 ---\n{t}")
    return "\n\n".join(parts)


def _extract_pdf_pdfminer(file_path: str) -> str:
    try:
        from pdfminer.high_level import extract_text as pdfminer_extract
    except ImportError:
        return ""
    t = (pdfminer_extract(file_path) or "").strip()
    return t


def _light_clean_for_score(text: str) -> str:
    """评分前轻量去水印，避免「全文含水印」与「标题被碎片污染」误导择优。"""
    out: list[str] = []
    for line in (text or "").split("\n"):
        s = line.strip()
        if not s:
            continue
        if "京东商城" in s or s in ("招聘专用", "专用") or _WATERMARK_FRAG_RE.match(s):
            continue
        if len(s) <= 16 and ("招聘" in s or "专用" in s):
            continue
        # 去掉行尾碎片水印：…项目 京 城 专
        s = re.sub(r"(?:\s+[\u4e00-\u9fff]){2,}\s*$", "", s).strip()
        if s:
            out.append(s)
    return "\n".join(out)


def _score_extraction(text: str) -> float:
    """越高越好：偏可读中文量、章节顺序、标签正序；惩罚粘连倒置与水印污染。"""
    raw = (text or "").strip()
    if len(raw) < 40:
        return -1e9
    t = _light_clean_for_score(raw)
    if len(t) < 40:
        t = raw
    cn = len(re.findall(r"[\u4e00-\u9fff]", t))
    glued = len(
        re.findall(
            rf"(?<![：:\n])([^\s：:\n]{{2,40}})({_LAYOUT_LABEL_ALT})：",
            t,
        )
    )
    score = float(cn) * 0.5 - glued * 120.0
    pw, pp = t.find("工作经历"), t.find("项目经历")
    pe = max(t.find("教育经历"), t.find("教育背景"))
    if pw != -1 and pp != -1 and pw < pp:
        score += 120.0
    if pp != -1 and pe != -1 and pp < pe:
        score += 80.0
    if re.search(r"\d{4}\s*/\s*\d{1,2}.+\n(?:.*\n){0,4}项目职务", t):
        score += 100.0
    if re.search(r"^项目职务：", t, re.M) or re.search(r"\n项目职务：", t):
        score += 60.0
    # 原始文本中的完整水印行密度（清洗后会丢，这里只作弱惩罚）
    wm = len(re.findall(r"京东商城|招聘专用", raw))
    score -= min(wm, 40) * 3.0
    # 标题仍含碎片水印 → 重罚
    frag = 0
    for line in raw.split("\n"):
        if re.search(r"\d{4}\s*[./]\s*\d{1,2}", line) and re.search(
            r"\s[\u4e00-\u9fff]\s[\u4e00-\u9fff]", line
        ):
            frag += 1
    score -= frag * 250.0
    try:
        cleaned = normalize_resume_layout(t)
        headers = 0
        for line in cleaned.split("\n"):
            m = _PROJECT_HEADER_RE.match(line.strip())
            if m and "京" not in m.group("name") and len(m.group("name")) >= 2:
                headers += 1
        score += min(headers, 6) * 90.0
        try:
            nproj = len(split_project_windows(cleaned))
        except Exception:
            nproj = headers
        score += min(nproj, 6) * 120.0
        exp_hits = len(re.findall(r"\d{4}\s*[./]\s*\d{1,2}.+(?:同城|点评|公司|科技)", cleaned))
        score += min(exp_hits, 4) * 40.0
        if nproj == 0 and ("项目经历" in cleaned or "项目经验" in cleaned):
            score -= 200.0
    except Exception:
        pass
    return score


def _normalize_engine_markdown(text: str) -> str:
    """把 EdgeParse/pdfmux/OpenDataLoader/MinerU 的 Markdown 压成规则切窗可用的行式文本。"""
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    t = re.sub(r"<!--.*?-->", "", t, flags=re.S)
    t = re.sub(r"!\[.*?\]\([^)]+\)", "\n", t)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</?[^>]+>", "", t)
    t = re.sub(r"^#{1,6}\s*", "", t, flags=re.M)
    t = t.replace("**", "").replace("__", "").replace("*", "")

    # ---- 修复1：被换行拆散的邮箱 ----
    t = re.sub(r"@\s*\n\s*(\d)", r"@\1", t)
    t = re.sub(r"(?<=\d)\s*\n\s*(\d+\.com)", r"\1", t)

    # ---- 修复2：中文断句重连（核心修复） ----
    # 中文行末无标点 → 大概率被 PDF 换行截断，合并到下行
    _CJK_PUNC_END = re.compile(r"[。！？，、；：""』》）…——]$")
    _CJK_CHAR = re.compile(r"[一-鿿㐀-䶿]$")
    lines = t.split("\n")
    joined: list[str] = []
    for line in lines:
        s = line.strip()
        if not s:
            joined.append("")
            continue
        if (
            joined
            and joined[-1]
            and joined[-1] != ""
            and _CJK_CHAR.search(joined[-1])
            and not _CJK_PUNC_END.search(joined[-1])
            and _CJK_CHAR.match(s)
            and not re.match(r"^(?:个人信息|目前职业|职业发展|工作经历|项目经历|项目经验|教育经历|教育背景|语言能力|自我评价|附加信息|技能|荣誉|证书)", s)
            and not re.match(r"^(?:" + "|".join(re.escape(x) for x in _LAYOUT_LABELS) + r")：", s)
        ):
            # 下行以中文字开头且非章节标题/标签 → 接续
            joined[-1] = joined[-1] + s
        else:
            joined.append(s)
    t = "\n".join(joined)

    # ---- 修复3：去除嵌入中文词中间的标签碎片（MinerU 换行 artifact） ----
    # 例如：打车刚项目简介：需族 → 打车刚需族；场景项目职责：、区域 → 场景、区域
    extra_labels = [
        "姓名", "性别", "年龄", "教育程度", "工作年限", "所在地",
        "公司名称", "所任职位", "期望职位", "期望地点", "期望行业",
        "期望年薪", "所在行业",
    ]
    for lab in list(_LAYOUT_LABELS) + extra_labels:
        t = re.sub(
            rf"([一-鿿a-zA-Z0-9])({re.escape(lab)}：)([一-鿿，、。！？""''；：）》)…——a-zA-Z0-9])",
            r"\1\3",
            t,
        )
    # 半角冒号 → 全角（标签）
    for lab in list(_LAYOUT_LABELS) + [
        "姓名", "性别", "年龄", "教育程度", "工作年限", "所在地",
        "公司名称", "所任职位", "期望职位", "期望地点", "期望行业",
        "期望年薪", "所在行业",
    ]:
        t = re.sub(rf"{re.escape(lab)}\s*[:：]\s*", f"{lab}：", t)
    # 日期紧贴标题：2018/01-2019/07精选项目 → 拆空格
    t = re.sub(
        r"(\d{4}\s*[./]\s*\d{1,2}\s*[-–—~～至到]+\s*(?:\d{4}\s*[./]\s*\d{1,2}|至今))(\S)",
        r"\1 \2",
        t,
    )
    # OCR 断月：2016/1 1 → 2016/11 ；2019/0 7 → 2019/07
    t = re.sub(
        r"(\d{4}\s*[./]\s*\d{1,2}\s*[-–—~～至到]+\s*\d{4}\s*[./]\s*)(\d)\s+(\d)(?=\s)",
        r"\1\2\3",
        t,
    )
    # 日期段前拆行
    t = re.sub(
        r"(?<!\n)(\d{4}\s*[./]\s*\d{1,2}\s*[-–—~～至到]+\s*(?:\d{4}\s*[./]\s*\d{1,2}|至今))",
        r"\n\1",
        t,
    )
    # 标签前拆行（但只有标签前非CJK字符时才拆——防止"刚\\n需族"被"项目简介："误拆）
    label_alt = "|".join(re.escape(x) for x in _LAYOUT_LABELS)
    t = re.sub(
        rf"(?<![一-鿿a-zA-Z0-9])((?:{label_alt})：)",
        r"\n\1",
        t,
    )
    # 章节标题前拆行
    for h in _SECTION_HEADERS:
        t = re.sub(rf"(?<!\n)(?<![一-鿿a-zA-Z0-9])({re.escape(h)})(?=\s|$)", r"\n\1\n", t)
    # 编号条目前拆行（禁止拆开年份中的数字，如 2023.04）
    t = re.sub(r"(?<!\n)(?<!\d)(\d{1,2}\s*[)）、.．])", r"\n\1", t)
    # 压缩空白
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    # 若「项目职务」早于「项目经历」，在首个疑似项目日期前插入章节
    if "项目职务" in t:
        first_duty = t.find("项目职务")
        pe = t.find("项目经历")
        if pe == -1 or (first_duty != -1 and pe > first_duty):
            m = re.search(
                r"\d{4}\s*[./]\s*\d{1,2}\s*[-–—~～至到]+\s*(?:\d{4}\s*[./]\s*\d{1,2}|至今)\s+\S+",
                t,
            )
            for m in re.finditer(
                r"(\d{4}\s*[./]\s*\d{1,2}\s*[-–—~～至到]+\s*(?:\d{4}\s*[./]\s*\d{1,2}|至今)\s+[^\n]{2,40})",
                t,
            ):
                chunk = m.group(1)
                if "项目" in chunk or "架构" in chunk:
                    if pe == -1 or m.start() < pe:
                        t = t[: m.start()] + "\n项目经历\n" + t[m.start() :]
                    break
    return t.strip()


def _extract_pdf_pdfmux(file_path: str) -> str:
    try:
        import pdfmux
    except ImportError:
        return ""
    raw = (pdfmux.extract_text(file_path, quality="standard") or "").strip()
    return _normalize_engine_markdown(raw)


def _extract_pdf_edgeparse(file_path: str) -> str:
    try:
        import edgeparse
    except ImportError:
        return ""
    raw = edgeparse.convert(file_path, format="markdown")
    if not isinstance(raw, str):
        raw = getattr(raw, "markdown", None) or str(raw)
    return _normalize_engine_markdown((raw or "").strip())


def _extract_pdf_opendataloader(file_path: str) -> str:
    """需要本机 Java 11+；不可用时返回空。"""
    try:
        import opendataloader_pdf
    except ImportError:
        return ""
    import contextlib
    import io
    import tempfile

    out_dir = tempfile.mkdtemp(prefix="odl_")
    try:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            opendataloader_pdf.convert(
                input_path=[file_path],
                output_dir=out_dir,
                format="markdown",
            )
        md_files = [
            os.path.join(out_dir, f)
            for f in os.listdir(out_dir)
            if f.lower().endswith(".md")
        ]
        if not md_files:
            return ""
        with open(md_files[0], "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
        return _normalize_engine_markdown(raw)
    except Exception:
        return ""
    finally:
        try:
            for root, _, files in os.walk(out_dir, topdown=False):
                for name in files:
                    os.remove(os.path.join(root, name))
            os.rmdir(out_dir)
        except OSError:
            pass


def _ocr_image_to_text(img_path: Path, ocr) -> str:
    """用 MinerU 自带 PP-OCR 识别导出图中的正文。"""
    try:
        import numpy as np
        from PIL import Image
    except ImportError:
        return ""
    try:
        img = np.array(Image.open(img_path).convert("RGB"))[:, :, ::-1].copy()
        raw = ocr.ocr(img) or []
    except Exception:
        return ""
    lines = raw
    if (
        raw
        and isinstance(raw[0], list)
        and raw[0]
        and isinstance(raw[0][0], list)
        and len(raw[0][0]) == 2
        and isinstance(raw[0][0][1], tuple)
    ):
        lines = raw[0]
    wm = re.compile(
        r"^(京东商城|招聘专用|专用|东商城|京东|京)$"
    )
    texts: list[str] = []
    for line in lines:
        if not (isinstance(line, (list, tuple)) and len(line) >= 2):
            continue
        payload = line[1]
        t = str(payload[0] if isinstance(payload, (list, tuple)) else payload).strip()
        if not t or wm.fullmatch(t):
            continue
        texts.append(t)
    return "\n".join(texts)


def _inline_mineru_images(md: str, md_dir: Path) -> str:
    """把 Markdown 里的 ![](images/…) 替换为 OCR 文本（猎聘等把标题块导出成图）。"""
    if "images/" not in md:
        return md
    try:
        from mineru.model.ocr.pytorch_paddle import PytorchPaddleOCR
    except ImportError:
        return md
    ocr = PytorchPaddleOCR(lang="ch")

    def _repl(m: re.Match) -> str:
        rel = m.group(1).replace("\\", "/")
        p = (md_dir / rel).resolve()
        if not p.is_file():
            return ""
        text = _ocr_image_to_text(p, ocr)
        return f"\n{text}\n" if text else ""

    return re.sub(r"!\[.*?\]\((images/[^)]+)\)", _repl, md)


def _extract_pdf_mineru(file_path: str) -> str:
    """MinerU pipeline 抽字；图块再 OCR 内联。需 Python 3.10–3.13 + mineru[pipeline]。"""
    if not getattr(settings, "mineru_enabled", True):
        return ""
    py = getattr(settings, "mineru_python", "") or sys.executable
    backend = getattr(settings, "mineru_backend", "pipeline") or "pipeline"
    method = getattr(settings, "mineru_method", "auto") or "auto"
    model_source = getattr(settings, "mineru_model_source", "modelscope") or "modelscope"
    timeout = int(getattr(settings, "mineru_timeout_sec", 600) or 600)

    mineru_bin = shutil.which("mineru", path=str(Path(py).resolve().parent))
    if mineru_bin:
        cmd = [
            mineru_bin,
            "-p",
            file_path,
            "-o",
            "{out}",
            "-b",
            backend,
            "-m",
            method,
            "-l",
            "ch",
            "-f",
            "false",
            "-t",
            "false",
        ]
    else:
        cmd = [
            py,
            "-m",
            "mineru.cli.client",
            "-p",
            file_path,
            "-o",
            "{out}",
            "-b",
            backend,
            "-m",
            method,
            "-l",
            "ch",
            "-f",
            "false",
            "-t",
            "false",
        ]

    out_dir = tempfile.mkdtemp(prefix="mineru_")
    try:
        real_cmd = [c.replace("{out}", out_dir) for c in cmd]
        env = os.environ.copy()
        env["MINERU_MODEL_SOURCE"] = model_source
        # 避免子进程抢占同端口冲突时刷屏
        proc = subprocess.run(
            real_cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=timeout,
            env=env,
            cwd=out_dir,
        )
        md_files = sorted(Path(out_dir).rglob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not md_files:
            err = (proc.stderr or proc.stdout or "")[-500:]
            raise RuntimeError(f"mineru no md (code={proc.returncode}): {err}")
        md_path = md_files[0]
        raw = md_path.read_text(encoding="utf-8", errors="ignore")
        if getattr(settings, "mineru_ocr_images", True):
            raw = _inline_mineru_images(raw, md_path.parent)
        return _normalize_engine_markdown(raw)
    finally:
        try:
            shutil.rmtree(out_dir, ignore_errors=True)
        except OSError:
            pass


def _pick_ranked_extraction(candidates: list[tuple[str, str]]) -> tuple[str, str]:
    """择优；pymupdf_blocks 若接近最优则优先（猎聘版式更稳）。"""
    ranked = sorted(candidates, key=lambda c: _score_extraction(c[1]), reverse=True)
    best_name, best_text = ranked[0]
    best_score = _score_extraction(best_text)
    for name, text in ranked:
        if name != "pymupdf_blocks":
            continue
        if _score_extraction(text) >= best_score * 0.85:
            return name, text
    return best_name, best_text


def _extract_pdf_best(file_path: str) -> str:
    """多引擎抽字：轻量引擎先择优，MinerU/其余兜底。"""
    candidates: list[tuple[str, str]] = []
    errors: list[str] = []

    # 1) 轻量引擎候选（避免单一引擎误删后仍短路）
    light_engines = (
        ("pymupdf_blocks", _extract_pdf_pymupdf),
        ("pymupdf_dict", _extract_pdf_pymupdf_dict),
        ("pdfplumber", _extract_pdf_pdfplumber),
    )
    for name, fn in light_engines:
        try:
            text = (fn(file_path) or "").strip()
            if text and len(text) >= 80:
                candidates.append((name, text))
            else:
                errors.append(f"{name}:too_short")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}:{exc}")

    if candidates:
        best_name, best_text = _pick_ranked_extraction(candidates)
        return f"<!--extract_engine:{best_name}-->\n{best_text}"

    # 2) MinerU（轻量引擎皆失败时兜底）
    if getattr(settings, "mineru_enabled", True):
        try:
            mu = (_extract_pdf_mineru(file_path) or "").strip()
            if mu:
                mu = _normalize_engine_markdown(mu)
                return f"<!--extract_engine:mineru-->\n{mu}"
            errors.append("mineru:empty")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"mineru:{exc}")

    # 3) 其余引擎
    engines = (
        ("pdfmux", _extract_pdf_pdfmux),
        ("edgeparse", _extract_pdf_edgeparse),
        ("opendataloader", _extract_pdf_opendataloader),
        ("pymupdf4llm", _extract_pdf_pymupdf4llm),
        ("pdfminer", _extract_pdf_pdfminer),
        ("pypdf", _extract_pdf_pypdf),
    )
    for name, fn in engines:
        try:
            text = (fn(file_path) or "").strip()
            if text:
                if name in _MARKDOWN_ENGINES:
                    text = _normalize_engine_markdown(text)
                candidates.append((name, text))
            else:
                errors.append(f"{name}:empty")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{name}:{exc}")

    if not candidates:
        raise RuntimeError("PDF 文本抽取失败：" + ("；".join(errors) or "无可用引擎"))

    best_name, best_text = _pick_ranked_extraction(candidates)
    return f"<!--extract_engine:{best_name}-->\n{best_text}"


def _is_field_label_line(line: str) -> bool:
    t = (line or "").strip()
    return bool(_ORPHAN_LABEL_RE.match(t) or re.match(rf"^({_LAYOUT_LABEL_ALT})：\S", t))


def _merge_orphan_and_dates(lines: list[str]) -> list[str]:
    """合并「值\\n标签：」以及「日期\\n标题」拆行。"""
    # 先去水印碎片，避免插入到值与标签之间
    filtered = []
    for line in lines:
        t = line.strip()
        if not t:
            filtered.append("")
            continue
        if _WATERMARK_FRAG_RE.match(t):
            continue
        if _JD_WATERMARK_RE.search(t) and len(t) <= 16:
            continue
        filtered.append(line.rstrip())

    # 值在上一行、空标签在本行 → 标签：值（仅短字段；避免吞掉简介续行）
    merged: list[str] = []
    for line in filtered:
        t = line.strip()
        m = _ORPHAN_LABEL_RE.match(t)
        if m and merged:
            label = m.group(1)
            j = len(merged) - 1
            while j >= 0 and not merged[j].strip():
                j -= 1
            if j >= 0:
                prev = merged[j].strip()
                allow = label in _PRE_VALUE_LABELS or (
                    label in _PRE_VALUE_SHORT_LABELS and 0 < len(prev) <= 80
                )
                # 项目职务上一行若是「…项目」标题，禁止误吞；「项目分析师」等职务名允许
                if label == "项目职务" and (
                    prev.endswith("项目") or len(prev) > 20 or _DATE_LINE_RE.match(prev)
                ):
                    allow = False
                if label == "所在公司" and (prev.endswith("项目") or len(prev) > 24):
                    allow = False
                if (
                    allow
                    and prev
                    and not _is_field_label_line(prev)
                    and not _DATE_LINE_RE.match(prev)
                    and prev not in _SECTION_HEADERS
                ):
                    merged[j] = f"{label}：{prev}"
                    continue
        merged.append(line)

    # 日期行 + 下一标题行
    out: list[str] = []
    i = 0
    while i < len(merged):
        t = merged[i].strip()
        dm = _DATE_LINE_RE.match(t)
        if dm and i + 1 < len(merged):
            nxt = merged[i + 1].strip()
            if (
                nxt
                and not _is_field_label_line(nxt)
                and not _DATE_LINE_RE.match(nxt)
                and nxt not in _SECTION_HEADERS
                and not nxt.startswith("---")
            ):
                out.append(f"{dm.group('period')} {nxt}")
                i += 2
                continue
        out.append(merged[i])
        i += 1
    return out


def normalize_resume_layout(text: str) -> str:
    """修复猎聘类「值|标签：」/「值\\n标签：」倒置，并合并日期与标题拆行。"""
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = _merge_orphan_and_dates(raw.split("\n"))

    out_lines: list[str] = []
    i = 0
    while i < len(lines):
        s = lines[i].rstrip()
        stripped = s.strip()
        if not stripped:
            out_lines.append("")
            i += 1
            continue

        # 教育：硕士 / 学历： / 数学 / 专业： / 东华大学 …
        if stripped in ("学历：", "专业：") or (
            i + 1 < len(lines)
            and lines[i + 1].strip() in ("学历：", "专业：")
        ):
            # 块式：值\\n学历： → 已在 orphan 合并；此处处理仍拆开的「学历：\\n值」
            pass

        if (
            i + 4 < len(lines)
            and lines[i + 1].strip() == "学历："
            and lines[i + 3].strip() == "专业："
        ):
            degree = stripped
            major = lines[i + 2].strip()
            school_date = lines[i + 4].strip()
            if degree and major:
                out_lines.append(f"学历：{degree} 专业：{major} {school_date}".strip())
                i += 5
                continue

        if "学历" in stripped and "专业" in stripped and re.search(r"[|｜]", stripped):
            parts = [p.strip() for p in re.split(r"\s*[|｜]\s*", stripped) if p.strip()]
            degree = major = school_date = ""
            for idx, p in enumerate(parts):
                if p.startswith("学历") and idx > 0 and not degree:
                    degree = parts[idx - 1]
                elif p.startswith("专业") and idx > 0 and not major:
                    major = parts[idx - 1]
                elif re.search(r"\d{4}", p) and ("大学" in p or "学院" in p):
                    school_date = p
            if degree or major or school_date:
                bits = []
                if degree:
                    bits.append(f"学历：{degree}")
                if major:
                    bits.append(f"专业：{major}")
                if school_date:
                    bits.append(school_date)
                out_lines.append(" ".join(bits))
                i += 1
                continue

        m = _PIPE_LABEL_RE.match(stripped) or _INLINE_PIPE_LABEL_RE.match(stripped)
        if m:
            val = m.group("val").strip(" |｜")
            label = m.group("label")
            if val and val not in _LAYOUT_LABELS:
                out_lines.append(f"{label}：{val}")
                i += 1
                continue

        m2 = _GLUED_LABEL_RE.search(stripped)
        if m2 and not stripped.startswith(m2.group("label") + "："):
            val = m2.group("val").strip(" |｜")
            label = m2.group("label")
            if val and val not in _LAYOUT_LABELS:
                prefix = stripped[: m2.start()].rstrip()
                fixed = f"{label}：{val}"
                out_lines.append(f"{prefix}\n{fixed}".strip() if prefix else fixed)
                i += 1
                continue

        # 空标签行后紧跟正文：保留「标签：」+ 正文（供字段抽取）
        if _ORPHAN_LABEL_RE.match(stripped) and i + 1 < len(lines):
            nxt = lines[i + 1].strip()
            if nxt and not _is_field_label_line(nxt) and not _DATE_LINE_RE.match(nxt):
                out_lines.append(f"{stripped}{nxt}" if stripped.endswith("：") else f"{stripped}：{nxt}")
                i += 2
                continue

        out_lines.append(s)
        i += 1

    compact: list[str] = []
    blank = 0
    for line in out_lines:
        if not line.strip():
            blank += 1
            if blank <= 2:
                compact.append("")
            continue
        blank = 0
        compact.append(line)
    return "\n".join(compact).strip()


def extract_text(file_path: str) -> str:
    """根据扩展名提取纯文本。PDF 多引擎择优后再做版式归一。"""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".pdf":
        return normalize_resume_layout(_extract_pdf_best(file_path))
    if ext in (".docx",):
        import docx  # python-docx

        doc = docx.Document(file_path)
        return "\n".join(p.text for p in doc.paragraphs)
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def clean_resume_text(text: str) -> tuple[str, str]:
    """清洗简历文本：去掉水印/页码等无效行，保留有效正文。

    Returns:
        (cleaned_text, raw_text)
    """
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    engine_m = re.search(r"<!--extract_engine:([A-Za-z0-9_]+)-->", raw)
    engine = (engine_m.group(1).strip() if engine_m else "")
    raw = re.sub(r"<!--extract_engine:[A-Za-z0-9_]+-->\n?", "", raw)
    # Markdown 引擎 / 无标记粘贴：激进归一；行式引擎：轻量修复，避免拆坏 2023.04
    if engine in _MARKDOWN_ENGINES or not engine:
        normalized = _normalize_engine_markdown(raw)
    else:
        normalized = _light_normalize_extracted_text(raw)
    raw = normalize_resume_layout(normalized)
    lines = raw.split("\n")
    short_counts: Counter[str] = Counter()
    for line in lines:
        t = line.strip()
        if 0 < len(t) <= 24:
            short_counts[t] += 1

    cleaned: list[str] = []
    for line in lines:
        t = line.strip()
        if not t:
            cleaned.append("")
            continue
        if _SYMBOL_ONLY_RE.match(t):
            continue
        if _PAGE_NOISE_RE.match(t):
            continue
        if _WATERMARK_FRAG_RE.match(t):
            continue
        if _JD_WATERMARK_RE.search(t) and len(t) <= 16:
            continue
        if _INVALID_LINE_RE.search(t) and len(t) <= 80:
            continue
        # 短行高频 → 水印；但字段标签行绝不能删
        if len(t) <= 24 and short_counts[t] >= 3 and not _is_field_label_line(t):
            if not t.endswith("：") or t.rstrip("：") not in _LAYOUT_LABELS:
                continue
        cleaned.append(line.rstrip())

    out: list[str] = []
    blank = 0
    for line in cleaned:
        if not line.strip():
            blank += 1
            if blank <= 2:
                out.append("")
            continue
        blank = 0
        out.append(line)
    cleaned_text = "\n".join(out).strip()
    return cleaned_text, raw.strip()


def _split_numbered_items(body: str) -> list[str]:
    body = (body or "").strip()
    if not body:
        return []
    # 先清理尾部断句碎片：只含标点的行、孤立数字/字母碎片
    parts = re.split(r"(?=(?:^|\n)\s*\d+\s*[)）、.．]\s*)", body)
    items = [p.strip() for p in parts if p.strip()]
    if len(items) >= 2:
        items = [it for it in items if len(it) >= 3]
        return items if items else [body]
    # 分号/句号弱切
    weak = [x.strip() for x in re.split(r"(?<=[；;])\s*", body) if x.strip()]
    weak = [w for w in weak if len(w) >= 3]
    return weak if len(weak) >= 2 else ([body] if body else [])


def _extract_labeled_field(block: str, label: str) -> str:
    """取「标签：值」到下一标签/下一节之前的正文。"""
    labels = list(_LAYOUT_LABELS) + list(_SECTION_HEADERS)
    next_alt = "|".join(re.escape(x) for x in labels if x != label)
    header_alt = "|".join(re.escape(h) for h in _SECTION_HEADERS)
    # 冒号后只用横向空白；兼容半角冒号
    pat = re.compile(
        rf"{re.escape(label)}[：:]\s*[ \t]*(.*?)(?=\n(?:{next_alt})[：:]|\n(?:{header_alt})\s*$|\Z)",
        re.S | re.M,
    )
    m = pat.search(block)
    if not m:
        return ""
    val = re.sub(r"\n{3,}", "\n\n", m.group(1).strip())
    # 短字段只取首行，避免把简介正文吞进公司/职务
    if label in _PRE_VALUE_LABELS:
        val = val.split("\n", 1)[0].strip()
    return val


def _intro_from_gap(body: str) -> str:
    """简介标签为空时，回收「所在公司/职务」与「项目职责」之间的游离正文（仅首段）。"""
    m = re.search(
        r"(?:所在公司|项目职务)：[^\n]*\n(.*?)(?=\n项目职责：|\n项目业绩：|\n\d{4}|\Z)",
        body,
        re.S,
    )
    if not m:
        return ""
    gap = m.group(1)
    gap = re.sub(r"项目简介：\s*", "", gap)
    gap = re.sub(r"(?m)^(所在公司|项目职务)：.*\n?", "", gap)
    # 只取第一段有实质内容的部分作为简介
    lines = gap.strip().split("\n")
    intro_lines = []
    for line in lines:
        t = line.strip()
        if not t:
            break
        # 遇到"主要负责"、"负责"开头 → 结束简介
        if t.startswith("主要负责") or t.startswith("负责") or t.startswith("1、") or re.match(r"^\d+[)）、.．]", t):
            break
        intro_lines.append(t)
        if t.endswith("。") and len(intro_lines) >= 1:
            break
    return "\n".join(intro_lines).strip()


def _clean_project_name(name: str) -> str:
    s = (name or "").strip()
    s = re.sub(r"京东商城|招聘专用", "", s)
    s = re.sub(r"(?:\s+[\u4e00-\u9fff]){2,}\s*$", "", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" ·|-")
    return s


def _parse_project_block(name: str, start: str, end: str, body: str) -> dict:
    role = _extract_labeled_field(body, "项目职务")
    company = _extract_labeled_field(body, "所在公司")
    intro = _extract_labeled_field(body, "项目简介")
    # 如果简介值实际上是另一个字段标签（如"所在公司：XXX"），视为空
    if intro and re.match(rf"^\s*(?:{'|'.join(re.escape(x) for x in _LAYOUT_LABELS)})：", intro):
        intro = ""
    if not intro or intro.startswith("项目职责：") or intro.startswith("项目业绩："):
        intro = _intro_from_gap(body) or intro
    page_noise = re.compile(r"\n--- 第\d+页 ---\n?")
    intro = page_noise.sub("\n", intro).strip()
    resp_raw = page_noise.sub("\n", _extract_labeled_field(body, "项目职责")).strip()
    ach_raw = page_noise.sub("\n", _extract_labeled_field(body, "项目业绩")).strip()

    # fallback: 如果去除嵌入标签后没有项目职责/业绩字段，
    # 收集 intro 之后、"主要负责"/"负责"/编号开头的正文作为职责
    if not resp_raw and not ach_raw:
        leftover_lines: list[str] = []
        for line in body.split("\n"):
            t = line.strip()
            if not t or t.startswith("---"):
                continue
            if _is_field_label_line(t):
                continue
            if t == role or t == company:
                continue
            # 跳过已是 intro 的内容
            if intro and len(intro) >= 10 and t in intro:
                continue
            leftover_lines.append(t)
        leftover = "\n".join(leftover_lines).strip()
        if leftover and len(leftover) >= 10 and any(
            l.startswith("主要负责") or l.startswith("负责") or re.match(r"^\d+[)）、.．]", l)
            for l in leftover.split("\n")
        ):
            resp_raw = leftover

    responsibilities = _split_numbered_items(resp_raw) if resp_raw else []
    achievements = _split_numbered_items(ach_raw) if ach_raw else []
    if ach_raw and not achievements:
        achievements = [ach_raw]
    return {
        "name": _clean_project_name(name),
        "role": role.strip(),
        "company": company.strip(),
        "start": start.replace(" ", "").replace("年", "/").strip(),
        "end": end.replace(" ", "").replace("年", "/").strip(),
        "intro": intro.strip(),
        "responsibilities": responsibilities,
        "achievements": achievements,
        "bullets": [],
    }


def split_project_windows(text: str) -> list[dict]:
    """按「日期 + 项目名」切窗；返回确定性项目列表（可能为空）。"""
    if not text:
        return []
    # 优先截取项目经历章节，避免工作经历日期行误伤
    proj_start = -1
    for key in ("项目经历", "项目经验"):
        proj_start = text.find(key)
        if proj_start != -1:
            break
    if proj_start == -1:
        return []

    rest = text[proj_start:]
    end_pos = len(rest)
    for key in ("教育经历", "教育背景", "语言能力", "自我评价", "附加信息", "技能"):
        p = rest.find(key, 4)
        if p != -1:
            end_pos = min(end_pos, p)
    section = rest[:end_pos]
    lines = section.split("\n")

    headers: list[tuple[int, re.Match[str]]] = []
    for i, line in enumerate(lines):
        m = _PROJECT_HEADER_RE.match(line.strip())
        if m:
            # 排除工作经历里「公司（N年）」形态误匹配：项目名通常不含纯公司括号年
            name = _clean_project_name(m.group("name"))
            if not name:
                continue
            if re.fullmatch(r".+（\d+年）", name):
                continue
            headers.append((i, m))

    if not headers:
        return []

    projects: list[dict] = []
    for idx, (line_i, m) in enumerate(headers):
        next_i = headers[idx + 1][0] if idx + 1 < len(headers) else len(lines)
        body = "\n".join(lines[line_i + 1 : next_i]).strip()
        proj = _parse_project_block(
            _clean_project_name(m.group("name")),
            m.group("start"),
            m.group("end"),
            body,
        )
        if proj["name"] or proj["intro"] or proj["responsibilities"] or proj["achievements"]:
            projects.append(proj)
    return projects


def _strip_project_bodies_for_llm(text: str, projects: list[dict]) -> str:
    """给 LLM 的文本：保留项目标题清单，去掉项目正文，降低串段概率。"""
    if not projects:
        return text
    proj_start = -1
    for key in ("项目经历", "项目经验"):
        proj_start = text.find(key)
        if proj_start != -1:
            break
    if proj_start == -1:
        return text

    rest = text[proj_start:]
    end_pos = len(rest)
    end_key = ""
    for key in ("教育经历", "教育背景", "语言能力", "自我评价", "附加信息", "技能"):
        p = rest.find(key, 4)
        if p != -1 and p < end_pos:
            end_pos = p
            end_key = key

    head = text[:proj_start]
    tail = rest[end_pos:] if end_key else ""
    lines = ["项目经历", "（以下项目正文已按标题切窗单独归档，请勿从其它章节回填 projects）"]
    for p in projects:
        period = f"{p.get('start', '')}-{p.get('end', '')}".strip("-")
        role = p.get("role") or ""
        lines.append(f"- {p.get('name', '')} | {role} | {period}".strip(" |"))
    return head + "\n".join(lines) + ("\n" + tail if tail else "")


_PARSE_SYSTEM = """你是简历解析助手。请从候选人简历中抽取可用于面试回答的结构化素材。

只返回一个 JSON 对象，格式如下（assets 为数组）：
{
  "assets": [
    {
      "asset_type": "项目/经历/技能/指标/风险点 之一",
      "title": "简短标题",
      "content": "用于面试表达的要点（背景-角色-行动-结果，尽量含量化指标）",
      "keywords": ["关键词"],
      "possible_followups": ["面试官可能的追问"],
      "confidence": 0.0到1.0之间的数字
    }
  ]
}

要求：
1. 忠于简历原文，不要编造简历中没有的事实、公司名或数字。
2. 信息缺失（如缺少量化结果或个人贡献）时，在 content 末尾标注「需补充：xxx」。
3. 重点抽取项目经历，每段项目单独成一条。"""


def _llm_parse(text: str) -> list[dict]:
    client = openai_client()
    resp = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": _PARSE_SYSTEM},
            {"role": "user", "content": f"简历内容：\n{text[:8000]}"},
        ],
        temperature=0.2,
        response_format={"type": "json_object"},
    )
    data = json.loads(resp.choices[0].message.content or "{}")
    assets = data.get("assets", [])
    if not assets:
        raise LLMServiceError("LLM 未从简历中解析出有效素材")
    return assets


def parse_resume(text: str) -> list[dict]:
    """把简历文本解析为结构化素材列表。"""
    text = (text or "").strip()
    if not text:
        return []
    require_llm_config()
    try:
        return _llm_parse(text)
    except Exception as exc:
        if isinstance(exc, LLMServiceError):
            raise
        raise LLMServiceError(f"简历解析失败：{exc}") from exc


_STRUCTURE_SYSTEM = f"""你是简历结构化抽取助手。目标：把上传简历中的有效内容原样映射到固定模块字段，供系统用统一模板「展示」，而不是改写简历。

{schema_prompt_block()}

硬性要求：
1. 忽略水印、页码、「仅供预览」、招聘网站页眉页脚、广告语；这些不是简历内容。
2. 所有字符串字段（含每条职责/业绩）必须从原文逐字摘录，禁止润色、同义替换、语序调整、合并/拆分条目。
3. 时间、公司名、学校名、职位名、项目名保持原文写法。
4. 经历/项目条目的先后顺序与原文一致；module_order 与原文章节顺序一致。
5. 项目块若出现「项目职务」「所在公司」「项目简介」「项目职责」「项目业绩」等标签，必须分别写入 role/company/intro/responsibilities/achievements。
6. 禁止跨项目、跨「工作经历」串段：某一项目的 responsibilities/achievements/intro 只能来自该项目名称下方到下一项目之前的原文。
7. 若用户消息已声明「项目正文已按标题切窗单独归档」，则 projects 输出空数组 []，不要从工作经历或其他章节捏造项目。
8. 若用户消息已声明「工作经历已规则归档」，则 experience 输出空数组 []，勿从项目经历回填。
9. 系统模板只负责排版，不负责改内容。只输出 JSON，不要 markdown。

项目字段示例（说明映射关系，非要求输出相同文字）：
原文有「项目职务：项目分析师」「所在公司：58同城」「项目简介：……」「项目职责：1)…… 2)……」
→ name=项目标题, role=项目分析师, company=58同城, intro=简介原文,
  responsibilities=["1)……","2)……"], achievements=[]（若无独立业绩标题）。"""


_PROJECT_STRUCTURE_SYSTEM = """你是简历「单项目」结构化助手。只解析用户给出的一个项目文本块。
只返回 JSON：
{
  "name": "",
  "role": "",
  "company": "",
  "start": "",
  "end": "",
  "intro": "",
  "responsibilities": [],
  "achievements": [],
  "bullets": []
}
要求：逐字摘录，禁止编造；简介/职责/业绩按标签分栏；不要引入其它项目或工作经历句子。"""


def _llm_structure(text: str) -> dict:
    client = openai_client()
    resp = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": _STRUCTURE_SYSTEM},
            {
                "role": "user",
                "content": (
                    "请对下列简历文本做「原样结构化归档」：\n"
                    "- 只提取有效简历内容到对应模块\n"
                    "- 文字与条目结构保持与原文一致，不要改写\n"
                    "- 按原文章节顺序填写 module_order\n"
                    "- 若项目正文已切窗归档，projects 请置为空数组\n\n"
                    f"{text[:12000]}"
                ),
            },
        ],
        temperature=0.0,
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content or "{}")


def _llm_structure_one_project(block: str, hint_name: str = "") -> dict:
    client = openai_client()
    resp = client.chat.completions.create(
        model=get_llm_model(),
        messages=[
            {"role": "system", "content": _PROJECT_STRUCTURE_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"项目名提示：{hint_name or '（见正文）'}\n"
                    f"项目文本块：\n{block[:6000]}"
                ),
            },
        ],
        temperature=0.0,
        response_format={"type": "json_object"},
    )
    data = json.loads(resp.choices[0].message.content or "{}")
    return data if isinstance(data, dict) else {}


def _project_quality_ok(p: dict) -> bool:
    if not (p.get("name") or "").strip():
        return False
    return bool(
        (p.get("intro") or "").strip()
        or p.get("responsibilities")
        or p.get("achievements")
        or p.get("bullets")
    )


def _deterministic_sufficient(det: dict, text: str) -> bool:
    """规则结果是否已覆盖主要模块（满足则不再调 LLM，避免串段/删改）。"""
    if "工作经历" in text and not det.get("experience"):
        return False
    if ("项目经历" in text or "项目经验" in text) and not det.get("projects"):
        return False
    for e in det.get("experience") or []:
        if not (e.get("company") or "").strip():
            return False
        if "职责业绩" in text and not e.get("bullets"):
            return False
    for p in det.get("projects") or []:
        if not (p.get("name") or "").strip():
            return False
        if not (
            (p.get("intro") or "").strip()
            or p.get("responsibilities")
            or p.get("achievements")
            or p.get("bullets")
        ):
            return False
    return bool(det.get("experience") or det.get("projects"))


def extract_structured_resume(text: str, file_path: str = "") -> dict:
    """从简历原文抽取可扩展结构化 JSON。LLM 优先（含 layout_blocks）；规则做 experience/projects 兜底防止串段。"""
    text = normalize_resume_layout((text or "").strip())
    if not text:
        return normalize_structured({})

    det = extract_deterministic_resume(text)
    llm_data: dict = {}
    llm_note = ""

    # 始终尝试 LLM（需要 layout_blocks）
    try:
        require_llm_config()
        llm_input = text
        llm_data = _llm_structure(llm_input)
    except Exception as exc:
        if isinstance(exc, LLMServiceError):
            llm_note = str(exc)
        else:
            llm_note = f"LLM 跳过：{exc}"

    merged = _merge_deterministic_precedence(det, llm_data)
    merged.setdefault("extras", {})["extraction"] = (
        "deterministic" if not llm_data else "deterministic+llm"
    )
    if llm_note:
        merged.setdefault("needs_confirmation", [])
        if not llm_data:
            merged["needs_confirmation"].append(llm_note)
        else:
            merged["extras"]["extraction_note"] = llm_note

    # 布局块：优先 pymupdf 样式提取，其次 LLM 输出，最后规则生成
    llm_blocks = llm_data.get("layout_blocks") if isinstance(llm_data, dict) else None
    if isinstance(llm_blocks, list) and llm_blocks:
        merged["layout_blocks"] = llm_blocks
    elif file_path:
        try:
            merged["layout_blocks"] = extract_layout_blocks(file_path)
        except Exception:
            merged["layout_blocks"] = []
    else:
        try:
            merged["layout_blocks"] = extract_layout_blocks(text)
        except Exception:
            merged["layout_blocks"] = []

    # LLM 没产出项目时，回退到规则切窗 + 单项目 LLM（保留原有逻辑）
    if not merged.get("projects") and ("项目经历" in text or "项目经验" in text):
        rough = _rough_project_blocks(text)
        if rough:
            try:
                require_llm_config()
                projects = []
                for name, block in rough:
                    filled = _llm_structure_one_project(block, name)
                    if isinstance(filled, dict) and (
                        filled.get("name") or filled.get("intro") or filled.get("responsibilities")
                    ):
                        if not filled.get("name"):
                            filled["name"] = name
                        projects.append(filled)
                if projects:
                    merged["projects"] = projects
                    merged["extras"]["extraction"] = "deterministic+llm_projects_only"
            except Exception:
                pass

    return normalize_structured(merged)


def _section_slice(text: str, start_keys: tuple[str, ...], end_keys: tuple[str, ...]) -> str:
    start = -1
    for key in start_keys:
        start = text.find(key)
        if start != -1:
            break
    if start == -1:
        return ""
    rest = text[start:]
    end_pos = len(rest)
    for key in end_keys:
        p = rest.find(key, max(len(start_keys[0]), 4))
        if p != -1:
            end_pos = min(end_pos, p)
    return rest[:end_pos]


_EXP_HEADER_RE = re.compile(
    r"^(?P<start>\d{4}\s*[./年]\s*\d{1,2})\s*[-–—~～]+\s*"
    r"(?P<end>\d{4}\s*[./年]\s*\d{1,2}|至今)\s+"
    r"(?P<company>.+)$"
)
_EXP_META_PREFIXES = ("公司行业", "所在地区", "下属人数", "职责业绩", "工作描述")
# 短职位名候选（2-12字，只含中文/英文/括号/斜杠，不含数字和标签关键词）
_JOB_TITLE_WORD_RE = re.compile(
    r"^(?!.*(?:公司|地区|人数|职责|描述|简介|业绩|标签|项目|教育|技能|语言|荣誉|证书|联系|邮箱|地址|电话|日期|行业|职位|年薪))"
    r"[一-鿿A-Za-z\(\)（）/\+—\-\s]{2,16}$"
)
_EXP_META_PREFIXES_SET = frozenset(_EXP_META_PREFIXES)


def _parse_experience_block(company: str, start: str, end: str, body: str) -> dict:
    """解析单条经历块，合并工作描述+职责业绩为 bullets。"""
    title = ""
    for line in body.split("\n"):
        t = line.strip()
        if not t or t.startswith("---"):
            continue
        if any(t.startswith(p) for p in _EXP_META_PREFIXES):
            continue
        if _is_field_label_line(t):
            continue
        if re.match(r"^\d{4}", t):
            continue
        if re.match(r"^\d+\s*[)）、.．]", t):
            continue
        title = t
        break

    # 合并 "工作描述" 和 "职责业绩" 两份内容
    parts: list[str] = []
    desc_raw = _extract_labeled_field(body, "工作描述")
    if desc_raw:
        parts.append(desc_raw)
    duty_raw = _extract_labeled_field(body, "职责业绩")
    if duty_raw:
        parts.append(duty_raw)

    if parts:
        full = "\n".join(parts)
        bullets = _split_numbered_items(full)
    else:
        # fallback: 无标签时，收集 title 后的编号条目作为 bullets
        fallback_lines: list[str] = []
        found_title = False
        for line in body.split("\n"):
            t = line.strip()
            if not t or t.startswith("---"):
                continue
            if any(t.startswith(p) for p in _EXP_META_PREFIXES):
                continue
            if _is_field_label_line(t):
                continue
            if re.match(r"^\d{4}", t):
                continue
            if not found_title:
                # 无标题时，不跳过任何行，直接开始收集
                if not title:
                    found_title = True
                    fallback_lines.append(t)
                    continue
                if t == title:
                    found_title = True
                    continue
                continue
            fallback_lines.append(t)
        if fallback_lines:
            bullets = _split_numbered_items("\n".join(fallback_lines))
        else:
            bullets = []

    location = _extract_labeled_field(body, "所在地区")
    return {
        "company": company.strip(),
        "title": title.strip(),
        "start": start.replace(" ", "").replace("年", "/").strip(),
        "end": end.replace(" ", "").replace("年", "/").strip(),
        "location": location.strip(),
        "bullets": bullets,
    }


def _find_main_title_index(body_lines: list[str]) -> int:
    """在经历块中找到主职位名的行索引。返回第一个非元数据、非标签的中文短行。"""
    for i, t in enumerate(body_lines):
        s = t.strip()
        if not s or s.startswith("---"):
            continue
        if any(s.startswith(p) for p in _EXP_META_PREFIXES):
            continue
        if _is_field_label_line(s):
            continue
        if re.match(r"^\d{4}", s):
            continue
        if re.match(r"^\d+\s*[)）、.．]", s):
            continue
        if len(s) <= 18 and re.search(r"[一-鿿]", s):
            return i
    return -1


def _find_sub_role_lines(body_lines: list[str]) -> list[int]:
    """在经历块内找额外职位名行（同一公司多个角色）。"""
    indices: list[int] = []
    for i, t in enumerate(body_lines):
        s = t.strip()
        if not s or s.startswith("---"):
            continue
        if any(s.startswith(p) for p in _EXP_META_PREFIXES):
            continue
        if _is_field_label_line(s):
            continue
        if re.match(r"^\d{4}", s):
            continue
        if re.match(r"^\d+\s*[)）、.．]", s):
            continue
        if len(s) > 18:
            continue
        # 纯中文短行 + 非元数据标签 → 可能是职位名
        if _JOB_TITLE_WORD_RE.match(s) and re.search(r"[一-鿿]", s):
            # 排除明显不是职位的内容
            if not re.search(r"^[\d\s\(\)（）/\-–—.,，。、]+$", s):
                indices.append(i)
    return indices


def split_experience_windows(text: str) -> list[dict]:
    section = _section_slice(
        text,
        ("工作经历", "工作/实习经历"),
        ("项目经历", "项目经验", "教育经历", "教育背景"),
    )
    if not section:
        return []
    lines = section.split("\n")
    headers: list[tuple[int, re.Match[str]]] = []
    for i, line in enumerate(lines):
        m = _EXP_HEADER_RE.match(line.strip())
        if not m:
            continue
        company = m.group("company").strip()
        if "项目" in company and company.endswith("项目"):
            continue
        headers.append((i, m))
    if not headers:
        return []
    out: list[dict] = []
    for idx, (line_i, m) in enumerate(headers):
        next_i = headers[idx + 1][0] if idx + 1 < len(headers) else len(lines)
        body_lines = lines[line_i + 1 : next_i]
        body = "\n".join(body_lines).strip()

        company = m.group("company").strip()
        start = m.group("start")
        end = m.group("end")

        # 主职位标题位置
        main_idx = _find_main_title_index(body_lines)
        if main_idx < 0:
            # 没有找到有效标题，跳过
            continue

        # 主角色 body：从 main_idx+1 到下一个子角色（或末尾）
        all_sub = _find_sub_role_lines(body_lines)
        # 主角色之后的子角色（排除主角色自身）
        sub_after_main = [s for s in all_sub if s > main_idx]
        if sub_after_main:
            main_end = sub_after_main[0]
        else:
            main_end = len(body_lines)

        main_body_lines = body_lines[main_idx + 1 : main_end]
        main_body = "\n".join(main_body_lines).strip()
        main_title = body_lines[main_idx].strip()

        row = _parse_experience_block(company, start, end, main_body)
        row["title"] = main_title
        if row["company"] or row["title"] or row["bullets"]:
            out.append(row)

        # 子角色
        for j, si in enumerate(sub_after_main):
            sub_title = body_lines[si].strip()
            next_si = sub_after_main[j + 1] if j + 1 < len(sub_after_main) else None
            if next_si is not None:
                sub_slice = body_lines[si + 1 : next_si]
            else:
                sub_slice = body_lines[si + 1:]
            sub_body = "\n".join(sub_slice).strip()
            sub_row = _parse_experience_block(company, start, end, sub_body)
            sub_row["title"] = sub_title
            if sub_row["company"] or sub_row["title"] or sub_row["bullets"]:
                out.append(sub_row)
    return out


def parse_basics_heuristic(text: str) -> dict:
    basics = {
        "name": "",
        "phone": "",
        "email": "",
        "city": "",
        "target_role": "",
        "links": [],
    }
    m = re.search(r"姓名[：:]\s*([^\n]+)", text)
    if m:
        basics["name"] = m.group(1).strip()
    m = re.search(r"所在地[：:]\s*([^\n]+)", text)
    if m:
        basics["city"] = m.group(1).strip()
    m = re.search(r"期望职位[：:]\s*([^\n]+)", text)
    if m:
        basics["target_role"] = m.group(1).strip()
    if not basics["target_role"]:
        m = re.search(r"所任职位[：:]\s*([^\n]+)", text)
        if m:
            basics["target_role"] = m.group(1).strip()
    phone = re.search(r"1[3-9]\d{9}", text)
    if phone:
        basics["phone"] = phone.group(0)
    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text)
    if email:
        basics["email"] = email.group(0)
    return basics


def parse_education_section(text: str) -> list[dict]:
    section = _section_slice(
        text,
        ("教育经历", "教育背景"),
        ("语言能力", "技能", "自我评价", "附加信息", "荣誉"),
    )
    if not section:
        return []
    rows: list[dict] = []
    lines = [
        x.strip()
        for x in section.split("\n")
        if x.strip() and not x.strip().startswith("---") and x.strip() not in ("教育经历", "教育背景")
    ]
    i = 0
    while i < len(lines):
        t = lines[i]
        degree = major = school = start = end = ""

        if t.startswith("学历"):
            degree = t.split("：", 1)[-1].split(":", 1)[-1].strip()
            if i + 1 < len(lines) and lines[i + 1].startswith("专业"):
                major = lines[i + 1].split("：", 1)[-1].split(":", 1)[-1].strip()
                i += 1
            if i + 1 < len(lines):
                school_line = lines[i + 1]
                dm = re.search(
                    r"(?P<school>.+?)\s+((?:\d{4}\s*[./–—-]\s*\d{1,2})\s*[-–—~～]+\s*(?:\d{4}\s*[./–—-]\s*\d{1,2}|至今))",
                    school_line,
                )
                if dm:
                    school = dm.group("school").strip()
                    parts = re.split(r"\s*[-–—~～]+\s*", dm.group(2).strip(), maxsplit=1)
                    start = parts[0].replace(" ", "") if parts else ""
                    end = parts[1].replace(" ", "") if len(parts) > 1 else ""
                else:
                    school = school_line
                i += 1
            if degree or school:
                rows.append(
                    {
                        "school": school,
                        "degree": degree,
                        "major": major,
                        "start": start,
                        "end": end,
                        "extras": [],
                    }
                )
            i += 1
            continue

        m = re.match(
            r"学历[：:]\s*(?P<degree>[^专]+?)\s*专业[：:]\s*(?P<major>[^东大]+?)\s*(?P<rest>.+)$",
            t,
        )
        if m:
            school_date = m.group("rest").strip()
            school = school_date
            start = end = ""
            dm = re.search(
                r"(?P<school>.+?)\s+((?:\d{4}\s*[./–—-]\s*\d{1,2})\s*[-–—~～]+\s*(?:\d{4}\s*[./–—-]\s*\d{1,2}|至今))",
                school_date,
            )
            if dm:
                school = dm.group("school").strip()
                parts = re.split(r"\s*[-–—~～]+\s*", dm.group(2).strip(), maxsplit=1)
                start = parts[0].replace(" ", "") if parts else ""
                end = parts[1].replace(" ", "") if len(parts) > 1 else ""
            rows.append(
                {
                    "school": school,
                    "degree": m.group("degree").strip(),
                    "major": m.group("major").strip(),
                    "start": start,
                    "end": end,
                    "extras": [],
                }
            )
        elif t in ("硕士", "本科", "博士", "专科", "大专"):
            degree = t
            major = lines[i + 1] if i + 1 < len(lines) else ""
            school_line = lines[i + 2] if i + 2 < len(lines) else ""
            if major and school_line and ("大学" in school_line or "学院" in school_line):
                school = school_line
                start = end = ""
                dm = re.search(
                    r"(.+?)\s+((?:\d{4}\s*[./–—-]\s*\d{1,2})\s*[-–—~～]+\s*(?:\d{4}\s*[./–—-]\s*\d{1,2}|至今))",
                    school_line,
                )
                if dm:
                    school = dm.group(1).strip()
                    parts = re.split(r"\s*[-–—~～]+\s*", dm.group(2).strip(), maxsplit=1)
                    start = parts[0].replace(" ", "") if parts else ""
                    end = parts[1].replace(" ", "") if len(parts) > 1 else ""
                rows.append(
                    {
                        "school": school,
                        "degree": degree,
                        "major": major.replace("专业", "").replace("：", "").strip(),
                        "start": start,
                        "end": end,
                        "extras": [],
                    }
                )
                i += 3
                continue
        i += 1

    seen: set[tuple[str, str, str]] = set()
    uniq: list[dict] = []
    for r in rows:
        key = (r["school"], r["degree"], r["major"])
        if key in seen:
            continue
        seen.add(key)
        if r["school"] or r["degree"]:
            uniq.append(r)
    return uniq


def parse_skills_section(text: str) -> list[dict]:
    section = _section_slice(
        text,
        ("语言能力", "技能"),
        ("自我评价", "附加信息", "荣誉", "教育经历"),
    )
    if not section:
        return []
    items: list[str] = []
    for line in section.split("\n"):
        t = line.strip()
        if not t or t in ("语言能力", "技能") or t.startswith("---"):
            continue
        if t.startswith("语言能力"):
            t = t.split("：", 1)[-1].strip()
        if t:
            items.extend([x.strip() for x in re.split(r"[,，/、]", t) if x.strip()])
    return [{"group": "语言能力", "items": items}] if items else []


def parse_honors_section(text: str) -> list[dict]:
    section = _section_slice(
        text,
        ("附加信息", "荣誉", "证书"),
        ("声明", "操作时间"),
    )
    if not section:
        return []
    honors: list[dict] = []
    for line in section.split("\n"):
        t = line.strip()
        if not t or t in ("附加信息", "荣誉", "证书") or t.startswith("---"):
            continue
        if t.startswith("声明") or "招聘使用" in t:
            break
        dm = re.match(r"^(?P<date>\d{4}[./年]\d{1,2})\s*(?P<title>.+)$", t)
        if dm:
            honors.append({"title": dm.group("title").strip(), "date": dm.group("date"), "note": ""})
        elif t:
            honors.append({"title": t, "date": "", "note": ""})
    return honors


def parse_summary_section(text: str) -> list[str]:
    section = _section_slice(text, ("自我评价", "个人简介"), ("附加信息", "语言能力", "教育经历"))
    if not section:
        return []
    lines = []
    for line in section.split("\n"):
        t = line.strip()
        if not t or t in ("自我评价", "个人简介") or t.startswith("---"):
            continue
        lines.append(t)
    return lines


def extract_deterministic_resume(text: str) -> dict:
    """规则抽取：工作经历/项目/教育等，优先于 LLM。"""
    text = normalize_resume_layout((text or "").strip())
    exp = split_experience_windows(text)
    projects = split_project_windows(text)
    edu = parse_education_section(text)
    skills = parse_skills_section(text)
    honors = parse_honors_section(text)
    summary = parse_summary_section(text)
    basics = parse_basics_heuristic(text)
    return {
        "schema_version": 1,
        "template_id": "system-default",
        "module_order": list(DEFAULT_MODULE_ORDER),
        "basics": basics,
        "summary": {"bullets": summary},
        "experience": exp,
        "projects": projects,
        "education": edu,
        "skills": skills,
        "honors": honors,
        "needs_confirmation": [],
        "extras": {"extraction": "deterministic"},
    }


def _strip_deterministic_bodies_for_llm(text: str, det: dict) -> str:
    """给 LLM 的文本：去掉已规则归档的工作/项目正文。"""
    out = text
    if det.get("experience"):
        sec = _section_slice(
            out,
            ("工作经历", "工作/实习经历"),
            ("项目经历", "项目经验", "教育经历", "教育背景"),
        )
        if sec:
            idx = out.find("工作经历")
            if idx == -1:
                idx = out.find("工作/实习经历")
            if idx != -1:
                tail_start = idx + len(sec)
                lines = ["工作经历", "（工作经历已规则归档，experience 请置 []）"]
                for e in det["experience"]:
                    lines.append(
                        f"- {e.get('company', '')} | {e.get('title', '')} | "
                        f"{e.get('start', '')}-{e.get('end', '')}"
                    )
                out = out[:idx] + "\n".join(lines) + out[tail_start:]
    if det.get("projects"):
        out = _strip_project_bodies_for_llm(out, det["projects"])
    return out


def _merge_deterministic_precedence(det: dict, llm: dict | None) -> dict:
    """规则结果覆盖 LLM 的 experience/projects 等，避免串段。"""
    out: dict = dict(llm) if isinstance(llm, dict) else {}
    if det.get("basics"):
        lb = out.get("basics") if isinstance(out.get("basics"), dict) else {}
        merged = dict(lb)
        for k, v in det["basics"].items():
            if v:
                merged[k] = v
            elif k not in merged:
                merged[k] = v
        out["basics"] = merged
    for key in ("experience", "projects", "education", "skills", "honors"):
        if det.get(key):
            out[key] = det[key]
    if det.get("summary", {}).get("bullets"):
        out["summary"] = det["summary"]
    if not out.get("module_order"):
        out["module_order"] = list(DEFAULT_MODULE_ORDER)
    needs = list(det.get("needs_confirmation") or [])
    if needs:
        out["needs_confirmation"] = list(
            dict.fromkeys([*(out.get("needs_confirmation") or []), *needs])
        )
    out.setdefault("extras", {})["extraction"] = "deterministic+llm"
    return out


def _rough_project_blocks(text: str) -> list[tuple[str, str]]:
    """切窗失败时的弱回退：仍按日期行切块，供单项目 LLM。"""
    proj_start = text.find("项目经历")
    if proj_start == -1:
        proj_start = text.find("项目经验")
    if proj_start == -1:
        return []
    rest = text[proj_start:]
    end_pos = len(rest)
    for key in ("教育经历", "教育背景", "语言能力", "自我评价", "附加信息"):
        p = rest.find(key, 4)
        if p != -1:
            end_pos = min(end_pos, p)
    section = rest[:end_pos]
    lines = section.split("\n")
    headers: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = _PROJECT_HEADER_RE.match(line.strip())
        if m:
            headers.append((i, m.group("name").strip()))
    out: list[tuple[str, str]] = []
    for idx, (i, name) in enumerate(headers):
        next_i = headers[idx + 1][0] if idx + 1 < len(headers) else len(lines)
        block = "\n".join(lines[i:next_i]).strip()
        out.append((name, block))
    return out


# ---------------------------------------------------------------------------
# 多维度评分（LLM）
# ---------------------------------------------------------------------------
def score_resume_content(plain_text: str, structured: dict | None = None) -> dict:
    """调 LLM 按 resume_quality 整包量规评分，返回 quality_report。"""
    from resume_quality import score_resume_content as _score

    return _score(plain_text, structured)


# ---------------------------------------------------------------------------
# 智能批注（LLM）
# ---------------------------------------------------------------------------
def annotate_resume(plain_text: str, structured: dict | None = None) -> list[dict]:
    """调 LLM 逐段审阅，返回批注列表 [{id,title,body,severity,quote,section,suggestion}]。"""
    text = (plain_text or "").strip()[:8000]
    if len(text) < 40:
        return []
    require_llm_config()
    client = openai_client()
    try:
        resp = client.chat.completions.create(
            model=get_llm_model(),
            messages=[
                {"role": "system", "content": ANNOTATION_SYSTEM_PROMPT},
                {"role": "user", "content": f"请逐段审阅以下简历，找出具体问题并给出批注：\n\n{text}"},
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        annotations = data.get("annotations") or []
        if not isinstance(annotations, list):
            return []
        out = []
        for i, a in enumerate(annotations):
            if not isinstance(a, dict):
                continue
            severity = str(a.get("severity") or "info").strip()
            if severity not in ("error", "warning", "info"):
                severity = "info"
            out.append({
                "id": str(a.get("id") or f"a-{i + 1}"),
                "title": str(a.get("title") or "").strip(),
                "body": str(a.get("body") or "").strip(),
                "severity": severity,
                "quote": str(a.get("quote") or "").strip()[:120],
                "section": str(a.get("section") or "").strip(),
                "suggestion": str(a.get("suggestion") or a.get("fix") or "").strip(),
            })
        return out
    except Exception:
        return []


# ---------------------------------------------------------------------------
# 布局块抽取（规则兜底，LLM 优先时会由 prompt 输出 layout_blocks）
# ---------------------------------------------------------------------------
_SECTION_TITLE_NAMES = frozenset({
    "个人信息", "目前职业概况", "职业发展意向", "工作经历", "工作/实习经历",
    "项目经历", "项目经验", "教育经历", "教育背景", "语言能力", "自我评价",
    "个人简介", "附加信息", "技能", "荣誉", "证书", "专业技能",
    "求职意向", "联系方式",
})


def extract_layout_blocks(text_or_path: str) -> list[dict]:
    """从简历文本或PDF文件提取布局块。如果是PDF文件路径，使用 pymupdf 提取带样式的块。"""
    # 如果是 PDF 路径，用 pymupdf 样式提取
    if text_or_path.lower().endswith(".pdf"):
        try:
            styled = _extract_styled_layout_blocks(text_or_path)
            if styled:
                return styled
        except Exception:
            pass

    # 回退：文本行解析
    text = (text_or_path or "").strip()
    lines = text.split("\n")
    blocks: list[dict] = []
    i = 0
    while i < len(lines):
        t = lines[i].strip()
        if not t:
            i += 1
            continue

        # 页码
        if _PAGE_NOISE_RE.match(t) or t.startswith("---"):
            i += 1
            continue

        # section title
        if t in _SECTION_TITLE_NAMES:
            blocks.append({"type": "section_title", "text": t, "style": {"bold": True}, "children": []})
            i += 1
            continue

        # experience/project header: 日期 + 公司/项目名
        m = _EXP_HEADER_RE.match(t)
        if not m:
            m = _PROJECT_HEADER_RE.match(t)
        if m:
            blocks.append({"type": "item_header", "text": t, "style": {"bold": True}, "children": []})
            i += 1
            continue

        # bullet
        if re.match(r"^[\s]*[\d]+[)）.\s、]|^[\s]*[-•·●◆▶▸▪◦◾]", t):
            blocks.append({"type": "bullet", "text": t, "style": {}, "children": []})
            i += 1
            continue

        # 姓名行（第一行，纯短文本）
        if not blocks and len(t) <= 20 and re.match(r"^[一-鿿A-Za-z]+$", t):
            blocks.append({"type": "header", "text": t, "style": {"bold": True, "size": "large"}, "children": []})
            i += 1
            continue

        # 联系方式行（含电话/邮箱）
        if re.search(r"1[3-9]\d{9}|[\w.+-]+@[\w-]+\.[\w.]+", t) and len(t) <= 120:
            blocks.append({"type": "contact", "text": t, "style": {}, "children": []})
            i += 1
            continue

        # field label
        if re.search(rf"(?:{'|'.join(re.escape(x) for x in _LAYOUT_LABELS)})：", t):
            blocks.append({"type": "field_label", "text": t, "style": {}, "children": []})
            i += 1
            continue

        # 默认段落
        blocks.append({"type": "paragraph", "text": t, "style": {}, "children": []})
        i += 1

    return blocks


def structured_resume_plain_text(structured: dict) -> str:
    return structured_to_plain_text(structured)
