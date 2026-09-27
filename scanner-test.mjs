#!/usr/bin/env node
/**
 * scanner-test.mjs — the scanner engine, sliced out of index.html exactly as
 * the worker slices it, on series whose indicator values are worked by hand;
 * then the worker itself, on a temporary copy of the fixture. No browser, no
 * network, no repository data.
 *
 *   node scanner-test.mjs
 *
 * WHY HAND-WORKED SERIES. The fixture's self-test proves the engine reproduces
 * itself; it cannot prove the arithmetic is right. So the averages, RSI and
 * MACD are checked on inputs short enough to compute on paper — an SMA3 of
 * 1..5, an RSI of fourteen +1 changes and one −1 — and the fixture is checked
 * only for the structural facts: one alert, the right key, nothing on a second
 * pass. If a smoothing constant or a warm-up index ever changes, it fails here
 * with the number, not on a reader's screen with a match that should not have
 * been one.
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEngine, validateSetups, ROOT } from './scanner/scan.mjs';

const run = promisify(execFile);
let passes = 0, failures = 0;
const fail = (msg, detail) => { failures++; console.error(`FAIL  ${msg}`); if (detail !== undefined) console.error(`      ${JSON.stringify(detail)}`); };
const ok = (msg) => { passes++; console.log(`ok    ${msg}`); };
const check = (cond, msg, detail) => cond ? ok(msg) : fail(msg, detail);
const near = (a, b, eps = 1e-9) => Number.isFinite(a) && Math.abs(a - b) <= eps;

let E;
try { E = await loadEngine(); ok('the engine region is found between its markers in index.html and defines scanRun'); }
catch (e) { fail('the engine region loads from index.html', e.message); console.log(`\n1 failed, ${passes} passed`); process.exit(1); }

/* ---------------------------------------------------------------- engine -- */
const st = E.scanSelfTest();
check(st.ok, 'self-test: the fixture returns one alert for MATCH on its last bar, and none on a second pass', st);

/* Averages on 1..5 — small enough to check by eye. */
const sma = E.scanSma([1, 2, 3, 4, 5], 3);
check(JSON.stringify(sma) === JSON.stringify([null, null, 2, 3, 4]), 'SMA3 of 1..5 is null, null, 2, 3, 4', sma);
const ema = E.scanEma([1, 2, 3, 4, 5], 3);
check(ema[0] === null && ema[1] === null && near(ema[2], 2) && near(ema[3], 3) && near(ema[4], 4),
  'EMA3 of 1..5 seeds on the first three bars and smooths at k = 0.5: 2, 3, 4', ema);
check(E.scanEma([1, 2], 3).every(v => v === null), 'an EMA on fewer bars than its period is null throughout');

/* Wilder's RSI. */
const up = Array.from({ length: 20 }, (_, i) => i + 1);
check(E.scanRsi(up, 14).slice(14).every(v => near(v, 100)), 'RSI14 of a series that only rises is 100 from the 15th bar');
const alt = Array.from({ length: 15 }, (_, i) => (i % 2 ? 2 : 1));
const rAlt = E.scanRsi(alt, 14);
check(rAlt.slice(0, 14).every(v => v === null) && near(rAlt[14], 50), 'RSI14 of a ±1 alternation is null for 14 bars, then exactly 50', rAlt[14]);
const wil = [...Array.from({ length: 15 }, (_, i) => i + 1), 14];
const rw = E.scanRsi(wil, 14);
check(near(rw[15], 100 - 100 / 14), 'Wilder smoothing: fourteen +1 changes then one −1 gives RS 13 and RSI 92.857…', rw[15]);

/* MACD. */
const flat = new Array(40).fill(10);
const m = E.scanMacd(flat, 12, 26, 9);
check(m.line[24] === null && near(m.line[25], 0) && m.signal[32] === null && near(m.signal[33], 0) && near(m.hist[39], 0),
  'MACD on a flat series: the line starts at bar 26, the signal at bar 34, and all of it is zero',
  { l24: m.line[24], l25: m.line[25], s32: m.signal[32], s33: m.signal[33] });
const trend = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 3 + i * 0.2);
const mm = E.scanMacd(trend, 12, 26, 9);
const e12 = E.scanEma(trend, 12), e26 = E.scanEma(trend, 26);
check(near(mm.line[59], e12[59] - e26[59]), 'the MACD line is EMA12 less EMA26, bar for bar');

