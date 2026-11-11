# Ten launch optimizations — implementation and verification

Quantum Tradeworks, 11 November 2026. Work order "Implement and verify 10 launch optimizations" (QT-OPT-01 … 10). Companion to `launch-findings.md` and the certification audit in `ops/launch-audit/`. A green local build does not prove the production deployment is green: production results are stated separately and only where they were observed.

## 1. Baseline

| Item | Value |
|---|---|
| Production at the start | the build of `488ea8bcb` (pushed 10 Nov); `deploy-check` MATCH; `served-check --url` 68/68 from an archive of the served commit; read-only journeys 27 pass, 1 degraded (report submission, store not configured), 0 fail |
| The owner's baseline (10 Nov status page) | journeys 27/28, 1 degraded · model 324/325 · route sweep 107/108 · mobile 47/52 |
| Does it still apply? | **No.** The production record corrected itself on 11 Nov 10:59 UTC: all 15 suites PASS for the served commit (`/health/checks.json`). The one degraded journey still applies, by design |
| Local start | `main` at `2501ad698`, clean |

## 2. The three critical items: exact failures and root cause

The failed CI run was `checks` run 42849516300 on `488ea8bcb` (push, 10 Nov 15:55–18:21 UTC). The same app file passed on the two runs after it (42874422400 on `f3329bfd9`, 42904261071 on `d41c2a87a`).

| Item | Exact failing check | Observed | Root cause | Defect in the product? |
|---|---|---|---|---|
| QT-OPT-01 | `model-test`: "scenario-lab L13: a paint fits a frame on a 4× slower processor" | 10-year hold median 18.90 ms, p95 24.50 ms (limits 8 and 16); 30-year p95 45.60 ms (limit 33). The passing runs measured 3.10 / 4.40 / 8.40 and 3.20 / 6.10 / 10.20 | The CI runner was about six times slower than usual; the job took 142 minutes against about 88. L13 is a paint-time check, not a figure | **No.** No formula, unit, rounding, assumption, fixture or label was wrong. The other 324 invariants passed on that run, including the 36 known answers pinned in check 3b |
| QT-OPT-02 | `mobile`: five lines "1440px <route> — 1 of N focus stops hidden: a 'Skip to content' (off-screen / off-screen)" on /app/equities/explore, /app/scanner/setups/new, /property/calculator?view=full, /discover/screener, /compare | one control, the skip link, on five routes, at 1440 × 900 | measured two animation frames after focus, before the link's transition had ended on the slow runner | **No.** No overflow, clipped content or unreachable control |
| QT-OPT-03 | `sweep`: "the owner's machine no longer asks for price-history.json, scan-setups.json, …" (eight files) | two of ten files had been requested after the check's fixed 2.6 s wait | the fixed wait, on the slow runner | **No.** No route failed: the other 107 lines were clean and every route rendered |

Independent validation of the figures (QT-OPT-01, step 4): 291 figures over eleven synthetic deals were worked outside the application and match the engine to the sen (9–10 Nov). One input-handling defect was found and fixed then: a link carrying an unknown disposer category was taxed as a citizen (`2501ad698`).

**What changed in the checks, and why it is not a weakened test.** The limits and the things measured are unchanged on a machine of normal speed.
- `sweep.mjs`: waits until every file has been asked for, up to 20 s. A file never asked for still fails at the bound.
- `mobile.mjs`: a stop that reads as hidden is measured again for up to one second while it keeps the focus. A stop that is really hidden still fails.
- `model-test.mjs` L13: a fixed arithmetic loop is timed first; the limits are multiplied by how much slower than the 25 ms reference the machine runs it, never by less than 1. The reference machine is slower than a normal CI runner, so CI is held to the limits as written.
- Not run: a negative control for the sweep and mobile changes (reasoned from the code). The L13 change was run locally: scale ×1.01, median 5.30 ms, pass.

## 3. Per item

