#!/usr/bin/env node
/**
 * The SEC ingest's selection rules, exercised on a fixture.
 *
 *   node ingest-test.mjs
 *
 * annualSeries decides which of a concept's many reported facts becomes the
 * one figure for a fiscal year. That decision was wrong for balance-sheet
 * instants for as long as the file existed — any date in the calendar year
 * competed, latest-filed won, and a quarter-end filed in January outranked
 * the September year-end — and the only check on it was "the file parses".
 * The fix is verified by network against 119 companies, which is slow,
 * needs a contact address the SEC will accept, and cannot tell a right
 * choice from a lucky one. This asks the rule directly.
 *
 * Every fact here is invented and shaped like the real thing; the numbers
 * are arbitrary. The test is about WHICH fact wins, not what it says.
 */
import { annualSeries, resolveLine, assembleFin, classify, listingFromSubmissions, LINES, agreePeriods, makeSource,
         ingestTickerDetailed, validateCompany, writeGate, decimalString, FACT_FIELDS, INGEST_VERSION } from './ingest/sec.mjs';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* Cases 8 onward go past the selection rule: restatement identification, unit
   refusal, period agreement, validation, the replacement gate, the raw archive
   and --from-raw, the FinancialFact export and the CLI itself — all against
   fixtures, none touching the network. */
const ROOT = dirname(fileURLToPath(import.meta.url));

let failures = 0, passes = 0;
const fail = (msg, detail) => { failures++; console.error(`FAIL  ${msg}`); if (detail !== undefined) console.error(`      ${JSON.stringify(detail)}`); };
const ok = (msg) => { passes++; console.log(`ok    ${msg}`); };
const eq = (msg, got, want) => (JSON.stringify(got) === JSON.stringify(want) ? ok(msg) : fail(msg, { got, want }));

/* A September year-end filer. The 10-K balance, the same balance re-reported
   as the comparative column of a later 10-Q, and three quarter-ends — one of
   them filed AFTER the 10-K, which is the case the old rule got wrong. */
const EQUITY = { units: { USD: [
  { end: '2023-09-30', val: 62146, filed: '2023-11-03', form: '10-K' },
  { end: '2024-09-28', val: 56950, filed: '2024-11-01', form: '10-K' },
  { end: '2024-09-28', val: 56950, filed: '2025-01-31', form: '10-Q' },   /* comparative column */
  { end: '2024-12-28', val: 66758, filed: '2025-02-03', form: '10-Q' },   /* Q1 quarter-end, filed later than the 10-K */
  { end: '2025-03-29', val: 66796, filed: '2025-05-02', form: '10-Q' },
  { end: '2025-06-28', val: 65000, filed: '2025-08-01', form: '10-Q' },
  { end: '2025-09-27', val: 73733, filed: '2025-10-31', form: '10-K' },
  /* A year with quarter-ends only — the 10-K for it was never filed. */
  { end: '2026-03-28', val: 70000, filed: '2026-05-01', form: '10-Q' },
] } };
const FY_ENDS = { 2023: '2023-09-30', 2024: '2024-09-28', 2025: '2025-09-27' };

/* 1 — with the fiscal year-ends known, only the year-end balance is accepted. */
{
  const { series, meta } = annualSeries(EQUITY, 'instant', 'USD', FY_ENDS);
  eq('FY2024 equity is the 28 September balance, not the December quarter-end filed later', series[2024], 56950);
  eq('FY2025 equity is the 27 September balance', series[2025], 73733);
  eq('the year-end fact re-reported in a later filing keeps the later filing date', meta[2024].filed, '2025-01-31');
  eq('the date the fact describes is recorded', meta[2025].end, '2025-09-27');
  eq('a year with no known year-end and only quarter-ends yields nothing', series[2026], undefined);
}

/* 2 — with no year-ends known, an annual form is the only acceptable source. */
{
  const { series } = annualSeries(EQUITY, 'instant', 'USD', null);
  eq('without year-ends, the 10-K balance wins for FY2024', series[2024], 56950);
  eq('without year-ends, a quarter-end is never a source (FY2026 absent)', series[2026], undefined);
}

/* 3 — the OLD rule would have chosen the quarter-end; stated so the test
     fails loudly if anyone restores it. */
{
  const naive = {};
  for (const f of EQUITY.units.USD) { const y = +f.end.slice(0, 4); if (!naive[y] || f.filed > naive[y].filed) naive[y] = f; }
  eq('(the rule this replaces would have put the December quarter-end under FY2024)', naive[2024].val, 66758);
}

