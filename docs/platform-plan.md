# Quantum Tradeworks — platform plan

The eleven deliverables the platform brief asks for before anything structural
changes, written against the repository as it stands on 27 September 2026.
Where the brief and the codebase disagree, this document says so and says which
one this plan follows. Nothing here is a promise of a date.

The governing decision, taken 27 September 2026: **the current static
application stays the product and is extended.** The SaaS layer the brief
describes — accounts, billing, an admin console, a scanner offered to others —
is planned here as a separate phase gated on three things no code removes: an
operating entity (for accounts, billing and a privacy notice under Malaysian
PDPA), a licensed end-of-day market-data feed with redistribution rights, and
written Malaysian legal classification of each surface under the Capital
Markets and Services Act. Until those exist, everything built is built inside
the architecture below.

---

## 1. Existing repository and data audit

### What the application is

One static file. `index.html` (1.66 MB) is assembled from 33 modules in
`src/js/` by `build.mjs` and committed; Vercel serves it with no build step and
a hashed Content-Security-Policy (`connect-src 'self'`, `form-action 'none'`).
There is no server, no API, no database, no account and no third-party request
of any kind. Every route is one HTML file rendered client-side; every
calculation runs in the reader's browser from data files under `/data/`.

| Layer | Today |
|---|---|
| Frontend | Vanilla JavaScript, one script, hand-built `el()` DOM helper; `src/styles.css` with design tokens on `:root` and a dark theme |
| Backend | None |
| Database | None. Reader state is `localStorage` (44 keys, all prefixed `vl.`); personal market data is git-ignored JSON under `data/` |
| Auth | None. `State.plan` is a client-side toggle; no payment is processed |
| Jobs | Local scripts under `ingest/`, `qtti/`, run by hand or by one Windows Scheduled Task |
| Tests | Nine harnesses (see §11), run in CI on every push |
| Deployment | Vercel, static; `deploy-check.mjs` verifies production serves the committed file byte-for-byte |

### What it holds

| Set | Count | Nature |
|---|---|---|
| US companies | 119 | Audited annual statements from SEC EDGAR `companyfacts`, ten fiscal years each (six carry fewer), USD billions, per-line XBRL provenance. Retrieved 3 Aug 2026 |
| Malaysian companies | 18 | Illustrative: real listing codes, synthetic financials, labelled on every surface |
| Illustrative US | 1 | Progressive (PGR) — its filed twin is not in the set |
| Prices | 0 | No market-data licence for either exchange. A filed company carries no price unless the reader enters one |
| NAPIC property data | H1 2025 | Derived division-level summaries and published benchmark ranges only (987 kB); raw source files are private pending JPPH confirmation of redistribution rights |
| Sarawak geography | cached | Coordinates under ODbL with per-area match confidence |

### What exists per product area

**Equities research** — 137 companies; nine valuation methods routed by
business model; four-pillar scorecards; screener with saved screens and
explain-exclusion; Value Map with a point-in-time slider; Strategy Lens; thesis
builder with invalidation conditions; alerts feed (fact changes, screen
membership, price thresholds — evaluated in-browser at render time, no
delivery); compare; portfolio; watchlists; data-error reporting (recorded
locally, nothing sent). Data status is a company-level filed/illustrative flag
plus a partially wired four-kind metric label; the source drawer shows formula,
period, source and model version but not input values or filing dates.

**QT Trading Index** — multi-timeframe trend regime from chart evidence the
reader records; batch runner slices the engine out of `index.html` so page and
batch cannot drift; a phase-2 extraction script writes drafts a person must
confirm. Never sorted by score; 0% weight in the research composite.

**Property Deal Check** — Sarawak property underwriting: true capital ledger
with a versioned fee registry (every line carries `status`, `source`,
`effectiveFrom`, `verifiedAt`, `verifiedBy`; all currently unverified), RPGT by
disposer category, financing scenarios, flat-rate translator, MRTA/MLTA
comparison, borrower loan readiness, financeability, rental cash flow with tax
on the rent, real IRR by bisection, tornado sensitivity, break-even solving,
stress tables, A–D/U grade with hard gates, eight IPS gates, opportunity
register, comparables register, area screen with land risk, decision record
(print/PDF). Saved locally with `modelVersion` and `asOf`.

