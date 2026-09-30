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
  /* Release A: how each product works, and the Equities research queue. */
  '/how-it-works', '/research/queue',
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
/* ---- audit: serving ---- */
/* THE HEAD AN ADDRESS IS SERVED IS THE HEAD ITS PAGE SETS. The router writes
   the title, the description and the canonical once its script runs; a link
   preview and a crawler read the HTML before it does, and until build.mjs
   wrote a page per route every address was served the homepage's. Each
   address without a parameter — the page's own ROUTES, read from the page —
   is fetched raw, as a preview fetches it, then opened here, and the two
   must agree. served-check.mjs holds the served head to the router's code
   evaluated offline; this holds it to the router running in a browser, so
   the two cannot share a mistake. An unknown address is served 404 and the
   app still draws its not-found card on it; a parameter route is the app,
   served 200. */
{
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const tagIn = (html, re) => { const m = html.slice(0, html.indexOf('</head>')).match(re); return m ? decode(m[1]) : null; };
  const served = async (path) => {
    const r = await fetch(BASE + path, { redirect: 'manual' });
    const html = await r.text();
    return { status: r.status, title: tagIn(html, /<title>([^<]*)<\/title>/),
      description: tagIn(html, /<meta name="description" content="([^"]*)">/),
      canonical: tagIn(html, /<link rel="canonical" href="([^"]*)">/),
      ogUrl: tagIn(html, /<meta property="og:url" content="([^"]*)">/),
      robots: tagIn(html, /<meta name="robots" content="([^"]*)">/) };
  };
  const evalValue = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, expression }, sessionId)).result?.result?.value;
  /* Opened fresh, and read once the router has run: the old document is
     marked so it cannot be mistaken for the new one. */
  const open = async (path) => {
    await evalValue('window.__servingMark = 1');
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 100; i++) {
      if (await evalValue(`!window.__servingMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view`)) break;
      await sleep(100);
    }
    return evalValue(`({ view: State.view, title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      main: (document.querySelector('main')?.innerText || '').slice(0, 400) })`);
  };
  const at = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return String(u); } };
  const problems = [];
  const statics = await evalValue(`[...new Set(ROUTES.filter(r => !r.path.includes(':')).map(r => r.path))].filter(p => matchRoute(p).path === p)`) || [];
  if (statics.length < 40) problems.push(`only ${statics.length} addresses without a parameter read from the page's ROUTES`);
  for (const path of statics) {
    const s = await served(path);
    const c = await open(path);
    if (s.status !== 200) { problems.push(`${path}: served ${s.status}`); continue; }
    if (!c || c.view === 'notfound') { problems.push(`${path}: the page did not open (${c && c.view})`); continue; }
    if (s.title !== c.title) problems.push(`${path}: served title ${JSON.stringify(s.title)}, the page sets ${JSON.stringify(c.title)}`);
    if (s.description !== c.description) problems.push(`${path}: served description ${JSON.stringify((s.description || '').slice(0, 60))}…, the page sets ${JSON.stringify((c.description || '').slice(0, 60))}…`);
    if (at(s.canonical) !== at(c.canonical)) problems.push(`${path}: served canonical ${s.canonical}, the page sets ${c.canonical}`);
    if (s.ogUrl !== s.canonical) problems.push(`${path}: og:url ${s.ogUrl} is not the canonical ${s.canonical}`);
    if (s.robots) problems.push(`${path}: served with robots ${s.robots}`);
  }
  for (const path of ['/nope-xyz', '/deep/unknown/address/for-the-sweep']) {
    const s = await served(path);
    const c = await open(path);
    if (s.status !== 404) problems.push(`${path}: served ${s.status}, not 404`);
    if (s.robots !== 'noindex') problems.push(`${path}: served with robots ${JSON.stringify(s.robots)}, not noindex`);
    if (!c || c.view !== 'notfound' || !/does not exist/i.test(c.main)) problems.push(`${path}: the not-found card is not drawn (${c && c.view}: ${JSON.stringify((c?.main || '').slice(0, 60))})`);
    else if (s.title !== c.title) problems.push(`${path}: served title ${JSON.stringify(s.title)}, the page sets ${JSON.stringify(c.title)}`);
  }
  const param = await served('/company/aapl-apple-inc');
  if (param.status !== 200) problems.push(`/company/aapl-apple-inc: served ${param.status}, not 200`);
  /* A trailing /index.html names its folder. Answered with the 404 page, the
     router took the folder for the app's own base and drew the homepage. */
  const folder = await open('/nope-folder/index.html');
  if (!folder || folder.view !== 'notfound' || !/does not exist/i.test(folder.main)) problems.push(`/nope-folder/index.html: ${folder && folder.view}, not the not-found card`);
  if (problems.length) { bad++; console.log(`FAIL serving: the head served is not the head the page sets`); problems.slice(0, 20).forEach(p => console.log('     ' + p)); }
  else console.log(`ok   serving: ${statics.length} addresses served the title, description and canonical their page sets; two unknown addresses 404 with the not-found card drawn, and an unknown folder's /index.html too; a company address 200`);
}
/* ---- end audit: serving ---- */

