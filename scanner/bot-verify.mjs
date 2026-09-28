#!/usr/bin/env node
/**
 * scanner/bot-verify.mjs — the scanner's Multi-Timeframe Trading Bot against the
 * bot's own marks on the reader's TradingView charts.
 *
 *   node scanner/bot-verify.mjs --daily "watchlist-shots/OANDA_XAUUSD, 1D.csv" \
 *       --weekly "watchlist-shots/OANDA_XAUUSD, 1W.csv" --monthly "watchlist-shots/OANDA_XAUUSD, 1M.csv"
 *   ... [--market FX] [--symbol XAUUSD] [--captured-at ISO] [--criterion3 ema|sma] [--macd-signal ema|sma] [--json]
 *
 * WHY. The scanner writes the reader's Pine script as setups (the engine's
 * scanBotPack), and scanner-test proves those setups equal, bar for bar, to a
 * transcription of the script's logic. That proves the setups say what the
 * script says; it does not prove they say it about the same bars TradingView
 * reads. The reader's charts carry the bot's own marks — "Strong Buy -
 * Continuous" is a column of the weekly and monthly exports, "Entry TF Buy" of
 * the daily one — and each chart's own WaveTrend, MACD and MCDX, so the charts
 * themselves are the test: this imports the exports into a temporary history
 * exactly as the reader imports them, runs the pack on it, and holds each
 * mark, and each criterion, against the pack's reading of the same bar.
 *
 * THE HISTORY. The exports are imported by ingest/history-import.mjs — the
 * store's own merge, its validation, its dating of each stamp by the session
 * it opens, its provisional rule — into a folder made for the run (mkdtemp)
 * and removed after it. Nothing is written anywhere else: the reader's
 * data/price-history.json is never read or written, and the exports are read
 * where they lie.
 *
 * THE MARKS. The pack is scanBotPack with the reader's decisions (weekly and
 * monthly trade timeframes, criterion 3 on the EMA(200), the MACD's EMA
 * signal; --criterion3 and --macd-signal change them). A weekly chart's mark
 * for a week is held against the weekly setup of the same alert evaluated at
 * the LAST DAILY SESSION held in that week — the close on which the scanner's
 * weekly criteria read that week, and the daily bar its entry criteria read —
 * and a monthly chart's against the monthly setup at the month's last daily
 * session. The daily chart's Entry TF marks are held against the daily entry
 * setups on each session. THE ASSUMPTION, stated because the numbers may
 * refute it: each chart's bot reads Entry TF = D (the daily bars) and Trade
 * TF = the chart's own timeframe (weekly on the weekly chart, monthly on the
 * monthly one; on a daily chart, weekly — the script's default); every other
 * setting is the script's default.
 *
 * THE CRITERIA. Each export carries the chart's own WaveTrend, MACD and MCDX
 * — TradingView's numbers on its full history — from which criteria 1 (WT1
 * above its 4-bar average, the script's wt2), 2 (the MACD line above its EMA
 * of 9, the bot's signal, computed here on the exported line), 4 (the banker
 * above 5), 5 (the hot money below 10) and the histogram's direction follow
 * without the engine. They are held against the pack's own criteria on every
 * bar both can read: the daily ones on each session, the weekly and monthly
 * ones on each of the export's periods, as the pack reads them (the imported
 * bars where the history holds them). Criterion 3's EMA(200) is not drawn on
 * the reader's charts and cannot be checked this way.
 *
 * SETTLED, as tv-verify decides it for a column: a value the pack computes is
 * settled on a bar when the same computation on the bars with their first 1,
 * 2, 3, 5, 8, 13, 21 and 34 left out agrees with it there (to a millionth of
 * the indicator's largest magnitude), wherever it has a value. Before that,
 * the file is too short for the indicator's memory — an EMA's seed, Wilder's
 * RSI, WaveTrend's three averages — and TradingView, reading many more bars,
 * may differ: that is warm-up. A criterion that differs from the chart's own
 * column where the pack's value HAS settled is UNEXPLAINED.
 *
 * WHY A MARK DISAGREES. Every disagreement is given its reason, or called
 * UNEXPLAINED:
 *   provisional       the period was still trading when an export was saved
 *                     (TradingView's mark is the bar so far), or the pack's
 *                     daily bar was captured before its session closed
 *   not held          the daily bars do not hold what the reading needs: the
 *                     period's last expected session is missing (a holiday
 *                     the weekday calendar expects), so on its last held
 *                     session the pack still reads the period before; a
 *                     stale or gapped series
 *   warm-up           the pack cannot read a criterion yet (which one, on
 *                     which timeframe, the bars it needs and holds); or it
 *                     reads one that has not settled and differs from the
 *                     chart's own column, which in its place gives the mark;
 *                     or criterion 3, which no chart draws, is one the
 *                     file's start decides — with its first bars left out it
 *                     reads the other way, which gives the mark (an average
 *                     merely unsettled is not enough: an EMA of 200 on a few
 *                     hundred bars never settles, and would excuse anything)
 *   entry timeframe   the chart's entry reading is not the pack's daily one.
 *                     The daily chart's own Entry TF Buy and Sell marks, in
 *                     place of the pack's daily entry, give the mark; on the
 *                     daily chart itself, its own daily columns deny the
 *                     mark, or its criteria are the pack's, and other marks
 *                     show its Entry TF is not D (THE CHARTS' SETTINGS). The
 *                     script ships with Entry TF "240", 4-hour bars, which
 *                     daily bars cannot reproduce
 *   trade timeframe   other marks of the chart show, by its own columns,
 *                     that they are not computed on the chart's own bars
 *                     (THE CHARTS' SETTINGS), and this period's own columns
 *                     read as the pack does
 *   gaps_on           a daily chart's trade-timeframe marks: the script reads
 *                     its weekly criteria with gaps_on, so on a daily chart
 *                     they hold a value only on the session that closes the
 *                     week (false on every other, which the script's `not`
 *                     turns true), and its histogram test compares with the
 *                     session before, which holds none — README-bot decision
 *                     3; the owner chose the last closed week instead
 *   UNEXPLAINED       none of these: a fault of the engine, the merge or the
 *                     assumption, to be found and fixed, never absorbed
 * A period of an export that no daily session of the daily export falls in is
 * NOT COMPARED — the entry criteria read daily bars — and counted.
 *
 * WITH THE CHART'S OWN ENTRY READINGS. The daily chart's Entry TF Buy and
 * Sell marks are the bot's entry readings on each session, taken the way the
 * chart's bot takes them. Given in place of the pack's daily entry, they
 * leave the trade timeframe alone under test: a weekly or monthly chart's
 * marks against the pack's weekly or monthly criteria on every period the
 * daily export covers, the daily warm-up aside.
 *
 * THE CHARTS' SETTINGS. A mark drawn where the chart's own columns deny a
 * criterion it needs, or not drawn where they hold every criterion that
 * makes it certain (a tier 2 buy wherever criteria 1, 2 and 4 hold, whatever
 * criterion 3 reads; a STRONG BUY where the histogram rose too and the
 * chart's own entry reading is a buy), was not computed on those bars: on
 * the daily chart, its Entry TF is not D; on a weekly or monthly chart, its
 * Trade TF is not the chart's own. The period still trading when a file was
 * saved is no evidence, and a mark is never its own: a disagreement is put
 * down to a setting only where other marks show it, so one mark that
 * disagrees with everything is UNEXPLAINED. A monthly chart whose Trade TF
 * is not M is read once more as the script's default, W: each month on the
 * last week closed by its last session, its histogram against the one the
 * month before read.
 *
 * Exit status: 0 when every disagreement has its reason, 1 when one — of a
 * mark or of a criterion — is UNEXPLAINED, 2 when a file cannot be read or
 * imported, the files are not one symbol, or no export carries a bot mark.
 *
 * The exports are the reader's licensed data: this reads them where they lie
 * and writes only its temporary folder. No check in CI depends on any export;
 * scanner-test drives this tool with files it builds itself.
 */

import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadEngine, ROOT } from './scan.mjs';
import { CHART, csvLine, mapColumns, paramsFor, barsOf, datePeriods, datingRule } from './tv-verify.mjs';
import { tradingViewName, exportTimeframe } from '../ingest/history-import.mjs';
import { loadHistory, loadInstruments, marketOf, parseDateCell } from '../ingest/history-store.mjs';

const run = promisify(execFile);
const NOUN = { '1D': 'session', '1W': 'week', '1M': 'month' };
const WORD = { '1D': 'daily', '1W': 'weekly', '1M': 'monthly' };
const LETTER = { '1D': 'd', '1W': 'w', '1M': 'm' };
export const REASONS = ['provisional', 'not held', 'warm-up', 'entry timeframe', 'trade timeframe', 'gaps_on', 'UNEXPLAINED'];
/* The chart's own criterion 2 is read from the bar where its MACD's EMA of
   9 — computed here on the exported line, seeded on the file's first nine
   values — has forgotten that seed: 50 bars on, 0.8^50 of it is left. */
export const OWN_SETTLE = 50;
/* tv-verify's: the bars left out to see whether a start still shows, and
   the tolerance, of the indicator's largest magnitude. */
