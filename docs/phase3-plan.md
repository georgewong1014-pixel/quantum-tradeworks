# Phase 3 — Quantum Scanner, against the application as it stands

*Written 28 September 2026 against commit ba032e6 (live in production), from
an audit of every SC item in the "Phase 3 Development Specification" by three
independent readers of the code. Each item records what exists, the gap, what
can be built now, and what is blocked and on what.*

## 0. The decision this plan rests on

The specification describes a server product: authentication and ownerIds,
scanner tables and an `/api/v1/scanner` namespace, email and Telegram
delivery, an administrators' console with audited controls, and an authorised
OHLCV feed. The decision recorded in [platform-plan.md](platform-plan.md) and
applied in [phase2-plan.md](phase2-plan.md) stands: the static application is
the product and is extended; the server layer waits on an operating entity, a
licensed end-of-day feed with redistribution rights, and written Malaysian
legal classification.

So the Quantum Scanner in this phase is the **personal-lane scanner made
complete**: the reader's own history, validated and dated correctly; one
indicator library and one rule engine shared by the page, the worker and
historical testing; versioned setups; deduplicated, explainable alerts; a
worker with a run log, a lock, retry and audited replay; an in-app
notification centre; and pages at every address the specification names.
Email, Telegram and push are recorded as channels that are not configured,
with the reason. Nothing is offered to anyone but the reader.

## 1. Status at a glance

“Before” is the state this plan found; “Now” is the state after round 3. The per-item sections below say what was built and what was not, under “As built”.

| Item | Priority | Before | Now | Landed in | Still blocked |
|---|---|---|---|---|---|
| NAV Phase 3 routes | P0 | partial | built | round 2 ops (be046a8), round 2 setups (f0c09a2), round 3 user (2a31dd3), round 3 ops (6b3ae70) | An admin role (there are no accounts); intraday entries. |
| SC-301 Market-data ingestion | P0 | partial | partial | round 2 data (e21115a), round 3 data (076e7ff), round 3 worker (cac8129) | A licensed feed and a provider that confirms final bars (the ready gate judges by the clock). |
| SC-302 OHLCV storage and validation | P0 | partial | built | round 1 (4ea840a), round 2 data (e21115a), round 3 data (076e7ff) | A corporate-action source: only the splits the reader records are applied, never dividends. |
| SC-303 Technical indicator engine | P0 | partial | built | round 1 (4ea840a), round 3 data (076e7ff) | A committed reference file from TA-Lib or pandas-ta, which cannot be generated here. |
| SC-304 Rule evaluation engine | P0 | partial | built | round 1 (4ea840a), round 3 user (2a31dd3) | A server validation endpoint; intraday timeframes (SC-317). |
| SC-305 Setup builder | P0 | partial | built | round 2 setups (f0c09a2), round 3 user (2a31dd3), round 3 worker (cac8129) | Intraday timeframes, exchange-wide universes, server validation. |
| SC-306 Setup persistence and permissions | P0 | partial | partial | round 2 setups (f0c09a2), round 3 worker (cac8129) | Tables, ownership and sync across devices, because there are no accounts. |
| SC-307 Daily scanner scheduler | P0 | partial | built | round 2 data (e21115a), round 3 worker (cac8129) | A scheduler service and job queue: the reader’s task scheduler starts the worker. |
| SC-308 Alert event engine | P0 | partial | built | round 1 (4ea840a) | A user id and an authorised data source id. |
| SC-309 Email notifications | P0 | blocked | in-app only | round 2 setups (f0c09a2), round 2 data (e21115a) | Email needs a server, an operating entity and contact data under a PDPA privacy notice. |
| SC-310 Alert history and detail pages | P0 | partial | built | round 2 setups (f0c09a2), round 3 user (2a31dd3), round 3 worker (cac8129) | Status shared across devices; intraday timestamps. |
| SC-311 Watchlist integration | P0 | partial | partial | round 2 setups (f0c09a2), round 3 user (2a31dd3), round 3 worker (cac8129) | Live resolution: the worker reads the list as last exported, never as it is now. |
| SC-312 Scanner dashboard | P0 | partial | built | round 1 (4ea840a), round 2 ops (be046a8), round 3 worker (cac8129) | Cross-user metrics; notification health measured by delivery. |
| SC-313 Administrative monitoring | P0 | missing | read-only | round 1 (4ea840a), round 2 ops (be046a8), round 3 ops (6b3ae70) | An admin role and operator identity, provider control, a job queue. |
| SC-314 Historical testing | P1 | missing | built, flagged | round 1 (4ea840a), round 2 ops (be046a8), round 3 ops (6b3ae70) | Performance figures, which need entries, exits, costs and adjusted prices. |
| SC-315 Telegram notifications | P1 | blocked | blocked | round 2 data (e21115a) | A server-held bot token and a chat id under a privacy notice. |
| SC-316 Market-wide screening | P1 | partial | built, flagged | round 2 ops (be046a8), round 3 user (2a31dd3), round 3 ops (6b3ae70), round 3 worker (cac8129) | A whole exchange, and screening for anyone else: a licensed feed and legal classification. |
| SC-317 Intraday scanner infrastructure | P2 | blocked | blocked | round 2 data (e21115a), round 3 data (076e7ff), round 3 user (2a31dd3) | A licensed intraday feed. |
| SC-318 Live push notifications | P2 | blocked | blocked | round 2 data (e21115a) | A push service, a server holding subscriptions, and SC-317. |
| SC-319 Automated QA and regression | P0 | partial | partial | round 2 ops (be046a8), round 3 ops (6b3ae70), round 3 worker (cac8129), round 3 data (076e7ff) | QA items 17 to 19 and the release going green, which wait on the blocked P0 items. |

## 2. The contract

One contract for every builder. Where the three audits proposed different
details, this section decides.

**The engine moves.** The pure region between `@scan-engine-start` and
`@scan-engine-end` moves from src/js/86-scanner.js into a new
src/js/24-market-engine.js, which loads before 26-instruments and 60-trend.
scanner/scan.mjs and every other Node tool slice it out of index.html by its
markers, so its file does not matter to them. It stays pure: no DOM, no
State, no storage. SCAN_VERSION becomes 0.3.0. Everything below is exported
from loadEngine.

**Constants.** SCAN_MARKETS { US, MY, FX, CRYPTO, _default } with tz, session
close, settle minutes and weekdays (26-instruments' MARKETS takes its time
zones from here, and a check asserts they agree). SCAN_TIMEFRAMES: '1D' built;
'1W' built, derived from '1D' with a completeness flag; '1H', '15M', '5M' not
built, each with its reason. SCAN_LIMITS { maxDepth: 3, maxConditions: 20,
maxPeriod: 520, maxSetups: 200 }. SCAN_INDICATORS with metadata per id —
label, params with defaults and bounds, fields, inputs (close, open, high,
low, volume), unit, needs(spec), formula text, calcVersion — for price,
volume, sma, ema, rsi (Wilder), macd (line, signal, hist), volume_avg, bb
(upper, middle, lower, width), atr (Wilder; needs high/low), high_n and low_n
(need high/low), close_high_n and close_low_n (closing highs and lows —
labelled as such), change (percent over n bars) and rvol (volume ÷ average).
SCAN_OPERATORS keyed GREATER_THAN, LESS_THAN, GREATER_THAN_OR_EQUAL,
LESS_THAN_OR_EQUAL, EQUALS (with a stated relative tolerance), CROSSES_ABOVE,
CROSSES_BELOW, BETWEEN; the 0.2 names (above, below, crosses_above,
crosses_below, between) are aliases.

**Hashing and identity.** scanHash(str) is FNV-1a-32, eight hex digits.
scanCanonical(setup) is sorted-key JSON of the evaluation fields only. Every
setup carries an integer `version` (1 when absent) and a `hash` of its
canonical form; the browser bumps the version on every saved change to an
evaluation field. scanKey(setupId, version, instrumentIdOrSymbol, timeframe,
bar, eventType) = `id|vN|inst|tf|bar|event`; a version-1 setup is also
deduplicated against the 0.2 key `id|SYMBOL|daily|bar`, so no bar recorded
before the upgrade is recorded again. scanAlertId(key) = 'a' + scanHash(key).

**Bars and data.** History v2 in data/price-history.json is additive:
{ schema: 2, generated, series, volume, ohlc?: { SYM: { date: [o, h, l] } },
meta?: { SYM: { date: { src, at } } }, corrections?: { SYM: [...] } }.
scanBars(history, symbol, { timeframe, market, now }) returns Bars with the
legacy dates/closes/volumes plus open/high/low (null where not held),
status per bar (FINAL, PROVISIONAL, CORRECTED, UNKNOWN), source, capturedAt,
invalid bars with codes, hasOHLC and a dataVersion. scanValidateBar codes:
BAD_DATE, FUTURE, NEG_PRICE, NEG_VOLUME, HIGH_BELOW, LOW_ABOVE,
NON_SESSION_DAY. scanSessionDateAt(market, instant) and scanBarStatus(market,
sessionDate, capturedAt): a bar captured before its session's close plus the
settle time is PROVISIONAL and never produces a confirmed alert.
scanCalendar(history, instruments, market) infers sessions from what most of
a market's instruments hold — labelled inferred, not an exchange calendar —
and scanReadiness(history, instruments, now) says per market whether the
expected last session is held FINAL. scanResample(bars, '1W') builds weeks
with a completeness flag. scanDataHealth(history, instruments, now) gathers
all of it for the data-health page.

**Indicators.** scanCache() with key `symbol|tf|dataVersion|specKey|calcVersion`
so one computation serves every setup in a run. scanIndicator(spec, bars,
{ at, cache }) returns the spec's IndicatorResult — value, valueText, status
VALID | INSUFFICIENT_DATA | STALE_DATA | INVALID_INPUT, reason code (NEEDS_BARS,
MISSING_SESSION, NO_VOLUME, NO_HIGH_LOW, ZERO_DENOMINATOR, BAD_PARAMS,
UNKNOWN_INDICATOR, STALE, PROVISIONAL_BAR), calculationVersion, dataVersion.

**Rules.** SetupV2 = { id, version, hash, name, description?, enabled,
universe { kind: all | market | symbols | watchlist, market?, symbols?,
instrumentIds?, watchlistId?, name?, asOf? }, timeframe '1D' | '1W',
confirmationMode 'BAR_CLOSE', cooldownMode 'NEW_MATCH' | 'EVERY_MATCH',
cooldownBars, expires, ruleTree }. RuleGroup = { type: 'group', logic: 'ALL' |
'ANY', children }; Condition = { type: 'condition', left, op, right?, range? };
Operand = an indicator spec or { value }. scanNormaliseSetup reads 0.2 setups
(logic AND/OR, rules[]) into SetupV2. scanValidate(doc) returns setups,
problems and problemsBySetup with paths and codes, including UNIT_MISMATCH,
INVALID_LITERAL, TOO_DEEP, TOO_MANY_CONDITIONS and TIMEFRAME_NOT_BUILT, and
refuses ids containing . / ? # %. scanEvaluate(ruleTree, bars, { at, cache })
returns MET | NOT_MET | UNAVAILABLE with each condition's values and reasons.
NEW_MATCH fires only when the tree is MET at the bar and NOT_MET at the bar
before, both evaluated on prefixes (no look-ahead); a previous UNAVAILABLE
records eventType FIRST_OBSERVED. EVERY_MATCH records one MATCH per completed
bar. cooldownBars still applies on top, counted in bars.

**The run.** scanRun(setups, history, { instruments, existing, now, runId,
origin, asOf?, cache }) keeps today's fields and adds runId, readiness,
cacheStats, deduped and alerts in the V2 shape: { id, key, setupId,
setupName, setupVersion, setupHash, setupSnapshot, instrumentId, symbol,
market, timeframe, candleDate, detectedAt, eventType, cooldownMode, close,
matchedConditions [{ path, text, state, left, right, leftLabel, rightLabel,
status, reason }], dataSourceId, dataVersion, runId, origin, engine } — and the
0.2 fields (bar, rules, recordedAt) as aliases for one release. `asOf`
evaluates as though the history ended on that date (replay).
scanHistorical(setup, history, { symbols, from, to, maxBars }) runs the same
evaluator on every prefix and returns matches, events, coverage and missing
sessions, marked simulation. scanStatus({ runs, alertsDoc, setupsDoc,
historyMeta, control, now }) answers the dashboard's four questions.
scanSetupDrift(browserSetups, fileDoc) and scanSnapshotDrift(symbols,
currentSymbols) are pure diffs for the pages.

**The worker** (scanner/scan.mjs). Files, all git-ignored and CI-banned:
data/scan-runs.json { schema: 1, runs, audit } (every exit path appends a run
— COMPLETED, PARTIAL, FAILED, CANCELLED, SKIPPED_NO_DATA, SKIPPED_NO_SETUPS,
SKIPPED_LOCKED, SKIPPED_PAUSED — with counts, readiness, errors with a
category and a correlation id, and duration); data/scan.lock (open 'wx',
takeover of a dead or hour-old lock, recorded); data/scan-control.json
(pause/resume); data/scan-deliveries.json (IN_APP active and a delivery
record per alert; EMAIL, TELEGRAM and PUSH 'NOT_CONFIGURED' with the reason).
Flags: --trigger, --as-of DATE (replay, deduplicated, audited), --retry
RUNID (audited), --pause "why" / --resume, --unlock, --status, --runs [n],
--backtest SETUPID [--from --to --json]. Exit codes 0 completed, 1 failed, 2
partial, 3 skipped. ingest/daily.mjs runs the scanner only when the history
step succeeded, passes --trigger daily, and writes data/ingest-runs.json.

**Ingest.** ingest/history-store.mjs is the one writer of price history —
loadHistory, mergeBars (validated by the engine's scanValidateBar, an explicit
source-rank conflict policy, corrections recorded, rejects to a git-ignored
file), trimHistory (series, volume, ohlc and meta together), saveHistory
(atomic, with .bak). history.mjs, history-import.mjs and live.mjs go through
it. Open, high and low are kept wherever a source has them. Every bar is
dated by its exchange's session in the exchange's time zone.

**The browser.** Store keys, in PORTABLE_KEYS: scanSetups (versioned setups:
current plus prior versions, created and updated dates, deleted marker),
scanAlertState ({ alertId: READ | ARCHIVED }; absent is NEW) and scanPrefs.
The loader also reads data/scan-runs.json, data/scan-control.json,
data/scan-deliveries.json and data/ingest-runs.json, each optional and each
stated when absent.

**Routes.** Canonical: /app/scanner (dashboard), /app/scanner/market,
/app/scanner/setups, /app/scanner/setups/new, /app/scanner/setups/:setup,
/app/scanner/setups/:setup/edit, /app/scanner/watchlists,
/app/scanner/alerts, /app/scanner/alerts/:alert, /app/scanner/backtest,
/app/scanner/settings, /admin/scanner, /admin/scanner/data,
/admin/scanner/jobs, /admin/scanner/delivery. /my/scanner stays as an alias of
the dashboard. Views: scannerDashboard, scannerMarket, scannerSetups,
scannerSetupNew, scannerSetup, scannerSetupEdit, scannerWatchlists,
scannerAlerts, scannerAlert, scannerBacktest, scannerSettings, scannerAdmin,
scannerAdminData, scannerAdminJobs, scannerAdminDelivery. The main navigation
gains Scanner after Research. The admin pages are read-only views of the
local worker's files; there is no administrator role, and each control is
the CLI command the page names.

## 3. Build order

| Round | Owner | What lands |
|---|---|---|
| 1 | engine | src/js/24-market-engine.js — everything in "The contract" above that is engine; the page and worker kept working on it; scanner-test with reference datasets, look-ahead, determinism and unit-matrix checks; 60-trend on the shared indicators |
| 2 | data and worker | history-store and the ingest fixes; the worker's runs, lock, control, replay, retry, deliveries and backtest; daily.mjs |
| 2 | setups and alerts | versioned setups in the browser with export and drift; the builder on the rule tree; setups, watchlist scanner, alerts, alert detail and settings pages; the unread count |
| 2 | dashboard and operations | dashboard, market screening, historical testing and the four admin pages; routes and navigation; register rows; sweep and mobile; docs/phase3-qa.md |

Round 2 starts from round 1's merge. Its three owners write to separate
files except the route table, where each adds its own delimited block.

## 4. The items


### NAV — Phase 3 routes (spec §1): Scanner in the main nav, /app/scanner/* and /admin/scanner/*

**As built (this batch — ops).** Scanner is the third item of the main navigation (NAV in 35-ui.js), after Research, with an unread count drawn from the alerts pages' scanUnreadCount() when that function exists; it left SUBNAV_MY. SCANNER_VIEWS lists all sixteen scanner view ids; SECTION_OF maps each to 'scanner' and UNIVERSE_VIEWS holds them, so no scanner page says "no run" while the data load is in flight. The ops routes sit in a delimited block of ROUTES: /app/scanner, /market, /backtest, the four /admin/scanner pages, and /my/scanner as an alias of the dashboard — which, carrying ?symbol=, opens /app/scanner/setups/new?symbol= synchronously when that view is in the build. canonicalPath gives any parameterised non-company page its own path, so no canonical reads ':alert'. robots.txt disallows /app/scanner and /admin/, and register-check fails a route under either that is not disallowed. register-check rule 1 checks :id against companies only for research views. The company page's link still reads /my/scanner?from=&symbol= and reaches the builder through the alias. Still blocked: an admin role (no accounts) and intraday entries.

**As built (round 3, user).** The collision half of item 1: an alert id that records with different keys share is detected on the page (scanIdCollisions, per loaded record). The address alone lists every record under that id with its key and marks none read; each opens at /app/scanner/alerts/:alert?key=…, names the others, and every link to a colliding record — the history rows included — carries its key; a single record keeps its plain address. Status stays keyed by id, so colliding records share it, and the page says so. The applyRoute guard is the ops owner's. Still blocked: as before.

**As built (round 3, ops).** applyRoute resolves :id as a company only on the views in COMPANY_ROUTE_VIEWS (research and researchReport), so a route of any other view with a parameter called id renders its own view instead of "No company …"; the branch that makes /app/equities/1155 and /company/1155.KL one page is kept. register-check's route rule reads that same set out of 35-ui.js, so the checker and the router cannot disagree. equity-test adds a temporary /qa-guard/:id route and checks that it renders its view while /app/equities/aapl still opens Apple and an unknown company is still not found. The alert-id collision listing is the user batch's. Still blocked: an admin role and intraday entries.

**Priority** P0 · **Status** partial

**What exists.** The scanner is one combined page, VIEWS.scanner at src/js/86-scanner.js:556-683: the boundary card, the data card, the setups list with refusals and 'Evaluate now', the alert history with lastRun, and the builder. There is one route, { path:'/my/scanner', view:'scanner' } at src/js/35-ui.js:361. The top nav is NAV at 35-ui.js:234-240: Discover, Research, My Investments, Property, Learn. A comment at 35-ui.js:225-232 records the decision to keep five destinations. /app/equities is an alias of Research (35-ui.js:346-352), so 'after Equities' means after Research. The scanner is a tab in the My Investments subnav (SUBNAV_MY at 35-ui.js:243-254, drawn by mySubnav at 55-views-public.js:1067), and SECTION_OF maps it to 'my' (35-ui.js:810-816). The company page links to /my/scanner?from=&symbol= (45-views-research.js:756). equity-test.mjs:772 pins '/my/scanner' to the nav item 'My Investments' and :1703 pins the href of the company page's scanner link. vercel.json rewrites every extensionless path to index.html, so /admin/* would reach the app. robots.txt disallows only /my/ and /app/watchlists. sweep.mjs:31 and mobile.mjs:33 and :119 cover only /my/scanner. None of the 16 spec paths resolves today: each falls to 'notfound' at 35-ui.js:638.

**Gap.** (1) Scanner is not in the main nav. (2) None of /app/scanner, /market, /setups, /setups/new, /setups/:x, /setups/:x/edit, /watchlists, /alerts, /alerts/:x, /backtest, /settings or /admin/scanner{,/data,/jobs,/delivery} exists. (3) Two hazards in the router. First, applyRoute treats ANY route param named `id` as a company (35-ui.js:659-687), so /app/scanner/setups/:id would end at 'No company “trend-breakout”'. Second, canonicalPath (35-ui.js:529-530) returns route.path verbatim for a parameterised non-research route, so the canonical link would contain the literal ':alert'. register-check.mjs:131 has the same company assumption about params.id. (4) Dotted ids break a reload: the Vercel rewrite excludes paths with a dot, and scanValidate (86-scanner.js:433) forbids only '|' and whitespace in setup ids. Alert keys contain symbols such as 1155.KL, BRK.B or EURUSD=X. (5) robots.txt does not exclude /app/scanner or /admin. (6) There is no admin role or accounts, so the /admin pages cannot be gated.


**Buildable now.**


1. **Route table and views for all 16 spec paths, with /my/scanner kept as an alias** *(large)* — src/js/35-ui.js ROUTES (after line 361), SECTION_OF (810), UNIVERSE_VIEWS (873), META (~412); the page region of 86-scanner.js split out into new src/js/87-scanner-pages.js and 88-scanner-ops.js, with the engine left in 86

   The route rows, in first-hit order: '/app/scanner'→scannerHome; '/app/scanner/market'→scannerMarket; '/app/scanner/setups'→scannerSetups; '/app/scanner/setups/new'→scannerBuilder (this row must sit ABOVE the :setup row); '/app/scanner/setups/:setup'→scannerSetup; '/app/scanner/setups/:setup/edit'→scannerBuilder; '/app/scanner/watchlists'→scannerWatchlists; '/app/scanner/alerts'→scannerAlerts; '/app/scanner/alerts/:alert'→scannerAlert; '/app/scanner/backtest'→scannerHistory (title 'Historical matches — simulation'); '/app/scanner/settings'→scannerSettings; '/admin/scanner'→scannerOps; '/admin/scanner/data'→scannerOpsData; '/admin/scanner/jobs'→scannerOpsJobs; '/admin/scanner/delivery'→scannerOpsDelivery; '/my/scanner'→scannerHome with alias:true. When ?symbol= is present, the alias replaceStates to /app/scanner/setups/new?symbol=, so old links still open the builder. Params are named :setup and :alert, never :id. applyRoute (659) gains a guard so that only views research and researchReport resolve params.id as a company. canonicalPath gains a branch: a scanner param route canonicalises to the location path. Each view gets a META sentence, and SECTION_OF maps every scanner* view to 'scanner'. Every scanner* view joins UNIVERSE_VIEWS, because scanSymbolLink reads BY_ID. A shared scannerSubnav(active) reads Dashboard · Market · Setups · Watchlists · Alerts · Historical · Settings and reuses the .segmented pattern of mySubnav. Operations is a separate quiet link from the dashboard and from /status, never in the nav. Dot-free addresses: alert pages are addressed by alertId = 'a' + scanHash(key), an 8-hex-digit FNV-1a in the engine region (collisions are detected on the page and both records listed). scanValidate refuses setup ids with '.', '/', '?', '#' or '%', giving the reason 'the id is part of the setup's address'. The builder's slug already emits only [a-z0-9-].

   *Tests:* sweep.mjs gets a phase3 block of every new path plus /my/scanner?symbol=MSFT. It also needs an unknown setup and an unknown alert, which must render a 'not in your record' card, not a notfound and not a near-empty page. equity-test: each scanner path marks 'Scanner' aria-current, /my/scanner?symbol=MSFT lands on the builder with MSFT, and /app/scanner/setups/x.y is refused by validation. register-check rule 1 is fixed to check company ids only for research views.


2. **Scanner in the main nav after Research** *(medium)* — 35-ui.js NAV (234-240) and SUBNAV_MY (249); equity-test.mjs:772 and :1703; 45-views-research.js:756

   NAV becomes Discover, Research, Scanner (/app/scanner), My Investments, Property, Learn. The comment's 'five destinations' is updated to say why a sixth is earned: the spec asks for it, and the scanner is a workflow of its own. The scanner entry comes out of SUBNAV_MY, so one page does not live in two sections. The company page's 'Open scanner' link moves to /app/scanner/setups/new?from=&symbol=. equity-test's wantNav map changes '/my/scanner':'My Investments' to '/app/scanner':'Scanner', and the 1703 regex changes to match the new builder href. On the deployed site the nav item still leads to a working page: the dashboard states that no run log ships, and the builder writes valid JSON. The dashboard also offers 'Open your files' (a file input; FileReader into memory only; nothing is uploaded, and CSP connect-src 'self' is unchanged) so a reader can view their own scan-runs, scan-alerts and price-history on the deployed site without deploying them.

   *Tests:* mobile.mjs overflow at 360–1440 with six nav items, since the topbar already wraps below 1220px. equity-test nav-current map.


