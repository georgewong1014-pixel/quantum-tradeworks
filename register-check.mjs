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
 *
 * AND THE RULES ARE TESTED. A rule that has only ever passed cannot be told
 * from one that has stopped looking, so an eighth runs the priority and P2
 * rules on synthetic registers built to break them — a P2 row with a path,
 * a row whose priority disagrees with the plan, an unanswered item — and
 * fails unless each one fails for its own reason. A ninth holds the
 * platform plan to the register on historical testing: the simulation is
 * built and flagged, a performance backtest is blocked, in separate rows.
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
/* A function, so the self-test (rule 8) reads its synthetic table through
   exactly the parser the plan's §1 goes through. */
function readBrief3(planText) {
  const status = planText.slice(planText.indexOf('## 1.'), planText.indexOf('## 2.'));
  return new Map([...status.matchAll(/^\|\s*(NAV|SC-\d{3})\b[^|]*\|\s*(P[012])\s*\|/gm)].map(m => [m[1] === 'NAV' ? 'SC-NAV' : m[1], m[2]]));
}
const BRIEF3 = readBrief3(PLAN3);
BRIEF3.forEach((p, k) => BRIEF.set(k, p));

/* The views whose :id names a company, read from the router itself
   (35-ui.js COMPANY_ROUTE_VIEWS), so this check and applyRoute cannot
   disagree about which paths name a company. */
const companyViewsDecl = UI.match(/const COMPANY_ROUTE_VIEWS = new Set\(\[([^\]]*)\]\)/);
if (!companyViewsDecl) throw new Error('const COMPANY_ROUTE_VIEWS = new Set([...]) not found in src/js/35-ui.js');
const COMPANY_ROUTE_VIEWS = new Set([...companyViewsDecl[1].matchAll(/'([^']+)'/g)].map(m => m[1]));

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
    /* Only a company page's :id names a company — the router's own list;
       a scanner setup or an alert is :setup or :alert, and is not looked up
       here. */
    if (COMPANY_ROUTE_VIEWS.has(rt.view) && rt.params?.id && !COMPANY_IDS.has(rt.params.id)) bad.push(`${c.name}: ${c.path} names ${rt.params.id}, which is neither a filer in data/us.json nor an illustrative company`);
    const tab = new URLSearchParams(q || '').get('tab');
    if (tab && rt.view === 'research' && !RESEARCH_TABS.some(t => t.id === tab)) bad.push(`${c.name}: ${c.path} names tab "${tab}", which the company page does not have`);
    resolved++;
  }
  if (bad.length) fail('every operational row opens a real route', bad);
  else ok(`every operational row opens a real route — ${resolved} paths resolve to a view that exists, and the company and tab each names are real`);
}

/* 2 — priorities agree with the brief, and every item of it is answered.
   The rule is a function of a register and a brief, so the self-test
   (rule 8) runs this same code on registers built to break it. */
