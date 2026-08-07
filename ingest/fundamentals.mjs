#!/usr/bin/env node
/**
 * Annual statements for instruments the SEC does not cover — which, for this
 * product, means every Malaysian company it holds.
 *
 *   node ingest/fundamentals.mjs                 (every MY equity in the registry)
 *   node ingest/fundamentals.mjs --only 2852,5126
 *   node ingest/fundamentals.mjs --sarawak       (only the Sarawak-flagged ones)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CHANGES, AND WHAT IT DOES NOT
 *
 *   data/instruments.json has said for months that Bursa Malaysia publishes no
 *   machine-readable financial statements and that no Malaysian issuer files
 *   XBRL anywhere this product can reach. Both halves are still true of Bursa
 *   and of XBRL. What was wrong was the conclusion drawn from them — that the
 *   statements were therefore unreachable. They are reachable, and the figures
 *   reconcile against the companies' own published accounts.
 *
 *   That is a statement about what is POSSIBLE. It settles nothing about what
 *   is PERMITTED, and the two have been confused often enough in this project's
 *   history to be worth separating explicitly:
 *
 *     obtainable  — yes, today, for every Malaysian company in the registry
 *     licensed    — no, and there is no version of this that becomes licensed
 *                   by adding an API key or paying anyone
 *
 *   So the output is git-ignored and the writer refuses to put an unlicensed
 *   provider anywhere the deployed site can read. The Malaysian half of the
 *   product still says "no financial statements held" to every visitor, and
 *   that stays true until someone buys a licence. What changes is that the
 *   OWNER can now run the same engine over real Malaysian numbers for their own
 *   research, which is the lane this repository already built for prices.
 *
 * FOUR YEARS, NOT TEN
 *   SEC gives ten years of history. This gives four. Every measure with a
 *   longer window must report itself unavailable rather than quietly compute
 *   over a shorter one — a "5-year CAGR" over three years is a different
 *   statistic wearing the same label.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { yahooProvider } from './providers.mjs';

const argv = process.argv.slice(2);
const has  = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const OUT      = flag('out', 'data/personal-fundamentals.json');
const ONLY     = flag('only', null);
const SARAWAK  = has('sarawak');
/* Files the deployed site reads. Nothing unlicensed may be written to one. */
const SERVED   = ['data/us.json', 'data/instruments.json', 'data/sarawak-geo.json'];

const provider = yahooProvider();

/* The check that cannot be configured away — the same posture ingest/live.mjs
   takes, for the same reason. */
if (!provider.licensed && SERVED.some(f => resolve(f) === resolve(OUT))) {
  console.error(`\nrefusing: ${provider.name} is not licensed for redistribution, and`);
  console.error(`${OUT} is a file the deployed site serves.`);
  console.error('Unlicensed statements on a page someone paid for is a licensing breach,');
  console.error('not a missing feature.');
  process.exit(1);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readJson = async (p, fb) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fb; } };

const reg = await readJson('data/instruments.json', { instruments: [] });
let targets = (reg.instruments || []).filter(i => i.market === 'MY' && i.kind === 'equity');
if (SARAWAK) targets = targets.filter(i => i.sarawak);
if (ONLY) {
  const want = new Set(ONLY.split(',').map(s => s.trim()));
  targets = targets.filter(i => want.has(i.symbol));
}

if (!targets.length) {
  console.error('no matching instruments in data/instruments.json');
  process.exit(1);
}

console.log(`provider : ${provider.name}`);
console.log(`licence  : NOT licensed for redistribution — personal research lane only`);
console.log(`targets  : ${targets.length} Malaysian equities${SARAWAK ? ' (Sarawak-flagged)' : ''}\n`);

const results = [];
const failures = [];

for (const inst of targets) {
  /* Bursa codes take .KL, the same translation ingest/live.mjs applies. */
  const vendorSymbol = /^\d{4}$/.test(inst.symbol) ? `${inst.symbol}.KL` : inst.symbol;
  let f = null;
  try { f = await provider.fundamentals(vendorSymbol); }
  catch (e) { failures.push({ symbol: inst.symbol, name: inst.name, reason: e.message }); }

  if (!f || !f.years?.length) {
    if (!failures.some(x => x.symbol === inst.symbol))
      failures.push({ symbol: inst.symbol, name: inst.name, reason: 'no statements returned' });
    console.log(`  ${inst.symbol.padEnd(6)} —      ${inst.name}`);
    await sleep(400);
    continue;
  }

  const complete = f.fin.filter(row => row.every(v => v != null)).length;
  results.push({
    id: inst.symbol,
    name: inst.name,
    tk: inst.symbol,
    mkt: 'MY',
    ccy: f.currency || 'MYR',
    exch: 'Bursa Malaysia',
    sector: inst.sector || 'Unclassified',
    sarawak: !!inst.sarawak,
    sarawakTheme: inst.sarawakTheme || null,
    years: f.years,
    fin: f.fin,
    extra: f.extra,
    gaps: f.gaps,
    /* Completeness against the ten statement lines across every year returned,
       computed the same way the SEC extractor computes it. */
    completeness: Math.round(
      f.fin.flat().filter(v => v != null).length / (f.fin.length * 10) * 100),
    provenance: 'personal-research',
    source: f.source,
    retrieved: new Date().toISOString().slice(0, 10),
  });

  console.log(`  ${inst.symbol.padEnd(6)} ${String(f.years[0]).slice(2)}–${String(f.years[f.years.length - 1]).slice(2)}  `
    + `${String(f.years.length).padStart(2)}y  ${String(complete).padStart(2)}/${f.years.length} complete  ${inst.name}`);
  await sleep(400);                          /* courteous, not adversarial */
}

const payload = {
  generated: new Date().toISOString(),
  source: provider.name,
  licensed: false,
  licence: 'NONE — personal research only. Not redistributable. This file is git-ignored and must never be deployed.',
  warning: 'Every figure here was retrieved from an undocumented endpoint whose terms prohibit redistribution. It may be used for the owner\'s own research and for nothing else. If this file reaches a public deployment, that is a licensing breach.',
  yearsAvailable: 4,
  yearsNote: 'Four fiscal years, against the ten SEC provides for US filers. Any measure needing a longer window must report itself unavailable rather than compute over a shorter one.',
  count: results.length,
  results,
  failures,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 2));

const swk = results.filter(r => r.sarawak).length;
console.log(`\nwrote ${OUT}`);
console.log(`  ${results.length} companies with statements${swk ? `, ${swk} of them Sarawak-flagged` : ''}`);
if (failures.length) {
  console.log(`  ${failures.length} returned nothing:`);
  failures.forEach(f => console.log(`    ${f.symbol} ${f.name} — ${f.reason}`));
}
const median = results.length
  ? results.map(r => r.completeness).sort((a, b) => a - b)[Math.floor(results.length / 2)] : 0;
console.log(`  median completeness ${median}% of the ten statement lines`);

console.log('\nPersonal research only. This file is git-ignored, is not licensed for');
console.log('redistribution, and must not be published with the site. The deployed');
console.log('product still holds no Malaysian financial statements, and still says so.');
