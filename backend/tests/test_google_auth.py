import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "receivables_test")
os.environ.setdefault("JWT_SECRET", "test-secret")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import HTTPException, Response

import server


class FakeUsers:
    def __init__(self, users=None):
        self.users = {u["email"]: dict(u) for u in (users or [])}
        self.updated = []

    async def find_one(self, query, projection=None):
        if "email" in query:
            user = self.users.get(query["email"])
        elif "id" in query:
            user = next((u for u in self.users.values() if u["id"] == query["id"]), None)
        else:
            user = None
        return dict(user) if user else None

    async def insert_one(self, doc):
        self.users[doc["email"]] = dict(doc)
        return None

    async def update_one(self, query, update):
        user = await self.find_one(query)
        if user:
            user.update(update.get("$set", {}))
            self.users[user["email"]] = user
            self.updated.append((query, update))
        return None


class FakeDB:
    def __init__(self, users=None):
        self.users = FakeUsers(users)


def run_google_auth(monkeypatch, google_payload, users=None, client_id="google-client"):
    fake_db = FakeDB(users)
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "GOOGLE_CLIENT_ID", client_id)
    monkeypatch.setattr(
        server.google_id_token,
        "verify_oauth2_token",
        lambda credential, request, audience: google_payload,
    )
    response = Response()
    result = asyncio.run(server.google_auth(server.GoogleAuthIn(credential="token"), response))
    return result, response, fake_db


def test_google_auth_creates_user_and_returns_app_tokens(monkeypatch):
    result, response, fake_db = run_google_auth(
        monkeypatch,
        {
            "sub": "google-sub-1",
            "email": "New.User@Example.com",
            "email_verified": True,
            "name": "New User",
            "picture": "https://example.com/avatar.png",
        },
    )

    assert result["email"] == "new.user@example.com"
    assert result["name"] == "New User"
    assert result["access_token"]
    assert result["refresh_token"]
    assert "access_token=" in response.headers.get("set-cookie", "")
    saved = fake_db.users.users["new.user@example.com"]
    assert saved["auth_provider"] == "google"
    assert saved["google_sub"] == "google-sub-1"
    assert "password_hash" not in saved


def test_google_auth_links_existing_password_user_by_email(monkeypatch):
    existing = {
        "id": "existing-user",
        "email": "finance@example.com",
        "name": "Finance User",
        "password_hash": "hashed",
    }
    result, _, fake_db = run_google_auth(
        monkeypatch,
        {
            "sub": "google-sub-2",
            "email": "finance@example.com",
            "email_verified": True,
            "name": "Google Finance",
        },
        users=[existing],
    )

    assert result["id"] == "existing-user"
    assert result["name"] == "Finance User"
    linked = fake_db.users.users["finance@example.com"]
    assert linked["google_sub"] == "google-sub-2"
    assert linked["auth_provider"] == "google"
    assert linked["password_hash"] == "hashed"


def test_google_auth_rejects_unverified_email(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        run_google_auth(
            monkeypatch,
            {"sub": "google-sub-3", "email": "user@example.com", "email_verified": False},
        )

    assert exc.value.status_code == 401
    assert "verified" in exc.value.detail.lower()


def test_google_auth_rejects_invalid_google_credential(monkeypatch):
    monkeypatch.setattr(server, "db", FakeDB())
    monkeypatch.setattr(server, "GOOGLE_CLIENT_ID", "google-client")
    monkeypatch.setattr(
        server.google_id_token,
        "verify_oauth2_token",
        lambda credential, request, audience: (_ for _ in ()).throw(ValueError("bad token")),
    )

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.google_auth(server.GoogleAuthIn(credential="bad"), Response()))

    assert exc.value.status_code == 401


def test_google_auth_requires_google_client_id(monkeypatch):
    monkeypatch.setattr(server, "GOOGLE_CLIENT_ID", "")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.google_auth(server.GoogleAuthIn(credential="token"), Response()))

    assert exc.value.status_code == 503
