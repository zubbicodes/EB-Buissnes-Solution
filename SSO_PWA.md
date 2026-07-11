# Google SSO + PWA Integration Plan

## Summary

Add Google Sign-In as a second authentication path while preserving the existing app JWT model, localStorage Bearer token behavior, cookies, and password login/signup. Make the React app installable as a first-pass PWA with cached static assets and an offline fallback, without offline data editing or API response caching.

Chosen defaults:
- Google SSO allows any verified Google account.
- If the Google email matches an existing password user, link it automatically.
- PWA offline support is app-shell only.

Official references used: Google recommends sending a Google ID token to the backend and verifying it server-side with a Google client library; PWA installability needs a web app manifest plus service-worker behavior. See Google Identity docs: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token and MDN PWA manifest docs: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest.

## Key Changes

Backend auth:
- Add `POST /api/auth/google` accepting `{ credential: string }`, where `credential` is the Google Identity Services ID token.
- Verify the token server-side using the already-present `google-auth` Python package.
- Require token audience to match `GOOGLE_CLIENT_ID`.
- Require verified email from the Google payload.
- User lookup flow:
  - Find user by lowercased Google email.
  - If found, update/link Google metadata on that same user.
  - If not found, create a user with name/email from Google and no password requirement.
- Return the same response shape as `/auth/login` and `/auth/register`: `{ id, email, name, access_token, refresh_token }`.
- Set the same auth cookies via existing `set_auth_cookies`.
- Extend user documents with optional fields: `auth_provider`, `google_sub`, `picture`, `last_login_at`, and `updated_at`.
- Keep password auth fully working for existing users.

Frontend auth:
- Add Google Identity Services script loading to the auth UI.
- Add a “Continue with Google” button to both sign-in and sign-up pages.
- On Google success, send the returned ID token to `/api/auth/google`.
- Store returned `access_token` using existing `setToken`.
- Route successful Google auth to `/dashboard`, matching password login behavior.
- Add `googleLogin(credential)` to `AuthContext`.
- Preserve existing error display style and loading states.

Environment/config:
- Add backend env var `GOOGLE_CLIENT_ID`.
- Add frontend env var `REACT_APP_GOOGLE_CLIENT_ID`.
- Update Docker compose examples so both services receive the same Google OAuth web client ID.
- If either Google client ID is missing, hide/disable the Google button on frontend and make backend `/auth/google` return a clear 503-style configuration error.

PWA:
- Add `frontend/public/manifest.webmanifest` with:
  - app name: `EB Receivables Reconciliation Platform`
  - short name: `EB Receivables`
  - start URL: `/dashboard`
  - scope: `/`
  - display: `standalone`
  - theme/background colors matching the EB palette
  - icons at required install sizes
- Link the manifest and PWA meta tags from `public/index.html`.
- Add a service worker that precaches the built static assets and serves an offline fallback for navigation requests.
- Register the service worker from `src/index.js` only in production builds.
- Do not cache authenticated `/api/*` responses in v1.
- Add an offline fallback page that tells users they need a connection for live reconciliation data.

## Test Plan

Backend:
- Add tests for successful Google auth with a mocked valid token.
- Test auto-creation of a new Google user.
- Test automatic linking when Google email matches an existing password user.
- Test invalid token, unverified email, missing `GOOGLE_CLIENT_ID`, and audience mismatch failures.
- Regression-test that password login/register and Bearer-only auth still pass.

Frontend:
- Unit or integration-test that Google button appears when `REACT_APP_GOOGLE_CLIENT_ID` exists.
- Test successful Google credential exchange stores the app access token and redirects to dashboard.
- Test failed Google exchange surfaces an auth error.
- Test password sign-in/sign-up remain unchanged.

PWA:
- Build frontend and verify manifest is emitted and linked.
- Verify service worker registers only in production.
- Verify `/api/*` is not cached.
- Verify offline navigation returns the fallback page instead of a blank app.
- Run Lighthouse/PWA checks manually or via Chrome DevTools after production build.

## Assumptions

- The implementer will create/configure a Google OAuth “Web application” client in Google Cloud and provide the client ID through env vars.
- No Google Drive/Gmail/Calendar permissions are needed; this is authentication only, not Google API access.
- Existing password accounts remain valid and can later sign in with Google if emails match.
- No domain allowlist is required in this pass.
- No offline allocation creation, CSV upload queueing, manual-link queueing, or cached financial data viewing is included in this PWA version.
