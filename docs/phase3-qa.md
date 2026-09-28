# Phase 3 — scanner QA: the twenty-four checklist items and their checks

*Written 28 September 2026 for SC-319 (docs/phase3-plan.md). Each item of the
Phase 3 brief's QA checklist is listed with the automated check that covers
it — the file, and the phrase that opens the check's `ok` line, so a search
for the phrase finds the check — or with the reason no check can exist yet.
Nothing is marked covered because the code looks right; an item is covered
when a check that would fail on the defect runs in CI.*

*Round 2 was built by three batches at once. The checks this page first named
as expected from the data-and-worker and setups-and-alerts batches were
matched against their files when the branches merged; every check named below
is in the tree.*

## How to run them

Offline, no browser (the CI `static` job):

```bash
node build.mjs && node syntax.mjs && node build.mjs --check && node wording-check.mjs \
  && node scanner-test.mjs && node ingest-test.mjs && node history-store-test.mjs \
  && node register-check.mjs
```

In a browser, against a local server (the CI `runtime` job), one harness at a
time, with `CDP_PORT` pinning the debugging port:

```bash
node serve.mjs --port 8123 &
node equity-test.mjs http://localhost:8123   # the scanner pages from injected records and fixtures
node sweep.mjs http://localhost:8123         # every route renders, the Phase 3 block included
node mobile.mjs http://localhost:8123        # 360–1440px, the six-item header at 360
```

`node register-check.mjs --release phase3` asks whether Phase 3 is complete.
It fails today, by design, and says why in two lists: the P0 items blocked by
decision (SC-301 authorised data, SC-309 email) and the P0 rows still partial.

The operations pages' fixtures are committed at `scanner/fixtures/`
(`scan-runs`, `scan-control`, `scan-deliveries`, `ingest-runs`). They are read
by equity-test and injected into the page; nothing is ever written to `data/`.

## The twenty-four items

