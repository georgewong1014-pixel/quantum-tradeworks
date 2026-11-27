Internal research method notes. Not financial, investment or property advice.
Status: draft from repo, 27 Nov 2026
Last checked against code: 2818eba23

# Products and tools

Routes come from the `ROUTES`, `PRODUCTS` and `PRODUCT_TABS` tables in `src/js/35-ui.js` (route rows near lines 1236 to 1354, product rows near lines 392 to 658). Vercel rewrites each route to a generated page under `pages/` (`vercel.json`). Everything runs in the reader's browser; there is no account system and no server database. Saved work lives in the browser (`store.read` / `store.write`, `src/js/00-core.js`).

## 1. Equities research pages

- What it is: filed-statement research for companies. The shipped set is 36 company records in `src/js/10-dataset.js` (18 with `mkt:'US'`, 18 with `mkt:'MY'`, all hand-authored and labelled illustrative) plus 119 US companies loaded from `data/us.json` (`source: SEC EDGAR`, `generated 2026-08-03T00:16:33.980Z`, `failures: []`). The Malaysian financials are illustrative because no licensed Bursa feed is held (`learnData`, `src/js/65-learn.js:389` onward).
- Inputs: the statement lines of each company (revenue, EBIT, net income, operating cash flow, capex, equity, debt, cash, shares, dividend per share; tuple order in the header of `src/js/10-dataset.js`), the company's business type, and a price where one is held (none is licensed; `learnData`).
- Outputs: derived measures (`src/js/13-metrics.js`), four pillar scores, a research composite, a risk flag list and grade, a model-routed valuation range, and a printable report.
- Routes: `/research` (home), `/research/queue`, `/company/:id` with tabs Snapshot, Business, Financials, Quality, Valuation, Moat, Risks, Ownership & actions, Filings, Investment case (`RESEARCH_TABS`, `src/js/45-views-research.js:729`), `/company/:id/report` (print view, `src/js/47-report.js`), `/compare`, `/discover/screener`, `/discover/value-map`, `/discover/sarawak`.
- Reader steps: (1) search or open a company; (2) read the Snapshot and Financials tabs, where each figure carries a provenance badge (reported, calculated, modelled, market, illustrative: `PROVENANCE`, `src/js/40-views-discover.js:2325`); (3) open Quality for the scores and Valuation for the model pack and sliders; (4) save a run or an investment case; (5) print `/company/:id/report` (the browser's print dialog is the only PDF route, `src/js/47-report.js` header).
- Source: `src/js/45-views-research.js`, `src/js/47-report.js`, `src/js/50-views-studio.js`, `src/js/15-derivation.js`, `src/js/20-valuation.js`.

### 1a. Screener

- What it is: a filter over the loaded companies (`renderScreener`, `src/js/40-views-discover.js:1505`). Route `/discover/screener`.
- Inputs: criteria as minimum or maximum per measure, universe (US, MY, watchlist), sectors, business types, minimum data completeness, an evidence class (filed, illustrative, mixed), and one of the named templates (`SCREEN_TEMPLATES`, line 1211).
- Outputs: the companies that pass every criterion, with a failure reason for each that does not (`evaluateScreen`, line 1356); a missing figure excludes the company and is never read as zero.
- Steps: choose a template or add criteria; read the pass list; open a company; save the screen. Rows with no figure sort after rows with one (`sortScreenRows`, line 1466).

## 2. The scanner and /admin/scanner

- What it is: a record of which conditions the reader defined held on which completed bar of the reader's own price history. It ranks nothing and delivers nothing outside the app (header of `src/js/86-scanner.js`; `scanner/scan.mjs` header, "WHAT THIS IS NOT").
- Inputs: setups (`data/scan-setups.json`, git-ignored, copied from `scanner/setups.example.json`), price history (`data/price-history.json`, git-ignored), optional watchlist export (`data/watchlists.json`) and price adjustments (`data/price-adjustments.json`), all read by `scanner/scan.mjs`.
- Outputs: alerts (`data/scan-alerts.json`), a run log with an audit list (`data/scan-runs.json`, newest 500), a ledger of setup versions (`data/scan-ledger.json`), a delivery record (`data/scan-deliveries.json`, one IN_APP row per new alert; email, Telegram and push are recorded NOT_CONFIGURED). All of these are git-ignored and exist on the machine that runs the worker (`src/js/87-scanner-ops.js` header; `scanner/scan.mjs` header).
- Routes for the reader: `/app/scanner` (dashboard), `/app/scanner/setups`, `/app/scanner/setups/new`, `/app/scanner/watchlists`, `/app/scanner/market`, `/app/scanner/alerts`, `/app/scanner/backtest`, `/app/scanner/settings`; `/my/scanner` is an alias of the dashboard (`src/js/35-ui.js:1274` to 1290 and 628 to 654).
- Steps: (1) copy a setup from the example or build one in the builder; (2) save it; (3) the worker (a command on the owner's machine, see automation-status.md) evaluates the last final bar; (4) the dashboard states whether the result is current, behind, failed, paused or absent; (5) the reader reviews matches under Alerts. "Evaluate now" in the page runs the same engine in the browser on the reader's own series.
- `/admin/scanner` (and `/admin/scanner/data`, `/admin/scanner/jobs`, `/admin/scanner/delivery`): what the code shows is four read-only pages that display the worker files of the machine that serves them, with no administrator role (there are no accounts); every control is a command run where the worker runs (`src/js/87-scanner-ops.js` header; routes `src/js/35-ui.js:1284` to 1287). On the public `.vercel.app` host these routes, and `/pages/admin/scanner.html` and `/pages/admin/scanner/:path+`, are redirected to `/` with status 301 (`vercel.json`, `redirects` entries for `/admin/scanner`, `/admin/scanner/:path+`, `/pages/admin/scanner.html`, `/pages/admin/scanner/:path+`, each with a `has` host condition matching `.vercel.app`). Whether a different custom host is configured in the Vercel project: UNKNOWN - George to confirm [Q9]. Nothing about these routes is changed by this note.
- Related: the QT Trading Index (`/research/trading-index`, method at `/learn/trading-index`) is a separate tool in `src/js/85-trading-index.js` with its own weights; see methodologies.md section 5.
- Source: `src/js/24-market-engine.js`, `src/js/86-scanner.js`, `src/js/87-scanner-ops.js`, `scanner/scan.mjs`, `ingest/daily.mjs`.

## 3. Property calculator / Property Intelligence

- What it is: a Sarawak-scoped deal model with a research grade, a fee ledger and a checklist. Product row: `id: 'property'`, name "Property Intelligence", home `/property/calculator` (`src/js/35-ui.js:433`).
- Inputs: the deal (`PROPERTY_DEFAULT_DEAL`, `src/js/70-property.js:626`: city, project, price, size, deposit percentage, loan rate and tenure, rent, vacancy, running costs, hold years, appreciation, who is selling), the evidence kind of each figure (`EVIDENCE`, line 450), answers to the Sarawak checklist (`SARAWAK_CHECKS`, line 1767), optional borrower details (`blankBorrower`, `src/js/75-property-grade.js`, held under their own storage key, never in the address or the export).
- Outputs: cash required, monthly cash flow, yields, debt-service cover, break-even occupancy, stress rows, exit and gains tax, a research grade A, B, C, D or U with pillar scores and gates (`propertyGrade`, `src/js/75-property-grade.js:338`), and a fee ledger with a provenance mark on every line.
- Routes: `/property/calculator`, `/property/models` (My properties), `/property/models/:property/proposal`, `/property/opportunities`, `/property/comparables`, `/property/market`, `/property/areas`, `/property/areas/map` (Kuching scheme map, `src/js/92-kuching-map.js`).
- Reader steps: (1) answer what is being bought and how (residential, commercial, land; new development, subsale, auction: `src/js/83-property-decision.js` header, P1); (2) enter or confirm the figures and mark where each came from; (3) answer the checklist; (4) read the result and the grade's named gates; (5) save the property (saving is the only write: `83-property-decision.js` header); (6) optionally print a client proposal.
- Source: `src/js/70-property.js`, `src/js/75-property-grade.js`, `src/js/83-property-decision.js`, `src/js/84-property-costs.js`.

## 4. Scenario Lab

- What it is: up to three columns (A, B, C) of the same calculator model, with five sliders (price, deposit, rate, rent, renovation) plus more inputs, results updating at once with no Calculate button (`src/js/82-property-lab.js` header). Route `/property` (the one Lab address; `/property/lab` redirects to it, `vercel.json`).
- Inputs: a column's figures (`LAB_INPUT_LIST`, line 82; slider ranges are relative to the starting value, for example price 75% to 125%, rent 50% to 150%, rate minus 3 to plus 3 points) and the property route and class answers.
- Outputs: six comparison views (Yield, Cash flow, Entry cash, Appreciation, Risk as break-even occupancy, Location: `LAB_METRICS`, line 310) in fixed column order; nothing is ranked or coloured as preferable. Every figure is `dealModel` and `propertyGrade` run on the column's inputs; the Lab's own arithmetic is only the change against a baseline.
- Steps: set a baseline (from the calculator, a saved property or the defaults); move a slider; compare columns; commit by Save as a scenario, Update the scenario or Open in the calculator. A what-if writes nothing until committed.
- Source: `src/js/82-property-lab.js`.

## 5. Reports and corrections

- Report a data error or Send feedback (footer of every page and `/contact`): opens a form, records a draft in the browser with a case id of the shape `QT-YYYYMMDD-NNN-xxxx`; copy and email are always offered; "Submit this report" appears only when the deployment has a report store; a receipt `QTR-<n>` is shown only after the store confirms it holds the record (`docs/report-submission.md`; `api/report.mjs`; drawer code in `src/js/65-learn.js` near lines 1293 and 1404).
- What is sent: the text in the box, the page's path (never its query string) and the build name; nothing else (`docs/report-submission.md`, "What the visitor sees").
- Corrections log: `/corrections` (tab `trust` of `learn`): the visitor's own cases from this browser plus the published log of model and rulebook changes (`State.corrections`, `src/js/65-learn.js:825`).
- Whether the store is configured on the live site: UNKNOWN - George to confirm [Q10]. `docs/launch-readiness/operator-runbook.md` describes both states.
- Print and share of a company report: see section 1.

## 6. The /status checks

- What it is: `/status` ("Build status"). It shows what is built, what is gated, and a section "Does each tool work?" (`src/js/91-health.js` header) with two kinds of evidence: (a) checks run in the reader's browser when the page opens (the property model on a fixed deal, the scanner engine's self-test, Apple's filed statements through the equities pipeline, and whether the data files are served); (b) the recorded result of complete journeys on the live site, `health/journeys.json`, and the CI record `health/checks.json`.
- Journeys: 29 are recorded in `health/journeys.json` at this commit (ids: equities, screener, compare, property-phone, property, quick, lab, evidence, newdev, commercial, routes, refurb, costs, property-flow, journey-bar, map, scanner, return, records, registers, cases, settings, backup, replay, research-case, corrections, submission, enquiry, ctas). Definitions: `journeys.mjs`.
- CI suites recorded: model-test, equity-test, register-test, scanner-test, ingest-test, history-store-test, data-check, register-check, served-check-data, served-check, build-check, prerender-check, sweep, coverage-frames, mobile (`health/checks.json`). A suite with no result reads "Not run for <commit>", never Pass (`checks-record.mjs` header).
- Steps for a reader: open `/status`; read the browser checks; read the recorded journey table with its commit and time; read the CI record for the served commit.
- Source: `src/js/91-health.js`, `journeys.mjs`, `checks-record.mjs`, `.github/workflows/journeys.yml`, `.github/workflows/checks.yml`, `.github/workflows/checks-record.yml`.
