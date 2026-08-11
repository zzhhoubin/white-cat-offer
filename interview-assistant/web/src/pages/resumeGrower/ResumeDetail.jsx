import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "../../api.js";
import PdfPaper from "./PdfPaper.jsx";
import { getResumePdf } from "./pdfStore.js";
import {
  buildAnnotationsFromStructured,
  getQualityReport,
  getScoreDetail,
  gradeFromTotal,
  groupAnnotationsBySeverity,
  normalizeStructured,
  SCORE_DIMENSIONS,
  SCORE_TOTAL_MAX,
  scoreStructured,
  structuredToPlainText,
  withSourceModuleOrder,
} from "./structuredResume.js";

/** 批注严重程度样式 */
function annoSeverityStyle(sev) {
  const map = {
    error: { color: "#dc2626", bg: "#fef2f2", badge: "硬伤" },
    warning: { color: "#f59e0b", bg: "#fffbeb", badge: "优化" },
    info: { color: "#2563eb", bg: "#eff6ff", badge: "建议" },
  };
  return map[sev] || map.info;
}

/** 维分展示：限制在满分内；若为百分制则折算 */
function dimScore(dim, max, fallback = 0) {
  let n = 0;
  if (dim && typeof dim === "object") n = Number(dim.score);
  else if (dim != null && dim !== "") n = Number(dim);
  else n = Number(fallback) || 0;
  if (!Number.isFinite(n) || n < 0) n = 0;
  if (n > max && n <= 100) n = Math.round((n / 100) * max);
  return Math.max(0, Math.min(max, Math.round(n)));
}
function ScoreRadar({ dimensions }) {
  const size = 168;
  const cx = size / 2;
  const cy = size / 2;
  const r = 58;
  const n = SCORE_DIMENSIONS.length;

  const pts = SCORE_DIMENSIONS.map((d, i) => {
    const score = dimScore(dimensions?.[d.id], d.max);
    const ratio = Math.max(0, Math.min(1, score / (d.max || 1)));
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return {
      x: cx + Math.cos(ang) * r * ratio,
      y: cy + Math.sin(ang) * r * ratio,
      lx: cx + Math.cos(ang) * (r + 18),
      ly: cy + Math.sin(ang) * (r + 18),
      label: d.label.replace(/与/, "\n与"),
      short: d.label.slice(0, 2),
    };
  });

  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const grid = [0.33, 0.66, 1].map((ratio) =>
    SCORE_DIMENSIONS.map((_, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return `${cx + Math.cos(ang) * r * ratio},${cy + Math.sin(ang) * r * ratio}`;
    }).join(" ")
  );

  return (
    <svg className="rg-radar" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      {grid.map((g, i) => (
        <polygon key={i} points={g} fill="none" stroke="#e2e8f0" strokeWidth="1" />
      ))}
      {SCORE_DIMENSIONS.map((_, i) => {
        const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return (
          <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(ang) * r} y2={cy + Math.sin(ang) * r}
            stroke="#e2e8f0" strokeWidth="1" />
        );
      })}
      <polygon points={poly} fill="rgba(47,125,88,0.25)" stroke="#2f7d58" strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="2.5" fill="#2f7d58" />
          <text x={p.lx} y={p.ly} textAnchor="middle" dominantBaseline="middle" className="rg-radar-label">
            {SCORE_DIMENSIONS[i].label.length > 4 ? SCORE_DIMENSIONS[i].label.slice(0, 2) : SCORE_DIMENSIONS[i].label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** 报告正文（摘要/全文共用） */
function QualityReportBody({ report, detail }) {
  const dims = report?.dimensions || {};
  const strengths = report?.top_strengths || [];
  const actions = report?.action_items || [];
  const bonusItems = report?.bonus_items || [];
  const penaltyItems = report?.penalty_items || [];

  return (
    <div className="rg-qr-body">
      {SCORE_DIMENSIONS.map((d) => {
        const raw = dims[d.id];
        const dim = raw && typeof raw === "object" ? raw : {};
        const score = dimScore(raw && typeof raw === "object" ? raw : raw, d.max, detail?.dimensions?.[d.id]);
        const evidence = Array.isArray(dim.evidence) ? dim.evidence : [];
        const suggestions = Array.isArray(dim.suggestions) ? dim.suggestions : [];
        const level = dim.level || "";
        return (
          <section key={d.id} className="rg-qr-dim">
            <h4>{d.label} <span>{score}/{d.max}</span> {level ? `· ${level}` : ""}</h4>
            {evidence.length > 0 && (
              <ul className="rg-qr-list">
                {evidence.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
            {suggestions.length > 0 && (
              <ul className="rg-qr-list rg-qr-suggest">
                {suggestions.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </section>
        );
      })}

      {(bonusItems.length > 0 || penaltyItems.length > 0) && (
        <section className="rg-qr-dim">
          <h4>加分 / 扣分明细</h4>
          {bonusItems.map((it, i) => (
            <p key={`b-${i}`} className="rg-qr-adj">+{it.points} {it.name}{it.evidence ? `：${it.evidence}` : ""}</p>
          ))}
          {penaltyItems.map((it, i) => (
            <p key={`p-${i}`} className="rg-qr-adj rg-qr-penalty">−{it.points} {it.name}{it.evidence ? `：${it.evidence}` : ""}</p>
          ))}
        </section>
      )}

      {strengths.length > 0 && (
        <section className="rg-qr-dim">
          <h4>TOP 优势</h4>
          <ol className="rg-qr-ol">{strengths.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </section>
      )}

      {actions.length > 0 && (
        <section className="rg-qr-dim">
          <h4>具体修改建议</h4>
          <ol className="rg-qr-ol">{actions.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </section>
      )}
    </div>
  );
}

/** ---- 书写质量报告面板（雷达 + 摘要折叠 + 全文弹层）---- */
function QualityReportPanel({ structured }) {
  const detail = getScoreDetail(structured);
  const report = getQualityReport(structured);
  const total = detail ? detail.total : scoreStructured(structured);
  const grade = detail?.grade || report?.grade || gradeFromTotal(total);
  const hasReport = Boolean(report?.dimensions || (detail?.dimensions && Object.keys(detail.dimensions).length));
  const dimsForRadar = report?.dimensions || detail?.dimensions || {};
  const summaryRef = useRef(null);
  const [overflow, setOverflow] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);

  useEffect(() => {
    const el = summaryRef.current;
    if (!el) {
      setOverflow(false);
      return;
    }
    const check = () => setOverflow(el.scrollHeight > el.clientHeight + 4);
    check();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [report, detail, structured]);

  useEffect(() => {
    if (!fullOpen) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setFullOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullOpen]);

  const bonus = report?.bonus ?? detail?.bonus ?? 0;
  const penalty = report?.penalty ?? detail?.penalty ?? 0;

  return (
    <div className="rg-score-panel rg-qr-panel">
      <div className="rg-qr-compact">
        <div className="rg-score-header">
          <div className="rg-score-big">{total}</div>
          <div className="rg-score-byline">{grade} · {total}/{SCORE_TOTAL_MAX}</div>
          {(bonus > 0 || penalty > 0) && (
            <div className="rg-score-adj">
              {bonus > 0 ? <span className="plus">+{bonus}</span> : null}
              {penalty > 0 ? <span className="minus">−{penalty}</span> : null}
            </div>
          )}
        </div>
        {hasReport && <ScoreRadar dimensions={dimsForRadar} />}
      </div>

      {(report?.summary || detail?.summary) && (
        <div className="rg-score-summary">{report?.summary || detail?.summary}</div>
      )}
      {!hasReport && (
        <div className="rg-score-summary">当前为启发性评分。点击「分析」后将生成六维书写质量报告与雷达图。</div>
      )}

      {hasReport && (
        <>
          <div className="rg-qr-dim-bars">
            {SCORE_DIMENSIONS.map((d) => {
              const dim = dimsForRadar[d.id];
              const val = dimScore(dim, d.max);
              const pct = Math.max(0, Math.min(100, (val / d.max) * 100));
              return (
                <div key={d.id} className="rg-score-dim">
                  <div className="rg-dim-head">
                    <span>{d.label}</span>
                    <span className="rg-dim-val">{val}/{d.max}</span>
                  </div>
                  <div className="rg-dim-bar">
                    <div className="rg-dim-fill"
                      style={{ width: `${pct}%`, background: pct >= 80 ? "#2f7d58" : pct >= 60 ? "#f59e0b" : "#ef4444" }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rg-qr-preview-wrap">
            <div className="rg-qr-preview" ref={summaryRef}>
              <QualityReportBody report={report || { dimensions: dimsForRadar, summary: detail?.summary }} detail={detail} />
            </div>
            {overflow && (
              <div className="rg-qr-fade">
                <button type="button" className="rg-qr-full-btn" onClick={() => setFullOpen(true)}>全文查看</button>
              </div>
            )}
          </div>
        </>
      )}

      {fullOpen && (
        <div className="rg-qr-modal-mask" role="dialog" aria-modal="true" onClick={() => setFullOpen(false)}>
          <div className="rg-qr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rg-qr-modal-head">
              <h3>书写质量评分报告 · {total}/{SCORE_TOTAL_MAX} · {grade}</h3>
              <button type="button" className="rg-tb-btn" onClick={() => setFullOpen(false)}>关闭</button>
            </div>
            <div className="rg-qr-modal-body">
              {(report?.summary || detail?.summary) && (
                <p className="rg-score-summary">{report?.summary || detail?.summary}</p>
              )}
              <QualityReportBody report={report || { dimensions: dimsForRadar }} detail={detail} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 将 TOP 待改进转为与批注一致的卡片数据 */
function improvementsToAnnotations(improvements) {
  return (improvements || []).map((it, i) => {
    if (typeof it === "string") {
      return {
        id: `imp-${i + 1}`,
        title: it,
        body: "",
        severity: "warning",
        quote: "",
        suggestion: "",
        section: "",
      };
    }
    const impact = String(it.impact || "中").trim();
    const severity = impact === "高" ? "error" : impact === "低" ? "info" : "warning";
    return {
      id: `imp-${i + 1}`,
      title: String(it.title || "待改进").trim() || "待改进",
      body: String(it.detail || "").trim(),
      severity,
      quote: String(it.before || "").trim(),
      suggestion: String(it.after || "").trim(),
      section: "",
    };
  }).filter((a) => a.title);
}

/** ---- 批注面板（含 TOP 待改进，样式与批注一致）---- */
function AnnotationPanel({ annotations, improvements, activeAnno, onAnnoClick }) {
  const merged = useMemo(() => {
    const fromImp = improvementsToAnnotations(improvements);
    const annoIds = new Set((annotations || []).map((a) => a.id));
    // 待改进在前；避免与批注 id 冲突
    const safeAnno = (annotations || []).map((a) => (
      String(a.id || "").startsWith("imp-") ? { ...a, id: `anno-${a.id}` } : a
    ));
    return [...fromImp.filter((a) => !annoIds.has(a.id)), ...safeAnno];
  }, [annotations, improvements]);

  const groups = useMemo(() => groupAnnotationsBySeverity(merged), [merged]);
  const sevOrder = ["error", "warning", "info"];
  const sevLabels = { error: "硬伤", warning: "需优化", info: "建议" };

  return (
    <div className="rg-anno-panel">
      {sevOrder.map((sev) => {
        const items = groups[sev] || [];
        if (!items.length) return null;
        return (
          <div key={sev} className="rg-anno-group">
            <div className="rg-anno-group-head">
              {sevLabels[sev]} <span className="rg-anno-count">{items.length}</span>
            </div>
            {items.map((a) => {
              const active = activeAnno === a.id;
              const style = annoSeverityStyle(sev);
              return (
                <div key={a.id} className={`rg-anno-card${active ? " active" : ""}`}
                  style={active ? { borderLeftColor: style.color, background: style.bg } : {}}
                  onClick={() => onAnnoClick(a.id)}>
                  <div className="rg-anno-top">
                    <span className="rg-anno-badge" style={{ background: style.color, color: "#fff" }}>{style.badge}</span>
                    <span className="rg-anno-title">{a.title}</span>
                  </div>
                  {a.quote && <div className="rg-anno-quote">「{a.quote}」</div>}
                  {a.body && <div className="rg-anno-body">{a.body}</div>}
                  {a.suggestion && <div className="rg-anno-suggestion"><strong>建议：</strong>{a.suggestion}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
      {!merged.length && <div className="rg-anno-empty">暂无修改建议。完整分析需后端 LLM 支持。</div>}
    </div>
  );
}

/** ---- 简历分析台主组件 ---- */
export default function ResumeDetail({ resume, onBack, onPatch, onOpenJdMatch, onEdit }) {
  const [activeAnno, setActiveAnno] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [rightTab, setRightTab] = useState("report");
  const analyzeAbortRef = useRef(null);

  const canShowPdf = Boolean(resume?.hasPdf);
  const hasAnalyzed = Boolean(resume?.analyzed);

  const structured = useMemo(() => normalizeStructured(resume?.structured), [resume?.structured]);

  const annotations = useMemo(
    () => (hasAnalyzed && resume?.annotations?.length
      ? resume.annotations
      : hasAnalyzed
        ? buildAnnotationsFromStructured(structured)
        : []),
    [hasAnalyzed, resume?.annotations, structured]
  );

  const improvements = useMemo(() => {
    if (!hasAnalyzed) return [];
    return getQualityReport(structured)?.top_improvements || [];
  }, [hasAnalyzed, structured]);

  useEffect(() => {
    if (!hasAnalyzed) {
      setActiveAnno("");
      return;
    }
    const merged = [
      ...improvementsToAnnotations(improvements),
      ...(annotations || []),
    ];
    const first = merged.find((a) => a.severity === "error")
      || merged.find((a) => a.severity === "warning")
      || merged[0];
    setActiveAnno(first?.id || "");
  }, [resume?.id, hasAnalyzed, annotations, improvements]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    analyzeAbortRef.current?.abort();
  }, []);

  const handleAnnoClick = useCallback((id) => {
    setActiveAnno((prev) => (prev === id ? "" : id));
  }, []);

  function handleCancelAnalyze() {
    analyzeAbortRef.current?.abort();
    analyzeAbortRef.current = null;
    setAnalyzing(false);
  }

  async function handleAnalyze() {
    if (analyzing) return;
    const ac = new AbortController();
    analyzeAbortRef.current = ac;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      let plain = "";
      let nextStructured = normalizeStructured(structured);

      if (resume?.hasPdf) {
        const blob = await getResumePdf(resume.id);
        if (ac.signal.aborted) return;
        if (!blob) throw new Error("未找到原 PDF，请重新上传");
        const file = new File([blob], resume.name || "resume.pdf", {
          type: blob.type || "application/pdf",
        });
        const data = await api.uploadFile(file, { signal: ac.signal });
        if (ac.signal.aborted) return;
        if (data.error) throw new Error(data.error);

        const resumeTextRaw = data.resume_text_raw || data.resume_text || "";
        nextStructured = withSourceModuleOrder(
          normalizeStructured(data.structured),
          "upload"
        );
        plain = structuredToPlainText(nextStructured) || resumeTextRaw;
        const ann = Array.isArray(data.structured?.annotations) && data.structured.annotations.length
          ? data.structured.annotations
          : buildAnnotationsFromStructured(nextStructured);

        onPatch({
          ...resume,
          resumeText: plain,
          rawText: resumeTextRaw,
          structured: nextStructured,
          assets: data.assets || [],
          score: scoreStructured(nextStructured, nextStructured),
          annotations: ann,
          analyzed: true,
          updated: new Date().toISOString().slice(0, 10),
          analyzing: false,
        });
        setRightTab("report");
        return;
      }

      plain = structuredToPlainText(structured) || resume?.resumeText || resume?.rawText || "";
      if (!plain.trim()) throw new Error("分析失败，请重新上传 PDF");
      const data = await api.uploadText(plain, { signal: ac.signal });
      if (ac.signal.aborted) return;
      if (data.error) throw new Error(data.error);
      const incoming = normalizeStructured(data.structured);
      nextStructured = {
        ...normalizeStructured(structured),
        ...(incoming || {}),
      };
      const ann = Array.isArray(incoming?.annotations) && incoming.annotations.length
        ? incoming.annotations
        : buildAnnotationsFromStructured(nextStructured);
      onPatch({
        ...resume,
        structured: nextStructured,
        resumeText: structuredToPlainText(nextStructured) || plain,
        score: scoreStructured(nextStructured, nextStructured),
        annotations: ann,
        analyzed: true,
        updated: new Date().toISOString().slice(0, 10),
        analyzing: false,
      });
      setRightTab("report");
    } catch (e) {
      if (e?.name === "AbortError" || ac.signal.aborted) return;
      setAnalyzeError(e.message || "分析失败");
    } finally {
      if (analyzeAbortRef.current === ac) {
        analyzeAbortRef.current = null;
        setAnalyzing(false);
      }
    }
  }

  return (
    <div className={`rg-detail${hasAnalyzed ? "" : " rg-detail-preview-only"}`}>
      {analyzing && (
        <div className="rg-analyze-mask" role="dialog" aria-modal="true" aria-labelledby="rg-analyze-title">
          <div className="rg-analyze-modal">
            <div className="rg-analyze-spinner" aria-hidden="true" />
            <h3 id="rg-analyze-title">正在分析简历</h3>
            <p>正在抽取 PDF 文本并生成六维评分报告与修改建议，请稍候…</p>
            <button type="button" className="rg-tb-btn" onClick={handleCancelAnalyze}>取消分析</button>
          </div>
        </div>
      )}

      <div className="rg-detail-top">
        <div className="rg-detail-top-main">
          <div className="rg-detail-top-left">
            <button type="button" className="rg-tb-btn" onClick={onBack}>← 返回列表</button>
            <span className="rg-detail-title">{resume?.name?.replace(/\.pdf$/i, "") || "简历分析台"}</span>
          </div>
          <div className="rg-detail-top-actions">
            <button type="button" className="rg-tb-btn" disabled={analyzing} onClick={handleAnalyze}
              title="对当前简历做六维书写质量评分与批注分析">
              {analyzing ? "分析中…" : hasAnalyzed ? "重新分析" : "分析"}
            </button>
            <button type="button" className="rg-tb-btn" onClick={() => onEdit?.(resume?.id)}
              title="进入编辑页修改简历">编辑</button>
            <button type="button" className="rg-tb-btn" onClick={() => onOpenJdMatch?.()}>岗位匹配度分析</button>
          </div>
        </div>
        {hasAnalyzed && <div className="rg-detail-top-side" aria-hidden="true" />}
      </div>

      <div className="rg-detail-body">
        <div className="rg-canvas">
          {canShowPdf ? (
            <div className="rg-paper rg-paper-pdf">
              <PdfPaper resumeId={resume.id} fileName={resume.name} />
            </div>
          ) : (
            <div className="rg-paper rg-paper-empty">
              未找到原件，请重新上传 PDF 后查看简历预览。
            </div>
          )}
          {!hasAnalyzed && analyzeError && (
            <p className="rg-analysis-error rg-analysis-error-inline">{analyzeError}</p>
          )}
        </div>

        {hasAnalyzed && (
          <aside className="rg-right">
            <div className="rg-card">
              <div className="rg-right-tabs">
                <button type="button" className={rightTab === "report" ? "active" : ""}
                  onClick={() => setRightTab("report")}>评分报告</button>
                <button type="button" className={rightTab === "anno" ? "active" : ""}
                  onClick={() => setRightTab("anno")}>批注优化</button>
              </div>
              {analyzeError && <p className="rg-analysis-error">{analyzeError}</p>}
              {rightTab === "report" ? (
                <QualityReportPanel structured={structured} />
              ) : (
                <AnnotationPanel
                  annotations={annotations}
                  improvements={improvements}
                  activeAnno={activeAnno}
                  onAnnoClick={handleAnnoClick}
                />
              )}
            </div>

            {structured.needs_confirmation?.length > 0 && (
              <div className="rg-card">
                <h3>待确认</h3>
                <ul className="rg-confirm-list">
                  {structured.needs_confirmation.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
