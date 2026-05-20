import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, formatError } from "@/lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = unauth, object = auth
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data);
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
      setUser(data);
      return true;
    } catch (e) {
      setError(formatError(e));
      return false;
    }
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {/*noop*/}
    setUser(false);
  };

  return (
    <AuthContext.Provider value={{ user, error, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