3. **Keep the operations and personal scanner paths out of crawlers** *(small)* — robots.txt, sitemap.xml

   Add 'Disallow: /app/scanner' and 'Disallow: /admin/', each with the file's style of comment: personal-lane records, and operations views of one machine. Neither goes in the sitemap.

   *Tests:* deploy-check or register-check asserts that robots.txt disallows every ROUTES path beginning /admin or /app/scanner.


**Blocked.**


- **/admin/* restricted to an admin role** — There are no accounts, identities or server. The static equivalent is a read-only operations view that anyone who opens the address sees, and on the deployed site it has no data. The page says this in its first line.

- **Intraday entries (1 Hour/15M/5M) anywhere in the nav, builder or settings** — Intraday data rights, streaming infrastructure and legal review (spec §17; platform-plan scanner table 'Intraday scanner blocked'). The timeframe select keeps Daily only, and the spec's Weekly and 1 Hour appear as disabled options that name what they wait on, never as working ones.


**Risks.** The first-hit route order matters: /setups/new must precede /setups/:setup. Adding a sixth nav item can bring back topbar overflow at 360–430. equity-test pins the old nav mapping and the old builder href, so both must change in the same commit. The generic params.id-is-a-company behaviour is load-bearing for /app/equities/:id, so the guard must be by view, not by removing the branch.


### SC-301 — Market-data ingestion

**As built (this batch — data, round 2).** ingest/history-store.mjs is the one writer of data/price-history.json (loadHistory, mergeBars, trimHistory, saveHistory, updateHistory under a lock); history.mjs, history-import.mjs and live.mjs go through it. Validation is the engine's scanValidateBar loaded out of index.html; the conflict policy is an explicit source rank (import/provider 2 > screen 1; unknown ranks with the screen) — a lower rank is reported OUTRANKED and written to the git-ignored data/price-history.rejects.json, an equal or higher rank that disagrees is recorded in corrections (read by the engine as CORRECTED), and a PROVISIONAL bar is superseded by any later capture without a correction. Open/high/low are kept from import CSV columns, Yahoo and Twelve Data (null where absent). Every bar is dated by its exchange's session in its own zone: Yahoo by exchangeTimezoneName, imports by parseDateCell (ISO; epochs in the market zone, midnight-UTC epochs as UTC dates; ambiguous day/month refused exactly as the browser's parseCloses — tested against it and under two machine zones), the screen capture by readingSession at the screenshot's time (watchlist.mjs writes captured_at and bar_status; prices.mjs passes capturedAt through). meta {src, at} per bar lets scanBarStatus say FINAL or PROVISIONAL. Keep is 2000 in every writer, trimming volume/ohlc/meta/corrections together. To date readings honestly the engine's SCAN_MARKETS gained rows for the registry's other markets (AU … MX, hours typed by hand and erring late; COM stays on _default). daily.mjs runs the scanner only after a successful history step. Not built: ingest/history-check.mjs --report/--refetch (scanDataHealth lists weekend-dated bars as NON_SESSION_DAY; existing mis-dated bars are never rewritten), a scan.mjs --ready flag (readiness is judged inside scanRun). Blocked as before: an authorised feed, a provider-confirmed finality signal, ingestion for anyone else.

**As built (round 3, worker).** Item 4 is built. `node scanner/scan.mjs --ready` judges each market with scanReadiness before anything is evaluated (scanRun's `ready` option) and does not evaluate the instruments of a market whose expected session is not held final. The run lists each such market in `skippedMarkets` ({ market, reason, state, status SKIPPED_NO_DATA, instruments, setups }), logs a DATA error for it, prints one "not ready  CODE — reason" line per market with the statement that this is judged from capture times and is not a provider's confirmation, leaves those pairs where the ledger had them so the next ready run catches them up, and exits 2 (PARTIAL) — also when no market is ready, because that is a day to look at, not a quiet one. ingest/daily.mjs passes `--trigger daily --ready`, names each market held back in its report and in data/ingest-runs.json (scanner.skippedMarkets), and exits 2; the dashboard reads a run the gate held back entirely as behind, not as a success (SC-312). scanner-test: a history whose MY last bar is PROVISIONAL (captured at 15:00 in Kuala Lumpur) gives SKIPPED_NO_DATA for MY while US runs and records; without --ready both are evaluated; daily.mjs, with the scanner stubbed to print the worker's own line, names MY and exits 2 (the history-failed case was already tested). Not built in this batch: ingest/history-check.mjs (item 3, the data owner's). Still blocked: a provider's finality signal — the gate is a capture-time judgement.

**As built (round 3, data).** The one-off repair exists: ingest/history-check.mjs prints the engine's own history report (scanValidateHistory — the one /admin/scanner/data shows): bars dated on a day their market does not trade, per market; series whose weekday profile is shifted (the day before the market's first session weekday, or after its last, holding at least a quarter of one session weekday's bars and at least five — "part of the series" below three quarters); sessions held under two dates; price breaks and what explains them; refused bars, stale series and missing sessions — and exits 2 when anything needs repair. On the file this plan was written against it lists NZ50 as shifted a day early in whole, ASX200 and the eight currency pairs in part, 477 weekend-dated bars and six USDMYR sessions held twice. --refetch runs ingest/live.mjs --history with the new --symbols (exactly the listed series) and --days reaching back to the first mis-dated bar plus a week; live.mjs also gained --plan (say what would be fetched, fetch nothing), which --refetch --dry uses. No date is moved: the re-fetch writes each bar dated in its exchange's zone through the store (a changed value is a correction), and then only the weekend copies within a day of the span the provider has just dated, which it did not supply, are taken out through the store into the rejects file (NON_SESSION_DAY, SUPERSEDED). Tested offline in history-store-test (the report, --dry through live.mjs --plan, dropSuperseded); the network re-fetch itself is not run in any test. Not built: the --ready gate (the worker owner's, SC-301 4). Blocked as before.

**Priority** P0 · **Status** partial

**What exists.** Four writers put bars into one git-ignored file, data/price-history.json, shaped { generated, series:{SYM:{date:close}}, volume:{SYM:{date:vol}}, symbols } (probe: 105 symbols, 35,617 points, depth 2–504, last bars 2026-08-06/07, so it is 7 weeks old today). (1) Screen capture: ingest/daily.mjs:46-109 runs autoshot → watchlist.mjs (OCR, review CSV with header symbol,date,close,prev,move_pct,verdict,why,ocr_line at :447) → prices.mjs (rejects CHECK rows, non-positive or future closes, :79-92) → history.mjs (appends the close, :36-46). This path carries the close only: no open/high/low and no volume. (2) Import: ingest/history-import.mjs:57-99 reads date/close/volume from any CSV and ignores the other columns (:25). Its KEEP default is 2000 (:39), and it overwrites a conflicting close and reports it (:130). (3) Provider: ingest/live.mjs:183-207 goes through ingest/providers.mjs. yahooProvider.history (:215-235) keeps only close and volume and dates each bar by its UTC calendar day (:226). twelveDataProvider.history (:396-405) also keeps only close and volume. (4) A paste box in the browser (src/js/25-universe.js:55-116) is merged into trackedHistory for charts only; the scanner deliberately does not scan it (86-scanner.js:517-519, 25-universe.js:866-869). The provider contract (providers.mjs:9-21) is history → [{date, close, volume?}]. The licence lanes are enforced: live.mjs:143-151, history-import.mjs:51-55, and the registry's assertLicensedFor at providers.mjs:131-142. daily.mjs:111-129 runs scanner/scan.mjs after the history step.

**Gap.** Spec pipeline: authorised provider → ingestion worker → validation/normalisation → canonical OHLCV store. What is missing today:
(a) No authorised feed exists. Yahoo is personal-lane and outside its terms (providers.mjs:166-183). Twelve Data is wired, but redistribution is only asserted by the operator.
(b) Open/high/low are dropped at every path that has them: TradingView CSV (history-import.mjs:25), Yahoo q.open/high/low (providers.mjs:219-227) and Twelve Data v.open/high/low (:401).
(c) The session date is wrong for any exchange ahead of UTC. providers.mjs:226 takes toISOString().slice(0,10) of the bar timestamp. Probe of the live file: NZ50 has 66 Sunday bars and 1 Friday bar, so every bar is dated one day early. ASX200 has 27 Sundays (the daylight-saving half of the year). USDMYR and EURUSD have 48 Sundays against 24 Fridays. In total 765 weekend-dated points (index/AU 27, index/NZ 66, fx 384, crypto 288 of which only crypto is legitimate).
(d) Screen capture dates every row with the capture machine's UTC day (watchlist.mjs:427 `today`), not the instrument's session. At the default 18:30 MYT run (schedule.ps1 `$At='18:30'`) the US session has not happened yet on that date, so a US close read then is the previous session's close under today's date.
(e) Non-ISO import dates go through `new Date(raw).toISOString()` (history-import.mjs:83). That silently guesses month-first, and on this machine (Asia/Kuala_Lumpur) shifts the date one day early. Probe: '03/04/2026' → 2026-03-03T16:00Z. The browser paste parser refuses ambiguous dates (25-universe.js:73-85), so the two parsers disagree.
(f) Three writers apply three policies. history.mjs KEEP is 500 (:25) against the import's 2000: a scratchpad probe of 600 imported bars plus one daily run left 500 closes and 600 volumes (the trim at :49-54 skips volume), and the new captured bar had no volume. The screen value silently replaces an imported close (:45). live.mjs overwrites silently (:197). None of the three writes atomically, unlike scan.mjs writeAtomic.
(g) No capture time or source is kept per bar. hist.generated is file-level, and personal-prices.json `generated` is overwritten every day.
(h) daily.mjs runs the scanner even when the history step failed (:101-110 bumps 2, then :116 runs scan.mjs on the old file).
(i) Nothing asks whether the session's data is final.


**Buildable now.**


1. **One shared history store that every writer goes through (validate, merge, trim, write atomically), with per-bar provenance** *(medium)* — new ingest/history-store.mjs; refactor ingest/history.mjs, ingest/history-import.mjs, ingest/live.mjs to call it

   export loadHistory(path) → History v2. mergeBars(hist, symbol, rows, { source:'screen'|'import:<file>'|'yahoo'|'twelvedata', capturedAt:ISO, market, E, policy }) where rows are [{date, open?, high?, low?, close, volume?}]. It returns { added, corrected:[{date, field, from, to}], rejected:[{date, code, why}] }. trimHistory(hist, keep=2000) trims series, volume, ohlc and meta together. saveHistory(path, hist) writes .tmp, keeps .bak and renames (lifted from scanner/scan.mjs writeAtomic).

Validation is not reimplemented here. The store loads the engine the way scan.mjs does (loadEngine from index.html) and calls E.scanValidateBar per row, so the page, the worker and the ingest refuse the same bars.

Conflict policy is explicit and recorded. The source rank is import/provider > screen. A lower-rank source never replaces a higher one; the attempt is reported and written as a CORRECTED entry in hist.corrections[SYM] only when rank is equal or higher.

History v2 is additive, so trendContext (60-trend.js:48) and the paste merge keep working:
{ schema:2, generated, series, volume,
  ohlc:{SYM:{date:[o,h,l]}},
  meta:{SYM:{date:{src, at}}},
  corrections:{SYM:[{date, field, from, to, src, at}]} }
Rejected rows go to data/price-history.rejects.json, which is git-ignored.

   *Tests:* ingest-test.mjs (or a new history-store-test.mjs) using scratchpad files:
- 600 imported bars plus one daily capture still hold 600 closes, and volume/ohlc/meta trim with them.
- A screen close does not replace an imported close; the attempt is reported.
- An import that disagrees is recorded in corrections.
- A killed write leaves the .bak.
- A row with high<low is rejected with code HIGH_BELOW and never reaches the file.
- Running the same merge twice changes nothing (idempotent).


2. **Keep open/high/low wherever the source has them** *(small)* — ingest/history-import.mjs parseCsv (:57-99); ingest/providers.mjs yahooProvider.history (:215-235) and twelveDataProvider.history (:396-405); provider contract comment (:9-21)

   Import: add OPEN_KEYS ['open'], HIGH_KEYS ['high'], LOW_KEYS ['low'] and parse them like close.

Providers: the contract becomes history(symbol, from, to) → [{date, open|null, high|null, low|null, close, volume|null, tsUtc}]. Yahoo reads q.open, q.high and q.low with the same Number.isFinite rule it applies to close. Twelve Data reads Number(v.open) and the other two the same way.

The screen path stays close-only and writes no ohlc entry, so Bars.hasOHLC is false and ATR / true 52-week high return INVALID_INPUT (see SC-303), never a close-based stand-in.

   *Tests:* - A TradingView-shaped fixture CSV (time,open,high,low,close,Volume) round-trips o/h/l.
- A close-only CSV writes no ohlc key.
- A provider stub returning open:null keeps the bar with ohlc absent, not zero.


3. **Date every bar by its exchange session, not by the UTC day of a timestamp or of the capture machine** *(medium)* — ingest/providers.mjs:226; ingest/watchlist.mjs:427; ingest/history-import.mjs:79-83; engine helper scanSessionDateAt (SC-302)

   Yahoo: take res.meta.exchangeTimezoneName and compute the date with Intl.DateTimeFormat('en-CA', {timeZone}).format(ts*1000). That is the session day in the exchange's zone, and it fixes NZ50, ASX200 and FX.

Import: parse ISO directly; a 10- or 13-digit epoch goes through the instrument's market tz; day-first and month-first dates follow the page's rule (refuse ambiguous). Lift parseDateCell out of 25-universe.js:73-85 into a pure helper the engine region carries, so the page and the CLI accept the same dates.

Screen capture: watchlist.mjs writes capturedAt (ISO instant) as a new CSV column. prices.mjs/history.mjs compute each row's session date with E.scanSessionDateAt(marketOf(symbol), capturedAt), from data/instruments.json markets. A US close read at 18:30 MYT is then dated to the last US session whose close has passed.

One-off repair: ingest/history-check.mjs --report lists weekend-dated bars per market and any series whose weekday histogram is shifted. It re-fetches with --refetch through live.mjs; it never rewrites dates in place.

   *Tests:* - Epoch for 2026-05-25T22:00Z with NZ tz is dated 2026-05-26 (a Tuesday session).
- A capture at 2026-09-28T10:30Z dates MY:1155 to 2026-09-28 and US:AAPL to 2026-09-25 (Fri).
- '03/04/2026' is refused as ambiguous; '13/04/2026' → 2026-04-13 on any TZ (run the test under TZ=Asia/Kuala_Lumpur and TZ=America/New_York).


4. **Readiness gate in the daily run: the scanner runs only on a history that was updated and is ready for the market** *(small)* — ingest/daily.mjs:97-129

   Skip step 4b when step 4 failed, and report 'scanner skipped — history not updated'.

Otherwise call `node scanner/scan.mjs --ready` (SC-307 owns the worker). It evaluates E.scanReadiness(history, instruments, now) per market: expected last session (inferred calendar, SC-302) against the last FINAL bar held. A market that is not ready is SKIPPED_NO_DATA for that run, named in the report, and the run exits 2.

This is the nearest honest stand-in for 'the provider confirms the session is final'. It is capture-time-versus-session-close plus the reader's own sources, and the report says it is not a provider flag.

   *Tests:* - A daily.mjs dry harness with history.mjs stubbed to fail never invokes scan.mjs.
- A history whose MY last bar is PROVISIONAL yields SKIPPED_NO_DATA for MY and still runs US.


**Blocked.**


- **An authorised end-of-day OHLCV provider with redistribution and derived-use rights (spec: 'validated OHLCV, not values scraped')** — A licensed EOD feed contract, which needs an operating entity. Yahoo is outside its terms (providers.mjs:166-183), and Twelve Data redistribution is unverified. Bursa needs a Bursa information-services licence or a vendor holding it.

- **Provider-confirmed 'session final' signal and correction notices (spec: 'daily scanning begins only after the provider confirms…')** — Same licensed feed. No personal-lane source publishes a finality flag; the static equivalent above is a capture-time rule, not a confirmation.

- **Ingestion for other people, or a server-side ingestion worker/queue** — An operating entity, a licensed feed with redistribution rights, and Malaysian legal classification (docs/platform-plan.md §12.1). The static app has no server; ingestion stays a local Node CLI on the reader's machine.


**Risks.** Fixing session dating changes the dates of existing bars. Re-fetching NZ50, ASX200 and the FX pairs will move 400+ points by a day, and any alert already recorded on a shifted date will not match its new key: keep old alerts as they are and label them engine 0.2.x.

Source-ranking makes the screen capture unable to correct a bad import. That is intended, but it must be visible in the report.

TradingView's CSV epoch convention for daily bars has not been verified against a known date. Pin it with a real export before trusting the epoch path.

Adding capturedAt to the review CSV changes the column contract prices.mjs splits by index (watchlist.mjs:441-447): append it before the free-text columns and update prices.mjs in the same change.


### SC-302 — OHLCV storage and validation

**As built (this batch — engine, round 1).** In src/js/24-market-engine.js: SCAN_MARKETS (US, MY, FX, CRYPTO, _default; zone, close, settle, weekdays), which 26-instruments' MARKETS now reads its time zones from; scanValidateBar with all seven codes; scanBars reading history v2 additively (ohlc, meta, corrections optional — a close-only history reads exactly as before) and listing invalid bars with their codes instead of dropping them; scanSessionDateAt and scanBarStatus (FINAL / PROVISIONAL / UNKNOWN / CORRECTED, by close plus settle in the market's zone, DST-correct); scanCalendar (inferred, labelled so; weekday fallback below five series); gapBefore per bar; staleness against the clock; scanReadiness per market; scanPriceBreaks (detection only); scanDataVersion. Two rulings the contract left open: a bar with no capture time (every bar held today) is UNKNOWN and is evaluated once its session has closed — the alert records barStatus UNKNOWN — rather than never, which would stop every setup until round 2's ingest records capture times; and the weekday-fallback calendar tolerates a gap of up to two weekdays as a possible holiday (an inferred calendar tolerates none). Still to build (round 2): history-store and the ingest writing ohlc/meta/corrections, the data-health page. Adjustment for corporate actions (scanAdjust, UNADJUSTED_BREAK) is not built — breaks are detected and named, closes are not adjusted. Blocked as before: exchange calendars, corporate-action history, a server store.

**As built (this batch — data, round 2).** The ingest half: the store writes history v2 (ohlc, meta {src, at}, corrections) with the engine's validation on every row and refused rows in data/price-history.rejects.json; the engine's scanDataHealth "at the keep limit" now reads SCAN_HISTORY_KEEP (2000, the store's KEEP; the store's test holds them equal). Still not built: scanAdjust / UNADJUSTED_BREAK (breaks detected only).

**As built (round 3, data).** Item 1's history report: scanValidateHistory(history, { instruments, now }) returns rejected, weekendByMarket, shifted [{symbol, sundayShare, …}] (scanWeekdayProfile), duplicatesBySession (scanDuplicateSessions: the same close, and volume where both are held, on consecutive days where one is not a session day or the two came from different sources — an unchanged Bursa close from one source is not listed), breaks, stale and missing, built from scanDataHealth so the page and ingest/history-check.mjs agree. Item 4, contract C6: data/price-adjustments.json { schema: 1, actions: [{ symbol, date, ratio, kind, note?, recordedAt? }] } (git-ignored, in CI's list) is read strictly by scanReadAdjustments (an unreadable entry refused with its reason; two for one symbol and date both refused) and attached by scanAttachAdjustments as history.adjustments and history.adjustmentVersion ('adj:' + FNV-1a of symbol|date|ratio, or 'none'); scanBars applies it through scanAdjust after validation — prices before the date divided by the ratio, volumes multiplied — on read, never rewriting the file. A ratio of 1 records a break as the market's own move. Never twice: an action whose ratio is itself a break is applied only where the series shows a break at its date, and bars imported with the new history-import --adjusted provider (recorded per bar as meta.adjusted; none and unknown too) are not adjusted for actions dated before their export. Each break carries a state (adjusted, acknowledged, remains, created, unexplained) and breakBefore marks the open ones; scanDataVersion gains '+adj:…' for an adjusted series and is unchanged otherwise. The worker attaches the file beside the history in one delimited block of scanner/scan.mjs (an unreadable file fails the run); the page loader attaches it to the scanner's copy of the history (not the trend context's). /admin/scanner/data gains a Dating card (weekend-dated bars per market, shifted series with their weekday counts, sessions held twice, the two history-check commands), a Price breaks and adjustments card (every break with its state, a "record as" toggle drafting the file for download — the page writes nothing — and the recorded actions with what became of each), and its keep column reads SCAN_HISTORY_KEEP. history-import prints each break left in what it wrote. Blocked as before: an authoritative corporate-action feed; dividends are never adjusted for.

**Priority** P0 · **Status** partial

**What exists.** Storage is data/price-history.json (closes and volume only; see SC-301). Validation that exists:
- Positive closes only: history-import.mjs:87, history.mjs:37, prices.mjs:82, and the engine's scanBars at 86-scanner.js:303-307 silently drops non-finite or non-positive values.
- Volume ≥0, blank is not 0: history-import.mjs:91-95.
- Zero-volume columns become absent: providers.mjs:229-233 and 86-scanner.js:169-176.
- Future dates rejected: prices.mjs:83.
- OCR day-move gate: watchlist.mjs:430-438.
- One close per symbol/date, by construction of the {date:close} map.
- Staleness, relative only: scanRun flags a series more than 10 calendar days behind the newest bar in the same file (86-scanner.js:358-364).
- Seam detection for display only: trendContext flags moves >15%, or >5% across a gap of more than 5 days (60-trend.js:103-111), shown at 55-views-public.js:915-919.
- For statements (not prices): a share-count break over 1.5× or under 0.67× withholds per-share growth (15-derivation.js:711-718, NA_SPLIT at 00-core.js:61).

MARKETS (26-instruments.js:41-46) carries tz for US and MY, and session hours only as display strings ('09:30–16:00 local'). Its comment says 'nothing derives bar timing from them, and holiday calendars are not held'. data/instruments.json places 105 registry rows across 30 markets; only US and MY have a MARKETS row.

**Gap.** Mapping each spec §3 rule:

1. Negative prices and volume: rejected at the writers, but each writer does it separately and the engine only filters silently. OHLC is not stored, so there is nothing to check.

2. high<open/close/low and low>open/close/high: impossible to check today (no OHLC).

3. Duplicate bars per instrument, timeframe and session: the map prevents literal duplicates. Two dates for one session are not caught (the UTC shift in SC-301(c) creates exactly that on a series mixed from two sources). Malformed keys pass the engine: a probe of scanBars on {'2026-01-03','2026-1-10','junk'} returns all of them and makes 'junk' the last bar (86-scanner.js:306 has no ISO check; scanValidate checks only `expires`).

4. Missing trading sessions: not identified. A probe of the live file shows MY series miss 5.0–5.8% of weekdays and US 3.6–3.9%, consistent with holidays, but nothing can tell a holiday from a gap. Crossings evaluate across a hole: bars dated 2026-01-05 and 2026-01-20 report crosses_above = true.

5. Source vs ingestion timestamps: not kept (SC-301(g)).

6. Adjustment history for splits and corporate actions: none for prices. The live file shows unexplained breaks the scanner reads straight through: 5099 ×0.277 on 2025-11-24 then ×1.607 on 2025-12-02; STI ×2.14, ×3.94 and ×4.51 on three dates (the series mixes sources); NATGAS ×0.525 (futures roll). Each would fire crossings and RSI extremes.

7. Provisional daily candles: indistinguishable. No capture time, and live.mjs --history during a session writes the in-progress bar as a normal bar (:195-198).

8. Stale prices: staleness is relative to the newest bar in the file, never to the clock or a calendar. A probe with a history ending 2020-01-02 and now=2026-09-28 produced an alert with stale:[]. The real file is 7 weeks old and would scan today without a word.

9. Exchange holidays, half-days, time zones: none held. MARKETS strings are not parseable, and 28 of 30 registry markets have no row.

10. Separate US and MY readiness checks: none.

Decimal strings and adjustedClose are not stored.


**Buildable now.**


1. **Bar validation in the engine region: one function for the page, the worker and the ingest** *(medium)* — engine region (see contract; proposed new file src/js/24-market-engine.js carrying the @scan-engine markers, with 86-scanner.js keeping only the page)

   scanValidateBar({date, open, high, low, close, volume}, {market, now}) → codes[] from:
- BAD_DATE (not /^\d{4}-\d{2}-\d{2}$/ or not a real day)
- FUTURE
- NEG_PRICE (any price ≤0 or non-finite)
- NEG_VOLUME (<0 or non-finite; null allowed)
- HIGH_BELOW (high < max(open, close, low))
- LOW_ABOVE (low > min(open, close, high))
- NON_SESSION_DAY (weekday not in SCAN_MARKETS[market].days — weekend bars for MY/US/AU/NZ; FX Mon–Fri; CRYPTO all 7)

scanBars uses it and marks rather than silently drops: Bars.invalid=[{date, codes}].

scanValidateHistory(history, {instruments, now}) → { rejected, weekendByMarket, shifted:[{symbol, sundayShare}], duplicatesBySession, breaks, stale, missing }. This is the report the SC-313 data-health page and ingest/history-check.mjs print.

   *Tests:* scanner-test.mjs:
- Each code is fired by a minimal bar.
- A valid OHLC bar passes.
- A null volume is not NEG_VOLUME.
- 'junk' and '2026-1-10' keys are BAD_DATE and never become the last bar.
- NZ50-style Sunday bars are NON_SESSION_DAY for market NZ.
- A crypto Sunday bar is fine.


2. **Session timing, provisional vs final, and a staleness rule that knows the clock** *(medium)* — engine region: SCAN_MARKETS, scanSessionDateAt, scanBarStatus, scanExpectedLastSession; 26-instruments.js MARKETS gains a comment and a test tying its tz to SCAN_MARKETS

   SCAN_MARKETS = {
  US: {tz:'America/New_York', open:'09:30', close:'16:00', days:[1,2,3,4,5], settleMin:30},
  MY: {tz:'Asia/Kuala_Lumpur', open:'09:00', close:'17:00', breaks:[['12:30','14:30']], days:[1,2,3,4,5], settleMin:30},
  FX: {tz:'America/New_York', close:'17:00', days:[1,2,3,4,5]},
  CRYPTO: {tz:'UTC', close:'24:00', days:[0,1,2,3,4,5,6]},
  _default: {tz:'UTC', days:[1,2,3,4,5], calendar:'weekday-only'} }
All are pure, using Intl.DateTimeFormat with timeZone, which is available identically in the browser and Node.

- scanSessionDateAt(market, instant) → the last session date whose close+settleMin ≤ instant.
- scanBarStatus(market, sessionDate, capturedAt) → 'FINAL' if capturedAt ≥ that session's close+settle in market tz; 'PROVISIONAL' if earlier; 'UNKNOWN' when capturedAt is absent (every bar held today). UNKNOWN is treated as FINAL only for bars older than the expected last session.
- A bar that was later corrected carries status 'CORRECTED' from meta/corrections.
- scanExpectedLastSession(calendar, market, now) gives the last session that should be final by now.
- STALE_DATA when the last FINAL bar < expected, with tolerance 0 sessions (configurable).
- Half-days are not held; the page says so.

   *Tests:* - 2026-09-28T08:30Z is before the MY close+30m, so MY bar 2026-09-28 is PROVISIONAL; 10:00Z is FINAL.
- A US bar captured 2026-09-28T19:00Z is PROVISIONAL; 20:31Z (EDT) is FINAL.
- Across the DST change, 2026-11-02 uses EST.
- History ending 2020-01-02 at now=2026-09-28 is STALE_DATA and produces no alert (it currently produces one).
- A Monday holiday inferred from the calendar is not stale.


3. **Inferred session calendar per market and missing-session detection** *(medium)* — engine region: scanCalendar, Bars.gapBefore; consumed by indicators (SC-303) and crossings (SC-304)

   scanCalendar(history, instruments, market, {quorum:0.6}) builds the calendar from the reader's own history. A weekday on which at least 60% of that market's series (at least 5 series) hold a bar is a session. A weekday no series holds is an inferred holiday. Anything in between is ambiguous.

Returns { market, sessions:Set, inferredHolidays:[], ambiguous:[], basis:'inferred from your history — not an exchange calendar' }.

For a market with fewer than 5 series, the weekday calendar applies and says so.

scanBars fills gapBefore[i] = count of calendar sessions strictly between dates[i-1] and dates[i]. Missing sessions are listed per symbol.

This is the honest static substitute for 'exchange-specific holidays': it cannot know an upcoming holiday, and it cannot know a half-day.

   *Tests:* - A fixture of 6 MY series with 2026-08-31 absent from all of them makes that day an inferred holiday: no gap, and not stale on 2026-09-01.
- The same day absent from 1 of 6 series is a missing session for that one series.
- Against the live file, US 2026-06-19/07-03 come out inferred holidays and VIX's lone 2026-05-25 bar is reported as ambiguous.


4. **Price adjustment history: detection plus reader-recorded corporate actions applied on read** *(medium)* — engine region: scanPriceBreaks, scanAdjust; new git-ignored data/price-adjustments.json; ingest/history-check.mjs prints suspected breaks; the page shows them on the scanner data card

   scanPriceBreaks(bars) finds close-to-close ratios above 1.5 or below 0.67. These are the same thresholds as the statement rule at 15-derivation.js:717. Results are tagged with the nearest plain split ratio (1:2, 1:3, 1:4, 1:5, 1:10, or the reverse) when within 2%, otherwise 'unexplained'.

data/price-adjustments.json = { SYM:[{exDate, ratio, kind:'split'|'consolidation'|'bonus'|'rights'|'other', note, recordedAt}] }, written by the reader.

scanAdjust(bars, list) back-adjusts open/high/low/close by the cumulative ratio and volume by its inverse for dates < exDate. adjustmentVersion = FNV-1a of the symbol's list.

An indicator window that spans an unexplained break returns INVALID_INPUT reason UNADJUSTED_BREAK. A recorded one is adjusted and passes.

Imports take --adjusted provider|none|unknown, recorded in meta, so an already-adjusted TradingView export is not adjusted twice.

   *Tests:* - A 1:4 split fixture: an RSI window across it is INVALID_INPUT until the adjustment is recorded, then VALID and equal to the RSI of a hand-adjusted series.
- Adjusting twice is refused (the adjustmentVersion is in meta).
- 5099 and STI from the live file are listed as unexplained.


5. **Data version per series (for the cache, alerts and historical tests)** *(small)* — engine region: scanDataVersion

   FNV-1a 32-bit over the canonical lines `${date}|${o}|${h}|${l}|${c}|${v}|${status}` of the bars actually read (after adjustment), prefixed 'fnv1a:' and suffixed with adjustmentVersion.

It is computed at runtime because build.mjs deliberately does not hash git-ignored files (build.mjs:50-53).

   *Tests:* - The same bars in a different key insertion order give the same version.
- One changed close gives a different version.
- The page-loaded and Node-loaded engines return identical strings for the fixture.


**Blocked.**


- **Authoritative exchange calendars (holidays, half-days, early closes) for US and Bursa** — A licensed calendar or feed. 26-instruments.js:37-40 records that a maintained calendar comes with a licensed feed. The inferred calendar is a substitute and must be labelled as one.

- **Authoritative corporate-action (split, bonus, rights, consolidation) history** — A licensed corporate-actions feed. No free lawful source for Bursa. Yahoo's events=split is in the same personal lane as its prices.

- **Server-side canonical OHLCV store (tables, indexes, multi-user reads)** — No server by decision. The nearest static equivalent is the single git-ignored JSON file on the reader's machine: one reader, no concurrent writers beyond the local CLIs, and not a database.


**Risks.** Tri-state bar status adds 'UNKNOWN' for every existing bar. If UNKNOWN bars are treated as non-final, every current setup stops matching; treat UNKNOWN as FINAL when older than the expected last session.

An inferred calendar is only as good as the series count per market. MY has 44 and US 16 (plus NVDA/AVGO, which are not in the registry); every other market falls back to the weekday calendar.

FNV-1a collisions are irrelevant at this scale but should not be presented as a content hash for integrity.


### SC-303 — Technical indicator engine

**As built (this batch — engine, round 1).** The engine region moved to src/js/24-market-engine.js (markers kept; scan.mjs and the tests slice it from index.html as before). SCAN_INDICATORS carries label, params with defaults and bounds, fields, inputs, unit, needs, formula text and calcVersion for price, volume, sma, ema, rsi (Wilder; a flat window is now ZERO_DENOMINATOR, calcVersion 2), macd, volume_avg, bb (population σ; upper/middle/lower/width/%b), atr (Wilder; needs highs and lows), high_n/low_n (need highs and lows), close_high_n/close_low_n (labelled closing highs and lows), change and rvol (reference excludes the current bar). scanIndicatorSeries and scanIndicator return the IndicatorResult with status and reason codes (NEEDS_BARS, MISSING_SESSION, NO_VOLUME, NO_HIGH_LOW, ZERO_DENOMINATOR, BAD_PARAMS, UNKNOWN_INDICATOR, STALE); the value is null whenever the status is not VALID. scanCache keys symbol|tf|dataVersion|specKey|calcVersion. 60-trend's trendContext and volumeContext read the engine — values bit-identical to before (pinned in scanner-test against the old code), a 52-week high from closes now labelled a closing high. scanner-test checks every indicator against hand-worked values and against a naive textbook implementation over a 300-bar synthetic OHLCV series. Not built: the committed TA-Lib/pandas-ta reference file (layer 2 of item 3) — no such library is available to generate it here. Blocked as before.

**As built (round 3, user).** Item 4's page half: the scanner pages keep one scanCache for the session (scanPageCache in 86-scanner.js), used by "Evaluate now", the builder's Test and an alert's re-evaluation, keyed as a run's cache is, so a changed close is a new data version and a miss. It is dropped when the history object is replaced or past 20,000 entries; nothing is stored. Each run's summary says how many series it computed and how many it reused. Not built here: item 3's third-party reference file (not in scope).

**As built (round 3, data).** Item 1: UNADJUSTED_BREAK is a reason code — a window spanning a break no recorded adjustment explains is INVALID_INPUT and computes nothing, the reason naming the move, its dates and the split it resembles. The window is the indicator's needs for windowed indicators and, for the recursive ones, until the break's weight is under 1% (scanBreakSpan: 116 bars for EMA50, 64 for RSI14, 81 for MACD's signal); a crossing is not read across one either. Prices print at their series' own precision (scanSeriesDp/scanFmtFor: the decimals of the closes up to the bar printed, read at seven significant figures so a 32-bit float counts as the price it was, at least two and at most four), and a price is never shortened to 45.1k: a Bursa 0.345 against 0.50 reads "price 0.345 below 0.500". Item 5: every trendContext caller (15-derivation, 25-universe, 45-views-research, 60-trend's Tracked view, 75-property-grade) passes { ohlc } — realSeriesFor returns the symbol's highs and lows — so the 52-week range is the high of the range wherever the history holds one, and a high and low are used only where they bracket the close beside them. Not built: the TA-Lib/pandas-ta reference file, as before. Blocked as before.

**Priority** P0 · **Status** partial

**What exists.** The pure engine region at src/js/86-scanner.js:35-510 is sliced by scanner/scan.mjs:57-86. Every run self-tests (scan.mjs:193-201; fixture 86-scanner.js:480-509).

Indicators (SCAN_INDICATORS :54-63):
- price (close), volume
- sma(n): windowed; any null in the window gives null (:94-104)
- ema(n): SMA-seeded at index n-1, k=2/(n+1) (:105-113)
- rsi(n): Wilder, simple mean of the first n changes then (n-1)/n smoothing (:115-129)
- macd(fast, slow, signal): signal is an EMA of the line from its first value (:131-143)
- volume_avg(n) = SMA of volume

Each has a 'needs' bar count (:54-63); a multiplier scales a side (:53, :151). Periods are read one way everywhere through scanPeriod and scanPeriodOf (:47-52).

scanner-test.mjs:43-70 checks SMA on 1..5, EMA on a linear series, RSI on monotonic, alternating and Wilder-smoothing cases, and the MACD line as EMA12−EMA26.

A SECOND indicator library exists: src/js/60-trend.js:18-111. trendContext computes sma20/50/200, the 50/200 cross, 'hi52'/'lo52' as max/min of the last 252 CLOSES (:82-86, labelled '52-week high' at :25), returns, and realised volatility, independently of the scan engine. There is only one engine-level version string, SCAN_VERSION '0.2.0' (:36).

**Gap.** Spec §4 list against the engine:
- SMA: yes. EMA: yes (init documented only in code). RSI(14) Wilder: yes. MACD(12,26,9): yes. Average Volume: yes.
- Bollinger(20,2): MISSING.
- ATR(14): MISSING. It needs high/low, which are not stored.
- True 52-week high/low (rolling 252 sessions over high/low): MISSING. The trend engine's 'hi52' is the highest close under a 'high' label (60-trend.js:25, :85).
- Price Change(lookback): MISSING in the scan engine; it exists as trend-only ret1m..ret12m.
- Relative Volume: MISSING (only a multiplier on volume_avg, whose reference window includes the current bar).

IndicatorResult { value, status VALID | INSUFFICIENT_DATA | STALE_DATA | INVALID_INPUT, calculationVersion } does not exist. The engine returns a bare series, and scanRule turns a null into met:null plus free text. Mapping the untested texts:
- 'needs N bars; M held' → INSUFFICIENT_DATA
- 'volume is not recorded for k of the last n bars' → INSUFFICIENT_DATA (missing candles)
- 'unknown indicator', 'no volume is carried', 'no value to compare against', 'the range needs two numbers' → INVALID_INPUT
- STALE_DATA never occurs at indicator level.

Undefined or zero-denominator cases:
- A flat window gives RSI 100 (probe: scanRsi of a constant series → 100, from `l === 0 ? 100` at :121). It should be undefined or explicitly defined.
- scanEma treats a null inside its seed window as 0 (probe: scanEma([1,null,3,4],2) → [null,0.5,…]). Unreachable today because closes are filtered, but live the moment EMA is applied to volume or OHLC with gaps.

Missing candles are invisible because arrays are compressed. There is no corporate-action handling, no per-indicator calculationVersion, no reference-dataset tests (only hand cases), and no cache: each rule of each setup recomputes its series (scanIndicatorSeries at :146 is called per rule side).

Decimal arithmetic: not needed for the computation. Every indicator here is an average or ratio of 2–3-decimal prices, and IEEE doubles are bit-identical between V8 in the page and in Node for the same operation order. It IS needed at the edges:
- Display: scanFmt (:184) prints 2 decimals, so Bursa sub-RM1 prices contradict their own verdict. Probes: 'price 0.34 above 0.34' for 0.345 vs 0.34; 'price 0.04 below 0.04' for 0.035 vs 0.04.
- Equality and boundary comparisons: 0.1+0.2 vs 0.3 prints 'price 0.30 above 0.30'.
- A canonical decimal-string form for values persisted in alerts.


**Buildable now.**


1. **IndicatorResult and a status per bar, in the engine** *(medium)* — engine region (src/js/24-market-engine.js proposed; today 86-scanner.js:146-182)

   scanIndicatorSeries(spec, bars, {cache}) → { values:(number|null)[], status:Status[], reason:({code, text}|null)[], needs, label, unit, calcVersion }.

scanIndicator(spec, bars, {at = last, now, cache}) → IndicatorResult { instrumentId, symbol, indicator: scanSpecKey(spec), timeframe, timestamp: bars.dates[at], value:number|null, valueText: scanDec(value) | null, status, reason, needs, have, calculationVersion:`${id}@${calcVersion}`, dataVersion }.

Status rules:
- INSUFFICIENT_DATA: fewer than `needs` bars, or a missing session / unrecorded volume inside the window (via Bars.gapBefore; tolerance 0).
- INVALID_INPUT: unknown indicator; inputs not held (ATR or high_n on close-only history; volume on a no-volume instrument); a window across an unexplained price break; a zero denominator (flat window for RSI or %B) — codes NO_HIGH_LOW, NO_VOLUME, UNADJUSTED_BREAK, ZERO_DENOMINATOR, BAD_PARAMS.
- STALE_DATA: the bar at `at` is the last bar, and it is older than scanExpectedLastSession or not FINAL (SC-302).
- VALID otherwise.

The value is null whenever the status is not VALID; the engine never fabricates one.

scanDec(v) = Number(v.toPrecision(12)).toString(), the canonical decimal string for persistence.

scanFmtFor(v, unit, bars) shows price-unit values at max(2, max decimals seen in that series' closes, capped at 4) and adds a digit whenever two compared operands would otherwise print equal.

   *Tests:* - Every legacy untested text maps to the expected status code.
- Constant closes → RSI INVALID_INPUT ZERO_DENOMINATOR with value null.
- An EMA over a null gives INSUFFICIENT_DATA, not 0.5.
- The 0.345 vs 0.34 rule prints '0.345 above 0.340'.
- 0.1+0.2 vs 0.3 prints '0.30000000000 above 0.3' or, with EQUALS, is equal under tolerance (see SC-304).


2. **The missing indicators, each documented with its formula, initialisation and edge rules** *(large)* — engine region SCAN_INDICATORS (metadata: label, params {def, min, max}, fields, inputs, unit, needs, formula, calcVersion)

   - bb(n=20, k=2): middle = SMA_n(close); σ = POPULATION stdev of the same n closes (Bollinger's definition); upper/lower = middle ± kσ. Fields: upper | middle | lower | width ((u−l)/m) | pctb ((c−l)/(u−l)). Width and pctb give ZERO_DENOMINATOR when σ=0. Needs n. Unit is price, except width and pctb, which are ratio.
- atr(n=14): TR_t = max(h−l, |h−c_{t−1}|, |l−c_{t−1}|) from t=1. ATR_first = mean(TR_1..TR_n) at index n; then ATR_t = (ATR_{t−1}(n−1)+TR_t)/n (Wilder). Needs n+1. Inputs are high, low and close; close-only history gives INVALID_INPUT NO_HIGH_LOW, never a close-to-close proxy. Unit is price_delta.
- high_n / low_n (n=252 sessions, the '52-week' default): max(high) / min(low) over the last n bars, which must be contiguous sessions (gapBefore). Close-only history gives INVALID_INPUT.
- close_high_n / close_low_n: the honest close-based variants, labelled 'highest close in n sessions', so the reader can still have one.
- change(n): (c_t / c_{t−n} − 1)·100. Needs n+1. Unit is percent. The denominator cannot be 0 because closes are >0.
- rvol(n=20): v_t / mean(v_{t−n}..v_{t−1}). The reference EXCLUDES the current bar, so today's volume does not inflate its own reference. Needs n+1. Any null in the window gives INSUFFICIENT_DATA; a mean of 0 gives ZERO_DENOMINATOR. Unit is ratio.
- Existing indicators get calcVersion 1 and written formula strings:
  - EMA: SMA seed at n−1, k=2/(n+1).
  - RSI: Wilder; seed is the mean of the first n changes; avgLoss=0 and avgGain>0 gives 100; both 0 gives ZERO_DENOMINATOR (a calcVersion 2 change from today's 100).
  - MACD: signal is an EMA of the line from its first value, SMA-seeded.

Parameter limits: n from 1 to 520, and fast < slow for MACD. Today a probe accepts fast 30 / slow 10 and n=1e9.

   *Tests:* - Hand fixtures for every edge rule above.
- Independent-reference tests (next item).
- ATR and high_n on the close-only live-shaped fixture are INVALID_INPUT NO_HIGH_LOW.
- rvol excludes the current bar: 20×1000 then 3000 gives exactly 3.0.


3. **Reference-dataset tests from an independent implementation** *(medium)* — scanner-test.mjs (new section) + scanner/fixtures/indicator-reference.json + scanner/fixtures/make-reference.py (optional generator)

   Two layers of independence:

(1) In the test file, a deliberately naive O(n·k) re-implementation of each formula, written from its textbook definition (loops, no shared helpers), compared bar for bar against the engine over a 300-bar deterministic pseudo-random OHLCV series (an LCG seed, committed). Tolerance is 1e-9 relative.

(2) Committed reference values for SMA/EMA/RSI/MACD/BB/ATR generated once by the owner with TA-Lib or pandas-ta from the same committed series. Store the generator script, library name and version in the JSON header, and document where TA-Lib's MACD and RSI seeding differ from the engine's documented seeding (the unstable period) so each expected difference is stated rather than hidden.

No third-party data is committed: the series is synthetic.

   *Tests:* This item is the tests. Also pin that the page-extracted engine and the Node-extracted engine produce identical JSON for the reference run (determinism across hosts).


4. **Indicator cache keyed by symbol + timeframe + data version + spec + calc version** *(small)* — engine region: scanSpecKey, scanCache; scanRun and scanHistorical accept {cache}

   scanSpecKey(spec) is canonical: the id plus params with defaults filled and sorted, plus field, plus multiplier — e.g. 'ema(n=50)', 'macd(fast=12,slow=26,signal=9).hist', 'volume_avg(n=20)*1.5'. The multiplier is applied after the cache, so the key stores the unscaled series.

scanCache() → {get, set, stats:{hits, misses}}. Key: `${symbol}|${timeframe}|${bars.dataVersion}|${specKeyWithoutMultiplier}|${calcVersion}`.

scanRun creates one per run when none is passed, so five setups that all use ema(50) on 1155 compute it once. The page keeps one per session, keyed the same way, so 'Evaluate now' and 'Test' reuse it. The worker reports cacheStats in lastRun.

No persistence: at 105 series × ≤2000 bars recomputation is milliseconds. Say so rather than build a store.

   *Tests:* - Two setups sharing ema(50) over 2 symbols give 2 misses and 2 hits.
- A changed close changes dataVersion and forces a miss.
- Results with and without the cache are identical (JSON equal).


5. **One library: the trend engine reads the scan engine** *(medium)* — src/js/60-trend.js:18-111, rewired to scanIndicator; the engine region moves to src/js/24-market-engine.js so it loads before 26 and 60

   trendContext keeps its output shape (points, values, pending, seams) but computes:
- sma20/50/200 via scanIndicator({indicator:'sma', n})
- hi52/lo52 via high_n/low_n when hasOHLC, otherwise via close_high_n/close_low_n, relabelled 'highest close, 52 weeks' (fixes the mislabel at :25)
- ret* via change(n)
- the cross via crosses on sma50/sma200 series

Moving the markers to a file numbered before 26 lets MARKETS (26-instruments.js:41) take tz from SCAN_MARKETS without a load-order TDZ problem. scan.mjs extraction is unchanged because it searches index.html for the markers.

   *Tests:* - equity-test/model-test snapshots of trendContext for a fixture series are unchanged except the hi52 label.
- A grep-style test asserts 60-trend.js defines no moving-average arithmetic of its own.


**Blocked.**


- **Indicators on provider-adjusted, licensed OHLCV for other users, and a 'validated indicator' claim** — A licensed EOD feed with corporate actions; point-in-time data for any validation claim (the register already states none is claimed, 80-registers.js:147-150).

- **True ATR / 52-week high-low on screen-captured instruments** — The watchlist screen shows last price only (watchlist.mjs header :447). Only an import or provider history carries high/low. These instruments stay INVALID_INPUT until the reader imports an OHLC export.


**Risks.** Changing RSI's flat-window rule, adding STALE_DATA and the missing-session rule will turn some current matches into UNAVAILABLE. Bump SCAN_VERSION to 0.3.0 and per-indicator calcVersions so old alerts are read as produced by the older engine.

A population-σ BB will differ from a platform using sample σ; document it.

Moving the engine region to another file must keep scan.mjs's self-test, which already refuses a region that lost a function.


### SC-304 — Rule evaluation engine

**As built (this batch — engine, round 1).** SetupV2 with rule trees (RuleGroup ALL/ANY, Condition, Operand); scanNormaliseSetup, the only reader of 0.2 setups (a 0.2 setup reads as EVERY_MATCH, since that is what it did; a tree defaults to NEW_MATCH); scanValidate over the tree with problems, problemsBySetup ({path, code, text}), SCAN_LIMITS, unit compatibility (UNIT_MISMATCH, EQUALS_NOT_ALLOWED), literal domains (INVALID_LITERAL), EXTRA_OPERAND, TOO_DEEP, TOO_MANY_CONDITIONS, TIMEFRAME_NOT_BUILT and route-safe ids. SCAN_OPERATORS under the specification's names with the 0.2 names as aliases, every comparison through scanCompare with the stated tolerance. scanEvaluate at any bar with Kleene groups, crossings only between consecutive sessions (MISSING_SESSION), and PROVISIONAL bars never confirming. scanResample builds 1W with a completeness flag. The current /my/scanner page lists V2 setups and its builder offers the eight operators; the rebuilt builder is round 2's.

**As built (round 3, user).** Item 1's missing example: scanner/setups.example.json carries a fifth, rule-tree setup (trend-breakout-tree: version, a nested ANY group, NEW_MATCH, 1D), disabled because it restates the first setup's conditions, and the file's note describes the 0.3 form and `resolve: "export"`. scanner-test keeps the 0.2.0 expectations for the four 0.2 examples and checks the tree example separately: it validates, normalises idempotently, and evaluates on the fixture as recorded and as its 0.2 twin does.

**Priority** P0 · **Status** partial

**What exists.** The rule engine (86-scanner.js):
- SCAN_OPERATORS (:80-86): above, below, crosses_above, crosses_below, between.
- scanRule (:189-238) evaluates the last bar: left side series; right side a literal or another indicator (indicator-to-indicator works, e.g. price crosses_above ema 50). crosses_above is `lp <= rp && lv > rv` and crosses_below `lp >= rp && lv < rv` (:230-231), exactly the spec's previous-vs-current-completed-candle rule. Tests show that remaining above is not a new cross and that touching counts as from below (scanner-test.mjs:78-86). between is inclusive and accepts reversed bounds (:207-213).
- scanSetup (:241-256) combines one flat list with logic AND|OR. AND with any untested rule does not match; OR matches on the testable rules.
- scanValidate (:421-476) is shared by the page and the worker (scan.mjs:98-103). A setup passes whole or is refused whole. It checks: ids, timeframe 'daily' only, logic, universe, indicator names, numeric periods ≥1, multiplier >0, MACD field, a between range of two numbers, and a right side that is an indicator or a numeric value.

Determinism: a probe of two scanRun calls on the fixture gives byte-identical JSON. Ordering is the setup order, then the file's symbol order. Nothing is ranked.

The committed example setups validate (scanner-test.mjs:214). The page's builder, Test and Evaluate-now use the same engine (86-scanner.js page region ~:639, ~:725-839).

**Gap.** Operators: GREATER_THAN_OR_EQUAL, LESS_THAN_OR_EQUAL and EQUALS are missing, and the spec's uppercase names are not used (scanner-test.mjs:101 asserts that 'equals' is untested). EQUALS on floats has no tolerance rule, and strict comparisons have none either: 0.1+0.2 'above' 0.3 is met.

Nested AND/OR groups: absent. rules is a flat list; a group object inside it is refused as 'operator undefined' (probe). There is no maxDepth or maxConditions: a probe accepts 5,000 rules.

Operand type checking: absent. Probe: rsi 'above' volume validates. A literal is unchecked against the operand's domain (RSI 150, negative volume). A between rule that also carries a right indicator validates and silently ignores it. Quoted numbers are accepted as numbers (scanNumeric :47), which spec 'free text no' would allow only if canonicalised at validation.

Tri-state logic is inconsistent: AND with one failed rule plus one untested rule reports untested:true (probe), though its result is decidable (false).

Missing sessions: crossings evaluate across a missing session (probe: a 15-day hole still 'crosses').

No evaluation at an arbitrary bar index, which historical testing needs. No confirmed-only rule for provisional bars. No version on setups, so rules cannot be tied to alerts. The only timeframe is 'daily'; the 'confirmation' field is written but never read (:491, :528).


**Buildable now.**


1. **Rule tree v2 with nested groups, limits, and a normaliser that reads today's setups** *(medium)* — engine region: SCAN_LIMITS, scanNormaliseSetup, scanValidate (rewritten over the tree); scanner/setups.example.json gains one v2 example

   RuleGroup = { type:'group', logic:'ALL'|'ANY', children:(RuleGroup|Condition)[] }.

Condition = { type:'condition', id?, left:Operand, op, right?:Operand, range?:[Operand, Operand] }.

Operand = { indicator, n?, fast?, slow?, signal?, field?, multiplier? } | { value:number }.

SetupV2 = { id, version:int≥1, name, description?, enabled, universe, timeframe:'1D'|'1W', confirmationMode:'BAR_CLOSE', cooldownMode:'NEW_MATCH'|'EVERY_MATCH', cooldownBars, expires, ruleTree }.

scanNormaliseSetup maps v1 as follows:
- rules + logic AND/OR → ruleTree ALL/ANY
- op aliases above→GREATER_THAN, below→LESS_THAN, crosses_above→CROSSES_ABOVE, crosses_below→CROSSES_BELOW, between→BETWEEN
- timeframe daily→1D, weekly→1W
- version defaults to 1

So every existing setup and alert keeps working.

SCAN_LIMITS = { maxDepth:3, maxConditions:20, maxPeriod:520, maxSetups:200 }, overridable through scanValidate(doc, {limits}). Refusal is whole-setup with a path, e.g. 'group 1 › condition 3: …'. scanValidate additionally returns problemsBySetup:{id:[{path, code, text}]} for the builder.

   *Tests:* - Every committed v1 example normalises and evaluates to the same matches as engine 0.2.0 on the fixture.
- Depth 4 is refused; 21 conditions are refused.
- A group with no children is refused.
- The normaliser is idempotent on v2.


2. **The full operator set with a stated float-comparison rule** *(small)* — engine region: SCAN_OPERATORS, SCAN_OP_ALIASES, scanCompare

   All comparisons go through scanCompare(op, l, r, {lp, rp, lo, hi}) with tol = max(1e-12, 1e-9·max(|l|, |r|)). Literals and indicator values then compare as their decimal meaning, not their binary remainder.
- GREATER_THAN: l > r + tol
- LESS_THAN: l < r − tol
- GREATER_THAN_OR_EQUAL: l ≥ r − tol
- LESS_THAN_OR_EQUAL: l ≤ r + tol
- EQUALS: |l − r| ≤ tol. Allowed only against a literal, or between two operands of unit price or volume. It is refused for oscillators and ratios, where exact equality is noise; the builder offers BETWEEN instead.
- BETWEEN: lo − tol ≤ l ≤ hi + tol; reversed bounds accepted. Bounds may be operands, so 'close between BB lower and upper' is expressible.
- CROSSES_ABOVE: lp ≤ rp + tol && l > r + tol
- CROSSES_BELOW: lp ≥ rp − tol && l < r − tol

The previous value is bars[at−1] only if gapBefore[at] = 0; otherwise the condition is UNAVAILABLE with reason MISSING_SESSION.

   *Tests:* - 0.1+0.2 EQUALS 0.3 is met, and GREATER_THAN 0.3 is not.
- A cross after a touch counts; remaining above does not (existing tests re-pointed to the new names).
- A cross across a missing session is UNAVAILABLE.
- scanner-test.mjs:101 changes to assert that an unknown op 'approx' is refused.


3. **Operand type checking** *(small)* — engine region: unit on every SCAN_INDICATORS entry; SCAN_UNIT_COMPAT; scanValidate

   Units:
- price: price, sma, ema, bb upper/middle/lower, high_n/low_n and their close variants
- price_delta: atr, macd line/signal/hist
- volume: volume, volume_avg
- osc_0_100: rsi
- percent: change
- ratio: rvol, bb width/pctb

Indicator against indicator is allowed only for the same unit (EMA20 crossing EMA50: yes; RSI vs volume: refused, code UNIT_MISMATCH).

Literals are checked against the domain: osc_0_100 must be in [0, 100]; volume ≥ 0; ratio > 0; price > 0; percent and price_delta are any finite number.

A literal must be a JSON number after normalisation. Quoted numerals are converted once, and any other string is refused (INVALID_LITERAL). A BETWEEN rule carrying a right operand is refused (EXTRA_OPERAND), not silently ignored.

   *Tests:* Matrix test over every pair of units × every operator: allowed pairs validate, and refused pairs return the named code. RSI 150, volume −1 and 'abc' are refused; '50' becomes 50.


4. **Tri-state (Kleene) evaluation at any bar, confirmed-only, deterministic** *(medium)* — engine region: scanEvaluate; scanSetup and scanRun wrap it and keep their current return fields for the page and worker

   scanEvaluate(ruleTree, bars, {at = last, cache, now, confirmedOnly = true}) → { state:'MET'|'NOT_MET'|'UNAVAILABLE', bar, barStatus, dataVersion, conditions:[{path, op, state, left:IndicatorResult, right:IndicatorResult|{value}, prevLeft, prevRight, text, reason}] }.

Condition state: UNAVAILABLE if any IndicatorResult it reads is not VALID.

Groups:
- ALL = NOT_MET if any child is NOT_MET, else UNAVAILABLE if any child is, else MET.
- ANY = MET if any child is MET, else UNAVAILABLE if any child is, else NOT_MET.

This fixes the probe case (AND with failed + untested → NOT_MET).

confirmedOnly: when bars.status[at] is PROVISIONAL, the evaluation is UNAVAILABLE with reason PROVISIONAL_BAR, and no alert is recorded on it. STALE_DATA propagates the same way.

No look-ahead: every indicator is causal, and a test pins that evaluating at index i over the full bars equals evaluating the last bar of bars.slice(0, i+1).

scanSetup keeps { matched, untested, rules } for the page (matched = state==='MET'; untested = state==='UNAVAILABLE') and adds state and conditions. The order of symbols stays the file's (or canonical-id order, which is neutral and not a ranking).

   *Tests:* - A truth table for ALL/ANY over MET/NOT_MET/UNAVAILABLE, including nested groups.
- The look-ahead equivalence test across all 66 fixture bars.
- A provisional last bar gives UNAVAILABLE and no alert.
- Two runs on identical inputs give JSON-identical output, and the same holds for page-engine vs Node-engine.
- The existing 82 checks still pass through the v1 normaliser.


5. **Weekly timeframe from daily bars** *(small)* — engine region: scanResample

   scanResample(bars, '1W', calendar, now) buckets by ISO week in the market tz:
- o = first open; h = max high; l = min low; c = last close
- v = sum, or null if any day in the week is null
- the date is the week's last session

A week is FINAL only when its last expected session (inferred calendar) is FINAL; otherwise the weekly bar is PROVISIONAL, so confirmedOnly never alerts on a week in progress. gapBefore is computed in weeks.

scanValidate accepts '1W'. '1H', '15M' and '5M' are refused with 'intraday data is not held' (SC-317).

   *Tests:* - A 3-week fixture with a Friday holiday closes that week on Thursday.
- A mid-week `now` makes the current week PROVISIONAL.
- Weekly SMA equals the SMA of hand-resampled closes.


**Blocked.**


- **Server-side validation endpoint (POST setups/:id/validate), rate limits, per-user evaluation** — No server or accounts, by decision. The static equivalent is the same scanValidate running in the page and the worker. It is not an access-control boundary, since the reader edits their own file.

- **Rule evaluation on intraday timeframes (1H/15M/5M)** — Intraday data rights (SC-317).


**Risks.** Tolerance changes a few boundary outcomes versus engine 0.2.0. For example, a close exactly at a computed average is no longer 'above' it by 1e-15. Record the engine version on every alert (already done) and document the rule on the page.

The v1 → v2 normaliser must be the only reader of v1, or the builder and worker will drift again (the class of bug this codebase keeps fixing).

Kleene ALL changes 'untested everywhere' counts in scan.mjs output (fewer untested pairs); adjust scanner-test.mjs:290-292 expectations.


### SC-305 — Setup builder

**As built (this batch — setups and alerts, round 2).** The builder is at /app/scanner/setups/new and /app/scanner/setups/:setup/edit (views scannerSetupNew, scannerSetupEdit; src/js/86-scanner.js) and works on the rule tree through scanNormaliseSetup and scanValidate: one editable group with Match ALL / Match ANY; conditions whose left side is any SCAN_INDICATORS operand (one choice per field, grouped by unit), the eight SCAN_OPERATORS, and a right side (or two range bounds) offered only from the operands of the left side's unit — EQUALS offers no indicator where the unit is not equatable — with a fixed value carrying the unit's literal domain; every parameter with its bounds as min/max and its default as the placeholder (blank is absent); timeframes 1D and 1W, with 1H/15M/5M shown disabled and the engine's reason printed beside them; confirmation stated as bar close; cooldown mode New match / Every match plus cooldown bars; enabled; expiry; universe as a watchlist (snapshotted on save), a market (the registry's markets, "its instruments in your history"), named symbols, or everything with a series, with a live count of what the history holds. Every scanValidate problem is shown at its path (the id, the universe, the timeframe, the cooldown, the expiry, "condition N"), and Save, Copy JSON and Test are disabled until there are none; an operand that cannot be compared (arriving from JSON) is shown as "not comparable" and refused at its condition. A nested tree from the file is shown read-only, with an explicit "Replace with one editable group". Save writes a version (SC-306) and says whether it creates vN+1 or keeps vN; "Test against your history" runs scanRun on the draft, not recorded; "Copy example configuration" copies a disabled schema-2 example with a nested group, labelled an illustration of the syntax and not a suggestion. The fixes kept: nothing rebuilds under the cursor, a structural select rebuilds and returns focus to itself, Add and Remove put focus on the next control, and a blank number is absent. The id is locked on edit. Still blocked: intraday timeframes (SC-317), exchange-wide universes (SC-316), a server validation endpoint.

**As built (round 3, worker).** Item 2's "across a gap" is built in the engine: an alert whose bar follows a missing session (bars.gapBefore above 0 on the calendar in use) carries gapBefore: true and a gapText naming the missing sessions and the calendar — inferred from the reader's history, or weekdays that may have been holidays — and, for a NEW_MATCH, that the change from not met to met was not observed on consecutive sessions. Absent means none missing, never false. scanHistorical's events and recorded rows carry the same two fields. How the alert detail shows it is the setups-and-alerts owner's (86-scanner.js), as is item 4's "Start from an example".

**As built (round 3, user).** Item 4's "Start from an example": SCAN_EXAMPLES, the committed example file held in the engine region after SCAN_LIMITS (contract C7), is offered as a select above the builder that loads an example into the draft as written, labelled an illustration of the syntax and not a suggestion; a changed draft is replaced only when the reader agrees. scanner-test fails when SCAN_EXAMPLES and scanner/setups.example.json differ, and "Copy example configuration" is now the file's rule-tree example, disabled, rather than a hand-written one. The builder also opens from the address (contract C5): ?market=, ?from=<setup> (a copy under a new id, "Copy of …"), ?fromAlert=<alert> (the record's setup snapshot) and ?symbol=, combined; the same address again keeps what was typed, and a different one over a changed draft asks. The company page's ?from=<company>&symbol= opens on the symbol. Still blocked: as before.

**Priority** P0 · **Status** partial

**What exists.** A no-code builder at /my/scanner: scanBuilder() src/js/86-scanner.js:724-868. Fields today: name, id with an auto slug (754-756), logic AND/OR (757), universe symbols/watchlist/market/all (758-779), cooldownBars (780), expires (781), rules with left indicator/period/MACD field, operator, right value or indicator with a multiplier, and a between range (784-821). 'Test against your history (not recorded)' runs scanRun on the draft (837-840). 'Copy setup JSON' writes the clipboard for the reader to paste into data/scan-setups.json (841-844). Validation is shared with the worker: scanValidate 86-scanner.js:421-472, called live in refresh() 856-865. Accessible names are per rule (810). A draft lives in memory only (523-529) and can be seeded from a company page via ?symbol= (731-732) or from a watchlist (55-views-public.js:857-860). Operators are above/below/crosses_above/crosses_below/between (80-86). Timeframe is fixed at 'daily' and anything else is refused (340, 435). `confirmation:'close'` is written (528) but never validated (421-472 has no check). draftSetup() forces enabled:true (829). A committed example exists at scanner/setups.example.json, and scanner-test.mjs:214 checks that it validates.

**Gap.** Spec vs today. (1) Universe choices: My Watchlist exists as a snapshot (see SC-311). 'US Equities' and 'Bursa Malaysia' exist only as universe.kind 'market' over data/instruments.json (268-272), and that honestly means 'the US/MY instruments in YOUR price history', not the exchange. The label must say this. (2) Timeframes: Daily is real. Weekly is not built, but it can be derived honestly from daily closes. 1 Hour cannot be supported: the history is one close per date ({SYM:{date:close}}), so no intraday bar exists. (3) Confirmation mode BAR_CLOSE is not modelled or validated. The engine cannot tell whether the last bar's session had closed (the page says so at 588), so BAR_CLOSE is only as true as the capture schedule until SC-302 supplies a per-bar status. (4) Cooldown modes: the spec's NEW_MATCH/EVERY_MATCH are missing; only cooldownBars exists (382-393). (5) Enable/disable cannot be set from the builder (829 forces true). (6) There is no save or edit: the only output is the clipboard. There is no route for setups/new, setups/:id or setups/:id/edit. (7) There is no 'copy example configuration' inside the builder. (8) The spec's operators GREATER_THAN_OR_EQUAL, LESS_THAN_OR_EQUAL and EQUALS, nested groups, and max depth/condition count are not in the engine. Those belong to SC-304, but the builder must expose them.


**Buildable now.**


1. **Weekly timeframe derived from daily closes** *(medium)* — engine region of src/js/86-scanner.js (new scanWeeklyBars, beside scanBars at 303-308); scanRun 340 and scanValidate 435 accept 'weekly'

   scanWeeklyBars(dailyBars) groups session dates by ISO week (Monday start; the date strings are already session dates, so no tz maths is needed). Weekly close = the last daily close in the week, and the weekly date = that session's date. Weekly volume = the sum of daily volumes only if every day in the week carries volume, otherwise null. This keeps the existing 'a missing volume is not zero' rule (91-93). A week is COMPLETE only when the history holds a bar in a later week, or when its last bar is a Friday (US and MY both trade Mon-Fri). An in-progress week is dropped, never evaluated. When Friday is a holiday, the week is evaluated one bar late, and the page says so. Period counts (needs()) are in weekly bars, so 'SMA20 weekly needs 20 weeks = ~100 sessions' and prose reads 'SMA20 (weekly)'. Key timeframe token 'weekly'. Builder timeframe select: Daily, Weekly (derived from your daily closes), and '1 hour — not available: your history holds one close per day; intraday needs a licensed feed (SC-317)' as a disabled option with the reason visible in text, not only in a title attribute.

   *Tests:* scanner-test.mjs: 66 fixture days → 10 weekly bars (probe confirmed); the weekly close equals the Friday close; a partial last week is excluded; a week with one missing volume has null volume; a weekly SMA equals the SMA of the derived closes; validate accepts weekly and refuses '1h' with the reason.


2. **Cooldown modes NEW_MATCH / EVERY_MATCH alongside cooldownBars** *(medium)* — 86-scanner.js scanRun 375-393, scanValidate 439, builder 780

   setup.cooldownMode ∈ {'NEW_MATCH','EVERY_MATCH'}. NEW_MATCH evaluates scanSetup on the bars cut at last-1 (the same pure function over a prefix, so there is no look-ahead). It fires only if previous.matched===false && previous.untested===false && current.matched===true. If the previous bar was untested, no transition can be established: the run skips it with the reason 'previous bar untested — no false→true transition can be shown'. Probe: the fixture setup reads previous=false and current=true; a price>SMA5 rule over the fixture gives 0000000111111111100…, which is 4 NEW_MATCH events against 22 EVERY_MATCH events. EVERY_MATCH keeps today's behaviour. cooldownBars stays as an optional extra suppression in either mode. Migration: a setup without cooldownMode is read as EVERY_MATCH plus its cooldownBars, which is exactly today's semantics, so existing files do not change meaning. The builder defaults new setups to NEW_MATCH with cooldownBars 0. The 'previous' bar is the previous bar the history holds. Where SC-302 marks a missing session between them, the transition is reported as 'across a gap'.

   *Tests:* NEW_MATCH fires on false→true only; a staying-true bar is not a new match; untested→true does not fire and gives its reason; the EVERY_MATCH count equals the true-bar count; a legacy setup without cooldownMode produces identical alerts to engine 0.2.0 on the fixture.


3. **Confirmation mode field** *(small)* — scanValidate 86-scanner.js:421-472; draft 528

   Accept confirmationMode 'BAR_CLOSE' (and the legacy confirmation:'close' as an alias). Refuse anything else with a reason. Until SC-302 gives each bar a status or capturedAt, the builder states that BAR_CLOSE means 'the last bar your history holds, captured after the close by your schedule'. Once SC-302 lands, scanBars drops bars whose status is PROVISIONAL (see contract).

   *Tests:* 'close' and 'BAR_CLOSE' validate; 'INTRABAR' is refused.


4. **Enable/disable, save, edit, start-from-example in the builder** *(medium)* — 86-scanner.js builder (724-868) plus the new store (SC-306); routes /my/scanner/setups, /my/scanner/setups/new, /my/scanner/setups/:id, /my/scanner/setups/:id/edit in 35-ui.js ROUTES (~361)

   'Save' writes a version into the browser store (SC-306). Edit loads the setup's current version into scanDraft, and the id is locked on edit because ids are keys (853). The enabled toggle lives on the setup list and details page and does not change the version. 'Start from an example' is a select over SCAN_EXAMPLES, a constant in the engine region holding the same content as scanner/setups.example.json. It is labelled 'illustration of the syntax, not a suggestion' so that it stays inside the no-proposal boundary stated at 8-12. The 'copy JSON' button remains for manual use.

   *Tests:* sweep.mjs route list (line 31) gains the four paths; mobile.mjs at 360/390px; the builder round-trips save → edit → save with no change and creates no new version.


5. **Universe labels that match the spec's words honestly** *(small)* — builder 758-779, scanUniverseProse 540-543

   The select reads: 'My watchlist', 'US instruments in your history', 'Bursa Malaysia instruments in your history', 'Named instruments', 'Everything in your history'. The mapping to the spec's universeType is WATCHLIST→watchlist, EXCHANGE→market (universeId = market code), CUSTOM→symbols. 'all' is kept as CUSTOM:'all-held'. The count of instruments resolved against the loaded history is shown live, as for the watchlist today (766-770).


**Blocked.**


- **1 Hour timeframe (and 15M/5M)** — No intraday bars exist in data/price-history.json (one close per date), and no intraday data rights exist. This depends on SC-317 plus a licensed intraday feed and legal classification (platform-plan §12.1 and the Scanner table at docs/platform-plan.md:385).

- **Real 'US Equities' / 'Bursa Malaysia' exchange-wide universes** — A licensed EOD feed with redistribution rights (SC-316, P1). Today the universe is only the reader's own history.

- **Operators GTE/LTE/EQUALS, nested groups, depth/count limits in the UI** — Not externally blocked: they are owned by SC-304 (rule engine). The builder exposes them once SCAN_OPERATORS and the ruleTree schema exist.


**Risks.** The weekly week-completeness heuristic evaluates a holiday-Friday week one bar late; this has to be stated. NEW_MATCH recomputes every series on a prefix, which is O(bars) per extra evaluation and fine at the local scale (105 series × ≤504 bars). Offering examples must not read as proposing setups: the boundary is set at 86-scanner.js:8-12.


### SC-306 — Setup persistence and permissions

**As built (this batch — setups and alerts, round 2).** Store key scanSetups (in PORTABLE_KEYS and on the privacy page): { schema 1, exported: { at, setups: { id: { version, hash, enabled } } }, setups: { id: { id, name, description, enabled, created, updated, deleted, current, versions: [{ version, savedAt, hash, source 'builder' | 'file', setup: the evaluation fields }] } } }. scanSaveSetup validates as the worker does and stores nothing on a refusal; a change to an evaluation field is a new version, a change to name, description or enabled is not; the hash is the engine's scanHash(scanCanonical). Delete is a marker (the versions stay, because alerts name them) with Restore. Export (download and Copy JSON) writes the schema-2 document { kind 'quantum-tradeworks-scan-setups', schema 2, exportedAt, owner 'this browser — no ownerId…', setups: current versions with version, hash, created, updated }, which round-trips through scanValidate with no problem and the same versions and hashes. scanDriftRows states per setup: IN_STEP, NOT_EXPORTED, FILE_NEWER (a version or content this browser has not seen), BROWSER_ONLY, FILE_ONLY, and — when the file cannot be seen, as on the deployed site — NOT_EXPORTED or UNCONFIRMED ("exported on …"), never in step. "Adopt from file" takes the file's copy as a version, keeping the file's version number when it is ahead. The setups page lists every setup with its drift and its matches, and "Evaluate now" runs either copy, saying which. The setup page (/app/scanner/setups/:setup, ?version=N) shows the current version, every version with its hash, and the matches each version recorded (from the alert snapshot where the browser never held it). Not built: the worker-side version ledger (item 3, the data-and-worker batch's file) — so a hand-edited file with no version number still reads as v1. Still blocked: tables, ownerId, server-side ownership, sync across devices.

**As built (round 3, worker).** Item 3 is built. scanner/scan.mjs keeps data/scan-ledger.json (git-ignored, in CI's list): { schema 1, kind, note, versions: [{ setupId, version, hash, firstSeenAt, source 'export' | 'file-edit', setup: the evaluation fields }], pairs }. Before a run evaluates, resolveVersions reads each validated setup against it: a version and hash already recorded is known; a version not yet recorded (the builder's export) is appended as 'export'; a version recorded with different content is refused — "version v of id is already recorded with different content — save it again in the builder, or remove its "version" field and the worker numbers it vN" — so the setup is left out and the run is PARTIAL (exit 2); a setup with no version is numbered by its hash, taking a recorded version back or the next number as 'file-edit'. Entries are appended after the alerts are written and never removed; the worker never rewrites the setups file; a damaged ledger fails the run (IO, naming the .bak) rather than starting again from v1. Alerts carry the resolved version; the run records ledger { known, newVersions, refused }; the file's own setupsHash is unchanged (the page compares it), and the resolved versions join the logical key. scanner-test covers v1 for an unversioned setup, v2 after an edit, a reverted edit taking v1 back, a reused v1 refused with exit 2 while another setup still runs, an export's version appended, the ledger only ever growing by appending, and a damaged ledger. Not built: a page showing the ledger (the operations owner's file). Still blocked: tables, ownerId, server-side ownership, sync across devices.

**Priority** P0 · **Status** partial

**What exists.** Persistence is one hand-maintained file. The reader copies JSON from the builder (841-844) into data/scan-setups.json. The page fetches it (25-universe.js:865) and validates it exactly as the worker does (86-scanner.js:575; scan.mjs:100-104,135). The file is git-ignored (.gitignore:89-93) and CI fails if it is tracked (.github/workflows/checks.yml:137). The in-memory draft is deliberately kept out of storage (86-scanner.js:523-525: 'a second copy in the browser would be the drift'). Ids are stable, unique and part of every alert key (432-434, 853). The setup shape is id, name, enabled, universe, timeframe, confirmation, logic, rules[], cooldownBars, expires (528-529; docs/platform-plan.md:520-543). The app's storage wrapper is store.read/write over localStorage 'vl.*' (00-core.js:239-247). The full backup enumerates every vl.* key (15-derivation.js:249-266), and PORTABLE_KEYS is an explicit list (00-core.js:260+). No owner concept exists: watchlists record 'this browser' as owner (06-watchlists.js:19-21, 153).

**Gap.** There are no versions: an edit silently changes the rule behind old alerts, because alerts carry only setupId (394-396). Nothing records createdAt/updatedAt/description, and there is no ruleTree (flat rules[] + logic). No save or edit exists in the app, and there is no delete. There are no tables and no ownerId, and the spec's permission model (server-side ownership, users cannot read others' setups) has nothing to enforce against because there is one reader per machine. The browser cannot write the file the worker reads, so any browser persistence creates two copies that can disagree.


**Buildable now.**


1. **Versioned setups in browser storage with an explicit export to the worker's file** *(large)* — new section in src/js/86-scanner.js page region (after 510), store key vl.scanSetups; PORTABLE_KEYS in src/js/00-core.js:260+ gains { k:'scanSetups', label:'Scanner setups and their versions' }

   This reverses the decision recorded at 86-scanner.js:523-525, so the comment must be rewritten, and the mitigation is the drift panel below. Store shape: { schema:1, setups:{ [id]:{ id, createdAt, updatedAt, enabled, deletedAt:null, current:<n>, versions:[{ version, savedAt, hash, note?, setup:<frozen evaluation fields> }] } } }. Only a change to evaluation fields creates a new version. Those fields are universe, timeframe, confirmationMode, logic/ruleTree, rules, cooldownMode, cooldownBars and expires. Name, description and enabled are metadata and are not versioned; say so on the page. The hash is scanHash(scanCanonical(setup)): canonical JSON with sorted keys, hashed with FNV-1a 64, placed in the pure engine region so the page and the worker compute the same value synchronously. Export ('Download scan-setups.json') writes { kind:'quantum-tradeworks-scan-setups', schema:2, exportedAt, owner:'this browser — there are no accounts, so no ownerId', setups:[{ ...currentVersion.setup, id, name, description, enabled, version, hash, createdAt, updatedAt }] } with deleted setups omitted. scanValidate accepts schema 1 (today's) and schema 2. Import ('Adopt the file's setups') reads scanSetupsFile into the store. A file version unseen in the browser is added with source:'file'.

   *Tests:* New checks in scanner-test.mjs on the pure helpers: the canonical hash is stable under key order; a rename does not change the hash; a rule change does; a schema 2 file validates. Checks on the page logic (sweep or a new small test like model-test): save twice with no change gives one version; an edit gives version 2 while version 1 is preserved; the export round-trips through scanValidate with zero problems.


2. **Browser-copy vs file drift panel** *(medium)* — VIEWS.scanner 'Your setups' card (86-scanner.js:609-644) and the setups list page

   Per id, compare browser {current version, hash, enabled} with the file's {version, hash, enabled}. States, each named in words: 'in step'; 'saved here, not exported: the worker still runs vN' (browser newer); 'the file holds a version this browser has not seen (edited by hand or in another browser): Adopt'; 'only in this browser'; 'only in the file'; 'enabled here, disabled in the file' (or the reverse). A single 'Export now' button appears whenever anything is out of step. On the deployed site the file 404s by design (25-universe.js:862-866). The panel then says 'the worker's file cannot be seen from here; this browser's copy is the only copy until you export it', and never says 'in step'. 'Evaluate now' and 'Test' say which copy they evaluated (the file, as today, or the browser's current versions).

   *Tests:* A unit test of the pure diff function scanSetupDrift(browserStore, fileDoc) → [{id, state}] for every state above.


3. **Worker-side version ledger so the file is self-sufficient** *(medium)* — scanner/scan.mjs runOnce (127-172); new git-ignored data/scan-ledger.json (added to .gitignore:86-93 and to the CI list at checks.yml:137)

   ledger.versions: [{ setupId, version, hash, firstSeenAt, source:'export'|'file-edit', setup }] is append-only. A setup whose file entry carries version v and hash h that are already recorded is fine. If (id, v) is already recorded with a different hash, the setup is refused: 'version v of id is already recorded with different content — save it again in the builder'. A setup with no version (hand-written, schema 1) is resolved by its hash: a known hash takes the recorded version, and an unknown one gets version max+1 with source:'file-edit'. So 'edits create a new version' holds wherever the edit was made, and an alert's version can always be shown even after the browser is cleared. The worker never rewrites the reader's setups file.

   *Tests:* worker tests in scanner-test.mjs (the cli() pattern at 178-202): an unversioned setup gets v1; editing a rule gives v2; reusing v1 with different content is refused and the run exits 2; ledger entries are never removed.


4. **Honest permissions statement** *(small)* — boundary card 86-scanner.js:581-590; export 'owner' field

   The nearest static equivalent of ownerId/permissions: setups live in this browser's storage (origin-scoped) and in git-ignored files on this machine. CI forbids tracking them (checks.yml:137) and the deploy never ships them. This is not access control. There are no users to separate, and anyone with this machine or browser profile can read them. The page and the export say this in those words, following the watchlists precedent (06-watchlists.js:19-21).


**Blocked.**


- **scanner_setups / rule_groups / conditions / universes / setup_versions tables, ownerId, server-side ownership checks, the /api/v1/scanner/setups endpoints** — No server, database or accounts. These are blocked on an operating entity, hosting and a privacy notice (docs/platform-plan.md §12.1 and the blocked rows at 384-387). The static equivalents above are storage plus files, not multi-user persistence.

- **Setups that sync across the reader's devices** — Needs accounts and a server. Today it is manual: export the file, or use the full backup (15-derivation.js:249-266), which already carries vl.scanSetups once that key exists.


**Risks.** Two copies (browser and file) are the drift the codebase warns about (523-525). The drift panel and the ledger's hash check are what keep that honest. A cleared browser loses unexported versions; the ledger keeps every version the worker has seen, but not versions that were never exported.


### SC-307 — Daily scanner scheduler

**As built (this batch — data, round 2).** scanner/scan.mjs logs every exit path to data/scan-runs.json ({schema 1, runs, audit}; capped 500, written atomically): PENDING at the lock, RUNNING after the self-test, then COMPLETED / PARTIAL / FAILED / CANCELLED (SIGINT/SIGTERM before the record is written) / SKIPPED_NO_DATA / SKIPPED_NO_SETUPS / SKIPPED_LOCKED / SKIPPED_PAUSED, with counts, readiness, stale/provisional counts, history hash and newest bar, logical key, errors [{category, message, correlationId}] and duration; an engine that cannot load is logged too. data/scan.lock (open 'wx'; a dead or hour-old holder is taken over, the takeover audited and its run closed FAILED/ABANDONED); data/scan-control.json with --pause "why" / --resume; --trigger manual|daily; --as-of DATE replay (never skipped, deduplicated, audited); --retry RUNID (the logged run's history cut and clock, audited); --unlock [--force]; --status [--json] (scanStatus); --runs [n] [--json]; --backtest SETUPID [--from --to --symbols --json] on scanHistorical; --data DIR puts every file in one folder and the worker's files default to the alert record's folder. Exit codes 0 completed, 1 failed/cancelled, 2 partial, 3 skipped. A live run on exactly the inputs the last evaluating run read (engine, setups hash, history bytes, recorded keys) is SKIPPED_NO_DATA. daily.mjs passes --trigger daily, maps the codes, and writes data/ingest-runs.json. Not built: the catch-up ledger (item 3) — a missed day is recovered with --as-of, not automatically. Blocked as before: provider-confirmed final data, a worker off the reader's machine.

**As built (round 3, worker).** Item 3's catch-up is built. The ledger's `pairs` holds, per setup version × instrument × timeframe (scanPairKey), the bar that pair was last evaluated on; a scheduled or manual run, and the retry of one, passes it to scanRun, which evaluates every completed bar since that one, oldest first and at most ten (SCAN_CATCH_UP_CAP), each at its own position — the indicators are causal, so bar j is read on the history as it ended at j — and moves the pair forward, never back. A crossing or NEW_MATCH on a day the scheduler missed is recorded once, on its own bar, with the same key, data version and close as that day's run would have written; a pair with no entry (a new setup or version) reads its last bar only; a stale series is not caught up and does not move. The output announces catch-up every time (pairs, bars, and past the cap the bars not read, for --as-of), and the run records catchUp { pairs, bars, capped, cap }. A replay evaluates its date only and moves no pair. Item 4's narrowing is built: `--as-of DATE --setup ID` and `--market CODE` (either or both) narrow a replay; instruments of other markets are counted as left out, not reported missing; a narrowing that names nothing fails as an argument error; the narrowing is on the run (narrow, narrowed) and in the audit entry (setup, market); a retry of a narrowed replay keeps it; neither flag is accepted without --as-of. The run record also carries, per C4, cacheStats (until now only in the alerts file's lastRun), skippedMarkets, catchUp, ledger, universeResolvedFrom, ready and narrow — on every run, null or empty until it evaluates. scanner-test: three bars since the last run with a cross on the middle one recorded once on the right bar and identical to three separate daily runs; a retry of that run adding 0; the ten-bar cap; a new pair reading its last bar only; a replay moving nothing; and the narrowed replay, its refusals and its retry. Still blocked: a scheduler service and job queue off the reader's machine; beyond ten bars, a missed stretch is replayed by date, on purpose.

**Priority** P0 · **Status** partial

**What exists.** The worker is separate from the frontend: scanner/scan.mjs slices the engine from index.html (58-90), self-tests on every run (197-205), validates (135), dedupes and applies cooldown (86-scanner.js:377-393), writes atomically with a .bak (scan.mjs:115-122) and records lastRun (160-162). Exit codes: 0 ok, 1 could not run, 2 ran with warnings (14-17). Scheduling is ingest/daily.mjs, run by Windows Task Scheduler with the exit code as the last-run result (daily.mjs:7-12). It calls the scanner after the history step (daily.mjs:111-129). Idempotence on the same bar is tested (scanner-test.mjs:190-193). Stale series more than 10 days behind are reported (86-scanner.js:359-364). The page shows lastRun (86-scanner.js:653-662). MARKETS carries a tz per market (26-instruments.js:41-44).

**Gap.** Of the spec's 10-step sequence, steps 1-2 are missing: there is no check of which sessions completed or whether final data is available, because the history has no bar status. Steps 3-8 exist for the last bar only, so a missed daily run loses the intermediate bars' matches and crosses for good. Step 9 (queue delivery) is missing. Step 10 is partial: lastRun is overwritten each time, with no durations and no history of runs. No job statuses (PENDING/RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED/SKIPPED_NO_DATA). No lock: two concurrent invocations (Task Scheduler plus a manual run) can both read the alerts file and the last rename wins, which can drop the other run's alerts. No replay, no audit log, no retry command. Indicators are recomputed per rule per setup (scanIndicatorSeries 146-182, called from scanRule 192/213), with no cache per data version.


**Buildable now.**


1. **Runs log with the spec's job statuses** *(medium)* — scanner/scan.mjs main (176-277) and runOnce (127-172); new git-ignored data/scan-runs.json

   ScanRun { id:'run-<iso>-<rand>', logicalKey:`${timeframe}|${sessionDates per market}|${setupsHash}|${historyHash}`, trigger:'daily'|'manual'|'retry'|'replay', status, startedAt, finishedAt, durationMs, engine, dataVersion:<sha256 of price-history.json>, setupsHash, sessions:{US:'YYYY-MM-DD',MY:'…'}, counts:{setups,evaluated,matched,recorded,deduped,untested,skipped}, errors:[{category:'VALIDATION'|'DATA'|'ENGINE'|'IO'|'LOCK', message, setup?, symbol?}], retryOf?, args? }. Transitions: PENDING is written when the lock is taken, and RUNNING after the self-test. The terminal status is one of: COMPLETED (exit 0); PARTIAL (exit 2: problems, setup-level skips, untested everywhere); FAILED (exit 1: self-test, bad alerts JSON, IO); SKIPPED_NO_DATA (no history file, or no series has a bar newer than the last COMPLETED run's evaluated bars, which today is a silent re-evaluation); CANCELLED (SIGINT/SIGTERM caught before the atomic write, so nothing is written). A run found still RUNNING at start with a dead lock is closed as FAILED {category:'ABANDONED'}. The file is capped at the newest 500 runs. lastRun in scan-alerts.json stays for backward compatibility with the page (653-662).

   *Tests:* worker tests: each terminal status reached from a fixture (missing history gives SKIPPED_NO_DATA; the same data twice makes the second run SKIPPED_NO_DATA; a bad setup gives PARTIAL; a corrupt alerts file gives FAILED with alerts untouched, as at scanner-test.mjs:200-202); durationMs ≥ 0; the ordering PENDING→RUNNING→terminal is visible in an intermediate write.


2. **Lock file against concurrent runs** *(small)* — scanner/scan.mjs, around runOnce; data/scan.lock (git-ignored)

   fs.open('data/scan.lock','wx') (O_EXCL) writes {pid, runId, startedAt, host:os.hostname()}. When the lock exists and its pid is alive (process.kill(pid,0)) and it is younger than 30 minutes, exit with the new code 3 'another run holds the lock since …' and log the attempt as CANCELLED {category:'LOCK'}. When the pid is dead or the lock is stale, take it over and close the orphaned run as FAILED/ABANDONED. Release in finally. ingest/daily.mjs:116-128 learns code 3. This protects one data directory on one machine. It is not a distributed lock, and the log says so.

   *Tests:* Spawn two workers on the same temp dir at once: exactly one completes, the other exits 3, and the alerts file holds the union with no loss. A stale lock with a dead pid is taken over.


3. **Catch-up evaluation and idempotent retry** *(medium)* — engine scanRun (321-414) plus a per-pair state in data/scan-ledger.json

   ledger.pairs[`${setupId}|v${version}|${symbol}|${timeframe}`] = { lastEvaluatedBar }. Each run evaluates every completed bar after lastEvaluatedBar, capped at 10 bars, each on the bars cut at that bar (scanSetup over a prefix, so nothing later is read). Missed Task Scheduler days therefore still produce the crosses and NEW_MATCH transitions. A new version's first run evaluates only the last bar; replay is the explicit way back. `node scanner/scan.mjs --retry <runId>` re-runs the logical scan of a FAILED or PARTIAL run with the same session dates. The dedupe keys (SC-308) make any retry add nothing already recorded.

   *Tests:* History advanced 3 bars since the last run, with a cross on the middle bar: the cross is recorded once, on the right bar. A retry of a completed run adds 0 alerts. The results are identical to three separate daily runs.


4. **Replay of a session date with an audit log** *(medium)* — scan.mjs CLI flags --replay YYYY-MM-DD [--setup id] [--market MY]; the audit array in data/scan-runs.json

   Every setup is evaluated on history cut at dates ≤ D per instrument (no look-ahead: the same prefix function). Alerts are written with origin:'replay' and runId, and existing keys are deduped, so a replay of an already-scanned day adds nothing. Replay never generates deliveries other than IN_APP, and IN_APP 'delivery' is only the file write, so nothing is 'resent'. An audit entry is appended: { at, action:'replay', args, runId, operator:os.userInfo().username, added, deduped }. The page reads the audit to show it (SC-313).

   *Tests:* Replay D gives exactly the alerts a live run on history truncated at D gives. Replaying D twice adds 0. The audit gets one entry per replay. Replay at a date before the history's first bar gives SKIPPED_NO_DATA.


5. **Session-completeness gate (the static stand-in for 'final data available')** *(medium)* — engine scanBars (303-308) plus scan.mjs

   Per market, compute from MARKETS tz and session close (26-instruments.js:41-44) whether each instrument's last bar's session had closed by the time the bar was captured. This needs a capturedAt per bar or per series from SC-301/302. Until that exists, fall back to history.generated: a last bar dated 'today' in the market tz whose generated time is before the close is PROVISIONAL and excluded, with the reason. Holidays and half-days are not modelled without an exchange calendar, and this is stated.

   *Tests:* A bar dated the capture day with generated before the close is excluded; a bar captured after the close is evaluated; MY and US are judged in their own time zones.


6. **Indicator cache per data version** *(small)* — engine scanRun / scanIndicatorSeries

   A per-run Map keyed `${symbol}|${timeframe}|${barsCount}|${scanCanonical(side)}` memoises each series across setups and rules. 'Across users' does not apply, because there is one reader. The cache stays inside the pure region.

   *Tests:* Identical outputs with and without the cache (fixture plus a random-setup property check).


**Blocked.**


- **Provider-confirmed final data, exchange holiday and half-day calendars** — No authorised provider (SC-301) and no licensed exchange calendar. Closes are the reader's own captures. The honest static proxy is the capture-time vs session-close check above.

- **A worker that runs without the reader's machine (hosted cron, queue, multiple workers)** — No server or operating entity. The scheduler is Windows Task Scheduler on the reader's PC (ingest/daily.mjs:7-12).


**Risks.** The ABANDONED detection depends on the pid check, and Windows pid reuse is possible; the 30-minute age cap backs it up. Catch-up evaluation changes behaviour for existing setups (more alerts after a missed day), so it must be announced in the run output and the plan.


### SC-308 — Alert event engine

**As built (this batch — engine, round 1).** scanKey is `id|vN|instrument|timeframe|bar|event` (instrument is MARKET:SYMBOL with a registry row, else the symbol); a version-1 daily setup is also deduplicated against the 0.2 key, so the first 0.3.0 run over a 0.2.0 alerts file records nothing again (tested through the CLI). scanAlertId = 'a' + FNV-1a-32. scanRun writes the V2 alert (id, key, setup version/hash/snapshot, instrumentId, market, candleDate, detectedAt, eventType NEW_MATCH / MATCH / FIRST_OBSERVED, cooldownMode, barStatus, matchedConditions with values, dataSourceId, dataVersion up to the bar, runId, origin, engine) with bar, rules and recordedAt kept as aliases; cooldownBars applies on top, per setup version, counted in bars. The worker writes these alerts and names the run in lastRun. Still to build: alert status in the browser and the detail page (round 2). Blocked as before.

**Priority** P0 · **Status** partial

**What exists.** The record is immutable in practice: the worker only appends (scan.mjs:163) and writes atomically (115-122). The dedupe key is scanKey = `${setupId}|${symbol}|${timeframe}|${bar}` (86-scanner.js:310). It is checked against existing keys (329, 377-378) and tested as 'the same bar is not recorded twice' (scanner-test.mjs:121-123). Cooldown is counted in bars and survives removed bars (86-scanner.js:379-393). The alert record is { key, setupId, setupName, symbol, timeframe:'daily', bar, close, recordedAt, rules:[{text,met}], engine } (394-396). Rule results already compute the left and right values (scanRule returns left/right at 208, 237), but they are dropped from the record. Display is at 86-scanner.js:646-678: a table sorted by bar, newest first, capped at 200, with factual 'what held' text and no instructions.

**Gap.** Against ScannerAlert: no id (the key serves as one); no setupVersion; instrumentId is a bare symbol, not the canonical MARKET:SYMBOL (26-instruments.js:67); no event type; no matchedConditions with values (only prose); no dataSourceId or dataVersion; detectedAt is recordedAt (fine); no status NEW/READ/ARCHIVED; userId does not apply. The dedupe key lacks version and event_type. There is no NEW_MATCH semantics (see SC-305). There is no alert detail page (/my/scanner/alerts/:id).


**Buildable now.**


1. **ScannerAlert record v2 and the new dedupe key** *(medium)* — engine scanKey (86-scanner.js:310) and the alert record (394-396)

   Key = `${setupId}|v${version}|${instrumentId||symbol}|${timeframe}|${bar}|${eventType}` with eventType ∈ {'NEW_MATCH','MATCH'}. Legacy keys remain in `seen`: a legacy record is read as {version:null, eventType:'MATCH'} and its legacy key is also computed for the current setup, so a v1-unversioned alert is not re-recorded after the upgrade. Record: { id:'sa-'+scanHash(key), key, setupId, setupName, setupVersion, setupHash, instrumentId: registry row ? `${market}:${symbol}` : null, symbol, market, timeframe, candleDate: bar, detectedAt: now, eventType, cooldownMode, close, matchedConditions:[{ index, text, met, left, right, leftLabel, rightLabel }], dataSourceId: history.sources?.[symbol] ?? 'personal-history' (per-series provenance from SC-301 when it exists), dataVersion: scanHash of the symbol's closes and volumes up to the bar, runId, origin:'daily'|'retry'|'replay', engine }. `rules` is kept as an alias for one release so the page and the ingest summary keep working. userId is omitted, and the file header says owner:'this machine'. Status is NOT stored in the worker's file (see the next item).

   *Tests:* The key includes version and eventType; the same bar under v1 and v2 gives two records; a retry gives none; legacy alerts from engine 0.2.0 still dedupe after the upgrade; matchedConditions values equal scanRule's left/right; dataVersion changes when a past close in the window is corrected; id is stable across runs.


2. **Alert status NEW/READ/ARCHIVED, kept in the browser** *(small)* — page region of 86-scanner.js; store key vl.scanAlertStatus; PORTABLE_KEYS entry in 00-core.js

   The file belongs to the worker and the browser cannot write it, so status is a browser-side overlay: { schema:1, byId:{ [alertId]:{ status:'READ'|'ARCHIVED', at } } }, where absence means NEW. Actions: open an alert → READ; 'Archive'; 'Mark all read'; filter NEW/READ/ARCHIVED/all. Entries whose alert no longer exists in the file are kept but ignored. It is per browser: reading on the laptop does not mark read on the phone, and the page says so.

   *Tests:* The unread count equals file alerts minus status entries; archive hides from the default view but never from 'all'; a restored backup carries statuses.


3. **Alert detail route** *(medium)* — routes in 35-ui.js:~361 (/my/scanner/alerts/:id); view in 86-scanner.js

   Shows setup name, EXCHANGE:SYMBOL (instrumentId, or 'symbol without a market row' when null), timeframe, candle date, detectedAt, setup version with the exact rule prose of that version from the ledger or browser store, the matched conditions table with values, the data source and dataVersion, origin/runId, and the factual boundary sentence. There are no instructions, targets or sizes. A link opens the version, and 'compare with current version' appears if the setup has changed since.

   *Tests:* sweep.mjs visits a fixture alert id; an unknown id renders a not-found card; keyboard and mobile widths are checked.


**Blocked.**


- **userId per alert, server-side 'users cannot read others' alerts'** — No accounts or server (entity plus privacy notice). The static equivalent is git-ignored local files plus origin-scoped storage, and that is not access control.

- **dataSourceId naming an authorised provider** — No licensed EOD feed (SC-301). The honest value is the reader's own capture or import lane.


**Risks.** Changing the key format is the one irreversible part. The legacy-key compatibility check must land in the same commit, or the first run after the upgrade re-records every current match.


### SC-309 — Email notifications (and the in-app notification centre)

**As built (this batch — data, round 2).** The delivery record: data/scan-deliveries.json with channels IN_APP ACTIVE and EMAIL, TELEGRAM, PUSH NOT_CONFIGURED (each with its reason), and one IN_APP SENT row per new alert (none on a rerun or for a replayed alert already recorded), written after the alerts so a failure leaves them recorded and the run PARTIAL with a DELIVERY error. The notification centre and unread count are the setups-and-alerts batch's. Email stays blocked (no server, no contact address held under a privacy notice).

**As built (this batch — the in-app half).** The notification centre is /app/scanner/alerts, and scanUnreadCount() gives the unread count: the alerts with no status in scanAlertState, leaving out setups muted in scanPrefs; null — no badge, never "0 unread" — when no alerts file is visible or in-app is switched off. The scanner's section strip shows "Alerts · n" with an accessible name; the main navigation's badge is the operations batch's (it reads scanUnreadCount guarded). /app/scanner/settings shows In the app as on, with two real preferences (show the count; which setups it counts), and Email, Telegram and Push as not configured with the reason — read from data/scan-deliveries.json where the worker has written it, otherwise this build's reasons — with no switch for any of them. Display preferences (alerts per page, default status filter, rounded or full values) are in scanPrefs. Still blocked: email, Telegram and push delivery (no server, no contact data under a privacy notice); the delivery records are the worker's (data-and-worker batch).

**Priority** P0 · **Status** blocked

**What exists.** Nothing is delivered, by design. This is stated in the engine header (86-scanner.js:26-27), on the page (587), in the worker header (scan.mjs:36-44) and in docs/platform-plan.md:384 ('Notification delivery (email, Telegram, push) | blocked (entity — contact data under PDPA; and a backend)'). The alert record in data/scan-alerts.json is the only channel, and the page lists it (646-678). The nav is NAV/buildNav (35-ui.js:234-240, 817-828) and SUBNAV_MY includes Scanner (35-ui.js:249), rendered by mySubnav (55-views-public.js:1067-1073). Neither carries counts. The existing /my/alerts view (60-trend.js:493+) is a thesis and screen feed and does not include scanner alerts.

**Gap.** No notification centre, no unread count, no NotificationDelivery record, no preferences, no delivery status, no email. The P0 release gate (spec §17: 'email delivery') cannot be met in the static app.


**Buildable now.**


1. **In-app notification centre with an unread count in the nav** *(medium)* — mySubnav (55-views-public.js:1067-1073), buildNav (35-ui.js:817-828), new view /my/scanner/alerts (86-scanner.js)

   unread = alerts in scanAlertsFile with no vl.scanAlertStatus entry. SUBNAV_MY's Scanner link renders 'Scanner · 3' with aria-label 'Scanner, 3 unread matches'. The top-level My Investments link gets a small dot with a visually hidden count. When the file cannot be fetched (the deployed site), no badge is shown and nothing says '0 unread': the centre says the record is not visible from here. The centre lists NEW first by candle date (date order only, never strength, per 86-scanner.js:8-12), with mark-read, archive and 'mark all read'. /my/alerts gets one line linking to it and does not merge the two feeds.

   *Tests:* sweep.mjs checks the badge count with a fixture alerts file; the deployed-mode fetch 404 gives no badge; keyboard access to mark-read and archive; mobile at 360px.


2. **NotificationDelivery records, with the in-app channel real and the others honestly 'not configured'** *(medium)* — scanner/scan.mjs after the atomic alerts write; new git-ignored data/scan-deliveries.json

   { schema:1, channels:{ IN_APP:{ status:'ACTIVE' }, EMAIL:{ status:'NOT_CONFIGURED', why:'no server, and no contact address is held under a privacy notice' }, TELEGRAM:{ status:'NOT_CONFIGURED', why:'…bot token would need a server' }, PUSH:{ status:'NOT_CONFIGURED', why:'needs a push service and the live scanner (P2)' } }, deliveries:[{ id:`${alertId}:IN_APP`, alertId, channel:'IN_APP', status:'SENT', attemptCount:1, sentAt, meaning:'written to data/scan-alerts.json; read status lives in the browser' }] }. There are no per-alert rows for unconfigured channels. The spec's status enum has no 'not configured', and writing FAILED rows would misstate a channel that was never attempted. NOT_CONFIGURED is therefore a named extension at channel level. Deliveries are written after the alerts write, so a delivery-file failure never erases an alert (the spec's rule). A failure is logged in the run's errors[] with category 'DELIVERY'. A replay creates IN_APP rows only for newly added alerts, so there is no resend. A settings page (/my/scanner/settings) shows the four channels and their status with reasons. Its only live preference is in-app on/off per setup (stored in the browser).

   *Tests:* worker tests: one IN_APP SENT row per new alert; none on a rerun; a delivery-file write failure (read-only path) leaves the alerts file correct and the run PARTIAL with a DELIVERY error; channels EMAIL/TELEGRAM/PUSH are NOT_CONFIGURED with reasons.


**Blocked.**


- **Email delivery (queue, adapter, retries, unsubscribe, provider failure logging)** — No server, no operating entity, and no contact address held under a privacy notice (PDPA). The plan records this as blocked (docs/platform-plan.md:384). The spec's P0 Daily Scanner release gate therefore cannot pass in the static app.

- **A LOCAL email from the worker through the reader's own SMTP** — Not blocked by law for self-delivery. It is out of scope for this slice, for four reasons. (1) It needs SMTP credentials stored on disk beside a git repository with no secret store (plain Node has no OS keychain without a dependency), and the spec says no credentials in shipped code. (2) It would look like the product's email channel while working only on the machine owner's PC, which is the 'present unfinished functionality as available' failure the spec forbids. (3) The plan records email as blocked on the entity and backend, and reversing that is the owner's decision, not a builder's. (4) It adds nothing the in-app centre plus Task Scheduler's last-run result (ingest/daily.mjs:7-12) do not already give one reader. If the owner wants it, it is an opt-in local adapter behind the same NotificationDelivery record, and it stays out of the product's claims.


**Risks.** The unread count is per browser, so a reader using two devices sees different counts; say so on the page. A first load of a long history marks everything NEW, so 'mark all read' is required from day one.


### SC-310 — Alert history and detail pages

**As built (this batch — setups and alerts, round 2).** /app/scanner/alerts (scannerAlerts) lists every record in data/scan-alerts.json by candle date, then detection time, then file order — no value column sorts; status NEW / READ / ARCHIVED from store key scanAlertState ({ alertId: 'READ' | 'ARCHIVED' }, absent is NEW; in PORTABLE_KEYS); filters by setup, symbol and status held in the address (?setup=, ?symbol=, ?status=, ?page=); tick rows (or none, meaning every row shown) to mark read, archive or mark new; pages of 25–200 with "Showing x–y of n"; "Download CSV" of the filtered rows in the same order, with their status; three distinct empty states (no file, nothing recorded, filters excluding everything). On a phone each row is a short card. /app/scanner/alerts/:alert (scannerAlert) resolves by id (a 0.2 record without one resolves by the id its key gives, scanAlertId(key)), marks it read, and states: candle date, timeframe, market and its time zone; bar status with its meaning; instrument and canonical id; close; event type with its meaning; detection time, run and origin; the setup, its id, its version linked to /app/scanner/setups/:setup?version=N, its hash and whether the setup has moved on; the snapshot's universe and tree; every matched condition with its path, state, left and right labels and values (full or rounded by preference), status and reason; data source, data version, and the same bars recomputed from the loaded history ("unchanged" or "changed since"); the run from data/scan-runs.json where loaded; and the lineage from the history file to the record. Nothing on it is an instruction. Fields a 0.2 record lacks read "not recorded — this alert predates engine 0.3.0". Still blocked: intraday timestamps, per-bar provenance beyond what the history records, server-side status shared across devices.

**As built (round 3, worker).** Item 1's two missing fields are in the record: barVolume, the volume the history holds for the alert's bar (null — never 0 — where it holds none), and historyGenerated, the history file's `generated` stamp as the run read it (null when the file carries none; file-level provenance, not a capture time). Alerts on a watchlist universe carry universeResolvedFrom, and an alert after a missing session carries gapBefore and gapText (SC-305). scanSelfTest now requires barVolume 2,200 and historyGenerated null on the fixture's alert, so every worker run checks them. Showing them on the detail page is the setups-and-alerts owner's.

**As built (round 3, user).** Item 2: a bar from/to filter (?from=, ?to=, inclusive), applied when the date field is left, not while it is typed; a value that is not a date bounds nothing and is named. equity-test injects a 250-record data/scan-alerts.json through the browser's request interception and checks page 2, each filter's count and the order under permuted closes. Item 3: the detail evaluates the record again — its snapshot, or the version held here for an older record — on the history as loaded, cut at the bar, with the run's market, calendar and clock, and says "Reproduces" or "Does not reproduce" with why. It names the bars whose closes differ from the record: this and every other recorded close on the instrument, and close corrections logged after detection. A sparkline draws the closes up to the bar and no further. "Build a setup from this one" opens the builder on a copy (?fromAlert=). The contract C2 fields are stated where the record carries them and said to be absent where it does not: volume on the bar (barVolume; null reads "none held"; absent offers the history's reading, labelled), the history file's generated time, where a watchlist was resolved from, and a NEW_MATCH across a gap (gapBefore, gapText, also shown on the history row). Until the worker's round 3 lands, records carry none of them. Still blocked: as before.

**Priority** P0 · **Status** partial

**What exists.** The worker appends matches to data/scan-alerts.json with an atomic write and a .bak (scanner/scan.mjs:115-122, 163-168). Each record is { key, setupId, setupName, symbol, timeframe:'daily', bar, close, recordedAt, rules:[{text, met}], engine } (86-scanner.js:394-396). The key is setupId|symbol|daily|bar (86-scanner.js:310). The page shows the newest 200 in one table: Bar, Setup, Instrument (a link through scanSymbolLink at 86-scanner.js:548-554), Close, 'What held' (the rule texts joined), Recorded (86-scanner.js:646-678). scanRule already computes numeric left and right values (86-scanner.js:208, 237), but scanRun discards them when it builds the record (86-scanner.js:396). Only numbers formatted into rule text survive, rounded by scanFmt (86-scanner.js:184). The local record currently holds 0 alerts, and its lastRun is from engine 'scan 0.1.0' against the page's 0.2.0.

**Gap.** There is no /app/scanner/alerts page (no filters, no status, no pagination past 200) and no /app/scanner/alerts/:id. Alerts have no id. The record lacks what the spec's detail needs. The candle is a date only, with no market or time zone. There is no data source: price-history.json carries only a file-level `source` (ingest/history.mjs:56-58), and history-import and live write their own. Numeric indicator values are missing (text only). There is no setup version, because setups carry no version field and edits are invisible. There is no instrument id (EXCHANGE:SYMBOL), and volume on the bar is not stored. There is no NEW/READ/ARCHIVED state. Corrections can also rewrite the evidence: ingest/history.mjs:45 lets 'a correction win' silently, so a recorded close can later disagree with the history, and nothing detects that.


**Buildable now.**


1. **Richer, still-immutable alert record (engine 0.3.0)** *(medium)* — 86-scanner.js scanRun record at 394-396; a new scanSetupVersion and scanHash in the engine region; SCAN_VERSION at line 36

   The key stays unchanged, so dedupe continuity holds. New fields are added: id: 'a'+scanHash(key); setupVersion: scanSetupVersion(setup), i.e. 'v-'+scanHash(canonical JSON of {timeframe, logic, rules, universe minus asOf/name, cooldownBars, expires}); setupSnapshot: {name, logic, rules, universe:{kind, market?, symbols?}}, so the exact rules behind an alert survive later edits; instrumentId: instrumentId(market, symbol) when the registry places it, else null with an 'unplaced' reason; market; volume on the bar; rules[i]: {text, met, op, leftLabel, left, rightLabel, right, range}, with unrounded numbers; data: {file:'data/price-history.json', source: history.source||null, generated: history.generated||null, newestBar}, which is file-level provenance labelled as such; runId, from the runs log. Old records render with 'not recorded — this alert predates engine 0.3.0' for each missing field. Nothing is backfilled. scanSelfTest is extended to assert the new fields on the fixture alert.

   *Tests:* scanner-test: the fixture alert carries id, setupVersion, numeric left and right equal to scanIndicatorSeries at the last bar, and data.generated; setupVersion is stable across key order and whitespace and changes when a rule period changes; a 0.2.0-shaped record still renders (page check).


2. **/app/scanner/alerts — the alert history page** *(medium)* — new 87-scanner-pages.js VIEWS.scannerAlerts

   Filters: setup, symbol, bar from/to, and status. The order is bar descending, then recordedAt: time order, which is a record not a ranking, and there is no sort control on any value column. Pages of 100, with a 'Showing x–y of n' line. Each row links to /app/scanner/alerts/:alertId. The status is a per-viewer convenience held in localStorage under the store key 'scanAlertState' {[key]: 'READ'|'ARCHIVED'}, added to PORTABLE_KEYS in 00-core.js:260 so the export carries it. The page says status is kept in this browser and the record file is never edited. 'Download CSV' exports the filtered rows in the same order. The empty state distinguishes three cases: no file (the deployed site), a file with no alerts (the normal state for tight conditions), and filters that exclude everything.

   *Tests:* A new scanner-pages harness (or equity-test section) intercepts data/scan-alerts.json with a fixture of about 250 alerts through CDP Fetch.requestPaused, as EQ-215 already does for us.json. It asserts page 2 exists, the filters narrow the set, the order is bar-desc regardless of close values (permute closes and check the order is unchanged), and READ survives a reload.


