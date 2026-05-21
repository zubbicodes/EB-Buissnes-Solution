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

from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, status, BackgroundTasks
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr
from rapidfuzz import fuzz, process as rf_process, utils as rf_utils
from collections import defaultdict


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
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=30), "type": "refresh"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=False, samesite="lax", max_age=7 * 24 * 3600, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=False, samesite="lax", max_age=30 * 24 * 3600, path="/")

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
    bank_account: Optional[str] = None
    bank_transaction_type: Optional[str] = None
    # invoice
    invoice_number: Optional[str] = None
    invoice_debtor: Optional[str] = None
    invoice_amount: Optional[str] = None
    invoice_date: Optional[str] = None
    invoice_outstanding: Optional[str] = None
    invoice_due_date: Optional[str] = None
    invoice_customer_reference: Optional[str] = None

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
    # Strip BOM that some Excel exports prepend
    if text.startswith("\ufeff"):
        text = text[1:]
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
    check_col(bank_rows, mapping.bank_account, "bank", "account", required=False)
    check_col(bank_rows, mapping.bank_transaction_type, "bank", "transaction_type", required=False)

    check_col(inv_rows, mapping.invoice_number, "invoice", "number")
    check_col(inv_rows, mapping.invoice_debtor, "invoice", "debtor")
    check_col(inv_rows, mapping.invoice_amount, "invoice", "amount")
    check_col(inv_rows, mapping.invoice_outstanding, "invoice", "outstanding", required=False)
    check_col(inv_rows, mapping.invoice_date, "invoice", "date", required=False)
    check_col(inv_rows, mapping.invoice_due_date, "invoice", "due_date", required=False)
    check_col(inv_rows, mapping.invoice_customer_reference, "invoice", "customer_reference", required=False)

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

    # Invalid date format warnings
    def check_dates(rows, col, scope):
        if not col:
            return
        bad = 0
        for i, r in enumerate(rows, start=2):
            raw = r.get(col, "").strip()
            if raw and parse_date_safe(raw) is None:
                bad += 1
                if bad <= 3:
                    warnings.append({"scope": scope, "row": i, "message": f"Unrecognised date format in '{col}': '{raw}'"})
        if bad > 3:
            warnings.append({"scope": scope, "message": f"{bad} row(s) total have unparseable dates in '{col}'."})
    check_dates(bank_rows, mapping.bank_date, "bank")
    check_dates(inv_rows, mapping.invoice_date, "invoice")
    check_dates(inv_rows, mapping.invoice_due_date, "invoice")

    # Missing debtor names
    if mapping.invoice_debtor and inv_rows:
        missing_debtor = sum(1 for r in inv_rows if not r.get(mapping.invoice_debtor, "").strip())
        if missing_debtor:
            warnings.append({"scope": "invoice", "message": f"{missing_debtor} invoice row(s) have no debtor name — fuzzy matching will skip these."})

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


CORP_SUFFIXES = {
    "ltd", "limited", "llc", "inc", "incorporated", "co", "company", "plc",
    "corp", "corporation", "gmbh", "sa", "ag", "bv", "nv", "srl", "spa", "llp", "lp", "kg",
}

STOP_TOKENS = {"the", "and", "of", "for", "to", "from", "payment", "transfer",
               "bacs", "chq", "ref", "inv", "invoice", "kref", "receipt", "deposit"}


def distinctive_tokens(s: str) -> List[str]:
    """Tokens of a debtor name that are useful for substring matching: >=4 chars, not corp suffix, not stop word."""
    if not s:
        return []
    return [t.lower() for t in re.findall(r"[A-Za-z0-9]+", s)
            if len(t) >= 4 and t.lower() not in CORP_SUFFIXES and t.lower() not in STOP_TOKENS]


def fmt_money(v: float) -> str:
    try:
        return f"£{float(v):,.2f}"
    except (TypeError, ValueError):
        return str(v)


