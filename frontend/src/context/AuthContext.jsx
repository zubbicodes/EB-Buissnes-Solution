import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatError, setToken } from "@/lib/api";

const AuthContext = createContext(null);

const userFromAuth = (data) => ({
  id: data.id,
  email: data.email,
  name: data.name,
  org_id: data.org_id,
  role: data.role,
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = unauth, object = auth
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setToken("");
      setUser(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
      setUser(userFromAuth(data));
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
      setUser(userFromAuth(data));
      return true;
    } catch (e) {
      setError(formatError(e));
      return false;
    }
  };

  const googleLogin = async (credential) => {
    setError("");
    try {
      const { data } = await api.post("/auth/google", { credential });
      if (data?.access_token) setToken(data.access_token);
      setUser(userFromAuth(data));
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
    <AuthContext.Provider value={{ user, error, login, register, googleLogin, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
