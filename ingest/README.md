# Ingestion

The engine is real; the dataset shipped with the app is not. This directory is
the path from one to the other.

```bash
export SEC_UA="QuantumTradeworks/0.1 (your@email.com)"   # the SEC requires a contact
node ingest/sec.mjs --years 10 --out data/us.json AAPL MSFT JPM XOM
```

## What is loaded today

**119 US companies from SEC EDGAR**, ten years each, averaging 95% line
completeness, 53 of them complete. Business type is derived from each filer's
own SIC registration rather than a guess, so the valuation router picks the
right model without anyone hand-classifying: 12 banks route to residual income,
5 REITs to a distribution model, 3 insurers to their own pack, 32 cyclicals to a
mid-cycle normalisation. Nothing in the set falls back to an assumed type.

**Malaysian listings are tracked by price only** — see below.

### Coverage is honest, not uniform

Four names sit below 80%: BLK 42%, BRK-B 70%, CDNS 76%, O 78%. That is reported
rather than patched, and confidence falls accordingly. A holding company and an
asset manager genuinely do not report the lines a generic model wants.

BLK routes to `bank` because SIC 6211 covers brokers and dealers, which fits
Goldman, Morgan Stanley and Schwab far better than it fits an asset manager.
It is a judgement call, it is visible on the page, and the model pack can be
changed per company.

## What actually happened on the first ten companies

Not a plan — the result of running it.

| | |
|---|---|
| AAPL, MSFT, XOM, CAT, KO | 100% complete |
| NVDA | 95% |
| GOOGL | 92% |
| NEE | 88% |
| JPM | 80% |
| RIVN | 65% |

Three failure modes surfaced immediately, and they are the real work.

### 1. Ticker → CIK resolved to the wrong legal entity

`XOM` in the SEC's own ticker register points at **CIK 2115436, "ExxonMobil
Holdings Corp"** — a post-reorganisation topco with **no `us-gaap` facts at
all**. Seventeen years of statements sit under **CIK 34088, "EXXON MOBIL
CORP"**.

A naive lookup loses the entire filing history, and in a slightly different
case would attribute figures to the wrong company. `sec.mjs` now carries a
curated `CIK_OVERRIDES` table and refuses to proceed when a resolved entity
reports no `us-gaap` facts, naming both entities.

**This is why company identity is the first epic and not a detail.**

### 2. Filers change XBRL tags mid-history

ASC 606 moved most issuers off `Revenues` and onto
`RevenueFromContractWithCustomerExcludingAssessedTax` around 2018. Neither tag
covers ten years alone. Picking one winning concept silently truncates history.

The resolver now merges across a priority chain year by year and records which
tag supplied each year. Where a series draws on more than one tag it is flagged
`mixedTags`, because "revenue" meaning two different measures across a peer
group is how a comparison quietly becomes wrong.

### 3. Not every company has the line you asked for

Banks and integrated oil do not report `OperatingIncomeLoss`. The chain falls
back to pre-tax income as the nearest defensible proxy — and flags it, because
it is a proxy, not the same measure.

JPMorgan's FY2025 operating cash flow comes back at **−$147.8bn**. That is
correct, not a bug: a bank's operating cash flow swings with trading assets and
loan flows. The engine already refuses to compute free cash flow for a
deposit-taking balance sheet, so this never becomes a valuation.

## Malaysia: tracked, not analysed

There is no source. This was tested rather than assumed:

- **Bursa Malaysia's own site returns 403** behind a Cloudflare challenge. There
  is no public API.
- **No Malaysian issuer files XBRL** anywhere reachable. They do not file with
  the SEC, and Bursa publishes annual reports as PDFs.
- **data.gov.my** carries macroeconomic statistics, not company financials.

So Malaysian listings live in a separate **Tracked** view: price, date, change
across the stored series, and a trend line. No valuation, no scorecard, no
coverage figure. They are deliberately *not* companies in the research universe,
because admitting them would render an empty scorecard beside real ones — and an
empty analysis reads like a finished analysis that found nothing.

