/**
 * The price-history store — the one writer of data/price-history.json.
 *
 *   import { updateHistory, mergeBars } from './history-store.mjs';
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONE WRITER
 *
 * Three scripts used to write this file under three policies. history.mjs kept
 * 500 closes and trimmed no volume, so a 600-bar import plus one daily run left
 * 500 closes and 600 volumes; history-import.mjs kept 2000 and overwrote a
 * disagreeing close with a note; live.mjs overwrote silently. None of them
 * wrote atomically, and none recorded when a bar was captured or from where,
 * so nothing could say whether a bar was the session's final value or a
 * reading taken while it traded. Every writer now calls updateHistory, and
 * this file decides:
 *
 *   VALIDATION  is the engine's scanValidateBar, loaded out of index.html the
 *               way the scanner worker loads it, so the page, the worker and
 *               the ingest refuse the same bars. A refused row never reaches
 *               the history; it is written to data/price-history.rejects.json
 *               (git-ignored) with its codes.
 *   CONFLICTS   follow a source rank (SOURCE_RANK below): a structured export
 *               or a provider outranks a value read off the screen. A lower
 *               rank never replaces a higher one — the attempt is reported
 *               and written to the rejects file as OUTRANKED. An equal or
 *               higher rank that disagrees replaces the bar and the change is
 *               recorded in hist.corrections, which the engine reads as a
 *               CORRECTED bar. A bar captured before its session closed
 *               (PROVISIONAL) is superseded by any later capture, and that is
 *               not a correction: it was never a final value.
 *   A BAR IS ONE SOURCE'S READING. When a winning source changes the close,
 *               the bar's open, high, low and volume become that source's
 *               too (absent where it has none) — a high from one vendor
 *               beside a close from another can describe no real session.
 *   PROVENANCE  meta[SYM][date] = { src, at }: the source and the instant the
 *               bar was captured. The engine's scanBarStatus reads `at`
 *               against the session's close in the market's own zone and
 *               calls the bar FINAL or PROVISIONAL; a bar with no `at` (every
 *               bar written before this file existed) is UNKNOWN.
 *   TRIMMING    keeps the newest KEEP bars and drops series, volume, ohlc,
 *               meta and corrections together.
 *   WRITING     is atomic: the new file is written beside the old one and
 *               renamed over it, and the previous file is kept as .bak. A
 *               lock file stops two writers on this machine interleaving.
 *
 * DATES. A bar is dated by its exchange's session in the exchange's time
 * zone — never by the UTC day of a timestamp or of the machine that read it.
 * parseDateCell reads an import's date cell and refuses a day/month order it
 * cannot know (03/04/2026), as the browser's paste parser does, and dates an
 * export's stamp by the session it opens (epochDate: OANDA's gold bar stamped
 * 17:00 New York on Sunday is Monday's); readingSession dates a reading taken
 * at an instant (a screen capture, a quote).
 *
 * WEEKS AND MONTHS, IMPORTED. A daily export reaches back as far as the
 * chart was scrolled — the owner's gold file holds 300 sessions, fourteen
 * months — so weekly and monthly bars built from it have too few periods
 * for a monthly WaveTrend or MACD (about 40 months of warm-up), let alone an
 * EMA 200 of weeks. TradingView exports the weekly and the monthly chart
 * too, 300 bars each: nearly six years of weeks, twenty-five of months.
 * Those bars are held apart from the daily series, under
 *
 *   frames: { '1W' | '1M': { SYM: { series, ohlc, volume, meta, corrections? } } }
 *
 * each map keyed by the engine's own period key — scanWeekOf (the Monday of
 * the week) or scanMonthOf (the 1st of the month) of the period's first
 * session, read out of the engine and never re-derived here. They go
 * through the same merge as a daily bar (mergeFrameBars): the engine's
 * validation on the session the stamp opens, the source rank, corrections
 * recorded (in the frame's own list: the history's corrections are read by
 * the engine as daily ones), provenance, the rejects file, the trim, the
 * lock and the atomic write. A period is FINAL only when its last expected
 * session had closed when the bar was captured (periodStatus): the week or
 * month still trading when the file was saved is PROVISIONAL, and the next
 * capture replaces it without calling it a correction.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, copyFile, rm, mkdir, stat, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { withLock } from './lockfile.mjs';
import { loadEngine, extractEngine, ROOT, renameRetrying } from '../scanner/scan.mjs';

export const HISTORY_PATH = resolve(ROOT, 'data/price-history.json');
/* Points kept per symbol. The engine's scanDataHealth reads the same number
   (SCAN_HISTORY_KEEP) to say a series is at the limit; the store's test
   holds the two equal. */
export const KEEP = 2000;

/* The conflict policy. A source is named 'screen', 'paste', 'import:<file>',
   'yahoo' or 'twelvedata'; its rank is by the part before the colon. A bar
   with no recorded source (written before provenance existed) ranks with the
   screen, because most of them were read off it. */
export const SOURCE_RANK = Object.freeze({ unknown: 1, screen: 1, paste: 1, import: 2, yahoo: 2, twelvedata: 2 });
export const sourceKind = (src) => String(src || 'unknown').split(':')[0].toLowerCase();
export const sourceRank = (src) => SOURCE_RANK[sourceKind(src)] ?? 1;

/* Names the store reads that the worker's list (ENGINE_EXPORTS in
   scanner/scan.mjs) does not hand out. scanWeekOf is the key the engine
   groups a week's daily bars under; an imported week is filed under exactly
   that key, so it comes out of the same region of index.html rather than
   being written a second time here, where the two could drift apart. When
   the worker's list carries it, its copy is used and nothing more is
   evaluated. */
