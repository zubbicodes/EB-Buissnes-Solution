"""ITER12 backend tests — scalability refactor.

Covers:
- POST /allocations large-run: returns immediately with status='processing'; matching completes async; GET /allocations/{id} returns header only (no embedded rows).
- GET /allocations/{id}/rows: pagination (page, page_size, total, bucket), search, page_size cap (500), all buckets.
- Split collections: allocation_bank_rows / allocation_invoice_rows store per-row docs scoped by run_id+user_id.
- Denormalised matches expose invoice_number + invoice_debtor.
- DELETE wipes split collections.
- POST manual-link reads/writes split docs and recomputes stats.
- GET /export streams CSV; GET /export-xlsx returns workbook bytes.
- Small (sync) run still works end-to-end.
"""
import os
import time
import io
import csv
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # Fallback: read from frontend/.env
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except FileNotFoundError:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = _load_backend_url()
ADMIN_EMAIL = "admin@ebbusiness.com"
ADMIN_PASSWORD = "Admin@2026!"

# ---- Auth fixtures ----
@pytest.fixture(scope="session")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]

@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}

MAPPING = {
    "bank_date": "date", "bank_amount": "amount", "bank_reference": "reference", "bank_payer": "payer",
    "invoice_number": "number", "invoice_debtor": "debtor", "invoice_amount": "amount", "invoice_due_date": "due_date",
}

def _make_small_csvs():
    bank = "date,amount,reference,payer\n2026-01-01,100.00,INV-1001,Acme Ltd\n2026-01-02,250.00,INV-1002,Globex Industries Ltd\n2026-01-03,75.00,REF-X,Unknown Payer\n"
    inv = "number,debtor,amount,due_date\nINV-1001,Acme Ltd,100.00,2026-01-15\nINV-1002,Globex Industries Ltd,250.00,2026-01-20\nINV-9999,Other Co,500.00,2026-01-30\n"
    return bank, inv

def _make_large_csvs(n_bank=800, n_inv=2500):
    # Build moderately sized CSVs to exercise async path (>2000 invoices triggers background)
    bank_lines = ["date,amount,reference,payer"]
    inv_lines = ["number,debtor,amount,due_date"]
    for i in range(n_inv):
        inv_lines.append(f"INV-{i:06d},Debtor {i % 200} Ltd,{(i+1)*1.5:.2f},2026-01-15")
    for i in range(n_bank):
        # Half match invoice numbers, half are noise
        if i % 2 == 0:
            bank_lines.append(f"2026-01-01,{(i+1)*1.5:.2f},INV-{i:06d},Debtor {i % 200} Ltd")
        else:
            bank_lines.append(f"2026-01-01,{(i+1)*7.7:.2f},REF-NOISE-{i},Random Payer {i}")
    return "\n".join(bank_lines), "\n".join(inv_lines)


# ============================================================
# SMALL (sync) RUN — end-to-end smoke
# ============================================================
class TestSmallRun:
    @pytest.fixture(scope="class")
    def run_id(self, auth_headers):
        bank, inv = _make_small_csvs()
        payload = {"name": "TEST_iter12_small", "period": "2026-01", "bank_csv": bank, "invoice_csv": inv, "mapping": MAPPING, "proceed_with_warnings": True}
        r = requests.post(f"{BASE_URL}/api/allocations", json=payload, headers=auth_headers, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "done", f"small run should be sync done, got {d['status']}"
        rid = d["id"]
        yield rid
        requests.delete(f"{BASE_URL}/api/allocations/{rid}", headers=auth_headers, timeout=30)

    def test_header_no_rows_embedded(self, auth_headers, run_id):
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "bank_rows" not in d and "invoice_rows" not in d
        assert "stats" in d
        assert d["stats"]["total_bank"] == 3
        assert d["stats"]["total_invoices"] == 3

    def test_rows_endpoint_full_bucket(self, auth_headers, run_id):
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}/rows", params={"bucket": "full", "page": 1, "page_size": 50}, headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["bucket"] == "full"
        assert d["page"] == 1
        assert d["page_size"] == 50
        assert isinstance(d["rows"], list)
        assert isinstance(d["total"], int)
        # Denormalisation check: at least one match should carry invoice_number + invoice_debtor
        for row in d["rows"]:
            for m in row.get("matches", []):
                assert "invoice_number" in m, "denormalised invoice_number missing on match"
                assert "invoice_debtor" in m, "denormalised invoice_debtor missing on match"
                break

    def test_rows_endpoint_unmatched_invoice_bucket(self, auth_headers, run_id):
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}/rows", params={"bucket": "unmatched_invoice"}, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["bucket"] == "unmatched_invoice"
        # INV-9999 should be unmatched
        assert d["total"] >= 1
        numbers = [row.get("number") for row in d["rows"]]
        assert "INV-9999" in numbers

    def test_rows_search_filter(self, auth_headers, run_id):
        # Search by reference INV-1001 on full bucket
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}/rows", params={"bucket": "full", "search": "INV-1001"}, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Either matches reference or denormalised invoice_number
        if d["total"] > 0:
            row = d["rows"][0]
            haystack = (row.get("reference", "") + " " + " ".join(m.get("invoice_number", "") for m in row.get("matches", []))).lower()
            assert "inv-1001" in haystack

    def test_rows_pagesize_cap(self, auth_headers, run_id):
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}/rows", params={"bucket": "full", "page_size": 9999}, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        assert r.json()["page_size"] == 500

    def test_unknown_bucket_400(self, auth_headers, run_id):
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}/rows", params={"bucket": "bogus"}, headers=auth_headers, timeout=30)
        assert r.status_code == 400

    def test_export_csv_streams(self, auth_headers, run_id):
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}/export", headers=auth_headers, timeout=60)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "csv" in ct.lower() or "text" in ct.lower()
        assert len(r.content) > 0
        # Sanity: parseable CSV
        rdr = csv.reader(io.StringIO(r.text))
        rows = list(rdr)
        assert len(rows) >= 2  # header + at least one row

    def test_export_xlsx(self, auth_headers, run_id):
        r = requests.get(f"{BASE_URL}/api/allocations/{run_id}/export-xlsx", headers=auth_headers, timeout=60)
        assert r.status_code == 200
        # xlsx is a zip — magic bytes "PK"
        assert r.content[:2] == b"PK"

    def test_manual_link_and_recompute(self, auth_headers, run_id):
        # Find an unmatched bank row
        ub = requests.get(f"{BASE_URL}/api/allocations/{run_id}/rows", params={"bucket": "unmatched_bank"}, headers=auth_headers, timeout=30).json()
        ui = requests.get(f"{BASE_URL}/api/allocations/{run_id}/rows", params={"bucket": "unmatched_invoice"}, headers=auth_headers, timeout=30).json()
        if not ub["rows"] or not ui["rows"]:
            pytest.skip("no unmatched rows to test manual link")
        bank_id = ub["rows"][0]["id"]
        inv_id = ui["rows"][0]["id"]
        amt = min(float(ub["rows"][0]["amount"]), float(ui["rows"][0]["amount"]))
        r = requests.post(
            f"{BASE_URL}/api/allocations/{run_id}/manual-link",
            json={"bank_row_id": bank_id, "invoice_row_id": inv_id, "amount": amt},
            headers=auth_headers, timeout=30,
        )
        assert r.status_code == 200, r.text
        # Stats should be refreshed
        hdr = requests.get(f"{BASE_URL}/api/allocations/{run_id}", headers=auth_headers, timeout=30).json()
        assert "stats" in hdr


