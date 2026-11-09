# 01 — System inventory

Audit of 9 November 2026. The inventory below was drafted read-only from the repository by a survey agent and then verified by the auditor on the points that matter for launch. **Auditor's verification notes (supersede the draft where they differ):**

- **Baseline (verified):** branch `main`, HEAD `83d415ce0`, clean tree; `origin/main` fetched = `360cd291d`; production serves `assets/app.38126cc2d1c1.js`, the build of `678cee12d` (served-check of production from an archive of `origin/main`: 68/68). The four local commits (`4dc4dd7d7`, `63bc73ad7`, `aad5b14a0`, `83d415ce0`) are **not deployed**: production `/api/report` → 404.
- **Static exposure (verified, not merely suspected):** production answers 200 for `/build.mjs`, `/ingest/sec.mjs`, `/src/js/00-core.js`, `/journeys.mjs`, `/docs/release-gate.md`, `/.github/workflows/checks.yml`, `/claims-reviewed.json`; 404 for `/README.md`, `/package.json`, `/watchlist-symbols.txt`, `/api/report.mjs`. The repository is public, so no secret or private data is exposed; recorded as hygiene (04 S-03).
- **`QT_REPORTS_DAILY_CAP` is documented** in docs/report-submission.md (the draft left this Unverified).
- **AGENTS.md does not exist** in the repository; the instruction files read were CLAUDE.md, README.md, docs/*.md and the handoff's HANDOFF.md.
- **Journeys:** source defines 28 (the new `submission` journey); the production record holds 27 until the next push. The `submission` journey was corrected during this audit so that it reads DEGRADED (gated outcome steps, reason stated) rather than FAIL against any non-local address — verified against production (0 fail, 1 degraded) and locally (1 pass).
- **Classification:** the register's vocabulary (active-core, maintenance, beta, flagged, data-gated, compliance, queued) differs from this brief's; the table classifies by what the visitor sees, as the draft explains.

---

## Survey draft (read-only, 9 Nov 2026)

Read-only inventory taken 9 Nov 2026 from `D:\Download\quantum-tradeworks` (HEAD `83d415ce0`). Nothing was built, served or run. Paths are relative to the repo root. "Live" below means what the repository claims, not what Vercel serves (see section 4).

## 1. Baseline

### 1.1 Architecture and runtime
- Static single-page app, no runtime dependencies. `package.json` says the deployed site is static files assembled from `src/` by `build.mjs` and committed (package.json:5). The devDependencies are `sharp` and `xlsx` only (package.json:31-34).
- Node: `engines.node >=22` (package.json:29). Every workflow pins `node-version: '22'` (checks.yml:51, 299, 443; journeys.yml:144; checks-record.yml:50). The Node version the Vercel project runs `api/report.mjs` on is not in the repo (Unverified).
- Build: `build.mjs` concatenates `src/js/*.js` (48 files, `00-core.js` to `97-decision-record.js`) plus `src/styles.css` into `assets/app.<hash>.js` and `assets/app.<hash>.css`. It writes `index.html`, `404.html`, `pages/`, `assets/` and `vercel.json` (build.mjs:3-7, 66). Committed assets: `assets/app.d63a1dfa08f6.js`, `assets/app.4154fb4e2020.css`.
- Prerender: `pages/<route>.html` carries the page's inert HTML from `prerender/` (prerender.mjs:3, 29; build.mjs:47). `/prerender/*` is served with `X-Robots-Tag: noindex` and is disallowed in robots.txt (robots.txt:36; vercel.json headers).
- Serving: `vercel.json` is generated from `ROUTES` (35-ui.js:1206; build.mjs:66). It holds 220 rewrites (route to `pages/*.html`; parametric routes such as `/company/:id` go to `pages/generic.app.html`), 121 redirects (`/index.html` to `/` plus 119 `/company/<TICKER>-SEC` aliases), `trailingSlash:false`, and 7 header rules including CSP. I counted these by parsing vercel.json with node.
- CSP (identical on `/vendor/*` and the catch-all): `default-src 'self'; script-src 'self' + 2 sha256 hashes; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'` (vercel.json, `headers`). Also `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `COOP same-origin`, `X-Frame-Options DENY`. `/data/*`, `/vendor/*` and the hashed assets are `immutable`; pages are `no-cache`.
- Deploy path: Vercel Git integration; `vercel.json` has no build command or ignore step and no workflow deploys anything (docs/release-gate.md:15-16). Vercel promotes production as soon as the deployment is ready, without waiting for checks.yml (docs/release-gate.md:17). Deployment Checks was "off" on 9 Nov (docs/release-gate.md:7). `.vercelignore` excludes only `/index.html` and `/data/napic-h1-2025.json` (.vercelignore, two non-comment lines).
- Production URL: `https://quantum-tradeworks.vercel.app` (deploy-check.mjs:52; robots.txt Sitemap line; health/journeys.json `url`).
- Local server: `serve.mjs` reproduces Vercel's rules from `vercel.json` and also executes `api/<name>.mjs` (serve.mjs:30-40, 300).

### 1.2 Storage
- Browser `localStorage` only, key prefix `vl.` (00-core.js:413, 428). `PORTABLE_KEYS` (00-core.js:473-538) lists 35 portable keys, including: portfolios, theses, watchlists, observations, areaProfiles, demand, registerLog, corrections, deal, opportunities, wheelPlan, wheelLegs, qttiPlan, manualPrices, userData, priceAlerts, savedWork, scanSetups, scanAlertState, scanPrefs, and others. `exportEverything()` is at 00-core.js:547. The file names no cookies and no sessionStorage/IndexedDB; a grep of `src/js` for `document.cookie|serviceWorker|indexedDB|sessionStorage` found no matches.
- Server-side storage: none, except the optional report store behind `/api/report` (GitHub Issues in `QT_REPORTS_REPO`, or files in `QT_REPORTS_DIR`; api/report.mjs:114-124).
- Privacy page states "no accounts, no cookies" (55-views-public.js:2164-2166; 35-ui.js:1417).

### 1.3 Server functions / API routes
- One function: `api/report.mjs` (default export handler at line 214).
  - Methods: `GET`/`HEAD` return `{ok, accepts:'POST', configured, store, limits}` (lines 216-219); `POST` validates, rate-limits and files an issue; any other method returns 405 (line 221).
  - Kinds `data-error` and `feedback` (line 47); body max 16 KiB (line 48); report max 8000 characters (line 49).
  - Abuse control: 5 per sender per 10 minutes, in-memory per warm instance (lines 70-71); daily cap default 50, overridable by `QT_REPORTS_DAILY_CAP`, fails closed (lines 72-73, 91-92, 167).
  - No CORS header; refuses a non-JSON body (lines 29, 7).
  - Outbound calls: `https://api.github.com/search/issues` and `https://api.github.com/repos/<repo>/issues` (lines 96, 169).
- No `/api` rewrite in `vercel.json`; Vercel's own `/api/*` function routing is relied on (serve.mjs:300 states the same assumption). No `functions` or `runtime` block in vercel.json (parsed keys: rewrites, trailingSlash, redirects, headers).
- Git state: per local refs, HEAD is 4 commits ahead of `origin/main` (`4dc4dd7d7`, `63bc73ad7`, `aad5b14a0`, `83d415ce0`), so `api/report.mjs` and the Submit control are not on production unless pushed since. Production state: Unverified.

### 1.4 Authentication
None. "There are no accounts, so there is no role to gate /admin/scanner with" (87-scanner-ops.js:26-28). `/my/*` and `/app/*` are not protected; they read the visitor's own browser. No auth code or session code was found in `api/`. One authorization header exists, a GitHub token for the report store (api/report.mjs:116) and for CI (checks-record.mjs:478).

### 1.5 External integrations and outbound network calls

**Browser time (must be same-origin under `connect-src 'self'`)**

| Call | Where | Same-origin? |
|---|---|---|
| `fetch(url)` for `data/*.json`, `health/*.json` etc. via the app loader | 35-ui.js:1459; 91-health.js:203, 275, 314, 333 | yes |
| `GET` then `POST` to `LAUNCH.reportEndpoint` = `/api/report` | 65-learn.js:843, 850; 15-derivation.js (LAUNCH, `reportEndpoint: '/api/report'`) | yes |
| `POST` to `LAUNCH.waitlistEndpoint` | 65-learn.js:1169 | `''` today, so never called (15-derivation.js:445; hidden by `waitlistReady()` at 65-learn.js:1142) |
| Map tiles via vendored MapLibre and pmtiles from `data/tiles/kuching-20261012.pmtiles` | 92-kuching-map.js:10-12, 419 | yes (self-hosted; map-assets.mjs:74-75) |

Everything else in `src/js` that matches `https://` is an outbound hyperlink (SEC EDGAR 40-views-discover.js:2759-2766; NAPIC, Brickz, EdgeProp, LHDN, lawnet, malaysianbar etc. 19-data-licence.js:84-120, 70-property.js:842-2305; the ELS enquiry page `https://els.alumax.pro/contact` 70-property.js:1562) or an SVG namespace. None is fetched. I found no `XMLHttpRequest`, `sendBeacon`, `WebSocket` or `new Worker(` in `src/js` (the grep on those terms returned nothing). `src/index.template.html` contains only `quantum-tradeworks.vercel.app` URLs.

**Build, ingest and operator time (never from visitors' browsers)**

| Remote | File:line | Purpose |
|---|---|---|
| SEC EDGAR: `www.sec.gov/files/company_tickers.json`, `data.sec.gov/api/xbrl/companyfacts`, `data.sec.gov/submissions` | ingest/sec.mjs:426, 599, 675 | writes `data/us.json` |
| BNM `api.bnm.gov.my`, Frankfurter `api.frankfurter.app` | ingest/fx.mjs:45, 67 | USD/MYR rate |
| Twelve Data `api.twelvedata.com` | ingest/providers.mjs:414; ingest/live.mjs:96; ingest/vendor-probe.mjs:94 | optional priced provider (needs `TWELVEDATA_KEY`) |
| Other providers | ingest/providers.mjs:112, 202, 295 | quote/history providers (base URLs not enumerated here) |
| Nominatim (OSM) | ingest/sarawak-geo.mjs:106 | locality coordinates to `data/sarawak-geo.json` |
| `api.data.gov.my` household income | ingest/sarawak-geo.mjs:146 | `data/sarawak-income.json` (git-ignored) |
| DOSM `storage.dosm.gov.my/.../population_district.csv`; Overpass mirrors (overpass-api.de, overpass.private.coffee, overpass.kumi.systems) | ingest/sarawak-reach.mjs:73, 77, 396, 406 | `data/sarawak-reach.json` |
| Overpass; `build.protomaps.com` pmtiles extract; `raw.githubusercontent.com` protomaps/tangrams assets; `github.com` | map-assets.mjs:148, 178, 198-247, 280 | developer-machine map assets under `data/map/`, `data/tiles/`, `vendor/` |
| NAPIC/JPPH: no fetch; reads local PDF/Excel from `property-data/raw/`; `sourceUrl` is metadata only | napic-ingest.mjs:597 | `data/napic-h1-2025.json` |
| `api.anthropic.com/v1/messages` | qtti/extract.mjs:304 | optional screenshot-extraction assistant (`ANTHROPIC_API_KEY`) |
| GitHub API (`api.github.com`) | checks-record.mjs:479, 483; api/report.mjs:96, 169; workflows via `gh`/`GH_TOKEN` | CI records, issues |
| `https://quantum-tradeworks.vercel.app` | journeys.mjs `--url production`; deploy-check.mjs:52 | production probes |
| `http://127.0.0.1:<port>/json/version` | ingest/autoshot.mjs:99; journeys.mjs:807 | local Chrome DevTools |
| TradingView watchlist capture (headless Chrome, `ingest/autoshot.mjs`, `capture.ps1`, `schedule.ps1 -Url ".../watchlists/XXXXXXXX/"`) | ingest/schedule.ps1:4-5 | operator's own screen capture; personal-lane data |

### 1.6 Environment variables (grep of `process.env` over *.mjs, api/, ingest/, scanner/, qtti/, workflows; `.claude/worktrees` excluded)

| Variable | Used in | Role | Documented? |
|---|---|---|---|
| `QT_REPORTS_GITHUB_TOKEN`, `QT_REPORTS_REPO` | api/report.mjs:116-117; serve.mjs:40, 382 | production report store | docs/report-submission.md; 15-derivation.js comment |
| `QT_REPORTS_DAILY_CAP` | api/report.mjs:73 | daily cap, default 50 | in code only; docs/report-submission.md not checked for this name (Unverified) |
| `QT_REPORTS_DIR` | api/report.mjs:119; serve.mjs:40 | local file store | docs/report-submission.md |
| `SEC_UA` | ingest/sec.mjs:68, 979; equity-test.mjs:2786 | SEC contact User-Agent (required) | ingest/README.md |
| `GEO_UA`, `REACH_UA` | ingest/sarawak-geo.mjs:49; sarawak-reach.mjs:429 | Nominatim/Overpass/DOSM User-Agent | in code |
| `TWELVEDATA_KEY`, `TWELVEDATA_REDIST`, `PRICE_LICENCE` | ingest/live.mjs:96, 99, 258; vendor-probe.mjs:74 | optional paid provider | in code |
| `ANTHROPIC_API_KEY` | qtti/extract.mjs:307, 461 | QTTI screenshot extraction | README "Screenshot extraction" (README.md:289) |
| `CHROME_PATH`, `CHROME_BIN`, `CDP_PORT`, `CI` | sweep, mobile, model-test, equity-test, register-test, coverage-frames, journeys, screenshot, ingest-test, autoshot | test-harness browser | in code |
| `PORT` | serve.mjs:26 | local server | in code |
| `PRERENDER_PORT` | prerender.mjs:143 | self-test | in code |
| `GH_TOKEN`, `GITHUB_TOKEN`, `QT_CHECKS_DIR`, `RUNNER_TEMP`, `GITHUB_STEP_SUMMARY`, `GITHUB_ACTIONS` | checks-record.mjs:478, 811, 839, 843 | CI | in code |
| `JOURNEY_FONT`, `JOURNEY_TZ`, `JOURNEY_LOCALE`, `JOURNEY_VERBOSE`, `QT_TRACE` | journeys.mjs:922-928, 2856; mobile.mjs:4564 | test knobs | in code |
| `STUB_*`, `QT_SIGNAL_AT` | history-store-test.mjs:774-778; scanner-test.mjs:1253, 2207, 2327 | test stubs | n/a |

Workflow `env` blocks use only `github.token` and run outputs (journeys.yml:165-232, 268-292; checks-record.yml:54-81, 128). No repository secret is referenced by name in any workflow.

### 1.7 Data sources and update mechanism

| File | Written by | Notes |
|---|---|---|
| `data/us.json` | `node ingest/sec.mjs --out data/us.json` (ingest/sec.mjs:6, 1031) | SEC EDGAR; `generated: 2026-08-03T00:16:33Z`, `source: SEC EDGAR` (data/us.json:2-3); 119 US companies (ingest/README.md:16-17). The `year-end rule` fix of 26 Sep means the data has not been regenerated (memory; Unverified in code). |
| `data/instruments.json` | hand-edited ("not generated") | instrument identity and aliases (data/instruments.json:2) |
| `data/napic-h1-2025.json` and `data/napic-h1-2025/<division>.json` | `node napic-ingest.mjs` writes the 1 MB source file (napic-ingest.mjs:47, 622); `build.mjs` slices per-division files (build.mjs:231-239) | NAPIC H1 2025, `licence.status: REVIEW_REQUIRED`, `publish: DERIVED_ONLY` (data/napic-h1-2025.json, head). The whole file is kept off the host by `.vercelignore`. |
| `data/sarawak-geo.json` | `ingest/sarawak-geo.mjs` (GEO_OUT, line 42) | Nominatim, ODbL |
| `data/sarawak-reach.json` | `ingest/sarawak-reach.mjs` (line 72) | DOSM population (CC BY 4.0) plus OSM places |
| `data/map/*`, `data/tiles/kuching-20261012.pmtiles`, `vendor/maplibre-gl-6.11.2`, `vendor/pmtiles-4.5.0` | `map-assets.mjs` (developer machine) | self-hosted map; manifest at data/map/manifest.json |
| `data/examples/cost-schedule-v1.{csv,json}` | tracked example | cost-schedule import example (journeys.mjs:2533) |
| `data/prices.example.csv`, `data/scan-setups.json` template | tracked templates (`scanner/setups.example.json` is the committed template) | `data/scan-setups.json` is git-ignored |
| Git-ignored, present in the working tree: `prices.json`, `personal-prices.json`, `personal-fundamentals.json`, `price-history.json(.bak)`, `scan-alerts.json`, `scan-setups.json`, `sarawak-income.json`, `watchlist-review.*` | operator's daily run (`ingest/daily.mjs`) or the user | personal or licence-unconfirmed; CI blocks them if tracked (checks.yml:241-285) |
| `renders/*` (AVIF/WebP) | `renders.mjs` | deterministic product renders |
| `health/journeys.json`, `health/checks.json` | `journeys.yml` and `checks-record.yml` commit to main | see 1.10 |

### 1.8 Test suites and checks (root `*.mjs`, `scanner/`, `ingest/`)

| Script | Covers | Browser? | Network? |
|---|---|---|---|
| `syntax.mjs` | every JS file parses (checks.yml:55-56) | no | no |
| `build.mjs --check` | committed index/pages/assets/vercel.json equal what src builds | no | no |
| `serve.mjs` | not a test; local server | no | no |
| `served-check.mjs` | each address's served head, 404s, headers, `/health/*.json`, probes `/.env`, `/wp-login.php` (served-check.mjs:603-683); `--url` mode can hit production | no | localhost (or production with `--url`) |
| `ingest-test.mjs` | SEC year-end selection on a fixture | optional (`CHROME_PATH` at :443) | no |
| `history-store-test.mjs` | price-history store | no | no |
| `data-check.mjs` | shipped `data/us.json` against ingest rules | no | no |
| `scanner-test.mjs` | scanner engine and worker on fixtures (5425 lines) | no | no |
| `register-check.mjs` | capability register against routes/checks/Phase 2 brief | no | no |
| `journeys.mjs` | 28 end-to-end journeys (journeys.mjs, 28 top-level `id:` entries); `--url production` for the live site | yes | localhost, or production |
| `report-api-test.mjs` | `api/report.mjs` rules, offline | no | no |
| `checks-record.mjs` | the CI results record (self-test) | no | GitHub API only in `collect` |
| `wording-check.mjs` | banned claim wording | no | no |
| `claims-review.mjs` | claims-to-review list (informational, `continue-on-error`, checks.yml:229-233) | no | no |
| `napic-ingest.mjs --check` | NAPIC extract reconciles; skipped when `property-data/raw` absent (checks.yml:236-239) | no | no |
| `sweep.mjs` | every route loads and settles | yes | localhost |
| `coverage-frames.mjs` | no route states two answers to one question | yes | localhost |
| `prerender.mjs --check` | served pages equal the app's own render | yes | localhost |
| `register-test.mjs` | register record/edit/undo/replay | yes | localhost |
| `model-test.mjs` | published property figures equal their labels | yes | localhost |
| `equity-test.mjs` | filed statements derived as labelled; `--links` mode makes HEAD requests to SEC (needs `SEC_UA`, :2786-2790) | yes | localhost; SEC only with `--links` |
| `mobile.mjs` | no horizontal overflow at any width | yes | localhost |
| `deploy-check.mjs` | production serves the same file as the repo | no | production |
| `screenshot.mjs`, `renders.mjs`, `map-assets.mjs` | developer tools, not tests | yes/no | map-assets: yes |
| `scanner/bot-verify.mjs`, `scanner/tv-verify.mjs` | reader's TradingView bot/indicators vs their own exports | no | no (operator-run; not in CI) |
| `ingest/history-check.mjs` | price-history report and repair | no | optional `--refetch` |
| `ingest/vendor-probe.mjs` | does Twelve Data carry Bursa fundamentals | no | yes (paid key) |
| `qtti/batch.mjs`, `qtti/extract.mjs` | QT Trading Index weekly batch and screenshot assistant | no | extract: Anthropic API |

CI covers 15 recorded suites (health/checks.json: model-test, equity-test, register-test, scanner-test, ingest-test, history-store-test, data-check, register-check, served-check-data, served-check, build-check, prerender-check, sweep, coverage-frames, mobile, all PASS at `b5724ae16`). `scanner/bot-verify.mjs`, `scanner/tv-verify.mjs`, `ingest/history-check.mjs`, `ingest/vendor-probe.mjs`, `qtti/*`, `deploy-check.mjs` are not run by checks.yml (grep of the workflow's `run:` lines).

### 1.9 CI and deployment workflows

| Workflow | Triggers | Jobs |
|---|---|---|
| `checks.yml` | push (all branches), pull_request, workflow_dispatch (:28-32) | `static` (syntax, build --check, served-check on serve.mjs :8124, ingest-test, history-store-test, data-check, scanner-test, register-check, journeys self-test, report-api-test, checks-record self-test, CSP hash check, wording-check, claims-review, NAPIC check, licensed-data guard; :55-289), `runtime` (Chrome, serve, sweep, coverage-frames, prerender-check, register-test, model-test, equity-test, mobile; :291-423), `journeys` (all journeys against localhost; :435-478), `gate` requires all three (:489-500) |
| `journeys.yml` | `deployment_status`, cron `17 3,15 * * *` (03:17 and 15:17 UTC), workflow_dispatch (:73-77) | one job: runs `journeys.mjs --url production`, opens/updates/closes a GitHub issue, collects the served commit's checks, commits `health/*.json` to main; permissions `contents:write, issues:write, actions:write, checks:read` (:100-104) |
| `checks-record.yml` | `workflow_run` of `checks` completed on `main` (:21-25) | collects suite annotations and records them to `health/checks.json`, opens/closes an issue |

No workflow deploys. The deploy gate (Vercel Deployment Checks) is a Vercel project setting and was off (docs/release-gate.md:7).

### 1.10 Production monitoring and health
- `/status` (route, `VIEWS.status`; 91-health.js) reads `health/journeys.json` and `health/checks.json` (91-health.js:314, 333) and does HEAD/GET checks of data files (91-health.js:203, 275).
- No `/health` route and no `/api/health`; the health records are static JSON at `/health/journeys.json` and `/health/checks.json`, served `no-cache` and not versioned (served-check.mjs:661-683).
- Latest recorded production run: 9 Nov 2026 11:30 UTC, trigger `schedule`, 27 journeys all PASS, commit `b5724ae16` (health/journeys.json). Latest recorded checks: commit `b5724ae16`, conclusion `success`, 15 suites PASS (health/checks.json). Both records predate HEAD and the `submission` journey (journeys.mjs:4107); the production record therefore contains 27 of the 28 journeys in source.
- The report function has no monitoring beyond `console.error` logging (api/report.mjs:235) and the GitHub issues it creates.

### 1.11 Operational, privacy, terms and commercial documentation
- `README.md` (759 lines): run, deployment check, journeys, structure, scanner worker, TradingView bot, weekly routine, source review, "Deliberately absent", Licence ("Private and unlicensed", README.md:757-759). No `LICENSE` file.
- `docs/`: `release-gate.md` (deploy gate), `report-submission.md` (report store, env, verification), `route-map.md` (routes; says code wins when stale, :13-14), `platform-plan.md`, `phase2-plan.md`, `phase2-qa.md`, `phase3-plan.md`, `phase3-qa.md`, `property-els-summary.md` (ELS brief). `ingest/README.md` covers ingestion.
- Privacy: `/privacy` (55-views-public.js:2164; a "draft PDPA 2010 notice", 35-ui.js:1417). Terms: `/terms` (55-views-public.js:2261; "Draft terms", 35-ui.js:1418). Also `/about`, `/contact` (55-views-public.js:2090, 2133), `/corrections`, `/data-sources`, `/methodology`, `/learn/product-boundaries` (35-ui.js:924-935).
- Commercial: `/pricing` (view `plans`, 90-area-screen.js:1536; `src/js/05-plans.js`); the register row "Plans and pricing" is `maintenance` (80-registers.js). The owner decisions say no price figures until purchasable (memory; not in repo).

## 2. Tool table

Sources: `PRODUCTS` (35-ui.js:391-452), `TOOLS` (35-ui.js:557-679), `RESOURCES` (35-ui.js:924-935), `CAPABILITY_REGISTER` (80-registers.js:86-423), `ROUTES` (35-ui.js:1206+), docs/route-map.md.

Note on the register vocabulary: it does not use `available/unavailable`. Its statuses are `active-core, maintenance, beta, flagged, data-gated, compliance, queued` (80-registers.js:25-43); only the first three count as operational (80-registers.js:45). The UI vocabulary is `live` shown as "Available", `beta`, `demo`, `soon` (35-ui.js:449-450, `PRODUCT_STATUS`). The classification below follows the UI status the visitor sees, adjusted by the register where the register says data-gated.

Journey names below are ids in health/journeys.json (all PASS at 9 Nov). "-" means no journey or test was found that names it. "Storage" is localStorage unless stated; `PORTABLE_KEYS` is 00-core.js:473.

| Tool | Purpose | Entry route | Dependencies | Data source | Storage | Tests | Public status |
|---|---|---|---|---|---|---|---|
| Equities Research (product, 35-ui.js:392) | research a company | `/research` | `data/us.json`, `data/instruments.json` | SEC EDGAR filings (119 US); 18 Malaysian companies and PGR illustrative (package.json:4) | watchlists, theses | equities, screener, compare journeys; equity-test, data-check | Public beta |
| Research overview (:559) | find a company | `/research` | as above | as above | - | equities; sweep | Public beta |
| Screener (:562) | filter companies | `/discover/screener` | filings | `data/us.json`; price measures blank without a price | savedScreens | screener; equity-test | Public beta |
| Value map (:565) | quality vs modelled value | `/discover/value-map` | filings, sample prices | illustrative prices | - | sweep, coverage-frames only | Public beta |
| Compare (:568) | side by side | `/compare` | filings | `data/us.json` | comparisons | compare; register row `flagged` (80-registers.js) | Public beta (register: Feature-flagged, partial) |
| Research queue (:571) | what holds in reported figures | `/research/queue` | filings, watchlist | `data/us.json` | watchlists | sweep, equity-test | Public beta |
| Sarawak watch (:574) | Bursa companies in Sarawak | `/discover/sarawak` | instruments | `data/instruments.json`; no statements | sarawakExposure | - (register row `data-gated`) | Public beta |
| Cash Wheel (:577) | put/call cycle model | `/us-options/wheel` | none | contract you enter; no option chain | wheelPlan, wheelLegs | records journey | Public and available (register: `data-gated`) |
| Quantum Scanner (product, :415) | user-defined setups on user price history | `/app/scanner` | engine sliced from `index.html` by scanner/scan.mjs | user-supplied closes; site ships none | scanSetups, scanAlertState, scanPrefs | scanner journey; scanner-test | Public beta |
| Scanner Dashboard (:617), Setups (:623) incl. `/app/scanner/setups/new`, `/:setup`, `/:setup/edit`, Watchlist scanner (:626), Alerts (:629), Settings (:635, live) | build, list, review setups | `/app/scanner/*` | worker files in `data/` (git-ignored, absent on host) | user's history and worker output | scanSetups etc. | scanner, settings journeys | Public beta (Settings: Public and available) |
| Scanner Market (your series) (:620), Historical (:632) | run/simulate a setup on your own history | `/app/scanner/market`, `/backtest` | history | user's history | none ("recorded nowhere") | scanner-test; register rows `flagged` | Public beta (register: Feature-flagged) |
| Scanner worker (`scanner/scan.mjs`, `ingest/daily.mjs`) | daily evaluation of setups; writes `data/scan-alerts.json` | command line (Windows Task Scheduler via `ingest/schedule.ps1`) | Node, Chrome capture, history store | operator's price history | `data/*.json` (git-ignored) | scanner-test, history-store-test | Internal only. The UI says "the worker ... is not distributed yet" (35-ui.js:415-421 statusNote); not deployed; not in the Vercel tree except as repo files (see 3.4). Register row "Daily scanner worker" is `beta` (80-registers.js:330) |
| Scanner operations `/admin/scanner`, `/data`, `/jobs`, `/delivery` | read-only view of the local worker's files | those four routes (35-ui.js:1265-1268) | worker files | git-ignored files; "empty on the deployed site" (87-scanner-ops.js:26-29) | none | equity-test ("operations pages render ... read-only", 80-registers.js:337); sweep | Internal only (no auth; reachable by URL; `Disallow: /admin/`, robots.txt:36; not linked from the homepage nav) |
| Email, Telegram, push notifications | alert delivery | `/app/scanner/settings` (email); none | n/a | n/a | n/a | - | Planned/unavailable (`compliance` in the register, 80-registers.js:347, 392-396; "the app is the only delivery channel", 35-ui.js:635) |
| Trading Index (:639) | multi-timeframe trend reading from your own chart evidence | `/research/trading-index` (+ aliases `/trading-index`, `/learn/trading-index`) | none | evidence you record | qttiPlan, observations | records journey | Public and available |
| QTTI batch/extract (`qtti/*.mjs`) | weekly batch; screenshot extraction draft | CLI | `ANTHROPIC_API_KEY`, Chrome | user screenshots | `qtti/out`, `qtti/screenshots` (git-ignored) | - | Internal only |
| Property Intelligence (product, :423) | model a property | `/property` | none | figures you enter; synthetic sample | deal, opportunities | property, property-phone, quick, commercial, refurb, costs journeys; model-test | Public and available (the only `live` product) |
| Calculator (:588) | cash flow, yield, cash required | `/property/calculator` | NAPIC/DOSM data for context | entered figures | deal | property, property-phone; model-test | Public and available |
| My properties (:584) | saved property models | `/property/models` | calculator | local | savedWork | property | Public and available (disallowed in robots.txt) |
| Scenario Lab (:592) | scenarios on the calculator's own model | `/property/lab` | calculator | entered figures | labComparisons | lab | Public beta |
| Area screen (:595) and Kuching scheme map | shade localities by recorded evidence; map | `/property/areas`, `/property/areas/map` | `data/map/*`, `data/tiles/*.pmtiles`, `vendor/maplibre-gl-6.11.2`, `vendor/pmtiles-4.5.0`, `data/sarawak-reach.json` | OSM (ODbL), DOSM (CC BY 4.0), NAPIC derived | areaProfiles | registers, map journeys | Public and available (map row: beta in the register, 80-registers.js:130) |
| Comparables (:599) | record transactions and rents | `/property/comparables` | none | recorded by user | registerLog | registers | Public and available (register: `data-gated`) |
| Market pulse (:604) | recorded supply/price/demand snapshots | `/property/market` | none | recorded by user | demand | - (named journey not found) | Public beta |
| Opportunities (:607) | candidates with known/unknown | `/property/opportunities` | none | recorded by user | opportunities | registers, property-flow | Public and available |
| Optional ELS brief (`elsBrief`, 70-property.js:1541-1590) | copy-only brief for a separate business (ELS); sends nothing | in the calculator and proposal | none | the user's deal | none | journeys.mjs:1629 checks link `https://els.alumax.pro/contact`, `_blank`, `noopener noreferrer` | Public beta (an outbound link plus copy text; no tool status field) |
| Property proposal / decision record / investor report | print and share | `/property/models/:property/proposal`, `/decision-record`, `/my/reports` | saved model | local | savedWork | records, backup | Public and available (reports row is live, 35-ui.js:659) |
| My Dashboard (:644) | what changed since last visit | `/app` | local | local | all | return journey | Public and available |
| Watchlists (:648), My Alerts (:652) | follow companies; thresholds | `/my/watchlists`, `/my/alerts` | local | local | watchlists, priceAlerts | equities, cases | Public and available |
| Saved work (:656) | everything saved | `/my/workspace` | local | local | savedWork | backup, replay | Public beta (register: `flagged`) |
| Print & share (:659) | PDF reports of own work | `/my/reports` | local | local | none | records | Public and available |
| Portfolio (:663), Investment cases (:667) | holdings; theses | `/my/portfolio`, `/my/theses` | local | local | portfolios, theses | cases | Public and available |
| Tracked (:671) | follow by price and trend | `/my/tracked` | closes you supply | local | manualPrices | - | Public beta |
| Your data & settings (:677) | paste closes; export everything | `/my/data` | `exportEverything` (00-core.js:547) | local | userData, manualPrices | settings, backup | Public and available |
| Report / feedback submission | send a data-error report or feedback; receipt only after the store has it | footer, `/contact`, `/corrections` | `api/report.mjs`, GitHub Issues store, 3 env vars | visitor text | draft in `corrections`; server: GitHub issue | report-api-test; `submission` journey (journeys.mjs:4107, `degrade`s against production, :4125) | Planned/unavailable on production until pushed, store configured and the Submit control is shown (store configured: Unverified; control only appears when the GET probe says configured, 65-learn.js:843). Code exists locally, so Unknown for the deployed site |
| Waitlist | email list | none | `LAUNCH.waitlistEndpoint` | n/a | none | privacy copy tracks `waitlistReady()` (55-views-public.js:2166, 2175, 2210) | Planned/unavailable (hidden while empty: 15-derivation.js:445, 65-learn.js:1142) |
| Business Intelligence (product, :437) | plan my business | none (`path: null`) | none | none | none | - | Planned/unavailable ("Not built yet", 35-ui.js:441; hidden by `SHOW_UNBUILT=false`, :447) |
| Learn, Methodology, Data sources, Corrections, Glossary, Pricing, About, Contact, Privacy, Terms, Status | reference and trust pages | `/learn`, `/methodology`, `/data-sources`, `/corrections`, `/learn/glossary`, `/pricing`, `/about`, `/contact`, `/privacy`, `/terms`, `/status` | none | static | none (corrections: local drafts) | sweep, served-check, ctas, corrections | Public and available (Privacy and Terms are labelled draft) |
| Company pages | per-company research | `/company/<code>-<name>` (119 SEC plus 18 Bursa slugs) and `/company/:id` | filings | `data/us.json` | none | sweep, served-check, equity-test | Public beta |
| Deprecated | none identified | | | | | | I found no tool marked deprecated; route aliases remain served (`/wheel`, `/cash-wheel`, `/options`, `/my/options`, `/app/equities/*`) |

## 3. Orphans, unused routes, hidden dependencies, disabled functionality, undocumented configuration

### 3.1 Orphaned tools
- `/admin/scanner*` (4 routes): present in `ROUTES`, absent from nav (35-ui.js:1019 lists them as app views), and `robots.txt` disallows them. They are public by URL and empty on the host. Not a defect in itself; it is an unauthenticated operator surface.
- `/app/equities`, `/app/equities/explore`, `/app/equities/compare` and `/app/watchlists`, `/app/workspace`: aliases for Phase 2's brief (vercel.json rewrites; robots.txt:4-8). Alias, not orphan.
- `qtti/batch.mjs`, `qtti/extract.mjs`, `scanner/bot-verify.mjs`, `scanner/tv-verify.mjs`, `ingest/vendor-probe.mjs`, `ingest/history-check.mjs`: operator tools, in no workflow.
- Market pulse (35-ui.js:604) and Sarawak watch (:574) have no journey of their own in health/journeys.json (journey names are listed in 1.10); sweep covers loading only.
- None found: any `src/js` view without a route (not exhaustively checked; `toolPresent()` at 35-ui.js:684 guards the tool list at run time).

### 3.2 Unused or duplicated routes
- `/company/:id/report`, `/app/equities/:id/*` and similar parametric rewrites all go to `pages/generic.app.html` (vercel.json).
- Four route families resolve to one view: `/us-options/wheel`, `/wheel`, `/cash-wheel`, `/options`; `/my/wheel` and `/my/options` share `pages/my/wheel.html`.
- `/trading-index`, `/research/trading-index` and `/learn/trading-index` share one view.
- No dead route was proven from the repository alone.

### 3.3 Disabled functionality (flag-hidden)
- Waitlist: `LAUNCH.waitlistEndpoint: ''` (15-derivation.js:445).
- Business Intelligence: `SHOW_UNBUILT = false` (35-ui.js:447).
- Report submission control: drawn only if the `GET /api/report` probe returns `configured: true` (65-learn.js:843; api/report.mjs:219).
- Email, Telegram, push notifications: `compliance` rows (80-registers.js:347, 392).
- Analytics: removed; the template carries no analytics tag (15-derivation.js comment "ANALYTICS: none").
- Feature-flagged register rows (partial, reachable): Company comparison, Valuation models, Saved work, Research report, Historical matches, Market screening (80-registers.js `status:'flagged'`).
- Data-gated rows: Comparables, Bursa universe, Cash Wheel, Trade-setup scanner, Sarawak Economy Watch.

### 3.4 Hidden dependencies
- **Static serving of the repository root.** `vercel.json` has no build or output directory, and `.vercelignore` excludes only two paths. Vercel serves a file before any rewrite (.vercelignore:6-9). So `build.mjs`, `ingest/*.mjs`, `scanner/*.mjs`, `docs/*.md`, `README.md`, `package.json`, `qtti/*`, `health/*` and `serve.mjs` may be fetchable at their paths on production. served-check.mjs probes only `/.env` and `/wp-login.php` (:603-609). Whether the deployed host exposes them is Unverified; recommend a probe (a `GET` of `/build.mjs`, `/ingest/sec.mjs`, `/docs/release-gate.md`). `docs/release-gate.md` and `README.md` contain commit hashes and operational detail.
- **Local tools read the app out of `index.html`.** scanner/scan.mjs, ingest, qtti, syntax.mjs and the harnesses slice code from `index.html` (build.mjs:3-5; scanner/scan.mjs:59-61; qtti/batch.mjs:11-13). `index.html` is kept off the host by `.vercelignore`, which build.mjs and serve.mjs read (serve.mjs:188).
- **Workflows commit to main.** `journeys.yml` and `checks-record.yml` push `health/*.json` with `contents: write` (journeys.yml:100-104). Any local work must merge, not rebase (memory; not in repo).
- **checks.yml needs a Chrome install and serves its own copy** (checks.yml:306-330). The runtime and journeys jobs also use `serve.mjs`.
- **The report function and `serve.mjs` share a store assumption**: a local server with no env gets a temp dir (serve.mjs:40). Production without `QT_REPORTS_*` answers `configured:false` (api/report.mjs:219).
- **Git-ignored local data.** The working tree contains licensed or personal files (`data/prices.json`, `personal-prices.json`, `price-history.json`, etc.). They are guarded by `.gitignore` and a CI check (checks.yml:241-285); the Vercel Git deploy cannot ship them, but a CLI deploy from this folder would (`.vercelignore` does not list them). Unverified how production is deployed beyond docs/release-gate.md:15.
- **`.claude/worktrees/` agent copies** live inside the repo folder and are git-ignored (.gitignore:137); `grep process.env` over the whole tree returns duplicates from them. Not shipped.

### 3.5 Undocumented or weakly documented configuration
- `QT_REPORTS_DAILY_CAP` is read at api/report.mjs:73; it is in the file's own header comment (api/report.mjs:53-73). Whether docs/report-submission.md names it: Unverified.
- `GEO_UA`, `REACH_UA`, `TWELVEDATA_*`, `PRICE_LICENCE`, `JOURNEY_*`, `QT_TRACE`, `PRERENDER_PORT`: in code only; not found in README.md by name (not exhaustively checked).
- Vercel project settings that the system depends on (Deployment Checks, Node version, env vars, domain) are outside the repo.
- `docs/route-map.md` says it was generated on 2026-09-29 and may be stale; "the code is right" (route-map.md:13-14). Its tool and route names have drifted (it does not list `/admin/*` or Release B tools as such; not exhaustively compared).
- Register vocabulary differs from the one the brief uses (`available/unavailable`), see section 2.
- `LAUNCH.contactEmail` is set to a personal Gmail address (15-derivation.js:446); this is the support contact the owner approved (memory). It appears on `/contact` and in the repo.
- The scanner's "Daily scanner worker" row says `beta`, while the UI says the worker "is not distributed yet" (35-ui.js:415-421). The two use different meanings ("beta" = code exists and tested; "not distributed" = no download).

## 4. Not established from the repository (Unverified)
1. Vercel project settings: Deployment Checks (docs/release-gate.md says off on 9 Nov; cannot confirm now), production branch, Node version, environment variables, domains, Web Analytics, log retention.
2. Whether `QT_REPORTS_REPO`, `QT_REPORTS_GITHUB_TOKEN` and `QT_REPORTS_DAILY_CAP` are set in Vercel, whether the token's scope is limited to issues in one private repo, and whether `/api/report` exists on production (HEAD is ahead of `origin/main` by local refs; a fetch was not done).
3. Whether the repository root (build scripts, docs, ingest, scanner, health) is actually served as static files by the production host (see 3.4).
4. How the owner runs the worker and ingest (Windows Task Scheduler on the owner's machine); `ingest/schedule.ps1` shows how, not that it is running.
5. The currency of `data/us.json` (generated 2026-08-03) against the ingest's year-end fix; the live copy's content.
6. Whether GitHub branch protection or Actions secrets exist; the workflows use only `github.token`.
7. Whether `health/journeys.json` on production reflects the latest deployed commit (the file says `b5724ae16`; HEAD is `83d415ce0`).
8. Legal sufficiency of `/privacy` and `/terms` (both labelled draft in 35-ui.js:1417-1418); not assessed here.
9. Real-device and phone behaviour, and whether `/api/report` runs correctly under Vercel's runtime (only `serve.mjs` and offline tests exercised it).
