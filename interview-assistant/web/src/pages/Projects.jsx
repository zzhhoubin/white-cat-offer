import { useEffect, useState } from "react";
import { api } from "../api.js";

const STATUS_LABEL = {
  pending: "待审核",
  published: "已上架",
  rejected: "审核拒绝",
  delisted: "已下架",
};

function Paragraphs({ text }) {
  return (
    <div className="answer-text">
      {(text || "").split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

export default function Projects() {
  const [tab, setTab] = useState("market");
  const [status, setStatus] = useState("");

  // 市场
  const [projects, setProjects] = useState([]);
  const [roles, setRoles] = useState([]);
  const [role, setRole] = useState("");
  const [selected, setSelected] = useState(null);

  // 我的购买 / 我的上传 / 收益
  const [purchased, setPurchased] = useState([]);
  const [mine, setMine] = useState([]);
  const [income, setIncome] = useState(null);

  async function loadMarket() {
    try {
      const data = await api.getProjects(role);
      setProjects(data.projects || []);
      setRoles(data.roles || []);
    } catch {
      setStatus("无法连接后端，请确认后端已启动（python app.py）");
    }
  }
  async function loadPurchased() {
    const d = await api.getPurchasedProjects();
    setPurchased(d.projects || []);
  }
  async function loadMine() {
    const [d, inc] = await Promise.all([api.getMyProjects(), api.getMyIncome()]);
    setMine(d.projects || []);
    setIncome(inc);
  }

  useEffect(() => {
    loadMarket();
  }, [role]);

  useEffect(() => {
    if (tab === "purchased") loadPurchased();
    if (tab === "mine") loadMine();
  }, [tab]);

  async function openDetail(pid) {
    const d = await api.getProject(pid);
    if (!d.error) setSelected(d);
  }

  async function buy(pid) {
    setStatus("正在模拟支付…");
    try {
      const r = await api.purchaseProject(pid);
      if (r.ok) {
        setStatus("购买成功，已解锁完整内容");
        if (r.project) setSelected(r.project);
        loadMarket();
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

  return (
    <main className="page">
      <h1>我的项目库</h1>
      <p className="page-desc">
        按目标岗位浏览优秀项目案例。未付费仅展示标题与简介，付费后解锁完整方案、简历写法与面试讲法；
        也可上传自己的项目，审核上架后被购买获得收益分成。
        <br />
        <span className="muted">
          内容仅供学习、实践与表达参考，请结合你的真实经历使用，切勿直接虚构履历。
        </span>
      </p>

      <div className="tabs">
        <button className={tab === "market" ? "tab active" : "tab"} onClick={() => setTab("market")}>
          项目市场
        </button>
        <button className={tab === "purchased" ? "tab active" : "tab"} onClick={() => setTab("purchased")}>
          我的购买
        </button>
        <button className={tab === "mine" ? "tab active" : "tab"} onClick={() => setTab("mine")}>
          我的上传
        </button>
        {status && <span className="status-line">{status}</span>}
      </div>

      {tab === "market" && (
        <>
          <div className="role-chips">
            <button className={!role ? "chip active" : "chip"} onClick={() => setRole("")}>
              全部岗位
            </button>
            {roles.map((r) => (
              <button key={r} className={role === r ? "chip active" : "chip"} onClick={() => setRole(r)}>
                {r}
              </button>
            ))}
          </div>
          <div className="proj-grid">
            {projects.length === 0 ? (
              <p className="muted">该岗位下暂无项目。</p>
            ) : (
              projects.map((p) => (
                <ProjectCard key={p.project_id} p={p} onOpen={() => openDetail(p.project_id)} onBuy={() => buy(p.project_id)} />
              ))
            )}
          </div>
        </>
      )}

      {tab === "purchased" && (
        <div className="proj-grid">
          {purchased.length === 0 ? (
            <p className="muted">还没有购买任何项目。去「项目市场」看看吧。</p>
          ) : (
            purchased.map((p) => (
              <div key={p.project_id} className="card proj-card">
                <div className="proj-head">
                  <strong>{p.title}</strong>
                  <span className="diff-tag">{p.difficulty}</span>
                </div>
                <div className="kw-row">
                  {(p.tags || []).map((t, i) => (
                    <span key={i} className="kw">{t}</span>
                  ))}
                </div>
                <p className="asset-content">{p.preview_summary}</p>
                <div className="row gap">
                  <button className="btn small" onClick={() => openDetail(p.project_id)}>查看完整内容</button>
                  <button className="btn small ghost" onClick={() => addToAssets(p.project_id)}>加入素材库</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "mine" && (
        <MineTab
          mine={mine}
          income={income}
          onReload={loadMine}
          onOpen={openDetail}
          setStatus={setStatus}
        />
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

function ProjectCard({ p, onOpen, onBuy }) {
  return (
    <div className="card proj-card">
      <div className="proj-head">
        <strong>{p.title}</strong>
        <span className="diff-tag">{p.difficulty}</span>
      </div>
      <div className="proj-owner">{p.owner_name} · {(p.target_roles || []).join(" / ")}</div>
      <div className="kw-row">
        {(p.tags || []).map((t, i) => (
          <span key={i} className="kw">{t}</span>
        ))}
      </div>
      <p className="asset-content">{p.preview_summary}</p>
      <div className="proj-foot">
        <span className="price">¥{p.price}</span>
        {p.locked ? (
          <button className="btn small primary" onClick={onBuy}>购买解锁</button>
        ) : (
          <button className="btn small" onClick={onOpen}>查看完整内容</button>
        )}
      </div>
    </div>
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
        <div className="proj-owner">{p.owner_name} · {(p.target_roles || []).join(" / ")}</div>
        <div className="kw-row">
          {(p.tags || []).map((t, i) => (
            <span key={i} className="kw">{t}</span>
          ))}
        </div>

        {p.locked ? (
          <>
            <p className="proj-summary-lock">{p.preview_summary}</p>
            <div className="lock-box">
              <p>完整方案、简历写法与面试讲法已锁定</p>
              <button className="btn primary" onClick={onBuy}>¥{p.price} 购买解锁（模拟支付）</button>
            </div>
          </>
        ) : (
          <>
            <Paragraphs text={p.full_content} />
            <div className="row gap modal-actions">
              <button className="btn" onClick={onAddAssets}>加入素材库</button>
              <button className="btn ghost" onClick={onClose}>关闭</button>
            </div>
          </>
        )}
        {p.locked && (
          <button className="btn ghost block" onClick={onClose}>关闭</button>
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
        <label>项目标题<input value={form.title} onChange={(e) => upd("title", e.target.value)} /></label>
        <label>适配岗位（逗号分隔）<input value={form.target_roles} onChange={(e) => upd("target_roles", e.target.value)} placeholder="后端工程师, Java工程师" /></label>
        <div className="row gap">
          <label className="grow">难度
            <select value={form.difficulty} onChange={(e) => upd("difficulty", e.target.value)}>
              <option>入门</option><option>进阶</option><option>高级</option>
            </select>
          </label>
          <label className="grow">售价（元）<input type="number" value={form.price} onChange={(e) => upd("price", e.target.value)} /></label>
        </div>
        <label>标签（逗号分隔）<input value={form.tags} onChange={(e) => upd("tags", e.target.value)} placeholder="高并发, Redis" /></label>
        <label>项目简介（未付费可见）<textarea rows={3} value={form.preview_summary} onChange={(e) => upd("preview_summary", e.target.value)} /></label>
        <label>完整内容（付费解锁）<textarea rows={5} value={form.full_content} onChange={(e) => upd("full_content", e.target.value)} placeholder="项目背景 / 你的角色 / 关键方案 / 量化结果 / 简历写法 / 面试讲法" /></label>
        <label>原创性声明<input value={form.originality} onChange={(e) => upd("originality", e.target.value)} placeholder="本项目为本人真实经历，拥有合法发布权" /></label>
        <button className="btn primary" disabled={submitting} onClick={submit}>
          {submitting ? "提交中…" : "提交审核"}
        </button>
      </section>

      <section className="card">
        {income && (
          <div className="income-bar">
            <div><span className="muted small">累计收益</span><strong>¥{income.owner_income_total}</strong></div>
            <div><span className="muted small">成交订单</span><strong>{income.order_count}</strong></div>
            <div><span className="muted small">作者分成</span><strong>{Math.round((1 - income.platform_rate) * 100)}%</strong></div>
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
                    <button className="btn small" onClick={() => onOpen(p.project_id)}>查看</button>
                  )}
                  {p.status === "pending" && (
                    <>
                      <button className="btn small primary" onClick={() => doReview(p.project_id, "approve")}>（演示）通过审核</button>
                      <button className="btn small ghost" onClick={() => doReview(p.project_id, "reject")}>拒绝</button>
                    </>
                  )}
                  {p.status === "published" && (
                    <button className="btn small ghost" onClick={() => delist(p.project_id)}>下架</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          说明：真实环境由平台客服人工审核，这里为方便演示提供手动「通过/拒绝」。
        </p>
      </section>
    </div>
  );
}
