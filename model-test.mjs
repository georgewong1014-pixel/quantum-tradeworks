#!/usr/bin/env node
/**
 * Checks the property model against its own definitions.
 *
 *   node model-test.mjs                        against production
 *   node model-test.mjs http://localhost:8123  against a local server
 *   node model-test.mjs --verbose              print every value
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * register-test drives a SEQUENCE, because the bug it was written for only
 * appeared when one feature met another. This drives ARITHMETIC, because the
 * bugs on this side are of a different kind: a number that is plausible, sits
 * in the right place on the page, moves in the right direction when an input
 * moves — and is not the quantity its label claims.
 *
 * Every check here is a DEFINITION, not an expected value. Nothing below
 * hard-codes "the IRR is 2.38%", because that would break every time an input
 * default is tuned and would teach nobody anything when it did. Instead each
 * check asserts the property that makes the figure what it says it is: the
 * discount rate that zeroes the flows IS the internal rate of return; the rent
 * at which the monthly position is zero IS the break-even rent. A figure that
 * fails one of these is mislabelled, which is the failure mode this product can
 * least afford.
 *
 * WHAT IT ASSERTS
 *
 *   1  NPV of the published flows at the published IRR is zero.
 *   2  path[0].cfPreTax / 12 equals cashflowMonthly exactly. The after-tax
 *      break-even is solved on path[0].cf and compared against breakEvenRent,
 *      so if these two ever stop being the same quantity, that comparison is
 *      between different things and the difference is no longer tax.
 *   3  breakEvenRent really is the rent at which the monthly position is zero.
 *      This is the check that earns the decision NOT to re-solve it: the
 *      sensitivity panel cites the model's figure, so the model's figure has to
 *      be right.
 *   4  A solved break-point really is a zero of the thing it breaks.
 *   5  After-tax break-even rent EXCEEDS the pre-tax one whenever a marginal
 *      rate is entered — the direction the panel asserts in prose. It holds
 *      because principal is taxed and not deductible, so it must hold in the
 *      arithmetic too.
 *   6  With no marginal rate, after-tax cash flow equals pre-tax cash flow.
 *   7  Every driver in the tornado moves the answer, or is legitimately
 *      unprobed. A driver that always reads 0.00 pp is either wired to the
 *      wrong key or is not a driver.
 *   8  The tornado is sorted by magnitude — it is the only thing that makes it
 *      a ranking rather than a list.
 *   9  Running the sensitivity does not mutate State. It calls dealModel
 *      sixteen times with spread copies; if any of that leaked, every figure on
 *      the page would silently be one of the probes.
 *  10  tornadoChart called with no overrides still renders exactly what the
 *      equity studio rendered before it was parameterised. Three strings and
 *      a number format in that function were written for value-per-share and
 *      had to be made per-caller for the property tornado to use it; the
 *      defaults are what keeps the valuation studio unchanged, and a default
 *      is exactly the kind of thing a later edit quietly drops.
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
const profile = join(tmpdir(), `qt-model-${process.pid}`);
const port = 9310 + (process.pid % 40);
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
  await send('Page.navigate', { url: `${BASE}/property/calculator` }, sessionId);
  await sleep(4000);

  /* Two deals: the shipped default, which runs at a monthly loss, and one let
     at a rent high enough to produce taxable income. Several checks are vacuous
     on a deal that never pays tax, so both are needed. */
  await evaluate(`window.__T = {
    base: { ...State.deal },
    taxed: { ...State.deal, rent: 3600, marginalTaxPct: 24 },
  }; true`);

  /* 1 — the IRR is the rate that zeroes the flows. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel(window.__T.base);
      if (!isNum(m.irrPct)) return { skip: m.irrWhy || 'no irr' };
      const npv = npvAt(m.irrPct / 100, m.flows);
      const scale = Math.max(...m.flows.map(Math.abs));
      return { irr: m.irrPct, npv, rel: Math.abs(npv) / scale, n: m.flows.length };
    })()`);
    if (r.skip) fail('IRR not computed on the default deal', r.skip);
    else if (r.rel > 1e-8) fail(`NPV at the published IRR is not zero (relative ${r.rel.toExponential(2)})`, r);
    else ok(`NPV at the published IRR is zero — ${r.irr.toFixed(4)}% over ${r.n} flows`, r);
  }

  /* 2 — the identity the after-tax break-even rests on. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel(window.__T.base);
      const a = m.path[0].cfPreTax / 12, b = m.cashflowMonthly;
      return { a, b, diff: Math.abs(a - b) };
    })()`);
    if (r.diff > 1e-9) fail('path[0].cfPreTax / 12 is not cashflowMonthly', r);
    else ok('year-one pre-tax cash flow equals the monthly position', r);
  }

  /* 3 — breakEvenRent is the rent at which the monthly position is zero.
         The check that justifies citing it instead of re-solving it. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel(window.__T.base);
      if (!isNum(m.breakEvenRent)) return { skip: 'no breakEvenRent' };
      const at = dealModel({ ...window.__T.base, rent: m.breakEvenRent });
      return { rent: m.breakEvenRent, residual: at.cashflowMonthly };
    })()`);
    if (r.skip) fail('breakEvenRent not computed', r.skip);
    else if (Math.abs(r.residual) > 0.01) fail(`at breakEvenRent the monthly position is ${r.residual}, not zero`, r);
    else ok(`breakEvenRent is a true zero of the monthly position — RM${r.rent.toFixed(2)}`, r);
  }

  /* 4 — a solved break-point is a zero of the thing it breaks. */
  {
    const r = await evaluate(`(() => {
      const out = [];
      for (const [k, lo, hi] of [['ratePct', 0, 25], ['vacancyPct', 0, 100]]) {
        const bp = propertyBreakPoint(window.__T.base, k, { measure: 'cashflow', lo, hi });
        if (!isNum(bp.value)) { out.push({ k, crossed: false, sign: bp.sign }); continue; }
        const at = dealModel({ ...window.__T.base, [k]: bp.value });
        out.push({ k, crossed: true, value: bp.value, residual: at.cashflowMonthly });
      }
      return out;
    })()`);
    for (const x of r) {
      if (!x.crossed) ok(`${x.k} does not cross in range — reported rather than fudged`, x);
      else if (Math.abs(x.residual) > 0.01) fail(`${x.k} break-point is not a zero (residual ${x.residual})`, x);
      else ok(`${x.k} break-point is a true zero at ${x.value.toFixed(4)}`, x);
    }
  }

  /* 5 — after-tax break-even exceeds pre-tax, the direction the panel claims. */
  {
    const r = await evaluate(`(() => {
      const d = window.__T.taxed;
      const m = dealModel(d);
      if (!m.taxComputed) return { skip: 'tax not computed on the taxed deal' };
      const bp = propertyBreakPoint(d, 'rent', { measure: 'cashflowAfterTax', lo: 0, hi: Math.max(d.rent * 6, 30000) });
      if (!isNum(bp.value)) return { skip: 'after-tax break-even did not cross' };
      const at = dealModel({ ...d, rent: bp.value });
      return { pre: m.breakEvenRent, post: bp.value, gap: bp.value - m.breakEvenRent,
               residual: at.path[0].cf / 12 };
    })()`);
    if (r.skip) fail('after-tax break-even could not be checked', r.skip);
    else if (Math.abs(r.residual) > 0.01) fail(`after-tax break-even is not a zero (residual ${r.residual})`, r);
    else if (!(r.gap > 0)) fail('after-tax break-even is not above the pre-tax one — the panel says it is', r);
    else ok(`after-tax break-even exceeds pre-tax by RM${r.gap.toFixed(2)} — RM${r.pre.toFixed(0)} to RM${r.post.toFixed(0)}`, r);
  }

  /* 6 — no rate entered means the two cash flows are the same number. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel({ ...window.__T.base, marginalTaxPct: null });
      const worst = Math.max(...m.path.map(p => Math.abs(p.cf - p.cfPreTax)));
      return { worst, taxComputed: m.taxComputed, cumTax: m.cumTax };
    })()`);
    if (r.taxComputed) fail('tax reported as computed with no marginal rate entered', r);
    else if (r.worst > 1e-9) fail('after-tax cash flow differs from pre-tax with no rate entered', r);
    else ok('with no marginal rate, after-tax equals before-tax everywhere', r);
  }

  /* 7 and 8 — every driver moves something, and the list is a ranking. */
  {
    const r = await evaluate(`(() => {
      const s = propertySensitivity(window.__T.base);
      if (!s.ok) return { skip: s.why };
      return { drivers: s.drivers.map(x => ({ k: x.k, span: x.span, step: x.step,
                                              probed: isNum(x.hi) || isNum(x.lo) })),
               declared: PROPERTY_DRIVERS.length };
    })()`);
    if (r.skip) fail('sensitivity did not run', r.skip);
    else {
      const dead = r.drivers.filter(x => x.probed && x.span < 1e-6);
      if (dead.length) fail(`${dead.map(x => x.k).join(', ')} probed but moved the return by nothing — wrong key, or not a driver`, dead);
      else ok(`all ${r.drivers.length} drivers move the return`, r.drivers.map(x => `${x.k} ${x.span.toFixed(2)}pp`).join(', '));

      const spans = r.drivers.map(x => x.span);
      const sorted = spans.every((v, i) => i === 0 || spans[i - 1] >= v);
      if (!sorted) fail('the tornado is not sorted by magnitude, so it is a list and not a ranking', spans);
      else ok(`ranked, ${spans[0].toFixed(2)}pp down to ${spans[spans.length - 1].toFixed(2)}pp`);

      if (r.drivers.length !== r.declared) fail(`${r.declared} drivers declared, ${r.drivers.length} survived — one has a zero step`, r);
    }
  }

  /* 9 — sixteen model runs and nothing leaked into State. */
  {
    const r = await evaluate(`(() => {
      const before = JSON.stringify(State.deal);
      propertySensitivity(State.deal);
      propertyBreakPoint(State.deal, 'ratePct', { measure: 'cashflow', lo: 0, hi: 25 });
      const after = JSON.stringify(State.deal);
      return { same: before === after, before, after };
    })()`);
    if (!r.same) fail('running the sensitivity mutated State.deal', { before: r.before, after: r.after });
    else ok('sensitivity and break-point leave State.deal untouched');
  }

  /* 10 — the shared chart still speaks equity when nobody tells it otherwise. */
  {
    const r = await evaluate(`(() => {
      const host = document.createElement('div');
      host.style.width = '600px';
      document.body.appendChild(host);
      tornadoChart(host, { drivers: [{ label: 'Discount rate', unit: 'pp', step: 1, hi: 12, lo: -12, span: 12 }] });
      const svg = host.querySelector('svg');
      const texts = [...host.querySelectorAll('text')].map(t => t.textContent);
      const aria = svg ? svg.getAttribute('aria-label') : null;
      host.remove();
      return { aria, texts };
    })()`);
    const wantAria = 'Change in value per share for a step in each assumption';
    if (r.aria !== wantAria) fail('the tornado default aria-label changed', { got: r.aria, want: wantAria });
    else if (!r.texts.includes('\u00b112.0%')) fail('the tornado default span label changed', r.texts);
    else ok('tornadoChart with no overrides still renders the equity labels', r.texts.join(' / '));
  }

} catch (e) {
  fail('harness error', e.message);
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
  await sleep(300);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(failures
  ? `\n${failures} failed, ${passes} passed. A figure that fails one of these is mislabelled, not merely imprecise.`
  : `\nall ${passes} model invariants hold`);
process.exitCode = failures ? 1 : 0;
