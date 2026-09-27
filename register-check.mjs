#!/usr/bin/env node
/**
 * The capability register against the routes, the checks and the Phase 2
 * brief — with no browser.
 *
 *   node register-check.mjs             the rules every push must meet
 *   node register-check.mjs --release   also: is Phase 2 complete?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * /status is the product's public statement of what works. Every row on it
 * was typed by hand, and nothing held a row to what it said: a row could
 * read "Active Maintenance" with a path that had been renamed, and the only
 * symptom was a link to the not-found card on the one page whose job is to
 * be right about the others. The Phase 2 brief adds a release rule on top —
 * no P0 item marked complete until its checks pass, no P1 surface shown as
 * operational until it is — and a rule nobody checks is a sentence.
 *
 * So the register is read the way the page reads it, sliced out of the
 * source like scanner-test slices the engine, and held to five things:
 *
 *   1. a row in an operational state (active-core, maintenance, beta) has a
 *      path, and every path resolves through the app's own route table to a
 *      view that exists — and, where it names a company or a tab, to a
 *      company in the data and a tab the view has;
 *   2. a row answering a brief item carries that item's priority from
 *      docs/phase2-plan.md §1, and every item there is answered by some row,
 *      so no item of the brief can drop off the page unremarked;
 *   3. a prioritised row in an operational state, or a flagged one, names
 *      the checks that cover it, and each named check exists — the file is
 *      there and the phrase is in it;
 *   4. a P1 row that is not complete and has a surface is 'flagged', and a
 *      flagged row says what it lacks (the page prints it);
 *   5. `complete` is only claimed with checks, in an operational state.
 *
 * With --release it also fails while any P0 row is not complete — the
 * mechanical meaning of "Phase 2 is done". CI does not pass it: every row is
 * honestly partial today, and a gate that is red by design is not a gate.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const RELEASE = process.argv.includes('--release');
const read = (f) => readFileSync(f, 'utf8');

let failures = 0, passes = 0;
const fail = (msg, detail) => {
  failures++;
  console.error(`FAIL  ${msg}`);
  (detail || []).slice(0, 12).forEach(d => console.error(`      ${d}`));
  if ((detail || []).length > 12) console.error(`      … and ${detail.length - 12} more`);
};
const ok = (msg) => { passes++; console.log(`ok    ${msg}`); };

/* A top-level array literal, cut at the first line that closes it. The
   register and the route table are both written that way; if either stops
   being, this throws with the name rather than evaluating half a file. */
function sliceArray(text, name) {
  const start = text.indexOf(`const ${name} = [`);
  if (start < 0) throw new Error(`const ${name} = [ not found`);
  const end = text.indexOf('\n];', start);
  if (end < 0) throw new Error(`no closing ]; for ${name}`);
  return text.slice(start, end + 3);
}
function sliceFunction(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  const end = text.indexOf('\n}\n', start);
  return text.slice(start, end + 2);
}

const REG = read('src/js/80-registers.js');
const UI = read('src/js/35-ui.js');
const RESEARCH = read('src/js/45-views-research.js');
/* Every module, read from the directory, so a view added in a new file is
   found without this script being told about it. */
const SOURCES = readdirSync('src/js').filter(f => f.endsWith('.js')).map(f => read(`src/js/${f}`)).join('\n');

/* Functions in rows (a count resolved at render) are never called here, so
   what they reference needs no stub; only the literals are read. */
const ctx = vm.createContext({ URLSearchParams });
const { FEATURE_STATUS, CAPABILITY_REGISTER, ROUTES, RESEARCH_TABS, matchRoute } = vm.runInContext([
  sliceArray(REG, 'FEATURE_STATUS'), sliceArray(REG, 'CAPABILITY_REGISTER'),
  sliceArray(UI, 'ROUTES'), sliceArray(RESEARCH, 'RESEARCH_TABS'),
  "const BASE = '';", sliceFunction(UI, 'matchRoute'),
  '({ FEATURE_STATUS, CAPABILITY_REGISTER, ROUTES, RESEARCH_TABS, matchRoute })',
].join('\n'), ctx);

