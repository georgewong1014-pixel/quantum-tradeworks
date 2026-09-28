#!/usr/bin/env node
/**
 * scanner/tv-verify.mjs — the reader's TradingView indicators, recomputed from
 * an export of their own chart and compared with it column by column.
 *
 *   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1D.csv"
 *   node scanner/tv-verify.mjs --csv FILE --set wavetrend.channel=9 --json
 *   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1W.csv" \
 *       --daily "watchlist-shots/OANDA_XAUUSD, 1D.csv"     (and 1M the same way)
 *   ... [--market FX] [--captured-at ISO]
 *
 * WHY. The engine's Pine section (src/js/24-market-engine.js) writes the ten
 * scripts on the reader's chart from their Pine source. Written is not the
 * same as right: an EMA seeded one bar early, an SMA where the script has an
 * EMA, a setting read off the wrong tab — each gives a number that looks like
 * the indicator and is not. TradingView's "Export chart data" writes every
 * plotted series beside the bars it was drawn on, so the chart itself is the
 * test: this reads the export, computes every indicator from the file's own
 * open, high, low, close and volume with the reader's settings, and says per
 * column whether the two agree. Run it on a fresh export each week.
 *
 * THE COLUMNS. An export names each column by its plot's title, and untitled
 * plots are all "Plot" (and plotchar marks "Chars"), so a repeated title is
 * read by its position: the n-th "Plot" is the n-th plot of that title on the
 * reader's chart, in the order CHART lists the indicators — the order they
 * sit on the chart and so in the file. The first five columns must be time,
 * open, high, low and close. A title the chart does not have is refused, with
 * its column number: guessing what an unknown column holds would compare it
 * with the wrong thing and call that a result. A plot the reader has hidden
 * is simply absent from the file; but a hidden untitled plot moves every
 * "Plot" after it, and the table names the plot each column was read as.
 *
 * SETTLED. The file holds a few hundred bars and TradingView computed on many
 * more, so an indicator that remembers — an EMA, Wilder's RSI, a SAR or a
 * range that holds its state — starts here from a different place and only
 * forgets it with time. A column is compared from the bar where the file's
 * own evidence says the start no longer shows: the same indicator computed on
 * the file with its first 1, 2, 3, 5, 8, 13, 21 and 34 bars left out agrees
 * with it, bar for bar, from there on (to a tenth of the tolerance below).
 * Past its warm-up, a windowed average settles at once; an EMA settles as its
 * weight on the start decays; a path (the SAR, the Sentiment Range MA) only
 * when every start has been through the same reversal or reset. A column that
 * never settles in the file, or leaves fewer than MIN_BARS to compare, is NOT
 * SETTLED — it needs a longer export, not a different formula — and its worst
 * difference after warm-up is shown for information only.
 *
 * THE RESULT, per column:
 *   MATCH         every settled bar agrees: a value within 1e-6 of the
 *                 column's largest magnitude, and a blank where TradingView
 *                 has one (a mark that is absent is absent on both)
 *   DIFFERS       a settled bar does not — a setting on the chart differs
 *                 from the defaults (see --set), or a formula is wrong
 *   NOT SETTLED   the file is too short for the indicator's memory
 *   NOT COMPARED  the column is known but not computed here, with why
 *
 * WEEKLY AND MONTHLY EXPORTS. TradingView names an export "<EXCHANGE>_<SYMBOL>,
 * <INTERVAL>.csv", and the interval is read from that name: 1D, 1W or 1M
 * (a capital M is the month; TradingView writes minutes as a number). The
 * indicators of a weekly or monthly export are computed from its own bars,
 * exactly as a daily one's — TradingView computes them on the bars of the
 * chart they are drawn on.
 *
 * BARS FROM THE DAILY EXPORT (--daily). The scanner never holds a weekly or a
 * monthly bar: it builds them from the daily history (the engine's
 * scanResample, reached through scanBars as the scanner reaches it), and a
 * setup read on the week is only as right as that build. So, given the daily
 * export of the same symbol, this dates its bars as ingest/history-import.mjs
 * does — each stamp by the session it opens, in the instrument's market (its
 * data/instruments.json row, or --market): OANDA's gold stamp at 17:00 New
 * York on Sunday is Monday's session — builds the weeks or months with the
 * engine, and compares each period's open, high, low, close and volume with
 * the export's bar for it (the export's stamp dated by the same rule: a week
 * stamped Sunday evening is the week of the Monday, a month stamped on the
 * evening of the 31st is the next month). Per period:
 *   MATCH     all five agree (to float noise: both are the same prices)
 *   PARTIAL   the period is only partly in a file: the daily export begins
 *             after its first session, or it was still in progress when
 *             either file was saved (the file's modification time, or
 *             --captured-at) — the fields that differ are listed
 *   HOLIDAY   an expected weekday holds no daily bar and TradingView's bar
 *             has no session there either (the sessions held sum to its
 *             volume): open, high, low and close agree, and the engine's
 *             volume is blank — it sums a period's volume only when every
 *             expected session is held, since a missing day is not a day
 *             of nought and no exchange calendar says which days were
 *             holidays
 *   DIFFERS   anything else, with the fields and both values
 * Periods of the export before the daily export begins (a weekly chart loads
 * far more history than a daily one) are counted, not compared.
 *
 * Exit status: 0 when nothing DIFFERS, 1 when something does (a column or a
 * period), 2 when a file cannot be read, a column is not recognised, or the
 * two files cannot be compared (not weekly or monthly, another symbol, two
 * rows in one period).
 *
 * The export is the reader's licensed data: this reads it where it lies and
 * writes nothing. No check in CI depends on any export; scanner-test drives
 * this tool with a file it builds itself.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEngine } from './scan.mjs';
import { tradingViewName, isDailyInterval, parseCsv } from '../ingest/history-import.mjs';
import { loadInstruments, marketOf, eveningOpen } from '../ingest/history-store.mjs';

/* The reader's chart, top to bottom as its indicators sit on it and so as
   their columns follow each other in an export. `id` is a Pine indicator of
   the engine, whose plots give the titles; `input` is a column of bars;
   `titles` are columns known but not computed, each with why. */