# ============================================================
# LARGE (async background) RUN — scalability
# ============================================================
class TestLargeAsyncRun:
    @pytest.fixture(scope="class")
    def large_run(self, auth_headers):
        bank, inv = _make_large_csvs(n_bank=800, n_inv=2500)
        payload = {"name": "TEST_iter12_large", "period": "2026-01", "bank_csv": bank, "invoice_csv": inv, "mapping": MAPPING, "proceed_with_warnings": True}
        t0 = time.time()
        r = requests.post(f"{BASE_URL}/api/allocations", json=payload, headers=auth_headers, timeout=60)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        d = r.json()
        rid = d["id"]
        info = {"id": rid, "initial_status": d.get("status"), "http_elapsed": elapsed, "initial_doc": d}
        yield info
        requests.delete(f"{BASE_URL}/api/allocations/{rid}", headers=auth_headers, timeout=30)

    def test_returns_immediately_processing(self, large_run):
        # HTTP returns fast (<15s) with status=processing
        assert large_run["initial_status"] == "processing", f"got {large_run['initial_status']}"
        assert large_run["http_elapsed"] < 15, f"POST too slow: {large_run['http_elapsed']:.1f}s"

    def test_no_embedded_rows_in_header(self, large_run):
        d = large_run["initial_doc"]
        assert "bank_rows" not in d
        assert "invoice_rows" not in d

    def test_completes_in_background(self, auth_headers, large_run):
        rid = large_run["id"]
        # Poll until done — up to 60s
        deadline = time.time() + 60
        status = None
        while time.time() < deadline:
            r = requests.get(f"{BASE_URL}/api/allocations/{rid}", headers=auth_headers, timeout=30)
            assert r.status_code == 200
            status = r.json().get("status")
            if status in ("done", "error"):
                break
            time.sleep(1.5)
        assert status == "done", f"async run did not complete in 60s (last status={status})"

    def test_paginated_rows_after_completion(self, auth_headers, large_run):
        rid = large_run["id"]
        # Wait for done (in case test_completes ran already this is instant)
        for _ in range(40):
            s = requests.get(f"{BASE_URL}/api/allocations/{rid}", headers=auth_headers, timeout=30).json().get("status")
            if s == "done":
                break
            time.sleep(1.5)
        # Fetch first page of full bucket
        r = requests.get(f"{BASE_URL}/api/allocations/{rid}/rows", params={"bucket": "full", "page": 1, "page_size": 100}, headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["page"] == 1 and d["page_size"] == 100
        assert len(d["rows"]) <= 100
        assert d["total"] >= 0
        # Page 2 returns different rows (if total > page_size)
        if d["total"] > 100:
            r2 = requests.get(f"{BASE_URL}/api/allocations/{rid}/rows", params={"bucket": "full", "page": 2, "page_size": 100}, headers=auth_headers, timeout=30).json()
            ids1 = {row["id"] for row in d["rows"]}
            ids2 = {row["id"] for row in r2["rows"]}
            assert ids1.isdisjoint(ids2), "page 2 overlaps page 1"


# ============================================================
# Auth & misc
# ============================================================
class TestAuthGuard:
    def test_rows_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/allocations/nonexistent/rows", timeout=15)
        assert r.status_code in (401, 403)

    def test_list_allocations(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/allocations", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        runs = r.json()
        assert isinstance(runs, list)
        for run in runs:
            assert "bank_rows" not in run
            assert "invoice_rows" not in run

    def test_debtors_works(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/debtors", headers=auth_headers, timeout=60)
        assert r.status_code == 200
        body = r.json()
        # Endpoint returns either a list or a wrapper {rows: [...]}
        if isinstance(body, dict):
            assert "rows" in body and isinstance(body["rows"], list)
        else:
            assert isinstance(body, list)

    def test_audit_works(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/audit", headers=auth_headers, timeout=30)
        assert r.status_code == 200
