/** 与后端 resume_schema 对齐的前端契约 + 评分/批注/布局工具 */

/** 上传解析默认顺序（技能偏后，贴近常见 PDF 结构） */
export const MODULE_ORDER = [
  "basics", "summary", "experience", "projects",
  "education", "skills", "certificates", "languages", "honors", "others",
];

/** 新建简历编辑器默认顺序（技能在工作经历前） */
export const CREATE_MODULE_ORDER = [
  "basics", "skills", "experience", "projects", "education",
  "certificates", "languages", "honors", "others",
];

export const SCORE_DIMENSIONS = [
  { id: "structure", label: "结构与格式", max: 15 },
  { id: "completeness", label: "信息完整度", max: 15 },
  { id: "expression", label: "表达质量", max: 20 },
  { id: "quantification", label: "量化与证据", max: 20 },
  { id: "credibility", label: "专业可信度", max: 15 },
  { id: "differentiation", label: "差异化亮点", max: 15 },
];

export const SCORE_TOTAL_MAX = 110;

export function gradeFromTotal(total) {
  const t = Number(total) || 0;
  if (t >= 90) return "优秀";
  if (t >= 75) return "良好";
  if (t >= 60) return "合格";
  if (t >= 40) return "待改进";
  return "不合格";
}

export function emptyStructured() {
  return {
    schema_version: 1,
    template_id: "system-default",
    origin: "",
    module_order: [],
    basics: { name: "", phone: "", email: "", city: "", target_role: "", links: [] },
    summary: { bullets: [] },
    experience: [],
    projects: [],
    education: [],
    skills: [],
    honors: [],
    certificates: [],
    languages: [],
    others: "",
    needs_confirmation: [],
    extras: {},
    score_detail: { total: 0, base: 0, bonus: 0, penalty: 0, grade: "", dimensions: {}, summary: "" },
    quality_report: null,
    annotations: [],
    layout_blocks: [],
  };
}

function asStr(v) {
  return v == null ? "" : String(v).trim();
}

function asStrList(v) {
  if (!v) return [];
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (Array.isArray(v)) return v.map((x) => asStr(x)).filter(Boolean);
  return [];
}

