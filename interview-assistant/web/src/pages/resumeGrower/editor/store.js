import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { resolveModuleOrder } from "../structuredResume.js";

export const DEFAULT_MODULES = [
  { id: "basics", label: "基本信息", icon: "User", visible: true, removable: true },
  { id: "skills", label: "专业技能", icon: "Wrench", visible: true, removable: true },
  { id: "experience", label: "工作经历", icon: "Briefcase", visible: true, removable: true },
  { id: "projects", label: "项目经历", icon: "FolderGit2", visible: true, removable: true },
  { id: "education", label: "教育经历", icon: "GraduationCap", visible: true, removable: true },
  { id: "certificates", label: "证书", icon: "Award", visible: true, removable: true },
  { id: "languages", label: "语言能力", icon: "Languages", visible: true, removable: true },
  { id: "honors", label: "荣誉奖项", icon: "Trophy", visible: true, removable: true },
  { id: "others", label: "其他", icon: "FileText", visible: true, removable: true },
];

/** 按 module_order 还原左侧模块列表（与结构化工作台顺序对齐） */
export function modulesFromOrder(order) {
  const defs = Object.fromEntries(DEFAULT_MODULES.map((m) => [m.id, m]));
  const seen = new Set();
  const out = [];
  for (const id of order || []) {
    if (!id || seen.has(id)) continue;
    if (defs[id]) {
      out.push({ ...defs[id] });
      seen.add(id);
    } else if (String(id).startsWith("custom_")) {
      out.push({ id, label: "自定义模块", icon: "FileText", visible: true, removable: true });
      seen.add(id);
    }
  }
  for (const m of DEFAULT_MODULES) {
    if (!seen.has(m.id)) out.push({ ...m });
  }
  return out;
}

const PRESET_COLORS = [
  "#2563eb", "#0f766e", "#b45309", "#7c3aed",
  "#be185d", "#1e40af", "#047857", "#b91c1c", "#334155",
];

function emptyExpEntry() {
  return { id: "e_" + Date.now(), company: "", title: "", start: "", end: "", description: "" };
}

function emptyProjEntry() {
  return { id: "p_" + Date.now(), name: "", role: "", company: "", start: "", end: "", description: "" };
}

function emptyEduEntry() {
  return { id: "ed_" + Date.now(), school: "", degree: "", major: "", start: "", end: "", extras: "" };
}

function emptyCertEntry() {
  return {
    id: "c_" + Date.now(),
    name: "",
    issuer: "",
    date: "",
    expiry: "",
    credentialId: "",
    note: "",
  };
}

function emptyLangEntry() {
  return { id: "l_" + Date.now(), name: "", level: "熟练", cert: "", note: "" };
}

function emptyHonorEntry() {
  return { id: "h_" + Date.now(), title: "", date: "", note: "" };
}

