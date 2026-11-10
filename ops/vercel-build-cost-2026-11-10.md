# Vercel build-cost investigation — Quantum Tradeworks repository

10 November 2026. Scope: this repository's own deployment paths, plus a read-only attribution of the team's build usage across projects, because the brief asks which repository accounts for the spend before any of the five is changed. Nothing was pushed, deployed, cancelled or reconfigured. No secret value appears here; the Vercel CLI's existing login (`vercel whoami` → the owner's account, team plan **pro**) was used for read-only API calls.

## Confirmed causes (evidence)

**1. The spend is `alumax`, not Quantum.** Every one of the 40 most recent `alumax` deployments ran on a **30-core "turbo" machine chosen by Vercel's elastic selection** (`resourceConfig.buildMachine: cores 30, purchaseType turbo, machineSelectionType elastic`), with a median build of **858 s**. That is ~453 CPU minutes per deployment; with 573 deployments in 30 days the project alone projects to roughly **260,000 CPU minutes per 30 days** — more than the whole bill, so the billed interval is shorter than 30 days or earlier deployments ran on smaller machines. Either way the bill's 109,260 CPU minutes are dominated by `alumax`.

**2. Quantum is ~0.3 % of the spend.** Its builds take 4–7 s (static files; no build command; `npm install` answers "up to date in 476ms" from the restored cache), but Vercel rounds each build up to **1 billable minute × 4 vCPU = 4 CPU minutes**. 194 deployments in 30 days ≈ **776 CPU minutes ≈ USD 2.72** at the Pro rate of $0.0035 per CPU minute.

**3. Quantum's deploy → record commit → deploy loop is real and bounded.** 124 of Quantum's 194 deployments (64 %) were the health-record bot's own commits: 56 twice-daily scheduled records (every scheduled run is recorded under the owner's D16 rule, 5 Oct 2026), ~56 "the deployment of a commit that changed the app" records (one per human push), 12 `checks-record` commits. The loop ends after one bounce (a record-only bot deployment records nothing — `ownRecord`), so each human push costs 2–3 Vercel deployments and 2–3 full CI runs; each day costs 2 more. GitHub Actions minutes are free here (public repository).

## Per-project table (team, last 30 days, Vercel API, read-only; machine and duration from a 40-deployment sample per project)

| Project | Deployments (prod / preview) | Failed (error / cancelled) | Machine (sample) | Median build | Est. CPU minutes / 30 d | Est. cost / 30 d @ $0.0035 | Expensive phases | Triggers |
|---|---|---|---|---|---|---|---|---|
| **alumax** | 573 (280 / 293) | 15 / 2 | **30 vCPU turbo (elastic), 40 of 40** | 858 s | **~260,000** | ~$908 | the build itself (14 min on 30 cores); build cache 140 MB | Git pushes to production and preview branches (293 previews) |
| els | 807 (500 / 307) | 25 / **280 cancelled** | 4 vCPU standard | 211 s | ~12,000 | ~$42 | 3–4 min builds; 34 % cancelled (superseded) still bill ≥1 min each | very frequent pushes; previews |
| design-alumax-site | 569 (276 / 293) | 7 / 2 | 4 vCPU standard | 150 s | ~7,200 | ~$25 | 2.5 min builds; cache 129 MB | pushes; previews |
| quantum-tradeworks | 194 (182 / 12) | 0 / 1 | 4 vCPU standard (elastic) | 4–7 s | ~776 | ~$2.72 | none — 1-minute rounding × 4 vCPU; 64 % of deployments are bot record commits | human pushes; journeys.yml record commits (2 scheduled/day + per deployment); checks-record.yml |
| elssource | 51 (51 / 0) | 0 / 0 | 4 vCPU | 11 s | ~204 | ~$0.71 | rounding | pushes |
| quickbuzz-platform | 42 | 0 | 4 vCPU | 5 s | ~168 | ~$0.59 | rounding | pushes |
| ringgit-radar, ringgit-radar-ivq4 | 28 + 28 (all bot commits) | 0 | 4 vCPU | 7 s | ~224 | ~$0.78 | rounding; **two projects deploy the same repository** | a bot's commits |
| renosource, quickbuzz | 7 + 6 | 0 | 4 vCPU | 11–22 s | ~52 | ~$0.18 | rounding | pushes |

Queued or building at the time of the check: **0**. Vercel's documented rounding: billable duration is build plus post-build time rounded up to the next whole minute; a CPU minute is a build minute × vCPUs; cancelled builds count as full deployments.

## Hypotheses (not confirmed)

- The exact billing interval: the bill's figure fits ~12 days of `alumax` at the sampled rate; older `alumax` deployments may have been assigned smaller machines. The dashboard's Usage → Builds view (owner) settles it.
- Whether `alumax`'s build would stay near 14 minutes on a 4-vCPU Standard machine or lengthen: unknown until one benchmark deployment is measured there (that project's own audit; a paid benchmark needs the owner's budget).