/* 4 — durations are unchanged: annual periods only, latest filed wins, so a
     restatement replaces the first-reported figure. */
{
  const REV = { units: { USD: [
    { start: '2022-10-01', end: '2023-09-30', val: 383285, filed: '2023-11-03', form: '10-K' },
    { start: '2022-10-01', end: '2023-09-30', val: 383300, filed: '2024-11-01', form: '10-K' },   /* restated */
    { start: '2024-06-30', end: '2024-09-28', val: 94930, filed: '2024-11-01', form: '10-K' },   /* a quarter: not annual */
    { start: '2023-10-01', end: '2024-09-28', val: 391035, filed: '2024-11-01', form: '10-K' },
  ] } };
  const { series, meta } = annualSeries(REV, 'duration', 'USD', FY_ENDS);
  eq('a restated annual figure replaces the first-reported one', series[2023], 383300);
  eq('a quarterly duration never becomes an annual figure', series[2024], 391035);
  eq('the period end of the winning duration is recorded', meta[2024].end, '2024-09-28');
}

/* 5 — resolveLine carries the provenance through, per year, and merges the
     fallback chain in priority order. */
{
  const allFacts = { 'us-gaap': {
    StockholdersEquity: EQUITY,
    StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest: { units: { USD: [
      { end: '2023-09-30', val: 62500, filed: '2023-11-03', form: '10-K' },
      { end: '2022-09-24', val: 50672, filed: '2022-10-28', form: '10-K' },
    ] } },
  } };
  const line = { key: 'eq', taxonomy: 'us-gaap', kind: 'instant', concepts: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] };
  const r = resolveLine(allFacts, line, [2022, 2023, 2024, 2025], { ...FY_ENDS, 2022: '2022-09-24' });
  eq('the first concept in the chain wins where it has the year', r.series[2023], 62146);
  eq('the second concept fills a year the first lacks', r.series[2022], 50672);
  eq('which concept supplied each year is recorded', r.byYear[2022], 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest');
  eq('the filing date travels with the year', r.filedByYear[2025], '2025-10-31');
  eq('the form travels with the year', r.formByYear[2024], '10-Q');
  eq('the period end travels with the year', r.endByYear[2024], '2024-09-28');
  eq('a chain that used two concepts is flagged as mixed', r.mixedTags, true);
}

/* 6 — the two tuple columns built from more than one line: total debt and
     shares in issue. Each fixture is the tag set a real filer used, run
     through the real concept chains (LINES) and the real assembly, so a tag
     moved back into the wrong chain fails here. Values in dollars and shares,
     as the SEC reports them; the tuple is in billions. */
{
  const FYE = '2026-02-01', Y = 2026;
  const inst = (val) => ({ units: { USD: [{ end: FYE, val, filed: '2026-03-20', form: '10-K' }] } });
  const shr = (val) => ({ units: { shares: [{ end: FYE, val, filed: '2026-03-20', form: '10-K' }] } });
  const wtd = (val) => ({ units: { shares: [{ start: '2025-02-02', end: FYE, val, filed: '2026-03-20', form: '10-K' }] } });
  const run = (facts) => {
    const resolved = {}, provenance = {};
    for (const line of LINES) {
      const r = resolveLine({ 'us-gaap': facts }, line, [Y], { [Y]: FYE });
      if (r) { resolved[line.key] = r.series; provenance[line.key] = { byYear: r.byYear }; }
    }
    const { fin, basis } = assembleFin(resolved, provenance, [Y]);
    return { debt: fin[0][6], sh: fin[0][8], basis: { debt: basis.debt[Y] || null, sh: basis.sh[Y] || null } };
  };
  const near = (a, b) => a != null && Math.abs(a - b) < 1e-9;

  /* Home Depot, FY2026: LongTermDebt (a total including current maturities)
     beside the noncurrent and current lines. The old chain took the total as
     "noncurrent" and added the current portion again: 54.364. */
  const hd = run({ LongTermDebt: inst(49.397e9), LongTermDebtAndCapitalLeaseObligations: inst(46.341e9),
                   LongTermDebtAndCapitalLeaseObligationsCurrent: inst(4.967e9) });
  if (near(hd.debt, 51.308)) ok('debt is noncurrent plus current, never a total plus its own current portion (HD 51.308, not 54.364)');
  else fail('HD-shaped debt is not noncurrent + current', hd);

  /* Air Products: a total with current maturities, and the current portion,
     no noncurrent line. The old rule stored the current portion alone, 0.7163. */
  const apd = run({ LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities: inst(17.6637e9),
                    LongTermDebtAndCapitalLeaseObligationsCurrent: inst(0.7163e9) });
  if (near(apd.debt, 17.6637) && /IncludingCurrentMaturities/.test(apd.basis.debt)) ok('a filed total stands alone, and the basis names it (APD 17.6637, not the 0.7163 current portion)');
  else fail('APD-shaped debt is not the filed total', apd);

  const curOnly = run({ LongTermDebtCurrent: inst(0.5e9) });
  eq('a current portion with no long-term line is not total debt — null', curOnly.debt, null);

  /* Coca-Cola: issued 7.04bn, of which 2.74bn in treasury, no outstanding
     tag. The old chain stored the issued count, treasury included. */
  const ko = run({ CommonStockSharesIssued: shr(7.04e9), TreasuryStockCommonShares: shr(2.7393e9),
                   WeightedAverageNumberOfDilutedSharesOutstanding: wtd(4.33e9) });
  if (near(ko.sh, 4.3007) && /−/.test(ko.basis.sh)) ok('shares are issued less treasury where both are filed (KO 4.30bn, not 7.04bn issued)');
  else fail('KO-shaped shares are not issued less treasury', ko);

  const issOnly = run({ CommonStockSharesIssued: shr(4.0092e9), WeightedAverageNumberOfDilutedSharesOutstanding: wtd(2.41e9) });
  if (near(issOnly.sh, 2.41) && /weighted diluted/.test(issOnly.basis.sh)) ok('an issued count with no treasury count is never used — the weighted diluted count stands in, and says so');
  else fail('the issued count alone became shares in issue', issOnly);
  eq('an issued count with nothing else is no share count at all', run({ CommonStockSharesIssued: shr(4e9) }).sh, null);
  eq('the year-end outstanding count wins where it is filed', run({ CommonStockSharesOutstanding: shr(1.5e9), CommonStockSharesIssued: shr(2e9) }).sh, 1.5);
}

