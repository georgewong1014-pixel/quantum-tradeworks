#!/usr/bin/env node
/**
 * The price history, checked — and the one repair a check can start.
 *
 *   node ingest/history-check.mjs                 the report (the same as --report)
 *   node ingest/history-check.mjs --report [--json]
 *   node ingest/history-check.mjs --refetch [--provider yahoo|twelvedata] [--dry]
 *   node ingest/history-check.mjs --overlap [--json]         imported weeks and months
 *                                                          against the ones built from daily
 *   node ingest/history-check.mjs --self-check [--dir watchlist-shots] [--json]
 *                                                          the same, on your TradingView exports
 *                                                          imported into a temporary history
 *   ... [--history f] [--instruments f] [--adjustments f] [--now ISO]
 *
 *   exit 0  nothing to repair (--overlap, --self-check: every difference explained)
 *   exit 2  something is listed: bars on a day their market does not trade, a
 *           shifted series, a session held under two dates, a price break no
 *           recorded adjustment explains, or an imported week or month filed
 *           under a key that is not the engine's (and, after --refetch, what is
 *           left; after --overlap, a difference no reason explains)
 *   exit 1  the history, the adjustments file or the engine could not be read,
 *           or the re-fetch (or the self-check's import) failed
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
 *   frames     the imported weeks and months (history-store.mjs, frames): per
 *              symbol and timeframe the periods held, the first and the last,
 *              whether the last is still PROVISIONAL, the bars the engine's
 *              validation refuses, and any bar filed under a key that is not
 *              the engine's period key (a week by any day but its Monday, a
 *              month by any day but its 1st) — a bar no weekly or monthly
 *              reading would find.
 *
 * THE OVERLAP (--overlap, --self-check). TradingView's weekly bar and the week
 * the engine builds from its daily bars are two readings of one market; where
 * a history holds both they should agree on open, high, low, close and
 * volume. Every difference is listed with its likely reason: a period the
 * daily series covers only in part (it starts or ends inside it), a period
 * still trading when the files were saved at different instants, a weekday
 * with no daily bar where the imported volume is the sum of the days held (a
 * holiday) or is not (a daily bar the daily export lacks). --self-check reads
 * the TradingView exports in a folder (default watchlist-shots/) into a
 * temporary history — never data/price-history.json — and compares them
 * there. It reads personal files, so it is a local tool, not a CI check.
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

import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { engine, loadHistory, loadInstruments, marketOf, updateHistory, rejectsPathFor, HISTORY_PATH,
         FRAMES, FRAME_MAPS, periodKey, isPeriodKey, periodSessions, periodLastSession, periodStatus, sessionToday } from './history-store.mjs';
import { tradingViewName, exportTimeframe } from './history-import.mjs';
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
  report.frames = checkFrames(history, { E: eng, instruments, now });
  report.open = {
    weekend: report.totals.weekend, shifted: report.shifted.length, duplicates: report.duplicatesBySession.length,
    breaks: report.breaks.filter(b => OPEN_BREAK.includes(b.state)).length,
    frames: report.frames.badKeys + report.frames.unknownTimeframes.length,
  };
  report.clean = !report.open.weekend && !report.open.shifted && !report.open.duplicates && !report.open.breaks && !report.open.frames;
  return report;
}

/* ------------------------------------------- imported weeks and months -- */

const px = (x) => (x == null ? null : typeof x === 'number' ? x : NaN);
const UNIT = { '1W': 'week', '1M': 'month' };

/* One imported bar as the engine would read it. */
function frameBar(f, pk) {
  const o = Array.isArray(f?.ohlc?.[pk]) ? f.ohlc[pk] : null;
  return { open: o ? px(o[0]) : null, high: o ? px(o[1]) : null, low: o ? px(o[2]) : null,
           close: typeof f?.series?.[pk] === 'number' ? f.series[pk] : NaN, volume: px(f?.volume?.[pk]) };
}

