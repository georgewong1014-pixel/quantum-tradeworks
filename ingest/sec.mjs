#!/usr/bin/env node
/**
 * SEC XBRL → Quantum Tradeworks statement tuples.
 *
 *   node ingest/sec.mjs AAPL MSFT JPM
 *   node ingest/sec.mjs --years 10 --out data/us.json AAPL MSFT
 *
 * Pulls audited annual figures from the SEC's companyfacts API and normalises
 * them into the exact tuple the derivation engine already consumes:
 *
 *   [revenue, ebit, netIncome, opCashFlow, capex, equity, debt, cash, shares, dps]
 *
 * in USD billions (shares in billions, dps per share).
 *
 * The engine is unchanged. This file only produces its input.
 *
 * WHY THIS SOURCE
 *   SEC EDGAR is official, free, unauthenticated and carries no redistribution
 *   licence problem for US reported fundamentals. It does NOT carry prices,
 *   corporate actions or any non-US issuer — see ingest/README.md.
 *
 * FAIR ACCESS
 *   The SEC requires a descriptive User-Agent with a contact address and asks
 *   for no more than 10 requests a second. Set SEC_UA before running in
 *   anything other than a local experiment.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const UA = process.env.SEC_UA || 'QuantumTradeworks/0.1 (contact: set SEC_UA env var)';
const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' };
const SLEEP_MS = 120;                       /* comfortably under 10 req/s */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------- concepts */
/* Filers do not agree on tags. Each line is a priority chain: the first
   concept that yields a usable annual series wins, and which one was used is
   reported, because "revenue" meaning three different tags across a peer group
   is exactly how a comparison quietly becomes wrong. */
const LINES = [
  { key: 'rev',   taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'Revenues', 'SalesRevenueNet', 'SalesRevenueGoodsNet',
      /* banks present revenue net of interest expense and never use the above */
      'RevenuesNetOfInterestExpense', 'InterestAndDividendIncomeOperating' ] },
  /* Integrated oil and most banks do not present an operating-income line at
     all. Pre-tax income is the nearest defensible proxy, and because it is a
     proxy rather than the same measure, a series built from it is flagged. */
  { key: 'ebit',  taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'OperatingIncomeLoss',
      'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
      'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments' ] },
  { key: 'ni',    taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'NetIncomeLoss', 'ProfitLoss' ] },
  { key: 'ocf',   taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations' ] },
  { key: 'capex', taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'PaymentsToAcquirePropertyPlantAndEquipment',
      'PaymentsToAcquireProductiveAssets' ] },
  { key: 'eq',    taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'StockholdersEquity',
      'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest' ] },
  { key: 'debtL', taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'LongTermDebtNoncurrent', 'LongTermDebt',
      'LongTermDebtAndCapitalLeaseObligations' ] },
  { key: 'debtC', taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent' ] },
  { key: 'cash',  taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents' ] },
  { key: 'sh',    taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'CommonStockSharesOutstanding', 'CommonStockSharesIssued' ], unit: 'shares' },
  { key: 'shWtd', taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'WeightedAverageNumberOfDilutedSharesOutstanding',
      'WeightedAverageNumberOfSharesOutstandingBasic' ], unit: 'shares' },
  { key: 'dps',   taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'CommonStockDividendsPerShareDeclared',
      'CommonStockDividendsPerShareCashPaid' ], unit: 'USD/shares' },
];

/* ------------------------------------------------------------------ helpers */
const yearOf = (iso) => Number(String(iso).slice(0, 4));
const days = (a, b) => (new Date(b) - new Date(a)) / 86400000;

/**
 * Reduce one concept's raw fact list to { fiscalYear: value }.
 *
 * Two decisions worth naming:
 *  - Annual duration facts are those spanning 330–400 days. A 10-K restates
 *    prior years, so the same period appears many times.
 *  - Where a period appears more than once, the most recently FILED value wins.
 *    That is a restatement policy: latest-known rather than as-first-reported.
 *    A point-in-time store would keep both; this flattens to latest.
 */
