#!/usr/bin/env node
/**
 * Pulls live prices and history through a provider, into the lane its licence
 * allows and no further.
 *
 *   node ingest/live.mjs --quotes                     (prices for the watchlist)
 *   node ingest/live.mjs --history --days 400         (backfill the trend engine)
 *   node ingest/live.mjs --quotes --provider twelvedata
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LANE IS DECIDED BY THE LICENCE, NOT BY A FLAG
 *
 *   data/prices.json          is what the app serves. Licensed providers only.
 *   data/personal-prices.json is git-ignored and never published. Anything.
 *   data/price-history.json   is git-ignored. Feeds the trend engine.
 *
 *   An unlicensed provider cannot write the first file. Not by convention —
 *   the check runs before anything is written and there is no switch to turn
 *   it off. Yahoo's endpoints are undocumented and its terms prohibit
 *   redistribution, so the moment that data reached a page a subscriber paid
 *   for, the product would be in breach. Keeping it out of that file is the
 *   whole reason the two-lane split exists.
 *
 * SYMBOLS
 *   Bursa codes become Yahoo's form automatically: 1155 -> 1155.KL. Indices and
 *   currency pairs pass through as written (^KLSE, USDMYR=X).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { yahooProvider, twelveDataProvider } from './providers.mjs';

const argv = process.argv.slice(2);
const has  = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const WANT_QUOTES  = has('quotes');
const WANT_HISTORY = has('history');
const DAYS         = Number(flag('days', 400));
const PROVIDER     = flag('provider', 'yahoo');
const SERVED       = 'data/prices.json';
const PERSONAL     = flag('out', 'data/personal-prices.json');
const HISTORY      = 'data/price-history.json';

if (!WANT_QUOTES && !WANT_HISTORY) {
  console.error(`usage:
  node ingest/live.mjs --quotes
  node ingest/live.mjs --history [--days 400]
  node ingest/live.mjs --quotes --provider twelvedata

Providers:
  yahoo        default. Personal research only — cannot write the served file.
  twelvedata   licensed path. Needs TWELVEDATA_KEY, and TWELVEDATA_REDIST=1
               only if your plan actually permits redistribution.`);
  process.exit(1);
}

function makeProvider() {
  if (PROVIDER === 'twelvedata') {
    const apiKey = process.env.TWELVEDATA_KEY;
    if (!apiKey) { console.error('TWELVEDATA_KEY is not set.'); process.exit(1); }
    /* Asserted by the operator, never inferred from the presence of a key. */
    const redistribution = process.env.TWELVEDATA_REDIST === '1';
    if (!redistribution) console.warn('note: TWELVEDATA_REDIST is not 1, so this run is treated as unlicensed for redistribution.');
    return twelveDataProvider({ apiKey, redistribution });
  }
  return yahooProvider();
}

/* The instrument registry was written for the screenshot pipeline, so its
   symbols follow TradingView's conventions. Yahoo names the same instruments
   differently, and 57 of 103 came back empty on the first run for no reason
   other than that. This is the translation, and it is a table rather than a
   pattern because the naming is not systematic: an index is a caret symbol, a
   currency pair takes =X, a future takes =F, and crypto takes a hyphen.

   A symbol with no entry is passed through unchanged, so an unmapped
   instrument fails visibly as a missing quote rather than silently becoming a
   different instrument that happens to share a name. */
const YAHOO_SYMBOLS = {
  /* indices */
  US500:'^GSPC', US100:'^NDX', US30:'^DJI', US2000:'^RUT', VIX:'^VIX', DXY:'DX-Y.NYB',
  TSX:'^GSPTSE', IBOV:'^BVSP', MEXBOL:'^MXX', UK100:'^FTSE', CAC40:'^FCHI', EU50:'^STOXX50E',
  IBEX35:'^IBEX', FTSEMIB:'FTSEMIB.MI', AEX:'^AEX', OMXS30:'^OMX', NIKKEI:'^N225',
  HSI:'^HSI', HSCEI:'^HSCE', SHCOMP:'000001.SS', CN50:'^XIN9', KOSPI:'^KS11', TWII:'^TWII',
  NIFTY:'^NSEI', SENSEX:'^BSESN', ASX200:'^AXJO', NZ50:'^NZ50', KLSE:'^KLSE', SET:'^SET.BK',
  JKSE:'^JKSE', PSEI:'PSEI.PS', VNINDEX:'^VNINDEX',
  /* yields */
  US30Y:'^TYX', US10Y:'^TNX', US02Y:'^IRX',
  /* currency */
  USDMYR:'USDMYR=X', EURUSD:'EURUSD=X', GBPUSD:'GBPUSD=X', AUDUSD:'AUDUSD=X',
  NZDUSD:'NZDUSD=X', USDCAD:'USDCAD=X', USDJPY:'USDJPY=X', USDCNH:'USDCNH=X', USDSGD:'USDSGD=X',
  /* commodities — continuous front-month futures */
  XAUUSD:'GC=F', SILVER:'SI=F', COPPER:'HG=F', USOIL:'CL=F', UKOIL:'BZ=F', NATGAS:'NG=F',
  /* crypto */
  BTCUSD:'BTC-USD', ETHUSD:'ETH-USD', SUIUSDT:'SUI-USD',
  /* Deliberately absent: FCPO1! (Bursa crude palm oil futures) and XAUXAG
     (a gold/silver ratio, not an instrument). Yahoo carries neither, and
     mapping them to something adjacent would be substituting one instrument
     for another. They stay unmapped and report as missing. */
};