export function normalizeStructured(data) {
  const base = emptyStructured();
  if (!data || typeof data !== "object") return base;
  const src = data.resume && typeof data.resume === "object" ? data.resume : data;

  const b = src.basics && typeof src.basics === "object" ? src.basics : {};
  base.basics = {
    name: asStr(b.name),
    phone: asStr(b.phone),
    email: asStr(b.email),
    city: asStr(b.city),
    target_role: asStr(b.target_role || b.intention),
    links: asStrList(b.links),
    _birthday: asStr(b._birthday || b.birthday || b.birth_date),
    _status: asStr(b._status || b.status),
    _website: asStr(b._website || b.website),
    _avatarUrl: asStr(b._avatarUrl || b.avatarUrl),
    _age: asStr(b._age || b.age),
    _workYears: asStr(b._workYears || b.work_years),
    _educationLevel: asStr(b._educationLevel || b.education_level),
  };

  if (src.summary && typeof src.summary === "object") {
    base.summary = { bullets: asStrList(src.summary.bullets) };
  } else if (Array.isArray(src.summary)) {
    base.summary = { bullets: asStrList(src.summary) };
  }

  base.experience = (src.experience || [])
    .filter((x) => x && typeof x === "object")
    .map((e) => ({
      company: asStr(e.company),
      title: asStr(e.title || e.role),
      start: asStr(e.start || e.start_date),
      end: asStr(e.end || e.end_date),
      location: asStr(e.location),
      bullets: asStrList(e.bullets || e.highlights),
      _html: asStr(e._html),
    }))
    .filter((e) => e.company || e.title || e.bullets.length || e._html);

  base.projects = (src.projects || [])
    .filter((x) => x && typeof x === "object")
    .map((p) => {
      let responsibilities = asStrList(p.responsibilities || p.duties);
      let achievements = asStrList(p.achievements || p.results);
      let bullets = asStrList(p.bullets || p.highlights);
      if (!responsibilities.length && bullets.length) {
        responsibilities = [...bullets];
        bullets = [];
      }
      return {
        name: asStr(p.name || p.title || p.project_name),
        role: asStr(p.role || p.position),
        company: asStr(p.company || p.org),
        start: asStr(p.start || p.start_date),
        end: asStr(p.end || p.end_date),
        intro: asStr(p.intro || p.description),
        responsibilities,
        achievements,
        bullets,
        _html: asStr(p._html),
      };
    })
    .filter((p) => p.name || p.intro || p.responsibilities.length || p.achievements.length || p.bullets.length);

  base.education = (src.education || [])
    .filter((x) => x && typeof x === "object")
    .map((e) => ({
      school: asStr(e.school || e.institution),
      degree: asStr(e.degree),
      major: asStr(e.major),
      start: asStr(e.start || e.start_date),
      end: asStr(e.end || e.end_date),
      extras: asStrList(e.extras || e.details),
    }))
    .filter((e) => e.school || e.degree || e.major);

  if (Array.isArray(src.skills)) {
    base.skills = src.skills
      .map((s) => {
        if (typeof s === "string") return { group: "技能", items: [s.trim()].filter(Boolean) };
        if (!s || typeof s !== "object") return null;
        return { group: asStr(s.group || s.category || "技能"), items: asStrList(s.items || s.skills) };
      })
      .filter((s) => s && s.items.length);
  } else if (src.skills && typeof src.skills === "object") {
    base.skills = Object.entries(src.skills)
      .map(([group, items]) => ({ group: asStr(group), items: asStrList(items) }))
      .filter((s) => s.items.length);
  }

  base.honors = (src.honors || src.awards || [])
    .map((h) => {
      if (typeof h === "string") return { title: h.trim(), date: "", note: "" };
      if (!h || typeof h !== "object") return null;
      return { title: asStr(h.title || h.name), date: asStr(h.date), note: asStr(h.note || h.description) };
    })
    .filter((h) => h && h.title);

  base.certificates = (src.certificates || src.certs || [])
    .map((c) => {
      if (typeof c === "string") {
        return { name: c.trim(), issuer: "", date: "", expiry: "", credentialId: "", note: "" };
      }
      if (!c || typeof c !== "object") return null;
      return {
        name: asStr(c.name || c.title),
        issuer: asStr(c.issuer),
        date: asStr(c.date),
        expiry: asStr(c.expiry),
        credentialId: asStr(c.credentialId || c.credential_id),
        note: asStr(c.note),
      };
    })
    .filter((c) => c && c.name);

  base.languages = (src.languages || [])
    .map((l) => {
      if (typeof l === "string") return { name: l.trim(), level: "", cert: "", note: "" };
      if (!l || typeof l !== "object") return null;
      return {
        name: asStr(l.name || l.language),
        level: asStr(l.level),
        cert: asStr(l.cert || l.certificate),
        note: asStr(l.note),
      };
    })
    .filter((l) => l && l.name);

  if (typeof src.others === "string") base.others = asStr(src.others);
  else if (src.others && typeof src.others === "object") {
    base.others = asStr(src.others.content || src.others.text);
  }
  base._othersHtml = asStr(src._othersHtml);

  base.needs_confirmation = asStrList(src.needs_confirmation);
  if (src.origin) base.origin = asStr(src.origin);
  if (src.module_order && Array.isArray(src.module_order) && src.module_order.length) {
    // 保留自定义模块 id（custom_*），不再只允许 MODULE_ORDER 白名单
    base.module_order = src.module_order.map((x) => asStr(x)).filter(Boolean);
  }
  if (src.extras && typeof src.extras === "object") {
    base.extras = { ...src.extras };
  }
  base._skillsHtml = asStr(src._skillsHtml);

  // 完整书写质量报告
  if (src.quality_report && typeof src.quality_report === "object") {
    base.quality_report = src.quality_report;
  }

  // 多维度评分（总分 0–110）
  if (src.score_detail && typeof src.score_detail === "object") {
    const dims = src.score_detail.dimensions || {};
    const flat = {};
    SCORE_DIMENSIONS.forEach((d) => {
      const v = dims[d.id];
      let n = 0;
      if (v && typeof v === "object") n = parseInt(v.score, 10) || 0;
      else n = parseInt(v, 10) || 0;
      if (n > d.max && n <= 100) n = Math.round((n / 100) * d.max);
      flat[d.id] = Math.max(0, Math.min(d.max, n));
    });
    base.score_detail = {
      total: Math.max(0, Math.min(SCORE_TOTAL_MAX, parseInt(src.score_detail.total, 10) || 0)),
      base: parseInt(src.score_detail.base, 10) || 0,
      bonus: parseInt(src.score_detail.bonus, 10) || 0,
      penalty: parseInt(src.score_detail.penalty, 10) || 0,
      grade: asStr(src.score_detail.grade),
      dimensions: flat,
      summary: asStr(src.score_detail.summary),
    };
  }

  // 若仅有 quality_report，派生 score_detail
  if (base.quality_report && (!src.score_detail || !(src.score_detail.total > 0))) {
    const qr = base.quality_report;
    const flat = {};
    SCORE_DIMENSIONS.forEach((d) => {
      const dim = qr.dimensions?.[d.id];
      let n = dim && typeof dim === "object" ? (parseInt(dim.score, 10) || 0) : (parseInt(dim, 10) || 0);
      if (n > d.max && n <= 100) n = Math.round((n / 100) * d.max);
      flat[d.id] = Math.max(0, Math.min(d.max, n));
    });
    base.score_detail = {
      total: Math.max(0, Math.min(SCORE_TOTAL_MAX, parseInt(qr.total, 10) || 0)),
      base: parseInt(qr.base, 10) || 0,
      bonus: parseInt(qr.bonus, 10) || 0,
      penalty: parseInt(qr.penalty, 10) || 0,
      grade: asStr(qr.grade),
      dimensions: flat,
      summary: asStr(qr.summary),
    };
  }

  // LLM 批注
  if (Array.isArray(src.annotations)) {
    base.annotations = src.annotations.map((a, i) => ({
      id: asStr(a.id) || `a-${i}`,
      title: asStr(a.title),
      body: asStr(a.body),
      severity: asStr(a.severity) || "info",
      quote: asStr(a.quote),
      section: asStr(a.section),
      suggestion: asStr(a.suggestion || a.fix),
    }));
  }

  // 布局块（支持新旧两种格式）
  if (Array.isArray(src.layout_blocks) && src.layout_blocks.length) {
    base.layout_blocks = src.layout_blocks.map((b) => {
      // 新格式：带 size/color/bold/x/y 的样式块
      if (b.size != null || b.x != null) {
        return {
          type: asStr(b.type) || "paragraph",
          text: asStr(b.text),
          size: parseFloat(b.size) || 10.5,
          color: asStr(b.color) || "#000000",
          bold: Boolean(b.bold),
          x: parseFloat(b.x) || 0,
          y: parseFloat(b.y) || 0,
        };
      }
      // 旧格式：style + children
      return {
        type: asStr(b.type) || "paragraph",
        text: asStr(b.text),
        size: null,
        color: null,
        bold: false,
        x: 0,
        y: 0,
        style: b.style || {},
        children: (b.children || []).map((c) => ({
          type: asStr(c.type) || "bullet",
          text: asStr(c.text),
          style: c.style || {},
          children: [],
        })),
      };
    });
  }

  return base;
}