/* Every imported frame, per timeframe and symbol: the periods held, the
   first and the last, the last one's status (PROVISIONAL is the week or
   month still trading when its export was saved; judged at `now` too, so a
   bar with no capture time read before its period closed is not UNKNOWN),
   the bars the engine's scanValidateBar refuses — judged on the period's
   first expected session, the day its stamp opened — the keys that are not
   the engine's period key, and entries in a frame's other maps with no
   close beside them. A timeframe the store does not write is named. */
export function checkFrames(history, { E, instruments = [], now = null } = {}) {
  const out = { frames: [], unknownTimeframes: [], badKeys: 0, invalid: 0 };
  const frames = history?.frames && typeof history.frames === 'object' && !Array.isArray(history.frames) ? history.frames : {};
  for (const tf of Object.keys(frames).sort()) {
    const bySym = frames[tf] && typeof frames[tf] === 'object' ? frames[tf] : {};
    if (!FRAMES.includes(tf)) { out.unknownTimeframes.push({ timeframe: tf, symbols: Object.keys(bySym).length }); continue; }
    for (const sym of Object.keys(bySym).sort()) {
      const f = bySym[sym] && typeof bySym[sym] === 'object' ? bySym[sym] : {};
      const market = marketOf(sym, instruments);
      const keys = Object.keys(f.series || {}).sort();
      const good = keys.filter(k => isPeriodKey(E, tf, k));
      const badKeys = keys.filter(k => !isPeriodKey(E, tf, k)).map(k => ({ key: k, expected: periodKey(E, tf, k) }));
      const today = now ? sessionToday(E, market, now) : null;
      const invalid = [];
      for (const pk of good) {
        const first = periodSessions(E, tf, pk, market)[0] || pk;
        const codes = E.scanValidateBar({ date: first, ...frameBar(f, pk) }, { market, now, today });
        if (codes.length) invalid.push({ period: pk, codes });
      }
      const orphans = FRAME_MAPS.filter(m => m !== 'series').flatMap(m => Object.keys(f[m] || {}).filter(k => !(k in (f.series || {}))).map(k => ({ map: m, key: k })));
      const last = good[good.length - 1] || null;
      const capturedAt = last ? f.meta?.[last]?.at ?? null : null;
      const lastStatus = last ? periodStatus(E, tf, last, market, capturedAt, now) : null;
      out.frames.push({ timeframe: tf, symbol: sym, market, periods: keys.length, first: keys[0] || null, last, lastStatus,
                        lastSession: last ? periodLastSession(E, tf, last, market) : null, capturedAt, provisional: lastStatus === 'PROVISIONAL' ? last : null,
                        invalid, badKeys, orphans, sources: [...new Set(Object.values(f.meta || {}).map(m => m?.src).filter(Boolean))].sort() });
      out.badKeys += badKeys.length;
      out.invalid += invalid.length;
    }
  }
  return out;
}

