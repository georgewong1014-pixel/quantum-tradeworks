#!/usr/bin/env node
/**
 * USD/MYR from official sources, cross-checked, merged into a price file.
 *
 *   node ingest/fx.mjs                                  # -> data/prices.json
 *   node ingest/fx.mjs --out data/personal-prices.json  # alongside OCR prices
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT THE SCREENSHOT PATH
 *   Bank Negara Malaysia publishes the reference rate as open data through its
 *   own public API. It is the authority for the ringgit, it is free, it needs
 *   no key, and it carries none of the redistribution problem that a broker
 *   feed or a personal TradingView subscription does. So unlike watchlist.mjs,
 *   this is allowed to write data/prices.json — the file the app serves.
 *
 *   Confirm BNM's current terms before relying on it commercially; open data
 *   is not the same as an unrestricted licence, and terms change.
 *
 * WHY TWO SOURCES
 *   A single rate has nothing to check it against. BNM is the authority and
 *   Frankfurter (ECB reference rates) is independent of it, so agreement
 *   between them is real evidence and disagreement is a reason to stop. One
 *   number that every ringgit figure in the product passes through deserves
 *   that much.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };

const outPath = flag('out', 'data/prices.json');
const tolPct  = Number(flag('tolerance', 1.5));   /* % disagreement that stops the run */

const get = async (url, headers) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
};

/* --- source 1: Bank Negara Malaysia, the authority for the ringgit -------- */
async function fromBNM() {
  const j = await get('https://api.bnm.gov.my/public/exchange-rate/USD?session=1130&quote=rm',
    { Accept: 'application/vnd.BNM.API.v1+json' });
  const r = j?.data?.rate;
  if (!r) throw new Error('BNM returned no rate');
  /* middle_rate is frequently null in the published payload, so derive the mid
     from the two sides rather than trusting a field that is usually empty. */
  const mid = r.middle_rate ?? ((r.buying_rate + r.selling_rate) / 2);
  if (!Number.isFinite(mid)) throw new Error('BNM rate is not a number');
  return { rate: +mid.toFixed(4), date: r.date || null,
           source: 'Bank Negara Malaysia', detail: `buying ${r.buying_rate}, selling ${r.selling_rate}` };
}

/* --- source 2: independent, for the cross-check -------------------------- */
async function fromFrankfurter() {
  const j = await get('https://api.frankfurter.app/latest?from=USD&to=MYR');
  const rate = j?.rates?.MYR;
  if (!Number.isFinite(rate)) throw new Error('Frankfurter returned no MYR rate');
  return { rate: +rate.toFixed(4), date: j.date || null,
           source: 'Frankfurter (ECB reference rates)', detail: 'ECB daily reference' };
}

const settle = await Promise.allSettled([fromBNM(), fromFrankfurter()]);
const ok = settle.filter(s => s.status === 'fulfilled').map(s => s.value);
const bad = settle.filter(s => s.status === 'rejected').map(s => s.reason.message);

for (const b of bad) console.warn(`! source unavailable: ${b}`);
if (!ok.length) { console.error('No source returned a rate. Nothing written.'); process.exit(1); }

for (const s of ok) console.log(`  ${s.source.padEnd(34)} ${s.rate}  (${s.date})  ${s.detail}`);

/* BNM is the authority; it wins when both are present. */
const chosen = ok.find(s => s.source.startsWith('Bank Negara')) || ok[0];

let agreement = null;
if (ok.length === 2) {
  const [a, b] = ok;
  agreement = Math.abs(a.rate - b.rate) / ((a.rate + b.rate) / 2) * 100;
  console.log(`\n  sources differ by ${agreement.toFixed(3)}%`);
  if (agreement > tolPct) {
    console.error(`\nRefusing to write: the two sources disagree by more than ${tolPct}%.`);
    console.error('That is not a rounding difference — one of them is wrong, and every');
    console.error('ringgit figure in the product passes through this number.');
    process.exit(1);
  }
} else {
  console.log('\n  ! only one source responded — no cross-check was possible');
}

/* Same band the app enforces. Checked here too so a bad rate never reaches the
   file, rather than relying on the reader to catch it. */
if (chosen.rate < 2 || chosen.rate > 8) {
  console.error(`\nRefusing to write: ${chosen.rate} is outside a plausible band for USD/MYR.`);
  process.exit(1);
}

/* --- merge, never overwrite ---------------------------------------------- */
let book = { generated: null, source: null, asOf: null, basis: 'end-of-day',
             delayMinutes: null, licence: null, count: 0, prices: {}, rejected: [] };
try { book = { ...book, ...JSON.parse(await readFile(outPath, 'utf8')) }; }
catch { /* first run — a new file */ }

const before = book.prices.USDMYR?.close ?? null;
book.prices.USDMYR = {
  close: chosen.rate,
  date: chosen.date,
  d1: null, hi: null, lo: null, m12: null,
  /* Per-symbol provenance, because this row may sit in a file whose other rows
     came from somewhere else entirely — a screenshot, say. Without it the app
     would label an official central-bank rate with the file's provenance. */
  src: chosen.source,
  crossChecked: ok.length === 2 ? `${ok.map(s => s.rate).join(' vs ')} (${agreement.toFixed(3)}% apart)` : null,
};
book.count = Object.keys(book.prices).length;
book.generated = new Date().toISOString();
if (!book.asOf || (chosen.date && chosen.date > book.asOf)) book.asOf = chosen.date;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(book, null, 2));

console.log(`\nwrote ${outPath}`);
console.log(`  USD/MYR : ${before != null ? `${before} -> ` : ''}${chosen.rate}`);
console.log(`  source  : ${chosen.source}`);
console.log(`  as of   : ${chosen.date || 'not stated'}`);
console.log(`  other rows in the file were left untouched (${book.count} symbols total)`);
