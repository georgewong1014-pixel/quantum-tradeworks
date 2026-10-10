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
                '/admin/scanner', '/admin/scanner/jobs', '/admin/scanner/data',
                /* The Scenario Lab (3 Oct 2026): its sample, and the Location
                   comparison, the one view of facts in sentences. */
                '/property/lab', '/property/lab?by=location',
                /* Property's landing, the Lab with its identity line and four
                   tiles over the sliders (N3, D18). */
                '/property',
                /* The property landing for search (10 Oct 2026). */
                '/property-investing'];

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
/* THE RECORDED JOURNEYS' LINKS, 44PX EACH WAY (N1c, N1e). /status's
   "public log" and the "details" beside each product's badge are links in
   a sentence; on a phone each answers a finger across 44px, and the line it
   sits in keeps its height. */
for (const path of ['/status', '/property', '/research', '/app/scanner']) {
  await send('Page.navigate', { url: BASE + path }, sessionId);
  await sleep(2500);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const links = [...document.querySelectorAll('main .journeys-log, main .journey-line-link')];
    const small = links.filter(a => { const b = a.getBoundingClientRect(); return b.width < 44 || b.height < 44; })
      .map(a => a.textContent + ' ' + Math.round(a.getBoundingClientRect().width) + '×' + Math.round(a.getBoundingClientRect().height) + 'px');
    return { n: links.length, small };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || !v.n || v.small.length) { bad++; console.log(`FAIL 390px ${path} — the recorded journeys' links under 44px: ${v ? [...new Set(v.small)].join('; ') || 'no links found' : 'not measured'}`); }
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
    '/company/AAPL-SEC', '/app/scanner', '/app/scanner/alerts', '/research/trading-index', '/property', '/property/calculator', '/property/areas',
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
    for (const path of ['/property/calculator', '/us-options/wheel']) {
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
/* ---- releaseB: alerts-reports ---- */
/* MY ALERTS AND REPORTS, AT EVERY WIDTH (Release B, B1 and B2). /my/alerts
   with a scanner record of five matches — one read, one from a muted setup,
   one archived, one with a long setup name — beside the research feed, in
   each of its three kinds; and /my/reports with the reader's own work: two
   companies opened, one on a list of their own, a saved property with a long
   name, a Cash Wheel contract and Trading Index chart evidence. At 360, 390,
   768, 1024 and 1440 in light, and 390 and 1440 in dark: no horizontal
   overflow, and on a phone every kind button, scanner row, section link and
   report control a 44px target. */
{
  const fails = [];
  const record = `{ alerts: [
    { id: 'arbM0001', key: 'rbM|1', setupId: 'rb-on', setupName: 'Close above the 20-day average after three weeks under it, on a rising 50-day', setupVersion: 3, symbol: 'AAPL', timeframe: '1D', candleDate: '2026-09-21', close: 231.4, eventType: 'NEW_MATCH', detectedAt: '2026-09-21T22:00:00Z' },
    { id: 'arbM0002', key: 'rbM|2', setupId: 'rb-on', setupName: 'Close above the 20-day', setupVersion: 3, symbol: 'MSFT', timeframe: '1D', candleDate: '2026-09-22', close: 512.1, eventType: 'MATCH', detectedAt: '2026-09-22T22:00:00Z' },
    { id: 'arbM0003', key: 'rbM|3', setupId: 'rb-on', setupName: 'Close above the 20-day', setupVersion: 3, symbol: 'BRK-B', timeframe: '1D', candleDate: '2026-09-23', close: 470.2, eventType: 'FIRST_OBSERVED', detectedAt: '2026-09-23T22:00:00Z' },
    { id: 'arbM0004', key: 'rbM|4', setupId: 'rb-muted', setupName: 'Muted one', setupVersion: 1, symbol: 'KO', timeframe: '1D', candleDate: '2026-09-24', close: 69.9, eventType: 'NEW_MATCH', detectedAt: '2026-09-24T22:00:00Z' },
    { id: 'arbM0005', key: 'rbM|5', setupId: 'rb-on', setupName: 'Close above the 20-day', setupVersion: 3, symbol: 'PEP', timeframe: '1D', candleDate: '2026-09-20', close: 150.3, eventType: 'NEW_MATCH', detectedAt: '2026-09-20T22:00:00Z' }] }`;
  const seed = `(() => {
    const now = new Date().toISOString(), at = '2026-09-30T02:00:00.000Z';
    const pick = (...ids) => ids.find(id => BY_ID.has(id)) || ids[0];
    localStorage.setItem('vl.recentCompanies', JSON.stringify([pick('MSFT-SEC', 'AAPL-SEC'), 'MAYBANK']));
    const listed = pick('KO-SEC', 'NVDA-SEC');
    localStorage.setItem('vl.watchlists', JSON.stringify([...(State.watchlists || []), { id: 'wl-rbm', name: 'A list of my own with a longer name than most', ids: [listed], added: { [listed]: now }, createdAt: now, updatedAt: now, schema: WATCHLIST_SCHEMA }]));
    const deal = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: { price: true }, price: 598000 };
    localStorage.setItem('vl.savedWork', JSON.stringify([{ id: 'w-property-rbm-1', kind: 'property', name: 'Riveria Park Residences, block C, level 17, the corner unit facing the river — second viewing', createdAt: at, updatedAt: at, savedAt: '2026-09-30 02:00',
      modelVersion: MODEL_VERSION, asOf: AS_OF, editor: 'this browser', stamp: buildStamp('property'), payload: { deal }, scenarios: [{ id: 'sc-rbm-1', name: 'Rent at the top of the range', overrides: { rent: 2200 }, createdAt: at, updatedAt: at }] }]));
    localStorage.setItem('vl.wheelPlan', JSON.stringify({ ...State.wheel, symbol: 'KO', putStrike: 55, putCredit: 1.2, isWorkedExample: false }));
    localStorage.setItem('vl.qttiPlan', JSON.stringify({ ...qttiWorkedExample(), symbol: 'BTC / USDC Perpetual Contract, my own reading' }));
    localStorage.setItem('vl.plan', JSON.stringify('free'));
    localStorage.setItem('vl.scanAlertState', JSON.stringify({ arbM0002: 'READ', arbM0005: 'ARCHIVED' }));
    localStorage.setItem('vl.scanPrefs', JSON.stringify({ inApp: true, muted: { 'rb-muted': true } }));
    return true;
  })()`;
  const KEYS = ['recentCompanies', 'watchlists', 'savedWork', 'wheelPlan', 'qttiPlan', 'plan', 'scanAlertState', 'scanPrefs', 'theme', 'deal', 'dealBeforeLink'];
  const kept = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify(Object.fromEntries(${JSON.stringify(KEYS)}.map(k => [k, localStorage.getItem('vl.' + k)])))` }, sessionId);
  try {
    let seeded = false, measured = 0;
    for (const dark of [false, true]) for (const w of [360, 390, 768, 1024, 1440]) {
      if (dark && ![390, 1440].includes(w)) continue;
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 860, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
      for (const path of ['/my/alerts', '/my/alerts?kind=scanner', '/my/reports']) {
        await send('Page.navigate', { url: BASE + path }, sessionId);
        await sleep(1500);
        if (!seeded) {
          await send('Runtime.evaluate', { awaitPromise: true, expression: `(async () => { for (let i = 0; i < 60 && (typeof realPending === 'undefined' || realPending); i++) await new Promise(r => setTimeout(r, 150)); localStorage.removeItem('vl.theme'); return ${seed}; })()` }, sessionId);
          seeded = true;
          await send('Page.navigate', { url: BASE + path }, sessionId);
          await sleep(1500);
        }
        const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
          const w = (ms) => new Promise(res => setTimeout(res, ms));
          for (let i = 0; i < 60 && (typeof realPending === 'undefined' || realPending); i++) await w(150);
          if (State.view === 'alerts') { scanAlertsFile = ${record}; render(); await w(300); }
          const small = (sel) => [...document.querySelectorAll(sel)].filter(n => n.getClientRects().length).map(n => { const b = n.getBoundingClientRect();
            return { t: (n.textContent || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 32), w: Math.round(b.width), h: Math.round(b.height) }; })
            .filter(b => Math.min(b.w, b.h) < 44);
          const TARGETS = '#views [aria-label="Show alerts of one kind"] button, #al-scanner a.al-scan-row, #al-scanner a.btn, #al-scanner .al-foot a, '
            + '#views .rp-row a, #views .rp-row button, #views .rp-sec a.btn, #views .rp-sec button.btn, #rp-empty .btn';
          return { view: State.view, over: document.documentElement.scrollWidth - innerWidth,
            small: innerWidth < 768 ? small(TARGETS) : [],
            scanRows: document.querySelectorAll('#al-scanner a.al-scan-row').length,
            rpRows: document.querySelectorAll('#views .rp-row').length,
            clipped: [...document.querySelectorAll('#views .al-scan-row, #views .rp-row')].filter(n => n.getBoundingClientRect().right > innerWidth + 1).length };
        })()` }, sessionId);
        const v = r.result?.result?.value;
        const at = `${w}px${dark ? ' dark' : ''} ${path}`;
        if (!v) { fails.push(`${at}: could not be measured`); continue; }
        measured++;
        if (v.view !== (path.startsWith('/my/reports') ? 'reports' : 'alerts')) { fails.push(`${at}: opens ${v.view}`); continue; }
        if (v.over > 2) fails.push(`${at}: overflows by ${v.over}px`);
        if (v.clipped) fails.push(`${at}: ${v.clipped} rows run past the right edge`);
        v.small.forEach(s => fails.push(`${at}: "${s.t}" is ${s.w}×${s.h}px, under 44px`));
        if (path.startsWith('/my/alerts') && v.scanRows !== 4) fails.push(`${at}: ${v.scanRows} scanner rows, not the 4 not archived`);
        if (path === '/my/reports' && v.rpRows < 6) fails.push(`${at}: ${v.rpRows} report rows (three companies, a property, the wheel and the chart expected)`);
      }
    }
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    if (!fails.length) console.log(`ok   releaseB alerts-reports: /my/alerts (all kinds, and the scanner's alone) and /my/reports at 360, 390, 768, 1024 and 1440 (light) and 390 and 1440 (dark), ${measured} pages — no overflow, no row past the edge, and every kind button, scanner row and report control 44px on a phone`);
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    const k = JSON.parse(kept.result?.result?.value || '{}');
    await send('Runtime.evaluate', { expression: `(() => { const k = ${JSON.stringify(k)}; Object.entries(k).forEach(([key, v]) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v)); return true; })()` }, sessionId);
  }
  if (fails.length) { bad++; console.log(`FAIL releaseB alerts-reports — My Alerts or Reports at some width: ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
}
/* ---- end releaseB: alerts-reports ---- */
/* ---- releaseB: small-backlog ---- */
/* E5 — A FOCUS RING THE DRAWER CUTS OFF. The drawer (a metric's definition,
   a statement line's lineage) scrolls its body, and the keyboard's focus is
   scrolled into it only until the control's own edge meets the body's: the
   ring, 2px drawn 2px outside that edge, lay under the edge. At 390x844 the
   last stop of a derived line's drawer — its "Inputs" table — ended a pixel
   past the body's bottom with the whole ring below it, as did Apple's
   "Every filing on EDGAR" at 360 and the universe chart at the end of a
   metric's definition; and a definition too long for the drawer, the body
   itself the Tab stop, drew its ring outside the screen on the drawer's
   outer sides, at every width. Walked here by the keyboard as a reader
   walks it — Tab round every stop and Shift+Tab from the close button to
   the last — in a filed and an illustrative company's lineage drawer, the
   first and last metric definitions and, below 1024px, the sidebar drawer,
   at 360, 390 (light and dark), 768 and 1440: every stop shows a ring, and
   no ring crosses the edge of a box that clips it or of the screen. */
{
  const fails = [];
  let walked = 0, stopsSeen = 0;
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  const tab = async (back = false) => {
    const modifiers = back ? 8 : 0;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers }, sessionId);
    await sleep(140);
  };
  const settled = async () => { for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`) === true) return true; } return false; };
  /* Where the focused control's ring reaches — its outline's width past its
     offset, so an inset ring (a negative offset) stays at the edge — against
     every ancestor that clips and against the screen. */
  const RING = `(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    const s = getComputedStyle(a), r = a.getBoundingClientRect();
    const grow = (parseFloat(s.outlineWidth) || 0) + (parseFloat(s.outlineOffset) || 0);
    const ring = { l: r.left - grow, r: r.right + grow, t: r.top - grow, b: r.bottom + grow };
    const cuts = [];
    const test = (q, who) => { const c = [];
      if (ring.l < q.l - 0.5) c.push('left'); if (ring.r > q.r + 0.5) c.push('right');
      if (ring.t < q.t - 0.5) c.push('top'); if (ring.b > q.b + 0.5) c.push('bottom');
      if (c.length) cuts.push(who + ' cuts its ' + c.join(', ')); };
    for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue;
      const q = p.getBoundingClientRect(), px = (v) => parseFloat(v) || 0;
      test({ l: q.left + px(ps.borderLeftWidth), r: q.right - px(ps.borderRightWidth), t: q.top + px(ps.borderTopWidth), b: q.bottom - px(ps.borderBottomWidth) },
        p.id ? '#' + p.id : p.tagName.toLowerCase() + '.' + String(p.className).split(' ')[0]);
    }
    test({ l: 0, t: 0, r: document.documentElement.clientWidth, b: window.innerHeight }, 'the screen');
    return { name: (a.getAttribute('aria-label') || a.textContent || a.tagName).trim().replace(/\\s+/g, ' ').slice(0, 48),
      ring: a.matches(':focus-visible') && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2, cuts,
      inside: !!a.closest('#drawer, #sidebar') };
  })()`;
  const judge = (at, where) => {
    if (!at || at.error) { fails.push(`${where}: nothing measured (${at?.error || 'no focus'})`); return; }
    stopsSeen++;
    if (!at.inside) fails.push(`${where}: focus left the drawer for "${at.name}"`);
    else if (!at.ring) fails.push(`${where}: "${at.name}" takes focus with no visible ring`);
    else if (at.cuts.length) fails.push(`${where}: the ring on "${at.name}" is clipped — ${at.cuts.join('; ')}`);
  };
  /* Round every stop from where the drawer put focus, then back from its
     first stop to its last. */
  const walk = async (where, first) => {
    const names = [];
    for (let i = 0; i < 40; i++) {
      await tab();
      const at = await ev(RING);
      if (names.length && at?.name === names[0]) break;
      names.push(at?.name);
      judge(at, `${where}, Tab stop ${names.length}`);
    }
    await ev(`(document.querySelector(${JSON.stringify(first)})?.focus(), true)`);
    await tab(true);
    judge(await ev(RING), `${where}, Shift+Tab to the last stop`);
    walked++;
    return names.length;
  };
  const DERIVED = `(() => { const td = [...document.querySelectorAll('td.cell-sourced')].find(t => /derived/.test(t.parentElement.textContent)); if (!td) return false; td.focus(); td.click(); return true; })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    /* And in Verdana at 768 and 1440. CI's Linux fallback is wider than this
       machine's fonts: a table that fits the drawer here scrolls there, with
       a classic scrollbar under it — and Chrome scrolls a focused scroll
       box's client area into view, not its scrollbar, so the 16px bar and
       the ring hung past the drawer's foot on CI alone (the universe table
       closing a metric's definition, a derived line's Inputs). Verdana is as
       wide, and makes the same tables scroll here. */
    for (const [w, h, dark, font] of [[360, 640, false], [390, 844, false], [390, 844, true], [768, 1024, false], [1440, 900, false],
      [768, 1024, false, 'Verdana, sans-serif'], [1440, 900, false, 'Verdana, sans-serif']]) {
      const at = `${w}x${h}${dark ? ' dark' : ''}${font ? ' in Verdana' : ''}`;
      const face = () => font ? ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`) : null;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, sessionId);
      for (const co of ['MAYBANK', 'aapl-apple-inc']) {
        await send('Page.navigate', { url: `${BASE}/company/${co}?tab=financials` }, sessionId);
        if (!(await settled())) { fails.push(`${at} /company/${co}?tab=financials: the page did not settle`); continue; }
        await face();
        await sleep(500);
        if ((await ev(DERIVED)) !== true) { fails.push(`${at} /company/${co}?tab=financials: no derived line to open`); continue; }
        await sleep(500);
        await walk(`${at} ${co}'s derived-line drawer`, '#drawer [data-close-drawer]');
        await ev(`(closeDrawer(), true)`);
        await sleep(400);
      }
      await send('Page.navigate', { url: `${BASE}/discover/screener` }, sessionId);
      if (!(await settled())) { fails.push(`${at} /discover/screener: the page did not settle`); continue; }
      await face();
      await sleep(500);
      for (const which of ['0', 'FIELDS.length - 1']) {
        if ((await ev(`(openMetricInfo(FIELDS[${which}]), true)`)) !== true) { fails.push(`${at}: the metric definition FIELDS[${which}] did not open`); continue; }
        await sleep(500);
        await walk(`${at} metric definition FIELDS[${which}]`, '#drawer [data-close-drawer]');
        await ev(`(closeDrawer(), true)`);
        await sleep(400);
      }
      if (w < 1024) {
        await send('Page.navigate', { url: `${BASE}/app` }, sessionId);
        if (!(await settled())) { fails.push(`${at} /app: the page did not settle`); continue; }
        await face();
        await sleep(400);
        await ev(`(document.getElementById('navOpen').click(), true)`);
        await sleep(500);
        await walk(`${at} sidebar drawer`, '#sidebar #navClose');
        await ev(`(document.getElementById('navClose').click(), true)`);
        await sleep(300);
      }
    }
    if (walked < 20) fails.push(`only ${walked} drawers were walked`);
  } catch (e) { fails.push(`the check threw: ${e.message}`); }
  finally { await send('Emulation.setEmulatedMedia', { features: [] }, sessionId); }
  if (fails.length) { bad++; console.log(`FAIL releaseB small-backlog E5 — a focus ring in a drawer is cut off or missing: ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   releaseB small-backlog E5: ${walked} drawers walked by Tab and Shift+Tab at 360, 390 (light and dark), 768 and 1440, and at 768 and 1440 in Verdana — ${stopsSeen} stops, each with a ring no clipping box or screen edge cuts, the last stop included`);
}
/* E3 — THE SCREENER BESIDE THE SIDEBAR. The filter rail (288px) and the
   results sat side by side from a 1041px window up, by the window's width;
   but from 1024px the sidebar takes 264px of it, so from 1041 to 1280 the
   results card was left 394 to 633px, and at 1100 a reader saw a company
   and one score of each row, the rest behind a sideways scroll. The table
   is wider than any window (twelve columns, 1,750px) and scrolls inside
   its card; what it needs is a window that shows each row's pinned company
   and the three figures every screen carries — Quality, Value and the
   difference from the base-case model estimate. At every width beside the
   sidebar, 1024 to 1440: those four columns fit the table's window, the
   rail keeps its 288px, nothing in it runs sideways, and a rail stacked
   above the results is not stuck over them. And the breakpoint is the
   layout's own: at 1440 the same page, its column narrowed to 760px, lays
   out as it does at 1100, and widened again returns beside. */
{
  const fails = [];
  const seen = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  const MEASURE = `(() => {
    const L = document.querySelector('.screener-layout');
    const rail = L && L.querySelector(':scope > .rail-sticky');
    const t = L && L.querySelector('table.dt');
    const tw = t && t.closest('.tablewrap');
    if (!rail || !t || !tw) return { error: 'no screener layout, rail or results table' };
    const r = rail.getBoundingClientRect(), m = L.children[1].getBoundingClientRect();
    const ths = [...t.querySelectorAll('thead th')];
    const core = ths.slice(0, 4);
    const need = Math.round(core.reduce((s, th) => s + th.getBoundingClientRect().width, 0));
    const wide = [...rail.querySelectorAll('*')].filter(n => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'visible' && n.clientWidth > 0)
      .map(n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : ''));
    return { layout: Math.round(L.getBoundingClientRect().width), rail: Math.round(r.width), window: tw.clientWidth, need,
      heads: core.map(th => th.textContent.trim().replace(/[▲▼↕]/g, '')), beside: m.top < r.bottom - 1 && m.left >= r.right - 1,
      sticky: getComputedStyle(rail).position === 'sticky', railOver: rail.scrollWidth > rail.clientWidth + 1, wide: wide.slice(0, 3) };
  })()`;
  const judge = (at, v) => {
    if (!v || v.error) { fails.push(`${at}: not measured (${v?.error || 'nothing'})`); return; }
    seen.push(`${at} ${v.beside ? 'beside' : 'stacked'} (window ${v.window}px)`);
    if (v.window + 1 < v.need) fails.push(`${at}: the results window is ${v.window}px, and the company and its three figures (${v.heads.join(', ')}) need ${v.need}px — the rail ${v.beside ? 'beside it' : 'above it'}, the layout ${v.layout}px`);
    if (v.rail < 287) fails.push(`${at}: the filter rail is ${v.rail}px, under its 288px`);
    if (v.railOver || v.wide.length) fails.push(`${at}: the filter rail runs sideways (${v.wide.join(', ') || 'the rail itself'})`);
    if (!v.beside && v.sticky) fails.push(`${at}: the rail stacked above the results is still sticky, so it would ride over them`);
  };
  try {
    await send('Page.navigate', { url: BASE + '/discover/screener' }, sessionId);
    for (let i = 0; i < 60; i++) { await sleep(300); if (await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && State.view === 'discover' && !!document.querySelector('.screener-layout table.dt')`) === true) break; }
    for (const w of [1024, 1041, 1100, 1180, 1280, 1366, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await sleep(450);
      judge(`${w}px`, await ev(MEASURE));
    }
    /* The layout's own breakpoint: its column narrowed at a wide window. */
    const wideAt = await ev(MEASURE);
    await ev(`(document.querySelector('.screener-layout').parentElement.style.maxWidth = '760px', true)`);
    await sleep(450);
    const narrowed = await ev(MEASURE);
    judge('1440px, its column narrowed to 760px', narrowed);
    await ev(`(document.querySelector('.screener-layout').parentElement.style.maxWidth = '', true)`);
    await sleep(450);
    const back = await ev(MEASURE);
    if (!wideAt?.beside || narrowed?.beside || !back?.beside) fails.push(`the layout does not follow its own width: at 1440 ${wideAt?.beside ? 'beside' : 'stacked'}, its column narrowed to 760px ${narrowed?.beside ? 'beside' : 'stacked'}, widened again ${back?.beside ? 'beside' : 'stacked'}`);
    /* IN VERDANA TOO (10 Oct 2026). The filed set's default columns, named in
       full, passed here in Segoe UI and failed on CI's runner in DejaVu Sans
       (747px against a 681–719px window, 1024–1366); Verdana's widths are
       DejaVu's kin. */
    await ev(`(() => { const s = document.createElement('style'); s.id = 'e3-face'; s.textContent = '*{font-family:Verdana, sans-serif !important}'; document.head.append(s); return true; })()`);
    for (const w of [1024, 1041, 1366]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await sleep(450);
      judge(`${w}px in Verdana`, await ev(MEASURE));
    }
    await ev(`(document.getElementById('e3-face')?.remove(), true)`);
  } catch (e) { fails.push(`the check threw: ${e.message}`); }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (fails.length) { bad++; console.log(`FAIL releaseB small-backlog E3 — the screener beside the sidebar: ${fails.length} problem(s):`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   releaseB small-backlog E3: the screener at ${seen.join(', ')} — every width shows each row's company and its three figures in the table's window, the rail keeps 288px and is not stuck over the results, and the breakpoint follows the layout's own width`);
}
/* ---- end releaseB: small-backlog ---- */
/* ---- releaseB: search-recent ---- */
/* THE SEARCH ON A PHONE (Release B, B3 and B4). At 360 and 390, light and
   dark: the box open with nothing typed, listing Recent — a company, a page,
   a tool and a saved list with a long name — and open on a query with a
   result in every group ("property": companies, pages and tools, and a
   saved property). No horizontal overflow; the box inside the screen; every
   result's words inside its own row; each result, "Clear recent" and the
   close button 44px tall, the close button 44px wide too. And by the keys
   alone at 390: the bar's Search button and "/" open it, the arrows walk the
   results across the groups, Enter opens one, and Escape closes it and gives
   focus back to where it was. */
{
  const fails = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const KEYS = { '/': ['Slash', 191, '/'], Escape: ['Escape', 27, ''], Enter: ['Enter', 13, '\r'], ArrowDown: ['ArrowDown', 40, ''], ArrowUp: ['ArrowUp', 38, ''] };
  const key = async (k) => {
    const [code, vk, text] = KEYS[k];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, sessionId);
    await sleep(140);
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(300);
  };
  const LONG = 'QT phone list — every Bursa bank and the two US banks followed for their net interest margins';
  const seed = `(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
    localStorage.setItem('vl.plan', JSON.stringify('pro')); return true; })()`;
  const MEASURE = `(() => { const out = { problems: [] }; const vw = window.innerWidth, vh = window.innerHeight;
    const de = document.documentElement;
    if (de.scrollWidth > vw + 1) out.problems.push('the page overflows by ' + (de.scrollWidth - vw) + 'px');
    const box = document.getElementById('searchModal'), m = box.getBoundingClientRect();
    if (m.left < -0.5 || m.right > vw + 0.5 || m.top < -0.5 || m.bottom > vh + 0.5) out.problems.push('the box runs outside the screen: ' + JSON.stringify([m.left, m.top, m.right, m.bottom].map(Math.round)));
    const res = document.getElementById('searchResults');
    if (res.scrollWidth > res.clientWidth + 1) out.problems.push('the results scroll sideways by ' + (res.scrollWidth - res.clientWidth) + 'px');
    const rows = [...res.querySelectorAll('[data-result], .search-off')];
    out.rows = rows.length;
    rows.forEach(r => { const b = r.getBoundingClientRect(); const name = (r.querySelector('.search-name')?.textContent || r.textContent).trim().slice(0, 32);
      if (b.height < 43.5) out.problems.push('"' + name + '" is ' + Math.round(b.height) + 'px tall');
      const past = Math.max(0, ...[...r.querySelectorAll('*')].filter(n => n.getClientRects().length).map(n => n.getBoundingClientRect().right - b.right));
      if (past > 1) out.problems.push('"' + name + '": its words run ' + Math.round(past) + 'px out of its row');
      if (b.right > m.right + 0.5 || b.left < m.left - 0.5) out.problems.push('"' + name + '" runs past the box'); });
    const tgt = (sel, label, both) => { const n = document.querySelector(sel); if (!n || !n.getClientRects().length) return false; const b = n.getBoundingClientRect();
      if (b.height < 43.5 || (both && b.width < 43.5)) out.problems.push(label + ' is ' + Math.round(b.width) + '×' + Math.round(b.height) + 'px'); return true; };
    out.clear = tgt('#searchResults .search-clear', '"Clear recent"', false);
    tgt('#closeSearch', 'the close button', true);
    out.groups = [...res.querySelectorAll('[data-group]')].map(g => g.dataset.group);
    return out; })()`;
  let measured = 0;
  try {
    for (const [w, dark] of [[360, false], [390, false], [390, true]]) {
      const at = `${w}px${dark ? ' dark' : ''}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
      /* Light is asked for, not assumed: headless Chrome follows the
         machine's own scheme, which may be dark. */
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, sessionId);
      await ev(seed);
      await load('/property/calculator');
      await ev(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms));
        saveActiveProperty({ name: 'QT phone property' });
        const l = wlCreate(${JSON.stringify(LONG)}); if (l.ok) wlAdd(l.watchlist.id, 'MAYBANK');
        openResearch('AAPL-SEC'); await w(300); navigate('/pricing'); await w(200); navigate('/discover/screener'); await w(300);
        openSearch(); await w(250); runSearch('QT phone list'); clearTimeout(searchTimer);
        [...searchResults.querySelectorAll('[data-group="saved"] [data-result]')].find(r => /QT phone list/.test(r.textContent))?.click(); await w(400);
        return true; })()`);
      await ev(`(() => { document.querySelector('.appbar-search')?.click(); return true; })()`); await sleep(400);
      const empty = await ev(MEASURE);
      measured++;
      if (!empty.groups.includes('recent')) fails.push(`${at}: the box with nothing typed lists no Recent (${JSON.stringify(empty.groups)})`);
      else if (empty.rows < 4) fails.push(`${at}: Recent lists ${empty.rows} rows after a company, a page, a tool and a saved list were opened`);
      if (!empty.clear) fails.push(`${at}: Recent has no "Clear recent" on screen`);
      empty.problems.forEach(p => fails.push(`${at}, Recent: ${p}`));
      await send('Input.insertText', { text: 'property' }, sessionId); await sleep(500);
      const full = await ev(MEASURE);
      measured++;
      for (const g of ['companies', 'pages', 'saved']) if (!full.groups.includes(g)) fails.push(`${at}: "property" lists no ${g} group (${JSON.stringify(full.groups)})`);
      full.problems.forEach(p => fails.push(`${at}, "property": ${p}`));
      await ev(`(() => { closeSearch({ restore: false }); return true; })()`); await sleep(300);
    }
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);

    /* By the keys alone at 390. */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await load('/research');
    const k = {};
    await ev(`(() => { document.querySelector('.appbar-search').focus(); return true; })()`);
    await key('Enter'); await sleep(350);
    k.button = await ev(`searchOpen && document.activeElement === searchInput`);
    await send('Input.insertText', { text: 'property' }, sessionId); await sleep(500);
    const order = await ev(`[...searchResults.querySelectorAll('[data-result]')].map(n => n.closest('[data-group]')?.dataset.group || null)`);
    const walked = [];
    for (let i = 0; i < order.length; i++) { await key('ArrowDown'); walked.push(await ev(`(() => { const a = document.activeElement; return { i: [...searchResults.querySelectorAll('[data-result]')].indexOf(a), g: a?.closest('[data-group]')?.dataset.group || null, seen: (() => { const b = a.getBoundingClientRect(), r = searchResults.getBoundingClientRect(); return b.top >= r.top - 1 && b.bottom <= r.bottom + 1; })() }; })()`)); }
    k.walk = order.length > 2 && walked.every((s, i) => s.i === i) && new Set(walked.map(s => s.g)).size >= 3;
    k.inSight = walked.every(s => s.seen);
    for (let i = 0; i < order.length; i++) await key('ArrowUp');
    k.upToBox = await ev(`document.activeElement === searchInput`);
    const firstPage = order.indexOf('pages');
    for (let i = 0; i <= firstPage; i++) await key('ArrowDown');
    const chosen = await ev(`(() => { const a = document.activeElement; return a?.closest('[data-group]')?.dataset.group === 'pages' ? new URL(a.href, location.href).pathname : null; })()`);
    await key('Enter'); await sleep(600);
    k.opened = chosen && await ev(`!searchOpen && location.pathname === ${JSON.stringify(chosen || '')}`);
    await ev(`(() => { document.querySelector('.appbar-search').focus(); return true; })()`);
    await key('Enter'); await sleep(350);
    await key('Escape'); await sleep(350);
    k.buttonBack = await ev(`!searchOpen && document.activeElement?.classList.contains('appbar-search')`);
    await ev(`(() => { focusMain(); return true; })()`);
    await key('/'); await sleep(350);
    k.slash = await ev(`searchOpen && document.activeElement === searchInput`);
    await key('Escape'); await sleep(350);
    k.slashBack = await ev(`!searchOpen && document.activeElement === document.getElementById('main')`);
    [['Enter on the bar\'s Search button opens the box', k.button], [`the down arrow walks every result in order across the three groups (${JSON.stringify(order)})`, k.walk],
      ['each result the arrows reach is scrolled into sight', k.inSight], ['the up arrow walks back to the box', k.upToBox],
      [`Enter opens the page chosen (${chosen})`, k.opened], ['Escape gives focus back to the bar\'s Search button', k.buttonBack],
      ['"/" opens the box', k.slash], ['Escape gives focus back to the page', k.slashBack]]
      .filter(([, v]) => !v).forEach(([what]) => fails.push(`390px keyboard: ${what} — no`));
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    await ev(seed).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL releaseB search-recent — the search on a phone: ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   releaseB search-recent: the search at 360 and 390 (light) and 390 (dark), ${measured} states — Recent with a company, a page, a tool and a long-named list, and "property" with a result in every group: no overflow, the box on screen, every result's words in its row, results, "Clear recent" and close 44px; by the keys alone at 390 the bar's button and "/" open it, the arrows walk all three groups keeping each result in sight, Enter opens a page, Escape gives focus back`);
}
/* ---- end releaseB: search-recent ---- */
/* ---- property-proposal ---- */
/* THE CLIENT PROPOSAL AT EVERY WIDTH (3 Oct 2026). A saved property with
   three long-named scenarios, all ticked, the preparer's details and a wide
   logo, and a client's name, its details panel open: at 360, 390, 430, 768,
   1024 and 1440, and at 390 dark —
     - no horizontal overflow: a table scrolls in its own box, never the
       page, and from 768 up the scenarios table is not cut at all;
     - the head keeps Prepared by readable beside a long client's name — at
       least 45% of the head where the two stand side by side, the logo not
       under the client's name, the preparer's email on one line — with a
       name of 48, 60 and 80 characters at 768, 1024 and 1440;
     - the details panel's fields stand apart, as the other fieldsets' do;
     - at the three phone widths every control is a 44px target (a
       checkbox's whole label is its target; a link inside a sentence is
       exempt);
     - at 390, by the Tab key alone, every stop on the page shows a focus
       ring and is on screen.
   And My properties, whose rows took a fifth action for the proposal: at
   1024, 1100, 1180, 1280 and 1440 no figure or column head runs into the
   next, and the page says the proposal is a preview. The proposal checks
   fail before it existed; the head, the scenarios at 768 and 1024, the
   details' gaps and My properties fail on c8c9ca3, the proposal as first
   built. */
{
  const fails = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(300);
  };
  /* The head: Prepared by keeps its share, the logo stays out from under the
     client's name, and the preparer's email is not broken inside a word. */
  const HEAD = `const head = doc.querySelector('.cp-head'), by = doc.querySelector('.cp-by'), fr = doc.querySelector('.cp-for'), logo = doc.querySelector('.cp-logo');
    const hb = head.getBoundingClientRect(), bb = by.getBoundingClientRect(), fb = fr.getBoundingClientRect();
    const side = fb.top < bb.bottom - 1 && fb.left > bb.left + 1;
    if (side && bb.width < hb.width * 0.45) out.problems.push('Prepared by has ' + Math.round(bb.width) + 'px of the head\\'s ' + Math.round(hb.width) + 'px beside the client\\'s name');
    if (logo && side && logo.getBoundingClientRect().right > fb.left + 1) out.problems.push('the logo runs ' + Math.round(logo.getBoundingClientRect().right - fb.left) + 'px under the client\\'s name');
    const c = doc.querySelector('.cp-by-contact'), tn = c && c.firstChild, at = tn ? tn.nodeValue.indexOf('aisha.rahman@example.com') : -1;
    if (at >= 0) { const rg = document.createRange(); rg.setStart(tn, at); rg.setEnd(tn, at + 'aisha.rahman@example.com'.length);
      const tops = new Set([...rg.getClientRects()].map(x => Math.round(x.top))); if (tops.size > 1) out.problems.push('the preparer\\'s email is broken over ' + tops.size + ' lines'); }`;
  const MEASURE = (phone, wide) => `(() => { const out = { problems: [] };
    const de = document.documentElement;
    if (de.scrollWidth > window.innerWidth + 1) out.problems.push('the page overflows by ' + (de.scrollWidth - window.innerWidth) + 'px');
    const doc = document.getElementById('cp-doc');
    if (!doc) { out.problems.push('no proposal on the page'); return out; }
    if (doc.scrollWidth > doc.clientWidth + 1) out.problems.push('the document overflows its own box by ' + (doc.scrollWidth - doc.clientWidth) + 'px');
    /* An assumption's label keeps at least 30% of its row: as "auto" the
       value column took the width of its longest value and every label
       broke a word a line. */
    doc.querySelectorAll('dl.cp-kv-tight dt').forEach(dt => { const a = dt.getBoundingClientRect(), full = dt.nextElementSibling.getBoundingClientRect().right - a.left;
      if (a.width < full * 0.3) out.problems.push('the assumption "' + dt.textContent.trim() + '" has ' + Math.round(a.width) + 'px of its ' + Math.round(full) + 'px row'); });
    ${HEAD}
    /* The scenarios side by side: cut at the box's edge from 768 up. */
    const sc = [...doc.querySelectorAll('.cp-tablewrap')].find(x => x.querySelector('.cp-sc-table'));
    out.cols = sc ? sc.querySelectorAll('thead th').length - 1 : 0;
    if (${wide} && sc && sc.scrollWidth > sc.clientWidth + 1) out.problems.push('the scenarios table is ' + sc.scrollWidth + 'px in a ' + sc.clientWidth + 'px box');
    /* The details panel's fields stand apart. */
    const fields = [...document.querySelectorAll('#cp-details .field')].filter(f => f.getClientRects().length);
    fields.slice(1).forEach((f, i) => { const gap = f.getBoundingClientRect().top - fields[i].getBoundingClientRect().bottom;
      if (gap < 8) out.problems.push('in Your details, "' + (f.querySelector('label, .cp-fs-label')?.textContent || '').trim() + '" sits ' + Math.round(gap) + 'px under the field above it'); });
    if (${phone}) {
      const page = document.querySelector('.cp-page');
      const ctl = [...page.querySelectorAll('a[href], button, input:not([type=hidden]):not([type=file]):not([type=checkbox]), select, summary, label.checkline, [tabindex="0"]')]
        .filter(n => n.getClientRects().length && !n.closest('p'));
      out.n = ctl.length;
      ctl.forEach(n => { const b = n.getBoundingClientRect(); const wide2 = /^(A|BUTTON|SUMMARY)$/.test(n.tagName);
        if (b.height < 43.5 || (wide2 && b.width < 43.5)) out.problems.push((n.id || n.tagName.toLowerCase()) + ' "' + (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 30) + '" is ' + Math.round(b.width) + '×' + Math.round(b.height) + 'px'); });
    }
    return out; })()`;
  let measured = 0, stops = 0, targets = 0, heads = 0, rows = 0;
  try {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await load('/property/calculator');
    const path = await ev(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
      window.__pq = []; window.prompt = (m, d) => (window.__pq.length ? window.__pq.shift() : d); window.confirm = () => true;
      newPropertyDeal({ show: false });
      Object.assign(State.deal, { price: 538000, rent: 2250, bankValuation: 520000 }); ['price', 'rent', 'bankValuation'].forEach(k => markTouched(State.deal, k)); saveDeal();
      const rec = saveActiveProperty({ name: 'A long property name for the phone check — Stutong Heights, block C' });
      for (const [name, set] of [['A 20% deposit instead of 10%, with the valuation at the purchase price', { downPct: 20, bankValuation: 538000 }],
        ['Rent at RM2,550 with the furnished unit', { rent: 2550 }], ['Rate up by about one percentage point', { ratePct: 5.2 }]]) {
        openPropertyModel(rec.id, { show: false });
        Object.assign(State.deal, set); Object.keys(set).forEach(k => markTouched(State.deal, k)); saveDeal(); window.__pq = [name]; saveAsScenario();
      }
      openPropertyModel(rec.id, { show: false });
      const cv = document.createElement('canvas'); cv.width = 600; cv.height = 150; const g = cv.getContext('2d'); g.fillStyle = '#1f5c4a'; g.fillRect(0, 0, 600, 150);
      store.write('proposalDetails', { name: 'Aisha binti Rahman', agency: 'Rahman Property Advisory Sdn Bhd', contact: '+60 12-345 6789 · aisha.rahman@example.com', logo: cv.toDataURL('image/png') });
      return cpPath(rec.id);
    })()`);
    const open = async (client = 'Mr and Mrs Tan Wei Ming, and their family trust') => ev(`(async () => { navigate(${JSON.stringify(path)}); await new Promise(r => setTimeout(r, 450));
      for (let i = 0, cb; i < 6 && (cb = [...document.querySelectorAll('.cp-pick input[type=checkbox]')].find(x => !x.checked)); i++) { cb.click(); await new Promise(r => setTimeout(r, 250)); }
      const c = document.getElementById('cp-client'); c.value = ${JSON.stringify(client)}; c.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const d = document.getElementById('cp-details'); if (d && !d.open) { d.open = true; await new Promise(r => setTimeout(r, 80)); }
      return State.view; })()`);
    for (const [w, dark] of [[360, false], [390, false], [430, false], [768, false], [1024, false], [1440, false], [390, true]]) {
      const at = `${w}px${dark ? ' dark' : ''}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] }, sessionId);
      const view = await open();
      if (view !== 'propertyProposal') { fails.push(`${at}: the proposal opened as ${view}`); continue; }
      const m = await ev(MEASURE(w <= 430, w >= 768));
      m.problems.forEach(x => fails.push(`${at}: ${x}`));
      if (m.cols !== 4) fails.push(`${at}: the scenarios table has ${m.cols} columns beside its labels, not the base case and three`);
      if (w <= 430) { targets += m.n || 0; if (!(m.n > 15)) fails.push(`${at}: only ${m.n} controls were measured`); }
      measured++;
    }
    /* A long client's name beside the preparer's, at three widths. */
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
    for (const w of [768, 1024, 1440]) for (const name of ['Mr and Mrs Tan Wei Ming, and their family trust',
      'Syarikat Perumahan Bumi Kenyalang Sdn Bhd, attn. Mr Lau Chee', 'Dato’ Sri Haji Mohammad Faizal bin Abdullah and Datin Sri Hajah Nurul Ain binti']) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await open(name);
      const m = await ev(`(() => { const out = { problems: [] }; const doc = document.getElementById('cp-doc'); ${HEAD} return out; })()`);
      m.problems.forEach(x => fails.push(`${w}px, a client's name of ${name.length} characters: ${x}`));
      heads++;
    }
    /* The keyboard at 390: every stop on the page shows a ring, on screen. */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await open();
    await ev(`document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); document.activeElement?.blur(); true`);
    const seen = new Set();
    for (let i = 0; i < 140; i++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      const v = await ev(`(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const n = document.activeElement; if (!n || n === document.body) return { end: true };
        const page = document.querySelector('.cp-page'); if (!page || !page.contains(n)) return { outside: true, footer: !!n.closest('.footer') };
        if (!n.dataset.cpf) n.dataset.cpf = String(Math.random()).slice(2);
        const s = getComputedStyle(n), b = n.getBoundingClientRect();
        const ring = n.matches(':focus-visible') && ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) || (s.boxShadow && s.boxShadow !== 'none'));
        const onScreen = b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth;
        return { id: n.dataset.cpf, ring, onScreen, who: (n.id || n.tagName.toLowerCase()) + ' "' + (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 30) + '"' }; })()`);
      if (!v || v.end || v.footer) break;
      if (v.outside || seen.has(v.id)) continue;
      seen.add(v.id);
      if (!v.ring) fails.push(`390 keyboard: ${v.who} takes focus with no visible ring`);
      if (!v.onScreen) fails.push(`390 keyboard: ${v.who} takes focus off screen`);
    }
    stops = seen.size;
    if (stops < 12) fails.push(`390 keyboard: the Tab key reached only ${stops} stops on the proposal page`);
    /* My properties: five actions a row, and nothing running into its
       neighbour; and the proposal called a preview. */
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    for (const w of [1024, 1100, 1180, 1280, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
      await ev(`(async () => { navigate('/property/models'); await new Promise(r => setTimeout(r, 450)); return true; })()`);
      const m = await ev(`(() => { const out = { problems: [], rows: 0 };
        const list = document.querySelector('.pm-list:not(.pm-loose)');
        const spill = (cell) => { const r = cell.getBoundingClientRect(); let right = r.right;
          cell.querySelectorAll('*').forEach(k => { if (k.getClientRects().length && getComputedStyle(k).position !== 'absolute') right = Math.max(right, k.getBoundingClientRect().right); });
          return Math.max(right - r.right, cell.scrollWidth - cell.clientWidth); };
        const named = (c) => (c.querySelector('.pm-label')?.textContent || c.textContent || '').trim().slice(0, 24);
        [...list.querySelectorAll(':scope > .pm-row:not(.pm-sample)')].forEach(row => {
          out.rows++;
          [...row.children].forEach(c => { const s = spill(c); if (s > 1) out.problems.push((row.classList.contains('pm-head') ? 'the column head "' : 'the cell "') + named(c) + '" runs ' + Math.round(s) + 'px past its column'); });
        });
        if (!/client proposal is a preview/i.test(document.querySelector('main')?.innerText || '')) out.problems.push('nothing on the page says the client proposal is a preview');
        return out; })()`);
      m.problems.forEach(x => fails.push(`My properties at ${w}px: ${x}`));
      rows += m.rows;
    }
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL property-proposal — the client proposal across widths: ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   property-proposal: the client proposal (three scenarios ticked, the preparer's details and a wide logo, a client's name, the details open) at 360, 390, 430, 768, 1024 and 1440, and 390 dark — ${measured} widths with no overflow of the page or the document, the scenarios table whole from 768 up, every assumption's label keeping at least 30% of its row and the details' fields apart; in ${heads} heads with a client's name of 48 to 80 characters at 768, 1024 and 1440 Prepared by keeps at least 45%, the logo stays clear of the client's name and the email whole; on the phones all ${targets} controls measured are 44px targets; by the Tab key at 390 all ${stops} stops show a ring, on screen; on My properties at 1024 to 1440 no figure or head runs into the next (${rows} rows) and the proposal is called a preview`);
}
/* ---- end property-proposal ---- */
/* ---- scenario-lab ---- */
/* THE SCENARIO LAB ON A PHONE AND A DESK (the owner's decision, 3 Oct
   2026). The lab's two addresses are in ROUTES above (no overflow at all
   seven widths); this holds the rest of the brief's phone and colour rules:
     - the lab draws its sliders — the block fails on a page with none, so
       it cannot pass on a build without the lab;
     - at 360, 390 and 430 every control the reader can reach in the panel
       is a 44px target both ways (a radio's whole label is its target);
     - at 360×640, the panel's inputs at the top of the screen, the slider
       being moved and all seven results sit on that one screen, below the
       topbar, with one knob drawn; at 1024 and 1440 all five;
     - at 360, under each of the six comparisons, nothing scrolls sideways;
     - in light and in dark, every bar's fill is 3:1 against its track and
       its card, every figure 4.5:1 against its card, a column's letter
       4.5:1 against its badge, and the slider's focus ring 3:1 against the
       page behind it.
   Fails before the lab existed: /property/lab drew the not-found card. */
{
  const fails = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(400);
    return ev(`({ view: State.view, ranges: document.querySelectorAll('.lab input[type=range]').length })`);
  };
  let targets = 0, pairs = 0, metrics = 0;
  const said = {};
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    /* 44px targets on the phones. */
    for (const w of [360, 390, 430]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
      const v = await load('/property/lab');
      if (v.view !== 'propertyLab' || !v.ranges) { fails.push(`${w}px: /property/lab opened ${v.view} with ${v.ranges} slider(s)`); continue; }
      const r = await ev(`(() => {
        const lab = document.querySelector('.lab');
        const shown = (n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
        const ctl = [...lab.querySelectorAll('a[href], button, input:not([type=radio]):not([type=hidden]), select, summary, label.lab-seg-opt')].filter(shown);
        return { n: ctl.length, small: ctl.map(n => { const b = n.getBoundingClientRect(); return { who: (n.id || n.tagName.toLowerCase()) + ' "' + (n.textContent || n.getAttribute('aria-label') || '').trim().slice(0, 30) + '"', w: b.width, h: b.height }; })
          .filter(x => x.w < 43.5 || x.h < 43.5).map(x => x.who + ' ' + Math.round(x.w) + '×' + Math.round(x.h)) };
      })()`);
      targets += r.n;
      if (r.n < 12) fails.push(`${w}px: only ${r.n} controls in the panel were measured`);
      r.small.forEach(x => fails.push(`${w}px: ${x}px`));
    }
    /* One screen at 360×640. */
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true }, sessionId);
    await load('/property/lab');
    {
      const r = await ev(`(() => {
        document.documentElement.style.scrollBehavior = 'auto';
        const inputs = document.querySelector('.lab-inputs');
        window.scrollTo(0, inputs.getBoundingClientRect().top + scrollY);
        const bar = [...document.querySelectorAll('.appbar, .topbar')].filter(n => n.getClientRects().length && getComputedStyle(n).position !== 'static').map(n => n.getBoundingClientRect().bottom);
        const under = Math.max(0, ...bar);
        const knobs = [...document.querySelectorAll('.lab-knob')].filter(n => n.getClientRects().length);
        const range = document.querySelector('.lab-knob.is-on .lab-range');
        const rb = range ? range.getBoundingClientRect() : null;
        const vals = [...document.querySelectorAll('.lab-chain [data-lab]')].filter(n => n.dataset.lab !== 'grade').map(n => ({ k: n.dataset.lab, b: n.getBoundingClientRect() }));
        return { knobs: knobs.length, under: Math.round(under), range: rb && [Math.round(rb.top), Math.round(rb.bottom)], vals: vals.map(x => [x.k, Math.round(x.b.top), Math.round(x.b.bottom)]), vh: (() => { const d = document.querySelector('body > .dock'); return d && d.getClientRects().length && getComputedStyle(d).position === 'fixed' ? Math.round(d.getBoundingClientRect().top) : innerHeight; })() };
      })()`);
      said.oneScreen = r;
      if (r.knobs !== 1) fails.push(`360×640: ${r.knobs} knobs drawn, not one`);
      if (!r.range || r.range[0] < r.under || r.range[1] > r.vh) fails.push(`360×640: the slider sits at ${JSON.stringify(r.range)}, the screen below the topbar is ${r.under}–${r.vh}`);
      if (r.vals.length !== 7) fails.push(`360×640: ${r.vals.length} results, not seven`);
      r.vals.filter(([, t, b]) => t < r.under || b > r.vh).forEach(([k, t, b]) => fails.push(`360×640: ${k} sits at ${t}–${b}, off the screen`));
    }
    /* No sideways scroll at 360 under any comparison. */
    for (const id of ['yield', 'cashflow', 'entry', 'appreciation', 'risk', 'location']) {
      const over = await ev(`(async () => { const r = document.getElementById('lab-by-${id}'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))); return document.documentElement.scrollWidth - innerWidth; })()`);
      metrics++;
      if (over > 2) fails.push(`360px, compared by ${id}: the page scrolls sideways by ${over}px`);
    }
    /* All five knobs on a desk. */
    for (const w of [1024, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
      await load('/property/lab');
      const n = await ev(`[...document.querySelectorAll('.lab-knob')].filter(n => n.getClientRects().length).length`);
      if (n !== 5) fails.push(`${w}px: ${n} knobs drawn, not five`);
    }
    /* Colour, light and dark. */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    for (const dark of [false, true]) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
      await load('/property/lab');
      /* A key pressed first, so the focus given below is a keyboard
         reader's (:focus-visible) whatever the blocks before did with the
         pointer. */
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      const r = await ev(`(() => {
        const cv = document.createElement('canvas'); cv.width = cv.height = 1;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
        const over = (fg, bg) => fg[3] >= 1 ? fg : [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
        const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
        const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
        const bgOf = (n) => { for (let p = n; p; p = p.parentElement) { const c = rgba(getComputedStyle(p).backgroundColor); if (c[3] > 0) return over(c, [255, 255, 255, 1]); } return [255, 255, 255, 1]; };
        const out = [];
        const add = (what, fg, bg, min) => out.push({ what, r: +ratio(fg, bg).toFixed(2), min });
        for (const f of document.querySelectorAll('.lab-bar-fill')) {
          const track = f.parentElement, card = f.closest('.card');
          const fill = over(rgba(getComputedStyle(f).backgroundColor), bgOf(track));
          add('bar ' + f.closest('[class*=lab-c-]').className.match(/lab-c-./)[0] + ' / track', fill, bgOf(track), 3);
          add('bar ' + f.closest('[class*=lab-c-]').className.match(/lab-c-./)[0] + ' / card', fill, bgOf(card), 3);
        }
        for (const n of document.querySelectorAll('.lab-val, .lab-cmp-v, .lab-grade-letter')) {
          if (!n.getClientRects().length) continue;
          add('figure ' + (n.dataset.lab || n.className), over(rgba(getComputedStyle(n).color), bgOf(n)), bgOf(n), 4.5);
        }
        for (const n of document.querySelectorAll('.lab-letter')) {
          if (!n.getClientRects().length) continue;
          add('letter ' + n.textContent, over(rgba(getComputedStyle(n).color), bgOf(n)), bgOf(n), 4.5);
        }
        const range = document.querySelector('.lab-knob.is-on .lab-range');
        range.focus({ focusVisible: true });
        const cs = getComputedStyle(range);
        out.push({ what: 'focus ring style', style: cs.outlineStyle, width: cs.outlineWidth });
        add('focus ring / page', over(rgba(cs.outlineColor), bgOf(range.parentElement)), bgOf(range.parentElement), 3);
        range.blur();
        return out;
      })()`);
      const ring = r.find(x => x.style !== undefined);
      if (!ring || ring.style === 'none' || parseFloat(ring.width) < 2) fails.push(`${dark ? 'dark' : 'light'}: the focused slider shows ${ring ? `${ring.style} ${ring.width}` : 'no'} outline`);
      for (const x of r.filter(y => y.min)) {
        pairs++;
        if (!(x.r >= x.min)) fails.push(`${dark ? 'dark' : 'light'}: ${x.what} ${x.r}:1, under ${x.min}:1`);
        said[`${dark ? 'dark' : 'light'} min ${x.min}`] = Math.min(said[`${dark ? 'dark' : 'light'} min ${x.min}`] ?? 99, x.r);
      }
    }
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL scenario-lab — the Scenario Lab across widths and themes: ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   scenario-lab: the Scenario Lab draws its sliders; at 360, 390 and 430 all ${targets} controls measured are 44px targets; at 360×640 one knob, its slider (${said.oneScreen.range.join('–')}) and all seven results (the last ending at ${Math.max(...said.oneScreen.vals.map(v => v[2]))}) on one screen below the ${said.oneScreen.under}px topbar; no sideways scroll at 360 under any of the ${metrics} comparisons; all five knobs at 1024 and 1440; ${pairs} colour pairs held in light and dark (lowest: ${Object.entries(said).filter(([k]) => k.includes('min')).map(([k, v]) => `${k.replace(' min ', ' ')}:1 pairs ${v}`).join(', ')}), the focused slider ringed`);
}
/* ---- end scenario-lab ---- */
/* ---- scenario-lab-verify ---- */
/* THE SCENARIO LAB ON A PHONE AND A DESK, AS THE VERIFICATION OF 4 OCT 2026
   FOUND IT. Each fails on the lab as first built (e91a64f):
     - at 360×640, the Input picker just under the topbar, for each of the
       five knobs: the slider and all seven results on the screen, and none
       of them moved by the first tick of a drag (the first tick added a
       what-if line and a 44px "Back to…" line, and every result jumped 75px
       under the thumb), with the scroll unanchored as in Safari (a line
       added above the sliders moved them 43px, 7072826);
     - at 390, saving B as a scenario or the property leaves the keyboard in
       the panel and the page where it was (focus fell to <body>, and the
       page jumped 1,670px);
     - light and dark: a stack's legend is true of what is drawn in that
       theme ("darker" was lighter in dark), and every part of a stack holds
       3:1 against its track and its card where it is told apart;
     - at 390, the calculator's "Open these in the Scenario Lab" is a 44px
       target (16px tall);
     - at 390 by touch, a vertical swipe that starts on a slider's track
       leaves the figure where it was (it jumped to where the finger landed),
       and a sideways drag still moves it;
     - at 1440, a focused slider's ring is whole inside the sticky column of
       knobs (its left 2px were cut off). */
{
  const fails = [];
  const said = {};
  const SPARE = 16;
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(400);
    return ev(`State.view`);
  };
  const frames = `new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`;
  const fresh = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); window.prompt = () => null; return true; })()`);
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    /* One screen at 360×640, and nothing moves under the thumb — in the
       page's font and in Verdana, as E5 does (face()). CI's Linux runner has
       neither Inter nor Segoe UI, and its sans is as wide as Verdana: there
       the Input picker took a second line, the evidence tag and the notes
       wrapped, and the last result ended up to 60px below the screen, which
       no run on this machine's fonts could see (CI run 37252405895, 5 Oct
       2026). In Verdana each knob's last result also keeps 16px of the
       screen spare, so a sans wider still is caught here, not on CI. */
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true }, sessionId);
    await load('/property/lab');
    await fresh();
    said.knobs = [];
    for (const font of [null, 'Verdana, sans-serif'])
    for (const k of ['price', 'downPct', 'ratePct', 'rent', 'renovation']) {
      const view = await load('/property/lab');
      if (view !== 'propertyLab') { fails.push(`360×640: /property/lab opened ${view}`); break; }
      const at = `360×640${font ? ' in Verdana' : ''}`;
      if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
      const r = await ev(`(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        /* As Safari, which anchors no scroll: Chrome's anchoring hid a line
           added above the sliders at the first tick (43px at 360). */
        document.documentElement.style.overflowAnchor = 'none'; document.body.style.overflowAnchor = 'none';
        const radio = document.getElementById('lab-in-${k}');
        if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await ${frames}; }
        const bar = [...document.querySelectorAll('.appbar, .topbar')].filter(n => n.getClientRects().length && getComputedStyle(n).position !== 'static').map(n => n.getBoundingClientRect().bottom);
        const under = Math.max(0, ...bar);
        const pick = document.querySelector('.lab-pick-input');
        window.scrollTo(0, pick.getBoundingClientRect().top + scrollY - under);
        await ${frames};
        const at = () => {
          const range = document.getElementById('lab-r-${k}').getBoundingClientRect();
          const vals = [...document.querySelectorAll('#lab-root .lab-chain [data-lab]')].filter(n => n.dataset.lab !== 'grade').map(n => { const b = n.getBoundingClientRect(); return [n.dataset.lab, Math.round(b.top), Math.round(b.bottom)]; });
          return { range: [Math.round(range.top), Math.round(range.bottom)], vals };
        };
        const before = at();
        const rg = document.getElementById('lab-r-${k}');
        const step = Number(rg.step), v = Number(rg.value);
        rg.value = String(v + step <= Number(rg.max) ? v + step : v - step);
        rg.dispatchEvent(new Event('input', { bubbles: true }));
        await ${frames};
        return { under: Math.round(under), vh: (() => { const d = document.querySelector('body > .dock'); return d && d.getClientRects().length && getComputedStyle(d).position === 'fixed' ? Math.round(d.getBoundingClientRect().top) : innerHeight; })(), before, after: at(), moved: Object.keys(labActive(LAB[labSubject]).moves),
          face: getComputedStyle(document.querySelector('#lab-root .lab-val')).fontFamily };
      })()`);
      said.knobs.push([`${k}${font ? ' (Verdana)' : ''}`, Math.max(...r.after.vals.map(v => v[2]))]);
      if (font && !/Verdana/.test(r.face)) fails.push(`${at}, ${k}: the results were drawn in ${r.face}, not Verdana`);
      if (!r.moved.includes(k)) fails.push(`${at}, ${k}: one tick moved nothing (${r.moved.join(', ')})`);
      const foot = r.vh - (font ? SPARE : 0);
      for (const [name, s] of [['unmoved', r.before], ['after one tick', r.after]]) {
        if (s.range[0] < r.under || s.range[1] > r.vh) fails.push(`${at}, ${k} ${name}: the slider sits at ${s.range.join('–')}, the screen below the topbar is ${r.under}–${r.vh}`);
        s.vals.filter(([, t, b]) => t < r.under || b > foot).forEach(([f, t, b]) => fails.push(`${at}, ${k} ${name}: ${f} sits at ${t}–${b}, ${b > r.vh ? 'off the screen' : `inside the ${SPARE}px kept spare at its foot`}`));
      }
      const shift = r.after.vals.map((v, i) => Math.abs(v[1] - r.before.vals[i][1])).concat([Math.abs(r.after.range[0] - r.before.range[0])]);
      if (Math.max(...shift) > 1) fails.push(`${at}, ${k}: the first tick of a drag moved the slider or the results by ${Math.max(...shift)}px`);
    }
    /* What left the one screen is one tap away: at 360×640, "About" on the
       renovation knob is a 44px button that opens, right after the knob's
       tags, the span with its basis and the note on what the budget moves,
       and closes them again — the slider still described by the span while
       the panel is closed, and the keyboard left on the button. */
    {
      await load('/property/lab');
      const a = await ev(`(async () => {
        const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const radio = document.getElementById('lab-in-renovation');
        if (!radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await frames(); }
        const knob = document.getElementById('lab-knob-renovation'), btn = document.getElementById('lab-about-btn-renovation'), panel = document.getElementById('lab-about-renovation');
        if (!btn || !panel) return { missing: true };
        const range = document.getElementById('lab-r-renovation');
        const describes = (range.getAttribute('aria-describedby') || '').split(' ').includes('lab-span-renovation') && panel.contains(document.getElementById('lab-span-renovation'));
        const b = btn.getBoundingClientRect();
        const closed = { shown: !!panel.getClientRects().length, expanded: btn.getAttribute('aria-expanded') };
        btn.focus(); btn.click(); await frames();
        const open = { shown: !!panel.getClientRects().length, expanded: btn.getAttribute('aria-expanded'), text: panel.innerText.replace(/\\s+/g, ' ').trim(),
          afterTags: !!(knob.querySelector('.lab-knob-ft').compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING), focus: document.activeElement === btn,
          inside: panel.getBoundingClientRect().right <= document.documentElement.clientWidth };
        btn.click(); await frames();
        const again = { shown: !!panel.getClientRects().length, expanded: btn.getAttribute('aria-expanded') };
        return { size: [Math.round(b.width), Math.round(b.height)], name: btn.textContent.replace(/\\s+/g, ' ').trim(), describes, closed, open, again };
      })()`);
      said.about = a;
      if (a.missing) fails.push('360×640: the renovation knob has no "About" button and panel');
      else {
        if (a.size[0] < 43.5 || a.size[1] < 43.5) fails.push(`360×640: "About" is ${a.size.join('×')}px`);
        if (a.closed.shown || a.closed.expanded !== 'false') fails.push(`360×640: the renovation's panel is open before "About" is pressed (${JSON.stringify(a.closed)})`);
        if (!a.open.shown || a.open.expanded !== 'true') fails.push(`360×640: "About" did not open its panel (${JSON.stringify(a.open).slice(0, 160)})`);
        if (!/nothing to twice as saved/.test(a.open.text) || !/Moves the cash required/.test(a.open.text)) fails.push(`360×640: the open panel does not hold the span and the renovation's note: "${a.open.text.slice(0, 160)}"`);
        if (!a.open.afterTags) fails.push('360×640: the panel does not follow the knob\'s tags in the reading order');
        if (!a.open.focus) fails.push('360×640: pressing "About" moved the keyboard off it');
        if (!a.open.inside) fails.push('360×640: the open panel runs past the screen\'s right edge');
        if (a.again.shown || a.again.expanded !== 'false') fails.push('360×640: "About" pressed again did not close its panel');
        if (!a.describes) fails.push('360×640: the renovation slider is not described by its span, in the panel');
      }
      /* With the lender-limits note in "About", the deposit still says it is
         computed, not approved, in sight beside its evidence tag — at 0% too,
         the case the note is for — and the tag holds its place as the slider
         moves (the release re-check of 5 Oct 2026). */
      const d = await ev(`(async () => {
        const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const radio = document.getElementById('lab-in-downPct');
        if (!radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await frames(); }
        const knob = document.getElementById('lab-knob-downPct'), tag = knob?.querySelector('.lab-tag-gap');
        if (!tag) return { missing: true };
        const at = () => { const b = tag.getBoundingClientRect(); return { seen: !!tag.getClientRects().length && getComputedStyle(tag).visibility === 'visible', top: Math.round(b.top), right: Math.round(b.right), text: tag.textContent }; };
        const before = at();
        const rg = document.getElementById('lab-r-downPct'); rg.value = '0'; rg.dispatchEvent(new Event('input', { bubbles: true })); await frames();
        const zero = at();
        const back = document.getElementById('lab-back-downPct'); back?.click(); await frames();
        return { before, zero, vw: document.documentElement.clientWidth };
      })()`);
      said.depositGap = d;
      if (d.missing) fails.push('360×640: the deposit knob has no "Computed, not approved" tag');
      else {
        if (!d.before.seen || !d.zero.seen || d.zero.text !== 'Computed, not approved') fails.push(`360×640: the deposit's "Computed, not approved" is not in sight (${JSON.stringify(d.zero)})`);
        if (d.zero.top !== d.before.top) fails.push(`360×640: the deposit's tag moved ${d.zero.top - d.before.top}px when the deposit went to 0%`);
        if (d.zero.right > d.vw) fails.push(`360×640: the deposit's tag runs past the screen (${d.zero.right} > ${d.vw})`);
      }
    }
    /* The keyboard and the page after a save, at 390. */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await fresh();
    await load('/property/lab');
    const id = await ev(`(() => { newPropertyDeal({ show: false }); return saveActiveProperty({ name: 'Mobile verify' }).id; })()`);
    /* B moved and saved as a scenario; and A, unmoved, saved as the property —
       after which A, the property as saved, has nothing to save. */
    for (const [what, path, button] of [['Save B as a scenario', `/property/lab?model=${id}`, 'lab-save'], ['Save this property first', '/property/lab', 'lab-save-first']]) {
      if (button === 'lab-save-first') await ev(`(() => { newPropertyDeal({ show: false }); return true; })()`);
      await load(path);
      const r = await ev(`(async () => {
        document.documentElement.style.scrollBehavior = 'auto';
        if (${JSON.stringify(button)} === 'lab-save') {
          const radio = document.getElementById('lab-in-rent'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await ${frames};
          const n = document.getElementById('lab-n-rent'); n.value = '2300'; n.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await ${frames};
        } else { const a = document.getElementById('lab-col-A'); a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); await ${frames}; }
        const btn = document.getElementById('${button}');
        btn.scrollIntoView({ block: 'center' }); await ${frames};
        btn.focus(); btn.click(); await ${frames};
        const field = document.activeElement?.id;
        const y0 = scrollY;
        document.getElementById('lab-name-save').click(); await ${frames}; await new Promise(r => setTimeout(r, 200));
        const a = document.activeElement;
        return { field, focus: a === document.body ? 'BODY' : a?.id || a?.tagName, inLab: !!a?.closest?.('.lab'), dy: Math.round(scrollY - y0) };
      })()`);
      said[what] = r;
      if (r.focus === 'BODY' || !r.inLab) fails.push(`390: after "${what}" the keyboard is on ${r.focus}`);
      if (Math.abs(r.dy) > 300) fails.push(`390: after "${what}" the page jumped ${r.dy}px`);
    }
    /* Each part of a stack, light and dark. */
    for (const dark of [false, true]) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
      await fresh();
      await load('/property/lab');
      for (const metric of ['entry', 'appreciation']) {
        const r = await ev(`(async () => {
          const n = document.getElementById('lab-n-renovation'); n.value = '40000'; n.dispatchEvent(new Event('change', { bubbles: true })); await ${frames};
          const radio = document.getElementById('lab-by-${metric}'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await ${frames};
          const cv = document.createElement('canvas'); cv.width = cv.height = 1;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
          const over = (fg, bg) => fg[3] >= 1 ? fg : [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
          const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
          const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
          const bgOf = (n) => { for (let p = n; p; p = p.parentElement) { const c = rgba(getComputedStyle(p).backgroundColor); if (c[3] > 0) return over(c, [255, 255, 255, 1]); } return [255, 255, 255, 1]; };
          const words = [...document.querySelectorAll('#lab-root .lab-cmp-words p')].map(p => p.textContent).find(t => /^Each bar/.test(t)) || '';
          const out = { words, rows: [] };
          for (const row of document.querySelectorAll('#lab-root .lab-cmp-barrow')) {
            const segs = [...row.querySelectorAll('.lab-bar-seg')];
            if (segs.length < 3) continue;
            const track = segs[0].parentElement, tb = bgOf(track), card = bgOf(track.closest('.card'));
            const fill = segs.map(s => over(rgba(getComputedStyle(s).backgroundColor), tb));
            const edge = (getComputedStyle(segs[2]).boxShadow.match(/rgba?\\([^)]*\\)/) || [null])[0];
            const e = edge ? over(rgba(edge), tb) : null;
            out.rows.push({ col: row.className.match(/lab-c-(.)/)[1], lum: fill.map(f => +lum(f).toFixed(3)), track: fill.map(f => +ratio(f, tb).toFixed(2)), card: fill.map(f => +ratio(f, card).toFixed(2)),
              edge: e ? [+ratio(e, tb).toFixed(2), +ratio(e, card).toFixed(2)] : null });
          }
          return out;
        })()`);
        const theme = dark ? 'dark' : 'light';
        if (!r.rows.length) { fails.push(`${theme} ${metric}: no stack with three parts was drawn`); continue; }
        for (const x of r.rows) {
          if (/\(darker\)/.test(r.words) && !(x.lum[1] < x.lum[0])) fails.push(`${theme} ${metric} ${x.col}: the legend calls the second part darker, and it is lighter (luminance ${x.lum.join(', ')})`);
          if (/\(lighter\)/.test(r.words) && !(x.lum[2] > x.lum[0])) fails.push(`${theme} ${metric} ${x.col}: the legend calls the third part lighter, and it is darker (luminance ${x.lum.join(', ')})`);
          if (/stronger shade/.test(r.words) && !(x.track[1] > x.track[0])) fails.push(`${theme} ${metric} ${x.col}: the legend calls the second part the stronger shade, and it is the weaker against the track (${x.track.join(', ')})`);
          if (/outlined/.test(r.words) && !x.edge) fails.push(`${theme} ${metric} ${x.col}: the legend calls the third part outlined, and it has no edge`);
          const told = [[x.track[0], x.card[0]], [x.track[1], x.card[1]], x.edge || [x.track[2], x.card[2]]];
          told.forEach(([t, c], i) => { if (!(t >= 3 && c >= 3)) fails.push(`${theme} ${metric} ${x.col}: part ${i + 1} is ${t}:1 against its track and ${c}:1 against its card, under 3:1`); });
        }
        said[`${theme} ${metric}`] = r.words;
      }
    }
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    /* The calculator's way into the lab, on a phone. */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await fresh();
    await load('/property/calculator');
    await ev(`(() => { newPropertyDeal({ show: false }); const rec = saveActiveProperty({ name: 'Mobile link' }); pmAddScenario(rec.id, { rent: 2100, touched: { rent: true } }, 'Rent 2100'); return true; })()`);
    await load('/property/calculator');
    const link = await ev(`(() => { const a = document.getElementById('pm-sc-lab'); if (!a) return null; const b = a.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })()`);
    said.link = link;
    if (!link) fails.push('390: the calculator draws no "Open these in the Scenario Lab"');
    else if (link[0] < 43.5 || link[1] < 43.5) fails.push(`390: "Open these in the Scenario Lab" is ${link[0]}×${link[1]}px`);
    /* A swipe up the page that starts on a slider, by touch. */
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    try {
      await fresh();
      await load('/property/lab');
      const geom = () => ev(`(() => { document.documentElement.style.scrollBehavior = 'auto'; const r = document.getElementById('lab-r-price'); r.scrollIntoView({ block: 'center' }); const q = r.getBoundingClientRect();
        return { x: q.left, y: q.top + q.height / 2, w: q.width, min: +r.min, max: +r.max, v: +r.value, price: labActive(LAB[labSubject]).work.price }; })()`);
      const touch = async (type, x, y) => { await send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }, sessionId); await ev(frames); };
      const thumb = (g) => g.x + 14 + ((g.v - g.min) / (g.max - g.min)) * (g.w - 28);
      let g = await geom(); await sleep(300); g = await geom();
      const xs = Math.min(g.x + g.w - 6, thumb(g) + 40);
      await touch('touchStart', xs, g.y);
      for (let i = 1; i <= 8; i++) await touch('touchMove', xs + 2, g.y - i * 25);
      await touch('touchEnd', xs + 2, g.y - 200);
      await sleep(300);
      const swiped = await ev(`labActive(LAB[labSubject]).work.price`);
      said.swipe = [g.price, swiped];
      if (swiped !== g.price) fails.push(`390 by touch: a swipe up the page that started on the price slider moved the price ${g.price} → ${swiped}`);
      g = await geom(); await sleep(200); g = await geom();
      const x0 = thumb(g);
      await touch('touchStart', x0, g.y);
      for (let i = 1; i <= 8; i++) await touch('touchMove', x0 + i * 8, g.y);
      await touch('touchEnd', x0 + 64, g.y);
      await sleep(300);
      const dragged = await ev(`labActive(LAB[labSubject]).work.price`);
      said.drag = [g.price, dragged];
      if (dragged === g.price) fails.push(`390 by touch: a sideways drag on the price slider left the price at ${dragged}`);
    } finally { await send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId).catch(() => {}); }
    /* The ring of a focused slider in the sticky column, at 1440. */
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await fresh();
    await load('/property/lab');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    const ring = await ev(`(() => {
      const r = document.getElementById('lab-r-price'); r.focus({ focusVisible: true });
      const box = r.closest('.lab-inputs'), cs = getComputedStyle(r), bs = getComputedStyle(box);
      const reach = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
      const rb = r.getBoundingClientRect(), bb = box.getBoundingClientRect();
      const inner = { left: bb.left + parseFloat(bs.borderLeftWidth), right: bb.right - parseFloat(bs.borderRightWidth) };
      const clips = bs.overflowX !== 'visible';
      return { clips, outline: cs.outlineStyle, reach, leftRoom: +(rb.left - inner.left).toFixed(1), rightRoom: +(inner.right - rb.right).toFixed(1) };
    })()`);
    said.ring = ring;
    if (ring.outline === 'none') fails.push('1440: the focused slider has no ring');
    else if (ring.clips && (ring.leftRoom < ring.reach || ring.rightRoom < ring.reach)) fails.push(`1440: the column of knobs cuts the focused slider's ring — ${ring.leftRoom}px of room on the left and ${ring.rightRoom}px on the right for a ring reaching ${ring.reach}px`);
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL scenario-lab-verify — the Scenario Lab as the verification found it: ${fails.length} problem(s):`); fails.slice(0, 40).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   scenario-lab-verify: at 360×640, the Input picker under the topbar, each of the five knobs keeps its slider and all seven results on one screen, in the page's font and in Verdana with ${SPARE}px spare (the last ending at ${said.knobs.map(([k, b]) => `${k} ${b}`).join(', ')}) and nothing moves on the first tick of a drag; "About" (${said.about.size.join('×')}px) opens the renovation's span and note after its tags and closes them; after "Save B as a scenario" and "Save this property first" the keyboard stays in the panel (${said['Save B as a scenario'].focus}, ${said['Save this property first'].focus}) and the page moves ${said['Save B as a scenario'].dy}px and ${said['Save this property first'].dy}px; in light and dark every part of a stack holds 3:1 where it is told apart and its legend ("${said['dark entry']}") is true of what is drawn; "Open these in the Scenario Lab" is ${said.link.join('×')}px; by touch a swipe up the page leaves the price at ${said.swipe[1]} and a sideways drag moves it to ${said.drag[1]}; at 1440 the focused slider's ring has ${said.ring.leftRoom}px of room for its ${said.ring.reach}px`);
}
/* ---- end scenario-lab-verify ---- */
/* ---- batch1-phone ---- */
/* TWO THINGS A WIDE SANS PUSHED OUT (batch 1, 6 Oct 2026). CI's Linux sans
   is as wide as Verdana, and both of these fit in this machine's fonts:
     - at 360×640, the Lab's rate typed to 0%: its warning stays whole and in
       sight, and the last of the seven results still ends on the screen (it
       ended 3px below it in Verdana);
     - the app bar's Search button at 360, 375, 390 and 430: its word is
       either whole inside the button or not shown — never cut by its edge
       (it ran 25px out at 375 and 10px at 390 in Verdana) — the magnifier is
       whole inside it, and the button is a 44px target. */
{
  const fails = [], said = { lab: [], search: [] };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(400);
    return ev('State.view');
  };
  const face = (font) => (font ? ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`) : null);
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: true }, sessionId);
    await load('/property/lab');
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`);
    for (const font of [null, 'Verdana, sans-serif']) {
      const at = `360×640${font ? ' in Verdana' : ''}`;
      if (await load('/property/lab') !== 'propertyLab') { fails.push(`${at}: /property/lab did not open the Lab`); continue; }
      await face(font);
      const r = await ev(`(async () => {
        const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        document.documentElement.style.scrollBehavior = 'auto';
        document.documentElement.style.overflowAnchor = 'none'; document.body.style.overflowAnchor = 'none';
        const radio = document.getElementById('lab-in-ratePct');
        if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await frames(); }
        const nb = document.querySelector('#lab-knob-ratePct input[type=number]');
        nb.value = '0'; nb.dispatchEvent(new Event('input', { bubbles: true })); nb.dispatchEvent(new Event('change', { bubbles: true }));
        await frames(); await new Promise(r => setTimeout(r, 300)); await frames();
        const bar = [...document.querySelectorAll('.appbar, .topbar')].filter(n => n.getClientRects().length && getComputedStyle(n).position !== 'static').map(n => n.getBoundingClientRect().bottom);
        const under = Math.max(0, ...bar);
        window.scrollTo(0, document.querySelector('.lab-pick-input').getBoundingClientRect().top + scrollY - under);
        await frames();
        const warn = document.querySelector('#lab-knob-ratePct .lab-note-warn');
        const w = warn && warn.getClientRects().length ? warn.getBoundingClientRect() : null;
        const vals = [...document.querySelectorAll('#lab-root .lab-chain [data-lab]')].filter(n => n.dataset.lab !== 'grade').map(n => { const b = n.getBoundingClientRect(); return [n.dataset.lab, Math.round(b.top), Math.round(b.bottom)]; });
        return { under: Math.round(under), vh: (() => { const d = document.querySelector('body > .dock'); return d && d.getClientRects().length && getComputedStyle(d).position === 'fixed' ? Math.round(d.getBoundingClientRect().top) : innerHeight; })(), rate: nb.value, warn: w ? [Math.round(w.top), Math.round(w.bottom), warn.textContent] : null, vals };
      })()`);
      said.lab.push([font ? 'Verdana' : 'page font', Math.max(...r.vals.map(v => v[2]))]);
      if (r.rate !== '0') fails.push(`${at}: the rate did not take 0 (it reads ${r.rate})`);
      if (!r.warn) fails.push(`${at}: at a 0% rate the Lab shows no warning`);
      else {
        if (!/^The rate is 0%\. If that was intended, the repayment is right; if not, it is roughly half what it should be — the model cannot tell the two apart\.$/.test(r.warn[2])) fails.push(`${at}: the 0% warning reads "${r.warn[2]}"`);
        if (r.warn[0] < r.under || r.warn[1] > r.vh) fails.push(`${at}: the 0% warning sits at ${r.warn[0]}–${r.warn[1]}, the screen below the topbar is ${r.under}–${r.vh}`);
      }
      r.vals.filter(([, t, b]) => t < r.under || b > r.vh).forEach(([f, t, b]) => fails.push(`${at}, rate 0%: ${f} sits at ${t}–${b}, off the ${r.under}–${r.vh} screen`));
    }
    for (const w of [360, 375, 390, 430]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId);
      for (const font of [null, 'Verdana, sans-serif']) {
        const at = `${w}${font ? ' in Verdana' : ''}`;
        await load('/app');
        await face(font);
        const r = await ev(`(async () => {
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const b = document.querySelector('.appbar .appbar-search');
          if (!b || !b.getClientRects().length) return null;
          const box = b.getBoundingClientRect(), label = b.querySelector('.appbar-search-label'), icon = b.querySelector('svg').getBoundingClientRect();
          const l = label && label.getClientRects().length ? label.getBoundingClientRect() : null;
          const inside = (x) => x.left >= box.left - 0.5 && x.right <= box.right + 0.5 && x.top >= box.top - 0.5 && x.bottom <= box.bottom + 0.5;
          const outside = (x) => x.top >= box.bottom - 0.5 || x.bottom <= box.top + 0.5 || x.left >= box.right - 0.5 || x.right <= box.left + 0.5;
          return { size: [Math.round(box.width), Math.round(box.height)], word: !l ? 'not drawn' : inside(l) ? 'whole' : outside(l) ? 'not shown' : 'cut',
            icon: inside(icon), name: b.getAttribute('aria-label') };
        })()`);
        if (!r) { fails.push(`${at}: /app shows no app-bar Search button`); continue; }
        said.search.push(`${at} ${r.word}`);
        if (r.word === 'cut') fails.push(`${at}: the Search button's word is cut by its edge`);
        if (!r.icon) fails.push(`${at}: the Search button's magnifier runs out of it`);
        if (r.size[0] < 43.5 || r.size[1] < 43.5) fails.push(`${at}: the Search button is ${r.size.join('×')}px`);
        if (!/^Search /.test(r.name || '')) fails.push(`${at}: the Search button has no name ("${r.name}")`);
      }
    }
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL batch1-phone — a wide sans on a phone: ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   batch1-phone: at 360×640 a 0% rate's warning stays whole and in sight and the seven results end on the screen (the last at ${said.lab.map(([f, b]) => `${b} in the ${f}`).join(', ')}); the app bar's Search word is whole or not shown, never cut, its magnifier whole and the button a 44px target (${said.search.join('; ')})`);
}
/* ---- end batch1-phone ---- */
/* ---- n3-first-view ---- */
/* /PROPERTY'S FIRST SCREEN (N3, the 5 Oct audit; the owner's decision D18).
   Property's landing opens the Scenario Lab on the calculator's deal, and a
   first visit sees, without scrolling, at 1440×900 and at 390×844, in the
   page's font and in Verdana (CI's Linux sans is as wide): the identity line,
   the four tiles — Cash required, Monthly position, Net yield, Next step —
   and the first slider, each whole inside the window. /property served the
   calculator, whose first field sat about 2,400px down at 1440 and 3,650px
   at 390. On a phone the identity line's Save and the next step are 44px
   targets, and nothing scrolls sideways.
   ON THE LAYOUT SYSTEM (7 Oct 2026): on a phone Save is the sticky action
   bar's (Analyse · Compare · Save this), and "the first screen" ends where
   the bar begins — the slider must be whole above it, not under it. The
   Lab's checks above measure the same screen (vh: the bar's top).
   THE TWO QUESTIONS (the property decision layer, P1; the owner's
   decisions of 7 and 9 Oct 2026) come first: at 1440 whole between the
   identity line and the tiles; on a phone folded into the identity line's
   one 44px summary line — "Residential · Subsale" and Change — whole on
   the first screen with everything above, and the first slider still whole
   above the bar, in the page's font and in Verdana. */
{
  const fails = [], said = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(400);
    return ev('State.view');
  };
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const [w, h] of [[1440, 900], [390, 844]]) for (const font of [null, 'Verdana, sans-serif']) {
      const at = `${w}×${h}${font ? ' in Verdana' : ''}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, sessionId);
      /* A first visit: nothing kept in this browser. */
      await load('/privacy');
      await forget();
      const view = await load('/property');
      if (view !== 'propertyLab') { fails.push(`${at}: /property opened ${view}, not the Scenario Lab`); continue; }
      if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
      const r = await ev(`(async () => {
        await document.fonts.ready;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const box = (n) => { if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
        const range = [...document.querySelectorAll('#views input[type=range]')].find(n => n.getClientRects().length);
        return { y: Math.round(scrollY), vw: innerWidth, vh: (() => { const d = document.querySelector('body > .dock'); return d && d.getClientRects().length && getComputedStyle(d).position === 'fixed' ? Math.round(d.getBoundingClientRect().top) : innerHeight; })(), over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          identity: box(document.querySelector('#views .lab-identity')), name: (document.getElementById('lab-status')?.textContent || '').trim(),
          questions: ['what', 'how'].map(q => box(document.getElementById('lab-q-' + q))),
          summary: box(document.querySelector('#views .lab-id-meta.has-sum')), summaryWords: (document.getElementById('lab-q-sum')?.textContent || '').trim(),
          change: box(document.getElementById('lab-q-change')), folded: document.getElementById('lab-q-change')?.getAttribute('aria-expanded') === 'false',
          tiles: [...document.querySelectorAll('#views .lab-tile')].map(n => ({ label: n.querySelector('.lab-tile-label')?.textContent.trim(), at: box(n) })),
          slider: box(range), sliderOf: range?.id || null,
          save: box(document.getElementById(innerWidth < 640 ? 'ls-act-save' : 'lab-id-save')), next: box(document.querySelector('#views .lab-tile-next')),
          face: getComputedStyle(document.querySelector('#views .lab-tile-val') || document.body).fontFamily };
      })()`);
      const whole = (b) => !!b && b.t >= 0 && b.b <= r.vh && b.l >= 0 && b.r <= r.vw;
      if (font && !/Verdana/.test(r.face)) fails.push(`${at}: the tiles were drawn in ${r.face}, not Verdana`);
      if (r.y !== 0) fails.push(`${at}: the page opened scrolled to ${r.y}px, not at its top`);
      if (!/^Sample deal/.test(r.name)) fails.push(`${at}: the identity line reads "${r.name.slice(0, 60)}", not the sample deal's on a first visit`);
      if (!whole(r.identity)) fails.push(`${at}: the identity line ${r.identity ? `(${r.identity.t}–${r.identity.b}px)` : '(none)'} is not whole in the first ${r.vh}px`);
      const labels = r.tiles.map(t => t.label);
      if (JSON.stringify(labels) !== JSON.stringify(['Cash required', 'Monthly position', 'Net yield', 'Next step'])) fails.push(`${at}: the tiles are ${JSON.stringify(labels)}`);
      r.tiles.forEach(t => { if (!whole(t.at)) fails.push(`${at}: the "${t.label}" tile ${t.at ? `(${t.at.t}–${t.at.b}px)` : ''} is not whole in the first ${r.vh}px`); });
      if (w >= 600) {
        r.questions.forEach((q, i) => { if (!whole(q)) fails.push(`${at}: "${['What are you buying?', 'How are you buying?'][i]}" ${q ? `(${q.t}–${q.b}px)` : '(none)'} is not whole in the first ${r.vh}px`); });
        if (r.questions[0] && r.identity && r.questions[0].t < r.identity.b - 1) fails.push(`${at}: the questions stand above the identity line`);
        if (r.questions[1] && r.tiles[0]?.at && r.questions[1].b > r.tiles[0].at.t + 1) fails.push(`${at}: the tiles stand above the questions`);
      } else {
        if (!whole(r.summary) || !r.change || r.summary.h < 43.5) fails.push(`${at}: the questions' summary line ${r.summary ? `(${r.summary.t}–${r.summary.b}px, ${r.summary.h}px high)` : '(none)'} is not a whole 44px line on the first screen`);
        if (r.summaryWords !== 'Residential · Subsale' || !r.folded) fails.push(`${at}: the summary reads "${r.summaryWords}"${r.folded ? '' : ' and the questions are open'} on a first visit, not "Residential · Subsale", folded`);
        if (r.questions.some(Boolean)) fails.push(`${at}: the questions are drawn open on a first visit`);
      }
      if (!whole(r.slider)) fails.push(`${at}: the first slider${r.sliderOf ? ` (#${r.sliderOf})` : ''} ${r.slider ? `(${r.slider.t}–${r.slider.b}px)` : '(none in sight)'} is not whole in the first ${r.vh}px`);
      if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
      if (w < 600) {
        if (!r.save || r.save.h < 43.5 || r.save.w < 43.5) fails.push(`${at}: Save (the action bar's, on a phone) is ${r.save ? `${r.save.w}×${r.save.h}px` : 'not there'}, not a 44px target`);
        if (!r.next || r.next.h < 43.5) fails.push(`${at}: the next step is ${r.next ? `${r.next.w}×${r.next.h}px` : 'not there'}, not a 44px target`);
      }
      said.push(`${at}: identity ${r.identity?.t}–${r.identity?.b}, ${w >= 600 ? `questions to ${r.questions[1]?.b}` : `summary ${r.summary?.t}–${r.summary?.b}`}, tiles to ${Math.max(...r.tiles.map(t => t.at?.b || 0))}, slider ${r.slider?.t}–${r.slider?.b} of ${r.vh}`);
    }
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL n3-first-view — /property's first screen (N3, D18): ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   n3-first-view: on a first visit /property opens the Scenario Lab, its identity line, the two questions (at 1440 whole; on a phone their 44px summary line, folded), its four tiles and its first slider whole on the first screen — ${said.join('; ')}; on a phone Save and the next step are 44px targets and nothing scrolls sideways`);
}
/* ---- end n3-first-view ---- */
/* ---- layout-system ---- */
/* THE QUANTUM RESPONSIVE LAYOUT SYSTEM, AS DRAWN (the owner's decision, 7
   Oct 2026; 37-layout-system.js). On the pages on the system — /property
   and /property/calculator — in the page's font and in Verdana (CI's Linux
   sans is as wide):
     - under 640px (360, 390, 430): the calculator's financing scenarios and
       its cost breakdown are cards, not a table — nothing in them scrolls
       sideways, and of the scenarios the entered one stands with the others
       behind a 44px "Compare …" button that brings them;
     - a row of tabs — the product's, the Lab's inputs and its "Compare by",
       the calculator's sections — is one line, never two;
     - the sticky action bar is in view at the foot of the window — Analyse,
       Compare, Save this — each a 44px target inside the screen, clear of
       the safe area, and nothing is under it: /property's first slider sits
       above it on the first screen, and so does the two questions' summary
       line (the property decision layer, P1), and at the end of each page
       the footer's last line does;
     - every word on the page is set in one of the scale's sizes (the
       --ls-* tokens at that width), at 390 and at 1440;
     - and at 1024 and 1440 no block of text runs wider than 70 characters
       (its width over its own font's "0").
   Each fails on 740ceab merged with main: the tables were tables, "Compare
   by" took two lines on a phone, there was no bar, sizes were 10–22px off
   any scale, and the claim ran 96ch, the lede 82ch, a body block 72ch. */
{
  const fails = [], said = { tables: 0, rows: 0, bars: 0, words: 0, blocks: 0 };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(500);
    return ev('State.view');
  };
  const face = (font) => (font ? ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`) : null);
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    /* 1. Phones. */
    for (const w of [360, 390, 430]) for (const font of [null, 'Verdana, sans-serif']) {
      const h = w === 360 ? 640 : w === 390 ? 844 : 932;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sessionId);
      await load('/privacy'); await forget();
      for (const path of ['/property', '/property/calculator']) {
        const at = `${w}×${h} ${path}${font ? ' in Verdana' : ''}`;
        const view = await load(path);
        if (view !== (path === '/property' ? 'propertyLab' : 'property')) { fails.push(`${at}: opened ${view}`); continue; }
        await face(font);
        const r = await ev(`(async () => {
          const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          document.documentElement.style.scrollBehavior = 'auto';
          const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
          const out = { vw: document.documentElement.clientWidth, vh: innerHeight, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
          /* The bar. */
          const bar = document.querySelector('body > .dock .ls-actbar');
          const dock = bar && bar.closest('.dock');
          out.bar = shown(bar) ? (() => { const b = dock.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), pos: getComputedStyle(dock).position,
            acts: [...bar.querySelectorAll('.ls-act')].map(a => { const x = a.getBoundingClientRect(); return { word: a.textContent.trim(), w: Math.round(x.width), h: Math.round(x.height), l: Math.round(x.left), r: Math.round(x.right), cut: a.querySelector('.ls-act-word') ? a.querySelector('.ls-act-word').scrollWidth > a.querySelector('.ls-act-word').clientWidth + 1 : false }; }) }; })() : null;
          /* Tab rows. */
          const rows = [['the product\\'s tabs', '#productTabs .ptabs-list'], ['the Lab\\'s inputs', '#views .lab-pick-input .lab-seg'], ['the Lab\\'s "Compare by"', '#views .lab-seg-by'], ['the calculator\\'s sections', '#views .pc-index-list']];
          out.rows = rows.map(([name, sel]) => { const n = document.querySelector(sel); if (!shown(n)) return [name, null];
            const tops = [...n.children].filter(shown).map(c => Math.round(c.getBoundingClientRect().top));
            return [name, { lines: new Set(tops.map(t => Math.round(t / 6))).size, spread: tops.length ? Math.max(...tops) - Math.min(...tops) : 0, n: tops.length }]; });
          /* Tables the system calls cards. */
          const tables = [...document.querySelectorAll('#views table')].filter(t => shown(t) && !t.closest('details:not([open])')).filter(t => /Margin of finance/.test(t.querySelector('thead')?.textContent || '') || /Total initial cash/.test(t.textContent));
          out.tables = tables.map(t => { const wrap = t.closest('.tablewrap') || t.parentElement; const rowsShown = [...t.querySelectorAll('tbody tr')].filter(shown);
            return { name: /Margin of finance/.test(t.textContent) ? 'financing scenarios' : 'cost breakdown', display: getComputedStyle(t).display,
              sideways: wrap.scrollWidth - wrap.clientWidth, right: Math.round(t.getBoundingClientRect().right), rows: rowsShown.length, all: t.querySelectorAll('tbody tr').length,
              more: (() => { const b = document.querySelector('[aria-controls="' + t.id + '"].ls-tcards-more'); if (!shown(b)) return null; const x = b.getBoundingClientRect(); return { w: Math.round(x.width), h: Math.round(x.height), id: t.id }; })() }; });
          /* The first slider on /property's first screen. */
          window.scrollTo(0, 0); await frames();
          const range = [...document.querySelectorAll('#views input[type=range]')].find(shown);
          out.slider = range && location.pathname === '/property' ? [Math.round(range.getBoundingClientRect().top), Math.round(range.getBoundingClientRect().bottom)] : null;
          const sumLine = document.querySelector('#views .lab-id-meta.has-sum');
          out.firstScreen = sumLine && shown(sumLine) && location.pathname === '/property' ? Math.round(sumLine.getBoundingClientRect().bottom) : null;
          /* The footer's end, at the page's end. */
          window.scrollTo(0, document.documentElement.scrollHeight); await frames(); await frames();
          const legal = [...document.querySelectorAll('body > .footer *')].filter(n => shown(n) && n.childElementCount === 0 && n.textContent.trim()).pop();
          out.footEnd = legal ? Math.round(legal.getBoundingClientRect().bottom) : null;
          out.barTopAtEnd = dock ? Math.round(dock.getBoundingClientRect().top) : null;
          return out;
        })()`);
        said.bars++;
        if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
        if (!r.bar) fails.push(`${at}: no action bar in view`);
        else {
          if (r.bar.pos !== 'fixed' || Math.abs(r.bar.bottom - r.vh) > 1) fails.push(`${at}: the action bar is not fixed to the foot of the window (${r.bar.pos}, ${r.bar.top}–${r.bar.bottom} of ${r.vh})`);
          const words = r.bar.acts.map(a => a.word);
          if (words.length !== 3 || !/^Analyse/.test(words[0]) || !/^Compare/.test(words[1]) || !/^Save/.test(words[2])) fails.push(`${at}: the bar's actions are ${JSON.stringify(words)}, not Analyse · Compare · Save`);
          r.bar.acts.forEach(a => {
            if (a.w < 43.5 || a.h < 43.5) fails.push(`${at}: "${a.word}" in the bar is ${a.w}×${a.h}px, not a 44px target`);
            if (a.l < 0 || a.r > r.vw) fails.push(`${at}: "${a.word}" runs out of the screen (${a.l}–${a.r} of ${r.vw})`);
            if (a.cut) fails.push(`${at}: "${a.word}" in the bar is cut short`);
          });
          if (r.slider != null && r.slider[1] > r.bar.top && r.slider[0] < r.vh) fails.push(`${at}: the first slider (${r.slider.join("–")}px) is under the action bar from ${r.bar.top}px`);
          if (r.firstScreen == null && path === '/property') fails.push(`${at}: no summary line of the two questions on /property's first screen`);
          else if (r.firstScreen != null && r.firstScreen > r.bar.top) fails.push(`${at}: the two questions' summary line ends at ${r.firstScreen}px, under the action bar from ${r.bar.top}px`);
          if (r.footEnd == null || r.footEnd > r.barTopAtEnd + 1) fails.push(`${at}: at the page's end the footer's last line ends at ${r.footEnd}px, under the bar from ${r.barTopAtEnd}px`);
        }
        r.rows.forEach(([name, x]) => { if (x && x.lines > 1) fails.push(`${at}: ${name} take ${x.lines} lines (their tops ${x.spread}px apart), not one`); else if (x) said.rows++; });
        if (path === '/property/calculator') {
          if (r.tables.length < 2) fails.push(`${at}: the financing scenarios and the cost breakdown were not both found (${r.tables.map(t => t.name).join(', ') || 'none'})`);
          for (const t of r.tables) {
            said.tables++;
            if (t.display === 'table') fails.push(`${at}: the ${t.name} is a table, not cards`);
            if (t.sideways > 1 || t.right > r.vw) fails.push(`${at}: the ${t.name} scrolls ${t.sideways}px sideways`);
            if (t.name === 'financing scenarios') {
              if (t.rows !== 1) fails.push(`${at}: the financing scenarios show ${t.rows} of ${t.all} cards, not the entered one alone`);
              if (!t.more || t.more.h < 43.5) fails.push(`${at}: the scenarios' "Compare …" button is ${t.more ? `${t.more.w}×${t.more.h}px` : 'not there'}`);
              else {
                const opened = await ev(`(async () => { document.querySelector('[aria-controls="${t.more.id}"]').click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                  const n = [...document.querySelectorAll('#${t.more.id} tbody tr')].filter(x => x.getClientRects().length).length; document.querySelector('[aria-controls="${t.more.id}"]').click(); return n; })()`);
                if (opened !== t.all) fails.push(`${at}: "Compare …" brought ${opened} of ${t.all} scenarios`);
              }
            }
          }
        }
      }
    }
    /* 2. The scale and the measure, at a phone's width and two desks'. */
    for (const [w, h] of [[390, 844], [1024, 800], [1440, 900]]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 }, sessionId);
      for (const path of ['/property', '/property/calculator']) {
        await load(path);
        const r = await ev(`(() => {
          const cs = getComputedStyle(document.documentElement);
          const tokens = ['--ls-hero', '--ls-title', '--ls-section', '--ls-metric', '--ls-body', '--ls-support', '--ls-meta'].map(t => parseFloat(cs.getPropertyValue(t))).filter(Number.isFinite);
          const views = document.getElementById('views');
          const off = new Map();
          const walker = document.createTreeWalker(views, NodeFilter.SHOW_TEXT);
          for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            const p = t.parentElement;
            if (!t.data.trim() || p.closest('svg, .sr-only, [hidden], option') || !p.getClientRects().length || getComputedStyle(p).visibility === 'hidden') continue;
            const r = document.createRange(); r.selectNodeContents(t); const b = r.getBoundingClientRect(); if (!b.width || !b.height) continue;
            const fs = parseFloat(getComputedStyle(p).fontSize);
            if (!tokens.some(x => Math.abs(x - fs) < 0.01)) { const k = fs + 'px ' + (p.className && typeof p.className === 'string' ? '.' + p.className.split(' ')[0] : p.tagName.toLowerCase()); if (!off.has(k)) off.set(k, t.data.trim().slice(0, 30)); }
          }
          /* The measure: a block of text, its width in its own font's "0". */
          const cv = document.createElement('canvas').getContext('2d');
          const wide = [];
          let blocks = 0;
          for (const n of views.querySelectorAll('p, li, dd, blockquote, figcaption, div')) {
            if (!n.getClientRects().length || n.closest('svg, .sr-only, table, [hidden]')) continue;
            const own = [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.data).join('').trim();
            if (n.tagName === 'DIV' && own.length < 40) continue;
            if ((n.textContent || '').trim().length < 70) continue;
            const s = getComputedStyle(n);
            cv.font = s.fontStyle + ' ' + s.fontWeight + ' ' + s.fontSize + ' ' + s.fontFamily;
            const ch = cv.measureText('0').width;
            const box = n.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
            blocks++;
            if (box / ch > 70.5) wide.push(Math.round(box / ch) + 'ch ' + n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').join('.') : '') + ' “' + n.textContent.trim().slice(0, 40) + '”');
          }
          return { tokens, off: [...off].slice(0, 12), nOff: off.size, wide: wide.slice(0, 8), nWide: wide.length, blocks };
        })()`);
        const at = `${w} ${path}`;
        if (r.tokens.length !== 7) fails.push(`${at}: the type scale's tokens are not defined (${r.tokens.length} of 7)`);
        if (r.nOff) fails.push(`${at}: ${r.nOff} sizes off the scale (${r.tokens.join(', ')}px): ${r.off.map(([k, t]) => `${k} “${t}”`).join('; ')}`);
        else said.words++;
        if (w >= 1024) { said.blocks += r.blocks; if (r.nWide) fails.push(`${at}: ${r.nWide} text blocks wider than 70 characters: ${r.wide.join('; ')}`); }
      }
    }
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL layout-system — the pages on the layout system: ${fails.length} problem(s):`); fails.slice(0, 40).forEach(f => console.log(`     ${f}`)); if (fails.length > 40) console.log(`     … and ${fails.length - 40} more`); }
  else console.log(`ok   layout-system: /property and /property/calculator at 360, 390 and 430, in the page's font and in Verdana — the action bar fixed at the window's foot with Analyse · Compare · Save, every action a 44px target on the screen and nothing under it (the first slider and the questions' summary line above it, the footer's end above it at the page's end; ${said.bars} pages); ${said.rows} tab rows on one line each; the financing scenarios and the cost breakdown cards, not tables (${said.tables}), the entered scenario alone until "Compare …" brings the others; every word in a size of the scale at 390, 1024 and 1440 (${said.words} pages); none of ${said.blocks} text blocks at 1024 and 1440 wider than 70 characters`);
}
/* ---- end layout-system ---- */
/* ---- p1-questions ---- */
/* THE TWO QUESTIONS, FIRST, AS DRAWN (the property decision layer, P1; the
   owner's decisions of 7 and 9 Oct 2026). On /property and
   /property/calculator, at 360×640, 390×844 and 430×932 and at 1440×900,
   in the page's font and in Verdana (CI's Linux sans is as wide):
     - from a desk the page's first form controls are the choices of "What
       are you buying?", then of "How are you buying?" — before every
       slider, field and other choice — each question's choices on one line;
     - on a phone the questions are folded into one summary line —
       "Residential · Subsale" and Change, a 44px target — and Change,
       pressed from the keyboard, opens them in place: nothing above the
       line moves, it says it is expanded, the first controls past it are
       "What are you buying?" then "How are you buying?", each one line of
       44px chips that scrolls sideways with its legend whole; Escape folds
       them and gives the keyboard back to Change;
     - the choices are drawn in Verdana when Verdana is forced, and the page
       never scrolls sideways;
     - and on a phone, Commercial chosen brings the commercial kinds as one
       more line of chips, the summary saying "Commercial".
   Each fails on 3d75b6a8, where neither page asks either question. */
{
  const fails = [], said = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(500);
    return ev('State.view');
  };
  const key = async (k, code, vk, text) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, sessionId);
    await sleep(250);
  };
  const face = (font) => (font ? ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`) : null);
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  const read = (prefix) => `(() => {
    const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const box = (n) => { if (!shown(n)) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) }; };
    const controls = [...document.querySelectorAll('#views input, #views select, #views textarea')].filter(n => n.type !== 'hidden' && shown(n));
    const order = [];
    for (const c of controls) { const g = c.closest('[data-pq]') ? (c.closest('[data-q]')?.dataset.q || '?') : 'other'; if (order[order.length - 1] !== g) order.push(g); }
    const q = (name) => { const fs = document.getElementById('${prefix}-q-' + name); if (!shown(fs)) return null;
      const seg = fs.querySelector('.pq-seg'), lg = fs.querySelector('legend');
      const opts = [...seg.children].filter(shown).map(o => { const b = o.getBoundingClientRect(); return { word: o.textContent.trim(), t: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) }; });
      return { chips: seg.classList.contains('ls-chips'), lines: new Set(opts.map(o => Math.round(o.t / 6))).size, opts, scrolls: seg.scrollWidth > seg.clientWidth + 1,
        legend: lg ? { words: lg.textContent.trim(), cut: lg.scrollHeight > lg.clientHeight + 1 || lg.scrollWidth > lg.clientWidth + 1 } : null,
        face: getComputedStyle(seg.querySelector('.lab-seg-opt')).fontFamily };
    };
    const change = document.getElementById('${prefix}-q-change');
    const line = change ? change.closest('.pq-sum, .lab-id-meta') : null;
    const above = [...document.querySelectorAll('#views h1, #views .lab-id-name, #views .pc-page > .ls-disclosure')].map(box).filter(Boolean).map(b => b.t);
    return { order: order.slice(0, 4), what: q('what'), how: q('how'), sub: q('sub'), over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      change: box(change), line: box(line), expanded: change?.getAttribute('aria-expanded') || null, controls: change?.getAttribute('aria-controls') || null,
      words: (document.getElementById('${prefix}-q-sum')?.textContent || '').trim(), focus: document.activeElement?.id || null, above };
  })()`;
  const chipsOk = (at, x, legend, want, phone, font) => {
    if (!x) { fails.push(`${at}: "${legend}" is not drawn`); return; }
    if (JSON.stringify(x.opts.map(o => o.word)) !== JSON.stringify(want)) fails.push(`${at}: "${legend}" offers ${JSON.stringify(x.opts.map(o => o.word))}`);
    if (!x.legend || x.legend.words !== legend || x.legend.cut) fails.push(`${at}: the legend ${x.legend ? `"${x.legend.words}"${x.legend.cut ? ' is cut' : ''}` : 'is missing'}`);
    if (x.lines !== 1) fails.push(`${at}: "${legend}"'s choices take ${x.lines} lines, not one`);
    if (phone) {
      if (!x.chips) fails.push(`${at}: "${legend}" is not a row of chips`);
      x.opts.forEach(o => { if (o.h < 43.5) fails.push(`${at}: "${o.word}" is ${o.w}×${o.h}px, not a 44px target`); });
    }
    if (font && !/Verdana/.test(x.face)) fails.push(`${at}: "${legend}" was drawn in ${x.face}, not Verdana`);
  };
  const W = [['what', 'What are you buying?', ['Residential', 'Commercial', 'Land']], ['how', 'How are you buying?', ['New development', 'Subsale', 'Auction']]];
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const [w, h] of [[360, 640], [390, 844], [430, 932], [1440, 900]]) for (const font of [null, 'Verdana, sans-serif']) {
      const phone = w < 640;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: phone }, sessionId);
      await load('/privacy'); await forget();
      for (const [path, prefix, view] of [['/property', 'lab', 'propertyLab'], ['/property/calculator', 'pc', 'property']]) {
        const at = `${w}×${h} ${path}${font ? ' in Verdana' : ''}`;
        const got = await load(path);
        if (got !== view) { fails.push(`${at}: opened ${got}`); continue; }
        await face(font);
        let r = await ev(read(prefix));
        if (phone) {
          /* Folded: the summary line, and no question drawn. */
          if (!r.change || !r.line || r.line.h < 43.5 || r.change.h < 43.5) fails.push(`${at}: the summary line is ${r.line ? `${r.line.h}px high` : 'not drawn'}, Change ${r.change ? `${r.change.h}px` : 'not drawn'} — not one 44px line`);
          if (r.words !== 'Residential · Subsale') fails.push(`${at}: the summary reads "${r.words}", not "Residential · Subsale"`);
          if (r.expanded !== 'false' || r.controls !== `${prefix}-q` || r.what || r.how) fails.push(`${at}: folded, the questions are ${r.what || r.how ? 'drawn' : 'hidden'} and Change says aria-expanded=${r.expanded}, aria-controls=${r.controls}`);
          const was = r;
          /* Opened from the keyboard. */
          await ev(`(() => { const b = document.getElementById('${prefix}-q-change'); b.scrollIntoView({ block: 'center', behavior: 'instant' }); b.focus(); return document.activeElement === b; })()`);
          const before = await ev(read(prefix));
          await key('Enter', 'Enter', 13, '\r');
          r = await ev(read(prefix));
          if (r.expanded !== 'true') fails.push(`${at}: Enter on Change left aria-expanded=${r.expanded}`);
          if (r.change?.t !== before.change?.t || r.line?.t !== before.line?.t || JSON.stringify(r.above) !== JSON.stringify(before.above)) fails.push(`${at}: opening moved what is above it (Change ${before.change?.t}→${r.change?.t}, the line ${before.line?.t}→${r.line?.t})`);
          if (r.order[0] !== 'what' || r.order[1] !== 'how') fails.push(`${at}: opened, the first controls are ${JSON.stringify(r.order)}, not "What are you buying?" then "How are you buying?"`);
          W.forEach(([n, legend, want]) => chipsOk(at, r[n], legend, want, true, font));
          if (r.over > 0) fails.push(`${at}: opened, the page scrolls ${r.over}px sideways`);
          /* Commercial (390 only): its kinds, and the summary says so. */
          if (w === 390) {
            await ev(`(() => { document.querySelector('label[for="${prefix}-q-what-commercial"]').click(); return true; })()`);
            await sleep(400);
            const c = await ev(read(prefix));
            if (!c.sub || !c.sub.chips || c.sub.lines !== 1 || c.sub.opts.some(o => o.h < 43.5)) fails.push(`${at}: Commercial chosen, its kinds are ${c.sub ? `${c.sub.lines} line(s), ${c.sub.opts.map(o => `${o.word} ${o.h}px`).join(', ')}` : 'not drawn'}`);
            if (!/^Commercial · Subsale$/.test(c.words) || c.expanded !== 'true') fails.push(`${at}: Commercial chosen, the summary reads "${c.words}" and the questions are ${c.expanded === 'true' ? 'open' : 'folded'}`);
            if (c.over > 0) fails.push(`${at}: Commercial chosen, the page scrolls ${c.over}px sideways`);
          }
          /* Escape folds them, the keyboard back on Change. */
          await ev(`(() => { const r = document.querySelector('#${prefix}-q-what input:checked'); r.focus(); return document.activeElement === r; })()`);
          await key('Escape', 'Escape', 27);
          const e = await ev(read(prefix));
          if (e.expanded !== 'false' || e.what || e.focus !== `${prefix}-q-change`) fails.push(`${at}: Escape left aria-expanded=${e.expanded}, the questions ${e.what ? 'drawn' : 'folded'}, the keyboard on #${e.focus}`);
          said.push(`${at.replace(' in Verdana', ' V')}: "${was.words}" ${was.line?.h}px`);
          await forget();
        } else {
          if (r.order[0] !== 'what' || r.order[1] !== 'how') fails.push(`${at}: the page's first controls are ${JSON.stringify(r.order)}, not "What are you buying?" then "How are you buying?"`);
          W.forEach(([n, legend, want]) => chipsOk(at, r[n], legend, want, false, font));
          if (r.change) fails.push(`${at}: the summary line's Change is drawn from a desk`);
          said.push(`${at.replace(' in Verdana', ' V')}: whole`);
        }
        if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
      }
    }
  } catch (e) {
    fails.push(`the check could not run: ${e.message}`);
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL p1-questions — the two questions first; on a phone one summary line that opens them (the property decision layer, P1): ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   p1-questions: on /property and /property/calculator, in the page's font and in Verdana — at 1440 the first controls are "What are you buying?" then "How are you buying?", each one line; at 360, 390 and 430 one 44px summary line, "Residential · Subsale" and Change, which Enter opens in place (nothing above it moves, aria-expanded true) onto the two questions first, each one line of 44px chips with its legend whole, Commercial adding its kinds and saying so, and Escape folds them with the keyboard back on Change; nothing scrolls the page sideways (${said.slice(0, 6).join('; ')} …)`);
}
/* ---- end p1-questions ---- */

