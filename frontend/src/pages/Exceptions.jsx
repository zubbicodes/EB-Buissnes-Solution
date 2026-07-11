import React, { useEffect, useMemo, useState } from "react";
import { api, downloadAuthed, fmtGBP, formatError } from "@/lib/api";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Download, Filter, MessageSquare } from "lucide-react";
import { EmptyState, PageHeader, StatCard } from "@/components/DesignSystem";
import { useAuth } from "@/context/AuthContext";

const TYPES = [
  ["", "All types"],
  ["unmatched_payment", "Unmatched payments"],
  ["unmatched_invoice", "Unmatched invoices"],
  ["duplicate_payment", "Duplicate payments"],
  ["duplicate_invoice", "Duplicate invoices"],
  ["underpayment", "Underpayments"],
  ["overpayment", "Overpayments"],
  ["low_confidence", "Low confidence"],
];

export default function Exceptions() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ type: "", status: "", debtor: "" });
  const [saving, setSaving] = useState("");
  const canEdit = user?.role !== "read_only";

  const load = async () => {
    try {
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await api.get("/exceptions", { params });
      setData(data);
    } catch (e) {
      toast.error(formatError(e));
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const rows = useMemo(() => data?.rows || [], [data]);
  const open = data?.summary?.open || 0;
  const reviewed = data?.summary?.reviewed || 0;
  const amount = useMemo(() => rows.reduce((s, r) => s + Number(r.amount || 0), 0), [rows]);

  const update = async (row, patch) => {
    setSaving(row.id);
    try {
      await api.patch(`/exceptions/${row.id}`, patch);
      toast.success("Exception updated");
      await load();
    } catch (e) {
      toast.error(formatError(e));
    } finally {
      setSaving("");
    }
  };

  const exportCsv = async () => {
    try {
      await downloadAuthed("/exceptions/export", "exception-report.csv");
    } catch (e) {
      toast.error(e?.message || "Export failed");
    }
  };

  return (
    <div data-testid="exceptions-page">
      <PageHeader
        eyebrow="Review"
        title="Exceptions"
        description="Resolve unmatched, duplicate, overpaid, underpaid, and low-confidence allocations."
        action={<button onClick={exportCsv} className="eb-button" data-testid="export-exceptions"><Download className="h-4 w-4" /> Export CSV</button>}
      />

      <div className="eb-stat-grid mb-5">
        <StatCard icon={AlertTriangle} tone="rose" label="open" value={open} helper="Needs review" testid="stat-open" />
        <StatCard icon={CheckCircle2} label="reviewed" value={reviewed} helper="Confirmed by users" testid="stat-reviewed" />
        <StatCard icon={MessageSquare} tone="amber" label="exceptions" value={rows.length} helper="Current filter" testid="stat-total" />
        <StatCard icon={Filter} tone="blue" label="value" value={fmtGBP(amount)} helper="Filtered amount" testid="stat-value" />
      </div>

      <div className="eb-panel mb-5 flex flex-wrap items-end gap-3">
        <select className="eb-input min-w-[210px]" value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}>
          {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select className="eb-input min-w-[160px]" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="reviewed">Reviewed</option>
        </select>
        <input className="eb-input min-w-[220px]" placeholder="Filter debtor..." value={filters.debtor} onChange={(e) => setFilters((f) => ({ ...f, debtor: e.target.value }))} />
        <button onClick={load} className="eb-button !h-[54px]">Apply</button>
      </div>

      {rows.length === 0 ? (
        <EmptyState testid="exceptions-empty">No exceptions match this filter.</EmptyState>
      ) : (
        <>
          <div className="eb-table-wrap hidden md:block" data-testid="exceptions-table">
            <table className="eb-table">
              <thead><tr><th>Type</th><th>Status</th><th>Debtor</th><th>Reference / Invoice</th><th className="text-right">Amount</th><th>Confidence</th><th>Notes</th><th className="text-right">Actions</th></tr></thead>
              <tbody>{rows.map((r) => <ExceptionRow key={r.id} row={r} canEdit={canEdit} saving={saving === r.id} onUpdate={update} />)}</tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((r) => <ExceptionCard key={r.id} row={r} canEdit={canEdit} saving={saving === r.id} onUpdate={update} />)}
          </div>
        </>
      )}
    </div>
  );
}

function ExceptionRow({ row, canEdit, saving, onUpdate }) {
  const [notes, setNotes] = useState(row.notes || "");
  return (
    <tr>
      <td className="font-mono text-xs">{row.type}</td>
      <td><Status status={row.status} /></td>
      <td>{row.debtor || "-"}</td>
      <td className="font-mono text-xs">{row.reference || row.invoice_number || "-"}</td>
      <td className="text-right tabular-nums">{fmtGBP(row.amount)}</td>
      <td>{row.confidence || "-"}</td>
      <td><input className="eb-input !h-9 !text-sm w-full" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} /></td>
      <td className="text-right">
        {canEdit && <div className="inline-flex gap-2">
          <button className="eb-button-secondary !h-9 !px-3 !text-sm" disabled={saving} onClick={() => onUpdate(row, { notes })}>Save</button>
          <button className="eb-button !h-9 !px-3 !text-sm" disabled={saving} onClick={() => onUpdate(row, { status: row.status === "reviewed" ? "open" : "reviewed", notes })}>{row.status === "reviewed" ? "Reopen" : "Reviewed"}</button>
        </div>}
      </td>
    </tr>
  );
}

function ExceptionCard({ row, canEdit, saving, onUpdate }) {
  const [notes, setNotes] = useState(row.notes || "");
  return (
    <div className="eb-mobile-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-[#0F172A]/55">{row.type}</div>
          <div className="mt-1 font-semibold">{row.debtor || row.reference || row.invoice_number || "Unknown"}</div>
        </div>
        <Status status={row.status} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Mini label="Amount" value={fmtGBP(row.amount)} />
        <Mini label="Confidence" value={row.confidence || "-"} />
      </div>
      <textarea className="eb-input mt-3 w-full !min-h-[92px] !text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} />
      {canEdit && <div className="mt-3 flex gap-2">
        <button className="eb-button-secondary flex-1 !h-10 !text-sm" disabled={saving} onClick={() => onUpdate(row, { notes })}>Save</button>
        <button className="eb-button flex-1 !h-10 !text-sm" disabled={saving} onClick={() => onUpdate(row, { status: row.status === "reviewed" ? "open" : "reviewed", notes })}>{row.status === "reviewed" ? "Reopen" : "Reviewed"}</button>
      </div>}
    </div>
  );
}

function Status({ status }) {
  const cls = status === "reviewed" ? "border-[#45AE8D]/20 bg-[#45AE8D]/10 text-[#45AE8D]" : "border-[#FB1A41]/20 bg-[#FB1A41]/10 text-[#EA2E49]";
  return <span className={`eb-badge ${cls}`}>{status}</span>;
}

function Mini({ label, value }) {
  return <div className="rounded-md bg-[#F8FAFB] p-3"><div className="text-[10px] uppercase tracking-wider text-[#0F172A]/45">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}
