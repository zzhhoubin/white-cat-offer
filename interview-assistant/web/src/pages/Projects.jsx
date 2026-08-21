import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import "../projects-saas.css";

const TAGS = [
  { id: "hot", label: "热门教程" },
  { id: "backend", label: "后端项目" },
  { id: "frontend", label: "前端项目" },
  { id: "ai", label: "AI项目" },
  { id: "tech", label: "技术教程" },
  { id: "job", label: "求职攻略" },
  { id: "basic", label: "编程基础" },
];

const CATS = [
  { id: "free", label: "免费" },
  { id: "paid", label: "付费" },
  { id: "member", label: "会员免费" },
];

const TONES = ["navy", "sky", "orange", "purple"];
const DECOS = ["</>", "💬", "{ }", "✦"];

const STATUS_LABEL = {
  pending: "待审核",
  published: "已上架",
  rejected: "审核拒绝",
  delisted: "已下架",
};

function blobOf(p) {
  return `${p.title || ""} ${(p.tags || []).join(" ")} ${p.project_type || ""} ${(p.target_roles || []).join(" ")} ${p.preview_summary || ""} ${p.difficulty || ""}`.toLowerCase();
}

function matchTag(p, tagId) {
  if (!tagId) return true;
  const b = blobOf(p);
  if (tagId === "hot") return Boolean(p.featured) || (p.sales_count || 0) > 0 || (p.price || 0) >= 19;
  if (tagId === "backend") return /后端|java|并发|redis|架构/.test(b);
  if (tagId === "frontend") return /前端|react|组件/.test(b);
  if (tagId === "ai") return /ai|rag|大模型|llm|向量/.test(b);
  if (tagId === "job") return /面试|简历|求职|讲法/.test(b);
  if (tagId === "basic") return /入门|基础|编程基础/.test(b);
  return /教程|工程|数据|系统/.test(b);
}

function matchCat(p, catId) {
  if (!catId) return true;
  const paid = Number(p.price) > 0;
  if (catId === "free") return !paid;
  if (catId === "paid") return paid;
  if (catId === "member") return paid;
  return true;
}

function toneOf(p, i = 0) {
  const s = p.project_id || p.title || String(i);
  let n = 0;
  for (let k = 0; k < s.length; k += 1) n += s.charCodeAt(k);
  return TONES[n % TONES.length];
}

function stackOf(p) {
  const tags = (p.tags || []).slice(0, 4);
  return tags.length ? tags.join(" + ") : p.project_type || (p.target_roles || []).slice(0, 2).join(" / ");
}

function listPrice(p) {
  const now = Number(p.price) || 0;
  if (now <= 0) return 0;
  return Math.round(now * 1.6 * 10) / 10;
}

function Paragraphs({ text }) {
  return (
    <div className="answer-text">
      {(text || "").split(/\n{2,}/).map((para, i) => (
        <p key={i}>{para}</p>
      ))}
    </div>
  );
}

