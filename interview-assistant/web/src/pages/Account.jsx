import { Navigate } from "react-router-dom";

export default function Account() {
  return <Navigate to="/user/info" replace />;
}

export function AdminPanel({ data, onRefresh }) {
  if (!data) {
    return (
      <section className="card admin-panel">
        <div className="row between">
          <h3>SaaS 管理后台</h3>
          <button type="button" className="btn small" onClick={onRefresh}>
            加载数据
          </button>
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
            {overview.runtime.storage} · {overview.runtime.mock_mode ? "Mock 模式" : "真实模式"} ·{" "}
            {overview.runtime.llm_model}
          </p>
        </div>
        <button type="button" className="btn small" onClick={onRefresh}>
          刷新
        </button>
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
