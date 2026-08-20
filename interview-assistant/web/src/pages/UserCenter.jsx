import { Navigate, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { AdminPanel } from "./Account.jsx";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import "../user-center.css";

const MENUS = [
  { to: "/user/info", label: "账号资料" },
  { to: "/resume?tab=resumes", label: "我的简历" },
  { to: "/user/credit", label: "积分", slot: true },
  { to: "/user/order", label: "订单", slot: true },
  { to: "/review", label: "面试记录" },
  { to: "/user/notifications", label: "消息", slot: true },
  { to: "/user/feedback", label: "反馈", slot: true },
  { to: "/user/referral", label: "邀请", slot: true },
  { to: "/ai-providers", label: "AI 服务商" },
];

function SlotPage({ title }) {
  return (
    <div className="uc-panel">
      <h1>{title}</h1>
      <div className="uc-slot">功能待接入</div>
    </div>
  );
}

function InfoPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [adminData, setAdminData] = useState(null);

  async function loadAdmin() {
    if (!user?.is_admin) {
      setAdminData(null);
      return;
    }
    try {
      const [overview, users] = await Promise.all([api.adminOverview(), api.adminUsers()]);
      setAdminData({ overview, users: users.users || [] });
    } catch {
      setAdminData(null);
    }
  }

  useEffect(() => {
    loadAdmin();
  }, [user?.is_admin]);

  function onLogout() {
    logout();
    navigate("/");
  }

  const initial = (user?.username || "?").slice(0, 1).toUpperCase();

  return (
    <div className="uc-panel">
      <h1>账号资料</h1>
      <div className="uc-profile">
        <div className="uc-avatar-lg" aria-hidden="true">
          {initial}
        </div>
        <div>
          <p className="uc-name">{user?.username}</p>
          <p className="uc-meta">{user?.email || "邮箱待完善"}</p>
          {user?.is_admin && <span className="uc-tag">管理员</span>}
        </div>
      </div>
      <button type="button" className="uc-logout" onClick={onLogout}>
        退出登录
      </button>
      {user?.is_admin && <AdminPanel data={adminData} onRefresh={loadAdmin} />}
    </div>
  );
}

export default function UserCenter() {
  const { loggedIn, ready, openAuth } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!ready) return;
    if (!loggedIn) {
      openAuth();
      navigate("/", { replace: true });
    }
  }, [ready, loggedIn, openAuth, navigate]);

  if (!ready || !loggedIn) return null;

  const path = location.pathname;
  let pane = <InfoPage />;
  if (path === "/user/credit") pane = <SlotPage title="积分" />;
  else if (path === "/user/order") pane = <SlotPage title="订单" />;
  else if (path === "/user/notifications") pane = <SlotPage title="消息" />;
  else if (path === "/user/feedback") pane = <SlotPage title="反馈" />;
  else if (path === "/user/referral") pane = <SlotPage title="邀请" />;
  else if (path === "/user" || path === "/user/") pane = <Navigate to="/user/info" replace />;

  return (
    <main className="uc">
      <div className="uc-wrap">
        <aside className="uc-nav">
          {MENUS.map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              className={({ isActive }) =>
                `uc-nav-item${isActive || (m.to.startsWith("/user/") && path === m.to) ? " is-on" : ""}`
              }
              end={m.to === "/user/info"}
            >
              {m.label}
            </NavLink>
          ))}
        </aside>
        <section className="uc-main">{pane}</section>
      </div>
    </main>
  );
}
