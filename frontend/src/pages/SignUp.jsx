import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Building2 } from "lucide-react";

export default function SignUp() {
  const { register, error } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await register(name, email, password);
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
          <Link to="/" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-gradient-to-br from-emerald-500 to-blue-600" />
            <div>
              <div className="font-display font-bold">EB Business Solutions</div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Cash Allocator</div>
            </div>
          </Link>
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight max-w-md">
              Start allocating cash receipts in minutes.
            </h2>
            <p className="text-slate-300 mt-3 max-w-md text-sm">
              Multi-tenant secure. Every record stays scoped to your account.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center px-6 py-12 bg-white">
        <div className="w-full max-w-md">
          <Link to="/" className="lg:hidden flex items-center gap-2 mb-8">
            <Building2 className="h-6 w-6 text-emerald-600" />
            <span className="font-display font-bold">EB Cash Allocator</span>
          </Link>
          <h1 className="font-display font-bold text-3xl">Create your account</h1>
          <p className="text-slate-500 mt-2 text-sm">
            Already have an account?{" "}
            <Link to="/signin" className="text-emerald-700 font-semibold hover:underline" data-testid="link-signin">
              Sign in
            </Link>
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5" data-testid="signup-form">
            <Field label="Full Name">
              <input data-testid="signup-name" required value={name} onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
            <Field label="Email">
              <input data-testid="signup-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
            </Field>
            <Field label="Password">
              <input data-testid="signup-password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500" />
              <div className="text-xs text-slate-400 mt-1">Minimum 6 characters.</div>
            </Field>
            {error && <div className="text-sm text-red-600" data-testid="signup-error">{error}</div>}
            <button
              type="submit" disabled={loading} data-testid="signup-submit"
              className="w-full gradient-cta text-white font-semibold py-3 rounded-md hover:opacity-95 transition disabled:opacity-60"
            >
              {loading ? "Creating account…" : "Create account"}
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
