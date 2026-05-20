from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import csv
import io
import uuid
import logging
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, status
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from rapidfuzz import fuzz


# ----- DB / Config -----
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ['JWT_SECRET']

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ----- Auth utils -----
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")

async def get_current_user(request: Request) -> Dict[str, Any]:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ----- Models -----
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class ColumnMapping(BaseModel):
    # bank
    bank_date: Optional[str] = None
    bank_reference: Optional[str] = None
    bank_amount: Optional[str] = None
    bank_payer: Optional[str] = None
    # invoice
    invoice_number: Optional[str] = None
    invoice_debtor: Optional[str] = None
    invoice_amount: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_outstanding: Optional[str] = None

class AllocationCreate(BaseModel):
    name: str
    period: str
    bank_csv: str
    invoice_csv: str
    mapping: ColumnMapping
    proceed_with_warnings: bool = False

class ValidateIn(BaseModel):
    bank_csv: str
    invoice_csv: str
    mapping: ColumnMapping

class ManualLinkIn(BaseModel):
    bank_row_id: str
    invoice_row_id: str
    amount: float


# ----- CSV helpers -----
def parse_csv(text: str) -> List[Dict[str, str]]:
    if not text or not text.strip():
        return []
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for r in reader:
        rows.append({(k or "").strip(): (v or "").strip() for k, v in r.items() if k is not None})
    return rows

def to_float(v) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("£", "").replace("$", "").replace("€", "")
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None

def parse_date_safe(v) -> Optional[str]:
    if not v:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def validate_csvs(bank_csv: str, invoice_csv: str, mapping: ColumnMapping) -> Dict[str, Any]:
    errors: List[Dict[str, Any]] = []
    warnings: List[Dict[str, Any]] = []
    coverage: Dict[str, float] = {}

    bank_rows = parse_csv(bank_csv)
    inv_rows = parse_csv(invoice_csv)

    if not bank_rows:
        errors.append({"scope": "bank", "message": "Bank CSV is empty or unreadable."})
    if not inv_rows:
        errors.append({"scope": "invoice", "message": "Invoice CSV is empty or unreadable."})

    def check_col(rows, col, scope, key, required=True):
        if not col:
            if required:
                errors.append({"scope": scope, "message": f"Required column not mapped: {key}"})
            return
        if rows and col not in rows[0]:
            errors.append({"scope": scope, "message": f"Column '{col}' not found in {scope} CSV header."})
            return
        non_empty = sum(1 for r in rows if r.get(col, "").strip())
        cov = non_empty / len(rows) if rows else 0
        coverage[f"{scope}.{key}"] = round(cov * 100, 1)
        if cov < 0.5:
            warnings.append({"scope": scope, "message": f"Low coverage on {key} ({col}): {round(cov*100,1)}%"})

    check_col(bank_rows, mapping.bank_reference, "bank", "reference")
    check_col(bank_rows, mapping.bank_amount, "bank", "amount")
    check_col(bank_rows, mapping.bank_date, "bank", "date", required=False)
    check_col(bank_rows, mapping.bank_payer, "bank", "payer", required=False)

    check_col(inv_rows, mapping.invoice_number, "invoice", "number")
    check_col(inv_rows, mapping.invoice_debtor, "invoice", "debtor")
    check_col(inv_rows, mapping.invoice_amount, "invoice", "amount")
    check_col(inv_rows, mapping.invoice_outstanding, "invoice", "outstanding", required=False)
    check_col(inv_rows, mapping.invoice_date, "invoice", "date", required=False)

    # Row-level checks
    if mapping.bank_amount:
        zeros = 0
        negs = 0
        unparseable = 0
        for i, r in enumerate(bank_rows, start=2):
            amt = to_float(r.get(mapping.bank_amount, ""))
            if amt is None:
                unparseable += 1
                if unparseable <= 5:
                    warnings.append({"scope": "bank", "row": i, "message": f"Amount could not be parsed: '{r.get(mapping.bank_amount, '')}'"})
            elif amt == 0:
                zeros += 1
            elif amt < 0:
                negs += 1
        if bank_rows and zeros == len(bank_rows):
            errors.append({"scope": "bank", "message": "All bank amounts are zero."})
        if negs:
            warnings.append({"scope": "bank", "message": f"{negs} bank row(s) have negative amounts (refunds/withdrawals)."})

    if mapping.invoice_number and inv_rows:
        seen = {}
        for i, r in enumerate(inv_rows, start=2):
            num = r.get(mapping.invoice_number, "").strip()
            if not num:
                continue
            seen.setdefault(num, []).append(i)
        dups = {k: v for k, v in seen.items() if len(v) > 1}
        if dups:
            for k, rows in list(dups.items())[:5]:
                warnings.append({"scope": "invoice", "message": f"Duplicate invoice number '{k}' on rows {rows}"})

    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "coverage": coverage,
        "bank_row_count": len(bank_rows),
        "invoice_row_count": len(inv_rows),
    }


