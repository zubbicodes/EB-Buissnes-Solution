import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatError, getToken, setToken } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = unauth, object = auth
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(false);
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      // token invalid or expired — clear it
      setToken("");
      setUser(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Global 401 → soft logout (Protected will redirect to /signin via React Router).
  useEffect(() => {
    const onLogout = () => setUser(false);
    window.addEventListener("ebrr:logout", onLogout);
    return () => window.removeEventListener("ebrr:logout", onLogout);
  }, []);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      if (data?.access_token) setToken(data.access_token);
      setUser({ id: data.id, email: data.email, name: data.name });
      return true;
    } catch (e) {
      setError(formatError(e));
      return false;
    }
  };

  const register = async (name, email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/register", { name, email, password });
      if (data?.access_token) setToken(data.access_token);
      setUser({ id: data.id, email: data.email, name: data.name });
      return true;
    } catch (e) {
      setError(formatError(e));
      return false;
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch { /* noop */ }
    setToken("");
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, error, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
