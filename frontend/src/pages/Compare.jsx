import React, { useEffect, useState } from "react";
import { api, fmtGBP, formatError } from "@/lib/api";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

const STATUS_BADGE = {
  full: "bg-emerald-100 text-emerald-800 border-emerald-200",
  partial: "bg-amber-100 text-amber-800 border-amber-200",
  unmatched: "bg-rose-100 text-rose-800 border-rose-200",
  absent: "bg-slate-100 text-slate-500 border-slate-200",
};

export default function Compare() {
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState([]);
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/allocations").then(({ data }) => setRuns(data)).catch((e) => toast.error(formatError(e)));
  }, []);

  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const run = async () => {
    if (selected.length < 2) return toast.error("Select at least two runs to compare");
    try {
      const { data } = await api.get("/compare", { params: { run_ids: selected.join(",") } });
      setData(data);
    } catch (e) { toast.error(formatError(e)); }
  };

  return (
    <div data-testid="compare-page">
      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Multi-period</div>
        <h1 className="font-display font-bold text-3xl tracking-tight mt-2">Compare allocation runs</h1>
        <p className="text-slate-500 text-sm mt-1">Stack two or more runs side-by-side and spot persistently unmatched debtors.</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-5 mb-6">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Select runs</div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
          {runs.map((r) => (
            <label key={r.id} className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer text-sm ${
              selected.includes(r.id) ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"
            }`} data-testid={`compare-pick-${r.id}`}>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="accent-emerald-600" />
              <div className="flex-1">
                <div className="font-semibold">{r.name}</div>
                <div className="text-xs text-slate-500">{r.period}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-end">
          <button onClick={run} disabled={selected.length < 2} data-testid="compare-run"
            className="gradient-cta text-white font-semibold px-5 py-2.5 rounded-md disabled:opacity-50">
            Compare ({selected.length})
          </button>
        </div>
      </div>

      {data && (
        <>
          {data.consistently_unmatched.length > 0 && (
            <div className="border border-rose-200 bg-rose-50 rounded-md p-4 mb-6 flex items-start gap-3" data-testid="consistently-unmatched">
              <AlertTriangle className="h-5 w-5 text-rose-700 mt-0.5" />
              <div>
                <div className="font-semibold text-rose-900">Consistently unmatched debtors</div>
                <div className="text-sm text-rose-900 mt-1">
                  Unmatched across every selected run: <strong>{data.consistently_unmatched.join(", ")}</strong>
                </div>
              </div>
            </div>
          )}

          <div className="mb-3 text-xs text-slate-500 flex items-center gap-3" data-testid="compare-legend">
            <span>Legend:</span>
            <Badge tone="full">Full</Badge>
            <Badge tone="partial">Partial</Badge>
            <Badge tone="unmatched">Unmatched</Badge>
            <Badge tone="absent">Absent</Badge>
            <span className="ml-auto">{data.rows.length} debtors</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-md overflow-x-auto scroll-area-thin" data-testid="compare-matrix">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">Debtor</th>
                  {data.runs.map((r) => (
                    <th key={r.id} className="px-3 py-2.5 text-left font-semibold">
                      <div>{r.name}</div>
                      <div className="text-[10px] text-slate-400 font-normal normal-case">{r.period}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.debtor} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold">{row.debtor}</td>
                    {data.runs.map((r) => {
                      const cell = row.runs[r.id] || { status: "absent", outstanding: 0 };
                      return (
                        <td key={r.id} className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Badge tone={cell.status}>{cell.status}</Badge>
                            {cell.status !== "absent" && (
                              <span className="text-xs tabular-nums text-slate-500">{fmtGBP(cell.outstanding)}</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ tone, children }) {
  return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase tracking-wider ${STATUS_BADGE[tone] || ""}`}>{children}</span>;
}
