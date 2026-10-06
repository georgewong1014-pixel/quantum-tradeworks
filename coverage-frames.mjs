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
const ROUTES = ['/', '/status', '/data-sources', '/discover/screener', '/research', '/methodology', '/corrections',
  /* The printable report must not state a count before coverage resolves:
     it waits for the filings like the company page, and prints none. */
  '/company/aapl-apple-inc/report'];

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
/* CDP_PORT pins the debugging port, so harnesses run side by side (several
   worktrees, or CI jobs on one runner) cannot land on the same Chrome. */
const port = Number(process.env.CDP_PORT) || 9950 + (process.pid % 40);
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

  /* ---- prerender ---- */
  /* THE SERVED PAGE IS THE PAGE, FROM THE FIRST FRAME (2026-10-03). Every
     static route's page is served with the app's own render of it in #views
     (prerender.mjs, build.mjs), which the script replaces with the same page
     drawn live. What a reader sees between the first paint and the settled
     page may change in one way only: there is content sooner. Held here for
     every page that carries a render, from before the parser reaches the
     script, in two phases:
     1. Every request the page makes held. The page the parser built is the
        committed render (its h1, its text). A page that waits for the filed
        statements is not drawn at all — the served page stands, the loading
        skeleton never appears. Any other page is drawn once, and its first
        draw is the committed render again: the page replaced itself with
        itself.
     2. Released. A page that waited is drawn once the filings land, as the
        committed render; on every page the h1 never changed or went missing,
        the skeleton never showed, and nothing shifted by more than the 0.1
        the sweep's first-load check allows.
     Drawn as prerender.mjs draws (1280×900, light, reduced motion, Kuala
     Lumpur, en-MY) so "the same page" can be exact; from live.localhost, so
     the app is served as production serves it.
     The observer is in the document before it is parsed, and it reads #views
     inside replaceChildren itself: the app's first draw runs in a microtask
     straight after its script, before the document is interactive, so an
     observer added after the navigation — or a mutation record delivered
     after the draw — would only ever see the drawn page.

     2026-10-04, after the verifiers found what this did not see:
     - It drew at the render's own clock, so it could not see a page served
       with that clock in it: "Good morning" to a reader at 20:15, a record
       "Prepared 2026-10-01 09:30". It draws at another (FRAMES_CLOCK, an
       evening two days on). What a page marks as the tab's, now (data-now,
       35-ui.js) is compared as served; every other word must be the same.
     - The browser's layout-shift entries see nothing of a page replaced by
       another — the nodes are new, not moved — so Learn's section tabs,
       served as words, moved the page 21px when they came, and the Scanner's
       tab row moved 328px sideways, at a shift of 0. Each run of text in the
       tab row and #views is measured where it stands before the app's script
       has run (the script is held) and where it stands once the page is
       drawn; none may have moved.
     - And the served page may stand only where it is the reader's page,
       says so while it waits, and keeps focus: see the block after the
       pages. */
  {
    const { readFileSync } = await import('node:fs');
    const { routePlan, prerenderScope, siteOrigin } = await import('./build.mjs');
    const P = await import('./prerender.mjs');
    const here = new URL('.', import.meta.url);
    const read = (f) => readFileSync(new URL(f, here), 'utf8').split('\r\n').join('\n');
    const plan = routePlan(read('src/index.template.html'));
    const manifest = JSON.parse(read('prerender/manifest.json'));
    const live = P.asLive(BASE);
    /* Not the render's clock (prerender.mjs, CLOCK: a Thursday morning). */
    const FRAMES_CLOCK = '2026-10-03T21:05:00+08:00';
    /* The page's text and h1 as it may be served (prerender.mjs: servedCopy,
       then servedText) — of the page the parser built and of the app's
       drawing alike, so the two are measured the same way. */
    const textOf = `(root) => (${P.servedText})((${P.servedCopy})(root))`;
    const observer = `(() => {
      const copyOf = ${P.servedCopy}, textIn = ${P.servedText};
      const snaps = window.__served = [];
      const snap = (el, when) => {
        const c = copyOf(el), h = c.querySelector('h1');
        snaps.push({ when, h1: h ? (h.textContent.replace(/\\s+/g, ' ').trim() || null) : null, text: textIn(c),
          served: el.hasAttribute('data-served'), skeleton: el.textContent.includes(${JSON.stringify(P.SKELETON)}),
          waiting: typeof realPending !== 'undefined' && realPending === true });
      };
      const replace = Element.prototype.replaceChildren;
      Element.prototype.replaceChildren = function (...nodes) {
        const views = this.id === 'views';
        if (views) snap(this, 'before');
        const r = replace.apply(this, nodes);
        if (views) snap(this, 'after');
        return r;
      };
      window.__cls = 0; window.__moved = [];
      const said = (n) => !n || n.nodeType !== 1 ? String(n && n.nodeName) : n.localName + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) {
        window.__cls += e.value;
        window.__moved.push(e.value.toFixed(3) + (typeof realPending !== 'undefined' && realPending ? ' (filings on their way)' : '') + ': ' + (e.sources || []).slice(0, 3).map(s => said(s.node) + ' ' + Math.round(s.previousRect.y) + '→' + Math.round(s.currentRect.y)).join(', '));
      } }).observe({ type: 'layout-shift', buffered: true });
    })();`;
    /* Where each run of text in the tab row and #views stands on the page,
       keyed by its words and how many times they came before. Not an svg's
       (a chart is drawn a frame after its page), not a screen reader's only
       (.sr-only), not a served field's value (the field drawn in its place
       holds it as a value, not as text: the controls' boxes are held by the
       words around them), and not one in a line holding what is the tab's,
       now: that line's words are the tab's own once drawn, and may run
       longer. */
    function positions() {
      const out = {}, seen = new Map();
      for (const r of [document.getElementById('productTabs'), document.getElementById('views')]) {
        if (!r || r.hidden) continue;
        const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          const t = n.data.replace(/\s+/g, ' ').trim();
          const e = n.parentElement;
          if (!t || !e || e.closest('svg, [data-now], .sr-only, [data-inert="field"], [data-inert="choice"], [data-inert="range"], select, textarea')) continue;
          const line = e.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, label, summary');
          if (line && line.querySelector('[data-now]')) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const b = range.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          const k = `${r.id}: ${t.slice(0, 50)}`, i = seen.get(k) || 0;
          seen.set(k, i + 1);
          out[`${k} #${i}`] = [Math.round(b.left + scrollX), Math.round(b.top + scrollY)];
        }
      }
      return out;
    }
    const movedBetween = (a, b) => Object.entries(a || {}).flatMap(([k, [x, y]]) => {
      const z = b?.[k];
      return z && (Math.abs(z[0] - x) > 2 || Math.abs(z[1] - y) > 2) ? [{ k, dx: z[0] - x, dy: z[1] - y }] : [];
    });
    const pages = prerenderScope(plan);
    const bad = [];
    let held = [], holding = true, sid = null, holdScript = false, scriptHeld = [];
    const APP_SCRIPT = /\/assets\/app\.[0-9a-f]+\.js$/;
    const onPause = (e) => {
      const m = JSON.parse(e.data);
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sid) return;
      if (APP_SCRIPT.test(new URL(m.params.request.url).pathname)) {
        if (holdScript) scriptHeld.push(m.params.requestId);
        else send('Fetch.continueRequest', { requestId: m.params.requestId }, sid);
        return;
      }
      if (holding) held.push(m.params.requestId);
      else send('Fetch.continueRequest', { requestId: m.params.requestId }, sid);
    };
    ws.addEventListener('message', onPause);
    const value = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)).result?.result?.value;
    const quiet = async (cond, ms = 15000) => {
      await value(`window.__q = __realNow(), new MutationObserver(() => { window.__q = __realNow(); }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }), 1`);
      for (const t0 = Date.now(); Date.now() - t0 < ms;) {
        if (await value(`!!(${cond}) && __realNow() - window.__q > 600`)) return true;
        await sleep(120);
      }
      return false;
    };
    const until = async (cond, ms = 15000) => { for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await value(`!!(${cond})`)) return true; await sleep(60); } return false; };
    const releaseAll = async () => {
      holding = false; holdScript = false;
      for (const requestId of [...held, ...scriptHeld]) await send('Fetch.continueRequest', { requestId }, sid);
      held = []; scriptHeld = [];
    };
    const releaseScript = async () => { holdScript = false; for (const requestId of scriptHeld) await send('Fetch.continueRequest', { requestId }, sid); scriptHeld = []; };
    /* A first visit: storage and cache emptied, and — for a returning
       reader — what their browser holds written first.
       THE PAGE LEFT GOES FIRST (5 Oct 2026). This let what it held from the
       page before through, then went to about:blank, waited 150ms and
       emptied the origin's storage. A page whose app's script had been held
       got it then, and its app — 3.5MB to parse — booted while the tab was
       leaving: it wrote the first visit's samples (vl.watchlists,
       vl.portfolios, vl.theses…) and, at pagehide, its digests into the
       origin after the storage was emptied, often after the next page had
       begun. So "a fresh visitor" held another page's samples, with or
       without their digests, and the head's script rightly kept a page that
       reads one out of sight: a sample's text with no digest kept beside it
       may be the reader's own. /app/equities after /research (theses),
       /app/scanner/watchlists after a scanner page (watchlists) — a
       different page on different runs, more often on a slower machine: 4
       of 10 runs of the Kuala Lumpur loop alone on a clean copy of 6b4d7b3
       here, 122 of its 500 "fresh" visits holding another page's keys, and
       not one visit that held nothing kept out of sight; none on CI's
       runner. Now the page left opens about:blank itself, and the tab is
       on it before anything held is answered: no app of the page left runs
       at all. By its own hand, not the browser's: a blank page the page
       opens takes its origin and its process, so it commits after the page
       left has unloaded and its pagehide has run — one the browser opens
       did not wait for that, and a page whose app had run wrote its digests
       (vl.servedReads) after the storage was emptied. Then the storage is
       emptied, and read back empty from that blank page. Conditions, not a
       longer wait: 10 of 10 runs of the loop, and not one visit holding a
       key, on the same copy. */
    const firstVisit = async ({ seed = null, raw = null, script = false } = {}) => {
      await value(`(location.href = 'about:blank', true)`);
      if (!await until(`location.href === 'about:blank'`, 5000)) {
        /* A page that cannot leave by its own hand (an error page). */
        await send('Page.navigate', { url: 'about:blank' }, sid);
        if (!await until(`location.href === 'about:blank'`)) throw new Error('the tab never reached about:blank for a first visit');
      }
      await releaseAll();
      await send('Storage.clearDataForOrigin', { origin: live, storageTypes: 'all' }, sid);
      await send('Network.clearBrowserCache', {}, sid);
      if (!await until(`(() => { try { return !Object.keys(localStorage).some(k => k.startsWith('vl.')); } catch (e) { return true; } })()`, 5000))
        throw new Error('the site\'s storage still held vl.* after it was emptied for a first visit');
      /* seed: values, written as the app writes them; raw: as stored. */
      const kept = { ...Object.fromEntries(Object.entries(seed || {}).map(([k, v]) => [k, JSON.stringify(v)])), ...(raw || {}) };
      if (Object.keys(kept).length) {
        await send('Page.navigate', { url: `${live}/robots.txt` }, sid);
        await sleep(300);
        await value(`(() => { const kept = ${JSON.stringify(kept)}; for (const [k, v] of Object.entries(kept)) localStorage.setItem('vl.' + k, v); return true; })()`);
      }
      held = []; holding = true; holdScript = script; scriptHeld = [];
    };
    /* The served page, painted, its script not yet run: the stylesheet in,
       two frames drawn. */
    const SERVED_PAINTED = `!!document.querySelector('#views[data-served]') && typeof State === 'undefined'
      && [...document.styleSheets].some(s => { try { return s.href && /\\/assets\\/app\\./.test(s.href) && s.cssRules.length > 0; } catch { return false; } })`;
    const painted = () => value('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))');
    let maxCls = 0;
    /* One tab in the browser's own context, emptied before every page: its
       storage and its cache cleared, so each load is a first visit's. (A new
       browser context per page — the obvious way to a fresh profile — styles
       a size container's contents without the page's custom properties until
       the script runs, a quirk of CDP's contexts that a reader's own tab does
       not show: the tab row was drawn 32px too tall on most loads there and
       on none here.) */
    const { result: { targetId: tid } } = await send('Target.createTarget', { url: 'about:blank' });
    sid = (await send('Target.attachToTarget', { targetId: tid, flatten: true })).result.sessionId;
    /* The clock's script, kept so a later check can draw at another. */
    let clockId = null;
    const FRAMES_CLOCK_SCRIPT = P.clockScript(FRAMES_CLOCK);
    for (const [method, params] of [['Runtime.enable', {}], ['Page.enable', {}], ['Network.enable', {}],
      ['Emulation.setDeviceMetricsOverride', { ...P.VIEWPORT, deviceScaleFactor: 1, mobile: false }],
      ['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }],
      ['Emulation.setTimezoneOverride', { timezoneId: P.ZONE }], ['Emulation.setLocaleOverride', { locale: P.LOCALE }],
      ['Page.addScriptToEvaluateOnNewDocument', { source: FRAMES_CLOCK_SCRIPT }],
      ['Page.addScriptToEvaluateOnNewDocument', { source: observer }],
      ['Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Fetch', requestStage: 'Request' }, { urlPattern: '*', resourceType: 'XHR', requestStage: 'Request' },
        { urlPattern: '*/assets/app.*.js', resourceType: 'Script', requestStage: 'Request' }] }]]) {
      const r = await send(method, params, sid);
      if (params.source === FRAMES_CLOCK_SCRIPT) clockId = r.result?.identifier;
    }
    try {
    for (const s of pages) {
      const m = manifest.pages?.[s.file];
      if (!m) { bad.push(s.path); console.log(`FAIL served ${s.path}: no render committed`); continue; }
      const committedText = read(s.render).replace(/\n$/, '');
      /* Every page, the site root's too: / was index.html, the app inline,
         with no moment before it ran; since plan item 1.2 it is served
         pages/home.app.html, which loads the app like every other page. */
      const measure = true;
      await firstVisit({ script: measure });
      const problems = [];
      try {
        await send('Page.navigate', { url: live + s.path }, sid);
        /* 0. Before the script: where everything stands. */
        let servedAt = null;
        if (measure) {
          if (!await until(SERVED_PAINTED)) problems.push('the served page was not painted before the script ran');
          else { await painted(); servedAt = await value(`(${positions})()`); }
          await releaseScript();
        }
        /* 1. Every request held. */
        if (!await quiet(`document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view`)) problems.push('the page never settled with its requests held');
        const want = await value(`(${P.textOfMarkup})(${P.servedText}, ${JSON.stringify(committedText)})`);
        const one = await value(`({ snaps: window.__served, waits: UNIVERSE_VIEWS.has(State.view), served: document.getElementById('views').hasAttribute('data-served'), text: (${textOf})(document.getElementById('views')) })`);
        const first = one.snaps[0];
        let drawnAt = null;
        if (one.waits) {
          if (one.snaps.length) problems.push(`a page that waits for the filings was drawn before they landed (${one.snaps.length} draw${one.snaps.length === 1 ? '' : 's'})`);
          if (!one.served || one.text !== want) problems.push('the served page did not stand while the filings were on their way');
        } else {
          const after = one.snaps.find(x => x.when === 'after');
          /* drawPage takes the data-served mark off as it draws, so the
             page the parser built is known by its text. */
          if (!first || first.when !== 'before') problems.push('the app did not draw over the served page');
          else if (first.text !== want) problems.push('the page the parser built is not the committed render');
          if (!after) problems.push('the app never drew the page');
          else if (one.text !== want) {
            let i = 0; while (i < want.length && want[i] === one.text[i]) i++;
            problems.push(`its first draw is not the served page, from character ${i}: served …${want.slice(Math.max(0, i - 30), i + 60)}… drawn …${one.text.slice(Math.max(0, i - 30), i + 60)}…`);
          }
          if (measure) drawnAt = await value(`(${positions})()`);
        }
        /* 2. Released. */
        holding = false;
        for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid);
        held = [];
        if (!await quiet(`typeof realPending !== 'undefined' && !realPending`)) problems.push('the filed statements never finished loading');
        const two = await value(`({ snaps: window.__served, cls: window.__cls, moved: window.__moved, text: (${textOf})(document.getElementById('views')) })`);
        if (one.waits) {
          const drew = two.snaps.filter(x => x.when === 'after');
          if (!drew.length) problems.push('the page was never drawn once the filings landed');
          if (two.snaps.some(x => x.waiting)) problems.push('the page was drawn while the filings were still on their way');
          if (two.text !== want) {
            let i = 0; while (i < want.length && want[i] === two.text[i]) i++;
            problems.push(`drawn with the filings in, it is not the committed render, from character ${i}: served …${want.slice(Math.max(0, i - 30), i + 60)}… drawn …${two.text.slice(Math.max(0, i - 30), i + 60)}…`);
          }
          if (measure) drawnAt = await value(`(${positions})()`);
        }
        if (two.snaps.some(x => x.skeleton)) problems.push('the loading skeleton was drawn');
        const h1s = [...new Set([first?.h1 ?? m.h1, ...two.snaps.map(x => x.h1)])];
        if (h1s.length !== 1 || h1s[0] !== m.h1) problems.push(`the h1 read ${h1s.map(h => JSON.stringify(h)).join(', then ')}, where the page's is ${JSON.stringify(m.h1)}`);
        maxCls = Math.max(maxCls, two.cls || 0);
        if (!(two.cls <= 0.1)) problems.push(`it shifted by ${Number(two.cls).toFixed(3)}: ${(two.moved || []).join('; ')}`);
        if (VERBOSE && two.cls > 0) (two.moved || []).forEach(x => console.log(`       moved ${x}`));
        const moved = servedAt && drawnAt ? movedBetween(servedAt, drawnAt) : [];
        if (moved.length) problems.push(`${moved.length} run${moved.length === 1 ? '' : 's'} of text moved when the page was drawn over the served one, by up to ${Math.max(...moved.map(x => Math.max(Math.abs(x.dx), Math.abs(x.dy))))}px: ${moved.slice(0, 4).map(x => `"${x.k}" ${x.dx ? `${x.dx > 0 ? '+' : ''}${x.dx}px across` : ''}${x.dx && x.dy ? ', ' : ''}${x.dy ? `${x.dy > 0 ? '+' : ''}${x.dy}px down` : ''}`).join('; ')}`);
        if (problems.length) { bad.push(s.path); console.log(`FAIL served ${s.path}`); problems.forEach(p => console.log(`     ${p}`)); }
        else console.log(`ok   served ${s.path.padEnd(28)} ${one.waits ? 'stood until the filings landed, then drawn once' : 'drawn over itself, the same page'}; h1 "${m.h1}"; ${measure ? `${Object.keys(servedAt || {}).length} runs of text where they stood; ` : ''}shift ${Number(two.cls).toFixed(3)}`);
      } catch (e) {
        bad.push(s.path); console.log(`FAIL served ${s.path}: ${e.message}`);
      }
    }

    /* THE SERVED PAGE STANDS ONLY AS THE READER'S PAGE (2026-10-04). After
       the script has run, a page that waits for the filings keeps the served
       page only where it is the page this reader asked for, says it is
       waiting, and — drawn over at last — gives focus back where it was:
       - standing, it says so (it stood silent with dead controls);
       - a link focused in it before the script ran keeps focus when the page
         is drawn (it fell to <body>).
       WHOSE PAGE IT IS (2026-10-04, second pass). The first rule — no query,
       no vl.* key in storage — drew the skeleton over the served page for
       nearly every reader: every browser holds the sample data its first
       visit is given, most shared links carry ?utm_source= or ?fbclid=, and
       a theme chosen is a key. The page now stands while what its draw reads
       is what the render's read (SERVED_READS, 35-ui.js), and this holds it
       from both sides, at the render's clock so that a page drawn can be
       compared with its render element for element (servedSignature):
       1. Every page that waits, in a browser holding the reader's own value
          — made by the app's own functions: their lists, holdings, cases and
          alerts, a plan, a hidden panel, saved screens, comparisons, work and
          setups, other currencies, the dark theme, the search's history… —
          for every key the page does not name: the served page stands once
          the script has run, no skeleton is drawn, and the page drawn when
          the filings land is its render. A key a page reads and does not name
          fails here.
       2. Every page that waits, on a second visit — after /about, the samples
          written as a first visit writes them, and after itself, what it
          keeps as it draws kept: it stands, and is its render.
       3. Under ?utm_source=, ?fbclid= or ?gclid=, and with only a theme kept:
          it stands, and is its render.
       4. Where it is not the reader's page it never stands, and the page drawn
          is not its render (so the check is not idle): ?companies=aapl,msft,
          ?tab=heatmap, the dashboard holding the reader's own list, Pricing on
          another plan, the screener with its Start here panel hidden. */
    {
      const said = [];
      const check = (ok, what, got) => { if (!ok) said.push(`${what} (${JSON.stringify(got)})`); };
      const STATE = `({ served: document.getElementById('views').hasAttribute('data-served'), pending: typeof realPending !== 'undefined' && realPending,
        wait: (document.querySelector('.served-wait[role="status"]')?.textContent || '').trim() || null, busy: document.getElementById('views').getAttribute('aria-busy') })`;
      /* At the render's clock, from here on. */
      await releaseAll();
      if (clockId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: clockId }, sid);
      clockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: P.clockScript(P.CLOCK) }, sid)).result?.identifier;
      const SETTLED = `typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view && !document.getElementById('views').hasAttribute('data-served')`;
      const release = async () => { holding = false; for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid); held = []; };
      const openFree = async (path) => { await release(); await send('Page.navigate', { url: live + path }, sid); await quiet(SETTLED); };
      const DUMP = `Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('vl.')).sort().map(k => [k.slice(3), localStorage.getItem(k)]))`;
      /* The reader's own, by the app's own hand: every value the steps change
         from what a first visit to /app/equities leaves. */
      await firstVisit();
      await openFree('/app/equities');
      const fresh = await value(DUMP) || {};
      for (const step of [
        `(() => { const r = wlCreate('My banks'); if (r.ok) { wlAdd(r.watchlist.id, 'MAYBANK'); wlAdd(r.watchlist.id, 'AAPL'); } return r.ok; })()`,
        `(() => { State.priceAlerts = [...State.priceAlerts, { id: 'pa-frames-1', ticker: 'MSFT', op: '>', price: 500, note: 'Above my case', updatedAt: new Date().toISOString() }]; return store.write('priceAlerts', State.priceAlerts); })()`,
        `(() => { State.portfolios = [...State.portfolios, { id: 'pf-frames-1', name: 'My income', cash: 500, cashCcy: 'MYR', holdings: [{ id: 'MAYBANK', qty: 1000, cost: 9.5, fx0: 1, fee: 10, rebate: 0 }] }]; return savePortfolios(); })()`,
        `(() => { State.theses = [...State.theses, { id: 't-frames-1', ticker: 'AAPL', oneLine: 'Services keep growing faster than hardware.', quality: '', valCase: '', catalysts: ['Services margin'], risks: ['Regulation'], conds: [{ type: 'metric', k: 'roe', op: '<', v: 20, label: 'ROE below 20%' }], horizon: '3–5 years', review: '2026-12-01', conf: 'Medium', questions: [], created: '2026-09-20' }]; saveTheses(); return true; })()`,
        `store.write('dividendsReceived', [{ id: 'MAYBANK', pfId: 'pf-1', date: '2026-09-10', amount: 120, ccy: 'MYR' }])`,
        `store.write('compare', ['AAPL', 'MSFT'])`,
        `store.write('recentCompanies', ['MSFT', 'AAPL'])`,
        `store.write('startHere', { equities: '2026-09-20T01:00:00.000Z', scanner: '2026-09-20T01:00:00.000Z', property: '2026-09-20T01:00:00.000Z' })`,
        `store.write('dash', [{ k: 'context', col: 'top', visible: false }, { k: 'feed', col: 'main', visible: true }, { k: 'watchlist', col: 'main', visible: true }, { k: 'discounts', col: 'rail', visible: false }, { k: 'loop', col: 'rail', visible: true }])`,
        `store.write('dashVisit', { prev: '2026-09-20T01:00:00.000Z', seen: '2026-09-25T01:00:00.000Z' })`,
        `store.write('density', 'compact')`, `store.write('screen', { universe: 'US' })`, `store.write('screenCcy', 'USD')`,
        `store.write('baseCcy', 'USD')`, `store.write('compareCcy', 'local')`, `store.write('wht', { US: 15, MY: 0 })`,
        `store.write('requiredDiscount', 25)`, `store.write('reportLog', { month: meterMonth(), ids: ['AAPL'] })`,
        `store.write('onboarding', { level: 'experienced', market: 'US', ccy: 'USD', done: true, at: '2026-09-20T01:00:00.000Z' })`,
        `store.write('plan', 'pro')`, `store.write('alertKinds', ['earnings'])`, `store.write('explainDepth', 'technical')`,
        `store.write('realData', false)`, `store.write('manualPrices', { MAYBANK: 10.5 })`,
        `store.write('scanPrefs', { inApp: false, muted: {}, pageSize: 25, statusFilter: 'ALL', precision: 'rounded' })`,
        `store.write('scanAlertState', { 'own-setup|AAPL|2026-09-01': 'READ' })`,
        `(() => { const d = SCAN_EXAMPLES.setups.find(x => x.ruleTree) || SCAN_EXAMPLES.setups[0]; return !!scanSaveSetup({ ...JSON.parse(JSON.stringify(d)), id: 'frames-breakout', name: 'My breakout', enabled: true })?.ok; })()`,
        `store.write('recent', { items: [{ k: 'page', id: '/about', t: new Date().toISOString() }], co: {} })`,
        `store.write('valuation', { AAPL: { growth: 6 } })`, `store.write('wlActive', 'wl-2')`, `store.write('lang', 'ms')`,
        `store.write('launcherAnswers', { market: 'US' })`, `store.write('registerActor', 'Reader')`,
        `store.write('opportunities', [{ id: 'opp-frames-1', name: 'Shophouse, Kuching', status: 'watching', created: '2026-09-20' }])`,
        `store.write('deal', { ...State.deal, userStarted: true, price: 640000 })`, `store.write('theme', 'dark')`,
      ]) await value(step);
      await openFree('/discover/screener');
      await value(`(() => { window.prompt = () => 'My dividend screen'; saveScreen(); return true; })()`);
      await openFree('/compare');
      await value(`!!saveComparison('Apple and Microsoft')`);
      await value(`(() => { State.wheel = { ...State.wheel, symbol: 'KO', isWorkedExample: false }; return !!saveWork('wheel', 'My KO wheel'); })()`);
      await openFree('/discover/sarawak');
      await value(`(() => { const add = [...document.querySelectorAll('#views button')].find(b => b.textContent.trim() === 'Add'); if (add) add.click(); return true; })()`);
      await sleep(300);
      const after = await value(DUMP) || {};
      const own = Object.fromEntries(Object.entries(after).filter(([k, v]) => fresh[k] !== v));
      /* What each page names (none, before 2026-10-04's second pass). */
      const reads = await value(`typeof SERVED_READS === 'undefined' ? null : { all: SERVED_READS_ALL, views: SERVED_READS }`);
      if (Object.keys(own).length < 30) said.push(`the reader's own values were not all made: ${Object.keys(own).join(' ')}`);
      /* One page: requests held until the script has run, then released. Did
         the served page stand, was the skeleton ever drawn, and is the page
         drawn its render? */
      const committedOf = (s) => ({ views: read(s.render).replace(/\n$/, ''), tabs: manifest.pages[s.file]?.tabs ? read(s.tabs).replace(/\n$/, '') : null });
      const site = siteOrigin(read('src/index.template.html'));
      const DRAWN = `(() => { const copy = ${P.servedCopy}; const v = copy(document.getElementById('views')); const sec = v.querySelector(':scope > section.view');
        if (sec) { sec.setAttribute('data-active', '1'); sec.setAttribute('data-redrawn', '1'); }
        const host = document.getElementById('productTabs'); const t = host && !host.hidden && host.children.length ? copy(host) : null;
        const local = (h) => h.split(location.origin).join(${JSON.stringify(site)}); return { views: local(v.innerHTML), tabs: t ? local(t.innerHTML) : null }; })()`;
      const visit = async (s, { query = '', path = s.path, after = null } = {}) => {
        holding = true;
        if (after) await send('Network.setCacheDisabled', { cacheDisabled: true }, sid);
        await send('Page.navigate', { url: live + path + query }, sid);
        await quiet(`document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view`);
        const st = await value(`({ ...${STATE}, skeleton: (window.__served || []).some(x => x.skeleton) })`);
        await release();
        if (after) await send('Network.setCacheDisabled', { cacheDisabled: false }, sid);
        if (!await quiet(SETTLED)) return { stood: false, st, differs: 'the page never settled' };
        const drawn = await value(DRAWN);
        const skeleton = await value(`(window.__served || []).some(x => x.skeleton)`);
        const c = committedOf(s);
        const dv = await value(`(${P.compareMarkup})(${P.servedSignature}, ${JSON.stringify(c.views)}, ${JSON.stringify(drawn.views)})`);
        const dt = !!c.tabs !== !!drawn.tabs ? { at: 0, drawn: drawn.tabs ? 'a tab row' : 'no tab row' }
          : c.tabs ? await value(`(${P.compareMarkup})(${P.servedSignature}, ${JSON.stringify(c.tabs)}, ${JSON.stringify(drawn.tabs)})`) : null;
        const differs = dv ? `#views from token ${dv.at}: …${dv.drawn.slice(0, 200)}…` : dt ? `the tab row: …${String(dt.drawn).slice(0, 160)}…` : null;
        return { stood: st.pending && st.served && !st.skeleton && !skeleton, st: { ...st, skeleton }, differs };
      };
      const waitingPages = pages.filter(s => manifest.pages[s.file]?.state === 'filings in');
      const tally = { undeclared: 0, second: 0, tracking: 0, not: 0 };
      /* 1. */
      for (const s of waitingPages) {
        const view = manifest.pages[s.file].view;
        const names = new Set([...(reads?.all || []), ...(reads?.views?.[view] || [])]);
        const raw = Object.fromEntries(Object.entries(own).filter(([k]) => !names.has(k)));
        await firstVisit({ raw });
        const r = await visit(s);
        check(r.stood, `${s.path}: holding the reader's own ${Object.keys(raw).length} keys the page does not name, the served page did not stand once the script had run`, r.st);
        check(!r.differs, `${s.path}: holding the reader's own value for every key the page does not name (${Object.keys(raw).join(' ')}), the page drawn is not its render — it reads a key it does not name: ${r.differs}`, null);
        if (r.stood && !r.differs) tally.undeclared++;
      }
      /* 2. After another page, and after the page itself (a reload: what a
            page keeps as it draws — the dashboard its visit — must not stop
            its own served page standing). */
      for (const s of waitingPages) {
        let ok = true;
        for (const before of ['/about', s.path]) {
          await firstVisit();
          await openFree(before);
          const r = await visit(s, { after: before });
          check(r.stood, `${s.path} on a second visit (after ${before}): the served page did not stand once the script had run`, r.st);
          check(!r.differs, `${s.path} on a second visit (after ${before}): the page drawn is not its render: ${r.differs}`, null);
          ok = ok && r.stood && !r.differs;
        }
        if (ok) tally.second++;
      }
      /* 3. */
      const byPath = (p) => pages.find(s => s.path === p);
      for (const [p, query, raw] of [['/pricing', '?utm_source=newsletter&utm_medium=email', null], ['/discover/screener', '?fbclid=IwAR0abc', null],
        ['/app', '?gclid=abc123&ref=frames', null], ['/pricing', '', { theme: '"dark"' }], ['/discover/screener', '', { theme: '"dark"' }]]) {
        await firstVisit({ raw });
        const r = await visit(byPath(p), { query });
        const said1 = `${p}${query}${raw ? ' with only the dark theme kept' : ''}`;
        check(r.stood, `${said1}: the served page did not stand once the script had run`, r.st);
        check(!r.differs, `${said1}: the page drawn is not its render: ${r.differs}`, null);
        if (r.stood && !r.differs) tally.tracking++;
      }
      /* 4. */
      for (const [p, query, keys, what] of [['/compare', '?companies=aapl,msft', [], 'comparing Apple and Microsoft by its address'],
        ['/discover', '?tab=heatmap', [], 'the heatmap tab by its address'],
        ['/app', '', ['watchlists', 'onboarding'], 'the dashboard, holding the reader\'s own list'],
        ['/pricing', '', ['plan'], 'Pricing, on another plan'],
        ['/discover/screener', '', ['startHere'], 'the screener, its Start here panel hidden']]) {
        await firstVisit({ raw: Object.fromEntries(keys.map(k => [k, own[k]]).filter(([, v]) => v != null)) });
        const r = await visit(byPath(p), { query });
        check(!r.stood && r.st.pending && !r.st.served, `${p}${query} — ${what}: the served render stood once the script had run`, r.st);
        check(!!r.differs, `${p}${query} — ${what}: the page drawn is its render, so this case shows nothing`, null);
        if (!r.stood && r.differs) tally.not++;
      }
      console.log(`${said.length ? 'FAIL' : 'ok  '} whose page the served page is: ${tally.undeclared} of ${waitingPages.length} waiting pages stood holding the reader's own value for every key they do not name (${Object.keys(own).length} kept), and were drawn as their render; ${tally.second} of ${waitingPages.length} on a second visit, after /about and after themselves; ${tally.tracking} of 5 under ?utm_source=, ?fbclid=, ?gclid= or with only a theme kept; ${tally.not} of 5 never stood where they were not the reader's page`);
      await firstVisit();
      await send('Page.navigate', { url: `${live}/pricing` }, sid);
      await quiet(`document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view`);
      { const st = await value(STATE); check(st.pending && st.served && /filed statements/i.test(st.wait || '') && st.busy === 'true', '/pricing standing for the filings after its script ran: no status saying it waits, or #views not busy', st); }
      holding = false; for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid); held = [];
      await quiet(`typeof realPending !== 'undefined' && !realPending && !document.getElementById('views').hasAttribute('data-served')`);
      { const st = await value(STATE); check(!st.wait && st.busy === null, '/pricing drawn: the waiting status or the busy mark stayed', st); }
      for (const [path, waits] of [['/about', false], ['/pricing', true]]) {
        await firstVisit({ script: true });
        await send('Page.navigate', { url: live + path }, sid);
        if (!await until(SERVED_PAINTED)) { said.push(`${path}: the served page was not painted before the script ran`); continue; }
        const focused = await value(`(() => { const a = document.querySelector('#views a[href]'); if (!a) return null; a.focus(); return document.activeElement === a ? { href: a.getAttribute('href'), text: a.textContent.trim().slice(0, 60) } : null; })()`);
        if (!focused) { said.push(`${path}: no link in the served page took focus`); continue; }
        await releaseScript();
        if (waits) {
          await quiet(`typeof State !== 'undefined' && !!State.view`);
          holding = false; for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid); held = [];
        }
        await quiet(`typeof State !== 'undefined' && !document.getElementById('views').hasAttribute('data-served')${waits ? ' && !realPending' : ''}`);
        const now = await value(`(() => { const a = document.activeElement; return a && a !== document.body ? { tag: a.localName, inViews: !!a.closest('#views'), href: a.getAttribute('href'), text: (a.textContent || '').trim().slice(0, 60) } : { tag: 'body' }; })()`);
        check(now.tag === 'a' && now.inViews && now.href === focused.href && now.text === focused.text, `${path}: "${focused.text}" (${focused.href}) had focus in the served page; once the page was drawn focus was on`, now);
      }
      await releaseAll();
      if (said.length) { bad.push('the served page standing'); console.log('FAIL served pages standing for the filings'); said.forEach(x => console.log(`     ${x}`)); }
      else console.log('ok   served pages: the served render stands once the script has run only while what the page reads is what it was drawn from, and is then the page drawn; standing for the filings it says so and marks #views busy, both gone once drawn; a link focused in it keeps focus through the draw (/about at once, /pricing when the filings land)');
    }
    /* A READER WITH NO SCRIPT (2026-10-04). The served page and its
       navigation are all such a reader has, and they met controls that did
       nothing — empty fields, dropdowns with carets, buttons that lifted
       under the pointer, Products and Resources opening no panel, the
       phone's menu — a disclosure opening on nothing, and on a page with no
       render (a company's, the 404, My Workspace's) no footer, so 2 of the
       37 links served could be reached. With the script switched off, at
       1280 and on a 390px phone: no control the script makes work is shown
       as one — no button anywhere on the page, no inert control in a box or
       under a pointer, no empty field — and the products, Pricing and every
       resource are links on screen, How it works too wherever the public
       header is. */
    {
      const said = [];
      const { result: { targetId: nid } } = await send('Target.createTarget', { url: 'about:blank' });
      const nsid = (await send('Target.attachToTarget', { targetId: nid, flatten: true })).result.sessionId;
      const nv = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }, nsid)).result?.result?.value;
      await send('Page.enable', {}, nsid); await send('Runtime.enable', {}, nsid);
      await send('Emulation.setScriptExecutionDisabled', { value: true }, nsid);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, nsid);
      const probe = `(() => {
        const shown = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
        const buttons = [...document.querySelectorAll('button')].filter(shown).map(b => (b.getAttribute('aria-label') || b.textContent).trim().replace(/\\s+/g, ' ').slice(0, 40));
        /* What the script would make a control of: marked so by prerender.mjs,
           or wearing a control's class — not a link, not a disclosure's
           summary, which work without it. */
        const controls = [...document.querySelectorAll('#views [data-inert], #productTabs [data-inert], #views :is(.btn, .select, .input):not(a, summary)')].filter(shown).flatMap(n => {
          const c = getComputedStyle(n), bg = c.backgroundColor, img = c.backgroundImage;
          const boxed = (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || img !== 'none' || c.boxShadow !== 'none'
            || ['Top', 'Right', 'Bottom', 'Left'].some(s => parseFloat(c['border' + s + 'Width']) > 0 && c['border' + s + 'Color'] !== 'rgba(0, 0, 0, 0)');
          const empty = (/^(field|range)$/.test(n.dataset.inert) || n.matches('.select, .input')) && !n.textContent.trim();
          return boxed || c.cursor === 'pointer' || empty || n.dataset.inert === 'details' ? [(n.dataset.inert || n.className) + ' "' + n.textContent.trim().slice(0, 30) + '"' + (boxed ? ' boxed' : '') + (c.cursor === 'pointer' ? ' pointer' : '') + (empty ? ' empty' : '')] : [];
        });
        /* A disclosure the script fills when it opens: shown, it opens on nothing. */
        const emptyDetails = [...document.querySelectorAll('#views details')].filter(d => shown(d) && ![...d.childNodes].some(k => !(k.nodeType === 1 && k.localName === 'summary') && ((k.textContent || '').trim() || (k.nodeType === 1 && k.querySelector('img, svg, table')))))
          .map(d => (d.querySelector('summary')?.textContent || '').trim().slice(0, 40));
        const hrefs = new Set([...document.querySelectorAll('a[href]')].filter(shown).map(a => a.getAttribute('href')));
        const footer = document.querySelector('body > .footer');
        return { buttons, controls, emptyDetails, hrefs: [...hrefs], footer: !!footer && shown(footer), pubbar: !!document.querySelector('.pubbar') && shown(document.querySelector('.pubbar')), scripted: typeof State !== 'undefined' };
      })()`;
      const NEED = ['/research', '/app/scanner', '/property', '/pricing', '/methodology', '/data-sources', '/learn/glossary', '/status', '/about', '/contact'];
      for (const [w, h, mobile] of [[1280, 900, false], [390, 844, true]]) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, nsid);
        await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 }, nsid);
        for (const path of ['/about', '/research', '/discover/screener', '/app', '/app/scanner/setups', '/status', '/company/aapl-apple-inc', '/nope-for-coverage-frames', '/my/portfolio']) {
          await send('Page.navigate', { url: live + path }, nsid);
          for (let i = 0; i < 60 && await nv('document.readyState') !== 'complete'; i++) await sleep(100);
          await sleep(200);
          const r = await nv(probe);
          if (!r || r.scripted) { said.push(`${w} ${path}: the script ran`); continue; }
          const p = [];
          if (r.buttons.length) p.push(`${r.buttons.length} button${r.buttons.length === 1 ? '' : 's'} shown that need the script: ${r.buttons.slice(0, 5).join(' · ')}`);
          if (r.controls.length) p.push(`${r.controls.length} inert control${r.controls.length === 1 ? '' : 's'} drawn as one: ${r.controls.slice(0, 4).join(' · ')}`);
          if (r.emptyDetails.length) p.push(`a disclosure that opens on nothing: ${r.emptyDetails.join(' · ')}`);
          if (!r.footer) p.push('no footer shown');
          const missing = NEED.filter(x => !r.hrefs.includes(x));
          if (r.pubbar && !r.hrefs.includes('/how-it-works')) missing.push('/how-it-works');
          if (missing.length) p.push(`no link on screen to ${missing.join(', ')}`);
          p.forEach(x => said.push(`${w} ${path}: ${x}`));
        }
      }
      await send('Target.closeTarget', { targetId: nid });
      if (said.length) { bad.push('a reader with no script'); console.log('FAIL served pages to a reader with no script'); said.slice(0, 30).forEach(x => console.log(`     ${x}`)); if (said.length > 30) console.log(`     … and ${said.length - 30} more`); }
      else console.log('ok   served pages to a reader with no script (1280 and a 390px phone; public, app, company, 404 and My Workspace pages): no button shown, no inert control boxed, under a pointer or empty, no disclosure opening on nothing, the footer on every page, and the products, Pricing and every resource linked on screen — How it works too under the public header');
    }
    /* THE SERVED PAGE FITS ITS WINDOW (2026-10-04). Drawn pages are held to
       no sideways scroll at every width (mobile.mjs); a served page was held
       to nothing, and /discover/sarawak's served pickers, sized by their
       choices' unseen lines, took 379px and 261px of a row of 1fr columns at
       1024px — the page scrolled sideways by 7px, 91px in Verdana, until the
       script drew it. Every rendered page (prerender/manifest.json), with the
       script switched off, at 390 and 1024 in the page's font, and in Verdana
       (as wide as CI's Linux fallback) where a served field stands in for a
       control: its width, no more. */
    {
      const said = [];
      let n = 0;
      const { result: { targetId: fid } } = await send('Target.createTarget', { url: 'about:blank' });
      const fsid = (await send('Target.attachToTarget', { targetId: fid, flatten: true })).result.sessionId;
      const fv = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, fsid)).result?.result?.value;
      await send('Page.enable', {}, fsid); await send('Runtime.enable', {}, fsid);
      await send('Emulation.setScriptExecutionDisabled', { value: true }, fsid);
      const paths = Object.values(manifest.pages).map(p => p.path);
      /* Verdana only where a served field stands in for a control: its width
         is the one thing a font moves (the choices' unseen lines). */
      const fielded = new Set();
      for (const font of [null, 'Verdana']) {
        for (const [w, h, mobile] of [[390, 844, true], [1024, 900, false]]) {
          await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }, fsid);
          for (const path of font ? [...fielded] : paths) {
            await send('Page.navigate', { url: live + path }, fsid);
            for (let i = 0; i < 60 && await fv('document.readyState') !== 'complete'; i++) await sleep(100);
            /* With the script switched off the page runs no timer, so nothing
               waits inside it — a promise on setTimeout never settled, and the
               first version of this hung the harness: the font goes in, Node
               waits, then one read. */
            if (font) await fv(`(() => { const s = document.createElement('style'); s.textContent = ':root{--sans: ${font}, sans-serif !important}'; document.head.append(s); return true; })()`);
            await sleep(120);
            const over = await fv(`(() => ({ over: document.documentElement.scrollWidth - document.documentElement.clientWidth, fields: !!document.querySelector('#views [data-inert="field"]') }))()`);
            n++;
            if (!font && over?.fields) fielded.add(path);
            if (over?.over > 1) said.push(`${path} at ${w}${font ? ` in ${font}` : ''}: served, it scrolls sideways by ${over.over}px`);
          }
        }
      }
      await send('Target.closeTarget', { targetId: fid });
      if (said.length) { bad.push('a served page wider than its window'); console.log('FAIL served pages wider than their window'); said.slice(0, 30).forEach(x => console.log(`     ${x}`)); }
      else console.log(`ok   served pages fit their window: all ${paths.length} rendered pages with the script off at 390 and 1024, and the ${fielded.size} with served fields in Verdana too — ${n} loads, none scrolling sideways`);
    }
    /* ---- integration-final ---- */
    /* THE INTEGRATION'S FINAL VERIFICATION (2026-10-04), held from the first
       frame, each part failing on fe8d65f:
       1. A SERVED PAGE THAT IS NOT THIS READER'S IS NEVER SHOWN TO THEM.
          The script in every page's head (FIRST_SCRIPT, build.mjs) runs
          before the first paint. With the app's script held — a returning
          reader's cached copy is stale after every deploy — each frame is
          recorded as it is painted:
          - a returning reader whose browser holds their own saved property
            and watchlist, kept by the app before this release (no digest
            of them kept: servedReads) and after it: /property/models,
            /property/calculator and /app are out of sight before the script
            (no frame shows them, nothing in them takes focus, the heading is
            out of the accessibility tree) and then drawn as the reader's —
            the dashboard by way of the skeleton, as before pages were served;
            a page that reads none of it (/about, the screener) is shown;
          - a returning reader whose browser holds only what a first visit
            gives it is shown /app and /research/queue as served;
          - a reader in New York is not shown /compare, the screener or
            /research/queue (their totals are in dollars) and is shown
            /about and /pricing; one in New York whose language is en-MY,
            and one in Kuala Lumpur, are shown /compare;
          - a reader who chose the dark theme gets it from the first frame
            (/about, /app): no frame is painted in the light one;
          - a fresh visitor in Kuala Lumpur is shown every rendered page.
       2. A READER WHO SCROLLED STAYS WHERE THEY WERE. A fresh visitor wheels
          into the served page before the script runs; the words at the top
          of their window do not move when the app draws or when its data
          lands (/status, the calculator, the screener on a phone, /app,
          /pricing), and the layout shift is at most 0.05.
       3. The dashboard's heading is on screen through the wait for the
          filings; to a reader with no script no action is offered that does
          nothing ("Hide ×", "Reset", "Save this property", "New property");
          the Sarawak screen's "none yet" keeps its words whole at 1280.
       4. THE SERVED PAGE SHOWS WHAT THE DRAWN ONE DOES AT EVERY WIDTH. A
          render leaves out what is hidden at 1280 (servedCopy), and a rule
          that counts children (:last-child) then matched another: My
          properties' served head lost "Updated" between 901 and 1322px. At
          1024 and 1440, on every page whose render left something out, no
          run of text is on the drawn page that the served page did not
          show, nor the other way. */
    {
      const said = { first: [], scroll: [], minor: [], widths: [] };
      const say = (k, ok, what, got) => { if (!ok) said[k].push(`${what}${got === undefined ? '' : ` — ${JSON.stringify(got).slice(0, 300)}`}`); };
      const W1280 = { ...P.VIEWPORT, deviceScaleFactor: 1, mobile: false }, W390 = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
      const size = async (m) => { await send('Emulation.setDeviceMetricsOverride', m, sid); await send('Emulation.setTouchEmulationEnabled', { enabled: !!m.mobile, maxTouchPoints: m.mobile ? 5 : 1 }, sid); };
      const releaseData = async () => { holding = false; for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid); held = []; };
      const SETTLED = `typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view && !document.getElementById('views').hasAttribute('data-served')`;
      const openFree = async (path) => { await releaseAll(); await send('Page.navigate', { url: live + path }, sid); await quiet(SETTLED); };
      const DUMP = `Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('vl.')).sort().map(k => [k.slice(3), localStorage.getItem(k)]))`;
      /* Each frame as it is about to be painted: served or drawn, kept out of
         sight or shown, the skeleton, and the page's background. */
      const FRAMES = `(() => { const f = window.__fp = []; let last = '';
        const tick = () => { const v = document.getElementById('views'), d = document.documentElement;
          if (v && document.body) { const first = v.firstElementChild;
            const k = [v.hasAttribute('data-served') ? 'served' : 'drawn', d.hasAttribute('data-served-hidden') ? 'hidden' : '',
              v.hasAttribute('data-served') && first && getComputedStyle(first).display !== 'none' ? 'shown' : '',
              v.textContent.includes(${JSON.stringify(P.SKELETON)}) ? 'skeleton' : '', getComputedStyle(document.body).backgroundColor].join('|');
            if (k !== last) { f.push(k); last = k; } }
          requestAnimationFrame(tick); };
        requestAnimationFrame(tick); })();`;
      const framesId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: FRAMES }, sid)).result?.identifier;
      await send('Accessibility.enable', {}, sid).catch(() => {});
      const NOW = `(() => { const d = document.documentElement, v = document.getElementById('views'), first = v.firstElementChild;
        const stops = [...v.querySelectorAll('a[href], [tabindex], summary, button, input, select, textarea')].filter(n => n.getClientRects().length).length;
        return { hidden: d.hasAttribute('data-served-hidden'), shown: !!first && getComputedStyle(first).display !== 'none' && !!v.innerText.trim(), stops,
          theme: d.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor,
          /* The heading's words on screen: not a screen reader's only, not held out of sight. */
          h1: (() => { const h = v.querySelector('h1'); if (!h) return ''; let t = ''; const w = document.createTreeWalker(h, NodeFilter.SHOW_TEXT);
            for (let n = w.nextNode(); n; n = w.nextNode()) { const e = n.parentElement; if (e.closest('.sr-only') || getComputedStyle(e).visibility !== 'visible' || !e.getClientRects().length) continue; t += n.data; }
            return t.replace(/\\s+/g, ' ').trim(); })(),
          script: typeof State !== 'undefined', served: v.hasAttribute('data-served'), skeleton: v.textContent.includes(${JSON.stringify(P.SKELETON)}) }; })()`;
      /* Whether the served page's heading is in the accessibility tree. */
      const headingIgnored = async () => {
        const doc = await send('DOM.getDocument', { depth: 0 }, sid);
        const q = await send('DOM.querySelector', { nodeId: doc.result?.root?.nodeId, selector: '#views h1' }, sid);
        if (!q.result?.nodeId) return null;
        const ax = await send('Accessibility.getPartialAXTree', { nodeId: q.result.nodeId, fetchRelatives: false }, sid);
        const n = ax.result?.nodes?.[0];
        return n ? !!n.ignored : null;
      };
      /* A page with the app's script held: what the first frames show, then
         the script let through and what it draws, then the data. */
      const heldVisit = async (path, { raw = null, metrics = W1280, data = true } = {}) => {
        await size(metrics);
        await firstVisit({ raw, script: true });
        await send('Page.navigate', { url: live + path }, sid);
        if (!await until(SERVED_PAINTED)) return { path, painted: false };
        await painted();
        const before = await value(NOW);
        const ignored = before.hidden ? await headingIgnored() : null;
        await releaseScript();
        await until(`typeof State !== 'undefined' && !!State.view && document.readyState === 'complete'`);
        await painted();
        const script = await value(NOW);
        if (data) { await releaseData(); await quiet(SETTLED); }
        const after = await value(`({ ...${NOW}, frames: window.__fp || [], text: (${textOf})(document.getElementById('views')) })`);
        return { path, painted: true, before, ignored, script, after, frames: after.frames };
      };
      try {
        /* The returning reader's own: a saved property and a watchlist, by the
           app's own hand, then left so the app keeps its digest of them. */
        await size(W1280);
        await firstVisit();
        await openFree('/property/calculator');
        await value(`(() => { newPropertyDeal({ show: false }); State.deal.price = 777000; markTouched(State.deal, 'price'); saveDeal(); saveActiveProperty({ name: 'Frames own property' });
          const r = wlCreate('Frames own list'); if (r.ok) wlAdd(r.watchlist.id, 'MAYBANK'); return true; })()`);
        await openFree('/about');
        await send('Page.navigate', { url: `${live}/robots.txt` }, sid); await sleep(400);
        const kept = await value(DUMP) || {};
        const old = Object.fromEntries(Object.entries(kept).filter(([k]) => k !== 'servedReads'));
        if (!kept.savedWork || !/Frames own property/.test(kept.savedWork)) say('first', false, 'the returning reader\'s saved property was not made', Object.keys(kept));
        /* And a reader who holds only what a first visit gives. */
        await firstVisit();
        await openFree('/about');
        await send('Page.navigate', { url: `${live}/robots.txt` }, sid); await sleep(400);
        const firstOnly = await value(DUMP) || {};
        const never = (r) => r.frames.some(k => /^served\|[^|]*\|shown/.test(k));
        for (const [label, raw] of [['before this release (no digest kept)', old], ['since this release', kept]]) {
          for (const metrics of [W1280, W390]) {
            for (const path of ['/property/models', '/property/calculator', '/app']) {
              const r = await heldVisit(path, { raw, metrics });
              const at = `${path} at ${metrics.width}, a returning reader ${label}`;
              if (!r.painted) { say('first', false, `${at}: the served page was not painted before the script`); continue; }
              say('first', r.before.hidden && !r.before.shown && r.before.stops === 0, `${at}: the fresh visitor's page was on screen before the script (or took focus)`, r.before);
              say('first', r.ignored !== false, `${at}: the served page's heading was in the accessibility tree while out of sight`);
              say('first', !never(r), `${at}: a frame showed the served page`, r.frames);
              say('first', !r.after.served && r.after.text !== read(pages.find(s => s.path === path).render).replace(/\n$/, '') && (path === '/app' ? !/0 of 4 done/.test(r.after.text) : /Frames own property/.test(r.after.text)),
                `${at}: the page drawn is not the reader's own`, r.after.text.slice(0, 160));
            }
          }
          /* A page that reads none of it is shown. */
          for (const path of ['/about', '/discover/screener']) {
            const r = await heldVisit(path, { raw, data: false });
            say('first', r.painted && !r.before.hidden && r.before.shown, `${path}, a returning reader ${label}: a page that reads none of what they keep was kept out of sight`, r.before);
          }
        }
        for (const path of ['/app', '/research/queue']) {
          const r = await heldVisit(path, { raw: firstOnly, data: false });
          say('first', r.painted && !r.before.hidden && r.before.shown && r.script.served && r.script.shown, `${path}, a reader holding only what a first visit gives: not shown as served, or not standing once the script ran`, { before: r.before, script: r.script });
        }
        /* Time zones and languages. */
        const ua = (await send('Browser.getVersion', {})).result?.userAgent || '';
        const zone = async (tz, lang) => {
          await send('Emulation.setTimezoneOverride', { timezoneId: tz }, sid);
          await send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: lang }, sid);
          await send('Emulation.setLocaleOverride', { locale: '' }, sid).catch(() => {});
          await send('Emulation.setLocaleOverride', { locale: lang }, sid).catch(() => {});
        };
        try {
          for (const [tz, lang, path, hide] of [['America/New_York', 'en-US', '/compare', true], ['America/New_York', 'en-US', '/discover/screener', true], ['America/New_York', 'en-US', '/research/queue', true],
            ['America/New_York', 'en-US', '/about', false], ['America/New_York', 'en-US', '/pricing', false], ['Europe/London', 'en-GB', '/compare', true],
            ['America/New_York', 'en-MY', '/compare', false], [P.ZONE, P.LOCALE, '/compare', false]]) {
            await zone(tz, lang);
            const r = await heldVisit(path, { data: false });
            const lng = await value('navigator.language');
            say('first', r.painted && r.before.hidden === hide && r.before.shown === !hide, `${path} to a fresh visitor in ${tz} (${lang}, navigator.language ${lng}): ${hide ? 'shown, in another currency than theirs' : 'kept out of sight'}`, r.before);
            if (hide) say('first', !(r.script.served && r.script.shown) && !never(r), `${path} to a fresh visitor in ${tz}: the served page was shown, or stood once the script had run`, { script: r.script, frames: r.frames });
          }
        } finally { await zone(P.ZONE, P.LOCALE); }
        /* The theme kept, from the first frame. */
        for (const path of ['/about', '/app']) {
          const r = await heldVisit(path, { raw: { theme: '"dark"' } });
          const bgs = [...new Set(r.frames.map(k => k.split('|')[4]))];
          say('first', r.painted && r.before.theme === 'dark' && r.before.bg === r.after.bg && bgs.length === 1, `${path}, the dark theme kept: a frame was painted in another background (${bgs.join(' then ')})`, r.before);
        }
        /* A fresh visitor in Kuala Lumpur: every rendered page, shown — to a
           browser that holds nothing of this site, which is said, so that a
           page kept out of sight is never blamed for what another page left
           behind (firstVisit). */
        const hiddenFresh = [];
        for (const s of pages) {
          await firstVisit({ script: true });
          await send('Page.navigate', { url: live + s.path }, sid);
          if (!await until(SERVED_PAINTED)) { hiddenFresh.push(`${s.path} (not painted)`); continue; }
          const n = await value(NOW);
          const kept = await value(`Object.keys(localStorage).filter(k => k.startsWith('vl.')).sort()`) || [];
          if (kept.length) hiddenFresh.push(`${s.path} (not a fresh visitor: the browser held ${kept.join(', ')})`);
          else if (n.hidden || !n.shown) hiddenFresh.push(s.path);
        }
        say('first', !hiddenFresh.length, `a fresh visitor in Kuala Lumpur was not shown ${hiddenFresh.join(', ')}`);

        /* 2. The scrolled reader. */
        const ANCHOR = `(() => { const v = document.getElementById('views'), w = document.createTreeWalker(v, NodeFilter.SHOW_TEXT); const seen = new Map(); let best = null;
          for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.data.replace(/\\s+/g, ' ').trim(); if (t.length < 6 || n.parentElement.closest('svg, [data-now]')) continue;
            const k = seen.get(t) || 0; seen.set(t, k + 1); const r = document.createRange(); r.selectNodeContents(n); const b = r.getBoundingClientRect();
            if (b.height && b.top >= 100 && b.top < innerHeight - 60 && (!best || b.top < best.y)) best = { t, k, y: b.top }; }
          return best; })()`;
        const FIND = (a) => `(() => { const w = document.createTreeWalker(document.getElementById('views'), NodeFilter.SHOW_TEXT); let k = 0;
          for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.data.replace(/\\s+/g, ' ').trim() !== ${JSON.stringify(a.t)} || k++ !== ${a.k}) continue;
            const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().top; } return null; })()`;
        /* IN ANOTHER MACHINE'S FONT TOO (6 Oct 2026). /status at 390 passed
           here in Segoe UI and failed on CI's runner, in DejaVu Sans: a
           page as long as /status puts half way down on another row in
           another font, and there the rows whose path was offered as a link
           until the data landed (absent, toolSource in 35-ui.js) moved the
           words under the top of the window 12px. Verdana, which Windows
           has and whose widths are DejaVu's kin, put the reader on such a
           row too, and fails the same way on b907f00; so /status is held in
           it as well (fontScript, prerender.mjs, from the first frame). */
        for (const [path, metrics, at, face = null] of [['/status', W1280, 0.5], ['/status', W390, 0.5], ['/status', W1280, 0.5, 'Verdana'], ['/status', W390, 0.5, 'Verdana'],
          ['/property/calculator', W1280, 0.5], ['/property/calculator', W390, 0.3],
          ['/discover/screener', W390, 1618], ['/discover/screener', W1280, 0.5], ['/app', W1280, 0.6], ['/pricing', W390, 0.5], ['/research/queue', W1280, 0.5]]) {
          await size(metrics);
          await firstVisit({ script: true });
          const faceId = face ? (await send('Page.addScriptToEvaluateOnNewDocument', { source: P.fontScript(face) }, sid)).result?.identifier : null;
          try {
          const at$ = face ? `${path} at ${metrics.width} in ${face}` : `${path} at ${metrics.width}`;
          await send('Page.navigate', { url: live + path }, sid);
          if (!await until(SERVED_PAINTED)) { say('scroll', false, `${at$}: the served page was not painted before the script`); continue; }
          await painted();
          const docH = await value('document.documentElement.scrollHeight');
          const target = at < 1 ? Math.round((docH - metrics.height) * at) : at;
          for (let i = 0; i < 60; i++) {
            const y = await value('scrollY');
            if (y >= target - 30) break;
            await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: metrics.width / 2, y: 400, deltaX: 0, deltaY: Math.min(1200, target - y) }, sid);
            await sleep(40);
          }
          await sleep(700);
          const a = await value(ANCHOR);
          if (!a) { say('scroll', false, `${at$}: no words at the top of the window to hold`); continue; }
          await releaseScript();
          await until(`typeof State !== 'undefined' && !!State.view`); await painted(); await sleep(300);
          const y1 = await value(FIND(a));
          await releaseData();
          await quiet(`typeof realPending !== 'undefined' && !realPending`); await sleep(600);
          const y2 = await value(FIND(a));
          const cls = await value('window.__cls');
          const moved = [y1, y2].map(y => (y == null ? null : Math.round(y - a.y)));
          say('scroll', moved.every(m => m !== null && Math.abs(m) <= 4) && cls <= 0.05, `${at$}, scrolled to ${target}: "${a.t.slice(0, 50)}" at ${Math.round(a.y)}px moved ${moved.map(m => (m === null ? 'out of the page' : `${m > 0 ? '+' : ''}${m}px`)).join(' when drawn, then ')} when the data landed; layout shift ${Number(cls).toFixed(3)}`);
          } finally {
            if (faceId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: faceId }, sid);
          }
        }
        await size(W1280);

        /* 3. The dashboard's heading through the wait. */
        for (const metrics of [W1280, W390]) {
          const r = await heldVisit('/app', { metrics, data: false });
          say('minor', r.painted && !!r.before.h1 && !!r.script.h1 && r.script.served, `/app at ${metrics.width}: the served heading's words were not on screen (before the script: ${JSON.stringify(r.before?.h1)}; standing for the filings: ${JSON.stringify(r.script?.h1)})`);
        }
        await size(W1280);
        /* "none yet", whole. */
        await firstVisit();
        await openFree('/discover/sarawak');
        const broken = await value(`[...document.querySelectorAll('#views .card .row > span.metaline')].filter(s => s.textContent.trim() === 'none yet').map(s => { const r = document.createRange(); r.selectNodeContents(s); return r.getClientRects().length; })`);
        say('minor', broken.length > 0 && broken.every(n => n === 1), `/discover/sarawak at 1280: "none yet" broken over lines in ${broken.filter(n => n !== 1).length} of ${broken.length} cards`);
        /* With no script: no action that does nothing. */
        {
          const { result: { targetId: nid } } = await send('Target.createTarget', { url: 'about:blank' });
          const nsid = (await send('Target.attachToTarget', { targetId: nid, flatten: true })).result.sessionId;
          const nv = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }, nsid)).result?.result?.value;
          await send('Page.enable', {}, nsid); await send('Runtime.enable', {}, nsid);
          await send('Emulation.setScriptExecutionDisabled', { value: true }, nsid);
          for (const metrics of [W1280, W390]) {
            await send('Emulation.setDeviceMetricsOverride', metrics, nsid);
            for (const path of ['/discover/screener', '/property/models', '/property/calculator', '/app/scanner', '/discover/sarawak']) {
              await send('Page.navigate', { url: live + path }, nsid);
              for (let i = 0; i < 60 && await nv('document.readyState') !== 'complete'; i++) await sleep(100);
              await sleep(200);
              const r = await nv(`(() => { const shown = (n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
                const acts = [...document.querySelectorAll('#views [data-inert="button"], #productTabs [data-inert="button"]')].filter(shown)
                  .map(n => n.textContent.replace(/\\s+/g, ' ').trim()).filter(t => /^(Hide|Reset|Save this property|New property)\\b/.test(t));
                const marked = [...document.querySelectorAll('#views [data-act], #productTabs [data-act]')].filter(shown).map(n => n.textContent.trim().slice(0, 30));
                const broken = path => [...document.querySelectorAll('#views .card .row > span.metaline')].filter(s => s.textContent.trim() === 'none yet').filter(s => { const r = document.createRange(); r.selectNodeContents(s); return r.getClientRects().length !== 1; }).length;
                return { acts, marked, broken: broken(), scripted: typeof State !== 'undefined' }; })()`);
              if (!r || r.scripted) { say('minor', false, `${path} at ${metrics.width} with no script: the script ran`); continue; }
              say('minor', !r.acts.length && !r.marked.length, `${path} at ${metrics.width} with no script: actions that do nothing are offered`, [...new Set([...r.acts, ...r.marked])].slice(0, 6));
              if (path === '/discover/sarawak' && metrics.width === 1280) say('minor', !r.broken, `/discover/sarawak at 1280 with no script: "none yet" broken over lines in ${r.broken} cards`);
            }
          }
          await send('Target.closeTarget', { targetId: nid });
        }

        /* 4. At other widths than the render's. */
        /* Each run of text on screen, counted: a word shown twice is two. */
        const RUNS = `(() => { const out = {}; for (const r of [document.getElementById('productTabs'), document.getElementById('views')]) { if (!r || r.hidden) continue;
          const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.data.replace(/\\s+/g, ' ').trim(); const e = n.parentElement;
            if (!t || !e || e.closest('svg, [data-now], .sr-only, [data-inert="field"], [data-inert="choice"], [data-inert="range"], select, textarea, option')) continue;
            const line = e.closest('p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, label, summary'); if (line && line.querySelector('[data-now]')) continue;
            const range = document.createRange(); range.selectNodeContents(n); const b = range.getBoundingClientRect(); if (!b.width || !b.height) continue;
            const k = r.id + ': ' + t.slice(0, 50); out[k] = (out[k] || 0) + 1; } } return out; })()`;
        for (const s of pages.filter(x => manifest.pages[x.file]?.inert?.notShown > 0)) {
          const waits = manifest.pages[s.file].state === 'filings in';
          for (const width of [1024, 1280, 1440]) {
            await size({ width, height: 900, deviceScaleFactor: 1, mobile: false });
            await firstVisit({ script: true });
            await send('Page.navigate', { url: live + s.path }, sid);
            if (!await until(SERVED_PAINTED)) { say('widths', false, `${s.path} at ${width}: the served page was not painted before the script`); continue; }
            await painted();
            const served = await value(RUNS) || {};
            await releaseScript();
            await quiet(`document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view`);
            if (waits) { await releaseData(); await quiet(SETTLED); }
            const drawn = await value(RUNS) || {};
            const appeared = Object.keys(drawn).filter(t => drawn[t] > (served[t] || 0)), went = Object.keys(served).filter(t => served[t] > (drawn[t] || 0));
            say('widths', !appeared.length && !went.length, `${s.path} at ${width}: ${appeared.length ? `on the drawn page and not the served one: ${appeared.slice(0, 4).map(t => JSON.stringify(t)).join(', ')}` : ''}${appeared.length && went.length ? '; ' : ''}${went.length ? `on the served page and not the drawn one: ${went.slice(0, 4).map(t => JSON.stringify(t)).join(', ')}` : ''}`);
          }
        }
        await size(W1280);
      } catch (e) {
        say('first', false, `the checks could not run: ${e.message}`);
      } finally {
        await releaseAll();
        await size(W1280);
        if (framesId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: framesId }, sid);
      }
      const parts = [['first', 'served pages to readers the render is not for: a returning reader\'s own (before this release and since), a reader in New York or London, the dark theme — never shown a fresh visitor\'s page or a light frame, kept out of sight and out of reach, then drawn as theirs; a reader holding only a first visit\'s samples, a reader whose language is Malaysian, and every fresh visitor in Kuala Lumpur shown the page as served'],
        ['scroll', 'a reader who scrolled before the script stays where they were when the page is drawn and when its data lands (/status, the calculator, the screener, /app, /pricing, /research/queue; 1280 and 390; /status in Verdana too), the layout shift at most 0.05'],
        ['minor', 'the dashboard\'s heading on screen through the wait; no action that does nothing offered to a reader with no script; "none yet" whole on the Sarawak screen'],
        ['widths', 'at 1024, 1280 and 1440, every page whose render left something out shows on its served page every run of text the drawn page shows, and no other']];
      for (const [k, what] of parts) {
        if (said[k].length) { bad.push(`integration-final: ${k}`); console.log(`FAIL ${what}`); said[k].slice(0, 30).forEach(x => console.log(`     ${x}`)); if (said[k].length > 30) console.log(`     … and ${said[k].length - 30} more`); }
        else console.log(`ok   ${what}`);
      }
    }
    /* ---- end integration-final ---- */
    /* ---- integration-reverify ---- */
    /* THE INTEGRATION'S RE-VERIFICATION (2026-10-04), each part failing on
       d52f39f:
       1. ONE CURRENCY, BEFORE THE SCRIPT AND AFTER. The head's script
          (FIRST_SCRIPT, build.mjs) and the app (State.baseCcy, 05-plans.js)
          each give a browser that keeps none its base currency from its
          time zone and language, and the app's rule held a backspace where
          \b was meant: an en-MY or ms-MY reader outside the two Malaysian
          zones was shown the ringgit page, then the skeleton, then dollars.
          For a fresh visitor in Singapore (en-MY), London (ms-MY), New York
          (en-US), Kuching (en-GB) and Kuala Lumpur (en-US), the script's
          choice — /compare, drawn in ringgit, shown or kept out of sight —
          is State.baseCcy once the app runs, and is the rule's; and in
          Singapore with en-MY /compare stands through the script (no
          skeleton, in no frame) and its sums stay in ringgit once the
          filings land.
       2. A READER WHO SCROLLED STAYS WHERE THEY READ — every run of words on
          screen, not only the top one the page holds them by (notePlace):
          the area screen at 1280 (495 and 990px down) and 390 (1190 and
          2380), whose map card grew from 120px to 645px under them when the
          locality positions came; the calculator three quarters down on a
          phone, and /research and /app/equities at 1280 (692px down), where
          the words noted were found again as a select's <option>, which has
          no box, and the reader moved 341px and 27px. None may move more
          than 4px when the page is drawn or when its data lands, and the
          layout shift is at most 0.05.
       3. THE AREA SCREEN'S MAP CARD KEEPS ITS ROOM AT EVERY WIDTH: at 360,
          390, 430, 768, 1024, 1280 and 1440 the served card is the height
          of the card drawn with the map in it.
       4. NO EMPTY PAGE WHEN THE APP NEVER COMES. A reader the served page is
          kept from (a New York visitor on /compare; a returning reader on
          /property/models at 390) is shown it at once when the app's script
          fails to load, and SERVED_WAIT_MS after the head when it never
          arrives, not before; and a reader whose app is on time, or comes
          after 5s, is never shown it, however long their data takes. */
    {
      const { defaultCcy, SERVED_WAIT_MS = 8000 } = await import('./build.mjs');
      const said = { ccy: [], place: [], map: [], fallback: [] };
      const say = (k, ok, what, got) => { if (!ok) said[k].push(`${what}${got === undefined ? '' : ` — ${JSON.stringify(got).slice(0, 300)}`}`); else if (VERBOSE) console.log(`       ${k}: ${what}`); };
      const W1280 = { ...P.VIEWPORT, deviceScaleFactor: 1, mobile: false }, W390 = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
      const size = async (m) => { await send('Emulation.setDeviceMetricsOverride', m, sid); await send('Emulation.setTouchEmulationEnabled', { enabled: !!m.mobile, maxTouchPoints: m.mobile ? 5 : 1 }, sid); };
      const releaseData = async () => { holding = false; for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid); held = []; };
      const SETTLED = `typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view && !document.getElementById('views').hasAttribute('data-served')`;
      const ua = (await send('Browser.getVersion', {})).result?.userAgent || '';
      const zone = async (tz, lang) => {
        await send('Emulation.setTimezoneOverride', { timezoneId: tz }, sid);
        await send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: lang }, sid);
        await send('Emulation.setLocaleOverride', { locale: '' }, sid).catch(() => {});
        await send('Emulation.setLocaleOverride', { locale: lang }, sid).catch(() => {});
      };
      /* Each frame as it is painted: served or drawn, kept out of sight or
         shown, the skeleton. */
      const FRAMES = `(() => { const f = window.__fp2 = []; let last = '';
        const tick = () => { const v = document.getElementById('views'), d = document.documentElement;
          if (v && document.body) { const first = v.firstElementChild;
            const k = [v.hasAttribute('data-served') ? 'served' : 'drawn', d.hasAttribute('data-served-hidden') ? 'hidden' : '',
              v.hasAttribute('data-served') && first && getComputedStyle(first).display !== 'none' ? 'shown' : '',
              v.textContent.includes(${JSON.stringify(P.SKELETON)}) ? 'skeleton' : ''].join('|');
            if (k !== last) { f.push(k); last = k; } }
          requestAnimationFrame(tick); };
        requestAnimationFrame(tick); })();`;
      const framesId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: FRAMES }, sid)).result?.identifier;
      const servedShown = (frames) => frames.some(k => /^served\|[^|]*\|shown/.test(k));
      const NOW = `(() => { const d = document.documentElement, v = document.getElementById('views'), first = v && v.firstElementChild;
        return { hidden: d.hasAttribute('data-served-hidden'), shown: !!first && getComputedStyle(first).display !== 'none' && !!v.innerText.trim(),
          served: !!v && v.hasAttribute('data-served'), script: typeof State !== 'undefined', skeleton: !!v && v.textContent.includes(${JSON.stringify(P.SKELETON)}) }; })()`;
      try {
        /* 1. One currency. */
        try {
          for (const [tz, lang, want] of [['Asia/Singapore', 'en-MY', 'MYR'], ['Europe/London', 'ms-MY', 'MYR'], ['America/New_York', 'en-US', 'USD'],
            ['Asia/Kuching', 'en-GB', 'MYR'], ['Asia/Kuala_Lumpur', 'en-US', 'MYR']]) {
            await zone(tz, lang);
            await size(W1280);
            await firstVisit({ script: true });
            await send('Page.navigate', { url: live + '/compare' }, sid);
            if (!await until(SERVED_PAINTED)) { say('ccy', false, `/compare in ${tz} (${lang}): the served page was not painted before the script`); continue; }
            await painted();
            const head = await value(`({ ...${NOW}, reads: document.documentElement.getAttribute('data-served-reads') || '', lang: navigator.language,
              rule: (${defaultCcy})((() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })(), [navigator.language].concat(navigator.languages || []).join(' ')) })`);
            /* /compare is drawn in ringgit and reads nothing else a fresh
               visitor holds otherwise: shown means the script chose ringgit. */
            if (!/(^| )baseCcy:MYR( |$)/.test(head.reads)) { say('ccy', false, `/compare does not say on <html> that its render read a ringgit base`, head.reads); continue; }
            const chose = head.hidden ? 'USD' : 'MYR';
            await releaseScript();
            await until(`typeof State !== 'undefined' && !!State.view && document.readyState === 'complete'`);
            await painted();
            const app = await value(`({ ...${NOW}, ccy: State.baseCcy })`);
            say('ccy', app.ccy === chose && chose === want && head.rule === want,
              `a fresh visitor in ${tz} (${lang}, navigator.language ${head.lang}): the head's script chose ${chose} (the ringgit page ${head.hidden ? 'kept out of sight' : 'shown'}), State.baseCcy is ${app.ccy}, and the rule gives ${want}${head.rule === want ? '' : ` (defaultCcy gave ${head.rule})`}`);
            if (tz === 'Asia/Singapore') {
              say('ccy', app.served && app.shown && !app.skeleton, `/compare in Singapore (${lang}): once the script ran the served page did not stand`, app);
              await releaseData(); await quiet(SETTLED);
              const landed = await value(`(() => { const t = document.getElementById('views').innerText; return { rm: (t.match(/RM\\s?[0-9]/g) || []).length, usd: (t.match(/\\$\\s?[0-9]/g) || []).length, frames: window.__fp2 || [] }; })()`);
              say('ccy', landed.rm > 0 && landed.usd === 0 && !landed.frames.some(k => /skeleton/.test(k)),
                `/compare in Singapore (${lang}): once the filings landed, ${landed.usd} sums in dollars and ${landed.rm} in ringgit${landed.frames.some(k => /skeleton/.test(k)) ? ', the skeleton painted between' : ''}`, landed.frames);
            }
          }
        } finally { await zone(P.ZONE, P.LOCALE); }

        /* 2. The scrolled reader, by every run of words on screen. Each run
           that is the only one of its words on the page (not a chart's, the
           tab's own, a field's value or a choice in a select), and where it
           stands in the window. */
        const SCREEN = `(() => { const v = document.getElementById('views');
          const head = Math.max(0, ...['#pubbar', '#appbar'].map(s => document.querySelector(s)).filter(Boolean).map(n => n.getBoundingClientRect()).filter(r => r.height && r.top <= 1).map(r => r.bottom));
          const stuck = (e) => { for (; e && e !== v; e = e.parentElement) if (/^(sticky|fixed)$/.test(getComputedStyle(e).position)) return true; return false; };
          const count = new Map(), top = new Map(), on = [];
          const w = document.createTreeWalker(v, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            const t = n.data.replace(/\\s+/g, ' ').trim(), e = n.parentElement;
            if (t.length < 3 || !e || e.closest('svg, [data-now], .sr-only, option, optgroup, select, textarea, template, [data-inert="field"], [data-inert="choice"], [data-inert="range"]')) continue;
            const r = document.createRange(); r.selectNodeContents(n);
            if (!r.getClientRects().length || getComputedStyle(e).visibility !== 'visible') continue;
            const b = r.getBoundingClientRect(); if (!b.height) continue;
            count.set(t, (count.get(t) || 0) + 1); top.set(t, b.top);
            if (b.top >= head + 2 && b.bottom <= innerHeight - 2 && !stuck(e)) on.push(t);
          }
          return { at: Object.fromEntries([...top].filter(([t]) => count.get(t) === 1).map(([t, y]) => [t, Math.round(y * 10) / 10])), on: on.filter(t => count.get(t) === 1), y: Math.round(scrollY) }; })()`;
        for (const [path, metrics, at] of [['/property/areas', W1280, 495], ['/property/areas', W1280, 990], ['/property/areas', W390, 1190], ['/property/areas', W390, 2380],
          ['/property/calculator', W390, 0.75], ['/research', W1280, 692], ['/app/equities', W1280, 692]]) {
          await size(metrics);
          await firstVisit({ script: true });
          await send('Page.navigate', { url: live + path }, sid);
          if (!await until(SERVED_PAINTED)) { say('place', false, `${path} at ${metrics.width}: the served page was not painted before the script`); continue; }
          await painted();
          const docH = await value('document.documentElement.scrollHeight');
          const target = at < 1 ? Math.round((docH - metrics.height) * at) : at;
          for (let i = 0; i < 80; i++) {
            const y = await value('scrollY');
            if (y >= target - 30) break;
            await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: metrics.width / 2, y: 400, deltaX: 0, deltaY: Math.min(1200, target - y) }, sid);
            await sleep(40);
          }
          await sleep(700);
          const s0 = await value(SCREEN);
          if (!s0 || s0.on.length < 3) { say('place', false, `${path} at ${metrics.width}, scrolled to ${target}: fewer than three runs of words on screen to hold`, s0?.on); continue; }
          await releaseScript();
          await until(`typeof State !== 'undefined' && !!State.view`); await painted(); await sleep(300);
          const s1 = await value(SCREEN);
          await releaseData();
          await quiet(`typeof realPending !== 'undefined' && !realPending && (typeof geoLoadState === 'undefined' || geoLoadState !== 'loading')`); await sleep(600);
          const s2 = await value(SCREEN);
          const cls = await value('window.__cls');
          const moved = (s) => s0.on.filter(t => t in s.at).map(t => [t, Math.round(s.at[t] - s0.at[t])]);
          const m1 = moved(s1), m2 = moved(s2);
          const far = (m) => m.filter(([, d]) => Math.abs(d) > 4);
          const said2 = (m, when) => (far(m).length ? `${far(m).length} of ${m.length} moved ${when} (${far(m).slice(0, 3).map(([t, d]) => `"${t.slice(0, 36)}" ${d > 0 ? '+' : ''}${d}px`).join(', ')})` : `none of ${m.length} moved ${when}`);
          say('place', m1.length >= 3 && m2.length >= 3 && !far(m1).length && !far(m2).length && cls <= 0.05,
            `${path} at ${metrics.width}, scrolled to ${target} (${s0.on.length} runs on screen): ${said2(m1, 'when drawn')}; ${said2(m2, 'when its data landed')}; window ${s0.y}→${s1.y}→${s2.y}; layout shift ${Number(cls).toFixed(3)}`);
        }
        await size(W1280);

        /* 3. The area screen's map card, served and drawn, at every width. */
        const MAPCARD = `(() => { const h = [...document.querySelectorAll('#views h3')].find(x => /^Kuching — /.test(x.textContent.trim()));
          const c = h && h.closest('.card'); if (!c) return null;
          return { title: h.textContent.trim(), h: Math.round(c.getBoundingClientRect().height), map: !!c.querySelector('svg[data-city]') }; })()`;
        for (const width of [360, 390, 430, 768, 1024, 1280, 1440]) {
          const metrics = { width, height: width < 800 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 800 };
          await size(metrics);
          await firstVisit({ script: true });
          await send('Page.navigate', { url: live + '/property/areas' }, sid);
          if (!await until(SERVED_PAINTED)) { say('map', false, `/property/areas at ${width}: the served page was not painted before the script`); continue; }
          await painted();
          const a = await value(MAPCARD);
          await releaseScript(); await releaseData();
          await quiet(`typeof State !== 'undefined' && typeof geoLoadState !== 'undefined' && geoLoadState === 'done' && !document.getElementById('views').hasAttribute('data-served')`);
          const b = await value(MAPCARD);
          say('map', !!a && !!b && b.map && Math.abs(a.h - b.h) <= 2, `/property/areas at ${width}: the served map card ("${a?.title}") is ${a?.h}px, the card drawn with the map ("${b?.title}") ${b?.h}px`);
        }
        await size(W1280);

        /* 4. The app's script fails, never comes, or comes late. */
        const shownAt = `(() => { const d = document.documentElement; window.__shownAt = d.hasAttribute('data-served-hidden') ? null : __realNow();
          new MutationObserver(() => { if (window.__shownAt == null && !d.hasAttribute('data-served-hidden')) window.__shownAt = __realNow(); }).observe(d, { attributes: true }); return true; })()`;
        const SAVED = { savedWork: [{ id: 'w-frames', kind: 'property', name: 'Frames reader' }] };
        for (const [label, path, metrics, seed] of [['a New York visitor', '/compare', W1280, null], ['a returning reader', '/property/models', W390, SAVED]]) {
          const tz = seed ? P.ZONE : 'America/New_York';
          try {
            await zone(tz, seed ? P.LOCALE : 'en-US');
            await size(metrics);
            /* Fails to load. */
            await firstVisit({ seed, script: true });
            await send('Page.navigate', { url: live + path }, sid);
            if (!await until(SERVED_PAINTED)) { say('fallback', false, `${path} to ${label}: the served page was not painted before the script`); continue; }
            await painted();
            const was = await value(NOW);
            await value(shownAt);
            for (let i = 0; i < 50 && !scriptHeld.length; i++) await sleep(60);
            if (!scriptHeld.length) { say('fallback', false, `${path} to ${label}: the app's script was never asked for`); continue; }
            const failedAt = await value('__realNow()');
            for (const requestId of scriptHeld) await send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' }, sid);
            scriptHeld = []; holdScript = false;
            await until('window.__shownAt != null', 4000);
            const failed = await value(`({ ...${NOW}, at: window.__shownAt })`);
            say('fallback', was.hidden && !failed.script && failed.shown && !failed.hidden && failed.at != null && failed.at - failedAt < 1500,
              `${path} at ${metrics.width} to ${label}, the app's script failing to load: ${was.hidden ? '' : 'not kept out of sight before it (so not the case), '}${failed.shown ? `shown ${Math.round(failed.at - failedAt)}ms after the failure` : 'the served page never shown'}`, failed);
            /* Never comes. */
            await firstVisit({ seed, script: true });
            await send('Page.navigate', { url: live + path }, sid);
            if (!await until(SERVED_PAINTED)) { say('fallback', false, `${path} to ${label}: the served page was not painted before the script`); continue; }
            const was2 = await value(NOW);
            await value(shownAt);
            await until('window.__shownAt != null', SERVED_WAIT_MS + 4000);
            const stalled = await value(`({ ...${NOW}, at: window.__shownAt })`);
            say('fallback', was2.hidden && !stalled.script && stalled.shown && stalled.at != null && stalled.at >= SERVED_WAIT_MS - 50 && stalled.at < SERVED_WAIT_MS + 2000,
              `${path} at ${metrics.width} to ${label}, the app's script never arriving: ${was2.hidden ? '' : 'not kept out of sight before it (so not the case), '}${stalled.at == null ? `the served page not shown in ${(SERVED_WAIT_MS + 4000) / 1000}s` : `shown ${Math.round(stalled.at)}ms after the page was asked for (the bound is ${SERVED_WAIT_MS}ms)`}`, stalled);
            /* On time, or 5s late, and the data slower than the bound. */
            for (const late of [0, 5000]) {
              await firstVisit({ seed, script: late > 0 });
              await send('Page.navigate', { url: live + path }, sid);
              if (late) { await sleep(late); await releaseScript(); }
              await sleep(SERVED_WAIT_MS + 2500 - late);
              const frames = await value('window.__fp2 || []');
              const now = await value(NOW);
              say('fallback', now.script && !servedShown(frames), `${path} at ${metrics.width} to ${label}, the app's script ${late ? `${late / 1000}s late` : 'on time'} and the data held past ${SERVED_WAIT_MS / 1000}s: ${now.script ? '' : 'the app never ran; '}${servedShown(frames) ? 'the served page was shown over a running app' : 'the served page never shown'}`, frames);
            }
          } finally { await releaseAll(); await zone(P.ZONE, P.LOCALE); }
        }
        await size(W1280);
      } catch (e) {
        say('ccy', false, `the checks could not run: ${e.message}`);
      } finally {
        await releaseAll();
        await zone(P.ZONE, P.LOCALE);
        await size(W1280);
        if (framesId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: framesId }, sid);
      }
      const parts = [['ccy', 'one currency: for a fresh visitor in Singapore (en-MY), London (ms-MY), New York (en-US), Kuching (en-GB) and Kuala Lumpur (en-US), State.baseCcy is what the head\'s script chose and what the rule gives; /compare in Singapore (en-MY) stands through the script and stays in ringgit'],
        ['place', 'a reader who scrolled stays where they read — every run of words on screen within 4px when the page is drawn and when its data lands (the area screen at 1280 and 390, the calculator deep on a phone, /research and /app/equities), the layout shift at most 0.05'],
        ['map', 'the area screen\'s served map card is the drawn card\'s height at 360, 390, 430, 768, 1024, 1280 and 1440'],
        ['fallback', `a reader the served page is kept from is shown it at once when the app's script fails to load and ${SERVED_WAIT_MS / 1000}s on when it never comes, and never over an app that runs (on time or 5s late, its data slower than that)`]];
      for (const [k, what] of parts) {
        if (said[k].length) { bad.push(`integration-reverify: ${k}`); console.log(`FAIL ${what}`); said[k].slice(0, 30).forEach(x => console.log(`     ${x}`)); }
        else console.log(`ok   ${what}`);
      }
    }
    /* ---- end integration-reverify ---- */
    /* ---- journeys-served ---- */
    /* THE RECORDED JOURNEYS STAND AS SERVED (N1c and N1e, the 5 Oct audit;
       D16). /status is served with the last recorded run in its journeys
       block, and /property, /research and /app/scanner with one line of
       their journey's result — written by the build from the committed
       record, drawn again by the script with the same function. Its first
       draw happens with the record's no-store read still on its way: the
       block and the line must stand as served until it returns, and then
       say the same — the same markup, where it stood, at the same height —
       or the page moves under the reader (a list of five journeys and their
       steps, emptied and filled again). Held at 1280 and 390, from before
       the script to the page settled with every request answered; and the
       served page must carry a recorded result to begin with, never the
       placeholder. */
    {
      const said = [];
      const W1280 = { ...P.VIEWPORT, deviceScaleFactor: 1, mobile: false }, W390 = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
      const BLOCK = `(() => { const box = (n) => { if (!n) return null; const r = n.getBoundingClientRect(); return [Math.round(r.top + scrollY), Math.round(r.height)]; };
        const s = document.getElementById('health-journeys-sum'), l = document.getElementById('health-journeys'), lines = [...document.querySelectorAll('#views .journey-line')];
        const html = (n) => (n ? n.innerHTML.replace(/<span class="journeys-age">[\\s\\S]*?<\\/span>/, '') : null);
        return { sum: html(s), list: html(l), line: html(lines[0]), lines: lines.length, sumBox: box(s), listBox: box(l), lineBox: box(lines[0]),
          next: box(document.querySelector('#views h1')), served: document.getElementById('views').hasAttribute('data-served'),
          read: typeof HEALTH !== 'undefined' && !!HEALTH.journeys }; })()`;
      const near = (a, b) => (a === null && b === null) || (!!a && !!b && Math.abs(a[0] - b[0]) <= 2 && Math.abs(a[1] - b[1]) <= 2);
      try {
        for (const [path, metrics] of [['/status', W1280], ['/status', W390], ['/property', W1280], ['/property', W390], ['/research', W1280], ['/app/scanner', W390]]) {
          const at = `${path} at ${metrics.width}`;
          await send('Emulation.setDeviceMetricsOverride', metrics, sid);
          await firstVisit({ script: true });
          await send('Page.navigate', { url: live + path }, sid);
          if (!await until(SERVED_PAINTED)) { said.push(`${at}: the served page was not painted before the script`); continue; }
          await painted();
          const served = await value(BLOCK);
          if (path === '/status') {
            if (!/^Last recorded run /.test((served.sum || '').replace(/<[^>]*>/g, ''))) { said.push(`${at}: served with no recorded run in its journeys block: ${JSON.stringify((served.sum || '').slice(0, 90))}`); continue; }
            if (!/<li class="journey-row"/.test(served.list || '')) { said.push(`${at}: served with no journey listed`); continue; }
          } else if (served.lines !== 1 || !/^<span class="journey-line-label">Journey:<\/span> /.test(served.line || '')) { said.push(`${at}: served with no journey line (${served.lines} lines: ${JSON.stringify((served.line || '').slice(0, 80))})`); continue; }
          await releaseScript();
          await until(`typeof State !== 'undefined' && !!State.view && document.readyState === 'complete'`);
          await painted();
          const drawn = await value(BLOCK);
          holding = false;
          for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid);
          held = [];
          if (!await quiet(`typeof realPending !== 'undefined' && !realPending && !document.getElementById('views').hasAttribute('data-served') && typeof HEALTH !== 'undefined' && !!HEALTH.journeys`)) said.push(`${at}: the page never settled with the record read`);
          await painted();
          const settled = await value(BLOCK);
          for (const [when, x] of [['when the script drew it, the record still on its way', drawn], ['once the record was read and the page settled', settled]]) {
            for (const k of path === '/status' ? ['sum', 'list'] : ['line']) if (x[k] !== served[k]) said.push(`${at}, ${when}: the ${k === 'sum' ? 'summary' : k === 'list' ? 'list of journeys' : 'journey line'} is not what was served: ${JSON.stringify((x[k] || '').replace(/<[^>]*>/g, '').slice(0, 80))}`);
            for (const k of path === '/status' ? ['sumBox', 'listBox'] : ['lineBox', 'next']) if (!near(x[k], served[k])) said.push(`${at}, ${when}: ${k.replace('Box', '')} moved from ${JSON.stringify(served[k])} to ${JSON.stringify(x[k])} (top, height)`);
          }
          if (!settled.read) said.push(`${at}: the page never read the record`);
        }
      } catch (e) {
        said.push(`the checks could not run: ${e.message}`);
      } finally {
        await releaseAll();
        await send('Emulation.setDeviceMetricsOverride', W1280, sid);
      }
      const what = 'the recorded journeys stand as served — /status\'s summary and list, and the journey line on /property, /research and /app/scanner — from the first frame, through the script\'s first draw with the record\'s read on its way, to the page settled: the same markup, where it stood, at 1280 and 390';
      if (said.length) { bad.push('journeys-served'); console.log(`FAIL ${what}`); said.slice(0, 30).forEach(x => console.log(`     ${x}`)); }
      else console.log(`ok   ${what}`);
    }
    /* ---- end journeys-served ---- */
    } finally {
      await releaseAll();
      await send('Target.closeTarget', { targetId: tid });
    }
    ws.removeEventListener('message', onPause);
    console.log(bad.length
      ? `\nserved pages: ${bad.length} failed — they changed in their first frames beyond gaining content, or stood where they should not: ${bad.join(', ')}`
      : `\nserved pages: all ${pages.length} carry their page from the first frame — the same text and h1 at another clock than the render's, every run of text where it stood before the script, no skeleton, a shift of at most ${maxCls.toFixed(3)}`);
    failures += bad.length;
  }
  /* ---- end prerender ---- */
  /* ---- scenario-lab ---- */
  /* THE SCENARIO LAB GIVES ONE ANSWER FROM ITS FIRST FRAME (3 Oct 2026).
     Its page is served as the app drew it (prerender, above) and drawn at
     once over itself, every figure from the calculator's model on the
     sample deal. Sampled from navigation for six seconds, each of its
     questions — every result in the chain, the grade, each column's
     figure in the comparison and the line that says what is open — must
     have one answer: never a nought, a dash or another deal's figure for a
     frame before the page's own. Fails before the lab existed: the address
     drew the not-found card, and none of its questions was ever answered. */
  {
    const labCollector = `(async () => {
      const seen = {};
      const t0 = performance.now();
      while (performance.now() - t0 < 6000) {
        const q = {};
        document.querySelectorAll('#views .lab-chain [data-lab], #views .lab-grade [data-lab]').forEach(n => { q['figure ' + n.dataset.lab] = n.textContent.trim(); });
        document.querySelectorAll('#views .lab-cmp tr[data-lab-col]').forEach(n => { q['comparison ' + n.closest('table').dataset.field + ' ' + n.dataset.labCol] = (n.querySelector('.lab-cmp-v')?.textContent || '').trim(); });
        const st = document.querySelector('#views .lab-status');
        if (st) q.status = st.textContent.replace(/\\s+/g, ' ').trim();
        for (const [k, v] of Object.entries(q)) { (seen[k] ||= {}); if (!(v in seen[k])) seen[k][v] = Math.round(performance.now() - t0); }
        await new Promise(r => setTimeout(r, ${SAMPLE_MS}));
      }
      return JSON.stringify(seen);
    })()`;
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Page.navigate', { url: BASE + '/property/lab' }, sessionId);
    const r = await send('Runtime.evaluate', { expression: labCollector, returnByValue: true, awaitPromise: true }, sessionId);
    const seen = r.result?.exceptionDetails ? null : JSON.parse(r.result.result.value);
    const qs = seen ? Object.keys(seen) : [];
    const two = seen ? Object.entries(seen).filter(([, a]) => Object.keys(a).length > 1) : [];
    if (!seen || qs.filter(k => k.startsWith('figure ')).length < 8 || !qs.some(k => k.startsWith('comparison '))) {
      failures++;
      console.log(`FAIL /property/lab — the Scenario Lab's questions were never answered (${qs.length} seen${seen ? '' : ': the collector threw'})`);
    } else if (two.length) {
      failures++;
      console.log('FAIL /property/lab — the Scenario Lab contradicted itself');
      two.slice(0, 8).forEach(([q, a]) => console.log(`     ${q}: ${Object.entries(a).sort((x, y) => x[1] - y[1]).map(([v, ms]) => `+${ms}ms ${v}`).join(' | ')}`));
    } else console.log(`ok   /property/lab          ${qs.length} questions — every result, the grade, each column's comparison and the status — one answer each from the first frame`);
  }
  /* ---- end scenario-lab ---- */
  process.exitCode = failures ? 1 : 0;
} finally {
  try { ws?.close(); } catch { /* already gone */ }
  proc.kill();
  /* Chrome holds its profile for a moment after the kill, and its child
     processes a moment longer. Removed at once, the rm failed quietly on
     Windows, and every run left its profile in TEMP: 1,781 of them, 14 GB,
     had filled C: by 28 September 2026 and parallel runs were failing with
     ENOSPC. Wait for the exit, then retry the removal. */
  await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}
