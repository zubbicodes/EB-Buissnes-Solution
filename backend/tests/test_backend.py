import os, uuid, requests, pytest

BASE = os.environ.get('REACT_APP_BACKEND_URL', 'http://localhost:8000').rstrip('/')
API = f"{BASE}/api"

BANK_CSV = """date,reference,amount,payer
2026-01-05,INV-1001 payment,1000.00,Acme Ltd
2026-01-06,INV1002,500.00,Beta Corp
2026-01-07,REF INV-1003,250.00,Gamma plc
2026-01-08,Payment 9999,750.00,Smithson Industries
2026-01-09,unknown ref,300.00,Mystery Co
"""
INV_CSV = """invoice,debtor,amount,date,outstanding
INV-1001,Acme Ltd,1000.00,2025-12-01,1000.00
INV-1002,Beta Corp,500.00,2025-12-02,500.00
INV-1003,Gamma plc,250.00,2025-12-03,250.00
INV-1004,Smithson Inc,750.00,2025-12-04,750.00
INV-1005,Delta Ltd,400.00,2025-12-05,400.00
"""
MAPPING = {"bank_date":"date","bank_reference":"reference","bank_amount":"amount","bank_payer":"payer",
           "invoice_number":"invoice","invoice_debtor":"debtor","invoice_amount":"amount","invoice_date":"date","invoice_outstanding":"outstanding"}

@pytest.fixture(scope="session")
def s1():
    s = requests.Session()
    email = f"test_{uuid.uuid4().hex[:8]}@ebbiz.com"
    r = s.post(f"{API}/auth/register", json={"email":email,"password":"test1234","name":"U1"})
    assert r.status_code == 200, r.text
    s.email = email
    return s

@pytest.fixture(scope="session")
def s2():
    s = requests.Session()
    email = f"test_{uuid.uuid4().hex[:8]}@ebbiz.com"
    r = s.post(f"{API}/auth/register", json={"email":email,"password":"test1234","name":"U2"})
    assert r.status_code == 200
    return s

def test_unauth_blocked():
    r = requests.get(f"{API}/allocations")
    assert r.status_code == 401

def test_me(s1):
    r = s1.get(f"{API}/auth/me")
    assert r.status_code == 200
    assert "password_hash" not in r.json()

def test_admin_login():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email":"admin@ebbusiness.com","password":"Admin@2026!"})
    assert r.status_code == 200
    assert "access_token" in s.cookies

def test_validate(s1):
    r = s1.post(f"{API}/allocations/validate", json={"bank_csv":BANK_CSV,"invoice_csv":INV_CSV,"mapping":MAPPING})
    assert r.status_code == 200
    d = r.json()
    assert "errors" in d and "warnings" in d and "coverage" in d
    assert d["bank_row_count"] == 5 and d["invoice_row_count"] == 5

@pytest.fixture(scope="session")
def run_id(s1):
    r = s1.post(f"{API}/allocations", json={"name":"Test Run","period":"2026-01","bank_csv":BANK_CSV,"invoice_csv":INV_CSV,"mapping":MAPPING,"proceed_with_warnings":True})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["stats"]["fully_matched"] >= 3
    return d["id"]

def test_list_isolation(s1, s2, run_id):
    r1 = s1.get(f"{API}/allocations"); assert r1.status_code == 200
    assert any(x["id"] == run_id for x in r1.json())
    r2 = s2.get(f"{API}/allocations"); assert r2.status_code == 200
    assert not any(x["id"] == run_id for x in r2.json())

def test_get_run(s1, run_id):
    r = s1.get(f"{API}/allocations/{run_id}")
    assert r.status_code == 200
    assert "bank_rows" in r.json() and "invoice_rows" in r.json()

def test_export(s1, run_id):
    r = s1.get(f"{API}/allocations/{run_id}/export")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type","")
    assert "Bank Date" in r.text

def test_export_xlsx(s1, run_id):
    r = s1.get(f"{API}/allocations/{run_id}/export-xlsx")
    assert r.status_code == 200
    ct = r.headers.get("content-type", "")
    assert "spreadsheetml" in ct or "officedocument" in ct, f"unexpected content-type: {ct}"
    # xlsx magic header is "PK\x03\x04"
    assert r.content[:4] == b"PK\x03\x04"
    assert len(r.content) > 2000

def test_manual_link(s1, run_id):
    run = s1.get(f"{API}/allocations/{run_id}").json()
    bu = next((b for b in run["bank_rows"] if b["status"]=="unmatched"), None)
    iu = next((i for i in run["invoice_rows"] if i["status"]=="unmatched"), None)
    if not (bu and iu): pytest.skip("no unmatched rows")
    r = s1.post(f"{API}/allocations/{run_id}/manual-link", json={"bank_row_id":bu["id"],"invoice_row_id":iu["id"],"amount":min(bu["remaining"],iu["remaining"])})
    assert r.status_code == 200
    assert "stats" in r.json()

def test_compare(s1, run_id):
    r2 = s1.post(f"{API}/allocations", json={"name":"R2","period":"2026-02","bank_csv":BANK_CSV,"invoice_csv":INV_CSV,"mapping":MAPPING,"proceed_with_warnings":True})
    assert r2.status_code == 200
    rid2 = r2.json()["id"]
    r = s1.get(f"{API}/compare", params={"run_ids": f"{run_id},{rid2}"})
    assert r.status_code == 200
    d = r.json()
    assert "rows" in d and "consistently_unmatched" in d and len(d["runs"])==2

def test_debtors(s1):
    r = s1.get(f"{API}/debtors", params={"threshold":100})
    assert r.status_code == 200
    d = r.json()
    assert "rows" in d and "flagged_count" in d
    r2 = s1.get(f"{API}/debtors/export", params={"threshold":100})
    assert r2.status_code == 200 and "Debtor" in r2.text

def test_audit(s1, run_id):
    r = s1.get(f"{API}/audit")
    assert r.status_code == 200
    d = r.json()
    assert d["summary"]["create_run"] >= 1
    r2 = s1.get(f"{API}/audit", params={"run_id":run_id})
    assert r2.status_code == 200
    assert all(l["run_id"]==run_id for l in r2.json()["logs"])

def test_logout(s2):
    r = s2.post(f"{API}/auth/logout"); assert r.status_code == 200
    s2.cookies.clear()
    r2 = s2.get(f"{API}/auth/me"); assert r2.status_code == 401

def test_delete(s1, run_id):
    r = s1.delete(f"{API}/allocations/{run_id}")
    assert r.status_code == 200
    r2 = s1.get(f"{API}/allocations/{run_id}")
    assert r2.status_code == 404
