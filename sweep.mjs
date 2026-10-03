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
      /* Through about:blank first: the page before this one (the owner's
         machine, asking for the personal lane) can still be answering when
         the next navigation starts, and its 404s — on localhost, not on this
         page's host — were counted against this page. */
      await send('Page.navigate', { url: 'about:blank' }, sessionId);
      await sleep(400);
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
   inline — but a company's own address has had a page of its own since
   Release B (build.mjs, ONE HEAD PER COMPANY), so a ticker (/company/aapl)
   is the parameter route's sample here, and Apple's own address a page's.
   Both must run under the one policy vercel.json sends: the inline
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
  const kinds = [['/', 'inline'], ['/company/aapl', 'inline'], ['/pricing', 'file'], ['/property/calculator', 'file'], ['/company/aapl-apple-inc', 'file'], ['/nope-for-the-slim-sweep', 'file']];
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
  else console.log(`ok   slim: / and a parameter route run the app inline, a route page, a company's own page and the 404 run it from assets/ under the same policy with the same ${[...rules][0]} style rules; with the script 1.5s late the page paints first, then draws with no error and a layout shift of at most ${worst.toFixed(3)} at 390 and 1280`);
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

  /* The placeholder the repository started with — health/journeys.json before
     any run — served as a fixture. The journeys workflow commits each run over
     the file (6e52922 was its first), so what is committed cannot be assumed:
     reading it as committed failed this check, and every CI run after it, the
     moment production was first tested. */
  serve = { status: 200, body: { kind: 'quantum-tradeworks-journeys', schema: 1, ranAt: null, url: null, commit: null, commitFrom: null, journeys: [],
    note: 'No run recorded yet. .github/workflows/journeys.yml replaces this file with the result of journeys.mjs --url production after its first run; /status reads it and says not run yet until then.' } };
  let s = await open();
  if (s.h2 !== 'Does each tool work?') p.push(`/status has no "Does each tool work?" section (${JSON.stringify(s.h2)})`);
  const quickSaid = (q) => q.map(x => `${x.status}: ${x.text.replace(/\s+/g, ' ').slice(0, 110)}`).join(' | ');
  if (s.quick.length !== 4 || s.quick.some(q => q.status !== 'PASS')) p.push(`the in-browser checks on this build: ${quickSaid(s.quick)}`);
  if (!/^4 of 4 pass\./.test(s.quickSum)) p.push(`the in-browser summary reads ${JSON.stringify(s.quickSum)}`);
  if (!/^Not run yet\./.test(s.sum) || s.rows.length) p.push(`the placeholder: ${JSON.stringify(s.sum.slice(0, 80))}, ${s.rows.length} rows — not "not run yet"`);
  if (!s.asked) p.push('/status never asked the site for health/journeys.json');
  if (!s.modes.length || s.modes.some(m => m !== 'no-store')) p.push(`/status asks for health/journeys.json with cache ${JSON.stringify(s.modes)}, not no-store`);

  /* The file as committed, whatever the last run recorded: either the
     placeholder or a dated run — never unreadable, never an invented result. */
  serve = null;
  {
    const c = await open();
    if (!/^(Not run yet\.|Last recorded run )/.test(c.sum)) p.push(`the committed health/journeys.json reads ${JSON.stringify(c.sum.slice(0, 90))}, not "not run yet" or a dated run`);
    if (!c.asked) p.push('/status never asked the site for the committed health/journeys.json');
  }

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
        tabs: [...document.querySelectorAll('#productTabs .scan-subnav .ptab')].map(n => [n.tagName, n.textContent.replace(/\\s+/g, ' ').trim()]) })`);
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
          links: ['Market', 'Alerts', 'Historical'].map(l => { const n = [...document.querySelectorAll('#productTabs .scan-subnav .ptab')].find(x => x.textContent.startsWith(l)); return n ? n.tagName + (n.parentElement.querySelector('.status-delayed') ? '+delayed' : '') : null; }) });
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
          const badges = document.querySelectorAll('#productTabs .scan-subnav .status-delayed').length;
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
  /* On the production-like host (live.localhost): on the owner's machine the
     worker's own files are the reader's work, so /app there is never a first
     visit, whatever this browser's storage holds. */
  const LIVE = (() => { const u = new URL(BASE); return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? `${u.protocol}//live.localhost${u.port ? ':' + u.port : ''}` : BASE; })();
  await load(LIVE + '/app'); await ev(clean);
  await load(LIVE + '/app');
  const dash1 = await ev(`({ prim: ${PRIMARIES}, first: !!document.querySelector('#views .dash-start') })`);
  await ev(`(() => { const w = wlCreate('Registry check list'); wlAdd(w.watchlist.id, 'MSFT-SEC'); return true; })()`);
  await load(LIVE + '/app');
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
  await load(LIVE + '/app'); await ev(clean);
  await load(LIVE + '/app');
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
/* ---- releaseB: D ---- */
/* EVERY COMPANY'S OWN ADDRESS IS SERVED THE HEAD ITS PAGE SETS (Release B,
   D1 and D2). build.mjs writes a page per company at the address companyPath
   gives it, from the router and the loader it reads out of src/js, and
   served-check.mjs holds what is served to that reading, offline. This holds
   it to the app itself, running here with its filings loaded, so the two
   cannot share a mistake:
   - the companies the page holds are exactly those the build wrote pages
     for, each at the address the page's own companyPath gives it, which the
     page's own resolver reads back to that company — the page a preview
     names is the page the address opens;
   - each address is served the title and canonical the page's
     setDocumentMeta sets for that company on a cold load of it (the company
     resolved from the address, the snapshot tab), og: and twitter: tags
     repeating them and no robots tag; and a description that ends with the
     page's own line and leads with the company as the page holds it — its
     name, its ticker (and on Bursa its code), where it is listed, and "filed
     with the SEC" with its CIK for a filer, the page's illustrative line for
     a synthetic one;
   - a company of each kind, opened cold — a filer, a filer whose ticker has
     a hyphen, a Bursa company, a US listing with illustrative figures, a
     Bursa code with a letter in it — draws its company page, not the
     not-found card, with the title and canonical it was served. */
{
  const evalValue = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId)).result?.result?.value;
  const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const TAGS = { title: /<title>([^<]*)<\/title>/, description: /<meta name="description" content="([^"]*)">/,
    canonical: /<link rel="canonical" href="([^"]*)">/, ogUrl: /<meta property="og:url" content="([^"]*)">/,
    ogTitle: /<meta property="og:title" content="([^"]*)">/, ogDescription: /<meta property="og:description" content="([^"]*)">/,
    twitterTitle: /<meta name="twitter:title" content="([^"]*)">/, twitterDescription: /<meta name="twitter:description" content="([^"]*)">/,
    robots: /<meta name="robots" content="([^"]*)">/ };
  /* The HTML as a preview reads it, before any script. */
  const served = async (path) => {
    const r = await fetch(BASE + path, { redirect: 'manual' });
    const html = await r.text();
    const top = html.slice(0, Math.max(0, html.indexOf('</head>')));
    return { status: r.status, ...Object.fromEntries(Object.entries(TAGS).map(([k, re]) => { const m = top.match(re); return [k, m ? decode(m[1]) : null]; })) };
  };
  const at = (u) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return String(u); } };
  /* Opened cold, and read once the router has settled with the filings in. */
  const open = async (path) => {
    await evalValue('window.__companyHeadMark = 1');
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 150; i++) {
      if (await evalValue(`!window.__companyHeadMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break;
      await sleep(100);
    }
    await sleep(300);
    return evalValue(`({ view: State.view, ticker: State.ticker, title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null })`);
  };
  const p = [];
  /* The page's universe once its filings are in, and for each company what a
     cold load of its own address sets: applyRoute's resolution of the
     address, the snapshot tab, setDocumentMeta. Run on a page opened for the
     purpose, whose head the next navigation replaces. */
  await open('/research');
  const ILLUS = await evalValue('ILLUS_TITLE');
  const live = await evalValue(`U.map(r => {
      const c = r.c, path = companyPath(c), route = matchRoute(path);
      State.ticker = companyFromSlug(path.split('/').pop());
      State.researchTab = 'snapshot';
      setDocumentMeta(route);
      return { id: c.id, path, resolves: State.ticker, view: route ? route.view : null, title: document.title,
        canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? null,
        name: c.name, tk: c.tk, code: c.code || null, mkt: c.mkt, real: !!c.real, personal: !!c.personal, cik: c.cik || null };
    })`) || [];
  if (live.length < 100) p.push(`the page holds ${live.length} companies — its filings did not load`);
  /* The companies the build wrote pages for, read as the build reads them. */
  const { readFileSync } = await import('node:fs');
  const { companyPlan, siteOrigin } = await import('./build.mjs');
  const plan = companyPlan(siteOrigin(readFileSync(new URL('./src/index.template.html', import.meta.url), 'utf8'))).companies;
  const built = new Map(plan.map(c => [c.path, c.id])), held = new Map(live.map(c => [c.path, c.id]));
  for (const [path, id] of held) if (built.get(path) !== id) p.push(`${path}: the page holds ${id} there, and the build wrote ${built.has(path) ? `${built.get(path)}'s page` : 'no page'}`);
  for (const [path, id] of built) if (!held.has(path)) p.push(`${path}: the build wrote ${id}'s page there, and the page holds no company at that address`);
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const c of live) {
    if (c.resolves !== c.id) p.push(`${c.path}: the page's resolver reads it as ${c.resolves}, not ${c.id} — its head would name a company the address does not open`);
    if (c.view !== 'research') p.push(`${c.path}: the router opens ${c.view} there, not the company page`);
    const s = await served(c.path);
    if (s.status !== 200) { p.push(`${c.path}: served ${s.status}`); continue; }
    if (s.title !== c.title) p.push(`${c.path}: served title ${JSON.stringify(s.title)}, the page sets ${JSON.stringify(c.title)}`);
    if (at(s.canonical) !== at(c.canonical) || at(s.canonical) !== c.path) p.push(`${c.path}: served canonical ${s.canonical}, the page sets ${c.canonical}`);
    if (s.ogUrl !== s.canonical || s.ogTitle !== s.title || s.twitterTitle !== s.title) p.push(`${c.path}: og:url ${s.ogUrl}, og:title ${JSON.stringify(s.ogTitle)}, twitter:title ${JSON.stringify(s.twitterTitle)} do not repeat the canonical and the title`);
    if (s.ogDescription !== s.description || s.twitterDescription !== s.description) p.push(`${c.path}: og:description or twitter:description does not repeat the description`);
    /* noindex exactly where the figures are illustrative (the owner, 2026-10-03). */
    if ((s.robots || null) !== (c.real ? null : 'noindex')) p.push(`${c.path}: served with robots ${JSON.stringify(s.robots || null)}, not ${c.real ? 'none (its figures are filed)' : '"noindex" (its figures are illustrative)'}`);
    const d = s.description || '';
    if (d !== c.description) p.push(`${c.path}: served the description ${JSON.stringify(d.slice(0, 90))}, the page sets ${JSON.stringify(String(c.description).slice(0, 90))}`);
    const where = { US: 'listed in the US', MY: 'listed on Bursa Malaysia' }[c.mkt];
    const named = d.startsWith(`${c.name} (`) && new RegExp(`^${esc(c.name)} \\(${esc(c.tk)}[,)]`).test(d)
      && (c.mkt !== 'MY' || !c.code || c.code === c.tk || d.includes(`, ${c.code}), `));
    if (!named || !where || !d.includes(`), ${where}. `)) p.push(`${c.path}: the description does not lead with ${c.name}, ${c.tk}${c.mkt === 'MY' ? ` and ${c.code}` : ''} and ${where || `market ${c.mkt}`} — "${d.slice(0, 110)}"`);
    const filed = c.real && !c.personal;
    const saysFiled = /filed with the SEC/.test(d);
    if (filed !== saysFiled || (filed && !d.includes(`(CIK ${Number(c.cik)})`))) p.push(`${c.path}: ${filed ? `a filer (CIK ${Number(c.cik)})` : 'not a filer'}, and its description ${saysFiled ? 'says' : 'does not say'} "filed with the SEC"${filed && saysFiled ? ' with another CIK' : ''}`);
    if (!c.real !== d.includes(ILLUS)) p.push(`${c.path}: ${c.real ? 'filed' : 'illustrative'}, and its description ${d.includes(ILLUS) ? 'carries' : 'does not carry'} the page's illustrative line`);
  }
  /* One company of each kind, opened cold. */
  const kinds = [['a filer', c => c.real && !c.tk.includes('-')], ['a filer whose ticker has a hyphen', c => c.real && c.tk.includes('-')],
    ['a Bursa company', c => !c.real && c.mkt === 'MY'], ['a US listing with illustrative figures', c => !c.real && c.mkt === 'US'],
    ['a Bursa code with a letter in it', c => c.mkt === 'MY' && /[A-Z]/.test(c.code || '')]];
  const opened = [];
  for (const [kind, is] of kinds) {
    const c = live.find(is);
    if (!c) { if (/^a (filer|Bursa company)$/.test(kind)) p.push(`the page holds no ${kind.slice(2)}`); continue; }
    const s = await served(c.path), o = await open(c.path);
    opened.push(c.path);
    if (!o || o.view !== 'research' || o.ticker !== c.id) { p.push(`${c.path} (${kind}), opened cold: ${o?.view} for ${o?.ticker}, not ${c.id}'s company page`); continue; }
    if (o.title !== s.title) p.push(`${c.path} (${kind}), opened cold: the page sets the title ${JSON.stringify(o.title)}, and was served ${JSON.stringify(s.title)}`);
    if (at(o.canonical) !== at(s.canonical)) p.push(`${c.path} (${kind}), opened cold: the page sets the canonical ${o.canonical}, and was served ${s.canonical}`);
    if ((o.robots || null) !== (c.real ? null : 'noindex') || (o.robots || null) !== (s.robots || null)) p.push(`${c.path} (${kind}), opened cold: robots ${JSON.stringify(o.robots || null)}, served ${JSON.stringify(s.robots || null)} — want ${c.real ? 'none' : 'noindex'} on both`);
    if ((s.description || '') !== o.description) p.push(`${c.path} (${kind}), opened cold: the page sets a description other than the one it was served`);
  }
  /* While the filings load, the served head stands: an address can resolve
     to an illustrative stand-in then, and the head named it for a moment. */
  const hold = await evalValue(`(() => {
    const read = () => ({ title: document.title, canon: document.querySelector('link[rel=canonical]')?.getAttribute('href'), desc: document.querySelector('meta[name="description"]')?.getAttribute('content') });
    const before = read(), keep = { rp: realPending, t: State.ticker };
    const stand = U.find(r => !r.c.real && r.c.mkt === 'US') || U.find(r => !r.c.real);
    try { realPending = true; State.ticker = stand.c.id; setDocumentMeta(matchRoute(companyPath(stand.c))); return { before, after: read(), id: stand.c.id }; }
    finally { realPending = keep.rp; State.ticker = keep.t; }
  })()`);
  if (!hold || JSON.stringify(hold.before) !== JSON.stringify(hold.after)) p.push(`while the filings load, setDocumentMeta rewrote the head for ${hold?.id}: ${JSON.stringify(hold).slice(0, 240)}`);
  const nFiled = live.filter(c => c.real && !c.personal).length;
  if (p.length) { bad++; console.log(`FAIL company heads: a company's own address is not served the head its page sets (${p.length} problems)`); p.slice(0, 25).forEach(x => console.log('     ' + x)); if (p.length > 25) console.log(`     … and ${p.length - 25} more`); }
  else console.log(`ok   company heads: the ${live.length} companies the page holds with its filings in (${nFiled} filed with the SEC, ${live.length - nFiled} illustrative) are the ${plan.length} the build wrote pages for, each at the address the page's companyPath gives it and its resolver reads back; each is served the title and canonical the page's setDocumentMeta sets there, og: and twitter: repeating them, and the page's own description led by the company's name, ticker, market and source; ${opened.length} opened cold (${opened.join(', ')}) draw their company page with the head they were served`);
}
/* ---- end releaseB: D ---- */
/* ---- releaseB: layouts-onboarding ---- */
/* ONE PRODUCT HEADER, ONE WORKSPACE HEADER, ONE PAGE HEAD; A START HERE
   PANEL PER PRODUCT; AN EMPTY STATE THAT SAYS WHAT TO DO (Release B, B5, B6).
   B5. Every page of Equities, the Scanner and Property wears the shell's
   product header — the product's name and badge, and ONE row of tabs read
   from TOOLS with the page's own tab current — and no nav inside the page
   repeats those tabs (the Scanner drew a second strip of its own, from its
   own table, with labels the registry did not use). Every My Workspace page
   wears the workspace header, its tabs the workspace's tools. The head of
   every one of those pages is the one pattern: an eyebrow saying where the
   page sits (the product, or My workspace), the h1, and a lede of one line;
   and a product page offers at most one primary action.
   B6. In a browser that has hidden nothing, each product's pages open with
   a Start here panel above the head: what the product does, its one action,
   what the reader gets, a labelled example that opens (Apple's filed
   report, the example setup, the sample property) and a control that hides
   it — a region of the page, never a dialog, and never a primary button.
   Hidden on one product it is gone from that product's every page, and stays
   gone across a reload, while the others keep theirs; it is on no public or
   workspace page; Your data & settings says which are hidden and brings them
   back. And every workspace page, emptied, says what to do next with one
   action. */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (url) => {
    bucket = [];
    await ev('window.__loMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__loMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(400);
  };
  const u = new URL(BASE);
  const LIVE = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? `${u.protocol}//live.localhost${u.port ? ':' + u.port : ''}` : BASE;
  const p = [];
  const clean = `(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('vl.plan', JSON.stringify('pro')); return true; })()`;
  const PRIMARIES = `[...document.querySelectorAll('#views .btn-primary, body > .dock .btn-primary')].filter(n => n.getClientRects().length).map(n => n.textContent.trim())`;
  /* A tab's own words: a link's text, or — where the gate made it text —
     the words before its badge; an unread count after " · " is the tab's
     own too, but not its name. */
  const HEADER = `(() => {
    const host = document.querySelector('#productTabs');
    const navs = host && !host.hidden ? [...host.querySelectorAll('nav')] : [];
    const nav = navs[0] || null;
    const tabs = nav ? [...nav.querySelectorAll('.ptabs-list > li > .ptab')] : [];
    const word = (n) => (n.childNodes[0]?.textContent || '').trim().replace(/ · \\d+\\+?$/, '');
    const name = nav?.querySelector('.ptabs-name');
    return { navs: navs.length, name: name ? (name.childNodes.length ? [...name.childNodes].filter(c => !c.classList?.contains('status-badge')).map(c => c.textContent).join('').trim() : '') : null,
      badge: name?.querySelector('.status-badge')?.textContent.trim() || null,
      tabs: tabs.map(word), current: tabs.filter(n => n.getAttribute('aria-current') === 'page').map(word),
      hrefs: tabs.map(n => n.getAttribute('href')).filter(Boolean).map(h => new URL(h, location.href).pathname) };
  })()`;
  const HEAD = `(() => {
    const hd = document.querySelector('#views .page-hd');
    const h1 = document.querySelector('#views h1');
    const lede = hd?.querySelector('.page-lede');
    const lh = lede ? parseFloat(getComputedStyle(lede).lineHeight) || 24 : 0;
    return { hd: !!hd, h1: h1 ? h1.textContent.trim() : null, h1InHead: !!(hd && h1 && hd.contains(h1)),
      eyebrow: hd?.querySelector('.eyebrow')?.textContent.trim() || null,
      lede: lede ? lede.textContent.trim() : null, lines: lede ? Math.round(lede.getBoundingClientRect().height / lh) : 0 };
  })()`;
  /* A nav inside the page carrying two or more of the header's own tabs is
     the second strip. */
  const REPEATS = (hrefs) => `[...document.querySelectorAll('#views nav')].filter(n => {
      const at = [...n.querySelectorAll('a[href]')].map(a => new URL(a.href).pathname);
      return ${JSON.stringify(hrefs)}.filter(h => at.includes(h)).length >= 2; }).map(n => n.getAttribute('aria-label') || n.className)`;

  const PRODUCT_PAGES = [
    ['equities', ['/research', '/discover/screener', '/discover/value-map', '/compare', '/research/queue', '/discover/sarawak', '/us-options/wheel']],
    ['scanner', ['/app/scanner', '/app/scanner/market', '/app/scanner/setups', '/app/scanner/setups/new', '/app/scanner/alerts',
      '/app/scanner/backtest', '/app/scanner/watchlists', '/app/scanner/settings', '/research/trading-index']],
    ['property', ['/property/models', '/property/calculator', '/property/areas', '/property/comparables', '/property/opportunities']],
  ];
  /* My Alerts is being rebuilt beside this (Release B, B1): it is held to
     the workspace header, which the shell draws, and not to a head its own
     branch is writing. */
  const WORK_PAGES = ['/app', '/my/watchlists', '/my/alerts', '/my/workspace', '/my/portfolio', '/my/theses', '/my/tracked', '/my/data'];
  const OWN_HEAD_ELSEWHERE = new Set(['/my/alerts']);

  /* B5. The headers and the heads — with every Start here hidden, so what
     is measured is the page, not the panel above it. */
  await load(BASE + '/privacy'); await ev(clean);
  await ev(`localStorage.setItem('vl.startHere', JSON.stringify({ equities: '2026-09-30T00:00:00Z', scanner: '2026-09-30T00:00:00Z', property: '2026-09-30T00:00:00Z' })); true`);
  let pagesSeen = 0;
  for (const [pid, paths] of PRODUCT_PAGES) {
    for (const path of paths) {
      await load(BASE + path);
      pagesSeen++;
      const r = await ev(`({ view: State.view, h: ${HEADER}, head: ${HEAD}, prim: ${PRIMARIES},
        want: { name: productById(${JSON.stringify(pid)}).name, badge: PRODUCT_STATUS[productById(${JSON.stringify(pid)}).status],
          tabs: productTabs(${JSON.stringify(pid)}).map(t => t.label), here: productTabs(${JSON.stringify(pid)}).filter(t => t.views.includes(State.view)).map(t => t.label),
          paths: productTabs(${JSON.stringify(pid)}).map(t => href(t.path)) } })`);
      const { h, head, want } = r;
      if (h.navs !== 1) p.push(`${path}: ${h.navs} navs in the product header, not one`);
      else {
        if (h.name !== want.name || h.badge !== want.badge) p.push(`${path}: the header names ${JSON.stringify(h.name)} ${JSON.stringify(h.badge)}, not ${want.name} ${want.badge}`);
        if (JSON.stringify(h.tabs) !== JSON.stringify(want.tabs)) p.push(`${path}: the header's tabs ${JSON.stringify(h.tabs)} are not the registry's ${JSON.stringify(want.tabs)}`);
        if (JSON.stringify(h.current) !== JSON.stringify(want.here)) p.push(`${path}: the current tab is ${JSON.stringify(h.current)}, not ${JSON.stringify(want.here)}`);
      }
      const again = await ev(REPEATS(want.paths));
      if (again.length) p.push(`${path}: a second strip in the page repeats the header's tabs (${again.join(', ')})`);
      if (!head.hd || !head.h1InHead) p.push(`${path}: the h1 "${head.h1}" is not in the page head`);
      if (head.eyebrow !== want.name) p.push(`${path}: the eyebrow reads ${JSON.stringify(head.eyebrow)}, not "${want.name}"`);
      if (!head.lede || head.lines !== 1) p.push(`${path}: the lede ${head.lede ? `is ${head.lines} lines ("${head.lede.slice(0, 70)}…")` : 'is missing'}, not one line`);
      if (r.prim.length > 1) p.push(`${path}: ${r.prim.length} primary actions (${r.prim.join(', ')})`);
    }
  }
  for (const path of WORK_PAGES) {
    await load(BASE + path);
    pagesSeen++;
    const r = await ev(`({ h: ${HEADER}, head: ${HEAD}, want: { tabs: TOOLS.filter(t => t.product === null && toolPresent(t)).map(t => t.label),
      here: TOOLS.filter(t => t.product === null && toolPresent(t) && toolViews(t).includes(State.view)).map(t => t.label),
      paths: TOOLS.filter(t => t.product === null && toolPresent(t)).map(t => href(t.path)) } })`);
    const { h, head, want } = r;
    if (h.navs !== 1) p.push(`${path}: ${h.navs} navs in the workspace header, not one`);
    else {
      if (h.name !== 'My workspace' || h.badge) p.push(`${path}: the header names ${JSON.stringify(h.name)}${h.badge ? ` with a badge ${h.badge}` : ''}, not "My workspace"`);
      if (JSON.stringify(h.tabs) !== JSON.stringify(want.tabs)) p.push(`${path}: the workspace tabs ${JSON.stringify(h.tabs)} are not the registry's ${JSON.stringify(want.tabs)}`);
      if (JSON.stringify(h.current) !== JSON.stringify(want.here)) p.push(`${path}: the current tab is ${JSON.stringify(h.current)}, not ${JSON.stringify(want.here)}`);
    }
    const again = await ev(REPEATS(want.paths));
    if (again.length) p.push(`${path}: a second strip in the page repeats the workspace tabs (${again.join(', ')})`);
    if (OWN_HEAD_ELSEWHERE.has(path)) continue;
    if (!head.hd || !head.h1InHead) p.push(`${path}: the h1 "${head.h1}" is not in the page head`);
    if (head.eyebrow !== 'My workspace') p.push(`${path}: the eyebrow reads ${JSON.stringify(head.eyebrow)}, not "My workspace"`);
    if (!head.lede || head.lines !== 1) p.push(`${path}: the lede ${head.lede ? `is ${head.lines} lines ("${head.lede.slice(0, 70)}…")` : 'is missing'}, not one line`);
  }
  /* The Scanner's Alerts tab keeps the unread count its own strip carried,
     in its words and its name. */
  await load(BASE + '/app/scanner/setups');
  const unread = await ev(`(async () => {
    const keep = [scanAlertsFile, store.read('scanAlertState', null)];
    scanAlertsFile = { alerts: [{ id: 'a0lo00001', key: 'lo-check|AAPL|1D|2026-09-25', setupId: 'lo-check', setupName: 'Layout check', setupVersion: 1, symbol: 'AAPL',
      candleDate: '2026-09-25', timeframe: '1D', eventType: 'NEW_MATCH', close: 230, detectedAt: '2026-09-26T01:00:00Z' }] };
    store.write('scanAlertState', {}); render(); await new Promise(r => setTimeout(r, 150));
    const a = [...document.querySelectorAll('#productTabs .ptab')].find(n => (n.getAttribute('href') || '').endsWith('/app/scanner/alerts'));
    const out = a ? [a.textContent.trim(), a.getAttribute('aria-label')] : null;
    scanAlertsFile = keep[0]; if (keep[1] == null) localStorage.removeItem('vl.scanAlertState'); else store.write('scanAlertState', keep[1]); render();
    return out; })()`);
  if (!unread || unread[0] !== 'Alerts · 1' || unread[1] !== 'Alerts, 1 unread') p.push(`the Scanner's Alerts tab with one unread match reads ${JSON.stringify(unread)}, not "Alerts · 1" named "Alerts, 1 unread"`);

  /* B6. The Start here panels, from a browser that has hidden nothing. */
  await ev(clean);
  const PANEL = `(() => {
    const n = document.querySelector('#views .start-here');
    if (!n) return null;
    const hd = document.querySelector('#views .page-hd');
    const go = n.querySelector('.start-here-go'), ex = n.querySelector('.start-here-ex'), hide = n.querySelector('.start-here-hide');
    return { product: n.dataset.product || null, name: n.getAttribute('aria-label') || '', role: n.getAttribute('role'), modal: n.hasAttribute('aria-modal'),
      above: !!(hd && (n.compareDocumentPosition(hd) & Node.DOCUMENT_POSITION_FOLLOWING)), text: n.innerText.replace(/\\s+/g, ' '),
      go: go ? { tag: go.tagName, text: go.textContent.trim(), href: go.getAttribute('href') } : null,
      ex: ex ? { tag: ex.tagName, text: ex.textContent.trim().replace(/\\s+/g, ' '), href: ex.getAttribute('href') } : null,
      hide: hide ? { tag: hide.tagName, name: hide.getAttribute('aria-label') || hide.textContent.trim() } : null,
      primaries: n.querySelectorAll('.btn-primary').length };
  })()`;
  const FIRST = [['equities', '/research', /Apple/, /filed|SEC/i], ['scanner', '/app/scanner', /Trend breakout/, /example/i], ['property', '/property/models', /sample/i, /sample|illustrative/i]];
  for (const [pid, path, exWords, exLabel] of FIRST) {
    await load(BASE + path);
    const r = await ev(`({ panel: ${PANEL}, want: { name: productById(${JSON.stringify(pid)}).name, action: productById(${JSON.stringify(pid)}).action, at: href(productById(${JSON.stringify(pid)}).actionPath) } })`);
    const x = r.panel;
    if (!x) { p.push(`${path}: no Start here panel for ${r.want.name} in a browser that has hidden nothing`); continue; }
    if (x.product !== pid || !/Start here/.test(x.name) || !x.name.includes(r.want.name)) p.push(`${path}: the panel is ${JSON.stringify([x.product, x.name])}, not Start here for ${r.want.name}`);
    if (x.role === 'dialog' || x.role === 'alertdialog' || x.modal) p.push(`${path}: the panel is a dialog (${x.role}${x.modal ? ', aria-modal' : ''})`);
    if (!x.above) p.push(`${path}: the panel is not at the top, above the page's head`);
    if (x.primaries) p.push(`${path}: the panel carries ${x.primaries} primary button(s) — the page's own action stays the one primary`);
    if (!x.go || x.go.text !== r.want.action) p.push(`${path}: the panel's action is ${JSON.stringify(x.go)}, not "${r.want.action}"`);
    else if (x.go.href && x.go.href !== r.want.at) p.push(`${path}: "${r.want.action}" links to ${x.go.href}, not ${r.want.at}`);
    if (!x.ex || !exWords.test(x.ex.text) || !exLabel.test(x.text)) p.push(`${path}: the example is ${JSON.stringify(x.ex)} — want ${exWords} labelled ${exLabel}`);
    if (!x.hide || !/Start here/i.test(x.hide.name) || x.hide.tag !== 'BUTTON') p.push(`${path}: the control that hides it is ${JSON.stringify(x.hide)}`);
    if (x.text.length > 700) p.push(`${path}: the panel runs to ${x.text.length} characters — compact is a few lines`);
  }
  /* Each example opens what it names. */
  await load(BASE + '/research');
  if (await ev(`!!document.querySelector('#views .start-here .start-here-ex')`)) {
    await ev(`document.querySelector('#views .start-here .start-here-ex').click(); true`); await sleep(900);
    const ex1 = await ev(`({ view: State.view, name: BY_ID.get(State.ticker)?.c.name || '', real: !!BY_ID.get(State.ticker)?.c.real })`);
    if (ex1.view !== 'researchReport' || !/Apple/.test(ex1.name) || !ex1.real) p.push(`Apple's filed report, pressed, opens ${JSON.stringify(ex1)}`);
  }
  await load(BASE + '/app/scanner');
  if (await ev(`!!document.querySelector('#views .start-here .start-here-ex')`)) {
    await ev(`document.querySelector('#views .start-here .start-here-ex').click(); true`); await sleep(900);
    const ex2 = await ev(`({ view: State.view, name: (typeof scanDraft !== 'undefined' && scanDraft?.name) || '', want: SCAN_EXAMPLES.setups.find(x => x.id === 'trend-breakout')?.name,
      picked: document.querySelector('#views [aria-label="Start from an example"]')?.value || '', note: /an illustration of the syntax, not a suggestion/.test(document.querySelector('#views')?.innerText || '') })`);
    if (ex2.view !== 'scannerSetupNew' || ex2.name !== ex2.want || ex2.picked !== 'trend-breakout' || !ex2.note) p.push(`the example setup, pressed, opens ${JSON.stringify(ex2)}`);
  }
  await load(BASE + '/property/models');
  if (await ev(`!!document.querySelector('#views .start-here .start-here-ex')`)) {
    await ev(`document.querySelector('#views .start-here .start-here-ex').click(); true`); await sleep(900);
    const ex3 = await ev(`({ view: State.view, project: State.deal?.projectId || null, price: State.deal?.price ?? null,
      want: pmSampleDeal().projectId || null, wantPrice: pmSampleDeal().price ?? null })`).catch(e => ({ error: e.message }));
    if (ex3.error || ex3.view !== 'property' || !ex3.want || ex3.project !== ex3.want || ex3.price !== ex3.wantPrice) p.push(`the sample property, pressed, opens ${JSON.stringify(ex3)}`);
  }
  /* Hidden on Equities: gone from its pages, kept by the others, remembered. */
  await ev(clean);
  await load(BASE + '/research');
  const hid = await ev(`(async () => {
    const b = document.querySelector('#views .start-here .start-here-hide');
    if (!b) return null;
    b.focus(); b.click(); await new Promise(r => setTimeout(r, 300));
    const at = document.activeElement;
    return { gone: !document.querySelector('#views .start-here'), focus: at && at !== document.body ? (at.id || at.tagName) : 'body',
      kept: JSON.parse(localStorage.getItem('vl.startHere') || 'null') };
  })()`);
  if (!hid) p.push('/research: nothing hides the panel');
  else {
    if (!hid.gone) p.push('/research: hidden, the panel is still there');
    if (hid.focus === 'body') p.push('/research: hiding the panel drops focus on <body>');
    if (!hid.kept || !hid.kept.equities) p.push(`hiding Equities' panel is not remembered: vl.startHere ${JSON.stringify(hid.kept)}`);
  }
  const seen = {};
  for (const path of ['/compare', '/discover/screener', '/research', '/app/scanner', '/research/trading-index', '/property/models', '/property/calculator',
    '/', '/how-it-works', '/app', '/my/watchlists', '/company/aapl-apple-inc', '/admin/scanner']) {
    await load(BASE + path);
    seen[path] = await ev(`document.querySelector('#views .start-here')?.dataset.product || null`);
  }
  for (const path of ['/compare', '/discover/screener', '/research']) if (seen[path]) p.push(`${path}: Equities' panel is back after it was hidden (${seen[path]})`);
  for (const [path, pid] of [['/app/scanner', 'scanner'], ['/research/trading-index', 'scanner'], ['/property/models', 'property'], ['/property/calculator', 'property']])
    if (seen[path] !== pid) p.push(`${path}: ${pid}'s panel is ${JSON.stringify(seen[path])} while only Equities' is hidden`);
  /* Nor on a company page, or the Scanner's read-only operations pages. */
  for (const path of ['/', '/how-it-works', '/app', '/my/watchlists', '/company/aapl-apple-inc', '/admin/scanner']) if (seen[path]) p.push(`${path}: a Start here panel (${seen[path]}) on a page that is not one of a product's tools`);
  /* Your data & settings says so, and brings it back. */
  await load(BASE + '/my/data');
  const reset = await ev(`(async () => {
    const b = document.getElementById('startHereReset');
    const card = b?.closest('.card');
    const said = card ? card.innerText.replace(/\\s+/g, ' ') : '';
    if (!b) return { said: (document.querySelector('#views')?.innerText.match(/Start here[^.]*\\./) || [''])[0] };
    b.click(); await new Promise(r => setTimeout(r, 300));
    return { button: b.textContent.trim(), said, kept: JSON.parse(localStorage.getItem('vl.startHere') || 'null') };
  })()`);
  if (!reset.button) p.push(`/my/data offers no control that brings the Start here panels back (${JSON.stringify(reset.said)})`);
  else {
    if (!/Equities Research/.test(reset.said)) p.push(`/my/data does not say which panel is hidden: "${reset.said.slice(0, 160)}"`);
    if (reset.kept && Object.keys(reset.kept).length) p.push(`after "${reset.button}", vl.startHere still holds ${JSON.stringify(reset.kept)}`);
    await load(BASE + '/research');
    if (await ev(`document.querySelector('#views .start-here')?.dataset.product || null`) !== 'equities') p.push('after the reset, /research has no Start here panel');
  }

  /* Every workspace page, emptied: what to do next, and one action. On the
     production-like host, where the worker's record is not the reader's
     work (the dashboard's first visit). */
  await load(LIVE + '/my/watchlists'); await ev(clean);
  await load(LIVE + '/my/watchlists');
  await ev(`(() => { clearSeededData(); return true; })()`);
  const EMPTY = `(() => { const e = [...document.querySelectorAll('#views [data-empty], #views .dash-start')].filter(n => n.getClientRects().length);
    return { says: e.map(n => n.innerText.replace(/\\s+/g, ' ').trim()), prim: ${PRIMARIES},
      acts: e.map(n => [...n.querySelectorAll('a[href], button')].filter(x => x.getClientRects().length).length) }; })()`;
  const empties = [];
  for (const [path, before] of [['/app'], ['/my/watchlists'], ['/my/watchlists', `(() => { State.watchlists = []; saveWatchlists(); render(); return true; })()`],
    ['/my/workspace'], ['/my/portfolio'], ['/my/theses']]) {
    await load(LIVE + path);
    if (before) { await ev(before); await sleep(300); }
    const r = await ev(EMPTY);
    const at = `${path}${before ? ' (no lists at all)' : ''}`;
    empties.push(at);
    if (!r.says.length || r.says.some(t => t.length < 25)) p.push(`${at}, emptied: no empty state that says what to do next (${JSON.stringify(r.says)})`);
    if (r.prim.length !== 1) p.push(`${at}, emptied: ${r.prim.length} primary actions (${r.prim.join(', ')}), not the one next action`);
  }
  await ev(clean);

  if (p.length) { bad++; console.log(`FAIL releaseB layouts-onboarding: one product header, one workspace header, one page head, a Start here per product, empty states with one action (${p.length} problems)`); p.slice(0, 80).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   releaseB layouts-onboarding: ${pagesSeen} product and workspace pages each wear one header from the registry — the product's name, badge and tabs, or My workspace — with their own tab current and no second strip, and a head of eyebrow, h1 and a one-line lede; no product page offers two primary actions; the Scanner's Alerts tab says "Alerts · 1"; each product opens with a Start here panel (its action, what you get, an example that opens — Apple's filed report, the example setup, the sample property), hidden per product and remembered, on no public or workspace page, brought back from Your data & settings; ${empties.length} emptied workspace pages each say what to do next, with one action`);
}
/* ---- end releaseB: layouts-onboarding ---- */
/* ---- releaseB: small-backlog ---- */
/* E4 — THE TRADING INDEX'S ONE PRIMARY ACTION IS ITS SAVE. The page's save
   sat in the work bar as a grey outline button beside quieter ones, so a
   fresh page had no primary action at all, and the page opened from a
   company's research had exactly one — the link banner's "Fill in the
   identity" — which is not the page's work. As on the property calculator,
   the save is the one primary and every other button is quiet. Measured in
   the four states the page has — a fresh page, the §14 worked example
   loaded, a run saved (Resume and Duplicate appear) and a link from Apple's
   research (the banner) — at 1280 and at 390: one visible primary, the
   work bar's save, every other button quiet; and pressing it saves a run. */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (url) => {
    await ev('window.__rbMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__rbMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(400);
  };
  const p = [];
  const WEIGHTS = `(() => { const seen = (n) => n.getClientRects().length > 0;
    const btns = [...document.querySelectorAll('#views .btn, body > .dock .btn')].filter(seen);
    return { prim: btns.filter(n => n.classList.contains('btn-primary')).map(n => n.id || n.textContent.trim()),
      loud: btns.filter(n => !n.classList.contains('btn-primary') && !n.classList.contains('btn-quiet')).map(n => (n.id ? '#' + n.id + ' ' : '') + '"' + n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40) + '"'),
      save: document.getElementById('wb-trading-save')?.textContent.trim() || null }; })()`;
  let states = 0;
  try {
    for (const [w, h, mobile] of [[1280, 900, false], [390, 844, true]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId);
      await load(BASE + '/privacy');
      await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); localStorage.setItem('vl.plan', JSON.stringify('pro')); return true; })()`);
      const judge = async (state) => {
        const r = await ev(WEIGHTS);
        states++;
        if (r.prim.length !== 1 || r.prim[0] !== 'wb-trading-save') p.push(`${w}px, ${state}: the primary actions are ${JSON.stringify(r.prim)}, not the one save`);
        if (r.loud.length) p.push(`${w}px, ${state}: not quiet — ${r.loud.join(', ')}`);
        return r;
      };
      await load(BASE + '/research/trading-index');
      await judge('a fresh page');
      await ev(`(document.getElementById('q-load-worked').click(), true)`);
      await sleep(300);
      await judge('the worked example loaded');
      const n0 = await ev(`loadWork().filter(r => r.kind === 'trading').length`);
      const saved = await ev(`(async () => { const keep = window.prompt; window.prompt = () => 'releaseB E4 run';
        try { document.querySelector('#views .btn-primary')?.click(); await new Promise(r => setTimeout(r, 300)); } finally { window.prompt = keep; }
        return loadWork().filter(r => r.kind === 'trading').map(r => r.name); })()`);
      if (!(saved.length === n0 + 1 && saved.includes('releaseB E4 run'))) p.push(`${w}px: pressing the primary did not save a run (${n0} before, ${JSON.stringify(saved)} after)`);
      const r3 = await judge('a run saved');
      if (!(await ev(`!!document.getElementById('wb-trading-resume') && !!document.getElementById('wb-trading-dup')`))) p.push(`${w}px: with a run saved, the work bar offers no Resume or Duplicate`);
      await load(BASE + '/research/trading-index?from=AAPL');
      const banner = await ev(`/Start from Apple Inc\\./.test(document.getElementById('qtti-link')?.textContent || '')`);
      if (!banner) p.push(`${w}px: the link from Apple's research drew no banner, so the state is not measured`);
      await judge('opened from Apple\'s research');
      if (w === 1280 && !/^Save this run$/.test(r3.save || '')) p.push(`the save reads ${JSON.stringify(r3.save)}, not what it saves`);
    }
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`);
  } catch (e) { p.push(`the check threw: ${e.message}`); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (p.length) { bad++; console.log(`FAIL releaseB small-backlog E4 — the Trading Index's primary action (${p.length} problems)`); p.slice(0, 30).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   releaseB small-backlog E4: the Trading Index has one primary action, "Save this run", and every other button quiet, in ${states} states at 1280 and 390 (fresh, worked example, a run saved, opened from Apple's research); pressing it saves the run`);
}
/* E2 — EVERY COMPANY FIGURE SAYS WHOSE IT IS, AND WHAT KIND (the daily
   audit's #8). A figure's company is labelled SEC-filed or illustrative
   where the figure appears. Only the synthetic half was ever marked, so a
   filed company in a list was known by a missing word — in the screener's
   rows and phone cards, a metric's distribution, a company's peer table,
   a comparison and the portfolio — and the illustrative half had gaps of
   its own: the comparison's chart named Maybank's mark as a filed one's,
   the portfolio's dividend projection listed synthetic payouts unmarked,
   and a company page's sticky strip, the one identity left on screen once
   the header scrolls away, showed a sample price with no word of it.
   Walked for Maybank (illustrative) and Apple (filed): every tab of each
   company page and each report, the screener with a metric's definition
   and a source drawer for each, the comparison of the two, the research
   queue, the value map, the heatmap, the dashboard and the portfolio. On
   each, every record of a company figure — the smallest row, item or card
   naming one company with a number of its own, a column's header, a chart
   mark's name — must carry that company's label as a word the reader sees
   (a tooltip is not one), and never the other kind's marker; the subject
   of a company page wears its label in its header and its sticky strip,
   and a report's on its cover. */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (url) => {
    await ev('window.__rbMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__rbMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(700);
  };
  /* Run in the page, never here: its records, and whether each is labelled. */
  function labelScan({ subject = [], roots = ['#views', 'body > .dock', '#drawer:not([hidden]) #drawerBody'] } = {}) {
    const cos = U.map(r => r.c);
    const kindOf = (c) => (c.real ? (c.personal ? 'personal' : 'filed') : 'illustrative');
    /* Tested on one text node at a time, or on an SVG mark's accessible
       name: a label is a word beside the company, not a tooltip, and not
       two cells run together. "Not filed" is not a filed label. */
    const LABEL = { illustrative: /\billustrative\b|\bsynthetic\b/i, filed: /\bSEC-filed\b|(?<!\bnot\s)\bfiled\b|\bEDGAR\b/i, personal: /\bpersonal research\b/i };
    const MARK = { illustrative: '.illus', filed: '.filed-mark', personal: '.filed-mark' };
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tokenRe = new Map(cos.map(c => [c.id, new RegExp(`^${esc(c.tk)}(?=$|[\\s,·—:(])`)]));
    const anyRe = new Map(cos.filter(c => c.tk.length >= 3).map(c => [c.id, new RegExp(`(^|[^A-Za-z0-9-])${esc(c.tk)}(?=$|[^A-Za-z0-9-])`)]));
    const occ = [];
    /* A grade is not a ticker: the strategy table's Grade column holds A–D,
       and C and D are filers' tickers too (Citigroup, Dominion) — a graded
       Income row on Apple's page read as two unlabelled filed companies. */
    const inGradeColumn = (n) => { const td = n.closest('td'); const th = td && td.closest('table')?.querySelector('thead tr')?.children[td.cellIndex];
      return !!th && /^Grade$/i.test(th.textContent.trim()); };
    const rootEls = roots.map(s => document.querySelector(s)).filter(Boolean);
    for (const root of rootEls) {
      for (const n of root.querySelectorAll('svg [aria-label]')) {
        const c = cos.find(c => tokenRe.get(c.id).test(n.getAttribute('aria-label').trim()));
        if (c) occ.push({ node: n, c, svg: true });
      }
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const s = t.nodeValue.trim();
        if (!s || t.parentElement.closest('script,style,select,option,textarea,svg') || inGradeColumn(t.parentElement)) continue;
        let c = cos.find(c => tokenRe.get(c.id).test(s) || s === c.name);
        if (!c && s.length <= 80) c = cos.find(c => anyRe.get(c.id)?.test(s));
        if (c) occ.push({ node: t.parentElement, c, svg: false });
      }
    }
    const namesOther = (el, c) => occ.some(o => o.c.id !== c.id && el.contains(o.node));
    const texts = (el) => { const out = []; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) if (!t.parentElement.closest('script,style,svg')) out.push(t.nodeValue.trim()); return out.filter(Boolean); };
    /* A figure: a number that is not the company's own name, ticker or
       code, a date, a year, or a lone digit (a step's ordinal). */
    const hasFigure = (el, c) => texts(el).some(s => {
      const x = s.split(c.tk).join(' ').split(c.name).join(' ').split(c.code || '\u0000').join(' ')
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\bFY\s?\d{2,4}\b/g, ' ').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\bQ[1-4]\b/g, ' ').trim();
      return /\d/.test(x) && !/^\d$/.test(x);
    });
    const who = (el) => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
    const place = (el) => { for (let p = el; p && !rootEls.includes(p); p = p.parentElement) { const h = p.querySelector?.(':scope > h1, :scope > h2, :scope > h3, :scope > .card-hd .h-card, :scope > summary'); if (h) return h.textContent.trim().slice(0, 50); } return ''; };
    const seen = new Set(), records = [];
    for (const o of occ) {
      if (subject.includes(o.c.id)) continue;
      let R = o.node;
      if (!o.svg) {
        const th = R.closest('thead th, th[scope="col"]');
        if (th) R = th;
        else {
          while (!R.matches('tr, li, [role="row"], [role="listitem"], .noteitem, .card, dd, article, figure')) {
            const up = R.parentElement;
            if (!up || rootEls.includes(up) || namesOther(up, o.c)) break;
            R = up;
          }
          if (!hasFigure(R, o.c)) continue;
        }
      }
      if (seen.has(R)) continue;
      seen.add(R);
      const k = kindOf(o.c);
      const words = o.svg ? [R.getAttribute('aria-label') || ''] : texts(R);
      const other = Object.entries(MARK).filter(([kk]) => kk !== k && !(k !== 'illustrative' && kk !== 'illustrative')).map(([, sel]) => sel);
      records.push({ tk: o.c.tk, kind: k, labelled: words.some(s => LABEL[k].test(s)),
        wrong: !o.svg && other.some(sel => R.querySelector(sel)) || (o.svg && k !== 'illustrative' && LABEL.illustrative.test(words[0])),
        el: who(R), where: place(R), text: words.join(' ').replace(/\s+/g, ' ').slice(0, 100) });
    }
    return records;
  }
  /* The subject's own label, as visible text, in the element that names it. */
  const SUBJECT = (sel, id) => `(() => { const c = BY_ID.get(${JSON.stringify(id)})?.c; const n = document.querySelector(${JSON.stringify(sel)});
    if (!c || !n) return null; const re = !c.real ? /\\billustrative\\b/i : c.personal ? /\\bpersonal research\\b/i : /\\bSEC-filed\\b/i;
    const w = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) if (re.test(t.nodeValue)) return true; return false; })()`;
  const p = [];
  let pages = 0, nRec = 0, subjects = 0;
  const kinds = { filed: 0, illustrative: 0 };
  const judge = async (label, opts = {}, want = []) => {
    const recs = await ev(`(${labelScan.toString()})(${JSON.stringify(opts)})`);
    pages++; nRec += recs.length;
    recs.forEach(r => { kinds[r.kind] = (kinds[r.kind] || 0) + 1; });
    const unl = recs.filter(r => !r.labelled), wrong = recs.filter(r => r.wrong);
    const groups = {};
    unl.forEach(r => { const g = `${r.kind} ${r.el}${r.where ? ` under "${r.where}"` : ''}`; (groups[g] ||= []).push(r); });
    Object.entries(groups).forEach(([g, rs]) => p.push(`${label}: ${rs.length} ${g} unlabelled — ${rs.slice(0, 3).map(r => r.tk).join(', ')}${rs.length > 3 ? ', …' : ''} ("${rs[0].text.slice(0, 70)}")`));
    wrong.forEach(r => p.push(`${label}: ${r.tk} (${r.kind}) wears the other kind's marker — ${r.el} "${r.text.slice(0, 60)}"`));
    for (const k of want) if (!recs.some(r => r.kind === k)) p.push(`${label}: no ${k} company's figure found, so nothing ${k} was checked there`);
  };
  const subject = async (label, sel, id) => {
    const v = await ev(SUBJECT(sel, id));
    subjects++;
    if (v !== true) p.push(`${label}: the subject ${id} is not labelled in ${sel}${v === null ? ' (not found)' : ''}`);
  };
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await load(BASE + '/privacy');
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); localStorage.setItem('vl.plan', JSON.stringify('pro')); return true; })()`);
    await load(BASE + '/privacy');
    await ev(`(() => { const w = wlCreate('E2 labels').watchlist; wlAdd(w.id, 'AAPL-SEC'); wlAdd(w.id, 'MAYBANK');
      State.recentCompanies = ['AAPL-SEC', 'MAYBANK']; store.write('recentCompanies', State.recentCompanies); return true; })()`);
    for (const [co, id, kind] of [['MAYBANK', 'MAYBANK', 'illustrative'], ['aapl-apple-inc', 'AAPL-SEC', 'filed']]) {
      for (const tab of ['snapshot', 'business', 'financials', 'quality', 'valuation', 'moat', 'risks', 'ownership', 'filings', 'thesis']) {
        await load(`${BASE}/company/${co}?tab=${tab}`);
        await subject(`/company/${co}?tab=${tab}`, '.ticker-sticky .ts-ident', id);
        if (tab === 'snapshot') await subject(`/company/${co}`, '#views .card:has(h1)', id);
        await judge(`/company/${co}?tab=${tab}`, { subject: [id] }, tab === 'snapshot' ? [kind] : []);
      }
      await load(`${BASE}/company/${co}/report`);
      await subject(`/company/${co}/report`, '.rr-cover', id);
      await judge(`/company/${co}/report`, { subject: [id] });
    }
    await load(BASE + '/discover/screener');
    await judge('/discover/screener', {}, ['filed', 'illustrative']);
    /* A metric's definition lists its top twelve: the filed companies lead
       return on capital, the priced illustrative set leads dividend yield. */
    for (const [k, want] of [['roic', 'filed'], ['dy', 'illustrative']]) {
      await ev(`(openMetricInfo(FIELD_BY_K[${JSON.stringify(k)}]), true)`); await sleep(500);
      await judge(`/discover/screener, the definition of ${await ev(`FIELD_BY_K[${JSON.stringify(k)}].label`)}`, { roots: ['#drawer:not([hidden]) #drawerBody'] }, [want]);
      await ev(`(closeDrawer(), true)`); await sleep(400);
    }
    if (await ev(`(() => { const b = [...document.querySelectorAll('#views button')].find(x => /Explain exclusions/.test(x.textContent)); b?.click(); return !!b; })()`)) {
      await sleep(500);
      await judge('/discover/screener, Explain exclusions', { roots: ['#drawer:not([hidden]) #drawerBody'] }, ['filed', 'illustrative']);
      await ev(`(closeDrawer(), true)`); await sleep(400);
    } else p.push('/discover/screener: no "Explain exclusions" button');
    for (const [tk, id] of [['AAPL', 'AAPL-SEC'], ['MAYBANK', 'MAYBANK']]) {
      const opened = await ev(`(() => { const td = [...document.querySelectorAll('#views table.dt tbody tr')].find(tr => tr.querySelector('.tk')?.firstChild?.nodeValue === ${JSON.stringify(tk)})?.querySelector('td.cell-sourced'); td?.click(); return !!td; })()`);
      await sleep(500);
      if (!opened) { p.push(`/discover/screener: no ${tk} row to open a source drawer from`); continue; }
      await subject(`/discover/screener, ${tk}'s source drawer`, '#drawerBody', id);
      await judge(`/discover/screener, ${tk}'s source drawer`, { subject: [id], roots: ['#drawer:not([hidden]) #drawerBody'] });
      await ev(`(closeDrawer(), true)`); await sleep(400);
    }
    /* A saved screen's drawer — reached from search, Recent and Saved
       Models — sets every match's scores as saved beside today's; it listed
       the synthetic Bursa scores beside the filers' with neither marked
       (the Release B verifier's find). */
    const savedAt = await ev(`(() => { const keep = window.prompt; State.savedScreens = []; window.prompt = () => 'releaseB E2 screen';
      try { saveScreen(); } finally { window.prompt = keep; }
      const i = State.savedScreens.findIndex(s => s.name === 'releaseB E2 screen'); if (i >= 0) openSavedScreen(i); return i; })()`);
    await sleep(500);
    if (savedAt < 0) p.push('/discover/screener: no screen was saved, so its drawer was not walked');
    else {
      await judge('a saved screen\'s drawer', { roots: ['#drawer:not([hidden]) #drawerBody'] }, ['filed', 'illustrative']);
      await ev(`(closeDrawer(), true)`); await sleep(400);
    }
    await load(BASE + '/compare?companies=AAPL-SEC,MAYBANK');
    await judge('/compare', {}, ['filed', 'illustrative']);
    await load(BASE + '/research/queue');
    await judge('/research/queue', {}, ['illustrative']);
    await load(BASE + '/discover/value-map');
    await judge('/discover/value-map', {}, ['illustrative']);
    await load(BASE + '/discover?tab=heatmap');
    await judge('/discover?tab=heatmap', {}, ['illustrative']);
    await load(BASE + '/app');
    await judge('/app');
    await load(BASE + '/my/portfolio');
    await judge('/my/portfolio', {}, ['filed', 'illustrative']);
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`);
  } catch (e) { p.push(`the check threw: ${e.message}`); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (p.length) { bad++; console.log(`FAIL releaseB small-backlog E2 — a company figure not labelled filed or illustrative where it appears (${p.length} problems)`); p.slice(0, 40).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   releaseB small-backlog E2: ${nRec} records of a company figure on ${pages} pages and drawers (${kinds.filed} SEC-filed, ${kinds.illustrative} illustrative) each labelled where it appears, none with the other kind's marker; ${subjects} subjects labelled on their company tabs' sticky strip and header, their report's cover and their source drawer`);
}
/* ---- end releaseB: small-backlog ---- */
/* ---- releaseB: search-recent ---- */
/* SEARCH EVERYTHING, AND WHAT WAS LAST OPENED (Release B, B3 and B4;
   95-boot.js, 59-recent.js), at 1440.
   B3. One box, three groups under headings — Companies (the registry, as
       before), Pages and tools (every tool in the registry this build holds,
       and the public pages) and Your saved work (watchlists, scanner setups,
       saved properties, investment cases, saved screens and comparisons,
       read from the stores that hold them). The buttons read "Search", and
       their names and the box's placeholder say what it searches. A tool
       that cannot be used here is text with its reason, never a link, and
       every link opens a page that exists. By the keys alone: "/" and
       Ctrl+K open it, the arrows walk the results across the groups, Enter
       opens the one chosen, and Escape closes it and gives focus back.
   B4. With the box empty it lists Recent: the companies, pages and saved
       work last opened, newest first, each with when — the companies in the
       order the dashboard's "Recently opened companies" has them, because
       both read one record; at most twenty; kept without a request to
       anywhere; "Clear recent" empties it, and the dashboard's list with
       it. */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (url) => {
    await ev('window.__rbMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__rbMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(400);
  };
  /* A real key press, through the browser's input pipeline. */
  const KEYS = { '/': ['Slash', 191, '/'], Escape: ['Escape', 27, ''], Enter: ['Enter', 13, '\r'], ArrowDown: ['ArrowDown', 40, ''],
    ArrowUp: ['ArrowUp', 38, ''], Tab: ['Tab', 9, ''], k: ['KeyK', 75, 'k'] };
  const key = async (k, { ctrl = false } = {}) => {
    const [code, vk, text] = KEYS[k];
    const typed = ctrl ? '' : text;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0, ...(typed ? { text: typed } : {}) }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: ctrl ? 2 : 0 }, sessionId);
    await sleep(140);
  };
  const clean = `(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('vl.plan', JSON.stringify('pro')); return true; })()`;
  /* What the box lists for a query, group by group: the group's heading, and
     each row — what it is, where it leads, whether it is text. */
  const LISTED = (q) => `(() => { runSearch(${JSON.stringify(q)}); clearTimeout(searchTimer);
    return [...searchResults.querySelectorAll('[data-group]')].map(g => { const h = document.getElementById(g.getAttribute('aria-labelledby') || '');
      return { id: g.dataset.group, role: g.getAttribute('role'), hd: (h?.textContent || '').trim(), hTag: h?.tagName || null,
        rows: [...g.querySelectorAll('[data-result], .search-off')].map(r => ({ tag: r.tagName, href: r.getAttribute('href'), result: r.hasAttribute('data-result'),
          name: (r.querySelector('.search-name, .search-co-tk')?.textContent || r.textContent).trim().slice(0, 90), kind: (r.querySelector('.search-in')?.textContent || '').trim(),
          off: r.classList.contains('search-off'), badge: r.querySelector('.status-badge')?.textContent.trim() || null,
          note: (r.querySelector('.search-note')?.textContent || '').trim(), text: r.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) })) }; }); })()`;
  const group = (gs, id) => (gs || []).find(g => g.id === id) || null;
  const b3 = [], b4 = [];
  const hrefs = new Set();
  let toolsChecked = 0, keysSaid = '';
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

  /* ---------------------------------------------------------------- B3 */
  try {
    await ev(clean);
    await load(BASE + '/property/calculator');
    /* The reader's own work, one of each kind, made through the app's own
       functions. The investment case is the sample one the first visit
       seeds (Maybank's). */
    const seeded = await ev(`(() => { const out = {};
      const w = wlCreate('QT search list'); out.wl = w.ok; if (w.ok) wlAdd(w.watchlist.id, 'MSFT-SEC');
      const tree = { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'sma', n: 7 } }] };
      out.setup = scanSaveSetup({ id: 'qt-search-setup', name: 'QT search setup', version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D', cooldownMode: 'NEW_MATCH', ruleTree: tree }).ok;
      State.savedScreens = [{ name: 'QT search screen', screen: blankScreen(), snapshot: { matches: [], saved: '2026-09-29', stamp: { savedAt: new Date().toISOString() } } }];
      store.write('savedScreens', State.savedScreens);
      saveComparisons([{ id: 'cmp-qt-search', name: 'QT search comparison of Apple and Microsoft', ids: ['AAPL-SEC', 'MSFT-SEC'], tks: ['AAPL', 'MSFT'], created: new Date().toISOString() }]);
      out.property = !!saveActiveProperty({ name: 'QT search property' });
      return out; })()`);
    if (!seeded.wl || !seeded.setup || !seeded.property) b3.push(`seeding the reader's work failed: ${JSON.stringify(seeded)}`);
    await load(BASE + '/app');

    /* The buttons read "Search"; their names and the placeholder say what. */
    const said = await ev(`(() => { const i = document.getElementById('searchInput');
      return { buttons: [...document.querySelectorAll('[data-open-search]')].map(b => ({ text: (b.querySelector('#searchLabel, .appbar-search-label, .searchbtn-label')?.textContent || '').trim(), name: b.getAttribute('aria-label') || '' })),
        ph: i?.getAttribute('placeholder') || '', inputName: i?.getAttribute('aria-label') || '', dialog: document.getElementById('searchModal')?.getAttribute('aria-label') || '' }; })()`);
    const namesAll = (s) => /compan/i.test(s) && /page/i.test(s) && /saved/i.test(s);
    said.buttons.forEach((b, i) => {
      if (b.text !== 'Search') b3.push(`search button ${i + 1} reads "${b.text}", not "Search"`);
      if (!/^Search\b/.test(b.name) || !namesAll(b.name)) b3.push(`search button ${i + 1} is named "${b.name}" — it must start with its words, "Search", and say it searches companies, pages and saved work`);
    });
    if (!namesAll(said.ph)) b3.push(`the box's placeholder "${said.ph}" does not name what it searches (companies, pages, saved work)`);
    if (!namesAll(said.inputName)) b3.push(`the box is named "${said.inputName}", which does not say it searches pages and saved work`);

    /* Companies, as before, under their heading. */
    const apple = await ev(LISTED('apple'));
    const co = group(apple, 'companies');
    if (!co) b3.push(`"apple" lists no Companies group: ${JSON.stringify((apple || []).map(g => g.id))}`);
    else {
      if (co.hd !== 'Companies' || co.hTag !== 'H2' || co.role !== 'group') b3.push(`the companies group is headed "${co.hd}" (${co.hTag}, role ${co.role}), not an h2 "Companies" naming a group`);
      /* By the ticker's own element: the row's text runs the ticker into its
         first chip ("AAPLUS"), where no word boundary falls. */
      if (!co.rows.some(r => r.result && r.name === 'AAPL')) b3.push(`"apple" does not list Apple (AAPL) under Companies: ${JSON.stringify(co.rows.map(r => r.name))}`);
    }
    /* Your saved work: one of each kind, by its own name and kind. */
    const mine = await ev(LISTED('qt search'));
    const sv = group(mine, 'saved');
    if (!sv) b3.push(`"qt search" lists no "Your saved work" group: ${JSON.stringify((mine || []).map(g => g.id))}`);
    else {
      if (sv.hd !== 'Your saved work' || sv.hTag !== 'H2') b3.push(`the saved-work group is headed "${sv.hd}" (${sv.hTag})`);
      for (const [name, kind] of [['QT search list', 'Watchlist'], ['QT search setup', 'Scanner setup'], ['QT search property', 'Saved property'],
        ['QT search screen', 'Saved screen'], ['QT search comparison of Apple and Microsoft', 'Comparison']]) {
        const r = sv.rows.find(x => x.name === name);
        if (!r) b3.push(`"qt search" does not list the ${kind.toLowerCase()} "${name}" (it lists ${JSON.stringify(sv.rows.map(x => x.name))})`);
        else if (!r.result || r.off || !new RegExp(`^${kind}\\b`).test(r.kind)) b3.push(`"${name}" is listed as ${JSON.stringify(r)}, not an openable ${kind}`);
      }
    }
    const may = group(await ev(LISTED('maybank')), 'saved');
    if (!may || !may.rows.some(r => /^Investment case/.test(r.kind) && /sample/i.test(r.text))) b3.push(`"maybank" does not list the sample investment case, labelled a sample, under Your saved work: ${JSON.stringify(may?.rows || null)}`);

    /* The public pages, by name, as links to their own address. */
    for (const [label, path] of [['How it works', '/how-it-works'], ['Pricing', '/pricing'], ['Methodology', '/methodology'], ['Data sources', '/data-sources'], ['Glossary', '/learn/glossary']]) {
      const pg = group(await ev(LISTED(label)), 'pages');
      const r = pg?.rows.find(x => x.name === label);
      if (!pg) b3.push(`"${label}" lists no "Pages and tools" group`);
      else if (pg.hd !== 'Pages and tools') b3.push(`the pages group is headed "${pg.hd}"`);
      if (pg && (!r || r.tag !== 'A' || r.href !== path)) b3.push(`"${label}" is not listed as a link to ${path}: ${JSON.stringify(r || pg.rows.slice(0, 3))}`);
    }
    /* Every tool in the registry this build holds, by its name: a link where
       it can be used, else text with its badge and the reason. */
    const tools = await ev(`TOOLS.filter(t => toolPresent(t)).map(t => { const s = toolState(t), p = t.product ? productById(t.product) : null;
      return { id: t.id, label: t.label, path: t.path, ok: s.actionable, badge: s.label, note: s.note, product: p && p.path === t.path ? p.name : null }; })`);
    for (const t of tools) {
      const pg = group(await ev(LISTED(t.label)), 'pages');
      const r = pg?.rows.find(x => x.name === t.label || (t.product && x.name === t.product));
      toolsChecked++;
      if (!r) { b3.push(`the tool "${t.label}" (${t.path}) is not listed for its own name`); continue; }
      if (t.ok && (r.tag !== 'A' || r.off || !r.href)) b3.push(`the tool "${t.label}" can be used here but is listed as ${JSON.stringify(r)}`);
      if (!t.ok && (r.result || !r.off || r.badge !== t.badge || r.note !== t.note)) b3.push(`the tool "${t.label}" cannot be used here (${t.badge}) but is listed as ${JSON.stringify(r)} — it must be text with its badge and the reason "${t.note}"`);
    }
    /* A tool made unusable by what loaded: the filings held back, the
       Screener is text with the load's own error, and nothing in the box
       links to a tool that cannot be used. */
    const held = await ev(`(() => { const keep = realStatus; realStatus = { ok: false, error: 'held back by the check' };
      try { const gs = ${LISTED('screener')}; const pg = gs.find(g => g.id === 'pages');
        const offered = [...searchResults.querySelectorAll('a[href], [data-tool-path]')].map(a => toolOfLink(a)).filter(t => t && !toolState(t).actionable).map(t => t.id);
        return { row: pg ? pg.rows.find(x => x.name === 'Screener') || null : null, offered }; }
      finally { realStatus = keep; runSearch(''); } })()`);
    if (!held.row || held.row.result || !held.row.off || held.row.badge !== 'Unavailable' || !/held back by the check/.test(held.row.note))
      b3.push(`with the filings held back the Screener is listed as ${JSON.stringify(held.row)}, not text with "Unavailable" and the load's error`);
    if (held.offered.length) b3.push(`with the filings held back the box still offers ${held.offered.join(', ')}`);

    /* Never a result that goes nowhere: each link opens a view, each result
       is a link or a button. */
    for (const q of ['apple', 'qt search', 'maybank', 'pricing', 'scanner', 'property', 'watchlist', 'a']) {
      const gs = await ev(LISTED(q));
      for (const g of gs || []) for (const r of g.rows) {
        if (r.result && !(r.tag === 'A' && r.href) && r.tag !== 'BUTTON') b3.push(`"${q}": the result "${r.name}" is a ${r.tag}, neither a link nor a button`);
        if (r.result && r.tag === 'A') hrefs.add(r.href);
      }
    }
    const nowhere = await ev(`${JSON.stringify([...hrefs])}.filter(h => { const u = new URL(h, location.href); const rt = matchRoute(u.pathname); return !rt || !VIEWS[rt.view]; })`);
    if (nowhere.length) b3.push(`results that open no page: ${nowhere.join(', ')}`);

    /* By the keys alone. */
    const k = {};
    await load(BASE + '/research');
    await ev(`(() => { focusMain(); return true; })()`);
    await key('/'); await sleep(300);
    k.slash = await ev(`searchOpen && document.activeElement === searchInput`);
    await key('Escape'); await sleep(300);
    k.slashBack = await ev(`!searchOpen && document.activeElement === document.getElementById('main')`);
    await ev(`(() => { const f = document.createElement('input'); f.id = 'rb-field'; f.setAttribute('aria-label', 'a field the check types in'); document.body.append(f); f.focus(); return true; })()`);
    await key('k', { ctrl: true }); await sleep(300);
    k.ctrl = await ev(`searchOpen && document.activeElement === searchInput && searchInput.value === ''`);
    await key('Escape'); await sleep(300);
    k.ctrlBack = await ev(`!searchOpen && document.activeElement?.id === 'rb-field'`);
    await ev(`(() => { document.getElementById('rb-field')?.remove(); document.getElementById('openSearch').focus(); return true; })()`);
    await key('Enter'); await sleep(300);
    k.button = await ev(`searchOpen && document.activeElement === searchInput`);
    await send('Input.insertText', { text: 'apple' }, sessionId); await sleep(500);
    const order = await ev(`[...searchResults.querySelectorAll('[data-result]')].map(n => n.closest('[data-group]')?.dataset.group || null)`);
    const walked = [];
    for (let i = 0; i < order.length; i++) { await key('ArrowDown'); walked.push(await ev(`(() => { const a = document.activeElement; return { i: [...searchResults.querySelectorAll('[data-result]')].indexOf(a), g: a?.closest('[data-group]')?.dataset.group || null }; })()`)); }
    k.walk = order.length > 1 && walked.every((s, i) => s.i === i) && new Set(walked.map(s => s.g)).size >= 2;
    for (let i = 0; i < order.length; i++) await key('ArrowUp');
    k.upToBox = await ev(`document.activeElement === searchInput`);
    const at = order.indexOf('saved');
    for (let i = 0; i <= at; i++) await key('ArrowDown');
    k.onSaved = at >= 0 && await ev(`document.activeElement?.closest('[data-group]')?.dataset.group === 'saved' && /QT search comparison/.test(document.activeElement.textContent)`);
    await key('Enter'); await sleep(700);
    k.opened = await ev(`({ view: State.view, saved: new URLSearchParams(location.search).get('saved'), open: searchOpen })`);
    await ev(`(() => { document.getElementById('openSearch').focus(); return true; })()`);
    await key('Enter'); await sleep(300);
    await key('Escape'); await sleep(300);
    k.buttonBack = await ev(`!searchOpen && document.activeElement?.id === 'openSearch'`);
    const ks = [['"/" opens the box with the cursor in it', k.slash], ['Escape gives focus back to the page it was pressed on', k.slashBack],
      ['Ctrl+K opens it from a text field', k.ctrl], ['Escape gives focus back to that field', k.ctrlBack], ['Enter on the Search button opens it', k.button],
      [`the down arrow walks every result in order, across the groups (${JSON.stringify(order)})`, k.walk], ['the up arrow walks back to the box', k.upToBox],
      ['the arrows reach the saved comparison', k.onSaved], [`Enter opens it (${JSON.stringify(k.opened)})`, k.opened?.view === 'compare' && k.opened.saved === 'cmp-qt-search' && !k.opened.open],
      ['Escape gives focus back to the Search button', k.buttonBack]];
    ks.filter(([, v]) => !v).forEach(([what]) => b3.push(`keyboard: ${what} — no`));
    keysSaid = ks.length;
  } catch (e) { b3.push(`the checks threw: ${e.message}`); }
  if (b3.length) { bad++; console.log(`FAIL releaseB B3 search: one box, grouped results, pages and tools and saved work, unusable tools as text, the keys (${b3.length} problems)`); b3.slice(0, 40).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   releaseB B3 search: the buttons read "Search" and say what it searches; companies, pages and tools, and your saved work under three headings; the five kinds of saved work and the sample case by name; the five public pages and all ${toolsChecked} tools in this build by name, each usable one a link and each unusable one text with its badge and reason; with the filings held back the Screener is text with the error; ${hrefs.size} result links all open a page; by the keys alone ${keysSaid} steps: "/", Ctrl+K, the button, the arrows across groups, Enter and Escape giving focus back`);

  /* ---------------------------------------------------------------- B4 */
  try {
    await ev(clean);
    await load(BASE + '/privacy');
    await ev(`(() => { const w = wlCreate('QT recent list'); if (w.ok) wlAdd(w.watchlist.id, 'AAPL-SEC'); return w.ok; })()`);
    await load(BASE + '/app');
    const shown = `(() => { runSearch(''); const g = searchResults.querySelector('[data-group="recent"]'); const h = g ? document.getElementById(g.getAttribute('aria-labelledby') || '') : null;
      return g ? { hd: (h?.textContent || '').trim(), clear: !!g.querySelector('button.search-clear'), empty: !!g.querySelector('.search-empty'),
        rows: [...g.querySelectorAll('[data-result]')].map(r => ({ tag: r.tagName, name: (r.querySelector('.search-name')?.textContent || '').trim(), kind: (r.querySelector('.search-in')?.textContent || '').trim(),
          when: r.querySelector('time.search-when')?.getAttribute('datetime') || null, said: (r.querySelector('.search-when')?.textContent || '').trim() })) } : null; })()`;
    const first = await ev(`(() => { openSearch(); return true; })()`).then(() => sleep(300)).then(() => ev(shown));
    if (!first) b4.push('the empty box lists no Recent group');
    else {
      if (first.hd !== 'Recent') b4.push(`the empty box's group is headed "${first.hd}", not "Recent"`);
      if (!first.rows.some(r => r.name === 'Privacy')) b4.push(`the page opened before this one (Privacy) is not in Recent: ${JSON.stringify(first.rows)}`);
      if (first.rows.some(r => r.name === 'My Dashboard')) b4.push('Recent lists the page on screen (My Dashboard), where the reader already is');
      if (!first.clear) b4.push('Recent has no "Clear recent" control');
    }
    /* Cleared from the box: the empty state, the record empty, the cursor
       back in the box. */
    const cleared = await ev(`(async () => { document.querySelector('#searchResults button.search-clear')?.click(); await new Promise(r => setTimeout(r, 150));
      const rec = JSON.parse(localStorage.getItem('vl.recent') || 'null');
      return { box: document.activeElement === searchInput, rec, companies: JSON.parse(localStorage.getItem('vl.recentCompanies') || 'null'), shown: ${shown} }; })()`);
    if (!cleared.shown || cleared.shown.rows.length || !cleared.shown.empty) b4.push(`after "Clear recent" the box shows ${JSON.stringify(cleared.shown)}, not the empty Recent`);
    if (!cleared.rec || (cleared.rec.items || []).length || Object.keys(cleared.rec.co || {}).length || !Array.isArray(cleared.companies) || cleared.companies.length)
      b4.push(`after "Clear recent" the record holds ${JSON.stringify({ recent: cleared.rec, recentCompanies: cleared.companies })}`);
    if (!cleared.box) b4.push('after "Clear recent" the cursor is not back in the box');
    await ev(`(() => { closeSearch({ restore: false }); return true; })()`); await sleep(300);

    /* Recorded as the reader moves, and nothing requested to keep it. */
    const moved = await ev(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms));
      const calls = [], kf = window.fetch, kb = navigator.sendBeacon, kx = XMLHttpRequest.prototype.open;
      window.fetch = function (...a) { calls.push('fetch ' + String(a[0])); return kf.apply(this, a); };
      navigator.sendBeacon = function (...a) { calls.push('beacon ' + String(a[0])); return false; };
      XMLHttpRequest.prototype.open = function (...a) { calls.push('xhr ' + String(a[1])); return kx.apply(this, a); };
      try {
        openResearch('AAPL-SEC'); await w(400);
        navigate('/pricing'); await w(300);
        navigate('/discover/screener'); await w(500);
        openSearch(); await w(250); runSearch('QT recent'); clearTimeout(searchTimer);
        const row = [...searchResults.querySelectorAll('[data-group="saved"] [data-result]')].find(r => /QT recent list/.test(r.textContent));
        if (row) row.click(); await w(400);
        const onList = State.view;
        openResearch('MSFT-SEC'); await w(400);
        navigate('/how-it-works'); await w(300);
        return { calls, onList, cookie: document.cookie };
      } finally { window.fetch = kf; navigator.sendBeacon = kb; XMLHttpRequest.prototype.open = kx; } })()`);
    if (moved.calls.length) b4.push(`moving between five pages with the record kept made requests: ${moved.calls.slice(0, 5).join('; ')}`);
    if (moved.cookie) b4.push(`a cookie was set: ${moved.cookie.slice(0, 60)}`);
    if (moved.onList !== 'watchlists') b4.push(`the saved list chosen in the box opened ${moved.onList}, not the watchlists page`);
    await ev(`(() => { openSearch(); return true; })()`); await sleep(300);
    const after = await ev(shown);
    const names = (after?.rows || []).map(r => r.name);
    const want = ['MSFT', 'QT recent list', 'Screener', 'Pricing', 'AAPL'];
    if (!after || want.some((n, i) => !(names[i] || '').startsWith(n))) b4.push(`Recent lists ${JSON.stringify(names.slice(0, 7))}, not ${JSON.stringify(want)} newest first`);
    if (names.includes('How it works')) b4.push('Recent lists How it works, the page on screen');
    const badWhen = (after?.rows || []).slice(0, 5).filter(r => !r.when || !Number.isFinite(Date.parse(r.when)) || r.said !== 'just now');
    if (badWhen.length) b4.push(`rows without when: ${JSON.stringify(badWhen)}`);
    if (after && after.rows.slice(0, 5).some(r => !['A', 'BUTTON'].includes(r.tag))) b4.push(`a Recent row is neither a link nor a button: ${JSON.stringify(after.rows.slice(0, 5))}`);
    /* Enter in the empty box opens the newest — the last thing opened
       before the page on screen. */
    await key('Enter'); await sleep(500);
    const enter = await ev(`({ view: State.view, ticker: State.ticker, open: searchOpen })`);
    if (enter.view !== 'research' || enter.ticker !== 'MSFT-SEC' || enter.open) b4.push(`Enter in the empty box opened ${JSON.stringify(enter)}, not the newest (MSFT)`);

    /* The dashboard's recently opened companies are the same, in the same
       order. */
    await ev(`(() => { navigate('/app'); return true; })()`); await sleep(500);
    const dash = await ev(`[...document.querySelectorAll('#views .dash-co strong')].map(s => s.textContent.trim())`);
    const recentCos = names.filter(n => /^(MSFT|AAPL)\b/.test(n)).map(n => n.split(/\s/)[0]);
    if (JSON.stringify(dash) !== JSON.stringify(recentCos)) b4.push(`the dashboard lists ${JSON.stringify(dash)} as recently opened, Recent ${JSON.stringify(recentCos)}`);

    /* When: older entries say how long ago, or the day. */
    const older = await ev(`(() => { const r = JSON.parse(localStorage.getItem('vl.recent'));
      r.items.push({ k: 'page', id: '/methodology', t: new Date(Date.now() - 3 * 3600e3 - 60e3).toISOString() }, { k: 'page', id: '/data-sources', t: new Date(Date.now() - 3 * 864e5).toISOString() });
      localStorage.setItem('vl.recent', JSON.stringify(r)); openSearch(); return true; })()`).then(() => sleep(300)).then(() => ev(shown));
    const meth = older?.rows.find(r => r.name === 'Methodology'), ds = older?.rows.find(r => r.name === 'Data sources');
    if (!meth || !/^3 hours ago$/.test(meth.said)) b4.push(`an entry three hours old says ${JSON.stringify(meth)}`);
    if (!ds || !/^\d{1,2} [A-Z][a-z]{2,3}/.test(ds.said)) b4.push(`an entry three days old says ${JSON.stringify(ds)}, not its date`);
    await ev(`(() => { closeSearch({ restore: false }); return true; })()`); await sleep(250);

    /* At most twenty. */
    const cap = await ev(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms));
      const paths = ROUTES.filter(r => !r.alias && !r.path.includes(':') && VIEWS[r.view] && !['/admin/scanner', '/admin/scanner/data', '/admin/scanner/jobs', '/admin/scanner/delivery'].includes(r.path)).map(r => r.path).slice(0, 26);
      for (const p of paths) { navigate(p); await w(120); }
      const rec = JSON.parse(localStorage.getItem('vl.recent') || 'null');
      openSearch(); await w(250); runSearch('');
      return { visited: paths.length, kept: (rec?.items || []).length, shown: searchResults.querySelectorAll('[data-group="recent"] [data-result]').length }; })()`);
    if (cap.kept > 20 || cap.shown > 20 || cap.shown < 15) b4.push(`after ${cap.visited} pages the record keeps ${cap.kept} and Recent shows ${cap.shown} — at most twenty`);

    /* Cleared: the dashboard forgets the companies too. */
    await ev(`(() => { document.querySelector('#searchResults button.search-clear')?.click(); closeSearch({ restore: false }); navigate('/app'); return true; })()`); await sleep(500);
    const gone = await ev(`document.querySelectorAll('#views .dash-co').length`);
    if (gone) b4.push(`after "Clear recent" the dashboard still lists ${gone} recently opened companies`);
    await ev(clean);
  } catch (e) { b4.push(`the checks threw: ${e.message}`); }
  if (b4.length) { bad++; console.log(`FAIL releaseB B4 recent: the empty box's Recent, recorded as the reader moves (${b4.length} problems)`); b4.slice(0, 30).forEach(x => console.log('     ' + x)); }
  else console.log('ok   releaseB B4 recent: the empty box lists Recent — a company, a page, a tool and a saved list opened in turn, newest first, each "just now", older ones "3 hours ago" or their day, and never the page on screen; Enter opens the newest; the companies in the dashboard\'s order; twenty at most after 26 pages; no request made and no cookie set to keep it; "Clear recent" empties it, puts the cursor back in the box, and the dashboard\'s list goes with it');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
}
/* ---- end releaseB: search-recent ---- */
/* ---- releaseB: integration ---- */
/* THE CURRENT TAB IS WHOLLY IN ITS ROW. The header's tab row is wired before
   the page under it is drawn, and the page's scrollbar then takes 15px from
   it. Once the Scanner's eight tabs and the workspace's nine stood in the
   header (Release B), the current tab of each row's last page — the Trading
   Index, Your data — stood 14–15px past the row's end at 1024 and 1280,
   opened cold. The last two tabs of every product's row and the
   workspace's, opened cold at four widths: the current tab inside its row. */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (url) => {
    await ev('window.__rbMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__rbMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(500);
  };
  const p = [];
  let n = 0;
  try {
    await load(BASE + '/privacy');
    const pages = await ev(`(() => {
      const rows = [...Object.entries(PRODUCT_TABS), ['workspace', workspaceTabs()]];
      return rows.flatMap(([row, ts]) => ts.filter(t => (t.tool ? toolState(t.tool) : null)?.actionable !== false).slice(-2).map(t => ({ row, path: t.path })));
    })()`);
    if (pages.length < 8) p.push(`only ${pages.length} pages to open: ${JSON.stringify(pages)}`);
    for (const [w, h, mobile] of [[390, 844, true], [1024, 900, false], [1280, 900, false], [1440, 900, false]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId);
      for (const { row, path } of pages) {
        await load(BASE + path);
        const r = await ev(`(() => {
          const host = document.getElementById('productTabs');
          const list = host && !host.hidden ? host.querySelector('.ptabs-list') : null;
          if (!list) return { none: true };
          const cur = list.querySelector('.ptab[aria-current]');
          if (!cur) return { nocur: true };
          const l = list.getBoundingClientRect(), c = cur.getBoundingClientRect();
          return { inRow: c.left >= l.left - 1 && c.right <= l.right + 1, cur: cur.textContent.trim(), by: Math.round(Math.max(l.left - c.left, c.right - l.right)), over: list.scrollWidth - list.clientWidth };
        })()`);
        n++;
        if (r.none || r.nocur) p.push(`${w}px ${path} (${row}): ${r.none ? 'no tab row' : 'no current tab'}`);
        else if (!r.inRow) p.push(`${w}px ${path} (${row}): the current tab "${r.cur}" stands ${r.by}px outside its row (it overflows by ${r.over}px)`);
      }
    }
  } catch (e) { p.push(`the check threw: ${e.message}`); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (p.length) { bad++; console.log(`FAIL releaseB integration: a page's current tab outside its row (${p.length} problems)`); p.slice(0, 30).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   releaseB integration: the current tab wholly inside its row on the last two tabs of every product's row and the workspace's, opened cold — ${n} pages at 390, 1024, 1280 and 1440`);

  /* WHAT THE RELEASE B VERIFIER FOUND, each held. Run on the merged branch,
     it tried the seams the owners' own checks could not see. */
  const q = [];
  let steps = 'measured';
  try {
    /* The dashboard's first step: a name that ends in a full stop ends the
       sentence once ("Apple Inc.."), and the caption promises nothing it
       does not keep ("stays ticked once it is true" — Clear recent
       un-ticked it). Where this browser holds work of its own (the owner's
       machine), the page shows that work instead of the steps. */
    await load(BASE + '/privacy');
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`);
    await load(BASE + '/company/aapl-apple-inc');
    await ev(`(navigate('/app'), true)`); await sleep(500);
    const d8 = await ev(`(() => { const t = document.querySelector('main').innerText; return { checklist: /Set up your workspace/.test(t), last: (t.match(/Last opened:[^\\n]*/) || [''])[0], stays: /stays ticked/.test(t) }; })()`);
    if (!d8.checklist) steps = 'not shown here: this browser holds work of its own';
    else if (!/Apple Inc\.$/.test(d8.last) || /\.\.$/.test(d8.last) || d8.stays) q.push(`the dashboard's first step: ${JSON.stringify(d8)}`);

    /* A saved screen's drawer labels every company (its labels are walked
       with E2's own scan in small-backlog E2; here, every row). */
    await load(BASE + '/discover/screener');
    const d1 = await ev(`(async () => { const keep = window.prompt; State.savedScreens = []; window.prompt = () => 'releaseB verify';
      try { saveScreen(); } finally { window.prompt = keep; }
      const i = State.savedScreens.findIndex(s => s.name === 'releaseB verify'); if (i < 0) return null;
      openSavedScreen(i); await new Promise(r => setTimeout(r, 400));
      const rows = [...document.querySelectorAll('#drawerBody table.dt tbody tr')];
      const un = rows.filter(tr => !tr.cells[0].querySelector('.illus, .filed-mark')).map(tr => tr.cells[0].textContent.trim());
      closeDrawer(); return { rows: rows.length, un }; })()`);
    if (!d1 || !d1.rows || d1.un.length) q.push(`a saved screen's drawer: ${d1 ? `${d1.un.length} of ${d1.rows} companies unlabelled (${d1.un.slice(0, 4).join(', ')})` : 'no screen saved'}`);

    /* Reached in-app while the filings load, a company page's head names no
       company and is not the page before's (Apple's on Maybank's address,
       Pricing's on Apple's); once they are in, it is the company's own. */
    await load(BASE + '/company/aapl-apple-inc');
    const d2 = await ev(`(async () => {
      const read = () => ({ title: document.title, canon: new URL(document.querySelector('link[rel=canonical]').href).pathname });
      realPending = true;
      try { navigate('/company/1155-malayan-banking'); await new Promise(r => setTimeout(r, 300)); return read(); }
      finally { realPending = false; } })()`);
    if (/AAPL|Apple|MAYBANK|Malayan/i.test(d2.title) || d2.canon !== '/company/1155-malayan-banking') q.push(`Apple → Maybank while the filings load: ${JSON.stringify(d2)}`);
    await load(BASE + '/pricing');
    const d2b = await ev(`(async () => {
      const read = () => ({ title: document.title, canon: new URL(document.querySelector('link[rel=canonical]').href).pathname });
      realPending = true;
      try { navigate('/company/aapl-apple-inc'); await new Promise(r => setTimeout(r, 300)); const during = read();
        realPending = false; navigate('/company/aapl-apple-inc'); await new Promise(r => setTimeout(r, 400)); return { during, after: read() }; }
      finally { realPending = false; } })()`);
    if (/Pricing/.test(d2b.during.title) || d2b.during.canon !== '/company/aapl-apple-inc' || !/AAPL — Apple Inc/.test(d2b.after.title)) q.push(`Pricing → Apple while the filings load, then loaded: ${JSON.stringify(d2b)}`);

    /* Any other name for a company ends at its own address, tab and query
       kept — the one the server sends the company's own head for. */
    for (const [from, to] of [['/company/aapl', '/company/aapl-apple-inc'], ['/company/AAPL-SEC?tab=financials', '/company/aapl-apple-inc?tab=financials']]) {
      await load(BASE + from);
      const at = await ev(`({ at: location.pathname + location.search, same: lastPath === location.pathname, lastPath })`);
      if (at.at !== to) q.push(`${from} ends at ${at.at}, not ${to}`);
      /* And the page on screen is still this page: a stale record of the
         alias made the next route change on it read as an arrival. */
      if (!at.same) q.push(`${from}: after the address became ${at.at}, the record of the page on screen still reads ${at.lastPath}`);
    }

    /* The month's reports used on the Free plan: Start here names Apple's
       report without linking it to a page that refuses it. */
    await load(BASE + '/research');
    const d9 = await ev(`(async () => {
      State.plan = 'free'; store.write('plan', 'free');
      State.reportLog = { month: meterMonth(), ids: U.map(r => r.c.id).filter(id => id !== 'AAPL-SEC').slice(0, 5) }; store.write('reportLog', State.reportLog);
      render(); await new Promise(r => setTimeout(r, 200));
      const ex = [...document.querySelectorAll('.start-here .start-here-ex')].find(n => /Apple/.test(n.textContent));
      State.reportLog = { month: meterMonth(), ids: [] }; store.write('reportLog', State.reportLog); render();
      return ex?.tagName || null; })()`);
    if (d9 !== 'SPAN') q.push(`with the month's reports used, Start here's Apple example is ${d9 === 'A' ? 'a link' : JSON.stringify(d9)}`);

    /* My Alerts and Reports wear the one page head; on a phone the lede is
       whole — My Alerts' carries "not an instruction to buy or sell". */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    for (const [path, re] of [['/my/alerts', /instruction to buy or sell/], ['/my/reports', /real one/]]) {
      await load(BASE + path);
      const d6 = await ev(`(() => { const l = document.querySelector('#views .page-hd .page-lede'); return l ? { text: l.textContent, clamped: l.scrollHeight > l.clientHeight + 1 } : null; })()`);
      if (!d6 || !re.test(d6.text) || d6.clamped) q.push(`${path} at 390: the page head's lede is ${JSON.stringify(d6)}`);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);

    /* My Alerts' research section, empty, says what fills it and offers one
       action; a scanner match with no id is not "from a muted setup", and
       opens the history rather than /app/scanner/alerts/ with no id. */
    await load(BASE + '/my/alerts?kind=research');
    const d7 = await ev(`(async () => {
      clearSeededData(); State.theses = []; State.savedScreens = []; State.priceAlerts = []; render(); await new Promise(r => setTimeout(r, 200));
      const sec = document.getElementById('al-research');
      return { empty: !!sec?.querySelector('[data-empty]'), action: sec?.querySelector('[data-empty] a[href$="/my/watchlists"]')?.textContent.trim() || null, text: sec?.querySelector('[data-empty] p')?.textContent || '' }; })()`);
    if (!d7.empty || !d7.action || /since the last run/.test(d7.text)) q.push(`My Alerts' empty research section: ${JSON.stringify(d7).slice(0, 200)}`);
    await load(BASE + '/my/alerts');
    const d10 = await ev(`(async () => {
      const keep = [scanAlertsFile, store.read('scanAlertState', null)];
      scanAlertsFile = { alerts: [
        { id: 'a0rv00001', key: 'rv|AAPL|1D|2026-09-25', setupId: 'rv', setupName: 'Verify', setupVersion: 1, symbol: 'AAPL', candleDate: '2026-09-25', timeframe: '1D', eventType: 'NEW_MATCH', close: 230, detectedAt: '2026-09-26T01:00:00Z' },
        { setupId: 'rv', setupName: 'Verify', setupVersion: 1, symbol: 'MSFT', candleDate: '2026-09-24', timeframe: '1D', eventType: 'NEW_MATCH', close: 410, detectedAt: '2026-09-25T01:00:00Z' } ] };
      store.write('scanAlertState', {}); render(); await new Promise(r => setTimeout(r, 200));
      const out = { said: document.querySelector('.al-scan-said')?.textContent || null, hrefs: [...document.querySelectorAll('.al-scan-row')].map(a => a.getAttribute('href')) };
      /* The kind filter's ring, inside its button: the strip scrolls and
         clipped the page's ring at its 3px of padding. */
      const btn = document.querySelector('.al-kind-seg button'); btn.focus({ focusVisible: true });
      out.ring = btn.matches(':focus-visible') ? getComputedStyle(btn).outlineOffset : 'not focus-visible';
      scanAlertsFile = keep[0]; if (keep[1] == null) localStorage.removeItem('vl.scanAlertState'); else store.write('scanAlertState', keep[1]); render();
      return out; })()`);
    if (!d10.said || /muted/.test(d10.said) || d10.hrefs.some(h => /\/alerts\/$/.test(h))) q.push(`a scanner match with no id on My Alerts: ${JSON.stringify(d10)}`);
    if (d10.ring !== '-2px') q.push(`My Alerts' kind filter: the focus ring's offset is ${d10.ring}, not inside the button`);

    /* An illustrative company is not for a search index (the owner,
       2026-10-03): its page says noindex once loaded as its served page did,
       and the tag follows the reader — gone on a filed company reached
       in-app, back on the illustrative one's report. */
    await load(BASE + '/company/1155-malayan-banking');
    const rb = await ev(`(async () => {
      const r = () => document.querySelector('meta[name="robots"]')?.getAttribute('content') || null;
      const out = { maybank: r() };
      navigate('/company/aapl-apple-inc'); await new Promise(x => setTimeout(x, 300)); out.apple = r();
      navigate('/company/1155-malayan-banking/report'); await new Promise(x => setTimeout(x, 300)); out.report = r();
      return out; })()`);
    if (rb.maybank !== 'noindex' || rb.apple !== null || rb.report !== 'noindex') q.push(`the robots tag on Maybank, then Apple in-app, then Maybank's report: ${JSON.stringify(rb)} — want noindex, none, noindex`);

    /* One name for /my/data: the workspace's tab, the sidebar and the title. */
    await load(BASE + '/my/data');
    const d12 = await ev(`({ tab: document.querySelector('#productTabs .ptab[aria-current]')?.textContent.trim(), side: document.querySelector('#appnav a[href$="/my/data"] .sb-text')?.textContent.trim(), title: document.title })`);
    if (d12.tab !== 'Your data & settings' || d12.side !== d12.tab || !/^Your data & settings/.test(d12.title)) q.push(`/my/data is named ${JSON.stringify(d12)}`);
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`);
  } catch (e) { q.push(`the checks threw: ${e.message}`); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (q.length) { bad++; console.log(`FAIL releaseB integration: what the verifier found (${q.length} problems)`); q.slice(0, 30).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   releaseB integration: what the verifier found holds — a saved screen's drawer labels every company; a company reached in-app while the filings load names no company and no other page's head, then its own; aliases end at the company's own address; Start here names a refused report without linking it; My Alerts and Reports wear the one head, whole at 390; an empty research section has one action; a match with no id is not called muted; the kind filter's ring is whole; an illustrative company says noindex wherever it is open; /my/data has one name; the first steps ${steps}`);
}
/* ---- end releaseB: integration ---- */
/* ---- property-proposal ---- */
/* THE CLIENT PROPOSAL'S WAYS IN, AND ITS PAPER (3 Oct 2026). A saved
   property's proposal is reached three ways — its row on My properties, its
   row on /my/reports, and the calculator's Report section with it open —
   each a real link to /property/models/:property/proposal, each said to be
   a preview. A deal not yet saved is told to save it first, with that one
   action, which then leads on. An address naming no saved property says so,
   with one action. robots.txt keeps the address out of an index with My
   properties. And on paper: the proposal asks for A4, prints the document
   alone — no rail, navigation or footer — within the page's width, in light
   colours under a dark screen. Each fails before the proposal existed. */
{
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (url) => {
    await ev('window.__ppMark = 1').catch(() => {});
    await send('Page.navigate', { url }, sessionId);
    for (let i = 0; i < 200; i++) {
      try { if (await ev(`!window.__ppMark && document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending`)) break; } catch { /* booting */ }
      await sleep(100);
    }
    await sleep(400);
  };
  const p = [];
  let pdfBox = null;
  try {
    await load(BASE + '/property/calculator');
    bucket = [];
    const r = await ev(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const txt = (n) => (n ? n.textContent : '').replace(/\\s+/g, ' ').trim();
      window.prompt = (m, d) => d; window.confirm = () => true;
      const click = async (sel) => { const n = document.querySelector(sel); if (!n) return false; n.click(); await w(450); return true; };
      const at = () => ({ view: State.view, path: location.pathname, of: txt(document.querySelector('#cp-doc .cp-sub')) });
      const out = {};
      Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
      /* An unsaved deal: the Report section says to save it first. */
      newPropertyDeal({ show: false });
      State.deal.price = 461000; markTouched(State.deal, 'price'); saveDeal();
      navigate('/property/calculator'); await w(500);
      const card = () => document.getElementById('cp-next');
      out.unsaved = { has: !!card(), acts: card() ? [...card().querySelectorAll('a, button')].map(x => ({ id: x.id, t: txt(x) })) : [], said: txt(card()) };
      await click('#cp-next-save');
      out.afterSave = { modelId: State.deal.modelId, acts: card() ? [...card().querySelectorAll('a, button')].map(x => ({ id: x.id, t: txt(x), href: x.getAttribute('href') })) : [], focus: document.activeElement?.id || null };
      const id = State.deal.modelId, want = cpPath(id);
      out.want = want;
      out.preview = /Preview/.test(txt(card()));
      await click('#cp-next-open'); out.fromCalc = at();
      navigate('/property/models'); await w(450);
      const pm = document.getElementById('pm-cp-' + id);
      out.models = { href: pm?.getAttribute('href') || null, t: txt(pm) };
      await click('#pm-cp-' + id); out.fromModels = at();
      navigate('/my/reports'); await w(600);
      const rp = document.getElementById('rp-cp-' + id);
      out.reports = { href: rp?.getAttribute('href') || null, t: txt(rp), said: txt(document.getElementById('rp-properties')) };
      await click('#rp-cp-' + id); out.fromReports = at();
      out.rail = txt(document.querySelector('.cp-rail'));
      out.pricing = !!document.querySelector('#views a[href$="/pricing"]');
      navigate('/property/models/no-such-property-for-the-sweep/proposal'); await w(400);
      out.missing = { view: State.view, head: txt(document.querySelector('#cp-missing-hd')), primaries: [...document.querySelectorAll('#views .btn-primary')].map(txt) };
      navigate(want); await w(400);
      return out;
    })()`);
    const errs = bucket.filter(x => /^(EXCEPTION|CONSOLE)/.test(x));
    if (errs.length) p.push(`the pages logged ${errs.slice(0, 3).join('; ')}`);
    const ids = (a) => a.map(x => x.id).join(',');
    if (!r.unsaved.has || ids(r.unsaved.acts) !== 'cp-next-save' || !/Save this property first/.test(r.unsaved.said)) p.push(`an unsaved deal's Report section: ${JSON.stringify(r.unsaved).slice(0, 240)}`);
    if (!r.afterSave.modelId || ids(r.afterSave.acts) !== 'cp-next-open' || r.afterSave.acts[0].href !== r.want || r.afterSave.focus !== 'cp-next-open')
      p.push(`after "Save this property first": ${JSON.stringify(r.afterSave)}`);
    if (!r.preview) p.push('the calculator\'s card does not call the proposal a preview');
    for (const [k, v] of [['the calculator', r.fromCalc], ['My properties', r.fromModels], ['/my/reports', r.fromReports]])
      if (v.view !== 'propertyProposal' || v.path !== r.want) p.push(`from ${k}: ${JSON.stringify(v)}`);
    if (r.models.href !== r.want || r.models.t !== 'Client proposal') p.push(`My properties' link: ${JSON.stringify(r.models)}`);
    if (r.reports.href !== r.want || r.reports.t !== 'Client proposal' || !/client proposal/.test(r.reports.said)) p.push(`/my/reports' link: ${JSON.stringify(r.reports).slice(0, 240)}`);
    if (!/A preview/.test(r.rail) || !/nothing is on sale/.test(r.rail) || r.pricing) p.push(`the page's own words on plans: "${r.rail.slice(0, 160)}"${r.pricing ? ', with a link to /pricing' : ''}`);
    if (r.missing.view !== 'propertyProposal' || !/not saved in this browser/.test(r.missing.head) || r.missing.primaries.length !== 1) p.push(`an address naming no saved property: ${JSON.stringify(r.missing)}`);
    const robots = await (await fetch(BASE + '/robots.txt')).text();
    if (!/^Disallow:\s*\/property\/models\s*$/m.test(robots)) p.push('robots.txt does not keep /property/models, and the proposals under it, out of an index');

    /* On paper. */
    const pdf = await send('Page.printToPDF', { preferCSSPageSize: true }, sessionId);
    const raw = Buffer.from(pdf.result?.data || '', 'base64').toString('latin1');
    pdfBox = (raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/) || []).slice(1).map(Number);
    if (!(Math.abs(pdfBox[0] - 595.3) < 1.5 && Math.abs(pdfBox[1] - 841.9) < 1.5)) p.push(`the proposal prints on ${JSON.stringify(pdfBox)} pt, not A4 (595 × 842)`);
    /* The page's text width on A4 with its 14mm margins: 182mm, 688px. */
    await send('Emulation.setDeviceMetricsOverride', { width: 688, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Emulation.setEmulatedMedia', { media: 'print', features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
    await sleep(400);
    const pr = await ev(`(() => {
      const shown = (sel) => [...document.querySelectorAll(sel)].some(n => n.getClientRects().length && getComputedStyle(n).display !== 'none');
      const doc = document.getElementById('cp-doc'), d = doc.getBoundingClientRect();
      const over = [...doc.querySelectorAll('*')].filter(n => n.getClientRects().length && n.getBoundingClientRect().right > d.right + 1).map(n => n.tagName + '.' + n.className).slice(0, 5);
      const wraps = [...doc.querySelectorAll('.cp-tablewrap')].filter(t => t.scrollWidth > t.clientWidth + 1).map(t => t.getAttribute('aria-label'));
      const cs = getComputedStyle(doc), h1 = getComputedStyle(doc.querySelector('h1'));
      /* Against its own row — the label's left edge to its figure's right —
         since on paper a group can run on into the next column, and the
         list's box is then both columns. */
      const crushed = [...doc.querySelectorAll('dl.cp-kv-tight dt')].filter(dt => { const a = dt.getBoundingClientRect(), b = dt.nextElementSibling.getBoundingClientRect();
        return a.width < (b.right - a.left) * 0.3; }).map(dt => dt.textContent.trim()).slice(0, 4);
      return { crushed, rail: shown('.cp-rail'), nav: shown('.sidebar, .appbar, .ptabs-host, .topbar, .footer, .cp-foot'), width: Math.round(d.width), vw: document.documentElement.clientWidth,
        over, wraps, bg: cs.backgroundColor, ink: h1.color, page: cs.getPropertyValue('page') || null };
    })()`);
    if (pr.rail || pr.nav) p.push(`on paper the ${pr.rail ? 'rail' : 'navigation or footer'} still prints`);
    if (pr.width < pr.vw - 2) p.push(`on paper the document is ${pr.width}px of the page's ${pr.vw}px`);
    if (pr.over.length) p.push(`on paper these run past the page's edge: ${pr.over.join(', ')}`);
    if (pr.wraps.length) p.push(`on paper these tables are wider than the page: ${pr.wraps.join(', ')}`);
    if (pr.crushed.length) p.push(`on paper these assumptions keep under 30% of their row, a word a line: ${pr.crushed.join(', ')}`);
    if (pr.bg !== 'rgb(255, 255, 255)' || !/^rgb\((1\d|2\d|3\d), (1\d|2\d|3\d), (1\d|2\d|3\d)\)$/.test(pr.ink)) p.push(`on paper under a dark screen the document is ${pr.ink} on ${pr.bg}, not dark on white`);
  } catch (e) { p.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { media: '', features: [] }, sessionId).catch(() => {});
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (p.length) { bad++; console.log(`FAIL property-proposal: the client proposal's ways in and its paper (${p.length} problems)`); p.slice(0, 20).forEach(x => console.log('     ' + x)); }
  else console.log(`ok   property-proposal: a saved property's client proposal opens from the calculator's Report section, My properties and /my/reports — each a link to its own address, called a preview, with no price; an unsaved deal is told to save it first, with that one action, which then leads on; an address naming no saved property says so with one action; robots.txt keeps it out of an index; on paper it asks for A4 (${pdfBox?.join(' × ')} pt) and prints the document alone, within the page's width, its assumptions label and figure, dark on white under a dark screen`);
}
/* ---- end property-proposal ---- */
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
