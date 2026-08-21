import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import "../nav-saas.css";
import { useAuth } from "../auth/AuthContext.jsx";

const CLOSE_DELAY_MS = 180;

const groups = [
  { type: "link", to: "/", label: "首页", end: true },
  {
    type: "dropdown",
    id: "materials",
    label: "简历养成记",
    defaultTo: "/resume?tab=resumes",
    match: (path) => path.startsWith("/resume"),
    items: [
      { to: "/resume?tab=resumes", label: "我的简历" },
      { to: "/resume?tab=library", label: "我的资料库" },
      { to: "/resume?tab=deep-dive", label: "项目深挖" },
      { to: "/resume?tab=profile", label: "我的信息" },
    ],
  },
  {
    type: "dropdown",
    id: "banks",
    label: "题库和实战项目",
    defaultTo: "/questions",
    match: (path) =>
      path.startsWith("/questions") ||
      path.startsWith("/projects") ||
      path.startsWith("/mianjing"),
    items: [
      { to: "/questions", label: "题库" },
      { to: "/projects", label: "实战项目" },
      { to: "/mianjing", label: "面经" },
    ],
  },
  {
    type: "dropdown",
    id: "assist",
    label: "面试助手",
    defaultTo: "/interview/realtime",
    match: (path) => path.startsWith("/interview") || path.startsWith("/review"),
    items: [
      { to: "/interview/realtime", label: "AI实时辅助" },
      { to: "/interview/mock", label: "AI模拟面试" },
      { to: "/review", label: "面试复盘" },
    ],
  },
];

function itemActive(to, location) {
  const [path, qs] = to.split("?");
  if (location.pathname !== path) return false;
  if (!qs) return true;
  const want = new URLSearchParams(qs);
  const cur = new URLSearchParams(location.search);
  for (const [k, v] of want.entries()) {
    if (cur.get(k) !== v) return false;
  }
  return true;
}

function Dropdown({ group, open, onOpen, onCloseSoon, onCloseNow }) {
  const location = useLocation();
  const active = group.match(location.pathname);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [coords, setCoords] = useState(null);

  function updateCoords() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return undefined;
    }
    updateCoords();
    window.addEventListener("resize", updateCoords);
    window.addEventListener("scroll", updateCoords, true);
    return () => {
      window.removeEventListener("resize", updateCoords);
      window.removeEventListener("scroll", updateCoords, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    function onDoc(e) {
      const t = e.target;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      onCloseNow();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, onCloseNow]);

  const menu =
    open &&
    coords &&
    createPortal(
      <div
        ref={menuRef}
        className="ns-menu ns-menu-portal"
        style={{ top: coords.top, left: coords.left }}
        role="menu"
        onMouseEnter={onOpen}
        onMouseLeave={onCloseSoon}
      >
        {group.items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            role="menuitem"
            className={() => (itemActive(item.to, location) ? "active" : "")}
            onClick={onCloseNow}
          >
            {item.label}
          </NavLink>
        ))}
      </div>,
      document.body
    );

  return (
    <div
      className={`ns-dropdown${open ? " open" : ""}${active ? " active" : ""}`}
      ref={rootRef}
      onMouseEnter={onOpen}
      onMouseLeave={onCloseSoon}
    >
      <div ref={triggerRef}>
        <NavLink
          to={group.defaultTo}
          className={() => `ns-link ns-trigger${active ? " active" : ""}`}
          onClick={(e) => {
            if (window.matchMedia("(max-width: 780px)").matches && !open) {
              e.preventDefault();
              onOpen();
            } else {
              onCloseNow();
            }
          }}
        >
          {group.label}
          <span className="ns-caret" aria-hidden="true" />
        </NavLink>
      </div>
      {menu}
    </div>
  );
}

export default function Nav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loggedIn, user, openAuth } = useAuth();
  const [openId, setOpenId] = useState(null);
  const closeTimer = useRef(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function openMenu(id) {
    clearCloseTimer();
    setOpenId(id);
  }

  function closeSoon() {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setOpenId(null);
      closeTimer.current = null;
    }, CLOSE_DELAY_MS);
  }

  function closeNow() {
    clearCloseTimer();
    setOpenId(null);
  }

  useEffect(() => {
    closeNow();
  }, [location.pathname, location.search]);

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <header className="nav-saas">
      <div className="ns-inner">
        <Link to="/" className="ns-logo" onMouseEnter={closeSoon}>
          <img src="/logo.png" alt="" className="ns-logo-img" />
          GoodJob
        </Link>

        <nav className="ns-links" aria-label="主导航">
          {groups.map((g) =>
            g.type === "link" ? (
              <NavLink
                key={g.to}
                to={g.to}
                end={g.end}
                className={({ isActive }) => `ns-link${isActive ? " active" : ""}`}
                onMouseEnter={closeSoon}
              >
                {g.label}
              </NavLink>
            ) : (
              <Dropdown
                key={g.id}
                group={g}
                open={openId === g.id}
                onOpen={() => openMenu(g.id)}
                onCloseSoon={closeSoon}
                onCloseNow={closeNow}
              />
            )
          )}
        </nav>

        <div className="ns-actions">
          {loggedIn ? (
            <button
              type="button"
              className={`ns-avatar${location.pathname.startsWith("/user") ? " is-on" : ""}`}
              onClick={() => navigate("/user/info")}
              aria-label="个人中心"
            >
              {(user?.username || "?").slice(0, 1).toUpperCase()}
            </button>
          ) : (
            <button type="button" className="ns-auth" onClick={openAuth}>
              登录 / 注册
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