/* The frames section of the report, in words; nothing when none is held. */
export function describeFrames(F) {
  const L = [];
  if (!F || (!F.frames.length && !F.unknownTimeframes.length)) return L;
  L.push('');
  L.push('FRAMES    imported weeks and months, held beside the daily series');
  for (const x of F.frames) {
    const unit = UNIT[x.timeframe];
    L.push(`${x.timeframe.padEnd(10)}${String(x.symbol).padEnd(8)} ${String(x.periods).padStart(5)} ${unit}s  ${x.first || '—'} … ${x.last || '—'}${x.last ? ` · last ${x.last} ${x.lastStatus}` : ''}`
      + `${x.provisional ? ` — its last session, ${x.lastSession}, had not closed when it was captured${x.capturedAt ? ` (${x.capturedAt})` : ''}; an import made after it replaces it` : ''}`
      + `${x.sources.length ? ` · ${x.sources.join(', ')}` : ''}`);
    x.badKeys.slice(0, 10).forEach(b => L.push(`key       ${x.symbol} ${x.timeframe} ${b.key}: not the engine's key for its ${unit}${b.expected ? ` (${b.expected})` : ''} — no ${unit}ly reading finds a bar filed there`));
    if (x.badKeys.length > 10) L.push(`          … ${x.badKeys.length - 10} more (--json for all)`);
    x.invalid.slice(0, 10).forEach(v => L.push(`invalid   ${x.symbol} ${x.timeframe} ${v.period}: ${v.codes.join(', ')}`));
    if (x.invalid.length > 10) L.push(`          … ${x.invalid.length - 10} more (--json for all)`);
    if (x.orphans.length) L.push(`orphan    ${x.symbol} ${x.timeframe}: ${x.orphans.length} entr${x.orphans.length === 1 ? 'y' : 'ies'} in ${[...new Set(x.orphans.map(o => o.map))].join(', ')} with no close beside ${x.orphans.length === 1 ? 'it' : 'them'} (${x.orphans.slice(0, 3).map(o => o.key).join(', ')}${x.orphans.length > 3 ? ', …' : ''})`);
  }
  F.unknownTimeframes.forEach(u => L.push(`unknown   frames["${u.timeframe}"]: ${u.symbols} symbol(s) under a timeframe the store does not write (${FRAMES.join(', ')}); nothing reads it`));
  return L;
}

/* Imported weeks and months against the ones the engine builds from the
   daily series of the same history (scanResample of its daily bars), where
   the daily series reaches: open, high, low, close and volume, each within
   `tolerance` (relative), with the likely reason for every difference.
   Built from the daily bars directly: scanBars with timeframe 1W or 1M now
   reads the imported weeks and months where the history holds them
   (scanFrameBars), so asked for the week it returned the imported week
   itself, and every imported week matched itself. */
export function compareFrames(history, { E, instruments = [], now = null, tolerance = 1e-9 } = {}) {
  const out = [];
  const same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1e-12));
  const FIELDS = ['open', 'high', 'low', 'close', 'volume'];
  for (const tf of FRAMES) {
    const bySym = history?.frames?.[tf] || {};
    for (const sym of Object.keys(bySym).sort()) {
      const f = bySym[sym] || {};
      const market = marketOf(sym, instruments);
      const unit = UNIT[tf];
      const imported = Object.keys(f.series || {}).filter(k => isPeriodKey(E, tf, k)).sort();
      const daily = E.scanBars(history, sym, { market, now });
      if (!daily.dates.length || !imported.length) { out.push({ timeframe: tf, symbol: sym, market, unit, noDaily: !daily.dates.length, overlap: 0, matched: 0, periods: [], unmatched: [] }); continue; }
      const built = E.scanResample(daily, tf);
      const at = new Map(built.dates.map((d, i) => [periodKey(E, tf, d), i]));
      const dFirst = daily.dates[0], dLast = daily.dates[daily.dates.length - 1];
      const lo = periodKey(E, tf, dFirst), hi = periodKey(E, tf, dLast);
      const dailyAt = daily.capturedAt[daily.capturedAt.length - 1] || null;
      const periods = [];
      for (const pk of imported.filter(k => k >= lo && k <= hi)) {
        const imp = frameBar(f, pk);
        const impAt = f.meta?.[pk]?.at ?? null;
        const impStatus = periodStatus(E, tf, pk, market, impAt, now);
        const i = at.get(pk);
        const expected = periodSessions(E, tf, pk, market);
        if (i === undefined) {
          periods.push({ period: pk, match: false, diffs: [], reason: 'missing-daily', why: `the daily series holds no session of this ${unit} (${expected[0]} … ${expected[expected.length - 1]}) — daily bars the daily export lacks` });
          continue;
        }
        const b = { open: built.open[i], high: built.high[i], low: built.low[i], close: built.closes[i], volume: built.volumes[i] };
        const diffs = FIELDS.filter(k => !same(imp[k], b[k])).map(k => ({ field: k, imported: imp[k], built: b[k] }));
        const row = { period: pk, match: !diffs.length, diffs, importedStatus: impStatus, builtStatus: built.status[i] };
        if (diffs.length) Object.assign(row, whyDiffer({ E, tf, pk, market, unit, expected, daily, built, i, diffs, imp, impAt, impStatus, dFirst, dLast, dailyAt, same }));
        periods.push(row);
      }
      /* A period the daily series builds, inside the imported span, that the
         imported frame lacks. */
      const unmatched = built.dates.map(d => periodKey(E, tf, d)).filter(pk => pk >= imported[0] && pk <= imported[imported.length - 1] && !(pk in f.series));
      out.push({ timeframe: tf, symbol: sym, market, unit, overlap: periods.length, matched: periods.filter(p => p.match).length, periods, unmatched,
                 daily: { first: dFirst, last: dLast, capturedAt: dailyAt }, imported: { first: imported[0], last: imported[imported.length - 1] } });
    }
  }
  return out;
}

