"""
Backend tests for the Explainable Allocation Review Layer.

What we assert:
  1. Each match link carries invoice_amount, invoice_outstanding_before,
     invoice_outstanding_after.
  2. Canonical reason vocabulary is used per pass:
       - Pass 1 exact: 'Exact invoice reference detected'
       - Pass 1 suffix: 'Partial invoice reference detected'
       - Pass 2: 'Debtor name similarity'
       - Pass 2.5: 'Token-substring match'
       - Manual: 'Manual allocation'
  3. Matching hierarchy is enforced:
       - When Pass 1 hits, no Pass 2 / Pass 2.5 match is added on the same row.
  4. Outstanding-after equals (outstanding-before - allocated).
"""

import os
import uuid
import requests
import pytest


def _resolve_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if url:
        return url.rstrip("/")
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE = _resolve_base_url()
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@ebbusiness.com"
ADMIN_PASSWORD = "Admin@2026!"

MAPPING = {
    "bank_date": "Date",
    "bank_reference": "Reference",
    "bank_amount": "Amount",
    "bank_payer": "Payer",
    "invoice_number": "Ref",
    "invoice_debtor": "Name",
    "invoice_amount": "Amount",
    "invoice_date": "Date",
    "invoice_outstanding": "Outstanding",
}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.text}"
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _create_run(client, bank_csv, inv_csv, name="explain"):
    body = {
        "name": f"{name}_{uuid.uuid4().hex[:6]}",
        "period": "2026-01",
        "bank_csv": bank_csv,
        "invoice_csv": inv_csv,
        "mapping": MAPPING,
        "proceed_with_warnings": True,
    }
    r = client.post(f"{API}/allocations", json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _fetch_rows(client, run_id, bucket):
    r = client.get(f"{API}/allocations/{run_id}/rows", params={"bucket": bucket, "page": 1, "page_size": 500}, timeout=30)
    assert r.status_code == 200
    return r.json().get("rows", [])


def _find_bank(client, run_id, contains):
    for bucket in ("full", "partial", "unmatched_bank"):
        for b in _fetch_rows(client, run_id, bucket):
            if contains.lower() in (b.get("reference") or "").lower():
                return b
    return None


# ---------- Pass 1 (exact reference) — enriched fields & vocabulary ----------
def test_pass1_exact_reference_enrichment(client):
    bank = "Date,Amount,Reference,Payer\n2026-01-05,1200.00,Payment for INV-9001,Acme Ltd\n"
    inv = "Date,Ref,Name,Amount,Outstanding\n2025-12-01,INV-9001,Acme Limited,1200.00,1200.00\n"
    run = _create_run(client, bank, inv)
    b = _find_bank(client, run["id"], "INV-9001")
    assert b is not None, "Bank row not returned"
    assert b["status"] == "full"
    assert len(b["matches"]) == 1
    m = b["matches"][0]
    assert m["method"] == "reference"
    assert "Exact invoice reference detected" in m["reason"]
    # New enriched fields
    assert m["invoice_amount"] == 1200.00
    assert m["invoice_outstanding_before"] == 1200.00
    assert m["invoice_outstanding_after"] == 0.0


# ---------- Pass 1 (suffix) — partial reference detected ----------
def test_pass1_suffix_reference_enrichment(client):
    # Bank ref "9002" only matches suffix of invoice "INV-9002"
    bank = "Date,Amount,Reference,Payer\n2026-01-05,500.00,deposit ref 9002 cleared,Foo\n"
    inv = "Date,Ref,Name,Amount,Outstanding\n2025-12-01,INV-9002,Foo Ltd,500.00,500.00\n"
    run = _create_run(client, bank, inv)
    b = _find_bank(client, run["id"], "9002")
    assert b is not None
    refs = [m for m in b["matches"] if m["method"] == "reference"]
    assert refs, "expected a reference match"
    m = refs[0]
    assert "Partial invoice reference detected" in m["reason"]
    assert m["ref_kind"] == "partial"
    assert m["invoice_amount"] == 500.00
    assert m["invoice_outstanding_before"] == 500.00
    assert m["invoice_outstanding_after"] == 0.0


# ---------- Pass 2 (debtor name) — enrichment + canonical wording ----------
def test_pass2_debtor_name_enrichment(client):
    # No invoice ref in bank text — should fall to Pass 2 fuzzy debtor name
    bank = "Date,Amount,Reference,Payer\n2026-01-05,500.00,Globex Corx Transfer,\n"
    inv = "Date,Ref,Name,Amount,Outstanding\n2025-12-01,INV-9101,Globex Corp Ltd,500.00,500.00\n"
    run = _create_run(client, bank, inv)
    b = _find_bank(client, run["id"], "Globex")
    assert b is not None, f"bank row missing for Globex"
    assert b["matches"], "expected at least one match"
    debtor_matches = [m for m in b["matches"] if m["method"] == "debtor_name"]
    assert debtor_matches, f"expected pass-2 debtor_name match, got {[m['method'] for m in b['matches']]}"
    m = debtor_matches[0]
    assert "Debtor name similarity" in m["reason"]
    assert "score" in m and isinstance(m["score"], (int, float))
    # enriched fields
    assert m["invoice_amount"] == 500.00
    assert m["invoice_outstanding_before"] == 500.00
    assert abs(m["invoice_outstanding_after"] - 0.0) < 0.01


# ---------- Matching hierarchy — Pass 1 wins; Pass 2 not added ----------
def test_hierarchy_pass1_blocks_pass2(client):
    # Bank text contains explicit invoice ref AND a similar debtor name to a DIFFERENT invoice.
    # The hierarchy rule must prevent the unrelated debtor-name invoice from being added.
    bank = "Date,Amount,Reference,Payer\n2026-01-05,200.00,Payment INV-7777 Acme,Acme Limited\n"
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-7777,Beta Ltd,200.00,200.00\n"          # ref-match target (different debtor)
        "2025-12-02,INV-7778,Acme Limited,200.00,200.00\n"      # debtor-fuzzy temptation
    )
    run = _create_run(client, bank, inv)
    b = _find_bank(client, run["id"], "INV-7777")
    assert b is not None
    # Only the reference-matched invoice should be present.
    assert all(m["method"] == "reference" for m in b["matches"]), \
        f"hierarchy violated: {[m['method'] for m in b['matches']]}"
    assert all(m.get("invoice_number") == "INV-7777" for m in b["matches"])


