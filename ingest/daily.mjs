#!/usr/bin/env node
/**
 * The whole unattended run: capture -> read -> import -> FX -> report.
 *
 *   node ingest/daily.mjs --url "<watchlist url>"
 *
 * Exit code is the point. Task Scheduler shows it as the last-run result, so a
 * silent failure becomes visible in the one place you would look:
 *
 *   0  everything imported cleanly
 *   1  the run failed outright, or nothing was imported (every row held
 *      back, or none read)
 *   2  something needs your eyes: rows held back, a later step that failed
 *      or was partial — or a stale capture, which imports nothing
 *
 * Every run, whatever its exit, is appended to data/ingest-runs.json
 * (git-ignored): each step's outcome, the scanner's status and run id, and
 * the duration — the record the admin data page reads.
 *
 * THE SCANNER RUNS ONLY ON A HISTORY THIS RUN UPDATED. If the history step
 * failed, the scanner would evaluate yesterday's file and report it as
 * today's scan; it is skipped and the report says why. It is started with
 * --trigger daily --ready, and its own exit codes are read: 0 completed, 2
 * partial, 3 skipped (paused, locked by another run, no setups, no bar to
 * evaluate, or nothing new), 1 failed. Only a failure, a partial run or a
 * lock held by another run make this run exit 2; a pause the reader asked
 * for, or a day with nothing new, is not something to look at.
 *
 * AND ONLY ON THE MARKETS THAT ARE READY. An updated file is not a final
 * one: a Bursa close read at 16:30 is an afternoon price. With --ready the
 * scanner evaluates only the markets whose expected session is held final,
 * holds back the rest (SKIPPED_NO_DATA for that run, so its next run catches
 * them up) and exits 2; the report names each market held back and why. It
 * is judged from capture times against each market's close — the nearest
 * honest stand-in for a provider confirming the session, and not that.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
/* The worker's atomic write: it waits out a reader holding the file open on
   Windows, and keeps its .bak writable. */
import { writeAtomic, renameRetrying } from '../scanner/scan.mjs';
import { withLock } from './lockfile.mjs';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const URL_    = flag('url', null);
const SHOTS   = flag('shots', 'watchlist-shots/auto');
const REVIEW  = flag('review', 'data/watchlist-review.csv');
const PRICES  = flag('prices', 'data/personal-prices.json');
const REPORT  = flag('report', 'data/daily-report.txt');
const SKIP_FX = argv.includes('--no-fx');
const RUNS    = flag('ingest-runs', 'data/ingest-runs.json');
const TRIGGER = flag('trigger', 'daily');
const RUNS_CAP = 500;

if (!URL_) { console.error('usage: node ingest/daily.mjs --url "<watchlist url>" [--no-fx]'); process.exit(1); }

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const node = (args) => run(process.execPath, args, { maxBuffer: 1024 * 1024 * 64 });

const started = new Date();
say(`Quantum Tradeworks — daily price run`);
say(`started ${started.toISOString()}`);
say('');

let worst = 0;
const bump = (n) => { if (n > worst) worst = n; };
/* What each step did, for data/ingest-runs.json. */
const steps = [];
const step = (name, status, detail = null, extra = {}) => steps.push({ step: name, status, detail, ...extra });
const scanner = { ran: false, exit: null, status: null, runId: null, recorded: null, skippedMarkets: [] };
const counts = {};

/* What a failed step's output says went wrong: the lines the report prints,
   and the one the run log keeps. A script that throws ends its stderr with
   Node's stack and a "Node.js v24.x" line, and that last line was logged as
   the step's detail, the stack frames above it printed as the reason — an
   import whose review file had no close column was recorded as failing with
   "Node.js v24.21.0". The thrown error's own line is named where there is
   one; otherwise the last lines that are not the stack. */
const failure = (e, n = 4) => {
  const ls = `${e.stdout || ''}\n${e.stderr || ''}`.split(/\r?\n/).map(l => l.trim())
    .filter(l => l && !/^Node\.js v\d/.test(l) && !/^at /.test(l) && !/^\^+$/.test(l));
  const thrown = ls.find(l => /^(?:[A-Z]\w*)?Error(?: \[\w+\])?: /.test(l));
  const shown = thrown ? [thrown] : ls.slice(-n);
  return { shown: shown.map(s => '          ' + s).join('\n'), detail: thrown || ls.at(-1) || e.message?.split('\n')[0] || null };
};

