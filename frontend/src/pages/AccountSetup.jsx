/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 · focused account setup */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export default function AccountSetup() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const { logout } = useAuth();
  // The token is a URL fragment, never sent in the initial HTTP request or referrer.
  useEffect(() => { window.history.replaceState(null, "", window.location.pathname); }, []);
  const submit = async (e) => {
    e.preventDefault(); setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      await api.post("/auth/complete-account", { token, password });
      await logout();
      setPassword(""); setConfirm(""); setDone(true);
    } catch (err) { setError(formatError(err)); }
    finally { setBusy(false); }
  };
  return <main className="flex min-h-screen items-center justify-center bg-background p-4"><div className="w-full max-w-md space-y-5 rounded-xl border bg-card p-6 sm:p-8">
    <h1 className="min-w-0 break-words text-2xl font-semibold">{done ? "Your password is ready" : "Set your account password"}</h1>
    {done ? <><p role="status" className="text-sm">Your account is ready. Sign in with your email and new password.</p><Link to="/signin" className="eb-button">Sign in</Link></> : !token ? <p role="alert">This link is incomplete. Ask your administrator for a new invitation or reset link.</p> : <>
      <p className="text-sm text-muted-foreground">Choose a password of at least 12 characters. Your administrator will never see it.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <form className="space-y-4" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-medium">New password<input className="eb-input w-full" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={password} onChange={(e) => setPassword(e.target.value)} disabled={busy} /></label>
        <label className="grid gap-2 text-sm font-medium">Confirm password<input className="eb-input w-full" type="password" autoComplete="new-password" minLength={12} maxLength={72} required value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={busy} /></label>
        <button className="eb-button w-full" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
      </form>
    </>}
  </div></main>;
}
