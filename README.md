# Quantum Tradeworks

A Malaysia-first cross-asset **research** prototype covering US and Bursa Malaysia
equities alongside Malaysian property.

> **Research only.** This product provides analysis, evidence and tools. It does
> not provide investment advice, personal recommendations, ratings, target prices
> or a suitability assessment, and it does not execute trades. See the scope
> statement in the app under **Plans** or **Learn → Corrections & model changes**.

---

## ⚠️ Financial data comes from two places, and neither carries a price

This said "every figure is fabricated" for as long as that was true. It stopped
being true when audited filings loaded beside the sample set, and a warning that
overstates the problem is still a warning that is wrong.

What the deployed site actually holds:

| | Count | What it is |
|---|---|---|
| **US companies, filed** | 119 | Audited annual statements from SEC EDGAR's XBRL `companyfacts`. Real. |
| **US company, illustrative** | 1 | PGR (Progressive). Financials and price are synthetic. |
| **Malaysian companies** | 18 | Illustrative. Financials are synthetic, listing codes are real. |

138 companies in all: 120 US-listed and 18 Bursa-listed by market; 119 filed and
19 illustrative by source. Not every illustrative company is Malaysian — the app
states the same two axes wherever it counts the universe.
| **Prices** | 0 | No market-data licence is in place for either exchange. |

Every company page states which of the two it is. A filed company carries no price
at all, so everything price-derived — market capitalisation, multiples, yield,
difference to model estimate — is shown as unavailable rather than estimated, and
its valuation pillar reports no coverage rather than a default score. Where a
price, market capitalisation or yield does appear it belongs to an illustrative
company and is part of that synthetic dataset; it is not a quote.

Share counts are filed unadjusted for splits and no corporate-action source is
licensed, so on the 26 US companies whose series contains one, share-count CAGR
and net buyback yield are withheld and the discontinuity is named on the page. A
CAGR across a split measures the split — it read Apple's four-for-one as "share
count rising 12.0% a year", the reverse of the truth.

**Do not use any number here for an investment decision.** A production
deployment would require licensed market data for both markets and, in Malaysia,
written legal classification of each surface under the Capital Markets and
Services Act before launch.

---

## Run it

The deployed site is static files assembled from `src/` by `build.mjs` and
committed, so the host needs no build step: `index.html`, one self-contained
HTML file with the app inline, and for every other address a small page (its
own head, about 23kB) that loads the same script and stylesheet once from
`assets/app.<hash>.js` and `.css`. After editing anything under `src/`, run
`node build.mjs` and commit the result; CI fails if any of them drifts from
its source.

```bash
node serve.mjs            # http://localhost:8123
```

Screenshot tooling (drives locally installed Chrome/Edge over the DevTools
Protocol; no dependencies):

```bash
node screenshot.mjs http://localhost:8123 home
node screenshot.mjs http://localhost:8123 home-dark --dark
node screenshot.mjs http://localhost:8123 home-mobile --width 390 --height 844
```

Output goes to `./temporary screenshots/` (git-ignored).

## Checking a deployment

```bash
node deploy-check.mjs          # one check: exit 0 if production serves this file
node deploy-check.mjs --wait   # poll until it matches, or time out
```

It compares the **whole file**, not a marker string. The repository stores LF
(`.gitattributes` pins `eol=lf`) and the CDN serves LF; newlines are still
normalised, as a defence against a CRLF working copy on Windows, and nothing
else is excused. After that the two are byte-identical, so nothing is injected
in transit.

**Do not verify a deployment by grepping the served HTML for a string from the
change.** That method cannot merely fail, it produces false positives by
construction: if the string already existed — added by an earlier commit,
present in a comment, or a name the new code reuses — the grep passes against a
stale bundle. That happened here. A check polled for a symbol the *previous*
commit had shipped, reported "deployed" in ten seconds, and production served
the old file for twenty minutes until an empty commit forced a real deployment:

```bash
git commit --allow-empty -m "chore: trigger redeploy"
```

## Does each tool work? — journeys and /status

Every other check here looks at a page. `journeys.mjs` walks the paths a
reader takes, in real Chrome, by real clicks and key presses, and passes a
journey only when the whole path completes — entry, valid input, the
calculation or data, a meaningful result, the save or next action:

| Journey | The path |
| --- | --- |
| `equities` | search "apple" → Apple's company page → Financials: the filed statements, and a figure's source (SEC EDGAR, the CIK, the XBRL concept) → Add to watchlist → the watchlist lists it |
| `screener` | a filter (return on equity ≥ 20) → the count changes → open a result → its company page |
| `property` | the calculator: price, rent, loan → monthly cash flow, yield and cash required appear, and move with the rent and the loan → save → listed with the saved properties |
| `scanner` | the builder: a condition (price crosses above its 20-bar EMA, on AAPL) → save → the setup's page shows it → its own evaluation |
| `ctas` | every homepage card, the header's Open workspace, each product tab row link and the dashboard's first-time checklist: each lands on a working page (not a 404, not the not-found card, no console error) |