| # | Item | Status | Check (file — phrase) or blocker |
|---|---|---|---|
| 1 | Valid OHLCV ingests | partial | scanner-test.mjs — *history v2 is read additively*; *history-import leaves a blank volume cell unrecorded and keeps a written 0*; history-store-test.mjs — *a refused row never reaches the history*; *two rows for one date in one batch are both refused*; *the same merge twice changes nothing the second time*; *two processes writing the history at once lose nothing*. **Blocked:** a validated OHLCV feed — the history is the reader's own closes and volumes; open, high and low only where their source has them. |
| 2 | Invalid and duplicate candles rejected | covered for invalid; duplicates impossible | scanner-test.mjs — *scanValidateBar: each of BAD_DATE, FUTURE, NEG_PRICE, NEG_VOLUME, HIGH_BELOW, LOW_ABOVE and NON_SESSION_DAY*; *"junk", "2026-1-10" and a zero close are listed as invalid*; *scanDataHealth: a zero close and a bad key counted as dropped*; equity-test.mjs — *the operations pages render the worker files read-only* (the data-health page). A duplicate bar cannot exist: the history is keyed by date, and history-store-test.mjs — *two rows for one date in one batch are both refused*; *the source rank is explicit*; *the engine reads a recorded correction as a CORRECTED bar*. |
| 3 | Holidays and incomplete sessions handled | partial | scanner-test.mjs — *six MY series all without 2026-08-31 make it an inferred holiday*; *on the weekday calendar a fifteen-day hole is missing sessions*; *a week in progress (Monday to Wednesday held) is incomplete and PROVISIONAL*. **Blocked:** exchange calendars (holidays, half-days) — sessions are inferred from the reader's own series and labelled inferred on every page that uses them. |
| 4 | Stale and provisional data cannot trigger confirmed alerts | covered | scanner-test.mjs — *a provisional bar never confirms*; *STALE_DATA STALE: a history ending in April judged on 28 September*; *the self-test keeps its guarantee* (none on a stale clock). A provider's finality flag is blocked (item 13); a bar is final by the clock. |
| 5 | EMA and SMA match independent references | partial | scanner-test.mjs — *every indicator equals a naive textbook implementation bar for bar*; *EMA2 of 2, 4, 6, 8, 4 by hand*; *SMA3 of 1..5 is null, null, 2, 3, 4*. **Not yet:** a committed reference file from a third-party library — none was available to generate one. |
| 6 | RSI and MACD initialisation consistent | covered | scanner-test.mjs — *Wilder RSI14 on the StockCharts worksheet closes*; *Wilder smoothing: fourteen +1 changes then one −1*; *MACD(2,3,2) on 10, 12, 11, 13, 15, 14 by hand*; *the MACD line needs the slow average only* |
| 7 | Missing history returns unavailable | covered | scanner-test.mjs — *INSUFFICIENT_DATA NEEDS_BARS*; *INSUFFICIENT_DATA MISSING_SESSION*; *a crossing of a 50-bar EMA on 20 bars is untested and says it needs 51* |
| 8 | Corporate-action adjustments handled consistently | covered for recorded splits; dividends **blocked** | scanner-test.mjs — *scanDataHealth: … a halving tagged a 2-for-1 split*; *round 3 data: once the split is recorded the same RSI is VALID*; *round 3 data: an RSI window across an unrecorded 4-for-1 split is INVALID_INPUT UNADJUSTED_BREAK*; *round 3 data: adjusting twice is refused*; *round 3 data: the worker reads data/price-adjustments.json beside the history*; *integration: --backtest applies the splits recorded beside the history*; equity-test.mjs — *round 3 data: the data page names a gap, a zero close, a split*; *integration: an opened history carries the recorded splits*. The page, the worker, the simulation and the command read the same recorded actions. **Blocked:** a corporate-action source — only the splits and consolidations the reader records are applied, never dividends, and a break nobody recorded leaves every indicator window across it unavailable. |
| 9 | Crossovers use previous and current completed candles | covered | scanner-test.mjs — *a crossing reads the previous and current completed bars*; *price already above 3 on the previous bar does not cross it again* |
| 10 | AND and OR groups evaluate correctly | covered | scanner-test.mjs — *ALL and ANY follow Kleene's three-valued logic*; *AND with one untested rule is not a match*; *OR matches on the rule that could be tested* |
| 11 | Invalid operand combinations rejected | covered | scanner-test.mjs — *unit pairs × 8 operators — same units validate, different units are UNIT_MISMATCH*; *literals are checked against the operand's domain*; *an operand that would be ignored is refused EXTRA_OPERAND* |
| 12 | Identical inputs give identical results | covered | scanner-test.mjs — *determinism: the engine sliced from index.html twice gives byte-identical runs*; equity-test.mjs — *the page runs the same market engine as the worker* |
| 13 | Daily jobs run only after final data | partial | scanner-test.mjs — *bar status: MY 08:30Z is before 17:00 + 30m local (PROVISIONAL)*; *readiness per market: READY when the expected session is held final*. The operations overview shows each market's readiness. scanner-test.mjs — *SC-301 --ready: a history whose MY last bar is PROVISIONAL*; *SC-301 daily.mjs passes --ready, names each market held back*: the daily run holds back a market whose session is not final by the clock while the others run. **Blocked:** a provider's confirmation that a session is final — no provider exists. |
| 14 | Repeated jobs do not duplicate alerts | covered | scanner-test.mjs — *the same bar is not recorded twice*; *a second run on the same bar matches again and records nothing new*; *the first 0.3.0 run over a 0.2.0 alerts file records nothing already recorded* |
| 15 | Failed jobs retry safely | covered | scanner-test.mjs — *an unreadable alerts file is left alone and the run exits 1*; *the record is written beside itself and renamed over*; *a run is logged in scan-runs.json: PENDING, RUNNING, then COMPLETED*; *exit codes: 0 COMPLETED, 1 FAILED, 2 PARTIAL, 3 SKIPPED*; *--retry RUNID re-runs the failed scan on its own session dates*; *a retry of a completed run adds nothing*. The runs page lists each failure with its exact retry command — equity-test.mjs — *the operations pages render the worker files read-only*. |
| 16 | Universes resolve correctly | covered | scanner-test.mjs — *a symbols universe matches case-insensitively*; *a market universe reads the instrument registry*; *a watchlist universe evaluates the symbols it snapshotted*; equity-test.mjs — *market screening lists your own series in symbol order, never by value* scanner-test.mjs — *SC-311 the worker reads data/watchlists.json at run time*; *SC-311 with the export missing, or without the list, the worker falls back to the snapshot*. |
| 17 | Email failures do not erase alerts | **blocked** | There is no email (SC-309: server, operating entity, PDPA notice). The alert is the record and is written before anything else; the delivery page lists email as not configured — equity-test.mjs — *the operations pages render the worker files read-only*. |
| 18 | Retries do not duplicate deliveries | **blocked** | Nothing is delivered, so nothing can be delivered twice. The nearest guarantee is item 14's key. |
| 19 | Users cannot access others' setups or alerts | **blocked** | There are no users. The nearest checks: scanner-test.mjs — *neither scanner data file is tracked by git*; register-check.mjs — *robots.txt keeps the scanner and operations paths out of crawlers*. The operations pages say they are visible to anyone who opens them and hold nothing on the deployed site. |
| 20 | Admin replay audited | partial | scanner-test.mjs — *--as-of DATE records exactly the alerts a run on the history cut at DATE records, marked origin replay*; *replaying the same date again adds nothing*; equity-test.mjs — *the operations pages render the worker files read-only* (the control log: three entries from the fixture, each with time, action and arguments). scanner-test.mjs — *SC-307 --as-of DATE --setup ID replays one setup*; *SC-307 a retry of a narrowed replay keeps its narrowing and adds nothing*. **Blocked:** an audit with an operator identity — no accounts; the log is a local append-only file and the page says so. |
| 21 | Builder creates and edits valid rules | covered | equity-test.mjs — *the scanner builder writes valid rules and refuses invalid ones*; *scanner versions bump on evaluation fields only*; *the scanner export round-trips*; *the scanner builder works from the keyboard*. |
| 22 | Dashboard shows persisted status | covered | equity-test.mjs — *the dashboard answers from persisted records in every state* (never, current, behind, failed, paused from injected run records; a stale result never under a current heading); scanner-test.mjs — *scanStatus: no runs and no last run is "never"*; *the local case — a scan run on 27 September on bars of 7 August — is behind*; *behind after a setups edit; failed (not current) when a failure follows a success* |
| 23 | Alert history and details resolve | covered | equity-test.mjs — *scanner alert status persists across a reload*; *a scanner alert's page resolves from its id*; *the dashboard answers from persisted records in every state* (counts the links to `/app/scanner/alerts/a<hash>`). equity-test.mjs — *round 3 user: an alert id two records share lists both*; *round 3 user: an alert is evaluated again on the history cut at its bar*; *round 3 user: the alert history pages, filters and orders 250 injected records by date alone*. |
| 24 | Mobile, keyboard and empty states pass | covered | mobile.mjs — *no horizontal overflow at any width* over /app/scanner, /market, /backtest, /setups, /setups/new, /watchlists, /alerts, /settings, /admin/scanner, /jobs and /data at 360–1440, and the six-item header at 360 (each link inside the viewport and 44px tall); equity-test.mjs — *the scanner pages state which file is absent*; sweep.mjs — the *Phase 3 — the scanner* block; equity-test.mjs — *the scanner pages state their empty cases*; *the scanner builder works from the keyboard*. |

