# Claim-to-capability matrix — Quantum Tradeworks

Internal-tools audit, 10 November 2026. Public claims are read from the committed renders (what production serves) and, where marked "local", from the audit commit not yet deployed. Full commercial reconciliation: `ops/launch-audit/03-commercial-alignment.md`.

| Public claim | Supporting tool or manual process | Acceptance evidence | Owner | Status | Required correction |
|---|---|---|---|---|---|
| **Enquiry acknowledgement** — /contact: "It opens your own email program; this site does not send the message or confirm that it arrived." | the owner's mailbox via `mailto:` | none is promised; served-check pins the sentence | owner | **Supported as stated** (no receipt claimed) | none; a receipt exists only once report submission is live |
| **Corrections** — "Report a data error records a case in this browser … copy or email it … not confirmed received" | browser draft + copy/email | journey `corrections`; equity-test | owner | Supported as stated | none |
| **Report submission (local, not deployed)** — "submit it from here; a receipt reference appears once the site's store has accepted it" | `api/report.mjs` + GitHub Issues | T1, T2 pass locally with the file store; production 404 | owner | **Blocked by configuration** — must not be advertised until configured and live-checked | keep the "not switched on yet" state until the owner's live check (ops/REPORT-SUBMISSION-CHECK.md) |
| **Quotation availability** | none — nothing is quoted or sold | /pricing: "not on sale"; Terms: no checkout | — | Not applicable | none |
| **Stock** | none — no goods | — | — | Not applicable | none |
| **Appointment confirmation** | none — no appointments | — | — | Not applicable | none |
| **Delivery / installation** | none | — | — | Not applicable | none |
| **Follow-up** — none promised; no waitlist rendered | `LAUNCH.waitlistEndpoint` empty → form hidden; privacy says no list | prerender/privacy.html | owner | Supported as stated | none |
| **Support** — one address, no response time | mailbox | served-check forbids response-time words on /contact | owner | Supported as stated; **no backup, no receipt confirmation** | name a backup or state single-owner operation in the handoff (not on the page) |
| **AI features** | none marketed; the only AI use is an operator-side screenshot assistant (`qtti/extract.mjs`, optional key) | grep: no "AI" claim in renders | — | Not applicable | none |
| **"Everything you can use here is free during the beta"** | no entitlement charges anything | 05-plans.js; journeys | owner | Supported | none |
| **"Paid plans are not on sale and have no prices yet"** | no payment code | /pricing, Terms | owner | Supported | owner decision D-10 on the unrendered bundle prices |
| **"No licensed market prices"** | price files untracked and 404 on production | curl | owner | Supported | none |
| **"The worker that records matches is not distributed yet"; "Hosted monitoring is not available"** | none exists | prerender/app/scanner.html; home example path step | owner | Supported (honest absence) | three low copy items (D-08) |
| **"Saved in this browser — no account … nothing follows you to another device"** | localStorage; export/restore | journey `backup`; T3 | owner | Supported | none |
| **"SEC-filed or illustrative, and every page labels which"** | `dataTag`, `illusChip`, header strip | equity-test; data-check | owner | Supported in labelling; **data currency weak** (Aug 2026 file) | regenerate with `SEC_UA` or state the extraction date and rule change on /data-sources |
| **Fee lines "verified" / "estimated"** | FEE_TABLE provenance per line | model-test; 02 | owner | Supported as labels; **statutory confirmation absent, no reviewer** | name the reviewer (D-03) |
| **"Draft — not yet reviewed by a lawyer"** (Terms, Privacy) | — | prerender | owner | Supported (honest) | counsel review (D-04) |
| **/status "Active Maintenance — Available and supported"** | a mailbox | — | owner | **Unverified** — "supported" undefined | owner decision D-09 |
| **Optional ELS brief** — "Nothing has been sent to ELS. You decide whether to share." | pure function of four deal facts; link only | T6; journeys.mjs:1625 | ELS (receiving side) | Supported | none |

No public claim lacks a supporting tool or an honest statement of absence. Two claims rest on configuration the owner has not completed (report submission; SEC regeneration) and are stated truthfully on the site today.
