"""Idempotent migration of unscoped legacy data, preserving each owner's boundary."""
import uuid
from datetime import datetime, timezone


async def migrate_legacy_workspaces(db, default_name):
    async for user in db.users.find({"role": {"$ne": "platform_admin"}}, {"_id": 0}):
        org_id = user.get("org_id") or str(uuid.uuid5(uuid.NAMESPACE_URL, f"eb:legacy-user:{user['id']}"))
        await db.organizations.update_one({"id": org_id}, {"$setOnInsert": {
            "id": org_id, "name": user.get("organization_name") or user.get("name") or default_name,
            "created_by": user["id"], "created_at": datetime.now(timezone.utc).isoformat(), "active": True}}, upsert=True)
        if not user.get("org_id"):
            await db.users.update_one({"id": user["id"], "org_id": {"$exists": False}},
                {"$set": {"org_id": org_id, "role": user.get("role") or "admin"}})
        for name in ["allocation_runs", "allocation_bank_rows", "allocation_invoice_rows", "audit_logs", "user_mapping_profiles"]:
            await db[name].update_many({"user_id": user["id"], "org_id": {"$exists": False}}, {"$set": {"org_id": org_id}})
