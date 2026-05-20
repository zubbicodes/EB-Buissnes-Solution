# Receivables Reconciliation Platform — PRD

**Company:** EB Business Solutions Limited
**Original problem statement:** Recreate a Cash Allocator app — partially allocate cash received into a bank account against invoice listing month-on-month, using a combination of invoice reference numbers found in bank reference text + fuzzy debtor name comparison. Add manual override, multi-period compare, debtor report, CSV validation, audit trail. Multi-tenant secure, sellable as SaaS. Renamed during build to **Receivables Reconciliation Platform**.

## Architecture
- **Frontend:** React 19 + React Router v7 + Tailwind + shadcn/ui + sonner toasts (`/app/frontend`)
- **Backend:** FastAPI + motor (Mongo async) + bcrypt + PyJWT + rapidfuzz + openpyxl (`/app/backend`)
- **DB:** MongoDB collections: `users`, `allocation_runs`, `audit_logs`, `login_attempts`
- **Auth:** JWT (httpOnly cookies, 12h access + 7d refresh), multi-tenant via `user_id` scoping on every record

## User personas
- Finance / accounts-receivable analyst at a SME — owns monthly cash reconciliation
- Bookkeeper or controller running the close for multiple periods/clients

## Core requirements (static)
1. Upload bank CSV + invoice listing CSV with column mapping
2. Auto-allocate using (a) invoice ref pattern matching in bank reference text, (b) fuzzy debtor name matching fallback
3. Show high/medium/low/manual confidence per match
4. Manual override (drag-and-drop or dialog) for missed matches
5. CSV export of allocation result + Excel (.xlsx) export with formatted sheets
6. Multi-period compare (debtor × run heat matrix)
7. Debtor report with threshold flagging + CSV export
8. CSV validation/diagnostics with errors (block) and warnings (acknowledge)
9. Full audit trail (every create/delete/manual-link logged)
10. Multi-tenant secure: JWT auth, all data scoped to user

## Implemented (2026-05-20)
- [x] Landing page with green/blue brand and hero
- [x] Sign In / Sign Up with httpOnly JWT cookies
- [x] Dashboard (runs table + 4 summary stat cards + delete with audit)
- [x] 4-step New Allocation wizard (Details → Bank CSV → Invoice CSV + mapping → Validate & Run)
  - [x] Sample data buttons, file upload, paste textarea, Clear button, headers preview
  - [x] Debounced auto-detect of headers on CSV change (400ms)
  - [x] Auto-guessed default column mapping
- [x] CSV validation endpoint: errors (block), warnings (acknowledge), coverage bars, row-level diagnostics
- [x] Matching engine: invoice ref regex + suffix-digit match, then rapidfuzz token_set_ratio (75+) debtor name fallback
- [x] Allocation Detail with 5 tabs (Full Match / Partial / Unmatched Bank / Unmatched Invoice / Audit Log)
- [x] Export CSV + Export Excel (.xlsx with 2 sheets, £ formatting, colour-coded rows)
- [x] Manual link via dialog AND drag-and-drop side-by-side view on unmatched tabs
- [x] High-unmatched banner (>=30%) on Allocation Detail
- [x] Compare page (debtor × run matrix, colour badges, consistently-unmatched banner)
- [x] Debtor Report (threshold flag input, 4 stats, expandable rows, CSV export)
- [x] Audit Trail page (4 stat cards + run-id filter)
- [x] Brand: "Receivables Reconciliation Platform" applied across landing, auth, sidebar, page title

## Verified (testing agent iterations 1-4)
- Backend 14/14 pytest pass: auth (register/login/me/logout), validate, create allocation, list isolation, delete, export CSV, export XLSX, manual-link, compare, debtors, debtors export, audit
- Frontend end-to-end: landing → signup → wizard auto-detect → run → detail tabs → manual link (dialog + drag-drop) → compare → debtors → audit → sign-out

## Backlog (P1)
- Email/SMS notifications for high-unmatched runs (currently in-app banner only; user picked Skip Email)
- xlsx **import** support (currently CSV only)
- Multi-user team / role permissions per tenant
- Bank/invoice CSV parser presets (Barclays, HSBC, Xero, QuickBooks, Sage)

## Backlog (P2)
- Scheduled / automated allocation runs
- API key for external integration
- Period-end PDF reports
- Dark mode