# ----- Matching engine -----
INVOICE_REF_PATTERN = re.compile(r"\b([A-Z]{0,5}-?\d{3,10})\b", re.IGNORECASE)

def extract_refs(text: str) -> List[str]:
    if not text:
        return []
    return [m.group(1).upper().replace("-", "") for m in INVOICE_REF_PATTERN.finditer(text)]

def normalize_num(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def run_matching(bank_rows_raw, invoice_rows_raw, mapping: ColumnMapping):
    # Build normalized rows
    bank_rows = []
    for i, r in enumerate(bank_rows_raw):
        amt = to_float(r.get(mapping.bank_amount or "", "")) or 0.0
        ref = r.get(mapping.bank_reference or "", "")
        payer = r.get(mapping.bank_payer or "", "") if mapping.bank_payer else ""
        date = parse_date_safe(r.get(mapping.bank_date or "", "")) if mapping.bank_date else None
        bank_rows.append({
            "id": str(uuid.uuid4()),
            "idx": i,
            "amount": round(amt, 2),
            "remaining": round(amt, 2),
            "reference": ref,
            "payer": payer,
            "date": date,
            "matches": [],
            "status": "unmatched",  # unmatched | partial | full
            "confidence": None,
        })

    invoice_rows = []
    for i, r in enumerate(invoice_rows_raw):
        amt = to_float(r.get(mapping.invoice_amount or "", "")) or 0.0
        outstanding_field = mapping.invoice_outstanding
        outstanding = to_float(r.get(outstanding_field or "", "")) if outstanding_field else None
        if outstanding is None:
            outstanding = amt
        num = r.get(mapping.invoice_number or "", "")
        debtor = r.get(mapping.invoice_debtor or "", "")
        date = parse_date_safe(r.get(mapping.invoice_date or "", "")) if mapping.invoice_date else None
        invoice_rows.append({
            "id": str(uuid.uuid4()),
            "idx": i,
            "number": num,
            "number_norm": normalize_num(num),
            "debtor": debtor,
            "amount": round(amt, 2),
            "outstanding": round(outstanding, 2),
            "remaining": round(outstanding, 2),
            "date": date,
            "matches": [],
            "status": "unmatched",
        })

    inv_by_norm = {}
    for inv in invoice_rows:
        if inv["number_norm"]:
            inv_by_norm.setdefault(inv["number_norm"], []).append(inv)

    # Pass 1: invoice reference match
    for b in bank_rows:
        if b["remaining"] <= 0:
            continue
        refs = extract_refs(b["reference"])
        hit_invoices = []
        seen_ids = set()
        for ref in refs:
            cands = []
            # exact normalized match
            if ref in inv_by_norm:
                cands = inv_by_norm[ref]
            else:
                # try suffix match (last 4+ digits)
                digits = re.sub(r"\D", "", ref)
                if len(digits) >= 4:
                    for k, vs in inv_by_norm.items():
                        if k.endswith(digits) or digits.endswith(re.sub(r"\D", "", k)):
                            cands.extend(vs)
            for c in cands:
                if c["id"] in seen_ids:
                    continue
                seen_ids.add(c["id"])
                hit_invoices.append(c)

        for inv in hit_invoices:
            if b["remaining"] <= 0:
                break
            if inv["remaining"] <= 0:
                continue
            alloc = round(min(b["remaining"], inv["remaining"]), 2)
            if alloc <= 0:
                continue
            b["remaining"] = round(b["remaining"] - alloc, 2)
            inv["remaining"] = round(inv["remaining"] - alloc, 2)
            link = {
                "bank_id": b["id"],
                "invoice_id": inv["id"],
                "amount": alloc,
                "method": "reference",
                "confidence": "high",
            }
            b["matches"].append(link)
            inv["matches"].append(link)

    # Pass 2: fuzzy debtor name fallback for bank rows still unmatched
    for b in bank_rows:
        if b["remaining"] <= 0 or not b["payer"]:
            continue
        scored = []
        for inv in invoice_rows:
            if inv["remaining"] <= 0 or not inv["debtor"]:
                continue
            score = fuzz.token_set_ratio(b["payer"], inv["debtor"])
            if score >= 75:
                scored.append((score, inv))
        scored.sort(key=lambda x: (-x[0], -x[1]["remaining"]))
        for score, inv in scored:
            if b["remaining"] <= 0:
                break
            alloc = round(min(b["remaining"], inv["remaining"]), 2)
            if alloc <= 0:
                continue
            b["remaining"] = round(b["remaining"] - alloc, 2)
            inv["remaining"] = round(inv["remaining"] - alloc, 2)
            confidence = "medium" if score >= 85 else "low"
            link = {
                "bank_id": b["id"],
                "invoice_id": inv["id"],
                "amount": alloc,
                "method": "debtor_name",
                "confidence": confidence,
                "score": score,
            }
            b["matches"].append(link)
            inv["matches"].append(link)

    # Assign statuses
    for b in bank_rows:
        if not b["matches"]:
            b["status"] = "unmatched"
            b["confidence"] = None
        elif b["remaining"] <= 0.005:
            b["status"] = "full"
            b["confidence"] = max((m["confidence"] for m in b["matches"]), key=lambda c: {"high": 3, "medium": 2, "low": 1}.get(c, 0))
        else:
            b["status"] = "partial"
            b["confidence"] = max((m["confidence"] for m in b["matches"]), key=lambda c: {"high": 3, "medium": 2, "low": 1}.get(c, 0))

    for inv in invoice_rows:
        if not inv["matches"]:
            inv["status"] = "unmatched"
        elif inv["remaining"] <= 0.005:
            inv["status"] = "full"
        else:
            inv["status"] = "partial"

    stats = {
        "total_bank": len(bank_rows),
        "total_invoices": len(invoice_rows),
        "fully_matched": sum(1 for b in bank_rows if b["status"] == "full"),
        "partially_matched": sum(1 for b in bank_rows if b["status"] == "partial"),
        "unmatched_bank": sum(1 for b in bank_rows if b["status"] == "unmatched"),
        "unmatched_invoices": sum(1 for inv in invoice_rows if inv["status"] == "unmatched"),
        "total_allocated": round(sum(m["amount"] for b in bank_rows for m in b["matches"]), 2),
        "total_outstanding": round(sum(inv["remaining"] for inv in invoice_rows), 2),
    }
    return bank_rows, invoice_rows, stats


# ----- App -----
app = FastAPI()
api = APIRouter(prefix="/api")


@api.get("/")
async def root():
    return {"app": "Cash Allocator", "company": "EB Business Solutions Limited"}


# ----- Auth routes -----
@api.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    access = create_access_token(user_id, email)
    refresh = create_refresh_token(user_id)
    set_auth_cookies(response, access, refresh)
    return {"id": user_id, "email": email, "name": payload.name}


@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"id": user["id"], "email": user["email"], "name": user.get("name", "")}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(current=Depends(get_current_user)):
    return current


