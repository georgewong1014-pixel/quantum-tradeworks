#!/usr/bin/env node
/**
 * scanner/tv-verify.mjs — the reader's TradingView indicators, recomputed from
 * an export of their own chart and compared with it column by column.
 *
 *   node scanner/tv-verify.mjs --csv "watchlist-shots/OANDA_XAUUSD, 1D.csv"
 *   node scanner/tv-verify.mjs --csv FILE --set wavetrend.channel=9 --json
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
 * Exit status: 0 when nothing DIFFERS, 1 when something does, 2 when the file
 * cannot be read or a column is not recognised.
 *
 * The export is the reader's licensed data: this reads it where it lies and
 * writes nothing. No check in CI depends on any export; scanner-test drives
 * this tool with a file it builds itself.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEngine } from './scan.mjs';

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
    why: 'the Multi-Timeframe Trading Bot’s Entry TF marks, which it computes on 4-hour bars (Entry_TF "240") — a daily export does not hold them' },
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

export async function verify(text, { E = null, sets = {}, file = 'export' } = {}) {
  E = E || await loadEngine();
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
  return { file, bars: n, first: stamps[0], last: stamps[n - 1], sets, rows: out,
           summary: { match: count('MATCH'), differs: count('DIFFERS'), notSettled: count('NOT SETTLED'), notCompared: count('NOT COMPARED'), inputs: count('INPUT') } };
}

const fmtNum = (v) => (v == null ? '—' : v === 0 ? '0' : Math.abs(v) >= 0.01 && Math.abs(v) < 1e6 ? String(Number(v.toPrecision(4))) : v.toExponential(1));
export function table(rep) {
  const L = [];
  L.push(`TradingView export  ${rep.file} — ${rep.bars} bars, stamped ${rep.first} … ${rep.last} (UTC)`);
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
  return L.join('\n');
}

async function main(argv) {
  const args = argv.slice(2);
  const val = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
  const csv = val('csv');
  if (!csv || args.includes('--help')) {
    console.error('usage: node scanner/tv-verify.mjs --csv "<TradingView export>" [--set id.param=value ...] [--json]');
    return 2;
  }
  const sets = [];
  args.forEach((a, i) => { if (a === '--set' && args[i + 1]) sets.push(args[i + 1]); });
  let E, text;
  try { E = await loadEngine(); } catch (e) { console.error(`Could not load the scan engine out of index.html: ${e.message}`); return 2; }
  try { text = await readFile(csv, 'utf8'); } catch (e) { console.error(`Could not read ${csv}: ${e.message}`); return 2; }
  let rep;
  try { rep = await verify(text, { E, sets: parseSets(sets, E), file: basename(csv) }); } catch (e) { console.error(`tv-verify: ${e.message}`); return 2; }
  console.log(args.includes('--json') ? JSON.stringify(rep, null, 2) : table(rep));
  return rep.summary.differs ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exitCode = await main(process.argv);
