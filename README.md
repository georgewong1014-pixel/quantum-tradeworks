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

## Checking a deployment

```bash
node deploy-check.mjs          # one check: exit 0 if production serves this file
node deploy-check.mjs --wait   # poll until it matches, or time out
```

It compares the **whole file**, not a marker string. Newlines are normalised —
the repository stores CRLF and the CDN serves LF — and nothing else is
excused; after that normalisation the two are byte-identical, so nothing is
injected in transit.

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

It does not read your screenshot. You record what you saw; OCR is phase 2 and is
not built. No indicator here has been validated on point-in-time data, so none is
claimed to work. The specification's worked example loads as a fixture and
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
node qtti/extract.mjs --simulate         # see the shape, no key, no call
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
