import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { api, API_BASE, fmtGBP, formatError } from "@/lib/api";
import { toast } from "sonner";
import { ArrowLeft, Download, Link2, GripVertical, AlertTriangle, FileSpreadsheet, ChevronLeft, ChevronRight, Search } from "lucide-react";

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

  const exportUrl = `${API_BASE}/allocations/${id}/export`;
  const exportXlsxUrl = `${API_BASE}/allocations/${id}/export-xlsx`;

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
          <a href={exportXlsxUrl} download data-testid="export-xlsx"
            className="inline-flex items-center gap-2 bg-emerald-600 text-white font-semibold px-4 py-2.5 rounded-md hover:bg-emerald-700 transition-colors">
            <FileSpreadsheet className="h-4 w-4" /> Export Excel
          </a>
          <a href={exportUrl} download data-testid="export-csv"
            className="inline-flex items-center gap-2 bg-[#0F172A] text-white font-semibold px-4 py-2.5 rounded-md hover:bg-slate-800 transition-colors">
            <Download className="h-4 w-4" /> Export CSV
          </a>
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
        <BankTable rows={tabData.rows} showLink={false} />
      )}
      {tab === "unmatched_bank" && (
        <BankTable rows={tabData.rows} showLink={true} onLink={(bankId) => setLinkDialog({ bankId })} />
      )}
      {tab === "unmatched_invoice" && (
        <InvoiceTable rows={tabData.rows} onLink={(invoiceId) => setLinkDialog({ invoiceId })} />
      )}
      {tab === "audit" && <AuditTable logs={audit} />}

      {tab !== "audit" && tabData.total > PAGE_SIZE && (
        <Pagination page={page} total={tabData.total} pageSize={PAGE_SIZE} onChange={setPage} />
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

function BankTable({ rows, showLink, onLink }) {
  if (rows.length === 0) return <Empty label="No rows in this bucket." />;
  return (
    <div className="bg-white border border-slate-200 rounded-md overflow-hidden" data-testid="bank-table">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
          <tr>
            <Th>Date</Th><Th>Reference</Th><Th>Payer</Th>
            <Th right>Amount</Th><Th right>Allocated</Th><Th right>Remaining</Th>
            <Th>Matched Invoices</Th><Th>Why matched?</Th><Th>Conf.</Th>
            {showLink && <Th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const allocated = (b.matches || []).reduce((s, m) => s + m.amount, 0);
            const hasAmbiguous = (b.matches || []).some((m) => m.ambiguous);
            const lowConfPartial = b.status === "partial" && b.confidence === "low";
            return (
              <tr key={b.id} className="border-t border-slate-100 hover:bg-slate-50/60 align-top">
                <td className="px-3 py-2 text-slate-500">{b.date || "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{b.reference || "—"}</td>
                <td className="px-3 py-2">{b.payer || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtGBP(b.amount)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{fmtGBP(allocated)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-600">{fmtGBP(b.remaining)}</td>
                <td className="px-3 py-2 text-xs">
                  {(b.matches || []).length === 0 ? <span className="text-slate-400">—</span> :
                    b.matches.map((m, i) => (
                      <div key={i} className="text-slate-700">
                        <span className="font-semibold">{m.invoice_number || "?"}</span>
                        <span className="text-slate-400"> · {fmtGBP(m.amount)} · {m.method}{m.score ? ` ${m.score}%` : ""}</span>
                      </div>
                    ))}
                </td>
                <td className="px-3 py-2 text-xs text-slate-600 max-w-xs">
                  <div className="flex items-start gap-1">
                    {(hasAmbiguous || lowConfPartial) && (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 shrink-0" />
                    )}
                    <span>{b.reason || "—"}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  {b.confidence && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${CONF_COLOUR[b.confidence] || "bg-slate-100 text-slate-600 border-slate-200"}`}>
                      {b.confidence}
                    </span>
                  )}
                </td>
                {showLink && (
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => onLink(b.id)} data-testid={`link-bank-${b.id}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-900">
                      <Link2 className="h-3.5 w-3.5" /> Link manually
                    </button>
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
  const [banks, setBanks] = useState([]);
  const [invs, setInvs] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  // Load eligible banks + invoices (first 200 of each — usually enough; manual linking is for the long tail)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      try {
        const [b, i] = await Promise.all([
          api.get(`/allocations/${runId}/rows`, { params: { bucket: "unmatched_bank", page: 1, page_size: 200 } }),
          api.get(`/allocations/${runId}/rows`, { params: { bucket: "unmatched_invoice", page: 1, page_size: 200 } }),
        ]);
        if (!cancelled) {
          setBanks(b.data.rows || []);
          setInvs(i.data.rows || []);
        }
      } catch (e) { toast.error(formatError(e)); }
      finally { if (!cancelled) setLoadingOptions(false); }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  const bank = banks.find((b) => b.id === bankId);
  const inv = invs.find((i) => i.id === invoiceId);

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
      <div className="bg-white rounded-md border border-slate-200 max-w-2xl w-full p-6">
        <h3 className="font-display font-semibold text-xl">Link bank payment to invoice</h3>
        <p className="text-sm text-slate-500 mt-1">Both selections will be audit-logged.</p>

        {loadingOptions ? (
          <div className="py-10 text-center text-slate-500">Loading unmatched rows…</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4 mt-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Bank payment</div>
                <select value={bankId} onChange={(e) => setBankId(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-2 text-sm" data-testid="dialog-bank-select">
                  <option value="">— Select —</option>
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>{(b.reference || "(no ref)").slice(0, 40)} — {fmtGBP(b.remaining)} remaining</option>
                  ))}
                </select>
                {bank && <div className="mt-2 text-xs text-slate-600">{bank.payer} · {bank.date || "no date"}</div>}
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Invoice</div>
                <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="w-full border border-slate-200 rounded-md px-2 py-2 text-sm" data-testid="dialog-invoice-select">
                  <option value="">— Select —</option>
                  {invs.map((i) => (
                    <option key={i.id} value={i.id}>{i.number} — {(i.debtor || "").slice(0, 28)} — {fmtGBP(i.remaining)} outstanding</option>
                  ))}
                </select>
                {inv && <div className="mt-2 text-xs text-slate-600">{inv.debtor}</div>}
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Amount to allocate (£)</div>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" step="0.01"
                className="w-full md:w-60 border border-slate-200 rounded-md px-3 py-2 text-sm"
                data-testid="dialog-amount" />
            </div>
          </>
        )}

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

function Th({ children, right }) {
  return <th className={`px-3 py-2.5 ${right ? "text-right" : "text-left"} font-semibold`}>{children}</th>;
}

function Empty({ label }) {
  return <div className="border border-dashed border-slate-200 rounded-md py-12 text-center text-sm text-slate-500" data-testid="empty-bucket">{label}</div>;
}
