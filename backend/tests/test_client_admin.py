"""Focused integration checks using a unique, disposable LOCAL MongoDB database.

No configured application database is used. Skips when local MongoDB is unavailable.
"""
import asyncio
import copy
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import ServerSelectionTimeoutError

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "unused_admin_test_import")
os.environ.setdefault("JWT_SECRET", "test-admin-key-with-at-least-thirty-two-characters")
from backend import server
from backend.workspace_migration import migrate_legacy_workspaces


OPERATOR = {"id": "operator", "email": "operator@example.test", "name": "Operator", "role": "platform_admin"}
CLIENT_USER = {"id": "alice", "email": "alice@example.test", "name": "Alice", "role": "admin", "org_id": "client-a"}
OTHER_USER = {"id": "bob", "email": "bob@example.test", "name": "Bob", "role": "admin", "org_id": "client-b"}
MAPPING = {"kind": "alias", "source_value": "ZQ REMIT", "debtor_name": "Acme Group",
           "allocation_mode": "fifo", "active": True, "notes": "Confirmed name", "source": "Client confirmation", "reason": "Approved remitter alias"}
RUN = {"name": "Mapped receipts", "period": "2026-09", "bank_csv": "Ref,Amount\nZQ REMIT,125\n",
       "invoice_csv": "Inv,Debtor,Amount,Date\nINV1001,Acme Group,100,2026-01-01\nINV1002,Acme Group,50,2026-02-01\n",
       "mapping": {"bank_reference": "Ref", "bank_amount": "Amount", "invoice_number": "Inv",
                   "invoice_debtor": "Debtor", "invoice_amount": "Amount", "invoice_date": "Date"}, "proceed_with_warnings": True}


def headers(user, version=0):
    return {"Authorization": f"Bearer {server.create_access_token(user['id'], user['email'], version)}"}


def run_scenario(monkeypatch, scenario):
    async def run():
        mongo = AsyncIOMotorClient("mongodb://127.0.0.1:27017", serverSelectionTimeoutMS=1500)
        name = f"eb_admin_test_{uuid.uuid4().hex}"
        connected = False
        try:
            try:
                await mongo.admin.command("ping")
                connected = True
            except ServerSelectionTimeoutError:
                pytest.skip("Local MongoDB is not running")
            db = mongo[name]
            monkeypatch.setattr(server, "db", db)
            await db.users.create_index("email", unique=True)
            await db.client_mappings.create_index([("org_id", 1), ("kind", 1), ("source_normalized", 1)], unique=True)
            await db.users.insert_many(copy.deepcopy([OPERATOR, CLIENT_USER, OTHER_USER]))
            await db.organizations.insert_many([{"id": "client-a", "name": "Client A", "active": True}, {"id": "client-b", "name": "Client B", "active": True}])
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as api:
                await scenario(api, db)
        finally:
            # Only the database name generated above is ever removed.
            if connected and name.startswith("eb_admin_test_"):
                await mongo.drop_database(name)
            mongo.close()
    asyncio.run(run())


def test_mapping_crud_scoping_audit_and_concurrent_edit(monkeypatch):
    async def scenario(api, db):
        h = headers(OPERATOR)
        r = await api.post("/api/admin/clients/client-a/mappings", headers=h, json=MAPPING)
        assert r.status_code == 200, r.text
        first = r.json()
        assert first["revision"] == 1
        duplicate = await api.post("/api/admin/clients/client-a/mappings", headers=h, json={**MAPPING, "source_value": "zq-remit"})
        assert duplicate.status_code == 409
        second = await api.post("/api/admin/clients/client-b/mappings", headers=h, json={**MAPPING, "debtor_name": "Different Client Debtor"})
        assert second.status_code == 200
        wrong_client = await api.put(f"/api/admin/clients/client-b/mappings/{first['id']}", headers=h, json={**MAPPING, "revision": 1})
        assert wrong_client.status_code == 404
        updates = await asyncio.gather(*[
            api.put(f"/api/admin/clients/client-a/mappings/{first['id']}", headers=h, json={**MAPPING, "revision": 1, "notes": note, "reason": note})
            for note in ["First editor", "Second editor"]])
        assert sorted(r.status_code for r in updates) == [200, 409]
        record = await db.client_mappings.find_one({"id": first["id"]})
        assert record["revision"] == 2 and len(record["history"]) == 2
        assert record["history"][1]["before"]["notes"] == "Confirmed name"
        assert record["history"][1]["actor_id"] == "operator"
        history = (await api.get("/api/admin/clients/client-a/history", headers=h)).json()
        assert len(history) == 2 and all(e["record"] == "ZQ REMIT" for e in history)
        assert await db.allocation_runs.count_documents({}) == 0
    run_scenario(monkeypatch, scenario)


