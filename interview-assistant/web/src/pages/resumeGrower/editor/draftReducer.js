import { emptyStructured, normalizeStructured } from "../structuredResume.js";

export const SECTION_META = {
  basics:     { label: "基本信息", icon: "👤" },
  summary:    { label: "个人总结", icon: "📝" },
  experience: { label: "工作经历", icon: "💼" },
  projects:   { label: "项目经历", icon: "🚀" },
  education:  { label: "教育背景", icon: "🎓" },
  skills:     { label: "技能特长", icon: "🛠️" },
  honors:     { label: "荣誉奖项", icon: "🏆" },
};

export const MODULE_ORDER = ["basics", "summary", "experience", "projects", "education", "skills", "honors"];

function emptyExp() {
  return { company: "", title: "", start: "", end: "", location: "", bullets: [] };
}

function emptyProj() {
  return { name: "", role: "", company: "", start: "", end: "", intro: "", responsibilities: [], achievements: [], bullets: [] };
}

function emptyEdu() {
  return { school: "", degree: "", major: "", start: "", end: "", extras: [] };
}

export function createDraft() {
  return {
    ...emptyStructured(),
    templateId: "original",
    resumeName: "未命名简历",
  };
}

export function draftReducer(state, action) {
  switch (action.type) {
    case "SET_BASICS": {
      const key = action.key;
      return { ...state, basics: { ...state.basics, [key]: action.value } };
    }
    case "SET_SUMMARY_BULLETS":
      return { ...state, summary: { bullets: action.payload } };

    // experience
    case "ADD_EXPERIENCE":
      return { ...state, experience: [...state.experience, emptyExp()] };
    case "UPDATE_EXPERIENCE": {
      const exp = state.experience.map((e, i) => {
        if (i !== action.index) return e;
        if (action.key === "bullets") return { ...e, bullets: action.value };
        return { ...e, [action.key]: action.value };
      });
      return { ...state, experience: exp };
    }
    case "REMOVE_EXPERIENCE":
      return { ...state, experience: state.experience.filter((_, i) => i !== action.index) };

    // projects
    case "ADD_PROJECT":
      return { ...state, projects: [...state.projects, emptyProj()] };
    case "UPDATE_PROJECT": {
      const proj = state.projects.map((p, i) => {
        if (i !== action.index) return p;
        if (action.key === "responsibilities" || action.key === "achievements" || action.key === "bullets") {
          return { ...p, [action.key]: action.value };
        }
        return { ...p, [action.key]: action.value };
      });
      return { ...state, projects: proj };
    }
    case "REMOVE_PROJECT":
      return { ...state, projects: state.projects.filter((_, i) => i !== action.index) };

    // education
    case "ADD_EDUCATION":
      return { ...state, education: [...state.education, emptyEdu()] };
    case "UPDATE_EDUCATION": {
      const edu = state.education.map((e, i) => {
        if (i !== action.index) return e;
        if (action.key === "extras") return { ...e, extras: action.value };
        return { ...e, [action.key]: action.value };
      });
      return { ...state, education: edu };
    }
    case "REMOVE_EDUCATION":
      return { ...state, education: state.education.filter((_, i) => i !== action.index) };

    // skills: array of {group, items: string[]}
    case "ADD_SKILL_GROUP":
      return { ...state, skills: [...state.skills, { group: "技能", items: [""] }] };
    case "UPDATE_SKILL_GROUP": {
      const sk = state.skills.map((s, i) => {
        if (i !== action.index) return s;
        if (action.key === "items") return { ...s, items: action.value };
        return { ...s, group: action.value };
      });
      return { ...state, skills: sk };
    }
    case "REMOVE_SKILL_GROUP":
      return { ...state, skills: state.skills.filter((_, i) => i !== action.index) };

    // honors
    case "ADD_HONOR":
      return { ...state, honors: [...state.honors, { title: "", date: "", note: "" }] };
    case "UPDATE_HONOR": {
      const hon = state.honors.map((h, i) => {
        if (i !== action.index) return h;
        return { ...h, [action.key]: action.value };
      });
      return { ...state, honors: hon };
    }
    case "REMOVE_HONOR":
      return { ...state, honors: state.honors.filter((_, i) => i !== action.index) };

    case "SET_TEMPLATE":
      return { ...state, templateId: action.payload };
    case "SET_NAME":
      return { ...state, resumeName: action.payload };
    case "LOAD_STRUCTURED": {
      const s = normalizeStructured(action.payload);
      return { ...state, ...s, templateId: state.templateId, resumeName: state.resumeName };
    }
    default:
      return state;
  }
}
