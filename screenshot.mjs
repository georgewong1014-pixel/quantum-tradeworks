#!/usr/bin/env node
// Zero-dependency screenshot tool. Drives a locally installed Chrome/Edge over the
// DevTools Protocol using Node's built-in WebSocket (Node >= 22).
//
//   node screenshot.mjs http://localhost:3000
//   node screenshot.mjs http://localhost:3000 homepage
//   node screenshot.mjs http://localhost:3000 home-mobile --width 390 --height 844
//   node screenshot.mjs http://localhost:3000 home-dark --dark
//   node screenshot.mjs http://localhost:3000 home-fold --viewport-only
//
// Output: ./temporary screenshots/screenshot-<label>.png
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , rawUrl, rawLabel] = process.argv;
if (!rawUrl || rawUrl.startsWith('--')) {
  console.error('usage: node screenshot.mjs <url> [label] [--width N] [--height N] [--dark] [--viewport-only] [--wait ms]');
  process.exit(1);
}
if (rawUrl.startsWith('file://')) {
  console.error('Refusing to screenshot a file:// URL — serve it over localhost first (node serve.mjs).');
  process.exit(1);
}

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const label = rawLabel && !rawLabel.startsWith('--') ? rawLabel : 'page';
const WIDTH = Number(flag('width', 1440));
const HEIGHT = Number(flag('height', 900));
const WAIT = Number(flag('wait', 700));
const DARK = has('dark');
const VIEWPORT_ONLY = has('viewport-only');
const OUT_DIR = join(process.cwd(), 'temporary screenshots');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const browserPath = CANDIDATES.find((p) => existsSync(p));
if (!browserPath) {
  console.error('No Chrome/Edge binary found. Set CHROME_PATH to one.');
  process.exit(1);
}

const port = 9000 + Math.floor(process.pid % 900);
const profile = join(tmpdir(), `cdp-shot-${process.pid}`);

const child = spawn(browserPath, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-color-profile=srgb',
  '--font-render-hinting=none',
  'about:blank',
], { stdio: 'ignore' });

const cleanup = async () => {
  try { child.kill(); } catch {}
  try { await rm(profile, { recursive: true, force: true }); } catch {}
};

async function waitForEndpoint() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Browser DevTools endpoint never came up.');
}

function connect(wsUrl) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Map();
    const persistent = new Map();

    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: fail } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? fail(new Error(msg.error.message)) : ok(msg.result);
      } else if (msg.method) {
        if (persistent.has(msg.method)) persistent.get(msg.method).forEach((fn) => fn(msg.params));
        if (listeners.has(msg.method)) {
          listeners.get(msg.method).forEach((fn) => fn(msg.params));
          listeners.delete(msg.method);
        }
      }
    });
    ws.addEventListener('error', reject);
    ws.addEventListener('open', () => {
      resolvePromise({
        send(method, params = {}, sessionId) {
          return new Promise((ok, fail) => {
            const msgId = ++id;
            pending.set(msgId, { resolve: ok, reject: fail });
            ws.send(JSON.stringify({ id: msgId, method, params, sessionId }));
          });
        },
        once(method) {
          return new Promise((ok) => {
            if (!listeners.has(method)) listeners.set(method, []);
            listeners.get(method).push(ok);
          });
        },
        on(method, fn) {
          if (!persistent.has(method)) persistent.set(method, []);
          persistent.get(method).push(fn);
        },
        close: () => ws.close(),
      });
    });
  });
}

try {
  const cdp = await connect(await waitForEndpoint());

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  cdp.on('Runtime.exceptionThrown', p =>
    console.error('PAGE ERROR:', p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error' || p.type === 'warning')
      console.error(`PAGE ${p.type.toUpperCase()}:`, p.args.map(a => a.value ?? a.description ?? '').join(' '));
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 2,
    mobile: WIDTH < 700,
  }, sessionId);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: DARK ? 'dark' : 'light' }],
  }, sessionId);

  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: rawUrl }, sessionId);
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);
  await new Promise((r) => setTimeout(r, WAIT));

  // Let lazy/animated content settle, then measure the real page height.
  const { result } = await cdp.send('Runtime.evaluate', {
    expression: 'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)',
    returnByValue: true,
  }, sessionId);

  const fullHeight = Math.min(Number(result.value) || HEIGHT, 20000);
  const shotHeight = VIEWPORT_ONLY ? HEIGHT : fullHeight;

  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !VIEWPORT_ONLY,
    clip: { x: 0, y: 0, width: WIDTH, height: shotHeight, scale: 1 },
  }, sessionId);

  await mkdir(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `screenshot-${label}.png`);
  await writeFile(out, Buffer.from(data, 'base64'));

  console.log(`${out}  (${WIDTH}x${shotHeight}${DARK ? ', dark' : ''})`);
  cdp.close();
} finally {
  await cleanup();
}
