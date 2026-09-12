import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/DesignSystem";
import { useAuth } from "@/context/AuthContext";
import { api, formatError } from "@/lib/api";

export default function AccountSettings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(user?.email || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const emailChanged = email.trim().toLowerCase() !== (user?.email || "").toLowerCase();
  const hasChange = emailChanged || Boolean(newPassword);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (newPassword && newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await api.put("/admin/account", {
        email: email.trim(),
        current_password: currentPassword,
        ...(newPassword ? { new_password: newPassword } : {}),
      });
      await logout();
      toast.success("Account updated. Sign in again with your current email and new password.");
      navigate("/signin", { replace: true });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="Account settings" description="Change the email address or password used for this platform administrator." />
      <form onSubmit={submit} className="max-w-2xl rounded-lg border bg-card p-5 sm:p-6">
        <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
          <label className="grid gap-2 text-sm font-medium">
            Email address
            <input className="eb-input w-full" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <div className="border-t pt-5">
            <h2 className="font-semibold">Change password</h2>
            <p className="mt-1 text-sm text-muted-foreground">Leave the new password fields empty to keep the current password.</p>
          </div>
          <label className="grid gap-2 text-sm font-medium">
            New password
            <input className="eb-input w-full" type="password" autoComplete="new-password" minLength={12} maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <span className="text-xs font-normal text-muted-foreground">Use at least 12 characters.</span>
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Confirm new password
            <input className="eb-input w-full" type="password" autoComplete="new-password" minLength={newPassword ? 12 : undefined} maxLength={72} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
          <div className="border-t pt-5">
            <label className="grid gap-2 text-sm font-medium">
              Current password
              <input className="eb-input w-full" type="password" autoComplete="current-password" required maxLength={72} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              <span className="text-xs font-normal text-muted-foreground">Required to confirm any account change.</span>
            </label>
          </div>
          {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
          <button className="eb-button" disabled={!hasChange || !currentPassword || busy}>{busy ? "Saving…" : "Save and sign out"}</button>
        </fieldset>
      </form>
    </div>
  );
}
