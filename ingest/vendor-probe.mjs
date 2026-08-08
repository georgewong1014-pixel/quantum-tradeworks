#!/usr/bin/env node
/**
 * Does a paid vendor actually carry Bursa Malaysia FUNDAMENTALS?
 *
 *   TWELVEDATA_KEY=... node ingest/vendor-probe.mjs
 *   TWELVEDATA_KEY=... node ingest/vendor-probe.mjs --sarawak-only
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 *   A source review of roughly forty candidates returned one usable answer:
 *   there is no free, structured, redistributable source of Bursa fundamentals,
 *   and exactly one vendor combines confirmed Bursa symbol coverage with a
 *   redistribution right you can actually buy.
 *
 *   But symbol coverage is not statement coverage. That vendor's /stocks
 *   endpoint returns over a thousand Bursa rows to an unauthenticated caller,
 *   including every Sarawak name — while /income_statement returns 403 behind
 *   the paid tiers. Nobody has ever seen a Bursa income statement come out of
 *   it. A ticker appearing in a catalogue is not evidence a statement exists
 *   behind it, and that gap is exactly where a subscription decision goes wrong.
 *
 *   So: buy ONE MONTH of the cheapest tier that claims fundamentals, run this,
 *   and cancel if it comes back empty. Do not open redistribution negotiations
 *   before coverage is proven — the price of the licence is irrelevant if the
 *   statements are not there.
 *
 * WHAT IT WILL NOT DO
 *   It writes nothing. Not to data/, not anywhere. This answers a purchasing
 *   question and is not an ingest path — the ingest path is written once a
 *   vendor has passed, against terms that have been read.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { twelveDataProvider } from './providers.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);

/* The companies the decision actually rests on. Sarawak names first, because a
   vendor covering Maybank and not Cahya Mata does not solve this product's
   problem — the whole point of the Malaysian side is the state economy. */
const SARAWAK = [
  ['2852', 'Cahya Mata Sarawak Berhad'],
  ['5126', 'Sarawak Oil Palms Berhad'],
  ['5012', 'Ta Ann Holdings Berhad'],
  ['5073', 'Naim Holdings Berhad'],
  ['5141', 'Dayang Enterprise Holdings Bhd'],
  ['5032', 'Bintulu Port Holdings Berhad'],
  ['5135', 'Sarawak Plantation Berhad'],
  ['9466', 'KKB Engineering Berhad'],
  ['9237', 'Sarawak Consolidated Industries Berhad'],
  ['5084', 'Ibraco Berhad'],
  ['8869', 'Press Metal Aluminium Holdings Berhad'],
];
const ANCHORS = [
  ['1155', 'Malayan Banking Berhad'],
  ['5347', 'Tenaga Nasional Berhad'],
  ['1295', 'Public Bank Berhad'],
];

/* Figures taken from audited accounts, for checking that what comes back is the
   statement and not something adjacent to it. The review that produced this
   list caught a source quoting Bintulu Port FY2025 revenue as RM877,524k, which
   is the sustainability statement's "economic value generated" — the audited
   P&L says RM824,082k. A vendor returning the larger number is not returning
   the income statement, and a coverage check that only asks "did a number
   arrive" would pass it. */
const KNOWN = {
  '5032': { year: 2025, field: 'revenue', expect: 824.082e6,
            note: 'audited P&L total revenue. RM877,524k is the sustainability statement, not the accounts.' },
};

const key = process.env.TWELVEDATA_KEY;
if (!key) {
  console.error(`TWELVEDATA_KEY is not set.

This probe exists to be run against a paid month before committing to a vendor:

  TWELVEDATA_KEY=your-key node ingest/vendor-probe.mjs

Free-tier keys will return 403 on the fundamentals endpoints, which is a valid
result and will be reported as "paywalled" rather than "absent".`);
  process.exit(1);
}

/* Redistribution is irrelevant to a coverage question and is deliberately not
   asserted here, so nothing this script does can be read as a licence claim. */
