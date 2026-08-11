import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api.js";
import {
  addJdMatchRecord,
  deleteJdMatchRecord,
  getJdMatchRecords,
  updateJdMatchRecord,
} from "./storage.js";
import { getResumePdf } from "./pdfStore.js";
import {
  buildAnnotationsFromStructured,
  hasUsableStructured,
  normalizeStructured,
  scoreStructured,
  structuredToPlainText,
  withSourceModuleOrder,
} from "./structuredResume.js";

function gradeLabel(g) {
  if (g === "A") return "A · Strong Fit";
  if (g === "C") return "C · Poor Fit";
  return "B · Stretch Fit";
}

function scoreLevelClass(level) {
  if (!level) return "b";
  if (level.includes("较高") || level.includes("高匹配")) return "a";
  if (level.includes("高风险") || level.includes("较低")) return "c";
  return "b";
}

function previewJd(text) {
  const t = (text || "").replace(/\s+/g, " ").trim();
  return t.length > 48 ? `${t.slice(0, 48)}…` : t || "（空 JD）";
}

function dimList(analysis) {
  if (Array.isArray(analysis?.dimensions) && analysis.dimensions.length) {
    return analysis.dimensions;
  }
  const ds = analysis?.dimension_scores || {};
  return Object.keys(ds).map((id) => {
    const d = ds[id] || {};
    return {
      id,
      name: d.label || id,
      score: d.score,
      weight: Math.round((Number(d.weight) || 0) * 100),
      detail: d.detail,
      highlights: [],
      gaps: [],
      suggestions: [],
    };
  });
}

