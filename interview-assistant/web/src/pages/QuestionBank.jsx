import { useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, ChevronLeft, ChevronRight, ThumbsUp, TriangleAlert } from "lucide-react";
import { api } from "../api.js";
import JobTypeSelect from "../components/JobTypeSelect.jsx";
import QuestionAnalysisTabs from "../components/QuestionAnalysisTabs.jsx";
import { FEATURED_BANK_TREE } from "../data/featuredBankTree.js";
import { getLibraryItems, getMaterials, getResumes } from "./resumeGrower/storage.js";
import { normalizeStructured, structuredToPlainText } from "./resumeGrower/structuredResume.js";

const QB_V2_KEY = "qb_v2_state_v1";
const MASTERY = {
  unknown: "不会",
  vague: "模糊",
  mastered: "掌握",
};

function resumePlainText(resume) {
  if (!resume) return "";
  return (
    structuredToPlainText(normalizeStructured(resume.structured)) ||
    resume.resumeText ||
    resume.rawText ||
    ""
  ).trim();
}

function materialText(item) {
  return (item.content || item.text || item.rawText || "").trim();
}

function listPickableMaterials() {
  const files = (getLibraryItems() || []).filter((x) => x.type !== "folder");
  const seen = new Set(files.map((x) => x.id));
  const old = (getMaterials() || []).filter((m) => m.id && !seen.has(m.id));
  return files.concat(old);
}

function loadV2() {
  try {
    return JSON.parse(localStorage.getItem(QB_V2_KEY) || "null") || {};
  } catch {
    return {};
  }
}