3. **/app/scanner/alerts/:alert — alert detail** *(medium)* — 87-scanner-pages.js VIEWS.scannerAlert

   Resolved by id against every record, or by URL-decoded key as a fallback. The page shows: the setup name, id and setupVersion, plus a notice 'edited since' when scanSetupVersion(current setup) differs from the record; EXCHANGE:SYMBOL from resolveInstrument(symbol) (26-instruments.js:173), with the market's tz and session from MARKETS (26-instruments.js:41-46); 'Daily bar of <sessionDate>'; the capture time, stated as unknown ('the engine cannot tell whether the session had closed when it was captured'); recordedAt; the data source (file-level); every condition with met/failed/untested and its left and right values unrounded; close and volume on the bar; and an inline SVG sparkline of closes UP TO that bar only. The page also re-evaluates the bar now: scanSetup on the history truncated to that bar (the historical engine, SC-314). It reports 'reproduces' or 'the history has changed since this was recorded', and names the bars whose closes differ from the record. The actions are mark read/archive and open company. A 'Build a setup from this one' link loads setupSnapshot into the builder draft. There is no instruction, target or size.

   *Tests:* The harness opens the fixture alert's detail. It asserts the values equal the fixture's EMA50, volume average and RSI to 1e-9; the 'reproduces' line appears; and, with an intercepted history whose close on that bar is altered, 'has changed since' appears. An unknown alert id gives a card naming the record file, not notfound.