/* The likely reason two readings of one period differ, in the order the
   evidence settles it. `reason` is a code a test can read; `why` the words. */
function whyDiffer({ E, tf, pk, market, unit, expected, daily, built, i, diffs, imp, impAt, impStatus, dFirst, dLast, dailyAt, same }) {
  const fields = diffs.map(d => d.field).join(', ');
  /* The daily series starts inside the period: the built bar is missing
     the sessions before its first day, so its open (and perhaps its high,
     low and volume) are not the period's. */
  const before = expected.filter(d => d < dFirst);
  if (pk === periodKey(E, tf, dFirst) && before.length) {
    return { reason: 'partial-start', why: `partial at the start: the daily series begins on ${dFirst}, after the ${unit}'s first session ${expected[0]} — the built bar lacks ${before.length} session(s), so its ${fields} ${diffs.length === 1 ? 'is' : 'are'} not the ${unit}'s` };
  }
  /* The period was still trading when one file or the other was saved:
     its bar moved between the two readings, or the daily series ends
     before the period does. */
  const after = expected.filter(d => d > dLast);
  if (pk === periodKey(E, tf, dLast) && (after.length || impStatus === 'PROVISIONAL' || built.status[i] === 'PROVISIONAL')) {
    const saved = impAt && dailyAt && impAt !== dailyAt ? ` — the ${unit}ly file was saved at ${impAt} and the daily at ${dailyAt}, and the bar moved between them` : '';
    return { reason: 'partial-end', why: `partial at the end: the ${unit} was still trading (${after.length ? `the daily series ends on ${dLast}, before its last session ${expected[expected.length - 1]}` : `its last session, ${expected[expected.length - 1]}, had not closed when the files were saved`})${saved}` };
  }
  /* A weekday of the period with no daily bar. When the imported volume is
     exactly the sum of the sessions held, the market did not trade that
     day — a holiday — and the built bar only leaves its volume out, as it
     does across any day it does not hold. Otherwise the daily export lacks
     a session the period's own bar includes. */
  const missing = built.missingDays?.[i] || [];
  if (missing.length) {
    const idx = daily.dates.map((d, k) => [d, k]).filter(([d]) => periodKey(E, tf, d) === pk).map(([, k]) => k);
    const vols = idx.map(k => daily.volumes[k]);
    const held = vols.every(v => v != null) ? vols.reduce((t, v) => t + v, 0) : null;
    const onlyVolume = diffs.every(d => d.field === 'volume') && built.volumes[i] == null;
    if (onlyVolume && held != null && same(held, imp.volume)) {
      return { reason: 'holiday', why: `a holiday: no daily bar on ${missing.join(', ')}, and the imported volume is the sum of the ${idx.length} session(s) held — the built ${unit} leaves its volume out across a day it does not hold` };
    }
    return { reason: 'missing-daily', why: `a daily bar the daily export lacks: no bar on ${missing.join(', ')}${held != null && imp.volume != null ? ` (the sessions held sum to ${held} against the imported ${imp.volume})` : ''}, and the ${unit}'s ${fields} differ${diffs.length === 1 ? 's' : ''}` };
  }
  /* Every price agrees and only the volume differs, by a sliver: the two
     exports count one closed period a few apart. On the owner's gold files
     one closed week's tick count differed by 4 in 3.59 million, both files
     saved days after it closed. That moves no price and nothing computed
     from prices, so it is named apart from a price difference — and still
     listed, since no partial period or missing day accounts for it. */
  if (diffs.every(d => d.field === 'volume') && imp.volume != null && built.volumes[i] != null) {
    const by = Math.abs(imp.volume - built.volumes[i]);
    const rel = by / Math.max(Math.abs(imp.volume), Math.abs(built.volumes[i]), 1);
    if (rel < 1e-4) return { reason: 'volume-only', why: `open, high, low and close agree exactly; the volumes differ by ${by} of ${imp.volume} (${Number((rel * 100).toPrecision(2))}%) — the two exports count this closed ${unit} slightly apart, which no partial period or missing day explains; no price is affected` };
  }
  return { reason: 'unexplained', why: `no partial period, no missing day: the two readings differ on ${diffs.map(d => `${d.field} (imported ${d.imported}, built ${d.built})`).join(', ')}` };
}

