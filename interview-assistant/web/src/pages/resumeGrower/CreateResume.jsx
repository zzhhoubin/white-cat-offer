import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Save } from "lucide-react";
import { useResumeStore } from "./editor/store.js";
import SectionList from "./editor/SectionList.jsx";
import SectionEditor from "./editor/SectionEditor.jsx";
import LivePreview from "./editor/LivePreview.jsx";
import { exportResumePdf } from "./editor/exportPdf.js";
import { structuredToPlainText } from "./structuredResume.js";
import { getResume, getResumes } from "./storage.js";
import { getTemplateConfig, listTemplateConfigs } from "./templates/registry.js";

/** 去除 HTML 标签 */
function stripHtml(html) {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

/** 将 Zustand store 数据转为 structured 格式，供 structuredToPlainText 使用 */
function storeToStructured(store) {
  const moduleOrder = (store.modules || []).map((m) => m.id).filter(Boolean);
  return {
    schema_version: 1,
    origin: "create",
    module_order: moduleOrder.length ? moduleOrder : undefined,
    templateId: store.templateId || "original",
    resumeName: store.resumeName || "",
    basics: {
      name: store.basics.name || "",
      phone: store.basics.phone || "",
      email: store.basics.email || "",
      city: store.basics.location || "",
      target_role: store.basics.title || "",
      links: store.basics.website ? [store.basics.website] : [],
      _birthday: store.basics.birthday || "",
      _status: store.basics.status || "",
      _website: store.basics.website || "",
      _avatarUrl: store.avatarUrl || "",
    },
    summary: { bullets: [] },
    experience: store.experience.map((e) => ({
      company: e.company || "",
      title: e.title || "",
      start: e.start || "",
      end: e.end || "",
      location: "",
      bullets: stripHtml(e.description)
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      _html: e.description || "",
    })),
    projects: store.projects.map((p) => ({
      name: p.name || "",
      role: p.role || "",
      company: p.company || "",
      start: p.start || "",
      end: p.end || "",
      intro: "",
      responsibilities: stripHtml(p.description)
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      achievements: [],
      bullets: [],
      _html: p.description || "",
    })),
    education: store.education.map((e) => ({
      school: e.school || "",
      degree: e.degree || "",
      major: e.major || "",
      start: e.start || "",
      end: e.end || "",
      extras: e.extras ? [e.extras] : [],
    })),
    skills: store.skillsContent
      ? [{ group: "专业技能", items: stripHtml(store.skillsContent).split(/\n/).map((s) => s.trim()).filter(Boolean) }]
      : [],
    _skillsHtml: store.skillsContent || "",
    certificates: (store.certificates || [])
      .filter((c) => c.name)
      .map((c) => ({
        name: c.name || "",
        issuer: c.issuer || "",
        date: c.date || "",
        expiry: c.expiry || "",
        credentialId: c.credentialId || "",
        note: c.note || "",
      })),
    languages: (store.languages || [])
      .filter((l) => l.name)
      .map((l) => ({
        name: l.name || "",
        level: l.level || "",
        cert: l.cert || "",
        note: l.note || "",
      })),
    honors: (store.honors || [])
      .filter((h) => h.title)
      .map((h) => ({
        title: h.title || "",
        date: h.date || "",
        note: h.note || "",
      })),
    others: stripHtml(store.othersContent || ""),
    _othersHtml: store.othersContent || "",
  };
}

/**
 * 新建/编辑简历 —— 三栏编辑器
 * 左：模块导航 + 主题色/字体
 * 中：动态编辑器
 * 右：A4 实时预览
 *
 * fromAnalysis：从简历分析台进入时，顶栏显示「返回简历分析台」
 */
export default function CreateResume({ onSave, onBack, fromAnalysis = false }) {
  const [nameEditing, setNameEditing] = useState(false);
  const [tmplOpen, setTmplOpen] = useState(false);
  const tmplWrapRef = useRef(null);
  const resumeName = useResumeStore((s) => s.resumeName);
  const setResumeName = useResumeStore((s) => s.setResumeName);
  const templateId = useResumeStore((s) => s.templateId);
  const setTemplateId = useResumeStore((s) => s.setTemplateId);
  const setThemeColor = useResumeStore((s) => s.setThemeColor);
  const loadResume = useResumeStore((s) => s.loadResume);
  const allData = useResumeStore((s) => s);
  const savedResumeId = useResumeStore((s) => s.savedResumeId);
  const setSavedResumeId = useResumeStore((s) => s.setSavedResumeId);

  const savedResumes = useMemo(() => {
    try { return getResumes().filter((r) => r.structured && !r.analyzing); }
    catch { return []; }
  }, []);

  useEffect(() => {
    if (!tmplOpen) return undefined;
    function onDocMouseDown(e) {
      if (tmplWrapRef.current && !tmplWrapRef.current.contains(e.target)) {
        setTmplOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [tmplOpen]);

  function applyTemplate(id) {
    setTemplateId(id);
    const cfg = getTemplateConfig(id);
    if (cfg?.colorScheme?.heading) setThemeColor(cfg.colorScheme.heading);
    setTmplOpen(false);
  }

  function handleLoadResume(e) {
    const id = e.target.value;
    if (!id) return;
    const resume = getResume(id);
    if (!resume?.structured) return;
    loadResume(resume.structured, resume.id, resume.name);
  }

  const handleSave = useCallback(() => {
    const structured = storeToStructured(allData);
    structured.templateId = allData.templateId;
    structured.resumeName = allData.resumeName;
    const id = onSave(structured, savedResumeId);
    if (id) setSavedResumeId(id);
  }, [allData, onSave, savedResumeId, setSavedResumeId]);

  const handleSaveAs = useCallback(() => {
    const base = (allData.resumeName || "未命名简历").trim();
    const suggested = `${base} 副本`;
    const name = window.prompt("另存为新简历名称", suggested);
    if (name == null) return;
    const finalName = name.trim() || suggested;
    setResumeName(finalName);
    const structured = storeToStructured(allData);
    structured.templateId = allData.templateId;
    structured.resumeName = finalName;
    const id = onSave(structured, null);
    if (id) setSavedResumeId(id);
  }, [allData, onSave, setResumeName, setSavedResumeId]);

  return (
    <div className="rg-create-wrap">
      {/* 顶栏 */}
      <div className="rg-create-toolbar">
        <button type="button" className="btn mute" onClick={onBack}>
          {fromAnalysis ? "← 返回简历分析台" : "← 返回列表"}
        </button>

        <div className="rg-create-name">
          {nameEditing ? (
            <input
              autoFocus
              value={resumeName}
              onChange={(e) => setResumeName(e.target.value)}
              onBlur={() => setNameEditing(false)}
              onKeyDown={(e) => { if (e.key === "Enter") setNameEditing(false); }}
            />
          ) : (
            <span onClick={() => setNameEditing(true)} style={{ cursor: "pointer" }}>
              {resumeName || "未命名简历"} ✎
            </span>
          )}
        </div>

        <select
          className="rg-load-select"
          value=""
          onChange={handleLoadResume}
          title="加载已保存的简历"
        >
          <option value="" disabled>加载已保存的简历…</option>
          {savedResumes.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>

        <div className="rg-tpl-wrap" ref={tmplWrapRef}>
          <button
            type="button"
            className={`btn mute${tmplOpen ? " active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setTmplOpen((v) => !v);
            }}
            title="选择简历模板"
          >
            简历模板 ▾
          </button>
          {tmplOpen && (
            <div className="rg-tpl-drop" onMouseDown={(e) => e.stopPropagation()}>
              {listTemplateConfigs().map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`rg-tpl-item${templateId === t.id ? " active" : ""}`}
                  onClick={() => applyTemplate(t.id)}
                >
                  <span className="rg-tpl-swatch" style={{ background: t.previewColor || t.colorScheme.heading }} />
                  <span className="rg-tpl-info">
                    <span className="rg-tpl-name">{t.name}</span>
                    <span className="rg-tpl-source">{t.source}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            className="btn mute"
            onClick={handleSave}
            title="保存到列表"
          >
            <Save size={15} /> 保存
          </button>
          <button
            type="button"
            className="btn mute"
            onClick={handleSaveAs}
            title="另存为新简历"
          >
            <Save size={15} /> 另存为
          </button>
          <button
            type="button"
            className="btn mute"
            onClick={() => exportResumePdf(resumeName)}
            title="导出 PDF"
          >
            <FileDown size={15} /> 导出PDF
          </button>
        </div>
      </div>

      {/* 三栏主体 */}
      <div className="rg-create-body">
        <SectionList />
        <div className="rg-create-center">
          <SectionEditor />
        </div>
        <div className="rg-create-right">
          <LivePreview />
        </div>
      </div>
    </div>
  );
}
