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
| **US companies** | 119 | Audited annual statements from SEC EDGAR's XBRL `companyfacts`. Real. |
| **Malaysian companies** | 18 | Illustrative. Financials are synthetic, listing codes are real. |
| **Prices** | 0 | No company carries a licensed market price. |

Every company page states which of the two it is. Because no price is licensed,
everything price-derived — market capitalisation, multiples, yield, difference to
model estimate — is shown as unavailable rather than estimated.

**Do not use any number here for an investment decision.** A production
deployment would require licensed market data for both markets and, in Malaysia,
written legal classification of each surface under the Capital Markets and
Services Act before launch.

---

## Run it

No build step. It is one static HTML file.

```bash
node serve.mjs            # http://localhost:3000
```

Screenshot tooling (drives locally installed Chrome/Edge over the DevTools
Protocol; no dependencies):

```bash
node screenshot.mjs http://localhost:3000 home
node screenshot.mjs http://localhost:3000 home-dark --dark
node screenshot.mjs http://localhost:3000 home-mobile --width 390 --height 844
```

Output goes to `./temporary screenshots/` (git-ignored).

## Structure

```
.
├── index.html        # the entire application
├── serve.mjs         # zero-dependency static server
├── screenshot.mjs    # zero-dependency screenshot tool (CDP over Node's WebSocket)
└── package.json      # metadata only
```

## What is in it

**Equities research** — 137 companies as deployed: 119 US filers with audited
statements and 18 illustrative Bursa companies. Raw statement lines are stored
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

**Property Deal Check** — turns a property into a financial model: true
acquisition cost with Malaysian stamp duty scales, financing, vacancy,
maintenance, NOI, cash-on-cash, DSCR, ten-year scenarios, exit costs with RPGT,
and a comparison against putting the same cash into equities.

**Not an official valuation.** In Malaysia that requires a registered valuer.

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
