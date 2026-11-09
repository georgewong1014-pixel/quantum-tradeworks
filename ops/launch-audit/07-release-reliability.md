# 07 — Production release and reliability

Audit of 9 November 2026. Verified independently today, not taken from the owner's report.

## Current identity

| Item | Value | How verified |
|---|---|---|
| Local branch / HEAD | `main` / `83d415ce0` (merge of `aad5b14a0` with the bot's `360cd291d`); working tree clean | `git status`, `git log` |
| `origin/main` | `360cd291d` (bot record commit on top of `678cee12d`) | `git fetch` |
| Production app bundle | `assets/app.38126cc2d1c1.js` — the build of `678cee12d` | `curl` of /pricing vs `git show origin/main:pages/pricing.html` |
| Production = origin/main | Yes; served-check from an archive of `origin/main` against production: **68 passed, 0 failed** (9 Nov, this audit) | served-check.mjs --url |
| Unpushed local commits | 4 (`4dc4dd7d7` report submission, `63bc73ad7` merge, `aad5b14a0` abuse control, `83d415ce0` merge) | `git log origin/main..HEAD` |
| `/api/report` on production | 404 (not deployed) | curl |

## Required checks and promotion

| Question | Answer | Evidence |
|---|---|---|
| 1. Do required checks run before production promotion? | **No.** They run on push; Vercel promotes independently | checks.yml (gate job); docs/release-gate.md |
| 2. Does a failed required check block promotion? | **No.** Three measured deployments went live 6–7 s after checks started; gates passed 84–86 min later (`461bd3e59`, `2af277184`, `d9bdd999d`) | docs/release-gate.md, GitHub deployment and check-run timestamps |
| 3. Does a missing result block promotion? | No (same mechanism). Within CI, `checks-record.mjs` records a missing suite as NOT RUN, never PASS, and the gate job fails on skip/cancel | checks-record.mjs self-test; checks.yml gate `always()` |
| 4. Do reruns preserve failure history? | Partly: `health/checks.json` records the run per commit; a rerun overwrites the record for that commit (GitHub keeps the run history) | checks-record.mjs; GitHub Actions |
| 5. Does production serve the intended commit? | Yes today: the bundle hash matches `origin/main`; served-check 68/68 | above |
| 6. Do status and health checks reference the served build? | Yes: `journeys.mjs --commit` waits for the deployment's commit and records it; `/status` shows the recorded commit (`b5724ae16`/`360cd291d` records) | journeys.yml; health/journeys.json |
| 7. Do test scripts report failed journey names? | Yes: journeys print `FAIL <id>` with the failing step; checks-record names the suite | journeys.mjs; checks-record.mjs |
| 8. Can deployment be rolled back? | Vercel's promote-previous-deployment exists; **not rehearsed, no runbook** | — |
| 9. Do unavailable integrations degrade safely? | Yes: the report probe failing → copy/email fallback; data file 404 → "not held" states; no third-party runtime dependency | code; journeys `ctas`, `routes` |
| 10. Is there an incident owner? | **Not named** | 08-operational-readiness |

**QT-D13-01 release protection: Unverified (enforcement evidence absent) — in fact measured as not enforced.** The repository's part is complete (gate job, NOT RUN rule, self-tests); the fix is the Vercel project setting "Deployment Checks", which only the owner can turn on. Alternatives (a GitHub ruleset on main; Vercel `ignoreCommand`) were considered and are not recommended (docs/release-gate.md).

## CI and monitoring

- `checks.yml`: static (offline suites, served-check on a local server, wording, claims, licensed-data guard), runtime (Chrome suites), journeys (28 journeys on a local server from `83d415ce0`; 27 recorded on production), gate. Runs ~85 min end to end.
- `journeys.yml`: production journeys after each deployment and at 03:17/15:17 UTC; writes `health/journeys.json`; opens one issue on failure.
- `checks-record.yml`: records suite results to `health/checks.json` after `checks` completes on main.
- Latest production record: `360cd291d`, 27 pass / 0 degraded / 0 fail (9 Nov); checks record for `678cee12d`: 15 PASS.
- Monitoring of the report function (local HEAD): `console.error` lines in Vercel's function logs plus the GitHub issues themselves; no alerting.

## Reliability evidence from this audit

- Full release check on a clean archive of `46ad5bdf2` (this morning): every suite green; model-test 323/324 under machine load (paint-timing invariant L13), 324/324 alone.
- Clean-archive reruns of `4dc4dd7d7`: equity-test 302/302, mobile clean, prerender 184/184, sweep 108/108.
- Full release check on a clean archive of `83d415ce0`: **in progress at the time of writing** — result recorded in 00-executive-verdict §Evidence when it lands (the brief forbids claiming completeness before then).

## Findings

| ID | Finding | Severity | Status |
|---|---|---|---|
| R-01 | Production promotion unprotected (Deployment Checks off) | **High** — the one setting that makes every later push safe | Blocked-decision (owner's Vercel setting) |
| R-02 | No rollback runbook or rehearsal | Medium | Open |
| R-03 | No incident owner | Medium | Blocked-decision |
| R-04 | Repository files served statically (hygiene) | Low | Improve after launch |
| R-05 | Health record (27 journeys) lags source (28) until the next push | Low | Resolves on push |

Release safety gate: **not verified** → an official launch must be **explicitly restricted** (pilot) until Deployment Checks are on, or the owner accepts the risk in writing.
