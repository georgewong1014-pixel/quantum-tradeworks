#!/usr/bin/env node
/**
 * Imports historical closes so the trend engine has something to work on.
 *
 *   node ingest/history-import.mjs --in KLSE.csv --symbol KLSE
 *   node ingest/history-import.mjs --dir exports/          (symbol from filename)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *   The daily capture adds one close per instrument per day. A 200-day average
 *   therefore becomes available 200 days after you start, and a 52-week range a
 *   year after that. That is not a useful product for anyone who wants to look
 *   at a trend this week.
 *
 *   TradingView's paid plans export a chart's data to CSV. That is a structured
 *   file you already have the right to read, it needs no OCR, and it backfills
 *   the series in one step. Personal research only — the same limit as every
 *   other screen-derived figure here, so this writes the personal history file
 *   and refuses the one the app serves.
 *
 * ACCEPTED SHAPES
 *   Any CSV with a date column and a close column, under common names:
 *     date | time | Date | timestamp        and
 *     close | Close | last | Last | price | adj close
 *   Extra columns are ignored, so an OHLCV export works unmodified.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, basename, extname, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const inPath  = flag('in', null);
const inDir   = flag('dir', null);
const symbolA = flag('symbol', null);
const outPath = flag('out', 'data/price-history.json');
const KEEP    = Number(flag('keep', 2000));

if (!inPath && !inDir) {
  console.error(`usage:
  node ingest/history-import.mjs --in <file.csv> --symbol <SYMBOL>
  node ingest/history-import.mjs --dir <folder>        (symbol taken from each filename)

Export from TradingView: open the chart, then the menu beside the symbol >
"Export chart data…" > CSV. One file per instrument.`);
  process.exit(1);
}

/* The app serves data/prices.json; screen-derived history never belongs there. */
if (resolve(outPath) === resolve('data/prices.json')) {
  console.error('refusing: --out points at the file the app serves. Use data/price-history.json.');
  process.exit(1);
}

const DATE_KEYS  = ['date', 'time', 'timestamp', 'datetime'];
const CLOSE_KEYS = ['close', 'last', 'price', 'adj close', 'adjclose', 'close/last'];

function parseCsv(text, label) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error(`${label}: fewer than two lines`);
  const head = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const di = head.findIndex(h => DATE_KEYS.includes(h));
  const ci = head.findIndex(h => CLOSE_KEYS.includes(h));
  if (di === -1) throw new Error(`${label}: no date column (looked for ${DATE_KEYS.join(', ')})`);
  if (ci === -1) throw new Error(`${label}: no close column (looked for ${CLOSE_KEYS.join(', ')})`);

  const out = {};
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const rawDate = cells[di], rawClose = cells[ci];
    /* A unix timestamp is a perfectly ordinary export format. */
    let date = null;
    if (/^\d{10}$/.test(rawDate)) date = new Date(Number(rawDate) * 1000).toISOString().slice(0, 10);
    else if (/^\d{13}$/.test(rawDate)) date = new Date(Number(rawDate)).toISOString().slice(0, 10);
    else if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) date = rawDate.slice(0, 10);
    else { const d = new Date(rawDate); if (!Number.isNaN(+d)) date = d.toISOString().slice(0, 10); }

    const close = Number(String(rawClose).replace(/[, ]/g, ''));
    /* Reject rather than repair, as everywhere else in this pipeline. */
    if (!date || !Number.isFinite(close) || close <= 0) { skipped++; continue; }
    out[date] = close;
  }
  return { series: out, skipped };
}

const files = [];
if (inPath) files.push({ path: inPath, symbol: symbolA || basename(inPath, extname(inPath)).toUpperCase() });
if (inDir) {
  for (const n of (await readdir(inDir))) {
    if (!/\.csv$/i.test(n)) continue;
    files.push({ path: join(inDir, n), symbol: basename(n, extname(n)).toUpperCase() });
  }
}
if (!files.length) { console.error('no CSV files found'); process.exit(1); }

let hist = { generated: null, series: {} };
try { hist = { ...hist, ...JSON.parse(await readFile(outPath, 'utf8')) }; } catch { /* first run */ }

let totalAdded = 0, totalKept = 0;
for (const f of files) {
  let parsed;
  try { parsed = parseCsv(await readFile(f.path, 'utf8'), f.symbol); }
  catch (e) { console.error(`${f.symbol.padEnd(10)} FAILED — ${e.message}`); continue; }

  const target = hist.series[f.symbol] || (hist.series[f.symbol] = {});
  const before = Object.keys(target).length;
  let added = 0, conflicts = 0;
  for (const [d, v] of Object.entries(parsed.series)) {
    if (target[d] === undefined) { target[d] = v; added++; }
    /* An imported file and a screen reading can disagree about the same day.
       The import wins — it came from structured data rather than pixels — but
       the disagreement is reported rather than swallowed. */
    else if (Math.abs(target[d] - v) / v > 0.0001) { target[d] = v; conflicts++; }
  }
  const dates = Object.keys(target).sort();
  if (dates.length > KEEP) for (const d of dates.slice(0, dates.length - KEEP)) delete target[d];

  const after = Object.keys(target).length;
  totalAdded += added; totalKept += after;
  console.log(`${f.symbol.padEnd(10)} ${String(added).padStart(5)} new  ${String(before).padStart(5)} -> ${String(after).padStart(5)} points` +
    `  ${dates[0]} to ${dates[dates.length - 1]}` +
    `${conflicts ? `  (${conflicts} day(s) corrected against the previous value)` : ''}` +
    `${parsed.skipped ? `  (${parsed.skipped} row(s) skipped: unusable date or close)` : ''}`);
}

hist.generated = new Date().toISOString();
hist.symbols = Object.keys(hist.series).length;
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(hist, null, 2));

/* What the depth actually unlocks, stated in the engine's own terms. */
const depths = Object.values(hist.series).map(s => Object.keys(s).length);
const deepest = depths.length ? Math.max(...depths) : 0;
const GATES = [[20, '20-day average'], [50, '50-day average'], [200, '200-day average and the 50/200 crossover'],
               [252, '52-week range, drawdown and 12-month return']];
console.log(`\nwrote ${outPath} — ${hist.symbols} symbols`);
console.log(`deepest series: ${deepest} points`);
for (const [need, what] of GATES) {
  console.log(`  ${deepest >= need ? 'available' : `needs ${need - deepest} more`}  ${what}`);
}
console.log('\nPersonal research only. This history is derived from your own exports and');
console.log('carries no right to redistribute.');
