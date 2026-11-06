# Property summary for ELS: the contract

Written 6 November 2026 (QT-D24-02). This records what Quantum's optional renovation brief contains, the rules it follows, and what a receiver would have to supply before anything more than copy and paste could exist.

**It is not a referral system.** Nothing is sent, no endpoint exists, and ELS has not agreed to receive this format. A person reads the brief, copies it, and pastes it into ELS's enquiry form themselves.

## Where it lives

| What | Where |
|---|---|
| The brief, built from the deal | `elsBrief` in `src/js/70-property.js` |
| The panel: review, edit, copy, link | `pcElsPanel` in `src/js/75-property-grade.js` |
| The tests | `model-test.mjs` (the `els EB` checks) and the `property` journey in `journeys.mjs` |

## Version 1: `qt-property-brief/1` (in use)

The first line of the brief names its version: `Quantum Tradeworks renovation brief (qt-property-brief/1)`. A change to the fields or their meaning takes a new version.

| Line | Content | How its source is shown |
|---|---|---|
| Property type | The deal's property type | Listed under Assumptions while still the sample's |
| Location | The city and area the reader chose | "(as you entered it)", or "Not set — the sample's location is not yours" |
| Intended use | Let to a tenant, own use, or a mix | "Not set" where nothing applies; listed under Assumptions while still the sample's |
| Renovation allowance | The amount, only once the reader has entered it | One of the four wordings below |
| Your requirements | The reader's own words, up to 1,000 characters | Theirs, as typed. Not stored |
| Assumptions | Which of the four deal facts are still the sample's | Left out when all four are the reader's |

**The renovation allowance reads one of:**
- "Not set: the calculator's sample figure is not a budget";
- "RM…, a placeholder you entered — not a budget", or "RM…, including a placeholder you entered — not a budget";
- "RM…, from a quotation you entered — not verified by Quantum";
- "RM…, as you entered it — your own figure, not a quotation or a verified budget".

### How the brief's labels map to the source types

| Source type | In version 1 |
|---|---|
| Entered | "as you entered it", or the reader's own words |
| Illustrative | Never shown as a value. "Not set", or named under Assumptions |
| Estimated | Does not arise. Nothing the model estimates is in the brief |
| Unavailable | "Not set" |

### What version 1 leaves out, on purpose

The owner's instruction of 31 October 2026: only four facts of the deal leave it.

- **Never included:** price, deposit, loan, interest rate, repayment, rent, income, cash flow, cash required, reserve, returns, a name, a contact, or a saved property's identifier.
- **Model version:** not included, because no figure in the brief comes from the model. The only amount is one the reader typed.

### The rules

1. It is optional, and appears only after the results. Quantum is complete without it.
2. The reader sees the whole text before copying it.
3. Nothing is sent or stored, and copying sends nothing. The confirmation says so: "Brief copied. Nothing has been sent to ELS. You decide whether to share it."
4. The link to `https://els.alumax.pro/contact` carries no query or hash, and opening it is never described as receipt.
5. Opening the panel and copying the brief leave the deal unchanged.
6. Nothing in the brief is called verified, approved or confirmed.
7. It belongs to Property only. Equities and the Scanner have no route to it.

### If ELS is unavailable

The brief is plain text and can be kept or sent any other way. The reader can still save the property, and use "Export everything" and "Export PDF / Share with client" as before; none of them needs ELS.

**The figures have their own route.** The client proposal from "Export PDF / Share with client" carries the financial workings, the fee rulebook version, and which inputs are still sample values. Sharing it is the reader's own act.

## Financial figures stay out

**The owner's decision, 6 November 2026, under the current referral policy.** ELS needs design requirements, not Quantum's financial assessment. The referral stays optional and copy-and-paste only, with no integration.

The Day 24 brief asked for purchase assumptions, a financial summary and the model version. They are not part of this contract, and no version that carries them is planned. That covers the purchase price, mortgage and financing details, rental yield, cash flow, returns, affordability, financial assumptions, saved-assessment identifiers and financial reports.

The one amount the brief can carry is the renovation allowance, and only once the reader has typed it and reviewed it. It is the reader's own budget for the work, not a figure from Quantum's assessment.

## What a receiver must supply first

None of this exists yet. All of it belongs to the ELS side, in a separate piece of work, and Quantum needs no simultaneous deployment for version 1.

| Requirement | What is needed |
|---|---|
| Purpose | An approved reason for receiving this information |
| Fields | The accepted fields, their definitions and which versions are accepted |
| Consent | The wording a person agrees to, on ELS's side |
| Follow-up | A named person or role responsible |
| Receipt | How ELS acknowledges a real submission. Opening a page is not receipt, and a Quantum identifier is not an ELS receipt number |
| Missing fields | What happens with "Not set", or with an unknown version |
| Separation | Design consultation kept apart from investment analysis |

## Who is responsible for what

These stay separate, and a summary must not merge them.

| Name | Responsibility |
|---|---|
| Quantum Tradeworks | The property assessment. It is research, not advice, a valuation or a quotation |
| ELS Studio | Design and specification |
| ELS+ | Where separately contracted: delivery of the renovation works, trade coordination, quality, handover and agreed rectification |
| ELS Bespoke | Customisation, with ELS+ delivery only where contracted |
| ALUMAX | Curated products, supply and installation |

Quotations need ELS's own assessment of the property. Nothing in the brief is a quotation or an approved budget.
