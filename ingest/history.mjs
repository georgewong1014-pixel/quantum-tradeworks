#!/usr/bin/env node
/**
 * Accumulates a price series from each day's import.
 *
 *   node ingest/history.mjs --in data/personal-prices.json
 *
 * A price file holds one close per symbol — today's. Trends need yesterday's
 * too, and nothing else in the pipeline keeps them. This appends each run's
 * closes to a series so a chart has something to draw.
 *
 * It matters most for the instruments that can never have a valuation. Bursa
 * publishes no machine-readable financials, so a Malaysian listing can only
 * ever be a price here — which makes its price history the entire signal
 * rather than a supporting detail.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const inPath  = flag('in', 'data/personal-prices.json');
const outPath = flag('out', 'data/price-history.json');
const KEEP    = Number(flag('keep', 500));    /* points per symbol */

let book;
try { book = JSON.parse(await readFile(inPath, 'utf8')); }
catch (e) { console.error(`cannot read ${inPath}: ${e.message}`); process.exit(1); }

let hist = { generated: null, series: {} };
try { hist = { ...hist, ...JSON.parse(await readFile(outPath, 'utf8')) }; }
catch { /* first run */ }

let added = 0, updated = 0, skipped = 0;
for (const [symbol, p] of Object.entries(book.prices || {})) {
  if (!p || typeof p.close !== 'number' || !(p.close > 0)) { skipped++; continue; }
  const date = (p.date || book.asOf || '').slice(0, 10);
  /* A point without a date cannot be placed on a time axis, and guessing today
     would silently misdate it. */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }

  const s = hist.series[symbol] || (hist.series[symbol] = {});
  if (s[date] === undefined) { s[date] = p.close; added++; }
  else if (s[date] !== p.close) { s[date] = p.close; updated++; }   /* a correction wins */
}

/* Bound each series so the file cannot grow without limit. */
let trimmed = 0;
for (const [symbol, s] of Object.entries(hist.series)) {
  const dates = Object.keys(s).sort();
  if (dates.length <= KEEP) continue;
  for (const d of dates.slice(0, dates.length - KEEP)) { delete s[d]; trimmed++; }
}

hist.generated = new Date().toISOString();
hist.source = inPath;
hist.symbols = Object.keys(hist.series).length;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(hist, null, 2));

const depth = Object.values(hist.series).map(s => Object.keys(s).length);
console.log(`wrote ${outPath}`);
console.log(`  symbols   : ${hist.symbols}`);
console.log(`  new points: ${added}${updated ? `, ${updated} corrected` : ''}${skipped ? `, ${skipped} skipped (no usable close or date)` : ''}`);
console.log(`  depth     : ${depth.length ? `${Math.min(...depth)}-${Math.max(...depth)} day(s) per symbol` : 'none'}`);
if (trimmed) console.log(`  trimmed   : ${trimmed} point(s) beyond --keep ${KEEP}`);
