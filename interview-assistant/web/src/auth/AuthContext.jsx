import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, hasSession, setAuthToken } from "../api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!hasSession()) {
      setUser(null);
      setReady(true);
      return;
    }
    try {
      const data = await api.me();
      setUser(data.user || null);
    } catch {
      setAuthToken("");
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    setAuthToken("");
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      loggedIn: Boolean(user && hasSession()),
      authOpen,
      openAuth: () => setAuthOpen(true),
      closeAuth: () => setAuthOpen(false),
      refresh,
      logout,
    }),
    [user, ready, authOpen, refresh, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 需在 AuthProvider 内使用");
  return ctx;
}
