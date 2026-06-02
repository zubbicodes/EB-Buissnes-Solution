"""End-to-end test that the Excel export does not blow up on large allocations.

We seed an allocation with 6,000 bank rows + 6,000 invoice rows (well past the
2,000-row async threshold), wait for async processing to complete, then call
/export-xlsx and assert:
  1. The HTTP status is 200 with the correct xlsx Content-Type.
  2. The download streams (Content-Length header present, body > 50 KB).
  3. The downloaded file is a valid xlsx zip (PK signature on first bytes).

If this test passes we know openpyxl write-only mode + chunked streaming is
actually working for big runs.
"""
import os
import io
import time
import uuid
import zipfile
import requests
import pytest


def _backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                return ln.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = _backend_url()
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
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    s.headers.update({"Authorization": f"Bearer {r.json()['access_token']}", "Content-Type": "application/json"})
    return s


def _build_csvs(n_bank: int, n_inv: int):
    bank_lines = ["Date,Amount,Reference,Payer"]
    for i in range(1, n_bank + 1):
        bank_lines.append(f"2026-01-{(i % 28) + 1:02d},{(100 + i % 900):.2f},Payment for INV-{i:05d},Customer {i % 200}")
    inv_lines = ["Date,Ref,Name,Amount,Outstanding"]
    for i in range(1, n_inv + 1):
        amt = (100 + i % 900)
        inv_lines.append(f"2025-12-{(i % 28) + 1:02d},INV-{i:05d},Customer {i % 200} Ltd,{amt:.2f},{amt:.2f}")
    return "\n".join(bank_lines), "\n".join(inv_lines)


def test_export_xlsx_large_run(client):
    bank_csv, inv_csv = _build_csvs(6000, 6000)
    body = {
        "name": f"XL_export_{uuid.uuid4().hex[:6]}",
        "period": "2026-01",
        "bank_csv": bank_csv,
        "invoice_csv": inv_csv,
        "mapping": MAPPING,
        "proceed_with_warnings": True,
    }
    r = client.post(f"{API}/allocations", json=body, timeout=60)
    assert r.status_code == 200, r.text
    run = r.json()
    run_id = run["id"]
    # Large runs go async — wait until status==done
    waited = 0
    while True:
        h = client.get(f"{API}/allocations/{run_id}", timeout=30)
        assert h.status_code == 200
        if h.json().get("status") == "done":
            break
        assert h.json().get("status") != "error", h.json()
        time.sleep(2)
        waited += 2
        assert waited <= 120, f"async run did not finish in 120s"

    # Now download xlsx
    t0 = time.time()
    resp = client.get(f"{API}/allocations/{run_id}/export-xlsx", timeout=180, stream=True)
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("content-type", "").startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ), resp.headers

    # Should have a Content-Length and the stream should yield > 50 KB
    cl = resp.headers.get("content-length")
    assert cl is not None and int(cl) > 50_000, f"Content-Length suspiciously small: {cl}"

    body_bytes = resp.content
    elapsed = time.time() - t0
    assert len(body_bytes) == int(cl), f"body {len(body_bytes)} != content-length {cl}"
    assert body_bytes[:2] == b"PK", "Not a valid xlsx (missing zip PK header)"

    # Open as xlsx to assert structure is parseable
    zf = zipfile.ZipFile(io.BytesIO(body_bytes))
    names = zf.namelist()
    assert "[Content_Types].xml" in names, names
    assert any(n.startswith("xl/worksheets/sheet") for n in names), names
    print(f"OK — xlsx={len(body_bytes)} bytes, elapsed={elapsed:.1f}s")
