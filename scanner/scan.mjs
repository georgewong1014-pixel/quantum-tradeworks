#!/usr/bin/env node
/**
 * Trade-setup scanner — daily worker (personal lane)
 *
 *   node scanner/scan.mjs                  evaluate data/scan-setups.json on
 *                                          data/price-history.json; append matches
 *                                          to data/scan-alerts.json; log the run
 *   node scanner/scan.mjs --trigger daily  the same, recorded as the scheduled run
 *                                          (ingest/daily.mjs passes it)
 *   node scanner/scan.mjs --ready          evaluate only the markets whose expected
 *                                          session is held final; a market that is not
 *                                          is SKIPPED_NO_DATA for the run, named, and the
 *                                          run exits 2 (ingest/daily.mjs passes it)
 *   node scanner/scan.mjs --as-of DATE     REPLAY: evaluate as though the history ended
 *                                          on DATE and the clock read the morning after;
 *                                          anything already recorded is not recorded
 *                                          again; audited
 *        [--setup ID] [--market CODE]      narrow a replay to one setup, or to one
 *                                          registry market's instruments
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
 *                                          alerts, watchlists and the worker's own files)
 *   node scanner/scan.mjs --watchlists f   the watchlist export (default: watchlists.json
 *                                          beside the setups file, i.e. data/)
 *   node scanner/scan.mjs --now ISO        judge staleness and bar status as though the
 *                                          clock read ISO (tests on fixed fixtures)
 *   node scanner/scan.mjs --hold MS        keep the lock MS ms before evaluating (the
 *                                          lock's own test)
 *
 *   exit 0  COMPLETED — whatever matched is recorded (or a command succeeded)
 *   exit 1  FAILED (or CANCELLED) — engine missing, self-test failed, a file
 *           unreadable or the record or run log unwritable, or an argument
 *           refused; nothing was written over the record
 *   exit 2  PARTIAL — ran and recorded, but a setup was left out or skipped (its
 *           version refused by the ledger among them), could not be tested
 *           anywhere in its universe, read a watchlist snapshot because the
 *           export did not hold its list, a market was not ready (--ready), or
 *           the delivery record or the ledger could not be written
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
 * VERSIONS, AND WHAT A MISSED DAY LOSES
 *
 * data/scan-ledger.json is the worker's own append-only record of every
 * version of every setup it has evaluated, so the setups file needs nothing
 * else: a hand edit with no version number is numbered by its content (the
 * version it had, or the next one), and a version number reused for
 * different content is refused. Beside it, `pairs` holds the bar each setup
 * × instrument pair was last evaluated on, and a live run evaluates every
 * completed bar since — up to ten, each on the history as it stood that
 * day — so a day Task Scheduler missed still records its crossings. The
 * output says when it did. A replay evaluates its date only.
 *
 * WATCHLISTS
 *
 * A setup on a watchlist carries a snapshot of its symbols. One saved to
 * resolve from the export reads the list instead from data/watchlists.json
 * (the watchlists page's "Export for the scanner"), at run time — as live as
 * the reader's last export and no more, because this worker cannot read a
 * browser. A list the export does not hold falls back to the snapshot and
 * the run is PARTIAL; every alert says which membership it read.
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
 * after the alerts, so its failure never loses an alert (the run is PARTIAL),
 * and the next run that writes it adds the rows that run could not.
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

import { readFile, writeFile, mkdir, rename, copyFile, rm, stat, chmod } from 'node:fs/promises';
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
  /* round 3, data: recorded corporate actions, the history report, a price at its series' own precision */
  'SCAN_HISTORY_KEEP', 'SCAN_ADJUSTMENT_KINDS', 'scanReadAdjustments', 'scanAttachAdjustments', 'scanAdjust', 'scanExplainBreaks', 'scanBreakSpan',
  'scanWeekdayProfile', 'scanDuplicateSessions', 'scanValidateHistory', 'scanSeriesDp', 'scanFmtFor',
  /* indicators */
  'scanNumeric', 'scanParams', 'scanPeriodOf', 'scanUnitOf', 'scanFieldOf', 'scanSpecKey', 'scanSideLabel',
  'scanSma', 'scanEma', 'scanRsi', 'scanMacd', 'scanBb', 'scanAtr', 'scanRollExtreme', 'scanChange', 'scanRvol',
  'scanCache', 'scanIndicatorSeries', 'scanIndicator', 'scanDec', 'scanFmt', 'scanFmtAll',
  /* rules and setups */
  'scanOpName', 'scanCompare', 'scanNormaliseSetup', 'scanNormaliseNode', 'scanValidate', 'scanEvaluate', 'scanRule', 'scanSetup',
  'scanConditionProse', 'scanTreeLines', 'scanConditionCount',
  /* the run and what reads it */
  'scanUniverse', 'scanUniverseGaps', 'scanBarRange', 'scanRun', 'scanHistorical', 'scanStatus', 'scanSetupDrift', 'scanSnapshotDrift',
  /* round 3 (worker): watchlist resolution, catch-up and gaps */
  'scanResolveUniverse', 'scanPairKey', 'SCAN_CATCH_UP_CAP', 'scanGapText', 'scanGapNote',
  'scanFixture', 'scanSelfTest',
  /* the reader's TradingView indicators (the engine's pine section): TradingView's primitives, the ten scripts, their catalogue; months */
  'SCAN_PINE_INDICATORS', 'SCAN_PINE_MA_TYPES', 'SCAN_PINE_RSI_MA',
  'scanPineNz', 'scanPineSma', 'scanPineEma', 'scanPineRma', 'scanPineRsi', 'scanPineWma', 'scanPineVwma', 'scanPineHma', 'scanPineDema', 'scanPineTema',
  'scanPineStdev', 'scanPineHighest', 'scanPineLowest', 'scanPineChange', 'scanPineCrossover', 'scanPineCrossunder', 'scanPineCross',
  'scanPineRising', 'scanPineFalling', 'scanPineSar', 'scanPineSarState', 'scanPineXsa', 'scanPineMa',
  'scanPineWaveTrend', 'scanPineCmMacd', 'scanPineBotMacd', 'scanPineMcdx', 'scanPineColorMa', 'scanPineSmaCross', 'scanPinePsar',
  'scanPineSrMa', 'scanPineBankerEntry', 'scanPineRsiStudy', 'scanMonthOf',
  /* the bot contract: conditions read on a higher timeframe (their last closed bar), and the reader's Multi-Timeframe Trading Bot as setups */
  'SCAN_TF_RANK', 'scanTimeframeRank', 'scanTimeframeWord', 'scanFrame', 'scanFrameAt', 'scanTreeNeeds',
  'SCAN_BOT_SIGNALS', 'scanBotCriteria', 'scanBotTree', 'scanBotPack', 'scanBotWarmup',
  /* imported weeks and months (history.frames): the engine's week key, which the store files an imported week under
     (ingest/history-store.mjs loadStoreEngine used to evaluate the region a second time to reach it), what the
     history holds for a symbol, the one builder of weekly and monthly bars, and a yes-or-no condition's literal */
  'scanWeekOf', 'scanFramesOf', 'scanFrameBars', 'scanFlagLiteral',
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
   file this worker writes goes the same way.

   ON WINDOWS a rename over a file another process has open fails (EPERM,
   EACCES or EBUSY) for as long as that handle is open — and the local server
   answering the operations pages, a --status in another window, or the lock
   holder reading the runs log while a run it turned away writes there, each
   hold one for a moment.
   A single attempt failed most runs made while the pages were being read:
   the alert record's write failed the run, the runs log's crashed it with
   the lock left behind. So the rename is retried for a few seconds before
   it gives up, and then says what usually holds a file. And copyFile carries
   a read-only attribute onto the .bak: once the reader cleared it on the
   file, every later write still failed, on the copy. The .bak is made
   writable before it is replaced and after it is written. */