**Blocked.**


- **Intraday candle timestamp, PROVISIONAL/FINAL status and per-bar sourceId in the detail** — A licensed EOD feed with a finality signal and per-bar provenance (SC-301/302). The history stores {date: close} with no per-bar source (ingest/history.mjs:43-45).

- **Server-side alert status (NEW/READ/ARCHIVED) shared across devices and a userId on each alert** — No accounts or server. The nearest equivalent is per-browser state in localStorage, which is not ownership and does not follow the reader.


**Risks.** The alert record is the reader's only copy. The new fields must be additive, and the page must render old records. Changing the key to include setupVersion, as the spec's dedupe key does, would make an edited setup re-alert on bars already recorded. That decision belongs to SC-308, and it is flagged here.


### SC-311 — Watchlist integration

**As built (this batch — setups and alerts, round 2).** /app/scanner/watchlists (scannerWatchlists) lists each watchlist with its members, their instrument ids and symbols and whether the history holds a series for each; the setups whose universe is that list (saved here, or only in the file); for each, scanSnapshotDrift between its snapshot and the list now ("2 added (…), 1 removed (…) since the snapshot of …"), and its latest matches in date order; setups whose list is no longer in this browser are listed with their snapshot. "New setup on this list" opens the builder on it, as the watchlists page's "Use as scanner universe" now does (/app/scanner/setups/new). The builder snapshots the list on save, so a changed list saved again is a new version; the setups list and the setup page show the same drift. Not built: resolve:'export' through data/watchlists.json (the worker's file, data-and-worker batch). Still blocked: live resolution by the worker, price-only instruments in a watchlist.