/* The overlap in words; `ok` is false when any difference is unexplained.
   A difference in volume alone (volume-only) is counted apart: listed, but
   not a disagreement about any price. */
export function describeOverlap(rows) {
  const L = [];
  let unexplained = 0, volumeOnly = 0;
  if (!rows.length) L.push('overlap   no imported weeks or months are held — nothing to compare');
  for (const r of rows) {
    const head = `${r.timeframe.padEnd(4)}${String(r.symbol).padEnd(8)}`;
    if (r.noDaily) { L.push(`${head} no daily series to build ${r.unit}s from — nothing to compare`); continue; }
    if (!r.overlap) { L.push(`${head} the imported ${r.unit}s (${r.imported?.first ?? '—'} … ${r.imported?.last ?? '—'}) and the daily series (${r.daily?.first ?? '—'} … ${r.daily?.last ?? '—'}) do not overlap`); continue; }
    const diff = r.periods.filter(p => !p.match);
    L.push(`${head} ${r.overlap} ${r.unit}(s) overlap (${r.periods[0].period} … ${r.periods[r.periods.length - 1].period}, daily ${r.daily.first} … ${r.daily.last}): ${r.matched} match on open, high, low, close and volume${diff.length ? `; ${diff.length} differ` : ''}`);
    for (const p of diff) {
      if (p.reason === 'unexplained') unexplained++;
      if (p.reason === 'volume-only') volumeOnly++;
      L.push(`          ${p.period} ${p.diffs.map(d => `${d.field} ${d.imported} vs ${d.built}`).join(', ') || '—'}`);
      L.push(`                     ${p.why}`);
    }
    if (r.unmatched?.length) L.push(`          built from daily but not imported: ${r.unmatched.join(', ')}`);
  }
  const summary = unexplained ? `${unexplained} difference(s) no reason explains`
    : `every price difference has a reason${volumeOnly ? `; ${volumeOnly} period(s) differ in volume alone, every price agreeing` : ''}`;
  return { lines: L, unexplained, volumeOnly, ok: !unexplained, summary };
}

/* The TradingView exports in a folder — daily, weekly and monthly, by the
   interval in each name — imported one at a time into a temporary history
   by history-import.mjs itself, then compared (compareFrames). The
   temporary folder is removed; data/price-history.json is never read or
   written. */
