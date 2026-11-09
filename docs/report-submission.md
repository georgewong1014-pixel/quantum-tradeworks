# Report submission: how a visitor's report reaches the owner

Written 9 November 2026 for the owner's brief of that day: a visitor without
an email program must be able to submit a data-error report or feedback that
the owner can retrieve. This page says what was built, what the deployment
needs before it works on the live site, how to retrieve a report, and how the
two halves of the journey are verified.

## What the visitor sees

1. **Report a data error** (footer of every page, and /contact) or **Send
   feedback** (same places) opens a form. Saving it records a **draft** in the
   browser with a case id (`QT-YYYYMMDD-NNN-xxxx`). The confirmation is
   titled "Case … saved here, not sent" and says so in its first sentence.
2. Under the text of the case, the drawer offers **Submit this report**
   (or **Submit this feedback**) when the deployment has a report store.
   The text in the box is exactly what goes: the visitor can read or edit it
   first. With the text go the page's path (never its query string, where the
   property calculator keeps a deal's figures) and the build name. Nothing
   else: no saved model, no watchlist, no deal, no address of the visitor.
3. A **receipt reference** (`QTR-<n>`) is shown only after the store has
   answered that it holds the record. The case's status becomes
   "submitted — receipt QTR-n" on /corrections, with a green chip; a draft
   keeps its bronze "recorded …" chip.
4. **Copy** and **Open in my email program** stay as alternatives on every
   case, draft or submitted.

Without a store, the drawer says "Submitting from this page is not switched
on yet. Nothing has been sent; copy the report or use your email program."

## What the deployment needs (the owner's steps)

The function is `api/report.mjs`, served by Vercel at `/api/report`. It
stores nothing until the project's environment names a store. The store
built for the live site is **GitHub Issues in a private repository**: the
owner already reads GitHub, each report becomes one issue that can be
assigned, labelled and closed, and GitHub emails the owner on each new one.

1. Create a **private** repository, for example
   `georgewong1014-pixel/quantum-tradeworks-reports`. No code, no files.
2. Create a **fine-grained personal access token**
   (GitHub → Settings → Developer settings → Fine-grained tokens):
   resource owner: your account; repository access: *only* the new
   repository; permissions: **Issues: Read and write**. Nothing else.
   Set an expiry you will remember to renew.
3. In Vercel → the quantum-tradeworks project → Settings → Environment
   Variables, add for **Production** (and Preview if you want it there):

   | Name | Value |
   |---|---|
   | `QT_REPORTS_REPO` | `georgewong1014-pixel/quantum-tradeworks-reports` |
   | `QT_REPORTS_GITHUB_TOKEN` | the token from step 2 |

4. Redeploy (Vercel → Deployments → Redeploy the current one, or push).
   Then open `https://<site>/api/report` in a browser: it must answer
   `{"ok":true,"accepts":"POST","configured":true,"store":"github"}`.

The token lives only in Vercel. It is never in the repository, never in the
page, never in a log.

Without the two variables the address answers `configured:false`, the
pages offer copy and email only, and a POST is refused with 503. No receipt
can be issued for a record that was not stored.

## Retrieving a report (staff)

Open the private repository's **Issues**. Each is titled
`Data error QT-… — /page` or `Feedback QT-… — /page`, labelled
`data-error` or `feedback`, and carries a table (kind, case id, page, build,
accepted time) and the report text in a block. The **receipt** the visitor
holds is `QTR-<issue number>`: receipt QTR-42 is issue #42.

Owning the next action: assign the issue to yourself, label it (for
example `triage`, `fixed`, `not-a-defect`), and close it when the correction
is published in /corrections or the visitor's point is answered. The site
holds no reply route: a visitor who wants an answer writes to the support
address; the case id ties the two together.

## The two verification results (the owner's rule of 9 November 2026)

Every journey is reported as two results, never one.

| Result | What proves it | Where it runs |
|---|---|---|
| **Customer completion** — "I submitted successfully without installing, signing into or opening another app" | The `submission` journey (journeys.mjs) fills the form, saves, presses Submit, and passes only when the drawer shows "Case … submitted — receipt QTR-n", the case is stored as submitted under that receipt, the page did not move, and /corrections lists it as submitted after a fresh load | CI on every push (checks.yml, the journeys job, against serve.mjs); locally with `node journeys.mjs http://localhost:8123 --only submission` |
| **Operational completion** — "Staff found the record, owned the next action" | The same journey reads the record back from the store by its receipt and passes only when it holds the identical reviewed text, the case id, the page path without a query, the kind and an acceptance time; and a third step proves one POST went, with five fields and nothing from saved work | CI and locally against the file store serve.mjs provides |
| **Live site** | The journey does **not** submit against the live site: a synthetic report filed into the owner's tracker twice a day is not a test. Against production it reports **DEGRADED** with the reason — "not switched on" until the two variables are set; "not exercised against this deployment" once they are — so the health page never shows a green it did not earn | journeys.yml |