# ----- Allocation routes -----
@api.post("/allocations/validate")
async def validate(payload: ValidateIn, current=Depends(get_current_user)):
    return validate_csvs(payload.bank_csv, payload.invoice_csv, payload.mapping)


@api.post("/allocations/preview-headers")
async def preview_headers(payload: Dict[str, str], current=Depends(get_current_user)):
    """Quick header sniffer for the wizard."""
    bank_rows = parse_csv(payload.get("bank_csv", ""))
    inv_rows = parse_csv(payload.get("invoice_csv", ""))
    return {
        "bank_headers": list(bank_rows[0].keys()) if bank_rows else [],
        "bank_sample": bank_rows[:5],
        "invoice_headers": list(inv_rows[0].keys()) if inv_rows else [],
        "invoice_sample": inv_rows[:5],
    }


async def write_audit(user_id: str, run_id: Optional[str], action: str, details: Dict[str, Any]):
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "run_id": run_id,
        "action": action,
        "details": details,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


@api.post("/allocations")
async def create_allocation(payload: AllocationCreate, current=Depends(get_current_user)):
    validation = validate_csvs(payload.bank_csv, payload.invoice_csv, payload.mapping)
    if not validation["ok"]:
        raise HTTPException(status_code=400, detail={"message": "CSV validation failed", "validation": validation})
    if validation["warnings"] and not payload.proceed_with_warnings:
        raise HTTPException(status_code=400, detail={"message": "CSV has warnings", "validation": validation})

    bank_raw = parse_csv(payload.bank_csv)
    inv_raw = parse_csv(payload.invoice_csv)
    bank_rows, invoice_rows, stats = run_matching(bank_raw, inv_raw, payload.mapping)

    run_id = str(uuid.uuid4())
    doc = {
        "id": run_id,
        "user_id": current["id"],
        "name": payload.name,
        "period": payload.period,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mapping": payload.mapping.model_dump(),
        "bank_rows": bank_rows,
        "invoice_rows": invoice_rows,
        "stats": stats,
    }
    await db.allocation_runs.insert_one(doc)
    await write_audit(current["id"], run_id, "create_run", {
        "name": payload.name, "period": payload.period, "stats": stats,
    })
    doc.pop("_id", None)
    return doc