def strip_corp_suffix(s: str) -> str:
    """Remove generic corporate suffix tokens for tighter fuzzy comparison."""
    if not s:
        return ""
    tokens = re.findall(r"[A-Za-z0-9]+", s)
    keep = [t for t in tokens if t.lower() not in CORP_SUFFIXES]
    return " ".join(keep) if keep else s


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

    # Inverted token index: distinctive debtor token -> list of invoice indices.
    # Used to pre-filter candidates for Pass 2 + Pass 2.5 (huge speedup on large invoice sets).
    token_index: Dict[str, List[int]] = defaultdict(list)
    debtor_tokens_cache: List[List[str]] = []
    for idx, inv in enumerate(invoice_rows):
        toks = distinctive_tokens(inv["debtor"]) if inv["debtor"] else []
        debtor_tokens_cache.append(toks)
        for t in toks:
            token_index[t].append(idx)

    # Pass 1: invoice reference match (FULL-class candidate when fully consumed by reference matches)
    for b in bank_rows:
        if b["remaining"] <= 0:
            continue
        refs = extract_refs(b["reference"])
        hit_invoices = []
        seen_ids = set()
        for ref in refs:
            cands = []
            if ref in inv_by_norm:
                cands = inv_by_norm[ref]
            else:
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
                "reason": f"Invoice reference '{inv['number']}' found in bank text",
            }
            b["matches"].append(link)
            inv["matches"].append(link)

    # Pass 2: fuzzy debtor name (WRatio, threshold 70). Token pre-filter + rapidfuzz.process.extract.
    for b in bank_rows:
        if b["remaining"] <= 0:
            continue
        compare_text = " ".join([t for t in [b.get("reference") or "", b.get("payer") or ""] if t]).strip()
        compare_text_clean = strip_corp_suffix(compare_text)
        if not compare_text_clean:
            continue
        # Pre-filter: candidate invoices share at least one distinctive token with bank text
        bank_text_lc = compare_text.lower()
        bank_tokens_set = set(distinctive_tokens(compare_text))
        cand_idx_set = set()
        for t in bank_tokens_set:
            cand_idx_set.update(token_index.get(t, ()))
        if not cand_idx_set:
            continue
        candidates = [(i, invoice_rows[i]) for i in cand_idx_set
                      if invoice_rows[i]["remaining"] > 0 and invoice_rows[i]["debtor"]]
        if not candidates:
            continue
        debtor_cleans = [strip_corp_suffix(c["debtor"]) for _, c in candidates]
        # rapidfuzz batch extract — C-speed
        matches = rf_process.extract(
            compare_text_clean,
            debtor_cleans,
            scorer=fuzz.WRatio,
            processor=rf_utils.default_process,
            score_cutoff=70,
            limit=10,
        )
        # matches is list of (debtor_clean, score, candidate_index_within_debtor_cleans)
        scored = []
        for _, score, ci in matches:
            scored.append((score, candidates[ci][1]))
        # Sort by score desc, then by remaining desc for deterministic allocation
        scored.sort(key=lambda x: (-x[0], -x[1]["remaining"]))
        plausible_count = len(scored)
        for score, inv in scored:
            if b["remaining"] <= 0:
                break
            if inv["remaining"] <= 0:
                continue
            alloc = round(min(b["remaining"], inv["remaining"]), 2)
            if alloc <= 0:
                continue
            b["remaining"] = round(b["remaining"] - alloc, 2)
            inv["remaining"] = round(inv["remaining"] - alloc, 2)
            confidence = "high" if score >= 95 else "medium" if score >= 85 else "low"
            link = {
                "bank_id": b["id"],
                "invoice_id": inv["id"],
                "amount": alloc,
                "method": "debtor_name",
                "confidence": confidence,
                "score": round(score, 1),
                "ambiguous": plausible_count > 1,
                "reason": f"Debtor name similarity {round(score, 1)}%"
                          + (f" — {plausible_count} plausible candidates" if plausible_count > 1 else " — unique candidate"),
            }
            b["matches"].append(link)
            inv["matches"].append(link)

    # Pass 2.5: token-substring fallback for noisy bank text. Uses the same inverted index.
    for b in bank_rows:
        if b["remaining"] <= 0:
            continue
        bank_text_lc = " ".join([t for t in [b.get("reference") or "", b.get("payer") or ""] if t]).lower()
        if not bank_text_lc:
            continue
        if any(m["method"] == "debtor_name" for m in b["matches"]):
            continue
        bank_tokens_set = set(distinctive_tokens(bank_text_lc))
        if not bank_tokens_set:
            continue
        # Count token hits per candidate invoice via inverted index
        hit_counts: Dict[int, int] = defaultdict(int)
        for t in bank_tokens_set:
            for i in token_index.get(t, ()):
                hit_counts[i] += 1
        scored = []
        already_linked_inv_ids = {m["invoice_id"] for m in b["matches"]}
        for i, hits in hit_counts.items():
            if hits < 2:
                continue
            inv = invoice_rows[i]
            if inv["remaining"] <= 0 or not inv["debtor"]:
                continue
            if inv["id"] in already_linked_inv_ids:
                continue
            total_toks = len(debtor_tokens_cache[i])
            score = fuzz.partial_token_set_ratio(bank_text_lc, inv["debtor"].lower())
            scored.append((score, hits, total_toks, inv))
        scored.sort(key=lambda x: (-x[1], -x[0], -x[3]["remaining"]))
        plausible_count = len(scored)
        for score, hits, total_toks, inv in scored:
            if b["remaining"] <= 0:
                break
            alloc = round(min(b["remaining"], inv["remaining"]), 2)
            if alloc <= 0:
                continue
            b["remaining"] = round(b["remaining"] - alloc, 2)
            inv["remaining"] = round(inv["remaining"] - alloc, 2)
            link = {
                "bank_id": b["id"],
                "invoice_id": inv["id"],
                "amount": alloc,
                "method": "debtor_tokens",
                "confidence": "low",
                "score": round(score, 1),
                "ambiguous": plausible_count > 1,
                "reason": f"{hits}/{total_toks} distinctive debtor tokens found in bank text"
                          + (f" — {plausible_count} plausible candidates" if plausible_count > 1 else ""),
            }
            b["matches"].append(link)
            inv["matches"].append(link)

    # ---- Final classification (finance-grade strict rules) ----
    for b in bank_rows:
        ms = b["matches"]
        if not ms:
            b["status"] = "unmatched"
            b["confidence"] = None
            b["reason"] = "No invoice reference detected and no debtor-name match above threshold"
            continue

        ref_methods = [m for m in ms if m["method"] == "reference"]
        # Strict FULL-promotion uses only WRatio-based debtor_name matches, NOT debtor_tokens (Pass 2.5).
        debtor_name_methods = [m for m in ms if m["method"] == "debtor_name"]
        debtor_methods = [m for m in ms if m["method"] in ("debtor_name", "debtor_tokens")]
        fully_consumed = b["remaining"] <= 0.005

        # Rule A: pure reference match, fully consumed
        rule_a = bool(ref_methods) and not debtor_methods and fully_consumed
        # Rule B: single debtor_name match (NOT debtor_tokens) with very high confidence + exact amount + unique candidate
        rule_b = (
            len(ms) == 1
            and not ref_methods
            and debtor_name_methods
            and debtor_name_methods[0].get("score", 0) >= 95
            and debtor_name_methods[0].get("ambiguous") is False
            and fully_consumed
        )
        # Rule C: reference match + supporting debtor_name match (>=85, NOT debtor_tokens) + fully consumed
        rule_c = (
            bool(ref_methods)
            and debtor_name_methods
            and fully_consumed
            and max((m.get("score", 0) for m in debtor_name_methods), default=0) >= 85
        )

        if rule_a or rule_b or rule_c:
            b["status"] = "full"
            reason_parts = []
            if rule_a:
                refs = ", ".join(m["reason"].split("'")[1] for m in ref_methods if "'" in m.get("reason", ""))
                reason_parts.append(f"Invoice reference{'s' if len(ref_methods) > 1 else ''} {refs} matched and exact amount consumed")
            if rule_b:
                m = debtor_name_methods[0]
                reason_parts.append(f"Unique debtor match at {m['score']}% with exact amount")
            if rule_c and not rule_a:
                best_d = max(debtor_name_methods, key=lambda x: x.get("score", 0))
                refs = ", ".join(m["reason"].split("'")[1] for m in ref_methods if "'" in m.get("reason", ""))
                reason_parts.append(f"Reference {refs} confirmed by debtor name ({best_d['score']}%) and exact amount")
            b["reason"] = " · ".join(reason_parts)
            b["confidence"] = "high"
        else:
            b["status"] = "partial"
            # Highest confidence among matches, capped to "medium" unless reference-based
            conf_order = {"high": 3, "medium": 2, "low": 1}
            best = max((m["confidence"] for m in ms), key=lambda c: conf_order.get(c, 0))
            if not ref_methods and best == "high":
                # Demote debtor-only matches with score 95+ but ambiguous or partial-amount
                best = "medium"
            b["confidence"] = best
            ambiguous = any(m.get("ambiguous") for m in debtor_methods)
            bits = []
            if ref_methods and not fully_consumed:
                bits.append(f"Reference match but {fmt_money(b['remaining'])} unallocated")
            if debtor_methods:
                m_best = max(debtor_methods, key=lambda x: x.get("score", 0))
                if m_best.get("method") == "debtor_tokens":
                    bits.append(f"Token-substring match {m_best.get('score', '?')}% (low confidence — review required)")
                else:
                    bits.append(f"Debtor name similarity {m_best.get('score', '?')}%")
                if ambiguous:
                    bits.append("multiple candidates — needs review")
            if not ref_methods and not debtor_methods:
                bits.append("partial reference allocation")
            b["reason"] = "; ".join(bits) or "Requires review"

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
    return {"app": "Receivables Reconciliation Platform", "company": "EB Business Solutions Limited"}


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
    return {"id": user_id, "email": email, "name": payload.name, "access_token": access, "refresh_token": refresh}