const RENAME_RETRY = new Set(['EPERM', 'EACCES', 'EBUSY']);
export async function renameRetrying(from, to, { budgetMs = 3000 } = {}) {
  const until = Date.now() + budgetMs;
  for (let wait = 10; ; wait = Math.min(wait * 2, 250)) {
    try { return await rename(from, to); }
    catch (e) {
      if (!RENAME_RETRY.has(e.code)) throw e;
      if (Date.now() + wait > until) {
        throw Object.assign(new Error(`${e.message} — still refused after ${Math.round(budgetMs / 1000)} s: the file is read-only, or another program holds it open`), { code: e.code });
      }
      await new Promise(r => setTimeout(r, wait));
    }
  }
}
const ownerWritable = async (p) => {
  try { const st = await stat(p); if (!(st.mode & 0o200)) await chmod(p, st.mode | 0o200); } catch { /* absent */ }
};
export async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  try {
    if (existsSync(path)) {
      const bak = `${path}.bak`;
      await ownerWritable(bak);
      await copyFile(path, bak);
      await ownerWritable(bak);
    }
    await renameRetrying(tmp, path);
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
   the same, nothing it could record is new, and it returns skipped.

   ledgerPath is the version ledger (BAD_LEDGER when it cannot be read);
   catchUp evaluates the bars each pair missed since the ledger's record of
   it (a scheduled or manual run, and a retry — never a replay). ready holds
   back the markets that are not ready. narrow { setup, market } is a
   replay's narrowing (ARGS when it names nothing). watchlistsPath is the
   watchlist export an export-resolved universe reads. */
export async function runOnce({ E, setupsPath, historyPath, alertsPath, instrumentsPath, dry = false, now = new Date().toISOString(),
                                runId = `run-${now.replace(/[-:.]/g, '').slice(0, 15)}-${process.pid}`, origin = 'cli', trigger = 'manual',
                                asOf = null, truncateAt = null, unchangedKey = null, onRead = null,
                                ledgerPath = null, catchUp = false, ready = false, narrow = null, watchlistsPath = null, beforeWrite = null }) {
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
  /* @adjustments-start */
  /* The corporate actions the reader recorded — data/price-adjustments.json,
     beside the history and git-ignored — attached to the history, so the
     engine's scanBars applies them on read and nothing else here changes.
     No file is no adjustment (adjustmentVersion 'none'). A file that is not
     JSON stops the run: evaluating unadjusted prices the reader believes
     are adjusted would be a quiet wrong answer. An action the engine cannot
     read is left out and named in history.adjustmentProblems. */
  {
    const adjustmentsPath = join(dirname(historyPath), 'price-adjustments.json');
    let adjustmentsDoc = null;
    if (existsSync(adjustmentsPath)) {
      try { adjustmentsDoc = JSON.parse(await readFile(adjustmentsPath, 'utf8')); }
      catch (e) { throw fail('BAD_HISTORY', `${adjustmentsPath} is not valid JSON (${e.message}) — the adjustments recorded there cannot be applied, so nothing was evaluated`, 'DATA'); }
    }
    history = E.scanAttachAdjustments(history, adjustmentsDoc);
  }
  /* @adjustments-end */
  const historyHash = `sha256:${createHash('sha256').update(historyText).digest('hex').slice(0, 16)}`;
  /* A retry's cut comes first, so the newest bar this run reports is the
     newest it read. Taken from the whole file, a retry logged the file's
     newest bar as its own, and a retry of that retry cut the history there —
     a session neither run had evaluated — while saying it read the history
     "as the retried run read it". */
  if (truncateAt) history = E.scanTruncateHistory(history, truncateAt);
  const historyNewest = newestBar(history);
  onRead?.({ historyHash, historyNewest, setupsHash: E.scanSetupsHash(doc) });
  if (!historyNewest) throw fail('NO_DATA', truncateAt ? `${historyPath} holds no bar on or before ${truncateAt}` : `${historyPath} holds no bars`);
  if (asOf && !Object.values(history.series || {}).some(s => Object.keys(s || {}).some(d => d <= asOf))) {
    throw fail('NO_DATA', `no series in ${historyPath} holds a bar on or before ${asOf} (the first is later)`);
  }
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

  /* The versions the setups run under: the ledger resolves a hand edit's
     number and refuses a number reused for other content (left out, with
     the reason, so the run is PARTIAL). setupsHash above stays the file's
     own — the page compares it with the file it reads — and the resolved
     versions join the logical key below. */
  const ledger = ledgerPath ? await readLedger(ledgerPath) : null;
  const versions = ledger ? resolveVersions(setups, list, ledger, { now: new Date().toISOString() }) : null;
  let runSetups = versions ? versions.setups : setups;
  if (versions) problems.push(...versions.problems);

  /* A replay narrowed to one setup, or one market, says so when the setup
     or market is not there to narrow to, rather than evaluating nothing and
     calling it a quiet day. */
  if (narrow?.setup) {
    const keep = runSetups.filter(s => s.id === narrow.setup);
    /* A file that is not a list is refused whole, and no setup in it can be
       looked up: that read "no such setup … (have: none)", as though the
       file were read and the setup not in it. */
    if (!keep.length && !list) throw fail('ARGS', `--setup ${narrow.setup}: the setups file ${setupsPath} is refused whole — ${problems[0]} — so no setup in it can be replayed`, 'ARGS');
    if (!keep.length) {
      const refused = (versions?.refused || []).find(x => x.setupId === narrow.setup)?.why
        || (E.scanValidate(doc).problemsBySetup?.[narrow.setup] || []).map(p => `${p.path ? `${p.path}: ` : ''}${p.text}`).join('; ');
      throw fail('ARGS', refused ? `--setup ${narrow.setup} is refused: ${refused}` : `--setup ${narrow.setup}: no such setup in ${setupsPath} (have: ${runSetups.map(s => s.id).join(', ') || 'none'})`, 'ARGS');
    }
    if (keep[0].enabled === false) throw fail('ARGS', `--setup ${narrow.setup} is disabled in ${setupsPath} — enable it to replay it`, 'ARGS');
    runSetups = keep;
  }
  if (narrow?.market && !instruments.some(i => String(i?.market || '').toUpperCase() === narrow.market)) {
    throw fail('ARGS', `--market ${narrow.market}: no instrument in ${instrumentsPath || 'the registry'} is in that market (have: ${[...new Set(instruments.map(i => String(i?.market || '').toUpperCase()).filter(Boolean))].sort().join(', ') || 'none'})`, 'ARGS');
  }

  /* The watchlist export, when there is one. Absent or unreadable, an
     export-resolved setup falls back to its snapshot and the run says so. */
  const wl = await readWatchlists(watchlistsPath);

  /* The logical scan: the same engine, setups, history bytes and record
     cannot produce a new alert, so a second run on them is skipped rather
     than repeated — and says so. A replay or retry is asked for by name and
     is never skipped this way. The versions the ledger resolved, the price
     adjustments applied to the history (C6: history.adjustmentVersion, or
     none), the watchlist export, the ready gate and any narrowing are inputs
     too: any of them changed, the run is not the same run. */
  const resolvedHash = E.scanHash(runSetups.map(s => `${s.id}@${s.version}:${s.hash}:${s.enabled === false ? 0 : 1}`).join('\n'));
  const logicalKey = `${E.SCAN_VERSION}|${setupsHash}|${historyHash}|${E.scanHash(existing.map(a => a?.key || a?.id || '').sort().join('\n'))}|${asOf || truncateAt || 'live'}`
    + `|v:${resolvedHash}|adj:${history?.adjustmentVersion || 'none'}|wl:${wl.hash}|${ready ? 'ready' : 'all'}|${narrow ? `${narrow.setup || '*'}@${narrow.market || '*'}` : '-'}`;
  const base = { historyHash, historyNewest, setupsHash, logicalKey, problems, watchlists: wl };
  if (unchangedKey && unchangedKey === logicalKey) return { ...base, skipped: 'SKIPPED_NO_DATA' };

  /* The alerts are written in the engine's V2 shape (id, version, event,
     values, data version, run id), carrying the 0.2 fields — bar, rules,
     recordedAt — for one release, so this file's printout and
     ingest/daily.mjs keep reading them. */
  const r = E.scanRun(runSetups, history, { instruments, existing, now, runId, origin, asOf,
                                            pairs: catchUp && ledger ? ledger.pairs : null, ready,
                                            markets: narrow?.market ? [narrow.market] : null, watchlists: wl.doc });

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
                    cacheStats: r.cacheStats, catchUp: r.catchUp, skippedMarkets: r.skippedMarkets, universeResolvedFrom: r.universeResolvedFrom };
  const out = { engine: r.engine, updatedAt: now, lastRun, alerts: [...existing, ...r.alerts] };
  let written = false;
  if (!dry) {
    /* The last moment the run can still be cancelled: beforeWrite says
       whether to write, and after it the write is committed. */
    if (beforeWrite && beforeWrite() === false) throw fail('CANCELLED', 'cancelled before the alert record was written; nothing was written', 'CANCELLED');
    await mkdir(dirname(alertsPath), { recursive: true });
    await writeAtomic(alertsPath, JSON.stringify(out, null, 2) + '\n');
    written = true;
  }

  /* The ledger after the record: the versions this run evaluated are
     appended, and — for a run that catches up — each pair moves forward to
     the bar it now stands on. Written after the alerts, so a failure here
     loses nothing: the next run numbers the same versions the same way and
     re-evaluates bars the record already holds, which add nothing. */
  let ledgerWritten = false, ledgerError = null, pairsMoved = 0;
  if (!dry && ledger) {
    try {
      ledger.versions.push(...versions.newVersions);
      if (catchUp) pairsMoved = advancePairs(ledger, r.pairs, { runId, at: new Date().toISOString() });
      if (versions.newVersions.length || pairsMoved || !existsSync(ledgerPath)) await writeLedger(ledgerPath, ledger);
      ledgerWritten = true;
    } catch (e) { ledgerError = `the version ledger ${ledgerPath} could not be written (${e.message}); the alerts are recorded, and the next run numbers the same versions the same way`; }
  }
  const warn = problems.length > 0 || setupLevel.length > 0 || untestedEverywhere.length > 0
    || (r.watchlistFallbacks || []).length > 0 || (r.skippedMarkets || []).length > 0 || !!ledgerError;
  /* The setups left out, counted as setups: the entries validation refused
     (two sharing an id are two) and the versions the ledger refused. The
     output counted the problems, and one setup can have several — a setup
     with a bad timeframe and a bad group logic was "2 left out" of a file
     whose other setup ran, beside --status's "1 refused". A file that is not
     a list is refused whole: how many setups it meant to hold is not known,
     so it is no count (null) and the reason. */
  const leftOut = { setups: list ? list.length - setups.length + (versions?.refused.length || 0) : null, file: list ? null : problems[0] || null };
  return { ...base, result: r, setupLevel, untestedEverywhere, out, written, warn, existingCount: existing.length,
           versions, ledgerWritten, ledgerError, pairsMoved, leftOut };
}

