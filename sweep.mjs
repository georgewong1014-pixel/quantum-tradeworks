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
/* ---- audit1: registry-ctas ---- */
/* ONE REGISTRY OF TOOLS; A TOOL THAT CANNOT BE USED IS NEVER OFFERED; ONE
   NEXT ACTION ON EACH RESULT SCREEN (audit 1, #2, #3, #9; 35-ui.js TOOLS).
   1. Every TOOLS entry is well formed — a written status is never Delayed or
      Unavailable, every one has its sentence and its action — and every
      entry in this build opens its own view at its address, as does its
      action. The product tab rows are the registry's tabs.
   2. As production serves it (live.localhost: the scanner's files are never
      asked for), the tools that read them are Unavailable with the reason,
      their tabs are text with the badge, and on no page is a soon or
      unavailable tool a link — nor the unbuilt product a link or a button.
   3. The derived states follow the data: data/us.json held back (answered
      404) makes the Equities tools that read the filings Unavailable with
      the load's own error, their tabs text and their pages say why, while
      the Overview, Sarawak watch and the Cash Wheel stay usable; a clock a
      year and more past the filings' own date makes them Delayed and still
      links; a synthetic price history and match record (answered by the
      check, never read from disk) bring the Market, Historical and Alerts
      back, and a history ten days old makes them Delayed.
   4. Each result screen has exactly one primary button: the company page
      ("Add to watchlist", then "Create a setup for MSFT" to the builder with
      the symbol), the scanner alert ("Open Apple Inc. research"), the
      calculator, and the dashboard (the first step, then "Continue").
   5. The goal words: the homepage cards read the products' actions and open
      where each starts, Business reads "Coming soon" as text, and How it
      works and the dashboard checklist use the same words. */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const u = new URL(BASE);
  const ownMachine = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  const live = ownMachine ? `${u.protocol}//live.localhost${u.port ? ':' + u.port : ''}` : BASE;
  const p = [];
  const load = async (url) => {
    bucket = [];
    await ev('window.__rcMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__rcMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(400);
  };
  /* What the page offers that it must not: a link, from any part of the
     page, to a tool whose state is soon or unavailable; a link or a button
     for the product that is not built. */
  /* A build without the registry is judged by what it offers: `unusable`
     names the addresses that cannot work in the case under test. */
  const OFFERED = (unusable = []) => `(() => { const out = []; const reg = typeof toolOfLink === 'function';
    document.querySelectorAll('a[href]').forEach(a => {
      if (!reg) { const at = new URL(a.href).pathname; if (!a.getAttribute('href').startsWith('#') && ${JSON.stringify(unusable)}.includes(at)) out.push(location.pathname + ': a link to ' + at + ' "' + a.textContent.trim().slice(0, 40) + '"'); return; }
      const t = toolOfLink(a); if (!t) return; const s = toolState(t);
      if (!s.actionable) out.push(location.pathname + ': a link to ' + t.id + ' (' + s.status + ') "' + a.textContent.trim().slice(0, 40) + '"'); });
    document.querySelectorAll('a, button, [role=button], [role=link]').forEach(b => {
      if (/Business Intelligence|Plan my business/.test(b.textContent)) out.push(location.pathname + ': a ' + b.tagName.toLowerCase() + ' for the unbuilt product'); });
    const gone = reg ? TOOLS.filter(t => !toolPresent(t)).map(t => href(t.path)) : [];
    document.querySelectorAll('a[href]').forEach(a => { if (gone.includes(new URL(a.href).pathname)) out.push(location.pathname + ': a link to a tool not in this build, ' + a.getAttribute('href')); });
    return out; })()`;
  /* Primary buttons a reader sees on the page: the view's and its dock's. */
  const PRIMARIES = `[...document.querySelectorAll('#views .btn-primary, body > .dock .btn-primary')].filter(n => n.getClientRects().length)
    .map(n => ({ t: n.textContent.trim(), href: n.getAttribute('href') }))`;
  const clean = `(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('vl.plan', JSON.stringify('pro')); return true; })()`;

  /* 1. The registry, and every tool in this build opening at its address. */
  await load(BASE + '/app');
  const hasReg = await ev(`typeof TOOLS !== 'undefined' && typeof toolState === 'function'`);
  if (!hasReg) p.push('the page has no tool registry (TOOLS, toolState): nothing says which tools can be used here');
  const reg = !hasReg ? [] : await ev(`TOOLS.map(t => ({ id: t.id, path: t.path, product: t.product, status: t.status, note: t.statusNote,
    action: t.action ? t.action.path : null, label: t.action ? t.action.label : null, present: toolPresent(t), views: toolViews(t) }))`);
  const ids = new Set();
  let opened = 0;
  const absent = [];
  for (const t of reg) {
    if (ids.has(t.id)) p.push(`TOOLS: ${t.id} twice`); ids.add(t.id);
    if (!['live', 'beta', 'demo', 'soon'].includes(t.status)) p.push(`TOOLS ${t.id}: written status "${t.status}" — delayed and unavailable are derived, never written`);
    if (!t.note || t.note.length < 20) p.push(`TOOLS ${t.id}: no sentence`);
    if (!t.action || !t.label) p.push(`TOOLS ${t.id}: no primary action`);
    if (!t.present) { absent.push(t.id); continue; }
    for (const path of [t.path, ...(t.action && t.action !== t.path ? [t.action] : [])]) {
      await load(BASE + path);
      const v = await ev(`State.view`);
      const ex = bucket.filter(x => /^EXCEPTION|^CONSOLE/.test(x));
      if (v === 'notfound' || !t.views.includes(v) && path === t.path) p.push(`${t.id}: ${path} opens ${v}, not ${t.views.join(' or ')}`);
      if (ex.length) p.push(`${t.id}: ${path}: ${ex.slice(0, 2).join('; ')}`);
      opened++;
    }
  }
  /* My properties arrives with the property model store (another branch):
     its route and view make it the Property row's first tab, current on its
     page, with Property current in the sidebar — no second table to edit.
     Where it is not in this build, a stand-in route shows that it would. */
  if (hasReg) {
    await load(BASE + '/property/calculator');
    const sim = await ev(`(async () => {
      const had = toolPresent(toolById('models'));
      if (!had) { ROUTES.push({ path: '/property/models', view: '__rcModels', title: 'My properties' });
        VIEWS.__rcModels = () => el('div', {}, el('div', { class: 'page-hd' }, el('h1', {}, 'My properties (stand-in)'))); }
      navigate('/property/models'); await new Promise(r => setTimeout(r, 300));
      const out = { had, tabs: [...document.querySelectorAll('#productTabs .ptab')].map(a => [a.textContent.trim(), a.getAttribute('aria-current')]),
        side: document.querySelector('#appnav a.sb-link[aria-current=page]')?.dataset.navId || null };
      if (!had) { ROUTES.splice(ROUTES.findIndex(r => r.view === '__rcModels'), 1); delete VIEWS.__rcModels; }
      navigate('/property/calculator'); await new Promise(r => setTimeout(r, 200));
      out.after = [...document.querySelectorAll('#productTabs .ptab')].map(a => a.textContent.trim());
      return out; })()`);
    if (JSON.stringify(sim.tabs[0]) !== JSON.stringify(['My properties', 'page']) || sim.tabs[1]?.[0] !== 'Calculator' || sim.side !== 'property')
      p.push(`My properties${sim.had ? '' : ' (stand-in)'}: tabs ${JSON.stringify(sim.tabs)}, sidebar ${sim.side}`);
    if (!sim.had && sim.after.includes('My properties')) p.push('My properties is still a tab once its stand-in route is gone');
  }
  for (const [path, pid] of hasReg ? [['/research', 'equities'], ['/property/calculator', 'property']] : []) {
    await load(BASE + path);
    const r = await ev(`({ tabs: [...document.querySelectorAll('#productTabs .ptab')].map(a => a.dataset.path || a.getAttribute('href')),
      want: productTabs(${JSON.stringify(pid)}).map(t => t.path) })`);
    if (JSON.stringify(r.tabs) !== JSON.stringify(r.want.map(x => x))) p.push(`${path}: the ${pid} tabs ${JSON.stringify(r.tabs)} are not the registry's ${JSON.stringify(r.want)}`);
  }

  /* 2. As production serves it. */
  const LIVE_PAGES = ['/', '/how-it-works', '/app', '/research', '/company/msft-microsoft', '/app/scanner', '/app/scanner/setups',
    '/app/scanner/market', '/app/scanner/alerts', '/app/scanner/backtest', '/research/trading-index', '/property/calculator', '/my/workspace'];
  let offLinks = 0;
  for (const path of LIVE_PAGES) {
    await load(live + path);
    (await ev(OFFERED(['/app/scanner/market', '/app/scanner/alerts', '/app/scanner/backtest']))).forEach(x => p.push(`production: ${x}`));
    if (path === '/app/scanner') {
      const r = await ev(`({ states: !${hasReg} ? [] : ['market', 'scanAlerts', 'backtest'].map(id => [id, toolState(id).status, toolState(id).note]),
        tabs: [...document.querySelectorAll('#views .scan-subnav .ptab')].map(n => [n.tagName, n.textContent.replace(/\\s+/g, ' ').trim()]) })`);
      r.states.forEach(([id, st, note]) => { if (st !== 'unavailable' || !/never deployed/.test(note)) p.push(`production: ${id} is ${st} ("${note.slice(0, 60)}"), not unavailable with the reason`); });
      for (const label of ['Market', 'Alerts', 'Historical']) {
        const tab = r.tabs.find(([, t]) => t.startsWith(label));
        if (!tab || tab[0] !== 'SPAN' || !/Unavailable/.test(tab[1])) p.push(`production: the scanner's ${label} tab is ${JSON.stringify(tab)}, not text with its badge`);
        else offLinks++;
      }
      if (!r.tabs.some(([tag, t]) => tag === 'A' && t.startsWith('Setups'))) p.push('production: the Setups tab is not a link');
    }
    if (path === '/app/scanner/market' && !await ev(`/cannot work here/.test(document.querySelector('#views .tool-notice')?.textContent || '')`))
      p.push('production: the Market page does not say why it cannot work here');
  }

  /* 3a. data/us.json held back. */
  const held = (e) => {
    const m = JSON.parse(e.data);
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
      body: Buffer.from('held back by the check').toString('base64') }, sessionId);
  };
  ws.addEventListener('message', held);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/us.json*', requestStage: 'Request' }] }, sessionId);
  let heldOk = false;
  const EQ_OFF = ['/discover/screener', '/discover/value-map', '/compare', '/research/queue'];
  try {
    await load(BASE + '/research');
    const r = await ev(`({ ok: realStatus && realStatus.ok, error: realStatus && realStatus.error,
      states: !${hasReg} ? null : Object.fromEntries(['screener', 'valuemap', 'compare', 'queue', 'overview', 'sarawak', 'wheel'].map(id => [id, [toolState(id).status, toolState(id).note]])),
      tabs: [...document.querySelectorAll('#productTabs .ptab')].map(n => [n.tagName, n.textContent.replace(/\\s+/g, ' ').trim()]),
      offered: ${OFFERED(EQ_OFF)} })`);
    if (r.ok !== false) p.push(`us.json held back: the filings still loaded (${r.ok}) — the check is not testing the case`);
    for (const id of r.states ? ['screener', 'valuemap', 'compare', 'queue'] : []) {
      const [st, note] = r.states[id];
      if (st !== 'unavailable' || !note.includes(r.error || '§')) p.push(`us.json held back: ${id} is ${st} ("${note.slice(0, 70)}"), not unavailable with the load's error`);
    }
    for (const id of r.states ? ['overview', 'sarawak', 'wheel'] : []) if (r.states[id][0] === 'unavailable') p.push(`us.json held back: ${id} does not read the filings and is unavailable`);
    for (const [label, off] of [['Screener', true], ['Compare', true], ['Research queue', true], ['Overview', false], ['Sarawak watch', false], ['Cash Wheel', false]]) {
      const tab = r.tabs.find(([, t]) => t.startsWith(label));
      if (!tab || (off ? tab[0] !== 'SPAN' || !/Unavailable/.test(tab[1]) : tab[0] !== 'A')) p.push(`us.json held back: the ${label} tab is ${JSON.stringify(tab)}`);
    }
    r.offered.forEach(x => p.push(`us.json held back: ${x}`));
    await load(BASE + '/discover/screener');
    if (!/did not load/.test(await ev(`document.querySelector('#views .tool-notice')?.textContent || ''`))) p.push('us.json held back: the screener does not say why it cannot work');
    (await ev(OFFERED(EQ_OFF))).forEach(x => p.push(`us.json held back: ${x}`));
    await load(BASE + '/how-it-works');
    const legend = await ev(`[...document.querySelectorAll('.hiw-status-who')].map(n => n.textContent).join(' | ')`);
    if (!/Here, now: [^|]*Equities Screener/.test(legend)) p.push(`us.json held back: How it works does not list the Screener as unavailable: ${legend.slice(-160)}`);
    heldOk = true;
  } finally {
    await send('Fetch.disable', {}, sessionId);
    ws.removeEventListener('message', held);
    await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
  }

  /* 3b. The filings' own date, a year and more ago. */
  await load(BASE + '/discover/screener');
  const late = !hasReg ? { st: 'no registry', note: '', tab: null, notice: false } : await ev(`(async () => {
    toolClock = new Date(Date.parse(realStatus.generated) + 400 * 864e5).toISOString(); render();
    await new Promise(r => setTimeout(r, 150));
    const tab = [...document.querySelectorAll('#productTabs .ptab')].find(n => n.textContent.startsWith('Screener'));
    const out = { st: toolState('screener').status, note: toolState('screener').note, date: String(realStatus.generated).slice(0, 10),
      tab: tab ? [tab.tagName, !!tab.parentElement.querySelector('.status-delayed')] : null, notice: !!document.querySelector('#views .tool-notice-delayed') };
    toolClock = null; render();
    out.after = toolState('screener').status;
    return out; })()`);
  if (late.st !== 'delayed' || !late.note.includes(late.date)) p.push(`filings 400 days old: the screener is ${late.st} ("${late.note.slice(0, 70)}")`);
  if (!late.tab || late.tab[0] !== 'A' || !late.tab[1]) p.push(`filings 400 days old: the Screener tab is ${JSON.stringify(late.tab)}, not a link wearing Delayed`);
  if (!late.notice) p.push('filings 400 days old: the screener does not say its data is late');
  if (hasReg && late.after === 'delayed') p.push('filings: the clock put back, the screener is still delayed');

  /* 3c and 4. A synthetic history and match record, answered by the check. */
  let scanned = null;
  if (ownMachine) {
    const days = []; for (let d = Date.parse('2026-06-01'); d <= Date.parse('2026-09-25'); d += 864e5) { const w = new Date(d).getUTCDay(); if (w && w < 6) days.push(new Date(d).toISOString().slice(0, 10)); }
    const hist = { generated: '2026-09-26T00:00:00Z', series: { AAPL: Object.fromEntries(days.map((d, i) => [d, 200 + i * 0.25])) } };
    const alerts = { alerts: [{ id: 'a0rc00001', key: 'rc-check|AAPL|1D|2026-09-25', setupId: 'rc-check', setupName: 'Registry check', setupVersion: 1, symbol: 'AAPL',
      candleDate: '2026-09-25', timeframe: '1D', eventType: 'NEW_MATCH', close: 230, detectedAt: '2026-09-26T01:00:00Z' }] };
    const body = { 'price-history.json': hist, 'scan-alerts.json': alerts };
    const answer = (e) => {
      const m = JSON.parse(e.data);
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
      const f = Object.keys(body).find(k => new URL(m.params.request.url).pathname.endsWith('/data/' + k));
      send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(body[f])).toString('base64') }, sessionId);
    };
    ws.addEventListener('message', answer);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send('Fetch.enable', { patterns: Object.keys(body).map(k => ({ urlPattern: `*/data/${k}*`, requestStage: 'Request' })) }, sessionId);
    try {
      await load(BASE + '/app/scanner/market');
      scanned = !hasReg ? { fresh: { st: [], links: [] }, stale: { st: [], links: [], note: '' } } : await ev(`(async () => {
        const read = () => ({ st: ['market', 'scanAlerts', 'backtest'].map(id => toolState(id).status),
          links: ['Market', 'Alerts', 'Historical'].map(l => { const n = [...document.querySelectorAll('#views .scan-subnav .ptab')].find(x => x.textContent.startsWith(l)); return n ? n.tagName + (n.parentElement.querySelector('.status-delayed') ? '+delayed' : '') : null; }) });
        toolClock = '2026-09-27T12:00:00Z'; render(); await new Promise(r => setTimeout(r, 150));
        const fresh = read();
        toolClock = '2026-10-05T12:00:00Z'; render(); await new Promise(r => setTimeout(r, 150));
        const stale = read(); stale.note = toolState('market').note;
        toolClock = null; render();
        return { fresh, stale }; })()`);
      /* At a phone's width, the badges on tabs scrolled out of the row stay
         in the row: the page itself does not scroll sideways. */
      if (hasReg) {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
        const phone = await ev(`(async () => { toolClock = '2026-10-05T12:00:00Z'; render(); await new Promise(r => setTimeout(r, 200));
          const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          const badges = document.querySelectorAll('#views .scan-subnav .status-delayed').length;
          toolClock = null; render(); return { over, badges }; })()`);
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
        if (phone.badges < 2 || phone.over > 0) p.push(`at 390 with Delayed tabs: ${phone.badges} badges, the page scrolls ${phone.over}px sideways`);
      }
      if (scanned.fresh.st.join() !== 'beta,beta,beta' || scanned.fresh.links.join() !== 'A,A,A') p.push(`a history and a record here: ${JSON.stringify(scanned.fresh)}, not three usable tools`);
      if (scanned.stale.st.join() !== 'delayed,delayed,delayed' || scanned.stale.links.join() !== 'A+delayed,A+delayed,A+delayed' || !/2026-09-25, 10 days old/.test(scanned.stale.note))
        p.push(`a history ten days old: ${JSON.stringify(scanned.stale)}, not three links wearing Delayed with the date`);
      await load(BASE + '/app/scanner/alerts/a0rc00001');
      const al = await ev(`({ view: State.view, prim: ${PRIMARIES}, want: companyPath(BY_ID.get(companyIdFor('AAPL')).c) })`);
      if (al.view !== 'scannerAlert' || al.prim.length !== 1 || al.prim[0].t !== 'Open Apple Inc. research' || !(al.prim[0].href || '').endsWith(al.want))
        p.push(`the scanner alert's primary actions: ${JSON.stringify(al.prim)} (want one "Open Apple Inc. research" to ${al.want})`);
    } finally {
      await send('Fetch.disable', {}, sessionId);
      ws.removeEventListener('message', answer);
      await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
    }
  }

  /* 4. One primary action on each result screen, from a clean profile. */
  await ev(clean);
  await load(BASE + '/company/msft-microsoft');
  const co1 = await ev(PRIMARIES);
  await ev(`document.getElementById('co-watch').click(); true`);
  await sleep(400);
  const co2 = await ev(PRIMARIES);
  if (co1.length !== 1 || co1[0].t !== 'Add to watchlist') p.push(`company page, not on a list: primary actions ${JSON.stringify(co1)}`);
  if (co2.length !== 1 || co2[0].t !== 'Create a setup for MSFT' || !/\/app\/scanner\/setups\/new\?.*symbol=MSFT/.test(co2[0].href || ''))
    p.push(`company page, on a list: primary actions ${JSON.stringify(co2)}`);
  await load(BASE + '/property/calculator');
  const calc = await ev(PRIMARIES);
  if (calc.length !== 1) p.push(`the calculator's primary actions: ${JSON.stringify(calc)}`);
  await ev(clean);
  await load(BASE + '/app');
  const dash1 = await ev(`({ prim: ${PRIMARIES}, first: !!document.querySelector('#views .dash-start') })`);
  await ev(`(() => { const w = wlCreate('Registry check list'); wlAdd(w.watchlist.id, 'MSFT-SEC'); return true; })()`);
  await load(BASE + '/app');
  const dash2 = await ev(`({ prim: ${PRIMARIES}, first: !!document.querySelector('#views .dash-start'), row: document.querySelector('#views .dash-row-first')?.textContent || '' })`);
  if (!dash1.first || dash1.prim.length !== 1 || dash1.prim[0].t !== 'Start research') p.push(`dashboard, first time: ${JSON.stringify(dash1)}`);
  if (dash2.first || dash2.prim.length !== 1 || dash2.prim[0].t !== 'Continue' || !/Registry check list/.test(dash2.row)) p.push(`dashboard, returning: ${JSON.stringify(dash2)}`);

  /* 5. The goal words. */
  await load(BASE + '/');
  const home = await ev(`({ cards: [...document.querySelectorAll('#views .pub-card')].map(c => ({ tag: c.tagName, href: c.getAttribute('href'),
      go: (c.querySelector('.pub-card-go')?.textContent || '').trim(), note: (c.querySelector('.pub-card-note')?.firstChild?.textContent || '').trim(), links: c.querySelectorAll('a').length })),
    want: PRODUCTS.map(p => ({ action: p.action, href: p.actionPath ? href(p.actionPath) : null })) })`);
  const words = ['Start research', 'Create a setup', 'Analyse a property'];
  if (JSON.stringify(home.want.slice(0, 3).map(w => w.action)) !== JSON.stringify(words)) p.push(`PRODUCTS' actions: ${JSON.stringify(home.want.map(w => w.action))}`);
  home.cards.slice(0, 3).forEach((c, i) => { if (c.tag !== 'A' || c.go !== words[i] || c.href !== home.want[i].href) p.push(`homepage card ${i + 1}: ${JSON.stringify(c)}, not "${words[i]}" to ${home.want[i].href}`); });
  const biz = home.cards[3];
  if (!biz || biz.tag === 'A' || biz.links || biz.note !== 'Coming soon') p.push(`the Business card: ${JSON.stringify(biz)}, not "Coming soon" as text`);
  await load(BASE + '/how-it-works');
  const hiw = await ev(`[...document.querySelectorAll('#views .hiw-product-ft a')].map(a => a.textContent.trim())`);
  if (JSON.stringify(hiw) !== JSON.stringify(words)) p.push(`How it works' product actions: ${JSON.stringify(hiw)}`);
  await ev(clean);
  await load(BASE + '/app');
  const steps = await ev(`[...document.querySelectorAll('#views .dash-step-go')].map(a => a.textContent.trim())`);
  for (const w of words) if (!steps.includes(w)) p.push(`the dashboard checklist does not say "${w}": ${JSON.stringify(steps)}`);

  if (p.length) { bad++; console.log(`FAIL registry-ctas: the tool registry, what a tool that cannot be used offers, and one next action per result screen (${p.length} problems)`); p.slice(0, 60).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   registry-ctas: ${reg.length} tools in the registry (${absent.length ? `${absent.join(', ')} not in this build, listed nowhere` : 'all in this build'}), ${opened} addresses open their view; as production serves it ${offLinks} scanner tabs are text with the reason and no page offers an unusable tool; with us.json held back the four Equities tools that read it are Unavailable with its error${heldOk ? '' : ' (not reached)'}, 400 days past its date they are Delayed links; ${scanned ? 'a synthetic history and record bring Market, Alerts and Historical back and ten days old make them Delayed; the alert opens Apple Inc. research; ' : ''}the company page, the calculator and the dashboard each have one primary action, and the homepage, How it works and the checklist say "${words.join('", "')}"`);
}
/* ---- end audit1: registry-ctas ---- */
/* ---- audit1: registry-ctas-verify ---- */
/* THE VERIFIER'S CHECKS ON THE TOOL REGISTRY (audit 1, #2, #9), each one
   failing on the registry as first built (499a7e3).
   1. A control that opens a tool by script is gated as a link is. With
      data/us.json held back, no visible button or role=button on the
      research home, the research queue, a company page (both peer
      comparisons), the investment cases, the start page's screen goal, the
      workspace and the dashboard (a saved screen the newest thing) sends
      the reader to the screener, the value map, a comparison or the queue —
      judged by the route each press asks for, navigate() recording instead
      of moving, not by the registry's reading of it. The research home's
      five screener cards are text wearing Unavailable, its Sarawak card is
      still a button, and the dashboard's one primary action is not the
      "Continue" whose tool cannot be used.
   2. The watch on the page gates what is added after a page is drawn: an
      anchor to the Market and a button naming Historical, added to the page
      and to the drawer on the hosted site, are text a moment later.
   3. As production serves it, nothing on the pages below — sidebar, header,
      footer and tab rows included — links to the scanner's Market, Alerts
      or Historical, judged by the address; and no chip reads a status word.
   4. One primary action on every tab of the company page, on a list and
      not: the Valuation and Thesis tabs have primaries of their own.
   5. The registry reads a price history's newest bar once per history, not
      once per link: the alerts page, with 300 matches over a history of 200
      series of ten years, drew in 2.9s instead of 0.45s.
   6. The Saved Models page wears the registry's badge for its status.
   7. The dashboard's "Continue" is on the newest thing made (the first
      build's check had one item, so any row passed). */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const u = new URL(BASE);
  const ownMachine = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  const live = ownMachine ? `${u.protocol}//live.localhost${u.port ? ':' + u.port : ''}` : BASE;
  const p = [];
  const load = async (url) => {
    bucket = [];
    await ev('window.__rvMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__rvMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(400);
  };
  const clean = `(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('vl.plan', JSON.stringify('pro')); return true; })()`;
  const PRIMARIES = `[...document.querySelectorAll('#views .btn-primary, body > .dock .btn-primary')].filter(n => n.getClientRects().length).map(n => n.textContent.trim())`;
  /* Every visible button on the page pressed once, with navigate() writing
     down where it was sent instead of going; confirm, alert and prompt
     answered no. A press that asks for one of `views` is a control offering
     a tool that cannot be used. Buttons that destroy or export are left. */
  const PRESS = (views) => `(async () => {
    const out = []; const real = navigate, rc = window.confirm, ra = window.alert, rp = window.prompt;
    let seen = [];
    window.confirm = () => false; window.alert = () => {}; window.prompt = () => null;
    navigate = (to) => { seen.push(String(to)); };
    try {
      const btns = [...document.querySelectorAll('#views button, #views [role=button], body > .dock button')].filter(n => n.getClientRects().length && !n.disabled
        && n.getAttribute('role') !== 'tab' && !/delete|remove|clear|reset|forget|erase|archive|export|download|copy|print|import|restore|paste|undo|open your files|choose/i.test(n.textContent));
      for (const n of btns) {
        seen = [];
        try { n.click(); } catch { /* the press's own failure is not this check's */ }
        await new Promise(r => setTimeout(r, 30));
        for (const to of seen) { const v = matchRoute(to.split('?')[0])?.view;
          if (${JSON.stringify(views)}.includes(v)) out.push(location.pathname + ': "' + n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 44) + '" (' + n.tagName.toLowerCase() + ') opens ' + to); }
        if (typeof closeSheet === 'function') try { closeSheet({ restore: false }); } catch {}
        if (typeof closeDrawer === 'function') try { closeDrawer(); } catch {}
      }
    } finally { navigate = real; window.confirm = rc; window.alert = ra; window.prompt = rp; }
    return out; })()`;

  /* 1. With data/us.json held back. */
  const held = (e) => {
    const m = JSON.parse(e.data);
    if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
    send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
      body: Buffer.from('held back by the check').toString('base64') }, sessionId);
  };
  const OFF_VIEWS = ['discover', 'compare', 'researchQueue'];
  let pressed = 0;
  ws.addEventListener('message', held);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/us.json*', requestStage: 'Request' }] }, sessionId);
  try {
    await load(BASE + '/privacy');
    await ev(clean);
    const seedScreen = `(() => { State.savedScreens = [{ name: 'Verify screen', screen: blankScreen(), snapshot: { matches: [], saved: '2026-09-29', stamp: { savedAt: new Date().toISOString() } } }];
      store.write('savedScreens', State.savedScreens); render(); return true; })()`;
    for (const [path, before] of [['/research'], ['/research/queue'], ['/company/1155-malayan-banking-berhad'], ['/company/1155-malayan-banking-berhad?tab=business'],
      ['/my/theses'], ['/start', `State.launcher.goal = 'screen'; render(); true`], ['/my/workspace', seedScreen], ['/app']]) {
      await load(BASE + path);
      if ((await ev(`realStatus && realStatus.ok`)) !== false) { p.push(`us.json held back: the filings loaded on ${path} — the check is not testing the case`); continue; }
      if (before) { await ev(before); await sleep(300); }
      if (path === '/research') {
        const r = await ev(`({ off: [...document.querySelectorAll('#views .task-card.tool-off')].map(n => [n.querySelector('h3')?.textContent, !!n.querySelector('.status-unavailable'), n.getAttribute('role'), n.tabIndex]),
          swk: !!document.querySelector('#views .task-card[role=button][data-tool-path="/discover/sarawak"]') })`);
        if (r.off.length !== 5 || r.off.some(([, badge, role, tab]) => !badge || role || tab >= 0)) p.push(`us.json held back: the research home's screener cards are ${JSON.stringify(r.off)}, not five texts wearing Unavailable`);
        if (!r.swk) p.push('us.json held back: the research home\'s Sarawak card is no longer a button — its tool does not read the filings');
      }
      (await ev(PRESS(OFF_VIEWS))).forEach(x => p.push(`us.json held back: ${x}`));
      pressed++;
      if (path === '/app') {
        const r = await ev(`({ prim: ${PRIMARIES}, off: !!document.querySelector('#views .dash-continue.tool-off') })`);
        if (r.prim.length !== 1 || r.prim[0] === 'Continue' || !r.off) p.push(`us.json held back, a saved screen the newest thing: the dashboard's primary actions ${JSON.stringify(r.prim)}, its Continue ${r.off ? 'text' : 'not text'}`);
      }
    }
  } finally {
    await send('Fetch.disable', {}, sessionId);
    ws.removeEventListener('message', held);
    await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
  }

  /* 2 and 3. As production serves it. */
  const SCAN_OFF = /^\/app\/scanner\/(market|alerts|backtest)(\/|$)/;
  const PROD = ['/', '/how-it-works', '/app', '/research', '/company/msft-microsoft', '/app/scanner', '/app/scanner/setups', '/app/scanner/setups/new',
    '/app/scanner/watchlists', '/app/scanner/settings', '/research/trading-index', '/property/calculator', '/my/workspace', '/my/tracked', '/my/alerts'];
  for (const path of PROD) {
    await load(live + path);
    const r = await ev(`({ links: [...document.querySelectorAll('a[href], [data-tool-path]')].map(a => [a.tagName, a.getAttribute('data-tool-path') || new URL(a.href).pathname, a.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40)])
        .filter(([, at]) => ${SCAN_OFF}.test(at)),
      chips: [...document.querySelectorAll('.chip')].map(n => n.textContent.trim()).filter(t => /^(Live|Beta|Demo|Coming soon)$/.test(t)) })`);
    r.links.forEach(([tag, at, t]) => p.push(`production ${path}: a ${tag.toLowerCase()} to ${at} "${t}"`));
    r.chips.forEach(t => p.push(`production ${path}: a chip reads "${t}", a status written by hand`));
  }
  await load(live + '/app/scanner');
  const watch = await ev(`(async () => {
    const a = el('a', { href: href('/app/scanner/market'), class: 'rv-added' }, 'Market, added late');
    const b = el('button', { type: 'button', class: 'btn btn-ghost rv-added', 'data-tool-path': '/app/scanner/backtest' }, 'Historical, added late');
    const c = el('a', { href: href('/app/scanner/alerts'), class: 'rv-added' }, 'Alerts, in the drawer');
    document.querySelector('#views .shell').append(a, b);
    drawerBody.append(c);
    await new Promise(r => setTimeout(r, 60));
    const out = [...document.querySelectorAll('.rv-added')].map(n => [n.tagName, n.classList.contains('tool-off'), n.textContent.trim().slice(0, 30)]);
    document.querySelectorAll('.rv-added').forEach(n => n.remove());
    return out; })()`);
  if (watch.length !== 3 || watch.some(([tag, off]) => tag !== 'SPAN' || !off)) p.push(`production: what a page adds after it is drawn is ${JSON.stringify(watch)}, not three texts`);

  /* 4. One primary on every tab of the company page. */
  await load(BASE + '/privacy');
  await ev(clean);
  const tabs = await ev(`RESEARCH_TABS.map(t => t.id)`);
  let tabsSeen = 0;
  for (const listed of [false, true]) {
    if (listed) { await load(BASE + '/company/msft-microsoft'); await ev(`State.watchlist.includes('MSFT-SEC') || toggleWatch('MSFT-SEC'); true`); await sleep(300); }
    for (const t of tabs) {
      await load(BASE + `/company/msft-microsoft?tab=${t}`);
      const prim = await ev(PRIMARIES);
      tabsSeen++;
      if (prim.length !== 1) p.push(`company page, ${t} tab, ${listed ? 'on a list' : 'not on a list'}: primary actions ${JSON.stringify(prim)}`);
    }
  }

  /* 5. The history's newest bar, read once per history. */
  let reads = null;
  if (ownMachine) {
    await load(BASE + '/app/scanner');
    reads = await ev(`(async () => {
      const days = []; for (let d = Date.parse('2016-01-04'); d <= Date.parse('2026-09-25'); d += 864e5) { const w = new Date(d).getUTCDay(); if (w && w < 6) days.push(new Date(d).toISOString().slice(0, 10)); }
      const series = {}; for (let i = 0; i < 200; i++) series['RV' + i] = Object.fromEntries(days.map((d, j) => [d, 100 + j * 0.01]));
      scanHistoryFile = { generated: '2026-09-26T00:00:00Z', series };
      scanAlertsFile = { alerts: Array.from({ length: 300 }, (_, i) => ({ id: 'b' + String(i).padStart(8, '0'), key: 'rv|RV' + (i % 200) + '|1D|' + i, setupId: 'rv', setupName: 'Verify', setupVersion: 1,
        symbol: 'RV' + (i % 200), candleDate: '2026-09-25', timeframe: '1D', eventType: 'NEW_MATCH', close: 1, detectedAt: '2026-09-26T01:00:00Z' })) };
      const real = scanOpsHistoryMeta; let n = 0;
      scanOpsHistoryMeta = (h) => { n++; return real(h); };
      const t0 = performance.now(); navigate('/app/scanner/alerts'); const ms = performance.now() - t0;
      const links = document.querySelectorAll('#views a[href*="/app/scanner/alerts/"]').length;
      scanOpsHistoryMeta = real; scanHistoryFile = null; scanAlertsFile = null;
      return { n, ms: Math.round(ms), links }; })()`);
    if (reads.links < 20 || reads.n > 3) p.push(`the alerts page with ${reads.links} links to its matches read the history's newest bar ${reads.n} times (${reads.ms}ms) — once per link, not once per history`);
  }

  /* 6. Saved Models' status, from the registry. */
  await load(BASE + '/my/workspace');
  const ws6 = await ev(`(() => { const s = toolState('saved'); const b = document.querySelector('#views .ws-limits .status-badge');
    return { want: [s.label, s.note], got: b ? [b.textContent.trim(), b.title] : null,
      chips: [...document.querySelectorAll('#views .ws-limits .chip')].map(n => n.textContent.trim()) }; })()`);
  if (JSON.stringify(ws6.got) !== JSON.stringify(ws6.want) || ws6.chips.some(t => /^(Live|Beta|Demo|Coming soon)$/.test(t)))
    p.push(`Saved Models' status: badge ${JSON.stringify(ws6.got)}, chips ${JSON.stringify(ws6.chips)} — want the registry's ${JSON.stringify(ws6.want[0])}`);

  /* 7. "Continue" is on the newest thing, not the first one made: a list
     made in January and a screen saved now — Continue opens the screen,
     the page's one primary action, and the list is a quiet row below it. */
  await ev(clean);
  await load(BASE + '/privacy');
  await ev(`(() => { const w = wlCreate('Verify older list').watchlist; wlAdd(w.id, 'MSFT-SEC');
    const x = State.watchlists.find(v => v.id === w.id); x.createdAt = x.updatedAt = '2026-01-05T09:00:00Z'; saveWatchlists();
    State.savedScreens = [{ name: 'Verify newer screen', screen: blankScreen(), snapshot: { matches: [], saved: '2026-09-29', stamp: { savedAt: new Date().toISOString() } } }];
    store.write('savedScreens', State.savedScreens); return true; })()`);
  await load(BASE + '/app');
  const cont7 = await ev(`({ prim: ${PRIMARIES}, first: document.querySelector('#views .dash-row-first')?.textContent || '',
    rows: [...document.querySelectorAll('#views .dash-cont > li')].map(li => li.querySelector('strong')?.textContent) })`);
  if (cont7.prim.length !== 1 || cont7.prim[0] !== 'Continue' || !/Verify newer screen/.test(cont7.first) || cont7.rows.indexOf('Verify older list') < 1)
    p.push(`dashboard, an older list and a newer screen: primary ${JSON.stringify(cont7.prim)} on "${cont7.first.slice(0, 60)}", rows ${JSON.stringify(cont7.rows)}`);
  await ev(clean);

  if (p.length) { bad++; console.log(`FAIL registry-ctas-verify: controls that open a tool by script, what a page adds late, one primary on every company tab, the history read once, statuses from the registry (${p.length} problems)`); p.slice(0, 60).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   registry-ctas-verify: with us.json held back no button on ${pressed} pages opens the screener, the value map, a comparison or the queue — the research home's screener cards and a saved screen's Continue are text; as production serves it ${PROD.length} pages link nowhere near the scanner's Market, Alerts or Historical, write no status by hand, and what a page or the drawer adds late is gated; one primary action on each of ${tabsSeen} company tabs; ${reads ? `the alerts page's ${reads.links} links read the history's newest bar ${reads.n} time${reads.n === 1 ? '' : 's'} (${reads.ms}ms); ` : ''}Saved Models wears the registry's badge; the dashboard's Continue is on the newest thing made`);
}
/* ---- end audit1: registry-ctas-verify ---- */
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
