#!/usr/bin/env node
/* Horizontal-overflow check at the widths the project targets. A table that
   gained a column is the usual cause, and it does not throw — it just pushes
   the page sideways.

   IT HAS TO BE ABLE TO FAIL. For as long as this script existed it printed
   FAIL lines and exited 0, so the CI step named "no horizontal overflow at
   any width" could not go red whatever it measured. It also counted tap
   targets under the 44px floor and threw the count away. Overflow now sets
   the exit code; small targets are reported per route on phone widths so the
   number is at least seen. */
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
                '/methodology/ips',
                '/my/scanner', '/app/equities', '/app/watchlists',
                /* The front door, the discover hub and two company pages — one
                   filed, one illustrative — were never in this list, so the
                   widest tables on the site were the ones never measured. */
                '/', '/discover', '/company/MSFT-SEC', '/company/MAYBANK',
                /* The other three discover tabs. The strategy cards ran 5px
                   past a 390px screen and 35px past 360 — a member row of
                   ticker, sparkline, price and model difference that could
                   not shrink — and no route here ever opened them. */
                '/discover?tab=ideas', '/discover?tab=heatmap', '/discover/value-map',
                /* The illustrative Filings tab: its "sample list" chip carried a
                   whole sentence, did not wrap, and ran 61px past 390. Only the
                   default tab of a company page was measured above. */
                '/company/MAYBANK?tab=filings'];

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
/* CDP_PORT pins the debugging port, so harnesses run side by side (several
   worktrees, or CI jobs on one runner) cannot land on the same Chrome. */
const port = Number(process.env.CDP_PORT) || 9600 + (process.pid % 150);
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
const smallTargets = [];
/* Routes whose widest tables only exist once the filed set has loaded. A
   fixed wait measured the boot skeleton on a slow runner — no tables, no
   overflow, a pass for the pages this check was extended to cover. */
const DATA_ROUTES = /^\/(company\/|discover|research|compare|$)/;
try {
for (const w of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride',
    { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
  for (const route of ROUTES) {
    /* A route that did not load cannot be overflow-free. With nothing served,
       Chrome's error page measured as zero overflow and every route passed. */
    const nav = await send('Page.navigate', { url: BASE + route }, sessionId);
    if (nav.result?.errorText || nav.error) {
      bad++; console.log(`FAIL ${w}px ${route} — did not load: ${nav.result?.errorText || nav.error?.message}`); continue;
    }
    await sleep(1500);
    if (DATA_ROUTES.test(route)) {
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        const p = await send('Runtime.evaluate', { returnByValue: true, expression:
          `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
        ready = p.result?.result?.value === true;
        if (!ready) await sleep(500);
      }
      if (!ready) { bad++; console.log(`FAIL ${w}px ${route} — the filed set never arrived, so the page measured would be the skeleton`); continue; }
      await sleep(300);
    }
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
      /* Tap targets below the 44px floor, on either axis — the count, and
         enough of the first two to find them. A count alone was reported
         once and told nobody which control to look at; and the filter said
         40px tall while the comments and CLAUDE.md said 44 square. */
      const smallEls = [...document.querySelectorAll('button,a.btn,select')].filter(n => {
        const b = n.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && Math.min(b.width, b.height) < 44;
      });
      const smallWho = smallEls.slice(0, 2).map(n => n.tagName.toLowerCase()
        + (n.className ? '.' + String(n.className).split(' ')[0] : '')
        + ' ' + Math.round(n.getBoundingClientRect().width) + '×' + Math.round(n.getBoundingClientRect().height) + 'px'
        + (n.textContent.trim() ? ' “' + n.textContent.trim().slice(0, 24) + '”' : ''));
      return { over, culprits, small: smallEls.length, smallWho };
    })()` }, sessionId);
    /* A probe that errored or returned nothing is not a clean page. `|| {}`
       made every such route pass: `undefined > 2` is false. */
    if (r.error || r.result?.exceptionDetails || !r.result?.result || typeof r.result.result.value?.over !== 'number') {
      bad++; console.log(`FAIL ${w}px ${route} — the page could not be measured: ${r.error?.message || r.result?.exceptionDetails?.text || 'no result'}`); continue;
    }
    const v = r.result.result.value;
    /* The 44px floor applies on a coarse pointer, which the stylesheet ties to
       widths under 768. Reported, not failed: a count is a lead, and the
       elements behind it need looking at before a rule is written. */
    if (w < 768 && v.small > 0) smallTargets.push({ w, route, n: v.small, who: v.smallWho || [] });
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
} catch (e) {
  /* An exception mid-loop is a failed run, and the browser must still die. */
  bad++; console.log(`FAIL harness error — ${e.message}`);
} finally {
  try { ws.close(); } catch { /* closed */ }
  proc.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log(bad ? `\n${bad} genuine overflow issues` : '\nno horizontal overflow at any width');
if (smallTargets.length) {
  console.log('\ntap targets under 44px on either axis, on phone widths (reported, not failed):');
  smallTargets.sort((a, b) => b.n - a.n).slice(0, 12)
    .forEach(s => console.log(`  ${s.w}px ${s.route} — ${s.n}${s.who.length ? ': ' + s.who.join('; ') : ''}`));
  if (smallTargets.length > 12) console.log(`  … and ${smallTargets.length - 12} more route/width pairs`);
}
process.exitCode = bad ? 1 : 0;
