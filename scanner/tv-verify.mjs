#!/usr/bin/env node
/**
 * scanner/tv-verify.mjs — the reader's TradingView indicators, recomputed from
 * an export of their own chart and compared with it column by column.
 *
 *   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1D.csv"
 *   node scanner/tv-verify.mjs --csv FILE --set wavetrend.channel=9 --json
 *   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1W.csv"   (and 1M)
 *   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1W.csv" \
 *       --daily "watchlist-shots/OANDA_XAUUSD, 1D.csv"     (and 1M the same way)
 *   ... [--interval 1W|1M] [--market FX] [--captured-at ISO]
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
 * plots are all "Plot" (plotchar marks "Chars", plotshape marks "Shapes"), so
 * a column is read by its title and its place. An indicator's plots sit side
 * by side in the file, in the order its script declares them, so the file is
 * read left to right in runs: a title starts a run of the indicator that
 * plots it, and the run goes on while each next title is another plot of
 * that indicator not yet read — a second "RSI" after the first one's plots
 * is a second RSI. The first five columns must be time, open, high, low and
 * close. A plot the reader has hidden is simply absent from the file; but a
 * hidden untitled plot moves every "Plot" after it in its run, and the table
 * names the plot each column was read as. Where an untitled run fits two
 * indicators — "Plot", "Plot" is SMA Cross's two averages or the blackcat
 * script's first two marks — the one that fits more of the run takes it
 * ("Plot", "Plot", "Chars", "Chars" is SMA Cross), and on a tie the numbers
 * decide: the indicator whose values agree, and NOT KNOWN when neither's, or
 * both's, do.
 *
 * NOT KNOWN. A column no script this tool computes draws — Ichimoku's lines,
 * Volume MA, VWAP and its bands, anything else — is listed with its title and
 * position and not compared: guessing what it holds would compare it with
 * the wrong thing and call that a result. It never refuses the file; the
 * result is the columns compared.
 *
 * THE BOT'S PLOTS. The Multi-Timeframe Trading Bot draws its alerts as marks
 * titled as the alerts are ("Strong Buy - Continuous" is its STRONG BUY
 * CONTINUOUS: the engine's SCAN_BOT_SIGNALS, matched on their words). Each is
 * listed as a BOT PLOT with the bars it marks, not compared: the bot joins
 * the chart's timeframe with its Entry timeframe's, so one file cannot
 * check it.
 *
 * WHICH SETTINGS. SCAN_PINE_INDICATORS holds the reader's DAILY chart's
 * settings, and a daily export is computed with them (--set changes one).
 * Another chart holds its own: the reader's weekly chart draws its Color MA
 * as the script's own default, an EMA, where the daily one draws an SMA, and
 * carries a second RSI of 14. So on a weekly or monthly export, and for a
 * second copy of an indicator on any chart, each of a few candidates is
 * computed — the daily chart's settings, the script's own defaults from its
 * Pine source, and for the MACD the bot's EMA signal (ALTERNATIVES) — and
 * the numbers decide. A candidate is refuted when a column DIFFERS with it
 * and fits when every column it settles agrees. The daily chart's is taken
 * when it fits, else the one candidate that fits ("found from the numbers");
 * when none fits and some cannot be told apart in the file, the columns are
 * NOT SETTLED and the candidates named; when every candidate is refuted, the
 * daily chart's comparison stands, and DIFFERS.
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
 *   NOT KNOWN     no script this tool computes draws the column (above)
 *   BOT PLOT      one of the bot's alert marks (above)
 *
 * WEEKLY AND MONTHLY EXPORTS. TradingView names an export "<EXCHANGE>_<SYMBOL>,
 * <INTERVAL>.csv", and the interval is read from that name as
 * ingest/history-import.mjs reads it (exportTimeframe): 1D, 1W or 1M (a
 * capital M is the month; TradingView writes minutes as a number), or from
 * --interval. The indicators of a weekly or monthly export are computed from
 * its own bars, exactly as a daily one's — TradingView computes them on the
 * bars of the chart they are drawn on — and each row is dated as the import
 * files it: its stamp by the session it opens, in the instrument's market
 * (its data/instruments.json row, or --market), under the engine's key for
 * its week or month (history-store's periodKey). So the table names each bar
 * by the week or month the scanner holds it under, and a file with two rows
 * in one period is refused.
 *
 * BARS FROM THE DAILY EXPORT (--daily). Wherever the history holds no imported
 * week or month, the scanner builds it from the daily history (the engine's
 * scanResample, reached through scanBars as the scanner reaches it), and a
 * setup read on that week is only as right as the build. So, given the daily
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
 * period), 2 when a file cannot be read, its first five columns are not the
 * bars, a weekly or monthly file has two rows in one period, the two files
 * cannot be compared (not weekly or monthly, another symbol), or a flag is
 * given without its value. A column
 * NOT KNOWN, NOT COMPARED or a BOT PLOT decides nothing.
 *
 * The export is the reader's licensed data: this reads it where it lies and
 * writes nothing. No check in CI depends on any export; scanner-test drives
 * this tool with a file it builds itself.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEngine } from './scan.mjs';
import { tradingViewName, exportTimeframe, parseCsv } from '../ingest/history-import.mjs';
import { loadInstruments, marketOf, eveningOpen, parseDateCell, periodKey, periodStatus, periodLastSession } from '../ingest/history-store.mjs';

/* The scripts this tool knows, as the reader's daily chart holds them
   top to bottom (the order no longer decides anything: the runs of a
   header do — THE COLUMNS above). `id` is a Pine indicator of the engine,
   whose plots give the titles; `input` is a column of bars; `bot` is the
   Multi-Timeframe Trading Bot's alert marks, titled from SCAN_BOT_SIGNALS;
   `of` adds to an indicator's run the columns its script draws that the
   engine does not compute, each with why — or, with `same`, a column read
   as another plot of it where the export shows the two equal; `titled`
   is a pair of columns known by title (TITLED). */