function ResultView({ analysis }) {
  if (!analysis) return null;

  const isV2 = analysis.schema_version === 2 || analysis.overall_score != null || analysis.dimension_scores;
  const score = analysis.overall_score ?? analysis.score;
  const levelText = analysis.score_level || gradeLabel(analysis.grade);
  const dims = dimList(analysis);
  const jd = analysis.jd_parsed || {};
  const basic = jd.basic_info || {};
  const risks = jd.risks || [];
  const advantages = analysis.competitive_advantages || analysis.extra_strengths || [];
  const gaps = analysis.skill_gaps || [];
  const gapAnalysis = analysis.gap_analysis || {};
  const critical = gapAnalysis.critical_gaps || [];
  const minor = gapAnalysis.minor_gaps || [];
  const culture = analysis.culture_fit_detail || {};
  const cultureAnalysis = culture.analysis || {};
  const hardGate = analysis.hard_gate || {};

  return (
    <div className="rg-jdm-result">
      <div className="rg-jdm-hero">
        <div className="rg-jdm-score" aria-label={`总分 ${score ?? "—"}`}>
          <strong>{score ?? "—"}</strong>
          <span>/ 100</span>
        </div>
        <div className="rg-jdm-hero-body">
          <div className={`rg-jdm-grade g-${scoreLevelClass(levelText)}`}>
            {levelText}
            {analysis.level_band ? ` · ${analysis.level_band}档权重` : ""}
          </div>
          <p className="rg-jdm-summary">{analysis.summary || "暂无总结"}</p>
          {hardGate.high_risk && (
            <p className="rg-jdm-risk-flag">硬性门槛高风险：{(hardGate.notes || []).join("；") || "请谨慎投递"}</p>
          )}
        </div>
      </div>

      <section className="rg-jdm-sec">
        <header className="rg-jdm-sec-hd"><h4>各维度评分</h4></header>
        <div className="rg-jdm-dims">
          {dims.map((d) => (
            <div className="rg-jdm-dim" key={d.id || d.name}>
              <div className="rg-jdm-dim-hd">
                <span>{d.name}</span>
                <span className="rg-jdm-dim-score">
                  {d.score}
                  <em>权重 {d.weight}%</em>
                </span>
              </div>
              <div className="rg-bar">
                <i style={{ width: `${Math.min(100, Number(d.score) || 0)}%` }} />
              </div>
              {d.detail && <p className="muted rg-jdm-dim-detail">{d.detail}</p>}
              {d.highlights?.length > 0 && (
                <ul className="rg-jdm-ul ok">
                  {d.highlights.map((x, i) => (
                    <li key={`h${i}`}>{x}</li>
                  ))}
                </ul>
              )}
              {d.gaps?.length > 0 && (
                <ul className="rg-jdm-ul gap">
                  {d.gaps.map((x, i) => (
                    <li key={`g${i}`}>{x}</li>
                  ))}
                </ul>
              )}
              {d.suggestions?.length > 0 && (
                <ul className="rg-jdm-ul tip">
                  {d.suggestions.map((x, i) => (
                    <li key={`s${i}`}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {(basic.job_title || basic.company) && (
        <section className="rg-jdm-sec">
          <header className="rg-jdm-sec-hd"><h4>JD 解析摘要</h4></header>
          <p className="rg-jdm-basic">
            {[basic.job_title, basic.company, basic.level, basic.location, basic.salary_range]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {Array.isArray(jd.hard_requirements) && jd.hard_requirements.length > 0 && (
            <ul className="rg-jdm-ul tip">
              {jd.hard_requirements.slice(0, 6).map((h, i) => (
                <li key={i}>
                  <span className="rg-jdm-tag">{h.dimension || "硬性"}</span>
                  {h.requirement}
                  {h.is_must ? <em className="rg-jdm-must">必须</em> : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {risks.length > 0 && (
        <section className="rg-jdm-sec">
          <header className="rg-jdm-sec-hd"><h4>岗位风险筛查</h4></header>
          <div className="rg-jdm-opts">
            {risks.map((r, i) => (
              <div className={`rg-jdm-opt rg-jdm-opt-risk lv-${r.level === "高" ? "h" : r.level === "低" ? "l" : "m"}`} key={i}>
                <p className="rg-jdm-opt-hd">
                  <strong>{r.type || "风险"}</strong>
                  <span className={`rg-jdm-risk-lv lv-${r.level === "高" ? "h" : r.level === "低" ? "l" : "m"}`}>
                    {r.level || "中"}
                  </span>
                </p>
                <p>{r.description}</p>
                {r.suggestion && <p className="muted">建议：{r.suggestion}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rg-jdm-sec">
        <header className="rg-jdm-sec-hd"><h4>竞争优势与短板</h4></header>
        <div className="rg-jdm-gap-grid">
          <div className="rg-jdm-panel rg-jdm-panel-ok">
            <h5>竞争优势</h5>
            <ul className="rg-jdm-ul ok">
              {advantages.length
                ? advantages.map((x, i) => <li key={i}>{x}</li>)
                : <li className="muted">无</li>}
            </ul>
          </div>
          <div className="rg-jdm-panel rg-jdm-panel-gap">
            <h5>能力短板</h5>
            <ul className="rg-jdm-ul gap">
              {gaps.length
                ? gaps.map((x, i) => <li key={i}>{x}</li>)
                : <li className="muted">无</li>}
            </ul>
          </div>
        </div>
      </section>

      {(critical.length > 0 || minor.length > 0 || (!isV2 && (analysis.missing_critical || []).length > 0)) && (
        <section className="rg-jdm-sec">
          <header className="rg-jdm-sec-hd"><h4>差距分析与策略</h4></header>
          {critical.map((g, i) => (
            <div className="rg-jdm-opt rg-jdm-opt-critical" key={`c${i}`}>
              <p className="rg-jdm-opt-hd">
                <strong>关键差距</strong>
                <span className="rg-jdm-risk-lv lv-h">{g.priority || "高"}</span>
              </p>
              <p>{g.gap}</p>
              {g.strategy && <p className="ok">策略：{g.strategy}</p>}
            </div>
          ))}
          {minor.map((g, i) => (
            <div className="rg-jdm-opt rg-jdm-opt-minor" key={`m${i}`}>
              <p className="rg-jdm-opt-hd">
                <strong>次要差距</strong>
                <span className="rg-jdm-risk-lv lv-m">{g.priority || "中"}</span>
              </p>
              <p>{g.gap}</p>
              {g.strategy && <p className="ok">策略：{g.strategy}</p>}
            </div>
          ))}
          {!critical.length && !minor.length && (
            <div className="rg-jdm-gap-grid">
              <div className="rg-jdm-panel rg-jdm-panel-gap">
                <h5>JD 要求但简历缺失</h5>
                <ul className="rg-jdm-ul gap">
                  {(analysis.missing_critical || []).length
                    ? analysis.missing_critical.map((x, i) => <li key={i}>{x}</li>)
                    : <li className="muted">无</li>}
                </ul>
              </div>
              <div className="rg-jdm-panel rg-jdm-panel-ok">
                <h5>简历优势但 JD 未提</h5>
                <ul className="rg-jdm-ul ok">
                  {(analysis.extra_strengths || []).length
                    ? analysis.extra_strengths.map((x, i) => <li key={i}>{x}</li>)
                    : <li className="muted">无</li>}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      {(cultureAnalysis.suggestion || culture.culture_fit_score != null) && (
        <section className="rg-jdm-sec">
          <header className="rg-jdm-sec-hd"><h4>企业文化适配</h4></header>
          <div className="rg-jdm-culture">
            <p className="rg-jdm-culture-score">
              适配分
              <strong>{culture.culture_fit_score ?? analysis.dimension_scores?.culture_fit?.score ?? "—"}</strong>
            </p>
            {cultureAnalysis.jd_culture_signals?.length > 0 && (
              <p className="muted">JD 信号：{cultureAnalysis.jd_culture_signals.join("、")}</p>
            )}
            {cultureAnalysis.candidate_culture_signals?.length > 0 && (
              <p className="muted">候选人信号：{cultureAnalysis.candidate_culture_signals.join("、")}</p>
            )}
            {cultureAnalysis.alignment?.aligned?.length > 0 && (
              <p className="ok">契合：{cultureAnalysis.alignment.aligned.join("、")}</p>
            )}
            {cultureAnalysis.alignment?.potential_conflict?.length > 0 && (
              <p className="rg-jdm-risk-flag">潜在冲突：{cultureAnalysis.alignment.potential_conflict.join("、")}</p>
            )}
            {cultureAnalysis.suggestion && <p>{cultureAnalysis.suggestion}</p>}
          </div>
        </section>
      )}

      {(analysis.optimizations || []).length > 0 && (
        <section className="rg-jdm-sec">
          <header className="rg-jdm-sec-hd"><h4>优化建议</h4></header>
          <div className="rg-jdm-opts">
            {analysis.optimizations.map((o, i) => (
              <div className="rg-jdm-opt" key={i}>
                {o.original && (
                  <p className="rg-jdm-compare">
                    <span className="rg-jdm-k muted">原文</span>
                    <span>{o.original}</span>
                  </p>
                )}
                <p className="rg-jdm-compare">
                  <span className="rg-jdm-k ok">建议</span>
                  <span>
                    {o.suggested}
                    {o.needs_confirm ? " · 待确认" : ""}
                  </span>
                </p>
                {o.reason && <p className="muted">{o.reason}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function atsStatusClass(status) {
  if (status === "通过") return "ok";
  if (status === "不通过") return "bad";
  if (status === "警告") return "warn";
  return "mid";
}

function downloadBlob(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadPdfFromMarkdown(md, filename) {
  const [{ jsPDF }, html2canvasMod] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);
  const html2canvas = html2canvasMod.default;
  const el = document.createElement("div");
  el.style.cssText =
    "position:fixed;left:-9999px;top:0;width:794px;padding:40px;background:#fff;color:#111;" +
    "font:14px/1.65 'Segoe UI',system-ui,sans-serif;white-space:pre-wrap;word-break:break-word;";
  el.textContent = md || "";
  document.body.appendChild(el);
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;
    let heightLeft = imgH;
    let position = 0;
    pdf.addImage(img, "PNG", 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(img, "PNG", 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(filename);
  } finally {
    document.body.removeChild(el);
  }
}

function buildPlanConfirmations(plan) {
  const nextConfirm = {};
  (plan?.sections || []).forEach((s) => {
    if (s.change_type === "表达优化") nextConfirm[s.id] = "accepted";
    else if ((s.needs_confirmation || []).length) nextConfirm[s.id] = "pending";
    else nextConfirm[s.id] = "accepted";
  });
  return nextConfirm;
}

/** 三期：求职配套物料 */
function MaterialsPanel({ analysis, resumeText, saved, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mats = saved || null;
  const cl = mats?.cover_letter_guide || {};
  const intro = mats?.self_intro || {};
  const salary = mats?.salary_negotiation || {};

  async function run() {
    if (busy) return;
    if (!analysis) {
      setError("请先完成岗位匹配分析");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await api.generateJdMaterials({
        resume_text: resumeText,
        analysis,
      });
      onSaved({ materials: data.materials });
    } catch (e) {
      setError(e.message || "生成配套物料失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rg-jdm-sec rg-jdm-mats">
      <h4>求职配套物料</h4>
      <p className="muted">随「开始分析」自动生成；可在此重新生成。含求职信 / 自我介绍 / 面试追问 / 薪资谈判 / LinkedIn。</p>
      <div className="rg-jdm-actions">
        <button type="button" className="btn" disabled={busy || !analysis} onClick={run}>
          {busy ? "生成中…" : "重新生成配套物料"}
        </button>
      </div>
      {error && <p className="status-line">{error}</p>}
      {!mats && !busy && <p className="muted">暂无配套物料（开始分析时若失败可点上方重试）</p>}

      {mats && (
        <>
          {(cl.full_draft || (cl.structure || []).length > 0) && (
            <div className="rg-jdm-recon-block">
              <h5>求职信</h5>
              {cl.tone && (
                <p className="muted">
                  语气：{cl.tone} · 建议字数：{cl.word_count || "300-500字"}
                </p>
              )}
              {(cl.structure || []).length > 0 && (
                <ul className="rg-jdm-ul tip">
                  {cl.structure.map((s, i) => (
                    <li key={i}>
                      <strong>{s.section}</strong>：{s.point}
                      {s.template ? `（例：${s.template}）` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {cl.full_draft && <pre className="rg-jdm-md">{cl.full_draft}</pre>}
            </div>
          )}

          {(intro.one_minute || intro.three_minute) && (
            <div className="rg-jdm-recon-block">
              <h5>自我介绍</h5>
              {intro.one_minute && (
                <>
                  <p className="muted">1 分钟</p>
                  <pre className="rg-jdm-md">{intro.one_minute}</pre>
                </>
              )}
              {intro.three_minute && (
                <>
                  <p className="muted">3 分钟</p>
                  <pre className="rg-jdm-md">{intro.three_minute}</pre>
                </>
              )}
            </div>
          )}

          {(mats.interview_questions || []).length > 0 && (
            <div className="rg-jdm-recon-block">
              <h5>面试追问预判</h5>
              <div className="rg-jdm-opts">
                {mats.interview_questions.map((q, i) => (
                  <div className="rg-jdm-opt" key={i}>
                    <p>
                      <strong>Q</strong> {q.question}
                    </p>
                    {q.intent && <p className="muted">考察：{q.intent}</p>}
                    {q.answer_hint && <p className="ok">提示：{q.answer_hint}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {(salary.range_hint || (salary.talking_points || []).length > 0) && (
            <div className="rg-jdm-recon-block">
              <h5>薪资谈判参考</h5>
              {salary.range_hint && <p>{salary.range_hint}</p>}
              {(salary.talking_points || []).length > 0 && (
                <ul className="rg-jdm-ul tip">
                  {salary.talking_points.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              )}
              {(salary.cautions || []).length > 0 && (
                <ul className="rg-jdm-ul gap">
                  {salary.cautions.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {mats.linkedin_summary && (
            <div className="rg-jdm-recon-block">
              <h5>LinkedIn 摘要</h5>
              <pre className="rg-jdm-md">{mats.linkedin_summary}</pre>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** 三期：报告导出 */
function ExportPanel({ analysis, reconstruct, materials, resumeName }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function loadBundle(fmt = "both") {
    return api.exportJdReport({
      analysis,
      reconstruct,
      materials,
      resume_name: resumeName || "",
      format: fmt,
    });
  }

  async function exportMd() {
    if (busy) return;
    setBusy("md");
    setError("");
    try {
      const data = await loadBundle("markdown");
      downloadBlob(
        `岗位匹配报告-${resumeName || "resume"}.md`,
        data.report_markdown || "",
        "text/markdown;charset=utf-8"
      );
    } catch (e) {
      setError(e.message || "导出失败");
    } finally {
      setBusy("");
    }
  }

  async function exportJson() {
    if (busy) return;
    setBusy("json");
    setError("");
    try {
      const data = await loadBundle("json");
      downloadBlob(
        `岗位匹配报告-${resumeName || "resume"}.json`,
        JSON.stringify(data.report_json || {}, null, 2),
        "application/json;charset=utf-8"
      );
    } catch (e) {
      setError(e.message || "导出失败");
    } finally {
      setBusy("");
    }
  }

  async function exportPdf() {
    if (busy) return;
    setBusy("pdf");
    setError("");
    try {
      const data = await loadBundle("markdown");
      await downloadPdfFromMarkdown(
        data.report_markdown || "",
        `岗位匹配报告-${resumeName || "resume"}.pdf`
      );
    } catch (e) {
      setError(e.message || "导出 PDF 失败");
    } finally {
      setBusy("");
    }
  }

  function exportOptimizedMd() {
    const md = reconstruct?.optimized_resume_md || "";
    if (!md) {
      setError("尚未生成优化版简历，请先在二期确认并生成");
      return;
    }
    downloadBlob(
      `优化版简历-${resumeName || "resume"}.md`,
      md,
      "text/markdown;charset=utf-8"
    );
  }

  return (
    <section className="rg-jdm-sec rg-jdm-export">
      <h4>分析报告导出（三期）</h4>
      <p className="muted">Markdown / JSON / PDF；优化版简历可另存为 Markdown（可用 Word 打开编辑）</p>
      <div className="rg-jdm-actions">
        <button type="button" className="btn" disabled={!!busy} onClick={exportMd}>
          {busy === "md" ? "导出中…" : "下载 Markdown"}
        </button>
        <button type="button" className="btn" disabled={!!busy} onClick={exportJson}>
          {busy === "json" ? "导出中…" : "下载 JSON"}
        </button>
        <button type="button" className="btn" disabled={!!busy} onClick={exportPdf}>
          {busy === "pdf" ? "生成 PDF…" : "下载 PDF"}
        </button>
        <button type="button" className="btn" disabled={!!busy} onClick={exportOptimizedMd}>
          下载优化版简历
        </button>
      </div>
      {error && <p className="status-line">{error}</p>}
    </section>
  );
}

/** 二期：经历优先级 / 优化方案确认 / ATS / 生成优化简历 */
function ReconstructPanel({
  analysis,
  resumeText,
  structured,
  resumeMeta,
  saved,
  onSaved,
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmations, setConfirmations] = useState(() => saved?.confirmations || {});

  const tiers = saved?.experience_priority?.tiers || [];
  const plan = saved?.optimization_plan || null;
  const ats = saved?.ats || null;
  const optimizedMd = saved?.optimized_resume_md || "";
  const changeLog = saved?.change_log || [];

  useEffect(() => {
    setConfirmations(saved?.confirmations || {});
  }, [saved?.confirmations, saved?.optimization_plan]);

  async function runReconstruct() {
    if (busy) return;
    if (!analysis?.jd_parsed) {
      setError("当前记录缺少 JD 解析结果，请重新做一次岗位匹配分析");
      return;
    }
    setBusy("reconstruct");
    setError("");
    try {
      const data = await api.reconstructJdMatch({
        resume_text: resumeText,
        analysis,
        structured,
        context: {
          file_format: resumeMeta?.hasPdf ? "PDF" : "文本",
          resume_name: resumeMeta?.name || "",
        },
      });
      const nextConfirm = buildPlanConfirmations(data.optimization_plan);
      setConfirmations(nextConfirm);
      onSaved({
        experience_priority: data.experience_priority,
        optimization_plan: data.optimization_plan,
        ats: data.ats,
        confirmations: nextConfirm,
        optimized_resume_md: "",
        change_log: [],
      });
    } catch (e) {
      setError(e.message || "生成优化方案失败");
    } finally {
      setBusy("");
    }
  }

  async function runApply() {
    if (busy || !plan) return;
    setBusy("apply");
    setError("");
    try {
      const data = await api.applyJdOptimize({
        resume_text: resumeText,
        optimization_plan: plan,
        confirmations,
      });
      onSaved({
        confirmations,
        optimized_resume_md: data.optimized_resume_md,
        change_log: data.change_log || [],
      });
    } catch (e) {
      setError(e.message || "生成优化简历失败");
    } finally {
      setBusy("");
    }
  }

  function setConf(id, status) {
    setConfirmations((prev) => ({ ...prev, [id]: status }));
  }

  function copyMd() {
    if (!optimizedMd) return;
    navigator.clipboard?.writeText(optimizedMd).catch(() => {});
  }

  return (
    <section className="rg-jdm-sec rg-jdm-recon">
      <h4>简历重构与 ATS</h4>
      <p className="muted">
        经历优先级 / 优化方案 / ATS 随「开始分析」自动生成；确认事实补充后可生成优化版简历。
      </p>
      <div className="rg-jdm-actions">
        <button
          type="button"
          className="btn"
          disabled={!!busy || !analysis?.jd_parsed}
          onClick={runReconstruct}
        >
          {busy === "reconstruct" ? "生成中…" : "重新生成优化方案"}
        </button>
      </div>
      {error && <p className="status-line">{error}</p>}
      {!plan && !ats && !tiers.length && !busy && (
        <p className="muted">暂无重构结果（开始分析时若失败可点上方重试）</p>
      )}
      {tiers.length > 0 && (
        <div className="rg-jdm-recon-block">
          <h5>经历优先级</h5>
          {saved?.experience_priority?.summary && (
            <p className="muted">{saved.experience_priority.summary}</p>
          )}
          <ul className="rg-jdm-tier-list">
            {tiers.map((t) => (
              <li key={t.id} className={`tier-${t.tier === "第一梯队" ? "1" : t.tier === "第二梯队" ? "2" : t.tier === "建议隐藏" ? "h" : "3"}`}>
                <strong>{t.tier}</strong>
                <span>{[t.company, t.title].filter(Boolean).join(" · ") || t.id}</span>
                <em>{t.priority_score}分</em>
                {t.reason && <p className="muted">{t.reason}</p>}
                {t.display_advice && <p className="ok">{t.display_advice}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ats && (
        <div className="rg-jdm-recon-block">
          <h5>ATS 检测 · {ats.ats_score}/100</h5>
          <div className="rg-jdm-opts">
            {(ats.checks || []).map((c, i) => (
              <div className="rg-jdm-opt" key={i}>
                <p>
                  <strong>{c.item}</strong>
                  <span className={`rg-jdm-ats-st ${atsStatusClass(c.status)}`}>{c.status}</span>
                </p>
                <p>{c.detail}</p>
                {c.suggestion && <p className="muted">建议：{c.suggestion}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan && (
        <div className="rg-jdm-recon-block">
          <h5>优化方案</h5>
          {plan.strategy_summary && <p>{plan.strategy_summary}</p>}
          <div className="rg-jdm-opts">
            {(plan.sections || []).map((s) => (
              <div className="rg-jdm-opt" key={s.id}>
                <p>
                  <strong>{s.section}</strong>
                  <span className="rg-jdm-chip">{s.change_type}</span>
                </p>
                {s.original && (
                  <p className="rg-jdm-compare">
                    <span className="rg-jdm-k muted">原文</span>
                    <span>{s.original}</span>
                  </p>
                )}
                <p className="rg-jdm-compare">
                  <span className="rg-jdm-k ok">优化</span>
                  <span>{s.optimized}</span>
                </p>
                {s.reason && <p className="muted">{s.reason}</p>}
                {(s.needs_confirmation || []).length > 0 && (
                  <div className="rg-jdm-confirm">
                    <p className="rg-jdm-risk-flag">需确认事实：</p>
                    <ul>
                      {s.needs_confirmation.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                    <div className="rg-jdm-confirm-btns">
                      <button
                        type="button"
                        className={`btn small${confirmations[s.id] === "accepted" ? " primary" : ""}`}
                        onClick={() => setConf(s.id, "accepted")}
                      >
                        采纳
                      </button>
                      <button
                        type="button"
                        className={`btn small${confirmations[s.id] === "rejected" ? " primary" : ""}`}
                        onClick={() => setConf(s.id, "rejected")}
                      >
                        拒绝
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="rg-jdm-actions">
            <button type="button" className="btn primary" disabled={!!busy} onClick={runApply}>
              {busy === "apply" ? "生成优化版简历中…" : "确认并生成优化版简历"}
            </button>
          </div>
        </div>
      )}

      {optimizedMd && (
        <div className="rg-jdm-recon-block">
          <h5>优化版简历（Markdown）</h5>
          <div className="rg-jdm-actions">
            <button type="button" className="btn small" onClick={copyMd}>复制全文</button>
          </div>
          <pre className="rg-jdm-md">{optimizedMd}</pre>
          {changeLog.length > 0 && (
            <>
              <h5>逐条修改说明</h5>
              <ul className="rg-jdm-ul tip">
                {changeLog.map((c, i) => (
                  <li key={i}>
                    <strong>{c.section}</strong>
                    {c.note ? `：${c.note}` : ""}
                    {c.after ? ` → ${c.after}` : ""}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function JdMatchTab({ resume, onBack, onPatch }) {
  const resumeId = resume?.id;
  const [records, setRecords] = useState(() => getJdMatchRecords(resumeId));
  const [activeId, setActiveId] = useState(() => getJdMatchRecords(resumeId)[0]?.id || "");
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [running, setRunning] = useState(false);
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [error, setError] = useState("");
  const [resultTab, setResultTab] = useState("match"); // match | reconstruct | materials
  const [parsedBundle, setParsedBundle] = useState(null); // { structured, resumeText } 本页临时解析结果
  const [progressHint, setProgressHint] = useState("正在快马加鞭分析中，稍等片刻");
  const analyzeAbortRef = useRef(null);

  const active = useMemo(
    () => records.find((r) => r.id === activeId) || null,
    [records, activeId]
  );

  const structured = useMemo(() => {
    if (parsedBundle?.structured) return normalizeStructured(parsedBundle.structured);
    return normalizeStructured(resume?.structured);
  }, [resume, parsedBundle]);

  const resumeText = useMemo(() => {
    if (parsedBundle?.resumeText) return parsedBundle.resumeText;
    return structuredToPlainText(structured) || resume?.resumeText || resume?.rawText || "";
  }, [resume, structured, parsedBundle]);

  useEffect(() => {
    setParsedBundle(null);
  }, [resumeId]);

  useEffect(() => () => {
    analyzeAbortRef.current?.abort();
  }, []);

  function handleCancelAnalyze() {
    analyzeAbortRef.current?.abort();
    analyzeAbortRef.current = null;
    setRunning(false);
    setError("");
  }

  /** 优先上一层分析结果；无可用内容则本页解析 */
  async function ensureResumePayload(signal) {
    if (hasUsableStructured(resume?.structured)) {
      const s = normalizeStructured(resume.structured);
      const text =
        structuredToPlainText(s) || resume?.resumeText || resume?.rawText || "";
      if (!text.trim()) {
        throw new Error("简历分析结果无正文，请回到上一层重新分析");
      }
      return { structured: s, resumeText: text, from: "parent" };
    }
    if (parsedBundle && hasUsableStructured(parsedBundle.structured) && parsedBundle.resumeText?.trim()) {
      return {
        structured: normalizeStructured(parsedBundle.structured),
        resumeText: parsedBundle.resumeText,
        from: "local",
      };
    }

    let nextStructured = null;
    let plain = "";
    let resumeTextRaw = "";

    if (resume?.hasPdf) {
      const blob = await getResumePdf(resume.id);
      if (signal?.aborted) return null;
      if (!blob) throw new Error("未找到原 PDF，请回到上一层重新上传后再分析");
      const file = new File([blob], resume.name || "resume.pdf", {
        type: blob.type || "application/pdf",
      });
      const data = await api.uploadFile(file, { signal });
      if (signal?.aborted) return null;
      if (data.error) throw new Error(data.error);
      resumeTextRaw = data.resume_text_raw || data.resume_text || "";
      nextStructured = withSourceModuleOrder(normalizeStructured(data.structured), "upload");
      plain = structuredToPlainText(nextStructured) || resumeTextRaw;
      const ann =
        Array.isArray(data.structured?.annotations) && data.structured.annotations.length
          ? data.structured.annotations
          : buildAnnotationsFromStructured(nextStructured);
      onPatch?.({
        ...resume,
        resumeText: plain,
        rawText: resumeTextRaw,
        structured: nextStructured,
        assets: data.assets || resume?.assets || [],
        score: scoreStructured(nextStructured, nextStructured),
        annotations: ann,
        analyzed: true,
        updated: new Date().toISOString().slice(0, 10),
        analyzing: false,
      });
    } else {
      const seed = (resume?.resumeText || resume?.rawText || "").trim();
      if (!seed) {
        throw new Error("暂无可用简历内容，请先在上一层完成简历分析或重新上传 PDF");
      }
      const data = await api.uploadText(seed, { signal });
      if (signal?.aborted) return null;
      if (data.error) throw new Error(data.error);
      const incoming = normalizeStructured(data.structured);
      nextStructured = withSourceModuleOrder(
        {
          ...normalizeStructured(resume?.structured),
          ...(incoming || {}),
        },
        "upload"
      );
      plain = structuredToPlainText(nextStructured) || seed;
      resumeTextRaw = data.resume_text_raw || data.resume_text || seed;
      const ann =
        Array.isArray(incoming?.annotations) && incoming.annotations.length
          ? incoming.annotations
          : buildAnnotationsFromStructured(nextStructured);
      onPatch?.({
        ...resume,
        structured: nextStructured,
        resumeText: plain,
        rawText: resumeTextRaw,
        score: scoreStructured(nextStructured, nextStructured),
        annotations: ann,
        analyzed: true,
        updated: new Date().toISOString().slice(0, 10),
        analyzing: false,
      });
    }

    if (!plain.trim()) throw new Error("简历解析后仍无正文，无法做岗位匹配");
    const bundle = { structured: nextStructured, resumeText: plain };
    setParsedBundle(bundle);
    return { ...bundle, from: "parsed" };
  }

  async function fetchJdUrl() {
    if (fetchingUrl || running) return;
    const url = jdUrl.trim();
    if (!url) {
      setError("请先填写招聘页 URL");
      return;
    }
    setFetchingUrl(true);
    setError("");
    try {
      const data = await api.fetchJdFromUrl({ url });
      const text = (data.jd_text || "").trim();
      if (!text) throw new Error(data.notes || "未能提取 JD");
      const head = [data.job_title, data.company].filter(Boolean).join(" · ");
      setJdText(head ? `${head}\n\n${text}` : text);
      if (data.notes) setError(`已提取 JD。备注：${data.notes}`);
    } catch (e) {
      setError(e.message || "抓取 JD 失败");
    } finally {
      setFetchingUrl(false);
    }
  }

  async function runAnalyze() {
    if (running) return;
    const jd = jdText.trim();
    if (!jd) {
      setError("请先粘贴岗位 JD，或从链接提取");
      return;
    }
    const ac = new AbortController();
    analyzeAbortRef.current = ac;
    setRunning(true);
    setError("");
    setProgressHint("正在准备简历内容…");
    try {
      const payload = await ensureResumePayload(ac.signal);
      if (!payload || ac.signal.aborted) return;

      setProgressHint("正在做岗位匹配分析…");
      const data = await api.analyzeJdMatch(
        {
          resume_text: payload.resumeText,
          jd_text: jd,
          structured: payload.structured,
        },
        { signal: ac.signal }
      );
      if (ac.signal.aborted) return;
      const analysis = data.analysis;
      if (!analysis) throw new Error("未返回分析结果");

      setProgressHint("正在并行生成简历重构与配套物料…");
      const [reconRes, matsRes] = await Promise.allSettled([
        api.reconstructJdMatch(
          {
            resume_text: payload.resumeText,
            analysis,
            structured: payload.structured,
            context: {
              file_format: resume?.hasPdf ? "PDF" : "文本",
              resume_name: resume?.name || "",
            },
          },
          { signal: ac.signal }
        ),
        api.generateJdMaterials(
          {
            resume_text: payload.resumeText,
            analysis,
          },
          { signal: ac.signal }
        ),
      ]);
      if (ac.signal.aborted) return;

      const record = {
        jdText: jd,
        jdPreview: previewJd(jd),
        analysis,
        sourceUrl: jdUrl.trim() || undefined,
        optimized_resume_md: "",
        change_log: [],
      };
      const partialErrors = [];

      if (reconRes.status === "fulfilled") {
        const recon = reconRes.value;
        const nextConfirm = buildPlanConfirmations(recon.optimization_plan);
        record.experience_priority = recon.experience_priority;
        record.optimization_plan = recon.optimization_plan;
        record.ats = recon.ats;
        record.confirmations = nextConfirm;
      } else {
        const reason = reconRes.reason;
        if (reason?.name === "AbortError") return;
        partialErrors.push(`简历重构：${reason?.message || "失败"}`);
      }

      if (matsRes.status === "fulfilled") {
        record.materials = matsRes.value.materials;
      } else {
        const reason = matsRes.reason;
        if (reason?.name === "AbortError") return;
        partialErrors.push(`配套物料：${reason?.message || "失败"}`);
      }

      const saved = addJdMatchRecord(resumeId, record);
      const next = getJdMatchRecords(resumeId);
      setRecords(next);
      setActiveId(saved.id);
      setResultTab("match");
      setJdText("");
      setJdUrl("");
      if (partialErrors.length) {
        setError(`匹配已完成，部分步骤失败：${partialErrors.join("；")}（可在对应 Tab 重试）`);
      }
    } catch (e) {
      if (e?.name === "AbortError" || ac.signal.aborted) return;
      setError(e.message || "分析失败");
    } finally {
      if (analyzeAbortRef.current === ac) {
        analyzeAbortRef.current = null;
        setRunning(false);
        setProgressHint("正在快马加鞭分析中，稍等片刻");
      }
    }
  }

  function handleDelete(id, e) {
    e.stopPropagation();
    const next = deleteJdMatchRecord(resumeId, id);
    setRecords(next);
    if (activeId === id) {
      setActiveId(next[0]?.id || "");
      setResultTab("match");
    }
  }

  function startNew() {
    setActiveId("");
    setError("");
    setResultTab("match");
  }

  function selectRecord(id) {
    setActiveId(id);
    setResultTab("match");
    setError("");
  }

  function patchActive(patch) {
    const next = updateJdMatchRecord(resumeId, activeId, patch);
    setRecords(next);
  }

  return (
    <div className="rg-jdm-page">
      {running && (
        <div
          className="rg-analyze-mask rg-jdm-analyze-mask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rg-jdm-analyze-title"
        >
          <div className="rg-analyze-modal">
            <div className="rg-analyze-spinner" aria-hidden="true" />
            <h3 id="rg-jdm-analyze-title">岗位匹配分析</h3>
            <p>{progressHint}</p>
            <button type="button" className="rg-tb-btn" onClick={handleCancelAnalyze}>
              取消分析
            </button>
          </div>
        </div>
      )}

      <header className="rg-jdm-top">
        <button type="button" className="btn ghost" onClick={onBack}>
          ← 返回简历
        </button>
        <div>
          <h2>岗位匹配度分析</h2>
          <p className="muted">{resume?.name || "未命名简历"}</p>
        </div>
        <button type="button" className="btn" onClick={startNew}>
          新建分析
        </button>
      </header>

      <div className="rg-jdm-layout">
        <aside className="rg-jdm-hist card">
          <h3>历史记录</h3>
          {records.length === 0 && <p className="muted">暂无记录</p>}
          <ul className="rg-jdm-hist-list">
            {records.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={`rg-jdm-hist-item${activeId === r.id ? " active" : ""}`}
                  onClick={() => selectRecord(r.id)}
                >
                  <strong>
                    {r.analysis?.overall_score ?? r.analysis?.score ?? "—"}分
                    {" · "}
                    {r.analysis?.score_level || r.analysis?.grade || "—"}
                  </strong>
                  <span>{r.jdPreview || previewJd(r.jdText)}</span>
                  <em>{r.createdAt}</em>
                </button>
                <button
                  type="button"
                  className="rg-jdm-hist-del"
                  title="删除"
                  onClick={(e) => handleDelete(r.id, e)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rg-jdm-main card">
          {!activeId && (
            <>
              <label className="rg-jdm-label">从招聘链接提取 JD（可选）</label>
              <div className="rg-jdm-url-row">
                <input
                  className="rg-jdm-url-input"
                  type="url"
                  placeholder="https://…"
                  value={jdUrl}
                  onChange={(e) => setJdUrl(e.target.value)}
                  disabled={running || fetchingUrl}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={running || fetchingUrl}
                  onClick={fetchJdUrl}
                >
                  {fetchingUrl ? "提取中…" : "提取 JD"}
                </button>
              </div>
              <label className="rg-jdm-label">粘贴岗位 JD</label>
              <textarea
                className="rg-jdm-textarea"
                rows={12}
                placeholder="把完整职位描述粘贴到这里，或先用上方链接提取…"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                disabled={running || fetchingUrl}
              />
              <div className="rg-jdm-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={runAnalyze}
                  disabled={running || fetchingUrl}
                >
                  开始分析
                </button>
                {error && <p className="status-line">{error}</p>}
              </div>
            </>
          )}

          {activeId && active && (
            <>
              <div className="rg-jdm-meta">
                <span>{active.createdAt}</span>
                <button type="button" className="btn small" onClick={startNew}>
                  再分析一份
                </button>
              </div>
              {error && <p className="status-line">{error}</p>}
              <details className="rg-jdm-jd">
                <summary>本次 JD</summary>
                <pre>{active.jdText}</pre>
              </details>
              <div className="rg-jdm-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultTab === "match"}
                  className={resultTab === "match" ? "active" : ""}
                  onClick={() => setResultTab("match")}
                >
                  匹配分析
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultTab === "reconstruct"}
                  className={resultTab === "reconstruct" ? "active" : ""}
                  onClick={() => setResultTab("reconstruct")}
                >
                  简历重构
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={resultTab === "materials"}
                  className={resultTab === "materials" ? "active" : ""}
                  onClick={() => setResultTab("materials")}
                >
                  配套与导出
                </button>
              </div>
              <div className="rg-jdm-tab-panel">
                {resultTab === "match" && <ResultView analysis={active.analysis} />}
                {resultTab === "reconstruct" && (
                  <ReconstructPanel
                    analysis={active.analysis}
                    resumeText={resumeText}
                    structured={structured}
                    resumeMeta={resume}
                    saved={{
                      experience_priority: active.experience_priority,
                      optimization_plan: active.optimization_plan,
                      ats: active.ats,
                      confirmations: active.confirmations,
                      optimized_resume_md: active.optimized_resume_md,
                      change_log: active.change_log,
                    }}
                    onSaved={patchActive}
                  />
                )}
                {resultTab === "materials" && (
                  <>
                    <MaterialsPanel
                      analysis={active.analysis}
                      resumeText={resumeText}
                      saved={active.materials || null}
                      onSaved={patchActive}
                    />
                    <ExportPanel
                      analysis={active.analysis}
                      reconstruct={{
                        experience_priority: active.experience_priority,
                        optimization_plan: active.optimization_plan,
                        ats: active.ats,
                        optimized_resume_md: active.optimized_resume_md,
                        change_log: active.change_log,
                      }}
                      materials={active.materials || null}
                      resumeName={resume?.name || ""}
                    />
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