function saveV2(state) {
  try {
    localStorage.setItem(QB_V2_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("保存题库状态失败", e);
  }
}

function formatStudyMs(ms) {
  const sec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟`;
  return `${Math.floor(min / 60)}小时${min % 60}分钟`;
}

function formatWhen(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function historyFp(role, resumeId, materialIds) {
  return `${role || ""}|${resumeId || ""}|${[...(materialIds || [])].sort().join(",")}`;
}

export default function QuestionBank() {
  const resumes = getResumes() || [];
  const materials = listPickableMaterials();
  const saved = useMemo(() => loadV2(), []);

  const [leftTab, setLeftTab] = useState(saved.leftTab || "featured");
  const [openL1, setOpenL1] = useState(saved.featuredL1 || FEATURED_BANK_TREE[0].l1);
  const [featuredL1, setFeaturedL1] = useState(saved.featuredL1 || "");
  const [featuredL2, setFeaturedL2] = useState(saved.featuredL2 || "");
  const [sys, setSys] = useState([]);
  const [sysMatch, setSysMatch] = useState("");
  const [sysError, setSysError] = useState("");
  const [sysLoading, setSysLoading] = useState(false);

  const [jobL1, setJobL1] = useState(saved.jobL1 || "");
  const [jobL2, setJobL2] = useState(saved.jobL2 || "");
  const [jobL3, setJobL3] = useState(saved.jobL3 || "");
  const [jobOpen, setJobOpen] = useState(false);
  const [resumeId, setResumeId] = useState(saved.resumeId || resumes[0]?.id || "");
  const [materialIds, setMaterialIds] = useState(saved.materialIds || []);
  const [matOpen, setMatOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [status, setStatus] = useState("");
  const [history, setHistory] = useState(saved.history || []);
  const [activeHistoryId, setActiveHistoryId] = useState(saved.activeHistoryId || "");

  const [activeId, setActiveId] = useState("");
  const [mastery, setMastery] = useState(saved.mastery || {});
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const matRef = useRef(null);
  const enteredRef = useRef(Date.now());

  const activeHistory = history.find((h) => h.id === activeHistoryId) || null;
  const list = leftTab === "featured" ? sys : activeHistory?.questions || [];
  const activeIndex = list.findIndex((q) => q.id === activeId);
  const active = activeIndex >= 0 ? list[activeIndex] : list[0] || null;
  const currentMastery = active ? mastery[active.id] || "" : "";
  const selectedMaterials = materials.filter((m) => materialIds.includes(m.id));

  useEffect(() => {
    function onDoc(e) {
      if (matRef.current?.contains(e.target)) return;
      setMatOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    saveV2({
      leftTab,
      featuredL1,
      featuredL2,
      jobL1,
      jobL2,
      jobL3,
      resumeId,
      materialIds,
      history,
      activeHistoryId,
      mastery,
    });
  }, [leftTab, featuredL1, featuredL2, jobL1, jobL2, jobL3, resumeId, materialIds, history, activeHistoryId, mastery]);

  useEffect(() => {
    const entered = Date.now();
    enteredRef.current = entered;
    return () => {
      const extra = Date.now() - entered;
      const prev = loadV2();
      const hid = prev.activeHistoryId;
      if (!hid || prev.leftTab !== "personal") return;
      saveV2({
        ...prev,
        history: (prev.history || []).map((h) =>
          h.id === hid ? { ...h, studyMs: (h.studyMs || 0) + extra } : h
        ),
      });
    };
  }, []);

  useEffect(() => {
    if (!list.length) return;
    if (!list.some((q) => q.id === activeId)) setActiveId(list[0].id);
  }, [leftTab, list, activeId]);

  useEffect(() => {
    if (leftTab !== "featured" || !featuredL2) return undefined;
    let cancelled = false;
    setSysLoading(true);
    setSys([]);
    setSysError("");
    api
      .featuredQuestions({ l1: featuredL1, l2: featuredL2 })
      .then((data) => {
        if (cancelled) return;
        if (data.error && data.ok === false) throw new Error(data.error);
        const questions = data.questions || [];
        setSys(questions);
        setSysMatch(data.match || (questions.length ? "exact" : "miss"));
        setSysError(data.error || "");
        setActiveId(questions[0]?.id || "");
      })
      .catch((e) => {
        if (cancelled) return;
        setSys([]);
        setSysMatch("error");
        setSysError(e.message || "加载失败");
      })
      .finally(() => {
        if (!cancelled) setSysLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leftTab, featuredL1, featuredL2]);

  function selectFeatured(l1, l2) {
    setLeftTab("featured");
    setOpenL1(l1);
    setFeaturedL1(l1);
    setFeaturedL2(l2);
    setGenError("");
  }

  function selectHistory(id) {
    setLeftTab("personal");
    setActiveHistoryId(id);
    const rec = history.find((h) => h.id === id);
    setActiveId(rec?.questions?.[0]?.id || "");
    setGenError("");
  }

  function patchActiveHistory(updater) {
    setHistory((prev) =>
      prev.map((h) => (h.id === activeHistoryId ? updater(h) : h))
    );
  }

  function toggleMaterial(id) {
    setMaterialIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleFetchPersonal() {
    if (!jobL3) {
      setStatus("请选择目标岗位");
      return;
    }
    const resume = resumes.find((r) => r.id === resumeId);
    const text = resumePlainText(resume);
    if (!text) {
      setStatus(resume ? "该简历没有正文，请先到「我的简历」完善" : "请选择简历");
      return;
    }
    setFetching(true);
    setStatus("");
    try {
      const payloadMaterials = selectedMaterials.map((m) => ({
        name: m.name || "材料",
        content: materialText(m).slice(0, 5000),
      }));
      const data = await api.sessionPersonal({
        job_l1: jobL1,
        job_l2: jobL2,
        job_l3: jobL3,
        resume_id: resumeId,
        resume_text: text.slice(0, 18000),
        materials: payloadMaterials,
      });
      if (data.error || data.ok === false) throw new Error(data.error || "获取失败");
      const questions = data.questions || [];
      const role = [jobL1, jobL2, jobL3].filter(Boolean).join(" > ");
      const fp = historyFp(role, resumeId, materialIds);
      const rec = {
        id: `h_${Date.now()}`,
        fp,
        createdAt: Date.now(),
        job_l1: jobL1,
        job_l2: jobL2,
        job_l3: jobL3,
        role,
        resumeId,
        resumeName: resume.name || "未命名简历",
        resumeText: text.slice(0, 18000),
        materialIds: [...materialIds],
        materialNames: selectedMaterials.map((m) => m.name || "材料"),
        questions,
        studyMs: 0,
      };
      setHistory((prev) => {
        const old = prev.find((h) => h.fp === fp);
        if (old) {
          rec.studyMs = old.studyMs || 0;
          rec.questions = questions.map((q) => {
            const prevQ = (old.questions || []).find((x) => x.id === q.id || x.question === q.question);
            return prevQ?.tabs && !q.tabs ? { ...q, tabs: prevQ.tabs } : q;
          });
        }
        return [rec, ...prev.filter((h) => h.fp !== fp)].slice(0, 20);
      });
      setActiveHistoryId(rec.id);
      setActiveId(questions[0]?.id || "");
      setLeftTab("personal");
    } catch (e) {
      setStatus(e.message || "获取失败");
    } finally {
      setFetching(false);
    }
  }

  function selectItem(id) {
    setActiveId(id);
    setGenError("");
  }

  function goRelative(delta) {
    if (!list.length) return;
    const idx = Math.max(0, activeIndex);
    const next = list[idx + delta];
    if (next) selectItem(next.id);
  }

  function setCurrentMastery(key) {
    if (!active) return;
    setMastery((prev) => ({ ...prev, [active.id]: key }));
  }

  async function handleGenerate() {
    if (!active || leftTab !== "personal" || !activeHistory) return;
    setGenerating(true);
    setGenError("");
    try {
      const data = await api.analyzeQuestion(active.id, {
        role: activeHistory.role,
        resume_text: activeHistory.resumeText || "",
        question: active.question,
      });
      if (data.error || data.ok === false) throw new Error(data.error || "生成失败，请重试");
      patchActiveHistory((h) => ({
        ...h,
        questions: (h.questions || []).map((q) => (q.id === active.id ? { ...q, tabs: data.tabs } : q)),
      }));
    } catch (e) {
      setGenError(e.message || "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  }

  const midHint = (() => {
    if (leftTab === "featured") {
      if (!featuredL2) return "请在左侧选择岗位方向";
      if (sysLoading) return "正在加载精选题目…";
      if (sysError) return sysError;
      if (sysMatch === "miss" || !list.length) return "该方向题目即将补充";
      return "";
    }
    if (fetching) return "正在根据简历和材料生成专属题目…";
    if (!activeHistory) return "填写左侧信息后点击「获取专属题目」";
    if (!list.length) return "暂无专属题目";
    return "";
  })();

  return (
    <main className="page qb-v2-page">
      <div className="qb-v2-body">
        <aside className="qb-v2-left">
          <div className="qb-studio-left-tabs">
            <button
              type="button"
              className={leftTab === "featured" ? "on" : ""}
              onClick={() => setLeftTab("featured")}
            >
              精选题目
            </button>
            <button
              type="button"
              className={leftTab === "personal" ? "on" : ""}
              onClick={() => setLeftTab("personal")}
            >
              专属题目
            </button>
          </div>

          {leftTab === "featured" ? (
            <div className="qb-v2-tree">
              {FEATURED_BANK_TREE.map((group) => (
                <div key={group.l1} className="qb-v2-l1-block">
                  <button
                    type="button"
                    className={`qb-v2-l1${openL1 === group.l1 ? " open" : ""}`}
                    onClick={() => setOpenL1((cur) => (cur === group.l1 ? "" : group.l1))}
                  >
                    {group.l1}
                  </button>
                  {openL1 === group.l1 &&
                    group.children.map((item) => (
                      <button
                        key={item.l2}
                        type="button"
                        className={`qb-v2-l2${featuredL2 === item.l2 ? " on" : ""}`}
                        onClick={() => selectFeatured(group.l1, item.l2)}
                      >
                        {item.l2}
                      </button>
                    ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="qb-v2-personal">
              <div className="qb-v2-field">
                <label>目标岗位</label>
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
              </div>
              <div className="qb-v2-field">
                <label htmlFor="qb-resume">求职简历</label>
                <select id="qb-resume" value={resumeId} onChange={(e) => setResumeId(e.target.value)}>
                  {!resumes.length && <option value="">暂无简历</option>}
                  {resumes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name || "未命名简历"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="qb-v2-field" ref={matRef}>
                <label>我的材料</label>
                <button type="button" className="qb-v2-multi" onClick={() => setMatOpen((v) => !v)}>
                  {selectedMaterials.length
                    ? selectedMaterials.map((m) => (
                        <span key={m.id} className="qb-v2-tag">
                          {m.name || "材料"}
                        </span>
                      ))
                    : <span className="qb-v2-ph">从资料库选择</span>}
                </button>
                {matOpen && (
                  <div className="qb-v2-mat-pop">
                    {!materials.length && <p className="qb-studio-hint">资料库暂无材料</p>}
                    {materials.map((m) => (
                      <label key={m.id} className="qb-v2-mat-opt">
                        <input
                          type="checkbox"
                          checked={materialIds.includes(m.id)}
                          onChange={() => toggleMaterial(m.id)}
                        />
                        <span>{m.name || "未命名"}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="btn primary qb-v2-fetch"
                disabled={fetching}
                onClick={handleFetchPersonal}
              >
                {fetching ? "获取中…" : "获取专属题目"}
              </button>
              {status && <p className="qb-studio-hint">{status}</p>}
              {!resumes.length && <p className="qb-studio-hint">还没有简历，请先到「我的简历」上传。</p>}
              <div className="qb-v2-hist">
                <h3>历史记录</h3>
                {!history.length && <p className="qb-studio-hint">获取后将在此展示记录</p>}
                {history.map((h) => {
                  const mastered = (h.questions || []).filter((q) => mastery[q.id] === "mastered").length;
                  return (
                    <button
                      key={h.id}
                      type="button"
                      className={`qb-v2-hist-item${h.id === activeHistoryId ? " on" : ""}`}
                      onClick={() => selectHistory(h.id)}
                    >
                      <strong>{h.job_l3 || h.role || "未选岗位"}</strong>
                      <span>
                        {h.resumeName}
                        {h.materialNames?.length ? ` · 材料${h.materialNames.length}` : ""}
                      </span>
                      <span>
                        {h.questions?.length || 0}题 · 掌握{mastered} · {formatStudyMs(h.studyMs)}
                      </span>
                      <em>{formatWhen(h.createdAt)}</em>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </aside>

        <aside className="qb-v2-mid">
          <div className="qb-studio-left-hd">
            <h1>题目列表</h1>
            <p>
              {leftTab === "featured"
                ? featuredL2 || "未选方向"
                : activeHistory
                  ? `${activeHistory.job_l3 || ""} · ${activeHistory.resumeName || ""}`
                  : "未生成"}
            </p>
          </div>
          <div className="qb-studio-list">
            {midHint && <p className="qb-studio-hint">{midHint}</p>}
            {list.map((q, i) => (
              <button
                key={q.id}
                type="button"
                className={`qb-studio-item${q.id === active?.id ? " on" : ""}`}
                onClick={() => selectItem(q.id)}
              >
                <span className="qb-studio-idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="qb-studio-qwrap">
                  <span className="qb-studio-q">{q.question}</span>
                  <em className={`qb-mastery-tag ${mastery[q.id] || "idle"}`}>
                    {MASTERY[mastery[q.id]] || "未练"}
                  </em>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="qb-studio-right">
          {active ? (
            <QuestionAnalysisTabs
              question={active.question}
              tabs={active.tabs}
              needGenerate={leftTab === "personal" && !active.tabs}
              generating={generating}
              onGenerate={handleGenerate}
              error={genError}
            />
          ) : (
            <div className="qb-studio-empty">
              <h3>{leftTab === "featured" ? "请选择左侧岗位方向" : "请获取或选择专属题目"}</h3>
            </div>
          )}
        </section>
      </div>
      <footer className="qb-studio-bar">
        <button
          type="button"
          className={`qb-bar-btn unknown${currentMastery === "unknown" ? " on" : ""}`}
          disabled={!active}
          onClick={() => setCurrentMastery("unknown")}
        >
          <CircleHelp size={16} />
          不会
        </button>
        <button
          type="button"
          className={`qb-bar-btn vague${currentMastery === "vague" ? " on" : ""}`}
          disabled={!active}
          onClick={() => setCurrentMastery("vague")}
        >
          <TriangleAlert size={16} />
          模糊
        </button>
        <button
          type="button"
          className={`qb-bar-btn mastered${currentMastery === "mastered" ? " on" : ""}`}
          disabled={!active}
          onClick={() => setCurrentMastery("mastered")}
        >
          <ThumbsUp size={16} />
          掌握
        </button>
        <button
          type="button"
          className="qb-bar-btn nav"
          disabled={!active || activeIndex <= 0}
          onClick={() => goRelative(-1)}
        >
          <ChevronLeft size={16} />
          上一题
        </button>
        <button
          type="button"
          className="qb-bar-btn nav"
          disabled={!active || activeIndex < 0 || activeIndex >= list.length - 1}
          onClick={() => goRelative(1)}
        >
          下一题
          <ChevronRight size={16} />
        </button>
      </footer>
    </main>
  );
}
