import { useEffect, useState } from "react";
import { api, setAuthToken } from "../api.js";

export default function Account() {
  const [mode, setMode] = useState("login");
  const [user, setUser] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [status, setStatus] = useState("");
  const [form, setForm] = useState({ username: "", email: "", password: "" });

  useEffect(() => {
    api.me()
      .then((data) => {
        setUser(data.user || null);
        if (data.user?.is_admin) loadAdminData();
      })
      .catch(() => setUser(null));
  }, []);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setStatus(mode === "login" ? "正在登录..." : "正在注册...");
    try {
      const data =
        mode === "login"
          ? await api.login(form.username, form.password)
          : await api.register(form);
      if (!data.ok) {
        setStatus(data.error || "操作失败");
        return;
      }
      setUser(data.user);
      if (data.user?.is_admin) loadAdminData();
      else setAdminData(null);
      setStatus(mode === "login" ? "登录成功" : "注册成功，已自动登录");
    } catch (error) {
      setStatus("操作失败：" + error.message);
    }
  }

  function logout() {
    setAuthToken("");
    setUser(null);
    setAdminData(null);
    setStatus("已退出，当前会回到 Demo 身份");
  }

  async function loadAdminData() {
    try {
      const [overview, users] = await Promise.all([api.adminOverview(), api.adminUsers()]);
      setAdminData({ overview, users: users.users || [] });
    } catch {
      setAdminData(null);
    }
  }

  return (
    <main className="page">
      <h1>账号与租户</h1>
      <p className="page-desc">
        SaaS 架构下，每个账号拥有独立的简历素材、题库和面试复盘数据。默认 Demo 身份仍可用于本地演示。
      </p>

      <div className="account-layout">
        <section className="card account-card">
          <div className="tabs">
            <button className={mode === "login" ? "tab active" : "tab"} onClick={() => setMode("login")}>
              登录
            </button>
            <button className={mode === "register" ? "tab active" : "tab"} onClick={() => setMode("register")}>
              注册
            </button>
          </div>
          <label>
            用户名 / 邮箱
            <input
              value={form.username}
              onChange={(event) => update("username", event.target.value)}
              placeholder="登录时可填用户名或邮箱"
            />
          </label>
          {mode === "register" && (
            <label>
              邮箱
              <input value={form.email} onChange={(event) => update("email", event.target.value)} />
            </label>
          )}
          <label>
            密码
            <input
              type="password"
              value={form.password}
              onChange={(event) => update("password", event.target.value)}
            />
          </label>
          <button className="btn primary" onClick={submit}>
            {mode === "login" ? "登录" : "注册并登录"}
          </button>
          {status && <p className="status-line">{status}</p>}
        </section>

        <section className="card account-card">
          <h3>当前身份</h3>
          {user ? (
            <>
              <div className="account-user">
                <strong>{user.username}</strong>
                <span>{user.email}</span>
                {user.is_admin && <span className="tag building">管理员</span>}
              </div>
              <button className="btn ghost" onClick={logout}>
                退出登录
              </button>
            </>
          ) : (
            <p className="muted">当前没有登录账号。本地开发会使用 Demo 身份。</p>
          )}
        </section>
      </div>
      {user?.is_admin && <AdminPanel data={adminData} onRefresh={loadAdminData} />}
    </main>
  );
}

function AdminPanel({ data, onRefresh }) {
  if (!data) {
    return (
      <section className="card admin-panel">
        <div className="row between">
          <h3>SaaS 管理后台</h3>
          <button className="btn small" onClick={onRefresh}>加载数据</button>
        </div>
        <p className="muted">管理员可查看用户、项目和运行模式概览。</p>
      </section>
    );
  }

  const { overview, users } = data;
  const metrics = [
    ["用户数", overview.auth.user_count],
    ["管理员", overview.auth.admin_count],
    ["活跃 Token", overview.auth.active_tokens],
    ["项目数", overview.projects.project_count],
    ["待审核", overview.projects.pending_count],
    ["订单数", overview.projects.order_count],
    ["GMV", `¥${overview.projects.gmv}`],
    ["平台服务费", `¥${overview.projects.platform_fee_total}`],
  ];

  return (
    <section className="card admin-panel">
      <div className="row between">
        <div>
          <h3>SaaS 管理后台</h3>
          <p className="muted">
            {overview.runtime.storage} · {overview.runtime.mock_mode ? "Mock 模式" : "真实模式"} · {overview.runtime.llm_model}
          </p>
        </div>
        <button className="btn small" onClick={onRefresh}>刷新</button>
      </div>

      <div className="admin-metrics">
        {metrics.map(([label, value]) => (
          <div key={label} className="admin-metric">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <h4>用户列表</h4>
      <div className="admin-table">
        {users.map((item) => (
          <div key={item.user_id} className="admin-user-row">
            <div>
              <strong>{item.username}</strong>
              <span>{item.email}</span>
            </div>
            <span>{item.is_admin ? "管理员" : "用户"}</span>
            <span>{item.token_count || 0} token</span>
          </div>
        ))}
      </div>
    </section>
  );
}
