# Enquiries from the Contact page: how it works and how it is switched on

This file is public, like the rest of the repository. It holds no key, no
address of an inbox and no visitor's details.

## What it is

A visitor can send an enquiry from the Contact page: a name, one way to reply
(an email address or a phone number), what it is about and what they need.
The site stores it, gives the visitor a reference, and tells the person who
handles enquiries by email.

| Part | Where |
|---|---|
| The function | `api/enquiry.mjs` (`GET` probe, `POST` an enquiry) |
| The rules | one block of text, in `api/enquiry.mjs` and in `src/js/66-enquiry-rules.js`; `enquiry-api-test.mjs` fails if they differ |
| The form | `src/js/67-enquiry.js`, opened from `/contact` |
| The table | `docs/enquiry-store.sql` |
| The test | `node enquiry-api-test.mjs` (offline: no network, no real store) |

## The rules it keeps

1. **Saved first, confirmed second.** The visitor is told "received", with a
   reference, only after the store holds the record. If the store is off or
   fails, nothing is confirmed, no email is sent, and what was typed stays in
   the form.
2. **One submission, one record.** The browser makes an ID for a set of
   answers and keeps it while they are unchanged. A retry carries the same
   ID; the store keeps one row and returns the first reference.
3. **The email is a notification, never the record.** Its outcome is written
   on the row as `notify_status`: `pending`, `sent`, `failed` or
   `not-configured`. A failed email leaves the enquiry safe in the store; a
   retry of the same submission tries the email again without a second row.
4. **The reference is a label.** `QTE-YYMMDD-XXXX`. Two enquiries can share
   one. The submission ID is the key.
5. **No files.** A document is sent by email, quoting the reference.
6. **Nothing else leaves the browser**: no saved model, deal or watchlist.
7. **Limits.** Five from one address in ten minutes; fifty a day unless
   `QT_ENQUIRY_DAILY_CAP` says otherwise. A hidden field that only a program
   fills refuses the enquiry.
8. **Logs carry status codes and error names only.**

## When the form is offered

Both must be true:

1. `LAUNCH.enquiry.retention` in `src/js/15-derivation.js` holds the sentence
   saying how long an enquiry is kept. The owner's decision of 16 Nov 2026 is
   12 months. It is set in source only once the store below is working, so
   the page never shows a button that answers "not switched on".
2. The deployment has a store configured.

## Switching it on (the owner's steps)

Nothing here is done by the code or by an assistant: these create an account,
a key and production settings.

1. **Supabase.** Create a project. In its SQL editor, run
   `docs/enquiry-store.sql`. It can be run again later without harm.
2. **Resend.** Verify a sending domain and create an API key.
3. **Vercel**, project settings, environment variables, Production:

   | Name | What |
   |---|---|
   | `QT_ENQUIRY_SUPABASE_URL` | the project's address, `https://….supabase.co` |
   | `QT_ENQUIRY_SUPABASE_KEY` | the project's secret (service role) key. Never a public key. |
   | `QT_ENQUIRY_RESEND_KEY` | the Resend API key |
   | `QT_ENQUIRY_TO` | the one inbox that is told of each enquiry |
   | `QT_ENQUIRY_FROM` | the sender on the verified domain |
   | `QT_ENQUIRY_TABLE` | only if the table is not `qt_enquiries` |
   | `QT_ENQUIRY_DAILY_CAP` | only to change the limit of 50 a day |

4. **Redeploy**, then open `/api/enquiry` on the site: it should answer
   `"configured": true, "notifies": true`.
5. **Say so.** The retention sentence is then set in source, the privacy page
   gains its enquiry paragraphs, and the change is checked and pushed.
6. **One controlled check**, with made-up details and a reserved test email
   domain: send one enquiry, find its row, see the email, set its owner and
   `logged_at`, then delete the row and the email.

## What only the store's own settings enforce

The SQL turns row-level security on with no policy and removes every
privilege from the public roles, so only the secret key can read or write
the table. That is true of a project only once the script has been run in
it, and nobody should assume it without looking: try a read with the public
key and see it refused.

## Answers

| Status | Body | When |
|---|---|---|
| 200 | `{ ok: true, reference, saved: true, acceptedAt, duplicate? }` | The store holds it. |
| 400 | `{ ok: false, error, fields? }` | Unreadable, a filled trap field, a bad submission ID, or a field that fails the rules. |
| 405, 413, 415 | `{ ok: false, error }` | Wrong method, too large, not JSON. |
| 429 | `{ ok: false, reason: 'rate-limited' \| 'capped', error }` | A limit was reached. |
| 502 | `{ ok: false, reason: 'store-failed', error }` | The store did not save. Nothing was sent. |
| 503 | `{ ok: false, reason: 'not-configured', error }` | No store. |

None of the failures carries a reference.
