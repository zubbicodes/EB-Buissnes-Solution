import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";

export default function Audit() {
  const [data, setData] = useState(null);
  const [runId, setRunId] = useState("");

  const load = async (rid) => {
    try {
      const params = rid ? { run_id: rid } : {};
      const { data } = await api.get("/audit", { params });
      setData(data);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(""); }, []);

  return (
    <div data-testid="audit-page">
      <div className="mb-8">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Trail</div>
        <h1 className="font-display font-bold text-3xl tracking-tight mt-2">Audit log</h1>
        <p className="text-slate-500 text-sm mt-1">Every upload, manual override and deletion, with timestamps.</p>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Stat label="Total events" value={data.summary.total} testid="stat-total" />
            <Stat label="Runs created" value={data.summary.create_run} tone="emerald" testid="stat-created" />
            <Stat label="Runs deleted" value={data.summary.delete_run} tone="rose" testid="stat-deleted" />
            <Stat label="Manual links" value={data.summary.manual_link} tone="blue" testid="stat-manual" />
          </div>

          <div className="bg-white border border-slate-200 rounded-md p-4 mb-4 flex items-end gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Filter by Run ID</div>
              <input value={runId} onChange={(e) => setRunId(e.target.value)} placeholder="run uuid…"
                className="border border-slate-200 rounded-md px-3 py-2 text-sm w-72 font-mono"
                data-testid="audit-filter-input" />
            </div>
            <button onClick={() => load(runId)} className="bg-[#0F172A] text-white font-semibold px-4 py-2 rounded-md text-sm hover:bg-slate-800" data-testid="audit-filter-apply">Apply</button>
            <button onClick={() => { setRunId(""); load(""); }} className="text-xs font-semibold text-slate-500 hover:text-slate-800" data-testid="audit-filter-clear">Clear</button>
          </div>

          <div className="bg-white border border-slate-200 rounded-md overflow-hidden" data-testid="audit-table">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">Timestamp</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Action</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Run ID</th>
                  <th className="px-3 py-2.5 text-left font-semibold">Details</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.length === 0 && (
                  <tr><td className="p-10 text-center text-slate-500" colSpan={4} data-testid="audit-empty">No audit events match this filter.</td></tr>
                )}
                {data.logs.map((l) => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-500">{new Date(l.created_at).toLocaleString("en-GB")}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{l.run_id?.slice(0, 8) || "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 font-mono break-all">{JSON.stringify(l.details)}</td>
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

function Stat({ label, value, tone, testid }) {
  const map = {
    emerald: "border-emerald-200 bg-emerald-50",
    rose: "border-rose-200 bg-rose-50",
    blue: "border-blue-200 bg-blue-50",
  };
  return (
    <div className={`rounded-md border p-4 ${tone ? map[tone] : "border-slate-200 bg-white"}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className="font-display font-bold text-xl mt-1 tabular-nums">{value}</div>
    </div>
  );
}
