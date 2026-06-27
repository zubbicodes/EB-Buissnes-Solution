import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, fmtGBP, formatError } from "@/lib/api";
import { toast } from "sonner";
import { Plus, FileText, CheckCircle2, AlertTriangle, XCircle, Search, CalendarDays, ChevronDown, MoreVertical, ArrowUp } from "lucide-react";
import { PageHeader, StatCard, EmptyState } from "@/components/DesignSystem";

export default function Dashboard() {
  const [runs, setRuns] = useState(null);
  const [query, setQuery] = useState("");
  const location = useLocation();
  const navigate = useNavigate();

  const load = async () => {
    try {
      const { data } = await api.get("/allocations");
      setRuns(data);
    } catch (e) { toast.error(formatError(e)); }
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setQuery(params.get("q") || "");
  }, [location.search]);

  const updateQuery = (value) => {
    setQuery(value);
    const next = value.trim();
    navigate(next ? `/dashboard?q=${encodeURIComponent(next)}` : "/dashboard", { replace: true });
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this allocation run? This action is audited.")) return;
    try {
      await api.delete(`/allocations/${id}`);
      toast.success("Run deleted");
      load();
    } catch (e) { toast.error(formatError(e)); }
  };

  const totals = (runs || []).reduce((acc, r) => {
    acc.allocated += r.stats?.total_allocated || 0;
    acc.full += r.stats?.fully_matched || 0;
    acc.partial += r.stats?.partially_matched || 0;
    acc.unmatched += r.stats?.unmatched_bank || 0;
    return acc;
  }, { allocated: 0, full: 0, partial: 0, unmatched: 0 });

  const filtered = useMemo(() => {
    if (!runs) return runs;
    const q = query.trim().toLowerCase();
    if (!q) return runs;
    return runs.filter((r) => [r.name, r.period, r.id].some((v) => String(v || "").toLowerCase().includes(q)));
  }, [runs, query]);

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        eyebrow="Overview"
        title="Allocation runs"
        description="Every cash allocation you've run, in one place."
        action={
          <Link to="/new" data-testid="new-allocation-button" className="eb-button">
            <Plus className="h-[18px] w-[18px]" /> New Allocation
          </Link>
        }
      />

      <div className="eb-stat-grid mb-8">
        <StatCard icon={FileText} tone="blue" label="total allocated" value={fmtGBP(totals.allocated)} helper="Across all runs" testid="stat-allocated" />
        <StatCard icon={CheckCircle2} label="confirmed matches" value={totals.full} helper="This month" testid="stat-full" />
        <StatCard icon={AlertTriangle} tone="amber" label="suggested (review)" value={totals.partial} helper="Requires attention" testid="stat-partial" />
        <StatCard icon={XCircle} tone="rose" label="unmatched bank" value={totals.unmatched} helper="Needs allocation" testid="stat-unmatched" />
      </div>

      <div className="eb-table-wrap" data-testid="runs-table">
        <div className="flex flex-col gap-4 border-b border-[#0F172A]/5 px-5 py-3 md:h-16 md:flex-row md:items-center md:justify-between">
          <h2 className="font-display text-[18px] font-medium leading-none">Allocation runs</h2>
          <div className="flex flex-wrap items-center gap-[10px]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#0F172A]/50" />
              <input
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                placeholder="Search runs..."
                className="h-9 w-[220px] rounded-[8px] border border-[#0F172A]/5 bg-[#F8FAFB] pl-9 pr-3 text-[13px] outline-none focus:border-[#45AE8D]"
                data-testid="dashboard-search"
              />
            </label>
            <button className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#0F172A]/5 bg-[#F8FAFB] px-3 text-[13px] font-medium text-[#0F172A]/70">
              <CalendarDays className="h-[14px] w-[14px]" />
              All periods
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>

        <table className="eb-table">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Period</Th>
              <Th>Created</Th>
              <Th right>Bank rows</Th>
              <Th right>Allocated</Th>
              <Th right>Outstanding</Th>
              <Th right>Match rate</Th>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {runs === null && (
              <tr><td className="!py-10 text-[#0F172A]/50" colSpan={8}>Loading...</td></tr>
            )}
            {filtered && filtered.length === 0 && (
              <tr>
                <td className="!p-0" colSpan={8}>
                  <EmptyState testid="empty-runs">No runs yet. Start by creating a new allocation.</EmptyState>
                </td>
              </tr>
            )}
            {filtered && filtered.map((r) => {
              const total = r.stats?.total_bank || 0;
              const matched = (r.stats?.fully_matched || 0) + (r.stats?.partially_matched || 0);
              const rate = total ? Math.round((matched / total) * 100) : 0;
              return (
                <tr key={r.id} data-testid={`run-row-${r.id}`}>
                  <td>
                    <Link to={`/allocations/${r.id}`} className="font-medium text-[#0F172A] hover:text-[#45AE8D]" data-testid={`run-link-${r.id}`}>{r.name}</Link>
                  </td>
                  <td className="text-[#0F172A]/70">{r.period}</td>
                  <td className="text-[#0F172A]/60">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                  <td className="text-right tabular-nums">{r.stats?.total_bank || 0}</td>
                  <td className="text-right font-medium tabular-nums text-[#45AE8D]">{fmtGBP(r.stats?.total_allocated)}</td>
                  <td className="text-right tabular-nums text-[#0F172A]/70">{fmtGBP(r.stats?.total_outstanding)}</td>
                  <td className="text-right tabular-nums">
                    <span className={`eb-rate-badge ${rate >= 80 ? "eb-rate-good" : rate >= 50 ? "eb-rate-warn" : "eb-rate-bad"}`}>
                      {rate}%
                    </span>
                  </td>
                  <td className="text-right">
                    <button onClick={() => remove(r.id)} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-[#0F172A]/50 hover:bg-[#0F172A]/5 hover:text-[#0F172A]" data-testid={`delete-run-${r.id}`} title="Run actions">
                      <MoreVertical className="h-4 w-4" />
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

function Th({ children, right }) {
  return (
    <th className={right ? "text-right" : "text-left"}>
      <span className={`inline-flex items-center gap-1 ${right ? "justify-end" : ""}`}>
        {children}
        <ArrowUp className="h-[12px] w-[12px]" />
      </span>
    </th>
  );
}
