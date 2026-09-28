#!/usr/bin/env node
/**
 * Imports historical bars so the trend engine has something to work on.
 *
 *   node ingest/history-import.mjs --in KLSE.csv --symbol KLSE
 *   node ingest/history-import.mjs --dir exports/          (symbol from filename)
 *   ... [--out file] [--keep 2000] [--tz Area/City] [--captured-at ISO] [--market MY]
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
 *     date | time | timestamp | datetime        and
 *     close | last | price | adj close | close/last
 *   and, where the export has them, open, high, low and volume — kept, not
 *   ignored: they are what ATR and a true 52-week range are computed from.
 *
 * DATES
 *   ISO dates are read as written. A 10- or 13-digit epoch is dated in the
 *   instrument's exchange zone (its registry market, or --tz), except an
 *   epoch at exactly midnight UTC, which is read as that UTC date — the two
 *   conventions exports use (see history-store.mjs epochDate). Day-first and
 *   month-first dates follow the browser's paste rule: a day above 12 settles
 *   the order; 03/04/2026 is refused as ambiguous rather than guessed.
 *
 * WHERE IT GOES
 *   Through ingest/history-store.mjs: validated by the engine, merged under
 *   the source-rank policy (an import outranks a screen reading, and a
 *   disagreement with an equal source is recorded as a correction), trimmed
 *   with its volume and open/high/low, written atomically. The capture time
 *   of every bar is the file's modification time (or --captured-at), so a
 *   file exported while the last session still traded marks that bar
 *   PROVISIONAL.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateHistory, mergeBars, describeMerge, engine, loadInstruments, marketOf, parseDateCell, KEEP } from './history-store.mjs';

const DATE_KEYS  = ['date', 'time', 'timestamp', 'datetime'];
const CLOSE_KEYS = ['close', 'last', 'price', 'adj close', 'adjclose', 'close/last'];
const OPEN_KEYS  = ['open'];
const HIGH_KEYS  = ['high'];
const LOW_KEYS   = ['low'];
/* Volume was once parsed and discarded. It is the input for every volume
   indicator, and an OHLCV export already carries it. */
const VOL_KEYS   = ['volume', 'vol', 'total volume'];

/* Rows as the store takes them. Nothing here judges a price beyond "is it a
   number": the engine's scanValidateBar does that in the store, the same
   check the page and the worker apply. A cell that is present and unreadable
   is NaN (the store refuses the row); a blank cell is absent (null). */
