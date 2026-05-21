"""
Backend regression tests for the strict finance-grade classification overhaul.
Rules under test:
  Rule A — FULL: pure reference match(es), bank row fully consumed
  Rule B — FULL: single debtor match with score>=95 + exact amount + non-ambiguous
  Otherwise (with any match) => PARTIAL (suggested)
  No match => UNMATCHED
Plus assertions for new fields: reason (str), score (number), ambiguous (bool),
confidence (high/medium/low), and threshold (>=70 fuzzy candidates).
"""

import os
import uuid
import pytest
import requests

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


BASE_URL = _resolve_base_url()
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
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body
    return body["access_token"]


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    return s


def _run(client, bank_csv, invoice_csv, name="TEST_strict"):
    payload = {
        "name": f"{name}_{uuid.uuid4().hex[:6]}",
        "period": "2026-01",
        "bank_csv": bank_csv,
        "invoice_csv": invoice_csv,
        "mapping": MAPPING,
        "proceed_with_warnings": True,
    }
    r = client.post(f"{BASE_URL}/api/allocations", json=payload, timeout=30)
    assert r.status_code == 200, f"create alloc failed: {r.status_code} {r.text}"
    run = r.json()
    # rows now live in split collections — fetch them all via paginated /rows endpoint
    run["bank_rows"] = _fetch_all_bank_rows(client, run["id"])
    return run


def _fetch_all_bank_rows(client, run_id):
    rows = []
    for bucket in ("full", "partial", "unmatched_bank"):
        page = 1
        while True:
            r = client.get(
                f"{BASE_URL}/api/allocations/{run_id}/rows",
                params={"bucket": bucket, "page": page, "page_size": 500},
                timeout=30,
            )
            assert r.status_code == 200, f"rows fetch failed: {r.status_code} {r.text}"
            body = r.json()
            rows.extend(body.get("rows", []))
            if len(rows) >= body.get("total", 0) or not body.get("rows"):
                break
            page += 1
            if page > 50:
                break
    return rows


def _find_bank(run, contains):
    for b in run["bank_rows"]:
        if contains.lower() in (b.get("reference") or "").lower():
            return b
    return None


# -------------------- Rule A: pure reference + exact amount --------------------
def test_full_pure_reference_exact_amount(client):
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,1200.00,Payment for INV-2001,Acme Ltd\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-2001,Acme Limited,1200.00,1200.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "INV-2001")
    assert b is not None
    assert b["status"] == "full", f"expected full, got {b['status']} reason={b.get('reason')}"
    assert b["confidence"] == "high"
    assert "Invoice reference" in b["reason"]
    assert "fully consumed" in b["reason"]
    assert len(b["matches"]) == 1
    assert b["matches"][0]["method"] == "reference"


# -------------------- Rule B disabled: debtor-only 90% < 95 => PARTIAL --------
def test_partial_debtor_fuzzy_90(client):
    # Single invoice, single bank row, debtor name only, ~90% similarity, exact amount
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,500.00,Globex Corx,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-9001,Globex Corp Ltd,500.00,500.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "Globex")
    assert b is not None, f"bank row missing; rows={run['bank_rows']}"
    # Not a 'full' classification because score < 95 (after stripping corp suffix
    # we expect medium ~ 85-94 range)
    assert b["status"] == "partial", f"expected partial, got {b['status']} reason={b.get('reason')}"
    # confidence is medium or low (must NOT be high for debtor-only sub-95 match)
    assert b["confidence"] in ("medium", "low")
    assert any(m["method"] == "debtor_name" for m in b["matches"])
    m = b["matches"][0]
    assert "score" in m and isinstance(m["score"], (int, float))
    assert "ambiguous" in m and isinstance(m["ambiguous"], bool)
    assert "Debtor name similarity" in b["reason"]


# -------------------- Ambiguity: multiple plausible candidates -> PARTIAL ----
def test_partial_ambiguous_multiple_candidates(client):
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,300.00,Smith,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-3001,Smith Holdings Ltd,300.00,300.00\n"
        "2025-12-02,INV-3002,Smith Trading Ltd,300.00,300.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "Smith")
    assert b is not None
    assert b["status"] == "partial"
    assert any(m.get("ambiguous") is True for m in b["matches"])
    assert "multiple candidates" in b["reason"].lower()


# -------------------- Unmatched: no ref, no debtor >= 70 ---------------------
def test_unmatched_no_signal(client):
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,42.00,A AND J WAST LTD FMQ,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-7001,Zenith Pharma Plc,1500.00,1500.00\n"
        "2025-12-02,INV-7002,Northgate Logistics,750.00,750.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "WAST")
    assert b is not None
    assert b["status"] == "unmatched", f"expected unmatched, got {b['status']} reason={b.get('reason')}"
    assert b["confidence"] is None
    assert "No invoice reference detected" in b["reason"]
    assert b["matches"] == []


# -------------------- Reference but amount > invoice -> PARTIAL --------------
def test_partial_ref_amount_overflow(client):
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,2000.00,Payment INV-4001,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-4001,Beta Ltd,1500.00,1500.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "INV-4001")
    assert b is not None
    # Bank row has 500 remaining after consuming the 1500 invoice -> not fully consumed -> PARTIAL
    assert b["status"] == "partial", f"expected partial got {b['status']} reason={b.get('reason')}"
    assert "unallocated" in b["reason"].lower() or "partial" in b["reason"].lower()


# -------------------- New per-row reason field is always present -------------
def test_reason_field_present_all_rows(client):
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,100.00,INV-8001,\n"
        "2026-01-06,250.00,RANDOM TEXT,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-8001,Foo Ltd,100.00,100.00\n"
    )
    run = _run(client, bank, inv)
    for b in run["bank_rows"]:
        assert "reason" in b and isinstance(b["reason"], str) and b["reason"], \
            f"row missing reason: {b}"


# -------------------- Stats still computed correctly -------------------------
def test_stats_consistent(client):
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,1200.00,INV-5001 paid,\n"        # FULL (rule A)
        "2026-01-06,500.00,Globex Corx,\n"            # PARTIAL (debtor 90)
        "2026-01-07,75.00,nothing here,\n"            # UNMATCHED
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-5001,Acme Limited,1200.00,1200.00\n"
        "2025-12-02,INV-5002,Globex Corp Ltd,500.00,500.00\n"
    )
    run = _run(client, bank, inv)
    stats = run["stats"]
    assert stats["total_bank"] == 3
    assert stats["fully_matched"] >= 1
    assert stats["unmatched_bank"] >= 1
