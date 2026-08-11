import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { api } from "../api.js";
import { getMaterials, getResumes } from "./resumeGrower/storage.js";
import { normalizeStructured, structuredToPlainText } from "./resumeGrower/structuredResume.js";

const ROLE_OPTIONS = [
  "后端工程师",
  "前端工程师",
  "Java工程师",
  "AI应用工程师",
  "产品经理",
  "数据分析师",
  "测试开发工程师",
  "算法工程师",
];

const YEAR_OPTIONS = [
  { value: "0-1", label: "应届 / 0-1 年" },
  { value: "1-3", label: "1-3 年" },
  { value: "3-5", label: "3-5 年" },
  { value: "5-10", label: "5-10 年" },
  { value: "10+", label: "10 年以上" },
];

const CATEGORY_COLORS = {
  行为面: "purple",
  技术面: "blue",
  场景题: "cyan",
  项目深挖: "orange",
  高频考点: "pink",
  算法: "green",
  岗位认知: "slate",
  反问: "amber",
  JD匹配: "green",
};

function normalizeQuestions(items = [], source = "sys") {
  return (items || []).map((item, index) => {
    const questionText = item.questionText || item.question || "";
    const category = item.category || inferCategory(questionText, source, index);
    return {
      id: item.id || item.question_id || `${source}-${index}`,
      category,
      categoryColor: CATEGORY_COLORS[category] || "slate",
      questionText,
      answerText: item.answerText || item.answer || "暂无参考回答。",
      level: item.difficulty || item.level || "",
      source,
    };
  });
}

function inferCategory(text, source, index) {
  if (/项目|经历|贡献|难点|挑战/.test(text)) return "项目深挖";
  if (/算法|复杂度|数据结构/.test(text)) return "算法";
  if (/场景|如果|如何处理|线上|事故|推进/.test(text)) return "场景题";
  if (/优势|不足|分歧|职业规划|自我介绍|为什么/.test(text)) return "行为面";
  if (/技术|架构|系统|性能|数据库|Redis|React|Java/.test(text)) return "技术面";
  if (/反问|想问/.test(text)) return "反问";
  if (source === "jd" || index % 4 === 0) return "高频考点";
  return "岗位认知";
}

function pageTitle(num) {
  if (num === 1) return "系统题库";
  if (num === 2) return "简历&材料生成";
  return "JD专项";
}