def test_platform_financial_boundary_and_client_admin_boundary(monkeypatch):
    async def scenario(api, db):
        for principal in [CLIENT_USER, OTHER_USER]:
            assert (await api.get("/api/admin/clients", headers=headers(principal))).status_code == 403
            assert (await api.post("/api/admin/clients/client-a/mappings", headers=headers(principal), json=MAPPING)).status_code == 403
        # Every current financial route uses the client dependency. Exercise representative writes and reads.
        paths = [("GET", "/api/allocations", None), ("POST", "/api/allocations", RUN),
                 ("DELETE", "/api/allocations/run", None),
                 ("POST", "/api/allocations/run/manual-link", {"bank_row_id": "b", "invoice_row_id": "i", "amount": 1}),
                 ("POST", "/api/allocations/run/suggestions/b/accept", None),
                 ("PATCH", "/api/exceptions/e", {"notes": "not allowed"}),
                 ("GET", "/api/debtors", None), ("GET", "/api/allocations/run/export", None)]
        for method, path, body in paths:
            r = await api.request(method, path, headers=headers(OPERATOR), json=body)
            assert r.status_code == 403, (path, r.text)
        # Even an operator account retaining an old org cannot be demoted by a client admin.
        await db.users.update_one({"id": "operator"}, {"$set": {"org_id": "client-a"}})
        r = await api.patch("/api/workspace/users/operator", headers=headers(CLIENT_USER), json={"role": "user"})
        assert r.status_code == 404
        assert (await db.users.find_one({"id": "operator"}))["role"] == "platform_admin"
    run_scenario(monkeypatch, scenario)


def test_platform_account_email_and_password_change(monkeypatch):
    async def scenario(api, db):
        old_email = "operator@example.com"
        old_password = "Existing-password-123"
        new_password = "Replacement-password-456"
        await db.users.update_one({"id": "operator"}, {"$set": {
            "email": old_email, "password_hash": server.hash_password(old_password),
            "google_sub": "old-google-identity"
        }})
        endpoint = "/api/admin/account"

        forbidden = await api.put(endpoint, headers=headers(CLIENT_USER), json={
            "email": CLIENT_USER["email"], "current_password": old_password,
        })
        assert forbidden.status_code == 403
        wrong = await api.put(endpoint, headers=headers(OPERATOR), json={
            "email": "operator-updated@example.com", "current_password": "incorrect-password",
        })
        assert wrong.status_code == 400
        await db.users.update_one({"id": "alice"}, {"$set": {"email": "existing@example.com"}})
        duplicate = await api.put(endpoint, headers=headers(OPERATOR), json={
            "email": "existing@example.com", "current_password": old_password,
        })
        assert duplicate.status_code == 409

        changed = await api.put(endpoint, headers=headers(OPERATOR), json={
            "email": "operator-updated@example.com", "current_password": old_password,
            "new_password": new_password,
        })
        assert changed.status_code == 200, changed.text
        assert changed.json() == {"ok": True, "email": "operator-updated@example.com"}
        saved = await db.users.find_one({"id": "operator"})
        assert saved["role"] == "platform_admin" and saved["auth_version"] == 1
        assert saved["email"] == "operator-updated@example.com" and "google_sub" not in saved
        assert server.verify_password(new_password, saved["password_hash"])
        assert (await api.get("/api/auth/me", headers=headers(OPERATOR))).status_code == 401
        assert (await api.post("/api/auth/login", json={
            "email": old_email, "password": old_password,
        })).status_code == 401
        login = await api.post("/api/auth/login", json={
            "email": saved["email"], "password": new_password,
        })
        assert login.status_code == 200 and login.json()["role"] == "platform_admin"
    run_scenario(monkeypatch, scenario)


