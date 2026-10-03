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

/* ---- bugfix3: property ---- */
/* A WORKED FIGURE IN THE LAND-UNITS HEADER IS THE ARITHMETIC OF ITS OWN
   CONSTANTS. It said the listings' rounded 40.47 m² a point moves a 60-point
   parcel by "nearly a square metre"; it moves it by 0.086 m². A comment is
   where the next person learns why the code does not round, so its numbers
   are held to the same standard as the page's. Each figure is recomputed from
   the constants the file defines. */
{
  const src = readFileSync(join(ROOT, 'src', 'js', '67-land-units.js'), 'utf8');
  const flat = src.replace(/\s*\n\s*/g, ' ');
  const constant = (name) => {
    const m = src.match(new RegExp(`const ${name} = ([^;]+);`));
    return m ? Function('SQFT_PER_ACRE', `return (${m[1]});`)(43560) : NaN;
  };
  const exact = constant('SQFT_PER_POINT') * constant('SQM_PER_SQFT');
  const perPoint = 40.47 - exact;
  const said = {
    perPoint: flat.match(/it is ([\d.]+) m² a point too large/),
    parcel: flat.match(/to a (\d+)-point parcel it moves the area by ([\d.]+) m²/),
    whole: flat.match(/to a (\d+)-point estate by a whole square metre/),
  };
  const wrong = [];
  if (!said.perPoint || Math.abs(Number(said.perPoint[1]) - perPoint) > 0.00005) wrong.push(`the error a point (${perPoint.toFixed(6)} m²)`);
  if (!said.parcel || Math.abs(Number(said.parcel[2]) - Number(said.parcel[1]) * perPoint) > 0.0005) wrong.push(`the parcel figure (60 points is ${(60 * perPoint).toFixed(4)} m²)`);
  if (!said.whole || Math.abs(Number(said.whole[1]) * perPoint - 1) > 0.01) wrong.push(`the square-metre parcel (${(1 / perPoint).toFixed(0)} points)`);
  if (wrong.length) {
    bad += 1;   /* one false claim, however many of its figures are wrong */
    console.error(`FAIL  the land-units header states figures its own constants do not give: ${wrong.join('; ')}`);
  } else console.log(`ok    the land-units header's rounding figures are its constants' arithmetic — ${perPoint.toFixed(4)} m² a point, ${(Number(said.parcel[1]) * perPoint).toFixed(3)} m² on ${said.parcel[1]} points`);
}
/* ---- end bugfix3: property ---- */

/* ---- release-a: fixes ---- */
/* NO DIRECTIONS THROUGH NAVIGATION THAT IS GONE. "My Investments" was a header
   item before Release A; neither chrome has it now (the sidebar says "Your
   data & settings", and Tracked sits under Watchlists), yet a company's
   snapshot, the search results, the screener and a trend drawer still sent
   readers "under My Investments → Your data". Code only — a comment recording
   the old name is history, not a direction. */
{
  const dir = join(ROOT, 'src', 'js');
  const stale = [];
  for (const f of readdirSync(dir).filter(x => x.endsWith('.js'))) {
    const code = readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    code.split('\n').forEach(line => { if (/My Investments/.test(line)) stale.push(`${f}: ${line.trim().slice(0, 140)}`); });
  }
  if (stale.length) {
    bad += stale.length;
    console.error(`FAIL  ${stale.length} string(s) name "My Investments", which no navigation carries since Release A:`);
    stale.forEach(x => console.error(`      ${x}`));
  } else console.log('ok    no page text directs a reader through "My Investments", a header item Release A removed');
}
/* ---- end release-a: fixes ---- */

