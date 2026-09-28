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

/* SIX DESTINATIONS AT 360. Phase 3 put Scanner in the header, and a sixth
   item is how the topbar overflowed before: every link must sit wholly
   inside the viewport, none clipped by the row, each a 44px target. */
await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true }, sessionId);
await send('Page.navigate', { url: BASE + '/app/scanner' }, sessionId);
await sleep(2500);
{
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const links = [...document.querySelectorAll('#mainnav a')];
    const bad = links.filter(a => { const b = a.getBoundingClientRect(); return b.width === 0 || b.left < 0 || b.right > innerWidth || b.height < 44; })
      .map(a => a.textContent.trim());
    return { n: links.length, bad, labels: links.map(a => a.firstChild?.textContent.trim()) };
  })()` }, sessionId);
  const v = r.result?.result?.value;
  if (!v || v.n !== 6 || v.bad.length || v.labels[2] !== 'Scanner') { bad++; console.log(`FAIL 360px header — ${v ? `${v.n} links (${v.labels.join(', ')}), outside or under 44px: ${v.bad.join(', ') || 'none'}` : 'not measured'}`); }
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
    const bar = document.querySelector('.topbar').getBoundingClientRect();
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
    const bar = document.querySelector('.topbar').getBoundingClientRect();
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
  ['/property/calculator?city=kuching', ['#|Gate|State|Why', 'Source|State|Counts|Note|', 'Allowance|Triggered by']],
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
  for (const route of ['/discover?tab=heatmap', '/discover/value-map', '/compare?companies=AAPL-SEC,MSFT-SEC,MAYBANK']) {
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
