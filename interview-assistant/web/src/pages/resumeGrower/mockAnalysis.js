/** 纸面 = 简历完整原文；批注由后端 LLM 产出，前端仅做展示辅助 */

export function normalizeResumeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

const INVALID_LINE_RE =
  /水印|仅供.?预览|仅供.?参考|内部资料|机密文件|confidential|watermark|简历模板|超级简历|五百丁|乔布简历|简历本|稀饭简历|应届生求职网|扫码下载|点击下载完整|禁止商用|文档来自/i;
const PAGE_NOISE_RE =
  /^(第?\s*\d+\s*[页頁]|page\s*\d+(\s*\/\s*\d+)?|\d+\s*\/\s*\d+|[-–—]\s*\d+\s*[-–—])$/i;
const SYMBOL_ONLY_RE = /^[\s\-_=*·•|｜/\\~〜]+$/;

export function cleanResumeText(text) {
  const raw = normalizeResumeText(text);
  const lines = raw.split("\n");
  const shortCounts = new Map();
  for (const line of lines) {
    const t = line.trim();
    if (t && t.length <= 24) shortCounts.set(t, (shortCounts.get(t) || 0) + 1);
  }
  const cleaned = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { cleaned.push(""); continue; }
    if (SYMBOL_ONLY_RE.test(t)) continue;
    if (PAGE_NOISE_RE.test(t)) continue;
    if (INVALID_LINE_RE.test(t) && t.length <= 80) continue;
    if (t.length <= 24 && (shortCounts.get(t) || 0) >= 3) continue;
    cleaned.push(line.replace(/\s+$/, ""));
  }
  const out = [];
  let blank = 0;
  for (const line of cleaned) {
    if (!line.trim()) { blank += 1; if (blank <= 2) out.push(""); continue; }
    blank = 0;
    out.push(line);
  }
  return { cleaned: out.join("\n").trim(), raw };
}

function pickName(text, fileName) {
  const line = (text || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  if (line && line.length <= 20 && !/[.。：:]/.test(line)) return line;
  return (fileName || "未命名简历").replace(/\.pdf$/i, "");
}

function extractContact(text) {
  const email = (text || "").match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  const phone = (text || "").match(/1[3-9]\d{9}/);
  const parts = [];
  if (email) parts.push(email[0]);
  if (phone) parts.push(phone[0]);
  return parts.join(" · ");
}

/** 组装分析结果（兼容旧数据，新数据由后端 scoring/annotation 提供） */
export function buildAnalysis({ resumeText, fileName, assets, resumeTextRaw, skipClean }) {
  const rawSource = resumeTextRaw != null ? resumeTextRaw : resumeText;
  const { cleaned, raw } = skipClean
    ? { cleaned: normalizeResumeText(resumeText), raw: normalizeResumeText(rawSource || resumeText) }
    : cleanResumeText(resumeText || "");
  const fullText = cleaned;
  const paper = {
    mode: "full",
    fullText,
    name: pickName(fullText, fileName),
    contact: extractContact(fullText),
    highlights: [],
  };
  const score = fullText
    ? Math.min(92, Math.max(62, 68 + Math.min((assets || []).length, 10) * 2))
    : null;
  return { paper, annotations: [], score, rawText: raw, cleanedText: fullText };
}

export function buildProfileFromResume(resume) {
  const text = resume?.resumeText || resume?.paper?.fullText || "";
  const paper = resume?.paper || {};
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    name: paper.name || lines[0] || "未填写",
    city: "—",
    contact: paper.contact || "—",
    scenario: "社招",
    roleFamily: "待完善",
    education: lines.find((l) => /大学|学院|本科|硕士|学士/.test(l)) || "—",
    skills: lines.find((l) => /技能|熟悉|精通|掌握/.test(l))?.slice(0, 120) || "—",
    star: "从项目深挖同步 STAR 案例后展示",
  };
}

export const TEMPLATES = [
  { id: "classic", name: "经典居中", desc: "姓名居中 · 通用正式" },
  { id: "cn-formal", name: "中文正式", desc: "左对齐 · 紧凑章节底" },
  { id: "ats", name: "外企 ATS", desc: "无衬线 · 利于解析" },
  { id: "split", name: "分栏版", desc: "左教育技能 · 右经历" },
  { id: "guoqi", name: "国企正式", desc: "宋体 · 保守版式" },
];

/** 将全文按行渲染，并在命中处插入批注高亮 */
export function splitTextWithHighlights(fullText, highlights, activeAnno) {
  const text = fullText || "";
  if (!text) return [{ type: "text", value: "（未能提取到简历文本）" }];
  const sorted = [...(highlights || [])].sort((a, b) => a.start - b.start);
  const nodes = [];
  let cursor = 0;
  for (const h of sorted) {
    if (h.start < cursor || h.end > text.length) continue;
    if (h.start > cursor) nodes.push({ type: "text", value: text.slice(cursor, h.start) });
    nodes.push({ type: "hl", value: text.slice(h.start, h.end), annoId: h.id, active: activeAnno === h.id });
    cursor = h.end;
  }
  if (cursor < text.length) nodes.push({ type: "text", value: text.slice(cursor) });
  return nodes;
}
