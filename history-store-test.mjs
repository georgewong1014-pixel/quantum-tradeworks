#!/usr/bin/env node
/**
 * history-store-test.mjs — the price-history store, on temporary files.
 *
 *   node history-store-test.mjs        (run node build.mjs first: the store
 *                                       validates with the engine sliced out
 *                                       of index.html)
 *
 * The store is the one writer of data/price-history.json. Before it, three
 * writers kept three policies: 600 imported bars plus one daily run left 500
 * closes and 600 volumes; a screen reading silently replaced an imported
 * close; a Yahoo bar for Auckland was dated a day early because the date was
 * the UTC day of its timestamp; '03/04/2026' was read month-first and then
 * shifted a day by this machine's own zone. Each of those is asked here
 * directly, with the answer worked out beforehand. No network, no repository
 * data: every file is a temporary copy.
 */

import { readFile, writeFile, mkdir, rm, utimes } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROOT } from './scanner/scan.mjs';
import { KEEP, SOURCE_RANK, sourceRank, emptyHistory, loadHistory, saveHistory, mergeBars, trimHistory, updateHistory, appendRejects,
         rejectsPathFor, parseDateCell, epochDate, dateInZone, readingSession, marketOf, describeMerge, engine } from './ingest/history-store.mjs';
import { parseCsv } from './ingest/history-import.mjs';
import { yahooProvider, twelveDataProvider } from './ingest/providers.mjs';

const run = promisify(execFile);
let passes = 0, failures = 0;
const fail = (msg, detail) => { failures++; console.error(`FAIL  ${msg}`); if (detail !== undefined) console.error(`      ${JSON.stringify(detail)}`); };
const ok = (msg) => { passes++; console.log(`ok    ${msg}`); };
const check = (cond, msg, detail) => (cond ? ok(msg) : fail(msg, detail));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let E;
try { E = await engine(); ok('the store loads the engine out of index.html, as the worker does'); }
catch (e) { fail('the engine loads from index.html (run node build.mjs first)', e.message); console.log(`\n1 failed, ${passes} passed`); process.exit(1); }

const dir = join(tmpdir(), `qt-history-store-${process.pid}`);
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
const NOW = '2026-09-28T12:00:00Z';

/* Weekdays from a Monday, as sessions fall. */
function weekdays(from, n) {
  const out = []; let d = new Date(`${from}T00:00:00Z`);
  while (out.length < n) { const w = d.getUTCDay(); if (w > 0 && w < 6) out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
  return out;
}
const snapshot = (h) => JSON.stringify({ series: h.series, volume: h.volume, ohlc: h.ohlc, meta: h.meta, corrections: h.corrections });

try {
  /* ------------------------------------------------------ one number, one keep -- */
  const engSrc = readFileSync(join(ROOT, 'src/js/24-market-engine.js'), 'utf8');
  check(KEEP === 2000 && new RegExp(`const SCAN_HISTORY_KEEP = ${KEEP};`).test(engSrc) && /atKeepLimit: keys\.length >= SCAN_HISTORY_KEEP/.test(engSrc),
    `the store keeps ${KEEP} bars per symbol, and the engine's data-health "at the keep limit" reads the same number`);
  check(SOURCE_RANK.import > SOURCE_RANK.screen && SOURCE_RANK.yahoo > SOURCE_RANK.screen && sourceRank('import:KLSE.csv') === SOURCE_RANK.import && sourceRank(undefined) === SOURCE_RANK.screen,
    'the source rank is explicit: an import or a provider outranks the screen; a bar with no recorded source ranks with the screen');

  /* ------------------------------------------------------------- validation -- */
  {
    const h = emptyHistory();
    const r = mergeBars(h, 'X', [
      { date: '2026-09-21', open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { date: '2026-09-22', close: 11.5 },
      { date: '2026-09-23', open: 11, high: 9, low: 10, close: 11 },        /* high below low and the close */
      { date: '2026-09-24', close: -1 },
      { date: '2026-9-24', close: 1 },
      { date: '2026-09-26', close: 1 },                                     /* a Saturday */
      { date: '2026-10-05', close: 1 },                                     /* after the clock */
    ], { source: 'import:x.csv', capturedAt: NOW, market: 'US', E, now: NOW });
    const codes = Object.fromEntries(r.rejected.map(x => [x.date, x.codes]));
    check(r.added === 2 && codes['2026-09-23']?.includes('HIGH_BELOW') && codes['2026-09-23']?.includes('LOW_ABOVE') && codes['2026-09-24']?.[0] === 'NEG_PRICE'
      && codes['2026-9-24']?.[0] === 'BAD_DATE' && codes['2026-09-26']?.includes('NON_SESSION_DAY') && codes['2026-10-05']?.includes('FUTURE'),
      'every row is validated by the engine\'s scanValidateBar: HIGH_BELOW, LOW_ABOVE, NEG_PRICE, BAD_DATE, NON_SESSION_DAY and FUTURE are refused with their codes', codes);
    check(h.series.X['2026-09-23'] === undefined && !Object.keys(h.series.X).some(d => d === '2026-9-24' || d === '2026-09-26'),
      'a refused row never reaches the history');
    check(same(h.ohlc.X['2026-09-21'], [10, 12, 9]) && h.volume.X['2026-09-21'] === 100 && h.ohlc.X['2026-09-22'] === undefined && same(h.meta.X['2026-09-21'], { src: 'import:x.csv', at: NOW }),
      'open, high and low are kept as [o, h, l]; a close-only row writes no ohlc entry; every bar records its source and capture time');
    const dup = mergeBars(emptyHistory(), 'X', [{ date: '2026-09-21', close: 1 }, { date: '2026-09-21', close: 2 }], { source: 'yahoo', market: 'US', E, now: NOW });
    check(dup.added === 0 && dup.rejected.length === 2 && dup.rejected.every(x => x.codes[0] === 'DUPLICATE_DATE'), 'two rows for one date in one batch are both refused (DUPLICATE_DATE), not guessed between');
    const nul = emptyHistory();
    mergeBars(nul, 'P', [{ date: '2026-09-21', open: null, high: null, low: null, close: 5, volume: null }], { source: 'yahoo', capturedAt: NOW, market: 'US', E, now: NOW });
    check(nul.ohlc.P === undefined && nul.volume.P === undefined && nul.series.P['2026-09-21'] === 5 && !E.scanBars(nul, 'P', { market: 'US' }).hasOHLC,
      'a provider row with open, high, low and volume null keeps the bar with them absent — not zero, and not the close standing in');
  }

  /* ------------------------------------------------------------- idempotence -- */
  {
    const h = emptyHistory();
    const rows = weekdays('2026-06-01', 30).map((d, i) => ({ date: d, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 1000 + i }));
    mergeBars(h, 'I', rows, { source: 'import:i.csv', capturedAt: NOW, market: 'US', E, now: NOW });
    const before = snapshot(h);
    const again = mergeBars(h, 'I', rows, { source: 'import:i.csv', capturedAt: NOW, market: 'US', E, now: NOW });
    check(snapshot(h) === before && again.unchanged === 30 && again.added === 0 && !again.corrected.length, 'the same merge twice changes nothing the second time');
  }

  /* ---------------------------------------------------------- conflict policy -- */
  {
    const h = emptyHistory();
    mergeBars(h, 'MAYBANK', [{ date: '2026-09-25', close: 10.2, volume: 5000 }], { source: 'import:1155.csv', capturedAt: '2026-09-25T10:00:00Z', market: 'MY', E, now: NOW });
    const scr = mergeBars(h, 'MAYBANK', [{ date: '2026-09-25', close: 10.8 }], { source: 'screen', capturedAt: '2026-09-25T10:30:00Z', market: 'MY', E, now: NOW });
    check(h.series.MAYBANK['2026-09-25'] === 10.2 && scr.outranked.length === 1 && scr.outranked[0].heldSource === 'import:1155.csv' && !h.corrections.MAYBANK,
      'a screen reading does not replace an imported close; the attempt is reported as outranked, not written', scr.outranked);
    const sameScreen = mergeBars(h, 'MAYBANK', [{ date: '2026-09-25', close: 10.2 }], { source: 'screen', capturedAt: '2026-09-25T10:30:00Z', market: 'MY', E, now: NOW });
    check(sameScreen.unchanged === 1 && !sameScreen.outranked.length, 'a screen reading that agrees with the import is simply unchanged');
    const imp2 = mergeBars(h, 'MAYBANK', [{ date: '2026-09-25', close: 10.25, volume: 5100 }], { source: 'import:1155-v2.csv', capturedAt: '2026-09-26T01:00:00Z', market: 'MY', E, now: NOW });
    const corr = h.corrections.MAYBANK || [];
    check(h.series.MAYBANK['2026-09-25'] === 10.25 && imp2.corrected.length === 2 && corr.some(c => c.field === 'close' && c.from === 10.2 && c.to === 10.25 && c.prevSrc === 'import:1155.csv')
      && corr.some(c => c.field === 'volume' && c.from === 5000 && c.to === 5100),
      'an import that disagrees with an equal-ranked source replaces the bar and the change is recorded in corrections (field, from, to, source)', corr);
    const bars = E.scanBars(h, 'MAYBANK', { market: 'MY' });
    check(bars.status[bars.dates.indexOf('2026-09-25')] === 'CORRECTED', 'the engine reads a recorded correction as a CORRECTED bar');

    /* A legacy bar — no provenance — is corrected by an import and confirmed by an equal reading. */
    const L = { ...emptyHistory(), series: { OLD: { '2026-09-24': 4.5, '2026-09-25': 4.6 } } };
    mergeBars(L, 'OLD', [{ date: '2026-09-24', close: 4.5 }, { date: '2026-09-25', close: 4.7 }], { source: 'yahoo', capturedAt: '2026-09-26T00:00:00Z', market: 'MY', E, now: NOW });
    check(L.series.OLD['2026-09-25'] === 4.7 && L.corrections.OLD?.[0]?.prevSrc === 'unknown' && same(L.meta.OLD['2026-09-24'], { src: 'yahoo', at: '2026-09-26T00:00:00Z' }),
      'a bar written before provenance existed ranks with the screen: a provider corrects it (recorded) and an agreeing reading gives it a source');

    /* Filling and whole-bar replacement. */
    const F = emptyHistory();
    mergeBars(F, 'F', [{ date: '2026-09-24', close: 20 }], { source: 'import:f.csv', capturedAt: '2026-09-25T00:00:00Z', market: 'US', E, now: NOW });
    const fill = mergeBars(F, 'F', [{ date: '2026-09-24', open: 19, high: 21, low: 18.5, close: 20, volume: 700 }], { source: 'yahoo', capturedAt: '2026-09-25T01:00:00Z', market: 'US', E, now: NOW });
    check(fill.filled === 1 && !fill.corrected.length && same(F.ohlc.F['2026-09-24'], [19, 21, 18.5]) && F.volume.F['2026-09-24'] === 700,
      'the same close from an equal source fills in the open, high, low and volume the held bar lacked — not a correction');
    mergeBars(F, 'F', [{ date: '2026-09-24', close: 20.4 }], { source: 'import:f2.csv', capturedAt: '2026-09-26T01:00:00Z', market: 'US', E, now: NOW });
    check(F.series.F['2026-09-24'] === 20.4 && F.ohlc.F['2026-09-24'] === undefined && F.volume.F['2026-09-24'] === undefined
      && ['close', 'open', 'high', 'low', 'volume'].every(k => (F.corrections.F || []).some(c => c.field === k)),
      'a changed close makes the whole bar the new source\'s reading: the old open/high/low and volume go (each recorded), never left beside a close they do not describe');

    /* Provisional superseded, whatever the rank. */
    const P = emptyHistory();
    mergeBars(P, 'AAPL', [{ date: '2026-09-28', open: 250, high: 252, low: 249, close: 251, volume: 9e6 }], { source: 'yahoo', capturedAt: '2026-09-28T17:00:00Z', market: 'US', E, now: '2026-09-28T17:00:00Z' });
    const pb = E.scanBars(P, 'AAPL', { market: 'US' });
    check(pb.status[0] === 'PROVISIONAL', 'a bar fetched while its session traded (13:00 New York) is PROVISIONAL');
    const sup = mergeBars(P, 'AAPL', [{ date: '2026-09-28', close: 253.1 }], { source: 'screen', capturedAt: '2026-09-28T22:00:00Z', market: 'US', E, now: '2026-09-28T22:00:00Z' });
    const pb2 = E.scanBars(P, 'AAPL', { market: 'US' });
    check(sup.superseded.length === 1 && P.series.AAPL['2026-09-28'] === 253.1 && !P.corrections.AAPL && pb2.status[0] === 'FINAL',
      'a PROVISIONAL bar is replaced by a later capture after the close, even one from the screen, and that is not a correction: the bar is then FINAL', { sup: sup.superseded, status: pb2.status });
  }

  /* --------------------------------------------------------------- trimming -- */
  {
    const h = emptyHistory();
    const days = weekdays('2024-01-01', 600);
    mergeBars(h, 'T', days.map((d, i) => ({ date: d, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000 + i })), { source: 'import:t.csv', capturedAt: NOW, market: 'US', E, now: NOW });
    const cap = '2026-04-20';
    mergeBars(h, 'T', [{ date: cap, close: 900 }], { source: 'screen', capturedAt: '2026-04-20T21:00:00Z', market: 'US', E, now: NOW });
    const t1 = trimHistory(h);
    check(t1.trimmed === 0 && Object.keys(h.series.T).length === 601 && Object.keys(h.volume.T).length === 600 && Object.keys(h.ohlc.T).length === 600 && Object.keys(h.meta.T).length === 601,
      '600 imported bars plus one daily capture hold 601 closes, 600 volumes and 600 open/high/low — the daily run no longer trims to 500');
    h.corrections.T = [{ date: days[0], field: 'close', from: 1, to: 2 }, { date: cap, field: 'close', from: 3, to: 4 }];
    const t2 = trimHistory(h, 500);
    const keys = (m) => Object.keys(m).sort();
    const cutoff = keys(h.series.T)[0];
    check(t2.trimmed === 101 && keys(h.series.T).length === 500 && keys(h.volume.T).every(d => d >= cutoff) && keys(h.ohlc.T).every(d => d >= cutoff)
      && same(keys(h.meta.T), keys(h.series.T)) && Object.keys(h.volume.T).length === 499 && h.corrections.T.length === 1 && h.corrections.T[0].date === cap,
      'trimming to 500 drops series, volume, open/high/low, provenance and corrections together — no map outlives its closes', { trimmed: t2.trimmed, vol: Object.keys(h.volume.T).length });
  }

  /* ----------------------------------------------------- atomic write, .bak -- */
  {
    const p = join(dir, 'atomic.json');
    const h = emptyHistory();
    mergeBars(h, 'A', [{ date: '2026-09-21', close: 1 }], { source: 'screen', market: 'US', E, now: NOW });
    await saveHistory(p, h, { now: '2026-09-21T00:00:00Z' });
    const first = await readFile(p, 'utf8');
    mergeBars(h, 'A', [{ date: '2026-09-22', close: 2 }], { source: 'screen', market: 'US', E, now: NOW });
    await saveHistory(p, h, { now: '2026-09-22T00:00:00Z' });
    check((await readFile(`${p}.bak`, 'utf8')) === first && JSON.parse(await readFile(p, 'utf8')).series.A['2026-09-22'] === 2,
      'every save keeps the previous file as .bak');
    const second = await readFile(p, 'utf8');
    mergeBars(h, 'A', [{ date: '2026-09-23', close: 3 }], { source: 'screen', market: 'US', E, now: NOW });
    let threw = false;
    try { await saveHistory(p, h, { beforeRename: () => { throw new Error('killed between the write and the rename'); } }); } catch { threw = true; }
    check(threw && (await readFile(p, 'utf8')) === second && (await readFile(`${p}.bak`, 'utf8')) === second && !existsSync(`${p}.tmp`),
      'a write killed before its rename leaves the history exactly as it was, the .bak intact and no .tmp behind');
    const doc = JSON.parse(second);
    check(doc.schema === 2 && doc.symbols === 1 && ['series', 'volume', 'ohlc', 'meta', 'corrections'].every(k => k in doc) && second.split('\n').length < 30,
      'the file is history v2 — series, volume, ohlc, meta, corrections — one symbol per line');
    await writeFile(join(dir, 'broken.json'), '{"series": {');
    let bad = null; try { await loadHistory(join(dir, 'broken.json')); } catch (e) { bad = e; }
    let wrote = true; try { await updateHistory(join(dir, 'broken.json'), () => []); } catch { wrote = false; }
    check(bad?.code === 'BAD_HISTORY' && !wrote && (await readFile(join(dir, 'broken.json'), 'utf8')) === '{"series": {',
      'a history that is not JSON is an error, never an empty history written over it');
  }

  /* --------------------------------------------------------- the rejects file -- */
  {
    const p = join(dir, 'rej-history.json');
    await updateHistory(p, (hist) => [mergeBars(hist, 'R', [{ date: '2026-09-21', close: 5 }], { source: 'import:r.csv', capturedAt: NOW, market: 'US', E, now: NOW })], { now: NOW });
    const res = await updateHistory(p, (hist) => [mergeBars(hist, 'R', [{ date: '2026-09-21', close: 6 }, { date: '2026-09-22', open: 5, high: 4, low: 6, close: 5 }], { source: 'screen', capturedAt: NOW, market: 'US', E, now: NOW })], { now: NOW });
    const rp = rejectsPathFor(p);
    const rej = existsSync(rp) ? JSON.parse(await readFile(rp, 'utf8')) : null;
    check(rp.endsWith('rej-history.rejects.json') && rej?.rejects?.length === 2 && rej.rejects.some(x => x.codes.includes('OUTRANKED') && x.date === '2026-09-21')
      && rej.rejects.some(x => x.codes.includes('HIGH_BELOW')) && res.refused.length === 2 && JSON.parse(await readFile(p, 'utf8')).series.R['2026-09-22'] === undefined,
      'refused rows — a failed validation and an outranked reading — go to the rejects file beside the history, with their codes, and not into it', rej?.rejects);
    const d = describeMerge(res.results, res.trim);
    check(d.totals.outranked === 1 && d.totals.rejected === 1 && d.lines.some(l => /rejects\.json/.test(l)), 'every writer prints the same account of what was refused and where it went');
    const capP = join(dir, 'cap.rejects.json');
    await appendRejects(capP, Array.from({ length: 30 }, (_, i) => ({ symbol: 'C', date: String(i), codes: ['BAD_DATE'] })), { cap: 20 });
    check(JSON.parse(await readFile(capP, 'utf8')).rejects.length === 20, 'the rejects file is capped at its newest rows');
  }

  /* ---------------------------------------------------------------- dates -- */
  {
    check(parseDateCell('03/04/2026').error === 'AMBIGUOUS_DATE' && parseDateCell('13/04/2026').date === '2026-04-13' && parseDateCell('04/13/2026').date === '2026-04-13'
      && parseDateCell('2026-04-13').date === '2026-04-13' && parseDateCell('31/02/2026').error === 'BAD_DATE' && parseDateCell('2026-02-30').error === 'BAD_DATE' && parseDateCell('last Tuesday').error === 'BAD_DATE',
      '"03/04/2026" is refused as ambiguous; "13/04/2026" and "04/13/2026" are 13 April; impossible days are refused');
    const nzEpoch = Date.parse('2026-05-25T22:00:00Z');
    check(parseDateCell(String(nzEpoch / 1000), { tz: 'Pacific/Auckland' }).date === '2026-05-26' && parseDateCell(String(nzEpoch), { tz: 'Pacific/Auckland' }).date === '2026-05-26'
      && E.scanWeekday('2026-05-26') === 2,
      'an epoch of 2026-05-25T22:00Z on the New Zealand exchange is the session of Tuesday 26 May (10- and 13-digit)');
    const utcMid = Date.UTC(2026, 4, 25) / 1000;
    check(epochDate(utcMid * 1000, 'Pacific/Auckland') === '2026-05-25' && epochDate(utcMid * 1000, 'America/New_York') === '2026-05-25'
      && epochDate(Date.parse('2026-05-25T04:00:00Z'), 'America/New_York') === '2026-05-25',
      'an epoch at exactly midnight UTC is read as that UTC date in any zone; one at local midnight in New York as New York\'s date');
    check(parseDateCell('2026-05-25T22:00:00Z', { tz: 'Pacific/Auckland' }).date === '2026-05-26' && parseDateCell('2026-05-25 22:00', { tz: 'Pacific/Auckland' }).date === '2026-05-25',
      'a date-time with a zone is dated in the exchange\'s zone; one without a zone is read as the wall-clock date written');

    /* The browser's paste parser, sliced out of the page source: the same dates accepted and refused. */
    const uni = readFileSync(join(ROOT, 'src/js/25-universe.js'), 'utf8');
    const a = uni.indexOf('function parseCloses(');
    const b = uni.indexOf('\n}\n', a);
    const parseCloses = new Function(`${uni.slice(a, b + 2)}; return parseCloses;`)();
    const cells = ['2026-04-13', '13/04/2026', '04/13/2026', '03/04/2026', '12/12/2026', '1/2/2026', '25-12-2026', '2026/04/13', '13.04.2026', 'junk'];
    const browser = cells.map(c => { const r = parseCloses(`X,${c},1`); return r.rejected.length ? 'refused' : Object.keys(r.series.X || {})[0]; });
    const store = cells.map(c => { const r = parseDateCell(c); return r.error ? 'refused' : r.date; });
    check(same(browser, store), 'the import accepts and refuses exactly the dates the browser\'s paste parser does, and reads each the same way', { browser, store });

    /* Under two machine zones: the old import read "03/04/2026" as 3 March and, in Kuala Lumpur, shifted it to 2 March. */
    const probe = `import { parseDateCell } from ${JSON.stringify(pathToFileURL(join(ROOT, 'ingest/history-store.mjs')).href)};
      console.log(JSON.stringify(['03/04/2026', '13/04/2026', '2026-04-13', '1779746400', '2026-05-25T22:00:00Z'].map(c => { const r = parseDateCell(c, { tz: 'Pacific/Auckland' }); return r.date || r.error; })));`;
    const zones = {};
    for (const tz of ['Asia/Kuala_Lumpur', 'America/New_York']) {
      const { stdout } = await run(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, TZ: tz } });
      zones[tz] = JSON.parse(stdout.trim());
    }
    const want = ['AMBIGUOUS_DATE', '2026-04-13', '2026-04-13', '2026-05-26', '2026-05-26'];
    check(same(zones['Asia/Kuala_Lumpur'], want) && same(zones['America/New_York'], want), 'the same answers with this machine set to Kuala Lumpur and to New York', zones);
  }

  /* ------------------------------------------------- a reading's session -- */
  {
    const inst = JSON.parse(readFileSync(join(ROOT, 'data/instruments.json'), 'utf8')).instruments;
    const at = '2026-09-28T10:30:00Z';                                   /* 18:30 in Kuala Lumpur, a Monday */
    const rs = (sym) => readingSession(E, marketOf(sym, inst), at);
    check(marketOf('1155', inst) === 'MY' && same(rs('1155'), { date: '2026-09-28', status: 'FINAL', inSession: false })
      && same(readingSession(E, 'US', at), { date: '2026-09-25', status: 'FINAL', inSession: false }),
      'a screen read at 18:30 Kuala Lumpur dates Maybank (1155) to that Monday and a US close to Friday 25 September — both final');
    check(rs('NZ50').date === '2026-09-28' && rs('NZ50').status === 'FINAL' && rs('NIKKEI').date === '2026-09-28' && rs('UK100').date === '2026-09-28' && rs('UK100').status === 'PROVISIONAL',
      'the same capture dates Auckland and Tokyo to their closed Monday sessions, and London to a Monday still trading (PROVISIONAL)',
      { nz: rs('NZ50'), jp: rs('NIKKEI'), gb: rs('UK100') });
    check(readingSession(E, 'MY', '2026-09-28T08:30:00Z').status === 'PROVISIONAL' && readingSession(E, 'MY', '2026-09-28T10:00:00Z').status === 'FINAL'
      && E.scanBarStatus('MY', '2026-09-28', '2026-09-28T08:30:00Z') === 'PROVISIONAL' && E.scanBarStatus('MY', '2026-09-28', '2026-09-28T10:00:00Z') === 'FINAL',
      'Bursa: 16:30 local is in the session (PROVISIONAL); 18:00 is after the close and settle (FINAL) — the store and the engine agree');
    check(readingSession(E, 'US', '2026-09-28T19:00:00Z').status === 'PROVISIONAL' && readingSession(E, 'US', '2026-09-28T20:31:00Z').status === 'FINAL'
      && readingSession(E, 'US', '2026-11-02T20:31:00Z').status === 'PROVISIONAL' && readingSession(E, 'US', '2026-11-02T21:31:00Z').status === 'FINAL'
      && readingSession(E, 'US', '2026-09-28T12:00:00Z').date === '2026-09-25',
      'New York: 20:31 UTC is final in daylight time and still in the session in standard time (2 November); before the open is Friday\'s close');
    check(same(readingSession(E, 'FX', '2026-09-27T22:00:00Z'), { date: '2026-09-28', status: 'PROVISIONAL', inSession: true }) && readingSession(E, 'CRYPTO', '2026-09-27T10:00:00Z').date === '2026-09-27'
      && same(readingSession(E, 'MY', '2026-09-26T10:00:00Z'), { date: '2026-09-25', status: 'FINAL', inSession: false }),
      'currency pairs on a Sunday evening in New York are Monday\'s session; crypto trades on Sunday; Bursa on a Saturday is Friday\'s close');
    /* End to end: captured readings, read back by the engine. */
    const h = emptyHistory();
    mergeBars(h, '1155', [{ date: '2026-09-28', close: 10.1 }], { source: 'screen', capturedAt: at, market: 'MY', E, now: at });
    mergeBars(h, 'UK100', [{ date: '2026-09-28', close: 9300 }], { source: 'screen', capturedAt: at, market: 'GB', E, now: at });
    check(E.scanBars(h, '1155', { market: 'MY' }).status[0] === 'FINAL' && E.scanBars(h, 'UK100', { market: 'GB' }).status[0] === 'PROVISIONAL',
      'the capture time is kept per bar, so the engine calls the Bursa close FINAL and the London reading PROVISIONAL');
  }

  /* ------------------------------------------------------------- providers -- */
  {
    const realFetch = globalThis.fetch;
    const nz = Date.parse('2026-05-25T22:00:00Z') / 1000;
    globalThis.fetch = async (url) => ({ ok: true, json: async () => (String(url).includes('NOZONE')
      ? { chart: { result: [{ meta: {}, timestamp: [nz], indicators: { quote: [{ close: [1], open: [1], high: [1], low: [1], volume: [0] }] } }] } }
      : { chart: { result: [{ meta: { exchangeTimezoneName: 'Pacific/Auckland' }, timestamp: [nz, nz + 86400],
          indicators: { quote: [{ open: [100, null], high: [102, null], low: [99, null], close: [101, 103], volume: [5, 6] }] } }] } }) });
    try {
      const y = await yahooProvider().history('^NZ50', '2026-05-01', '2026-06-01');
      check(y?.[0]?.date === '2026-05-26' && y[1].date === '2026-05-27' && y[0].open === 100 && y[0].high === 102 && y[0].low === 99 && y[1].open === null && y[1].high === null && y[0].tsUtc === '2026-05-25T22:00:00.000Z',
        'Yahoo bars are dated in the exchange\'s zone it names (Auckland: the 22:00 UTC stamp is Tuesday\'s session), with open/high/low kept and null where absent', y);
      check((await yahooProvider().history('NOZONE', '2026-05-01', '2026-06-01')) === null, 'a Yahoo series that names no exchange zone is refused rather than dated by UTC');
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ values: [{ datetime: '2026-09-25', open: '10', high: '11', low: '9.5', close: '10.5', volume: '100' }, { datetime: '2026-09-24', close: '10', open: null }] }) });
      const t = await twelveDataProvider({ apiKey: 'k' }).history('1155', '2026-09-01', '2026-09-26');
      check(t[1].date === '2026-09-25' && t[1].open === 10 && t[1].high === 11 && t[1].low === 9.5 && t[0].open === null && t[0].high === null,
        'Twelve Data bars keep open, high and low, null where the vendor sends none', t);
    } finally { globalThis.fetch = realFetch; }
  }

  /* --------------------------------------------------------- the import CLI -- */
  {
    const out = join(dir, 'import-history.json');
    const days = weekdays('2026-03-02', 25);
    /* TradingView's shape: epoch time (midnight UTC), o/h/l/c, Volume. */
    const tv = ['time,open,high,low,close,Volume', ...days.map((d, i) => `${Date.parse(`${d}T00:00:00Z`) / 1000},${50 + i},${52 + i},${49 + i},${51 + i},${1000 + i}`), '03/04/2026,1,1,1,1,1'].join('\n');
    await writeFile(join(dir, 'TVX.csv'), tv);
    await writeFile(join(dir, 'CLOSEONLY.csv'), ['date,close', ...days.map((d, i) => `${d},${20 + i}`)].join('\n'));
    const cli = async (...args) => { try { const r = await run(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), ...args], { cwd: ROOT }); return { code: 0, ...r }; } catch (e) { return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; } };
    const a = await cli('--in', join(dir, 'TVX.csv'), '--out', out, '--captured-at', '2026-04-10T00:00:00Z');
    const h = JSON.parse(await readFile(out, 'utf8'));
    check(a.code === 2 && Object.keys(h.series.TVX).length === 25 && same(h.ohlc.TVX[days[3]], [53, 55, 52]) && h.volume.TVX[days[3]] === 1003 && h.meta.TVX[days[0]].src === 'import:TVX.csv' && h.meta.TVX[days[0]].at === '2026-04-10T00:00:00.000Z',
      'a TradingView-shaped export (epoch, open, high, low, close, Volume) round-trips open/high/low and volume, with its source and capture time', { code: a.code, err: a.stderr });
    const rej = JSON.parse(await readFile(rejectsPathFor(out), 'utf8'));
    check(rej.rejects.some(x => x.codes.includes('AMBIGUOUS_DATE') && x.date === '03/04/2026') && /refused, not guessed/.test(a.stdout), 'the ambiguous row is refused, reported and written to the rejects file', rej.rejects);
    const b = await cli('--in', join(dir, 'CLOSEONLY.csv'), '--out', out);
    const h2 = JSON.parse(await readFile(out, 'utf8'));
    check(b.code === 0 && Object.keys(h2.series.CLOSEONLY).length === 25 && !h2.ohlc.CLOSEONLY && /close only/.test(b.stdout), 'a close-only CSV writes no ohlc key', { code: b.code, out: b.stdout.slice(0, 300) });
    const p = parseCsv('Date,Close,Volume\n2026-03-02,5,\n2026-03-03,6,0', 'P');
    check(p.rows[0].volume === null && p.rows[1].volume === 0 && p.rows[0].open === null, 'a blank volume cell is no reading, a 0 is a day with no trades');
  }

  /* ------------------------------------------- the daily path: prices → history -- */
  {
    const review = join(dir, 'review.csv');
    const prices = join(dir, 'personal-prices.json');
    const hist = join(dir, 'daily-history.json');
    await writeFile(review, 'symbol,date,close,prev,move_pct,verdict,captured_at,bar_status,why,ocr_line\n1155,2026-09-28,10.1,,,accept,2026-09-28T10:30:00.000Z,FINAL,"",""\nUK100,2026-09-28,9300,,,accept,2026-09-28T10:30:00.000Z,PROVISIONAL,"",""\n');
    await run(process.execPath, [join(ROOT, 'ingest/prices.mjs'), '--in', review, '--out', prices, '--licence', 'personal research'], { cwd: ROOT });
    const book = JSON.parse(await readFile(prices, 'utf8'));
    check(book.prices['1155']?.capturedAt === '2026-09-28T10:30:00.000Z' && book.prices['1155'].date === '2026-09-28', 'prices.mjs carries the review CSV\'s captured_at through to each price');
    const r = await run(process.execPath, [join(ROOT, 'ingest/history.mjs'), '--in', prices, '--out', hist], { cwd: ROOT });
    const h = JSON.parse(await readFile(hist, 'utf8'));
    check(/source    : screen/.test(r.stdout) && same(h.meta['1155']['2026-09-28'], { src: 'screen', at: '2026-09-28T10:30:00.000Z' }) && E.scanBars(h, 'UK100', { market: 'GB' }).status[0] === 'PROVISIONAL',
      'history.mjs writes each screen reading with its capture time, so the engine can tell the Bursa close from London\'s in-session reading', r.stdout);
    /* An import is already held for a date; the screen disagrees. */
    await updateHistory(hist, (x) => [mergeBars(x, '1155', [{ date: '2026-09-25', close: 9.9 }], { source: 'import:1155.csv', capturedAt: NOW, market: 'MY', E, now: NOW })]);
    await writeFile(prices, JSON.stringify({ source: 'data/watchlist-review.csv', prices: { 1155: { close: 9.7, date: '2026-09-25', capturedAt: '2026-09-25T10:30:00.000Z' } } }));
    let code = 0, so = '';
    try { await run(process.execPath, [join(ROOT, 'ingest/history.mjs'), '--in', prices, '--out', hist], { cwd: ROOT }); } catch (e) { code = e.code; so = e.stdout; }
    check(code === 2 && /outranked : 1/.test(so) && JSON.parse(await readFile(hist, 'utf8')).series['1155']['2026-09-25'] === 9.9,
      'history.mjs exits 2 and names the reading an import outranked; the imported close stands', so);
  }

  /* ------------------------------------------------- two writers at once -- */
  {
    const p = join(dir, 'concurrent.json');
    const storeUrl = pathToFileURL(join(ROOT, 'ingest/history-store.mjs')).href;
    const writer = (sym) => `import { updateHistory, mergeBars, engine } from ${JSON.stringify(storeUrl)};
      const E = await engine();
      for (let i = 0; i < 8; i++) await updateHistory(${JSON.stringify(p)}, (h) => [mergeBars(h, '${sym}' + i, [{ date: '2026-09-2' + (1 + (i % 5)), close: 1 + i }], { source: 'screen', market: 'US', E, now: '2026-09-28T12:00:00Z' })]);`;
    await Promise.all(['A', 'B'].map(s => run(process.execPath, ['--input-type=module', '-e', writer(s)], { cwd: ROOT })));
    const h = JSON.parse(await readFile(p, 'utf8'));
    check(Object.keys(h.series).length === 16 && !existsSync(`${p}.lock`), 'two processes writing the history at once lose nothing: the lock orders them, and is released', Object.keys(h.series));
  }
} catch (e) {
  fail('the store test threw', e.stack || e.message);
} finally {
  await rm(dir, { recursive: true, force: true });
}