`data/instruments.json` gives them identity — 101 instruments: 34 Bursa
listings, **39 indices across 27 markets**, 9 currency pairs, 8 commodities,
7 ETFs and 4 crypto pairs. Bursa codes there are transcribed from public
listings and **should be checked against your own broker**: a wrong code
silently attaches a price to the wrong company.

### Aliases, because one index has several names

The S&P 500 is `SPX`, `US500` or `ES1!` depending on where you look. Each entry
carries an `aliases` list, matched case-insensitively, so:

- an index resolves to one row whichever form your watchlist shows;
- a series collected under an old name is merged rather than orphaned;
- the OCR symbol matcher reads the registry too, so adding an index is one edit
  here rather than two.

Verified by injecting `SPX` beside an existing `US500` and `GC1!` beside
`XAUUSD`: both collapsed into their canonical rows and the row count did not
move. Alias collisions are checked — no alias points at two instruments.

Series accumulate from the daily run:

```bash
node ingest/history.mjs --in data/personal-prices.json
```

One close per symbol per day, bounded by `--keep`. For a Bursa listing the
series is the entire signal rather than a supporting detail, which is why the
daily run builds it whether or not anything else succeeded.

## What SEC gives you, and what it does not

**Yes** — audited US annual and quarterly fundamentals, free, official,
unauthenticated, no redistribution licence needed for the reported facts.

**No** — prices, corporate actions, intraday anything, analyst estimates, and
any non-US issuer. **There is no Bursa Malaysia equivalent.** That asymmetry
shapes the whole roadmap: a real US research product costs nearly nothing in
data; the Malaysian half, which is the actual differentiation, is licensed.

## The SEC pipeline, stage by stage (ingest sec 1.2.0)

```bash
node ingest/sec.mjs --out data/us.json --facts data/us-facts.json AAPL MSFT   # fetch, archive, write
node ingest/sec.mjs --from-raw --out data/us.json AAPL MSFT                   # offline: re-normalise the archive
node data-check.mjs                                                           # the shipped file, checked
```

1. **Fetch and archive.** Every companyfacts and submissions body is saved
   verbatim under `ingest/raw/` (git-ignored) with its URL, retrieval date and
   SHA-256 in `ingest/raw/manifest.json`, and each record names the bodies it
   was built from by hash (`raw`). `--no-raw` skips the archive; `--raw-dir`
   moves it.
2. **`--from-raw`** reads the archive instead of the network — no request goes
   to the SEC, and a ticker never fetched fails by name. A rule change can be
   re-run and diffed without a contact address.
