"""Tests for the 6 new features in iteration 5:
- Drag-and-drop / file upload (frontend-only — skipped here)
- Row preview table (frontend-only)
- Extra optional column mappings (Bank Account, Transaction Type, Due Date, Customer Reference)
- Fuzzy debtor name match against combined reference + payer, threshold 80, WRatio + strip_corp_suffix
- Async processing for runs > 5000 rows (BackgroundTasks)
- Validation diagnostics: invalid date warnings + missing debtor warning
"""

import os, time, uuid, requests, pytest

BASE = (os.environ.get('REACT_APP_BACKEND_URL') or 'https://bank-reconcile-37.preview.emergentagent.com').rstrip('/')
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def sess():
    s = requests.Session()
    email = f"test_feat_{uuid.uuid4().hex[:8]}@ebbiz.com"
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "test1234", "name": "FeatU"})
    assert r.status_code == 200, r.text
    return s


# ---------- Extra column mappings accepted by backend ----------
def test_extra_optional_column_mappings_accepted(sess):
    bank = ("date,reference,amount,payer,account,txn_type\n"
            "2026-01-05,INV-1001,1000.00,Acme Ltd,12345678,BACS\n"
            "2026-01-06,INV-1002,500.00,Beta Corp,12345678,FPS\n")
    inv = ("invoice,debtor,amount,date,outstanding,due_date,customer_ref\n"
           "INV-1001,Acme Ltd,1000.00,2025-12-01,1000.00,2026-01-31,CUST001\n"
           "INV-1002,Beta Corp,500.00,2025-12-02,500.00,2026-02-15,CUST002\n")
    mapping = {
        "bank_date": "date", "bank_reference": "reference", "bank_amount": "amount", "bank_payer": "payer",
        "bank_account": "account", "bank_transaction_type": "txn_type",
        "invoice_number": "invoice", "invoice_debtor": "debtor", "invoice_amount": "amount",
        "invoice_date": "date", "invoice_outstanding": "outstanding",
        "invoice_due_date": "due_date", "invoice_customer_reference": "customer_ref",
    }
    r = sess.post(f"{API}/allocations/validate", json={"bank_csv": bank, "invoice_csv": inv, "mapping": mapping})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["bank_row_count"] == 2 and d["invoice_row_count"] == 2
    # validation should pass without errors
    assert d.get("ok") is True or d.get("ok", True), f"validation should accept extra fields: {d}"


# ---------- Fuzzy debtor matching with WRatio + strip_corp_suffix, threshold 80 ----------
FUZZY_BANK = ("date,reference,amount,payer\n"
              "2026-01-05,INV-3001 BACS payment,200.00,Bright Sparks\n"
              "2026-01-06,Globex Industries Ltd transfer,300.00,\n"
              "2026-01-07,Payment from Acme Corp,400.00,\n"
              "2026-01-08,Random transfer xyz,150.00,\n")

FUZZY_INV = ("invoice,debtor,amount,date,outstanding\n"
             "INV-3001,Bright Sparks Ltd,200.00,2025-12-01,200.00\n"
             "INV-9001,Globex Industries Ltd,300.00,2025-12-02,300.00\n"
             "INV-9002,Acme Corporation Ltd,400.00,2025-12-03,400.00\n"
             "INV-9003,Zeta Holdings plc,150.00,2025-12-04,150.00\n")

FUZZY_MAPPING = {
    "bank_date": "date", "bank_reference": "reference", "bank_amount": "amount", "bank_payer": "payer",
    "invoice_number": "invoice", "invoice_debtor": "debtor", "invoice_amount": "amount",
    "invoice_date": "date", "invoice_outstanding": "outstanding",
}


