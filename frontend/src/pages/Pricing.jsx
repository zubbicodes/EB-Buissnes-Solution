import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, fmtGBP, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { Check, ArrowRight, Sparkles } from "lucide-react";

export default function Pricing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get("/billing/plan").then(({ data }) => setPlan(data)).catch((e) => toast.error(formatError(e)));
  }, [user]);

  const upgrade = async () => {
    if (!user) { navigate("/signin"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/billing/checkout", {
        package_id: "pro_monthly",
        origin_url: window.location.origin,
      });
      window.location.href = data.url;
    } catch (e) { toast.error(formatError(e)); setBusy(false); }
  };

  const tier = plan?.tier || "starter";
  const proPrice = plan?.pricing?.pro_monthly?.amount ?? 49;

  return (
    <div className="min-h-screen gradient-hero" data-testid="pricing-page">
      <header className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-3" data-testid="pricing-home">
          <div className="h-9 w-9 rounded-md bg-gradient-to-br from-emerald-500 to-blue-600" />
          <div>
            <div className="font-display font-bold">EB Business Solutions</div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Receivables Reconciliation</div>
          </div>
        </Link>
        {!user && (
          <Link to="/signin" className="text-sm font-semibold text-slate-700 hover:text-slate-900">Sign in</Link>
        )}
      </header>

      <section className="max-w-5xl mx-auto px-6 pt-8 pb-20 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
          PLANS &amp; PRICING
        </div>
        <h1 className="font-display font-bold text-5xl mt-5 tracking-tight">
          Simple pricing for finance teams.
        </h1>
        <p className="mt-4 text-slate-600 text-lg max-w-2xl mx-auto">
          Start free with up to 5,000 reconciled rows per month. Upgrade when your monthly volume grows.
        </p>

        <div className="mt-12 grid md:grid-cols-2 gap-6 max-w-3xl mx-auto text-left">
          {/* Starter */}
          <div className={`bg-white rounded-md border-2 ${tier === "starter" ? "border-slate-300" : "border-slate-200"} p-8 relative`} data-testid="card-starter">
            <div className="font-display font-semibold text-lg">Starter</div>
            <div className="mt-3 flex items-baseline gap-2">
              <div className="font-display font-bold text-5xl">£0</div>
              <div className="text-slate-500 text-sm">/ month</div>
            </div>
            <p className="text-sm text-slate-500 mt-3">For occasional cash allocation needs.</p>
            <ul className="mt-6 space-y-2.5 text-sm text-slate-700">
              <Feat>Up to <strong>5,000 rows / month</strong> (bank + invoices combined)</Feat>
              <Feat>All matching rules (reference, debtor name, token)</Feat>
              <Feat>CSV + Excel exports</Feat>
              <Feat>Manual override + audit trail</Feat>
              <Feat>Multi-period compare + debtor report</Feat>
            </ul>
            {tier === "starter" && (
              <div className="mt-6 text-xs font-semibold text-slate-500 uppercase tracking-wider">Your current plan</div>
            )}
          </div>

          {/* Pro */}
          <div className="bg-[#0F172A] text-white rounded-md p-8 relative shadow-xl" data-testid="card-pro">
            <div className="absolute -top-3 left-6 bg-gradient-to-r from-emerald-500 to-blue-500 text-white text-[10px] font-semibold uppercase tracking-wider px-3 py-1 rounded-full">
              Recommended
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-400" />
              <div className="font-display font-semibold text-lg">Pro</div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <div className="font-display font-bold text-5xl">£{proPrice}</div>
              <div className="text-slate-400 text-sm">/ month</div>
            </div>
            <p className="text-sm text-slate-300 mt-3">For high-volume reconciliation teams.</p>
            <ul className="mt-6 space-y-2.5 text-sm text-slate-100">
              <Feat dark><strong>Unlimited</strong> rows per month</Feat>
              <Feat dark>Priority processing queue (faster turnaround)</Feat>
              <Feat dark><strong>Saved column-mapping profiles</strong></Feat>
              <Feat dark>All bank-format presets (Barclays, HSBC, Xero, Sage, QuickBooks…)</Feat>
              <Feat dark>Email support</Feat>
            </ul>
            <button
              onClick={upgrade}
              disabled={busy || tier === "pro"}
              data-testid="upgrade-btn"
              className="mt-8 w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-emerald-500 to-blue-600 hover:opacity-95 text-white font-semibold py-3 rounded-md disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {tier === "pro" ? "You're on Pro" : busy ? "Redirecting to Stripe…" : <>Upgrade to Pro <ArrowRight className="h-4 w-4" /></>}
            </button>
            {tier === "pro" && plan?.pro_until && (
              <div className="mt-3 text-xs text-slate-400 text-center">Active until {new Date(plan.pro_until).toLocaleDateString("en-GB")}</div>
            )}
          </div>
        </div>

        <div className="mt-12 text-xs text-slate-400">
          Test mode — use card <span className="font-mono">4242 4242 4242 4242</span>, any future expiry &amp; CVC.
        </div>
      </section>
    </div>
  );
}

function Feat({ children, dark }) {
  return (
    <li className="flex items-start gap-2">
      <Check className={`h-4 w-4 mt-0.5 shrink-0 ${dark ? "text-emerald-400" : "text-emerald-600"}`} />
      <span>{children}</span>
    </li>
  );
}