/* 1 ------------------------------------------------------------- capture */
let pages = 0, staleRun = false;
try {
  const { stdout } = await node(['ingest/autoshot.mjs', '--url', URL_, '--out', SHOTS]);
  pages = (stdout.match(/^page /gm) || []).length;
  say(`capture   ${pages} page(s)`);
  counts.pages = pages;
  step('capture', 'ok', `${pages} page(s)`);
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  if (e.code === 2 || /STALE/.test(out)) {
    staleRun = true;
    step('capture', 'stale', 'every page identical to the previous run — nothing imported');
    say(`capture   STALE — every page identical to the previous run`);
    say(`          a signed-out session, a stuck tab, or a changed layout.`);
    say(`          nothing imported.`);
    await finish(2);
  }
  const f = failure(e);
  say(`capture   FAILED`);
  if (f.shown) say(f.shown);
  step('capture', 'failed', f.detail);
  await finish(1);
}

/* 2 ---------------------------------------------------------------- read */
let candidates = 0, flagged = 0, skippedRows = 0;
try {
  const { stdout } = await node(['ingest/watchlist.mjs', '--dir', SHOTS, '--out', REVIEW, '--baseline', PRICES]);
  candidates  = Number((stdout.match(/^candidates\s+(\d+)/m) || [])[1] || 0);
  flagged     = Number((stdout.match(/^flagged\s+(\d+)/m) || [])[1] || 0);
  skippedRows = Number((stdout.match(/^skipped\s+(\d+)/m) || [])[1] || 0);
  say(`read      ${candidates} instrument(s), ${flagged} flagged, ${skippedRows} row(s) unreadable`);
  Object.assign(counts, { candidates, flagged, unreadable: skippedRows });
  step('read', 'ok', `${candidates} instrument(s), ${flagged} flagged`);
  for (const l of stdout.split('\n')) if (/^ {10}\S/.test(l) && /:/.test(l)) say(`          ${l.trim()}`);
} catch (e) {
  const f = failure(e);
  say(`read      FAILED`);
  if (f.shown) say(f.shown);
  step('read', 'failed', f.detail);
  await finish(1);
}

/* 3 -------------------------------------------------------------- import */
/* prices.mjs refuses any row still marked CHECK, so the review gate keeps
   working unattended: clean rows land, doubtful ones wait for you. */
let accepted = 0, rejected = 0, nothingImported = false;
/* The USD/MYR rate the price file holds before the import replaces it, for
   the FX step to say what became of it. */
const fxBefore = await fxHeld();
try {
  const { stdout } = await node(['ingest/prices.mjs', '--in', REVIEW, '--out', PRICES,
    '--licence', 'personal research — not for redistribution']);
  accepted = Number((stdout.match(/accepted\s*:\s*(\d+)/) || [])[1] || 0);
  rejected = Number((stdout.match(/rejected\s*:\s*(\d+)/) || [])[1] || 0);
  say(`import    ${accepted} accepted, ${rejected} held back for review`);
  Object.assign(counts, { accepted, rejected });
  step('import', 'ok', `${accepted} accepted, ${rejected} held back`);
} catch (e) {
  /* prices.mjs accepts no row — every row held back, or none read — by
     writing nothing and exiting 1, its own "not written:" report on stdout.
     Every exit 1 was read as "import FAILED" and the run stopped there: the
     FX rate went unrefreshed, and the closing lines this run keeps for that
     day — "NOTHING IMPORTED — every row was held back", and which file to
     open and correct — were never reached. It is read as what it is: the
     price file stands as it was, so the history and the scanner (which would
     read that unchanged file as today's) are skipped, FX still runs, and the
     verdict below closes the run with exit 1. */
  const so = String(e.stdout || '');
  if (e.code === 1 && /^not written: .*no row was accepted/m.test(so) && /^\s*accepted\s*:\s*0\s*$/m.test(so)) {
    nothingImported = true;
    rejected = Number((so.match(/rejected\s*:\s*(\d+)/) || [])[1] || 0);
    /* "the prices it holds stand" only where prices.mjs found a file to leave standing. */
    const what = `${rejected ? `nothing accepted, ${rejected} held back for review` : 'nothing accepted, the review file holds no row'} — ${PRICES} was not written${/ it holds stand/.test(so) ? '; the prices it holds stand' : ''}`;
    say(`import    ${what}`);
    const why = (so.match(/^\s*rejected\s*:\s*\d+ — (.+)$/m) || [])[1];
    if (why) say(`          ${why}`);
    Object.assign(counts, { accepted: 0, rejected });
    step('import', 'warn', what);
  } else {
    const f = failure(e);
    say(`import    FAILED`);
    if (f.shown) say(f.shown);
    step('import', 'failed', f.detail);
    await finish(1);
  }
}