def test_invitation_reset_expiry_replay_and_secret_redaction(monkeypatch):
    async def scenario(api, db):
        h = headers(OPERATOR)
        r = await api.post("/api/admin/clients/client-a/invitations", headers=h,
            json={"name": "New User", "email": "new@example.com", "role": "user", "reason": "Client requested access"})
        assert r.status_code == 200, r.text
        invitation = r.json()
        raw = await db.users.find_one({"id": invitation["user_id"]})
        assert "password_hash" not in raw and raw["account_link"]["hash"] != invitation["token"]
        pending = {"id": raw["id"], "email": raw["email"]}
        assert (await api.get("/api/auth/me", headers=headers(pending))).status_code == 403
        users = (await api.get("/api/admin/clients/client-a/users", headers=h)).json()
        assert all("account_link" not in u and "password_hash" not in u and "history" not in u for u in users)
        password = "New-secure-password-123"
        done = await api.post("/api/auth/complete-account", json={"token": invitation["token"], "password": password})
        assert done.status_code == 200, done.text
        assert (await api.post("/api/auth/complete-account", json={"token": invitation["token"], "password": password})).status_code == 400
        login = await api.post("/api/auth/login", json={"email": raw["email"], "password": password})
        assert login.status_code == 200, login.text
        old_token = login.json()["access_token"]
        api.cookies.clear()
        reset_path = f"/api/admin/clients/client-a/users/{raw['id']}/links"
        first = (await api.post(reset_path, headers=h, json={"purpose": "reset", "reason": "User requested reset"})).json()
        second = (await api.post(reset_path, headers=h, json={"purpose": "reset", "reason": "Resend"})).json()
        assert (await api.post("/api/auth/complete-account", json={"token": first["token"], "password": password})).status_code == 400
        await db.users.update_one({"id": raw["id"]}, {"$set": {"account_link.expires_at": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()}})
        assert (await api.post("/api/auth/complete-account", json={"token": second["token"], "password": password})).status_code == 400
        third = (await api.post(reset_path, headers=h, json={"purpose": "reset", "reason": "Fresh link"})).json()
        results = await asyncio.gather(*[api.post("/api/auth/complete-account", json={"token": third["token"], "password": password}) for _ in range(2)])
        assert sorted(r.status_code for r in results) == [200, 400]
        assert (await api.get("/api/auth/me", headers={"Authorization": f"Bearer {old_token}"})).status_code == 401
        audits = str((await api.get("/api/admin/clients/client-a/history", headers=h)).json())
        assert password not in audits and third["token"] not in audits
    run_scenario(monkeypatch, scenario)


def test_client_user_deactivation_and_tenant_binding(monkeypatch):
    async def scenario(api, db):
        h = headers(OPERATOR)
        created = await api.post("/api/admin/clients", headers=h, json={"name": "New client", "reason": "Onboarding", "active": True})
        assert created.status_code == 200
        client = created.json()
        assert (await api.put(f"/api/admin/clients/{client['id']}", headers=h, json={"name": "Renamed", "revision": 1, "active": False, "reason": "Paused"})).status_code == 200
        assert (await api.put("/api/admin/clients/client-b/users/alice", headers=h, json={"role": "user", "active": False, "revision": 0, "reason": "Wrong client"})).status_code == 404
        edit = await api.put("/api/admin/clients/client-a/users/alice", headers=h, json={"role": "user", "active": False, "revision": 0, "reason": "Suspend access"})
        assert edit.status_code == 200, edit.text
        assert (await api.get("/api/auth/me", headers=headers(CLIENT_USER))).status_code == 401
        assert (await api.get("/api/auth/me", headers=headers(CLIENT_USER, 1))).status_code == 403
        assert (await api.put("/api/admin/clients/client-a/users/alice", headers=h, json={"role": "user", "active": True, "revision": 1, "reason": "Reinstate"})).status_code == 200
        assert (await api.get("/api/auth/me", headers=headers(CLIENT_USER, 1))).status_code == 401
        assert (await api.get("/api/auth/me", headers=headers(CLIENT_USER, 2))).status_code == 200
        await db.organizations.update_one({"id": "client-a"}, {"$set": {"active": False}})
        assert (await api.get("/api/allocations", headers=headers(CLIENT_USER, 2))).status_code == 403
        assert (await api.get("/api/allocations", headers=headers(OTHER_USER))).status_code == 200
    run_scenario(monkeypatch, scenario)


