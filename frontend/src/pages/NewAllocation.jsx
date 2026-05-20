import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatError } from "@/lib/api";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, FileUp, AlertCircle, CheckCircle2 } from "lucide-react";

const BANK_FIELDS = [
  ["bank_date", "Transaction Date", false],
  ["bank_reference", "Reference Text", true],
  ["bank_payer", "Payer / Counter-party", false],
  ["bank_amount", "Amount", true],
  ["bank_account", "Bank Account", false],
  ["bank_transaction_type", "Transaction Type", false],
];

const INV_FIELDS = [
  ["invoice_date", "Invoice Date", false],
  ["invoice_number", "Invoice Number", true],
  ["invoice_debtor", "Debtor / Customer", true],
  ["invoice_amount", "Amount", true],
  ["invoice_outstanding", "Outstanding (optional)", false],
  ["invoice_due_date", "Due Date", false],
  ["invoice_customer_reference", "Customer Reference", false],
];

const SAMPLE_BANK = `Date,Reference,Payer,Amount
2026-01-05,INV-1001 payment,Acme Corp Ltd,1200.00
2026-01-06,Ref 1002 thanks,Bright Sparks Limited,500.00
2026-01-07,Payment INV1003 part,Tinker Tools,250.00
2026-01-08,Receipt,Smithson Holdings,1750.00
2026-01-09,Random,Zenith Group,75.00`;

const SAMPLE_INV = `InvoiceNumber,Debtor,Amount,Date
INV-1001,Acme Corporation Ltd,1200.00,2025-12-15
INV-1002,Bright Sparks Limited,750.00,2025-12-20
INV-1003,Tinker Tools Ltd,400.00,2025-12-22
INV-1004,Smithson Holdings,1750.00,2025-12-28
INV-1005,Globex Industries,920.00,2025-12-30`;