export const STORE_ENGINE_NAMES = Object.freeze(['scanWeekOf', 'scanMonthOf']);
export async function loadStoreEngine(htmlPath = join(ROOT, 'index.html')) {
  const E = await loadEngine(htmlPath);
  const missing = STORE_ENGINE_NAMES.filter(n => typeof E[n] !== 'function');
  if (!missing.length) return E;
  const src = extractEngine(await readFile(htmlPath, 'utf8'));
  /* isNum is the one name the region borrows (scan.mjs's prelude). A name
     the region does not define fails here with a ReferenceError naming it. */
  const more = new Function(`const isNum = (v) => typeof v === 'number' && Number.isFinite(v);\n${src}\nreturn { ${missing.join(', ')} };`)();
  return { ...E, ...more };
}

let enginePromise = null;
/* The engine, loaded once per process from the built index.html. */
export const engine = () => (enginePromise ||= loadStoreEngine());

/* ------------------------------------------------------------- the file -- */

const MAPS = ['series', 'volume', 'ohlc', 'meta', 'corrections'];
/* The timeframes held as imported bars, and the maps of one frame (keyed by
   period), in the order the file writes them. */
export const FRAMES = Object.freeze(['1W', '1M']);
export const FRAME_MAPS = Object.freeze(['series', 'ohlc', 'volume', 'meta']);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

export function emptyHistory() {
  return { schema: 2, generated: null, series: {}, volume: {}, ohlc: {}, meta: {}, corrections: {} };
}

/* History v2, read additively: a schema-1 file (series and volume only) is
   the same file with empty ohlc, meta and corrections. A file that is not
   JSON is an error, never an empty history to write over. */
export async function loadHistory(path = HISTORY_PATH) {
  if (!existsSync(path)) return emptyHistory();
  let doc;
  try { doc = JSON.parse(await readFile(path, 'utf8')); }
  catch (e) {
    throw Object.assign(new Error(`${path} is not valid JSON (${e.message}) — nothing was written over it${existsSync(`${path}.bak`) ? `; the file as it stood before the last write is ${path}.bak` : ''}`), { code: 'BAD_HISTORY' });
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw Object.assign(new Error(`${path} is not a history object`), { code: 'BAD_HISTORY' });
  const h = { ...emptyHistory(), ...doc };
  for (const k of MAPS) if (!h[k] || typeof h[k] !== 'object' || Array.isArray(h[k])) h[k] = {};
  /* Imported weeks and months, read the same way: a file without them has
     none, and a map in the wrong shape is empty, as a daily map is. A
     timeframe the store does not write is kept as it is, for history-check
     to name. */
  if ('frames' in h) {
    if (!isObj(h.frames)) h.frames = {};
    for (const tf of FRAMES) {
      if (!(tf in h.frames)) continue;
      if (!isObj(h.frames[tf])) { h.frames[tf] = {}; continue; }
      for (const [sym, f] of Object.entries(h.frames[tf])) {
        if (!isObj(f)) { delete h.frames[tf][sym]; continue; }
        for (const m of FRAME_MAPS) if (m in f && !isObj(f[m])) f[m] = {};
        if ('corrections' in f && !Array.isArray(f.corrections)) f.corrections = [];
      }
    }
  }
  h.schema = 2;
  return h;
}

/* One symbol per line inside each map, dates sorted: a 100-symbol file is a
   few hundred lines rather than a quarter of a million, and a diff of two
   versions shows which symbols moved. */
export function formatHistory(hist) {
  const sortObj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]])) : o);
  const block = (pad, entries) => `{${entries.length ? '\n' + entries.map(([key, text]) => `${pad}  ${JSON.stringify(key)}: ${text}`).join(',\n') + `\n${pad}` : ''}}`;
  /* A frame's maps one per line, under its timeframe and symbol: the same
     one-line-per-series layout as the daily maps. */
  const frame = (f) => (isObj(f)
    ? block('      ', [...FRAME_MAPS.filter(m => m in f), ...Object.keys(f).filter(m => !FRAME_MAPS.includes(m))]
        .map(m => [m, JSON.stringify(m === 'corrections' ? f[m] : sortObj(f[m]))]))
    : JSON.stringify(f));
  const frames = (v) => block('  ', Object.keys(v).sort().map(tf => [tf, isObj(v[tf])
    ? block('    ', Object.keys(v[tf]).sort().map(s => [s, frame(v[tf][s])]))
    : JSON.stringify(v[tf])]));
  const out = [];
  for (const [k, v] of Object.entries(hist)) {
    if (MAPS.includes(k) && v && typeof v === 'object') {
      const syms = Object.keys(v);
      out.push(`  ${JSON.stringify(k)}: {${syms.length ? '\n' + syms.map(s => `    ${JSON.stringify(s)}: ${JSON.stringify(k === 'corrections' ? v[s] : sortObj(v[s]))}`).join(',\n') + '\n  ' : ''}}`);
    } else if (k === 'frames' && isObj(v)) out.push(`  "frames": ${frames(v)}`);
    else out.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  }
  return `{\n${out.join(',\n')}\n}\n`;
}

/* Written beside itself and renamed over the old file — a rename within one
   volume is all or nothing — with the previous file kept as .bak. A write
   killed at any point leaves either the old file or the new one, never half
   of either. `beforeRename` exists for the test of exactly that.

   ON WINDOWS a rename over a file another process holds open fails (EPERM)
   for as long as it is held, and serve.mjs reads data/price-history.json
   for the pages: a daily history step, an import or a live.mjs run made
   while /admin/scanner was open failed at once, the history not written.
   And copyFile carries a read-only attribute onto the .bak, so once the
   .bak was read-only every later write failed on the copy. The worker's
   writeAtomic (scanner/scan.mjs) met both first; this one now does what it
   does — renameRetrying waits a reader out for a few seconds, and the .bak
   is made owner-writable before it is replaced and after it is written. */
const ownerWritable = async (p) => {
  try { const st = await stat(p); if (!(st.mode & 0o200)) await chmod(p, st.mode | 0o200); } catch { /* absent */ }
};
export async function writeAtomic(path, text, { beforeRename = null } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  try {
    if (existsSync(path)) {
      const bak = `${path}.bak`;
      await ownerWritable(bak);
      await copyFile(path, bak);
      await ownerWritable(bak);
    }
    if (beforeRename) await beforeRename();
    await renameRetrying(tmp, path);
  } catch (e) { await rm(tmp, { force: true }); throw e; }
}

