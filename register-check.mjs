#!/usr/bin/env node
/**
 * The capability register against the routes, the checks and the Phase 2
 * brief — with no browser.
 *
 *   node register-check.mjs                    the rules every push must meet
 *   node register-check.mjs --release          also: is Phase 2 complete?
 *   node register-check.mjs --release phase3   also: is Phase 3 complete?
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
 *
 * PHASE 3 adds a second brief, the Quantum Scanner (docs/phase3-plan.md §1):
 * items SC-301…SC-319 and SC-NAV — the plan's "NAV" row, renamed here so it
 * cannot merge with Phase 2's NAV. It brings P2, the later live-scanning
 * release, and a sixth rule: a P2 row is never operational, never flagged
 * and has no path, because nothing of that release may look available.
 * A seventh: robots.txt keeps every /app/scanner and /admin route out of
 * crawlers — personal-lane records and one machine's operations.
 * --release phase3 lists the blocked P0 items apart, with what blocks them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import vm from 'node:vm';

const RELEASE = process.argv.includes('--release');
const RELEASE_PHASE = RELEASE && process.argv[process.argv.indexOf('--release') + 1] === 'phase3' ? 3 : 2;
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
const registerPhaseOf = (c) => ((c.brief || []).some(b => /^SC-/.test(b)) ? 3 : 2);
const STATUS_IDS = new Set(FEATURE_STATUS.map(s => s.id));
const VIEWS = new Set([...SOURCES.matchAll(/\bVIEWS\.([A-Za-z]+)\s*=/g)].map(m => m[1]));

/* The companies a path may name: the filers in the shipped file (as
   TICKER-SEC) and the illustrative set's ids. */
