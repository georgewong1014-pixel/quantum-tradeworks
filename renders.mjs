#!/usr/bin/env node
/**
 * Deterministic product renders, at 2x, in WebP and AVIF.
 *
 *   node renders.mjs                     render everything against production
 *   node renders.mjs --only wheel-payoff render one
 *   node renders.mjs --list              show what would be rendered
 *   node renders.mjs --base http://…     somewhere else (see the gate below)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE, AND NOT STOCK IMAGERY
 *
 * A research product illustrated with candlesticks, trading floors and robots
 * is illustrated with things it does not contain. Every frame here is a real
 * surface of the running application, photographed from a state this file
 * creates, so what a reader sees before they arrive is what they get after.
 *
 * That also means the renders cannot drift: they are regenerated from the
 * deployed build, and a change that breaks a chart breaks its render.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LICENCE GATE, AND WHY IT REFUSES RATHER THAN WARNS
 *
 * .gitignore already states the rule for watchlist-shots/:
 *
 *     "Someone else's licensed data rendered as pixels — never committed,
 *      never deployed."
 *
 * A render is pixels. End-of-day prices are supplied under a licence with no
 * redistribution right, so a screenshot containing one redistributes it just as
 * surely as the JSON would, and more permanently — nobody greps a PNG.
 *
 * The trap is that this is invisible on a developer's machine. Locally,
 * data/prices.json is present and the dev server serves it 200. In production
 * it is gitignored and 404s. Render against localhost and the frames silently
 * embed licensed figures; render against production and they cannot.
 *
 * So the default base is production, and before anything is captured every
 * licensed path is fetched. If ANY of them answers, this exits. It does not
 * warn and continue — a warning in a scrollback is not a control, and the
 * artefact it fails to stop is one that gets committed and published.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const BASE = (flag('base', 'https://quantum-tradeworks.vercel.app')).replace(/\/$/, '');
const OUT = flag('out', 'renders');
const ONLY = flag('only', null);
const SCALE = Number(flag('scale', 2));

/* Every path that carries data this project may not redistribute. Kept as one
   list so adding a licensed lane means adding it here, not remembering to. */
const LICENSED = [
  'data/prices.json',
  'data/personal-prices.json',
  'data/price-history.json',
  'data/personal-fundamentals.json',
];

/* ---------------------------------------------------------------- the frames
   `seed` runs BEFORE a reload, so anything that is only read at boot — a
   stored wheel plan, a theme — actually takes effect. `act` runs after, for
   state a click produces. `sel` is the element to crop to; without one the
   frame is the viewport, which is what an Open Graph card wants. */
const FRAMES = [
  {
    id: 'home-hero', path: '/', w: 1200, h: 630, wait: 5200,
    what: 'The homepage, at Open Graph size. The three proof figures are computed live by the same engines the product runs on, not typeset.',
  },
  {
    id: 'wheel-payoff', path: '/wheel', w: 1180, h: 900, wait: 4200,
    sel: 'svg[aria-label^="Payoff at expiry"]',
    seed: `localStorage.setItem('vl.wheelPlan', JSON.stringify(Object.assign({}, State.wheel, {
      symbol:'MSFT', contractMultiplier:100, contracts:1, putStrike:50, putCredit:1.10,
      openCommission:1, openFees:0, assignmentFees:0, eligibleCashUsd:5000,
      myrPerUsd:4.42, fxBufferPct:5, calendarDaysOpen:30 })))`,
    what: 'One cash-secured put, at expiry. Arithmetic on figures the reader entered — no chain data and no probability.',
  },
  {
    id: 'wheel-collateral', path: '/wheel', w: 1180, h: 900, wait: 4200,
    sel: 'svg[aria-label^="Cash reserved"]',
    seed: `localStorage.setItem('vl.wheelPlan', JSON.stringify(Object.assign({}, State.wheel, {
      symbol:'MSFT', contractMultiplier:100, contracts:1, putStrike:50, putCredit:1.10,
      openCommission:1, openFees:0, assignmentFees:0, eligibleCashUsd:3800,
      myrPerUsd:4.42, fxBufferPct:5, calendarDaysOpen:30 })))`,
    what: 'Collateral against the obligation, deliberately short. Cash-secured is a gate, and the shortfall is drawn as a size.',
  },
  {
    id: 'property-waterfall', path: '/property/calculator', w: 1180, h: 1000, wait: 5200,
    sel: 'svg[aria-label^="Cash needed to buy"]',
    what: 'What the cash to buy is actually for, and the gap between completing the purchase and being safe afterwards.',
  },
  {
    id: 'property-rent', path: '/property/calculator', w: 1180, h: 1000, wait: 5200,
    sel: 'svg[aria-label^="Entered rent"]',
    what: 'The entered rent against the rent that would cover fixed costs and the loan.',
  },
  {
    id: 'trading-index', path: '/trading-index', w: 1180, h: 1000, wait: 4200,
    sel: 'svg[aria-label^="Timeframe scores"]',
    act: `(() => { const b = [...document.querySelectorAll('button')].find(x => /worked example/.test(x.textContent)); if (b) b.click(); })()`,
    actWait: 1400,
    what: 'Three timeframes against the floor each must clear, with what was not recorded named on every row.',
  },
  {
    id: 'screener', path: '/discover/screener', w: 1440, h: 900, wait: 7000,
    /* Shown on the business-quality preset and scrolled sideways, which is the
       state the two screener changes exist for: the preset that gets a reader
       back to a readable table, and the company column holding its place while
       the metrics move under it.

       The default columns were the first choice and were the wrong one. This
       build carries no price licence, so Value and "vs base-case model" are
       correctly n/a and — for every row, and a frame led by three empty columns
       reads as a product that does not work rather than one that declines to
       invent. These five come from filed statements, so they are populated here
       and populated in front of a reader. */
    act: `(() => {
      const p = (typeof COL_PRESETS !== 'undefined') && COL_PRESETS.find(x => x.id === 'quality');
      if (p) { State.screen.cols = [...p.cols]; render(); }
    })()`,
    actWait: 1600,
    settle: `(() => {
      const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.tablewrap table.dt'));
      if (card) card.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -84);
      const tw = document.querySelector('.tablewrap[style*="overflow-x"]');
      /* Far enough that the "vs base-case model" column is fully past the
         frozen edge rather than clipped to a stub reading "E" over a row of
         dashes, which looks like a rendering fault instead of a column. */
      if (tw) tw.scrollLeft = 520;
      return !!tw;
    })()`,
    what: 'The screener on its business-quality preset, scrolled sideways so the frozen company column holds while the metrics move under it.',
  },
];