export async function saveHistory(path, hist, { now = new Date().toISOString(), beforeRename = null } = {}) {
  hist.schema = 2;
  hist.generated = now;
  for (const k of MAPS) {
    hist[k] = hist[k] || {};
    for (const sym of Object.keys(hist[k])) {
      const v = hist[k][sym];
      if (!v || (Array.isArray(v) ? !v.length : !Object.keys(v).length)) delete hist[k][sym];
    }
  }
  /* An empty frame map, symbol or timeframe is not written, and a history
     with no imported weeks or months has no frames key at all: a daily-only
     file is byte for byte what it was. */
  if ('frames' in hist) {
    const empty = (v) => !v || (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length);
    if (isObj(hist.frames)) {
      for (const tf of Object.keys(hist.frames)) {
        const bySym = hist.frames[tf];
        if (!isObj(bySym)) continue;
        for (const sym of Object.keys(bySym)) {
          const f = bySym[sym];
          if (isObj(f)) for (const m of Object.keys(f)) if (empty(f[m])) delete f[m];
          if (empty(f)) delete bySym[sym];
        }
        if (empty(bySym)) delete hist.frames[tf];
      }
    }
    if (empty(hist.frames)) delete hist.frames;
  }
  hist.symbols = Object.keys(hist.series).length;
  await writeAtomic(path, formatHistory(hist), { beforeRename });
  return hist;
}

export const rejectsPathFor = (historyPath) => String(historyPath).replace(/\.json$/i, '') + '.rejects.json';

/* The rows that never reached the history, newest last, capped. */
export async function appendRejects(path, rejects, { now = new Date().toISOString(), cap = 5000 } = {}) {
  if (!rejects?.length) return 0;
  let doc = { schema: 1, rejects: [] };
  if (existsSync(path)) {
    try { const d = JSON.parse(await readFile(path, 'utf8')); if (Array.isArray(d?.rejects)) doc = { ...d, schema: 1 }; }
    catch { /* a damaged rejects file is started again; the .bak keeps the old one */ }
  }
  doc.rejects.push(...rejects.map(r => ({ at: now, ...r })));
  if (doc.rejects.length > cap) doc.rejects = doc.rejects.slice(-cap);
  doc.updatedAt = now;
  doc.note = 'Rows the price-history store refused: failed validation (the engine\'s scanValidateBar codes), or offered by a lower-ranked source than the bar already held (OUTRANKED). None of these reached data/price-history.json.';
  await writeAtomic(path, JSON.stringify(doc, null, 1) + '\n');
  return rejects.length;
}

/* ------------------------------------------------------------ the merge -- */

const num = (v) => numberCell(v);
const sameNum = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12));

function barAt(h, sym, d) {
  const c = h.series[sym]?.[d];
  if (c === undefined) return null;
  const o = Array.isArray(h.ohlc[sym]?.[d]) ? h.ohlc[sym][d] : null;
  return { close: c, open: o ? o[0] ?? null : null, high: o ? o[1] ?? null : null, low: o ? o[2] ?? null : null,
           volume: h.volume[sym]?.[d] ?? null, meta: h.meta[sym]?.[d] && typeof h.meta[sym][d] === 'object' ? h.meta[sym][d] : null };
}
const hasOhlc = (b) => b.open != null || b.high != null || b.low != null;

function writeBar(h, sym, d, b, meta) {
  (h.series[sym] ||= {})[d] = b.close;
  if (b.volume != null) (h.volume[sym] ||= {})[d] = b.volume; else if (h.volume[sym]) delete h.volume[sym][d];
  if (hasOhlc(b)) (h.ohlc[sym] ||= {})[d] = [b.open, b.high, b.low]; else if (h.ohlc[sym]) delete h.ohlc[sym][d];
  if (meta) (h.meta[sym] ||= {})[d] = meta; else if (h.meta[sym]) delete h.meta[sym][d];
}
const metaOf = (source, capturedAt) => (capturedAt ? { src: source, at: capturedAt } : { src: source });

/* Merge one symbol's rows into the history, in place.
   rows: [{ date, open?, high?, low?, close, volume? }], each already dated by
   its session. Returns what happened to every row:
     added        new dates
     filled       a held bar given fields it lacked (the same close)
     confirmed    a held bar with no provenance given this source's
     unchanged    the same bar again
     superseded   a PROVISIONAL bar replaced by a later capture
     corrected    [{date, field, from, to, src, at, prevSrc}] — also appended
                  to hist.corrections[symbol]
     outranked    rows a higher-ranked source already holds differently
     rejected     rows scanValidateBar refused, with its codes
   Running the same merge twice changes nothing the second time. */
export function mergeBars(hist, symbol, rows, opts = {}) {
  return mergeRows(hist, symbol, rows, opts, DAILY);
}

/* What a merge files a row under, and how it judges a held bar. A daily
   bar is filed under its session and is final once that session closed; an
   imported week or month (mergeFrameBars) is filed under its period's key
   and is final once the period's last expected session closed. Everything
   else — validation, the rank, corrections, the provisional rule — is the
   one merge below, so the two cannot come to follow different policies. */
const DAILY = Object.freeze({
  name: 'mergeBars',
  keyOf: (r) => r.date,
  statusOf: (E, market, d, at) => E.scanBarStatus(market, d, at),
  duplicate: 'DUPLICATE_DATE',
});

