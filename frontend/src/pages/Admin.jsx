/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V4 · Workbench · existing EB theme */
import React, { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Copy, Link2, ShieldCheck } from "lucide-react";
import { api, formatError } from "@/lib/api";
import { PageHeader } from "@/components/DesignSystem";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

const roles = { admin: "Client admin", user: "User", read_only: "Read-only" };
const kinds = { payer: "Payer / remitter", alias: "Company alias", reference: "Reference variation" };
const tabs = ["Mappings", "Users", "Client settings", "History"];
const emptyMapping = { kind: "payer", source_value: "", debtor_name: "", allocation_mode: "identify", active: true, notes: "", source: "", reason: "" };

function Field({ label, children, hint }) {
  return <label className="grid min-w-0 gap-2 text-sm font-medium">{label}{children}{hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}</label>;
}
function Status({ active }) {
  return <span className={`rounded border px-2 py-1 text-xs ${active ? "border-secondary text-secondary" : "text-muted-foreground"}`}>{active ? "Active" : "Inactive"}</span>;
}
function FormActions({ busy, onCancel, label = "Save changes" }) {
  return <div className="flex flex-wrap justify-end gap-3 pt-3"><button type="button" className="eb-button-secondary" disabled={busy} onClick={onCancel}>Cancel</button><button className="eb-button" disabled={busy}>{busy ? "Saving…" : label}</button></div>;
}