Each journey is **PASS**, **DEGRADED** (completed, but a step was over its
stated budget or a part the path does not depend on failed — the note says
which) or **FAIL** (the step and the route named). The exit code is 0 unless
a journey fails.

```bash
node journeys.mjs http://localhost:8123          # local: see below
node journeys.mjs --url production               # the live site
node journeys.mjs --url production --json out.json --markdown out.md
node journeys.mjs --self-test                    # offline: the commit rule and the result's shape
```

**It never reads your personal files.** On your machine the page asks
`serve.mjs` for the git-ignored personal lane (price history, scanner records,
prices); a journey answers every such request 404 inside the browser, so it
behaves as the deployed site does. The one exception: on a local run the
scanner journey is served a *synthetic* price history, made in the page from
the engine's own fixture and dated to end on the session the engine expects
now, so its evaluate step must find a match. Against the deployed site there
is no history, and the step instead holds the page to saying so.

**Where the results go.** `.github/workflows/journeys.yml` runs it against the
live site after every successful production deployment (Vercel's
`deployment_status` events), nightly at 03:17 UTC, and by hand. It writes the
job summary, keeps one issue titled *Production journeys failing* open while a
journey fails and closes it on the next all-pass run, and commits
`health/journeys.json` to main — only when a status or a failing step changed
or the recorded run is a day old, with `[skip ci]`. The deployment of that
commit runs the journeys again, finds the same results, and commits nothing.
CI runs the journeys against `serve.mjs` on every push.

**/status shows both halves** under *Does each tool work?* (`src/js/91-health.js`):
checks run in the reader's browser when the page opens — the property model on
a deal worked by hand, the scanner engine's self-test, Apple's filed statements
through the pipeline against its 10-K, and whether each data file is served and
loaded (a heavier set behind *Run the full checks*) — and the latest recorded
journeys, read from `health/journeys.json` with `no-store`. The file is served
`no-cache`, is not versioned by the build (so `build --check` never depends on
it), and until the first run it is a placeholder the page reads as *not run
yet*.

## Structure

```
.
├── src/              # the source: js/*.js in load order, styles.css, index and vercel templates
├── build.mjs         # assembles index.html, 404.html, pages/, assets/ and vercel.json (with the CSP hash) from src/
├── index.html        # the entire deployed application, script and styles inline — generated, committed
├── assets/           # index.html's inline script and stylesheet, once each, as app.<sha-256 prefix>.js/.css — generated, committed
├── pages/            # a small page per route without a parameter: that route's own <head>, loading assets/ — generated, committed
├── 404.html          # the same small page with the not-found head and noindex, served with status 404 — generated, committed
├── vercel.json       # host rewrites (one per route, generated from ROUTES), redirects and headers — generated, committed
├── data/             # committed datasets (us.json, instruments.json, …); licensed and personal files are git-ignored
├── serve.mjs         # zero-dependency static server, answering from vercel.json as Vercel does
├── served-check.mjs  # what each address is served, over HTTP: heads, 404s, redirects, headers (--url for production)
├── screenshot.mjs    # zero-dependency screenshot tool (CDP over Node's WebSocket)
├── syntax.mjs, wording-check.mjs, scanner-test.mjs, ingest-test.mjs   # offline checks
├── sweep.mjs, mobile.mjs, coverage-frames.mjs, register-test.mjs,
│   model-test.mjs, equity-test.mjs                                    # browser harnesses
├── journeys.mjs      # complete user journeys in real Chrome, locally or against the live site (--url production)
├── health/           # journeys.json: the latest recorded journeys against the live site, read by /status — written by .github/workflows/journeys.yml
├── ingest/, scanner/, qtti/   # data ingest, the setup scanner, the trading-index tools
└── package.json      # npm scripts for all of the above; devDependencies xlsx (NAPIC ingest) and sharp (renders)
```

## What is in it

**Equities research** — 138 companies as deployed: 119 US filers with audited
statements, one illustrative US company (PGR) and 18 illustrative Bursa
companies. Raw statement lines are stored
once per company and every ratio, score and valuation is derived at runtime, so
each number can show its own formula and inputs.

- Nine valuation methods, routed to a model pack by business model (FCFF,
  mid-cycle normalised, scenario, FCFE, residual income, distribution discount,
  earnings power value, peer multiple, asset floor)
- Scorecards that decompose to weighted inputs, anchor ranges and peer percentiles
- Screener with explain-exclusion and sector/market medians
- Value Radar with a point-in-time slider that re-runs the whole derivation
- Thesis builder with invalidation conditions evaluated against live data
- Ten-year financial history, Bursa specialisation (Shariah, PN17, CET1/NPL)

**QT Trading Index** (`/research/trading-index`) — a separate timing module,
because trend is the only evidence some instruments have. An index ETF has no
return on equity and a perpetual contract is not an ownership claim, so routing
either through the Strategy Lens returns U forever — which reads as "assessed
and found wanting" when the truth is that no question applied. The fundamental
gate is therefore replaced rather than removed: an ordinary share still clears
its Strategy Lens tier, everything else clears an asset-thesis gate (mandate,
issuer, liquidity, custody).

