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

/* The two data files are personal and git-ignored; CI also checks this, but a
   local run should say so before a push does. */
try {
  const { stdout: tracked } = await run('git', ['ls-files'], { cwd: ROOT });
  check(!/^data\/scan-(setups|alerts)\.json$/m.test(tracked), 'neither scanner data file is tracked by git');
} catch { ok('git is not available here — the tracked-files check runs in CI'); }

console.log(failures ? `\n${failures} failed, ${passes} passed` : `\nall ${passes} scanner checks hold`);
process.exit(failures ? 1 : 0);
