# EB Receivables Reconciliation - Delivery Checklist

## Required Environment

- `APP_ENV=production`
- `JWT_SECRET` set to a unique secret of at least 32 characters
- `MONGO_URL` and `DB_NAME` set for the production MongoDB instance
- `CORS_ORIGINS` set to the deployed frontend origin, not `*`
- `COOKIE_SECURE=true` when served over HTTPS
- `ALLOW_DEFAULT_ADMIN=false`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` only used for controlled internal bootstrap
- `GOOGLE_CLIENT_ID` set only when Google Sign-In is enabled

## Handover Checks

- Run a production frontend build.
- Run backend tests for matching, XLSX parsing, and auth.
- Upload representative CSV and XLSX bank/invoice files.
- Confirm FIFO order against dated invoice listings.
- Confirm reference overpayments show as `overpaid` with visible overpaid amount.
- Review the Exceptions screen for unmatched, duplicate, underpayment, overpayment, and low-confidence rows.
- Export allocation, exception, unmatched, and debtor reports and confirm finance validation fields are present.
- Confirm Admin, User, and Read-only roles behave correctly.
- Confirm the PWA installs and authenticated API data is not cached offline.

## Retention

Allocation runs are archived rather than physically deleted from the UI. Keep production MongoDB backups for at least 24 months, and only perform hard deletion through an audited maintenance process outside normal user workflows.
