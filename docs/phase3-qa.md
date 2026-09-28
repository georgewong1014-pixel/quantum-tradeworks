# Phase 3 — scanner QA: the twenty-four checklist items and their checks

*Written 28 September 2026 for SC-319 (docs/phase3-plan.md). Each item of the
Phase 3 brief's QA checklist is listed with the automated check that covers
it — the file, and the phrase that opens the check's `ok` line, so a search
for the phrase finds the check — or with the reason no check can exist yet.
Nothing is marked covered because the code looks right; an item is covered
when a check that would fail on the defect runs in CI.*

*Round 2 was built by three batches at once. Checks written by the
data-and-worker batch and the setups-and-alerts batch are named below as
**expected** — what the plan asks of them — and are verified against their
files when the branches merge. Everything else is in the tree now.*

## How to run them

Offline, no browser (the CI `static` job):

```bash
node build.mjs && node syntax.mjs && node build.mjs --check && node wording-check.mjs \
  && node scanner-test.mjs && node ingest-test.mjs && node register-check.mjs
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
| 1 | Valid OHLCV ingests | partial | scanner-test.mjs — *history v2 is read additively*; ingest-test.mjs — *history-import leaves a blank volume cell unrecorded and keeps a written 0*. **Expected** (data-and-worker batch): the history store's merge tests in ingest-test.mjs. **Blocked:** a validated OHLCV feed — the history is the reader's own closes and volumes; open, high and low only where their source has them. |
| 2 | Invalid and duplicate candles rejected | covered for invalid; duplicates impossible | scanner-test.mjs — *scanValidateBar: each of BAD_DATE, FUTURE, NEG_PRICE, NEG_VOLUME, HIGH_BELOW, LOW_ABOVE and NON_SESSION_DAY*; *"junk", "2026-1-10" and a zero close are listed as invalid*; *scanDataHealth: a zero close and a bad key counted as dropped*; equity-test.mjs — *the operations pages render the worker files read-only* (the data-health page). A duplicate bar cannot exist: the history is keyed by date. **Expected:** the history store's source-rank conflict policy and recorded corrections. |
| 3 | Holidays and incomplete sessions handled | partial | scanner-test.mjs — *six MY series all without 2026-08-31 make it an inferred holiday*; *on the weekday calendar a fifteen-day hole is missing sessions*; *a week in progress (Monday to Wednesday held) is incomplete and PROVISIONAL*. **Blocked:** exchange calendars (holidays, half-days) — sessions are inferred from the reader's own series and labelled inferred on every page that uses them. |
| 4 | Stale and provisional data cannot trigger confirmed alerts | covered | scanner-test.mjs — *a provisional bar never confirms*; *STALE_DATA STALE: a history ending in April judged on 28 September*; *the self-test keeps its guarantee* (none on a stale clock). A provider's finality flag is blocked (item 13); a bar is final by the clock. |
| 5 | EMA and SMA match independent references | partial | scanner-test.mjs — *every indicator equals a naive textbook implementation bar for bar*; *EMA2 of 2, 4, 6, 8, 4 by hand*; *SMA3 of 1..5 is null, null, 2, 3, 4*. **Not yet:** a committed reference file from a third-party library — none was available to generate one. |
| 6 | RSI and MACD initialisation consistent | covered | scanner-test.mjs — *Wilder RSI14 on the StockCharts worksheet closes*; *Wilder smoothing: fourteen +1 changes then one −1*; *MACD(2,3,2) on 10, 12, 11, 13, 15, 14 by hand*; *the MACD line needs the slow average only* |
| 7 | Missing history returns unavailable | covered | scanner-test.mjs — *INSUFFICIENT_DATA NEEDS_BARS*; *INSUFFICIENT_DATA MISSING_SESSION*; *a crossing of a 50-bar EMA on 20 bars is untested and says it needs 51* |
| 8 | Corporate-action adjustments handled consistently | **blocked**; detection covered | scanner-test.mjs — *scanDataHealth: … a halving tagged a 2-for-1 split*. **Blocked:** no adjustment data is held; a break is tagged on the data-health page and in historical coverage, never corrected, and the simulation label says closes are unadjusted. |
| 9 | Crossovers use previous and current completed candles | covered | scanner-test.mjs — *a crossing reads the previous and current completed bars*; *price already above 3 on the previous bar does not cross it again* |
| 10 | AND and OR groups evaluate correctly | covered | scanner-test.mjs — *ALL and ANY follow Kleene's three-valued logic*; *AND with one untested rule is not a match*; *OR matches on the rule that could be tested* |
| 11 | Invalid operand combinations rejected | covered | scanner-test.mjs — *unit pairs × 8 operators — same units validate, different units are UNIT_MISMATCH*; *literals are checked against the operand's domain*; *an operand that would be ignored is refused EXTRA_OPERAND* |
| 12 | Identical inputs give identical results | covered | scanner-test.mjs — *determinism: the engine sliced from index.html twice gives byte-identical runs*; equity-test.mjs — *the page runs the same market engine as the worker* |
| 13 | Daily jobs run only after final data | partial | scanner-test.mjs — *bar status: MY 08:30Z is before 17:00 + 30m local (PROVISIONAL)*; *readiness per market: READY when the expected session is held final*. The operations overview shows each market's readiness. **Blocked:** a provider's confirmation that a session is final — no provider exists. |
| 14 | Repeated jobs do not duplicate alerts | covered | scanner-test.mjs — *the same bar is not recorded twice*; *a second run on the same bar matches again and records nothing new*; *the first 0.3.0 run over a 0.2.0 alerts file records nothing already recorded* |
| 15 | Failed jobs retry safely | partial | scanner-test.mjs — *an unreadable alerts file is left alone and the run exits 1*; *the record is written beside itself and renamed over*. **Expected** (data-and-worker batch): the run log on every exit path, `--retry`, and a failed-then-retried run equal to a clean one. The runs page lists each failure with its exact retry command — equity-test.mjs — *the operations pages render the worker files read-only*. |
| 16 | Universes resolve correctly | covered | scanner-test.mjs — *a symbols universe matches case-insensitively*; *a market universe reads the instrument registry*; *a watchlist universe evaluates the symbols it snapshotted*; equity-test.mjs — *market screening lists your own series in symbol order, never by value* |
| 17 | Email failures do not erase alerts | **blocked** | There is no email (SC-309: server, operating entity, PDPA notice). The alert is the record and is written before anything else; the delivery page lists email as not configured — equity-test.mjs — *the operations pages render the worker files read-only*. |
| 18 | Retries do not duplicate deliveries | **blocked** | Nothing is delivered, so nothing can be delivered twice. The nearest guarantee is item 14's key. |
| 19 | Users cannot access others' setups or alerts | **blocked** | There are no users. The nearest checks: scanner-test.mjs — *neither scanner data file is tracked by git*; register-check.mjs — *robots.txt keeps the scanner and operations paths out of crawlers*. The operations pages say they are visible to anyone who opens them and hold nothing on the deployed site. |
| 20 | Admin replay audited | partial | equity-test.mjs — *the operations pages render the worker files read-only* (the control log: three entries from the fixture, each with time, action and arguments). **Expected** (data-and-worker batch): `--as-of` replay deduplicated and appended to the log. **Blocked:** an audit with an operator identity — no accounts; the log is a local append-only file and the page says so. |
| 21 | Builder creates and edits valid rules | expected | **Expected** (setups-and-alerts batch): the builder on the rule tree at /app/scanner/setups/new and its edit round-trip at /app/scanner/setups/:setup/edit. |
| 22 | Dashboard shows persisted status | covered | equity-test.mjs — *the dashboard answers from persisted records in every state* (never, current, behind, failed, paused from injected run records; a stale result never under a current heading); scanner-test.mjs — *scanStatus: no runs and no last run is "never"*; *the local case — a scan run on 27 September on bars of 7 August — is behind*; *behind after a setups edit; failed (not current) when a failure follows a success* |
| 23 | Alert history and details resolve | expected | **Expected** (setups-and-alerts batch): /app/scanner/alerts and /app/scanner/alerts/:alert. The dashboard's matches link to `/app/scanner/alerts/a<hash>` — equity-test.mjs — *the dashboard answers from persisted records in every state* (counts the links). |
| 24 | Mobile, keyboard and empty states pass | covered for these pages | mobile.mjs — *no horizontal overflow at any width* over /app/scanner, /market, /backtest, /admin/scanner, /jobs and /data at 360–1440, and the six-item header at 360 (each link inside the viewport and 44px tall); equity-test.mjs — *the scanner pages state which file is absent*; sweep.mjs — the *Phase 3 — the scanner* block. **Expected:** the builder's focus walk (setups-and-alerts batch). |

## Beyond the twenty-four

| Case | Check or blocker |
|---|---|
| Provider outages | The last ingestion and each step's outcome from data/ingest-runs.json on /admin/scanner (equity-test — *the operations pages render the worker files read-only*); a signed-out capture is reported STALE by the daily task. **Expected:** daily.mjs writing the log (data-and-worker batch). |
| Delayed data | scanner-test — *the local case — a scan run on 27 September on bars of 7 August — is behind*; the dashboard's *behind* state. |
| Concurrent workers | **Expected** (data-and-worker batch): the lock, SKIPPED_LOCKED and a dead-lock takeover. The runs page shows a SKIPPED_LOCKED run from the fixture. |
| Large watchlists | scanner-test — *a large universe: 400 instruments × 300 bars*. Market screening is bounded at 2,000 instruments and historical testing at 600 bars an instrument, both chunked so the tab stays live. |
| Expired subscriptions | **Blocked:** there are no subscriptions. |
| Channel failures | **Blocked:** there are no channels but in-app. |

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