export const DROPS = [1, 2, 3, 5, 8, 13, 21, 34];
export const REL_TOL = 1e-6;

/* ------------------------------------------------------------ three-valued -- */
/* The engine's states as Kleene's values: 1 met, 0 not met, null unknown. */
export const k3 = (s) => (s === 'MET' ? 1 : s === 'NOT_MET' ? 0 : null);
export const and3 = (...x) => (x.some(v => v === 0) ? 0 : x.every(v => v === 1) ? 1 : null);
export const or3 = (...x) => (x.some(v => v === 1) ? 1 : x.every(v => v === 0) ? 0 : null);

/* THE SCRIPT'S LOGIC over the criteria's readings (README-bot): `t` the
   trade timeframe's (c1y … c4y each criterion holding, c1n … c4n its
   complement, hu/hd/hm the histogram rising, falling, moved), `d` the
   daily entry's (c1y … c4n and c5y), `EB`/`ES` the entry buy and sell when
   they are given rather than read (the chart's own entry readings). The
   pack is these same conditions in rule trees; this is the transcription
   the comparison substitutes into, and every compared bar checks the two
   agree. */
export function botSignal(id, { t = {}, d = {}, EB, ES } = {}) {
  const T1B = and3(t.c1y, t.c2y, t.c3n, t.c4n), T2B = and3(t.c1y, t.c2y, or3(t.c3y, t.c4y));
  const T1S = and3(t.c1n, t.c2n, or3(t.c3y, t.c4y)), T2S = and3(t.c1n, t.c2n, t.c3n, t.c4n);
  const eb = EB !== undefined ? EB : and3(d.c1y, d.c2y, d.c3y, d.c4y);
  const es = ES !== undefined ? ES : and3(d.c1n, d.c2n, d.c3n, d.c4n, d.c5y);
  switch (id) {
    case 'tier1-buy': return T1B;
    case 'tier2-buy': return T2B;
    case 'tier1-sell': return T1S;
    case 'tier2-sell': return T2S;
    case 'entry-buy': return eb;
    case 'entry-sell': return es;
    case 'entry-trade': return or3(eb, es);
    case 'strong-buy-continuous': return and3(T2B, eb, t.hu);
    case 'strong-buy-reversal': return and3(T2B, eb, t.hd);
    case 'strong-sell-continuous': return and3(T2S, es, t.hd);
    case 'strong-sell-reversal': return and3(T2S, es, t.hu);
    case 'weak-buy': return and3(T1B, eb);
    case 'weak-sell': return and3(T1S, es);
    case 'any-strong': return or3(and3(T2B, eb, t.hm), and3(T2S, es, t.hm));
    case 'any-weak': return or3(and3(T1B, eb), and3(T1S, es));
    default: return null;
  }
}
/* Whether a signal reads the entry timeframe: every one but the four tiers. */
const readsEntry = (id) => !/^tier/.test(id);
/* A criterion's readings as the transcription takes them, set to a value:
   the criterion and its complement together, and the histogram's "moved"
   with its rising and falling. */
const CRIT_KEYS = { c1: ['c1y', 'c1n'], c2: ['c2y', 'c2n'], c3: ['c3y', 'c3n'], c4: ['c4y', 'c4n'], c5: ['c5y'], hu: ['hu'], hd: ['hd'] };
function setCrit(v, key, val) {
  const out = { ...v };
  const [y, n] = CRIT_KEYS[key];
  out[y] = val;
  if (n) out[n] = val == null ? null : 1 - val;
  if ((key === 'hu' || key === 'hd') && out.hu != null && out.hd != null) out.hm = out.hu || out.hd ? 1 : 0;
  return out;
}

/* ---------------------------------------------------------------- the files -- */
/* The import, as the reader runs it: each export through
   ingest/history-import.mjs into one history in a folder made for this run,
   daily first. The folder is removed whatever happens; the history is read
   back before it is. An import that refuses rows (exit 2) still wrote the
   rest, and says which; one that fails (exit 1) stops the comparison. */