/* ----------------------------------------------------------------- rules -- */
const mkBars = (closes, volumes) => ({
  dates: closes.map((_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`),
  closes, volumes: volumes || closes.map(() => null),
});
const cross = E.scanRule({ left: { indicator: 'price' }, op: 'crosses_above', right: { value: 3 } }, mkBars([1, 2, 3, 2, 4]));
check(cross.met === true && /crossed above/.test(cross.text), 'price 2 → 4 crosses above a fixed 3', cross);
const stay = E.scanRule({ left: { indicator: 'price' }, op: 'crosses_above', right: { value: 3 } }, mkBars([1, 2, 3, 3.5, 4]));
check(stay.met === false, 'price already above 3 on the previous bar does not cross it again', stay);
const abv = E.scanRule({ left: { indicator: 'price' }, op: 'above', right: { value: 3 } }, mkBars([1, 2, 3, 3.5, 4]));
check(abv.met === true, '…but it is above it', abv);
const touch = E.scanRule({ left: { indicator: 'price' }, op: 'crosses_above', right: { value: 3 } }, mkBars([1, 2, 3, 3, 4]));
check(touch.met === true, 'a previous bar exactly on the level counts as from below', touch);
const below = E.scanRule({ left: { indicator: 'price' }, op: 'crosses_below', right: { value: 3 } }, mkBars([5, 4, 3.2, 2.9]));
check(below.met === true, 'price 3.2 → 2.9 crosses below 3', below);
const pv = E.scanRule({ left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'sma', n: 3 } }, mkBars([10, 10, 10, 9, 12]));
check(pv.met === true && near(pv.right, 31 / 3), 'price crosses above its SMA3 when the previous close sat below the previous average', pv);
const btw = E.scanRule({ left: { indicator: 'price' }, op: 'between', range: [70, 50] }, mkBars([1, 50]));
check(btw.met === true, 'between is inclusive and accepts a reversed range', btw);
const outside = E.scanRule({ left: { indicator: 'price' }, op: 'between', range: [50, 70] }, mkBars([1, 70.01]));
check(outside.met === false && /outside/.test(outside.text), 'just outside the range is outside', outside);

/* Untested is a third state, not a failure. */
const short = E.scanRule({ left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } }, mkBars(Array.from({ length: 20 }, (_, i) => i + 1)));
check(short.met === null && short.untested === true && /needs 51 bars; 20 held/.test(short.text),
  'a crossing of a 50-bar EMA on 20 bars is untested and says it needs 51', short);
const nov = E.scanRule({ left: { indicator: 'volume' }, op: 'above', right: { value: 1 } }, mkBars([1, 2, 3]));
check(nov.met === null && /no volume/.test(nov.text), 'a volume rule on an instrument without volume is untested, with the reason', nov);
check(E.scanRule({ left: { indicator: 'vwap' }, op: 'above', right: { value: 1 } }, mkBars([1, 2])).met === null, 'an unknown indicator is untested, not failed');
check(E.scanRule({ left: { indicator: 'price' }, op: 'equals', right: { value: 1 } }, mkBars([1, 2])).met === null, 'an unknown operator is untested, not failed');

/* ---------------------------------------------------------------- setups -- */
const bars20 = mkBars(Array.from({ length: 20 }, (_, i) => i + 1));
const met1 = { left: { indicator: 'price' }, op: 'above', right: { value: 1 } };
const untestable = { left: { indicator: 'sma', n: 50 }, op: 'above', right: { value: 1 } };
const andS = E.scanSetup({ id: 'a', logic: 'AND', rules: [met1, untestable] }, 'X', bars20);
check(andS.matched === false && andS.untested === true, 'AND with one untested rule is not a match, and is marked untested', andS);
const orS = E.scanSetup({ id: 'o', logic: 'OR', rules: [met1, untestable] }, 'X', bars20);
check(orS.matched === true && orS.untested === false, 'OR matches on the rule that could be tested', orS);
const andF = E.scanSetup({ id: 'f', logic: 'AND', rules: [met1, { left: { indicator: 'price' }, op: 'below', right: { value: 1 } }] }, 'X', bars20);
check(andF.matched === false && andF.untested === false, 'AND with a failed rule is a plain non-match', andF);
check(E.scanSetup({ id: 'e', rules: [] }, 'X', bars20).matched === false, 'a setup with no rules matches nothing');

/* ------------------------------------------------------------------- run -- */
const { history, setup, lastBar } = E.scanFixture();
const r1 = E.scanRun([setup], history, { now: 'T' });
check(r1.alerts.length === 1 && r1.alerts[0].key === `fixture-breakout|MATCH|daily|${lastBar}` && r1.alerts[0].engine === `scan ${E.SCAN_VERSION}`,
  'the fixture alert carries the dedupe key and the engine version', r1.alerts[0]);
check(r1.evaluated === 2 && r1.matched === 1 && r1.asOf === lastBar && r1.untested === 0,
  'two instruments evaluated, one matched, nothing untested, as-of is the last bar', { evaluated: r1.evaluated, matched: r1.matched, asOf: r1.asOf, untested: r1.untested });
const r2 = E.scanRun([setup], history, { existing: r1.alerts });
check(r2.alerts.length === 0 && r2.skipped.some(s => /already recorded/.test(s.why)), 'the same bar is not recorded twice', r2.skipped);

const dates = Object.keys(history.series.MATCH).sort();
const ago = (n, id = 'fixture-breakout') => ({ key: `${id}|MATCH|daily|${dates[dates.length - 1 - n]}`, setupId: id, symbol: 'MATCH', bar: dates[dates.length - 1 - n] });
check(E.scanRun([setup], history, { existing: [ago(3)] }).alerts.length === 0, 'a match 3 bars after the last one is inside a 5-bar cooldown');
check(E.scanRun([setup], history, { existing: [ago(5)] }).alerts.length === 0, 'a match exactly 5 bars after is still inside it');
check(E.scanRun([setup], history, { existing: [ago(6)] }).alerts.length === 1, 'a match 6 bars after is outside it');
check(E.scanRun([{ ...setup, cooldownBars: 0 }], history, { existing: [ago(1)] }).alerts.length === 1, 'cooldown 0 suppresses nothing');

/* Bars, not days: the same calendar date is 5 bars back in a full history and
   3 bars back in one missing two sessions. */
const always = { id: 'always', rules: [{ left: { indicator: 'price' }, op: 'above', right: { value: 0 } }], cooldownBars: 3, universe: { kind: 'symbols', symbols: ['MATCH'] } };
const gapH = JSON.parse(JSON.stringify(history));
[dates[dates.length - 3], dates[dates.length - 4]].forEach(d => { delete gapH.series.MATCH[d]; delete gapH.volume.MATCH[d]; });
const fullRun = E.scanRun([always], history, { existing: [ago(5, 'always')] });
const gapRun = E.scanRun([always], gapH, { existing: [ago(5, 'always')] });
check(fullRun.alerts.length === 1 && gapRun.alerts.length === 0 && /cooldown/.test(gapRun.skipped[0]?.why || ''),
  'cooldown counts bars, not calendar days', { full: fullRun.alerts.length, gap: gapRun.alerts.length, why: gapRun.skipped[0]?.why });

const exp = E.scanRun([{ ...setup, expires: '2026-01-31' }], history, {});
check(exp.alerts.length === 0 && exp.skipped.some(s => /expired 2026-01-31/.test(s.why)), 'a setup that expired before the last bar is skipped, with the date', exp.skipped);
check(E.scanRun([{ ...setup, expires: lastBar }], history, {}).alerts.length === 1, 'a setup expiring on the last bar still runs on it');

const symU = E.scanRun([{ ...setup, universe: { kind: 'symbols', symbols: ['match'] } }], history, {});
check(symU.evaluated === 1 && symU.alerts.length === 1, 'a symbols universe matches case-insensitively and evaluates only those');
const noneU = E.scanRun([{ ...setup, universe: { kind: 'symbols', symbols: ['ZZZ'] } }], history, {});
check(noneU.evaluated === 0 && noneU.skipped.some(s => /no instrument/.test(s.why)), 'a universe naming no held instrument is skipped, with the reason');
const mktU = E.scanRun([{ ...setup, universe: { kind: 'market', market: 'MY' } }], history, { instruments: [{ symbol: 'MATCH', market: 'MY' }, { symbol: 'FLAT', market: 'US' }] });
check(mktU.evaluated === 1 && mktU.alerts.length === 1, 'a market universe reads the instrument registry');

const misc = E.scanRun([{ ...setup, enabled: false }, { ...setup, id: '' }, { ...setup, id: 'w', timeframe: 'weekly' }], history, {});
check(misc.setups === 0 && misc.alerts.length === 0 && misc.skipped.filter(s => !s.symbol).length === 2,
  'a disabled setup is silent; an id-less or weekly one is skipped and says why', misc.skipped);
const two = E.scanRun([{ ...setup, id: 'b-second' }, { ...setup, id: 'a-first' }], history, {});
check(two.alerts.map(a => a.setupId).join(',') === 'b-second,a-first', 'alerts come out in the order the setups were written, not alphabetically', two.alerts.map(a => a.setupId));

/* ------------------------------------------------------------ validation -- */
const v = validateSetups({ setups: [
  setup,
  { ...setup, id: 'dup' }, { ...setup, id: 'dup' },
  { ...setup, id: 'bad-op', rules: [{ left: { indicator: 'price' }, op: 'equals', right: { value: 1 } }] },
  { ...setup, id: 'x', rules: [{ left: { indicator: 'price' }, op: 'between', range: [1] }] },
  { ...setup, id: 'y', expires: '31/01/2026' },
  { ...setup, id: 'z', universe: { kind: 'symbols' } },
] }, E);
check(v.setups.length === 1 && v.problems.length === 6,
  'validation keeps whole setups and names each problem: two duplicate ids, an unknown operator, a one-number range, a bad date, an empty symbols universe', v.problems);
check(validateSetups([setup], E).setups.length === 1 && validateSetups({ nope: 1 }, E).problems.length === 1, 'a bare list is accepted; anything else is one problem');

/* ---------------------------------------------------------------- worker -- */
const dir = join(tmpdir(), `qt-scan-test-${process.pid}`);
await mkdir(dir, { recursive: true });
const P = { setups: join(dir, 'setups.json'), history: join(dir, 'history.json'), alerts: join(dir, 'alerts.json') };
await writeFile(P.setups, JSON.stringify({ setups: [setup] }));
await writeFile(P.history, JSON.stringify(history));
const cli = async (...args) => {
  try { const { stdout, stderr } = await run(process.execPath, [join(ROOT, 'scanner/scan.mjs'), ...args]); return { code: 0, stdout, stderr }; }
  catch (e) { return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; }
};
const files = ['--setups', P.setups, '--history', P.history, '--alerts', P.alerts];
const chk = await cli('--check');
check(chk.code === 0 && /self-test ok/.test(chk.stdout), 'scan.mjs --check exits 0 after the self-test', { code: chk.code, err: chk.stderr.slice(0, 300) });
const dry = await cli('--dry', ...files);
check(dry.code === 0 && /1 new alert recorded \(dry run/.test(dry.stdout) && !existsSync(P.alerts), 'a dry run reports the alert and writes nothing', { code: dry.code, out: dry.stdout.slice(-300) });
const real = await cli(...files);
const doc1 = existsSync(P.alerts) ? JSON.parse(await readFile(P.alerts, 'utf8')) : null;
check(real.code === 0 && doc1?.alerts?.length === 1 && doc1.lastRun.recorded === 1 && doc1.engine === `scan ${E.SCAN_VERSION}`,
  'a real run writes one alert and the run summary', { code: real.code, lastRun: doc1?.lastRun, err: real.stderr.slice(0, 300) });
const again = await cli(...files);
const doc2 = JSON.parse(await readFile(P.alerts, 'utf8'));
check(again.code === 0 && doc2.alerts.length === 1 && doc2.lastRun.recorded === 0 && doc2.lastRun.matched === 1,
  'a second run on the same bar matches again and records nothing new', doc2.lastRun);
await writeFile(P.setups, JSON.stringify({ setups: [setup, { ...setup, id: 'too-long', rules: [{ left: { indicator: 'sma', n: 500 }, op: 'above', right: { value: 1 } }] }] }));
const warn = await cli(...files);
check(warn.code === 2 && /UNTESTED EVERYWHERE/.test(warn.stdout) && /too-long/.test(warn.stdout), 'a setup no instrument holds enough bars for exits 2 and is named', { code: warn.code });
const none = await cli('--setups', join(dir, 'missing.json'), '--history', P.history, '--alerts', P.alerts);
check(none.code === 1 && /no setups file/.test(none.stderr), 'a missing setups file exits 1 with the path', { code: none.code, err: none.stderr.slice(0, 200) });
await writeFile(P.alerts, '{not json');
const badA = await cli(...files);
check(badA.code === 1 && (await readFile(P.alerts, 'utf8')) === '{not json', 'an unreadable alerts file is left alone and the run exits 1', { code: badA.code });
await rm(dir, { recursive: true, force: true });

/* A watchlist universe is a snapshot of symbols carried in the setup — the
   worker cannot read a browser's storage — evaluated like a symbols list and
   refused without its snapshot. */
const wlU = E.scanRun([{ ...setup, universe: { kind: 'watchlist', watchlistId: 'wl-1', name: 'Core', symbols: ['match'], asOf: '2026-03-11' } }], history, {});
check(wlU.evaluated === 1 && wlU.alerts.length === 1, 'a watchlist universe evaluates the symbols it snapshotted, case-insensitively', { evaluated: wlU.evaluated, alerts: wlU.alerts.length });
const vw = validateSetups({ setups: [{ ...setup, id: 'w1', universe: { kind: 'watchlist', watchlistId: 'wl-1' } }, { ...setup, id: 'w2', universe: { kind: 'watchlist', watchlistId: 'wl-1', symbols: ['MATCH'] } }] }, E);
check(vw.setups.length === 1 && vw.problems.length === 1 && /snapshot/.test(vw.problems[0]), 'a watchlist universe without its symbol snapshot is refused, with the reason', vw.problems);
const exDoc = JSON.parse(await readFile(join(ROOT, 'scanner/setups.example.json'), 'utf8'));
const vex = validateSetups(exDoc, E);
check(vex.problems.length === 0 && vex.setups.length === exDoc.setups.length, 'the committed example setups all validate', vex.problems);

/* ONE READING OF EVERY NUMBER. An omitted period is the indicator's default
   everywhere — series, label, bars needed — never 1; a quoted number is the
   number; null, true and '' are not numbers and are refused with the reason.
   A missing volume is not a volume of nought. A cooldown survives the
   previous alert's bar leaving the history. (Review findings 1–4, 14, 15.) */
{
  const up = mkBars(Array.from({ length: 30 }, (_, i) => 100 + i));
  const sOmit = E.scanIndicatorSeries({ indicator: 'sma' }, up), s20 = E.scanIndicatorSeries({ indicator: 'sma', n: 20 }, up);
  check(sOmit.label === 'SMA20' && sOmit.needs === 20 && sOmit.series.findIndex(v => v != null) === 19 && near(sOmit.series[29], s20.series[29]),
    'an omitted SMA period is 20 in the series, the label and the bars needed — not a 1-bar average equal to the close', { label: sOmit.label, needs: sOmit.needs, first: sOmit.series.findIndex(v => v != null) });
  const rOmit = E.scanIndicatorSeries({ indicator: 'rsi' }, up);
  check(rOmit.label === 'RSI14' && rOmit.needs === 15, 'an omitted RSI period is 14 and needs 15 bars', { label: rOmit.label, needs: rOmit.needs });
  const short = E.scanRule({ left: { indicator: 'price' }, op: 'above', right: { indicator: 'sma' } }, mkBars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
  check(short.met === null && /SMA20 needs 20 bars; 10 held/.test(short.text), 'a default-period SMA on 10 bars is untested, not failed', short);
  const trend = mkBars(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 3 + i * 0.2));
  const mStr = E.scanIndicatorSeries({ indicator: 'macd', fast: '12', slow: '26', signal: '9', field: 'signal' }, trend);
  const mNum = E.scanIndicatorSeries({ indicator: 'macd', fast: 12, slow: 26, signal: 9, field: 'signal' }, trend);
  check(near(mStr.series[59], mNum.series[59]) && mStr.needs === 34 && mNum.needs === 34, 'quoted MACD periods are read as numbers — the same series and the same bars needed', { str: mStr.series[59], num: mNum.series[59], needs: mStr.needs });
  const mLine = E.scanIndicatorSeries({ indicator: 'macd' }, trend);
  check(mLine.needs === 26 && mLine.label === 'MACD line', 'the MACD line needs the slow average only — 26 bars, not 34', { needs: mLine.needs, label: mLine.label });
  const vb = mkBars(Array.from({ length: 25 }, () => 10), Array.from({ length: 25 }, () => 1000));
  const x3 = E.scanIndicatorSeries({ indicator: 'volume_avg', n: 20, multiplier: '3' }, vb);
  check(near(x3.series[24], 3000) && x3.label === '3× 20-bar average volume', 'a quoted multiplier is applied, and the label says so', { value: x3.series[24], label: x3.label });
  const nv = E.scanRule({ left: { indicator: 'price' }, op: 'above', right: { value: null } }, mkBars([1, 2, 3]));
  check(nv.met === null && /no value/.test(nv.text), 'a null right-hand value is untested, never compared as 0', nv);
  const nr = E.scanRule({ left: { indicator: 'price' }, op: 'between', range: [null, 70] }, mkBars([1, 50]));
  check(nr.met === null && /two numbers/.test(nr.text), 'a null range bound is untested, never read as 0', nr);
  const gapVol = Array.from({ length: 25 }, () => 1000); gapVol[22] = null;
  const va = E.scanRule({ left: { indicator: 'volume' }, op: 'above', right: { indicator: 'volume_avg', n: 20 } }, mkBars(Array.from({ length: 25 }, () => 10), gapVol));
  check(va.met === null && /not recorded for 1 of the last 20 bars/.test(va.text), 'an average volume over a window with an unrecorded bar is untested, with the count', va);
  const vv = E.scanValidate({ setups: [
    { ...setup, id: 'v-null', rules: [{ left: { indicator: 'price' }, op: 'above', right: { value: null } }] },
    { ...setup, id: 'v-range', rules: [{ left: { indicator: 'rsi', n: 14 }, op: 'between', range: [null, 70] }] },
    { ...setup, id: 'v-bool', rules: [{ left: { indicator: 'volume' }, op: 'above', right: { indicator: 'volume_avg', multiplier: true } }] },
    { ...setup, id: 'v-blank', rules: [{ left: { indicator: 'sma', n: '' }, op: 'above', right: { value: 1 } }] },
    { ...setup, id: 'v-ok', rules: [{ left: { indicator: 'sma' }, op: 'above', right: { value: '1.5' } }] },
  ] });
  check(vv.setups.map(s => s.id).join() === 'v-ok' && vv.problems.length === 4, 'null values and bounds, a boolean multiplier and a blank period are refused; an omitted period and a quoted value pass', vv.problems);
  check(JSON.stringify(validateSetups(exDoc, E)) === JSON.stringify(E.scanValidate(exDoc)), 'the worker and the page validate with the same function');
  /* The previous alert's bar is gone from the history; the cooldown still holds. */
  const hGone = JSON.parse(JSON.stringify(history));
  const prevBar = dates[dates.length - 3];
  delete hGone.series.MATCH[prevBar]; delete hGone.volume.MATCH[prevBar];
  const cdGone = E.scanRun([always], hGone, { existing: [{ key: `always|MATCH|daily|${prevBar}`, setupId: 'always', symbol: 'MATCH', bar: prevBar }] });
  check(cdGone.alerts.length === 0 && /cooldown/.test(cdGone.skipped[0]?.why || ''), 'the cooldown holds when the previous alert\'s bar has left the history', cdGone.skipped);
}

/* AUDIT FINDINGS (scanner#0–#6, lead6, lead8, lead20). A column of zeros is
   no volume; a named symbol with no series, a series with no market and an
   untested pair each say why; the run's bars are the bars it evaluated; an
   empty setups file is no setups; an expired setup is not "untested
   everywhere"; typed paths are the reader's; the record is replaced whole. */
{
  const n = 30;
  const flatBars = (vols) => mkBars(Array.from({ length: n }, (_, i) => 10 + (i % 3)), vols);
  const zeros = flatBars(Array.from({ length: n }, () => 0));
  const zBelow = E.scanRule({ left: { indicator: 'volume' }, op: 'below', right: { value: 1 } }, zeros);
  const zAvg = E.scanRule({ left: { indicator: 'price' }, op: 'above', right: { indicator: 'volume_avg', n: 20 } }, zeros);
  check(zBelow.met === null && /no volume is carried/.test(zBelow.text) && zAvg.met === null && /no volume is carried/.test(zAvg.text),
    'an instrument whose volume is 0 on every bar carries no volume: volume and average-volume rules are untested, not met', { zBelow, zAvg });
  const someZero = flatBars(Array.from({ length: n }, (_, i) => (i % 5 === 0 || i === n - 1 ? 0 : 500)));
  const sz = E.scanRule({ left: { indicator: 'volume' }, op: 'below', right: { value: 1 } }, someZero);
  check(sz.met === true, 'a zero-trade day among positive readings is still a reading of 0', sz);
  const noLast = flatBars(Array.from({ length: n }, (_, i) => (i === n - 1 ? null : 500)));
  const nl = E.scanRule({ left: { indicator: 'volume' }, op: 'above', right: { value: 1 } }, noLast);
  check(nl.met === null && nl.text === 'volume: volume is not recorded for the last bar', 'a bar with no recorded volume says so, not "needs 1 bars"', nl);

  const miss = E.scanRun([{ ...setup, universe: { kind: 'symbols', symbols: ['MATCH', 'NOPE'] } }], history, {});
  check(miss.evaluated === 1 && miss.skipped.some(s => s.symbol === 'NOPE' && /no series/.test(s.why)),
    'a named symbol with no series is listed as skipped, with the reason, not dropped', miss.skipped);
  const missAll = E.scanRun([{ ...setup, universe: { kind: 'symbols', symbols: ['ZZZ', 'YYY'] } }], history, {});
  check(missAll.skipped.length === 1 && /no instrument.*\(ZZZ, YYY\)/.test(missAll.skipped[0].why), 'a universe with no series at all names the symbols it could not find', missAll.skipped);

  const deep = E.scanRun([{ ...setup, id: 'deep', rules: [{ left: { indicator: 'sma', n: 500 }, op: 'above', right: { value: 1 } }] }], history, {});
  check(deep.untested === 2 && deep.untestedList.length === 2 && deep.untestedList[0].why === `SMA500 needs 500 bars; ${dates.length} held`,
    'each untested pair carries the rule that could not be read', deep.untestedList);
  check(deep.untestedEverywhere.length === 1 && deep.untestedEverywhere[0].setup === 'deep' && /SMA500 needs 500 bars/.test(deep.untestedEverywhere[0].why),
    'a setup untested on every instrument is named with the rule, not a fixed sentence', deep.untestedEverywhere);

  const unreg = E.scanRun([{ ...setup, universe: { kind: 'market', market: 'US' } }], history, { instruments: [{ symbol: 'FLAT', market: 'US' }] });
  check(unreg.evaluated === 1 && unreg.skipped.some(s => s.symbol === 'MATCH' && /not in data\/instruments\.json/.test(s.why)),
    'a market universe names the series it cannot place in any market', unreg.skipped);

  /* LAG ends 30 bars before the others, so the evaluated bars span a range
     and LAG is far enough behind to be flagged. */
  const hLag = JSON.parse(JSON.stringify(history));
  hLag.series.LAG = Object.fromEntries(dates.slice(0, dates.length - 30).map(d => [d, 50]));
  const lagRun = E.scanRun([{ ...always, cooldownBars: 0, universe: { kind: 'symbols', symbols: ['MATCH', 'LAG'] } }], hLag, {});
  check(lagRun.asOf === lastBar && lagRun.asOfFrom === dates[dates.length - 31] && E.scanBarRange(lagRun.asOfFrom, lagRun.asOf) === `${dates[dates.length - 31]} … ${lastBar}`,
    'the run\'s bars are the bars it evaluated, not the newest in the file', { asOf: lagRun.asOf, from: lagRun.asOfFrom });
  check(lagRun.stale.some(s => s.symbol === 'LAG' && /behind the newest bar/.test(s.why)) && !lagRun.stale.some(s => s.symbol === 'MATCH'),
    'a series far behind the newest bar in the history is flagged, and a current one is not', lagRun.stale);

  const expiredDeep = E.scanRun([{ ...setup, id: 'old', expires: '2026-01-31', rules: [{ left: { indicator: 'sma', n: 500 }, op: 'above', right: { value: 1 } }] }], history, {});
  check(expiredDeep.untestedEverywhere.length === 0 && expiredDeep.evaluated === 0, 'an expired setup is not "untested everywhere": it was never evaluated', expiredDeep);

  /* The worker, from another directory, with relative paths. */
  const d2 = join(tmpdir(), `qt-scan-test-rel-${process.pid}`);
  await mkdir(d2, { recursive: true });
  await writeFile(join(d2, 'setups.json'), JSON.stringify({ setups: [setup] }));
  await writeFile(join(d2, 'history.json'), JSON.stringify(history));
  const cliIn = async (cwd, ...args) => {
    try { const { stdout, stderr } = await run(process.execPath, [join(ROOT, 'scanner/scan.mjs'), ...args], { cwd }); return { code: 0, stdout, stderr }; }
    catch (e) { return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; }
  };
  const rel = await cliIn(d2, '--setups', 'setups.json', '--history', 'history.json', '--alerts', 'alerts.json');
  check(rel.code === 0 && existsSync(join(d2, 'alerts.json')) && !existsSync(join(ROOT, 'alerts.json')),
    'relative --setups/--history/--alerts paths are taken from the current directory', { code: rel.code, err: rel.stderr.slice(0, 200) });
  const rel2 = await cliIn(d2, '--setups', 'setups.json', '--history', 'history.json', '--alerts', 'alerts.json');
  const bak = existsSync(join(d2, 'alerts.json.bak')) ? JSON.parse(await readFile(join(d2, 'alerts.json.bak'), 'utf8')) : null;
  check(rel2.code === 0 && bak?.alerts?.length === 1 && !existsSync(join(d2, 'alerts.json.tmp')),
    'the record is written beside itself and renamed over: the previous one is kept as .bak, no .tmp is left', { code: rel2.code, bak: !!bak });
  await writeFile(join(d2, 'empty.json'), JSON.stringify({ setups: [] }));
  const empty = await cliIn(d2, '--setups', 'empty.json', '--history', 'history.json', '--alerts', 'alerts.json', '--dry');
  check(empty.code === 1 && /holds no setups/.test(empty.stderr), 'a setups file with an empty list exits 1, as "no setups"', { code: empty.code, err: empty.stderr.slice(0, 200) });
  await writeFile(join(d2, 'expired.json'), JSON.stringify({ setups: [{ ...setup, id: 'old', expires: '2026-01-31', rules: [{ left: { indicator: 'sma', n: 500 }, op: 'above', right: { value: 1 } }] }] }));
  const expd = await cliIn(d2, '--setups', 'expired.json', '--history', 'history.json', '--alerts', 'alerts.json', '--dry');
  check(expd.code === 0 && !/UNTESTED EVERYWHERE/.test(expd.stdout), 'an expired setup with a rule nothing can test does not exit 2', { code: expd.code });

  /* history-import: a blank volume cell is no reading, not a day of 0. */
  await writeFile(join(d2, 'T.csv'), 'date,close,volume\n2026-01-02,10,100\n2026-01-05,11,\n2026-01-06,12,0\n');
  let imp = { code: 0 };
  try { await run(process.execPath, [join(ROOT, 'ingest/history-import.mjs'), '--in', join(d2, 'T.csv'), '--symbol', 'T', '--out', join(d2, 'hist-import.json')], { cwd: d2 }); }
  catch (e) { imp = { code: e.code, err: String(e.stderr || '').slice(0, 200) }; }
  const hi = existsSync(join(d2, 'hist-import.json')) ? JSON.parse(await readFile(join(d2, 'hist-import.json'), 'utf8')) : null;
  check(imp.code === 0 && hi?.volume?.T?.['2026-01-02'] === 100 && !('2026-01-05' in (hi?.volume?.T || {})) && hi?.volume?.T?.['2026-01-06'] === 0,
    'history-import leaves a blank volume cell unrecorded and keeps a written 0', { imp, vol: hi?.volume?.T });
  await rm(d2, { recursive: true, force: true });
}

/* The two data files are personal and git-ignored; CI also checks this, but a
   local run should say so before a push does. */
try {
  const { stdout: tracked } = await run('git', ['ls-files'], { cwd: ROOT });
  check(!/^data\/scan-(setups|alerts)\.json$/m.test(tracked), 'neither scanner data file is tracked by git');
} catch { ok('git is not available here — the tracked-files check runs in CI'); }

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} scanner checks hold`);
process.exit(failures ? 1 : 0);
