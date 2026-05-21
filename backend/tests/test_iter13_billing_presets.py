"""ITER13 backend tests — billing (Stripe), presets, quota enforcement, async search.

Covers:
- (b) GET /api/allocations/{id}/rows?bucket=unmatched_bank|unmatched_invoice&search= — server-side filter
- (c) GET /api/mapping/presets — 6 built-in IDs
- (d) POST /api/mapping/presets — 402 Pro gating for Starter
- (e) POST /api/billing/checkout pro_monthly — Stripe Session URL + session_id
- (e) GET /api/billing/status/{session_id} — txn shape
- (e) GET /api/billing/plan — tier+usage+pricing
- QUOTA — Starter user 5001-row run returns 402 QUOTA_EXCEEDED; sub-5000 succeeds + increments
"""
import os
import uuid
import pytest
import requests


def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    with open("/app/frontend/.env") as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE_URL = _load_backend_url()
ADMIN_EMAIL = "admin@ebbusiness.com"
ADMIN_PASSWORD = "Admin@2026!"

MAPPING = {
    "bank_date": "date", "bank_amount": "amount", "bank_reference": "reference", "bank_payer": "payer",
    "invoice_number": "number", "invoice_debtor": "debtor", "invoice_amount": "amount", "invoice_due_date": "due_date",
}

BUILTIN_IDS = {
    "barclays_business", "hsbc_uk", "lloyds_uk",
    "xero_aged_debtors", "sage_aged_debtors", "quickbooks_aged",
}


# ---------- Auth fixtures ----------
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="session")
def starter_user():
    """Create a fresh starter (free) user for quota/preset gating tests."""
    email = f"TEST_starter_{uuid.uuid4().hex[:10]}@ebbiz.com"
    password = "TestPass@2026!"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": password, "name": "Starter Tester"}, timeout=30)
    assert r.status_code in (200, 201), f"register failed: {r.status_code} {r.text}"
    body = r.json()
    return {"email": email, "password": password, "token": body["access_token"]}


@pytest.fixture(scope="session")
def starter_headers(starter_user):
    return {"Authorization": f"Bearer {starter_user['token']}"}