/* ---------------------------------------------------------------- ledger -- */
/* THE VERSION LEDGER (SC-306). The setups file is the reader's, exported by
   the builder or edited by hand, and a hand edit carries no version — so
   before this, an edited rule ran as "v1" again, and its alerts claimed a
   version whose rule no longer stood. data/scan-ledger.json is the worker's
   own record of every version it has evaluated, which makes the file enough
   on its own:

   - a version and content the ledger holds is known;
   - a version it has not seen (the builder's export) is added, source
     'export';
   - a version it holds with DIFFERENT content is refused — the setup is left
     out and the run is PARTIAL — because one number for two rules is the
     one thing a version must never be;
   - a setup with no version (written by hand) is numbered by its content:
     content the ledger holds takes that version back (the newest, if an
     export reused it), and new content the next number, source 'file-edit'.

   Entries are appended, never removed or rewritten, and the worker never
   rewrites the reader's setups file. `pairs` beside them is the catch-up
   state (the engine's scanPairKey → the bar that pair was last evaluated
   on), which only moves forward. A damaged ledger fails the run instead of
   being started again: a new one would number hand edits from v1 again. */
export const LEDGER_NOTE = 'Append-only: every version of every setup this worker has evaluated, and the bar each setup × instrument pair was last evaluated on (catch-up). Written by scanner/scan.mjs; not for editing by hand.';
const emptyLedger = () => ({ schema: 1, versions: [], pairs: {} });

export async function readLedger(path) {
  if (!path || !existsSync(path)) return emptyLedger();
  let d;
  try { d = await readJson(path); }
  catch (e) {
    throw fail('BAD_LEDGER', `the version ledger ${path} is not valid JSON (${e.message}). It is not started again quietly — a new ledger would number hand-edited setups from v1 again${existsSync(`${path}.bak`) ? `. The copy before the last write is ${path}.bak` : ''}`, 'IO');
  }
  return { ...d, schema: 1, versions: Array.isArray(d?.versions) ? d.versions : [],
           pairs: d?.pairs && typeof d.pairs === 'object' && !Array.isArray(d.pairs) ? d.pairs : {} };
}

/* The evaluation fields a ledger entry keeps, so a version can be shown
   after the browser that made it is cleared. The name is kept beside them
   for reading; it does not change the hash. */
const evaluationFields = (s) => ({ name: s.name, timeframe: s.timeframe, universe: s.universe, confirmationMode: s.confirmationMode,
                                   cooldownMode: s.cooldownMode, cooldownBars: s.cooldownBars, expires: s.expires, ruleTree: s.ruleTree });

/* The validated setups, each with the version it runs under. `rawList` is
   the file's own list, which says whether a version was written at all
   (validation fills in 1 when it was not). */
export function resolveVersions(setups, rawList, ledger, { now = new Date().toISOString() } = {}) {
  const raw = new Map();
  (Array.isArray(rawList) ? rawList : []).forEach(x => { if (x && typeof x === 'object' && typeof x.id === 'string') raw.set(x.id, x); });
  const out = { setups: [], known: 0, newVersions: [], refused: [], problems: [] };
  for (const s of setups || []) {
    const mine = (ledger?.versions || []).filter(v => v && v.setupId === s.id);
    const max = mine.reduce((m, v) => Math.max(m, Number.isInteger(v.version) ? v.version : 0), 0);
    const entry = (version, source) => ({ setupId: s.id, version, hash: s.hash, firstSeenAt: now, source, setup: evaluationFields(s) });
    if (raw.get(s.id)?.version != null) {
      const at = mine.find(v => v.version === s.version);
      if (at && at.hash !== s.hash) {
        const why = `version ${s.version} of ${s.id} is already recorded with different content (hash ${at.hash}, first seen ${at.firstSeenAt || 'at a time not recorded'}; this file's is ${s.hash}) — save it again in the builder, or remove its "version" field and the worker numbers it v${max + 1}`;
        out.refused.push({ setupId: s.id, version: s.version, recordedHash: at.hash, hash: s.hash, why });
        out.problems.push(`${s.id}: ${why}`);
        continue;
      }
      if (at) out.known++; else out.newVersions.push(entry(s.version, 'export'));
      out.setups.push(s);
    } else {
      const same = mine.filter(v => v.hash === s.hash).sort((a, b) => b.version - a.version)[0];
      if (same) { out.known++; out.setups.push({ ...s, version: same.version }); }
      else { out.newVersions.push(entry(max + 1, 'file-edit')); out.setups.push({ ...s, version: max + 1 }); }
    }
  }
  return out;
}

/* Each pair moves forward to the bar this run evaluated it on, never back:
   a run whose last final bar is older (a provisional bar held back) leaves
   the newer mark. Returns how many moved. */
export function advancePairs(ledger, pairs, { runId = null, at = null } = {}) {
  let moved = 0;
  for (const [k, v] of Object.entries(pairs || {})) {
    const cur = ledger.pairs[k]?.lastEvaluatedBar;
    if (v?.lastEvaluatedBar && (!cur || v.lastEvaluatedBar > cur)) { ledger.pairs[k] = { lastEvaluatedBar: v.lastEvaluatedBar, runId, at }; moved++; }
  }
  return moved;
}

export async function writeLedger(path, ledger) {
  const doc = { schema: 1, kind: 'quantum-tradeworks-scan-ledger', note: LEDGER_NOTE, updatedAt: new Date().toISOString(),
                versions: ledger.versions, pairs: ledger.pairs };
  await writeAtomic(path, JSON.stringify(doc, null, 1) + '\n');
}

/* The watchlist export the builder's "resolve from the export" reads — the
   watchlists page's "Export for the scanner", in watchlistsExport()'s shape.
   Returned as the document (null when there is no file; {} when it is not
   JSON, which the engine names as "not a watchlists export"), a hash for the
   logical key, and a sentence when it could not be used. */
