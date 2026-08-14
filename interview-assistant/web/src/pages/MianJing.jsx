import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { api } from "../api.js";
import JobTypeSelect from "../components/JobTypeSelect.jsx";

const MJ_STORAGE_KEY = "mianjing_experiences_v1";

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


const UI_NOISE_EXACT = new Set([
  "转发到动态", "复制链接", "微信", "QQ", "微博", "分享到微信", "分享给好友",
  "暂不保存", "保存图片", "浏览", "邀请牛友回答", "换一批", "关闭", "关 闭",
  "一键发评", "接好运", "快捷表情", "图片", "最近使用", "热门话题",
  "畅所欲言吧～", "畅所欲言吧~", "AI Agent方向", "点赞", "评论", "分享", "关注", "已关注",
  "忍耐王", "LangChain4j细节", "RAG全流程问得细",
]);


function firstLineTitle(text) {
  const cleaned = cleanQuestionsText(text);
  const line = (cleaned || "").split("\n").map((s) => s.trim()).find(Boolean) || "";
  if (line) return line.length > 48 ? `${line.slice(0, 48)}…` : line;
  return "（无标题）";
}


function cleanQuestionsText(text) {
  if (!text) return "";
  const hit = [
    "点赞成功", "送花成功", "转发到", "分享到", "分享给", "聊一聊", "捎句话",
    "最多还能上传", "畅所欲言", "邀请牛友", "一键发评", "快捷表情",
  ];
  return String(text)
    .split("\n")
    .map((ln) => ln.replace(/\ufeff|\u200b/g, "").trim())
    .filter((ln) => {
      if (!ln) return false;
      if (UI_NOISE_EXACT.has(ln)) return false;
      if (hit.some((p) => ln.startsWith(p) || ln.includes(p))) return false;
      if (/^共\d+张/.test(ln)) return false;
      if (/^\d{1,7}$/.test(ln)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}


export default function MianJing() {
  const [packages, setPackages] = useState(() => loadPackages());
  const [activeId, setActiveId] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [genError, setGenError] = useState("");
  const [jobOpen, setJobOpen] = useState(false);
  const [jobL1, setJobL1] = useState("");
  const [jobL2, setJobL2] = useState("");
  const [jobL3, setJobL3] = useState("");

  const activePkg = useMemo(
    () => packages.find((p) => p.id === activeId) || null,
    [packages, activeId],
  );

  function handleDelete(id) {
    const next = packages.filter((p) => p.id !== id);
    setPackages(next);
    savePackages(next);
    if (activeId === id) setActiveId(next.length ? next[0].id : null);
  }

  function openConfig() {
    setGenError("");
    setJobOpen(false);
    setShowConfig(true);
  }

  async function handleFetch(forceRefresh = false) {
    if (!jobL3) {
      setGenError("请选择岗位");
      return;
    }
    setShowConfig(false);
    setFetching(true);
    setGenError("");
    try {
      const result = await api.fetchMianJingExperiences({
        jobL1,
        jobL2,
        jobL3,
        limit: 10,
        useCache: !forceRefresh,
      });
      const pkgId = result.id || "mj_" + Date.now();
      const roleLabel =
        [jobL1, jobL2, jobL3].filter(Boolean).join(" > ") || jobL3;
      const pkg = {
        id: pkgId,
        targetRole: roleLabel,
        jobL1,
        jobL2,
        jobL3,
        createdAt: result.created_at || new Date().toISOString(),
        data: result.data || result,
      };
      const next = [pkg, ...packages.filter((p) => p.id !== pkgId)];
      setPackages(next);
      savePackages(next);
      setActiveId(pkgId);
      setFetching(false);
    } catch (e) {
      setGenError(e.message || "获取面经失败，请稍后重试");
      setFetching(false);
      setShowConfig(true);
    }
  }

  return (
    <div className="mj-page">
      <aside className="mj-sidebar">
        <div className="mj-sidebar-hd">
          <h2 className="mj-sidebar-title">
            <BookOpen size={18} />
            我的面经
          </h2>
          <button className="btn primary" style={{ width: "100%", marginTop: 10 }} onClick={openConfig}>
            <Plus size={16} />
            获取岗位面经
          </button>
        </div>
        <div className="mj-sidebar-list">
          {packages.length === 0 && (
            <p className="mj-sidebar-empty">暂无面经，选择岗位后获取</p>
          )}
          {packages.map((p) => (
            <div
              key={p.id}
              className={`mj-sidebar-item${activeId === p.id ? " active" : ""}`}
              onClick={() => setActiveId(p.id)}
            >
              <div className="mj-sidebar-item-main">
                <span className="mj-sidebar-item-name">{p.jobL3 || p.targetRole}</span>
                <span className="mj-sidebar-item-role">
                  {(p.data?.meta?.count ?? p.data?.items?.length ?? 0)} 篇
                  {p.data?.timing?.from_cache ? " · 缓存" : ""}
                </span>
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

      <main className="mj-main">
        {!activePkg ? (
          <EmptyState onStart={openConfig} />
        ) : (
          <ExperiencesView
            key={activePkg.id}
            pkg={activePkg}
            onResetSeen={() => {
              (async () => {
                setFetching(true);
                setGenError("");
                try {
                  const result = await api.fetchMianJingExperiences({
                    jobL1: activePkg.jobL1 || "",
                    jobL2: activePkg.jobL2 || "",
                    jobL3: activePkg.jobL3 || "",
                    limit: 10,
                    useCache: false,
                    excludeSeen: true,
                    resetSeen: true,
                  });
                  const pkgId = result.id || "mj_" + Date.now();
                  const roleLabel =
                    [activePkg.jobL1, activePkg.jobL2, activePkg.jobL3]
                      .filter(Boolean)
                      .join(" > ") || activePkg.jobL3;
                  const pkg = {
                    id: pkgId,
                    targetRole: roleLabel,
                    jobL1: activePkg.jobL1 || "",
                    jobL2: activePkg.jobL2 || "",
                    jobL3: activePkg.jobL3 || "",
                    createdAt: result.created_at || new Date().toISOString(),
                    data: result.data || result,
                  };
                  setPackages((prev) => {
                    const next = [pkg, ...prev.filter((p) => p.id !== activePkg.id)];
                    savePackages(next);
                    return next;
                  });
                  setActiveId(pkgId);
                  setFetching(false);
                } catch (e) {
                  setGenError(e.message || "获取面经失败，请稍后重试");
                  setFetching(false);
                  setShowConfig(true);
                }
              })();
            }}
            onRefresh={() => {
              setJobL1(activePkg.jobL1 || "");
              setJobL2(activePkg.jobL2 || "");
              setJobL3(activePkg.jobL3 || "");
              // 直接强制刷新，不走缓存
              (async () => {
                setFetching(true);
                setGenError("");
                try {
                  const result = await api.fetchMianJingExperiences({
                    jobL1: activePkg.jobL1 || "",
                    jobL2: activePkg.jobL2 || "",
                    jobL3: activePkg.jobL3 || "",
                    limit: 10,
                    useCache: false,
                    excludeSeen: true,
                  });
                  const pkgId = result.id || "mj_" + Date.now();
                  const roleLabel =
                    [activePkg.jobL1, activePkg.jobL2, activePkg.jobL3]
                      .filter(Boolean)
                      .join(" > ") || activePkg.jobL3;
                  const pkg = {
                    id: pkgId,
                    targetRole: roleLabel,
                    jobL1: activePkg.jobL1 || "",
                    jobL2: activePkg.jobL2 || "",
                    jobL3: activePkg.jobL3 || "",
                    createdAt: result.created_at || new Date().toISOString(),
                    data: result.data || result,
                  };
                  setPackages((prev) => {
                    const next = [pkg, ...prev.filter((p) => p.id !== activePkg.id)];
                    savePackages(next);
                    return next;
                  });
                  setActiveId(pkgId);
                  setFetching(false);
                } catch (e) {
                  setGenError(e.message || "获取面经失败，请稍后重试");
                  setFetching(false);
                  setShowConfig(true);
                }
              })();
            }}
          />
        )}
      </main>

      {showConfig && (
        <div className="mj-modal-overlay" onClick={() => setShowConfig(false)}>
          <div className="mj-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mj-modal-hd">
              <h3>
                <Sparkles size={18} /> 获取岗位面经
              </h3>
              <button className="mj-modal-close" onClick={() => setShowConfig(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="mj-modal-body">
              <label className="mj-field">
                <span className="mj-field-label">
                  <Target size={14} /> 目标岗位
                </span>
                <JobTypeSelect
                  l1={jobL1}
                  l2={jobL2}
                  l3={jobL3}
                  open={jobOpen}
                  setOpen={setJobOpen}
                  onChange={(nextL1, nextL2, nextL3) => {
                    setJobL1(nextL1);
                    setJobL2(nextL2);
                    setJobL3(nextL3);
                  }}
                />
              </label>
                            {genError && <p className="mj-error">{genError}</p>}
            </div>
            <div className="mj-modal-ft">
              <button className="mj-btn mj-btn-primary" onClick={() => setShowConfig(false)}>
                取消
              </button>
              <button
                className="mj-btn mj-btn-primary"
                disabled={!jobL3}
                onClick={() => handleFetch(false)}
              >
                <Zap size={15} />
                获取面经
              </button>
            </div>
          </div>
        </div>
      )}

      {fetching && (
        <div className="mj-modal-overlay">
          <div className="mj-modal mj-modal-generating">
            {genError ? (
              <>
                <div className="mj-gen-error-icon-wrap">
                  <X size={36} />
                </div>
                <h3>获取失败</h3>
                <p className="mj-gen-error-msg">{genError}</p>
                <button
                  className="mj-btn mj-btn-primary"
                  onClick={() => {
                    setFetching(false);
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
                <h3>正在生成面经中</h3>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ onStart }) {
  return (
    <div className="mj-empty">
      <div className="mj-empty-icon">
        <BookOpen size={48} />
      </div>
      <h2>岗位面经</h2>
      <p>
        选择目标岗位后，自动获取牛客最新约 10 篇有效面经：
        <br />
        面试题内容 · 公司名称 · 是否校招
      </p>
      <button className="mj-btn mj-btn-primary mj-btn-lg" onClick={onStart}>
        <Sparkles size={18} />
        选择岗位并获取
      </button>
    </div>
  );
}

function ExperiencesView({ pkg, onRefresh, onResetSeen }) {
  const data = pkg.data || {};
  const items = data.items || [];
  const meta = data.meta || {};
  const [openMap, setOpenMap] = useState(() => ({}));

  return (
    <div className="mj-pkg">
      <div className="mj-pkg-hd mj-pkg-hd-minimal">
        <div className="mj-pkg-hd-actions">
          <button className="mj-btn mj-btn-ghost" onClick={onRefresh}>
            重新获取
          </button>
        </div>
      </div>

      {meta.error && <p className="mj-error">{meta.error}</p>}
      {meta.note && !meta.error && (
        <p className="mj-gen-hint" style={{ textAlign: "left", marginBottom: 12 }}>
          {meta.note}
        </p>
      )}
      {meta.exhausted && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="mj-btn mj-btn-ghost" onClick={onResetSeen}>
            清空已看记录并重抓
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="mj-empty" style={{ paddingTop: 40 }}>
          <p>暂无有效面经</p>
        </div>
      ) : (
        <div className="mj-lesson-list">
          <div className="mj-lesson-cols" aria-hidden="true">
            <span>面经内容</span>
            <span>公司</span>
            <span className="mj-lesson-cols-arrow" />
          </div>
          {items.map((item, idx) => {
            const open = !!openMap[idx];
            const qText = cleanQuestionsText(item.questions);
            const title = firstLineTitle(item.questions);
            const company = item.company || "未明确面试公司";
            return (
              <div key={item.url || idx} className={`mj-lesson-row${open ? " open" : ""}`}>
                <button
                  type="button"
                  className="mj-lesson-row-main"
                  onClick={() => setOpenMap((m) => ({ ...m, [idx]: !open }))}
                >
                  <div className="mj-lesson-cell mj-lesson-cell-content">
                    <span className="mj-lesson-icon" aria-hidden="true">
                      <BookOpen size={14} />
                    </span>
                    <span className="mj-lesson-title">{title}</span>
                  </div>
                  <div className="mj-lesson-cell mj-lesson-cell-company">
                    <span className="mj-company-name">{company}</span>
                  </div>
                  <span className="mj-lesson-chevron-wrap" aria-hidden="true">
                    {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </button>
                {open && (
                  <div className="mj-lesson-detail">
                    <pre className="mj-exp-pre mj-exp-pre-flat">{qText || "（无）"}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