Three numbers, never blended — trend regime, first-tranche readiness against
rules you declared, and how much of either your screenshot can support. Weights
are 40% monthly / 35% weekly / 25% daily, which is arithmetic encoding a
discipline: a perfect daily 100 against a bearish monthly and weekly reaches
54.25 and can never read "confirmed uptrend". It carries **0% weight in the
research composite**.

The page does not read your screenshot: you record what you saw. A phase-2
extraction script exists (`qtti/extract.mjs`, below) and produces a draft that a
person must confirm before anything is scored. No indicator here has been
validated on point-in-time data, so none is claimed to work. The specification's worked example loads as a fixture and
reproduces its published 38 / 35 / 77 exactly; 23 acceptance tests cover §21.

### Running a weekly batch

The page is the single-asset deep dive. For a weekly pass over many assets, the
batch runner scores them all from one file:

```bash
node qtti/batch.mjs --check     # self-test only
node qtti/batch.mjs             # score qtti/observations.json
```

Copy `qtti/observations.example.json` to `qtti/observations.json` and edit it.
That path is git-ignored, along with `qtti/screenshots/` and `qtti/out/` — your
reading of your own charts stays on the machine, and the chart images are
somebody else's licensed data rendered as pixels, exactly like `watchlist-shots/`.

**It does not carry its own copy of the engine.** It slices `index.html` between
`@qtti-engine-start` and `@qtti-engine-end` and evaluates that region in Node, so
the batch and the page cannot score differently. Two copies of a scoring model
drift apart and then disagree about which number is right — this repository has
found that defect in itself more than once.

Extraction by marker can fail quietly, so **every run first scores the
specification's own worked example and refuses to continue unless it returns
38 / 35 / 77**. Verified against all three failure modes: markers removed, engine
truncated by a moved marker, and a single component weight changed from 0.25 to
0.30 — the last is caught only by the self-test, which is the point of it.

Rows come out **in input order, never sorted by score**. A weekly table of fifty
assets ranked by trend score is a pick list whatever it is titled, this product
does not name a screen "Top Picks", and Malaysia's SC treats algorithmic ranking
as advice for licensing purposes. Sort the CSV yourself if you want to.

### Screenshot extraction (§22 phase 2)

```bash
node qtti/extract.mjs --simulate         # see the shape, no key, no call (needs one image in qtti/screenshots/)
node qtti/extract.mjs --print-request    # inspect the exact model contract
ANTHROPIC_API_KEY=… node qtti/extract.mjs
```

Reads every image in `qtti/screenshots/` and writes `qtti/observations.draft.json`.
The prompt is §15.2 verbatim — including the two rules that matter most, that an
indicator must not be inferred from its colour and that oversold is not bullish.

**It produces a draft, never a score.** Every asset lands `confirmed: false`, and
`batch.mjs` will not score one until a person has read it against the image and
changed that; it exits 2 if any remain, so a scheduled run cannot report success
while half the week sat unconfirmed. Reading a chart badly and reading it well
produce equally confident JSON, and the only thing between the two is somebody
looking. `identityConsistent` is never set true by extraction — §5.4 makes panel
identity a rejection gate, and a model saying the panels match is not a person
having checked.

The model returns **ordinal states only**, never the analyst numbers §14 uses —
those are a human refinement within the scale, and a model emitting 65 rather
than "bullish" would be inventing precision the image cannot support. Unknown is
a first-class answer: it costs coverage rather than being reweighted away, which
is exactly §6's rule that a partly legible chart must not look decisive.

Verified without an API call, via `--simulate`: draft → refused, exit 2; then
confirmed → scored, and correctly refused on evidence because the simulated
capture has no monthly panel. `qtti/observations.draft.json` is git-ignored.

**Property Deal Check** — turns a property into a financial model: true
acquisition cost with Malaysian stamp duty scales, financing, vacancy,
maintenance, NOI, cash-on-cash, DSCR, ten-year scenarios, exit costs with RPGT,
and a comparison against putting the same cash into equities.

**Not an official valuation.** In Malaysia that requires a registered valuer.

**Trade-setup scanner** (`/my/scanner`) — conditions you define, evaluated on
price history you supplied, producing a record of which conditions held on
which daily bar — the last one your history holds, so run the capture after the close. Every clause of that sentence is a boundary. The
rules are yours: nothing is proposed and nothing is ranked. The data is yours:
`data/price-history.json`, built from your own screen under your own
subscription — no feed is licensed to this product, so it scans nothing else
and is offered to nobody else. The output is a record, not a signal: no
indicator here has been validated on point-in-time data, so none is claimed
to work. And nothing is delivered: there is no server, so no email, Telegram
or push.

