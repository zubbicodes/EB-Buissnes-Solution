"""Tests for new /api/auth/refresh endpoint and updated cookie TTLs (7d access / 30d refresh)."""
import os
import requests
import pytest

BASE = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@ebbusiness.com"
ADMIN_PASS = "Admin@2026!"


def _login_admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s, r


def test_login_sets_cookies_with_expected_ttls():
    s, r = _login_admin()
    # raw Set-Cookie headers should include Max-Age=604800 (7d) and Max-Age=2592000 (30d)
    set_cookie_headers = r.headers.get("set-cookie", "")
    # When multiple Set-Cookie headers exist, requests concatenates them with comma
    # Use raw via r.raw.headers if available
    raw = r.headers
    # Use getlist via requests structures.CaseInsensitiveDict; try .raw
    all_cookies = []
    try:
        all_cookies = r.raw.headers.getlist("Set-Cookie")  # type: ignore
    except Exception:
        all_cookies = [set_cookie_headers]
    joined = " | ".join(all_cookies) if all_cookies else set_cookie_headers
    assert "access_token=" in joined and "refresh_token=" in joined, joined
    assert "Max-Age=604800" in joined, f"missing 7d max-age, got: {joined}"
    assert "Max-Age=2592000" in joined, f"missing 30d max-age, got: {joined}"
    assert "access_token" in s.cookies and "refresh_token" in s.cookies


def test_refresh_endpoint_with_valid_cookie_returns_user_and_new_cookies():
    s, _ = _login_admin()
    # call refresh; should return user + new cookies
    r = s.post(f"{API}/auth/refresh")
    assert r.status_code == 200, r.text
    data = r.json()
    # response should be user-shaped
    assert ("email" in data) or ("user" in data), data
    user = data.get("user", data)
    assert user.get("email") == ADMIN_EMAIL
    # new cookies set
    try:
        all_cookies = r.raw.headers.getlist("Set-Cookie")  # type: ignore
    except Exception:
        all_cookies = [r.headers.get("set-cookie", "")]
    joined = " | ".join(all_cookies)
    assert "access_token=" in joined and "refresh_token=" in joined
    assert "Max-Age=604800" in joined
    assert "Max-Age=2592000" in joined


def test_refresh_endpoint_without_cookie_returns_401():
    s = requests.Session()  # no cookies
    r = s.post(f"{API}/auth/refresh")
    assert r.status_code == 401
    body = r.json()
    detail = body.get("detail", "")
    assert "refresh" in detail.lower() or "no refresh token" in detail.lower(), body


def test_me_works_with_login_cookies():
    s, _ = _login_admin()
    r = s.get(f"{API}/auth/me")
    assert r.status_code == 200
    assert r.json().get("email") == ADMIN_EMAIL