| Item | Before | Change | Tests | After | Status | Class |
|---|---|---|---|---|---|---|
| QT-OPT-01 Numerical regression | status page 324/325 | none to the product; L13 made speed-aware; three more independent cases pinned (36 figures) | model-test; known-answer scripts | 325/325 local; production record PASS | Verified (local and production record) | Must fix before launch — closed |
| QT-OPT-02 Mobile | 47/52 | none to the product; focus walk re-measures | mobile | pass local; production record PASS | Verified | Must fix — closed |
| QT-OPT-03 Route sweep | 107/108 | none to the product; owner-lane check waits on the condition | sweep | 108/108 local; production record PASS | Verified | Must fix — closed |
| QT-OPT-04 Report submission | deployed; store not configured; lead-ins said "submit it from here" | lead-ins name copy and the visitor's own email program first, submitting "where that is switched on"; served-check holds /contact to it | report-api-test (56), journeys `corrections`, `submission` | truthful in both states; live POST answers 503, no receipt | Implemented-awaiting verification (production) for the copy; **Blocked** for receipt-based submission | Must be truthful — met; activation is the owner's |
| QT-OPT-05 Scanner entry | three "Unavailable" tabs stood second, fifth and sixth; the worked example was last, under the worker's commands | working tools first (Dashboard, Setups, Watchlist scanner, Settings), then Market, Alerts, Historical, the Trading Index last as before; the example above the "Advanced: run locally" fold | served-check (Scanner first view, four steps), equity-test, journeys `scanner`, `replay` | head, steps 1–2 and the example say what works; steps 3–4 and the fold say what does not | Implemented-awaiting verification | Suitable for a limited pilot |
| QT-OPT-06 Provenance | Filed wore the brand blue, with Beta badges and links | Filed is a green square, Illustrative a bronze ring, Unavailable a grey cross in a dashed box; words unchanged. The screener's Coverage filter (SEC-filed / Illustrative / both) already existed | build-check (kind badges), equity-test | three colours, three shapes, three words | Implemented-awaiting verification | Improve after launch — done |
| QT-OPT-07 Property beginner entry | home card → quick model; dashboard card and the Sarawak landing's primary button → Scenario Lab | dashboard card and the Sarawak landing's primary button open the calculator's quick model; the Lab is the second link | journeys `quick` ("typed figures move the answer, the full model holds the same deal"), served-check, mobile, equity-test | every "start" action opens the quick model | Implemented-awaiting verification | Suitable for a limited pilot |
| QT-OPT-08 Backup guidance | backup state shown on the dashboard and Your data & settings only | a save's confirmation (property, screen, valuation run, comparison) says the item is only in this browser until a backup holds it; with a saved property open the calculator says what is not in a backup yet; the "rulebook moved" explanation says to export before saving again. Device change was already covered on Saved work | journeys `backup`, `return`; browser check on an edited property | guidance at the save, no repeated prompt, no claim of synchronisation | Implemented-awaiting verification | Suitable for a limited pilot |
| QT-OPT-09 Commercial claims | Free card "Research a few companies" (all 138 open); boundaries page listed editable assumptions without saying whose; company button "Adjust assumptions" on a plan that cannot edit; Terms "assumptions you can see and change" | Free card says what is free now; the proposed plan lists what it would add; boundaries name assumption editing as a proposed plan's; button reads "See the assumptions" where editing is off; Terms "assumptions you can see" | claims-review --strict, wording-check, served-check (pricing) | no price, no purchase control; plans read as proposed | Implemented-awaiting verification; Terms wording **Blocked-decision** (counsel) | Must fix — met for the product copy |
| QT-OPT-10 Visual identity | ivory / deep green / bronze, blue accent | Graphite, Cloud White and Electric Cobalt as token values in light and dark; graphite navigation and home hero; cobalt primary action and focus rings; Soft Cobalt on graphite. Status, profit/loss and the bronze "illustrative" marker unchanged | 104 text/surface pairs computed; screenshots at 390, 768, 1024, 1440 in both themes; focus rings and chart pages inspected; mobile, coverage-frames | readable in both themes | Implemented-awaiting verification | Improve after launch — done |

Left as they were, deliberately:
- QT-OPT-05: the four-step list keeps steps 3 and 4. They are how the page says the worker is unavailable, and three suites hold them.
- QT-OPT-07: the product's own address `/property` (menu, sidebar, footer) still opens the Scenario Lab page, whose one primary button, "Model a property", opens the calculator. Changing that address is a routing change across every served page.
- QT-OPT-10: the chart series palette is unchanged, so a single-series chart is teal, not cobalt. Changing slot 1 needs the colour-separation checks rerun. Electric Cobalt as link text on Cloud White measures 4.25:1, so text uses a deeper step (`#2A5CDB`). One hover state measures 4.32:1. `og.png` and the marketing renders still show the old palette; they are drawn from production.