/* ------------------------------------------------------------- the gate */
/* Returns the restricted paths this base actually serves. An explicit
   controller with a cleared timer rather than AbortSignal.timeout: that helper
   leaves a live timer behind after the fetch settles, which on Windows either
   holds the process open or trips a libuv assertion when the refusal path
   exits underneath it. A gate that crashes on its way to refusing still
   refuses, but it reads like a bug rather than a decision. */
async function licensedPathsServed() {
  const served = [];
  for (const p of LICENSED) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      const r = await fetch(`${BASE}/${p}`, { cache: 'no-store', signal: ac.signal });
      /* A rewrite that returns index.html for an unknown path answers 200 with
         HTML. That is an absent file, not a served one, so the content type
         decides rather than the status code alone. */
      if (r.status === 200 && /json/i.test(r.headers.get('content-type') || '')) served.push(p);
    } catch { /* unreachable or refused is not "served" */ }
    finally { clearTimeout(timer); }
  }
  return served;
}

function explainRefusal(served) {
  console.error(`\nREFUSED — ${BASE} is serving data this project may not redistribute:\n`);
  served.forEach(p => console.error(`    ${p}`));
  console.error(`
A render is pixels, and pixels of licensed data are still licensed data. These
files are gitignored precisely so they never reach a public artefact; capturing
a frame that contains them would put them in one, permanently and unsearchably.

This is the expected result against a local dev server, which serves your own
copy of the price file. Render against production, where it 404s:

    node renders.mjs
`);
}

