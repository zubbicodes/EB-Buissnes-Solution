import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { BrandMark } from "@/components/DesignSystem";
import { Eye, EyeOff } from "lucide-react";

export default function SignUp() {
  const { register, error } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="eb-auth-screen">
      <AuthArt
        title={"Start allocating cash receipts\nin minutes."}
        copy="Multi-tenant secure. Every record stays scoped to your account."
      />

      <div className="eb-auth-form-wrap">
        <div className="eb-auth-form">
          <Link to="/" className="mb-10 flex lg:hidden">
            <BrandMark compact />
          </Link>
          <h1 className="eb-auth-title">Create your account</h1>
          <p className="eb-auth-subtitle">
            Already have an account?{" "}
            <Link to="/signin" className="font-medium text-[#45AE8D] hover:underline" data-testid="link-signin">
              Sign in
            </Link>
          </p>

          <form onSubmit={submit} className="mt-[56px] space-y-[29px]" data-testid="signup-form">
            <Field label="Full Name">
              <input
                data-testid="signup-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="eb-input w-full"
                autoComplete="name"
              />
            </Field>
            <Field label="Email">
              <input
                data-testid="signup-email"
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
                  data-testid="signup-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="eb-input w-full pr-[44px]"
                  autoComplete="new-password"
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
              <div className="mt-[14px] text-[14px] leading-none text-[#0F172A]/60">Minimum 6 characters.</div>
            </Field>
            {error && <div className="text-[14px] font-medium text-[#EA2E49]" data-testid="signup-error">{error}</div>}
            <button type="submit" disabled={loading} data-testid="signup-submit" className="eb-button w-full">
              {loading ? "Creating account..." : "Sign Up"}
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
        <Link to="/">
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
