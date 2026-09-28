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
import { readFileSync, readdirSync } from 'node:fs';
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

/* THE SCANNER'S OWN CLAIMS (docs/phase3-plan.md SC-314, SC-316). Historical
   testing is a simulation of dates, so no performance word may be used as a
   claim in it; screening lists instruments in symbol order, so no ranking
   word may. Scoped to the scanner's modules — "ranked by how the term
   matched" is the company search's honest description of itself — with the
   same denial exemption, plus the two ways the scanner pages deny it. */
const SCANNER_BANNED = ['win rate', 'hit rate', 'profitable', 'backtested return', 'top picks', 'best setups', 'strongest', 'ranked by'];
const SCANNER_DENIAL = new RegExp(`${DENIAL.source}|there is no|shows no`, 'i');
const scannerSrc = readdirSync(join(ROOT, 'src', 'js')).filter(f => /scanner|market-engine/.test(f))
  .map(f => [f, readFileSync(join(ROOT, 'src', 'js', f), 'utf8')]);
let scanBad = 0;
for (const [f, text] of scannerSrc) {
  const low = text.toLowerCase();
  for (const phrase of SCANNER_BANNED) {
    let i = -1;
    while ((i = low.indexOf(phrase, i + 1)) !== -1) {
      const ctx = text.slice(Math.max(0, i - 200), i + 200).replace(/\s+/g, ' ');
      if (SCANNER_DENIAL.test(ctx)) continue;
      scanBad++;
      console.error(`FAIL  "${phrase}" used as a claim in ${f}`);
      console.error(`      …${ctx.slice(110, 330)}…`);
    }
  }
}
bad += scanBad;
if (!scanBad) console.log(`ok    none of the ${SCANNER_BANNED.length} scanner performance and ranking phrases is used as a claim in ${scannerSrc.length} scanner modules`);

/* NO LIVE OR REAL-TIME CLAIM ON THE SCANNER PAGES (docs/phase3-plan.md
   SC-317). The scanner reads end-of-day bars the reader captured; intraday
   bars need a licensed feed this product does not hold, and the brief
   forbids presenting unfinished intraday work as available. So in the
   scanner modules' text — comments left out, because a comment is where a
   decision about "live" gets recorded — "live", "real-time" and "realtime"
   may appear only in a sentence that denies them. The sentence is the one
   the word sits in, cut at a string's quotes or a full stop, not a window
   of text around it: a claim beside a disclaimer is still a claim. The
   attribute aria-live and the file ingest/live.mjs are not words of a page
   and are not matched; a verb ("a token has to live on a server") sits in
   a sentence that says what is missing, which the denial list reads.
   equity-test checks the rendered pages the same way. */
const LIVE = /(?<![\w-])(live|real[\s-]?time|realtime)(?!\w|\.mjs)/gi;
const LIVE_DENIAL = new RegExp(`${SCANNER_DENIAL.source}|not built|\\bneeds?\\b|neither|\\blater\\b|\\bP2\\b|blocked|waits? on|\\bno\\b`, 'i');
const uncommented = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const sentenceAt = (text, i, len) => {
  const left = text.slice(Math.max(0, i - 400), i), right = text.slice(i + len, i + len + 400);
  const cut = Math.max(0, ...[...left.matchAll(/['"`]|[.!?](?=\s)/g)].map(m => m.index + 1));
  const end = right.search(/['"`]|[.!?](?=\s|$)/);
  return (left.slice(cut) + text.slice(i, i + len) + (end < 0 ? right : right.slice(0, end + 1))).replace(/\s+/g, ' ').trim();
};
let liveBad = 0, liveSeen = 0;
for (const [f, text] of scannerSrc) {
  const code = uncommented(text);
  for (const m of code.matchAll(LIVE)) {
    liveSeen++;
    const s = sentenceAt(code, m.index, m[0].length);
    if (LIVE_DENIAL.test(s)) continue;
    liveBad++;
    console.error(`FAIL  "${m[0]}" used as a claim in ${f}`);
    console.error(`      “${s.slice(0, 220)}”`);
  }
}
bad += liveBad;
if (!liveBad) console.log(`ok    no "live" or "real-time" claim in the text of ${scannerSrc.length} scanner modules — ${liveSeen} use${liveSeen === 1 ? '' : 's'}, each in a sentence that denies it`);

console.log(bad
  ? `\n${bad} banned phrase(s) used as a claim. None is supported by the data this product holds.`
  : `ok    none of the ${BANNED.length} banned phrases is used as a claim`);
process.exitCode = bad ? 1 : 0;