**Ingest (personal lane, local only)** — SEC ingest; watchlist screenshot OCR
→ reviewed prices; Yahoo/Twelve Data live quotes confined to the personal
lane; daily history accumulation (105 symbols, up to 504 closes, volume);
BNM FX; NAPIC extraction. CI fails if any personal or licensed file is ever
tracked.

**Business, Wealth** — nothing.

### What is deliberately absent, in the code's own words

Accounts and sign-in; server persistence; billing, trial and renewal; licensed
market data; AI analysis; any form of recommendation, ranking presented as
preference, target price, or personalised output; brokerage connection or
execution. Each is stated on `/learn/product-boundaries`, `/status` and the
README, with the reason.

### Client-side records ("the database" today)

`localStorage`, prefix `vl.`: `deal`, `opportunities`, `observations`,
`areaProfiles`, `demand`, `registerLog`, `registerActor`, `borrowerProfile`,
`theses`, `reviews`, `runs`, `portfolios`, `dividendsReceived`, `watchlist`,
`watchlists`, `priceAlerts`, `savedScreens`, `screen`, `compare`, `compareCcy`,
`recentCompanies`, `wheelPlan`, `wheelLegs`, `wht`, `qttiPlan`, `savedWork`,
`corrections`, `reportLog`, `propertyReportsBought`, `sarawakExposure`,
`userData`, `manualPrices`, `launcherAnswers`, `onboarding`, `introDismissed`,
`plan`, `theme`, `lang`, `density`, `explainDepth`, `baseCcy`, `screenCcy`,
`realData`, `rateUnitBuilt`, `rateUnitLand`, `dash`. Export/import of the whole
set exists (`/my/data`). Nothing is sent anywhere; the privacy page lists all
of it.

Git-ignored personal files under `data/`: `prices.json`, `personal-prices.json`,
`price-history.json`, `personal-fundamentals.json`, `watchlist-review*`,
`sarawak-income.json`, daily reports; under `qtti/`: `observations.json`,
`screenshots/`, `out/`. Added by this plan: `data/scan-setups.json`,
`data/scan-alerts.json`.

---

## 2. Route map

The brief's information architecture, mapped to what exists. "Exists" means
the route resolves today; "alias" means the same view under the brief's path
would be a one-line addition; "gated" names the blocker.

### Public

| Brief | Today | Status |
|---|---|---|
| `/` | `/` marketing | exists |
| `/products` | — | proposed: a directory page over the existing product landings |
| `/equities` | `/research` | alias |
| `/scanner` | — | gated (licence, classification); a personal-lane page exists at `/my/scanner` (this plan) |
| `/property` | `/property` | exists |
| `/business` | — | not built |
| `/pricing` | `/pricing` | exists (no payment processed; says so) |
| `/resources` | `/learn`, `/methodology`, `/data-sources`, `/corrections`, `/learn/glossary`, `/learn/product-boundaries`, `/methodology/ips`, `/status` | exists; `/resources` would alias `/learn` |
| Sign in | — | gated (entity) |

### Authenticated workspace (today: the same browser, no identity)

| Brief | Today | Status |
|---|---|---|
| `/app` | `/app` dashboard | exists |
| `/app/equities` | `/research`, `/company/:id`, `/discover/*`, `/compare` | exists under different paths |
| `/app/scanner` | `/my/scanner` | this plan, personal lane |
| `/app/property` | `/property/calculator`, `/property/opportunities`, `/property/comparables`, `/property/areas`, `/decision-record` | exists |
| `/app/business` | — | not built |
| `/app/wealth` | — | not built (`/my/portfolio` covers holdings and income) |
| `/app/watchlists` | `/my/watchlists` | exists |
| `/app/alerts` | `/my/alerts` | exists (in-browser evaluation, no delivery) |
| `/app/reports` | `/decision-record`, saved work on `/my/data` | partial |
| `/app/settings` | `/my/data` (export, import, theme, currency) | partial |
| `/admin` | — | gated (entity, identity) |