export function structuredToPlainText(structured) {
  const s = normalizeStructured(structured);
  const lines = [];
  const b = s.basics;
  const head = [b.name, b.phone, b.email, b.city, b.target_role].filter(Boolean).join(" · ");
  if (head) lines.push(head);
  if (b.links?.length) lines.push("链接：" + b.links.join(" · "));
  if (s.summary.bullets.length) {
    lines.push("个人简介");
    s.summary.bullets.forEach((x) => lines.push("- " + x));
  }
  if (s.experience.length) {
    lines.push("工作经历");
    s.experience.forEach((e) => {
      lines.push([e.company, e.title, [e.start, e.end].filter(Boolean).join("-"), e.location].filter(Boolean).join(" · "));
      (e.bullets || []).forEach((x) => lines.push("- " + x));
    });
  }
  if (s.projects.length) {
    lines.push("项目经历");
    s.projects.forEach((p) => {
      lines.push([p.name, p.role, p.company, [p.start, p.end].filter(Boolean).join("-")].filter(Boolean).join(" · "));
      if (p.intro) lines.push("项目简介：" + p.intro);
      if (p.responsibilities?.length) {
        lines.push("项目职责：");
        p.responsibilities.forEach((x) => lines.push("- " + x));
      }
      if (p.achievements?.length) {
        lines.push("项目业绩：");
        p.achievements.forEach((x) => lines.push("- " + x));
      }
      (p.bullets || []).forEach((x) => lines.push("- " + x));
    });
  }
  if (s.education.length) {
    lines.push("教育背景");
    s.education.forEach((e) => {
      lines.push([e.school, e.degree, e.major, [e.start, e.end].filter(Boolean).join("-")].filter(Boolean).join(" · "));
      (e.extras || []).forEach((x) => lines.push("- " + x));
    });
  }
  if (s.skills.length) {
    lines.push("技能");
    s.skills.forEach((g) => lines.push(`${g.group || "技能"}：${(g.items || []).join(" / ")}`));
  }
  if (s.honors.length) {
    lines.push("荣誉证书");
    s.honors.forEach((h) => lines.push([h.title, h.date, h.note].filter(Boolean).join(" · ")));
  }
  if ((s.certificates || []).length) {
    lines.push("证书");
    s.certificates.forEach((c) => {
      lines.push([c.name, c.issuer, c.date, c.expiry, c.credentialId, c.note].filter(Boolean).join(" · "));
    });
  }
  if ((s.languages || []).length) {
    lines.push("语言能力");
    s.languages.forEach((l) => {
      lines.push([l.name, l.level, l.cert, l.note].filter(Boolean).join(" · "));
    });
  }
  if (s.others || s._othersHtml) {
    lines.push("其他");
    lines.push(asStr(s.others) || asStr(s._othersHtml).replace(/<[^>]+>/g, " "));
  }
  return lines.join("\n");
}

