# 02 — Financial integrity

Audit of 9 November 2026. Independent of the application's own expected values: every "Independent expected" figure below was derived by a separate script that imports nothing from the app (`quantum-tradeworks-handoff/results/launch-audit-2026-11-09/known-answer-check.mjs` for the served sample, `known-answer-cases.mjs` for the four further cases); "Actual" is what `dealModel` returned in the served page (read with `screenshot.mjs --eval`, saved as `ka-actual.json`) or what the page prints.

## Method

1. Source formula located in `src/js/70-property.js` (fee rulebook `FEE_TABLE` 1.5.0, `monthlyInstalment`, `balanceAfter`, `stampDutyMOT`, `RPGT_SCHEDULE`) and `src/js/75-property-grade.js` (`dealModel`, one engine for the calculator, the Scenario Lab, saved records, the proposal and the printed report).
2. Each fee line re-derived from the rule the rulebook *states* (banded scales, rounding unit, minimum), not from the app's code.
3. Standard finance for the loan (level-payment annuity), yields, NOI, break-even, exit, RPGT.
4. Three realistic deals plus two boundaries; tolerance RM0.01 on amounts, 1e-6 on rates.
5. Statutory correctness assessed separately from arithmetic (section 4).

## 1. Known-answer cases (property)

| Case | Deal | Figures compared | Differences | Result |
|---|---|---|---|---|
| A — the served sample | price 572,000; 10% deposit; 4.30% × 35y; rent 1,850; 9% vacancy; hold 10y | 20 (loan, repayment, 12 fee lines, NOI, position, yields, reserve, cash required, break-even, exit, RPGT, IRR/NPV identity) | 0 | Match to the sen |
| B | 350,000; 20%; 3.9% × 30y; rent 1,400; 8%; hold 5y (RPGT 15% band) | 29 | 0 | Match |
| C | 1,250,000; 10%; 4.5% × 25y; rent 4,200; 10%; hold 3y (RPGT 30% band; 3% and 4% duty bands) | 29 | 0 | Match |
| D0 — boundary | 500,000; 10%; **0% rate** × 35y | 29 (`zeroRateModelled: true`; repayment = principal ÷ 420) | 0 | Match |
| E0 — boundary | 500,000; **100% deposit, rent 0** | 28 (no loan: loan duty, charge duty, loan legal, valuation fee all 0; registration one instrument; NOI negative; DSCR null on both sides) | 0 | Match |

Total: 135 figures across five deals, 0 differences. Output files: `known-answer-check.out`, `known-answer-cases.out`.

### Formula table (served sample, A)

| Formula | Source | Independent expected | Actual | Difference | Data/rule date | Result |
|---|---|---|---|---|---|---|
| Loan = price × (1 − deposit%) | 75-property-grade.js (financing basis) | 514,800.00 | 514,800 | 0 | — | Match |
| Monthly repayment P·r/(1−(1+r)^−n) | 70-property.js:2818 | 2,372.96 | 2,372.96 (shown RM2,373) | 0 | — | Match |
| Transfer stamp duty, Item 32(a), per RM100 or part | FEE_TABLE transferStampDuty | 11,160.00 | 11,160 | 0 | LHDN text as at 1 Jan 2024 | Match (statutory: Unverified, §4) |
| Purchase legal fee, Swk. L.N.(F) 348/2022 rule 1, min RM500 | purchaseLegal | 4,604.00 | 4,604 | 0 | gazette 2022 | Match |
| Loan legal fee, rule 7, × 1.25 | loanLegal | 5,254.50 | 5,254.50 | 0 | gazette 2022 | Match |
| Loan agreement duty, Item 27(a)(iii), RM5 per RM1,000 or part | loanStampDuty | 2,575.00 | 2,575 | 0 | LHDN text 2024 | Match |
| Charge duty, Item 27(b), 1/5 capped RM10 | chargeStampDuty | 10.00 | 10 | 0 | | Match |
| Registration 2 × RM10 | registration | 20.00 | 20 | 0 | Sarawak Land Rules | Match |
| Service tax 8% on legal fees | professionalServiceTax | 788.68 | 788.68 | 0 | P.U.(A) 64/2024 | Match |
| Valuation fee (scale, min RM400) + 8% | valuationFee, valuationServiceTax | 1,194.00 + 95.52 | 1,194 + 95.52 | 0 | Board of Valuers scale | Match (provenance: estimated) |
| Searches/disbursements; utility deposits | estimates | 1,170; 1,500 | same | 0 | — | Match (labelled estimates; RM3,959.52 "rests on estimated lines") |
| Effective rent = rent × 12 × (1 − vacancy) | 75 | 20,202.00 | 20,202 | 0 | | Match |
| Opex = fixed + 5% repair reserve of collected rent | 75 | 6,088.10 | 6,088.10 | 0 | | Match |
| NOI; monthly position = NOI/12 − repayment | 75 | 14,113.90; −1,196.80 | same | 0 | | Match |
| Gross / net yield | 75 | 3.881% / 2.4675% | 3.88% / 2.47% | 0 | | Match |
| Reserve = 3 × max(burn with rent, burn without) | 75 | 8,388 | 8,388 | 0 | | Match |
| Cash required | 75 | 118,959.70 | 118,959.70 (RM119.0k) | 0 | | Match |
| Break-even rent (zero of monthly position) | 75 | 3,234.38; position at it = 0.00 | 3,234.38 | 0 | | Match |
| Exit value, outstanding balance, agent 2%, exit legal ≥RM500 | 75 | 768,720.17 … | same | 0 | | Match |
| RPGT (citizen; Sch. 4 relief max(RM10k, 10%)) | 70 RPGT_SCHEDULE | 0 at year 10; 15% (B); 30% (C) | 0; 2,482.84; 8,695.81 | 0 | **schedule status `unverified`** | Match arithmetically; statutory Unverified |
| IRR / NPV at 7% | 75 | NPV(IRR) = 0 | 0.00 | 0 | | Match |
| Research grade | 75:338-561 | U while every driver is an illustrative default | U | — | | Match |