/* 7 — the SIC map files a filer under its own industry: specific codes before
     the broad block that contains them. */
{
  const cases = [
    ['3721', 'Industrials', 'Aerospace & Defence'],        /* Boeing */
    ['3724', 'Industrials', 'Aerospace & Defence'],        /* Honeywell, RTX */
    ['3760', 'Industrials', 'Aerospace & Defence'],        /* Lockheed Martin */
    ['3711', 'Consumer Discretionary', 'Automobiles'],     /* Ford, GM */
    ['2810', 'Materials', 'Chemicals'],                    /* Air Products, Linde */
    ['2840', 'Consumer Staples', 'Household & Personal Products'],   /* Procter & Gamble */
    ['2844', 'Consumer Staples', 'Household & Personal Products'],   /* Colgate */
    ['2834', 'Health Care', 'Pharmaceuticals'],            /* Merck, Pfizer */
  ];
  const bad = cases.map(([sic, sector, industry]) => ({ sic, got: classify(sic), sector, industry }))
    .filter(x => x.got.sector !== x.sector || x.got.industry !== x.industry);
  if (bad.length) fail('SIC codes filed under the wrong sector', bad.map(x => `${x.sic}: ${x.got.sector} / ${x.got.industry}`));
  else ok(`${cases.length} SIC codes land in their own industry — aerospace is not automobiles, gases and soap are not pharmaceuticals`);
  const v = classify('7389');
  if (v.sector === 'Communication Services') fail('7389 (Visa, Mastercard, Accenture) is still filed as Communication Services', v);
  else ok(`7389, miscellaneous business services, is ${v.assumed ? 'left unclassified and marked assumed' : v.sector} rather than media`);
}


/* 8 — restatements are applied AND identified. The first-filed figure is
     kept beside the latest; a later filing that repeats the same figure (the
     10-Q comparative column) is not a restatement. */
{
  const REV = { units: { USD: [
    { start: '2022-10-01', end: '2023-09-30', val: 383285, filed: '2023-11-03', form: '10-K', accn: 'A-23' },
    { start: '2022-10-01', end: '2023-09-30', val: 383300, filed: '2024-11-01', form: '10-K', accn: 'A-24' },
  ] } };
  const { meta } = annualSeries(REV, 'duration', 'USD', FY_ENDS);
  eq('a restated year keeps its first-filed value', meta[2023].first?.val, 383285);
  eq('a restated year is flagged', meta[2023].restated, true);
  eq('the accession number travels with the winning fact', meta[2023].accn, 'A-24');
  eq('the period start travels with a duration', meta[2023].start, '2022-10-01');
  const { meta: eqMeta } = annualSeries(EQUITY, 'instant', 'USD', FY_ENDS);
  eq('a balance re-reported unchanged in a later filing is not a restatement', eqMeta[2024].restated, false);
}

