#!/usr/bin/env node
/**
 * Trade-setup scanner — daily worker (personal lane)
 *
 *   node scanner/scan.mjs                  evaluate data/scan-setups.json on
 *                                          data/price-history.json; append matches
 *                                          to data/scan-alerts.json
 *   node scanner/scan.mjs --check          run only the self-test and exit
 *   node scanner/scan.mjs --dry            evaluate and print; write nothing
 *   node scanner/scan.mjs --setups f --history f --alerts f --instruments f --html f
 *
 *   exit 0  ran; whatever matched is recorded (or --check passed)
 *   exit 1  could not run: engine missing, self-test failed, no setups, no history
 *   exit 2  ran, but a setup was skipped or could not be tested anywhere in its
 *           universe — the record is written; the setups file needs a look
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ENGINE, NOT TWO
 *
 * The rule evaluator is not reimplemented here. This file slices index.html
 * between @scan-engine-start and @scan-engine-end and evaluates that region in
 * Node — the same code the scanner page runs when the reader presses "evaluate
 * now". Two copies of an indicator would drift, and then a match on the page
 * and a match in the record would disagree about whether a rule held.
 *
 * EVERY RUN SELF-TESTS
 *
 * Extraction by marker can fail silently: a refactor moves a function out of the
 * region and the worker still runs, just wrong. So every run first evaluates
 * the engine's own fixture — two instruments, one of which crosses its 50-bar
 * average on volume with RSI in range on the last bar — and refuses to continue
 * unless exactly that one alert comes back and a second pass adds none.
 *
 * WHAT THIS IS NOT
 *
 * It reads the reader's own price history — closes read off their own screen
 * under their own subscription — and nothing else; no feed is licensed to it.
 * It writes a file; it sends nothing. It records that conditions held; it
 * does not say the conditions mean anything, and no indicator here has been
 * validated on point-in-time data. And it sorts by nothing: alerts land in the
 * order of the setups and then of the instruments, because a list ordered by
 * strength is a pick list, and this product does not make those.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');

/* ---------------------------------------------------------------- engine -- */

export function extractEngine(html) {
  const a = html.indexOf('@scan-engine-start');
  const b = html.indexOf('@scan-engine-end');
  if (a < 0 || b < 0)
    throw new Error('engine markers not found in index.html — @scan-engine-start / @scan-engine-end');
  if (b < a) throw new Error('engine markers are the wrong way round in index.html');
  const from = html.indexOf('*/', a) + 2;
  const to = html.lastIndexOf('/*', b);
  const src = html.slice(from, to);
  if (!/function scanRun\b/.test(src)) throw new Error('the region between the scan-engine markers does not define scanRun');
  return src;
}

/* The engine region borrows nothing from the rest of the file. The prelude is
   here so the day it starts to, the failure names itself here rather than as
   an undefined reference halfway through a scan. */
const PRELUDE = `
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
`;

export async function loadEngine(htmlPath = join(ROOT, 'index.html')) {
  const html = await readFile(htmlPath, 'utf8');
  const src = extractEngine(html);
  const factory = new Function(`
    ${PRELUDE}
    ${src}
    return { SCAN_VERSION, SCAN_INDICATORS, SCAN_OPERATORS,
             scanSma, scanEma, scanRsi, scanMacd, scanIndicatorSeries,
             scanRule, scanSetup, scanUniverse, scanBars, scanKey,
             scanRun, scanFixture, scanSelfTest };
  `);
  return factory();
}

/* ------------------------------------------------------------ validation -- */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/* A setups file is `{ setups: [...] }` (the builder's output) or a bare list.
   Every setup either passes whole or is left out whole, with the reason: a
   half-valid setup evaluated on the rules that parsed would match on fewer
   conditions than the reader wrote, which is the one thing a scanner must
   never do quietly. */
