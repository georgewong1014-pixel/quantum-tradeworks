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

The deployed site is one static HTML file, assembled from `src/` by `build.mjs`
and committed, so the host needs no build step. After editing anything under
`src/`, run `node build.mjs` and commit the result; CI fails if `index.html`
drifts from its source.

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

## Structure

```
.
├── src/              # the source: js/*.js in load order, styles.css, index and vercel templates
├── build.mjs         # assembles index.html and vercel.json (with the CSP hash) from src/
├── index.html        # the entire deployed application — generated, committed
├── vercel.json       # host rewrites and headers — generated, committed
├── data/             # committed datasets (us.json, instruments.json, …); licensed and personal files are git-ignored
├── serve.mjs         # zero-dependency static server, applying vercel.json's headers
├── screenshot.mjs    # zero-dependency screenshot tool (CDP over Node's WebSocket)
├── syntax.mjs, wording-check.mjs, scanner-test.mjs, ingest-test.mjs   # offline checks
├── sweep.mjs, mobile.mjs, coverage-frames.mjs, register-test.mjs,
│   model-test.mjs, equity-test.mjs                                    # browser harnesses
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
