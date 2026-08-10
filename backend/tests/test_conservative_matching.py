"""Pure regression coverage for the conservative allocation decision engine."""

import os
import asyncio
from types import SimpleNamespace

import pytest

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_conservative_matching")
os.environ.setdefault("JWT_SECRET", "test-secret")

from backend import server


MAPPING = server.ColumnMapping(
    bank_date="Date",
    bank_reference="Reference",
    bank_amount="Amount",
    bank_payer="Payer",
    invoice_number="Invoice",
    invoice_debtor="Debtor",
    invoice_amount="Amount",
    invoice_date="Date",
    invoice_outstanding="Outstanding",
)


def run(bank_rows, invoice_rows):
    return server.run_matching(bank_rows, invoice_rows, MAPPING)


def bank(payer, amount=500, reference="", date="2026-01-01"):
    return {"Date": date, "Reference": reference, "Payer": payer, "Amount": str(amount)}


def invoice(number, debtor, amount=500, outstanding=None, date="2025-12-01"):
    return {
        "Date": date,
        "Invoice": number,
        "Debtor": debtor,
        "Amount": str(amount),
        "Outstanding": str(amount if outstanding is None else outstanding),
    }


def test_generic_shared_words_do_not_create_matches():
    bad_pairs = [
        ("WASTE KING RECYCLING LTD", "T J Waste & Recycling Ltd"),
        ("URBAN DEVELOPMENTS", "Groundforce Developments LTD"),
        ("VDL SOUTHERN LTD", "Coleman Constructions (Southern) Ltd"),
        ("PMC CONSTRUCTION", "Grey Tree Construction Ltd"),
        ("OLIVIER PJ FURN", "McDermotts House Furniture Ltd"),
    ]
    for payer, debtor in bad_pairs:
        banks, invoices, _ = run([bank(payer)], [invoice("INV-1", debtor)])
        assert banks[0]["decision"] == "no_match", (payer, debtor, banks[0])
        assert banks[0]["matches"] == []
        assert banks[0]["suggestions"] == []
        assert invoices[0]["remaining"] == 500


def test_conservative_truncated_names_select_the_correct_debtor():
    cases = [
        ("KAMM CIVIL ENGINEE", "Kamm Civil Engineering"),
        ("AT HOME FURN LTD", "AT HOME FURNISHINGS (MIN)"),
        ("COOKES FURNITURE L", "COOKES FURNITURE (MIN)"),
    ]
    for payer, debtor in cases:
        banks, invoices, _ = run([bank(payer)], [invoice("INV-1", debtor)])
        assert banks[0]["decision"] == "auto_match", banks[0]
        assert banks[0]["matches"][0]["invoice_id"] == invoices[0]["id"]
        assert banks[0]["evidence"]["debtor_match_type"] == "ordered_prefix"
        assert invoices[0]["remaining"] == 0


def test_reference_suffix_wins_and_remainder_is_provisional():
    banks, invoices, stats = run(
        [bank("JOHN WINTERS LLP", amount=1551.6, reference="INVOICE 592788")],
        [
            invoice("1592788", "DFS TRADING LIMITED", amount=1000),
            invoice("1593000", "DFS TRADING LIMITED", amount=551.6, date="2025-12-02"),
            invoice("1568725", "JOHN CASEY LTD", amount=1551.6),
        ],
    )
    row = banks[0]
    assert row["matches"][0]["invoice_id"] == invoices[0]["id"]
    assert row["matches"][0]["method"] == "reference"
    assert row["decision"] == "suggest"
    assert row["suggestions"][0]["invoice_id"] == invoices[1]["id"]
    assert invoices[0]["remaining"] == 0
    assert invoices[1]["remaining"] == 551.6
    assert stats["suggested_matches"] == 1


def test_medium_fuzzy_suggestion_does_not_reserve_balance(monkeypatch):
    monkeypatch.setattr(server.fuzz, "WRatio", lambda *args, **kwargs: 90.0)
    banks, invoices, _ = run(
        [bank("HOMELIFE LETTINGS")],
        [invoice("INV-1", "Homelife Investments Ltd")],
    )
    row = banks[0]
    assert row["decision"] == "suggest"
    assert row["matches"] == []
    assert row["suggestions"][0]["amount"] == 500
    assert row["remaining"] == 500
    assert invoices[0]["remaining"] == 500
    assert invoices[0]["matches"] == []


