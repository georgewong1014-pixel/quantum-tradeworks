#!/usr/bin/env node
/**
 * Trade-setup scanner — daily worker (personal lane)
 *
 *   node scanner/scan.mjs                  evaluate data/scan-setups.json on
 *                                          data/price-history.json; append matches
 *                                          to data/scan-alerts.json; log the run
 *   node scanner/scan.mjs --trigger daily  the same, recorded as the scheduled run
 *                                          (ingest/daily.mjs passes it)
 *   node scanner/scan.mjs --as-of DATE     REPLAY: evaluate as though the history ended
 *                                          on DATE and the clock read the morning after;
 *                                          anything already recorded is not recorded
 *                                          again; audited
 *   node scanner/scan.mjs --retry RUNID    re-run a logged run's scan on the same session
 *                                          dates (its history cut and its clock); audited
 *   node scanner/scan.mjs --pause "why"    stop scheduled and manual runs until --resume;
 *   node scanner/scan.mjs --resume         a paused run is logged SKIPPED_PAUSED; audited
 *   node scanner/scan.mjs --unlock [--force]  remove a lock left by a dead run; audited
 *   node scanner/scan.mjs --status [--json]   the dashboard's four answers, in words
 *   node scanner/scan.mjs --runs [n] [--json] the last n runs (10)
 *   node scanner/scan.mjs --backtest SETUPID [--from DATE] [--to DATE] [--symbols A,B] [--json]
 *                                          the bars on which a setup's conditions held
 *                                          in your history — a simulation, not a backtest
 *                                          of returns; writes nothing
 *   node scanner/scan.mjs --check          run only the self-test and exit
 *   node scanner/scan.mjs --dry            evaluate and print; write nothing, log nothing
 *   node scanner/scan.mjs --setups f --history f --alerts f --instruments f --html f
 *                                          a path given here is taken from the current
 *                                          directory; the defaults are in the repository
 *   node scanner/scan.mjs --data DIR       every data file in DIR (setups, history,
 *                                          alerts and the worker's own files)
 *   node scanner/scan.mjs --now ISO        judge staleness and bar status as though the
 *                                          clock read ISO (tests on fixed fixtures)
 *   node scanner/scan.mjs --hold MS        keep the lock MS ms before evaluating (the
 *                                          lock's own test)
 *
 *   exit 0  COMPLETED — whatever matched is recorded (or a command succeeded)
 *   exit 1  FAILED (or CANCELLED) — engine missing, self-test failed, a file
 *           unreadable; nothing was written over the record
 *   exit 2  PARTIAL — ran and recorded, but a setup was left out or skipped, could
 *           not be tested anywhere in its universe, or the delivery record could
 *           not be written
 *   exit 3  SKIPPED — paused, another run holds the lock, no setups, or no data
 *           (no history, nothing on or before the replay date, or nothing changed
 *           since the last run)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ENGINE, NOT TWO
 *
 * The rule evaluator is not reimplemented here. This file slices index.html
 * between @scan-engine-start and @scan-engine-end (the region comes from
 * src/js/24-market-engine.js) and evaluates it in Node — the same code the
 * scanner page runs when the reader presses "evaluate now". Two copies of an
 * indicator would drift, and then a match on the page and a match in the
 * record would disagree about whether a rule held.
 *
 * EVERY RUN SELF-TESTS
 *
 * Extraction by marker can fail silently: a refactor moves a function out of the
 * region and the worker still runs, just wrong. So every run first evaluates
 * the engine's own fixture — two instruments, one of which crosses its 50-bar
 * average on volume with RSI in range on the last bar — and refuses to continue
 * unless exactly that one alert comes back, a second pass adds none, the 0.2
 * key of the same bar adds none, the tree form records a NEW_MATCH, and the
 * same history judged months later (stale) records nothing.
 *
 * EVERY RUN IS LOGGED
 *
 * data/scan-runs.json holds the newest 500 runs and every operator action.
 * Each run is written PENDING when it takes the lock, RUNNING after the
 * self-test, and then one terminal status — COMPLETED, PARTIAL, FAILED,
 * CANCELLED, SKIPPED_NO_DATA, SKIPPED_NO_SETUPS, SKIPPED_LOCKED or
 * SKIPPED_PAUSED — with its counts, the readiness of each market, its errors
 * (each with a category and a correlation id printed beside it on screen) and
 * its duration. A run that could not even load the engine is logged too.
 * The `audit` list records every replay, retry, pause, resume, unlock and
 * lock takeover, with who ran it on this machine.
 *
 * ONE RUN AT A TIME
 *
 * data/scan.lock is opened with 'wx', so of two runs (Task Scheduler's and a
 * manual one) only one evaluates; the other is logged SKIPPED_LOCKED and
 * exits 3, and neither can drop the other's alerts. A lock whose process is
 * dead, or older than an hour, is taken over and the takeover recorded; the
 * run it belonged to is closed FAILED/ABANDONED. This is a lock on one data
 * directory on one machine, not a distributed lock.
 *
 * DELIVERY
 *
 * An alert is delivered in the app by being written to the record the pages
 * read; data/scan-deliveries.json holds one IN_APP row per new alert. Email,
 * Telegram and push are recorded NOT_CONFIGURED with the reason — there is no
 * server to send from and no contact address held under a privacy notice —
 * never as failures of something attempted. The delivery record is written
 * after the alerts, so its failure never loses an alert (the run is PARTIAL).
 *
 * WHAT THIS IS NOT
 *
 * It reads the reader's own price history — closes read off their own screen
 * under their own subscription — and nothing else; no feed is licensed to it.
 * It writes files; it sends nothing. It records that conditions held; it
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
import { hostname, userInfo } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { acquireLock, releaseLock, withLock, lockVerdict } from '../ingest/lockfile.mjs';

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
    return { ${ENGINE_EXPORTS.join(', ')} };
  `);
  return factory();
}

/* Every name the engine region hands out. The page reads the same names as
   globals; this list is what the worker and the tests can reach. A name
   missing from the region fails the load with a ReferenceError that names
   it, rather than a scan that quietly runs without it. */
