#!/usr/bin/env node
/**
 * Section 13 of the extraction specification bans a set of phrases unless
 * record-level data supports them. No record-level data is licensed to this
 * product, so they are banned outright — with the two exemptions below, both of
 * which this check found by getting them wrong first.
 *
 *   node wording-check.mjs
 *
 * WHY A CHECK AND NOT A CONVENTION. "Last transacted price" is the natural
 * thing to type. It reads well, it is exactly what a user asks for, and it is
 * wrong here for a reason invisible in the sentence itself: the finest period
 * NAPIC publishes is a half-year, and none of these files carries a transaction
 * date at all. A phrase that is wrong for an invisible reason comes back.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

const BANNED = [
  'last transacted price',
  'latest sold price',
  'current market price',
  'real-time price',
  'all transactions',
  'median price',
];

/* EXEMPTION 1 — A HYPHENATED CONTINUATION IS A DIFFERENT TERM.
   "Peer median price-to-book" is an equity ratio with nothing to do with a
   property median. Flagging it taught nobody anything, and a check that cries
   wolf is a check people learn to skip — which is how it stops working. */
const CONTINUATION = /^[\s-‐-―]*(to|per|and|or)\b/i;

/* EXEMPTION 2 — TEXT WHOSE PURPOSE IS TO DENY THE CLAIM.
   A disclaimer naming what is absent has to be able to name it, and so does a
   comment recording why a feature was renamed. */
const DENIAL = new RegExp([
  'not available', 'cannot', 'will not', 'never', 'would not', 'does not',
  'is not', 'are not', 'unavailable', 'refus', 'no transaction',
  'was called', 'replaces', 'the name was', 'banned', 'do not use', 'instead of',
].join('|'), 'i');

let bad = 0;
const lower = html.toLowerCase();
for (const phrase of BANNED) {
  let i = -1;
  while ((i = lower.indexOf(phrase, i + 1)) !== -1) {
    const after = html.slice(i + phrase.length, i + phrase.length + 12);
    if (CONTINUATION.test(after)) continue;
    /* Enough context either side to see the clause it sits in. */
    const ctx = html.slice(Math.max(0, i - 260), i + 260).replace(/\s+/g, ' ');
    if (DENIAL.test(ctx)) continue;
    bad++;
    console.error(`FAIL  "${phrase}" used as a claim`);
    console.error(`      …${ctx.slice(150, 430)}…`);
  }
}

console.log(bad
  ? `\n${bad} banned phrase(s) used as a claim. None is supported by the data this product holds.`
  : `ok    none of the ${BANNED.length} banned phrases is used as a claim`);
process.exitCode = bad ? 1 : 0;