export function validateSetups(doc, E) {
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.setups) ? doc.setups : null;
  const problems = [];
  if (!list) return { setups: [], problems: ['the setups file is neither a list nor an object with a "setups" list'] };
  const ids = new Map();
  list.forEach((s, i) => { const id = s?.id; if (typeof id === 'string' && id) ids.set(id, (ids.get(id) || 0) + 1); });
  const ok = [];
  list.forEach((s, i) => {
    const who = s?.id || s?.name || `setup #${i + 1}`;
    const bad = (why) => problems.push(`${who}: ${why}`);
    if (!s || typeof s !== 'object') { bad('is not an object'); return; }
    if (typeof s.id !== 'string' || !s.id) { bad('has no id — ids are part of every alert key'); return; }
    if (/[|\s]/.test(s.id)) { bad('id contains "|" or whitespace'); return; }
    if (ids.get(s.id) > 1) { bad('id is used by more than one setup'); return; }
    if ((s.timeframe || 'daily') !== 'daily') { bad(`timeframe "${s.timeframe}" is not built — daily only`); return; }
    if (s.logic != null && s.logic !== 'AND' && s.logic !== 'OR') { bad(`logic "${s.logic}" is not AND or OR`); return; }
    if (!Array.isArray(s.rules) || !s.rules.length) { bad('has no rules'); return; }
    if (s.expires != null && !(typeof s.expires === 'string' && ISO_DAY.test(s.expires))) { bad(`expires "${s.expires}" is not YYYY-MM-DD`); return; }
    if (s.cooldownBars != null && !(Number.isFinite(Number(s.cooldownBars)) && Number(s.cooldownBars) >= 0)) { bad(`cooldownBars "${s.cooldownBars}" is not a non-negative number`); return; }
    const u = s.universe || { kind: 'all' };
    if (!['all', 'market', 'symbols'].includes(u.kind)) { bad(`universe kind "${u.kind}" is not all, market or symbols`); return; }
    if (u.kind === 'symbols' && (!Array.isArray(u.symbols) || !u.symbols.length)) { bad('universe is "symbols" but names none'); return; }
    if (u.kind === 'market' && !u.market) { bad('universe is "market" but names none'); return; }
    const sideOk = (side, what) => {
      if (!side || typeof side !== 'object') return `${what} side is missing`;
      if (!E.SCAN_INDICATORS[side.indicator]) return `${what} indicator "${side.indicator}" is not one of ${Object.keys(E.SCAN_INDICATORS).join(', ')}`;
      if (side.n != null && !(Number.isFinite(Number(side.n)) && Number(side.n) >= 1)) return `${what} period "${side.n}" is not a positive number`;
      if (side.multiplier != null && !(Number.isFinite(Number(side.multiplier)) && Number(side.multiplier) > 0)) return `${what} multiplier "${side.multiplier}" is not a positive number`;
      return null;
    };
    for (let r = 0; r < s.rules.length; r++) {
      const rule = s.rules[r];
      const where = `rule ${r + 1}`;
      if (!rule || typeof rule !== 'object') { bad(`${where} is not an object`); return; }
      if (!E.SCAN_OPERATORS[rule.op]) { bad(`${where}: operator "${rule.op}" is not one of ${Object.keys(E.SCAN_OPERATORS).join(', ')}`); return; }
      const l = sideOk(rule.left, `${where} left`); if (l) { bad(l); return; }
      if (rule.op === 'between') {
        if (!Array.isArray(rule.range) || rule.range.length !== 2 || !rule.range.every(v => Number.isFinite(Number(v)))) { bad(`${where}: "between" needs a range of two numbers`); return; }
      } else if (rule.right && rule.right.indicator != null) {
        const rr = sideOk(rule.right, `${where} right`); if (rr) { bad(rr); return; }
      } else if (!Number.isFinite(Number(rule.right?.value))) {
        bad(`${where}: right side needs an indicator or a numeric value`); return;
      }
    }
    ok.push(s);
  });
  return { setups: ok, problems };
}

