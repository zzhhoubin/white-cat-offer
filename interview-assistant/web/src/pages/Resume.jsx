import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import ResumeList from "./resumeGrower/ResumeList.jsx";
import ResumeDetail from "./resumeGrower/ResumeDetail.jsx";
import CreateResume from "./resumeGrower/CreateResume.jsx";
import MaterialsTab from "./resumeGrower/MaterialsTab.jsx";
import LibraryTab from "./resumeGrower/LibraryTab.jsx";
import ProfileTab from "./resumeGrower/ProfileTab.jsx";
import JdMatchTab from "./resumeGrower/JdMatchTab.jsx";
import {
  deleteMaterial,
  deleteResume,
  getMaterials,
  getProfile,
  getResume,
  getResumes,
  setMaterials,
  setProfile,
  setResumes,
  upsertResume,
} from "./resumeGrower/storage.js";
import {
  buildAnnotationsFromStructured,
  buildProfileFromStructured,
  normalizeStructured,
  scoreStructured,
  structuredToPlainText,
  withSourceModuleOrder,
} from "./resumeGrower/structuredResume.js";
import { putResumePdf } from "./resumeGrower/pdfStore.js";
import { useResumeStore } from "./resumeGrower/editor/store.js";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function tabFromParams(sp) {
  const t = sp.get("tab");
  // deep-dive：项目深挖；兼容旧 materials / assets
  if (t === "deep-dive" || t === "materials" || t === "assets") return "deep-dive";
  if (t === "library") return "library";
  if (t === "profile") return "profile";
  if (t === "create") return "create";
  if (t === "jd-match") return "jd-match";
  if (t === "resumes" || !t) return "resumes";
  return "resumes";
}