@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access = create_access_token(user["id"], email)
    refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, refresh)
    return {"id": user["id"], "email": user["email"], "name": user.get("name", ""), "access_token": access, "refresh_token": refresh}


@api.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api.post("/auth/refresh")
async def refresh_session(request: Request, response: Response):
    refresh = request.cookies.get("refresh_token")
    if not refresh:
        raise HTTPException(status_code=401, detail="No refresh token")
    try:
        payload = jwt.decode(refresh, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Refresh token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    access = create_access_token(user["id"], user["email"])
    new_refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, new_refresh)
    return user


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


# ----- Split-collection storage helpers -----
# For large runs (e.g. 29k+ invoice rows) we cannot embed everything in the allocation_runs doc
# because of the 16 MB BSON limit. Bank/invoice rows live in their own collections, scoped by run_id.

CHUNK = 1000  # bulk insert chunk size

async def _bulk_insert_rows(collection, run_id: str, user_id: str, rows: List[Dict[str, Any]]):
    if not rows:
        return
    for start in range(0, len(rows), CHUNK):
        batch = [{**r, "run_id": run_id, "user_id": user_id} for r in rows[start:start + CHUNK]]
        await collection.insert_many(batch, ordered=False)


async def save_run_rows(run_id: str, user_id: str, bank_rows: List[Dict[str, Any]], invoice_rows: List[Dict[str, Any]]):
    await _bulk_insert_rows(db.allocation_bank_rows, run_id, user_id, bank_rows)
    await _bulk_insert_rows(db.allocation_invoice_rows, run_id, user_id, invoice_rows)