function mergeRows(hist, symbol, rows, { source, capturedAt = null, market = null, E, now = new Date().toISOString(), tolerance = 1e-6 } = {}, how = DAILY) {
  if (!E?.scanValidateBar) throw new Error(`${how.name} needs the engine (E) — validation is the engine's, not a second copy`);
  if (!source) throw new Error(`${how.name} needs a source name`);
  const sym = String(symbol);
  const out = { symbol: sym, source, market, added: 0, filled: 0, confirmed: 0, unchanged: 0, superseded: [], corrected: [], outranked: [], rejected: [] };
  const rank = sourceRank(source);
  const all = (Array.isArray(rows) ? rows : []).map(r => ({ date: typeof r?.date === 'string' ? r.date.trim() : r?.date, open: num(r?.open), high: num(r?.high), low: num(r?.low), close: num(r?.close), volume: num(r?.volume), at: r?.capturedAt || capturedAt }));
  /* Two rows for one date in one batch is the signature of a series dated
     by two conventions (the UTC day and the session day); neither is
     guessed between. The same row twice is not two readings, and there is
     nothing to guess: an export that repeats its last line, or two
     overlapping exports pasted together, used to lose that session
     entirely — both copies refused as DUPLICATE_DATE though nothing
     disagreed. An exact repeat (every field and the capture time) is read
     once. String() keeps an unreadable cell (NaN) apart from a blank one. */
  const seenRow = new Set();
  const list = all.filter(r => {
    const sig = [r.date, r.open, r.high, r.low, r.close, r.volume, r.at].map(String).join('|');
    if (seenRow.has(sig)) return false;
    seenRow.add(sig);
    return true;
  });
  /* Rows are counted, ordered and held by their key: a daily row's session,
     or an imported week's or month's period. Two rows for one period are
     the same ambiguity as two for one date. */
  const count = new Map();
  list.forEach(r => { r.key = how.keyOf(r); count.set(r.key, (count.get(r.key) || 0) + 1); });
  list.sort((a, b) => String(a.key).localeCompare(String(b.key)) || String(a.date).localeCompare(String(b.date)));
  /* FUTURE is judged against the session day that has begun at `now`, not
     the market's calendar date (sessionToday). */
  const today = sessionToday(E, market, now);
  for (const r of list) {
    const bar = { date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume };
    const codes = count.get(r.key) > 1 ? [how.duplicate] : E.scanValidateBar(bar, { market, now, today });
    if (codes.length) { out.rejected.push({ symbol: sym, date: r.date ?? null, codes, source, capturedAt: r.at || null, row: { open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume } }); continue; }
    const d = r.key, at = r.at || null;
    const held = barAt(hist, sym, d);
    if (!held) { writeBar(hist, sym, d, bar, metaOf(source, at)); out.added++; continue; }
    const heldSrc = held.meta?.src || 'unknown', heldRank = sourceRank(heldSrc);
    const heldStatus = how.statusOf(E, market, d, held.meta?.at);
    /* A reading taken while the session traded was never the session's
       value: any later capture replaces it, whatever its rank. */
    if (heldStatus === 'PROVISIONAL' && at && Date.parse(at) > Date.parse(held.meta.at)) {
      out.superseded.push({ date: d, from: held.close, to: bar.close, fromAt: held.meta.at, toAt: at, fromSrc: heldSrc });
      writeBar(hist, sym, d, bar, metaOf(source, at));
      continue;
    }
    const sameClose = sameNum(held.close, bar.close, tolerance);
    const ohlcOffered = hasOhlc(bar);
    const differs = !sameClose || (bar.volume != null && !sameNum(held.volume, bar.volume, tolerance))
      || (ohlcOffered && hasOhlc(held) && ['open', 'high', 'low'].some(k => !sameNum(held[k], bar[k], tolerance)));
    if (rank < heldRank) {
      if (differs) out.outranked.push({ symbol: sym, date: d, source, capturedAt: at, heldSource: heldSrc, held: { close: held.close, volume: held.volume }, offered: { close: bar.close, volume: bar.volume },
                                        why: `${heldSrc} ranks above ${source}; the held bar stands` });
      else out.unchanged++;
      continue;
    }
    const record = (field, from, to) => {
      const c = { date: d, field, from, to, src: source, at: at || now, prevSrc: heldSrc };
      out.corrected.push(c);
      (hist.corrections[sym] ||= []).push(c);
    };
    if (!sameClose) {
      /* The close changed: the whole bar becomes this source's reading. */
      record('close', held.close, bar.close);
      for (const k of ['open', 'high', 'low', 'volume']) if (!sameNum(held[k], bar[k], tolerance)) record(k, held[k], bar[k]);
      writeBar(hist, sym, d, bar, metaOf(source, at));
      continue;
    }
    /* The same close: fill what the held bar lacks, correct what differs. */
    const next = { ...held, close: held.close };
    let changed = false, filled = false;
    if (ohlcOffered) {
      if (!hasOhlc(held)) { next.open = bar.open; next.high = bar.high; next.low = bar.low; filled = true; }
      else for (const k of ['open', 'high', 'low']) if (!sameNum(held[k], bar[k], tolerance)) { record(k, held[k], bar[k]); next.open = bar.open; next.high = bar.high; next.low = bar.low; changed = true; }
    }
    if (bar.volume != null) {
      if (held.volume == null) { next.volume = bar.volume; filled = true; }
      else if (!sameNum(held.volume, bar.volume, tolerance)) { record('volume', held.volume, bar.volume); next.volume = bar.volume; changed = true; }
    }
    /* A merged bar is validated again: kept open/high/low from the held bar
       must still bracket the close. On the row's own session, as the row
       was: a period's key (a Monday, the 1st) need not be one. */
    if (filled || changed) {
      const again = E.scanValidateBar({ date: r.date, open: next.open, high: next.high, low: next.low, close: next.close, volume: next.volume }, { market, now, today });
      if (again.length) { out.rejected.push({ symbol: sym, date: r.date, codes: again, source, capturedAt: at, row: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }, why: 'merged with the held bar it fails validation' }); continue; }
      writeBar(hist, sym, d, next, metaOf(source, at));
      if (filled) out.filled++;
      continue;
    }
    if (!held.meta || (!held.meta.at && at)) { writeBar(hist, sym, d, next, metaOf(held.meta?.src && held.meta.src !== 'unknown' ? held.meta.src : source, at)); out.confirmed++; continue; }
    out.unchanged++;
  }
  return out;
}