**The owner's live check, once configured** (do it once, by hand):
open the live site on a phone with no email program, report a figure on any
company page, press Submit, note the receipt; then open the private
repository's Issues and find the issue with that number and the same text.
Record both halves (customer: receipt shown, no other app; operational:
issue found, assigned) in the handoff's ops checklist. Until that is done
the live submission is **Unverified**, whatever CI says.

## Abuse control (the owner's condition, 9 Nov 2026)

Two limits, in the function itself — no new service, nothing stored about
anyone:

| Limit | Value | How it holds | What the visitor sees |
|---|---|---|---|
| Per sender | 5 submissions in 10 minutes | Counted in the function instance's memory from the request's address; checked **before the body is read**, so a flood of anything is turned away cheaply. The address is kept in memory with its times only; never written, logged or answered. Each warm instance counts its own senders, so this bounds a burst, not the day. | 429, "The site is not taking more submissions right now (too many from here in a short time). Nothing has been sent; copy the report or use your email program." |
| Per day, per store | 50 records in 24 hours (`QT_REPORTS_DAILY_CAP` to change) | Before creating a record the function asks the store how many it took in the last 24 hours — for GitHub, one search of the repository's issues by creation date — and refuses at the cap. This holds across every instance: **the tracker gains at most 50 issues a day however many requests arrive.** If the count cannot be had, the cap fails closed (no record, no receipt). | 429, "… (its daily limit is reached) …" with the same alternatives |

Also: a 16 KB body limit, an 8,000-character report limit, strict field
validation with every unexpected field dropped, JSON-only (a form on another
site cannot post here), a honeypot field, and the query string removed on
the server as well as on the client. The token is read from the environment
only; it is in no page, no answer and no log line (report-api-test.mjs
checks the log and the answers for it).

**To verify the limits on the live site without creating issues:** send six
POSTs with an invalid body (for example `{` with `content-type:
application/json`) from one machine within a minute; the first five answer
400, the sixth 429 `rate-limited`. No record is created by any of them.

**To verify the fallback without creating issues:** remove the two store
variables and redeploy; `GET /api/report` answers `configured:false`, the
drawer says submission is not switched on and offers copy and email, and a
POST answers 503 with no receipt.

## Privacy review items (for counsel, with the draft Privacy page)

- **What is stored:** the five fields (kind, case id, the text the visitor
  reviewed, the page path, the build) and the acceptance time. No address,
  no agent string, no identifier of the visitor. Free text may contain
  whatever the visitor typed.
- **Where and by whom:** GitHub, Inc. holds the records as issues in a
  private repository of the owner's account — GitHub is the processor and
  the storage destination; its terms govern retention of deleted issues.
- **Retention and access:** the owner decides (close, delete); access is
  the repository's collaborators only.
- **The sentence added to /privacy** ("One form sends something, and only
  when you press Submit …") states the above in the page's words; counsel
  to confirm it with the rest of the draft.

## Staff owner

Reports arrive as issues in the owner's own GitHub account, which emails
on each new issue. The owner is the support and corrections owner named on
23 Oct 2026 for the support address, so the proposed owner for incoming
reports is the same person; no backup is assigned. Operational readiness
is **not** claimed until the owner confirms this and the live check below
has been done once.

## Limits, stated

- The per-sender limit is per warm instance, so it bounds a burst rather
  than a determined attacker; the daily cap is what bounds the day. If the
  store is abused, remove the two variables: the page falls back to copy
  and email at once, and nothing is lost but the submit button.
- No reply route and no visitor contact field: the report carries no
  address unless the visitor types one into the text, and the privacy page
  says so. A reply, if wanted, is by the support address and the case id.
- The record is the visitor's text and five fields. Nothing is read from the
  browser's saved work, and the server drops any other field it is sent
  (report-api-test.mjs proves both).
- Feedback and data errors share one store and one id scheme; the label
  tells them apart.
