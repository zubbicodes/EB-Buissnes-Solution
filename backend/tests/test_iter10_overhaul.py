"""
Iteration 10 — backend regression tests for the strict-classification overhaul.
Covers:
  - WRatio case-insensitivity fix (processor=rf_utils.default_process)
  - Rule C: reference + supporting debtor name (>=85) + fully consumed => FULL
  - Pass 2.5: token-substring fallback (debtor_tokens method, low confidence, never FULL)
  - distinctive_tokens() filters corp suffixes & stop words
"""

import os
import sys
import uuid
import pytest
import requests

sys.path.insert(0, "/app/backend")

from rapidfuzz import fuzz, utils as rf_utils
from server import distinctive_tokens, CORP_SUFFIXES, STOP_TOKENS  # noqa: E402


def _resolve_base_url():
    url = os.environ.get("REACT_APP_BACKEND_URL")
    if url:
        return url.rstrip("/")
    env_path = "/app/frontend/.env"
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")


BASE_URL = _resolve_base_url()
ADMIN_EMAIL = "admin@ebbusiness.com"
ADMIN_PASSWORD = "Admin@2026!"

MAPPING = {
    "bank_date": "Date",
    "bank_reference": "Reference",
    "bank_amount": "Amount",
    "bank_payer": "Payer",
    "invoice_number": "Ref",
    "invoice_debtor": "Name",
    "invoice_amount": "Amount",
    "invoice_date": "Date",
    "invoice_outstanding": "Outstanding",
}


# --------- Unit tests (no HTTP) ---------

def test_wratio_case_insensitive_with_processor():
    # The bug: WRatio('GLOBEX CORP','Globex Corporation') == ~28 without processor
    # The fix: pass processor=rf_utils.default_process => ~90+
    no_proc = fuzz.WRatio("GLOBEX CORP", "Globex Corporation")
    with_proc = fuzz.WRatio("GLOBEX CORP", "Globex Corporation",
                            processor=rf_utils.default_process)
    assert with_proc >= 90, f"expected >=90 with processor, got {with_proc}"
    assert with_proc > no_proc + 30, f"processor must materially boost: no_proc={no_proc} with_proc={with_proc}"


def test_wratio_slark_construction_caps():
    s = fuzz.WRatio("SLARK CONSTRUCTION LIMITED BACS",
                    "Slark Construction Limited",
                    processor=rf_utils.default_process)
    assert s >= 90, f"expected >=90, got {s}"


def test_distinctive_tokens_filters_corp_suffix_and_stopwords():
    out = distinctive_tokens("ACME Corporation Ltd payment")
    # 'corporation', 'ltd', 'payment' must be stripped; 'acme' kept
    assert "acme" in out
    assert "ltd" not in out
    assert "corporation" not in out
    assert "payment" not in out


def test_distinctive_tokens_short_token_filter():
    # tokens <4 chars dropped
    out = distinctive_tokens("AB CD Ford Civil Engineering")
    assert "ab" not in out and "cd" not in out
    assert "ford" in out and "civil" in out and "engineering" in out


def test_distinctive_tokens_empty_safe():
    assert distinctive_tokens("") == []
    assert distinctive_tokens(None) == []
    # All-stopwords/suffixes => empty
    assert distinctive_tokens("the and Ltd payment bacs") == []


def test_corp_suffixes_set_includes_common():
    for x in ["ltd", "limited", "plc", "corp", "corporation", "inc", "llc"]:
        assert x in CORP_SUFFIXES


def test_stop_tokens_includes_bank_noise():
    for x in ["payment", "transfer", "bacs", "ref", "inv", "kref"]:
        assert x in STOP_TOKENS


# --------- HTTP integration fixtures ---------

@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    body = r.json()
    assert "access_token" in body
    return body["access_token"]


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    return s


def _run(client, bank_csv, invoice_csv, name="TEST_iter10"):
    payload = {
        "name": f"{name}_{uuid.uuid4().hex[:6]}",
        "period": "2026-01",
        "bank_csv": bank_csv,
        "invoice_csv": invoice_csv,
        "mapping": MAPPING,
        "proceed_with_warnings": True,
    }
    r = client.post(f"{BASE_URL}/api/allocations", json=payload, timeout=30)
    assert r.status_code == 200, f"create alloc failed: {r.status_code} {r.text}"
    return r.json()


def _find_bank(run, contains):
    for b in run["bank_rows"]:
        if contains.lower() in (b.get("reference") or "").lower():
            return b
    return None


