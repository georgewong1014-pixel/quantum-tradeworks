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
import { annualSeries, resolveLine, assembleFin, classify, LINES } from './ingest/sec.mjs';

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

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} ingest rules hold`);
process.exitCode = failures ? 1 : 0;
