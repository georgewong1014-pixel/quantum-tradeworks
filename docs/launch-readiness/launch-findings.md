# Launch findings — Quantum Tradeworks

Internal-tools audit (common instructions + Addendum E), 10 November 2026. Companion to the certification audit of 9 November (`ops/launch-audit/00–11`), whose evidence this audit reuses and extends with the seven synthetic journeys T1–T7, the repairs below and the operator runbook.

## Baseline

| Item | Value |
|---|---|
| Branch / tested commit | `main`; the working tree built on `d96806b7d` plus this audit's changes (committed as the commit titled "audit(internal-tools): …" — see git log) |
| `origin/main` / production | `360cd291d`; production serves the build of `678cee12d` (served-check 68/68 from an archive of `origin/main`, 9 Nov) |
| Unpushed local commits | the report-submission feature and abuse control (9 Nov), the certification audit (d96806b7d), this audit |
| Prior report "report submission committed locally" | **Confirmed as a lead, not deployment:** the code is on local `main`; production `/api/report` answers 404; the served bundle predates the Submit control |
| AGENTS.md | does not exist; CLAUDE.md, README.md, docs/*.md and the handoff's HANDOFF.md were read |
| Environment for tests | local `serve.mjs` on :8140 (file report store in a temp dir), real Chrome, synthetic data; production read-only |

## Marketed offers and verdicts

| Offer | Verdict | Environment of the evidence | Outstanding production verification |
|---|---|---|---|
| Property free calculator (Property Intelligence, "Available") | **READY FOR LIMITED/MANUAL PILOT** — all workflows pass locally and on production as deployed; arithmetic independently verified; statutory rates labelled but unreviewed; single owner, no backup; promotion unprotected | local + production read-only | none for the tool itself; physical device Unverified |
| Equities Research beta | **READY FOR LIMITED/MANUAL PILOT** — workflows pass; filed vs illustrative labelled; SEC file from Aug 2026 under superseded ingest rules (P2 with the retrieval date shown; P1 for an official launch) | local + production read-only | none |
| Scanner setup beta | **READY FOR LIMITED/MANUAL PILOT** as setup creation; monitoring and delivery stated unavailable | local + production read-only | none |
| Saved Work (browser-local) | **READY FOR LIMITED/MANUAL PILOT** — export/restore and reconciliation pass; browser-only stated | local | second physical device Unverified |
| Corrections and feedback by copy/email (as deployed) | **READY FOR LIMITED/MANUAL PILOT** — truthful; a visitor without an email program has no path until submission is live | production read-only | none |
| Live report submission | **BLOCKED** — not deployed; store unconfigured; live two-result check not done. Smallest action: push on the owner's word; set `QT_REPORTS_REPO` and `QT_REPORTS_GITHUB_TOKEN` (Issues-only fine-grained token on a private repository); one controlled live submission recorded in `ops/REPORT-SUBMISSION-CHECK.md` | local PASS (T1, T2) | the live submission and retrieval |
| Paid Equities subscription; paid Property reports | **BLOCKED** (proposals: no approved price, no payment processing, no delivery owner) — correctly not on sale | — | — |
| Optional Property → ELS referral | **READY FOR LIMITED/MANUAL PILOT** as built (copy-only; four facts; nothing sent); receiving side is ELS's | local | ELS's own receiving check |

No offer is **READY** for official launch: the operational ownership (backup, incident owner), the release gate and counsel review are not evidenced (see the certification audit's blockers B-01…B-06).

## Journeys T1–T7

See `journey-test-matrix.md`: T1 PASS local / BLOCKED production; T2 PASS (repair made); T3 PASS; T4 PASS; T5 PASS with a P2 limitation; T6 PASS; T7 PASS.

## Severity findings

| ID | Sev | Finding | Status |
|---|---|---|---|
| F-01 | P1 (for an official launch), P2 (pilot) | Report submission not deployed/configured; visitors without an email program cannot deliver a report today | Blocked — owner's push and configuration |
| F-02 | P1 → fixed | Duplicate protection absent: the same case could be filed twice on retry or from two tabs | **Fixed** (`existing()`; tests) |
| F-03 | P1 (official), P2 (pilot) | SEC data predates ingest fixes; regeneration blocked on `SEC_UA` | Blocked — owner |
| F-04 | P1 (official) | Production promotion unprotected (Deployment Checks off) | Blocked — owner's Vercel setting |
| F-05 | P2 | Single owner, no backup, no incident owner, rollback unrehearsed | Blocked — owner decision |
| F-06 | P2 | Statutory rates unreviewed (no `reviewOwner`) | Blocked — owner |
| F-07 | P2 | "Fee rulebook moved" notice only on the Saved-work page | Deferred (freeze) |
| F-08 | P2 → fixed | Test harness false confidence: suites defaulting to the live site; Tier-1 claims not blocking CI; paint-timing false reds | **Fixed** (quick wins 2–4) |
| F-09 | P3 | Repository files served statically; `/admin/scanner*` unauthenticated but empty | Deferred (owner decisions) |

No P0 found: no private data exposed, no unauthorised commitment possible (nothing is sold), no corrupted commercial record (none exists).

## Changed files in this audit

- `api/report.mjs` — duplicate protection by case id (`existing()`), `duplicate: true` on a repeated case.
- `report-api-test.mjs` — 4 new checks (56 total).
- `model-test.mjs`, `equity-test.mjs`, `register-test.mjs`, `coverage-frames.mjs` — default target localhost.
- `model-test.mjs` — L13 best of up to three measurements.
- `.github/workflows/checks.yml` — `claims-review --strict` blocks on Tier 1.
- `docs/launch-readiness/*` (these six files).

No migrations (there is no database). No product behaviour changed.

## Exact checks run and outcomes

| Check | Outcome |
|---|---|
| `node report-api-test.mjs` | all 56 report-api checks hold |
| `node journeys.mjs http://localhost:8140 --only property,property-phone,backup,return,replay` | 5 pass, 0 degraded, 0 fail |
| `node journeys.mjs http://localhost:8140 --only quick,corrections,submission` (rebuilt tree, 10 Nov) | 3 pass |
| `node journeys.mjs https://quantum-tradeworks.vercel.app --only submission` (read-only) | 0 pass, 1 degraded, 0 fail — by design |
| T2 browser run (fetch patched to fail once) | one POST on a double press; honest status; retry → one record |
| T4 engine and address runs | no NaN/Infinity reaches the page; out-of-range values refused or defined |
| T7 curls (production and local) | no record readable; no mutation route |
| `node claims-review.mjs --strict` | exit 0 (Tier 1: 0) |
| `node model-test.mjs http://localhost:8140` (with L13 best-of-3) | all 325 model invariants hold (L13: 10-year hold median 5.70 ms, p95 7.40 ms; 30-year p95 12.40 ms) |
| `node --check` on every edited .mjs | pass |
| Full release check on a clean archive of the audit commit | RELEASE_CHECK_RESULT |

## Cross-repository receiving-side requirements

- **ELS**: the optional brief is pasted by the visitor into ELS's own contact page; ELS must be able to receive and own a pasted brief without a WhatsApp dependency (ELS's own audit, journey E8). Quantum transfers no figures or ids.
- **GitHub (the owner's account)**: the private reports repository, if created, is the receiving side for report submissions; access for staff is a GitHub collaborator setting, not a Quantum tool.

## Owner decisions and configuration still required

Only these (the certification audit's D-list, trimmed to this audit's scope): push (D-02); configure the report store and do the live check (D-14); name a backup or accept single-owner operation in writing (D-13); Deployment Checks (D-01); `SEC_UA` and regeneration (D-11); rulebook reviewer (D-03); counsel (D-04).

## Commit / PR / deployment state

- Commit: the "audit(internal-tools)" commit on local `main`, **not pushed**. No PR (the repository works on `main`).
- Deployment: **none performed**; production unchanged at `678cee12d`'s build. Push command for the owner: `git push origin <that commit's sha>:main` after merging any new bot commit.
