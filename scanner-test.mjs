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

import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEngine, validateSetups, extractEngine, ENGINE_EXPORTS, ROOT } from './scanner/scan.mjs';

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
check(r1.alerts.length === 1 && r1.alerts[0].key === `fixture-breakout|v1|MATCH|1D|${lastBar}|MATCH` && r1.alerts[0].engine === `scan ${E.SCAN_VERSION}`,
  'the fixture alert carries the V2 dedupe key (id|version|instrument|timeframe|bar|event) and the engine version', r1.alerts[0]);
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

const misc = E.scanRun([{ ...setup, enabled: false }, { ...setup, id: '' }, { ...setup, id: 'w', timeframe: '1H' }], history, {});
check(misc.setups === 0 && misc.alerts.length === 0 && misc.skipped.filter(s => !s.symbol).length === 2 && /intraday data is not held/.test(misc.skipped[1]?.why || ''),
  'a disabled setup is silent; an id-less or hourly one is skipped and says why', misc.skipped);
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
/* The fixture is dated in January–April 2026; the worker judges staleness
   against its clock, so it is told the morning after the fixture's last bar. */
const FX_NOW = E.scanFixture().now;
const files = ['--setups', P.setups, '--history', P.history, '--alerts', P.alerts, '--now', FX_NOW];
const chk = await cli('--check');
check(chk.code === 0 && /self-test ok/.test(chk.stdout), 'scan.mjs --check exits 0 after the self-test', { code: chk.code, err: chk.stderr.slice(0, 300) });
const dry = await cli('--dry', ...files);
check(dry.code === 0 && /1 new alert recorded \(dry run/.test(dry.stdout) && !existsSync(P.alerts), 'a dry run reports the alert and writes nothing', { code: dry.code, out: dry.stdout.slice(-300) });
const real = await cli(...files);
const doc1 = existsSync(P.alerts) ? JSON.parse(await readFile(P.alerts, 'utf8')) : null;
check(real.code === 0 && doc1?.alerts?.length === 1 && doc1.lastRun.recorded === 1 && doc1.engine === `scan ${E.SCAN_VERSION}`,
  'a real run writes one alert and the run summary', { code: real.code, lastRun: doc1?.lastRun, err: real.stderr.slice(0, 300) });
const w0 = doc1?.alerts?.[0] || {};
check(/^a[0-9a-f]{8}$/.test(w0.id || '') && w0.eventType === 'MATCH' && w0.setupVersion === 1 && Array.isArray(w0.matchedConditions) && w0.bar === w0.candleDate && Array.isArray(w0.rules)
  && /^run-/.test(w0.runId || '') && w0.origin === 'cli' && doc1.lastRun.runId === w0.runId && /^[0-9a-f]{8}$/.test(doc1.lastRun.setupsHash || ''),
  'the worker writes V2 alerts (id, version, event, values, run id) with the 0.2 fields kept, and names the run in lastRun', w0);
const again = await cli(...files);
const doc2 = JSON.parse(await readFile(P.alerts, 'utf8'));
check(again.code === 0 && doc2.alerts.length === 1 && doc2.lastRun.recorded === 0 && doc2.lastRun.matched === 1,
  'a second run on the same bar matches again and records nothing new', doc2.lastRun);
/* THE UPGRADE. An alerts file written by engine 0.2.0 holds the old key for
   today's bar; the first 0.3.0 run must not record that bar again. */
const P02 = join(dir, 'alerts-02.json');
await writeFile(P02, JSON.stringify({ engine: 'scan 0.2.0', alerts: [{ key: `fixture-breakout|MATCH|daily|${lastBar}`, setupId: 'fixture-breakout', setupName: 'Fixture breakout', symbol: 'MATCH', timeframe: 'daily', bar: lastBar, close: 104.5, recordedAt: '2026-04-06T22:00:00Z', rules: [], engine: 'scan 0.2.0' }] }));
const upg = await cli('--setups', P.setups, '--history', P.history, '--alerts', P02, '--now', FX_NOW);
const upDoc = JSON.parse(await readFile(P02, 'utf8'));
check(upg.code === 0 && upDoc.alerts.length === 1 && upDoc.lastRun.recorded === 0 && upDoc.lastRun.matched === 1, 'the first 0.3.0 run over a 0.2.0 alerts file records nothing already recorded under the old key', upDoc.lastRun);
await writeFile(P.setups, JSON.stringify({ setups: [setup, { ...setup, id: 'too-long', rules: [{ left: { indicator: 'sma', n: 500 }, op: 'above', right: { value: 1 } }] }] }));
const warn = await cli(...files);
check(warn.code === 2 && /UNTESTED EVERYWHERE/.test(warn.stdout) && /too-long/.test(warn.stdout), 'a setup no instrument holds enough bars for exits 2 and is named', { code: warn.code });
const none = await cli('--setups', join(dir, 'missing.json'), '--history', P.history, '--alerts', P.alerts);
check(none.code === 3 && /no setups file/.test(none.stderr) && /status     SKIPPED_NO_SETUPS/.test(none.stdout), 'a missing setups file is SKIPPED_NO_SETUPS, exits 3 and names the path', { code: none.code, err: none.stderr.slice(0, 200) });
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
  const rel = await cliIn(d2, '--setups', 'setups.json', '--history', 'history.json', '--alerts', 'alerts.json', '--now', FX_NOW);
  check(rel.code === 0 && existsSync(join(d2, 'alerts.json')) && !existsSync(join(ROOT, 'alerts.json')),
    'relative --setups/--history/--alerts paths are taken from the current directory', { code: rel.code, err: rel.stderr.slice(0, 200) });
  const rel2 = await cliIn(d2, '--setups', 'setups.json', '--history', 'history.json', '--alerts', 'alerts.json', '--now', FX_NOW);
  const bak = existsSync(join(d2, 'alerts.json.bak')) ? JSON.parse(await readFile(join(d2, 'alerts.json.bak'), 'utf8')) : null;
  check(rel2.code === 0 && bak?.alerts?.length === 1 && !existsSync(join(d2, 'alerts.json.tmp')),
    'the record is written beside itself and renamed over: the previous one is kept as .bak, no .tmp is left', { code: rel2.code, bak: !!bak });
  await writeFile(join(d2, 'empty.json'), JSON.stringify({ setups: [] }));
  const empty = await cliIn(d2, '--setups', 'empty.json', '--history', 'history.json', '--alerts', 'alerts.json', '--dry');
  check(empty.code === 3 && /holds no setups/.test(empty.stderr), 'a setups file with an empty list exits 3, as "no setups"', { code: empty.code, err: empty.stderr.slice(0, 200) });
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

/* ==========================================================================
   ENGINE 0.3.0 — the market engine (src/js/24-market-engine.js)

   Reference values are worked by hand on inputs short enough to check on
   paper, and every indicator is also compared bar for bar with a second,
   deliberately naive implementation written from its textbook definition
   (loops, no shared helpers) over a 300-bar synthetic OHLCV series from a
   committed linear congruential generator — no third-party data. Then the
   statuses and reason codes, every operator, rule trees and their limits,
   units, the event types, the keys, determinism, look-ahead, provisional
   bars, calendars, readiness, weekly bars, the cache, historical testing,
   the dashboard status, data health and the trend context.
   ========================================================================== */
const near9 = (a, b) => (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* Weekday dates from a Monday, as the history holds sessions. */
const weekdays = (from, n) => { const out = []; for (let d = from; out.length < n; d = E.scanAddDays(d, 1)) { const w = E.scanWeekday(d); if (w >= 1 && w <= 5) out.push(d); } return out; };
const hist = (map, vol = null, extra = {}) => ({ series: map, volume: vol || {}, ...extra });
const seriesOf = (ds, vals) => Object.fromEntries(ds.map((d, i) => [d, vals[i]]));
/* The synthetic series. */
function lcgSeries(n, seed = 12345) {
  let s = seed >>> 0;
  const u = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
  const o = [], h = [], l = [], c = [], v = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const open = prev, close = prev * (1 + (u() - 0.5) * 0.04);
    o.push(open); c.push(close);
    h.push(Math.max(open, close) * (1 + u() * 0.01)); l.push(Math.min(open, close) * (1 - u() * 0.01));
    v.push(Math.round(1000 + u() * 9000));
    prev = close;
  }
  return { o, h, l, c, v };
}
const ohlcBars = (L) => ({ ...E.scanSeriesBars(L.c, { open: L.o, high: L.h, low: L.l, volumes: L.v }) });
{
  /* ---------------------------------------------------------- constants -- */
  check(E.SCAN_VERSION === '0.3.0', 'SCAN_VERSION is 0.3.0');
  check(same(E.SCAN_LIMITS, { maxDepth: 3, maxConditions: 20, maxPeriod: 520, maxSetups: 200 }), 'SCAN_LIMITS is maxDepth 3, maxConditions 20, maxPeriod 520, maxSetups 200', E.SCAN_LIMITS);
  check(E.SCAN_TIMEFRAMES['1D'].built && E.SCAN_TIMEFRAMES['1W'].built && E.SCAN_TIMEFRAMES['1W'].derivedFrom === '1D'
    && ['1H', '15M', '5M'].every(t => E.SCAN_TIMEFRAMES[t].built === false && /intraday data is not held/.test(E.SCAN_TIMEFRAMES[t].reason)),
    'SCAN_TIMEFRAMES: 1D built, 1W built from 1D, 1H/15M/5M not built and each says why');
  check(Object.keys(E.SCAN_OPERATORS).join() === 'GREATER_THAN,LESS_THAN,GREATER_THAN_OR_EQUAL,LESS_THAN_OR_EQUAL,EQUALS,CROSSES_ABOVE,CROSSES_BELOW,BETWEEN'
    && same(E.SCAN_OP_ALIASES, { above: 'GREATER_THAN', below: 'LESS_THAN', crosses_above: 'CROSSES_ABOVE', crosses_below: 'CROSSES_BELOW', between: 'BETWEEN' }),
    'SCAN_OPERATORS carries the specification\'s eight names, with the five 0.2 names as aliases');
  check(E.SCAN_TOLERANCE.relative === 1e-9 && E.SCAN_TOLERANCE.absolute === 1e-12 && /0\.1 \+ 0\.2 equals 0\.3/.test(E.SCAN_TOLERANCE.text), 'EQUALS has a stated tolerance: 1e-9 relative, 1e-12 absolute, in words');
  const IDS = ['price', 'volume', 'sma', 'ema', 'rsi', 'macd', 'volume_avg', 'bb', 'atr', 'high_n', 'low_n', 'close_high_n', 'close_low_n', 'change', 'rvol'];
  const thin = IDS.filter(id => { const d = E.SCAN_INDICATORS[id]; return !d || !d.label || !d.params || !Array.isArray(d.inputs) || !(d.unit || d.fields) || typeof d.needs !== 'function' || !d.formula || !Number.isInteger(d.calcVersion); });
  check(!thin.length && same(Object.keys(E.SCAN_INDICATORS), IDS), 'SCAN_INDICATORS holds all fifteen indicators, each with label, params, inputs, unit or fields, needs, formula and calcVersion', thin);
  check(same(Object.keys(E.SCAN_INDICATORS.macd.fields), ['line', 'signal', 'hist']) && same(Object.keys(E.SCAN_INDICATORS.bb.fields), ['upper', 'middle', 'lower', 'width', 'pctb'])
    && E.SCAN_INDICATORS.rsi.calcVersion === 2 && /Wilder/.test(E.SCAN_INDICATORS.rsi.formula) && /Wilder/.test(E.SCAN_INDICATORS.atr.formula) && /POPULATION/.test(E.SCAN_INDICATORS.bb.formula),
    'MACD has line/signal/hist, Bollinger upper/middle/lower/width/%b; RSI (calcVersion 2) and ATR are Wilder\'s; Bollinger states its population deviation');
  check(E.SCAN_INDICATORS.atr.inputs.includes('high') && E.SCAN_INDICATORS.high_n.inputs.join() === 'high' && E.SCAN_INDICATORS.low_n.inputs.join() === 'low'
    && E.SCAN_INDICATORS.close_high_n.inputs.join() === 'close' && E.scanSideLabel({ indicator: 'close_high_n' }) === '52-week closing high' && E.scanSideLabel({ indicator: 'high_n' }) === '52-week high',
    'ATR and the true high/low need highs and lows; the close-based extremes are labelled closing highs and lows');
  check(['US', 'MY', 'FX', 'CRYPTO', '_default'].every(k => E.SCAN_MARKETS[k]?.tz && Array.isArray(E.SCAN_MARKETS[k].days)) && E.SCAN_MARKETS.US.tz === 'America/New_York' && E.SCAN_MARKETS.MY.tz === 'Asia/Kuala_Lumpur'
    && E.SCAN_MARKETS.US.settleMin === 30 && E.SCAN_MARKETS.CRYPTO.days.length === 7, 'SCAN_MARKETS has US, MY, FX, CRYPTO and _default with zone, close, settle and weekdays');
  const inst = await readFile(join(ROOT, 'src/js/26-instruments.js'), 'utf8');
  check(/tz: SCAN_MARKETS\.US\.tz/.test(inst) && /tz: SCAN_MARKETS\.MY\.tz/.test(inst) && !/tz: 'America\/New_York'/.test(inst) && !/tz: 'Asia\/Kuala_Lumpur'/.test(inst),
    '26-instruments takes MARKETS\' time zones from SCAN_MARKETS rather than typing them again');
  const mods = (await readdir(join(ROOT, 'src/js'))).filter(f => f.endsWith('.js')).sort();
  check(mods.indexOf('24-market-engine.js') >= 0 && mods.indexOf('24-market-engine.js') < mods.indexOf('26-instruments.js') && mods.indexOf('24-market-engine.js') < mods.indexOf('60-trend.js'),
    'the engine module loads before 26-instruments and 60-trend (build order is filename order)');
  const page = await readFile(join(ROOT, 'src/js/86-scanner.js'), 'utf8');
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  check(!page.includes('@scan-engine-start') && !/function scanRun\b/.test(page) && html.split('@scan-engine-start').length === 2 && html.split('@scan-engine-end').length === 2,
    'the engine region lives only in 24-market-engine.js: the page file defines none of it, and index.html carries each marker once');
  const missing = ENGINE_EXPORTS.filter(k => !(k in E));
  check(!missing.length && ENGINE_EXPORTS.length > 80, `loadEngine returns every name it lists (${ENGINE_EXPORTS.length})`, missing);

  /* ------------------------------------------------- hashing and identity -- */
  const fnvNaive = (s) => { let h = 0x811c9dc5; for (const b of Buffer.from(s, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); };
  check(E.scanHash('') === '811c9dc5' && E.scanHash('a') === 'e40c292c' && E.scanHash('foobar') === 'bf9cf968', 'scanHash is FNV-1a-32: the published vectors for "", "a" and "foobar"');
  check(['“quoted”', 'Ringgit RM1.50 — café', '𝄞 music', 'a|v1|MY:1155|1D|2026-01-02|MATCH'].every(s => E.scanHash(s) === fnvNaive(s)), 'scanHash hashes UTF-8 bytes, astral characters included, as a byte-wise reference does');
  check(E.scanStable({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] }, z: undefined }) === '{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}', 'scanStable sorts keys at every level and drops undefined');
  const h0 = E.scanNormaliseSetup(setup).hash;
  const renamed = E.scanNormaliseSetup({ ...setup, name: 'Other name', enabled: false }).hash;
  const reordered = E.scanNormaliseSetup(Object.fromEntries(Object.entries(setup).reverse())).hash;
  const aliased = E.scanNormaliseSetup({ ...setup, rules: [{ ...setup.rules[0], op: 'CROSSES_ABOVE' }, setup.rules[1], { ...setup.rules[2], range: ['50', '70'] }] }).hash;
  const changed = E.scanNormaliseSetup({ ...setup, rules: [{ ...setup.rules[0], right: { indicator: 'ema', n: 40 } }, ...setup.rules.slice(1)] }).hash;
  const defaults = [E.scanCanonical({ id: 'x', rules: [{ left: { indicator: 'sma' }, op: 'above', right: { value: 1 } }] }), E.scanCanonical({ id: 'x', rules: [{ left: { indicator: 'sma', n: 20 }, op: 'GREATER_THAN', right: { value: '1' } }] })];
  check(/^[0-9a-f]{8}$/.test(h0) && h0 === renamed && h0 === reordered && h0 === aliased && h0 !== changed && defaults[0] === defaults[1],
    'a setup\'s hash covers its evaluation fields only: name, enabled, key order, alias names, quoted numerals and filled-in defaults do not change it; a period does', { h0, renamed, reordered, aliased, changed });
  const k2 = E.scanKey('s', 2, 'US:AAPL', 'daily', '2026-01-02', 'NEW_MATCH');
  check(k2 === 's|v2|US:AAPL|1D|2026-01-02|NEW_MATCH' && E.scanAlertId(k2) === `a${E.scanHash(k2)}` && /^a[0-9a-f]{8}$/.test(E.scanAlertId(k2)) && E.scanLegacyKey('s', 'AAPL', '2026-01-02') === 's|AAPL|daily|2026-01-02',
    'scanKey is id|vN|instrument|timeframe|bar|event, the 0.2 key is id|SYMBOL|daily|bar, and an alert id is "a" + the key\'s hash');

  /* ------------------------------------------- indicator reference values -- */
  check(same(E.scanEma([2, 4, 6, 8, 4], 2), [null, 3, 5, 7, 5]), 'EMA2 of 2, 4, 6, 8, 4 by hand: seed 3, then k = 2/3 gives 5, 7, 5');
  /* StockCharts' RSI worksheet closes. By hand: the first fourteen changes
     gain 3.34 and lose 1.40, so RS = 3.34 / 1.40 and RSI = 70.46; the next
     change is −0.28, so gain = (3.34/14 × 13) / 14 and loss = (1.40/14 × 13
     + 0.28) / 14, and RSI = 66.25. */
  const sc = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const rs = E.scanRsi(sc, 14);
  const g1 = 3.34 / 14, l1 = 1.40 / 14, g2 = g1 * 13 / 14, l2 = (l1 * 13 + 0.28) / 14;
  check(rs[13] === null && near(rs[14], 100 - 100 / (1 + g1 / l1)) && near(rs[15], 100 - 100 / (1 + g2 / l2)) && rs[14].toFixed(2) === '70.46' && rs[15].toFixed(2) === '66.25',
    'Wilder RSI14 on the StockCharts worksheet closes equals the hand-worked 70.46 and 66.25', rs.slice(13, 16));
  const mc = E.scanMacd([10, 12, 11, 13, 15, 14], 2, 3, 2);
  check(mc.line[1] === null && near(mc.line[2], 0) && near(mc.line[5], 31 / 108) && mc.signal[2] === null && near(mc.signal[3], 1 / 6) && near(mc.signal[5], 28 / 81) && near(mc.hist[5], -19 / 324),
    'MACD(2,3,2) on 10, 12, 11, 13, 15, 14 by hand: line 31/108, signal 28/81 (seeded 1/6), histogram −19/324', { line: mc.line, signal: mc.signal });
  const bbBars = mkBars([2, 4, 4, 4, 5, 5, 7, 9]);
  const bbv = (field) => E.scanIndicatorSeries({ indicator: 'bb', n: 8, k: 2, field }, bbBars).values[7];
  check(near(bbv('middle'), 5) && near(bbv('upper'), 9) && near(bbv('lower'), 1) && near(bbv('width'), 1.6) && near(bbv('pctb'), 1),
    'Bollinger(8,2) of 2, 4, 4, 4, 5, 5, 7, 9: mean 5, population σ 2, bands 9 and 1, width 1.6, %b of the close 9 is 1');
  const rows = [[10, 8, 9], [11, 9, 10], [12, 9, 11], [11, 10, 10.5], [13, 10, 12]];
  const hl = { ...mkBars(rows.map(r => r[2])), high: rows.map(r => r[0]), low: rows.map(r => r[1]), open: rows.map(() => null), hasOHLC: true };
  const atr = E.scanIndicatorSeries({ indicator: 'atr', n: 3 }, hl);
  check(atr.values[2] === null && atr.status[2] === 'INSUFFICIENT_DATA' && near(atr.values[3], 2) && near(atr.values[4], 7 / 3),
    'ATR3 by hand: true ranges 2, 3, 1 average 2; the next true range 3 smooths to 7/3', atr.values);
  const ser = (spec, bars) => E.scanIndicatorSeries(spec, bars).values;
  check(ser({ indicator: 'high_n', n: 3 }, hl)[3] === 12 && ser({ indicator: 'high_n', n: 3 }, hl)[4] === 13 && ser({ indicator: 'low_n', n: 3 }, hl)[4] === 9
    && ser({ indicator: 'close_high_n', n: 3 }, hl)[3] === 11 && ser({ indicator: 'close_low_n', n: 3 }, hl)[4] === 10.5,
    'the 3-bar high, low, closing high and closing low read off the table by hand');
  check(near(ser({ indicator: 'change', n: 2 }, mkBars([100, 110, 121]))[2], 21) && ser({ indicator: 'change', n: 2 }, mkBars([100, 110, 121]))[1] === null, 'change(2) from 100 to 121 is 21%, and needs three bars');
  const rv = ser({ indicator: 'rvol', n: 20 }, mkBars(Array.from({ length: 21 }, () => 10), [...Array.from({ length: 20 }, () => 1000), 3000]));
  check(rv[20] === 3 && rv[19] === null, 'relative volume leaves the current bar out of its reference: twenty bars of 1000 then 3000 is exactly 3.0');

  /* An independent implementation, written from the textbook definitions. */
  const Lc = lcgSeries(300);
  const B = ohlcBars(Lc);
  const N = Lc.c.length;
  const naive = {
    sma: (a, n) => a.map((_, i) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += a[j]; return s / n; }),
    ema: (a, n) => { const k = 2 / (n + 1), out = []; let e = null; for (let i = 0; i < a.length; i++) { if (i < n - 1) { out.push(null); continue; } if (i === n - 1) { let s = 0; for (let j = 0; j < n; j++) s += a[j]; e = s / n; } else e = a[i] * k + e * (1 - k); out.push(e); } return out; },
    rsi: (a, n) => { const out = a.map(() => null); let ag = 0, al = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0; if (i <= n) { ag += g / n; al += l / n; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; } if (i >= n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return out; },
    bb: (a, n, k) => a.map((_, i) => { if (i < n - 1) return null; const w = a.slice(i - n + 1, i + 1), m = w.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / n); return { upper: m + k * sd, middle: m, lower: m - k * sd, width: 2 * k * sd / m, pctb: (a[i] - (m - k * sd)) / (2 * k * sd) }; }),
    atr: (h, l, c, n) => { const tr = c.map((_, i) => (i === 0 ? null : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])))); const out = c.map(() => null); let a = null; for (let i = n; i < c.length; i++) { if (i === n) { let s = 0; for (let j = 1; j <= n; j++) s += tr[j]; a = s / n; } else a = (a * (n - 1) + tr[i]) / n; out[i] = a; } return out; },
    ext: (a, n, f) => a.map((_, i) => (i < n - 1 ? null : f(...a.slice(i - n + 1, i + 1)))),
    change: (a, n) => a.map((_, i) => (i < n ? null : (a[i] / a[i - n] - 1) * 100)),
    rvol: (v, n) => v.map((_, i) => { if (i < n) return null; let s = 0; for (let j = i - n; j < i; j++) s += v[j]; return v[i] / (s / n); }),
  };
  const nm = { fast: naive.ema(Lc.c, 12), slow: naive.ema(Lc.c, 26) };
  const nLine = Lc.c.map((_, i) => (nm.fast[i] == null || nm.slow[i] == null ? null : nm.fast[i] - nm.slow[i]));
  const nSig = (() => { const first = nLine.findIndex(x => x != null); const t = naive.ema(nLine.slice(first), 9); return nLine.map((_, i) => (i < first ? null : t[i - first])); })();
  const nBb = naive.bb(Lc.c, 20, 2);
  const cases = [
    ['SMA20', { indicator: 'sma', n: 20 }, naive.sma(Lc.c, 20)],
    ['EMA20', { indicator: 'ema', n: 20 }, naive.ema(Lc.c, 20)],
    ['RSI14', { indicator: 'rsi', n: 14 }, naive.rsi(Lc.c, 14)],
    ['MACD line', { indicator: 'macd', field: 'line' }, nLine],
    ['MACD signal', { indicator: 'macd', field: 'signal' }, nSig],
    ['MACD histogram', { indicator: 'macd', field: 'hist' }, nLine.map((x, i) => (x == null || nSig[i] == null ? null : x - nSig[i]))],
    ...['upper', 'middle', 'lower', 'width', 'pctb'].map(f => [`Bollinger ${f}`, { indicator: 'bb', field: f }, nBb.map(x => (x ? x[f] : null))]),
    ['ATR14', { indicator: 'atr', n: 14 }, naive.atr(Lc.h, Lc.l, Lc.c, 14)],
    ['high 50', { indicator: 'high_n', n: 50 }, naive.ext(Lc.h, 50, Math.max)],
    ['low 50', { indicator: 'low_n', n: 50 }, naive.ext(Lc.l, 50, Math.min)],
    ['closing high 50', { indicator: 'close_high_n', n: 50 }, naive.ext(Lc.c, 50, Math.max)],
    ['closing low 50', { indicator: 'close_low_n', n: 50 }, naive.ext(Lc.c, 50, Math.min)],
    ['change 10', { indicator: 'change', n: 10 }, naive.change(Lc.c, 10)],
    ['relative volume 20', { indicator: 'rvol', n: 20 }, naive.rvol(Lc.v, 20)],
    ['average volume 20', { indicator: 'volume_avg', n: 20 }, naive.sma(Lc.v, 20)],
  ];
  const off = cases.filter(([, spec, ref]) => { const got = E.scanIndicatorSeries(spec, B).values; return got.length !== N || got.some((x, i) => !near9(x, ref[i])); }).map(c => c[0]);
  check(!off.length, `every indicator equals a naive textbook implementation bar for bar over a 300-bar synthetic OHLCV series, to 1e-9 (${cases.length} series)`, off);

  /* --------------------------------------------- statuses and reason codes -- */
  const IR = (spec, bars, at = null) => E.scanIndicator(spec, bars, { at });
  const ten = mkBars(Array.from({ length: 10 }, (_, i) => 10 + i));
  const nb = IR({ indicator: 'sma', n: 20 }, ten);
  check(nb.status === 'INSUFFICIENT_DATA' && nb.reason.code === 'NEEDS_BARS' && nb.value === null && nb.valueText === null && nb.reason.text === 'SMA20 needs 20 bars; 10 held',
    'INSUFFICIENT_DATA NEEDS_BARS: an SMA20 on ten bars, with no value', nb);
  const gapped = { ...mkBars([1, 2, 3, 4, 5, 6, 7, 8, 9]), gapBefore: [0, 0, 0, 0, 0, 1, 0, 0, 0], gapTolerance: 0 };
  const ms = IR({ indicator: 'sma', n: 3 }, gapped, 6), ms2 = IR({ indicator: 'sma', n: 3 }, gapped, 7);
  check(ms.status === 'INSUFFICIENT_DATA' && ms.reason.code === 'MISSING_SESSION' && ms2.status === 'VALID' && near(ms2.value, 7),
    'INSUFFICIENT_DATA MISSING_SESSION: an SMA3 whose window spans a missing session; the next window clear of it is valid', { ms, ms2: ms2.value });
  const nv0 = IR({ indicator: 'volume' }, mkBars([1, 2, 3]));
  const nvw = IR({ indicator: 'volume_avg', n: 3 }, mkBars([1, 2, 3, 4], [5, null, 5, 5]), 3);
  check(nv0.status === 'INVALID_INPUT' && nv0.reason.code === 'NO_VOLUME' && nvw.status === 'INSUFFICIENT_DATA' && nvw.reason.code === 'NO_VOLUME' && /1 of the last 3 bars/.test(nvw.reason.text),
    'NO_VOLUME: an instrument with no volume is INVALID_INPUT; an unrecorded volume inside the window is INSUFFICIENT_DATA, with the count', { nv0: nv0.reason, nvw: nvw.reason });
  const closeOnly = E.scanBars(history, 'MATCH');
  const nhl = [IR({ indicator: 'atr' }, closeOnly), IR({ indicator: 'high_n', n: 5 }, closeOnly), IR({ indicator: 'low_n', n: 5 }, closeOnly)];
  check(!closeOnly.hasOHLC && nhl.every(x => x.status === 'INVALID_INPUT' && x.reason.code === 'NO_HIGH_LOW' && x.value === null) && IR({ indicator: 'close_high_n', n: 5 }, closeOnly).status === 'VALID',
    'INVALID_INPUT NO_HIGH_LOW: ATR and the true high and low on close-only history — never estimated from closes; the closing high still computes', nhl.map(x => x.reason));
  const flat = mkBars(Array.from({ length: 30 }, () => 50), Array.from({ length: 30 }, () => 100));
  const zdR = IR({ indicator: 'rsi', n: 14 }, flat), zdB = IR({ indicator: 'bb', field: 'pctb' }, flat), zdW = IR({ indicator: 'bb', field: 'width' }, flat);
  const zdV = IR({ indicator: 'rvol', n: 5 }, mkBars([1, 1, 1, 1, 1, 1], [0, 0, 0, 0, 0, 500]));
  check([zdR, zdB, zdV].every(x => x.status === 'INVALID_INPUT' && x.reason.code === 'ZERO_DENOMINATOR' && x.value === null) && zdW.status === 'VALID' && zdW.value === 0,
    'INVALID_INPUT ZERO_DENOMINATOR: RSI of a flat window (0.2 called it 100), %b of a flat band, relative volume over a zero reference; a flat band\'s width is 0', [zdR, zdB, zdV].map(x => x.reason));
  const bp = [IR({ indicator: 'sma', n: 1e9 }, ten), IR({ indicator: 'macd', fast: 30, slow: 10 }, ten), IR({ indicator: 'sma', n: '' }, ten), IR({ indicator: 'bb', field: 'nope' }, ten)];
  check(bp.every(x => x.status === 'INVALID_INPUT' && x.reason.code === 'BAD_PARAMS'), 'INVALID_INPUT BAD_PARAMS: a period of 1e9, MACD fast 30 over slow 10, a blank period, an unknown field', bp.map(x => x.reason?.text));
  const unk = IR({ indicator: 'vwap' }, ten);
  check(unk.status === 'INVALID_INPUT' && unk.reason.code === 'UNKNOWN_INDICATOR' && unk.reason.text === 'unknown indicator “vwap”', 'INVALID_INPUT UNKNOWN_INDICATOR names the indicator');
  const late = E.scanBars(history, 'MATCH', { now: '2026-09-28T12:00:00Z' });
  const st1 = IR({ indicator: 'price' }, late), st0 = IR({ indicator: 'price' }, late, late.dates.length - 2);
  check(late.stale && late.stale.expected === '2026-09-25' && st1.status === 'STALE_DATA' && st1.reason.code === 'STALE' && st1.value === null && st0.status === 'VALID',
    'STALE_DATA STALE: a history ending in April judged on 28 September — the last bar is stale, an earlier bar read in the past is not', { stale: late.stale, st1: st1.reason });
  check(same(E.scanEma([1, null, 3, 4], 2), [null, null, null, 3.5]), 'an EMA across an unrecorded value re-seeds after it — never averages it in as 0 (0.2 gave 0.5)');
  const full = IR({ indicator: 'rsi', n: 14 }, E.scanBars(history, 'MATCH'));
  check(full.status === 'VALID' && full.calculationVersion === 'rsi@2' && full.indicator === 'rsi(n=14)' && /^fnv1a:[0-9a-f]{8}$/.test(full.dataVersion) && full.valueText === E.scanDec(full.value)
    && full.timestamp === lastBar && full.have === 66 && full.needs === 15 && full.unit === 'osc_0_100',
    'an IndicatorResult carries value, valueText, status, reason, calculationVersion, dataVersion, timestamp, needs and have', full);
  check(E.SCAN_STATUSES.join() === 'VALID,INSUFFICIENT_DATA,STALE_DATA,INVALID_INPUT' && ['NEEDS_BARS', 'MISSING_SESSION', 'NO_VOLUME', 'NO_HIGH_LOW', 'ZERO_DENOMINATOR', 'BAD_PARAMS', 'UNKNOWN_INDICATOR', 'STALE', 'PROVISIONAL_BAR'].every(k => E.SCAN_REASONS[k]),
    'the four statuses and nine reason codes are each named, with a sentence');

  /* ----------------------------------------------------------- operators -- */
  const cmp = E.scanCompare;
  check(cmp('EQUALS', 0.1 + 0.2, 0.3) && !cmp('GREATER_THAN', 0.1 + 0.2, 0.3) && cmp('GREATER_THAN_OR_EQUAL', 0.1 + 0.2, 0.3) && cmp('LESS_THAN_OR_EQUAL', 0.3, 0.1 + 0.2) && !cmp('LESS_THAN', 0.3, 0.1 + 0.2),
    'the float rule: 0.1 + 0.2 EQUALS 0.3 and is not GREATER_THAN it; the inclusive comparisons hold both ways');
  check(cmp('EQUALS', 100, 100 + 5e-8) && !cmp('EQUALS', 100, 100.0001) && cmp('EQUALS', 0, 5e-13) && !cmp('EQUALS', 0, 1e-11),
    'EQUALS tolerance is one billionth of the larger value, and 1e-12 near zero — no looser');
  const p5 = mkBars([1, 2, 3, 2, 4]);
  const opCase = (op, right, range) => E.scanRule({ left: { indicator: 'price' }, op, right, range }, p5).met;
  const table = [['GREATER_THAN', { value: 3 }, null, true], ['GREATER_THAN', { value: 4 }, null, false], ['LESS_THAN', { value: 3 }, null, false], ['LESS_THAN', { value: 5 }, null, true],
    ['GREATER_THAN_OR_EQUAL', { value: 4 }, null, true], ['GREATER_THAN_OR_EQUAL', { value: 4.5 }, null, false], ['LESS_THAN_OR_EQUAL', { value: 4 }, null, true], ['LESS_THAN_OR_EQUAL', { value: 3.5 }, null, false],
    ['EQUALS', { value: 4 }, null, true], ['EQUALS', { value: 4.01 }, null, false], ['CROSSES_ABOVE', { value: 3 }, null, true], ['CROSSES_ABOVE', { value: 1.5 }, null, false],
    ['CROSSES_BELOW', { value: 3 }, null, false], ['BETWEEN', undefined, [5, 3], true], ['BETWEEN', undefined, [4.5, 6], false]];
  const wrong = table.filter(([op, r, rg, want]) => opCase(op, r, rg ?? undefined) !== want).map(t => t.slice(0, 3));
  check(!wrong.length, `every operator on 1, 2, 3, 2, 4 gives the hand answer (${table.length} cases)`, wrong);
  const aliasPairs = [['above', 'GREATER_THAN'], ['below', 'LESS_THAN'], ['crosses_above', 'CROSSES_ABOVE'], ['crosses_below', 'CROSSES_BELOW']];
  check(aliasPairs.every(([a, b]) => [1, 2, 3, 4, 5].every(v => opCase(a, { value: v }) === opCase(b, { value: v }))) && opCase('between', undefined, [3, 5]) === opCase('BETWEEN', undefined, [3, 5]),
    'each 0.2 operator name evaluates exactly as its specification name');
  /* The crossing reads the previous and the current COMPLETED bar: with the
     last bar provisional, the bar before it is the one a crossing is read
     on, and the provisional bar itself never confirms. */
  const withProv = { ...mkBars([5, 4, 3.2, 2.9, 3.5]), status: ['UNKNOWN', 'UNKNOWN', 'FINAL', 'FINAL', 'PROVISIONAL'] };
  const tree1 = { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'CROSSES_BELOW', right: { value: 3 } }] };
  const atProv = E.scanEvaluate(tree1, withProv), atPrev = E.scanEvaluate(tree1, withProv, { at: 3 });
  check(atProv.state === 'UNAVAILABLE' && atProv.reason.code === 'PROVISIONAL_BAR' && atPrev.state === 'MET' && atPrev.conditions[0].prevLeft.value === 3.2 && atPrev.conditions[0].left.value === 2.9,
    'a crossing reads the previous and current completed bars (3.2 → 2.9 crosses below 3); a provisional last bar is UNAVAILABLE PROVISIONAL_BAR', { atProv: atProv.reason, atPrev: atPrev.state });
  const bbBetween = E.scanRule({ left: { indicator: 'price' }, op: 'BETWEEN', range: [{ indicator: 'bb', field: 'lower' }, { indicator: 'bb', field: 'upper' }] }, B);
  check(bbBetween.state !== 'UNAVAILABLE' && /Bollinger\(20,2\) lower .* and Bollinger\(20,2\) upper/.test(bbBetween.text), 'BETWEEN takes operands as bounds: price between the Bollinger lower and upper bands', bbBetween.text);
  const approx = E.scanRule({ left: { indicator: 'price' }, op: 'approx', right: { value: 1 } }, p5);
  check(approx.met === null && approx.reason.code === 'UNKNOWN_OPERATOR' && E.scanValidate([{ ...setup, rules: [{ left: { indicator: 'price' }, op: 'approx', right: { value: 1 } }] }]).problemsBySetup['fixture-breakout'][0].code === 'UNKNOWN_OPERATOR',
    'an unknown operator ("approx") is untested when evaluated and refused, UNKNOWN_OPERATOR, when validated');
  const txt = E.scanRule({ left: { indicator: 'price' }, op: 'above', right: { value: 0.34 } }, mkBars([0.3, 0.345])).text;
  check(txt === 'price 0.345 above 0.340', 'two different values never print the same: 0.345 against 0.34 prints "0.345 above 0.340"', txt);

  /* ---------------------------------------------------------- rule trees -- */
  const b20 = mkBars(Array.from({ length: 20 }, (_, i) => i + 1));
  const C = { MET: { type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 1 } },
              NOT_MET: { type: 'condition', left: { indicator: 'price' }, op: 'LESS_THAN', right: { value: 1 } },
              UNAVAILABLE: { type: 'condition', left: { indicator: 'sma', n: 50 }, op: 'GREATER_THAN', right: { value: 1 } } };
  const S3 = ['MET', 'NOT_MET', 'UNAVAILABLE'];
  const kleene = { ALL: (a, b) => (a === 'NOT_MET' || b === 'NOT_MET' ? 'NOT_MET' : a === 'UNAVAILABLE' || b === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'MET'),
                   ANY: (a, b) => (a === 'MET' || b === 'MET' ? 'MET' : a === 'UNAVAILABLE' || b === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'NOT_MET') };
  const truth = [];
  for (const logic of ['ALL', 'ANY']) for (const a of S3) for (const b of S3) {
    const got = E.scanEvaluate({ type: 'group', logic, children: [C[a], C[b]] }, b20).state;
    if (got !== kleene[logic](a, b)) truth.push(`${logic}(${a}, ${b}) = ${got}`);
  }
  const nest = (logic, ...children) => ({ type: 'group', logic, children });
  const nested = [[nest('ALL', C.MET, nest('ANY', C.NOT_MET, C.UNAVAILABLE)), 'UNAVAILABLE'], [nest('ALL', C.NOT_MET, nest('ANY', C.UNAVAILABLE)), 'NOT_MET'],
                  [nest('ANY', C.NOT_MET, nest('ALL', C.MET, C.MET)), 'MET'], [nest('ANY', nest('ALL', C.MET, nest('ANY', C.NOT_MET, C.MET)), C.UNAVAILABLE), 'MET']];
  nested.forEach(([t, want], i) => { const got = E.scanEvaluate(t, b20).state; if (got !== want) truth.push(`nested ${i + 1} = ${got}`); });
  check(!truth.length, 'ALL and ANY follow Kleene\'s three-valued logic over MET, NOT_MET and UNAVAILABLE — all eighteen pairs and nested trees (ALL with a failed and an untested child is NOT_MET)', truth);
  check(E.scanEvaluate(nest('ALL', C.MET, nest('ANY', C.NOT_MET, C.MET)), b20).conditions.map(c => c.path).join() === '1,2.1,2.2', 'each condition carries its path in the tree');
  const deep = (d) => (d <= 1 ? nest('ALL', C.MET) : nest('ALL', C.MET, deep(d - 1)));
  const tv = (tree, extra = {}) => E.scanValidate([{ id: 't', ruleTree: tree, ...extra }]);
  const codesOf = (v) => (Object.values(v.problemsBySetup)[0] || []).map(p => p.code);
  check(tv(deep(3)).setups.length === 1 && codesOf(tv(deep(4))).includes('TOO_DEEP') && E.scanValidate([{ id: 't', ruleTree: deep(4) }], { limits: { maxDepth: 4 } }).setups.length === 1,
    'a tree three groups deep validates; four deep is refused TOO_DEEP; the limit can be raised per call');
  const wide = (n) => nest('ALL', ...Array.from({ length: n }, () => C.MET));
  check(tv(wide(20)).setups.length === 1 && codesOf(tv(wide(21))).join() === 'TOO_MANY_CONDITIONS', 'twenty conditions validate; twenty-one are refused TOO_MANY_CONDITIONS');
  check(codesOf(tv(nest('ALL'))).join() === 'EMPTY_GROUP' && codesOf(tv(nest('ALL', C.MET, nest('ANY')))).join() === 'EMPTY_GROUP', 'a group with no conditions is refused EMPTY_GROUP, at the root or nested');
  const many = E.scanValidate(Array.from({ length: 201 }, (_, i) => ({ ...setup, id: `s${i}` })));
  check(many.setups.length === 200 && many.problems.length === 1 && many.problemsBySetup.s200[0].code === 'TOO_MANY_SETUPS', 'the 201st setup in a file is refused TOO_MANY_SETUPS; the first 200 stand');
  const pathed = tv(nest('ALL', C.MET, nest('ANY', { ...C.MET, op: 'nearly' })));
  check(pathed.problemsBySetup.t[0].path === 'group 2 › condition 1' && /group 2 › condition 1: operator "nearly"/.test(pathed.problems[0]), 'a problem names its path in the tree', pathed.problemsBySetup);
  const n1 = E.scanNormaliseSetup(setup), n2 = E.scanNormaliseSetup(n1);
  check(same(n1, n2) && n1.version === 1 && n1.timeframe === '1D' && n1.cooldownMode === 'EVERY_MATCH' && n1.confirmationMode === 'BAR_CLOSE' && n1.ruleTree.logic === 'ALL'
    && n1.ruleTree.children.map(c => c.op).join() === 'CROSSES_ABOVE,GREATER_THAN,BETWEEN' && same(n1.ruleTree.children[2].range, [{ value: 50 }, { value: 70 }])
    && E.scanNormaliseSetup({ ...setup, logic: 'OR' }).ruleTree.logic === 'ANY' && E.scanNormaliseSetup({ id: 'x', ruleTree: C.MET }).cooldownMode === 'NEW_MATCH',
    'a 0.2 setup reads unchanged into SetupV2 (version 1, 1D, EVERY_MATCH, AND→ALL, OR→ANY, the operators renamed); normalising again changes nothing; a tree defaults to NEW_MATCH');

  /* --------------------------------------------------------------- units -- */
  const UNIT_OPS = { price: { indicator: 'sma', n: 5 }, price_delta: { indicator: 'atr' }, volume: { indicator: 'volume_avg' }, osc_0_100: { indicator: 'rsi' },
                     percent: { indicator: 'change', n: 5 }, ratio: { indicator: 'rvol' }, position: { indicator: 'bb', field: 'pctb' } };
  const units = Object.keys(UNIT_OPS);
  check(same(units.slice().sort(), Object.keys(E.SCAN_UNITS).sort()) && units.every(u => E.scanUnitOf(UNIT_OPS[u]) === u), 'every unit has a representative operand, and each operand reads as its unit');
  const matrix = [];
  for (const lu of units) for (const ru of units) for (const op of Object.keys(E.SCAN_OPERATORS)) {
    const cond = op === 'BETWEEN' ? { left: UNIT_OPS[lu], op, range: [UNIT_OPS[ru], UNIT_OPS[ru]] } : { left: UNIT_OPS[lu], op, right: UNIT_OPS[ru] };
    const v = E.scanValidate([{ id: 'u', rules: [cond] }]);
    const got = v.setups.length ? 'ok' : [...new Set(v.problemsBySetup.u.map(p => p.code))].join('+');
    const want = lu !== ru ? 'UNIT_MISMATCH' : op === 'EQUALS' && !['price', 'volume'].includes(lu) ? 'EQUALS_NOT_ALLOWED' : 'ok';
    if (got !== want) matrix.push(`${lu} ${op} ${ru}: ${got}, wanted ${want}`);
  }
  check(!matrix.length, `the unit matrix: ${units.length}×${units.length} unit pairs × 8 operators — same units validate, different units are UNIT_MISMATCH, EQUALS only between prices or volumes`, matrix.slice(0, 5));
  const lit = (left, op, value) => E.scanValidate([{ id: 'l', rules: [{ left, op, right: { value } }] }]);
  const litBad = [lit({ indicator: 'rsi' }, 'above', 150), lit({ indicator: 'volume' }, 'above', -1), lit({ indicator: 'price' }, 'above', 'abc'), lit({ indicator: 'price' }, 'above', 0), lit({ indicator: 'rvol' }, 'above', 0)];
  const litOk = lit({ indicator: 'rsi' }, 'above', '50');
  check(litBad.every(v => !v.setups.length && v.problemsBySetup.l[0].code === 'INVALID_LITERAL') && litOk.setups.length === 1 && litOk.setups[0].ruleTree.children[0].right.value === 50
    && lit({ indicator: 'change' }, 'below', -5).setups.length === 1 && lit({ indicator: 'macd', field: 'hist' }, 'below', -0.5).setups.length === 1,
    'literals are checked against the operand\'s domain: RSI 150, volume −1, "abc", a price of 0 and a ratio of 0 are INVALID_LITERAL; "50" becomes 50; a negative change or histogram is allowed');
  const extra = [E.scanValidate([{ id: 'x', rules: [{ left: { indicator: 'rsi' }, op: 'between', range: [30, 70], right: { value: 1 } }] }]),
                 E.scanValidate([{ id: 'x', rules: [{ left: { indicator: 'rsi' }, op: 'above', right: { value: 1 }, range: [1, 2] }] }])];
  check(extra.every(v => v.problemsBySetup.x[0].code === 'EXTRA_OPERAND') && E.scanValidate([{ id: 'x', rules: [{ left: { value: 3 }, op: 'above', right: { value: 1 } }] }]).problemsBySetup.x[0].code === 'BAD_OPERAND',
    'an operand that would be ignored is refused EXTRA_OPERAND, and a fixed value on the left is refused BAD_OPERAND');
  const badIds = ['a.b', 'a/b', 'a?b', 'a#b', 'a%b', 'a|b', 'a b'].map(id => E.scanValidate([{ ...setup, id }]).problemsBySetup[id]?.[0]?.code);
  check(badIds.every(c => c === 'BAD_ID') && E.scanValidate([{ ...setup, id: 'trend-breakout_2' }]).setups.length === 1, 'ids that a route or an alert key would misread (. / ? # % | whitespace) are refused BAD_ID', badIds);
  const tfs = ['1H', '15M', '5M'].map(t => E.scanValidate([{ ...setup, timeframe: t }]).problemsBySetup['fixture-breakout'][0].code);
  check(tfs.every(c => c === 'TIMEFRAME_NOT_BUILT') && E.scanValidate([{ ...setup, timeframe: 'weekly' }]).setups[0].timeframe === '1W' && E.scanValidate([{ ...setup, timeframe: '1W' }]).setups.length === 1
    && E.scanValidate([{ ...setup, timeframe: 'monthly' }]).problemsBySetup['fixture-breakout'][0].code === 'UNKNOWN_TIMEFRAME',
    'intraday timeframes are refused TIMEFRAME_NOT_BUILT; 1W (or "weekly") validates; an unknown one is UNKNOWN_TIMEFRAME', tfs);
  const vmode = E.scanValidate([{ ...setup, cooldownMode: 'SOMETIMES' }, { ...setup, id: 'v', version: 0 }, { ...setup, id: 'c', confirmationMode: 'INTRABAR' }]);
  check(same(Object.values(vmode.problemsBySetup).map(p => p[0].code), ['BAD_COOLDOWN_MODE', 'BAD_VERSION', 'BAD_CONFIRMATION']), 'a cooldown mode, version or confirmation mode outside the contract is refused with its code', vmode.problems);

  /* -------------------------------------- NEW_MATCH, EVERY_MATCH, FIRST_OBSERVED -- */
  const ds30 = weekdays('2026-03-02', 30);
  const steps = [...Array(20).fill(10), ...Array(5).fill(12), ...Array(5).fill(10)];
  const H1 = hist({ S: seriesOf(ds30, steps) });
  const above11 = (mode, cd = 0) => ({ id: `a11-${mode}`, ruleTree: nest('ALL', { type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 11 } }), cooldownMode: mode, cooldownBars: cd });
  const hEvery = E.scanHistorical(above11('EVERY_MATCH'), H1), hNew = E.scanHistorical(above11('NEW_MATCH'), H1);
  check(hEvery.matches.length === 5 && hEvery.recorded.length === 5 && hEvery.recorded.every(r => r.eventType === 'MATCH') && hNew.matches.length === 5 && hNew.recorded.length === 1
    && hNew.recorded[0].eventType === 'NEW_MATCH' && hNew.recorded[0].bar === ds30[20] && hEvery.events.length === 1,
    'five bars above 11: EVERY_MATCH records all five as MATCH; NEW_MATCH records one, on the bar the match began', { every: hEvery.recorded.length, new: hNew.recorded });
  const runAt = (s, d, existing = []) => E.scanRun([s], H1, { asOf: d, existing, now: 'T' });
  const began = runAt(above11('NEW_MATCH'), ds30[20]), cont = runAt(above11('NEW_MATCH'), ds30[22]);
  check(began.alerts.length === 1 && began.alerts[0].eventType === 'NEW_MATCH' && began.alerts[0].candleDate === ds30[20] && cont.alerts.length === 0 && cont.continuing === 1 && /still matching/.test(cont.skipped[0].why),
    'scanRun NEW_MATCH: the first bar above records NEW_MATCH; two bars later the match continues and nothing is recorded', { began: began.alerts[0]?.key, cont: cont.skipped });
  const sma21 = { id: 'fo', ruleTree: nest('ALL', { type: 'condition', left: { indicator: 'sma', n: 21 }, op: 'GREATER_THAN', right: { value: 5 } }), cooldownMode: 'NEW_MATCH' };
  const fo = runAt(sma21, ds30[20]);
  check(fo.alerts.length === 1 && fo.alerts[0].eventType === 'FIRST_OBSERVED' && /\|FIRST_OBSERVED$/.test(fo.alerts[0].key),
    'a match whose bar before could not be evaluated (SMA21 on its 21st bar) records FIRST_OBSERVED, not NEW_MATCH', fo.alerts[0]?.key);
  const zig = hist({ Z: seriesOf(weekdays('2026-03-02', 40), Array.from({ length: 40 }, (_, i) => (i % 2 ? 12 : 10))) });
  const zNo = E.scanHistorical(above11('NEW_MATCH', 0), zig), zCd = E.scanHistorical(above11('NEW_MATCH', 3), zig);
  const zIdx = zCd.recorded.map(r => zig.series.Z ? Object.keys(zig.series.Z).sort().indexOf(r.bar) : -1);
  check(zNo.recorded.length === 20 && zCd.recorded.length === 10 && zIdx.every((x, i) => i === 0 || x - zIdx[i - 1] === 4),
    'cooldownBars applies on top of NEW_MATCH, counted in bars: a match beginning every other bar is recorded every fourth bar with a 3-bar cooldown', { none: zNo.recorded.length, cd: zCd.recorded.length });
  /* What historical testing says would have been recorded is what a
     day-by-day replay of the worker records. */
  const replayed = [];
  const zd = Object.keys(zig.series.Z).sort();
  for (const d of zd) { const r = E.scanRun([above11('NEW_MATCH', 3)], zig, { asOf: d, existing: replayed, now: 'T' }); replayed.push(...r.alerts); }
  check(same(replayed.map(a => a.candleDate), zCd.recorded.map(r => r.bar)), 'scanHistorical\'s recorded bars equal a day-by-day scanRun replay with the same dedupe and cooldown', { replay: replayed.map(a => a.candleDate).slice(0, 4), hist: zCd.recorded.map(r => r.bar).slice(0, 4) });

  /* --------------------------------------------------------------- keys -- */
  const FXN = E.scanFixture().now;
  const v1run = E.scanRun([{ ...setup, cooldownBars: 0 }], history, { now: FXN });
  const legacyOnly = E.scanRun([{ ...setup, cooldownBars: 0 }], history, { now: FXN, existing: [{ key: `fixture-breakout|MATCH|daily|${lastBar}`, setupId: 'fixture-breakout', symbol: 'MATCH', bar: lastBar }] });
  const v2run = E.scanRun([{ ...setup, cooldownBars: 0, version: 2 }], history, { now: FXN, existing: [...v1run.alerts, { key: `fixture-breakout|MATCH|daily|${lastBar}` }] });
  const retry = E.scanRun([{ ...setup, cooldownBars: 0, version: 2 }], history, { now: FXN, existing: [...v1run.alerts, ...v2run.alerts] });
  check(v1run.alerts.length === 1 && legacyOnly.alerts.length === 0 && legacyOnly.deduped === 1 && v2run.alerts.length === 1 && v2run.alerts[0].key === `fixture-breakout|v2|MATCH|1D|${lastBar}|MATCH` && retry.alerts.length === 0,
    'the 0.2 key is honoured for version 1 (a bar recorded before the upgrade is not recorded again); version 2 of the setup records the same bar afresh; a retry records nothing', { legacy: legacyOnly.skipped, v2: v2run.alerts[0]?.key });
  const a0 = v1run.alerts[0], again1 = E.scanRun([{ ...setup, cooldownBars: 0 }], history, { now: FXN }).alerts[0];
  const direct = E.scanRule(setup.rules[0], E.scanBars(history, 'MATCH'));
  const V2_FIELDS = ['id', 'key', 'setupId', 'setupName', 'setupVersion', 'setupHash', 'setupSnapshot', 'instrumentId', 'symbol', 'market', 'timeframe', 'candleDate', 'detectedAt',
                     'eventType', 'cooldownMode', 'close', 'matchedConditions', 'dataSourceId', 'dataVersion', 'runId', 'origin', 'engine', 'bar', 'rules', 'recordedAt'];
  check(V2_FIELDS.every(k => k in a0) && a0.id === again1.id && a0.matchedConditions[0].left === direct.left && a0.matchedConditions[0].right === direct.right
    && same(Object.keys(a0.matchedConditions[0]).sort(), ['left', 'leftLabel', 'path', 'reason', 'right', 'rightLabel', 'state', 'status', 'text']) && a0.setupSnapshot.hash === a0.setupHash
    && a0.bar === a0.candleDate && a0.recordedAt === a0.detectedAt && a0.dataSourceId === 'personal-history',
    'the V2 alert carries every contract field, the 0.2 aliases (bar, rules, recordedAt), values equal to the rule\'s, and an id stable across runs', Object.keys(a0));
  const withReg = E.scanRun([{ ...setup, cooldownBars: 0 }], history, { now: FXN, instruments: [{ symbol: 'MATCH', market: 'US' }], runId: 'r-1', origin: 'daily' });
  check(withReg.alerts[0].instrumentId === 'US:MATCH' && withReg.alerts[0].market === 'US' && withReg.alerts[0].key.includes('|US:MATCH|') && withReg.alerts[0].runId === 'r-1' && withReg.alerts[0].origin === 'daily'
    && E.scanRun([{ ...setup, cooldownBars: 0 }], history, { now: FXN, instruments: [{ symbol: 'MATCH', market: 'US' }], existing: v1run.alerts }).alerts.length === 0,
    'with a registry row the instrument is MARKET:SYMBOL; a record keyed on the bare symbol still deduplicates it; runId and origin are written');
  const hCorr = JSON.parse(JSON.stringify(history)); hCorr.series.MATCH[dates[40]] += 0.01;
  const dvA = E.scanBars(history, 'MATCH').dataVersion, dvB = E.scanBars(hCorr, 'MATCH').dataVersion;
  const hRev = { series: { MATCH: Object.fromEntries(Object.entries(history.series.MATCH).reverse()) }, volume: { MATCH: Object.fromEntries(Object.entries(history.volume.MATCH).reverse()) } };
  check(dvA !== dvB && E.scanBars(hRev, 'MATCH').dataVersion === dvA && a0.dataVersion === E.scanDataVersion(E.scanBars(history, 'MATCH'), dates.length - 1),
    'dataVersion: the same bars in another key order give the same version; a corrected past close gives a different one');

  /* -------------------------------------------------------- determinism -- */
  const E2 = await loadEngine();
  const fx = E.scanFixture();
  const runJ = (X) => JSON.stringify(X.scanRun([fx.setup, fx.setupV2], fx.history, { now: fx.now, runId: 'det', origin: 'det' }));
  const histJ = (X) => JSON.stringify(X.scanHistorical(fx.setupV2, fx.history));
  const noCache = JSON.parse(runJ(E)); delete noCache.cacheStats;
  const withCache = E.scanRun([fx.setup, fx.setupV2], fx.history, { now: fx.now, runId: 'det', origin: 'det', cache: E.scanCache() }); delete withCache.cacheStats;
  check(runJ(E) === runJ(E) && runJ(E) === runJ(E2) && histJ(E) === histJ(E2) && same(noCache, withCache) && same(E.scanSelfTest(), E2.scanSelfTest()),
    'determinism: the engine sliced from index.html twice gives byte-identical runs, historical tests and self-tests; a shared cache changes nothing');

  /* ------------------------------------------------------- no look-ahead -- */
  const Hl = lcgSeries(260, 99);
  const lds = weekdays('2025-01-06', 260);
  const lh = { series: { L: seriesOf(lds, Hl.c) }, volume: { L: seriesOf(lds, Hl.v) }, ohlc: { L: seriesOf(lds, Hl.c.map((_, i) => [Hl.o[i], Hl.h[i], Hl.l[i]])) } };
  const lb = E.scanBars(lh, 'L');
  const bigTree = nest('ALL',
    { type: 'condition', left: { indicator: 'price' }, op: 'CROSSES_ABOVE', right: { indicator: 'ema', n: 20 } },
    nest('ANY', { type: 'condition', left: { indicator: 'rsi' }, op: 'BETWEEN', range: [{ value: 40 }, { value: 70 }] },
                { type: 'condition', left: { indicator: 'price' }, op: 'BETWEEN', range: [{ indicator: 'bb', field: 'lower' }, { indicator: 'bb', field: 'upper' }] }),
    nest('ANY', { type: 'condition', left: { indicator: 'rvol' }, op: 'GREATER_THAN', right: { value: 1.2 } }, { type: 'condition', left: { indicator: 'atr' }, op: 'LESS_THAN', right: { indicator: 'macd', field: 'line', multiplier: 50 } }),
    { type: 'condition', left: { indicator: 'macd', field: 'hist' }, op: 'GREATER_THAN', right: { value: -100 } });
  const shape = (r) => ({ state: r.state, c: r.conditions.map(c => [c.path, c.state, c.leftValue, c.rightValue, c.reason?.code || null]) });
  const la = [];
  for (let i = 0; i < lb.dates.length; i++) if (!same(shape(E.scanEvaluate(bigTree, lb, { at: i })), shape(E.scanEvaluate(bigTree, E.scanSliceBars(lb, i + 1))))) la.push(i);
  check(!la.length, `no look-ahead: evaluating at bar i equals evaluating the history cut at i, at every one of ${lb.dates.length} bars, for a nested tree over nine indicators`, la.slice(0, 5));
  const lhMore = JSON.parse(JSON.stringify(lh));
  const extraDays = weekdays(E.scanAddDays(lds[lds.length - 1], 1), 50), noise = lcgSeries(50, 7);
  extraDays.forEach((d, i) => { lhMore.series.L[d] = noise.c[i] * 3; lhMore.volume.L[d] = noise.v[i]; lhMore.ohlc.L[d] = [noise.o[i] * 3, noise.h[i] * 3, noise.l[i] * 3]; });
  const trAll = { id: 'la', ruleTree: bigTree, cooldownMode: 'EVERY_MATCH' };
  const hA = E.scanHistorical(trAll, lh), hB = E.scanHistorical(trAll, lhMore, { maxBars: 10000 });
  const cutoff = lds[lds.length - 1];
  check(same(hA.matches, hB.matches.filter(m => m.bar <= cutoff)) && same(hA.events, hB.events.filter(m => m.bar <= cutoff)) && hB.matches.length >= hA.matches.length,
    'no look-ahead, as a mutation: fifty bars of noise appended after a date change no historical row on or before it', { a: hA.matches.length, b: hB.matches.length });

  /* --------------------------------------------- time, status, provisional -- */
  const bs = E.scanBarStatus;
  check(bs('MY', '2026-09-28', '2026-09-28T08:30:00Z') === 'PROVISIONAL' && bs('MY', '2026-09-28', '2026-09-28T10:00:00Z') === 'FINAL'
    && bs('US', '2026-09-28', '2026-09-28T19:00:00Z') === 'PROVISIONAL' && bs('US', '2026-09-28', '2026-09-28T20:31:00Z') === 'FINAL'
    && bs('US', '2026-11-02', '2026-11-02T20:31:00Z') === 'PROVISIONAL' && bs('US', '2026-11-02', '2026-11-02T21:31:00Z') === 'FINAL' && bs('US', '2026-11-02', null) === 'UNKNOWN',
    'bar status: MY 08:30Z is before 17:00 + 30m local (PROVISIONAL), 10:00Z after; US 19:00Z before 16:30 EDT, 20:31Z after; on 2 November EST moves it to 21:30Z; no capture time is UNKNOWN');
  check(E.scanSessionDateAt('US', '2026-09-28T19:00:00Z') === '2026-09-25' && E.scanSessionDateAt('US', '2026-09-28T20:31:00Z') === '2026-09-28' && E.scanSessionDateAt('MY', '2026-09-27T12:00:00Z') === '2026-09-25'
    && E.scanSessionDateAt('CRYPTO', '2026-09-27T01:00:00Z') === '2026-09-26' && E.scanSessionDateAt('FX', '2026-09-28T20:59:00Z') === '2026-09-25',
    'scanSessionDateAt: the last session whose close and settle had passed, in the market\'s own zone (US, MY on a Sunday, crypto on a weekend, FX before its 17:00 New York close)');
  const hProv = JSON.parse(JSON.stringify(history));
  hProv.meta = { MATCH: { [lastBar]: { src: 'live', at: `${lastBar}T12:00:00Z` } } };
  const pRun = E.scanRun([setup], hProv, { now: FXN });
  const pb = E.scanBars(hProv, 'MATCH');
  check(pb.status[pb.status.length - 1] === 'PROVISIONAL' && pRun.alerts.length === 0 && pRun.provisional.some(p => p.symbol === 'MATCH' && p.bar === lastBar) && pRun.asOfFrom === dates[dates.length - 2],
    'a provisional bar never confirms: the fixture\'s matching bar captured mid-session records nothing, is named, and the bar before it is evaluated instead', { alerts: pRun.alerts.length, prov: pRun.provisional });
  const nextDay = weekdays(E.scanAddDays(lastBar, 1), 1)[0];
  const hNext = JSON.parse(JSON.stringify(history));
  hNext.series.MATCH[nextDay] = 104; hNext.volume.MATCH[nextDay] = 900;
  hNext.meta = { MATCH: { [nextDay]: { src: 'live', at: `${nextDay}T12:00:00Z` }, [lastBar]: { src: 'capture', at: `${nextDay}T01:00:00Z` } } };
  const nRun = E.scanRun([setup], hNext, { now: `${nextDay}T13:00:00Z` });
  check(nRun.alerts.length === 1 && nRun.alerts[0].candleDate === lastBar && nRun.alerts[0].barStatus === 'FINAL',
    'with a provisional bar after it, the final matching bar is still recorded, marked FINAL', nRun.alerts.map(a => [a.candleDate, a.barStatus]));

  /* --------------------------------------------------------- bar checks -- */
  const vb = E.scanValidateBar;
  const codeCases = [
    [{ date: '2026-1-10', close: 1 }, {}, 'BAD_DATE'], [{ date: 'junk', close: 1 }, {}, 'BAD_DATE'], [{ date: '2026-02-30', close: 1 }, {}, 'BAD_DATE'],
    [{ date: '2026-09-29', close: 1 }, { market: 'US', now: '2026-09-28T12:00:00Z' }, 'FUTURE'], [{ date: '2026-09-28', close: -1 }, {}, 'NEG_PRICE'], [{ date: '2026-09-28', close: 0 }, {}, 'NEG_PRICE'],
    [{ date: '2026-09-28', close: 1, volume: -5 }, {}, 'NEG_VOLUME'], [{ date: '2026-09-28', open: 10, high: 9, low: 8, close: 10 }, {}, 'HIGH_BELOW'],
    [{ date: '2026-09-28', open: 10, high: 12, low: 11, close: 10 }, {}, 'LOW_ABOVE'], [{ date: '2026-09-26', close: 1 }, { market: 'US' }, 'NON_SESSION_DAY'],
    [{ date: '2026-09-27', close: 1 }, { market: 'NZ' }, 'NON_SESSION_DAY'],
  ];
  const codeMiss = codeCases.filter(([b, o, c]) => !vb(b, o).includes(c)).map(x => x[2]);
  check(!codeMiss.length && vb({ date: '2026-09-28', open: 10, high: 12, low: 9, close: 11, volume: 100 }, { market: 'US' }).length === 0
    && vb({ date: '2026-09-28', close: 11, volume: null }, {}).length === 0 && vb({ date: '2026-09-27', close: 1 }, { market: 'CRYPTO' }).length === 0,
    'scanValidateBar: each of BAD_DATE, FUTURE, NEG_PRICE, NEG_VOLUME, HIGH_BELOW, LOW_ABOVE and NON_SESSION_DAY is fired by a minimal bar; a valid OHLC bar, a null volume and a crypto Sunday pass', codeMiss);
  const junkB = E.scanBars({ series: { J: { '2026-01-05': 1, '2026-01-06': 2, '2026-1-10': 3, junk: 4, '2026-01-07': 0 } } }, 'J');
  check(same(junkB.dates, ['2026-01-05', '2026-01-06']) && junkB.invalid.length === 3 && junkB.invalid.find(x => x.date === 'junk').codes[0] === 'BAD_DATE' && junkB.invalid.find(x => x.date === '2026-01-07').codes[0] === 'NEG_PRICE',
    '"junk", "2026-1-10" and a zero close are listed as invalid with their codes, and none becomes the last bar', junkB.invalid);
  const nzB = E.scanBars({ series: { NZ50: { '2026-09-25': 1, '2026-09-27': 2, '2026-09-28': 3 } } }, 'NZ50', { market: 'NZ' });
  check(same(nzB.dates, ['2026-09-25', '2026-09-28']) && nzB.invalid[0].codes.includes('NON_SESSION_DAY'), 'an NZ50-style Sunday bar is NON_SESSION_DAY for market NZ');
  const ohlcH = { series: { X: seriesOf(lds.slice(0, 30), Hl.c.slice(0, 30)) }, ohlc: { X: seriesOf(lds.slice(0, 30), Hl.c.slice(0, 30).map((_, i) => [Hl.o[i], Hl.h[i], Hl.l[i]])) } };
  const withO = E.scanBars(ohlcH, 'X'), withoutO = E.scanBars({ series: ohlcH.series }, 'X');
  check(withO.hasOHLC && !withoutO.hasOHLC && same(withO.closes, withoutO.closes) && same(withO.dates, withoutO.dates) && E.scanIndicator({ indicator: 'atr' }, withO).status === 'VALID',
    'history v2 is read additively: ohlc adds highs and lows (ATR computes) and a close-only history reads the same closes and dates');

  /* ----------------------------------------------------------- calendars -- */
  const myDays = weekdays('2026-08-03', 22).filter(d => d !== '2026-08-31');
  const myInst = Array.from({ length: 6 }, (_, i) => ({ symbol: `M${i}`, market: 'MY' }));
  const myH = { series: Object.fromEntries(myInst.map((x, i) => [x.symbol, seriesOf(myDays.filter(d => !(i === 0 && d === '2026-08-27')), myDays.map((_, j) => 10 + ((j * 7 + i) % 5)))])) };
  const cal = E.scanCalendar(myH, myInst, 'MY');
  const m1 = E.scanBars(myH, 'M1', { market: 'MY', calendar: cal }), m0 = E.scanBars(myH, 'M0', { market: 'MY', calendar: cal });
  const i0901 = m1.dates.indexOf('2026-09-01'), i0828 = m0.dates.indexOf('2026-08-28');
  check(cal.basis === 'inferred' && cal.inferredHolidays.includes('2026-08-31') && m1.gapBefore[i0901] === 0 && /not an exchange calendar/.test(cal.text),
    'six MY series all without 2026-08-31 make it an inferred holiday — labelled inferred, not an exchange calendar — and no gap', { holidays: cal.inferredHolidays });
  check(m0.gapBefore[i0828] === 1 && E.scanIndicator({ indicator: 'sma', n: 3 }, m0, { at: i0828 }).reason?.code === 'MISSING_SESSION'
    && E.scanRule({ left: { indicator: 'price' }, op: 'crosses_above', right: { value: 1 } }, E.scanSliceBars(m0, i0828 + 1)).reason?.code === 'MISSING_SESSION',
    'the same day absent from one of six series is a missing session for that series: its windows and its crossings are unavailable, MISSING_SESSION');
  check(E.scanBars(myH, 'M1', { market: 'MY', calendar: cal, now: '2026-09-01T10:00:00Z' }).stale === null && E.scanExpectedLastSession(cal, 'MY', '2026-09-01T08:00:00Z') === '2026-08-28',
    'a Monday holiday inferred from the calendar is not stale, and is skipped when finding the session expected by now');
  const hole = E.scanBars({ series: { H: { '2026-01-05': 1, '2026-01-20': 3 } } }, 'H');
  const hol = E.scanBars({ series: { H: { '2026-01-16': 1, '2026-01-20': 3 } } }, 'H');
  const crossH = (b) => E.scanRule({ left: { indicator: 'price' }, op: 'crosses_above', right: { value: 2 } }, b);
  check(crossH(hole).reason?.code === 'MISSING_SESSION' && crossH(hol).met === true && hole.calendar.basis === 'weekday',
    'on the weekday calendar a fifteen-day hole is missing sessions (a crossing across it is unavailable), while a one-day gap reads as a possible holiday', { hole: crossH(hole).text });

  /* ----------------------------------------------------------- readiness -- */
  const rd = (now, h = myH) => E.scanReadiness(h, myInst, now).markets.find(m => m.market === 'MY');
  const myP = JSON.parse(JSON.stringify(myH));
  myP.meta = Object.fromEntries(myInst.map(x => [x.symbol, { '2026-09-01': { src: 'live', at: '2026-09-01T08:00:00Z' } }]));
  check(rd('2026-09-01T10:00:00Z').state === 'READY' && rd('2026-09-03T10:00:00Z').state === 'BEHIND' && /2026-09-03/.test(rd('2026-09-03T10:00:00Z').text)
    && rd('2026-09-01T10:00:00Z', myP).state === 'PROVISIONAL' && E.scanReadiness(myH, myInst, null).markets[0].state === 'NO_CLOCK',
    'readiness per market: READY when the expected session is held final, BEHIND with the date when it is not, PROVISIONAL when held only as a provisional bar', [rd('2026-09-03T10:00:00Z').text]);

  const inRun = E.scanRun([{ ...setup, universe: { kind: 'symbols', symbols: ['MATCH'] } }], history, { now: FXN, instruments: [{ symbol: 'MATCH', market: 'US' }, { symbol: 'FLAT', market: 'MY' }] }).readiness.markets;
  check(inRun.find(m => m.market === 'US')?.inRun === true && inRun.find(m => m.market === 'MY')?.inRun === false,
    'a run\'s readiness covers every market held and marks the ones it evaluated, so the page lists only those', inRun.map(m => [m.market, m.inRun, m.state]));

  /* -------------------------------------------------------------- weekly -- */
  const wd = weekdays('2026-01-05', 15).filter(d => d !== '2026-01-16');
  const wcal = { market: null, basis: 'inferred', days: [1, 2, 3, 4, 5], tolerance: 0, sessions: wd, from: '2026-01-05', to: '2026-01-23', inferredHolidays: ['2026-01-16'], ambiguous: [] };
  const wv = wd.map((_, i) => 100 + i);
  const wH = { series: { W: seriesOf(wd, wd.map((_, i) => 10 + i)) }, volume: { W: seriesOf(wd, wv) }, ohlc: { W: seriesOf(wd, wd.map((_, i) => [9.5 + i, 11 + i, 9 + i])) } };
  const w = E.scanBars(wH, 'W', { timeframe: '1W', calendar: wcal });
  check(w.timeframe === '1W' && same(w.dates, ['2026-01-09', '2026-01-15', '2026-01-23']) && same(w.closes, [14, 18, 23]) && same(w.open, [9.5, 14.5, 18.5]) && same(w.high, [15, 19, 24]) && same(w.low, [9, 14, 18])
    && w.volumes[0] === 100 + 101 + 102 + 103 + 104 && w.complete.every(Boolean) && same(w.status, ['UNKNOWN', 'UNKNOWN', 'UNKNOWN']),
    'weekly bars: first open, highest high, lowest low, last close, summed volume; a week whose Friday is an inferred holiday closes on the Thursday', { dates: w.dates, closes: w.closes });
  const wMid = E.scanBars({ series: { W: seriesOf(wd.slice(0, 12), wd.slice(0, 12).map((_, i) => 10 + i)) } }, 'W', { timeframe: '1W', calendar: wcal });
  check(wMid.complete[2] === false && wMid.status[2] === 'PROVISIONAL' && E.scanEvaluate(nest('ALL', C.MET), wMid).reason?.code === 'PROVISIONAL_BAR',
    'a week in progress (Monday to Wednesday held) is incomplete and PROVISIONAL, so it never confirms a match');
  const wGap = JSON.parse(JSON.stringify(wH)); wGap.volume.W['2026-01-07'] = null;
  check(E.scanBars(wGap, 'W', { timeframe: '1W', calendar: wcal }).volumes[0] === null, 'a week with one unrecorded volume has no weekly volume — not a smaller sum');
  const wl = E.scanBars(lh, 'L', { timeframe: '1W' });
  const byWeek = new Map();
  lds.forEach((d, i) => byWeek.set(E.scanAddDays(d, -((E.scanWeekday(d) + 6) % 7)), Hl.c[i]));
  const handWeekly = [...byWeek.values()];
  const wSma = E.scanIndicatorSeries({ indicator: 'sma', n: 4 }, wl).values;
  check(same(wl.closes, handWeekly) && wSma.every((x, i) => near9(x, i < 3 ? null : (handWeekly[i - 3] + handWeekly[i - 2] + handWeekly[i - 1] + handWeekly[i]) / 4)),
    `a weekly SMA4 equals the SMA of the hand-resampled Friday closes (${wl.closes.length} weeks)`);
  const wRun = E.scanRun([{ id: 'wk', timeframe: '1W', ruleTree: nest('ALL', C.MET), cooldownMode: 'EVERY_MATCH' }], history, { now: FXN });
  check(wRun.evaluated === 2 && wRun.alerts.every(a => a.timeframe === '1W' && /\|1W\|/.test(a.key)), 'a 1W setup runs through scanRun and records weekly keys', wRun.alerts.map(a => a.key));

  /* --------------------------------------------------------------- cache -- */
  const cache = E.scanCache();
  const bM = E.scanBars(history, 'MATCH'), bF = E.scanBars(history, 'FLAT');
  [bM, bF, bM, bF].forEach(b => E.scanIndicatorSeries({ indicator: 'ema', n: 50 }, b, { cache }));
  const beforeMiss = cache.stats.misses;
  E.scanIndicatorSeries({ indicator: 'ema', n: 50 }, E.scanBars(hCorr, 'MATCH'), { cache });
  E.scanIndicatorSeries({ indicator: 'volume_avg', n: 20, multiplier: 1.5 }, bM, { cache }); E.scanIndicatorSeries({ indicator: 'volume_avg', n: 20 }, bM, { cache });
  check(beforeMiss === 2 && cache.stats.hits === 3 && cache.stats.misses === 4, 'the cache: ema(50) over two symbols twice is 2 misses and 2 hits; a corrected close is a miss; a multiplier shares the unscaled series', cache.stats);

  /* ---------------------------------------------------- historical testing -- */
  const ht = E.scanHistorical(setup, history);
  const ematch = ht.events.filter(e => e.symbol === 'MATCH');
  check(ht.simulation === true && /no return/.test(ht.note) && ematch.length === 1 && ematch[0].bar === lastBar && ht.matches.at(-1).bar === r1.alerts[0].bar
    && same(ht.matches.at(-1).conditions.map(c => c.left), r1.alerts[0].matchedConditions.map(c => c.left)),
    'scanHistorical is marked simulation; on the fixture it finds one event, on the last bar, whose values are the ones scanRun recorded', { events: ht.events });
  const cr = E.scanHistorical({ id: 'x', rules: [{ left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } }] }, history, { symbols: ['MATCH'] });
  check(cr.coverage[0].testableFrom === dates[50] && cr.coverage[0].unavailable === 50 && cr.coverage[0].evaluated === 66, 'coverage: a crossing of EMA50 is testable from bar index 50, and the fifty bars before are counted unavailable', cr.coverage[0]);
  const ranged = E.scanHistorical(setup, history, { from: dates[10], to: dates[19], symbols: ['MATCH'] });
  check(ranged.coverage[0].from === dates[10] && ranged.coverage[0].to === dates[19] && ranged.coverage[0].evaluated === 10 && E.scanHistorical(setup, history, { maxBars: 5 }).coverage[0].evaluated === 5,
    'from, to and maxBars bound the bars a historical test evaluates');
  check(E.scanHistorical({ ...setup, timeframe: '1H' }, history).skipped.length === 1, 'a historical test of an unbuilt timeframe returns nothing and says why');

  /* --------------------------------------------------- dashboard status -- */
  const SS = E.scanStatus;
  const setupsDoc = { setups: [{ ...setup, id: 'b' }, { ...setup, id: 'a' }] };
  check(SS({}).state === 'never' && /No scan has been recorded/.test(SS({}).reasons[0]), 'scanStatus: no runs and no last run is "never", with the reason');
  const local = SS({ alertsDoc: { alerts: [], lastRun: { at: '2026-09-27T01:07:00Z', asOf: '2026-08-07', engine: 'scan 0.3.0' } }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-09-28T00:00:00Z' });
  check(local.state === 'behind' && local.reasons.some(r => /newest bar is 52 days old/.test(r)) && local.lastSuccess.legacy === true,
    'the local case — a scan run on 27 September on bars of 7 August — is behind, and says the newest bar is 52 days old', local.reasons);
  const cur = SS({ alertsDoc: { alerts: [], lastRun: { at: '2026-08-07T12:00:00Z', asOf: '2026-08-07', engine: 'scan 0.3.0' } }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-08T12:00:00Z' });
  const drift = SS({ alertsDoc: { alerts: [], lastRun: { at: '2026-08-07T12:00:00Z', asOf: '2026-08-07', engine: 'scan 0.1.0' } }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-08T12:00:00Z' });
  const moved = SS({ alertsDoc: { alerts: [], lastRun: { at: '2026-08-06T12:00:00Z', asOf: '2026-08-06', engine: 'scan 0.3.0' } }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-08T12:00:00Z' });
  check(cur.state === 'current' && !cur.reasons.length && drift.state === 'behind' && drift.reasons.some(r => /scan 0\.1\.0/.test(r)) && moved.state === 'behind' && moved.reasons.some(r => /on bars of 2026-08-06; your history's newest bar is 2026-08-07/.test(r)),
    'current when nothing is behind; behind on engine drift, and when the history moved past the scan — each reason naming its dates or versions', [drift.reasons, moved.reasons]);
  const runsOk = [{ id: 'r1', status: 'COMPLETED', startedAt: '2026-08-07T10:00:00Z', finishedAt: '2026-08-07T10:00:05Z', asOf: '2026-08-07', engine: 'scan 0.3.0', setupsHash: E.scanSetupsHash(setupsDoc) }];
  const runsFail = [...runsOk, { id: 'r2', status: 'FAILED', startedAt: '2026-08-08T10:00:00Z', error: { code: 'BAD_ALERTS', message: 'alerts file is not valid JSON' } }];
  const edited = SS({ runs: { runs: runsOk }, setupsDoc: { setups: [{ ...setup, id: 'b', cooldownBars: 9 }, { ...setup, id: 'a' }] }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-08T12:00:00Z' });
  const failed = SS({ runs: { runs: runsFail }, setupsDoc, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-08T12:00:00Z' });
  const paused = SS({ runs: { runs: runsOk }, setupsDoc, control: { paused: true, since: '2026-08-08T09:00:00Z', reason: 'travelling' }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-08T12:00:00Z' });
  check(edited.state === 'behind' && edited.reasons.some(r => /setups changed after the last scan/.test(r)) && failed.state === 'failed' && failed.lastSuccess.id === 'r1' && failed.lastAttempt.id === 'r2'
    && failed.reasons.some(r => /r2.*failed: alerts file is not valid JSON/.test(r)) && paused.state === 'paused' && paused.reasons.some(r => /paused since 2026-08-08: travelling/.test(r)),
    'behind after a setups edit; failed (not current) when a failure follows a success, keeping the success; paused when the control file says so');
  const matchesDoc = { alerts: [{ id: 'x1', setupId: 'a', symbol: 'Z', bar: '2026-08-07' }, { id: 'x2', setupId: 'b', symbol: 'Y', candleDate: '2026-08-07' }, { id: 'x3', setupId: 'a', symbol: 'Z', bar: '2026-08-01' }] };
  const lm = SS({ runs: { runs: runsOk }, alertsDoc: matchesDoc, setupsDoc, historyMeta: { newestBar: '2026-08-07', symbols: ['MATCH', 'FLAT'] }, now: '2026-08-08T12:00:00Z', alertState: { x1: 'READ' } });
  check(same(lm.latestMatches.map(a => a.id), ['x2', 'x1']) && same(lm.recent.map(a => a.id), ['x2', 'x1', 'x3']) && lm.notifications.channel === 'none' && lm.notifications.inApp.unread === 2
    && lm.active.valid === 2 && lm.active.enabled === 2 && lm.monitored.instruments === 2,
    'latest matches come in setup order, not file or close order; recent spans the last bars; notifications say there is no channel, with the unread count', { latest: lm.latestMatches.map(a => a.id) });

  /* --------------------------------------------------------- data health -- */
  const dhDays = weekdays('2026-06-01', 12);
  const dh = E.scanDataHealth({ generated: '2026-06-17T00:00:00Z', series: {
      S1: { ...seriesOf(dhDays.filter(d => d !== '2026-06-04'), dhDays.map(() => 10)), '2026-06-05': 0, 'bad-key': 3 },
      S2: seriesOf(dhDays, dhDays.map((_, i) => (i < 6 ? 20 : 10))),
      U: seriesOf(dhDays, dhDays.map(() => 5)) } },
    [{ symbol: 'S1', market: 'MY' }, { symbol: 'S2', market: 'MY' }], '2026-06-17T12:00:00Z');
  const s1 = dh.series.find(s => s.symbol === 'S1'), s2 = dh.series.find(s => s.symbol === 'S2'), u = dh.series.find(s => s.symbol === 'U');
  check(s1.dropped.nonPositive === 1 && s1.dropped.badDate === 1 && s1.invalid.length === 2 && s1.gaps.some(g => g.after === '2026-06-03' && g.before === '2026-06-08' && g.sessions === 2)
    && s2.jumps.length === 1 && s2.jumps[0].tag === 'split 2-for-1' && u.market === null && dh.markets.some(m => m.market === null && m.label === 'no market row') && dh.markets[0].market === 'MY'
    && dh.file.symbols === 3 && dh.totals.jumps === 1,
    'scanDataHealth: a zero close and a bad key counted as dropped and listed invalid; a gap listed with its sessions; a halving tagged a 2-for-1 split; an unplaced symbol under "no market row"', { s1: s1.gaps, s2: s2.jumps });

  /* --------------------------------------------------------------- drift -- */
  const dr = E.scanSetupDrift([{ ...setup, id: 'a', version: 2, cooldownBars: 9 }, { ...setup, id: 'b' }, { ...setup, id: 'c' }, { ...setup, id: 'gone', deleted: true }],
                              { setups: [{ ...setup, id: 'a' }, { ...setup, id: 'b' }, { ...setup, id: 'd' }] });
  const sd = E.scanSnapshotDrift(['A', 'B'], ['b', 'C']);
  check(dr.differ.length === 1 && dr.differ[0].id === 'a' && dr.differ[0].newer === 'browser' && dr.differ[0].rulesDiffer && same(dr.same, ['b']) && same(dr.onlyInBrowser, ['c']) && same(dr.onlyInFile, ['d']) && !dr.inSync
    && same(sd.added, ['C']) && same(sd.removed, ['A']) && same(sd.kept, ['B']) && !sd.same && E.scanSnapshotDrift(['x'], ['X']).same,
    'scanSetupDrift names setups only in the browser, only in the file, and different (with which is newer); a deleted one is not drift; scanSnapshotDrift names added and removed symbols');

  /* ------------------------------------------------ the 0.2 examples still -- */
  /* Engine 0.2.0's answers on the fixture, recorded when 0.3.0 replaced it
     (matched / untested per setup and instrument, universes widened to all).
     The one intended difference: a flat window's RSI, which 0.2 called 100
     and 0.3 calls undefined (rsi@2) — FLAT's RSI rules move from failed to
     untested; no match changes. */
  const expect02 = { 'trend-breakout': ['MET', 'NOT_MET'], 'sma-50-200-cross': ['UNAVAILABLE', 'UNAVAILABLE'], 'rsi-below-30': ['NOT_MET', 'UNAVAILABLE'], 'watchlist-rsi-recovery': ['MET', 'UNAVAILABLE'] };
  const exNow = exDoc.setups.map(s => [s.id, ['MATCH', 'FLAT'].map(sym => E.scanSetup({ ...s, universe: { kind: 'all' } }, sym, E.scanBars(history, sym)).state)]);
  check(exNow.every(([id, st]) => same(st, expect02[id])), 'every committed 0.2 example normalises and evaluates to engine 0.2.0\'s matches on the fixture (only the flat-RSI rule moves, from failed to untested)', exNow);
  check(st.ok && st.legacy === 0 && st.tree === 1 && st.stale === 0 && st.key === `fixture-breakout|v1|MATCH|1D|${lastBar}|MATCH`,
    'the self-test keeps its guarantee (one alert, none on a second pass) and adds three: none against the 0.2 key, one NEW_MATCH from the tree form, none on a stale clock', st);

  /* --------------------------------------------------------------- trend -- */
  /* The trend context reads the engine now. Its numbers must not move: each
     value is compared, bit for bit, with the implementation it replaced
     (copied here as it stood at 0.2.0), over short, long and gappy series.
     The only change is a label: a 52-week high taken from closes is called
     a closing high. */
  const src60 = await readFile(join(ROOT, 'src/js/60-trend.js'), 'utf8');
  const region = src60.slice(src60.indexOf('const TREND_INDICATORS'), src60.indexOf('/* Real observed history'));
  const T = new Function(`const isNum = (v) => typeof v === 'number' && Number.isFinite(v); ${extractEngine(html)}; ${region}; return { trendContext, volumeContext };`)();
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const OLD = (() => {
    const TREND_BY_ID = { sma20: { needs: 20 }, sma50: { needs: 50 }, sma200: { needs: 200 }, dist50: { needs: 50 }, dist200: { needs: 200 }, cross: { needs: 200 }, hi52: { needs: 252 }, lo52: { needs: 252 }, ddown: { needs: 252 },
                          ret1m: { needs: 23 }, ret3m: { needs: 67 }, ret6m: { needs: 127 }, ret12m: { needs: 253 }, vol: { needs: 30 } };
    const sma = (a, n) => a.length < n ? null : a.slice(-n).reduce((s, v) => s + v, 0) / n;
    const pctChange = (a, n) => (a.length <= n || !(a[a.length - 1 - n] > 0)) ? null : (a[a.length - 1] / a[a.length - 1 - n] - 1) * 100;
    function trendContext(series) {
      const dates = Object.keys(series || {}).sort();
      const closes = dates.map(d => series[d]).filter(v => isNum(v) && v > 0);
      const n = closes.length; const last = n ? closes[n - 1] : null;
      const out = { points: n, first: dates[0] || null, lastDate: dates[dates.length - 1] || null, values: {}, pending: [] };
      const need = (id) => { const req = TREND_BY_ID[id].needs; if (n < req) { out.pending.push({ id, needs: req, have: n, more: req - n }); return true; } return false; };
      const set = (id, v) => { out.values[id] = v; };
      if (!need('sma20')) set('sma20', sma(closes, 20));
      if (!need('sma50')) set('sma50', sma(closes, 50));
      if (!need('sma200')) set('sma200', sma(closes, 200));
      if (!need('dist50')) set('dist50', (last / sma(closes, 50) - 1) * 100);
      if (!need('dist200')) set('dist200', (last / sma(closes, 200) - 1) * 100);
      if (!need('cross')) {
        let found = null;
        for (let i = n - 1; i >= 200; i--) {
          const w = closes.slice(0, i + 1); const a = sma(w, 50), b = sma(w, 200);
          const wp = closes.slice(0, i); const ap = sma(wp, 50), bp = sma(wp, 200);
          if (a == null || b == null || ap == null || bp == null) break;
          if ((a > b) !== (ap > bp)) { found = { date: dates[i], dir: a > b ? 'up' : 'down' }; break; }
        }
        set('cross', found);
      }
      const shortHi = need('hi52'), shortLo = need('lo52'), shortDd = need('ddown');
      if (!shortHi && !shortLo && !shortDd) { const w = closes.slice(-252); set('hi52', Math.max(...w)); set('lo52', Math.min(...w)); set('ddown', (last / Math.max(...w) - 1) * 100); }
      [['ret1m', 22], ['ret3m', 66], ['ret6m', 126], ['ret12m', 252]].forEach(([id, k]) => { if (!need(id)) set(id, pctChange(closes, k)); });
      if (!need('vol')) {
        const w = closes.slice(-30); const rets = w.slice(1).map((v, i) => Math.log(v / w[i])).filter(Number.isFinite);
        const mean = rets.reduce((s, v) => s + v, 0) / rets.length; const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, rets.length - 1);
        set('vol', Math.sqrt(variance) * Math.sqrt(252) * 100);
      }
      out.seams = [];
      for (let i = 1; i < n; i++) { const move = (closes[i] / closes[i - 1] - 1) * 100; const days = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000; if (Math.abs(move) > 15 || (days > 5 && Math.abs(move) > 5)) out.seams.push({ from: dates[i - 1], to: dates[i], movePct: move, gapDays: Math.round(days) }); }
      out.last = last;
      return out;
    }
    function volumeAvgs(volSeries) { const vols = Object.keys(volSeries).sort().map(d => volSeries[d]).filter(v => isNum(v) && v >= 0); const n = vols.length; const avg = (k) => n < k ? null : vols.slice(-k).reduce((s, v) => s + v, 0) / k; return [avg(20), avg(50)]; }
    return { trendContext, volumeAvgs };
  })();
  const trendSeries = [10, 30, 66, 150, 253, 400, 520].map((n, j) => { const L = lcgSeries(n, 1000 + j); return seriesOf(weekdays('2024-01-01', n), L.c); });
  const gappy = { ...trendSeries[5] }; const gk = Object.keys(gappy); gappy[gk[10]] = null; gappy[gk[20]] = 0; gappy[gk[30]] = -3;
  trendSeries.push(gappy);
  const tDiff = [];
  trendSeries.forEach((s, j) => {
    const a = OLD.trendContext(s), b = T.trendContext(s);
    for (const k of ['points', 'first', 'lastDate', 'values', 'pending', 'seams', 'last']) if (!same(a[k], b[k])) tDiff.push(`series ${j}: ${k}`);
  });
  check(!tDiff.length, `trendContext on the engine gives bit-identical values, pendings and seams to the implementation it replaced (${trendSeries.length} series, 10 to 520 closes, one with bad values)`, tDiff);
  const t400 = T.trendContext(trendSeries[5]);
  check(t400.hiBasis === 'close' && t400.labels.hi52 === '52-week closing high' && t400.labels.lo52 === '52-week closing low' && T.trendContext(trendSeries[0]).labels.hi52 === '52-week closing high',
    'without highs and lows held, the 52-week high and low are labelled closing high and closing low');
  const k400 = Object.keys(trendSeries[5]).sort();
  const ohlc400 = Object.fromEntries(k400.map(d => [d, [trendSeries[5][d], trendSeries[5][d] * 1.02, trendSeries[5][d] * 0.98]]));
  const tO = T.trendContext(trendSeries[5], { ohlc: ohlc400 });
  check(tO.hiBasis === 'range' && !tO.labels.hi52 && near9(tO.values.hi52, Math.max(...k400.slice(-252).map(d => ohlc400[d][1]))) && tO.values.sma50 === t400.values.sma50,
    'with highs and lows held for the year, the 52-week high is the high of the range, unlabelled; the averages are unchanged');
  const vS = seriesOf(weekdays('2024-01-01', 80), lcgSeries(80, 3).v);
  const vc = T.volumeContext(vS, trendSeries[3]);
  check(same([vc.avg20, vc.avg50], OLD.volumeAvgs(vS)), 'volumeContext\'s 20- and 50-day average volumes are the engine\'s SMA, bit-identical to before');
  check(!/const sma\b|function sma\b|const pctChange\b|slice\(-\w+\)\.reduce|reduce\(\(s, v\) => s \+ v, 0\) \/ (n|k)\b/.test(src60),
    '60-trend.js defines no moving-average or return arithmetic of its own');

  /* ------------------------------------------------------- a large universe -- */
  const bigH = { series: {}, volume: {} };
  const bigDays = weekdays('2025-01-06', 300);
  for (let s = 0; s < 400; s++) { const L = lcgSeries(300, 5000 + s); bigH.series[`S${s}`] = seriesOf(bigDays, L.c); bigH.volume[`S${s}`] = seriesOf(bigDays, L.v); }
  const t0 = Date.now();
  const bigRun = E.scanRun([{ id: 'big', rules: [{ left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } }, { left: { indicator: 'rsi' }, op: 'between', range: [40, 70] }, { left: { indicator: 'rvol' }, op: 'above', right: { value: 1 } }] }],
    bigH, { now: E.scanReplayNow(bigDays[bigDays.length - 1]) });
  const ms1 = Date.now() - t0;
  check(bigRun.evaluated === 400 && ms1 < 10000, `a large universe: 400 instruments × 300 bars, one three-condition setup, in ${ms1} ms (budget 10 s)`, { evaluated: bigRun.evaluated, ms: ms1 });
}

/* --------------------------------------------------- THE WORKER'S OWN FILES -- */
/* Round 2 (data and worker): the runs log, the lock, pause, replay, retry,
   deliveries, the backtest CLI and the exit codes — each on its own
   temporary folder passed as --data, never the repository's files. */
{
  const { hostname } = await import('node:os');
  const { spawn } = await import('node:child_process');
  const FXT = E.scanFixture();
  const WNOW = FXT.now;
  const SCAN = join(ROOT, 'scanner/scan.mjs');
  const scan = async (...args) => {
    try { const { stdout, stderr } = await run(process.execPath, [SCAN, ...args]); return { code: 0, stdout, stderr }; }
    catch (e) { return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; }
  };
  const folders = [];
  const folder = async (name, { alerts = null } = {}) => {
    const d = join(tmpdir(), `qt-worker-${name}-${process.pid}`);
    await rm(d, { recursive: true, force: true });
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'scan-setups.json'), JSON.stringify({ setups: [FXT.setup] }));
    await writeFile(join(d, 'price-history.json'), JSON.stringify(FXT.history));
    if (alerts != null) await writeFile(join(d, 'scan-alerts.json'), alerts);
    folders.push(d);
    return d;
  };
  const json = async (p) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null);
  const runsOf = async (d) => (await json(join(d, 'scan-runs.json'))) || { runs: [], audit: [] };
  const statusLine = (out) => (out.match(/^status\s+(\S+)\s+\((run-[^)]+)\)/m) || []).slice(1);
  const seenExit = new Map();
  const note = (r) => { const [s] = statusLine(r.stdout); if (s) seenExit.set(s, r.code); };

  /* 1 — a run is logged PENDING → RUNNING → COMPLETED, with its counts and duration; the delivery record follows. */
  const W1 = await folder('runs');
  const r1 = await scan('--data', W1, '--now', WNOW); note(r1);
  const log1 = await runsOf(W1);
  const run1 = log1.runs[0] || {};
  check(r1.code === 0 && log1.schema === 1 && log1.runs.length === 1 && run1.status === 'COMPLETED' && run1.exitCode === 0 && run1.kind === 'scan' && run1.trigger === 'manual'
    && JSON.stringify(run1.transitions.map(t => t.status)) === JSON.stringify(['PENDING', 'RUNNING', 'COMPLETED']) && run1.durationMs >= 0
    && run1.counts?.recorded === 1 && run1.counts?.evaluated === 2 && /^sha256:/.test(run1.historyHash || '') && run1.historyNewest === FXT.lastBar && run1.engine === `scan ${E.SCAN_VERSION}`
    && run1.now === new Date(WNOW).toISOString() && run1.asOf === FXT.lastBar && Array.isArray(run1.readiness) && statusLine(r1.stdout)[1] === run1.id,
    'a run is logged in scan-runs.json: PENDING, RUNNING, then COMPLETED, with its counts, history hash, clock, bars, readiness and duration; the id is printed', run1);
  const del1 = await json(join(W1, 'scan-deliveries.json'));
  const alerts1 = (await json(join(W1, 'scan-alerts.json')))?.alerts || [];
  check(del1?.schema === 1 && del1.channels?.IN_APP?.status === 'ACTIVE' && ['EMAIL', 'TELEGRAM', 'PUSH'].every(c => del1.channels[c]?.status === 'NOT_CONFIGURED' && del1.channels[c].why.length > 40)
    && del1.deliveries.length === 1 && del1.deliveries[0].id === `${alerts1[0]?.id}:IN_APP` && del1.deliveries[0].status === 'SENT' && del1.deliveries[0].channel === 'IN_APP' && del1.deliveries[0].attemptCount === 1
    && del1.deliveries[0].runId === run1.id && run1.counts.deliveries === 1,
    'the delivery record: IN_APP active with one SENT row per new alert; email, Telegram and push NOT_CONFIGURED, each with its reason and no row', del1);
  check(/TELEGRAM/.test(JSON.stringify(del1.channels)) && /SC-315/.test(del1.channels.TELEGRAM.why) && /SC-318/.test(del1.channels.PUSH.why) && /privacy notice/.test(del1.channels.EMAIL.why),
    'the unconfigured channels name what blocks them (a server, a contact address held under a privacy notice) and their items');
  const r2 = await scan('--data', W1, '--now', WNOW); note(r2);
  const r3 = await scan('--data', W1, '--now', WNOW); note(r3);
  const log3 = await runsOf(W1);
  const del3 = await json(join(W1, 'scan-deliveries.json'));
  check(r2.code === 0 && log3.runs[1]?.counts?.recorded === 0 && log3.runs[1]?.counts?.deduped === 1 && del3.deliveries.length === 1,
    'a second run (the record changed, so it evaluates) records nothing new and delivers nothing again');
  check(r3.code === 3 && log3.runs[2]?.status === 'SKIPPED_NO_DATA' && /nothing changed since/.test(log3.runs[2].skipReason || '') && log3.runs[2].comparedWith === log3.runs[1].id
    && (await json(join(W1, 'scan-alerts.json'))).alerts.length === 1,
    'a third run on exactly the same engine, setups, history and record is SKIPPED_NO_DATA (exit 3), saying which run it matches', log3.runs[2]);
  /* The history rewritten (the same bars, other bytes) is new input; --trigger daily names the scheduled run. */
  await writeFile(join(W1, 'price-history.json'), JSON.stringify(FXT.history, null, 1));
  const rd = await scan('--data', W1, '--now', WNOW, '--trigger', 'daily'); note(rd);
  const logd = await runsOf(W1);
  check(rd.code === 0 && logd.runs[3]?.trigger === 'daily' && logd.runs[3].origin === 'daily' && (await scan('--data', W1, '--trigger', 'hourly')).code === 1,
    '--trigger daily is recorded on the run (ingest/daily.mjs passes it); an unknown trigger is refused');

  /* 2 — pause and resume. */
  const p1 = await scan('--data', W1, '--pause', 'holiday week');
  const ctl = await json(join(W1, 'scan-control.json'));
  const pr = await scan('--data', W1, '--now', WNOW); note(pr);
  const st = await scan('--data', W1, '--now', WNOW, '--status', '--json');
  const stj = JSON.parse(st.stdout || '{}');
  const rs = await scan('--data', W1, '--resume');
  const logp = await runsOf(W1);
  check(p1.code === 0 && ctl?.paused === true && ctl.reason === 'holiday week' && pr.code === 3 && logp.runs[4]?.status === 'SKIPPED_PAUSED' && /holiday week/.test(logp.runs[4].skipReason)
    && stj.status?.state === 'paused' && stj.control?.paused === true && rs.code === 0 && (await json(join(W1, 'scan-control.json'))).paused === false,
    '--pause "why" writes scan-control.json; a run while paused is SKIPPED_PAUSED (exit 3); --status says paused; --resume clears it', { ctl, state: stj.status?.state });
  check(logp.audit.filter(a => a.action === 'pause' && a.reason === 'holiday week').length === 1 && logp.audit.some(a => a.action === 'resume') && logp.audit.every(a => a.at && 'operator' in a && a.host),
    'pause and resume are audited with the time, the account and the machine', logp.audit);

  /* 3 — replay: the same alerts as a run on the cut history, deduplicated, audited. */
  const W2 = await folder('replay');
  const rp1 = await scan('--data', W2, '--as-of', FXT.lastBar); note(rp1);
  const aRep = (await json(join(W2, 'scan-alerts.json')))?.alerts || [];
  const direct = E.scanRun([FXT.setup], E.scanTruncateHistory(FXT.history, FXT.lastBar), { now: E.scanReplayNow(FXT.lastBar) });
  check(rp1.code === 0 && aRep.length === direct.alerts.length && aRep.length === 1 && aRep[0].key === direct.alerts[0].key && aRep[0].origin === 'replay',
    '--as-of DATE records exactly the alerts a run on the history cut at DATE records, marked origin replay', { got: aRep.map(a => a.key), want: direct.alerts.map(a => a.key) });
  const rp2 = await scan('--data', W2, '--as-of', FXT.lastBar); note(rp2);
  const logr = await runsOf(W2);
  const reps = logr.audit.filter(a => a.action === 'replay');
  check(rp2.code === 0 && (await json(join(W2, 'scan-alerts.json'))).alerts.length === 1 && reps.length === 2 && reps[0].added === 1 && reps[1].added === 0 && reps[1].deduped === 1
    && reps.every(a => a.asOf === FXT.lastBar && a.runId && a.status === 'COMPLETED') && logr.runs.every(r => r.trigger === 'replay' && r.replayAsOf === FXT.lastBar),
    'replaying the same date again adds nothing (never skipped: it was asked for); each replay is one audit entry with what it added', reps);
  const rp3 = await scan('--data', W2, '--as-of', '2025-01-02'); note(rp3);
  const rp3run = (await runsOf(W2)).runs.pop();
  const rp4 = await scan('--data', W2, '--as-of', '2099-01-02');
  check(rp3.code === 3 && rp3run.status === 'SKIPPED_NO_DATA' && /on or before 2025-01-02/.test(rp3run.skipReason) && rp4.code === 1 && /not a past date/.test(rp4.stderr),
    'a replay before the history\'s first bar is SKIPPED_NO_DATA; a replay of a future date fails as an argument error');
  const del2 = await json(join(W2, 'scan-deliveries.json'));
  check(del2.deliveries.length === 1, 'a replay writes IN_APP rows only for alerts it added — nothing is resent');

  /* 4 — retry: a failed run re-run on its own session dates, audited. */
  const W3 = await folder('retry', { alerts: '{not json' });
  const f1 = await scan('--data', W3, '--now', WNOW); note(f1);
  const failed = (await runsOf(W3)).runs[0] || {};
  check(f1.code === 1 && failed.status === 'FAILED' && failed.error?.category === 'IO' && /^run-.+\/e1$/.test(failed.error.correlationId) && f1.stderr.includes(failed.error.correlationId)
    && (await readFile(join(W3, 'scan-alerts.json'), 'utf8')) === '{not json' && failed.historyNewest === FXT.lastBar,
    'an unreadable record fails the run (exit 1): FAILED with category IO and a correlation id printed beside the message; the record is untouched', failed);
  await rm(join(W3, 'scan-alerts.json'));
  /* The history moves on after the failure; the retry must use the failed run's cut, not today's file. */
  const later = JSON.parse(JSON.stringify(FXT.history));
  for (const sym of Object.keys(later.series)) { later.series[sym]['2026-04-07'] = 1; if (later.volume?.[sym]) later.volume[sym]['2026-04-07'] = 1; }
  await writeFile(join(W3, 'price-history.json'), JSON.stringify(later));
  const t1 = await scan('--data', W3, '--retry', failed.id); note(t1);
  const logt = await runsOf(W3);
  const retried = logt.runs[1] || {};
  const aRet = (await json(join(W3, 'scan-alerts.json')))?.alerts || [];
  check(t1.code === 0 && retried.status === 'COMPLETED' && retried.retryOf === failed.id && retried.trigger === 'retry' && retried.now === failed.now && aRet.length === 1 && aRet[0].candleDate === FXT.lastBar
    && logt.audit.some(a => a.action === 'retry' && a.retryOf === failed.id && a.added === 1),
    '--retry RUNID re-runs the failed scan on its own session dates — the history cut where it was and its clock — and is audited', { retried, alerts: aRet.map(a => a.candleDate) });
  const t2 = await scan('--data', W3, '--retry', retried.id);
  const t3 = await scan('--data', W3, '--retry', 'run-nope');
  check(t2.code === 0 && (await json(join(W3, 'scan-alerts.json'))).alerts.length === 1 && t3.code === 1 && /no run run-nope/.test(t3.stderr) && (await runsOf(W3)).runs.pop().error?.category === 'ARGS',
    'a retry of a completed run adds nothing; a retry of an unknown run fails, logged as an argument error');

  /* 5 — the lock: two workers at once. */
  const W4 = await folder('lock');
  const spawnScan = (...args) => new Promise((resolve_) => {
    const c = spawn(process.execPath, [SCAN, ...args]);
    let stdout = '', stderr = '';
    c.stdout.on('data', d => { stdout += d; }); c.stderr.on('data', d => { stderr += d; });
    c.on('close', (code) => resolve_({ code, stdout, stderr }));
  });
  const A = spawnScan('--data', W4, '--now', WNOW, '--hold', '2500');
  const lockPath = join(W4, 'scan.lock');
  /* The lock is taken, then the run is written PENDING: wait for both. */
  let midRuns = { runs: [] };
  for (let i = 0; i < 200 && !(existsSync(lockPath) && midRuns.runs.length); i++) {
    await new Promise(r => setTimeout(r, 25));
    try { midRuns = await runsOf(W4); } catch { /* caught mid-rename */ }
  }
  const B = await spawnScan('--data', W4, '--now', WNOW); note(B);
  const Ares = await A; note(Ares);
  const logl = await runsOf(W4);
  const skippedL = logl.runs.find(r => r.status === 'SKIPPED_LOCKED');
  check(midRuns.runs[0]?.status === 'PENDING' && Ares.code === 0 && B.code === 3 && skippedL && skippedL.error?.category === 'LOCK' && /pid \d+/.test(skippedL.skipReason)
    && logl.runs.some(r => r.status === 'COMPLETED') && logl.runs.length === 2 && !existsSync(lockPath) && (await json(join(W4, 'scan-alerts.json'))).alerts.length === 1,
    'two workers at once: one holds the lock (PENDING while it does) and completes; the other is SKIPPED_LOCKED (exit 3) naming the holder; both are logged, one alert, the lock released',
    { a: Ares.code, b: B.code, runs: logl.runs.map(r => r.status) });
  const W5 = await folder('race');
  const both = await Promise.all([spawnScan('--data', W5, '--now', WNOW), spawnScan('--data', W5, '--now', WNOW)]);
  const logR = await runsOf(W5);
  const aR = (await json(join(W5, 'scan-alerts.json')))?.alerts || [];
  check(aR.length === 1 && logR.runs.length === 2 && !logR.runs.some(r => r.status === 'FAILED') && both.every(x => [0, 3].includes(x.code)) && !existsSync(join(W5, 'scan.lock')),
    'two workers started in the same instant: the record holds the one alert once — nothing duplicated, nothing lost — and both runs are logged', { codes: both.map(x => x.code), runs: logR.runs.map(r => r.status) });

  /* 6 — a lock left behind: dead, hour-old, or live. */
  const W6 = await folder('stale');
  let deadPid = 999999; while (deadPid > 1000) { try { process.kill(deadPid, 0); deadPid--; } catch (e) { if (e.code === 'ESRCH') break; deadPid--; } }
  await writeFile(join(W6, 'scan.lock'), JSON.stringify({ pid: deadPid, host: hostname(), startedAt: new Date().toISOString(), runId: 'run-orphan', token: 'x' }));
  await writeFile(join(W6, 'scan-runs.json'), JSON.stringify({ schema: 1, runs: [{ id: 'run-orphan', kind: 'scan', status: 'RUNNING', startedAt: new Date(Date.now() - 60000).toISOString(), errors: [], transitions: [] }], audit: [] }));
  const s1 = await scan('--data', W6, '--now', WNOW); note(s1);
  const logs = await runsOf(W6);
  const orphan = logs.runs.find(r => r.id === 'run-orphan');
  const taker = logs.runs.find(r => r.id !== 'run-orphan');
  check(s1.code === 0 && taker?.lockTakeover?.why === 'dead' && orphan.status === 'FAILED' && orphan.error?.category === 'ABANDONED' && logs.audit.some(a => a.action === 'lock-takeover' && a.why === 'dead' && a.closedRun === 'run-orphan'),
    'a lock whose process is dead is taken over and the takeover audited; the run it belonged to is closed FAILED/ABANDONED', { taker: taker?.lockTakeover, orphan: orphan?.error });
  await writeFile(join(W6, 'scan.lock'), JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date(Date.now() - 2 * 3600000).toISOString(), runId: 'run-old', token: 'y' }));
  await writeFile(join(W6, 'price-history.json'), JSON.stringify(FXT.history, null, 2));
  const s2 = await scan('--data', W6, '--now', WNOW); note(s2);
  check(s2.code === 0 && (await runsOf(W6)).audit.some(a => a.action === 'lock-takeover' && a.why === 'stale'), 'a lock over an hour old is taken over as stale even while its pid answers (Windows reuses pids)');
  await writeFile(join(W6, 'scan.lock'), JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString(), runId: 'run-live', token: 'z' }));
  const s3 = await scan('--data', W6, '--now', WNOW); note(s3);
  const u1 = await scan('--data', W6, '--unlock');
  const u2 = await scan('--data', W6, '--unlock', '--force');
  check(s3.code === 3 && u1.code === 1 && /live process/.test(u1.stderr) && existsSync(join(W6, 'scan.lock')) === false && u2.code === 0
    && (await runsOf(W6)).audit.some(a => a.action === 'unlock' && a.forced === true && a.previous?.runId === 'run-live'),
    'a fresh lock held by a live process turns a run away; --unlock refuses it, --unlock --force removes it, audited');

  /* 7 — the delivery record fails; the alerts do not. */
  const W7 = await folder('delivery');
  await mkdir(join(W7, 'scan-deliveries.json'));                      /* a directory where the file should be */
  const dv = await scan('--data', W7, '--now', WNOW); note(dv);
  const runD = (await runsOf(W7)).runs[0] || {};
  check(dv.code === 2 && runD.status === 'PARTIAL' && runD.errors.some(e => e.category === 'DELIVERY') && (await json(join(W7, 'scan-alerts.json'))).alerts.length === 1 && /DELIVERY RECORD NOT WRITTEN/.test(dv.stdout),
    'a delivery record that cannot be written leaves the alert recorded and the run PARTIAL (exit 2) with a DELIVERY error', runD.errors);

  /* 8 — the engine missing is logged too; the log is capped. */
  const W8 = await folder('engine');
  const ef = await scan('--data', W8, '--html', join(W8, 'no-index.html')); note(ef);
  const runE = (await runsOf(W8)).runs[0] || {};
  check(ef.code === 1 && runE.status === 'FAILED' && runE.error?.category === 'ENGINE' && runE.engine === null, 'a run that cannot load the engine exits 1 and is still logged, FAILED with category ENGINE');
  await writeFile(join(W8, 'scan-runs.json'), JSON.stringify({ schema: 1, runs: Array.from({ length: 505 }, (_, i) => ({ id: `old-${i}`, kind: 'scan', status: 'COMPLETED', startedAt: '2026-01-01T00:00:00Z' })), audit: [] }));
  const cp = await scan('--data', W8, '--now', WNOW);
  const logc = await runsOf(W8);
  check(cp.code === 0 && logc.runs.length === 500 && logc.runs[499].status === 'COMPLETED' && logc.runs[499].id.startsWith('run-') && logc.runs[0].id === 'old-6' && existsSync(join(W8, 'scan-runs.json.bak')),
    'the runs log keeps its newest 500 runs and is written atomically, with a .bak');

  /* 9 — the read-only commands. */
  const rn = await scan('--data', W1, '--runs', '2', '--json');
  const rnj = JSON.parse(rn.stdout || '{}');
  const rt = await scan('--data', W1, '--runs', '3');
  const sj = await scan('--data', W1, '--now', WNOW, '--status');
  check(rn.code === 0 && rnj.runs?.length === 2 && rt.code === 0 && /SKIPPED_PAUSED/.test(rt.stdout) && sj.code === 0 && /^scanner\s+\S+/m.test(sj.stdout) && /NOT CONFIGURED/.test(sj.stdout) && /intraday/.test(sj.stdout),
    '--runs [n] lists the newest runs (and --json gives them whole); --status prints the dashboard\'s answers, the channels and that intraday is not built');
  const bt = await scan('--data', W1, '--backtest', FXT.setup.id, '--json');
  const btj = JSON.parse(bt.stdout || '{}');
  const want = E.scanHistorical(E.scanValidate({ setups: [FXT.setup] }).setups[0], FXT.history, {});
  check(bt.code === 0 && btj.simulation === true && JSON.stringify(btj.recorded) === JSON.stringify(want.recorded) && btj.recorded.some(x => x.bar === FXT.lastBar && x.symbol === 'MATCH'),
    '--backtest SETUPID --json is scanHistorical on the worker\'s files: marked a simulation, the same recorded bars', { got: btj.recorded, want: want.recorded });
  const bt2 = await scan('--data', W1, '--backtest', FXT.setup.id, '--to', E.scanAddDays(FXT.lastBar, -1), '--json');
  const bt3 = await scan('--data', W1, '--backtest', FXT.setup.id);
  const bt4 = await scan('--data', W1, '--backtest', 'nope');
  const bt5 = await scan('--data', W1, '--backtest', FXT.setup.id, '--from', '1/2/2026');
  check(bt2.code === 0 && !JSON.parse(bt2.stdout).recorded.some(x => x.bar === FXT.lastBar) && bt3.code === 0 && /a simulation, not a backtest of returns/.test(bt3.stdout) && /no entries, exits, costs/.test(bt3.stdout)
    && bt4.code === 1 && /no setup "nope"/.test(bt4.stderr) && bt5.code === 1 && (await runsOf(W1)).runs.every(r => r.kind === 'scan'),
    '--to bounds the window; the printout says it is a simulation with no returns; an unknown setup or a bad date exits 1; a backtest writes no run');

  /* 10 — the exit codes, as each status was actually reached above. */
  const want0123 = { COMPLETED: 0, FAILED: 1, PARTIAL: 2, SKIPPED_NO_DATA: 3, SKIPPED_PAUSED: 3, SKIPPED_LOCKED: 3 };
  const bad = Object.entries(want0123).filter(([s, c]) => seenExit.get(s) !== c);
  check(!bad.length, 'exit codes: 0 COMPLETED, 1 FAILED, 2 PARTIAL, 3 SKIPPED (no data, paused, locked) — each reached above by a real run', Object.fromEntries(seenExit));

  /* 11 — ingest/daily.mjs, with every step stubbed in a temporary folder. */
  const D = join(tmpdir(), `qt-daily-${process.pid}`);
  await rm(D, { recursive: true, force: true });
  await mkdir(join(D, 'ingest'), { recursive: true }); await mkdir(join(D, 'scanner'), { recursive: true }); await mkdir(join(D, 'data'), { recursive: true });
  folders.push(D);
  await writeFile(join(D, 'ingest/autoshot.mjs'), "console.log('page 1');");
  await writeFile(join(D, 'ingest/watchlist.mjs'), "console.log('candidates 3\\nflagged   0\\nskipped   0');");
  await writeFile(join(D, 'ingest/prices.mjs'), "console.log('  accepted : 3\\n  rejected : 0');");
  await writeFile(join(D, 'ingest/history.mjs'), "const c = Number(process.env.STUB_HISTORY_EXIT || 0); console.log('  symbols   : 3\\n  new bars  : 3\\n  depth     : 1-3 day(s) per symbol'); process.exit(c);");
  await writeFile(join(D, 'scanner/scan.mjs'), "import { writeFileSync } from 'node:fs'; writeFileSync('scan-called.json', JSON.stringify(process.argv.slice(2))); console.log('0 new alerts recorded'); console.log('status     ' + (process.env.STUB_SCAN_STATUS || 'COMPLETED') + ' (run-stub-1)'); process.exit(Number(process.env.STUB_SCAN_EXIT || 0));");
  await writeFile(join(D, 'data/scan-setups.json'), '{"setups":[]}');
  const daily = async (env) => {
    await rm(join(D, 'scan-called.json'), { force: true });
    try { const { stdout } = await run(process.execPath, [join(ROOT, 'ingest/daily.mjs'), '--url', 'http://example.invalid', '--no-fx'], { cwd: D, env: { ...process.env, ...env } }); return { code: 0, stdout }; }
    catch (e) { return { code: e.code, stdout: e.stdout || '' }; }
  };
  const lastIngest = async () => ((await json(join(D, 'data/ingest-runs.json')))?.runs || []).slice(-1)[0] || {};
  const dA = await daily({ STUB_HISTORY_EXIT: '1' });
  const iA = await lastIngest();
  check(dA.code === 2 && !existsSync(join(D, 'scan-called.json')) && /scanner\s+skipped — the history was not updated/.test(dA.stdout)
    && iA.steps?.find(s => s.step === 'history')?.status === 'failed' && iA.steps?.find(s => s.step === 'scanner')?.status === 'skipped' && iA.status === 'PARTIAL' && iA.kind === 'ingest',
    'daily.mjs never starts the scanner when the history step failed, says so, and logs the run in data/ingest-runs.json', { code: dA.code, steps: iA.steps });
  const dB = await daily({ STUB_SCAN_EXIT: '3', STUB_SCAN_STATUS: 'SKIPPED_PAUSED' });
  const iB = await lastIngest();
  const argvB = await json(join(D, 'scan-called.json'));
  check(dB.code === 0 && JSON.stringify(argvB) === JSON.stringify(['--trigger', 'daily', '--ready']) && /scanner\s+skipped — paused/.test(dB.stdout) && iB.scanner?.status === 'SKIPPED_PAUSED' && iB.scanner.runId === 'run-stub-1' && iB.scanner.exit === 3 && iB.status === 'COMPLETED',
    'the scanner is started with --trigger daily --ready; a paused scanner (exit 3) is reported and is not a failure of the daily run', { code: dB.code, argv: argvB, scanner: iB.scanner });
  const dC = await daily({ STUB_SCAN_EXIT: '3', STUB_SCAN_STATUS: 'SKIPPED_LOCKED' });
  const dD = await daily({ STUB_SCAN_EXIT: '2', STUB_SCAN_STATUS: 'PARTIAL' });
  const dE = await daily({ STUB_HISTORY_EXIT: '2' });
  const runsI = (await json(join(D, 'data/ingest-runs.json'))).runs;
  check(dC.code === 2 && dD.code === 2 && /a setup was skipped/.test(dD.stdout) && dE.code === 2 && existsSync(join(D, 'scan-called.json')) && /some rows were refused/.test(dE.stdout) && runsI.length === 5
    && runsI.every(r => r.startedAt && r.finishedAt && r.durationMs >= 0 && Array.isArray(r.steps)),
    'a scan turned away by the lock, or partial, makes the daily run exit 2; a history written with rows refused still scans (and exits 2 so the rows are looked at); every daily run is logged', { codes: [dC.code, dD.code, dE.code] });

  for (const d of folders) await rm(d, { recursive: true, force: true });
}

/* The two data files are personal and git-ignored; CI also checks this, but a
   local run should say so before a push does. */
try {
  const { stdout: tracked } = await run('git', ['ls-files'], { cwd: ROOT });
  check(!/^data\/scan-(setups|alerts)\.json$/m.test(tracked), 'neither scanner data file is tracked by git');
  check(!/^data\/(scan-(runs|control|deliveries)\.json|scan\.lock|ingest-runs\.json|price-history(\.rejects)?\.json)/m.test(tracked),
    'none of the worker\'s or the ingest\'s own files (runs, lock, control, deliveries, ingest runs, history, rejects) is tracked by git');
  const ignore = await readFile(join(ROOT, '.gitignore'), 'utf8');
  const ci = await readFile(join(ROOT, '.github/workflows/checks.yml'), 'utf8');
  const newFiles = ['data/scan-runs.json', 'data/scan.lock', 'data/scan-control.json', 'data/scan-deliveries.json', 'data/ingest-runs.json', 'data/price-history.rejects.json'];
  check(newFiles.every(f => ignore.split(/\r?\n/).includes(f) && ci.includes(`'${f}'`)), 'every new data file is git-ignored AND in CI\'s "no licensed data" list', newFiles.filter(f => !ignore.includes(f) || !ci.includes(`'${f}'`)));
} catch { ok('git is not available here — the tracked-files check runs in CI'); }

/* ---- round 3: worker ---- */
/* Round 3 (worker): the version ledger (SC-306), catch-up (SC-307 item 3),
   narrowed replay (SC-307 item 4), the ready gate (SC-301 item 4), watchlists
   resolved from the export (SC-311), the alert record's volume, history
   stamp and gap (SC-310, SC-305), the run's new fields (C4), the order of
   evaluation under permuted values (SC-316, SC-319) and the 2,000 × 500
   budget. Engine checks first, then the worker on temporary folders. */
{
  const FX3 = E.scanFixture();
  const SCAN = join(ROOT, 'scanner/scan.mjs');
  const scan = async (...args) => {
    try { const { stdout, stderr } = await run(process.execPath, [SCAN, ...args]); return { code: 0, stdout, stderr }; }
    catch (e) { return { code: e.code, stdout: e.stdout || '', stderr: e.stderr || '' }; }
  };
  const json = async (p) => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) : null);
  const folders = [];
  const folder = async (name, { setups, history, instruments = null, watchlists = null } = {}) => {
    const d = join(tmpdir(), `qt-r3w-${name}-${process.pid}`);
    await rm(d, { recursive: true, force: true });
    await mkdir(d, { recursive: true });
    await writeFile(join(d, 'scan-setups.json'), JSON.stringify({ setups }));
    await writeFile(join(d, 'price-history.json'), JSON.stringify(history));
    if (instruments) await writeFile(join(d, 'instruments.json'), JSON.stringify(instruments));
    if (watchlists) await writeFile(join(d, 'watchlists.json'), JSON.stringify(watchlists));
    folders.push(d);
    return d;
  };
  const runsOf = async (d) => (await json(join(d, 'scan-runs.json'))) || { runs: [], audit: [] };
  const lastRunOf = async (d) => (await runsOf(d)).runs.slice(-1)[0] || {};
  const alertsOf = async (d) => (await json(join(d, 'scan-alerts.json')))?.alerts || [];
  const ledgerOf = async (d) => (await json(join(d, 'scan-ledger.json'))) || { versions: [], pairs: {} };

  /* ------------------------------------------- SC-310: the alert's bar -- */
  const stamped = { ...FX3.history, generated: '2026-04-06T11:00:00.000Z' };
  const aV = E.scanRun([FX3.setup], stamped, { now: FX3.now }).alerts[0] || {};
  const pxAll = { id: 'px', rules: [{ left: { indicator: 'price' }, op: 'above', right: { value: 0.01 } }], universe: { kind: 'symbols', symbols: ['MATCH'] } };
  const noVol = JSON.parse(JSON.stringify(FX3.history));
  delete noVol.volume.MATCH[FX3.lastBar];
  const aN = E.scanRun([pxAll], noVol, { now: FX3.now }).alerts[0] || {};
  check(aV.barVolume === 2200 && aV.historyGenerated === '2026-04-06T11:00:00.000Z' && 'barVolume' in aN && aN.barVolume === null && aN.historyGenerated === null,
    'SC-310 alert record: barVolume is the volume held for the bar (2,200 on the fixture) and null — not 0 — where none is held; historyGenerated is the history file\'s generated stamp, null when it has none',
    { v: aV.barVolume, g: aV.historyGenerated, nv: aN.barVolume, ng: aN.historyGenerated });

  /* ---------------------- SC-301 / SC-312: a run that evaluated nothing -- */
  const okRun = { id: 'r-ok', status: 'COMPLETED', startedAt: '2026-08-06T10:00:00Z', finishedAt: '2026-08-06T10:00:02Z', asOf: '2026-08-06', engine: `scan ${E.SCAN_VERSION}`, counts: { evaluated: 3 } };
  const heldRun = { id: 'r-held', status: 'PARTIAL', startedAt: '2026-08-07T10:00:00Z', finishedAt: '2026-08-07T10:00:01Z', asOf: null, engine: `scan ${E.SCAN_VERSION}`, counts: { evaluated: 0 },
                    skippedMarkets: [{ market: 'MY', reason: 'MY (Bursa Malaysia): the session of 2026-08-07 is held only as a provisional bar, captured before the close and settle', status: 'SKIPPED_NO_DATA' }] };
  const stHeld = E.scanStatus({ runs: { runs: [okRun, heldRun] }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-07T12:00:00Z' });
  const stOnly = E.scanStatus({ runs: { runs: [heldRun] }, historyMeta: { newestBar: '2026-08-07' }, now: '2026-08-07T12:00:00Z' });
  check(stHeld.lastSuccess?.id === 'r-ok' && stHeld.lastAttempt?.id === 'r-held' && stHeld.state === 'behind' && stHeld.reasons.some(r => /r-held.*evaluated no bar: every market it would have scanned was held back as not ready — MY/.test(r))
    && stOnly.lastSuccess === null && stOnly.state === 'behind' && stOnly.state !== 'current',
    'SC-301 a run the ready gate held back entirely (PARTIAL, no bar evaluated) is the latest attempt but not the last success — the dashboard is behind and says which markets were not ready, never "succeeded today on bars of no bar"',
    { held: [stHeld.state, stHeld.reasons], only: [stOnly.state, stOnly.reasons] });

  /* --------------------------------------- SC-305: a NEW_MATCH across a gap -- */
  const gDays = weekdays('2026-03-02', 10);
  const gapDay = gDays[8];
  const gapH = { series: { GAPPY: seriesOf(gDays.filter(d => d !== gapDay), [99, 99, 99, 99, 99, 99, 99, 99, 101]) }, volume: {} };
  const fullH = { series: { GAPPY: seriesOf(gDays, [99, 99, 99, 99, 99, 99, 99, 99, 99, 101]) }, volume: {} };
  const above100 = { id: 'above-100', version: 1, timeframe: '1D', cooldownMode: 'NEW_MATCH', universe: { kind: 'all' },
                     ruleTree: { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 100 } }] } };
  const gA = E.scanRun([above100], gapH, { now: E.scanReplayNow(gDays[9]) }).alerts[0] || {};
  const gB = E.scanRun([above100], fullH, { now: E.scanReplayNow(gDays[9]) }).alerts[0] || {};
  check(gA.eventType === 'NEW_MATCH' && gA.gapBefore === true && gA.gapText.includes(gapDay) && /across a gap/.test(gA.gapText) && /not shown on consecutive sessions/.test(gA.gapText)
    && /no exchange calendar is held/.test(gA.gapText) && gB.eventType === 'NEW_MATCH' && !('gapBefore' in gB) && !('gapText' in gB),
    'SC-305 a NEW_MATCH whose bar before is separated by a missing session carries gapBefore: true and a gapText naming the session and the calendar; with no session missing neither field is present (absent, never false)',
    { a: [gA.eventType, gA.gapBefore, gA.gapText], b: [gB.eventType, 'gapBefore' in gB] });
  const gH = E.scanHistorical(E.scanValidate({ setups: [above100] }).setups[0], gapH, {});
  check(gH.events.some(e => e.bar === gDays[9] && e.gapBefore === true && e.gapText.includes(gapDay)),
    'SC-305 historical testing marks the same event across a gap', gH.events);

  /* --------------------------------- SC-311: watchlists from the export -- */
  const wlUni = (extra = {}) => ({ kind: 'watchlist', watchlistId: 'wl-a', name: 'A', symbols: ['MATCH', 'FLAT'], asOf: '2026-03-01', ...extra });
  const wlExport = (lists) => ({ kind: 'quantum-tradeworks-watchlists', schema: 2, exportedAt: '2026-04-06T09:00:00.000Z', owner: 'this browser — there are no accounts, so no ownerId', watchlists: lists });
  const exportA = wlExport([{ id: 'wl-a', name: 'A', items: [{ id: 'wl-a:c1', watchlistId: 'wl-a', companyId: 'c1', instrumentId: 'US:MATCH', symbol: 'MATCH', market: 'US' },
                                                              { id: 'wl-a:c2', watchlistId: 'wl-a', companyId: 'c2', instrumentId: null, symbol: null, market: null }] }]);
  const exSetup = { ...FX3.setup, id: 'wl-export', universe: wlUni({ resolve: 'export' }) };
  const wx = E.scanRun([exSetup], FX3.history, { now: FX3.now, watchlists: exportA });
  const wxA = wx.alerts[0] || {};
  check(wx.evaluated === 1 && wx.alerts.length === 1 && wxA.symbol === 'MATCH' && same(wxA.universeResolvedFrom, { source: 'export', exportedAt: '2026-04-06T09:00:00.000Z' })
    && same(wx.universeResolvedFrom, [{ setupId: 'wl-export', watchlistId: 'wl-a', source: 'export', exportedAt: '2026-04-06T09:00:00.000Z' }]) && !wx.watchlistFallbacks.length
    && wx.skipped.some(s => s.symbol === 'c2' && /watchlist export with no symbol/.test(s.why)),
    'SC-311 resolve "export" scans the export\'s members, not the snapshot: FLAT, removed from the list since the snapshot, is not scanned; the member with no symbol is named; the alert and the run record universeResolvedFrom with the export\'s time',
    { evaluated: wx.evaluated, from: wxA.universeResolvedFrom, skipped: wx.skipped });
  const wnone = E.scanRun([exSetup], FX3.history, { now: FX3.now });
  const wmiss = E.scanRun([exSetup], FX3.history, { now: FX3.now, watchlists: wlExport([{ id: 'wl-b', name: 'B', items: [] }]) });
  check(wnone.evaluated === 2 && wnone.watchlistFallbacks.length === 1 && /there is no data\/watchlists\.json/.test(wnone.watchlistFallbacks[0].why) && /snapshot of 2026-03-01/.test(wnone.watchlistFallbacks[0].why)
    && same(wnone.alerts[0]?.universeResolvedFrom, { source: 'snapshot', asOf: '2026-03-01' })
    && wmiss.evaluated === 2 && /watchlist wl-a is not in data\/watchlists\.json \(exported 2026-04-06T09:00:00\.000Z\) — evaluated its snapshot of 2026-03-01/.test(wmiss.watchlistFallbacks[0]?.why || ''),
    'SC-311 with no export, or an export without the list, the run falls back to the snapshot, says which and why, and the alert says it read the snapshot',
    { none: wnone.watchlistFallbacks, miss: wmiss.watchlistFallbacks });
  const snapRun = E.scanRun([{ ...FX3.setup, id: 'wl-snap', universe: wlUni() }], FX3.history, { now: FX3.now, watchlists: exportA });
  check(snapRun.evaluated === 2 && !snapRun.watchlistFallbacks.length && same(snapRun.alerts[0]?.universeResolvedFrom, { source: 'snapshot', asOf: '2026-03-01' })
    && !('universeResolvedFrom' in (E.scanRun([FX3.setup], FX3.history, { now: FX3.now }).alerts[0] || {})),
    'SC-311 a watchlist setup without resolve (or resolve "snapshot") reads its snapshot even when an export exists, and says so; a setup on any other universe carries no universeResolvedFrom');
  const vwl = E.scanValidate({ setups: [
    { ...FX3.setup, id: 'r-live', universe: wlUni({ resolve: 'live' }) },
    { ...FX3.setup, id: 'r-noid', universe: { ...wlUni({ resolve: 'export' }), watchlistId: undefined } },
    { ...FX3.setup, id: 'r-nosnap', universe: { ...wlUni({ resolve: 'export' }), symbols: [] } },
    { ...FX3.setup, id: 'r-ok', universe: wlUni({ resolve: 'export' }) }] });
  const hSnap = E.scanNormaliseSetup({ ...FX3.setup, universe: wlUni() }).hash;
  check(vwl.setups.map(s => s.id).join() === 'r-ok' && /resolve "live" is not snapshot or export/.test(vwl.problems.join('\n')) && /names no watchlistId/.test(vwl.problems.join('\n'))
    && /no symbol snapshot to fall back on/.test(vwl.problems.join('\n'))
    && hSnap === E.scanNormaliseSetup({ ...FX3.setup, universe: wlUni({ resolve: 'snapshot' }) }).hash && hSnap !== E.scanNormaliseSetup({ ...FX3.setup, universe: wlUni({ resolve: 'export' }) }).hash
    && E.scanNormaliseSetup({ ...FX3.setup, universe: wlUni({ resolve: 'export' }) }).hash !== E.scanNormaliseSetup({ ...FX3.setup, universe: wlUni({ resolve: 'export', watchlistId: 'wl-z' }) }).hash,
    'SC-311 validation refuses an unknown resolve, an export resolution with no list id, and one with no snapshot to fall back on; resolving from the export (and which list) is in the setup\'s hash, while an explicit "snapshot" is not', vwl.problems);

  /* ------------------------- SC-316 / SC-319: order is not a value order -- */
  const ordNames = ['ZETA', 'ALPHA', 'MU', 'BETA', 'OMEGA', 'KAPPA', 'DELTA', 'SIGMA', 'EPSILON', 'IOTA', 'CHI', 'GAMMA'];
  const ordDays = weekdays('2025-06-02', 80);
  const ordBase = ordNames.map((_, i) => lcgSeries(80, 900 + i));
  const ordH = (perm) => ({ series: Object.fromEntries(ordNames.map((s, i) => [s, seriesOf(ordDays, ordBase[perm[i]].c)])),
                            volume: Object.fromEntries(ordNames.map((s, i) => [s, seriesOf(ordDays, ordBase[perm[i]].v)])) });
  const ident = ordNames.map((_, i) => i);
  let seed = 77;
  const shuffled = ident.slice();
  for (let i = shuffled.length - 1; i > 0; i--) { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; const j = seed % (i + 1); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  const perms = [ident, ident.slice().reverse(), ident.map((_, i) => (i + 5) % ident.length), shuffled];
  const everyBar = { id: 'every', rules: [{ left: { indicator: 'price' }, op: 'above', right: { value: 0.01 } }] };
  const someBars = { id: 'some', rules: [{ left: { indicator: 'price' }, op: 'above', right: { indicator: 'sma', n: 20 } }, { left: { indicator: 'rvol', n: 10 }, op: 'above', right: { value: 0.9 } }] };
  const nowOrd = E.scanReplayNow(ordDays[ordDays.length - 1]);
  const pos = new Map(ordNames.map((s, i) => [s, i]));
  const inOrder = (syms) => syms.every((s, i) => i === 0 || pos.get(syms[i - 1]) < pos.get(s));
  const orders = perms.map(p => {
    const r = E.scanRun([everyBar, someBars], ordH(p), { now: nowOrd });
    return { every: r.alerts.filter(a => a.setupId === 'every').map(a => a.symbol), some: r.alerts.filter(a => a.setupId === 'some').map(a => a.symbol), setupsOrder: r.alerts.map(a => a.setupId) };
  });
  const byClose = (p) => ordNames.slice().sort((a, b) => ordBase[p[pos.get(b)]].c[79] - ordBase[p[pos.get(a)]].c[79]);
  check(orders.every(o => same(o.every, ordNames)) && orders.every(o => inOrder(o.some)) && new Set(orders.map(o => o.some.join())).size > 1
    && orders.every(o => o.setupsOrder.join() === [...o.every.map(() => 'every'), ...o.some.map(() => 'some')].join()) && perms.some(p => !same(byClose(p), ordNames)),
    'SC-316 / SC-319 the order of evaluation is independent of values: with closes and volumes permuted across the instruments (four permutations), every instrument is evaluated and recorded in the universe\'s own order — never by close or by volume — and the matching subset, which changes, keeps that order',
    orders.map(o => o.some));

  /* ------------------------------------------ SC-319: the planned budget -- */
  {
    const bigDays = weekdays('2024-06-03', 500);
    const big = { series: {}, volume: {} };
    for (let s = 0; s < 2000; s++) { const L = lcgSeries(500, 7000 + s); big.series[`B${s}`] = seriesOf(bigDays, L.c); big.volume[`B${s}`] = seriesOf(bigDays, L.v); }
    const three = { id: 'big3', rules: [{ left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } }, { left: { indicator: 'rsi' }, op: 'between', range: [40, 70] }, { left: { indicator: 'rvol' }, op: 'above', right: { value: 1 } }] };
    const t0 = Date.now();
    const bigRun = E.scanRun([three], big, { now: E.scanReplayNow(bigDays[bigDays.length - 1]) });
    const ms = Date.now() - t0;
    check(bigRun.evaluated === 2000 && ms < 5000, `SC-319 the planned budget: 2,000 instruments × 500 bars, one three-condition setup, scanRun in ${ms} ms (budget 5 s)`, { evaluated: bigRun.evaluated, ms });
  }

  /* ------------------------------------------ SC-307: catch-up in the engine -- */
  const cDays = weekdays('2026-01-05', 60);
  const cCloses = cDays.map((_, i) => (i < 57 ? 99 : i === 57 ? 99.5 : i === 58 ? 101 : 102));
  const crossH = { series: { CROSS: seriesOf(cDays, cCloses) }, volume: {} };
  const cross100 = { id: 'cross-100', version: 1, timeframe: '1D', cooldownMode: 'NEW_MATCH', universe: { kind: 'all' },
                     ruleTree: { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'CROSSES_ABOVE', right: { value: 100 } }] } };
  const pk = E.scanPairKey('cross-100', 1, 'CROSS', '1D');
  const cNow = E.scanReplayNow(cDays[59]);
  const caught = E.scanRun([cross100], crossH, { now: cNow, pairs: { [pk]: { lastEvaluatedBar: cDays[56] } } });
  const plain = E.scanRun([cross100], crossH, { now: cNow });
  let sep = [];
  for (const k of [56, 57, 58, 59]) sep = sep.concat(E.scanRun([cross100], E.scanTruncateHistory(crossH, cDays[k]), { now: E.scanReplayNow(cDays[k]), existing: sep }).alerts);
  const keyOf = (a) => `${a.key}|${a.dataVersion}|${a.close}`;
  check(pk === 'cross-100|v1|CROSS|1D' && caught.alerts.length === 1 && caught.alerts[0].candleDate === cDays[58] && caught.alerts[0].eventType === 'NEW_MATCH'
    && same(caught.catchUp, { pairs: 1, bars: 2, capped: 0, cap: 10 }) && caught.evaluated === 1 && caught.asOf === cDays[59] && caught.asOfFrom === cDays[57]
    && same(caught.pairs, { [pk]: { lastEvaluatedBar: cDays[59] } }) && same(caught.alerts.map(keyOf), sep.map(keyOf))
    && plain.alerts.length === 0 && plain.catchUp === null,
    'SC-307 catch-up (engine): three bars since the pair was last evaluated, with a cross on the middle one — the cross is recorded once, on its own bar, with the same key, data version and close as three separate daily runs; without the ledger\'s pairs only the last bar is read and the cross is lost',
    { caught: caught.alerts.map(a => a.candleDate), catchUp: caught.catchUp, sep: sep.map(a => a.candleDate) });
  const capped = E.scanRun([cross100], crossH, { now: cNow, pairs: { [pk]: { lastEvaluatedBar: cDays[45] } } });
  const fresh = E.scanRun([cross100], crossH, { now: cNow, pairs: {} });
  const ahead = E.scanRun([cross100], crossH, { now: cNow, pairs: { [pk]: { lastEvaluatedBar: cDays[59] } } });
  check(same(capped.catchUp, { pairs: 1, bars: 9, capped: 1, cap: 10 }) && capped.catchUpList[0]?.missed === 4 && capped.catchUpList[0].missedFrom === cDays[46] && capped.catchUpList[0].missedTo === cDays[49]
    && capped.alerts.length === 1 && fresh.catchUp.pairs === 0 && fresh.alerts.length === 0 && fresh.pairs[pk]?.lastEvaluatedBar === cDays[59] && ahead.catchUp.bars === 0,
    'SC-307 catch-up is capped at ten bars (the four before them are named, for --as-of); a pair with no entry — a new setup or version — reads its last bar only; a pair already on the last bar reads it again and nothing more',
    { capped: capped.catchUp, list: capped.catchUpList, fresh: fresh.catchUp });

  /* ------------------------------------------------ the worker's files -- */
  try {
    const { stdout: tracked } = await run('git', ['ls-files'], { cwd: ROOT });
    const ignore = (await readFile(join(ROOT, '.gitignore'), 'utf8')).split(/\r?\n/);
    const ci = await readFile(join(ROOT, '.github/workflows/checks.yml'), 'utf8');
    const mine = ['data/scan-ledger.json', 'data/watchlists.json'];
    check(mine.every(f => ignore.includes(f) && ignore.includes(`${f}.*`) && ci.includes(`'${f}'`)) && /\(scan-ledger\|watchlists\)/.test(ci) && !mine.some(f => new RegExp(`^${f.replace('.', '\\.')}`, 'm').test(tracked)),
      'the version ledger (data/scan-ledger.json) and the watchlist export (data/watchlists.json) are git-ignored with their .tmp/.bak, in CI\'s "no licensed data" list, and not tracked', mine);
  } catch { ok('git is not available here — the tracked-files check runs in CI'); }

  /* --------------------------------------------------- SC-306: the ledger -- */
  const unversioned = { ...FX3.setup };
  const widened = { ...FX3.setup, rules: FX3.setup.rules.map(r => (r.op === 'between' ? { ...r, range: [45, 75] } : r)) };
  const L1 = await folder('ledger', { setups: [unversioned], history: FX3.history });
  const l1 = await scan('--data', L1, '--now', FX3.now);
  const led1 = await ledgerOf(L1);
  const run1 = await lastRunOf(L1);
  const h1 = E.scanNormaliseSetup(unversioned).hash, h2 = E.scanNormaliseSetup(widened).hash;
  check(l1.code === 0 && led1.kind === 'quantum-tradeworks-scan-ledger' && led1.versions.length === 1 && led1.versions[0].setupId === 'fixture-breakout' && led1.versions[0].version === 1
    && led1.versions[0].source === 'file-edit' && led1.versions[0].hash === h1 && led1.versions[0].setup?.ruleTree && (await alertsOf(L1))[0]?.setupVersion === 1
    && same(run1.ledger?.newVersions, [{ setupId: 'fixture-breakout', version: 1, hash: h1, source: 'file-edit' }]) && run1.ledger.known === 0 && same(run1.ledger.refused, []),
    'SC-306 an unversioned setup gets v1 in the ledger (source file-edit, with its hash and evaluation fields), its alert says v1, and the run records the ledger\'s outcome', { led: led1.versions, run: run1.ledger });
  await writeFile(join(L1, 'scan-setups.json'), JSON.stringify({ setups: [widened] }));
  const l2 = await scan('--data', L1, '--now', FX3.now);
  const led2 = await ledgerOf(L1);
  const al2 = await alertsOf(L1);
  check(l2.code === 0 && led2.versions.length === 2 && led2.versions[1].version === 2 && led2.versions[1].source === 'file-edit' && led2.versions[1].hash === h2
    && al2.length === 2 && al2[1].setupVersion === 2 && al2[1].setupHash === h2 && /fixture-breakout v2 \(edited in the file\)/.test(l2.stdout),
    'SC-306 editing a rule in the file (still no version) gives v2 — the edit is a new version wherever it was made — and the alert records v2', { versions: led2.versions.map(v => [v.version, v.source]), stdout: l2.stdout.slice(0, 400) });
  await writeFile(join(L1, 'scan-setups.json'), JSON.stringify({ setups: [unversioned] }));
  const l3 = await scan('--data', L1, '--now', FX3.now);
  const run3 = await lastRunOf(L1);
  check(l3.code === 0 && (await ledgerOf(L1)).versions.length === 2 && run3.ledger?.known === 1 && !run3.ledger.newVersions.length && (await alertsOf(L1)).length === 2 && run3.counts?.deduped === 1,
    'SC-306 content the ledger already holds takes its recorded version back (the reverted rule runs as v1 again, and v1\'s bar is already recorded)', run3.ledger);
  await writeFile(join(L1, 'scan-setups.json'), JSON.stringify({ setups: [{ ...widened, version: 1 }, { ...unversioned, id: 'second' }] }));
  const l4 = await scan('--data', L1, '--now', FX3.now);
  const run4 = await lastRunOf(L1);
  const led4 = await ledgerOf(L1);
  check(l4.code === 2 && run4.status === 'PARTIAL' && run4.ledger?.refused?.length === 1 && run4.ledger.refused[0].setupId === 'fixture-breakout' && run4.ledger.refused[0].version === 1
    && /version 1 of fixture-breakout is already recorded with different content/.test(run4.ledger.refused[0].why) && /save it again in the builder/.test(run4.ledger.refused[0].why)
    && run4.errors.some(e => e.category === 'VALIDATION' && /already recorded with different content/.test(e.message)) && /LEFT OUT/.test(l4.stdout)
    && (await alertsOf(L1)).some(a => a.setupId === 'second') && led4.versions.length === 3 && led4.versions[2].setupId === 'second',
    'SC-306 a version number reused for different content is refused with the reason, the run is PARTIAL (exit 2), and the other setups still run', { code: l4.code, refused: run4.ledger?.refused });
  await writeFile(join(L1, 'scan-setups.json'), JSON.stringify({ setups: [{ ...widened, version: 5 }] }));
  const l5 = await scan('--data', L1, '--now', FX3.now);
  const led5 = await ledgerOf(L1);
  check(l5.code === 0 && led5.versions.length === 4 && led5.versions[3].version === 5 && led5.versions[3].source === 'export' && same(led5.versions.slice(0, 3), led4.versions)
    && same(led4.versions.slice(0, 2), led2.versions) && same(led2.versions.slice(0, 1), led1.versions),
    'SC-306 a version the ledger has not seen (the builder\'s export) is added as source export; entries are only ever appended — each earlier ledger is a prefix of the next', led5.versions.map(v => [v.setupId, v.version, v.source]));
  await writeFile(join(L1, 'scan-ledger.json'), '{broken');
  const before6 = JSON.stringify(await alertsOf(L1));
  const l6 = await scan('--data', L1, '--now', FX3.now, '--trigger', 'daily');
  const run6 = await lastRunOf(L1);
  check(l6.code === 1 && run6.status === 'FAILED' && run6.error?.category === 'IO' && /not started again quietly/.test(run6.error.message) && /scan-ledger\.json\.bak/.test(run6.error.message)
    && JSON.stringify(await alertsOf(L1)) === before6,
    'SC-306 a damaged ledger fails the run (exit 1, IO) naming the .bak, instead of starting a new ledger that would number hand edits from v1 again; the alerts are untouched', run6.error);

  /* ---------------------------------------------- SC-307: catch-up, worker -- */
  const cut = (k) => E.scanTruncateHistory(crossH, cDays[k]);
  const CA = await folder('catchup', { setups: [cross100], history: cut(56) });
  const ca1 = await scan('--data', CA, '--now', E.scanReplayNow(cDays[56]));
  await writeFile(join(CA, 'price-history.json'), JSON.stringify(crossH));
  const ca2 = await scan('--data', CA, '--now', cNow, '--trigger', 'daily');
  const runCa2 = await lastRunOf(CA);
  const aCa = await alertsOf(CA);
  const pairsCa = (await ledgerOf(CA)).pairs;
  check(ca1.code === 0 && ca2.code === 0 && aCa.length === 1 && aCa[0].candleDate === cDays[58] && aCa[0].eventType === 'NEW_MATCH'
    && same(runCa2.catchUp, { pairs: 1, bars: 2, capped: 0, cap: 10 }) && pairsCa[pk]?.lastEvaluatedBar === cDays[59] && pairsCa[pk].runId === runCa2.id
    && /catch-up\s+1 pair\(s\) had missed bars: 2 earlier bar\(s\) evaluated/.test(ca2.stdout),
    'SC-307 the worker catches up: the history advanced three bars since the last run with a cross on the middle one — recorded once, on the right bar; the run records catchUp, the output announces it, and the ledger moves the pair to the last bar',
    { alerts: aCa.map(a => [a.candleDate, a.eventType]), catchUp: runCa2.catchUp, pair: pairsCa[pk] });
  const caRetry = await scan('--data', CA, '--retry', runCa2.id);
  check(caRetry.code === 0 && (await alertsOf(CA)).length === 1 && (await lastRunOf(CA)).counts?.recorded === 0,
    'SC-307 a retry of the completed catch-up run adds 0 alerts');
  const CB = await folder('daily-3', { setups: [cross100], history: cut(56) });
  await scan('--data', CB, '--now', E.scanReplayNow(cDays[56]));
  for (const k of [57, 58, 59]) {
    await writeFile(join(CB, 'price-history.json'), JSON.stringify(cut(k)));
    await scan('--data', CB, '--now', E.scanReplayNow(cDays[k]), '--trigger', 'daily');
  }
  const aCb = await alertsOf(CB);
  const cmp = (list) => list.map(a => `${a.key}|${a.candleDate}|${a.eventType}|${a.close}|${a.dataVersion}|${a.setupVersion}`);
  check(aCb.length === 1 && same(cmp(aCa), cmp(aCb)),
    'SC-307 the catch-up run records exactly what three separate daily runs record (key, bar, event, close, data version, version)', { catchUp: cmp(aCa), daily: cmp(aCb) });
  const CC = await folder('fresh', { setups: [cross100], history: crossH });
  const cc = await scan('--data', CC, '--now', cNow);
  check(cc.code === 0 && (await alertsOf(CC)).length === 0 && same((await lastRunOf(CC)).catchUp, { pairs: 0, bars: 0, capped: 0, cap: 10 }),
    'SC-307 a pair the ledger has never evaluated (a new setup or version) reads its last bar only — replay is the way further back');
  const CD = await folder('capped', { setups: [cross100], history: cut(45) });
  await scan('--data', CD, '--now', E.scanReplayNow(cDays[45]));
  await writeFile(join(CD, 'price-history.json'), JSON.stringify(crossH));
  const cd = await scan('--data', CD, '--now', cNow);
  check(cd.code === 0 && same((await lastRunOf(CD)).catchUp, { pairs: 1, bars: 9, capped: 1, cap: 10 }) && (await alertsOf(CD)).length === 1
    && /more than 10 bars behind — the newest 10 were evaluated, and --as-of DATE replays the days before/.test(cd.stdout) && cd.stdout.includes(`4 bar(s) not caught up, ${cDays[46]} … ${cDays[49]}`),
    'SC-307 catch-up stops at ten bars and prints the bars it did not read, for --as-of', cd.stdout.split('\n').filter(l => /catch-up|not caught/.test(l)));
  const caRep = await scan('--data', CA, '--as-of', cDays[57]);
  const pairsAfter = (await ledgerOf(CA)).pairs;
  check(caRep.code === 0 && pairsAfter[pk]?.lastEvaluatedBar === cDays[59] && (await lastRunOf(CA)).catchUp === null,
    'SC-307 a replay evaluates its date only: no catch-up, and the ledger\'s pairs do not move back');

  /* ---------------------------------------- SC-301: the ready gate, worker -- */
  const rDays = [];
  for (let d = '2026-02-02'; d <= '2026-04-06'; d = E.scanAddDays(d, 1)) { const w = E.scanWeekday(d); if (w >= 1 && w <= 5) rDays.push(d); }
  const rLast = rDays[rDays.length - 1];
  const readyH = { schema: 2, series: { USA: seriesOf(rDays, rDays.map((_, i) => 50 + i)), MYA: seriesOf(rDays, rDays.map((_, i) => 5 + i / 10)) }, volume: {},
                   meta: { MYA: { [rLast]: { src: 'screen', at: '2026-04-06T07:00:00Z' } }, USA: { [rLast]: { src: 'screen', at: '2026-04-06T21:00:00Z' } } } };
  const twoMarkets = [{ symbol: 'USA', market: 'US' }, { symbol: 'MYA', market: 'MY' }];
  const pxEvery = { id: 'px-every', rules: [{ left: { indicator: 'price' }, op: 'above', right: { value: 0.01 } }] };
  const RN = '2026-04-07T02:00:00Z';
  const RA = await folder('ready', { setups: [pxEvery], history: readyH, instruments: twoMarkets });
  const ra = await scan('--data', RA, '--instruments', join(RA, 'instruments.json'), '--now', RN, '--trigger', 'daily', '--ready');
  const runRa = await lastRunOf(RA);
  const aRa = await alertsOf(RA);
  const pairsRa = (await ledgerOf(RA)).pairs;
  check(ra.code === 2 && runRa.status === 'PARTIAL' && runRa.ready === true && runRa.skippedMarkets.length === 1 && runRa.skippedMarkets[0].market === 'MY'
    && runRa.skippedMarkets[0].status === 'SKIPPED_NO_DATA' && runRa.skippedMarkets[0].state === 'PROVISIONAL' && /held only as a provisional bar/.test(runRa.skippedMarkets[0].reason)
    && aRa.length === 1 && aRa[0].symbol === 'USA' && aRa[0].candleDate === rLast && runRa.counts.evaluated === 1
    && !Object.keys(pairsRa).some(k => /\|MYA\|/.test(k)) && Object.keys(pairsRa).some(k => /\|USA\|/.test(k))
    && /^not ready\s+(\S+) — (.+)$/m.test(ra.stdout) && ra.stdout.match(/^not ready\s+(\S+) — (.+)$/m)[1] === 'MY' && /not a provider's word/.test(ra.stdout)
    && runRa.errors.some(e => e.category === 'DATA' && /^MY not ready/.test(e.message)),
    'SC-301 --ready: a history whose MY last bar is PROVISIONAL (captured 15:00 in Kuala Lumpur) gives SKIPPED_NO_DATA for MY — named in the run and the output, in the line daily.mjs reads, its pairs not moved — while US still runs; the run exits 2',
    { code: ra.code, skipped: runRa.skippedMarkets, alerts: aRa.map(a => a.symbol) });
  const RB = await folder('not-ready-plain', { setups: [pxEvery], history: readyH, instruments: twoMarkets });
  const rb = await scan('--data', RB, '--instruments', join(RB, 'instruments.json'), '--now', RN);
  const runRb = await lastRunOf(RB);
  check(rb.code === 0 && runRb.ready === false && same(runRb.skippedMarkets, []) && runRb.counts.evaluated === 2,
    'SC-301 without --ready the same history is evaluated in both markets (MY on its last final bar, judged stale) and nothing is held back — the gate is what --ready adds', runRb.counts);

  /* --------------------------------------------- SC-307: narrowed replay -- */
  const nDays = weekdays('2026-03-02', 30);
  const nH = { series: { USA: seriesOf(nDays, nDays.map((_, i) => 50 + i)), MYA: seriesOf(nDays, nDays.map((_, i) => 5 + i)) }, volume: {} };
  const alpha = { id: 'alpha', rules: [{ left: { indicator: 'price' }, op: 'above', right: { value: 0.01 } }] };
  const beta = { id: 'beta', rules: [{ left: { indicator: 'price' }, op: 'above', right: { value: 1 } }] };
  const NA = await folder('narrow', { setups: [alpha, beta], history: nH, instruments: twoMarkets });
  const nDate = nDays[29];
  const inst = ['--instruments', join(NA, 'instruments.json')];
  const n1 = await scan('--data', NA, ...inst, '--as-of', nDate, '--setup', 'alpha');
  const aN1 = await alertsOf(NA);
  const n2 = await scan('--data', NA, ...inst, '--as-of', nDate, '--market', 'my');
  const aN2 = await alertsOf(NA);
  const runN2 = await lastRunOf(NA);
  const audN = (await runsOf(NA)).audit.filter(a => a.action === 'replay');
  check(n1.code === 0 && aN1.length === 2 && aN1.every(a => a.setupId === 'alpha') && aN1.every(a => a.origin === 'replay')
    && n2.code === 0 && aN2.length === 3 && aN2[2].setupId === 'beta' && aN2[2].symbol === 'MYA' && same(runN2.narrow, { setup: null, market: 'MY' })
    && runN2.narrowed?.instrumentsLeftOut === 2 && runN2.counts.evaluated === 2 && runN2.counts.deduped === 1 && !runN2.errors.length
    && audN.length === 2 && audN[0].setup === 'alpha' && audN[0].market === null && audN[1].market === 'MY' && audN[1].added === 1 && /narrowed\s+to market MY/.test(n2.stdout),
    'SC-307 --as-of DATE --setup ID replays one setup; --market MY replays only MY\'s instruments (US left out and counted, not reported missing); each narrowing is in the run and the audit entry',
    { a1: aN1.map(a => `${a.setupId}/${a.symbol}`), a2: aN2.map(a => `${a.setupId}/${a.symbol}`), narrowed: runN2.narrowed, audit: audN });
  const n3 = await scan('--data', NA, ...inst, '--as-of', nDate, '--setup', 'nope');
  const n4 = await scan('--data', NA, ...inst, '--as-of', nDate, '--market', 'ZZ');
  const n5 = await scan('--data', NA, ...inst, '--setup', 'alpha');
  const runN4 = await lastRunOf(NA);
  check(n3.code === 1 && /--setup nope: no such setup/.test(n3.stderr) && n4.code === 1 && /--market ZZ: no instrument/.test(n4.stderr) && runN4.error?.category === 'ARGS'
    && n5.code === 1 && /narrow a replay/.test(n5.stderr),
    'SC-307 a narrowing that names nothing fails as an argument error (logged), and --setup without --as-of is refused: a scheduled or manual run evaluates every setup');
  const narrowedRun = (await runsOf(NA)).runs.find(r => r.narrow?.market === 'MY' && r.status === 'COMPLETED');
  const n6 = await scan('--data', NA, ...inst, '--retry', narrowedRun?.id || 'none');
  const runN6 = await lastRunOf(NA);
  check(n6.code === 0 && same(runN6.narrow, { setup: null, market: 'MY' }) && runN6.retryOf === narrowedRun.id && runN6.counts.recorded === 0 && runN6.narrowed?.instrumentsLeftOut === 2,
    'SC-307 a retry of a narrowed replay keeps its narrowing and adds nothing', runN6.narrow);

  /* --------------------------------------- SC-311: the export, worker -- */
  const WL = await folder('wl-export', { setups: [exSetup], history: FX3.history, watchlists: exportA });
  const w1 = await scan('--data', WL, '--now', FX3.now);
  const runW1 = await lastRunOf(WL);
  const aW1 = await alertsOf(WL);
  check(w1.code === 0 && aW1.length === 1 && aW1[0].symbol === 'MATCH' && same(aW1[0].universeResolvedFrom, { source: 'export', exportedAt: exportA.exportedAt })
    && same(runW1.universeResolvedFrom, [{ setupId: 'wl-export', watchlistId: 'wl-a', source: 'export', exportedAt: exportA.exportedAt }]) && runW1.counts.evaluated === 1
    && /watchlist\s+wl-export: members from your export of 2026-04-06T09:00:00\.000Z/.test(w1.stdout),
    'SC-311 the worker reads data/watchlists.json at run time for an export-resolved setup: its members are scanned, and the run and the alert record universeResolvedFrom', { run: runW1.universeResolvedFrom, stdout: w1.stdout.slice(0, 300) });
  await rm(join(WL, 'watchlists.json'));
  const w2 = await scan('--data', WL, '--now', FX3.now);
  const runW2 = await lastRunOf(WL);
  await writeFile(join(WL, 'watchlists.json'), JSON.stringify(wlExport([{ id: 'wl-other', name: 'Other', items: [] }])));
  const w3 = await scan('--data', WL, '--now', FX3.now);
  const runW3 = await lastRunOf(WL);
  check(w2.code === 2 && runW2.status === 'PARTIAL' && runW2.errors.some(e => e.category === 'DATA' && /there is no data\/watchlists\.json/.test(e.message) && /snapshot of 2026-03-01/.test(e.message))
    && runW2.counts.evaluated === 2 && /WATCHLIST SNAPSHOT USED/.test(w2.stdout)
    && w3.code === 2 && runW3.errors.some(e => /watchlist wl-a is not in data\/watchlists\.json/.test(e.message)),
    'SC-311 with the export missing, or without the list, the worker falls back to the snapshot and the run is PARTIAL (exit 2) with the warning', { w2: runW2.errors, w3: runW3.errors });

  /* ------------------------------------------------ C4: the run's fields -- */
  const c4 = await lastRunOf(CA);
  const c4b = (await runsOf(CA)).runs.find(r => r.id === runCa2.id);
  check(Number.isInteger(c4b.cacheStats?.hits) && Number.isInteger(c4b.cacheStats?.misses) && c4b.catchUp && Array.isArray(c4b.skippedMarkets) && c4b.ledger && typeof c4b.ledger.known === 'number'
    && Array.isArray(c4b.ledger.newVersions) && Array.isArray(c4b.ledger.refused) && c4b.counts && Array.isArray(c4b.readiness) && typeof c4b.historyNewest === 'string'
    && ['cacheStats', 'skippedMarkets', 'catchUp', 'ledger', 'universeResolvedFrom', 'ready', 'narrow'].every(k => k in c4) && c4.catchUp === null,
    'C4 every run carries cacheStats (on the run, not only the alerts file\'s lastRun), skippedMarkets, catchUp (null for a replay), ledger { known, newVersions, refused } and universeResolvedFrom',
    { cacheStats: c4b.cacheStats, ledger: c4b.ledger });

  /* ------------------------------------ SC-301: daily.mjs names them -- */
  const DR = join(tmpdir(), `qt-r3w-daily-${process.pid}`);
  await rm(DR, { recursive: true, force: true });
  await mkdir(join(DR, 'ingest'), { recursive: true }); await mkdir(join(DR, 'scanner'), { recursive: true }); await mkdir(join(DR, 'data'), { recursive: true });
  folders.push(DR);
  await writeFile(join(DR, 'ingest/autoshot.mjs'), "console.log('page 1');");
  await writeFile(join(DR, 'ingest/watchlist.mjs'), "console.log('candidates 3\\nflagged   0\\nskipped   0');");
  await writeFile(join(DR, 'ingest/prices.mjs'), "console.log('  accepted : 3\\n  rejected : 0');");
  await writeFile(join(DR, 'ingest/history.mjs'), "console.log('  symbols   : 3\\n  new bars  : 3\\n  depth     : 1-3 day(s) per symbol');");
  /* The stub prints the line the real worker printed above, word for word. */
  const nrLine = ra.stdout.match(/^not ready\s+.+$/m)?.[0] || 'not ready  MY — (missing)';
  await writeFile(join(DR, 'scanner/scan.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync('scan-called.json', JSON.stringify(process.argv.slice(2))); console.log('1 new alert recorded'); console.log(${JSON.stringify(nrLine)}); console.log('status     PARTIAL (run-stub-9)'); process.exit(2);`);
  await writeFile(join(DR, 'data/scan-setups.json'), '{"setups":[]}');
  let dr;
  try { const { stdout } = await run(process.execPath, [join(ROOT, 'ingest/daily.mjs'), '--url', 'http://example.invalid', '--no-fx'], { cwd: DR }); dr = { code: 0, stdout }; }
  catch (e) { dr = { code: e.code, stdout: e.stdout || '' }; }
  const drRun = ((await json(join(DR, 'data/ingest-runs.json')))?.runs || []).slice(-1)[0] || {};
  check(dr.code === 2 && same(await json(join(DR, 'scan-called.json')), ['--trigger', 'daily', '--ready']) && /not ready, so not scanned today \(SKIPPED_NO_DATA/.test(dr.stdout)
    && /^\s+MY — .*provisional/m.test(dr.stdout) && /not confirmed by a provider/.test(dr.stdout) && drRun.scanner?.skippedMarkets?.[0]?.market === 'MY'
    && /not ready: MY/.test(drRun.steps?.find(s => s.step === 'scanner')?.detail || ''),
    'SC-301 daily.mjs passes --ready, names each market held back in its report and its run log, says readiness is not a provider\'s confirmation, and exits 2', { code: dr.code, out: dr.stdout.split('\n').filter(l => /scanner|MY/.test(l)) });

  for (const d of folders) await rm(d, { recursive: true, force: true });
}
/* ---- end round 3: worker ---- */

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} scanner checks hold`);
process.exit(failures ? 1 : 0);
