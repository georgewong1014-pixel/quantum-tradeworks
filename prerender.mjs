#!/usr/bin/env node
/**
 * Every page's own content in the HTML it is served with.
 *
 *   node prerender.mjs                 render every page in scope from a clean copy of HEAD
 *                                      and write prerender/ (then: node build.mjs)
 *   node prerender.mjs --worktree      the same from the working tree's tracked files, for
 *                                      a change not yet committed — still no personal file
 *   node prerender.mjs --check <url>   render every page at <url> again and fail if a page's
 *                                      markup, its chrome, its current links or its served
 *                                      navigation differ from what is committed
 *
 *   node prerender.mjs --self-test     the guards that keep a run to its own clean copy, its
 *                                      own server and its own browser, held (SELF-TEST, below)
 *
 *   --only /pricing,/about    just these pages (a write keeps every other render)
 *   --port <n>                the clean copy's server (or PRERENDER_PORT; by default a port
 *                             the system says is free). It must be free: nothing is drawn
 *                             from a server this run did not start.
 *   CDP_PORT                  Chrome's debugging port (by default one Chrome picks). It must
 *                             be free: nothing is drawn in a browser this run did not start.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * A fetch that runs no script got the same body from every address: the
 * header, the "Research · Monitor · Model · Plan" strapline and the footer's
 * disclosure. Only the head differed (build.mjs, ONE HEAD PER ADDRESS). The
 * app draws each page into <div id="views"> once its script has run, and the
 * served <div id="views"> was empty — so a crawler that does not render, a
 * link preview, an assistant asked about a page, and an auditor's curl read
 * nothing of /pricing's plans, /about, the dashboard or the homepage's four
 * goals (Daily Audit #2 and #3, P0 #1).
 *
 * So each page is drawn here by the app itself, in Chrome, and what it drew
 * into #views — and the product's tab row above it, which would otherwise
 * appear above the page and push it down — is committed under prerender/.
 * build.mjs puts each into its page with no browser (THE PAGE ITSELF, IN THE
 * PAGE). The script, once it runs, draws the same page live in its place
 * (drawPage, 35-ui.js): the reader sees one page, from the first frame.
 *
 * HOW A PAGE IS DRAWN
 *
 * - Against a CLEAN copy: `git archive HEAD` (or, with --worktree, the
 *   tracked files of the working tree) in a temporary folder — no
 *   data/prices.json, price-history.json, personal-*.json, scan-*.json,
 *   watchlists.json or any other personal-lane file; one present means it is
 *   tracked, and the run stops. The copy is built --bare (no render of its
 *   own in any page) and served by its own serve.mjs.
 * - As production serves it: from live.localhost, which reaches the same
 *   server but is not the owner's machine, so the app never asks for the
 *   personal lane (OWNER_MACHINE, 25-universe.js). Every personal-lane
 *   request is still answered 404 in the browser, as journeys.mjs does, and
 *   one answered by anything else fails the run: a render is deployed.
 * - The same every time: a fresh profile per page (no storage), the light
 *   theme, 1280×900, prefers-reduced-motion, Kuala Lumpur's time zone and
 *   en-MY, and the clock fixed (CLOCK, below) before the page's first
 *   script, so "Good morning", "as of" and every relative time are stable.
 *   Two runs on one commit write byte-identical files.
 * - As the reader first sees it. A page that waits for the filed statements
 *   (realPending && UNIVERSE_VIEWS: the dashboard, pricing, the screener,
 *   research, the scanner's pages…) is drawn once they have landed, and the
 *   app keeps the served page on screen until then (drawPage) — so it never
 *   goes page → skeleton → page. Every other page is drawn as its FIRST draw
 *   has it, with every request it makes held unanswered, because its first
 *   draw is what replaces the served page the moment the script runs: the
 *   page replaces itself with itself. What changes once its data lands
 *   changes as it always has.
 *
 * WHAT A RENDER MAY NOT CARRY
 *
 * Before the script runs nothing on the page works, and anything typed into
 * a served field would be lost when the page is drawn over it. So every form
 * control is made inert text: a button becomes its own words (a <span> with
 * the button's classes, so it sits where it sat); a text, number or date
 * field, a select and a textarea become their current value; a checkbox or
 * a radio button becomes ☑ or ☐; a hidden or file field is removed, as are
 * <form> (its contents kept), <script>, <template>, <canvas>, <iframe> and
 * any inline handler. What the script makes a control of goes the same way:
 * an element with an interactive role (a table cell that opens its source,
 * a tab) keeps its words and loses the role, its tabindex, its name and its
 * state. Links keep their real hrefs: a reader without the script can still
 * go anywhere the page goes. What the page does not display at the width it
 * is drawn at is not served (the screener's phone cards beside its table: a
 * page may weigh 200kB). A <style> or <link> stops the run (a page may load
 * the app's stylesheet only). servedCopy, below, is the one place this is
 * done; the manifest counts each kind per page.
 *
 * --check compares the MARKUP, not the bytes (servedSignature, below): every
 * element, attribute and word, a chart's words and figures with them — only
 * where a chart's marks sit and whether a scrolling strip is faded, which the
 * machine's fonts decide, are left out. (It compared the text outside svg
 * only until 2026-10-04, and a link sent elsewhere, a heading's level, an
 * attribute or a chart's figures could change without it failing.)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routePlan, prerenderScope, NAV_SLOTS, siteOrigin, renderDigest } from './build.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const CHECK = argv.includes('--check');
const WORKTREE = argv.includes('--worktree');
const ONLY = (flag('only') || '').split(',').map(s => s.trim()).filter(Boolean);
/* No default port: the clean copy is served on one the system says is free
   (freePort), and a port that is named must be free — prerender never draws
   from a server it did not start (serve, below). 8125, the default this had,
   is the port the owner's own server, personal data and all, is run on. */
const PORT = Number(flag('port') || process.env.PRERENDER_PORT || 0);
/* Chrome's debugging port: by default one Chrome picks for itself, read back
   from the profile it was started with (startBrowser), so the browser drawn
   in is always the one started here. */
const CDP = Number(process.env.CDP_PORT) || 0;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const lf = (t) => t.split('\r\n').join('\n');

/* The clock every page is drawn at: a Thursday morning in Kuala Lumpur. Fixed,
   not the day of the run, so a render changes only when the page does. */
export const CLOCK = '2026-10-01T09:30:00+08:00';
export const ZONE = 'Asia/Kuala_Lumpur', LOCALE = 'en-MY';
export const VIEWPORT = { width: 1280, height: 900 };
/* Every file only the owner's machine has (the list journeys.mjs and the sweep
   hold the app to). */
const PERSONAL = /\/data\/(prices|personal-[a-z-]+|price-history|price-adjustments|scan-[a-z-]+|ingest-runs|sarawak-income|watchlists)(\.json|\.)/;
const PERSONAL_FILES = (f) => /^data\/(prices\.json|personal-[^/]*|price-history\.json.*|price-adjustments\.json.*|scan-[^/]*|ingest-runs\.json.*|sarawak-income\.json|watchlists\.json.*|daily-[^/]*)$/.test(f);
/* What the skeleton says (bootSkeleton, 35-ui.js): never a page's content. */
export const SKELETON = 'Reading the audited statements';
const MANIFEST = 'prerender/manifest.json';

