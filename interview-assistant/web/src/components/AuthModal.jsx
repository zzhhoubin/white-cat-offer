import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { useAuth } from "../auth/AuthContext.jsx";
import "../auth-modal.css";

export default function AuthModal() {
  const { authOpen, closeAuth, refresh } = useAuth();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  if (!authOpen) return null;

  async function submit(e) {
    e.preventDefault();
    if (!account.trim() || !password) {
      setStatus("请填写账号和密码");
      return;
    }
    setBusy(true);
    setStatus("正在登录…");
    try {
      const data = await api.loginOrRegister(account, password);
      if (!data.ok && data.error) {
        setStatus(data.error);
        return;
      }
      await refresh();
      setStatus("");
      setPassword("");
      closeAuth();
    } catch (err) {
      setStatus(err.message || "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="am-mask" onClick={closeAuth} role="presentation">
      <div
        className="am-dialog"
        role="dialog"
        aria-labelledby="am-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="am-close" onClick={closeAuth} aria-label="关闭">
          ×
        </button>
        <h2 id="am-title" className="am-title">
          登录 / 注册
        </h2>
        <p className="am-sub">未注册的账号将自动开通，无需单独注册</p>
        <form className="am-form" onSubmit={submit}>
          <label>
            手机号 / 用户名 / 邮箱
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
              placeholder="登录即注册"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="am-submit" disabled={busy}>
            {busy ? "请稍候" : "登录 / 注册"}
          </button>
          {status && <p className="am-status">{status}</p>}
        </form>
        <p className="am-legal">
          登录即表示同意使用条款。不代答、不替面、不鼓励伪造经历。
        </p>
      </div>
    </div>,
    document.body
  );
}
