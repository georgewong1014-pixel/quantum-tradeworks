# 00 — Executive launch verdict

**Quantum Tradeworks — official launch certification audit, 9 November 2026.**
Repository `quantum-tradeworks` only. Local `main` `83d415ce0` (plus two audit commits that follow it, not pushed); production = `origin/main` `360cd291d`, serving the build of `678cee12d`. No push, merge, deploy, Vercel change, credential, live submission, payment or customer record.

## Verdict

**OFFICIAL LAUNCH: CONDITIONAL GO — CONTROLLED PILOT ONLY**

The free research tools work as described, their arithmetic is independently verified, their limits are stated truthfully, and nothing is sold. What is **not** established is what an official public launch needs beyond that: a release gate that actually gates, named owners for the fee rulebook and for incidents, counsel's review of the drafts the site itself calls drafts, current SEC data, and a verified receiving process for reports. Those are owner decisions and actions (11), not code.

## Scorecard (fixed rubric; Provisional — assessed coverage below 100%)

| Category | Weight | Score /10 | Assessed? | Basis |
|---|---:|---:|---|---|
| Positioning and offer clarity | 20% | 8.5 | Yes | Free beta, not-on-sale, browser-only, unavailable worker and monitoring all stated; eight overpromising sentences corrected 9 Nov (live). Low copy mismatches remain (name collision, Terms sentence) |
| Desktop/mobile UX | 20% | 7.5 | Partly — emulation only, no physical device, no contrast check | 108 routes clean; 68 route/width pairs no overflow; phone journey at 390×844; keyboard focus on the paths covered |
| Conversion | 25% | 7.0 | Partly — no real-user evidence | One next action per stage; CTAs land (31/31); report submission closes the "no email program" gap locally but is not live; pilot has no participant yet |
| Trust and proof | 20% | 7.5 | Yes | Filed vs illustrative labelled; every fee line labelled verified/estimated/unverified; corrections log real; but SEC data predates fixes, NAPIC 16 months old, rulebook has no reviewer, legal pages are drafts |
| Technical reliability | 15% | 7.0 | Yes | Every suite green on clean archives; 135 independent figures match; CI complete; **but** promotion unprotected, one new journey would have failed live (fixed), model suite had weak independent coverage (fixed) |