# ---------- (e) Billing / Plan ----------
class TestBillingPlan:
    def test_plan_shape(self, starter_headers):
        r = requests.get(f"{BASE_URL}/api/billing/plan", headers=starter_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("tier", "pro_until", "row_usage_this_month", "row_limit_starter", "pricing"):
            assert k in data, f"missing key {k} in /billing/plan"
        assert data["tier"] == "starter"
        assert data["row_limit_starter"] == 5000
        assert "pro_monthly" in data["pricing"]
        assert data["pricing"]["pro_monthly"]["amount"] == 49.0
        assert data["pricing"]["pro_monthly"]["currency"] == "gbp"

    def test_me_decorated(self, starter_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=starter_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("tier") == "starter"
        assert data.get("row_limit_starter") == 5000
        assert "row_usage_this_month" in data


class TestBillingCheckout:
    def test_unknown_package(self, starter_headers):
        r = requests.post(f"{BASE_URL}/api/billing/checkout",
                          headers=starter_headers,
                          json={"package_id": "bogus_pkg", "origin_url": BASE_URL}, timeout=30)
        assert r.status_code == 400

    def test_pro_monthly_creates_session(self, starter_headers):
        r = requests.post(f"{BASE_URL}/api/billing/checkout",
                          headers=starter_headers,
                          json={"package_id": "pro_monthly", "origin_url": BASE_URL}, timeout=60)
        assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text}"
        data = r.json()
        assert "url" in data and data["url"].startswith("https://"), data
        assert "session_id" in data and isinstance(data["session_id"], str) and len(data["session_id"]) > 5
        # cache session_id on the class for status test
        TestBillingCheckout.session_id = data["session_id"]

    def test_status_endpoint(self, starter_headers):
        sid = getattr(TestBillingCheckout, "session_id", None)
        if not sid:
            pytest.skip("checkout session not created")
        r = requests.get(f"{BASE_URL}/api/billing/status/{sid}", headers=starter_headers, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        # Should echo session id and have known payment_status field
        assert data.get("session_id") == sid
        assert "payment_status" in data
        # Unpaid session, so user must still be starter
        me = requests.get(f"{BASE_URL}/api/auth/me", headers=starter_headers, timeout=30).json()
        assert me["tier"] == "starter"

    def test_status_unknown_session_404(self, starter_headers):
        r = requests.get(f"{BASE_URL}/api/billing/status/cs_does_not_exist_xyz",
                         headers=starter_headers, timeout=30)
        assert r.status_code == 404


# ---------- (c)(d) Mapping Presets ----------
class TestMappingPresets:
    def test_list_built_in(self, starter_headers):
        r = requests.get(f"{BASE_URL}/api/mapping/presets", headers=starter_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "built_in" in data and "saved" in data
        ids = {p["id"] for p in data["built_in"]}
        assert ids == BUILTIN_IDS, f"unexpected built-in ids: {ids}"
        # Each preset has label, scope, mapping
        for p in data["built_in"]:
            assert {"id", "label", "scope", "mapping"} <= set(p.keys())
            assert p["scope"] in ("bank", "invoice", "both")
            assert isinstance(p["mapping"], dict) and p["mapping"]
        assert isinstance(data["saved"], list)

    def test_save_preset_starter_402(self, starter_headers):
        r = requests.post(f"{BASE_URL}/api/mapping/presets",
                          headers=starter_headers,
                          json={"label": "TEST_mybank", "scope": "bank",
                                "mapping": {"bank_date": "Date"}}, timeout=30)
        assert r.status_code == 402, f"expected 402 (Pro gate), got {r.status_code}: {r.text}"
        body = r.json()
        # FastAPI HTTPException -> {"detail": "..."}
        assert "detail" in body and "Pro" in str(body["detail"])

    def test_admin_pro_can_save_and_delete(self, admin_headers):
        # Admin in this app is starter by default unless granted pro_until.
        # If admin is starter, save should 402 too — that's still proof of correct gating.
        save_r = requests.post(f"{BASE_URL}/api/mapping/presets",
                               headers=admin_headers,
                               json={"label": "TEST_admin_preset",
                                     "scope": "bank",
                                     "mapping": {"bank_date": "Date"}}, timeout=30)
        if save_r.status_code == 402:
            pytest.skip("admin is starter-tier in this env; 402 gate already verified by starter test")
        assert save_r.status_code == 200, save_r.text
        pid = save_r.json()["id"]
        # Confirm in list
        lst = requests.get(f"{BASE_URL}/api/mapping/presets", headers=admin_headers, timeout=30).json()
        assert any(p["id"] == pid for p in lst["saved"])
        # Delete
        d = requests.delete(f"{BASE_URL}/api/mapping/presets/{pid}", headers=admin_headers, timeout=30)
        assert d.status_code == 200


# ---------- QUOTA ----------
def _build_csvs(n_bank=10, n_inv=10):
    bank_lines = ["date,amount,reference,payer"]
    for i in range(n_bank):
        bank_lines.append(f"2026-01-{(i%28)+1:02d},{100+i}.00,REF-{i:05d},Payer {i}")
    inv_lines = ["number,debtor,amount,due_date"]
    for i in range(n_inv):
        inv_lines.append(f"INV-{i:05d},Debtor {i},{100+i}.00,2026-02-15")
    return "\n".join(bank_lines) + "\n", "\n".join(inv_lines) + "\n"


class TestQuota:
    created_run_ids = []

    def test_sub_5k_succeeds_and_increments_usage(self, starter_user, starter_headers):
        # 200 bank + 200 invoice = 400 rows total, well under 5000
        bank, inv = _build_csvs(200, 200)
        before = requests.get(f"{BASE_URL}/api/billing/plan", headers=starter_headers, timeout=30).json()
        before_usage = before["row_usage_this_month"]
        payload = {
            "name": f"TEST_quota_small_{uuid.uuid4().hex[:6]}",
            "period": "2026-01",
            "mapping": MAPPING,
            "bank_csv": bank,
            "invoice_csv": inv,
            "proceed_with_warnings": True,
        }
        r = requests.post(f"{BASE_URL}/api/allocations", headers=starter_headers, json=payload, timeout=120)
        assert r.status_code == 200, f"allocation failed: {r.status_code} {r.text}"
        run = r.json()
        assert "id" in run
        TestQuota.created_run_ids.append(run["id"])
        after = requests.get(f"{BASE_URL}/api/billing/plan", headers=starter_headers, timeout=30).json()
        # usage should have grown by 400
        assert after["row_usage_this_month"] - before_usage == 400, \
            f"expected +400 usage, got before={before_usage} after={after['row_usage_this_month']}"

    def test_over_5k_returns_402_quota_exceeded(self, starter_user, starter_headers):
        # Fresh starter who already used 400 from previous test => 4601+ more bank/inv rows will breach 5k.
        # Build 5001 bank rows + 1 invoice = 5002 rows total — guaranteed over.
        bank, inv = _build_csvs(5001, 1)
        payload = {
            "name": f"TEST_quota_big_{uuid.uuid4().hex[:6]}",
            "period": "2026-01",
            "mapping": MAPPING,
            "bank_csv": bank,
            "invoice_csv": inv,
            "proceed_with_warnings": True,
        }
        r = requests.post(f"{BASE_URL}/api/allocations", headers=starter_headers, json=payload, timeout=120)
        assert r.status_code == 402, f"expected 402 QUOTA_EXCEEDED, got {r.status_code}: {r.text[:400]}"
        body = r.json()
        detail = body.get("detail") or {}
        # detail may be wrapped if FastAPI passes dict
        assert isinstance(detail, dict), f"expected dict detail, got: {detail}"
        assert detail.get("code") == "QUOTA_EXCEEDED"
        assert detail.get("limit") == 5000
        assert detail.get("would_add", 0) >= 5002

    @classmethod
    def teardown_class(cls):
        # Best-effort cleanup
        # (We don't have starter_headers here easily, but admin can't delete starter's runs.
        #  The runs will be left in place; they're name-prefixed TEST_ and small.)
        pass


# ---------- (b) Async search on /rows ----------
class TestRowsSearch:
    """Use admin user (likely already has runs in prod env). Create a fresh small run to assert
    search filtering deterministically against unmatched buckets."""

    @pytest.fixture(scope="class")
    def small_run_id(self, admin_headers):
        bank = (
            "date,amount,reference,payer\n"
            "2026-01-05,123.45,UNIQ-ALPHA-001,Alpha Corp\n"
            "2026-01-06,200.00,UNIQ-BETA-002,Beta Holdings\n"
            "2026-01-07,99.99,RANDREF-XYZ,Gamma Ltd\n"
        )
        inv = (
            "number,debtor,amount,due_date\n"
            "INV-Z-9001,Zeta Industries,500.00,2026-02-01\n"
            "INV-Z-9002,Eta Partners,777.00,2026-02-02\n"
        )
        payload = {
            "name": f"TEST_search_{uuid.uuid4().hex[:6]}",
            "period": "2026-01",
            "mapping": MAPPING,
            "bank_csv": bank,
            "invoice_csv": inv,
            "proceed_with_warnings": True,
        }
        r = requests.post(f"{BASE_URL}/api/allocations", headers=admin_headers, json=payload, timeout=60)
        assert r.status_code == 200, r.text
        run_id = r.json()["id"]
        yield run_id
        # cleanup
        requests.delete(f"{BASE_URL}/api/allocations/{run_id}", headers=admin_headers, timeout=30)

    def test_unmatched_bank_search_filters(self, admin_headers, small_run_id):
        # All three bank rows are unmatched (no matching invoices).
        r_all = requests.get(
            f"{BASE_URL}/api/allocations/{small_run_id}/rows",
            params={"bucket": "unmatched_bank", "page_size": 25},
            headers=admin_headers, timeout=30,
        )
        assert r_all.status_code == 200, r_all.text
        all_rows = r_all.json()["rows"]
        assert len(all_rows) == 3

        # Search 'ALPHA' should only match UNIQ-ALPHA-001 / Alpha Corp
        r = requests.get(
            f"{BASE_URL}/api/allocations/{small_run_id}/rows",
            params={"bucket": "unmatched_bank", "search": "ALPHA", "page_size": 25},
            headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["bucket"] == "unmatched_bank"
        assert data["total"] == 1, data
        assert "ALPHA" in (data["rows"][0].get("reference") or "").upper() \
            or "ALPHA" in (data["rows"][0].get("payer") or "").upper()

    def test_unmatched_bank_search_case_insensitive(self, admin_headers, small_run_id):
        r = requests.get(
            f"{BASE_URL}/api/allocations/{small_run_id}/rows",
            params={"bucket": "unmatched_bank", "search": "beta", "page_size": 25},
            headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["total"] == 1

    def test_unmatched_invoice_search_filters(self, admin_headers, small_run_id):
        r_all = requests.get(
            f"{BASE_URL}/api/allocations/{small_run_id}/rows",
            params={"bucket": "unmatched_invoice", "page_size": 25},
            headers=admin_headers, timeout=30,
        ).json()
        assert r_all["total"] == 2

        r = requests.get(
            f"{BASE_URL}/api/allocations/{small_run_id}/rows",
            params={"bucket": "unmatched_invoice", "search": "Zeta", "page_size": 25},
            headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["total"] == 1
        assert "Zeta" in (data["rows"][0].get("debtor") or "")

    def test_unmatched_invoice_search_no_match(self, admin_headers, small_run_id):
        r = requests.get(
            f"{BASE_URL}/api/allocations/{small_run_id}/rows",
            params={"bucket": "unmatched_invoice", "search": "NOPENADA"},
            headers=admin_headers, timeout=30,
        )
        assert r.status_code == 200
        assert r.json()["total"] == 0
