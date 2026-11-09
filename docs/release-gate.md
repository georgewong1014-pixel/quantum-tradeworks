# Release gate: what must pass before a commit replaces production

Written 29 October 2026 (QT-D13-01); checked against the repository, GitHub's records and Vercel's documentation on 6 November 2026, and against GitHub's records again on 9 November 2026. This explains how a commit reaches production and which checks count. It also covers the one setting that makes a failed check stop a release.

**State on 6 November 2026: the setting is off.** On `eb2f34fb2` the Production deployment succeeded at 21:31:54 UTC and its gate finished at 22:58:22 UTC, 86 minutes later.

**Checked again on 9 November 2026: still off.** On `461bd3e59` (pushed 8 November) the Production deployment succeeded at 11:43:54 UTC, six seconds after `checks.yml` started on it (11:43:48); its gate passed at 13:08:18, 84 minutes after the site was already serving the commit. The bot's record `2af277184` did the same: live 13:09:33, gate 14:33:31. So today a failed or missing required check does **not** stop a commit reaching production; only the setting below does. The repository's own part is complete and tested: the gate job, `checks-record.mjs --self-test` (a job skipped, cancelled or missing fails the gate; a suite that did not run is recorded NOT RUN, never PASS) and `journeys.mjs --self-test` both passed on 9 November. Nothing in the repository was changed for this; there is no repository-controlled change that would help, as the next two paragraphs explain.

**Two alternatives were considered and are not recommended.** (1) A GitHub ruleset or branch protection on `main` requiring the gate before a push lands: GitHub does control that, but every check runs *after* a push, so a direct push to `main` would be refused until the commit has been checked on another branch first — and the two bot workflows push their records straight to `main` with the workflow token, which cannot be a bypass actor, so each record would be refused and `/status` would stop updating. It would need the workflows rewritten, a second system. (2) Vercel's `ignoreCommand` in `vercel.json`: it runs at build time with no GitHub token and no way to wait, so it cannot ask whether checks that started seconds earlier have passed. Deployment Checks is the one place the hold belongs.

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
| `journeys`: "every tool works from start to finish" | Every journey in `journeys.mjs`, run against the commit's own files, with no live site involved |
| **`gate`: "release gate — every required job passed"** | Passes only if each of the three jobs above finished with `success`. A job that failed, was skipped or was cancelled fails the gate. |

**The gate is the one check production must require.** It runs `if: always()`, so it reports even when an earlier job did not run.

`checks-record.mjs --self-test` runs the gate's own script and fails unless:

| The three jobs | The gate |
|---|---|
| All `success` | Passes |
| Any one `failure`, `skipped`, `cancelled` or missing | Fails |

It also fails if the gate stops depending on any of the three jobs, if a second job takes the gate's name, if `checks.yml` gains a path filter or comes to need the live site, or if a workflow starts deploying.

**No gate at all:** if `checks.yml` never runs on a commit, that commit has no gate result. Vercel's documentation says a deployment is held until all required checks are met, so it should stay unpromoted. It does not state a timeout or describe this case, so treat it as unverified until it is seen.

**Every production commit gets a gate.** The bot's record commits are pushed with the workflow token, which starts no workflow, so `journeys.yml` and `checks-record.yml` start `checks.yml` on them. Each of the nine Production deployments from `a6a060c7c` to `eb2f34fb2` has a passing gate of its own.

**Not release checks. Do not select these in Vercel:**
- `journeys.yml`, "complete journeys on the live site", runs after deployment and on a schedule. It checks what is already live. Required by Vercel, it could wait for a deployment that is waiting for it.
- `checks-record.yml`, "record", writes `health/checks.json` for `/status` after CI finishes.

Both report on production. Neither can prevent a release. The three jobs under the gate need not be selected either: the gate already requires them.

**Previews:** `checks.yml` runs on every branch and pull request. Vercel's documentation describes holding production deployments only, so previews should carry on as they do now.

## The owner action that turns the gate on

In Vercel, signed in with an account that can change the project's settings:
1. Open the project, then Settings, then Environments, then Production. Confirm that automatic aliasing for production is on. Vercel requires this for GitHub checks.
2. Open Settings, then Build and Deployment, then the Deployment Checks section, and select **Add Checks**.
3. Choose GitHub and select **"release gate — every required job passed"**. That is the only check to select.

Vercel's documentation names neither the plans that include this nor the role needed. If the section or the button is missing, that is what to ask Vercel.

With that set, Vercel still creates a deployment for each push, but assigns it to the production domain only once the gate has passed. Until then the last promoted deployment stays live.

**Force Promote**, on a deployment's page, bypasses the checks. Keep it for an emergency, and record why it was used.

## What changes once it is on

- **Every release goes live about 85 minutes after the push.** The last six runs of `checks.yml` took 83 to 87 minutes. An urgent fix waits too, unless it is force-promoted. Rolling back is not affected.
- **`/status` still shows "Not run" for about the same time again after each code release.** The setting does not remove this. The live journeys can only run on a build once it is live, and the commit that records their result is held for its own gate. The order is: the release goes live; `/status` reads "Not run yet on the version of the site you are using"; the journeys run and commit their record; the gate passes on that commit, about 85 minutes later; `/status` shows the results. A failed or unchecked build still does not go live during this time.
- **Each record commit is held as well**, about twice a day. That delays the record, not the tools.
- **The post-release journeys wait up to two hours** for a held deployment to go live (`journeys.yml`). If it never does, they record what the site is actually serving.

## How to confirm it once it is on

Do not publish a failing commit to test it. Use the next ordinary, approved push to `main` that changes the app:

1. **Before the push,** note the build the site serves:
   ```bash
   curl -s https://quantum-tradeworks.vercel.app/status | grep -o 'app\.[0-9a-f]\{12\}\.js' | sort -u
   ```
2. **While the gate is running,** run the same command. The site should still serve the old build. In Vercel, the new deployment should show its check as pending. This is the proof that production waited.
3. **After the gate passes,** the new build should be served. Then compare its time with the gate's:
   ```bash
   gh api "repos/{owner}/{repo}/commits/<commit>/check-runs" --jq '.check_runs[] | select(.name|startswith("release gate")) | [.conclusion, .completed_at] | @tsv'
   ```

A screenshot in Vercel of step 2 and of step 3 is the evidence. A green `/status` alone cannot show it, because `/status` reports after deployment.

**A deployment already live before its gate finished means the setting is off.** On `d8b209a37` the Production deployment succeeded 69 minutes before its gate failed. GitHub's deployment times alone are not proof that it is on: Vercel's documentation does not say when it reports a held deployment's status, so step 2 is what counts.

**What this cannot show:** that a *failed* gate stops a release. Step 2 shows production waits for the gate; Vercel's documentation says the deployment is not assigned to the domain until all checks are met. Seeing a failure stopped takes a real failure on `main`, since publishing one on purpose is ruled out. When one happens, keep the Vercel screenshot.

## If a bad release reaches production anyway

Use Vercel's Instant Rollback to the last healthy deployment (see the handoff's `ops/ROLLBACK-RUNBOOK.md`). Then fix the commit, or revert it, on `main`.