def _fetch_all_rows(sess, run_id):
    """Helper: load full bank/invoice row sets via paginated /rows."""
    bank_rows = []
    for bucket in ("full", "partial", "unmatched_bank"):
        page = 1
        while True:
            r = sess.get(f"{API}/allocations/{run_id}/rows",
                         params={"bucket": bucket, "page": page, "page_size": 500})
            r.raise_for_status()
            body = r.json()
            bank_rows.extend(body.get("rows") or [])
            if len(body.get("rows") or []) < 500:
                break
            page += 1
    inv_rows = []
    page = 1
    while True:
        r = sess.get(f"{API}/allocations/{run_id}/rows",
                     params={"bucket": "unmatched_invoice", "page": page, "page_size": 500})
        r.raise_for_status()
        body = r.json()
        inv_rows.extend(body.get("rows") or [])
        if len(body.get("rows") or []) < 500:
            break
        page += 1
    return bank_rows, inv_rows


def test_fuzzy_matching_combined_reference_and_payer(sess):
    r = sess.post(f"{API}/allocations", json={
        "name": "TEST_Fuzzy", "period": "2026-01",
        "bank_csv": FUZZY_BANK, "invoice_csv": FUZZY_INV, "mapping": FUZZY_MAPPING,
        "proceed_with_warnings": True,
    })
    assert r.status_code == 200, r.text
    d = r.json()
    run_id = d["id"]

    # Get the run to inspect matches
    bank_rows, _inv_rows_unmatched = _fetch_all_rows(sess, run_id)

    def find_bank(snippet):
        return next(b for b in bank_rows if snippet in (b.get("reference") or ""))

    # 1) INV-3001 BACS payment → reference pass matches Bright Sparks Ltd (high)
    b1 = find_bank("INV-3001")
    assert b1["status"] == "full", f"INV-3001 should be fully matched via reference, got {b1}"
    assert any(m.get("confidence") == "high" for m in b1["matches"])

    # 2) Globex Industries Ltd transfer → fuzzy match against Globex Industries Ltd
    # Under strict rules (post iter9), pure debtor-name match needs score>=95 + exact amount + unique for FULL.
    # WRatio scores ~90 for this pair → PARTIAL/medium (suggested allocation requiring review). Either is acceptable.
    b2 = find_bank("Globex")
    assert b2["status"] in ("full", "partial"), f"Globex should be matched (full or partial), got {b2}"
    assert any(m.get("confidence") in ("medium", "high") for m in b2["matches"])

    # 3) Payment from Acme Corp → fuzzy match Acme Corporation Ltd
    # Under strict rules, this also surfaces as PARTIAL or FULL depending on WRatio. Accept either.
    b3 = find_bank("Acme Corp")
    assert b3["status"] in ("full", "partial"), f"Acme Corp should match Acme Corporation Ltd, got matches={b3.get('matches')}"

    # 4) Random transfer xyz → should remain unmatched (threshold 80)
    b4 = find_bank("Random transfer")
    assert b4["status"] == "unmatched", f"Random transfer should be unmatched, got {b4}"

    # cleanup
    sess.delete(f"{API}/allocations/{run_id}")


# ---------- Validation: invalid date warnings + missing debtor warning ----------
def test_validation_invalid_date_and_missing_debtor(sess):
    bank = ("date,reference,amount,payer\n"
            "2026-01-05,INV-1,100.00,A Ltd\n"
            "not-a-date,INV-2,200.00,B Ltd\n"
            "13/45/2026,INV-3,300.00,C Ltd\n"
            "bad-date,INV-4,150.00,D Ltd\n"
            "2026-02-99,INV-5,250.00,E Ltd\n")
    inv = ("invoice,debtor,amount,date,outstanding\n"
           "INV-1,Acme Ltd,100.00,2025-12-01,100.00\n"
           "INV-2,,200.00,2025-12-02,200.00\n"
           "INV-3,Gamma plc,300.00,not-a-date,300.00\n")
    mapping = {
        "bank_date": "date", "bank_reference": "reference", "bank_amount": "amount", "bank_payer": "payer",
        "invoice_number": "invoice", "invoice_debtor": "debtor", "invoice_amount": "amount",
        "invoice_date": "date", "invoice_outstanding": "outstanding",
    }
    r = sess.post(f"{API}/allocations/validate", json={"bank_csv": bank, "invoice_csv": inv, "mapping": mapping})
    assert r.status_code == 200, r.text
    d = r.json()
    warnings_text = " ".join(w.get("message", "") if isinstance(w, dict) else str(w) for w in d.get("warnings", []))
    # invalid date format warning + capped at 3 examples per scope
    assert "date" in warnings_text.lower(), f"expected invalid date warning, got {warnings_text}"
    # missing debtor warning
    assert "debtor" in warnings_text.lower(), f"expected missing debtor warning, got {warnings_text}"
    # Verify cap at 3 examples for invalid date: only 3 per-row bank date warnings (not 4)
    bank_date_warnings = [w for w in d["warnings"] if isinstance(w, dict) and w.get("scope") == "bank" and "Unrecognised" in w.get("message", "")]
    assert len(bank_date_warnings) <= 3, f"per-row date warnings should be capped at 3, got {len(bank_date_warnings)}"


