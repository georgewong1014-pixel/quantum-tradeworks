#!/usr/bin/env node
/**
 * The price history, checked — and the one repair a check can start.
 *
 *   node ingest/history-check.mjs                 the report (the same as --report)
 *   node ingest/history-check.mjs --report [--json]
 *   node ingest/history-check.mjs --refetch [--provider yahoo|twelvedata] [--dry]
 *   ... [--history f] [--instruments f] [--adjustments f] [--now ISO]
 *
 *   exit 0  nothing to repair
 *   exit 2  something is listed: bars on a day their market does not trade, a
 *           shifted series, a session held under two dates, or a price break
 *           no recorded adjustment explains (and, after --refetch, what is left)
 *   exit 1  the history, the adjustments file or the engine could not be read,
 *           or the re-fetch failed
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT REPORTS
 *
 * The engine's own history report (scanValidateHistory, sliced out of
 * index.html like every other tool here), so this and the scanner's data page
 * cannot describe one file two ways:
 *
 *   dating     bars dated on a day their market does not trade, per market;
 *              series whose weekday profile is shifted — a Sunday that holds
 *              what a trading day should and a Friday that holds almost
 *              nothing is a series dated by the UTC day of a timestamp in a
 *              zone ahead of UTC (NZ50, the currency pairs); sessions held
 *              under two dates (the same close on a weekend day and the
 *              weekday beside it, or from two sources on consecutive days)
 *   breaks     every close-to-close move above ×1.5 or below ×0.67, what it
 *              resembles (a 2-for-1 split, a 1-for-4 consolidation) and what
 *              explains it — an action recorded in data/price-adjustments.json,
 *              or nothing. No indicator is computed across an unexplained one.
 *   the rest   invalid bars with the engine's codes, stale series, missing
 *              sessions no calendar explains.
 *
 * THE REPAIR IS A RE-FETCH, NEVER AN EDIT
 *
 * A mis-dated bar holds the right close under the wrong date, and the dates
 * around it are wrong too. Moving every bar a day is a guess about which bars
 * a source dated which way — two sources can share a series — so dates are
 * never rewritten in place, here or anywhere. --refetch runs ingest/live.mjs
 * --history for exactly the series listed, over a window reaching back to the
 * first mis-dated bar: each bar comes back dated in its exchange's own zone,
 * and the store records every value that changes as a correction. What the
 * re-fetch leaves is a held bar on a day the market does not trade, within a
 * day of the span the provider has just dated, which the provider did not
 * supply — the same session's old copy under the wrong date. Those, and only those,
 * are taken out of the history through the store and written to the rejects
 * file (codes NON_SESSION_DAY, SUPERSEDED), so nothing is lost and the
 * weekday profile reads clean. A series the provider returned nothing for
 * keeps every bar. --dry prints the run and has live.mjs say what it would
 * fetch (--plan), touching neither the network nor the file.
 *
 * Personal lane: the re-fetch is Yahoo unless --provider says otherwise, under
 * the terms live.mjs states, into the git-ignored history and nowhere else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { engine, loadHistory, loadInstruments, marketOf, updateHistory, rejectsPathFor, HISTORY_PATH } from './history-store.mjs';
import { ROOT } from '../scanner/scan.mjs';

const OPEN_BREAK = ['unexplained', 'remains', 'created'];

/* The report, from a history path: the history as the store reads it, with
   the recorded adjustments beside it attached exactly as the worker attaches
   them. Throws with a code the CLI maps to exit 1. */
