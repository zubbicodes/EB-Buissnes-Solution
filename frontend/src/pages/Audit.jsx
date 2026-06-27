import React, { useEffect, useState } from "react";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Mail, PlusCircle, Trash2, ExternalLink } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/DesignSystem";

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
      <PageHeader
        eyebrow="Trail"
        title="Audit Log"
        description="Every upload, manual override and deletion, with timestamps."
      />

      {data && (
        <>
          <div className="eb-stat-grid mb-10">
            <StatCard icon={Mail} label="Total events" value={data.summary.total} testid="stat-total" />
            <StatCard icon={PlusCircle} label="Runs created" value={data.summary.create_run} testid="stat-created" />
            <StatCard icon={Trash2} tone="rose" label="Runs deleted" value={data.summary.delete_run} testid="stat-deleted" />
            <StatCard icon={ExternalLink} tone="blue" label="Manual links" value={data.summary.manual_link} testid="stat-manual" />
          </div>

          <div className="eb-panel mb-5 flex flex-wrap items-end gap-4">
            <div>
              <div className="eb-label mb-4">Filter by Run ID</div>
              <input
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                placeholder="run uuid..."
                className="eb-input w-[300px] font-mono"
                data-testid="audit-filter-input"
              />
            </div>
            <button onClick={() => load(runId)} className="eb-button w-[140px]" data-testid="audit-filter-apply">Apply</button>
            <button onClick={() => { setRunId(""); load(""); }} className="h-[54px] px-2 text-[18px] font-medium text-[#0F172A]/60 hover:text-[#0F172A]" data-testid="audit-filter-clear">Clear</button>
          </div>

          <div className="eb-table-wrap" data-testid="audit-table">
            <table className="eb-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Run ID</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.length === 0 && (
                  <tr><td className="!p-0" colSpan={4}><EmptyState testid="audit-empty">No audit events match this filter.</EmptyState></td></tr>
                )}
                {data.logs.map((l) => (
                  <tr key={l.id}>
                    <td className="text-[#0F172A]/60">{new Date(l.created_at).toLocaleString("en-GB")}</td>
                    <td className="font-mono text-[13px]">{l.action}</td>
                    <td className="font-mono text-[13px] text-[#0F172A]/60">{l.run_id?.slice(0, 8) || "-"}</td>
                    <td className="max-w-[780px] break-all font-mono text-[12px] text-[#0F172A]/60">{JSON.stringify(l.details)}</td>
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