/* 4 ------------------------------------------------------------- history */
/* The price file holds only today. Trends need the series, and for a Bursa
   listing — which can never have a valuation here — the series is the whole
   signal rather than a supporting detail. */
/* history.mjs goes through the history store: 0 written, 2 written with
   rows refused (a lower-ranked source, or a bar that failed validation —
   named in data/price-history.rejects.json), 1 not written. */
let historyUpdated = false;
const historyLine = (stdout) => {
  const depth = (stdout.match(/depth\s*:\s*(\S+)/) || [])[1];
  const syms = (stdout.match(/symbols\s*:\s*(\d+)/) || [])[1];
  const added = (stdout.match(/new bars\s*:\s*(\d+)/) || [])[1];
  counts.newBars = added != null ? Number(added) : null;
  return `${syms || '?'} symbol(s), ${added ?? '?'} new bar(s), ${depth || '?'} day(s) deep`;
};
if (nothingImported) {
  say(`history   skipped — nothing was imported, so ${PRICES} holds no reading from this run`);
  step('history', 'skipped', 'nothing imported');
} else try {
  const { stdout } = await node(['ingest/history.mjs', '--in', PRICES]);
  historyUpdated = true;
  say(`history   ${historyLine(stdout)}`);
  step('history', 'ok', historyLine(stdout));
} catch (e) {
  if (e.code === 2) {
    historyUpdated = true;
    say(`history   ${historyLine(String(e.stdout || ''))} — some rows were refused:`);
    for (const l of String(e.stdout || '').split('\n')) if (/^\s+(outranked|rejected|\s{8,}\S)/.test(l)) say(`          ${l.trim()}`);
    step('history', 'warn', 'written; rows refused — see data/price-history.rejects.json');
  } else {
    const f = failure(e, 2);
    say(`history   could not be updated — today's prices are still imported`);
    if (f.shown) say(f.shown);
    step('history', 'failed', f.detail);
  }
  bump(2);
}

/* 4b ------------------------------------------------------------ scanner */
/* Only when the reader has written setups. The worker evaluates them on the
   history just updated and appends any match to data/scan-alerts.json. No
   setups file is the normal state of a reader who has not asked for this, so
   it is reported and not counted against the run. */