const OPERATIONAL = new Set(['active-core', 'maintenance', 'beta']);
const STATUS_IDS = new Set(FEATURE_STATUS.map(s => s.id));
const VIEWS = new Set([...SOURCES.matchAll(/\bVIEWS\.([A-Za-z]+)\s*=/g)].map(m => m[1]));

/* The companies a path may name: the filers in the shipped file (as
   TICKER-SEC) and the illustrative set's ids. */
const us = JSON.parse(read('data/us.json'));
const COMPANY_IDS = new Set([
  ...us.results.map(r => `${r.id}-SEC`),
  ...[...read('src/js/10-dataset.js').matchAll(/\{\s*id:'([^']+)'/g)].map(m => m[1]),
]);

/* The brief's items and their priorities, from the plan's status table. */
const PLAN = read('docs/phase2-plan.md');
const BRIEF = new Map([...PLAN.matchAll(/^\|\s*(NAV|EQ-\d{3})\b[^|]*\|\s*(P[01])\s*\|/gm)].map(m => [m[1], m[2]]));

console.log(`register  ${CAPABILITY_REGISTER.length} rows, ${FEATURE_STATUS.length} states, ${ROUTES.length} routes, ${VIEWS.size} views, ${BRIEF.size} brief items\n`);

/* 0 — the vocabulary. */
{
  const bad = CAPABILITY_REGISTER.filter(c => !STATUS_IDS.has(c.status)).map(c => `${c.name}: status "${c.status}"`);
  const names = CAPABILITY_REGISTER.map(c => c.name);
  names.filter((n, i) => names.indexOf(n) !== i).forEach(n => bad.push(`"${n}" is listed twice`));
  if (!STATUS_IDS.has('flagged')) bad.push('there is no feature-flagged state');
  if (bad.length) fail('every row is in a known state, once', bad);
  else ok(`every row is in one of the ${STATUS_IDS.size} known states, and no capability is listed twice`);
}

/* 1 — routes. */
{
  const bad = [];
  let resolved = 0;
  for (const c of CAPABILITY_REGISTER) {
    if (OPERATIONAL.has(c.status) && !c.path) { bad.push(`${c.name}: "${c.status}" with no path — an operational row has to open somewhere`); continue; }
    if (!c.path) continue;
    const [p, q] = String(c.path).split('?');
    const rt = matchRoute(p);
    if (!rt) { bad.push(`${c.name}: ${c.path} matches no route`); continue; }
    if (!VIEWS.has(rt.view)) { bad.push(`${c.name}: ${c.path} routes to view "${rt.view}", which no module defines`); continue; }
    if (rt.params?.id && !COMPANY_IDS.has(rt.params.id)) bad.push(`${c.name}: ${c.path} names ${rt.params.id}, which is neither a filer in data/us.json nor an illustrative company`);
    const tab = new URLSearchParams(q || '').get('tab');
    if (tab && rt.view === 'research' && !RESEARCH_TABS.some(t => t.id === tab)) bad.push(`${c.name}: ${c.path} names tab "${tab}", which the company page does not have`);
    resolved++;
  }
  if (bad.length) fail('every operational row opens a real route', bad);
  else ok(`every operational row opens a real route — ${resolved} paths resolve to a view that exists, and the company and tab each names are real`);
}

/* 2 — priorities agree with the brief, and every item of it is answered. */
{
  const bad = [];
  if (BRIEF.size < 10) bad.push(`only ${BRIEF.size} items read from docs/phase2-plan.md §1 — the status table's shape has changed`);
  const answered = new Set();
  for (const c of CAPABILITY_REGISTER) {
    if (c.priority && !c.brief?.length) bad.push(`${c.name}: priority ${c.priority} with no brief item — priority comes from the brief`);
    if (!c.brief?.length) continue;
    if (!['P0', 'P1'].includes(c.priority)) { bad.push(`${c.name}: answers ${c.brief.join(', ')} but carries no P0/P1 priority`); continue; }
    for (const b of c.brief) {
      if (!BRIEF.has(b)) { bad.push(`${c.name}: cites ${b}, which is not an item of the brief`); continue; }
      answered.add(b);
      if (BRIEF.get(b) !== c.priority) bad.push(`${c.name}: ${c.priority}, but the plan gives ${b} ${BRIEF.get(b)}`);
    }
  }
  const unanswered = [...BRIEF.keys()].filter(b => !answered.has(b));
  if (unanswered.length) bad.push(`no row answers ${unanswered.join(', ')} — an item of the brief would be missing from /status`);
  if (bad.length) fail('every row that answers the brief carries its priority, and every item is answered', bad);
  else ok(`every brief row carries its item's priority from the plan, and all ${BRIEF.size} items are answered by a row`);
}

/* 3 — named checks exist. */
{
  const bad = [];
  let named = 0;
  const cache = new Map();
  for (const c of CAPABILITY_REGISTER) {
    const needs = (c.priority && OPERATIONAL.has(c.status)) || c.status === 'flagged' || c.complete;
    if (needs && !c.checks?.length) bad.push(`${c.name}: ${c.priority || ''} "${c.status}" names no check`);
    for (const x of c.checks || []) {
      if (!x?.file || !x?.name) { bad.push(`${c.name}: a check without a file and a name`); continue; }
      if (!existsSync(x.file)) { bad.push(`${c.name}: ${x.file} does not exist`); continue; }
      if (!cache.has(x.file)) cache.set(x.file, read(x.file));
      if (!cache.get(x.file).includes(x.name)) bad.push(`${c.name}: "${x.name}" is not in ${x.file}`);
      else named++;
    }
  }
  if (bad.length) fail('every prioritised operational row and every flagged row names checks that exist', bad);
  else ok(`every prioritised operational row and every flagged row names its checks — ${named} named checks, each found in its file`);
}

/* 4 and 5 — the release rule. */
{
  const bad = [];
  for (const c of CAPABILITY_REGISTER) {
    if (c.status === 'flagged' && !c.path) bad.push(`${c.name}: flagged with no path — a flag with no surface flags nothing; queue it`);
    if (c.status === 'flagged' && !(typeof c.flag === 'string' && c.flag.trim().length > 20)) bad.push(`${c.name}: flagged without saying what it lacks (flag:)`);
    if (c.flag && c.status !== 'flagged') bad.push(`${c.name}: carries a flag sentence but its status is "${c.status}"`);
    if (c.priority === 'P1' && !c.complete && c.path && c.status !== 'flagged') bad.push(`${c.name}: P1, partial, reachable at ${c.path} and "${c.status}" — it has to be flagged until it is complete`);
    if (c.complete && !OPERATIONAL.has(c.status)) bad.push(`${c.name}: complete, but "${c.status}"`);
    if (c.complete && c.status === 'flagged') bad.push(`${c.name}: complete and flagged at once`);
  }
  if (bad.length) fail('every partial P1 surface is feature-flagged, and says what it lacks', bad);
  else {
    const p1 = CAPABILITY_REGISTER.filter(c => c.priority === 'P1');
    ok(`every partial P1 surface is feature-flagged and says what it lacks — ${p1.filter(c => c.status === 'flagged').length} flagged, ${p1.filter(c => !c.path).length} with no surface yet, ${p1.filter(c => c.complete).length} complete`);
  }
}

if (RELEASE) {
  const open = CAPABILITY_REGISTER.filter(c => c.priority === 'P0' && !c.complete).map(c => `${c.name} (${c.brief.join(', ')}): ${c.status}, partial`);
  if (open.length) fail(`Phase 2 is not complete: ${open.length} P0 rows are partial`, open);
  else ok('every P0 row is complete, in an operational state, with its checks named');
}

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} register rules hold`);
process.exitCode = failures ? 1 : 0;
