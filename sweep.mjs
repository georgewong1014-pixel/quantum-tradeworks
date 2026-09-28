#!/usr/bin/env node
/* Loads every route in one browser and reports console errors, page exceptions
   and failed requests per route. One browser, many navigations — the previous
   per-route spawn cost 20s each. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8123';
const ROUTES = [
  '/', '/app', '/welcome', '/discover', '/discover/screener', '/discover/value-map',
  /* The two discover tabs with no path of their own. */
  '/discover?tab=ideas', '/discover?tab=heatmap',
  '/research', '/company/aapl-apple-inc',
  /* An SEC-filed company with no price — the normal state for 119 of the 138,
     and the case that was never exercised while the filings sat behind a flag. */
  '/company/abbv-abbvie-inc', '/company/1155-malayan-banking-berhad',
  /* One valuation page per model pack the engine now refuses or reshapes: a
     filed insurer with no combined ratio, a holding company whose primary sits
     on row 1, an early-stage company with no price, a filer whose shipped debt
     is withheld, and one whose starting cash flow is negative. */
  '/company/UNH-SEC?tab=valuation', '/company/SIME?tab=valuation', '/company/RIVN-SEC?tab=valuation',
  '/company/SAPNRG?tab=valuation', '/company/APD-SEC?tab=valuation', '/company/DUK-SEC?tab=valuation', '/company/O-SEC?tab=quality',
  /* The statements explorer on a filer with absent lines and on a bank, whose
     table drops the cash-flow lines that mean nothing for it. */
  '/company/ABT-SEC?tab=financials', '/company/F-SEC?tab=financials', '/company/MAYBANK?tab=financials',
  '/start',
  '/compare', '/my/portfolio', '/my/watchlists', '/my/data',
  '/my/theses', '/my/alerts', '/my/tracked', '/my/scanner',
  /* The Phase 2 brief's paths, as aliases: a symbol, an old id form and a
     tab name that is not ours. */
  '/app/equities', '/app/equities/explore', '/app/equities/aapl/financials', '/app/equities/1155/ratios',
  '/app/equities/compare', '/app/watchlists', '/equities/methodology',
  /* The brief's two remaining tab names, and the valuation tab that now
     carries a feature-flag notice from the capability register. */
  '/app/equities/msft/source-data', '/app/equities/msft/statements', '/app/equities/aapl/valuation',
  '/discover/sarawak', '/property',
  '/property/calculator', '/property/opportunities', '/property/comparables', '/property/areas', '/us-options/wheel', '/property/calculator?city=sibu',
  '/research/trading-index', '/learn/trading-index', '/trading-index',
  '/wheel', '/cash-wheel', '/options', '/my/wheel', '/my/options',
  '/property/calculator?city=miri&district=lutong&type=shophouse',
  '/property/calculator?city=bintulu', '/learn', '/learn/glossary', '/methodology',
  '/data-sources', '/corrections', '/status', '/learn/product-boundaries', '/pricing', '/about', '/contact', '/privacy', '/terms',
  '/decision-record', '/methodology/ips',
  /* Phase 2 batch F: the research report (filed, illustrative, the brief's
     alias), the workspace and its alias, and a comparison mixing periods,
     bases and a synthetic company. */
  '/company/aapl-apple-inc/report', '/company/1155-malayan-banking-berhad/report', '/app/equities/msft/report',
  '/my/workspace', '/app/workspace', '/compare?companies=MSFT-SEC,AAPL-SEC,MAYBANK',
  /* A town with no coordinates, which now has the recorder; and a link that
     carries a checklist answer, an over-long hold and a loan with no tenure. */
  '/property/calculator?city=bau',
  '/property/calculator?type=land&d=holdYears:40~tenureYears:0~check.flood:yes~checkev.flood:verified',
  /* Phase 3 — user: the reader's scanner pages, an unknown setup and an
     unknown alert (each a "not in your record" card, never the not-found
     page), the builder opened from a company page, and the old address
     with a symbol. */
  '/app/scanner/setups', '/app/scanner/setups/new', '/app/scanner/setups/new?symbol=MSFT', '/app/scanner/setups/no-such-setup',
  '/app/scanner/setups/no-such-setup/edit', '/app/scanner/watchlists', '/app/scanner/alerts', '/app/scanner/alerts/a00000000',
  '/app/scanner/settings', '/my/scanner?symbol=MSFT',
  /* Phase 3 — the scanner (ops): the dashboard, the two P1 surfaces, the four
     operations pages, and the old address with the company page's ?symbol=. */
  '/app/scanner', '/app/scanner/market', '/app/scanner/backtest',
  '/admin/scanner', '/admin/scanner/data', '/admin/scanner/jobs', '/admin/scanner/delivery',
  /* Phase 3 round 3 — the builder's deep links (contract C5), as the market
     screen and an alert page send them: a market with a setup to copy,
     an unknown setup, and an alert that is not in the record. Each must
     open the builder, never throw or fall to the not-found page. */
  '/app/scanner/setups/new?market=US&from=trend-breakout', '/app/scanner/setups/new?from=no-such-setup',
  '/app/scanner/setups/new?fromAlert=a00000000',
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
const CI_FLAGS = process.env.CI
  ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  : [];

const bin = CANDIDATES.find(existsSync);
if (!bin) { console.error('no Chrome or Edge found'); process.exit(1); }

const profile = join(tmpdir(), `cdp-sweep-${process.pid}`);
/* CDP_PORT pins the debugging port, so harnesses run side by side (several
   worktrees, or CI jobs on one runner) cannot land on the same Chrome. */
const port = Number(process.env.CDP_PORT) || 9800 + (process.pid % 150);
const proc = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-gpu', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });

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
/* AN EXPLICIT VIEWPORT, BECAUSE THE DEFAULT IS NOT THE SAME EVERYWHERE.
   This ran clean on a developer's machine and failed on a runner, on a real
   layout defect, purely because the two headless windows are different sizes.
   A check whose result depends on the machine is not a check. 1280 is pinned
   here; mobile.mjs is what covers 360 through 1440. */
await send('Emulation.setDeviceMetricsOverride',
  { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
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
/* Chrome holds its profile for a moment after the kill, and its child
   processes a moment longer. Removed at once, the rm failed quietly on
   Windows, and every run left its profile in TEMP: 1,781 of them, 14 GB,
   had filled C: by 28 September 2026 and parallel runs were failing with
   ENOSPC. Wait for the exit, then retry the removal. */
await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
process.exit(bad ? 1 : 0);