export async function importExports(files, { symbol, market = null, capturedAt = null } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'qt-bot-verify-'));
  const out = join(dir, 'price-history.json');
  const log = [];
  try {
    for (const f of files) {
      const args = [join(ROOT, 'ingest/history-import.mjs'), '--in', f.path, '--out', out, '--symbol', symbol, '--interval', f.interval,
        ...(market ? ['--market', market] : []), ...(capturedAt ? ['--captured-at', capturedAt] : [])];
      let r;
      try { r = await run(process.execPath, args, { maxBuffer: 1 << 24 }); }
      catch (e) {
        if (e.code !== 2) throw new Error(`ingest/history-import.mjs could not import ${basename(f.path)}: ${`${e.stdout || ''}${e.stderr || ''}`.trim() || e.message}`);
        r = e;
      }
      const lines = String(r.stdout || '').split(/\r?\n/);
      log.push({ file: basename(f.path), interval: f.interval, exit: r.code || 0, summary: (lines[0] || '').replace(/\s+/g, ' ').trim() });
    }
    return { hist: await loadHistory(out), log, dir };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* An export as this tool reads it: its rows dated as the import files them
   (a daily row by the session its stamp opens; a weekly or monthly one by
   its period, tv-verify's datePeriods), the bot's marks (tv-verify's
   mapColumns, matched on SCAN_BOT_SIGNALS' titles), and the chart's own
   WaveTrend WT1, MACD line, MCDX banker and hot money where it draws them. */
export function readExport(E, text, { file = 'export', interval, market = null, at = null } = {}) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error(`${file} holds no bars`);
  const header = csvLine(lines[0]);
  const rows = lines.slice(1).map(csvLine);
  const num = (v) => (v == null || String(v).trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const colAt = (c) => rows.map(r => num(r[c - 1]));
  const ohlc = { open: colAt(2), high: colAt(3), low: colAt(4), close: colAt(5), volume: null };
  if (ohlc.close.some(v => v == null)) throw new Error(`${file}: row ${ohlc.close.findIndex(v => v == null) + 2} has no close`);
  const ids = CHART.filter(c => c.id).map(c => c.id);
  const b = barsOf(E, ohlc);
  const titles = Object.fromEntries(ids.map(id => [id, E.SCAN_INDICATORS[id].pine(b, paramsFor(E, id, {})).plots.map(([t]) => t)]));
  const map = mapColumns(header, titles, { bot: E.SCAN_BOT_SIGNALS || [] });
  const bot = map.filter(m => m.kind === 'bot').map(m => ({ column: m.column, title: m.title, signal: m.signal, values: colAt(m.column) }));
  const first = (id, title) => { const m = map.find(x => x.kind === 'plot' && x.id === id && x.title === title); return m ? { column: m.column, values: colAt(m.column) } : null; };
  const own = { wt1: first('wavetrend', 'WT Average-WT1'), macd: first('cm_macd', 'MACD'), banker: first('mcdx', 'Banker'), hot: first('mcdx', 'Hot Money') };
  const M = E.scanMarket(market);
  let keys, lastStatus = null, lastSession = null;
  if (interval === '1D') {
    keys = rows.map(r => parseDateCell(r[0], { tz: M.tz, session: M }).date || null);
    const seen = new Set();
    for (const k of keys) { if (k && seen.has(k)) throw new Error(`${file}: two rows are dated ${k} — is it a daily export?`); if (k) seen.add(k); }
    lastSession = keys.filter(Boolean).pop() || null;
    lastStatus = lastSession && at ? E.scanBarStatus(market, lastSession, at) : null;
  } else {
    const dated = datePeriods(E, interval, rows.map(r => r[0]), { market, file, at });
    keys = dated.keys;
    lastStatus = dated.lastStatus;
    lastSession = dated.lastSession;
  }
  const held = keys.filter(Boolean);
  return { file, interval, at, bars: rows.length, keys, first: held[0] || null, last: held[held.length - 1] || null, lastStatus, lastSession,
           bot, own, dating: datingRule(M), market: M.code, marketLabel: M.label };
}

/* The chart's own criteria on each of its bars (THE CRITERIA): from its
   WaveTrend WT1 (criterion 1: WT1 above its SMA of 4, the script's wt2), its
   MACD line (criterion 2: above its EMA of 9, the bot's signal; the
   histogram their difference, rising or falling on the bar before), its
   MCDX banker (criterion 4: above 5) and hot money (criterion 5: below 10).
   Null where a column is absent or blank, and before the EMA of 9 has
   settled (OWN_SETTLE bars after its seed). */
export function ownCriteria(E, x) {
  const n = x.bars;
  const nil = () => new Array(n).fill(null);
  const wt1 = x.own.wt1?.values || nil(), macd = x.own.macd?.values || nil(), banker = x.own.banker?.values || nil(), hot = x.own.hot?.values || nil();
  const wt2 = E.scanSma(wt1, 4), sig = E.scanEma(macd, 9);
  const seed = sig.findIndex(v => v != null);
  const settled = seed < 0 ? n : seed + OWN_SETTLE;
  const hist = macd.map((v, j) => (v == null || sig[j] == null ? null : v - sig[j]));
  const cmp = (a, b, f) => (a == null || b == null ? null : f(a, b) ? 1 : 0);
  return Array.from({ length: n }, (_, j) => ({
    c1: cmp(wt1[j], wt2[j], (p, q) => p > q), wt1: wt1[j], wt2: wt2[j],
    c2: j >= settled ? cmp(macd[j], sig[j], (p, q) => p > q) : null, macd: macd[j], signal: j >= settled ? sig[j] : null,
    hu: j > settled ? cmp(hist[j], hist[j - 1], (p, q) => p > q) : null, hd: j > settled ? cmp(hist[j], hist[j - 1], (p, q) => p < q) : null,
    hist: j >= settled ? hist[j] : null, prev: j > settled ? hist[j - 1] : null,
    c4: cmp(banker[j], 5, (p, q) => p > q), banker: banker[j], c5: cmp(hot[j], 10, (p, q) => p < q), hot: hot[j],
  }));
}
/* What a mark requires of the chart's own columns — criterion 3 aside, which
   no chart of the reader's draws: [criterion, value it must have]. */
const NEEDS = {
  'entry-buy': [['c1', 1], ['c2', 1], ['c4', 1]], 'entry-sell': [['c1', 0], ['c2', 0], ['c4', 0], ['c5', 1]],
  'tier1-buy': [['c1', 1], ['c2', 1], ['c4', 0]], 'tier2-buy': [['c1', 1], ['c2', 1]], 'tier1-sell': [['c1', 0], ['c2', 0]], 'tier2-sell': [['c1', 0], ['c2', 0], ['c4', 0]],
  'strong-buy-continuous': [['c1', 1], ['c2', 1], ['hu', 1]], 'strong-buy-reversal': [['c1', 1], ['c2', 1], ['hd', 1]],
  'strong-sell-continuous': [['c1', 0], ['c2', 0], ['c4', 0], ['hd', 1]], 'strong-sell-reversal': [['c1', 0], ['c2', 0], ['c4', 0], ['hu', 1]],
  'weak-buy': [['c1', 1], ['c2', 1], ['c4', 0]], 'weak-sell': [['c1', 0], ['c2', 0]],
};
const fmt = (v) => (v == null ? '—' : Math.abs(v) >= 1000 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v === 0 ? '0' : v.toPrecision(3));
const OWN_WORDS = {
  c1: (o) => `WT1 ${fmt(o.wt1)} ${o.c1 ? 'above' : 'not above'} its 4-bar average ${fmt(o.wt2)}`,
  c2: (o) => `MACD ${fmt(o.macd)} ${o.c2 ? 'above' : 'not above'} its EMA 9 ${fmt(o.signal)}`,
  c4: (o) => `banker ${fmt(o.banker)} ${o.c4 ? 'above' : 'not above'} 5`,
  c5: (o) => `hot money ${fmt(o.hot)} ${o.c5 ? 'below' : 'not below'} 10`,
  hu: (o) => `histogram ${fmt(o.hist)} ${o.hu ? 'above' : 'not above'} the bar before's ${fmt(o.prev)}`,
  hd: (o) => `histogram ${fmt(o.hist)} ${o.hd ? 'below' : 'not below'} the bar before's ${fmt(o.prev)}`,
};
/* What the chart's own columns make certain, criterion 3 aside: where each
   of these holds, the mark must be drawn — a tier 2 buy wherever criteria
   1, 2 and 4 hold (3 or 4 is then true, whatever 3 reads), and a signal that
   reads the entry where the chart's own entry reading (its daily chart's
   Entry TF mark on the period's last session, EB or ES) holds too. A signal
   whose certainty needs criterion 3 has none here. */
const SUFFICES = {
  'tier2-buy': [['c1', 1], ['c2', 1], ['c4', 1]], 'tier1-sell': [['c1', 0], ['c2', 0], ['c4', 1]],
  'strong-buy-continuous': [['c1', 1], ['c2', 1], ['c4', 1], ['hu', 1], ['EB', 1]], 'strong-buy-reversal': [['c1', 1], ['c2', 1], ['c4', 1], ['hd', 1], ['EB', 1]],
  'weak-sell': [['c1', 0], ['c2', 0], ['c4', 1], ['ES', 1]], 'any-strong': [['c1', 1], ['c2', 1], ['c4', 1], ['hm', 1], ['EB', 1]],
  'any-weak': [['c1', 0], ['c2', 0], ['c4', 1], ['ES', 1]],
};
/* The criteria a mark needs that the chart's own columns deny, in words;
   empty when none is denied. */
export function ownContradicts(signal, o) {
  return (NEEDS[signal] || []).filter(([k, want]) => o?.[k] != null && o[k] !== want).map(([k]) => OWN_WORDS[k](o));
}
/* The criteria that make a mark certain, in words, when every one holds on
   the chart's own columns (and entry reading, `e`); else null. */
export function ownRequires(signal, o, e = null) {
  const rule = SUFFICES[signal];
  if (!rule || !o) return null;
  const val = (k) => (k === 'EB' ? e?.buy ?? null : k === 'ES' ? e?.sell ?? null : k === 'hm' ? (o.hu == null || o.hd == null ? null : o.hu || o.hd ? 1 : 0) : o[k]);
  if (!rule.every(([k, want]) => val(k) === want)) return null;
  return rule.map(([k]) => (k === 'EB' ? 'its Entry TF Buy' : k === 'ES' ? 'its Entry TF Sell' : k === 'hm' ? `histogram ${fmt(o.hist)} moved from the bar before's ${fmt(o.prev)}` : OWN_WORDS[k](o)));
}
/* Every mark of an export against its own columns, both ways: how many
   could be read, those the columns deny (drawn where a criterion it needs
   does not hold), and those they require (not drawn where every criterion
   that makes it certain holds). Either says the chart's bot does not read
   the bars those columns are computed on: on the daily chart, its entry
   marks (Entry TF is not D); on a weekly or monthly chart, its trade marks
   (Trade TF is not the chart's own). `entryOf(j)` is the chart's entry
   reading for row j, where the daily chart gives it. */
export function settingsEvidence(x, own, { entryOf = () => null } = {}) {
  let marks = 0;
  const denied = [];
  for (const c of x.bot) {
    if (!NEEDS[c.signal] || (x.interval === '1D') !== /^entry-/.test(c.signal)) continue;
    c.values.forEach((v, j) => {
      /* The period still trading when the file was saved is TradingView's
         bar so far, and its marks with it: no evidence of a setting. */
      if ((v !== 0 && v !== 1) || !x.keys[j] || (x.keys[j] === x.last && x.lastStatus === 'PROVISIONAL')) return;
      const o = own[j];
      if (!NEEDS[c.signal].some(([k]) => o[k] != null)) return;
      marks++;
      const why = v === 1 ? ownContradicts(c.signal, o) : [];
      if (why.length) { denied.push({ j, key: x.keys[j], title: c.title, signal: c.signal, drawn: 1, why }); return; }
      const req = v === 0 ? ownRequires(c.signal, o, entryOf(j)) : null;
      if (req) denied.push({ j, key: x.keys[j], title: c.title, signal: c.signal, drawn: 0, why: req });
    });
  }
  return { marks, denied };
}
/* The evidence without row j: a mark is never its own evidence, so one mark
   that disagrees with everything is UNEXPLAINED, not proof of a setting. */
const elsewhere = (ev, j) => ev.denied.filter(z => z.j !== j);

/* ---------------------------------------------------------------- the pack -- */
/* The pack on the temporary history, and every reading the comparison asks
   of it, each computed once: a setup's state at a daily bar (scanEvaluate, as
   scanHistorical evaluates it — the same bars, calendar and cache); each
   criterion alone at a daily bar, on the daily bars or read on a trade
   timeframe; each criterion on the weekly or monthly bars themselves (the
   merged bars a condition reads, scanFrame); and whether its value has
   settled there. */
export function packReader(E, hist, symbol, { market = null, instruments = [], criterion3 = 'ema', macdSignal = 'ema' } = {}) {
  const cal = E.scanCalendar(hist, instruments, market);
  const bars = E.scanBars(hist, symbol, { market, calendar: cal });
  const pack = E.scanBotPack({ symbols: [symbol], criterion3, macdSignal });
  const byId = new Map(pack.map(s => [s.id, s]));
  const K = E.scanBotCriteria({ criterion3, macdSignal });
  const cache = E.scanCache();
  const memo = new Map();
  const once = (key, f) => { if (!memo.has(key)) memo.set(key, f()); return memo.get(key); };
  const COND = { c1: 'c1', c2: 'c2', c3: 'c3', c4: 'c4', c5: 'c5', hu: 'histUp', hd: 'histDown', hm: 'histMoved' };
  const cond = (key, yes, tf) => { const k = COND[key] || key; const [op, right] = yes ? K[k].yes : K[k].no; return { type: 'condition', left: { ...K[k].left }, op, right: { ...right }, ...(tf ? { timeframe: tf } : {}) }; };
  const one = (c, b, i) => E.scanEvaluate({ type: 'group', logic: 'ALL', children: [c] }, b, { at: i, cache });
  const state = (id, i) => once(`s|${id}|${i}`, () => E.scanEvaluate(byId.get(id).ruleTree, bars, { at: i, cache }));
  /* The criteria at daily bar i, on the daily bars (tf null) or read on tf. */
  const comps = (i, tf = null) => once(`c|${tf}|${i}`, () => {
    const v = {}, detail = {};
    const put = (name, c) => { const r = one(c, bars, i); v[name] = k3(r.state); detail[name] = r.conditions[0]; };
    for (const k of ['c1', 'c2', 'c3', 'c4']) { put(`${k}y`, cond(k, 1, tf)); put(`${k}n`, cond(k, 0, tf)); }
    if (tf) { put('hu', cond('hu', 1, tf)); put('hd', cond('hd', 1, tf)); put('hm', cond('hm', 1, tf)); }
    else put('c5y', cond('c5', 1, null));
    /* The trade timeframe's MACD histogram on the bar read (its value, for
       a monthly chart read with the weekly Trade TF). */
    if (tf) { const r = one({ type: 'condition', left: { ...K.histUp.left, field: 'hist' }, op: 'GREATER_THAN', right: { value: 0 }, timeframe: tf }, bars, i).conditions[0]; v.hist = r.leftValue ?? null; }
    const read = Object.values(detail).find(r => r?.barDate);
    v.barDate = read?.barDate ?? null;
    v.barOrigin = read?.barOrigin ?? null;
    return { v, detail };
  });
  const frameOf = (tf) => (tf ? E.scanFrame(bars, tf) : null);
  const baseOf = (tf) => (tf ? frameOf(tf)?.bars || null : bars);
  /* A criterion on the bars of tf themselves, at their index k: as a
     condition reads it there. */
  const onBase = (tf, key, k) => once(`b|${tf}|${key}|${k}`, () => k3(one(cond(key, 1, null), baseOf(tf), k).state));
  /* The numbers a criterion compares, over a series of bars. */
  const numbersOf = (b, key) => {
    const pine = (left) => E.SCAN_INDICATORS[left.indicator].pine(b, E.scanParams(left).params).fields;
    switch (key) {
      case 'c1': { const f = pine(K.c1.left); return { a: f.wt1, b: f.wt2, scale: f.wt1 }; }
      case 'c2': { const f = pine(K.c2.left); return { a: f.macd, b: f.signal, scale: f.macd }; }
      case 'c3': { const avg = K.c3.yes[1]; const m = avg.indicator === 'sma' ? E.scanSma(b.closes, avg.n) : E.scanEma(b.closes, avg.n); return { a: b.closes, b: m, scale: m }; }
      case 'c4': { const f = pine(K.c4.left); return { a: f[K.c4.left.field], b: null, scale: f[K.c4.left.field] }; }
      case 'c5': { const f = pine(K.c5.left); return { a: f[K.c5.left.field], b: null, scale: f[K.c5.left.field] }; }
      case 'hu': case 'hd': { const h = pine(K.histUp.left).hist; return { a: h, b: h.map((_, j) => (j ? h[j - 1] : null)), scale: h }; }
      default: return null;
    }
  };
  const numbers = (tf, key) => once(`n|${tf}|${key}|0`, () => numbersOf(baseOf(tf), key));
  /* SETTLED (above): the value a criterion compares on bar j — the
     difference of its two sides, or its one reading — against the same on
     the bars with their first k left out, wherever that has one. */
  const scalar = (n, j) => (n.a[j] == null || (n.b && n.b[j] == null) ? null : n.b ? n.a[j] - n.b[j] : n.a[j]);
  const drop = (b, k) => E.scanSeriesBars(b.closes.slice(k), { open: b.open?.slice(k), high: b.high?.slice(k), low: b.low?.slice(k), volumes: b.volumes?.slice(k) });
  const settled = (tf, key, j) => once(`st|${tf}|${key}|${j}`, () => {
    const b = baseOf(tf);
    if (!b || j < 0 || !CRIT_KEYS[key]) return { settled: true };
    const full = numbers(tf, key);
    const x = scalar(full, j);
    if (x == null) return { settled: true };
    const tol = REL_TOL * Math.max(1e-9, ...full.scale.filter(v => v != null).map(Math.abs));
    for (const k of DROPS) {
      if (k >= j) break;
      const s = once(`n|${tf}|${key}|${k}`, () => numbersOf(drop(b, k), key));
      const y = scalar(s, j - k);
      if (y != null && Math.abs(y - x) > tol) return { settled: false, k, moved: y - x, bars: j + 1 };
    }
    return { settled: true, bars: j + 1 };
  });
  /* Whether where the file begins decides a criterion on bar j: with its
     first k bars left out, the criterion reads the other way — the file too
     short to decide it, not merely to settle its value. Null when no run
     turns it over. */
  const flips = (tf, key, j) => once(`fl|${tf}|${key}|${j}`, () => {
    const b = baseOf(tf);
    if (!b || j < 0 || !CRIT_KEYS[key]) return null;
    const x = scalar(numbers(tf, key), j);
    if (x == null) return null;
    for (const k of DROPS) {
      if (k >= j) break;
      const y = scalar(once(`n|${tf}|${key}|${k}`, () => numbersOf(drop(b, k), key)), j - k);
      if (y != null && (y > 0) !== (x > 0)) return { k, moved: y - x, bars: j + 1 };
    }
    return null;
  });
  /* The index of the bar a criterion on tf reads at daily bar i. */
  const readAt = (tf, i) => (tf ? E.scanFrameAt(frameOf(tf), bars.dates[i]) : i);
  return { bars, pack, byId, K, state, comps, onBase, numbers, settled, flips, frameOf, readAt, calendar: cal,
           warmup: E.scanBotWarmup(bars, { criterion3, macdSignal }) };
}

/* ------------------------------------------------------------- the reasons -- */
const CRIT = { c1: 'criterion 1', c2: 'criterion 2', c3: 'criterion 3', c4: 'criterion 4', c5: 'criterion 5', histUp: 'the histogram test', histDown: 'the histogram test',
               histMoved: 'the histogram test', hu: 'the histogram rising', hd: 'the histogram falling' };
const CRIT_WORDS = { c1: 'WT1 above WT2', c2: 'MACD above its EMA signal', c4: 'banker above 5', c5: 'hot money below 10', hu: 'histogram rising', hd: 'histogram falling' };
/* A setup's conditions beside the nodes they were read from (scanEvalNode
   lists them depth first), each named by its criterion. */
function conditionsOf(K, setup, r) {
  const nodes = [];
  const walk = (n) => { if (n?.type === 'group') (n.children || []).forEach(walk); else nodes.push(n); };
  walk(setup.ruleTree);
  const keyOf = (n) => Object.keys(K).find(k => K[k].left.indicator === n.left?.indicator && K[k].left.field === n.left?.field);
  return r.conditions.map((c, k) => ({ ...c, criterion: keyOf(nodes[k] || {}) || null, tf: nodes[k]?.timeframe || '1D' }));
}
/* Why the pack could not read a signal: its unreadable conditions, most
   particular first — a provisional bar, then what is not held, then warm-up. */
function unknownReason(K, setup, r) {
  if (r.reason?.code === 'PROVISIONAL_BAR') return { reason: 'provisional', detail: r.reason.text };
  const un = conditionsOf(K, setup, r).filter(c => c.state === 'UNAVAILABLE');
  const code = (c) => c.reason?.code || null;
  const words = (c) => `${WORD[c.tf] || c.tf} ${CRIT[c.criterion] || 'condition'}: ${String(c.reason?.text || c.text || '').replace(/^(weekly|monthly) bars: /, '')}`;
  const uniq = (list) => [...new Set(list.map(words))];
  const prov = un.filter(c => code(c) === 'PROVISIONAL_BAR');
  if (prov.length) return { reason: 'provisional', detail: uniq(prov).join('; ') };
  const gone = un.filter(c => ['STALE', 'MISSING_SESSION', 'NO_DAILY_BARS'].includes(code(c)));
  if (gone.length) return { reason: 'not held', detail: uniq(gone).join('; ') };
  const warm = un.filter(c => code(c) === 'NEEDS_BARS');
  if (warm.length && warm.length === un.length) return { reason: 'warm-up', detail: uniq(warm).join('; ') };
  return { reason: 'UNEXPLAINED', detail: `the pack could not read ${uniq(un.filter(c => code(c) !== 'NEEDS_BARS')).join('; ') || 'the signal'}` };
}
/* A trade reading the pack could not make: its unreadable criteria. */
function tradeUnknown(ct) {
  const un = Object.values(ct.detail).filter(c => c?.state === 'UNAVAILABLE');
  const codes = new Set(un.map(c => c.reason?.code));
  const text = [...new Set(un.map(c => String(c.reason?.text || c.text || '').replace(/^(weekly|monthly) bars: /, '')))].join('; ');
  const reason = codes.has('PROVISIONAL_BAR') ? 'provisional' : ['STALE', 'MISSING_SESSION', 'NO_DAILY_BARS'].some(k => codes.has(k)) ? 'not held'
    : un.length && [...codes].every(k => k === 'NEEDS_BARS') ? 'warm-up' : 'UNEXPLAINED';
  return { reason, detail: text || 'the trade criteria could not be read' };
}
const yn = (v) => (v === 1 ? 'true' : v === 0 ? 'false' : 'unknown');
const periodLabel = (T, key) => (T === '1M' ? key.slice(0, 7) : T === '1W' ? `week of ${key}` : key);
/* The last expected session of a period on the calendar. */
function lastSessionOf(E, cal, T, key) {
  const of = T === '1M' ? E.scanMonthOf : E.scanWeekOf;
  let last = null;
  for (let d = key, k = 0; of(d) === key && k < 32; d = E.scanAddDays(d, 1), k++) if (E.scanIsSession(cal, d)) last = d;
  return last;
}
/* A criterion's numbers as the pack computed them on bar j of tf, in words. */
function packNumbers(P, tf, key, j) {
  const n = P.numbers(tf, key);
  if (!n || j < 0) return '';
  const [a, b] = [n.a[j], n.b ? n.b[j] : null];
  switch (key) {
    case 'c1': return `WT1 ${fmt(a)}, WT2 ${fmt(b)}`;
    case 'c2': return `MACD ${fmt(a)}, signal ${fmt(b)}`;
    case 'c3': return `close ${fmt(a)}, ${P.K.c3.yes[1].indicator.toUpperCase()}${P.K.c3.yes[1].n} ${fmt(b)}`;
    case 'c4': return `banker ${fmt(a)}`;
    case 'c5': return `hot money ${fmt(a)}`;
    default: return `histogram ${fmt(a)}, the bar before's ${fmt(b)}`;
  }
}
/* A criterion the pack reads otherwise than the chart's own column, and
   why: warm-up when the pack's value has not settled, UNEXPLAINED when it
   has. */
function criterionDiff(P, tf, key, j, mine, theirs, o) {
  const s = P.settled(tf, key, j);
  const what = `${tf ? WORD[tf] : 'daily'} ${CRIT[key]} (${CRIT_WORDS[key]}): the pack reads ${yn(mine)} (${packNumbers(P, tf, key, j)}), your chart's own columns ${yn(theirs)} (${OWN_WORDS[key](o)})`;
  return s.settled ? { criterion: key, reason: 'UNEXPLAINED', detail: `${what}, and the pack's value has settled (${s.bars} bars)` }
    : { criterion: key, reason: 'warm-up', detail: `${what}; the pack's value has not settled in ${s.bars} bars — with the first ${s.k} left out it moves by ${fmt(s.moved)}` };
}

/* ---------------------------------------------------------- the comparison -- */
/* The pack against every criterion and every bot mark of the exports.
   `exports` are readExport's; the daily one (interval 1D) gives the entry
   readings the others are also compared with. */
export function compareBot(E, P, exports, { symbol = null } = {}) {
  const { bars } = P;
  const lastOf = { '1D': new Map(), '1W': new Map(), '1M': new Map() };
  bars.dates.forEach((d, i) => { lastOf['1D'].set(d, i); lastOf['1W'].set(E.scanWeekOf(d), i); lastOf['1M'].set(E.scanMonthOf(d), i); });
  const periodOf = { '1D': (d) => d, '1W': E.scanWeekOf, '1M': E.scanMonthOf };
  const daily = exports.find(x => x.interval === '1D') || null;
  const own = new Map(exports.map(x => [x, ownCriteria(E, x)]));
  /* The daily chart's own readings by session: its Entry TF Buy and Sell
     marks (the chart's entry readings), and its own daily criteria. */
  const entryAt = new Map(), ownDaily = new Map();
  const lastHeld = { '1W': new Map(), '1M': new Map() };
  if (daily) {
    const buy = daily.bot.find(c => c.signal === 'entry-buy'), sell = daily.bot.find(c => c.signal === 'entry-sell');
    daily.keys.forEach((k, j) => {
      if (!k) return;
      ownDaily.set(k, own.get(daily)[j]);
      lastHeld['1W'].set(E.scanWeekOf(k), k); lastHeld['1M'].set(E.scanMonthOf(k), k);
      if (buy && sell && buy.values[j] != null && sell.values[j] != null) entryAt.set(k, { buy: buy.values[j], sell: sell.values[j] });
    });
  }
  /* A weekly or monthly row's entry reading: the daily chart's on the last
     session it holds in that period. */
  const evidence = new Map(exports.map(x => [x, settingsEvidence(x, own.get(x), {
    entryOf: (j) => (x.interval === '1D' || !x.keys[j] ? null : entryAt.get(lastHeld[x.interval].get(x.keys[j])) || null) })]));
  const dailyEv = daily ? evidence.get(daily) : { denied: [] };
  const entryNotD = dailyEv.denied.length > 0;

  const results = exports.map(x => {
    const T = x.interval;
    const tf = T === '1D' ? null : T;
    const tradeTf = T === '1D' ? '1W' : T;
    const ev = evidence.get(x);
    const tradeDenied = T !== '1D' && ev.denied.length > 0;
    const ownX = own.get(x);
    const provisionalRow = (key) => key === x.last && x.lastStatus === 'PROVISIONAL';
    /* THE CRITERIA: the pack's against the chart's own, on every bar of the
       export both can read — the daily ones at each session, the weekly or
       monthly ones on the export's own periods, in the merged bars. */
    const F = tf ? P.frameOf(tf) : null;
    const kOf = new Map(tf ? (F?.periods || []).map((p, k) => [p, k]) : bars.dates.map((d, i) => [d, i]));
    const critKeys = T === '1D' ? ['c1', 'c2', 'c4', 'c5'] : ['c1', 'c2', 'c4', 'hu', 'hd'];
    const parity = Object.fromEntries(critKeys.map(k => [k, { compared: 0, agree: 0, byReason: {}, items: [] }]));
    x.keys.forEach((key, j) => {
      const k = key ? kOf.get(key) : null;
      if (k == null || provisionalRow(key)) return;
      if (tf && F.bars.status[k] === 'PROVISIONAL') return;
      const o = ownX[j];
      for (const c of critKeys) {
        const mine = P.onBase(tf, c, k), theirs = o[c];
        if (mine == null || theirs == null) continue;
        const p = parity[c];
        p.compared++;
        if (mine === theirs) { p.agree++; continue; }
        const why = criterionDiff(P, tf, c, k, mine, theirs, o);
        p.byReason[why.reason] = (p.byReason[why.reason] || 0) + 1;
        p.items.push({ key, label: periodLabel(T, key), ...why, origin: tf ? F.bars.origin?.[k] || 'daily' : null });
      }
    });

    /* THE MARKS. */
    const outside = { before: [], after: [], within: [] };
    const heldFirst = bars.dates.length ? periodOf[T](bars.dates[0]) : null, heldLast = bars.dates.length ? periodOf[T](bars.dates[bars.dates.length - 1]) : null;
    x.keys.forEach(key => { if (key && !lastOf[T].has(key)) (key < heldFirst ? outside.before : key > heldLast ? outside.after : outside.within).push(key); });
    const columns = [];
    const alt = T === '1M' ? { compared: 0, agree: 0, items: [] } : null;
    for (const c of x.bot) {
      const sig = (E.SCAN_BOT_SIGNALS || []).find(s => s.id === c.signal);
      const id = sig.needsTradeTimeframe ? `mtfbot-${LETTER[tradeTf]}-${sig.id}` : `mtfbot-d-${sig.id}`;
      const setup = P.byId.get(id);
      const entry = readsEntry(sig.id);
      const col = { column: c.column, title: c.title, signal: c.signal, setup: id, marks: c.values.filter(v => v === 1).length, compared: 0, agree: 0, byReason: {}, items: [],
                    withEntry: T !== '1D' && entry && entryAt.size ? { compared: 0, agree: 0, byReason: {}, items: [] } : null, blank: 0 };
      c.values.forEach((v, j) => {
        const key = x.keys[j];
        const i = key ? lastOf[T].get(key) : null;
        if (i == null) return;
        if (v == null) { col.blank++; return; }
        const d = bars.dates[i];
        const r = P.state(id, i);
        const mine = k3(r.state);
        const cd = P.comps(i, null), ct = sig.needsTradeTimeframe ? P.comps(i, tradeTf) : { v: {}, detail: {} };
        const base = { t: ct.v, d: cd.v };
        const row = { key, label: periodLabel(T, key), at: d, theirs: v, tradeBar: ct.v.barDate || null, origin: ct.v.barOrigin || null };
        const chartEntry = entryAt.get(d) || null;
        /* The chart's own values in place of the pack's, where the chart
           draws them and they differ: its daily criteria on d (for a signal
           that reads the entry, unless the chart's entry readings stand in
           for it) and its trade criteria on this period. */
        const corrected = (inputs) => {
          const diffs = [];
          let dd = inputs.d, tt = inputs.t;
          const od = ownDaily.get(d);
          if (entry && inputs.EB === undefined && od) {
            for (const k of ['c1', 'c2', 'c4', 'c5']) {
              const mineK = cd.v[`${k}y`];
              if (od[k] == null || mineK == null || od[k] === mineK) continue;
              diffs.push(criterionDiff(P, null, k, i, mineK, od[k], od));
              dd = setCrit(dd, k, od[k]);
            }
          }
          const ot = T !== '1D' && sig.needsTradeTimeframe && ct.v.barDate && periodOf[T](ct.v.barDate) === key ? ownX[j] : null;
          if (ot) {
            const kk = P.readAt(tradeTf, i);
            for (const k of ['c1', 'c2', 'c4', 'hu', 'hd']) {
              const mineK = k === 'hu' || k === 'hd' ? ct.v[k] : ct.v[`${k}y`];
              if (ot[k] == null || mineK == null || ot[k] === mineK) continue;
              diffs.push(criterionDiff(P, tradeTf, k, kk, mineK, ot[k], ot));
              tt = setCrit(tt, k, ot[k]);
            }
          }
          return { diffs, inputs: { ...inputs, d: dd, t: tt } };
        };
        /* Why the pack's reading and the mark differ (WHY A MARK DISAGREES).
           `inputs` is what the reading was made of: the pack's criteria, and
           the chart's entry readings where they stand in for its daily ones. */
        const explain = (value, inputs) => {
          if (provisionalRow(key)) return { reason: 'provisional', detail: `TradingView's ${T === '1D' ? `bar of ${key}` : T === '1M' ? `month ${periodLabel(T, key)}` : periodLabel(T, key)} was still trading when ${x.file} was saved (${x.at}): its mark is the ${NOUN[T]} so far` };
          if (value == null) return inputs.EB === undefined ? unknownReason(P.K, setup, r) : tradeUnknown(ct);
          if (sig.needsTradeTimeframe && T !== '1D' && ct.v.barDate && periodOf[T](ct.v.barDate) !== key) {
            const lastExp = lastSessionOf(E, P.calendar, T, key);
            const missing = i === bars.dates.length - 1 ? `your daily bars end on ${d}, before the ${NOUN[T]}'s last session (${lastExp})` : `${lastExp} is an expected session of the ${NOUN[T]} and holds no daily bar`;
            return { reason: 'not held', detail: `${missing}, so on ${d} the ${NOUN[T]} has not closed and the pack reads the ${WORD[T]} bar of ${ct.v.barDate}` };
          }
          /* The chart's own criteria in place of the pack's unsettled ones. */
          const fix = corrected(inputs);
          const diffText = fix.diffs.map(z => z.detail).join('; ');
          if (fix.diffs.length && botSignal(sig.id, fix.inputs) === v) {
            return { reason: fix.diffs.every(z => z.reason === 'warm-up') ? 'warm-up' : 'UNEXPLAINED', detail: `${diffText}; with your chart's own, the pack reads the mark` };
          }
          /* Corrected, the reading is unknown — another criterion is still
             in its warm-up (it needs more bars than are held): warm-up both
             ways, and nothing is left to compare. */
          const stillWarm = inputs.EB === undefined && conditionsOf(P.K, setup, r).some(c => c.state === 'UNAVAILABLE')
            && conditionsOf(P.K, setup, r).filter(c => c.state === 'UNAVAILABLE').every(c => c.reason?.code === 'NEEDS_BARS');
          if (fix.diffs.length && fix.diffs.every(z => z.reason === 'warm-up') && botSignal(sig.id, fix.inputs) === null && stillWarm) {
            return { reason: 'warm-up', detail: `${diffText}; with your chart's own the pack cannot read the signal yet — ${unknownReason(P.K, setup, r).detail}` };
          }
          const also = fix.diffs.length ? ` (and ${diffText})` : '';
          /* The chart's entry readings in place of the pack's. */
          if (entry && chartEntry && T !== '1D' && inputs.EB === undefined) {
            const pe = { buy: botSignal('entry-buy', fix.inputs), sell: botSignal('entry-sell', fix.inputs) };
            if ((pe.buy !== chartEntry.buy || pe.sell !== chartEntry.sell) && botSignal(sig.id, { ...fix.inputs, EB: chartEntry.buy, ES: chartEntry.sell }) === v) {
              return { reason: 'entry timeframe', detail: `the pack's daily entry on ${d} reads Buy ${yn(pe.buy)}, Sell ${yn(pe.sell)}; your chart's Entry TF marks on ${d} are Buy ${chartEntry.buy}, Sell ${chartEntry.sell}${also}` };
            }
          }
          /* The daily chart's own Entry TF marks against its own columns. */
          /* Whether the pack's criterion 3 has settled on daily bar k, in words. */
          const c3note = (k) => { const q = P.settled(null, 'c3', k); return q.settled ? '' : `, an average that has not settled in ${q.bars} bars: with the first ${q.k} left out it moves by ${fmt(q.moved)}`; };
          if (T === '1D' && /^entry-/.test(sig.id)) {
            const others = elsewhere(dailyEv, j).length;
            const denied = v === 1 ? ownContradicts(sig.id, ownX[j]) : [];
            if (denied.length && others) return { reason: 'entry timeframe', detail: `your chart's own daily columns on ${d} deny this mark (${denied.join('; ')}), so it is not computed from daily bars — as ${others} other Entry TF mark${others === 1 ? '' : 's'} show${others === 1 ? 's' : ''}${also}` };
            if (!denied.length && others && !fix.diffs.some(z => z.reason === 'UNEXPLAINED')) {
              return { reason: 'entry timeframe', detail: `the pack's daily criteria 1, 2, 4${sig.id !== 'entry-buy' ? ' and 5' : ''} read as your chart's own columns on ${d}${fix.diffs.length ? ' once its unsettled ones are corrected' : ''}; criterion 3's ${P.K.c3.yes[1].indicator.toUpperCase()}(200) is not drawn on the chart (the pack reads ${cd.detail.c3y?.text || 'it unknown'}${c3note(i)}); your chart's Entry TF marks are shown not to be read on daily bars (THE CHARTS' SETTINGS)` };
            }
          }
          /* A daily chart's trade marks, read as the script's gaps_on reads
             them. */
          if (T === '1D' && sig.needsTradeTimeframe) {
            /* TradingView closes a week on the last daily bar it holds in it,
               and reads that week's own values there. */
            const wk = E.scanWeekOf(d), closes = lastOf['1W'].get(wk) === i;
            const kW = closes ? (P.frameOf('1W')?.periods || []).indexOf(wk) : -1;
            if (closes && ct.v.barDate && E.scanWeekOf(ct.v.barDate) !== wk && i < bars.dates.length - 1) {
              return { reason: 'not held', detail: `${d} is the last session your daily bars hold in its week, and ${lastSessionOf(E, P.calendar, '1W', wk)}, an expected one, holds no daily bar: on ${d} the week has not closed for the pack, which reads the week of ${E.scanWeekOf(ct.v.barDate)}` };
            }
            const own = (key) => (kW < 0 ? null : P.onBase('1W', key, kW));
            const t = closes ? { c1y: own('c1'), c2y: own('c2'), c3y: own('c3'), c4y: own('c4'), hu: 0, hd: 0, hm: 0 } : { c1y: 0, c2y: 0, c3y: 0, c4y: 0, hu: 0, hd: 0, hm: 0 };
            for (const k of ['c1', 'c2', 'c3', 'c4']) t[`${k}n`] = t[`${k}y`] == null ? null : 1 - t[`${k}y`];
            if (botSignal(sig.id, { ...fix.inputs, t }) === v) {
              return { reason: 'gaps_on', detail: closes ? `${d} closes its week, and the script's histogram test compares that week's value with the session before, which holds none under gaps_on: on a daily chart it is never true`
                : `${d} does not close its week: under gaps_on the script's weekly criteria hold no value on it and read false, their complements true` };
            }
          }
          /* The chart's marks are shown not to be read on its own bars, and
             this period's own columns read as the pack does. */
          if (T !== '1D' && elsewhere(ev, j).length && sig.needsTradeTimeframe && !fix.diffs.some(z => z.reason === 'UNEXPLAINED')) {
            const o = ownX[j];
            return { reason: 'trade timeframe', detail: `your chart's own ${WORD[T]} columns for ${periodLabel(T, key)} read as the pack does (${['c1', 'c2', 'c4', 'hu', 'hd'].filter(k => o[k] != null).map(k => OWN_WORDS[k](o)).join('; ')}), and its marks are shown not to be read on ${WORD[T]} bars (THE CHARTS' SETTINGS)${inputs.EB !== undefined ? `; with your chart's entry readings on ${d} (Buy ${inputs.EB}, Sell ${inputs.ES})` : ''}` };
          }
          /* Criterion 3, which no chart draws: blamed only where the file's
             start decides it — with its first bars left out it reads the
             other way — and read that way it gives the mark. An average
             merely not settled to a millionth (an EMA of 200 on a few
             hundred bars never is) would excuse any mark. */
          for (const [tfK, vv, k] of [[null, fix.inputs.d, i], ...(sig.needsTradeTimeframe ? [[tradeTf, fix.inputs.t, P.readAt(tradeTf, i)]] : [])]) {
            if (tfK === null && (!entry || inputs.EB !== undefined)) continue;
            const f = P.flips(tfK, 'c3', k);
            if (!f || vv.c3y == null) continue;
            const flipped = tfK ? { ...fix.inputs, t: setCrit(vv, 'c3', 1 - vv.c3y) } : { ...fix.inputs, d: setCrit(vv, 'c3', 1 - vv.c3y) };
            if (botSignal(sig.id, flipped) === v) {
              return { reason: 'warm-up', detail: `${tfK ? WORD[tfK] : 'daily'} criterion 3 reads ${yn(vv.c3y)} (${packNumbers(P, tfK, 'c3', k)}) on ${f.bars} bars, and the file's start decides it: with the first ${f.k} left out its average moves by ${fmt(f.moved)} and it reads the other way, which gives the mark; no chart draws it${also}` };
            }
          }
          return { reason: 'UNEXPLAINED', detail: `the pack reads ${yn(value)} on ${d}${ct.v.barDate ? ` (the ${WORD[tradeTf]} bar of ${ct.v.barDate}, ${ct.v.barOrigin === 'imported' ? 'imported' : 'built from daily bars'})` : ''}${inputs.EB !== undefined ? ` with your chart's entry readings (Buy ${inputs.EB}, Sell ${inputs.ES})` : ''}${also}` };
        };
        const tally = (bucket, value, inputs, extra = {}) => {
          bucket.compared++;
          if (value === v) { bucket.agree++; return; }
          const why = explain(value, inputs);
          bucket.byReason[why.reason] = (bucket.byReason[why.reason] || 0) + 1;
          bucket.items.push({ ...row, mine: value, ...extra, ...why });
        };
        /* The pack's setup and the script's logic on the same criteria are
           one reading; where they are not, the pack is not the script. */
        const said = botSignal(sig.id, base);
        if (said !== mine) {
          col.compared++;
          col.byReason.UNEXPLAINED = (col.byReason.UNEXPLAINED || 0) + 1;
          col.items.push({ ...row, mine, reason: 'UNEXPLAINED', detail: `the pack's setup reads ${yn(mine)} and the script's logic on the same criteria ${yn(said)} — the pack is not the script here` });
        } else tally(col, mine, base);
        /* The trade timeframe alone: the chart's own entry readings in
           place of the pack's. */
        if (col.withEntry && chartEntry) {
          const inputs = { ...base, EB: chartEntry.buy, ES: chartEntry.sell };
          tally(col.withEntry, botSignal(sig.id, inputs), inputs, { entry: chartEntry });
        }
        /* A monthly chart read as the script's default Trade TF, W: the week
           closed by the month's last session, its histogram against the one
           the month before read. */
        if (alt && sig.needsTradeTimeframe && !provisionalRow(key)) {
          const cw = P.comps(i, '1W');
          const ip = lastOf['1M'].get(E.scanMonthOf(E.scanAddDays(key, -1)));
          const pw = ip == null ? null : P.comps(ip, '1W');
          const both = pw && cw.v.hist != null && pw.v.hist != null;
          const hu = both ? (cw.v.hist > pw.v.hist ? 1 : 0) : null, hd = both ? (cw.v.hist < pw.v.hist ? 1 : 0) : null;
          const value = botSignal(sig.id, { t: { ...cw.v, hu, hd, hm: hu == null ? null : (hu || hd ? 1 : 0) }, d: cd.v, ...(chartEntry ? { EB: chartEntry.buy, ES: chartEntry.sell } : {}) });
          if (value != null) {
            alt.compared++;
            if (value === v) alt.agree++; else alt.items.push({ ...row, mine: value, week: cw.v.barDate });
          }
        }
      });
      columns.push(col);
    }
    const span = (l) => (l.length ? { n: l.length, from: l[0], to: l[l.length - 1] } : { n: 0 });
    return { file: x.file, interval: T, tradeTf, bars: x.bars, first: x.first, last: x.last, lastStatus: x.lastStatus, lastSession: x.lastSession, at: x.at,
             parity, columns, notCompared: { before: span(outside.before), after: span(outside.after), within: span(outside.within) },
             evidence: { marks: ev.marks, denied: ev.denied }, tradeDenied, alt };
  });
  const byReason = {}, withEntryByReason = {}, parityByReason = {};
  let compared = 0, agree = 0;
  const add = (to, from) => Object.entries(from || {}).forEach(([k, n]) => { to[k] = (to[k] || 0) + n; });
  results.forEach(x => {
    x.columns.forEach(c => { compared += c.compared; agree += c.agree; add(byReason, c.byReason); add(withEntryByReason, c.withEntry?.byReason); });
    Object.values(x.parity).forEach(p => add(parityByReason, p.byReason));
  });
  return { symbol, exports: results, entryNotD, entryEvidence: daily ? { file: daily.file, ...evidence.get(daily) } : null,
           summary: { compared, agree, disagree: compared - agree, byReason, withEntryByReason, parityByReason,
                      unexplained: (byReason.UNEXPLAINED || 0) + (withEntryByReason.UNEXPLAINED || 0) + (parityByReason.UNEXPLAINED || 0) } };
}

/* ---------------------------------------------------------------- the words -- */
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const reasonsText = (by) => REASONS.filter(k => by[k]).map(k => `${k} ${by[k]}`).join(', ');
export function reportText(rep) {
  const L = [];
  L.push(`Multi-Timeframe Trading Bot — the scanner's pack against the bot's marks on your TradingView charts`);
  L.push(`Symbol              ${rep.symbol}, market ${rep.market} (${rep.marketLabel}): ${rep.dating}`);
  L.push(`Temporary history   imported by ingest/history-import.mjs into a folder made for this run and removed after it:`);
  for (const l of rep.imports) L.push(`                    ${l.file}: ${l.summary}${l.exit ? ` (exit ${l.exit})` : ''}`);
  L.push(`The pack            scanBotPack for ${rep.symbol}: ${rep.pack.setups} setups — trade timeframes weekly and monthly, criterion 3 on the ${rep.pack.criterion3.toUpperCase()}(200), criterion 2 on the MACD's ${rep.pack.macdSignal.toUpperCase()} signal`);
  L.push(`Warm-up             ${rep.warmup.map(w => w.text).join('\n                    ')}`);
  L.push(`Assumption          each chart's bot reads Entry TF = D (your daily bars) and Trade TF = the chart's own timeframe (on a daily chart, W); the script's defaults otherwise.`);
  L.push(`                    A weekly or monthly mark is held against the pack at the last daily session held in its week or month; a daily mark at its session.`);
  const line = (x, it, title) => `    ${`${it.label}${x.interval !== '1D' ? ` (on ${it.at})` : ''}`.padEnd(29)} ${title.padEnd(25)} TradingView ${it.theirs}, the pack ${yn(it.mine)} — ${it.reason}: ${it.detail}`;
  /* A column's disagreements, in words: the bars the pack could not read
     yet are one line, from the first to the last, with the last one's
     reason (every one is in --json); every other is its own line. */
  const lines = (x, items, title) => {
    const out = [];
    const early = items.filter(it => it.mine === null && it.reason === 'warm-up');
    if (early.length > 1) {
      const z = early[early.length - 1];
      out.push(`    ${`${early[0].label} … ${z.label}`.padEnd(29)} ${title.padEnd(25)} ${early.length} ${NOUN[x.interval]}s the pack cannot read yet, TradingView marking ${early.filter(it => it.theirs === 1).length} of them — warm-up; the last: ${z.detail}`);
    }
    for (const it of items) if (early.length < 2 || !early.includes(it)) out.push(line(x, it, title));
    return out;
  };
  for (const x of rep.exports) {
    L.push('');
    L.push(`${x.file} — the ${WORD[x.interval]} chart, ${x.bars} bars, ${periodLabel(x.interval, x.first)} … ${periodLabel(x.interval, x.last)}${x.lastStatus === 'PROVISIONAL' ? ` (the last ${NOUN[x.interval]} still trading when saved)` : ''}`);
    /* The criteria. */
    const pk = Object.entries(x.parity);
    L.push(`  Criteria, the pack's ${WORD[x.interval]} readings against your chart's own columns${x.interval === '1D' ? ' on each session' : ` on each ${NOUN[x.interval]}, on the bars the pack holds (imported where held)`}:`);
    L.push(`    ${pk.map(([k, p]) => `${CRIT_WORDS[k]} ${p.agree}/${p.compared}${p.items.length ? ` (${reasonsText(p.byReason)})` : ''}`).join('; ')}`);
    for (const [, p] of pk) {
      const un = p.items.filter(it => it.reason === 'UNEXPLAINED'), warm = p.items.filter(it => it.reason === 'warm-up');
      for (const it of un) L.push(`    ${it.label.padEnd(20)} UNEXPLAINED: ${it.detail}`);
      if (warm.length) L.push(`    ${warm.length === 1 ? warm[0].label : `${warm.length} bars, ${warm[0].label} … ${warm[warm.length - 1].label}`}: warm-up — the latest: ${warm[warm.length - 1].detail}`);
    }
    /* The marks. */
    const nc = x.notCompared;
    const ncl = [nc.before.n ? `${plural(nc.before.n, NOUN[x.interval])} before the daily export (${periodLabel(x.interval, nc.before.from)} … ${periodLabel(x.interval, nc.before.to)})` : null,
      nc.after.n ? `${nc.after.n} after it` : null, nc.within.n ? `${nc.within.n} with no daily session held` : null].filter(Boolean);
    L.push(`  Marks, against the pack${ncl.length ? `; NOT COMPARED: ${ncl.join(', ')} — the entry criteria read daily bars` : ''}:`);
    if (!x.columns.length) L.push('    no bot mark in this export');
    for (const c of x.columns) {
      const dis = c.compared - c.agree;
      L.push(`    ${c.title.padEnd(26)} ${c.setup.padEnd(32)} ${String(c.compared).padStart(4)} compared, ${String(c.agree).padStart(4)} agree, ${String(dis).padStart(3)} disagree${dis ? ` (${reasonsText(c.byReason)})` : ''}; ${plural(c.marks, 'mark')} in the file${c.blank ? `, ${c.blank} blank` : ''}`);
    }
    for (const c of x.columns) L.push(...lines(x, c.items, c.title));
    const we = x.columns.filter(c => c.withEntry);
    if (we.length) {
      const t = we.reduce((a, c) => ({ compared: a.compared + c.withEntry.compared, agree: a.agree + c.withEntry.agree }), { compared: 0, agree: 0 });
      const by = {};
      we.forEach(c => Object.entries(c.withEntry.byReason).forEach(([k, n]) => { by[k] = (by[k] || 0) + n; }));
      L.push(`  With your chart's own entry readings (the daily chart's Entry TF marks in place of the pack's daily entry): ${t.compared} compared, ${t.agree} agree${t.compared - t.agree ? `, ${t.compared - t.agree} disagree (${reasonsText(by)})` : ''}`);
      for (const c of we) L.push(...lines(x, c.withEntry.items, c.title));
    }
  }
  L.push('');
  L.push(`The charts' settings, from their own columns (a bar whose mark its chart's own criteria 1, 2, 4, 5, histogram and entry reading deny, drawn, or require, not drawn, was not read on that chart's bars):`);
  const said = (den, iv) => {
    const drawn = den.filter(z => z.drawn), missing = den.filter(z => !z.drawn);
    const eg = (z) => `${periodLabel(iv, z.key)} ${z.title} ${z.drawn ? 'drawn' : 'not drawn'} (${z.why.join('; ')})`;
    return `${drawn.length} drawn where they deny it, ${missing.length} not drawn where they require it${den.length ? ` — e.g. ${[...drawn.slice(-2), ...missing.slice(-1)].map(eg).join('; ')}` : ''}`;
  };
  if (rep.entryEvidence) {
    const e = rep.entryEvidence;
    L.push(`  Entry TF          ${e.file}: ${plural(e.marks, 'Entry TF reading')} readable against the chart's own daily columns, ${said(e.denied, '1D')}${e.denied.length ? ": the chart's Entry TF is not D (the script ships with 240, 4-hour bars, which daily bars cannot reproduce)" : ' — consistent with Entry TF = D'}`);
  }
  for (const x of rep.exports.filter(z => z.interval !== '1D')) {
    const den = x.evidence.denied;
    L.push(`  Trade TF          ${x.file}: ${plural(x.evidence.marks, 'reading')} readable against the chart's own ${WORD[x.interval]} columns, ${said(den, x.interval)}${den.length ? `: the chart's bot does not read ${WORD[x.interval]} bars` : ` — consistent with Trade TF = ${x.interval.slice(1)}`}`);
    if (x.alt && x.tradeDenied) L.push(`                    read as Trade TF = W (the script's default: each month on the week closed by its last session, the histogram against the month before's): ${x.alt.compared} compared, ${x.alt.agree} agree${x.alt.items.length ? ` — differs on ${x.alt.items.slice(0, 4).map(it => `${it.label} ${it.theirs}/${yn(it.mine)}`).join(', ')}` : ''}`);
  }
  const s = rep.summary;
  const wb = Object.values(s.withEntryByReason).reduce((a, n) => a + n, 0), pb = Object.values(s.parityByReason).reduce((a, n) => a + n, 0);
  L.push('');
  L.push(`Marks: ${s.compared} compared, ${s.agree} agree, ${s.disagree} disagree${s.disagree ? ` (${reasonsText(s.byReason)})` : ''}${wb ? `; with your chart's entry readings, ${wb} disagree (${reasonsText(s.withEntryByReason)})` : ''}. Criteria: ${pb} reading${pb === 1 ? '' : 's'} differ from your charts' own columns${pb ? ` (${reasonsText(s.parityByReason)})` : ''}.`);
  L.push(`${s.unexplained} UNEXPLAINED${s.unexplained ? ' — a fault to find, in the engine, the merge or the assumption' : ''}`);
  return L.join('\n');
}

/* ---------------------------------------------------------------- the run -- */
export async function botVerify({ daily, weekly = null, monthly = null, symbol = null, market = undefined, capturedAt = null, criterion3 = 'ema', macdSignal = 'ema', E = null, instruments = null } = {}) {
  if (!daily) throw new Error('--daily is needed: the entry criteria read daily bars');
  const files = [{ path: daily, interval: '1D' }, ...(weekly ? [{ path: weekly, interval: '1W' }] : []), ...(monthly ? [{ path: monthly, interval: '1M' }] : [])];
  for (const f of files) {
    const named = tradingViewName(f.path);
    if (named && exportTimeframe(named.interval) !== f.interval) throw new Error(`${basename(f.path)} is named a ${named.interval} export, and was given as the ${WORD[f.interval]} one`);
  }
  const syms = [...new Set(files.map(f => tradingViewName(f.path)?.symbol).filter(Boolean))];
  if (!symbol && syms.length > 1) throw new Error(`the files are not one symbol (${syms.join(', ')}) — export the same chart at each timeframe`);
  const sym = symbol || syms[0];
  if (!sym) throw new Error('no symbol: name the files as TradingView does ("OANDA_XAUUSD, 1D.csv") or give --symbol');
  E = E || await loadEngine();
  const inst = instruments || await loadInstruments();
  const mk = market != null ? market : marketOf(sym, inst);
  const texts = [];
  for (const f of files) {
    let text;
    try { text = await readFile(f.path, 'utf8'); } catch (e) { throw new Error(`could not read ${f.path}: ${e.message}`); }
    texts.push({ ...f, text, at: capturedAt || (await stat(f.path)).mtime.toISOString() });
  }
  const exps = texts.map(f => readExport(E, f.text, { file: basename(f.path), interval: f.interval, market: mk, at: f.at }));
  if (!exps.some(x => x.bot.length)) throw new Error('no export carries a mark of the Multi-Timeframe Trading Bot (a column titled as one of its alerts, such as "Strong Buy - Continuous") — show the bot on the chart before exporting');
  const { hist, log } = await importExports(texts, { symbol: sym, market: mk, capturedAt });
  if (!Object.keys(hist.series?.[sym] || {}).length) throw new Error(`the import holds no daily bar for ${sym}`);
  const P = packReader(E, hist, sym, { market: mk, instruments: inst, criterion3, macdSignal });
  const cmp = compareBot(E, P, exps, { symbol: sym });
  const M = E.scanMarket(mk);
  return { ...cmp, market: M.code, marketLabel: M.label, dating: datingRule(M), imports: log,
           pack: { setups: P.pack.length, criterion3, macdSignal }, warmup: P.warmup.map(w => ({ timeframe: w.timeframe, text: w.text })) };
}

async function main(argv) {
  const args = argv.slice(2);
  const val = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
  const daily = val('daily');
  if (!daily || args.includes('--help')) {
    console.error('usage: node scanner/bot-verify.mjs --daily "<the daily export>" [--weekly "<the weekly export>"] [--monthly "<the monthly export>"] [--market CODE] [--symbol SYM] [--captured-at ISO] [--criterion3 ema|sma] [--macd-signal ema|sma] [--json]');
    return 2;
  }
  for (const k of ['weekly', 'monthly', 'market', 'symbol', 'captured-at', 'criterion3', 'macd-signal']) {
    if (args.includes(`--${k}`) && !val(k)) { console.error(`bot-verify: --${k} needs a value`); return 2; }
  }
  const captured = val('captured-at');
  if (captured && !Number.isFinite(Date.parse(captured))) { console.error(`bot-verify: --captured-at "${captured}" is not a date-time`); return 2; }
  const criterion3 = val('criterion3') || 'ema', macdSignal = val('macd-signal') || 'ema';
  if (!['ema', 'sma'].includes(criterion3) || !['ema', 'sma'].includes(macdSignal)) { console.error('bot-verify: --criterion3 and --macd-signal are ema or sma'); return 2; }
  let rep;
  try {
    rep = await botVerify({ daily, weekly: val('weekly'), monthly: val('monthly'), symbol: val('symbol'), market: val('market'),
                            capturedAt: captured ? new Date(Date.parse(captured)).toISOString() : null, criterion3, macdSignal });
  } catch (e) { console.error(`bot-verify: ${e.message}`); return 2; }
  console.log(args.includes('--json') ? JSON.stringify(rep, null, 2) : reportText(rep));
  return rep.summary.unexplained ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv);