export const CHART = [
  { id: 'psar' },
  { id: 'sma_cross' },
  { input: 'Volume' },
  { id: 'sr_ma' },
  { bot: true },
  { id: 'color_ma' },
  { id: 'cm_macd' },
  { id: 'mcdx' },
  { id: 'banker_entry' },
  { id: 'tv_rsi' },
  { of: 'tv_rsi', titles: ['Regular Bullish', 'Regular Bullish Label', 'Regular Bearish', 'Regular Bearish Label'],
    why: 'the RSI script’s divergences (drawn only with its Calculate Divergence setting on), which the engine does not compute' },
  { id: 'wavetrend' },
  { of: 'wavetrend', titles: ['Bearish Regular Divergence', 'Bearish Hidden Divergence', 'Bullish Regular Divergence', 'Bullish Regular Divergence'],
    why: 'the WaveTrend script’s divergence labels, which it draws only with its divergence switches on (off by default, and on your chart); the engine computes the fractal plots beside them (Divergencias Bajistas and Alcistas), not these' },
  /* The WaveTrend script's second extra MA. The Pine source given holds
     only the first one's settings (MA PLOT_ST, a TEMA of 200), so this one
     is read as that average only where the export shows the two columns
     equal on every bar — as the reader's weekly chart does. */
  { of: 'wavetrend', titles: ['MA PLOT_LT'], same: 'MA PLOT_ST',
    why: 'the WaveTrend script’s second extra MA, whose settings the Pine source given does not show' },
  { titled: 'ma_pair' },
];
export const INPUTS = ['time', 'open', 'high', 'low', 'close'];
export const DROPS = [1, 2, 3, 5, 8, 13, 21, 34];
export const MIN_BARS = 20;
export const REL_TOL = 1e-6;

/* Columns known by their titles from a script whose Pine source this tool
   does not hold. The reader's monthly chart draws two averages titled
   "Short Period Moving Average" and "Long Period Moving Average" — not the
   SMA Cross script, whose averages are untitled "Plot"s. Each candidate is
   the engine's own average of the close at the lengths the reader's SMA
   Cross uses (50 with 200 on the chart, 100 in the script), simple or
   exponential; a pair no candidate fits is NOT KNOWN, never DIFFERS, since
   without the source a mismatch says only that it is none of them. */
export const TITLED = {
  ma_pair: {
    label: 'Moving-average pair',
    titles: ['Short Period Moving Average', 'Long Period Moving Average'],
    candidates: (E) => [['SMA', 1, 'as simple averages'], ['EMA', 2, 'as exponential averages']].flatMap(([name, type, as]) => [[50, 200, 'your SMA Cross chart’s lengths'], [50, 100, 'the SMA Cross script’s default lengths']]
      .map(([s, l, lengths]) => ({ label: `${name} ${s} and ${name} ${l}`, from: `${lengths}, ${as}`, params: { type, short: s, long: l },
        plots: (b) => [['Short Period Moving Average', E.scanPineMa(type, b.closes || [], s, b.volumes), s - 1], ['Long Period Moving Average', E.scanPineMa(type, b.closes || [], l, b.volumes), l - 1]] }))),
  },
};

/* The settings a chart other than the daily one may hold, beside the daily
   chart's own (the catalogue's, with --set over them): each script's own
   defaults, from its Pine source, and the MACD with the bot's EMA signal —
   which of the owner's two MACDs a chart draws is for its numbers to say.
   An indicator absent here has one candidate: its script's defaults are
   the daily chart's (the SAR, MCDX, SR MA, the blackcat script). */
export const ALTERNATIVES = {
  color_ma: [{ set: { type: 2, n: 200 }, from: 'the Color MA script’s own default' }],
  sma_cross: [{ set: { fast: 50, slow: 100 }, from: 'the SMA Cross script’s own default' }],
  tv_rsi: [{ set: { n: 14, maType: 1, maLen: 14 }, from: 'TradingView’s RSI default' }],
  cm_macd: [{ signal: 'ema', from: 'the Multi-Timeframe Trading Bot’s own MACD' }],
  wavetrend: [{ set: { obSwitch: 1, osSwitch: 1 }, from: 'the WaveTrend script’s own default' }],
};
/* A candidate's settings in words. */
export function settingsLabel(E, id, p, variant = null) {
  const on = (v) => (Number(v) === 1 ? 'on' : 'off');
  switch (id) {
    case 'color_ma': return `${E.SCAN_PINE_MA_TYPES[p.type]} ${p.n}`;
    case 'sma_cross': return `SMA ${p.fast} and SMA ${p.slow}`;
    case 'tv_rsi': return `RSI ${p.n} with ${E.SCAN_PINE_RSI_MA[p.maType]} ${p.maLen}`;
    case 'cm_macd': return `${p.fast}, ${p.slow} and ${p.signal} with ${variant === 'ema' ? 'an EMA' : 'an SMA'} signal`;
    case 'wavetrend': return `${p.channel} and ${p.average}, “Sell when overbought” ${on(p.obSwitch)}, “Buy when oversold” ${on(p.osSwitch)}`;
    default: return Object.entries(p).map(([k, v]) => `${k} ${v}`).join(', ');
  }
}
/* The chart's CM MACD columns with the bot's EMA signal in place of the
   SMA one: the line, signal and histogram of the engine's bot_macd, drawn
   as CM_Ult_MacD draws its own — a line of exactly 0 not plotted, the
   cross dot on the signal line. Its warm-up is the CM MACD's: an EMA
   signal is seeded on the bar an SMA one begins. */
export function emaSignalPlots(E, bars, p) {
  const cm = E.SCAN_INDICATORS.cm_macd.pine(bars, p).plots;
  const { macd, signal, hist } = E.SCAN_INDICATORS.bot_macd.pine(bars, p).fields;
  const shown = (a) => a.map(v => (v == null || v === 0 ? null : v));
  const cross = E.scanPineCross(macd, signal).map((x, i) => (x === true ? signal[i] : null));
  const series = [shown(macd), shown(signal), shown(hist), cross];
  return cm.map(([t, , first], k) => [t, series[k], first]);
}

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