async def load_all_bank_rows(run_id: str, user_id: str) -> List[Dict[str, Any]]:
    return await db.allocation_bank_rows.find(
        {"run_id": run_id, "user_id": user_id}, {"_id": 0, "run_id": 0, "user_id": 0}
    ).sort("idx", 1).to_list(None)


async def load_all_invoice_rows(run_id: str, user_id: str) -> List[Dict[str, Any]]:
    return await db.allocation_invoice_rows.find(
        {"run_id": run_id, "user_id": user_id}, {"_id": 0, "run_id": 0, "user_id": 0}
    ).sort("idx", 1).to_list(None)


async def delete_run_rows(run_id: str, user_id: str):
    await db.allocation_bank_rows.delete_many({"run_id": run_id, "user_id": user_id})
    await db.allocation_invoice_rows.delete_many({"run_id": run_id, "user_id": user_id})


def enrich_matches(bank_rows: List[Dict[str, Any]], invoice_rows: List[Dict[str, Any]]):
    """Denormalise invoice_number / invoice_debtor into each match for self-contained display + paginated reads."""
    inv_by_id = {inv["id"]: inv for inv in invoice_rows}
    for b in bank_rows:
        for m in b.get("matches", []):
            inv = inv_by_id.get(m.get("invoice_id"))
            if inv:
                m["invoice_number"] = inv.get("number")
                m["invoice_debtor"] = inv.get("debtor")
    for inv in invoice_rows:
        for m in inv.get("matches", []):
            # noop; bank denormalisation not strictly needed for our UI
            pass


