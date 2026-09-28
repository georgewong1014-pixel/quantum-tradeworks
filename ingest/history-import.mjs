#!/usr/bin/env node
/**
 * Imports historical bars so the trend engine has something to work on.
 *
 *   node ingest/history-import.mjs --in KLSE.csv --symbol KLSE
 *   node ingest/history-import.mjs --dir exports/          (symbol from filename)
 *   ... [--out file] [--keep 2000] [--tz Area/City] [--captured-at ISO] [--market MY]
 *   ... [--adjusted provider|none|unknown]                 (default unknown)
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
 *   (the first of each list the file has, in that order), and, where the
 *   export has them, open, high, low and volume — kept, not ignored: they
 *   are what ATR and a true 52-week range are computed from. Cells may be
 *   quoted, and a quoted number may carry thousands separators ("1,612.34").
 *
 * DATES
 *   ISO dates are read as written. A 10- or 13-digit epoch, or a date-time
 *   with a zone, is dated in the instrument's exchange zone (its registry
 *   market, or --tz), except an instant at exactly midnight UTC, which is
 *   read as that UTC date — the two conventions exports use (see
 *   history-store.mjs epochDate). Day-first and
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
 *
 * ADJUSTED OR NOT
 *   An export may already be back-adjusted for splits by its provider
 *   (TradingView's "adjust for splits" setting, on by default), or may hold
 *   the prices as they traded. The file does not say which, so the reader
 *   does: --adjusted provider | none | unknown, recorded on every bar this
 *   import writes (meta.adjusted). The engine applies a split recorded in
 *   data/price-adjustments.json to a 'provider' bar only when the split
 *   came after the export — never twice. Without the flag the bars are
 *   'unknown', and a recorded split is applied only where the series shows
 *   the break it explains. The import then names every price break left in
 *   each series it wrote, so an unadjusted split is seen the day it lands.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateHistory, mergeBars, describeMerge, engine, loadInstruments, marketOf, parseDateCell, csvRows, numberCell, KEEP } from './history-store.mjs';

const DATE_KEYS  = ['date', 'time', 'timestamp', 'datetime'];
const CLOSE_KEYS = ['close', 'last', 'price', 'adj close', 'adjclose', 'close/last'];
const OPEN_KEYS  = ['open'];
const HIGH_KEYS  = ['high'];
const LOW_KEYS   = ['low'];
/* Volume was once parsed and discarded. It is the input for every volume
   indicator, and an OHLCV export already carries it. */
const VOL_KEYS   = ['volume', 'vol', 'total volume'];
/* What the reader says about the export's prices (see ADJUSTED OR NOT). */
export const ADJUSTED = ['provider', 'none', 'unknown'];

/* Marks the bars an import now holds as its own with what the reader said
   about their adjustment. Only bars whose source is this import: a bar a
   higher-ranked source kept, or one this import left unchanged under
   another source's name, is not this export's reading. Returns how many. */
export function markAdjusted(hist, symbol, source, rows, adjusted) {
  let n = 0;
  const meta = hist.meta?.[symbol] || {};
  for (const r of rows || []) {
    const m = meta[r?.date];
    if (m && typeof m === 'object' && m.src === source) { m.adjusted = adjusted; n++; }
  }
  return n;
}

/* Rows as the store takes them. Nothing here judges a price beyond "is it a
   number": the engine's scanValidateBar does that in the store, the same
   check the page and the worker apply. A cell that is present and unreadable
   is NaN (the store refuses the row); a blank cell is absent (null). */
export function parseCsv(text, label, { tz = 'UTC' } = {}) {
  /* Read as a CSV, not as lines split on commas: a quoted "1,612.34" is one
     cell (see csvRows in the store). */
  const table = csvRows(text);
  if (table.length < 2) throw new Error(`${label}: fewer than two lines`);
  const head = table[0].cells.map(h => h.toLowerCase());
  /* A column by the first of its names the file has, in the order the
     names are listed — not whichever the file happens to print first. An
     export with "Adj Close" before "Close" (a sorted pandas frame) had its
     dividend-adjusted close read beside the unadjusted open, high and low. */
  const col = (keys) => { for (const k of keys) { const i = head.indexOf(k); if (i > -1) return i; } return -1; };
  const di = col(DATE_KEYS), ci = col(CLOSE_KEYS), oi = col(OPEN_KEYS), hi = col(HIGH_KEYS), li = col(LOW_KEYS), vi = col(VOL_KEYS);
  if (di === -1) throw new Error(`${label}: no date column (looked for ${DATE_KEYS.join(', ')})`);
  if (ci === -1) throw new Error(`${label}: no close column (looked for ${CLOSE_KEYS.join(', ')})`);

  const rows = [], refused = [];
  /* Blank is no reading (null), never 0; an unreadable cell is NaN, which
     the store refuses (numberCell). */
  const cell = (cells, i) => (i < 0 ? null : numberCell(cells[i]));
  table.slice(1).forEach(({ line, cells }) => {
    const d = parseDateCell(cells[di], { tz });
    if (d.error) { refused.push({ line, date: cells[di] ?? '', codes: [d.error], why: d.why }); return; }
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
  const adjusted = argv.includes('--adjusted') ? flag('adjusted', '') : 'unknown';
  if (!ADJUSTED.includes(adjusted)) {
    console.error(`--adjusted "${adjusted}" is not one of ${ADJUSTED.join(', ')}: say whether the export's prices were already adjusted for splits by its provider (provider), are as they traded (none), or you do not know (unknown)`);
    process.exit(1);
  }

  const report = [];
  const imported = [];
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
        markAdjusted(hist, f.symbol, `import:${basename(f.path)}`, parsed.rows, adjusted);
        imported.push({ symbol: f.symbol, market });
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
  console.log(`  adjusted  : ${adjusted === 'provider' ? 'provider — recorded on every bar written, so a split you record is not applied to these prices a second time'
    : adjusted === 'none' ? 'none — recorded on every bar written: the prices are as they traded, and a split you record adjusts them'
    : 'unknown — recorded on every bar written; pass --adjusted provider or none when you know'}`);

  /* Every break left in what was imported, read the way the scanner reads
     it — with the actions already recorded beside the history applied — so
     a split the reader has not recorded is named now, not found later as a
     setup that can no longer be evaluated. */
  let adjDoc = null;
  const adjPath = join(dirname(outPath), 'price-adjustments.json');
  try { adjDoc = JSON.parse(await readFile(adjPath, 'utf8')); } catch { /* none recorded, or unreadable: history-check says which */ }
  const withAdj = E.scanAttachAdjustments(hist, adjDoc);
  const open = imported.flatMap(({ symbol, market }) => E.scanBars(withAdj, symbol, { market }).breaks
    .filter(b => ['unexplained', 'remains', 'created'].includes(b.state)).map(b => ({ symbol, ...b })));
  if (open.length) {
    console.log(`  breaks    : ${open.length} price break(s) no recorded adjustment explains — no indicator is computed across one:`);
    open.slice(0, 8).forEach(b => console.log(`              ${b.symbol} ${b.prev} → ${b.bar}: ×${Number(b.ratio.toPrecision(3))}${b.tag !== 'unexplained' ? ` (looks like a ${b.tag}; record ratio ${Number(b.suggestedRatio.toPrecision(4))})` : ''}`));
    if (open.length > 8) console.log(`              … ${open.length - 8} more (node ingest/history-check.mjs lists them all)`);
    console.log(`              record them in ${adjPath}, or tick them on /admin/scanner/data`);
  }

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