export async function selfCheck({ dir = resolve(ROOT, 'watchlist-shots'), instrumentsPath = resolve(ROOT, 'data/instruments.json'), now = new Date().toISOString(), E = null } = {}) {
  const eng = E || await engine();
  const names = existsSync(dir) ? (await readdir(dir)).filter(n => /\.csv$/i.test(n) && exportTimeframe(tradingViewName(n)?.interval)) : [];
  if (!names.length) throw Object.assign(new Error(`no TradingView export (<EXCHANGE>_<SYMBOL>, 1D|1W|1M.csv) in ${dir}`), { code: 'NO_EXPORTS' });
  const tmp = await mkdtemp(join(tmpdir(), 'qt-frames-self-check-'));
  try {
    const out = join(tmp, 'price-history.json');
    const imports = [];
    /* Daily first, so the report reads in the order the frames are built. */
    const order = { '1D': 0, '1W': 1, '1M': 2 };
    names.sort((a, b) => order[exportTimeframe(tradingViewName(a).interval)] - order[exportTimeframe(tradingViewName(b).interval)] || a.localeCompare(b));
    for (const n of names) {
      const run = spawnSync(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), '--in', join(dir, n), '--out', out, '--instruments', instrumentsPath], { cwd: ROOT, encoding: 'utf8' });
      imports.push({ file: n, status: run.status, stdout: run.stdout || '', stderr: run.stderr || '' });
      if (run.status !== 0 && run.status !== 2) throw Object.assign(new Error(`importing ${n} failed (exit ${run.status ?? run.signal}): ${(run.stderr || run.stdout || '').trim().split('\n').slice(-3).join(' / ')}`), { code: 'IMPORT_FAILED' });
    }
    const history = await loadHistory(out);
    const instruments = await loadInstruments(instrumentsPath);
    return { dir, files: names, imports, rows: compareFrames(history, { E: eng, instruments, now }), frames: checkFrames(history, { E: eng, instruments, now }) };
  } finally { await rm(tmp, { recursive: true, force: true }); }
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
  L.push(...describeFrames(R.frames));
  L.push('');
  L.push(R.clean ? 'nothing to repair' : `to repair: ${[R.open.weekend ? `${R.open.weekend} weekend-dated bar(s)` : null, R.open.shifted ? `${R.open.shifted} shifted series` : null, R.open.duplicates ? `${R.open.duplicates} session(s) held twice` : null, R.open.breaks ? `${R.open.breaks} unexplained price break(s)` : null,
    R.frames?.badKeys ? `${R.frames.badKeys} imported week(s) or month(s) under a key the engine does not read` : null,
    R.frames?.unknownTimeframes.length ? `${R.frames.unknownTimeframes.length} frame timeframe(s) the store does not write` : null].filter(Boolean).join(', ')}`);
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

  /* Imported weeks and months against the ones built from daily bars: in a
     history file (--overlap), or in the owner's exports read into a
     temporary one (--self-check). */
  if (has('overlap') || has('self-check')) {
    let rows, head = [];
    try {
      if (has('self-check')) {
        const dir = resolve(flag('dir', resolve(ROOT, 'watchlist-shots')));
        const s = await selfCheck({ dir, instrumentsPath, now, E });
        rows = s.rows;
        head.push(`self-check  ${s.files.length} export(s) from ${dir}, imported into a temporary history (removed): ${s.files.join(', ')}`);
        head.push(...describeFrames(s.frames).filter(Boolean));
        head.push('');
      } else {
        if (!existsSync(historyPath)) throw new Error(`no price history at ${historyPath}`);
        rows = compareFrames(await loadHistory(historyPath), { E, instruments: await loadInstruments(instrumentsPath), now });
        head.push(`overlap   ${historyPath}`);
      }
    } catch (e) { console.error(e.message); process.exit(1); }
    const d = describeOverlap(rows);
    if (has('json')) console.log(JSON.stringify(rows, null, 2));
    else [...head, ...d.lines, '', d.summary].forEach(l => console.log(l));
    process.exit(d.ok ? 0 : 2);
  }

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