export default function Resume() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = tabFromParams(searchParams);
  const detailId = searchParams.get("id");

  const [resumes, setResumesState] = useState(() => getResumes());
  const [materials, setMaterialsState] = useState(() => getMaterials());
  const [profile, setProfileState] = useState(() => getProfile());
  const [assets, setAssets] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState("");

  const refreshAssets = useCallback(async () => {
    try {
      const data = await api.getAssets();
      setAssets(data.assets || []);
    } catch {
      /* 后端未启动时仍可浏览本地列表 */
    }
  }, []);

  useEffect(() => {
    refreshAssets();
  }, [refreshAssets]);

  // 旧 tab=materials|assets 规范化为 deep-dive，避免后续迭代混乱
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "materials" || t === "assets") {
      const sp = new URLSearchParams(searchParams);
      sp.set("tab", "deep-dive");
      setSearchParams(sp, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function setTab(next) {
    const sp = new URLSearchParams(searchParams);
    sp.delete("id");
    sp.set("tab", next);
    setSearchParams(sp);
  }

  function openResume(id) {
    const sp = new URLSearchParams();
    sp.set("tab", "resumes");
    sp.set("id", id);
    setSearchParams(sp);
  }

  function closeDetail() {
    const sp = new URLSearchParams();
    sp.set("tab", "resumes");
    setSearchParams(sp);
  }

  function openJdMatch(id) {
    const sp = new URLSearchParams();
    sp.set("tab", "jd-match");
    sp.set("id", id);
    setSearchParams(sp);
  }

  function syncResumes(list) {
    setResumes(list);
    setResumesState(list);
  }

  async function handleUpload(file) {
    if (!file) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      setStatus("仅支持 PDF 格式");
      return;
    }
    const id = "r_" + Date.now();
    const pending = {
      id,
      name: file.name,
      score: null,
      updated: today(),
      analyzing: false,
      analyzed: false,
      template: "classic",
      resumeText: "",
      rawText: "",
      assets: [],
      hasPdf: false,
      annotations: [],
      edits: [],
    };
    const nextList = [pending, ...resumes];
    syncResumes(nextList);
    setUploading(true);
    setStatus(`正在保存 ${file.name}…`);

    try {
      await putResumePdf(id, file);
      const done = {
        ...pending,
        hasPdf: true,
        analyzing: false,
        analyzed: false,
        updated: today(),
      };
      upsertResume(done);
      setResumesState(getResumes());
      setStatus(`上传完成：${file.name}（打开后点「分析」）`);
    } catch (e) {
      const failed = {
        ...pending,
        analyzing: false,
        analyzed: false,
        hasPdf: false,
        offline: true,
        updated: today(),
      };
      upsertResume(failed);
      setResumesState(getResumes());
      setStatus("上传失败：" + (e.message || "本地保存失败"));
    } finally {
      setUploading(false);
    }
  }

  async function handleCreate(draft) {
    const id = "r_" + Date.now();
    const plain = structuredToPlainText(draft) || "";
    const pending = {
      id,
      name: draft.resumeName || "新建简历",
      score: null,
      updated: today(),
      analyzing: true,
      template: draft.templateId || "original",
      resumeText: plain,
      assets: [],
      hasPdf: false,
      annotations: [],
      edits: [],
    };
    syncResumes([pending, ...resumes]);
    setUploading(true);
    setStatus("正在分析简历…");

    try {
      const data = await api.uploadText(plain);
      if (data.error) throw new Error(data.error);
      let structured = normalizeStructured(data.structured);
      if (!structured.basics?.name && !structured.experience?.length) {
        structured = { ...draft, ...structured };
      }
      const finalPlain = structuredToPlainText(structured) || plain;
      const done = {
        ...pending,
        analyzing: false,
        analyzed: true,
        hasPdf: false,
        resumeText: finalPlain,
        rawText: plain,
        structured,
        assets: data.assets || [],
        score: scoreStructured(structured),
        annotations: buildAnnotationsFromStructured(structured),
        edits: [],
        updated: today(),
      };
      upsertResume(done);
      setResumesState(getResumes());
      setStatus(`分析完成：${done.name}`);

      const sp = new URLSearchParams();
      sp.set("tab", "resumes");
      sp.set("id", id);
      setSearchParams(sp);
    } catch (e) {
      const failed = {
        ...pending,
        analyzing: false,
        offline: true,
        updated: today(),
      };
      upsertResume(failed);
      setResumesState(getResumes());
      setStatus("分析失败：" + (e.message || "请确认后端已启动"));
    } finally {
      setUploading(false);
    }
  }

  function gotoCreate() {
    useResumeStore.getState().resetStore();
    const sp = new URLSearchParams();
    sp.set("tab", "create");
    setSearchParams(sp);
  }

  /** 从简历分析台进入编辑页：加载结构化内容并保留返回路径 */
  function gotoEditFromAnalysis(id) {
    const cur = getResume(id) || resumes.find((r) => r.id === id);
    if (!cur) return;
    const structured = cur.structured || normalizeStructured({ basics: { name: cur.name || "" } });
    useResumeStore.getState().loadResume(structured, cur.id, cur.name);
    const sp = new URLSearchParams();
    sp.set("tab", "create");
    sp.set("id", id);
    sp.set("from", "analysis");
    setSearchParams(sp);
  }

  function backToAnalysis() {
    const id = searchParams.get("id");
    if (id) openResume(id);
    else setTab("resumes");
  }

  function handleSave(draft, existingId) {
    const prev = existingId ? getResume(existingId) : null;
    const origin = prev?.structured?.origin === "upload" ? "upload" : "create";
    const structured = withSourceModuleOrder(
      {
        ...draft,
        origin,
        module_order: draft.module_order?.length
          ? draft.module_order
          : prev?.structured?.module_order,
      },
      origin
    );
    const plain = structuredToPlainText(structured) || "";
    const saved = {
      id: existingId || "r_" + Date.now(),
      name: draft.resumeName || structured.resumeName || "新建简历",
      score: prev?.score ?? null,
      updated: today(),
      analyzing: false,
      template: draft.templateId || "original",
      resumeText: plain,
      structured,
      assets: prev?.assets || [],
      hasPdf: Boolean(prev?.hasPdf),
      annotations: buildAnnotationsFromStructured(structured),
      edits: prev?.edits || [],
      offline: true,
    };
    upsertResume(saved);
    if (!existingId) {
      syncResumes([saved, ...resumes]);
    } else {
      setResumesState(getResumes());
    }
    setStatus(existingId ? "已更新" : "已保存到列表");
    return saved.id;
  }

  function patchResume(updated) {
    upsertResume(updated);
    setResumesState(getResumes());
  }

  function handleDelete(id) {
    if (!window.confirm("确定删除该简历吗？")) return;
    if (!window.confirm("再次确认：删除后无法恢复，是否继续删除？")) return;
    const next = deleteResume(id);
    setResumesState(next);
    setStatus("");
  }

  async function addMaterial(file) {
    const id = "m_" + Date.now();
    const item = {
      id,
      name: file.name,
      updated: today(),
      needsConfirm: true,
      content: "",
      facts: `正在解析「${file.name}」…`,
      bullets: [],
      parseStatus: "pending",
      parseError: "",
    };
    const list = [item, ...getMaterials()];
    setMaterials(list);
    setMaterialsState(list);
    setStatus(`正在解析：${file.name}`);

    try {
      const data = await api.extractMaterial(file);
      const text = (data.text || "").trim();
      const next = getMaterials().map((m) =>
        m.id === id
          ? {
              ...m,
              content: text,
              facts: text
                ? `已解析「${file.name}」（${data.chars || text.length} 字${data.truncated ? "，已截断" : ""}）`
                : m.facts,
              bullets: text
                ? [`正文前 120 字：${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`]
                : m.bullets,
              parseStatus: "ok",
              parseError: "",
              needsConfirm: false,
            }
          : m
      );
      setMaterials(next);
      setMaterialsState(next);
      setStatus(`已解析资料：${file.name}`);
      return next.find((m) => m.id === id) || item;
    } catch (e) {
      const msg = e.message || "解析失败";
      const next = getMaterials().map((m) =>
        m.id === id
          ? {
              ...m,
              facts: `解析失败「${file.name}」：${msg}`,
              parseStatus: "fail",
              parseError: msg,
              needsConfirm: true,
            }
          : m
      );
      setMaterials(next);
      setMaterialsState(next);
      setStatus("解析失败：" + msg);
      return next.find((m) => m.id === id) || item;
    }
  }

  function handleDeleteMaterial(id) {
    const list = deleteMaterial(id);
    setMaterialsState(list);
    setStatus("已删除资料");
    return list;
  }

  async function handleDeleteAsset(assetId) {
    try {
      const data = await api.deleteAsset(assetId);
      setAssets(data.assets || []);
      setStatus("已删除素材");
    } catch (e) {
      setStatus("删除失败：" + (e.message || "未知错误"));
    }
  }

  function syncMaterialToProfile(m) {
    const latest = getResume(detailId) || resumes[0];
    const base =
      profile || buildProfileFromStructured(latest?.structured || {});
    const next = {
      ...base,
      star: m?.name ? `${m.name} · ${m.facts || "已同步"}` : base.star,
    };
    setProfile(next);
    setProfileState(next);
    setStatus("已同步到我的信息");
  }

  function refreshProfile() {
    const latest = resumes[0];
    const next = buildProfileFromStructured(latest?.structured || {});
    if (materials[0]) {
      next.star = `${materials[0].name} · 已从项目深挖合并`;
    }
    setProfile(next);
    setProfileState(next);
    setStatus("已从简历+资料刷新我的信息");
  }

  const detailResume = detailId ? getResume(detailId) || resumes.find((r) => r.id === detailId) : null;

  useEffect(() => {
    const open = Boolean(
      detailId && detailResume && !detailResume.analyzing && tab !== "jd-match" && tab !== "create"
    );
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [detailId, detailResume?.analyzing, tab]);

  if (tab === "jd-match" && detailResume) {
    return (
      <main className="page rg-page rg-page-wide rg-jdm-shell">
        <JdMatchTab
          resume={detailResume}
          onBack={() => openResume(detailId)}
          onPatch={patchResume}
        />
      </main>
    );
  }

  // 新建/编辑页优先于分析台，避免带 id 时仍渲染 ResumeDetail
  if (tab === "create") {
    const fromAnalysis = searchParams.get("from") === "analysis";
    return (
      <main className="page rg-page rg-page-full">
        <CreateResume
          onSave={handleSave}
          onBack={fromAnalysis ? backToAnalysis : () => setTab("resumes")}
          fromAnalysis={fromAnalysis}
        />
      </main>
    );
  }

  if (detailResume && !detailResume.analyzing) {
    return (
      <ResumeDetail
        resume={detailResume}
        onBack={closeDetail}
        onPatch={patchResume}
        onOpenJdMatch={() => openJdMatch(detailId)}
        onEdit={gotoEditFromAnalysis}
      />
    );
  }

  return (
    <main className={`page rg-page${tab === "deep-dive" || tab === "library" ? " rg-page-wide" : ""}${tab === "deep-dive" ? " rg-deep-page" : ""}`}>
      {tab === "resumes" && (
        <ResumeList
          resumes={resumes}
          uploading={uploading}
          status={status}
          onUpload={handleUpload}
          onOpen={openResume}
          onDelete={handleDelete}
          onCreate={gotoCreate}
        />
      )}
      {tab === "library" && (
        <>
          {status && <p className="status-line" style={{ marginBottom: 8 }}>{status}</p>}
          <LibraryTab onStatus={setStatus} />
        </>
      )}
      {tab === "deep-dive" && (
        <>
          {status && <p className="status-line" style={{ marginBottom: 8 }}>{status}</p>}
          <MaterialsTab onStatus={setStatus} />
        </>
      )}
      {tab === "profile" && <ProfileTab profile={profile} onRefresh={refreshProfile} />}
    </main>
  );
}
