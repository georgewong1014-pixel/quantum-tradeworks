#!/usr/bin/env node
/**
 * Every page's own content in the HTML it is served with.
 *
 *   node prerender.mjs                 render every page in scope from a clean copy of HEAD
 *                                      and write prerender/ (then: node build.mjs)
 *   node prerender.mjs --worktree      the same from the working tree's tracked files, for
 *                                      a change not yet committed — still no personal file
 *   node prerender.mjs --check <url>   render every page at <url> again and fail if a page's
 *                                      text, its chrome, its current links or its served
 *                                      navigation differ from what is committed
 *
 *   --only /pricing,/about    just these pages (a write keeps every other render)
 *   --port <n>                the clean copy's server (default 8125, or PRERENDER_PORT)
 *   CDP_PORT                  Chrome's debugging port, as for every harness
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
 * --check compares TEXT, not bytes: a chart's geometry and the labels it
 * fits by measuring them are the machine's fonts', and the harnesses hold
 * its numbers; svg text is left out for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routePlan, prerenderScope, NAV_SLOTS, siteOrigin } from './build.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null; };
const CHECK = argv.includes('--check');
const WORKTREE = argv.includes('--worktree');
const ONLY = (flag('only') || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(flag('port') || process.env.PRERENDER_PORT || 8125);
const CDP = Number(process.env.CDP_PORT) || 9450 + (process.pid % 150);
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

async function startBrowser() {
  const bin = CANDIDATES.find(existsSync);
  if (!bin) throw new Error('no Chrome or Edge found — set CHROME_PATH');
  const profile = join(tmpdir(), `cdp-prerender-${process.pid}`);
  const proc = spawn(bin, [`--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-gpu', '--hide-scrollbars', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });
  let url = null;
  for (let i = 0; i < 80 && !url; i++) {
    try { url = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  if (!url) { proc.kill(); throw new Error(`devtools never came up on port ${CDP}`); }
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
   counts says how many of each. servedText(root) is the text --check and
   coverage-frames.mjs compare: every text node outside an <svg>, its
   whitespace collapsed. */
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
      if (o.getAttribute('aria-pressed') === 'true' || o.getAttribute('aria-selected') === 'true') s.setAttribute('data-on', '');
      s.append(...c.childNodes); c.replaceWith(s); add('buttons'); continue;
    }
    if (tag === 'select') { const s = span(c); s.textContent = [...o.selectedOptions].map(x => x.textContent.trim()).join(', '); c.replaceWith(s); add('fields'); continue; }
    if (tag === 'textarea') { const s = span(c); s.textContent = o.value; c.replaceWith(s); add('fields'); continue; }
    const type = String(o.type || 'text').toLowerCase();
    if (type === 'hidden' || type === 'file') { c.remove(); add('removed'); continue; }
    const s = span(c);
    if (type === 'checkbox' || type === 'radio') { s.textContent = o.checked ? '☑' : '☐'; add('choices'); }
    else { s.textContent = o.value; add('fields'); }
    c.replaceWith(s);
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
    h1: (viewRoot.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim() || null,
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
function cleanCopy() {
  const dir = join(tmpdir(), `qt-prerender-${process.pid}`);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  let from;
  if (WORKTREE) {
    const files = git('ls-files', '-z').split('\0').filter(Boolean);
    for (const f of files) {
      if (!existsSync(join(ROOT, f))) continue;          /* deleted, not yet committed */
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(dir, f));
    }
    from = `the working tree's ${files.length} tracked files`;
  } else {
    /* Through a pipe: GNU tar reads "C:\…" as a remote host's file name. */
    const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 });
    execFileSync('tar', ['-xf', '-', '-C', dir], { input: archive, stdio: ['pipe', 'ignore', 'pipe'] });
    from = `HEAD (${git('rev-parse', '--short=12', 'HEAD').trim()})`;
  }
  /* A personal file in the copy is a tracked one. */
  const all = [];
  const list = (rel) => { for (const d of readdirSync(join(dir, rel), { withFileTypes: true })) { const r = rel ? `${rel}/${d.name}` : d.name; if (d.isDirectory()) list(r); else all.push(r); } };
  list('');
  const personal = all.filter(PERSONAL_FILES);
  if (personal.length) throw new Error(`personal data is tracked, and would be rendered from: ${personal.join(', ')}`);
  rmSync(join(dir, 'prerender'), { recursive: true, force: true });
  execFileSync(process.execPath, ['build.mjs', '--bare'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  return { dir, from };
}

async function serve(dir) {
  const proc = spawn(process.execPath, ['serve.mjs', '--port', String(PORT), '--root', '.'], { cwd: dir, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/`); if (r.ok) return proc; } catch { /* not yet */ }
    if (proc.exitCode !== null) break;
    await sleep(150);
  }
  proc.kill();
  throw new Error(`the clean copy's server did not answer on port ${PORT} (another server there? use --port)`);
}

/* An address on the owner's machine is drawn as production serves it. */
export const asLive = (u) => { const x = new URL(u); if (['localhost', '127.0.0.1', '[::1]'].includes(x.hostname)) x.hostname = 'live.localhost'; return x.origin; };

/* ─── RUN ─────────────────────────────────────────────────────────────────── */
/* Only when run: coverage-frames.mjs reads the drawing conditions above. */
if (process.argv[1] && /prerender\.mjs$/.test(process.argv[1])) await main();

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
        try {
          const want = await r.tab.eval(`(${textOfMarkup})(${servedText}, ${JSON.stringify(committed)})`);
          if (want !== r.text) {
            let i = 0; while (i < want.length && want[i] === r.text[i]) i++;
            problems.push(`its text is not the committed render's, from character ${i}:`, `  committed  …${want.slice(Math.max(0, i - 40), i + 80)}…`, `  drawn now  …${r.text.slice(Math.max(0, i - 40), i + 80)}…`);
          }
          if (r.chrome !== m.chrome) problems.push(`it wears the ${r.chrome} chrome, the committed render the ${m.chrome}`);
          if (JSON.stringify(r.nav) !== JSON.stringify(m.nav)) problems.push(`the navigation marks ${JSON.stringify(r.nav)} current, the committed render ${JSON.stringify(m.nav)}`);
          if (r.h1 !== m.h1) problems.push(`its h1 is ${JSON.stringify(r.h1)}, the committed render's ${JSON.stringify(m.h1)}`);
          if (!!r.tabs !== !!m.tabs) problems.push(r.tabs ? 'it draws a tab row the committed render does not have' : 'the committed render has a tab row it does not draw');
          else if (r.tabs) {
            const tabsWant = await r.tab.eval(`(${textOfMarkup})(${servedText}, ${JSON.stringify(lf(readFileSync(join(ROOT, s.tabs), 'utf8')).replace(/\n$/, ''))})`);
            const tabsNow = await r.tab.eval(`(${textOfMarkup})(${servedText}, ${JSON.stringify(r.tabs)})`);
            if (tabsWant !== tabsNow) problems.push(`its tab row reads ${JSON.stringify(tabsNow.slice(0, 120))}, the committed one ${JSON.stringify(tabsWant.slice(0, 120))}`);
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
        say(!problems.length, `${s.path}  ${r.state}, "${r.h1}"${problems.length ? '' : ` — the committed render's text (${r.text.length} characters), chrome and current links, and the served navigation is the app's drawing`}`, problems);
      }
      console.log(`\n${scope.length - failed} of ${scope.length} pages are the app's own render as committed${failed ? `; ${failed} are not — run node prerender.mjs, then node build.mjs` : ''}`);
    } else {
      copy = cleanCopy();
      server = await serve(copy.dir);
      const base = `http://live.localhost:${PORT}`;
      console.log(`prerender  ${scope.length} pages from ${copy.from}, served at ${base}; ${VIEWPORT.width}×${VIEWPORT.height}, light, reduced motion, ${ZONE}, ${LOCALE}, clock ${CLOCK}\n`);
      browser = await startBrowser();
      const results = [];
      for (const s of scope) {
        let r;
        try { r = await render(browser, base, s, SITE); } catch (e) { say(false, `${s.path}: ${e.message}`); continue; }
        await r.tab.close();
        const c = r.counts;
        const n = (k, one, many) => c[k] ? `${c[k]} ${c[k] === 1 ? one : many}` : null;
        const inertSaid = [n('buttons', 'button', 'buttons'), n('fields', 'field', 'fields'), n('choices', 'choice', 'choices'), n('roles', 'control role', 'control roles'),
          n('forms', 'form', 'forms'), n('removed', 'removed', 'removed'), n('notShown', 'not shown at this width', 'not shown at this width')].filter(Boolean).join(', ');
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
          inert: Object.fromEntries(['buttons', 'fields', 'choices', 'roles', 'forms', 'removed', 'notShown'].map(k => [k, r.counts[k] || 0])) };
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
      console.log(`\nwrote ${results.length} renders (${(total / 1024).toFixed(0)}kB) and ${MANIFEST}. Now: node build.mjs`);
    }
  } catch (e) {
    console.error(`\nprerender: ${e.message}`);
    failed = failed || 1;
  } finally {
    if (browser) await browser.close();
    if (server) { server.kill(); await new Promise(r => { if (server.exitCode !== null) return r(); server.once('exit', r); setTimeout(r, 3000); }); }
    if (copy) rmSync(copy.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
  process.exit(failed ? 1 : 0);
}