/* ─── THE BROWSER ─────────────────────────────────────────────────────────── */
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
const CI_FLAGS = process.env.CI ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] : [];

/* Whether anything answers HTTP at an address — a server, a browser's
   devtools — within a second. */
async function answers(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1000) }); await r.arrayBuffer().catch(() => {}); return true; } catch { return false; }
}
/* A port nothing listens on, as the system hands one out. */
function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, () => { const { port } = s.address(); s.close(() => res(port)); });
  });
}

/* THE BROWSER IS PRERENDER'S OWN (2026-10-03). It connected to whatever
   answered on its debugging port: a Chrome already there — another
   harness's, or autoshot's, whose profile holds the owner's signed-in
   session — was drawn in instead of the fresh one started here, its own
   window and scrollbars and all, and the run said nothing. So the Chrome is
   started with a profile made for it, and it is reached at the address it
   writes into that profile (DevToolsActivePort) — never at a port that
   merely answers. A port named in CDP_PORT must be free first. */
export async function startBrowser({ cdpPort = CDP } = {}) {
  const bin = CANDIDATES.find(existsSync);
  if (!bin) throw new Error('no Chrome or Edge found — set CHROME_PATH');
  if (cdpPort && await answers(`http://127.0.0.1:${cdpPort}/json/version`))
    throw new Error(`port ${cdpPort} (CDP_PORT) already has a browser's devtools on it — prerender draws only in a Chrome it starts itself, in a fresh profile; close that one or leave CDP_PORT unset`);
  const profile = join(tmpdir(), `cdp-prerender-${process.pid}-${randomBytes(4).toString('hex')}`);
  rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  /* With a scrollbar, as a reader's Windows or Linux browser has one
     (2026-10-04). Drawn with --hide-scrollbars, the page was 15px wider than
     at the same window in such a browser, and a chart the app sizes to its
     box was served 568px across where the reader's page draws it at 553:
     served scaled down, then drawn again at its own size, and the property
     calculator's sensitivity chart grew 8px under the reader, moving
     everything after it. (An overlay scrollbar — a Mac's trackpad — takes no
     width; a render can be the same as one kind of browser, and is the
     same as the kind every harness here and CI's runner draws with.) */
  /* Its first page is one only this run knows the address of: on a port
     named in CDP_PORT — where Chrome writes no DevToolsActivePort — the
     browser answering is known as this one by that page among its own. */
  const mark = `data:text/plain,prerender-${randomBytes(8).toString('hex')}`;
  const proc = spawn(bin, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-gpu', mark, ...CI_FLAGS], { stdio: 'ignore' });
  let url = null;
  for (let i = 0; i < 200 && !url; i++) {
    if (!cdpPort) {
      try {
        const [port, path] = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/).map(s => s.trim());
        if (/^\d+$/.test(port) && path?.startsWith('/devtools/browser/')) url = `ws://127.0.0.1:${port}${path}`;
      } catch { /* not written yet */ }
    } else {
      try {
        const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
        if (list.some(t => t.url === mark)) url = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) })).json()).webSocketDebuggerUrl;
      } catch { /* not up yet */ }
    }
    if (!url) { if (proc.exitCode !== null) break; await sleep(100); }
  }
  if (!url) {
    proc.kill();
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
    throw new Error(`the Chrome started here never opened its devtools${cdpPort ? ` on port ${cdpPort}` : ''}`);
  }
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('could not connect to devtools')), { once: true }); });
  let id = 0;
  const pending = new Map(), listeners = new Set();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
      return;
    }
    listeners.forEach(fn => { try { fn(m); } catch { /* a listener's own fault */ } });
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject, method });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const close = async () => {
    try { ws.close(); } catch { /* gone */ }
    proc.kill();
    await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
    await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
  };
  return { send, listeners, close };
}

/* The clock, fixed before the page's first script: new Date() and Date.now()
   are CLOCK; a date the page names is itself. performance.now() stands still
   too: /status prints how long each in-browser check took ("15 ms"), which
   is the machine's, not the page's — fixed, it reads "<1 ms" every time. The
   harnesses keep the real one, as __realNow, to know when a page is quiet.
   Installed into every document. */
export const clockScript = (iso) => `(() => {
  const FIXED = ${JSON.stringify(Date.parse(iso))};
  Object.defineProperty(globalThis, '__realNow', { value: performance.now.bind(performance) });
  performance.now = () => 0;
  const Real = Date;
  function Fixed(...a) {
    if (!new.target) return new Real(FIXED).toString();
    return a.length ? new Real(...a) : new Real(FIXED);
  }
  Fixed.prototype = Real.prototype;
  Object.setPrototypeOf(Fixed, Real);
  Fixed.now = () => FIXED;
  Fixed.parse = Real.parse;
  Fixed.UTC = Real.UTC;
  Object.defineProperty(Real.prototype, 'constructor', { value: Fixed, writable: true, configurable: true });
  globalThis.Date = Fixed;
})();`;

/* One page, in a fresh profile. hold: every request the page makes is left
   unanswered (its first draw); otherwise only the journeys file is, which a
   workflow rewrites daily. The personal lane is answered 404 either way. */
async function openPage(browser, url, { hold }) {
  const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p = {}) => browser.send(m, p, sessionId);
  const tab = { errors: [], personal: [], answeredPersonal: [], held: [] };
  const listener = (m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params || {};
    switch (m.method) {
      case 'Fetch.requestPaused': {
        const u = new URL(p.request.url);
        if (PERSONAL.test(u.pathname)) {
          tab.personal.push(u.pathname);
          S('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 404,
            responseHeaders: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }],
            body: Buffer.from('The personal lane is answered 404 by prerender.mjs: a render is deployed.').toString('base64') }).catch(() => {});
        } else if (hold || u.pathname.startsWith('/health/')) {
          tab.held.push(u.pathname);           /* never answered */
        } else {
          S('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
        }
        break;
      }
      case 'Network.responseReceived': {
        const u = new URL(p.response.url);
        if (PERSONAL.test(u.pathname) && p.response.status !== 404) tab.answeredPersonal.push(`${p.response.status} ${u.pathname}`);
        if (p.response.status >= 400 && !PERSONAL.test(u.pathname)) tab.errors.push(`${p.response.status} ${u.pathname}`);
        break;
      }
      case 'Runtime.exceptionThrown':
        tab.errors.push(`exception: ${String(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text).split('\n')[0]}`);
        break;
      case 'Runtime.consoleAPICalled':
        if (p.type === 'error' || p.type === 'assert') tab.errors.push(`console: ${(p.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200)}`);
        break;
      case 'Runtime.bindingCalled':
        if (p.name === '__cspViolation') tab.errors.push(`CSP ${p.payload}`);
        break;
    }
  };
  browser.listeners.add(listener);
  tab.close = async () => { browser.listeners.delete(listener); await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {}); };
  await S('Runtime.enable'); await S('Page.enable'); await S('Network.enable');
  await S('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await S('Emulation.setTimezoneOverride', { timezoneId: ZONE });
  await S('Emulation.setLocaleOverride', { locale: LOCALE });
  await S('Runtime.addBinding', { name: '__cspViolation' });
  await S('Page.addScriptToEvaluateOnNewDocument', { source: clockScript(CLOCK) });
  await S('Page.addScriptToEvaluateOnNewDocument', { source:
    "document.addEventListener('securitypolicyviolation', e => __cspViolation(e.violatedDirective + ' blocked ' + String(e.blockedURI || e.sourceFile || 'inline').slice(0, 90)));" });
  await S('Fetch.enable', { patterns: [
    { urlPattern: '*/data/*', requestStage: 'Request' },
    { urlPattern: '*/health/*', requestStage: 'Request' },
    ...(hold ? [{ urlPattern: '*', resourceType: 'Fetch', requestStage: 'Request' }, { urlPattern: '*', resourceType: 'XHR', requestStage: 'Request' }] : []),
  ] });
  tab.eval = async (expression) => {
    const r = await S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text || 'evaluation threw');
    return r.result?.value;
  };
  const nav = await S('Page.navigate', { url });
  if (nav.errorText) throw new Error(`${url} could not be loaded: ${nav.errorText}`);
  return tab;
}

