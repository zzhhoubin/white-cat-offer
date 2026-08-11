import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Maximize2, Tag, Trash2, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { api } from "../../api.js";
import {
  collectResumeProjects,
  createLibraryTag,
  deleteProjectPack,
  getLibraryItem,
  getLibraryTags,
  getMaterialsTabHiddenIds,
  getProjectPacks,
  getResumes,
  hideMaterialFromMaterialsTab,
  listLibraryFiles,
  setLibraryFileTags,
  setProjectPacks,
  upsertProjectPack,
  upsertResume,
} from "./storage.js";
import { normalizeStructured, structuredToPlainText } from "./structuredResume.js";

function packCollisionDetection(args) {
  const hits = pointerWithin(args);
  if (hits.length) {
    const packHits = hits.filter((c) => String(c.id).startsWith("packdrop_"));
    if (packHits.length) return packHits;
  }
  return closestCorners(args).filter((c) => String(c.id).startsWith("packdrop_"));
}

function emptyAnalysis() {
  return {
    status: "idle",
    resume_desc: null,
    oral_script: "",
    deep_questions: [],
    error: "",
  };
}

function makePack(name = "未命名资料包") {
  return {
    id: "pack_" + Date.now(),
    name,
    resumeProject: null,
    materialIds: [],
    analysis: emptyAnalysis(),
    updated: new Date().toISOString().slice(0, 10),
  };
}