function annualSeries(facts, kind, unitPref) {
  const units = facts?.units || {};
  const unitKey = Object.keys(units).find(u => u === unitPref)
    || Object.keys(units).find(u => u === 'USD')
    || Object.keys(units)[0];
  if (!unitKey) return { series: {}, unit: null };

  const out = {};
  for (const f of units[unitKey]) {
    if (!f.end || f.val == null) continue;
    if (kind === 'duration') {
      if (!f.start) continue;
      const d = days(f.start, f.end);
      if (d < 330 || d > 400) continue;              /* annual periods only */
    }
    const y = yearOf(f.end);
    const prev = out[y];
    if (!prev || (f.filed || '') > (prev.filed || '')) out[y] = { val: f.val, filed: f.filed, form: f.form };
  }
  return { series: Object.fromEntries(Object.entries(out).map(([y, v]) => [y, v.val])), unit: unitKey };
}

/**
 * Assemble one line by MERGING across the fallback chain, year by year.
 *
 * Picking a single winning concept fails on real filers, because tags change
 * mid-history: ASC 606 moved most issuers off `Revenues` and onto
 * `RevenueFromContractWithCustomer…` around 2018, so neither tag covers the
 * full ten years on its own. Walking the chain per year stitches the history
 * back together.
 *
 * The cost is that a series can be assembled from more than one concept, which
 * is a genuine comparability risk — so every year records which tag supplied
 * it, and `mixedTags` is surfaced rather than hidden.
 */
function resolveLine(allFacts, line, years) {
  const loaded = [];
  for (const concept of line.concepts) {
    const facts = allFacts?.[line.taxonomy]?.[concept];
    if (!facts) continue;
    const { series, unit } = annualSeries(facts, line.kind, line.unit);
    if (Object.keys(series).length) loaded.push({ concept, series, unit });
  }
  if (!loaded.length) return null;

  const series = {}, byYear = {}, used = new Set();
  for (const y of years) {
    for (const cand of loaded) {
      if (cand.series[y] != null) {
        series[y] = cand.series[y];
        byYear[y] = cand.concept;
        used.add(cand.concept);
        break;                                   /* chain order is priority */
      }
    }
  }
  const hits = years.filter(y => series[y] != null).length;
  if (!hits) return null;
  return {
    concept: [...used].join(' + '),
    concepts: [...used], byYear, series, unit: loaded[0].unit,
    coverage: hits / years.length,
    mixedTags: used.size > 1,
    weak: hits < Math.max(2, Math.ceil(years.length * 0.5)),
  };
}

/* ------------------------------------------------------------------- fetch */
async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/**
 * Curated identity overrides.
 *
 * The SEC's ticker register maps a symbol to whichever entity currently holds
 * it, which is NOT always the entity that filed the history. XOM is the live
 * example: the register points at CIK 2115436 "ExxonMobil Holdings Corp",
 * created in a holding-company reorganisation, which has no us-gaap facts at
 * all — while seventeen years of statements sit under CIK 34088 "EXXON MOBIL
 * CORP".
 *
 * Trusting ticker → CIK blindly therefore attributes financials to the wrong
 * legal entity, or loses them entirely. Every production system ends up with a
 * curated identity table for exactly this. This is the beginning of ours.
 */
const CIK_OVERRIDES = {
  XOM: { cik: '0000034088', title: 'Exxon Mobil Corporation',
         note: 'register points at the post-reorganisation holdco, which has no filing history' },
};

let tickerMap = null;
async function cikFor(ticker) {
  const t = ticker.toUpperCase();
  if (CIK_OVERRIDES[t]) return { ...CIK_OVERRIDES[t], overridden: true };
  if (!tickerMap) {
    const j = await getJSON('https://www.sec.gov/files/company_tickers.json');
    tickerMap = new Map(Object.values(j).map(x => [x.ticker.toUpperCase(), x]));
  }
  const hit = tickerMap.get(t);
  if (!hit) throw new Error(`ticker not found in SEC register: ${ticker}`);
  return { cik: String(hit.cik_str).padStart(10, '0'), title: hit.title };
}