/* ---- audit: content ---- */
/* THE LEGAL PAGES INVENT NO PARTY, AND SAY THEY ARE DRAFTS (launch audit,
   29 Sep 2026). No operating entity is registered, so Terms, Privacy, About
   and Contact show the entity's name, its registered address, its contact
   email and the domain as "To be supplied" markers — and the Bahasa Malaysia
   version of the PDPA notice likewise. Read from the source, comments left
   out:
   1. the details come from one table, OPERATOR (55-views-public.js), whose
      entries are empty or read from LAUNCH, so a supplied detail is one edit
      and every page follows; while an entry is empty its marker shows;
   2. none of the trust pages or the plans page writes a detail into its
      text anyway — no email address, no company suffix (Sdn Bhd, Berhad,
      PLT), no registration number, no Malaysian telephone number;
   3. Terms and Privacy both open with the draft line, which the built page
      carries. */
{
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const read = (f) => readFileSync(join(ROOT, 'src', 'js', f), 'utf8');
  const pub = read('55-views-public.js'), plans = read('90-area-screen.js'), plansCore = read('05-plans.js'), launch = read('15-derivation.js');
  const cut = (s, from, to) => { const i = s.indexOf(from); if (i < 0) return ''; const j = s.indexOf(to, i + from.length); return s.slice(i, j < 0 ? undefined : j); };
  const trust = code(cut(pub, 'TRUST PAGES', 'VIEWS.notfound'));
  const plansView = code(cut(plans, 'VIEWS.plans = () =>', '\n};'));
  const wrong = [];
  const table = trust.match(/const OPERATOR = \{([\s\S]*?)\n\};/);
  const KEYS = { entity: 'operating entity name', address: 'registered address', email: 'contact email', domain: 'domain', bm: 'Bahasa Malaysia translation' };
  if (!table) wrong.push('no OPERATOR table in the trust pages');
  else for (const [k, label] of Object.entries(KEYS)) {
    const row = table[1].match(new RegExp(`\\b${k}:\\s*\\{([^}]*)\\}`));
    if (!row) { wrong.push(`OPERATOR has no "${k}"`); continue; }
    if (!row[1].includes(`'${label}'`)) wrong.push(`OPERATOR.${k} is not marked "${label}"`);
    const value = row[1].match(/value:\s*([^,]+)/)?.[1].trim();
    if (value !== "''" && value !== '() => LAUNCH.contactEmail') wrong.push(`OPERATOR.${k} holds ${value} — a detail is supplied by the owner, never written in here`);
  }
  if (!/contactEmail:\s*'',/.test(launch)) wrong.push('LAUNCH.contactEmail is set: the markers and this check need the address the owner supplied');
  const INVENTED = [[/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, 'an email address'], [/\bSdn\.?\s*Bhd\b|\bBerhad\b|\bPLT\b/, 'a company suffix'],
    [/\b\d{12}\b|\b\d{6,7}-[A-Z]\b/, 'a registration number'], [/(\+?6?0)1\d[\s-]?\d{3,4}[\s-]?\d{4}|\+60[\s-]?\d/, 'a telephone number']];
  for (const [name, text] of [['the trust pages', trust], ['the plans page', plansView], ['05-plans.js', code(plansCore)]])
    for (const [re, what] of INVENTED) { const m = text.match(re); if (m) wrong.push(`${name} write ${what}: "${m[0]}"`); }
  const drafts = (html.match(/Draft — not yet reviewed by a lawyer\./g) || []).length;
  if (!/trustPage\('Terms',[\s\S]*?\{ draft:/.test(trust) || !/trustPage\('Privacy',[\s\S]*?\{ draft:/.test(trust) || !drafts)
    wrong.push(`Terms and Privacy do not both open with the draft line (${drafts} in the built page)`);
  if (wrong.length) {
    bad += wrong.length;
    console.error(`FAIL  the legal pages: ${wrong.length} problem(s)`);
    wrong.forEach(x => console.error(`      ${x}`));
  } else console.log(`ok    the legal pages invent no party: the ${Object.keys(KEYS).length} details come from OPERATOR, none filled in, each shown as a "To be supplied" marker; no email, company, registration or telephone number is written into the trust or plans pages; Terms and Privacy open with the draft line`);
}
/* ---- end audit: content ---- */

/* ---- audit3: monitor ---- */
/* NO PROMISE TO MONITOR WHAT THIS SITE CANNOT RUN. The headline, the site's
   description and the footer said a visitor could "monitor your own market
   setups"; on this site a setup can be written and saved, and nothing runs
   it — there are no prices here (the Scanner's own card says so). Daily
   audits #2 and #3 both flagged it, and the owner chose "build" (2026-10-03).
   The goal card's title, "Monitor my setups", stays: it carries the Beta
   badge and the note that says where setups run. Page code and the
   template's meta tags; comments are history. */
{
  const files = [...readdirSync(join(ROOT, 'src', 'js')).filter(x => x.endsWith('.js')).map(f => join(ROOT, 'src', 'js', f)), join(ROOT, 'src', 'index.template.html')];
  const said = [];
  for (const f of files) {
    /* A JS comment in a module, an HTML comment in the template: the
       template's CSS comments ran from before its meta tags to after them,
       and stripped as JS would have hidden all three. */
    const raw = readFileSync(f, 'utf8');
    const text = f.endsWith('.html') ? raw.replace(/<!--[\s\S]*?-->/g, '') : raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    text.split('\n').forEach(line => { if (/monitor your own (market )?setups|monitor your setups/i.test(line)) said.push(`${f.slice(ROOT.length + 1)}: ${line.trim().slice(0, 120)}`); });
  }
  if (said.length) {
    bad += said.length;
    console.error(`FAIL  ${said.length} line(s) promise a visitor can monitor their setups here, where nothing runs them:`);
    said.forEach(x => console.error(`      ${x}`));
  } else console.log('ok    no page or meta tag promises "monitor your own setups": a visitor builds setups here, and the Scanner\'s card says where they run');
}
/* ---- end audit3: monitor ---- */

console.log(bad
  ? `\n${bad} banned phrase(s) used as a claim. None is supported by the data this product holds.`
  : `ok    none of the ${BANNED.length} banned phrases is used as a claim`);
process.exitCode = bad ? 1 : 0;