Routes carry their tab in the path where one exists and in `?tab=` otherwise;
a tab never crosses views. Parameters other than `personal` and `real` are
view-scoped from this plan onward (§6 of the property stream).

---

## 3. Data model

### Today

There is no server-side model. Each client record is a plain object in
`localStorage`; the shapes that matter for a future migration are:

- **Property deal** — every input in `PROPERTY_DEFAULT_DEAL` plus `evidence`
  (per-input provenance), `touched`, `checks`. Saved work wraps it with
  `modelVersion`, `asOf`, `savedAt`, `editor: 'this browser'`.
- **Opportunity** — `{ id, name, source, state, capturedAt,
  availabilityCheckedAt, available, deal (partial), touched, evidence,
  negotiatedPrice, valuerEstimate, nextAction, nextActionOwner, nextActionDue }`.
- **Observation** (comparables) — `{ kind, value, date, city, area, sqft,
  titleType, propertyType, address, source, licence, category, subtype, tenure }`.
- **Register log** — append-only events with entity, actor and payload; undo
  and replay are derived from it.
- **Thesis** — `{ ticker, conds:[{ k|type, op, v, label }], … }`.
- **Saved valuation run** — inputs, model version, as-of date.

### Proposed (SaaS phase, PostgreSQL)

Schemas as the brief lists them, with these decisions:

- **`FinancialModel` envelope** (brief §6) is the target shape for a property
  deal, a Cash Wheel contract, a Trading Index run and a scanner setup alike:
  `inputData`, `calculatedResults`, `currency`, `calculationVersion`
  (= `MODEL_VERSION` / `SCAN_VERSION`), `assumptionsVersion` (= fee registry
  version, RPGT schedule version). The current `savedWork` record already
  carries two of the four version fields; the migration is a rename.
- **Money** as `numeric(18,4)`, never floating point. The in-browser engine
  uses IEEE doubles; a server import must round once, at the boundary, with
  the rounding rule recorded on the record.
- **Timestamps** UTC with exchange time zone on the instrument.
- **Provenance** on every market-data row: source, licence state (the seven
  states of `DATA_LICENCES`), ingestion time.
- **Soft deletion** only for records a reader can undo (register events);
  hard deletion elsewhere, because retention of financial inputs a person
  asked to remove is a liability, not a feature.
- **Audit records** immutable for administrative actions.

Entity outline (one line each; the ERD proper is drawn when the phase starts):

```
identity   users ─< memberships >─ organisations ; sessions
commerce   plans ─< entitlements ; subscriptions ─< payments
market     exchanges ─< instruments ─< prices ; instruments ─< statements ─< statement_lines(provenance) ; filings
scanner    watchlists ─< watchlist_items ; setups ─< rules ; scan_runs ─< alert_events (dedupe key unique)
property   properties ─< scenarios(FinancialModel) ─< reports ; loans ; expenses ; fee_registry_versions
business   businesses ─< transactions ; projects ; forecasts(FinancialModel)
wealth     assets ; liabilities ; goals ; scenarios(FinancialModel)
shared     notifications ; files ; activity_logs ; audit_logs(immutable)
```

---

## 4. Roles and permissions

### Today

One role: whoever holds the browser. `State.plan` (`free` / `pro` / `all`) is
an **entitlement**, not a security boundary — it is enforced client-side and
can be changed in the console. That is stated on `/pricing` and is acceptable
only because nothing is paid for and no data leaves the device.

### Proposed

Two systems, as the brief requires. RBAC decides what an actor may do;
entitlements decide what a subscription unlocks. A plan must never be a role.

