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
     from the two sides rather than trusting a field that is usually empty —
     from BOTH sides. A side sent as null was added as nought (null + 4.5 is
     4.5), so a missing buying rate halved the mid to 2.25: inside the
     plausible band, and written as the ringgit rate whenever the second
     source was down and there was nothing to disagree with it. */
  const side = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const buy = side(r.buying_rate), sell = side(r.selling_rate);
  const mid = r.middle_rate ?? (buy != null && sell != null ? (buy + sell) / 2 : NaN);
  if (!Number.isFinite(mid)) throw new Error(r.middle_rate == null && (buy == null || sell == null)
    ? `BNM sent no middle rate and not both sides (buying ${r.buying_rate}, selling ${r.selling_rate}) — no mid can be derived`
    : 'BNM rate is not a number');
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
/* Only a file that is not there is a first run. Every failure to read the
   file was taken for one, and a new file holding the rate alone was written
   over it — "other rows in the file were left untouched (1 symbols total)":
   a price file saved with a byte-order mark (which the browser reads past),
   or one cut short, lost every price it held; one whose prices were a list
   took the rate as a key the list does not keep, and lost it. A mark is
   read past; a file that is still not a price file of symbols is refused,
   and nothing is written over it. */
let book = { generated: null, source: null, asOf: null, basis: 'end-of-day',
             delayMinutes: null, licence: null, count: 0, prices: {}, rejected: [] };
let text = null;
try { text = await readFile(outPath, 'utf8'); }
catch (e) {
  if (e.code !== 'ENOENT') { console.error(`\nRefusing to write: ${outPath} could not be read (${e.message}), and writing would replace the rows it holds.`); process.exit(1); }
}
if (text != null) {
  let held, why = null;
  try { held = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { why = `it is not JSON: ${e.message}`; }
  const isMap = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  if (!why && !isMap(held)) why = 'it holds no object';
  if (!why && held.prices != null && !isMap(held.prices)) why = 'its prices are not keyed by symbol';
  if (why) { console.error(`\nRefusing to write: ${outPath} is not a price file this can merge into — ${why}. Writing would replace the rows it holds; correct or move it, then run again.`); process.exit(1); }
  book = { ...book, ...held, prices: held.prices ?? {} };
}

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
/* The file's as-of is its rows', and the rate carries its own date. It was
   moved to the rate's date whenever that was later, and a close the file
   holds with no date of its own is read at the file's as-of — by the app,
   and by history.mjs, which filed an undated vendor close under the day
   Bank Negara published the rate. Only a file holding the rate alone takes
   the rate's date. */
const others = Object.keys(book.prices).filter(k => k !== 'USDMYR').length;
if (!others && (!book.asOf || (chosen.date && chosen.date > book.asOf))) book.asOf = chosen.date;

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(book, null, 2));

console.log(`\nwrote ${outPath}`);
console.log(`  USD/MYR : ${before != null ? `${before} -> ` : ''}${chosen.rate}`);
console.log(`  source  : ${chosen.source}`);
console.log(`  as of   : ${chosen.date || 'not stated'}`);
console.log(`  other rows in the file were left untouched (${book.count} symbols total)`);