/* ----------------------------------------------------- weeks and months -- */

/* A timeframe the store holds imported bars for, in the engine's spelling
   ('weekly' is 1W), or null. */
export function frameTimeframe(E, tf) {
  const t = E?.scanTimeframe ? E.scanTimeframe(tf) : String(tf ?? '');
  return FRAMES.includes(t) ? t : null;
}

/* The engine's key for the period a session day falls in — scanWeekOf, the
   Monday of its week, or scanMonthOf, the 1st of its month: the keys
   scanResample groups daily bars under, so an imported week and the week
   built from daily bars are named alike. Null for anything that is not a
   day. */
export function periodKey(E, tf, d) {
  const t = frameTimeframe(E, tf);
  if (!t || !E.scanIsDay(d)) return null;
  return t === '1M' ? E.scanMonthOf(d) : E.scanWeekOf(d);
}
export const isPeriodKey = (E, tf, pk) => pk != null && periodKey(E, tf, pk) === pk;

/* The calendar days of the period keyed `pk`, walked as scanResample walks
   them, and the market's expected sessions among them: its weekdays, since
   no exchange calendar is held — a holiday is expected, so a period is
   called final late, never early. */
export function periodDays(E, tf, pk) {
  const out = [];
  if (!isPeriodKey(E, tf, pk)) return out;
  for (let d = pk, k = 0; k < 32 && periodKey(E, tf, d) === pk; d = E.scanAddDays(d, 1), k++) out.push(d);
  return out;
}
export function periodSessions(E, tf, pk, market) {
  const cal = E.scanWeekdayCalendar(market);
  return periodDays(E, tf, pk).filter(d => E.scanIsSession(cal, d));
}
export const periodLastSession = (E, tf, pk, market) => periodSessions(E, tf, pk, market).pop() || null;

/* An imported period's status: the engine's scanBarStatus on the period's
   last expected session. FINAL when the bar was captured after that
   session closed (and settled), PROVISIONAL before — the week or month
   still trading when the export was saved — and UNKNOWN with no capture
   time. A period's own first session closing says nothing: a week
   captured on its Tuesday is Tuesday's week so far. */
export function periodStatus(E, tf, pk, market, capturedAt, heldAt = null) {
  const last = periodLastSession(E, tf, pk, market);
  return last ? E.scanBarStatus(market, last, capturedAt, heldAt) : 'UNKNOWN';
}

/* Merge one symbol's imported weekly or monthly bars into
   hist.frames[tf][symbol], in place. `rows` as mergeBars takes them, each
   dated by the session its stamp opens — TradingView stamps a period at its
   opening, so that is the period's first session. The row is validated on
   that session (a stamp that opens a Saturday is NON_SESSION_DAY, never
   moved into a week) and filed under its period's key; two rows in one
   period are both refused, DUPLICATE_PERIOD. The policy is mergeBars':
   the rank, the provisional rule on the period's status, every change by an
   equal or higher rank recorded — in the frame's own corrections, keyed by
   period, because the history's corrections are read as daily bars.
   Returns mergeBars' account with `timeframe`, and each refused row's
   `timeframe` and `period`. */
export function mergeFrameBars(hist, timeframe, symbol, rows, opts = {}) {
  const E = opts.E;
  const tf = frameTimeframe(E, timeframe);
  if (!tf) throw new Error(`mergeFrameBars holds ${FRAMES.join(' and ')} bars, not "${timeframe}"`);
  const missing = STORE_ENGINE_NAMES.filter(n => typeof E?.[n] !== 'function');
  if (missing.length) throw new Error(`mergeFrameBars needs the engine's ${missing.join(' and ')} — load it with the store's engine(), which reads them out of index.html`);
  const sym = String(symbol);
  if (!isObj(hist.frames)) hist.frames = {};
  if (!isObj(hist.frames[tf])) hist.frames[tf] = {};
  const f = isObj(hist.frames[tf][sym]) ? hist.frames[tf][sym] : {};
  /* The frame seen as a one-symbol history, so the merge writes into the
     frame's own maps. */
  const view = { corrections: { [sym]: Array.isArray(f.corrections) ? f.corrections : [] } };
  for (const m of FRAME_MAPS) view[m] = { [sym]: isObj(f[m]) ? f[m] : {} };
  /* A row dated on a day its market does not trade keeps its own date as
     its key: the engine's week of a Saturday is the Monday before, and
     filed there a stamp that opened a Saturday (Friday 17:00 New York)
     collided with that week's real bar and both were refused as
     DUPLICATE_PERIOD. It is refused alone, NON_SESSION_DAY. */
  const days = E.scanMarket(opts.market).days;
  const out = mergeRows(view, sym, rows, opts, {
    name: 'mergeFrameBars',
    keyOf: (r) => (E.scanIsDay(r.date) && days.includes(E.scanWeekday(r.date)) ? periodKey(E, tf, r.date) : r.date),
    statusOf: (eng, market, pk, at) => periodStatus(eng, tf, pk, market, at),
    duplicate: 'DUPLICATE_PERIOD',
  });
  const next = { ...f };
  for (const m of FRAME_MAPS) next[m] = view[m][sym];
  if (view.corrections[sym].length) next.corrections = view.corrections[sym]; else delete next.corrections;
  hist.frames[tf][sym] = next;
  out.timeframe = tf;
  /* A refused row's period is the one it would have been filed under; a
     stamp that opens a day the market does not trade names none, since it
     was never going into that week. */
  for (const x of out.rejected) { x.timeframe = tf; x.period = x.codes.includes('NON_SESSION_DAY') ? null : periodKey(E, tf, x.date); }
  for (const x of out.outranked) x.timeframe = tf;
  for (const x of out.superseded) x.timeframe = tf;
  return out;
}

