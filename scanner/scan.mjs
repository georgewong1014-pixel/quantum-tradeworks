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
 *                                          a path given here is taken from the current
 *                                          directory; the defaults are in the repository
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

import { readFile, writeFile, mkdir, rename, copyFile, rm } from 'node:fs/promises';
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
    return { SCAN_VERSION, SCAN_INDICATORS, SCAN_OPERATORS, scanValidate, scanSideLabel, scanPeriodOf,
             scanSma, scanEma, scanRsi, scanMacd, scanIndicatorSeries,
             scanRule, scanSetup, scanUniverse, scanUniverseGaps, scanBars, scanKey, scanBarRange,
             scanRun, scanFixture, scanSelfTest };
  `);
  return factory();
}

/* ------------------------------------------------------------ validation -- */


/* A setups file is `{ setups: [...] }` (the builder's output) or a bare list.
   Every setup either passes whole or is left out whole, with the reason: a
   half-valid setup evaluated on the rules that parsed would match on fewer
   conditions than the reader wrote, which is the one thing a scanner must
   never do quietly. */
export function validateSetups(doc, E) {
  /* One validator, in the engine region, so the page refuses exactly what
     the worker refuses. */
  return E.scanValidate(doc);
}

/* ------------------------------------------------------------------ run -- */

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

/* The alert record is the only copy (it is git-ignored), and writeFile
   empties a file before it writes a byte: a run killed mid-write left it
   empty, and every later run then refused to touch it. So the record is
   written beside itself and renamed over the old one — a rename within one
   volume is all or nothing — and the previous record is kept as .bak. */
export async function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  try {
    if (existsSync(path)) await copyFile(path, `${path}.bak`);
    await rename(tmp, path);
  } catch (e) { await rm(tmp, { force: true }); throw e; }
}

/* One evaluation of a setups file on a history file, merged into an alerts
   file. Pure with respect to the process: no exit, no console; the CLI below
   turns the result into words and a code, and the test reads it directly. */
export async function runOnce({ E, setupsPath, historyPath, alertsPath, instrumentsPath, dry = false, now = new Date().toISOString() }) {
  if (!existsSync(setupsPath)) throw Object.assign(new Error(`no setups file at ${setupsPath}`), { code: 'NO_SETUPS' });
  if (!existsSync(historyPath)) throw Object.assign(new Error(`no price history at ${historyPath}`), { code: 'NO_HISTORY' });
  const doc = await readJson(setupsPath);
  /* An empty list is "no setups", as the header says — not a clean run of
     nothing that ingest/daily.mjs then reports as "0 new alerts". */
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.setups) ? doc.setups : null;
  if (list && !list.length) throw Object.assign(new Error(`the setups file at ${setupsPath} holds no setups`), { code: 'NO_SETUPS' });
  const { setups, problems } = validateSetups(doc, E);
  const history = await readJson(historyPath);
  let instruments = [];
  if (instrumentsPath && existsSync(instrumentsPath)) {
    try { const reg = await readJson(instrumentsPath); instruments = Array.isArray(reg) ? reg : (reg?.instruments || []); } catch { instruments = []; }
  }
  let existingDoc = null;
  if (existsSync(alertsPath)) {
    try { existingDoc = await readJson(alertsPath); } catch {
      const bak = `${alertsPath}.bak`;
      throw Object.assign(new Error(`${alertsPath} is not valid JSON — nothing was written over it${existsSync(bak) ? `. The record as it stood before the last write is in ${bak}` : ''}`), { code: 'BAD_ALERTS' });
    }
  }
  const existing = Array.isArray(existingDoc) ? existingDoc : Array.isArray(existingDoc?.alerts) ? existingDoc.alerts : [];

  const r = E.scanRun(setups, history, { instruments, existing, now });

  /* A setup none of whose instruments could be tested is a configuration
     problem, not a quiet day: the exit code says so. The engine decides it
     from the pairs it evaluated. This file used to re-evaluate every setup
     on its own, expired ones included, and so warned — and exited 2 every
     day — about a setup the run had never evaluated. */
  const setupLevel = r.skipped.filter(s => !s.symbol);
  const untestedEverywhere = r.untestedEverywhere || [];

  const lastRun = { at: now, asOf: r.asOf, asOfFrom: r.asOfFrom, engine: r.engine, setups: r.setups, evaluated: r.evaluated,
                    matched: r.matched, recorded: r.alerts.length, untested: r.untested, skipped: r.skipped.length,
                    problems, untestedEverywhere, stale: r.stale || [] };
  const out = { engine: r.engine, updatedAt: now, lastRun, alerts: [...existing, ...r.alerts] };
  let written = false;
  if (!dry) {
    await mkdir(dirname(alertsPath), { recursive: true });
    await writeAtomic(alertsPath, JSON.stringify(out, null, 2) + '\n');
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

  /* A path the reader types is taken from where they are standing; only the
     defaults live in the repository. Resolving typed paths against the repo
     root sent --alerts mine.json into the repository, under a name
     .gitignore does not cover. */
  const path = (n, d) => { const v = flag(n, null); return v ? resolve(v) : resolve(ROOT, d); };

  let E;
  try { E = await loadEngine(path('html', 'index.html')); }
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

  const setupsPath = path('setups', 'data/scan-setups.json');
  const historyPath = path('history', 'data/price-history.json');
  const alertsPath = path('alerts', 'data/scan-alerts.json');
  const instrumentsPath = path('instruments', 'data/instruments.json');
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
  console.log(`bars       ${r.asOf ? E.scanBarRange(r.asOfFrom, r.asOf) : '—'} (each pair on its own instrument's last bar — the engine cannot tell whether that session had closed)`);
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
    console.log('\nUNTESTED EVERYWHERE — no instrument in the universe could test these rules:');
    untestedEverywhere.forEach(u => console.log(`  · ${u.setup}: ${u.why}`));
  }
  const untestedList = r.untestedList || [];
  if (untestedList.length) {
    /* Grouped by reason, with each instrument's bar count taken out, so a
       large universe prints one line per cause rather than one per pair. */
    const by = new Map();
    untestedList.forEach(u => { const k = `${u.setup}: ${u.why.replace(/; \d+ held/g, '')}`; by.set(k, [...(by.get(k) || []), u.symbol]); });
    console.log('\nuntested:');
    [...by.entries()].forEach(([k, syms]) => console.log(`  ${String(syms.length).padStart(4)}  ${k}  (${syms.slice(0, 6).join(', ')}${syms.length > 6 ? ', …' : ''})`));
  }
  if ((r.stale || []).length) {
    console.log('\nbehind the rest — evaluated, but on an old bar:');
    r.stale.forEach(x => console.log(`  · ${x.symbol}: ${x.why}`));
  }
  const routine = r.skipped.filter(s => s.symbol);
  if (routine.length) {
    const by = new Map();
    /* Grouped by reason, and each group names its first few instruments: a
       count alone did not say which named symbol had no series. */
    routine.forEach(s => { const k = s.why.replace(/ of \d{4}-\d{2}-\d{2}$/, '').replace(/\d{4}-\d{2}-\d{2}/, 'a date'); by.set(k, [...(by.get(k) || []), s.symbol]); });
    console.log('\nper instrument:');
    [...by.entries()].forEach(([k, syms]) => { const u = [...new Set(syms)]; console.log(`  ${String(syms.length).padStart(4)}  ${k}  (${u.slice(0, 6).join(', ')}${u.length > 6 ? ', …' : ''})`); });
  }
  console.log('\nA record that conditions held, in setup-then-instrument order. Not a signal, not ranked, not sent anywhere.');
  process.exit(run.warn ? 2 : 0);
}

/* Run only as the entry point; scanner-test.mjs imports the functions above. */
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && (process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self)) await main();