/**
 * 评分：优先用后端 LLM 评分，否则回退到启发式
 */
export function scoreStructured(s, structured) {
  const n = normalizeStructured(s);
  // 后端 LLM 评分（0–110）
  if (n.score_detail && n.score_detail.total > 0) {
    return n.score_detail.total;
  }
  if (structured && structured.score_detail && structured.score_detail.total > 0) {
    return structured.score_detail.total;
  }
  if (n.quality_report && n.quality_report.total > 0) {
    return n.quality_report.total;
  }
  // 回退：启发式（未分析，非六维分）
  let score = 55;
  if (n.basics.name) score += 8;
  if (n.basics.phone || n.basics.email) score += 5;
  if (n.experience.length) score += Math.min(12, n.experience.length * 4);
  if (n.projects.length) score += Math.min(10, n.projects.length * 4);
  if (n.education.length) score += 6;
  if (n.skills.length) score += 4;
  if (n.summary.bullets.length) score += 4;
  if (n.honors.length) score += 3;
  return Math.min(92, score);
}

/** 获取评分详情（多维度） */
export function getScoreDetail(structured) {
  const n = normalizeStructured(structured);
  if (n.score_detail && n.score_detail.total > 0) {
    return n.score_detail;
  }
  if (structured && structured.score_detail && structured.score_detail.total > 0) {
    return structured.score_detail;
  }
  return null;
}

/** 获取完整质量报告 */
export function getQualityReport(structured) {
  const n = normalizeStructured(structured);
  if (n.quality_report && typeof n.quality_report === "object" && (n.quality_report.total > 0 || n.quality_report.dimensions)) {
    return n.quality_report;
  }
  if (structured?.quality_report && typeof structured.quality_report === "object") {
    return structured.quality_report;
  }
  return null;
}

/** 上一层分析是否已识别出可用简历内容 */
export function hasUsableStructured(structured) {
  const s = normalizeStructured(structured);
  if (s.basics?.name) return true;
  if ((s.experience || []).length) return true;
  if ((s.projects || []).length) return true;
  if ((s.education || []).length) return true;
  if ((s.skills || []).length) return true;
  if ((s.summary?.bullets || []).length) return true;
  if ((s.certificates || []).length) return true;
  return false;
}

/**
 * 批注解析：优先后端 LLM 批注
 */
