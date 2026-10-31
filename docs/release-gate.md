# Release gate: what must pass before a commit replaces production

Written 29 October 2026 (QT-D13-01). This explains how a commit reaches production and which checks count. It also covers the one setting that makes a failed check stop a release.

## How a commit reaches production

1. A push to `main` starts two things at once: Vercel's Git integration and the GitHub Actions workflow `checks.yml`.
2. Vercel serves the repository as committed. `vercel.json` has no build command and no ignore step, and no workflow in this repository deploys anything.
3. **Today, Vercel promotes the new deployment to production as soon as it is ready. It does not wait for `checks.yml`.** This happened with `0f8fbaf` on 25 October and with `090ae64` on 29 October. CI on `090ae64` failed first, because its browser did not start on the runner, and the commit went live anyway.
4. **It happened again with a real failure on 30 October.** `d8b209a37` became the Production deployment at 15:32:47 UTC. Its gate finished at 16:41:55 UTC as a **failure**: "every route renders" failed on the calculator at 390px on CI's fonts. That deployment stayed live until the fix, `3f31f22ba`, went out on 31 October; its gate passed.

GitHub has no branch protection or ruleset on `main` either (`gh api repos/{owner}/{repo}/branches/main/protection` answers "Branch not protected"). That is not the missing piece: Vercel builds from the push, whatever GitHub requires of a merge.

The repository cannot hold back Vercel's own promotion. The promotion setting is in the Vercel project, not in this repository.

## The required checks

They are defined in `.github/workflows/checks.yml` and run on every push and pull request.

| Job | What it covers |
|---|---|
| `static`: "parses, and matches its source" | The code parses, and the build matches `src/`. Also the served heads and 404s, and the offline suites: ingest-test, history-store-test, data-check, scanner-test, register-check, the wording and CSP checks, and the self-tests |
| `runtime`: "every route renders" | In a browser: sweep, coverage-frames, the prerender check, register-test, model-test, equity-test and mobile |
| `journeys`: "every tool works from start to finish" | The 25 journeys, run against the commit before it is live |
| **`gate`: "release gate — every required job passed"** | Passes only if each of the three jobs above finished with `success`. A job that failed, was skipped or was cancelled fails the gate. |

**The gate is the one check production must require.** It runs `if: always()`, so it reports even when an earlier job did not run. `checks-record.mjs --self-test` fails if the gate stops depending on any of the three jobs.

**Not release checks:**
- `journeys.yml`, "complete journeys on the live site", runs after deployment and on a schedule. It checks what is already live.
- `checks-record.yml` writes `health/checks.json` for `/status` after CI finishes.

Both report on production. Neither can prevent a release.

## The owner action that turns the gate on

In Vercel:
1. Open the project, then Settings, then Deployment Checks.
2. Add a check from GitHub.
3. Select **"release gate — every required job passed"**.
4. Apply it to Production.

With that set, Vercel still builds each push, but promotes it to production only after the gate passes. If the gate fails, the last healthy deployment stays live.

## How to confirm it once it is on

Do not publish a failing commit to test it. Instead:
1. Push a branch or open a pull request whose CI fails. Its preview deployment should show the check as failed, and production should not change.
2. On the next ordinary push to `main`, the deployment in Vercel should show "Checks" pending, then passed, before it becomes the production deployment.

A screenshot of each in Vercel is the evidence. A green `/status` alone cannot show it, because `/status` reports after deployment.

GitHub's records show the same without opening Vercel. For a pushed commit, compare when its Production deployment succeeded with when the gate completed:

```bash
SHA=$(git rev-parse <commit>)
gh api "repos/{owner}/{repo}/deployments?sha=$SHA&environment=Production" --jq '.[].id' |
  while read id; do gh api "repos/{owner}/{repo}/deployments/$id/statuses" --jq '.[] | select(.state=="success") | .created_at'; done
gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" --jq '.check_runs[] | select(.name|startswith("release gate")) | [.conclusion, .completed_at] | @tsv'
```

With Deployment Checks on, the deployment's success time comes **after** the gate's completed time. On `d8b209a37` it came 69 minutes before, so the setting is off.

## If a bad release reaches production anyway

Use Vercel's Instant Rollback to the last healthy deployment (see the handoff's `ops/ROLLBACK-RUNBOOK.md`). Then fix the commit, or revert it, on `main`.