## Beyond the twenty-four

| Case | Check or blocker |
|---|---|
| Provider outages | The last ingestion and each step's outcome from data/ingest-runs.json on /admin/scanner (equity-test — *the operations pages render the worker files read-only*); a signed-out capture is reported STALE by the daily task; scanner-test — *daily.mjs never starts the scanner when the history step failed, says so, and logs the run in data/ingest-runs.json*. |
| Delayed data | scanner-test — *the local case — a scan run on 27 September on bars of 7 August — is behind*; the dashboard's *behind* state. |
| Missed daily runs | scanner-test — *SC-307 the worker catches up*; *SC-307 catch-up stops at ten bars and prints the bars it did not read*; *SC-307 the catch-up run records exactly what three separate daily runs record*. Beyond ten bars, --as-of replays the days the run names. |
| Concurrent workers | scanner-test — *a fresh lock held by a live process turns a run away*; *a lock whose process is dead is taken over and the takeover audited*; *a lock over an hour old is taken over as stale*; history-store-test — *two processes writing the history at once lose nothing*. The runs page shows a SKIPPED_LOCKED run from the fixture. |
| Large watchlists | scanner-test — *a large universe: 400 instruments × 300 bars*. Market screening is bounded at 2,000 instruments and historical testing at 600 bars an instrument, both chunked so the tab stays live. scanner-test — *SC-319 the planned budget: 2,000 instruments × 500 bars*; *SC-316 / SC-319 the order of evaluation is independent of values*. |
| Expired subscriptions | **Blocked:** there are no subscriptions. |
| Channel failures | scanner-test — *a delivery record that cannot be written leaves the alert recorded and the run PARTIAL (exit 2) with a DELIVERY error*. **Blocked:** any channel but in-app. |

## What the register says

The capability register (src/js/80-registers.js, at /status) carries one row
per item of docs/phase3-plan.md §1 — SC-301…SC-319 and SC-NAV (the plan's NAV
row, renamed so it cannot merge with Phase 2's). register-check.mjs now reads
both plans and adds two rules: a **P2** row (SC-317 intraday, SC-318 push) has
no path and is neither operational nor flagged; and robots.txt disallows every
route under /app/scanner and /admin. SC-314 (historical matches) and SC-316
(market screening) are P1 and **flagged**, and their pages carry the notice.
SC-301, SC-309 and SC-315 are gated with no path. The setup builder, setup
persistence and alert history rows are queued in this branch and take their
paths and checks from the setups-and-alerts batch at merge. No row is
complete.
