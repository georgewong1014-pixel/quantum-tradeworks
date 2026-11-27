Internal research method notes. Not financial, investment or property advice.
Status: draft from repo, 27 Nov 2026
Last checked against code: 2818eba23

# Methodologies

How each product turns inputs into outputs. Each block gives plain words first, then the numbers, then the source path. The thresholds here are the ones in the code; the code does not always say why a threshold was chosen, and where it does not, the note says `UNKNOWN - George to confirm [Qn]` (see open-questions.md).

Contents: 1 Versions and the "moved" rule; 2 Equities (measures, pillars, composite, risk, valuation, screener); 3 Governing document; 4 Scanner; 5 Trading Index; 6 Property (illustrative defaults, fee rulebook, gains tax, grade, auction and new development); 7 Data sources, update frequency and licence positions; 8 Known limits.

## 1. Versions, data stamps and the "moved" rule

In plain words: every saved item (a valuation run, a saved screen, a saved property, an investment case) is stamped with the version of the model and of the data it was built from. When the item is reopened, the code compares the stamp with the build in front of it and says what moved, instead of silently showing a changed figure.

- Model version: `MODEL_VERSION = 'metrics 1.7.1 · scores 1.4.1 · valuation 1.5.1'` and `AS_OF = '30 Jul 2026'` (the illustrative set's date), `src/js/15-derivation.js:33` and `:34`. The comment block above them lists why each part was bumped.
- Data version: each versioned data file is hashed by `dataVersions()` in `build.mjs` (sha256 of the file, first 12 hex characters) for `us.json`, `instruments.json`, `sarawak-geo.json`, `sarawak-reach.json` and the Kuching map files, plus each NAPIC division file as written; the result is injected into `DATA_VERSIONS` (`src/js/00-core.js:21`). The illustrative set, which is compiled into the code, is dated by `AS_OF`. The personal fundamentals file is never hashed (`buildStamp`, `src/js/15-derivation.js:78`).
- Stamp: `buildStamp(subject)` records `{ v: 1, model, data, asOf, illustrative: 'none'|'some'|'all', savedAt }`, and for a property also `fees: FEE_TABLE.version` (`src/js/15-derivation.js:78` to 118). A property's data files are the NAPIC file of the division its place lies in plus `sarawak-geo.json` (`STAMP_FILES`, line 68).
- The rule: `stampDiff(stamp, legacy, subject)` (line 172) compares the stamp with now.
  - Equities items: status is `current`, `model` ("Model moved: <part> <then> → <now>"), `data` ("Data moved: saved against SEC filings <hash> ... now <hash>" or "the illustrative set was dated X; it is now dated Y"), or `both` ("Model and data moved"). An item saved before stamps existed reads "Saved before versions were recorded" and is never reported current.
  - Property items: `propertyStampDiff` (line 149) reads the fee rulebook and the property data files, never the equities model: "Fee rulebook moved: saved on X, now Y.", "Data moved: ...", "Fee rulebook and data moved"; a property saved before the rulebook was recorded reads "Saved before the rulebook was recorded" and is not reported moved or current.
- Where it is shown: saved work, reopened runs and `/company/:id/report?run=<id>` (which prints the saved figures and states that live data has moved; `src/js/47-report.js` header).

## 2. Equities

### 2.1 Derived measures
In plain words: nothing is stored as a ratio. Every measure is computed from the statement lines, and the metric dictionary shows the formula and the exact inputs. A missing line stays missing; it is never read as zero.
Examples, each in `src/js/13-metrics.js` (`formula:` strings; lines 96 to 323):

```text
ROIC          = EBIT x (1 - tax rate) / (equity + debt - cash)        TAX: US 0.21, MY 0.24 (15-derivation.js:599)
Op. margin    = EBIT / revenue
FCF           = operating cash flow - capex
FCF margin    = (operating cash flow - capex) / revenue
ROE           = net income / average shareholders' equity
Cash conv.    = operating cash flow / net income
CAGR (4y)     = (latest / earliest)^(1/n) - 1
Net debt/EBIT = (debt - cash) / EBIT
P/E, P/B, EV/EBIT, FCF yield, dividend yield: need a price (none is licensed for filed companies)
Net buyback   = negative of the share-count CAGR
Earnings var. = standard deviation of year-on-year net income growth
Revenue DD    = largest peak-to-trough fall in revenue
```
Data completeness is the share of the counted measures that could be computed (`COVERAGE_KEYS`, `src/js/13-metrics.js`; header notes that adding a key changes every coverage figure).

### 2.2 Pillar scores
In plain words: each input is mapped linearly between a low and a high anchor to 0 to 100 (reversed where lower is better), then the inputs are averaged by weight over the inputs that could be computed; the coverage of weight tested is reported with the score.

```text
anchor(v, lo, hi, invert) = clamp((v - lo) / (hi - lo), 0, 1) x 100      (15-derivation.js:1095)
pillar score = round( sum(score_i x w_i) / sum(w_i of inputs held) )     (scorePillar, line 1351)
```
Weights and anchors are in `PILLARS` (line 1251) and `VALUE_PILLAR` (line 1337). General business type:

| Pillar | Inputs (weight; low to high anchor) |
|---|---|
| Business Quality | ROIC (.35; 2 to 30), operating margin (.25; 2 to 35), FCF margin (.20; 0 to 30), revenue growth stability (.20; 3 to 40, inverted) |
| Growth Quality | revenue CAGR 4y (.30; -2 to 22), earnings CAGR 4y (.30; -4 to 25), FCF CAGR 4y (.20; -6 to 25), earnings consistency (.20; 5 to 60, inverted) |
| Financial Strength | net debt/EBIT (.45; 0 to 5, inverted), debt/equity (.25; 0 to 2.5, inverted), FCF margin (.15; -5 to 25), book value CAGR 4y (.15; -5 to 18) |
| Capital Allocation | net buyback yield (.25; -4 to 4), payout ratio (.25; 95 to 25), dividend cover by FCF (.25; 110 to 30), return on reinvestment (.25; 2 to 30) |
| Valuation Evidence | difference to base-case model estimate (.6; -35 to 45), FCF yield (.2; 0 to 9), dividend yield (.2; 0 to 6) |

Bank and REIT variants of Quality, Strength and Capital Allocation exist in the same table (for example bank Quality: ROE .40, net interest margin .25, cost-to-income .25, impaired loans .10). The valuation pillar is scored in `src/js/25-universe.js:230` from `VALUE_PILLAR`. Basis for the anchor values and weights: UNKNOWN - George to confirm [Q11].

### 2.3 Research composite
In plain words: five framework pillars carry fixed weights; only the pillars that could be scored are averaged, and the tested weight is shown beside the score. The score is not rescaled to 100, because that would treat untested pillars as examined.

```text
quality+growth+capital (equal thirds of the scores held)  35
valuation evidence                                         30
balance sheet and risk (the Financial Strength score)      15
catalysts and change                                       10   (no data held: untested)
macro and sector context                                   10   (no data held: untested)
composite = round( sum(score x w over tested) / tested weight )
classified only if data completeness >= 70%   (researchComposite, 15-derivation.js:1172)
```
Bands (`COMPOSITE_BANDS`, line 1165): 85 and above "Research criteria strongly met"; 70 "Several criteria met"; 55 "Mixed research case"; below 55 "Research criteria not met". The governance hard gate is always `manual_review` because no governance data is held. Moat is declared "not scored" (`SCORECARD_COVERAGE`, line 1222).

### 2.4 Risk flags and risk grade
In plain words: flags are computed from the statements; each severity has a weight; the grade is the clamped sum. Rules include net debt above 3.5 times EBIT (serious), bank impaired loans above 2.0% (warning), earnings variability above 35 points (warning), revenue drawdown above 20% (warning), share count growing more than 1.5% a year (warning), dividends above 100% of FCF (serious), negative FCF (serious), REIT gearing above 40% (warning), PN17 status (critical, from the illustrative set's own flag).

```text
weights: critical 40, serious 22, warning 11, good -10      (riskGrade, 15-derivation.js:1408)
raw = clamp(sum of weights, 0, 100); High if raw >= 45; Medium if >= 22; else Low
```
Source for the flags: `riskFlags`, `src/js/15-derivation.js` (above line 1408). Basis for the thresholds: UNKNOWN - George to confirm [Q11].

### 2.5 Valuation model router
In plain words: the business type picks a model pack; the pack's default assumptions come from the company's own history and are shown as editable inputs; the studio recomputes the range, sensitivity grid and driver ranking on every change; bear and bull cases shift published drivers.

Routing (`routeModel`, `src/js/20-valuation.js:56`): bank to residual income (`ri`); insurer to `insurer`; early-stage to `early`; REIT to distribution discount (`ddm`); cyclical to mid-cycle FCFF (`dcfMid`); growth or software to the scenario model; holding company to sum-of-parts (`sotp`); everything else to FCFF DCF (`dcf`). Each pack publishes its reason, secondary checks and limits (`MODEL_PACKS`, line 13).

Default cost of capital (`defaultInputs`, lines 69 to 74 and 246 to 247):
```text
base rate (riskFree)  US 4.2, MY 3.9 (percent);   equity risk premium  US 4.6, MY 5.0
beta by type: mature .95, growth 1.45, saas 1.20, cyclical 1.30, bank .95, reit .85, holding 1.10, other 1
cost of equity = riskFree + beta x ERP
after-tax cost of debt = (riskFree + 1.2) x (1 - TAX[market])
WACC = (CoE x E + after-tax CoD x D) / (E + D); E = market cap, or book equity if no price
terminal growth gt: US 2.5, MY 3.0
```
Source of the base rate (riskFree), premium, beta and spread figures: UNKNOWN - George to confirm [Q12]. (`src/js/65-learn.js` header text says they are not all published.)

FCFF DCF (`valueDCF`, line 310): growth fades linearly from the year-1 rate g1 to terminal growth gT over the forecast years (default 5); each year's flow is discounted at WACC; terminal value = last flow x (1 + gT) / (r - gT); equity = enterprise value - net debt + the reader's signed adjustment; a holding discount applies only to positive equity (20 percent default for a holding company). It refuses (returns an error rather than a number) when terminal growth is not below the discount rate, starting FCF is not positive, net debt is unknown, or no share count is held. Default g1 = clamp(0.75 x revenue CAGR, -2, 14).
Residual income (`valueRI`, line 345): justified P/B = (ROE - g) / (CoE - g); value per share = book value per share x justified P/B; default sustainable ROE = clamp(0.97 x ROE, 4, 20) (insurer 0.95, 4 to 26); growth capped at ROE x retention.
Distribution discount (`valueDDM`, line 357): default growth = clamp(0.7 x distribution CAGR, 0, 3.5), 2 if none; refuses when growth is not below the required return.
Scenario and early-stage packs (`valueScenario` line 370, `valueEarly` line 460): revenue, margin and cash conversion are separate inputs; the scenario default holds the current margin rather than assuming expansion; the early-stage pack adds a probability of success (default 35) and burn.
Scenario shifts published in `SCENARIO_SHIFT` (line 669): for example DCF bear = growth -4, WACC +1.2, terminal growth -0.5; bull = +4, -1.0, +0.4. Equity is floored at nil (`floorEquity`, line 308).

### 2.6 Screener
In plain words: a company passes only if it clears every criterion; a figure that is not held excludes the company and says why; templates are named rule sets whose threshold is what the name states, not a judgement that clearing it is good.
Rules: evidence class, universe, sector, business type, minimum data completeness, then each minimum or maximum (`evaluateScreen`, `src/js/40-views-discover.js:1356`). Templates (`SCREEN_TEMPLATES`, line 1211) include: High returns on capital (ROIC at least 15 and ROE at least 15); Profit that arrives as cash (cash conversion at least 90, FCF margin at least 5, operating cash flow positive in at least 4 of 5 years); Growth with margins intact (revenue CAGR at least 5, operating margin at least 10, FCF margin at least 0); Consistent profitability (operating margin at least 8, earnings variability at most 25, revenue drawdown at most 20); Conservative balance sheet (net debt/EBIT at most 1.5, debt/equity at most 0.6); Net cash; Quality at reasonable valuation v1.0.0 (quality score at least 80, valuation score at least 60, estimate at least 20% above price, completeness at least 80, with the governance rule carried but untestable); Dividend cover; Malaysian banks, REITs, plantation, infrastructure, Shariah-flagged and PN17-excluded sets (flags authored in the illustrative set and not checked against a regulator's list).

## 3. The governing document (IPS)

In plain words: every asset class is assessed against the same eight gates in the same order, with the verbs changed so the output describes the evidence and does not instruct the reader.
- `IPS_VERSION = 'IPS 1.0 · 20 August 2026'` (`src/js/18-ips.js:39`). Gates (`IPS_GATES`, line 68): 1 eligibility and investability, 2 capital requirement, 3 demand and quality, 4 return engine, 5 net economics, 6 valuation and margin of safety, 7 execution plan, 8 exit and liquidity (`IPS_GATES` ids: eligibility, capital, demand, engine, net, margin, execution, exit). Mapping stated in the file header: a hard gate that refuses to answer replaces "Reject"; "Meets every condition in the methodology" replaces "Buy"; "Conditions not yet met, N outstanding" replaces "Watch/Hold".

## 4. Scanner

In plain words: the reader defines conditions; the engine tests them on the last final bar of the reader's own price history; a match is a record that the conditions held, with the values, not a signal.
- One engine: `src/js/24-market-engine.js`, region between `@scan-engine-start` and `@scan-engine-end`, `SCAN_VERSION = '0.3.0'` (line 47). `scanner/scan.mjs` slices that region out of `index.html` and runs it in Node, and every run self-tests it first.
- Indicators (`SCAN_INDICATORS`, line 1204): price, volume, SMA, EMA (seeded with the mean of the first n closes, k = 2/(n+1)), RSI (Wilder, n default 14), MACD (12, 26, 9), average volume, Bollinger (population standard deviation, k default 2), ATR (Wilder), highest/lowest high and low over n bars (default 252), highest/lowest close, change over n bars, relative volume (current bar excluded from its own reference), plus the reader's Pine-derived indicators (`SCAN_PINE_INDICATORS`, line 1017).
- Operators: GREATER_THAN, LESS_THAN, their OR_EQUAL forms, EQUALS, CROSSES_ABOVE, CROSSES_BELOW, BETWEEN, with a float tolerance of one billionth of the larger value, never less than 1e-12 (`SCAN_TOLERANCE`, line 398). Rule trees may nest ALL/ANY groups up to three deep and twenty conditions; timeframes 1D or 1W (`scanner/setups.example.json` note).
- Bar finality: a bar is final only when its capture time falls after the session close plus a settle margin; with no capture time it is UNKNOWN. Markets: US 09:30 to 16:00 New York, settle 30 minutes; MY 09:00 to 17:00 Kuala Lumpur with a 12:30 to 14:30 break, settle 30; FX close 17:00 New York, settle 0 (`SCAN_MARKETS`, line 104).
- Filters and ordering: none by strength. Alerts land in the order of setups, then instruments; market screening lists symbols alphabetically (`src/js/87-scanner-ops.js` header).
- Catch-up: up to ten completed bars are evaluated per pair so a missed day still records its crossings (`scanner/scan.mjs`, "VERSIONS, AND WHAT A MISSED DAY LOSES").
- Historical testing is a simulation of dates with no entry, exit, cost or return (`src/js/87-scanner-ops.js` header).
- Known limits (`src/js/24-market-engine.js` header): no exchange calendar (sessions are inferred), no corporate-action feed (a split shows as a break; adjustments only from `data/price-adjustments.json`), no indicator validated on point-in-time data.

## 5. Trading Index (qt-trading-index-1.0.0)

In plain words: three separate numbers are never averaged together: the trend regime (market), tranche readiness (the user's own pre-declared rules) and screenshot confidence (how much the image supports). The monthly timeframe carries the most weight so a daily bounce cannot be read as a confirmed uptrend.
- Timeframe weights: monthly 0.40 (minimum 48 bars), weekly 0.35 (104), daily 0.25 (250) (`QTTI_TIMEFRAMES`, `src/js/85-trading-index.js:86`).
- Regime bands (line 91): 0 to 24 structural downtrend; 25 to 39 bearish or counter-trend; 40 to 54 transition or range; 55 to 69 emerging uptrend; 70 to 84 confirmed uptrend; 85 to 100 strong uptrend.
- Screenshot confidence parts (line 98): metadata .25, panels .20, indicators .25, legibility .15, recency .15; bands 85, 70, 65, below.
- Tranche readiness parts (line 112): higher-timeframe alignment .25, daily trigger .20, volume .10, entry location .15 (set by the user), breadth .10, risk definition .15, data confidence .05, plus a "confirmation or conflict" group in the evidence table (line 84); bands 80, 65, 50 (`QTTI_TRANCHE_BANDS`, line 121).
- No vision or OCR on the page; the off-page extractor `qtti/extract.mjs` writes a draft only and nothing is scored until a person confirms it.

## 6. Property

### 6.1 Illustrative defaults
In plain words: the calculator opens on a sample deal so it can compute something; every default is marked as an assumption or a sample, and a "sample input still to review" gate caps the grade until the reader replaces the figures that drive the result.
`PROPERTY_DEFAULT_DEAL` (`src/js/70-property.js:626`): Kuching, Tabuan, project p1, condominium, strata title, remaining lease 88, 1,050 sq ft, 1 parking; price RM572,000, renovation RM25,000, deposit 10%, loan rate 4.30%, tenure 35 years; rent RM1,850 a month, rent growth 2.5%, vacancy 9%; maintenance RM294, assessment RM800, quit rent RM300, insurance RM450, repair reserve 5%; hold 10 years, appreciation 3.0%, 6 months to sell, agent 2.0%, exit legal 0.5%; comparison return 7.0%; reserve 3 months; seller category citizen; evidence kinds price "user", rent "estimated", maintenance "developer", vacancy and appreciation "assumed". Marginal tax is null (not stated) so figures read as pre-tax. Hold is a whole number from 1 to 30 (`HOLD_YEARS_MAX`, line 697). Basis for each sample value: UNKNOWN - George to confirm [Q13].

Financing basis (`dealModel`, `src/js/75-property-grade.js:564`): loan = lender value basis x (100 - deposit%) / 100; the basis is the lower of price and the bank valuation when one is entered (rule `lower_of`, replaceable with `valuation_only`), else the price, stated as an assumption; the valuation gap is cash the buyer must find. Entered margin and 70, 80, 90 are shown as scenarios. Stress rows: rate +0, +1, +2, +3 points; vacancy as entered, 15, 25, 40 percent; renovation +0, +25, +50, +100 percent (line 1303).

### 6.2 Fee rulebook (FEE_TABLE)
In plain words: every purchase cost line is computed from a cited rule, carries a provenance kind and a checked date, and is never presented as a quotation unless the reader typed one; an estimate is marked wherever it appears and the total says how much rests on unverified lines.
- Identity: `FEE_TABLE.id = 'my-property-fees'`, `version: '1.5.0'`, `checkedOn: '2026-10-15'` (last check of every line together), jurisdiction Sarawak (`src/js/70-property.js:1894`). `reviewOwner: null`, `reviewOwnership: 'pending'`, `nextReviewDue: '2026-12-15'`: no named reviewer has accepted responsibility (comment above the field). Who will be the reviewer: UNKNOWN - George to confirm [Q1].
- Provenance kinds (`FEE_PROVENANCE`, line 1888): verified (computed from the rule in an official text read on the checked date), estimated (an approximation so the total runs), quote (a figure the reader entered), unknown (no rule verified; no other jurisdiction's rule is applied silently). A line charged on other lines takes the weakest provenance of itself and its bases (`resolveFee`, line 2359).
- Categories: statutory, professional (published scale), quotation, optional, estimate (`categories`, with notes).
- Lines and status at this commit (`lines`, from line 1957):

| Line | Category | Provenance | Checked | Basis |
|---|---|---|---|---|
| Transfer stamp duty (MOT) | statutory | verified | 2026-10-08 | Stamp Act 1949 First Schedule Item 32(a): per RM100 or part, 1% on the first RM100,000, 2% to RM500,000, 3% to RM1,000,000, 4% above (slice sizes in the scale rows `[100000, .01], [400000, .02], [500000, .03], [Infinity, .04]`), charged on the price here; assumes a citizen or permanent-resident buyer |
| Purchase legal fees | professional | verified | 2026-10-08 | Sarawak Advocates' Remuneration Rules scale (Swk. L.N. (F) 348 of 2022); minimum RM500; the Peninsular scale is held only as a reference |
| Loan legal fees | professional | verified | 2026-10-08 | same Rules |
| Loan stamp duty | statutory | verified | 2026-10-08 | |
| Valuation fee | professional | estimated | 2026-10-25 | Board of Valuers scale carried at its ceiling, minimum RM400, charged on the value the valuer finds (the bank or valuer estimate once entered, else the price); nil without a loan |
| Charge stamp duty | statutory | verified | 2026-10-09 | |
| Registration | statutory | verified | 2026-10-09 | |
| Disbursements | estimate | estimated | 2026-10-09 | |
| Service tax on professional fees | statutory | verified | 2026-10-08 | |
| Service tax on valuation fee | statutory | verified | 2026-10-08 | |
| Mortgage protection | optional | estimated | 2026-10-09 | off by default; left out of cash required until included or quoted |
| Utility deposits | estimate | estimated | 2026-10-08 | |

- Purchase legal fee by route (`FEE_TABLE.routeRules.routes`, `src/js/70-property.js:2251`): subsale is "assumed" (rule 1 full scale on the price); auction and new development are "not-decided" by the Rules, so rule 1 on the price or bid stands until the reader enters a lawyer quote.
- Class gate (1.2.0): a line whose rule differs by property class and has not been checked for that class has no amount on a commercial property or on land, and reads "Unavailable - not yet checked for commercial property" (`feeGate`, line 2425).
- Changelog (`changelog`, newest first): 1.5.0 (2026-10-25, amounts change): valuation fee charged on the valuer's value, not the price. 1.4.0 (2026-10-15, no amounts): re-check after Budget 2027 tabled 9 Oct 2026. 1.3.0 (2026-10-13, no amounts): purchase legal fees by purchase route, read in the gazette. 1.2.0 (2026-10-10, amounts): class gate. 1.1.0 (2026-10-09, amounts): mortgage protection becomes an optional line. 1.0.0 (2026-10-08): replaced the unverified 0.1.0 draft with verified stamp duty, Sarawak advocates' scale and service tax. A changelog row marked `amounts: true` must match a row in the corrections log (`model-test.mjs` holds it, per the comment above the changelog).
- Where shown: `/data-sources` (`feeRulebookCard`, `src/js/70-property.js:2571`).

### 6.3 Real property gains tax (RPGT_SCHEDULE)
In plain words: the exit charge depends on who sells and for how many completed years the property was held; the rates are stored in a registry that is marked unverified, so it says out loud that nobody has checked it.
`RPGT_SCHEDULE` (`src/js/70-property.js:2697`): `status: 'unverified'`, source "Real Property Gains Tax Act 1976, Schedule 5", `sourceUrl`, `effectiveFrom`, `verifiedAt`, `verifiedBy`, `reviewOwner` and `nextReviewDue` all null. Rates by completed years held (1, 2, 3, 4, 5, later), percent: citizen or permanent resident 30, 30, 30, 20, 15, 0; Malaysian company 30, 30, 30, 20, 15, 10; non-citizen 30, 30, 30, 30, 30, 10. Individual relief (Schedule 4): greater of RM10,000 or 10% of the gain, individuals only, unverified. Holding period for a purchase under an SPA runs from the SPA date (Schedule 2 paragraph 15, checked 2026-10-13). Verification date and reviewer of the rates: UNKNOWN - George to confirm [Q2].

### 6.4 The Sarawak checklist and the research grade
In plain words: the checklist asks questions and names who can answer them; the grade averages six pillars over what could be tested, but hard gates cap the whole grade and are not averaged.
- Checklist ids (`SARAWAK_CHECKS`, line 1767): title-restricted, lease-remaining, strata-issued, flood, single-employer, transient-demand, parking, supply, comparables, resale-time. Each has an `adverse` answer (the one that raises a risk).
- Pillars (`GRADE_PILLARS`, `src/js/75-property-grade.js:248`):

| Pillar | Weight | How scored (`propertyGrade`, line 338) |
|---|---|---|
| Evidence quality | 20 | mean evidence rank of the figures that drive the result / 5 x 100 (ranks: verified 5, public 4, you supplied 3, developer 2, estimated 1, assumed 0, `EVIDENCE` line 450); capped at 50 when rent has no transacted support |
| Price and valuation support | 15 | 100 - 8 x (valuation gap as % of price), clamped 0 to 100; null if no bank or valuer estimate |
| Financing resilience | 20 | clamp((DSCR - 0.9) / 0.6 x 100, 0, 100); 100 for a cash purchase; DSCR = NOI / annual debt service |
| Rental cash flow | 20 | clamp(net yield / 5 x 60, 0, 60) + (40 if monthly cash flow is not negative, else clamp(40 + monthly / 40, 0, 40)) |
| Downside and exit | 15 | clamp(50 + worst stressed month / 30, 0, 100) over the rate and vacancy stress rows |
| Local demand and management readiness | 10 | share of checklist questions settled without an adverse finding |

- Score = round(sum(score x weight) / tested weight); coverage = tested weight / total weight.
- Grade: U if any gate caps at U, or coverage under 80%, or no score; otherwise A at score 80 or more and coverage 90% or more, B at 65 or more and coverage 80% or more, C at 50 or more, else D; a gate capping at B turns an A into a B. Verdicts: A "Meets the selected criteria", B "Conditional - verify the named items", C "Does not yet meet several criteria", D "Does not meet the selected criteria", U "Not enough evidence" or "Not gradeable for this class".
- Gates: title unknown or restricted (cap U); sample inputs driving the result not yet reviewed (cap U); DSCR below 1 (serious); break-even above 100% occupancy (serious); no safe reserve (cap B); no verified comparable on a custom project (cap B); entered price more than 15% from the median of verified comparables (warning); rent not supported by an executed tenancy or verified comparable (warning, caps the evidence pillar).
- For a class with no tenancy (land), the financing and cash-flow pillars are marked inapplicable and the grade is withheld with that reason.
- Separate diagnostics, never combined with the grade: Borrower Loan Readiness (`READINESS_COMPONENTS`, line 115: affordability 25, credit 20, income 20, buffer 15, documents 10, structure 10) and Property Financeability (`FINANCEABILITY_COMPONENTS`, line 262: title 25, valuation 20, status 15, tenure 10, condition 10, liquidity 10, documents 10). Neither is an approval probability (file header).
- Basis for the grade cut-offs and the yield and cash-flow scaling: UNKNOWN - George to confirm [Q14].

### 6.5 Auction and new-development models
- Auction (`auctionModel`, `src/js/75-property-grade.js:1846`; page `src/js/83-property-decision.js` P3): nothing of the sale is assumed; the reader enters the Proclamation's terms (reserve, deposit, days to pay, arrears passed to the buyer, estimates). Six checks (`AUCTION_CHECKS`, `src/js/70-property.js:848`: occupancy, title and encumbrances, outstanding charges, developer status, repair condition, the Proclamation's terms) must be ticked before any figure is final; until then the page says "Not final: N checks open".
- New development (`newDevModel`, line 2132; page P4): developer premium against a completed comparable the reader names, interest during construction from the reader's drawdown schedule (Sarawak's prescribed stage percentages are offered only as a cited template), monthly position from vacant possession, exit values at VP+3, VP+5 and VP+10 labelled Modelled, never a forecast.
- Price solve: `solveDealPrice` (line 1746) is a goal-seek on `dealModel` to the ringgit for a target the reader sets.

## 7. Data sources, update frequency and licence position

| Data | File and producer | Source and licence position (from code) | Update frequency |
|---|---|---|---|
| US statements, 119 companies | `data/us.json` by `ingest/sec.mjs` (`generated 2026-08-03T00:16:33.980Z`) | SEC EDGAR company facts, public domain (`DATA_LICENCES` id `public-domain`, `src/js/19-data-licence.js:40`); the ingest requires a contact string in the request header (`ingest/README.md`) | Run by hand (command in `ingest/README.md`); repository shows no schedule. Intended cadence: UNKNOWN - George to confirm [Q3] |
| Illustrative equities, 36 records | `src/js/10-dataset.js` | Hand-authored, synthetic; earlier history reconstructed by deterministic growth bands (`BACKCAST_BAND`, line 53); dated `AS_OF` 30 Jul 2026 | With a code change. How the authored figures were chosen: UNKNOWN - George to confirm [Q15] |
| Malaysian statements | `ingest/fundamentals.mjs`, output git-ignored | Obtainable but not licensed; the writer refuses to put unlicensed output in a tracked file (file header) | Not shipped |
| Prices | `ingest/prices.mjs`, `ingest/live.mjs`, `ingest/providers.mjs` | Licensed providers only may write the served file `data/prices.json`; anything else writes git-ignored files; none is connected (`learnData`) | None served |
| Reader's own price history | `data/price-history.json` via `ingest/daily.mjs`, `ingest/history-import.mjs` | The reader's own subscription or export; git-ignored; no feed licensed (`src/js/86-scanner.js` header) | Daily task on the owner's machine (`ingest/schedule.ps1` default 18:30); whether it is registered: UNKNOWN - George to confirm [Q6] |
| USD/MYR | `ingest/fx.mjs` | Bank Negara Malaysia open API cross-checked with Frankfurter (ECB reference rates); disagreement is a reason to stop; BNM's current terms to be confirmed (file header) | With the daily run unless `--no-fx`; confirmation of BNM terms: UNKNOWN - George to confirm [Q16] |
| NAPIC / JPPH H1 2025 | `data/napic-h1-2025.json` (aggregate) and `data/napic-h1-2025/*.json` (12 division files, written by `build.mjs`); `napic-ingest.mjs` | Aggregates, sample benchmarks and curated prominent sales only; record-level data is "licence pending" (`SARAWAK_TRANSACTION_SOURCES`, `src/js/19-data-licence.js:83`: Open Sales Data licence-pending, Data Visualisation derived-only, quarterly publications derived-only, e-Data/PRISM licence-pending) | Half-yearly period H1 2025; next update: UNKNOWN - George to confirm [Q4] |
| Sarawak coordinates | `data/sarawak-geo.json` by `ingest/sarawak-geo.mjs` (retrieved 2026-08-03) | OpenStreetMap via Nominatim, ODbL 1.0, attribution; income layer is git-ignored because its licence terms could not be read | Run by hand; cadence UNKNOWN - George to confirm [Q5] |
| Population and places | `data/sarawak-reach.json` by `ingest/sarawak-reach.mjs` (retrieved 2026-11-01, population as of 2026-01-01) | DOSM district population (portal states CC BY 4.0; DOSM's own terms page could not be retrieved) and OpenStreetMap via Overpass (ODbL); shown, never scored or ranked | Run by hand; cadence UNKNOWN - George to confirm [Q5]; confirmation of DOSM terms: UNKNOWN - George to confirm [Q17] |
| Kuching map | `data/map/` (self-hosted tiles and styles) | OpenStreetMap contributors; `data/map/LICENSE-protomaps-basemaps.md` | With `map-assets.mjs` runs |
| Brickz, EdgeProp, Sarawak Land and Survey | not loaded | Restricted; no scraping (`SARAWAK_TRANSACTION_SOURCES`, `learnData`) | Not applicable |

Licence states (`DATA_LICENCES`, `src/js/19-data-licence.js:35`): own, public-domain, open-attrib, licence-pending, derived-only, licensed, restricted. Each carries `show`, `export` and `publish` flags; a figure's licence is a separate axis from its evidence grade. The open NAPIC questions are in `NAPIC_LICENCE_QUESTIONS` (line 165); every one is stated as open in `learnData` (`src/js/65-learn.js`), and when each is answered: UNKNOWN - George to confirm [Q7].

## 8. Known limits (stated by the code)

- No licensed price feed and no Bursa financial statements: price-derived measures on filed companies are unavailable (`learnData`).
- Scores test only financial-statement ratios; moat, governance, catalysts and macro are untested and declared so (`SCORECARD_COVERAGE`, `COMPOSITE_PILLARS`). Every growth input is historic.
- Valuation outputs are model estimates from editable assumptions; terminal value often carries more than half the total (`MODEL_PACKS.dcf.limits`).
- Property results are arithmetic on entered figures, not a valuation, forecast or lender decision; fee lines rest on the rulebook's checked date; RPGT rates are unverified (6.3).
- The scanner reads only the reader's own history and records conditions, not outcomes.
- Taxes, rates and scales change at each Budget; re-check after each (`nextReviewDue`, `FEE_TABLE` comment).
