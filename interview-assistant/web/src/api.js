// 后端 REST 基址：开发走 Vite 同源代理，生产 Docker 走 Nginx 同源反代。
export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

// Demo 阶段免登录，用固定 token 代表当前用户；后续接真实登录后替换。
export const DEMO_TOKEN = "demo-user-token";
const TOKEN_KEY = "interview-assistant-auth-token";

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || DEMO_TOKEN;
}

export function setAuthToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getWsBase() {
  if (import.meta.env.VITE_WS_BASE) return import.meta.env.VITE_WS_BASE;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

// 兼容旧入口；SaaS 版优先使用 Web 面试工作台。
function formatApiError(res, data) {
  if (data?.error && typeof data.error === "string") return data.error;
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((item) => item?.msg || JSON.stringify(item)).join("；");
  }
  if (res.status === 500) {
    return "后端未响应或代理失败，请关闭旧窗口后重新运行 start.ps1，并确认 backend(8765) 已启动";
  }
  return `HTTP ${res.status}`;
}

async function handle(res) {
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    throw new Error(formatApiError(res, data));
  }
  return res.json();
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${getAuthToken()}`, ...extra };
}

function apiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
}

export const api = {
  async register(fields) {
    const data = await handle(
      await apiFetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      })
    );
    if (data.token) setAuthToken(data.token);
    return data;
  },
  async login(usernameOrEmail, password) {
    const data = await handle(
      await apiFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username_or_email: usernameOrEmail, password }),
      })
    );
    if (data.token) setAuthToken(data.token);
    return data;
  },
  async me() {
    return handle(await apiFetch("/api/auth/me"));
  },
  async getLlmConfig(options = {}) {
    return handle(await apiFetch("/api/me/llm-config", options));
  },
  async putLlmConfig(body) {
    return handle(
      await apiFetch("/api/me/llm-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async testLlmConfig() {
    return handle(
      await apiFetch("/api/me/llm-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    );
  },
  async adminOverview() {
    return handle(await apiFetch("/api/admin/overview"));
  },
  async adminUsers() {
    return handle(await apiFetch("/api/admin/users"));
  },
  async config() {
    return handle(await apiFetch("/api/config"));
  },
  async getAssets() {
    return handle(await apiFetch("/api/assets"));
  },
  async uploadText(text, options = {}) {
    return handle(
      await apiFetch("/api/resume/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: options.signal,
      })
    );
  },
  async uploadFile(file, options = {}) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await apiFetch("/api/resume/file", {
        method: "POST",
        body: fd,
        signal: options.signal,
      });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(formatApiError(res, data));
      }
      return data || {};
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error instanceof TypeError) {
        throw new Error("无法连接后端，请确认 backend 已启动（端口 8765）");
      }
      throw error;
    }
  },
  async clearAssets() {
    return handle(await apiFetch("/api/assets", { method: "DELETE" }));
  },
  async deleteAsset(assetId) {
    return handle(await apiFetch(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }));
  },
  async extractMaterial(file) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await apiFetch("/api/materials/extract", { method: "POST", body: fd });
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        throw new Error(formatApiError(res, data));
      }
      return data || {};
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("无法连接后端，请确认 backend 已启动（端口 8765）");
      }
      throw error;
    }
  },
  async analyzeProjectPack(body) {
    return handle(
      await apiFetch("/api/project-packs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async analyzeJdMatch(body, options = {}) {
    return handle(
      await apiFetch("/api/jd-match/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      })
    );
  },
  async reconstructJdMatch(body, options = {}) {
    return handle(
      await apiFetch("/api/jd-match/reconstruct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      })
    );
  },
  async applyJdOptimize(body) {
    return handle(
      await apiFetch("/api/jd-match/apply-optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async fetchJdFromUrl(body) {
    return handle(
      await apiFetch("/api/jd-match/fetch-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async generateJdMaterials(body, options = {}) {
    return handle(
      await apiFetch("/api/jd-match/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      })
    );
  },
  async exportJdReport(body) {
    return handle(
      await apiFetch("/api/jd-match/export-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },

  // ---- 资料库文档 / 卡片 + 项目库 ----
  async uploadMaterialDoc(file, docType = "other") {
    const fd = new FormData();
    fd.append("file", file);
    const qs = docType ? `?doc_type=${encodeURIComponent(docType)}` : "";
    return handle(await apiFetch(`/api/material-docs${qs}`, { method: "POST", body: fd }));
  },
  async listMaterialDocs(includeText = false) {
    const qs = includeText ? "?include_text=true" : "";
    return handle(await apiFetch(`/api/material-docs${qs}`));
  },
  async archiveMaterialDoc(docId, force = false) {
    return handle(
      await apiFetch(`/api/material-docs/${encodeURIComponent(docId)}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      })
    );
  },
  async listMaterialCards(docId) {
    const qs = docId ? `?doc_id=${encodeURIComponent(docId)}` : "";
    return handle(await apiFetch(`/api/material-cards${qs}`));
  },
  async patchMaterialCard(cardId, body) {
    return handle(
      await apiFetch(`/api/material-cards/${encodeURIComponent(cardId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async syncResumeProjects(body) {
    return handle(
      await apiFetch("/api/resume-projects/from-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async listResumeProjects(sourceResumeId) {
    const qs = sourceResumeId ? `?source_resume_id=${encodeURIComponent(sourceResumeId)}` : "";
    return handle(await apiFetch(`/api/resume-projects${qs}`));
  },
  async bindProjectCards(projectId, cardIds, replace = false) {
    return handle(
      await apiFetch(`/api/resume-projects/${encodeURIComponent(projectId)}/bind`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card_ids: cardIds, replace }),
      })
    );
  },
  async optimizeResumeProject(projectId) {
    return handle(
      await apiFetch(`/api/resume-projects/${encodeURIComponent(projectId)}/optimize`, {
        method: "POST",
      })
    );
  },

  // ---- 我的题库（通用 / 专属 / 定制 + 合并会话）----
  async getQuestionBanks() {
    return handle(await apiFetch("/api/question-banks"));
  },
  async getGeneralBank(role) {
    const qs = role ? `?role=${encodeURIComponent(role)}` : "";
    return handle(await apiFetch(`/api/question-banks/general${qs}`));
  },
  async getPersonalBank() {
    return handle(await apiFetch("/api/question-banks/personal"));
  },
  async getCustomBank() {
    return handle(await apiFetch("/api/question-banks/custom"));
  },
  async generatePersonalBank() {
    return handle(
      await apiFetch("/api/question-banks/personal/generate", { method: "POST" })
    );
  },
  async generateCustomBank(jdText) {
    return handle(
      await apiFetch("/api/question-banks/custom/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jd_text: jdText }),
      })
    );
  },
  async sessionSysQuestions(body) {
    return handle(
      await apiFetch("/api/question-banks/session/sys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async sessionFromAssets(body) {
    return handle(
      await apiFetch("/api/question-banks/session/from-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async sessionFromJd(body) {
    return handle(
      await apiFetch("/api/question-banks/session/from-jd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async featuredQuestions(body) {
    return handle(
      await apiFetch("/api/question-banks/featured", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async sessionStart(body) {
    return handle(
      await apiFetch("/api/question-banks/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async sessionPersonal(body) {
    return handle(
      await apiFetch("/api/question-banks/session/personal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  },
  async analyzeQuestion(qid, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 190000);
    try {
      return await handle(
        await apiFetch(`/api/question-banks/questions/${encodeURIComponent(qid)}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
          signal: ctrl.signal,
        })
      );
    } catch (e) {
      if (e?.name === "AbortError" || /abort/i.test(e?.message || "")) {
        throw new Error("生成超时，请重试");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  },
  /** @deprecated 兼容旧调用，等同专属题库 */
  async getQuestions() {
    return this.getPersonalBank();
  },
  async generateQuestions() {
    return this.generatePersonalBank();
  },
  async updateQuestion(qid, fields) {
    return handle(
      await apiFetch(`/api/questions/${qid}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      })
    );
  },
  async deleteQuestion(qid) {
    return handle(
      await apiFetch(`/api/questions/${qid}`, { method: "DELETE" })
    );
  },
  async addQuestion(fields) {
    return handle(
      await apiFetch("/api/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      })
    );
  },

  // ---- 面试复盘 ----
  async getReviews() {
    return handle(await apiFetch("/api/reviews"));
  },
  async getReview(sid) {
    return handle(await apiFetch(`/api/reviews/${sid}`));
  },
  async generateReviewReport(sid) {
    return handle(await apiFetch(`/api/reviews/${sid}/report`, { method: "POST" }));
  },
  async getReviewReport(sid) {
    return handle(await apiFetch(`/api/reviews/${sid}/report`));
  },
  async nextMockQuestion(history) {
    return handle(
      await apiFetch("/api/mock-interview/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history }),
      })
    );
  },
  async createMockInterview(fields) {
    return handle(
      await apiFetch("/api/mock-interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      })
    );
  },
  async getMockInterview(sid) {
    return handle(await apiFetch(`/api/mock-interviews/${sid}`));
  },
  async nextMockInterviewQuestion(sid) {
    return handle(await apiFetch(`/api/mock-interviews/${sid}/next`, { method: "POST" }));
  },
  async submitMockInterviewAnswer(sid, answerText) {
    return handle(
      await apiFetch(`/api/mock-interviews/${sid}/answers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer_text: answerText }),
      })
    );
  },
  async skipMockInterviewQuestion(sid) {
    return handle(await apiFetch(`/api/mock-interviews/${sid}/skip`, { method: "POST" }));
  },
  async fetchMockInterviewOutline(sid) {
    return handle(await apiFetch(`/api/mock-interviews/${sid}/outline`, { method: "POST" }));
  },
  async finishMockInterview(sid) {
    return handle(await apiFetch(`/api/mock-interviews/${sid}/finish`, { method: "POST" }));
  },
  async getMockInterviewReport(sid) {
    return handle(await apiFetch(`/api/mock-interviews/${sid}/report`));
  },
  getMockInterviewReportHtmlUrl(sid) {
    return `${API_BASE}/api/mock-interviews/${sid}/report.html`;
  },
  async fetchMockInterviewReportHtml(sid) {
    const res = await apiFetch(`/api/mock-interviews/${sid}/report.html`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  },
  async downloadMockInterviewReportHtml(sid, filename) {
    const html = await this.fetchMockInterviewReportHtml(sid);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || `模拟面试报告-${sid}.html`;
    a.click();
    URL.revokeObjectURL(url);
  },
  async deleteReview(sid) {
    return handle(
      await apiFetch(`/api/reviews/${sid}`, { method: "DELETE" })
    );
  },
  async reviewItemToBank(sid, itemId) {
    return handle(
      await apiFetch(`/api/reviews/${sid}/to-bank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      })
    );
  },

  // ---- 我的项目库 ----
  async getProjects(role) {
    const qs = role ? `?role=${encodeURIComponent(role)}` : "";
    return handle(await apiFetch(`/api/projects${qs}`));
  },
  async getProject(pid) {
    return handle(await apiFetch(`/api/projects/${pid}`));
  },
  async purchaseProject(pid) {
    return handle(
      await apiFetch(`/api/projects/${pid}/purchase`, { method: "POST" })
    );
  },
  async getPurchasedProjects() {
    return handle(await apiFetch("/api/projects/purchased"));
  },
  async getMyProjects() {
    return handle(await apiFetch("/api/projects/mine"));
  },
  async getMyIncome() {
    return handle(await apiFetch("/api/projects/income"));
  },
  async createProject(fields) {
    return handle(
      await apiFetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      })
    );
  },
  async reviewProject(pid, action) {
    return handle(
      await apiFetch(`/api/projects/${pid}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
    );
  },
  async delistProject(pid) {
    return handle(
      await apiFetch(`/api/projects/${pid}`, { method: "DELETE" })
    );
  },
  async projectToAssets(pid) {
    return handle(
      await apiFetch(`/api/projects/${pid}/to-assets`, { method: "POST" })
    );
  },

  // ---- 面经 ----
  async fetchMianJingExperiences({
    jobL1 = "",
    jobL2 = "",
    jobL3,
    limit = 10,
    useCache = true,
    excludeSeen = false,
    resetSeen = false,
  } = {}) {
    return handle(
      await apiFetch("/api/mianjing/experiences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_l1: jobL1,
          job_l2: jobL2,
          job_l3: jobL3,
          limit,
          use_cache: useCache,
          exclude_seen: excludeSeen,
          reset_seen: resetSeen,
        }),
      })
    );
  },
  async generateMianJing(structuredData, targetRole) {
    return handle(
      await apiFetch("/api/mianjing/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structured: structuredData, target_role: targetRole }),
      })
    );
  },
  async getMianJingList() {
    return handle(await apiFetch("/api/mianjing"));
  },
  async getMianJing(mid) {
    return handle(await apiFetch(`/api/mianjing/${mid}`));
  },
  async deleteMianJing(mid) {
    return handle(await apiFetch(`/api/mianjing/${mid}`, { method: "DELETE" }));
  },
};