/* ---- p3-auction ---- */
/* THE AUCTION RISK MODE ON A PHONE (the property decision layer, P3). A
   deal answered Auction with the Proclamation's terms entered, on
   /property (the Lab) and /property/calculator, at 360×640, 390×844 and
   430×932, in the page's font and in Verdana:
     - the auction section is drawn — the alert "Not final: 6 checks open",
       the effective acquisition cost and the true discount as L1 metric
       cards, the forfeiture exposure, the waterfall a row a step — and
       nothing on the page scrolls sideways; every waterfall row, card and
       input stands inside the section;
     - every control in it is a 44px target: the inputs, the deposit's two
       chips, each check's row, the calls to action; a kind badge reaches
       44px by its ::after;
     - the action bar stands at the window's foot, and on /property at
       390×844 the first slider is still whole above it on the first
       screen.
   Fails on a4a8d0b4, where Auction draws no auction section. */
{
  const fails = [], said = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(500);
    return ev('State.view');
  };
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  const TERMS = 'route:auction~reservePrice:420000~auctionDepositPct:10~auctionDepositOf:reserve~auctionBalanceDays:90~auctionComp1:600000~auctionComp2:640000~auctionRepairs:15000~arrearsMaintenance:3000~auctionHoldMonths:3';
  const read = (sec) => `(async () => {
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const box = (n) => { if (!shown(n)) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    const s = document.getElementById('${sec}');
    if (!s) return { none: true, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    const sb = s.getBoundingClientRect();
    const roots = [s, ...(document.getElementById('auction') ? [document.getElementById('auction')] : [])];
    const ctrls = roots.flatMap(r => [...r.querySelectorAll('input:not([type=checkbox]):not([type=radio]), .au-pick .lab-seg-opt, .au-check-row, .ls-cta, button, select')]).filter(shown);
    const small = ctrls.map(n => [n, n.getBoundingClientRect()]).filter(([, b]) => b.height < 43.5 || b.width < 43.5)
      .map(([n, b]) => (n.id || n.className || n.tagName) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
    const badges = roots.flatMap(r => [...r.querySelectorAll('a.kind-badge')]).filter(shown).filter(n => { const a = getComputedStyle(n, '::after'); return n.getBoundingClientRect().height + 24 < 43.5 || a.content === 'none' || a.position !== 'absolute'; }).length;
    const inside = [...s.querySelectorAll('.au-wf-row, .au-card, .au-field, .au-check-row, .ls-card')].filter(shown).filter(n => { const b = n.getBoundingClientRect(); return b.left < sb.left - 0.5 || b.right > sb.right + 0.5; }).map(n => n.dataset.step || n.dataset.au || n.className.split(' ')[0]);
    const bar = document.querySelector('.ls-actbar');
    const range = [...document.querySelectorAll('#views input[type=range]')].find(shown);
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, badges, inside,
      alert: (document.querySelector('#${sec} .au-alert .ls-card-title')?.textContent || '').trim(),
      l1: [...s.querySelectorAll('[data-au-fig][data-level="1"]')].map(n => n.dataset.auFig), forfeit: s.querySelector('[data-au-fig="forfeiture"] [data-value]')?.dataset.value || '',
      rows: s.querySelectorAll('.au-wf-row').length, controls: ctrls.length,
      bar: box(bar), barFixed: bar ? getComputedStyle(bar.closest('.dock') || bar).position : null, vh: innerHeight, slider: box(range),
      face: getComputedStyle(s.querySelector('.au-wf-amt') || s).fontFamily };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) for (const font of [null, 'Verdana, sans-serif']) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sessionId);
      await load('/privacy'); await forget();
      for (const [path, sec, view] of [['/property/calculator?d=' + TERMS, 'pc-au', 'property'], ['/property', 'lab-au', 'propertyLab']]) {
        const at = `${w}×${h} ${path.split('?')[0]}${font ? ' in Verdana' : ''}`;
        const got = await load(path);
        if (got !== view) { fails.push(`${at}: opened ${got}`); continue; }
        if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
        /* The first screen first: the slider above the bar (the Lab). */
        if (view === 'propertyLab') {
          const top = await ev(read(sec));
          if (w === 390 && (!top.slider || !top.bar || top.slider.t < 0 || top.slider.b > top.bar.t)) fails.push(`${at}: the first slider ${top.slider ? `(${top.slider.t}–${top.slider.b}px)` : '(none)'} is not whole above the action bar ${top.bar ? `(from ${top.bar.t}px)` : '(none)'} on the first screen`);
        }
        await ev(`(() => { const s = document.getElementById('${sec}'); if (s) s.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
        await sleep(200);
        const r = await ev(read(sec));
        if (r.none) { fails.push(`${at}: no auction section (#${sec}) for a deal answered Auction`); continue; }
        if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
        if (!/^Not final: 6 checks open$/.test(r.alert)) fails.push(`${at}: the alert reads "${r.alert}", not "Not final: 6 checks open"`);
        if (JSON.stringify(r.l1) !== '["effective","discount"]') fails.push(`${at}: the L1 cards are ${JSON.stringify(r.l1)}, not the effective acquisition cost and the true discount`);
        if (r.forfeit !== '42000') fails.push(`${at}: the forfeiture exposure reads "${r.forfeit}", not RM42,000`);
        if (r.rows !== 9) fails.push(`${at}: the waterfall has ${r.rows} rows, not 9`);
        if (r.small.length) fails.push(`${at}: ${r.small.length} of ${r.controls} controls under 44px: ${r.small.slice(0, 4).join('; ')}`);
        if (r.badges) fails.push(`${at}: ${r.badges} kind badge(s) without a 44px reach`);
        if (r.inside.length) fails.push(`${at}: outside the section's width: ${r.inside.slice(0, 4).join(', ')}`);
        if (!r.bar || r.barFixed !== 'fixed' || r.bar.b > r.vh + 0.5) fails.push(`${at}: the action bar is ${r.bar ? `${r.barFixed}, ${r.bar.t}–${r.bar.b}px of ${r.vh}` : 'not drawn'}`);
        if (font && !/Verdana/.test(r.face)) fails.push(`${at}: drawn in ${r.face}, not Verdana`);
        said.push(`${at.replace(' in Verdana', ' V')}: ${r.controls} controls`);
      }
    }
  } catch (e) {
    fails.push(`the check could not run: ${e.message}`);
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL p3-auction — the auction risk mode on a phone (the property decision layer, P3): ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   p3-auction: a deal answered Auction, its terms entered, on /property/calculator and /property at 360, 390 and 430, in the page's font and in Verdana — "Not final: 6 checks open", the effective acquisition cost and the true discount as L1 cards, the exposure RM42,000, the waterfall's 9 rows inside the section; every input, chip, check row and call to action a 44px target and every kind badge 44px by its reach; the action bar fixed at the foot, the first slider whole above it at 390×844; nothing scrolls sideways (${said.slice(0, 4).join('; ')} …)`);
}
/* ---- end p3-auction ---- */
/* ---- p4-newdev ---- */
/* THE DEVELOPER PREMIUM MODEL ON A PHONE (the property decision layer,
   P4). The sample deal answered New development, a completed comparable
   RM100,000 under its price, the SPA and VP months, and Sarawak's Form C
   template spaced to VP, on /property/calculator and /property (the Lab),
   at 360×640, 390×844 and 430×932, in the page's font and in Verdana:
     - the section is drawn — the developer premium (RM100,000) and the
       cash required as L1 metric cards, construction interest worked out,
       the exit values a row each (3) — and nothing on the page scrolls
       sideways; every card, row, field and stage stands inside the section;
     - every control in it is a 44px target: the inputs, the template's
       select, each stage's Remove, Add a stage, Apply this template,
       Space the stages evenly, the calls to action; a kind badge reaches
       44px by its ::after;
     - the action bar stands at the window's foot, and on /property at
       390×844 the first slider is still whole above it on the first
       screen.
   Fails on f11163b0, where New development draws no such section. */
{
  const fails = [], said = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(500);
    return ev('State.view');
  };
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  const TERMS = 'route:newdev~ndCompPrice:472000~ndCompDate:2026-08-01~ndSpaMonth:2026-10~ndVpMonth:2029-10~ndSchedule:10@0,15@4,20@8,20@12,10@16,10@20,5@24,5@28,2.5@32,2.5@36';
  const read = (sec) => `(async () => {
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const box = (n) => { if (!shown(n)) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    const s = document.getElementById('${sec}');
    if (!s) return { none: true, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    const sb = s.getBoundingClientRect();
    const roots = [s, ...(document.getElementById('newdev') ? [document.getElementById('newdev')] : [])];
    const ctrls = roots.flatMap(r => [...r.querySelectorAll('input:not([type=checkbox]):not([type=radio]), .ls-cta, button, select')]).filter(shown);
    const small = ctrls.map(n => [n, n.getBoundingClientRect()]).filter(([, b]) => b.height < 43.5 || b.width < 43.5)
      .map(([n, b]) => (n.id || n.className || n.tagName) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
    const badges = roots.flatMap(r => [...r.querySelectorAll('a.kind-badge')]).filter(shown).filter(n => { const a = getComputedStyle(n, '::after'); return n.getBoundingClientRect().height + 24 < 43.5 || a.content === 'none' || a.position !== 'absolute'; }).length;
    const inside = roots.flatMap(r => [...r.querySelectorAll('.au-wf-row, .au-card, .au-field, .nd-stage, .ls-card, .nd-tools')]).filter(shown).filter(n => { const p = n.closest('#${sec}, #newdev').getBoundingClientRect(); const b = n.getBoundingClientRect(); return b.left < p.left - 0.5 || b.right > p.right + 0.5; }).map(n => n.dataset.exit || n.dataset.nd || n.className.split(' ')[0]);
    const bar = document.querySelector('.ls-actbar');
    const range = [...document.querySelectorAll('#views input[type=range]')].find(shown);
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, badges, inside,
      l1: [...s.querySelectorAll('[data-nd-fig][data-level="1"]')].map(n => n.dataset.ndFig), premium: s.querySelector('[data-nd-fig="premium"] [data-value]')?.dataset.value || '',
      idc: s.querySelector('[data-nd-fig="idc"]')?.dataset.status || '', rows: s.querySelectorAll('.nd-exit .au-wf-row').length, stages: roots.flatMap(r => [...r.querySelectorAll('.nd-stage')]).length, controls: ctrls.length,
      dlp: !!s.querySelector('.nd-dlp'),
      bar: box(bar), barFixed: bar ? getComputedStyle(bar.closest('.dock') || bar).position : null, vh: innerHeight, slider: box(range),
      face: getComputedStyle(s.querySelector('.ls-card-value') || s).fontFamily };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) for (const font of [null, 'Verdana, sans-serif']) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sessionId);
      await load('/privacy'); await forget();
      for (const [path, sec, view] of [['/property/calculator?d=' + TERMS, 'pc-nd', 'property'], ['/property', 'lab-nd', 'propertyLab']]) {
        const at = `${w}×${h} ${path.split('?')[0]}${font ? ' in Verdana' : ''}`;
        const got = await load(path);
        if (got !== view) { fails.push(`${at}: opened ${got}`); continue; }
        if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
        if (view === 'propertyLab') {
          const top = await ev(read(sec));
          if (w === 390 && (!top.slider || !top.bar || top.slider.t < 0 || top.slider.b > top.bar.t)) fails.push(`${at}: the first slider ${top.slider ? `(${top.slider.t}–${top.slider.b}px)` : '(none)'} is not whole above the action bar ${top.bar ? `(from ${top.bar.t}px)` : '(none)'} on the first screen`);
        }
        await ev(`(() => { const s = document.getElementById('${sec}'); if (s) s.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
        await sleep(200);
        const r = await ev(read(sec));
        if (r.none) { fails.push(`${at}: no developer premium section (#${sec}) for a deal answered New development`); continue; }
        if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
        if (JSON.stringify(r.l1) !== '["premium","cash"]') fails.push(`${at}: the L1 cards are ${JSON.stringify(r.l1)}, not the developer premium and the cash required`);
        if (r.premium !== '100000') fails.push(`${at}: the premium reads "${r.premium}", not RM100,000`);
        if (r.idc !== 'ok') fails.push(`${at}: construction interest is ${r.idc}, not worked out`);
        if (r.rows !== 3) fails.push(`${at}: the exit values have ${r.rows} rows, not 3`);
        if (r.stages !== 10) fails.push(`${at}: the schedule has ${r.stages} stages, not Form C's 10`);
        if (!r.dlp) fails.push(`${at}: the defect liability line is not drawn`);
        if (r.small.length) fails.push(`${at}: ${r.small.length} of ${r.controls} controls under 44px: ${r.small.slice(0, 4).join('; ')}`);
        if (r.badges) fails.push(`${at}: ${r.badges} kind badge(s) without a 44px reach`);
        if (r.inside.length) fails.push(`${at}: outside the section's width: ${r.inside.slice(0, 4).join(', ')}`);
        if (!r.bar || r.barFixed !== 'fixed' || r.bar.b > r.vh + 0.5) fails.push(`${at}: the action bar is ${r.bar ? `${r.barFixed}, ${r.bar.t}–${r.bar.b}px of ${r.vh}` : 'not drawn'}`);
        if (font && !/Verdana/.test(r.face)) fails.push(`${at}: drawn in ${r.face}, not Verdana`);
        said.push(`${at.replace(' in Verdana', ' V')}: ${r.controls} controls`);
      }
    }
  } catch (e) {
    fails.push(`the check could not run: ${e.message}`);
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL p4-newdev — the developer premium model on a phone (the property decision layer, P4): ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   p4-newdev: a deal answered New development — a completed comparable, the SPA and VP months, Sarawak's Form C template spaced to VP — on /property/calculator and /property at 360, 390 and 430, in the page's font and in Verdana: the developer premium (RM100,000) and the cash required as L1 cards, construction interest worked out, 3 exit rows and the defect liability line inside the section; every input, select, stage control and call to action a 44px target and every kind badge 44px by its reach; the action bar fixed at the foot, the first slider whole above it at 390×844; nothing scrolls sideways (${said.slice(0, 4).join('; ')} …)`);
}
/* ---- end p4-newdev ---- */
/* ---- p5-commercial ---- */
/* THE COMMERCIAL MODELS ON A PHONE (the property decision layer, P5). A
   whole shoplot — tenanted at RM4,600 to April 2027, RM5,000 asked, a
   model rent of RM4,000, RM30,000 of fit-out — with two achieved rents of
   the reader's named, on /property/calculator and /property (the Lab), at
   360×640, 390×844 and 430×932, in the page's font and in Verdana:
     - the section is drawn — the net yield at the contract and at the model
       rent and the twelve-month reserve as the L1 metric cards,
       sustainability worked out, the four rents a row each, the lease-down
       four rows that are cards (its table's head out of sight) — and
       nothing on the page scrolls sideways; every card, row, field and
       lease-down card stands inside its section;
     - every control in it is a 44px target: the inputs, the evidence
       selects, the calls to action; a kind badge reaches 44px by its
       ::after;
     - the action bar stands at the window's foot, and on /property at
       390×844 the first slider is still whole above it on the first
       screen.
   Fails on ff0b6e6e, where no commercial section is drawn. */
{
  const fails = [], said = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(500);
    return ev('State.view');
  };
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  const TERMS = 'type=shophouse&d=rent:4000~commercialSubtype:whole-shoplot~tenancy:tenanted~tenancyRent:4600~cmLeaseExpiry:2027-04~cmFitOut:30000~cmAskingRent:5000';
  const RECORD = `(() => { const add = (v, dt) => addObservation({ city: 'kuching', area: 'Tabuan', kind: 'let-rent', value: v, date: dt, sourceRef: 'https://example.com/p5-mobile-' + v, evidence: 'user', scope: 'area' });
    return JSON.stringify([add(3740, '2026-06-01').id, add(4180, '2026-08-01').id]); })()`;
  const read = (sec) => `(async () => {
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const box = (n) => { if (!shown(n)) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    const s = document.getElementById('${sec}');
    if (!s) return { none: true, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    const roots = [s, ...(document.getElementById('commercial') ? [document.getElementById('commercial')] : [])];
    const ctrls = roots.flatMap(r => [...r.querySelectorAll('input:not([type=checkbox]):not([type=radio]), .ls-cta, button, select')]).filter(shown);
    const small = ctrls.map(n => [n, n.getBoundingClientRect()]).filter(([, b]) => b.height < 43.5 || b.width < 43.5)
      .map(([n, b]) => (n.id || n.className || n.tagName) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
    const badges = roots.flatMap(r => [...r.querySelectorAll('a.kind-badge')]).filter(shown).filter(n => { const a = getComputedStyle(n, '::after'); return n.getBoundingClientRect().height + 24 < 43.5 || a.content === 'none' || a.position !== 'absolute'; }).length;
    const inside = roots.flatMap(r => [...r.querySelectorAll('.au-wf-row, .au-card, .au-field, .ls-card, .cm-ld-table tr, .comp-pick-row')]).filter(shown).filter(n => { const p = n.closest('#${sec}, #commercial').getBoundingClientRect(); const b = n.getBoundingClientRect(); return b.left < p.left - 0.5 || b.right > p.right + 0.5; }).map(n => n.dataset.cm || n.dataset.rent || n.dataset.months || n.className.split(' ')[0]);
    const bar = document.querySelector('.ls-actbar');
    const range = [...document.querySelectorAll('#views input[type=range]')].find(shown);
    const head = s.querySelector('.cm-ld-table thead');
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, badges, inside,
      l1: [...s.querySelectorAll('[data-cm-fig][data-level="1"]')].map(n => n.dataset.cmFig), sustain: s.querySelector('[data-cm-fig="sustain"]')?.dataset.status || '',
      r12: s.querySelector('[data-cm-fig="reserve-12"] [data-value]')?.dataset.value || '', rents: s.querySelectorAll('[data-rent]').length,
      cards: [...s.querySelectorAll('.cm-ld-table tbody tr')].filter(n => shown(n) && getComputedStyle(n).display === 'block').length, headHidden: !shown(head),
      controls: ctrls.length, bar: box(bar), barFixed: bar ? getComputedStyle(bar.closest('.dock') || bar).position : null, vh: innerHeight, slider: box(range),
      face: getComputedStyle(s.querySelector('.ls-card-value') || s).fontFamily };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) for (const font of [null, 'Verdana, sans-serif']) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sessionId);
      await load('/privacy'); await forget();
      const ids = await ev(RECORD);
      for (const [path, sec, view] of [['/property/calculator?' + TERMS, 'pc-cm', 'property'], ['/property', 'lab-cm', 'propertyLab']]) {
        const at = `${w}×${h} ${path.split('?')[0]}${font ? ' in Verdana' : ''}`;
        const got = await load(path);
        if (got !== view) { fails.push(`${at}: opened ${got}`); continue; }
        if (view === 'property') { await ev(`(() => { State.deal.rentComparableIds = ${ids}; saveDeal(); render(); return true; })()`); await sleep(500); }
        if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
        if (view === 'propertyLab') {
          const top = await ev(read(sec));
          if (w === 390 && (!top.slider || !top.bar || top.slider.t < 0 || top.slider.b > top.bar.t)) fails.push(`${at}: the first slider ${top.slider ? `(${top.slider.t}–${top.slider.b}px)` : '(none)'} is not whole above the action bar ${top.bar ? `(from ${top.bar.t}px)` : '(none)'} on the first screen`);
        }
        await ev(`(() => { const s = document.getElementById('${sec}'); if (s) s.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
        await sleep(200);
        const r = await ev(read(sec));
        if (r.none) { fails.push(`${at}: no commercial section (#${sec}) for a deal answered Commercial`); continue; }
        if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
        if (JSON.stringify(r.l1) !== '["yield-contract","yield-model","reserve-12"]') fails.push(`${at}: the L1 cards are ${JSON.stringify(r.l1)}, not the yield both ways and the twelve-month reserve`);
        if (r.sustain !== 'ok') fails.push(`${at}: sustainability is ${r.sustain}, not worked out`);
        if (!(Number(r.r12) > 30000)) fails.push(`${at}: the twelve-month reserve reads "${r.r12}"`);
        if (r.rents !== 4) fails.push(`${at}: ${r.rents} rent rows, not 4`);
        if (r.cards !== 4 || !r.headHidden) fails.push(`${at}: the lease-down is ${r.cards} card(s), its head ${r.headHidden ? 'hidden' : 'in sight'} — not four cards`);
        if (r.small.length) fails.push(`${at}: ${r.small.length} of ${r.controls} controls under 44px: ${r.small.slice(0, 4).join('; ')}`);
        if (r.badges) fails.push(`${at}: ${r.badges} kind badge(s) without a 44px reach`);
        if (r.inside.length) fails.push(`${at}: outside the section's width: ${r.inside.slice(0, 4).join(', ')}`);
        if (!r.bar || r.barFixed !== 'fixed' || r.bar.b > r.vh + 0.5) fails.push(`${at}: the action bar is ${r.bar ? `${r.barFixed}, ${r.bar.t}–${r.bar.b}px of ${r.vh}` : 'not drawn'}`);
        if (font && !/Verdana/.test(r.face)) fails.push(`${at}: drawn in ${r.face}, not Verdana`);
        said.push(`${at.replace(' in Verdana', ' V')}: ${r.controls} controls`);
      }
    }
  } catch (e) {
    fails.push(`the check could not run: ${e.message}`);
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL p5-commercial — the commercial models on a phone (the property decision layer, P5): ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   p5-commercial: a whole shoplot answered Commercial — tenanted at RM4,600 to Apr 2027, a model rent of RM4,000, two achieved rents named — on /property/calculator and /property at 360, 390 and 430, in the page's font and in Verdana: the yield both ways and the twelve-month reserve as L1 cards, sustainability worked out, 4 rent rows and the lease-down as 4 cards inside the section; every input, select and call to action a 44px target and every kind badge 44px by its reach; the action bar fixed at the foot, the first slider whole above it at 390×844; nothing scrolls sideways (${said.slice(0, 4).join('; ')} …)`);
}
/* ---- end p5-commercial ---- */
/* ---- p6-compare ---- */
/* ACROSS ROUTES AND ASSETS ON A PHONE (the property decision layer, P6).
   Three saved properties — a subsale condominium, an auction condominium,
   a tenanted whole shoplot — side by side on /property (?cols=), at
   360×640, 390×844 and 430×932, in the page's font and in Verdana:
     - one column at a time (the layout system: a phone sequences), chosen
       by the Show chips, one line that scrolls sideways; the lens chips one
       line too; every cell and header inside the card; nothing on the
       page scrolls sideways;
     - every control of the comparison, of adding a column from another
       property and of saving the comparison is a 44px target;
     - the action bar stands at the window's foot, and at 390×844 the first
       slider is whole above it on the first screen.
   Fails on 296147c0, where no column comes from another property. */
{
  const fails = [], said = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(500);
    return ev('State.view');
  };
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  const SEED = `(() => { const base = () => ({ ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {} });
    const save = (d, name) => { State.deal = d; saveDeal(); return saveActiveProperty({ name }).id; };
    const b = save({ ...base(), route: 'auction', price: 420000, reservePrice: 400000, auctionDepositPct: 10, auctionDepositOf: 'reserve', auctionBalanceDays: 90, auctionComp1: 520000, auctionComp2: 540000 }, 'Auction condominium, Batu Kawa');
    const c = save({ ...base(), propertyType: 'Shophouse', commercialSubtype: 'whole-shoplot', sqft: 1600, price: 900000, rent: 4000, tenancy: 'tenanted', tenancyRent: 4600, cmLeaseExpiry: '2027-04', cmFitOut: 20000 }, 'Whole shoplot, Jalan Song');
    const a = save(base(), 'Condominium, Tabuan — subsale');
    return JSON.stringify({ a, b, c }); })()`;
  const read = `(async () => {
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const box = (n) => { if (!shown(n)) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    const s = document.getElementById('lab-xr');
    const cols = document.querySelector('.lab-cols-card');
    if (!s) return { none: true, over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    const ctrls = [s, cols].flatMap(r => [...r.querySelectorAll('input:not([type=radio]):not([type=checkbox]), button, select, a, .lab-seg-opt')]).filter(shown);
    const small = ctrls.map(n => [n, n.getBoundingClientRect()]).filter(([, b]) => b.height < 43.5 || b.width < 43.5)
      .map(([n, b]) => (n.id || n.className || n.tagName) + ' ' + Math.round(b.width) + '×' + Math.round(b.height));
    const p = s.getBoundingClientRect();
    const inside = [...s.querySelectorAll('.lab-xr-cell, .lab-xr-colhd, .lab-xr-rowhd, .lab-xr-bar, .lab-pick')].filter(shown).filter(n => { const b = n.getBoundingClientRect(); return b.left < p.left - 0.5 || b.right > p.right + 0.5; }).map(n => n.className.split(' ')[0] + (n.dataset.row ? ':' + n.dataset.row : ''));
    const lines = (sel) => { const xs = [...s.querySelectorAll(sel + ' .lab-seg-opt')].filter(shown).map(n => Math.round(n.getBoundingClientRect().top)); return new Set(xs).size; };
    const bar = document.querySelector('.ls-actbar');
    const range = [...document.querySelectorAll('#views input[type=range]')].find(shown);
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, small, inside, controls: ctrls.length,
      shownCols: [...new Set([...s.querySelectorAll('.lab-xr-cell')].filter(shown).map(n => n.dataset.col))].join(''),
      allCols: [...new Set([...s.querySelectorAll('.lab-xr-cell')].map(n => n.dataset.col))].join(''),
      showChips: [...s.querySelectorAll('.lab-xr-show input')].length, lensLines: lines('.lab-pick-lens'), showLines: lines('.lab-xr-show'),
      bar: box(bar), barFixed: bar ? getComputedStyle(bar.closest('.dock') || bar).position : null, vh: innerHeight, slider: box(range),
      face: getComputedStyle(s.querySelector('.lab-xr-v') || s).fontFamily };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) for (const font of [null, 'Verdana, sans-serif']) {
      const at = `${w}×${h}${font ? ' in Verdana' : ''}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sessionId);
      await load('/privacy'); await forget();
      const ids = JSON.parse(await ev(SEED));
      /* /property, the calculator's deal (the condominium, saved last) with
         the other two beside it. */
      const got = await load(`/property?cols=pm:${ids.b},pm:${ids.c}`);
      if (got !== 'propertyLab') { fails.push(`${at}: opened ${got}`); continue; }
      if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
      const top = await ev(read);
      if (w === 390 && (!top.slider || !top.bar || top.slider.t < 0 || top.slider.b > top.bar.t)) fails.push(`${at}: the first slider ${top.slider ? `(${top.slider.t}–${top.slider.b}px)` : '(none)'} is not whole above the action bar ${top.bar ? `(from ${top.bar.t}px)` : '(none)'} on the first screen`);
      await ev(`(() => { const s = document.getElementById('lab-xr'); if (s) s.scrollIntoView({ block: 'start', behavior: 'instant' }); return true; })()`);
      await sleep(200);
      const r = await ev(read);
      if (r.none) { fails.push(`${at}: no comparison across routes for three properties of different routes`); continue; }
      if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
      if (r.allCols !== 'ABC' || r.shownCols.length !== 1) fails.push(`${at}: the columns shown are ${r.shownCols || 'none'} of ${r.allCols} — not one at a time`);
      if (r.showChips !== 3 || r.showLines !== 1 || r.lensLines !== 1) fails.push(`${at}: ${r.showChips} Show chips on ${r.showLines} line(s), the lens on ${r.lensLines} line(s)`);
      if (r.small.length) fails.push(`${at}: ${r.small.length} of ${r.controls} controls under 44px: ${r.small.slice(0, 4).join('; ')}`);
      if (r.inside.length) fails.push(`${at}: outside the card's width: ${r.inside.slice(0, 4).join(', ')}`);
      if (!r.bar || r.barFixed !== 'fixed' || r.bar.b > r.vh + 0.5) fails.push(`${at}: the action bar is ${r.bar ? `${r.barFixed}, ${r.bar.t}–${r.bar.b}px of ${r.vh}` : 'not drawn'}`);
      if (font && !/Verdana/.test(r.face)) fails.push(`${at}: drawn in ${r.face}, not Verdana`);
      /* Another column shown: still one, and still inside. */
      await ev(`(() => { const x = document.getElementById('lab-xr-show-C'); x.checked = true; x.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      const c = await ev(read);
      if (c.shownCols !== 'C' || c.inside.length || c.over > 0) fails.push(`${at}: C shown, the card shows ${c.shownCols}, ${c.inside.length} outside, ${c.over}px sideways`);
      said.push(`${at.replace(' in Verdana', ' V')}: ${r.controls} controls`);
    }
  } catch (e) {
    fails.push(`the check could not run: ${e.message}`);
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL p6-compare — across routes and assets on a phone (the property decision layer, P6): ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   p6-compare: a subsale condominium, an auction condominium and a whole shoplot side by side on /property at 360, 390 and 430, in the page's font and in Verdana: one column at a time, the sliders' column and then C by the Show chips; the Show and lens chips one line each; every cell and header inside the card; every control of the comparison, of adding a column and of saving a comparison a 44px target; the action bar fixed at the foot, the first slider whole above it at 390×844; nothing scrolls sideways (${said.slice(0, 4).join('; ')} …)`);
}
/* ---- end p6-compare ---- */
/* ---- lab-words ---- */
/* THE LAB SAYS LESS BEFORE IT SHOWS (the 9 Oct audit, #5, owner-approved:
   "Scenario Lab is useful but too explanation-heavy, especially for
   mobile"). /property on a first visit, at 1440×900 and 390×844, in the
   page's font and in Verdana, counting the words a reader can see in
   <main> — a run of text whose element is rendered (checkVisibility, with
   opacity and visibility), not inside .sr-only, a clipped 1px box or a
   closed <details> (its <summary> counts), with a box of its own:
     - before the first slider: at most 180 at 1440 and 138 at 390;
       measured 174 and 131 (189 and 145 on 58dbc0b4). The margin, six or
       seven words, is what the lines that are not the Lab's may vary by —
       the journey's line above the page (its state, its date, its commit)
       and a property's name — and no more: one sentence of explanation
       put back above the slider fails it;
     - in all of <main>: at most 570 at 1440 and 485 at 390; measured 549
       and 466 (799 and 608 on 58dbc0b4), the margin the same lines' and
       a district's name;
   and the layout system's levels on a phone (390, and 360 and 430):
     - two figures lead: the first two tiles are the decision's (L1), side
       by side on the tiles' first line; the context's figure and the next
       step stand under them as a compact row — each at most 80% of a lead
       tile's height, the context's figure at most 75% of the lead
       figures' size (on 58dbc0b4 the four were alike: 94% and 81%) — and
       every tile keeps its kind badge in sight;
     - the first slider whole above the action bar at 390×844;
   and at every size:
     - Save's wording is one line in sight under the commit buttons (one
       sentence, at most 14 words), and how saving works — a scenario
       belongs to a property, what a commit marks as the reader's, why the
       grade stays U — is a closed <details> (L3), there whole;
     - the disclosures that stay in sight are in sight without opening
       anything: the status strip's "Beta preview.", the Beta badge beside
       the title, "Not a valuation", "Not an official property valuation",
       "not a real listing", "Illustrative default" on the tiles and the
       first knob, the cash required's "on unverified lines" and, on a deal
       answered Auction, "Not final: 6 checks open".
   Fails on 58dbc0b4: 189 and 145 words before the slider, 799 and 608 in
   all, the tiles four alike on a phone, the saving prerequisites a
   paragraph of 76 words in sight, and the auction's notes standing open. */
{
  const fails = [], said = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 80; i++) {
      await sleep(200);
      try { if (await ev(`document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(500);
    return ev('State.view');
  };
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  const TERMS = 'route:auction~reservePrice:420000~auctionDepositPct:10~auctionDepositOf:reserve~auctionBalanceDays:90~auctionComp1:600000~auctionComp2:640000~auctionRepairs:15000~arrearsMaintenance:3000~auctionHoldMonths:3';
  const BOUND = { 1440: { before: 180, all: 570 }, 390: { before: 138, all: 485 } };
  /* What the eye can see, as a reader who opens nothing does. */
  const SEEN = `const seen = (n, root = document.querySelector('main') || document.body) => {
      const p = n.nodeType === 3 ? n.parentElement : n;
      if (!p || p.closest('.sr-only, script, style, template, svg')) return false;
      if (!p.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      for (let a = p; a && a !== root.parentElement; a = a.parentElement) {
        const b = a.getBoundingClientRect(), cs = getComputedStyle(a);
        if ((b.width <= 1 || b.height <= 1) && cs.overflow !== 'visible') return false;
      }
      const r = document.createRange(); r.selectNodeContents(n);
      return [...r.getClientRects()].some(x => x.width > 1 && x.height > 1);
    };
    const words = (s) => s.split(/\\s+/).filter(t => /[\\p{L}\\p{N}]/u.test(t));
    const seenText = (root) => { const out = []; const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = tw.nextNode(); n; n = tw.nextNode()) if (seen(n)) out.push(n.data); return out.join(' ').replace(/\\s+/g, ' '); };`;
  const read = `(async () => {
    await document.fonts.ready;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    ${SEEN}
    const main = document.querySelector('main') || document.body;
    const slider = [...main.querySelectorAll('input[type=range]')].find(n => n.getClientRects().length && n.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    let before = 0, all = 0;
    const tw = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (!seen(n)) continue;
      const w = words(n.data).length;
      all += w;
      if (slider && (slider.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING)) before += w;
    }
    const box = (n) => { if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height) }; };
    const tiles = [...document.querySelectorAll('#views .lab-tile')].map(n => ({ label: (n.querySelector('.lab-tile-label')?.textContent || '').trim(), level: n.dataset.level || (n.dataset.card === 'action' ? 'next' : ''),
      at: box(n), value: parseFloat(getComputedStyle(n.querySelector('.ls-card-value, .lab-next-what') || n).fontSize),
      badge: (() => { const b = n.querySelector('[data-kind]:not(.lab-tile)') || n.querySelector('.lab-tile-kind'); return b && seen(b.firstChild || b) ? b.textContent.trim() : null; })() }));
    const commit = document.getElementById('lab-commit'), line = document.getElementById('lab-commit-line'), more = document.getElementById('lab-commit-more');
    const commitSeen = commit ? seenText(commit) : '';
    const bar = document.querySelector('body > .dock');
    const strip = document.getElementById('disclosureText');
    const head = document.querySelector('#views .lab-page-hd');
    return { before, all, sliderOf: slider?.id || null, slider: box(slider), vh: innerHeight, vw: innerWidth,
      barTop: bar && bar.getClientRects().length && getComputedStyle(bar).position === 'fixed' ? Math.round(bar.getBoundingClientRect().top) : innerHeight,
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth, tiles,
      line: line && seen(line.firstChild || line) ? line.textContent.trim() : null,
      more: more ? { tag: more.tagName, open: more.open, sum: (more.querySelector(':scope > summary')?.textContent || '').trim(), words: words(more.textContent).length } : null,
      commitSeen,
      strip: strip ? seenText(strip) : '', beta: head ? seenText(head) : '', page: seenText(main),
      firstKnob: (() => { const k = slider?.closest('.lab-knob'); return k ? seenText(k) : ''; })() };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    const sizes = [[1440, 900], [390, 844], [360, 640], [430, 932]];
    for (const [w, h] of sizes) for (const font of [null, 'Verdana, sans-serif']) {
      const at = `${w}×${h}${font ? ' in Verdana' : ''}`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, sessionId);
      await load('/privacy');
      await forget();
      const view = await load('/property');
      if (view !== 'propertyLab') { fails.push(`${at}: /property opened ${view}, not the Scenario Lab`); continue; }
      if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
      const r = await ev(read);
      /* The measure: the words in sight before the first slider, and in all. */
      const bound = BOUND[w];
      if (!r.sliderOf) fails.push(`${at}: no slider in sight in <main> — the check has nothing to count to`);
      if (bound) {
        if (r.before > bound.before) fails.push(`${at}: ${r.before} words in sight in <main> before the first slider, more than ${bound.before}`);
        if (r.all > bound.all) fails.push(`${at}: ${r.all} words in sight in <main>, more than ${bound.all}`);
        said.push(`${at}: ${r.before} before the slider, ${r.all} in all`);
      }
      /* Two figures lead on a phone. */
      const t = r.tiles;
      if (w < 640) {
        const [a, b, ...rest] = t;
        if (!a || !b || a.level !== '1' || b.level !== '1') fails.push(`${at}: the first two tiles are ${JSON.stringify(t.slice(0, 2).map(x => `${x.label} (L${x.level})`))}, not the decision's two (L1)`);
        else {
          if (Math.abs(a.at.t - b.at.t) > 1) fails.push(`${at}: the two lead tiles are not side by side (${a.at.t}px and ${b.at.t}px)`);
          for (const x of rest) {
            if (!x.at || x.at.t < Math.max(a.at.b, b.at.b) - 1) fails.push(`${at}: "${x.label}" does not stand under the two lead figures`);
            if (x.at && x.at.h > 0.8 * Math.min(a.at.h, b.at.h)) fails.push(`${at}: "${x.label}" is ${x.at.h}px tall, not a compact row under the lead tiles (${Math.min(a.at.h, b.at.h)}px; at most 80% of it)`);
            if (x.level === '2' && !(x.value <= 0.75 * a.value)) fails.push(`${at}: "${x.label}"'s figure is ${x.value}px, not a step under the lead figures' ${a.value}px (at most 75% of it)`);
          }
          if (JSON.stringify([a.label, b.label]) !== JSON.stringify(['Cash required', 'Monthly position'])) fails.push(`${at}: the lead tiles are ${a.label} and ${b.label}, not Cash required and Monthly position`);
        }
        if (w === 390 && (!r.slider || r.slider.t < 0 || r.slider.b > r.barTop)) fails.push(`${at}: the first slider ${r.slider ? `(${r.slider.t}–${r.slider.b}px)` : '(none in sight)'} is not whole above the action bar (from ${r.barTop}px)`);
      }
      t.forEach(x => { if (!x.badge) fails.push(`${at}: the "${x.label}" tile shows no kind badge`); });
      if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
      /* Save's wording: one line in sight; the rest one tap away. */
      if (!r.line) fails.push(`${at}: no one-line wording of Save in sight (#lab-commit-line)`);
      else {
        const n = r.line.split(/\s+/).length, sentences = r.line.split(/[.!?](\s|$)/).filter(s => s && s.trim()).length;
        if (n > 14 || sentences > 1) fails.push(`${at}: Save's wording in sight is ${n} words in ${sentences} sentence(s): "${r.line.slice(0, 90)}"`);
      }
      if (!r.more || r.more.tag !== 'DETAILS' || r.more.open || r.more.words < 40) fails.push(`${at}: how saving works is ${!r.more ? 'not drawn' : r.more.tag !== 'DETAILS' ? 'not a <details>' : r.more.open ? 'open on arrival' : `only ${r.more.words} words`}, not the whole of it closed (L3)`);
      const commitWords = r.commitSeen.split(/\s+/).filter(Boolean).length;
      if (commitWords > 40) fails.push(`${at}: ${commitWords} words in sight in the commit card ("${r.commitSeen.slice(0, 80)}…"), not its buttons and one line`);
      /* The disclosures in sight, nothing opened. */
      const need = [[r.strip, 'Beta preview.', 'the status strip'], [r.beta, 'Beta', 'the Beta badge beside the title'], [r.page, 'Not a valuation', 'the chip'],
        [r.page, 'Not an official property valuation', 'the regulated claim'], [r.page, 'not a real listing', 'the sample\'s status'],
        [r.page, 'on unverified lines', 'the cash required\'s unverified lines'], [r.firstKnob, 'Illustrative default', 'the first knob\'s evidence tag']];
      for (const [hay, want, what] of need) if (!hay.includes(want)) fails.push(`${at}: ${what} ("${want}") is not in sight`);
      const tileDefaults = t.filter(x => x.badge === 'Illustrative default').length;
      if (tileDefaults < 3) fails.push(`${at}: ${tileDefaults} tiles show "Illustrative default" on the sample, not every figure's`);
    }
    /* A deal answered Auction: "Not final" in sight in the Lab's section. */
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      const at = `${w}×${h} auction`;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 600 }, sessionId);
      await load('/privacy'); await forget();
      await load('/property/calculator?d=' + TERMS);
      const view = await load('/property');
      if (view !== 'propertyLab') { fails.push(`${at}: /property opened ${view}`); continue; }
      const r = await ev(`(async () => { ${SEEN}
        const s = document.getElementById('lab-au'); if (!s) return null;
        s.scrollIntoView({ block: 'start', behavior: 'instant' });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { text: seenText(s), notes: [...s.querySelectorAll('.au-group details.au-more')].map(d => d.open) };
      })()`);
      if (!r) { fails.push(`${at}: no auction section`); continue; }
      if (!r.text.includes('Not final: 6 checks open')) fails.push(`${at}: "Not final: 6 checks open" is not in sight`);
      if (!r.text.includes('Nothing of the sale is assumed') || !r.text.includes('Not a valuation')) fails.push(`${at}: the auction's lead — nothing of the sale assumed, not a valuation — is not in sight`);
      if (!r.notes.length || r.notes.some(Boolean)) fails.push(`${at}: the input groups' notes are ${r.notes.length ? 'open' : 'not'} in closed <details> (L3)`);
    }
  } catch (e) {
    fails.push(`the check could not run: ${e.message}`);
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL lab-words — the Scenario Lab's words before its figures (the 9 Oct audit, #5): ${fails.length} problem(s):`); fails.slice(0, 60).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   lab-words: /property in sight on a first visit, in the page's font and in Verdana — ${said.join('; ')} (bounds 180/570 at 1440, 138/485 at 390); on a phone Cash required and Monthly position lead, side by side, the context's figure and the next step a compact row under them with their kind badges, the first slider above the action bar at 390×844; Save's wording one line in sight and how saving works a closed <details>; the status strip, Beta, "Not a valuation", the regulated claim, "not a real listing", the illustrative-default tags and the unverified lines in sight, and "Not final: 6 checks open" on an auction, its groups' notes closed (L3)`);
}
/* ---- end lab-words ---- */
/* ---- home-3a ---- */
/* THE HOMEPAGE CLEANUP, AS DRAWN (plan Phase 3A and 3B; the owner's
   decisions D5, D17, D21 and D22) — the plan's [browser] lines, in the page's
   font and in Verdana:
   3.1  at 360, 390, 430, 768, 1024 and 1440, script on and off, on /, a
        product page (/property) and /pricing, the strip's warning sentence
        and "No licensed prices" are in sight with no action; the strip is 40px
        tall or less at 1100 and 1440, and 76px or less at 360; Tab to
        "Details" and Enter shows the source breakdown, Research mode, "No
        advice · No recommendations" and a link to /data-sources; with the
        filings blocked the strip says "Illustrative data only" and never
        "SEC-filed";
   3.2  with script off the hero reads the same — its h1, its lede and one
        call to action;
   3.3  Tab reaches each card's link and each ⓘ, one stop each; with script
        off the Scanner's ⓘ opens on "this site ships no prices";
   3.4  above the footer one disclosure line is in sight: the strip;
   3.5  from /, "Open your workspace" opens /app with the whole sidebar;
   3.8  a fresh headless Chrome in en-US and America/New_York has the h1 and
        the Equities visual's source label in innerText at DOMContentLoaded;
        moving the Property card's price moves its three figures;
   and nothing on / runs sideways at any of the widths.
   Each fails on the merged base 7d25484e: its strip was a line and a
   "Which sources?" button with the facts behind it, its hero two calls to
   action and the kicker, its cards whole-card links with no ⓘ, and a
   second disclosure line under them. */
{
  const fails = [], said = { widths: 0, tabs: 0 };
  const trace = process.env.QT_TRACE ? (m) => console.log(`     · ${m}`) : () => {};
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const settle = async (script) => {
    for (let i = 0; i < 60; i++) {
      await sleep(200);
      try { if (await ev(script ? `document.readyState === 'complete' && typeof State !== 'undefined' && !!State.view && typeof realPending !== 'undefined' && !realPending` : `document.readyState === 'complete'`)) break; } catch { /* booting */ }
    }
    await sleep(400);
  };
  const load = async (path, script = true) => { await send('Page.navigate', { url: BASE + path }, sessionId); await settle(script); };
  const face = (font) => (font ? ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`) : null);
  const key = async (k, code, vk) => {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(k === 'Enter' ? { text: '\r' } : {}) }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, sessionId);
  };
  const SEEN = `(() => {
    const vis = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && (() => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.left >= -1 && r.right <= innerWidth + 1; })();
    const strip = document.querySelector('.disclosure');
    const text = document.getElementById('disclosureText'), facts = document.getElementById('disclosureFacts');
    const main = document.querySelector('main');
    const DISC = /investment decision|no market prices are licensed|No licensed prices|filed with the SEC or illustrative|labelled on every page/i;
    const lines = main ? [...main.querySelectorAll('p, li, div, span, section')].filter(n => vis(n) && !n.closest('figure') && ![...n.children].some(k => /^(P|LI|DIV|SECTION)$/.test(k.tagName)) && DISC.test(n.innerText || '')).map(n => (n.innerText || '').slice(0, 80)) : [];
    const hero = document.querySelector('#views .pub-hero');
    return { h: strip ? Math.round(strip.getBoundingClientRect().height) : null, sentence: vis(text) && /Beta preview\\. Do not use figures here for investment decisions\\./.test(text.innerText),
      facts: vis(facts) ? facts.innerText.trim() : null, over: document.documentElement.scrollWidth - document.documentElement.clientWidth, lines,
      hero: hero ? { h1: hero.querySelector('h1')?.innerText.trim(), lede: hero.querySelector('.pub-lede')?.innerText.trim(), acts: [...hero.querySelectorAll('a, button')].filter(vis).length } : null };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    /* 3.1, 3.2, 3.4: every width, script on and off, two fonts. */
    for (const font of [null, 'Verdana, sans-serif']) for (const script of [true, false]) for (const w of [360, 390, 430, 768, 1024, 1100, 1440]) {
      if (font && !script) continue;
      trace(`${w}px${script ? '' : ' no script'}${font ? ' Verdana' : ''}`);
      const h = w < 700 ? 800 : 900;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 }, sessionId);
      await send('Emulation.setScriptExecutionDisabled', { value: !script }, sessionId);
      for (const path of ['/', '/property', '/pricing']) {
        /* Every page in Verdana too (CI on 00ece94c): /property's strip,
           beside the sidebar, ran to two lines at 1100px in CI's wide Linux
           sans and in Verdana, and only / was measured in it here. */
        await load(path, script);
        await face(font);
        const at = `${path} ${w}px${script ? '' : ', no script'}${font ? ', Verdana' : ''}`;
        const r = await ev(SEEN);
        said.widths++;
        if (!r.sentence) fails.push(`${at}: the warning sentence is not in sight`);
        if (r.facts !== '· SEC-filed and illustrative data, labelled · No licensed prices') fails.push(`${at}: the strip's facts read ${JSON.stringify(r.facts)} in sight`);
        if (w >= 1100 && !(r.h <= 40)) fails.push(`${at}: the strip is ${r.h}px tall, more than 40`);
        if (w === 360 && !(r.h <= 76)) fails.push(`${at}: the strip is ${r.h}px tall, more than 76`);
        if (path === '/') {
          if (r.over > 1) fails.push(`${at}: the page runs ${r.over}px sideways`);
          if (r.lines.length) fails.push(`${at}: a disclosure line in sight above the footer besides the strip: "${r.lines[0]}"`);
          if (!r.hero || r.hero.h1 !== 'Make financial decisions with greater clarity.' || r.hero.lede !== 'Companies, market setups and property, in one workspace.' || r.hero.acts !== 1)
            fails.push(`${at}: the hero reads ${JSON.stringify(r.hero)}`);
        }
      }
      /* The Scanner's ⓘ, opened with no script. */
      if (!script && !font && (w === 390 || w === 1440)) {
        await load('/', false);
        const box = await ev(`(() => { const s = document.querySelector('[data-product="scanner"] .pub-info > summary'); if (!s) return null; s.scrollIntoView({ block: 'center', inline: 'center' }); const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        if (!box) fails.push(`/ ${w}px, no script: no ⓘ on the Scanner card`);
        else {
          await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, sessionId);
          await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 }, sessionId);
          await sleep(200);
          const t = await ev(`(() => { const b = document.querySelector('[data-product="scanner"] .pub-info-body'); return b && b.getClientRects().length ? b.innerText : null; })()`);
          if (!t || !/this site ships no prices/.test(t)) fails.push(`/ ${w}px, no script: the Scanner's ⓘ opens on ${JSON.stringify(t)}`);
        }
      }
    }
    await send('Emulation.setScriptExecutionDisabled', { value: false }, sessionId);
    for (const w of [390, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 700 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 700 }, sessionId);
      await load('/');
      /* 3.1: Tab to Details, then Enter. */
      await ev(`(() => { const s = document.querySelector('#disclosure > summary'); const all = [...document.querySelectorAll('a[href], button, summary, input, [tabindex]')].filter(n => n.getClientRects().length && n.tabIndex >= 0); const i = all.indexOf(s); (all[i - 1] || document.body).focus(); return i; })()`);
      await key('Tab', 'Tab', 9);
      const onSum = await ev(`document.activeElement === document.querySelector('#disclosure > summary')`);
      if (!onSum) fails.push(`/ ${w}px: Tab does not reach the strip's Details (${await ev('document.activeElement?.outerHTML.slice(0, 80)')})`);
      await key('Enter', 'Enter', 13);
      await sleep(250);
      const open = await ev(`(() => { const d = document.getElementById('disclosure'); if (!d) return { open: false, strip: 'no <details id="disclosure">' }; const b = d.querySelector('.disclosure-body'); const t = b && b.getClientRects().length ? b.innerText : ''; return { open: d.open, breakdown: /companies? carr|illustrative/.test(t), mode: /Research mode/.test(t), advice: /No advice · No recommendations/.test(t), ds: !!b && !!b.querySelector('a[href="/data-sources"]') && b.querySelector('a[href="/data-sources"]').getClientRects().length > 0 }; })()`);
      if (!open.open || !open.breakdown || !open.mode || !open.advice || !open.ds) fails.push(`/ ${w}px: Tab and Enter on Details show ${JSON.stringify(open)}`);
      /* 3.3: the keyboard's stops on the cards. */
      await load('/');
      await ev(`(document.querySelector('#views .pub-hero a') || document.body).focus()`);
      const stops = [];
      for (let i = 0; i < 40; i++) {
        await key('Tab', 'Tab', 9);
        const s = await ev(`(() => { const a = document.activeElement; const c = a?.closest('article.pub-card'); return c ? \`\${c.dataset.product}:\${a.classList.contains('pub-card-link') ? 'link' : a.tagName === 'SUMMARY' ? 'info' : a.className || a.tagName}\` : a?.closest('.pub-path') ? 'path' : null; })()`);
        if (s === 'path') break;
        if (s) stops.push(s);
      }
      said.tabs = stops.length;
      for (const id of ['equities', 'scanner', 'property']) for (const k of ['link', 'info']) {
        const n = stops.filter(s => s === `${id}:${k}`).length;
        if (n !== 1) fails.push(`/ ${w}px: Tab stops on the ${id} card's ${k === 'link' ? 'link' : 'ⓘ'} ${n} times, not once (${stops.join(' ')})`);
      }
    }
    trace('filings blocked');
    /* 3.1: the filings blocked. */
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Network.enable', {}, sessionId);
    await send('Network.setBlockedURLs', { urls: ['*/data/us.json*', '*/data/us.*.json*'] }, sessionId);
    await load('/');
    await sleep(1500);
    const blocked = await ev(`document.getElementById('disclosureFacts')?.innerText.trim()`);
    if (!/Illustrative data only/.test(blocked || '') || /SEC-filed/.test(blocked || '')) fails.push(`/ with the filings blocked: the strip's facts read ${JSON.stringify(blocked)}`);
    await send('Network.setBlockedURLs', { urls: [] }, sessionId);
    /* 3.5: from / to /app, the whole sidebar. */
    await load('/');
    await ev(`document.querySelector('#views .pub-hero a[href="/app"]').click()`);
    await sleep(1200);
    const side = await ev(`({ path: location.pathname, links: [...document.querySelectorAll('#appnav a.sb-link')].filter(a => a.getClientRects().length).length, labels: [...document.querySelectorAll('#appnav .sb-text')].map(n => n.textContent.trim()) })`);
    if (side.path !== '/app' || side.links < 8 || !side.labels.includes('My Dashboard') || !side.labels.includes('Property Intelligence')) fails.push(`/ → "Open your workspace": ${JSON.stringify(side)}`);
    /* 3.8: the Property card's price moves its three figures. */
    await load('/');
    const moved = await ev(`(async () => {
      const r = document.querySelector('#pub-lab-price');
      if (!r) return { before: [], after: [], none: 'no price knob on the Property card' };
      const read = () => [...document.querySelectorAll('[data-product="property"] .pub-lab-figs dd')].map(d => d.textContent);
      const before = read();
      r.value = String(Number(r.max)); r.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(res => setTimeout(res, 100));
      return { before, after: read() };
    })()`);
    if (moved.before.length !== 3 || moved.after.some((v, i) => v === moved.before[i])) fails.push(`/: moving the Property card's price leaves its figures ${JSON.stringify(moved)}`);
    trace('New York');
    /* 3.8: a reader in New York, at DOMContentLoaded. */
    const { result: { targetId: t2 } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId: s2 } } = await send('Target.attachToTarget', { targetId: t2, flatten: true });
    try {
      await send('Page.enable', {}, s2); await send('Runtime.enable', {}, s2);
      await send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' }, s2);
      await send('Emulation.setLocaleOverride', { locale: 'en-US' }, s2);
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', acceptLanguage: 'en-US' }, s2);
      await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); } catch (e) {} document.addEventListener('DOMContentLoaded', () => { const t = document.body.innerText; window.__dcl = { h1: t.includes('Make financial decisions with greater clarity.'), src: t.includes('Apple · SEC 10-K · US$'), hidden: document.documentElement.hasAttribute('data-served-hidden') }; });` }, s2);
      await Promise.race([send('Page.navigate', { url: BASE + '/' }, s2), sleep(15000)]);
      let dcl = null;
      for (let i = 0; i < 40 && !dcl; i++) { await sleep(200); dcl = (await send('Runtime.evaluate', { expression: 'window.__dcl || null', returnByValue: true }, s2)).result?.result?.value; }
      if (!dcl || !dcl.h1 || !dcl.src || dcl.hidden) fails.push(`/ in en-US, America/New_York: at DOMContentLoaded ${JSON.stringify(dcl)}`);
      said.dcl = dcl;
    } finally { await Promise.race([send('Target.closeTarget', { targetId: t2 }), sleep(5000)]); }
  } finally {
    await send('Emulation.setScriptExecutionDisabled', { value: false }, sessionId).catch(() => {});
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL home-3a — the homepage cleanup as drawn: ${fails.length} problem(s):`); fails.slice(0, 40).forEach(f => console.log(`     ${f}`)); if (fails.length > 40) console.log(`     … and ${fails.length - 40} more`); }
  else console.log(`ok   home-3a: the strip's warning and "No licensed prices" in sight with no action on /, /property and /pricing at 360–1440, script on and off, in the page's font and Verdana (${said.widths} views); 40px or less from 1100, 76 or less at 360; Tab and Enter on Details open the breakdown, Research mode and /data-sources; "Illustrative data only" with the filings blocked; the hero one action with script off; one disclosure line above the footer; Tab stops once on each card link and each ⓘ (${said.tabs} stops); the Scanner's ⓘ opens with no script; / → /app draws the whole sidebar; the Property price moves its three figures; a reader in New York has the h1 and Apple's source label at DOMContentLoaded`);
}
/* ---- end home-3a ---- */
/* ---- second-track ---- */
/* THE SCREENER ON A PHONE (the owner's second track, 8 Oct 2026; the layout
   system: under 640px a table is a card a row). At 360, 390, 430 and 600,
   in the page's font and in Verdana (as wide as CI's Linux sans), on a
   fresh visitor's screener: the Coverage selector is there, one class
   chosen (SEC-filed) and the other beside it; the results are cards, one
   per match the count states, each with its D6 badge of that one class,
   and no table is shown; the results stand before the advanced metric
   directory; nothing scrolls sideways; and every Coverage choice is a 44px
   target. */
{
  const fails = [];
  const seen = [];
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text } : r.result?.result?.value;
  };
  try {
    for (const font of [null, 'Verdana, sans-serif']) {
      for (const w of [360, 390, 430, 600]) {
        const at = `${w}px${font ? ' in Verdana' : ''}`;
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
        await send('Page.navigate', { url: BASE + '/privacy' }, sessionId);
        await sleep(500);
        await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`);
        await send('Page.navigate', { url: BASE + '/discover/screener' }, sessionId);
        let ok = false;
        for (let i = 0; i < 80 && !ok; i++) { await sleep(200); ok = await ev(`typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && State.view === 'discover' && !document.getElementById('views').hasAttribute('data-served')`) === true; }
        if (!ok) { fails.push(`${at}: the screener never settled`); continue; }
        if (font) await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`);
        await sleep(250);
        const r = await ev(`(() => {
          const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
          const bar = document.querySelector('#views .scr-class');
          const choices = bar ? [...bar.querySelectorAll('button[aria-pressed]')].map(b => ({ t: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true', h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })) : [];
          const head = [...document.querySelectorAll('#views h3')].map(h => h.textContent).find(t => /companies match/.test(t)) || '';
          const m = /(\\d+) of (\\d+) compan/.exec(head);
          const cards = [...document.querySelectorAll('#views .screener-card')].filter(shown);
          const kinds = cards.map(c => c.querySelector('[data-kind-badge]')?.getAttribute('data-kind-badge') || null);
          const table = document.querySelector('#views table.dt');
          const adv = document.getElementById('scr-advanced');
          const firstCard = cards[0];
          return { bar: !!bar && shown(bar), choices, count: m ? +m[1] : null, cards: cards.length, kinds: [...new Set(kinds)], unbadged: kinds.filter(k => !k).length,
            table: shown(table), before: !!(firstCard && adv && (firstCard.compareDocumentPosition(adv) & Node.DOCUMENT_POSITION_FOLLOWING)),
            over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            cardOver: cards.filter(c => c.getBoundingClientRect().right > document.documentElement.clientWidth + 1 || c.scrollWidth > c.clientWidth + 1).length };
        })()`);
        if (!r || r.error) { fails.push(`${at}: ${r?.error || 'no answer'}`); continue; }
        if (!r.bar) fails.push(`${at}: no Coverage selector in sight`);
        const on = r.choices.filter(c => c.on).map(c => c.t);
        if (r.choices.length < 3 || on.length !== 1 || !/^SEC-filed/.test(on[0])) fails.push(`${at}: the Coverage choices are ${JSON.stringify(r.choices.map(c => c.t))}, chosen ${JSON.stringify(on)} — not SEC-filed alone`);
        const small = r.choices.filter(c => c.h < 44 || c.w < 44);
        if (small.length) fails.push(`${at}: Coverage choices under 44px: ${small.map(c => `${c.t} ${c.w}×${c.h}`).join(', ')}`);
        if (r.table) fails.push(`${at}: the results are a table, not cards`);
        if (r.count === null || r.cards !== r.count) fails.push(`${at}: ${r.cards} result cards for a count of ${r.count}`);
        if (r.unbadged || r.kinds.length !== 1 || r.kinds[0] !== 'filed') fails.push(`${at}: the cards' kind badges are ${JSON.stringify(r.kinds)} (${r.unbadged} cards without one), not Filed on every one`);
        if (!r.before) fails.push(`${at}: the results do not stand before the advanced metric directory`);
        if (r.over > 1) fails.push(`${at}: the page scrolls sideways by ${r.over}px`);
        if (r.cardOver) fails.push(`${at}: ${r.cardOver} cards overflow`);
        seen.push(`${at} ${r.cards}`);
        /* ---- screener-coverage ---- */
        /* THE READER CHOOSES THE MEASURES ON EACH CARD (9 Oct audit #8):
           one line of chips, the table's columns, that scrolls sideways and
           never wraps, each a 44px target; every card carries exactly the
           chosen measures, in the chips' order, at most four; pressing a
           chip changes every card; a price measure a filed company cannot
           hold reads "Unavailable", never a zero or a dash; a template that
           is off on the filed companies offers "Run on the illustrative set"
           as a 44px target; nothing scrolls sideways after any of it. */
        const k = await ev(`(async () => {
          const w = (ms) => new Promise(res => setTimeout(res, ms));
          const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
          const row = () => document.querySelector('#views .scr-pick-row');
          if (!shown(row())) return { none: true };
          const chips = () => [...row().querySelectorAll('button')].map(b => { const q = b.getBoundingClientRect(); return { id: b.id, t: b.textContent.trim(), on: b.getAttribute('aria-pressed') === 'true', top: Math.round(q.top), h: Math.round(q.height), w: Math.round(q.width) }; });
          const cards = () => [...document.querySelectorAll('#views .screener-card')].filter(shown).map(c => [...c.querySelectorAll('.screener-card-metrics > div')].map(d => [d.children[0]?.textContent.trim(), d.children[1]?.textContent.trim()]));
          const agree = () => { const want = chips().filter(c => c.on).map(c => c.t).join('|'); return cards().every(c => c.map(x => x[0]).join('|') === want); };
          const out = { chips: chips(), agree0: agree(), cards0: cards()[0] || [], scroll: row().scrollWidth > row().clientWidth };
          /* Press one not chosen (removing the last chosen first, if four are). */
          let c0 = chips();
          if (c0.filter(c => c.on).length >= 4) { document.getElementById(c0.filter(c => c.on).pop().id).click(); await w(150); c0 = chips(); }
          const add = c0.find(c => !c.on);
          if (add) { document.getElementById(add.id).click(); await w(150); }
          out.added = add ? add.t : null;
          out.agree1 = agree(); out.hasAdded = !!add && cards().every(c => c.some(x => x[0] === add.t));
          out.max = Math.max(0, ...cards().map(c => c.length));
          /* A price measure on filed companies. */
          const s = State.screen, keepCols = s.cols, keepPick = State.scrCardCols;
          s.cols = ['pe', 'roic', 'om']; State.scrCardCols = ['pe', 'roic']; render(); await w(200);
          const pe = cards().map(c => (c.find(x => x[0] === 'Price / earnings') || [null, null])[1]);
          out.pe = [...new Set(pe)];
          out.over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          s.cols = keepCols; State.scrCardCols = keepPick; render(); await w(150);
          /* A template off on the filed companies, and its way to run. */
          const det = [...document.querySelectorAll('#views details')].find(d => d.querySelector('.scr-tpl-list'));
          if (det) { det.open = true; await w(100); }
          const run = document.querySelector('#views .scr-tpl-run');
          out.run = run ? { h: Math.round(run.getBoundingClientRect().height), w: Math.round(run.getBoundingClientRect().width) } : null;
          out.over2 = document.documentElement.scrollWidth - document.documentElement.clientWidth;
          if (det) det.open = false;
          return out;
        })()`);
        if (!k || k.error) fails.push(`${at}: the card measures could not be read: ${k?.error || 'no answer'}`);
        else if (k.none) fails.push(`${at}: no chips to choose the measures on each card`);
        else {
          const tops = [...new Set(k.chips.map(c => c.top))];
          if (tops.length !== 1) fails.push(`${at}: the measure chips wrap onto ${tops.length} lines`);
          const tiny = k.chips.filter(c => c.h < 44 || c.w < 44);
          if (tiny.length) fails.push(`${at}: measure chips under 44px: ${tiny.slice(0, 4).map(c => `${c.t} ${c.w}×${c.h}`).join(', ')}`);
          if (!k.agree0 || !k.agree1) fails.push(`${at}: the cards do not carry exactly the chosen measures (first card: ${JSON.stringify(k.cards0.map(x => x[0]))})`);
          if (!k.hasAdded) fails.push(`${at}: pressing ${JSON.stringify(k.added)} did not put it on every card`);
          if (k.max > 4) fails.push(`${at}: a card carries ${k.max} measures, more than four`);
          if (k.pe.length !== 1 || k.pe[0] !== 'Unavailable') fails.push(`${at}: a filed company's P/E on its card reads ${JSON.stringify(k.pe)}, not "Unavailable"`);
          if (!k.run || k.run.h < 44 || k.run.w < 44) fails.push(`${at}: "Run on the illustrative set" is ${k.run ? `${k.run.w}×${k.run.h}` : 'not drawn'}, not a 44px target`);
          if (k.over > 1 || k.over2 > 1) fails.push(`${at}: the page scrolls sideways by ${Math.max(k.over, k.over2)}px with the card measures chosen or the templates open`);
        }
        /* ---- end screener-coverage ---- */
      }
    }
  } catch (e) { fails.push(`harness: ${e.message}`); }
  if (fails.length) { bad++; console.log(`FAIL second-track: the screener on a phone (${fails.length} problems)`); fails.slice(0, 20).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   second-track: the screener at 360, 390, 430 and 600, in the page's font and in Verdana — the Coverage selector in sight with SEC-filed chosen and each choice a 44px target; the results are cards (${seen.join(', ')}), one per match, each badged Filed; no table; the results before the advanced metric directory; nothing scrolls sideways; the measures on each card chosen by one line of 44px chips, every card carrying exactly those, a filed P/E "Unavailable", and "Run on the illustrative set" a 44px target`);
}
/* ---- end second-track ---- */
/* ---- d12-workspace ---- */
/* MY DASHBOARD ON A PHONE (the owner's decision D12, 8 Oct 2026). /app as
   a first visit and as a returning reader's workspace (a filed company
   opened, a property of their own saved), at 360, 390 and 430, in the
   page's font and in Verdana (CI's Linux sans is as wide):
     - the page does not scroll sideways;
     - every control drawn in it — each button, each step's action, each
       of the five counts, each row of the workspace's parts, each way in,
       the workspace's tabs — is a 44px target on both axes; a link inside
       a sentence of prose (the footnote's) is the sentence's, and is not
       one;
     - a first visit has a picture on every step and no count; a returning
       reader has the five counts, before any step not taken.
   Each fails on 877e5eb4: no step had a picture, a first visit read
   "0 of 4 done", and a returning reader had four counts. */
{
  const fails = [], said = { pages: 0, targets: 0 };
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (path) => {
    await ev('window.__d12m = 1').catch(() => {});
    await send('Page.navigate', { url: BASE + path }, sessionId);
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      try { if (await ev(`!window.__d12m && document.readyState === 'complete' && typeof realPending !== 'undefined' && !realPending && typeof State !== 'undefined' && !!State.view`)) break; } catch { /* booting */ }
    }
    await sleep(400);
    return ev('State.view');
  };
  const face = (font) => (font ? ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))); })()`) : null);
  const forget = () => ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); sessionStorage.clear(); return true; })()`);
  const PROBE = `(() => {
    const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden';
    const views = document.getElementById('views');
    const sel = 'button, a.btn, .btn, .dash-tile, a.dash-row, .dash-more-link, a.dash-co, summary, a.ls-cta';
    const controls = [...views.querySelectorAll(sel), ...document.querySelectorAll('#productTabs a[href]')].filter(n => shown(n) && !n.closest('.sr-only'));
    const small = controls.map(n => [n, n.getBoundingClientRect()]).filter(([, b]) => b.width < 43.5 || b.height < 43.5)
      .map(([n, b]) => (n.className || n.tagName).toString().split(' ')[0] + ' ' + Math.round(b.width) + '×' + Math.round(b.height) + ' “' + n.textContent.trim().replace(/\\s+/g, ' ').slice(0, 28) + '”');
    const steps = [...views.querySelectorAll('li.dash-step')];
    const tiles = views.querySelector('.dash-tiles'), firstStep = views.querySelector('.dash-steps');
    return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, n: controls.length, small,
      first: !!views.querySelector('.dash-start'), steps: steps.length, pics: steps.filter(li => li.querySelector('svg')).length,
      digits: views.querySelector('.dash-start') ? (views.innerText.match(/\\d/g) || []).length : null,
      tiles: views.querySelectorAll('.dash-tile').length,
      order: !tiles || !firstStep || !!(tiles.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING) };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const w of [360, 390, 430]) for (const font of [null, 'Verdana, sans-serif']) for (const state of ['first', 'returning']) {
      const h = w === 360 ? 640 : w === 390 ? 844 : 932;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sessionId);
      await load('/privacy'); await forget();
      if (state === 'returning') {
        await load('/company/aapl-apple-inc');
        await load('/property/calculator');
        await ev(`(() => { State.deal.price = 615000; markTouched(State.deal, 'price'); saveDeal(); return !!saveActiveProperty({ name: 'Phone check property' }); })()`);
      }
      const at = `${w}×${h} /app, ${state === 'first' ? 'a first visit' : 'a returning reader'}${font ? ' in Verdana' : ''}`;
      const view = await load('/app');
      if (view !== 'home') { fails.push(`${at}: opened ${view}`); continue; }
      await face(font);
      const r = await ev(PROBE);
      said.pages++; said.targets += r.n;
      if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
      if (r.small.length) fails.push(`${at}: ${r.small.length} of ${r.n} controls under 44px: ${r.small.slice(0, 5).join('; ')}`);
      if (state === 'first') {
        if (!r.first || r.steps !== 4 || r.pics !== 4) fails.push(`${at}: the first visit shows ${r.steps} steps, ${r.pics} with a picture`);
        if (r.digits) fails.push(`${at}: ${r.digits} digits on a first visit's page`);
      } else if (r.first || r.tiles !== 5 || !r.order) fails.push(`${at}: the returning reader's page has ${r.tiles} counts${r.first ? ', and the first visit\'s steps' : ''}${r.order ? '' : ', after the steps'}`);
    }
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
    await ev(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k)); return true; })()`).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL d12-workspace — /app on a phone: ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   d12-workspace: /app at 360, 390 and 430, in the page's font and in Verdana, as a first visit and as a returning reader (${said.pages} pages) — nothing scrolls sideways; all ${said.targets} controls 44px each way; a picture on each of the four steps and no digit on a first visit; the returning reader's five counts before any step`);
}
/* ---- end d12-workspace ---- */