/* Keep the newest `keep` periods of every imported frame; older ones go
   from series, ohlc, volume, meta and corrections together, as trimHistory
   does for the daily series. */
export function trimFrames(hist, keep = KEEP) {
  const byFrame = {};
  let total = 0;
  const frames = isObj(hist.frames) ? hist.frames : {};
  for (const tf of Object.keys(frames)) {
    if (!isObj(frames[tf])) continue;
    for (const [sym, f] of Object.entries(frames[tf])) {
      if (!isObj(f)) continue;
      const keys = Object.keys(isObj(f.series) ? f.series : {}).sort();
      const cutoff = keys.length > keep ? keys[keys.length - keep] : keys[0] || null;
      if (!cutoff) continue;
      let n = 0;
      for (const m of FRAME_MAPS) if (isObj(f[m])) for (const k of Object.keys(f[m])) if (k < cutoff) { delete f[m][k]; if (m === 'series') n++; }
      if (Array.isArray(f.corrections)) f.corrections = f.corrections.filter(c => !c?.date || c.date >= cutoff);
      if (n) { (byFrame[tf] ||= {})[sym] = n; total += n; }
    }
  }
  return { trimmed: total, byFrame, keep };
}

/* Keep the newest `keep` bars of every symbol; everything older goes from
   series, volume, ohlc, meta and corrections alike, so no map outlives the
   closes it describes. */
export function trimHistory(hist, keep = KEEP) {
  const bySymbol = {};
  let total = 0;
  const syms = new Set(MAPS.flatMap(k => Object.keys(hist[k] || {})));
  for (const sym of syms) {
    const dates = Object.keys(hist.series?.[sym] || {}).sort();
    const cutoff = dates.length > keep ? dates[dates.length - keep] : dates[0] || null;
    if (!cutoff) continue;
    let n = 0;
    for (const k of ['series', 'volume', 'ohlc', 'meta']) {
      const m = hist[k]?.[sym];
      if (!m) continue;
      for (const d of Object.keys(m)) if (d < cutoff) { delete m[d]; if (k === 'series') n++; }
    }
    if (Array.isArray(hist.corrections?.[sym])) hist.corrections[sym] = hist.corrections[sym].filter(c => !c?.date || c.date >= cutoff);
    if (n) { bySymbol[sym] = n; total += n; }
  }
  return { trimmed: total, bySymbol, keep };
}

/* The whole write, under a lock: load, let `fn` merge into the history,
   trim, save atomically, and write what was refused to the rejects file.
   fn returns one mergeBars (or mergeFrameBars) result or a list of them.
   `frameKeep` is the imported weeks' and months' keep, apart from the
   daily one: a daily writer asked to keep 500 sessions has said nothing
   about 1,300 weeks it did not write. */
export async function updateHistory(path, fn, { keep = KEEP, frameKeep = KEEP, now = new Date().toISOString(), rejectsPath = null, dry = false } = {}) {
  await mkdir(dirname(path), { recursive: true });
  return withLock(`${path}.lock`, async () => {
    const hist = await loadHistory(path);
    const results = [].concat((await fn(hist)) || []);
    const trim = trimHistory(hist, keep);
    trim.frames = trimFrames(hist, frameKeep);
    const refused = results.flatMap(r => [...(r.rejected || []), ...(r.outranked || []).map(o => ({ ...o, codes: ['OUTRANKED'] }))]);
    if (!dry) {
      await saveHistory(path, hist, { now });
      if (refused.length) await appendRejects(rejectsPath || rejectsPathFor(path), refused, { now });
    }
    return { hist, results, trim, refused };
  });
}

/* What a write did, in the words every writer prints. */
/* rejectsPath: where the refused rows went. It was always printed as
   data/price-history.rejects.json, even when --out wrote the history (and so
   the rejects file beside it) somewhere else. */
export function describeMerge(results, trim = null, rejectsPath = 'data/price-history.rejects.json') {
  const t = { added: 0, filled: 0, confirmed: 0, unchanged: 0, superseded: 0, corrected: 0, outranked: 0, rejected: 0 };
  for (const r of results) for (const k of Object.keys(t)) t[k] += Array.isArray(r[k]) ? r[k].length : (r[k] || 0);
  const lines = [`  new bars  : ${t.added}${t.filled ? `, ${t.filled} given open/high/low or volume they lacked` : ''}${t.confirmed ? `, ${t.confirmed} given a source` : ''}${t.unchanged ? `, ${t.unchanged} unchanged` : ''}`];
  if (t.superseded) lines.push(`  finalised : ${t.superseded} provisional bar(s) replaced by a later capture`);
  if (t.corrected) lines.push(`  corrected : ${t.corrected} field(s) changed by an equal or higher-ranked source — recorded in corrections`);
  if (t.outranked) {
    lines.push(`  outranked : ${t.outranked} row(s) not written — a higher-ranked source holds a different value:`);
    results.flatMap(r => r.outranked).slice(0, 5).forEach(o => lines.push(`              ${o.symbol}${o.timeframe ? ` ${o.timeframe}` : ''} ${o.date}: held ${o.held.close} (${o.heldSource}), offered ${o.offered.close} (${o.source})`));
  }
  if (t.rejected) {
    lines.push(`  rejected  : ${t.rejected} row(s) failed validation:`);
    /* An imported week's or month's row names its timeframe, and the
       session its stamp opened. */
    results.flatMap(r => r.rejected).slice(0, 5).forEach(x => lines.push(`              ${x.symbol}${x.timeframe ? ` ${x.timeframe}` : ''} ${x.date}: ${x.codes.join(', ')}`));
  }
  if (t.outranked || t.rejected) lines.push(`              every refused row is in ${rejectsPath}`);
  if (trim?.trimmed) lines.push(`  trimmed   : ${trim.trimmed} bar(s) older than the newest ${trim.keep} per symbol (closes, volume, open/high/low and provenance together)`);
  if (trim?.frames?.trimmed) lines.push(`  trimmed   : ${trim.frames.trimmed} imported week(s) or month(s) older than the newest ${trim.frames.keep} per symbol and timeframe (${Object.entries(trim.frames.byFrame).map(([tf, s]) => `${tf} ${Object.values(s).reduce((a, b) => a + b, 0)}`).join(', ')})`);
  return { totals: t, lines };
}

