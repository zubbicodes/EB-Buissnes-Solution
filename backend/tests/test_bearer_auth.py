"""
Regression tests for Bearer token auth (token in JSON body + Authorization: Bearer header).
Verifies login/register return access_token in body and protected endpoints accept Bearer header without cookies.
"""
import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")

ADMIN_EMAIL = "admin@ebbusiness.com"
ADMIN_PASSWORD = "Admin@2026!"


@pytest.fixture(scope="module")
def admin_token():
    # Plain requests (no Session) to avoid carrying cookies
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                      timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body, f"access_token missing in body: {body}"
    assert isinstance(body["access_token"], str) and len(body["access_token"]) > 20
    assert "refresh_token" in body
    assert isinstance(body["refresh_token"], str) and len(body["refresh_token"]) > 20
    assert body.get("email") == ADMIN_EMAIL
    return body["access_token"]


# --- LOGIN body tests ---
def test_login_returns_access_token_in_body(admin_token):
    assert admin_token  # set by fixture


def test_register_returns_access_token_in_body():
    import uuid
    email = f"TEST_bearer_{uuid.uuid4().hex[:8]}@ebbiz.com"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": "test1234", "name": "Bearer Test"},
                      timeout=15)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body and len(body["access_token"]) > 20
    assert "refresh_token" in body and len(body["refresh_token"]) > 20
    assert body.get("email", "").lower() == email.lower()


# --- Protected endpoints with Bearer only (no cookies) ---
def _bearer_get(path, token):
    return requests.get(f"{BASE_URL}{path}",
                        headers={"Authorization": f"Bearer {token}"},
                        timeout=15)


def test_auth_me_with_bearer_only(admin_token):
    r = _bearer_get("/api/auth/me", admin_token)
    assert r.status_code == 200, f"/auth/me with Bearer failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("email") == ADMIN_EMAIL


def test_allocations_list_with_bearer_only(admin_token):
    r = _bearer_get("/api/allocations", admin_token)
    assert r.status_code == 200, f"/allocations with Bearer failed: {r.status_code} {r.text}"
    assert isinstance(r.json(), list)


def test_preview_headers_with_bearer_only(admin_token):
    # POST endpoint, still must accept Bearer only
    csv_text = "Date,Amount,Reference,Narrative\n2026-01-05,1200.00,INV-1001,Acme Corp\n"
    r = requests.post(f"{BASE_URL}/api/allocations/preview-headers",
                      headers={"Authorization": f"Bearer {admin_token}",
                               "Content-Type": "application/json"},
                      json={"csv_text": csv_text},
                      timeout=15)
    assert r.status_code == 200, f"/allocations/preview-headers Bearer failed: {r.status_code} {r.text}"
    data = r.json()
    assert "headers" in data or "columns" in data or isinstance(data, dict)


def test_protected_endpoint_without_auth_returns_401():
    r = requests.get(f"{BASE_URL}/api/auth/me", timeout=15)
    assert r.status_code == 401


def test_protected_endpoint_with_invalid_bearer_returns_401():
    r = _bearer_get("/api/auth/me", "invalid.token.here")
    assert r.status_code == 401