export default function NewAllocation() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [period, setPeriod] = useState("");
  const [bankCsv, setBankCsv] = useState("");
  const [invCsv, setInvCsv] = useState("");
  const [bankHeaders, setBankHeaders] = useState([]);
  const [invHeaders, setInvHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [validation, setValidation] = useState(null);
  const [loading, setLoading] = useState(false);

  const detectHeaders = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.post("/allocations/preview-headers", { bank_csv: bankCsv, invoice_csv: invCsv });
      setBankHeaders(data.bank_headers || []);
      setInvHeaders(data.invoice_headers || []);
      // Best-effort default mapping — only fill keys that aren't already set
      const guess = (headers, candidates) =>
        headers.find((h) => candidates.some((c) => h.toLowerCase().includes(c))) || "";
      setMapping((prev) => ({
        bank_date: prev.bank_date || guess(data.bank_headers || [], ["transaction_date", "date"]),
        bank_reference: prev.bank_reference || guess(data.bank_headers || [], ["reference_text", "reference", "ref", "desc", "narrative"]),
        bank_payer: prev.bank_payer || guess(data.bank_headers || [], ["payer", "party", "counter"]),
        bank_amount: prev.bank_amount || guess(data.bank_headers || [], ["amount", "credit", "value"]),
        bank_account: prev.bank_account || guess(data.bank_headers || [], ["bank_account", "account"]),
        bank_transaction_type: prev.bank_transaction_type || guess(data.bank_headers || [], ["transaction_type", "type"]),
        invoice_number: prev.invoice_number || guess(data.invoice_headers || [], ["invoice_number", "invoice", "number", "no"]),
        invoice_debtor: prev.invoice_debtor || guess(data.invoice_headers || [], ["debtor_name", "debtor", "customer", "client", "name"]),
        invoice_amount: prev.invoice_amount || guess(data.invoice_headers || [], ["invoice_amount", "amount", "total", "value"]),
        invoice_date: prev.invoice_date || guess(data.invoice_headers || [], ["invoice_date", "date"]),
        invoice_outstanding: prev.invoice_outstanding || guess(data.invoice_headers || [], ["outstanding", "balance", "due"]),
        invoice_due_date: prev.invoice_due_date || guess(data.invoice_headers || [], ["due_date", "due"]),
        invoice_customer_reference: prev.invoice_customer_reference || guess(data.invoice_headers || [], ["customer_reference", "cust_ref"]),
      }));
    } catch (e) { if (!silent) toast.error(formatError(e)); }
    if (!silent) setLoading(false);
  };

  // Auto-detect headers whenever CSV text changes (debounced)
  useEffect(() => {
    if (!bankCsv && !invCsv) return;
    const t = setTimeout(() => { detectHeaders(true); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankCsv, invCsv]);

  const validate = async () => {
    setLoading(true); setValidation(null);
    try {
      const { data } = await api.post("/allocations/validate", { bank_csv: bankCsv, invoice_csv: invCsv, mapping });
      setValidation(data);
    } catch (e) { toast.error(formatError(e)); }
    setLoading(false);
  };

  const submit = async () => {
    setLoading(true);
    try {
      const { data } = await api.post("/allocations", {
        name, period, bank_csv: bankCsv, invoice_csv: invCsv, mapping,
        proceed_with_warnings: true,
      });
      toast.success("Allocation complete");
      navigate(`/allocations/${data.id}`);
    } catch (e) { toast.error(formatError(e)); }
    setLoading(false);
  };

  const steps = ["Details", "Bank CSV", "Invoice CSV & Mapping", "Validate & Run"];

  const next = async () => {
    if (step === 4) return submit();
    setStep((s) => Math.min(4, s + 1));
  };

  const canNext =
    (step === 1 && name && period) ||
    (step === 2 && bankCsv.trim().length > 0) ||
    (step === 3 && invCsv.trim().length > 0 && mapping.bank_reference && mapping.bank_amount && mapping.invoice_number && mapping.invoice_debtor && mapping.invoice_amount) ||
    (step === 4 && validation?.ok);

  return (
    <div data-testid="new-allocation-page">
      <div className="flex items-center justify-between mb-8">
        <h1 className="font-display font-bold text-3xl tracking-tight">New allocation</h1>
        <div className="text-sm text-slate-500">Step {step} of 4</div>
      </div>

      <div className="flex items-center gap-2 mb-8">
        {steps.map((label, i) => {
          const n = i + 1;
          const active = n === step, done = n < step;
          return (
            <div key={label} className="flex items-center flex-1">
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                done ? "bg-emerald-600 text-white" : active ? "bg-[#0F172A] text-white" : "bg-slate-200 text-slate-500"
              }`}>{done ? <Check className="h-4 w-4" /> : n}</div>
              <div className={`ml-3 text-sm font-medium ${active ? "text-slate-900" : "text-slate-400"}`}>{label}</div>
              {i < steps.length - 1 && <div className="flex-1 h-px bg-slate-200 mx-3" />}
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-slate-200 rounded-md p-8 min-h-[420px]">
        {step === 1 && (
          <div className="max-w-xl space-y-6" data-testid="step-1">
            <Field label="Run name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. January 2026 cash receipts"
                className="w-full border border-slate-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                data-testid="run-name-input" />
            </Field>
            <Field label="Period">
              <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. 2026-01"
                className="w-full border border-slate-200 rounded-md px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                data-testid="run-period-input" />
            </Field>
          </div>
        )}

        {step === 2 && (
          <CsvStep
            title="Paste your bank CSV"
            description="Headers must be on the first row. Use the sample if you want a quick demo."
            value={bankCsv} setValue={setBankCsv} sample={SAMPLE_BANK} testid="bank-csv"
          />
        )}

        {step === 3 && (
          <div className="space-y-8" data-testid="step-3">
            <CsvStep
              title="Paste your invoice CSV"
              description="Each row is one open invoice. Outstanding is optional (defaults to Amount)."
              value={invCsv} setValue={setInvCsv} sample={SAMPLE_INV} testid="invoice-csv"
            />
            <div className="border-t border-slate-200 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-semibold text-lg">Column mapping</h3>
                <button onClick={() => detectHeaders(false)} disabled={loading} data-testid="detect-headers-btn"
                  className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-md transition-colors">
                  {loading ? "Detecting…" : "Auto-detect"}
                </button>
              </div>
              <div className="grid md:grid-cols-2 gap-8">
                <MappingGroup title="Bank columns" fields={BANK_FIELDS} headers={bankHeaders} mapping={mapping} setMapping={setMapping} />
                <MappingGroup title="Invoice columns" fields={INV_FIELDS} headers={invHeaders} mapping={mapping} setMapping={setMapping} />
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div data-testid="step-4">
            <h3 className="font-display font-semibold text-lg mb-2">Validate &amp; Run</h3>
            <p className="text-sm text-slate-500 mb-6">We&rsquo;ll check your CSVs before allocating. Errors block submission; warnings can be acknowledged.</p>
            {!validation && (
              <button onClick={validate} disabled={loading} data-testid="validate-button"
                className="inline-flex items-center gap-2 bg-[#0F172A] text-white font-semibold px-5 py-2.5 rounded-md hover:bg-slate-800 transition-colors">
                {loading ? "Validating…" : "Run validation"}
              </button>
            )}
            {validation && <ValidationReport v={validation} onRecheck={validate} />}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-6">
        <button onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-slate-600 disabled:opacity-40 hover:text-slate-900"
          data-testid="wizard-back">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button onClick={next} disabled={!canNext || loading} data-testid="wizard-next"
          className="inline-flex items-center gap-2 gradient-cta text-white font-semibold px-6 py-2.5 rounded-md disabled:opacity-50">
          {step === 4 ? (loading ? "Allocating…" : "Run allocation") : "Continue"} <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function CsvStep({ title, description, value, setValue, sample, testid }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const readFile = async (f) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name) && f.type !== "text/csv") {
      toast.error(`'${f.name}' doesn't look like a CSV file.`);
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      toast.error("File is over 25 MB — please trim it down first.");
      return;
    }
    const text = await f.text();
    setValue(text);
    toast.success(`Loaded ${f.name}`);
  };

  const onFile = async (e) => {
    await readFile(e.target.files?.[0]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    await readFile(e.dataTransfer.files?.[0]);
  };

  // Parse preview rows
  const parsePreview = (csvText) => {
    if (!csvText) return { headers: [], rows: [] };
    const lines = csvText.split("\n").slice(0, 6).filter((l) => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^["']|["']$/g, ""));
    const rows = lines.slice(1, 5).map((l) => l.split(",").map((c) => c.trim().replace(/^["']|["']$/g, "")));
    return { headers, rows };
  };
  const preview = parsePreview(value);
  const rowCount = Math.max(0, (value.match(/\n/g) || []).length);

  return (
    <div>
      <h3 className="font-display font-semibold text-lg">{title}</h3>
      <p className="text-sm text-slate-500 mt-1">{description}</p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`mt-4 rounded-md border-2 border-dashed transition-colors p-6 text-center ${
          dragOver ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-slate-50/40"
        }`}
        data-testid={`${testid}-dropzone`}
      >
        <FileUp className="h-7 w-7 text-slate-400 mx-auto" />
        <div className="mt-2 text-sm text-slate-600">
          <label className="inline-flex items-center gap-1.5 font-semibold text-emerald-700 hover:underline cursor-pointer">
            Click to upload
            <input ref={inputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} data-testid={`${testid}-file`} />
          </label>
          <span className="text-slate-500"> or drag &amp; drop a .csv here</span>
        </div>
        <div className="mt-2 text-xs text-slate-400">
          <button onClick={() => setValue(sample)} className="font-semibold text-emerald-700 hover:underline" data-testid={`${testid}-sample`}>
            Or use sample data
          </button>
          {value && (
            <>
              <span className="mx-2">·</span>
              <button onClick={() => setValue("")} className="font-semibold text-slate-500 hover:text-slate-800" data-testid={`${testid}-clear`}>
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {value && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
            <div className="font-semibold uppercase tracking-wider">Preview · first 4 rows</div>
            <div>{rowCount} data rows total</div>
          </div>
          <div className="border border-slate-200 rounded-md overflow-x-auto bg-white" data-testid={`${testid}-preview-table`}>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider">
                <tr>{preview.headers.map((h, i) => <th key={i} className="px-3 py-2 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {r.map((c, j) => <td key={j} className="px-3 py-1.5 font-mono whitespace-nowrap">{c}</td>)}
                  </tr>
                ))}
                {preview.rows.length === 0 && (
                  <tr><td className="px-3 py-3 text-slate-400" colSpan={Math.max(1, preview.headers.length)}>No data rows yet (headers only).</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <details className="mt-4">
        <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-800">Or paste raw CSV text</summary>
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={8} spellCheck={false}
          placeholder="Paste your CSV here…"
          className="mt-2 w-full border border-slate-200 rounded-md p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          data-testid={`${testid}-textarea`} />
      </details>
    </div>
  );
}

function MappingGroup({ title, fields, headers, mapping, setMapping }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 mb-3">{title}</div>
      {headers.length === 0 ? (
        <div className="text-xs text-slate-400 border border-dashed border-slate-200 rounded-md p-4">
          Paste or upload a CSV above to populate column options.
        </div>
      ) : null}
      <div className="space-y-3">
        {fields.map(([key, label, required]) => (
          <div key={key} className="flex items-center gap-3">
            <label className="text-sm text-slate-700 w-44">
              {label} {required && <span className="text-rose-500">*</span>}
            </label>
            <select value={mapping[key] || ""} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
              disabled={headers.length === 0}
              className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:bg-slate-50 disabled:text-slate-400"
              data-testid={`map-${key}`}>
              <option value="">— Select column —</option>
              {headers.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  );
}

function ValidationReport({ v, onRecheck }) {
  return (
    <div className="space-y-4" data-testid="validation-report">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Mini label="Bank rows" value={v.bank_row_count} />
        <Mini label="Invoice rows" value={v.invoice_row_count} />
        <Mini label="Errors" value={v.errors.length} tone={v.errors.length ? "rose" : "ok"} />
        <Mini label="Warnings" value={v.warnings.length} tone={v.warnings.length ? "amber" : "ok"} />
      </div>

      {Object.keys(v.coverage || {}).length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 mb-2">Column coverage</div>
          <div className="grid md:grid-cols-2 gap-2">
            {Object.entries(v.coverage).map(([k, val]) => (
              <div key={k} className="flex items-center gap-3 text-sm">
                <div className="w-44 text-slate-600">{k}</div>
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${val}%` }} />
                </div>
                <div className="w-12 text-right text-xs tabular-nums">{val}%</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {v.errors.length > 0 && (
        <div className="border border-rose-200 bg-rose-50 rounded-md p-4" data-testid="validation-errors">
          <div className="flex items-center gap-2 text-rose-800 font-semibold text-sm"><AlertCircle className="h-4 w-4" /> Errors</div>
          <ul className="mt-2 space-y-1 text-sm text-rose-900">
            {v.errors.map((e, i) => <li key={i}>• [{e.scope}] {e.message}</li>)}
          </ul>
        </div>
      )}
      {v.warnings.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 rounded-md p-4" data-testid="validation-warnings">
          <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm"><AlertCircle className="h-4 w-4" /> Warnings</div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {v.warnings.map((w, i) => <li key={i}>• [{w.scope}{w.row ? ` row ${w.row}` : ""}] {w.message}</li>)}
          </ul>
        </div>
      )}
      {v.ok && v.warnings.length === 0 && (
        <div className="border border-emerald-200 bg-emerald-50 rounded-md p-4 text-emerald-800 flex items-center gap-2" data-testid="validation-ok">
          <CheckCircle2 className="h-4 w-4" /> Looks good. Ready to run.
        </div>
      )}
      <button onClick={onRecheck} className="text-xs font-semibold text-slate-600 hover:underline">Re-run validation</button>
    </div>
  );
}

function Mini({ label, value, tone }) {
  const map = { rose: "bg-rose-50 text-rose-700 border-rose-200", amber: "bg-amber-50 text-amber-700 border-amber-200", ok: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  const cls = tone ? map[tone] : "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <div className={`border rounded-md p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold">{label}</div>
      <div className="font-display font-bold text-xl mt-1">{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