function pageKey(num) {
  if (num === 1) return "sys";
  if (num === 2) return "resume";
  return "jd";
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameMatchesQuery(name, query) {
  const q = (query || "").trim();
  if (!q) return true;
  try {
    return new RegExp(escapeRegExp(q), "i").test(String(name || ""));
  } catch {
    return String(name || "").toLowerCase().includes(q.toLowerCase());
  }
}

function collectAssetOptions() {
  const resumes = (getResumes() || []).map((r) => ({
    id: `resume:${r.id}`,
    kind: "resume",
    resumeId: r.id,
    name: r.name || "未命名简历",
  }));
  const materials = (getMaterials() || []).map((m) => ({
    id: `material:${m.id}`,
    kind: "material",
    materialId: m.id,
    name: m.name || "未命名材料",
  }));
  return { resumes, materials };
}

function buildResumeText(selectedIds, options) {
  const parts = [];
  for (const id of selectedIds) {
    const opt = [...options.resumes, ...options.materials].find((x) => x.id === id);
    if (!opt || opt.kind !== "resume") continue;
    const r = getResumes().find((x) => x.id === opt.resumeId);
    if (!r) continue;
    const plain =
      structuredToPlainText(normalizeStructured(r.structured)) || r.resumeText || r.rawText || "";
    if (plain.trim()) parts.push(`【简历：${r.name || "未命名"}】\n${plain.trim()}`);
  }
  return parts.join("\n\n").slice(0, 18000);
}

function buildMaterialsPayload(selectedIds, options) {
  const out = [];
  for (const id of selectedIds) {
    const opt = [...options.resumes, ...options.materials].find((x) => x.id === id);
    if (!opt || opt.kind !== "material") continue;
    const m = getMaterials().find((x) => x.id === opt.materialId);
    if (!m) continue;
    out.push({
      name: m.name || "材料",
      kind: "材料",
      content: String(m.content || m.facts || "").slice(0, 5000),
    });
  }
  return out;
}

function QuestionCard({ category, categoryColor, questionText, answerText, level }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className={`qb-uni-item${expanded ? " open" : ""}`}>
      <button type="button" className="qb-uni-main" onClick={() => setExpanded((v) => !v)}>
        <span className={`category-badge ${categoryColor || "slate"}`}>{category}</span>
        <div>
          <div className="qb-uni-title">{questionText}</div>
          {level ? <div className="qb-uni-level">难度 {level}</div> : null}
        </div>
        <ChevronDown size={16} className="qb-uni-chevron" />
      </button>
      {expanded && (
        <div className="qb-uni-ans">
          <h5>参考回答</h5>
          {(answerText || "").split(/\n\s*\n/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
    </article>
  );
}

function Pager({ pageNum, total, onGo }) {
  const [jump, setJump] = useState(String(pageNum));
  useEffect(() => {
    setJump(String(pageNum));
  }, [pageNum]);

  const nums = [];
  for (let i = 1; i <= total; i++) nums.push(i);

  return (
    <nav className="qb-uni-pager" aria-label="题目分页">
      <button
        type="button"
        className="qb-pager-btn"
        disabled={pageNum <= 1}
        onClick={() => onGo(pageNum - 1)}
        aria-label="上一页"
      >
        ‹
      </button>
      {nums.map((n) => (
        <button
          key={n}
          type="button"
          className={`qb-pager-btn${n === pageNum ? " active" : ""}`}
          onClick={() => onGo(n)}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        className="qb-pager-btn"
        disabled={pageNum >= total}
        onClick={() => onGo(pageNum + 1)}
        aria-label="下一页"
      >
        ›
      </button>
      <span className="qb-pager-jump">
        前往
        <input
          type="text"
          inputMode="numeric"
          value={jump}
          onChange={(e) => setJump(e.target.value.replace(/[^\d]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "Enter") onGo(Number(jump) || 1);
          }}
          onBlur={() => onGo(Number(jump) || 1)}
          aria-label="页码"
        />
        页
      </span>
    </nav>
  );
}

export default function QuestionBank() {
  const [assetTick, setAssetTick] = useState(0);
  const assetOptions = useMemo(() => collectAssetOptions(), [assetTick]);
  const [role, setRole] = useState("数据分析师");
  const [roleOpen, setRoleOpen] = useState(false);
  const [years, setYears] = useState("1-3");
  const [hasJd, setHasJd] = useState("no");
  const [jdText, setJdText] = useState("");
  const [selected, setSelected] = useState(() => {
    const { resumes, materials } = collectAssetOptions();
    const init = new Set();
    if (resumes[0]) init.add(resumes[0].id);
    materials.slice(0, 2).forEach((m) => init.add(m.id));
    return init;
  });
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetQuery, setAssetQuery] = useState("");
  const assetWrapRef = useRef(null);
  const assetInputRef = useRef(null);

  const [session, setSession] = useState(null);
  const [pageNum, setPageNum] = useState(1);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState("");

  const roleFiltered = ROLE_OPTIONS.filter((r) => !role.trim() || r.includes(role.trim()));
  const totalPages = session ? (session.hasJd ? 3 : 2) : 0;
  const assetQ = assetQuery.trim();
  const filteredResumes = useMemo(
    () => assetOptions.resumes.filter((r) => nameMatchesQuery(r.name, assetQ)),
    [assetOptions.resumes, assetQ]
  );
  const filteredMaterials = useMemo(
    () => assetOptions.materials.filter((m) => nameMatchesQuery(m.name, assetQ)),
    [assetOptions.materials, assetQ]
  );

  useEffect(() => {
    function onDoc(e) {
      if (!assetWrapRef.current?.contains(e.target)) {
        setAssetOpen(false);
        setAssetQuery("");
      }
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  function openAssetPicker() {
    setAssetTick((n) => n + 1);
    setAssetOpen(true);
    setTimeout(() => assetInputRef.current?.focus(), 0);
  }

  function toggleAsset(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function removeAsset(id, e) {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleFetch() {
    const roleName = role.trim() || "未命名岗位";
    if (hasJd === "yes" && !jdText.trim()) {
      setStatus("已选择有目标 JD，请先粘贴 JD 文本");
      return;
    }
    if (!selected.size) {
      setStatus("请至少选择一份简历或材料");
      return;
    }
    setFetching(true);
    setStatus("");
    try {
      const data = await api.sessionSysQuestions({
        role: roleName,
        years,
        limit: 12,
      });
      if (data.error) throw new Error(data.error);
      const sysItems = normalizeQuestions(data.questions || [], "sys");
      setSession({
        role: roleName,
        years,
        hasJd: hasJd === "yes",
        jdText: jdText.trim(),
        assetIds: [...selected],
        match: data.match || "exact",
        pages: {
          sys: { status: "ready", items: sysItems },
          resume: { status: "idle", items: [] },
          jd: { status: hasJd === "yes" ? "idle" : "skip", items: [] },
        },
      });
      setPageNum(1);
      setStatus(
        data.match === "exact"
          ? "已拉取系统题库（第1页）"
          : data.match === "weak"
            ? "已拉取系统题库（年数弱匹配）"
            : "已拉取系统题库（通用兜底）"
      );
    } catch (e) {
      setStatus(e.message || "获取失败");
    } finally {
      setFetching(false);
    }
  }

  async function ensurePage(num) {
    if (!session) return;
    const key = pageKey(num);
    if (key === "sys") return;
    const bucket = session.pages[key];
    if (!bucket || bucket.status === "ready" || bucket.status === "loading" || bucket.status === "skip") {
      return;
    }

    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: {
          ...prev.pages,
          [key]: { ...prev.pages[key], status: "loading", error: "" },
        },
      };
    });

    try {
      let data;
      if (key === "resume") {
        data = await api.sessionFromAssets({
          role: session.role,
          years: session.years,
          resume_text: buildResumeText(session.assetIds, assetOptions),
          materials: buildMaterialsPayload(session.assetIds, assetOptions),
        });
      } else {
        data = await api.sessionFromJd({
          role: session.role,
          years: session.years,
          jd_text: session.jdText,
        });
      }
      if (data.error || data.ok === false) throw new Error(data.error || "生成失败");
      const items = normalizeQuestions(data.questions || [], key);
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: {
            ...prev.pages,
            [key]: { status: "ready", items, error: "" },
          },
        };
      });
      setStatus(key === "resume" ? "简历&材料题已生成" : "JD 专项题已生成");
    } catch (e) {
      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          pages: {
            ...prev.pages,
            [key]: { status: "error", items: [], error: e.message || "生成失败" },
          },
        };
      });
      setStatus(e.message || "生成失败");
    }
  }

  async function goToPage(num) {
    if (!session) return;
    const total = session.hasJd ? 3 : 2;
    const n = Math.max(1, Math.min(total, Number(num) || 1));
    setPageNum(n);
    await ensurePage(n);
  }

  const currentBucket = session?.pages?.[pageKey(pageNum)];
  const selectedList = [...selected]
    .map((id) => [...assetOptions.resumes, ...assetOptions.materials].find((x) => x.id === id))
    .filter(Boolean);

  return (
    <main className="page qb-page qb-uni-page">
      <div className="qb-uni-head">
        <h1>我的题库</h1>
        <p>一次配置岗位 / 简历材料 / 年数 / JD，按来源分页查看题目。</p>
      </div>

      <section className="card qb-uni-filter">
        <div className="qb-uni-filter-row">
          <div className="qb-uni-field" style={{ position: "relative" }}>
            <label htmlFor="qb-role">目标岗位</label>
            <input
              id="qb-role"
              value={role}
              placeholder="下拉选择或手动输入"
              autoComplete="off"
              onFocus={() => setRoleOpen(true)}
              onChange={(e) => {
                setRole(e.target.value);
                setRoleOpen(true);
              }}
              onBlur={() => setTimeout(() => setRoleOpen(false), 150)}
            />
            {roleOpen && roleFiltered.length > 0 && (
              <div className="qb-uni-combo">
                {roleFiltered.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setRole(r);
                      setRoleOpen(false);
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="qb-uni-field">
            <label htmlFor="qb-asset-search">选择简历和材料</label>
            <div className="qb-uni-asset-wrap" ref={assetWrapRef}>
              <div className="qb-uni-multi" onClick={openAssetPicker}>
                {selectedList.map((item) => (
                  <span className="qb-uni-tag" key={item.id}>
                    {item.name}
                    <button type="button" onClick={(e) => removeAsset(item.id, e)}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  id="qb-asset-search"
                  ref={assetInputRef}
                  className="qb-uni-asset-input"
                  type="text"
                  value={assetQuery}
                  placeholder={selectedList.length ? "输入名称搜索…" : "输入名称搜索，或点击选择…"}
                  onChange={(e) => {
                    setAssetQuery(e.target.value);
                    setAssetTick((n) => n + 1);
                    setAssetOpen(true);
                  }}
                  onFocus={openAssetPicker}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              {assetOpen && (
                <div className="qb-uni-pop" onClick={(e) => e.stopPropagation()}>
                  <div className="qb-uni-pop-scroll">
                    <div className="qb-uni-pop-sec">简历{assetQ ? ` · 匹配 ${filteredResumes.length}` : ""}</div>
                    {assetOptions.resumes.length === 0 && (
                      <p className="qb-uni-pop-empty">暂无简历，请先到「我的简历」上传</p>
                    )}
                    {assetOptions.resumes.length > 0 && filteredResumes.length === 0 && (
                      <p className="qb-uni-pop-empty">无匹配简历</p>
                    )}
                    {filteredResumes.map((r) => (
                      <label key={r.id} className="qb-uni-opt">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleAsset(r.id)}
                        />
                        <span className="qb-uni-check" aria-hidden="true" />
                        <span className="qb-uni-opt-name" title={r.name}>{r.name}</span>
                      </label>
                    ))}
                    <div className="qb-uni-pop-sec">材料{assetQ ? ` · 匹配 ${filteredMaterials.length}` : ""}</div>
                    {assetOptions.materials.length === 0 && (
                      <p className="qb-uni-pop-empty">暂无材料</p>
                    )}
                    {assetOptions.materials.length > 0 && filteredMaterials.length === 0 && (
                      <p className="qb-uni-pop-empty">无匹配材料</p>
                    )}
                    {filteredMaterials.map((m) => (
                      <label key={m.id} className="qb-uni-opt">
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggleAsset(m.id)}
                        />
                        <span className="qb-uni-check" aria-hidden="true" />
                        <span className="qb-uni-opt-name" title={m.name}>{m.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="qb-uni-field">
            <label htmlFor="qb-years">该岗位工作年数</label>
            <select id="qb-years" value={years} onChange={(e) => setYears(e.target.value)}>
              {YEAR_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="qb-uni-field">
            <label htmlFor="qb-has-jd">是否有目标 JD</label>
            <select id="qb-has-jd" value={hasJd} onChange={(e) => setHasJd(e.target.value)}>
              <option value="no">无</option>
              <option value="yes">有</option>
            </select>
          </div>

          <div className="qb-uni-field qb-uni-cta">
            <label aria-hidden="true">&nbsp;</label>
            <button type="button" className="btn primary" disabled={fetching} onClick={handleFetch}>
              {fetching ? "获取中…" : "获取面试题"}
            </button>
          </div>
        </div>

        {hasJd === "yes" && (
          <div className="qb-uni-field qb-uni-jd">
            <label htmlFor="qb-jd">粘贴岗位 JD</label>
            <textarea
              id="qb-jd"
              rows={6}
              placeholder="把完整职位描述粘贴到这里…"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
            />
          </div>
        )}
        {status && <p className="status-line">{status}</p>}
      </section>

      <section className="card qb-uni-result">
        {!session && (
          <div className="qb-uni-empty">
            <h3>还没有题目</h3>
            <p>先完成上方筛选，再点「获取面试题」。系统题库会立刻出现在第 1 页。</p>
          </div>
        )}

        {session && (
          <>
            <div className="qb-uni-meta">
              岗位：{session.role} · 年数：{session.years} · 已选资产 {session.assetIds.length} 项
              {session.hasJd ? " · 含 JD" : " · 无 JD"}
              <span className="qb-uni-source">
                当前：第 {pageNum} 页 · {pageTitle(pageNum)}
              </span>
            </div>

            {currentBucket?.status === "loading" && (
              <div className="qb-uni-loading">
                <strong>
                  <Loader2 size={16} className="spin" /> 正在快马加鞭生成题目…
                </strong>
                <p>
                  {pageKey(pageNum) === "jd"
                    ? "正在根据 JD 生成专项题，请稍候…"
                    : "正在根据简历和材料生成专属题，请稍候…"}
                </p>
                <div className="qb-uni-skel" />
                <div className="qb-uni-skel" />
                <div className="qb-uni-skel" />
              </div>
            )}

            {currentBucket?.status === "error" && (
              <div className="qb-uni-empty">
                <h3>生成失败</h3>
                <p>{currentBucket.error || "请稍后重试"}</p>
                <button type="button" className="btn" onClick={() => ensurePage(pageNum)}>
                  重试
                </button>
              </div>
            )}

            {currentBucket?.status === "ready" && (
              <div className="qb-uni-list">
                {(currentBucket.items || []).length === 0 ? (
                  <div className="qb-uni-empty">
                    <h3>本页暂无题目</h3>
                    <p>可换一页或调整筛选后重新获取。</p>
                  </div>
                ) : (
                  currentBucket.items.map((q) => (
                    <QuestionCard
                      key={q.id}
                      category={q.category}
                      categoryColor={q.categoryColor}
                      questionText={q.questionText}
                      answerText={q.answerText}
                      level={q.level}
                    />
                  ))
                )}
              </div>
            )}

            {(currentBucket?.status === "idle" || !currentBucket) && pageNum > 1 && (
              <div className="qb-uni-empty">
                <h3>尚未生成</h3>
                <p>进入本页将触发生成。</p>
              </div>
            )}

            <Pager pageNum={pageNum} total={totalPages} onGo={goToPage} />
          </>
        )}
      </section>
    </main>
  );
}
