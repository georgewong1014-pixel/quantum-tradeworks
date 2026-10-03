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
     Lumpur, en-MY, its fixed clock) so "the same page" can be exact; from
     live.localhost, so the app is served as production serves it.
     The observer is in the document before it is parsed, and it reads #views
     inside replaceChildren itself: the app's first draw runs in a microtask
     straight after its script, before the document is interactive, so an
     observer added after the navigation — or a mutation record delivered
     after the draw — would only ever see the drawn page. */
  {
    const { readFileSync } = await import('node:fs');
    const { routePlan, prerenderScope } = await import('./build.mjs');
    const P = await import('./prerender.mjs');
    const here = new URL('.', import.meta.url);
    const read = (f) => readFileSync(new URL(f, here), 'utf8').split('\r\n').join('\n');
    const plan = routePlan(read('src/index.template.html'));
    const manifest = JSON.parse(read('prerender/manifest.json'));
    const live = P.asLive(BASE);
    /* The page's text as it may be served (prerender.mjs: servedCopy, then
       servedText) — of the page the parser built and of the app's drawing
       alike, so the two are measured the same way. */
    const textOf = `(root) => (${P.servedText})((${P.servedCopy})(root))`;
    const observer = `(() => {
      const textOf = ${textOf};
      const snaps = window.__served = [];
      const snap = (el, when) => snaps.push({ when, h1: (el.querySelector('h1')?.textContent || '').replace(/\\s+/g, ' ').trim() || null,
        text: textOf(el), served: el.hasAttribute('data-served'), skeleton: el.textContent.includes(${JSON.stringify(P.SKELETON)}),
        waiting: typeof realPending !== 'undefined' && realPending === true });
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
    const pages = prerenderScope(plan);
    const bad = [];
    let held = [], holding = true, sid = null;
    const onPause = (e) => {
      const m = JSON.parse(e.data);
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sid) return;
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
    for (const [method, params] of [['Runtime.enable', {}], ['Page.enable', {}], ['Network.enable', {}],
      ['Emulation.setDeviceMetricsOverride', { ...P.VIEWPORT, deviceScaleFactor: 1, mobile: false }],
      ['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }],
      ['Emulation.setTimezoneOverride', { timezoneId: P.ZONE }], ['Emulation.setLocaleOverride', { locale: P.LOCALE }],
      ['Page.addScriptToEvaluateOnNewDocument', { source: P.clockScript(P.CLOCK) }],
      ['Page.addScriptToEvaluateOnNewDocument', { source: observer }],
      ['Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Fetch', requestStage: 'Request' }, { urlPattern: '*', resourceType: 'XHR', requestStage: 'Request' }] }]]) {
      await send(method, params, sid);
    }
    try {
    for (const s of pages) {
      const m = manifest.pages?.[s.file];
      if (!m) { bad.push(s.path); console.log(`FAIL served ${s.path}: no render committed`); continue; }
      const committedText = read(s.render).replace(/\n$/, '');
      holding = false;
      for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid);
      await send('Page.navigate', { url: 'about:blank' }, sid);
      await sleep(150);
      await send('Storage.clearDataForOrigin', { origin: live, storageTypes: 'all' }, sid);
      await send('Network.clearBrowserCache', {}, sid);
      held = []; holding = true;
      const problems = [];
      try {
        await send('Page.navigate', { url: live + s.path }, sid);
        /* 1. Every request held. */
        if (!await quiet(`document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view`)) problems.push('the page never settled with its requests held');
        const want = await value(`(${P.textOfMarkup})(${P.servedText}, ${JSON.stringify(committedText)})`);
        const one = await value(`({ snaps: window.__served, waits: UNIVERSE_VIEWS.has(State.view), served: document.getElementById('views').hasAttribute('data-served'), text: (${textOf})(document.getElementById('views')) })`);
        const first = one.snaps[0];
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
        }
        if (two.snaps.some(x => x.skeleton)) problems.push('the loading skeleton was drawn');
        const h1s = [...new Set([first?.h1 ?? m.h1, ...two.snaps.map(x => x.h1)])];
        if (h1s.length !== 1 || h1s[0] !== m.h1) problems.push(`the h1 read ${h1s.map(h => JSON.stringify(h)).join(', then ')}, where the page's is ${JSON.stringify(m.h1)}`);
        maxCls = Math.max(maxCls, two.cls || 0);
        if (!(two.cls <= 0.1)) problems.push(`it shifted by ${Number(two.cls).toFixed(3)}: ${(two.moved || []).join('; ')}`);
        if (VERBOSE && two.cls > 0) (two.moved || []).forEach(x => console.log(`       moved ${x}`));
        if (problems.length) { bad.push(s.path); console.log(`FAIL served ${s.path}`); problems.forEach(p => console.log(`     ${p}`)); }
        else console.log(`ok   served ${s.path.padEnd(28)} ${one.waits ? 'stood until the filings landed, then drawn once' : 'drawn over itself, the same page'}; h1 "${m.h1}"; shift ${Number(two.cls).toFixed(3)}`);
      } catch (e) {
        bad.push(s.path); console.log(`FAIL served ${s.path}: ${e.message}`);
      }
    }
    } finally {
      holding = false;
      for (const requestId of held) await send('Fetch.continueRequest', { requestId }, sid);
      await send('Target.closeTarget', { targetId: tid });
    }
    ws.removeEventListener('message', onPause);
    console.log(bad.length
      ? `\nserved pages: ${bad.length} of ${pages.length} changed in their first frames beyond gaining content: ${bad.join(', ')}`
      : `\nserved pages: all ${pages.length} carry their page from the first frame — the same text, the same h1, no skeleton, a shift of at most ${maxCls.toFixed(3)}`);
    failures += bad.length;
  }
  /* ---- end prerender ---- */
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