def test_mapping_run_proposals_snapshot_deactivation_and_isolation(monkeypatch):
    async def scenario(api, db):
        h = headers(OPERATOR)
        mapping = (await api.post("/api/admin/clients/client-a/mappings", headers=h, json=MAPPING)).json()
        run = await api.post("/api/allocations", headers=headers(CLIENT_USER), json=RUN)
        assert run.status_code == 200, run.text
        run_id = run.json()["id"]
        bank = await db.allocation_bank_rows.find_one({"run_id": run_id})
        assert bank["decision"] == "suggest" and bank["matches"] == [] and bank["remaining"] == 125
        assert [link["amount"] for link in bank["suggestions"]] == [100, 25]
        assert [link["invoice_number"] for link in bank["suggestions"]] == ["INV1001", "INV1002"]
        assert bank["evidence"]["mapping_versions"] == [1]
        assert run.json()["stats"]["total_allocated"] == 0
        before = copy.deepcopy(bank)
        update = await api.put(f"/api/admin/clients/client-a/mappings/{mapping['id']}", headers=h, json={**MAPPING, "revision": 1, "active": False, "reason": "Retired"})
        assert update.status_code == 200
        assert await db.allocation_bank_rows.find_one({"run_id": run_id}) == before
        stored_run = await db.allocation_runs.find_one({"id": run_id})
        assert stored_run["matching_mappings"][0]["revision"] == 1
        next_run = (await api.post("/api/allocations", headers=headers(CLIENT_USER), json=RUN)).json()
        assert "matching_mappings" not in next_run
        assert (await db.allocation_runs.find_one({"id": next_run["id"]}))["matching_mappings"] == []
        other_run = await api.post("/api/allocations", headers=headers(OTHER_USER), json=RUN)
        assert other_run.status_code == 200 and "matching_mappings" not in other_run.json()
        assert (await api.get(f"/api/allocations/{run_id}", headers=headers(OTHER_USER))).status_code == 404
        accepted = await api.post(f"/api/allocations/{run_id}/suggestions/{bank['id']}/accept", headers=headers(CLIENT_USER))
        assert accepted.status_code == 200, accepted.text
        assert (await db.allocation_bank_rows.find_one({"run_id": run_id}))["remaining"] == 0
    run_scenario(monkeypatch, scenario)


def test_background_run_uses_queued_mapping_snapshot(monkeypatch):
    async def scenario(api, db):
        mapping = (await api.post("/api/admin/clients/client-a/mappings", headers=headers(OPERATOR), json=MAPPING)).json()
        original = server._process_run_async
        async def change_mapping_then_process(*args):
            await db.client_mappings.update_one({"id": mapping["id"]}, {"$set": {"active": False, "debtor_name": "Changed", "revision": 2}})
            await original(*args)
        monkeypatch.setattr(server, "_process_run_async", change_mapping_then_process)
        payload = {**RUN, "invoice_csv": RUN["invoice_csv"] + "".join(f"OTH{i},Other Company,1,2026-01-01\n" for i in range(2000))}
        result = await api.post("/api/allocations", headers=headers(CLIENT_USER), json=payload)
        assert result.status_code == 200, result.text
        run = await db.allocation_runs.find_one({"id": result.json()["id"]})
        assert run["status"] == "done"
        bank = await db.allocation_bank_rows.find_one({"run_id": run["id"]})
        assert bank["evidence"]["mapping_versions"] == [1] and bank["matches"] == []
    run_scenario(monkeypatch, scenario)


def test_migration_preserves_legacy_owner_boundaries(monkeypatch):
    async def scenario(api, db):
        await db.users.insert_many([{"id": "legacy-a", "email": "old-a@example.test"}, {"id": "legacy-b", "email": "old-b@example.test"}])
        await db.allocation_runs.insert_many([{"id": "old-a", "user_id": "legacy-a"}, {"id": "old-b", "user_id": "legacy-b"}, {"id": "orphan"}])
        await migrate_legacy_workspaces(db, "Default")
        first = await db.allocation_runs.find_one({"id": "old-a"})
        second = await db.allocation_runs.find_one({"id": "old-b"})
        assert first["org_id"] != second["org_id"]
        await migrate_legacy_workspaces(db, "Default")
        assert (await db.allocation_runs.find_one({"id": "old-a"}))["org_id"] == first["org_id"]
        assert "org_id" not in await db.allocation_runs.find_one({"id": "orphan"})
        assert (await db.users.find_one({"id": "alice"}))["org_id"] == "client-a"
    run_scenario(monkeypatch, scenario)


@pytest.mark.parametrize("mode,expected_links", [("identify", 0), ("fifo", 2)])
def test_mapping_permissions_never_commit_balances(mode, expected_links):
    mapping = {**MAPPING, "id": "map", "revision": 1, "allocation_mode": mode}
    bank, invoices, _ = server.run_matching(server.parse_csv(RUN["bank_csv"]), server.parse_csv(RUN["invoice_csv"]), server.ColumnMapping(**RUN["mapping"]), [mapping])
    assert len(bank[0]["suggestions"]) == expected_links
    assert bank[0]["remaining"] == 125 and bank[0]["matches"] == []
    assert [row["remaining"] for row in invoices] == [100, 50]


def test_conflicting_mapping_targets_require_manual_review():
    mappings = [{**MAPPING, "id": "one", "revision": 1}, {**MAPPING, "id": "two", "revision": 1, "debtor_name": "Other Debtor"}]
    bank, _, _ = server.run_matching(server.parse_csv(RUN["bank_csv"]), server.parse_csv(RUN["invoice_csv"]), server.ColumnMapping(**RUN["mapping"]), mappings)
    assert bank[0]["evidence"]["ambiguous"] and bank[0]["matches"] == [] and bank[0]["suggestions"] == []