# --------- BACKEND FIX 1: WRatio case fix end-to-end ---------
def test_allcaps_bank_text_now_matches_debtor_name(client):
    # 'GLOBEX CORP' all-caps vs 'Globex Corporation' mixed-case should now
    # score >=95 (with processor) and (because amount is exact, single candidate)
    # reach Rule B FULL.
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,500.00,GLOBEX CORP PAYMENT,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-CAPS01,Globex Corporation,500.00,500.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "GLOBEX")
    assert b is not None
    # Must be at least PARTIAL with a debtor_name link (i.e. fix worked)
    assert b["matches"], f"Pass 2 still failing on case mismatch: {b}"
    debtor_link = next((m for m in b["matches"] if m["method"] == "debtor_name"), None)
    assert debtor_link is not None, f"no debtor_name link — case fix not working: {b}"
    assert debtor_link["score"] >= 90, f"expected >=90 debtor score, got {debtor_link['score']}"
    # With score >=95 single candidate exact amount => Rule B FULL
    if debtor_link["score"] >= 95:
        assert b["status"] == "full", f"expected FULL, got {b['status']} reason={b['reason']}"
        assert b["confidence"] == "high"


# --------- BACKEND FIX 2: Rule C (ref + supporting debtor + exact) => FULL ---------
def test_rule_c_ref_plus_debtor_emmerson_multi_invoice(client):
    # User's positive-feedback canonical case:
    #   bank: 'EMMERSON TRANSPORT KREF FORD CIVIL ENG INV 2008666' £6600
    #   inv1: ref 2008666 Emmerson Transport £1200
    #   inv2: Ford Civil Engineering £5400 (no ref hit, debtor name found)
    # Expected: ref consumes 1200, debtor_name fuzzy on Ford Civil consumes 5400 -> fully consumed.
    # Rule C should kick in: ref + debtor>=85 + fully consumed => FULL.
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,6600.00,EMMERSON TRANSPORT KREF FORD CIVIL ENG INV 2008666,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,2008666,Emmerson Transport Ltd,1200.00,1200.00\n"
        "2025-12-02,2008667,Ford Civil Engineering,5400.00,5400.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "EMMERSON")
    assert b is not None
    assert b["status"] == "full", (
        f"Rule C failed — expected FULL, got {b['status']} "
        f"reason={b.get('reason')} matches={b.get('matches')}"
    )
    assert b["confidence"] == "high"
    assert "confirmed by debtor name" in b["reason"].lower() or "exact amount consumed" in b["reason"].lower()


def test_rule_c_does_not_promote_if_debtor_below_85(client):
    # Same shape but second invoice debtor name unrelated => no Rule C => PARTIAL.
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,6600.00,KREF ZZUNKNOWN INV 2008888,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,2008888,Alpha Ltd,1200.00,1200.00\n"
        "2025-12-02,2008889,Beta Trading Co,5400.00,5400.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "2008888")
    assert b is not None
    # The 1200 ref hits but 5400 remains unallocated (no debtor name match)
    assert b["status"] in ("partial",), (
        f"expected partial (no Rule C trigger), got {b['status']} reason={b['reason']}"
    )