/* ------------------------------------------------------------------ run -- */

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/* One evaluation of a setups file on a history file, merged into an alerts
   file. Pure with respect to the process: no exit, no console; the CLI below
   turns the result into words and a code, and the test reads it directly. */
export async function runOnce({ E, setupsPath, historyPath, alertsPath, instrumentsPath, dry = false, now = new Date().toISOString() }) {
  if (!existsSync(setupsPath)) throw Object.assign(new Error(`no setups file at ${setupsPath}`), { code: 'NO_SETUPS' });
  if (!existsSync(historyPath)) throw Object.assign(new Error(`no price history at ${historyPath}`), { code: 'NO_HISTORY' });
  const doc = await readJson(setupsPath);
  const { setups, problems } = validateSetups(doc, E);
  const history = await readJson(historyPath);
  let instruments = [];
  if (instrumentsPath && existsSync(instrumentsPath)) {
    try { const reg = await readJson(instrumentsPath); instruments = Array.isArray(reg) ? reg : (reg?.instruments || []); } catch { instruments = []; }
  }
  let existingDoc = null;
  if (existsSync(alertsPath)) {
    try { existingDoc = await readJson(alertsPath); } catch { throw Object.assign(new Error(`${alertsPath} is not valid JSON — nothing was written over it`), { code: 'BAD_ALERTS' }); }
  }
  const existing = Array.isArray(existingDoc) ? existingDoc : Array.isArray(existingDoc?.alerts) ? existingDoc.alerts : [];

  const r = E.scanRun(setups, history, { instruments, existing, now });

  /* A setup none of whose instruments could be tested is a configuration
     problem, not a quiet day: the exit code says so. */
  const setupLevel = r.skipped.filter(s => !s.symbol);
  const untestedEverywhere = setups.filter(s => s.enabled !== false && (s.timeframe || 'daily') === 'daily')
    .filter(s => {
      const syms = E.scanUniverse(s, history, instruments);
      if (!syms.length) return false;                     /* already a setup-level skip */
      return syms.every(sym => { const bars = E.scanBars(history, sym); return bars.closes.length < 2 || E.scanSetup(s, sym, bars).untested; });
    }).map(s => s.id);

  const lastRun = { at: now, asOf: r.asOf, engine: r.engine, setups: r.setups, evaluated: r.evaluated,
                    matched: r.matched, recorded: r.alerts.length, untested: r.untested, skipped: r.skipped.length,
                    problems, untestedEverywhere };
  const out = { engine: r.engine, updatedAt: now, lastRun, alerts: [...existing, ...r.alerts] };
  let written = false;
  if (!dry) {
    await mkdir(dirname(alertsPath), { recursive: true });
    await writeFile(alertsPath, JSON.stringify(out, null, 2) + '\n');
    written = true;
  }
  const warn = problems.length > 0 || setupLevel.length > 0 || untestedEverywhere.length > 0;
  return { result: r, problems, setupLevel, untestedEverywhere, out, written, warn, existingCount: existing.length };
}

