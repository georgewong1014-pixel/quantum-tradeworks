#!/usr/bin/env node
/**
 * SEC XBRL → Quantum Tradeworks statement tuples.
 *
 *   node ingest/sec.mjs AAPL MSFT JPM
 *   node ingest/sec.mjs --years 10 --out data/us.json AAPL MSFT
 *   node ingest/sec.mjs --from-raw --out data/us.json AAPL MSFT     (offline)
 *   node ingest/sec.mjs --facts data/us-facts.json --out data/us.json AAPL
 *
 * THE STAGES, IN ORDER
 *   fetch      companyfacts and submissions JSON from the SEC — or, with
 *              --from-raw, from the archive a previous fetch wrote;
 *   archive    every fetched body saved verbatim under ingest/raw/ (git-
 *              ignored) with its URL, date and SHA-256 in manifest.json, so
 *              normalisation can be re-run and diffed without the network;
 *   normalise  annual facts per line (annualSeries, resolveLine), a unit the
 *              line does not expect refused, a period that disagrees with
 *              the income statement's year-end nulled, a restatement flagged;
 *   validate   validateCompany on the assembled record — a hard failure goes
 *              to failures[], never to results[];
 *   gate       writeGate compares the run with the file it would replace and
 *              refuses a smaller or degraded universe without --force,
 *              printing the balance-sheet diff either way;
 *   write      the tuple file, and with --facts one FinancialFact row per
 *              line and year beside it.
 *
 * --raw-dir DIR  where the archive lives (default ingest/raw)
 * --no-raw       fetch without archiving
 * --from-raw     never touch the network; a ticker with no archive fails
 * --force        write through the gate
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

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

/* THE VERSION OF THE RULES THAT PRODUCED A FILE. Bumped whenever a selection
   or refusal rule changes what the ingest writes for the same filings, and
   written on every record and on the file header, so a page can tell a file
   produced under the old rules from one produced under the new.
     sec 1.0.0  the original ingest (data/us.json, August 2026 — unstamped)
     sec 1.1.0  an instant is the balance at the fiscal year-end (26 Sep 2026)
     sec 1.2.0  a unit the line does not expect is refused; a line whose
                period disagrees with the income statement's year-end is
                nulled; a share count of nought is no count; restatements are
                identified; raw archive and FinancialFact export */
export const INGEST_VERSION = 'sec 1.2.0';

const UA = process.env.SEC_UA || 'QuantumTradeworks/0.1 (contact: set SEC_UA env var)';
const HEADERS = { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' };
const SLEEP_MS = 120;                       /* comfortably under 10 req/s */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------- concepts */
/* Filers do not agree on tags. Each line is a priority chain: the first
   concept that yields a usable annual series wins, and which one was used is
   reported, because "revenue" meaning three different tags across a peer group
   is exactly how a comparison quietly becomes wrong. */
export const LINES = [
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
  /* DEBT IS NONCURRENT PLUS CURRENT, OR A TOTAL ALONE — NEVER A TOTAL PLUS
     ITS OWN CURRENT PORTION. In us-gaap, LongTermDebt is the total INCLUDING
     current maturities; it sat in the noncurrent chain, ahead of the true
     noncurrent LongTermDebtAndCapitalLeaseObligations, and the current portion
     was then added on top — Home Depot's FY2026 debt stored 54.4bn against
     51.3bn filed, and ten other filers the same way. The totals are their own
     line now, used only where no noncurrent line resolves (Air Products tags
     only LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities,
     and with no noncurrent line its "debt" was the 0.7bn current portion). */
  { key: 'debtL', taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations' ] },
  { key: 'debtT', taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities' ], aux: true },
  { key: 'debtC', taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'LongTermDebtCurrent', 'LongTermDebtAndCapitalLeaseObligationsCurrent' ] },
  { key: 'cash',  taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'CashAndCashEquivalentsAtCarryingValue',
      'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents' ] },
  /* Current assets and liabilities were never pulled, so the current ratio —
     a named test in sections 7.3 and 18.3 — could not be computed at all, and
     the balance-sheet resilience screen could evaluate only two of its five
     rules. Interest expense has the same problem: interest cover is listed
     first in 18.3 and the metric was hard-null for want of the line.
     Filers report these under several concepts and banks report none of them,
     which is correct rather than missing — a bank has no operating cycle to
     divide. */
  { key: 'ca',    taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'AssetsCurrent' ] },
  { key: 'cl',    taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'LiabilitiesCurrent' ] },
  { key: 'intExp', taxonomy: 'us-gaap', kind: 'duration', concepts: [
      'InterestExpense', 'InterestExpenseDebt',
      'InterestIncomeExpenseNet', 'InterestExpenseNonoperating' ] },
  /* SHARES IN ISSUE ARE SHARES OUTSTANDING. CommonStockSharesIssued counts
     treasury stock too, and it was the second link of this chain: Coca-Cola
     stored 7.04bn shares against 4.30bn outstanding, Procter & Gamble 4.01bn
     against about 2.3bn, and thirty filers the same way — every per-share
     figure, payout ratio and dividend cover on them was divided by the wrong
     count. The issued count is used only net of the treasury count, and only
     where both are filed for the same year-end; otherwise the weighted
     diluted count below stands in, as it already did. */
  { key: 'sh',    taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'CommonStockSharesOutstanding' ], unit: 'shares' },
  { key: 'shIss', taxonomy: 'us-gaap', kind: 'instant',  concepts: [
      'CommonStockSharesIssued' ], unit: 'shares', aux: true },
  { key: 'shTreas', taxonomy: 'us-gaap', kind: 'instant', concepts: [
      'TreasuryStockCommonShares', 'TreasuryStockShares' ], unit: 'shares', aux: true },
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

/* The forms an annual balance sheet is filed on. Used only as the fallback for
   a year whose fiscal-year-end date is not known from the income statement. */
const ANNUAL_FORM = /^(10-K|10-K405|10-KT|20-F|40-F)(\/A)?$/;