**As built (round 3, worker).** Item 1's engine and worker side is built. A watchlist universe is { kind 'watchlist', watchlistId, resolve 'snapshot' | 'export', symbols (the snapshot), asOf }, resolve absent meaning snapshot. scanResolveUniverse reads an export-resolved list from the watchlist export handed to scanRun (`watchlists`, in watchlistsExport()'s shape): its members with a symbol are scanned, one without a symbol is named, and a member removed since the snapshot is not scanned. With no export, or an export that does not hold the list, it falls back to the snapshot with the sentence "watchlist wl-… is not in data/watchlists.json — evaluated its snapshot of <asOf>", which the worker makes PARTIAL (exit 2). Every alert on a watchlist universe, and the run per setup, records universeResolvedFrom { source 'snapshot', asOf } or { source 'export', exportedAt }. The worker reads watchlists.json beside the setups file (data/watchlists.json; --watchlists overrides; git-ignored and in CI's list), and its hash joins the logical key. scanValidate refuses an unknown resolve, an export resolution without a watchlistId, and one without a snapshot to fall back on; resolving from the export, and which list, are in the setup's hash, and an explicit 'snapshot' is not, so no existing hash moves. Not built in this batch: the watchlists page's "Export for the scanner" and the builder's resolve choice (the setups-and-alerts owner's, round 3). Still blocked: resolution live to the browser — "live" here means as of the reader's last export.

**As built (round 3, user).** Item 1's page side (contract C3). The builder offers a watchlist universe resolved from "the list as you save it" (the snapshot; `resolve` absent) or "your latest export for the scanner" (`resolve: 'export'`), worded as resolved from your latest export — the worker cannot read this browser. The snapshot is always taken, since the worker falls back to it. "Export for the scanner", on the watchlists page, the watchlist scanner page and in the builder, downloads watchlists.json in watchlistsExport()'s own shape and records when and with which symbols, so each page can say whether a list has changed since. Switching the resolve choice saves a new version: the page compares it beside the engine's hash, which does not yet cover `resolve`. Not built here: the worker reading data/watchlists.json and recording universeResolvedFrom (the worker's side of C3); the alert detail states universeResolvedFrom once records carry it. Still blocked: resolution by the worker without an export.

**Priority** P0 · **Status** partial

**What exists.** Watchlist service (Batch B): wlCreate/wlRename/wlDelete/wlAdd/wlRemove (06-watchlists.js:63-124). The WatchlistItem shape carries canonical instrumentId, symbol and market (127-136). watchlistSymbols(wlId) returns {name, symbols, unresolved, asOf} (141-147). The export includes owner:'this browser' (151-155). The scanner's 'watchlist' universe is a SNAPSHOT: the builder expands the list into symbols when the JSON is written (86-scanner.js:828-834), shows the snapshot with unresolved members and members with no series (764-771), and the engine evaluates the snapshot (262-266). A watchlist universe with no snapshot is refused (443-445), and both are tested (scanner-test.mjs:207-211). The watchlists page has 'Use as scanner universe' (55-views-public.js:857-860).

**Gap.** The spec's watchlist scanner implies live resolution: the list as it is at scan time. Today, once the list changes, the snapshot is stale until the reader copies the JSON again, and nothing detects or states that staleness. Watchlists hold companies only (wlAdd refuses price-only instruments, 06-watchlists.js:104-107), so an FX pair or index cannot be in a watchlist universe. There is no /my/scanner/watchlists page (the spec's Watchlist Scanner: each list with its setups and latest matches). Large lists are capped by LIMITS.watchlistStocks (110).