| Role | May | May not |
|---|---|---|
| Visitor | read public pages, run demonstrations | save |
| Registered | save own models, watchlists, setups | see anyone else's |
| Paid | everything Registered can, within entitlements | exceed quotas |
| Org owner | manage org, billing, members | read members' models without a share |
| Org admin | manage members | billing |
| Analyst / editor | create and edit models shared to them | share onward |
| Viewer | read what is explicitly shared | edit |
| Support agent | support records; customer data only with a logged, time-boxed grant | browse financial models |
| Data administrator | ingestion, quality, provenance | customer data |
| Platform administrator | configuration, operations | customer financial models without a grant |

A saved-item reference (workspace) is a pointer; the underlying resource
enforces its own permission on every read. Professional personas (trader,
researcher, property investor, agent, mortgage professional, SME owner,
accountant) are workspace presets, not access levels.

---

## 5. Component inventory

Existing helpers, all in the single script, mapped to the brief's shared
components. One implementation each; no product may fork one.

| Brief | Today | Notes |
|---|---|---|
| AppShell | `src/index.template.html` + `render()` | header, nav, main, footer, drawer, modal |
| Sidebar | `buildNav()`, `mySubnav()`, `.subnav` tab strips | five top-level destinations by design |
| TopNavigation | `buildNav()` | real anchors; middle-click works |
| SearchBar | `openSearch()` / `runSearch()` | `/` opens; ticker, name, Bursa code, pages |
| MetricCard | `statTile()` | value, delta, sub, sparkline, tone |
| FinancialTable | `table.dt` + `gridKeyboard()` + `tableTwin()` | keyboard grid, sticky pin column, chart table-twins |
| ChartPanel | `columnChart`, `lineChart`, `sparkline`, `treemap`, `tornadoChart`, `rangeStrip` | SVG, `role="img"`, labels |
| FilterBar | screener filter groups | not generic yet |
| DateRangePicker | — | not built; the product has no date-ranged data a reader chooses |
| CurrencyInput | `numField()` + base-currency selector | |
| ScenarioSelector | stress tables, financing scenarios, radar slider | per surface |
| AssumptionEditor | Valuation Studio inputs; property input `GROUPS` | |
| DataSourceBadge | `provChip()`, `illusChip()`, `sevChip()`, `marketChip()`, `provenance()`, `dataDateLabel()`, `priceAsOfLabel()` | extended by the status taxonomy in §12 |
| AlertCard | `.noteitem` in the alerts feed | |
| ReportPreview | decision record (`97-decision-record.js`) | print/PDF |
| EmptyState | `emptyState()`, `emptyStateCta()` | |
| ErrorState | boot failure banner, "not available" cards | per surface |
| SubscriptionGate | `lim()` / `planOf()` | client-side entitlement only |

Design tokens live on `:root` in `src/styles.css` with a dark redefinition;
positive/negative never rely on colour alone (sign characters, labels).

---

## 6. API contract

### Today

None. The engine functions that would become the service layer already have
stable signatures and are the contract a server would wrap:

| Function | Module | Would back |
|---|---|---|
| `derive(c)` | 15 | `/api/v1/equities/{id}/metrics` |
| `valuationRun(c, d, inputs)`, `nineMethods(r)` | 20 | `/api/v1/equities/{id}/valuation` |
| `evaluateScreen(r, sc)` | 40 | `/api/v1/equities/screen` |
| `dealModel(d)`, `propertyGrade(d, m)`, `propertyIpsAnswers(d, m, g)`, `propertySensitivity(d)` | 75, 77, 78 | `/api/v1/property/models` |
| `qttiRun(plan)` | 85 | `/api/v1/trading-index/runs` |
| `scanRun(setups, history)` | 86 (this plan) | `/api/v1/scanner/runs` |
| `coverage()`, `coverageSentence()` | 15 | `/api/v1/market-data/coverage` |

### Proposed

The brief's `/api/v1` namespace, with these rules: every mutation requires
server-side authorisation and schema validation; every response carrying a
figure carries its `calculationVersion` and the data's provenance and
freshness; no endpoint returns a ranking, a rating or a target price.