/* --------------------------------------------------------------- browser */
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  if (has('list')) {
    FRAMES.forEach(f => console.log(`${f.id.padEnd(20)} ${f.path}`));
    return;
  }

  console.log(`base   : ${BASE}`);
  const served = await licensedPathsServed();
  if (served.length) { explainRefusal(served); process.exitCode = 2; return; }
  console.log(`licence: none of the ${LICENSED.length} restricted paths is served — safe to capture\n`);

  const { default: sharp } = await import('sharp');
  const bin = CANDIDATES.find(existsSync);
  if (!bin) { console.error('no Chrome or Edge found'); process.exit(1); }

  await mkdir(OUT, { recursive: true });
  const profile = join(tmpdir(), `qt-renders-${process.pid}`);
  const port = 9800 + (process.pid % 150);
  const proc = spawn(bin, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    '--headless=new', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--force-color-profile=srgb',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws, sessionId;
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
    const send = (method, params = {}, sid = sessionId) => new Promise(res => {
      const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
    });

    const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' }, undefined);
    ({ result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
    await send('Runtime.enable');
    await send('Page.enable');

    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed');
      return r.result?.result?.value;
    };

    const wanted = FRAMES.filter(f => !ONLY || f.id === ONLY);
    if (!wanted.length) { console.error(`no frame named "${ONLY}"`); process.exit(1); }

    const manifest = [];
    for (const f of wanted) {
      process.stdout.write(`${f.id.padEnd(20)} `);

      await send('Emulation.setDeviceMetricsOverride',
        { width: f.w, height: f.h, deviceScaleFactor: SCALE, mobile: false });

      /* Seeding needs a load to read it back, so the page is visited twice:
         once to put the state in localStorage, once to render from it. */
      if (f.seed) {
        await send('Page.navigate', { url: BASE + f.path });
        await sleep(Math.min(f.wait, 3500));
        await evaluate(f.seed);
      }
      await send('Page.navigate', { url: BASE + f.path });
      await sleep(f.wait);
      if (f.act) {
        await evaluate(f.act);
        await sleep(f.actWait || 1200);
        /* Wait the toast out rather than deleting it. Loading the worked
           example raises "Worked example loaded", which sat squarely over two
           of the coverage notes in the first captured frame — the notes saying
           which evidence was never recorded, which are the last thing that may
           be obscured. It clears itself after 2.6s, so the frame just waits for
           the surface to settle instead of being tidied for the photograph. */
        for (let i = 0; i < 40; i++) {
          const showing = await evaluate(`(document.querySelector('#toast')?.dataset.show === '1')`);
          if (!showing) break;
          await sleep(200);
        }
        await sleep(400);   /* the fade-out transition */
      }
      /* Scroll position and anything else that must survive the final render,
         applied after the page has stopped moving. */
      if (f.settle) { await evaluate(f.settle); await sleep(600); }

      let clip = null, clipVia = null;
      if (f.sel) {
        /* Padding is horizontal only, and the asymmetry is the whole point.
           Vertically a block is bounded by its neighbours, so any pad at all
           reaches into them — 18px bled the rounded top edge of the next card
           into two frames and a stray card edge into a third. Horizontally it
           expands into the card's own padding, which is the same background,
           so it buys breathing room at no risk. With zero on both axes the
           caption of the rent frame ran flush into the right edge. */
        const padX = f.padX ?? 20, padY = f.padY ?? 0;
        /* .render-block first, .card only as a fallback. Cropping to the
           nearest card sounds right and is not: the property calculator puts
           both charts and a full cost table inside ONE card, so both frames
           came out as the same 2,700px-tall table with a different bar at the
           top of it. The block marks the chart and the caption that qualifies
           it, which is the unit worth publishing. */
        const box = await evaluate(`(() => {
          const n = document.querySelector(${JSON.stringify(f.sel)});
          if (!n) return null;
          const host = n.closest('.render-block') || n.closest('.card') || n;
          const r = host.getBoundingClientRect();
          return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height,
                   via: host.classList.contains('render-block') ? 'render-block'
                      : (host.classList.contains('card') ? 'card' : 'element') };
        })()`);
        if (!box) throw new Error(`selector matched nothing: ${f.sel}`);
        clipVia = box.via;
        clip = { x: Math.max(0, box.x - padX), y: Math.max(0, box.y - padY),
                 width: box.w + padX * 2, height: box.h + padY * 2, scale: 1 };
      }

      const { result: { data } } = await send('Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
      const png = Buffer.from(data, 'base64');

      const img = sharp(png);
      const meta = await img.metadata();
      const webp = await img.clone().webp({ quality: 88, effort: 5 }).toBuffer();
      const avif = await img.clone().avif({ quality: 58, effort: 5 }).toBuffer();
      await writeFile(join(OUT, `${f.id}.webp`), webp);
      await writeFile(join(OUT, `${f.id}.avif`), avif);

      /* A 2x render whose pixels are not 2x the layout is a render at 1x with a
         bigger filename, and it is the failure you cannot see in a thumbnail. */
      const expectW = Math.round((clip ? clip.width : f.w) * SCALE);
      const ok = Math.abs(meta.width - expectW) <= 2;
      const kb = (b) => `${(b.length / 1024).toFixed(0)}kB`;
      console.log(`${String(meta.width) + 'x' + meta.height}`.padEnd(12)
        + `${ok ? '' : `!! expected width ${expectW}  `}webp ${kb(webp)}  avif ${kb(avif)}`
        + (clip ? `  via ${clipVia}` : '  viewport'));
      if (!ok) process.exitCode = 1;
      manifest.push({ id: f.id, path: f.path, w: meta.width, h: meta.height,
                      webp: webp.length, avif: avif.length, what: f.what });
    }

    await writeFile(join(OUT, 'manifest.json'), JSON.stringify(
      { base: BASE, scale: SCALE, generated: 'run node renders.mjs to refresh', frames: manifest }, null, 2));
    console.log(`\n${manifest.length} frame(s) → ${OUT}/  (webp + avif, ${SCALE}x)`);
  } finally {
    try { ws?.close(); } catch { /* already gone */ }
    proc.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
