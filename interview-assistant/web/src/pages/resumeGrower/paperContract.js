/**
 * 简历养成记 · 路径 C 数据契约
 *
 * paper（编辑/预览主路径）
 *   mode: "structured" | "pdf"
 *   - structured：默认纸面（规则结构化 + 工作台编辑）
 *   - pdf：原件只读对照（IndexedDB blob）
 *
 * analysis / structured（分析层；规则优先，LLM 不覆盖原文模块）
 *   structured / score / annotations / needs_confirmation
 *
 * storage
 *   localStorage resume_grower_v1.resumes[]：元数据 + structured
 *   IndexedDB resume_grower_pdf_v1.pdfs[id]：原 PDF Blob（对照用）
 */
export const PAPER_MODE_PDF = "pdf";
export const PAPER_MODE_STRUCTURED = "structured";

export function defaultPaperPdf() {
  return { mode: PAPER_MODE_PDF, source: "original" };
}

export function defaultPaperStructured() {
  return { mode: PAPER_MODE_STRUCTURED, template_id: "system-default" };
}
