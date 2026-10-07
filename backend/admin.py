"""Client setup and matching intelligence; deliberately no financial-write methods."""
import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

try:
    from .client_mappings import normalize_label
except ImportError:
    from client_mappings import normalize_label


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ClientInput(StrictInput):
    name: str = Field(min_length=1, max_length=160)
    contact_email: EmailStr | None = None
    active: bool = True
    reason: str = Field(min_length=1, max_length=1000)


class ClientUpdate(ClientInput):
    revision: int = Field(ge=0)


class MappingInput(StrictInput):
    kind: Literal["payer", "alias", "reference"]
    source_value: str = Field(min_length=2, max_length=240)
    debtor_name: str = Field(min_length=1, max_length=240)
    allocation_mode: Literal["identify", "fifo", "fifo_auto"] = "identify"
    active: bool = True
    notes: str = Field(default="", max_length=2000)
    source: str = Field(min_length=1, max_length=240)
    reason: str = Field(min_length=1, max_length=1000)

    @field_validator("source_value", "debtor_name")
    @classmethod
    def has_name(cls, value):
        if not normalize_label(value):
            raise ValueError("Enter a name or reference containing letters or numbers")
        return value


class MappingUpdate(MappingInput):
    revision: int = Field(ge=1)


class InviteInput(StrictInput):
    name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    role: Literal["admin", "user", "read_only"] = "user"
    reason: str = Field(min_length=1, max_length=1000)


class AccessInput(StrictInput):
    role: Literal["admin", "user", "read_only"]
    active: bool
    revision: int = Field(ge=0)
    reason: str = Field(min_length=1, max_length=1000)


class LinkInput(StrictInput):
    purpose: Literal["invite", "reset"]
    reason: str = Field(min_length=1, max_length=1000)


class RedeemInput(StrictInput):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    token: str = Field(min_length=30, max_length=160)
    password: str = Field(min_length=12, max_length=72)

    @field_validator("password")
    @classmethod
    def password_bytes(cls, value):
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 UTF-8 bytes")
        return value


USER_FIELDS = {"_id": 0, "id": 1, "name": 1, "email": 1, "role": 1, "active": 1,
               "account_state": 1, "created_at": 1, "updated_at": 1, "revision": 1}


