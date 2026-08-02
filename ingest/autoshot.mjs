#!/usr/bin/env node
/**
 * Unattended watchlist capture: scrolls a list in a browser and writes one PNG
 * per screenful.  PERSONAL RESEARCH ONLY.
 *
 *   node ingest/autoshot.mjs --login                    # one-time: sign in
 *   node ingest/autoshot.mjs --url "<watchlist url>"    # daily capture
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A DEDICATED PROFILE AND NOT YOUR OPEN WINDOW
 *   Capturing the browser window you are actually using needs an unlocked,
 *   logged-in desktop, because a scheduled task set to "run whether user is
 *   logged on or not" lands in session 0, which has no desktop — every capture
 *   comes back black. It also breaks the moment you move the window, cover it,
 *   or leave a dialog open.
 *
 *   A dedicated profile removes all of that. You sign in once with --login;
 *   after that this drives its own headless browser, which does not care
 *   whether the screen is locked, does not touch your cursor, and cannot be
 *   disturbed by anything you do. It never reads your normal Chrome profile.
 *
 * WHY IT SCROLLS RATHER THAN CAPTURING THE WHOLE PAGE
 *   A watchlist is a virtualised list: rows outside the viewport do not exist
 *   in the DOM, so captureBeyondViewport returns blank space where the rest of
 *   the list should be. It has to be scrolled to be seen.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(`--${n}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const LOGIN     = has('login');
const URL_      = flag('url', null);
const OUT_DIR   = flag('out', 'watchlist-shots/auto');
const PROFILE   = resolve(flag('profile', '.chrome-watchlist'));
const WIDTH     = Number(flag('width', 900));
const HEIGHT    = Number(flag('height', 1000));
const MAX_PAGES = Number(flag('max-pages', 15));
const SETTLE    = Number(flag('settle', 900));
/* A fraction of the viewport, never a fixed number of pixels. Two rows were
   lost in testing at 620px viewport with a 600px step: one fell in the 20px
   seam, and one sat permanently under the sticky column header, which covers
   whatever is beneath it after every scroll. 70% leaves an overlap far deeper
   than any header, so every row is fully visible in at least one capture. */
const WHEEL     = Number(flag('wheel', Math.round(HEIGHT * 0.7)));
/* Beside the capture folder, never inside it: the folder is wiped at the start
   of every run, which silently destroyed the record the staleness check needs
   and left the check unable to fire at all. */
const STATE     = `${OUT_DIR.replace(/[\\/]+$/, '')}.state.json`;

if (!LOGIN && !URL_) {
  console.error(`usage:
  node ingest/autoshot.mjs --login --url "<watchlist url>"   sign in once, visibly
  node ingest/autoshot.mjs --url "<watchlist url>"           capture, headless

The profile lives in ${PROFILE} and is git-ignored. Your normal Chrome profile
is never opened or read.`);
  process.exit(1);
}

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const browserPath = CANDIDATES.find(p => existsSync(p));
if (!browserPath) { console.error('No Chrome/Edge binary found. Set CHROME_PATH.'); process.exit(1); }

const port = 9300 + (process.pid % 600);
const child = spawn(browserPath, [
  ...(LOGIN ? [] : ['--headless=new']),
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check',
  '--disable-gpu', '--force-color-profile=srgb',
  ...(LOGIN ? [`--window-size=${WIDTH},${HEIGHT}`] : []),
  'about:blank',
], { stdio: 'ignore', detached: false });

const cleanup = () => { try { child.kill(); } catch {} };

async function endpoint() {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return (await r.json()).webSocketDebuggerUrl; }
    catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('the browser DevTools endpoint never came up');
}

function connect(wsUrl) {
  return new Promise((ok, bad) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener('message', e => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id); pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      }
    });
    ws.addEventListener('error', bad);
    ws.addEventListener('open', () => ok({
      send: (method, params = {}, sessionId) => new Promise((res, rej) => {
        const i = ++id; pending.set(i, { res, rej });
        ws.send(JSON.stringify({ id: i, method, params, sessionId }));
      }),
      close: () => ws.close(),
    }));
  });
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

try {
  const cdp = await connect(await endpoint());
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false }, sessionId);

  if (URL_) {
    await cdp.send('Page.navigate', { url: URL_ }, sessionId);
    await new Promise(r => setTimeout(r, 2500));
  }

  if (LOGIN) {
    console.log(`A browser window is open using the profile at
  ${PROFILE}

Sign in to your watchlist, arrange the columns so Symbol and Last are both
visible, then close the window. The session is saved and later runs are
headless — they will not need the screen unlocked.

Waiting for you to close it…`);
    await new Promise(res => child.on('exit', res));
    console.log('\nSaved. Now run the same command without --login.');
    process.exit(0);
  }

  /* Fresh directory each run: a leftover page from yesterday would be OCR'd as
     if it were today's, and a stale price that looks plausible is exactly the
     failure this whole pipeline is built to avoid. */
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const shot = async () => {
    const { data } = await cdp.send('Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: false }, sessionId);
    return Buffer.from(data, 'base64');
  };

  const pages = [];
  let lastHash = null;
  for (let p = 0; p < MAX_PAGES; p++) {
    await new Promise(r => setTimeout(r, SETTLE));
    const buf = await shot();
    const h = sha(buf);
    /* Identical to the previous screenful means the list stopped moving: the
       bottom. A fixed page count would either miss rows or capture the same
       screen repeatedly and quietly overstate coverage. */
    if (h === lastHash) break;
    lastHash = h;
    const file = join(OUT_DIR, `page-${String(p).padStart(2, '0')}.png`);
    await writeFile(file, buf);
    pages.push({ file, hash: h });
    console.log(`page ${p}  ${(buf.length / 1024).toFixed(0)} KB  ${file}`);

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: Math.floor(WIDTH / 2), y: Math.floor(HEIGHT / 2),
      deltaX: 0, deltaY: WHEEL,
    }, sessionId);
  }

  if (!pages.length) throw new Error('no pages captured');

  /* Staleness: a capture identical to yesterday's is not a quiet market, it is
     a broken capture — a logged-out session, a stuck tab, a changed layout.
     Nothing downstream can tell the difference, so it is caught here. */
  let previous = null;
  try { previous = JSON.parse(await readFile(STATE, 'utf8')); } catch { /* first run */ }
  const fingerprint = sha(pages.map(p => p.hash).join('|'));
  const stale = previous && previous.fingerprint === fingerprint;

  await writeFile(STATE, JSON.stringify({
    fingerprint, pages: pages.length, at: new Date().toISOString(), url: URL_,
  }, null, 2));

  console.log(`\ncaptured ${pages.length} page(s) into ${OUT_DIR}`);
  if (stale) {
    console.error(`\nSTALE: every page is byte-identical to the run at ${previous.at}.`);
    console.error('Nothing on the screen changed. Likely a signed-out session, a stuck');
    console.error('tab, or a layout that no longer shows the list. Not importing.');
    process.exit(2);
  }
  cdp.close();
} catch (e) {
  console.error(`autoshot failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  cleanup();
}
