import React, { useEffect, useState } from "react";
import { api, API_BASE, fmtGBP, formatError } from "@/lib/api";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, Flag } from "lucide-react";

export default function Debtors() {
  const [threshold, setThreshold] = useState("1000");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});

  const load = async () => {
    try {
      const { data } = await api.get("/debtors", { params: { threshold: Number(threshold) || 0 } });
      setData(data);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  return (
    <div data-testid="debtors-page">
      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Debtors</div>
        <h1 className="font-display font-bold text-3xl tracking-tight mt-2">Debtor report</h1>
        <p className="text-slate-500 text-sm mt-1">Aggregated outstanding across every allocation run, with threshold flagging.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Flag threshold (£)</div>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} type="number" min="0" step="100"
            className="border border-slate-200 rounded-md px-3 py-2 text-sm w-40"
            data-testid="threshold-input" />
        </div>
        <button onClick={load} data-testid="apply-threshold"
          className="bg-[#0F172A] text-white font-semibold px-4 py-2 rounded-md text-sm hover:bg-slate-800">
          Apply
        </button>
        <a href={`${API_BASE}/debtors/export?threshold=${Number(threshold) || 0}`} download data-testid="export-debtors"
          className="ml-auto inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900">
          <Download className="h-4 w-4" /> Export CSV
        </a>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Stat label="Total debtors" value={data.total_debtors} testid="stat-debtors" />
            <Stat label="Flagged" value={data.flagged_count} tone="rose" testid="stat-flagged" />
            <Stat label="Total outstanding" value={fmtGBP(data.total_outstanding)} tone="amber" testid="stat-outstanding" />
            <Stat label="Total allocated" value={fmtGBP(data.total_allocated)} tone="emerald" testid="stat-allocated" />
          </div>

          {data.rows.filter((r) => r.flagged).length > 0 && (
            <div className="border border-rose-200 bg-rose-50 rounded-md p-4 mb-6 text-sm text-rose-900" data-testid="flagged-alert">
              <div className="font-semibold mb-1">Flagged over {fmtGBP(threshold)}:</div>
              {data.rows.filter((r) => r.flagged).map((r) => r.debtor).join(", ")}
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-md overflow-hidden" data-testid="debtors-table">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 w-8" />
                  <th className="px-3 py-2.5 text-left font-semibold">Debtor</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Outstanding</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Allocated</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Invoices</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Runs</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <React.Fragment key={r.debtor}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2">
                        <button onClick={() => setOpen((o) => ({ ...o, [r.debtor]: !o[r.debtor] }))} data-testid={`debtor-toggle-${r.debtor}`}>
                          {open[r.debtor] ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        <div className="flex items-center gap-2">
                          {r.debtor}
                          {r.flagged && <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200 px-2 py-0.5 rounded-full"><Flag className="h-3 w-3" /> Flagged</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-700 font-semibold">{fmtGBP(r.total_outstanding)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtGBP(r.total_allocated)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.invoice_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.runs.length}</td>
                    </tr>
                    {open[r.debtor] && (
                      <tr className="bg-slate-50/40">
                        <td />
                        <td colSpan={5} className="px-3 py-3">
                          <table className="w-full text-xs">
                            <thead className="text-slate-500 uppercase tracking-wider">
                              <tr><th className="text-left py-1">Run</th><th className="text-left py-1">Period</th><th className="text-left py-1">Invoice</th><th className="text-left py-1">Status</th><th className="text-right py-1">Allocated</th><th className="text-right py-1">Outstanding</th></tr>
                            </thead>
                            <tbody>
                              {r.runs.map((rr, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                  <td className="py-1">{rr.run_name}</td>
                                  <td className="py-1">{rr.period}</td>
                                  <td className="py-1 font-mono">{rr.invoice_number}</td>
                                  <td className="py-1"><span className={`text-[10px] px-2 py-0.5 rounded-full border ${rr.status === "full" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : rr.status === "partial" ? "bg-amber-100 text-amber-800 border-amber-200" : "bg-rose-100 text-rose-800 border-rose-200"}`}>{rr.status}</span></td>
                                  <td className="py-1 text-right tabular-nums text-emerald-700">{fmtGBP(rr.allocated)}</td>
                                  <td className="py-1 text-right tabular-nums">{fmtGBP(rr.outstanding)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
                {data.rows.length === 0 && (
                  <tr><td className="p-10 text-center text-slate-500" colSpan={6} data-testid="debtors-empty">No debtors yet. Run an allocation first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone, testid }) {
  const map = {
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
  };
  return (
    <div className={`rounded-md border p-4 ${tone ? map[tone] : "border-slate-200 bg-white"}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className="font-display font-bold text-xl mt-1 tabular-nums">{value}</div>
    </div>
  );
}