/* ---- round 3: data ---- */
/* The history check (ingest/history-check.mjs), the re-fetch it starts, and
   imports that say whether their prices were already adjusted. Temporary
   files only; the re-fetch is exercised through live.mjs --plan, which
   touches no network, and dropSuperseded on a history as a re-fetch leaves it. */
{
  const R3D = join(tmpdir(), `qt-history-check-${process.pid}`);
  await rm(R3D, { recursive: true, force: true });
  await mkdir(R3D, { recursive: true });
  const { checkHistory, dropSuperseded, refetchArgs } = await import('./ingest/history-check.mjs');
  const { markAdjusted, ADJUSTED } = await import('./ingest/history-import.mjs');
  const CHECK = join(ROOT, 'ingest/history-check.mjs');
  const cli = async (...args) => { try { const { stdout, stderr } = await run(process.execPath, [CHECK, ...args], { cwd: ROOT }); return { code: 0, stdout, stderr }; }
    catch (e) { return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; } };
  try {
    const sess = weekdays('2026-01-05', 60);
    /* NZ50 dated a day early, as Yahoo's UTC day dated it; a clean US series
       that halves on a 2-for-1 split at bar 40; and a clean MY series. */
    const nz = Object.fromEntries(sess.map((d, i) => [E.scanAddDays(d, -1), 12000 + (i % 9) * 10]));
    const us = Object.fromEntries(sess.map((d, i) => [d, i >= 40 ? (200 + i) / 2 : 200 + i]));
    const my = Object.fromEntries(sess.map((d, i) => [d, 9.5 + (i % 4) / 100]));
    const hp = join(R3D, 'price-history.json'), ip = join(R3D, 'instruments.json');
    await writeFile(hp, JSON.stringify({ schema: 2, series: { NZ50: nz, AAPL: us, 1155: my } }));
    await writeFile(ip, JSON.stringify({ instruments: [{ symbol: 'NZ50', market: 'NZ' }, { symbol: 'AAPL', market: 'US' }, { symbol: '1155', market: 'MY' }] }));
    const NOWC = '2026-04-06T12:00:00Z';
    const j = await cli('--history', hp, '--instruments', ip, '--now', NOWC, '--json');
    const R = JSON.parse(j.stdout || '{}');
    check(j.code === 2 && R.shifted?.length === 1 && R.shifted[0].symbol === 'NZ50' && R.shifted[0].direction === 'early' && !R.shifted[0].partial
      && R.weekendByMarket?.[0]?.market === 'NZ' && R.weekendByMarket[0].bars === 12
      && R.breaks?.length === 1 && R.breaks[0].symbol === 'AAPL' && R.breaks[0].tag === 'split 2-for-1' && R.breaks[0].state === 'unexplained' && R.breaks[0].suggestedRatio === 2
      && R.refetch?.symbols.join() === 'NZ50' && R.refetch.from === '2026-01-04',
      'round 3 data: history-check --report lists the series dated a day early, its weekend-dated bars per market, and the split no action explains — and exits 2', { code: j.code, shifted: R.shifted, refetch: R.refetch });
    const words = await cli('--history', hp, '--instruments', ip, '--now', NOWC);
    check(/shifted\s+NZ50\s+NZ · Sun 12 Mon 12 Tue 12 Wed 12 Thu 12 Fri 0 Sat 0/.test(words.stdout) && /break\s+AAPL\s+2026-02-27 → 2026-03-02 ×0\.5\S*\s+split 2-for-1 — record ratio 2 if it was one/.test(words.stdout)
      && /repair\s+node ingest\/history-check\.mjs --refetch/.test(words.stdout) && /to repair: 12 weekend-dated bar\(s\), 1 shifted series, 1 unexplained price break\(s\)/.test(words.stdout),
      'round 3 data: the report in words names the shifted weekdays, prints each suspected break with the ratio to record, and says what to run', words.stdout.split('\n').filter(l => /shifted|break|to repair/.test(l)));

    /* The split recorded beside the history: the break is explained. */
    await writeFile(join(R3D, 'price-adjustments.json'), JSON.stringify({ schema: 1, actions: [{ symbol: 'AAPL', date: '2026-03-02', ratio: 2, kind: 'split' }, { symbol: 'AAPL', date: 'soon', ratio: 2, kind: 'split' }] }));
    const R2 = await checkHistory({ historyPath: hp, instrumentsPath: ip, now: NOWC, E });
    check(R2.breaks[0].state === 'adjusted' && R2.open.breaks === 0 && R2.adjustments.version.startsWith('adj:') && R2.adjustments.problems.length === 1 && /not a day/.test(R2.adjustments.problems[0].why),
      'round 3 data: with the split recorded in data/price-adjustments.json the break reads adjusted, and an unreadable entry is named, not applied', R2.adjustments);
    await writeFile(join(R3D, 'price-adjustments.json'), '{ oops');
    const bad = await cli('--history', hp, '--instruments', ip, '--now', NOWC);
    check(bad.code === 1 && /price-adjustments\.json is not valid JSON/.test(bad.stderr), 'round 3 data: history-check fails (exit 1) on an adjustments file it cannot read, rather than reporting unadjusted prices', bad.stderr);
    await rm(join(R3D, 'price-adjustments.json'));

    /* The re-fetch, as a plan: live.mjs is started with exactly the listed series and fetches nothing. */
    const dry = await cli('--history', hp, '--instruments', ip, '--now', NOWC, '--refetch', '--dry');
    const args = refetchArgs(R, {});
    check(dry.code === 2 && /re-fetch\s+1 series: NZ50/.test(dry.stdout) && /--history --symbols NZ50 --days \d+ --history-out/.test(dry.stdout)
      && /plan\s+: history for NZ50 \(\^NZ50\)/.test(dry.stdout) && /nothing fetched \(--plan\)/.test(dry.stdout) && /dry run: nothing fetched, nothing written/.test(dry.stdout)
      && args.includes('--symbols') && args[args.indexOf('--days') + 1] === String(R.refetch.days) && JSON.parse(await readFile(hp, 'utf8')).series.NZ50['2026-01-04'] === nz['2026-01-04'],
      'round 3 data: history-check --refetch --dry starts ingest/live.mjs --history --symbols NZ50 with --plan — it names the vendor symbol and window, and fetches and writes nothing', dry.stdout.split('\n').slice(0, 6));

    /* What a re-fetch leaves, and what is taken out: NZ50 fetched again, correctly dated, captured after the start. */
    const h = await loadHistory(hp);
    const started = '2026-04-06T12:00:00.000Z';
    sess.slice(0, 50).forEach((d, i) => mergeBars(h, 'NZ50', [{ date: d, close: 12000 + (i % 9) * 10 }], { source: 'yahoo', capturedAt: '2026-04-06T12:05:00.000Z', market: 'NZ', E, now: NOWC }));
    const before = Object.keys(h.series.NZ50).length;
    const gone = dropSuperseded(h, ['NZ50', '1155'], { startedAt: started, marketOf: (s) => ({ NZ50: 'NZ', 1155: 'MY' })[s], E });
    const lastFresh = sess[49];
    check(gone.length === 10 && gone.every(g => E.scanWeekday(g.date) === 0 && g.date <= lastFresh && g.codes.join() === 'NON_SESSION_DAY,SUPERSEDED')
      && Object.keys(h.series.NZ50).length === before - 10 && h.series.NZ50[E.scanAddDays(sess[55], -1)] !== undefined && Object.keys(h.series['1155']).length === 60,
      'round 3 data: after a re-fetch only the weekend copies inside the span the provider just dated are taken out (and returned for the rejects file); bars past that span and series it did not touch are kept',
      { gone: gone.length, first: gone[0]?.date });

    /* --adjusted: recorded on the bars an import writes, and refused when it is not one of the three. */
    const csv = join(R3D, 'KLSE.csv');
    await writeFile(csv, ['time,open,high,low,close,volume', ...sess.slice(0, 30).map((d, i) => `${d},${1500 + i},${1510 + i},${1490 + i},${1505 + i},1000`)].join('\n'));
    const out = join(R3D, 'imported.json');
    const imp = async (...a) => { try { const r = await run(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), '--in', csv, '--symbol', 'KLSE', '--out', out, '--market', 'MY', '--captured-at', '2026-02-20T12:00:00Z', ...a], { cwd: ROOT }); return { code: 0, ...r }; }
      catch (e) { return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; } };
    const i1 = await imp('--adjusted', 'provider');
    const hi = JSON.parse(await readFile(out, 'utf8'));
    const i2 = await imp('--adjusted', 'maybe');
    const i3 = await imp();
    const hu = JSON.parse(await readFile(out, 'utf8'));
    check(i1.code === 0 && Object.values(hi.meta.KLSE).every(m => m.adjusted === 'provider') && /adjusted\s+: provider/.test(i1.stdout)
      && i2.code === 1 && /--adjusted "maybe" is not one of provider, none, unknown/.test(i2.stderr) && ADJUSTED.join() === 'provider,none,unknown'
      && i3.code === 0 && Object.values(hu.meta.KLSE).every(m => m.adjusted === 'unknown'),
      'round 3 data: history-import --adjusted provider records meta.adjusted on every bar it writes; a value that is not provider, none or unknown is refused; without the flag the bars say unknown', { i1: i1.code, i2: i2.stderr?.slice(0, 80) });
    const kept = { meta: { X: { '2026-01-05': { src: 'yahoo' }, '2026-01-06': { src: 'import:x.csv' } } } };
    check(markAdjusted(kept, 'X', 'import:x.csv', [{ date: '2026-01-05' }, { date: '2026-01-06' }], 'none') === 1 && kept.meta.X['2026-01-05'].adjusted === undefined,
      'round 3 data: only bars that are the import\'s own reading are marked — a bar another source holds is not');
    /* An import that halves: the break is printed with the ratio to record. */
    await writeFile(csv, ['time,close', ...sess.slice(0, 30).map((d, i) => `${d},${i >= 20 ? (300 + i) / 2 : 300 + i}`)].join('\n'));
    const i4 = await imp('--adjusted', 'none');
    check(i4.code === 0 && /breaks\s+: 1 price break\(s\) no recorded adjustment explains/.test(i4.stdout) && /KLSE 2026-01-30 → 2026-02-02: ×0\.5\S* \(looks like a split 2-for-1; record ratio 2\)/.test(i4.stdout),
      'round 3 data: an import names each price break left in what it wrote, with the ratio a split would be recorded as', i4.stdout.split('\n').filter(l => /break|KLSE 2026/.test(l)));

    /* live.mjs --plan on its own: the symbols given, nothing fetched. */
    let lp;
    try { lp = await run(process.execPath, [join(ROOT, 'ingest/live.mjs'), '--history', '--symbols', 'NZ50,1155', '--days', '30', '--history-out', out, '--plan'], { cwd: ROOT }); lp.code = 0; }
    catch (e) { lp = { code: e.code, stdout: e.stdout || '' }; }
    check(lp.code === 0 && /symbols\s+: 2 \(only NZ50, 1155\)/.test(lp.stdout) && /NZ50 \(\^NZ50\), 1155 \(1155\.KL\)/.test(lp.stdout) && /nothing fetched \(--plan\)/.test(lp.stdout),
      'round 3 data: live.mjs --history --symbols A,B --plan names only those series, as the vendor spells them, and fetches nothing — the re-fetch entry point', lp.stdout);
  } catch (e) {
    fail('round 3 data: the history-check test threw', e.stack || e.message);
  } finally {
    await rm(R3D, { recursive: true, force: true });
  }
}
/* ---- end round 3: data ---- */