async def _process_run_async(run_id: str, user_id: str, bank_csv: str, invoice_csv: str, mapping_dict: Dict[str, Any]):
    """Background processor for large allocation runs."""
    try:
        mapping = ColumnMapping(**mapping_dict)
        bank_raw = parse_csv(bank_csv)
        inv_raw = parse_csv(invoice_csv)
        bank_rows, invoice_rows, stats = run_matching(bank_raw, inv_raw, mapping)
        enrich_matches(bank_rows, invoice_rows)
        await save_run_rows(run_id, user_id, bank_rows, invoice_rows)
        await db.allocation_runs.update_one(
            {"id": run_id, "user_id": user_id},
            {"$set": {
                "stats": stats,
                "status": "done",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        await write_audit(user_id, run_id, "create_run", {"stats": stats, "async": True})
    except Exception as e:
        logger.exception("Async run failed: %s", e)
        await db.allocation_runs.update_one(
            {"id": run_id, "user_id": user_id},
            {"$set": {"status": "error", "error": str(e)}},
        )
        await write_audit(user_id, run_id, "create_run_failed", {"error": str(e)})


@api.post("/allocations")
async def create_allocation(payload: AllocationCreate, background: BackgroundTasks, current=Depends(get_current_user)):
    validation = validate_csvs(payload.bank_csv, payload.invoice_csv, payload.mapping)
    if not validation["ok"]:
        raise HTTPException(status_code=400, detail={"message": "CSV validation failed", "validation": validation})
    if validation["warnings"] and not payload.proceed_with_warnings:
        raise HTTPException(status_code=400, detail={"message": "CSV has warnings", "validation": validation})

    bank_row_count = validation.get("bank_row_count", 0)
    invoice_row_count = validation.get("invoice_row_count", 0)
    # Anything > 2000 on either side runs in the background to keep HTTP fast
    is_large = bank_row_count > 2000 or invoice_row_count > 2000

    run_id = str(uuid.uuid4())
    base_doc = {
        "id": run_id,
        "user_id": current["id"],
        "name": payload.name,
        "period": payload.period,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "mapping": payload.mapping.model_dump(),
        "status": "processing" if is_large else "done",
    }

    if is_large:
        await db.allocation_runs.insert_one({**base_doc, "stats": {
            "total_bank": bank_row_count, "total_invoices": invoice_row_count,
            "fully_matched": 0, "partially_matched": 0, "unmatched_bank": 0,
            "unmatched_invoices": 0, "total_allocated": 0.0, "total_outstanding": 0.0,
        }})
        background.add_task(_process_run_async, run_id, current["id"], payload.bank_csv, payload.invoice_csv, payload.mapping.model_dump())
        doc = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
        return doc

    bank_raw = parse_csv(payload.bank_csv)
    inv_raw = parse_csv(payload.invoice_csv)
    bank_rows, invoice_rows, stats = run_matching(bank_raw, inv_raw, payload.mapping)
    enrich_matches(bank_rows, invoice_rows)

    doc = {**base_doc, "stats": stats}
    await db.allocation_runs.insert_one(doc)
    await save_run_rows(run_id, current["id"], bank_rows, invoice_rows)
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
    """Returns the run header (stats + mapping + status), NOT the full row data.
    Use /allocations/{id}/rows for paginated row data."""
    run = await db.allocation_runs.find_one(
        {"id": run_id, "user_id": current["id"]},
        {"_id": 0, "bank_rows": 0, "invoice_rows": 0},
    )
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@api.get("/allocations/{run_id}/rows")
async def get_allocation_rows(
    run_id: str,
    bucket: str = "full",
    page: int = 1,
    page_size: int = 50,
    search: str = "",
    current=Depends(get_current_user),
):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0, "id": 1})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    page = max(1, page)
    page_size = max(1, min(500, page_size))
    skip = (page - 1) * page_size

    if bucket in ("full", "partial", "unmatched_bank"):
        status_map = {"full": "full", "partial": "partial", "unmatched_bank": "unmatched"}
        q: Dict[str, Any] = {"run_id": run_id, "user_id": current["id"], "status": status_map[bucket]}
        if search:
            esc = re.escape(search)
            q["$or"] = [
                {"reference": {"$regex": esc, "$options": "i"}},
                {"payer": {"$regex": esc, "$options": "i"}},
                {"matches.invoice_number": {"$regex": esc, "$options": "i"}},
                {"matches.invoice_debtor": {"$regex": esc, "$options": "i"}},
            ]
        total = await db.allocation_bank_rows.count_documents(q)
        rows = await db.allocation_bank_rows.find(
            q, {"_id": 0, "run_id": 0, "user_id": 0}
        ).sort("idx", 1).skip(skip).limit(page_size).to_list(page_size)
    elif bucket == "unmatched_invoice":
        q = {"run_id": run_id, "user_id": current["id"], "status": "unmatched"}
        if search:
            esc = re.escape(search)
            q["$or"] = [
                {"number": {"$regex": esc, "$options": "i"}},
                {"debtor": {"$regex": esc, "$options": "i"}},
            ]
        total = await db.allocation_invoice_rows.count_documents(q)
        rows = await db.allocation_invoice_rows.find(
            q, {"_id": 0, "run_id": 0, "user_id": 0}
        ).sort("idx", 1).skip(skip).limit(page_size).to_list(page_size)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown bucket: {bucket}")

    return {"rows": rows, "page": page, "page_size": page_size, "total": total, "bucket": bucket}


@api.delete("/allocations/{run_id}")
async def delete_allocation(run_id: str, current=Depends(get_current_user)):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0, "name": 1})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    await db.allocation_runs.delete_one({"id": run_id, "user_id": current["id"]})
    await delete_run_rows(run_id, current["id"])
    await write_audit(current["id"], run_id, "delete_run", {"name": run.get("name")})
    return {"ok": True}


