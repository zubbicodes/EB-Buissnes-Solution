# Client administration and matching mappings

The `/admin` area is for a dedicated **platform administrator**. Client `admin`, `user`, and `read_only` roles continue to use the reconciliation application. Client administrators cannot grant platform-administrator access.

## Enable the operator account

1. Create a dedicated operator account using the existing sign-up flow. Do not use a client's working account.
2. Set `PLATFORM_ADMIN_EMAIL` to that account's email on the backend (Docker Compose passes this variable through).
3. Restart the backend and sign in again. Startup promotes only that existing account; it does not generate or expose a password. Existing sessions are revoked on promotion.
4. The account opens `/admin`. Platform-admin requests to client financial routes are rejected by the API, including uploads, allocation edits, deletes, reports, and exports. There is no impersonation endpoint.

The operator can change their login email or password under **Account settings**. The current password is required and all existing sessions are revoked after a change. `PLATFORM_ADMIN_EMAIL` is only a first-operator bootstrap value; once an operator exists it cannot promote another account. Update the variable to the current email to keep the deployment configuration clear.

Removing the environment variable does not demote an existing operator. Role removal is a controlled database maintenance action. Keep production `APP_ENV=production`, a strong `JWT_SECRET`, HTTPS cookies, and default-admin seeding disabled as described in `DELIVERY_CHECKLIST.md`.

## Local developer account

`docker compose up --build` also reads `docker-compose.override.yml` and creates a development-only platform administrator:

```text
Email: developer@example.com
Password: Developer@2026!
```

Open `http://localhost:3000/signin` and use those credentials to view `/admin` while developing. Override them with `DEV_PLATFORM_ADMIN_EMAIL` and `DEV_PLATFORM_ADMIN_PASSWORD` in a local `.env` file. The backend ignores both variables when `APP_ENV=production`, and Coolify uses `docker-compose.yml` without the local override.
The development values are authoritative: restarting the local backend restores that seeded account's configured email, password, and active status.

## Client setup and access

- Create a client, then invite its users as Client admin, User, or Read-only.
- Each email belongs to one account/client. Existing accounts cannot be moved between clients through this interface.
- Invite links expire after **48 hours**; reset links expire after **1 hour**. The administrator copies and shares them manually. No email delivery service is required or called.
- Links are single-use, stored only as SHA-256 hashes, and replaced when another link is issued. The raw token appears once in the admin response and uses a URL fragment rather than a query parameter.
- Completing a link sets a password chosen by the user and revokes old access/refresh tokens. Account access changes also revoke existing sessions and outstanding links.
- Pending invitations and inactive users cannot sign in, including through Google. Inactive clients cannot use client APIs. Deactivation retains their data.
- Administrators cannot view passwords or password hashes. Anyone holding an invitation/reset link can redeem it, so share it only with the named recipient through a trusted channel.

## Matching intelligence

These mappings are separate from the existing **CSV column-mapping presets**.

Each mapping records the client, source phrase, target debtor name, type (payer/remitter, alias, reference variation), allocation permission, active status, notes, source, and change reason. Use the debtor name from that client's invoice listing.

Source matching uses complete phrases with case, punctuation and whitespace normalization. The phrase may appear within a wider bank narrative, so changing transaction data after it (for example EREF or UETR values) does not prevent a match. Payer mappings inspect the payer field. Reference variations and aliases inspect both imported reference/narrative and payer/remitter fields because banks place narrative data in different columns. Conflicting mapped debtors require manual review. Overlapping mappings use the more restrictive permission.

Mapping-assisted behavior is controlled explicitly per mapping:

- **Identification only:** identify the debtor and propose one invoice only when there is a single open candidate or exactly one open invoice matching the payment amount. Otherwise the client selects an invoice manually.
- **FIFO proposals permitted:** propose allocation across that debtor's oldest open invoices. No bank or invoice balance changes until the client accepts the suggestion.
- **FIFO auto-allocation permitted:** immediately allocate across that debtor's oldest open invoices. This is intended only for payer/reference relationships the client has approved as trusted. Normal balance handling, exception generation, audit data, mapping evidence, organization scoping, and invoice-reference precedence still apply.
- If overlapping mappings for the same debtor have different permissions, the most restrictive permission wins. Automatic FIFO therefore occurs only when every matching mapping permits it.
- Mappings that identify different debtors are ambiguous and never allocate automatically.
- Existing invoice-reference matching keeps precedence. Existing matching behavior is otherwise unchanged when no active mapping applies.
- Only active mappings for the authenticated client's organization are loaded. Browser-supplied client IDs are not used for allocation creation.
- Both synchronous and background runs use a snapshot captured when the client creates the run. Editing/deactivating a mapping does not recalculate past runs or alter completed allocations.
- Run snapshots and row evidence retain mapping IDs and revisions. The allocation review panel shows the source, debtor, effective permission, and mapping versions.

Active mappings and target debtors are normalized and indexed once per allocation run. This avoids rescanning and renormalizing the complete invoice listing for every mapped bank row.

## Audit and concurrent edits

Mapping/client changes and user-access/link events record actor ID/email, timestamp, reason, and relevant before/after values. Mapping source and notes are included. The history tab is scoped to the selected client; passwords, password hashes and raw link tokens are excluded.

Records use optimistic revision checks. A stale edit returns HTTP 409 and requires reloading. Mapping state and its audit entry are saved atomically in one MongoDB document, so a successful mapping change cannot lose its corresponding audit event. Mappings are deactivated rather than deleted.

## Existing data and rollout

Back up MongoDB before deploying the startup migration. Legacy records missing `org_id` are assigned by their existing `user_id`, with a separate deterministic workspace per legacy owner. Records with an existing organization are preserved. Ownerless records are left unassigned rather than guessed into a client.

If an older deployment already merged unrelated users into one organization, this migration **cannot infer their intended client boundaries**. Review and repair those assignments from authoritative client records before giving users access. Automatic splitting of existing organizations would also split legitimate client teams, so it is not performed.

The database gains `client_mappings`, indexes, mapping snapshots on new runs, and account-link/session-version/history fields on users. These changes are additive. Do not roll back to an older backend after using account suspension or resets: it will not enforce the new session-version or platform-admin boundary checks.

## Verification

Run the focused suite with local MongoDB on `127.0.0.1:27017`:

```powershell
.venv/Scripts/python.exe -m pytest backend/tests/test_client_admin.py backend/tests/test_conservative_matching.py backend/tests/test_delivery_readiness.py backend/tests/test_google_auth.py -q
```

Admin integration tests create uniquely named `eb_admin_test_*` databases and remove only those databases afterward. They never use the application's configured database. They skip when local MongoDB is unavailable. Build the frontend with `npm run build` from `frontend`.