# ---------- Manual allocation enriches link with the new fields too ----------
def test_manual_allocation_enrichment(client):
    bank = "Date,Amount,Reference,Payer\n2026-01-05,800.00,unrelated text,\n"
    inv = "Date,Ref,Name,Amount,Outstanding\n2025-12-01,INV-9201,Zelda Plc,800.00,800.00\n"
    run = _create_run(client, bank, inv)
    rid = run["id"]
    bank_row = _find_bank(client, rid, "unrelated")
    invs = _fetch_rows(client, rid, "unmatched_invoice")
    target = next((i for i in invs if i["number"] == "INV-9201"), None)
    assert target is not None
    r = client.post(
        f"{API}/allocations/{rid}/manual-link",
        json={"bank_row_id": bank_row["id"], "invoice_row_id": target["id"], "amount": 800.0},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    # Refetch and assert manual link carries the new explainability fields
    b2 = _find_bank(client, rid, "unrelated")
    assert b2 is not None
    manual = [m for m in b2["matches"] if m["method"] == "manual"]
    assert manual, "manual link missing"
    m = manual[0]
    assert m["reason"] == "Manual allocation"
    assert m["invoice_amount"] == 800.00
    assert m["invoice_outstanding_before"] == 800.00
    assert m["invoice_outstanding_after"] == 0.0


# ---------- Outstanding-after arithmetic is consistent ----------
def test_outstanding_after_arithmetic(client):
    # Single bank payment of 600 against an invoice with 1000 outstanding -> after=400
    bank = "Date,Amount,Reference,Payer\n2026-01-05,600.00,INV-9301 partial pay,\n"
    inv = "Date,Ref,Name,Amount,Outstanding\n2025-12-01,INV-9301,Beta Ltd,1000.00,1000.00\n"
    run = _create_run(client, bank, inv)
    b = _find_bank(client, run["id"], "INV-9301")
    assert b is not None
    m = b["matches"][0]
    assert m["amount"] == 600.00
    assert m["invoice_amount"] == 1000.00
    assert m["invoice_outstanding_before"] == 1000.00
    assert m["invoice_outstanding_after"] == 400.00