function rulePriorities(register, brief) {
  const bad = [];
  const answered = new Set();
  for (const c of register) {
    if (c.priority && !c.brief?.length) bad.push(`${c.name}: priority ${c.priority} with no brief item — priority comes from the brief`);
    if (!c.brief?.length) continue;
    const sc = c.brief.some(b => /^SC-/.test(b));
    if (sc && c.brief.some(b => !/^SC-/.test(b))) bad.push(`${c.name}: cites items of both briefs (${c.brief.join(', ')}) — a row answers one brief`);
    if (!(sc ? ['P0', 'P1', 'P2'] : ['P0', 'P1']).includes(c.priority)) { bad.push(`${c.name}: answers ${c.brief.join(', ')} but carries no ${sc ? 'P0/P1/P2' : 'P0/P1'} priority`); continue; }
    for (const b of c.brief) {
      if (!brief.has(b)) { bad.push(`${c.name}: cites ${b}, which is not an item of the brief`); continue; }
      answered.add(b);
      if (brief.get(b) !== c.priority) bad.push(`${c.name}: ${c.priority}, but the plan gives ${b} ${brief.get(b)}`);
    }
  }
  const unanswered = [...brief.keys()].filter(b => !answered.has(b));
  if (unanswered.length) bad.push(`no row answers ${unanswered.join(', ')} — an item of the brief would be missing from /status`);
  return bad;
}
{
  const bad = [];
  if (BRIEF2_SIZE < 10) bad.push(`only ${BRIEF2_SIZE} items read from docs/phase2-plan.md §1 — the status table's shape has changed`);
  if (PLAN3 && BRIEF3.size < 20) bad.push(`only ${BRIEF3.size} items read from docs/phase3-plan.md §1 — the status table's shape has changed`);
  bad.push(...rulePriorities(CAPABILITY_REGISTER, BRIEF));
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
function ruleP2(register) {
  const bad = [];
  for (const c of register.filter(r => r.priority === 'P2')) {
    if (c.path) bad.push(`${c.name}: P2 with a path (${c.path}) — the live-scanning release must not be reachable as available`);
    if (OPERATIONAL.has(c.status) || c.status === 'flagged') bad.push(`${c.name}: P2 but "${c.status}"`);
    if (c.complete) bad.push(`${c.name}: P2 and complete`);
    if (!(typeof c.gate === 'string' && c.gate.trim().length > 20)) bad.push(`${c.name}: P2 without saying what it waits on (gate:)`);
  }
  return bad;
}
{
  const p2 = CAPABILITY_REGISTER.filter(c => c.priority === 'P2');
  const bad = ruleP2(CAPABILITY_REGISTER);
  if (bad.length) fail('every P2 row is out of reach, and says what it waits on', bad);
  else ok(`every P2 row is out of reach — ${p2.length} P2 rows, none with a path, none operational or flagged, each naming what it waits on`);
}

/* 7 — the scanner's pages and one machine's operations pages are kept out
   of search. The operations pages (/admin) are disallowed in robots.txt.
   The scanner's (every route under /app/scanner) and My Dashboard (/app)
   are fetchable — robots.txt allows them, so a fetcher that follows it can
   read the setup builder — and vercel.json serves each with X-Robots-Tag:
   noindex (plan item 1.1, D2 of 5 Oct 2026). Both read as a crawler reads
   them: robots.txt by RFC 9309 (robotsAllows, build.mjs), the header by
   the rules of the vercel.json that deploys; a parameter is a sample
   segment. */
{
  const { robotsAllows, noindexByHeader } = await import('./build.mjs');
  const robots = existsSync('robots.txt') ? read('robots.txt') : '';
  const noindex = existsSync('vercel.json') ? noindexByHeader(read('vercel.json')) : () => false;
  const sample = (p) => p.replace(/:[A-Za-z]+/g, 'register-check');
  const paths = ROUTES.map(r => r.path).filter(p => /^\/(app\/scanner|admin)(\/|$)/.test(p) || p === '/app');
  const bad = [];
  for (const p of paths.map(sample)) {
    const r = robotsAllows(robots, p);
    if (p.startsWith('/admin')) { if (r.allowed) bad.push(`${p} is not disallowed in robots.txt`); continue; }
    if (!r.allowed) bad.push(`${p} is disallowed in robots.txt (${r.rule}), so a fetcher that follows it cannot read it, and a crawler never reads its noindex`);
    if (!noindex(p)) bad.push(`${p} is not served with X-Robots-Tag: noindex by vercel.json`);
  }
  if (!paths.some(p => p.startsWith('/admin')) || !paths.some(p => p.startsWith('/app/scanner'))) bad.push('no /app/scanner or /admin route found — the route table changed shape');
  const scanner = paths.filter(p => !p.startsWith('/admin')).length;
  if (bad.length) fail('the scanner and operations paths are kept out of search indexes', bad);
  else ok(`the scanner and operations paths are kept out of search indexes — ${paths.length - scanner} routes under /admin disallowed in robots.txt; ${scanner} routes (/app and every one under /app/scanner) allowed in robots.txt and served X-Robots-Tag: noindex`);
}

/* 8 — THE RULES FAIL WHEN THEY SHOULD (docs/phase3-plan.md SC-319 item 2).
   Rules 2 and 6 had only ever run against the real register, which passes
   them — and a rule that had stopped seeing anything would pass as well.
   So each is fed a synthetic brief, read from a synthetic §1 table through
   the plan's own parser (with a row after §2 that must not be read), and a
   synthetic register: the clean register must pass, and each defect, one
   at a time, must fail with the sentence that names it — not merely fail. */
{
  const plan = ['# QA plan', '## 1. Status at a glance', '| Item | Priority | Before | Now |', '|---|---|---|---|',
    '| NAV Scanner routes | P0 | partial | built |', '| SC-312 Scanner dashboard | P0 | partial | built |',
    '| SC-314 Historical testing | P1 | missing | built, flagged |', '| SC-317 Intraday scanner infrastructure | P2 | blocked | blocked |',
    '## 2. The contract', '| SC-399 A row outside the status table | P0 | — | — |'].join('\n');
  const brief = readBrief3(plan);
  const clean = [
    { name: 'QA routes', status: 'beta', path: '/app/scanner', brief: ['SC-NAV'], priority: 'P0' },
    { name: 'QA dashboard', status: 'beta', path: '/app/scanner', brief: ['SC-312'], priority: 'P0' },
    { name: 'QA simulation', status: 'flagged', path: '/app/scanner/backtest', brief: ['SC-314'], priority: 'P1', flag: 'a simulation of dates on your own closes, with no performance figure' },
    { name: 'QA intraday', status: 'queued', path: null, brief: ['SC-317'], priority: 'P2', gate: 'intraday data rights, which this product does not hold' },
  ];
  const check = (reg) => [...rulePriorities(reg, brief), ...ruleP2(reg)];
  const cases = [
    ['a P2 row with a path', clean.map(c => (c.priority === 'P2' ? { ...c, path: '/app/scanner/intraday' } : c)), /^QA intraday: P2 with a path \(\/app\/scanner\/intraday\)/],
    ['a P2 row shown as available', clean.map(c => (c.priority === 'P2' ? { ...c, status: 'beta' } : c)), /^QA intraday: P2 but "beta"/],
    ['an SC row whose priority disagrees with the plan', clean.map(c => (c.brief[0] === 'SC-312' ? { ...c, priority: 'P1' } : c)), /^QA dashboard: P1, but the plan gives SC-312 P0$/],
    ['an unanswered SC item', clean.filter(c => c.brief[0] !== 'SC-314'), /^no row answers SC-314 —/],
  ];
  const bad = [];
  const read3 = [...brief].map(([k, v]) => `${k} ${v}`).sort().join(', ');
  if (read3 !== 'SC-312 P0, SC-314 P1, SC-317 P2, SC-NAV P0') bad.push(`the synthetic §1 table read as: ${read3}`);
  const cleanBad = check(clean);
  if (cleanBad.length) bad.push(`the clean register fails: ${cleanBad.join('; ')}`);
  for (const [what, reg, want] of cases) {
    const got = check(reg);
    if (!got.some(g => want.test(g))) bad.push(`${what} passed${got.length ? ` — it failed only for: ${got.join('; ')}` : ''}`);
  }
  if (bad.length) fail('register-check self-test: each rule fails on the register built to break it', bad);
  else ok(`register-check self-test: each rule fails on the register built to break it — a synthetic §1 table read through the plan's parser, a clean register that passes, and ${cases.length} defects that each fail with their own sentence: ${cases.map(c => c[0]).join('; ')}`);
}

/* 9 — the platform plan and the register agree about historical testing
   (docs/phase3-plan.md SC-314 item 3). The plan's scanner table once held
   one row, "Backtesting | blocked", while the register showed a flagged
   simulation page: the simulation of match dates over the reader's own
   history is built, and only a strategy backtest with performance is
   blocked. So the two are separate rows, and the blocked one says on what. */
{
  const pp = existsSync('docs/platform-plan.md') ? read('docs/platform-plan.md').split(/\r?\n/) : [];
  const rowOf = (re) => pp.find(l => re.test(l)) || null;
  const cell = (row, i) => (row ? row.split('|')[i] || '' : '');
  const sim = rowOf(/^\|\s*Historical match simulation\b/), perf = rowOf(/^\|\s*Strategy backtest\b/), single = rowOf(/^\|\s*Backtesting\s*\|/);
  const reg = CAPABILITY_REGISTER.find(c => (c.brief || []).includes('SC-314'));
  const bad = [];
  if (single) bad.push(`docs/platform-plan.md still has one row for both: ${single.trim()}`);
  if (!sim) bad.push('no "Historical match simulation" row in docs/platform-plan.md');
  else {
    if (!/\bbuilt\b/.test(cell(sim, 2)) || /\bblocked\b/.test(cell(sim, 2)) || !/SC-314/.test(sim)) bad.push(`the simulation row does not say it is built (SC-314): ${sim.trim()}`);
    if (reg?.status === 'flagged' && !/flagged/.test(cell(sim, 2))) bad.push('the register shows the simulation flagged; the plan row does not say so');
  }
  if (!perf || !/^\s*blocked\b/.test(cell(perf, 2)) || !/point-in-time/.test(perf) || !/cost/.test(perf)) bad.push(`no "Strategy backtest" row saying it is blocked, and on point-in-time history and a cost model: ${perf ? perf.trim() : 'missing'}`);
  if (bad.length) fail('the platform plan splits historical testing as the register does', bad);
  else ok(`the platform plan splits historical testing as the register does — the simulation of match dates built${reg?.status === 'flagged' ? ' and flagged' : ''} (SC-314), a strategy backtest with performance blocked on what it needs`);
}

/* 10 — WHAT PROVES A LIVE BADGE (D15, the owner's decision of 6 Oct 2026;
   plan item 2.6). An outcome step in a production journey — an action and
   the result it must produce — proves a Live badge; a landing does not (the
   calls-to-action journey presses every tool's tab and does nothing
   there). So every 'live' row of PRODUCTS and TOOLS (35-ui.js) carries
   proof: { journey, step } naming a journey journeys.mjs runs and one of
   that journey's declared outcome steps (OUTCOME_STEPS) — or proof: null,
   "not yet proven by a journey", which /status lists from the same field
   (proofSection, 91-health.js; served-check holds the served list). A row
   naming a journey without such a step fails, and so does a live row that
   says nothing: there is no exemption list anywhere else. The rule is a
   function, so its self-test runs it on rows built to break it, against
   the journeys' real declarations. */
function ruleProof(rows, outcomes, names) {
  const bad = [];
  for (const r of rows) {
    const who = `${r.kind === 'product' ? 'PRODUCTS' : 'TOOLS'} "${r.name}"`;
    if (r.status !== 'live' && r.proof == null) continue;
    if (!Object.hasOwn(r, 'proof')) { bad.push(`${who}: Live, and names no journey — name its journey and outcome step (proof: { journey, step }), or mark it not yet proven (proof: null), which /status lists`); continue; }
    if (r.proof === null) continue;
    const { journey, step } = r.proof || {};
    if (!journey || !step) { bad.push(`${who}: proof names ${journey ? `the ${journey} journey but no step` : 'no journey'} — proof is { journey, step } or null`); continue; }
    if (!Object.hasOwn(names, journey)) { bad.push(`${who}: names the journey "${journey}", which journeys.mjs does not run (${Object.keys(names).join(', ')})`); continue; }
    const out = outcomes[journey] || [];
    if (!out.length) { bad.push(`${who}: names the ${journey} journey, which has no outcome step — a landing is not proof (D15); its step "${step}" proves the link, not the tool`); continue; }
    if (!out.includes(step)) bad.push(`${who}: names "${step}", which is not an outcome step of the ${journey} journey (its outcome steps: ${out.map(s => `"${s}"`).join(', ')})`);
  }
  return bad;
}
{
  const J = await import('./journeys.mjs');
  const OUT = J.OUTCOME_STEPS, NAMES = J.JOURNEY_NAMES;
  const { PRODUCTS, TOOLS } = vm.runInContext(['const BASE = \'\';', sliceArray(UI, 'PRODUCTS'), sliceArray(UI, 'TOOLS'), '({ PRODUCTS, TOOLS })'].join('\n'), vm.createContext({}));
  const rows = [...PRODUCTS.map(p => ({ ...p, kind: 'product' })), ...TOOLS.map(t => ({ ...t, name: t.label, kind: 'tool' }))];
  const live = rows.filter(r => r.status === 'live');
  const bad = [];
  if (!OUT || !NAMES) bad.push('journeys.mjs declares no outcome steps (OUTCOME_STEPS) or journey names (JOURNEY_NAMES), so no Live badge can be held to one');
  else {
    bad.push(...ruleProof(rows, OUT, NAMES));
    if (live.length < 10) bad.push(`only ${live.length} live rows read from PRODUCTS and TOOLS — the registry changed shape`);
    /* The /status listing reads the same field, and the same rows. */
    const health = read('src/js/91-health.js');
    if (!/const rows = liveBadgeRows\(\);/.test(health) || !/unproven = rows\.filter\(r => !r\.proof\)/.test(health) || !/not yet proven by a journey/.test(health)) bad.push('/status does not list the unproven rows from the registry\'s own proof field (proofSection, 91-health.js)');
    if (!/\.\.\.PRODUCTS\.filter\(p => p\.status === 'live'\)/.test(UI) || !/\.\.\.TOOLS\.filter\(t => t\.status === 'live'\)/.test(UI)) bad.push('liveBadgeRows (35-ui.js) does not read every live row of PRODUCTS and TOOLS');
  }
  if (bad.length) fail('every Live badge names the journey and outcome step that prove it, or is listed as not yet proven (D15)', bad);
  else {
    const proven = live.filter(r => r.proof), unproven = live.filter(r => r.proof === null);
    ok(`every Live badge names the journey and outcome step that prove it, or is listed as not yet proven (D15) — ${live.length} live rows: ${proven.length} proven (${proven.map(r => `${r.name} by ${r.proof.journey}: "${r.proof.step}"`).join('; ')}); ${unproven.length} not yet proven (${unproven.map(r => r.name).join(', ')})`);
  }

  /* Its self-test: a clean set of rows passes, and each defect fails with
     its own sentence — a deliberate 'live' row naming a journey without an
     outcome step among them, against the real declarations. */
  const self = [];
  if (OUT && NAMES) {
    const anyStep = Object.entries(OUT).find(([, s]) => s.length);
    const clean = [
      { kind: 'tool', name: 'QA proven', status: 'live', proof: { journey: anyStep[0], step: anyStep[1][0] } },
      { kind: 'tool', name: 'QA unproven', status: 'live', proof: null },
      { kind: 'tool', name: 'QA beta', status: 'beta' },
    ];
    const cases = [
      ['a live row naming the calls-to-action journey, whose steps are landings', { kind: 'tool', name: 'QA landed', status: 'live', proof: { journey: 'ctas', step: 'Equities tab “Cash Wheel”' } }, /^TOOLS "QA landed": names the ctas journey, which has no outcome step — a landing is not proof/],
      ['a live row naming a step that is not one of its journey\'s outcome steps', { kind: 'tool', name: 'QA opened', status: 'live', proof: { journey: 'property', step: 'Open the property calculator' } }, /^TOOLS "QA opened": names "Open the property calculator", which is not an outcome step of the property journey/],
      ['a live row naming a journey that is not run', { kind: 'tool', name: 'QA ghost', status: 'live', proof: { journey: 'cashwheel', step: 'Model a wheel' } }, /^TOOLS "QA ghost": names the journey "cashwheel", which journeys\.mjs does not run/],
      ['a live row that says nothing', { kind: 'product', name: 'QA silent', status: 'live' }, /^PRODUCTS "QA silent": Live, and names no journey/],
    ];
    const cleanBad = ruleProof(clean, OUT, NAMES);
    if (cleanBad.length) self.push(`the clean rows fail: ${cleanBad.join('; ')}`);
    if (!Object.hasOwn(OUT, 'ctas') || OUT.ctas.length) self.push(`the calls-to-action journey declares ${OUT.ctas ? OUT.ctas.length : 'no list of'} outcome steps — it has to declare none`);
    for (const [what, row, want] of cases) {
      const got = ruleProof([...clean, row], OUT, NAMES);
      if (!got.some(g => want.test(g))) self.push(`${what} passed${got.length ? ` — it failed only for: ${got.join('; ')}` : ''}`);
    }
    if (self.length) fail('register-check self-test: the Live-badge rule fails on the rows built to break it', self);
    else ok(`register-check self-test: the Live-badge rule fails on the rows built to break it — clean rows pass, and ${cases.length} defects each fail with their own sentence: ${cases.map(c => c[0]).join('; ')}`);
  }
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

/* ---- bugfix: shell ---- */
/* A personal page is disallowed at every address that opens it. robots.txt
   keeps /my/ out of the index and says an alias of a /my/ page goes with it
   — /app/watchlists did — but /app/workspace, the alias of /my/workspace
   (everything saved in this browser), was left crawlable. A view whose own
   address is under /my/ must be disallowed under every route to it. */
{
  const robots = existsSync('robots.txt') ? read('robots.txt') : '';
  const dis = [...robots.matchAll(/^Disallow:\s*(\S+)/gmi)].map(m => m[1]);
  const covered = (p) => dis.some(d => p === d || p.startsWith(d.endsWith('/') ? d : `${d}/`) || (d.endsWith('/') && p === d.slice(0, -1)));
  const home = (view) => ROUTES.find(r => r.view === view && !r.alias && !r.path.includes(':'))?.path || '';
  const personal = [...new Set(ROUTES.map(r => r.view))].filter(v => home(v).startsWith('/my/'));
  const paths = ROUTES.filter(r => personal.includes(r.view)).map(r => r.path);
  const bad = paths.filter(p => !covered(p)).map(p => `${p} opens a personal page and is not disallowed`);
  if (personal.length < 5) bad.push(`only ${personal.length} views found under /my/ — the route table changed shape`);
  if (bad.length) fail('robots.txt keeps every address of a personal page out of crawlers', bad);
  else ok(`robots.txt keeps every address of a personal page out of crawlers — ${paths.length} routes to ${personal.length} views whose own address is under /my/`);
}
/* ---- end bugfix: shell ---- */

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} register rules hold`);
process.exitCode = failures ? 1 : 0;