---

## 7. Background jobs

### Today

| Job | Trigger | Script | Output |
|---|---|---|---|
| Watchlist capture → OCR → reviewed prices → history → FX → report | Windows Scheduled Task `QuantumTradeworks-DailyPrices`, 18:30 | `ingest/daily.mjs` | `data/personal-prices.json`, `data/price-history.json`, `data/daily-report.txt` |
| Trade-setup scan (this plan) | after history, in the same run, when `data/scan-setups.json` exists | `scanner/scan.mjs` | `data/scan-alerts.json` |
| Trading Index weekly batch | by hand | `qtti/batch.mjs` | `qtti/out/*.md`, `.csv` |
| SEC ingest | by hand, needs `SEC_UA` | `ingest/sec.mjs` | `data/us.json` |
| NAPIC extraction | by hand | `napic-ingest.mjs` | `data/napic-h1-2025.json` |

Exit codes are the reporting channel (0 clean, 1 failed, 2 needs a person).

### Proposed queue

Idempotency key per job type, dead-letter after three retries, structured logs:

| Job | Trigger | Idempotency key |
|---|---|---|
| Market-data ingestion | provider schedule | `provider:instrument:date` |
| Daily scan | exchange close + data confirmation | `setup:instrument:timeframe:barDate` (also the alert dedupe key) |
| Statement refresh | new filing / weekly | `cik:accession` |
| Alert delivery | new alert event | `alertEvent:channel` |
| Report generation | request | `model:version:requestId` |
| Billing reconciliation | payment webhook | `paymentId` |
| Data quality | ingestion complete | `run` |

A triggered setup is stored before any delivery is attempted; a delivery retry
must not create a second alert for the same key.

---

## 8. Data sources and licensing

| Source | Holds | Rights | State |
|---|---|---|---|
| SEC EDGAR companyfacts | US annual statements | public domain, no redistribution issue for reported facts | connected (119 filers) |
| Illustrative set | 19 companies' financials and prices | ours; synthetic | labelled everywhere |
| NAPIC / JPPH | Sarawak transactions and benchmarks | raw: `REVIEW_REQUIRED`; derived summaries: `DERIVED_ONLY` with attribution | summaries shipped; raw private |
| Bank Negara Malaysia | USD/MYR | public; attribution | connected (`ingest/fx.mjs`) |
| OpenStreetMap | coordinates | ODbL | cached with attribution |
| DOSM / data.gov.my | macro | CC BY 4.0 | context only |
| Yahoo Finance | quotes, history | terms bar automated collection; **personal lane only, never served** | local |
| TradingView (screenshots) | the reader's own watchlist as pixels | no right to redistribute | local, OCR, reviewed |
| Twelve Data | Bursa symbols confirmed; statements unproven | redistribution purchasable; `TWELVEDATA_REDIST=1` asserts it | candidate; probe before any talk of rights |
| Bursa Malaysia | prices, announcements | licensed, not free | not connected |
| Sarawak household income cache | | rights unconfirmed | git-ignored |

The conclusion of the source review stands: for Bursa fundamentals, free,
structured and redistributable — pick any two. Nothing in this plan changes it.

---

## 9. Backlog, feature by feature

Status: **done** · **partial** · **now** (this plan, being built) · **blocked
(licence / entity / regulatory)** · **not planned**.

### Equities

| Item | Status |
|---|---|
| Company search by ticker, name, exchange, Bursa code | done |
| Overview, statements, ratios, comparisons, watchlist | done |
| Valuation calculator with user assumptions | done (Studio) |
| Data lineage: source, period, formula, update date | **done** (8e761ca): an inputs table in the source drawer with the latest value, fiscal year and XBRL tag of every input; a status on every figure and a reason on every absence. Filing date and form per input wait on the `us.json` regeneration |
| Actual / derived / illustrative / unavailable visibly distinct | **done** (8e761ca): reported / calculated / modelled / market / illustrative on every present figure; not reported / not applicable / withheld / needs a price / not meaningful on every absence, on the screener cell and in the drawer |
| Filings index | done (EDGAR links for filed companies; no invented list) |