/* A title's words: "Strong Buy - Continuous" and the alert "STRONG BUY
   CONTINUOUS" are one. */
export const titleWords = (t) => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/* The runs a header can be read in: each indicator's plots (the engine's
   titles, `plotTitles[id]`) with its script's other columns, the bars'
   Volume, the bot's alert marks (`bot`, the engine's SCAN_BOT_SIGNALS) and
   the titled pair. */
function families(plotTitles, bot) {
  const out = [];
  for (const entry of CHART) {
    if (entry.input) out.push({ key: `input:${entry.input}`, slots: [{ kind: 'input', title: entry.input }] });
    else if (entry.id && plotTitles[entry.id]) {
      const own = plotTitles[entry.id];
      const slots = own.map((t, k) => ({ kind: 'plot', title: t, id: entry.id, plot: k }));
      for (const extra of CHART.filter(x => x.of === entry.id)) {
        for (const t of extra.titles) {
          const k = extra.same ? own.indexOf(extra.same) : -1;
          slots.push(k >= 0 ? { kind: 'plot', title: t, id: entry.id, plot: k, same: extra.same, why: extra.why } : { kind: 'none', title: t, id: entry.id, why: extra.why });
        }
      }
      out.push({ key: entry.id, id: entry.id, slots });
    } else if (entry.bot && bot?.length) out.push({ key: 'bot', slots: bot.map(s => ({ kind: 'bot', title: s.title, signal: s.id, words: titleWords(s.title) })) });
    else if (entry.titled) out.push({ key: entry.titled, id: entry.titled, slots: TITLED[entry.titled].titles.map((t, k) => ({ kind: 'plot', title: t, id: entry.titled, plot: k })) });
  }
  return out;
}

/* Which column is which (THE COLUMNS above): every title of the header an
   input, a plot of an indicator, a known column not computed ('none'), one
   of the bot's marks ('bot'), 'unknown', or 'ambiguous' — an untitled run
   two indicators fit alike, with each one's reading as `candidates` for
   the numbers to decide. Each run is a `block`. Throws, naming the column,
   only when the first five columns are not the bars. */