# --------- BACKEND NEW: Pass 2.5 token-substring fallback ---------
def test_pass_2_5_debtor_tokens_low_confidence(client):
    # Bank text is very noisy: distinctive tokens of debtor name appear as substrings
    # but the WRatio scoring is too low (lots of noise) so Pass 2 misses it.
    # Two distinctive tokens 'ford' and 'civil' present in bank text.
    bank = (
        "Date,Amount,Reference,Payer\n"
        # Noise + 2 distinctive tokens; reference garbage; no exact debtor match
        "2026-01-05,5400.00,XX9988 RANDOM NOISE FORD CIVIL JOBNO 12-A,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-T01,Ford Civil Engineering Construction Ltd,5400.00,5400.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "FORD")
    assert b is not None, f"bank row missing; rows={[r.get('reference') for r in run['bank_rows']]}"
    # Expect at least one debtor_tokens or debtor_name match
    methods = [m["method"] for m in b["matches"]]
    assert "debtor_tokens" in methods or "debtor_name" in methods, (
        f"Pass 2.5 fallback did not surface debtor: matches={b['matches']} reason={b['reason']}"
    )
    # Must NEVER be FULL via debtor_tokens alone (low confidence)
    if "debtor_tokens" in methods and "debtor_name" not in methods and not any(m["method"] == "reference" for m in b["matches"]):
        assert b["status"] != "full", f"debtor_tokens promoted to FULL — must not: {b}"
        # confidence must stay low or medium
        assert b["confidence"] in ("low", "medium"), f"unexpected confidence {b['confidence']}"
        # match should record low confidence
        dt = [m for m in b["matches"] if m["method"] == "debtor_tokens"][0]
        assert dt["confidence"] == "low"
        assert "distinctive debtor tokens" in dt["reason"]


def test_pass_2_5_skipped_when_no_remaining(client):
    # If reference already fully consumed the bank, Pass 2.5 must not link anything.
    # NOTE: INVOICE_REF_PATTERN requires >=3 digits, hence INV-T0200.
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,500.00,INV-T0200 FORD CIVIL,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-T0200,Alpha Ltd,500.00,500.00\n"
        "2025-12-02,INV-T0300,Ford Civil Engineering Construction,9999.00,9999.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "INV-T0200")
    assert b is not None
    methods = [m["method"] for m in b["matches"]]
    assert "debtor_tokens" not in methods, f"Pass 2.5 should be skipped — bank fully consumed: {b}"
    assert b["status"] == "full"


def test_pass_2_5_needs_at_least_2_distinctive_tokens(client):
    # One distinctive token only => Pass 2.5 must not link.
    bank = (
        "Date,Amount,Reference,Payer\n"
        "2026-01-05,1000.00,RANDOM CONSTR NOISE,\n"  # only 'constr' (<=may be 6 chars)
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        # only 'engineering' would match in bank text; one token => no link
        "2025-12-01,INV-T04,Engineering Solutions Ltd,1000.00,1000.00\n"
    )
    run = _run(client, bank, inv)
    b = _find_bank(run, "RANDOM")
    assert b is not None
    methods = [m["method"] for m in b["matches"]]
    assert "debtor_tokens" not in methods, f"Pass 2.5 fired with <2 distinctive tokens: {b}"


# --------- Composite 6-row representative scenario ---------
def test_six_row_canonical_scenario(client):
    """Bundle of the 6 representative bank rows requested by main agent."""
    bank = (
        "Date,Amount,Reference,Payer\n"
        # 1) ref + exact => FULL (Rule A)
        "2026-01-01,1200.00,Payment INV-9001,\n"
        # 2) ref + supporting debtor + exact => FULL (Rule C)
        "2026-01-02,6600.00,EMMERSON TRANSPORT KREF FORD CIVIL ENG INV 2008666,\n"
        # 3) ALL-CAPS unique 95% debtor + exact => FULL (Rule B with case fix)
        #    Use the SLARK example from the spec which the main agent verified at 95%.
        "2026-01-03,500.00,SLARK CONSTRUCTION LIMITED BACS,\n"
        # 4) noisy text scoring <70 => UNMATCHED
        "2026-01-04,42.00,A AND J WAST LTD FMQ,\n"
        # 5) ambiguous multi-invoice => PARTIAL/low
        "2026-01-05,300.00,Smith,\n"
        # 6) ref + amount overflow => PARTIAL with 'unallocated'
        "2026-01-06,2000.00,Payment INV-4001,\n"
    )
    inv = (
        "Date,Ref,Name,Amount,Outstanding\n"
        "2025-12-01,INV-9001,Acme Limited,1200.00,1200.00\n"
        "2025-12-02,2008666,Emmerson Transport Ltd,1200.00,1200.00\n"
        "2025-12-03,2008667,Ford Civil Engineering,5400.00,5400.00\n"
        "2025-12-04,INV-CAPS01,Slark Construction Limited,500.00,500.00\n"
        "2025-12-05,INV-Z001,Zenith Pharma Plc,1500.00,1500.00\n"
        "2025-12-06,INV-S001,Smith Holdings Ltd,300.00,300.00\n"
        "2025-12-07,INV-S002,Smith Trading Ltd,300.00,300.00\n"
        "2025-12-08,INV-4001,Beta Ltd,1500.00,1500.00\n"
    )
    run = _run(client, bank, inv)
    by_ref = {b["reference"]: b for b in run["bank_rows"]}

    # 1) Rule A
    r1 = by_ref["Payment INV-9001"]
    assert r1["status"] == "full" and r1["confidence"] == "high"
    assert "matched and exact amount consumed" in r1["reason"]

    # 2) Rule C
    r2 = by_ref["EMMERSON TRANSPORT KREF FORD CIVIL ENG INV 2008666"]
    assert r2["status"] == "full" and r2["confidence"] == "high", (
        f"Rule C should reach FULL — got {r2['status']} reason={r2['reason']}"
    )

    # 3) Rule B with case fix
    r3 = by_ref["SLARK CONSTRUCTION LIMITED BACS"]
    assert r3["status"] == "full" and r3["confidence"] == "high", (
        f"Case fix should let Rule B fire — got {r3['status']} reason={r3['reason']}"
    )

    # 4) UNMATCHED
    r4 = by_ref["A AND J WAST LTD FMQ"]
    assert r4["status"] == "unmatched"
    assert r4["confidence"] is None

    # 5) ambiguous PARTIAL
    r5 = by_ref["Smith"]
    assert r5["status"] == "partial"
    assert "multiple candidates" in r5["reason"].lower()

    # 6) ref + overflow => PARTIAL with 'unallocated'
    r6 = by_ref["Payment INV-4001"]
    assert r6["status"] == "partial"
    assert "unallocated" in r6["reason"].lower()