### Scanner

| Item | Status |
|---|---|
| Setup builder: universe, timeframe, indicator, operator, threshold, confirmation, AND/OR, cooldown, expiry | **done** (8c3345f) at `/my/scanner`, personal lane, daily timeframe only |
| Daily scanner over end-of-day bars | **done** (8c3345f): `scanner/scan.mjs` over the reader's own history, run by `ingest/daily.mjs`; a licensed feed would plug into the same engine |
| Alert engine with dedupe on setup × instrument × timeframe × bar | **done** (8c3345f): key `setup|symbol|daily|bar`, cooldown counted in bars |
| Alert history with timestamps and triggering values | **done** (8c3345f): `data/scan-alerts.json`, shown on `/my/scanner` |
| Notification delivery (email, Telegram, push) | blocked (entity — contact data under PDPA; and a backend) |
| Intraday scanner | blocked (licence, infrastructure, classification) |
| Backtesting | blocked (point-in-time licensed history); the product states no indicator here is validated |
| Scanner as a product for others | blocked (licence, regulatory) |

### Property

| Item | Status |
|---|---|
| Acquisition, mortgage, affordability, rental, cash flow, exit, sensitivity | done |
| Versioned statutory tables, reproducible saved models | done (fee registry, RPGT schedule, `modelVersion`) — values unverified, said so |
| Renovation ROI | **done** (138b36e): share of rent and of exit value attributable to the renovation, payback, rate of return with and without |
| Hold-versus-sell | **done** (138b36e): year-by-year net proceeds and rate of return if sold in year *y* |
| Property comparison | **done** (138b36e): side-by-side table on the opportunity register, register order, same assumptions |
| Shareable model | **done** (138b36e): the deal in the address, so a link reproduces the screen |
| Report generator | done (decision record) |
| Lock-in and refinancing | not planned this phase |

### Business, Wealth

Not planned this phase. Both need a backend, imports and an entity.

### Workspace

| Item | Status |
|---|---|
| Saved items across products | partial (`savedWork` for deal, Cash Wheel, Trading Index; theses, portfolios, watchlists separately) |
| One overview of everything saved | proposed after the streams above |
| Sharing | blocked (identity) |

### Platform

| Item | Status |
|---|---|
| Identity, organisations, RBAC | blocked (entity) |
| Billing, entitlements server-side | blocked (entity) |
| Admin console | blocked (identity) |
| Notifications engine | blocked (backend) |
| Versioned calculations | done in-browser; server envelope per §3 |
| Feature flags | not needed while there is one deployable file; required the day there are two |

---

## 10. Migration and rollback

1. The static application remains the production surface throughout. Any
   SaaS work lives under `apps/` (or a separate repository) behind its own
   deployment, and nothing in `index.html` calls it until the phase's
   acceptance list is met.
2. Rollback of the static site is `git revert` of a commit; the deployed file
   is the committed file (`deploy-check.mjs` proves it). No migration step can
   strand it.
3. Reader data migrates by the export that already exists (`/my/data` →
   JSON backup) into a server import that validates each record against its
   `modelVersion` and re-runs the calculation, comparing results before
   accepting. A record whose recalculation differs is imported with both
   results and flagged, never silently replaced.
4. Personal-lane files (`data/*.json`, git-ignored) never migrate to a shared
   server; they are the reader's own licensed material.
5. Staging is a Vercel preview deployment per branch for the static site, and
   a separate environment with its own database for any SaaS phase. Nothing
   structural goes to production from a laptop.
6. Every phase ends with a documented acceptance run (§11) attached to the
   release commit.

---

## 11. Testing and release acceptance

### What runs today, on every push