Assessed weight: 100% assessed at least partly; **fully** assessed 55% (positioning, trust, reliability). Normalised provisional score: **7.5 / 10** (prior comparable baseline 8.8 / 10 at 92% coverage — lower here because this audit tested the suites' independence, the release gate and operations rather than the pages alone; not comparable like for like). **The score does not override the gates below.**

## Launch gates

| Gate | Required outcome | Result |
|---|---|---|
| Financial integrity | No unresolved material errors | **Pass (arithmetic)** — 135 independent figures, 0 differences; **statutory rates Unverified** (no reviewer) |
| Commercial alignment | No misleading prices or conditions | **Pass** — no price rendered; nothing sold; low copy items listed |
| Security/privacy | No unresolved critical exposure | **Pass** for the static site; report store gated on configuration and live check |
| Customer journeys | All launch-critical journeys pass | **Pass** on the committed build and production (27/27 live; 28 in source); device evidence emulated |
| Operational delivery | Real receiving and ownership established | **Not established** — personal inbox, no backup, no incident owner, no verified report store |
| Release safety | Required protections verified or launch explicitly restricted | **Not verified** — Deployment Checks off (measured three times); launch restricted to pilot |
| Claims/legal | No unapproved material claims | **Pass on claims** (wording 0, Tier 1 0); **legal review pending** (drafts; CMSA opinion the site itself requires) |
| Data provenance | Accurate and disclosed | **Disclosed, not current** — SEC file predates ingest fixes (High); NAPIC H1 2025 with licence pending (High) |
| Saved Work | Limitations and tested behaviour match | **Pass** — browser-only stated; export/restore tested incl. invalid, truncated, old files |
| Product availability | No unavailable feature sold as available | **Pass** — worker, monitoring, delivery channels, paid plans all stated unavailable/proposed |

## Offer-by-offer decision

| Offer | Technical | Financial/data | Commercial | Security/privacy | Operations | Verdict |
|---|---|---|---|---|---|---|
| 1. Property free calculator | Pass | Arithmetic verified; statutory Unverified; NAPIC old but labelled | Aligned, free | Pass | Single owner, disclosed | **Conditional Go** — controlled pilot; conditions: D-01, D-03, D-12 for official launch |
| 2. Equities Research beta | Pass | Suite-verified; data predates fixes (B-04) | Aligned, free, labelled beta | Pass | same | **Conditional Go** — pilot with the retrieval date shown; official launch after D-11 and counsel |
| 3. Scanner setup beta | Pass (setup, save, evaluate on supplied history) | engine fixture-tested | Aligned; worker unavailable stated | Pass | same | **Conditional Go** — pilot as "setup creation" only |
| 4. Automated Scanner monitoring | Not available (worker not distributed; no delivery) | — | Stated unavailable | — | — | **No-Go** (correctly not offered) |
| 5. Saved Work | Pass | Export/restore verified | Aligned | Pass | — | **Conditional Go** — pilot; physical second-device check Unverified |
| 6. Corrections and feedback (as deployed) | Pass | — | Aligned (no receipt implied) | Pass | Inbox only | **Conditional Go** — truthful; a visitor without email has no path until 7 |
| 7. Live report submission | Built, tested locally; **not deployed** | — | Copy ready (not live) | Gated on token/config | GitHub issues — unverified live | **No-Go until** push + configuration + the live two-result check (B-07) |
| 8. Paid Equities subscription | — | — | No approved price, no payment | — | No delivery owner | **No-Go** (a proposal) |
| 9. Paid Property reports | — | No verified dataset for project reports | same | — | same | **No-Go** (a proposal) |
| 10. Optional Property→ELS referral | Pass (copy-only, nothing sent) | — | Aligned | Pass (no data transfer) | ELS's own | **Conditional Go** — as built |

## The three highest-priority blockers

1. **B-01** — production promotion is not protected (Vercel Deployment Checks off).
2. **B-02 / B-03** — no named fee-rulebook reviewer; counsel review of the draft legal pages and the CMSA question not done.
3. **B-04 / B-06** — SEC data predates the ingest fixes (blocked on `SEC_UA`); no named incident/support ownership.

## Minimum safe launch scope today

The **controlled free pilot** the site already describes: Property calculator, Equities Research beta, Scanner setup beta, Saved Work, corrections by copy/email, optional ELS brief — labelled as they are, no paid offer, report submission not advertised. Invite 3–5 participants (D-18).

## What would turn the No-Go items to Go

- **Official launch:** Deployment Checks on and observed to hold once; a named reviewer's sign-off in the rulebook; counsel's opinion received; `data/us.json` regenerated under `sec 1.2.0`; NAPIC licence answered; owners named for incidents and support.
- **Live report submission:** push; two Vercel variables set with an Issues-only token on a private repository; one controlled live submission by the owner recorded as customer completion **and** operational completion in `ops/REPORT-SUBMISSION-CHECK.md`; the six-invalid-POST limit check on the live address.
- **Paid offers:** approved prices, payment processing, delivery ownership, counsel — none exists; stays No-Go by the owner's own rule (one core product before paid).

## Evidence summary

- Full release check on a clean archive of `83d415ce0` (logs `quantum-tradeworks-handoff/results/release-checks/2026-11-09T14-25-04Z-83d415ce0/`): offline 12/12; model-test 324/324; equity-test 302/302; prerender --check 184/184 (default and Verdana); mobile clean; sweep 108/108; register-test pass; journeys 28/28 as CI (a first local run failed `quick` once at "Other running costs … the insurance did not take the figure entered" and passed on the rerun — an intermittent step under load, recorded, not dismissed); **coverage-frames failed one rule** — "served pages to a reader with no script": the new footer button "Send feedback" was visible without script on every page. **Fixed in this audit** (the no-script stylesheet rule that hides "Report a data error" now hides it too); re-verified below.
- Independent known answers: 135 figures, 5 deals, 0 differences (02).
- Negative controls: repayment ×1.001 → 2/324 caught by the suite before this audit, now also caught by the new known-answer check (perturbed copy: "6 figure(s) differ from the independently worked known answers"; HEAD: "20 figures over 3 deals match … to the sen", 324 of 325 invariants passing with the one known load-sensitive paint-timing check L13 failing on a machine running two browser suites, as it did once this morning and passed alone twice); planted Tier-1 claim caught by claims-review, missed by wording-check and non-blocking in CI; `submission` journey would have failed live → fixed, verified DEGRADED.
- Production: served-check 68/68 from an archive of `origin/main`; headers verified; `/api/report` 404.
- Changes made (Phase B, test code only, local, not pushed): `journeys.mjs` (submission journey gated steps), `model-test.mjs` (independent known-answer check 3b). No product code changed in this audit.
- Reports: `ops/launch-audit/00–11`; working evidence in the handoff's `results/launch-audit-2026-11-09/`.