## Quantum: duplicate triggers and the loop

- Vercel Git integration deploys every push to `main` — human pushes and both bots' record commits alike (no `ignoreCommand`, no `git.deploymentEnabled` rule).
- `journeys.yml` (deployment_status + cron 03:17/15:17 UTC) commits `health/journeys.json`, `health/checks.json` and four island pages after every code deployment and **every scheduled run**, then starts `checks.yml` on its own commit. `checks-record.yml` commits `health/checks.json` when CI finishes after the record's 50-minute wait (12 times in 30 days; it exists so /status does not show "Not run" for a slow CI — keep).
- The health files are application inputs (served at `/health/*.json` and drawn into `/status`), so a record that changed must deploy. A record that says the same thing as the served one need not.

## Minimal fixes

| # | Fix | Where | Status | Expected saving (assumption: 4 CPU-min per Quantum deployment) |
|---|---|---|---|---|
| 1 | **Batch release pushes** — one push per tested batch (the practice since 8 Nov: the owner's word per batch) | process | in force | each avoided human push saves 2–3 deployments ≈ 8–12 CPU-min and 2–3 CI runs |
| 2 | Remove duplicate deployment paths: none found in Quantum beyond the bots; `ringgit-radar` and `ringgit-radar-ivq4` deploy the same repository twice (owner: remove one project) | Vercel dashboard | owner | ~112 CPU-min/30 d |
| 3 | **Scheduled records only when something changed or the record is a day old** — the bot would still run twice a day and open an issue on failure, but commit (and so deploy) a scheduled result only when a status or failing step changed, or the served record is over 24 h old | `journeys.mjs decide()` + its self-test | **proposed, not implemented.** It reverses the owner's D16 decision of 5 Oct 2026, taken because the earlier change-or-daily rule left the record 48 h old when the schedule ran late. The saving is about 28 deployments a month ≈ 112 CPU-min ≈ **USD 0.39**, plus 28 CI runs (free). Not worth overriding a deliberate decision; listed for the owner | ~112 CPU-min / 30 d if chosen |
| 4 | Keep required tests; avoid repeating expensive work: CI is free (public repo); the Vercel build does no work to cut | — | no change | — |
| 5 | Preserve cache: the build cache is hit on every deployment (12 MB); nothing justifies clearing it | — | no change | — |
| 6 | Classification/image batch jobs outside the build: Quantum has none in the build (renders.mjs, map-assets.mjs and the ingest run by hand) | — | confirmed | — |
| 7 | Consolidate catalogue updates: not applicable (no catalogue); data files are regenerated by hand and committed in one push | — | n/a | — |
| 8 | `installCommand: ""` to skip `npm install`: **not made** — the install is a 0.5 s cache hit and the minimum billable minute would not change; no saving | — | no change | 0 |
| 9 | `ignoreCommand` for documentation-only pushes: **not made** — Vercel still runs (and bills the minimum minute for) the ignore step; it would cut deployment counts, not CPU minutes, for a 7-second build | — | no change | 0 CPU-min |

Markdown and JSON are not blanket-ignored: `health/*.json`, `data/*.json` and `vercel.json` are served or read by the app; `docs/*.md` and `ops/*.md` are served as static files but change nothing the app reads.

## Remaining dashboard actions (owner; none performed)

1. **Usage → Builds, group by project** to confirm the attribution above and the billing interval.
2. **`alumax` → Settings → Build and Deployment → Build Machine: fixed Standard (4 vCPU) instead of Elastic**, then measure one deployment's duration. If a 14-minute build stays under ~30 minutes on 4 cores, the project's CPU minutes fall by ~85 %. Its own audit should also cut preview deployments (293 in 30 days).
3. **`els`:** 280 cancelled builds in 30 days each bill at least a minute — batch pushes; keep "cancel older builds".
4. **Quantum, elssource, quickbuzz-platform, ringgit-radar, renosource:** Build Machine → **Basic (2 vCPU)**; their builds take seconds, so the minimum minute halves in cost (Quantum ~776 → ~388 CPU-min/30 d).
5. **Spending controls:** set a budget **notification** now; set an automatic production pause only deliberately and above spend already incurred (it takes sites offline).
6. Remove the duplicate `ringgit-radar-ivq4` project if it serves no address.

## Expected savings, stated assumptions

- Quantum alone: from ~776 to ~388 CPU-min/30 d with the Basic machine (owner setting), and ~112 fewer with fix 3 if approved — under USD 2 a month either way.
- The team: the `alumax` machine change is the only action that moves the bill materially (hundreds of dollars a month at the sampled rate), assuming build duration does not grow more than ~7× on 4 cores. That is for the ALUMAX repository's own audit to benchmark; this repository does not touch it.