3. **Normalise.** A concept in a unit its line does not expect is refused and
   named in `gaps[]` (Emerson's dividend in `pure`; any money line not in USD).
   A line whose period ends away from the revenue year-end — more than seven
   days for a duration, at all for an instant — is left empty with both dates
   in the gap. A restated year keeps its first-filed value beside the latest
   (`provenance[line].restated`) and is listed in `gaps[]`. A share count of
   nought is no count.
4. **Validate.** `validateCompany` refuses a record whose shape, years, units,
   completeness or share count is wrong; it goes to `failures[]`, not
   `results[]`. `data-check.mjs` runs the same function over `data/us.json` in
   CI and records what the shipped file already breaks.
5. **Gate.** Before replacing `--out`, `writeGate` compares the run with the
   file: a missing company, completeness down more than 0.05, a window moving
   backwards, a golden figure (AAPL, MSFT, NVDA) moving, a duplicate or a
   failure writes `.partial.json` instead, unless `--force`. It always prints
   every changed equity, debt, cash and share-count cell with both values and
   the date the new one describes — the diff that verifies the year-end fix.
6. **Write.** Each record and the file header carry `ingestVersion`. With
   `--facts`, one FinancialFact row per line and year is written beside the
   tuple: the value as a decimal string in filed units, unit, currency, fiscal
   year and period, period start and end, filing date, form, accession number,
   concept, and `dataClassification: "FILED"`. The engine does not read it.

The fixture archive in `ingest/fixtures/sec-raw/` is invented and shaped like
the SEC's responses; `ingest-test.mjs` runs the whole pipeline and the CLI
against it with no network.

**Still waiting on a contact address:** none of this has run against the SEC.
`data/us.json` predates it — no `periodEnds`, no per-line dates, no
`ingestVersion` — and regenerating it needs `SEC_UA`.

## Prices: why not Yahoo Finance or TradingView

Both were considered and both were rejected. See `providers.mjs` for the
adapter contract.

**Yahoo Finance** has no official public API. The endpoints commonly passed
around are undocumented, are not offered as a product, and Yahoo's terms
prohibit redistribution and commercial exploitation. They require cookie/crumb
handshakes, change without notice, and rate-limit hard. Building a paid
subscription on that is a terms breach with an operational fault line in it.

**TradingView** does not sell a market-data API. Their data is licensed from
exchanges under agreements that do not permit resale, and their charting
products are bring-your-own-data.

There is a legitimate TradingView use: **embeddable widgets**. If the goal is
to *show* a chart, embedding one is allowed under their terms with attribution
and needs no licence of your own. What you cannot do is read prices out of it
and feed them into valuation models — which is what this product needs.

Free feeds are fine for a prototype and unusable for a paid product. The moment
someone pays, the feed must be licensed for display, redistribution and derived
use.

Legitimate candidates worth pricing: Polygon.io, Finnhub, Twelve Data and Alpha
Vantage for US; Refinitiv (LSEG), FactSet, S&P Capital IQ or SIX for broader
coverage; and for Bursa either a direct Bursa Malaysia information-services
licence or a vendor already holding Bursa redistribution rights. Verify current
terms before signing — they change.

## What this does not solve

Ingestion gets numbers in. It does not make them right.

Still outstanding before any of this is trustworthy: restatement and
point-in-time storage (this flattens to latest-known, which is a policy, not a
neutral choice); fiscal-year alignment across non-calendar filers; the
narrow-versus-broad cash definition (`CashAndCashEquivalentsAtCarryingValue`
excludes marketable securities, so net debt computed from it differs from a
net-cash view); share-count continuity across splits; a golden set with
accounting invariants and cross-source reconciliation.

The engine will happily compute a beautiful, fully-decomposed, source-linked
valuation from a wrong number. That is the part to budget for.

---

## Prices: end-of-day, supplied by you

```bash
node ingest/prices.mjs --in your-eod-file.csv --licence "Vendor X EOD redistribution, 2026"
```

Writes `data/prices.json`, which the app picks up automatically when `?real=1`
is on. Vendor-neutral by design: swapping suppliers is a different input file,
not a code change. `data/prices.json` is git-ignored — prices are supplied under
your licence, not shipped in this repo. See `data/prices.example.csv` for the
column shape.

Validation **rejects rather than repairs**. A negative close, a future date, a
date that is ambiguous or unreadable (read by the history import's rule:
ISO as written, a day above 12 settles the order, `03/04/2026` is refused), or
a close above its own stated 52-week high is reported and dropped, because a
price that fails a sanity check is a data problem to look at rather than
something to coerce into the file. The CSV may quote its cells, and a quoted
number may carry thousands separators (`"1,612.34"`).

Each run replaces the file with the rows it accepted, with two exceptions. A
symbol whose row is refused keeps the price the file held for it, when the file
was written from the same input. And a row that names its own source — the
USD/MYR rate `fx.mjs` merges in — is carried over with its own date, so an
import never takes the rate away.

### Why end-of-day is the right target

Valuation, screening, scorecards, portfolio tracking and thesis monitoring all
work on closes. Real-time exchange data is licensed per user with audit
obligations and priced accordingly; end-of-day is a cheaper product with lighter
redistribution terms. For a research product the capability loss is nil, and it
is probably the single largest cost lever available.

### What a licence has to cover — and what does not count

None of the following permit redistribution to your subscribers:

- **Broker-provided data.** Licensed to the broker, sublicensed to you as their
  client for viewing in their platform.
- **A personal TradingView subscription**, at any tier. There is no data API,
  and the terms bar automated extraction. Their embeddable *widgets* remain a
  legitimate way to display a chart with no licence of your own — just not a way
  to get prices into a model.
- **Yahoo Finance.** No official API; terms bar commercial use.

What you need is an end-of-day **redistribution** licence: direct from Bursa
Information Services for Malaysian prices, and any of the commodity US vendors
for the American side.

---

## Price history: one store, every bar dated by its session

`data/price-history.json` (git-ignored) is the series the trend engine and the
scanner read. It has one writer, `ingest/history-store.mjs`, and the three
scripts that add to it — `history.mjs` (the daily screen capture),
`history-import.mjs` (a CSV export) and `live.mjs --history` (a provider) —
all go through it.

```bash
node ingest/history-import.mjs --in KLSE.csv --symbol KLSE    # an export, open/high/low kept
node ingest/history-import.mjs --in "watchlist-shots/OANDA_XAUUSD, 1D.csv" --symbol XAUUSD   # a TradingView export
node ingest/history.mjs --in data/personal-prices.json       # what the daily run does
node ingest/live.mjs --history --days 400                     # a provider (personal lane)
```

What the store decides, so no writer decides it differently:

| | |
|---|---|
| **Validation** | the engine's own `scanValidateBar` (loaded out of `index.html`, as the scanner loads it): BAD_DATE, FUTURE, NEG_PRICE, NEG_VOLUME, HIGH_BELOW, LOW_ABOVE, NON_SESSION_DAY — so the page, the worker and the ingest refuse the same bars. Two different rows for one date in one batch are both refused (DUPLICATE_DATE); the same row repeated is read once. |
| **Conflicts** | a source rank: an import or a provider (`import:<file>`, `yahoo`, `twelvedata`) outranks the screen, and a bar with no recorded source ranks with the screen. A lower rank never replaces a higher one — the row is reported as outranked. An equal or higher rank that disagrees replaces the bar, and every changed field is recorded in `corrections`, which the engine reads as a CORRECTED bar. |
| **Provisional bars** | a bar captured before its session closed is superseded by any later capture, whatever its rank, and that is not a correction — it was never the session's value. |
| **A bar is one source's reading** | when the close changes, open, high, low and volume come from the new source too (absent where it has none); a high from one vendor beside another's close describes no real session. |
| **Refused rows** | written to `data/price-history.rejects.json` (git-ignored) with their codes — never into the history, never silently dropped. |
| **Trim** | the newest 2000 bars per symbol, with volume, open/high/low, provenance and corrections dropped together. (The daily writer kept 500 and trimmed no volume; a 600-bar import plus one daily run left 500 closes and 600 volumes.) |
| **Write** | under a lock (`data/price-history.json.lock`), to a temporary file renamed over the old one, the previous file kept as `.bak`. |

The file is additive — history v2:

```text
{ schema: 2, generated, symbols,
  series:      { SYM: { date: close } },
  volume:      { SYM: { date: volume } },
  ohlc:        { SYM: { date: [open, high, low] } },       only where a source has them
  meta:        { SYM: { date: { src, at, adjusted? } } },  source, when captured, and (imports)
                                                           whether the provider had adjusted it
  corrections: { SYM: [{ date, field, from, to, src, at, prevSrc }] } }
```

A close-only file reads exactly as before.

**Every bar is dated by its exchange's session, in the exchange's own zone.**
Yahoo stamps an Auckland session at 10:00 local — the previous day in UTC — and
dating by the UTC day put 66 of NZ50's bars on Sundays, 27 of ASX200's, and FX
pairs' Monday bars on Sunday. Now:

- **Providers** date each bar in the zone the provider names (Yahoo's
  `exchangeTimezoneName`; a series without one is refused), and keep open, high
  and low — null where the vendor has none, never the close standing in.
- **The screen capture** takes the screenshot's own time (its file time, or
  `--captured-at`) and dates each row by its instrument's exchange: the session
  in progress if one was trading — a reading, marked PROVISIONAL — else the last
  session that had closed. A screen read at 18:30 in Kuala Lumpur dates Bursa to
  that day, New York to its previous session, Tokyo and Sydney to their closed
  day, and London to a session still trading. `watchlist.mjs` writes
  `captured_at` and `bar_status` columns before the free-text ones;
  `prices.mjs` carries `captured_at` through.