export const useResumeStore = create(
  persist(
    (set) => ({
      resumeName: "未命名简历",
      templateId: "original",

      avatarLayout: "top",
      avatarUrl: null,
      themeColor: "#2563eb",
      fontFamily: "default",

      modules: [...DEFAULT_MODULES],
      activeSection: "basics",

      basics: {
        name: "", title: "", status: "", birthday: "",
        email: "", phone: "", location: "", website: "",
      },
      skillsContent: "",
      othersContent: "",
      customData: {},
      experience: [],
      projects: [],
      education: [],
      certificates: [],
      languages: [],
      honors: [],
      savedResumeId: null,

      setResumeName: (name) => set({ resumeName: name }),
      setSavedResumeId: (id) => set({ savedResumeId: id }),
      setTemplateId: (id) => set({ templateId: id }),
      setActiveSection: (id) => set({ activeSection: id }),
      setThemeColor: (c) => set({ themeColor: c }),
      setFontFamily: (f) => set({ fontFamily: f }),
      setAvatarLayout: (layout) => set({ avatarLayout: layout }),
      setAvatarUrl: (url) => set({ avatarUrl: url }),

      toggleModuleVisible: (id) =>
        set((s) => ({
          modules: s.modules.map((m) => (m.id === id ? { ...m, visible: !m.visible } : m)),
        })),

      reorderModules: (newModules) => set({ modules: newModules }),

      addCustomModule: (label, icon) => {
        const id = "custom_" + Date.now();
        set((s) => ({
          modules: [...s.modules, { id, label, icon, visible: true, removable: true }],
        }));
        return id;
      },

      removeModule: (id) =>
        set((s) => {
          const nextModules = s.modules.filter((m) => m.id !== id);
          const nextActive = s.activeSection === id && nextModules.length > 0
            ? nextModules[0].id
            : s.activeSection;
          return { modules: nextModules, activeSection: nextActive };
        }),

      updateCustomData: (id, html) =>
        set((s) => ({ customData: { ...s.customData, [id]: html } })),

      updateBasics: (field, value) =>
        set((s) => ({ basics: { ...s.basics, [field]: value } })),

      setSkillsContent: (html) => set({ skillsContent: html }),
      setOthersContent: (html) => set({ othersContent: html }),

      addExperience: () =>
        set((s) => ({ experience: [...s.experience, emptyExpEntry()] })),
      updateExperience: (id, data) =>
        set((s) => ({
          experience: s.experience.map((e) => (e.id === id ? { ...e, ...data } : e)),
        })),
      removeExperience: (id) =>
        set((s) => ({ experience: s.experience.filter((e) => e.id !== id) })),

      addProject: () =>
        set((s) => ({ projects: [...s.projects, emptyProjEntry()] })),
      updateProject: (id, data) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, ...data } : p)),
        })),
      removeProject: (id) =>
        set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

      addEducation: () =>
        set((s) => ({ education: [...s.education, emptyEduEntry()] })),
      updateEducation: (id, data) =>
        set((s) => ({
          education: s.education.map((e) => (e.id === id ? { ...e, ...data } : e)),
        })),
      removeEducation: (id) =>
        set((s) => ({ education: s.education.filter((e) => e.id !== id) })),

      addCertificate: () =>
        set((s) => ({ certificates: [...(s.certificates || []), emptyCertEntry()] })),
      updateCertificate: (id, data) =>
        set((s) => ({
          certificates: (s.certificates || []).map((c) => (c.id === id ? { ...c, ...data } : c)),
        })),
      removeCertificate: (id) =>
        set((s) => ({ certificates: (s.certificates || []).filter((c) => c.id !== id) })),

      addLanguage: () =>
        set((s) => ({ languages: [...(s.languages || []), emptyLangEntry()] })),
      updateLanguage: (id, data) =>
        set((s) => ({
          languages: (s.languages || []).map((l) => (l.id === id ? { ...l, ...data } : l)),
        })),
      removeLanguage: (id) =>
        set((s) => ({ languages: (s.languages || []).filter((l) => l.id !== id) })),

      addHonor: () =>
        set((s) => ({ honors: [...(s.honors || []), emptyHonorEntry()] })),
      updateHonor: (id, data) =>
        set((s) => ({
          honors: (s.honors || []).map((h) => (h.id === id ? { ...h, ...data } : h)),
        })),
      removeHonor: (id) =>
        set((s) => ({ honors: (s.honors || []).filter((h) => h.id !== id) })),

      loadResume: (structured, resumeId, resumeName) => {
        const b = structured.basics || {};
        const skillsHtml = structured._skillsHtml
          || (structured.skills || []).map((g) => `<p><strong>${g.group || ""}</strong>：${(g.items || []).join("、")}</p>`).join("");
        const uid = () => Date.now() + "_" + Math.random().toString(36).slice(2, 6);
        set({
          resumeName: resumeName || structured.resumeName || "未命名简历",
          templateId: structured.templateId || "original",
          avatarLayout: b._avatarUrl ? "left" : "top",
          avatarUrl: b._avatarUrl || null,
          basics: {
            name: b.name || "",
            title: b.target_role || "",
            status: b._status || [b._educationLevel, b._workYears].filter(Boolean).join(" · ") || "",
            birthday: b._birthday || "",
            email: b.email || "",
            phone: b.phone || "",
            location: b.city || "",
            website: b._website || (b.links && b.links[0]) || "",
          },
          skillsContent: skillsHtml || ((structured.skills || []).flatMap((g) => g.items || []).join("、")
            ? `<p>${(structured.skills || []).flatMap((g) => g.items || []).join("、")}</p>`
            : ""),
          othersContent: structured._othersHtml || (typeof structured.others === "string" ? structured.others : ""),
          experience: (structured.experience || []).map((e) => ({
            id: "e_" + uid(),
            company: e.company || "",
            title: e.title || "",
            start: e.start || "",
            end: e.end || "",
            description: e._html || (e.bullets || []).map((x) => "<p>" + x + "</p>").join(""),
          })),
          projects: (structured.projects || []).map((p) => ({
            id: "p_" + uid(),
            name: p.name || "",
            role: p.role || "",
            company: p.company || "",
            start: p.start || "",
            end: p.end || "",
            description: p._html || (p.responsibilities || []).map((x) => "<p>" + x + "</p>").join(""),
          })),
          education: (structured.education || []).map((e) => ({
            id: "ed_" + uid(),
            school: e.school || "",
            degree: e.degree || "",
            major: e.major || "",
            start: e.start || "",
            end: e.end || "",
            extras: (e.extras || []).join("\n"),
          })),
          certificates: (structured.certificates || []).map((c) => ({
            id: "c_" + uid(),
            name: c.name || "",
            issuer: c.issuer || "",
            date: c.date || "",
            expiry: c.expiry || "",
            credentialId: c.credentialId || c.credential_id || "",
            note: c.note || "",
          })),
          languages: (structured.languages || []).map((l) => ({
            id: "l_" + uid(),
            name: l.name || "",
            level: l.level || "熟练",
            cert: l.cert || "",
            note: l.note || "",
          })),
          honors: (structured.honors || structured.awards || []).map((h) => ({
            id: "h_" + uid(),
            title: typeof h === "string" ? h : (h.title || h.name || ""),
            date: typeof h === "string" ? "" : (h.date || ""),
            note: typeof h === "string" ? "" : (h.note || h.description || ""),
          })),
          modules: modulesFromOrder(resolveModuleOrder(structured)),
          savedResumeId: resumeId || null,
        });
      },

      resetStore: () =>
        set({
          resumeName: "未命名简历",
          templateId: "original",
          avatarLayout: "top",
          avatarUrl: null,
          themeColor: "#2563eb",
          fontFamily: "default",
          modules: [...DEFAULT_MODULES],
          activeSection: "basics",
          basics: { name: "", title: "", status: "", birthday: "", email: "", phone: "", location: "", website: "" },
          skillsContent: "",
          othersContent: "",
          customData: {},
          experience: [],
          projects: [],
          education: [],
          certificates: [],
          languages: [],
          honors: [],
          savedResumeId: null,
        }),
    }),
    {
      name: "resume-editor-v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        const { activeSection, savedResumeId, ...rest } = state;
        return rest;
      },
      merge: (persisted, current) => {
        const p = persisted && typeof persisted === "object" ? persisted : {};
        const merged = { ...current, ...p };
        const order = Array.isArray(merged.modules)
          ? merged.modules.map((m) => m.id)
          : [];
        merged.modules = modulesFromOrder(order);
        if (!Array.isArray(merged.certificates)) merged.certificates = [];
        if (!Array.isArray(merged.languages)) merged.languages = [];
        if (!Array.isArray(merged.honors)) merged.honors = [];
        if (typeof merged.othersContent !== "string") merged.othersContent = "";
        return merged;
      },
    }
  )
);

export { PRESET_COLORS };