export async function checkHistory({ historyPath = HISTORY_PATH, instrumentsPath = resolve(ROOT, 'data/instruments.json'), adjustmentsPath = null, now = new Date().toISOString(), E = null } = {}) {
  const eng = E || await engine();
  if (!existsSync(historyPath)) throw Object.assign(new Error(`no price history at ${historyPath}`), { code: 'NO_HISTORY' });
  const history = await loadHistory(historyPath);
  const adjPath = adjustmentsPath || join(dirname(historyPath), 'price-adjustments.json');
  let adjDoc = null;
  if (existsSync(adjPath)) {
    try { adjDoc = JSON.parse(await readFile(adjPath, 'utf8')); }
    catch (e) { throw Object.assign(new Error(`${adjPath} is not valid JSON (${e.message}) — the adjustments recorded there cannot be read`), { code: 'BAD_ADJUSTMENTS' }); }
  }
  const instruments = await loadInstruments(instrumentsPath);
  const report = eng.scanValidateHistory(eng.scanAttachAdjustments(history, adjDoc), { instruments, now });
  report.paths = { history: historyPath, adjustments: existsSync(adjPath) ? adjPath : null, adjustmentsLooked: adjPath };
  /* What a re-fetch would repair: the shifted series, the weekend-dated ones
     and the ones holding a session twice. The window reaches back to the
     first bar concerned, plus a week, so the bars either side are re-read. */
  const firstBad = new Map();
  const note = (sym, d) => { if (d && (!firstBad.has(sym) || d < firstBad.get(sym))) firstBad.set(sym, d); };
  report.weekendByMarket.forEach(m => m.symbols.forEach(s => note(s.symbol, s.first)));
  report.duplicatesBySession.forEach(d => note(d.symbol, d.dates[0]));
  report.shifted.forEach(s => { if (!firstBad.has(s.symbol)) firstBad.set(s.symbol, null); });
  const earliest = [...firstBad.values()].filter(Boolean).sort()[0] || null;
  const days = earliest ? Math.min(3650, Math.max(30, Math.ceil((Date.parse(now) - Date.parse(`${earliest}T00:00:00Z`)) / 86400000) + 7)) : 400;
  report.refetch = { symbols: [...firstBad.keys()].sort(), from: earliest, days };
  report.open = {
    weekend: report.totals.weekend, shifted: report.shifted.length, duplicates: report.duplicatesBySession.length,
    breaks: report.breaks.filter(b => OPEN_BREAK.includes(b.state)).length,
  };
  report.clean = !report.open.weekend && !report.open.shifted && !report.open.duplicates && !report.open.breaks;
  return report;
}