- **Imports** read ISO dates as written. A 10- or 13-digit epoch, or a
  date-time with a zone, is an instant, dated by the session it opens in the
  instrument's market (its registry row, or `--market`; `--tz` changes only
  the zone), except an instant at exactly midnight UTC, which is read as that
  UTC date. Day-first and month-first dates follow the browser's paste rule: a day
  above 12 settles the order, and `03/04/2026` is refused as ambiguous rather
  than guessed (the old parser read it as 3 March and then, on a machine in
  Kuala Lumpur, shifted it to the 2nd). The test checks this under two machine
  zones and against the page's own parser.

**TradingView exports** stamp each daily bar at the instant its session
*opens*, and the import dates it by the session it *closes*:

| Market (its `SCAN_MARKETS` row) | A daily stamp | The session |
|---|---|---|
| A day that opens the evening before — `FX`: the currency pairs and OANDA's spot gold, 17:00 New York | Sunday 17:00 New York (21:00 UTC in summer, 22:00 in winter) | **Monday** — any stamp at or after 17:00 is the next day |
| An exchange (`US`, `MY`, …) | its own open, New York 09:30 | that day |
| `CRYPTO`, and the default market | 00:00 UTC | that day, weekends included |

So OANDA's gold export, stamped Sunday to Thursday, lands Monday to Friday.
Dated in the zone alone, Monday's bar was a Sunday — refused as
NON_SESSION_DAY — and every other bar a day early. A stamp at 17:00 on a
Friday would open a Saturday: it is refused, never moved onto Monday's bar.
The rule is read off the market's session (no open and a close before
midnight, or an open later than the close), so it holds for any market given
such a row. The store's FUTURE check follows it too: at 18:00 New York on a
Sunday — 06:00 on Monday in Kuala Lumpur — Monday's currency and gold bar is
the session in progress, not a future one (the store refused it until now,
losing an export's last row and a screen reading made then).

- **The capture time** is the file's modification time (TradingView writes
  none), or `--captured-at`: the last row of an export saved while its
  session traded is PROVISIONAL, and the next import after the close
  replaces it. The output names each file's last bar and its status.
