import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtGBP, formatError } from "@/lib/api";
import { toast } from "sonner";
import { PlusCircle, Trash2, FileText, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

export default function Dashboard() {
  const [runs, setRuns] = useState(null);

  const load = async () => {
    try {
      const { data } = await api.get("/allocations");
      setRuns(data);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(); }, []);

  const remove = async (id) => {
    if (!window.confirm("Delete this allocation run? This action is audited.")) return;
    try { await api.delete(`/allocations/${id}`); toast.success("Run deleted"); load(); }
    catch (e) { toast.error(formatError(e)); }
  };

  const totals = (runs || []).reduce((acc, r) => {
    acc.allocated += r.stats?.total_allocated || 0;
    acc.full += r.stats?.fully_matched || 0;
    acc.partial += r.stats?.partially_matched || 0;
    acc.unmatched += r.stats?.unmatched_bank || 0;
    return acc;
  }, { allocated: 0, full: 0, partial: 0, unmatched: 0 });

  return (
    <div data-testid="dashboard-page">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Overview</div>
          <h1 className="font-display font-bold text-3xl tracking-tight mt-2">Allocation runs</h1>
          <p className="text-slate-500 text-sm mt-1">Every cash allocation you&rsquo;ve run, in one place.</p>
        </div>
        <Link to="/new" data-testid="new-allocation-button" className="inline-flex items-center gap-2 bg-[#0F172A] text-white font-semibold px-5 py-2.5 rounded-md hover:bg-slate-800 transition-colors">
          <PlusCircle className="h-4 w-4" /> New allocation
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Stat icon={FileText} colour="text-blue-700 bg-blue-50" label="Total allocated" value={fmtGBP(totals.allocated)} testid="stat-allocated" />
        <Stat icon={CheckCircle2} colour="text-emerald-700 bg-emerald-50" label="Fully matched" value={totals.full} testid="stat-full" />
        <Stat icon={AlertTriangle} colour="text-amber-700 bg-amber-50" label="Partially matched" value={totals.partial} testid="stat-partial" />
        <Stat icon={XCircle} colour="text-rose-700 bg-rose-50" label="Unmatched bank" value={totals.unmatched} testid="stat-unmatched" />
      </div>

      <div className="bg-white border border-slate-200 rounded-md overflow-hidden" data-testid="runs-table">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 uppercase text-xs tracking-wider">
            <tr>
              <Th>Name</Th>
              <Th>Period</Th>
              <Th>Created</Th>
              <Th right>Bank rows</Th>
              <Th right>Allocated</Th>
              <Th right>Outstanding</Th>
              <Th right>Match rate</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {runs === null && (
              <tr><td className="p-6 text-slate-400" colSpan={8}>Loading…</td></tr>
            )}
            {runs && runs.length === 0 && (
              <tr><td className="p-10 text-center text-slate-500" colSpan={8} data-testid="empty-runs">
                No runs yet. Start by creating a new allocation.
              </td></tr>
            )}
            {runs && runs.map((r) => {
              const total = r.stats?.total_bank || 0;
              const matched = (r.stats?.fully_matched || 0) + (r.stats?.partially_matched || 0);
              const rate = total ? Math.round((matched / total) * 100) : 0;
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60" data-testid={`run-row-${r.id}`}>
                  <td className="px-4 py-3">
                    <Link to={`/allocations/${r.id}`} className="font-semibold text-slate-900 hover:text-emerald-700" data-testid={`run-link-${r.id}`}>{r.name}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.period}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.stats?.total_bank || 0}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-semibold">{fmtGBP(r.stats?.total_allocated)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmtGBP(r.stats?.total_outstanding)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={rate >= 80 ? "text-emerald-700" : rate >= 50 ? "text-amber-700" : "text-rose-700"}>
                      {rate}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(r.id)} className="text-slate-400 hover:text-rose-600 transition-colors" data-testid={`delete-run-${r.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, colour, testid }) {
  return (
    <div className="bg-white border border-slate-200 rounded-md p-5" data-testid={testid}>
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-md flex items-center justify-center ${colour}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      </div>
      <div className="mt-4 font-display font-bold text-2xl tabular-nums">{value}</div>
    </div>
  );
}

function Th({ children, right }) {
  return <th className={`px-4 py-3 ${right ? "text-right" : "text-left"} font-semibold`}>{children}</th>;
}