function DraggableCard({ id, type, children, className }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { type },
  });
  return (
    <div
      ref={setNodeRef}
      className={`${className || ""}${isDragging ? " dragging" : ""}`}
      style={{ opacity: isDragging ? 0.45 : 1, cursor: "grab" }}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

function Droppable({ id, className, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${className || ""}${isOver ? " over" : ""}`}>
      {children}
    </div>
  );
}

export default function MaterialsTab({ onStatus }) {
  const navigate = useNavigate();
  const [packs, setPacks] = useState(() => getProjectPacks());
  const [activePackId, setActivePackId] = useState(() => getProjectPacks()[0]?.id || null);
  const [resultTab, setResultTab] = useState("desc");
  const [analyzingId, setAnalyzingId] = useState("");
  const [applyResumeId, setApplyResumeId] = useState("");
  const [dragLabel, setDragLabel] = useState("");
  const [libTick, setLibTick] = useState(0);
  const [filterResumeId, setFilterResumeId] = useState("");
  const [groupByTag, setGroupByTag] = useState(true);
  const [tagEditId, setTagEditId] = useState(null);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);

  const resumes = useMemo(() => getResumes(), [packs, libTick]);
  const libraryFiles = useMemo(() => {
    const hidden = new Set(getMaterialsTabHiddenIds());
    return listLibraryFiles().filter((f) => !hidden.has(f.id));
  }, [libTick]);
  const tags = useMemo(() => getLibraryTags(), [libTick]);
  const tagMap = useMemo(() => Object.fromEntries(tags.map((t) => [t.id, t])), [tags]);

  const allResumeProjects = useMemo(() => collectResumeProjects(resumes), [resumes]);
  const resumeProjects = useMemo(() => {
    if (!filterResumeId) return [];
    return allResumeProjects.filter((p) => p.resumeId === filterResumeId);
  }, [allResumeProjects, filterResumeId]);
  const activePack = packs.find((p) => p.id === activePackId) || null;

  const groupedFiles = useMemo(() => {
    if (!groupByTag) {
      return [{ key: "all", title: null, files: libraryFiles }];
    }
    const used = new Set();
    const groups = tags.map((t) => {
      const files = libraryFiles.filter((f) => (f.tagIds || []).includes(t.id));
      files.forEach((f) => used.add(f.id));
      return { key: t.id, title: t.name, files };
    });
    const untagged = libraryFiles.filter((f) => !used.has(f.id));
    groups.push({ key: "untagged", title: "未分类", files: untagged });
    return groups.filter((g) => g.files.length > 0 || g.key === "untagged");
  }, [groupByTag, libraryFiles, tags]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!resumes.length) {
      setFilterResumeId("");
      return;
    }
    if (!filterResumeId || !resumes.some((r) => r.id === filterResumeId)) {
      setFilterResumeId(resumes[0].id);
    }
  }, [resumes, filterResumeId]);

  useEffect(() => {
    if (!packs.length) {
      setActivePackId(null);
      return;
    }
    if (!packs.some((p) => p.id === activePackId)) setActivePackId(packs[0].id);
  }, [packs, activePackId]);

  useEffect(() => {
    setAnalysisExpanded(false);
  }, [activePackId]);

  function refreshLib() {
    setLibTick((n) => n + 1);
  }

  function saveList(list) {
    setProjectPacks(list);
    setPacks(list);
  }

  function patchPack(id, patch) {
    const list = getProjectPacks().map((p) =>
      p.id === id ? { ...p, ...patch, updated: new Date().toISOString().slice(0, 10) } : p
    );
    saveList(list);
    return list.find((p) => p.id === id);
  }

  function createPack() {
    const pack = makePack(`资料包 ${packs.length + 1}`);
    upsertProjectPack(pack);
    const list = getProjectPacks();
    setPacks(list);
    setActivePackId(pack.id);
    onStatus?.(`已新建资料包（共 ${list.length} 个）`);
  }

  function handleDeletePack(packId, packName) {
    if (!packId) return;
    if (!window.confirm(`确定删除资料包「${packName || "未命名"}」？仅删除资料包，不会删除包内资料文件。`)) return;
    const list = deleteProjectPack(packId);
    setPacks(list);
    if (activePackId === packId) {
      setActivePackId(list[0]?.id || null);
    }
    onStatus?.(`已删除资料包「${packName || "未命名"}」（包内资料仍保留在资料库）`);
  }

  function addProjectToPack(packId, project) {
    patchPack(packId, {
      resumeProject: {
        id: project.id,
        resumeId: project.resumeId,
        resumeName: project.resumeName,
        projectIndex: project.projectIndex,
        name: project.name,
        role: project.role,
        company: project.company,
        intro: project.intro,
        responsibilities: project.responsibilities,
        achievements: project.achievements,
        bullets: project.bullets,
        start: project.start,
        end: project.end,
      },
      name: project.name || undefined,
    });
    setActivePackId(packId);
    onStatus?.(`已加入简历项目：${project.name}`);
  }

  function addMaterialToPack(packId, materialId) {
    const pack = packs.find((p) => p.id === packId) || getProjectPacks().find((p) => p.id === packId);
    if (!pack) return;
    const ids = pack.materialIds.includes(materialId)
      ? pack.materialIds
      : [...pack.materialIds, materialId];
    patchPack(packId, { materialIds: ids });
    setActivePackId(packId);
    onStatus?.("已加入资料");
  }

  function removeMaterialFromPack(materialId) {
    if (!activePack) return;
    patchPack(activePack.id, {
      materialIds: activePack.materialIds.filter((x) => x !== materialId),
    });
  }

  function clearResumeProject() {
    if (!activePack) return;
    patchPack(activePack.id, { resumeProject: null });
  }

  function handleCreateTag() {
    const name = window.prompt("新建分类标签");
    if (name == null) return;
    const tag = createLibraryTag(name);
    if (!tag) {
      onStatus?.("标签名无效");
      return;
    }
    refreshLib();
    onStatus?.(`已创建标签：${tag.name}`);
  }

  function toggleFileTag(fileId, tagId) {
    const file = getLibraryItem(fileId);
    if (!file) return;
    const cur = new Set(file.tagIds || []);
    if (cur.has(tagId)) cur.delete(tagId);
    else cur.add(tagId);
    setLibraryFileTags(fileId, [...cur]);
    refreshLib();
  }

  function handleRemoveMaterial(fileId, fileName) {
    if (!fileId) return;
    if (!window.confirm(`从本页资料列表移除「${fileName || "未命名"}」？资料库中仍保留，不会删除原文件。`)) return;
    hideMaterialFromMaterialsTab(fileId);
    if (tagEditId === fileId) setTagEditId(null);
    refreshLib();
    onStatus?.(`已从本页移除「${fileName || "未命名"}」（资料库仍保留）`);
  }

  function handleDragStart(e) {
    const t = e.active.data.current?.type;
    if (t === "project") {
      const p = resumeProjects.find((x) => x.id === e.active.id);
      setDragLabel(p?.name || "项目");
    } else if (t === "material") {
      const m = libraryFiles.find((x) => x.id === e.active.id) || getLibraryItem(e.active.id);
      setDragLabel(m?.name || "资料");
    }
  }

  function handleDragEnd(e) {
    setDragLabel("");
    const { active, over } = e;
    if (!over) {
      onStatus?.("请拖到具体资料包卡片上");
      return;
    }
    const overId = String(over.id);
    if (!overId.startsWith("packdrop_")) {
      onStatus?.("请拖到具体资料包卡片上（不能放到整栏空白处）");
      return;
    }
    const packId = overId.slice("packdrop_".length);
    if (!packId) return;

    const type = active.data.current?.type;
    if (type === "project") {
      const p = resumeProjects.find((x) => x.id === active.id);
      if (p) addProjectToPack(packId, p);
    } else if (type === "material") {
      addMaterialToPack(packId, String(active.id));
    }
  }

  async function runAnalyze(packId) {
    const pack = packs.find((p) => p.id === packId) || getProjectPacks().find((p) => p.id === packId);
    if (!pack) return;
    if (!pack.resumeProject && !(pack.materialIds || []).length) {
      onStatus?.("请先拖入简历项目或资料");
      return;
    }
    setActivePackId(pack.id);
    setAnalyzingId(pack.id);
    patchPack(pack.id, { analysis: { ...emptyAnalysis(), status: "running" } });
    try {
      const mats = (pack.materialIds || [])
        .map((id) => getLibraryItem(id))
        .filter(Boolean)
        .map((m) => ({
          name: m.name,
          content: String(m.content || "").slice(0, 20000),
        }));
      if (mats.some((m) => !String(m.content || "").trim())) {
        onStatus?.("部分资料尚未解析出正文，分析结果可能偏弱");
      }
      const data = await api.analyzeProjectPack({
        pack_name: pack.name,
        resume_project: pack.resumeProject || null,
        materials: mats,
      });
      patchPack(pack.id, {
        analysis: { status: "done", ...(data.analysis || {}), error: "" },
      });
      setResultTab("desc");
      onStatus?.("资料包分析完成");
    } catch (err) {
      patchPack(pack.id, {
        analysis: { ...emptyAnalysis(), status: "error", error: err.message || "分析失败" },
      });
      onStatus?.("分析失败：" + (err.message || ""));
    } finally {
      setAnalyzingId("");
    }
  }

  function applyToResume() {
    if (!activePack?.analysis?.resume_desc) {
      onStatus?.("请先完成分析");
      return;
    }
    const desc = activePack.analysis.resume_desc;
    const resumeId =
      applyResumeId || activePack.resumeProject?.resumeId || resumes[0]?.id;
    if (!resumeId) {
      onStatus?.("没有可回写的简历，请先在「我的简历」创建");
      return;
    }
    const resume = getResumes().find((r) => r.id === resumeId);
    if (!resume) {
      onStatus?.("目标简历不存在");
      return;
    }
    const structured = normalizeStructured(resume.structured || {});
    const projects = [...(structured.projects || [])];
    const idx =
      activePack.resumeProject?.resumeId === resumeId
        ? activePack.resumeProject.projectIndex
        : -1;
    const nextProj = {
      name: desc.name || activePack.resumeProject?.name || activePack.name,
      role: desc.role || "",
      company: activePack.resumeProject?.company || "",
      start: activePack.resumeProject?.start || "",
      end: activePack.resumeProject?.end || "",
      intro: desc.intro || "",
      responsibilities: desc.responsibilities || [],
      achievements: desc.achievements || [],
      bullets: desc.bullets || [],
      _html: "",
    };
    if (idx >= 0 && idx < projects.length) projects[idx] = { ...projects[idx], ...nextProj };
    else projects.unshift(nextProj);
    structured.projects = projects;
    const plain = structuredToPlainText(structured);
    upsertResume({
      ...resume,
      structured,
      resumeText: plain || resume.resumeText,
      updated: new Date().toISOString().slice(0, 10),
    });
    setLibTick((n) => n + 1);
    onStatus?.(`已回写到简历「${resume.name}」`);
  }

  const packMaterials = (activePack?.materialIds || [])
    .map((id) => getLibraryItem(id))
    .filter(Boolean);

  const analysis = activePack?.analysis || emptyAnalysis();

  function renderAnalysisBody({ expanded = false } = {}) {
    return (
      <>
        <div className="rg-pack-tabs">
          {[
            ["desc", "简历描述"],
            ["oral", "口头介绍"],
            ["deep", "深挖问题"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={resultTab === k ? "active" : ""}
              onClick={() => setResultTab(k)}
            >
              {label}
            </button>
          ))}
        </div>

        {resultTab === "desc" && analysis.resume_desc && (
          <div className={`rg-pack-result${expanded ? " expanded" : ""}`}>
            <p>
              <strong>{analysis.resume_desc.name}</strong>
              {analysis.resume_desc.role ? ` · ${analysis.resume_desc.role}` : ""}
            </p>
            <p>{analysis.resume_desc.intro}</p>
            <h5>职责</h5>
            <ul>
              {(analysis.resume_desc.responsibilities || []).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <h5>业绩</h5>
            <ul>
              {(analysis.resume_desc.achievements || []).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            <div className="rg-pack-apply">
              <select
                value={applyResumeId || activePack?.resumeProject?.resumeId || resumes[0]?.id || ""}
                onChange={(e) => setApplyResumeId(e.target.value)}
              >
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn primary" onClick={applyToResume}>
                回写简历
              </button>
            </div>
          </div>
        )}

        {resultTab === "oral" && (
          <div className={`rg-pack-result${expanded ? " expanded" : ""}`}>
            <p style={{ whiteSpace: "pre-wrap" }}>{analysis.oral_script || "暂无"}</p>
          </div>
        )}

        {resultTab === "deep" && (
          <div className={`rg-pack-result${expanded ? " expanded" : ""}`}>
            <ol>
              {(analysis.deep_questions || []).map((q, i) => (
                <li key={i} style={{ marginBottom: 10 }}>
                  <strong>{q.question}</strong>
                  {q.intent && <div className="rg-meta">考察：{q.intent}</div>}
                  {q.tip && <div className="muted">提示：{q.tip}</div>}
                </li>
              ))}
            </ol>
          </div>
        )}
      </>
    );
  }

  function renderFileRow(m) {
    const fileTags = (m.tagIds || []).map((id) => tagMap[id]).filter(Boolean);
    return (
      <DraggableCard key={m.id} id={m.id} type="material" className="rg-lib-row">
        <FileText size={16} className="rg-lib-row-icon" />
        <div className="rg-lib-row-main">
          <span className="rg-lib-row-name">{m.name}</span>
          <div className="rg-lib-row-tags">
            {fileTags.map((t) => (
              <span key={t.id} className="rg-lib-chip">
                {t.name}
              </span>
            ))}
            {!fileTags.length && <span className="muted" style={{ fontSize: 11 }}>未打标</span>}
          </div>
        </div>
        <button
          type="button"
          className="btn small"
          title="设置标签"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setTagEditId(tagEditId === m.id ? null : m.id);
          }}
        >
          <Tag size={13} />
        </button>
        <button
          type="button"
          className="btn small danger"
          title="移除"
          aria-label="移除"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void handleRemoveMaterial(m.id, m.name);
          }}
        >
          <Trash2 size={13} />
        </button>
        {tagEditId === m.id && (
          <div
            className="rg-lib-tag-pop"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {!tags.length && <p className="muted">请先「新建标签」</p>}
            {tags.map((t) => (
              <label key={t.id} className="rg-lib-tag-opt">
                <input
                  type="checkbox"
                  checked={(m.tagIds || []).includes(t.id)}
                  onChange={() => toggleFileTag(m.id, t.id)}
                />
                {t.name}
              </label>
            ))}
            <button type="button" className="btn small" onClick={() => setTagEditId(null)}>
              完成
            </button>
          </div>
        )}
      </DraggableCard>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={packCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="rg-pack-layout rg-pack-layout-lib">
        {/* 左：简历项目 */}
        <section className="rg-pack-col card">
          <header className="rg-pack-col-hd">
            <h3>简历项目</h3>
          </header>
          <label className="rg-pack-filter">
            <span>选择简历</span>
            <select
              value={filterResumeId}
              onChange={(e) => setFilterResumeId(e.target.value)}
              disabled={!resumes.length}
            >
              {!resumes.length && <option value="">暂无简历</option>}
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || "未命名简历"}
                </option>
              ))}
            </select>
          </label>
          {!resumes.length && <p className="muted">请先在「我的简历」上传或新建简历。</p>}
          {resumes.length > 0 && resumeProjects.length === 0 && (
            <p className="muted">当前简历暂无项目经历。</p>
          )}
          {resumeProjects.map((p) => (
            <DraggableCard key={p.id} id={p.id} type="project" className="rg-pack-item">
              <strong>{p.name}</strong>
              <div className="rg-meta">
                {p.role && <span>{p.role}</span>}
                {(p.start || p.end) && <span>{[p.start, p.end].filter(Boolean).join(" - ")}</span>}
              </div>
            </DraggableCard>
          ))}
        </section>

        {/* 中：资料库列表 */}
        <section className="rg-pack-col card rg-pack-col-liblist">
          <header className="rg-pack-col-hd">
            <h3>资料列表</h3>
            <div className="rg-lib-hd-actions">
              <button type="button" className="btn small" onClick={handleCreateTag}>
                新建标签
              </button>
              <button
                type="button"
                className={`btn small${groupByTag ? " primary" : ""}`}
                onClick={() => setGroupByTag((v) => !v)}
              >
                {groupByTag ? "按标签分组" : "平铺列表"}
              </button>
              <button type="button" className="btn small" onClick={() => navigate("/resume?tab=library")}>
                资料库
              </button>
            </div>
          </header>
          <p className="rg-meta" style={{ marginBottom: 8 }}>
            来自「我的资料库」；拖到右侧资料包。上传请到资料库。
          </p>

          {!libraryFiles.length && (
            <p className="muted">
              暂无资料。请先到
              <button type="button" className="btn small" style={{ margin: "0 4px" }} onClick={() => navigate("/resume?tab=library")}>
                我的资料库
              </button>
              上传文件。
            </p>
          )}

          <div className="rg-lib-list">
            {groupedFiles.map((g) => (
              <div key={g.key} className="rg-lib-group">
                {g.title && <div className="rg-lib-group-title">{g.title}</div>}
                {g.files.map((m) => renderFileRow(m))}
              </div>
            ))}
          </div>
        </section>

        {/* 右：资料包 */}
        <section className="rg-pack-col card rg-pack-main">
          <header className="rg-pack-col-hd">
            <h3>项目资料包（{packs.length}）</h3>
            <button type="button" className="btn small primary" onClick={createPack}>
              新建资料包
            </button>
          </header>
          <p className="rg-meta" style={{ marginBottom: 8 }}>
            请拖到具体资料包卡片上加入；点击卡片在右侧查看内容。
          </p>

          <div className="rg-pack-split">
            <div className="rg-pack-list">
              {packs.map((pack) => (
                <Droppable
                  key={pack.id}
                  id={`packdrop_${pack.id}`}
                  className={`rg-pack-card${activePack?.id === pack.id ? " active" : ""}`}
                >
                  <div
                    className="rg-pack-card-inner"
                    onClick={() => setActivePackId(pack.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="rg-pack-card-hd">
                      <input
                        className="rg-pack-name"
                        value={pack.name}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => patchPack(pack.id, { name: e.target.value })}
                      />
                    </div>
                    <div className="rg-meta">
                      <span>{pack.resumeProject ? `项目：${pack.resumeProject.name}` : "未绑简历项目"}</span>
                      <span>资料 {pack.materialIds?.length || 0} 份</span>
                    </div>
                    <div className="rg-pack-card-actions">
                      <button
                        type="button"
                        className="btn small primary rg-pack-card-analyze"
                        disabled={Boolean(analyzingId)}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          runAnalyze(pack.id);
                        }}
                      >
                        {analyzingId === pack.id ? "分析中…" : "分析"}
                      </button>
                      <button
                        type="button"
                        className="btn small danger"
                        title="删除资料包"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePack(pack.id, pack.name);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </Droppable>
              ))}
              {packs.length === 0 && (
                <div className="rg-pack-empty-drop">暂无资料包 — 请先点「新建资料包」</div>
              )}
            </div>

            <aside className="rg-pack-side">
              {!activePack && <p className="muted">点击资料包查看内容与分析结果。</p>}
              {activePack && (
                <>
                  <h4>{activePack.name}</h4>
                  <div className="rg-pack-side-sec">
                    <h5>包内内容</h5>
                    {activePack.resumeProject ? (
                      <div className="rg-pack-chip">
                        <span>简历项目 · {activePack.resumeProject.name}</span>
                        <button type="button" className="btn small" onClick={clearResumeProject}>
                          移除
                        </button>
                      </div>
                    ) : (
                      <p className="muted">未绑定简历项目（可选）</p>
                    )}
                    {packMaterials.map((m) => (
                      <div key={m.id} className="rg-pack-chip">
                        <span>{m.name}</span>
                        <button type="button" className="btn small" onClick={() => removeMaterialFromPack(m.id)}>
                          移除
                        </button>
                      </div>
                    ))}
                    {!activePack.resumeProject && packMaterials.length === 0 && (
                      <p className="muted">空包，请拖入项目或资料。</p>
                    )}
                  </div>

                  {analysis.status === "error" && (
                    <p className="status-line">分析失败：{analysis.error}</p>
                  )}
                  {analysis.status === "running" && <p className="muted">正在分析…</p>}

                  {analysis.status === "done" && (
                    <div className="rg-pack-side-sec">
                      <div className="rg-pack-result-hd">
                        <h5>分析结果</h5>
                        <button
                          type="button"
                          className="btn small"
                          title="放大查看"
                          aria-label="放大查看"
                          onClick={() => setAnalysisExpanded(true)}
                        >
                          <Maximize2 size={13} />
                        </button>
                      </div>
                      {renderAnalysisBody()}
                    </div>
                  )}
                </>
              )}
            </aside>
          </div>
        </section>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragLabel ? <div className="rg-pack-overlay">{dragLabel}</div> : null}
      </DragOverlay>

      {analysisExpanded && analysis.status === "done" && activePack && (
        <div className="rg-pack-expand-mask" onClick={() => setAnalysisExpanded(false)}>
          <div className="rg-pack-expand-panel card" onClick={(e) => e.stopPropagation()}>
            <header className="rg-pack-expand-hd">
              <div>
                <h3>{activePack.name} · 分析结果</h3>
              </div>
              <button
                type="button"
                className="btn small"
                title="关闭"
                onClick={() => setAnalysisExpanded(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="rg-pack-expand-body">{renderAnalysisBody({ expanded: true })}</div>
          </div>
        </div>
      )}
    </DndContext>
  );
}
