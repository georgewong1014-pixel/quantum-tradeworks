# Ingestion

The engine is real; the dataset shipped with the app is not. This directory is
the path from one to the other.

```bash
export SEC_UA="QuantumTradeworks/0.1 (your@email.com)"   # the SEC requires a contact
node ingest/sec.mjs --years 10 --out data/us.json AAPL MSFT JPM XOM
```

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

## What SEC gives you, and what it does not

**Yes** — audited US annual and quarterly fundamentals, free, official,
unauthenticated, no redistribution licence needed for the reported facts.

**No** — prices, corporate actions, intraday anything, analyst estimates, and
any non-US issuer. **There is no Bursa Malaysia equivalent.** That asymmetry
shapes the whole roadmap: a real US research product costs nearly nothing in
data; the Malaysian half, which is the actual differentiation, is licensed.

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

Validation **rejects rather than repairs**. A negative close, a future date, or
a close above its own stated 52-week high is reported and dropped, because a
price that fails a sanity check is a data problem to look at rather than
something to coerce into the file.

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