if (!historyUpdated) {
  say('scanner   skipped — the history was not updated, and a scan of the old file is not today\'s scan');
  step('scanner', 'skipped', 'history not updated');
} else if (existsSync('data/scan-setups.json')) {
  let code = 0, out = '', err = '';
  try { ({ stdout: out, stderr: err } = await node(['scanner/scan.mjs', '--trigger', 'daily', '--ready'])); }
  catch (e) { code = typeof e.code === 'number' ? e.code : 1; out = String(e.stdout || ''); err = String(e.stderr || e.message || ''); }
  const n = (out.match(/(\d+) new alert/) || [])[1];
  const st = out.match(/^status\s+(\S+)\s+\((run-[^)]+)\)/m);
  /* The markets the ready gate held back, one line each in the scanner's
     fixed form "not ready  CODE — why". */
  const notReady = [...out.matchAll(/^not ready\s+(\S+) — (.+)$/gm)].map(m => ({ market: m[1], reason: m[2].trim() }));
  /* What else made the scan PARTIAL, read off the heading the scanner prints
     for each (printRun). A fixed list — "a setup was skipped, could not be
     tested, or its delivery record failed" — was printed whatever the reason,
     so a version ledger that could not be written, or a watchlist snapshot
     read in place of the export, was reported as none of what happened; and
     beside a market held back, nothing else was named at all. */
  const partialWhy = [[/^LEFT OUT —/m, 'a setup was left out'], [/^SKIPPED:$/m, 'a setup was skipped'],
                      [/^UNTESTED EVERYWHERE —/m, 'a setup could not be tested on any instrument'],
                      [/^WATCHLIST SNAPSHOT USED —/m, 'a watchlist snapshot was read in place of the export'],
                      [/^DELIVERY RECORD NOT WRITTEN —/m, 'the delivery record could not be written'],
                      [/^LEDGER NOT WRITTEN —/m, 'the version ledger could not be written']].filter(([re]) => re.test(out)).map(([, why]) => why);
  Object.assign(scanner, { ran: true, exit: code, status: st?.[1] || null, runId: st?.[2] || null, recorded: n != null ? Number(n) : null, skippedMarkets: notReady });
  const lastErr = (err || out).trim().split('\n').filter(Boolean).pop() || 'see above';
  if (code === 0) { say(`scanner   ${n ?? '?'} new alert(s) recorded in data/scan-alerts.json`); step('scanner', 'ok', scanner.status); }
  else if (code === 2 && notReady.length) {
    say(`scanner   ${n ?? '?'} new alert(s) recorded; not ready, so not scanned today (SKIPPED_NO_DATA — the next run catches them up):`);
    notReady.forEach(m => say(`          ${m.market} — ${m.reason}`));
    say('          readiness is judged from capture times against each market\'s close, not confirmed by a provider');
    if (partialWhy.length) say(`          and ${partialWhy.join('; ')} — node scanner/scan.mjs --runs 1 says which`);
    step('scanner', 'warn', `${scanner.status}; not ready: ${notReady.map(m => m.market).join(', ')}`);
    bump(2);
  }
  else if (code === 2) {
    const why = partialWhy.length ? partialWhy.join('; ')
      : 'a setup was skipped or could not be tested, a watchlist snapshot was read, or the delivery record or the version ledger could not be written';
    say(`scanner   ${n ?? '?'} new alert(s) recorded; ${why} — node scanner/scan.mjs --runs 1 says which`); step('scanner', 'warn', scanner.status); bump(2);
  }
  else if (code === 3) {
    /* SKIPPED_NO_DATA is the scanner's status for inputs unchanged since a
       run that evaluated, and for a history that holds no bar — a first run
       whose every row the history refused writes one. Both were reported as
       "nothing new since the last scan"; the scanner's own sentence says
       which (stdout for the first, stderr for the second). */
    const noData = /^nothing changed since /m.test(out) ? 'nothing new since the last scan'
      : `no bar to evaluate: ${(err.split('\n').map(l => l.trim()).find(Boolean)) || 'the scanner found no data'}`;
    const why = { SKIPPED_PAUSED: 'paused — node scanner/scan.mjs --resume to continue', SKIPPED_LOCKED: 'another scan held the lock, and records what this one would have',
                  SKIPPED_NO_DATA: noData, SKIPPED_NO_SETUPS: 'no setups to evaluate' }[scanner.status] || 'skipped';
    say(`scanner   skipped — ${why}`);
    step('scanner', 'skipped', scanner.status);
    if (scanner.status === 'SKIPPED_LOCKED') bump(2);
  } else { say(`scanner   could not run — ${lastErr}`); step('scanner', 'failed', lastErr); bump(2); }
} else {
  say('scanner   no data/scan-setups.json — nothing to evaluate');
  step('scanner', 'skipped', 'no setups file');
}

/* 5 ------------------------------------------------------------------ FX */
if (!SKIP_FX) {
  try {
    const { stdout } = await node(['ingest/fx.mjs', '--out', PRICES]);
    const rate = (stdout.match(/USD\/MYR\s*:\s*(?:[\d.]+\s*->\s*)?([\d.]+)/) || [])[1];
    /* Where the rate came from, and whether a second source agreed, as
       fx.mjs printed them. The report said "from Bank Negara Malaysia,
       cross-checked" whatever happened: with Bank Negara down the rate
       written is Frankfurter's, and with either source down nothing checked
       it — the file records both (src, crossChecked); the report now does. */
    const src = (stdout.match(/^\s*source\s*:\s*(.+?)\s*$/m) || [])[1];
    const apart = (stdout.match(/sources differ by ([\d.]+%)/) || [])[1];
    const how = `from ${src || 'a source fx.mjs did not name'}, ${apart ? `cross-checked (the two sources ${apart} apart)`
      : /only one source responded/.test(stdout) ? 'not cross-checked — only one source responded' : 'not cross-checked'}`;
    say(`fx        USD/MYR ${rate || '?'} ${how}`);
    step('fx', 'ok', `USD/MYR ${rate || '?'} ${how}`);
  } catch (e) {
    /* Not fatal, and said as it is. "The previous rate is unchanged" was
       printed whatever the file held: an import that accepted a row replaces
       the price file, and prices.mjs carries no row that names its own
       source — fx.mjs's rate among them — so after it the file held no
       USD/MYR rate at all. The rate the file holds now is named, or its
       absence and what became of the one it held. */
    const now = await fxHeld();
    const rateOf = (p, sep) => `${p.close}${p.src ? ` from ${p.src}` : ''}${p.date ? `${sep}${p.date}` : ''}`;
    const what = now ? `${PRICES} holds USD/MYR ${rateOf(now, ' (')}${now.date ? ')' : ''}`
      : `${PRICES} holds no USD/MYR rate now${fxBefore && !nothingImported ? `: the import replaced the file, and the rate it held (${rateOf(fxBefore, ', ')}) was not carried over` : ''}`;
    say(`fx        could not refresh — ${what}`);
    step('fx', 'failed', what);
    bump(2);
  }
}