**Buildable now.**


1. **Live-by-export resolution alongside the snapshot** *(medium)* — engine scanUniverse (86-scanner.js:259-274) and scanValidate (443-445); scan.mjs reads the new git-ignored data/watchlists.json; the watchlists page gets 'Export for the scanner'

   universe { kind:'watchlist', watchlistId, resolve:'snapshot'|'export', symbols(snapshot), asOf }. With resolve:'export', the worker reads data/watchlists.json (the existing watchlistsExport() shape, 06-watchlists.js:151-155, whose items carry symbol and instrumentId). Membership is resolved at run time from that file. If the id is missing there, the run falls back to the snapshot with a PARTIAL warning 'watchlist wl-… not in data/watchlists.json — evaluated its snapshot of <asOf>'. The run and each alert record universeResolvedFrom:{ source:'snapshot'|'export', asOf|exportedAt }. This is 'live' only up to the last export, and the builder and centre say so. The honest equivalent of live resolution is 'resolved from your latest export', because the worker cannot read the browser.

   *Tests:* engine: resolve:'export' uses the export's members; a missing export falls back to the snapshot and reports it; a member removed from the export after the snapshot is not scanned; alerts carry universeResolvedFrom.


2. **Snapshot staleness detection** *(small)* — setups list and drift panel (SC-306); builder 764-771

   Compare the setup's snapshot symbols with watchlistSymbols(watchlistId) now: added members, removed members, and whether the list was deleted. The panel says, for example, '2 added, 1 removed since the snapshot of 2026-09-20 — save again or switch to export resolution'. When the setups live in the browser store, saving a new snapshot is a new version, because the universe is an evaluation field.

   *Tests:* A pure diff function test: added, removed and deleted-list cases.


3. **Watchlist Scanner page** *(medium)* — /my/scanner/watchlists (routes 35-ui.js ~361; view in 86-scanner.js)

   Per watchlist: members with an instrumentId and whether the history holds a series, the setups whose universe is this list (by id, snapshot or export) and each one's resolution freshness, and the latest alerts for those setups in date order (never ranked). Empty states say what fills them.

   *Tests:* sweep route; an empty list and a list with an unresolved member both render with reasons.


**Blocked.**


- **True live watchlist resolution by the worker, and per-user watchlists at scale** — The worker cannot read browser storage and there is no server or account store. Live resolution needs a backend that holds watchlists (entity plus privacy notice).

- **Price-only instruments (FX, indices) in a watchlist universe** — Not external: the watchlist service is company-only by design (06-watchlists.js:101-107). A 'symbols' universe covers them today.


**Risks.** Two watchlist truths (browser vs data/watchlists.json) repeat the setups drift problem. Keep one exported file and show its exportedAt everywhere it is used.


### SC-312 — Scanner dashboard

**As built (this batch — ops).** /app/scanner (src/js/87-scanner-ops.js, VIEWS.scannerDashboard) answers the four questions from scanStatus over data/scan-runs.json, data/scan-alerts.json, data/scan-setups.json, the history's newest bar and data/scan-control.json — never from a scan the page ran. A band states the state with a labelled chip (Current, Behind, Failed, Paused, No run recorded) and every dated reason; the four tiles follow in the brief's order; the last scan's matches are headed "Matched on the last scan" only when the state is current and "Matches as of <date> — not current" otherwise; earlier matches, monitored instruments and the commands that run the worker follow. With no run log it says the log never leaves the machine and offers "Open your files" (FileReader into memory; nothing uploaded). 25-universe.js loads scan-runs, scan-control, scan-deliveries and ingest-runs (optional, absent stated). equity-test pins the five states from injected records. Still blocked: cross-user metrics and delivery-measured notifications.

**As built (this batch — engine part only).** scanStatus({ runs, alertsDoc, setupsDoc, historyMeta, control, now, instruments, alertState }) answers the four questions with state never / paused / failed / behind / current and a dated sentence per reason; it reads the alerts file's lastRun as a success until the run log exists. scanSetupsHash names a setups file as the worker would run it, and the worker now records it in lastRun. Tested on the exact local case (run 27 September on bars of 7 August → behind, 52 days). Still to build (round 2): the runs log in the worker and the dashboard page.

**As built (round 3, worker).** scanStatus no longer reads a run that evaluated no bar — every market held back by the ready gate, or every pair expired — as the last success: with that as the latest attempt the dashboard is behind, and says which markets were not ready and, with no success before it, how old the history is. It had shown "the last scan succeeded today, on bars of no bar". A record without counts is read as before. The dashboard's own wording of the tiles is the operations owner's.

**Priority** P0 · **Status** partial

**What exists.** scan.mjs writes a single lastRun into data/scan-alerts.json on each successful run: { at, asOf, asOfFrom, engine, setups, evaluated, matched, recorded, untested, skipped, problems, untestedEverywhere, stale } (scanner/scan.mjs:160-163). Each run overwrites it. The page prints it as one sentence plus problems (86-scanner.js:653-662). ingest/daily.mjs runs the worker after the history step and writes a text report, data/daily-report.txt, that each run overwrites (ingest/daily.mjs:116-129, 158-164). Setups are validated on the page with the worker's own scanValidate (86-scanner.js:575). The local state shows the problem. lastRun.at is 2026-09-27T01:07Z on bars 2026-08-07, and price-history.json was generated 2026-08-07, so the scan is 51 days behind its data's capture date and the page prints it without comment. lastRun.engine is 'scan 0.1.0' while the page runs 0.2.0.

**Gap.** There is no dashboard page, and no record of runs over time, only the last success. A run that FAILS writes nothing: exit 1 on engine missing, self-test failed, no setups or no history (scan.mjs:188-226). So the page keeps showing the previous success as if it were current, which the spec forbids. The record has no duration, status, exit code, trigger, history.generated or setups hash, so the page cannot tell 'setups changed since the last run'. Nothing states staleness relative to now or to the history's newest bar, and nothing flags engine drift. There are no 'monitored instruments' or 'active setups' metrics beyond the counts in lastRun.


**Buildable now.**


