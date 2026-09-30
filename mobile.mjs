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
/* 375 is the Phase 2 brief's own phone width, and the one the focus walk
   below already used; the overflow sweep skipped from 360 to 390 past it. */
const WIDTHS = [360, 375, 390, 430, 768, 1024, 1440];
const ROUTES = ['/my/theses', '/discover/screener', '/property/calculator?city=sibu',
                '/property/calculator?city=kuching', '/pricing', '/learn/glossary', '/app',
                /* Release A: /app is the visitor's dashboard, and the research queue
                   it used to be — the four-card market strip and the change feed —
                   moved here, so the page measured under /app is still measured. */
                '/research/queue',
                /* Release A: /welcome is no longer what /app redirects to, so it
                   was measured nowhere, and its Skip button was the phone target
                   reported last; /how-it-works carries the examples that left
                   the homepage. */
                '/welcome', '/how-it-works',
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
                '/company/MAYBANK?tab=filings',
                /* The statements table, the widest on a company page: ten years,
                   a CAGR column and, on request, two change columns a year.
                   The table scrolls inside its card; the page must not. */
                '/company/MSFT-SEC?tab=financials', '/company/MAYBANK?tab=financials',
                /* Phase 2 batch F: the Studio with its bridge inputs and axis
                   chooser, the comparison with its period and scale rows, the
                   workspace list and the printable report, filed and
                   illustrative. */
                '/company/MSFT-SEC?tab=valuation', '/compare?companies=AAPL-SEC,MSFT-SEC,MAYBANK',
                '/my/workspace', '/company/MSFT-SEC/report', '/company/MAYBANK/report',
                /* The equities lane under the brief's own addresses and the two
                   pages it names that were never measured below 1440: the
                   watchlist page (a table per list, four controls per row) and
                   the compare table. The valuation tab carries a flag notice
                   and the Studio's two-column rail; /status gained a priority
                   column and the release card. */
                '/my/watchlists', '/compare', '/app/equities/explore', '/app/equities/compare',
                '/app/equities/aapl/valuation', '/status',
                /* Phase 3 — user: the builder (a condition row of up to eight
                   fields), the setups list, the alerts centre and settings. */
                '/app/scanner/setups', '/app/scanner/setups/new', '/app/scanner/watchlists',
                '/app/scanner/alerts', '/app/scanner/settings',
                /* Phase 3 — the scanner (ops): the dashboard, its two P1 surfaces
                   and the operations pages a phone is likely to open — the runs
                   table and the data-health tables are the widest. */
                '/app/scanner', '/app/scanner/market', '/app/scanner/backtest',
                '/admin/scanner', '/admin/scanner/jobs', '/admin/scanner/data'];

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
/* The /app/ aliases and the list pages wait on the same set: a watchlist's
   rows and the scanner's universe are drawn only once the filers are in. */
const DATA_ROUTES = /^\/(company\/|discover|research|compare|app\/equities|app\/watchlists|my\/watchlists|my\/scanner|app\/scanner|admin\/scanner|$)/;
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
         40px tall while the comments and CLAUDE.md said 44 square.
         <summary> is a control too: eight disclosure toggles on the screener
         measured 28px and were never counted. */
      const smallEls = [...document.querySelectorAll('button,a.btn,select,summary')].filter(n => {
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

/* FOCUS THAT LANDS WHERE NOBODY CAN SEE IT.
   Overflow is not the only way a page hides its own controls. Walked with
   the keyboard, the property calculator put 50 of its fields underneath the
   fixed decision dock at 375px, the screener's filter rail kept "Advanced
   filters", "Save screen" and "Export" below the fold of a 900px screen
   inside a sticky box that could not scroll, and the report's section jump
   took focus while its row was 0px tall and transparent. Tab through each
   page and, at every stop, hit-test the focused control's top and bottom
   edges: if both land on something else — or outside the viewport, or on an
   invisible box — the reader is typing into a field they cannot see. */
/* The explorer and compare joined with the equities routes above: the
   explorer's filters and the compare picker's chips are the two long runs of
   controls in the lane that the walk had not covered. */
/* The scanner's setup builder is the longest run of controls in Phase 3 —
   a name, a universe, a timeframe, then up to eight fields a condition, the
   cooldown and the expiry — and its keyboard use was checked only by
   equity-test's own walk at one width, never against the phone topbar
   (docs/phase3-plan.md SC-319 item 6). */
const FOCUS_ROUTES = ['/property/calculator', '/discover/screener', '/company/AAPL-SEC', '/app/watchlists',
                      '/app/equities/explore', '/compare', '/app/scanner/setups/new'];
/* Reduced motion, so a control that slides in on focus — the skip link — is
   measured where it comes to rest and not 20ms into the slide. */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
const tabKey = async (back) => {
  const modifiers = back ? 8 : 0;
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers }, sessionId);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers }, sessionId);
};
for (const w of [375, 1440]) {
  await send('Emulation.setDeviceMetricsOverride',
    { width: w, height: w < 768 ? 812 : 900, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
  /* Both directions: forwards the browser scrolls a control to the bottom
     edge (the dock's side), backwards to the top edge (the topbar's). */
  for (const back of [false, true]) for (const route of FOCUS_ROUTES) {
    const dir = back ? ' (Shift+Tab)' : '';
    await send('Page.navigate', { url: BASE + route }, sessionId);
    await sleep(1500);
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      const p = await send('Runtime.evaluate', { returnByValue: true, expression:
        `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
      ready = p.result?.result?.value === true;
      if (!ready) await sleep(500);
    }
    if (!ready) { bad++; console.log(`FAIL ${w}px ${route}${dir} — focus walk: the filed set never arrived`); continue; }
    /* Instant scrolling, so each measurement sees where the browser put the
       control rather than a frame of the smooth scroll on its way there. */
    await send('Runtime.evaluate', { expression: `document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, ${back ? 'document.documentElement.scrollHeight' : 0}); document.activeElement?.blur(); 1` }, sessionId);
    const hidden = []; const seen = new Set();
    for (let i = 0; i < 260; i++) {
      await tabKey(back);
      const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
        /* Two frames, so a transition started by the focus has applied its
           end state — measured synchronously the skip link still read as
           parked above the viewport, focused but not yet moved. */
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const n = document.activeElement;
        if (!n || n === document.body) return { end: true };
        if (!n.dataset.fw) n.dataset.fw = String(Math.random()).slice(2);
        const b = n.getBoundingClientRect();
        let op = 1; for (let p = n; p && p.nodeType === 1; p = p.parentElement) op *= parseFloat(getComputedStyle(p).opacity);
        const x = Math.min(innerWidth - 2, Math.max(1, b.left + Math.min(b.width, 40) / 2));
        const covered = [b.top + 3, b.bottom - 3].map(y => {
          if (y < 0 || y > innerHeight) return 'off-screen';
          const t = document.elementFromPoint(x, y);
          if (!t || n.contains(t) || t.contains(n)) return '';
          const c = t.closest('.dock,.topbar,.ticker-sticky') || t;
          return c.tagName.toLowerCase() + (c.className && typeof c.className === 'string' ? '.' + c.className.split(' ')[0] : '');
        });
        /* Taller than the viewport (a scrollable table region) cannot fit.
           A focusable mark inside a chart is hit-tested against its own
           siblings — a scale bar, a label — so only visibility counts there. */
        const why = b.height > innerHeight - 40 ? '' : op < 0.1 || b.height < 2 ? 'invisible'
          : covered.every(Boolean) && !(n instanceof SVGElement) ? covered.join(' / ') : '';
        return { id: n.dataset.fw, why, who: n.tagName.toLowerCase() + ' “' + (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 28) + '”' };
      })()` }, sessionId);
      const v = r.result?.result?.value;
      if (!v || v.end) break;
      if (seen.has(v.id)) continue;   /* a date field takes several Tabs */
      seen.add(v.id);
      if (v.why) hidden.push(`${v.who} (${v.why})`);
    }
    if (!seen.size) { bad++; console.log(`FAIL ${w}px ${route}${dir} — focus walk reached no control at all`); continue; }
    if (hidden.length) {
      bad++;
      console.log(`FAIL ${w}px ${route}${dir} — ${hidden.length} of ${seen.size} focus stops hidden: ${hidden.slice(0, 4).join('; ')}`);
    }
  }
}

/* EVERY DESTINATION AT 360. Phase 3 put Scanner in the header, and a sixth
   item is how the topbar overflowed before. Since Release A the header is a
   drawer on a phone: opened, every link in it must sit wholly inside the
   viewport, none clipped, each a 44px target, with Quantum Scanner the
   product after Equities Research. */
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId);
await send('Page.navigate', { url: BASE + '/app/scanner' }, sessionId);
await sleep(2500);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    document.getElementById('navOpen').click();
    await new Promise(res => setTimeout(res, 450));
    const links = [...document.querySelectorAll('#appnav a.sb-link')];
    const bad = links.filter(a => { const b = a.getBoundingClientRect(); return b.width === 0 || b.left < 0 || b.right > innerWidth || b.height < 44; })
      .map(a => a.textContent.trim());
    const labels = links.map(a => a.querySelector('.sb-text')?.textContent.trim());
    closeNavDrawer({ restore: false });
    return { n: links.length, bad, labels };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  const at = v ? v.labels.indexOf('Quantum Scanner') : -1;
  if (!v || v.n < 9 || v.bad.length || at < 1 || v.labels[at - 1] !== 'Equities Research') { bad++; console.log(`FAIL 360px navigation — ${v ? `${v.n} links (${v.labels.join(', ')}), outside or under 44px: ${v.bad.join(', ') || 'none'}` : 'not measured'}`); }
}

/* THE STUCK COMPANY STRIP HAS TO BE ON TOP. On a phone it sticks at top:0
   and is meant to cover the topbar; at z-index 25 the 167px topbar covered it
   instead, so the ten tabs and the section jump disappeared as they stuck. */
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true }, sessionId);
await send('Page.navigate', { url: BASE + '/company/AAPL-SEC' }, sessionId);
await sleep(2500);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.min(3000, document.documentElement.scrollHeight - innerHeight));
    await new Promise(r => setTimeout(r, 600));
    const strip = document.querySelector('.ticker-sticky');
    const tab = strip?.querySelector('.subnav button');
    if (!strip || !tab || !strip.classList.contains('is-stuck')) return 'the strip never stuck';
    const b = tab.getBoundingClientRect();
    const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return t && strip.contains(t) ? '' : 'first tab is under ' + (t ? t.closest('header,div')?.className : 'nothing');
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (v) { bad++; console.log(`FAIL 375px /company/AAPL-SEC — stuck strip: ${v}`); }
}
/* ---- bugfix: shell ---- */
/* THE PRIMARY BUTTON IN THE DEFAULT LIGHT THEME. A dark-mode rule also matched
   every visitor who had not chosen a theme, so on a light OS every primary
   button printed #0A1A33 on the brand blue — 2.5:1. Measured against both
   ends of the button's gradient, with no theme stored. */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: BASE + '/' }, sessionId);
await sleep(1500);
await send('Runtime.evaluate', { expression: `localStorage.removeItem('vl.theme'); true` }, sessionId);
await send('Page.navigate', { url: BASE + '/' }, sessionId);
await sleep(2000);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const lum = (c) => { const m = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const n = document.querySelector('main .btn-primary');
    if (!n) return { none: true };
    const cs = getComputedStyle(n);
    const stops = cs.backgroundImage.match(/rgba?\\([^)]*\\)/g) || [cs.backgroundColor];
    const t = lum(cs.color);
    const worst = Math.min(...stops.map(s => { const b = lum(s); return (Math.max(t, b) + 0.05) / (Math.min(t, b) + 0.05); }));
    return { theme: document.documentElement.dataset.theme || null, color: cs.color, stops, worst: +worst.toFixed(2) };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || v.none || v.theme || !(v.worst >= 4.5)) { bad++; console.log(`FAIL light theme, none chosen — primary button text ${v ? `${v.color} on ${(v.stops || []).join(' → ')} measures ${v.worst}:1` : 'not measured'}`); }
}

/* THE STUCK STRIP AT 1024. From 781 to 1220px the topbar wraps to two rows,
   101px, and the strip stuck at the 60px design height: its identity row —
   ticker, price and the section jump — sat underneath the topbar. */
