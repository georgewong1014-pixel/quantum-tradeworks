#!/usr/bin/env node
/**
 * Checks the filed-company statements against their own definitions.
 *
 *   node equity-test.mjs                        against production
 *   node equity-test.mjs http://localhost:8123  against a local server
 *   node equity-test.mjs --verbose              print every value
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * model-test drives the property arithmetic. Nothing drove the equities side,
 * and 119 companies with audited statements shipped for two months with a
 * label error on ten of them and four places where an absent line quietly
 * became a number. Neither throws, neither renders as NaN, and the sweep that
 * catches NaN and "undefined" therefore passed every time. These are the
 * failures the sweep cannot see: a figure that is a number, in the right cell,
 * and not the quantity its heading claims.
 *
 * The checks fall into three kinds.
 *
 * DEFINITIONS, which never go stale. A derived line is null exactly when an
 * input is; a growth rate over a split series is withheld; a fiscal-year label
 * is the company's own. These hold for any dataset and fail only when a rule
 * is broken.
 *
 * A GOLDEN SET, which is deliberately hard-coded. Three revenue figures from
 * three filings, looked up BY FISCAL-YEAR LABEL and compared to what the
 * companies published. model-test avoids expected values because defaults are
 * tuned; a filed figure is not tuned, it is a fact, and a re-ingest that moves
 * one has either fixed a defect or introduced one. Either way somebody should
 * look. It is also the only check here that would have caught the year-label
 * defect on its own: fin[8] was 391.035 whatever the heading said, and the
 * heading is what a reader trusts.
 *
 * RENDERED SURFACES, because the engine being right is not the page being
 * right. The statement table's headings, the Filings tab of a filed company,
 * the header chip of an illustrative one.
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
const CI_FLAGS = process.env.CI
  ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  : [];
const bin = CANDIDATES.find(existsSync);
if (!bin) { console.error('no Chrome or Edge found — set CHROME_PATH'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const profile = join(tmpdir(), `qt-equity-${process.pid}`);
const port = 9360 + (process.pid % 40);
const proc = spawn(bin, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--disable-gpu', 'about:blank', ...CI_FLAGS], { stdio: 'ignore' });

let failures = 0, passes = 0;
const fail = (msg, detail) => {
  failures++;
  console.error(`FAIL  ${msg}`);
  if (detail !== undefined) console.error(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};
const ok = (msg, detail) => {
  passes++;
  console.log(`ok    ${msg}`);
  if (VERBOSE && detail !== undefined) console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
};

/* Revenue, in billions of USD, as each company published it for the fiscal
   year it labels that way. Apple's 10-K for the year ended 28 September 2024
   reports net sales of $391,035m. Microsoft's for the year ended 30 June 2025
   reports revenue of $281,724m. Nvidia's for the year ended 26 January 2025
   reports revenue of $130,497m. Looked up by label, never by row. */