@api.get("/allocations/{run_id}/export")
async def export_allocation(run_id: str, current=Depends(get_current_user)):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    async def stream():
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["Bank Date", "Bank Reference", "Bank Payer", "Bank Amount (£)",
                         "Status", "Confidence", "Why matched?", "Matched Invoices", "Allocated (£)", "Bank Remaining (£)"])
        yield out.getvalue()
        async for b in db.allocation_bank_rows.find(
            {"run_id": run_id, "user_id": current["id"]}, {"_id": 0}
        ).sort("idx", 1):
            out = io.StringIO()
            writer = csv.writer(out)
            nums = ", ".join((m.get("invoice_number") or "?") for m in b.get("matches", []))
            allocated = round(sum(m["amount"] for m in b.get("matches", [])), 2)
            writer.writerow([
                b.get("date") or "",
                b.get("reference") or "",
                b.get("payer") or "",
                f"{b['amount']:.2f}",
                b["status"],
                b.get("confidence") or "",
                b.get("reason") or "",
                nums,
                f"{allocated:.2f}",
                f"{b['remaining']:.2f}",
            ])
            yield out.getvalue()

    return StreamingResponse(
        stream(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="allocation-{run["name"]}.csv"'},
    )


@api.get("/allocations/{run_id}/export-xlsx")
async def export_allocation_xlsx(run_id: str, current=Depends(get_current_user)):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    wb = Workbook()
    ws = wb.active
    ws.title = "Allocations"
    hdr_font = Font(bold=True, color="FFFFFF")
    hdr_fill = PatternFill("solid", fgColor="0F172A")
    status_fills = {
        "full": PatternFill("solid", fgColor="DCFCE7"),
        "partial": PatternFill("solid", fgColor="FEF3C7"),
        "unmatched": PatternFill("solid", fgColor="FEE2E2"),
    }
    headers = ["Bank Date", "Bank Reference", "Bank Payer", "Bank Amount", "Status",
               "Confidence", "Why matched?", "Matched Invoices", "Allocated", "Bank Remaining"]
    for col, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=col, value=h)
        c.font = hdr_font
        c.fill = hdr_fill
        c.alignment = Alignment(horizontal="left")

    r_idx = 2
    async for b in db.allocation_bank_rows.find({"run_id": run_id, "user_id": current["id"]}, {"_id": 0}).sort("idx", 1):
        nums = ", ".join((m.get("invoice_number") or "?") for m in b.get("matches", []))
        allocated = round(sum(m["amount"] for m in b.get("matches", [])), 2)
        vals = [b.get("date") or "", b.get("reference") or "", b.get("payer") or "",
                b["amount"], b["status"], b.get("confidence") or "", b.get("reason") or "",
                nums, allocated, b["remaining"]]
        for c_idx, v in enumerate(vals, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=v)
            if c_idx in (4, 9, 10):
                cell.number_format = '£#,##0.00'
            if status_fills.get(b["status"]):
                cell.fill = status_fills[b["status"]]
        r_idx += 1
    for i, w in enumerate([12, 28, 24, 14, 12, 12, 36, 28, 14, 14], start=1):
        ws.column_dimensions[chr(64 + i)].width = w

    ws2 = wb.create_sheet("Invoices")
    inv_headers = ["Invoice #", "Debtor", "Date", "Amount", "Outstanding", "Status"]
    for col, h in enumerate(inv_headers, start=1):
        c = ws2.cell(row=1, column=col, value=h)
        c.font = hdr_font
        c.fill = hdr_fill
    r_idx = 2
    async for inv in db.allocation_invoice_rows.find({"run_id": run_id, "user_id": current["id"]}, {"_id": 0}).sort("idx", 1):
        vals = [inv["number"], inv.get("debtor") or "", inv.get("date") or "",
                inv["amount"], inv["remaining"], inv["status"]]
        for c_idx, v in enumerate(vals, start=1):
            cell = ws2.cell(row=r_idx, column=c_idx, value=v)
            if c_idx in (4, 5):
                cell.number_format = '£#,##0.00'
            if status_fills.get(inv["status"]):
                cell.fill = status_fills[inv["status"]]
        r_idx += 1
    for i, w in enumerate([14, 28, 12, 14, 14, 12], start=1):
        ws2.column_dimensions[chr(64 + i)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="allocation-{run["name"]}.xlsx"'},
    )


