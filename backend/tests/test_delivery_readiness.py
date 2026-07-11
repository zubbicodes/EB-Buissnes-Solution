import io

from openpyxl import Workbook

from backend.server import ColumnMapping, parse_xlsx_bytes, run_matching


MAPPING = ColumnMapping(
    bank_reference="Ref",
    bank_payer="Payer",
    bank_amount="Amount",
    invoice_number="Inv",
    invoice_debtor="Debtor",
    invoice_amount="Amount",
    invoice_date="Date",
)


def test_debtor_match_allocates_fifo_and_can_be_full():
    bank = [{"Ref": "Payment ABC Ltd", "Payer": "ABC Ltd", "Amount": "1500"}]
    invoices = [
        {"Inv": "I2", "Debtor": "ABC Ltd", "Amount": "500", "Date": "2026-02-01"},
        {"Inv": "I1", "Debtor": "ABC Ltd", "Amount": "500", "Date": "2026-01-01"},
        {"Inv": "I3", "Debtor": "ABC Ltd", "Amount": "500", "Date": "2026-03-01"},
    ]

    bank_rows, invoice_rows, stats = run_matching(bank, invoices, MAPPING)
    matched_invoice_ids = [m["invoice_id"] for m in bank_rows[0]["matches"]]
    matched_numbers = [next(i["number"] for i in invoice_rows if i["id"] == mid) for mid in matched_invoice_ids]

    assert matched_numbers == ["I1", "I2", "I3"]
    assert bank_rows[0]["status"] == "full"
    assert stats["fully_matched"] == 1


def test_reference_overpayment_is_explicit():
    bank = [{"Ref": "INV-100 payment", "Payer": "", "Amount": "1500"}]
    invoices = [{"Inv": "INV-100", "Debtor": "ABC", "Amount": "1000", "Date": "2026-01-01"}]

    bank_rows, _, stats = run_matching(bank, invoices, MAPPING)

    assert bank_rows[0]["status"] == "overpaid"
    assert bank_rows[0]["overpaid_amount"] == 500
    assert stats["overpaid"] == 1


def test_xlsx_parser_reads_first_sheet_rows():
    wb = Workbook()
    ws = wb.active
    ws.append(["Inv", "Debtor", "Amount"])
    ws.append(["INV-200", "Example Ltd", 123.45])
    buf = io.BytesIO()
    wb.save(buf)

    rows = parse_xlsx_bytes(buf.getvalue())

    assert rows == [{"Inv": "INV-200", "Debtor": "Example Ltd", "Amount": "123.45"}]