const GOLDEN = [
  { id: 'AAPL-SEC', fy: 2024, rev: 391.035 },
  { id: 'MSFT-SEC', fy: 2025, rev: 281.724 },
  { id: 'NVDA-SEC', fy: 2025, rev: 130.497 },
];

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

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description
        || r.result.exceptionDetails.text || 'evaluation threw');
    }
    return r.result.result.value;
  };

  console.log(`target  ${BASE}\n`);
  await send('Page.navigate', { url: `${BASE}/research` }, sessionId);

  /* The filings load after first paint. Wait for the universe to hold them
     rather than for a fixed time, and say how many arrived. */
  let real = 0;
  for (let i = 0; i < 80 && real < 100; i++) {
    await sleep(500);
    try { real = await evaluate(`typeof U === 'undefined' ? 0 : U.filter(r => r.c.real).length`); } catch { /* not booted yet */ }
  }
  if (real < 100) fail(`only ${real} filed companies loaded — the checks below need the SEC set`, { real });
  else ok(`${real} filed companies loaded`, { real });

  /* 1 — every fiscal-year label is the company's own. */
  {
    const r = await evaluate(`(() => {
      const bad = [], ends = {};
      for (const r of U.filter(r => r.c.real)) {
        const c = r.c, y = yearsOf(c);
        if (y.length !== c.fin.length) bad.push({ id: c.id, why: 'years and rows differ', y: y.length, rows: c.fin.length });
        else if (Array.isArray(c.years) && y !== c.years) bad.push({ id: c.id, why: 'yearsOf did not return the record\\'s own years' });
        else if (latestFy(c) !== c.years[c.years.length - 1]) bad.push({ id: c.id, why: 'latestFy is not the last year' });
        ends[latestFy(c)] = (ends[latestFy(c)] || 0) + 1;
      }
      return { bad, ends };
    })()`);
    if (r.bad.length) fail(`${r.bad.length} filed companies label years from the wrong axis`, r.bad.slice(0, 5));
    else ok(`every filed company is labelled with its own fiscal years — latest year ${Object.entries(r.ends).map(([y, n]) => `${y}×${n}`).join(', ')}`, r.ends);
  }

  /* 2 — the golden set, by label. */
  for (const g of GOLDEN) {
    const r = await evaluate(`(() => {
      const row = BY_ID.get(${JSON.stringify(g.id)});
      if (!row) return { missing: true };
      const y = yearsOf(row.c), k = y.indexOf(${g.fy});
      return { k, rev: k < 0 ? null : row.c.fin[k][0], years: [y[0], y[y.length - 1]] };
    })()`);
    if (r.missing) fail(`${g.id} is not in the universe`, r);
    else if (r.k < 0) fail(`${g.id} has no FY${g.fy} — window is FY${r.years[0]}–FY${r.years[1]}`, r);
    else if (Math.abs(r.rev - g.rev) > 1e-6) fail(`${g.id} FY${g.fy} revenue is ${r.rev}, filing says ${g.rev}`, r);
    else ok(`${g.id} FY${g.fy} revenue ${r.rev}bn matches the filing, found under its own label`, r);
  }

  /* 3 — an absent input never becomes a figure. */
  {
    const r = await evaluate(`(() => {
      const out = { checked: 0, leaks: [], unavailable: 0, needsBridge: 0 };
      const BRIDGE = new Set(['dcf', 'dcfMid', 'scenario', 'sotp', 'early']);
      for (const r of U.filter(r => r.c.real)) {
        const { c, d, m } = r, i = c.fin.length - 1;
        const capex = c.fin[i][4], dps = c.fin[i][9], debt = c.fin[i][6], cash = c.fin[i][7];
        out.checked++;
        if (capex == null && isNum(m.reinv)) out.leaks.push({ id: c.id, k: 'reinv', v: m.reinv });
        if (dps == null) for (const k of ['payout', 'dy', 'cashPayout']) if (isNum(m[k])) out.leaks.push({ id: c.id, k, v: m[k] });
        if (c.type !== 'bank' && (debt == null || cash == null)) {
          if (isNum(m.netDebt)) out.leaks.push({ id: c.id, k: 'netDebt', v: m.netDebt });
          if (BRIDGE.has(r.val.pack.id)) { out.needsBridge++; if (!r.val.err) out.leaks.push({ id: c.id, k: 'valuation', v: r.val.vals?.base }); else out.unavailable++; }
        }
        if (debt == null && isNum(m.de)) out.leaks.push({ id: c.id, k: 'de', v: m.de });
      }
      return out;
    })()`);
    if (r.leaks.length) fail(`${r.leaks.length} places where an absent line became a figure`, r.leaks.slice(0, 8));
    else ok(`no absent line becomes a figure across ${r.checked} filed companies — ${r.unavailable} of ${r.needsBridge} that need a net-debt bridge and lack one report the valuation unavailable`, r);
  }

  /* 4 — derived lines are both inputs or nothing, in every year. */
  {
    const r = await evaluate(`(() => {
      const bad = [];
      for (const r of U.filter(r => r.c.real)) {
        const { c, d } = r;
        for (let k = 0; k < c.fin.length; k++) {
          const ocf = c.fin[k][3], capex = c.fin[k][4];
          const shouldBeNull = ocf == null || capex == null;
          if (shouldBeNull !== !isNum(d.fcf[k])) bad.push({ id: c.id, k, ocf, capex, fcf: d.fcf[k] });
        }
      }
      return bad;
    })()`);
    if (r.length) fail(`${r.length} free-cash-flow cells disagree with their inputs' presence`, r.slice(0, 5));
    else ok('free cash flow is null exactly where operating cash flow or capex is, in every year of every filed company');
  }

  /* 5 — a split withholds every per-share growth rate. */
  {
    const r = await evaluate(`(() => {
      const split = U.filter(r => r.c.real && r.m.shareSeriesBreak);
      const leaks = [];
      for (const r of split) for (const k of ['eps5', 'bv5', 'dps5', 'eps10', 'dps10', 'dilution', 'buyback'])
        if (isNum(r.m[k])) leaks.push({ id: r.c.id, k, v: r.m[k] });
      return { n: split.length, leaks, ids: split.map(r => r.c.tk).slice(0, 8) };
    })()`);
    if (!r.n) fail('no filed company shows a share-series break — the split rule is untested', r);
    else if (r.leaks.length) fail(`${r.leaks.length} per-share growth rates survive a split`, r.leaks.slice(0, 6));
    else ok(`per-share growth withheld on all ${r.n} filed companies whose share series breaks (${r.ids.join(', ')}…)`, r);
  }

  /* 6 — the statement table of a filed company reads its own years and prints
         no zero for an absent line. Microsoft: fiscal year ends in June, so its
         window runs a year past the illustrative axis. */
  {
    await evaluate(`openResearch('MSFT-SEC', 'financials'); true`);
    await sleep(1500);
    const r = await evaluate(`(() => {
      const c = BY_ID.get('MSFT-SEC').c, y = yearsOf(c);
      const tables = [...document.querySelectorAll('table.dt')];
      const stmt = tables.find(t => t.querySelector('thead th')?.textContent.trim() === 'Line' && /CAGR/.test(t.querySelector('thead')?.textContent || ''));
      if (!stmt) return { missing: true };
      const ths = [...stmt.querySelectorAll('thead th')].map(th => th.textContent.trim());
      const text = stmt.textContent;
      return { first: ths[1], last: ths[ths.length - 2], want: ['FY' + y[0], 'FY' + y[y.length - 1]],
               negZero: /-0\\.000/.test(text), nan: /NaN|undefined/.test(text),
               quarterly: /Not carried in this build/.test(document.querySelector('main')?.textContent || '') };
    })()`);
    if (r.missing) fail('MSFT-SEC statement table not found on the Financials tab');
    else {
      if (r.first !== r.want[0] || r.last !== r.want[1]) fail(`MSFT-SEC statement columns run ${r.first}–${r.last}, its years are ${r.want[0]}–${r.want[1]}`, r);
      else ok(`MSFT-SEC statement columns run ${r.first}–${r.last}, its own fiscal years`, r);
      if (r.negZero || r.nan) fail('MSFT-SEC statement table prints -0.000, NaN or undefined', r);
      else ok('MSFT-SEC statement table prints no zero for an absent line');
      if (!r.quarterly) fail('a filed company still shows an invented quarterly profile', r);
      else ok('a filed company shows no invented quarters — the page says they are not carried');
    }
  }

  /* 7 — a filed company's Filings tab holds the real index and no sample list. */
  {
    await evaluate(`openResearch('MSFT-SEC', 'filings'); true`);
    await sleep(1200);
    const r = await evaluate(`(() => {
      const t = document.querySelector('main')?.textContent || '';
      const links = [...document.querySelectorAll('main a[href*="sec.gov"]')].map(a => a.href);
      return { sample: /Sample document list/.test(t), cik: /CIK/.test(t), links: links.length,
               edgar: links.some(h => /browse-edgar/.test(h)), facts: links.some(h => /companyfacts/.test(h)) };
    })()`);
    if (r.sample) fail('a filed company\'s Filings tab still carries the invented sample document list', r);
    else if (!r.cik || !r.edgar || !r.facts) fail('a filed company\'s Filings tab does not link the real EDGAR index and companyfacts record', r);
    else ok(`a filed company's Filings tab links EDGAR and its companyfacts record (${r.links} links), and invents nothing`, r);
  }

  /* 8 — an illustrative company says so at the top of its page. */
  {
    await evaluate(`openResearch('MAYBANK', 'snapshot'); true`);
    await sleep(1200);
    const r = await evaluate(`(() => {
      const c = BY_ID.get('MAYBANK')?.c;
      const h = document.querySelector('main .identity-row')?.textContent || '';
      return { found: !!c, real: c?.real, chip: /illustrative figures/.test(h) };
    })()`);
    if (!r.found) fail('MAYBANK is not in the universe', r);
    else if (r.real) ok('MAYBANK carries filed statements in this build — the illustrative chip does not apply', r);
    else if (!r.chip) fail('an illustrative company\'s identity header does not say so', r);
    else ok('an illustrative company\'s identity header says "illustrative figures"', r);
  }

  /* 9 — the no-valuation card names the reason and prints no undefined. Ford
         carries no resolved debt line, so its bridge cannot be made. */
  {
    const r = await evaluate(`(() => {
      const row = BY_ID.get('F-SEC');
      if (!row) return { missing: true };
      return { err: row.val.err || null, netDebt: row.m.netDebt, pack: row.val.pack.id };
    })()`);
    /* Number.isFinite, not the global: isFinite(null) is true, which is the
       kind of coercion this whole file exists to catch. */
    if (r.missing) ok('F-SEC not in the universe — bridge check covered by check 3');
    else if (Number.isFinite(r.netDebt)) ok(`F-SEC now carries a net debt line (${r.netDebt}) — bridge check covered by check 3`, r);
    else if (!r.err || !/Net debt could not be established/.test(r.err)) fail('F-SEC has no net debt and its valuation does not say so', r);
    else {
      await evaluate(`openResearch('F-SEC', 'valuation'); true`);
      await sleep(1200);
      const t = await evaluate(`document.querySelector('main')?.textContent || ''`);
      if (/undefined/.test(t)) fail('F-SEC valuation tab prints "undefined"');
      else if (!/Net debt could not be established/.test(t)) fail('F-SEC valuation tab does not state why no estimate is shown');
      else ok('F-SEC valuation tab states that net debt could not be established, and prints no undefined');
    }
  }
} catch (e) {
  fail('harness error', e.message);
} finally {
  try { ws?.close(); } catch { /* closed */ }
  proc.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