| Check | Script | Fails on |
|---|---|---|
| Parses | `syntax.mjs` | a syntax error in the bundle |
| Build matches source | `build.mjs --check` | drift between `src/` and the committed `index.html` / `vercel.json` |
| CSP covers the shipped script | inline in `checks.yml` | a stale hash |
| No banned claim wording | `wording-check.mjs` | six phrases the licensed data cannot support |
| No licensed data tracked | inline | any personal or licensed file in git |
| Ingest rule | `ingest-test.mjs` | the year-end balance rule, on a fixture |
| Every route renders | `sweep.mjs` | console errors, failed requests, CSP violations, NaN/undefined, overflow, on 50 routes |
| No route contradicts itself | `coverage-frames.mjs` | two answers to one count question while a page settles |
| Register sequence | `register-test.mjs` | record, edit, undo, replay, backup across every logged entity |
| Property arithmetic | `model-test.mjs` | 24 definitional invariants (NPV at the IRR is zero, break-evens are zeros, exits sum the path…) |
| Filed statements | `equity-test.mjs` | 23 checks: labels, absent-line rules, goldens by fiscal-year label, split withholding, rendered surfaces, address and focus rules |
| Mobile | `mobile.mjs` | horizontal overflow at 360–1440 on 20 routes; unloaded or unmeasurable pages fail |

### The brief's twelve acceptance criteria, against this codebase

| Criterion | Today |
|---|---|
| Every navigation item resolves | met; the sweep visits every route |
| All actions have working backend implementations | there is no backend; every action is implemented client-side, and the ones that cannot be (send, pay, sign in) say so |
| Authentication and permissions enforced | not applicable until identity exists; `/pricing` says no payment is processed |
| Calculations have automated tests | met for property and equities; the scanner engine has `scanner-test.mjs` (51 checks) since 8c3345f |
| Consistent units | met; stated on every table; currency conversions go through one FX rate |
| Provenance and freshness on external data | met at company level; per-figure since 8e761ca (§12.2) |
| Empty, loading and error states | met; the sweep catches an empty page |
| Mobile usable | met, and now measurable |
| Background jobs monitored, retried | exit codes and a report file; no queue — accepted for a personal lane |
| Reports preserve assumptions | met (`modelVersion`, `asOf`, every input and its provenance on the decision record) |
| Billing enforced server-side | not applicable; none |
| Critical workflows end-to-end | partial; equity-test drives the company page and address rules, model-test the calculator; the scanner gets one |

### Release rule

A commit ships when the local suite is green, the build reproduces, the CI run
on the push is green, and the commit message states what was verified. That is
the rule this repository has followed since August and it does not change.

---

## 12. Designs fixed by this plan

### 12.1 Scanner — personal lane

**Where it runs.** `scanner/scan.mjs`, a Node worker that slices the engine
out of `index.html` between `@scan-engine-start` / `@scan-engine-end` (the
Trading Index pattern) so the page and the worker cannot evaluate a rule
differently. Every run self-tests on a fixture first and refuses to continue if
the extracted engine disagrees with it. `ingest/daily.mjs` calls it after the
history step when `data/scan-setups.json` exists.

**Data.** The reader's own `data/price-history.json` (closes and volumes by
symbol and date). Nothing else. Both the setups file and the alerts file are
git-ignored; CI fails if either is ever tracked.

**Setup.**

```json
{
  "id": "trend-breakout",
  "name": "Trend breakout",
  "enabled": true,
  "universe": { "kind": "symbols", "symbols": ["NVDA", "1155"] },
  "timeframe": "daily",
  "confirmation": "close",
  "logic": "AND",
  "rules": [
    { "left": { "indicator": "price" },
      "op": "crosses_above",
      "right": { "indicator": "ema", "n": 50 } },
    { "left": { "indicator": "volume" },
      "op": "above",
      "right": { "indicator": "volume_avg", "n": 20, "multiplier": 1.5 } },
    { "left": { "indicator": "rsi", "n": 14 },
      "op": "between", "range": [50, 70] }
  ],
  "cooldownBars": 5,
  "expires": null
}
```

