#!/usr/bin/env node
/**
 * Does any route ever state two different answers to the same question?
 *
 *   node coverage-frames.mjs                        check production
 *   node coverage-frames.mjs http://localhost:8123  check local
 *   node coverage-frames.mjs --verbose              print every observation
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * sweep.mjs loads each route, waits for it to settle and checks the result. It
 * reported 46/46 clean while the Build Status page — the one page whose entire
 * job is reporting what this build contains — spent its first 313ms stating:
 *
 *     "0 US companies with audited SEC filings, of 18 US listings held"
 *     "36 companies carry illustrative figures"
 *
 * and then replaced both with 119 of 120 and 19. Nothing threw. No value was
 * NaN. The final render was correct, so every check that looks at the settled
 * page passed. A human with a screen recorder found it.
 *
 * The bug is invisible to a test that waits, because waiting is the fix being
 * tested. So this samples from the first paint instead, and the assertion is
 * not "is the end state right" but:
 *
 *     ACROSS EVERY FRAME, A ROUTE MUST GIVE ONE ANSWER TO A QUESTION.
 *
 * That phrasing matters. It needs no expected values baked in, so it does not
 * go stale when the universe grows from 138 to 400 companies — it only fails
 * when the page contradicts itself, which is never legitimate. "Checking
 * coverage" is not an answer and is always allowed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const BASE = (args.find(a => a.startsWith('http')) || 'https://quantum-tradeworks.vercel.app').replace(/\/$/, '');
const VERBOSE = args.includes('--verbose');

/* The routes that state coverage. Build Status and Data Sources are the point;
   the others are here because the beta banner rides on every page. */
const ROUTES = ['/', '/status', '/data-sources', '/discover/screener', '/research', '/methodology', '/corrections'];

/* Each question the site answers with a number, and the regex that catches any
   answer to it. The capture group is the answer. A route may show one distinct
   answer per question, or none. */
const QUESTIONS = [
  { id: 'us-filed-of-listings', re: /(\d+)\s+US companies with audited SEC filings, of\s+(\d+)\s+US listings/i },
  { id: 'illustrative-count',   re: /(\d+)\s+companies carry illustrative figures/i },
  { id: 'banner-filed',         re: /(\d+)\s+compan(?:y carries|ies carry)\s+audited statements filed with the SEC/i },
  { id: 'banner-illustrative',  re: /\.\s*(\d+)\s+(?:carries|carry)\s+illustrative figures that are synthetic/i },
  { id: 'total-companies',      re: /(\d+)\s+companies:\s+\d+\s+are US-listed/i },
  { id: 'us-and-bursa',         re: /(\d+)\s+US companies and\s+(\d+)\s+Bursa companies/i },
  { id: 'search-placeholder',   re: /Search\s+(\d+)\s+companies/i },
];

const SAMPLE_MS = 40;      /* fine enough to catch a 313ms window many times */
const WINDOW_MS = 9000;    /* long enough for the audited set on a cold CDN */

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
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
if (!bin) { console.error('no Chrome or Edge found'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const profile = join(tmpdir(), `qt-frames-${process.pid}`);
const port = 9950 + (process.pid % 40);
const proc = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-gpu', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });

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

  console.log(`target  ${BASE}`);
  console.log(`method  sample every ${SAMPLE_MS}ms for ${WINDOW_MS / 1000}s from navigation`);
  console.log(`rule    one route, one answer per question — "${'Checking coverage'}" is not an answer\n`);

  /* Sampling runs INSIDE the page. Driving it from Node would put a round trip
     between frames and miss short-lived states — the very thing being hunted. */
  const collector = `(async () => {
    const Q = ${JSON.stringify(QUESTIONS.map(q => ({ id: q.id, src: q.re.source, flags: q.re.flags })))};
    const seen = {};      /* question id -> { answer -> first ms seen } */
    const t0 = performance.now();
    while (performance.now() - t0 < ${WINDOW_MS}) {
      const txt = document.body ? document.body.innerText : '';
      const ph = document.querySelector('#searchLabel');
      const hay = txt + '\\n' + (ph ? ph.textContent : '');
      for (const q of Q) {
        const m = hay.match(new RegExp(q.src, q.flags));
        if (!m) continue;
        const answer = m.slice(1).join('/');
        (seen[q.id] = seen[q.id] || {});
        if (!(answer in seen[q.id])) seen[q.id][answer] = Math.round(performance.now() - t0);
      }
      await new Promise(r => setTimeout(r, ${SAMPLE_MS}));
    }
    return JSON.stringify(seen);
  })()`;

  let failures = 0;
  for (const route of ROUTES) {
    await send('Page.navigate', { url: BASE + route }, sessionId);
    const r = await send('Runtime.evaluate',
      { expression: collector, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.result?.exceptionDetails) {
      console.log(`FAIL ${route.padEnd(22)} collector threw: ${r.result.exceptionDetails.exception?.description?.split('\n')[0]}`);
      failures++; continue;
    }
    const seen = JSON.parse(r.result.result.value);

    const contradictions = [];
    for (const [qid, answers] of Object.entries(seen)) {
      const distinct = Object.keys(answers);
      if (distinct.length > 1) contradictions.push({ qid, answers });
    }

    if (contradictions.length) {
      failures++;
      console.log(`FAIL ${route}`);
      contradictions.forEach(c => {
        const ordered = Object.entries(c.answers).sort((a, b) => a[1] - b[1]);
        console.log(`     ${c.qid}: answered ${ordered.length} different ways`);
        ordered.forEach(([ans, ms]) => console.log(`       +${String(ms).padStart(4)}ms  ${ans}`));
      });
    } else {
      const n = Object.keys(seen).length;
      console.log(`ok   ${route.padEnd(22)} ${n} coverage question${n === 1 ? '' : 's'}, one answer each`);
      if (VERBOSE) Object.entries(seen).forEach(([q, a]) =>
        console.log(`       ${q} = ${Object.keys(a)[0]}  (+${Object.values(a)[0]}ms)`));
    }
  }

  console.log(failures
    ? `\n${failures} route(s) contradicted themselves.`
    : `\n${ROUTES.length}/${ROUTES.length} routes state one answer per question, from the first frame.`);
  process.exitCode = failures ? 1 : 0;
} finally {
  try { ws?.close(); } catch { /* already gone */ }
  proc.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