- **Volume** from a spot currency or metals broker (market `FX`) is a tick
  count — how many times the broker's price changed, not ounces, lots or
  contracts traded. It is recorded as given, and the output says so.
- **Indicator columns** — a TradingView export carries one per plot on the
  chart — are not stored; the output counts them. The history holds bars,
  not what a chart drew on them: anything comparing indicators with
  TradingView's reads the export file itself.
- **The file name** is TradingView's `<EXCHANGE>_<SYMBOL>, <INTERVAL>.csv`:
  without `--symbol` (and under `--dir`) the symbol is read from it
  (`OANDA_XAUUSD, 1D.csv` is `XAUUSD`), and a file whose name says any
  interval but the day (`1W`, `240`) is refused — a weekly bar read as a
  daily one would write the week's close over Monday's.

Each bar's capture time is what the engine's bar status reads: FINAL when
captured at or after the session's close plus its settle margin, PROVISIONAL
before, UNKNOWN for bars written before this store existed. The exchanges'
zones and published hours are the engine's `SCAN_MARKETS`, now a row for every
market in `data/instruments.json` except commodities (which trade nearly round
the clock and stay on the conservative default) — save spot gold, `XAUUSD`,
which is on `FX`: it trades the currency session, 17:00 New York to 17:00 New
York, as OANDA quotes it. They are typed by hand, not a
maintained calendar, and each errs late: a late close only delays when a bar is
called final.

**What is not solved.** No provider here confirms a session is final; the
capture-time rule is the stand-in. No date is ever moved: bars written before
session dating are repaired by fetching them again (below). Nothing intraday is
fetched, in either lane: intraday bars need a data licence this product does
not hold.

### Checking the history, and the one repair