Indicators: `price`, `volume`, `sma(n)`, `ema(n)`, `rsi(n)`, `macd(fast,
slow, signal)` (line, signal, histogram), `volume_avg(n)`. Operators: `above`,
`below`, `crosses_above`, `crosses_below`, `between`. `universe.kind` is
`all`, `market` (`US` or `MY`) or `symbols`. Only `daily` and `close` exist in
this build; the schema names the fields so a licensed feed adds values, not
fields.

**Evaluation.** On the last completed bar only. A rule whose indicator lacks
history is *untested*, which is neither met nor failed and blocks an `AND`
setup from matching. A crossing needs the bar before. A matched setup produces
one alert record:

```json
{ "key": "trend-breakout|NVDA|daily|2026-08-06",
  "setupId": "trend-breakout", "symbol": "NVDA", "timeframe": "daily",
  "bar": "2026-08-06", "close": 181.2, "recordedAt": "2026-08-06T10:31:04Z",
  "rules": [ { "text": "price 181.20 crossed above EMA50 178.44", "met": true }, … ],
  "engine": "scan 0.1.0" }
```

**Dedupe and cooldown.** The key is unique; a re-run for the same bar writes
nothing. A setup that matched a symbol within the last `cooldownBars` bars does
not match it again.

**What it never does.** Rank, sort by score, say buy or sell, deliver anything,
or claim an indicator works. The page states that no indicator here is
validated on point-in-time data and that the alert is a record of conditions
you defined being met on data you supplied.

### 12.2 Data status — four states on every figure and every absence

| State | Meaning | Where it shows |
|---|---|---|
| **Reported** | a statement line as filed | statement table cells |
| **Calculated** | arithmetic on reported lines, no assumption | ratios |
| **Modelled** | an output of assumptions the reader can change | scores, model estimates |
| **Market** | needs a price, from the stated source | multiples, yields, market cap |
| **Illustrative** | the company's figures are synthetic | every surface, already |
| **Unavailable — not reported** | an input line is absent in the filing | cell reads *not reported* |
| **Unavailable — not applicable** | the measure does not fit the business model | *n/a* |
| **Unavailable — withheld** | inputs disagree (revenue suspect, thin equity, split, scale) | *withheld* with the reason |
| **Unavailable — needs a price** | a market measure with no licensed or entered price | *no price* |

`metricStatus(row, key)` returns the state and the reason; the screener cell,
the source drawer and the compare table render from it. The drawer lists each
input line with its latest value and fiscal year, the XBRL tag that supplied
it, and — once `data/us.json` is regenerated — the filing's date and form and
the period end.

**As built (8e761ca).** The four-way design needed a fifth of each. A fifth
kind, *illustrative*: a figure on a synthetic company is arithmetic like any
other, but on lines that describe no company, and calling it "calculated"
would have said less than the page already says. A fifth reason, *not
meaningful*: a P/E on negative earnings has every input present and no honest
number, which is neither "not reported" nor "withheld". `metricStatus(row,
key)` decides both, once, and the screener cell, the drawer and the Learn
legend read it.

### 12.3 Property additions

- Exit value = `price × (1 + appreciation)^y + renovation × recovery%`, where
  recovery is the share of the renovation spend reflected in the sale value
  (default 0, which is today's behaviour). Rent uplift is the share of the
  entered rent that depends on the renovation (default 0).
- Renovation return: cost, annual rent attributable, payback in years, value
  recovered at exit, and the rate of return with and without the renovation
  (the "without" case runs the same model with no renovation and the rent
  reduced by the uplift).
- Hold versus sell: for every year of the holding period, sale value, loan
  outstanding, RPGT rate, net proceeds, rental cash to date and the rate of
  return if sold that year — where the final year's figure must equal the
  model's own rate of return (a test).
- Comparison: on the opportunity register, one table, candidates as columns
  in register order, the calculator's current assumptions for anything a
  record does not state.
- Address: `?d=` carries every input that differs from the default, with its
  evidence and whether it was entered, so a pasted link reproduces the deal;
  view-scoped parameters are dropped when leaving the view.