export const ENGINE_EXPORTS = [
  /* constants */
  'SCAN_VERSION', 'SCAN_MARKETS', 'SCAN_TIMEFRAMES', 'SCAN_LIMITS', 'SCAN_TOLERANCE', 'SCAN_UNITS', 'SCAN_INDICATORS', 'SCAN_DEFAULT_N',
  'SCAN_OPERATORS', 'SCAN_OP_ALIASES', 'SCAN_STATUSES', 'SCAN_REASONS', 'SCAN_SIMULATION_NOTE', 'SCAN_ISO_DAY',
  /* hashing and identity */
  'scanHash', 'scanStable', 'scanCanonical', 'scanKey', 'scanLegacyKey', 'scanAlertId', 'scanSetupsHash',
  /* markets, time and calendars */
  'scanMarket', 'scanTimeframe', 'scanIsDay', 'scanWeekday', 'scanAddDays', 'scanDayDiff', 'scanTzParts', 'scanZonedInstant',
  'scanSessionEnd', 'scanLocalDate', 'scanSessionDateAt', 'scanBarStatus', 'scanCalendar', 'scanWeekdayCalendar', 'scanIsSession',
  'scanSessionsBetween', 'scanExpectedLastSession', 'scanMarketOf', 'scanRegistry',
  /* bars and data */
  'scanValidateBar', 'scanBars', 'scanSeriesBars', 'scanSliceBars', 'scanResample', 'scanDataVersion', 'scanPriceBreaks',
  'scanReadiness', 'scanDataHealth', 'scanTruncateHistory', 'scanReplayNow',
  /* indicators */
  'scanNumeric', 'scanParams', 'scanPeriodOf', 'scanUnitOf', 'scanFieldOf', 'scanSpecKey', 'scanSideLabel',
  'scanSma', 'scanEma', 'scanRsi', 'scanMacd', 'scanBb', 'scanAtr', 'scanRollExtreme', 'scanChange', 'scanRvol',
  'scanCache', 'scanIndicatorSeries', 'scanIndicator', 'scanDec', 'scanFmt', 'scanFmtAll',
  /* rules and setups */
  'scanOpName', 'scanCompare', 'scanNormaliseSetup', 'scanNormaliseNode', 'scanValidate', 'scanEvaluate', 'scanRule', 'scanSetup',
  'scanConditionProse', 'scanTreeLines', 'scanConditionCount',
  /* the run and what reads it */
  'scanUniverse', 'scanUniverseGaps', 'scanBarRange', 'scanRun', 'scanHistorical', 'scanStatus', 'scanSetupDrift', 'scanSnapshotDrift',
  'scanFixture', 'scanSelfTest',
];

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
   volume is all or nothing — and the previous record is kept as .bak. Every
   file this worker writes goes the same way. */
export async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  try {
    if (existsSync(path)) await copyFile(path, `${path}.bak`);
    await rename(tmp, path);
  } catch (e) { await rm(tmp, { force: true }); throw e; }
}

const fail = (code, message, category) => Object.assign(new Error(message), { code, category });

/* The newest bar any series holds — what a retry cuts the history at. */
function newestBar(history) {
  let best = null;
  for (const s of Object.values(history?.series || {})) for (const d of Object.keys(s || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && (!best || d > best)) best = d;
  return best;
}

/* One evaluation of a setups file on a history file, merged into an alerts
   file. Pure with respect to the process: no exit, no console; the CLI below
   turns the result into words, a log entry and a code, and the test reads it
   directly. A thrown error carries `code` — NO_SETUPS, NO_HISTORY, NO_DATA,
   BAD_SETUPS, BAD_HISTORY, BAD_ALERTS — which the CLI maps to a status.

   asOf replays (the engine cuts the history and sets the clock); truncateAt
   cuts the history but keeps `now` (a retry of a live run). unchangedKey is
   the logical key of the last run that evaluated: when this run's key is
   the same, nothing it could record is new, and it returns skipped. */
export async function runOnce({ E, setupsPath, historyPath, alertsPath, instrumentsPath, dry = false, now = new Date().toISOString(),
                                runId = `run-${now.replace(/[-:.]/g, '').slice(0, 15)}-${process.pid}`, origin = 'cli', trigger = 'manual',
                                asOf = null, truncateAt = null, unchangedKey = null, onRead = null }) {
  if (!existsSync(setupsPath)) throw fail('NO_SETUPS', `no setups file at ${setupsPath}`);
  let doc;
  try { doc = await readJson(setupsPath); }
  catch (e) { throw fail('BAD_SETUPS', `${setupsPath} is not valid JSON (${e.message})`, 'VALIDATION'); }
  /* An empty list is "no setups", as the header says — not a clean run of
     nothing that ingest/daily.mjs then reports as "0 new alerts". */
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.setups) ? doc.setups : null;
  if (list && !list.length) throw fail('NO_SETUPS', `the setups file at ${setupsPath} holds no setups`);
  const { setups, problems } = validateSetups(doc, E);
  if (!existsSync(historyPath)) throw fail('NO_HISTORY', `no price history at ${historyPath}`);
  let historyText, history;
  try { historyText = await readFile(historyPath, 'utf8'); history = JSON.parse(historyText); }
  catch (e) { throw fail('BAD_HISTORY', `${historyPath} is not valid JSON (${e.message})${existsSync(`${historyPath}.bak`) ? ` — the previous file is ${historyPath}.bak` : ''}`, 'DATA'); }
  const historyHash = `sha256:${createHash('sha256').update(historyText).digest('hex').slice(0, 16)}`;
  const historyNewest = newestBar(history);
  onRead?.({ historyHash, historyNewest, setupsHash: E.scanSetupsHash(doc) });
  if (!historyNewest) throw fail('NO_DATA', `${historyPath} holds no bars`);
  if (asOf && !Object.values(history.series || {}).some(s => Object.keys(s || {}).some(d => d <= asOf))) {
    throw fail('NO_DATA', `no series in ${historyPath} holds a bar on or before ${asOf} (the first is later)`);
  }
  if (truncateAt) history = E.scanTruncateHistory(history, truncateAt);
  let instruments = [];
  if (instrumentsPath && existsSync(instrumentsPath)) {
    try { const reg = await readJson(instrumentsPath); instruments = Array.isArray(reg) ? reg : (reg?.instruments || []); } catch { instruments = []; }
  }
  let existingDoc = null;
  if (existsSync(alertsPath)) {
    try { existingDoc = await readJson(alertsPath); } catch {
      const bak = `${alertsPath}.bak`;
      throw fail('BAD_ALERTS', `${alertsPath} is not valid JSON — nothing was written over it${existsSync(bak) ? `. The record as it stood before the last write is in ${bak}` : ''}`, 'IO');
    }
  }
  const existing = Array.isArray(existingDoc) ? existingDoc : Array.isArray(existingDoc?.alerts) ? existingDoc.alerts : [];
  const setupsHash = E.scanSetupsHash(doc);
  /* The logical scan: the same engine, setups, history bytes and record
     cannot produce a new alert, so a second run on them is skipped rather
     than repeated — and says so. A replay or retry is asked for by name and
     is never skipped this way. */
  const logicalKey = `${E.SCAN_VERSION}|${setupsHash}|${historyHash}|${E.scanHash(existing.map(a => a?.key || a?.id || '').sort().join('\n'))}|${asOf || truncateAt || 'live'}`;
  const base = { historyHash, historyNewest, setupsHash, logicalKey, problems };
  if (unchangedKey && unchangedKey === logicalKey) return { ...base, skipped: 'SKIPPED_NO_DATA' };

  /* The alerts are written in the engine's V2 shape (id, version, event,
     values, data version, run id), carrying the 0.2 fields — bar, rules,
     recordedAt — for one release, so this file's printout and
     ingest/daily.mjs keep reading them. */
  const r = E.scanRun(setups, history, { instruments, existing, now, runId, origin, asOf });

  /* A setup none of whose instruments could be tested is a configuration
     problem, not a quiet day: the exit code says so. The engine decides it
     from the pairs it evaluated. */
  const setupLevel = r.skipped.filter(s => !s.symbol);
  const untestedEverywhere = r.untestedEverywhere || [];

  const lastRun = { at: now, runId, origin, trigger, asOf: r.asOf, asOfFrom: r.asOfFrom, replayAsOf: asOf || null, engine: r.engine, setups: r.setups, evaluated: r.evaluated,
                    matched: r.matched, recorded: r.alerts.length, deduped: r.deduped, cooldown: r.cooldown, continuing: r.continuing,
                    untested: r.untested, skipped: r.skipped.length, setupsHash,
                    problems, untestedEverywhere, stale: r.stale || [], provisional: r.provisional || [],
                    readiness: (r.readiness?.markets || []).map(m => ({ market: m.market, state: m.state, expected: m.expected, newestFinal: m.newestFinal, inRun: m.inRun, text: m.text })),
                    cacheStats: r.cacheStats };
  const out = { engine: r.engine, updatedAt: now, lastRun, alerts: [...existing, ...r.alerts] };
  let written = false;
  if (!dry) {
    await mkdir(dirname(alertsPath), { recursive: true });
    await writeAtomic(alertsPath, JSON.stringify(out, null, 2) + '\n');
    written = true;
  }
  const warn = problems.length > 0 || setupLevel.length > 0 || untestedEverywhere.length > 0;
  return { ...base, result: r, setupLevel, untestedEverywhere, out, written, warn, existingCount: existing.length };
}

