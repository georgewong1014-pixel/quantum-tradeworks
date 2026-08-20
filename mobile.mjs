#!/usr/bin/env node
/* Horizontal-overflow check at the widths the project targets. A table that
   gained a column is the usual cause, and it does not throw — it just pushes
   the page sideways. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* :3000 serves a DIFFERENT project on this machine. Defaulting to it meant a
   run with no argument silently tested the wrong site and reported a clean
   pass. The default is now the port this project is actually served on. */
const BASE = process.argv[2] || 'http://localhost:8123';
const WIDTHS = [360, 390, 430, 768, 1024, 1440];
const ROUTES = ['/my/theses', '/discover/screener', '/property/calculator?city=sibu',
                '/property/calculator?city=kuching', '/pricing', '/learn/glossary', '/app',
                '/my/data', '/discover/sarawak', '/research/trading-index', '/us-options/wheel',
                /* Added after the decision record shipped 186px of overflow at 390:
                   four columns of nowrap text in a bare div rather than a
                   .tablewrap. Nothing else in the suite looks below 1440. */
                '/decision-record', '/property/comparables', '/property/areas', '/start',
                '/methodology/ips'];

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
if (!bin) { console.error('no Chrome or Edge found — set CHROME_PATH'); process.exit(1); }
const profile = join(tmpdir(), `cdp-mob-${process.pid}`);
const port = 9600 + (process.pid % 150);
const proc = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--disable-gpu', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try { const j = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {}
    await sleep(250);
  }
  throw new Error('devtools never came up');
}
const ws = new WebSocket(await wsUrl());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise(res => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);

let bad = 0;
for (const w of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride',
    { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
  for (const route of ROUTES) {
    await send('Page.navigate', { url: BASE + route }, sessionId);
    await sleep(2200);
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{
      const de = document.documentElement;
      const over = de.scrollWidth - window.innerWidth;
      /* Elements wider than the viewport that are not inside a scroll container
         are the ones that actually break the layout. */
      const culprits = [...document.querySelectorAll('body *')].filter(n => {
        if (n.getBoundingClientRect().width <= window.innerWidth + 1) return false;
        for (let p = n.parentElement; p; p = p.parentElement) {
          const ov = getComputedStyle(p).overflowX;
          /* 'hidden' is NOT containment — it clips, so the content is simply
             unreachable, which is a worse outcome than a scrollbar rather than
             an acceptable one. Only a scrollable ancestor excuses a wide child. */
          if (ov === 'auto' || ov === 'scroll') return false;
        }
        return true;
      }).slice(0, 3).map(n => n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ')[0] : ''));
      /* Tap targets below the 44px floor. */
      const small = [...document.querySelectorAll('button,a.btn,select')].filter(n => {
        const b = n.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.height < 40;
      }).length;
      return { over, culprits, small };
    })()` }, sessionId);
    const v = r.result?.result?.value || {};
    /* IF THE DOCUMENT SCROLLS SIDEWAYS, IT FAILS.
       The culprit list is a diagnosis, not a licence to downgrade: this reported
       "330px, all inside scroll containers" for a layer picker that was pushing
       the page sideways at 1024px with nothing scrollable above it. A measurement
       that says the page overflows and a verdict that says it does not cannot
       both stand, and the measurement is the one that matches what a reader
       sees. */
    if (v.over > 2) {
      bad++;
      console.log(`FAIL ${w}px ${route} — overflow ${v.over}px`
        + (v.culprits.length ? ` via ${v.culprits.join(', ')}` : ' (no single element wider than the viewport — check a margin, a gap or a fixed width)'));
    }
  }
}
console.log(bad ? `\n${bad} genuine overflow issues` : '\nno horizontal overflow at any width');
ws.close(); proc.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});