/* ---- property-investing ---- */
/* THE PROPERTY LANDING ON A PHONE (/property-investing, 56-property-
   investing.js). At 360, 390 and 430, in the page's font and in Verdana
   (CI's Linux sans is as wide), drawn by the script and as served with it
   off:
     - the page does not scroll sideways, and no block of it is wider than
       the window;
     - every control in the page — the two calls to action, each card's,
       the price knob, the link to the rulebook's sources — is a 44px
       target on both axes, the badges being words, not links;
     - the primary call to action, "Open the Scenario Lab", is on the first
       screen, and the disclosure is beside it, in sight. */
{
  const fails = [], said = { pages: 0, targets: 0 };
  const PATH = '/property-investing';
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression }, sessionId);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description?.split('\n')[0] || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  const load = async (script) => {
    await send('Emulation.setScriptExecutionDisabled', { value: !script }, sessionId);
    if (script) await ev('window.__pim = 1').catch(() => {});
    await send('Page.navigate', { url: BASE + PATH }, sessionId);
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      try {
        if (await ev(script ? `!window.__pim && document.readyState === 'complete' && typeof State !== 'undefined' && State.view === 'propertyInvesting'`
          : `document.readyState === 'complete' && !!document.querySelector('#views h1')`)) break;
      } catch { /* loading */ }
    }
    await sleep(400);
  };
  /* No requestAnimationFrame to wait on: with the page's script off, no
     frame callback runs, and the wait never returned. */
  const face = async (font) => { if (!font) return; await ev(`(() => { const s = document.createElement('style'); s.textContent = '*{font-family:${font} !important}'; document.head.append(s); return true; })()`); await sleep(250); };
  const PROBE = `(() => {
    const W = innerWidth, views = document.getElementById('views');
    const over = document.documentElement.scrollWidth - W;
    const wide = [...views.querySelectorAll('*')].filter(n => { const b = n.getBoundingClientRect(); return b.width > 0 && (b.right > W + 1 || b.left < -1); })
      .filter(n => { for (let p = n.parentElement; p && p !== views; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return false; } return true; })
      .slice(0, 3).map(n => n.tagName.toLowerCase() + '.' + String(n.className?.baseVal ?? n.className).split(' ')[0]);
    const ctl = [...views.querySelectorAll('a[href], button, summary, input, select, [data-inert]')].filter(n => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden');
    const small = ctl.filter(n => { const b = n.getBoundingClientRect(); return Math.min(b.width, b.height) < 43.5; })
      .map(n => { const b = n.getBoundingClientRect(); return n.tagName.toLowerCase() + '.' + String(n.className).split(' ')[0] + ' ' + Math.round(b.width) + '×' + Math.round(b.height) + ' “' + n.textContent.trim().slice(0, 24) + '”'; });
    const cta = views.querySelector('a.pi-cta-primary'), disc = views.querySelector('.pi-disclosure');
    const cb = cta ? cta.getBoundingClientRect() : null, db = disc ? disc.getBoundingClientRect() : null;
    return { over, wide, n: ctl.length, small, cta: !!cb && cb.top >= 0 && cb.bottom <= innerHeight, ctaText: cta ? cta.textContent.trim() : null,
      disc: !!db && db.height > 0 && getComputedStyle(disc).visibility !== 'hidden', h1: views.querySelector('h1')?.textContent.trim() || null };
  })()`;
  try {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    for (const w of [360, 390, 430]) for (const font of [null, 'Verdana, sans-serif']) for (const script of [true, false]) {
      const h = w === 360 ? 640 : w === 390 ? 844 : 932;
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }, sessionId);
      const at = `${w}×${h} ${PATH}${font ? ' in Verdana' : ''}${script ? '' : ', the script off'}`;
      await load(script);
      await face(font);
      const r = await ev(PROBE);
      said.pages++; said.targets += r.n;
      if (r.h1 !== 'Work out a Sarawak property before you buy') fails.push(`${at}: its h1 is ${JSON.stringify(r.h1)}`);
      if (r.over > 0) fails.push(`${at}: the page scrolls ${r.over}px sideways`);
      if (r.wide.length) fails.push(`${at}: wider than the window: ${r.wide.join(', ')}`);
      if (script && r.small.length) fails.push(`${at}: ${r.small.length} of ${r.n} controls under 44px: ${r.small.slice(0, 5).join('; ')}`);
      if (!r.cta || r.ctaText !== 'Open the Scenario Lab') fails.push(`${at}: the primary call to action ${r.ctaText ? `"${r.ctaText}" is not on the first screen` : 'is missing'}`);
      if (!r.disc) fails.push(`${at}: the disclosure beside the call to action is not in sight`);
    }
  } catch (e) { fails.push(`the checks threw: ${e.message}`); }
  finally {
    await send('Emulation.setScriptExecutionDisabled', { value: false }, sessionId).catch(() => {});
    await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
  }
  if (fails.length) { bad++; console.log(`FAIL property-investing — ${PATH} on a phone: ${fails.length} problem(s):`); fails.slice(0, 30).forEach(f => console.log(`     ${f}`)); }
  else console.log(`ok   property-investing: ${PATH} at 360, 390 and 430, in the page's font and in Verdana, drawn and with the script off (${said.pages} pages) — nothing scrolls sideways or runs past the window; all ${said.targets} controls drawn 44px each way; "Open the Scenario Lab" on the first screen with the disclosure beside it`);
}
/* ---- end property-investing ---- */


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