/* --------------------------------------------------------- worker files -- */

/* Beside the alert record the lock protects — so a test that points
   --alerts at a temporary folder never touches the repository's files. */
export const WORKER_FILES = { runs: 'scan-runs.json', lock: 'scan.lock', control: 'scan-control.json', deliveries: 'scan-deliveries.json' };
export const workerPaths = (dir) => Object.fromEntries(Object.entries(WORKER_FILES).map(([k, f]) => [k, join(dir, f)]));

export const RUNS_CAP = 500, AUDIT_CAP = 1000, DELIVERIES_CAP = 10000;
export const LOCK_STALE_MS = 3600000;
export const EXIT_CODES = { COMPLETED: 0, FAILED: 1, CANCELLED: 1, PARTIAL: 2, SKIPPED_NO_DATA: 3, SKIPPED_NO_SETUPS: 3, SKIPPED_LOCKED: 3, SKIPPED_PAUSED: 3 };
export const RUN_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'SKIPPED_NO_DATA', 'SKIPPED_NO_SETUPS', 'SKIPPED_LOCKED', 'SKIPPED_PAUSED'];
export const ERROR_CATEGORIES = ['ENGINE', 'VALIDATION', 'DATA', 'IO', 'LOCK', 'DELIVERY', 'ABANDONED', 'CANCELLED', 'ARGS'];

/* The channels, stated whether or not anything was delivered. NOT_CONFIGURED
   is a named extension of the specification's delivery statuses: writing
   FAILED rows for a channel nobody could attempt would misstate it. */
export const CHANNELS = Object.freeze({
  IN_APP: { status: 'ACTIVE', meaning: 'An alert is delivered in the app by being written to data/scan-alerts.json, which the scanner pages read. Whether it has been read or archived is kept in each browser (scanAlertState), so two browsers can disagree.' },
  EMAIL: { status: 'NOT_CONFIGURED', why: 'No server sends mail for this product, and no contact address is held under a privacy notice (PDPA). Blocked on an operating entity and a backend (SC-309).' },
  TELEGRAM: { status: 'NOT_CONFIGURED', why: 'A bot token must live on a server, and binding a chat id is holding a contact identifier under a privacy notice; neither exists (SC-315).' },
  PUSH: { status: 'NOT_CONFIGURED', why: 'Web push needs a push service and a server holding subscriptions, and the live intraday scanner it would push from is not built (SC-317, SC-318).' },
});

const operator = () => { try { return userInfo().username; } catch { return null; } };
const emptyRuns = () => ({ schema: 1, runs: [], audit: [] });

export async function readRunsDoc(path) {
  if (!existsSync(path)) return emptyRuns();
  try {
    const d = await readJson(path);
    return { ...d, schema: 1, runs: Array.isArray(d?.runs) ? d.runs : [], audit: Array.isArray(d?.audit) ? d.audit : [] };
  } catch {
    /* A damaged log is not a reason to stop scanning: it is set aside
       (the .bak holds the previous good copy) and a new one started, and
       the reset is the new log's first audit entry. */
    const aside = `${path}.damaged-${Date.now()}`;
    await rename(path, aside).catch(() => {});
    return { ...emptyRuns(), audit: [{ at: new Date().toISOString(), action: 'runs-log-reset', detail: { setAside: aside } }] };
  }
}

/* Read, change and write the runs log under its own short lock: a run
   holding the scan lock and a run being turned away both write to it. */
export async function updateRuns(path, fn) {
  await mkdir(dirname(path), { recursive: true });
  return withLock(`${path}.lock`, async () => {
    const doc = await readRunsDoc(path);
    const res = await fn(doc);
    if (doc.runs.length > RUNS_CAP) doc.runs = doc.runs.slice(-RUNS_CAP);
    if (doc.audit.length > AUDIT_CAP) doc.audit = doc.audit.slice(-AUDIT_CAP);
    doc.updatedAt = new Date().toISOString();
    await writeAtomic(path, JSON.stringify(doc, null, 1) + '\n');
    return res;
  });
}

const auditEntry = (action, extra = {}) => ({ at: new Date().toISOString(), action, operator: operator(), host: hostname(), ...extra });

export async function readControl(path) {
  if (!existsSync(path)) return { schema: 1, paused: false };
  try { return { schema: 1, paused: false, ...(await readJson(path)) }; }
  catch { return { schema: 1, paused: false, damaged: true }; }
}

/* The in-app delivery record: one row per new alert, the channels block
   rewritten every time. */