@api.get("/allocations")
async def list_allocations(current=Depends(get_current_user)):
    runs = await db.allocation_runs.find(
        {"user_id": current["id"]},
        {"_id": 0, "bank_rows": 0, "invoice_rows": 0},
    ).sort("created_at", -1).to_list(500)
    return runs


@api.get("/allocations/{run_id}")
async def get_allocation(run_id: str, current=Depends(get_current_user)):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@api.delete("/allocations/{run_id}")
async def delete_allocation(run_id: str, current=Depends(get_current_user)):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0, "name": 1})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    await db.allocation_runs.delete_one({"id": run_id, "user_id": current["id"]})
    await write_audit(current["id"], run_id, "delete_run", {"name": run.get("name")})
    return {"ok": True}


@api.get("/allocations/{run_id}/export")
async def export_allocation(run_id: str, current=Depends(get_current_user)):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Bank Date", "Bank Reference", "Bank Payer", "Bank Amount (£)",
                     "Status", "Confidence", "Matched Invoices", "Allocated (£)", "Bank Remaining (£)"])
    inv_by_id = {inv["id"]: inv for inv in run["invoice_rows"]}
    for b in run["bank_rows"]:
        nums = ", ".join(inv_by_id[m["invoice_id"]]["number"] for m in b["matches"] if m["invoice_id"] in inv_by_id)
        allocated = round(sum(m["amount"] for m in b["matches"]), 2)
        writer.writerow([
            b.get("date") or "",
            b.get("reference") or "",
            b.get("payer") or "",
            f"{b['amount']:.2f}",
            b["status"],
            b.get("confidence") or "",
            nums,
            f"{allocated:.2f}",
            f"{b['remaining']:.2f}",
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.read()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="allocation-{run["name"]}.csv"'},
    )


@api.post("/allocations/{run_id}/manual-link")
async def manual_link(run_id: str, payload: ManualLinkIn, current=Depends(get_current_user)):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    bank = next((b for b in run["bank_rows"] if b["id"] == payload.bank_row_id), None)
    inv = next((i for i in run["invoice_rows"] if i["id"] == payload.invoice_row_id), None)
    if not bank or not inv:
        raise HTTPException(status_code=404, detail="Bank or invoice row not found")
    amt = round(min(payload.amount, bank["remaining"], inv["remaining"]), 2)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Nothing remaining to allocate")

    link = {
        "bank_id": bank["id"], "invoice_id": inv["id"], "amount": amt,
        "method": "manual", "confidence": "manual",
    }
    bank["matches"].append(link)
    inv["matches"].append(link)
    bank["remaining"] = round(bank["remaining"] - amt, 2)
    inv["remaining"] = round(inv["remaining"] - amt, 2)

    # recompute statuses
    bank["status"] = "full" if bank["remaining"] <= 0.005 else "partial"
    inv["status"] = "full" if inv["remaining"] <= 0.005 else "partial"

    # recompute stats
    bank_rows = run["bank_rows"]
    invoice_rows = run["invoice_rows"]
    stats = run["stats"]
    stats["fully_matched"] = sum(1 for b in bank_rows if b["status"] == "full")
    stats["partially_matched"] = sum(1 for b in bank_rows if b["status"] == "partial")
    stats["unmatched_bank"] = sum(1 for b in bank_rows if b["status"] == "unmatched")
    stats["unmatched_invoices"] = sum(1 for i in invoice_rows if i["status"] == "unmatched")
    stats["total_allocated"] = round(sum(m["amount"] for b in bank_rows for m in b["matches"]), 2)
    stats["total_outstanding"] = round(sum(i["remaining"] for i in invoice_rows), 2)

    await db.allocation_runs.update_one(
        {"id": run_id, "user_id": current["id"]},
        {"$set": {"bank_rows": bank_rows, "invoice_rows": invoice_rows, "stats": stats}},
    )
    await write_audit(current["id"], run_id, "manual_link", {
        "bank_reference": bank.get("reference"),
        "invoice_number": inv.get("number"),
        "amount": amt,
    })
    return {"ok": True, "stats": stats, "bank": bank, "invoice": inv}


# ----- Compare -----
@api.get("/compare")
async def compare(run_ids: str, current=Depends(get_current_user)):
    ids = [i for i in run_ids.split(",") if i]
    if not ids:
        raise HTTPException(status_code=400, detail="No run_ids provided")
    runs = await db.allocation_runs.find(
        {"id": {"$in": ids}, "user_id": current["id"]},
        {"_id": 0},
    ).to_list(50)
    runs_by_id = {r["id"]: r for r in runs}
    ordered = [runs_by_id[i] for i in ids if i in runs_by_id]

    # Build debtor -> {run_id: status}
    matrix: Dict[str, Dict[str, Any]] = {}
    for r in ordered:
        for inv in r["invoice_rows"]:
            debtor = (inv.get("debtor") or "Unknown").strip() or "Unknown"
            row = matrix.setdefault(debtor, {"debtor": debtor, "runs": {}})
            entry = row["runs"].get(r["id"], {"status": "absent", "outstanding": 0, "invoices": []})
            entry["status"] = inv["status"]
            entry["outstanding"] = round(entry["outstanding"] + inv["remaining"], 2)
            entry["invoices"].append(inv["number"])
            row["runs"][r["id"]] = entry

    def unmatched_count(row):
        return sum(1 for r in ordered if row["runs"].get(r["id"], {}).get("status") == "unmatched")

    rows = list(matrix.values())
    rows.sort(key=lambda x: -unmatched_count(x))

    consistently_unmatched = [
        row["debtor"] for row in rows
        if all(row["runs"].get(r["id"], {}).get("status") == "unmatched" for r in ordered)
    ]

    return {
        "runs": [{"id": r["id"], "name": r["name"], "period": r["period"], "created_at": r["created_at"]} for r in ordered],
        "rows": rows,
        "consistently_unmatched": consistently_unmatched,
    }


# ----- Debtor report -----
@api.get("/debtors")
async def debtors(threshold: float = 0.0, current=Depends(get_current_user)):
    runs = await db.allocation_runs.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    agg: Dict[str, Dict[str, Any]] = {}
    for r in runs:
        for inv in r["invoice_rows"]:
            debtor = (inv.get("debtor") or "Unknown").strip() or "Unknown"
            d = agg.setdefault(debtor, {
                "debtor": debtor, "total_outstanding": 0.0, "total_allocated": 0.0,
                "invoice_count": 0, "runs": [],
            })
            d["total_outstanding"] = round(d["total_outstanding"] + inv["remaining"], 2)
            allocated = round(sum(m["amount"] for m in inv["matches"]), 2)
            d["total_allocated"] = round(d["total_allocated"] + allocated, 2)
            d["invoice_count"] += 1
            d["runs"].append({
                "run_id": r["id"], "run_name": r["name"], "period": r["period"],
                "status": inv["status"], "outstanding": inv["remaining"], "allocated": allocated,
                "invoice_number": inv["number"],
            })
    rows = list(agg.values())
    for row in rows:
        row["flagged"] = bool(threshold) and row["total_outstanding"] >= threshold
    rows.sort(key=lambda x: (-int(x["flagged"]), -x["total_outstanding"]))
    return {
        "threshold": threshold,
        "rows": rows,
        "total_debtors": len(rows),
        "flagged_count": sum(1 for r in rows if r["flagged"]),
        "total_outstanding": round(sum(r["total_outstanding"] for r in rows), 2),
        "total_allocated": round(sum(r["total_allocated"] for r in rows), 2),
    }


@api.get("/debtors/export")
async def debtors_export(threshold: float = 0.0, current=Depends(get_current_user)):
    report = await debtors(threshold, current)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Debtor", "Flagged", "Total Outstanding (£)", "Total Allocated (£)", "Invoice Count", "Runs Appeared"])
    for r in report["rows"]:
        writer.writerow([
            r["debtor"], "YES" if r["flagged"] else "",
            f"{r['total_outstanding']:.2f}", f"{r['total_allocated']:.2f}",
            r["invoice_count"], len(r["runs"]),
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.read()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="debtor-report.csv"'},
    )


# ----- Audit -----
@api.get("/audit")
async def audit(run_id: Optional[str] = None, current=Depends(get_current_user)):
    q: Dict[str, Any] = {"user_id": current["id"]}
    if run_id:
        q["run_id"] = run_id
    logs = await db.audit_logs.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    summary = {
        "total": len(logs),
        "create_run": sum(1 for x in logs if x["action"] == "create_run"),
        "delete_run": sum(1 for x in logs if x["action"] == "delete_run"),
        "manual_link": sum(1 for x in logs if x["action"] == "manual_link"),
    }
    return {"summary": summary, "logs": logs}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.allocation_runs.create_index([("user_id", 1), ("created_at", -1)])
    await db.audit_logs.create_index([("user_id", 1), ("created_at", -1)])
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@ebbusiness.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "Admin@2026!")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "email": admin_email,
            "name": "EB Admin",
            "password_hash": hash_password(admin_password),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info(f"Seeded admin: {admin_email}")


@app.on_event("shutdown")
async def shutdown():
    client.close()
