"""Client-owned matching evidence and explicitly approved allocation permissions."""
import re
import unicodedata


def normalize_label(value):
    value = unicodedata.normalize("NFKC", value or "").casefold()
    return " ".join(re.findall(r"[^\W_]+", value, flags=re.UNICODE))


def prepare_mappings(mappings):
    """Normalize a run's mapping snapshot once instead of once per bank row."""
    prepared = []
    for item in mappings or []:
        if not item.get("active", True):
            continue
        copy = dict(item)
        copy["_source_normalized"] = normalize_label(item.get("source_value"))
        copy["_debtor_normalized"] = normalize_label(item.get("debtor_name"))
        prepared.append(copy)
    return prepared


def phrase_in_text(phrase, text):
    """Match a normalized complete phrase anywhere inside a wider narrative."""
    return bool(phrase and f" {phrase} " in f" {text} ")


def mapping_hits(bank, mappings):
    payer = normalize_label(bank.get("payer"))
    reference = normalize_label(bank.get("reference"))
    hits = []
    for item in mappings:
        if not item.get("active", True):
            continue
        value = item.get("_source_normalized") or normalize_label(item["source_value"])
        # Real bank exports do not use "payer" and "reference" consistently:
        # the remittance narrative may be in either imported field. Reference
        # variations therefore inspect both, while payer mappings stay strict.
        sources = [payer] if item["kind"] == "payer" else [reference, payer]
        # Match the complete normalized phrase within the wider narrative. This
        # deliberately ignores changing suffixes such as EREF and UETR values.
        if any(phrase_in_text(value, source) for source in sources):
            hits.append(item)
    return hits


def propose_mapped_allocation(bank, invoices_by_debtor, mappings, fifo_plan, proposal_links, commit_plan):
    """Apply the configured mapping permission and return whether it handled the row."""
    hits = mapping_hits(bank, mappings)
    if not hits:
        return False
    targets = {item.get("_debtor_normalized") or normalize_label(item["debtor_name"]) for item in hits}
    modes = {item.get("allocation_mode", "identify") for item in hits}
    # Overlapping mappings use the most restrictive permission.
    auto_fifo = modes == {"fifo_auto"}
    fifo_allowed = modes.issubset({"fifo", "fifo_auto"})
    effective_mode = "fifo_auto" if auto_fifo else ("fifo" if fifo_allowed else "identify")
    evidence = {
        "debtor_match_type": "client_mapping",
        "mapping_ids": [item["id"] for item in hits],
        "mapping_versions": [item["revision"] for item in hits],
        "mapping_sources": [item["source_value"] for item in hits],
        "mapped_debtors": sorted({item["debtor_name"] for item in hits}),
        "mapping_allocation_mode": effective_mode,
        "ambiguous": len(targets) != 1,
    }
    links = []
    status = "partial"
    decision = "suggest"
    if len(targets) != 1:
        reason = "Conflicting client mappings identify different debtors; manual review required"
    else:
        target = next(iter(targets))
        debtor_invoices = invoices_by_debtor.get(target, ())
        has_open_balance = any(i["remaining"] > 0.005 for i in debtor_invoices)
        candidates = debtor_invoices if fifo_allowed and has_open_balance else [i for i in debtor_invoices if i["remaining"] > 0.005]
        evidence["fifo_permitted"] = fifo_allowed
        evidence["fifo_auto_permitted"] = auto_fifo
        if not fifo_allowed and len(candidates) > 1:
            candidates = [i for i in candidates if abs(i["remaining"] - bank["remaining"]) <= 0.005]
            if len(candidates) != 1:
                candidates = []
        if candidates and bank["remaining"] > 0.005:
            plan = fifo_plan(bank["remaining"], candidates, presorted=fifo_allowed)
            mapping_evidence = [{"id": item["id"], "revision": item["revision"]} for item in hits]
            if auto_fifo:
                reason = f"Approved client mapping identifies {hits[0]['debtor_name']}; allocated automatically using FIFO"
                first_match = len(bank["matches"])
                commit_plan(bank, plan, "client_mapping", "high", reason)
                for link in bank["matches"][first_match:]:
                    link["mapping_evidence"] = mapping_evidence
                bank.update({
                    "status": "full" if bank["remaining"] <= 0.005 else "overpaid",
                    "decision": "auto_match",
                    "confidence": "high",
                    "confidence_score": 100.0,
                    "reason": reason if bank["remaining"] <= 0.005 else f"{reason}; unallocated payment balance remains",
                })
                if bank["remaining"] > 0.005:
                    bank["overpaid_amount"] = bank["remaining"]
                evidence["amount_evidence"] = "fifo_auto_allocation"
                evidence["decision_reason"] = bank["reason"]
                bank["evidence"] = {**bank.get("evidence", {}), **evidence}
                return True
            evidence["amount_evidence"] = "fifo_proposal" if fifo_allowed else "single_invoice_proposal"
            reason = f"Client mapping identifies {hits[0]['debtor_name']}; {'FIFO proposal' if fifo_allowed else 'single-invoice proposal'} requires client confirmation"
            links = proposal_links(bank, plan, "client_mapping", "medium", reason)
            for link in links:
                link["mapping_evidence"] = mapping_evidence
        else:
            if not has_open_balance:
                status = "unmatched"
                decision = "no_match"
                evidence["amount_evidence"] = "no_open_balance"
                reason = f"Client mapping identifies {hits[0]['debtor_name']}, but no open invoice balance is available"
            else:
                evidence["amount_evidence"] = "identification_only"
                reason = f"Client mapping identifies {hits[0]['debtor_name']}; select an invoice manually (no unambiguous permitted proposal)"
    evidence["decision_reason"] = reason
    bank.update({"status": status, "decision": decision, "confidence": "medium",
                 "reason": reason, "suggestions": links, "evidence": {**bank.get("evidence", {}), **evidence}})
    return True