/* 9 — a concept filed in a unit the line does not expect is refused, and the
     next concept in the chain stands in (Emerson's dividend arrived as 'pure'). */
{
  const dpsLine = LINES.find(l => l.key === 'dps');
  const dur = (unit, val) => ({ units: { [unit]: [{ start: '2023-10-01', end: '2024-09-28', val, filed: '2024-11-01', form: '10-K' }] } });
  const r = resolveLine({ 'us-gaap': { CommonStockDividendsPerShareDeclared: dur('pure', 2.1), CommonStockDividendsPerShareCashPaid: dur('USD/shares', 2.08) } }, dpsLine, [2024], FY_ENDS);
  eq('a dividend in "pure" is not read; the USD/shares concept stands in', r.series[2024], 2.08);
  eq('the refusal names the concept and both units', r.refused, [{ concept: 'CommonStockDividendsPerShareDeclared', unit: 'pure', expected: 'USD/shares' }]);
  const only = resolveLine({ 'us-gaap': { CommonStockDividendsPerShareDeclared: dur('pure', 2.1) } }, dpsLine, [2024], FY_ENDS);
  eq('with no other concept the line is empty, not filled from the wrong unit', [only.coverage, Object.keys(only.series).length, only.refused.length], [0, 0, 1]);
  const revLine = LINES.find(l => l.key === 'rev');
  const eur = resolveLine({ 'us-gaap': { Revenues: dur('EUR', 5e9) } }, revLine, [2024], FY_ENDS);
  eq('a money line in another currency is refused rather than stored as USD', eur.refused[0]?.unit, 'EUR');
}

/* 10 — every line describes the income statement's year. A cash-flow period
     ending in December beside a September revenue year is a different twelve
     months; a 52/53-week wobble of a few days is not. */
{
  const ocfLine = LINES.find(l => l.key === 'ocf');
  const r = { series: { 2024: 118, 2025: 111 }, byYear: { 2024: 'X', 2025: 'X' },
              endByYear: { 2024: '2024-12-31', 2025: '2025-09-30' }, filedByYear: {}, formByYear: {} };
  const out = agreePeriods(r, ocfLine, { 2024: '2024-09-28', 2025: '2025-09-27' });
  eq('a duration ending three months after the year-end is removed', r.series[2024], undefined);
  eq('a duration within seven days of the year-end stands', r.series[2025], 111);
  eq('the disagreement names both dates', out, [{ year: 2024, end: '2024-12-31', fyEnd: '2024-09-28' }]);
  const eqLine = LINES.find(l => l.key === 'eq');
  const inst = { series: { 2025: 70 }, byYear: { 2025: 'X' }, endByYear: { 2025: '2025-09-30' } };
  eq('an instant must match the year-end exactly', agreePeriods(inst, eqLine, { 2025: '2025-09-27' }).length, 1);
}

