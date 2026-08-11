import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  User,
  X,
  Zap,
} from "lucide-react";
import { api } from "../api.js";
import { getResumes } from "./resumeGrower/storage.js";

/* ---------- 预设岗位 ---------- */
const PRESET_ROLES = [
  "数据分析师",
  "高级数据分析师",
  "数据科学家",
  "数据工程师",
  "商业分析师",
  "经营分析师",
  "用户增长",
  "策略产品经理",
  "AI产品经理",
  "后端工程师",
  "前端工程师",
  "算法工程师",
  "测试开发工程师",
];

/* ---------- 本地存储 key ---------- */
const MJ_STORAGE_KEY = "mianjing_packages_v1";

function loadPackages() {
  try {
    return JSON.parse(localStorage.getItem(MJ_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}
function savePackages(list) {
  localStorage.setItem(MJ_STORAGE_KEY, JSON.stringify(list));
}

/* ---------- 工具 ---------- */
function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ================================================================
   主组件
   ================================================================ */
export default function MianJing() {
  const [packages, setPackages] = useState(() => loadPackages());
  const [activeId, setActiveId] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  /* 配置表单 */
  const [selectedResumeId, setSelectedResumeId] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [customRole, setCustomRole] = useState("");

  const savedResumes = useMemo(() => {
    try {
      return getResumes().filter((r) => r.structured && !r.analyzing);
    } catch {
      return [];
    }
  }, []);

  /* 默认选中第一份简历 */
  useEffect(() => {
    if (!selectedResumeId && savedResumes.length) {
      setSelectedResumeId(savedResumes[0].id);
    }
  }, [savedResumes, selectedResumeId]);

  const activePkg = useMemo(
    () => packages.find((p) => p.id === activeId) || null,
    [packages, activeId],
  );

  /* 雷达补充数据就绪后更新 packages */
  function handleRefreshPackage(pkgId, newData) {
    setPackages((prev) => {
      const nextList = prev.map((p) =>
        p.id === pkgId ? { ...p, data: newData } : p,
      );
      savePackages(nextList);
      return nextList;
    });
  }

  /* 删除 */
  function handleDelete(id) {
    const next = packages.filter((p) => p.id !== id);
    setPackages(next);
    savePackages(next);
    if (activeId === id) setActiveId(next.length ? next[0].id : null);
  }

  /* 开始生成 */
  async function handleStartGenerate() {
    const rid = selectedResumeId;
    const role = targetRole === "__custom__" ? customRole.trim() : targetRole;
    if (!rid) {
      setGenError("请先选择一份简历");
      return;
    }
    if (!role) {
      setGenError("请输入目标岗位");
      return;
    }

    const resume = savedResumes.find((r) => r.id === rid);
    if (!resume) {
      setGenError("未找到所选简历，请刷新后重试");
      return;
    }

    setShowConfig(false);
    setGenerating(true);
    setGenError("");

    try {
      const result = await api.generateMianJing(resume.structured || {}, role);
      const pkgId = result.id || "mj_" + Date.now();
      const pkg = {
        id: pkgId,
        resumeId: rid,
        resumeName: resume.name || "未知简历",
        targetRole: role,
        createdAt: result.created_at || new Date().toISOString(),
        data: result.data || result,
      };
      const next = [pkg, ...packages];
      setPackages(next);
      savePackages(next);
      setActiveId(pkgId);
      setGenerating(false);
    } catch (e) {
      setGenError(e.message || "生成失败，请稍后重试");
    }
  }

  /* 打开配置弹窗前重置 */
  function openConfig() {
    setSelectedResumeId(savedResumes.length ? savedResumes[0].id : "");
    setTargetRole("数据分析师");
    setCustomRole("");
    setGenError("");
    setShowConfig(true);
  }

  return (
    <div className="mj-page">
      {/* ======== 侧边栏 ======== */}
      <aside className="mj-sidebar">
        <div className="mj-sidebar-hd">
          <h2 className="mj-sidebar-title">
            <BookOpen size={18} />
            我的面经
          </h2>
          <button className="btn primary" style={{ width: "100%", marginTop: 10 }} onClick={openConfig}>
            <Plus size={16} />
            开始生成面经
          </button>
        </div>
        <div className="mj-sidebar-list">
          {packages.length === 0 && (
            <p className="mj-sidebar-empty">暂无面经，点击下方按钮生成</p>
          )}
          {packages.map((p) => (
            <div
              key={p.id}
              className={`mj-sidebar-item${activeId === p.id ? " active" : ""}`}
              onClick={() => setActiveId(p.id)}
            >
              <div className="mj-sidebar-item-main">
                <span className="mj-sidebar-item-name">{p.resumeName}</span>
                <span className="mj-sidebar-item-role">{p.targetRole}</span>
              </div>
              <span className="mj-sidebar-item-date">{formatDate(p.createdAt)}</span>
              <button
                className="mj-sidebar-item-del"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(p.id);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* ======== 主内容区 ======== */}
      <main className="mj-main">
        {!activePkg ? (
          <EmptyState onStart={openConfig} />
        ) : (
          <PackageView pkg={activePkg} onRefresh={handleRefreshPackage} />
        )}
      </main>

      {/* ======== 配置弹窗 ======== */}
      {showConfig && (
        <div className="mj-modal-overlay" onClick={() => setShowConfig(false)}>
          <div className="mj-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mj-modal-hd">
              <h3><Sparkles size={18} /> 生成面经备考包</h3>
              <button className="mj-modal-close" onClick={() => setShowConfig(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="mj-modal-body">
              {/* 选择简历 */}
              <label className="mj-field">
                <span className="mj-field-label">
                  <FileText size={14} /> 选择简历
                </span>
                <select
                  className="mj-select"
                  value={selectedResumeId}
                  onChange={(e) => setSelectedResumeId(e.target.value)}
                >
                  <option value="" disabled>
                    请选择一份简历…
                  </option>
                  {savedResumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* 目标岗位 */}
              <label className="mj-field">
                <span className="mj-field-label">
                  <Target size={14} /> 目标岗位
                </span>
                <select
                  className="mj-select"
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                >
                  {PRESET_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                  <option value="__custom__">自定义岗位…</option>
                </select>
              </label>

              {targetRole === "__custom__" && (
                <label className="mj-field">
                  <span className="mj-field-label">输入目标岗位</span>
                  <input
                    className="mj-input"
                    type="text"
                    placeholder="例如：风控策略分析师"
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                  />
                </label>
              )}

              {genError && <p className="mj-error">{genError}</p>}
            </div>
            <div className="mj-modal-ft">
              <button className="mj-btn mj-btn-ghost" onClick={() => setShowConfig(false)}>
                取消
              </button>
              <button
                className="mj-btn mj-btn-primary"
                disabled={
                  !selectedResumeId ||
                  !(targetRole === "__custom__" ? customRole.trim() : targetRole)
                }
                onClick={handleStartGenerate}
              >
                <Zap size={15} />
                确认生成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== 生成中 / 生成失败弹窗 ======== */}
      {generating && (
        <div className="mj-modal-overlay">
          <div className="mj-modal mj-modal-generating">
            {genError ? (
              <>
                <div className="mj-gen-error-icon-wrap">
                  <X size={36} />
                </div>
                <h3>生成失败</h3>
                <p className="mj-gen-error-msg">{genError}</p>
                <button
                  className="mj-btn mj-btn-primary"
                  onClick={() => {
                    setGenerating(false);
                    setGenError("");
                    setShowConfig(true);
                  }}
                >
                  返回重试
                </button>
              </>
            ) : (
              <>
                <Loader2 size={36} className="mj-spin" />
                <h3>面经生成中，请耐心等待…</h3>
                <p className="mj-gen-hint">
                  系统正在生成个性化备考包，预计需要 30-60 秒
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   空状态
   ================================================================ */
function EmptyState({ onStart }) {
  return (
    <div className="mj-empty">
      <div className="mj-empty-icon"><BookOpen size={48} /></div>
      <h2>面经备考包</h2>
      <p>
        基于真实面经数据 + 你的简历，生成个性化面试备考包：
        <br />
        高频题 · 项目追问 · 自我介绍 · 冲刺计划 · 简历补强
      </p>
      <button className="mj-btn mj-btn-primary mj-btn-lg" onClick={onStart}>
        <Sparkles size={18} />
        开始生成面经
      </button>
    </div>
  );
}

/* ================================================================
   备考包详情展示
   ================================================================ */
function PackageView({ pkg, onRefresh }) {
  const [data, setData] = useState(pkg.data || {});

  // 同步外部 pkg.data 变化
  useEffect(() => {
    setData(pkg.data || {});
  }, [pkg.data]);

  // 轮询后端获取雷达补充数据（与后端 RADAR_TIMEOUT_SEC=180 对齐）
  useEffect(() => {
    if (data._radar_enriched) return;
    let polls = 0;
    let miss = 0;
    const maxPolls = 100; // ~200s
    const maxMiss = 5;

    function settleLocal(note) {
      setData((prev) => {
        if (prev._radar_enriched) return prev;
        const groups = (prev.questionGroups || []).map((g) => ({
          ...g,
          pending: false,
          questions: g.questions || [],
        }));
        const next = {
          ...prev,
          _radar_enriched: true,
          questionGroups: groups,
          questionsNote: note || prev.questionsNote || "真实面经采集已结束",
        };
        if (onRefresh) onRefresh(pkg.id, next);
        return next;
      });
    }

    const timer = setInterval(async () => {
      polls++;
      try {
        const updated = await api.getMianJing(pkg.id);
        miss = 0;
        if (updated && updated.data && updated.data._radar_enriched) {
          clearInterval(timer);
          setData(updated.data);
          if (onRefresh) onRefresh(pkg.id, updated.data);
          return;
        }
      } catch (e) {
        miss++;
        if (miss >= maxMiss) {
          clearInterval(timer);
          settleLocal("无法从服务器拉取真实面经（可能后端已重启），请重新生成面经");
          return;
        }
      }
      if (polls >= maxPolls) {
        clearInterval(timer);
        settleLocal("真实面经采集超时，请重新生成或稍后重试；下方仍可查看 AI 参考题");
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [pkg.id, data._radar_enriched]);

  const hasQuestions = (data.questions || []).length > 0 || (data.questionGroups || []).some(g => (g.questions || []).length > 0);

  return (
    <div className="mj-pkg">
      {/* 头部 */}
      <div className="mj-pkg-hd">
        <div>
          <h2 className="mj-pkg-title">
            {data.targetRole || pkg.targetRole} 岗位备考包
          </h2>
          <p className="mj-pkg-sub">
            {pkg.resumeName} · 生成于 {formatDate(pkg.createdAt)}
          </p>
        </div>
        <div className="mj-pkg-hd-actions">
          <button
            className="mj-btn mj-btn-ghost mj-btn-sm"
            onClick={() => {
              const exportPkg = { ...pkg, data };
              const blob = new Blob([pkgToMarkdown(exportPkg)], { type: "text/markdown;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `备考包-${pkg.targetRole}-${formatDate(pkg.createdAt)}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={14} /> 导出 Markdown
          </button>
        </div>
      </div>

      {/* 雷达数据采集状态提示 */}
      {!data._radar_enriched && (
        <div className="mj-radar-status">
          <Loader2 size={14} className="mj-spin" />
          <span>正在从牛客网 / 小红书 / 知乎采集真实面经数据，题目将自动更新…</span>
        </div>
      )}

      <div className="mj-pkg-body">
        {/* 1. 候选人定位 */}
        {data.positioning && (
          <Section title="1. 候选人定位" icon={<User size={16} />}>
            <blockquote className="mj-positioning-summary">
              {data.positioning.summary}
            </blockquote>
            {data.positioning.evidences && data.positioning.evidences.length > 0 && (
              <div className="mj-evidence-grid">
                {data.positioning.evidences.map((ev, i) => (
                  <div key={i} className="mj-evidence-card">
                    <h4>{ev.title}</h4>
                    <ul>
                      {(ev.points || []).map((p, j) => (
                        <li key={j}>{p}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* 2. Gap 分析 */}
        {data.gapAnalysis && (data.gapAnalysis.dimensions || []).length > 0 && (
          <Section title="2. 岗位 Gap 分析" icon={<Target size={16} />}>
            <div className="mj-table-wrap">
              <table className="mj-table">
                <thead>
                  <tr>
                    <th>维度</th>
                    <th>当前简历表现</th>
                    <th>面试风险</th>
                    <th>准备建议</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gapAnalysis.dimensions.map((d, i) => (
                    <tr key={i}>
                      <td className="mj-td-dim">{d.dimension}</td>
                      <td>{d.current}</td>
                      <td>{d.risk}</td>
                      <td>{d.suggestion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {/* 3. 数据来源概况 */}
        {data.dataSources && (
          <Section title="3. 数据来源概况" icon={<Zap size={16} />}>
            {data.dataSources.summary && data.dataSources.summary.length > 0 && (
              <>
                <h4 className="mj-sub-title">本次召回</h4>
                <ul className="mj-source-summary">
                  {data.dataSources.summary.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {data.dataSources.gaps && data.dataSources.gaps.length > 0 && (
              <>
                <h4 className="mj-sub-title mj-sub-warn">数据缺口</h4>
                <ul className="mj-gap-list">
                  {data.dataSources.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        )}

        {/* 4. 面经题目（真实优先 + AI，双分组） */}
        {(hasQuestions || (data.questionGroups || []).length > 0) && (
          <Section
            title={`4. 面经题目`}
            icon={<BookOpen size={16} />}
          >
            {data.questionsNote && (
              <p className="mj-note">{data.questionsNote}</p>
            )}
            {data.questionGroups ? (
              data.questionGroups.map((group, gi) => {
                let globalIdx = 0;
                for (let k = 0; k < gi; k++) {
                  globalIdx += (data.questionGroups[k].questions || []).length;
                }
                const qs = group.questions || [];
                return (
                  <div key={gi} className="mj-question-group">
                    <div className="mj-question-group-hd">
                      <span className={`mj-question-group-tag mj-tag-${group.source_type}`}>
                        {group.tag || group.label}
                      </span>
                      <span className="mj-question-group-count">
                        {group.pending ? "采集中…" : `${qs.length} 题`}
                      </span>
                    </div>
                    {qs.length === 0 ? (
                      <p className="mj-group-empty">
                        {group.pending
                          ? "正在从牛客网等来源抓取真实面经…"
                          : group.source_type === "real"
                            ? "暂未抓取到真实面经，请查看下方 AI 生成参考题"
                            : "暂无 AI 生成题"}
                      </p>
                    ) : (
                      <div className="mj-questions">
                        {qs.map((q, i) => (
                          <QuestionCard key={i} index={globalIdx + i + 1} question={q} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="mj-questions">
                {(data.questions || []).map((q, i) => (
                  <QuestionCard key={i} index={i + 1} question={q} />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* 5. 项目追问链 */}
        {data.followUpChains && data.followUpChains.length > 0 && (
          <Section title="5. 个性化项目追问链" icon={<Target size={16} />}>
            {data.followUpChains.map((chain, i) => (
              <FollowUpCard key={i} index={i + 1} chain={chain} />
            ))}
          </Section>
        )}

        {/* 6. 自我介绍 */}
        {data.selfIntro && (
          <Section title="6. 你的 60-90 秒自我介绍草稿" icon={<User size={16} />}>
            <div className="mj-self-intro">{data.selfIntro}</div>
          </Section>
        )}

        {/* 7. 冲刺计划 */}
        {data.sprintPlan && data.sprintPlan.length > 0 && (
          <Section title="7. 一周冲刺计划" icon={<Zap size={16} />}>
            <div className="mj-sprint">
              {data.sprintPlan.map((day, i) => (
                <div key={i} className="mj-sprint-day">
                  <h4 className="mj-sprint-day-title">
                    Day {day.day}：{day.theme}
                  </h4>
                  <ul>
                    {(day.items || []).map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* 8. 简历补强 */}
        {data.resumeImprovements && data.resumeImprovements.length > 0 && (
          <Section title="8. 建议你立刻补强的简历表述" icon={<FileText size={16} />}>
            {data.resumeImprovements.map((imp, i) => (
              <div key={i} className="mj-improvement">
                <h4 className="mj-sub-title">{imp.title}</h4>
                <blockquote>{imp.content}</blockquote>
              </div>
            ))}
          </Section>
        )}

        {/* 9. 来源列表 */}
        {data.sourceList && (
          <Section title="9. 来源列表" icon={<BookOpen size={16} />}>
            {Object.entries(data.sourceList).map(([source, items]) =>
              items && items.length > 0 ? (
                <div key={source} className="mj-source-group">
                  <h4 className="mj-sub-title">{source}</h4>
                  <ul>
                    {items.map((s, i) => (
                      <li key={i}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          {s.url}
                        </a>
                        {s.note && <span className="mj-source-note"> — {s.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null,
            )}
          </Section>
        )}

        {/* 10. 速查清单 */}
        {data.checklist && data.checklist.length > 0 && (
          <Section title="10. 面试前速查清单" icon={<Check size={16} />}>
            <ul className="mj-checklist">
              {data.checklist.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   子组件
   ================================================================ */

function Section({ title, icon, children }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="mj-section">
      <button className="mj-section-hd" onClick={() => setOpen(!open)}>
        <span className="mj-section-hd-left">
          {icon}
          <span>{title}</span>
        </span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && <div className="mj-section-body">{children}</div>}
    </section>
  );
}

function QuestionCard({ index, question }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mj-qcard">
      <button className="mj-qcard-hd" onClick={() => setOpen(!open)}>
        <span className="mj-qcard-num">{index}</span>
        <span className="mj-qcard-text">{question.text || question.question}</span>
        {question.source_label && (
          <span className={`mj-qcard-source-tag mj-tag-${question.source_type || "llm"}`}>
            {question.source_label}
          </span>
        )}
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="mj-qcard-body">
          {/* 来源 */}
          {question.sources && question.sources.length > 0 && (
            <div className="mj-qcard-sources">
              <span className="mj-qcard-label">来源：</span>
              {question.sources.map((s, i) => (
                <div key={i} className="mj-qcard-source">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.label || s.url}
                    </a>
                  ) : (
                    <span>{s.label || s}</span>
                  )}
                  {s.evidence && (
                    <code className="mj-qcard-evidence">{s.evidence}</code>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 回答要点 */}
          {question.points && question.points.length > 0 && (
            <div className="mj-qcard-points">
              <span className="mj-qcard-label">回答要点：</span>
              <ul>
                {question.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 简历锚点 */}
          {question.anchor && (
            <div className="mj-qcard-anchor">
              <span className="mj-qcard-label">可挂简历锚点：</span>
              <blockquote>{question.anchor}</blockquote>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FollowUpCard({ index, chain }) {
  return (
    <div className="mj-chain-card">
      <h4 className="mj-chain-title">
        链 {index}：{chain.theme} → {chain.project}
      </h4>
      {chain.seedQuestion && (
        <p className="mj-chain-seed">
          种子题：{chain.seedQuestion}
        </p>
      )}
      {chain.followups && chain.followups.length > 0 && (
        <>
          <p className="mj-chain-label">追问：</p>
          <ol className="mj-chain-list">
            {chain.followups.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
        </>
      )}
      {chain.focusPoints && chain.focusPoints.length > 0 && (
        <div className="mj-chain-focus">
          <p className="mj-chain-label">准备重点：</p>
          <ul>
            {chain.focusPoints.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   导出 Markdown（用于下载）
   ================================================================ */
function pkgToMarkdown(pkg) {
  const d = pkg.data || {};
  let md = "";
  md += `# ${d.targetRole || pkg.targetRole} 岗位备考包\n\n`;
  md += `生成日期：${formatDate(pkg.createdAt)}\n`;
  md += `目标岗位：${d.targetRole || pkg.targetRole}\n\n`;

  if (d.positioning) {
    md += `## 1. 候选人定位\n\n> ${d.positioning.summary}\n\n`;
    (d.positioning.evidences || []).forEach((ev, i) => {
      md += `${i + 1}. **${ev.title}**\n`;
      (ev.points || []).forEach((p) => (md += `   - ${p}\n`));
      md += "\n";
    });
  }

  if (d.gapAnalysis) {
    md += "## 2. Gap 分析\n\n| 维度 | 当前 | 风险 | 建议 |\n|---|---|---|---|\n";
    (d.gapAnalysis.dimensions || []).forEach((dim) => {
      md += `| ${dim.dimension} | ${dim.current} | ${dim.risk} | ${dim.suggestion} |\n`;
    });
    md += "\n";
  }

  if (d.dataSources) {
    md += "## 3. 数据来源概况\n\n";
    (d.dataSources.summary || []).forEach((s) => (md += `- ${s}\n`));
    if ((d.dataSources.gaps || []).length) {
      md += "\n数据缺口：\n";
      (d.dataSources.gaps || []).forEach((g) => (md += `- ${g}\n`));
    }
    md += "\n";
  }

  const allQuestions = d.questions || [];
  const groups = d.questionGroups;
  if (allQuestions.length || (groups || []).some(g => (g.questions || []).length)) {
    md += `## 4. 面经题目\n\n`;
    if (d.questionsNote) md += `> ${d.questionsNote}\n\n`;

    if (groups) {
      let idx = 0;
      groups.forEach((group) => {
        md += `### ${group.tag || group.label}\n\n`;
        (group.questions || []).forEach((q) => {
          idx++;
          md += `#### ${idx}. ${q.text || q.question}\n\n`;
          if (q.source_label) md += `来源：${q.source_label}\n\n`;
          if (q.sources) {
            (q.sources).forEach((s) => {
              md += `- ${s.label || s.url}${s.evidence ? `：\`${s.evidence}\`` : ""}\n`;
            });
          }
          if (q.points) {
            md += "\n回答要点：\n";
            q.points.forEach((p) => (md += `- ${p}\n`));
          }
          if (q.anchor) md += `\n锚点：> ${q.anchor}\n`;
          md += "\n";
        });
      });
    } else {
      (allQuestions).forEach((q, i) => {
        md += `### ${i + 1}. ${q.text || q.question}\n\n`;
        if (q.source_label) md += `来源：${q.source_label}\n\n`;
        if (q.sources) {
          (q.sources).forEach((s) => {
            md += `- ${s.label || s.url}${s.evidence ? `：\`${s.evidence}\`` : ""}\n`;
          });
        }
        if (q.points) {
          md += "\n回答要点：\n";
          q.points.forEach((p) => (md += `- ${p}\n`));
        }
        if (q.anchor) md += `\n锚点：> ${q.anchor}\n`;
        md += "\n";
      });
    }
  }

  if (d.followUpChains) {
    md += "## 5. 项目追问链\n\n";
    (d.followUpChains || []).forEach((c, i) => {
      md += `### 链 ${i + 1}：${c.theme}\n\n`;
      if (c.seedQuestion) md += `种子题：${c.seedQuestion}\n\n`;
      (c.followups || []).forEach((f, j) => (md += `${j + 1}. ${f}\n`));
      md += "\n";
    });
  }

  if (d.selfIntro) md += `## 6. 自我介绍\n\n${d.selfIntro}\n\n`;

  if (d.sprintPlan) {
    md += "## 7. 冲刺计划\n\n";
    (d.sprintPlan || []).forEach((day) => {
      md += `### Day ${day.day}：${day.theme}\n\n`;
      (day.items || []).forEach((item) => (md += `- ${item}\n`));
      md += "\n";
    });
  }

  if (d.resumeImprovements) {
    md += "## 8. 简历补强\n\n";
    (d.resumeImprovements || []).forEach((imp) => {
      md += `### ${imp.title}\n\n> ${imp.content}\n\n`;
    });
  }

  if (d.sourceList) {
    md += "## 9. 来源列表\n\n";
    Object.entries(d.sourceList).forEach(([source, items]) => {
      if (items && items.length) {
        md += `${source}：\n`;
        items.forEach((s) => (md += `- ${s.url}${s.note ? " — " + s.note : ""}\n`));
        md += "\n";
      }
    });
  }

  if (d.checklist) {
    md += "## 10. 速查清单\n\n";
    (d.checklist || []).forEach((item) => (md += `- ${item}\n`));
  }

  return md;
}