await send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: BASE + '/company/AAPL-SEC' }, sessionId);
await sleep(2500);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, Math.min(2500, document.documentElement.scrollHeight - innerHeight));
    await new Promise(r => setTimeout(r, 600));
    const strip = document.querySelector('.ticker-sticky');
    if (!strip || !strip.classList.contains('is-stuck')) return 'the strip never stuck';
    const row = strip.querySelector('.ts-ident').getBoundingClientRect();
    /* The bar on screen — none beside the sidebar since Release A. */
    const bar =[...document.querySelectorAll('.topbar')].find(b => b.getClientRects().length)?.getBoundingClientRect() || { height: 0, bottom: 0 };
    const t = document.elementFromPoint(row.left + 12, row.top + row.height / 2);
    return t && strip.contains(t) ? '' : 'identity row at ' + Math.round(row.top) + 'px is under the ' + Math.round(bar.height) + 'px topbar';
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (v !== '') { bad++; console.log(`FAIL 1024px /company/AAPL-SEC — stuck strip: ${v ?? 'not measured'}`); }
}

/* And the screener's filter rail, which sticks under the same topbar: on a
   window tall enough for it to stay sticky at 1100px it came to rest at 72px,
   under the 101px two-row bar. */
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1300, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: BASE + '/discover/screener' }, sessionId);
await sleep(2500);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const rail = document.querySelector('.rail-sticky');
    if (!rail) return 'no rail on the screener';
    window.scrollTo(0, 600);
    await new Promise(r => setTimeout(r, 500));
    if (getComputedStyle(rail).position !== 'sticky') return '';
    /* The bar on screen — none beside the sidebar since Release A. */
    const bar =[...document.querySelectorAll('.topbar')].find(b => b.getClientRects().length)?.getBoundingClientRect() || { height: 0, bottom: 0 };
    const top = rail.getBoundingClientRect().top;
    return top >= bar.bottom ? '' : 'rail stuck at ' + Math.round(top) + 'px, under the ' + Math.round(bar.bottom) + 'px topbar';
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (v !== '') { bad++; console.log(`FAIL 1100px /discover/screener — sticky rail: ${v ?? 'not measured'}`); }
}

/* CHART TEXT CUT BY ITS OWN FRAME AT 360. SVG text does not wrap: the
   valuation tornado's labels began left of the chart ("erminal operating
   margin") and the sensitivity grid's fifth column was drawn past the card.
   No label, value or cell may extend outside the svg it belongs to. */
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId);
for (const route of ['/company/MSFT-SEC?tab=valuation', '/company/MAYBANK?tab=valuation', '/property/calculator']) {
  await send('Page.navigate', { url: BASE + route }, sessionId);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    const p = await send('Runtime.evaluate', { returnByValue: true, expression: `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
    ready = p.result?.result?.value === true;
  }
  await sleep(800);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const out = [];
    document.querySelectorAll('#views svg.chart').forEach(s => {
      if (!/step in each|Sensitivity|Assumptions ranked/.test(s.getAttribute('aria-label') || '')) return;
      const sb = s.getBoundingClientRect(); if (!sb.width) return;
      s.querySelectorAll('text, rect').forEach(t => { const tb = t.getBoundingClientRect(); if (!tb.width) return;
        if (tb.left < sb.left - 1 || tb.right > sb.right + 1) out.push('"' + (t.textContent || t.tagName).trim().slice(0, 24) + '" ' + Math.round(tb.left - sb.left) + '..' + Math.round(tb.right - sb.left) + 'px of ' + Math.round(sb.width)); });
    });
    return out;
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || v.length) { bad++; console.log(`FAIL 360px ${route} — chart content outside its frame: ${v ? v.slice(0, 3).join('; ') : 'not measured'}`); }
}
await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
/* ---- end bugfix: shell ---- */
/* ---- bugfix: grade-area-registers ---- */
/* A STRIP'S LABEL ON ONE LINE, AND THE STATUS PATHS 44PX EACH WAY. The area
   screen's "Shade by" label was the one shrinkable item beside a fifteen-
   layer strip: it read "Sha / de / by" at 1440px and one letter a line on a
   phone. The /status path links were 44px tall and as narrow as their text —
   "/status" 42px, "/learn" 36px. */
for (const w of [360, 390, 1440]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
  await send('Page.navigate', { url: BASE + '/property/areas' }, sessionId);
  await sleep(2500);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const labels = [...document.querySelectorAll('main .seg-group > .caption')];
    const wrapped = labels.filter(n => { const lh = parseFloat(getComputedStyle(n).lineHeight) || 18;
      return n.getBoundingClientRect().height > lh * 1.5; }).map(n => n.textContent + ' ' + Math.round(n.getBoundingClientRect().width) + '×' + Math.round(n.getBoundingClientRect().height) + 'px');
    return { n: labels.length, wrapped };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || !v.n || v.wrapped.length) { bad++; console.log(`FAIL ${w}px /property/areas — strip labels wrapped: ${v ? v.wrapped.join('; ') || 'no labels found' : 'not measured'}`); }
}
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
await send('Page.navigate', { url: BASE + '/status' }, sessionId);
await sleep(2500);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const links = [...document.querySelectorAll('main table.status-dt td a')];
    const small = links.filter(a => { const b = a.getBoundingClientRect(); return b.width < 44 || b.height < 44; })
      .map(a => a.textContent + ' ' + Math.round(a.getBoundingClientRect().width) + '×' + Math.round(a.getBoundingClientRect().height) + 'px');
    return { n: links.length, small };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || !v.n || v.small.length) { bad++; console.log(`FAIL 390px /status — path links under 44px: ${v ? [...new Set(v.small)].join('; ') || 'no links found' : 'not measured'}`); }
}
/* THE AREA RECORDER FITS WHAT SHOWS OF ITS TABLE. It sits in a row spanning
   all sixteen columns and took the table's 1,674px width, with the cell's
   nowrap: at 390px every sentence and field ran past the scrolling wrapper,
   and once the table was scrolled to the Record button the recorder opened
   1,300px out of sight to the left. */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
await send('Page.navigate', { url: BASE + '/property/areas' }, sessionId);
await sleep(2500);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    State.areaScreen.editing = 'Tabuan'; render(); await new Promise(res => setTimeout(res, 300));
    const h = [...document.querySelectorAll('main h4')].find(x => /^Record for/.test(x.textContent));
    if (!h) return { err: 'no recorder' };
    const box = h.closest('.sunk'), wrap = box.closest('.tablewrap');
    wrap.scrollLeft = wrap.scrollWidth; await new Promise(res => setTimeout(res, 100));
    const w = wrap.getBoundingClientRect(), q = box.getBoundingClientRect();
    const spill = [...box.querySelectorAll('p, label, select, input, h4, h5')].filter(n => {
      const b = n.getBoundingClientRect(); return b.width > 0 && (b.left < w.left - 1 || b.right > w.right + 1 || n.scrollWidth > n.clientWidth + 1 && n.tagName === 'P');
    }).map(n => n.tagName + ' ' + (n.textContent || n.id).trim().slice(0, 30));
    State.areaScreen.editing = null; render();
    return { box: [Math.round(q.left), Math.round(q.right)], wrap: [Math.round(w.left), Math.round(w.right)], spill: spill.slice(0, 4) };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || v.err || v.box[0] < v.wrap[0] || v.box[1] > v.wrap[1] || v.spill.length) { bad++; console.log(`FAIL 390px /property/areas — the recorder does not fit its table: ${JSON.stringify(v)}`); }
}
/* ---- end bugfix: grade-area-registers ---- */

/* ---- bugfix2: shell ---- */
/* A FIGURE THAT OPENS ITS SOURCE IS A TAP TARGET. The statements table's and
   the comparison's sourced cells are buttons (role, tab stop, Enter), and
   they measured 64-276 × 39px at 360 and 390px — under the 44px floor, row
   after row, a finger apart. So did a link that is all its table cell holds
   (a watchlist's ticker 34×19, "Brickz" as its row's header 38×19, a build-
   status path 42px wide) and a setup's name in the list against the worker's
   file (22px tall). Every one must be 44px on both axes. `need` marks the
   pages that always hold such a target; the setups list exists only where a
   setup does. */
{
  const TARGETS = `main .cell-sourced, main td[role="button"], main td > a:only-child, main th > a:only-child, main .scan-drift li > .row > a`;
  const pages = [['/compare?companies=AAPL-SEC,MSFT-SEC,MAYBANK', true], ['/company/MSFT-SEC?tab=financials', true],
    ['/company/MAYBANK?tab=financials', true], ['/my/watchlists', true], ['/data-sources', true], ['/status', true], ['/app/scanner/setups', false]];
  for (const w of [360, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId);
    for (const [route, need] of pages) {
      await send('Page.navigate', { url: BASE + route }, sessionId);
      let ready = false;
      for (let i = 0; i < 40 && !ready; i++) {
        await sleep(500);
        const p = await send('Runtime.evaluate', { returnByValue: true, expression: `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
        ready = p.result?.result?.value === true;
      }
      await sleep(600);
      const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
        const cells = [...document.querySelectorAll(${JSON.stringify(TARGETS)})].filter(n => n.getClientRects().length);
        const small = cells.map(n => [n, n.getBoundingClientRect()]).filter(([, b]) => b.width < 44 || b.height < 44)
          .map(([n, b]) => '"' + n.textContent.trim().slice(0, 16) + '" ' + Math.round(b.width) + '×' + Math.round(b.height));
        return { n: cells.length, small };
      })()` }, sessionId);
      const v = r.result?.result?.value;
      if (!v || (need && !v.n) || v.small.length) { bad++; console.log(`FAIL ${w}px ${route} — cell and list targets under 44px: ${v ? `${v.small.length} of ${v.n} (${v.small.slice(0, 3).join(', ')})` : 'not measured'}`); }
    }
  }
}
/* ---- end bugfix2: shell ---- */
/* ---- bugfix2: equities ---- */
/* A SENTENCE IN A TABLE CELL IS NOT CUT INSIDE A WORD. .caption breaks
   anywhere, and a table sized to its narrowest on a phone gave the IPS
   gates' "Why" 28px — "instalment" cut in two on every line, the card
   6,000px tall — the demand notes and the evidence tiers the same, and the
   strategy lens's "Supports" 85px. A word laid out on two lines is found
   with a Range over it; a break at a hyphen or a dash is ordinary wrapping
   and not counted. */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
for (const [route, heads] of [
  ['/property/calculator?city=kuching', ['#|Gate|State|Why', 'Source|State|Counts', 'Allowance|Triggered by']],
  ['/methodology/ips', ['IPS §8 says|', '#|Gate|The question it asks', 'Tier|IPS description|']],
  ['/company/JPM-SEC', ['Strategy|Grade|Supports|Weakens or missing']],
]) {
  await send('Page.navigate', { url: BASE + route }, sessionId);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    const p = await send('Runtime.evaluate', { returnByValue: true, expression: `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
    ready = p.result?.result?.value === true;
  }
  await sleep(800);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    document.querySelectorAll('#views details').forEach(d => { d.open = true; });
    const heads = ${JSON.stringify(heads)};
    const seen = [], cut = [];
    document.querySelectorAll('#views table.dt').forEach(t => {
      const h = [...t.querySelectorAll('thead th')].map(x => x.textContent).join('|');
      const which = heads.find(x => h.startsWith(x));
      if (!which) return;
      seen.push(which);
      t.querySelectorAll('tbody td').forEach(td => {
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          const re = /[^\\s\\u2010-\\u2014-]+/g; let m;
          while ((m = re.exec(n.data))) {
            if (m[0].length < 3 || m[0].length > 24) continue;
            const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
            const tops = new Set([...rg.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
            if (tops.size > 1) cut.push(which.split('|')[0] + ': "' + m[0] + '" in a ' + Math.round(td.getBoundingClientRect().width) + 'px cell');
          }
        }
      });
    });
    return { seen, cut };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  /* The environmental table renders only once an allowance is recorded, so
     it is looked for, not required. */
  const missing = v ? heads.filter(h => !h.startsWith('Allowance') && !v.seen.includes(h)) : heads;
  if (!v || missing.length || v.cut.length) { bad++; console.log(`FAIL 390px ${route} — words cut inside prose cells: ${v ? [...missing.map(h => 'no table "' + h + '"'), ...v.cut.slice(0, 4)].join('; ') : 'not measured'}`); }
}
/* ---- end bugfix2: equities ---- */
/* ---- bugfix4: shell ---- */
/* A CHART MARK THAT IS A BUTTON IS A TAP TARGET. The value map's and
   Compare's marks measured 26-29px at 390px, and the heatmap's smaller
   tiles 30×42, 33×56 and 59×36 — each one a keyboard- and tap-operable
   button. On a phone every mark must either be 44px on both axes (the
   scatter's hit circle grows) or have a 44px button on the page for the
   same company that opens the same thing (a treemap tile's area is market
   capitalisation and cannot grow). One such button is pressed to prove it
   opens the drawer. And a grown hit circle must not take a tap from a
   neighbour: on the value map a tap on each mark's dot opens that mark —
   grown in one layer, three companies' dots opened the company beside them. */
