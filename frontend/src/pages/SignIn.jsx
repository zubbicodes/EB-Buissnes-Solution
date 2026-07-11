import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BrandMark } from "@/components/DesignSystem";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import { Eye, EyeOff } from "lucide-react";

export default function SignIn() {
  const { login, googleLogin, error } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const ok = await login(email, password);
    setLoading(false);
    if (ok) navigate("/dashboard");
  };

  const handleGoogleCredential = async (credential) => {
    setGoogleLoading(true);
    const ok = await googleLogin(credential);
    setGoogleLoading(false);
    if (ok) navigate("/dashboard");
  };

  return (
    <div className="eb-auth-screen">
      <AuthArt
        title={"Welcome back. Let's close out\nthis month's receipts."}
        copy="Sign in to upload your latest bank CSV and invoice listing."
      />

      <div className="eb-auth-form-wrap">
        <div className="eb-auth-form">
          <Link to="/" className="mb-10 flex lg:hidden" data-testid="auth-home-link-mobile">
            <BrandMark compact />
          </Link>
          <h1 className="eb-auth-title">Sign in</h1>
          <p className="eb-auth-subtitle">
            New here?{" "}
            <Link to="/signup" className="font-medium text-[#45AE8D] hover:underline" data-testid="link-signup">
              Create an account
            </Link>
          </p>

          <div className="mt-[44px]">
            <GoogleSignInButton onCredential={handleGoogleCredential} disabled={loading || googleLoading} />
            <div className="mt-[29px] flex items-center gap-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#0F172A]/35">
              <span className="h-px flex-1 bg-[#0F172A]/10" />
              <span>or</span>
              <span className="h-px flex-1 bg-[#0F172A]/10" />
            </div>
          </div>

          <form onSubmit={submit} className="mt-[56px] space-y-[29px]" data-testid="signin-form">
            <Field label="Email">
              <input
                data-testid="signin-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="eb-input w-full"
                autoComplete="email"
              />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input
                  data-testid="signin-password"
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="eb-input w-full pr-[44px]"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-[#0F172A]/40 hover:text-[#0F172A]/70 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </Field>
            {error && <div className="text-[14px] font-medium text-[#EA2E49]" data-testid="signin-error">{error}</div>}
            <button type="submit" disabled={loading} data-testid="signin-submit" className="eb-button w-full">
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function AuthArt({ title, copy }) {
  return (
    <div className="eb-auth-art">
      <div className="eb-auth-art-inner">
        <Link to="/" data-testid="auth-home-link">
          <BrandMark />
        </Link>
        <div>
          <h2 className="eb-auth-art-title">{title}</h2>
          <p className="eb-auth-art-copy">{copy}</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="eb-label">{label}</span>
      <div className="mt-[18px]">{children}</div>
    </label>
  );
}
