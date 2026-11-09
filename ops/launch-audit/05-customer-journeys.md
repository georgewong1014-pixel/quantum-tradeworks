# 05 — Customer-journey regression

Audit of 9 November 2026. Evidence is separated into four kinds: **automated browser** (real Chrome driven by the repository's suites), **manual browser** (the auditor's own eyes on a screenshot or page), **physical device** (none available — never claimed), **production** (the live site). Journeys run in isolated browser profiles on synthetic figures; nothing was submitted to any live store.

## Results by journey

| Journey | Path | Automated evidence | Manual / production | Result |
|---|---|---|---|---|
| Property | /property → calculator → enter values → assumptions marked → change scenario → save → reopen → export → limitations | journeys `property`, `quick`, `property-phone` (390×844), `lab`, `refurb`, `costs`, `property-flow`, `commercial`, `newdev`, `evidence`; model-test (324 + the new known-answer check) | production record `360cd291d`: 27/27 pass; the "Fee rulebook moved" notice absent on reopen (gap, 02 §2) | **Pass** (phone width by emulation only) |
| Equities | /research → filed company → evidence → compare → research case → save → reopen → export | journeys `equities`, `screener`, `compare`, `research-case`, `return`; equity-test 302/302 on the clean archive | production 27/27 | **Pass** |
| Scanner | landing → scope → create setup → validate → save → understand unavailable monitoring | journeys `scanner`, `replay`, `settings`; scanner-test; the gated "evaluate" step passes on the honest refusal | production 27/27; copy says the worker is not distributed (live since `678cee12d`) | **Pass** within the stated scope (setup creation); monitoring **Not applicable** (unavailable, said so) |
| Saved Work | save → list → reopen → export → restore → delete | journeys `backup`, `return`, `replay`, `records`, `registers`, `cases`; equity-test restore cases (invalid JSON, truncated, old-version, double restore); register-test | production 27/27 | **Pass** |
| Corrections and feedback (as deployed) | footer → draft → save locally → status → copy/email | journey `corrections`; equity-test; served-check pins | production 27/27; honest "saved here, not sent" | **Pass** |
| Report submission (local HEAD) | draft → Submit → receipt → record found by staff | journey `submission` (customer completion; operational completion by reading the record back; five-fields step); report-api-test 52/52 | **production: DEGRADED by design** (not deployed; store unconfigured) — the live two-result check is the owner's (`ops/REPORT-SUBMISSION-CHECK.md`) | **Pass locally; Unverified live** |
| Optional ELS | property assessment → optional brief → copy → open ELS | journey `property` step at journeys.mjs:1625-1629 ("Brief copied. Nothing has been sent to ELS"); no figures or record ids in the brief | production 27/27 | **Pass** (copy-only; no transfer; no enquiry) |
| Calls to action | every primary CTA lands on a working page | journey `ctas` (31 pressed) — landings only, by design | production 27/27 | **Pass** (proves links, not tools) |
| Routes | every address serves its own page | journey `routes`; sweep 108/108; served-check 68/68 | production 68/68 (this audit) | **Pass** |

## Accessibility and devices

| Check | Evidence | Result |
|---|---|---|
| Desktop (1440) and tablet/phone widths 360–1440 | mobile.mjs: no horizontal overflow, no hidden focus stop, text cut-off checks (68 route/width pairs); `property-phone` journey at 390×844 | Pass (emulated) |
| Keyboard navigation and focus order | equity-test focus-return cases (drawers hand focus back; the report form's opener); journeys press real keys for search; mobile.mjs hidden-focus-stop rule | Pass for the paths covered; no full keyboard sweep of every page |
| Screen-reader semantics | labels on every form field (`<label for>`), `aria-label` on case textareas, `role=status` on the submit status, `role=alert` on refusals — by reading | Partially verified by reading; no assistive-technology run |
| Input labels and error feedback | journeys type into labelled fields; invalid input states ("Needs a purchase price", "not computed yet") asserted by model-test L15 | Pass |
| Contrast | **no automated contrast check exists** (grep: none in sweep/mobile/coverage); design tokens by eye in screenshots | **Unverified** |
| Zoom, long text | mobile.mjs text cut-off rules; no explicit zoom test | Partially verified |
| Print | journeys `records` (Print & share) render; proposal/report print styles by reading | Pass for rendering; no printed-output review |
| Browser refresh | journeys reload /corrections, /my/* and compare the stored state | Pass |
| Slow connections | coverage-frames (first frames give one answer); no throttled-network run | Partially verified |
| JavaScript errors | every journey degrades on an unexpected console error; sweep fails on page exceptions | Pass (0 errors on the clean copy) |
| Unavailable services | report probe failing → copy/email; data 404 → "not held"; personal lane 404 in CI | Pass |
| Physical device | none available | **Unverified** — emulation is reported as emulation |

## Not run or not provable here

- Real customers completing a workflow without hidden assistance: **Unverified** — the research-usability pilot (`ops/PILOT-7-DAY-RESEARCH-USABILITY.md`) has no participant yet.
- The live report submission's two results: Unverified until the owner's by-hand check.
- Contrast and assistive-technology semantics: no tooling in the repository.

## Verdict

Launch-critical free journeys (Property, Equities research, Scanner setup, Saved Work, Corrections, ELS referral) **pass** on the committed build and on production as deployed. Device evidence is emulation only. Report submission is verified locally and **Unverified** live.