export async function readWatchlists(path) {
  if (!path || !existsSync(path)) return { doc: null, hash: 'none', path, why: null };
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (e) { return { doc: {}, hash: 'unreadable', path, why: `${path} could not be read (${e.message})` }; }
  const hash = `sha256:${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
  try {
    const d = JSON.parse(text);
    if (!Array.isArray(d?.watchlists)) return { doc: {}, hash, path, why: `${path} is not a watchlists export (no "watchlists" list)` };
    return { doc: d, hash, path, why: null };
  } catch (e) { return { doc: {}, hash, path, why: `${path} is not valid JSON (${e.message})` }; }
}

/* --------------------------------------------------------- worker files -- */

/* Beside the alert record the lock protects — so a test that points
   --alerts at a temporary folder never touches the repository's files. */
export const WORKER_FILES = { runs: 'scan-runs.json', lock: 'scan.lock', control: 'scan-control.json', deliveries: 'scan-deliveries.json', ledger: 'scan-ledger.json' };
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

/* A damaged log is not a reason to stop scanning: the writer (updateRuns,
   under the log's lock) sets it aside (the .bak holds the previous good
   copy) and starts a new one whose first audit entry is the reset. Every
   other reader — --runs, --status, a retry looking up its run — is handed
   `damaged` and says so. Those readers used to set the log aside too: the
   read-only commands moved the file, printed "no runs logged", and the
   reset's audit entry was never written, because the next writer found no
   file at all. */
export async function readRunsDoc(path, { setAside = false } = {}) {
  if (!existsSync(path)) return emptyRuns();
  try {
    const d = await readJson(path);
    return { ...d, schema: 1, runs: Array.isArray(d?.runs) ? d.runs : [], audit: Array.isArray(d?.audit) ? d.audit : [] };
  } catch (e) {
    const why = `the run log ${path} ${e instanceof SyntaxError ? 'is not valid JSON' : 'could not be read'} (${e.message})`;
    if (!setAside) return { ...emptyRuns(), damaged: why };
    const aside = `${path}.damaged-${Date.now()}`;
    await renameRetrying(path, aside);
    return { ...emptyRuns(), audit: [{ at: new Date().toISOString(), action: 'runs-log-reset', detail: { setAside: aside, why } }] };
  }
}
const runsDamagedText = (doc, path) => `${doc.damaged}. Nothing in it can be read here; the next run sets it aside as ${path}.damaged-<time> and starts a new log${existsSync(`${path}.bak`) ? `, and ${path}.bak holds the copy before its last write` : ''}.`;

/* Read, change and write the runs log under its own short lock: a run
   holding the scan lock and a run being turned away both write to it. */
export async function updateRuns(path, fn) {
  await mkdir(dirname(path), { recursive: true });
  return withLock(`${path}.lock`, async () => {
    const doc = await readRunsDoc(path, { setAside: true });
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
  /* Read as not paused, and said wherever it is read: --status printed
     "not paused" for a file it could not read. */
  catch (e) { return { schema: 1, paused: false, damaged: `the control file ${path} is not valid JSON (${e.message}), so it is read as not paused; --pause or --resume writes it afresh` }; }
}

/* The in-app delivery record: one row per alert, the channels block
   rewritten every time. `alerts` are this run's new alerts, each given a row
   under this run.

   `record` is the whole alert record as this run wrote it. An alert in it
   with no row is one whose run wrote it to the record and then could not
   write its row — the delivery record held open or read-only for longer
   than the rename waits, or the run killed between the two writes. Every
   run wrote rows for its own new alerts only, so that row was never written
   by any later run, and the record held no row for an alert the app showed
   while the pages said it held one per alert. It is written now: under the
   run that recorded the alert, dated when that run recorded it (the alert's
   recordedAt — the moment it reached the record the app reads, which is
   what IN_APP SENT means), with backfilledBy and backfilledAt naming the
   run that wrote the row and when. Past the cap the oldest rows are
   dropped, so an alert older than the oldest row kept is not owed one: it
   had its row, and the cap took it. Returns { added, backfilled }. */
export async function writeDeliveries(path, alerts, { runId, now = new Date().toISOString(), record = null } = {}) {
  let doc = { schema: 1, deliveries: [] };
  if (existsSync(path)) {
    try { const d = await readJson(path); if (Array.isArray(d?.deliveries)) doc = d; }
    catch (e) {
      /* A record that is not JSON is set aside, as a damaged runs log is,
         before a new one is begun. Rewritten in place, the damaged copy
         became the .bak and the good copy the .bak held was lost — the
         opposite of what this said. One that cannot be read at all is a
         record that cannot be written either: the run says so (PARTIAL). */
      if (!(e instanceof SyntaxError)) throw e;
      await renameRetrying(path, `${path}.damaged-${Date.now()}`);
    }
  }
  const have = new Set(doc.deliveries.map(x => x?.id));
  const mine = new Set(alerts.map(a => a?.id));
  const floor = doc.deliveries.length >= DELIVERIES_CAP ? String(doc.deliveries[0]?.sentAt || '') : '';
  let added = 0, backfilled = 0;
  for (const a of Array.isArray(record) ? record : []) {
    if (!a || typeof a.id !== 'string' || mine.has(a.id) || have.has(`${a.id}:IN_APP`) || String(a.recordedAt || '') < floor) continue;
    doc.deliveries.push({ id: `${a.id}:IN_APP`, alertId: a.id, alertKey: a.key, channel: 'IN_APP', status: 'SENT', attemptCount: 1, sentAt: a.recordedAt || now, runId: a.runId ?? null,
                          setupId: a.setupId, symbol: a.symbol, candleDate: a.candleDate || a.bar, backfilledBy: runId, backfilledAt: now });
    have.add(`${a.id}:IN_APP`);
    backfilled++;
  }
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
  return { added, backfilled };
}

/* --------------------------------------------------------- run records -- */

function newRunId(now) { return `run-${now.replace(/[-:.]/g, '').slice(0, 15)}-${process.pid}-${randomBytes(2).toString('hex')}`; }

/* Round 3 adds, on every run whatever its status (null until the run
   evaluates): cacheStats, the indicator cache's hits and misses (until now
   only in the alerts file's lastRun); skippedMarkets, the markets the ready
   gate held back, each [{ market, reason, state, status, instruments,
   setups }]; catchUp { pairs, bars, capped, cap }, the bars evaluated since
   each pair's last evaluated bar (null when the run does not catch up — a
   replay); ledger { known, newVersions, refused }, the version ledger's
   outcome; universeResolvedFrom, per watchlist setup, which membership it
   read; ready and narrow, what was asked for. */
function makeRun({ id, trigger, origin, now, args, retryOf = null, replayAsOf = null, paths, ready = false, narrow = null }) {
  const at = new Date().toISOString();
  return { id, kind: 'scan', trigger, origin, status: 'PENDING', startedAt: at, finishedAt: null, durationMs: null, exitCode: null,
           now, replayAsOf, retryOf, engine: null, pid: process.pid, host: hostname(), operator: operator(), args,
           files: { setups: paths.setups, history: paths.history, alerts: paths.alerts, ...(paths.watchlists ? { watchlists: paths.watchlists } : {}), ...(paths.ledger ? { ledger: paths.ledger } : {}) },
           historyHash: null, historyNewest: null, setupsHash: null, logicalKey: null,
           asOf: null, asOfFrom: null, counts: null, readiness: [], stale: 0, provisional: 0, errors: [], error: null, skipReason: null,
           ready, narrow, cacheStats: null, skippedMarkets: [], catchUp: null, ledger: null, universeResolvedFrom: [],
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
  /* A run that has ended stays ended: a signal can close it while the scan
     is between two awaits, and the scan must not then mark it RUNNING. */
  if (run.finishedAt && ['PENDING', 'RUNNING'].includes(status)) return;
  run.status = status;
  run.transitions.push({ status, at: new Date().toISOString() });
  if (!['PENDING', 'RUNNING'].includes(status)) {
    run.finishedAt = new Date().toISOString();
    run.durationMs = Math.max(0, Date.parse(run.finishedAt) - Date.parse(run.startedAt));
    run.exitCode = EXIT_CODES[status];
  }
}

/* A run a dead process left PENDING or RUNNING is closed, never left to
   look as though it were still going. `why` is the lock's verdict ('dead',
   'stale') or 'forced' — --unlock --force on a lock whose process, as far as
   this machine could tell, was still running, which --unlock used to record
   as "its process ended". `unlocked` is true when --unlock removed the lock
   rather than a run taking it over. */
function closeOrphan(doc, holder, why, { unlocked = false } = {}) {
  const orphan = holder?.runId ? doc.runs.find(r => r.id === holder.runId) : null;
  if (!orphan || !['PENDING', 'RUNNING'].includes(orphan.status)) return null;
  const at = new Date().toISOString();
  orphan.status = 'FAILED';
  orphan.transitions = [...(orphan.transitions || []), { status: 'FAILED', at }];
  orphan.finishedAt = at;
  orphan.durationMs = Math.max(0, Date.parse(at) - Date.parse(orphan.startedAt));
  orphan.exitCode = 1;
  const proc = `its process (pid ${holder.pid} on ${holder.host})`;
  const message = why === 'forced'
    ? `the lock was removed with --unlock --force while ${proc} still answered as running, so how this run ended is not known here`
    : `${proc} ${why === 'dead' ? 'ended' : 'held the lock for over an hour'} before the run finished; the lock was ${unlocked ? 'removed with --unlock' : why === 'dead' ? 'taken over' : 'taken over as stale'}`;
  const e = { category: 'ABANDONED', message, correlationId: `${orphan.id}/e${(orphan.errors || []).length + 1}` };
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

/* The flags that take a value, and would otherwise fall back to their
   default when it is missing: --as-of with no date ran a live scan that
   recorded and caught up, --data with no folder read and wrote the
   repository's own files, --now with no instant took the real clock.
   --retry, --setup, --market and --backtest print their own usage below;
   --pause's reason and --runs' count are optional. */
const VALUE_FLAGS = ['data', 'setups', 'history', 'alerts', 'instruments', 'html', 'watchlists', 'now', 'as-of', 'trigger', 'from', 'to', 'symbols', 'hold'];

async function main() {
  const argv = process.argv.slice(2);
  const { has, flag } = parseArgs(argv);
  const valueless = VALUE_FLAGS.filter(f => has(f) && flag(f, null) == null);
  if (valueless.length) {
    console.error(`${valueless.map(f => `--${f}`).join(', ')} ${valueless.length === 1 ? 'needs a value' : 'need values'} — nothing was run. The usage is the comment at the top of scanner/scan.mjs.`);
    process.exit(1);
  }

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
  /* The watchlist export lives beside the setups it serves — data/ by
     default — so a test that points --setups at a temporary folder never
     reads the reader's own export. */
  const watchlistsPath = flag('watchlists', null) ? resolve(flag('watchlists')) : dataDir ? join(dataDir, 'watchlists.json') : join(dirname(setupsPath), 'watchlists.json');

  /* --now ISO: judge staleness and bar status as though the clock read this
     instant. For tests on fixed fixtures; a real run takes the clock. */
  const nowFlag = flag('now', null);
  if (nowFlag != null && !Number.isFinite(Date.parse(nowFlag))) { console.error(`--now "${nowFlag}" is not a date-time`); process.exit(1); }
  const now = nowFlag != null ? new Date(Date.parse(nowFlag)).toISOString() : new Date().toISOString();

  /* ------------------------------------------ commands that need no engine */
  /* A file these commands cannot write is said in a sentence and exit 1 —
     it was an unhandled rejection with a stack trace. */
  const cannot = (what, e) => { console.error(`${what}: ${e.message}`); process.exit(1); };
  if (has('pause') || has('resume')) {
    const ctl = await readControl(W.control);
    if (ctl.damaged) console.log(ctl.damaged);
    if (has('pause')) {
      const reason = flag('pause', null);
      if (ctl.paused) { console.log(`already paused since ${ctl.since}${ctl.reason ? ` — ${ctl.reason}` : ''}`); process.exit(0); }
      const next = { schema: 1, paused: true, since: new Date().toISOString(), reason, by: operator(), updatedAt: new Date().toISOString() };
      await writeAtomic(W.control, JSON.stringify(next, null, 2) + '\n').catch(e => cannot(`not paused — the control file ${W.control} could not be written`, e));
      await updateRuns(W.runs, (doc) => { doc.audit.push(auditEntry('pause', { reason })); }).catch(e => cannot(`paused, but the pause could not be recorded in the run log ${W.runs}`, e));
      console.log(`paused${reason ? ` — ${reason}` : ''}. Every run is now logged SKIPPED_PAUSED and exits 3 until: node scanner/scan.mjs --resume`);
    } else {
      /* A damaged control file is written afresh, not paused. */
      if (!ctl.paused && !ctl.damaged) { console.log('not paused — nothing to resume'); process.exit(0); }
      const next = { schema: 1, paused: false, since: null, reason: null, resumedAt: new Date().toISOString(), by: operator(), lastPause: { since: ctl.since || null, reason: ctl.reason || null }, updatedAt: new Date().toISOString() };
      await writeAtomic(W.control, JSON.stringify(next, null, 2) + '\n').catch(e => cannot(`not resumed — the control file ${W.control} could not be written`, e));
      await updateRuns(W.runs, (doc) => { doc.audit.push(auditEntry('resume', { pausedSince: ctl.since || null, reason: ctl.reason || null })); }).catch(e => cannot(`resumed, but the resume could not be recorded in the run log ${W.runs}`, e));
      console.log(ctl.paused ? `resumed (paused since ${ctl.since || '—'}). The next run evaluates as usual.` : `the control file is written afresh, not paused. The next run evaluates as usual.`);
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
    await rm(W.lock, { force: true }).catch(e => cannot(`the lock ${W.lock} could not be removed`, e));
    await updateRuns(W.runs, (doc) => {
      const closed = closeOrphan(doc, holder, why || 'forced', { unlocked: true });
      doc.audit.push(auditEntry('unlock', { previous: holder, why: why || 'forced', forced: !why, closedRun: closed }));
    }).catch(e => cannot(`the lock is removed, but the removal could not be recorded in the run log ${W.runs}`, e));
    console.log(`lock removed${holder ? ` (pid ${holder.pid} since ${holder.startedAt}; ${why || 'forced'})` : ' (it was unreadable)'}; recorded in ${W.runs}`);
    process.exit(0);
  }
  if (has('runs')) {
    const n = Math.max(1, Number(flag('runs', 10)) || 10);
    const doc = await readRunsDoc(W.runs);
    if (doc.damaged) { console.error(runsDamagedText(doc, W.runs)); process.exit(1); }
    const last = doc.runs.slice(-n);
    if (has('json')) { console.log(JSON.stringify({ runs: last, audit: doc.audit.slice(-n) }, null, 2)); process.exit(0); }
    if (!doc.runs.length) { console.log(`no runs logged in ${W.runs}`); process.exit(0); }
    console.log(`last ${last.length} of ${doc.runs.length} run(s) — ${W.runs}\n`);
    for (const r of last.slice().reverse()) {
      const c = r.counts || {};
      console.log(`  ${r.startedAt}  ${r.status.padEnd(17)} ${String(r.trigger || '').padEnd(7)} ${String(r.durationMs ?? '—').padStart(6)} ms  ${r.id}`);
      if (r.counts) console.log(`      ${c.evaluated} evaluated · ${c.matched} matched · ${c.recorded} recorded · ${c.deduped} already recorded${r.asOf ? ` · bars ${r.asOfFrom && r.asOfFrom !== r.asOf ? `${r.asOfFrom} … ` : ''}${r.asOf}` : ''}${r.replayAsOf ? ` · replay of ${r.replayAsOf}` : ''}${r.retryOf ? ` · retry of ${r.retryOf}` : ''}`);
      if (r.catchUp?.pairs || r.catchUp?.capped) console.log(`      caught up ${r.catchUp.bars} missed bar(s) on ${r.catchUp.pairs} pair(s)${r.catchUp.capped ? `; ${r.catchUp.capped} pair(s) past the ${r.catchUp.cap}-bar cap` : ''}`);
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
    /* A file that is there but cannot be read is said, never shown as
       absent or empty: an unreadable setups file printed "no setups file",
       an unreadable alert record "0 matches", and neither said that the
       next run fails on it. */
    const unreadable = [];
    const readOr = async (p, what) => {
      if (!existsSync(p)) return null;
      try { return await readJson(p); }
      catch (e) { unreadable.push({ what, file: p, why: `${p} ${e instanceof SyntaxError ? 'is not valid JSON' : 'could not be read'} (${e.message})`, blocksRun: true, bak: existsSync(`${p}.bak`) ? `${p}.bak` : null }); return null; }
    };
    const alertsDoc = await readOr(alertsPath, 'alerts');
    const setupsDoc = await readOr(setupsPath, 'setups');
    const history = await readOr(historyPath, 'history');
    let instruments = [];
    try { const reg = await readJson(instrumentsPath); instruments = Array.isArray(reg) ? reg : (reg?.instruments || []); } catch { /* none */ }
    if (runsDoc.damaged) unreadable.push({ what: 'runs', file: W.runs, why: runsDoc.damaged, blocksRun: false, bak: existsSync(`${W.runs}.bak`) ? `${W.runs}.bak` : null });
    if (control.damaged) unreadable.push({ what: 'control', file: W.control, why: control.damaged, blocksRun: false, bak: null });
    const bad = (what) => unreadable.find(u => u.what === what);
    const historyMeta = history ? { symbols: Object.keys(history.series || {}), newestBar: newestBar(history) } : null;
    const st = E.scanStatus({ runs: runsDoc, alertsDoc, setupsDoc, historyMeta, control, now, instruments });
    let lock = null; try { lock = existsSync(W.lock) ? await readJson(W.lock) : null; } catch { lock = { unreadable: true }; }
    if (has('json')) { console.log(JSON.stringify({ status: st, control, lock, unreadable, channels: CHANNELS, files: { ...W, alerts: alertsPath, setups: setupsPath, history: historyPath } }, null, 2)); process.exit(0); }
    /* A run's bars are the range it evaluated (asOfFrom … asOf), as the
       dashboard and --runs print them. Only the newest was named, so a run
       that caught up a missed day read "bars of 2026-04-06" beside a match
       it recorded on 2026-04-03. */
    const d = (r) => (r ? `${r.status} ${r.finishedAt || r.startedAt || ''}${r.id ? ` (${r.id})` : runsDoc.damaged ? ' (from the alerts file — the run log is not readable)' : ' (from the alerts file — before the run log)'}${r.asOf ? `, bars of ${E.scanBarRange(r.asOfFrom, r.asOf)}` : ''}` : 'none');
    const blocking = unreadable.filter(u => u.blocksRun);
    console.log(`scanner    ${st.state.toUpperCase()}${blocking.length ? ' — but a run fails until a file it reads is repaired' : ''}`);
    blocking.forEach(u => console.log(`           A run fails on it: ${u.why}${u.bak ? `; ${u.bak} holds the copy before its last write` : ''}.`));
    st.reasons.forEach(x => console.log(`           ${x}`));
    /* A file that is not a list is refused whole: scanStatus gives no count
       of refused setups for it (refused null — how many it meant to hold is
       not known) and the reason in fileRefused. Only the count was printed,
       so such a file read "0 enabled of 0 valid" and nothing more, as though
       it held no setup rather than being one the worker cannot read. */
    console.log(bad('setups') ? `setups     not known — ${bad('setups').why}`
      : `setups     ${st.active.enabled} enabled of ${st.active.valid} valid${st.active.expired ? `, ${st.active.expired} expired` : ''}${st.active.fileRefused ? ` — the whole file is refused: ${st.active.fileRefused}` : st.active.refused ? `, ${st.active.refused} refused` : ''}${setupsDoc ? '' : ` — no setups file at ${setupsPath}`}`);
    if (bad('history')) console.log(`history    not known — ${bad('history').why}`);
    if (st.monitored) console.log(`watching   ${st.monitored.instruments} instrument(s) with a series${st.monitored.missing.length ? `; ${st.monitored.missing.length} named but not in your history` : ''}`);
    if (runsDoc.damaged) console.log(`runs log   ${runsDamagedText(runsDoc, W.runs)}`);
    console.log(`last ok    ${d(st.lastSuccess)}`);
    console.log(`last try   ${d(st.lastAttempt)}`);
    /* The last scan's matches are those on any bar it evaluated — a caught-
       up day's among them — so they are counted over its range of bars, as
       the dashboard heads them. With no successful scan there is no last
       run to have matched on: that read "0 on the last successful run's
       bar" beside "last ok none", an absence shown as a zero. */
    const ls = st.lastSuccess;
    console.log(bad('alerts') ? `matches    not known — ${bad('alerts').why}`
      : ls ? `matches    ${st.latestMatches.length} on the last successful run's bars (${E.scanBarRange(ls.asOfFrom, ls.asOf)})`
      : 'matches    none to show — no scan has succeeded, so there is no last run to have matched');
    console.log(`control    ${control.paused ? `PAUSED since ${control.since}${control.reason ? ` — ${control.reason}` : ''} (node scanner/scan.mjs --resume)` : control.damaged ? `not known — ${control.damaged}` : 'not paused'}`);
    console.log(`lock       ${lock ? (lock.unreadable ? 'present but unreadable' : `held by pid ${lock.pid} on ${lock.host} since ${lock.startedAt}${lock.runId ? ` (${lock.runId})` : ''}`) : 'free'}`);
    console.log(`channels   in-app ACTIVE (the alert record); ${Object.entries(CHANNELS).filter(([, c]) => c.status !== 'ACTIVE').map(([k]) => k.toLowerCase()).join(', ')} NOT CONFIGURED — no server, no contact address held`);
    console.log('unread     not known here: read and archived marks live in the browser');
    console.log('timeframe  daily, weekly and monthly (weekly and monthly built from daily) — intraday bars need a licensed feed (SC-317)');
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
    /* The splits the reader recorded apply here as they do in a scan and on
       the page's simulation. Read raw, the command disagreed with the page
       about the same setup on any series with a recorded split. A file that
       is not JSON stops it, as it stops a scan. */
    {
      const adjustmentsPath = join(dirname(historyPath), 'price-adjustments.json');
      let adjustmentsDoc = null;
      if (existsSync(adjustmentsPath)) {
        try { adjustmentsDoc = await readJson(adjustmentsPath); }
        catch (e) { console.error(`${adjustmentsPath} is not valid JSON (${e.message}) — the adjustments recorded there cannot be applied`); process.exit(1); }
      }
      history = E.scanAttachAdjustments(history, adjustmentsDoc);
    }
    try { const reg = await readJson(instrumentsPath); instruments = Array.isArray(reg) ? reg : (reg?.instruments || []); } catch { /* none */ }
    const v = E.scanValidate(doc);
    let setup = v.setups.find(s => s.id === id);
    /* A file that is not a list is refused whole; it read "no setup … (have:
       none)", as though the file were read and the setup not in it. */
    if (!setup && !Array.isArray(doc) && !Array.isArray(doc?.setups)) {
      console.error(`the setups file ${setupsPath} is refused whole — ${v.problems[0]} — so no setup in it can be simulated`);
      process.exit(1);
    }
    if (!setup) {
      const why = v.problemsBySetup?.[id];
      console.error(why ? `setup "${id}" is refused:\n${why.map(p => `  · ${p.path ? `${p.path}: ` : ''}${p.text}`).join('\n')}` : `no setup "${id}" in ${setupsPath} (have: ${v.setups.map(s => s.id).join(', ') || 'none'})`);
      process.exit(1);
    }
    /* The version the worker runs it under, from the ledger (read, never
       written here). Validation numbers a setup with no "version" 1, so a
       hand-edited setup the worker records as v2 was simulated and printed
       as v1. */
    let ledgerNote = null;
    try {
      const rv = resolveVersions([setup], Array.isArray(doc) ? doc : doc?.setups, await readLedger(W.ledger));
      if (rv.setups[0]) setup = rv.setups[0]; else ledgerNote = `the worker leaves this setup out of every run: ${rv.refused[0]?.why}`;
    } catch (e) { ledgerNote = `${e.message} — the version below is the file's own`; }
    const symbols = flag('symbols', null) ? flag('symbols').split(',').map(s => s.trim()).filter(Boolean) : null;
    const h = E.scanHistorical(setup, history, { symbols, from: flag('from', null), to: flag('to', null), instruments });
    if (has('json')) { console.log(JSON.stringify(ledgerNote ? { ...h, ledgerNote } : h, null, 2)); process.exit(0); }
    console.log(`HISTORICAL MATCHES — a simulation, not a backtest of returns`);
    console.log(`setup      ${setup.id} v${setup.version} (${setup.cooldownMode}${setup.cooldownBars ? `, cooldown ${setup.cooldownBars} bars` : ''}) on ${h.timeframe}`);
    if (ledgerNote) console.log(`ledger     ${ledgerNote}`);
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
  /* --ready holds back the markets that are not ready (ingest/daily.mjs
     passes it). --setup and --market narrow a replay only: a scheduled or
     manual run narrowed to one setup would leave every other pair behind
     with nothing in the record saying so, and a retry re-runs the logged
     run exactly as it was asked for. */
  let ready = has('ready');
  const setupFlag = flag('setup', null), marketFlag = flag('market', null);
  if ((has('setup') && !setupFlag) || (has('market') && !marketFlag)) { console.error('usage: node scanner/scan.mjs --as-of YYYY-MM-DD [--setup ID] [--market CODE]'); process.exit(1); }
  if ((setupFlag || marketFlag) && (!asOfFlag || retryId)) {
    console.error(`--setup and --market narrow a replay (--as-of DATE); ${retryId ? 'a retry re-runs the logged run as it was asked for' : 'a scheduled or manual run evaluates every setup on every market'}`);
    process.exit(1);
  }
  /* For the same reason a retry takes no date and no gate of its own: its
     run's replay date, ready gate and narrowing come with it. --as-of beside
     --retry replayed that date while the output said the retry read the
     logged run's history cut and clock. */
  if (retryId && (asOfFlag || ready)) {
    console.error(`--retry re-runs the logged run as it was asked for — its replay date, its ready gate and its narrowing come with it; ${asOfFlag ? '--as-of' : '--ready'} is not taken beside it`);
    process.exit(1);
  }
  let narrow = setupFlag || marketFlag ? { setup: setupFlag, market: marketFlag ? marketFlag.toUpperCase() : null } : null;

  if (check || dry) {
    if (engineError) engineFailureText(engineError);
    if (engineError) process.exit(1);
    if (!selfTest(E)) process.exit(1);
    if (check) process.exit(0);
  }

  const runId = newRunId(now);
  const run = makeRun({ id: runId, trigger, origin, now, args: argv, replayAsOf: asOfFlag, retryOf: retryId, ready, narrow,
                        paths: { setups: setupsPath, history: historyPath, alerts: alertsPath, watchlists: watchlistsPath, ledger: W.ledger } });
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
                                                 setup: run.narrow?.setup || null, market: run.narrow?.market || null,
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
     write has begun the run is allowed to finish, so it is never
     half-recorded.

     The write begins at one instant, beforeWrite below, which runOnce calls
     just before it writes the record: a signal handled before it closes the
     run and the write is refused; after it, the run finishes. `committed`
     used to be set only once runOnce had returned — after the record and
     the ledger were written — and nothing stopped the scan that carried on
     beside the handler, so a Ctrl+C during a run logged CANCELLED, "nothing
     was written", over an alert record the scan then wrote anyway, and its
     delivery rows with it. */
  const onSignal = async (sig) => {
    if (committed) { console.error(`\n${sig} received after the record was written — finishing the run`); return; }
    addError(run, 'CANCELLED', `${sig} received before the alert record was written; nothing was written`);
    await finish('CANCELLED');
  };
  const beforeWrite = () => { if (finished) return false; committed = true; return true; };
  if (!dry) { process.once('SIGINT', () => onSignal('SIGINT')); process.once('SIGTERM', () => onSignal('SIGTERM')); }

  if (engineError) { engineFailureText(engineError); addError(run, 'ENGINE', `the scan engine could not be loaded out of index.html: ${engineError.message}`); return finish('FAILED'); }
  run.engine = `scan ${E.SCAN_VERSION}`;

  /* The retry: the logged run's own session dates. */
  let asOf = asOfFlag, truncateAt = null, runNow = now;
  if (asOf && (!E.scanIsDay(asOf) || asOf > now.slice(0, 10))) return failWith('ARGS', `--as-of "${asOf}" is not a past date (YYYY-MM-DD)`);
  if (retryId) {
    const doc = await readRunsDoc(W.runs);
    if (doc.damaged) return failWith('IO', `run ${retryId} cannot be looked up: ${doc.damaged}. Logging this run sets it aside as ${W.runs}.damaged-<time> and starts a new log${existsSync(`${W.runs}.bak`) ? `; ${W.runs}.bak holds the copy before its last write` : ''}.`);
    const orig = doc.runs.find(r => r.id === retryId);
    if (!orig) return failWith('ARGS', `no run ${retryId} in ${W.runs} — node scanner/scan.mjs --runs lists them`);
    if (['PENDING', 'RUNNING'].includes(orig.status)) return failWith('ARGS', `run ${retryId} is still ${orig.status}; if its process is gone, node scanner/scan.mjs --unlock closes it first`);
    if (orig.replayAsOf) { asOf = orig.replayAsOf; run.replayAsOf = asOf; }
    else if (orig.historyNewest) { truncateAt = orig.historyNewest; runNow = orig.now || now; run.now = runNow; }
    /* The logged run's narrowing and ready gate come with it. */
    if (orig.narrow) { narrow = orig.narrow; run.narrow = narrow; }
    if (orig.ready) { ready = true; run.ready = true; }
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
    if (control.damaged) console.log(`control    ${control.damaged}`);
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
    /* A run log that cannot be written fails the run before it evaluates,
       and the lock is released on the way out. Unhandled, it crashed the
       worker with a stack trace and left the lock for the next run to take
       over. */
    try {
      await updateRuns(W.runs, (doc) => {
        if (got.takenOver) {
          const closed = closeOrphan(doc, got.takenOver.holder, got.takenOver.why);
          doc.audit.push(auditEntry('lock-takeover', { runId, previous: got.takenOver.holder, why: got.takenOver.why, closedRun: closed }));
        }
        doc.runs.push(run);
      });
    } catch (e) { return failWith('IO', `the run log ${W.runs} could not be written (${e.message}); nothing was evaluated`); }
    const hold = Number(flag('hold', 0));
    if (hold > 0) await sleep(hold);
    if (finished) return;
    if (!selfTest(E)) { addError(run, 'ENGINE', 'self-test failed — the engine extracted from index.html does not reproduce its fixture'); return finish('FAILED'); }
    setStatus(run, 'RUNNING');
    try { await saveRun(W.runs, run); }
    catch (e) { return failWith('IO', `the run log ${W.runs} could not be written (${e.message}); nothing was evaluated`); }
  }

  /* The last run that evaluated live: a live run with the same logical key
     is skipped as nothing new. */
  let unchangedKey = null, compared = null;
  if (!dry && trigger !== 'replay' && trigger !== 'retry') {
    const doc = await readRunsDoc(W.runs);
    compared = [...doc.runs].reverse().find(r => r.id !== runId && (r.status === 'COMPLETED' || r.status === 'PARTIAL') && r.logicalKey) || null;
    unchangedKey = compared?.logicalKey || null;
    run.comparedWith = compared?.id || null;
  }

  let out;
  try {
    /* Catch-up is for a run that moves forward — scheduled, manual, or the
       retry of one. A replay evaluates the date it was asked for, no more. */
    out = await runOnce({ E, setupsPath, historyPath, alertsPath, instrumentsPath, dry, now: runNow, runId, origin, trigger, asOf, truncateAt, unchangedKey,
                          ledgerPath: W.ledger, catchUp: !asOf, ready, narrow, watchlistsPath, beforeWrite: dry ? null : beforeWrite,
                          onRead: (x) => { run.historyHash = x.historyHash; run.historyNewest = x.historyNewest; run.setupsHash = x.setupsHash; } });
  } catch (err) {
    /* The signal's handler has closed the run and is exiting. */
    if (err.code === 'CANCELLED') return;
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
    /* A run on the same inputs records no new alert. But the run compared
       with may have written its alerts and then failed to write the version
       ledger (the versions it numbered, the bar each pair reached) or the
       delivery record, and a skipped run writes neither — so "a run on them
       records nothing new" was false then: a retry of that run wrote them.
       Whether such a run should evaluate rather than skip is not decided
       here. What is unwritten is said, with the run that writes it: the next
       run on new input, or a retry of that run now. */
    const unwritten = [compared?.ledger?.written === false ? 'the version ledger' : null,
                       (compared?.errors || []).some(e => e?.category === 'DELIVERY') ? 'the delivery record' : null].filter(Boolean);
    const it = unwritten.length > 1 ? 'them' : 'it';
    const text = unwritten.length
      ? `nothing changed since ${run.comparedWith}: the same engine, setups, history and alert record, so a run on them records no new alert — but ${run.comparedWith} could not write ${unwritten.join(' or ')}, and a skipped run writes nothing. The next scheduled or manual run on new input writes ${it}; node scanner/scan.mjs --retry ${run.comparedWith} writes ${it} now`
      : `nothing changed since ${run.comparedWith}: the same engine, setups, history and alert record — a run on them records nothing new`;
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
  /* C4: what the ops pages read off the run itself. */
  run.cacheStats = r.cacheStats || null;
  run.catchUp = r.catchUp || null;
  run.skippedMarkets = r.skippedMarkets || [];
  run.universeResolvedFrom = r.universeResolvedFrom || [];
  run.ledger = out.versions ? { known: out.versions.known, newVersions: out.versions.newVersions.map(v => ({ setupId: v.setupId, version: v.version, hash: v.hash, source: v.source })),
                                refused: out.versions.refused.map(x => ({ setupId: x.setupId, version: x.version, why: x.why })), written: out.ledgerWritten } : null;
  if (r.narrowed) run.narrowed = r.narrowed;
  problems.forEach(p => addError(run, 'VALIDATION', p));
  setupLevel.forEach(s => addError(run, 'VALIDATION', `${s.setup}: ${s.why}`, { setup: s.setup }));
  untestedEverywhere.forEach(u => addError(run, 'DATA', `${u.setup}: untested everywhere — ${u.why}`, { setup: u.setup }));
  (r.watchlistFallbacks || []).forEach(f => addError(run, 'DATA', `${f.setup}: ${f.why}`, { setup: f.setup }));
  (r.skippedMarkets || []).forEach(m => addError(run, 'DATA', `${m.market || 'instruments with no market row'} not ready — ${m.reason}; ${m.instruments} instrument(s) not evaluated, SKIPPED_NO_DATA for this run`, { market: m.market }));
  if (out.ledgerError) addError(run, 'IO', out.ledgerError);

  /* Delivery after the record: a failure here never loses an alert. The
     record the run wrote goes with its new alerts, so the rows an earlier
     run could not write are written too (writeDeliveries). A delivery
     record that could not be written leaves the count null, "not recorded":
     it was left at 0, and the run page read "delivered 0 in the app —
     written to the record" over alerts this run had written to the record. */
  let deliveryFailed = false;
  if (!dry) {
    try {
      const d = await writeDeliveries(W.deliveries, r.alerts, { runId, now: new Date().toISOString(), record: out.out.alerts });
      run.counts.deliveries = d.added;
      run.counts.deliveriesBackfilled = d.backfilled;
    } catch (e) {
      deliveryFailed = true;
      run.counts.deliveries = null;
      addError(run, 'DELIVERY', `the delivery record ${W.deliveries} could not be written (${e.message}); the alerts are recorded, and the next run that writes the delivery record adds their rows`);
    }
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

function printRun({ E, r, out, dry, written, alertsPath, run, problems, setupLevel, untestedEverywhere }) {
  console.log('');
  if (run.trigger === 'replay') console.log(`replay     as though the history ended on ${run.replayAsOf}, judged the morning after — anything already recorded is not recorded again`);
  if (run.trigger === 'retry') console.log(`retry      of ${run.retryOf}, on ${run.retryBasis}`);
  if (run.narrow) {
    const n = r.narrowed;
    console.log(`narrowed   to ${[run.narrow.setup ? `setup ${run.narrow.setup}` : null, run.narrow.market ? `market ${run.narrow.market}` : null].filter(Boolean).join(' and ')}`
      + `${n?.instrumentsLeftOut ? ` — ${n.instrumentsLeftOut} instrument(s) of other markets left out` : ''}${n?.setupsOutside?.length ? `; nothing in it for ${n.setupsOutside.join(', ')}` : ''}`);
  }
  const lo = out?.leftOut;
  console.log(`setups     ${r.setups} evaluated${lo?.file ? ` — the whole setups file is refused: ${lo.file}` : lo?.setups ? `, ${lo.setups} left out` : ''}`);
  const v = out?.versions;
  if (v) {
    const src = { export: 'exported', 'file-edit': 'edited in the file' };
    console.log(`versions   ${v.known} known to the ledger${v.newVersions.length ? ` · new${dry ? ' (not recorded: dry run)' : ''}: ${v.newVersions.map(x => `${x.setupId} v${x.version} (${src[x.source] || x.source})`).join(', ')}` : ''}${v.refused.length ? ` · refused: ${v.refused.map(x => `${x.setupId} v${x.version}`).join(', ')}` : ''}`);
  }
  (r.universeResolvedFrom || []).forEach(u => console.log(`watchlist  ${u.setupId}: ${u.source === 'export' ? `members from your export of ${u.exportedAt || 'an unrecorded time'} (${out?.watchlists?.path || 'watchlists.json'})` : `its snapshot of ${u.asOf || 'an unrecorded date'}`}`));
  const cu = r.catchUp;
  const caughtUp = cu && (cu.pairs > 0 || cu.capped > 0);
  console.log(`bars       ${r.asOf ? E.scanBarRange(r.asOfFrom, r.asOf) : '—'} (each pair on its own instrument's last final bar${caughtUp ? ', and the bars it missed since it was last evaluated' : ''}; a bar captured before its session closed is provisional and is not evaluated)`);
  /* Catch-up changes what a run records after a missed day, so it is said
     every time it happens. */
  if (caughtUp) {
    console.log(`catch-up   ${cu.pairs} pair(s) had missed bars: ${cu.bars} earlier bar(s) evaluated, each on the history as it stood that day, so a crossing on a missed day is recorded on its own bar`
      + `${cu.capped ? `; ${cu.capped} pair(s) were more than ${cu.cap} bars behind — the newest ${cu.cap} were evaluated, and --as-of DATE replays the days before` : ''}`);
    (r.catchUpList || []).filter(x => x.missed > 0).slice(0, 10).forEach(x => console.log(`           ${x.setup} ${x.symbol}: ${x.missed} bar(s) not caught up, ${x.missedFrom} … ${x.missedTo}`));
  }
  console.log(`evaluated  ${r.evaluated} setup × instrument pair${r.evaluated === 1 ? '' : 's'} · ${r.matched} matched · ${r.untested} untested`);
  console.log(`${r.alerts.length} new alert${r.alerts.length === 1 ? '' : 's'} recorded${dry ? ' (dry run — nothing written)' : written ? ` → ${alertsPath}` : ''}${r.deduped ? ` · ${r.deduped} already recorded` : ''}`);
  if (!dry) {
    const bf = run.counts.deliveriesBackfilled || 0, k = r.alerts.length;
    console.log(run.counts.deliveries == null
      ? `delivered  not recorded — the delivery record could not be written (below); ${k ? `the ${k} new alert${k === 1 ? ' is' : 's are'} in the record the app reads, and the next run that writes it adds ${k === 1 ? 'its row' : 'their rows'}` : 'no alert was new'}`
      : `delivered  ${run.counts.deliveries} in the app (the record above)${bf ? `, and ${bf === 1 ? '1 row an earlier run' : `${bf} rows earlier runs`} could not write` : ''}; email, Telegram and push are not configured — nothing is sent`);
  }
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
  if ((r.watchlistFallbacks || []).length) {
    console.log('\nWATCHLIST SNAPSHOT USED — resolved from the export, but the export did not hold the list:');
    r.watchlistFallbacks.forEach(f => console.log(`  · ${f.setup}: ${f.why}${tag(`${f.setup}: ${f.why}`)}`));
  }
  /* One line per market held back, in a fixed form ingest/daily.mjs reads
     ("not ready  CODE — sentence"). */
  if ((r.skippedMarkets || []).length) {
    console.log('\nNOT READY — held back by --ready, SKIPPED_NO_DATA for this run. Judged from capture times against each market\'s close and settle,');
    console.log('on the calendar your own history implies — not a provider\'s word that the session is final. The next ready run catches them up:');
    r.skippedMarkets.forEach(m => console.log(`not ready  ${m.market || 'UNPLACED'} — ${m.reason} (${m.instruments} instrument(s) not evaluated)`));
  }
  const delivery = run.errors.find(e => e.category === 'DELIVERY');
  if (delivery) console.log(`\nDELIVERY RECORD NOT WRITTEN — ${delivery.message}  [${delivery.correlationId}]`);
  if (out?.ledgerError) console.log(`\nLEDGER NOT WRITTEN — ${out.ledgerError}${tag(out.ledgerError)}`);
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
