import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, fmtGBP, formatError, downloadAuthed } from "@/lib/api";
import { toast } from "sonner";
import { ArrowLeft, Download, Link2, AlertTriangle, FileSpreadsheet, ChevronLeft, ChevronRight, Search, Eye, ArrowRight } from "lucide-react";

const TABS = [
  { id: "full", label: "Confirmed" },
  { id: "partial", label: "Suggested" },
  { id: "unmatched_bank", label: "Unmatched Bank" },
  { id: "unmatched_invoice", label: "Unmatched Invoice" },
  { id: "audit", label: "Audit Log" },
];

const CONF_COLOUR = {
  high: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-rose-100 text-rose-800 border-rose-200",
  manual: "bg-blue-100 text-blue-800 border-blue-200",
};

const PAGE_SIZE = 50;

export default function AllocationDetail() {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [tab, setTab] = useState("full");
  const [audit, setAudit] = useState([]);
  const [linkDialog, setLinkDialog] = useState(null);

  // Tab-bound paginated data
  const [tabData, setTabData] = useState({ rows: [], page: 1, total: 0 });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [tabLoading, setTabLoading] = useState(false);
  const [review, setReview] = useState(null); // bank row being reviewed in the side-panel

  const loadHeader = useCallback(async () => {
    try {
      const { data } = await api.get(`/allocations/${id}`);
      setRun(data);
      return data;
    } catch (e) { toast.error(formatError(e)); }
  }, [id]);

  useEffect(() => { loadHeader(); }, [loadHeader]);

  // Poll while processing
  useEffect(() => {
    if (run?.status !== "processing") return;
    const t = setInterval(async () => {
      const d = await loadHeader();
      if (d?.status !== "processing") clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [run?.status, loadHeader]);

  const loadAudit = useCallback(async () => {
    try {
      const { data } = await api.get(`/audit`, { params: { run_id: id } });
      setAudit(data.logs || []);
    } catch (e) { toast.error(formatError(e)); }
  }, [id]);

  const loadTab = useCallback(async (bucket, p = 1, q = "") => {
    if (bucket === "audit") { await loadAudit(); return; }
    setTabLoading(true);
    try {
      const { data } = await api.get(`/allocations/${id}/rows`, {
        params: { bucket, page: p, page_size: PAGE_SIZE, search: q },
      });
      setTabData({ rows: data.rows || [], page: data.page, total: data.total });
    } catch (e) { toast.error(formatError(e)); }
    finally { setTabLoading(false); }
  }, [id, loadAudit]);

  // Reload tab when tab/search/page changes (debounce search)
  useEffect(() => {
    if (!run || run.status !== "done") return;
    const t = setTimeout(() => { loadTab(tab, page, search); }, search ? 350 : 0);
    return () => clearTimeout(t);
  }, [tab, page, search, run?.status, loadTab]); // eslint-disable-line

  // Reset page when changing tab/search
  useEffect(() => { setPage(1); }, [tab, search]);

  const [exporting, setExporting] = useState(null); // 'csv' | 'xlsx' | null

  const handleExport = async (kind) => {
    if (exporting) return;
    setExporting(kind);
    const safe = (run?.name || "allocation").replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
    try {
      if (kind === "csv") {
        await downloadAuthed(`/allocations/${id}/export`, `allocation-${safe}.csv`);
      } else {
        await downloadAuthed(`/allocations/${id}/export-xlsx`, `allocation-${safe}.xlsx`);
      }
      toast.success(kind === "csv" ? "CSV ready" : "Excel ready");
    } catch (e) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(null);
    }
  };

  if (!run) return <div className="text-slate-500" data-testid="loading">Loading…</div>;

  if (run.status === "processing") {
    return (
      <div data-testid="processing-page">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>
        <div className="bg-white border border-slate-200 rounded-md p-10 text-center">
          <div className="h-10 w-10 mx-auto rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin" />
          <h2 className="font-display font-semibold text-xl mt-4">Processing &ldquo;{run.name}&rdquo;</h2>
          <p className="text-sm text-slate-500 mt-2">
            Large file detected ({run.stats?.total_bank || 0} bank rows × {run.stats?.total_invoices || 0} invoices).
            We&rsquo;ll auto-refresh this page when matching is complete.
          </p>
        </div>
      </div>
    );
  }
  if (run.status === "error") {
    return (
      <div data-testid="error-page">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-3">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
        </Link>
        <div className="bg-rose-50 border border-rose-200 rounded-md p-6">
          <h2 className="font-semibold text-rose-900">Run failed</h2>
          <p className="text-sm text-rose-900 mt-2 font-mono">{run.error || "Unknown error"}</p>
        </div>
      </div>
    );
  }

  const total = run.stats.total_bank || 0;
  const unmatchedRate = total > 0 ? Math.round(((run.stats.unmatched_bank || 0) / total) * 100) : 0;
  const highUnmatched = unmatchedRate >= 30;

  const onManualLinked = async () => {
    setLinkDialog(null);
    await loadHeader();
    await loadTab(tab, page, search);
    toast.success("Link saved");
  };

  return (
    <div data-testid="allocation-detail-page">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 mb-3" data-testid="back-to-dashboard">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to dashboard
      </Link>
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-display font-bold text-3xl tracking-tight">{run.name}</h1>
          <p className="text-slate-500 text-sm mt-1">Period {run.period} · Created {new Date(run.created_at).toLocaleString("en-GB")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => handleExport("xlsx")} disabled={exporting !== null} data-testid="export-xlsx"
            className="inline-flex items-center gap-2 bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            <FileSpreadsheet className="h-4 w-4" />
            {exporting === "xlsx" ? "Preparing…" : "Export Excel"}
          </button>
          <button onClick={() => handleExport("csv")} disabled={exporting !== null} data-testid="export-csv"
            className="inline-flex items-center gap-2 bg-[#0F172A] text-white font-semibold px-4 py-2.5 rounded-md hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            <Download className="h-4 w-4" />
            {exporting === "csv" ? "Preparing…" : "Export CSV"}
          </button>
        </div>
      </div>

      {highUnmatched && (
        <div className="border border-amber-200 bg-amber-50 rounded-md p-4 mb-6 flex items-start gap-3" data-testid="high-unmatched-banner">
          <AlertTriangle className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold text-amber-900">High unmatched rate: {unmatchedRate}%</div>
            <div className="text-sm text-amber-900 mt-1">
              {run.stats.unmatched_bank} of {total} bank receipts could not be matched automatically.
              Review the <button onClick={() => setTab("unmatched_bank")} className="font-semibold underline">Unmatched Bank</button> tab.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-8">
        <Stat label="Total allocated" value={fmtGBP(run.stats.total_allocated)} tone="emerald" testid="stat-total" />
        <Stat label="Confirmed" value={run.stats.fully_matched} tone="emerald" testid="stat-full" />
        <Stat label="Suggested (review)" value={run.stats.partially_matched} tone="amber" testid="stat-partial" />
        <Stat label="Unmatched bank" value={run.stats.unmatched_bank} tone="rose" testid="stat-unmatched-bank" />
        <Stat label="Unmatched invoices" value={run.stats.unmatched_invoices} tone="rose" testid="stat-unmatched-invoice" />
      </div>

      <div className="border-b border-slate-200 flex gap-1 mb-6">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.id ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "audit" && (
        <div className="flex items-center justify-between mb-3 gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "unmatched_invoice" ? "Search by invoice # or debtor…" : "Search by reference, payer, or invoice #…"}
              className="w-full border border-slate-200 rounded-md pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              data-testid="rows-search"
            />
          </div>
          <div className="text-xs text-slate-500">
            {tabLoading ? "Loading…" : `${tabData.total.toLocaleString("en-GB")} rows`}
          </div>
        </div>
      )}

      {(tab === "full" || tab === "partial") && (
        <BankTable rows={tabData.rows} showLink={false} onReview={setReview} />
      )}
      {tab === "unmatched_bank" && (
        <BankTable rows={tabData.rows} showLink={true} onLink={(bankId) => setLinkDialog({ bankId })} onReview={setReview} />
      )}
      {tab === "unmatched_invoice" && (
        <InvoiceTable rows={tabData.rows} onLink={(invoiceId) => setLinkDialog({ invoiceId })} />
      )}
      {tab === "audit" && <AuditTable logs={audit} />}

      {tab !== "audit" && tabData.total > PAGE_SIZE && (
        <Pagination page={page} total={tabData.total} pageSize={PAGE_SIZE} onChange={setPage} />
      )}

      {review && (
        <ReviewPanel bank={review} onClose={() => setReview(null)} />
      )}

      {linkDialog && (
        <ManualLinkDialog
          runId={id}
          context={linkDialog}
          onClose={() => setLinkDialog(null)}
          onLinked={onManualLinked}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone, testid }) {
  const map = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
  };
  return (
    <div className={`rounded-md border p-4 ${map[tone]}`} data-testid={testid}>
      <div className="text-[10px] uppercase tracking-wider font-semibold">{label}</div>
      <div className="font-display font-bold text-xl mt-1 tabular-nums">{value}</div>
    </div>
  );
}

function Pagination({ page, total, pageSize, onChange }) {
  const pages = Math.ceil(total / pageSize);
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between mt-4 text-sm" data-testid="pagination">
      <div className="text-slate-500">Showing {start.toLocaleString("en-GB")}–{end.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}</div>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(Math.max(1, page - 1))} disabled={page === 1} data-testid="page-prev"
          className="px-2 py-1.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-3 py-1.5 text-slate-700 font-medium">{page} / {pages}</span>
        <button onClick={() => onChange(Math.min(pages, page + 1))} disabled={page >= pages} data-testid="page-next"
          className="px-2 py-1.5 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function BankTable({ rows, showLink, onLink, onReview }) {
  if (rows.length === 0) return <Empty label="No rows in this bucket." />;
  // Explode: one display row per (bank, match) pair. Unmatched bank rows render once with no match info.
  const exploded = [];
  rows.forEach((b) => {
    const matches = b.matches || [];
    if (matches.length === 0) {
      exploded.push({ b, m: null, isFirst: true, count: 1, idx: 0 });
    } else {
      matches.forEach((m, idx) => {
        exploded.push({ b, m, isFirst: idx === 0, count: matches.length, idx });
      });
    }
  });
  return (
    <div className="bg-white border border-slate-200 rounded-md overflow-x-auto scroll-area-thin" data-testid="bank-table">
      <table className="w-full text-sm min-w-[1320px]">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
          <tr>
            <Th>Date</Th>
            <Th>Bank reference</Th>
            <Th>Payer</Th>
            <Th right>Bank amount</Th>
            <Th>Invoice #</Th>
            <Th>Debtor</Th>
            <Th right>Invoice amt</Th>
            <Th right>Allocated</Th>
            <Th right>Outstanding</Th>
            <Th>Match reason</Th>
            <Th>Conf.</Th>
            <th className="px-2 py-2.5 text-right font-semibold w-10"><Eye className="h-3.5 w-3.5 inline text-slate-400" /></th>
            {showLink && <Th />}
          </tr>
        </thead>
        <tbody>
          {exploded.map((e) => {
            const { b, m, isFirst, count, idx } = e;
            const hasAmbiguous = m?.ambiguous;
            const lowConf = m?.confidence === "low";
            const topBorder = isFirst ? "border-t-2 border-slate-300" : "border-t border-slate-100";
            const handleRowClick = () => onReview?.(b);
            return (
              <tr key={`${b.id}-${idx}`} className={`${topBorder} hover:bg-slate-50/60 align-top cursor-pointer transition-colors`}
                  onClick={handleRowClick}
                  data-testid={`row-${b.id}-${idx}`}>
                <td className="px-3 py-2 text-slate-500">{isFirst ? (b.date || "—") : ""}</td>
                <td className="px-3 py-2 font-mono text-xs">{isFirst ? (b.reference || "—") : <span className="text-slate-300">↳</span>}</td>
                <td className="px-3 py-2">{isFirst ? (b.payer || "—") : ""}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">
                  {isFirst ? fmtGBP(b.amount) : ""}
                  {isFirst && count > 1 && <div className="text-[10px] text-slate-400 font-normal">{count} matches</div>}
                </td>
                {m ? (
                  <>
                    <td className="px-3 py-2 font-mono text-xs" data-testid={`match-${b.id}-${idx}-invnum`}>{m.invoice_number || "?"}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{m.invoice_debtor || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs text-slate-600" data-testid={`match-${b.id}-${idx}-invamt`}>
                      {m.invoice_amount != null ? fmtGBP(m.invoice_amount) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700 font-semibold" data-testid={`match-${b.id}-${idx}-allocated`}>
                      {fmtGBP(m.amount)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs" data-testid={`match-${b.id}-${idx}-outstanding`}>
                      {m.invoice_outstanding_before != null && m.invoice_outstanding_after != null ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="text-slate-500">{fmtGBP(m.invoice_outstanding_before)}</span>
                          <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className={m.invoice_outstanding_after <= 0.005 ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
                            {fmtGBP(m.invoice_outstanding_after)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700 max-w-sm">
                      <div className="flex items-start gap-1">
                        {(hasAmbiguous || lowConf) && (
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                        )}
                        <span>{m.reason || "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {m.confidence && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CONF_COLOUR[m.confidence] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                          {m.confidence}
                        </span>
                      )}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-slate-300">—</td>
                    <td className="px-3 py-2 text-slate-300">—</td>
                    <td className="px-3 py-2 text-slate-300">—</td>
                    <td className="px-3 py-2 text-slate-300">—</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtGBP(b.remaining)}</td>
                    <td className="px-3 py-2 text-xs text-slate-700 max-w-sm">
                      <div className="flex items-start gap-1">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-600 mt-0.5 shrink-0" />
                        <span>{b.reason || "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2"><span className="text-[10px] px-2 py-0.5 rounded-full border bg-rose-100 text-rose-800 border-rose-200">unmatched</span></td>
                  </>
                )}
                <td className="px-2 py-2 text-right" onClick={(ev) => ev.stopPropagation()}>
                  {isFirst && (
                    <button onClick={handleRowClick} data-testid={`review-bank-${b.id}`}
                      title="Open review panel"
                      className="inline-flex items-center justify-center h-6 w-6 rounded text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors">
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
                {showLink && (
                  <td className="px-3 py-2 text-right" onClick={(ev) => ev.stopPropagation()}>
                    {isFirst && !m && (
                      <button onClick={() => onLink(b.id)} data-testid={`link-bank-${b.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900">
                        <Link2 className="h-3.5 w-3.5" /> Link
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReviewPanel({ bank, onClose }) {
  if (!bank) return null;
  const matches = bank.matches || [];
  const totalAllocated = matches.reduce((s, m) => s + m.amount, 0);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" data-testid="review-panel">
      <div className="bg-white rounded-md border border-slate-200 max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Allocation review</div>
            <h3 className="font-display font-semibold text-xl mt-1">{bank.reference || "(no reference)"}</h3>
            <div className="text-sm text-slate-500 mt-1">
              {bank.payer || "—"} · {bank.date || "no date"} · <span className="font-semibold text-slate-700">{fmtGBP(bank.amount)}</span>
            </div>
          </div>
          <button onClick={onClose} data-testid="review-close" className="text-slate-400 hover:text-slate-700 text-2xl leading-none">×</button>
        </div>

        <div className="mt-6 grid sm:grid-cols-3 gap-3">
          <ReviewStat label="Bank amount" value={fmtGBP(bank.amount)} />
          <ReviewStat label="Total allocated" value={fmtGBP(totalAllocated)} tone="emerald" />
          <ReviewStat label="Remaining" value={fmtGBP(bank.remaining)} tone={bank.remaining > 0.005 ? "amber" : "slate"} />
        </div>

        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Evidence collected</div>
          <div className="space-y-2 text-sm">
            <ReviewLine label="Status" value={
              <span className={`text-xs px-2 py-0.5 rounded-full border ${
                bank.status === "full" ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
                bank.status === "partial" ? "bg-amber-100 text-amber-800 border-amber-200" :
                "bg-rose-100 text-rose-800 border-rose-200"
              }`}>{bank.status}{bank.confidence ? ` · ${bank.confidence}` : ""}</span>
            } />
            <ReviewLine label="Extracted references" value={
              (bank.extracted_refs && bank.extracted_refs.length)
                ? <span className="font-mono">{bank.extracted_refs.join(", ")}</span>
                : <span className="text-slate-400 italic">None detected in bank text</span>
            } />
            <ReviewLine label="Best debtor name similarity" value={
              bank.best_debtor_score != null
                ? <span>{bank.best_debtor_score}% {bank.best_debtor_score < 70 ? "(below match threshold)" : ""}</span>
                : <span className="text-slate-400 italic">Not evaluated (reference match took priority)</span>
            } />
            <ReviewLine label="Amount balancing" value={
              bank.remaining <= 0.005
                ? <span className="text-emerald-700">Fully allocated — bank amount equals sum of matched invoices</span>
                : <span className="text-amber-700">{fmtGBP(bank.remaining)} of {fmtGBP(bank.amount)} remains unallocated — no additional matches added (strict hierarchy)</span>
            } />
            <ReviewLine label="Overall reasoning" value={<span>{bank.reason || "—"}</span>} />
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
            Matched invoices ({matches.length})
          </div>
          {matches.length === 0 ? (
            <Empty label="No invoices matched — use Link manually to assign one." />
          ) : (
            <div className="border border-slate-200 rounded-md divide-y divide-slate-100">
              {matches.map((m, i) => (
                <div key={i} className="p-3" data-testid={`review-match-${i}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold">{m.invoice_number || "?"}</div>
                      <div className="text-xs text-slate-500">{m.invoice_debtor || "—"}</div>
                      {m.invoice_amount != null && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          Invoice amount <span className="font-semibold text-slate-700 tabular-nums">{fmtGBP(m.invoice_amount)}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums text-emerald-700">{fmtGBP(m.amount)}</div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CONF_COLOUR[m.confidence] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                        {m.confidence}
                      </span>
                    </div>
                  </div>
                  {m.invoice_outstanding_before != null && m.invoice_outstanding_after != null && (
                    <div className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
                      <span>Outstanding</span>
                      <span className="font-semibold text-slate-700 tabular-nums">{fmtGBP(m.invoice_outstanding_before)}</span>
                      <ArrowRight className="h-3 w-3 text-slate-400" />
                      <span className={`font-semibold tabular-nums ${m.invoice_outstanding_after <= 0.005 ? "text-emerald-700" : "text-amber-700"}`}>
                        {fmtGBP(m.invoice_outstanding_after)}
                      </span>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-slate-700 flex items-start gap-1">
                    {m.ambiguous && <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />}
                    <span>{m.reason}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewStat({ label, value, tone }) {
  const map = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div className={`rounded-md border p-3 ${tone ? map[tone] : "border-slate-200 bg-slate-50 text-slate-700"}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold">{label}</div>
      <div className="font-display font-bold text-lg mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function ReviewLine({ label, value }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-44 text-xs font-semibold uppercase tracking-wider text-slate-500 shrink-0 mt-0.5">{label}</div>
      <div className="text-sm flex-1">{value}</div>
    </div>
  );
}

function InvoiceTable({ rows, onLink }) {
  if (rows.length === 0) return <Empty label="All invoices are at least partially matched." />;
  return (
    <div className="bg-white border border-slate-200 rounded-md overflow-hidden" data-testid="invoice-table">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
          <tr>
            <Th>Invoice #</Th><Th>Debtor</Th><Th>Date</Th>
            <Th right>Amount</Th><Th right>Outstanding</Th><Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50/60">
              <td className="px-3 py-2 font-mono text-xs">{i.number}</td>
              <td className="px-3 py-2">{i.debtor || "—"}</td>
              <td className="px-3 py-2 text-slate-500">{i.date || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtGBP(i.amount)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-rose-700 font-semibold">{fmtGBP(i.remaining)}</td>
              <td className="px-3 py-2 text-right">
                <button onClick={() => onLink(i.id)} data-testid={`link-invoice-${i.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900">
                  <Link2 className="h-3.5 w-3.5" /> Link manually
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ logs }) {
  if (logs.length === 0) return <Empty label="No audit events for this run yet." />;
  return (
    <div className="bg-white border border-slate-200 rounded-md overflow-hidden" data-testid="audit-table">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
          <tr><Th>Timestamp</Th><Th>Action</Th><Th>Details</Th></tr>
        </thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-500">{new Date(l.created_at).toLocaleString("en-GB")}</td>
              <td className="px-3 py-2 font-mono text-xs">{l.action}</td>
              <td className="px-3 py-2 text-xs text-slate-600 font-mono">{JSON.stringify(l.details)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ManualLinkDialog({ runId, context, onClose, onLinked }) {
  const [bankId, setBankId] = useState(context.bankId || "");
  const [invoiceId, setInvoiceId] = useState(context.invoiceId || "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const [bankSearch, setBankSearch] = useState("");
  const [invSearch, setInvSearch] = useState("");
  const [bankResults, setBankResults] = useState([]);
  const [invResults, setInvResults] = useState([]);
  const [bankTotal, setBankTotal] = useState(0);
  const [invTotal, setInvTotal] = useState(0);
  const [selectedBank, setSelectedBank] = useState(null);
  const [selectedInv, setSelectedInv] = useState(null);

  const fetchSide = useCallback(async (bucket, search, setter, totalSetter) => {
    try {
      const { data } = await api.get(`/allocations/${runId}/rows`, {
        params: { bucket, page: 1, page_size: 25, search },
      });
      setter(data.rows || []);
      totalSetter(data.total || 0);
    } catch (e) { /* swallow — toast shown by interceptor / parent */ }
  }, [runId]);

  // initial load (and refetch on search change with debounce)
  useEffect(() => {
    const t = setTimeout(() => fetchSide("unmatched_bank", bankSearch, setBankResults, setBankTotal), 250);
    return () => clearTimeout(t);
  }, [bankSearch, fetchSide]);
  useEffect(() => {
    const t = setTimeout(() => fetchSide("unmatched_invoice", invSearch, setInvResults, setInvTotal), 250);
    return () => clearTimeout(t);
  }, [invSearch, fetchSide]);

  // If a context bank/invoice was pre-selected, fetch its details once
  useEffect(() => {
    if (context.bankId) {
      api.get(`/allocations/${runId}/rows`, { params: { bucket: "unmatched_bank", page: 1, page_size: 1, search: "" } }).catch(() => {});
    }
  }, []); // eslint-disable-line

  const bank = selectedBank || bankResults.find((b) => b.id === bankId);
  const inv = selectedInv || invResults.find((i) => i.id === invoiceId);

  useEffect(() => {
    if (bank && inv) {
      setAmount(Math.min(bank.remaining, inv.remaining).toFixed(2));
    }
  }, [bankId, invoiceId, bank, inv]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(`/allocations/${runId}/manual-link`, {
        bank_row_id: bankId, invoice_row_id: invoiceId, amount: Number(amount),
      });
      onLinked();
    } catch (e) { toast.error(formatError(e)); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" data-testid="link-dialog">
      <div className="bg-white rounded-md border border-slate-200 max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="font-display font-semibold text-xl">Link bank payment to invoice</h3>
        <p className="text-sm text-slate-500 mt-1">Search across all unmatched rows. Selection will be audit-logged.</p>

        <div className="grid md:grid-cols-2 gap-4 mt-6">
          <SearchableList
            label={`Bank payments (${bankTotal.toLocaleString("en-GB")})`}
            search={bankSearch} setSearch={setBankSearch}
            placeholder="Search reference / payer / invoice…"
            rows={bankResults} selectedId={bankId}
            renderRow={(b) => (
              <>
                <div className="font-mono text-xs truncate">{b.reference || "(no ref)"}</div>
                <div className="text-xs text-slate-500 truncate flex items-center justify-between gap-2">
                  <span className="truncate">{b.payer || "—"} · {b.date || "no date"}</span>
                  <span className="text-emerald-700 font-semibold tabular-nums shrink-0">{fmtGBP(b.remaining)}</span>
                </div>
              </>
            )}
            onSelect={(b) => { setBankId(b.id); setSelectedBank(b); }}
            testid="link-bank-list"
          />
          <SearchableList
            label={`Invoices (${invTotal.toLocaleString("en-GB")})`}
            search={invSearch} setSearch={setInvSearch}
            placeholder="Search invoice # / debtor…"
            rows={invResults} selectedId={invoiceId}
            renderRow={(i) => (
              <>
                <div className="font-mono text-xs truncate">{i.number}</div>
                <div className="text-xs text-slate-500 truncate flex items-center justify-between gap-2">
                  <span className="truncate">{i.debtor || "—"}</span>
                  <span className="text-rose-700 font-semibold tabular-nums shrink-0">{fmtGBP(i.remaining)}</span>
                </div>
              </>
            )}
            onSelect={(i) => { setInvoiceId(i.id); setSelectedInv(i); }}
            testid="link-invoice-list"
          />
        </div>

        <div className="mt-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Amount to allocate (£)</div>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01"
            className="w-full md:w-60 border border-slate-200 rounded-md px-3 py-2 text-sm"
            data-testid="dialog-amount" />
        </div>

        <div className="flex items-center justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900" data-testid="dialog-cancel">Cancel</button>
          <button onClick={submit} disabled={!bankId || !invoiceId || !amount || busy} data-testid="dialog-confirm"
            className="gradient-cta text-white font-semibold px-5 py-2 rounded-md disabled:opacity-50">
            {busy ? "Linking…" : "Confirm link"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SearchableList({ label, search, setSearch, placeholder, rows, selectedId, renderRow, onSelect, testid }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">{label}</div>
      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={placeholder}
          className="w-full border border-slate-200 rounded-md pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          data-testid={`${testid}-search`} />
      </div>
      <div className="border border-slate-200 rounded-md max-h-64 overflow-y-auto divide-y divide-slate-100" data-testid={testid}>
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-400">No results.</div>
        ) : rows.map((r) => (
          <button key={r.id} onClick={() => onSelect(r)} data-testid={`${testid}-row-${r.id}`}
            className={`w-full text-left px-3 py-2 hover:bg-slate-50 ${selectedId === r.id ? "bg-emerald-50" : ""}`}>
            {renderRow(r)}
          </button>
        ))}
      </div>
    </div>
  );
}

function Th({ children, right }) {
  return <th className={`px-3 py-2.5 ${right ? "text-right" : "text-left"} font-semibold`}>{children}</th>;
}

function Empty({ label }) {
  return <div className="border border-dashed border-slate-200 rounded-md py-12 text-center text-sm text-slate-500" data-testid="empty-bucket">{label}</div>;
}