const us = JSON.parse(read('data/us.json'));
const COMPANY_IDS = new Set([
  ...us.results.map(r => `${r.id}-SEC`),
  ...[...read('src/js/10-dataset.js').matchAll(/\{\s*id:'([^']+)'/g)].map(m => m[1]),
]);

/* The briefs' items and their priorities, from each plan's status table.
   Phase 3's NAV row is keyed SC-NAV. P2 exists only in Phase 3. */
const PLAN = read('docs/phase2-plan.md');
const BRIEF = new Map([...PLAN.matchAll(/^\|\s*(NAV|EQ-\d{3})\b[^|]*\|\s*(P[01])\s*\|/gm)].map(m => [m[1], m[2]]));
const BRIEF2_SIZE = BRIEF.size;
const PLAN3 = existsSync('docs/phase3-plan.md') ? read('docs/phase3-plan.md') : '';
const plan3Status = PLAN3.slice(PLAN3.indexOf('## 1.'), PLAN3.indexOf('## 2.'));
const BRIEF3 = new Map([...plan3Status.matchAll(/^\|\s*(NAV|SC-\d{3})\b[^|]*\|\s*(P[012])\s*\|/gm)].map(m => [m[1] === 'NAV' ? 'SC-NAV' : m[1], m[2]]));
BRIEF3.forEach((p, k) => BRIEF.set(k, p));

console.log(`register  ${CAPABILITY_REGISTER.length} rows, ${FEATURE_STATUS.length} states, ${ROUTES.length} routes, ${VIEWS.size} views, ${BRIEF2_SIZE} + ${BRIEF3.size} brief items (Phase 2 + Phase 3)\n`);

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
    /* Only a company page's :id names a company; a scanner setup or an alert
       is :setup or :alert, and is not looked up here. */
    if (['research', 'researchReport'].includes(rt.view) && rt.params?.id && !COMPANY_IDS.has(rt.params.id)) bad.push(`${c.name}: ${c.path} names ${rt.params.id}, which is neither a filer in data/us.json nor an illustrative company`);
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
  if (BRIEF2_SIZE < 10) bad.push(`only ${BRIEF2_SIZE} items read from docs/phase2-plan.md §1 — the status table's shape has changed`);
  if (PLAN3 && BRIEF3.size < 20) bad.push(`only ${BRIEF3.size} items read from docs/phase3-plan.md §1 — the status table's shape has changed`);
  const answered = new Set();
  for (const c of CAPABILITY_REGISTER) {
    if (c.priority && !c.brief?.length) bad.push(`${c.name}: priority ${c.priority} with no brief item — priority comes from the brief`);
    if (!c.brief?.length) continue;
    const sc = c.brief.some(b => /^SC-/.test(b));
    if (sc && c.brief.some(b => !/^SC-/.test(b))) bad.push(`${c.name}: cites items of both briefs (${c.brief.join(', ')}) — a row answers one brief`);
    if (!(sc ? ['P0', 'P1', 'P2'] : ['P0', 'P1']).includes(c.priority)) { bad.push(`${c.name}: answers ${c.brief.join(', ')} but carries no ${sc ? 'P0/P1/P2' : 'P0/P1'} priority`); continue; }
    for (const b of c.brief) {
      if (!BRIEF.has(b)) { bad.push(`${c.name}: cites ${b}, which is not an item of the brief`); continue; }
      answered.add(b);
      if (BRIEF.get(b) !== c.priority) bad.push(`${c.name}: ${c.priority}, but the plan gives ${b} ${BRIEF.get(b)}`);
    }
  }
  const unanswered = [...BRIEF.keys()].filter(b => !answered.has(b));
  if (unanswered.length) bad.push(`no row answers ${unanswered.join(', ')} — an item of the brief would be missing from /status`);
  if (bad.length) fail('every row that answers the brief carries its priority, and every item is answered', bad);
  else ok(`every brief row carries its item's priority from the plan, and all ${BRIEF.size} items of both briefs are answered by a row`);
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

/* 6 — P2 is the later live-scanning release: nothing of it may look
   available. No path, not operational, not flagged, not complete. */
{
  const bad = [];
  const p2 = CAPABILITY_REGISTER.filter(c => c.priority === 'P2');
  for (const c of p2) {
    if (c.path) bad.push(`${c.name}: P2 with a path (${c.path}) — the live-scanning release must not be reachable as available`);
    if (OPERATIONAL.has(c.status) || c.status === 'flagged') bad.push(`${c.name}: P2 but "${c.status}"`);
    if (c.complete) bad.push(`${c.name}: P2 and complete`);
    if (!(typeof c.gate === 'string' && c.gate.trim().length > 20)) bad.push(`${c.name}: P2 without saying what it waits on (gate:)`);
  }
  if (bad.length) fail('every P2 row is out of reach, and says what it waits on', bad);
  else ok(`every P2 row is out of reach — ${p2.length} P2 rows, none with a path, none operational or flagged, each naming what it waits on`);
}

/* 7 — the scanner's personal records and one machine's operations pages
   are not for crawlers: robots.txt disallows every route under /app/scanner
   and /admin. */
{
  const robots = existsSync('robots.txt') ? read('robots.txt') : '';
  const dis = [...robots.matchAll(/^Disallow:\s*(\S+)/gmi)].map(m => m[1]);
  const covered = (p) => dis.some(d => p === d || p.startsWith(d.endsWith('/') ? d : `${d}/`) || (d.endsWith('/') && p === d.slice(0, -1)));
  const paths = ROUTES.map(r => r.path).filter(p => /^\/(app\/scanner|admin)(\/|$)/.test(p));
  const bad = paths.filter(p => !covered(p)).map(p => `${p} is not disallowed`);
  if (!paths.length) bad.push('no /app/scanner or /admin route found — the route table changed shape');
  if (bad.length) fail('robots.txt keeps the scanner and operations paths out of crawlers', bad);
  else ok(`robots.txt keeps the scanner and operations paths out of crawlers — ${paths.length} routes under /app/scanner and /admin, each disallowed`);
}

if (RELEASE && RELEASE_PHASE === 2) {
  const open = CAPABILITY_REGISTER.filter(c => c.priority === 'P0' && !c.complete && registerPhaseOf(c) === 2).map(c => `${c.name} (${c.brief.join(', ')}): ${c.status}, partial`);
  if (open.length) fail(`Phase 2 is not complete: ${open.length} P0 rows are partial`, open);
  else ok('every P0 row is complete, in an operational state, with its checks named');
}
/* Phase 3's release names the blocked P0 items apart from the partial ones,
   so a red result says whether the cause is work or a decision. */
if (RELEASE && RELEASE_PHASE === 3) {
  const p0 = CAPABILITY_REGISTER.filter(c => c.priority === 'P0' && !c.complete && registerPhaseOf(c) === 3);
  const blocked = p0.filter(c => ['data-gated', 'compliance'].includes(c.status));
  const open = p0.filter(c => !blocked.includes(c));
  if (blocked.length) fail(`Phase 3 is blocked: ${blocked.length} P0 items wait on a decision, not on work`, blocked.map(c => `${c.name} (${c.brief.join(', ')}): blocked — ${String(c.gate).split('. ')[0]}`));
  if (open.length) fail(`Phase 3 is not complete: ${open.length} P0 rows are partial`, open.map(c => `${c.name} (${c.brief.join(', ')}): ${c.status}, partial`));
  if (!blocked.length && !open.length) ok('every Phase 3 P0 row is complete, in an operational state, with its checks named');
}

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} register rules hold`);
process.exitCode = failures ? 1 : 0;