/* 11 — the whole pipeline on a fixture archive: fetch (injected), archive,
     normalise, assemble, validate, export facts — and --from-raw replays the
     archive to the identical record without the network. The fixture is
     invented and shaped like the SEC's responses (ingest/fixtures/sec-raw). */
{
  const FIX = join(ROOT, 'ingest', 'fixtures', 'sec-raw');
  const NOW = new Date('2026-09-28T00:00:00Z');
  const today = () => '2026-09-28';
  const byUrl = {
    'https://www.sec.gov/files/company_tickers.json': 'company_tickers.json',
    'https://data.sec.gov/api/xbrl/companyfacts/CIK0001234567.json': 'CIK0001234567.companyfacts.json',
    'https://data.sec.gov/submissions/CIK0001234567.json': 'CIK0001234567.submissions.json',
  };
  const fetched = [];
  const fetchText = async (url) => { fetched.push(url); if (!byUrl[url]) throw new Error(`fixture has no ${url}`); return readFileSync(join(FIX, byUrl[url]), 'utf8'); };
  const tmp = mkdtempSync(join(tmpdir(), 'qt-ingest-raw-'));
  try {
    const net = makeSource({ fetchText, rawDir: tmp, today });
    const { record: r, facts } = await ingestTickerDetailed('FXTR', 3, { source: net, now: NOW });
    const near = (a, b) => a != null && Math.abs(a - b) < 1e-9;
    eq('the window ends on the latest year with revenue', r.years, [2023, 2024, 2025]);
    eq('the fiscal year-ends are the revenue periods’ own', r.periodEnds, { 2023: '2023-09-30', 2024: '2024-09-28', 2025: '2025-09-27' });
    if (near(r.fin[1][5], 56.95) && near(r.fin[2][5], 73.733)) ok('equity is the year-end balance, never the quarter-end filed after the 10-K');
    else fail('equity picked a quarter-end', r.fin.map(x => x[5]));
    eq('the restated FY2023 revenue is the latest-filed figure', r.fin[0][0], 383);
    eq('and the restatement is recorded with both values and both dates', r.provenance.rev.restated?.[2023] && [r.provenance.rev.restated[2023].from, r.provenance.rev.restated[2023].filedFirst], [380000000000, '2023-11-03']);
    if (r.gaps.some(g => g.line === 'rev' && /restated/.test(g.warning || ''))) ok('a restated line is listed in gaps[]');
    else fail('no restatement gap', r.gaps);
    eq('FY2024 operating cash flow, filed for a calendar year, is left empty', r.fin[1][3], null);
    const pg = r.gaps.find(g => g.line === 'ocf' && g.year === 2024);
    if (pg && /2024-12-31/.test(pg.reason) && /2024-09-28/.test(pg.reason)) ok('the period gap names both dates');
    else fail('the period gap does not name both dates', pg);
    const dg = r.gaps.find(g => g.line === 'dps' && g.refused);
    if (dg && /pure/.test(dg.reason) && near(r.fin[2][9], 1.02)) ok('the dividend in "pure" is refused and named; the USD/shares concept supplies it');
    else fail('dividend unit refusal', { dg, dps: r.fin.map(x => x[9]) });
    if (near(r.fin[0][8], 15.812547) && /weighted diluted/.test(r.basis.sh[2023])) ok('a share count tagged as nought is no count — the weighted diluted count stands in, and says so');
    else fail('a zero share count was stored', { sh: r.fin[0][8], basis: r.basis.sh });
    eq('the record carries the ingest version', r.ingestVersion, INGEST_VERSION);
    eq('and the SIC classification from the submissions body', [r.sector, r.industry], ['Technology', 'Technology Hardware']);
    const v = validateCompany(r);
    eq('the fixture record passes validation', v.errors, []);

    /* The archive. */
    const man = JSON.parse(readFileSync(join(tmp, 'manifest.json'), 'utf8'));
    const cf = readFileSync(join(tmp, 'CIK0001234567.companyfacts.json'), 'utf8');
    if (cf === readFileSync(join(FIX, 'CIK0001234567.companyfacts.json'), 'utf8') && man['CIK0001234567.companyfacts.json']?.sha256 === createHash('sha256').update(cf).digest('hex'))
      ok('each fetched body is archived verbatim, with its SHA-256 in the manifest');
    else fail('the archive does not hold the fetched body', man);
    eq('the record names the archived bodies by hash', r.raw.companyfacts, { sha256: man['CIK0001234567.companyfacts.json'].sha256, file: 'CIK0001234567.companyfacts.json' });
    eq('three requests — tickers, companyfacts, submissions — and no more', fetched.length, 3);

    const offline = makeSource({ fetchText: async (u) => { throw new Error(`network touched: ${u}`); }, rawDir: tmp, fromRaw: true, today });
    const { record: r2, facts: f2 } = await ingestTickerDetailed('FXTR', 3, { source: offline, now: NOW });
    if (JSON.stringify(r2) === JSON.stringify(r) && JSON.stringify(f2) === JSON.stringify(facts)) ok('--from-raw re-normalises the archive to the identical record and facts, without the network');
    else fail('--from-raw produced a different record', { a: r.fin, b: r2.fin });
    let threw = null;
    try { await ingestTickerDetailed('FXTR', 3, { source: makeSource({ rawDir: join(tmp, 'empty'), fromRaw: true }), now: NOW }); } catch (e) { threw = e.message; }
    if (threw && /no raw archive/.test(threw)) ok('a ticker never fetched fails under --from-raw rather than reaching for the SEC');
    else fail('--from-raw with no archive did not fail cleanly', threw);

    /* The FinancialFact export. */
    const need = FACT_FIELDS;
    const missingKeys = facts.filter(f => need.some(k => !(k in f)));
    const badValue = facts.filter(f => !/^-?\d+(\.\d+)?$/.test(f.value));
    if (!missingKeys.length && !badValue.length) ok(`${facts.length} facts, every one with all ${need.length} fields and a plain decimal value`);
    else fail('facts missing fields or with non-decimal values', { missingKeys: missingKeys.slice(0, 2), badValue: badValue.slice(0, 2) });
    const eq25 = facts.find(f => f.metricCode === 'eq' && f.fiscalYear === 2025);
    eq('FY2025 equity: the 10-K accession, the 27 September period end, the filed integer', eq25 && [eq25.accessionNumber, eq25.periodEnd, eq25.value, eq25.form, eq25.currency, eq25.dataClassification],
       ['0001234567-25-000079', '2025-09-27', '73733000000', '10-K', 'USD', 'FILED']);
    const rev24 = facts.find(f => f.metricCode === 'rev' && f.fiscalYear === 2024);
    eq('a duration fact carries its period start and end', rev24 && [rev24.periodStart, rev24.periodEnd, rev24.value], ['2023-10-01', '2024-09-28', '391000000000']);
    if (!facts.some(f => (f.metricCode === 'rev' && f.value === '94000000000') || (f.metricCode === 'eq' && ['66758000000', '66796000000'].includes(f.value)))) ok('no quarter — the Q4 duration and the December quarter-end — reaches the facts');
    else fail('a quarterly figure reached the facts');
    eq('no fact for the refused dividend concept or the disagreeing cash-flow year',
       facts.filter(f => f.sourceConcept === 'CommonStockDividendsPerShareDeclared' || (f.metricCode === 'ocf' && f.fiscalYear === 2024)).length, 0);
    const rst = facts.find(f => f.restated);
    eq('a restated fact carries the first-filed value and filing', rst && rst.firstFiled, { value: '380000000000', filedAt: '2023-11-03', accessionNumber: '0001234567-23-000106' });
    eq('a share count has no currency', facts.find(f => f.metricCode === 'sh')?.currency, null);
    eq('decimal strings never use exponent form', [decimalString(1e-7), decimalString(-2.5e21), decimalString(0.94), decimalString(73733000000)],
       ['0.0000001', '-2500000000000000000000', '0.94', '73733000000']);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/* 12 — validateCompany names the rule each broken record breaks. */
{
  const good = () => ({ id: 'GOOD', ccy: 'USD', type: 'mature', years: [2024, 2025],
    fin: [[10, 2, 1, 2, 0.5, 5, 3, 1, 1, 0.1], [11, 2, 1, 2, 0.5, 5, 3, 1, 1, 0.1]], completeness: 1,
    provenance: { rev: { unit: 'USD', byYear: { 2024: 'Revenues', 2025: 'Revenues' } }, dps: { unit: 'USD/shares', byYear: {} } } });
  eq('a well-formed record passes', validateCompany(good()).errors, []);
  const rules = (mut) => { const r = good(); mut(r); return validateCompany(r).errors.map(e => e.rule); };
  const warns = (mut) => { const r = good(); mut(r); return validateCompany(r).warnings.map(e => e.rule); };
  const cases = [
    ['years-rows', r => { r.fin.pop(); r.completeness = 1; }],
    ['row-width', r => { r.fin[0] = r.fin[0].slice(0, 9); r.completeness = 19 / 19; }],
    ['years', r => { r.years = [2023, 2025]; }],
    ['finite', r => { r.fin[1][2] = '1.0'; }],
    ['unit', r => { r.provenance.dps.unit = 'pure'; }],
    ['provenance-years', r => { r.provenance.rev.byYear[2019] = 'Revenues'; }],
    ['currency', r => { r.ccy = 'EUR'; }],
    ['completeness', r => { r.completeness = 0.9; }],
    ['shares-positive', r => { r.fin[0][8] = 0; }],
    ['period-agreement', r => { r.periodEnds = { 2025: '2025-09-27' }; r.provenance.ocf = { unit: 'USD', byYear: { 2025: 'X' }, endByYear: { 2025: '2025-12-31' } }; }],
  ];
  const missed = cases.filter(([rule, mut]) => !rules(mut).includes(rule)).map(([rule, mut]) => `${rule} (got ${rules(mut).join(',') || 'nothing'})`);
  if (missed.length) fail('validateCompany did not name the rule', missed);
  else ok(`validateCompany names each of ${cases.length} hard rules on a record that breaks it`);
  const soft = [
    ['capex-negative', r => { r.fin[1][4] = -1; }],
    ['ebit-exceeds-revenue', r => { r.fin[1][1] = 12; }],
    ['equity-sign-flip', r => { r.fin[1][5] = -2; }],
  ];
  const softMissed = soft.filter(([rule, mut]) => !warns(mut).includes(rule)).map(([rule]) => rule);
  if (softMissed.length) fail('soft rules not raised as warnings', softMissed);
  else ok('negative capex, EBIT above revenue and an equity sign flip are warnings, not refusals');
  eq('EBIT above revenue is not a warning on a bank', warns(r => { r.type = 'bank'; r.fin[1][1] = 12; }).includes('ebit-exceeds-revenue'), false);
}

/* 13 — the replacement gate. Each refusal on its own, the diff it prints,
     and --force. */
{
  const co = (id, over = {}) => ({ id, years: [2024, 2025], completeness: 1, fin: [[10, 2, 1, 2, 0.5, 5, 3, 1, 1, 0.1], [11, 2, 1, 2, 0.5, 5, 3, 1, 1, 0.1]], ...over });
  const prev = { results: [co('AAA'), co('BBB')] };
  const pass = writeGate({ previous: prev, results: [co('AAA'), co('BBB')] });
  eq('an identical run writes, with nothing to diff', [pass.write, pass.refuse.length, pass.diff.length], [true, 0, 0]);
  const decide = (results, extra = {}) => writeGate({ previous: prev, results, ...extra }).refuse.map(x => x.rule);
  eq('a run missing a company is refused', decide([co('AAA')]), ['missing']);
  eq('a company whose completeness falls by more than 0.05 is refused', decide([co('AAA'), co('BBB', { completeness: 0.9 })]), ['completeness']);
  eq('a window that moves backwards is refused', decide([co('AAA'), co('BBB', { years: [2023, 2024] })]), ['window']);
  eq('a duplicate company is refused', decide([co('AAA'), co('BBB'), co('BBB')]), ['duplicate']);
  eq('a failed ticker against an existing file is refused', decide([co('AAA'), co('BBB')], { failures: [{ ticker: 'CCC', error: '403' }] }), ['failures']);
  eq('a failed ticker with no file to protect writes, as before', writeGate({ results: [co('AAA')], failures: [{ ticker: 'CCC', error: '403' }] }).write, true);
  const aapl = co('AAPL', { years: [2024, 2025], fin: [[391.035, 1, 1, 1, 1, 66.796, 1, 1, 1, 1], [416, 1, 1, 1, 1, 73.733, 1, 1, 1, 1]] });
  eq('a golden figure that moved is refused (AAPL FY2024 equity a quarter-end, not 56.950)', writeGate({ results: [aapl] }).refuse.map(x => x.rule), ['golden']);
  const forced = writeGate({ previous: prev, results: [co('AAA')], force: true });
  eq('--force writes through, and says it did', [forced.write, forced.forced], [true, true]);
  /* The diff: equity moves from a quarter-end to the year-end, dated. */
  const next = co('BBB', { periodEnds: { 2025: '2025-09-27' }, provenance: { eq: { endByYear: { 2025: '2025-09-27' } } },
                           fin: [[10, 2, 1, 2, 0.5, 5, 3, 1, 1, 0.1], [11, 2, 1, 2, 0.5, 4.5, 3, 1, 1, 0.1]] });
  const g = writeGate({ previous: prev, results: [co('AAA'), next] });
  eq('the diff lists each changed balance-sheet cell with both values and the date it now describes', g.diff,
     [{ id: 'BBB', line: 'eq', year: 2025, from: 5, to: 4.5, end: '2025-09-27', fyEnd: '2025-09-27' }]);
  if (/2 companies, 1 changed balance-sheet cells/.test(g.summary) && /1 balance-sheet cells dated at the fiscal year-end/.test(g.summary)) ok(`the summary counts companies, changed cells and year-end-dated cells: "${g.summary}"`);
  else fail('gate summary', g.summary);
}

/* 14 — the CLI, end to end and offline: --from-raw against the fixture
     archive, a repeated ticker ingested once, the facts file written, and the
     gate refusing to replace a larger file — then --force. Nothing here can
     reach the SEC: --from-raw never builds a network source. */
{
  const tmp = mkdtempSync(join(tmpdir(), 'qt-ingest-cli-'));
  const run = (...args) => spawnSync(process.execPath, [join(ROOT, 'ingest', 'sec.mjs'), '--from-raw', '--raw-dir', join(ROOT, 'ingest', 'fixtures', 'sec-raw'), '--years', '3', ...args], { encoding: 'utf8' });
  try {
    const out = join(tmp, 'us.json'), facts = join(tmp, 'us-facts.json');
    const a = run('--out', out, '--facts', facts, 'FXTR', 'fxtr');
    const file = JSON.parse(readFileSync(out, 'utf8'));
    if (a.status === 0 && file.results.length === 1 && /listed more than once/.test(a.stderr) && file.ingestVersion === INGEST_VERSION)
      ok('the CLI ingests a repeated ticker once and stamps the file with the ingest version');
    else fail('CLI first run', { status: a.status, n: file.results?.length, stderr: a.stderr.slice(0, 300) });
    const ff = JSON.parse(readFileSync(facts, 'utf8'));
    eq('the facts file carries its field list and the rows', [ff.fields.length, ff.facts.length > 20], [FACT_FIELDS.length, true]);

    /* A larger existing file: this run would drop ZZZZ. */
    writeFileSync(out, JSON.stringify({ results: [file.results[0], { ...file.results[0], id: 'ZZZZ' }], failures: [] }));
    const before = readFileSync(out, 'utf8');
    const b = run('--out', out, 'FXTR');
    if (readFileSync(out, 'utf8') === before && existsSync(join(tmp, 'us.partial.json')) && /missing/.test(b.stderr) && /ZZZZ/.test(b.stderr))
      ok('the gate leaves the larger file as it was, writes .partial.json, and names the company the run would drop');
    else fail('the gate did not protect the existing file', { stderr: b.stderr.slice(0, 400) });
    const c = run('--force', '--out', out, 'FXTR');
    const after = JSON.parse(readFileSync(out, 'utf8'));
    if (after.results.length === 1 && /--force/.test(c.stderr + c.stdout)) ok('--force writes through the gate, and a ticker after --force is not swallowed as its value');
    else fail('--force', { n: after.results.length, out: (c.stdout + c.stderr).slice(0, 300) });
    const d = run('--out', join(tmp, 'other.json'), 'NOPE');
    if (/no raw archive|not found/.test(d.stderr)) ok('a ticker absent from the archive fails by name, offline');
    else fail('an unarchived ticker', d.stderr.slice(0, 300));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/* The listing venue comes from the submissions record, beside the ticker it
   belongs to, and is null rather than guessed where none is named. */
{
  const sub = { tickers: ['BRK-A', 'BRK-B'], exchanges: ['NYSE', 'NYSE'] };
  eq('the venue beside the ticker is the listing (Nasdaq for MSFT)', listingFromSubmissions({ tickers: ['MSFT'], exchanges: ['Nasdaq'] }, 'msft'), 'Nasdaq');
  eq('a ticker not in the record takes the first venue named', listingFromSubmissions(sub, 'BRK.B'), 'NYSE');
  eq('a record that names no exchange gives null, not a guess', listingFromSubmissions({ tickers: ['X'], exchanges: [] }, 'X'), null);
  eq('a missing record gives null', listingFromSubmissions(null, 'X'), null);
}

/* ---- bugfix3: sweep ---- */
/* autoshot.mjs, on a capture found STALE. It said so and called
   process.exit(2) from inside its try, and process.exit does not run a
   finally — so the cleanup that stops the browser it started never ran.
   Windows hid it (the job object libuv puts a child in dies with node), but
   on Linux and macOS the headless browser outlived the run holding the
   profile, and the next day's launch on that profile handed itself to the
   survivor and exited: "the DevTools endpoint never came up", every day
   after the first stale capture. Asked of the process itself, whatever the
   platform: a preload records every child the script spawns and, at exit,
   reports any still running that nothing asked to stop. Two runs over the
   same still page make the second stale. Needs Chrome or Edge; skipped
   without one. */
{
  const browsers = [process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome'].filter(Boolean);
  if (!browsers.some(p => existsSync(p))) console.log('skip  autoshot on a stale capture — no Chrome or Edge on this machine');
  else {
    const tmp = mkdtempSync(join(tmpdir(), 'qt-autoshot-'));
    try {
      const probe = join(tmp, 'probe.mjs');
      writeFileSync(probe, [
        "import { ChildProcess } from 'node:child_process';",
        "import { writeSync } from 'node:fs';",
        'const kids = [];',
        'const spawn0 = ChildProcess.prototype.spawn;',
        'ChildProcess.prototype.spawn = function (...a) { kids.push(this); return spawn0.apply(this, a); };',
        "process.on('exit', () => {",
        '  const left = kids.filter(k => !k.killed && k.exitCode === null && k.signalCode === null).length;',
        "  writeSync(2, `PROBE left-running=${left}\\n`);",
        '});',
      ].join('\n'));
      const { pathToFileURL } = await import('node:url');
      const shoot = () => spawnSync(process.execPath, ['--import', pathToFileURL(probe).href, join(ROOT, 'ingest', 'autoshot.mjs'),
        '--url', 'data:text/html,<p style="font:20px sans-serif">a still page</p>', '--out', join(tmp, 'shots'),
        '--profile', join(tmp, 'profile'), '--settle', '200', '--max-pages', '3'], { encoding: 'utf8', timeout: 90000 });
      const first = shoot();
      const second = shoot();
      const left = (r) => Number((String(r.stderr).match(/PROBE left-running=(\d+)/) || [])[1] ?? NaN);
      if (first.status === 0 && /captured 1 page/.test(first.stdout) && left(first) === 0)
        ok('autoshot: a first capture of a still page captures it, exits 0 and stops its browser');
      else fail('autoshot: the first capture', { status: first.status, left: left(first), out: String(first.stdout + first.stderr).slice(-400) });
      if (second.status === 2 && /STALE/.test(second.stderr)) ok('autoshot: the same page again is STALE and exits 2, which daily.mjs reads');
      else fail('autoshot: the repeat capture was not reported stale with exit 2', { status: second.status, err: String(second.stderr).slice(-400) });
      if (left(second) === 0) ok('autoshot: a stale capture stops the browser it started before exiting');
      else fail('autoshot: a stale capture exited with its browser still running and never asked to stop', { left: left(second) });
    } finally { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* a browser file still closing */ } }
  }
}
/* ---- end bugfix3: sweep ---- */

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} ingest rules hold`);
process.exitCode = failures ? 1 : 0;