const toVendor = (sym, providerName) => {
  if (!providerName.startsWith('yahoo')) return sym;
  if (YAHOO_SYMBOLS[sym]) return YAHOO_SYMBOLS[sym];
  /* Bursa codes are four digits and take a .KL suffix. */
  if (/^\d{4}$/.test(sym)) return `${sym}.KL`;
  return sym;
};

async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
}

/* The symbols to fetch: the tracked instrument registry plus any watchlist
   file, deduplicated. */
async function symbolList() {
  const out = new Set();
  const inst = await readJson('data/instruments.json', null);
  for (const i of (inst?.instruments || [])) if (i.symbol) out.add(i.symbol);
  try {
    const txt = await readFile('watchlist-symbols.txt', 'utf8');
    txt.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).forEach(x => out.add(x));
  } catch { /* optional */ }
  return [...out];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const provider = makeProvider();
const symbols = await symbolList();

if (!symbols.length) {
  console.error('no symbols found in data/instruments.json or watchlist-symbols.txt');
  process.exit(1);
}

console.log(`provider : ${provider.name}`);
console.log(`licence  : ${provider.licensed ? 'licensed for redistribution' : 'NOT licensed — personal research lane only'}`);
console.log(`symbols  : ${symbols.length}`);

/* ------------------------------------------------------------------ quotes */
if (WANT_QUOTES) {
  const target = provider.licensed ? flag('out', SERVED) : PERSONAL;

  /* The check that cannot be configured away. */
  if (!provider.licensed && resolve(target) === resolve(SERVED)) {
    console.error(`\nrefusing: ${provider.name} is not licensed for redistribution and ${SERVED} is the file the app serves.`);
    console.error('Unlicensed data on a page someone paid for is a licensing breach, not a missing feature.');
    process.exit(1);
  }

  const prices = {};
  let ok = 0, miss = 0;
  for (const sym of symbols) {
    const q = await provider.quote(toVendor(sym, provider.name));
    if (q && Number.isFinite(q.price)) {
      prices[sym] = { price: q.price, currency: q.currency, asOf: q.asOf };
      ok++;
    } else { miss++; console.warn(`  no quote: ${sym}`); }
    await sleep(120);                      /* courteous, not adversarial */
  }

  const payload = {
    generated: new Date().toISOString(),
    source: provider.name,
    licence: provider.licensed ? (process.env.PRICE_LICENCE || 'stated by operator') : 'NONE — personal research only, not redistributable',
    licensed: provider.licensed,
    count: ok,
    prices,
  };
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(payload, null, 2));
  console.log(`\nquotes   : ${ok} written, ${miss} missing -> ${target}`);
}

/* ----------------------------------------------------------------- history */
if (WANT_HISTORY) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
  const hist = await readJson(HISTORY, { generated: null, series: {}, volume: {} });
  hist.series = hist.series || {}; hist.volume = hist.volume || {};

  let added = 0, symbolsDone = 0;
  for (const sym of symbols) {
    const rows = await provider.history(toVendor(sym, provider.name), from, to);
    if (!rows?.length) { console.warn(`  no history: ${sym}`); await sleep(150); continue; }
    const s = hist.series[sym] = hist.series[sym] || {};
    const v = hist.volume[sym] = hist.volume[sym] || {};
    for (const row of rows) {
      if (s[row.date] === undefined) added++;
      s[row.date] = row.close;
      if (row.volume != null) v[row.date] = row.volume;
    }
    symbolsDone++;
    await sleep(150);
  }

  hist.generated = new Date().toISOString();
  hist.symbols = Object.keys(hist.series).length;
  await mkdir(dirname(HISTORY), { recursive: true });
  await writeFile(HISTORY, JSON.stringify(hist, null, 2));

  const depths = Object.values(hist.series).map(x => Object.keys(x).length);
  const deepest = depths.length ? Math.max(...depths) : 0;
  console.log(`\nhistory  : ${added} new closes across ${symbolsDone} symbols -> ${HISTORY}`);
  console.log(`deepest series: ${deepest} points`);
  for (const [need, what] of [[20, '20-day average'], [50, '50-day average'],
                              [200, '200-day average and the 50/200 crossover'],
                              [252, '52-week range, drawdown and 12-month return']]) {
    console.log(`  ${deepest >= need ? 'available' : `needs ${need - deepest} more`}  ${what}`);
  }
}

if (!provider.licensed) {
  console.log('\nPersonal research only. This data is not licensed for redistribution,');
  console.log('is git-ignored, and must not be published with the site.');
}