1. **Runs log written on every attempt, success or failure** *(medium)* — scanner/scan.mjs main() (176-277) and runOnce (127-172); .gitignore (line 89 block); scanner-test.mjs:350 tracked check

   New file data/scan-runs.json, git-ignored, written with writeAtomic and capped at the last 1000: { schema:1, runs:[ScanRun] }. ScanRun = { id:'run-<ISO compact>-<pid>', kind:'scan'|'control', trigger:'cli'|'daily'|'replay'|'check', status:'COMPLETED'|'PARTIAL'|'FAILED'|'SKIPPED_NO_DATA'|'SKIPPED_NO_SETUPS'|'SKIPPED_LOCKED'|'SKIPPED_PAUSED', exitCode, startedAt, finishedAt, durationMs, engine, selfTest:{ok, alerts, again}, history:{path, generated, source, symbols, newestBar}|null, setupsHash, asOf, asOfFrom, setups, evaluated, matched, recorded, untested, skippedByReason:{alreadyRecorded, cooldown, expired, noSeries, unplaced, tooShort}, problems, untestedEverywhere, stale, error:{code, message}|null, replayAsOf? }. main() wraps everything after argument parsing in try/finally so that every exit appends a record: exit 1 → FAILED (or SKIPPED_NO_DATA / SKIPPED_NO_SETUPS by err.code), exit 2 → PARTIAL, exit 0 → COMPLETED. daily.mjs passes `--trigger daily`. A failed append goes to stderr and never masks the run's own exit code. lastRun in scan-alerts.json stays as it is, for compatibility.

   *Tests:* scanner-test: a missing history appends a SKIPPED_NO_DATA run; a corrupt alerts file appends FAILED with code BAD_ALERTS and leaves the alerts file byte-identical; a warn run appends PARTIAL with exit 2; two runs append two records with increasing startedAt; the cap trims the oldest; the runs file is never tracked by git.


2. **scanStatus — one pure function answering the four questions** *(medium)* — 86-scanner.js engine region (pure, so the worker can print it with `node scanner/scan.mjs --status` and scanner-test can pin it)

   scanStatus({ runs, alertsDoc, setupsDoc, historyMeta:{generated, newestBar}, now, engine:`scan ${SCAN_VERSION}` }) → { state:'current'|'behind'|'failed'|'paused'|'never', reasons:[string], active:{valid, enabled, disabled, expired, refused}, monitored:{instruments, withSeries, missing, unplaced}, lastSuccess:ScanRun|null, lastAttempt:ScanRun|null, latestMatches:[alert] (bar === lastSuccess.asOf, in setup-then-symbol order), recent:[alert] (last 5 bars), notifications:{channel:'none', inApp:{unread}} }. The rules: 'failed' if the latest attempt is FAILED; 'behind' if lastSuccess.asOf < historyMeta.newestBar (the history moved since the scan), or lastSuccess.setupsHash ≠ the current setups hash, or lastSuccess.engine ≠ engine, or the newest bar is more than 4 calendar days before now (one weekend plus a day; no exchange calendar is held, and the reason says so); 'paused' when data/scan-control.json says so; 'never' when there are no runs. Every reason is a sentence naming the dates, e.g. 'the last scan ran 2026-09-27 on bars of 2026-08-07; your history's newest bar is 52 days old'.

   *Tests:* scanner-test gets about 10 fixtures, one per state and reason, including the exact local case (run 2026-09-27, bars 2026-08-07 → behind, with the day count), an engine drift, a setups edit after the run, a failure after a success (→ failed, not current), and latestMatches in setup order not close order.


3. **/app/scanner — the dashboard** *(medium)* — 87-scanner-pages.js VIEWS.scannerHome; 25-universe.js:860-870 also fetches data/scan-runs.json into scanRunsFile

   A status band at the top: a chip (Current / Behind / Failed / Paused / No run recorded) with a label and icon (never colour alone), then the reasons. Four tiles in the spec's order. 'Are my setups active' shows valid/enabled/expired/refused and links to /setups. 'Last successful scan' shows date, bars and age, plus the last attempt if it differs, and links to /admin/scanner/jobs. 'Which setups matched' shows the latest matches in setup order and links to each alert. 'Are notifications working' says 'No channel exists: alerts are recorded in a file and shown here; nothing is sent' with the unread count, and links to /settings. Then come monitored instruments, recent matches (the last 5 bars), and a 'Run it' panel naming `node scanner/scan.mjs` and the daily task. A stale result is never shown under a 'current' heading: when state ≠ current, the latest-matches tile heading reads 'Matches as of <asOf> — not current'. The deployed site's empty state explains that the run log never leaves the machine and offers 'Open your files'.

   *Tests:* The scanner-pages harness intercepts runs, alerts, setups and history fixtures for each state and asserts the chip text and the 'not current' heading. With no files (the CI default), the sweep sees no near-empty page. mobile.mjs covers /app/scanner.


**Blocked.**


- **Server-computed metrics across users, and 'notifications working' measured by delivery status** — There is no server, accounts or delivery channel (SC-309/315 blocked on an operating entity, a PDPA privacy notice and a backend). The dashboard answers that question truthfully with 'none'.

- **'Last scan' judged against a real session calendar (holiday vs missed run)** — No exchange calendar is held (26-instruments.js:39-46: 'needs a licensed exchange calendar'). Staleness uses a 4-calendar-day rule that says it is approximate.


**Risks.** A try/finally in main() must not swallow process.exit. Restructure main so that exits happen after the append. The runs log must not become a second source of truth for alerts: counts only, with alerts staying in scan-alerts.json.


### SC-313 — Administrative monitoring — /admin/scanner, /data, /jobs, /delivery

**As built (this batch — ops).** The four pages are read-only views of the worker's files, each opening with the notice that there is no administrator role. /admin/scanner: data sources and the last ingestion with its steps (data/ingest-runs.json); sessions now for the markets whose hours are held, the rest behind a disclosure, calendars marked inferred; runs by status over the last thirty; the indicator cache (none persisted, the last run's hits); the alert engine's counts; notifications; usage; errors by run id with the exact retry command; and every control as its command. /admin/scanner/data renders scanDataHealth per market and per series (only series with something to look at by default). /admin/scanner/jobs lists runs newest first with a status filter, duration, counts and an expandable error, and the control log. /admin/scanner/delivery lists IN_APP, EMAIL, TELEGRAM and PUSH with their status and reason, and the delivery records. Fixtures in scanner/fixtures/ drive the checks. The worker's own controls, lock and runs log are the data-and-worker batch's. Still blocked: an admin role and operator identity, provider control, a job queue.

**As built (this batch — engine part only).** scanDataHealth(history, instruments, now) returns the file summary, per market (zone, session, calendar basis with inferred holidays and ambiguous days, the session expected by now, stale series) and per series (bars, invalid bars with codes, dropped keys and values, gaps against the calendar, close-to-close breaks tagged with the nearest split ratio or 'unexplained', volume coverage, bar statuses, the 500-point keep). scanReadiness gives the per-market readiness line the worker now prints. Still to build (round 2): the worker's controls, lock and runs log, and the four pages. Blocked as before.

**As built (round 3, ops).** The operations pages now read the run record scanner/scan.mjs writes (contract C4) rather than the plan's shape, which no worker ever wrote: the counts from run.counts (the alerts file's flat lastRun is still read), each run's history from historyNewest and historyHash, its problems from errors[] with their correlation ids, readiness as the worker's array. The alert-engine panel reads the newest run that evaluated and names a later attempt that evaluated nothing; the indicator cache is read from the run, or — for a worker that writes it only to the alerts file — from lastRun.cacheStats, and the page says which. The round 3 additions (skippedMarkets, catchUp, ledger) are shown where a run carries them and read "not recorded — this worker does not write it" where it does not, never as zero. The errors panel lists failed, cancelled and partial runs; the runs page filters by every status the worker writes (and "other" for one it does not know), says what a pending or running record means, and opens each run's clock, lock takeover, retry basis and transitions in a full-width row under it; the control log states each control in words with the machine's own account name. scanner/fixtures/scan-runs.fixture.json is rewritten in the worker's shape with one run of each of the ten statuses and six controls, and scan-deliveries.fixture.json carries the worker's channels word for word. scanner-test runs the real worker in a temporary folder into every state reachable from outside a run and fails if a fixture uses a key it does not write, or, for a status it reached, a value of another kind. The data view's "500-bar keep" wording is the data batch's. Still blocked: an admin role and operator identity, provider control, a job queue.

**Priority** P0 · **Status** missing

**What exists.** No operations view exists. What is available: the single lastRun (scan.mjs:160-163), which includes a stale list of series more than 10 days behind the newest bar (86-scanner.js:359-364); worker exit codes 0/1/2 (scan.mjs:14-17); daily.mjs step lines and exit codes in data/daily-report.txt, a text file overwritten each run that covers capture STALE/FAILED, read, import, history, scanner and fx (ingest/daily.mjs:46-164); the price-history file-level meta generated/source/symbols (ingest/history.mjs:56-58); and MARKETS tz and session hours (26-instruments.js:41-46). The history silently drops non-positive or non-finite closes at read time (86-scanner.js:306) and silently overwrites a changed close (ingest/history.mjs:45). Series are trimmed to 500 points (ingest/history.mjs:25, 49-54). There is no lock: two concurrent `node scanner/scan.mjs` runs can both read the same existing alerts, and the second rename overwrites the first's appended alerts.

**Gap.** All four pages are missing. There is no run history, no per-step ingest history, no data-health computation (dropped points, gaps, per-market newest bar), no pause/replay/retry/unlock controls, no audit of controls and no concurrency lock. There is also no admin role, and the static app cannot have one.


**Buildable now.**


1. **Worker controls as audited CLI commands** *(medium)* — scanner/scan.mjs argument handling (176-213)

   `--as-of YYYY-MM-DD [--dry]` replays a session. The history is truncated to bars ≤ date and the run uses the existing alerts, so key dedupe and cooldown stop a replay from duplicating anything. It is recorded with trigger:'replay' and replayAsOf. Nothing is 'resent', because nothing is ever sent. `--pause "reason"` / `--resume` write data/scan-control.json {paused, since, reason}; while paused, a run exits 0 with a SKIPPED_PAUSED record. `--runs [n]` prints the last runs and their errors, to inspect failures. `--unlock` clears a stale lock. 'Retry a failed job' is plain `node scanner/scan.mjs`, which is idempotent by key. Every control appends {kind:'control', action, at, argv, reason} to scan-runs.json. That is an append-only local log, not a tamper-evident or identity-bearing audit trail, and the page says so. Concurrency: data/scan.lock is created with open(…,'wx') holding {pid, startedAt}. If the lock exists and its pid is alive (process.kill(pid,0)), the run records SKIPPED_LOCKED and exits 2. A lock whose pid is dead, or older than an hour, is taken over and the takeover is recorded.

   *Tests:* scanner-test: a replay at the fixture's penultimate bar records nothing and a replay at the last bar records the one alert; a second replay records none (dedupe); a paused run writes a SKIPPED_PAUSED record and no alerts; a live lock gives exit 2 with SKIPPED_LOCKED; a dead-pid lock is taken over; two concurrent spawns end with exactly one alert and two run records.


2. **scanDataHealth(history, instruments, now) — pure, in the engine region** *(medium)* — 86-scanner.js engine region

   Returns { file:{generated, source, symbols}, markets:[{market, tz, session, newestBar, symbols, staleSymbols}], series:[{symbol, market|null, bars, first, last, behindDays, volumeCoverage, dropped:{nonPositive, nonFinite}, gaps:[{after, before, weekdays, kind:'others-in-market-have-bars'|'no-bars-in-market'}], jumps:[{bar, pct}] }], totals }. A gap is consecutive bars more than 1 weekday apart. It is classified as a missing capture when other instruments of the same market have bars in it, and otherwise 'no instrument of this market has a bar — a holiday or no capture; no calendar is held'. A jump is a single-bar move of more than 40%, flagged as 'possibly a split or corporate action; closes are not adjusted' and never corrected. It also reports series trimmed to the 500-point keep.

   *Tests:* scanner-test fixtures: a zero close counted as dropped; a weekday gap with and without a sibling bar classified accordingly; a 2:1 split flagged as a jump; an unplaced symbol with market null.


3. **The four /admin/scanner pages, read-only** *(large)* — new src/js/88-scanner-ops.js: VIEWS.scannerOps, scannerOpsData, scannerOpsJobs, scannerOpsDelivery

   Every page opens with the same notice: 'Operations — read-only view of this machine's worker. There is no admin role: this build has no accounts, so anyone who opens this address sees this page, and on the deployed site it has nothing to show because the run log never leaves your machine. The controls are commands you run where the worker runs.' /admin/scanner has panels in the spec's order. Data sources: history file, generated and source, plus the last ingest from daily.mjs's JSON log if that slice lands it. Exchange sessions: for US and MY, the local time now in the market tz and open/closed by the published regular session, with holidays 'not held'; 'pending final data' is 'not knowable — no finality signal'. Scan jobs: counts by status over the last 30 runs. Indicator cache: 'none — every run recomputes; engine scan x.y.z'. Alert engine: matched, recorded, deduplicated ('already recorded') and cooldown-suppressed, from skippedByReason. Notifications: 'no channel'. Usage: active setups and monitored instruments. Errors: FAILED and PARTIAL runs with error.code, message, timestamp and run id (the correlation id). Controls are a list of copyable commands, each with what it does and that it is logged. /admin/scanner/data renders scanDataHealth as a per-market table plus a per-series table in symbol order, with dropped, gaps and jumps. /admin/scanner/jobs is the runs log newest-first, with a status filter and an expandable error per row, and control entries interleaved and marked. /admin/scanner/delivery lists channels IN_APP ('the page reads the file; unread n in this browser'), EMAIL, TELEGRAM and PUSH, each 'not built' with its blocker. It shows no queue and no fake zero counts.

   *Tests:* sweep phase3 routes with no files present must render the notice and empty states. The scanner-pages harness with a fixture runs log containing FAILED, PARTIAL, SKIPPED_LOCKED and a control entry asserts each renders and the errors panel lists the failures. mobile.mjs covers /admin/scanner/jobs, a wide table inside .tablewrap.


**Blocked.**


- **Admin role, access control and an audited operator identity on controls** — No accounts or server. The static equivalent is a local append-only log of CLI controls with no identity.

- **Disable a provider, and provider status from an authorised feed** — No licensed provider exists (spec §3; platform plan). The capture, import and live paths are the reader's own. 'Disable' amounts to not running that ingest step, which is a daily.mjs flag owned by SC-301/307.

- **Queued/running job states and a job queue with retries** — There is no scheduler service. Runs are started by Windows Task Scheduler or by hand. RUNNING is visible only as the lock file, and there is no PENDING queue.


**Risks.** The ops pages must not imply supervision that does not exist. Every 'n/a' has to be a sentence, not a zero. The lock must be released in finally, or a crash blocks the next daily run for up to an hour: state that on the page and in `--runs`.


### SC-314 — Historical testing (simulation of match dates, not a performance backtest)

**As built (this batch — ops, the page).** /app/scanner/backtest (VIEWS.scannerBacktest, flagged P1) takes a setup from the file, the builder's draft or pasted JSON, one instrument or the setup's universe, and a date range; it runs scanHistorical per instrument in chunks, cancellable, bounded to 600 bars an instrument. The fixed simulation label and the no-look-ahead statement come before any figure. It shows counts of bars (never a return), coverage per instrument with testable-from and missing sessions, and the matching dates in three readings — where a match began, what the worker would have recorded, every bar that held — each row opening its conditions and values. equity-test checks that the page's events are scanHistorical's and that each equals the history cut at its own bar. The worker's --backtest flag is the data-and-worker batch's. Performance stays blocked.

**As built (this batch — engine part).** scanHistorical(setup, history, { symbols, from, to, maxBars, instruments, cache }) runs scanEvaluate at every completed bar and returns matches, events (NEW_MATCH / FIRST_OBSERVED), what the worker's dedupe and cooldown would have recorded, coverage per symbol (testable from, unavailable bars, invalid bars, missing sessions) and the missing sessions, marked simulation with the fixed note; no return, entry or exit exists in it. scanner-test pins no look-ahead two ways (evaluating at bar i equals evaluating the history cut at i, at all 260 bars of a nested nine-indicator tree; fifty noise bars appended change no earlier row) and that the recorded list equals a day-by-day scanRun replay. Still to build (round 2): the /app/scanner/backtest page and the worker's --backtest flag. Performance backtesting stays blocked.

**As built (round 3, ops).** docs/platform-plan.md's scanner table splits the single "Backtesting | blocked" row into "Historical match simulation over your own history — built, flagged (SC-314)" and "Strategy backtest with performance — blocked (point-in-time licensed history with corporate actions; an entry, exit, cost and slippage model)". register-check rule 9 holds the plan to the register: no single backtesting row, the simulation row built and, while the register flags it, flagged, and the performance row blocked on what it needs. The page's old "backtesting is gated" sentence was already gone. Performance stays blocked.

**Priority** P1 · **Status** missing

**What exists.** The engine evaluates only the last bar of the arrays it is given. scanRule uses bars.closes.length-1 (86-scanner.js:195), and scanSetup reads the last date (86-scanner.js:252-254). All indicators are causal from index 0: SMA over a trailing window with a gap guard (94-104), EMA seeded from the first n bars (105-113), Wilder RSI (115-130), MACD (131-142), and a volume note over slice(-window) (177-179). So evaluating a prefix slice bars[0..i] is, by construction, 'using only bars up to i'. Probe (node, read-only, real local data: 105 symbols, up to 504 bars, 3 setups over every symbol): 106,536 prefix evaluations in 0.67 s, of which 1,028 per-bar matches and 30,938 warm-up/untested. A day-by-day replay of scanRun on a date-truncated history, applying dedupe and cooldown exactly as the worker would, took 7.3 s over 504 dates and produced 6 recordable alerts. The platform plan records 'Backtesting blocked (point-in-time licensed history)' (docs/platform-plan.md scanner table), and the page says 'backtesting needs point-in-time history' (86-scanner.js:588).

**Gap.** There is no function, page or CLI for evaluating a setup over past bars. There is no coverage report or missing-period detection. The plan's 'blocked' entry must be narrowed: match-date simulation over the reader's own captured closes is buildable, while a strategy backtest with performance remains blocked. The history is close and volume only, not adjusted, trimmed to 500 points, and has no calendar.


**Buildable now.**


1. **scanHistory — the same engine over every completed bar, no look-ahead by construction** *(medium)* — 86-scanner.js engine region; the cooldown block at 382-393 is refactored into scanCooldownHolds(prevBar, dates, cd), which scanRun and scanHistory both call

   scanHistory(setup, history, { instruments=[], from=null, to=null, maxBars=600, symbols=null }) → { engine, simulation:true, setupVersion, universe:[symbol], coverage:[{symbol, bars, first, last, testableFrom (first bar where every rule could be tested), untestedBars, volumeMissing, gaps (from scanDataHealth), jumps}], matches:[{symbol, bar, close, volume, rules:[{text, met, left, right}]}] (EVERY_MATCH: every bar where the setup held), events:[…] (NEW_MATCH: false→true transitions only), wouldHaveRecorded:[…] (key dedupe plus cooldownBars exactly as scanRun), counts:{evaluatedBars, matchedBars, newMatches, recorded, untestedBars} }. For each symbol it takes b = scanBars and, for i in range, calls scanSetup(setup, sym, {dates:b.dates.slice(0,i+1), closes:…, volumes:…}). There is no separate formula implementation. The output is in symbol order, then date order.

   *Tests:* scanner-test: (a) no look-ahead, stated as a mutation test: rows for bars ≤ D are identical whether computed on the history truncated at D or on the full history plus 50 appended bars of noise; (b) the last row equals scanRun's evaluation on the full history; (c) on the fixture, events has exactly one entry, on the last bar; (d) a setup that stays above for 5 bars gives matchedBars 5 and newMatches 1 for 'above', and 1 for 'crosses_above'; (e) wouldHaveRecorded equals a day-by-day scanRun replay on the fixture; (f) testableFrom for EMA50 plus a crossing is bar index 50.


2. **/app/scanner/backtest page plus CLI** *(large)* — 87-scanner-pages.js VIEWS.scannerHistory; scanner/scan.mjs `--history-test <setupId> [--from --to] [--json out]`

   Pick a saved setup, or 'the builder draft', and a date range. It runs one setup at a time, chunked per symbol through setTimeout with a progress line and a cancel button, bounded by maxBars. The title is 'Historical matches — simulation'. The fixed header reads: 'A simulation on the closes you captured. It lists the bars on which your conditions held; it has no entries, exits, costs or slippage, so it shows no return. Closes are not adjusted for splits or dividends. Your universe is the instruments you track today, so anything you stopped tracking is absent. None of this is a guarantee, and no indicator here is claimed to work.' The page then shows the counts; a coverage table per symbol (bars, first, last, testable from, gaps and their kind, jumps); a matches table in symbol-then-date order with values; and a toggle between every match, new matches and what the worker would have recorded. Each row links to a detail view of that bar's values, in the SC-310 layout, marked 'simulated'. There is no chart of hypothetical P&L, no 'hit rate', and no forward return after a match. A forward return is performance, and the spec says performance needs entry/exit/cost assumptions first.

   *Tests:* The scanner-pages harness with the fixture history asserts the header text, one event on the fixture's last bar, and coverage rows equal to scanHistory. wording-check gains banned claim phrases scoped to scanner text ('win rate', 'hit rate', 'profitable', 'backtested return'), with the file's existing DENIAL exemption. mobile.mjs covers /app/scanner/backtest.


3. **Correct the plan and the page's 'backtesting is gated' sentence** *(small)* — docs/platform-plan.md scanner table ('Backtesting | blocked'); 86-scanner.js:588

   Split the entry into two. 'Historical match simulation over your own history: built (SC-314, flagged)'. 'Strategy backtest with performance: blocked (point-in-time licensed history with corporate actions; entry/exit/cost model)'.

   *Tests:* register-check: the SC-314 row is flagged with a flag sentence.


**Blocked.**


- **Performance (returns, drawdown, win rate) and a full strategy backtester** — Point-in-time adjusted OHLCV with corporate actions, from a licensed source, plus stated entry/exit/cost/slippage assumptions (spec §11). The captured closes are unadjusted, close-only and trimmed to 500 points (ingest/history.mjs:25).

- **'Underlying candles' as OHLC** — Only close and volume are held (price-history.json {series, volume}). OHLC needs a source that carries it (SC-301/302).

- **Classifying gaps as holidays** — No exchange calendar (26-instruments.js:39-46). Gaps are named and cross-checked against other instruments of the same market, not classified.


**Risks.** A simulation page invites reading matches as signals. The header, the absence of any forward-return column and the flag notice carry that line. Browser cost: one setup over 105 symbols by 500 bars is about 0.2–0.7 s, and 'all' universes with MACD are heavier. Chunking and maxBars keep the tab responsive.


### SC-315 — Telegram notifications

**As built (this batch — data, round 2).** Recorded honestly: channels.TELEGRAM in data/scan-deliveries.json is NOT_CONFIGURED with its reason (a server-held bot token, a chat id held under a privacy notice); no row is written for it and scan.mjs --status says so. Delivery stays blocked.

**Priority** P1 · **Status** blocked

**What exists.** None, by design (86-scanner.js:26-27, 587; docs/platform-plan.md:384).

**Gap.** No channel adapter, no bot token handling, no chat binding, no delivery status.


**Buildable now.**


1. **Channel recorded as NOT_CONFIGURED with its reason** *(small)* — data/scan-deliveries.json channels block and the /my/scanner/settings page (see SC-309)

   channels.TELEGRAM = { status:'NOT_CONFIGURED', why:'a bot token must live on a server, and binding a chat id is holding a contact identifier under a privacy notice; neither exists' }. The settings page lists it disabled with that text, and it never appears as available.

   *Tests:* The settings page renders the reason; no Telegram control is focusable as if active.


**Blocked.**


- **Telegram delivery** — Needs a server-held bot token (no credentials in frontend code, spec §9), an operating entity and a privacy notice for chat ids (PDPA). A worker-local bot using the reader's own token is technically possible but is out of scope for the same reasons as local email (credential storage in a repo directory; it would present an unfinished channel as the product's).


**Risks.** None beyond keeping the label honest.


### SC-316 — Market-wide screening (P1)

**As built (this batch — ops).** /app/scanner/market (VIEWS.scannerMarket, flagged P1) screens a setup over a market's instruments that hold a series in the reader's history — or everything with one — each on its last final bar, now or replayed as of a date, recorded nowhere. The coverage statement comes first (n screened, m in the registry, the market itself not screened); results are matched, not matched and untested, each group in symbol order with the conditions and values or the reason; no header is a control; bounded at 2,000 instruments and paged. wording-check bans ranking and performance phrases in the scanner modules. Still blocked: a whole exchange, and screening for anyone else.

