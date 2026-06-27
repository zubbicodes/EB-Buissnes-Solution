import React, { useEffect, useState } from "react";
import { api, fmtGBP, formatError } from "@/lib/api";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/DesignSystem";

const STATUS_BADGE = {
  full: "border-[#45AE8D]/20 bg-[#45AE8D]/10 text-[#45AE8D]",
  partial: "border-[#FEC670]/30 bg-[#FEC670]/15 text-[#B45309]",
  unmatched: "border-[#FB1A41]/20 bg-[#FB1A41]/10 text-[#EA2E49]",
  absent: "border-[#0F172A]/10 bg-[#0F172A]/5 text-[#0F172A]/50",
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
      <PageHeader
        eyebrow="Multi-period"
        title="Compare allocation runs"
        description="Stack two or more runs side-by-side and spot persistently unmatched debtors."
      />

      <div className="eb-panel mb-6">
        <div className="eb-label mb-4">Select runs</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {runs.map((r) => (
            <label key={r.id} className={`flex min-h-[74px] cursor-pointer items-center gap-3 rounded-[8px] border px-4 transition-colors ${
              selected.includes(r.id) ? "border-[#45AE8D] bg-[#45AE8D]/10" : "border-[#0F172A]/5 bg-[#F8FAFB] hover:bg-white"
            }`} data-testid={`compare-pick-${r.id}`}>
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-[#45AE8D]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-medium">{r.name}</div>
                <div className="mt-1 text-[13px] text-[#0F172A]/60">{r.period}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <button onClick={run} disabled={selected.length < 2} data-testid="compare-run" className="eb-button">
            Compare ({selected.length})
          </button>
        </div>
      </div>

      {data && (
        <>
          {data.consistently_unmatched.length > 0 && (
            <div className="mb-6 flex items-start gap-3 rounded-[8px] border border-[#FB1A41]/20 bg-[#FB1A41]/10 p-5" data-testid="consistently-unmatched">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[#EA2E49]" />
              <div>
                <div className="font-semibold text-[#0F172A]">Consistently unmatched debtors</div>
                <div className="mt-1 text-[14px] text-[#0F172A]/70">
                  Unmatched across every selected run: <strong>{data.consistently_unmatched.join(", ")}</strong>
                </div>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px] text-[#0F172A]/60" data-testid="compare-legend">
            <span>Legend:</span>
            <Badge tone="full">Full</Badge>
            <Badge tone="partial">Partial</Badge>
            <Badge tone="unmatched">Unmatched</Badge>
            <Badge tone="absent">Absent</Badge>
            <span className="ml-auto">{data.rows.length} debtors</span>
          </div>

          <div className="eb-table-wrap" data-testid="compare-matrix">
            <table className="eb-table">
              <thead>
                <tr>
                  <th>Debtor</th>
                  {data.runs.map((r) => (
                    <th key={r.id}>
                      <div>{r.name}</div>
                      <div className="mt-1 text-[11px] font-normal normal-case text-[#0F172A]/40">{r.period}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.debtor}>
                    <td className="font-medium">{row.debtor}</td>
                    {data.runs.map((r) => {
                      const cell = row.runs[r.id] || { status: "absent", outstanding: 0 };
                      return (
                        <td key={r.id}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={cell.status}>{cell.status}</Badge>
                            {cell.status !== "absent" && (
                              <span className="text-[13px] tabular-nums text-[#0F172A]/60">{fmtGBP(cell.outstanding)}</span>
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
  return <span className={`eb-badge ${STATUS_BADGE[tone] || ""}`}>{children}</span>;
}