# ---------- Async branch for > 5000 rows ----------
def _gen_large_csvs(n_bank=5200, n_inv=5500):
    bank_lines = ["date,reference,amount,payer"]
    for i in range(n_bank):
        bank_lines.append(f"2026-01-{(i%28)+1:02d},INV-{i:05d},{100 + (i%100)}.00,Payer{i%50}")
    inv_lines = ["invoice,debtor,amount,date,outstanding"]
    for i in range(n_inv):
        inv_lines.append(f"INV-{i:05d},Debtor{i%200} Ltd,{100 + (i%100)}.00,2025-12-{(i%28)+1:02d},{100 + (i%100)}.00")
    return "\n".join(bank_lines) + "\n", "\n".join(inv_lines) + "\n"


def test_async_processing_large_run(sess):
    bank_csv, inv_csv = _gen_large_csvs()
    mapping = {
        "bank_date": "date", "bank_reference": "reference", "bank_amount": "amount", "bank_payer": "payer",
        "invoice_number": "invoice", "invoice_debtor": "debtor", "invoice_amount": "amount",
        "invoice_date": "date", "invoice_outstanding": "outstanding",
    }
    r = sess.post(f"{API}/allocations", json={
        "name": "TEST_LargeAsync", "period": "2026-01",
        "bank_csv": bank_csv, "invoice_csv": inv_csv, "mapping": mapping,
        "proceed_with_warnings": True,
    }, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    run_id = d["id"]
    # Should return immediately with status=processing
    assert d.get("status") == "processing", f"expected status=processing, got {d.get('status')}"

    # Poll up to 60s for completion
    final_status = None
    for _ in range(60):
        g = sess.get(f"{API}/allocations/{run_id}")
        assert g.status_code == 200
        final_status = g.json().get("status")
        if final_status in ("done", "error"):
            break
        time.sleep(1)
    assert final_status == "done", f"async run did not finish, status={final_status}"

    # Validate stats populated
    g2 = sess.get(f"{API}/allocations/{run_id}").json()
    assert g2["stats"]["total_bank"] == 5200
    assert g2["stats"]["total_invoices"] == 5500
    assert g2["stats"]["fully_matched"] > 0

    sess.delete(f"{API}/allocations/{run_id}")


def test_small_run_is_synchronous(sess):
    """Small runs should return status=done immediately (no async)."""
    r = sess.post(f"{API}/allocations", json={
        "name": "TEST_SmallSync", "period": "2026-01",
        "bank_csv": FUZZY_BANK, "invoice_csv": FUZZY_INV, "mapping": FUZZY_MAPPING,
        "proceed_with_warnings": True,
    })
    assert r.status_code == 200
    d = r.json()
    assert d.get("status") == "done", f"expected sync done, got {d.get('status')}"
    bank_rows, _ = _fetch_all_rows(sess, d["id"])
    assert len(bank_rows) == 4
    sess.delete(f"{API}/allocations/{d['id']}")
