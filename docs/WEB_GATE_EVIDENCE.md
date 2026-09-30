# Web application gate evidence (roadmap phase 6)

The phase 6 exit gate: no page shows a success toast without a persisted
change (a Playwright suite asserts persistence after reload for every
mutating UI action); Lighthouse best-practices >= 90; security headers
present. This file records how each is proven and how to re-run it.

## 1. Persistence suite (every mutating UI action)

`apps/web/e2e` runs against the API and web servers with the auth bypass
(`npm run test:e2e`); `apps/web/e2e-auth` runs the same servers without it
(`npm run test:e2e:auth`, roadmap 6.9). Every mutating action a phase 6 row
repaired is asserted after a reload AND against the API (or the API's disk
for uploads), never through optimistic UI state:

| Page | Actions covered | Spec |
|---|---|---|
| Suppliers | edit, delete, record payment with tender | `fake-flows.spec.ts` |
| Employees | invite (201, code emailed only), register join mode | `fake-flows.spec.ts` |
| Smart Capture | photo and photo+PDF stored on the API's disk | `fake-flows.spec.ts` |
| AI Scanner | upload reaches `/ocr/scan-bill`; 503 shown, never a fake result | `fake-flows.spec.ts` |
| Products | add (server SKU), edit, delete with confirmation, server paging and filters, tiles from the API | `products-settings.spec.ts` |
| Settings | profile fields persist; the shop state decides IGST through `/billing/calculate` | `products-settings.spec.ts` |
| Expenses | tiles are the API month summary; edit persists | `correctness.spec.ts` |
| Customers | an edit that clears email and city persists as null | `correctness.spec.ts` |
| Forgot / reset password | neutral confirmation; a bad link never shows success | `correctness.spec.ts` |
| POS | anonymous cart carried into the shop scope | `web-hardening.spec.ts` |
| Checkout, dashboard | sale persisted with stock and totals; every dashboard state | `pos-checkout.spec.ts`, `dashboard.spec.ts` |
| Real sign-in | register, bounce with callback, wrong password, sign-out, every repaired page, VIEWER gating (UI and 403) | `e2e-auth/real-auth.spec.ts` |

Remaining info toasts are honest by construction: "Record Purchase" on
suppliers and the plans modal in the sidebar say the feature does not exist;
neither reports success.

Last local run (2026-09-30, MariaDB test database): 37 bypass tests and 3
real-auth tests passed. CI runs both suites on MySQL 8 (`Browser tests`
job).

## 2. Security headers

Asserted on every page by `web-hardening.spec.ts` and by the production
smoke (`next build` + `next start` against an API without the bypass):

| Header | Value |
|---|---|
| Content-Security-Policy | per request, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src 'self' <API origin>`, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`, `base-uri 'self'`, `upgrade-insecure-requests` in production |
| Strict-Transport-Security | `max-age=63072000; includeSubDomains` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` |
| X-Powered-By | absent |

The production build refuses to start with `NEXT_PUBLIC_AUTH_DISABLED`
(`next.config.js`), and the middleware verifies the session JWT with
`getToken` on every protected route.

## 3. Lighthouse

Run on the production build (`next build`, `next start -p 3011`, API on
3004 without the bypass), Lighthouse 13.5.0, Chrome 141 headless, default
mobile emulation and throttling, on the public pages (a signed-in page needs
a session cookie Lighthouse does not carry):

| Route | Best practices | Accessibility | Performance | SEO |
|---|---|---|---|---|
| /login | 100 | 94 | 96 | 100 |
| /register | 100 | 94 | 97 | 100 |
| /forgot-password | 100 | 94 | 95 | 100 |

Every best-practices audit passes, the security ones included (`csp-xss`,
`has-hsts`, `is-on-https`, `deprecations`, `third-party-cookies`,
`inspector-issues`). The first run scored 96: `errors-in-console` failed on
a 404 for `/favicon.ico`, which `src/app/icon.svg` now answers.

Re-run:

```bash
# API without the bypass on 3004, production web on 3011 (see the smoke in AGENTS.md 6.4)
CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
npx lighthouse http://localhost:3011/login --only-categories=best-practices \
  --chrome-flags="--headless=new --no-sandbox --disable-gpu --disable-background-networking" \
  --output=json --output-path=lh-login.json --quiet
```

Kill the servers by process group afterwards: a `next start` spawns a
`next-server` child that outlives its `npx` parent and keeps serving the old
build on the port (that stale server produced `NO_FCP` runs and 400s for
`/_next/static` before this was understood).
