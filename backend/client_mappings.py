"""Client-owned matching evidence. Mappings never commit financial allocations."""
import re
import unicodedata


def normalize_label(value):
    value = unicodedata.normalize("NFKC", value or "").casefold()
    return " ".join(re.findall(r"[^\W_]+", value, flags=re.UNICODE))


def mapping_hits(bank, mappings):
    payer = normalize_label(bank.get("payer"))
    reference = normalize_label(bank.get("reference"))
    hits = []
    for item in mappings:
        if not item.get("active", True):
            continue
        value = normalize_label(item["source_value"])
        sources = [payer] if item["kind"] == "payer" else ([reference] if item["kind"] == "reference" else [payer, reference])
        # Match a complete normalized phrase, never a fuzzy or partial company token.
        if value and any(f" {value} " in f" {source} " for source in sources):
            hits.append(item)
    return hits


def propose_mapped_allocation(bank, invoices, mappings, fifo_plan, proposal_links):
    """Return whether a mapping handled this bank row; leave all balances untouched."""
    hits = mapping_hits(bank, mappings)
    if not hits:
        return False
    targets = {normalize_label(item["debtor_name"]) for item in hits}
    evidence = {
        "debtor_match_type": "client_mapping",
        "mapping_ids": [item["id"] for item in hits],
        "mapping_versions": [item["revision"] for item in hits],
        "mapping_sources": [item["source_value"] for item in hits],
        "mapped_debtors": sorted({item["debtor_name"] for item in hits}),
        "ambiguous": len(targets) != 1,
    }
    links = []
    if len(targets) != 1:
        reason = "Conflicting client mappings identify different debtors; manual review required"
    else:
        target = next(iter(targets))
        candidates = [i for i in invoices if normalize_label(i.get("debtor")) == target and i["remaining"] > 0.005]
        # Overlapping mappings use the most restrictive permission.
        fifo = all(item["allocation_mode"] == "fifo" for item in hits)
        evidence["fifo_permitted"] = fifo
        if not fifo and len(candidates) > 1:
            candidates = [i for i in candidates if abs(i["remaining"] - bank["remaining"]) <= 0.005]
            if len(candidates) != 1:
                candidates = []
        if candidates and bank["remaining"] > 0.005:
            plan = fifo_plan(bank["remaining"], candidates)
            evidence["amount_evidence"] = "fifo_proposal" if fifo else "single_invoice_proposal"
            reason = f"Client mapping identifies {hits[0]['debtor_name']}; {'FIFO proposal' if fifo else 'single-invoice proposal'} requires client confirmation"
            links = proposal_links(bank, plan, "client_mapping", "medium", reason)
            for link in links:
                link["mapping_evidence"] = [{"id": item["id"], "revision": item["revision"]} for item in hits]
        else:
            evidence["amount_evidence"] = "identification_only"
            reason = f"Client mapping identifies {hits[0]['debtor_name']}; select an invoice manually (no unambiguous permitted proposal)"
    evidence["decision_reason"] = reason
    bank.update({"status": "partial", "decision": "suggest", "confidence": "medium",
                 "reason": reason, "suggestions": links, "evidence": {**bank.get("evidence", {}), **evidence}})
    return True