export const CHART = [
  { id: 'psar' },
  { id: 'sma_cross' },
  { input: 'Volume' },
  { id: 'sr_ma' },
  { titles: ['Entry TF Buy', 'Entry TF Sell'],
    why: 'the Multi-Timeframe Trading Bot’s Entry TF marks, which it computes through request.security on its Entry timeframe — 4-hour bars (Entry_TF "240") as the script ships — not on this file’s bars' },
  { id: 'color_ma' },
  { id: 'cm_macd' },
  { id: 'mcdx' },
  { id: 'banker_entry' },
  { id: 'tv_rsi' },
  { titles: ['Regular Bullish', 'Regular Bullish Label', 'Regular Bearish', 'Regular Bearish Label'],
    why: 'the RSI script’s divergences (drawn only with its Calculate Divergence setting on), which the engine does not compute' },
  { id: 'wavetrend' },
  { titles: ['Bearish Regular Divergence', 'Bearish Hidden Divergence', 'Bullish Regular Divergence', 'Bullish Regular Divergence'],
    why: 'the WaveTrend script’s divergence labels, which it draws only with its divergence switches on (off by default, and on your chart); the engine computes the fractal plots beside them (Divergencias Bajistas and Alcistas), not these' },
];
export const INPUTS = ['time', 'open', 'high', 'low', 'close'];
export const DROPS = [1, 2, 3, 5, 8, 13, 21, 34];
export const MIN_BARS = 20;
export const REL_TOL = 1e-6;

/* One CSV line, with double-quoted fields (a title may hold a comma). */
export function csvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/* Which column is which: every title of the header mapped to an input, a
   plot of an indicator, or a known column not computed. Throws, naming the
   column, on anything else. */
export function mapColumns(header, plotTitles) {
  const bad = (i, why) => { const e = new Error(`column ${i + 1} “${header[i]}” ${why}`); e.column = i + 1; throw e; };
  INPUTS.forEach((t, i) => { if (String(header[i] ?? '').trim().toLowerCase() !== t) bad(i, `should be “${t}” — the first five columns of an export are time, open, high, low and close`); });
  const candidates = new Map();
  const add = (title, c) => { if (!candidates.has(title)) candidates.set(title, []); candidates.get(title).push(c); };
  for (const entry of CHART) {
    if (entry.input) add(entry.input, { kind: 'input', title: entry.input });
    else if (entry.titles) entry.titles.forEach(t => add(t, { kind: 'none', title: t, why: entry.why }));
    else (plotTitles[entry.id] || []).forEach((t, k) => add(t, { kind: 'plot', title: t, id: entry.id, plot: k }));
  }
  const seen = new Map();
  return header.map((raw, i) => {
    if (i < INPUTS.length) return { kind: 'input', title: INPUTS[i], column: i + 1 };
    const title = String(raw).trim();
    const nth = (seen.get(title) || 0) + 1;
    seen.set(title, nth);
    const list = candidates.get(title);
    if (!list) bad(i, 'is not a column of the chart this tool knows — add its indicator to CHART in scanner/tv-verify.mjs, or remove it from the chart before exporting');
    if (nth > list.length) bad(i, `is the ${nth}${nth === 2 ? 'nd' : nth === 3 ? 'rd' : 'th'} column of that title, and the chart this tool knows has ${list.length}`);
    return { ...list[nth - 1], column: i + 1, nth, of: list.length };
  });
}

/* --set id.param=value, repeated: the reader's chart differs from the
   defaults. A parameter the catalogue does not hold is a display switch
   passed to the script as it is (wavetrend.showSignal=1 draws WT2). */
export function parseSets(list, E) {
  const sets = {};
  for (const s of list) {
    const m = /^([a-z_]+)\.([A-Za-z0-9_]+)=(.+)$/.exec(s);
    if (!m || !E.SCAN_INDICATORS[m[1]]?.pine) throw new Error(`--set "${s}" is not id.param=value for a Pine indicator (${Object.keys(E.SCAN_INDICATORS).filter(k => E.SCAN_INDICATORS[k].pine).join(', ')})`);
    (sets[m[1]] = sets[m[1]] || {})[m[2]] = Number.isFinite(Number(m[3])) ? Number(m[3]) : m[3];
  }
  return sets;
}
/* The parameters an indicator is computed with: the catalogue's, which are
   the reader's chart, with the --set ones over them. */