Indicators: price, volume, SMA, EMA, RSI (Wilder), MACD line / signal /
histogram, average volume with a multiplier. Operators: above, below, crosses
above, crosses below, between. A rule whose indicator needs more bars than an
instrument holds is **untested** for it — a third state, never met or failed —
and an AND setup with an untested rule cannot match.

Volume and average volume need a recorded volume, and the screen capture
(`ingest/daily.mjs`) records closes only. Every writer of the history goes
through `ingest/history-store.mjs` (see [ingest/README.md](ingest/README.md)):
bars validated by the engine, a source rank (an export or a provider outranks
the screen), open/high/low kept wherever the source has them, and each bar
dated by its exchange's session and stamped with when it was captured. Volume reaches the history from
`ingest/live.mjs` or from an export imported with a volume column
(`ingest/history-import.mjs`). A volume rule is untested on a bar with no
recorded volume — so on history built by the screen capture alone, the
example's "Trend breakout" setup can never match — and on an instrument that
carries no volume at all (FX pairs, indices, yields).

The page and the worker scan the same thing: `data/price-history.json`.
Closes pasted on the Your data page live in one browser, so the scanner names
them as left out rather than scanning series the worker cannot see. A named
symbol with no series, and — for a market universe — a series with no row in
`data/instruments.json`, is listed as skipped with the reason. Each pair is
evaluated on its own instrument's last final bar — a bar captured before its
session closed is provisional and never evaluated — and a series behind the
session that should be held by now is stale and reported untested. Paths
given to `scan.mjs` are taken from the current directory, and every file the
worker writes is written to a temporary file and renamed over the old one,
which is kept as `.bak`.

```bash
node scanner/scan.mjs --check               # self-test only
node scanner/scan.mjs --dry                 # evaluate and print; write nothing, log nothing
node scanner/scan.mjs                       # evaluate data/scan-setups.json, append to data/scan-alerts.json
node scanner/scan.mjs --status              # the dashboard's answers, in words (--json for the object)
node scanner/scan.mjs --runs 10             # the last ten runs from data/scan-runs.json
node scanner/scan.mjs --as-of 2026-08-06    # replay a session; nothing already recorded is recorded again
node scanner/scan.mjs --retry <run id>      # re-run a logged run on its own session dates
node scanner/scan.mjs --pause "why"         # every run is SKIPPED_PAUSED until --resume
node scanner/scan.mjs --unlock              # remove a lock a dead run left (a live one needs --force)
node scanner/scan.mjs --backtest <setup id> --from 2026-01-01 --json   # bars a setup held on: a simulation
```

**The worker's own files**, all git-ignored and in CI's "no licensed data"
list, live beside the alert record (or in `--data DIR`):

| File | What it holds |
|---|---|
| `data/scan-runs.json` | `{ schema: 1, runs, audit }` — the newest 500 runs, each written PENDING when it takes the lock, RUNNING after the self-test, then COMPLETED, PARTIAL, FAILED, CANCELLED, SKIPPED_NO_DATA, SKIPPED_NO_SETUPS, SKIPPED_LOCKED or SKIPPED_PAUSED, with counts, readiness per market, errors (a category and a correlation id, printed beside the message) and duration; `audit` records every replay, retry, pause, resume, unlock and lock takeover |
| `data/scan.lock` | the one run holding the record, opened `wx`; a lock whose process is dead or which is over an hour old is taken over, recorded, and its run closed FAILED/ABANDONED |
| `data/scan-control.json` | `{ paused, since, reason, by }` — the pause switch |
| `data/scan-deliveries.json` | `{ channels, deliveries }` — IN_APP ACTIVE, one SENT row per new alert (meaning: written to the record the app reads); EMAIL, TELEGRAM and PUSH NOT_CONFIGURED, each with its reason |
| `data/ingest-runs.json` | the daily run's own log (`ingest/daily.mjs`): each step's outcome and the scanner's status and run id |

Exit codes: `0` completed, `1` failed, `2` partial (a setup left out, skipped
or untested everywhere, or the delivery record not written — the alerts are),
`3` skipped (paused, locked by another run, no setups, or no data: no history,
nothing on or before a replay date, or nothing changed since the last run).
A run on exactly the engine, setups, history and record the last run read
cannot record anything new, so it is skipped and names that run.

Nothing is sent. Email needs a server and a contact address held under a
privacy notice; Telegram a server-held bot token; push a push service and the
intraday scanner, which is not built — intraday bars need a licensed feed,
and no intraday fetch exists in either lane. Each is recorded as not
configured, never as a failure of something attempted.