/* ------------------------------------------------------------------ CLI -- */

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(`--${f}`);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

  let E;
  try { E = await loadEngine(resolve(ROOT, flag('html', 'index.html'))); }
  catch (err) {
    console.error('Could not load the scan engine out of index.html.');
    console.error(`  ${err.message}`);
    console.error('\nThis file does not carry its own copy of the engine, by design — two copies of an');
    console.error('indicator drift and then disagree about whether a rule held. Restore the');
    console.error('@scan-engine-start / @scan-engine-end markers around the engine region and re-run.');
    process.exit(1);
  }
  const st = E.scanSelfTest();
  if (!st.ok) {
    console.error('SELF-TEST FAILED — the engine extracted from index.html does not reproduce its fixture.');
    console.error(`  expected one alert for MATCH on the fixture's last bar, and none on a second pass`);
    console.error(`  got      ${st.alerts} alert(s) for ${st.symbol ?? '—'} on ${st.bar ?? '—'}; second pass ${st.again}`);
    console.error('\nNothing was written. Either the engine changed, or the markers no longer enclose all of it.');
    process.exit(1);
  }
  console.log(`self-test ok — fixture returns one alert (${st.symbol} ${st.bar}); a second pass returns none`);
  console.log(`engine     ${E.SCAN_VERSION} (extracted from index.html)`);
  if (has('check')) process.exit(0);

  const setupsPath = resolve(ROOT, flag('setups', 'data/scan-setups.json'));
  const historyPath = resolve(ROOT, flag('history', 'data/price-history.json'));
  const alertsPath = resolve(ROOT, flag('alerts', 'data/scan-alerts.json'));
  const instrumentsPath = resolve(ROOT, flag('instruments', 'data/instruments.json'));
  const dry = has('dry');

  let run;
  try { run = await runOnce({ E, setupsPath, historyPath, alertsPath, instrumentsPath, dry }); }
  catch (err) {
    console.error(`\n${err.message}`);
    if (err.code === 'NO_SETUPS') {
      console.error('Copy scanner/setups.example.json to data/scan-setups.json and edit it, or build one');
      console.error('on /my/scanner and copy the JSON. That path is git-ignored, so your setups stay local.');
    } else if (err.code === 'NO_HISTORY') {
      console.error('Run the daily capture (ingest/daily.mjs) or import an export (ingest/history-import.mjs) first.');
    }
    process.exit(1);
  }

  const { result: r, problems, setupLevel, untestedEverywhere, written } = run;
  console.log('');
  console.log(`setups     ${r.setups} evaluated${problems.length ? `, ${problems.length} left out` : ''}`);
  console.log(`as of      ${r.asOf ?? '—'} (last completed bar in the history)`);
  console.log(`evaluated  ${r.evaluated} setup × instrument pair${r.evaluated === 1 ? '' : 's'} · ${r.matched} matched · ${r.untested} untested`);
  console.log(`${r.alerts.length} new alert${r.alerts.length === 1 ? '' : 's'} recorded${dry ? ' (dry run — nothing written)' : written ? ` → ${alertsPath}` : ''}`);
  if (r.alerts.length) {
    console.log('');
    r.alerts.forEach(a => {
      console.log(`  ${a.bar}  ${a.setupName}  ${a.symbol}  close ${a.close}`);
      a.rules.forEach(x => console.log(`      ${x.met ? '✓' : '·'} ${x.text}`));
    });
  }
  if (problems.length) {
    console.log('\nLEFT OUT — a setup either passes whole or is skipped whole:');
    problems.forEach(p => console.log(`  · ${p}`));
  }
  if (setupLevel.length) {
    console.log('\nSKIPPED:');
    setupLevel.forEach(s => console.log(`  · ${s.setup}: ${s.why}`));
  }
  if (untestedEverywhere.length) {
    console.log('\nUNTESTED EVERYWHERE — no instrument in the universe holds enough bars for these rules:');
    untestedEverywhere.forEach(id => console.log(`  · ${id}`));
  }
  const routine = r.skipped.filter(s => s.symbol);
  if (routine.length) {
    const by = new Map();
    routine.forEach(s => { const k = s.why.replace(/ of \d{4}-\d{2}-\d{2}$/, '').replace(/\d{4}-\d{2}-\d{2}/, 'a date'); by.set(k, (by.get(k) || 0) + 1); });
    console.log('\nper instrument:');
    [...by.entries()].forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  }
  console.log('\nA record that conditions held, in setup-then-instrument order. Not a signal, not ranked, not sent anywhere.');
  process.exit(run.warn ? 2 : 0);
}

/* Run only as the entry point; scanner-test.mjs imports the functions above. */
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && (process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self)) await main();