export async function writeDeliveries(path, alerts, { runId, now = new Date().toISOString() } = {}) {
  let doc = { schema: 1, deliveries: [] };
  if (existsSync(path)) {
    try { const d = await readJson(path); if (Array.isArray(d?.deliveries)) doc = d; }
    catch { /* rewritten below; the .bak keeps the damaged copy's predecessor */ }
  }
  const have = new Set(doc.deliveries.map(x => x?.id));
  let added = 0;
  for (const a of alerts) {
    const id = `${a.id}:IN_APP`;
    if (have.has(id)) continue;
    doc.deliveries.push({ id, alertId: a.id, alertKey: a.key, channel: 'IN_APP', status: 'SENT', attemptCount: 1, sentAt: now, runId,
                          setupId: a.setupId, symbol: a.symbol, candleDate: a.candleDate || a.bar });
    added++;
  }
  if (doc.deliveries.length > DELIVERIES_CAP) doc.deliveries = doc.deliveries.slice(-DELIVERIES_CAP);
  const out = { schema: 1, updatedAt: now, channels: CHANNELS,
                note: 'IN_APP SENT means written to the alert record the app reads — nothing left this machine. No row is written for a channel that is not configured.',
                deliveries: doc.deliveries };
  await writeAtomic(path, JSON.stringify(out, null, 1) + '\n');
  return added;
}

/* --------------------------------------------------------- run records -- */

function newRunId(now) { return `run-${now.replace(/[-:.]/g, '').slice(0, 15)}-${process.pid}-${randomBytes(2).toString('hex')}`; }

function makeRun({ id, trigger, origin, now, args, retryOf = null, replayAsOf = null, paths }) {
  const at = new Date().toISOString();
  return { id, kind: 'scan', trigger, origin, status: 'PENDING', startedAt: at, finishedAt: null, durationMs: null, exitCode: null,
           now, replayAsOf, retryOf, engine: null, pid: process.pid, host: hostname(), operator: operator(), args,
           files: { setups: paths.setups, history: paths.history, alerts: paths.alerts },
           historyHash: null, historyNewest: null, setupsHash: null, logicalKey: null,
           asOf: null, asOfFrom: null, counts: null, readiness: [], stale: 0, provisional: 0, errors: [], error: null, skipReason: null,
           lockTakeover: null, transitions: [{ status: 'PENDING', at }] };
}

function addError(run, category, message, extra = {}) {
  const e = { category, message, correlationId: `${run.id}/e${run.errors.length + 1}`, ...extra };
  run.errors.push(e);
  if (!run.error) run.error = { category, message, correlationId: e.correlationId };
  return e;
}

async function saveRun(runsPath, run) {
  await updateRuns(runsPath, (doc) => {
    const i = doc.runs.findIndex(r => r.id === run.id);
    if (i > -1) doc.runs[i] = run; else doc.runs.push(run);
  });
}

function setStatus(run, status) {
  run.status = status;
  run.transitions.push({ status, at: new Date().toISOString() });
  if (!['PENDING', 'RUNNING'].includes(status)) {
    run.finishedAt = new Date().toISOString();
    run.durationMs = Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
    run.exitCode = EXIT_CODES[status];
  }
}

/* A run a dead process left PENDING or RUNNING is closed, never left to
   look as though it were still going. */
function closeOrphan(doc, holder, why) {
  const orphan = holder?.runId ? doc.runs.find(r => r.id === holder.runId) : null;
  if (!orphan || !['PENDING', 'RUNNING'].includes(orphan.status)) return null;
  const at = new Date().toISOString();
  orphan.status = 'FAILED';
  orphan.transitions = [...(orphan.transitions || []), { status: 'FAILED', at }];
  orphan.finishedAt = at;
  orphan.durationMs = Math.max(0, Date.parse(at) - Date.parse(orphan.startedAt));
  orphan.exitCode = 1;
  const e = { category: 'ABANDONED', message: `its process (pid ${holder.pid} on ${holder.host}) ${why === 'dead' ? 'ended' : 'held the lock for over an hour'} before the run finished; the lock was ${why === 'dead' ? 'taken over' : 'taken over as stale'}`, correlationId: `${orphan.id}/e${(orphan.errors || []).length + 1}` };
  orphan.errors = [...(orphan.errors || []), e];
  orphan.error = orphan.error || { category: e.category, message: e.message, correlationId: e.correlationId };
  return orphan.id;
}