def test_high_fuzzy_requires_exact_whole_invoice_amount(monkeypatch):
    monkeypatch.setattr(server.fuzz, "WRatio", lambda *args, **kwargs: 96.0)
    exact_banks, exact_invoices, _ = run(
        [bank("HOMELIFE LETTINGS")],
        [invoice("INV-1", "Homelife Investments Ltd")],
    )
    assert exact_banks[0]["decision"] == "auto_match"
    assert exact_invoices[0]["remaining"] == 0

    partial_banks, partial_invoices, _ = run(
        [bank("HOMELIFE LETTINGS", amount=500)],
        [invoice("INV-2", "Homelife Investments Ltd", amount=700)],
    )
    assert partial_banks[0]["decision"] == "suggest"
    assert partial_invoices[0]["remaining"] == 700


def test_candidates_are_grouped_by_debtor_not_invoice(monkeypatch):
    monkeypatch.setattr(server.fuzz, "WRatio", lambda *args, **kwargs: 96.0)
    banks, invoices, _ = run(
        [bank("HOMELIFE LETTINGS", amount=500)],
        [
            invoice("INV-1", "Homelife Investments Ltd", amount=200),
            invoice("INV-2", "Homelife Investments Ltd", amount=300, date="2025-12-02"),
        ],
    )
    row = banks[0]
    assert row["decision"] == "auto_match"
    assert row["evidence"]["candidate_margin"] == 100.0
    assert row["evidence"]["ambiguous"] is False
    assert [item["remaining"] for item in invoices] == [0, 0]


def test_identified_debtor_without_open_balance_stays_unmatched():
    banks, invoices, _ = run(
        [bank("A G Phillips & Son Ltd", amount=2128)],
        [invoice("INV-1", "A G Phillips & Son Ltd", amount=792, outstanding=0)],
    )
    assert banks[0]["decision"] == "no_match"
    assert "no open invoice balance" in banks[0]["reason"].lower()
    assert invoices[0]["remaining"] == 0


class FakeCollection:
    def __init__(self, rows):
        self.rows = rows

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items() if not key.startswith("$")):
                return dict(row)
        return None

    async def update_one(self, query, update):
        for row in self.rows:
            if all(row.get(key) == value for key, value in query.items() if not key.startswith("$")):
                for key, value in update.get("$set", {}).items():
                    row[key] = value
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)


def test_accept_and_reject_suggestions_are_idempotent(monkeypatch):
    suggestion = {
        "bank_id": "bank-1", "invoice_id": "invoice-1", "amount": 500.0,
        "method": "debtor_name", "confidence": "medium", "reason": "Review",
        "invoice_number": "INV-1", "invoice_debtor": "Homelife Investments Ltd",
        "invoice_outstanding_before": 500.0, "invoice_outstanding_after": 0.0,
        "provisional": True,
    }
    banks = [{
        "id": "bank-1", "run_id": "run-1", "org_id": "org-1", "reference": "PAYMENT",
        "remaining": 500.0, "matches": [], "suggestions": [suggestion],
        "decision": "suggest", "status": "partial", "evidence": {},
    }]
    invoices = [{
        "id": "invoice-1", "run_id": "run-1", "org_id": "org-1", "number": "INV-1",
        "remaining": 500.0, "matches": [], "status": "unmatched",
    }]
    fake_db = SimpleNamespace(
        allocation_runs=FakeCollection([{"id": "run-1", "org_id": "org-1"}]),
        allocation_bank_rows=FakeCollection(banks),
        allocation_invoice_rows=FakeCollection(invoices),
    )
    monkeypatch.setattr(server, "db", fake_db)

    async def no_op(*args, **kwargs):
        return 0

    async def stats(*args, **kwargs):
        return {"suggested_matches": 0}

    monkeypatch.setattr(server, "rebuild_exceptions", no_op)
    monkeypatch.setattr(server, "_recompute_stats", stats)
    monkeypatch.setattr(server, "write_audit", no_op)
    current = {"id": "user-1", "org_id": "org-1", "role": "user"}

    result = asyncio.run(server.accept_suggestion("run-1", "bank-1", current))
    assert result["ok"] is True
    assert banks[0]["decision"] == "manual"
    assert banks[0]["suggestions"] == []
    assert banks[0]["remaining"] == 0
    assert invoices[0]["remaining"] == 0
    assert invoices[0]["matches"][0]["confirmed_by_user"] is True
    with pytest.raises(server.HTTPException) as repeated:
        asyncio.run(server.accept_suggestion("run-1", "bank-1", current))
    assert repeated.value.status_code == 409

    banks[0].update({
        "remaining": 500.0, "matches": [], "suggestions": [suggestion],
        "decision": "suggest", "status": "partial",
    })
    invoices[0].update({"remaining": 500.0, "matches": [], "status": "unmatched"})
    rejected = asyncio.run(server.reject_suggestion("run-1", "bank-1", current))
    assert rejected["ok"] is True
    assert banks[0]["decision"] == "no_match"
    assert banks[0]["status"] == "unmatched"
    assert invoices[0]["remaining"] == 500.0