Copy `scanner/setups.example.json` to `data/scan-setups.json`, or build a
setup on the page and copy its JSON. Both data files are git-ignored and CI
fails if either is tracked. `ingest/daily.mjs` runs the worker with
`--trigger daily` only when its history step succeeded, and only when a
setups file exists. Like the Trading Index batch,
the worker slices its engine out of `index.html` between `@scan-engine-start`
and `@scan-engine-end`, self-tests on a fixture before every run, and writes
alerts in setup-then-instrument order — never sorted by anything. Each alert is
one setup, one instrument, one bar, keyed `setupId|symbol|daily|barDate`, so
the same bar is never recorded twice, and a cooldown counts bars rather than
days. `scanner-test.mjs` checks the arithmetic on hand-worked series and the
worker itself on temporary folders: the runs log, two workers at once, a dead
and a stale lock, pause, replay and retry (idempotent and audited), the
delivery record and its failure, the backtest CLI, every exit code, and
`daily.mjs` with each step stubbed.

A watchlist can be a setup's universe. The builder on `/my/scanner` (and the
"Use as scanner universe" button on `/my/watchlists`) expands the list into the
symbols its members trade under and writes that snapshot into the setup JSON,
with the date — the worker runs in Node and cannot read a browser's storage,
so the setup carries the list rather than a reference to it. Copy the JSON
again when the list changes. Every watchlist member carries its canonical
instrument id (`US:AAPL`, `MY:1155`), and the export from `/my/watchlists` is
the shape a later scanner phase would take as its universe.

## Your TradingView bot in the scanner

Your "Multi-Timeframe Trading Bot" — the Pine script on your OANDA:XAUUSD
chart — combines four criteria on a trade timeframe with the same criteria on
an entry timeframe and raises fifteen alerts. The scanner evaluates those
alerts on your own history as ordinary setups: entries judged on the **daily**
bar, the trade timeframe **weekly**, and **monthly** as a second trade
timeframe, so there are two sets of trade-timeframe and combined signals, one
weekly and one monthly. Each timeframe is judged on its **last closed bar**.

**The signals are your script's, not this product's advice.** Each setup
carries your script's own alert title and records the bars on which its
conditions held — nothing more. Nothing is proposed, ranked or delivered, and
neither the script nor any indicator here has been validated on point-in-time
data, so no signal is claimed to work.

### The weekly routine

1. **Export from TradingView.** Open OANDA:XAUUSD on the daily (1D) chart and
   scroll back until no more history loads — an export holds only the bars
   loaded on the chart — then the menu beside the symbol > "Export chart
   data…" > CSV, saved into `watchlist-shots/` (git-ignored: it is
   TradingView's licensed data, for your own research). The file is
   `OANDA_XAUUSD, 1D.csv`. Do the same on the weekly (1W) and monthly (1M)
   charts, scrolled back as far: `OANDA_XAUUSD, 1W.csv` and `, 1M.csv`.
