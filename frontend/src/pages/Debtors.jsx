import React, { useEffect, useState } from "react";
import { api, fmtGBP, formatError, downloadAuthed } from "@/lib/api";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Download, Flag, PoundSterling, Users, Wallet } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/DesignSystem";

export default function Debtors() {
  const [threshold, setThreshold] = useState("1000");
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/debtors", { params: { threshold: Number(threshold) || 0 } });
      setData(data);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await downloadAuthed(`/debtors/export?threshold=${Number(threshold) || 0}`, "debtor-report.csv");
      toast.success("CSV ready");
    } catch (e) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const flagged = data?.rows?.filter((r) => r.flagged) || [];

  return (
    <div data-testid="debtors-page">
      <PageHeader
        eyebrow="Debtors"
        title="Debtor Report"
        description="Aggregated outstanding across every allocation run, with threshold flagging."
      />

      <div className="eb-panel mb-5 flex flex-wrap items-end gap-4">
        <div>
          <div className="eb-label mb-4">Flag threshold (£)</div>
          <input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            type="number"
            min="0"
            step="100"
            className="eb-input w-[246px]"
            data-testid="threshold-input"
          />
        </div>
        <button onClick={load} data-testid="apply-threshold" className="eb-button w-[140px]">
          Apply
        </button>
        <button onClick={onExport} disabled={exporting} data-testid="export-debtors" className="eb-button ml-auto w-[174px]">
          <Download className="h-4 w-4" /> {exporting ? "Preparing..." : "Export CSV"}
        </button>
      </div>

      {data && (
        <>
          <div className="eb-stat-grid mb-5">
            <StatCard icon={Users} label="total debtors" value={data.total_debtors} helper="All debtors in report" testid="stat-debtors" />
            <StatCard icon={Flag} tone="rose" label="Flagged" value={data.flagged_count} helper="Above threshold" testid="stat-flagged" />
            <StatCard icon={PoundSterling} tone="amber" label="total outstanding" value={fmtGBP(data.total_outstanding)} helper="Across all debtors" testid="stat-outstanding" />
            <StatCard icon={Wallet} label="total allocated" value={fmtGBP(data.total_allocated)} helper="Across all debtors" testid="stat-allocated" />
          </div>

          {flagged.length > 0 && (
            <div className="mb-5 rounded-[8px] border border-[#FB1A41]/20 bg-[#FB1A41]/10 p-5 text-[14px] text-[#0F172A]" data-testid="flagged-alert">
              <div className="mb-1 font-semibold">Flagged over {fmtGBP(threshold)}:</div>
              {flagged.map((r) => r.debtor).join(", ")}
            </div>
          )}

          <div className="eb-table-wrap" data-testid="debtors-table">
            <table className="eb-table">
              <thead>
                <tr>
                  <th className="w-8" />
                  <th>Debtor</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Allocated</th>
                  <th className="text-right">Invoices</th>
                  <th className="text-right">Runs</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <React.Fragment key={r.debtor}>
                    <tr>
                      <td>
                        <button onClick={() => setOpen((o) => ({ ...o, [r.debtor]: !o[r.debtor] }))} data-testid={`debtor-toggle-${r.debtor}`}>
                          {open[r.debtor] ? <ChevronDown className="h-4 w-4 text-[#0F172A]/40" /> : <ChevronRight className="h-4 w-4 text-[#0F172A]/40" />}
                        </button>
                      </td>
                      <td className="font-medium">
                        <div className="flex items-center gap-2">
                          {r.debtor}
                          {r.flagged && <span className="eb-badge border-[#FB1A41]/20 bg-[#FB1A41]/10 text-[#EA2E49]"><Flag className="mr-1 h-3 w-3" /> Flagged</span>}
                        </div>
                      </td>
                      <td className="text-right font-medium tabular-nums text-[#EA2E49]">{fmtGBP(r.total_outstanding)}</td>
                      <td className="text-right tabular-nums text-[#45AE8D]">{fmtGBP(r.total_allocated)}</td>
                      <td className="text-right tabular-nums">{r.invoice_count}</td>
                      <td className="text-right tabular-nums">{r.runs.length}</td>
                    </tr>
                    {open[r.debtor] && (
                      <tr className="!bg-[#F8FAFB]">
                        <td />
                        <td colSpan={5} className="!py-4">
                          <table className="w-full text-[13px]">
                            <thead className="text-[#0F172A]/50">
                              <tr><th className="py-1 text-left">Run</th><th className="py-1 text-left">Period</th><th className="py-1 text-left">Invoice</th><th className="py-1 text-left">Status</th><th className="py-1 text-right">Allocated</th><th className="py-1 text-right">Outstanding</th></tr>
                            </thead>
                            <tbody>
                              {r.runs.map((rr, i) => (
                                <tr key={i} className="border-t border-[#0F172A]/5">
                                  <td className="py-2">{rr.run_name}</td>
                                  <td className="py-2">{rr.period}</td>
                                  <td className="py-2 font-mono">{rr.invoice_number}</td>
                                  <td className="py-2"><StatusBadge status={rr.status} /></td>
                                  <td className="py-2 text-right tabular-nums text-[#45AE8D]">{fmtGBP(rr.allocated)}</td>
                                  <td className="py-2 text-right tabular-nums">{fmtGBP(rr.outstanding)}</td>
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
                  <tr><td className="!p-0" colSpan={6}><EmptyState testid="debtors-empty">No debtors yet. Run an allocation first.</EmptyState></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = status === "full"
    ? "border-[#45AE8D]/20 bg-[#45AE8D]/10 text-[#45AE8D]"
    : status === "partial"
      ? "border-[#FEC670]/30 bg-[#FEC670]/15 text-[#B45309]"
      : "border-[#FB1A41]/20 bg-[#FB1A41]/10 text-[#EA2E49]";
  return <span className={`eb-badge ${cls}`}>{status}</span>;
}