## 2. Consistency between screen, saved record and export

- One engine (`dealModel`) serves the calculator, the Scenario Lab, saved property records (`71-property-models.js`), the proposal and the printed report; saved records hold inputs plus a `stamp` (model version, fee-rulebook version, data versions) and are recomputed on reopen. Verified by reading and by model-test (324 invariants, including "the Lab's figures are the calculator's").
- Export envelope (`exportEverything`, 00-core.js:547): `format`, `version`, `exportedAt`, `model`, `feeRulebook`, `dataVersions`, `data` over 35 portable kinds; restore is all-or-nothing with a refusal list (`importEverything`, 00-core.js:589: refuses a non-export file, a file with no data block, a file with nothing restorable, and malformed kinds individually). Journeys `backup`, `return`, `research-case` pass on the clean copy.
- Gap (not arithmetic): "Fee rulebook moved" is shown on the Saved-work page only, not when a saved record is reopened in the calculator, the Lab or the proposal. Listed in 10-launch-blockers as Improve after launch.

## 3. Equities calculations

Not re-derived case by case in this audit beyond what the suites prove; recorded as the suites' evidence, not as independent verification:

| Behaviour | Evidence | Result |
|---|---|---|
| A ratio is null exactly when an input is null; "n/a" never a zero | 00-core.js:70-74; 13-metrics.js; equity-test | Verified by suite |
| Zero or negative denominators withheld (CAGR on non-positive base; ROE on tiny/sign-changing equity; margins when EBIT > revenue) | 13-metrics.js:105-144; 15-derivation.js:755-798; equity-test | Verified by suite |
| Share-count moves > 1.5× or < 0.67× withhold per-share rates (no split adjustment held) | 13-metrics.js:177-335 | Verified by suite; limitation disclosed |
| Filed vs illustrative never mixed in peers | 20-valuation.js:595-610 | Verified by suite |
| FX USD/MYR 4.42 is an undated sample constant | 05-plans.js:274 | Labelled on one card only — see 06-data-quality F5 |
| Known data defects (EMR dividend unit; CI share counts) | data-check.mjs:45-47 | Controlled list; not repaired on the page (06 F7) |

Three revenue figures are pinned in equity-test to the filed values; no independent recomputation of a full ratio set was done here. Marked **Unverified (independent)**, Verified (suite).

## 4. Statutory and regulatory correctness — Unverified

| Rule | Provenance in the rulebook | Authoritative confirmation | Status |
|---|---|---|---|
| Transfer stamp duty bands | "verified" against LHDN's updated text as at 1 Jan 2024; effective date from secondary sources | none in this audit | **Unverified** |
| Loan and charge duty | "verified" (same text) | none | Unverified |
| Sarawak advocates' scale (purchase, loan × 1.25) | gazette Swk. L.N.(F) 348/2022 | none | Unverified |
| Service tax 8% | P.U.(A) 64/2024 | none | Unverified |
| Valuation fee scale | Board of Valuers circular, provenance "estimated" | none | Unverified (labelled estimate) |
| RPGT rates and relief | `RPGT_SCHEDULE.status: 'unverified'`, `sourceUrl: null`, `verifiedBy: null` | none | **Unverified, and the product says so** |
| Rulebook ownership | `reviewOwner: null`, `reviewOwnership: 'pending'`, `nextReviewDue: 2026-12-15` | — | **No reviewer named** (blocker B-02) |

A mathematically correct formula on an unconfirmed rate is not certified here. Mathematical correctness: **Verified**. Rulebook consistency (every line used where stated): **Verified**. Statutory correctness: **Unverified pending a named reviewer**. Commercial reasonableness of the estimates (RM1,170 disbursements, RM1,500 deposits): labelled, Unverified.

## 5. Negative control (false-confidence check)

In an isolated copy of the commit, the repayment formula was perturbed by ×1.001. `model-test` reported only **2 of 324 invariants failing** (the two that re-derive by hand); the repayment figure itself and every yield built on it passed, because most invariants compare the model with itself. The planted error of RM2.37 a month would not be caught by the suite alone. The independent known-answer scripts above catch it (they would show a RM2.37 difference). Recorded in 09-test-confidence as a High false-confidence risk, with the minimum action: add independent known-answer constants (repayment, MOT, legal fee for the sample) to model-test.

## Verdict

- Mathematical correctness of the property engine: **Verified** (135 independent figures, 0 differences, boundaries included).
- Statutory rates: **Unverified**, reviewer pending — a launch blocker for any claim that the fees are "correct", not for the free calculator with its present labelling ("verified"/"estimated"/"unverified" beside each line).
- Equities arithmetic: Verified by the suites; not independently re-derived.