/* ------------------------------------------------------------------ CLI -- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseArgs(argv) {
  const has = (f) => argv.includes(`--${f}`);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] != null && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  return { has, flag };
}

async function main() {
  const argv = process.argv.slice(2);
  const { has, flag } = parseArgs(argv);

  /* A path the reader types is taken from where they are standing; only the
     defaults live in the repository. Resolving typed paths against the repo
     root sent --alerts mine.json into the repository, under a name
     .gitignore does not cover. */
  const dataDir = flag('data', null) ? resolve(flag('data')) : null;
  const path = (n, file) => { const v = flag(n, null); return v ? resolve(v) : dataDir ? join(dataDir, file) : resolve(ROOT, 'data', file); };
  const setupsPath = path('setups', 'scan-setups.json');
  const historyPath = path('history', 'price-history.json');
  const alertsPath = path('alerts', 'scan-alerts.json');
  const instrumentsPath = flag('instruments', null) ? resolve(flag('instruments')) : resolve(ROOT, 'data/instruments.json');
  const W = workerPaths(dataDir || dirname(alertsPath));

  /* --now ISO: judge staleness and bar status as though the clock read this
     instant. For tests on fixed fixtures; a real run takes the clock. */
  const nowFlag = flag('now', null);
  if (nowFlag != null && !Number.isFinite(Date.parse(nowFlag))) { console.error(`--now "${nowFlag}" is not a date-time`); process.exit(1); }
  const now = nowFlag != null ? new Date(Date.parse(nowFlag)).toISOString() : new Date().toISOString();

  /* ------------------------------------------ commands that need no engine */
  if (has('pause') || has('resume')) {
    const ctl = await readControl(W.control);
    if (has('pause')) {
      const reason = flag('pause', null);
      if (ctl.paused) { console.log(`already paused since ${ctl.since}${ctl.reason ? ` — ${ctl.reason}` : ''}`); process.exit(0); }
      const next = { schema: 1, paused: true, since: new Date().toISOString(), reason, by: operator(), updatedAt: new Date().toISOString() };
      await writeAtomic(W.control, JSON.stringify(next, null, 2) + '\n');
      await updateRuns(W.runs, (doc) => { doc.audit.push(auditEntry('pause', { reason })); });
      console.log(`paused${reason ? ` — ${reason}` : ''}. Every run is now logged SKIPPED_PAUSED and exits 3 until: node scanner/scan.mjs --resume`);
    } else {
      if (!ctl.paused) { console.log('not paused — nothing to resume'); process.exit(0); }
      const next = { schema: 1, paused: false, since: null, reason: null, resumedAt: new Date().toISOString(), by: operator(), lastPause: { since: ctl.since || null, reason: ctl.reason || null }, updatedAt: new Date().toISOString() };
      await writeAtomic(W.control, JSON.stringify(next, null, 2) + '\n');
      await updateRuns(W.runs, (doc) => { doc.audit.push(auditEntry('resume', { pausedSince: ctl.since || null, reason: ctl.reason || null })); });
      console.log(`resumed (paused since ${ctl.since || '—'}). The next run evaluates as usual.`);
    }
    process.exit(0);
  }
  if (has('unlock')) {
    if (!existsSync(W.lock)) { console.log(`no lock at ${W.lock}`); process.exit(0); }
    let holder = null; try { holder = await readJson(W.lock); } catch { /* unreadable lock */ }
    const why = lockVerdict(holder, { staleMs: LOCK_STALE_MS });
    if (!why && !has('force')) {
      console.error(`refusing: the lock is held by a live process — pid ${holder.pid} on ${holder.host} since ${holder.startedAt}${holder.runId ? ` (${holder.runId})` : ''}.`);
      console.error('Wait for it to finish, or pass --force if you know that process is not a scan.');
      process.exit(1);
    }
    await rm(W.lock, { force: true });
    await updateRuns(W.runs, (doc) => {
      const closed = closeOrphan(doc, holder, why || 'dead');
      doc.audit.push(auditEntry('unlock', { previous: holder, why: why || 'forced', forced: !why, closedRun: closed }));
    });
    console.log(`lock removed${holder ? ` (pid ${holder.pid} since ${holder.startedAt}; ${why || 'forced'})` : ' (it was unreadable)'}; recorded in ${W.runs}`);
    process.exit(0);
  }
  if (has('runs')) {
    const n = Math.max(1, Number(flag('runs', 10)) || 10);
    const doc = await readRunsDoc(W.runs);
    const last = doc.runs.slice(-n);
    if (has('json')) { console.log(JSON.stringify({ runs: last, audit: doc.audit.slice(-n) }, null, 2)); process.exit(0); }
    if (!doc.runs.length) { console.log(`no runs logged in ${W.runs}`); process.exit(0); }
    console.log(`last ${last.length} of ${doc.runs.length} run(s) — ${W.runs}\n`);
    for (const r of last.slice().reverse()) {
      const c = r.counts || {};
      console.log(`  ${r.startedAt}  ${r.status.padEnd(17)} ${String(r.trigger || '').padEnd(7)} ${String(r.durationMs ?? '—').padStart(6)} ms  ${r.id}`);
      if (r.counts) console.log(`      ${c.evaluated} evaluated · ${c.matched} matched · ${c.recorded} recorded · ${c.deduped} already recorded${r.asOf ? ` · bars ${r.asOfFrom && r.asOfFrom !== r.asOf ? `${r.asOfFrom} … ` : ''}${r.asOf}` : ''}${r.replayAsOf ? ` · replay of ${r.replayAsOf}` : ''}${r.retryOf ? ` · retry of ${r.retryOf}` : ''}`);
      if (r.skipReason) console.log(`      ${r.skipReason}`);
      (r.errors || []).forEach(e => console.log(`      ${e.category} ${e.correlationId}: ${e.message}`));
    }
    process.exit(0);
  }

  /* ----------------------------------------------------------- the engine */
  let E, engineError = null;
  try { E = await loadEngine(flag('html', null) ? resolve(flag('html')) : join(ROOT, 'index.html')); }
  catch (err) { engineError = err; }

  if (has('status')) {
    if (engineError) { console.error(`Could not load the scan engine out of index.html: ${engineError.message}`); process.exit(1); }
    const runsDoc = await readRunsDoc(W.runs);
    const control = await readControl(W.control);
    let alertsDoc = null, setupsDoc = null, history = null, instruments = [];
    try { alertsDoc = existsSync(alertsPath) ? await readJson(alertsPath) : null; } catch { /* reported below */ }
    try { setupsDoc = existsSync(setupsPath) ? await readJson(setupsPath) : null; } catch { /* reported below */ }
    try { history = existsSync(historyPath) ? await readJson(historyPath) : null; } catch { /* reported below */ }
    try { const reg = await readJson(instrumentsPath); instruments = Array.isArray(reg) ? reg : (reg?.instruments || []); } catch { /* none */ }
    const historyMeta = history ? { symbols: Object.keys(history.series || {}), newestBar: newestBar(history) } : null;
    const st = E.scanStatus({ runs: runsDoc, alertsDoc, setupsDoc, historyMeta, control, now, instruments });
    let lock = null; try { lock = existsSync(W.lock) ? await readJson(W.lock) : null; } catch { lock = { unreadable: true }; }
    if (has('json')) { console.log(JSON.stringify({ status: st, control, lock, channels: CHANNELS, files: { ...W, alerts: alertsPath, setups: setupsPath, history: historyPath } }, null, 2)); process.exit(0); }
    const d = (r) => (r ? `${r.status} ${r.finishedAt || r.startedAt || ''}${r.id ? ` (${r.id})` : ' (from the alerts file — before the run log)'}${r.asOf ? `, bars of ${r.asOf}` : ''}` : 'none');
    console.log(`scanner    ${st.state.toUpperCase()}`);
    st.reasons.forEach(x => console.log(`           ${x}`));
    console.log(`setups     ${st.active.enabled} enabled of ${st.active.valid} valid${st.active.expired ? `, ${st.active.expired} expired` : ''}${st.active.refused ? `, ${st.active.refused} refused` : ''}${setupsDoc ? '' : ` — no setups file at ${setupsPath}`}`);
    if (st.monitored) console.log(`watching   ${st.monitored.instruments} instrument(s) with a series${st.monitored.missing.length ? `; ${st.monitored.missing.length} named but not in your history` : ''}`);
    console.log(`last ok    ${d(st.lastSuccess)}`);
    console.log(`last try   ${d(st.lastAttempt)}`);
    console.log(`matches    ${st.latestMatches.length} on the last successful run's bar`);
    console.log(`control    ${control.paused ? `PAUSED since ${control.since}${control.reason ? ` — ${control.reason}` : ''} (node scanner/scan.mjs --resume)` : 'not paused'}`);
    console.log(`lock       ${lock ? (lock.unreadable ? 'present but unreadable' : `held by pid ${lock.pid} on ${lock.host} since ${lock.startedAt}${lock.runId ? ` (${lock.runId})` : ''}`) : 'free'}`);
    console.log(`channels   in-app ACTIVE (the alert record); ${Object.entries(CHANNELS).filter(([, c]) => c.status !== 'ACTIVE').map(([k]) => k.toLowerCase()).join(', ')} NOT CONFIGURED — no server, no contact address held`);
    console.log('unread     not known here: read and archived marks live in the browser');
    console.log('timeframe  daily and weekly only — intraday bars need a licensed feed (SC-317)');
    process.exit(0);
  }

  if (has('backtest')) {
    if (engineError) { console.error(`Could not load the scan engine out of index.html: ${engineError.message}`); process.exit(1); }
    const id = flag('backtest', null);
    if (!id) { console.error('usage: node scanner/scan.mjs --backtest SETUPID [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--symbols A,B] [--json]'); process.exit(1); }
    for (const k of ['from', 'to']) { const v = flag(k, null); if (v != null && !E.scanIsDay(v)) { console.error(`--${k} "${v}" is not a date (YYYY-MM-DD)`); process.exit(1); } }
    if (!existsSync(setupsPath)) { console.error(`no setups file at ${setupsPath}`); process.exit(1); }
    if (!existsSync(historyPath)) { console.error(`no price history at ${historyPath}`); process.exit(1); }
    let doc, history, instruments = [];
    try { doc = await readJson(setupsPath); } catch (e) { console.error(`${setupsPath} is not valid JSON: ${e.message}`); process.exit(1); }
    try { history = await readJson(historyPath); } catch (e) { console.error(`${historyPath} is not valid JSON: ${e.message}`); process.exit(1); }
    try { const reg = await readJson(instrumentsPath); instruments = Array.isArray(reg) ? reg : (reg?.instruments || []); } catch { /* none */ }
    const v = E.scanValidate(doc);
    const setup = v.setups.find(s => s.id === id);
    if (!setup) {
      const why = v.problemsBySetup?.[id];
      console.error(why ? `setup "${id}" is refused:\n${why.map(p => `  · ${p.path ? `${p.path}: ` : ''}${p.text}`).join('\n')}` : `no setup "${id}" in ${setupsPath} (have: ${v.setups.map(s => s.id).join(', ') || 'none'})`);
      process.exit(1);
    }
    const symbols = flag('symbols', null) ? flag('symbols').split(',').map(s => s.trim()).filter(Boolean) : null;
    const h = E.scanHistorical(setup, history, { symbols, from: flag('from', null), to: flag('to', null), instruments });
    if (has('json')) { console.log(JSON.stringify(h, null, 2)); process.exit(0); }
    console.log(`HISTORICAL MATCHES — a simulation, not a backtest of returns`);
    console.log(`setup      ${setup.id} v${setup.version} (${setup.cooldownMode}${setup.cooldownBars ? `, cooldown ${setup.cooldownBars} bars` : ''}) on ${h.timeframe}`);
    console.log(`window     ${h.from || 'first bar'} … ${h.to || 'last bar'} (at most ${h.maxBars} bars per instrument)`);
    console.log(`universe   ${h.counts.symbols} instrument(s) · ${h.counts.evaluatedBars} bars evaluated · ${h.counts.unavailableBars} could not be evaluated`);
    console.log(`held on    ${h.counts.matchedBars} bar(s) · ${h.counts.events} new match(es) · ${h.counts.recorded} the worker would have recorded`);
    if (h.skipped.length) h.skipped.forEach(s => console.log(`skipped    ${s.why}`));
    if (h.recorded.length) {
      console.log('\nwould have been recorded (date order within each instrument, instruments in universe order):');
      h.recorded.slice(0, 200).forEach(x => console.log(`  ${x.bar}  ${String(x.symbol).padEnd(10)} ${x.eventType.padEnd(14)} close ${x.close}`));
      if (h.recorded.length > 200) console.log(`  … ${h.recorded.length - 200} more (--json for all)`);
    }
    const gaps = h.missingSessions.filter(m => !m.tolerated);
    if (gaps.length) console.log(`\nmissing sessions: ${gaps.length} gap(s) no calendar explains — a crossing is never read across one`);
    console.log(`\n${h.note}`);
    process.exit(0);
  }

  const dry = has('dry');
  const check = has('check');
  /* ------------------------------------------------------------- a scan */
  const asOfFlag = flag('as-of', null);
  const retryId = flag('retry', null);
  if (has('retry') && !retryId) { console.error('usage: node scanner/scan.mjs --retry RUNID (node scanner/scan.mjs --runs lists them)'); process.exit(1); }
  const triggerFlag = flag('trigger', null);
  if (triggerFlag && !['manual', 'daily'].includes(triggerFlag)) { console.error(`--trigger "${triggerFlag}" is not one of manual, daily (a replay and a retry name themselves)`); process.exit(1); }
  const trigger = retryId ? 'retry' : asOfFlag ? 'replay' : triggerFlag || 'manual';
  const origin = trigger === 'manual' ? 'cli' : trigger;

  if (check || dry) {
    if (engineError) engineFailureText(engineError);
    if (engineError) process.exit(1);
    if (!selfTest(E)) process.exit(1);
    if (check) process.exit(0);
  }

  const runId = newRunId(now);
  const run = makeRun({ id: runId, trigger, origin, now, args: argv, replayAsOf: asOfFlag, retryOf: retryId,
                        paths: { setups: setupsPath, history: historyPath, alerts: alertsPath } });
  let lock = null, committed = false, finished = false;

  /* The single exit path for a scan: the run logged with its terminal
     status, an audit line for a replay or retry, the lock released. */
  const finish = async (status, text = null) => {
    if (finished) return; finished = true;
    if (text && status.startsWith('SKIPPED')) run.skipReason = text;
    setStatus(run, status);
    try {
      if (!dry) {
        await updateRuns(W.runs, (doc) => {
          const i = doc.runs.findIndex(r => r.id === run.id);
          if (i > -1) doc.runs[i] = run; else doc.runs.push(run);
          if (trigger === 'replay' || trigger === 'retry') {
            doc.audit.push(auditEntry(trigger, { runId, status, asOf: asOfFlag || null, retryOf: retryId || null, args: argv,
                                                 added: run.counts?.recorded ?? 0, deduped: run.counts?.deduped ?? 0 }));
          }
        });
      }
    } catch (e) { console.error(`the run log could not be written: ${e.message}`); }
    if (lock) await releaseLock(W.lock, lock).catch(() => {});
    console.log(`\nstatus     ${status} (${run.id}) → ${dry ? 'dry run, not logged' : W.runs}`);
    process.exit(EXIT_CODES[status]);
  };
  const failWith = async (category, message, extra) => {
    const e = addError(run, category, message, extra);
    console.error(`\n${message}\n  [${category} ${e.correlationId}]`);
    await finish('FAILED');
  };

  /* SIGINT or SIGTERM before the alert record is written: nothing is
     written, the run is logged CANCELLED and the lock released. After the
     write the run is allowed to finish, so it is never half-recorded. */
  const onSignal = async (sig) => {
    if (committed) { console.error(`\n${sig} received after the record was written — finishing the run`); return; }
    addError(run, 'CANCELLED', `${sig} received before the alert record was written; nothing was written`);
    await finish('CANCELLED');
  };
  if (!dry) { process.once('SIGINT', () => onSignal('SIGINT')); process.once('SIGTERM', () => onSignal('SIGTERM')); }

  if (engineError) { engineFailureText(engineError); addError(run, 'ENGINE', `the scan engine could not be loaded out of index.html: ${engineError.message}`); return finish('FAILED'); }
  run.engine = `scan ${E.SCAN_VERSION}`;

  /* The retry: the logged run's own session dates. */
  let asOf = asOfFlag, truncateAt = null, runNow = now;
  if (asOf && (!E.scanIsDay(asOf) || asOf > now.slice(0, 10))) return failWith('ARGS', `--as-of "${asOf}" is not a past date (YYYY-MM-DD)`);
  if (retryId) {
    const doc = await readRunsDoc(W.runs);
    const orig = doc.runs.find(r => r.id === retryId);
    if (!orig) return failWith('ARGS', `no run ${retryId} in ${W.runs} — node scanner/scan.mjs --runs lists them`);
    if (['PENDING', 'RUNNING'].includes(orig.status)) return failWith('ARGS', `run ${retryId} is still ${orig.status}; if its process is gone, node scanner/scan.mjs --unlock closes it first`);
    if (orig.replayAsOf) { asOf = orig.replayAsOf; run.replayAsOf = asOf; }
    else if (orig.historyNewest) { truncateAt = orig.historyNewest; runNow = orig.now || now; run.now = runNow; }
    run.retryBasis = orig.replayAsOf ? `the replay of ${orig.replayAsOf}` : orig.historyNewest ? `the history cut at ${orig.historyNewest} and the clock at ${runNow}, as ${retryId} read them`
      : `the history as it stands — ${retryId} ended before it read one`;
  }

  if (!dry) {
    /* Paused: logged and skipped before the lock — a paused worker holds nothing. */
    const control = await readControl(W.control);
    if (control.paused) {
      console.log(`paused since ${control.since}${control.reason ? ` — ${control.reason}` : ''}. Nothing evaluated. node scanner/scan.mjs --resume to continue.`);
      return finish('SKIPPED_PAUSED', `paused since ${control.since}${control.reason ? `: ${control.reason}` : ''}`);
    }
    await mkdir(dirname(W.lock), { recursive: true });
    let got;
    try { got = await acquireLock(W.lock, { info: { runId }, staleMs: LOCK_STALE_MS }); }
    catch (e) { return failWith('LOCK', `the lock ${W.lock} could not be taken: ${e.message}`); }
    if (!got.ok) {
      const h = got.holder;
      const why = `another run holds the lock${h ? ` — pid ${h.pid} on ${h.host} since ${h.startedAt}${h.runId ? ` (${h.runId})` : ''}` : ''}`;
      console.log(`${why}. Nothing evaluated; that run records what this one would have.`);
      addError(run, 'LOCK', why);
      return finish('SKIPPED_LOCKED', why);
    }
    lock = got.lock;
    if (got.takenOver) {
      run.lockTakeover = { previous: got.takenOver.holder, why: got.takenOver.why };
      console.log(`lock       taken over — the previous holder (pid ${got.takenOver.holder?.pid ?? '?'}) was ${got.takenOver.why === 'dead' ? 'no longer running' : got.takenOver.why === 'stale' ? 'over an hour old' : 'unreadable'}; recorded`);
    }
    await updateRuns(W.runs, (doc) => {
      if (got.takenOver) {
        const closed = closeOrphan(doc, got.takenOver.holder, got.takenOver.why);
        doc.audit.push(auditEntry('lock-takeover', { runId, previous: got.takenOver.holder, why: got.takenOver.why, closedRun: closed }));
      }
      doc.runs.push(run);
    });
    const hold = Number(flag('hold', 0));
    if (hold > 0) await sleep(hold);
    if (!selfTest(E)) { addError(run, 'ENGINE', 'self-test failed — the engine extracted from index.html does not reproduce its fixture'); return finish('FAILED'); }
    setStatus(run, 'RUNNING');
    await saveRun(W.runs, run);
  }

  /* The last run that evaluated live: a live run with the same logical key
     is skipped as nothing new. */
  let unchangedKey = null;
  if (!dry && trigger !== 'replay' && trigger !== 'retry') {
    const doc = await readRunsDoc(W.runs);
    const prev = [...doc.runs].reverse().find(r => r.id !== runId && (r.status === 'COMPLETED' || r.status === 'PARTIAL') && r.logicalKey);
    unchangedKey = prev?.logicalKey || null;
    run.comparedWith = prev?.id || null;
  }

  let out;
  try {
    out = await runOnce({ E, setupsPath, historyPath, alertsPath, instrumentsPath, dry, now: runNow, runId, origin, trigger, asOf, truncateAt, unchangedKey,
                          onRead: (x) => { run.historyHash = x.historyHash; run.historyNewest = x.historyNewest; run.setupsHash = x.setupsHash; } });
  } catch (err) {
    const map = { NO_SETUPS: 'SKIPPED_NO_SETUPS', NO_HISTORY: 'SKIPPED_NO_DATA', NO_DATA: 'SKIPPED_NO_DATA' };
    if (map[err.code]) {
      console.error(`\n${err.message}`);
      if (err.code === 'NO_SETUPS') {
        console.error('Copy scanner/setups.example.json to data/scan-setups.json and edit it, or build one');
        console.error('on /app/scanner/setups and export the JSON. That path is git-ignored, so your setups stay local.');
      } else if (err.code === 'NO_HISTORY') {
        console.error('Run the daily capture (ingest/daily.mjs) or import an export (ingest/history-import.mjs) first.');
      }
      return finish(map[err.code], err.message);
    }
    return failWith(err.category || 'IO', err.message);
  }
  run.historyHash = out.historyHash; run.historyNewest = out.historyNewest; run.setupsHash = out.setupsHash; run.logicalKey = out.logicalKey;
  if (out.skipped) {
    const text = `nothing changed since ${run.comparedWith}: the same engine, setups, history and alert record — a run on them records nothing new`;
    console.log(`\n${text}. node scanner/scan.mjs --status says where things stand; --as-of DATE re-evaluates a session on purpose.`);
    return finish(out.skipped, text);
  }
  committed = out.written;

  const { result: r, problems, setupLevel, untestedEverywhere, written } = out;
  run.asOf = r.asOf; run.asOfFrom = r.asOfFrom;
  run.counts = { setups: r.setups, evaluated: r.evaluated, matched: r.matched, recorded: r.alerts.length, deduped: r.deduped, cooldown: r.cooldown,
                 continuing: r.continuing, untested: r.untested, skipped: r.skipped.length, problems: problems.length, untestedEverywhere: untestedEverywhere.length, deliveries: 0 };
  run.readiness = (r.readiness?.markets || []).map(m => ({ market: m.market, state: m.state, expected: m.expected, newestFinal: m.newestFinal, inRun: m.inRun, text: m.text }));
  run.stale = (r.stale || []).length; run.provisional = (r.provisional || []).length;
  problems.forEach(p => addError(run, 'VALIDATION', p));
  setupLevel.forEach(s => addError(run, 'VALIDATION', `${s.setup}: ${s.why}`, { setup: s.setup }));
  untestedEverywhere.forEach(u => addError(run, 'DATA', `${u.setup}: untested everywhere — ${u.why}`, { setup: u.setup }));

  /* Delivery after the record: a failure here never loses an alert. */
  let deliveryFailed = false;
  if (!dry) {
    try { run.counts.deliveries = await writeDeliveries(W.deliveries, r.alerts, { runId, now: new Date().toISOString() }); }
    catch (e) { deliveryFailed = true; addError(run, 'DELIVERY', `the delivery record ${W.deliveries} could not be written (${e.message}); the alerts are recorded`); }
  }

  printRun({ E, r, out, dry, written, alertsPath, run, problems, setupLevel, untestedEverywhere });
  if (dry) process.exit(out.warn ? 2 : 0);
  await finish(out.warn || deliveryFailed ? 'PARTIAL' : 'COMPLETED');
}

