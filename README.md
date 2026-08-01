# Quantum Tradeworks

A Malaysia-first cross-asset **research** prototype covering US and Bursa Malaysia
equities alongside Malaysian property.

> **Research only.** This product provides analysis, evidence and tools. It does
> not provide investment advice, personal recommendations, ratings, target prices
> or a suitability assessment, and it does not execute trades. See the scope
> statement in the app under **Plans** or **Learn → Corrections & model changes**.

---

## ⚠️ All financial data is synthetic

Every figure in this prototype is **fabricated sample data created for interface
demonstration**. Nothing is sourced from filings, exchanges or any market-data
vendor. Company names and Bursa listing codes are used only to make the interface
legible. **Do not use any number here for an investment decision.**

A production deployment would require licensed market data for both markets and,
in Malaysia, written legal classification of each surface under the Capital
Markets and Services Act before launch.

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

**Equities research** — 36 sample companies (18 US, 18 Bursa). Raw statement
lines are stored once per company and every ratio, score and valuation is derived
at runtime, so each number can show its own formula and inputs.

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

## Deliberately absent

Accounts, server persistence, billing, trial and renewal, licensed market data,
AI analysis, and any form of recommendation. These are documented in-app under
**Learn → Data, rights & point-in-time**, so the product never claims a capability
it does not have.

## Licence

Private and unlicensed. All rights reserved.
