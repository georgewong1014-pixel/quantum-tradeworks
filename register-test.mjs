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
/* CDP_PORT pins the debugging port, so harnesses run side by side (several
   worktrees, or CI jobs on one runner) cannot land on the same Chrome. */
const port = Number(process.env.CDP_PORT) || 9250 + (process.pid % 40);
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

  /* ---- bugfix: grade-area-registers ---- */
  /* 7 — a register log that is not a list of events, or a name that is not a
         string, is read as none: the app boots and recording still works.
         A restored file writes these keys as it finds them. vl.registerLog
         holding {} made loadRegisterLog() throw at the top level of the one
         script, and every page came up blank; a numeric vl.registerActor made
         every write throw inside logRegister. */
  {
    const CORRUPT = [
      ['registerLog', {}], ['registerLog', null], ['registerLog', [null]], ['registerLog', 'abc'],
      ['registerLog', [{ seq: 1, at: '2026-09-01T00:00:00Z', entity: 'constructor', op: 'add', id: 'x' }]],
      ['registerActor', 5],
    ];
    const bad = [];
    for (const [k, v] of CORRUPT) {
      await evaluate(`(() => { ['registerLog','registerActor','observations','areaProfiles','demand'].forEach(x => localStorage.removeItem('vl.' + x));
        localStorage.setItem('vl.' + ${JSON.stringify(k)}, ${JSON.stringify(JSON.stringify(v))}); return true; })()`);
      await send('Page.navigate', { url: `${BASE}/property/comparables` }, sessionId);
      await sleep(2500);
      const r = await evaluate(`(() => {
        const h1 = document.querySelector('main h1')?.textContent || '';
        let recorded = false, undo = null;
        try {
          const before = registerLog().length;
          addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 1, date:'2026-05-01', evidence:'user' });
          recorded = registerLog().length === before + 1;
          undo = canUndoRegister();
        } catch (e) { recorded = 'threw: ' + e.message; }
        return JSON.stringify({ h1, recorded, undo });
      })()`).catch(e => JSON.stringify({ h1: '', recorded: 'eval threw: ' + e.message.split('\n')[0] }));
      const o = JSON.parse(r);
      if (!/Sarawak comparables register/.test(o.h1) || o.recorded !== true || o.undo !== true)
        bad.push(`vl.${k} = ${JSON.stringify(v)}: ${r}`);
    }
    await evaluate(`(() => { ['registerLog','registerActor','observations','areaProfiles','demand'].forEach(x => localStorage.removeItem('vl.' + x)); return true; })()`);
    if (bad.length) fail('a malformed register log or recorder name blanks the page or stops recording', bad.join('\n      '));
    else console.log(`ok    a malformed register log or recorder name is read as none — ${CORRUPT.length} cases boot and record`);
  }

  /* 8 — the record drawer's fields have names, and its times are the
         reader's. The five labels stood beside inputs with no id; the history
         and "Recorded" printed the stored UTC minute with no zone. */
  {
    await send('Page.navigate', { url: `${BASE}/property/comparables` }, sessionId);
    await sleep(2500);
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kuching' }, sessionId);
    const r = JSON.parse(await evaluate(`(async () => {
      const rec = addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 420000, date:'2026-05-01', evidence:'user', sourceRef:'SPA 1' });
      /* A record keyed at 04:30 on the 28th, Kuching time — 20:30 on the 27th in UTC. */
      const k = State.observations.findIndex(x => x.id === rec.id);
      State.observations[k] = { ...State.observations[k], recordedAt: '2026-09-27 20:30' };
      render(); openObservationDrawer(State.observations[k]);
      await new Promise(res => setTimeout(res, 300));
      const box = document.getElementById('drawer') || document.querySelector('[role=dialog]');
      const fields = [...box.querySelectorAll('input, select, textarea')];
      const unnamed = fields.filter(n => !(n.labels && [...n.labels].some(l => l.textContent.trim())) && !n.getAttribute('aria-label')).length;
      const dts = [...box.querySelectorAll('dt')];
      const recorded = dts.find(d => d.textContent === 'Recorded')?.nextElementSibling?.textContent || '';
      const hist = registerEventText({ op: 'add', at: '2026-09-27T20:30:00.000Z' });
      closeDrawer();
      return JSON.stringify({ n: fields.length, unnamed, recorded, hist });
    })()`));
    await send('Emulation.setTimezoneOverride', { timezoneId: '' }, sessionId);
    await evaluate(`(() => { ['registerLog','observations'].forEach(x => localStorage.removeItem('vl.' + x)); return true; })()`);
    if (!r.n || r.unnamed) fail(`${r.unnamed} of ${r.n} fields in the record drawer have no accessible name`, r);
    else if (!/^2026-09-28 04:30 UTC\+08:00/.test(r.recorded) || !/^2026-09-28 04:30 UTC\+08:00/.test(r.hist))
      fail('the record drawer prints a UTC time with no zone, not the reader\'s clock', r);
    else console.log(`ok    the record drawer names all ${r.n} fields and states its times on the reader's clock`);
  }
  /* 9 — the area screen's legend is the colour each value is drawn in. With
         one area recorded, the point took the middle step and the legend
         showed both ends of the ramp, each labelled with that one value. */
  {
    await send('Page.navigate', { url: `${BASE}/property/areas` }, sessionId);
    await sleep(2500);
    const r = JSON.parse(await evaluate(`(async () => {
      setAreaAttr('kuching', 'Tabuan', 'lease', { value: 70, class: '', source: 'unstated', asOf: '', ref: '' });
      State.areaScreen = { ...State.areaScreen, city: 'kuching', layer: 'lease' }; render();
      await new Promise(res => setTimeout(res, 300));
      const layer = LAYER_BY_ID.lease;
      const drawn = layerColour(layer, layerBands(layer, 'kuching', Object.keys(sarawakGeo?.cities?.kuching?.areas || {})), 70);
      const legend = [...document.querySelectorAll('main .card .caption')].filter(c => /here\\)/.test(c.textContent))
        .map(c => ({ text: c.textContent, fill: c.firstElementChild?.style.background || '' }));
      ['registerLog', 'areaProfiles'].forEach(x => localStorage.removeItem('vl.' + x));
      return JSON.stringify({ drawn, legend });
    })()`));
    if (!r.drawn || !r.legend.length || r.legend.some(x => x.fill !== r.drawn))
      fail('the area screen legend shows a colour no recorded area is drawn in', r);
    else console.log(`ok    the area screen legend is the colour the one recorded value is drawn in — ${r.drawn}`);
  }
  /* 10 — the comparables register's standing tiles add up to its count. A
          worked-example row has a standing of its own and had no tile, so
          with the example loaded "17 records" sat over tiles totalling 1. */
  {
    await send('Page.navigate', { url: `${BASE}/property/comparables` }, sessionId);
    await sleep(2500);
    const r = JSON.parse(await evaluate(`(async () => {
      seedWorkedExample();
      addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 1, date:'2026-05-01', evidence:'user', sourceRef:'x' });
      render(); await new Promise(res => setTimeout(res, 300));
      const card = [...document.querySelectorAll('main .card')].find(c => /^\\d+ records?$/.test(c.querySelector('h3')?.textContent || ''));
      const n = parseInt(card?.querySelector('h3')?.textContent, 10);
      const sum = [...(card?.querySelectorAll('.panel') || [])].reduce((a, p) => a + (parseInt(p.textContent.replace(/^\\D+/, ''), 10) || 0), 0);
      clearWorkedExample(); State.observations = []; saveObservations();
      ['registerLog', 'observations', 'areaProfiles'].forEach(x => localStorage.removeItem('vl.' + x));
      return JSON.stringify({ n, sum });
    })()`));
    if (!r.n || r.sum !== r.n) fail(`the comparables register counts ${r.n} records over standing tiles totalling ${r.sum}`, r);
    else console.log(`ok    the comparables register's standing tiles add up to its ${r.n} records`);
  }
  /* 11 — a second tab's events do not share this tab's sequence numbers. The
          counter was read once at boot; another tab writing the same key in
          the meantime was handed the same numbers, and undo — which marks a
          number reversed — then passed over one of the pair for good. */
  {
    const r = JSON.parse(await evaluate(`(() => {
      ['registerLog', 'observations'].forEach(x => localStorage.removeItem('vl.' + x));
      State.observations = []; loadRegisterLog();
      const a = addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 1, date:'2026-05-01', evidence:'user' });
      /* What another tab, open since before a was recorded, writes next. */
      const other = { seq: registerLog().length + 1, at: new Date().toISOString(), actor: null, entity: 'observation', op: 'add',
        id: 'obs-other-tab', after: { id: 'obs-other-tab', city: 'kuching', area: 'Tabuan', kind: 'sold-price', value: 2, date: '2026-05-02' } };
      localStorage.setItem('vl.registerLog', JSON.stringify([...registerLog(), other]));
      addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 3, date:'2026-05-03', evidence:'user' });
      const seqs = registerLog().map(e => e.seq);
      undoLastRegisterChange();
      const reachable = lastUndoableEvent()?.id || null;
      ['registerLog', 'observations'].forEach(x => localStorage.removeItem('vl.' + x));
      State.observations = []; loadRegisterLog();
      return JSON.stringify({ seqs, reachable, a: a.id });
    })()`));
    if (new Set(r.seqs).size !== r.seqs.length) fail('two events in the register log share a sequence number', r);
    else if (r.reachable !== 'obs-other-tab') fail('undo passes over an event another tab wrote', r);
    else console.log(`ok    events from a second tab keep their own sequence — ${r.seqs.join(', ')} — and undo still reaches them`);
  }
  /* 12 — the keyboard keeps its place on the area screen and the register.
          Record, a layer, and Undo each redrew the page and dropped focus on
          <body>, so a keyboard reader who opened a locality's recorder had
          to Tab from the top of the page to reach it. */
  {
    const press = async () => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
      await sleep(300);
    };
    const at = () => evaluate(`document.activeElement?.id || document.activeElement?.tagName || null`);
    const out = {};
    await send('Page.navigate', { url: `${BASE}/property/areas` }, sessionId);
    await sleep(2500);
    await evaluate(`(() => { [...document.querySelectorAll('main table button')].find(b => b.textContent === 'Record').focus(); return true; })()`);
    await press(); out.record = await at();
    await evaluate(`(() => { document.querySelectorAll('main .segmented button')[1].focus(); return true; })()`);
    await press(); out.layer = await at();
    await send('Page.navigate', { url: `${BASE}/property/comparables` }, sessionId);
    await sleep(2500);
    await evaluate(`(() => { addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 1, date:'2026-05-01', evidence:'user' });
      addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 2, date:'2026-05-02', evidence:'user' }); render();
      [...document.querySelectorAll('main button')].find(b => b.textContent === 'Undo last change').focus(); return true; })()`);
    await press(); out.undo = await at();
    await evaluate(`(() => { ['registerLog', 'observations'].forEach(x => localStorage.removeItem('vl.' + x)); State.observations = []; return true; })()`);
    const lost = [];
    if (!/^area-rec-/.test(out.record)) lost.push(`Record → ${out.record}`);
    if (!/^af-layer-/.test(out.layer)) lost.push(`a layer → ${out.layer}`);
    if (out.undo !== 'register-undo' && out.undo !== 'registerActorInput') lost.push(`Undo → ${out.undo}`);
    if (lost.length) fail('focus falls out of the page on the area screen or the register', lost.join('; '));
    else console.log(`ok    focus stays on the control pressed — Record, a layer, Undo (${out.record}, ${out.layer}, ${out.undo})`);
  }
  /* 13 — the comparables table keeps its words whole and fits its card at
          1440px. .caption breaks anywhere, which let the prose columns shrink
          to a letter's width: the table read "Transa / cted / land / price"
          and "docume / nt exists", and still ran 12px past its wrapper, over
          the Open button. */
  {
    await send('Page.navigate', { url: `${BASE}/property/comparables` }, sessionId);
    await sleep(2500);
    const r = JSON.parse(await evaluate(`(async () => {
      seedWorkedExample(); render(); await new Promise(res => setTimeout(res, 300));
      const t = [...document.querySelectorAll('main table.dt')].find(x => /Standing/.test(x.querySelector('thead')?.textContent || ''));
      const ctx = document.createElement('canvas').getContext('2d');
      const broken = [];
      for (const td of t.querySelectorAll('td.caption')) {
        const cs = getComputedStyle(td);
        ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const room = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const w = td.textContent.split(/\\s+/).filter(Boolean).find(x => ctx.measureText(x).width > room + 1);
        if (w) broken.push(w);
      }
      /* Whether the table fits its card depends on the reader's fonts: it
         filled 1440px exactly with Inter and ran 142px past it on Linux, where
         CI runs. What must hold everywhere is that the Open buttons, the
         control each row exists for, stay in view: as the page draws, and
         with the text widened past the card (letter-spacing), which a wider
         font does on another machine. */
      const openOut = () => {
        const wr = t.parentElement.getBoundingClientRect();
        return [...t.querySelectorAll('tbody button')].filter(bt => bt.textContent.trim() === 'Open')
          .filter(bt => { const q = bt.getBoundingClientRect(); return q.right > wr.right + 1 || q.left < wr.left - 1; }).length;
      };
      const fit = { table: Math.round(t.getBoundingClientRect().width), wrap: t.parentElement.clientWidth, hidden: openOut() };
      const widen = document.createElement('style');
      widen.textContent = 'table.dt.register-dt { letter-spacing: .12em; }';
      document.head.append(widen);
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      t.parentElement.scrollLeft = 0;
      const wide = { table: Math.round(t.getBoundingClientRect().width), wrap: t.parentElement.clientWidth, hidden: openOut() };
      widen.remove();
      /* A locality's recorded transactions, the same words in the same kind
         of cell, on the area screen. */
      navigate('/property/areas'); State.areaScreen = { ...State.areaScreen, city: 'kuching', editing: 'Tabuan' }; render();
      await new Promise(res => setTimeout(res, 300));
      const lt = [...document.querySelectorAll('main table.dt')].find(x => /Licence/.test(x.querySelector('thead')?.textContent || ''));
      for (const td of lt ? lt.querySelectorAll('td.caption') : []) {
        const cs = getComputedStyle(td);
        ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        const room = td.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const w = td.textContent.split(/\\s+/).filter(Boolean).find(x => ctx.measureText(x).width > room + 1);
        if (w) broken.push('transactions: ' + w);
      }
      State.areaScreen.editing = null;
      clearWorkedExample(); ['registerLog', 'observations', 'areaProfiles'].forEach(x => localStorage.removeItem('vl.' + x));
      return JSON.stringify({ broken: [...new Set(broken)].slice(0, 6), transactions: !!lt, ...fit, wide });
    })()`));
    if (!r.transactions) fail('the recorded-transactions table did not render for the worked example', r);
    else if (r.broken.length) fail('a register table breaks words mid-word at 1440px', r);
    else if (r.hidden) fail(`${r.hidden} Open button(s) of the comparables register are out of view at 1440px`, r);
    else if (!(r.wide.table > r.wide.wrap)) fail('widening the text did not push the comparables table past its card, so the pinned column went untested', r.wide);
    else if (r.wide.hidden) fail(`with the text wider than the card (${r.wide.table}/${r.wide.wrap}px), ${r.wide.hidden} Open button(s) scrolled out of view`, r.wide);
    else console.log(`ok    the register tables keep their words whole, and every Open button stays in view at 1440px — as drawn (${r.table}/${r.wrap}px) and with the text wider than the card (${r.wide.table}/${r.wide.wrap}px)`);
  }
  /* ---- end bugfix: grade-area-registers ---- */

  /* ---- bugfix3: property ---- */
  /* R1 — two tabs keep each other's records. Every projection was read once
          at boot and saved whole, so with the calculator in one tab and the
          comparables in another, a record added in the first was written
          away by the next save in the second: the log held both events, the
          register held one, and it reported that its history did not account
          for its records. The same for area attributes, demand sources,
          Sarawak exposures and unlocked reports. Two real tabs of one
          browser, so the browser's own storage event is what is tested. */
  {
    const { result: { targetId: tidB } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId: sidB } } = await send('Target.attachToTarget', { targetId: tidB, flatten: true });
    await send('Runtime.enable', {}, sidB);
    await send('Page.enable', {}, sidB);
    const evalB = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sidB);
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluation threw in the second tab');
      return r.result.result.value;
    };
    const KEYS = `['registerLog','observations','areaProfiles','demand','sarawakExposure','propertyReportsBought']`;
    await evaluate(`(() => { ${KEYS}.forEach(k => localStorage.removeItem('vl.' + k));
      State.observations = []; State.areaProfiles = {}; State.demand = {}; State.sarawakExposure = []; State.propertyReportsBought = [];
      loadRegisterLog(); navigate('/property/calculator'); return true; })()`);
    /* The second tab opens now — after the first, before either records. */
    await send('Page.navigate', { url: `${BASE}/property/comparables` }, sidB);
    await sleep(3500);
    await evaluate(`(() => { addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 111, date:'2026-05-01', evidence:'user', sourceRef:'tab A' });
      setAreaAttr('kuching', 'Tabuan', 'flood', { class: 'occasional', source: 'site', asOf: '2026-05-01' });
      setDemand('kuching', 'Tabuan', 'employment', { state: 'operating', asOf: '2026-05-01' });
      State.propertyReportsBought = [...State.propertyReportsBought, 'proj-A']; store.write('propertyReportsBought', State.propertyReportsBought);
      return true; })()`);
    await sleep(300);
    await evalB(`(() => { addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 222, date:'2026-05-02', evidence:'user', sourceRef:'tab B' });
      setAreaAttr('kuching', 'Stutong', 'flood', { class: 'occasional', source: 'site', asOf: '2026-05-02' });
      setDemand('kuching', 'Stutong', 'employment', { state: 'operating', asOf: '2026-05-02' });
      State.propertyReportsBought = [...State.propertyReportsBought, 'proj-B']; store.write('propertyReportsBought', State.propertyReportsBought);
      return true; })()`);
    await sleep(300);
    /* Sarawak exposures through the page's own controls: Add in each tab,
       then an edit in the first tab to the record it drew before the second
       tab's Add — the object it holds is no longer the one in the list. */
    await evaluate(`(() => { navigate('/discover/sarawak'); return true; })()`);
    await evalB(`(() => { navigate('/discover/sarawak'); return true; })()`);
    await sleep(500);
    const addWith = (idx) => `(() => { const s = document.querySelector('main select[aria-label="Company"]'); s.selectedIndex = ${idx}; s.dispatchEvent(new Event('change', { bubbles: true }));
      [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === 'Add').click(); return true; })()`;
    await evaluate(addWith(0));
    await sleep(300);
    await evalB(addWith(1));
    await sleep(300);
    await evaluate(`(() => { const d = document.querySelector('main details'); d.open = true;
      const ta = d.querySelector('textarea[aria-label]'); ta.value = 'edited in tab A'; ta.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await sleep(300);
    await send('Page.reload', {}, sidB);
    await sleep(3500);
    const r = JSON.parse(await evalB(`JSON.stringify({ obs: State.observations.map(o => o.sourceRef).sort(), areas: Object.keys(State.areaProfiles).sort(),
      demand: Object.keys(State.demand).sort(), integrity: registerIntegrity().state, bought: [...State.propertyReportsBought].sort(),
      exposures: State.sarawakExposure.length, edited: State.sarawakExposure.some(x => Object.values(x).concat(Object.values(x.fields || {})).includes('edited in tab A')) })`));
    await evaluate(`(() => { ${KEYS}.forEach(k => localStorage.removeItem('vl.' + k));
      State.observations = []; State.areaProfiles = {}; State.demand = {}; State.sarawakExposure = []; State.propertyReportsBought = [];
      loadRegisterLog(); return true; })()`);
    await send('Target.closeTarget', { targetId: tidB });
    const lost = [];
    if (r.obs.join() !== 'tab A,tab B') lost.push(`comparables ${r.obs.join(', ')}`);
    if (r.areas.join() !== 'kuching|Stutong,kuching|Tabuan') lost.push(`area attributes ${r.areas.join(', ')}`);
    if (r.demand.join() !== 'kuching|Stutong,kuching|Tabuan') lost.push(`demand ${r.demand.join(', ')}`);
    if (r.integrity !== 'ok') lost.push(`register integrity ${r.integrity}`);
    if (r.bought.join() !== 'proj-A,proj-B') lost.push(`unlocked reports ${r.bought.join(', ')}`);
    if (r.exposures !== 2 || !r.edited) lost.push(`Sarawak exposures ${r.exposures}, the first tab's edit ${r.edited ? 'kept' : 'lost'}`);
    if (lost.length) fail('a second tab writes away what the first recorded', lost.join('; '));
    else console.log('ok    two tabs keep each other\'s records — comparables, area attributes, demand, unlocked reports and Sarawak exposures, an edit to a record drawn before the other tab\'s Add included; the register\'s history accounts for both');
  }
  /* ---- end bugfix3: property ---- */

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
  /* Chrome holds its profile for a moment after the kill, and its child
     processes a moment longer. Removed at once, the rm failed quietly on
     Windows, and every run left its profile in TEMP: 1,781 of them, 14 GB,
     had filled C: by 28 September 2026 and parallel runs were failing with
     ENOSPC. Wait for the exit, then retry the removal. */
  await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}