**As built (round 3, worker).** Item 1's engine test is built: scanner-test permutes closes and volumes across twelve instruments (four permutations) and asserts that every instrument is evaluated and recorded in the universe's own order, never by close or volume, and that the matched subset — which changes with the values — keeps that order. The page harness's untested-reason check and the "Save as a setup" handoff are the operations and setups owners'.

**As built (round 3, user).** The builder's side of the hand-off: /app/scanner/setups/new?market=<MARKET> opens a draft whose universe is that market's instruments in the history, and ?from=<setup> copies a setup's conditions under a new id; the two combine (contract C5). The market page's "Save as a setup" link and the engine order test are other owners'.

**As built (round 3, ops).** "Save as a setup" under a screen's result now takes the screen to the builder (contract C5): /app/scanner/setups/new?market=<market>&from=<setup id> for a setup from the file; ?from= alone for "everything with a series", with the sentence that the universe is chosen in the builder, because C5 has no parameter for it; and ?market= alone for the builder's draft or a pasted setup, which have no id the builder can find — the page says a pasted setup's conditions do not travel. equity-test checks the three links and that every untested row names its reason (a five-bar series reads "EMA50 needs 51 bars; 5 held …"). The builder's reading of ?market= and ?from=, and the engine check that the evaluated order is independent of values, are the user and worker batches'. Still blocked: a whole exchange, and screening for anyone else.

**Priority** P1 · **Status** partial

**What exists.** Universe kinds 'all' (every instrument with a series) and 'market' (registry membership from data/instruments.json) exist in the engine (86-scanner.js:259-274, validated at 441-446). The builder offers them, with the markets actually in the registry (86-scanner.js:758-779). Series with no registry row are named as 'unplaced' rather than dropped (86-scanner.js:281-299, 346). The output order is setup-then-symbol, never by value; this is pinned by scanner-test.mjs:157 ('alerts come out in the order the setups were written'), and the boundary is stated at 86-scanner.js:8-12 and 586. data/instruments.json (tracked, 111 rows, 30 market codes) is the registry.

**Gap.** There is no /app/scanner/market page to screen now. The existing 'Evaluate now' shows matches only, as a flat list. 'US Equities' and 'Bursa Malaysia' as the spec words them imply the whole market, but only instruments with a series in the reader's history are screened: locally 105 series, versus a registry of 111 and real markets of thousands. Nothing states that coverage. Nothing mechanically prevents a future change from adding a sort-by-value to the table.


**Buildable now.**


1. **/app/scanner/market — screen a market now, not recorded** *(medium)* — 87-scanner-pages.js VIEWS.scannerMarket

   Choose a market from the registry's own list, or 'everything with a series', and a saved setup or the builder draft. Evaluate: scanRun([setup with universe overridden], history, {instruments, existing:[]}), which records nothing. The coverage statement comes first: 'Screened n instruments — the ones in this market with a series in your own history. The registry lists m for this market; the market itself has many more, and none of those are screened.' Results are in ONE fixed order, alphabetical by symbol, and the page says so. Three sections: matched, not matched and untested (with reasons). Each row shows only the per-rule met flag and the values the rule compared. There is no sortable header, no score, no 'top N', no 'closest to matching' and no count cap other than pagination, and the table carries aria-sort='none'. 'Save as a setup' goes to the builder with universe {kind:'market'}.

   *Tests:* scanner-test (engine): permuting closes and volumes across symbols leaves the order of evaluated symbols unchanged (order is independent of values). Page harness: the market table has no th[aria-sort] other than 'none' and no button inside a th; the coverage line states n and m; 'untested' rows name their reason. wording-check adds 'top picks', 'best setups', 'strongest', 'ranked by' as banned claims in scanner text.


2. **Guard against a pick list, stated in the register** *(small)* — 80-registers.js new row; register-check.mjs

   The row is flagged, with flag: 'Screens only instruments with a series in your own history — not the market — and lists them in symbol order; no order by any value is offered, because a list ordered by strength is a pick list.' The only guard that can be mechanical is the engine order test plus the no-sort DOM check above.

   *Tests:* register-check rule 4 (flagged P1 with a flag sentence).


**Blocked.**


- **Screening a whole exchange (every US equity, every Bursa listing)** — A licensed EOD feed with redistribution rights covering the full listing, plus an exchange master. The reader's captures cover what they track.

- **Offering market screening to anyone else** — Operating entity, licensed feed, and Malaysian legal classification. Algorithmic ranking or screening offered to others is the advice question (86-scanner.js:8-12; platform plan).


**Risks.** The P1 label must stay flagged. 'Market Scanner' in the subnav must not read as a market-wide product, so the tab label is 'Market (your series)'.


### SC-317 — Intraday scanner infrastructure

**As built (this batch — data, round 2).** Stated, not built: no intraday fetch exists in either lane (live.mjs says so in its header), SCAN_TIMEFRAMES still refuses 1H/15M/5M, and scan.mjs --status prints that only daily and weekly are built because intraday bars need a licensed feed. Each bar's capture instant is now recorded (meta.at), which an intraday store would also need. Blocked as before.

**As built (round 3, user).** The builder check: equity-test asserts that the builder's timeframe select enables only 1D and 1W and shows 1H, 15M and 5M disabled as not available. Nothing intraday was added.

**As built (round 3, data).** Bars reserve the intraday shape: scanBars, the weekly derivation, scanSeriesBars and scanSliceBars carry a timestamps array beside dates, one entry per bar, null for every daily and weekly bar — a daily bar is named by its session date and its instant is the session's close, which scanSessionEnd gives on demand — so an intraday bar has a place for its instant; nothing fills it. The builder's disabled-option check and the scanner pages' wording check are other owners'. Blocked as before: intraday data rights.

**As built (round 3, ops).** The wording check the item names: wording-check.mjs fails "live", "real-time" or "realtime" in the text of the scanner modules (comments left out; aria-live and ingest/live.mjs are not words of a page) unless the sentence it sits in denies it, and equity-test renders fourteen scanner pages with the fixture files loaded and every disclosure open and holds each sentence on screen to the same rule. Two strings were reworded so they pass honestly rather than by exemption: the operations overview's "your live reader" is now "the end-of-day quotes you fetch yourself", and the delivery page's web-push row says it is not built. The reserved timestamps array and the builder's check that no intraday option is enabled are the data and user batches'. Blocked as before.

**Priority** P2 · **Status** blocked

**What exists.** Nothing intraday. scanValidate refuses any timeframe but 'daily' (86-scanner.js:435), and scanRun skips one (:340). Alert keys already carry a timeframe segment (:310). MARKETS records tz and session strings for display only (26-instruments.js:37-46). providers.mjs quote() returns asOf and delayMinutes (:16), and yahooProvider reads exchangeDataDelayedBy (:210-211), but no intraday bars are fetched or stored. The capability register lists the scanner as daily-only and personal-lane (80-registers.js:147-150).

**Gap.** The spec wants the architecture ready for intraday but not activated. Today nothing is timeframe-generic: bars are keyed by YYYY-MM-DD and there is no timestamp field, no status per bar, no session-segment model (Bursa's midday break), no polling or streaming, no latency monitoring and no load testing.


**Buildable now.**


1. **Reserve the intraday shape without activating it** *(small)* — engine region (Bars and SCAN_MARKETS); scanValidate; scanner page copy; 80-registers.js row

   - Bars carry `timestamps` (ISO instants, bar open in UTC) alongside `dates` (session date), so a 1H bar is representable. For '1D' the timestamps are the session close instant computed from SCAN_MARKETS.
- SCAN_MARKETS already carries breaks (MY 12:30–14:30) for future session-aware bucketing.
- SCAN_TIMEFRAMES = { '1D': {built:true}, '1W': {built:true, derivedFrom:'1D'}, '1H': {built:false, why:'intraday data rights not held'}, '15M': {built:false, …}, '5M': {built:false, …} }.
- scanValidate refuses unbuilt timeframes, quoting that reason.
- The builder lists only built timeframes. It may list 1H as a disabled option labelled 'not available — no intraday data rights'; it must never be selectable (spec: 'do not present unfinished intraday functionality as available').
- No intraday fetch is added to live.mjs, even in the personal lane.

   *Tests:* - scanValidate refuses '1H' with the reason.
- The builder DOM (sweep.mjs route check) has no enabled 1H option.
- wording-check.mjs asserts that no 'live' or 'real-time' wording appears on /my/scanner.


**Blocked.**


- **Intraday candles (1H/15M/5M), polling/streaming, latency monitoring, live push** — Intraday data rights (a licensed real-time or delayed feed, which is priced per user with audit obligations — prices.mjs:12-17), a server or long-running process, and legal review. The spec's own release gate (§17) keeps these separate.

- **Load testing and latency SLOs** — There is no server to load; this belongs to the same live-scanner release.


**Risks.** The temptation is to reuse Yahoo's interval=1h endpoint in the personal lane. It is outside its terms (providers.mjs:166-183), and doing so would present intraday as available. Keep it unbuilt.


### SC-318 — Live push notifications

**As built (this batch — data, round 2).** Recorded honestly: channels.PUSH in data/scan-deliveries.json is NOT_CONFIGURED with its reason (a push service and a server holding subscriptions; the live scanner, SC-317, is not built). Web push stays blocked.

**Priority** P2 · **Status** blocked

**What exists.** None. The page states intraday is gated (86-scanner.js:588).

**Gap.** No service worker push subscription, no push server (VAPID), no intraday scanner to push from.


**Buildable now.**


1. **PUSH channel shown as NOT_CONFIGURED; the unread badge is the in-app substitute** *(small)* — data/scan-deliveries.json channels; settings page; nav badge (SC-309)

   channels.PUSH = { status:'NOT_CONFIGURED', why:'web push needs a push service and a server holding subscriptions; live scanning (SC-317) is not built' }. A browser Notification shown while the page is open is not built. It would fire only when the page reloads the file, so it is not push and would mislead.


**Blocked.**


- **Web push** — No server for subscriptions or VAPID keys, no entity, and no intraday data rights or live scanner (SC-317). This is a later-release gate by the spec's own §17.


**Risks.** None if it stays labelled as not available.


### SC-319 — Automated QA and regression — the 24-item checklist, register rows, sweep/mobile phase3

**As built (this batch — ops).** docs/phase3-qa.md maps the 24 items and the six further cases to checks or blockers. The register carries one row per SC item and SC-NAV with its priority from §1; register-check reads both plans, accepts P2 only on SC rows and fails a P2 row with a path or an operational or flagged status, fails a scanner or operations route robots.txt does not disallow, and with --release phase3 lists the blocked P0 items apart from the partial ones. /status shows one release card per brief. equity-test gains the header, dashboard-state, screening-order, simulation, operations and empty-state checks; sweep a Phase 3 block; mobile the scanner and operations routes and a six-item header check at 360. Still blocked: items 17–19 and the release going green.

**As built (round 3, worker).** Item 5, the worker's part: the order of evaluation under permuted closes and volumes (SC-316), and the planned budget — 2,000 synthetic instruments × 500 bars, one three-condition setup, scanRun under 5 s, the time printed (about 1.8 s on the build machine). Meeting it took remembering the date-string helpers (scanIsDay, scanWeekday, scanAddDays), which built a Date for each of a million bars on every validation, weekday and gap: the same run took 5.5 s before. The worker's round 3 checks (ledger, catch-up, narrowed replay, ready gate, export resolution, the run's C4 fields) are in scanner-test's round 3 block. Not built: the committed reference CSV of SMA/EMA/RSI/MACD "computed in a spreadsheet" — no spreadsheet is available here, and values typed from this engine's own output would not be independent; the naive in-test implementation remains the second reference.

**As built (round 3, data).** Item 4's data part: equity-test injects a history with a gap, a zero close, an unrecorded 2-for-1 split, a series dated a day early, a session held under two dates and a series at the 2,000-bar keep into /admin/scanner/data and asserts each is named; ticks the split, "saves" the drafted file, and checks the page's scanRun equals the Node engine's byte for byte before and after (untested, then one match with a +adj data version). The loader is checked with data/price-history.json and data/price-adjustments.json served by Fetch interception on a fresh load. scanner-test adds the adjustment, break, report, precision and timestamps checks and runs the real worker on a split with and without the file; history-store-test the history check, the re-fetch plan and --adjusted imports. Not built here: the 250-alert record and the full runs fixture (the user and ops owners'). Still blocked as before.

**As built (round 3, ops).** Item 2's tests: register-check rule 8 runs the priority and P2 rules on a synthetic §1 table, read through the plan's own parser (with a row after §2 that must not be read), and on synthetic registers — a clean one that must pass, then a P2 row with a path, a P2 row shown as available, an SC row whose priority disagrees with the plan and an unanswered SC item, each of which must fail with its own sentence. It runs on every plain `node register-check.mjs`, so CI runs it without a new step. Item 6: mobile.mjs's focus walk covers /app/scanner/setups/new at 375 and 1440 in both directions, and sweep adds the builder's C5 deep links. Item 4's runs part: the operations harness injects a runs log holding every status the worker writes, held to the worker's keys by scanner-test. Not built here: item 4's 250-alert record (the user batch's) and its history with a gap, a zero close and a split (the data batch's); item 5's additions (the worker batch's). Still blocked: items 17–19 and the release going green.

**Priority** P0 · **Status** partial

**What exists.** scanner-test.mjs has 82 offline checks, all passing at ba032e6 (verified by running it). They cover indicator arithmetic by hand (45-70), crossings from the previous bar (78-88), AND/OR/untested (108-113), dedupe (123, 193), cooldown in bars (127-139, 260), expiry (143-144, 310), universes (147-151, 209-211, 284-296), validation (168-170, 253-254), worker exit codes (184-202, 330-333), atomic write and .bak (322-326), stale series (306), volume absence (274-281), history import with volume (341), and that neither data file is tracked (350). equity-test covers the watchlist→scanner handoff (626-678) and the builder's ?symbol= (1874-1881). sweep.mjs visits /my/scanner (31); mobile.mjs measures /my/scanner (33) and awaits data for it (119). register-check.mjs (5 rules) reads priorities only from docs/phase2-plan.md with /^\|\s*(NAV|EQ-\d{3})…(P[01])/ (register-check.mjs:106), rejects any brief row not P0/P1 (148), and treats a route's params.id as a company (131). /status has one release card, hard-coded 'the Phase 2 equities brief' (90-area-screen.js:863). The register's scanner row is data-gated, brief EQ-214 (80-registers.js:147-150). docs/phase2-qa.md is the model for a checklist-to-check map.

**Gap.** There is no Phase 3 plan or status table for the checker to read, no SC rows in the register, no P2 vocabulary, and no rule that P2 (intraday/push) cannot be presented as available. The 'NAV' key collides with Phase 2's. There is no QA map for the 24 items, no page-level harness with injected scanner files (CI has none, so every scanner page is only ever rendered empty), and no phase3 routes in sweep or mobile. The QA map, with its checks and blockers, follows. MARKET DATA. (1) Valid OHLCV ingests: partial. Close and volume only; covered by scanner-test:341 and ingest-test; OHLC is blocked on a source. (2) Invalid and duplicate candles rejected: partial. Duplicates are impossible in {date: close}, but non-positive closes are dropped silently (86-scanner.js:306) and corrections overwrite silently (history.mjs:45). Buildable: scanDataHealth counts plus a test. (3) Holidays and incomplete sessions: blocked (no calendar, no finality signal); gaps are named. (4) Stale or provisional data cannot trigger confirmed alerts: stale is partial, since it is detected (306) but still evaluated and recorded. Buildable: the record carries stale:true, or SC-308 refuses it. Provisional is blocked, as no bar status exists. INDICATORS. (5) EMA/SMA vs independent references: partial, hand-computed values only. Buildable: a committed reference CSV computed outside the engine (a spreadsheet's AVERAGE/EMA formulas, values typed in) compared to 1e-9. (6) RSI/MACD initialisation: covered (53-70). (7) Missing history is unavailable: covered (96, 229, 290). (8) Corporate actions: blocked (unadjusted closes); jump detection is buildable (SC-313). RULE ENGINE. (9) Crossovers use previous and current bars: covered (78-88). (10) AND/OR groups: covered for one level; nested groups are SC-304's. (11) Invalid operand combinations rejected: partial, structural only (168, 253); an operand-class check (RSI vs price level) is SC-304's. (12) Identical inputs, identical results: buildable. The engine runs twice and deep-equals itself, and the page's scanRun equals scan.mjs --dry on the same files (harness). SCANNING. (13) Only after final data: blocked (no finality signal). (14) No duplicate alerts on repeat: covered (123, 193, self-test). (15) Failed jobs retry safely: partial (202, 326); buildable is the runs log plus a fail-then-retry equals clean-run test. (16) Universes resolve: covered. NOTIFICATIONS AND SECURITY. (17) Email failure does not erase alerts: blocked (no email); the record is written before anything, but nothing is delivered. (18) Retries do not duplicate deliveries: blocked (no delivery). (19) No cross-user access: blocked (no accounts); the nearest equivalent is that files are never tracked or deployed (350) plus a deploy-check. (20) Admin replay audited: buildable (SC-313 control log). FRONTEND. (21) Builder creates and edits valid rules: partial, creates only. Buildable: /setups/:setup/edit round-trips. (22) Dashboard shows persisted status: buildable. (23) Alert history and details resolve: buildable. (24) Mobile, keyboard and empty states: partial, /my/scanner only. ALSO: provider outage (daily.mjs STALE/FAILED, buildable into the runs log); delayed data (scanStatus 'behind'); concurrent workers (lock, buildable); large watchlists (buildable perf test); expired subscriptions (blocked, no subscriptions; the nearest is a signed-out capture reported STALE by daily.mjs:54-59); channel failures (blocked).


**Buildable now.**


1. **docs/phase3-plan.md status table plus docs/phase3-qa.md** *(medium)* — docs/

   A table in the phase2 shape, '| SC-3xx Title | P0|P1|P2 | status | batch | blocked on |', for SC-301…SC-319 plus 'SC-NAV Scanner routes | P0'. It restates, per item, the static-app scope and what is blocked. phase3-qa.md lists the 24 items (plus the 'also' six), each with a file and the opening phrase of its ok line, or the blocker, in the phase2-qa.md format.

   *Tests:* register-check reads the table (below).


2. **register-check and /status for Phase 3** *(medium)* — register-check.mjs:104-160, 199-203; 90-area-screen.js:855-870

   BRIEF reads both plans: /^\|\s*(NAV|EQ-\d{3}|SC-(?:\d{3}|NAV))\b[^|]*\|\s*(P[012])\s*\|/gm, keyed by item id with its phase. P2 is allowed on SC rows. A new rule: a P2 row is never operational or flagged and has no path. Intraday and push must not look available (spec §1). Rule 1 checks params against companies only for research and researchReport views. `--release phase3` fails while any SC P0 row is not complete, and lists blocked P0s (SC-301 authorised data, SC-309 email) separately as 'blocked on …', so the red state names its cause. Plain `--release` keeps Phase 2's meaning. /status renders one release card per phase from rows grouped by id prefix.

   *Tests:* register-test style fixtures, or self-checks: a P2 row with a path fails; an SC row whose priority disagrees with phase3-plan fails; an unanswered SC item fails.


3. **Capability register rows the checker needs** *(small)* — src/js/80-registers.js CAPABILITY_REGISTER (the existing 'Trade-setup scanner' row at 147 keeps EQ-214 and moves its path to /app/scanner)

   Rows as {name, status, path, brief, priority, complete, checks, now, gate|flag}. 'Scanner routes and navigation' is beta at /app/scanner, [SC-NAV] P0, checks from sweep and equity-test nav. 'Scanner dashboard' is beta at /app/scanner, [SC-312] P0, checks: scanner-test 'scanStatus', the page harness 'dashboard shows persisted status'. 'Alert history and detail' is beta at /app/scanner/alerts, [SC-310] P0. 'Scanner operations (local, read-only)' is beta at /admin/scanner, [SC-313] P0, gate 'no admin role; controls are CLI; local log, not an audit trail'. 'Historical matches — simulation' is flagged at /app/scanner/backtest, [SC-314] P1, with a flag sentence. 'Market screening over your own series' is flagged at /app/scanner/market, [SC-316] P1. 'Scanner QA and the Phase 3 release rule' is active-core at /status, [SC-319] P0, checks from scanner-test and register-check. Other slices supply rows for SC-301…309, 311, 315, 317 and 318. SC-309, 315 and 318 are compliance/data-gated with path null. SC-317 and 318 are P2 queued with no path.

   *Tests:* register-check rules 1–5 plus the P2 rule.


4. **Page harness with injected scanner files** *(large)* — new scanner-pages-test.mjs (the CDP bootstrap of equity-test/sweep), or a section of equity-test.mjs; the CI runtime job

   Fetch.requestPaused serves fixtures for data/scan-setups.json, scan-alerts.json, scan-runs.json and price-history.json, built from scanFixture(), plus a synthetic 250-alert record, a runs log with every status, and a history with a gap, a zero close and a split. It walks every phase3 route and asserts the SC-310/312/313/314/316 content checks named above: determinism (the page's scanRun result, serialized, equals scan.mjs --dry --json on the same fixture files), builder edit round-trip (open /setups/:setup/edit, change nothing, Copy JSON, and the result validates and deep-equals the original), keyboard (Tab through the builder rules with focus visible, reusing mobile.mjs's walk), and empty states (no files → each page states which file is absent and why).

   *Tests:* This harness is the test.


5. **Offline additions to scanner-test** *(medium)* — scanner-test.mjs

   scanHistory no-look-ahead mutation; scanStatus states; runs-log append on every exit path; lock and concurrency (two spawned workers → one alert, two runs); replay dedupe; pause; scanDataHealth counts; the independent reference CSV (SMA/EMA/RSI/MACD on a 60-bar series, values computed in a spreadsheet and committed with the formula named); order independent of values; a large-universe budget (2,000 synthetic symbols × 500 bars, one 3-rule setup, scanRun under 5 s in CI, printed so drift is visible); the alert record's new fields; data/scan-runs.json and scan-control.json never tracked.

   *Tests:* Each is a check() line with a stable phrase for phase3-qa.md.


6. **sweep and mobile phase3 sections** *(small)* — sweep.mjs ROUTES (12-50); mobile.mjs ROUTES (24-60), DATA_ROUTES (119), FOCUS_ROUTES (213)

   sweep gets a commented 'Phase 3 — the scanner' block: /app/scanner, /app/scanner/market, /app/scanner/setups, /app/scanner/setups/new, /app/scanner/setups/new?symbol=MSFT, /app/scanner/setups/trend-breakout, /app/scanner/setups/trend-breakout/edit, /app/scanner/watchlists, /app/scanner/alerts, /app/scanner/alerts/a00000000, /app/scanner/backtest, /app/scanner/settings, /admin/scanner, /admin/scanner/data, /admin/scanner/jobs, /admin/scanner/delivery, /my/scanner, /my/scanner?symbol=MSFT. mobile.mjs ROUTES gets /app/scanner, /app/scanner/alerts, /app/scanner/backtest, /app/scanner/market, /app/scanner/setups/new, /admin/scanner, /admin/scanner/jobs. DATA_ROUTES becomes /^\/(…|my\/scanner|app\/scanner|admin\/scanner|$)/. FOCUS_ROUTES gets /app/scanner/setups/new, the builder's long run of controls. A new mobile check verifies the six-item topbar has no overflow at 360.

   *Tests:* The harnesses themselves, in the CI runtime job.


**Blocked.**


- **QA items 17, 18 and 19 (email failure, delivery retries, cross-user access) and 'expired subscriptions', 'channel failures'** — No delivery channel, accounts or subscriptions. These are blocked on an operating entity, a PDPA privacy notice and a server. phase3-qa.md records each blocker and the nearest check (files never tracked or deployed).

- **QA items 3, 13 and the provisional half of 4 (holidays, final-data gating, provisional candles)** — A licensed EOD feed with a finality flag and exchange calendars (SC-301/302).

- **QA item 8 (corporate-action adjustment handled)** — No adjustment data. Only detection of split-like jumps is buildable.

- **`register-check --release phase3` going green** — SC-301 (authorised EOD data) and SC-309 (email) are P0 and blocked by decision. The release stays red, and says why, until the entity, licence and classification exist.


**Risks.** A harness that injects files must never write them into data/: interception only. Six nav items plus new routes lengthen mobile.mjs, which already takes about 10 minutes. The phase3 block should be gated behind a flag if CI time matters. Keep the 'NAV' key distinct as SC-NAV, or the checker merges two briefs' nav items.


## 5. What this plan does not do

It does not build accounts or ownership, a server API, a database, email,
Telegram, web push or SMS delivery, an administrator role, an authorised
OHLCV feed, exchange holiday calendars from an exchange, intraday bars or
live scanning. Each is named above with its blocker. The scanner scans only
the reader's own history, and offers nothing to anyone else.
