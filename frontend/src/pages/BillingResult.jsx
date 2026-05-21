import React, { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";

export default function BillingResult({ kind }) {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const sessionId = params.get("session_id");
  const [tx, setTx] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const navigate = useNavigate();

  // Poll status while pending
  useEffect(() => {
    if (kind !== "success" || !sessionId) return;
    let cancelled = false;
    const poll = async (n) => {
      if (n > 10) return;
      try {
        const { data } = await api.get(`/billing/status/${sessionId}`);
        if (cancelled) return;
        setTx(data);
        if (data.payment_status === "paid") {
          await refresh();  // pick up new tier
          return;
        }
        if (data.status === "expired") return;
        setTimeout(() => poll(n + 1), 2000);
        setAttempts(n + 1);
      } catch (e) { toast.error(formatError(e)); }
    };
    poll(0);
    return () => { cancelled = true; };
  }, [kind, sessionId, refresh]);

  if (kind === "cancel") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" data-testid="billing-cancel-page">
        <div className="bg-white border border-slate-200 rounded-md p-10 max-w-md text-center">
          <XCircle className="h-12 w-12 text-rose-500 mx-auto" />
          <h1 className="font-display font-bold text-2xl mt-4">Checkout cancelled</h1>
          <p className="text-sm text-slate-500 mt-2">No charges were made. You can resume anytime.</p>
          <div className="mt-6 flex items-center justify-center gap-2">
            <Link to="/pricing" className="bg-[#0F172A] text-white font-semibold px-5 py-2.5 rounded-md hover:bg-slate-800">Back to Pricing</Link>
            <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-slate-600 hover:text-slate-900 px-3 py-2.5">Dashboard</button>
          </div>
        </div>
      </div>
    );
  }

  const paid = tx?.payment_status === "paid";
  const expired = tx?.status === "expired";

  return (
    <div className="min-h-screen flex items-center justify-center p-6" data-testid="billing-success-page">
      <div className="bg-white border border-slate-200 rounded-md p-10 max-w-md text-center">
        {paid ? (
          <>
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <h1 className="font-display font-bold text-2xl mt-4">Welcome to Pro!</h1>
            <p className="text-sm text-slate-500 mt-2">Your subscription is active. Unlimited rows, priority queue, and saved mapping profiles unlocked.</p>
            <button onClick={() => navigate("/dashboard")} data-testid="goto-dashboard"
              className="mt-6 gradient-cta text-white font-semibold px-6 py-3 rounded-md">
              Go to Dashboard
            </button>
          </>
        ) : expired ? (
          <>
            <XCircle className="h-12 w-12 text-amber-500 mx-auto" />
            <h1 className="font-display font-bold text-2xl mt-4">Session expired</h1>
            <p className="text-sm text-slate-500 mt-2">Please start a new checkout from the Pricing page.</p>
            <Link to="/pricing" className="mt-6 inline-block bg-[#0F172A] text-white font-semibold px-5 py-2.5 rounded-md">Back to Pricing</Link>
          </>
        ) : (
          <>
            <div className="h-12 w-12 mx-auto rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
            <h1 className="font-display font-bold text-2xl mt-4">Confirming payment…</h1>
            <p className="text-sm text-slate-500 mt-2">This usually takes a couple of seconds.</p>
            <p className="text-xs text-slate-400 mt-3">Check {attempts + 1} of 10</p>
          </>
        )}
      </div>
    </div>
  );
}