for (const w of [360, 390]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  /* Compare draws a mark only for a company with a price. The filed US
     companies have none in this repository (no licensed feed), only on a
     machine holding its own git-ignored price file, so with AAPL and MSFT this
     passed there and found no mark at all in CI. The illustrative Bursa
     companies carry their prices in the dataset, everywhere. */
  for (const route of ['/discover?tab=heatmap', '/discover/value-map', '/compare?companies=MAYBANK,PBBANK,CIMB']) {
    await send('Page.navigate', { url: BASE + route }, sessionId);
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
      await sleep(500);
      const p = await send('Runtime.evaluate', { returnByValue: true, expression: `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
      ready = p.result?.result?.value === true;
    }
    await sleep(900);
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const big = (n) => { const b = n.getBoundingClientRect(); return b.width >= 44 && b.height >= 44; };
      const who = (n) => (n.getAttribute('aria-label') || '').split(/[ ,]/)[0];
      const marks = [...document.querySelectorAll('#views svg g[role="button"]')];
      const buttons = [...document.querySelectorAll('#views button')].filter(b => b.getClientRects().length && big(b));
      const bad = marks.filter(g => !big(g) && !buttons.some(b => who(b) === who(g)))
        .map(g => { const b = g.getBoundingClientRect(); return who(g) + ' ' + Math.round(b.width) + '×' + Math.round(b.height); });
      const offered = buttons.filter(b => marks.some(g => !big(g) && who(g) === who(b)));
      let opened = null;
      if (offered.length) {
        offered[0].click();
        await wait(400);
        opened = document.getElementById('drawer').hidden ? '' : document.getElementById('drawerTitle').textContent;
        closeDrawer(); await wait(400);
      }
      /* What a tap on each value-map mark's dot opens. The page's opener is
         swapped for a recorder while the dots are hit-tested, then put back. */
      const stolen = [];
      if (location.pathname === '/discover/value-map') {
        document.documentElement.style.scrollBehavior = 'auto';
        const real = window.openRadarDetail, got = [];
        window.openRadarDetail = (id) => got.push(id);
        try {
          for (const g of marks) {
            const t = g.getBoundingClientRect(); window.scrollTo(0, scrollY + t.top - innerHeight / 2); await wait(20);
            const d = g.querySelectorAll('circle')[2].getBoundingClientRect();
            const x = d.left + d.width / 2, y = d.top + d.height / 2;
            got.length = 0;
            document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
            const want = U.find(u => u.c.tk === who(g))?.c.id;
            if (got.length !== 1 || got[0] !== want) stolen.push(who(g) + '→' + (got[0] || 'nothing'));
          }
        } finally { window.openRadarDetail = real; }
      }
      return { n: marks.length, bad, offered: offered.length, opened, stolen };
    })()` }, sessionId);
    const v = r.result?.result?.value;
    if (!v || !v.n || v.bad.length || (v.offered && !v.opened) || v.stolen.length) {
      bad++; console.log(`FAIL ${w}px ${route} — chart marks under 44px with no 44px equivalent, or a tap that opens another mark: ${v ? `${v.bad.length} of ${v.n} (${v.bad.slice(0, 3).join(', ')})${v.offered && !v.opened ? '; an offered button opened nothing' : ''}${v.stolen.length ? `; a tap on the dot opened another: ${v.stolen.slice(0, 4).join(', ')}` : ''}` : 'not measured'}`);
    }
  }
}
/* ---- end bugfix4: shell ---- */
/* ---- bugfix4: misc ---- */
/* THE SAME, FOR THE PROSE COLUMNS THE CHECK ABOVE DID NOT REACH. The
   property grade's "Basis" beside three columns that do not wrap was 58px
   on a phone — "transacted", "property", "checklist" cut in two and one
   cell 720px tall — and so was the loan-readiness table's, which appears
   once a borrower is entered. On a valuation tab the confidence table's
   "Rule" was 53px ("describes", "unmeasurable") and the nine methods'
   "Basis" 58px, one cell 880px tall. A borrower is entered for the one
   table that needs it and removed afterwards. */
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
await send('Runtime.evaluate', { expression: `localStorage.setItem('vl.borrowerProfile', JSON.stringify({ assessed: true, employmentType: 'salaried',
  verifiedNetMonthlyIncome: 9000, existingMonthlyDebtPayments: 800, essentialMonthlyCommitments: 2500, liquidCashAvailable: 150000,
  incomeStabilityMonths: 36, creditReview: 'not_checked', applicantCount: 1, docs: {} })); true` }, sessionId);
for (const [route, heads] of [
  ['/property/calculator?city=kuching', ['Pillar|Weight|Score|Basis', 'Component|Weight|Score|Basis']],
  ['/company/JPM-SEC?tab=valuation', ['Part|Reading|Points|Rule', '#|Method|Value per share|vs price|Basis']],
]) {
  await send('Page.navigate', { url: BASE + route }, sessionId);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    const p = await send('Runtime.evaluate', { returnByValue: true, expression: `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
    ready = p.result?.result?.value === true;
  }
  await sleep(800);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    document.querySelectorAll('#views details').forEach(d => { d.open = true; });
    const heads = ${JSON.stringify(heads)};
    const seen = [], cut = [];
    document.querySelectorAll('#views table.dt').forEach(t => {
      const h = [...t.querySelectorAll('thead th')].map(x => x.textContent).join('|');
      const which = heads.find(x => h === x);
      if (!which) return;
      seen.push(which);
      t.querySelectorAll('tbody td').forEach(td => {
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          const re = /[^\\s\\u2010-\\u2014-]+/g; let m;
          while ((m = re.exec(n.data))) {
            if (m[0].length < 3 || m[0].length > 24) continue;
            const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
            const tops = new Set([...rg.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
            if (tops.size > 1) cut.push(which.split('|')[0] + ' ' + which.split('|').pop() + ': "' + m[0] + '" in a ' + Math.round(td.getBoundingClientRect().width) + 'px cell');
          }
        }
      });
    });
    return { seen, cut, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  const missing = v ? heads.filter(h => !v.seen.includes(h)) : heads;
  if (!v || missing.length || v.cut.length || v.overflow > 0) { bad++; console.log(`FAIL 390px ${route} — words cut inside prose cells: ${v ? [...missing.map(h => 'no table "' + h + '"'), ...v.cut.slice(0, 4), ...(v.overflow > 0 ? [`page overflows by ${v.overflow}px`] : [])].join('; ') : 'not measured'}`); }
}
await send('Runtime.evaluate', { expression: `localStorage.removeItem('vl.borrowerProfile'); true` }, sessionId);
/* ---- end bugfix4: misc ---- */
/* ---- bugfix5: views ---- */
/* THE HEATMAP'S LABELS STAY WHOLE. At 390px the colour scale's end labels
   broke "−3.00" above "%" on either side of the ramp (and "−15.0" / "%" on
   three months), and from 360 to 768px the six-button strip crushed its
   label to "Me / asu / re". Each scale end is one line in every mode, and no
   word of a strip's label is cut across two lines. */
for (const w of [360, 390, 768]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
  await send('Page.navigate', { url: BASE + '/discover?tab=heatmap' }, sessionId);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    const p = await send('Runtime.evaluate', { returnByValue: true, expression: `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
    ready = p.result?.result?.value === true;
  }
  await sleep(600);
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const tops = (node, from = 0, to = node.data.length) => { const rg = document.createRange(); rg.setStart(node, from); rg.setEnd(node, to);
      return new Set([...rg.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top))).size; };
    const text = (el) => el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
    const cut = [];
    let ends = 0;
    for (const mode of HEAT_MODES.map(m => m.id)) {
      State.heat.mode = mode; render();
      await new Promise(res => setTimeout(res, 120));
      const item = [...document.querySelectorAll('#views .legend-item')].find(x => x.querySelectorAll(':scope > .metaline').length === 2);
      if (!item) { cut.push(mode + ': no scale legend'); continue; }
      item.querySelectorAll(':scope > .metaline').forEach(s => { ends++; const t = text(s); if (t && tops(t) > 1) cut.push(mode + ' scale end "' + s.textContent + '" on ' + tops(t) + ' lines'); });
      const it = item.getBoundingClientRect(), pr = item.parentElement.getBoundingClientRect();
      if (it.right > pr.right + 0.5) cut.push(mode + ': the scale runs ' + Math.round(it.right - pr.right) + 'px past its card');
    }
    State.heat.mode = 'd1'; render();
    await new Promise(res => setTimeout(res, 120));
    const labels = [...document.querySelectorAll('#views .segmented')].map(s => s.previousElementSibling).filter(x => x && x.matches('span.caption'));
    labels.forEach(l => { const t = text(l); if (!t) return; const re = /\\S+/g; let m;
      while ((m = re.exec(t.data))) if (tops(t, m.index, m.index + m[0].length) > 1) cut.push('strip label "' + m[0] + '" cut across lines'); });
    return { ends, labels: labels.length, cut, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || v.ends !== 12 || v.labels < 2 || v.cut.length || v.overflow > 0) {
    bad++; console.log(`FAIL ${w}px /discover?tab=heatmap — a scale end or strip label is broken across lines: ${v ? [`${v.ends} scale ends, ${v.labels} strip labels measured`, ...v.cut.slice(0, 5), ...(v.overflow > 0 ? [`page overflows by ${v.overflow}px`] : [])].join('; ') : 'not measured'}`);
  }
}
/* ---- end bugfix5: views ---- */
/* ---- bot: pages ---- */
/* THE BOT'S SIGNALS ON A PHONE. "Add your TradingView bot’s signals" is
   the longest run of controls on the setups page — a box of instruments,
   the trade timeframes, fifteen of the script's alerts, two choices and the
   history note — and it is drawn only when opened, so the sweep above
   measured it closed. Open, with two dozen synthetic instruments, at 360
   and 390: nothing runs sideways, every tick box, the disclosure and the
   button are 44px targets, and none sits past the screen's edge. Then the
   pages it leads to — a saved setup with weekly conditions, a record of it
   read on a closed week, and the builder with a condition on a higher
   timeframe and a true-or-false right side — do not run sideways either.
   The engine's bot contract (B1, B4) is stood in for where this build's
   engine lacks it, on synthetic data, and everything is put back. */