/* ---- audit: quality ---- */
/* THE FIRST LOAD AS PRODUCTION SERVES IT. The loop above counts exceptions
   and network errors, not a 404: a request the server answered is not a
   failed load to Chrome, so ten of them on every page went unseen — the
   personal-lane files (git-ignored, never deployed) and the Vercel Web
   Analytics tag (never switched on), each a failed request and a console
   error on every first load of the live site. Nor did anything measure the
   page moving under the reader: the footer, painted before the script ran,
   fell 1,500px when the page was drawn, a cumulative layout shift of 0.44
   to 1.2 where 0.1 is the most Lighthouse calls good.

   So each page is loaded cold, at a phone's width and a desktop's, from an
   address that is not the owner's machine (live.localhost reaches the same
   server; the app asks for the personal lane only on localhost, 127.0.0.1
   and ::1), and must make no request that fails, log no error, ask for no
   personal file, carry no analytics tag and shift by no more than 0.1. Then,
   on the owner's machine, the personal lane must still be asked for. */
{
  const u = new URL(BASE);
  const ownMachine = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  const live = ownMachine ? `${u.protocol}//live.localhost${u.port ? ':' + u.port : ''}` : BASE;
  const PERSONAL = /\/data\/(prices|personal-[a-z-]+|price-history|price-adjustments|scan-[a-z-]+|ingest-runs|sarawak-income|watchlists)\.json/;
  let seen = [], broken = [], logged = [];
  const aqListen = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === 'Network.requestWillBeSent') seen.push(m.params.request.url);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) broken.push(`${m.params.response.status} ${m.params.response.url}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) broken.push(`${m.params.errorText} ${m.params.requestId}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logged.push(`${m.params.entry.text} ${m.params.entry.url || ''}`.trim());
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logged.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 160));
    if (m.method === 'Runtime.exceptionThrown') logged.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text).split('\n')[0]);
  };
  ws.addEventListener('message', aqListen);
  await send('Log.enable', {}, sessionId);
  const PAGES = ['/', '/pricing', '/discover/screener', '/app', '/property/calculator', '/property/areas', '/app/scanner', '/admin/scanner'];
  const WIDTHS = [[1280, 900, false], [390, 844, true]];
  const aqBad = [];
  for (const [w, h, mobile] of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId);
    for (const p of PAGES) {
      seen = []; broken = []; logged = [];
      await send('Page.navigate', { url: live + p }, sessionId);
      await sleep(2600);
      const r = (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `new Promise(res => {
        const shifts = [];
        new PerformanceObserver(l => shifts.push(...l.getEntries())).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => res({ cls: shifts.reduce((s, e) => s + e.value, 0), host: location.hostname,
          analytics: document.querySelectorAll('script[src*="_vercel/insights"]').length,
          booted: typeof realPending !== 'undefined' && !realPending }), 150);
      })` }, sessionId)).result?.result?.value || {};
      const issues = [];
      if (!r.booted) issues.push('the page did not finish loading');
      if (broken.length) issues.push(`${broken.length} failed request(s): ${broken.slice(0, 4).join(', ')}`);
      if (logged.length) issues.push(`${logged.length} console error(s): ${logged.slice(0, 3).join(' | ')}`);
      const personal = seen.filter(x => PERSONAL.test(x));
      if (personal.length) issues.push(`asked for the personal lane: ${personal.slice(0, 4).join(', ')}`);
      if (r.analytics) issues.push('carries the analytics tag');
      if (!(r.cls <= 0.1)) issues.push(`cumulative layout shift ${Number(r.cls).toFixed(3)}`);
      if (issues.length) { aqBad.push(p); console.log(`FAIL first load ${r.host || live}${p} @${w}`); issues.forEach(i => console.log('     ' + i)); }
      else console.log(`ok   first load ${r.host}${p} @${w}: no failed request, no error, CLS ${r.cls.toFixed(3)}`);
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  /* The owner's machine keeps the personal lane exactly as it was: the same
     files are still asked for, present or absent. */
  if (ownMachine) {
    seen = [];
    await send('Page.navigate', { url: BASE + '/property/calculator' }, sessionId);
    await sleep(2600);
    const want = ['prices.json', 'price-history.json', 'scan-setups.json', 'scan-alerts.json', 'price-adjustments.json',
      'scan-runs.json', 'scan-control.json', 'scan-deliveries.json', 'ingest-runs.json', 'sarawak-income.json'];
    const missing = want.filter(f => !seen.some(x => new URL(x).pathname.endsWith('/data/' + f)));
    if (missing.length) { aqBad.push('owner lane'); console.log(`FAIL the owner's machine no longer asks for ${missing.join(', ')}`); }
    else console.log(`ok   the owner's machine (${u.hostname}) still asks for all ${want.length} personal-lane files`);
  }
  ws.removeEventListener('message', aqListen);
  console.log(aqBad.length ? `first load: ${aqBad.length} check(s) failed, counted with the routes below`
    : `first load: ${PAGES.length} pages at ${WIDTHS.length} widths clean on ${live}`);
  bad += aqBad.length;
}
/* ---- end audit: quality ---- */
/* ---- audit: verify ---- */
/* THE NOT-FOUND CARD SAYS NOINDEX WHEREVER IT IS DRAWN, AND AN ADDRESS THAT
   ONLY CONTAINS /index.html IS NOT THE APP'S FOLDER. Found verifying the
   three launch-audit branches together:
   - A parameter route is served the app with 200 whatever its parameter,
     so /company/no-such-name drew the not-found card on a page that told a
     crawler nothing — the soft 404 the audit found, still there on every
     company, report and scanner address. setDocumentMeta now writes noindex
     with the card and takes it off any page that is found, so a page reached
     in the app from the 404 does not keep the 404's noindex either.
   - BASE was taken from any address containing /index.html. The host answers
     /foo/index.html/bar with the 404 page, where the app took /foo for its
     folder and asked for /foo/data/us.json: a second 404, 3MB of not-found
     page, and a warning that the filings failed. */
{
  const evalValue = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId)).result?.result?.value;
  let seen = [];
  const listen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') seen.push(m.params.request.url); };
  ws.addEventListener('message', listen);
  /* Opened fresh, and read once the router has settled with the filings in
     (an unknown company is not called one until they land). */
  const open = async (path) => {
    await evalValue('window.__verifyMark = 1');
    seen = [];
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 150; i++) {
      if (await evalValue(`!window.__verifyMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break;
      await sleep(100);
    }
    await sleep(300);
    return head();
  };
  const head = () => evalValue(`({ view: State.view, base: BASE, robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null,
    card: (document.querySelector('main')?.innerText || '').slice(0, 200) })`);
  const inApp = async (path) => { await evalValue(`navigate(${JSON.stringify(path)})`); await sleep(400); return head(); };
  const p = [];
  const base = new URL(BASE);
  const company = await open('/company/no-such-company-for-the-sweep');
  if (company?.view !== 'notfound' || !/No company/.test(company.card)) p.push(`/company/no-such-company-for-the-sweep: ${company?.view}, not the not-found card`);
  else if (company.robots !== 'noindex') p.push(`/company/no-such-company-for-the-sweep: the not-found card is drawn with robots ${JSON.stringify(company.robots)}, not noindex`);
  const found = await open('/company/aapl-apple-inc');
  if (found?.view !== 'research' || found.robots !== null) p.push(`/company/aapl-apple-inc: ${found?.view}, robots ${JSON.stringify(found?.robots)}`);
  const lost = await open('/nope-for-the-verify-sweep');
  if (lost?.view !== 'notfound' || lost.robots !== 'noindex') p.push(`/nope-for-the-verify-sweep: ${lost?.view}, robots ${JSON.stringify(lost?.robots)}`);
  const onward = await inApp('/pricing');
  if (onward?.view !== 'plans' || onward.robots !== null) p.push(`/pricing reached in the app from the 404: ${onward?.view}, robots ${JSON.stringify(onward?.robots)} — the 404's noindex stayed`);
  const back = await inApp('/nope-again-for-the-verify-sweep');
  if (back?.view !== 'notfound' || back.robots !== 'noindex') p.push(`an unknown address reached in the app: ${back?.view}, robots ${JSON.stringify(back?.robots)}`);
  const folder = await open('/foo/index.html/bar');
  const astray = seen.filter(u => { try { const x = new URL(u); return x.origin === base.origin && x.pathname.startsWith('/foo/') && x.pathname !== '/foo/index.html/bar'; } catch { return false; } });
  if (folder?.view !== 'notfound' || folder.base !== '') p.push(`/foo/index.html/bar: ${folder?.view}, BASE ${JSON.stringify(folder?.base)}, not the not-found card at the site's own base`);
  if (astray.length) p.push(`/foo/index.html/bar asked for ${astray.slice(0, 3).join(', ')} — files under a folder that is not the app's`);
  /* Every parameter route, loaded cold from the address the host now
     rewrites to index.html one pattern at a time (there is no catch-all to
     fall back on), opens its own view — read from the page's ROUTES. */
  const rows = await evalValue(`ROUTES.filter(r => r.path.includes(':')).map(r => ({ path: r.path, view: r.view }))`) || [];
  const SAMPLE = { id: 'aapl-apple-inc', tab: 'financials', setup: 'no-such-setup-for-the-sweep', alert: 'a-no-such-alert' };
  for (const r of rows) {
    const path = r.path.replace(/:([A-Za-z]+)/g, (_, n) => SAMPLE[n] || 'x');
    const h = await open(path);
    if (h?.view !== r.view) p.push(`${path} (${r.path}): opened ${h?.view}, not ${r.view}`);
  }
  if (rows.length < 8) p.push(`only ${rows.length} parameter routes read from the page's ROUTES`);
  ws.removeEventListener('message', listen);
  if (p.length) { bad++; console.log('FAIL verify: the not-found card and the app\'s base'); p.forEach(x => console.log('     ' + x)); }
  else console.log(`ok   verify: the not-found card is noindex on an unknown company and an unknown address, and a found page is not, in the app as on a load; /foo/index.html/bar is the not-found card at the site's own base, asking for nothing under /foo/; all ${rows.length} parameter routes open their own view from a cold load`);
}
/* ---- end audit: verify ---- */
/* ---- audit: slim ---- */
/* THE APP LOADED WHERE IT WAS INLINE. Every page under pages/ and 404.html
   now loads the app's script and stylesheet from assets/app.<hash>.js and
   .css (build.mjs, THE APP ONCE) instead of carrying 3.3MB of both inline;
   index.html, and every parameter route it answers, still carries them
   inline. Both must run under the one policy vercel.json sends: the inline
   script by its hash, the file by 'self'. The loop above opens every route
   under that policy and would see a blocked script as a CSP line and an
   empty page; this says which way each kind of page got its app, and that
   the two ways give the same stylesheet.
   And a page now paints before its script has arrived: on a slow connection
   the header and an empty page stand on screen while 1MB of script comes
   down. So the script is held back for 1.5s here, at a phone's width and a
   desktop's, and the page must still draw with no error and move no more
   than 0.1 (layout shift) once it does. */
{
  const evalValue = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId)).result?.result?.value;
  const p = [];
  const ready = async () => {
    for (let i = 0; i < 120; i++) {
      if (await evalValue(`document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) return true;
      await sleep(100);
    }
    return false;
  };
  const shape = () => evalValue(`({ view: State.view,
    inline: [...document.scripts].filter(s => !s.src && s.textContent.length > 100000).length,
    srcs: [...document.scripts].filter(s => s.src).map(s => new URL(s.src).pathname),
    sheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => new URL(l.href).pathname),
    rules: [...document.styleSheets].reduce((n, s) => { try { return n + s.cssRules.length; } catch { return n; } }, 0) })`);
  const kinds = [['/', 'inline'], ['/company/aapl-apple-inc', 'inline'], ['/pricing', 'file'], ['/property/calculator', 'file'], ['/nope-for-the-slim-sweep', 'file']];
  const rules = new Set();
  for (const [path, how] of kinds) {
    bucket = [];
    await send('Page.navigate', { url: BASE + path }, sessionId);
    if (!await ready()) { p.push(`${path}: the page did not finish loading`); continue; }
    const s = await shape();
    const csp = bucket.filter(x => /^CSP|EXCEPTION/.test(x));
    if (csp.length) p.push(`${path}: ${csp.slice(0, 2).join('; ')}`);
    if (how === 'inline' && (s.inline !== 1 || s.srcs.length || s.sheets.length)) p.push(`${path}: expected the app inline, found ${s.inline} inline, loads ${JSON.stringify([...s.srcs, ...s.sheets])}`);
    if (how === 'file' && (s.inline || s.srcs.length !== 1 || !/^\/assets\/app\.[0-9a-f]{12}\.js$/.test(s.srcs[0]) || s.sheets.length !== 1 || !/^\/assets\/app\.[0-9a-f]{12}\.css$/.test(s.sheets[0])))
      p.push(`${path}: expected the app from assets/, found ${s.inline} inline, loads ${JSON.stringify([...s.srcs, ...s.sheets])}`);
    if (path.startsWith('/nope') ? s.view !== 'notfound' : s.view === 'notfound') p.push(`${path}: drew ${s.view}`);
    rules.add(s.rules);
  }
  if (rules.size !== 1) p.push(`the stylesheet is not the same one inline and linked: ${[...rules].join(' / ')} rules`);
  /* The script held back 1.5s: the frame painted without it must not move. */
  let held = 0, worst = 0;
  const hold = (e) => {
    const m = JSON.parse(e.data);
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
    held++;
    setTimeout(() => send('Fetch.continueRequest', { requestId: m.params.requestId }, sessionId), 1500);
  };
  ws.addEventListener('message', hold);
  /* From the network each time: the file is immutable, and a copy the browser
     kept would never be held. */
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/assets/app.*.js', requestStage: 'Request' }] }, sessionId);
  for (const [w, h, mobile] of [[390, 844, true], [1280, 900, false]]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId);
    for (const path of ['/pricing', '/property/calculator']) {
      bucket = []; held = 0;
      await send('Page.navigate', { url: BASE + path }, sessionId);
      if (!await ready()) { p.push(`${path} @${w}, script 1.5s late: the page did not finish loading`); continue; }
      await sleep(400);
      const r = await evalValue(`new Promise(res => { const shifts = [];
        new PerformanceObserver(l => shifts.push(...l.getEntries())).observe({ type: 'layout-shift', buffered: true });
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
        const js = performance.getEntriesByType('resource').find(e => /\\/assets\\/app\\.[0-9a-f]{12}\\.js$/.test(e.name));
        setTimeout(() => res({ cls: shifts.reduce((s, e) => s + e.value, 0), fcp, jsEnd: js ? js.responseEnd : null, view: State.view }), 150); })`);
      const errs = bucket.filter(x => !/REQFAIL/.test(x) || !/ERR_ABORTED/.test(x));
      if (!held) p.push(`${path} @${w}: the script was not held back — it did not come from assets/`);
      if (errs.length) p.push(`${path} @${w}, script 1.5s late: ${errs.slice(0, 2).join('; ')}`);
      worst = Math.max(worst, Number(r?.cls) || 0);
      if (!(r?.cls <= 0.1)) p.push(`${path} @${w}, script 1.5s late: layout shift ${Number(r?.cls).toFixed(3)}`);
      if (!(r?.fcp < r?.jsEnd)) p.push(`${path} @${w}, script 1.5s late: first paint ${r?.fcp}ms is not before the script arrived (${r?.jsEnd}ms), so nothing painted early was measured`);
    }
  }
  await send('Fetch.disable', {}, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
  ws.removeEventListener('message', hold);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (p.length) { bad++; console.log('FAIL slim: the app is not loaded as each page should load it'); p.forEach(x => console.log('     ' + x)); }
  else console.log(`ok   slim: / and a parameter route run the app inline, a route page and the 404 run it from assets/ under the same policy with the same ${[...rules][0]} style rules; with the script 1.5s late the page paints first, then draws with no error and a layout shift of at most ${worst.toFixed(3)} at 390 and 1280`);
}
/* ---- end audit: slim ---- */
/* ---- audit1: health ---- */
/* DOES EACH TOOL WORK? — /status (91-health.js). Two halves, held apart:
   - "Checked in your browser now": each tool's own code on known inputs.
     On this build every one of the four must say Pass; with data/us.json
     answered 404 the equities check and the data-files check must say Fail
     and name the file, never Pass on the illustrative sample.
   - "Complete journeys on the live site": health/journeys.json, served here
     from fixtures in place of the committed file. A good result must read
     Pass with its run and commit; none (a 404) and the committed placeholder
     "not run yet"; a failing one Fail with the step and the route it failed
     at; an unreadable one must show no result at all, and a result five
     days old must say so. Every visit must ask the site for the file, and
     ask it with cache: 'no-store' — read off the page's own fetch — so a
     reader is never shown a copy a cache kept. */
{
  const evalValue = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId)).result?.result?.value;
  const p = [];
  let serve = null, usGone = false, instBroken = false, asked = [];
  const intercept = (e) => {
    const m = JSON.parse(e.data);
    if (m.sessionId !== sessionId) return;
    if (m.method !== 'Fetch.requestPaused') return;
    const url = m.params.request.url, id = m.params.requestId;
    if (/\/health\/journeys\.json/.test(url)) asked.push(url);
    const answer = (status, body, type) => send('Fetch.fulfillRequest', { requestId: id, responseCode: status,
      responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: 'no-cache' }], body: Buffer.from(body, 'utf8').toString('base64') }, sessionId);
    if (/\/health\/journeys\.json/.test(url) && serve) answer(serve.status, typeof serve.body === 'string' ? serve.body : JSON.stringify(serve.body), serve.type || 'application/json; charset=utf-8');
    else if (/\/data\/us\.json/.test(url) && usGone) answer(404, 'gone for the sweep', 'text/plain');
    /* audit1 health-verify: served 200 as JSON, a body no reader can use. */
    else if (/\/data\/instruments\.json/.test(url) && instBroken) answer(200, '{"instruments":[', 'application/json; charset=utf-8');
    else send('Fetch.continueRequest', { requestId: id }, sessionId);
  };
  ws.addEventListener('message', intercept);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/health/journeys.json*', requestStage: 'Request' }, { urlPattern: '*/data/us.json*', requestStage: 'Request' }, { urlPattern: '*/data/instruments.json*', requestStage: 'Request' }] }, sessionId);
  /* How the page asks for the file: the cache mode of each fetch of it. */
  const modes = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.__healthModes = [];
    window.fetch = function (u, o) { try { if (/health\\/journeys\\.json/.test(String(u && u.url || u))) window.__healthModes.push((o && o.cache) || (u && u.cache) || 'default'); } catch (e) {} return f.apply(this, arguments); }; })();` }, sessionId);
  const open = async (query = '') => {
    await evalValue('window.__healthMark = 1');
    asked = [];
    await send('Page.navigate', { url: BASE + '/status' + query }, sessionId);
    for (let i = 0; i < 200; i++) {
      const done = await evalValue(`!window.__healthMark && !!document.getElementById('health-journeys-sum')
        && !/Reading/.test(document.getElementById('health-journeys-sum').textContent) && document.getElementById('health-journeys-sum').textContent.length > 0
        && document.querySelectorAll('#health-quick > li').length === 4 && !document.querySelector('#health-quick > li[data-status="PENDING"]')`);
      if (done) break;
      await sleep(100);
    }
    const out = await evalValue(`({ sum: document.getElementById('health-journeys-sum')?.textContent || '',
      rows: [...document.querySelectorAll('#health-journeys > li')].map(li => ({ status: li.dataset.status, text: li.innerText })),
      quick: [...document.querySelectorAll('#health-quick > li')].map(li => ({ status: li.dataset.status, text: li.innerText })),
      quickSum: document.getElementById('health-quick-sum')?.textContent || '', h2: document.querySelector('#health h2')?.textContent || '',
      modes: window.__healthModes || [] })`);
    return { ...out, asked: asked.length };
  };
  const run = (id, name, status, extra = {}) => ({ id, name, status, failedStep: null, route: null, ms: 4200, note: null, ...extra });
  const GOOD = { kind: 'quantum-tradeworks-journeys', schema: 1, ranAt: new Date(Date.now() - 3 * 3600000).toISOString(), url: 'https://quantum-tradeworks.vercel.app',
    commit: 'abcdef1234567890', commitFrom: 'the sweep', journeys: [run('equities', 'Equities: search, filed statements, watchlist', 'PASS'), run('scanner', 'Scanner: build, save and evaluate a setup', 'PASS')] };
  const FAILING = { ...GOOD, journeys: [GOOD.journeys[0], run('scanner', 'Scanner: build, save and evaluate a setup', 'FAIL', { failedStep: 'Save the setup', route: '/app/scanner/setups/new', note: 'Save did not open the setup’s page' })] };

  /* The committed placeholder, as the server has it. */
  serve = null;
  let s = await open();
  if (s.h2 !== 'Does each tool work?') p.push(`/status has no "Does each tool work?" section (${JSON.stringify(s.h2)})`);
  const quickSaid = (q) => q.map(x => `${x.status}: ${x.text.replace(/\s+/g, ' ').slice(0, 110)}`).join(' | ');
  if (s.quick.length !== 4 || s.quick.some(q => q.status !== 'PASS')) p.push(`the in-browser checks on this build: ${quickSaid(s.quick)}`);
  if (!/^4 of 4 pass\./.test(s.quickSum)) p.push(`the in-browser summary reads ${JSON.stringify(s.quickSum)}`);
  if (!/^Not run yet\./.test(s.sum) || s.rows.length) p.push(`the committed placeholder: ${JSON.stringify(s.sum.slice(0, 80))}, ${s.rows.length} rows — not "not run yet"`);
  if (!s.asked) p.push('/status never asked the site for health/journeys.json');
  if (!s.modes.length || s.modes.some(m => m !== 'no-store')) p.push(`/status asks for health/journeys.json with cache ${JSON.stringify(s.modes)}, not no-store`);

  /* A fixture, and the visit must have asked the site for it. */
  const fixture = async (as, what) => { serve = as; const r = await open(); if (!r.asked) p.push(`${what}: the page never asked the site for the file`); return r; };
  s = await fixture({ status: 200, body: GOOD }, 'a good result');
  if (!/^Last recorded run /.test(s.sum) || !/2 of 2 pass/.test(s.sum) || !/abcdef1/.test(s.sum)) p.push(`a good result: ${JSON.stringify(s.sum)}`);
  if (s.rows.length !== 2 || s.rows.some(r => r.status !== 'PASS')) p.push(`a good result's rows: ${JSON.stringify(s.rows.map(r => r.status))}`);

  s = await fixture({ status: 404, body: '<!doctype html><title>404</title>', type: 'text/html; charset=utf-8' }, 'no file');
  if (!/^Not run yet\./.test(s.sum) || s.rows.length) p.push(`no file (404): ${JSON.stringify(s.sum.slice(0, 80))}, ${s.rows.length} rows`);

  s = await fixture({ status: 200, body: FAILING }, 'a failing result');
  const failRow = s.rows.find(r => r.status === 'FAIL');
  if (!/1 failed/.test(s.sum)) p.push(`a failing result's summary: ${JSON.stringify(s.sum)}`);
  if (!failRow || !/Save the setup/.test(failRow.text) || !/\/app\/scanner\/setups\/new/.test(failRow.text)) p.push(`a failing result does not name its step and route: ${JSON.stringify(failRow?.text || null)}`);

  s = await fixture({ status: 200, body: '{"kind":"quantum-tradeworks-journeys","ranAt":"soon","journeys":[{"id":"x","name":"x","status":"OK"}]}' }, 'an unreadable result');
  if (!/could not be read/.test(s.sum) || s.rows.length) p.push(`an unreadable result: ${JSON.stringify(s.sum.slice(0, 90))}, ${s.rows.length} rows — a result was shown`);

  s = await fixture({ status: 200, body: { ...GOOD, ranAt: new Date(Date.now() - 5 * 86400000 - 3600000).toISOString() } }, 'a five-day-old result');
  if (!/No run has been recorded for 5 days/.test(s.sum)) p.push(`a five-day-old result does not say how old it is: ${JSON.stringify(s.sum)}`);

  /* audit1 health-verify: a Degraded journey whose file gives no reason was
     described with the Pass's sentence, "each step within its time budget"
     — the one thing a Degraded journey is not. */
  s = await fixture({ status: 200, body: { ...GOOD, journeys: [GOOD.journeys[0], run('scanner', 'Scanner: build, save and evaluate a setup', 'DEGRADED')] } }, 'a degraded result with no note');
  const degRow = s.rows.find(r => r.status === 'DEGRADED');
  if (!degRow || /within its time budget/.test(degRow.text) || !/degraded/i.test(degRow.text)) p.push(`a Degraded journey with no note reads ${JSON.stringify(degRow?.text?.replace(/\s+/g, ' ') || null)}`);

  /* The filed statements withheld: the checks that read them must fail and
     say which file, rather than pass on the illustrative sample. */
  /* The cache off, or the immutable copy the earlier loads kept would answer
     before the 404 could. */
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  serve = null; usGone = true;
  s = await open();
  const eq = s.quick.find(q => /Equities Research/.test(q.text)), files = s.quick.find(q => /data files/.test(q.text));
  if (eq?.status !== 'FAIL' || !/data\/us\.json/.test(eq.text)) p.push(`with data/us.json gone the equities check reads ${eq?.status}: ${JSON.stringify((eq?.text || '').slice(0, 120))}`);
  if (files?.status !== 'FAIL' || !/data\/us\.json[^\n]*not served/.test(files.text)) p.push(`with data/us.json gone the data-files check reads ${files?.status}`);
  usGone = false;

  /* audit1 health-verify: data/instruments.json served (a HEAD answers 200
     JSON) over a body the page cannot parse. The check read Pass with the
     words "served and not loaded here" under it; a file the tool cannot
     use is not a Pass. The cache is still off, so the broken body is what
     the page gets. */
  instBroken = true;
  s = await open();
  const inst = s.quick.find(q => /data files/.test(q.text));
  if (inst?.status !== 'DEGRADED' || !/data\/instruments\.json[^\n]*not loaded/.test(inst.text)) p.push(`with data/instruments.json served but unreadable the data-files check reads ${inst?.status}: ${JSON.stringify((inst?.text || '').replace(/\s+/g, ' ').slice(0, 260))}`);
  instBroken = false;

  /* audit1 health-verify: the filed statements switched off by the reader
     (?real=0). The equities check says so (Degraded); the data-files check
     must not call data/us.json "not loaded yet" — nothing is loading, the
     reader chose it — nor degrade on the reader's choice. */
  s = await open('?real=0');
  const off = s.quick.find(q => /data files/.test(q.text));
  if (off?.status !== 'PASS' || /not loaded yet/.test(off.text) || !/data\/us\.json[^\n]*switched off/.test(off.text)) p.push(`with the filed statements switched off the data-files check reads ${off?.status}: ${JSON.stringify((off?.text || '').replace(/\s+/g, ' ').slice(0, 200))}`);

  /* The full checks, from the keyboard: Enter on the button runs them, and
     focus stays on it while they run and after. */
  s = await open();
  await evalValue(`document.getElementById('health-full-run').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
  for (let i = 0; i < 100 && !/^Full checks:/.test(await evalValue(`document.getElementById('health-full-sum')?.textContent || ''`)); i++) await sleep(100);
  const full = await evalValue(`({ sum: document.getElementById('health-full-sum')?.textContent || '', focus: document.activeElement?.id || document.activeElement?.tagName,
    rows: [...document.querySelectorAll('#health-full > li')].map(li => li.dataset.status) })`);
  if (!/^Full checks: 3 of 3 pass\./.test(full.sum) || full.rows.some(x => x !== 'PASS')) p.push(`the full checks: ${JSON.stringify(full.sum)} ${JSON.stringify(full.rows)}`);
  if (full.focus !== 'health-full-run') p.push(`focus went to ${full.focus} after the full checks ran from the keyboard`);

  await send('Fetch.disable', {}, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
  if (modes?.result?.identifier) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: modes.result.identifier }, sessionId);
  ws.removeEventListener('message', intercept);
  if (p.length) { bad++; console.log('FAIL health: /status does not say truthfully whether each tool works'); p.forEach(x => console.log('     ' + x)); }
  else console.log('ok   health: /status runs its four in-browser checks to Pass on this build and to Fail, naming data/us.json, without it, and to Degraded, naming data/instruments.json, when that is served but unreadable, and does not degrade the data files when the reader switched the filed statements off; a Degraded journey with no note is not called within budget; the full checks pass from the keyboard with focus kept; the journeys result reads Pass from a good file, "not run yet" from none and from the placeholder, Fail with its step and route from a failing one, nothing from an unreadable one and its age from an old one — asked of the site on every visit, with no-store');
}
/* ---- end audit1: health ---- */
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
