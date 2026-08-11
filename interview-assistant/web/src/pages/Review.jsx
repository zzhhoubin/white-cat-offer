import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function Review() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [report, setReport] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [status, setStatus] = useState("");
  const [added, setAdded] = useState({}); // item_id -> true

  async function refresh() {
    try {
      const data = await api.getReviews();
      const list = data.sessions || [];
      setSessions(list);
      if (list.length && !list.find((s) => s.session_id === selectedId)) {
        setSelectedId(list[0].session_id);
      }
      if (!list.length) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch {
      setStatus("无法连接后端，请确认后端已启动（python app.py）");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const d = await api.getReview(selectedId);
        setDetail(d && !d.error ? d : null);
        setReport(d && !d.error ? d.report || null : null);
        setAdded({});
      } catch {
        setDetail(null);
        setReport(null);
      }
    })();
  }, [selectedId]);

  async function addToBank(itemId) {
    try {
      const r = await api.reviewItemToBank(selectedId, itemId);
      if (r.ok) {
        setAdded((m) => ({ ...m, [itemId]: true }));
        setStatus("已加入专属题库");
      } else {
        setStatus("加入失败：" + (r.error || "未知错误"));
      }
    } catch (e) {
      setStatus("加入失败：" + e.message);
    }
  }

  async function removeSession(sid) {
    await api.deleteReview(sid);
    if (sid === selectedId) {
      setSelectedId(null);
      setDetail(null);
      setReport(null);
    }
    refresh();
  }

  async function generateReport() {
    if (!selectedId) return;
    setReporting(true);
    setStatus("正在生成复盘报告...");
    try {
      const data = await api.generateReviewReport(selectedId);
      if (data.error) {
        setStatus(data.error);
        return;
      }
      setReport(data.report || null);
      setDetail((current) => (current ? { ...current, report: data.report } : current));
      setStatus("复盘报告已生成");
    } catch (e) {
      setStatus("报告生成失败：" + e.message);
    } finally {
      setReporting(false);
    }
  }

  function exportReport() {
    if (!report?.markdown) return;
    const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `面试复盘报告-${selectedId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportHtmlReport() {
    if (!selectedId || detail?.mode !== "mock") return;
    try {
      setStatus("正在导出 HTML 报告...");
      await api.downloadMockInterviewReportHtml(
        selectedId,
        `模拟面试报告-${detail.role || "岗位"}-${selectedId}.html`
      );
      setStatus("HTML 报告已下载");
    } catch (e) {
      setStatus("HTML 导出失败：" + e.message);
    }
  }

  async function openHtmlReport() {
    if (!selectedId || detail?.mode !== "mock") return;
    try {
      setStatus("正在打开 HTML 报告...");
      const html = await api.fetchMockInterviewReportHtml(selectedId);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setStatus("");
    } catch (e) {
      setStatus("HTML 预览失败：" + e.message);
    }
  }

  return (
    <main className="page qb-page">
      <h1>面试复盘</h1>
      <p className="page-desc">
        每场实时辅助会记录问题与回答提纲，AI 模拟面试会记录你的真实回答、逐题评分和报告。
        在这里回顾历史问题，把高价值题目一键回填到「专属题库」。
      </p>

      <div className="card qb-toolbar">
        <button className="btn primary" onClick={() => navigate("/interview/realtime")}>
          开始实时辅助
        </button>
        <button className="btn" onClick={refresh}>
          刷新
        </button>
        {status && <span className="status-line">{status}</span>}
      </div>

      {sessions.length === 0 ? (
        <div className="card">
          <p className="muted">
            还没有复盘记录。先在 Web 面试工作台「开始实时辅助」并完成一段面试，
            识别到的问题会自动出现在这里。
          </p>
        </div>
      ) : (
        <div className="qb-layout">
          {/* 左侧：会话列表 */}
          <aside className="qb-sidebar">
            <ul className="qb-qlist">
              {sessions.map((s) => (
                <li
                  key={s.session_id}
                  className={`qb-qitem ${selectedId === s.session_id ? "active" : ""}`}
                  onClick={() => setSelectedId(s.session_id)}
                >
                  <span className="q-index">{s.count}</span>
                  <span className="qb-qitem-text">
                    {fmtTime(s.started_at)}
                    <br />
                    <span className="muted">
                      {s.mode === "realtime" ? "实时辅助" : "模拟面试"} · {s.count} 个问题
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </aside>

          {/* 右侧：会话内问题详情 */}
          <section className="qb-detail card">
            {!detail ? (
              <p className="muted">从左侧选择一场面试查看问题记录。</p>
            ) : (
              <>
                <div className="row between">
                  <h3>
                    {fmtTime(detail.started_at)} 的面试（{detail.items.length} 个问题）
                  </h3>
                  <div className="row gap">
                    <button className="btn small primary" disabled={reporting} onClick={generateReport}>
                      {reporting ? "生成中..." : report ? "重新生成报告" : "生成复盘报告"}
                    </button>
                    {report?.markdown && (
                      <button className="btn small" onClick={exportReport}>
                        导出 Markdown
                      </button>
                    )}
                    {detail.mode === "mock" && report && (
                      <>
                        <button className="btn small" onClick={openHtmlReport}>
                          预览 HTML
                        </button>
                        <button className="btn small" onClick={exportHtmlReport}>
                          下载 HTML
                        </button>
                      </>
                    )}
                    <button
                      className="btn small ghost"
                      onClick={() => removeSession(detail.session_id)}
                    >
                      删除本场
                    </button>
                  </div>
                </div>
                {report && <ReviewReport report={report} />}
                {detail.items.length === 0 ? (
                  <p className="muted">这场没有记录到问题。</p>
                ) : (
                  <ol className="rv-items">
                    {detail.items.map((it) => (
                      <li key={it.item_id} className="rv-item">
                        <div className="rv-q-row">
                          {it.qtype && <span className="tag">{it.qtype}</span>}
                          <strong className="rv-q">{it.transcript}</strong>
                          {it.score ? <span className="score-pill">{it.score}</span> : null}
                        </div>
                        {it.answer_text && (
                          <div className="answer-text rv-outline">
                            <p><strong>我的回答：</strong>{it.answer_text}</p>
                          </div>
                        )}
                        {it.outline && (
                          <div className="answer-text rv-outline">
                            {outlineParagraphs(it.outline).map((p, i) => (
                              <p key={i}>{detail.mode === "mock" ? `参考回答：${p}` : p}</p>
                            ))}
                          </div>
                        )}
                        {it.improvements?.length > 0 && (
                          <div className="answer-text rv-outline">
                            {it.improvements.map((p, i) => (
                              <p key={i}>改进建议：{p}</p>
                            ))}
                          </div>
                        )}
                        <div className="row gap">
                          <button
                            className="btn small"
                            disabled={added[it.item_id]}
                            onClick={() => addToBank(it.item_id)}
                          >
                            {added[it.item_id] ? "已加入题库" : "加入专属题库"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function ReviewReport({ report }) {
  return (
    <section className="review-report">
      <div className="report-score">
        <span>复盘评分</span>
        <strong>{report.total_score}</strong>
        <small>{report.level} 级</small>
      </div>
      <div className="report-summary">
        <p>{report.summary}</p>
        <div className="score-grid">
          {(report.dimensions || []).map((dim) => (
            <div key={dim.name} className="score-card">
              <div className="row between">
                <strong>{dim.name}</strong>
                <span>{dim.score}</span>
              </div>
              <div className="score-bar">
                <i style={{ width: `${dim.score}%` }} />
              </div>
              <p>{dim.comment}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function outlineParagraphs(outline) {
  if (!outline) return [];
  if (typeof outline === "string") return outline.split(/\n\s*\n/).filter(Boolean);
  if (Array.isArray(outline)) return outline.map(String);
  if (typeof outline === "object") {
    const rows = [];
    if (outline.intent) rows.push(`考察意图：${outline.intent}`);
    if (outline.structure?.length) rows.push(`回答结构：${outline.structure.join(" → ")}`);
    if (outline.keywords?.length) rows.push(`关键词：${outline.keywords.join("、")}`);
    if (outline.personal_refs?.length) rows.push(`可引用经历：${outline.personal_refs.join("；")}`);
    if (outline.example) rows.push(`开场示范：${outline.example}`);
    if (outline.risk) rows.push(`风险提示：${outline.risk}`);
    return rows;
  }
  return [String(outline)];
}
