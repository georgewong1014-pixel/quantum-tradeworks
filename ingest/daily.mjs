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
 *   1  the run failed outright — nothing was imported
 *   2  imported, but something needs your eyes (rows held back, or stale)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const URL_    = flag('url', null);
const SHOTS   = flag('shots', 'watchlist-shots/auto');
const REVIEW  = flag('review', 'data/watchlist-review.csv');
const PRICES  = flag('prices', 'data/personal-prices.json');
const REPORT  = flag('report', 'data/daily-report.txt');
const SKIP_FX = argv.includes('--no-fx');

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

/* 1 ------------------------------------------------------------- capture */
let pages = 0, staleRun = false;
try {
  const { stdout } = await node(['ingest/autoshot.mjs', '--url', URL_, '--out', SHOTS]);
  pages = (stdout.match(/^page /gm) || []).length;
  say(`capture   ${pages} page(s)`);
} catch (e) {
  const out = String(e.stdout || '') + String(e.stderr || '');
  if (e.code === 2 || /STALE/.test(out)) {
    staleRun = true;
    say(`capture   STALE — every page identical to the previous run`);
    say(`          a signed-out session, a stuck tab, or a changed layout.`);
    say(`          nothing imported.`);
    await finish(2);
  }
  say(`capture   FAILED`);
  say(String(out).trim().split('\n').slice(-4).map(s => '          ' + s).join('\n'));
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
  for (const l of stdout.split('\n')) if (/^ {10}\S/.test(l) && /:/.test(l)) say(`          ${l.trim()}`);
} catch (e) {
  say(`read      FAILED`);
  say(String(e.stdout || e.stderr || '').trim().split('\n').slice(-4).map(s => '          ' + s).join('\n'));
  await finish(1);
}

/* 3 -------------------------------------------------------------- import */
/* prices.mjs refuses any row still marked CHECK, so the review gate keeps
   working unattended: clean rows land, doubtful ones wait for you. */
let accepted = 0, rejected = 0;
try {
  const { stdout } = await node(['ingest/prices.mjs', '--in', REVIEW, '--out', PRICES,
    '--licence', 'personal research — not for redistribution']);
  accepted = Number((stdout.match(/accepted\s*:\s*(\d+)/) || [])[1] || 0);
  rejected = Number((stdout.match(/rejected\s*:\s*(\d+)/) || [])[1] || 0);
  say(`import    ${accepted} accepted, ${rejected} held back for review`);
} catch (e) {
  say(`import    FAILED`);
  say(String(e.stdout || e.stderr || '').trim().split('\n').slice(-4).map(s => '          ' + s).join('\n'));
  await finish(1);
}

/* 4 ------------------------------------------------------------------ FX */
if (!SKIP_FX) {
  try {
    const { stdout } = await node(['ingest/fx.mjs', '--out', PRICES]);
    const rate = (stdout.match(/USD\/MYR\s*:\s*(?:[\d.]+\s*->\s*)?([\d.]+)/) || [])[1];
    say(`fx        USD/MYR ${rate || '?'} from Bank Negara Malaysia, cross-checked`);
  } catch (e) {
    /* Not fatal: the prices imported fine and the previous rate still stands. */
    say(`fx        could not refresh — the previous rate is unchanged`);
    bump(2);
  }
}

/* 5 -------------------------------------------------------------- verdict */
if (rejected > 0 || flagged > 0) bump(2);
/* Overrides rather than bumps. "Some rows need review" and "no price reached
   the file at all" are different situations, and the second must not be
   reported as the milder of the two just because it happened second. */
if (accepted === 0) { say(''); say('NOTHING IMPORTED — every row was held back.'); worst = 1; }

say('');
say(rejected > 0 || flagged > 0
  ? `Open ${REVIEW}, correct the rows marked CHECK, then re-run:\n  node ingest/prices.mjs --in ${REVIEW} --out ${PRICES} --licence "personal research — not for redistribution"`
  : 'Nothing needs your attention.');

await finish(worst);

async function finish(code) {
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  lines.push('', `finished in ${secs}s with exit ${code}`);
  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(REPORT, lines.join('\n') + '\n');
  console.log(`\nreport written to ${REPORT}`);
  process.exit(code);
}
