#!/usr/bin/env node
/**
 * Drives the register through record → edit → undo → replay across every
 * logged entity, checking the invariants after every single step.
 *
 *   node register-test.mjs                        against production
 *   node register-test.mjs http://localhost:8123  against a local server
 *   node register-test.mjs --verbose              print every step
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The demand register was added. It wrote a 'demand' event to the register log.
 * undoLastRegisterChange handled 'observation' and 'areaAttr' only, so it
 * returned null and never wrote a reversal — which left that event permanently
 * the newest un-reversed entry. The Undo button stayed enabled, did nothing on
 * every press, reported "Nothing left to undo", and no earlier change could be
 * reached again. One demand record disabled undo for the entire register.
 *
 * Every existing check passed throughout. The route sweep loads pages and looks
 * for errors; nothing threw. coverage-frames watches for a page contradicting
 * itself; no page did. mobile and contrast look at layout. CI was green on the
 * commit that shipped it, and green on the two after.
 *
 * The gap is that all of those check a PAGE. This checks a SEQUENCE — the thing
 * that only goes wrong when one feature meets another that was written on a
 * different day.
 *
 * WHAT IT ASSERTS
 *
 *   1  Every entity written to the log has an undo and a replay handler.
 *      The exact bug, caught statically before a browser is even started.
 *   2  Undo is never jammed: if canUndoRegister() is true, undoing must return
 *      a description AND strictly reduce the number of un-reversed events.
 *      This is the general form, and it catches any future entity that jams.
 *   3  The log is append-only. Undo adds a reversal; it never removes an entry.
 *   4  Replay reproduces the live projections after every step.
 *   5  Undo drains to empty in bounded steps and restores the starting state
 *      exactly.
 *   6  Every projection an entity maintains is carried by a backup.
 *
 * IF A FOURTH ENTITY IS ADDED, THIS FAILS UNTIL IT IS COVERED. The operations
 * below are declared per entity and checked against REGISTER_ENTITIES at run
 * time, so a new entity with no operations declared is an error rather than a
 * silent hole in the coverage — which is exactly how the demand register got in.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const BASE = (args.find(a => a.startsWith('http')) || 'https://quantum-tradeworks.vercel.app').replace(/\/$/, '');
const VERBOSE = args.includes('--verbose');
const ROOT = dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- static ---
   Check 1, before paying for a browser. This is the precise shape of the bug
   that prompted the file: an entity that can be written but not reversed. */
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const written = [...new Set([...html.matchAll(/logRegister\('([a-zA-Z]+)'/g)].map(m => m[1]))].sort();
const regBlock = html.slice(html.indexOf('const REGISTER_ENTITIES = {'), html.indexOf('function lastUndoableEvent'));
const handled = [...new Set([...regBlock.matchAll(/^  ([a-zA-Z]+): \{/gm)].map(m => m[1]))].sort();
const unhandled = written.filter(w => !handled.includes(w));

console.log(`entities written : ${written.join(', ')}`);
console.log(`entities handled : ${handled.join(', ')}`);
if (unhandled.length) {
  console.error(`\nFAIL  ${unhandled.join(', ')} written to the register log with no undo or replay handler.`);
  console.error('      An entity that can be recorded and not reversed jams undo for everything behind it.');
  console.error('      Add it to REGISTER_ENTITIES in src/js/68-register-log.js.');
  process.exit(1);
}
console.log('ok    every logged entity has an undo and a replay\n');

/* ------------------------------------------------------------- operations ---
   One record → edit → delete cycle per entity, written the way the UI writes
   it. Observation editing has no single named writer — the drawer mutates in
   place after calling the recorder — so that sequence is reproduced here
   rather than invented, and if the drawer's sequence changes this stops
   matching the app and should be updated with it. */
const OPS = {
  observation: [
    { name: 'record', js: `(() => {
        const r = addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price',
          value: 500000, date:'2026-05-01', evidence:'user', sourceRef:'test', sqft:1000 });
        return r.id;
      })()` },
    { name: 'edit', js: `(() => {
        const o = State.observations[0];
        recordObservationEdited(o.id, 'value', o.value, 461000);
        State.observations[0] = { ...o, value: 461000 };
        saveObservations();
        return State.observations[0].value;
      })()` },
    { name: 'delete', js: `(() => {
        const o = State.observations[0];
        recordObservationDeleted(o);
        State.observations = State.observations.filter(x => x.id !== o.id);
        saveObservations();
        return State.observations.length;
      })()` },
  ],
  areaAttr: [
    { name: 'record', js: `setAreaAttr('kuching','Tabuan','flood',{class:'occasional',source:'site',asOf:'2026-05-01',ref:'test'}) || 'set'` },
    { name: 'edit', js: `setAreaAttr('kuching','Tabuan','flood',{class:'recurrent',source:'did',asOf:'2026-06-01',ref:'test2'}) || 'changed'` },
    { name: 'delete', js: `setAreaAttr('kuching','Tabuan','flood',null) || 'cleared'` },
  ],
  demand: [
    { name: 'record', js: `setDemand('kuching','Tabuan','employment',{state:'operating',asOf:'2026-05-01'}) || 'set'` },
    { name: 'edit', js: `setDemand('kuching','Tabuan','employment',{state:'declining',asOf:'2026-06-01'}) || 'changed'` },
    { name: 'delete', js: `setDemand('kuching','Tabuan','employment',null) || 'cleared'` },
  ],
};

/* Which storage key each entity's projection lives under, so check 6 can ask
   whether a backup carries it. */
const PROJECTION_KEY = { observation: 'observations', areaAttr: 'areaProfiles', demand: 'demand' };

const CANDIDATES = [
  process.env.CHROME_PATH, process.env.CHROME_BIN,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const CI_FLAGS = process.env.CI
  ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  : [];
const bin = CANDIDATES.find(existsSync);
if (!bin) { console.error('no Chrome or Edge found — set CHROME_PATH'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const profile = join(tmpdir(), `qt-register-${process.pid}`);
const port = 9250 + (process.pid % 40);
const proc = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-gpu', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });

let failures = 0;
const fail = (msg, detail) => {
  failures++;
  console.error(`FAIL  ${msg}`);
  if (detail !== undefined) console.error(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};

let ws;
try {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; }
    catch { await sleep(250); }
  }
  if (!wsUrl) throw new Error('devtools never came up');
  ws = new WebSocket(wsUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));

  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}, sid) => new Promise(res => {
    const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
  });

  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description
        || r.result.exceptionDetails.text || 'evaluation threw');
    }
    return r.result.result.value;
  };

  console.log(`target  ${BASE}\n`);
  await send('Page.navigate', { url: `${BASE}/property/comparables` }, sessionId);
  await sleep(4000);

  /* Every entity the app declares must have operations here. A new entity with
     none is a hole in this test, and it is an error rather than a pass. */
  const declared = await evaluate('Object.keys(REGISTER_ENTITIES)');
  const uncovered = declared.filter(e => !OPS[e]);
  if (uncovered.length) {
    fail(`${uncovered.join(', ')} is declared in REGISTER_ENTITIES with no operations in this test.`,
      'Add a record/edit/delete cycle for it to OPS in register-test.mjs.');
  }

  /* A clean slate, captured so the end state can be compared against it. */
  const snapshot = () => evaluate(`JSON.stringify({
    observations: State.observations, areaProfiles: State.areaProfiles, demand: State.demand,
  })`);
  await evaluate(`(() => {
    ['registerLog','observations','areaProfiles','demand'].forEach(k => localStorage.removeItem('vl.' + k));
    State.observations = []; State.areaProfiles = {}; State.demand = {};
    loadRegisterLog();
    return true;
  })()`);
  const initial = await snapshot();

  /* ---- checks 2-4, after every mutation ---- */
  const invariants = async (label, prevLogLen) => {
    const s = await evaluate(`(() => {
      const log = registerLog();
      const r = replayRegister();
      const live = { observations: State.observations, areaProfiles: State.areaProfiles, demand: State.demand };
      /* Replay returns observations in event order and the projection prepends,
         so they are compared as sets keyed by id rather than as arrays. */
      const byId = (xs) => Object.fromEntries((xs || []).map(o => [o.id, o]));
      return JSON.stringify({
        logLen: log.length,
        canUndo: canUndoRegister(),
        replayOk: r.ok,
        replayMatchesObs: r.ok && JSON.stringify(byId(r.observations)) === JSON.stringify(byId(live.observations)),
        replayMatchesAreas: r.ok && JSON.stringify(r.areaProfiles) === JSON.stringify(live.areaProfiles),
        replayMatchesDemand: r.ok && JSON.stringify(r.demand || {}) === JSON.stringify(live.demand),
        integrity: registerIntegrity().state,
      });
    })()`);
    const v = JSON.parse(s);

    /* 3 — append-only */
    if (v.logLen < prevLogLen) fail(`${label}: the log SHRANK from ${prevLogLen} to ${v.logLen}. It is append-only.`);
    /* 4 — replay reproduces the live projections */
    if (!v.replayOk) fail(`${label}: replay refused.`);
    if (v.replayOk && !v.replayMatchesObs) fail(`${label}: replay does not reproduce State.observations.`);
    if (v.replayOk && !v.replayMatchesAreas) fail(`${label}: replay does not reproduce State.areaProfiles.`);
    if (v.replayOk && !v.replayMatchesDemand) fail(`${label}: replay does not reproduce State.demand.`);
    if (v.integrity !== 'ok') fail(`${label}: registerIntegrity reports "${v.integrity}".`);
    if (VERBOSE) console.log(`      ${label}: ${v.logLen} events, canUndo=${v.canUndo}, integrity=${v.integrity}`);
    return v;
  };

  let logLen = 0;
  let mutations = 0;
  for (const entity of declared.filter(e => OPS[e])) {
    for (const op of OPS[entity]) {
      try { await evaluate(op.js); }
      catch (err) { fail(`${entity}.${op.name} threw`, String(err.message).split('\n')[0]); continue; }
      mutations++;
      const v = await invariants(`${entity}.${op.name}`, logLen);
      logLen = v.logLen;
      /* 2 — a mutation must always leave something to undo */
      if (!v.canUndo) fail(`${entity}.${op.name}: nothing is undoable after a mutation.`);
    }
    console.log(`ok    ${entity} — record, edit, delete`);
  }

  /* ---- check 2 and 5: undo must drain, and never jam ---- */
  console.log('\ndraining undo…');
  let steps = 0;
  const MAX = mutations * 3 + 10;
  for (;;) {
    const before = await evaluate(`JSON.stringify({
      canUndo: canUndoRegister(),
      pending: (() => { const l = registerLog(); const u = new Set(l.filter(e => e.undoOf).map(e => e.undoOf));
        return l.filter(e => !e.undoOf && !u.has(e.seq) && REGISTER_ENTITIES[e.entity]).length; })(),
      logLen: registerLog().length,
    })`);
    const b = JSON.parse(before);
    if (!b.canUndo) break;

    const what = await evaluate('undoLastRegisterChange()');
    steps++;

    const after = await evaluate(`JSON.stringify({
      pending: (() => { const l = registerLog(); const u = new Set(l.filter(e => e.undoOf).map(e => e.undoOf));
        return l.filter(e => !e.undoOf && !u.has(e.seq) && REGISTER_ENTITIES[e.entity]).length; })(),
      logLen: registerLog().length,
    })`);
    const a = JSON.parse(after);

    /* THE JAM CHECK. This is the one that would have caught the demand bug on
       the commit that introduced it: undo reported itself available, did
       nothing, and left the queue exactly as long as it found it. */
    if (what === null) {
      fail(`undo step ${steps}: canUndoRegister() was true but undoLastRegisterChange() returned null.`,
        'Undo is jammed — this event can never be passed, and every earlier change is now unreachable.');
      break;
    }
    if (a.pending >= b.pending) {
      fail(`undo step ${steps}: un-reversed events did not decrease (${b.pending} → ${a.pending}) after "${what}".`,
        'Undo claimed to do something without reversing anything.');
      break;
    }
    if (a.logLen <= b.logLen) {
      fail(`undo step ${steps}: the log did not grow. A reversal is a new event, not a deletion.`);
      break;
    }
    if (steps > MAX) { fail(`undo did not drain after ${MAX} steps.`); break; }
    if (VERBOSE) console.log(`      ${steps}. ${what}  (${b.pending} → ${a.pending} pending)`);
  }
  /* Only report a drain as ok if it actually drained. The first version
     printed "ok undo drained in 1 step, 9 mutations reversed" immediately
     after failing on step 1 — the count of mutations MADE read as a count of
     mutations reversed, and a reader skimming the output would have seen a
     pass line under a failure. */
  const drained = !(await evaluate('canUndoRegister()'));
  console.log(drained && steps === mutations
    ? `ok    undo drained in ${steps} step${steps === 1 ? '' : 's'}, reversing all ${mutations} mutations`
    : `FAIL  undo stopped after ${steps} of ${mutations} mutations, ${drained ? 'with nothing left to undo' : 'with changes still pending'}`);
  if (!(drained && steps === mutations)) failures++;

  /* 5 — back where we started */
  const finalState = await snapshot();
  if (finalState !== initial) {
    fail('after undoing everything, the projections do not match the starting state.',
      `initial ${initial.slice(0, 160)}\n      final   ${finalState.slice(0, 160)}`);
  } else {
    console.log('ok    every projection restored to its starting state');
  }
  await invariants('after drain', 0);

  /* 6 — a backup carries every projection */
  const portable = await evaluate('JSON.stringify(PORTABLE_KEYS.map(k => k.k))');
  const keys = JSON.parse(portable);
  const missing = declared.map(e => PROJECTION_KEY[e]).filter(k => k && !keys.includes(k));
  if (missing.length) {
    fail(`${missing.join(', ')} is not in PORTABLE_KEYS.`,
      'A backup would carry the other projections and silently drop this one.');
  } else {
    console.log('ok    every projection is carried by a backup');
  }

  console.log(failures
    ? `\n${failures} invariant${failures === 1 ? '' : 's'} broken.`
    : '\nregister holds: record, edit, undo and replay agree across every entity.');
  process.exitCode = failures ? 1 : 0;
} catch (err) {
  console.error(`\nFAIL  ${err.message}`);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch { /* already gone */ }
  proc.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