export function parseCsv(text, label, { tz = 'UTC' } = {}) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error(`${label}: fewer than two lines`);
  const head = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const col = (keys) => head.findIndex(h => keys.includes(h));
  const di = col(DATE_KEYS), ci = col(CLOSE_KEYS), oi = col(OPEN_KEYS), hi = col(HIGH_KEYS), li = col(LOW_KEYS), vi = col(VOL_KEYS);
  if (di === -1) throw new Error(`${label}: no date column (looked for ${DATE_KEYS.join(', ')})`);
  if (ci === -1) throw new Error(`${label}: no close column (looked for ${CLOSE_KEYS.join(', ')})`);

  const rows = [], refused = [];
  const cell = (cells, i) => {
    if (i < 0) return null;
    const raw = String(cells[i] ?? '').replace(/[, ]/g, '');
    /* Number('') is 0: a blank cell used to be written as a day with no
       trades. Blank is no reading. */
    return raw === '' ? null : Number(raw);
  };
  lines.slice(1).forEach((line, k) => {
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const d = parseDateCell(cells[di], { tz });
    if (d.error) { refused.push({ line: k + 2, date: cells[di], codes: [d.error], why: d.why }); return; }
    rows.push({ date: d.date, open: cell(cells, oi), high: cell(cells, hi), low: cell(cells, li), close: cell(cells, ci), volume: cell(cells, vi) });
  });
  return { rows, refused, columns: { open: oi > -1, high: hi > -1, low: li > -1, volume: vi > -1 } };
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

  const inPath  = flag('in', null);
  const inDir   = flag('dir', null);
  const symbolA = flag('symbol', null);
  const outPath = resolve(flag('out', 'data/price-history.json'));
  const KEEP_N  = Number(flag('keep', KEEP));

  if (!inPath && !inDir) {
    console.error(`usage:
  node ingest/history-import.mjs --in <file.csv> --symbol <SYMBOL>
  node ingest/history-import.mjs --dir <folder>        (symbol taken from each filename)

Export from TradingView: open the chart, then the menu beside the symbol >
"Export chart data…" > CSV. One file per instrument.`);
    process.exit(1);
  }

  /* The app serves data/prices.json; screen-derived history never belongs there. */
  if (outPath === resolve('data/prices.json')) {
    console.error('refusing: --out points at the file the app serves. Use data/price-history.json.');
    process.exit(1);
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

  let E;
  try { E = await engine(); }
  catch (e) { console.error(`cannot load the scan engine out of index.html — the store validates bars with it: ${e.message}`); process.exit(1); }
  const instruments = await loadInstruments(flag('instruments', 'data/instruments.json'));
  const capturedFlag = flag('captured-at', null);
  if (capturedFlag && !Number.isFinite(Date.parse(capturedFlag))) { console.error(`--captured-at "${capturedFlag}" is not a date-time`); process.exit(1); }

  const report = [];
  let failed = 0, dateRefused = 0;
  let run;
  try {
    run = await updateHistory(outPath, async (hist) => {
      const results = [];
      for (const f of files) {
        const market = flag('market', null) || marketOf(f.symbol, instruments);
        const tz = flag('tz', null) || E.scanMarket(market).tz;
        let parsed;
        try { parsed = parseCsv(await readFile(f.path, 'utf8'), f.symbol, { tz }); }
        catch (e) { failed++; report.push(`${f.symbol.padEnd(10)} FAILED — ${e.message}`); continue; }
        /* When the export was made: its file's modification time, unless the
           reader says otherwise. */
        const capturedAt = capturedFlag ? new Date(Date.parse(capturedFlag)).toISOString() : (await stat(f.path)).mtime.toISOString();
        const before = Object.keys(hist.series[f.symbol] || {}).length;
        const r = mergeBars(hist, f.symbol, parsed.rows, { source: `import:${basename(f.path)}`, capturedAt, market, E });
        r.rejected.push(...parsed.refused.map(x => ({ symbol: f.symbol, date: x.date, codes: x.codes, why: x.why, source: `import:${basename(f.path)}`, line: x.line })));
        dateRefused += parsed.refused.length;
        results.push(r);
        const dates = Object.keys(hist.series[f.symbol] || {}).sort();
        const kept = ['open', 'high', 'low'].filter(k => parsed.columns[k]);
        report.push(`${f.symbol.padEnd(10)} ${String(r.added).padStart(5)} new  ${String(before).padStart(5)} -> ${String(dates.length).padStart(5)} points` +
          `  ${dates[0] || '—'} to ${dates[dates.length - 1] || '—'}` +
          `  ${kept.length === 3 ? 'open/high/low kept' : 'close only'}${parsed.columns.volume ? ', volume kept' : ', no volume column'}` +
          `${r.corrected.length ? `  (${r.corrected.length} field(s) corrected against the previous value — recorded)` : ''}` +
          `${r.outranked.length ? `  (${r.outranked.length} held by a higher-ranked source — not written)` : ''}` +
          `${r.rejected.length ? `  (${r.rejected.length} row(s) refused: ${[...new Set(r.rejected.flatMap(x => x.codes))].join(', ')})` : ''}`);
      }
      return results;
    }, { keep: KEEP_N });
  } catch (e) { console.error(`history not written: ${e.message}`); process.exit(1); }

  report.forEach(l => console.log(l));
  const { hist, results, trim } = run;
  const { totals, lines } = describeMerge(results, trim);
  console.log(`\nwrote ${outPath} — ${hist.symbols} symbols`);
  lines.forEach(l => console.log(l));
  if (dateRefused) console.log(`  dates     : ${dateRefused} row(s) with an ambiguous or unreadable date were refused, not guessed`);

  /* What the depth actually unlocks, stated in the engine's own terms. */
  const depths = Object.values(hist.series).map(s => Object.keys(s).length);
  const deepest = depths.length ? Math.max(...depths) : 0;
  const GATES = [[20, '20-day average'], [50, '50-day average'], [200, '200-day average and the 50/200 crossover'],
                 [252, '52-week range, drawdown and 12-month return']];
  console.log(`deepest series: ${deepest} points`);
  for (const [need, what] of GATES) console.log(`  ${deepest >= need ? 'available' : `needs ${need - deepest} more`}  ${what}`);
  console.log('\nPersonal research only. This history is derived from your own exports and');
  console.log('carries no right to redistribute.');
  process.exit(failed === files.length ? 1 : totals.rejected || totals.outranked || failed ? 2 : 0);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && (process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self)) await main();