/* ---------------------------------------------------------------- cells -- */

/* A CSV's text as rows of cells, read as RFC 4180 writes it: a quoted cell
   may hold a comma, a line break or a doubled quote. history-import.mjs and
   prices.mjs split each line on every comma, so an export that quotes its
   numbers — "1,612.34", as Investing.com and any spreadsheet with grouped
   figures write them — was cut in two: a close-only file stored a close of
   1, and an OHLC row slid one column left. A byte-order mark is dropped;
   CRLF, LF and CR each end a row (inside quotes they are the cell's own);
   cells are trimmed; and a row whose every cell is blank (a blank line, or
   the ",,,," a spreadsheet leaves under a table) is no row, where it used
   to be refused as a BAD_DATE. Each row carries the physical line it
   starts on, for the rejects file. */
export function csvRows(text) {
  const s = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let cells = [], cell = '', quoted = false, wasQuoted = false, line = 1, start = 1;
  const endCell = () => { cells.push(cell.trim()); cell = ''; wasQuoted = false; };
  const endRow = () => { endCell(); if (cells.some(c => c !== '')) rows.push({ line: start, cells }); cells = []; };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; continue; }
      if (ch === '\r' && s[i + 1] === '\n') { cell += '\r\n'; i++; line++; continue; }
      if (ch === '\r' || ch === '\n') line++;
      cell += ch;
      continue;
    }
    /* A quote opens a quoted cell only at the cell's start; elsewhere it is
       a character of the cell. */
    if (ch === '"' && !wasQuoted && cell.trim() === '') { quoted = true; wasQuoted = true; cell = ''; continue; }
    if (ch === ',') { endCell(); continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      endRow(); line++; start = line;
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || wasQuoted || cells.length) endRow();
  return rows;
}

/* One number cell. Blank is no reading (null): Number('') is 0, and a blank
   volume was once written as a day with no trades. A comma is a thousands
   separator only in groups of three ("1,612.34"); stripping every comma,
   as the readers did, turned a decimal comma ("10,5") into 105 — so a cell
   with a comma in any other place is NaN, which the store refuses, rather
   than a number ten times too large. Spaces (a thin-space grouping) are
   dropped. A number already typed passes through. */
export function numberCell(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return raw;
  const s = String(raw).replace(/\s/g, '');
  if (s === '') return null;
  if (s.includes(',')) return /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s) ? Number(s.replace(/,/g, '')) : NaN;
  return Number(s);
}

/* ---------------------------------------------------------------- dates -- */

const DTF = new Map();
/* The calendar date at an instant in a time zone. */
export function dateInZone(instant, tz = 'UTC') {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) return null;
  let f = DTF.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); DTF.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/* A calendar day, or false. A month 13 or a day 32 is not a Date that rolls
   over (as 30 February does) but an Invalid Date, whose toISOString() throws
   a RangeError: one such cell — "2026-13-01", or a day-first "32/01/2026" —
   crashed the whole import ("FAILED — Invalid time value", nothing written)
   and prices.mjs with it, where that one row is refused as BAD_DATE. */
const realDay = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === d;
};

/* The wall-clock minute of the day at an instant in a time zone. */
const DTF_MIN = new Map();
function minuteInZone(ms, tz) {
  let f = DTF_MIN.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }); DTF_MIN.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return (Number(p.hour) % 24) * 60 + Number(p.minute);
}
const hhmm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
const nextDay = (d) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/* The minute, in its own zone, at which a market's session day opens on the
   EVENING BEFORE — or null for a market whose day opens on the day itself.
   `session` is the market's row in the engine's SCAN_MARKETS ({ tz, open,
   close }). A row with no open trades the whole day up to its close: FX's
   17:00 New York close makes its day run from 17:00 the evening before, the
   day OANDA's gold and every currency pair trade. An open later than the
   close is an evening open too. An exchange that opens and closes on one
   day (New York 09:30–16:00), and a day that closes at midnight (crypto,
   and the default market), open on the day itself. */
export function eveningOpen(session) {
  if (!session || typeof session !== 'object') return null;
  const close = hhmm(session.close || '24:00');
  if (session.open) { const open = hhmm(session.open); return open > close ? open : null; }
  return close < 1440 ? close : null;
}

/* A daily bar's epoch. Exports disagree about what instant stands for a
   session: some write midnight UTC of the session date, some midnight in the
   exchange's zone, some the session's open. Midnight UTC exactly is read as
   a UTC date; anything else is dated in the exchange's zone. The two readings
   differ only for a zone far from UTC, and there only this rule gets both
   conventions right.
   A SESSION THAT OPENS THE EVENING BEFORE. TradingView stamps a daily bar
   at the instant its session OPENS, and OANDA's gold day opens at 17:00 New
   York the evening before: Monday's bar is stamped Sunday 21:00 UTC, and
   dated in the zone it was a Sunday — refused as NON_SESSION_DAY, and every
   Tuesday to Friday filed a day early, the shift history-check reports on
   the currency pairs. Given the market's session, a stamp at or after the
   hour its day opens the evening before is the NEXT day's session: the
   session the bar closes. A stamp before that hour (a vendor's local
   midnight) is its own day, as before. A stamp that opens a day the market
   does not trade (Friday 17:00) is dated that day and refused as
   NON_SESSION_DAY, never moved onto Monday's bar. An exchange's stamp at its
   own open, and crypto's midnight UTC, are their own day under either
   rule. */