/* Until the page has been drawn and nothing in it has changed for a while:
   charts are drawn a frame after the page, and a view may draw part of
   itself a moment later. */
async function settle(tab, { filings }) {
  const ready = `document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view${filings ? " && typeof realPending !== 'undefined' && !realPending" : ''}`;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (await tab.eval(`!!(${ready})`).catch(() => false)) break;
    await sleep(100);
  }
  if (!await tab.eval(`!!(${ready})`).catch(() => false)) throw new Error(filings ? 'the filed statements never finished loading' : 'the app never drew the page');
  await tab.eval(`(() => { window.__prQuiet = __realNow();
    new MutationObserver(() => { window.__prQuiet = __realNow(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    return document.fonts ? document.fonts.ready.then(() => true) : true; })()`);
  const t1 = Date.now();
  while (Date.now() - t1 < 15000) {
    const quiet = await tab.eval(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(__realNow() - window.__prQuiet))))`);
    if (quiet >= 800) return;
    await sleep(150);
  }
  throw new Error('the page never stopped changing (15s)');
}

/* ─── WHAT IS TAKEN FROM THE PAGE ─────────────────────────────────────────────
   These run in the page, passed in as their source: each is whole in itself.

   servedCopy(live) is a copy of a part of the page as it may be served:
   - what the page does not display at the width it is drawn at (computed
     display: none — the screener's phone cards beside its table, a closed
     panel, a hidden message) is left out: it is not on screen, and the
     screener with both would weigh more than a page may (PAGE_LIMIT);
   - a form control becomes inert text (the top of this file says how), and
     so does anything the script makes a control of: an element with an
     interactive role (a table cell that opens its source, a tab) loses the
     role, its tabindex, its name and its state — its words stay — and a
     role that promises such children (tablist, grid…) goes with them;
   - tabindex="-1" (focus only the script gives), inline handlers,
     contenteditable and autofocus are removed, and so are <script>,
     <template>, <noscript>, <canvas>, <iframe>, <object>, <embed> and
     <datalist>; a <form> becomes a <div> with what was in it.
   2026-10-04:
   - every control made inert is marked data-inert (its kind), so the
     stylesheet can show a reader with no script text where a control was
     (styles.css, prerender: scripting none), and a slider is its stated
     value (aria-valuetext) or nothing — never its position ("As of 9");
   - what the app marks data-now (NOW, 35-ui.js: the reader's clock, a check
     run in the tab, a load in progress) is served as the value it gives —
     what any reader may be told there at any time — not as it was drawn;
   - a table cell keeps no tab stop (the grid's arrow keys are the script's),
     a disclosure whose body the script fills is marked data-inert, and an
     inline cursor:pointer goes: before the script, nothing is clickable but
     a link.
   counts says how many of each. servedText(root) is the text coverage-frames
   compares: every text node outside an <svg>, its whitespace collapsed;
   servedSignature(root) is what --check compares (below). */
export function servedCopy(live, counts = {}) {
  const KEEP = ['id', 'class', 'style', 'hidden'];
  const INTERACTIVE = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'option', 'slider', 'spinbutton', 'combobox', 'textbox', 'searchbox', 'treeitem', 'scrollbar']);
  const OWNING = new Set(['tablist', 'listbox', 'menu', 'menubar', 'radiogroup', 'tree', 'grid', 'treegrid', 'toolbar']);
  const STATE = ['aria-label', 'aria-labelledby', 'aria-describedby', 'aria-pressed', 'aria-selected', 'aria-checked', 'aria-expanded',
    'aria-controls', 'aria-haspopup', 'aria-disabled', 'aria-valuenow', 'aria-valuemin', 'aria-valuemax', 'aria-valuetext', 'aria-keyshortcuts'];
  const add = (k) => { counts[k] = (counts[k] || 0) + 1; };
  const span = (from) => { const s = document.createElement('span'); for (const a of KEEP) if (from.hasAttribute(a)) s.setAttribute(a, from.getAttribute(a)); return s; };
  const HTML = 'http://www.w3.org/1999/xhtml';
  const a = [live, ...live.querySelectorAll('*')];
  const root = live.cloneNode(true);
  const b = [root, ...root.querySelectorAll('*')];
  if (a.length !== b.length) throw new Error('the copy of the page does not match the page');
  const drop = [], controls = [];
  for (let i = 1; i < a.length; i++) {
    const o = a[i];
    if (o.namespaceURI === HTML && getComputedStyle(o).display === 'none') { drop.push(b[i]); continue; }
    if (o.matches('input, select, textarea, button')) controls.push([o, b[i]]);
  }
  for (const c of drop) if (root.contains(c)) { c.remove(); add('notShown'); }
  for (const [o, c] of controls) {
    if (!root.contains(c)) continue;
    const tag = c.localName;
    /* A button's words; a choice that is on keeps the mark the stylesheet
       draws it by (data-on: styles.css, prerender), not its state. */
    if (tag === 'button') {
      const s = span(c);
      s.setAttribute('data-inert', 'button');
      if (o.getAttribute('aria-pressed') === 'true' || o.getAttribute('aria-selected') === 'true') s.setAttribute('data-on', '');
      s.append(...c.childNodes); c.replaceWith(s); add('buttons'); continue;
    }
    if (tag === 'select') {
      const s = span(c); s.setAttribute('data-inert', 'field'); s.textContent = [...o.selectedOptions].map(x => x.textContent.trim()).join(', ');
      /* A select is as wide as its widest choice, a span as its chosen one:
         where nothing sets the select's width, that width is held (the
         calculator's demand table's first column took the difference, and
         its rows grew 18px each when the selects came). */
      const r = o.getBoundingClientRect(), was = o.getAttribute('style');
      o.style.width = 'auto'; o.style.minWidth = '0'; o.style.maxWidth = 'none'; o.style.flex = 'none'; o.style.justifySelf = 'start'; o.style.alignSelf = 'start';
      const own = o.getBoundingClientRect().width;
      if (was === null) o.removeAttribute('style'); else o.setAttribute('style', was);
      if (r.width && Math.abs(own - r.width) < 1) s.style.minWidth = `${Math.round(r.width)}px`;
      c.replaceWith(s); add('fields'); continue;
    }
    /* A textarea's height is its rows', which a span cannot carry: it is
       held, as drawn (the Trading Index's notes field moved the page 27px). */
    if (tag === 'textarea') { const s = span(c); s.setAttribute('data-inert', 'field'); s.style.minHeight = `${Math.round(o.getBoundingClientRect().height)}px`; s.style.whiteSpace = 'pre-wrap'; s.textContent = o.value; c.replaceWith(s); add('fields'); continue; }
    const type = String(o.type || 'text').toLowerCase();
    if (type === 'hidden' || type === 'file') { c.remove(); add('removed'); continue; }
    const s = span(c);
    if (type === 'checkbox' || type === 'radio') { s.setAttribute('data-inert', 'choice'); s.textContent = o.checked ? '☑' : '☐'; add('choices'); }
    /* A slider's value is a position ("9" of 5 to 9), not what it means. */
    else if (type === 'range') { s.setAttribute('data-inert', 'range'); s.textContent = o.getAttribute('aria-valuetext') || ''; add('fields'); }
    else { s.setAttribute('data-inert', 'field'); s.textContent = o.value; add('fields'); }
    if (o.hasAttribute('data-now')) s.setAttribute('data-now', o.getAttribute('data-now'));
    c.replaceWith(s);
  }
  /* What is this tab's, now (NOW, 35-ui.js): what any reader may be told. */
  for (const n of root.querySelectorAll('[data-now]')) if (root.contains(n)) { n.textContent = n.getAttribute('data-now'); add('now'); }
  /* A disclosure whose body the script fills when it opens. */
  for (const d of root.querySelectorAll('details')) {
    const body = [...d.childNodes].filter(k => !(k.nodeType === 1 && k.localName === 'summary'));
    if (!body.some(k => (k.textContent || '').trim() || (k.nodeType === 1 && k.querySelector('img, svg, table')))) { d.setAttribute('data-inert', 'details'); add('emptyDetails'); }
  }
  for (const n of root.querySelectorAll('script, template, noscript, canvas, iframe, object, embed, datalist')) { n.remove(); add('removed'); }
  for (const n of root.querySelectorAll('form')) {
    const d = document.createElement('div');
    for (const k of KEEP) if (n.hasAttribute(k)) d.setAttribute(k, n.getAttribute(k));
    d.append(...n.childNodes); n.replaceWith(d); add('forms');
  }
  for (const n of [root, ...root.querySelectorAll('*')]) {
    for (const at of [...n.attributes]) if (/^on/i.test(at.name) || ['contenteditable', 'autofocus', 'aria-activedescendant'].includes(at.name)) n.removeAttribute(at.name);
    if (n.getAttribute('tabindex') === '-1') n.removeAttribute('tabindex');
    /* A grid's first cell is its tab stop for the arrow keys (gridKeyboard,
       35-ui.js): served, a stop where no key does anything. */
    if (/^(th|td|tr)$/.test(n.localName) && n.hasAttribute('tabindex')) { n.removeAttribute('tabindex'); add('cellStops'); }
    const style = n.getAttribute('style');
    if (style && n.localName !== 'summary' && /cursor\s*:\s*pointer/i.test(style)) {
      const kept = style.split(';').filter(d => d.trim() && !/^\s*cursor\s*:\s*pointer\s*$/i.test(d)).join(';');
      if (kept) n.setAttribute('style', kept); else n.removeAttribute('style');
    }
    if (n.localName === 'label') n.removeAttribute('for');
    const role = n.getAttribute('role');
    if (role && INTERACTIVE.has(role) && n.localName !== 'a') {
      n.removeAttribute('role'); n.removeAttribute('tabindex');
      for (const k of STATE) n.removeAttribute(k);
      add('roles');
    } else if (role && OWNING.has(role)) { n.removeAttribute('role'); n.removeAttribute('aria-orientation'); n.removeAttribute('aria-multiselectable'); }
  }
  if (root.querySelector('style, link')) throw new Error('the page carries a <style> or <link> of its own');
  return root;
}
export function servedText(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest('svg') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  let t = '';
  for (let n = w.nextNode(); n; n = w.nextNode()) t += n.data;
  return t.replace(/\s+/g, ' ').trim();
}
/* The text of committed markup, by the same measure. */
export function textOfMarkup(servedText, html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return servedText(t.content);
}
/* WHAT --check COMPARES (2026-10-04). It compared the text outside <svg>
   only, so a render whose links went elsewhere than the app's, whose
   headings were other levels, which carried an attribute or a link the app
   does not draw — a figure in a title, an aria-label, a data- attribute —
   or whose chart printed other figures than the app's, passed: a view
   changed without rendering again (the About page's contact link pointed at
   /privacy; its card headings made h4) and a render edited by hand (an
   off-site link, a canary symbol and price in an attribute and in a chart)
   were each "the app's own render as committed". The markup is compared
   instead, element by element, every attribute and every word, the words
   of a chart included: they are the app's figures, the same on any machine.
   Only what the machine's fonts decide is left out — where a chart's marks
   and labels sit (an svg's coordinates, sizes, paths and transforms) and
   whether a scrolling strip is faded at an end (data-fade) — so the result
   is the same on CI's Linux as here. One token per element and one per run
   of text. */
export function servedSignature(root) {
  const GEOMETRY = new Set(['x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform', 'viewbox', 'dx', 'dy', 'textlength']);
  const out = [];
  let text = '';
  const flush = () => { const t = text.replace(/\s+/g, ' ').trim(); if (t) out.push(t); text = ''; };
  const walk = (n, svg) => {
    for (const k of n.childNodes) {
      if (k.nodeType === 3) { text += k.data; continue; }
      if (k.nodeType !== 1) continue;
      flush();
      const inSvg = svg || k.localName === 'svg';
      const attrs = [...k.attributes].filter(a => a.name !== 'data-fade' && !(inSvg && GEOMETRY.has(a.name.toLowerCase())))
        .map(a => `${a.name}="${a.value.replace(/\s+/g, ' ').trim()}"`).sort();
      out.push(`<${k.localName}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
      walk(k, inSvg);
      flush();
      out.push(`</${k.localName}>`);
    }
  };
  walk(root, false);
  flush();
  return out;
}
/* Committed markup and markup drawn now, compared by servedSignature: the
   first token where they part, with a few either side. */