/* The report in words, one section per finding, each ending with what to do. */
export function describeReport(R) {
  const L = [];
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const ratio = (r) => `×${Number(r.toPrecision(3))}`;
  L.push(`history   ${R.paths.history} · schema ${R.file.schema} · written ${R.file.generated || 'no write date'} · judged at ${R.at || 'no clock'} · engine ${R.engine}`);
  L.push(`          ${R.totals.series} series, ${R.totals.bars} bars read; ${R.totals.invalid} refused, ${R.totals.gaps} missing-session gaps, ${R.totals.stale} stale`);
  L.push(`adjust    ${R.paths.adjustments ? `${R.paths.adjustments} — ${R.adjustments.actions.length} action(s) read (${R.adjustments.version})${R.adjustments.problems.length ? `, ${R.adjustments.problems.length} refused` : ''}` : `no ${R.paths.adjustmentsLooked} — no corporate action is recorded, so no price is adjusted`}`);
  R.adjustments.problems.forEach(p => L.push(`          refused ${p.index != null ? `entry ${p.index + 1}` : 'the file'}${p.symbol ? ` (${p.symbol}${p.date ? ` ${p.date}` : ''})` : ''}: ${p.why}`));
  R.adjustments.actions.forEach(a => L.push(`          ${a.symbol} ${a.date} ratio ${a.ratio} (${a.kind}): ${a.state.replace(/-/g, ' ')} — ${a.why}`));

  L.push('');
  L.push('DATING');
  if (!R.weekendByMarket.length && !R.shifted.length && !R.duplicatesBySession.length) L.push('          every bar falls on a day its market trades; no series is shifted; no session is held twice');
  R.weekendByMarket.forEach(m => L.push(`weekend   ${String(m.market || 'no market row').padEnd(8)} ${String(m.bars).padStart(5)} bar(s) on a day it does not trade: ${m.symbols.map(s => `${s.symbol} ${s.bars} (${s.first} … ${s.last})`).join(', ')}`));
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  R.shifted.forEach(s => L.push(`shifted   ${String(s.symbol).padEnd(8)} ${s.market || 'no market row'} · ${s.weekdays.map((n, i) => `${DAY[i]} ${n}`).join(' ')} · Sunday ${pct(s.sundayShare)} · a day ${s.direction}${s.partial ? ', part of the series' : ''}`));
  R.duplicatesBySession.slice(0, 20).forEach(d => L.push(`twice     ${String(d.symbol).padEnd(8)} ${d.dates.join(' and ')} close ${d.close} — ${d.why}`));
  if (R.duplicatesBySession.length > 20) L.push(`          … ${R.duplicatesBySession.length - 20} more sessions held twice (--json for all)`);
  if (R.refetch.symbols.length) {
    L.push(`repair    node ingest/history-check.mjs --refetch   fetches ${R.refetch.symbols.join(', ')} again over ${R.refetch.days} days${R.refetch.from ? ` (back to ${R.refetch.from})` : ''},`);
    L.push('          dated in each exchange\'s zone; dates are never moved in place');
  }

  L.push('');
  L.push('PRICE BREAKS');
  if (!R.breaks.length) L.push('          no close-to-close move above ×1.5 or below ×0.67');
  R.breaks.forEach(b => L.push(`${OPEN_BREAK.includes(b.state) ? 'break' : 'explained'}${OPEN_BREAK.includes(b.state) ? '     ' : ' '}${String(b.symbol).padEnd(8)} ${b.prev} → ${b.bar} ${ratio(b.ratio).padEnd(7)} ${b.tag}${b.state === 'unexplained' ? '' : ` — ${b.state}${b.action ? ` by ratio ${b.action.ratio} (${b.action.kind})` : ''}`}${b.state === 'unexplained' && b.suggestedRatio ? ` — record ratio ${Number(b.suggestedRatio.toPrecision(4))} if it was one` : ''}`));
  if (R.open.breaks) {
    L.push(`record    ${R.paths.adjustmentsLooked}:`);
    L.push('          { "schema": 1, "actions": [{ "symbol": "…", "date": "first bar on the new basis", "ratio": 2, "kind": "split" }] }');
    L.push('          ratio is new units per old unit (0.5 for a 1-for-2 consolidation; 1 for a move that is the market\'s own).');
    L.push('          Until a break is explained no indicator is computed across it (INVALID_INPUT, UNADJUSTED_BREAK).');
  }

  if (R.rejected.length || R.stale.length || R.missing.length) {
    L.push('');
    L.push('ALSO');
    const codes = {};
    R.rejected.forEach(r => r.codes.forEach(c => { codes[c] = (codes[c] || 0) + 1; }));
    if (R.rejected.length) L.push(`refused   ${R.rejected.length} bar(s) the engine does not read: ${Object.entries(codes).map(([c, n]) => `${c} ${n}`).join(', ')}`);
    if (R.stale.length) L.push(`stale     ${R.stale.length} series end before the session that should be held by now (newest final ${R.stale.map(s => s.last).sort().pop()})`);
    if (R.missing.length) L.push(`missing   ${R.missing.length} gap(s) of missing sessions no calendar explains`);
  }
  L.push('');
  L.push(R.clean ? 'nothing to repair' : `to repair: ${[R.open.weekend ? `${R.open.weekend} weekend-dated bar(s)` : null, R.open.shifted ? `${R.open.shifted} shifted series` : null, R.open.duplicates ? `${R.open.duplicates} session(s) held twice` : null, R.open.breaks ? `${R.open.breaks} unexplained price break(s)` : null].filter(Boolean).join(', ')}`);
  return L;
}

/* After a re-fetch that started at `startedAt`: per series, the span of bars
   the provider has just written (a capture time at or after the start),
   widened by a day at each end because a mis-dated copy sits one day off
   the session it copies, and inside it every held bar on a day the market
   does not trade that the provider did not write — removed from series,
   volume, ohlc and meta together, and returned for the rejects file. A
   series with no fresh bar is left whole: the provider said nothing about
   it. */
export function dropSuperseded(hist, symbols, { startedAt, marketOf = () => null, E }) {
  const t0 = Date.parse(startedAt);
  const removed = [];
  for (const sym of symbols) {
    const series = hist.series?.[sym];
    if (!series) continue;
    const meta = hist.meta?.[sym] || {};
    const fresh = (d) => meta[d] && typeof meta[d] === 'object' && Number.isFinite(Date.parse(meta[d].at)) && Date.parse(meta[d].at) >= t0;
    const span = Object.keys(series).filter(d => E.scanIsDay(d) && fresh(d)).sort();
    if (!span.length) continue;
    const from = E.scanAddDays(span[0], -1), to = E.scanAddDays(span[span.length - 1], 1);
    const M = E.scanMarket(marketOf(sym));
    for (const d of Object.keys(series).sort()) {
      if (!E.scanIsDay(d) || d < from || d > to || M.days.includes(E.scanWeekday(d)) || fresh(d)) continue;
      removed.push({ symbol: sym, date: d, codes: ['NON_SESSION_DAY', 'SUPERSEDED'], source: meta[d]?.src || 'unknown', capturedAt: meta[d]?.at || null,
                     row: { close: series[d], volume: hist.volume?.[sym]?.[d] ?? null },
                     why: `a bar on a day ${M.code === '_default' ? 'a weekday market' : M.code} does not trade, beside the span the re-fetch dated (${span[0]} … ${span[span.length - 1]}), which the provider did not supply — the old copy of a session under the wrong date` });
      for (const k of ['series', 'volume', 'ohlc', 'meta']) if (hist[k]?.[sym]) delete hist[k][sym][d];
    }
  }
  return removed;
}

