import React from "react";
import { CheckCircle2, CircleDollarSign, GitCompareArrows, ShieldCheck } from "lucide-react";

const rows = [
  ["BACS REF 10382", "INV-10382", "Full", "GBP 4,120"],
  ["ACME PAYMENT", "INV-10411", "Partial", "GBP 1,860"],
  ["NOVA GROUP", "INV-10418", "Review", "GBP 740"],
];

export function ReconciliationPreview() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="local-hero-visual">
      <div className="border-b border-slate-200 bg-slate-950 px-5 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-emerald-300">Cash allocator</div>
            <div className="mt-1 font-display text-xl font-semibold">June reconciliation</div>
          </div>
          <div className="rounded-md bg-emerald-400/15 px-3 py-1 text-sm font-semibold text-emerald-200">98% matched</div>
        </div>
      </div>
      <div className="grid gap-px bg-slate-200 md:grid-cols-3">
        <Metric icon={CircleDollarSign} label="Allocated" value="GBP 246k" />
        <Metric icon={GitCompareArrows} label="Runs compared" value="4 periods" />
        <Metric icon={ShieldCheck} label="Audit events" value="1,284" />
      </div>
      <div className="p-5">
        <div className="grid grid-cols-[1.2fr_1fr_.7fr_.8fr] border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          <span>Bank reference</span>
          <span>Invoice</span>
          <span>Status</span>
          <span className="text-right">Amount</span>
        </div>
        <div className="divide-y divide-slate-100">
          {rows.map(([bank, invoice, status, amount]) => (
            <div key={bank} className="grid grid-cols-[1.2fr_1fr_.7fr_.8fr] items-center py-4 text-sm">
              <span className="font-medium text-slate-900">{bank}</span>
              <span className="text-slate-600">{invoice}</span>
              <span>
                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${status === "Full" ? "bg-emerald-50 text-emerald-700" : status === "Partial" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>
                  {status}
                </span>
              </span>
              <span className="text-right font-semibold text-slate-900">{amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuthNetworkVisual() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950" aria-hidden="true">
      <div className="absolute left-10 top-16 h-56 w-56 rounded-full border border-emerald-400/20" />
      <div className="absolute bottom-20 right-12 h-72 w-72 rounded-full border border-blue-400/20" />
      <div className="absolute inset-x-12 top-1/2 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      <div className="absolute left-[18%] top-[32%] h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_30px_rgba(110,231,183,.8)]" />
      <div className="absolute left-[42%] top-[47%] h-3 w-3 rounded-full bg-blue-300 shadow-[0_0_30px_rgba(147,197,253,.8)]" />
      <div className="absolute right-[20%] top-[28%] h-3 w-3 rounded-full bg-emerald-300 shadow-[0_0_30px_rgba(110,231,183,.8)]" />
      <div className="absolute bottom-[22%] left-[30%] h-3 w-3 rounded-full bg-blue-300 shadow-[0_0_30px_rgba(147,197,253,.8)]" />
      <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(15,23,42,.35),rgba(15,23,42,.92))]" />
      <div className="absolute bottom-12 left-12 right-12 rounded-md border border-white/10 bg-white/10 p-5 text-white backdrop-blur">
        <div className="flex items-center gap-3 text-sm font-semibold">
          <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          Secure monthly reconciliation workspace
        </div>
        <div className="mt-3 h-2 rounded-full bg-white/10">
          <div className="h-2 w-4/5 rounded-full bg-emerald-300" />
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="bg-slate-50 p-5">
      <Icon className="h-5 w-5 text-emerald-600" />
      <div className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="mt-1 font-display text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}