class AdminService:
    def __init__(self, db, actor):
        if actor.get("role") != "platform_admin":
            raise HTTPException(403, "Platform administrator access required")
        self.db, self.actor = db, actor

    def event(self, action, before, after, reason):
        return {"id": str(uuid.uuid4()), "action": action, "at": now_iso(),
                "actor_id": self.actor["id"], "actor_email": self.actor["email"],
                "before": before, "after": after, "reason": reason}

    async def client(self, client_id):
        doc = await self.db.organizations.find_one({"id": client_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Client not found")
        return doc

    async def clients(self):
        return await self.db.organizations.find({}, {"_id": 0, "history": 0}).sort("name", 1).to_list(None)

    async def create_client(self, payload):
        data = payload.model_dump(exclude={"reason"})
        doc = {**data, "id": str(uuid.uuid4()), "revision": 1, "created_at": now_iso(),
               "created_by": self.actor["id"], "history": [self.event("client_created", None, data, payload.reason)]}
        await self.db.organizations.insert_one(doc)
        return {k: v for k, v in doc.items() if k not in {"_id", "history"}}

    async def update_client(self, client_id, payload):
        before = await self.client(client_id)
        data = payload.model_dump(exclude={"revision", "reason"})
        await self.update_versioned(self.db.organizations, {"id": client_id}, before, data, payload.revision, "client_updated", payload.reason)
        return {**data, "id": client_id, "revision": payload.revision + 1}

    async def update_versioned(self, collection, query, before, data, revision, action, reason, extra=None):
        if before.get("revision", 0) != revision:
            raise HTTPException(409, "This record changed. Reload before saving.")
        expected = {"revision": revision} if revision else {"$or": [{"revision": 0}, {"revision": {"$exists": False}}]}
        old = {key: before.get(key) for key in data}
        update = {"$set": {**data, "updated_at": now_iso(), "updated_by": self.actor["id"], "revision": revision + 1},
                  "$push": {"history": self.event(action, old, data, reason)}, **(extra or {})}
        result = await collection.update_one({**query, **expected}, update)
        if result.matched_count != 1:
            raise HTTPException(409, "This record changed. Reload before saving.")

    async def mappings(self, client_id):
        await self.client(client_id)
        return await self.db.client_mappings.find({"org_id": client_id}, {"_id": 0, "history": 0}).sort("source_value", 1).to_list(None)

    async def save_mapping(self, client_id, payload, mapping_id=None):
        await self.client(client_id)
        data = payload.model_dump(exclude={"reason", "revision"})
        data["source_normalized"] = normalize_label(payload.source_value)
        try:
            if mapping_id:
                query = {"id": mapping_id, "org_id": client_id}
                before = await self.db.client_mappings.find_one(query)
                if not before:
                    raise HTTPException(404, "Mapping not found")
                await self.update_versioned(self.db.client_mappings, query, before, data, payload.revision, "mapping_updated", payload.reason)
            else:
                mapping_id = str(uuid.uuid4())
                await self.db.client_mappings.insert_one({**data, "id": mapping_id, "org_id": client_id,
                    "revision": 1, "created_at": now_iso(), "created_by": self.actor["id"],
                    "history": [self.event("mapping_created", None, data, payload.reason)]})
        except DuplicateKeyError:
            raise HTTPException(409, "A mapping with this type and normalized source already exists for this client. Edit that mapping instead.")
        return await self.db.client_mappings.find_one({"id": mapping_id, "org_id": client_id}, {"_id": 0, "history": 0})

    async def users(self, client_id):
        await self.client(client_id)
        return await self.db.users.find({"org_id": client_id, "role": {"$ne": "platform_admin"}}, USER_FIELDS).sort("name", 1).to_list(None)

    async def user(self, client_id, user_id):
        await self.client(client_id)
        doc = await self.db.users.find_one({"org_id": client_id, "id": user_id, "role": {"$ne": "platform_admin"}})
        if not doc:
            raise HTTPException(404, "Client user not found")
        return doc

    async def invite(self, client_id, payload):
        client = await self.client(client_id)
        if not client.get("active", True):
            raise HTTPException(409, "Activate the client before inviting users")
        email = str(payload.email).lower()
        doc = {"id": str(uuid.uuid4()), "org_id": client_id, "name": payload.name, "email": email,
               "role": payload.role, "active": True, "account_state": "invited", "revision": 1,
               "auth_version": 0, "created_at": now_iso(),
               "history": [self.event("user_invited", None, {"email": email, "role": payload.role}, payload.reason)]}
        try:
            await self.db.users.insert_one(doc)
        except DuplicateKeyError:
            raise HTTPException(409, "This email already has an account. Existing accounts cannot be moved between clients here.")
        return await self.issue_link(client_id, doc["id"], LinkInput(purpose="invite", reason=payload.reason))

    async def update_user(self, client_id, user_id, payload):
        before = await self.user(client_id, user_id)
        data = payload.model_dump(exclude={"reason", "revision"})
        await self.update_versioned(self.db.users, {"id": user_id, "org_id": client_id, "role": {"$ne": "platform_admin"}},
                                    before, data, payload.revision, "user_access_updated", payload.reason,
                                    {"$inc": {"auth_version": 1}, "$unset": {"account_link": ""}})
        return {"ok": True}

    async def issue_link(self, client_id, user_id, payload):
        user = await self.user(client_id, user_id)
        client = await self.client(client_id)
        if not user.get("active", True) or not client.get("active", True):
            raise HTTPException(409, "Activate the client and user before issuing a link")
        invited = user.get("account_state") == "invited"
        if invited != (payload.purpose == "invite"):
            raise HTTPException(409, "Use an invitation for a pending user, or a reset for an active account")
        token = secrets.token_urlsafe(32)
        expiry = datetime.now(timezone.utc) + timedelta(hours=48 if invited else 1)
        # The single current token and audit event are written atomically on the user.
        result = await self.db.users.update_one({"id": user_id, "org_id": client_id,
            "auth_version": user.get("auth_version", 0)} if "auth_version" in user else
            {"id": user_id, "org_id": client_id, "auth_version": {"$exists": False}},
            {"$set": {"account_link": {"hash": hashlib.sha256(token.encode()).hexdigest(),
                                      "purpose": payload.purpose, "expires_at": expiry.isoformat()}},
             "$push": {"history": self.event(f"{payload.purpose}_link_issued", None,
                       {"expires_at": expiry.isoformat()}, payload.reason)}})
        if result.matched_count != 1:
            raise HTTPException(409, "User access changed. Reload before issuing a link.")
        return {"user_id": user_id, "email": user["email"], "token": token,
                "purpose": payload.purpose, "expires_at": expiry.isoformat()}

    async def history(self, client_id):
        client = await self.client(client_id)
        events = [{**e, "record": client["name"]} for e in client.get("history", [])]
        for collection, label in [(self.db.client_mappings, "source_value"), (self.db.users, "email")]:
            async for doc in collection.find({"org_id": client_id, "role": {"$ne": "platform_admin"}}, {label: 1, "history": 1}):
                events.extend({**e, "record": doc.get(label, "")} for e in doc.get("history", []))
        return sorted(events, key=lambda e: e["at"], reverse=True)


async def redeem_account_link(db, payload, hash_password):
    digest = hashlib.sha256(payload.token.encode()).hexdigest()
    query = {"account_link.hash": digest, "account_link.expires_at": {"$gt": now_iso()},
             "active": {"$ne": False}, "role": {"$ne": "platform_admin"}}
    user = await db.users.find_one(query)
    if not user:
        raise HTTPException(400, "This link is invalid, expired, or already used")
    org = await db.organizations.find_one({"id": user["org_id"], "active": {"$ne": False}})
    if not org:
        raise HTTPException(403, "Client access is inactive")
    event = {"id": str(uuid.uuid4()), "action": "account_link_redeemed", "at": now_iso(),
             "actor_id": user["id"], "actor_email": user["email"], "before": None,
             "after": {"purpose": user["account_link"]["purpose"]}, "reason": "User completed secure account setup"}
    result = await db.users.find_one_and_update(query, {"$set": {
        "password_hash": hash_password(payload.password), "account_state": "active", "updated_at": now_iso()},
        "$inc": {"auth_version": 1}, "$unset": {"account_link": ""}, "$push": {"history": event}},
        return_document=ReturnDocument.AFTER)
    if not result:
        raise HTTPException(400, "This link is invalid, expired, or already used")
    return {"ok": True}
