import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight, FileCheck2, GitCompareArrows, ScrollText, ShieldCheck, Workflow, Users } from "lucide-react";

const features = [
  { icon: Workflow, title: "Auto-allocate cash", desc: "Match bank receipts to invoices using reference patterns and fuzzy debtor names." },
  { icon: FileCheck2, title: "CSV validation", desc: "Catch column mismatches and bad rows before they break your reconciliation." },
  { icon: GitCompareArrows, title: "Month-on-month compare", desc: "See which debtors are persistently unmatched across periods." },
  { icon: Users, title: "Debtor reports", desc: "Threshold flags, expandable per-run history, and one-click CSV exports." },
  { icon: ScrollText, title: "Full audit trail", desc: "Every upload, override and deletion is logged with timestamps." },
  { icon: ShieldCheck, title: "Multi-tenant secure", desc: "JWT-based auth, every record scoped to your business only." },
];

export default function Landing() {
  return (
    <div className="min-h-screen gradient-hero">
      <header className="max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-gradient-to-br from-emerald-500 to-blue-600" />
          <div>
            <div className="font-display font-bold text-lg">EB Business Solutions</div>
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Receivables Reconciliation Platform</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/signin" data-testid="header-signin" className="text-sm font-medium text-slate-700 hover:text-slate-900 px-4 py-2">
            Sign in
          </Link>
          <Link to="/signup" data-testid="header-get-started" className="text-sm font-semibold bg-[#0F172A] text-white px-5 py-2.5 rounded-md hover:bg-slate-800 transition-colors">
            Get started
          </Link>
        </div>
      </header>

      <section className="max-w-7xl mx-auto px-6 pt-12 pb-20 grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full">
            BUILT FOR FINANCE TEAMS
          </div>
          <h1 className="font-display font-bold text-5xl lg:text-6xl mt-5 tracking-tight leading-[1.05]">
            Reconcile every <span className="text-emerald-600">£ received</span>,<br />
            month after month.
          </h1>
          <p className="mt-6 text-lg text-slate-600 max-w-xl">
            Upload your bank statement and invoice listing. We&rsquo;ll partially allocate cash receipts against open
            receivables using reference numbers and fuzzy debtor name matching — then let you override anything manually.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link to="/signup" data-testid="hero-cta" className="inline-flex items-center gap-2 gradient-cta text-white font-semibold px-6 py-3.5 rounded-md hover:opacity-95 transition">
              Start allocating <ArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/signin" data-testid="hero-signin" className="text-sm font-semibold text-slate-700 hover:text-slate-900 px-2 py-2">
              I already have an account
            </Link>
          </div>
          <div className="mt-10 grid grid-cols-3 gap-4 max-w-md">
            <Stat n="98%" label="Allocations automated" />
            <Stat n="<30s" label="Average run time" />
            <Stat n="100%" label="Audit traceable" />
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-6 bg-gradient-to-br from-emerald-500/10 to-blue-500/10 rounded-2xl blur-2xl" />
          <img
            src="https://static.prod-images.emergentagent.com/jobs/5ce91e6c-a15e-42d6-b434-deebaf15803a/images/449e94747ff5c81ab21e97d5b7267b79d05f388d880f9a3498beb04db0f839d8.png"
            alt="Cash allocation visual"
            className="relative rounded-xl border border-slate-200 shadow-sm"
          />
        </div>
      </section>

      <section className="bg-white border-t border-slate-200 py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Why finance teams pick us</div>
            <h2 className="font-display font-bold text-3xl lg:text-4xl mt-3 tracking-tight">
              Everything you need to close the month without the spreadsheet headache.
            </h2>
          </div>
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-slate-200">
            {features.map((f) => (
              <div key={f.title} className="bg-white p-8 hover:bg-slate-50 transition-colors" data-testid={`feature-${f.title.replace(/\s+/g, "-").toLowerCase()}`}>
                <f.icon className="h-6 w-6 text-emerald-600" />
                <h3 className="font-display font-semibold text-lg mt-4">{f.title}</h3>
                <p className="text-sm text-slate-600 mt-2 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500">
        &copy; {new Date().getFullYear()} EB Business Solutions Limited. All rights reserved.
      </footer>
    </div>
  );
}

function Stat({ n, label }) {
  return (
    <div>
      <div className="font-display font-bold text-2xl text-slate-900">{n}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