/* 6 -------------------------------------------------------------- verdict */
if (rejected > 0 || flagged > 0) bump(2);
/* Overrides rather than bumps. "Some rows need review" and "no price reached
   the file at all" are different situations, and the second must not be
   reported as the milder of the two just because it happened second. */
/* The closing lines say what the exit code says. "Every row was held back"
   was printed when no row had been read at all, and "Nothing needs your
   attention" closed runs that exit 1 or 2 — a capture that read nothing, a
   history or FX step that failed, a scan that could not run. */
if (accepted === 0) { say(''); say(candidates === 0 && rejected === 0 ? 'NOTHING IMPORTED — no row was read from the capture.' : 'NOTHING IMPORTED — every row was held back.'); worst = 1; }

/* The re-run names the history step too. It named the import alone, and
   the import writes only the price file — which the next run replaces with
   the next day's rows — so a close corrected as told never reached the
   history: the series skipped that session for good. */
say('');
say(rejected > 0 || flagged > 0
  ? `Open ${REVIEW}, correct the rows marked CHECK, then re-run the import and add them to the history:\n  node ingest/prices.mjs --in ${REVIEW} --out ${PRICES} --licence "personal research — not for redistribution"\n  node ingest/history.mjs --in ${PRICES}`
  : worst > 0 ? `Something above needs your attention — this run exits ${worst}.`
  : 'Nothing needs your attention.');

await finish(worst);

/* The USD/MYR row the price file holds — fx.mjs's key — or null. */
async function fxHeld() {
  try {
    const p = JSON.parse(await readFile(PRICES, 'utf8'))?.prices?.USDMYR;
    return p && typeof p.close === 'number' ? p : null;
  } catch { return null; }
}

async function finish(code) {
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  lines.push('', `finished in ${secs}s with exit ${code}`);
  /* A report that cannot be written (its path taken, the file held open)
     is said, and the run is still logged with its own exit code. Unhandled,
     it crashed a run that had imported cleanly into exit 1 with a stack
     trace, and the run never reached data/ingest-runs.json. */
  try {
    await mkdir(dirname(REPORT), { recursive: true });
    await writeFile(REPORT, lines.join('\n') + '\n');
    console.log(`\nreport written to ${REPORT}`);
  } catch (e) { console.error(`\nthe report ${REPORT} could not be written: ${e.message}`); }
  try { await logRun(code); } catch (e) { console.error(`the ingest run log ${RUNS} could not be written: ${e.message}`); }
  process.exit(code);
}

/* One entry per run in data/ingest-runs.json, newest last, capped. Written
   on every exit path, so a run that failed at the capture is as visible as
   one that finished.

   Read, changed and written under the log's own short lock, as the
   scanner's run log is: two daily runs at once (the scheduled one and
   schedule.ps1 -RunNow) each read the log, added their entry and renamed
   the same .tmp over it, so one entry was lost or the write failed. A log
   that is not JSON is set aside before a new one is begun; begun again in
   place, the damaged copy became the .bak and the good copy was lost. */
async function logRun(code) {
  await mkdir(dirname(RUNS), { recursive: true });
  await withLock(`${RUNS}.lock`, async () => {
    let doc = { schema: 1, runs: [] };
    if (existsSync(RUNS)) {
      try { const d = JSON.parse(await readFile(RUNS, 'utf8')); if (Array.isArray(d?.runs)) doc = { ...d, schema: 1 }; }
      catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        const aside = `${RUNS}.damaged-${Date.now()}`;
        await renameRetrying(RUNS, aside);
        console.error(`the ingest run log ${RUNS} was not valid JSON — set aside as ${aside}, and a new log begun`);
      }
    }
    const finishedAt = new Date().toISOString();
    doc.runs.push({ id: `ingest-${started.toISOString().replace(/[-:.]/g, '').slice(0, 15)}-${process.pid}`, kind: 'ingest', trigger: TRIGGER,
                    status: code === 0 ? 'COMPLETED' : code === 2 ? 'PARTIAL' : 'FAILED', exitCode: code,
                    startedAt: started.toISOString(), finishedAt, durationMs: Date.now() - started, steps, counts, scanner, report: REPORT });
    if (doc.runs.length > RUNS_CAP) doc.runs = doc.runs.slice(-RUNS_CAP);
    doc.updatedAt = finishedAt;
    await writeAtomic(RUNS, JSON.stringify(doc, null, 1) + '\n');
  });
}