```bash
node ingest/history-check.mjs                  # the report; exit 2 when something needs repair
node ingest/history-check.mjs --json           # the same, as the engine's scanValidateHistory
node ingest/history-check.mjs --refetch --dry  # the re-fetch it would run, fetching nothing
node ingest/history-check.mjs --refetch        # run it (Yahoo, personal lane, unless --provider)
```

The report is the engine's own (`scanValidateHistory`, the same one the
scanner's `/admin/scanner/data` page shows), so the page and the tool cannot
describe one file two ways. It lists:

- **Bars on a day their market does not trade**, per market.
- **Shifted series** — a weekday profile with a Sunday that holds what a trading
  day should and a Friday that holds almost nothing is a series dated by the
  UTC day of a timestamp in a zone ahead of UTC. Called shifted when the day
  before the market's first session weekday (or after its last) holds at least
  a quarter of one session weekday's bars and at least five; "part of the
  series" below three quarters (one source of two, or the daylight-saving half
  of the year). On the file this was written against: NZ50 wholly, ASX200 and
  the eight currency pairs in part.
- **Sessions held under two dates** — the same close (and volume, where both
  are held) on consecutive days where one day is not a session day, or from two
  different sources. The same close on two weekdays from one source is an
  unchanged price, common on Bursa, and is not listed.
- **Price breaks** — every close-to-close move above ×1.5 or below ×0.67, what
  it resembles, and what explains it (below).
- Refused bars with the engine's codes, stale series, missing sessions.

`--refetch` runs `live.mjs --history --symbols …` for exactly the series listed,
over a window back to the first mis-dated bar plus a week. Each bar comes back
dated in its exchange's zone and the store records every changed value as a
correction. Then the bars the re-fetch superseded — a held bar on a day the
market does not trade, within a day of the span the provider has just dated,
which the provider did not supply — are taken out through the store, and each is written
to `data/price-history.rejects.json` (codes NON_SESSION_DAY, SUPERSEDED). A
series the provider returned nothing for keeps every bar. `live.mjs` takes
`--symbols A,B` and `--plan` (say what would be fetched, fetch nothing) for
this.

### Splits and consolidations: recorded by you, applied on read

No corporate-action feed is licensed here, so a split reaches the history as a
price break and nothing more. You record it in `data/price-adjustments.json`
(git-ignored), beside the history:

```json
{ "schema": 1, "actions": [
  { "symbol": "1155", "date": "2026-03-02", "ratio": 2, "kind": "split", "note": "2-for-1" },
  { "symbol": "STI", "date": "2025-10-13", "ratio": 0.25, "kind": "consolidation" },
  { "symbol": "VIX", "date": "2025-04-04", "ratio": 1, "kind": "other", "note": "the market's own move" }
] }
```

`date` is the first bar on the new basis; `ratio` is new units per old unit — 2
for a 2-for-1 split, 0.5 for a 1-for-2 consolidation; `kind` is split,
consolidation, bonus or other. Bars before the date have prices divided by the
ratio and volume multiplied by it **when read** — by the page and by
`scanner/scan.mjs` alike — and the history file is never rewritten, so a wrong
ratio is undone by fixing the record. A ratio of 1 records that a break is the
market's own move: nothing is adjusted and the break counts as explained. An
entry that cannot be read is refused with its reason; two entries for one
symbol and date are both refused. The data page lists every break with a
"record as" choice and downloads the file for you to save.

