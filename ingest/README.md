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
