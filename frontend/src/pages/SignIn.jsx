import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Building2 } from "lucide-react";

export default function SignIn() {
  const { login, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(email, password);
    setLoading(false);
    if (ok) navigate("/dashboard");
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:block relative bg-[#0F172A]">
        <img
          src="https://static.prod-images.emergentagent.com/jobs/5ce91e6c-a15e-42d6-b434-deebaf15803a/images/dcb96a7ecf8857bb9156c5170e10b7df88c218da78a90f43205aec2f787f694a.png"
          alt="Finance network"
          className="absolute inset-0 h-full w-full object-cover opacity-50"
        />
        <div className="relative h-full flex flex-col justify-between p-12 text-white">
          <Link to="/" className="flex items-center gap-3" data-testid="auth-home-link">
            <div className="h-10 w-10 rounded-md bg-gradient-to-br from-emerald-500 to-blue-600" />
            <div>
              <div className="font-display font-bold">EB Business Solutions</div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Receivables Reconciliation</div>
            </div>
          </Link>
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight max-w-md">
              Welcome back. Let&rsquo;s close out this month&rsquo;s receipts.
            </h2>
            <p className="text-slate-300 mt-3 max-w-md text-sm">
              Sign in to upload your latest bank CSV and invoice listing.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-md">
          <Link to="/" className="lg:hidden flex items-center gap-2 mb-8" data-testid="auth-home-link-mobile">
            <Building2 className="h-6 w-6 text-emerald-600" />
            <span className="font-display font-bold">EB Receivables</span>
          </Link>
          <h1 className="font-display font-bold text-3xl">Sign in</h1>
          <p className="text-slate-500 mt-2 text-sm">
            New here?{" "}
            <Link to="/signup" className="text-emerald-700 font-semibold hover:underline" data-testid="link-signup">
              Create an account
            </Link>
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5" data-testid="signin-form">
            <Field label="Email">
              <input
                data-testid="signin-email"
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <input
                data-testid="signin-password"
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                autoComplete="current-password"
              />
            </Field>
            {error && <div className="text-sm text-red-600" data-testid="signin-error">{error}</div>}
            <button
              type="submit" disabled={loading}
              data-testid="signin-submit"
              className="w-full gradient-cta text-white font-semibold py-3 rounded-md hover:opacity-95 transition disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
