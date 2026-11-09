# 04 — Security and privacy

Audit of 9 November 2026, local HEAD `83d415ce0` (not pushed) and production (`origin/main` `360cd291d`, serving `assets/app.38126cc2d1c1.js`). Safe, read-only probes only; no load against production; no live submission; no credential created or printed.

## 1. Attack surface

| Surface | Finding | Severity |
|---|---|---|
| Public routes | Static pages, no accounts, no server state. `/admin/scanner*` are unauthenticated operator views that are empty on the host (no worker files are deployed); disallowed in robots.txt; reachable by URL | Low — exposes nothing; label it internal |
| Serverless function | `api/report.mjs` — **not deployed** (production `/api/report` → 404). Local HEAD only. Audited below | — |
| External calls at browser time | Same-origin only under `connect-src 'self'`; the waitlist POST is dead code while `waitlistEndpoint` is empty; map tiles self-hosted | None |
| Security headers (production, verified by `curl -I`) | CSP with script hashes, `form-action 'none'`, `frame-ancestors 'none'`, `object-src 'none'`; HSTS 2 years preload; `X-Content-Type-Options nosniff`; `X-Frame-Options DENY`; Referrer-Policy strict-origin-when-cross-origin; Permissions-Policy denies geolocation/camera/microphone/payment/usb | Good |
| Cross-origin | No CORS headers anywhere; `COOP same-origin` | Good |
| Browser storage | localStorage under `vl.`; no cookies, no IndexedDB, no service worker; export/restore all-or-nothing with per-kind shape checks | Good |
| Import/export handling | `importEverything` refuses non-export files, missing data block, unknown or malformed kinds (per kind); equity-test covers invalid JSON, truncated and old-version files; restore drawer names what it replaces | Good |
| URL parsing | The property calculator keeps the deal in `?d=`; a malformed address is a plain miss on the dev server (serve.mjs guards `decodeURIComponent`); the app's parse of `?d=` was not fuzzed in this audit | **Unverified** (low) |
| User-supplied text | Rendered through `el()` text nodes (no innerHTML of user text found in the report/feedback path); CSP blocks inline script anyway | Good |
| Error messages | No stack traces to the visitor; the function logs the store's status code server-side only | Good |
| Dependency vulnerabilities | `npm audit`: 2 high, both in **devDependencies** only (`sharp` libheif/librsvg; `xlsx` prototype pollution/ReDoS). No runtime dependencies; neither ships to the browser | Low (build-machine only) |
| Build artifacts / static exposure | **Production serves repository files as static files**: `/build.mjs`, `/ingest/sec.mjs`, `/src/js/00-core.js`, `/journeys.mjs`, `/docs/release-gate.md`, `/.github/workflows/checks.yml`, `/claims-reviewed.json` all answer 200. `/README.md`, `/package.json` 404 (Vercel's own exclusions). The repository is public on GitHub, so nothing confidential is newly exposed and no secret exists in the tree; git-ignored personal files are not deployed (Git integration) | Low — tidy with `.vercelignore` after launch; the two paths that matter (`/index.html`, the NAPIC source file) are already excluded |
| Authorization | Not applicable (no accounts) | — |
| Secrets in repo | None found. Workflows use `github.token` only; the report store's token is an environment variable the owner has not yet set | Good |

## 2. Report submission (`/api/report`) — specific audit

Commit check: `63bc73ad7` **is** in the inspected branch (local `main`: `4dc4dd7d7`, `63bc73ad7`, `aad5b14a0`, `83d415ce0`); it is **not deployed** (`origin/main` is `360cd291d`; production `/api/report` → 404; the served bundle `app.38126cc2d1c1.js` predates the Submit control).

| # | Requirement | Evidence | Result |
|---|---|---|---|
| 1 | Report stays a browser-local draft until submitted | drawer "Case … saved here, not sent"; `State.corrections` written before any request (65-learn.js, `confirmCaseSaved`) | Verified (journeys `corrections`, `submission`) |
| 2 | Submission requires an explicit visitor action | Submit button only; probe is a GET that carries nothing | Verified |
| 3 | Submitted text equals the visitor-reviewed text | the POST body is `pre.value` of the textarea the visitor read; the journey compares the stored record to it | Verified (file store) |
| 4 | Only intended fields accepted and stored | server keeps `kind,id,report,page,build`; record keys exactly those + `receipt, acceptedAt` | Verified (report-api-test, 52 checks) |
| 5 | Query strings removed on client and server | client `split(/[?#]/)[0]`; server `validate()` the same; test: `/property/calculator?d=…` → `/property/calculator` | Verified |
| 6 | No saved models, deals, watchlists or addresses included | the journey's "five fields" step asserts the POST's keys ⊆ the five; no address field exists | Verified |
| 7 | Server size and field limits | 16 KB body → 413; 8,000-char report → 400; id pattern; page ≤ 300 chars | Verified |
| 8 | Unexpected fields rejected or discarded | discarded (never stored); honeypot `website` filled → 400 | Verified |
| 9 | Token remains server-side | read from `process.env` in the function only; absent from `src/`, bundle and answers; test asserts the token value is in no log line and no answer | Verified |
| 10 | Token restricted to one private repository | **owner's step, not yet done** (fine-grained PAT, Issues R/W, one repo — docs/report-submission.md) | **Unverified** |
| 11 | Effective abuse protection | per-sender 5/10 min in memory, checked before the body is read; per-day cap 50 asked of the store itself (GitHub issue search), fails closed; 429 and no receipt; verified through the dev server (5 × 400, then 429, no record) | Verified locally; per-sender limit is per warm instance — the daily cap is the hard bound |
| 12 | Errors expose no credentials or private data | answers are `{ok:false, reason}` codes; server log carries the status code and case id only | Verified |
| 13 | Failed storage never produces a receipt | 502/503/429 paths carry none; GitHub 201 without an issue number is an error | Verified |
| 14 | A receipt maps to the stored record | `QTR-<issue number>` / `QTR-<file n>`; the journey reads the record back by receipt | Verified (file store); GitHub mapping by construction, live Unverified |
| 15 | Store-disabled mode truthful, copy/email preserved | GET `configured:false` → no Submit control, text "not switched on yet"; POST 503 | Verified |
| 16 | Staff can locate, assign and close | GitHub Issues (assign, label, close) — documented; **not exercised live** | Unverified |
| 17 | Retention and access documented | docs/report-submission.md "Privacy review items" | Documented; counsel review pending |
| 18 | Privacy statement accurate | new sentence on /privacy (local HEAD): "One form sends something, and only when you press Submit…" | Accurate to the code; **counsel review pending**; not yet live |

Environment variables: `QT_REPORTS_REPO`, `QT_REPORTS_GITHUB_TOKEN`, optional `QT_REPORTS_DAILY_CAP`; `QT_REPORTS_DIR` for local servers. None is set on the live project (the function is not even deployed). No value was printed or created.

Production customer-completion and operational-completion: **Unverified** (must stay so until executed with permission — `ops/REPORT-SUBMISSION-CHECK.md` in the handoff holds the procedure).

## 3. Privacy

- No accounts, cookies, analytics, or server-side record of a visitor on production today (verified: headers, no Set-Cookie, no analytics tag, `connect-src 'self'`).
- Page addresses carry the calculator's figures (`?d=`) by design, disclosed on /privacy; a shared link reproduces the deal.
- Exports go to the visitor's machine only.
- With the report store enabled (not yet): five fields plus free text; GitHub, Inc. becomes a processor; documented for counsel.
- Privacy and Terms are published as drafts with "To be supplied" markers; a Capital Markets and Services Act opinion is stated by the site itself as required before public launch — counsel-sensitive, unchanged, flagged.

## 4. Findings by severity

| ID | Finding | Severity | Exploitability | Exposure | Affected | Action |
|---|---|---|---|---|---|---|
| S-01 | Report-store token scope and env configuration not yet done; live submission not verified | High (if enabled unverified) | n/a until enabled | none today | Live report submission | Owner configures per docs; live two-result check before enabling |
| S-02 | Per-sender limit is per warm instance (no shared state) | Medium | moderate | tracker could gain up to the daily cap (50) a day | Live report submission | Accept with the daily cap; remove the two variables if abused |
| S-03 | Repository files served statically on production | Low | trivial | public repo anyway; no secrets | Hygiene | `.vercelignore` entries after launch (deployment change — owner decision) |
| S-04 | Dev-dependency CVEs (sharp, xlsx) | Low | build machine only | none to visitors | Developer tooling | `npm audit fix` / upgrade when convenient |
| S-05 | `/admin/scanner*` unauthenticated operator views | Low | trivial | empty pages | Hygiene | label internal; keep disallowed |
| S-06 | `?d=` address parsing not fuzzed | Low | low | a bad link shows an error state at worst | Calculator | sweep/mobile cover malformed routes; optional fuzz later |

No **critical** exposure found. Security/privacy gate: **passes for the static site as deployed**; live report submission remains **gated on S-01**.
