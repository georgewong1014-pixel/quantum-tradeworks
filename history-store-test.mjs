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

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} history-store checks hold`);
process.exit(failures ? 1 : 0);