function CourseCard({ p, compact, featured, onOpen }) {
  const paid = Number(p.price) > 0;
  const old = listPrice(p);
  return (
    <article
      className={`sp-card${compact ? " is-sm" : ""}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
    >
      <div className={`sp-banner is-${toneOf(p)}`}>
        {featured ? <span className="sp-pick">精选</span> : null}
        <h3>{p.title}</h3>
        <p className="sp-stack">{stackOf(p)}</p>
        <span className="sp-banner-deco" aria-hidden="true">
          {DECOS[(p.title || "").length % DECOS.length]}
        </span>
      </div>
      <div className="sp-card-body">
        <p className="sp-long-title">{p.preview_summary || p.title}</p>
        <div className="sp-card-foot">
          <div className="sp-price">
            {paid ? (
              <>
                <span className="sp-price-now">¥{p.price}</span>
                {old > p.price ? <span className="sp-price-old">¥{old}</span> : null}
              </>
            ) : (
              <span className="sp-price-free">免费</span>
            )}
          </div>
          <div className="sp-actions">
            {paid ? <span className="sp-tag-paid">付费课程</span> : <span className="sp-tag-paid">免费课程</span>}
            <button
              type="button"
              className="sp-vip"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
            >
              {p.locked ? "会员免费" : "继续学习"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function Projects() {
  const [view, setView] = useState("market");
  const [status, setStatus] = useState("");
  const [tag, setTag] = useState("");
  const [cat, setCat] = useState("");
  const [projects, setProjects] = useState([]);
  const [purchased, setPurchased] = useState([]);
  const [mine, setMine] = useState([]);
  const [income, setIncome] = useState(null);
  const [selected, setSelected] = useState(null);

  async function loadMarket() {
    try {
      const data = await api.getProjects("");
      setProjects(data.projects || []);
    } catch {
      setStatus("无法连接后端，请确认后端已启动（python app.py）");
    }
  }
  async function loadPurchased() {
    try {
      const d = await api.getPurchasedProjects();
      setPurchased(d.projects || []);
    } catch {
      setPurchased([]);
    }
  }
  async function loadMine() {
    try {
      const [d, inc] = await Promise.all([api.getMyProjects(), api.getMyIncome()]);
      setMine(d.projects || []);
      setIncome(inc);
    } catch {
      setMine([]);
    }
  }

  useEffect(() => {
    loadMarket();
    loadPurchased();
  }, []);

  useEffect(() => {
    if (view === "mine") loadMine();
    if (view === "purchased") loadPurchased();
  }, [view]);

  const filtered = useMemo(
    () => projects.filter((p) => matchTag(p, tag) && matchCat(p, cat)),
    [projects, tag, cat]
  );
  const featured = useMemo(() => {
    const ranked = [...projects].sort((a, b) => (b.price || 0) - (a.price || 0));
    return ranked.slice(0, 3);
  }, [projects]);
  const learning = purchased.slice(0, 4);

  async function openDetail(pid) {
    try {
      const d = await api.getProject(pid);
      if (!d.error) setSelected(d);
    } catch (e) {
      setStatus(e.message || "无法打开项目");
    }
  }

  async function buy(pid) {
    setStatus("正在模拟支付…");
    try {
      const r = await api.purchaseProject(pid);
      if (r.ok) {
        setStatus("购买成功，已解锁完整内容");
        if (r.project) setSelected(r.project);
        loadMarket();
        loadPurchased();
      } else {
        setStatus("购买失败：" + (r.error || "未知错误"));
      }
    } catch (e) {
      setStatus("购买失败：" + e.message);
    }
  }

  async function addToAssets(pid) {
    const r = await api.projectToAssets(pid);
    setStatus(r.ok ? r.note || "已加入素材库" : "加入失败：" + (r.error || ""));
  }

  const featuredIds = new Set(featured.map((p) => p.project_id));

  return (
    <main className="sp-page">
      <div className="sp-filters">
        <div className="sp-filter-row">
          <span className="sp-filter-label">标签</span>
          <div className="sp-filter-opts">
            {TAGS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`sp-chip${tag === t.id ? " is-on" : ""}`}
                onClick={() => setTag(tag === t.id ? "" : t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sp-filter-row">
          <span className="sp-filter-label">类别</span>
          <div className="sp-filter-opts">
            {CATS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`sp-chip${cat === c.id ? " is-on" : ""}`}
                onClick={() => setCat(cat === c.id ? "" : c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {status ? <p className="sp-status">{status}</p> : null}

      {view === "mine" ? (
        <div className="sp-sub">
          <button type="button" className="sp-more" onClick={() => setView("market")}>
            ← 返回课程列表
          </button>
          <MineTab mine={mine} income={income} onReload={loadMine} onOpen={openDetail} setStatus={setStatus} />
        </div>
      ) : (
        <div className="sp-body">
          <div className="sp-main">
            {view === "purchased" ? (
              <>
                <button type="button" className="sp-more" onClick={() => setView("market")}>
                  ← 返回课程列表
                </button>
                <div className="sp-grid" style={{ marginTop: 12 }}>
                  {purchased.length === 0 ? (
                    <p className="sp-empty">还没有在学的项目。</p>
                  ) : (
                    purchased.map((p) => (
                      <CourseCard
                        key={p.project_id}
                        p={p}
                        featured={featuredIds.has(p.project_id)}
                        onOpen={() => openDetail(p.project_id)}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="sp-grid">
                {filtered.length === 0 ? (
                  <p className="sp-empty">该筛选下暂无项目。</p>
                ) : (
                  filtered.map((p) => (
                    <CourseCard
                      key={p.project_id}
                      p={p}
                      featured={featuredIds.has(p.project_id)}
                      onOpen={() => openDetail(p.project_id)}
                    />
                  ))
                )}
              </div>
            )}
          </div>

          <aside className="sp-side">
            <div className="sp-guide">
              <div className="sp-guide-kicker" aria-hidden="true">
                🚀
              </div>
              <h2>项目学习指南</h2>
              <p>想快速完成项目？从这里开始</p>
            </div>

            <section className="sp-panel">
              <div className="sp-panel-h">
                <h2>我正在学</h2>
                <button type="button" className="sp-more" onClick={() => setView("purchased")}>
                  更多&gt;
                </button>
              </div>
              {learning.length === 0 ? (
                <p className="sp-empty" style={{ padding: "8px 0" }}>
                  购买后会出现在这里
                </p>
              ) : (
                <ul className="sp-learn-list">
                  {learning.map((p) => (
                    <li key={p.project_id}>
                      <button type="button" onClick={() => openDetail(p.project_id)}>
                        <span className="sp-play" aria-hidden="true">
                          ▶
                        </span>
                        <span className="sp-learn-name">{p.title}</span>
                        <span className="sp-learn-arr">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" className="sp-upload-link" onClick={() => setView("mine")}>
                上传我的项目
              </button>
            </section>

            <section className="sp-panel">
              <div className="sp-panel-h">
                <h2>精选教程</h2>
                <button type="button" className="sp-more" onClick={() => setTag("hot")}>
                  更多&gt;
                </button>
              </div>
              <div className="sp-side-cards">
                {featured.slice(0, 3).map((p) => (
                  <CourseCard
                    key={p.project_id}
                    p={p}
                    compact
                    featured
                    onOpen={() => openDetail(p.project_id)}
                  />
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {selected && (
        <DetailModal
          p={selected}
          onClose={() => setSelected(null)}
          onBuy={() => buy(selected.project_id)}
          onAddAssets={() => addToAssets(selected.project_id)}
        />
      )}
    </main>
  );
}

function DetailModal({ p, onClose, onBuy, onAddAssets }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal proj-modal" onClick={(e) => e.stopPropagation()}>
        <div className="row between">
          <h3>{p.title}</h3>
          <span className="diff-tag">{p.difficulty}</span>
        </div>
        <div className="proj-owner">
          {p.owner_name} · {(p.target_roles || []).join(" / ")}
        </div>
        <div className="kw-row">
          {(p.tags || []).map((t, i) => (
            <span key={i} className="kw">
              {t}
            </span>
          ))}
        </div>
        {p.locked ? (
          <>
            <p className="proj-summary-lock">{p.preview_summary}</p>
            <div className="lock-box">
              <p>完整方案、简历写法与面试讲法已锁定</p>
              <button type="button" className="btn primary" onClick={onBuy}>
                ¥{p.price} 购买解锁（模拟支付）
              </button>
            </div>
            <button type="button" className="btn ghost block" onClick={onClose}>
              关闭
            </button>
          </>
        ) : (
          <>
            <Paragraphs text={p.full_content} />
            <div className="row gap modal-actions">
              <button type="button" className="btn" onClick={onAddAssets}>
                加入素材库
              </button>
              <button type="button" className="btn ghost" onClick={onClose}>
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const EMPTY_FORM = {
  title: "",
  target_roles: "",
  difficulty: "进阶",
  project_type: "",
  tags: "",
  preview_summary: "",
  full_content: "",
  price: "9.9",
  originality: "",
};

function MineTab({ mine, income, onReload, onOpen, setStatus }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  function upd(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit() {
    if (!form.title.trim() || !form.preview_summary.trim()) {
      setStatus("请至少填写项目标题和项目简介");
      return;
    }
    setSubmitting(true);
    try {
      await api.createProject({
        title: form.title.trim(),
        target_roles: form.target_roles.split(/[,，\s]+/).filter(Boolean),
        difficulty: form.difficulty,
        project_type: form.project_type.trim(),
        tags: form.tags.split(/[,，\s]+/).filter(Boolean),
        preview_summary: form.preview_summary.trim(),
        full_content: form.full_content.trim(),
        price: parseFloat(form.price) || 0,
        originality: form.originality.trim(),
      });
      setForm(EMPTY_FORM);
      setStatus("已提交，等待平台审核（演示：可在下方手动通过/拒绝）");
      onReload();
    } catch (e) {
      setStatus("提交失败：" + e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function doReview(pid, action) {
    await api.reviewProject(pid, action);
    onReload();
  }
  async function delist(pid) {
    await api.delistProject(pid);
    onReload();
  }

  return (
    <div className="mine-layout">
      <section className="card upload-form">
        <h3>上传项目</h3>
        <p className="muted small">
          上传前请确认拥有合法发布权，且不含未经授权的公司内部资料、客户信息或商业秘密。
        </p>
        <label>
          项目标题
          <input value={form.title} onChange={(e) => upd("title", e.target.value)} />
        </label>
        <label>
          适配岗位（逗号分隔）
          <input
            value={form.target_roles}
            onChange={(e) => upd("target_roles", e.target.value)}
            placeholder="后端工程师, Java工程师"
          />
        </label>
        <div className="row gap">
          <label className="grow">
            难度
            <select value={form.difficulty} onChange={(e) => upd("difficulty", e.target.value)}>
              <option>入门</option>
              <option>进阶</option>
              <option>高级</option>
            </select>
          </label>
          <label className="grow">
            售价（元）
            <input type="number" value={form.price} onChange={(e) => upd("price", e.target.value)} />
          </label>
        </div>
        <label>
          标签（逗号分隔）
          <input
            value={form.tags}
            onChange={(e) => upd("tags", e.target.value)}
            placeholder="高并发, Redis"
          />
        </label>
        <label>
          项目简介（未付费可见）
          <textarea rows={3} value={form.preview_summary} onChange={(e) => upd("preview_summary", e.target.value)} />
        </label>
        <label>
          完整内容（付费解锁）
          <textarea
            rows={5}
            value={form.full_content}
            onChange={(e) => upd("full_content", e.target.value)}
            placeholder="项目背景 / 你的角色 / 关键方案 / 量化结果 / 简历写法 / 面试讲法"
          />
        </label>
        <label>
          原创性声明
          <input
            value={form.originality}
            onChange={(e) => upd("originality", e.target.value)}
            placeholder="本项目为本人真实经历，拥有合法发布权"
          />
        </label>
        <button type="button" className="btn primary" disabled={submitting} onClick={submit}>
          {submitting ? "提交中…" : "提交审核"}
        </button>
      </section>

      <section className="card">
        {income && (
          <div className="income-bar">
            <div>
              <span className="muted small">累计收益</span>
              <strong>¥{income.owner_income_total}</strong>
            </div>
            <div>
              <span className="muted small">成交订单</span>
              <strong>{income.order_count}</strong>
            </div>
            <div>
              <span className="muted small">作者分成</span>
              <strong>{Math.round((1 - income.platform_rate) * 100)}%</strong>
            </div>
          </div>
        )}
        <h3>我的上传（{mine.length}）</h3>
        {mine.length === 0 ? (
          <p className="muted">还没有上传项目。</p>
        ) : (
          <ul className="mine-list">
            {mine.map((p) => (
              <li key={p.project_id} className="mine-item">
                <div className="row between">
                  <strong>{p.title}</strong>
                  <span className={`st-badge st-${p.status}`}>{STATUS_LABEL[p.status] || p.status}</span>
                </div>
                <div className="muted small">
                  ¥{p.price} · 销量 {p.sales_count} · 收益 ¥{p.income_total}
                </div>
                <div className="row gap">
                  {p.status === "published" && (
                    <button type="button" className="btn small" onClick={() => onOpen(p.project_id)}>
                      查看
                    </button>
                  )}
                  {p.status === "pending" && (
                    <>
                      <button type="button" className="btn small primary" onClick={() => doReview(p.project_id, "approve")}>
                        （演示）通过审核
                      </button>
                      <button type="button" className="btn small ghost" onClick={() => doReview(p.project_id, "reject")}>
                        拒绝
                      </button>
                    </>
                  )}
                  {p.status === "published" && (
                    <button type="button" className="btn small ghost" onClick={() => delist(p.project_id)}>
                      下架
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