function engineFailureText(err) {
  console.error('Could not load the scan engine out of index.html.');
  console.error(`  ${err.message}`);
  console.error('\nThis file does not carry its own copy of the engine, by design — two copies of an');
  console.error('indicator drift and then disagree about whether a rule held. Restore the');
  console.error('@scan-engine-start / @scan-engine-end markers around the engine region and re-run.');
}

function selfTest(E) {
  const st = E.scanSelfTest();
  if (!st.ok) {
    console.error('SELF-TEST FAILED — the engine extracted from index.html does not reproduce its fixture.');
    console.error(`  expected one alert for MATCH on the fixture's last bar; none on a second pass, none against the 0.2 key,`);
    console.error(`           one NEW_MATCH for the tree form, and none when the same history is judged months later (stale)`);
    console.error(`  got      ${st.alerts} alert(s) for ${st.symbol ?? '—'} on ${st.bar ?? '—'}; second pass ${st.again}; 0.2 key ${st.legacy}; tree ${st.tree}; stale ${st.stale}`);
    console.error('\nNothing was written. Either the engine changed, or the markers no longer enclose all of it.');
    return false;
  }
  console.log(`self-test ok — fixture returns one alert (${st.symbol} ${st.bar}); a second pass returns none`);
  console.log(`engine     ${E.SCAN_VERSION} (extracted from index.html)`);
  return true;
}