export function mapColumns(header, plotTitles, { bot = [] } = {}) {
  const bad = (i, why) => { const e = new Error(`column ${i + 1} “${header[i]}” ${why}`); e.column = i + 1; throw e; };
  INPUTS.forEach((t, i) => { if (String(header[i] ?? '').trim().toLowerCase() !== t) bad(i, `should be “${t}” — the first five columns of an export are time, open, high, low and close`); });
  const fams = families(plotTitles, bot);
  const titles = header.map(h => String(h ?? '').trim());
  const fits = (slot, title) => (slot.kind === 'bot' ? slot.words === titleWords(title) : slot.title === title);
  /* The first plot of the title the run has not read yet. */
  const next = (fam, used, title) => fam.slots.findIndex((s, k) => !used.has(k) && fits(s, title));
  const runFrom = (fam, i) => { const used = new Set(), slots = []; for (let j = i; j < titles.length; j++) { const k = next(fam, used, titles[j]); if (k < 0) break; used.add(k); slots.push(k); } return slots; };
  const entry = (fam, k, i, block) => {
    const { words, ...slot } = fam.slots[k];
    return { ...slot, title: titles[i], column: i + 1, block };
  };
  const out = INPUTS.map((t, i) => ({ kind: 'input', title: t, column: i + 1 }));
  let cur = null, blocks = 0;
  for (let i = INPUTS.length; i < titles.length; i++) {
    const t = titles[i];
    if (cur) {
      const k = next(cur.fam, cur.used, t);
      if (k >= 0) { cur.used.add(k); out.push(entry(cur.fam, k, i, cur.block)); continue; }
    }
    const runs = fams.map(fam => ({ fam, slots: runFrom(fam, i) })).filter(r => r.slots.length);
    if (!runs.length) { out.push({ kind: 'unknown', title: t, column: i + 1 }); cur = null; continue; }
    const len = Math.max(...runs.map(r => r.slots.length));
    const top = runs.filter(r => r.slots.length === len);
    const block = ++blocks;
    if (top.length === 1) {
      cur = { fam: top[0].fam, used: new Set([top[0].slots[0]]), block };
      out.push(entry(top[0].fam, top[0].slots[0], i, block));
      continue;
    }
    for (let j = 0; j < len; j++) out.push({ kind: 'ambiguous', title: titles[i + j], column: i + j + 1, block, candidates: top.map(r => entry(r.fam, r.slots[j], i + j, block)) });
    i += len - 1;
    cur = null;
  }
  return out;
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
   timeframe: '1D', '1W', '1M' — ingest/history-import.mjs's exportTimeframe,
   so the tool and the import read one name alike — or what the name says
   otherwise ('240'); null for a name not in TradingView's form. A month is a
   capital M, as TradingView writes it: a lower-case m beside minutes is not
   guessed (the engine's scanTimeframe rule). */
export function intervalOf(file) {
  const tv = tradingViewName(file);
  if (!tv || !tv.interval) return null;
  return exportTimeframe(tv.interval) || tv.interval;
}
const PERIOD_NOUN = { '1W': 'week', '1M': 'month' };
export const BAR_FIELDS = ['open', 'high', 'low', 'close', 'volume'];
/* The period a session date falls in, named by its first day: the ISO
   week's Monday or the month's 1st — the engine's scanWeekOf and
   scanMonthOf, which the worker's list hands out (ENGINE_EXPORTS). A copy
   of the week's formula stood in here until the list carried scanWeekOf;
   two formulas for one key is what the store's period keys must never be,
   and nothing reaches it now. */
export const periodOf = (E, T) => (T === '1M' ? E.scanMonthOf : E.scanWeekOf);
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
  return { interval: T, noun, dailyFile, market: M.code, marketLabel: M.label, dating: datingRule(M),
           rule: E.SCAN_TIMEFRAMES[T].note,
           daily: { bars: daily.dates.length, first: daily.dates[0] || null, last: daily.dates[daily.dates.length - 1] || null, lastStatus: daily.status[daily.status.length - 1] || null, refused },
           export: { bars: p.rows.length, refused: p.refused.map(x => ({ date: x.date, codes: x.codes })) },
           periods, outside: Object.fromEntries(Object.entries(outside).map(([k, v]) => [k, span(v)])),
           summary: { compared: periods.length, match: count('MATCH'), partial: count('PARTIAL'), holiday: count('HOLIDAY'), differs: count('DIFFERS') } };
}

/* How a market's stamps are dated, in words. */
export function datingRule(M) {
  const opens = eveningOpen(M);
  return opens != null ? `a stamp at or after ${String(Math.floor(opens / 60)).padStart(2, '0')}:${String(opens % 60).padStart(2, '0')} ${M.tz} opens the next day's session, and is dated to it`
    : `each stamp is its own day in ${M.tz} (exactly midnight UTC is that UTC date)`;
}
/* A weekly or monthly export's rows dated as the import files them (WEEKLY
   AND MONTHLY EXPORTS above): each stamp by the session it opens in the
   market, under the engine's key for its week or month. A cell that is no
   date names no period (null). Two rows in one period mean the file is not
   the interval its name says, or its stamps are not what this reads them
   as — refused, as compareBars refuses them. The last period's status is
   the import's: PROVISIONAL when the file was saved (`at`) before its last
   expected session closed. */
export function datePeriods(E, T, cells, { market = null, file = 'export', at = null } = {}) {
  const M = E.scanMarket(market);
  const seen = new Map();
  const keys = cells.map((cell) => {
    const d = parseDateCell(cell, { tz: M.tz, session: M });
    const key = d.date ? periodKey(E, T, d.date) : null;
    if (key && seen.has(key)) throw new Error(`${file}: the bars dated ${seen.get(key)} and ${d.date} are both in the ${T === '1M' ? `month ${key.slice(0, 7)}` : `week of ${key}`} — is it a ${T} export?`);
    if (key) seen.set(key, d.date);
    return key;
  });
  const held = keys.filter(Boolean);
  const last = held.length ? held[held.length - 1] : null;
  return { keys, first: held[0] || null, last, market: M.code, marketLabel: M.label, dating: datingRule(M), at,
           lastSession: last ? periodLastSession(E, T, last, market) : null, lastStatus: last && at ? periodStatus(E, T, last, market, at) : null };
}

/* One column against a computed plot: from the bar where the column
   settles (settleFrom), every value within the tolerance and a blank
   wherever TradingView has one — MATCH or DIFFERS — or NOT SETTLED when
   that bar never comes or leaves fewer than MIN_BARS. `labels` name the
   bars. */
function compareColumn(mine, first, runs, theirs, labels) {
  const n = theirs.length;
  const filled = theirs.filter(v => v != null).length;
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
  const base = { filled, tolerance: tol };
  if (s >= n || n - s < MIN_BARS) {
    const info = cmp(Math.min(first, n));
    return { ...base, result: 'NOT SETTLED', settledFrom: s >= n ? null : s, firstBar: first, compared: s >= n ? 0 : n - s, worst: info.values ? info.worst : null,
             note: first >= n ? `its first value needs ${first + 1} bars, and the file holds ${n}`
               : s >= n ? `does not settle within the file’s ${n} bars — its memory is longer than the export`
               : `settles only at bar ${s}, leaving ${n - s} of ${n} bars` };
  }
  const r = cmp(s);
  const ok = r.presence === 0 && r.worst <= tol;
  return { ...base, result: ok ? 'MATCH' : 'DIFFERS', settledFrom: s, firstBar: first, from: labels[s], to: labels[n - 1], compared: r.compared, values: r.values,
           worst: r.values ? r.worst : 0, worstAt: r.worstAt == null ? null : { bar: r.worstAt, stamp: labels[r.worstAt], mine: mine[r.worstAt], theirs: theirs[r.worstAt] },
           presenceMismatches: r.presence, firstPresenceMismatch: r.presenceAt == null ? null : { bar: r.presenceAt, stamp: labels[r.presenceAt], mine: mine[r.presenceAt], theirs: theirs[r.presenceAt] } };
}

/* The candidate settings of one indicator (WHICH SETTINGS above): the daily
   chart's — the catalogue's, with --set over them — and, when `search`, its
   ALTERNATIVES; a titled pair's own candidates. Each with its words, where
   it comes from, and how it plots. */
function candidatesFor(E, id, { params, sets = {}, search = false }) {
  if (TITLED[id]) return TITLED[id].candidates(E);
  const def = E.SCAN_INDICATORS[id];
  const p0 = params[id];
  const c0 = { label: settingsLabel(E, id, p0), from: sets[id] ? 'your --set' : 'your daily chart’s', params: p0, plots: (b) => def.pine(b, p0).plots };
  if (!search) return [c0];
  const alts = (ALTERNATIVES[id] || []).map((a) => {
    const p = { ...p0, ...(a.set || {}) };
    return a.signal === 'ema'
      ? { label: settingsLabel(E, id, p, 'ema'), from: a.from, params: { ...p, signalType: 'ema' }, plots: (b) => emaSignalPlots(E, b, p) }
      : { label: settingsLabel(E, id, p), from: a.from, params: p, plots: (b) => def.pine(b, p).plots };
  }).filter(c => c.label !== c0.label);
  return [c0, ...alts];
}
/* The numbers' verdict on a run's candidates, each refuted (a column
   DIFFERS), fitting (none differs and one agrees on values), or open
   (nothing settles either way): the daily chart's when it fits, else the
   one that fits, else the open ones, else every one refuted — the daily
   chart's comparison stands, or, for a titled pair whose source is not
   held, nothing is known. */
function decide(evals, { unsourced = false } = {}) {
  const fits = evals.filter(e => e.status === 'fits'), open = evals.filter(e => e.status === 'open');
  if (!unsourced && evals[0].status === 'fits') return { how: 'chart', pick: evals[0] };
  if (fits.length === 1) return { how: 'found', pick: fits[0] };
  if (fits.length > 1) return { how: 'alike', pick: fits[0] };
  if (open.length) return { how: 'open', pick: open[0] };
  return { how: unsourced ? 'none' : 'differs', pick: evals[0] };
}
const STATUS_WORDS = { fits: 'fits as well', open: 'does not settle in the file', refuted: 'DIFFERS' };
const botWhy = (sig) => (sig?.needsTradeTimeframe
  ? `the Multi-Timeframe Trading Bot’s ${sig.title}: it joins its Trade timeframe’s bars with its Entry timeframe’s, so one file cannot check it`
  : `the Multi-Timeframe Trading Bot’s ${sig?.title ?? 'mark'}, which it computes through request.security on its Entry timeframe — 4-hour bars (Entry_TF "240") as the script ships — not on this file’s bars`);

/* The export's indicators, and — with `daily` ({ text, file, at }), for a
   weekly or monthly export — its bars against the engine's built from the
   daily export (compareBars). `interval` is read from the file's name
   unless given; `at` is when the export was saved; `market` dates a weekly
   or monthly export's stamps. */
export async function verify(text, { E = null, sets = {}, file = 'export', interval = undefined, daily = null, market = null, symbol = null, at = null } = {}) {
  E = E || await loadEngine();
  const T = interval === undefined ? intervalOf(file) : interval;
  const framed = T === '1W' || T === '1M';
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
  const map = mapColumns(header, plotTitlesOf(barsOf(E, cols)), { bot: E.SCAN_BOT_SIGNALS || [] });
  const vi = map.findIndex(m => m.kind === 'input' && m.title === 'Volume');
  if (vi >= 0) cols.volume = colAt(vi);
  const bad = cols.close.findIndex(v => v == null);
  if (bad >= 0) throw new Error(`${file}: row ${bad + 2} has no close`);
  const stampOf = (v) => { const t = Number(v); const ms = Number.isFinite(t) ? t * 1000 : Date.parse(v); return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : String(v); };
  const stamps = rows.map(r => stampOf(r[0]));
  /* A weekly or monthly file's bars are named by their periods. */
  const dated = framed ? datePeriods(E, T, rows.map(r => r[0]), { market, file, at }) : null;
  const labels = dated ? dated.keys.map((k, j) => k || stamps[j]) : stamps;

  /* A candidate computed on the file and on the file less its first bars
     (DROPS), and held against the run's columns. */
  const evaluate = (cand, list) => {
    const full = cand.plots(barsOf(E, cols));
    const dropped = DROPS.filter(k => k < n - 1).map(k => ({ k, plots: cand.plots(barsOf(E, cols, k)) }));
    const rowsOf = list.map(({ i, slot }) => {
      const [title, mine, first] = full[slot.plot];
      const runs = dropped.map(d => ({ k: d.k, series: d.plots[slot.plot][1], first: d.plots[slot.plot][2] }));
      /* The plot by its title, numbered where the script has several of it. */
      const same = full.filter(([t]) => t === title).length;
      const occ = full.slice(0, slot.plot + 1).filter(([t]) => t === title).length;
      return { column: map[i].column, title: map[i].title, kind: 'plot', indicator: slot.id, plot: same > 1 ? `${title} #${occ}` : title, params: cand.params,
               ...compareColumn(mine, first, runs, colAt(i), labels) };
    });
    const refuted = rowsOf.some(r => r.result === 'DIFFERS');
    const fits = !refuted && rowsOf.some(r => r.result === 'MATCH' && r.values > 0);
    return { cand, rows: rowsOf, status: refuted ? 'refuted' : fits ? 'fits' : 'open' };
  };
  const lblOf = (s) => (dated && /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? periodLabel(T, s) : s);
  const detailOf = (e) => {
    if (e.status === 'open') return `does not settle in the file’s ${n} bars`;
    if (e.status === 'fits') return `${e.rows.filter(r => r.result === 'MATCH').length} of ${e.rows.length} columns agree`;
    const r = e.rows.find(x => x.result === 'DIFFERS');
    return r.presenceMismatches ? `${r.title}: ${r.presenceMismatches} bar(s) blank on one side, first ${lblOf(r.firstPresenceMismatch.stamp)}`
      : `${r.title}: worst ${fmtNum(r.worst)} at ${lblOf(r.worstAt.stamp)}`;
  };
  const labelOf = (id) => E.SCAN_INDICATORS[id]?.label || TITLED[id]?.label || id;
  const out = new Array(map.length).fill(null);
  const instances = [];
  const nthOf = new Map();
  /* A run's rows from its verdict: the chosen candidate's comparisons, or,
     for a titled pair no candidate fits, NOT KNOWN. */
  const place = (list, v, nth, searched) => list.forEach(({ i }, k) => {
    const row = v.pick.rows[k];
    if (v.how === 'none') {
      out[i] = { column: row.column, title: row.title, kind: 'unknown', result: 'NOT KNOWN', filled: row.filled,
                 why: `taken to be ${labelOf(map[i].id).toLowerCase()} by its title, and its numbers fit none of the candidates (Read as, below)` };
      return;
    }
    out[i] = { ...row, instance: nth, ...(v.how === 'open' && searched && row.result === 'NOT SETTLED' ? { note: `${row.note}; nor do the numbers settle which settings (Read as, below)` } : {}) };
  });
  const instanceOf = (id, list, v, evals, nth, searched, extra = {}) => ({
    columns: [list[0].slot.column, list[list.length - 1].slot.column], indicator: id, label: labelOf(id), nth, searched, how: v.how,
    settings: v.pick.cand.label, from: v.pick.cand.from, alias: list.filter(x => x.slot.same).map(x => x.slot.title),
    candidates: evals.map(e => ({ settings: e.cand.label, from: e.cand.from, status: e.status, detail: detailOf(e) })), ...extra,
  });

  const runs = new Map();
  map.forEach((m, i) => { if (m.block != null) { if (!runs.has(m.block)) runs.set(m.block, []); runs.get(m.block).push(i); } });
  for (const idx of runs.values()) {
    /* An untitled run two indicators fit alike: the one whose numbers fit
       takes it; neither, or both, and it is NOT KNOWN. */
    if (map[idx[0]].kind === 'ambiguous') {
      const options = [];
      for (let f = 0; f < map[idx[0]].candidates.length; f++) {
        const list = idx.map(i => ({ i, slot: map[i].candidates[f] }));
        if (list.some(x => x.slot.kind !== 'plot')) continue;
        const id = list[0].slot.id;
        const evals = candidatesFor(E, id, { params, sets, search: true }).map(c => evaluate(c, list));
        options.push({ id, list, evals, v: decide(evals, { unsourced: !!TITLED[id] }) });
      }
      const fitting = options.filter(o => o.evals.some(e => e.status === 'fits'));
      const names = options.map(o => labelOf(o.id));
      if (fitting.length === 1) {
        const o = fitting[0];
        const nth = (nthOf.get(o.id) || 0) + 1;
        nthOf.set(o.id, nth);
        place(o.list, o.v, nth, true);
        instances.push(instanceOf(o.id, o.list, o.v, o.evals, nth, true, { tie: names }));
        continue;
      }
      const why = `its title and place fit ${names.join(' and ')} alike, and the numbers fit ${fitting.length ? 'more than one' : 'neither'}: `
        + options.map(o => `${labelOf(o.id)} (${o.evals.map(e => `${e.cand.label} ${e.status === 'fits' ? 'fits' : STATUS_WORDS[e.status]}`).join('; ')})`).join(', ');
      for (const i of idx) out[i] = { column: map[i].column, title: map[i].title, kind: 'unknown', result: 'NOT KNOWN', filled: colAt(i).filter(v => v != null).length, why, candidates: options.map(o => o.id) };
      instances.push({ columns: [map[idx[0]].column, map[idx[idx.length - 1]].column], indicator: null, label: `“${map[idx[0]].title}”${idx.length > 1 ? ` ×${idx.length}` : ''}`, nth: 1, searched: true, how: 'unknown', tie: names, why,
                       candidates: options.flatMap(o => o.evals.map(e => ({ indicator: o.id, settings: e.cand.label, from: e.cand.from, status: e.status, detail: detailOf(e) }))) });
      continue;
    }
    /* A column read as another plot of its indicator (MA PLOT_LT as MA
       PLOT_ST) only where the export shows the two equal on every bar. */
    for (const i of idx) {
      const m = map[i];
      if (!m.same || m.kind !== 'plot') continue;
      const j = idx.find(x => map[x].kind === 'plot' && map[x].title === m.same);
      const a = colAt(i), b = j == null ? null : colAt(j);
      if (!b || !a.every((v, k) => v === b[k])) {
        map[i] = { ...m, kind: 'none', why: `${m.why}; ${j == null ? `${m.same} is not in this export to hold it against` : `it differs from ${m.same} in this export, so it is not that average`}` };
      }
    }
    const list = idx.filter(i => map[i].kind === 'plot').map(i => ({ i, slot: map[i] }));
    if (!list.length) continue;
    const id = list[0].slot.id;
    const nth = (nthOf.get(id) || 0) + 1;
    nthOf.set(id, nth);
    /* The daily chart's settings are the daily export's first copy of an
       indicator; anywhere else they are tried with the others. */
    const searched = framed || nth > 1 || !!TITLED[id];
    const evals = candidatesFor(E, id, { params, sets, search: searched }).map(c => evaluate(c, list));
    const v = decide(evals, { unsourced: !!TITLED[id] });
    place(list, v, nth, searched);
    instances.push(instanceOf(id, list, v, evals, nth, searched));
  }
  map.forEach((m, i) => {
    if (out[i]) return;
    const row = { column: m.column, title: m.title, kind: m.kind };
    if (m.kind === 'input') { out[i] = { ...row, result: 'INPUT' }; return; }
    const theirs = colAt(i);
    const filled = theirs.filter(v => v != null).length;
    if (m.kind === 'none') { out[i] = { ...row, result: 'NOT COMPARED', why: m.why, filled }; return; }
    if (m.kind === 'bot') {
      const sig = (E.SCAN_BOT_SIGNALS || []).find(s => s.id === m.signal);
      out[i] = { ...row, result: 'BOT PLOT', signal: m.signal, alert: sig?.title ?? m.title, marks: theirs.filter(v => v != null && v !== 0).length, filled, why: botWhy(sig) };
      return;
    }
    out[i] = { ...row, kind: 'unknown', result: 'NOT KNOWN', filled, why: 'no script this tool computes draws a column of that title here' };
  });
  const count = (k) => out.filter(r => r.result === k).length;
  return { file, interval: T, bars: n, first: stamps[0], last: stamps[n - 1], sets, rows: out,
           summary: { match: count('MATCH'), differs: count('DIFFERS'), notSettled: count('NOT SETTLED'), notCompared: count('NOT COMPARED'), notKnown: count('NOT KNOWN'), botPlots: count('BOT PLOT'), inputs: count('INPUT') },
           instances, dated, periods: bars };
}

const fmtNum = (v) => (v == null ? '—' : v === 0 ? '0' : Math.abs(v) >= 0.01 && Math.abs(v) < 1e6 ? String(Number(v.toPrecision(4))) : v.toExponential(1));
/* An instance of an indicator in words: the settings its numbers take, and
   how the candidates fared. */
function instanceText(x) {
  const others = (skip) => x.candidates.filter(c => c.settings !== skip).map(c => `; ${c.settings} (${c.from}) ${STATUS_WORDS[c.status]}${c.status === 'refuted' ? ` — ${c.detail}` : ''}`).join('');
  const refuted = () => x.candidates.filter(c => c.status === 'refuted').map(c => `; ${c.settings} (${c.from}) DIFFERS — ${c.detail}`).join('');
  const tie = x.tie ? `its titles and place fit ${x.tie.join(' and ')} alike, and the numbers are ${x.label}’s: ` : '';
  const text = (() => {
    switch (x.how) {
      case 'chart': return `${tie}${x.settings} (${x.from})${others(x.settings)}`;
      case 'found': return `${tie}${x.settings} — found from the numbers: ${x.from}${others(x.settings)}`;
      case 'alike': return `${tie}the numbers fit ${x.candidates.filter(c => c.status === 'fits').map(c => `${c.settings} (${c.from})`).join(' and ')} alike${refuted()}`;
      case 'open': {
        const open = x.candidates.filter(c => c.status === 'open'), many = open.length > 1;
        return `${tie}NOT SETTLED — ${open.map(c => `${c.settings} (${c.from})`).join(' or ')}: nothing in the file refutes ${many ? 'them' : 'it'}, and ${many ? 'they do' : 'it does'} not settle in it${refuted()}`;
      }
      case 'differs': return `${tie}every setting tried DIFFERS — ${x.candidates.map(c => `${c.settings} (${c.from}): ${c.detail}`).join('; ')}; the columns above are ${x.candidates[0].from}`;
      case 'none': return `NOT KNOWN — its numbers fit none of ${x.candidates.map(c => `${c.settings} (${c.detail})`).join('; ')}`;
      default: return `NOT KNOWN — ${x.why}`;
    }
  })();
  return `${text}${x.alias?.length ? `; ${x.alias.join(', ')} equals MA PLOT_ST on every bar, and is read as it` : ''}`;
}
export function table(rep) {
  const L = [];
  const tf = { '1D': 'daily', '1W': 'weekly', '1M': 'monthly' }[rep.interval];
  const noun = PERIOD_NOUN[rep.interval];
  const lbl = (s) => (rep.dated && s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? periodLabel(rep.interval, s) : s);
  L.push(`TradingView export  ${rep.file} — ${rep.bars} ${tf ? `${tf} bars` : rep.interval ? `bars of ${rep.interval}` : 'bars'}, stamped ${rep.first} … ${rep.last} (UTC)`);
  if (rep.dated) {
    const d = rep.dated;
    L.push(`Periods             ${lbl(d.first)} … ${lbl(d.last)}, dated by the ${d.marketLabel} session (${d.market}): ${d.dating}`
      + (d.lastStatus === 'PROVISIONAL' ? `; the last ${noun} was still trading when the file was saved (${d.at}): its last session is ${d.lastSession}` : ''));
    L.push(`Settings            tried, not assumed: each indicator with your daily chart's (SCAN_PINE_INDICATORS) and its script's own defaults, and the numbers decide (Read as, below)${Object.keys(rep.sets).length ? `; --set ${Object.entries(rep.sets).map(([id, o]) => Object.entries(o).map(([k, v]) => `${id}.${k}=${v}`).join(' ')).join(' ')}` : ''}`);
  } else {
    L.push(`Settings            the reader's chart, as SCAN_PINE_INDICATORS holds it${Object.keys(rep.sets).length ? `, with ${Object.entries(rep.sets).map(([id, o]) => Object.entries(o).map(([k, v]) => `${id}.${k}=${v}`).join(' ')).join(' ')}` : ''}`);
  }
  L.push(`Match               within ${REL_TOL} of the column's largest magnitude, blanks where TradingView has blanks, on every bar from the one where the column settles`);
  L.push('');
  L.push(`${'col'.padStart(3)}  ${'column'.padEnd(26)} ${'read as'.padEnd(30)} ${'settled'.padStart(7)} ${'compared'.padStart(8)}  ${'worst |diff|'.padEnd(12)} result`);
  for (const r of rep.rows) {
    if (r.kind === 'input') continue;
    const readAs = r.kind === 'plot' ? `${r.indicator}${r.instance > 1 ? ` (${r.instance})` : ''} · ${r.plot}` : r.kind === 'bot' ? `bot · ${r.signal}` : '—';
    const settled = r.settledFrom == null ? '—' : `bar ${r.settledFrom}`;
    const compared = r.kind === 'plot' ? String(r.compared ?? 0) : '';
    const worst = r.kind !== 'plot' ? '' : r.result === 'NOT SETTLED' ? (r.worst == null ? '—' : `(${fmtNum(r.worst)})`) : fmtNum(r.worst);
    let line = `${String(r.column).padStart(3)}  ${r.title.slice(0, 26).padEnd(26)} ${readAs.slice(0, 30).padEnd(30)} ${settled.padStart(7)} ${compared.padStart(8)}  ${worst.padEnd(12)} ${r.result}`;
    if (r.result === 'DIFFERS') line += r.presenceMismatches ? ` — ${r.presenceMismatches} bar(s) where one side is blank, first bar ${r.firstPresenceMismatch.bar} (${lbl(r.firstPresenceMismatch.stamp)}): computed ${fmtNum(r.firstPresenceMismatch.mine)}, TradingView ${fmtNum(r.firstPresenceMismatch.theirs)}`
      : ` — worst at bar ${r.worstAt.bar} (${lbl(r.worstAt.stamp)}): computed ${fmtNum(r.worstAt.mine)}, TradingView ${fmtNum(r.worstAt.theirs)}`;
    if (r.result === 'MATCH' && !r.values) line += ' — blank on every bar, as on the chart';
    if (r.result === 'NOT SETTLED') line += ` — ${r.note}`;
    if (r.result === 'NOT COMPARED' || r.result === 'NOT KNOWN') line += ` — ${r.why}${r.filled ? '' : ' (empty in this export)'}`;
    if (r.result === 'BOT PLOT') line += ` — ${r.why}; ${r.filled ? `marked on ${r.marks} of ${rep.bars} bars` : 'empty in this export'}`;
    L.push(line);
  }
  const shown = (rep.instances || []).filter(x => x.searched);
  if (shown.length) {
    L.push('');
    L.push('Read as             each run of columns, by its titles and their order, and the settings its numbers take');
    for (const x of shown) {
      const cols = x.columns[0] === x.columns[1] ? `col ${x.columns[0]}` : `cols ${x.columns[0]}–${x.columns[1]}`;
      L.push(`  ${cols.padEnd(12)} ${`${x.label}${x.nth > 1 ? ` (${x.nth})` : ''}`.padEnd(22)} ${instanceText(x)}`);
    }
  }
  const s = rep.summary;
  L.push('');
  L.push(`${s.match} MATCH, ${s.differs} DIFFERS, ${s.notSettled} NOT SETTLED, ${s.notCompared} NOT COMPARED, ${s.notKnown} NOT KNOWN, ${s.botPlots} BOT PLOT (and ${s.inputs} columns of bars)`);
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
    console.error('usage: node scanner/tv-verify.mjs --csv "<TradingView export>" [--daily "<the daily export of the same symbol>"] [--interval 1D|1W|1M] [--market CODE] [--captured-at ISO] [--set id.param=value ...] [--json]');
    return 2;
  }
  /* A flag typed without its value is refused, as bot-verify and the
     worker refuse one: --captured-at, --market and a last --set with
     nothing after them were read as absent, and the file was verified with
     its modification time, the registry's market and the chart's settings —
     exit 0, and nothing said the flag had not been applied. */
  for (const k of ['market', 'captured-at']) {
    if (args.includes(`--${k}`) && !val(k)) { console.error(`tv-verify: --${k} needs a value`); return 2; }
  }
  const sets = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--set') continue;
    if (!args[i + 1] || args[i + 1].startsWith('--')) { console.error('tv-verify: --set needs a value (id.param=value)'); return 2; }
    sets.push(args[++i]);
  }
  /* The interval: the file name's, as the import reads it, or --interval
     for a file not named as TradingView names one. */
  const intervalFlag = val('interval');
  if (args.includes('--interval') && !exportTimeframe(intervalFlag)) { console.error(`tv-verify: --interval "${intervalFlag ?? ''}" is not 1D, 1W or 1M`); return 2; }
  const T = intervalFlag ? exportTimeframe(intervalFlag) : intervalOf(csv);
  let E, text;
  try { E = await loadEngine(); } catch (e) { console.error(`Could not load the scan engine out of index.html: ${e.message}`); return 2; }
  try { text = await readFile(csv, 'utf8'); } catch (e) { console.error(`Could not read ${csv}: ${e.message}`); return 2; }
  /* A weekly or monthly export is dated in its instrument's market, and
     --daily's daily export too. The names say the interval and the symbol;
     a file saved at an instant is marked by it, as the import marks it (its
     modification time, unless --captured-at says otherwise). */
  const dailyPath = val('daily');
  let daily = null, market = null, symbol = null, at = null;
  if (args.includes('--daily') && !dailyPath) { console.error('tv-verify: --daily needs the daily export\'s path'); return 2; }
  const captured = val('captured-at');
  if (captured && !Number.isFinite(Date.parse(captured))) { console.error(`tv-verify: --captured-at "${captured}" is not a date-time`); return 2; }
  const mtime = async (f) => (await stat(f)).mtime.toISOString();
  if (dailyPath) {
    const dT = intervalOf(dailyPath);
    if (T !== '1W' && T !== '1M') { console.error(`tv-verify: --daily builds weekly and monthly bars, and ${basename(csv)} is ${T ? `a ${T} export` : 'not named as TradingView names an export ("<EXCHANGE>_<SYMBOL>, 1W.csv")'}`); return 2; }
    if (dT && dT !== '1D') { console.error(`tv-verify: --daily ${basename(dailyPath)} is a ${dT} export — give the daily one (1D)`); return 2; }
    const a = tradingViewName(csv), b = tradingViewName(dailyPath);
    if (a && b && (a.symbol !== b.symbol || a.exchange !== b.exchange)) { console.error(`tv-verify: --csv is ${a.exchange}:${a.symbol} and --daily is ${b.exchange}:${b.symbol} — export the same symbol twice`); return 2; }
    symbol = a?.symbol || b?.symbol || 'X';
    market = val('market') || marketOf(symbol, await loadInstruments());
    let dailyText;
    try { dailyText = await readFile(dailyPath, 'utf8'); } catch (e) { console.error(`Could not read ${dailyPath}: ${e.message}`); return 2; }
    at = captured ? new Date(Date.parse(captured)).toISOString() : await mtime(csv);
    daily = { text: dailyText, file: basename(dailyPath), at: captured ? at : await mtime(dailyPath) };
  } else if (T === '1W' || T === '1M') {
    symbol = tradingViewName(csv)?.symbol || null;
    market = val('market') || (symbol ? marketOf(symbol, await loadInstruments()) : null);
    at = captured ? new Date(Date.parse(captured)).toISOString() : await mtime(csv);
  }
  let rep;
  try { rep = await verify(text, { E, sets: parseSets(sets, E), file: basename(csv), interval: T, daily, market, symbol, at }); } catch (e) { console.error(`tv-verify: ${e.message}`); return 2; }
  console.log(args.includes('--json') ? JSON.stringify(rep, null, 2) : table(rep));
  return rep.summary.differs || rep.periods?.summary.differs ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv);
