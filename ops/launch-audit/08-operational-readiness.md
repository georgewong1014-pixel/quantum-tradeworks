# 08 — Operational delivery readiness

Audit of 9 November 2026. Sources: `LAUNCH` (src/js/15-derivation.js: `contactEmail` set, `waitlistEndpoint` empty, `reportEndpoint` local HEAD), `FEE_TABLE` ownership fields (70-property.js: `reviewOwner: null`, `reviewOwnership: 'pending'`, `nextReviewDue: 2026-12-15`), `RPGT_SCHEDULE` (`verifiedBy: null`), docs/release-gate.md, docs/report-submission.md, the workflows, and the owner's recorded decisions in the handoff (23 Oct: the support address and its owner; 8 Nov: no named rulebook reviewer; 9 Nov: two verification results per journey). No staff name, SLA or response time is invented; where none exists it says so.

| Process | Owner | Where the request arrives | Receipt confirmed how | Assigned / tracked / closed | If the owner is unavailable | Published customer promise | Does the process meet it? |
|---|---|---|---|---|---|---|---|
| Research enquiries / customer questions | The site owner (the support address's owner, 23 Oct) | the owner's mailbox via `mailto:` from /contact | **not confirmed** — the site says so ("does not send the message or confirm that it arrived") | personal inbox; no tracker | **no backup assigned** | none beyond "write to this address"; no reply time | Promise met (none made); **receiving channel is a personal inbox with no verified handling** — Unverified operationally |
| Correction requests / data errors (today) | same | case text copied or emailed by the visitor; nothing arrives unless the visitor sends it | not confirmed; case "recorded here, not confirmed received" | none | none | "a case is sent only when you send it"; the corrections log publishes corrections made | Promise met; **a visitor without an email program has no path today** — closed by the report submission once configured |
| Report submissions (local HEAD, not deployed) | proposed: the owner, via GitHub notifications on the private reports repository | GitHub issue per report, receipt `QTR-<n>` | receipt issued only after the store accepted | GitHub assign/label/close | none | (local copy) receipt after acceptance; no reply promise | **Unverified** until pushed, configured and the live two-result check is done (`ops/REPORT-SUBMISSION-CHECK.md`) |
| Technical incidents | **no incident owner named** | GitHub Actions: journeys.yml opens/updates one issue "Production journeys failing"; checks-record.yml opens an issue on a failed suite | the issue | GitHub issue; closes when green | none | /status shows the recorded results | Detection exists (twice-daily production journeys + per-deploy); **response ownership Unverified** |
| Privacy requests | none named; /privacy is a draft with "To be supplied" entity details | the support mailbox | none | none | none | draft PDPA notice | **Not ready**: no entity, no process; counsel pending |
| Financial-rulebook reviews | **none** (`reviewOwner: null`) | — | — | `nextReviewDue 2026-12-15` is a date without a person | — | each line labelled verified/estimated/unverified; "Draft — not yet reviewed" | **Not met for any claim of statutory correctness** (blocker B-02) |
| Data-source updates | the owner, by hand (no schedule; SEC regeneration blocked on `SEC_UA`) | — | — | — | — | retrieval dates printed; "Delayed" only after 365 days | **Weak**: no owner-dated plan (06 F1/F2) |
| Release approval | the owner's own words to push (practice since 8 Nov) | this conversation / the handoff | the push and CI record | `health/checks.json`, `/status` | — | — | Met for approval; **promotion not protected** (07) |
| Rollback decisions | the owner (Vercel dashboard: promote a previous deployment) | — | — | — | no documented runbook in the repo beyond docs/release-gate.md | — | **Unverified** — no rollback has been rehearsed |
| Counsel-sensitive claims | the owner → counsel (pack prepared 19 Oct, unsent) | — | — | — | — | the site says an opinion is required before public launch | **Not met** (blocker B-03) |
| Paid service delivery | none | — | — | — | — | nothing on sale | Not applicable; **No-Go** for paid offers |

## Findings

- **O-01 (High, Blocked-decision)**: no named owner for the fee rulebook or for incidents; no backup for the support mailbox. Minimum action: the owner names themself or another person in the repo's fields (`reviewOwner`) and in the handoff for incidents/backup, or states that a single-owner operation is accepted for the pilot.
- **O-02 (High)**: no verified operational receiving process for enquiries — a personal inbox with no receipt confirmation and no tracking. For a free research pilot this is disclosed truthfully and acceptable as a limitation; it is **not** a basis for certifying "support" or for any paid promise.
- **O-03 (Medium)**: report submission's operational half (GitHub issues retrieved and owned) is designed and documented, not exercised live.
- **O-04 (Medium)**: rollback never rehearsed; the only gate is the owner's attention (Deployment Checks off).
- **O-05 (Medium)**: data refresh has no owner-dated plan.

Operational delivery gate: **not established** for a full official launch. For a controlled free pilot the limitations are disclosed on the site (no SLA, no receipt, browser-only storage), which is the honest state.