/**
 * Reduce one concept's raw fact list to { fiscalYear: value }.
 *
 * Three decisions worth naming:
 *  - Annual duration facts are those spanning 330–400 days. A 10-K restates
 *    prior years, so the same period appears many times.
 *  - Where a period appears more than once, the most recently FILED value wins.
 *    That is a restatement policy: latest-known rather than as-first-reported.
 *    A point-in-time store would keep both; this flattens to latest.
 *  - AN INSTANT IS THE BALANCE AT THE FISCAL YEAR-END, NOT AT ANY DATE IN THE
 *    YEAR. This function used to bucket every balance-sheet fact by the
 *    calendar year of its date and let the latest-filed one win — and a 10-Q
 *    balance dated inside the year is filed later than the 10-K for the
 *    year-end before it, so a quarter-end could stand in for the year-end: a
 *    December quarter-end filed in January outranks a September 10-K on
 *    filing date until a later filing re-reports the year-end. Whether that
 *    happened anywhere in the shipped data is for the regeneration diff to
 *    show; the rule permitted it, which is enough. Equity, debt, cash and
 *    share count could then disagree with the income statement beside them
 *    about which date they described. The caller now supplies the fiscal
 *    year-end for each year,
 *    taken from the revenue period that defines it, and only a fact dated
 *    exactly there is accepted. Where no year-end is known the fallback is a
 *    fact from an annual form; a quarterly form is never a source for an
 *    annual balance.
 *
 * Also returns, per year, the date the fact describes, the date it was filed
 * and the form it came from — the three things a reader needs to find the
 * number in the filing, and the three this pipeline used to read and throw
 * away — plus the period start and the accession number, which the
 * FinancialFact export needs to point at one filing.
 *
 * RESTATEMENTS ARE APPLIED AND NOW ALSO IDENTIFIED. Latest-filed still wins,
 * which is the right policy for a screener; but the first-filed fact for the
 * same period is kept beside it, and `restated` is true where the two differ.
 * A later filing that re-reports the same figure — every 10-K repeats last
 * year's balance sheet — is not a restatement and is not flagged.
 */
