#!/usr/bin/env node
/**
 * End-of-day prices → data/prices.json
 *
 *   node ingest/prices.mjs --in prices.csv
 *   node ingest/prices.mjs --in vendor-dump.json --licence "Vendor X EOD redistribution, 2026"
 *
 * Deliberately vendor-neutral. You supply a file from whatever source you are
 * licensed for; this validates it and writes the shape the app reads. Swapping
 * vendors is then a different input file, not a code change.
 *
 * WHY EOD AND NOT REAL TIME
 *   Valuation, screening, portfolio tracking and thesis monitoring all work on
 *   end-of-day closes. Real-time exchange data is licensed per user with audit
 *   obligations and costs accordingly; end-of-day is a cheaper product with
 *   lighter redistribution terms. For a research product the capability loss
 *   is nil.
 *
 * WHAT THIS DOES NOT DO
 *   It does not obtain a licence for you. Broker-supplied data, a personal
 *   TradingView subscription and Yahoo Finance all permit you to LOOK at
 *   prices; none permits redistribution to your subscribers. Put the licence
 *   you actually hold in --licence so it travels with the data.
 *
 * CSV columns (header required, order free):
 *   symbol,date,close[,prev,high52,low52,ret12m,captured_at]
 *
 * captured_at (the review CSV from watchlist.mjs writes it) is the instant the
 * close was read. It is passed through to each price as capturedAt, so the
 * history store can record it and the engine can tell a close read after its
 * session from one read while the session traded.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { csvRows, numberCell, parseDateCell } from './history-store.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };

const inPath  = flag('in', null);
const outPath = flag('out', 'data/prices.json');
const licence = flag('licence', null);
const asOf    = flag('as-of', null);

if (!inPath) {
  console.error('usage: node ingest/prices.mjs --in <file.csv|file.json> [--out data/prices.json] [--licence "…"]');
  process.exit(1);
}

/* A number, or null. The store's numberCell reads the cell: blank is no
   reading, and a comma is a thousands separator only in groups of three —
   stripping every comma read a decimal-comma "10,5" as 105. */
const num = (v) => {
  const n = numberCell(v);
  return Number.isFinite(n) ? n : null;
};

/* Read as a CSV, not as lines split on commas (the store's csvRows): a
   quoted cell is one cell, so a header written "symbol","close" is found
   and a quoted "1,234.50" is a close, not "1" with the row shifted. */
function parseCSV(text) {
  const table = csvRows(text);
  if (!table.length) throw new Error('empty file');
  const head = table[0].cells.map(h => h.toLowerCase());
  const need = ['symbol', 'close'];
  for (const k of need) if (!head.includes(k)) throw new Error(`CSV is missing a required column: ${k}`);
  return table.slice(1).map(({ cells }) => {
    const row = {};
    head.forEach((h, i) => row[h] = cells[i] ?? '');
    return row;
  });
}

/* A JSON input is a list of rows, or an object holding one under prices or
   rows — and prices may be keyed by symbol, the shape this script, live.mjs
   and fx.mjs write. That shape was iterated as a list and crashed ("rows is
   not iterable"); each entry is now a row carrying its key as the symbol. */
function jsonRows(j) {
  const list = Array.isArray(j) ? j : (j?.prices ?? j?.rows ?? []);
  if (Array.isArray(list)) return list;
  if (list && typeof list === 'object') {
    return Object.entries(list).map(([symbol, v]) => ({ symbol, ...(v && typeof v === 'object' ? v : { close: v }) }));
  }
  throw new Error('the JSON holds no prices: give a list of rows, { "prices": [ … ] }, or { "prices": { SYMBOL: { close, date } } }');
}

const raw = await readFile(inPath, 'utf8');
const rows = inPath.toLowerCase().endsWith('.json') ? jsonRows(JSON.parse(raw)) : parseCSV(raw);

/* A date cell read as a session date, by the rule the history import and
   the browser's paste parser use (the store's parseDateCell): ISO as
   written, a day above 12 settles the order, and 03/04/2026 is refused as
   ambiguous. The cell used to be copied through unread: "26/09/2025" was
   refused as "in the future" (a string compared with an ISO date), and
   "03/04/2026" went into the file as written, for the page to show as the
   price's date. */
