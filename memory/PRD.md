# Receivables Reconciliation Platform — PRD

**Company:** EB Business Solutions Limited
**Original problem statement:** Recreate a Cash Allocator app — partially allocate cash received against an invoice listing month-on-month, using invoice ref numbers in bank reference text + fuzzy debtor name comparison. Add manual override, multi-period compare, debtor report, CSV validation, audit trail. Multi-tenant secure, sellable as SaaS. Renamed during build to **Receivables Reconciliation Platform**.

## Architecture
- **Frontend:** React 19 + React Router v7 + Tailwind + shadcn/ui + sonner (`/app/frontend`)
- **Backend:** FastAPI + motor + bcrypt + PyJWT + rapidfuzz + openpyxl + BackgroundTasks (`/app/backend`)
- **DB:** MongoDB — `users`, `allocation_runs`, `audit_logs`, `login_attempts`
- **Auth:** JWT (httpOnly cookies, 12h access + 7d refresh), multi-tenant via `user_id` scoping on every record

## User personas
- Finance / AR analyst at an SME closing monthly receivables
- Bookkeeper / controller running close for multiple clients

## Core requirements (static)
1. Upload bank CSV + invoice listing CSV with column mapping
2. Auto-allocate using: (a) invoice ref regex in bank reference text, (b) fuzzy debtor-name fallback (WRatio≥80, corporate suffixes stripped) against combined ref+payer text
3. Confidence per match: high (ref), medium (≥90 fuzzy), low (80–89 fuzzy), manual
4. Manual override — drag-and-drop OR dialog
5. CSV + Excel exports (xlsx with 2 sheets, £ formatting, colour-coded status)
6. Multi-period compare (debtor × run matrix, consistently-unmatched alert)
7. Debtor report with threshold flagging + CSV export
8. CSV validation/diagnostics: errors block, warnings can be acknowledged
9. Full audit trail (create / delete / manual link / create_run_failed)
10. Multi-tenant secure: JWT auth, all data scoped to user
11. Async processing for runs > 5000 rows (FastAPI BackgroundTasks + status polling)

## Implemented
- [x] Landing page (green/blue branded, "Receivables Reconciliation Platform" everywhere)
- [x] Sign In / Sign Up with httpOnly JWT cookies
- [x] Dashboard (runs table + 4 stat cards + delete-with-audit)
- [x] 4-step New Allocation wizard (Details → Bank CSV → Invoice CSV+Mapping → Validate & Run)
  - [x] Drag-and-drop dropzone (file size & extension guarded, 25 MB cap)
  - [x] Click-to-upload, sample data, paste textarea, Clear button
  - [x] Row preview table (first 4 data rows)
  - [x] Debounced auto-detect of headers on CSV change (400 ms)
  - [x] Mapping for: bank_date, reference_text, payer, amount, bank_account, transaction_type / invoice_number, debtor_name, invoice_date, amount, outstanding, due_date, customer_reference
- [x] CSV validation diagnostics: errors (block), warnings (acknowledge), coverage bars, invalid-date warnings, missing-debtor warnings, duplicate invoice warnings, negative-amount warnings
- [x] Matching engine: invoice ref regex (case/dash insensitive) + suffix-digit match → rapidfuzz WRatio≥80 with corporate-suffix stripping against `reference_text + payer` combined
- [x] Async processing branch for >5000 rows with status field, polling UI, audit log on completion or failure
- [x] Allocation Detail with 5 tabs (Full Match / Partial / Unmatched Bank / Unmatched Invoice / Audit Log)
- [x] Export CSV + Export Excel (xlsx)
- [x] Manual link: dialog AND side-by-side drag-and-drop on unmatched tabs
- [x] High-unmatched in-app banner (≥30%) on Allocation Detail
- [x] Compare page (debtor × run matrix, consistently-unmatched banner)
- [x] Debtor Report (threshold flag, 4 stats, expandable rows, CSV export)
- [x] Audit Trail page (4 stat cards + run-id filter)

## Verified (testing agent iterations 1-5)
- Backend 19/19 pytest pass (auth, validate, create allocation, list isolation, delete, export CSV/XLSX, manual-link, compare, debtors+export, audit, fuzzy matching, async processing, validation diagnostics)
- Frontend end-to-end: landing → signup → wizard (D&D + preview + auto-detect) → run → detail tabs → manual link (dialog + drag-drop) → compare → debtors → audit → sign-out

## Backlog (P1)
- Email/SMS notifications for high-unmatched runs (in-app banner currently; user opted to skip email)
- xlsx **import** support (currently CSV only)
- Bank/accounting-package CSV presets (Barclays, HSBC, Xero, Sage, QuickBooks)
- Multi-user team / role permissions per tenant
- Stripe subscription billing + public pricing page

## Backlog (P2)
- Scheduled / automated allocation runs
- Public API key for external integration
- Period-end PDF reports
- Dark mode
- Externalize CORP_SUFFIXES list for non-UK entities (Pty Ltd, AS, Oy, etc.)
- Recovery for stale 'processing' runs after backend restart