/* ---- bugfix: ingest ---- */
/* A CSV read as a CSV — a quoted "1,612.34" is one cell, a BOM, CRLF and a
   blank ",,," row are nothing, a quoted cell may hold a line break — the
   close column chosen by its names' order, and a decimal comma unreadable
   rather than ten times too large; the same row twice read once; Twelve
   Data's null and blank fields absent rather than 0, and a quote dated by
   the session its bare date names; prices.mjs reading dates and quoted
   cells as the import does, and a price file keyed by symbol; fx.mjs
   refusing a mid derived from one side of BNM's rate. No network: every
   vendor and service is a stub, every file temporary. */
{
  const BD = join(tmpdir(), `qt-bugfix-ingest-${process.pid}`);
  await rm(BD, { recursive: true, force: true });
  await mkdir(BD, { recursive: true });
  /* Read off the module rather than imported by name, so a store without
     them fails these checks one by one instead of failing to load. */
  const store = await import('./ingest/history-store.mjs');
  const csvRows = typeof store.csvRows === 'function' ? store.csvRows : () => [];
  const numberCell = typeof store.numberCell === 'function' ? store.numberCell : () => undefined;
  const node = (args, opts = {}) => run(process.execPath, args, { cwd: ROOT, ...opts }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  const stub = async (name, body) => { const p = join(BD, name); await writeFile(p, body); return pathToFileURL(p).href; };
  try {
    /* An Investing.com-shaped export: BOM, CRLF, every cell quoted, grouped numbers. */
    const inv = '\uFEFF"Date","Price","Open","High","Low","Vol.","Change %"\r\n"09/26/2025","1,612.34","1,600.10","1,620.00","1,598.20","120.5M","0.76%"\r\n,,,,,,\r\n"09/25/2025","998.50","990.00","1,001.00","985.00","100M","-0.5%"\r\n';
    const p1 = parseCsv(inv, 'KLSE');
    check(p1.rows.length === 2 && !p1.refused.length && p1.rows[0].date === '2025-09-26' && p1.rows[0].close === 1612.34 && p1.rows[0].open === 1600.1
      && p1.rows[0].high === 1620 && p1.rows[0].low === 1598.2 && p1.rows[1].close === 998.5 && p1.rows[1].high === 1001,
      'bugfix ingest: a quoted "1,612.34" is one cell — an export with a BOM, CRLF, quoted grouped numbers and a blank ",,," row reads close 1612.34 with its own open, high and low, not a close of 1 and a row slid one column left', p1);
    const p2 = parseCsv('date,close\n2026-03-02,"10,5"\n2026-03-03,"1,234"\n', 'DC');
    check(Number.isNaN(p2.rows[0].close) && p2.rows[1].close === 1234 && numberCell('') === null && numberCell(' 1 234 ') === 1234 && numberCell('1.2e+06') === 1200000,
      'bugfix ingest: a comma is a thousands separator only in groups of three — "10,5" is unreadable (the store refuses it), never 105', p2.rows);
    const p3 = parseCsv('Date,Adj Close,Close,High,Low,Open,Volume\n2026-03-02,95.5,100,101,99,99.5,1000\n', 'AC');
    check(p3.rows[0].close === 100 && p3.rows[0].volume === 1000,
      'bugfix ingest: with "Adj Close" printed before "Close" (a sorted pandas frame), the close read is Close — column names are taken in their listed order, not the file\'s', p3.rows[0]);
    const t4 = csvRows('a,b\r\n"x, ""y""","multi\r\nline"\r\n\r\nz,1\n');
    const p4 = parseCsv('date,close,note\n2026-03-02,5,"a\nb"\n\n03/04/2026,6,x', 'L');
    check(t4.length === 3 && t4[1].cells[0] === 'x, "y"' && t4[1].cells[1] === 'multi\r\nline' && t4[2].line === 5 && p4.rows.length === 1 && p4.refused[0]?.line === 5,
      'bugfix ingest: a quoted cell may hold a comma, a doubled quote and a line break; a refused row names the physical line it starts on', { t4, refused: p4.refused });

    /* One instant, written as an epoch and as ISO with a zone. */
    const mid = Date.parse('2026-04-13T00:00:00Z') / 1000;
    const asNY = (c) => parseDateCell(c, { tz: 'America/New_York' }).date;
    check(asNY(String(mid)) === '2026-04-13' && asNY('2026-04-13T00:00:00Z') === '2026-04-13' && asNY('2026-04-13 00:00:00+00:00') === '2026-04-13'
      && asNY('2026-04-13T20:00:00Z') === '2026-04-13' && asNY('2026-04-14T02:00:00Z') === '2026-04-13' && parseDateCell('2026-04-13T00:00:00Z', { tz: 'Asia/Kuala_Lumpur' }).date === '2026-04-13',
      'bugfix ingest: an ISO date-time with a zone is dated as an epoch is — midnight UTC is that UTC date, so "2026-04-13T00:00:00Z" is Monday 13 April for New York, as its epoch is, not Sunday the 12th; other instants in the exchange\'s zone',
      ['2026-04-13T00:00:00Z', '2026-04-13 00:00:00+00:00', '2026-04-13T20:00:00Z', '2026-04-14T02:00:00Z'].map(asNY));

    /* The import CLI on a quoted close-only export. */
    const csv5 = join(BD, 'QKL.csv'), out5 = join(BD, 'quoted.json');
    await writeFile(csv5, '"Date","Price"\r\n"2026-03-02","1,612.34"\r\n"2026-03-03","1,618.00"\r\n');
    const r5 = await node([join(ROOT, 'ingest/history-import.mjs'), '--in', csv5, '--out', out5, '--market', 'MY', '--captured-at', '2026-03-04T12:00:00Z']);
    const h5 = existsSync(out5) ? JSON.parse(await readFile(out5, 'utf8')) : {};
    check(r5.code === 0 && h5.series?.QKL?.['2026-03-02'] === 1612.34 && h5.series.QKL['2026-03-03'] === 1618,
      'bugfix ingest: history-import writes a quoted close-only export\'s closes as 1612.34 and 1618, not 1 and 1', { code: r5.code, series: h5.series?.QKL, err: r5.stderr });

    /* The same row twice, and two different rows, for one date. */
    const rep = mergeBars(emptyHistory(), 'R', [{ date: '2026-09-21', close: 5, volume: 10 }, { date: '2026-09-21', close: 5, volume: 10 },
      { date: '2026-09-22', close: 6 }, { date: '2026-09-22', close: 7 }], { source: 'import:r.csv', capturedAt: NOW, market: 'US', E, now: NOW });
    check(rep.added === 1 && rep.rejected.length === 2 && rep.rejected.every(x => x.date === '2026-09-22' && x.codes[0] === 'DUPLICATE_DATE'),
      'bugfix ingest: the same row twice in one batch is read once; two different rows for one date are still both refused (DUPLICATE_DATE)', { added: rep.added, rejected: rep.rejected });

    /* Twelve Data: fields sent as null or blank. */
    const realFetch = globalThis.fetch;
    try {
      const td = (body) => { globalThis.fetch = async () => ({ ok: true, json: async () => body }); return twelveDataProvider({ apiKey: 'k' }); };
      const q1 = await td({ symbol: '1155', close: null, timestamp: null, datetime: '2026-09-25', currency: 'MYR' }).quote('1155');
      const q2 = await td({ symbol: '1155', close: '10.5', timestamp: null, datetime: '2026-09-25', currency: 'MYR' }).quote('1155');
      const t7 = await td({ values: [{ datetime: '2026-09-25', open: '10', high: '11', low: '9.5', close: null, volume: '' }, { datetime: '2026-09-24', close: '10', volume: '' }] }).history('1155', '2026-09-01', '2026-09-26');
      check(q1 === null && q2?.price === 10.5 && q2.asOf === '2026-09-25' && t7?.length === 1 && t7[0].date === '2026-09-24' && t7[0].close === 10 && t7[0].volume === null,
        'bugfix ingest: Twelve Data fields sent as null or blank are absent — no quote at a price of 0, no 1970 timestamp, no bar with a close of 0, no volume of 0', { q1, q2, t7 });
    } finally { globalThis.fetch = realFetch; }
    const tdStub = await stub('td-stub.mjs', "globalThis.fetch = async () => ({ ok: true, json: async () => ({ symbol: '1155', close: '10.5', timestamp: null, datetime: '2026-09-25', currency: 'MYR' }) });\n");
    const out8 = join(BD, 'td-quotes.json');
    const env8 = { ...process.env, TWELVEDATA_KEY: 'k' }; delete env8.TWELVEDATA_REDIST;
    const r8 = await node(['--import', tdStub, join(ROOT, 'ingest/live.mjs'), '--quotes', '--provider', 'twelvedata', '--symbols', '1155', '--out', out8], { env: env8 });
    const q8 = existsSync(out8) ? JSON.parse(await readFile(out8, 'utf8')).prices?.['1155'] : null;
    check(r8.code === 0 && q8?.close === 10.5 && q8.date === '2026-09-25',
      'bugfix ingest: live.mjs files a quote whose only date is the session date Twelve Data names under that session — not the day before (midnight UTC read as an instant), and not 1970', { code: r8.code, q8, err: r8.stderr });

    /* prices.mjs: quoted cells, day-first and ambiguous dates, a file keyed by symbol. */
    const csv9 = join(BD, 'eod.csv'), out9 = join(BD, 'eod.json');
    await writeFile(csv9, '"symbol","date","close","prev"\r\n"AAA","26/09/2025","10.5",""\r\n"BBB","03/04/2026","20",""\r\n"KLSE","2026-09-25","1,612.34","1,600.00"\r\n');
    const r9 = await node([join(ROOT, 'ingest/prices.mjs'), '--in', csv9, '--out', out9]);
    const b9 = existsSync(out9) ? JSON.parse(await readFile(out9, 'utf8')) : {};
    check(r9.code === 0 && b9.prices?.AAA?.date === '2025-09-26' && !b9.prices.BBB && b9.rejected?.some(x => x.symbol === 'BBB' && /ambiguous date "03\/04\/2026"/.test(x.why))
      && b9.prices.KLSE?.close === 1612.34 && b9.prices.KLSE.d1 === 0.771 && !b9.rejected.some(x => /future/.test(x.why)),
      'bugfix ingest: prices.mjs reads a quoted CSV, files "26/09/2025" as 2025-09-26 (it was refused as "in the future"), refuses "03/04/2026" as ambiguous (it was written through as it stood), and reads "1,612.34" whole', { code: r9.code, err: r9.stderr, prices: b9.prices, rejected: b9.rejected });
    const json10 = join(BD, 'keyed.json'), out10 = join(BD, 'keyed-out.json');
    await writeFile(json10, JSON.stringify({ source: 'yahoo', prices: { AAA: { close: 12.5, date: '2026-09-25', capturedAt: '2026-09-25T21:00:00.000Z' } } }));
    const r10 = await node([join(ROOT, 'ingest/prices.mjs'), '--in', json10, '--out', out10]);
    const b10 = existsSync(out10) ? JSON.parse(await readFile(out10, 'utf8')) : {};
    check(r10.code === 0 && b10.prices?.AAA?.close === 12.5 && b10.prices.AAA.capturedAt === '2026-09-25T21:00:00.000Z',
      'bugfix ingest: prices.mjs reads a price file keyed by symbol (the shape it, live.mjs and fx.mjs write) instead of crashing on "rows is not iterable"', { code: r10.code, err: r10.stderr?.slice(0, 200) });

    /* fx.mjs: BNM with one side null and the cross-check source down. */
    const bnm = (buy, sell) => `globalThis.fetch = async (url) => { if (String(url).includes('bnm.gov.my')) return { ok: true, status: 200, json: async () => ({ data: { rate: { date: '2026-09-25', buying_rate: ${buy}, selling_rate: ${sell}, middle_rate: null } } }) }; throw new Error('frankfurter unreachable'); };\n`;
    const out11 = join(BD, 'fx-one-side.json'), out12 = join(BD, 'fx-both.json');
    const r11 = await node(['--import', await stub('fx-one.mjs', bnm('null', 4.5)), join(ROOT, 'ingest/fx.mjs'), '--out', out11]);
    const r12 = await node(['--import', await stub('fx-both.mjs', bnm(4.4, 4.6)), join(ROOT, 'ingest/fx.mjs'), '--out', out12]);
    const b12 = existsSync(out12) ? JSON.parse(await readFile(out12, 'utf8')) : {};
    check(r11.code === 1 && !existsSync(out11) && /not both sides/.test(r11.stderr) && r12.code === 0 && b12.prices?.USDMYR?.close === 4.5,
      'bugfix ingest: fx.mjs refuses a BNM rate with one side null (it wrote 2.25 — half the rate, inside the plausible band — when the cross-check source was down); with both sides the mid is still derived', { r11: r11.code, err: r11.stderr, r12: r12.code, usdmyr: b12.prices?.USDMYR });

    /* watchlist.mjs's day-move gate against a baseline in the { price } shape.
       The script needs Windows OCR to run whole, so its lastClose is sliced
       out of the source, as the paste parser is above. */
    const wl = readFileSync(join(ROOT, 'ingest/watchlist.mjs'), 'utf8');
    const wa = wl.indexOf('function lastClose(');
    const lastClose = wa < 0 ? null : new Function(`${wl.slice(wa, wl.indexOf('\n}\n', wa) + 2)}; return lastClose;`)();
    const gateReads = /const last = lastClose\(prev\[c\.symbol\]\);/.test(wl);
    const move = (ocr, base) => { const last = lastClose?.(base); return last == null ? null : ((ocr - last) / last) * 100; };
    check(lastClose && gateReads && lastClose({ price: 214.3, asOf: '2026-08-04T02:05:02.000Z' }) === 214.3 && lastClose({ close: 10.84 }) === 10.84
      && lastClose({ close: 0 }) === null && lastClose(undefined) === null && Math.round(move(814.3, { price: 214.3 })) === 280,
      'bugfix ingest: watchlist.mjs checks each OCR candidate against a baseline written as { price } (live.mjs --quotes before it wrote close) — 814.30 read for 214.30 is a +280% move to hold back, not "no previous close"', { found: !!lastClose, gateReads });
  } catch (e) {
    fail('bugfix ingest: the test threw', e.stack || e.message);
  } finally {
    await rm(BD, { recursive: true, force: true });
  }
}
/* ---- end bugfix: ingest ---- */


/* ---- bugfix: equities-data ---- */
/* THE PASTE PARSER READS A CLOSE WHOLE OR REFUSES IT, AND ONLY CALENDAR
   DATES. It split every line on comma, semicolon and tab at once, so a
   spreadsheet copy "KLSE<tab>2026-01-02<tab>1,612.35" and the quoted CSV of
   the same row stored a close of 1, a semicolon export's "12,5" stored 12,
   and "31/02/2026" and "2026-02-30" were kept as sessions — all without a
   rejected row. */
{
  const uni = readFileSync(join(ROOT, 'src/js/25-universe.js'), 'utf8');
  const a = uni.indexOf('function parseCloses(');
  const parseCloses = new Function(`${uni.slice(a, uni.indexOf('\n}\n', a) + 2)}; return parseCloses;`)();
  const one = (t) => { const r = parseCloses(t, 'X'); return r.rejected.length ? 'refused' : Object.values(r.series)[0] && Object.entries(Object.values(r.series)[0])[0]; };
  const got = {
    tab: one('KLSE\t2026-01-02\t1,612.35'), quoted: one('"KLSE","2026-01-02","1,612.35"'), twoCol: one('2026-01-02\t60,123.40'),
    plain: one('KLSE,2026-01-02,1612.35'), currency: one('KLSE,2026-01-02,RM 4.18'), semi: one('KLSE;2026-01-02;4.18'),
    semiComma: one('KLSE;2026-01-02;12,5'), cut: one('KLSE,2026-01-02,1,612.35'), euro: one('KLSE\t2026-01-02\t1.612,35'),
  };
  const want = {
    tab: ['2026-01-02', 1612.35], quoted: ['2026-01-02', 1612.35], twoCol: ['2026-01-02', 60123.4],
    plain: ['2026-01-02', 1612.35], currency: ['2026-01-02', 4.18], semi: ['2026-01-02', 4.18],
    semiComma: 'refused', cut: 'refused', euro: 'refused',
  };
  check(same(got, want), 'bugfix equities-data: the paste parser reads "1,612.35" from a spreadsheet copy or a quoted CSV as 1,612.35, and refuses a decimal comma or a close cut at its thousands separator rather than storing 12 or 1', { got, want });
  const cells = ['31/02/2026', '2026-02-30', '29/02/2027', '29/02/2028', '2026-02-28'];
  const browser = cells.map(c => { const r = parseCloses(`X,${c},1`); return r.rejected.length ? 'refused' : Object.keys(r.series.X || {})[0]; });
  const store = cells.map(c => { const r = parseDateCell(c); return r.error ? 'refused' : r.date; });
  const month13 = parseCloses('X,2026-13-01,1');
  check(same(browser, store) && browser[0] === 'refused' && browser[3] === '2028-02-29' && month13.rejected.length === 1 && !month13.accepted,
    'bugfix equities-data: the paste parser refuses the dates the calendar does not have (31 and 30 February, 29 February 2027, month 13) as the history import does, and keeps 29 February 2028', { browser, store, month13: month13.rejected });
}
/* ---- end bugfix: equities-data ---- */

/* ---- bugfix2: ingest ---- */
/* THE STORE'S WRITE WAITS A READER OUT; ONE IMPOSSIBLE DATE IS ONE REFUSED
   ROW; A REFUSED PRICE CHANGES NOTHING. writeAtomic failed at once (EPERM)
   while another process held data/price-history.json open, as serve.mjs
   does for the pages, and failed on every write once the .bak was
   read-only. A month 13 or a day 32 threw a RangeError out of the date
   reader, so one such cell failed a whole import and crashed prices.mjs;
   a time the clock does not have came back undated with no error, and
   prices.mjs accepted the price undated. And prices.mjs wrote --out even
   when it accepted nothing — every row held back, or a capture that read
   none — so the personal lane's prices vanished, and the next run's
   day-move check had no previous close to hold a misread against; a
   symbol held back lost its price the same way. */
{
  const BD = join(tmpdir(), `qt-bugfix2-ingest-${process.pid}`);
  await rm(BD, { recursive: true, force: true });
  await mkdir(BD, { recursive: true });
  const store = await import('./ingest/history-store.mjs');
  const node = (args, opts = {}) => run(process.execPath, args, { cwd: ROOT, ...opts }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  const { open, chmod } = await import('node:fs/promises');
  try {
    /* writeAtomic under a reader, and over a read-only .bak. */
    const held = join(BD, 'held.json');
    await writeFile(held, '{"v":0}');
    const fh = await open(held, 'r');
    const closing = new Promise(r => setTimeout(() => fh.close().then(r, r), 300));
    let w1 = 'written';
    try { await store.writeAtomic(held, '{"v":1}'); } catch (e) { w1 = e.code || e.message; }
    await closing;
    await chmod(`${held}.bak`, 0o444);
    let w2 = 'written';
    try { await store.writeAtomic(held, '{"v":2}'); } catch (e) { w2 = e.code || e.message; }
    await chmod(`${held}.bak`, 0o666).catch(() => {});
    check(w1 === 'written' && w2 === 'written' && (await readFile(held, 'utf8')) === '{"v":2}' && (await readFile(`${held}.bak`, 'utf8')) === '{"v":1}',
      'bugfix2 ingest: the store\'s atomic write waits out a reader holding the history open (it failed at once with EPERM on Windows) and replaces a read-only .bak (every later write failed on the copy)', { w1, w2 });

    /* Impossible dates and times are refused, one row each, never thrown. */
    const cells = ['2026-13-01', '32/01/2026', '13/0/2026', '0/13/2026', '2026-01-32', '2026-00-10', '2026-13-01T10:00:00Z', '2026-01-05T10:60:00Z', '2026-01-05T25:00:00+08:00', '2026-01-05 99:99'];
    const read = cells.map(c => { try { const r = parseDateCell(c, { tz: 'Asia/Kuala_Lumpur' }); return r.error || `date ${r.date}`; } catch (e) { return `threw ${e.message}`; } });
    const kept = ['2026-01-05T10:00:00Z', '2026-01-05T24:00:00Z', '2026-01-05 10:00', '2026-02-28'].map(c => parseDateCell(c, { tz: 'UTC' }).date);
    check(read.every(x => x === 'BAD_DATE') && same(kept, ['2026-01-05', '2026-01-06', '2026-01-05', '2026-02-28']),
      'bugfix2 ingest: a month 13, a day 32, a day or month 0, and a time the clock does not have are each refused as BAD_DATE — not a RangeError that fails the whole import, and not an undated row; real instants still date as before', { cells, read, kept });
    const csvBad = join(BD, 'ZZBAD.csv'), outBad = join(BD, 'bad-history.json');
    await writeFile(csvBad, 'date,close\n2026-03-02,10\n2026-13-01,11\n2026-03-03,12\n2026-03-04T10:60:00Z,13\n');
    const rb = await node([join(ROOT, 'ingest/history-import.mjs'), '--in', csvBad, '--symbol', 'ZZBAD', '--out', outBad, '--captured-at', '2026-04-10T00:00:00Z']);
    const hb = existsSync(outBad) ? JSON.parse(await readFile(outBad, 'utf8')) : {};
    const rjb = existsSync(rejectsPathFor(outBad)) ? JSON.parse(await readFile(rejectsPathFor(outBad), 'utf8')).rejects : [];
    check(rb.code === 2 && same(hb.series?.ZZBAD, { '2026-03-02': 10, '2026-03-03': 12 }) && !/FAILED/.test(rb.stdout)
      && same(rjb.filter(x => x.symbol === 'ZZBAD').map(x => [x.date, x.codes.join(), x.line]), [['2026-13-01', 'BAD_DATE', 3], ['2026-03-04T10:60:00Z', 'BAD_DATE', 5]]),
      'bugfix2 ingest: history-import writes the rows of a CSV with one impossible date and one impossible time, and refuses those two by line as BAD_DATE — it printed "FAILED — Invalid time value" and wrote nothing', { code: rb.code, series: hb.series, rejects: rjb, out: rb.stdout.slice(0, 300), err: rb.stderr.slice(0, 300) });

    /* prices.mjs: a refused row changes nothing. */
    const HEAD = 'symbol,date,close,prev,move_pct,verdict,captured_at,bar_status,why,ocr_line\n';
    const review = join(BD, 'watchlist-review.csv'), pp = join(BD, 'personal-prices.json');
    const day1 = { generated: '2026-09-25T11:00:00.000Z', source: review, asOf: '2026-09-25', basis: 'end-of-day', licence: 'personal research', count: 3,
      prices: { AAA: { close: 214.3, date: '2026-09-25', capturedAt: '2026-09-25T10:30:00.000Z', d1: null, hi: null, lo: null, m12: null },
                BBB: { close: 10.1, date: '2026-09-25', capturedAt: '2026-09-25T10:30:00.000Z', d1: null, hi: null, lo: null, m12: null },
                USDMYR: { close: 4.21, date: '2026-09-25', d1: null, hi: null, lo: null, m12: null, src: 'Bank Negara Malaysia', crossChecked: null } }, rejected: [] };
    const day1Text = JSON.stringify(day1, null, 2);
    const pricesRun = (inFile) => node([join(ROOT, 'ingest/prices.mjs'), '--in', inFile, '--out', pp, '--licence', 'personal research']);
    await writeFile(pp, day1Text);
    await writeFile(review, HEAD + 'AAA,2026-09-26,814.3,214.3,280,CHECK,2026-09-26T10:30:00.000Z,FINAL,implies +280%,x\nBBB,2026-09-26,10.2,10.1,1,CHECK,2026-09-26T10:30:00.000Z,FINAL,conflict,x\n');
    const pa = await pricesRun(review);
    const afterAll = await readFile(pp, 'utf8');
    await writeFile(review, HEAD);
    const pe = await pricesRun(review);
    const afterEmpty = await readFile(pp, 'utf8');
    check(pa.code === 1 && afterAll === day1Text && /accepted : 0/.test(pa.stdout) && /rejected : 2/.test(pa.stdout) && /not written/.test(pa.stdout)
      && pe.code === 1 && afterEmpty === day1Text,
      'bugfix2 ingest: prices.mjs with every row held back, or with no row at all, leaves --out as it stood and exits 1 — it wrote { prices: {} }, emptying the personal lane and the next run\'s day-move baseline', { pa: pa.code, pe: pe.code, out: pa.stdout.slice(0, 400), file: afterAll.slice(0, 200) });

    await writeFile(pp, day1Text);
    await writeFile(review, HEAD + 'AAA,2026-09-26,814.3,214.3,280,CHECK,2026-09-26T10:30:00.000Z,FINAL,implies +280%,x\nBBB,2026-09-26,10.2,10.1,1,accept,2026-09-26T10:30:00.000Z,FINAL,,x\n');
    const pk = await pricesRun(review);
    const bk = JSON.parse(await readFile(pp, 'utf8'));
    /* The same held back against a file some other input wrote: nothing of it is kept. */
    await writeFile(pp, JSON.stringify({ ...day1, source: join(BD, 'another.csv') }));
    const po = await pricesRun(review);
    const bo = JSON.parse(await readFile(pp, 'utf8'));
    /* fx.mjs's rate names its own source and is carried, not kept as a
       refused symbol's price (bugfix5: ingest — it was dropped, and this
       check asserted that it was). */
    check(pk.code === 0 && /accepted : 1/.test(pk.stdout) && bk.prices.BBB?.close === 10.2 && same(bk.prices.AAA, day1.prices.AAA) && same(bk.prices.USDMYR, day1.prices.USDMYR) && bk.asOf === '2026-09-26'
      && /kept\s+: 1 refused symbol/.test(pk.stdout) && po.code === 0 && !bo.prices.AAA && bo.prices.BBB?.close === 10.2,
      'bugfix2 ingest: a symbol held back keeps the price the file held for it (214.30 stays the baseline a second 814.30 is checked against), only from a file written from the same input, never another writer\'s unlabelled row', { pk: pk.stdout.slice(0, 400), prices: bk.prices, other: bo.prices });

    const eod = join(BD, 'eod.csv'), eodOut = join(BD, 'eod.json');
    await writeFile(eod, 'symbol,date,close\nCCC,2026-09-25T10:60:00Z,5\nDDD,2026-13-01,6\nEEE,2026-09-25,7\n');
    const pd = await node([join(ROOT, 'ingest/prices.mjs'), '--in', eod, '--out', eodOut]);
    const bd = existsSync(eodOut) ? JSON.parse(await readFile(eodOut, 'utf8')) : {};
    check(pd.code === 0 && same(Object.keys(bd.prices || {}), ['EEE']) && same((bd.rejected || []).map(x => x.symbol), ['CCC', 'DDD']),
      'bugfix2 ingest: prices.mjs refuses a row with an impossible date or time and writes the rest — it crashed on "2026-13-01" and wrote nothing, and would have filed "10:60" undated', { code: pd.code, err: pd.stderr.slice(0, 200), prices: bd.prices, rejected: bd.rejected });
  } catch (e) {
    fail('bugfix2 ingest: the test threw', e.stack || e.message);
  } finally {
    await rm(BD, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end bugfix2: ingest ---- */

/* ---- bugfix4: ingest ---- */
/* A ROW THAT NAMES ITS OWN SOURCE IS NOT THE FILE'S READING; A DAY WITH
   NOTHING IMPORTED IS SAID TO BE ONE. history.mjs filed fx.mjs's Bank
   Negara USD/MYR — merged into the screen's price file with its own src and
   no capture time — under the file's source: a 'screen' bar with no capture
   time that, ranking equal with the screen's reading already held for that
   date, replaced it and was recorded as a correction. daily.mjs read
   prices.mjs's exit 1 for "no row accepted" as "import FAILED" and stopped
   there: no FX, and never the closing lines for a day whose every row was
   held back. The re-run those lines gave named the import alone, so a
   close corrected as told never reached the history. And its FX line said
   "from Bank Negara Malaysia, cross-checked" whichever source answered.
   No network: fetch, the capture, the reader and the scanner are stubs,
   every file temporary. */
{
  const BD = join(tmpdir(), `qt-bugfix4-ingest-${process.pid}`);
  await rm(BD, { recursive: true, force: true });
  await mkdir(BD, { recursive: true });
  const node = (args, opts = {}) => run(process.execPath, args, { cwd: ROOT, ...opts }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  const HEAD = 'symbol,date,close,prev,move_pct,verdict,captured_at,bar_status,why,ocr_line\n';
  try {
    /* prices.mjs, then fx.mjs (Bank Negara stubbed, Frankfurter down), then
       history.mjs on the same file — the manual path the README gives. The
       screen had already read USD/MYR for that session, after its close. */
    const review = join(BD, 'watchlist-review.csv'), pp = join(BD, 'personal-prices.json'), hist = join(BD, 'price-history.json');
    await writeFile(review, HEAD + '1155,2026-09-25,9.87,,,accept,2026-09-25T10:30:00.000Z,FINAL,,x\n');
    const p1 = await node([join(ROOT, 'ingest/prices.mjs'), '--in', review, '--out', pp, '--licence', 'personal research']);
    /* fetch as fx.mjs meets it: Bank Negara's rate (4.20 / 4.22), Frankfurter's (4.2135), each up or down. */
    const fetchAs = (bnmUp, frankUp) => `globalThis.fetch = async (url) => {
  if (String(url).includes('bnm.gov.my')) { if (${bnmUp}) return { ok: true, status: 200, json: async () => ({ data: { rate: { date: '2026-09-25', buying_rate: 4.2, selling_rate: 4.22, middle_rate: null } } }) }; throw new Error('BNM unreachable'); }
  if (${frankUp}) return { ok: true, status: 200, json: async () => ({ date: '2026-09-25', rates: { MYR: 4.2135 } }) };
  throw new Error('frankfurter unreachable');
};\n`;
    const pre = {};
    for (const [k, b, f] of [['bnm', true, false], ['frank', false, true], ['both', true, true], ['none', false, false]]) { await writeFile(join(BD, `fetch-${k}.mjs`), fetchAs(b, f)); pre[k] = pathToFileURL(join(BD, `fetch-${k}.mjs`)).href; }
    const f1 = await node(['--import', pre.bnm, join(ROOT, 'ingest/fx.mjs'), '--out', pp]);
    const book1 = JSON.parse(await readFile(pp, 'utf8'));
    await updateHistory(hist, (x) => [mergeBars(x, 'USDMYR', [{ date: '2026-09-25', close: 4.215 }], { source: 'screen', capturedAt: '2026-09-25T23:30:00.000Z', market: 'FX', E, now: NOW })]);
    const h1 = await node([join(ROOT, 'ingest/history.mjs'), '--in', pp, '--out', hist]);
    const got1 = JSON.parse(await readFile(hist, 'utf8'));
    check(p1.code === 0 && f1.code === 0 && book1.prices.USDMYR?.src === 'Bank Negara Malaysia' && book1.prices.USDMYR.close === 4.21
      && h1.code === 0 && got1.series.USDMYR?.['2026-09-25'] === 4.215 && same(got1.meta.USDMYR?.['2026-09-25'], { src: 'screen', at: '2026-09-25T23:30:00.000Z' })
      && !(got1.corrections?.USDMYR || []).length && got1.series['1155']?.['2026-09-25'] === 9.87 && got1.meta['1155']?.['2026-09-25']?.src === 'screen'
      && /left out\s*: 1 row\(s\) naming their own source\b.*USDMYR \(Bank Negara Malaysia\)/.test(h1.stdout),
      'bugfix4 ingest: history.mjs leaves out, and names, a row that carries its own source — fx.mjs\'s Bank Negara rate in the screen\'s price file replaced the screen\'s USD/MYR reading for that date as a \'screen\' bar with no capture time, recorded as a correction; the screen\'s own rows are filed as before',
      { p1: p1.code, f1: [f1.code, f1.stderr.slice(0, 200)], usdmyr: [got1.series.USDMYR, got1.meta.USDMYR, got1.corrections?.USDMYR], out: h1.stdout });

    /* daily.mjs with the capture, the reader, the history and the scanner
       stubbed (each leaves a mark when it runs), prices.mjs the real one, and
       fx.mjs the real one on a stubbed fetch (STUB_FX: bnm, frank, both or
       none up). STUB_READ_THROW makes the reader throw, as a script does. */
    const DD = join(BD, 'daily');
    for (const s of ['ingest', 'scanner', 'data']) await mkdir(join(DD, s), { recursive: true });
    const realScript = (f) => `import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, [${JSON.stringify(join(ROOT, 'ingest', f))}, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status ?? 1);`;
    const marks = (name, text) => `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(name)}, '1'); console.log(${JSON.stringify(text)});`;
    await writeFile(join(DD, 'ingest/autoshot.mjs'), "console.log('page 1');");
    await writeFile(join(DD, 'ingest/watchlist.mjs'), "if (process.env.STUB_READ_THROW) throw new Error(process.env.STUB_READ_THROW);\nconsole.log(process.env.STUB_READ || 'candidates 2\\nflagged   2\\nskipped   0');");
    await writeFile(join(DD, 'ingest/prices.mjs'), realScript('prices.mjs'));
    await writeFile(join(DD, 'ingest/history.mjs'), marks('history-ran', '  symbols   : 2\n  new bars  : 2\n  depth     : 1-2 day(s) per symbol'));
    await writeFile(join(DD, 'ingest/fx.mjs'), `import { writeFileSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; writeFileSync('fx-ran', '1');
const r = spawnSync(process.execPath, ['--import', ${JSON.stringify(pre)}[process.env.STUB_FX || 'both'], ${JSON.stringify(join(ROOT, 'ingest/fx.mjs'))}, ...process.argv.slice(2)], { stdio: 'inherit' }); process.exit(r.status ?? 1);`);
    await writeFile(join(DD, 'scanner/scan.mjs'), marks('scan-ran', '0 new alerts recorded\nstatus     COMPLETED (run-stub-1)'));
    await writeFile(join(DD, 'data/scan-setups.json'), '{"setups":[]}');
    const held = { source: 'data/watchlist-review.csv', asOf: '2026-09-24', prices: { AAA: { close: 214.3, date: '2026-09-24', capturedAt: '2026-09-24T10:30:00.000Z' }, BBB: { close: 10.1, date: '2026-09-24', capturedAt: '2026-09-24T10:30:00.000Z' } } };
    const reset = async (csv) => {
      for (const f of ['history-ran', 'fx-ran', 'scan-ran']) await rm(join(DD, f), { force: true });
      await writeFile(join(DD, 'data/personal-prices.json'), JSON.stringify(held));
      await writeFile(join(DD, 'data/watchlist-review.csv'), csv);
    };
    const daily = (env = {}) => node([join(ROOT, 'ingest/daily.mjs'), '--url', 'http://example.invalid'], { cwd: DD, env: { ...process.env, ...env } });
    const lastRun = async () => JSON.parse(await readFile(join(DD, 'data/ingest-runs.json'), 'utf8')).runs.at(-1);
    const stepOf = (r, name) => r?.steps?.find(s => s.step === name)?.status;
    const ran = (f) => existsSync(join(DD, f));

    await reset(HEAD + 'AAA,2026-09-25,814.3,214.3,280,CHECK,2026-09-25T10:30:00.000Z,FINAL,implies +280%,x\nBBB,2026-09-25,10.2,10.1,1,CHECK,2026-09-25T10:30:00.000Z,FINAL,conflict,x\n');
    const d2 = await daily();
    const r2 = await lastRun();
    const ran2 = { history: ran('history-ran'), scan: ran('scan-ran'), fx: ran('fx-ran') };
    const file2 = JSON.parse(await readFile(join(DD, 'data/personal-prices.json'), 'utf8'));
    check(d2.code === 1 && !/import\s+FAILED/.test(d2.stdout) && /^import\s+nothing accepted, 2 held back for review/m.test(d2.stdout) && stepOf(r2, 'import') === 'warn'
      && !ran2.history && stepOf(r2, 'history') === 'skipped' && !ran2.scan && stepOf(r2, 'scanner') === 'skipped' && ran2.fx && stepOf(r2, 'fx') === 'ok'
      && /^NOTHING IMPORTED — every row was held back\.$/m.test(d2.stdout) && /^Open data\/watchlist-review\.csv, correct the rows marked CHECK/m.test(d2.stdout)
      && r2.status === 'FAILED' && r2.exitCode === 1 && r2.counts?.accepted === 0 && r2.counts?.rejected === 2
      && same(file2.prices.AAA, held.prices.AAA) && same(file2.prices.BBB, held.prices.BBB) && file2.prices.USDMYR?.close === 4.21,
      'bugfix4 ingest: daily.mjs reads prices.mjs\'s exit 1 for "no row accepted" as that — the prices the file holds stand, the history and the scanner are skipped, FX still runs, and the run closes "every row was held back" with the file to correct, exit 1; it said "import FAILED" and stopped',
      { code: d2.code, ran: ran2, steps: r2?.steps, tail: d2.stdout.split('\n').slice(-9) });

    await reset(HEAD);
    const d3 = await daily({ STUB_READ: 'candidates 0\nflagged   0\nskipped   0' });
    const r3 = await lastRun();
    await reset('symbol,date\nAAA,2026-09-25\n');
    const d4 = await daily();
    const r4 = await lastRun();
    check(d3.code === 1 && /^NOTHING IMPORTED — no row was read from the capture\.$/m.test(d3.stdout) && !/every row was held back/.test(d3.stdout) && !/import\s+FAILED/.test(d3.stdout) && stepOf(r3, 'history') === 'skipped'
      && d4.code === 1 && /^import\s+FAILED/m.test(d4.stdout) && stepOf(r4, 'import') === 'failed' && !ran('fx-ran') && !ran('history-ran'),
      'bugfix4 ingest: a capture that read no row closes "no row was read from the capture", not "import FAILED"; an import that genuinely fails (a review file with no close column) is still FAILED and stops the run',
      { d3: d3.stdout.split('\n').slice(-6), d4: d4.stdout.split('\n').slice(-6), r4: r4?.steps });

    /* A step whose script throws is logged with the error it threw, not the
       last line of Node's stack ("Node.js v24.x"). */
    await reset(HEAD);
    const d4b = await daily({ STUB_READ_THROW: 'the OCR engine is not installed' });
    const r4b = await lastRun();
    const detailOf = (r, name) => r?.steps?.find(s => s.step === name)?.detail;
    const said = (d) => d.stdout.split('report written to')[0];
    check(detailOf(r4, 'import') === 'Error: CSV is missing a required column: close' && /^import\s+FAILED\n\s+Error: CSV is missing a required column: close$/m.test(said(d4).replace(/\r/g, ''))
      && d4b.code === 1 && detailOf(r4b, 'read') === 'Error: the OCR engine is not installed' && /^read\s+FAILED\n\s+Error: the OCR engine is not installed$/m.test(said(d4b).replace(/\r/g, ''))
      && ![d4, d4b].some(d => /Node\.js v\d|^\s+at /m.test(said(d))),
      'bugfix4 ingest: a step whose script threw is reported and logged with the error it threw — the import that found no close column was logged as failing with "Node.js v24", the stack frames printed as the reason',
      { import: detailOf(r4, 'import'), read: detailOf(r4b, 'read'), d4: said(d4).split('\n').slice(-6), d4b: said(d4b).split('\n').slice(-6) });

    /* The closing lines' re-run, followed as printed after the reader corrects
       the held-back row: the corrected close reaches the history. */
    await reset(HEAD + 'AAA,2026-09-25,814.3,214.3,280,CHECK,2026-09-25T10:30:00.000Z,FINAL,implies +280%,x\nBBB,2026-09-25,10.2,10.1,1,accept,2026-09-25T10:30:00.000Z,FINAL,,x\n');
    const d5 = await daily({ STUB_READ: 'candidates 2\nflagged   1\nskipped   0' });
    await writeFile(join(DD, 'data/watchlist-review.csv'), HEAD + 'AAA,2026-09-25,216.1,214.3,0.84,accept,2026-09-25T10:30:00.000Z,FINAL,corrected,x\nBBB,2026-09-25,10.2,10.1,1,accept,2026-09-25T10:30:00.000Z,FINAL,,x\n');
    const told = d5.stdout.split('\n').filter(l => /^\s+node ingest\/\S+\.mjs/.test(l)).map(l => [...l.trim().matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2]).slice(1));
    const did = [];
    for (const [script, ...args] of told) did.push((await node([join(ROOT, script), ...args], { cwd: DD })).code);
    const hist5 = existsSync(join(DD, 'data/price-history.json')) ? JSON.parse(await readFile(join(DD, 'data/price-history.json'), 'utf8')) : null;
    check(d5.code === 2 && told.length && did.every(c => c === 0) && hist5?.series?.AAA?.['2026-09-25'] === 216.1 && hist5?.series?.BBB?.['2026-09-25'] === 10.2,
      'bugfix4 ingest: the re-run daily.mjs prints for rows held back, followed as printed, puts the corrected close in the history — it named the import alone, which writes only the price file the next run replaces, so the session was lost from the series',
      { told: told.map(t => t[0]), did, aaa: hist5?.series?.AAA ?? null });

    /* The FX line names the source fx.mjs chose and whether a second agreed. */
    const fxSay = {};
    for (const k of ['frank', 'bnm', 'both']) {
      await reset(HEAD + 'AAA,2026-09-25,216.1,214.3,0.84,accept,2026-09-25T10:30:00.000Z,FINAL,,x\nBBB,2026-09-25,10.2,10.1,1,accept,2026-09-25T10:30:00.000Z,FINAL,,x\n');
      const d = await daily({ STUB_READ: 'candidates 2\nflagged   0\nskipped   0', STUB_FX: k });
      const r = await lastRun();
      fxSay[k] = { code: d.code, line: (d.stdout.match(/^fx\s+(.+)$/m) || [])[1] || null, detail: r?.steps?.find(s => s.step === 'fx')?.detail || null };
    }
    check(fxSay.frank.line === 'USD/MYR 4.2135 from Frankfurter (ECB reference rates), not cross-checked — only one source responded'
      && fxSay.bnm.line === 'USD/MYR 4.21 from Bank Negara Malaysia, not cross-checked — only one source responded'
      && fxSay.both.line === 'USD/MYR 4.21 from Bank Negara Malaysia, cross-checked (the two sources 0.083% apart)'
      && Object.values(fxSay).every(x => x.code === 0 && x.detail === x.line),
      'bugfix4 ingest: daily.mjs\'s FX line names the source the rate came from and whether a second source agreed — it said "from Bank Negara Malaysia, cross-checked" for Frankfurter\'s rate with Bank Negara down, and for a rate nothing checked',
      fxSay);

    /* Both FX sources down. "The previous rate is unchanged" was printed
       whatever the file held; the line now names the rate it holds. The
       import that wrote the price file dropped the rate the file held, and
       this check asserted that it had (bugfix5: ingest): prices.mjs now
       carries it, so the file still holds it after an import, as where
       nothing was imported. */
    const withRate = { ...held, prices: { ...held.prices, USDMYR: { close: 4.2, date: '2026-09-24', d1: null, hi: null, lo: null, m12: null, src: 'Bank Negara Malaysia', crossChecked: null } } };
    await reset(HEAD + 'AAA,2026-09-25,216.1,214.3,0.84,accept,2026-09-25T10:30:00.000Z,FINAL,,x\nBBB,2026-09-25,10.2,10.1,1,accept,2026-09-25T10:30:00.000Z,FINAL,,x\n');
    await writeFile(join(DD, 'data/personal-prices.json'), JSON.stringify(withRate));
    const d6 = await daily({ STUB_READ: 'candidates 2\nflagged   0\nskipped   0', STUB_FX: 'none' });
    const r6 = await lastRun();
    const file6 = JSON.parse(await readFile(join(DD, 'data/personal-prices.json'), 'utf8'));
    await reset(HEAD + 'AAA,2026-09-25,814.3,214.3,280,CHECK,2026-09-25T10:30:00.000Z,FINAL,implies +280%,x\nBBB,2026-09-25,10.2,10.1,1,CHECK,2026-09-25T10:30:00.000Z,FINAL,conflict,x\n');
    await writeFile(join(DD, 'data/personal-prices.json'), JSON.stringify(withRate));
    const d7 = await daily({ STUB_FX: 'none' });
    const r7 = await lastRun();
    const file7 = JSON.parse(await readFile(join(DD, 'data/personal-prices.json'), 'utf8'));
    const fxLine = (d) => (d.stdout.match(/^fx\s+(.+)$/m) || [])[1] || null;
    check(d6.code === 2 && same(file6.prices.USDMYR, withRate.prices.USDMYR) && stepOf(r6, 'fx') === 'failed'
      && fxLine(d6) === 'could not refresh — data/personal-prices.json holds USD/MYR 4.2 from Bank Negara Malaysia (2026-09-24)'
      && d7.code === 1 && same(file7.prices.USDMYR, withRate.prices.USDMYR) && stepOf(r7, 'fx') === 'failed'
      && fxLine(d7) === 'could not refresh — data/personal-prices.json holds USD/MYR 4.2 from Bank Negara Malaysia (2026-09-24)'
      && [[d6, r6], [d7, r7]].every(([d, r]) => detailOf(r, 'fx') === fxLine(d).replace(/^could not refresh — /, '') && !/previous rate is unchanged/.test(d.stdout)),
      'bugfix4 ingest: with FX down, daily.mjs says what USD/MYR rate the price file holds — "the previous rate is unchanged" was printed after an import that had replaced the file without it',
      { d6: [d6.code, fxLine(d6), detailOf(r6, 'fx'), file6.prices.USDMYR ?? null], d7: [d7.code, fxLine(d7), detailOf(r7, 'fx')] });
  } catch (e) {
    fail('bugfix4 ingest: the test threw', e.stack || e.message);
  } finally {
    await rm(BD, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end bugfix4: ingest ---- */

/* ---- bugfix5: ingest ---- */
/* AN IMPORT KEEPS THE RATE; A MERGE KEEPS THE FILE. prices.mjs replaced
   the price file with the rows it accepted, so every import — the daily
   run's, and the re-run daily.mjs tells the reader to make — dropped the
   USD/MYR rate fx.mjs had merged in, and ?personal=1 converted at the 4.42
   sample rate until fx.mjs next succeeded. The same input spelled ./ or .\
   kept no refused symbol's price, and a file saved with a byte-order mark
   read as no file (or, as a JSON input, crashed). fx.mjs took any file it
   could not read for a first run and wrote the rate alone over it, saying
   the other rows were left untouched; and it moved the file's as-of to the
   rate's date, which history.mjs then used for an undated close. No
   network: fetch is a stub, every file temporary. */
{
  const BD = join(tmpdir(), `qt-bugfix5-ingest-${process.pid}`);
  await rm(BD, { recursive: true, force: true });
  await mkdir(BD, { recursive: true });
  const node = (args, opts = {}) => run(process.execPath, args, { cwd: ROOT, ...opts }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  const HEAD = 'symbol,date,close,prev,move_pct,verdict,captured_at,bar_status,why,ocr_line\n';
  const RATE = { close: 4.2, date: '2026-09-24', d1: null, hi: null, lo: null, m12: null, src: 'Bank Negara Malaysia', crossChecked: null };
  const held = (source) => ({ generated: '2026-09-24T11:00:00.000Z', source, asOf: '2026-09-24', basis: 'end-of-day', licence: 'personal research', count: 3,
    prices: { AAA: { close: 214.3, date: '2026-09-24', capturedAt: '2026-09-24T10:30:00.000Z', d1: null, hi: null, lo: null, m12: null },
              BBB: { close: 10.1, date: '2026-09-24', capturedAt: '2026-09-24T10:30:00.000Z', d1: null, hi: null, lo: null, m12: null },
              USDMYR: RATE }, rejected: [] });
  const pp = join(BD, 'personal-prices.json');
  const readBook = async () => JSON.parse((await readFile(pp, 'utf8')).replace(/^\uFEFF/, ''));
  /* prices.mjs run from BD, so the input can be named as a reader types it. */
  const importAs = (inArg) => node([join(ROOT, 'ingest/prices.mjs'), '--in', inArg, '--out', pp, '--licence', 'personal research'], { cwd: BD });
  try {
    await writeFile(join(BD, 'watchlist-review.csv'), HEAD + 'AAA,2026-09-25,216.1,214.3,0.84,accept,2026-09-25T10:30:00.000Z,FINAL,,x\nBBB,2026-09-25,10.2,10.1,1,CHECK,2026-09-25T10:30:00.000Z,FINAL,conflict,x\n');

    /* The re-run as daily.mjs prints it: same input, same spelling. */
    await writeFile(pp, JSON.stringify(held('watchlist-review.csv')));
    const r1 = await importAs('watchlist-review.csv');
    const b1 = await readBook();
    /* A vendor's dump named by its day: a different input. */
    await writeFile(join(BD, 'eod-0925.csv'), 'symbol,date,close\nAAA,2026-09-25,216.1\n');
    await writeFile(pp, JSON.stringify(held('eod-0924.csv')));
    const r2 = await importAs('eod-0925.csv');
    const b2 = await readBook();
    /* An input that reads USD/MYR itself: accepted, it is the input's; held back, the rate stands. */
    await writeFile(join(BD, 'fx-screen.csv'), HEAD + 'AAA,2026-09-25,216.1,214.3,0.84,accept,2026-09-25T10:30:00.000Z,FINAL,,x\nUSDMYR,2026-09-25,4.215,4.2,0.36,accept,2026-09-25T10:30:00.000Z,FINAL,,x\n');
    await writeFile(pp, JSON.stringify(held('fx-screen.csv')));
    const r3 = await importAs('fx-screen.csv');
    const b3 = await readBook();
    await writeFile(join(BD, 'fx-check.csv'), HEAD + 'AAA,2026-09-25,216.1,214.3,0.84,accept,2026-09-25T10:30:00.000Z,FINAL,,x\nUSDMYR,2026-09-25,42.15,4.2,903,CHECK,2026-09-25T10:30:00.000Z,FINAL,implies +903%,x\n');
    await writeFile(pp, JSON.stringify(held('fx-check.csv')));
    const r4 = await importAs('fx-check.csv');
    const b4 = await readBook();
    check(r1.code === 0 && same(b1.prices.USDMYR, RATE) && same(b1.prices.BBB, held('').prices.BBB) && b1.prices.AAA?.close === 216.1 && b1.asOf === '2026-09-25' && b1.count === 3
      && /carried\s+: 1 row\(s\) naming their own source.*USDMYR 4\.2 from Bank Negara Malaysia \(2026-09-24\)/.test(r1.stdout)
      && r2.code === 0 && same(b2.prices.USDMYR, RATE) && !b2.prices.BBB && b2.asOf === '2026-09-25'
      && r3.code === 0 && b3.prices.USDMYR?.close === 4.215 && !b3.prices.USDMYR?.src && !/carried/.test(r3.stdout)
      && r4.code === 0 && same(b4.prices.USDMYR, RATE) && (b4.rejected || []).some(x => x.symbol === 'USDMYR'),
      'bugfix5 ingest: prices.mjs carries the USD/MYR rate fx.mjs merged in (a row naming its own source) into the file it writes, with its own date and without moving the file\'s as-of, whatever input wrote the file — every import, and the re-run daily.mjs prints, dropped it and ?personal=1 fell back to the 4.42 sample rate; a USD/MYR the input reads itself is still the input\'s',
      { r1: [r1.code, r1.stdout.slice(0, 500)], b1: b1.prices.USDMYR ?? null, b2: b2.prices.USDMYR ?? null, b3: b3.prices.USDMYR ?? null, b4: b4.prices.USDMYR ?? null });

    /* The same review file named as a reader types it. */
    const spelt = {};
    for (const s of ['./watchlist-review.csv', ...(process.platform === 'win32' ? ['.\\watchlist-review.csv', 'WATCHLIST-REVIEW.CSV'] : [])]) {
      await writeFile(pp, JSON.stringify(held('watchlist-review.csv')));
      const r = await importAs(s);
      const b = await readBook();
      spelt[s] = { code: r.code, bbb: b.prices.BBB?.close ?? null, kept: /kept\s+: 1 refused symbol/.test(r.stdout) };
    }
    check(Object.values(spelt).every(x => x.code === 0 && x.bbb === 10.1 && x.kept),
      'bugfix5 ingest: a refused symbol keeps its price when the same review file is named ./watchlist-review.csv or .\\watchlist-review.csv — the recorded source was compared as a string, so the refused symbol lost its price and with it the day-move check\'s baseline',
      spelt);

    /* A byte-order mark: on --out, and on a JSON input. */
    await writeFile(pp, '\uFEFF' + JSON.stringify(held('watchlist-review.csv')));
    const r5 = await importAs('watchlist-review.csv');
    const b5 = await readBook();
    await writeFile(join(BD, 'vendor.json'), '\uFEFF' + JSON.stringify({ prices: { AAA: { close: 216.1, date: '2026-09-25' } } }));
    const r6 = await node([join(ROOT, 'ingest/prices.mjs'), '--in', join(BD, 'vendor.json'), '--out', join(BD, 'vendor-out.json')]);
    const b6 = existsSync(join(BD, 'vendor-out.json')) ? JSON.parse(await readFile(join(BD, 'vendor-out.json'), 'utf8')) : null;
    check(r5.code === 0 && b5.prices.BBB?.close === 10.1 && same(b5.prices.USDMYR, RATE) && r6.code === 0 && b6?.prices?.AAA?.close === 216.1,
      'bugfix5 ingest: prices.mjs reads a JSON file that opens with a byte-order mark — an --out so saved read as no file, so the refused symbol\'s price and the rate were dropped, and a JSON input so saved crashed the import',
      { r5: r5.code, b5: Object.keys(b5.prices), r6: [r6.code, r6.stderr.slice(0, 200)] });

    /* fx.mjs against files it may not replace, on a stubbed fetch. */
    await writeFile(join(BD, 'fetch.mjs'), `globalThis.fetch = async (url) => {
  if (String(url).includes('bnm.gov.my')) return { ok: true, status: 200, json: async () => ({ data: { rate: { date: '2026-09-25', buying_rate: 4.2, selling_rate: 4.22, middle_rate: null } } }) };
  return { ok: true, status: 200, json: async () => ({ date: '2026-09-25', rates: { MYR: 4.2135 } }) };
};\n`);
    const fx = (out) => node(['--import', pathToFileURL(join(BD, 'fetch.mjs')).href, join(ROOT, 'ingest/fx.mjs'), '--out', out]);
    const good = JSON.stringify(held('watchlist-review.csv'), null, 2);
    const cases = {};
    for (const [k, text] of [['bom', '\uFEFF' + good], ['cut', good.slice(0, 120)], ['list', JSON.stringify({ prices: [{ symbol: 'AAA', close: 214.3 }] })]]) {
      const f = join(BD, `fx-${k}.json`);
      await writeFile(f, text);
      const r = await fx(f);
      const after = await readFile(f, 'utf8');
      let keys = null; try { keys = Object.keys(JSON.parse(after.replace(/^\uFEFF/, '')).prices); } catch { /* still damaged */ }
      cases[k] = { code: r.code, untouched: after === text, keys, err: r.stderr.trim().split('\n').pop() };
    }
    const fresh = join(BD, 'fx-new.json');
    const rn = await fx(fresh);
    const bn = existsSync(fresh) ? JSON.parse(await readFile(fresh, 'utf8')) : {};
    check(cases.bom.code === 0 && same(cases.bom.keys, ['AAA', 'BBB', 'USDMYR'])
      && cases.cut.code === 1 && cases.cut.untouched && /Refusing to write: .* not a price file .* not JSON/.test(cases.cut.err)
      && cases.list.code === 1 && cases.list.untouched && /not keyed by symbol/.test(cases.list.err)
      && rn.code === 0 && same(Object.keys(bn.prices || {}), ['USDMYR']) && bn.asOf === '2026-09-25',
      'bugfix5 ingest: fx.mjs merges into a price file saved with a byte-order mark and refuses, leaving it as it was, one cut short or holding its prices as a list — it took any file it could not read for a first run and wrote the rate alone over it ("other rows in the file were left untouched (1 symbols total)"); a missing file is still a new one',
      cases);

    /* An undated vendor close, then the rate, then the history. */
    await writeFile(join(BD, 'undated.csv'), 'symbol,close\n1155,9.87\n');
    const up = join(BD, 'undated.json'), uh = join(BD, 'undated-history.json'), ui = join(BD, 'instruments.json');
    await writeFile(ui, JSON.stringify({ instruments: [{ symbol: '1155', market: 'MY' }] }));
    const u1 = await node([join(ROOT, 'ingest/prices.mjs'), '--in', join(BD, 'undated.csv'), '--out', up]);
    const u2 = await fx(up);
    const ub = JSON.parse(await readFile(up, 'utf8'));
    const u3 = await node([join(ROOT, 'ingest/history.mjs'), '--in', up, '--out', uh, '--instruments', ui]);
    const uhist = existsSync(uh) ? JSON.parse(await readFile(uh, 'utf8')) : { series: {} };
    check(u1.code === 0 && u2.code === 0 && ub.asOf === null && ub.prices.USDMYR?.date === '2026-09-25' && ub.prices['1155']?.date === null
      && u3.code === 0 && !uhist.series?.['1155'] && /skipped\s+: 1 \(no usable close or date\)/.test(u3.stdout),
      'bugfix5 ingest: fx.mjs leaves the as-of of a file holding other rows alone — it set it to the rate\'s date, and history.mjs filed a close the vendor gave no date under the day Bank Negara published the rate',
      { asOf: ub.asOf, series: uhist.series, out: u3.stdout.slice(0, 300) });
  } catch (e) {
    fail('bugfix5 ingest: the test threw', e.stack || e.message);
  } finally {
    await rm(BD, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end bugfix5: ingest ---- */

/* ---- bugfix: merge ingest ---- */
/* THE TWO READERS AND THE WRITER THE FIFTH PASS NAMED OUTSIDE ITS FILES.
   live.mjs --quotes wrote its file whole from the quotes, so the USD/MYR rate
   fx.mjs had merged in (a row naming its own src) was lost, as prices.mjs's
   was before the fifth pass; and history.mjs and watchlist.mjs could not read
   a price file opening with a byte-order mark, which PowerShell 5.1 writes.
   A stubbed vendor; every file temporary. */
{
  const { run: runP } = { run };
  const MD = join(tmpdir(), `qt-merge-ingest-${process.pid}`);
  await rm(MD, { recursive: true, force: true });
  await mkdir(MD, { recursive: true });
  const nodeM = (args, opts = {}) => runP(process.execPath, args, { cwd: ROOT, ...opts }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  try {
    const stubPath = join(MD, 'td-stub.mjs');
    await writeFile(stubPath, "globalThis.fetch = async () => ({ ok: true, json: async () => ({ symbol: '1155', close: '10.5', timestamp: null, datetime: '2026-09-25', currency: 'MYR' }) });\n");
    const out = join(MD, 'personal-prices.json');
    const bnmRow = { close: 4.2, currency: 'MYR', date: '2026-09-24', src: 'Bank Negara Malaysia' };
    await writeFile(out, '﻿' + JSON.stringify({ generated: '2026-09-24T10:00:00Z', source: 'fx', prices: { USDMYR: bnmRow, OLD: { close: 1 } } }));
    const env = { ...process.env, TWELVEDATA_KEY: 'k' }; delete env.TWELVEDATA_REDIST;
    const q = await nodeM(['--import', pathToFileURL(stubPath).href, join(ROOT, 'ingest/live.mjs'), '--quotes', '--provider', 'twelvedata', '--symbols', '1155', '--out', out], { env });
    const doc = existsSync(out) ? JSON.parse(String(await readFile(out, 'utf8')).replace(/^﻿/, '')) : {};
    check(q.code === 0 && doc.prices?.['1155']?.close === 10.5 && doc.prices?.USDMYR?.close === 4.2 && doc.prices.USDMYR.src === 'Bank Negara Malaysia'
      && doc.prices.USDMYR.date === '2026-09-24' && !doc.prices.OLD && /carried\s+: 1 row/.test(q.stdout),
      'bugfix merge ingest: live.mjs --quotes keeps the USD/MYR rate fx.mjs merged into its file (a row naming its own source, with its own date), reads past a byte-order mark, and drops the rows it replaces',
      { code: q.code, prices: doc.prices, out: q.stdout.slice(-300), err: q.stderr.slice(-300) });

    const bomIn = join(MD, 'bom-prices.json');
    await writeFile(bomIn, '﻿' + JSON.stringify({ generated: '2026-09-25T10:30:00Z', source: 'review.csv', prices: { '1155': { close: 10.5, date: '2026-09-25', capturedAt: '2026-09-25T10:30:00Z' } } }));
    const hist = join(MD, 'price-history.json');
    const h = await nodeM([join(ROOT, 'ingest/history.mjs'), '--in', bomIn, '--out', hist]);
    const held = existsSync(hist) ? JSON.parse(await readFile(hist, 'utf8')) : {};
    check(h.code !== 1 && held.series?.['1155']?.['2026-09-25'] === 10.5,
      'bugfix merge ingest: history.mjs reads a price file that opens with a byte-order mark instead of failing with "Unexpected token"',
      { code: h.code, err: h.stderr.slice(-300), series: held.series });

    const wl = readFileSync(join(ROOT, 'ingest/watchlist.mjs'), 'utf8');
    check(/prev = JSON\.parse\(String\(await readFile\(baseline, 'utf8'\)\)\.replace\(\/\^\\uFEFF\/, ''\)\)/.test(wl),
      'bugfix merge ingest: watchlist.mjs reads its baseline past a byte-order mark, so the day-move gate has a previous close');
  } finally { await rm(MD, { recursive: true, force: true }); }
}
/* ---- end bugfix: merge ingest ---- */

/* ---- pine: tvimport ---- */
/* TRADINGVIEW EXPORTS, DATED BY THE SESSION EACH BAR CLOSES. TradingView
   stamps a daily bar at its session's opening. OANDA's gold day, like every
   currency pair's, opens at 17:00 New York the evening before, so the
   owner's export is stamped Sunday to Thursday: dated in the zone, Monday's
   bar was a Sunday (refused as NON_SESSION_DAY) and the rest a day early.
   Three shapes of stamp, on synthetic files whose sessions are worked out by
   hand in the comments beside them; every file temporary, no network, no
   personal data. */
{
  const TV = join(tmpdir(), `qt-tvimport-${process.pid}`);
  await rm(TV, { recursive: true, force: true });
  await mkdir(join(TV, 'exports'), { recursive: true });
  const { eveningOpen, sessionToday } = await import('./ingest/history-store.mjs');
  const { tradingViewName, isDailyInterval } = await import('./ingest/history-import.mjs');
  const nodeT = (args) => run(process.execPath, args, { cwd: ROOT }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  const sec = (iso) => String(Date.parse(iso) / 1000);
  try {
    /* The session rule, from the engine's own market rows. */
    const FX = E.scanMarket('FX');
    check(FX.tz === 'America/New_York' && FX.close === '17:00' && !FX.open && eveningOpen(FX) === 17 * 60
      && eveningOpen(E.scanMarket('US')) === null && eveningOpen(E.scanMarket('CRYPTO')) === null && eveningOpen(E.scanMarket(null)) === null
      && eveningOpen({ tz: 'America/New_York', open: '18:00', close: '17:00' }) === 18 * 60,
      'pine tvimport: a market whose day opens the evening before is read off its session — FX (no open, a 17:00 New York close) opens at 17:00; New York stocks, crypto and the default market open on the day itself; an open later than the close is an evening open too');
    const inst = JSON.parse(readFileSync(join(ROOT, 'data/instruments.json'), 'utf8')).instruments;
    check(marketOf('XAUUSD', inst) === 'FX' && marketOf('OANDA:XAUUSD', inst) === 'FX' && marketOf('GOLD', inst) === 'FX',
      'pine tvimport: the registry puts OANDA\'s spot gold (XAUUSD, also OANDA:XAUUSD) on FX, the 24-hour session closing 17:00 New York — on COM it fell to the default market\'s UTC day');
    /* 1790542800 is the owner's last stamp: Sunday 27 September 2026, 21:00
       UTC = 17:00 New York (daylight time), the opening of Monday's session. */
    const dated = (cell, market) => parseDateCell(cell, { tz: E.scanMarket(market).tz, session: E.scanMarket(market) }).date;
    check(parseDateCell('1790542800', { tz: 'America/New_York' }).date === '2026-09-27' && dated('1790542800', 'FX') === '2026-09-28'
      && dated('2026-09-27T17:00:00-04:00', 'FX') === '2026-09-28' && dated('2026-09-24T16:59:00-04:00', 'FX') === '2026-09-24',
      'pine tvimport: the stamp 1790542800 (Sunday 17:00 New York) is Monday 28 September\'s bar on FX, as an epoch and as an ISO time with its offset; without the session it was the Sunday; 16:59 is still its own day');

    /* Three exports named as TradingView names them, and the registry they are read against. */
    const reg = join(TV, 'instruments.json');
    await writeFile(reg, JSON.stringify({ instruments: [{ symbol: 'GLD', market: 'FX' }, { symbol: 'STK', market: 'US' }, { symbol: 'BTC', market: 'CRYPTO' }] }));
    const csv = (stamps) => ['time,open,high,low,close,Plot,Volume,RSI', ...stamps.map((s, i) => `${sec(s)},${100 + i},${102 + i},${99 + i},${101 + i},5,${1000 + i},50`)].join('\n');
    /* Gold, FX. Session by hand (New York wall clock; 17:00 or later is the next day):
         0 2026-01-04T22:00Z  Sun 17:00 EST        → Mon 2026-01-05
         1 2026-01-06T05:00Z  Tue 00:00 EST        → Tue 2026-01-06 (a vendor's local midnight)
         2 2026-01-07T00:00Z  midnight UTC         → Wed 2026-01-07 (Tue 19:00 EST: both rules agree)
         3 2026-01-08T22:00Z  Thu 17:00 EST        → Fri 2026-01-09
         4 2026-01-09T22:00Z  Fri 17:00 EST        → Sat 2026-01-10, refused NON_SESSION_DAY (never moved onto Monday)
         5 2026-03-05T22:00Z  Thu 17:00 EST        → Fri 2026-03-06
         6 2026-03-08T21:00Z  Sun 17:00 EDT (the day the clocks went forward) → Mon 2026-03-09
         7 2026-09-24T20:59Z  Thu 16:59 EDT        → Thu 2026-09-24
         8 2026-09-24T21:00Z  Thu 17:00 EDT        → Fri 2026-09-25
         9 2026-09-27T21:00Z  Sun 17:00 EDT        → Mon 2026-09-28, still trading when saved (13:41 UTC Monday) */
    const gold = ['2026-01-04T22:00:00Z', '2026-01-06T05:00:00Z', '2026-01-07T00:00:00Z', '2026-01-08T22:00:00Z', '2026-01-09T22:00:00Z',
                  '2026-03-05T22:00:00Z', '2026-03-08T21:00:00Z', '2026-09-24T20:59:00Z', '2026-09-24T21:00:00Z', '2026-09-27T21:00:00Z'];
    /* A New York stock stamped at its own 09:30 open is that day, Friday included:
         2026-01-05T14:30Z Mon, 2026-01-09T14:30Z Fri, 2026-03-09T13:30Z Mon (EDT), 2026-09-25T13:30Z Fri,
         and 2026-09-28T00:00Z (midnight UTC, the other convention) Mon 28 September. */
    const stock = ['2026-01-05T14:30:00Z', '2026-01-09T14:30:00Z', '2026-03-09T13:30:00Z', '2026-09-25T13:30:00Z', '2026-09-28T00:00:00Z'];
    /* Crypto at 00:00 UTC is that day, Saturday and Sunday included. */
    const coin = ['2026-09-26T00:00:00Z', '2026-09-27T00:00:00Z', '2026-09-28T00:00:00Z'];
    const files = { 'OANDA_GLD, 1D.csv': [gold, '2026-09-28T13:41:00Z'], 'NASDAQ_STK, 1D.csv': [stock, '2026-09-28T21:00:00Z'],
                     'BINANCE_BTC, 1D.csv': [coin, '2026-09-28T13:41:00Z'], 'OANDA_GLD, 1W.csv': [['2026-09-20T21:00:00Z'], '2026-09-28T13:41:00Z'] };
    for (const [name, [stamps, saved]] of Object.entries(files)) {
      const p = join(TV, 'exports', name);
      await writeFile(p, csv(stamps));
      await utimes(p, new Date(saved), new Date(saved));        /* the export's only capture time is its file's */
    }
    const out = join(TV, 'history.json');
    const r = await nodeT([join(ROOT, 'ingest/history-import.mjs'), '--dir', join(TV, 'exports'), '--instruments', reg, '--out', out]);
    const h = existsSync(out) ? JSON.parse(await readFile(out, 'utf8')) : { series: {}, ohlc: {}, volume: {}, meta: {} };
    const days = (s) => Object.keys(h.series[s] || {}).sort();
    const rej = existsSync(rejectsPathFor(out)) ? JSON.parse(await readFile(rejectsPathFor(out), 'utf8')).rejects : [];
    check(same(days('GLD'), ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-09', '2026-03-06', '2026-03-09', '2026-09-24', '2026-09-25', '2026-09-28'])
      && rej.length === 1 && rej[0].symbol === 'GLD' && rej[0].date === '2026-01-10' && same(rej[0].codes, ['NON_SESSION_DAY'])
      && days('GLD').every(d => [1, 2, 3, 4, 5].includes(E.scanWeekday(d))),
      'pine tvimport: gold on FX — a stamp at or after 17:00 New York is the next day\'s session (Sunday → Monday, Thursday → Friday, across both clock changes), one before it is its own day, and a Friday 17:00 stamp opens a Saturday that is refused, not filed on Monday',
      { gld: days('GLD'), rej, err: r.stderr.slice(-300) });
    check(same(days('STK'), ['2026-01-05', '2026-01-09', '2026-03-09', '2026-09-25', '2026-09-28']) && same(days('BTC'), ['2026-09-26', '2026-09-27', '2026-09-28']),
      'pine tvimport: a New York stock stamped at its own 09:30 open is that day (Friday stays Friday), midnight UTC its UTC date, and crypto at 00:00 UTC that day, weekend included',
      { stk: days('STK'), btc: days('BTC') });
    /* Row 9 of the gold file: open 109, high 111, low 108, close 110, volume 1009. */
    check(h.series.GLD?.['2026-09-28'] === 110 && same(h.ohlc.GLD?.['2026-09-28'], [109, 111, 108]) && h.volume.GLD?.['2026-09-28'] === 1009
      && !JSON.stringify(h).includes('"Plot"') && !JSON.stringify(h).includes('"RSI"') && same(Object.keys(h.series).sort(), ['BTC', 'GLD', 'STK']),
      'pine tvimport: each bar\'s open, high, low, close and volume are stored under its session; the indicator columns are not, and the symbol is read from TradingView\'s file name ("OANDA_GLD, 1D.csv" is GLD)',
      { close: h.series.GLD?.['2026-09-28'], ohlc: h.ohlc.GLD?.['2026-09-28'], vol: h.volume.GLD?.['2026-09-28'], syms: Object.keys(h.series) });
    const at = h.meta.GLD?.['2026-09-28']?.at;
    check(at === '2026-09-28T13:41:00.000Z' && E.scanBarStatus('FX', '2026-09-28', at) === 'PROVISIONAL' && E.scanBarStatus('FX', '2026-09-25', h.meta.GLD['2026-09-25'].at) === 'FINAL'
      && E.scanBarStatus('US', '2026-09-28', h.meta.STK?.['2026-09-28']?.at) === 'FINAL' && E.scanBarStatus('CRYPTO', '2026-09-28', h.meta.BTC?.['2026-09-28']?.at) === 'PROVISIONAL',
      'pine tvimport: the file\'s modification time is each bar\'s capture time, so gold\'s Monday bar, saved at 09:41 New York, is PROVISIONAL and the Friday before it FINAL; the stock saved after its close is FINAL',
      { at, stk: h.meta.STK?.['2026-09-28'], btc: h.meta.BTC?.['2026-09-28'] });
    const line = (sym) => r.stdout.split('\n').find(l => l.startsWith(sym.padEnd(10)) && /points/.test(l)) || '';
    check(r.code === 2 && /volume kept \(a tick count\)/.test(line('GLD')) && /volume kept(?! \()/.test(line('STK')) && /volume    : a tick count for GLD — /.test(r.stdout) && !/tick count for [^\n]*STK/.test(r.stdout)
      && /dated by session: 7 stamp\(s\) at 17:00 America\/New_York or later/.test(r.stdout)
      && /last bar 2026-09-28 PROVISIONAL/.test(r.stdout) && /last bar 2026-09-28 FINAL/.test(r.stdout)
      && /not stored: 2 other column\(s\) — the chart's indicators \(Plot, RSI\)/.test(r.stdout)
      /* The weekly file was refused by its name until the owner chose to
         import weeks and months as they are (2026-09-29): it now goes to
         frames['1W'], never to the daily series (the frames block below). */
      && /GLD 1W +1 new/.test(r.stdout) && !/FAILED/.test(r.stdout),
      'pine tvimport: the output says gold\'s volume is a tick count (a spot metals broker\'s count of price changes) and the stock\'s is not, how many stamps were dated to the next session, each file\'s last bar and its status, the indicator columns left out, and reads a weekly export by its name into the weekly frame',
      r.stdout.slice(0, 1500));
    check(same(tradingViewName('OANDA_XAUUSD, 1D.csv'), { exchange: 'OANDA', symbol: 'XAUUSD', interval: '1D' }) && tradingViewName('FX_IDC_USDMYR, 1D (1).csv')?.symbol === 'USDMYR'
      && tradingViewName('KLSE.csv') === null && isDailyInterval('1D') && isDailyInterval('D') && !isDailyInterval('1W') && !isDailyInterval('240'),
      'pine tvimport: TradingView\'s file name gives the exchange, the symbol and the interval (an exchange may hold an underscore; a browser\'s " (1)" is dropped); any other name is not read as one');

    /* FUTURE is judged by the session that has begun. At Sunday 18:00 New York
       (22:00 UTC; Monday 06:00 in Kuala Lumpur) FX trades Monday's session;
       New York stocks are still on Sunday. */
    const now = '2026-09-27T22:00:00Z';
    const hf = emptyHistory();
    const mf = mergeBars(hf, 'GLD', [{ date: '2026-09-28', close: 10 }, { date: '2026-09-29', close: 10 }], { source: 'import:x.csv', capturedAt: now, market: 'FX', E, now });
    const mu = mergeBars(hf, 'STK', [{ date: '2026-09-28', close: 10 }], { source: 'import:y.csv', capturedAt: now, market: 'US', E, now });
    check(mf.added === 1 && hf.series.GLD?.['2026-09-28'] === 10 && same(mf.rejected.map(x => [x.date, x.codes]), [['2026-09-29', ['FUTURE']]])
      && same(mu.rejected.map(x => x.codes), [['FUTURE']])
      && sessionToday(E, 'FX', '2026-09-27T20:59:00Z') === '2026-09-27' && sessionToday(E, 'FX', '2026-09-27T21:00:00Z') === '2026-09-28'
      && sessionToday(E, 'CRYPTO', now) === '2026-09-27' && sessionToday(E, 'US', now) === '2026-09-27',
      'pine tvimport: an export or reading made at 18:00 New York on a Sunday keeps Monday\'s in-progress FX bar — the store refused it as FUTURE though readingSession dates it there — and still refuses Tuesday, and a New York stock\'s Monday',
      { gld: mf.rejected, stk: mu.rejected });
  } catch (e) {
    fail('pine tvimport: the test threw', e.stack || e.message);
  } finally {
    await rm(TV, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end pine: tvimport ---- */

/* ---- integration: pine ingest ---- */
/* Spot gold is imported from the owner's OANDA export on the FX session; the
   Yahoo map in live.mjs sent XAUUSD to GC=F, COMEX's front-month future, so a
   --history run wrote futures closes over the spot series. It stays unmapped,
   as the other instruments Yahoo does not carry do. */
{
  const live = readFileSync(join(ROOT, 'ingest/live.mjs'), 'utf8');
  const map = live.slice(live.indexOf('/* commodities'), live.indexOf('/* crypto'));
  check(map.length > 0 && !map.split(' ').join('').includes('XAUUSD:'),
    'integration pine: live.mjs maps no Yahoo symbol to XAUUSD — spot gold is not replaced by COMEX futures (GC=F)', map.trim().slice(0, 200));
}
/* An import written elsewhere (--out) keeps its refused rows beside that
   file, and says so: the summary always named data/price-history.rejects.json. */
{
  const RD = join(tmpdir(), `qt-int-rejects-${process.pid}`);
  await rm(RD, { recursive: true, force: true });
  await mkdir(RD, { recursive: true });
  try {
    const csv = join(RD, 'TST.csv');
    await writeFile(csv, 'time,open,high,low,close\n2026-09-24,1,1,1,1\n2026-09-25,1,1,1,-5\n');
    const out = join(RD, 'h.json');
    let r;
    try { const { stdout, stderr } = await run(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), '--in', csv, '--symbol', 'TST', '--out', out], { cwd: ROOT }); r = { code: 0, stdout, stderr }; }
    catch (e) { r = { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; }
    const beside = join(RD, 'h.rejects.json');
    check(r.stdout.includes(`every refused row is in ${beside}`) && existsSync(beside) && !r.stdout.includes('every refused row is in data/price-history.rejects.json'),
      'integration pine: an import written with --out names the rejects file it wrote beside that history, not the default one',
      { code: r.code, out: r.stdout.split('\n').filter(l => /refused|rejects/.test(l)) });
  } finally { await rm(RD, { recursive: true, force: true }); }
}
/* ---- end integration: pine ingest ---- */

/* ---- frames ---- */
/* IMPORTED WEEKS AND MONTHS. The owner's decision (2026-09-29): a weekly or
   monthly TradingView export is imported as it is, into hist.frames['1W' |
   '1M'][SYM], keyed by the engine's own period key, instead of weeks and
   months being built only from a daily file that reaches back fourteen
   months. Every export here is synthetic, its sessions worked out by hand
   in the comments beside it; every file is temporary; no personal file is
   read. */
{
  const FR = join(tmpdir(), `qt-frames-${process.pid}`);
  await rm(FR, { recursive: true, force: true });
  await mkdir(join(FR, 'exports'), { recursive: true });
  const { readdir } = await import('node:fs/promises');
  const S = await import('./ingest/history-store.mjs');
  const { mergeFrameBars, trimFrames, periodKey, periodStatus, periodLastSession, isPeriodKey, formatHistory, STORE_ENGINE_NAMES } = S;
  const { exportTimeframe, FRAMES_READ } = await import('./ingest/history-import.mjs');
  const { checkFrames, compareFrames, describeOverlap, describeFrames } = await import('./ingest/history-check.mjs');
  const nodeF = (args) => run(process.execPath, args, { cwd: ROOT }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  const sec = (iso) => String(Date.parse(iso) / 1000);
  const readJson = async (p) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null);
  try {
    /* ------------------------------------------------ the engine's keys -- */
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    check(STORE_ENGINE_NAMES.every(n => typeof E[n] === 'function' && html.includes(String(E[n])))
      && periodKey(E, '1W', '2026-09-24') === '2026-09-21' && periodKey(E, 'weekly', '2026-09-27') === '2026-09-21' && periodKey(E, '1M', '2026-09-24') === '2026-09-01'
      && periodKey(E, '1W', '2026-9-24') === null && periodKey(E, '1D', '2026-09-24') === null
      && isPeriodKey(E, '1W', '2026-09-21') && !isPeriodKey(E, '1W', '2026-09-22') && isPeriodKey(E, '1M', '2026-08-01') && !isPeriodKey(E, '1M', '2026-08-03'),
      'frames: a week is keyed by the engine\'s scanWeekOf (its Monday) and a month by scanMonthOf (its 1st) — the functions in index.html\'s engine region, not a copy; a Sunday belongs to the week before, and a day that is no day has no key');
    /* A period is final once its last expected session has closed: FX closes
       at 17:00 New York (21:00 UTC in summer) with no settle; New York
       stocks at 16:00 plus 30 minutes. */
    check(periodStatus(E, '1W', '2026-09-21', 'FX', '2026-09-25T20:59:00Z') === 'PROVISIONAL' && periodStatus(E, '1W', '2026-09-21', 'FX', '2026-09-25T21:00:00Z') === 'FINAL'
      && periodLastSession(E, '1M', '2026-08-01', 'FX') === '2026-08-31' && periodLastSession(E, '1M', '2026-09-01', 'FX') === '2026-09-30'
      && periodStatus(E, '1M', '2026-09-01', 'FX', '2026-09-28T17:27:00Z') === 'PROVISIONAL' && periodStatus(E, '1M', '2026-08-01', 'FX', '2026-09-28T17:27:00Z') === 'FINAL'
      && periodStatus(E, '1W', '2026-09-14', 'US', '2026-09-18T20:29:00Z') === 'PROVISIONAL' && periodStatus(E, '1W', '2026-09-14', 'US', '2026-09-18T20:30:00Z') === 'FINAL'
      && periodStatus(E, '1W', '2026-09-21', 'FX', null) === 'UNKNOWN',
      'frames: an imported week or month is FINAL only when captured after its last expected session closed (Friday 17:00 New York for gold, the month\'s last weekday), PROVISIONAL before, UNKNOWN with no capture time');
    check(exportTimeframe('1D') === '1D' && exportTimeframe('D') === '1D' && exportTimeframe('1W') === '1W' && exportTimeframe('W') === '1W' && exportTimeframe('1M') === '1M'
      && exportTimeframe('1m') === null && exportTimeframe('240') === null && exportTimeframe('2W') === null && exportTimeframe('3M') === null,
      'frames: an export\'s timeframe is the day, the week or the month (1D, 1W, 1M as TradingView names them); a lower-case 1m (a minute elsewhere), 240 and multi-period intervals are none of them');

    /* ------------------------------------------- the import, by the name -- */
    const reg = join(FR, 'instruments.json');
    await writeFile(reg, JSON.stringify({ instruments: [{ symbol: 'GLD', market: 'FX' }, { symbol: 'DUP', market: 'FX' }, { symbol: 'GLDM', market: 'FX' }, { symbol: 'STK', market: 'US' }] }));
    const csv = (rows) => ['time,open,high,low,close,Volume,Plot', ...rows.map(([t, o, h, l, c, v]) => `${sec(t)},${o},${h},${l},${c},${v},7`)].join('\n');
    const put = async (name, rows, saved) => { const p = join(FR, 'exports', name); await writeFile(p, csv(rows)); await utimes(p, new Date(saved), new Date(saved)); return p; };
    /* Gold's weeks on FX. TradingView stamps a week at its opening, Sunday
       17:00 New York; the day rule dates that to Monday, the week's key:
         2026-01-04T22:00Z  Sun 17:00 EST                         → week 2026-01-05
         2026-03-08T21:00Z  Sun 17:00 EDT (the clocks' change day) → week 2026-03-09
         2026-08-30T21:00Z  high 107 below the open and close      → refused HIGH_BELOW
         2026-09-13T21:00Z                                         → week 2026-09-14
         2026-09-20T21:00Z                                         → week 2026-09-21
         2026-09-27T21:00Z  saved Monday 13:27 New York            → week 2026-09-28, PROVISIONAL
         2026-09-25T21:00Z  Fri 17:00 opens a Saturday             → refused NON_SESSION_DAY, never filed in a week */
    const gW = [['2026-01-04T22:00:00Z', 100, 110, 95, 105, 1000], ['2026-03-08T21:00:00Z', 105, 112, 101, 108, 1100], ['2026-08-30T21:00:00Z', 108, 107, 100, 109, 900],
                ['2026-09-13T21:00:00Z', 110, 115, 108, 112, 1200], ['2026-09-20T21:00:00Z', 112, 118, 111, 117, 1300], ['2026-09-27T21:00:00Z', 117, 119, 114, 115, 400],
                ['2026-09-25T21:00:00Z', 1, 1, 1, 1, 1]];
    const gWp = await put('OANDA_GLD, 1W.csv', gW, '2026-09-28T17:27:00Z');
    /* Gold's months: stamped the evening before each month's first session.
         2026-06-30T21:00Z  Tue 17:00 → Wed 1 July      → 2026-07-01, volume 0 with a range of 30: no count
         2026-08-02T21:00Z  Sun 17:00 → Mon 3 August    → 2026-08-01 (1 August was a Saturday)
         2026-08-31T21:00Z  Mon 17:00 → Tue 1 September → 2026-09-01, PROVISIONAL (its last session is the 30th) */
    await put('OANDA_GLD, 1M.csv', [['2026-06-30T21:00:00Z', 100, 120, 90, 110, 0], ['2026-08-02T21:00:00Z', 110, 125, 105, 120, 5000], ['2026-08-31T21:00:00Z', 120, 122, 110, 115, 3000]], '2026-09-28T17:27:00Z');
    /* A New York stock's weeks, stamped at its first session's 09:30 open:
       Labor Day (7 September) moves the stamp to the Tuesday, still week
       2026-09-07. Its daily file goes to the daily series as before. */
    await put('NASDAQ_STK, 1W.csv', [['2026-09-08T13:30:00Z', 50, 55, 49, 54, 10], ['2026-09-14T13:30:00Z', 54, 58, 53, 57, 12]], '2026-09-28T21:00:00Z');
    await put('NASDAQ_STK, 1D.csv', [['2026-09-14T13:30:00Z', 54, 55, 53, 54.5, 3], ['2026-09-15T13:30:00Z', 54.5, 56, 54, 55, 4]], '2026-09-28T21:00:00Z');
    /* Two stamps in one week (Monday's and Tuesday's sessions): a daily file
       named as a weekly one. Neither is guessed to be the week. */
    await put('OANDA_DUP, 1W.csv', [['2026-09-20T21:00:00Z', 10, 11, 9, 10, 1], ['2026-09-21T21:00:00Z', 10, 12, 9, 11, 1]], '2026-09-28T17:27:00Z');
    await put('OANDA_GLD, 240.csv', [['2026-09-20T21:00:00Z', 10, 11, 9, 10, 1]], '2026-09-28T17:27:00Z');
    const out = join(FR, 'history.json');
    const r1 = await nodeF([join(ROOT, 'ingest/history-import.mjs'), '--dir', join(FR, 'exports'), '--instruments', reg, '--out', out]);
    const h = (await readJson(out)) || {};
    const W = h.frames?.['1W']?.GLD || {}, M = h.frames?.['1M']?.GLD || {};
    check(same(Object.keys(W.series || {}).sort(), ['2026-01-05', '2026-03-09', '2026-09-14', '2026-09-21', '2026-09-28'])
      && same(W.ohlc?.['2026-09-28'], [117, 119, 114]) && W.series['2026-09-28'] === 115 && W.volume?.['2026-09-28'] === 400
      && W.meta?.['2026-09-28']?.src === 'import:OANDA_GLD, 1W.csv' && W.meta['2026-09-28'].at === '2026-09-28T17:27:00.000Z' && W.meta['2026-09-28'].adjusted === 'unknown'
      && !h.series?.GLD && !JSON.stringify(h.frames).includes('"Plot"'),
      'frames: gold\'s weekly export is filed under each week\'s Monday in frames["1W"] — stamped Sunday 17:00 New York in both halves of the year — with open, high, low, volume and the file\'s time as its capture; nothing reaches the daily series',
      { keys: Object.keys(W.series || {}), series: Object.keys(h.series || {}), err: r1.stderr.slice(-300) });
    check(same(Object.keys(M.series || {}).sort(), ['2026-07-01', '2026-08-01', '2026-09-01']) && M.volume?.['2026-07-01'] === undefined && M.volume?.['2026-08-01'] === 5000
      && periodStatus(E, '1M', '2026-08-01', 'FX', M.meta?.['2026-08-01']?.at) === 'FINAL' && periodStatus(E, '1M', '2026-09-01', 'FX', M.meta?.['2026-09-01']?.at) === 'PROVISIONAL'
      && periodStatus(E, '1W', '2026-09-21', 'FX', W.meta?.['2026-09-21']?.at) === 'FINAL' && periodStatus(E, '1W', '2026-09-28', 'FX', W.meta?.['2026-09-28']?.at) === 'PROVISIONAL',
      'frames: the monthly export is filed under each month\'s 1st (August\'s first session was the 3rd); the month and the week still trading when saved are PROVISIONAL, the rest FINAL; a volume of 0 on a month whose price moved is stored as absent, not as a month with no trading',
      { keys: Object.keys(M.series || {}), vol: M.volume });
    check(same(Object.keys(h.frames?.['1W']?.STK?.series || {}).sort(), ['2026-09-07', '2026-09-14']) && same(Object.keys(h.series?.STK || {}).sort(), ['2026-09-14', '2026-09-15'])
      && !h.frames?.['1W']?.DUP,
      'frames: a New York stock\'s week stamped on the Tuesday after a Monday holiday is still its Monday\'s week; its daily file goes to the daily series as before; two stamps in one week file neither',
      { stk: h.frames?.['1W']?.STK, dup: h.frames?.['1W']?.DUP });
    const rej = (await readJson(S.rejectsPathFor(out)))?.rejects || [];
    const rw = (sym, code) => rej.filter(x => x.symbol === sym && x.codes.includes(code));
    check(rw('GLD', 'HIGH_BELOW').length === 1 && rw('GLD', 'HIGH_BELOW')[0].timeframe === '1W' && rw('GLD', 'HIGH_BELOW')[0].period === '2026-08-31' && rw('GLD', 'HIGH_BELOW')[0].date === '2026-08-31'
      && rw('GLD', 'NON_SESSION_DAY').length === 1 && rw('GLD', 'NON_SESSION_DAY')[0].date === '2026-09-26' && rw('GLD', 'NON_SESSION_DAY')[0].period === null
      && rw('DUP', 'DUPLICATE_PERIOD').length === 2 && rej.length === 4,
      'frames: every refused weekly row is in the rejects file with its timeframe and code — HIGH_BELOW (the engine\'s scanValidateBar, on the session the stamp opens), NON_SESSION_DAY with no period, and DUPLICATE_PERIOD for both rows of a week given twice',
      rej.map(x => [x.symbol, x.timeframe, x.date, x.period, x.codes]));
    check(r1.code === 2 && /GLD 1W +5 new +0 -> +5 weeks +2026-01-05 to 2026-09-28 +open\/high\/low kept, volume kept \(a tick count\)/.test(r1.stdout)
      && /last week 2026-09-28 PROVISIONAL — the file was saved at 2026-09-28T17:27:00.000Z, before the week's last session \(2026-10-02\) closed/.test(r1.stdout)
      && /GLD 1M +3 new .* 3 months/.test(r1.stdout) && /last month 2026-09-01 PROVISIONAL/.test(r1.stdout)
      && /volume 0 on 1 month\(s\) whose price moved \(2026-07-01 … 2026-07-01\): the broker recorded no count/.test(r1.stdout)
      && /STK 1W .*\n.*last week 2026-09-14 FINAL/.test(r1.stdout) && /GLD +FAILED — the file name says a 240 export/.test(r1.stdout)
      && r1.stdout.includes(`imported frames: `) && r1.stdout.includes(FRAMES_READ) && /GLD 1W 2026-08-31: HIGH_BELOW/.test(r1.stdout),
      'frames: the import names each weekly and monthly file\'s periods, its last period and why it is provisional, the months with no count, what reads the frames today, and still refuses a 240-minute export by its name',
      r1.stdout.slice(0, 2500));

    /* ------------------------- the next export: finalised, then corrected -- */
    /* Saved after the week of 28 September closed (Friday 2 October 17:00 New
       York): the in-progress week is superseded, not corrected; the week of
       21 September, final at the first import, now reads 117.5 — an equal
       rank disagreeing, recorded in the frame's own corrections, never in
       the daily ones. */
    await put('OANDA_GLD, 1W.csv', gW.map(x => (x[0] === '2026-09-20T21:00:00Z' ? [x[0], 112, 118, 111, 117.5, 1300] : x[0] === '2026-09-27T21:00:00Z' ? [x[0], 117, 121, 113, 120, 1500] : x)), '2026-10-03T00:00:00Z');
    const r2 = await nodeF([join(ROOT, 'ingest/history-import.mjs'), '--in', gWp, '--instruments', reg, '--out', out]);
    const h2 = (await readJson(out)) || {};
    const W2 = h2.frames?.['1W']?.GLD || {};
    check(W2.series?.['2026-09-28'] === 120 && periodStatus(E, '1W', '2026-09-28', 'FX', W2.meta?.['2026-09-28']?.at) === 'FINAL'
      && same(W2.corrections?.map(c => [c.date, c.field, c.from, c.to]), [['2026-09-21', 'close', 117, 117.5]]) && !h2.corrections?.GLD
      && /finalised : 1 provisional bar\(s\) replaced by a later capture/.test(r2.stdout) && /corrected : 1 field\(s\)/.test(r2.stdout)
      && existsSync(`${out}.bak`) && JSON.parse(await readFile(`${out}.bak`, 'utf8')).frames['1W'].GLD.series['2026-09-28'] === 115,
      'frames: a later export replaces the week that was still trading (superseded, not a correction) and records a changed close on a final week in the frame\'s corrections; the write keeps the previous file as .bak',
      { series: W2.series, corrections: W2.corrections, out: r2.stdout.split('\n').filter(l => /finalised|corrected/.test(l)) });

    /* ---------------------------------------------------- --interval -- */
    const plain = join(FR, 'gold-months.csv');
    await writeFile(plain, csv([['2026-08-02T21:00:00Z', 110, 125, 105, 120, 5000]]));
    const r3 = await nodeF([join(ROOT, 'ingest/history-import.mjs'), '--in', plain, '--symbol', 'GLDM', '--interval', '1M', '--instruments', reg, '--out', out]);
    const r4 = await nodeF([join(ROOT, 'ingest/history-import.mjs'), '--in', gWp, '--interval', '1M', '--instruments', reg, '--out', out]);
    const r5 = await nodeF([join(ROOT, 'ingest/history-import.mjs'), '--in', plain, '--interval', '3M', '--out', out]);
    const h3 = (await readJson(out)) || {};
    check(same(Object.keys(h3.frames?.['1M']?.GLDM?.series || {}), ['2026-08-01']) && r4.code === 1 && /FAILED — the file name says 1W and --interval says 1M/.test(r4.stdout)
      && r5.code === 1 && /--interval "3M" is not 1D, 1W or 1M/.test(r5.stderr),
      'frames: --interval 1M reads a file whose name says nothing into the monthly frame; a TradingView name and a flag that disagree are refused, not guessed between; an interval that is not 1D, 1W or 1M is refused',
      { r4: r4.stdout.slice(0, 300), r5: r5.stderr });

    /* ------------------------------------------------- rank, trim, format -- */
    {
      const hh = { ...emptyHistory(), frames: JSON.parse(JSON.stringify(h3.frames)) };
      const heldClose = hh.frames['1W'].GLD.series['2026-09-14'];
      const o = mergeFrameBars(hh, 'weekly', 'GLD', [{ date: '2026-09-14', open: 1, high: 999, low: 1, close: 999 }], { source: 'screen', capturedAt: '2026-10-03T00:00:00Z', market: 'FX', E, now: '2026-10-03T00:00:00Z' });
      check(o.timeframe === '1W' && o.outranked.length === 1 && o.outranked[0].timeframe === '1W' && hh.frames['1W'].GLD.series['2026-09-14'] === heldClose,
        'frames: the source rank holds for weeks — a screen reading never replaces an imported week; it is reported as outranked, with its timeframe');
      let threw = ''; try { mergeFrameBars(hh, '1D', 'GLD', [], { source: 'import:x.csv', E }); } catch (e) { threw = e.message; }
      check(/holds 1W and 1M bars, not "1D"/.test(threw), 'frames: the frame merge refuses a timeframe it does not hold (1D goes to mergeBars)', threw);
      const t = trimFrames(hh, 2);
      check(t.trimmed === 3 + 1 && same(Object.keys(hh.frames['1W'].GLD.series).sort(), ['2026-09-21', '2026-09-28'])
        && ['ohlc', 'volume', 'meta'].every(m => Object.keys(hh.frames['1W'].GLD[m]).every(k => k >= '2026-09-21'))
        && hh.frames['1W'].GLD.corrections.length === 1 && same(Object.keys(hh.frames['1M'].GLD.series).sort(), ['2026-08-01', '2026-09-01']),
        'frames: trimming keeps the newest periods of every frame, dropping close, open/high/low, volume and provenance together', t);
    }
    {
      const p = join(FR, 'daily-write.json');
      await writeFile(p, await readFile(out, 'utf8'));
      const before = JSON.stringify((await readJson(p)).frames);
      await S.updateHistory(p, (hist) => [mergeBars(hist, 'STK', [{ date: '2026-09-16', open: 55, high: 56, low: 54, close: 55.5 }], { source: 'import:d.csv', capturedAt: '2026-09-28T21:00:00Z', market: 'US', E, now: '2026-09-28T21:00:00Z' })], { keep: 1 });
      const after = await readJson(p);
      const text = await readFile(p, 'utf8');
      check(JSON.stringify(after.frames) === before && Object.keys(after.series.STK).length === 1
        && /\n  "frames": \{\n    "1M": \{\n      "GLD": \{\n        "series": \{[^\n]*\},\n        "ohlc": /.test(text),
        'frames: a daily writer (here keeping one session) leaves the imported weeks and months exactly as they were — its keep is the daily one — and the file writes each frame\'s maps one per line');
      const d = join(FR, 'daily-only.json');
      const dh = emptyHistory();
      mergeBars(dh, 'A', [{ date: '2026-09-21', close: 1 }], { source: 'screen', market: 'US', E, now: NOW });
      await S.saveHistory(d, dh, { now: NOW });
      check(!(await readFile(d, 'utf8')).includes('frames') && !('frames' in (await S.loadHistory(d))),
        'frames: a history with no imported weeks or months is written without a frames key, as it was before');
    }

    /* ------------------------------------------------------- the check -- */
    {
      const inst = [{ symbol: 'GLD', market: 'FX' }, { symbol: 'GLDM', market: 'FX' }, { symbol: 'STK', market: 'US' }];
      const clean = checkFrames(h3, { E, instruments: inst, now: '2026-10-03T00:00:00Z' });
      const g = clean.frames.find(x => x.timeframe === '1W' && x.symbol === 'GLD');
      const gm = clean.frames.find(x => x.timeframe === '1M' && x.symbol === 'GLD');
      check(clean.badKeys === 0 && clean.invalid === 0 && g?.periods === 5 && g.first === '2026-01-05' && g.last === '2026-09-28' && g.lastStatus === 'FINAL'
        && gm?.last === '2026-09-01' && gm.lastStatus === 'PROVISIONAL' && gm.provisional === '2026-09-01' && gm.lastSession === '2026-09-30',
        'frames check: per symbol and timeframe, the periods held, the first and the last, and the last one\'s status — the month still trading named as provisional', clean.frames.map(x => [x.timeframe, x.symbol, x.periods, x.last, x.lastStatus]));
      const bad = JSON.parse(JSON.stringify(h3));
      bad.frames['1W'].GLD.series['2026-09-22'] = 5;                /* a Tuesday: not the engine's key for its week */
      bad.frames['1M'].GLD.series['2026-08-03'] = 5;                /* the 3rd: not a month's key */
      bad.frames['1W'].GLD.ohlc['2026-01-05'] = [100, 90, 95];      /* a high below the close */
      bad.frames['1W'].GLD.volume['2026-02-02'] = 7;                /* a volume with no close beside it */
      bad.frames['4H'] = { GLD: { series: { '2026-09-21': 1 } } };   /* a timeframe the store does not write */
      const hp = join(FR, 'bad-history.json');
      await writeFile(hp, JSON.stringify(bad));
      const regAll = join(FR, 'inst-all.json');
      await writeFile(regAll, JSON.stringify({ instruments: inst }));
      const r6 = await nodeF([join(ROOT, 'ingest/history-check.mjs'), '--history', hp, '--instruments', regAll, '--now', '2026-10-03T00:00:00Z']);
      const F = checkFrames(bad, { E, instruments: inst, now: '2026-10-03T00:00:00Z' });
      check(r6.code === 2 && F.badKeys === 2 && F.invalid === 1 && F.unknownTimeframes.length === 1
        && /key +GLD 1W 2026-09-22: not the engine's key for its week \(2026-09-21\)/.test(r6.stdout) && /key +GLD 1M 2026-08-03: not the engine's key for its month \(2026-08-01\)/.test(r6.stdout)
        && /invalid +GLD 1W 2026-01-05: HIGH_BELOW/.test(r6.stdout) && /orphan +GLD 1W: 1 entry in volume/.test(r6.stdout) && /unknown +frames\["4H"\]/.test(r6.stdout)
        && /1W +GLD +6 weeks +2026-01-05 … 2026-09-28 · last 2026-09-28 FINAL/.test(r6.stdout)
        && /to repair: .*2 imported week\(s\) or month\(s\) under a key the engine does not read, 1 frame timeframe\(s\) the store does not write/.test(r6.stdout),
        'frames check: history-check lists the imported frames, a week or month filed under a key that is not the engine\'s (exit 2), a bar the engine\'s validation refuses, an entry with no close, and a timeframe the store does not write',
        r6.stdout.split('\n').filter(l => /FRAMES|^1W|^1M|^key|^invalid|^orphan|^unknown|repair/.test(l)));
      check(describeFrames(checkFrames(emptyHistory(), { E })).length === 0, 'frames check: a history with no frames adds nothing to the report');
    }

    /* ------------------------------------------------------ the overlap -- */
    /* A daily gold series against imported weeks, one week per reason. Days
       are weekdays from Wednesday 7 January 2026; day k has open 100+k,
       high 103+k, low 99+k, close 101+k and volume 1,000,000+k. The weeks
       are what TradingView would have from the whole market:
         2026-01-05  the daily series starts on the Wednesday      → partial-start (open, low, volume)
         2026-01-12  every session held                            → match
         2026-01-19  no bar on Friday the 23rd; the market shut    → holiday (the imported volume is the four days' sum)
         2026-01-26  no bar on Friday the 30th; it traded higher   → missing-daily
         2026-02-02  every price agrees; the volume is 1 more      → volume-only
         2026-02-09  the close differs                             → unexplained
         2026-02-16  the daily series ends Tuesday; saved Wednesday → partial-end */
    {
      const all = weekdays('2026-01-05', 34);                       /* 5 Jan … 19 Feb */
      const bar = (d) => { const k = all.indexOf(d) - 2; return { date: d, open: 100 + k, high: 103 + k, low: 99 + k, close: 101 + k, volume: 1000000 + k }; };
      const truth = (d) => (d === '2026-01-30' ? { ...bar(d), high: 200 } : bar(d));
      const daily = all.filter(d => d >= '2026-01-07' && d <= '2026-02-17' && d !== '2026-01-23' && d !== '2026-01-30');
      const week = (mon, { skip = [], tweak = {} } = {}) => {
        const ds = all.filter(d => periodKey(E, '1W', d) === mon && !skip.includes(d) && d <= (mon === '2026-02-16' ? '2026-02-18' : '9999')).map(truth);
        return { date: ds[0].date, open: ds[0].open, high: Math.max(...ds.map(x => x.high)), low: Math.min(...ds.map(x => x.low)), close: ds[ds.length - 1].close, volume: ds.reduce((t, x) => t + x.volume, 0), ...tweak };
      };
      const hh = emptyHistory();
      mergeBars(hh, 'GLD', daily.map(bar), { source: 'import:d.csv', capturedAt: '2026-02-17T22:00:00Z', market: 'FX', E, now: '2026-02-18T15:00:00Z' });
      const wk = [week('2026-01-05'), week('2026-01-12'), week('2026-01-19', { skip: ['2026-01-23'] }), week('2026-01-26')];
      const w5 = week('2026-02-02'); wk.push({ ...w5, volume: w5.volume + 1 });
      const w6 = week('2026-02-09'); wk.push({ ...w6, close: w6.close + 0.5 });
      wk.push(week('2026-02-16'));
      mergeFrameBars(hh, '1W', 'GLD', wk, { source: 'import:w.csv', capturedAt: '2026-02-18T15:00:00Z', market: 'FX', E, now: '2026-02-18T15:00:00Z' });
      const rows = compareFrames(hh, { E, instruments: [{ symbol: 'GLD', market: 'FX' }], now: '2026-02-18T15:00:00Z' });
      const w = rows.find(x => x.timeframe === '1W');
      const reason = Object.fromEntries((w?.periods || []).map(p => [p.period, p.match ? 'match' : p.reason]));
      check(same(reason, { '2026-01-05': 'partial-start', '2026-01-12': 'match', '2026-01-19': 'holiday', '2026-01-26': 'missing-daily', '2026-02-02': 'volume-only', '2026-02-09': 'unexplained', '2026-02-16': 'partial-end' })
        && same(w.periods.find(p => p.period === '2026-01-05').diffs.map(x => x.field), ['open', 'low', 'volume']),
        'frames overlap: each imported week is compared with the week the engine builds from the daily series — a match, a partial week at either end, a holiday (the imported volume is the days held), a daily bar the daily export lacks, a volume a few ticks apart, and a difference no reason explains', reason);
      const d = describeOverlap(rows);
      check(d.unexplained === 1 && d.volumeOnly === 1 && !d.ok && /GLD +7 week\(s\) overlap .*: 1 match on open, high, low, close and volume; 6 differ/.test(d.lines.join('\n'))
        && /a holiday: no daily bar on 2026-01-23, and the imported volume is the sum of the 4 session\(s\) held/.test(d.lines.join('\n'))
        && /partial at the end: the week was still trading \(the daily series ends on 2026-02-17, before its last session 2026-02-20\) — the weekly file was saved at 2026-02-18T15:00:00Z and the daily at 2026-02-17T22:00:00Z/.test(d.lines.join('\n')),
        'frames overlap: the report counts the matches, gives every difference its reason in words, and fails only on the one it cannot explain', d.lines);
    }

    /* ---------------------------------------------------- --self-check -- */
    /* Gold's daily and weekly exports for two whole weeks that agree, in a
       folder of TradingView names: imported into a temporary history by the
       import itself, compared, and removed. */
    {
      const SC = join(FR, 'shots');
      await mkdir(SC, { recursive: true });
      const days = weekdays('2026-09-07', 10);
      const dRows = days.map((d, k) => [new Date(Date.parse(`${d}T21:00:00Z`) - 86400000).toISOString(), 100 + k, 103 + k, 99 + k, 101 + k, 1000 + k]);
      const wRows = [0, 5].map(s => { const x = dRows.slice(s, s + 5); return [x[0][0], x[0][1], Math.max(...x.map(r => r[2])), Math.min(...x.map(r => r[3])), x[4][4], x.reduce((t, r) => t + r[5], 0)]; });
      for (const [n, rows] of [['OANDA_GLD, 1D.csv', dRows], ['OANDA_GLD, 1W.csv', wRows]]) { const p = join(SC, n); await writeFile(p, csv(rows)); await utimes(p, new Date('2026-09-28T13:00:00Z'), new Date('2026-09-28T13:00:00Z')); }
      await writeFile(join(SC, 'notes.csv'), 'not,an,export\n');
      const tmpBefore = new Set((await readdir(tmpdir())).filter(n => n.startsWith('qt-frames-self-check-')));
      const hadHistory = existsSync(join(ROOT, 'data/price-history.json'));
      const r7 = await nodeF([join(ROOT, 'ingest/history-check.mjs'), '--self-check', '--dir', SC, '--instruments', reg, '--now', '2026-09-28T13:00:00Z']);
      const left = (await readdir(tmpdir())).filter(n => n.startsWith('qt-frames-self-check-') && !tmpBefore.has(n));
      check(r7.code === 0 && /self-check +2 export\(s\) from .*OANDA_GLD, 1D\.csv, OANDA_GLD, 1W\.csv/.test(r7.stdout)
        && /1W +GLD +2 week\(s\) overlap \(2026-09-07 … 2026-09-14, daily 2026-09-07 … 2026-09-18\): 2 match/.test(r7.stdout) && /every price difference has a reason/.test(r7.stdout)
        && !left.length && existsSync(join(ROOT, 'data/price-history.json')) === hadHistory,
        'frames self-check: the TradingView exports in a folder are imported into a temporary history, compared week by week, and the temporary history removed — data/price-history.json is neither read nor written',
        { code: r7.code, out: r7.stdout.slice(0, 800), err: r7.stderr.slice(-300), left });
    }
  } catch (e) {
    fail('frames: the test threw', e.stack || e.message);
  } finally {
    await rm(FR, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end frames ---- */

/* ---- frames: verify ---- */
/* H3-D: AN OLDER EXPORT IMPORTED AFTER A NEWER ONE. A reading taken while
   its session — or, for an imported bar, its week or month — still traded
   replaced any bar held, whatever that bar's capture: importing last
   Wednesday's weekly export after Monday's wrote Wednesday's mid-week close
   over the week's final bar and recorded it as a correction, which the
   engine reads as CORRECTED, a final bar. Such a reading now replaces only
   an earlier one; offered over a final bar, one with no capture time, or a
   later provisional one, it is not written, is listed with why, and goes to
   the rejects file as PROVISIONAL_READING. The same rule for daily bars.
   Synthetic rows; temporary files. And a monthly export reaching back
   before September 2001, whose nine-digit epoch stamps were refused. */
{
  const S = await import('./ingest/history-store.mjs');
  const { mergeFrameBars } = S;
  const VR = join(tmpdir(), `qt-frames-verify-${process.pid}`);
  await rm(VR, { recursive: true, force: true });
  await mkdir(VR, { recursive: true });
  try {
    const src = 'import:OANDA_GLD, 1W.csv';
    const opt = (capturedAt) => ({ source: src, capturedAt, market: 'FX', E, now: NOW });
    /* The week of Monday 21 September closes at 17:00 New York on Friday the 25th (21:00Z). */
    const wk = (close, high = close + 5) => [{ date: '2026-09-21', open: 100, high, low: 95, close, volume: 10 }];
    const h = emptyHistory();
    const a = mergeFrameBars(h, '1W', 'GLD', wk(2026), opt('2026-09-23T16:00:00Z'));
    const b = mergeFrameBars(h, '1W', 'GLD', wk(2100, 2150), opt('2026-09-28T16:00:00Z'));
    const c = mergeFrameBars(h, '1W', 'GLD', wk(2026), opt('2026-09-23T16:00:00Z'));
    const W = h.frames['1W'].GLD;
    const frameOk = a.added === 1 && b.superseded.length === 1 && c.outranked.length === 1 && c.outranked[0].provisional === true && c.corrected.length === 0
      && /^captured at 2026-09-23T16:00:00Z, before its period closed, and the bar held was captured after it closed; the held bar stands$/.test(c.outranked[0].why)
      && W.series['2026-09-21'] === 2100 && W.meta['2026-09-21'].at === '2026-09-28T16:00:00Z' && !W.corrections
      && E.scanFrameBars(E.scanBars(h, 'GLD', { market: 'FX' }), '1W', { frame: E.scanFramesOf(h, 'GLD', { market: 'FX' })['1W'] }).status[0] === 'FINAL';
    /* Daily bars: Thursday 24 September closes at 21:00Z. */
    const day = (d, close) => [{ date: d, close }];
    const dsrc = 'import:OANDA_GLD, 1D.csv';
    const dopt = (capturedAt) => ({ source: dsrc, capturedAt, market: 'FX', E, now: NOW });
    const d0 = emptyHistory();
    mergeBars(d0, 'GLD', day('2026-09-24', 50), dopt('2026-09-24T22:00:00Z'));
    const dFinal = mergeBars(d0, 'GLD', day('2026-09-24', 51), dopt('2026-09-24T15:00:00Z'));
    mergeBars(d0, 'GLD', day('2026-09-22', 60), dopt('2026-09-22T18:00:00Z'));
    const dEarlier = mergeBars(d0, 'GLD', day('2026-09-22', 59), dopt('2026-09-22T16:00:00Z'));
    const dLater = mergeBars(d0, 'GLD', day('2026-09-22', 61), dopt('2026-09-22T19:00:00Z'));
    mergeBars(d0, 'GLD', day('2026-09-23', 70), dopt(null));
    const dUnknownDiff = mergeBars(d0, 'GLD', day('2026-09-23', 71), dopt('2026-09-23T15:00:00Z'));
    const dUnknownSame = mergeBars(d0, 'GLD', day('2026-09-23', 70), dopt('2026-09-23T15:00:00Z'));
    const dailyOk = dFinal.outranked[0]?.provisional && d0.series.GLD['2026-09-24'] === 50 && !d0.corrections.GLD
      && dEarlier.outranked[0]?.provisional && /the bar held was captured later \(2026-09-22T18:00:00Z\)/.test(dEarlier.outranked[0].why)
      && dLater.superseded.length === 1 && d0.series.GLD['2026-09-22'] === 61
      && dUnknownDiff.outranked[0]?.provisional && /recorded with no capture time/.test(dUnknownDiff.outranked[0].why) && dUnknownSame.unchanged === 1
      && d0.series.GLD['2026-09-23'] === 70 && !d0.meta.GLD['2026-09-23'].at;
    const desc = describeMerge([c]).lines.join('\n');
    check(frameOk && dailyOk && /outranked : 1 row\(s\) not written — read while its session, week or month still traded, where a final or later reading is held:/.test(desc)
      && /GLD 1W 2026-09-21: held 2100 .*, offered 2026 .*, captured 2026-09-23T16:00:00Z before it closed/.test(desc)
      && /a higher-ranked source holds a different value/.test(describeMerge([{ outranked: [{ symbol: 'X', date: 'd', held: { close: 1 }, heldSource: 'import', offered: { close: 2 }, source: 'screen' }] }]).lines.join('\n')),
      'frames verify: a reading taken while its week (or session) still traded replaces only an earlier such reading — offered over a final bar, one with no capture time or a later provisional one it is not written and says why; the older of two weekly exports imported after the newer leaves the final week as it was, with no correction recorded',
      { a: a.added, b: b.superseded.length, c: c.outranked, W: W.series, dFinal: dFinal.outranked, dEarlier: dEarlier.outranked, dLater: dLater.superseded, d0: d0.series.GLD, desc });

    /* Through the import itself, as the reader would do it: Monday's export, then last Wednesday's again. */
    const reg = join(VR, 'instruments.json');
    await writeFile(reg, JSON.stringify({ instruments: [{ symbol: 'GLD', market: 'FX' }] }));
    const f = join(VR, 'OANDA_GLD, 1W.csv'), out = join(VR, 'price-history.json');
    /* TradingView stamps a week at 17:00 New York on the Sunday before it (21:00Z in September). */
    const put = async (rows) => writeFile(f, ['time,open,high,low,close,Volume', ...rows.map(r => [Date.parse(r[0]) / 1000, ...r.slice(1)].join(','))].join('\n') + '\n');
    const older = [['2026-09-13T21:00:00Z', 90, 101, 89, 100, 7], ['2026-09-20T21:00:00Z', 100, 2031, 95, 2026, 8]];
    const newer = [['2026-09-13T21:00:00Z', 90, 101, 89, 100, 7], ['2026-09-20T21:00:00Z', 100, 2150, 95, 2100, 9], ['2026-09-27T21:00:00Z', 2100, 2110, 2090, 2105, 1]];
    const imp = async (at) => run(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), '--in', f, '--instruments', reg, '--out', out, '--captured-at', at], { cwd: ROOT }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
    await put(newer); const i1 = await imp('2026-09-28T16:00:00Z');
    await put(older); const i2 = await imp('2026-09-23T16:00:00Z');
    const held = JSON.parse(await readFile(out, 'utf8')).frames['1W'].GLD;
    const rej = JSON.parse(await readFile(rejectsPathFor(out), 'utf8'));
    check(i1.code === 0 && i2.code === 2 && held.series['2026-09-21'] === 2100 && !held.corrections
      && /GLD 1W +0 new .*\(1 read while the week still traded, where a final or later reading is held — not written\)/.test(i2.stdout) && !/held by a higher-ranked source/.test(i2.stdout)
      && /last week 2026-09-28 PROVISIONAL/.test(i1.stdout) && !/last week/.test(i2.stdout)
      && rej.rejects.some(x => x.codes.includes('PROVISIONAL_READING') && x.date === '2026-09-21') && /PROVISIONAL_READING/.test(rej.note),
      'frames verify: history-import of an older weekly export after a newer one keeps the final week, says the older reading was taken while the week still traded (not "a higher-ranked source"), names no last week of its own (it holds none it wrote), exits 2, and lists the row in the rejects file as PROVISIONAL_READING',
      { i1: i1.code, i2: [i2.code, i2.stdout.split('\n').filter(l => /GLD|last|outranked|not written/.test(l))], held: held.series, rej: rej.rejects?.map(x => [x.date, x.codes]) });

    /* A monthly export scrolled back before 9 September 2001: its stamps
       are nine-digit epoch seconds, and every one was refused as a date
       not recognised (the compare owner's report). July to October 2001,
       each stamped at 17:00 New York the evening before its first session. */
    const fx = { tz: 'America/New_York', session: E.scanMarket('FX') };
    const sec = (iso) => String(Date.parse(iso) / 1000);
    const cells = { jul: sec('2001-07-01T21:00:00Z'), aug: sec('2001-07-31T21:00:00Z'), sep: sec('2001-09-02T21:00:00Z'), oct: sec('2001-09-30T21:00:00Z') };
    const mf = join(VR, 'OANDA_GLD, 1M.csv'), mout = join(VR, 'months.json');
    await writeFile(mf, ['time,open,high,low,close,Volume', ...[['jul', 270], ['aug', 275], ['sep', 290], ['oct', 280]].map(([k, c]) => [cells[k], c - 2, c + 5, c - 6, c, 0].join(','))].join('\n') + '\n');
    const m1 = await run(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), '--in', mf, '--instruments', reg, '--out', mout, '--captured-at', '2026-09-28T17:27:00Z'], { cwd: ROOT }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
    const months = Object.keys(JSON.parse(await readFile(mout, 'utf8')).frames?.['1M']?.GLD?.series || {});
    check(cells.jul.length === 9 && cells.oct.length === 10 && parseDateCell(cells.aug, fx).date === '2001-08-01' && parseDateCell(cells.sep, fx).date === '2001-09-03'
      && parseDateCell(cells.aug + '000', fx).date === '2001-08-01' && parseDateCell('20260928').error === 'BAD_DATE' && parseDateCell('12345678').error === 'BAD_DATE'
      && m1.code === 0 && same(months, ['2001-07-01', '2001-08-01', '2001-09-01', '2001-10-01']),
      'frames verify: a nine-digit epoch stamp (seconds before 9 September 2001) and a twelve-digit one (milliseconds) are dated as the ten- and thirteen-digit ones are, so a monthly export reaching back before September 2001 imports; an eight-digit number is still no date',
      { cells, aug: parseDateCell(cells.aug, fx), code: m1.code, months, out: (m1.stdout + m1.stderr).slice(0, 600) });
  } catch (e) {
    fail('frames verify: the test threw', e.stack || e.message);
  } finally {
    await rm(VR, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end frames: verify ---- */

/* ---- bugfix6: ingest ---- */
/* THE IMPORT, AFTER THE FRAMES. Each case failed before its fix:
   - a volume of 0 on a daily bar whose price moved was stored as 0, while
     the same export's weeks and months stored it as absent; and nothing
     could ever take a stored 0 out, since an absent volume offered again
     fills nothing in;
   - Yahoo and Twelve Data kept a 0 on a bar whose price moved (Yahoo only
     where the whole window had none);
   - two exports of one chart in one run were read in the folder's order,
     which puts the browser's " (1)" — the newer — first, so the older was
     written over it, a revised closed week recorded as corrected back;
   - --keep trimmed every timeframe: a monthly import with --keep 6 cut the
     daily series to six sessions, a daily one the imported months; and a
     keep of 0, 2.5 or a word kept everything;
   - --overlap called every week "unexplained" where the daily bars carry
     no volume and the weekly ones do.
   Synthetic files; temporary folders; no personal file is read. */
{
  const S = await import('./ingest/history-store.mjs');
  const { mergeFrameBars, saveHistory, volumeNotCounted } = S;
  const { compareFrames, describeOverlap } = await import('./ingest/history-check.mjs');
  const BD = join(tmpdir(), `qt-bugfix6-ingest-${process.pid}`);
  await rm(BD, { recursive: true, force: true });
  await mkdir(join(BD, 'x'), { recursive: true });
  const nodeB = (script, args) => run(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  const imp = (...args) => nodeB('ingest/history-import.mjs', args);
  const reg = join(BD, 'instruments.json');
  await writeFile(reg, JSON.stringify({ instruments: [{ symbol: 'GLD', market: 'FX' }] }));
  const sec = (iso) => String(Date.parse(iso) / 1000);
  const csv = (rows, head = 'time,open,high,low,close,Volume') => [head, ...rows.map(r => r.join(','))].join('\n') + '\n';
  const put = async (dirName, name, text, saved) => { await mkdir(join(BD, dirName), { recursive: true }); const p = join(BD, dirName, name); await writeFile(p, text); await utimes(p, new Date(saved), new Date(saved)); return p; };
  const readJson = async (p) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null);
  const gld = { source: 'import:OANDA_GLD, 1D.csv', capturedAt: '2026-09-28T00:00:00.000Z', market: 'FX', E, now: NOW };
  try {
    /* ------------------------------------------- a daily 0 that is no count -- */
    /* Gold's sessions of 21 to 23 September, each stamped 17:00 New York the
       evening before (21:00Z):
         Mon 21  range 95 to 110, volume 0    → no count: absent
         Tue 22  high = low = 105, volume 0   → nothing traded: 0
         Wed 23  volume 1200                  → 1200 */
    const dRows = [[sec('2026-09-20T21:00:00Z'), 100, 110, 95, 105, 0], [sec('2026-09-21T21:00:00Z'), 105, 105, 105, 105, 0], [sec('2026-09-22T21:00:00Z'), 105, 112, 101, 108, 1200]];
    const dp = await put('d', 'OANDA_GLD, 1D.csv', csv(dRows), '2026-09-28T00:00:00Z');
    const out1 = join(BD, 'h1.json');
    const r1 = await imp('--in', dp, '--instruments', reg, '--out', out1);
    const h1 = await readJson(out1);
    check(r1.code === 0 && same(h1?.volume?.GLD, { '2026-09-22': 0, '2026-09-23': 1200 }) && Object.keys(h1?.series?.GLD || {}).length === 3
      && /volume 0 on 1 session\(s\) whose price moved \(2026-09-21 … 2026-09-21\): the broker recorded no count, so none is stored — not a session with no trading/.test(r1.stdout)
      && volumeNotCounted({ volume: 0, high: 2, low: 1 }) && !volumeNotCounted({ volume: 0, high: 1, low: 1 }) && !volumeNotCounted({ volume: 0, high: null, low: null }) && !volumeNotCounted({ volume: 5, high: 2, low: 1 }),
      'bugfix6 ingest: a daily export\'s volume of 0 on a session whose price moved is stored as absent, as a week\'s or a month\'s already was, and the import names the span; a 0 where the high equals the low stays 0',
      { code: r1.code, vol: h1?.volume, out: r1.stdout.slice(0, 700), err: r1.stderr.slice(0, 300) });

    /* ------------------------------------ a stored 0, and the one path out -- */
    /* The history an import made before this fix: the same file's bars,
       with 21 September's volume stored as 0. */
    const out2 = join(BD, 'h2.json');
    const pre = emptyHistory();
    mergeBars(pre, 'GLD', [{ date: '2026-09-21', open: 100, high: 110, low: 95, close: 105, volume: 0 }, { date: '2026-09-22', open: 105, high: 105, low: 105, close: 105, volume: 0 },
      { date: '2026-09-23', open: 105, high: 112, low: 101, close: 108, volume: 1200 }], gld);
    await saveHistory(out2, pre, { now: NOW });
    /* Every other path leaves it: the store reads it as it is; a provider's
       bar with no volume fills nothing in over it; a lower-ranked reading
       that says it was no count does not outrank the import. */
    const loaded = await S.loadHistory(out2);
    const other = mergeBars(loaded, 'GLD', [{ date: '2026-09-21', open: 100, high: 110, low: 95, close: 105, volume: null }], { ...gld, source: 'yahoo', capturedAt: '2026-09-29T00:00:00Z' });
    const lower = mergeBars(loaded, 'GLD', [{ date: '2026-09-21', open: 100, high: 110, low: 95, close: 105, noCount: true }], { ...gld, source: 'screen', capturedAt: '2026-09-29T00:00:00Z' });
    const r2 = await imp('--in', dp, '--instruments', reg, '--out', out2);
    const h2 = await readJson(out2);
    const r2b = await imp('--in', dp, '--instruments', reg, '--out', out2);
    const h2b = await readJson(out2);
    check(loaded.volume.GLD['2026-09-21'] === 0 && other.unchanged === 1 && lower.outranked.length === 1 && loaded.volume.GLD['2026-09-21'] === 0
      && r2.code === 0 && same(h2?.volume?.GLD, { '2026-09-22': 0, '2026-09-23': 1200 })
      && same(h2?.corrections?.GLD?.map(c => [c.date, c.field, c.from, c.to]), [['2026-09-21', 'volume', 0, null]]) && /corrected : 1 field\(s\)/.test(r2.stdout)
      && E.scanBars(h2, 'GLD', { market: 'FX' }).volumes[0] === null
      && r2b.code === 0 && h2b?.corrections?.GLD?.length === 1 && /new bars  : 0, 3 unchanged/.test(r2b.stdout),
      'bugfix6 ingest: re-importing the export takes out the 0 an earlier import stored on a session whose price moved — recorded as a correction — and a second re-import changes nothing; the store, a provider\'s bar without a volume and a lower-ranked reading leave a stored 0 as it was',
      { loaded: loaded.volume.GLD, other: other.unchanged, lower: lower.outranked.length, r2: r2.stdout.split('\n').filter(l => /GLD|corrected|new bars/.test(l)), vol: h2?.volume?.GLD, corr: h2?.corrections, r2b: r2b.stdout.split('\n').filter(l => /new bars/.test(l)) });
    /* The same path for an imported month holding a 0 (a history written
       by the store's merge directly). July 2026, stamped 17:00 New York on
       30 June: volume 0 with a range of 30. */
    const out3 = join(BD, 'h3.json');
    const pm = emptyHistory();
    mergeFrameBars(pm, '1M', 'GLD', [{ date: '2026-07-01', open: 100, high: 120, low: 90, close: 110, volume: 0 }], { ...gld, source: 'import:OANDA_GLD, 1M.csv', capturedAt: '2026-09-28T17:27:00.000Z' });
    await saveHistory(out3, pm, { now: NOW });
    const mp = await put('m', 'OANDA_GLD, 1M.csv', csv([[sec('2026-06-30T21:00:00Z'), 100, 120, 90, 110, 0]]), '2026-09-28T17:27:00Z');
    const r3 = await imp('--in', mp, '--instruments', reg, '--out', out3);
    const M3 = (await readJson(out3))?.frames?.['1M']?.GLD || {};
    check(r3.code === 0 && M3.volume?.['2026-07-01'] === undefined && same(M3.corrections?.map(c => [c.date, c.field, c.from, c.to]), [['2026-07-01', 'volume', 0, null]]),
      'bugfix6 ingest: re-importing a monthly export takes out a 0 its frame held for a month whose price moved, recorded in the frame\'s own corrections',
      { code: r3.code, M3, out: r3.stdout.slice(0, 500) });

    /* ------------------------------------------------------- the providers -- */
    const realFetch = globalThis.fetch;
    const t0 = Date.parse('2026-09-21T13:30:00Z') / 1000;
    try {
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ chart: { result: [{ meta: { exchangeTimezoneName: 'America/New_York' }, timestamp: [t0, t0 + 86400, t0 + 2 * 86400],
        indicators: { quote: [{ open: [10, 10, 11], high: [11, 10, 12], low: [9.5, 10, 10.5], close: [10.5, 10, 11.5], volume: [0, 0, 700] }] } }] } }) });
      const y = await yahooProvider().history('AAA', '2026-09-01', '2026-09-30');
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ values: [{ datetime: '2026-09-23', open: '11', high: '12', low: '10.5', close: '11.5', volume: '700' },
        { datetime: '2026-09-22', open: '10', high: '10', low: '10', close: '10', volume: '0' }, { datetime: '2026-09-21', open: '10', high: '11', low: '9.5', close: '10.5', volume: '0' }] }) });
      const t = await twelveDataProvider({ apiKey: 'k' }).history('AAA', '2026-09-01', '2026-09-30');
      check(same(y?.map(b => b.volume), [null, 0, 700]) && same(t?.map(b => b.volume), [null, 0, 700]),
        'bugfix6 ingest: Yahoo and Twelve Data bars with a volume of 0 on a session whose price moved come back with no volume, in a window that counts others; a 0 where the high equals the low stays 0',
        { y: y?.map(b => [b.date, b.volume]), t: t?.map(b => [b.date, b.volume]) });
    } finally { globalThis.fetch = realFetch; }

    /* ------------------------------------------- two exports of one chart -- */
    /* The older weekly export was saved on Monday 28 September, the week of
       the 21st closed at 117 and the 28th in progress at 115; the newer on
       Saturday 3 October, the 21st revised to 117.5 and the 28th final at
       120. The browser named the newer "(1)", which the folder lists first. */
    const older = [[sec('2026-09-13T21:00:00Z'), 108, 115, 104, 112, 1200], [sec('2026-09-20T21:00:00Z'), 112, 118, 111, 117, 1300], [sec('2026-09-27T21:00:00Z'), 117, 119, 114, 115, 400]];
    const newer = [[sec('2026-09-13T21:00:00Z'), 108, 115, 104, 112, 1200], [sec('2026-09-20T21:00:00Z'), 112, 118, 111, 117.5, 1300], [sec('2026-09-27T21:00:00Z'), 117, 121, 113, 120, 1500]];
    await put('two', 'OANDA_GLD, 1W.csv', csv(older), '2026-09-28T17:27:00Z');
    await put('two', 'OANDA_GLD, 1W (1).csv', csv(newer), '2026-10-03T00:00:00Z');
    const out4 = join(BD, 'h4.json');
    const r4 = await imp('--dir', join(BD, 'two'), '--instruments', reg, '--out', out4);
    const W4 = (await readJson(out4))?.frames?.['1W']?.GLD || {};
    check(r4.code === 0 && same(W4.series, { '2026-09-14': 112, '2026-09-21': 117.5, '2026-09-28': 120 })
      && same(W4.corrections?.map(c => [c.date, c.field, c.from, c.to, c.src]), [['2026-09-21', 'close', 117, 117.5, 'import:OANDA_GLD, 1W (1).csv']])
      && W4.meta?.['2026-09-28']?.src === 'import:OANDA_GLD, 1W (1).csv' && /finalised : 1 provisional bar/.test(r4.stdout) && !/outranked/.test(r4.stdout)
      && /imported frames: GLD 1W 3 weeks\r?\n/.test(r4.stdout),
      'bugfix6 ingest: two exports of one chart in one --dir run are read in the order they were saved — the newer "(1)" is the last word: its revised closed week stands (a correction from 117 to 117.5, not back), its final week supersedes the older file\'s week in progress, nothing is refused, and the frame is named once',
      { code: r4.code, series: W4.series, corr: W4.corrections, out: r4.stdout.split('\n').filter(l => /GLD|finalised|corrected|outranked|imported frames/.test(l)) });
    /* The same for a daily export and its copy: a price break (×2 from 18
       September) the run names once, not once per file. */
    const brk = weekdays('2026-09-14', 8).map((d, k) => [sec(new Date(Date.parse(`${d}T21:00:00Z`) - 86400000).toISOString()), k < 4 ? 100 : 200, k < 4 ? 101 : 202, k < 4 ? 99 : 198, k < 4 ? 100 : 200, 10]);
    await put('brk', 'OANDA_GLD, 1D.csv', csv(brk), '2026-09-26T00:00:00Z');
    await put('brk', 'OANDA_GLD, 1D (1).csv', csv(brk), '2026-09-27T00:00:00Z');
    const rb = await imp('--dir', join(BD, 'brk'), '--instruments', reg, '--out', join(BD, 'hb.json'));
    check(rb.code === 0 && /breaks    : 1 price break\(s\) no recorded adjustment explains/.test(rb.stdout) && (rb.stdout.match(/GLD 2026-09-17 → 2026-09-18: ×2/g) || []).length === 1,
      'bugfix6 ingest: a price break in a daily export imported with its copy in one run is named once — it was counted and listed once per file',
      rb.stdout.split('\n').filter(l => /breaks|→/.test(l)));
    /* --self-check reads them in that order too: gold's daily export for
       7 to 18 September and two weekly ones, the older saved on Wednesday
       16 September (the week of the 7th final at a close the newer revised,
       the 14th in progress), the newer on Monday 21 September, agreeing
       with the daily bars. Read by name, the older went second and its
       week of the 7th stood against the daily bars, unexplained. */
    const days = weekdays('2026-09-07', 10);
    const dR = days.map((d, k) => [sec(new Date(Date.parse(`${d}T21:00:00Z`) - 86400000).toISOString()), 100 + k, 103 + k, 99 + k, 101 + k, 1000 + k]);
    const wk = (s) => { const x = dR.slice(s, s + 5); return [x[0][0], x[0][1], Math.max(...x.map(r => r[2])), Math.min(...x.map(r => r[3])), x[4][4], x.reduce((a, r) => a + r[5], 0)]; };
    const wNew = [wk(0), wk(5)];
    const wOld = [[...wk(0).slice(0, 4), wk(0)[4] + 0.5, wk(0)[5]], [...wk(5).slice(0, 4), 106.2, 3000]];
    await put('sc', 'OANDA_GLD, 1D.csv', csv(dR), '2026-09-21T12:00:00Z');
    await put('sc', 'OANDA_GLD, 1W.csv', csv(wOld), '2026-09-16T12:00:00Z');
    await put('sc', 'OANDA_GLD, 1W (1).csv', csv(wNew), '2026-09-21T12:00:00Z');
    const r5 = await nodeB('ingest/history-check.mjs', ['--self-check', '--dir', join(BD, 'sc'), '--instruments', reg, '--now', '2026-09-21T12:00:00Z']);
    check(r5.code === 0 && /1W +GLD +2 week\(s\) overlap .*: 2 match on open, high, low, close and volume/.test(r5.stdout) && /every price difference has a reason/.test(r5.stdout),
      'bugfix6 ingest: --self-check imports two exports of one chart in the order they were saved, so the newer one is compared — the older one\'s revised week no longer stands as an unexplained difference',
      { code: r5.code, out: r5.stdout.slice(0, 1200), err: r5.stderr.slice(-300) });
    /* A weekly export the import refuses whole: a New York stock with no
       registry row (the default market) stamped on Sundays, every stamp a
       day the market does not trade. No frame reached the temporary
       history, and the self-check said "nothing to compare — every price
       difference has a reason", exit 0. */
    await put('ref', 'NYSE_STK, 1D.csv', csv(weekdays('2026-09-07', 10).map((d, k) => [sec(`${d}T13:30:00Z`), 100 + k, 103 + k, 99 + k, 101 + k, 1000 + k])), '2026-09-21T12:00:00Z');
    await put('ref', 'NYSE_STK, 1W.csv', csv([[sec('2026-09-06T13:30:00Z'), 100, 107, 99, 105, 5010], [sec('2026-09-13T13:30:00Z'), 105, 112, 104, 110, 5035]]), '2026-09-21T12:00:00Z');
    const r5b = await nodeB('ingest/history-check.mjs', ['--self-check', '--dir', join(BD, 'ref'), '--instruments', reg, '--now', '2026-09-21T12:00:00Z']);
    check(r5b.code === 2 && /refused +NYSE_STK, 1W\.csv: 2 row\(s\) the import refused \(NON_SESSION_DAY\) — not compared/.test(r5b.stdout)
      && /2 row\(s\) of the exports were refused by the import and not compared/.test(r5b.stdout) && !/refused +NYSE_STK, 1D\.csv/.test(r5b.stdout),
      'bugfix6 ingest: --self-check names the rows of an export the import refused, which nothing compared, and exits 2 — a weekly export refused whole passed as "nothing to compare", exit 0',
      { code: r5b.code, out: r5b.stdout.slice(0, 900), err: r5b.stderr.slice(-300) });

    /* ------------------------------------------------------------- --keep -- */
    /* A history holding five sessions of daily gold and five imported months. */
    const base = emptyHistory();
    mergeBars(base, 'GLD', weekdays('2026-09-14', 5).map((d, k) => ({ date: d, open: 100 + k, high: 102 + k, low: 99 + k, close: 101 + k, volume: 10 })), gld);
    mergeFrameBars(base, '1M', 'GLD', ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03'].map((d, k) => ({ date: d, open: 100 + k, high: 110 + k, low: 95 + k, close: 105 + k, volume: 1000 })),
      { ...gld, source: 'import:old-months.csv', capturedAt: '2026-09-28T17:27:00.000Z' });
    const out6 = join(BD, 'h6.json'), out7 = join(BD, 'h7.json');
    await saveHistory(out6, JSON.parse(JSON.stringify(base)), { now: NOW });
    await saveHistory(out7, JSON.parse(JSON.stringify(base)), { now: NOW });
    const r6 = await imp('--in', dp, '--instruments', reg, '--out', out6, '--keep', '2');
    const h6 = await readJson(out6);
    const r7 = await imp('--in', mp, '--instruments', reg, '--out', out7, '--keep', '3');
    const h7 = await readJson(out7);
    check(r6.code === 0 && Object.keys(h6?.series?.GLD || {}).length === 2 && Object.keys(h6?.frames?.['1M']?.GLD?.series || {}).length === 5
      && r7.code === 0 && Object.keys(h7?.series?.GLD || {}).length === 5 && same(Object.keys(h7?.frames?.['1M']?.GLD?.series || {}).sort(), ['2026-06-01', '2026-07-01', '2026-08-01']),
      'bugfix6 ingest: --keep trims only the timeframe the import writes — a daily import with --keep 2 keeps the five imported months, and a monthly import with --keep 3 keeps the five daily sessions (it cut them to three)',
      { daily: [r6.code, Object.keys(h6?.series?.GLD || {}).length, Object.keys(h6?.frames?.['1M']?.GLD?.series || {}).length], monthly: [r7.code, Object.keys(h7?.series?.GLD || {}).length, Object.keys(h7?.frames?.['1M']?.GLD?.series || {})] });
    const text6 = await readFile(out6, 'utf8');
    const bad = [];
    for (const k of ['0', '2.5', '-3', 'abc']) bad.push(await imp('--in', dp, '--instruments', reg, '--out', out6, '--keep', k));
    const pin = join(BD, 'prices.json');
    await writeFile(pin, JSON.stringify({ prices: { GLD: { close: 106, date: '2026-09-25', capturedAt: '2026-09-28T00:00:00Z' } } }));
    const hk = await nodeB('ingest/history.mjs', ['--in', pin, '--out', out6, '--instruments', reg, '--keep', '0']);
    let threw = null; try { await S.updateHistory(join(BD, 'never.json'), () => [], { keep: 1.5 }); } catch (e) { threw = e.code; }
    check(bad.every(b => b.code === 1 && /--keep ".*" is not a whole number of bars, 1 or more — nothing was written/.test(b.stderr)) && await readFile(out6, 'utf8') === text6
      && hk.code === 1 && /history not written: the keep must be a whole number of bars, 1 or more/.test(hk.stderr) && threw === 'BAD_KEEP' && !existsSync(join(BD, 'never.json')),
      'bugfix6 ingest: a --keep of 0, 2.5, -3 or a word is refused and nothing is written — each trimmed nothing and kept every bar; history.mjs and the store refuse it too',
      { bad: bad.map(b => [b.code, b.stderr.slice(0, 120)]), hk: [hk.code, hk.stderr.slice(0, 160)], threw });

    /* ------------------------------------------- the overlap, no volume -- */
    /* Gold's daily bars with no volume (a daily export without the column,
       or a provider that sends none for the pair) beside weekly bars with
       their tick counts: every price agrees. */
    const hv = emptyHistory();
    mergeBars(hv, 'GLD', weekdays('2026-09-07', 10).map((d, k) => ({ date: d, open: 100 + k, high: 103 + k, low: 99 + k, close: 101 + k })), { ...gld, capturedAt: '2026-09-21T12:00:00Z' });
    const wv = [0, 5].map(s => { const ds = weekdays('2026-09-07', 10).slice(s, s + 5); return { date: ds[0], open: 100 + s, high: 107 + s, low: 99 + s, close: 105 + s, volume: 5000 + s }; });
    mergeFrameBars(hv, '1W', 'GLD', wv, { ...gld, source: 'import:w.csv', capturedAt: '2026-09-21T12:00:00Z' });
    const ov = compareFrames(hv, { E, instruments: [{ symbol: 'GLD', market: 'FX' }], now: '2026-09-21T12:00:00Z' });
    const dv = describeOverlap(ov);
    const reasons = ov[0]?.periods?.map(p => p.reason);
    check(same(reasons, ['no-count', 'no-count']) && dv.ok && dv.unexplained === 0 && dv.volumeOnly === 2
      && /5 daily bar\(s\) of the week hold no volume \(2026-09-07, 2026-09-08, 2026-09-09, … — the daily file gave none/.test(dv.lines.join('\n')),
      'bugfix6 ingest: --overlap gives a week whose prices agree and whose volume only the imported side holds its reason — the daily bars hold no volume — where it called every such week unexplained and exited 2',
      { reasons, lines: dv.lines, summary: dv.summary });
  } catch (e) {
    fail('bugfix6 ingest: the test threw', e.stack || e.message);
  } finally {
    await rm(BD, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end bugfix6: ingest ---- */
/* ---- releaseB: small-backlog ---- */
/* E1 — history-import --dry-run. There was no way to see what an import
   would do before it did it: the flag was unknown, so it was ignored and
   the import wrote the history, its .bak and the rejects file. Now a dry
   run reads, dates and validates as the import does, reports what it would
   add, change, refuse and trim, and writes nothing. Held to the real thing:
   the same export into an identical copy of the same history, imported for
   real, must add, correct, finalise, refuse and trim exactly what the dry
   run named, with the same lines and the same exit code. The history
   (temporary files only) holds a bar the export corrects, one read off the
   screen while its session traded, which the export finalises, a final bar
   an export saved mid-session cannot replace, and series the keep of 5
   trims — one the export never touches; the export holds an ambiguous date
   and a bar whose high is under its low. A stale lock beside the history,
   which a writer would take over and remove, and a folder that does not
   exist, show that a dry run touches no file and makes none. */
{
  const { readdir, stat } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const { hostname } = await import('node:os');
  const DR = join(tmpdir(), `qt-releaseB-dry-${process.pid}`);
  await rm(DR, { recursive: true, force: true });
  await mkdir(join(DR, 'exports'), { recursive: true });
  const imp = (args) => run(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), ...args], { cwd: ROOT }).then(r => ({ code: 0, ...r }), e => ({ code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }));
  /* Every file under a folder: its name, size, modification time and bytes. */
  const listing = async (d) => {
    const out = {};
    const walk = async (p) => { for (const n of await readdir(p)) { const f = join(p, n); const s = await stat(f);
      if (s.isDirectory()) await walk(f); else out[f.slice(d.length)] = [s.size, s.mtimeMs, createHash('sha1').update(await readFile(f)).digest('hex')]; } };
    if (existsSync(d)) await walk(d);
    return out;
  };
  const readJson = async (p) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null);
  const lines = (s) => String(s).split(/\r?\n/);
  try {
    const reg = join(DR, 'instruments.json');
    await writeFile(reg, JSON.stringify({ instruments: ['QDRY', 'QOLD', 'QLIVE'].map(symbol => ({ symbol, market: 'US' })) }));
    /* The history as it stands. */
    const base = emptyHistory();
    const at = (source, capturedAt) => ({ source, capturedAt, market: 'US', E, now: NOW });
    mergeBars(base, 'QDRY', weekdays('2026-09-14', 5).map((date, k) => ({ date, open: 99 + k, high: 101 + k, low: 98 + k, close: 100 + k, volume: 900 + 10 * k })), at('import:old.csv', '2026-09-19T00:00:00Z'));
    mergeBars(base, 'QDRY', [{ date: '2026-09-21', close: 104.5 }], at('screen', '2026-09-21T15:00:00Z'));
    mergeBars(base, 'QOLD', weekdays('2026-09-08', 7).map((date, k) => ({ date, close: 20 + k })), at('import:qold.csv', '2026-09-19T00:00:00Z'));
    mergeBars(base, 'QLIVE', [{ date: '2026-09-25', open: 49, high: 51, low: 48, close: 50, volume: 10 }], at('import:final.csv', '2026-09-26T00:00:00Z'));
    /* The exports: QDRY saved on Saturday 26 September, every session
       closed; QLIVE saved at 11:00 New York on Friday the 25th, while that
       session traded. */
    const csv = (rows) => ['date,open,high,low,close,volume', ...rows].join('\n') + '\n';
    const qdry = join(DR, 'exports', 'QDRY.csv'), qlive = join(DR, 'exports', 'QLIVE.csv');
    await writeFile(qdry, csv(['2026-09-17,102,104,101,103,930', '2026-09-18,103,106,102.5,105,1100', '2026-09-21,104,106,103,105.5,1200',
      '2026-09-22,105,107,104,106,1300', '2026-09-23,106,108,105,107,1400', '03/04/2026,1,2,0.5,1.5,10', '2026-09-24,107,105,108,107.5,1500', '2026-09-25,107,109,106,108,1600']));
    await writeFile(qlive, csv(['2026-09-24,48,50,47,49,20', '2026-09-25,49,50.5,48.5,49.5,5']));
    await utimes(qdry, new Date('2026-09-26T12:00:00Z'), new Date('2026-09-26T12:00:00Z'));
    await utimes(qlive, new Date('2026-09-25T15:00:00Z'), new Date('2026-09-25T15:00:00Z'));
    for (const d of ['dry', 'real']) { await mkdir(join(DR, d)); await saveHistory(join(DR, d, 'h.json'), JSON.parse(JSON.stringify(base)), { now: NOW }); }
    /* A lock left by a writer that died: a real import takes it over and
       removes it. */
    await writeFile(join(DR, 'dry', 'h.json.lock'), JSON.stringify({ pid: 2147483646, host: hostname(), startedAt: '2026-09-26T00:00:00Z', token: 'dead' }, null, 2) + '\n');
    const args = (out, ...more) => ['--dir', join(DR, 'exports'), '--instruments', reg, '--out', out, '--keep', '5', ...more];
    const before = await listing(join(DR, 'dry'));
    const dry = await imp(args(join(DR, 'dry', 'h.json'), '--dry-run'));
    const after = await listing(join(DR, 'dry'));
    const real = await imp(args(join(DR, 'real', 'h.json')));
    const H = await readJson(join(DR, 'real', 'h.json'));
    const RJ = (await readJson(join(DR, 'real', 'h.rejects.json')))?.rejects || [];

    /* 1. Nothing written: the folder file for file, byte for byte, the dead
       writer's lock included — no history change, no .bak, no rejects file,
       no lock of its own. */
    check(same(before, after) && Object.keys(after).length === 2 && dry.code === 2 && /^DRY RUN — 2 file\(s\) read, dated and validated against .*h\.json; nothing is written: no history, no \.bak, no rejects file/m.test(dry.stdout)
      && /dry run: nothing was written — .*h\.json, its \.bak and .*h\.rejects\.json are as they were/.test(dry.stdout),
      'releaseB E1: history-import --dry-run writes nothing — the history, its folder and a dead writer\'s lock are byte for byte as they were, and no .bak, rejects file or lock of its own appears',
      { code: dry.code, before: Object.keys(before), after: Object.keys(after), changed: Object.keys(after).filter(k => !same(before[k], after[k])), err: dry.stderr.slice(0, 300) });

    /* 2. The same lines as the real run, from the same merge: each file's
       line and its notes, the totals, what was outranked and rejected, the
       trim — everything but the words that say a write happened. */
    const comparable = (out) => {
      const kept = [];
      let inRows = false;
      for (const l of lines(out)) {
        if (/^dry run, row by row/.test(l)) { inRows = true; continue; }
        if (inRows && /^( {2}(add|change|refuse|trim)\s| {12}\S)/.test(l)) continue;
        inRows = false;
        if (/^DRY RUN — |^(wrote|would write) |every refused row (is in|would go to) |^ {2}(dates|adjusted) +: |^dry run: /.test(l)) continue;
        kept.push(l.replace(/would be recorded/g, 'recorded'));
      }
      return kept.filter(l => l.trim());
    };
    const dl = comparable(dry.stdout), rl = comparable(real.stdout);
    check(real.code === dry.code && same(dl, rl) && dl.some(l => /^QDRY +3 new/.test(l)) && dl.some(l => /^ {2}trimmed +: 6 bar\(s\)/.test(l)),
      'releaseB E1: a dry run prints the real import\'s own lines — each file\'s count and notes, new bars, finalised, corrected, outranked, rejected and trimmed — and exits as it does (2: rows refused)',
      { dryCode: dry.code, realCode: real.code, onlyDry: dl.filter(l => !rl.includes(l)).slice(0, 6), onlyReal: rl.filter(l => !dl.includes(l)).slice(0, 6) });

    /* 3. Row by row, what the real import then did. */
    const rows = {};
    let head = null;
    for (const l of lines(dry.stdout).slice(lines(dry.stdout).findIndex(x => /^dry run, row by row/.test(x)) + 1)) {
      const m = l.match(/^ {2}(add|change|refuse|trim) +(.*)$/);
      if (m) { head = m[1]; (rows[head] ||= []).push(m[2]); continue; }
      const c = l.match(/^ {12}(\S.*)$/);
      if (c && head) { rows[head].push(c[1]); continue; }
      head = null;
    }
    const baseKeys = (s) => Object.keys(base.series[s] || {});
    const realNew = ['QDRY', 'QLIVE'].map(s => [s, Object.keys(H?.series?.[s] || {}).filter(d => !baseKeys(s).includes(d)).sort()]);
    const realCorr = (H?.corrections?.QDRY || []).map(c => `QDRY ${c.date} ${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`);
    const realRefused = RJ.map(x => `${x.symbol} ${x.date}: ${x.codes.join(', ')}`).sort();
    const dryRefused = (rows.refuse || []).map(r => r.replace(/ \(line \d+\)/, '').replace(/ — .*$/, '')).sort();
    const gone = (s) => [...new Set([...baseKeys(s), ...(realNew.find(([k]) => k === s)?.[1] || [])])].filter(d => !(d in (H?.series?.[s] || {}))).sort();
    const wantTrim = [['QDRY', gone('QDRY')], ['QOLD', gone('QOLD')]].map(([s, ks]) => `${s}: ${ks.length} bar(s), ${ks[0]} … ${ks[ks.length - 1]} — older than the newest 5`);
    check(same(rows.add, realNew.map(([s, ks]) => `${s}: ${ks.length} bar(s), ${ks.length > 1 ? `${ks[0]} … ${ks[ks.length - 1]}` : ks[0]}`))
      && same(realNew, [['QDRY', ['2026-09-22', '2026-09-23', '2026-09-25']], ['QLIVE', ['2026-09-24']]])
      && realCorr.length === 4 && realCorr.every(c => rows.change?.some(r => r.startsWith(c)))
      && rows.change?.some(r => /^QDRY 2026-09-21 close 104\.5 → 105\.5 — a reading taken at 2026-09-21T15:00:00Z while it traded, which this capture would replace; not a correction$/.test(r))
      && same(dryRefused, realRefused) && realRefused.length === 3
      && rows.refuse?.some(r => /^QDRY 03\/04\/2026 \(line 7\): AMBIGUOUS_DATE — ambiguous date/.test(r)) && rows.refuse?.some(r => /^QDRY 2026-09-24: .*HIGH_BELOW/.test(r))
      && rows.refuse?.some(r => /^QLIVE 2026-09-25: PROVISIONAL_READING — captured at 2026-09-25T15:00:00\.000Z, before its session closed/.test(r))
      && same(rows.trim, wantTrim) && same(gone('QDRY'), ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17']) && same(gone('QOLD'), ['2026-09-08', '2026-09-09'])
      && H?.series?.QLIVE?.['2026-09-25'] === 50 && existsSync(join(DR, 'real', 'h.json.bak')),
      'releaseB E1: the dry run names, row by row, exactly what the real import then did — the three sessions and one it adds, the four fields it corrects and the screen reading it finalises, the three rows it refuses (an ambiguous date by its line, a high under its low, a mid-session reading over a final bar) as the rejects file lists them, and the six bars the keep of 5 trims, from a series the export never touched too',
      { rows, realNew, realCorr, realRefused, wantTrim });

    /* 4. A history that is not there yet, in a folder that is not there:
       read as empty, reported, and neither made. --dry says the same, as
       it does to history-check and the scanner. */
    const nowhere = join(DR, 'nowhere', 'deeper', 'h.json');
    const d3 = await imp(args(nowhere, '--dry'));
    check(!existsSync(join(DR, 'nowhere')) && d3.code === 2 && /against .*h\.json \(not there yet\); nothing is written/.test(d3.stdout)
      && /would write .*h\.json — 2 symbols — dry run, not written/.test(d3.stdout) && /h\.json \(still absent\) and .*h\.rejects\.json are as they were/.test(d3.stdout),
      'releaseB E1: --dry against a history that does not exist yet reads it as empty, says so, and creates neither the file nor its folder',
      { code: d3.code, out: d3.stdout.split('\n').filter(l => /DRY RUN|would write|dry run:/.test(l)), made: existsSync(join(DR, 'nowhere')) });
  } catch (e) {
    fail('releaseB E1: the test threw', e.stack || e.message);
  } finally {
    await rm(DR, { recursive: true, force: true }).catch(() => {});
  }
}
/* ---- end releaseB: small-backlog ---- */

console.log(failures ?`\n${failures} failed, ${passes} passed` : `\nall ${passes} history-store checks hold`);
process.exit(failures ? 1 : 0);