for (const w of [360, 390]) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await send('Page.navigate', { url: BASE + '/app/scanner/setups' }, sessionId);
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) {
    await sleep(500);
    const p = await send('Runtime.evaluate', { returnByValue: true, expression: `typeof realPending !== 'undefined' && !realPending && typeof U !== 'undefined' && U.some(r => r.c.real)` }, sessionId);
    ready = p.result?.result?.value === true;
  }
  const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    const wait = (ms) => new Promise(res => setTimeout(res, ms));
    const keep = { h: scanHistoryFile, a: scanAlertsFile, store: localStorage.getItem('vl.scanSetups'), n: window.scanNormaliseNode, bot: JSON.stringify(scanBotState) };
    const stubbed = typeof scanBotPack !== 'function';
    const out = { over: {}, small: [], outside: [] };
    const over = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
    try {
      if (scanNormaliseNode({ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 1 }, timeframe: '1W' }).timeframe !== '1W')
        window.scanNormaliseNode = (node) => { const x = keep.n(node); if (x && x.type === 'condition' && node && node.timeframe != null) x.timeframe = node.timeframe; return x; };
      if (stubbed) {
        const T = ['Trade TF Tier 1 Buy', 'Trade TF Tier 2 Buy', 'Trade TF Tier 1 Sell', 'Trade TF Tier 2 Sell', 'Entry TF Buy', 'Entry TF Sell', 'Entry TF Trade', 'STRONG BUY CONTINUOUS', 'STRONG BUY REVERSAL',
          'STRONG SELL CONTINUOUS', 'STRONG SELL REVERSAL', 'WEAK BUY', 'WEAK SELL', 'ANY STRONG SIGNAL', 'ANY WEAK SIGNAL'];
        window.SCAN_BOT_SIGNALS = T.map(t => ({ id: t.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: t, description: 'The script’s own alert of that name, read on its last closed bars.', needsTradeTimeframe: !/^Entry/.test(t) }));
        window.scanBotPack = ({ symbols = [], tradeTimeframes = [], signals = [], cooldownMode = 'NEW_MATCH' } = {}) => window.SCAN_BOT_SIGNALS.filter(s => signals.includes(s.id)).flatMap(s =>
          (s.needsTradeTimeframe ? tradeTimeframes : ['1D']).map(tf => ({ id: 'mtfbot-' + ({ '1W': 'w', '1M': 'm' }[tf] || 'd') + '-' + s.id, name: 'MTF bot · ' + tf + ' · ' + s.title, enabled: true,
            universe: { kind: 'symbols', symbols }, timeframe: '1D', cooldownMode, ruleTree: { type: 'group', logic: 'ALL', children: [
              { type: 'condition', left: { indicator: 'wavetrend', field: 'wt1' }, op: 'GREATER_THAN', right: { indicator: 'wavetrend', field: 'wt2' }, ...(tf === '1D' ? {} : { timeframe: tf }) },
              { type: 'condition', left: { indicator: 'bot_macd', field: 'histUp' }, op: 'EQUALS', right: { value: 1 }, ...(tf === '1D' ? {} : { timeframe: tf }) },
              { type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'ema', n: 200 } }] } })));
      }
      const series = {}, days = [];
      for (let d = new Date('2026-09-25T00:00:00Z'); days.length < 300; d.setUTCDate(d.getUTCDate() - 1)) if (d.getUTCDay() % 6) days.unshift(d.toISOString().slice(0, 10));
      ['XAUUSD', ...Array.from({ length: 23 }, (_, i) => 'SYNTH' + String.fromCharCode(65 + i) + 'USD')].forEach((sym, si) => { series[sym] = {}; days.forEach((day, i) => { series[sym][day] = 100 + si + Math.sin(i / 7) * 5 + i * 0.05; }); });
      scanHistoryFile = { generated: '2026-09-25T22:00:00Z', series, volume: {} };
      localStorage.removeItem('vl.scanSetups');
      Object.assign(scanBotState, { open: true, symbols: null, tfs: ['1W', '1M'], signals: null, cooldownMode: 'NEW_MATCH', criterion3: 'ema', result: null });
      navigate('/app/scanner/setups'); await wait(250);
      const card = document.querySelector('details.scan-bot');
      out.open = !!card?.open;
      out.over.card = over();
      const targets = [card.querySelector('summary'), ...card.querySelectorAll('label.checkline'), card.querySelector('button[data-scan-focus="bot-create"]')];
      out.targets = targets.length;
      /* Half a pixel of slack: a 44px row laid out at a fractional offset
         measures 43.99 from its rounded edges. */
      targets.forEach(n => { const b = n.getBoundingClientRect();
        if (b.height < 43.5 || b.width < 43.5) out.small.push((n.textContent || '').trim().slice(0, 30) + ' ' + b.width.toFixed(2) + '×' + b.height.toFixed(2));
        if (b.right > innerWidth + 0.5 || b.left < -0.5) out.outside.push((n.textContent || '').trim().slice(0, 30)); });
      card.querySelector('button[data-scan-focus="bot-create"]').click(); await wait(250);
      out.over.saved = over();
      const id = scanBrowserSetups().map(s => s.id).find(x => /^mtfbot-w-/.test(x));
      navigate('/app/scanner/setups/' + id); await wait(200);
      out.over.setup = over();
      const s = scanBrowserSetups().find(x => x.id === id);
      const mc = []; const walk = (n, p) => { if (n.type === 'group') n.children.forEach((c, j) => walk(c, p ? p + '.' + (j + 1) : String(j + 1))); else mc.push({ path: p, text: scanConditionProse(n), state: 'MET', status: 'VALID', left: 1, right: 1, ...(n.timeframe ? { timeframe: n.timeframe, barDate: '2026-09-18' } : {}) }); };
      walk(s.ruleTree, '');
      scanAlertsFile = { alerts: [{ id: 'abf0b07b', key: id + '|k', setupId: id, setupName: s.name, setupVersion: 1, symbol: 'XAUUSD', timeframe: '1D', candleDate: '2026-09-24', close: 101.5, eventType: 'NEW_MATCH', detectedAt: '2026-09-24T22:05:00Z', setupSnapshot: JSON.parse(JSON.stringify(s)), matchedConditions: mc }] };
      navigate('/app/scanner/alerts/abf0b07b'); await wait(200);
      out.over.alert = over();
      scanDraft = null;
      navigate('/app/scanner/setups/new'); await wait(200);
      const pick = async (l, v) => { const x = document.querySelector('main select[aria-label="' + l + '"]'); x.value = v; x.dispatchEvent(new Event('change', { bubbles: true })); await wait(60); };
      await pick('Condition 1: timeframe', '1M');
      await pick('Condition 1: left side', 'wavetrend.crossUp');
      out.over.builder = over();
      scanDraft = null;
      return out;
    } finally {
      window.scanNormaliseNode = keep.n;
      if (stubbed) { delete window.scanBotPack; delete window.SCAN_BOT_SIGNALS; }
      scanHistoryFile = keep.h; scanAlertsFile = keep.a;
      if (keep.store == null) localStorage.removeItem('vl.scanSetups'); else localStorage.setItem('vl.scanSetups', keep.store);
      Object.assign(scanBotState, JSON.parse(keep.bot));
    }
  })()` }, sessionId);
  const v = r.result?.result?.value;
  const wide = v ? Object.entries(v.over).filter(([, x]) => x > 0).map(([k, x]) => `${k} ${x}px`) : [];
  if (!v || !v.open || v.targets < 20 || wide.length || v.small.length || v.outside.length) {
    bad++; console.log(`FAIL ${w}px the bot's signals on the scanner pages — ${v ? [v.open ? `${v.targets} targets measured` : 'the card did not open', ...wide.map(x => `overflow: ${x}`),
      ...v.small.slice(0, 4).map(x => `under 44px: ${x}`), ...v.outside.slice(0, 4).map(x => `past the edge: ${x}`)].join('; ') : `not measured${r.result?.exceptionDetails ? ` (${r.result.exceptionDetails.exception?.description?.split('\n')[0]})` : ''}`}`);
  }
}
/* ---- end bot: pages ---- */
/* ---- release-a: shell ---- */
/* THE TWO CHROMES (Release A). A public page wears the header and an app
   page the sidebar — never both, never neither — at a desktop and a phone
   width; every link the header, its menus, the phone sheet, the sidebar, the
   product tabs and the footer offer opens a route that renders, and Business
   Intelligence, which is not built, is a link or a button nowhere and absent
   from the sidebar; the menus and the sheet open and close from the keyboard
   and hand focus back; the sidebar drawer keeps Tab inside it and closes on
   Escape; and nothing the chrome opens pushes the page sideways at 360, 768,
   1024 or 1440. Keys are real key events (Input.dispatchKeyEvent). */
{
  const KEYS = { Enter: [13, '\r'], Escape: [27, ''], Tab: [9, ''], ArrowDown: [40, ''] };
  const press = async (key, shift = false) => {
    const [vk, text] = KEYS[key];
    const modifiers = shift ? 8 : 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: vk, text, modifiers }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk, modifiers }, sessionId);
    await sleep(120);
  };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  const load = async (path, w, h = 900) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined'`)) break;
    }
    await sleep(300);
  };
  const fails = [];
  const PUBLIC = ['/', '/pricing', '/about', '/contact', '/privacy', '/terms', '/learn', '/learn/glossary', '/methodology', '/data-sources',
    '/corrections', '/learn/product-boundaries', '/status', '/methodology/ips', '/no-such-page'];
  const APP = ['/app', '/research', '/discover/screener', '/discover/value-map', '/compare', '/discover/sarawak', '/us-options/wheel',
    '/company/AAPL-SEC', '/app/scanner', '/app/scanner/alerts', '/research/trading-index', '/property', '/property/areas',
    '/my/watchlists', '/my/alerts', '/my/workspace', '/my/data', '/my/portfolio', '/decision-record', '/welcome', '/start'];
  const chromeProbe = (paths) => `(async () => {
    const shown = (s) => { const n = document.querySelector(s); return !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'; };
    const out = {};
    for (const p of ${JSON.stringify(paths)}) {
      navigate(p); await new Promise(r => setTimeout(r, 40));
      out[p] = { chrome: document.documentElement.dataset.chrome, pub: shown('#pubbar'), side: shown('#sidebar'), bar: shown('#appbar'), view: State.view };
    }
    return out;
  })()`;
  try {
    /* 1. Each chrome on the right views, at 1440 and at 390. */
    for (const w of [1440, 390]) {
      await load('/', w);
      const r = await ev(chromeProbe([...PUBLIC, ...APP]));
      if (!r || r.error) { fails.push(`${w}px chrome probe: ${r?.error || 'no result'}`); continue; }
      for (const p of PUBLIC) {
        const v = r[p];
        if (v.chrome !== 'public' || !v.pub || v.side || v.bar) fails.push(`${w}px ${p} (${v.view}) wears ${JSON.stringify(v)}, not the public header alone`);
      }
      for (const p of APP) {
        const v = r[p];
        const ok = v.chrome === 'app' && !v.pub && (w >= 1024 ? v.side && !v.bar : v.bar && !v.side);
        if (!ok) fails.push(`${w}px ${p} (${v.view}) wears ${JSON.stringify(v)}, not the app chrome`);
      }
    }

    /* 2. Every chrome link opens a route that renders — How it works and the
       research queue included, now that their views have merged. */
    await load('/discover/screener', 1440);
    const links = await ev(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const seen = new Map();
      const take = (sel, where) => document.querySelectorAll(sel).forEach(a => { const p = a.dataset.path || a.getAttribute('href'); if (!seen.has(p)) seen.set(p, where); });
      take('#pubnav a, #pubSheet a', 'header'); take('#appnav a, #sidebar .sb-top a, #appbar a', 'sidebar');
      take('#footProducts a, #footResources a, .footer a', 'footer'); take('#productTabs a', 'equities tabs');
      navigate('/property/areas'); await w(60); take('#productTabs a', 'property tabs');
      const bad = [];
      for (const [p, where] of seen) {
        const rt = matchRoute(p.split('?')[0]);
        if (!rt) { bad.push(where + ' ' + p + ': no route'); continue; }
        if (!VIEWS[rt.view]) { bad.push(where + ' ' + p + ': view ' + rt.view + ' is not defined'); continue; }
        navigate(p); await w(40);
        if (State.view === 'notfound') bad.push(where + ' ' + p + ': the not-found card');
      }
      const things = [...document.querySelectorAll('a, button')].filter(n => /Business Intelligence/.test(n.textContent));
      /* release-a fixes: and on the pages that name it most — the homepage,
         /how-it-works (whose jump list made it a link) and the dashboard. */
      for (const p of ['/', '/how-it-works', '/app']) {
        navigate(p); await w(80);
        [...document.querySelectorAll('a, button')].filter(n => /Business Intelligence/.test(n.textContent)).forEach(n => things.push(n));
      }
      navigate('/property/areas'); await w(80);
      const inSidebar = /Business Intelligence/.test(document.getElementById('sidebar')?.textContent || '');
      const tabsPresent = !!document.querySelector('#productTabs nav[aria-label="Property Intelligence sections"]');
      /* The chrome draws some lists twice (the menu and the phone sheet);
         an id repeated between them breaks every label that points at it. */
      const ids = [...document.querySelectorAll('#pubbar [id], #appbar [id], #sidebar [id], #productTabs [id], footer [id]')].map(n => n.id);
      const dupIds = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))];
      return { n: seen.size, bad, business: things.map(n => n.tagName + ' in ' + (n.closest('[id]')?.id || '?')), inSidebar, tabsPresent, dupIds };
    })()`);
    if (!links || links.error) fails.push(`link walk: ${links?.error || 'no result'}`);
    else {
      if (links.n < 30) fails.push(`only ${links.n} chrome links found — the chrome changed shape`);
      links.bad.forEach(b => fails.push(`a chrome link leads nowhere: ${b}`));
      if (links.business.length) fails.push(`Business Intelligence is a control: ${links.business.join(', ')}`);
      if (links.inSidebar) fails.push('Business Intelligence is in the app sidebar');
      if (!links.tabsPresent) fails.push('the Property product tabs did not render');
      if (links.dupIds.length) fails.push(`ids repeated in the chrome: ${links.dupIds.join(', ')}`);
    }

    /* 3. The header's menus from the keyboard: Enter opens and says so,
       Escape closes and returns focus, ArrowDown opens onto the first link,
       Tab out of the panel closes it, a click outside closes it. */
    await load('/', 1440);
    for (const id of ['menuProducts', 'menuResources']) {
      await ev(`document.getElementById('${id}Btn').focus(); true`);
      await press('Enter');
      const opened = await ev(`({ exp: document.getElementById('${id}Btn').getAttribute('aria-expanded'), shown: !document.getElementById('${id}').hidden && document.getElementById('${id}').getClientRects().length > 0 })`);
      await press('Escape');
      /* Closed means not laid out at all: a panel merely transparent is
         still in the tab order and under the pointer. */
      const closed = await ev(`({ exp: document.getElementById('${id}Btn').getAttribute('aria-expanded'), hidden: document.getElementById('${id}').hidden && !document.getElementById('${id}').getClientRects().length, focus: document.activeElement?.id })`);
      await press('ArrowDown');
      const arrow = await ev(`({ exp: document.getElementById('${id}Btn').getAttribute('aria-expanded'), inside: document.getElementById('${id}').contains(document.activeElement) && document.activeElement.tagName === 'A' })`);
      const count = await ev(`document.querySelectorAll('#${id} a').length`);
      for (let i = 0; i < count + 1; i++) await press('Tab');
      const tabbed = await ev(`({ exp: document.getElementById('${id}Btn').getAttribute('aria-expanded'), hidden: document.getElementById('${id}').hidden && !document.getElementById('${id}').getClientRects().length })`);
      await ev(`document.getElementById('${id}Btn').click(); document.querySelector('main').click(); true`);
      const outside = await ev(`document.getElementById('${id}').hidden && !document.getElementById('${id}').getClientRects().length`);
      if (opened?.exp !== 'true' || !opened.shown) fails.push(`${id}: Enter did not open it: ${JSON.stringify(opened)}`);
      if (closed?.exp !== 'false' || !closed.hidden || closed.focus !== `${id}Btn`) fails.push(`${id}: Escape left ${JSON.stringify(closed)}`);
      if (arrow?.exp !== 'true' || !arrow.inside) fails.push(`${id}: ArrowDown left ${JSON.stringify(arrow)}`);
      if (tabbed?.exp !== 'false' || !tabbed.hidden) fails.push(`${id}: tabbing out left it open`);
      if (outside !== true) fails.push(`${id}: a click outside left it open`);
    }

    /* 4. The phone's sheet, and the sidebar drawer's focus trap. */
    await load('/', 390, 844);
    await ev(`document.getElementById('pubMenuBtn').focus(); true`);
    await press('Enter');
    const sheet = await ev(`({ exp: document.getElementById('pubMenuBtn').getAttribute('aria-expanded'), shown: document.getElementById('pubSheet').getClientRects().length > 0,
      over: document.documentElement.scrollWidth - innerWidth })`);
    /* release-a fixes: the open sheet is a finger's list — every link and
       button in it 44px tall (its Resources links were 36px) — the page behind
       it is inert, and the menu button keeps its name while its icon turns
       to a cross. */
    await sleep(250);
    const sheetT = await ev(`({ small: [...document.querySelectorAll('#pubSheet a, #pubSheet button')].filter(n => n.getClientRects().length && n.getBoundingClientRect().height < 44)
        .map(n => n.textContent.trim() + ' ' + Math.round(n.getBoundingClientRect().height)),
      inert: ['.disclosure', '#main', 'body > .footer'].every(s => document.querySelector(s)?.inert === true),
      label: document.getElementById('pubMenuBtn').getAttribute('aria-label'),
      cross: getComputedStyle(document.querySelector('#pubMenuBtn .ico-close')).display !== 'none' })`);
    if (sheetT?.small?.length) fails.push(`targets under 44px in the open sheet: ${sheetT.small.join(', ')}`);
    if (!sheetT?.inert) fails.push('the page behind the open sheet is not inert');
    if (sheetT?.label !== 'Menu' || !sheetT?.cross) fails.push(`the open sheet's button: ${JSON.stringify(sheetT)}`);
    await press('Escape');
    const sheetClosed = await ev(`({ hidden: document.getElementById('pubSheet').hidden, focus: document.activeElement?.id })`);
    if (sheet?.exp !== 'true' || !sheet.shown) fails.push(`the sheet did not open from the keyboard: ${JSON.stringify(sheet)}`);
    if (sheet?.over > 2) fails.push(`the open sheet pushes the page ${sheet.over}px sideways at 390`);
    if (!sheetClosed?.hidden || sheetClosed.focus !== 'pubMenuBtn') fails.push(`Escape left the sheet ${JSON.stringify(sheetClosed)}`);

    for (const w of [390, 768]) {
      await load('/app/scanner', w, 844);
      await ev(`document.getElementById('navOpen').focus(); true`);
      await press('Enter');
      await sleep(350);
      const open = await ev(`({ modal: document.getElementById('sidebar').getAttribute('aria-modal'), exp: document.getElementById('navOpen').getAttribute('aria-expanded'),
        inside: document.getElementById('sidebar').contains(document.activeElement), n: [...document.getElementById('sidebar').querySelectorAll('a, button')].filter(n => n.getClientRects().length).length,
        over: document.documentElement.scrollWidth - innerWidth })`);
      let escaped = 0;
      for (let i = 0; i < (open?.n || 10) + 3; i++) {
        await press('Tab');
        if (!(await ev(`document.getElementById('sidebar').contains(document.activeElement)`))) escaped++;
      }
      await ev(`document.querySelector('#sidebar .sb-top a').focus(); true`);
      await press('Tab', true);
      const back = await ev(`document.getElementById('sidebar').contains(document.activeElement)`);
      await press('Escape');
      await sleep(350);
      const shut = await ev(`({ exp: document.getElementById('navOpen').getAttribute('aria-expanded'), modal: document.getElementById('sidebar').getAttribute('aria-modal'),
        vis: getComputedStyle(document.getElementById('sidebar')).visibility, focus: document.activeElement?.id })`);
      if (open?.modal !== 'true' || open.exp !== 'true' || !open.inside) fails.push(`${w}px: the drawer opened as ${JSON.stringify(open)}`);
      if (open?.over > 2) fails.push(`${w}px: the open drawer pushes the page ${open.over}px sideways`);
      if (escaped || !back) fails.push(`${w}px: Tab left the open drawer ${escaped} time(s)${back ? '' : ', and Shift+Tab from its first control left it'}`);
      if (shut?.exp !== 'false' || shut.modal || shut.vis !== 'hidden' || shut.focus !== 'navOpen') fails.push(`${w}px: Escape left the drawer ${JSON.stringify(shut)}`);
    }

    /* 5. Nothing the chrome opens pushes the page sideways. */
    for (const [w, path, open] of [[360, '/', 'pubMenuBtn'], [360, '/app/scanner', 'navOpen'], [768, '/', 'pubMenuBtn'], [768, '/discover/screener', 'navOpen'],
      [1024, '/', 'menuResourcesBtn'], [1024, '/discover/screener', null], [1440, '/', 'menuProductsBtn'], [1440, '/property/areas', null]]) {
      await load(path, w);
      if (open) { await ev(`document.getElementById('${open}').click(); true`); await sleep(350); }
      const over = await ev(`document.documentElement.scrollWidth - innerWidth`);
      if (typeof over !== 'number' || over > 2) fails.push(`${w}px ${path}${open ? ` with #${open} open` : ''}: overflow ${over}px`);
    }
    /* 6. Each menu panel sits inside the viewport, measured on the panel itself
       and not only as page overflow — at 1024px the resources panel ran 11px
       past a viewport narrowed by a scrollbar, 38px on CI, whose Linux runner
       has neither Inter nor Segoe and lays the header out in a wider font. So
       the check runs with the page's font AND with Verdana forced, which gives
       the same answer on any machine. */
    for (const w of [1024, 1100]) {
      await load('/', w);
      for (const font of [null, 'Verdana, sans-serif']) {
        const r = await ev(`(async () => {
          const wait = (ms) => new Promise(res => setTimeout(res, ms));
          document.getElementById('probeFont')?.remove();
          ${font ? `const st = document.createElement('style'); st.id = 'probeFont'; st.textContent = 'body, button, a { font-family: ${font} !important; }'; document.head.append(st); await wait(120);` : ''}
          const out = [];
          for (const id of ['menuProductsBtn', 'menuResourcesBtn']) {
            const btn = document.getElementById(id);
            if (!btn || !btn.offsetParent) { out.push(id + ' not shown'); continue; }
            btn.click(); await wait(300);
            const p = document.getElementById(btn.getAttribute('aria-controls')).getBoundingClientRect();
            const vw = document.documentElement.clientWidth;
            if (p.left < 0 || p.right > vw) out.push(id + ' panel ' + Math.round(p.left) + '–' + Math.round(p.right) + ' of ' + vw);
            btn.click(); await wait(250);
          }
          document.getElementById('probeFont')?.remove();
          return out;
        })()`);
        (Array.isArray(r) ? r : [`the menu probe returned ${JSON.stringify(r)}`]).forEach(x => fails.push(`${w}px${font ? ' in Verdana' : ''}: ${x}`));
      }
    }
  } catch (e) { fails.push(`the shell checks threw: ${e.message}`); }
  if (fails.length) { bad++; console.log(`FAIL release-a shell — ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
  else console.log('ok   release-a shell: each chrome on its views at 1440 and 390, every chrome link renders, menus and the sheet work from the keyboard, the drawer traps focus and closes on Escape, no overflow at 360/768/1024/1440, and every menu panel inside the viewport at 1024 and 1100 in the page\'s font and in Verdana');
}
/* ---- /release-a: shell ---- */
/* ---- fixwave: shell ---- */
/* THE SITE HUNT OF 2026-09-29, ON A PHONE (fixwave: shell). Each failed on
   0e1119b: SHELL-06 a Bursa result's "Bursa Main" ran out of its column and
   over the price at 360, 390 and 430; SHELL-10 the decision dock stayed in
   the accessibility tree behind the open navigation drawer, a modal; SHELL-11
   the phone's menu sheet reopened where it had last been scrolled to, with
   Products out of sight. */
{
  const fails = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  const load = async (path, w, h = 844) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined'`) === true) break;
    }
    await sleep(300);
  };
  try {
    /* SHELL-06 — every result row's words stay in their own column. */
    for (const w of [360, 390, 430]) {
      await load('/research', w);
      await ev(`(() => { openSearch(); return true; })()`); await sleep(300);
      await ev(`(() => { searchInput.value = 'bank'; runSearch('bank'); return true; })()`); await sleep(200);
      const r = await ev(`(() => { const rows = [...searchResults.querySelectorAll('button')];
        const over = rows.map(b => { const nm = b.firstElementChild, price = nm.nextElementSibling;
          const right = Math.max(...[...nm.querySelectorAll('*')].map(n => n.getBoundingClientRect().right));
          return { who: nm.textContent.trim().slice(0, 24), past: Math.round(right - nm.getBoundingClientRect().right), onPrice: price ? Math.round(right - price.getBoundingClientRect().left) : 0 }; })
          .filter(x => x.past > 0 || x.onPrice > 0);
        closeSearch({ restore: false }); return { n: rows.length, over }; })()`);
      if (!r || r.error || !r.n) fails.push(`${w}px search for "bank": ${r?.error || 'no rows'}`);
      else r.over.forEach(x => fails.push(`${w}px search: "${x.who}" runs ${x.past}px out of its column, ${x.onPrice}px over the price`));
    }
    /* SHELL-10 — the dock is inert behind the open drawer, and a dock drawn
       while it is open is too; closing it gives the dock back. */
    for (const path of ['/property', '/us-options/wheel']) {
      await load(path, 390);
      await ev(`(() => { document.getElementById('navOpen').click(); return true; })()`); await sleep(350);
      const inert = `(() => { const d = document.querySelector('body > .dock'); return d ? !!d.closest('[inert]') : 'no dock'; })()`;
      const open = await ev(inert);
      await ev(`(() => { render(); return true; })()`); await sleep(150);
      const redrawn = await ev(inert);
      await ev(`(() => { closeNavDrawer(); return true; })()`); await sleep(350);
      const shut = await ev(inert);
      if (open !== true || redrawn !== true || shut !== false) fails.push(`${path} at 390: the dock inert with the drawer open ${open}, after a redraw under it ${redrawn}, after it closed ${shut}`);
    }
    /* SHELL-11 — the sheet opens at its top every time. */
    await load('/about', 390, 700);
    await ev(`(() => { document.getElementById('pubMenuBtn').click(); return true; })()`); await sleep(300);
    const first = await ev(`document.getElementById('pubSheet').scrollTop`);
    await ev(`(() => { const s = document.getElementById('pubSheet'); s.scrollTop = s.scrollHeight; [...s.querySelectorAll('a')].find(a => a.textContent.trim() === 'Terms').click(); return true; })()`);
    await sleep(400);
    await ev(`(() => { document.getElementById('pubMenuBtn').click(); return true; })()`); await sleep(300);
    const again = await ev(`({ top: document.getElementById('pubSheet').scrollTop, path: location.pathname })`);
    await ev(`(() => { closeSheet({ restore: false }); return true; })()`);
    if (first !== 0 || again?.top !== 0 || again?.path !== '/terms') fails.push(`the sheet opened at ${first}px, and reopened on ${again?.path} at ${again?.top}px`);
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  if (fails.length) { bad++; console.log(`FAIL fixwave: shell — ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
  else console.log('ok   fixwave: shell — search results keep their words in their columns at 360, 390 and 430; the dock is inert behind the open drawer, redrawn or not, and back once it closes; the phone sheet reopens at its top');
}
/* ---- end fixwave: shell ---- */
/* ---- fixwave: property ---- */
{
  const evalM = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result?.result?.value;
  const loadAt = async (path, w) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (const t = Date.now(); Date.now() - t < 30000; await sleep(150))
      if (await evalM(`typeof propertyPagesSettled === 'function' && document.readyState === 'complete' && propertyPagesSettled()`) === true) break;
    await sleep(400);
  };
  /* P1 — THE END OF THE FOOTER CAN BE SCROLLED CLEAR OF THE DOCK. The space
     for the fixed decision dock was reserved on #views, above the footer, so
     at the bottom of the page the dock sat on the footer's last lines — the
     legal paragraph's "Nothing here may be used for an investment decision"
     — 143px of it at 390px and 31px at 1440, with nothing left to scroll. */
  {
    const fails = [];
    for (const [path, w, must] of [['/property/calculator', 390, true], ['/property/calculator', 1440, true],
      ['/us-options/wheel', 390, false], ['/research/trading-index', 390, false]]) {
      await loadAt(path, w);
      const r = await evalM(`(async () => {
        const dock = document.querySelector('body > .dock');
        if (!dock) return { dock: false };
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        await new Promise(res => setTimeout(res, 350));
        const legal = document.querySelector('body > .footer .footer-legal') || document.querySelector('body > .footer');
        return { dock: true, end: Math.round(legal.getBoundingClientRect().bottom), top: Math.round(dock.getBoundingClientRect().top) };
      })()`);
      if (!r || !r.dock) { if (must) fails.push(`${w}px ${path}: no dock to measure`); continue; }
      if (r.end > r.top + 1) fails.push(`${w}px ${path}: the footer ends at ${r.end}px, under the dock from ${r.top}px`);
    }
    if (fails.length) { bad++; console.log(`FAIL fixwave P1 — the decision dock covers the end of the footer: ${fails.join('; ')}`); }
    else console.log('ok   fixwave P1: at the bottom of the calculator (390, 1440), the wheel and the Trading Index, the whole footer sits above the dock');
  }
  /* P2, P3 — A SELECT SHOWS WHAT IS CHOSEN IN IT. The demand card's seven
     State selects sat in auto-width table cells beside a 12rem prose column
     and were squashed to their arrow (0px of text at 1440); the evidence
     grades and the owner-statement cadence sat in the rail's 78px value
     column ("Illustra", "month"); on a phone the recorder's "What you
     observed" and "Evidence quality" had half their text, and "Who would be
     selling" 220px for a 385px category. Every option of these must fit
     (the recorder's kind: the chosen one — its longest, "Management or
     service charge (RM/month)", is 270px against the 1440 rail's 200px). */
  {
    const CLIPPED = `(() => {
      const span = document.createElement('span'); span.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;white-space:pre'; document.body.append(span);
      const width = (s, t) => { const cs = getComputedStyle(s); span.style.font = cs.font; span.style.letterSpacing = cs.letterSpacing; span.textContent = t; return span.getBoundingClientRect().width; };
      const room = (s) => { const cs = getComputedStyle(s); return s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (cs.appearance === 'none' ? 0 : 20); };
      const out = []; let n = 0;
      const check = (s, every) => { n++; const r = room(s);
        (every ? [...s.options].map(o => o.textContent) : [s.selectedOptions[0]?.textContent || '']).forEach(t => {
          const need = width(s, t); if (need > r + 1) out.push((s.id || s.getAttribute('aria-label')) + ' "' + t + '" ' + Math.round(need) + 'px in ' + Math.round(r) + 'px'); }); };
      document.querySelectorAll('main select[id^="demand-"], main select[id^="ev-"], main #d-ownerReportCadence').forEach(s => check(s, true));
      ['What you observed', 'Evidence quality'].forEach(l => { const s = document.querySelector('main select[aria-label="' + l + '"]');
        if (s) check(s, l === 'Evidence quality'); else out.push('no "' + l + '" select'); });
      /* And at 1440 the demand table, its states now at their own width,
         still fits its card, so the note beside each is not scrolled away. */
      const dt = document.getElementById('demand-employment')?.closest('table');
      if (innerWidth >= 1440 && dt && dt.getBoundingClientRect().width > dt.closest('.tablewrap').clientWidth + 1)
        out.push('the demand table is ' + Math.round(dt.getBoundingClientRect().width) + 'px in a ' + dt.closest('.tablewrap').clientWidth + 'px card');
      const who = document.getElementById('disposerCategory');
      if (!who) out.push('no "Who would be selling" control');
      else if (who.tagName === 'SELECT') check(who, true);
      else who.querySelectorAll('label').forEach(l => { n++; const b = l.getBoundingClientRect(), c = who.closest('.card').getBoundingClientRect();
        if (l.scrollWidth > l.clientWidth + 1 || b.right > c.right + 1) out.push('"' + l.textContent.trim() + '" runs past its card'); });
      span.remove();
      return { n, out };
    })()`;
    const fails = [];
    for (const w of [1440, 1024, 390, 360]) {
      await loadAt('/property/calculator', w);
      const r = await evalM(CLIPPED);
      if (!r || r.n < 14) fails.push(`${w}px: measured ${r?.n} controls`);
      (r?.out || []).slice(0, 6).forEach(x => fails.push(`${w}px ${x}`));
      if ((r?.out || []).length > 6) fails.push(`${w}px … and ${r.out.length - 6} more`);
    }
    /* The demand table fits its card in a wider font too. With this build's
       font it had 9px to spare at 1440 and CI's Linux runner, which has
       neither Inter nor Segoe, laid it out 52px too wide; Verdana forced
       gives the same answer on any machine. */
    for (const w of [1440, 1024]) {
      await loadAt('/property/calculator', w);
      const r = await evalM(`(() => {
        const st = document.createElement('style'); st.id = 'probeFont';
        st.textContent = 'body, button, a, select, th, td, div, span, p { font-family: Verdana, sans-serif !important; }';
        document.head.append(st);
        document.querySelectorAll('#views details').forEach(d => { d.open = true; });
        const dt = document.getElementById('demand-employment')?.closest('table');
        const out = dt ? { table: Math.round(dt.getBoundingClientRect().width), wrap: dt.closest('.tablewrap').clientWidth } : null;
        st.remove(); return out;
      })()`);
      if (!r) fails.push(`${w}px in Verdana: no demand table`);
      else if (r.table > r.wrap + 1) fails.push(`${w}px in Verdana: the demand table is ${r.table}px in a ${r.wrap}px card`);
    }
    if (fails.length) { bad++; console.log(`FAIL fixwave P2/P3 — a select on the calculator cannot show what is chosen in it:`); fails.slice(0, 24).forEach(f => console.log(`     ${f}`)); }
    else console.log('ok   fixwave P2/P3: the demand states, evidence grades, owner statement, recorder selects and the seller category show their text in full at 1440, 1024, 390 and 360');
  }
}
/* ---- end fixwave: property ---- */
/* ---- audit: content ---- */
/* THE PRICING AND LEGAL PAGES ON A PHONE (launch audit, 29 Sep 2026). The
   "To be supplied" markers sit inside sentences, and the longest of them —
   "To be supplied: Bahasa Malaysia translation" — is wider than a 360px
   card's line: it must wrap inside its card, never push the page sideways
   or run past the card's edge. The draft line on Terms and Privacy is the
   first thing under the heading and must be on the first screen of a phone;
   each plan's preview button is a 44px target; and the pricing lede — no
   payment provider, no refund policy — is shown whole, not clamped to two
   lines as a page's standfirst is on a phone. Measured at 360, 390 and 768
   in light and dark. */
{
  const fails = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  try {
    for (const dark of [false, true]) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
      for (const w of [360, 390, 768]) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
        await send('Page.navigate', { url: BASE + '/privacy' }, sessionId);
        for (let i = 0; i < 40; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined'`) === true) break; }
        const r = await ev(`(async () => {
          const wait = (ms) => new Promise(res => setTimeout(res, ms));
          const out = {};
          for (const p of ['/privacy', '/terms', '/about', '/contact', '/pricing']) {
            navigate(p); await wait(150); scrollTo(0, 0); await wait(50);
            const m = document.querySelector('main');
            const over = Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth);
            const marks = [...m.querySelectorAll('.tbs')];
            const outside = marks.filter(n => { const c = (n.closest('.card') || m).getBoundingClientRect();
              return [...n.getClientRects()].some(b => b.left < c.left - 0.5 || b.right > c.right + 0.5); }).map(n => n.textContent.trim());
            const draft = m.querySelector('.trust-draft');
            const ctas = [...m.querySelectorAll('.plan-cta')].map(b => b.getBoundingClientRect()).filter(b => b.height < 44 || b.width < 44).length;
            const lede = m.querySelector('.page-hd .body-lg');
            out[p] = { over, marks: marks.length, outside, draftTop: draft ? Math.round(draft.getBoundingClientRect().top) : null, ctas,
              clipped: lede ? lede.scrollHeight - lede.clientHeight : null };
          }
          return out;
        })()`);
        if (!r || r.error) { fails.push(`${w}px${dark ? ' dark' : ''}: ${r?.error || 'no result'}`); continue; }
        for (const [p, v] of Object.entries(r)) {
          const at = `${w}px${dark ? ' dark' : ''} ${p}`;
          if (v.over > 2) fails.push(`${at}: overflow ${v.over}px`);
          if (v.outside.length) fails.push(`${at}: markers past their card: ${v.outside.join('; ')}`);
          if (p !== '/pricing' && !v.marks) fails.push(`${at}: no "To be supplied" marker`);
          if ((p === '/privacy' || p === '/terms') && (v.draftTop == null || v.draftTop > 844 - 60)) fails.push(`${at}: the draft line is at ${v.draftTop}px, not on the first screen`);
          if (v.ctas) fails.push(`${at}: ${v.ctas} plan button(s) under 44px`);
          if (p === '/pricing' && !(v.clipped <= 1)) fails.push(`${at}: the lede that says nothing can be bought is clipped by ${v.clipped}px`);
        }
      }
    }
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  if (fails.length) { bad++; console.log(`FAIL audit content — the pricing and legal pages on a phone: ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
  else console.log('ok   audit content: /privacy, /terms, /about, /contact and /pricing at 360, 390 and 768, light and dark — no overflow, every "To be supplied" marker inside its card, the draft line on the first screen, the plan buttons 44px, the pricing lede whole');
}
/* ---- end audit: content ---- */
/* ---- audit: slim ---- */
/* A SCROLL BOX THE KEYBOARD CAN REACH (the quality owner's open item from
   the launch audit). On a phone a table wider than its card scrolls inside
   its box, and a box with nothing focusable in it could not be scrolled from
   the keyboard — axe's scrollable-region-focusable, three times on the
   property calculator at 390px. The shell now makes each such box a named
   region Tab stop after every draw (fitScrollStops, 35-ui.js). Measured here
   at 360 and 390 as axe measures it, not by the marker the shell writes (a
   box the shell marks must still have something to scroll): every box in <main>
   that scrolls by more than 13px on an axis it lets scroll, and is drawn
   (not inside a closed <details>), must be a Tab stop or hold one; a box
   that is a Tab stop only by itself must be a region with a name no other
   region on the page has; Tab reaches it with a visible ring, and the arrow
   keys scroll it. At 1440 the calculator's boxes fit, and none keeps a Tab
   stop it no longer needs. */
{
  const fails = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  const press = async (key, code) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code }, sessionId);
    await sleep(120);
  };
  const MEASURE = `(() => {
    const shown = (n) => (n.checkVisibility ? n.checkVisibility() : n.getClientRects().length > 0);
    const TAB = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]';
    const tabbable = (n) => n.matches(TAB) && n.tabIndex >= 0 && !n.disabled && shown(n);
    const main = document.querySelector('main');
    const who = (n) => n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '') + ' under "' + ((n.closest('.card') || main).querySelector('h1,h2,h3,h4,.h-card')?.textContent || '').trim().slice(0, 40) + '"';
    const unreachable = [], stops = [];
    for (const n of main.querySelectorAll('*')) {
      const x = n.scrollWidth > n.clientWidth + 13, y = n.scrollHeight > n.clientHeight + 13;
      if (!x && !y) continue;
      const s = getComputedStyle(n);
      if (!((x && /^(auto|scroll)$/.test(s.overflowX)) || (y && /^(auto|scroll)$/.test(s.overflowY))) || !shown(n)) continue;
      const inside = [...n.querySelectorAll(TAB)].some(tabbable);
      if (!inside && !tabbable(n)) unreachable.push(who(n) + ' (' + (n.scrollWidth - n.clientWidth) + 'px hidden)');
      else if (!inside) stops.push({ role: n.getAttribute('role'), name: (n.getAttribute('aria-label') || '').trim(), who: who(n) });
    }
    const names = [...main.querySelectorAll('[role="region"]')].map(r => (r.getAttribute('aria-label') || '').trim()).filter(Boolean);
    const twice = names.filter((s, i) => names.indexOf(s) !== i);
    /* The shell marks a box for anything past a pixel of rounding (35-ui.js); one with nothing to scroll to keeps no stop. */
    const marked = [...main.querySelectorAll('[data-scroll-stop]')].filter(n => !(n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1)).map(who);
    return { unreachable, stops, twice, marked };
  })()`;
  const PAGES = ['/property/calculator', '/company/aapl-apple-inc?tab=financials', '/discover/screener', '/methodology/ips', '/data-sources', '/us-options/wheel'];
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    let total = 0;
    for (const w of [360, 390]) for (const p of PAGES) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
      await send('Page.navigate', { url: BASE + p }, sessionId);
      for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`) === true) break; }
      await sleep(900);
      const r = await ev(MEASURE);
      if (!r || r.error) { fails.push(`${w} ${p}: ${r?.error || 'not measured'}`); continue; }
      total += r.stops.length;
      r.unreachable.forEach(u => fails.push(`${w} ${p}: a box scrolls and the keyboard cannot reach it — ${u}`));
      r.stops.filter(s => s.role !== 'region' || !s.name).forEach(s => fails.push(`${w} ${p}: a scroll box is a Tab stop with ${s.role ? `role ${s.role}` : 'no role'} and ${s.name ? `the name "${s.name}"` : 'no name'} — ${s.who}`));
      r.twice.forEach(n => fails.push(`${w} ${p}: two regions are both called "${n}"`));
      r.marked.forEach(n => fails.push(`${w} ${p}: kept as a scroll stop though it no longer scrolls — ${n}`));
    }
    /* The calculator's first such box, by keyboard: Tab from the stop before
       it lands on it with a visible ring, and ArrowRight scrolls it. */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send('Page.navigate', { url: BASE + '/property/calculator' }, sessionId);
    for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`) === true) break; }
    await sleep(900);
    const prep = await ev(`(() => {
      const shown = (n) => (n.checkVisibility ? n.checkVisibility() : n.getClientRects().length > 0);
      const TAB = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]';
      const tabbable = (n) => n.matches(TAB) && n.tabIndex >= 0 && !n.disabled && shown(n);
      const box = [...document.querySelectorAll('main [role="region"][tabindex="0"]')].find(n => n.scrollWidth > n.clientWidth + 13 && shown(n) && ![...n.querySelectorAll(TAB)].some(tabbable));
      if (!box) return { error: 'no scroll box that is a Tab stop by itself on the calculator at 390' };
      const order = [...document.querySelectorAll(TAB)].filter(tabbable);
      const before = order[order.indexOf(box) - 1];
      box.dataset.slimProbe = '1';
      document.documentElement.style.scrollBehavior = 'auto';
      before.focus();
      return { name: box.getAttribute('aria-label') };
    })()`);
    if (!prep || prep.error) fails.push(`390 /property/calculator keyboard: ${prep?.error || 'not measured'}`);
    else {
      await press('Tab', 9);
      await sleep(250);
      const at = await ev(`(() => { const a = document.activeElement; const s = getComputedStyle(a);
        return { on: a.dataset.slimProbe === '1', ring: a.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, outline: s.outlineStyle + ' ' + s.outlineWidth, left: a.scrollLeft }; })()`);
      if (!at?.on) fails.push(`390 /property/calculator: Tab from the control before "${prep.name}" did not land on it`);
      else {
        if (!at.ring) fails.push(`390 /property/calculator: "${prep.name}" takes focus with no visible ring (${at.outline})`);
        for (let k = 0; k < 3; k++) await press('ArrowRight', 39);
        await sleep(300);
        const left = await ev(`document.activeElement.scrollLeft`);
        if (!(left > at.left)) fails.push(`390 /property/calculator: ArrowRight on "${prep.name}" did not scroll it (${at.left} → ${left})`);
      }
    }
    /* Wider: the same page's boxes fit, and give their Tab stops back. */
    await ev(`document.activeElement?.blur(); true`);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(800);
    const wide = await ev(MEASURE);
    if (!wide || wide.error) fails.push(`1440 /property/calculator: ${wide?.error || 'not measured'}`);
    else {
      wide.unreachable.forEach(u => fails.push(`1440 /property/calculator: a box scrolls and the keyboard cannot reach it — ${u}`));
      wide.marked.forEach(n => fails.push(`1440 /property/calculator: kept as a scroll stop though it no longer scrolls — ${n}`));
    }
    /* THE DRAWER (slim verification). It sits outside <main>, and its boxes
       were never made Tab stops: a metric's definition is a body of text
       taller than the drawer at 360x640 and at 1440x900, and a derived
       line's "Inputs" table is wider than the drawer at every width, with
       nothing in either to focus. The drawer keeps Tab among the stops it
       finds (95-boot.js), which a box that is a Tab stop only by the
       browser's own rule is not, so on a company with no filing links Tab
       went from the close button to the close button, and the arrow keys
       scrolled the page behind. Every metric definition and a spread of
       statement cells on a filed and an illustrative company are opened
       here; each box in the drawer, its body included, that scrolls with
       nothing to focus must be a named region Tab stop — called ", table"
       only when it is a table's frame, not a body with a table somewhere
       in it — and none may keep a stop with nothing to scroll to. Then by keyboard: Tab from the close
       button reaches the Inputs table with a ring, ArrowRight scrolls it,
       and Tab and Shift+Tab stay in the drawer. */
    const DRAWER = `(() => {
      const TAB = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [contenteditable]:not([contenteditable="false"]), [tabindex]';
      const shown = (n) => (n.checkVisibility ? n.checkVisibility() : n.getClientRects().length > 0);
      const root = document.getElementById('drawerBody');
      const out = { unreachable: [], unnamed: [], misnamed: [], marked: [], stops: 0 };
      for (const n of [root, ...root.querySelectorAll('*')]) {
        const x = n.scrollWidth > n.clientWidth + 13, y = n.scrollHeight > n.clientHeight + 13;
        const s = getComputedStyle(n);
        const scrolls = ((x && /^(auto|scroll)$/.test(s.overflowX)) || (y && /^(auto|scroll)$/.test(s.overflowY))) && shown(n);
        const who = (n.id || n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0]) + ' in "' + document.getElementById('drawerTitle').textContent + '"';
        if (n.dataset.scrollStop !== undefined && !(n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1)) out.marked.push(who);
        if (!scrolls || [...n.querySelectorAll(TAB)].some(k => k.tabIndex >= 0 && !k.disabled && shown(k))) continue;
        if (n.tabIndex < 0) out.unreachable.push(who + ' (' + Math.max(n.scrollWidth - n.clientWidth, n.scrollHeight - n.clientHeight) + 'px hidden)');
        else if (n.getAttribute('role') !== 'region' || !n.getAttribute('aria-label')) out.unnamed.push(who);
        else {
          out.stops++;
          /* ", table" says the box is a table's frame; a box that holds more
             than the table (the drawer's body) must not say it. */
          const t = n.querySelector('table');
          let framed = !!t;
          for (let p = t; framed && p && p !== n; p = p.parentElement) if (p.parentElement.children.length !== 1) framed = false;
          if (/, table( \\d+ of \\d+)?$/.test(n.getAttribute('aria-label')) !== framed) out.misnamed.push(who + ' named "' + n.getAttribute('aria-label') + '", though it ' + (framed ? 'is' : 'is not') + " a table's frame");
        }
      }
      return out;
    })()`;
    let drawers = 0, drawerStops = 0;
    for (const [w, h] of [[360, 640], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
      const opens = [];
      await send('Page.navigate', { url: BASE + '/discover/screener' }, sessionId);
      for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`) === true) break; }
      await sleep(600);
      const nf = await ev(`FIELDS.length`);
      for (let i = 0; i < nf; i++) opens.push([`metric ${i}`, `openMetricInfo(FIELDS[${i}]); true`]);
      const measureAll = async (list) => {
        for (const [what, open] of list) {
          const o = await ev(open);
          if (o !== true) { fails.push(`${w} drawer ${what}: not opened (${o?.error || o})`); continue; }
          await sleep(60);
          const r = await ev(DRAWER);
          if (!r || r.error) { fails.push(`${w} drawer ${what}: ${r?.error || 'not measured'}`); continue; }
          drawers++; drawerStops += r.stops;
          r.unreachable.forEach(u => fails.push(`${w} drawer ${what}: a box scrolls and the keyboard cannot reach it — ${u}`));
          r.unnamed.forEach(u => fails.push(`${w} drawer ${what}: a scroll box is a Tab stop with no role or name — ${u}`));
          r.misnamed.forEach(u => fails.push(`${w} drawer ${what}: a Tab stop says it is what it is not — ${u}`));
          r.marked.forEach(u => fails.push(`${w} drawer ${what}: kept as a scroll stop though it no longer scrolls — ${u}`));
        }
      };
      await measureAll(opens);
      for (const co of ['aapl-apple-inc', 'MAYBANK']) {
        await send('Page.navigate', { url: `${BASE}/company/${co}?tab=financials` }, sessionId);
        for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`) === true) break; }
        await sleep(600);
        const nc = await ev(`document.querySelectorAll('td.cell-sourced').length`);
        if (!(nc > 0)) { fails.push(`${w} /company/${co}?tab=financials: no statement cell to open`); continue; }
        const cells = [];
        for (let i = 0; i < nc; i += Math.max(1, Math.floor(nc / 20))) cells.push([`${co} cell ${i}`, `(() => { document.querySelectorAll('td.cell-sourced')[${i}].click(); return true; })()`]);
        await measureAll(cells);
      }
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send('Page.navigate', { url: BASE + '/company/MAYBANK?tab=financials' }, sessionId);
    for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`) === true) break; }
    await sleep(600);
    const derived = await ev(`(() => { const td = [...document.querySelectorAll('td.cell-sourced')].find(t => /derived/.test(t.parentElement.textContent)); if (!td) return false; td.focus(); td.click(); return true; })()`);
    await sleep(400);
    const where = () => ev(`(() => { const a = document.activeElement, s = getComputedStyle(a); return { name: a.getAttribute('aria-label'), inDrawer: document.getElementById('drawer').contains(a), ring: a.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, left: a.scrollLeft }; })()`);
    let inputs = null;
    const path = [];
    if (derived !== true) fails.push('390 /company/MAYBANK?tab=financials: no derived line to open');
    else {
      for (let i = 0; i < 6 && !inputs; i++) {
        await press('Tab', 9);
        const k = await where();
        path.push(k?.name || '?');
        if (k?.name === 'Inputs, table') inputs = k;
      }
      if (!inputs) fails.push(`390 drawer "Inputs": Tab from the close button never reached the table (${path.join(' → ')})`);
      else {
        if (!inputs.ring) fails.push('390 drawer "Inputs": the table takes focus with no visible ring');
        for (let k = 0; k < 2; k++) await press('ArrowRight', 39);
        await sleep(300);
        if (!((await where())?.left > inputs.left)) fails.push('390 drawer "Inputs": ArrowRight did not scroll the table');
        await press('Tab', 9);
        if (!(await where())?.inDrawer) fails.push('390 drawer "Inputs": Tab from the table left the drawer');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 }, sessionId);
        await sleep(150);
        if ((await where())?.name !== 'Inputs, table') fails.push('390 drawer "Inputs": Shift+Tab did not return to the table');
      }
    }
    if (!drawerStops) fails.push('no drawer box needed a Tab stop, so none was tested');
    if (!total) fails.push('no scroll box needed a Tab stop on any page at 390, so none was tested');
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    if (!fails.length) console.log(`ok   audit slim: at 360 and 390 every scroll box on ${PAGES.length} pages is a Tab stop or holds one — ${total} named regions over both widths, no name twice; Tab reaches the calculator's "${prep?.name}" with a ring and ArrowRight scrolls it; at 1440 none keeps a stop it no longer needs; in ${drawers} drawers at 360 and 1440 every box that scrolls with nothing to focus is a named stop (${drawerStops}), and Tab from the close button reaches a derived line's "Inputs" table, which ArrowRight scrolls, without leaving the drawer`);
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  if (fails.length) { bad++; console.log(`FAIL audit slim — a scroll box the keyboard cannot reach, or a Tab stop with no name: ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
}
/* ---- end audit: slim ---- */
/* ---- audit1: property-model ---- */
/* MY PROPERTIES AND THE SECTIONED CALCULATOR, AT EVERY WIDTH (daily audit
   #1, item 7). /property/models lists saved properties in a table-like grid
   that stacks on a phone, and the calculator gained a bar that says which
   property is on it, a sticky row of five section links and a scenarios
   comparison. With two saved properties — one with a long name and two
   scenarios, compared — and an unsaved change on the calculator: no
   horizontal overflow at 360, 390, 768, 1024 or 1440, light and dark; on a
   phone every control in the bar, the list and the scenarios is 44px on
   both axes, and each section link too; the index stays one row that
   scrolls inside itself; and the comparison scrolls in its own box. */
{
  const fails = [];
  const seed = `(() => {
    const base = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: { price: true }, price: 598000 };
    const at = '2026-09-30T02:00:00.000Z';
    const rec = (id, name, deal, scenarios) => ({ id, kind: 'property', name, createdAt: at, updatedAt: at, savedAt: '2026-09-30 02:00',
      modelVersion: MODEL_VERSION, asOf: AS_OF, editor: 'this browser', stamp: buildStamp('property'), payload: { deal }, scenarios });
    const list = [
      rec('w-property-a1m-long', 'Riveria Park Residences, block C, level 17, the corner unit facing the river — second viewing', base,
        [{ id: 'sc-a1m-1', name: 'Rent at the top of the observed range', overrides: { rent: 2200 }, createdAt: at, updatedAt: at },
         { id: 'sc-a1m-2', name: 'Rate up one point and a longer vacancy', overrides: { ratePct: 5.3, vacancyPct: 14 }, createdAt: at, updatedAt: at }]),
      rec('w-property-a1m-b', 'Lanang terrace', { ...base, city: 'sibu', district: 'Lanang', projectId: 'custom-sibu', price: 455000 }, []),
    ];
    localStorage.setItem('vl.savedWork', JSON.stringify(list));
    localStorage.setItem('vl.deal', JSON.stringify({ ...base, rent: 1990, modelId: 'w-property-a1m-long', scenarioId: null }));
    return true;
  })()`;
  const kept = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({ w: localStorage.getItem('vl.savedWork'), d: localStorage.getItem('vl.deal') })` }, sessionId);
  try {
    let seeded = false, measured = 0;
    for (const dark of [false, true]) for (const w of [360, 390, 768, 1024, 1440]) {
      if (dark && ![390, 1440].includes(w)) continue;
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
      for (const path of ['/property/models', '/property/calculator']) {
        await send('Page.navigate', { url: BASE + path }, sessionId);
        await sleep(1500);
        if (!seeded) {
          await send('Runtime.evaluate', { expression: `localStorage.removeItem('vl.theme'); ${seed}` }, sessionId);
          seeded = true;
          await send('Page.navigate', { url: BASE + path }, sessionId);
          await sleep(1500);
        }
        const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
          const w = (ms) => new Promise(res => setTimeout(res, ms));
          for (let i = 0; i < 40 && !(typeof propertyPagesSettled === 'function' && propertyPagesSettled()); i++) await w(150);
          if (State.view === 'property') { PM_COMPARE['w-property-a1m-long'] = ['base', 'sc-a1m-1', 'sc-a1m-2']; render(); await w(300); }
          const small = (sel) => [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length).map(n => { const b = n.getBoundingClientRect();
            return { t: (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 28), w: Math.round(b.width), h: Math.round(b.height) }; })
            .filter(b => Math.min(b.w, b.h) < 44);
          const idx = document.querySelector('.pc-index-list');
          const cmp = document.querySelector('.pm-sc-table');
          let box = cmp && cmp.parentElement;
          return {
            view: State.view, over: document.documentElement.scrollWidth - innerWidth,
            small: innerWidth < 768 ? small('main .pm-bar button, main .pm-bar a, main .pm-bar select, main .pm-row button, main .pm-scenarios button, main .pc-index-link') : [],
            idx: idx ? { rows: new Set([...idx.children].map(li => Math.round(li.getBoundingClientRect().top))).size, scrolls: getComputedStyle(idx).overflowX } : null,
            cmp: cmp ? { cols: cmp.querySelectorAll('thead th').length, boxScrolls: !!box && getComputedStyle(box).overflowX === 'auto', inBox: !!box && box.getBoundingClientRect().right <= innerWidth + 1 } : null,
            rows: document.querySelectorAll('main .pm-list .pm-row:not(.pm-head)').length,
            /* audit1/property-model-verify: the figures are labelled — on screen
               where no column head names them (the Not saved card), and to a
               screen reader everywhere (the list's head is hidden from it). */
            loose: [...document.querySelectorAll('main .pm-loose .pm-label')].map(n => Math.round(n.getBoundingClientRect().height)),
            listed: [...document.querySelectorAll('main .pm-list:not(.pm-loose) .pm-row:not(.pm-head) .pm-label')].map(n => getComputedStyle(n).display),
            fits: box ? box.scrollWidth - box.clientWidth : null,
          };
        })()` }, sessionId);
        const v = r.result?.result?.value;
        const at = `${w}px${dark ? ' dark' : ''} ${path}`;
        if (!v) { fails.push(`${at}: could not be measured`); continue; }
        measured++;
        if (v.over > 2) fails.push(`${at}: overflows by ${v.over}px`);
        v.small.forEach(s => fails.push(`${at}: "${s.t}" is ${s.w}×${s.h}px, under 44px`));
        if (path === '/property/models' && v.rows < 3) fails.push(`${at}: ${v.rows} rows (two properties and the sample expected)`);
        if (path === '/property/models' && (!v.loose.length || v.loose.some(h => h < 8))) fails.push(`${at}: the Not saved card's figures are unlabelled on screen (label heights ${JSON.stringify(v.loose)})`);
        if (path === '/property/models' && (!v.listed.length || v.listed.some(d => d === 'none'))) fails.push(`${at}: a saved property's figures have no label a screen reader reads (${[...new Set(v.listed)].join(', ') || 'none drawn'})`);
        /* On a desktop the three columns are set side by side, not behind a
           scroll: at 1440 the third was cut at its heading. */
        if (path === '/property/calculator' && w >= 1440 && v.fits > 1) fails.push(`${at}: the three-column comparison needs ${v.fits}px of sideways scrolling`);
        if (path === '/property/calculator') {
          if (!v.idx || v.idx.rows !== 1 || v.idx.scrolls !== 'auto') fails.push(`${at}: the section index is ${JSON.stringify(v.idx)}`);
          if (!v.cmp || v.cmp.cols !== 4 || !v.cmp.boxScrolls || !v.cmp.inBox) fails.push(`${at}: the scenarios comparison is ${JSON.stringify(v.cmp)}`);
        }
      }
    }
    /* The list's heading, which a save from the Not saved card hands the
       keyboard to, shows it has it: its outline was removed with nothing in
       its place. Keyboard first (a Tab), so a scripted focus is a visible one. */
    {
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 860, deviceScaleFactor: 1, mobile: false }, sessionId);
      await send('Page.navigate', { url: BASE + '/property/models' }, sessionId);
      await sleep(1500);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const h = document.getElementById('pm-list-hd'); if (!h) return null; h.focus();
        const cs = getComputedStyle(h); return { fv: h.matches(':focus-visible'), outline: cs.outlineStyle, ow: parseFloat(cs.outlineWidth) || 0, shadow: cs.boxShadow }; })()` }, sessionId);
      const v = r.result?.result?.value;
      if (!v || !v.fv || ((v.outline === 'none' || !v.ow) && (!v.shadow || v.shadow === 'none'))) fails.push(`1440px /property/models: the list heading given the keyboard shows no focus (${JSON.stringify(v)})`);
    }
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    if (!fails.length) console.log(`ok   audit1 property-model: /property/models and the sectioned calculator at 360, 390, 768, 1024 and 1440 (light) and 390 and 1440 (dark), ${measured} pages — no overflow, the bar's, the list's, the scenarios' controls and the section links 44px on a phone, the index one row that scrolls in itself, the three-column comparison in its own scroll box (side by side without one at 1440); every figure on My properties labelled, and its list heading visibly focused`);
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    const k = JSON.parse(kept.result?.result?.value || '{}');
    await send('Runtime.evaluate', { expression: `(() => { const k = ${JSON.stringify(k)}; const put = (key, v) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v); put('savedWork', k.w); put('deal', k.d); return true; })()` }, sessionId);
  }
  if (fails.length) { bad++; console.log(`FAIL audit1 property-model — My properties or the sectioned calculator at some width: ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
}
/* ---- end audit1: property-model ---- */
} catch (e) {
  /* An exception mid-loop is a failed run, and the browser must still die. */
  bad++; console.log(`FAIL harness error — ${e.message}`);
} finally {
  try { ws.close(); } catch { /* closed */ }
  proc.kill();
  /* Chrome holds its profile for a moment after the kill, and its child
     processes a moment longer. Removed at once, the rm failed quietly on
     Windows, and every run left its profile in TEMP: 1,781 of them, 14 GB,
     had filled C: by 28 September 2026 and parallel runs were failing with
     ENOSPC. Wait for the exit, then retry the removal. */
  await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}
console.log(bad ? `\n${bad} genuine issues (overflow or hidden focus)` : '\nno horizontal overflow at any width, and no focus stop hidden');
if (smallTargets.length) {
  console.log('\ntap targets under 44px on either axis, on phone widths (reported, not failed):');
  smallTargets.sort((a, b) => b.n - a.n).slice(0, 12)
    .forEach(s => console.log(`  ${s.w}px ${s.route} — ${s.n}${s.who.length ? ': ' + s.who.join('; ') : ''}`));
  if (smallTargets.length > 12) console.log(`  … and ${smallTargets.length - 12} more route/width pairs`);
}
process.exitCode = bad ? 1 : 0;