export function buildAnnotationsFromStructured(structured) {
  const s = normalizeStructured(structured);
  const ann = [];

  // LLM 批注优先
  if (s.annotations && s.annotations.length > 0) {
    return s.annotations;
  }

  // 回退：简单启发式
  if (!s.basics.name) {
    ann.push({ id: "a-name", title: "缺少姓名", body: "请在基础信息中填写姓名。", severity: "error", quote: "", section: "basics", suggestion: "" });
  }
  const weak = (s.summary.bullets || []).find((b) => /学习能力|沟通能力|认真负责|有责任心/.test(b));
  if (weak) {
    ann.push({ id: "a1", title: "简介偏空泛", body: "用可验证成果替换软评价。", severity: "warning", quote: weak, section: "summary", suggestion: "改为具体成果+量化数据" });
  }
  const expWeak = s.experience.flatMap((e) => e.bullets || []).find((b) => /负责.+工作|效果较好/.test(b));
  if (expWeak) {
    ann.push({ id: "a2", title: "经历表述偏弱", body: "补齐行动与可量化结果（XYZ）。", severity: "warning", quote: expWeak.slice(0, 80), section: "experience", suggestion: "使用STAR格式+量化数字" });
  }
  (s.projects || []).slice(0, 4).forEach((p, i) => {
    const quote = (p.responsibilities && p.responsibilities[0]) || p.intro || p.name;
    if (!quote) return;
    ann.push({ id: `a-proj-${i}`, title: `项目核对：${p.name || `项目${i + 1}`}`, body: "对照原件检查简介/职责/业绩是否串段；纸面以原 PDF 为准。", severity: "info", quote: String(quote).slice(0, 60), section: "projects", suggestion: "" });
  });
  if (!s.experience.length && !s.projects.length) {
    ann.push({ id: "a-exp", title: "缺少经历模块", body: "请补充工作/实习或项目经历。", severity: "error", quote: "", section: "experience", suggestion: "" });
  }
  if (!ann.length) {
    ann.push({ id: "a-ok", title: "结构已识别", body: "可在右侧对照批注继续打磨表述。", severity: "info", quote: "", section: "", suggestion: "" });
  }
  return ann;
}

/** 按严重度分组 */
export function groupAnnotationsBySeverity(annotations) {
  const groups = { error: [], warning: [], info: [] };
  (annotations || []).forEach((a) => {
    const sev = a.severity || "info";
    if (groups[sev]) groups[sev].push(a);
  });
  return groups;
}

/**
 * 解析最终模块顺序：
 * 1) 已存 module_order
 * 2) origin=upload → 上传默认序
 * 3) 否则新建默认序（技能在工作经历前）
 */
export function resolveModuleOrder(structured) {
  const s = structured && typeof structured === "object" ? structured : {};
  if (Array.isArray(s.module_order) && s.module_order.length) {
    return s.module_order.map((x) => asStr(x)).filter(Boolean);
  }
  if (asStr(s.origin) === "upload") return [...MODULE_ORDER];
  return [...CREATE_MODULE_ORDER];
}

/** 为 structured 补齐 origin / module_order（返回新对象） */
export function withSourceModuleOrder(structured, origin) {
  const raw = structured && typeof structured === "object" ? structured : {};
  const hadOrder = Array.isArray(raw.module_order) && raw.module_order.length > 0;
  const s = normalizeStructured(structured);
  if (origin) s.origin = origin;
  else if (!s.origin && raw.origin) s.origin = asStr(raw.origin);

  if (!hadOrder) {
    s.module_order = (origin || s.origin) === "upload" ? [...MODULE_ORDER] : [...CREATE_MODULE_ORDER];
  }
  return s;
}

export function buildProfileFromStructured(structured) {
  const s = normalizeStructured(structured);
  return {
    name: s.basics.name || "未填写",
    city: s.basics.city || "—",
    contact: [s.basics.email, s.basics.phone].filter(Boolean).join(" · ") || "—",
    scenario: "社招",
    roleFamily: s.basics.target_role || "待完善",
    education: s.education[0]
      ? [s.education[0].school, s.education[0].degree, s.education[0].major].filter(Boolean).join(" · ")
      : "—",
    skills: s.skills.map((g) => (g.items || []).join("、")).filter(Boolean).join("；") || "—",
    star: "从项目深挖同步 STAR 案例后展示",
  };
}