function printRun({ E, r, dry, written, alertsPath, run, problems, setupLevel, untestedEverywhere }) {
  console.log('');
  if (run.trigger === 'replay') console.log(`replay     as though the history ended on ${run.replayAsOf}, judged the morning after — anything already recorded is not recorded again`);
  if (run.trigger === 'retry') console.log(`retry      of ${run.retryOf}, on ${run.retryBasis}`);
  console.log(`setups     ${r.setups} evaluated${problems.length ? `, ${problems.length} left out` : ''}`);
  console.log(`bars       ${r.asOf ? E.scanBarRange(r.asOfFrom, r.asOf) : '—'} (each pair on its own instrument's last final bar; a bar captured before its session closed is provisional and is not evaluated)`);
  console.log(`evaluated  ${r.evaluated} setup × instrument pair${r.evaluated === 1 ? '' : 's'} · ${r.matched} matched · ${r.untested} untested`);
  console.log(`${r.alerts.length} new alert${r.alerts.length === 1 ? '' : 's'} recorded${dry ? ' (dry run — nothing written)' : written ? ` → ${alertsPath}` : ''}${r.deduped ? ` · ${r.deduped} already recorded` : ''}`);
  if (!dry) console.log(`delivered  ${run.counts.deliveries} in the app (the record above); email, Telegram and push are not configured — nothing is sent`);
  if (r.alerts.length) {
    console.log('');
    r.alerts.forEach(a => {
      console.log(`  ${a.bar}  ${a.setupName}  ${a.symbol}  close ${a.close}`);
      a.rules.forEach(x => console.log(`      ${x.met ? '✓' : '·'} ${x.text}`));
    });
  }
  const tag = (text) => { const e = run.errors.find(x => x.message.endsWith(text) || x.message === text); return e ? `  [${e.correlationId}]` : ''; };
  if (problems.length) {
    console.log('\nLEFT OUT — a setup either passes whole or is skipped whole:');
    problems.forEach(p => console.log(`  · ${p}${tag(p)}`));
  }
  if (setupLevel.length) {
    console.log('\nSKIPPED:');
    setupLevel.forEach(s => console.log(`  · ${s.setup}: ${s.why}${tag(`${s.setup}: ${s.why}`)}`));
  }
  if (untestedEverywhere.length) {
    console.log('\nUNTESTED EVERYWHERE — no instrument in the universe could test these rules:');
    untestedEverywhere.forEach(u => console.log(`  · ${u.setup}: ${u.why}${tag(`${u.setup}: untested everywhere — ${u.why}`)}`));
  }
  const delivery = run.errors.find(e => e.category === 'DELIVERY');
  if (delivery) console.log(`\nDELIVERY RECORD NOT WRITTEN — ${delivery.message}  [${delivery.correlationId}]`);
  const untestedList = r.untestedList || [];
  if (untestedList.length) {
    /* Grouped by reason, with each instrument's bar count taken out, so a
       large universe prints one line per cause rather than one per pair. */
    const by = new Map();
    /* A stale reason names its symbol and dates; grouped without them. */
    const general = (why) => why.replace(/; \d+ held/g, '').replace(/(^|; )its last final bar is \d{4}-\d{2}-\d{2}, and the session of \d{4}-\d{2}-\d{2}/g, '$1the last final bar is older than the session that');
    untestedList.forEach(u => { const k = `${u.setup}: ${general(u.why)}`; by.set(k, [...(by.get(k) || []), u.symbol]); });
    console.log('\nuntested:');
    [...by.entries()].forEach(([k, syms]) => console.log(`  ${String(syms.length).padStart(4)}  ${k}  (${syms.slice(0, 6).join(', ')}${syms.length > 6 ? ', …' : ''})`));
  }
  const notReady = (r.readiness?.markets || []).filter(m => m.inRun && m.state !== 'READY');
  if (notReady.length) {
    console.log('\nmarkets not ready — of those this run evaluated, the session expected by now is not held final:');
    notReady.forEach(m => console.log(`  · ${m.text}`));
  }
  if ((r.provisional || []).length) {
    console.log('\nprovisional — captured before the close, so the bar before was evaluated:');
    r.provisional.forEach(x => console.log(`  · ${x.symbol}: ${x.why}`));
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
}

/* Run only as the entry point; scanner-test.mjs imports the functions above. */
const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && (process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self)) await main();