/* ---------------------------------------------------------------- ingest one */
export async function ingestTicker(ticker, nYears) {
  const { cik, title, overridden } = await cikFor(ticker);
  const facts = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);

  /* An identity guard, not a formality. A ticker can resolve to a shell or a
     newly formed holdco that has never filed a financial statement — the data
     is not "missing", it is attached to a different legal entity. Fail loudly
     and name both, because silently attributing figures to the wrong company
     is the worst outcome available here. */
  if (!facts.facts || !facts.facts['us-gaap']) {
    throw new Error(
      `${ticker} resolves to CIK ${cik} (${facts.entityName || title}), which reports no us-gaap facts ` +
      `(taxonomies: ${Object.keys(facts.facts || {}).join(', ') || 'none'}). ` +
      `The symbol probably points at a holding or successor entity — add a CIK_OVERRIDES entry for the filer.`);
  }

  /* Anchor the window on the most recent year that has revenue, not on today —
     a company filing in March has no complete year for the current one. */
  const probe = resolveLine(facts.facts, LINES[0], Array.from({ length: 14 }, (_, i) => new Date().getFullYear() - i));
  if (!probe) throw new Error(`no usable revenue concept for ${ticker}`);
  const latest = Math.max(...Object.keys(probe.series).map(Number));
  const years = Array.from({ length: nYears }, (_, i) => latest - nYears + 1 + i);

  const resolved = {}, provenance = {}, gaps = [];
  for (const line of LINES) {
    const r = resolveLine(facts.facts, line, years);
    if (!r) { gaps.push({ line: line.key, reason: 'no concept in the fallback chain returned data' }); continue; }
    resolved[line.key] = r.series;
    provenance[line.key] = { concept: r.concept, unit: r.unit, coverage: +r.coverage.toFixed(2),
                             weak: !!r.weak, mixedTags: !!r.mixedTags, byYear: r.byYear };
    if (r.mixedTags) gaps.push({ line: line.key, warning: 'series assembled from more than one XBRL tag', concepts: r.concepts });
    const missing = years.filter(y => r.series[y] == null);
    if (missing.length) gaps.push({ line: line.key, concept: r.concept, missingYears: missing });
  }

  const B = 1e9;
  const pick = (k, y) => (resolved[k]?.[y] ?? null);
  const fin = years.map(y => {
    const debt = (() => {
      const l = pick('debtL', y), c = pick('debtC', y);
      if (l == null && c == null) return null;
      return ((l || 0) + (c || 0)) / B;
    })();
    /* Shares outstanding is an instant and often absent; the weighted diluted
       count is a duration and nearly always present. Prefer the instant, fall
       back, and record which was used. */
    const shares = pick('sh', y) ?? pick('shWtd', y);
    const div = (v) => v == null ? null : v / B;
    return [
      div(pick('rev', y)), div(pick('ebit', y)), div(pick('ni', y)),
      div(pick('ocf', y)), div(pick('capex', y)), div(pick('eq', y)),
      debt, div(pick('cash', y)),
      shares == null ? null : shares / B,
      pick('dps', y),
    ];
  });

  const cells = fin.flat();
  const completeness = cells.filter(v => v != null).length / cells.length;

  return {
    id: ticker.toUpperCase(), name: title, cik, exch: null, mkt: 'US', ccy: 'USD',
    years, fin, provenance, gaps,
    completeness: +completeness.toFixed(3),
    source: 'SEC EDGAR companyfacts', retrieved: new Date().toISOString().slice(0, 10),
  };
}

/* --------------------------------------------------------------------- cli */
/* process.argv[1] is undefined when the module is imported rather than run. */
const invokedAs = process.argv[1] ? process.argv[1].replace(/\\/g, '/').split('/').pop() : null;
const isMain = !!invokedAs && import.meta.url.endsWith(invokedAs);

if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
  const nYears = Number(flag('years', 10));
  const out = flag('out', null);
  const tickers = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] || '').startsWith('--'));

  if (!tickers.length) {
    console.error('usage: node ingest/sec.mjs [--years 10] [--out data/us.json] TICKER [TICKER...]');
    process.exit(1);
  }
  if (!process.env.SEC_UA) {
    console.warn('! SEC_UA is not set. The SEC asks for a contact address in the User-Agent.\n');
  }

  const results = [], failures = [];
  for (const t of tickers) {
    try {
      const r = await ingestTicker(t, nYears);
      results.push(r);
      const weak = Object.entries(r.provenance).filter(([, p]) => p.weak).map(([k]) => k);
      console.log(
        `${r.id.padEnd(6)} ${String(Math.round(r.completeness * 100)).padStart(3)}% complete` +
        `  FY${r.years[0]}-${r.years.at(-1)}` +
        `  ${r.gaps.length ? r.gaps.length + ' gap(s)' : 'no gaps'}` +
        `${weak.length ? '  weak: ' + weak.join(',') : ''}`
      );
    } catch (e) {
      failures.push({ ticker: t, error: e.message });
      console.error(`${t.padEnd(6)} FAILED — ${e.message}`);
    }
    await sleep(SLEEP_MS);
  }

  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify({ generated: new Date().toISOString(), source: 'SEC EDGAR', results, failures }, null, 2));
    console.log(`\nwrote ${out} — ${results.length} companies, ${failures.length} failures`);
  }
}