const provider = twelveDataProvider({ apiKey: key, redistribution: false });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function call(path, params) {
  const url = `https://api.twelvedata.com/${path}?${params}&apikey=${key}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    const body = await r.json().catch(() => null);
    /* Their failures arrive with HTTP 200 and a status field, so the HTTP code
       alone tells you nothing. */
    if (body?.status === 'error') {
      /* Their errors carry the real code in the body, not the HTTP status —
         verified: a request with an unentitled key returns HTTP 200 with
         {code:403,...}. Both the code and the wording are checked, because the
         wording varies: an unentitled paid key is told about plans, while a
         free key is told the endpoint is "only used for initial familiarity",
         which no plan-related regex would catch. */
      const paywalled = body.code === 403
        || /plan|upgrade|not available with your|familiar/i.test(body.message || '');
      return { ok: false, paywalled, message: body.message || 'error', http: r.status, code: body.code };
    }
    return { ok: r.ok, body, http: r.status };
  } catch (e) {
    return { ok: false, message: e.message, http: null };
  }
}

const targets = has('sarawak-only') ? SARAWAK : [...SARAWAK, ...ANCHORS];

console.log('probing Bursa fundamentals coverage');
console.log(`vendor   : ${provider.name}`);
console.log(`targets  : ${targets.length} companies (${SARAWAK.length} Sarawak)\n`);
console.log('  code   quote  income  balance  cashflow  years  company');
console.log('  ' + '-'.repeat(74));

const rows = [];
for (const [code, name] of targets) {
  const sym = `${code}:XKLS`;
  const quote = await provider.quote(sym);
  const inc = await call('income_statement', `symbol=${encodeURIComponent(sym)}&period=annual`);
  await sleep(300);
  const bal = await call('balance_sheet', `symbol=${encodeURIComponent(sym)}&period=annual`);
  await sleep(300);
  const cfs = await call('cash_flow', `symbol=${encodeURIComponent(sym)}&period=annual`);
  await sleep(300);

  const mark = (r, listKey) => {
    if (r.paywalled) return 'PAID';
    if (!r.ok) return 'no';
    const list = r.body?.[listKey] || r.body?.income_statement || r.body?.balance_sheet || r.body?.cash_flow;
    return Array.isArray(list) && list.length ? 'yes' : 'empty';
  };
  const iMark = mark(inc, 'income_statement');
  const bMark = mark(bal, 'balance_sheet');
  const cMark = mark(cfs, 'cash_flow');
  const statements = inc.body?.income_statement;
  const years = Array.isArray(statements) ? statements.length : 0;

  rows.push({ code, name, quote: !!quote, iMark, bMark, cMark, years, inc });
  console.log(`  ${code.padEnd(6)} ${(quote ? 'yes' : 'no').padEnd(6)} ${iMark.padEnd(7)} ${bMark.padEnd(8)} `
    + `${cMark.padEnd(9)} ${String(years).padStart(5)}  ${name}`);
}

/* -------------------------------------------------------------- known values */
console.log('\nknown-value checks — is this the statement, or something adjacent to it?');
let checked = 0, matched = 0;
for (const [code, expect] of Object.entries(KNOWN)) {
  const row = rows.find(r => r.code === code);
  const list = row?.inc?.body?.income_statement;
  if (!Array.isArray(list) || !list.length) { console.log(`  ${code}  no statement returned — not checked`); continue; }
  const hit = list.find(s => String(s.fiscal_date || s.fiscal_year || '').startsWith(String(expect.year)));
  const got = Number(hit?.sales ?? hit?.revenue ?? hit?.total_revenue);
  checked++;
  if (!Number.isFinite(got)) { console.log(`  ${code}  FY${expect.year} present but no revenue line found`); continue; }
  /* Within a tenth of a percent, which is rounding rather than a different
     figure. Anything wider is a different figure. */
  const close = Math.abs(got - expect.expect) / expect.expect < 0.001;
  if (close) matched++;
  console.log(`  ${code}  FY${expect.year} ${expect.field}: got ${got.toLocaleString()}, audited ${expect.expect.toLocaleString()} — ${close ? 'MATCH' : 'DIFFERS'}`);
  if (!close) console.log(`        ${expect.note}`);
}

/* ------------------------------------------------------------------- verdict */
const withIncome = rows.filter(r => r.iMark === 'yes');
const swkWithIncome = withIncome.filter(r => SARAWAK.some(([c]) => c === r.code));
const paywalled = rows.filter(r => r.iMark === 'PAID').length;

console.log(`\n${'='.repeat(76)}`);
if (paywalled === rows.length) {
  console.log('VERDICT: every fundamentals endpoint is paywalled on this key.');
  console.log('This tells you nothing about coverage. Upgrade to the cheapest tier that');
  console.log('claims fundamentals and run it again — that is the whole question.');
} else if (!withIncome.length) {
  console.log('VERDICT: no income statement returned for any Bursa company.');
  console.log('Symbol coverage without statement coverage is what this probe exists to');
  console.log('catch. Cancel before the month renews.');
} else {
  console.log(`VERDICT: income statements returned for ${withIncome.length} of ${rows.length} companies,`);
  console.log(`         ${swkWithIncome.length} of ${SARAWAK.length} Sarawak names.`);
  if (checked && matched < checked)
    console.log(`         WARNING: ${checked - matched} of ${checked} known-value checks did not match.`);
  console.log('');
  console.log('Coverage is necessary and not sufficient. Before buying a year:');
  console.log('  1. Confirm in writing that the plan permits REDISTRIBUTION to your');
  console.log('     end users, not merely display to you.');
  console.log('  2. Confirm it permits DERIVED use — valuation models are derived data');
  console.log('     and some licences price that separately.');
  console.log('  3. Read the termination clause. One vendor was ruled out solely because');
  console.log('     it requires deleting all copies within a month of termination, and a');
  console.log('     public git history cannot be un-published.');
}
console.log('='.repeat(76));
console.log('\nNothing was written. This answers a purchasing question, not an ingest one.');