export function compareMarkup(servedSignature, committed, drawn) {
  const sig = (html) => { const t = document.createElement('template'); t.innerHTML = html; return servedSignature(t.content); };
  const a = sig(committed), b = sig(drawn);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return null;
  const around = (x) => x.slice(Math.max(0, i - 3), i + 4).join(' ').slice(0, 400);
  return { at: i, of: Math.max(a.length, b.length), committed: around(a), drawn: around(b) };
}
/* What a page is served with, and what --check compares: #views and the
   tab row as servedCopy makes them, the page's first h1, its chrome, the
   links the navigation marks current, and the text. */
function capturePage(servedCopy, servedText, { origin, site }) {
  const counts = {};
  const viewRoot = document.getElementById('views');
  const views = servedCopy(viewRoot, counts);
  /* Not an entrance: the page is on screen from the first frame. */
  const section = views.querySelector(':scope > section.view');
  if (section) { section.setAttribute('data-active', '1'); section.setAttribute('data-redrawn', '1'); }
  const host = document.getElementById('productTabs');
  const tabs = host && !host.hidden && host.children.length ? servedCopy(host, counts) : null;
  const local = (html) => html.split(origin).join(site);
  const indices = (sel) => [...document.querySelectorAll(sel)].flatMap((x, i) => (x.getAttribute('aria-current') === 'page' ? [i] : []));
  const resBtn = document.getElementById('menuResourcesBtn');
  return {
    path: location.pathname, view: State.view, waits: !!(UNIVERSE_VIEWS.has(State.view)),
    chrome: document.documentElement.dataset.chrome || null,
    /* As served: what is the tab's, now, is not the page's heading. */
    h1: (views.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim() || null,
    views: local(views.innerHTML), tabs: tabs ? local(tabs.innerHTML) : null,
    text: servedText(views),
    nav: { pubnav: indices('#pubnav a'), resources: resBtn?.hasAttribute('data-current') ? resBtn.getAttribute('aria-description') : null, appnav: indices('#appnav a') },
    counts,
  };
}
/* The page-side call, with the helpers it is handed. */
const capture = (opts) => `(${capturePage})(${servedCopy}, ${servedText}, ${JSON.stringify(opts)})`;

/* The served navigation, parsed, against what the app drew in its place:
   node for node, attributes and all. */
function sameNavigation(served) {
  const out = [];
  for (const [id, inner] of Object.entries(served)) {
    const live = document.getElementById(id);
    const t = document.createElement('template');
    t.innerHTML = inner;
    const a = [...t.content.childNodes], b = live ? [...live.childNodes] : [];
    if (!live) { out.push(`#${id} is not on the page`); continue; }
    if (a.length !== b.length || a.some((n, i) => !n.isEqualNode(b[i]))) {
      let i = 0;
      while (i < a.length && i < b.length && a[i].isEqualNode(b[i])) i++;
      const said = (n) => (n ? (n.outerHTML || n.textContent || '').slice(0, 120) : 'nothing');
      out.push(`#${id}: served ${a.length} node${a.length === 1 ? '' : 's'}, the app drew ${b.length}, and they differ from child ${i} (served ${said(a[i])} / drawn ${said(b[i])})`);
    }
  }
  return out;
}

/* One page: its first draw, or — a page that waits for the filings — its
   draw once they are in. */
async function render(browser, base, s, site) {
  const url = base + s.path;
  const origin = new URL(base).origin;
  let tab = await openPage(browser, url, { hold: true });
  let state = 'first draw', snap;
  try {
    await settle(tab, { filings: false });
    snap = await tab.eval(capture({ origin, site }));
    if (snap.waits) {
      await tab.close();
      tab = await openPage(browser, url, { hold: false });
      await settle(tab, { filings: true });
      snap = await tab.eval(capture({ origin, site }));
      state = 'filings in';
    }
    const problems = [...tab.errors];
    if (tab.answeredPersonal.length) problems.push(`the personal lane was answered: ${tab.answeredPersonal.join(', ')}`);
    if (snap.path !== s.path) problems.push(`the page moved to ${snap.path}`);
    if (snap.view !== s.view) problems.push(`the page drew the view ${snap.view}, where ${s.path}'s route opens ${s.view}`);
    if (!snap.h1) problems.push('the page has no h1');
    if (snap.text.includes(SKELETON) || snap.views.includes(SKELETON)) problems.push('the page is the loading skeleton');
    if (/localhost/i.test(snap.views + (snap.tabs || ''))) problems.push('the render names the address it was drawn at');
    return { ...snap, state, problems, personal: tab.personal.length, held: tab.held.length, tab };
  } catch (e) {
    await tab.close();
    throw e;
  }
}

/* ─── THE CLEAN COPY ──────────────────────────────────────────────────────── */
/* THE COPY IS CHECKED BEFORE IT IS MADE, AND NEVER LEFT BEHIND (2026-10-03).
   A personal file among the tracked ones was found only once the copy held
   it, and the refusal then left that copy — the personal file in it — in
   the system's temporary folder, under a name no later run reuses. The list
   of what would be copied is read from git first, and a personal file in it
   stops the run with nothing written; anything that fails once the copy
   exists removes it. */
export function cleanCopy({ root = ROOT, worktree = WORKTREE } = {}) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const files = (worktree ? git('ls-files', '-z') : git('ls-tree', '-r', '--name-only', '-z', 'HEAD')).split('\0').filter(Boolean);
  const tracked = files.filter(PERSONAL_FILES);
  if (tracked.length) throw new Error(`personal data is tracked, and would be rendered from: ${tracked.join(', ')} — nothing was copied`);
  const dir = join(tmpdir(), `qt-prerender-${process.pid}`);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  mkdirSync(dir, { recursive: true });
  try {
    let from;
    if (worktree) {
      for (const f of files) {
        if (!existsSync(join(root, f))) continue;          /* deleted, not yet committed */
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        copyFileSync(join(root, f), join(dir, f));
      }
      from = `the working tree's ${files.length} tracked files`;
    } else {
      /* Through a pipe: GNU tar reads "C:\…" as a remote host's file name. */
      const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: root, maxBuffer: 1024 * 1024 * 1024 });
      execFileSync('tar', ['-xf', '-', '-C', dir], { input: archive, stdio: ['pipe', 'ignore', 'pipe'] });
      from = `HEAD (${git('rev-parse', '--short=12', 'HEAD').trim()})`;
    }
    /* And the copy itself, as it stands: a personal file in it is a tracked one. */
    const all = [];
    const list = (rel) => { for (const d of readdirSync(join(dir, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${d.name}` : d.name; if (d.isDirectory()) list(r); else all.push(r); } };
    list('');
    const personal = all.filter(PERSONAL_FILES);
    if (personal.length) throw new Error(`personal data is tracked, and would be rendered from: ${personal.join(', ')}`);
    rmSync(join(dir, 'prerender'), { recursive: true, force: true });
    execFileSync(process.execPath, ['build.mjs', '--bare'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
    return { dir, from };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    throw e;
  }
}

/* WHAT HEAD DOES NOT HAVE (2026-10-03). A render is drawn from HEAD unless
   --worktree is given, so a view edited and not yet committed was rendered
   as it was, and the run said "Now: node build.mjs" — the old page,
   committed under the new code, passing build --check. What the working
   tree changes that the app is made from: every tracked file but the
   renders and what build.mjs writes, and any new file under src/ or data/. */
const OUTPUTS = (f) => /^(prerender\/|pages\/|assets\/|index\.html$|404\.html$|vercel\.json$|health\/)/.test(f);
export function unrendered({ root = ROOT } = {}) {
  const out = execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const said = [];
  const parts = out.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2), file = parts[i].slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++;          /* the old name follows */
    if (OUTPUTS(file)) continue;
    if (code === '??' && !/^(src|data)\//.test(file)) continue;
    said.push(file);
  }
  return said;
}

/* THE SERVER IS PRERENDER'S OWN (2026-10-03). The copy's server was taken
   to be up as soon as anything answered on its port: a server already
   there — the owner's own checkout, personal files and uncommitted edits
   and all, on the port this used to default to — was drawn from instead,
   while the copy's serve.mjs died on the taken port unseen, and the run
   reported a clean render of HEAD. So a port that answers before the copy
   is served stops the run, and the server is known as the copy's by a file
   only the copy holds (a name and contents made up for this run), read
   back on both loopback addresses and, before any page is drawn, by the
   browser at the address it draws from (main). */
export async function serve(dir, port = PORT) {
  if (!port) port = await freePort();
  else if (await answers(`http://127.0.0.1:${port}/`) || await answers(`http://[::1]:${port}/`))
    throw new Error(`port ${port} is answered by a server prerender did not start — it draws only the clean copy it serves itself, never a server already running (the owner's own may be); stop that one or leave --port out`);
  const nonce = randomBytes(16).toString('hex');
  const proof = `/prerender-copy-${nonce}.txt`;
  writeFileSync(join(dir, proof.slice(1)), nonce);
  const proc = spawn(process.execPath, ['serve.mjs', '--port', String(port), '--root', '.'], { cwd: dir, stdio: 'ignore' });
  const read = async (u) => { try { const r = await fetch(u, { signal: AbortSignal.timeout(1000) }); return r.ok ? await r.text() : `${r.status}`; } catch { return null; } };
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) break;
    const four = await read(`http://127.0.0.1:${port}${proof}`), six = await read(`http://[::1]:${port}${proof}`);
    if ((four !== null && four !== nonce) || (six !== null && six !== nonce)) {
      proc.kill();
      throw new Error(`port ${port} is answered by a server that does not serve the clean copy — prerender draws only its own`);
    }
    if (four === nonce || six === nonce) return { proc, port, proof, nonce };
    await sleep(150);
  }
  proc.kill();
  throw new Error(`the clean copy's server never answered on port ${port}`);
}

/* An address on the owner's machine is drawn as production serves it. */
export const asLive = (u) => { const x = new URL(u); if (['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)) x.hostname = 'live.localhost'; return x.origin; };

/* ─── SELF-TEST ───────────────────────────────────────────────────────────────
   node prerender.mjs --self-test [--commit <sha>]

   The tool's own guards, held where they failed (2026-10-03), by running the
   tool — the copy's own prerender.mjs — in a throwaway git copy of a commit
   (HEAD, or --commit to show a commit before the guards failing them). Every
   run names its ports, so nothing here ever reaches a server or a browser it
   did not start for the test:
   1. a personal file is tracked: the run refuses, and leaves no copy of the
      site — that file in it — in the system's temporary folder;
   2. the owner's checkout is already served on the port named, with a view
      edited and not committed: the run refuses, writes nothing, and names
      the uncommitted source it would not have rendered;
   3. a Chrome is already listening on CDP_PORT: the run refuses and writes
      nothing, rather than drawing in that browser's profile;
   4. free ports named for both: the run draws the page from the copy, the
      same bytes as committed.
   Needs Chrome (3, 4), and one render's time for 4 and for a commit that
   fails 2 or 3. */
async function selfTest() {
  const commit = flag('commit') || 'HEAD';
  const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, ...opts });
  const dir = join(tmpdir(), `qt-prerender-selftest-${process.pid}`);
  const procs = [];
  let bad = 0;
  const say = (ok, msg, detail = []) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); detail.forEach(d => console.log(`      ${d}`)); if (!ok) bad++; };
  /* The tool under test, run in the copy, its output kept. */
  const run = (args, env = {}) => new Promise((res) => {
    const p = spawn(process.execPath, ['prerender.mjs', ...args], { cwd: dir, env: { ...process.env, CDP_PORT: '', PRERENDER_PORT: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    const timer = setTimeout(() => p.kill(), 240000);
    p.on('exit', (code) => { clearTimeout(timer); res({ code, out }); });
  });
  const leftovers = () => readdirSync(tmpdir()).filter(n => /^qt-prerender-\d+$/.test(n));
  const about = () => (existsSync(join(dir, 'prerender', 'about.html')) ? readFileSync(join(dir, 'prerender', 'about.html'), 'utf8') : null);
  try {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const archive = execFileSync('git', ['archive', '--format=tar', commit], { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', dir], { input: archive, stdio: ['pipe', 'ignore', 'pipe'] });
    const git = (...a) => sh('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=prerender self-test', '-c', 'user.email=self-test@example.invalid', ...a], { cwd: dir });
    git('init', '-q'); git('add', '-A'); git('commit', '-qm', `copy of ${commit}`);
    console.log(`prerender --self-test  the tool at ${commit} (${git('rev-parse', '--short=12', 'HEAD').trim()} in a copy at ${dir})\n`);
    const committed = about();

    /* 1. A personal file tracked. */
    {
      writeFileSync(join(dir, 'data', 'scan-alerts.json'), JSON.stringify({ engine: 'synthetic, prerender --self-test', alerts: [{ symbol: 'QTSELFTEST', setupName: 'not anyone\'s' }] }));
      git('add', '-f', 'data/scan-alerts.json');
      const before = new Set(leftovers());
      const r = await run(['--worktree', '--only', '/about', '--port', String(await freePort())]);
      const left = leftovers().filter(n => !before.has(n) && existsSync(join(tmpdir(), n, 'data', 'scan-alerts.json')));
      left.forEach(n => rmSync(join(tmpdir(), n), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
      git('rm', '-q', '--cached', 'data/scan-alerts.json'); rmSync(join(dir, 'data', 'scan-alerts.json'));
      say(r.code !== 0 && /personal data is tracked/.test(r.out) && !left.length,
        'a tracked personal file stops the run, and no copy of the site is left behind with it',
        [`exit ${r.code}; ${left.length ? `left in the temporary folder, the personal file in it: ${left.join(', ')} (removed now)` : 'nothing left in the temporary folder'}`, ...r.out.trim().split('\n').slice(-2)]);
    }

    /* 2. The owner's checkout, served on the port named: a view edited and
          not committed, built, and served by its own serve.mjs. */
    {
      const view = join(dir, 'src', 'js', '55-views-public.js');
      writeFileSync(view, readFileSync(view, 'utf8').replace("'What Quantum Tradeworks is',", "'What Quantum Tradeworks is SELFTEST-UNCOMMITTED',"));
      sh(process.execPath, ['build.mjs'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
      const port = await freePort();
      const owner = spawn(process.execPath, ['serve.mjs', '--port', String(port)], { cwd: dir, stdio: 'ignore' });
      procs.push(owner);
      for (let i = 0; i < 60 && !await answers(`http://127.0.0.1:${port}/about`); i++) await sleep(150);
      const r = await run(['--port', String(port), '--only', '/about'], { CDP_PORT: String(await freePort()) });
      owner.kill();
      const now = about();
      git('checkout', '-q', '--', '.'); git('clean', '-fdq');
      say(r.code !== 0 && now === committed && !/SELFTEST-UNCOMMITTED/.test(now || '') && /src\/js\/55-views-public\.js/.test(r.out),
        'a server already on the port named (the owner\'s checkout, an uncommitted edit served) stops the run: nothing is drawn from it, nothing is written, and the uncommitted view is named',
        [`exit ${r.code}; prerender/about.html ${now === committed ? 'as committed' : /SELFTEST-UNCOMMITTED/.test(now || '') ? 'WRITTEN FROM THAT SERVER, the uncommitted edit in it' : 'changed'}; the uncommitted view ${/src\/js\/55-views-public\.js/.test(r.out) ? 'named' : 'never named'}`, ...r.out.trim().split('\n').filter(l => /prerender|WARNING|port/.test(l)).slice(0, 3)]);
    }

    /* 3. A Chrome already on CDP_PORT, in a profile of its own (as
          autoshot's, which holds the owner's signed-in session, would be). */
    {
      const bin = CANDIDATES.find(existsSync);
      if (!bin) say(false, 'no Chrome to start as the one already there — set CHROME_PATH');
      else {
        const cdp = await freePort();
        const profile = join(tmpdir(), `qt-prerender-selftest-chrome-${process.pid}`);
        rmSync(profile, { recursive: true, force: true });
        const other = spawn(bin, [`--remote-debugging-port=${cdp}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });
        procs.push(other);
        for (let i = 0; i < 80 && !await answers(`http://127.0.0.1:${cdp}/json/version`); i++) await sleep(150);
        const r = await run(['--port', String(await freePort()), '--only', '/about'], { CDP_PORT: String(cdp) });
        other.kill();
        await new Promise(res => { if (other.exitCode !== null) return res(); other.once('exit', res); setTimeout(res, 5000); });
        await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
        const now = about();
        git('checkout', '-q', '--', '.'); git('clean', '-fdq');
        say(r.code !== 0 && now === committed && /already has a browser/.test(r.out),
          'a Chrome already on CDP_PORT stops the run: no page is drawn in another browser\'s profile',
          [`exit ${r.code}; ${r.code === 0 ? 'the run drew its pages in the browser that was already there' : 'refused'}`, ...r.out.trim().split('\n').filter(l => /prerender|CDP|devtools|ok |FAIL/.test(l)).slice(0, 3)]);
      }
    }
    /* 4. And free ports named for both: the page is drawn, from the copy,
          as committed — the same bytes. (Chrome writes no DevToolsActivePort
          for a port it is told, and a run given CDP_PORT never started.) */
    {
      const r = await run(['--port', String(await freePort()), '--only', '/about'], { CDP_PORT: String(await freePort()) });
      const now = about();
      git('checkout', '-q', '--', '.'); git('clean', '-fdq');
      say(r.code === 0 && now === committed,
        'free ports named for the server and for Chrome: the page is drawn from the clean copy, byte for byte as committed',
        [`exit ${r.code}; prerender/about.html ${now === committed ? 'as committed' : 'not as committed'}`, ...r.out.trim().split('\n').filter(l => /prerender|ok |FAIL/.test(l)).slice(0, 3)]);
    }
  } catch (e) {
    say(false, `the self-test could not run: ${e.message}`);
  } finally {
    procs.forEach(p => { try { p.kill(); } catch { /* gone */ } });
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
  }
  console.log(bad ? `\n${bad} of 4 checks fail` : '\nself-test: the run refuses a tracked personal file and leaves no copy, refuses a server it did not start and names what HEAD lacks, refuses a browser it did not start, and with free ports named draws the page as committed');
  process.exit(bad ? 1 : 0);
}

/* ─── RUN ─────────────────────────────────────────────────────────────────── */
/* Only when run: coverage-frames.mjs reads the drawing conditions above. */
if (process.argv[1] && /prerender\.mjs$/.test(process.argv[1])) {
  if (argv.includes('--self-test')) await selfTest(); else await main();
}

async function main() {
  const template = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  const SITE = siteOrigin(template);
  const plan = routePlan(template);
  const scope = prerenderScope(plan).filter(s => !ONLY.length || ONLY.includes(s.path));
  if (ONLY.length && scope.length !== ONLY.length) {
    console.error(`--only names ${ONLY.filter(p => !scope.some(s => s.path === p)).join(', ')}, which no page in scope is rendered at`);
    process.exit(2);
  }

  let browser = null, server = null, copy = null, failed = 0;
  const say = (ok, msg, detail = []) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${msg}`); detail.slice(0, 12).forEach(d => console.log(`      ${d}`)); if (!ok) failed++; };
  try {
    if (CHECK) {
      const target = (flag('check') || argv.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
      if (!/^https?:\/\//.test(target)) { console.error('--check needs the address of a served site: node prerender.mjs --check http://localhost:8123'); process.exit(2); }
      const base = asLive(target);
      console.log(`prerender --check  ${target}${base !== new URL(target).origin ? ` (drawn at ${base}, as production serves it)` : ''}  ${scope.length} pages\n`);
      const manifest = JSON.parse(lf(readFileSync(join(ROOT, MANIFEST), 'utf8')));
      browser = await startBrowser();
      for (const s of scope) {
        const m = manifest.pages?.[s.file];
        if (!m || !existsSync(join(ROOT, s.render))) { say(false, `${s.path}: no render committed (${s.render}) — run node prerender.mjs`); continue; }
        const committed = lf(readFileSync(join(ROOT, s.render), 'utf8')).replace(/\n$/, '');
        let r;
        try { r = await render(browser, base, s, SITE); } catch (e) { say(false, `${s.path}: ${e.message}`); continue; }
        const problems = [...r.problems];
        /* Where they part. The committed side is said only off CI: a render
           that should never have been committed (one carrying the owner's
           figures) would be printed into a public log by its own failure. */
        const parted = (what, d) => [`${what} is not the committed render's, from token ${d.at} of ${d.of}:`,
          ...(process.env.CI ? [] : [`  committed  …${d.committed}…`]), `  drawn now  …${d.drawn}…`];
        try {
          const diff = await r.tab.eval(`(${compareMarkup})(${servedSignature}, ${JSON.stringify(committed)}, ${JSON.stringify(r.views)})`);
          if (diff) problems.push(...parted('its markup', diff));
          if (r.chrome !== m.chrome) problems.push(`it wears the ${r.chrome} chrome, the committed render the ${m.chrome}`);
          if (JSON.stringify(r.nav) !== JSON.stringify(m.nav)) problems.push(`the navigation marks ${JSON.stringify(r.nav)} current, the committed render ${JSON.stringify(m.nav)}`);
          if (r.h1 !== m.h1) problems.push(`its h1 is ${JSON.stringify(r.h1)}, the committed render's ${JSON.stringify(m.h1)}`);
          if (!!r.tabs !== !!m.tabs) problems.push(r.tabs ? 'it draws a tab row the committed render does not have' : 'the committed render has a tab row it does not draw');
          else if (r.tabs) {
            const tabsDiff = await r.tab.eval(`(${compareMarkup})(${servedSignature}, ${JSON.stringify(lf(readFileSync(join(ROOT, s.tabs), 'utf8')).replace(/\n$/, ''))}, ${JSON.stringify(r.tabs)})`);
            if (tabsDiff) problems.push(...parted('its tab row', tabsDiff));
          }
          /* And the navigation the address is served with is the app's own
             drawing, node for node, once the app has drawn the page. */
          const html = await (await fetch(target + s.path)).text();
          const served = {};
          for (const [slot, [open, close]] of Object.entries(NAV_SLOTS)) {
            const i = html.indexOf(open), j = i < 0 ? -1 : html.indexOf(close, i + open.length);
            served[slot] = i < 0 || j < 0 ? '' : html.slice(i + open.length, j);
          }
          problems.push(...await r.tab.eval(`(${sameNavigation})(${JSON.stringify(served)})`));
        } finally { await r.tab.close(); }
        say(!problems.length, `${s.path}  ${r.state}, "${r.h1}"${problems.length ? '' : ` — the committed render's markup (every element, attribute and word, a chart's figures with them; ${r.text.length} characters of text), chrome and current links, and the served navigation is the app's drawing`}`, problems);
      }
      console.log(`\n${scope.length - failed} of ${scope.length} pages are the app's own render as committed${failed ? `; ${failed} are not — run node prerender.mjs, then node build.mjs` : ''}`);
    } else {
      const notRendered = WORKTREE ? [] : unrendered();
      const warnUnrendered = () => {
        if (!notRendered.length) return;
        console.error(`\nWARNING  rendered from HEAD: the working tree changes ${notRendered.length} file${notRendered.length === 1 ? '' : 's'} the app is made from, which these renders do not have —`);
        notRendered.slice(0, 12).forEach(f => console.error(`           ${f}`));
        if (notRendered.length > 12) console.error(`           and ${notRendered.length - 12} more`);
        console.error('         commit them and run this again, or run node prerender.mjs --worktree to render them as they stand.');
      };
      warnUnrendered();
      copy = cleanCopy();
      server = await serve(copy.dir);
      const base = `http://live.localhost:${server.port}`;
      console.log(`prerender  ${scope.length} pages from ${copy.from}, served at ${base}; ${VIEWPORT.width}×${VIEWPORT.height}, light, reduced motion, ${ZONE}, ${LOCALE}, clock ${CLOCK}\n`);
      browser = await startBrowser();
      /* The address the pages are drawn from serves the copy: its own file,
         read by the browser there. */
      {
        const tab = await openPage(browser, base + server.proof, { hold: false });
        try {
          await sleep(300);
          const said = await tab.eval('document.body ? document.body.innerText.trim() : ""').catch(() => null);
          if (said !== server.nonce) throw new Error(`${base} does not serve the clean copy in the browser — prerender draws only its own server`);
        } finally { await tab.close(); }
      }
      const results = [];
      for (const s of scope) {
        let r;
        try { r = await render(browser, base, s, SITE); } catch (e) { say(false, `${s.path}: ${e.message}`); continue; }
        await r.tab.close();
        const c = r.counts;
        const n = (k, one, many) => c[k] ? `${c[k]} ${c[k] === 1 ? one : many}` : null;
        const inertSaid = [n('buttons', 'button', 'buttons'), n('fields', 'field', 'fields'), n('choices', 'choice', 'choices'), n('roles', 'control role', 'control roles'),
          n('forms', 'form', 'forms'), n('removed', 'removed', 'removed'), n('notShown', 'not shown at this width', 'not shown at this width'),
          n('now', 'of the tab’s own now', 'of the tab’s own now'), n('cellStops', 'cell tab stop', 'cell tab stops'), n('emptyDetails', 'empty disclosure', 'empty disclosures')].filter(Boolean).join(', ');
        say(!r.problems.length, `${s.path.padEnd(28)} ${r.state.padEnd(10)} ${String(Math.round(Buffer.byteLength(r.views) / 1024)).padStart(3)}kB  "${r.h1}"${r.tabs ? ' + tab row' : ''}${inertSaid ? `  inert: ${inertSaid}` : ''}${r.personal ? `  (${r.personal} personal-lane request${r.personal === 1 ? '' : 's'} answered 404 here)` : ''}`, r.problems);
        if (!r.problems.length) results.push({ s, r });
      }
      if (failed) throw new Error(`${failed} page${failed === 1 ? '' : 's'} could not be rendered; nothing was written`);
      /* Written only when every page rendered: a partial set would serve some
         pages a render of an older app. */
      const prior = existsSync(join(ROOT, MANIFEST)) ? JSON.parse(lf(readFileSync(join(ROOT, MANIFEST), 'utf8'))) : { pages: {} };
      const pages = ONLY.length ? { ...prior.pages } : {};
      for (const { s, r } of results) {
        mkdirSync(dirname(join(ROOT, s.render)), { recursive: true });
        writeFileSync(join(ROOT, s.render), `${r.views}\n`);
        if (r.tabs) writeFileSync(join(ROOT, s.tabs), `${r.tabs}\n`); else rmSync(join(ROOT, s.tabs), { force: true });
        pages[s.file] = { path: s.path, view: r.view, state: r.state, chrome: r.chrome, h1: r.h1, tabs: !!r.tabs, nav: r.nav,
          inert: Object.fromEntries(['buttons', 'fields', 'choices', 'roles', 'forms', 'removed', 'notShown', 'now', 'cellStops', 'emptyDetails'].map(k => [k, r.counts[k] || 0])),
          digest: renderDigest(r.views, r.tabs) };
      }
      const ordered = Object.fromEntries(Object.keys(pages).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b))).map(k => [k, pages[k]]));
      const manifest = {
        $comment: 'Written by prerender.mjs: how each page in prerender/ was drawn. build.mjs puts each render into its page; node prerender.mjs --check says whether each is still the app\'s.',
        drawn: { viewport: `${VIEWPORT.width}x${VIEWPORT.height}`, theme: 'light', motion: 'reduce', clock: CLOCK, timeZone: ZONE, locale: LOCALE, storage: 'none', personalLane: '404' },
        pages: ordered,
      };
      writeFileSync(join(ROOT, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
      /* A render no page in scope reads any more. */
      if (!ONLY.length) {
        const keep = new Set([MANIFEST, ...results.flatMap(({ s, r }) => [s.render, ...(r.tabs ? [s.tabs] : [])])]);
        const under = (rel) => readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap(d => (d.isDirectory() ? under(`${rel}/${d.name}`) : [`${rel}/${d.name}`]));
        for (const f of under('prerender')) if (!keep.has(f)) { rmSync(join(ROOT, f)); console.log(`removed     ${f} — no page in scope reads it`); }
      }
      const total = results.reduce((n, { r }) => n + Buffer.byteLength(r.views) + Buffer.byteLength(r.tabs || ''), 0);
      console.log(`\nwrote ${results.length} renders (${(total / 1024).toFixed(0)}kB) and ${MANIFEST} from ${copy.from}. Now: node build.mjs`);
      warnUnrendered();
    }
  } catch (e) {
    console.error(`\nprerender: ${e.message}`);
    failed = failed || 1;
  } finally {
    if (browser) await browser.close();
    if (server) { const p = server.proc; p.kill(); await new Promise(r => { if (p.exitCode !== null) return r(); p.once('exit', r); setTimeout(r, 3000); }); }
    if (copy) rmSync(copy.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
  process.exit(failed ? 1 : 0);
}