const readDate = (v) => {
  const s = String(v ?? '').trim();
  return s ? parseDateCell(s) : { date: null };
};
const asOfRead = asOf ? readDate(asOf) : null;
if (asOfRead?.error) { console.error(`--as-of: ${asOfRead.why}`); process.exit(1); }

/* "In the future" means after today ANYWHERE: a session date is its
   exchange's own date, and at 22:00 UTC it is already tomorrow in Auckland
   and Sydney. The engine's own FUTURE check, in the history store, judges
   each date in its market's zone. */
const today = new Date(Date.now() + 14 * 3600000).toISOString().slice(0, 10);
const prices = {};
const rejected = [];

for (const r of rows) {
  const symbol = String(r.symbol || r.ticker || '').trim().toUpperCase();
  const close = num(r.close ?? r.price ?? r.last);
  const dateRead = readDate(r.date || r.asof || asOfRead?.date || '');

  /* Reject rather than repair. A price that fails a sanity check is a data
     problem to look at, not something to quietly coerce into the file. */
  if (!symbol) { rejected.push({ row: r, why: 'no symbol' }); continue; }
  if (close == null || close <= 0) { rejected.push({ symbol, why: 'close is missing, unreadable or not positive' }); continue; }
  if (dateRead.error) { rejected.push({ symbol, why: dateRead.why }); continue; }
  const date = dateRead.date;
  if (date && date > today) { rejected.push({ symbol, why: `date ${date} is in the future` }); continue; }

  /* A review file from watchlist.mjs carries a verdict column. A row still
     marked CHECK has not been looked at by a human, and an unreviewed OCR
     candidate must never become a price. Vendor files have no such column and
     are unaffected. */
  if (String(r.verdict || '').trim().toUpperCase() === 'CHECK') {
    rejected.push({ symbol, why: 'still marked CHECK in the review file — confirm or correct it, then set the verdict to accept' });
    continue;
  }

  const prev = num(r.prev ?? r.previous ?? r.prevclose);
  const high52 = num(r.high52 ?? r.yearhigh);
  const low52 = num(r.low52 ?? r.yearlow);
  const ret12m = num(r.ret12m ?? r.change1y);

  if (high52 != null && low52 != null && low52 > high52) {
    rejected.push({ symbol, why: '52-week low is above the high' }); continue;
  }
  if (high52 != null && close > high52 * 1.02) {
    rejected.push({ symbol, why: `close ${close} exceeds the stated 52-week high ${high52}` }); continue;
  }

  const capturedRaw = String(r.captured_at ?? r.capturedat ?? r.capturedAt ?? '').trim();
  const capturedAt = capturedRaw && Number.isFinite(Date.parse(capturedRaw)) ? new Date(Date.parse(capturedRaw)).toISOString() : null;

  prices[symbol] = {
    close, date, ...(capturedAt ? { capturedAt } : {}),
    d1: prev != null && prev > 0 ? +(((close - prev) / prev) * 100).toFixed(3) : null,
    hi: high52, lo: low52,
    m12: ret12m,
  };
}

const stale = Object.values(prices).filter(p => p.date && (Date.now() - new Date(p.date)) / 86400000 > 7).length;

const payload = {
  generated: new Date().toISOString(),
  source: inPath,
  asOf: asOfRead?.date || Object.values(prices).map(p => p.date).filter(Boolean).sort().pop() || null,
  basis: 'end-of-day',
  delayMinutes: null,
  /* Recorded so the app can state, on screen, what right the prices are shown
     under. An unnamed licence shows as unverified rather than as licensed. */
  licence: licence || null,
  count: Object.keys(prices).length,
  prices,
  rejected,
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(payload, null, 2));

console.log(`wrote ${outPath}`);
console.log(`  accepted : ${payload.count}`);
console.log(`  rejected : ${rejected.length}${rejected.length ? ' — ' + rejected.slice(0, 5).map(r => `${r.symbol || '?'} (${r.why})`).join('; ') : ''}`);
console.log(`  as of    : ${payload.asOf || 'not stated'}${stale ? `  (${stale} rows older than 7 days)` : ''}`);
if (!licence) console.warn('! No --licence given. The app will show these prices as unverified.');