**Until a break is explained, no indicator is computed across it:** a window
that spans it is `INVALID_INPUT`, reason `UNADJUSTED_BREAK` (for EMA, RSI, ATR
and MACD the window runs until the break's weight falls below 1%), and a
crossing is not read across it.

**Never twice.** An export may already be adjusted by its provider, so imports
take `--adjusted provider | none | unknown` (default unknown), recorded on each
bar in `meta.adjusted`. A recorded action is not applied to a `provider` bar
captured after the action's date. And whatever the flag, an action whose ratio
is itself a break (above 1.5 or below 0.67) is applied only where the series
shows a break at its date — where the close barely moved, the prices are
already on the new basis. The import prints every break left in what it wrote.

`node history-store-test.mjs` (in CI) checks all of it on temporary files.

## Screenshots of your own watchlist — personal research only

A separate path, deliberately walled off from the one above.

### Where the screenshot goes

Nowhere — there is nothing to upload. This reads a file on your own PC. Three
ways in, in ascending order of effort:

```bash
# 1. snip and go — nothing to save, nothing to name
#    press Win+Shift+S, drag a box over your watchlist, then:
node ingest/watchlist.mjs --clipboard

# 2. drop the image in a folder, then run with no arguments at all
#    (takes the newest image in watchlist-shots/)
node ingest/watchlist.mjs

# 3. point at any file yourself
node ingest/watchlist.mjs --in "C:\path\to\shot.png"
```

`watchlist-shots/` is created on first run and is git-ignored — someone else's
licensed data rendered as pixels never gets committed or deployed. Running with
no image at all prints these three options rather than a usage string.

### Then

```bash
#   …look at data/watchlist-review.csv, fix anything marked CHECK…
node ingest/prices.mjs --in data/watchlist-review.csv \
     --out data/personal-prices.json --licence "personal research — not for redistribution"
```

Then open the app with `?real=1&personal=1`. Prices sourced this way are
labelled *read from your screen* and *personal research — not redistributable*
everywhere they appear, and `data/personal-prices.json` is git-ignored so it
cannot reach the deployed site.

OCR is the Windows built-in engine (`Windows.Media.Ocr`) — no install, no
dependency, no network. `ingest/ocr.ps1` is the bridge.

### Unattended daily

```bash
node ingest/autoshot.mjs --login --url "<your watchlist url>"   # once
powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 `
  -Url "<your watchlist url>" -At 18:30                          # once
```

Then it runs itself: capture → read → import → FX → report.

`autoshot.mjs` drives **its own headless browser with its own profile**, not the
window you are using. That matters: capturing your real window needs an
unlocked desktop with nothing covering it, and a task set to run while signed
out lands in session 0, which has no desktop — every capture comes back black.
A dedicated profile has none of those failure modes, cannot be disturbed by
what you are doing, and never touches your normal Chrome profile.

The scroll step is **70% of the viewport, never a fixed pixel count**. Two rows
were lost in testing at a 620px viewport with a 600px step: one fell in the 20px
seam, and one sat permanently under the sticky column header, which covers
whatever is beneath it after every scroll.

Exit codes are the reporting channel, because Task Scheduler shows the last
result and nobody reads a log that says everything is fine:

| | |
|---|---|
| `0` | imported cleanly |
| `1` | the run failed, or nothing reached the file |
| `2` | imported, but rows are held back for review |

```bash
powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 -Status
powershell -ExecutionPolicy Bypass -File ingest/schedule.ps1 -RunNow
```

**Staleness is checked, because a broken capture looks like a quiet market.** If
every page is byte-identical to the previous run — a signed-out session, a stuck
tab, a changed layout — the run stops and imports nothing. The day-move check
cannot catch this: unchanged prices produce a 0% move, which looks normal.

The review gate still applies unattended. `prices.mjs` refuses any row marked
`CHECK`, so clean rows land automatically and doubtful ones wait for you.

**The scanner runs only on a history this run updated.** If the history step
failed, the scan is skipped and the report says why — a scan of yesterday's file
is not today's scan. Otherwise `scanner/scan.mjs --trigger daily` runs, and its
exit codes are read: `0` completed, `2` partial, `3` skipped (paused, locked
by another run, no setups, or nothing new), `1` failed. A failure, a partial
scan or a lock held by another run make the daily run exit `2`; a pause you
asked for, or a day with nothing new, does not. Every daily run — whatever its
exit — is appended to `data/ingest-runs.json` (git-ignored): each step's
outcome, the scanner's status and run id, and the duration.

### Why this is separate, and why it stays separate

Reading a price off your own screen, under your own subscription, for your own
research, is fine. It confers **no right to redistribute**, and a screenshot
does not transfer one — photographing a page of a book is not a licence to
publish the text. Manual and automated extraction are alike in this: what
matters is not how the pixels became numbers but who you then serve them to.

So `watchlist.mjs` refuses to write `data/prices.json`, whatever the flags say.

### Why there is a review gate rather than a direct write

On the **first** test run against a real screenshot, Windows OCR returned
`814.30` for a price of `214.30`. One character, a 280% error, and nothing
about the output looked wrong.

A wrong price does not surface as an error downstream — it produces a confident,
fully-decomposed, source-linked valuation built on a bad number, which is the
exact failure this product exists to avoid. So OCR proposes and you dispose:

- every candidate is checked against the last known close;
- a move beyond `--max-move` (default 15%) is marked `CHECK`;
- `prices.mjs` **refuses to import any row still marked `CHECK`**;
- the raw OCR text is written alongside the CSV, because when a row is missed
  the only way to fix it is to see what the engine actually saw.

Verified end to end against a fixture with known values: 8 of 8 prices exact,
and on a second-day fixture carrying that same `814.30` misread, the bad row was
flagged and refused while the seven genuine moves — including a −4.13% day —
passed through untouched.

### FX needs no screenshot at all

```bash
node ingest/fx.mjs                                  # -> data/prices.json
node ingest/fx.mjs --out data/personal-prices.json  # merge alongside OCR prices
```

**Bank Negara Malaysia publishes the USD/MYR reference rate through its own
public API** — free, no key, and the authority for the ringgit. So this is
allowed to write `data/prices.json`, unlike the screenshot path. (Confirm BNM's
current terms before relying on it commercially: open data is not an
unrestricted licence.)

Two sources, because one rate has nothing to check it against. BNM is the
authority; **Frankfurter** (ECB reference rates) is independent of it. Agreement
is evidence, disagreement beyond `--tolerance` (default 1.5%) stops the run
without writing. Observed in practice: 4.0855 against 4.0865, **0.024% apart**.

The merge preserves every other row in the file, and the rate carries per-symbol
provenance, so an official central-bank rate sitting in a file of screen-read
prices is labelled *Bank Negara Malaysia* rather than inheriting the file's.
A file it cannot read as a price file is refused, not replaced, and the rate's
date does not become the date of the file's other rows.

Sources checked and rejected: **Stooq** (free EOD CSV, but now behind a
JavaScript browser challenge), **Yahoo Finance** (no official API, terms bar
commercial use). **Alpha Vantage** works on a free key if US end-of-day
equities are wanted without a screenshot.

### The FX rate rides along with it

Every US figure shown in ringgit passes through one number. If the price file
carries `USDMYR` — under any of `USDMYR`, `USDMYR=X`, `MYR=X`, `USD/MYR` — it
replaces the sample rate at load, and the Home card states whether it came from
a licensed file or off your screen, with its date.

This mattered more than it sounds. The sample rate was **4.42** against a real
**4.0830**: a 7.6% error on every cross-market comparison, every translated
market capitalisation and every MYR-based portfolio figure. Nothing on screen
looked wrong.

A rate outside roughly 2–8 is **refused and reported**, not applied. An inverted
quote or a misread digit — 4.08 read as 40.8 — would otherwise rescale every
ringgit figure in the product silently, and there is no visual tell for that.
The sample rate stays in use and the card says what was rejected and why.

Sample mode is unaffected: with no price file the rate stays fixed at 4.42 so
the synthetic dataset stays reproducible.

### What it is still not

Your working note. Not a source of record, not a price history, and not a
substitute for a licensed feed the moment anyone but you is looking. For charts
and trend evaluation inside a product you ship, embed a TradingView **widget** —
licensed, free, attribution only — and keep the licensed EOD feed for the
numbers the engine consumes.

### Prices change the answer, not just the display

Concretely, on Apple: with no price the cost of capital falls back to book-equity
weighting, the discount rate lands at 6.1% and the base case comes out at $187.
Supply an end-of-day close and the weighting uses market equity, the discount
rate corrects, and the base case moves to $111.

A missing price is not a cosmetic gap. It changes the valuation.
