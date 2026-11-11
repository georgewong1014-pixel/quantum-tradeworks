# Operator runbook — Quantum Tradeworks

Internal-tools audit, 10 November 2026. Written for a trained staff member running the free beta without the founder. Where ownership is unassigned it says so; nothing here invents a person, a response time or a tool.

## 1. Where new work arrives

| Kind | Arrives at | Today | Once report submission is configured |
|---|---|---|---|
| Customer question | the support mailbox (the address on /contact) | the visitor's own email program sends it; no receipt is confirmed | unchanged |
| Data-error report / feedback | the same mailbox, if the visitor copies or emails the case text | a draft the visitor keeps in their browser with a case id `QT-YYYYMMDD-NNN-xxxx` | **a GitHub issue** in the private reports repository, titled `Data error <case id> — /page` or `Feedback <case id> — /page`, labelled `data-error` or `feedback`; the visitor holds receipt `QTR-<issue number>` |
| Production failure | GitHub: issue "Production journeys failing" (opened by journeys.yml); a failed suite opens an issue from checks-record.yml | GitHub notifications to the repository's watchers | unchanged |
| Enquiry about a paid plan or report | the mailbox | nothing is on sale; answer with /pricing's wording | unchanged |

**Owner:** the site owner (support and corrections owner, 23 Oct 2026). **Backup: unassigned.** **Incident owner: unassigned.**

## 2. Create, assign, retrieve

- **A report by email or phone** (no web submission): create the issue by hand in the reports repository with the same title shape, paste the case text, label it, assign it. If the visitor quotes a case id, put it in the title so the submission function's duplicate check finds it.
- **A submitted report:** find it by the receipt — `QTR-42` is issue #42 — or by the case id in the title. Assign to yourself; label `triage`; the next action goes in a comment with a date.
- **A support question:** reply from the mailbox; if it is a data error, create the issue as above so it is tracked.

## 3. Next-action tracking

- Every open issue has an assignee and a dated next action in its latest comment. Review the open list at least twice a week.
- Labels: `triage` (not yet assessed), `fixed` (correction published on /corrections), `not-a-defect`, `needs-info` (write back through the mailbox; the site has no reply route).
- A correction that changes a published figure gets a dated row on /corrections (`src/js/65-learn.js`, the corrections log) in the next release; the issue closes when that row is live.

## 4. Quotation and support steps

- Nothing is quoted or sold. If asked for a price: "Paid plans are not on sale and have no prices yet" (/pricing). Do not invent a price, a trial, a refund term or a delivery time.
- Support promise: none published. Do not state a response time.

## 5. Failure recovery

| Failure | What the visitor sees | What you do |
|---|---|---|
| Report store down or misconfigured | Submit answers "That did not go through — the site has recorded nothing. Try again, or copy the report or use your email program." The draft stays in their browser | check Vercel function logs for `report store (github) refused …`; check the token's expiry; the two variables `QT_REPORTS_REPO`, `QT_REPORTS_GITHUB_TOKEN` |
| Store abused | the daily cap (50) refuses with "its daily limit is reached"; per-sender limit refuses bursts | remove the two variables in Vercel and redeploy: the page falls back to copy and email at once; nothing is lost but the Submit button |
| Duplicate submissions (retry, two tabs) | the same case answers the same receipt | nothing — the function returns the existing issue's number and creates no second issue |
| Production journeys red | /status shows the failed journey and step | open the GitHub issue the workflow created; read the step's reason; a code fix goes through the normal release; if the site is broken, promote the previous deployment in Vercel (rollback — **not yet rehearsed**) |
| CI checks red on the served commit (GitHub issue "CI checks failing on the served commit") | /status → Check record shows the failed suites for the served commit | read the issue's table. **If only timing checks failed** (sweep's owner-lane line, model-test L13, mobile "focus stops hidden") and the run was much longer than usual (~90 minutes is usual), open the run in GitHub Actions and press **Re-run failed jobs**: a re-run that ends in success replaces the failed record of that commit. If a re-run fails the same check, it is a defect: fix it through the normal release. The next scheduled journeys run (twice a day) records the checks of the commit then served and opens, updates or closes this issue from that record, so a stale issue closes by itself within a day |
| A record commit by the bot did not deploy (seen once, 10 Nov 2026: `d41c2a87a`) | /status still shows the previous record; the newest "chore(health)" commit has no Vercel status on GitHub | nothing is broken for visitors. Vercel → Deployments: confirm the newest deployment's commit. The next commit on `main` (a push or the next record) deploys the current tree. If two commits in a row do not deploy, check the project's Git connection in Vercel (owner's account) |
| A visitor lost their saved work | — | it lived only in their browser; recovery is their export file (Your data & settings → Restore from a file). There is no server copy; say so plainly |
| Deployment Checks off (today) | a bad push goes live before checks finish | watch the post-deploy journeys; promote the previous deployment if red; ask the owner to turn Deployment Checks on |

## 6. Access and fallback

- Reports repository: GitHub access for the owner (and anyone the owner adds). Fallback: the mailbox.
- Vercel project: the owner's account. Fallback: none documented.
- Code and data regeneration: the repository (public) and the ingest scripts in `ingest/`; SEC regeneration needs the `SEC_UA` contact address.

## 7. What this runbook does not cover

Paid delivery, refunds, appointments, stock and installation — none exists for this business. Anything in those columns is "not applicable", not "to be done".
