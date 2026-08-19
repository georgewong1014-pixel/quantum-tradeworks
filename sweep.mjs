#!/usr/bin/env node
/* Loads every route in one browser and reports console errors, page exceptions
   and failed requests per route. One browser, many navigations — the previous
   per-route spawn cost 20s each. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:3000';
const ROUTES = [
  '/', '/app', '/welcome', '/discover', '/discover/screener', '/discover/value-map',
  '/research', '/company/aapl-apple-inc',
  /* An SEC-filed company with no price — the normal state for 119 of the 138,
     and the case that was never exercised while the filings sat behind a flag. */
  '/company/abbv-abbvie-inc', '/company/1155-malayan-banking-berhad',
  '/start',
  '/compare', '/my/portfolio', '/my/watchlists', '/my/data',
  '/my/theses', '/my/alerts', '/my/tracked', '/discover/sarawak', '/property',
  '/property/calculator', '/property/opportunities', '/property/comparables', '/property/areas', '/us-options/wheel', '/property/calculator?city=sibu',
  '/research/trading-index', '/learn/trading-index', '/trading-index',
  '/wheel', '/cash-wheel', '/options', '/my/wheel', '/my/options',
  '/property/calculator?city=miri&district=lutong&type=shophouse',
  '/property/calculator?city=bintulu', '/learn', '/learn/glossary', '/methodology',
  '/data-sources', '/corrections', '/status', '/learn/product-boundaries', '/pricing', '/about', '/contact', '/privacy', '/terms',
  '/decision-record',
];

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
const bin = CANDIDATES.find(existsSync);
if (!bin) { console.error('no Chrome or Edge found'); process.exit(1); }

const profile = join(tmpdir(), `cdp-sweep-${process.pid}`);
const port = 9800 + (process.pid % 150);
const proc = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

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
let bucket = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown')
    bucket.push('EXCEPTION ' + String(m.params.exceptionDetails?.exception?.description
      || m.params.exceptionDetails?.text).split('\n')[0]);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    bucket.push('CONSOLE ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160));
  if (m.method === 'Network.loadingFailed' && !/net::ERR_ABORTED/.test(m.params.errorText || ''))
    bucket.push('REQFAIL ' + m.params.errorText);
  if (m.method === 'Runtime.bindingCalled' && m.params.name === '__cspViolation')
    bucket.push('CSP ' + m.params.payload);
});
const send = (method, params = {}, sessionId) => new Promise(res => {
  const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params, sessionId }));
});

const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
/* A Content-Security-Policy that blocks the app's own inline script does not
   degrade — it renders nothing, on every route, with one console line. The
   policy is generated from the build, so it CAN be wrong; this makes it loud. */
await send('Runtime.addBinding', { name: '__cspViolation' }, sessionId);
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: "document.addEventListener('securitypolicyviolation', e => " +
          "__cspViolation(e.violatedDirective + ' blocked ' + " +
          "String(e.blockedURI || e.sourceFile || 'inline').slice(0, 90)));",
}, sessionId);

let bad = 0;
for (const route of ROUTES) {
  bucket = [];
  await send('Page.navigate', { url: BASE + route }, sessionId);
  await sleep(2600);
  /* Text-level checks that no exception would catch. */
  const probe = await send('Runtime.evaluate', { returnByValue: true, expression: `(()=>{
    const t = document.body.innerText;
    const out = [];
    /* "the perpetuity is undefined" is correct prose, so a bare word match is a
       false positive. Only an undefined sitting where a value belongs counts. */
    if (/RM\\s*undefined|undefined\\s*%|:\\s*undefined\\b|undefined\\s*(bn|m|x)\\b|\\(undefined\\)/.test(t)) out.push('renders undefined as a value');
    if (/RM\\s*NaN|NaN\\s*%|:\\s*NaN\\b|\\bNaN\\b/.test(t)) out.push('renders NaN');
    if (/RMnull|null–null|\\[object Object\\]/.test(t)) out.push('renders a null or object literal');
    if (document.body.innerText.trim().length < 200) out.push('page is nearly empty');
    if (document.documentElement.scrollWidth > window.innerWidth + 2) out.push('horizontal overflow');
    return out;
  })()` }, sessionId);
  const textIssues = probe.result?.result?.value || [];
  const issues = [...bucket, ...textIssues];
  if (issues.length) { bad++; console.log(`FAIL ${route}`); issues.forEach(i => console.log('     ' + i)); }
  else console.log(`ok   ${route}`);
}
console.log(`\n${ROUTES.length - bad}/${ROUTES.length} routes clean`);

ws.close(); proc.kill();
await rm(profile, { recursive: true, force: true }).catch(() => {});
process.exit(bad ? 1 : 0);