export function paramsFor(E, id, sets = {}) {
  const spec = { indicator: id, ...(sets[id] || {}) };
  const { params, problems } = E.scanParams(spec);
  if (problems.length) throw new Error(`--set for ${id}: ${problems.join('; ')}`);
  const extra = Object.fromEntries(Object.entries(sets[id] || {}).filter(([k]) => !(k in E.SCAN_INDICATORS[id].params)));
  return { ...params, ...extra };
}

/* Bars as the engine holds them, from the file's columns. */
export function barsOf(E, cols, from = 0) {
  const cut = (a) => (a ? a.slice(from) : null);
  return E.scanSeriesBars(cut(cols.close), { open: cut(cols.open), high: cut(cols.high), low: cut(cols.low), volumes: cut(cols.volume) });
}

/* The bar from which the column no longer depends on where the file
   begins: runs with the first k bars left out agree with the full run from
   there, presence and value (to `tol`), each judged from the end of its
   own warm-up (k + its first bar) — before that it has nothing to say. It
   is never before the full run's own first bar; n when that never comes. */
export function settleFrom(full, first, runs, tol) {
  let s = Math.min(first, full.length);
  for (const { k, series, first: fk } of runs) {
    let last = -1;
    for (let i = k + fk; i < full.length; i++) {
      const a = full[i], b = series[i - k];
      if ((a == null) !== (b == null) || (a != null && Math.abs(a - b) > tol)) last = i;
    }
    s = Math.max(s, last + 1);
  }
  return s;
}

/* ---------------------------------------------------- weekly and monthly -- */
/* The interval TradingView's file name says, as the engine names a
   timeframe: '1D', '1W', '1M', or what the name says otherwise ('240');
   null for a name not in TradingView's form. A month is a capital M, as
   TradingView writes it: a lower-case m beside minutes is not guessed (the
   engine's scanTimeframe rule). */
export function intervalOf(file) {
  const tv = tradingViewName(file);
  if (!tv || !tv.interval) return null;
  const i = tv.interval;
  return isDailyInterval(i) ? '1D' : /^1?W$/i.test(i) ? '1W' : /^1?M$/.test(i) ? '1M' : i;
}
const PERIOD_NOUN = { '1W': 'week', '1M': 'month' };
export const BAR_FIELDS = ['open', 'high', 'low', 'close', 'volume'];
/* The period a session date falls in, named by its first day: the ISO
   week's Monday or the month's 1st. The engine's scanMonthOf, and its
   scanWeekOf written out (the engine does not export it; the formula is its
   own). */
export const periodOf = (E, T) => (T === '1M' ? E.scanMonthOf : (d) => E.scanAddDays(d, -((E.scanWeekday(d) + 6) % 7)));
const periodLabel = (T, key) => (T === '1M' ? key.slice(0, 7) : `week of ${key}`);
/* The sessions a period is expected to hold, on the calendar the engine
   builds it with (the market's weekdays: no exchange calendar is held). */
function expectedSessions(E, T, key, cal) {
  const of = periodOf(E, T);
  const out = [];
  for (let d = key, k = 0; of(d) === key && k < 32; d = E.scanAddDays(d, 1), k++) if (E.scanIsSession(cal, d)) out.push(d);
  return out;
}
/* An export's rows dated as ingest/history-import.mjs dates them: each
   stamp by the session it opens, in the market's own zone. */
export function sessionRows(E, text, { market = null, label = 'export' } = {}) {
  const session = E.scanMarket(market);
  return parseCsv(text, label, { tz: session.tz, session });
}
/* Two readings of one price or volume. Both files write the same prices, and
   a period's open, high, low and close are chosen from its days, not
   computed — so only float noise is allowed (a summed volume). */
const sameValue = (a, b) => (a == null || b == null ? a == null && b == null : Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));

/* Weekly or monthly bars built from a daily export by the engine, beside
   the export's own, period by period. `dailyAt` and `at` are when each file
   was saved (its modification time): the daily one's last bar is
   PROVISIONAL when saved before its session closed, as the import marks it,
   and so is the period it falls in. */