@api.post("/allocations/{run_id}/manual-link")
async def manual_link(run_id: str, payload: ManualLinkIn, current=Depends(get_current_user)):
    run = await db.allocation_runs.find_one({"id": run_id, "user_id": current["id"]}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    bank = await db.allocation_bank_rows.find_one(
        {"run_id": run_id, "user_id": current["id"], "id": payload.bank_row_id}, {"_id": 0, "run_id": 0, "user_id": 0}
    )
    inv = await db.allocation_invoice_rows.find_one(
        {"run_id": run_id, "user_id": current["id"], "id": payload.invoice_row_id}, {"_id": 0, "run_id": 0, "user_id": 0}
    )
    if not bank or not inv:
        raise HTTPException(status_code=404, detail="Bank or invoice row not found")
    amt = round(min(payload.amount, bank["remaining"], inv["remaining"]), 2)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Nothing remaining to allocate")

    link = {
        "bank_id": bank["id"], "invoice_id": inv["id"], "amount": amt,
        "method": "manual", "confidence": "manual",
        "reason": "Manually linked by user",
        "invoice_number": inv.get("number"),
        "invoice_debtor": inv.get("debtor"),
    }
    bank.setdefault("matches", []).append(link)
    inv.setdefault("matches", []).append(link)
    bank["remaining"] = round(bank["remaining"] - amt, 2)
    inv["remaining"] = round(inv["remaining"] - amt, 2)
    bank["status"] = "full" if bank["remaining"] <= 0.005 else "partial"
    inv["status"] = "full" if inv["remaining"] <= 0.005 else "partial"

    await db.allocation_bank_rows.update_one(
        {"run_id": run_id, "user_id": current["id"], "id": bank["id"]},
        {"$set": {"matches": bank["matches"], "remaining": bank["remaining"],
                  "status": bank["status"], "reason": "Includes manual override"}},
    )
    await db.allocation_invoice_rows.update_one(
        {"run_id": run_id, "user_id": current["id"], "id": inv["id"]},
        {"$set": {"matches": inv["matches"], "remaining": inv["remaining"], "status": inv["status"]}},
    )

    # Recompute stats from the source of truth (the split collections)
    stats = await _recompute_stats(run_id, current["id"])
    await db.allocation_runs.update_one(
        {"id": run_id, "user_id": current["id"]},
        {"$set": {"stats": stats}},
    )
    await write_audit(current["id"], run_id, "manual_link", {
        "bank_reference": bank.get("reference"),
        "invoice_number": inv.get("number"),
        "amount": amt,
    })
    return {"ok": True, "stats": stats, "bank": bank, "invoice": inv}


async def _recompute_stats(run_id: str, user_id: str) -> Dict[str, Any]:
    q = {"run_id": run_id, "user_id": user_id}
    total_bank = await db.allocation_bank_rows.count_documents(q)
    total_invoices = await db.allocation_invoice_rows.count_documents(q)
    full = await db.allocation_bank_rows.count_documents({**q, "status": "full"})
    partial = await db.allocation_bank_rows.count_documents({**q, "status": "partial"})
    unmatched_bank = await db.allocation_bank_rows.count_documents({**q, "status": "unmatched"})
    unmatched_inv = await db.allocation_invoice_rows.count_documents({**q, "status": "unmatched"})
    agg_alloc = await db.allocation_bank_rows.aggregate([
        {"$match": q},
        {"$unwind": {"path": "$matches", "preserveNullAndEmptyArrays": False}},
        {"$group": {"_id": None, "total": {"$sum": "$matches.amount"}}},
    ]).to_list(1)
    total_allocated = round(agg_alloc[0]["total"], 2) if agg_alloc else 0.0
    agg_out = await db.allocation_invoice_rows.aggregate([
        {"$match": q},
        {"$group": {"_id": None, "total": {"$sum": "$remaining"}}},
    ]).to_list(1)
    total_outstanding = round(agg_out[0]["total"], 2) if agg_out else 0.0
    return {
        "total_bank": total_bank, "total_invoices": total_invoices,
        "fully_matched": full, "partially_matched": partial,
        "unmatched_bank": unmatched_bank, "unmatched_invoices": unmatched_inv,
        "total_allocated": total_allocated, "total_outstanding": total_outstanding,
    }


# ----- Compare -----
@api.get("/compare")
async def compare(run_ids: str, current=Depends(get_current_user)):
    ids = [i for i in run_ids.split(",") if i]
    if not ids:
        raise HTTPException(status_code=400, detail="No run_ids provided")
    runs = await db.allocation_runs.find(
        {"id": {"$in": ids}, "user_id": current["id"]},
        {"_id": 0, "id": 1, "name": 1, "period": 1, "created_at": 1},
    ).to_list(50)
    runs_by_id = {r["id"]: r for r in runs}
    ordered = [runs_by_id[i] for i in ids if i in runs_by_id]

    matrix: Dict[str, Dict[str, Any]] = {}
    for r in ordered:
        async for inv in db.allocation_invoice_rows.find(
            {"run_id": r["id"], "user_id": current["id"]},
            {"_id": 0, "debtor": 1, "remaining": 1, "status": 1, "number": 1},
        ):
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
    runs = await db.allocation_runs.find(
        {"user_id": current["id"]},
        {"_id": 0, "id": 1, "name": 1, "period": 1},
    ).sort("created_at", -1).to_list(500)
    agg: Dict[str, Dict[str, Any]] = {}
    for r in runs:
        async for inv in db.allocation_invoice_rows.find(
            {"run_id": r["id"], "user_id": current["id"]},
            {"_id": 0, "debtor": 1, "remaining": 1, "matches": 1, "status": 1, "number": 1},
        ):
            debtor = (inv.get("debtor") or "Unknown").strip() or "Unknown"
            d = agg.setdefault(debtor, {
                "debtor": debtor, "total_outstanding": 0.0, "total_allocated": 0.0,
                "invoice_count": 0, "runs": [],
            })
            d["total_outstanding"] = round(d["total_outstanding"] + inv["remaining"], 2)
            allocated = round(sum(m["amount"] for m in inv.get("matches", [])), 2)
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
    await db.allocation_runs.create_index([("id", 1), ("user_id", 1)])
    await db.allocation_bank_rows.create_index([("run_id", 1), ("user_id", 1), ("idx", 1)])
    await db.allocation_bank_rows.create_index([("run_id", 1), ("user_id", 1), ("status", 1)])
    await db.allocation_bank_rows.create_index([("run_id", 1), ("user_id", 1), ("id", 1)])
    await db.allocation_invoice_rows.create_index([("run_id", 1), ("user_id", 1), ("idx", 1)])
    await db.allocation_invoice_rows.create_index([("run_id", 1), ("user_id", 1), ("status", 1)])
    await db.allocation_invoice_rows.create_index([("run_id", 1), ("user_id", 1), ("id", 1)])
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
