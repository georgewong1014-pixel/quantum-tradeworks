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
import { annualSeries, resolveLine } from './ingest/sec.mjs';

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

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} ingest rules hold`);
process.exitCode = failures ? 1 : 0;