export function compareBars(E, { dailyText, text, interval, market = null, symbol = 'X', dailyAt = null, at = null, dailyFile = 'daily export', file = 'export' }) {
  const T = interval;
  if (T !== '1W' && T !== '1M') {
    throw new Error(`${file} is ${T ? `a ${T} export` : 'not named as TradingView names an export ("<EXCHANGE>_<SYMBOL>, 1W.csv")'}: bars are built from a daily export for a weekly (1W) or monthly (1M) one`);
  }
  const noun = PERIOD_NOUN[T];
  const d = sessionRows(E, dailyText, { market, label: dailyFile });
  const p = sessionRows(E, text, { market, label: file });
  /* The daily rows as the store would hold them: one bar per session date.
     Two different rows for one date are both refused (DUPLICATE_DATE), as
     the store refuses them; a row repeated exactly is read once. */
  const byDate = new Map(), refused = d.refused.map(x => ({ date: x.date, codes: x.codes }));
  for (const r of d.rows) {
    const had = byDate.get(r.date);
    if (had === undefined) { byDate.set(r.date, r); continue; }
    if (had && BAR_FIELDS.every(f => had[f] === r[f])) continue;
    if (had) refused.push({ date: r.date, codes: ['DUPLICATE_DATE'] });
    byDate.set(r.date, null);
  }
  const hist = { schema: 2, series: { [symbol]: {} }, volume: { [symbol]: {} }, ohlc: { [symbol]: {} }, meta: { [symbol]: {} } };
  for (const [date, r] of byDate) {
    if (!r) continue;
    hist.series[symbol][date] = r.close;
    if (r.volume != null) hist.volume[symbol][date] = r.volume;
    if (r.open != null || r.high != null || r.low != null) hist.ohlc[symbol][date] = [r.open, r.high, r.low];
    hist.meta[symbol][date] = dailyAt ? { src: `import:${dailyFile}`, at: dailyAt } : { src: `import:${dailyFile}` };
  }
  const daily = E.scanBars(hist, symbol, { market });
  const built = E.scanBars(hist, symbol, { market, timeframe: T });
  refused.push(...daily.invalid.map(x => ({ date: x.date, codes: x.codes })));
  if (!built.dates.length) throw new Error(`${dailyFile} holds no daily bar the engine accepts${refused.length ? ` (${refused.length} refused: ${[...new Set(refused.flatMap(x => x.codes))].join(', ')})` : ''}`);
  const of = periodOf(E, T);
  const cal = E.scanWeekdayCalendar(market);
  const mine = new Map(built.dates.map((dt, k) => [of(dt), k]));
  const heldIn = new Map();
  daily.dates.forEach((dt, i) => { const key = of(dt); if (!heldIn.has(key)) heldIn.set(key, []); heldIn.get(key).push(i); });
  /* The export's bars by period. Two in one period mean the file is not the
     interval its name says, or its stamps are not what this reads them as —
     either way no comparison would mean anything. */
  const theirs = new Map();
  for (const r of p.rows) {
    const key = of(r.date);
    if (theirs.has(key)) throw new Error(`${file}: the bars dated ${theirs.get(key).date} and ${r.date} are both in the ${T === '1M' ? `month ${key.slice(0, 7)}` : `week of ${key}`} — is it a ${T} export?`);
    theirs.set(key, r);
  }
  if (!theirs.size) throw new Error(`${file} holds no bar with a date${p.refused.length ? ` (${p.refused.length} refused: ${p.refused[0].why})` : ''}`);
  const first = of(built.dates[0]), last = of(built.dates[built.dates.length - 1]);
  const theirKeys = [...theirs.keys()].sort();
  const theirFirst = theirKeys[0], theirLast = theirKeys[theirKeys.length - 1];
  const atMs = at == null ? NaN : Date.parse(at);
  /* Periods only one file reaches are counted, not compared: the export's
     before the daily export begins or after it ends, and the daily
     export's before the export begins or after it ends. */
  const outside = { exportBefore: [], exportAfter: [], dailyBefore: [], dailyAfter: [] };
  const periods = [];
  for (const key of [...new Set([...mine.keys(), ...theirs.keys()])].sort()) {
    const k = mine.get(key), t = theirs.get(key);
    if (k == null && key < first) { outside.exportBefore.push(key); continue; }
    if (k == null && key > last) { outside.exportAfter.push(key); continue; }
    if (t == null && key < theirFirst) { outside.dailyBefore.push(key); continue; }
    if (t == null && key > theirLast) { outside.dailyAfter.push(key); continue; }
    const expected = expectedSessions(E, T, key, cal);
    const heldDates = (heldIn.get(key) || []).map(i => daily.dates[i]);
    /* A row refused for its date cell ("2026-13-01", "not-a-date") carries
       the cell as written: it names no period, and asking for its week
       would throw a RangeError out of the engine's date arithmetic and end
       the whole comparison. It is listed with the refused rows, in no period. */
    const rejected = refused.filter(x => E.scanIsDay(x.date) && of(x.date) === key);
    const row = { period: key, label: periodLabel(T, key), sessions: { expected: expected.length, held: heldDates.length, first: heldDates[0] || null, last: heldDates[heldDates.length - 1] || null, missing: k == null ? expected : built.missingDays[k] } };
    const refusedNote = rejected.length ? `; the daily export's row${rejected.length > 1 ? 's' : ''} dated ${rejected.map(x => `${x.date} (${x.codes.join(', ')})`).join(', ')} ${rejected.length > 1 ? 'were' : 'was'} refused` : '';
    if (k == null) { periods.push({ ...row, result: 'DIFFERS', fields: BAR_FIELDS.slice(), built: null, theirs: t, why: `the daily export holds no session in this ${noun}${refusedNote}` }); continue; }
    const b = { open: built.open[k], high: built.high[k], low: built.low[k], close: built.closes[k], volume: built.volumes[k] };
    if (t == null) { periods.push({ ...row, result: 'DIFFERS', fields: BAR_FIELDS.slice(), built: b, theirs: null, why: `the export has no bar for this ${noun}, and the daily export holds ${heldDates.length} session${heldDates.length === 1 ? '' : 's'} in it` }); continue; }
    const tv = { open: t.open, high: t.high, low: t.low, close: t.close, volume: t.volume };
    const fields = BAR_FIELDS.filter(f => !sameValue(b[f], tv[f]));
    if (!fields.length) { periods.push({ ...row, result: 'MATCH', fields, built: b, theirs: tv, why: null }); continue; }
    /* Why it differs, most particular first. */
    const partial = [];
    if (k === 0 && expected.some(x => x < heldDates[0])) {
      partial.push(`the daily export begins on ${heldDates[0]}, after the ${noun}'s first expected session (${expected[0]}): built from ${heldDates.length} of its ${expected.length} weekdays`);
    }
    if (k === built.dates.length - 1 && !built.complete[k]) {
      partial.push(`the ${noun} was still in progress in the daily export: its last session held is ${row.sessions.last}, and the ${noun} runs to ${expected[expected.length - 1]}`);
    } else if (k === built.dates.length - 1 && built.status[k] === 'PROVISIONAL') {
      partial.push(`its last daily bar, ${row.sessions.last}, was saved before that session closed (the daily export was saved at ${dailyAt})`);
    }
    if (key === theirLast && Number.isFinite(atMs) && expected.length && atMs < E.scanSessionEnd(market, expected[expected.length - 1])) {
      partial.push(`TradingView's bar was in progress when ${file} was saved (${at}), before the ${noun}'s last session (${expected[expected.length - 1]}) closed`);
    }
    const missing = row.sessions.missing || [];
    const heldVol = (heldIn.get(key) || []).map(i => daily.volumes[i]);
    const heldSum = heldVol.every(v => Number.isFinite(v)) ? heldVol.reduce((s, v) => s + v, 0) : null;
    const gapNote = missing.length ? `no daily bar on ${missing.join(', ')}` : '';
    let result = 'DIFFERS', why;
    if (partial.length) { result = 'PARTIAL'; why = partial.join('; '); }
    else if (missing.length && fields.length === 1 && fields[0] === 'volume' && b.volume == null && heldSum != null && sameValue(heldSum, tv.volume)) {
      result = 'HOLIDAY';
      why = `${gapNote} — a holiday: TradingView's bar has no session there either (the ${heldDates.length} sessions held sum to its volume, ${heldSum}); the engine sums a ${noun}'s volume only when every expected session is held, so its bar has none. Open, high, low and close agree`;
    } else {
      why = [gapNote && `${gapNote}${heldSum != null && tv.volume != null && !sameValue(heldSum, tv.volume) ? ` (the sessions held sum to a volume of ${heldSum}, TradingView's bar has ${tv.volume}: it holds a session the daily export does not)` : ''}`,
        `differs in ${fields.join(', ')}`].filter(Boolean).join('; ');
    }
    periods.push({ ...row, result, fields, built: b, theirs: tv, why: why + refusedNote });
  }
  const count = (r) => periods.filter(x => x.result === r).length;
  const span = (list) => (list.length ? { n: list.length, from: list[0], to: list[list.length - 1] } : { n: 0 });
  const M = E.scanMarket(market);
  const opens = eveningOpen(M);
  return { interval: T, noun, dailyFile, market: M.code, marketLabel: M.label,
           dating: opens != null ? `a stamp at or after ${String(Math.floor(opens / 60)).padStart(2, '0')}:${String(opens % 60).padStart(2, '0')} ${M.tz} opens the next day's session, and is dated to it`
             : `each stamp is its own day in ${M.tz} (exactly midnight UTC is that UTC date)`,
           rule: E.SCAN_TIMEFRAMES[T].note,
           daily: { bars: daily.dates.length, first: daily.dates[0] || null, last: daily.dates[daily.dates.length - 1] || null, lastStatus: daily.status[daily.status.length - 1] || null, refused },
           export: { bars: p.rows.length, refused: p.refused.map(x => ({ date: x.date, codes: x.codes })) },
           periods, outside: Object.fromEntries(Object.entries(outside).map(([k, v]) => [k, span(v)])),
           summary: { compared: periods.length, match: count('MATCH'), partial: count('PARTIAL'), holiday: count('HOLIDAY'), differs: count('DIFFERS') } };
}

/* The export's indicators, and — with `daily` ({ text, file, at }), for a
   weekly or monthly export — its bars against the engine's built from the
   daily export (compareBars). `interval` is read from the file's name
   unless given; `at` is when the export was saved. */
export async function verify(text, { E = null, sets = {}, file = 'export', interval = undefined, daily = null, market = null, symbol = null, at = null } = {}) {
  E = E || await loadEngine();
  const T = interval === undefined ? intervalOf(file) : interval;
  /* The bars first: two files that cannot be compared are refused before
     any indicator is computed. */
  const bars = daily ? compareBars(E, { dailyText: daily.text, dailyFile: daily.file || 'daily export', dailyAt: daily.at ?? null, text, file, at, interval: T, market,
                                        symbol: symbol || tradingViewName(file)?.symbol || 'X' }) : null;
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error(`${file} holds no bars`);
  const header = csvLine(lines[0]);
  const rows = lines.slice(1).map(csvLine);
  const num = (v) => (v == null || String(v).trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const colAt = (i) => rows.map(r => num(r[i]));
  const n = rows.length;
  const cols = { open: colAt(1), high: colAt(2), low: colAt(3), close: colAt(4), volume: null };
  const ids = CHART.filter(c => c.id).map(c => c.id);
  const params = Object.fromEntries(ids.map(id => [id, paramsFor(E, id, sets)]));
  const plotTitlesOf = (bars) => Object.fromEntries(ids.map(id => [id, E.SCAN_INDICATORS[id].pine(bars, params[id]).plots.map(([t]) => t)]));
  const map = mapColumns(header, plotTitlesOf(barsOf(E, cols)));
  const vi = map.findIndex(m => m.kind === 'input' && m.title === 'Volume');
  if (vi >= 0) cols.volume = colAt(vi);
  const bad = cols.close.findIndex(v => v == null);
  if (bad >= 0) throw new Error(`${file}: row ${bad + 2} has no close`);
  const stampOf = (v) => { const t = Number(v); const ms = Number.isFinite(t) ? t * 1000 : Date.parse(v); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : String(v); };
  const stamps = rows.map(r => stampOf(r[0]));
  /* Every indicator once on the file, and once per drop. */
  const full = {}, dropped = {};
  for (const id of ids) {
    full[id] = E.SCAN_INDICATORS[id].pine(barsOf(E, cols), params[id]).plots;
    dropped[id] = DROPS.filter(k => k < n - 1).map(k => ({ k, plots: E.SCAN_INDICATORS[id].pine(barsOf(E, cols, k), params[id]).plots }));
  }
  const out = [];
  map.forEach((m, i) => {
    const row = { column: m.column, title: m.title, kind: m.kind };
    if (m.kind === 'input') { out.push({ ...row, result: 'INPUT' }); return; }
    const theirs = colAt(i);
    const filled = theirs.filter(v => v != null).length;
    if (m.kind === 'none') { out.push({ ...row, result: 'NOT COMPARED', why: m.why, filled }); return; }
    const [, mine, first] = full[m.id][m.plot];
    const runs = dropped[m.id].map(d => ({ k: d.k, series: d.plots[m.plot][1], first: d.plots[m.plot][2] }));
    const scale = Math.max(1e-9, ...theirs.filter(v => v != null).map(Math.abs), ...mine.filter(v => v != null).map(Math.abs));
    const tol = REL_TOL * scale;
    const s = settleFrom(mine, first, runs, tol / 10);
    const cmp = (from) => {
      let compared = 0, values = 0, worst = 0, worstAt = null, presence = 0, presenceAt = null;
      for (let j = from; j < n; j++) {
        const a = mine[j], b = theirs[j];
        compared++;
        if ((a == null) !== (b == null)) { presence++; if (presenceAt == null) presenceAt = j; continue; }
        if (a == null) continue;
        values++;
        const d = Math.abs(a - b);
        if (worstAt == null || d > worst) { worst = d; worstAt = j; }
      }
      return { compared, values, worst, worstAt, presence, presenceAt };
    };
    /* The plot by its title, numbered where the script has several of it. */
    const same = full[m.id].filter(([t]) => t === m.title).length;
    const occ = full[m.id].slice(0, m.plot + 1).filter(([t]) => t === m.title).length;
    const base = { ...row, indicator: m.id, plot: same > 1 ? `${m.title} #${occ}` : m.title, params: params[m.id], filled, tolerance: tol };
    if (s >= n || n - s < MIN_BARS) {
      const info = cmp(Math.min(first, n));
      out.push({ ...base, result: 'NOT SETTLED', settledFrom: s >= n ? null : s, firstBar: first, compared: s >= n ? 0 : n - s, worst: info.values ? info.worst : null,
                 note: first >= n ? `its first value needs ${first + 1} bars, and the file holds ${n}`
                   : s >= n ? `does not settle within the file’s ${n} bars — its memory is longer than the export`
                   : `settles only at bar ${s}, leaving ${n - s} of ${n} bars` });
      return;
    }
    const r = cmp(s);
    const ok = r.presence === 0 && r.worst <= tol;
    out.push({ ...base, result: ok ? 'MATCH' : 'DIFFERS', settledFrom: s, firstBar: first, from: stamps[s], to: stamps[n - 1], compared: r.compared, values: r.values,
               worst: r.values ? r.worst : 0, worstAt: r.worstAt == null ? null : { bar: r.worstAt, stamp: stamps[r.worstAt], mine: mine[r.worstAt], theirs: theirs[r.worstAt] },
               presenceMismatches: r.presence, firstPresenceMismatch: r.presenceAt == null ? null : { bar: r.presenceAt, stamp: stamps[r.presenceAt], mine: mine[r.presenceAt], theirs: theirs[r.presenceAt] } });
  });
  const count = (k) => out.filter(r => r.result === k).length;
  return { file, interval: T, bars: n, first: stamps[0], last: stamps[n - 1], sets, rows: out,
           summary: { match: count('MATCH'), differs: count('DIFFERS'), notSettled: count('NOT SETTLED'), notCompared: count('NOT COMPARED'), inputs: count('INPUT') },
           periods: bars };
}

const fmtNum = (v) => (v == null ? '—' : v === 0 ? '0' : Math.abs(v) >= 0.01 && Math.abs(v) < 1e6 ? String(Number(v.toPrecision(4))) : v.toExponential(1));
export function table(rep) {
  const L = [];
  const tf = { '1D': 'daily', '1W': 'weekly', '1M': 'monthly' }[rep.interval];
  L.push(`TradingView export  ${rep.file} — ${rep.bars} ${tf ? `${tf} bars` : rep.interval ? `bars of ${rep.interval}` : 'bars'}, stamped ${rep.first} … ${rep.last} (UTC)`);
  L.push(`Settings            the reader's chart, as SCAN_PINE_INDICATORS holds it${Object.keys(rep.sets).length ? `, with ${Object.entries(rep.sets).map(([id, o]) => Object.entries(o).map(([k, v]) => `${id}.${k}=${v}`).join(' ')).join(' ')}` : ''}`);
  L.push(`Match               within ${REL_TOL} of the column's largest magnitude, blanks where TradingView has blanks, on every bar from the one where the column settles`);
  L.push('');
  L.push(`${'col'.padStart(3)}  ${'column'.padEnd(26)} ${'read as'.padEnd(30)} ${'settled'.padStart(7)} ${'compared'.padStart(8)}  ${'worst |diff|'.padEnd(12)} result`);
  for (const r of rep.rows) {
    if (r.kind === 'input') continue;
    const readAs = r.kind === 'none' ? '—' : `${r.indicator} · ${r.plot}`;
    const settled = r.settledFrom == null ? '—' : `bar ${r.settledFrom}`;
    const compared = r.kind === 'none' ? '' : String(r.compared ?? 0);
    const worst = r.kind === 'none' ? '' : r.result === 'NOT SETTLED' ? (r.worst == null ? '—' : `(${fmtNum(r.worst)})`) : fmtNum(r.worst);
    let line = `${String(r.column).padStart(3)}  ${r.title.slice(0, 26).padEnd(26)} ${readAs.slice(0, 30).padEnd(30)} ${settled.padStart(7)} ${compared.padStart(8)}  ${worst.padEnd(12)} ${r.result}`;
    if (r.result === 'DIFFERS') line += r.presenceMismatches ? ` — ${r.presenceMismatches} bar(s) where one side is blank, first bar ${r.firstPresenceMismatch.bar} (${r.firstPresenceMismatch.stamp}): computed ${fmtNum(r.firstPresenceMismatch.mine)}, TradingView ${fmtNum(r.firstPresenceMismatch.theirs)}`
      : ` — worst at bar ${r.worstAt.bar} (${r.worstAt.stamp}): computed ${fmtNum(r.worstAt.mine)}, TradingView ${fmtNum(r.worstAt.theirs)}`;
    if (r.result === 'MATCH' && !r.values) line += ' — blank on every bar, as on the chart';
    if (r.result === 'NOT SETTLED') line += ` — ${r.note}`;
    if (r.result === 'NOT COMPARED') line += ` — ${r.why}${r.filled ? '' : ' (empty in this export)'}`;
    L.push(line);
  }
  const s = rep.summary;
  L.push('');
  L.push(`${s.match} MATCH, ${s.differs} DIFFERS, ${s.notSettled} NOT SETTLED, ${s.notCompared} NOT COMPARED (and ${s.inputs} columns of bars)`);
  L.push('A worst difference in brackets is after warm-up but before the column settles: for information, not a result.');
  if (rep.periods) L.push('', ...periodTable(rep.periods, rep.file));
  return L.join('\n');
}

/* The bars' comparison, in words: the counts, then every period that is
   not a MATCH. */
const fmtBar = (v) => (v == null ? '—' : String(Number(v.toPrecision(12))));
export function periodTable(c, file = 'export') {
  const L = [];
  const Noun = c.noun[0].toUpperCase() + c.noun.slice(1);
  const lbl = (key) => (c.interval === '1M' ? key.slice(0, 7) : `week of ${key}`);
  L.push(`${Noun}ly bars built from ${c.dailyFile} by the engine, against ${file}'s`);
  L.push(`  daily export  ${c.daily.bars} bars, sessions ${c.daily.first} … ${c.daily.last} (the last ${c.daily.lastStatus}), dated by the ${c.marketLabel} session (${c.market}): ${c.dating}`);
  if (c.daily.refused.length) L.push(`                ${c.daily.refused.length} row(s) refused, not built from: ${c.daily.refused.slice(0, 6).map(x => `${x.date || '?'} (${x.codes.join(', ')})`).join(', ')}${c.daily.refused.length > 6 ? ', …' : ''}`);
  if (c.export.refused.length) L.push(`  export        ${c.export.refused.length} row(s) with a date that could not be read, not compared`);
  L.push(`  built as      ${c.rule}`);
  const s = c.summary;
  const range = c.periods.length ? `, ${lbl(c.periods[0].period)} … ${lbl(c.periods[c.periods.length - 1].period)}` : '';
  L.push(`  compared      ${s.compared} ${c.noun}s${range}: ${s.match} MATCH, ${s.partial} PARTIAL, ${s.holiday} HOLIDAY, ${s.differs} DIFFERS`);
  const out = [['exportBefore', `of ${file} before the daily export begins`], ['exportAfter', `of ${file} after the daily export ends`],
               ['dailyBefore', `of the daily export before ${file} begins`], ['dailyAfter', `of the daily export after ${file} ends`]];
  for (const [k, what] of out) {
    const o = c.outside[k];
    if (o.n) L.push(`  not compared  ${o.n} ${c.noun}${o.n === 1 ? '' : 's'} ${what} (${lbl(o.from)}${o.n > 1 ? ` … ${lbl(o.to)}` : ''})`);
  }
  const shown = c.periods.filter(x => x.result !== 'MATCH');
  if (shown.length) L.push('');
  for (const x of shown) {
    const vals = x.fields.map(f => `${f} built ${fmtBar(x.built?.[f])}, TradingView ${fmtBar(x.theirs?.[f])}`).join('; ');
    L.push(`  ${lbl(x.period).padEnd(18)} ${x.result.padEnd(8)} ${x.why}${x.result !== 'HOLIDAY' && vals ? ` — ${vals}` : ''}`);
  }
  return L;
}

async function main(argv) {
  const args = argv.slice(2);
  const val = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
  const csv = val('csv');
  if (!csv || args.includes('--help')) {
    console.error('usage: node scanner/tv-verify.mjs --csv "<TradingView export>" [--daily "<the daily export of the same symbol>"] [--market CODE] [--captured-at ISO] [--set id.param=value ...] [--json]');
    return 2;
  }
  const sets = [];
  args.forEach((a, i) => { if (a === '--set' && args[i + 1]) sets.push(args[i + 1]); });
  let E, text;
  try { E = await loadEngine(); } catch (e) { console.error(`Could not load the scan engine out of index.html: ${e.message}`); return 2; }
  try { text = await readFile(csv, 'utf8'); } catch (e) { console.error(`Could not read ${csv}: ${e.message}`); return 2; }
  /* --daily: the daily export of the same symbol, dated in its market. The
     names say the interval and the symbol; a file saved at an instant is
     marked by it, as the import marks it (its modification time, unless
     --captured-at says otherwise). */
  const dailyPath = val('daily');
  let daily = null, market = null, symbol = null, at = null;
  if (args.includes('--daily') && !dailyPath) { console.error('tv-verify: --daily needs the daily export\'s path'); return 2; }
  const captured = val('captured-at');
  if (captured && !Number.isFinite(Date.parse(captured))) { console.error(`tv-verify: --captured-at "${captured}" is not a date-time`); return 2; }
  if (dailyPath) {
    const T = intervalOf(csv), dT = intervalOf(dailyPath);
    if (T !== '1W' && T !== '1M') { console.error(`tv-verify: --daily builds weekly and monthly bars, and ${basename(csv)} is ${T ? `a ${T} export` : 'not named as TradingView names an export ("<EXCHANGE>_<SYMBOL>, 1W.csv")'}`); return 2; }
    if (dT && dT !== '1D') { console.error(`tv-verify: --daily ${basename(dailyPath)} is a ${dT} export — give the daily one (1D)`); return 2; }
    const a = tradingViewName(csv), b = tradingViewName(dailyPath);
    if (a && b && (a.symbol !== b.symbol || a.exchange !== b.exchange)) { console.error(`tv-verify: --csv is ${a.exchange}:${a.symbol} and --daily is ${b.exchange}:${b.symbol} — export the same symbol twice`); return 2; }
    symbol = a?.symbol || b?.symbol || 'X';
    market = val('market') || marketOf(symbol, await loadInstruments());
    let dailyText;
    try { dailyText = await readFile(dailyPath, 'utf8'); } catch (e) { console.error(`Could not read ${dailyPath}: ${e.message}`); return 2; }
    const mtime = async (f) => (await stat(f)).mtime.toISOString();
    at = captured ? new Date(Date.parse(captured)).toISOString() : await mtime(csv);
    daily = { text: dailyText, file: basename(dailyPath), at: captured ? at : await mtime(dailyPath) };
  }
  let rep;
  try { rep = await verify(text, { E, sets: parseSets(sets, E), file: basename(csv), daily, market, symbol, at }); } catch (e) { console.error(`tv-verify: ${e.message}`); return 2; }
  console.log(args.includes('--json') ? JSON.stringify(rep, null, 2) : table(rep));
  return rep.summary.differs || rep.periods?.summary.differs ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv);