export function annualSeries(facts, kind, unitPref, fyEnds = null) {
  const units = facts?.units || {};
  const unitKey = Object.keys(units).find(u => u === unitPref)
    || Object.keys(units).find(u => u === 'USD')
    || Object.keys(units)[0];
  if (!unitKey) return { series: {}, meta: {}, unit: null };

  const out = {}, first = {};
  for (const f of units[unitKey]) {
    if (!f.end || f.val == null) continue;
    const y = yearOf(f.end);
    if (kind === 'duration') {
      if (!f.start) continue;
      const d = days(f.start, f.end);
      if (d < 330 || d > 400) continue;              /* annual periods only */
    } else {
      const fye = fyEnds && fyEnds[y];
      if (fye) { if (f.end !== fye) continue; }       /* the year-end balance, exactly */
      else if (!ANNUAL_FORM.test(f.form || '')) continue;  /* never a quarter-end standing in */
    }
    const fact = { val: f.val, filed: f.filed, form: f.form, end: f.end, start: f.start || null, accn: f.accn || null };
    const prev = out[y];
    if (!prev || (f.filed || '') > (prev.filed || '')) out[y] = fact;
    const fst = first[y];
    if (!fst || (f.filed || '') < (fst.filed || '')) first[y] = fact;
  }
  for (const [y, m] of Object.entries(out)) {
    const f0 = first[y];
    /* Same period only: a fact for a different end date in the same calendar
       year is a different period, not a revision of this one. */
    m.restated = !!f0 && f0 !== m && f0.end === m.end && f0.val !== m.val;
    if (m.restated) m.first = { val: f0.val, filed: f0.filed, form: f0.form, accn: f0.accn };
  }
  return { series: Object.fromEntries(Object.entries(out).map(([y, v]) => [y, v.val])), meta: out, unit: unitKey };
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
 *
 * A CONCEPT IN THE WRONG UNIT IS REFUSED, NOT READ. annualSeries falls back
 * to whatever unit a concept carries when the expected one is absent, and
 * Emerson's dividend per share arrived as 'pure' — plausible numbers, so
 * nothing downstream could tell. A money line must be USD, a share count
 * 'shares' and a dividend 'USD/shares'; a concept that is not is skipped, the
 * next in the chain is tried, and the refusal is returned so the gap can name
 * it. A filer reporting in another currency is refused the same way rather
 * than stored under a 'USD' heading it does not carry.
 */
export const expectedUnit = (line) => line.unit || 'USD';
export function resolveLine(allFacts, line, years, fyEnds = null) {
  const loaded = [], refused = [];
  for (const concept of line.concepts) {
    const facts = allFacts?.[line.taxonomy]?.[concept];
    if (!facts) continue;
    const { series, meta, unit } = annualSeries(facts, line.kind, line.unit, fyEnds);
    if (!Object.keys(series).length) continue;
    if (unit !== expectedUnit(line)) { refused.push({ concept, unit, expected: expectedUnit(line) }); continue; }
    loaded.push({ concept, series, meta, unit });
  }
  if (!loaded.length) return refused.length ? { refused, series: {}, coverage: 0 } : null;

  const series = {}, byYear = {}, endByYear = {}, filedByYear = {}, formByYear = {},
        startByYear = {}, accnByYear = {}, restatedByYear = {}, used = new Set();
  for (const y of years) {
    for (const cand of loaded) {
      if (cand.series[y] != null) {
        series[y] = cand.series[y];
        byYear[y] = cand.concept;
        const mt = cand.meta[y];
        if (mt) {
          endByYear[y] = mt.end; filedByYear[y] = mt.filed; formByYear[y] = mt.form;
          if (mt.start) startByYear[y] = mt.start;
          if (mt.accn) accnByYear[y] = mt.accn;
          if (mt.restated) restatedByYear[y] = { from: mt.first.val, to: mt.val, filedFirst: mt.first.filed, filedLast: mt.filed, accnFirst: mt.first.accn || null };
        }
        used.add(cand.concept);
        break;                                   /* chain order is priority */
      }
    }
  }
  const hits = years.filter(y => series[y] != null).length;
  if (!hits) return refused.length ? { refused, series: {}, coverage: 0 } : null;
  return {
    concept: [...used].join(' + '),
    concepts: [...used], byYear, endByYear, filedByYear, formByYear, startByYear, accnByYear, restatedByYear,
    series, unit: loaded[0].unit, refused,
    coverage: hits / years.length,
    mixedTags: used.size > 1,
    weak: hits < Math.max(2, Math.ceil(years.length * 0.5)),
  };
}

/**
 * EVERY LINE DESCRIBES THE YEAR THE INCOME STATEMENT DOES.
 *
 * Instants are already resolved at the fiscal year-end exactly (annualSeries),
 * so a balance cannot disagree once the year-end is known. A duration can: a
 * cash-flow concept whose only annual period in a calendar year ends in
 * December, beside revenue for a year ending in September, is a different
 * twelve months under the same label. A duration may end within seven days of
 * the revenue year-end (a 52/53-week filer moves by a few days); an instant
 * must match exactly. A disagreeing year is removed from the series — a null
 * the engine already handles — and returned so the gap names both dates.
 * The revenue line defines the year-end and is never checked against itself.
 */
export function agreePeriods(r, line, periodEnds) {
  const out = [];
  if (!r || !r.endByYear || !periodEnds || line.key === 'rev') return out;
  for (const [y, end] of Object.entries(r.endByYear)) {
    const fye = periodEnds[y];
    if (!fye || !end || r.series[y] == null) continue;
    const off = Math.abs(days(fye, end));
    const bad = line.kind === 'duration' ? off > 7 : end !== fye;
    if (!bad) continue;
    out.push({ year: Number(y), end, fyEnd: fye });
    delete r.series[y];
    for (const k of ['byYear', 'endByYear', 'filedByYear', 'formByYear', 'startByYear', 'accnByYear', 'restatedByYear']) if (r[k]) delete r[k][y];
  }
  return out;
}

/* ------------------------------------------------------------------- fetch */
async function getText(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/**
 * THE RAW ARCHIVE — WHAT THE SEC SENT, KEPT.
 *
 * The companyfacts and submissions bodies used to be parsed and thrown away,
 * so the only way to re-run a normalisation rule — the year-end fix, the unit
 * refusal — was to fetch 238 files again, which needs a contact address the
 * SEC will accept. A source now stands between the ingest and the network:
 *
 *   network  fetch; with rawDir set, save each body verbatim and record its
 *            URL, retrieval date and SHA-256 in rawDir/manifest.json;
 *   raw      read the saved body instead, and never touch the network. A
 *            file that was never fetched is a failure for that ticker, not a
 *            silent fall-through to the SEC.
 *
 * `fetchText` is injectable, so ingest-test runs the whole pipeline against a
 * fixture with no network at all. Files are 1-10 MB each and git-ignored:
 * they are the SEC's, freely available, and a regeneration's input rather
 * than the product's.
 */
export const RAW_NAME = {
  tickers: () => 'company_tickers.json',
  companyfacts: (cik) => `CIK${cik}.companyfacts.json`,
  submissions: (cik) => `CIK${cik}.submissions.json`,
};
export function makeSource({ fetchText = getText, rawDir = null, fromRaw = false, today = () => new Date().toISOString().slice(0, 10) } = {}) {
  const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex');
  let manifest = null;
  const loadManifest = async () => {
    if (manifest) return manifest;
    try { manifest = JSON.parse(await readFile(join(rawDir, 'manifest.json'), 'utf8')); } catch { manifest = {}; }
    return manifest;
  };
  const used = {};                         /* name -> { sha256, retrieved } for the record */
  return {
    fromRaw, rawDir, used,
    async json(url, name) {
      if (fromRaw) {
        if (!rawDir) throw new Error('--from-raw needs a raw directory');
        let text;
        try { text = await readFile(join(rawDir, name), 'utf8'); }
        catch { throw new Error(`no raw archive for ${name} in ${rawDir} — fetch it once without --from-raw`); }
        const m = (await loadManifest())[name] || {};
        used[name] = { sha256: sha(text), retrieved: m.retrieved || null };
        return JSON.parse(text);
      }
      const text = await fetchText(url);
      const retrieved = today();
      used[name] = { sha256: sha(text), retrieved };
      if (rawDir) {
        await mkdir(rawDir, { recursive: true });
        await writeFile(join(rawDir, name), text);
        const m = await loadManifest();
        m[name] = { url, retrieved, sha256: used[name].sha256, bytes: Buffer.byteLength(text, 'utf8') };
        await writeFile(join(rawDir, 'manifest.json'), JSON.stringify(m, null, 2));
      }
      return JSON.parse(text);
    },
  };
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

async function cikFor(ticker, source) {
  const t = ticker.toUpperCase();
  if (CIK_OVERRIDES[t]) return { ...CIK_OVERRIDES[t], overridden: true };
  if (!source.tickerMap) {
    const j = await source.json('https://www.sec.gov/files/company_tickers.json', RAW_NAME.tickers());
    source.tickerMap = new Map(Object.values(j).map(x => [x.ticker.toUpperCase(), x]));
  }
  const hit = source.tickerMap.get(t);
  if (!hit) throw new Error(`ticker not found in SEC register: ${ticker}`);
  return { cik: String(hit.cik_str).padStart(10, '0'), title: hit.title };
}

/* ------------------------------------------------------- business classification */
/* The valuation router picks the model from the business type, and getting that
   wrong is not a cosmetic error: run a deposit-taking bank through a free-cash-
   flow DCF and the answer is meaningless rather than merely imprecise.
   Defaulting every newly ingested company to "mature" would do exactly that,
   silently.

   The SEC publishes each filer's own SIC code on the submissions endpoint, so
   the classification comes from the filer's registration rather than a guess.
   Anything unmapped stays "mature" but is marked assumed, so the page can say
   so instead of implying the model was chosen deliberately. */
const SIC_MAP = [
  [/^60(0[0-9]|1[0-9]|2[0-9]|3[0-6])$/, 'bank',      'Financials', 'Banks'],
  [/^6199$|^6111$|^6141$/,              'bank',      'Financials', 'Consumer Finance'],
  /* Securities brokers and dealers. Their economics are driven by the balance
     sheet and regulatory capital, so residual income on book equity is the
     defensible pack — a free-cash-flow DCF on an investment bank is the same
     category of error as running one on a deposit-taker. */
  [/^6211$|^6221$|^6231$/,              'bank',      'Financials', 'Capital Markets'],
  [/^6282$|^6289$/,                     'mature',    'Financials', 'Asset Management'],
  [/^732[0-9]$|^6099$/,                 'mature',    'Financials', 'Financial Services'],
  [/^63(1[1-9]|2[0-9]|3[0-9]|5[0-9]|6[0-9])$|^6411$/, 'insurer', 'Financials', 'Insurance'],
  [/^6798$/,                            'reit',      'Real Estate', 'REIT'],
  [/^65[0-9]{2}$/,                      'mature',    'Real Estate', 'Real Estate Management'],
  [/^6726$|^6770$|^6199$/,              'holding',   'Financials', 'Diversified Holdings'],
  [/^737[23]$|^7370$|^7371$|^7374$/,    'saas',      'Technology', 'Software & Services'],
  /* Specific before general, always. 3571 is Electronic Computers, and the
     broad 35xx capital-goods rule below would otherwise route Apple to
     "cyclical / Industrials" — a mid-cycle normalised model for a business
     with none of the cyclicality that assumes. */
  [/^357[0-9]$/,                        'mature',    'Technology', 'Technology Hardware'],
  [/^367[0-9]$|^3559$/,                 'cyclical',  'Technology', 'Semiconductors'],
  [/^366[0-9]$|^3827$|^3861$/,          'mature',    'Technology', 'Electronic Equipment'],
  [/^1311$|^1381$|^1389$|^2911$|^291[0-9]$/, 'cyclical', 'Energy', 'Oil & Gas'],
  [/^10[0-9]{2}$|^14[0-9]{2}$|^33[0-9]{2}$/, 'cyclical', 'Materials', 'Metals & Mining'],
  /* 28xx is chemicals and allied products, of which only 283x is drugs. The
     whole block was Pharmaceuticals, which filed Air Products and Linde
     (2810, industrial gases) and Procter & Gamble and Colgate (2840, 2844,
     soaps and toiletries) under Health Care. */
  [/^283[0-9]$/,                        'mature',    'Health Care', 'Pharmaceuticals'],
  [/^284[0-9]$/,                        'mature',    'Consumer Staples', 'Household & Personal Products'],
  [/^28[0-9]{2}$/,                      'mature',    'Materials', 'Chemicals'],
  [/^38(4[0-9]|41|45)$/,                'mature',    'Health Care', 'Medical Devices'],
  [/^80[0-9]{2}$|^6324$/,               'mature',    'Health Care', 'Health Care Services'],
  [/^49(11|22|23|24|31|32|41)$/,        'mature',    'Utilities', 'Utilities'],
  [/^481[0-9]$|^484[0-9]$/,             'mature',    'Communication Services', 'Telecom'],
  /* 738x is miscellaneous business services — 7389 is Visa, Mastercard and
     Accenture, none of them media. It is left unmapped, so it reads as
     Unclassified and assumed rather than as a sector it is not. */
  [/^73(1[0-9]|4[0-9])$|^78[0-9]{2}$/, 'mature', 'Communication Services', 'Media & Services'],
  [/^20[0-9]{2}$|^21[0-9]{2}$/,         'mature',    'Consumer Staples', 'Food, Beverage & Tobacco'],
  [/^5(4[0-9]{2}|9[0-9]{2})$/,          'mature',    'Consumer Staples', 'Retail — Staples'],
  /* Specific before general, which this pair broke: the whole 37xx block was
     Automobiles ahead of the aerospace codes below it, so Boeing (3721),
     Honeywell and RTX (3724) and Lockheed Martin (3760) were car makers.
     Motor vehicles are 371x only; aircraft (372x) and guided missiles and
     space vehicles (376x) are aerospace. */
  [/^37(2[0-9]|6[0-9])$/,                'cyclical',  'Industrials', 'Aerospace & Defence'],
  [/^371[0-9]$/,                        'cyclical',  'Consumer Discretionary', 'Automobiles'],
  [/^5(3[0-9]{2}|6[0-9]{2}|7[0-9]{2})$/,'mature',    'Consumer Discretionary', 'Retail'],
  [/^35[0-9]{2}$|^34[0-9]{2}$|^37[0-9]{2}$/, 'cyclical', 'Industrials', 'Capital Goods'],
  [/^36[0-9]{2}$/,                      'cyclical',  'Industrials', 'Electrical Equipment'],
  [/^45[0-9]{2}$|^42[0-9]{2}$|^44[0-9]{2}$|^40[0-9]{2}$/, 'cyclical', 'Industrials', 'Transportation'],
  [/^382[0-9]$|^384[0-9]$/,             'mature',    'Health Care', 'Life Sciences Tools'],
  [/^5[0-9]{3}$/,                       'mature',    'Consumer Discretionary', 'Retail'],
  [/^58[0-9]{2}$|^70[0-9]{2}$|^47[0-9]{2}$/,   'mature', 'Consumer Discretionary', 'Consumer Services'],
  [/^79[0-9]{2}$/,                      'mature',    'Communication Services', 'Entertainment'],
  [/^30[0-9]{2}$|^31[0-9]{2}$|^23[0-9]{2}$/,   'mature', 'Consumer Discretionary', 'Consumer Goods'],
];

/* The listing venue, from the submissions record the classifier already
 * fetches. `tickers` and `exchanges` are parallel arrays; the venue is the one
 * beside this ticker, or the first where the ticker is not listed there. Null
 * when the record names none, so the page says unknown rather than guessing. */
export function listingFromSubmissions(sub, ticker) {
  const ex = Array.isArray(sub?.exchanges) ? sub.exchanges : [];
  const tk = Array.isArray(sub?.tickers) ? sub.tickers.map(t => String(t).toUpperCase()) : [];
  const i = tk.indexOf(String(ticker || '').toUpperCase());
  const v = ex[i >= 0 ? i : 0];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function classify(sic, sicDescription) {
  const s = String(sic || '').padStart(4, '0');
  for (const [re, type, sector, industry] of SIC_MAP) {
    if (re.test(s)) return { type, sector, industry, sic: s, sicDescription, assumed: false };
  }
  return { type: 'mature', sector: 'Unclassified', industry: sicDescription || 'Unclassified',
           sic: s, sicDescription, assumed: true };
}

/* --------------------------------------------------------- the tuple columns */
/**
 * Two tuple columns are assembled from more than one line, and both rules are
 * here, exported, so ingest-test.mjs can ask them directly.
 *
 * DEBT: noncurrent plus current where both are filed; the filed total alone
 * where it is (a total already includes current maturities, so nothing is
 * added to it); the noncurrent line alone where it is all there is. A current
 * portion with no long-term line is NOT the company's debt — it is null, and
 * the gap says so.
 *
 * SHARES: the year-end outstanding count; else issued less treasury, both at
 * the year-end; else the weighted diluted count. Never the issued count on
 * its own, which includes treasury stock.
 *
 * Each year's basis is recorded as the tags that produced it, so a reader can
 * find the figure in the filing and see which of the three routes was taken.
 */
export function assembleFin(resolved, provenance, years) {
  const B = 1e9;
  const pick = (k, y) => (resolved[k]?.[y] ?? null);
  const tag = (k, y) => provenance?.[k]?.byYear?.[y] || k;
  const basis = { debt: {}, sh: {} };
  const fin = years.map(y => {
    const debt = (() => {
      const l = pick('debtL', y), t = pick('debtT', y), c = pick('debtC', y);
      if (l != null && c != null) { basis.debt[y] = `${tag('debtL', y)} + ${tag('debtC', y)}`; return (l + c) / B; }
      if (t != null) { basis.debt[y] = `${tag('debtT', y)} (a total including current maturities)`; return t / B; }
      if (l != null) { basis.debt[y] = `${tag('debtL', y)} (no current portion filed)`; return l / B; }
      return null;                        /* a current portion alone is not total debt */
    })();
    const shares = (() => {
      /* A count of nought is not a count. Cigna's FY2016 and FY2017 were
         stored as 0 shares outstanding, as tagged; the engine happened to
         treat that as absent, but
         the statement table printed it and a reader outside the app sees a
         company with no shares. Only a positive count is one. */
      const pos = (v) => (v != null && v > 0 ? v : null);
      const out = pos(pick('sh', y)), iss = pick('shIss', y), tr = pick('shTreas', y), wtd = pos(pick('shWtd', y));
      if (out != null) { basis.sh[y] = tag('sh', y); return out; }
      if (iss != null && tr != null && iss - tr > 0) { basis.sh[y] = `${tag('shIss', y)} − ${tag('shTreas', y)}`; return iss - tr; }
      if (wtd != null) { basis.sh[y] = `${tag('shWtd', y)} (weighted diluted — no year-end count filed)`; return wtd; }
      return null;
    })();
    const div = (v) => v == null ? null : v / B;
    return [
      div(pick('rev', y)), div(pick('ebit', y)), div(pick('ni', y)),
      div(pick('ocf', y)), div(pick('capex', y)), div(pick('eq', y)),
      debt, div(pick('cash', y)),
      shares == null ? null : shares / B,
      pick('dps', y),
    ];
  });
  return { fin, basis };
}

/* ---------------------------------------------------------------- ingest one */
/**
 * One ticker: fetched (or read from the archive), normalised, assembled.
 * ingestTicker returns the tuple record as it always has; the detailed form
 * also returns the FinancialFact rows, built from the same resolved lines so
 * the two cannot describe different figures.
 *
 * `source` is where the JSON comes from (makeSource: the network, the network
 * with an archive, or the archive alone); `now` fixes the clock for the probe
 * window and the retrieval date, so a fixture run is deterministic.
 */
export async function ingestTicker(ticker, nYears, opts = {}) {
  return (await ingestTickerDetailed(ticker, nYears, opts)).record;
}

export async function ingestTickerDetailed(ticker, nYears, { source = makeSource(), now = new Date() } = {}) {
  const { cik, title } = await cikFor(ticker, source);
  const cfName = RAW_NAME.companyfacts(cik), subName = RAW_NAME.submissions(cik);
  const facts = await source.json(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, cfName);

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
  const probe = resolveLine(facts.facts, LINES[0], Array.from({ length: 14 }, (_, i) => now.getFullYear() - i));
  if (!probe || !probe.coverage) {
    throw new Error(`no usable revenue concept for ${ticker}` +
      (probe?.refused?.length ? ` — refused ${probe.refused.map(x => `${x.concept} in ${x.unit}`).join(', ')}` : ''));
  }
  const latest = Math.max(...Object.keys(probe.series).map(Number));
  const years = Array.from({ length: nYears }, (_, i) => latest - nYears + 1 + i);

  /* The fiscal year-end of each year, from the revenue period that defines
     it. The balance-sheet lines are resolved against these dates, so equity,
     debt, cash and share count describe the same day the income statement
     ends on — see annualSeries. Recorded on the company too, so a page can say
     "FY2025, ended 27 Sep 2025" rather than leaving the label to imply
     December. */
  const periodEnds = Object.fromEntries(years.filter(y => probe.endByYear[y]).map(y => [y, probe.endByYear[y]]));

  const resolved = {}, provenance = {}, gaps = [], lineMeta = {};
  for (const line of LINES) {
    const r = resolveLine(facts.facts, line, years, periodEnds);
    /* A refused concept is named whether or not another in the chain stood in
       for it — the reader should know a tag was there and why it was not read. */
    for (const x of r?.refused || []) gaps.push({ line: line.key, concept: x.concept, refused: true,
      reason: `unit ${x.unit} where ${x.expected} is expected — the concept was not read` });
    /* An auxiliary line (a total, or the issued and treasury counts) exists to
       stand in for another one; its absence is not a gap in the statements. */
    if (!r || !r.coverage) {
      if (!line.aux && !r?.refused?.length) gaps.push({ line: line.key, reason: 'no concept in the fallback chain returned data' });
      continue;
    }
    for (const x of agreePeriods(r, line, periodEnds)) gaps.push({ line: line.key, year: x.year, end: x.end, fyEnd: x.fyEnd,
      warning: 'period end disagrees with the income statement',
      reason: `FY${x.year} ${line.key} describes a period ending ${x.end}; the income statement's year ends ${x.fyEnd}. The cell is left empty.` });
    const hits = years.filter(y => r.series[y] != null).length;
    if (!hits) { if (!line.aux) gaps.push({ line: line.key, reason: 'every year disagreed with the income statement’s period' }); continue; }
    /* Concepts recounted after any period refusal, so "mixed tags" describes
       the years that survived. */
    const concepts = [...new Set(years.map(y => r.byYear[y]).filter(Boolean))];
    const restated = Object.keys(r.restatedByYear || {}).length ? r.restatedByYear : null;
    resolved[line.key] = r.series;
    lineMeta[line.key] = r;
    provenance[line.key] = { concept: concepts.join(' + '), unit: r.unit, coverage: +(hits / years.length).toFixed(2),
                             weak: hits < Math.max(2, Math.ceil(years.length * 0.5)), mixedTags: concepts.length > 1, byYear: r.byYear,
                             endByYear: r.endByYear, filedByYear: r.filedByYear, formByYear: r.formByYear,
                             ...(restated ? { restated } : {}) };
    if (concepts.length > 1) gaps.push({ line: line.key, warning: 'series assembled from more than one XBRL tag', concepts });
    if (restated) gaps.push({ line: line.key, warning: 'restated in a later filing', years: Object.keys(restated).map(Number) });
    const missing = years.filter(y => r.series[y] == null);
    if (missing.length && !line.aux) gaps.push({ line: line.key, concept: concepts.join(' + '), missingYears: missing });
  }

  const { fin, basis } = assembleFin(resolved, provenance, years);

  const cells = fin.flat();
  const completeness = cells.filter(v => v != null).length / cells.length;

  /* Non-fatal: without it the company still loads, just with an assumed model
     that the page labels as assumed. */
  let cls = { type: 'mature', sector: 'Unclassified', industry: 'Unclassified', assumed: true };
  let exch = null;
  try {
    const sub = await source.json(`https://data.sec.gov/submissions/CIK${cik}.json`, subName);
    cls = classify(sub.sic, sub.sicDescription);
    exch = listingFromSubmissions(sub, ticker);
  } catch { /* classification unavailable */ }

  /* Which bodies this record was built from, by hash — so a regeneration can
     prove its input, and --from-raw can be checked against the fetch it
     replays. The file name is given only where an archive holds it. */
  const rawOf = (name) => source.used[name]
    ? { sha256: source.used[name].sha256, ...(source.rawDir ? { file: name } : {}) } : null;
  const retrieved = source.used[cfName]?.retrieved || now.toISOString().slice(0, 10);

  const record = {
    /* ccy is USD by construction now, not by assertion: a money line in any
       other unit is refused in resolveLine, so nothing stored under this
       heading is in another currency. */
    id: ticker.toUpperCase(), name: title, cik, exch, mkt: 'US', ccy: 'USD',
    years, periodEnds, fin, basis, provenance, gaps,
    completeness: +completeness.toFixed(3),
    ...cls,
    source: 'SEC EDGAR companyfacts', retrieved,
    ingestVersion: INGEST_VERSION,
    raw: { companyfacts: rawOf(cfName), submissions: rawOf(subName) },
  };
  return { record, facts: toFacts(record, lineMeta) };
}

/* ------------------------------------------------------- the FinancialFact */
/**
 * ONE ROW PER LINE AND YEAR, IN THE FILING'S OWN UNITS.
 *
 * The tuple is what the engine reads: billions, as doubles, ten columns. It is
 * not what a server import or an auditor wants, which is the fact itself — the
 * value exactly as filed, the period it covers, the filing it came from. That
 * is this: the value as a decimal string in raw units (the SEC reports an
 * integer or a short decimal, and String() of it is exact), the unit, the
 * currency where the unit has one, the fiscal year and period, the period
 * start and end, the filing date, form and accession number, the concept, and
 * a classification — FILED, because every row here came from a filing. A
 * restated row says so and carries the first-filed value.
 *
 * Written beside the tuple with --facts; the engine does not read it.
 */
export const FACT_FIELDS = ['instrumentId', 'cik', 'metricCode', 'value', 'unit', 'currency', 'fiscalYear', 'fiscalPeriod',
  'periodStart', 'periodEnd', 'filedAt', 'form', 'accessionNumber', 'sourceConcept', 'sourceId', 'taxonomy',
  'dataClassification', 'restated', 'ingestVersion'];

/* A number as the decimal it is, never in exponent form: String(1e-7) is
   "1e-7", which no decimal column will parse. */
export function decimalString(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
  const s = String(v);
  if (!/e/i.test(s)) return s;
  const [mant, expS] = s.toLowerCase().split('e');
  const neg = mant.startsWith('-'), m = mant.replace('-', '');
  const [ip, fp = ''] = m.split('.');
  const digits = ip + fp, point = ip.length + Number(expS);
  let out = point <= 0 ? '0.' + '0'.repeat(-point) + digits
    : point >= digits.length ? digits + '0'.repeat(point - digits.length)
    : digits.slice(0, point) + '.' + digits.slice(point);
  out = out.replace(/^0+(?=\d)/, '');
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return (neg ? '-' : '') + out;
}

export function toFacts(record, lineMeta) {
  const rows = [];
  for (const line of LINES) {
    const r = lineMeta[line.key];
    if (!r) continue;
    for (const y of record.years) {
      const v = r.series[y];
      if (v == null) continue;
      const rs = r.restatedByYear?.[y];
      rows.push({
        instrumentId: `${record.id}-SEC`, cik: record.cik, metricCode: line.key,
        value: decimalString(v), unit: r.unit,
        currency: r.unit === 'USD' || r.unit === 'USD/shares' ? 'USD' : null,
        fiscalYear: y, fiscalPeriod: 'FY',
        periodStart: line.kind === 'duration' ? (r.startByYear?.[y] || null) : null,
        periodEnd: r.endByYear?.[y] || null, filedAt: r.filedByYear?.[y] || null, form: r.formByYear?.[y] || null,
        accessionNumber: r.accnByYear?.[y] || null, sourceConcept: r.byYear[y],
        sourceId: 'SEC EDGAR companyfacts', taxonomy: line.taxonomy, dataClassification: 'FILED',
        restated: !!rs,
        ...(rs ? { firstFiled: { value: decimalString(rs.from), filedAt: rs.filedFirst, accessionNumber: rs.accnFirst || null } } : {}),
        ingestVersion: INGEST_VERSION,
      });
    }
  }
  return rows;
}

/* ---------------------------------------------------------------- validate */
/**
 * THE RECORD IS CHECKED BEFORE IT IS WRITTEN.
 *
 * The assembled record used to go straight into results[], and every
 * plausibility rule lived in the browser — so the file could hold a share
 * count of nought, a dividend in the wrong unit or a completeness figure that
 * did not match its own cells, and a reader of data/us.json outside the app
 * saw clean-looking numbers. A hard failure here sends the company to
 * failures[] with the rule's name, which trips the replacement gate; a
 * warning is printed and the record is written.
 *
 * data-check.mjs runs the same function over the shipped file, so the rule
 * the ingest enforces and the rule CI checks are one rule.
 */
const LINE_BY_KEY = Object.fromEntries(LINES.map(l => [l.key, l]));
export const TUPLE_COLS = ['rev', 'ebit', 'ni', 'ocf', 'capex', 'eq', 'debt', 'cash', 'sh', 'dps'];
const FINANCIAL_TYPES = new Set(['bank', 'insurer']);

export function validateCompany(r) {
  const errors = [], warnings = [];
  const err = (rule, detail) => errors.push({ rule, detail });
  const warn = (rule, detail) => warnings.push({ rule, detail });
  if (!r || typeof r !== 'object') { err('shape', 'not an object'); return { errors, warnings }; }
  if (typeof r.id !== 'string' || !r.id) err('shape', 'no id');
  if (!Array.isArray(r.years) || !Array.isArray(r.fin)) { err('shape', 'years or fin is not an array'); return { errors, warnings }; }
  if (r.fin.length !== r.years.length) err('years-rows', `${r.years.length} years against ${r.fin.length} rows`);
  r.fin.forEach((row, k) => {
    if (!Array.isArray(row) || row.length !== TUPLE_COLS.length) err('row-width', `FY${r.years[k]} row has ${Array.isArray(row) ? row.length : 'no'} columns, not ${TUPLE_COLS.length}`);
  });
  if (!r.years.every(Number.isInteger)) err('years', 'a year is not an integer');
  else for (let k = 1; k < r.years.length; k++) {
    if (r.years[k] !== r.years[k - 1] + 1) { err('years', `FY${r.years[k - 1]} is followed by FY${r.years[k]}`); break; }
  }
  /* JSON cannot carry NaN, but a string, a boolean or an Infinity written by
     hand can arrive, and the engine's isNum would read each as absent. */
  const bad = [];
  r.fin.forEach((row, k) => (Array.isArray(row) ? row : []).forEach((v, j) => {
    if (!(v === null || (typeof v === 'number' && Number.isFinite(v)))) bad.push(`FY${r.years[k]} ${TUPLE_COLS[j]} = ${JSON.stringify(v)}`);
  }));
  if (bad.length) err('finite', bad.slice(0, 5).join('; ') + (bad.length > 5 ? ` and ${bad.length - 5} more` : ''));

  const yrs = new Set(r.years.map(String));
  for (const [k, p] of Object.entries(r.provenance || {})) {
    const line = LINE_BY_KEY[k];
    if (!line) { warn('provenance-line', `provenance for a line the ingest does not define: ${k}`); continue; }
    if (p.unit !== expectedUnit(line)) err('unit', `${k} is in ${p.unit} where ${expectedUnit(line)} is expected`);
    const outside = Object.keys(p.byYear || {}).filter(y => !yrs.has(y));
    if (outside.length) err('provenance-years', `${k} records FY${outside.join(', FY')}, outside FY${r.years[0]}–FY${r.years.at(-1)}`);
  }
  const peOutside = Object.keys(r.periodEnds || {}).filter(y => !yrs.has(y));
  if (peOutside.length) err('provenance-years', `periodEnds records FY${peOutside.join(', FY')}, outside the window`);
  if (r.ccy !== 'USD') err('currency', `ccy is ${r.ccy}; every money line the SEC ingest keeps is USD`);

  const cells = r.fin.flat();
  const recount = cells.length ? cells.filter(v => v != null).length / cells.length : 0;
  if (typeof r.completeness !== 'number' || Math.abs(r.completeness - recount) > 0.0006) err('completeness', `stored ${r.completeness}, recounted ${recount.toFixed(3)}`);

  const col = (name) => TUPLE_COLS.indexOf(name);
  const yearsWhere = (test) => r.years.filter((y, k) => Array.isArray(r.fin[k]) && test(r.fin[k], k));
  const shBad = yearsWhere(row => row[col('sh')] != null && !(row[col('sh')] > 0));
  if (shBad.length) err('shares-positive', `a share count at or below nought in FY${shBad.join(', FY')}`);

  /* Soft: a reason to look, not to refuse. The engine already withholds on
     the first two (revenueSuspect, the thin-equity rule); listing them here
     puts the verdict in the ingest's output too. */
  const capexNeg = yearsWhere(row => row[col('capex')] != null && row[col('capex')] < 0);
  if (capexNeg.length) warn('capex-negative', `capital expenditure below nought in FY${capexNeg.join(', FY')}`);
  if (!FINANCIAL_TYPES.has(r.type)) {
    const over = yearsWhere(row => row[col('rev')] > 0 && row[col('ebit')] != null && row[col('ebit')] > row[col('rev')]);
    if (over.length) warn('ebit-exceeds-revenue', `operating profit above revenue in FY${over.join(', FY')}`);
  }
  const flips = yearsWhere((row, k) => k > 0 && row[col('eq')] != null && r.fin[k - 1]?.[col('eq')] != null && row[col('eq')] * r.fin[k - 1][col('eq')] < 0);
  if (flips.length) warn('equity-sign-flip', `equity changes sign into FY${flips.join(', FY')}`);

  /* Period agreement, where the record carries the dates to check it. A file
     from the corrected ingest cannot disagree (agreePeriods nulls the cell);
     one from an older ingest can, and this is where it would show. */
  if (r.periodEnds) {
    const dis = [];
    for (const [k, p] of Object.entries(r.provenance || {})) {
      const line = LINE_BY_KEY[k];
      if (!line || k === 'rev' || !p.endByYear) continue;
      for (const [y, end] of Object.entries(p.endByYear)) {
        const fye = r.periodEnds[y];
        if (!fye || !end) continue;
        const off = Math.abs(days(fye, end));
        if (line.kind === 'duration' ? off > 7 : end !== fye) dis.push(`${k} FY${y} ends ${end}, year ends ${fye}`);
      }
    }
    if (dis.length) err('period-agreement', dis.slice(0, 4).join('; ') + (dis.length > 4 ? ` and ${dis.length - 4} more` : ''));
  }
  const restated = Object.entries(r.provenance || {}).filter(([, p]) => p.restated && Object.keys(p.restated).length);
  if (restated.length) warn('restated', restated.map(([k, p]) => `${k} FY${Object.keys(p.restated).join(', FY')}`).join('; '));
  return { errors, warnings, recount };
}

/* ------------------------------------------------------------------- gate */
/**
 * A REGENERATION MAY NOT QUIETLY SHRINK OR DEGRADE THE UNIVERSE.
 *
 * The old gate caught one thing — a ticker that threw — and only when the
 * target already existed. A run that succeeded with fewer tickers (a typo in
 * the list, or `--out data/us.json AAPL`) replaced 119 companies with one, and
 * equity-test, which counts the companies in whatever file is served, would
 * have passed. The gate now compares the run with the file it would replace
 * and refuses, unless --force, when:
 *
 *   failures    a ticker failed or was refused by validateCompany (as before);
 *   missing     a company in the existing file is not in this run;
 *   completeness  a company's completeness fell by more than 0.05;
 *   window      a company's latest fiscal year moved backwards;
 *   golden      a filed figure equity-test pins (AAPL, MSFT, NVDA) moved;
 *   duplicate   the run holds one company twice.
 *
 * Whatever it decides, it returns the balance-sheet diff: every equity, debt,
 * cash and share-count cell that changed, both values, and the date the new
 * one describes. That is the diff the year-end fix is verified with — whether
 * a quarter-end ever stood in for a year-end in the shipped file is exactly
 * what these rows show.
 */
export const GOLDEN = [
  { id: 'AAPL', fy: 2024, rev: 391.035, eq: 56.950 },
  { id: 'MSFT', fy: 2025, rev: 281.724, eq: 343.479 },
  { id: 'NVDA', fy: 2025, rev: 130.497 },
];
const BALANCE_COLS = [[5, 'eq', ['eq']], [6, 'debt', ['debtL', 'debtT', 'debtC']], [7, 'cash', ['cash']], [8, 'sh', ['sh', 'shIss', 'shWtd']]];

export function writeGate({ previous = null, results, failures = [], force = false, goldens = GOLDEN }) {
  const refuse = [];
  const byId = new Map(results.map(r => [r.id, r]));
  const dup = [...new Set(results.map(r => r.id).filter((id, i, a) => a.indexOf(id) !== i))];
  if (dup.length) refuse.push({ rule: 'duplicate', detail: `${dup.join(', ')} appear more than once in this run` });
  /* A failure against no existing file writes, as it always has: there is
     nothing for it to shrink. */
  if (failures.length && previous) refuse.push({ rule: 'failures', detail: `${failures.length} ticker(s) failed or were refused: ${failures.map(f => f.ticker).join(', ')}` });

  const diff = [];
  let compared = 0;
  if (previous) {
    const old = previous.results || [];
    const missing = old.filter(o => !byId.has(o.id)).map(o => o.id);
    if (missing.length) refuse.push({ rule: 'missing', detail: `${missing.length} of the ${old.length} companies in the existing file are not in this run: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}` });
    for (const o of old) {
      const n = byId.get(o.id);
      if (!n) continue;
      compared++;
      if (typeof o.completeness === 'number' && typeof n.completeness === 'number' && o.completeness - n.completeness > 0.05)
        refuse.push({ rule: 'completeness', detail: `${o.id} completeness ${o.completeness} → ${n.completeness}` });
      const oEnd = o.years?.at(-1), nEnd = n.years?.at(-1);
      if (oEnd != null && nEnd != null && nEnd < oEnd) refuse.push({ rule: 'window', detail: `${o.id} latest year FY${oEnd} → FY${nEnd}` });
      for (const [c, name, keys] of BALANCE_COLS) {
        n.years.forEach((y, kn) => {
          const ko = (o.years || []).indexOf(y);
          if (ko < 0) return;                             /* a new year is not a change */
          const a = o.fin[ko]?.[c] ?? null, b = n.fin[kn]?.[c] ?? null;
          if ((a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)))) return;
          const end = keys.map(k => n.provenance?.[k]?.endByYear?.[y]).find(Boolean) || null;
          diff.push({ id: n.id, line: name, year: y, from: a, to: b, end, fyEnd: n.periodEnds?.[y] || null });
        });
      }
    }
  }
  let atYearEnd = 0;
  for (const n of results) for (const [, , keys] of BALANCE_COLS) for (const y of n.years || []) {
    const end = keys.map(k => n.provenance?.[k]?.endByYear?.[y]).find(Boolean);
    if (end && n.periodEnds?.[y] === end) atYearEnd++;
  }
  for (const g of goldens) {
    const n = byId.get(g.id);
    if (!n) continue;
    const k = n.years.indexOf(g.fy);
    for (const [f, c] of [['rev', 0], ['eq', 5]]) {
      if (g[f] == null) continue;
      const v = k < 0 ? null : n.fin[k]?.[c];
      if (v == null || Math.abs(v - g[f]) > 0.0005) refuse.push({ rule: 'golden', detail: `${g.id} FY${g.fy} ${f} is ${v ?? 'absent'}; the filing says ${g[f]}` });
    }
  }
  const summary = `${results.length} companies, ${diff.length} changed balance-sheet cells against the existing file (${compared} companies compared), ${atYearEnd} balance-sheet cells dated at the fiscal year-end`;
  return { write: !refuse.length || force, forced: refuse.length > 0 && force, refuse, diff, summary };
}

/* --------------------------------------------------------------------- cli */
/* process.argv[1] is undefined when the module is imported rather than run. */
const invokedAs = process.argv[1] ? process.argv[1].replace(/\\/g, '/').split('/').pop() : null;
const isMain = !!invokedAs && import.meta.url.endsWith(invokedAs);

if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
  const has = (n) => argv.includes(`--${n}`);
  /* Only these flags take a value. The old filter treated the word after ANY
     flag as its value, so `--force AAPL` silently dropped AAPL. */
  const VALUE_FLAGS = new Set(['--years', '--out', '--facts', '--raw-dir']);
  const nYears = Number(flag('years', 10));
  const out = flag('out', null);
  const factsOut = flag('facts', null);
  const listed = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1]));
  /* A ticker listed twice was ingested twice and written twice; the loader
     kept the first and dropped the second without a word. */
  const tickers = [];
  for (const t of listed.map(x => x.toUpperCase())) {
    if (tickers.includes(t)) console.warn(`! ${t} is listed more than once — ingested once`);
    else tickers.push(t);
  }

  if (!tickers.length) {
    console.error('usage: node ingest/sec.mjs [--years 10] [--out data/us.json] [--facts data/us-facts.json] [--from-raw | --no-raw] [--raw-dir ingest/raw] [--force] TICKER [TICKER...]');
    process.exit(1);
  }
  const fromRaw = has('from-raw');
  const rawDir = has('no-raw') && !fromRaw ? null : flag('raw-dir', 'ingest/raw');
  if (!fromRaw && !process.env.SEC_UA) {
    console.warn('! SEC_UA is not set. The SEC asks for a contact address in the User-Agent.\n');
  }
  if (fromRaw) console.log(`reading ${rawDir} — no request goes to the SEC\n`);
  const source = makeSource({ rawDir, fromRaw });

  const results = [], failures = [], facts = [];
  for (const t of tickers) {
    try {
      const { record: r, facts: rows } = await ingestTickerDetailed(t, nYears, { source });
      const v = validateCompany(r);
      if (v.errors.length) {
        failures.push({ ticker: t, error: `refused by validation — ${v.errors.map(e => `${e.rule}: ${e.detail}`).join('; ')}`, rules: v.errors.map(e => e.rule) });
        console.error(`${t.padEnd(6)} REFUSED — ${v.errors.map(e => `${e.rule}: ${e.detail}`).join('; ')}`);
      } else {
        results.push(r);
        facts.push(...rows);
        const weak = Object.entries(r.provenance).filter(([, p]) => p.weak).map(([k]) => k);
        console.log(
          `${r.id.padEnd(6)} ${String(Math.round(r.completeness * 100)).padStart(3)}% complete` +
          `  FY${r.years[0]}-${r.years.at(-1)}` +
          `  ${r.gaps.length ? r.gaps.length + ' gap(s)' : 'no gaps'}` +
          `${weak.length ? '  weak: ' + weak.join(',') : ''}` +
          `${v.warnings.length ? '  check: ' + v.warnings.map(w => w.rule).join(',') : ''}`
        );
      }
    } catch (e) {
      failures.push({ ticker: t, error: e.message });
      console.error(`${t.padEnd(6)} FAILED — ${e.message}`);
    }
    if (!fromRaw) await sleep(SLEEP_MS);
  }

  const partialOf = (p) => p.replace(/\.json$/, '') + '.partial.json';
  let wrote = true;
  if (out) {
    const { existsSync } = await import('node:fs');
    let previous = null;
    if (existsSync(out)) {
      try { previous = JSON.parse(await readFile(out, 'utf8')); }
      catch { console.error(`! ${out} exists but does not parse — compared as if absent`); }
    }
    const gate = writeGate({ previous, results, failures, force: has('force') });
    if (gate.diff.length) {
      console.log(`\nbalance-sheet cells that change (${gate.diff.length}):`);
      for (const d of gate.diff) console.log(`  ${d.id.padEnd(6)} ${d.line.padEnd(5)} FY${d.year}  ${d.from ?? '—'} → ${d.to ?? '—'}` +
        `${d.end ? `  dated ${d.end}${d.fyEnd ? (d.end === d.fyEnd ? ' (the year-end)' : `, year ends ${d.fyEnd}`) : ''}` : ''}`);
    }
    console.log(`\n${gate.summary}`);
    wrote = gate.write;
    const target = gate.write ? out : partialOf(out);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ generated: new Date().toISOString(), source: 'SEC EDGAR', ingestVersion: INGEST_VERSION, results, failures }, null, 2));
    console.log(`wrote ${target} — ${results.length} companies, ${failures.length} failures`);
    if (!gate.write) {
      console.error(`! ${out} was left as it was:`);
      for (const x of gate.refuse) console.error(`    ${x.rule.padEnd(12)} ${x.detail}`);
      console.error('  Fix the run, or pass --force to overwrite anyway.');
    } else if (gate.forced) {
      console.warn(`! written through the gate with --force:`);
      for (const x of gate.refuse) console.warn(`    ${x.rule.padEnd(12)} ${x.detail}`);
    }
  }
  if (factsOut) {
    const target = wrote ? factsOut : partialOf(factsOut);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ generated: new Date().toISOString(), source: 'SEC EDGAR companyfacts', ingestVersion: INGEST_VERSION,
      fields: FACT_FIELDS, facts }, null, 2));
    console.log(`wrote ${target} — ${facts.length} facts`);
  }
}
