#!/usr/bin/env node
/**
 * Accumulates a price series from each day's import.
 *
 *   node ingest/history.mjs --in data/personal-prices.json
 *   node ingest/history.mjs --in data/personal-prices.json --out <file> --keep 2000 --source screen
 *
 * A price file holds one close per symbol — today's. Trends need yesterday's
 * too, and nothing else in the pipeline keeps them. This appends each run's
 * closes to a series so a chart has something to draw.
 *
 * It matters most for the instruments that can never have a valuation. Bursa
 * publishes no machine-readable financials, so a Malaysian listing can only
 * ever be a price here — which makes its price history the entire signal
 * rather than a supporting detail.
 *
 * The write goes through ingest/history-store.mjs, the one writer of the
 * history: the engine's bar validation, the source-rank conflict policy (a
 * screen reading never replaces an imported close), a trim that keeps
 * closes, volume, open/high/low and provenance together, and an atomic write.
 * Each price carries the instant it was captured (watchlist.mjs writes it,
 * prices.mjs passes it through), and its date is already its exchange's
 * session date — so the engine can tell a close read after the session from
 * one read while it traded.
 *
 *   exit 0  written;  exit 1  nothing could be written (unreadable input,
 *   damaged history, engine missing);  exit 2  written, but rows were refused
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { updateHistory, mergeBars, describeMerge, engine, loadInstruments, marketOf, KEEP, sourceKind } from './history-store.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const inPath  = flag('in', 'data/personal-prices.json');
const outPath = resolve(flag('out', 'data/price-history.json'));
const KEEP_N  = Number(flag('keep', KEEP));    /* points per symbol — the store's, unless asked */

let book;
try { book = JSON.parse(await readFile(inPath, 'utf8')); }
catch (e) { console.error(`cannot read ${inPath}: ${e.message}`); process.exit(1); }

/* Where the file's prices came from decides their rank: live.mjs --quotes
   names its provider; prices.mjs names the review CSV it read, which is the
   screen. */
const SOURCE = flag('source', /yahoo/i.test(book.source || '') ? 'yahoo' : /twelvedata/i.test(book.source || '') ? 'twelvedata' : 'screen');

let E;
try { E = await engine(); }
catch (e) { console.error(`cannot load the scan engine out of index.html — the store validates bars with it: ${e.message}`); process.exit(1); }
const instruments = await loadInstruments(flag('instruments', 'data/instruments.json'));

let skipped = 0;
const foreign = [];
let run;
try {
  run = await updateHistory(outPath, (hist) => {
    const results = [];
    for (const [symbol, p] of Object.entries(book.prices || {})) {
      const date = String(p?.date || book.asOf || '').slice(0, 10);
      /* A point without a date cannot be placed on a time axis, and guessing
         today would silently misdate it. */
      if (!p || typeof p.close !== 'number' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
      /* A row that names its own source is not this file's reading. fx.mjs
         merges Bank Negara's USD/MYR into the screen's price file with src
         'Bank Negara Malaysia' and no capture time, and it was filed under
         the file's source: a central-bank reference rate became a 'screen'
         bar with no capture time and, where the screen already held that
         date, the two ranked equal, so the rate replaced the screen's
         reading and was recorded as the screen correcting itself. Such a
         row is left out of this file's merge, and the run names it. */
      if (p.src && sourceKind(p.src) !== sourceKind(SOURCE)) { foreign.push(`${symbol} (${p.src})`); continue; }
      results.push(mergeBars(hist, symbol, [{ date, close: p.close, volume: p.volume ?? null }],
        { source: SOURCE, capturedAt: p.capturedAt || null, market: marketOf(symbol, instruments), E }));
    }
    return results;
  }, { keep: KEEP_N });
} catch (e) { console.error(`history not written: ${e.message}`); process.exit(1); }

const { hist, results, trim } = run;
const { totals, lines } = describeMerge(results, trim);
const depth = Object.values(hist.series).map(s => Object.keys(s).length);
console.log(`wrote ${outPath}`);
console.log(`  source    : ${SOURCE}`);
console.log(`  symbols   : ${hist.symbols}`);
lines.forEach(l => console.log(l));
if (skipped) console.log(`  skipped   : ${skipped} (no usable close or date)`);
if (foreign.length) console.log(`  left out  : ${foreign.length} row(s) naming their own source, not filed as ${SOURCE} readings: ${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? ', …' : ''}`);
console.log(`  depth     : ${depth.length ? `${Math.min(...depth)}-${Math.max(...depth)} day(s) per symbol` : 'none'}`);
process.exit(totals.rejected || totals.outranked ? 2 : 0);
