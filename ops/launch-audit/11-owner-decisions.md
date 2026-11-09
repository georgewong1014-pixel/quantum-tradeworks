# 11 — Owner decisions

Audit of 9 November 2026. Each item cannot be settled from repository evidence. Nothing below was decided or implemented by the auditor.

| ID | Decision | Why it is yours | Recommended | Blocks |
|---|---|---|---|---|
| D-01 | **Turn on Vercel Deployment Checks** for the GitHub check "release gate — every required job passed" | Vercel project setting | Yes, before any further push is treated as safe | B-01 |
| D-02 | **Push local `main`** (`83d415ce0` + the two audit commits that follow it: the journey and model-test fixes and `ops/launch-audit/`) or hold | Your word each time since 8 Nov | Push; the report function deploys inert (store unconfigured, copy/email fallback) | B-07 (first half) |
| D-03 | **Name the fee-rulebook reviewer**; set `reviewOwner` | A person must accept responsibility | Name one | B-02 |
| D-04 | **Send the counsel pack** (add the report-submission privacy sentence and GitHub-as-processor note); supply entity details | Legal | Send | B-03 |
| D-05 | Rename the proposed plan ("Equities Research plan (proposed)") or keep the collision | Naming | Rename | B-16 |
| D-06 | Terms sentence "Nothing here may be used for an investment decision." vs "Model property decisions." | Counsel's wording | Leave to counsel | B-16 |
| D-07 | Maybank in sample case `t1`, portfolio `pf-1` and the scanner example universes ('1155') | 8 Nov decision covered watchlists/alerts only | Remove for consistency, or keep as labelled samples | B-16 |
| D-08 | Three scanner phrasings ("does not run scans" beside Evaluate; Copy buttons for the undistributed worker; unmarked sample lists on /app/scanner/watchlists); the recovery sentence | Pinned copy; freeze | Decide after the pilot | B-16 |
| D-09 | What "Active Maintenance — Available and supported" promises on /status | Support definition | Say "Available; support by email, no response time promised" or leave | B-16 |
| D-10 | Keep or strip the unrendered proposed prices (RM29/299/199/79/699; 19/49/89) from the public bundle | Commercial | Strip until purchasable (removes a discoverable number that is not a price) | — |
| D-11 | Supply `SEC_UA` and regenerate `data/us.json`, or add the "extracted Aug 2026 under rules since corrected" statement on /data-sources | Data currency | Supply and regenerate | B-04 |
| D-12 | NAPIC: pursue JPPH's redistribution answer or counsel's view; decide whether later half-years will be loaded | Licence | Pursue | B-05 |
| D-13 | Name an incident owner, a support backup, and rehearse one rollback — or accept a single-owner pilot in writing | Operations | Accept single-owner for the pilot in writing; name owners before launch | B-06 |
| D-14 | **Configure the report store** (private repo, fine-grained Issues-only token, `QT_REPORTS_REPO`, `QT_REPORTS_GITHUB_TOKEN`; optional `QT_REPORTS_DAILY_CAP`) and do the live two-result check | Credentials and a live action | After D-02; then one controlled live submission by you | B-07 |
| D-15 | `claims-review --strict` in CI (a Tier-1 claim fails the build) | Workflow change | Yes | B-10 |
| D-16 | FX sample-rate labelling; PGR rename; "Fee rulebook moved" on reopen; EMR dividend withhold | UI/data changes under the 1 Nov freeze | After the pilot, or regenerate (B-04) | B-11–B-14 |
| D-17 | `.vercelignore` entries for build scripts, ingest, workflows, docs | Deployment behaviour | After launch | B-15 |
| D-18 | Pilot invitations (3–5 participants) and the physical two-device check | Your acts | Proceed with the free research pilot now | — |

**Minimum set for the controlled free pilot:** D-02 (or hold), D-13 in writing, D-18. **Minimum set for an official public launch:** D-01, D-03, D-04, D-11, D-12, D-13 (named owners), plus D-14 if report submission is to be advertised as live.