/* The re-fetch as live.mjs is run: exactly the listed series, the window
   back to the first mis-dated bar, into the same history file. */
export function refetchArgs(R, { provider = null, plan = false } = {}) {
  return [join(ROOT, 'ingest/live.mjs'), '--history', '--symbols', R.refetch.symbols.join(','), '--days', String(R.refetch.days),
          '--history-out', R.paths.history, ...(provider ? ['--provider', provider] : []), ...(plan ? ['--plan'] : [])];
}

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(`--${f}`);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const historyPath = flag('history', null) ? resolve(flag('history')) : HISTORY_PATH;
  const instrumentsPath = flag('instruments', null) ? resolve(flag('instruments')) : resolve(ROOT, 'data/instruments.json');
  const adjustmentsPath = flag('adjustments', null) ? resolve(flag('adjustments')) : null;
  const now = flag('now', null) || new Date().toISOString();
  if (!Number.isFinite(Date.parse(now))) { console.error(`--now "${now}" is not a date-time`); process.exit(1); }

  let E, R;
  try { E = await engine(); }
  catch (e) { console.error(`cannot load the engine out of index.html (run node build.mjs): ${e.message}`); process.exit(1); }
  try { R = await checkHistory({ historyPath, instrumentsPath, adjustmentsPath, now, E }); }
  catch (e) { console.error(e.message); process.exit(1); }

  if (!has('refetch')) {
    if (has('json')) console.log(JSON.stringify(R, null, 2));
    else describeReport(R).forEach(l => console.log(l));
    process.exit(R.clean ? 0 : 2);
  }

  if (!R.refetch.symbols.length) {
    console.log('nothing to re-fetch: no bar is dated on a day its market does not trade, no series is shifted, and no session is held twice');
    process.exit(R.open.breaks ? 2 : 0);
  }
  const args = refetchArgs(R, { provider: flag('provider', null), plan: has('dry') });
  console.log(`re-fetch  ${R.refetch.symbols.length} series: ${R.refetch.symbols.join(', ')}`);
  console.log(`run       node ${args.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  const startedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (run.status !== 0) { console.error(`the re-fetch did not complete (live.mjs exit ${run.status ?? run.signal}) — the history is as the store last wrote it`); process.exit(1); }
  if (has('dry')) { console.log('dry run: nothing fetched, nothing written'); process.exit(2); }
  /* The old copies the re-fetch superseded, out through the store: under
     its lock, written atomically, and every removed bar in the rejects file. */
  const instruments = await loadInstruments(instrumentsPath);
  let removed = [];
  try {
    await updateHistory(historyPath, (hist) => {
      removed = dropSuperseded(hist, R.refetch.symbols, { startedAt, marketOf: (s) => marketOf(s, instruments), E });
      return [{ symbol: '*', added: 0, rejected: removed, outranked: [] }];
    });
  } catch (e) { console.error(`the superseded bars were not removed: ${e.message}`); process.exit(1); }
  const after = await checkHistory({ historyPath, instrumentsPath, adjustmentsPath, now: new Date().toISOString(), E });
  console.log('');
  console.log(`removed   ${removed.length} bar(s) on a day their market does not trade, superseded by the re-fetch — each is in ${rejectsPathFor(historyPath)}`);
  console.log(`after     shifted ${R.open.shifted} → ${after.open.shifted} · weekend-dated ${R.open.weekend} → ${after.open.weekend} · held twice ${R.open.duplicates} → ${after.open.duplicates}`);
  if (after.refetch.symbols.length) console.log(`left      ${after.refetch.symbols.join(', ')} — the provider did not supply these, or dated them on a non-trading day itself; they stay listed`);
  process.exit(after.clean ? 0 : 2);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && (process.platform === 'win32' ? entry.toLowerCase() === self.toLowerCase() : entry === self)) await main();