export function epochDate(ms, tz = 'UTC', session = null) {
  if (!Number.isFinite(ms)) return null;
  if (ms % 86400000 === 0) return new Date(ms).toISOString().slice(0, 10);
  const day = dateInZone(ms, tz);
  const opens = eveningOpen(session);
  return opens != null && minuteInZone(ms, tz) >= opens ? nextDay(day) : day;
}

/* One date cell from an import. ISO first; a 10- or 13-digit epoch through
   epochDate; a date-time with a zone through epochDate too (the exchange's
   zone, midnight UTC exactly its UTC date); then the
   day-first and month-first forms, where — exactly as the browser's paste
   parser (src/js/25-universe.js parseCloses) — a day above 12 settles the
   order and anything else is refused as ambiguous: 03/04/2026 is 3 April in
   Kuala Lumpur and 4 March in New York, and picking one silently shifts a
   series by a month. Never `new Date(text)`, which guesses month-first and
   then shifts the result by the machine's own zone. `session`, the market's
   SCAN_MARKETS row, dates an instant by the session it opens (epochDate);
   without it, an instant is its day in `tz`. */
export function parseDateCell(raw, { tz = 'UTC', session = null } = {}) {
  const s = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
  if (/^\d{10}$/.test(s)) return { date: epochDate(Number(s) * 1000, tz, session) };
  if (/^\d{13}$/.test(s)) return { date: epochDate(Number(s), tz, session) };
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (iso) {
    const [, day, time, zone] = iso;
    if (!realDay(day)) return { error: 'BAD_DATE', why: `"${s}" is not a real day` };
    if (time) {
      const z = !zone ? 'Z' : zone.toUpperCase() === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
      const ms = Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}${z}`);
      /* A time of day the clock does not have ("10:60", "25:00") or a zone
         past ±23:59 is no instant: Date.parse gives NaN, and the cell came
         back as { date: null } — no error, so prices.mjs accepted the price
         undated and the import's rejects file lost the cell as written. It
         is refused as the unreal day is. */
      if (!Number.isFinite(ms)) return { error: 'BAD_DATE', why: `"${s}" is not a real time of day` };
      /* An instant, so it is dated as an epoch is (epochDate): exactly
         midnight UTC is that UTC date. Dated in the zone alone, the instant
         an epoch cell dated 2026-04-13 was 2026-04-12 when written
         "2026-04-13T00:00:00Z" — a whole UTC-stamped export for New York
         or São Paulo a day early, its Mondays on Sundays. A time with no
         zone is no instant; the day it is written under stands. */
      if (zone) return { date: epochDate(ms, tz, session) };
    }
    return { date: day };
  }
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, a, b, y] = m;
    let day = null;
    if (Number(a) > 12) day = `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
    else if (Number(b) > 12) day = `${y}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
    else return { error: 'AMBIGUOUS_DATE', why: `ambiguous date "${s}" — day and month could be either way round; use YYYY-MM-DD` };
    return realDay(day) ? { date: day } : { error: 'BAD_DATE', why: `"${s}" is not a real day` };
  }
  return { error: 'BAD_DATE', why: `date "${s}" not recognised — use YYYY-MM-DD` };
}

/* The session a reading taken at `instant` belongs to, in the market's own
   zone (the engine's SCAN_MARKETS). A reading taken while a session trades
   — from its open to its close plus settle; a market with no open is taken
   to trade the whole day before its close — is that session's, and
   PROVISIONAL. Otherwise it is the last session that has closed, and FINAL.
   So a screen read at 18:30 in Kuala Lumpur (10:30 UTC) dates Bursa to that
   day, New York to its previous session, and London to a session still
   trading. */
export function readingSession(E, market, instant) {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) return { date: null, status: null, inSession: false };
  const M = E.scanMarket(market);
  const local = E.scanLocalDate(market, ms);
  for (const k of [-1, 0, 1]) {
    const day = E.scanAddDays(local, k);
    if (!M.days.includes(E.scanWeekday(day))) continue;
    const end = E.scanSessionEnd(market, day);
    const [oh, om] = String(M.open || '').split(':').map(Number);
    const start = M.open ? E.scanZonedInstant(day, oh * 60 + (om || 0), M.tz) : end - 86400000;
    if (ms >= start && ms < end) return { date: day, status: 'PROVISIONAL', inSession: true };
  }
  return { date: E.scanSessionDateAt(market, ms), status: 'FINAL', inSession: false };
}

/* The latest session day that has begun at `now`: what "today" means for
   the store's FUTURE check. The engine's scanValidateBar, given only `now`,
   takes the market's calendar date — but a market whose day opens the
   evening before is trading tomorrow's session from that hour. At 18:00 New
   York on a Sunday (06:00 on Monday in Kuala Lumpur) readingSession dates a
   currency pair to Monday, and the store refused that Monday bar as FUTURE:
   the in-progress row of a TradingView export made then was lost, and so
   was a screen reading. From the hour the day opens, today is the next
   day; otherwise it is the calendar date in the market's zone, as before. */
export function sessionToday(E, market, now) {
  const ms = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(ms)) return null;
  const M = E.scanMarket(market);
  const local = dateInZone(ms, M.tz);
  const opens = eveningOpen(M);
  return opens != null && minuteInZone(ms, M.tz) >= opens ? nextDay(local) : local;
}

/* The instrument registry, and a symbol's market from it (null without a
   row, which the engine reads as its _default market). */
export async function loadInstruments(path = resolve(ROOT, 'data/instruments.json')) {
  try { const r = JSON.parse(await readFile(path, 'utf8')); return Array.isArray(r) ? r : (r?.instruments || []); }
  catch { return []; }
}
export function marketOf(symbol, instruments) {
  const up = String(symbol).toUpperCase();
  const hit = (instruments || []).find(i => String(i?.symbol).toUpperCase() === up)
    || (instruments || []).find(i => (i?.aliases || []).some(a => String(a).toUpperCase() === up));
  return hit?.market || null;
}