2. **Import the three files:**

   ```bash
   node ingest/history-import.mjs --in "watchlist-shots/OANDA_XAUUSD, 1D.csv"
   node ingest/history-import.mjs --in "watchlist-shots/OANDA_XAUUSD, 1W.csv"
   node ingest/history-import.mjs --in "watchlist-shots/OANDA_XAUUSD, 1M.csv"
   ```

   The daily bars go to the daily series and the weekly and monthly bars
   beside it, as TradingView drew them. **The bot's weekly and monthly
   criteria read the imported weeks and months where they are held**, and
   weeks and months built from your daily bars for every period after the
   last imported one; each reading says which it read.

   The symbol (XAUUSD) is read from the name and its market (FX: a day that
   opens at 17:00 New York the evening before) from `data/instruments.json`,
   so the export's Sunday-to-Thursday stamps are dated to the Monday-to-Friday
   sessions they open. A last row saved while its session still traded is
   PROVISIONAL, never evaluated, and next week's import replaces it. What the
   import does and refuses: [ingest/README.md](ingest/README.md#your-tradingview-bot-the-imports-side).
3. **Check parity** — each chart's indicators against the scanner's, and the
   weeks and months the scanner builds from your daily bars against
   TradingView's own:

   ```bash
   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1D.csv"
   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1W.csv" --daily "watchlist-shots/OANDA_XAUUSD, 1D.csv"
   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1M.csv" --daily "watchlist-shots/OANDA_XAUUSD, 1D.csv"
   ```

   Exit 0 means nothing DIFFERS. A column NOT SETTLED needs a longer export,
   not a different formula. A week or month PARTIAL is only partly in one of
   the files — the daily export begins after its first session, or it was in
   progress when a file was saved. HOLIDAY is a weekday on which neither file
   has a bar (Christmas, New Year's Day, Good Friday): its open, high, low and
   close agree, and the scanner leaves that week's volume blank, because a
   missing day is not a day of nought and no exchange calendar says which
   days were holidays. The weeks of the weekly export before your daily one
   begins are counted, not compared. **DIFFERS** (exit 1) names the column or
   the period, the fields and both values — stop there: a setup read on a
   week the scanner built wrongly is wrong.

   <!-- tv-verify frames -->
   The weekly and monthly exports are also checked on their own bars, as the
   daily one is: each chart's indicators computed from the file's own weeks
   or months, every row dated as the import files it (a Sunday-evening stamp
   is the week of the Monday it opens; a month is its 1st), and the last one
   said to be in progress when it was:

   ```bash
   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1W.csv"
   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1M.csv"
   ```

   Those charts carry more than the daily one, and their settings are their
   own. **NOT KNOWN** is a column no script here computes — Ichimoku's lines,
   Volume MA, VWAP and its bands, a "Plot" or "Shapes" of a script this tool
   does not have — listed with its title and column number; it never stops
   the check, and the exit status is decided by the columns compared. **BOT
   PLOT** is one of your Multi-Timeframe Trading Bot's own marks, such as
   "Strong Buy - Continuous", listed with the bars it marks: the bot joins
   the chart's timeframe with its Entry timeframe, so one file cannot check
   it. **Read as**, under the table, says which indicator each run of columns
   was taken to be — two RSIs are two runs, and an untitled "Plot" run that
   two scripts fit alike goes to the one whose numbers agree — and which
   settings its numbers take: your daily chart's are tried first, then each
   script's own defaults and, for the MACD, the bot's EMA signal. A setting
   the file refutes is named with the column and bar that refute it; one it
   cannot tell apart (an EMA of 200 on 300 bars) leaves the column NOT
   SETTLED, with the candidates named. `--interval 1W` (or `1M`) with
   `--market` reads a file not named as TradingView names one.
   <!-- end tv-verify frames -->

   <!-- bot-verify -->
   Then hold the scanner's bot against your script's own marks on the three
   charts:

   ```bash
   node scanner/bot-verify.mjs --daily "watchlist-shots/OANDA_XAUUSD, 1D.csv" \
     --weekly "watchlist-shots/OANDA_XAUUSD, 1W.csv" --monthly "watchlist-shots/OANDA_XAUUSD, 1M.csv"
   ```

   It imports the three files exactly as step 2 does, but into a temporary
   folder it removes afterwards (your `data/price-history.json` is never
   touched), makes the bot's setups with your defaults, and evaluates them on
   the last daily session of each week and month. Each "Strong Buy -
   Continuous" (and every other bot mark) is compared with the matching
   setup, and each chart's own WaveTrend, MACD and MCDX columns are compared
   with the scanner's criteria for the same bar. It assumes each chart's bot
   has Entry TF = D and Trade TF = the chart's own timeframe, and tests that
   assumption against the chart's own columns. Every disagreement gets a
   reason:

   - **provisional**: the bar was still trading when you saved the file.
   - **not held**: a daily session the week needs is missing.
   - **warm-up**: a criterion needs more bars than the file holds, or has
     not yet forgotten where the file begins.
   - **entry timeframe**: your chart's Entry TF reading is not the daily
     one.
   - **trade timeframe**: your chart's bot does not read the chart's own
     bars.
   - **gaps_on**: a daily chart's weekly marks.
   - **UNEXPLAINED** (exit 1): a fault to find and fix before trusting the
     setups.

   Your charts, as exported on 2026-09-28, run the script with its shipped
   defaults: **Entry TF 240** (4-hour bars) and **Trade TF W** even on the
   monthly chart. Many daily Entry TF marks sit on sessions where the chart's
   own daily columns rule them out, and the monthly marks follow the weekly
   bot, not the monthly bars. The scanner follows your decisions instead:
   entries on the daily bar, and a monthly set on monthly bars. Its
   alerts will not repeat those two charts' marks. To see TradingView draw
   what the scanner computes, set the bot's Entry TF to D on all three
   charts and its Trade TF to M on the monthly chart, then export again.
   <!-- end bot-verify -->
4. **Add the bot's setups** on `/app/scanner/setups` (once, and again only
   when you change them). They arrive as ordinary daily setups whose
   conditions read the week or the month, named for your script's alerts —
   "MTF bot · Weekly · STRONG BUY CONTINUOUS", id
   `mtfbot-w-strong-buy-continuous`; the monthly set `mtfbot-m-…`; the entry
   signals `mtfbot-d-…`, such as `mtfbot-d-entry-buy`. The defaults are your
   decisions below: weekly and monthly trade timeframes, criterion 3 on the
   EMA(200), the MACD's EMA signal, and a match recorded on the bar it begins
   (NEW_MATCH), not on every bar it goes on holding.
5. **Export the setups** — "Export scan-setups.json" on the same page — and
   save the file over `data/scan-setups.json`.
6. **Scan:**

   ```bash
   node scanner/scan.mjs --dry                  # evaluate and print; write nothing
   node scanner/scan.mjs --as-of 2026-09-28     # replay each earlier session of the week, oldest first …
   node scanner/scan.mjs --as-of 2026-09-29
   node scanner/scan.mjs --as-of 2026-09-30
   node scanner/scan.mjs --as-of 2026-10-01
   node scanner/scan.mjs                        # … then the last final bar, recorded in data/scan-alerts.json
   ```

   A run evaluates each instrument's last final bar, and an import adds a
   week at a time, so the sessions before the last one are evaluated by
   replaying them (the dates above are an example week); a replay records
   nothing already recorded. The matches are on `/app/scanner/alerts`, and an
   alert names the week or month each condition was read on.

### What each signal means, as your script defines it

The criteria, each read on its timeframe's last closed bar, with the script's
settings:

| | Holds when | Does not hold when |
|---|---|---|
| **1** | WaveTrend (10, 21): wt1 above wt2 | wt1 at or below wt2 |
| **2** | MACD (12, 26, 9): the line above its **EMA** signal | the line at or below it |
| **3** | the close above the EMA(200) | at or below it |
| **4** | MCDX banker — 1.5 × (RSI(50) − 50), held within 0 and 20 — above 5 | at or below 5 |
| **5** | MCDX hot money — 0.5 × (RSI(40) − 30), held the same way — below 10 (sell entries only) | at or above 10 |

The histogram (the MACD line less its EMA signal) is **rising** when the last
closed bar's is above the closed bar's before it and **falling** when below —
strictly, as the script's `>` and `<`: an unchanged histogram is neither.

The signals, T being the week (or, in the second set, the month) and D the day:

| Your script's alert | Holds when |
|---|---|
| Trade TF Tier 1 Buy | 1 and 2 on T, and neither 3 nor 4 — tier 1 without tier 2 |
| Trade TF Tier 2 Buy | 1 and 2 on T, and 3 or 4 |
| Trade TF Tier 1 Sell | neither 1 nor 2 on T, and 3 or 4 — tier 1 without tier 2 |
| Trade TF Tier 2 Sell | none of 1 to 4 on T |
| Entry TF Buy | 1, 2, 3 and 4 on D |
| Entry TF Sell | none of 1 to 4 on D, and 5 on D |
| Entry TF Trade | Entry TF Buy or Entry TF Sell |
| STRONG BUY CONTINUOUS | Trade TF Tier 2 Buy, Entry TF Buy, and T's histogram rising |
| STRONG BUY REVERSAL | Trade TF Tier 2 Buy, Entry TF Buy, and T's histogram falling |
| STRONG SELL CONTINUOUS | Trade TF Tier 2 Sell, Entry TF Sell, and T's histogram falling |
| STRONG SELL REVERSAL | Trade TF Tier 2 Sell, Entry TF Sell, and T's histogram rising |
| WEAK BUY | Trade TF Tier 1 Buy (so not tier 2) and Entry TF Buy |
| WEAK SELL | Trade TF Tier 1 Sell (so not tier 2) and Entry TF Sell |
| ANY STRONG SIGNAL | any of the four STRONG alerts |
| ANY WEAK SIGNAL | WEAK BUY or WEAK SELL |

**The last closed bar.** On each daily close the weekly criteria are the last
completed week's — the week that contains the day only when that day closes
it (its last expected session) — and the monthly criteria the last completed
month's. On a Wednesday they are last week's; from Friday's close, this
week's.

Where the scanner departs from the chart, by your decisions of 29 September:

- **Entries on the day.** The script's Entry timeframe ships as 4-hour
  ("240"); the history holds one bar per session, so entries are judged on the
  daily bar. The chart's "Entry TF Buy" and "Entry TF Sell" marks are the
  4-hour ones unless you set the script's Entry timeframe to D.
- **The last closed bar, every day.** The script as written (Pine v6,
  `request.security` with gaps on) reads a weekly condition only on the day a
  week closes, false on the days between, and compares the histogram across
  that gap. The scanner reads the last completed week on every day — the
  intent, which you chose.
- **Criterion 3 on the EMA(200)**, as the script's code has it. That is an
  assumption: the chart draws the SMA(200) (Color MA and SMA Cross), and the
  setups can use the SMA instead.
- **The MACD's EMA signal**, as the script computes it. The chart's
  CM_Ult_MacD_MTF uses an SMA(9) signal, and the two disagree on some days.

### What stays unknown until your history is long enough

A criterion that cannot be computed yet is **unknown** — neither held nor
failed — and its reason names the timeframe. A signal that needs an unknown
criterion is unknown too, unless another criterion already settles it (one
false in an AND, one true in an OR): it can be found not to hold before the
history is long enough, and it cannot hold until then. The closed bars each
criterion needs, and about how many daily sessions give them (spot gold
trades every weekday: five a week, about 21¾ a month):

| Criterion | Closed bars | Daily | Weekly | Monthly |
|---|---|---|---|---|
| 1 — WaveTrend wt1 against wt2 | 42 | 42 sessions | 42 weeks ≈ 210 sessions | 42 months ≈ 915 sessions (3½ years) |
| 2 — MACD against its EMA signal | 34 | 34 | 34 weeks ≈ 170 | 34 months ≈ 740 |
| histogram rising or falling | 35 | — | 35 weeks ≈ 175 | 35 months ≈ 760 |
| 3 — close against EMA(200) | 200 | 200 | 200 weeks ≈ 1,000 (3.8 years) | 200 months ≈ 4,350 (16.7 years) |
| 4 — banker against 5 | 51 | 51 | 51 weeks ≈ 255 | 51 months ≈ 1,110 (4¼ years) |
| 5 — hot money against 10 | 41 | 41 | — | — |

- **Your export of 28 September** holds about 300 daily bars (from 31 July
  2025): about 60 weeks and 14 closed months. On the daily file alone, every
  daily criterion is known; weekly criteria 1, 2 and 4 and the weekly
  histogram are known; **weekly criterion 3 is unknown** (200 weeks), so
  Trade TF Tier 1 Buy, Trade TF Tier 2 Sell, WEAK BUY and both STRONG SELL
  alerts cannot hold on the week; **every monthly criterion is unknown**, so
  no monthly signal can hold. **With the weekly and monthly exports
  imported** — 300 weeks from January 2021, 300 months from October 2001 —
  every weekly and monthly criterion is known, read on the imported weeks
  and months; the setup page and the bot's card count them, imported and
  built.
- **At the history's limit.** The history keeps the newest 2,000 bars of each
  series, and every write trims to that, the daily run's included
  (`ingest/history-store.mjs`): about 7⅔ years of sessions, 400 weeks, 92
  months. That is enough for every daily and weekly criterion. **Monthly
  criterion 3 needs 200 months and cannot be computed from the daily bars
  within it**: without an imported monthly export, on the month Trade TF
  Tier 1 Buy, Trade TF Tier 2 Sell, WEAK BUY and both STRONG SELL alerts can
  never hold, and Trade TF Tier 2 Buy and Tier 1 Sell hold only where
  criterion 4 settles them (the banker above 5). The imported months are kept
  apart from the daily series, each frame to its own newest 2,000 periods.
- **Computed is not yet TradingView's number.** An EMA, Wilder's RSI and
  WaveTrend remember where a history begins, and TradingView computes on all of
  its own. Close to a crossing, the scanner's value can differ from the
  chart's until the history is several times the indicator's length;
  tv-verify shows the bar from which each column agrees. The bot's EMA(200)
  and its EMA-signal histogram are not drawn on your chart, so no export
  checks them directly; the MACD line, WaveTrend and the banker are.

## Bursa fundamentals: the source review

Roughly forty candidate sources were probed empirically — fetched, not read about
— and every claim of viability was then attacked by an independent reviewer. The
result is one sentence long:

> **Free, structured, redistributable — you can have any two.**

**The dead ends. Do not re-litigate these.**

| Source | Why not |
|---|---|
| Bursa Malaysia direct | 403 to every client tested, four times independently. All eight candidate API hosts fail DNS. Bursa LINK is a redirect stub back into the 403 zone. |
| SEC EDGAR | **0 of 10 Sarawak names exist.** Maybank's filing history is a 12g3-2(b) exemption *from* reporting; its "annual reports" are 290-byte auto-generated stubs. |
| Wikidata (CC0) | 819 Bursa-coded companies, **0 with revenue, 0 with assets.** Identity only. |
| data.gov.my / DOSM (CC BY 4.0) | Macro only. No company appears in any form. |
| GLEIF (CC0) | Legal-entity identity. No financials. |
| klsescreener | Best quarterly data found — and its terms bar copying "by robot, spider… **or manual process**". No compliant route exists, human or machine. |
| listedcompany.com, InSage | Statutory filings, but non-commercial-only and no derivative works. |
| Issuer IR sites | Audited reports, but none grants redistribution. See below on extraction cost. |
| EODHD | Ruled out on one clause: on termination you must delete all copies within a month. **A public git history cannot be un-published.** |

**Twelve Data is the only candidate worth an experiment.** It is the sole vendor
combining confirmed Bursa symbol coverage — 1,144 rows including every Sarawak
name, reproduced independently — with a redistribution right you can actually
buy. But symbol coverage is not statement coverage: `/income_statement` returns
403 behind the paid tiers and **no Bursa income statement has ever been seen from
it**. Buy one month of the cheapest fundamentals tier, run the probe, cancel if
empty. Do not open redistribution talks before coverage is proven.

```bash
TWELVEDATA_KEY=... node ingest/vendor-probe.mjs
```

**Extraction from annual reports is manual data entry, not parsing.** On the same
IR platform: three unit scales (raw ringgit, RM'000, unlabelled millions),
opposite column orders, three different page paths, and pages whose first four
tables are shareholding registers. The summary tables are not trustworthy either
— one issuer's own financial-highlights table reports finance costs **12.9×** the
figure in its audited MD&A, because the value is the selling-and-distribution
line misfiled. Another source quoted Bintulu Port FY2025 revenue as RM877,524k;
the audited P&L says **RM824,082k**, and the larger number is the sustainability
statement's "economic value generated".

## Deliberately absent

Accounts, server persistence, billing, trial and renewal, licensed market data,
AI analysis, and any form of recommendation. These are documented in-app under
**Learn → Data, rights & point-in-time**, so the product never claims a capability
it does not have.

## Licence

Private and unlicensed. All rights reserved.