export default function Admin() {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState("");
  const [tab, setTab] = useState("Mappings");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [sharedLink, setSharedLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const client = clients.find((c) => c.id === clientId);

  const loadClients = useCallback(async () => {
    const { data: list } = await api.get("/admin/clients");
    setClients(list);
    setClientId((current) => list.some((c) => c.id === current) ? current : (list[0]?.id || ""));
  }, []);

  useEffect(() => { loadClients().catch((e) => setError(formatError(e))).finally(() => setLoading(false)); }, [loadClients]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setData([]);
    setError("");
    if (!clientId || tab === "Client settings") return undefined;
    setLoading(true);
    api.get(`/admin/clients/${clientId}/${tab.toLowerCase()}`).then(({ data: rows }) => {
      if (!cancelled) setData(rows);
    }).catch((e) => { if (!cancelled) setError(formatError(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [clientId, tab, refresh]);

  const open = (kind, record = {}) => { setFormError(""); setDialog({ kind, record }); };
  const close = () => { if (!busy) { setDialog(null); setSharedLink(null); setCopied(false); } };
  const save = async (values) => {
    setBusy(true); setFormError("");
    try {
      const base = `/admin/clients/${clientId}`;
      let response;
      if (dialog.kind === "client") {
        response = dialog.record.id
          ? await api.put(`/admin/clients/${dialog.record.id}`, { ...values, revision: dialog.record.revision || 0 })
          : await api.post("/admin/clients", values);
        await loadClients();
        setClientId(response.data.id);
      } else if (dialog.kind === "mapping") {
        response = dialog.record.id
          ? await api.put(`${base}/mappings/${dialog.record.id}`, { ...values, revision: dialog.record.revision })
          : await api.post(`${base}/mappings`, values);
      } else if (dialog.kind === "invite") {
        response = await api.post(`${base}/invitations`, values);
      } else if (dialog.kind === "access") {
        response = await api.put(`${base}/users/${dialog.record.id}`, { ...values, revision: dialog.record.revision || 0 });
      } else if (dialog.kind === "link") {
        response = await api.post(`${base}/users/${dialog.record.id}/links`, values);
      }
      if (response?.data?.token) {
        setSharedLink({ ...response.data, url: `${window.location.origin}/account-setup#token=${encodeURIComponent(response.data.token)}` });
        setCopied(false);
      } else {
        setDialog(null);
      }
      setNotice("Changes saved.");
      setRefresh((v) => v + 1);
    } catch (e) { setFormError(formatError(e)); }
    finally { setBusy(false); }
  };
  const switchClient = (id) => { setClientId(id); setData([]); setNotice(""); setDialog(null); setSharedLink(null); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(sharedLink.url); setCopied(true); }
    catch { setFormError("Copy is unavailable in this browser. Select and copy the link below."); }
  };

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader title="Client administration" description="Manage client access and the mappings used to identify debtors."
        action={<button className="eb-button" onClick={() => open("client")}><Plus className="h-4 w-4" />New client</button>} />
      <div className="flex items-start gap-3 rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-secondary" />
        <p>Client users own their financial data and allocations. All mapping-assisted allocations require their confirmation.</p>
      </div>
      <Field label="Selected client"><select aria-label="Selected client" className="eb-input w-full" value={clientId} onChange={(e) => switchClient(e.target.value)}>
        {!clients.length && <option value="">No clients yet</option>}
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active === false ? " (inactive)" : ""}</option>)}
      </select></Field>
      {error && <div role="alert" className="rounded border border-destructive p-3 text-destructive">{error}<button className="ml-3 underline" onClick={() => { loadClients().catch((e) => setError(formatError(e))); setRefresh((v) => v + 1); }}>Retry</button></div>}
      {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
      {client && <>
        <div className="flex flex-wrap items-center gap-3"><h2 className="min-w-0 break-words text-xl font-semibold">{client.name}</h2><Status active={client.active !== false} /></div>
        <div role="tablist" aria-label="Client administration sections" className="flex flex-wrap gap-2 border-b pb-3">
          {tabs.map((label) => <button key={label} role="tab" aria-selected={tab === label} aria-controls="client-panel" className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:opacity-80 ${tab === label ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`} onClick={() => { if (label !== tab) { setData([]); setLoading(label !== "Client settings"); setTab(label); setNotice(""); } }}>{label}</button>)}
        </div>
        <section id="client-panel" role="tabpanel" aria-label={tab} className="min-w-0 space-y-4">
          {tab === "Client settings" ? <div className="rounded-lg border bg-card p-5 space-y-4">
            <p className="break-words text-sm">Contact: {client.contact_email || "Not provided"}</p>
            <p className="text-sm text-muted-foreground">Deactivating a client blocks its users from signing in or using existing sessions. Stored financial records are retained.</p>
            <button className="eb-button-secondary" onClick={() => open("client", client)}><Pencil className="h-4 w-4" />Edit client</button>
          </div> : <>
            {tab === "Mappings" && <><div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-sm text-muted-foreground">Match complete payer names, aliases or reference phrases. FIFO permission allows a proposal across the oldest invoices; it never accepts it automatically.</p><button className="eb-button" onClick={() => open("mapping")}><Plus className="h-4 w-4" />Add mapping</button></div></>}
            {tab === "Users" && <button className="eb-button" disabled={client.active === false} onClick={() => open("invite")}><Plus className="h-4 w-4" />Invite user</button>}
            {loading ? <p role="status">Loading {tab.toLowerCase()}…</p> : !data.length ? <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">No {tab.toLowerCase()} for this client yet.</p> :
              tab === "Mappings" ? <div className="grid gap-3">{data.map((m) => <article key={m.id} className="min-w-0 rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><p className="text-xs text-muted-foreground">{kinds[m.kind]}</p><h3 className="mt-1 break-words font-semibold">{m.source_value}</h3><p className="mt-1 break-words text-sm">Debtor: {m.debtor_name}</p></div><button className="eb-button-secondary !h-9 !px-3" aria-label={`Edit mapping ${m.source_value}`} onClick={() => open("mapping", m)}><Pencil className="h-4 w-4" />Edit</button></div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><Status active={m.active} /><span>{m.allocation_mode === "fifo" ? "FIFO proposals permitted" : "Identification only"}</span><span className="text-muted-foreground">Version {m.revision}</span></div>
                <p className="mt-3 break-words text-xs text-muted-foreground">Source: {m.source}</p>{m.notes && <p className="mt-2 break-words text-sm">{m.notes}</p>}
              </article>)}</div> : tab === "Users" ? <div className="grid gap-3">{data.map((u) => <article key={u.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h3 className="break-words font-semibold">{u.name}</h3><p className="break-all text-sm text-muted-foreground">{u.email}</p></div><Status active={u.active !== false} /></div>
                <p className="mt-2 text-sm">{roles[u.role]}{u.account_state === "invited" ? " · Invitation pending" : ""}</p>
                <div className="mt-4 flex flex-wrap gap-2"><button className="eb-button-secondary !h-9 !px-3" onClick={() => open("access", u)}>Manage access</button><button className="eb-button-secondary !h-9 !px-3" disabled={u.active === false || client.active === false} onClick={() => open("link", u)}><Link2 className="h-4 w-4" />{u.account_state === "invited" ? "New invite link" : "Password reset"}</button></div>
              </article>)}</div> : <History events={data} />}
          </>}
        </section>
      </>}
      {!loading && !clients.length && !error && <p className="py-8 text-muted-foreground">Create a client to manage its users and matching mappings.</p>}
      <Dialog open={!!dialog} onOpenChange={(isOpen) => { if (!isOpen) close(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" onInteractOutside={(e) => { if (busy) e.preventDefault(); }}>
          <DialogHeader><DialogTitle>{sharedLink ? "Share secure account link" : ({ client: dialog?.record.id ? "Edit client" : "Create client", mapping: dialog?.record.id ? "Edit mapping" : "Add mapping", invite: "Invite client user", access: "Manage user access", link: "Create account link" }[dialog?.kind])}</DialogTitle>
            <DialogDescription>{dialog?.kind === "client" ? "Client setup changes are recorded in history." : `Client: ${client?.name || ""}`}</DialogDescription></DialogHeader>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          {sharedLink ? <div className="space-y-4"><p className="break-all text-sm">Share only with {sharedLink.email}. This single-use link expires {new Date(sharedLink.expires_at).toLocaleString()}. Creating another link invalidates this one.</p><textarea aria-label="Secure account link" readOnly className="eb-input min-h-28 w-full break-all text-xs" value={sharedLink.url} onFocus={(e) => e.target.select()} /><div className="flex flex-wrap gap-3"><button className="eb-button" onClick={copy}><Copy className="h-4 w-4" />{copied ? "Copied" : "Copy link"}</button><button className="eb-button-secondary" onClick={close}>Done</button></div>{copied && <p role="status" className="text-sm text-secondary">Link copied.</p>}</div> : dialog &&
            <Editor key={`${dialog.kind}-${dialog.record.id || "new"}`} kind={dialog.kind} record={dialog.record} busy={busy} onSave={save} onCancel={close} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Editor({ kind, record, busy, onSave, onCancel }) {
  const [values, setValues] = useState(() => {
    if (kind === "mapping") return Object.fromEntries(Object.keys(emptyMapping).map((key) => [key, key === "reason" ? "" : (record[key] ?? emptyMapping[key])]));
    if (kind === "client") return { name: record.name || "", contact_email: record.contact_email || "", active: record.active !== false, reason: "" };
    if (kind === "invite") return { name: "", email: "", role: "user", reason: "" };
    if (kind === "access") return { role: record.role, active: record.active !== false, reason: "" };
    return { purpose: record.account_state === "invited" ? "invite" : "reset", reason: "" };
  });
  const input = (key, options = {}) => <input className="eb-input w-full" required value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} {...options} />;
  const select = (key, options) => <select className="eb-input w-full" value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })}>{Object.entries(options).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>;
  return <form onSubmit={(e) => { e.preventDefault(); onSave(kind === "client" ? { ...values, contact_email: values.contact_email || null } : values); }} className="space-y-4">
    <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-60">
      {(kind === "client" || kind === "invite") && <Field label={kind === "client" ? "Client name" : "Full name"}>{input("name", { maxLength: 160 })}</Field>}
      {kind === "client" && <Field label="Contact email (optional)">{input("contact_email", { type: "email", required: false })}</Field>}
      {kind === "invite" && <Field label="Email address">{input("email", { type: "email", autoComplete: "off" })}</Field>}
      {(kind === "invite" || kind === "access") && <Field label="Client role">{select("role", roles)}</Field>}
      {kind === "access" && <p className="text-sm text-muted-foreground">Saving access changes revokes existing sessions and outstanding account links.</p>}
      {kind === "link" && <p className="break-words text-sm">Create a new {values.purpose === "invite" ? "invitation" : "password reset"} for {record.email}. You will receive a secure link to share manually.</p>}
      {kind === "mapping" && <>
        <Field label="Mapping type">{select("kind", kinds)}</Field>
        <Field label="Payer, alias or reference phrase" hint="Matches a complete phrase after normalizing case, punctuation and spacing.">{input("source_value", { minLength: 2, maxLength: 240 })}</Field>
        <Field label="Debtor name" hint="Use the debtor name as it appears in this client's invoice listing.">{input("debtor_name", { maxLength: 240 })}</Field>
        <Field label="Allocation permission">{select("allocation_mode", { identify: "Identification only", fifo: "FIFO proposals permitted" })}</Field>
        <p className="text-xs text-muted-foreground">Identification-only mappings may propose a single unambiguous invoice. FIFO may propose multiple invoices in oldest-first order. Both require client confirmation.</p>
        <Field label="Source" hint="For example: client confirmation, remittance advice, or a support reference.">{input("source", { maxLength: 240 })}</Field>
        <Field label="Notes (optional)"><textarea className="eb-input min-h-20 w-full" maxLength={2000} value={values.notes} onChange={(e) => setValues({ ...values, notes: e.target.value })} /></Field>
      </>}
      {["client", "mapping", "access"].includes(kind) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={values.active} onChange={(e) => setValues({ ...values, active: e.target.checked })} />Active</label>}
      <Field label="Reason for this change">{input("reason", { maxLength: 1000 })}</Field>
    </fieldset>
    <FormActions busy={busy} onCancel={onCancel} label={kind === "invite" ? "Create invitation" : kind === "link" ? "Create secure link" : "Save changes"} />
  </form>;
}

function History({ events }) {
  return <ol className="space-y-3">{events.map((event) => <li key={event.id} className="min-w-0 rounded-lg border bg-card p-4">
    <p className="break-words font-medium">{event.action.replaceAll("_", " ")} · {event.record}</p>
    <p className="mt-1 break-all text-xs text-muted-foreground">{event.actor_email} · {new Date(event.at).toLocaleString()}</p>
    <p className="mt-3 break-words text-sm">{event.reason}</p>
    <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">View changes</summary><dl className="mt-2 grid gap-2">{Object.keys(event.after || {}).filter((key) => JSON.stringify(event.before?.[key]) !== JSON.stringify(event.after[key])).map((key) => <div key={key} className="min-w-0 rounded bg-muted p-2"><dt className="font-medium">{key.replaceAll("_", " ")}</dt><dd className="break-words text-xs">{String(event.before?.[key] ?? "Not set")} → {String(event.after[key] ?? "Not set")}</dd></div>)}</dl></details>
  </li>)}</ol>;
}