## 4. Tests whose expectations changed

Each follows a deliberate change the work order asks for; none was changed to hide a failure.

| Suite | Expectation | Was | Now | Why |
|---|---|---|---|---|
| journeys, mobile, served-check | /property-investing primary action | "Open the Scenario Lab" → /property | "Start with the quick model" → /property/calculator | QT-OPT-07 |
| served-check, equity-test | dashboard property card | → /property | → /property/calculator (and /property refused) | QT-OPT-07 |
| served-check | /contact sentence on submitting | "submit it from here …" | copy and email first, submitting "where … switched on" | QT-OPT-04 |

Expectations that my own first attempt broke and that were kept: the Trading Index as the last Scanner tab, My properties as the first Property tab, the /pricing Free card within 20 words.

## 5. Regression runs

First runs and reruns are listed separately.

| Run | Commit | Result |
|---|---|---|
| Release check | `488ea8bcb` (10 Nov) | every suite exit 0 |
| CI, push | `488ea8bcb` | **failed**: model-test 324/325, sweep 107/108, mobile 47/52 (section 2) |
| CI, the two runs after it | `f3329bfd9`, `d41c2a87a` | all suites pass |
| Release check | `10f727f40` | cut off by a session restart during the mobile suite; before that, prerender 183/184 on the first pass ("the app never drew the page", one company page) and 184/184 on the second |
| Release check | `1048bcf5e` (items 1–4) | every suite exit 0; first journeys run 26 pass, **2 degraded** (`quick` 12.4 s against an 8 s budget, `backup` 27.2 s against 12 s, while screenshots were being captured on the same machine); the CI-mode run 28 pass |
| Release check, first combined run | `f6a59a687` (items 1–10) | **6 failures**: served-check 2 (Free card 21 words; dashboard card not to /property), model-test 1 (Property tab order), equity-test 2 (dashboard card; Scanner tab order), sweep 1 (Property tab order). journeys 28/28, mobile pass, coverage-frames pass, prerender 184/184, register pass. Every failure was my own change against a held expectation; see section 4 |
| Release check, final | see section 8 | — |

Not covered by any run: a physical phone; a second physical device for restore; a live report submission; a rollback in Vercel.

## 6. Verdicts

| Area | Verdict | Basis |
|---|---|---|
| Equities Research | **Conditional Go** (limited pilot) | journeys pass; filed and illustrative labelled; SEC file from August 2026 under superseded ingest rules, regeneration needs the `SEC_UA` contact address; no licensed prices |
| Property Calculator | **Conditional Go** (limited pilot) | arithmetic independently verified; statutory rates labelled but unreviewed (no reviewer named); counsel review open |
| Scanner setup | **Conditional Go** (limited pilot) | rule creation and the worked example work; no price history is supplied, by design |
| Automated Scanner monitoring | **No-Go** | not distributed; not advertised as active |
| Saved Work | **Conditional Go** (limited pilot) | export, restore and reconciliation pass; browser-local, said so; second device Unverified |
| Report submission | **No-Go** for receipt-based submission; the copy/email route is as described | store not configured; no live two-result check |
| Paid subscriptions | **No-Go** | no approved price, no payment processing, no operating entity |
| Paid property reports | **No-Go** | as above |

No area is certified for an official launch from code tests alone.

## 7. Owner decisions and release protection

- Report store: `QT_REPORTS_REPO`, `QT_REPORTS_GITHUB_TOKEN`, then one controlled live submission (customer completion and operational completion recorded separately).
- Release protection: the CI release gate exists; **Vercel Deployment Checks are off**, so a push goes live before CI finishes.
- Counsel: Terms and Privacy, including the Terms sentence changed here.
- Rulebook reviewer; `SEC_UA` and regeneration; a backup person and an incident owner.
- This repository is public and the site serves its files, these reports included. Keeping `ops/` and `docs/` off the host needs `.vercelignore` entries and a change to the build check that allows two.
- QT-OPT-07: whether `/property` itself should open the calculator. QT-OPT-10: whether chart slot 1 should become cobalt.

## 8. Final regression and release

Filled in after the final run and the push the owner asked for ("once everything is fixed, start merge and push to live", 11 Nov).
