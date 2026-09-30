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
/* CDP_PORT pins the debugging port, so harnesses run side by side (several
   worktrees, or CI jobs on one runner) cannot land on the same Chrome. */
const port = Number(process.env.CDP_PORT) || 9310 + (process.pid % 40);
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
  /* Waited for, not slept on: until the page says it has drawn its data in
     (propertyPagesSettled, 70-property.js). A fixed 4s ended before boot on
     a loaded machine, and every check after it read a page not yet there. */
  {
    let last = 'no answer';
    for (const t = Date.now(); ; await sleep(100)) {
      const r = await send('Runtime.evaluate', { expression: 'propertyPagesSettled()', returnByValue: true }, sessionId);
      if (r.result?.result?.value === true) break;
      last = r.result?.exceptionDetails ? String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).split('\n')[0] : 'not settled';
      if (Date.now() - t > 30000) throw new Error(`the calculator did not finish loading in 30s — it last answered: ${last}`);
    }
  }

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

  /* ------------------------------------------------------------------ CLASS
     The property class used to be decoration: it was asked for, printed in the
     heading, put in the URL — and never read by dealModel. These five hold it
     to actually deciding something, and hold the residential answer still
     while it does. */

  /* 12 — the class reaches the model at all. */
  {
    const r = await evaluate(`(() => {
      const land = dealModel({ ...window.__T.base, propertyType: 'Land' });
      const cond = dealModel({ ...window.__T.base, propertyType: 'Condominium' });
      return { landClass: land.propertyClass, condClass: cond.propertyClass,
               identical: JSON.stringify(land) === JSON.stringify(cond) };
    })()`);
    if (r.identical) fail('a Land deal and a Condominium deal still produce identical models', r);
    else if (r.landClass !== 'land' || r.condClass !== 'residential') fail('propertyType does not resolve to the expected class', r);
    else ok('the property class reaches the model — Land and Condominium now differ', r);
  }

  /* 13 — a class without a tenancy withholds, rather than computing off zero. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel({ ...window.__T.base, propertyType: 'Land' });
      const withheld = ['effectiveRent','grossAnnualRent','noi','grossYield','netYield','dscr','breakEvenRent','cashOnCash'];
      return { computed: withheld.filter(k => m[k] !== null), lets: m.letsToTenant };
    })()`);
    if (r.lets !== false) fail('Land is modelled as letting to a tenant', r);
    else if (r.computed.length) fail('Land computes rent-derived figures instead of withholding them: ' + r.computed.join(', '), r);
    else ok('Land withholds all eight rent-derived quantities rather than returning zero', r);
  }

  /* 14 — withholding must not blank the return panel. A null pushed into the
         flow vector would trip irrOf's every(isNum) guard and report "a period
         is missing a cash flow", which is false: a parcel's cash flow is not
         missing, it is negative. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel({ ...window.__T.base, propertyType: 'Land' });
      return { finite: m.flows.every(isNum), n: m.flows.length,
               pathFinite: m.path.every(p => isNum(p.cf) && isNum(p.cfPreTax)),
               irr: m.irrPct, why: m.irrWhy };
    })()`);
    if (!r.finite || !r.pathFinite) fail('the Land cash-flow vector contains a non-number — the return panel would blank', r);
    else ok('Land keeps a finite cash-flow vector over ' + r.n + ' periods', r);
  }

  /* 15 — no phantom rent offsetting the carrying cost. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel({ ...window.__T.base, propertyType: 'Land' });
      return { subsidy: m.annualOwnerSubsidy, debt: m.annualDebtService,
               opex: m.opex, maint: m.maintenanceY, sinking: m.sinkingY };
    })()`);
    if (!(r.subsidy >= r.debt)) fail('Land shows an owner subsidy below its debt service — phantom rent is offsetting it', r);
    else if (r.maint !== 0 || r.sinking !== 0) fail('Land is charged a strata service charge or sinking fund', r);
    else ok('Land carries its whole debt service and outgoings — RM' + Math.round(r.subsidy) + ' a year', r);
  }

  /* 16 — the residential answer does not move. */
  {
    const r = await evaluate(`(() => {
      const a = dealModel(window.__T.base);
      const b = dealModel({ ...window.__T.base, propertyClassOverride: 'residential' });
      return { a: a.irrPct, b: b.irrPct, cls: a.propertyClass, src: a.propertyClassSrc };
    })()`);
    if (r.cls !== 'residential') fail('the default deal no longer resolves as residential', r);
    else if (Math.abs(r.a - r.b) > 1e-12) fail('an explicit residential override changes the residential answer', r);
    else ok('the default residential deal is untouched — ' + r.a.toFixed(4) + '%, class from ' + r.src, r);
  }

  /* ---------------------------------------------------------------------
     17–23: the property corrections of 11e758d, each a definition. The
     default deal is self-managed with no agent, so the very drift 17 exists
     to catch evaluates to nought on it; a managed deal is used instead. */

  /* 17 — the stress table's "as entered" row IS the model's monthly position.
         Two implementations of one quantity once disagreed whenever an
         agent was involved. */
  {
    const r = await evaluate(`(() => {
      const managed = { ...window.__T.base, selfManaged: false, mgmtPct: 8, mgmtMinMonthly: 200, leasingFeeMonths: 1 };
      const m = dealModel(managed);
      return { cash: m.cashflowMonthly, rate0: m.stress.rate[0].monthly, vac0: m.stress.vacancy[0].monthly };
    })()`);
    if (Math.abs(r.rate0 - r.cash) > 1e-9 || Math.abs(r.vac0 - r.cash) > 1e-9) fail('on a managed deal the stress rows disagree with cashflowMonthly', r);
    else ok('on a managed deal the stress rows start from the model\'s own monthly position', r);
  }

  /* 18 — the exit table's rental cash IS the sum of the year-by-year path,
         on the same side of tax. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel(window.__T.taxed);
      const out = [];
      for (const e of m.exits) {
        const yrs = Math.min(e.yrs, m.path.length);
        if (yrs < e.yrs) { out.push({ yrs: e.yrs, skipped: 'hold shorter than exit' }); continue; }
        const cf = m.path.slice(0, yrs).reduce((t, p) => t + p.cf, 0);
        const pre = m.path.slice(0, yrs).reduce((t, p) => t + p.cfPreTax, 0);
        out.push({ yrs: e.yrs, cum: e.cumCash, cf, cumPre: e.cumCashPreTax, pre, taxed: m.taxComputed });
      }
      return out;
    })()`);
    for (const x of r) {
      if (x.skipped) { ok(`exit at year ${x.yrs} not compared — ${x.skipped}`, x); continue; }
      if (Math.abs(x.cum - x.cf) > 1e-6 || Math.abs(x.cumPre - x.pre) > 1e-6) fail(`exit at year ${x.yrs} does not sum the path`, x);
      else if (x.taxed && Math.abs(x.cum - x.cumPre) < 1e-6) fail(`exit at year ${x.yrs} shows no difference between pre- and after-tax rental cash on a taxed deal`, x);
      else ok(`exit at year ${x.yrs} sums the path — after tax ${x.cum.toFixed(2)}, before ${x.cumPre.toFixed(2)}`, x);
    }
  }

  /* 19 — a quoted MRTA premium takes the ledger line and is not "unconfirmed". */
  {
    const r = await evaluate(`(() => {
      const a = dealModel(window.__T.base);
      const b = dealModel({ ...window.__T.base, mrtaPremium: 4200 });
      const line = (m) => m.costGroups.find(g => g.id === 'financing').items.find(it => /Mortgage/i.test(it[0]));
      const la = line(a), lb = line(b);
      return { before: { label: la[0], amount: la[1], status: la[2]?.status, unconfirmed: a.unconfirmedCost },
               after: { label: lb[0], amount: lb[1], status: lb[2]?.status, unconfirmed: b.unconfirmedCost } };
    })()`);
    if (r.after.amount !== 4200 || r.after.status !== 'quote') fail('the MRTA quote did not take the ledger line', r);
    else if (!(r.after.unconfirmed < r.before.unconfirmed)) fail('a quoted premium still counts as unconfirmed cost', r);
    else ok('a quoted MRTA premium takes the ledger line, marked as a quote, and leaves the unconfirmed total', r);
  }

  /* 20 — every class the land-risk consequences and blockers name exists in
         the attribute registry that records it. 'refused' did not. */
  {
    const r = await evaluate(`(() => {
      const bad = [];
      for (const [attrId, byClass] of Object.entries(RISK_CONSEQUENCE)) {
        const attr = ATTR_BY_ID[attrId];
        for (const cls of Object.keys(byClass)) if (!attr || !attrClass(attr, cls)) bad.push(attrId + ':' + cls);
      }
      const declinedIsBlocker = AREA_INSURANCE.some(x => x.id === 'declined');
      return { bad, declinedIsBlocker };
    })()`);
    if (r.bad.length || !r.declinedIsBlocker) fail('a land-risk consequence names a class its registry does not record', r);
    else ok('every land-risk consequence class exists in its registry, declined included', r);
  }

  /* 21 — the capital gate passes at six months of reserve and not below. */
  {
    const r = await evaluate(`(() => {
      const answer = (deal) => {
        const m = dealModel(deal), g = propertyGrade(deal, m);
        const A = propertyIpsAnswers(deal, m, g);
        return A.find(a => a.id === 'capital')?.verdict?.id || null;
      };
      return { six: answer({ ...window.__T.base, reserveMonths: 6 }), three: answer({ ...window.__T.base, reserveMonths: 3 }) };
    })()`);
    if (r.six !== 'pass') fail('six months of reserve does not pass the capital gate', r);
    else if (r.three === 'pass') fail('three months of reserve passes a six-month gate', r);
    else ok('the capital gate passes at six months of reserve and reads partial at three', r);
  }

  /* 22 — every class id the worked example seeds exists in its registry. */
  {
    const r = await evaluate(`(() => {
      const bad = [];
      for (const a of SAMPLE_AREAS) for (const [k, v] of Object.entries(a.attrs)) {
        if (v.class == null) continue;
        const attr = ATTR_BY_ID[k];
        if (!attr || !attrClass(attr, v.class)) bad.push(a.area + ' ' + k + ':' + v.class);
      }
      return bad;
    })()`);
    if (r.length) fail('the worked example seeds a class id its registry does not know', r);
    else ok('every class the worked example seeds resolves in its registry');
  }

  /* 23 — NAPIC categories map into the three classes, and the source says so. */
  {
    const r = await evaluate(`(() => ({
      industrial: propertyClassOf({ category: 'industrial' }), agricultural: propertyClassOf({ category: 'agricultural' }),
      development: propertyClassOf({ category: 'development' }), src: propertyClassSource({ category: 'development' }),
      typeWins: propertyClassOf({ propertyType: 'Condominium', category: 'development' }),
    }))()`);
    if (r.industrial !== 'commercial' || r.agricultural !== 'land' || r.development !== 'land' || r.src !== 'category' || r.typeWins !== 'residential')
      fail('NAPIC categories do not map into the classes as documented', r);
    else ok('NAPIC categories map into the classes, the type wins where present, and the source is named', r);
  }

  /* ---------------------------------------------------------------------
     24–28: the property additions of the platform plan (§12.3). */

  /* 24 — selling in the final year of the hold IS the model's own case. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel(window.__T.base);
      const last = m.holdVsSell[m.holdVsSell.length - 1];
      return { n: m.holdVsSell.length, hold: window.__T.base.holdYears, lastYear: last.yrs, lastIrr: last.irrPct, irr: m.irrPct, lastNet: last.net, net: m.netExitProceeds };
    })()`);
    if (r.n !== r.hold || r.lastYear !== r.hold) fail('hold-versus-sell does not cover every year of the hold', r);
    else if (Math.abs(r.lastIrr - r.irr) > 1e-9 || Math.abs(r.lastNet - r.net) > 1e-6) fail('a sale in the final year does not reproduce the model\'s own return and proceeds', r);
    else ok(`a sale in year ${r.hold} reproduces the model's own rate of return — ${r.irr.toFixed(4)}%`, r);
  }

  /* 25 — the five- and ten-year exits are the same arithmetic as the year table. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel(window.__T.base);
      return m.exits.map(e => ({ yrs: e.yrs, exitIrr: e.irrPct, tableIrr: m.holdVsSell[e.yrs - 1]?.irrPct ?? null, inHold: e.yrs <= window.__T.base.holdYears }));
    })()`);
    const bad = r.filter(x => x.inHold && (!isFinite(x.exitIrr) || Math.abs(x.exitIrr - x.tableIrr) > 1e-9));
    if (bad.length) fail('an exit row disagrees with the same year in the hold-versus-sell table', bad);
    else ok('the exit rows and the year table agree on the rate of return for every shared year', r);
  }

  /* 26 — with nothing attributed to the renovation, the return with it is the
         model's return, and the return without it is the model run with no
         renovation; with a share attributed, the rent uplift is exactly that
         share of the effective rent. */
  {
    const r = await evaluate(`(() => {
      const d = window.__T.base, m = dealModel(d);
      const rr = renovationReturn(d, m);
      const bare = dealModel({ ...d, renovation: 0 });
      const d2 = { ...d, renoRentUpliftPct: 20, renoValueRecoveryPct: 50 }, m2 = dealModel(d2);
      const rr2 = renovationReturn(d2, m2);
      return { applicable: rr.applicable, irrWith: rr.irrWith, irr: m.irrPct, irrWithout: rr.irrWithout, bare: bare.irrPct,
               recovered0: rr.valueRecovered, payback0: rr.paybackYears,
               uplift: rr2.rentUpliftAnnual, expected: m2.effectiveRent * 0.2, recovered50: rr2.valueRecovered, reno: d.renovation };
    })()`);
    if (!r.applicable) fail('the default deal budgets a renovation and the return card says it does not', r);
    else if (Math.abs(r.irrWith - r.irr) > 1e-12 || Math.abs(r.irrWithout - r.bare) > 1e-12) fail('the renovation return does not reduce to the model with and without the spend', r);
    else if (r.recovered0 !== 0 || r.payback0 !== null) fail('nothing attributed to the renovation still shows a recovery or a payback', r);
    else if (Math.abs(r.uplift - r.expected) > 1e-6 || Math.abs(r.recovered50 - r.reno * 0.5) > 1e-9) fail('an attributed share is not the share of the effective rent, or the recovery is not the share of the spend', r);
    else ok('the renovation return reduces to the model with and without the spend, and an attributed share is exactly that share', r);
  }

  /* 27 — the exit value is the appreciating price plus the recovered spend. */
  {
    const r = await evaluate(`(() => {
      const d = window.__T.base;
      const a = dealModel({ ...d, renoValueRecoveryPct: 0 }), b = dealModel({ ...d, renoValueRecoveryPct: 100 });
      return { a: a.exitValue, b: b.exitValue, diff: b.exitValue - a.exitValue, reno: d.renovation, expected: d.price * Math.pow(1 + d.apprecPct / 100, d.holdYears) };
    })()`);
    if (Math.abs(r.a - r.expected) > 1e-6) fail('with nothing recovered, the exit value is not the appreciating price', r);
    else if (Math.abs(r.diff - r.reno) > 1e-6) fail('full recovery does not add exactly the renovation spend to the exit value', r);
    else ok('the exit value is the appreciating price plus the share of the renovation recovered', r);
  }

  /* 28 — the address round-trips the deal: what differs from the default, its
         evidence and what was entered, and nothing the default does not know. */
  {
    const r = await evaluate(`(() => {
      const d2 = { ...window.__T.base, price: 610000, rent: 2100, selfManaged: false, marginalTaxPct: 24, disposerCategory: 'company',
                   evidence: { ...window.__T.base.evidence, rent: 'verified' }, touched: { price: true, rent: true } };
      const s = dealToParam(d2);
      const back = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {} };
      const changed = applyDealParam(back, s);
      const junk = { ...back }; const junkChanged = applyDealParam(junk, 'notAKey:1~price:abc~evidence.rent:nonsense~disposerCategory:<script>');
      return { s, changed, len: s.length,
               price: back.price, rent: back.rent, self: back.selfManaged, tax: back.marginalTaxPct, cat: back.disposerCategory,
               ev: back.evidence.rent, touched: back.touched, junkChanged, junkPrice: junk.price, junkEv: junk.evidence.rent, junkCat: junk.disposerCategory };
    })()`);
    const okRound = r.changed && r.price === 610000 && r.rent === 2100 && r.self === false && r.tax === 24 && r.cat === 'company' && r.ev === 'verified' && r.touched.price && r.touched.rent;
    if (!okRound) fail('the address does not round-trip the deal', r);
    else if (r.junkChanged || r.junkPrice !== 610000 || r.junkEv !== 'verified' || r.junkCat !== 'company') fail('the address parser accepted a key, a type or a value the default deal does not know', r);
    else ok(`the address round-trips the deal in ${r.len} characters and refuses what it does not know`, r);
  }

  /* 29 — a loan whose instalment cannot be computed is not an unlevered deal:
         no monthly position, no cover, no rate of return — never the figures
         of a loan that is never serviced and never repaid. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel({ ...window.__T.base, tenureYears: 0 });
      const cash = dealModel({ ...window.__T.base, downPct: 100 });
      return { loan: m.loan, inst: m.instalment, cf: m.cashflowMonthly, irr: m.irrPct, dscr: m.dscr,
               hs: (m.holdVsSell || []).filter(e => e.irrPct != null).length, cashLoan: cash.loan, cashCf: cash.cashflowMonthly, cashIrr: cash.irrPct };
    })()`);
    if (!(r.loan > 0) || r.inst !== null || r.cf !== null || r.irr !== null || r.hs !== 0) fail('a loan with no computable instalment still reports a monthly position or a rate of return', r);
    else if (!(Number.isFinite(r.cashCf))) fail('an all-cash purchase lost its monthly position — no loan is not an unknown loan', r);
    else ok('a loan with no computable instalment reports no monthly position and no rate of return; an all-cash purchase keeps both', r);
  }

  /* 30 — the address parser never throws and takes numbers as written. */
  {
    const r = await evaluate(`(() => {
      const d = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {} };
      let threw = null;
      try { applyDealParam(d, 'price:%zz~rent:%E0%A4%A~foo:%'); } catch (e) { threw = e.message; }
      const e = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {} };
      applyDealParam(e, 'price:~holdYears:0x10~rent: 12 ~downPct:1e1~evidence.constructor:user~evidence.rent:user~reserveMonths:6');
      return { threw, price: d.price, rent: d.rent, e: { price: e.price, hold: e.holdYears, rent: e.rent, down: e.downPct, ctor: Object.prototype.hasOwnProperty.call(e.evidence, 'constructor'), evRent: e.evidence.rent, reserve: e.reserveMonths } };
    })()`);
    const def = r.e;
    if (r.threw) fail('a malformed escape in the address throws out of the render', r);
    else if (def.price !== 572000 || def.hold !== 10 || def.rent !== 1850 || def.down !== 10) fail('the address parser accepted a number that is not digits as written', r);
    else if (def.ctor || def.evRent !== 'user') fail('the address parser accepted an evidence grade for a field the deal does not have', r);
    else if (def.reserve !== 6) fail('the reserve months do not travel in the address', r);
    else ok('the address parser skips malformed escapes, takes numbers only as written, grades only the deal\'s own fields, and carries the reserve', r);
  }

  /* 31 — a link to a deal is that deal: opened over a browser that holds its
         own, it replaces it whole and keeps the old one to restore; opened
         over itself, it changes nothing. */
  {
    const r = await evaluate(`(async () => {
      const own = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: { flood: 'no' }, touched: {}, renovation: 80000, rent: 3000 };
      own.evidence.rent = 'verified';
      State.deal = own; store.write('deal', own);
      const sender = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {}, price: 600000, rent: 1850 };
      const link = '/property/calculator?city=kuching&d=' + encodeURIComponent(dealToParam(sender));
      navigate(link); await new Promise(res => setTimeout(res, 300));
      const got = { price: State.deal.price, rent: State.deal.rent, reno: State.deal.renovation, ev: State.deal.evidence.rent, checks: Object.keys(State.deal.checks || {}).length };
      const kept = store.read('dealBeforeLink', null);
      const restored = restoreDealBeforeLink();
      const after = { reno: State.deal.renovation, rent: State.deal.rent };
      /* Our own address again, after a reload: nothing replaced. */
      const self = '/property/calculator?' + new URLSearchParams(location.search).toString();
      store.write('dealBeforeLink', null);
      navigate('/property/opportunities'); await new Promise(res => setTimeout(res, 150));
      navigate(self); await new Promise(res => setTimeout(res, 300));
      const selfKept = store.read('dealBeforeLink', null);
      return { got, keptReno: kept?.renovation, restored, after, selfKept: !!selfKept, selfReno: State.deal.renovation };
    })()`);
    if (r.got.price !== 600000 || r.got.reno !== 25000 || r.got.rent !== 1850 || r.got.ev === 'verified' || r.got.checks !== 0) fail('a shared link is still laid over the recipient\'s own deal', r);
    else if (r.keptReno !== 80000 || !r.restored || r.after.reno !== 80000) fail('the recipient\'s own deal is not kept and restorable', r);
    else if (r.selfKept || r.selfReno !== 80000) fail('reopening one\'s own address replaced the deal', r);
    else ok('a shared link shows the sender\'s deal whole, keeps the recipient\'s to restore, and one\'s own address changes nothing', r);
  }

  /* 32 — an edit on /property survives the next render (the address used to
         read the stale deal back over it). */
  {
    const r = await evaluate(`(async () => {
      navigate('/property'); await new Promise(res => setTimeout(res, 300));
      State.deal.rent = 2345; saveDeal(); render(); await new Promise(res => setTimeout(res, 100));
      render(); await new Promise(res => setTimeout(res, 100));
      return { rent: State.deal.rent, stored: store.read('deal', {}).rent, inAddress: /rent%3A2345|rent:2345/.test(location.search) };
    })()`);
    if (r.rent !== 2345 || r.stored !== 2345 || !r.inAddress) fail('an edit on /property is reverted by the address on the next render', r);
    else ok('an edit on /property survives the next render and is written to the address', r);
  }

  /* 33 — a register record is modelled on what it records: its own checklist,
         and without a price the calculator's price stands in rather than 0. */
  {
    const r = await evaluate(`(() => {
      State.deal = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: { flood: 'no', title: 'yes' }, touched: {} };
      const unpriced = candidateModel({ name: 'x', deal: { price: 0, rent: 1500 } });
      const priced = candidateModel({ name: 'y', deal: { price: 450000, rent: 1500 } });
      return { upPrice: unpriced.d.price, upCash: unpriced.m.safeCashRequired, upChecks: Object.keys(unpriced.d.checks).length, pPrice: priced.d.price, pChecks: Object.keys(priced.d.checks).length };
    })()`);
    if (r.upPrice !== 572000 || !(r.upCash > 0)) fail('an unpriced record is modelled off a price of 0', r);
    else if (r.upChecks !== 0 || r.pChecks !== 0) fail('the calculator\'s checklist answers leak into register records', r);
    else ok('a register record is modelled on its own checklist, and an unpriced one on the calculator\'s price rather than 0', r);
  }

  /* ---------------------------------------------------------------------
     35–50: the property stream's audit findings. */
  const FRESH = `({ ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {} })`;

  /* 35 — no repayment schedule is not an unlevered deal anywhere: no break-even
         rent, no exit proceeds, no profit, and not "structurally negative". */
  {
    const r = await evaluate(`(() => {
      const m = dealModel({ ...${FRESH}, tenureYears: 0 });
      return { be: m.breakEvenRent, beOcc: m.breakEvenOccupancy, net: m.netExitProceeds, profit: m.totalProfit,
               exitNet: m.exits.map(e => e.net), stress: m.stress.rate.map(x => x.monthly), negBest: m.negativeAtBest,
               why: m.breakEvenRateWhy };
    })()`);
    const leaked = [r.be, r.beOcc, r.net, r.profit, ...r.exitNet, ...r.stress].filter(v => v !== null);
    if (leaked.length || r.negBest || r.why !== 'unknown') fail('with no computable instalment, an unlevered figure is still reported', r);
    else ok('with no computable instalment, break-even, exit proceeds, profit and every stressed month are unknown, not unlevered', r);
  }

  /* 36 — the loan ends with its tenure: a hold longer than the loan pays no
         instalment and books no interest after the last one. */
  {
    const r = await evaluate(`(() => {
      const m = dealModel({ ...${FRESH}, tenureYears: 5, holdYears: 10 });
      return { after: m.path.slice(5).map(p => [p.y, p.debt, p.interest, p.balance]), y1: m.path[0].debt, carry: m.carryWhileSelling, opexCarry: m.opex / 12 * 6 };
    })()`);
    const bad = r.after.filter(([, debt, int]) => debt !== 0 || int !== 0);
    if (bad.length || !(r.y1 > 0)) fail('a repaid loan is still charged, or booked as interest, after its tenure', r);
    else if (Math.abs(r.carry - r.opexCarry) > 1e-6) fail('the carry while selling still includes an instalment after the loan is repaid', r);
    else ok('after a five-year loan is repaid, years 6–10 pay no instalment and book no interest', r);
  }

  /* 37 — one holding period everywhere: a fractional or over-long hold is
         normalised, and the year table always ends at the model's own case. */
  {
    const r = await evaluate(`(() => [7.5, 35, 40, 0].map(h => {
      const m = dealModel({ ...${FRESH}, holdYears: h });
      const back = ${FRESH}; applyDealParam(back, 'holdYears:' + h);
      return { h, path: m.path.length, hs: m.holdVsSell.length, lastIrr: m.holdVsSell.at(-1).irrPct, irr: m.irrPct, fromLink: back.holdYears };
    }))()`);
    const bad = r.filter(x => x.path !== x.hs || !Number.isInteger(x.fromLink) || x.fromLink > 30 || x.fromLink < 1
      || (x.irr != null && Math.abs(x.lastIrr - x.irr) > 1e-9));
    if (bad.length) fail('a hold the table cannot reproduce reaches the model or the address', bad);
    else ok('a fractional or over-long hold is normalised, and the final exit row is always the model\'s own rate', r);
  }

  /* 38 — two rates are named, not reported as none; the exits card never says
         "the capital does not come back" beside a profit. */
  {
    const r = await evaluate(`(() => {
      const two = irrOf([-100, 230, -132]);
      const m = dealModel({ ...${FRESH}, rent: 6000, apprecPct: -5 });
      return { rate: two.rate, rates: two.rates, why: two.why, one: irrOf([-100, 110]).rate,
               e10: { irr: m.exits[1].irrPct, why: m.exits[1].irrWhy, profit: m.exits[1].profit } };
    })()`);
    const roots = (r.rates || []).map(x => Math.round(x));
    if (r.rate !== null || roots.join() !== '10,20') fail('flows with two rates of return are not reported as two rates', r);
    else if (Math.abs(r.one - 10) > 1e-6) fail('a single rate is no longer found', r);
    else if (!/more than one rate/.test(r.e10.why || '')) fail('the exit card gives a false reason for a missing rate', r);
    else ok('flows with two rates name both and choose neither; the exit reason is the model\'s own', r);
  }

  /* 39 — the cash waterfall's parts are the total. */
  {
    const r = await evaluate(`(async () => {
      State.deal = ${FRESH}; saveDeal(); navigate('/property/calculator'); await new Promise(res => setTimeout(res, 300));
      const det = [...document.querySelectorAll('details')].find(x => /of safe cash goes/.test(x.querySelector('summary')?.textContent || ''));
      const rows = det ? det.querySelectorAll('div > div.row').length : -1;
      const m = dealModel(State.deal);
      const parts = m.costGroups.map(g => g.items.reduce((a, it) => a + (isNum(it[1]) ? it[1] : 0), 0)).filter(v => v > 0);
      return { rows, groups: parts.length, sum: parts.reduce((a, b) => a + b, 0), safe: m.safeCashRequired };
    })()`);
    if (r.rows !== r.groups || Math.abs(r.sum - r.safe) > 0.01) fail('the safe-cash waterfall lists a part twice or does not sum to its heading', r);
    else ok(`the safe-cash waterfall has ${r.rows} parts summing to its heading`, r);
  }

  /* 40 — the checklist is read by what it says: adverse answers lower the
         demand pillar, "Not sure" credits nothing, and only an adverse answer
         is raised as a risk. */
  {
    const r = await evaluate(`(() => {
      const all = v => ({ ...${FRESH}, checks: Object.fromEntries(SARAWAK_CHECKS.map(c => [c.id, v])) });
      const dem = v => { const d = all(v); return propertyGrade(d, dealModel(d)).scores.demand; };
      const liq = a => { const d = { ...${FRESH}, checks: { 'resale-time': a } }; return propertyFinanceability(d, dealModel(d)).scores.liquidity; };
      const flags = d => propertyRiskFlags(d, dealModel(d)).map(f => f.t);
      return { yes: dem('yes'), no: dem('no'), unsure: dem('unknown'), liqYes: liq('yes'), liqNo: liq('no'), liqUnsure: liq('unknown'),
               strataYesFlag: flags({ ...${FRESH}, checks: { 'strata-issued': 'yes' } }).some(t => /strata/i.test(t)),
               strataNoFlag: flags({ ...${FRESH}, checks: { 'strata-issued': 'no' } }).some(t => /strata/i.test(t)),
               floodYesFlag: flags({ ...${FRESH}, checks: { flood: 'yes' } }).some(t => /flood/i.test(t)) };
    })()`);
    if (r.yes === r.no || r.unsure !== 0) fail('the demand pillar still counts answers rather than reading them', r);
    else if (!(r.liqYes > r.liqNo) || r.liqNo !== r.liqUnsure) fail('any answer to the resale question still credits liquidity', r);
    else if (r.strataYesFlag || !r.strataNoFlag || !r.floodYesFlag) fail('a risk flag is raised on the favourable answer, or missed on the adverse one', r);
    else ok(`the checklist is read by its answers — demand ${r.yes} all-yes, ${r.no} all-no, ${r.unsure} not sure`, r);
  }

  /* 41 — a loan-readiness total is withheld while credit or affordability is open. */
  {
    const r = await evaluate(`(() => {
      const lr = loanReadiness({ assessed: true, verifiedNetMonthlyIncome: 9000, existingMonthlyDebtPayments: 800 }, dealModel(${FRESH}));
      return { score: lr.score, raw: lr.rawScore, band: lr.band };
    })()`);
    if (r.band !== 'Not assessed' || r.score !== null || !(r.raw > 0)) fail('a loan-readiness total is shown beside "Not assessed"', r);
    else ok('no loan-readiness total is shown while a critical item is open', r);
  }

  /* 42 — the checklist travels in the address, and only its own answers. */
  {
    const r = await evaluate(`(() => {
      const d = { ...${FRESH}, checks: { flood: 'yes', comparables: 'no' }, checkEvidence: { flood: 'verified' } };
      const s = dealToParam(d);
      const back = ${FRESH};
      applyDealParam(back, s + '~check.bogus:yes~check.parking:maybe~checkev.flood2:verified~price:null');
      return { s, checks: back.checks, ev: back.checkEvidence, price: back.price };
    })()`);
    if (r.checks.flood !== 'yes' || r.checks.comparables !== 'no' || r.ev?.flood !== 'verified') fail('the checklist does not travel in the address', r);
    else if (Object.keys(r.checks).length !== 2 || Object.keys(r.ev).length !== 1 || r.price !== 572000) fail('the address accepted a question, an answer or a null the deal does not have', r);
    else ok('the checklist and its evidence travel in the address; unknown questions and a null price do not', r);
  }

  /* 43 — a bare parcel is not tested on a rent it does not have. */
  {
    const r = await evaluate(`(() => {
      const d = { ...${FRESH}, propertyType: 'Land', propertyClassOverride: 'land' };
      const m = dealModel(d);
      return { rvb: rentVersusBuy(d, m, 4).ok, drivers: propertySensitivity(d).drivers.map(x => x.k),
               queue: propertyReviewQueue(d).map(f => f.k) };
    })()`);
    const rentish = ['rent', 'vacancyPct', 'maintenance'];
    if (r.rvb || r.drivers.some(k => rentish.includes(k)) || r.queue.some(k => rentish.includes(k))) fail('a parcel is still tested on rent, vacancy or a service charge', r);
    else ok('a parcel\'s rent-versus-buy, drivers and review queue leave out rent, vacancy and maintenance', r);
  }

  /* 44 — the equity card compares the reader's own return on the capital the
         rate is measured on, and ranks no security. */
  {
    const r = await evaluate(`(async () => {
      State.deal = ${FRESH}; saveDeal();
      State.propertyReportsBought = [...State.propertyReportsBought, State.deal.projectId];
      navigate('/property/calculator'); await new Promise(res => setTimeout(res, 300));
      const m = dealModel(State.deal);
      const card = [...document.querySelectorAll('.card')].find(c => /The same cash in equities/.test(c.textContent));
      return { committed: m.equity.map(q => q.committed), equityOut: m.equityOut,
               bursa: /Bursa alternative|Quality|model estimate/.test(card?.textContent || ''), found: !!card,
               showsOut: (card?.textContent || '').includes(fmtAmount(m.equityOut, 'MYR')) };
    })()`);
    if (!r.found) fail('the equity comparison card did not render on an unlocked report', r);
    else if (r.bursa) fail('the equity card still lists ranked securities', r);
    else if (r.committed.some(c => c !== r.equityOut) || !r.showsOut) fail('the equity comparison is not on the capital the rate of return is measured on', r);
    else ok('the equity card compares the reader\'s own return on the committed capital, and names no security', r);
  }

  /* 45 — included property reports are counted, not unlimited. */
  {
    const r = await evaluate(`(() => {
      const plan = State.plan; State.plan = 'all';
      State.propertyReportLog = { month: new Date().toISOString().slice(0, 7), ids: [] };
      const a = usePropertyReport('x1'), b = usePropertyReport('x2'), c = usePropertyReport('x3'), again = usePropertyReport('x1');
      const unlocked3 = propertyReportUnlocked('x3');
      State.plan = plan;
      return { a, b, c, again, unlocked3 };
    })()`);
    if (!r.a || !r.b || r.c || !r.again || r.unlocked3) fail('an allowance of two property reports a month is not metered', r);
    else ok('two included reports a month are counted, and reopening one costs nothing', r);
  }

  /* 46 — the worked example never replaces a wheel contract the reader entered. */
  {
    const r = await evaluate(`(() => {
      const before = { ...State.wheel };
      if (hasWorkedExample()) clearWorkedExample();
      State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, putStrike: 42, contracts: 3, putCredit: 0.9, isWorkedExample: false };
      seedWorkedExample(); const seeded = { strike: State.wheel.putStrike, c: State.wheel.contracts };
      clearWorkedExample(); const cleared = { strike: State.wheel.putStrike, c: State.wheel.contracts };
      State.wheel = before;
      return { seeded, cleared };
    })()`);
    if (r.seeded.strike !== 42 || r.cleared.strike !== 42 || r.cleared.c !== 3) fail('loading or removing the worked example changed the reader\'s wheel contract', r);
    else ok('the worked example leaves the reader\'s wheel contract as it was', r);
  }

  /* 47 — every wheel state has a way on: no dead end after an expiry, a
         buy-back or a call-away, and Paused and Complete are reachable. */
  {
    const r = await evaluate(`(async () => {
      const before = { ...State.wheel }, legs = [...(State.wheelLegs || [])];
      navigate('/us-options/wheel'); await new Promise(res => setTimeout(res, 200));
      const out = {};
      for (const st of ['put_planned', 'put_expired', 'put_closed', 'call_expired', 'call_closed', 'called_away', 'shares_held', 'paused', 'complete']) {
        State.wheel = { ...before, ...WHEEL_WORKED_EXAMPLE, state: st }; State.wheelLegs = [];
        render(); await new Promise(res => setTimeout(res, 50));
        const labels = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
        const want = (WHEEL_TRANSITIONS[st] || []).filter(t => !['put_open', 'call_open'].includes(t));
        out[st] = { want: want.length, offered: labels.filter(l => /candidate|Shares held|complete|Pause|Resume|Cancel the planned|Start a cycle|Plan a covered call|Begin again/.test(l)).length };
      }
      State.wheel = before; State.wheelLegs = legs; render();
      return out;
    })()`);
    const dead = Object.entries(r).filter(([, v]) => v.want > 0 && v.offered < v.want);
    if (dead.length) fail('a wheel state offers fewer transitions than it permits', dead);
    else ok('every wheel state offers each transition it permits', r);
  }

  /* 48 — the exit gate counts only sourced, real transactions; the return-engine
         gate does not pass on a seeded renovation budget. */
  {
    const r = await evaluate(`(() => {
      const keep = State.observations;
      const d = { ...${FRESH} };
      const mk = (extra) => ({ city: d.city, area: d.district, kind: 'sold-price', value: 500000, date: '2026-01-01', evidence: 'user', sourceRef: 'deed 1', ...extra });
      State.observations = [mk({ sample: true }), mk({ sample: true }), mk({ sourceRef: '' }), mk({})];
      const m = dealModel(d), g = propertyGrade(d, m);
      const exit = propertyIpsAnswers(d, m, g).find(a => a.id === 'exit').verdict.id;
      State.observations = keep;
      const r0 = { ...d, rent: 0 }, m0 = dealModel(r0);
      const engine = propertyIpsAnswers(r0, m0, propertyGrade(r0, m0)).find(a => a.id === 'engine').verdict.id;
      const r1 = { ...r0, touched: { renovation: true }, renoValueRecoveryPct: 50 }, m1 = dealModel(r1);
      const engineRecorded = propertyIpsAnswers(r1, m1, propertyGrade(r1, m1)).find(a => a.id === 'engine').verdict.id;
      return { exit, engine, engineRecorded };
    })()`);
    if (r.exit !== 'partial') fail('the exit gate counts worked-example or unsourced rows as transactions', r);
    else if (r.engine !== 'fail' || r.engineRecorded !== 'pass') fail('the return-engine gate reads a seeded renovation budget as value-add', r);
    else ok('the exit gate counts one sourced sale of four rows, and a seeded renovation is not a return engine', r);
  }

  /* 49 — NAPIC ranges say whether they matched the locality, and how many
         were cut; Kota Samarahan reads its own division. */
  {
    const r = await evaluate(`(async () => {
      for (let i = 0; i < 40 && !napicStatus.ok; i++) { if (!napicStatus.tried) loadNapic(); await new Promise(res => setTimeout(res, 100)); }
      if (!napicStatus.ok) return { skip: true };
      const bau = napicBenchmarks('Kuching', { locality: 'Bau town' }), tab = napicBenchmarks('Kuching', { locality: 'Tabuan' });
      const panel = officialBenchmarkPanel('bau', 'Bau town').textContent;
      return { bau: { matched: bau.matched, total: bau.total, n: bau.rows.length }, tab: { matched: tab.matched, total: tab.total, n: tab.rows.length },
               says: /No NAPIC scheme name contains/.test(panel) && /showing the first 40 of/.test(panel),
               ks: localityDivision('kuching', 'Kota Samarahan'), tb: localityDivision('kuching', 'Tabuan') };
    })()`);
    if (r.skip) fail('the NAPIC dataset did not load');
    else if (r.bau.matched || !r.tab.matched || !(r.tab.total > r.tab.n) || !r.says) fail('the NAPIC panel does not say what it matched or what it cut', r);
    else if (r.ks !== 'Samarahan' || r.tb !== 'Kuching') fail('a locality outside its town\'s division reads the town\'s division', r);
    else ok('NAPIC ranges state a failed locality match and a cut, and Kota Samarahan reads the Samarahan Division', r);
  }

  /* 50 — a comparables file comes back with every field it went out with. */
  {
    const r = await evaluate(`(async () => {
      const keep = State.observations;
      State.observations = [];
      seedWorkedExample();
      const file = JSON.stringify({ format: 'quantum-tradeworks/comparables', version: 2, records: State.observations });
      clearWorkedExample();
      openComparableImport();
      const ta = [...document.querySelectorAll('textarea')].at(-1);
      ta.value = file;
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Check this paste').click();
      await new Promise(res => setTimeout(res, 50));
      [...document.querySelectorAll('button')].find(b => /^Import \\d+ record/.test(b.textContent)).click();
      await new Promise(res => setTimeout(res, 50));
      const back = State.observations;
      const land = back.find(o => o.kind === 'land-sold');
      const vac = back.find(o => o.kind === 'vacancy');
      const out = { n: back.length, samples: back.filter(o => o.sample).length, landSqft: land?.landSqft, landUnit: land?.landUnit, vacSqft: vac?.sqft };
      clearWorkedExample(); State.observations = keep; saveObservations(); closeDrawer();
      return out;
    })()`);
    if (r.samples !== r.n || !(r.landSqft > 0) || r.landUnit !== 'point' || r.vacSqft !== null) fail('a comparables export does not import back as it left', r);
    else ok(`a worked-example export imports back as ${r.n} marked examples, with land areas and absent areas intact`, r);
  }

  /* 34 — the Cash Wheel through a cycle, driven by its own buttons. An assigned
         cycle still holds shares, so it is not closed and the two totals are
         not compared; sold shares leave the share count; Reset and "Clear and
         enter my own" return the cycle to a blank candidate. */
  {
    const r = await evaluate(`(async () => {
      const wait = () => new Promise(res => setTimeout(res, 120));
      const click = async (t) => { const b = [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === t);
        if (!b) throw new Error('no button: ' + t); b.click(); await wait(); };
      const kv = (k) => { const dt = [...document.querySelectorAll('main dl.kv dt')].find(x => x.textContent === k); return dt?.nextElementSibling?.textContent; };
      const alarm = () => [...document.querySelectorAll('main .note')].some(n => /disagree/.test(n.textContent));
      window.confirm = () => true;
      State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, state: 'candidate', phase: 'put', economicShareBasisOverride: null,
        shareCostBasisOverride: null, eligibleShares: 0, isWorkedExample: false };
      State.wheelLegs = []; saveWheel(); saveWheelLegs();
      navigate('/us-options/wheel'); await wait();
      const out = {};
      try {
        await click('Load a worked contract');
        State.wheel.adjustedContract = true; render(); await wait();
        out.adjustedCashGate = [...document.querySelectorAll('main ul.blocklist li')].some(li => /Eligible cash has not been entered/.test(li.textContent));
        State.wheel.adjustedContract = false; saveWheel(); render(); await wait();
        await click('Start a cycle'); await click('Record the put as opened'); await click('It was assigned');
        out.assigned = { cash: kv('Same total from cash movements'), alarm: alarm(), owed: kv('Still open against it'), shares: State.wheel.eligibleShares };
        await click('Plan a covered call');
        State.wheel.callStrike = 55; State.wheel.callCredit = 1; saveWheel(); render(); await wait();
        await click('Record the call as opened'); await click('Shares were called away');
        out.called = { shares: State.wheel.eligibleShares, alarm: alarm(), closed: wheelLedger(State.wheelLegs).cycleClosed };
        await click('Clear the cycle'); await click('Start a cycle'); await click('Record the put as opened'); await click('It was assigned');
        await click('Reset');
        out.reset = { state: State.wheel.state, phase: State.wheel.phase, shares: State.wheel.eligibleShares, basis: State.wheel.economicShareBasisOverride, legs: State.wheelLegs.length };
        await click('Load a worked contract');
        await click('Start a cycle'); await click('Record the put as opened'); await click('It was assigned');
        await click('Clear and enter my own');
        out.own = { state: State.wheel.state, phase: State.wheel.phase, shares: State.wheel.eligibleShares, legs: State.wheelLegs.length };
      } catch (e) { out.error = e.message; }
      return out;
    })()`);
    /* A step that cannot be taken is itself a failure: before the fix, Reset
       left the rail at Assigned, so there was no "Start a cycle" to press. */
    if (r.error) fail(`the Cash Wheel cycle could not be driven through — ${r.error}`, r);
    else if (r.adjustedCashGate) fail('an adjusted contract reports eligible cash as not entered', r);
    else if (r.assigned.alarm || !/shares still held/.test(r.assigned.cash || '')) fail('an assigned cycle is treated as closed and its totals compared', r.assigned);
    else if (!/^none/.test(r.assigned.owed || '')) fail('the premium card still shows the assigned put as an open obligation', r.assigned);
    else if (r.called.shares !== 0 || !r.called.closed || r.called.alarm) fail('called-away shares stay in the unencumbered count, or the closed cycle does not reconcile', r.called);
    else if (r.reset.state !== 'candidate' || r.reset.phase !== 'put' || r.reset.shares !== 0 || r.reset.basis !== null || r.reset.legs !== 0) fail('Reset leaves the cycle state behind', r.reset);
    else if (r.own.state !== 'candidate' || r.own.phase !== 'put' || r.own.shares !== 0 || r.own.legs !== 0) fail('"Clear and enter my own" leaves the illustrative cycle behind', r.own);
    else ok('the Cash Wheel holds its cycle: assignment is open, sold shares leave, and both clears return a blank candidate', r);
  }

  /* 35 — the Trading Index engine refuses what it used to accept silently. */
  {
    const r = await evaluate(`(() => {
      const perp = qttiWorkedExample();
      perp.perp = { ...perp.perp, leverage: 2, notional: 1000, collateral: 500, marginMode: 'isolated', liquidationPrice: 1, specVersion: 'v1' };
      const noFunding = qttiRun(perp).perpGates.some(g => /[Ff]unding/.test(g));
      const withFunding = { ...perp, perp: { ...perp.perp, fundingPerUnit: 2 },
        plan: { ...perp.plan, plannedEntry: 100, invalidation: 90, target: 140, fees: 1 } };
      const fr = qttiRun(withFunding).rr;
      const opt = { ...perp, instrumentType: 'option' };
      const optGates = qttiRun(opt).perpGates;
      const frac = qttiRun({ ...perp, plan: { ...perp.plan, plannedTotal: 10000, stage1Fraction: 25 } });
      const minZero = qttiRun({ ...perp, plan: { ...perp.plan, plannedEntry: 100, invalidation: 90, target: 110, fees: 1, minRewardToRisk: 0 } }).gates;
      const floor = qttiWorkedExample(); floor.timeframes.daily.priceStructure = { state: 'analyst', value: 77 };
      const fr2 = qttiRun(floor);
      const share = qttiRun({ ...qttiDefaultPlan(), instrumentType: 'ordinary_share' }).gates[0];
      return { noFunding, fundingCost: fr.costs, optLiquidation: optGates.some(g => /liquidation/.test(g)), optBlocked: optGates.some(g => /does not model/.test(g)),
        stage1: frac.stage1, fracGate: frac.gates.some(g => /Stage 1 fraction is 25/.test(g)),
        minZero: minZero.some(g => /reads 0/.test(g)), minThree: minZero.some(g => /minimum of 3/.test(g)),
        daily: fr2.tfs.daily.score, floorGate: fr2.gates.filter(g => /daily score/.test(g)),
        share, worked: [qttiRun(qttiWorkedExample()).regime, qttiRun(qttiWorkedExample()).tranche, qttiRun(qttiWorkedExample()).confidence] };
    })()`);
    if (r.worked.join('/') !== '38/35/77') fail('the §14 worked example no longer returns 38 / 35 / 77', r.worked);
    else if (!r.noFunding || r.fundingCost !== 3) fail('an unentered funding figure clears the perpetual gate, or entered funding is not a cost', r);
    else if (r.optLiquidation || !r.optBlocked) fail('an option is asked for a liquidation price, or clears on the perpetual checklist', r);
    else if (r.stage1 !== null || !r.fracGate) fail('a Stage 1 fraction above 1 is accepted', r);
    else if (!r.minZero || r.minThree) fail('a minimum reward-to-risk of 0 is silently replaced by 3', r);
    else if (r.floorGate.length) fail('a floor gate contradicts its own printed score', r);
    else if (!/Not yet researched/.test(r.share)) fail('the company thesis gate quotes the internal id', r.share);
    else ok('Trading Index gates: funding required and costed, option terms named, fraction bounded, minimum refused at 0, floors on the printed score', r);
  }

  /* 36 — Trading Index clears drop the previous instrument, and the history
         records corrections only, in one unit. */
  {
    const r = await evaluate(`(async () => {
      const wait = () => new Promise(res => setTimeout(res, 120));
      window.confirm = () => true;
      State.qtti = qttiDefaultPlan(); saveQtti();
      navigate('/research/trading-index'); await wait();
      const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('change', { bubbles: true })); };
      set('select[aria-label="Daily Momentum"]', 'bullish'); await wait();
      const firstEntry = State.qtti.corrections.length;
      set('select[aria-label="Daily Momentum"]', 'strong_bullish'); await wait();
      const change = State.qtti.corrections[State.qtti.corrections.length - 1];
      Object.assign(State.qtti, { symbol: 'AAPL', sourceCompanyId: 'AAPL-SEC', sourceTicker: 'AAPL', instrumentType: 'ordinary_share',
        equityThesisStatus: 'pass', tradingStatusClear: true, venue: 'NASDAQ' });
      State.qtti.plan.plannedTotal = 5000; saveQtti(); render(); await wait();
      [...document.querySelectorAll('main button')].find(b => b.textContent === 'Clear evidence').click(); await wait();
      const cleared = { id: State.qtti.sourceCompanyId, th: State.qtti.equityThesisStatus, ts: State.qtti.tradingStatusClear, venue: State.qtti.venue, total: State.qtti.plan.plannedTotal,
        trail: State.qtti.corrections.some(c => c.newValue === 'cleared') };
      Object.assign(State.qtti, { symbol: 'AAPL', sourceCompanyId: 'AAPL-SEC', sourceTicker: 'AAPL' }); saveQtti(); render(); await wait();
      set('#q-symbol', 'BTC / USDC Perpetual'); await wait();
      return { firstEntry, change, cleared, unlinked: State.qtti.sourceCompanyId };
    })()`);
    if (r.firstEntry !== 0) fail('a first-time entry is logged as a correction', r);
    else if (r.change?.oldValue !== 'Bullish (75)' || r.change?.newValue !== 'Strong bullish (100)') fail('a correction mixes units', r.change);
    else if (r.cleared.id !== null || r.cleared.th !== 'unknown' || r.cleared.ts || r.cleared.venue || r.cleared.total !== 5000 || !r.cleared.trail) fail('Clear evidence keeps the previous instrument, drops the reader\'s rules, or leaves no trail', r.cleared);
    else if (r.unlinked !== null) fail('typing a different symbol keeps the company link', r);
    else ok('Trading Index clears drop the previous instrument and keep the rules; corrections log revisions only, in one unit', r);
  }

  /* 37 — the status register's Sarawak row states the history this browser
         actually holds, not the author's machine's. */
  {
    const r = await evaluate(`(() => {
      const row = CAPABILITY_REGISTER.find(c => c.name === 'Sarawak Economy Watch');
      if (typeof row.gate !== 'function') return { text: row.gate, fn: false };
      const kept = trackedHistory; trackedHistory = null;
      const text = row.gate(); trackedHistory = kept;
      return { text, fn: true };
    })()`);
    if (!r.fn || /with price history/.test(r.text) || !/no price history/.test(r.text)) fail('the Sarawak status row claims price history the browser does not hold', r);
    else ok('the Sarawak status row states the price history actually held', r);
  }

  /* ---- bugfix: studio-trading ---- */
  /* S1 — the Trading Index states a verdict on the number it prints, the risk
          budget divides by the entry actually typed, the §14 fixture keeps
          the correction history, and the decision record never prints
          "null" for an unscored confidence. */
  {
    const saved = await evaluate(`JSON.stringify({ q: State.qtti, w: State.wheel, o: State.opportunities, ds: State.decisionSubject || null })`);
    const r = await evaluate(`(async () => {
      const wait = () => new Promise(res => setTimeout(res, 150));
      window.confirm = () => true;
      const out = {};
      const a = qttiWorkedExample(); a.confidence = { metadata:95, panels:100, indicators:95, legibility:5, recency:10 };
      const ra = qttiRun(a);
      out.conf70 = { shown: ra.confidence, band: ra.confidenceBand.label, gate: ra.gates.find(g => /^Screenshot confidence is/.test(g)) || null };
      const b = qttiWorkedExample(); b.confidence = { metadata:95, panels:100, indicators:75, legibility:5, recency:10 };
      const rb = qttiRun(b);
      out.conf65 = { shown: rb.confidence, reject: rb.reject.find(g => /confidence/.test(g)) || null };
      /* A plan with no gate at all, its readiness walked through 64.5–65. */
      const plan = (x) => { const p = qttiDefaultPlan();
        Object.assign(p, { symbol:'TEST', instrumentType:'etf', capturedAt:'2026-09-01T10:00', identityConsistent:true, tradingStatusClear:true,
          template:'short_trend', triggerComplete:true, entryLocation:'bullish',
          assetThesis:{ mandate:true, issuer:true, liquidity:true, custody:true },
          confidence:{ metadata:80, panels:80, indicators:80, legibility:80, recency:80 } });
        Object.assign(p.plan, { plannedTotal:1000, stage1Fraction:0.25, plannedEntry:100, invalidation:110, target:50, minRewardToRisk:3, costsEntered:true });
        QTTI_TIMEFRAMES.forEach(t => { p.timeframes[t.k].present = true; QTTI_GROUPS.forEach(g => { p.timeframes[t.k][g.k] = { state:'analyst', value:x }; }); });
        return p; };
      out.tranche = null;
      for (let x = 52; x <= 54 && !out.tranche; x += 0.002) {
        const rr = qttiRun(plan(x));
        if (!rr.gates.length && rr.trancheRaw >= 64.5 && rr.trancheRaw < 65) out.tranche = { raw: rr.trancheRaw, tranche: rr.tranche, state: rr.trancheState.id };
      }
      const c = qttiWorkedExample();
      Object.assign(c.plan, { plannedEntry:0.5, invalidation:0.4, target:0.9, plannedTotal:10000, stage1Fraction:0.5 });
      Object.assign(c.perp, { maxAccountLoss:800, leverage:2, notional:10000, collateral:5000, marginMode:'isolated', liquidationPrice:0.2, fundingPerUnit:0, specVersion:'v1' });
      out.budget = qttiRun(c).perpGates.some(g => /risk budget/.test(g));
      State.qtti = qttiDefaultPlan(); saveQtti(); navigate('/research/trading-index'); await wait();
      const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('change', { bubbles: true })); };
      set('select[aria-label="Daily Momentum"]', 'bullish'); await wait();
      set('select[aria-label="Daily Momentum"]', 'strong_bullish'); await wait();
      const before = State.qtti.corrections.length;
      [...document.querySelectorAll('main button')].find(x => /Load the §14 worked example/.test(x.textContent)).click(); await wait();
      out.history = { before, after: State.qtti.corrections.length, last: State.qtti.corrections[State.qtti.corrections.length - 1]?.newValue || null, symbol: State.qtti.symbol };
      const d = qttiWorkedExample(); d.confidence = { metadata:null, panels:null, indicators:null, legibility:null, recency:null };
      State.qtti = d; saveQtti(); State.decisionSubject = 'tradingIndex';
      navigate('/decision-record'); await wait();
      out.record = { assessable: qttiRun(d).assessable, figs: [...document.querySelectorAll('.dr-fig')].map(f => f.innerText.replace(/\\n/g, ': ')) };
      return out;
    })()`);
    const p = [];
    if (r.conf70.shown !== 70 || r.conf70.gate || r.conf70.band !== 'Usable with named limitations') p.push(`confidence printed 70 but judged below 70: ${JSON.stringify(r.conf70)}`);
    if (r.conf65.shown !== 65 || r.conf65.reject) p.push(`confidence printed 65 but rejected below 65: ${JSON.stringify(r.conf65)}`);
    if (!r.tranche) p.push('no gate-free plan with readiness in 64.5–65 was found, so the band rule was not exercised');
    else if (r.tranche.tranche !== 65 || r.tranche.state !== 'met') p.push(`readiness printed ${r.tranche.tranche} reads ${r.tranche.state}, not Criteria met: ${JSON.stringify(r.tranche)}`);
    if (!r.budget) p.push('a loss of 1,000 against a budget of 800 at an entry of 0.5 raised no risk-budget gate');
    if (!(r.history.after === r.history.before + 1 && /worked example/.test(r.history.last || '') && /BTC/.test(r.history.symbol))) p.push(`loading the §14 example did not keep and extend the correction history: ${JSON.stringify(r.history)}`);
    if (!r.record.assessable || r.record.figs.some(f => /null/.test(f)) || !r.record.figs.some(f => /Screenshot confidence: Not computed/.test(f))) p.push(`the decision record prints an unscored confidence as ${JSON.stringify(r.record.figs)}`);
    if (p.length) fail('Trading Index verdicts on the printed score, the risk budget at a sub-1 entry, the fixture keeping history, the record\'s confidence', p);
    else ok('Trading Index: confidence and readiness judged as printed, a sub-1 entry costs its real loss, the §14 fixture appends to the history, and an unscored confidence reads "Not computed" in the record', r);

    /* S2 — a keyboard edit keeps focus where the key left it. Every control
            on these pages redrew the whole view and left focus on <body>. */
    const press = async (key, code, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code }, sessionId);
      await sleep(250);
    };
    const active = () => evaluate(`(() => { const a = document.activeElement; return a === document.body || !a ? '(body)'
      : a.type === 'checkbox' ? 'checkbox' : a.getAttribute('role') === 'tab' ? 'tab:' + a.textContent
      : a.getAttribute('aria-label') || a.id || a.tagName; })()`);
    const f = {};
    await evaluate(`(async () => { State.qtti = qttiDefaultPlan(); saveQtti(); navigate('/research/trading-index'); await new Promise(r => setTimeout(r, 200));
      document.querySelector('select[aria-label="Daily Momentum"]').focus(); return 1; })()`);
    await press('ArrowUp', 38);
    f.select = await active();
    await evaluate(`(() => { const n = document.querySelector('main input[type=checkbox]'); n.focus(); return 1; })()`);
    await press(' ', 32, ' ');
    f.checkbox = await active();
    await evaluate(`(() => { const n = document.querySelector('#qp-plannedTotal'); n.focus(); n.select(); return 1; })()`);
    await press('5', 53, '5'); await press('Tab', 9);
    f.tab = await active();
    await evaluate(`(async () => { State.qtti = qttiWorkedExample(); saveQtti(); State.wheel = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true }; saveWheel();
      State.decisionSubject = null; navigate('/decision-record'); await new Promise(r => setTimeout(r, 200));
      document.querySelectorAll('[role=tab]')[1].focus(); return 1; })()`);
    await press('Enter', 13, '\r');
    f.recordTab = await active();
    f.recordSelected = await evaluate(`document.activeElement.getAttribute('aria-selected')`);
    await evaluate(`(async () => {
      const w = () => new Promise(r => setTimeout(r, 150));
      State.opportunities = []; saveOpportunities(); navigate('/property/opportunities'); await w();
      const add = async (name) => { const n = document.querySelector('#opp-new-name'); n.value = name; n.dispatchEvent(new Event('change', { bubbles: true }));
        [...document.querySelectorAll('main button')].find(b => b.textContent === 'Add to register').click(); await w(); };
      await add('Unit 5'); await add('Unit 5');
      State.opportunities = State.opportunities.slice(0, 1); saveOpportunities(); render(); await w();
      await add('Unit 5');
      document.querySelector('input[aria-label^="Next verification action"]').focus(); return 1; })()`);
    f.ids = await evaluate(`State.opportunities.map(o => o.id)`);
    await press('x', 88, 'x'); await press('Tab', 9);
    f.nextAction = await active();
    await evaluate(`(() => { const s = ${JSON.stringify(saved)}; const o = JSON.parse(s); State.qtti = o.q; saveQtti(); State.wheel = o.w; saveWheel();
      State.opportunities = o.o; saveOpportunities(); State.decisionSubject = o.ds; return 1; })()`);
    const q = [];
    if (f.select !== 'Daily Momentum') q.push(`a Trading Index select changed by the keyboard left focus on ${f.select}`);
    if (f.checkbox !== 'checkbox') q.push(`a Trading Index tick toggled by Space left focus on ${f.checkbox}`);
    if (f.tab !== 'qp-stage1Fraction') q.push(`Tab out of the intended-total field landed on ${f.tab}, not the Stage 1 fraction`);
    if (!/^tab:/.test(f.recordTab) || f.recordSelected !== 'true') q.push(`a decision-record subject chosen with Enter left focus on ${f.recordTab} (selected ${f.recordSelected})`);
    if (!/^Who owns the next action/.test(f.nextAction || '')) q.push(`Tab from an opportunity's next action landed on ${f.nextAction}, not its owner`);
    if (new Set(f.ids).size !== f.ids.length) q.push(`opportunity ids repeat after a removal: ${f.ids.join(', ')}`);
    if (q.length) fail('keyboard focus survives an edit on the Trading Index, the decision record and the opportunity register; record ids stay unique', q);
    else ok('keyboard focus stays on the edited control (or the next one after Tab) across the Trading Index, the decision-record tabs and the opportunity register; opportunity ids stay unique after a removal', f);
  }
  /* ---- end bugfix: studio-trading ---- */

  /* ---- bugfix: property ---- */
  /* P1 — a nil period does not hide the sign change. [−100, 0, 110] has one
         rate, 4.88%; the count skipped every pair with a nil in it and said
         no period was positive. A parcel bought outright with its outgoings
         entered as nought is that shape, nine nil years and a sale. */
  {
    const r = await evaluate(`(() => {
      const simple = irrOf([-100, 0, 110]);
      const d = { ...window.__T.base, propertyType: 'Land', downPct: 100, assessment: 0, quitRent: 0, insurance: 0 };
      const m = dealModel(d);
      const nils = m.flows.slice(1, -1).every(f => f === 0);
      return { simple: simple.rate, why: simple.why, sc: simple.signChanges, nils, irr: m.irrPct, irrWhy: m.irrWhy,
               mult: m.annualisedMultiplePct, npv: isNum(m.irrPct) ? npvAt(m.irrPct / 100, m.flows) : null,
               scale: Math.max(...m.flows.map(Math.abs)) };
    })()`);
    if (!(Math.abs(r.simple - 4.880884817) < 1e-4) || r.sc !== 1) fail('a nil period between the outlay and the return hides the rate', r);
    else if (!r.nils || !isFinite(r.irr)) fail('a parcel bought outright with nil outgoings has no rate of return beside a sale that returns its cost', r);
    else if (Math.abs(r.irr - r.mult) > 1e-6 || Math.abs(r.npv) / r.scale > 1e-8) fail('the parcel\'s rate is not the rate that zeroes its flows', r);
    else ok(`a nil period hides no sign change — ${r.simple.toFixed(4)}%, and the outright parcel returns ${r.irr.toFixed(4)}% a year`, r);
  }

  /* P2 — unknown flows have no value and no tax. A tenure of 0 leaves the
         instalment, the interest and so the tax unknown: the panel valued the
         flows at −RM121,754 against the hurdle, and charged RM87,192 of tax
         with no interest deducted. */
  {
    const r = await evaluate(`(() => {
      const d = { ...window.__T.base, tenureYears: 0, rent: 3600, marginalTaxPct: 24 };
      const m = dealModel(d);
      const card = returnsAndTaxPanel(d, m);
      const text = card.textContent;
      return { npvNull: npvAt(0.07, [-100, null, 120]), npv: m.npvAtHurdle, interest: interestInYear(500000, 4.3, 0, 1),
               noLoan: interestInYear(0, 4.3, 0, 1), taxes: m.path.map(p => p.tax), hurdle: m.hurdlePct,
               fallsShort: /Falls short of the alternative/.test(text), taxTile: /Tax on rent over the hold/.test(text),
               says: /neither can the interest inside it/.test(text) };
    })()`);
    if (r.npvNull !== null || r.npv !== null) fail('flows with a missing year are given a value', r);
    else if (r.interest !== null || r.noLoan !== 0) fail('a loan with no tenure is charged no interest, or no loan is charged some', r);
    else if (r.taxes.some(t => t !== null)) fail('tax on the rent is computed while the interest is unknown', r.taxes);
    else if (r.fallsShort || r.taxTile || !r.says) fail('the return panel still prices unknown flows or a tax on them', r);
    else ok('with no tenure the flows have no value, the interest and the tax are unknown, and the panel says so', r);
  }

  /* P3 — "deducting the whole instalment" understates taxable income by the
         principal, and only by it. The naive figure also deducted the first
         tenant's placement fee, so a managed deal credited that to the
         instalment too. */
  {
    const r = await evaluate(`(() => {
      const d = { ...window.__T.taxed, selfManaged: false, mgmtPct: 8, leasingFeeMonths: 1 };
      const m = dealModel(d);
      const text = returnsAndTaxPanel(d, m).textContent;
      const hit = text.match(/understating it by (RM[\\d,]+)/);
      return { said: hit && hit[1], principal: fmtMoney(m.path[0].principal, 'MYR', 0), placement: m.placementAnnual };
    })()`);
    if (!(r.placement > 0)) fail('the managed deal carries no placement fee, so this check is vacuous', r);
    else if (r.said !== r.principal) fail('the instalment understatement is not the year-one principal', r);
    else ok(`deducting the instalment understates taxable income by the principal alone — ${r.said}`, r);
  }

  /* P4 — "the figure shown is the first one found" only beside a figure. */
  {
    const r = await evaluate(`(() => {
      const d = { ...window.__T.base, rent: 6000, apprecPct: -5, holdYears: 8 };
      const m = dealModel(d);
      const text = returnsAndTaxPanel(d, m).textContent;
      return { irr: m.irrPct, rates: m.irrSignChanges, claim: /The figure shown is the first one found/.test(text) };
    })()`);
    if (r.irr !== null || !(r.rates > 1)) fail('the two-rate deal no longer has two rates, so this check is vacuous', r);
    else if (r.claim) fail('the panel describes a figure it does not show', r);
    else ok('with two rates and none chosen, the panel does not describe a figure', r);
  }

  /* P5 — the IPS capital and net gates do not read an unknown as nought. */
  {
    const r = await evaluate(`(() => {
      const d = { ...window.__T.base, tenureYears: 0 };
      const m = dealModel(d);
      const a = propertyIpsAnswers(d, m, { gates: [] });
      const pick = (id) => { const x = a.find(y => y.id === id); return { v: x.verdict.id, why: x.why }; };
      return { capital: pick('capital'), net: pick('net') };
    })()`);
    const bad = ['capital', 'net'].filter(k => r[k].v !== 'unknown' || /RM0\b/.test(r[k].why));
    if (bad.length) fail(`with no computable instalment the ${bad.join(' and ')} ${bad.length > 1 ? 'gates read' : 'gate reads'} it as RM0`, r);
    else ok('with no computable instalment the capital and net gates are not established rather than RM0', r);
  }

  /* P6 — the thirty-year comparison only says "lower" when it is. */
  {
    const r = await evaluate(`(() => {
      const say = (years) => financingChoicesPanel({ ...window.__T.base, flatQuotePct: 4, flatQuoteAmount: 50000, flatQuoteYears: years }, null).textContent;
      const t5 = say(5), t40 = say(40);
      return { five: /stretched over thirty years/.test(t5), forty: /stretched over thirty years/.test(t40),
               r40: reducingEquivalent(50000, 4, 40).rate, r30: reducingEquivalent(50000, 4, 30).rate };
    })()`);
    if (!r.five) fail('the thirty-year comparison is gone for a five-year quote', r);
    else if (r.forty && r.r30 >= r.r40) fail('a forty-year flat quote is told the thirty-year rate is lower', r);
    else ok('the thirty-year comparison appears only for a shorter quote', r);
  }

  /* P7 — the affordability band is a quarter to a third, as it says. */
  {
    const r = await evaluate(`(() => {
      const kept = sarawakIncome;
      sarawakIncome = { source: 'test', retrieved: 'test', districts: { Testville: [{ year: 2024, median: 6000, mean: 7000 }] } };
      try { return affordabilityPanel('Testville').textContent; } finally { sarawakIncome = kept; }
    })()`);
    if (!/RM1,500–2,000 a month/.test(r)) fail('the affordability band is not a quarter to a third of the median', r.slice(0, 200));
    else ok('the affordability band is a quarter to a third of the median — RM1,500–2,000 on RM6,000');
  }

  /* P8 — the age of the last transaction is the newest of the built and the
         land sales, not a built sale whenever there is one. */
  {
    const r = await evaluate(`(() => {
      const kept = State.observations;
      const iso = (m) => { const t = new Date(); t.setMonth(t.getMonth() - m); return t.toISOString().slice(0, 10); };
      State.observations = [
        { city: 'kuching', area: 'Probe-area', kind: 'sold-price', value: 400000, date: iso(80) },
        { city: 'kuching', area: 'Probe-area', kind: 'land-sold', value: 90000, date: iso(2) },
      ];
      try { return { age: LAYER_BY_ID.lastSoldAge.value('kuching', 'Probe-area'), last: areaMetrics('kuching', 'Probe-area').lastTransaction?.kind }; }
      finally { State.observations = kept; }
    })()`);
    if (!(r.age < 6) || r.last !== 'land-sold') fail('the last-transaction age prefers an old built sale to a recent land sale', r);
    else ok(`the last-transaction age reads the newest sale of either kind — ${r.age.toFixed(1)} months`, r);
  }

  /* P9 — a sentence begins with a capital, and a category is named as one. */
  {
    const r = await evaluate(`(() => {
      const land = landRiskProfile('kuching', 'Probe-area').sentence;
      const cit = rpgtCharge({ disposalPrice: 900000, acquisitionPrice: 500000, holdYears: 10, categoryId: 'citizen' }).why;
      const co = rpgtCharge({ disposalPrice: 900000, acquisitionPrice: 500000, holdYears: 3, categoryId: 'company' }).why;
      return { land, cit, co };
    })()`);
    if (!/\. [A-Z]/.test(r.land)) fail('the land-risk sentence opens its second sentence in lower case', r.land);
    else if (/citizen or pr\b|malaysian company/.test(r.cit + r.co)) fail('the gains-tax reason lower-cases PR and Malaysian', r);
    else ok('the land-risk sentence and the gains-tax reasons read as sentences', r);
  }

  /* P10 — the NAPIC type column wraps between words on a phone. A break after
         a hyphen is a break between words ("semi-" / "detached"), so the
         parts measured are the words split after their hyphens, against the
         cell's content box. The first version measured "semi-detached" whole
         against the cell's padded width: it passed here by 0px and failed
         on Linux (89px against 87px), where the page was right both times. */
  {
    const r = await evaluate(`(async () => {
      if (!napicStatus.ok) await loadNapic();
      if (!napicStatus.ok) return { skip: true };
      const host = document.createElement('div');
      host.style.width = '358px';
      document.body.appendChild(host);
      host.appendChild(officialBenchmarkPanel('kuching', 'Tabuan'));
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      const cells = [...host.querySelectorAll('table')][1].querySelectorAll('tbody tr > td:nth-child(2)');
      const widest = Math.max(...[...cells].map(c => {
        const words = c.textContent.split(/\\s+/).flatMap(x => x.split(/(?<=-)/)).filter(Boolean);
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;white-space:nowrap;visibility:hidden';
        probe.className = 'caption';
        c.appendChild(probe);
        const w = Math.max(...words.map(x => { probe.textContent = x; return probe.getBoundingClientRect().width; }));
        probe.remove();
        return w;
      }));
      const cs0 = getComputedStyle(cells[0]);
      const col = cells[0].getBoundingClientRect().width - parseFloat(cs0.paddingLeft) - parseFloat(cs0.paddingRight);
      host.remove();
      return { col, widest };
    })()`);
    if (r.skip) fail('the NAPIC dataset did not load, so the type column could not be checked');
    else if (!(r.col + 1 >= r.widest)) fail(`the NAPIC type column holds ${Math.round(r.col)}px of text at 358px, narrower than its longest word (${Math.round(r.widest)}px) — words break inside`, r);
    else ok(`the NAPIC type column holds its longest word at 358px — ${Math.round(r.widest)}px in ${Math.round(r.col)}px of text`, r);
  }

  /* P11 — the map's scale bar and its label sit inside the box drawn. The
         bar was sized to the host, and a tall city's box is far narrower. */
  {
    const r = await evaluate(`(async () => {
      if (!sarawakGeo) { geoLoadState = 'idle'; await loadSarawakLayers(); }
      if (!sarawakGeo) return { skip: true };
      const out = [];
      for (const w of [1168, 657, 310]) for (const city of Object.keys(sarawakGeo.cities)) {
        const host = document.createElement('div');
        host.style.width = w + 'px';
        document.body.appendChild(host);
        host.appendChild(cityMap(city, null, null));
        await new Promise(res => setTimeout(res, 60));
        const svg = host.querySelector('svg');
        const label = svg && [...svg.querySelectorAll('text')].find(t => / km$/.test(t.textContent));
        if (label) { const b = label.getBBox(); out.push({ w, city, box: svg.viewBox.baseVal.width, end: Math.round(b.x + b.width), km: label.textContent }); }
        else out.push({ w, city, missing: true });
        host.remove();
      }
      return { out };
    })()`);
    if (r.skip) fail('the Sarawak locality layer did not load, so the scale bar could not be checked');
    else {
      const bad = r.out.filter(x => x.missing || x.end > x.box);
      if (bad.length) fail(`the map scale bar runs out of its box: ${bad.map(x => `${x.city} at ${x.w}px (${x.km || 'no bar'} ends ${x.end} of ${x.box})`).join('; ')}`, bad);
      else ok(`the map scale bar and its label fit the box for ${r.out.length} city and width pairs`, r.out.map(x => `${x.city}@${x.w} ${x.km}`).join(', '));
    }
  }
  /* P12 — a keyboard change keeps its place. The panels re-render on every
         change and focus fell to <body>: a second arrow press on the seller
         did nothing, and Tab out of the tax rate went to the top of the page. */
  {
    const press = async (key, code, shift = false) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers: shift ? 8 : 0 }, sessionId);
      await sleep(300);
    };
    await evaluate(`(async () => {
      State.deal = { ...window.__T.base, disposerCategory: 'citizen', marginalTaxPct: null, flatQuotePct: null };
      saveDeal(); navigate('/property/calculator');
      await new Promise(res => setTimeout(res, 400));
      document.getElementById('disposerCategory-citizen').focus();
      return true;
    })()`);
    await press('ArrowDown', 40);
    await press('ArrowDown', 40);
    const sel = await evaluate(`({ active: document.activeElement.id || document.activeElement.tagName, v: State.deal.disposerCategory })`);
    await evaluate(`(() => { const n = document.getElementById('flatQuotePct'); n.focus(); return true; })()`);
    await send('Input.insertText', { text: '4' }, sessionId);
    await press('Tab', 9);
    const fwd = await evaluate(`({ active: document.activeElement.id || document.activeElement.tagName, v: State.deal.flatQuotePct })`);
    await evaluate(`(() => { const n = document.getElementById('flatQuoteYears'); n.focus(); return true; })()`);
    await send('Input.insertText', { text: '7' }, sessionId);
    await press('Tab', 9, true);
    const bwd = await evaluate(`({ active: document.activeElement.id || document.activeElement.tagName, v: State.deal.flatQuoteYears })`);
    await evaluate(`(() => { State.deal = { ...window.__T.base }; saveDeal(); render(); return true; })()`);
    const r = { sel, fwd, bwd };
    if (sel.active !== 'disposerCategory-foreign' || sel.v !== 'foreign') fail('arrow keys on the seller lose focus after the first press', r);
    else if (fwd.v !== 4 || fwd.active !== 'flatQuoteAmount') fail('Tab out of a changed quote does not reach the next field', r);
    else if (bwd.v !== 7 || bwd.active !== 'flatQuoteAmount') fail('Shift+Tab out of a changed quote does not reach the previous field', r);
    else ok('a keyboard change on the property panels keeps its place — arrows stay, Tab and Shift+Tab move one stop', r);
  }
  /* ---- end bugfix: property ---- */

  /* ---- bugfix: grade-area-registers ---- */
  /* 38 — the lease field keeps focus while it is typed in, and an emptied box
         is not freehold. It re-rendered the page on every keystroke: typing
         45 recorded 4 and dropped focus on the page, and clearing the box
         recorded 0, which the label defines as freehold. Driven through real
         key events, because the defect only exists between keystrokes. */
  {
    await evaluate(`(() => { window.__T.leaseKept = JSON.parse(JSON.stringify(State.deal));
      State.deal = { ...State.deal, titleType: 'mixed-zone', remainingLease: 88 }; saveDeal();
      navigate('/property/calculator'); return true; })()`);
    await sleep(600);
    await evaluate(`(() => { const n = document.getElementById('dealLease'); n.focus(); n.select(); return true; })()`);
    for (const k of ['4', '5']) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k, windowsVirtualKeyCode: k.charCodeAt(0) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: k.charCodeAt(0) }, sessionId);
      await sleep(150);
    }
    const typed = JSON.parse(await evaluate(`JSON.stringify({ active: document.activeElement?.id || document.activeElement?.tagName, value: document.getElementById('dealLease')?.value })`));
    await evaluate(`(() => { document.getElementById('dealLease').blur(); return true; })()`);
    await sleep(300);
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = State.deal.remainingLease;
      const n = document.getElementById('dealLease');
      n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(res => setTimeout(res, 300));
      const out = { kept, afterEmpty: State.deal.remainingLease, shown: document.getElementById('dealLease')?.value };
      State.deal = window.__T.leaseKept; saveDeal(); render();
      return JSON.stringify(out);
    })()`));
    if (typed.active !== 'dealLease' || typed.value !== '45') fail('typing into the lease field loses focus after the first digit', typed);
    else if (r.kept !== 45) fail('the lease field did not record what was typed', { typed, r });
    else if (r.afterEmpty !== 45 || r.shown !== '45') fail('an emptied lease box is recorded as 0 — freehold', r);
    else ok('the lease field keeps focus while typed in, records 45, and an emptied box stays 45 rather than freehold', { typed, r });
  }

  /* 39 — "Date observed", and a Sarawak exposure's "Added", are the reader's
         today. Both were the UTC date, a day behind in Kuching until 08:00,
         so a record accepted with the default was dated the day before it
         was observed. The clock is held at 04:30 on the 28th, Kuching time —
         20:30 on the 27th in UTC. */
  {
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kuching' }, sessionId);
    const r = await evaluate(`(async () => {
      const Real = Date, fixed = Real.parse('2026-09-27T20:30:00Z');
      window.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
      const kept = State.sarawakExposure;
      try {
        navigate('/property/calculator'); render();
        await new Promise(res => setTimeout(res, 200));
        const observed = document.querySelector('input[aria-label="Date observed"]')?.value || null;
        /* The Sarawak exposure record's "Added" date, stamped the same way. */
        State.sarawakExposure = [];
        navigate('/discover/sarawak'); render();
        await new Promise(res => setTimeout(res, 200));
        [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Add')?.click();
        const added = (State.sarawakExposure || [])[0]?.added || null;
        return JSON.stringify({ observed, added });
      } finally { window.Date = Real; State.sarawakExposure = kept; saveExposures(); }
    })()`);
    await send('Emulation.setTimezoneOverride', { timezoneId: '' }, sessionId);
    const d39 = JSON.parse(r);
    if (d39.observed !== '2026-09-28' || d39.added !== '2026-09-28') fail('a date stamped "today" is the UTC date, not the reader\'s', d39);
    else ok('"Date observed" and an exposure\'s "Added" are the reader\'s own date — 2026-09-28 at 04:30 in Kuching', d39);
  }

  /* 40 — the grade card's headings: the card is a heading under the page
         title, not a paragraph (the page went h1 → h4), and the list of
         findings is named for the grade it sits under. Every graded result
         said "Why this is conditional", beside a D verdict of "Does not
         meet the selected underwriting criteria". */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = JSON.parse(JSON.stringify(State.deal));
      navigate('/property/calculator'); await new Promise(res => setTimeout(res, 200));
      const graded = (rent, ev) => ({ ...kept, titleType: 'mixed-zone', remainingLease: 0, bankValuation: kept.price, rent,
        touched: { price: true, rent: true, maintenance: true, sqft: true },
        evidence: { price: 'verified', rent: ev, maintenance: 'verified', sqft: 'verified' },
        checks: Object.fromEntries(SARAWAK_CHECKS.map(c => [c.id, c.adverse === 'yes' ? 'no' : 'yes'])) });
      const out = {};
      for (const [name, d] of [['low', graded(1200, 'user')], ['cond', graded(4000, 'developer')]]) {
        State.deal = d; render(); await new Promise(res => setTimeout(res, 150));
        const hs = [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')];
        const lead = hs.find(h => /^Why this|^Still to check/.test(h.textContent));
        out[name] = { grade: propertyGrade(d, dealModel(d)).grade, second: hs[1]?.tagName, lead: lead?.textContent || null };
      }
      State.deal = kept; saveDeal(); render();
      return JSON.stringify(out);
    })()`));
    const skip = [r.low, r.cond].find(x => x.second !== 'H2' && x.second !== 'H3');
    if (skip) fail('the calculator\'s first heading after its title skips a level', r);
    else if (r.low.grade !== 'D' || r.low.lead !== 'Why this falls short') fail('a D grade calls its findings conditions', r.low);
    else if (r.cond.grade !== 'B' || r.cond.lead !== 'Why this is conditional') fail('a B grade no longer says why it is conditional', r.cond);
    else ok(`the grade card is a heading, and its findings are named for the grade — D: "${r.low.lead}", B: "${r.cond.lead}"`, r);
  }
  /* 41 — a pressed segment says so to assistive technology, and the checklist's
         answers say which question they answer. The strips carried only
         aria-selected, which means nothing on a plain button, and each of the
         ten checklist rows was three bare "Yes / No / Not sure" buttons. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const wait = () => new Promise(res => setTimeout(res, 300));
      const out = {};
      for (const path of ['/property/calculator', '/property/areas']) {
        navigate(path); await wait();
        /* aria-pressed is the state and the only one: aria-selected, which
           the strips carried beside it for the stylesheet, is not allowed on
           a button (the launch audit's quality block moved the style). */
        const btns = [...document.querySelectorAll('main .segmented button:not([role=tab])')];
        out[path] = { n: btns.length, silent: btns.filter(b => !/^(true|false)$/.test(b.getAttribute('aria-pressed') || '') || b.hasAttribute('aria-selected')).length };
        if (path === '/property/calculator') out.unnamedGroups = [...document.querySelectorAll('main .segmented')]
          .filter(s => [...s.querySelectorAll('button')].some(b => /^(Yes|No|Not sure)$/.test(b.textContent.trim())))
          .filter(s => s.getAttribute('role') !== 'group' || !(s.getAttribute('aria-label') || '').trim()).length;
      }
      return JSON.stringify(out);
    })()`));
    const silent = ['/property/calculator', '/property/areas'].filter(p => !r[p].n || r[p].silent);
    if (silent.length) fail(`segmented buttons that do not state whether they are pressed on ${silent.join(', ')}`, r);
    else if (r.unnamedGroups) fail(`${r.unnamedGroups} checklist answer groups carry no question`, r);
    else ok('every segmented choice states whether it is pressed, and each checklist answer group is named by its question', r);
  }
  /* 42 — the keyboard keeps its place through a redraw. Every control saved
         and called render(), which replaced the page and the focused control
         with it: a price typed and Tabbed past, an evidence grade moved with
         an arrow key, a checklist answer and a Cash Wheel field each left
         focus on <body>. Driven with real key events. */
  {
    const keys = async (seq) => {
      for (const k of seq) {
        const code = { Tab: 9, Enter: 13, ArrowDown: 40 }[k] || k.charCodeAt(0);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code,
          ...(k.length === 1 ? { text: k } : k === 'Enter' ? { text: '\r' } : {}) }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code }, sessionId);
        await sleep(120);
      }
      await sleep(200);
    };
    const at = () => evaluate(`document.activeElement?.id || document.activeElement?.tagName || null`);
    const out = {};
    await evaluate(`(() => { window.__T.focusDeal = JSON.parse(JSON.stringify(State.deal)); window.__T.focusWheel = JSON.parse(JSON.stringify(State.wheel));
      navigate('/property/calculator'); return true; })()`);
    await sleep(500);
    await evaluate(`(() => { const n = document.getElementById('d-price'); n.focus(); n.select(); return true; })()`);
    await keys(['6', '0', '0', '0', '0', '0', 'Tab']); out.field = await at();
    await evaluate(`(() => { document.getElementById('ev-price').focus(); return true; })()`);
    await keys(['ArrowDown']); out.select = await at();
    await evaluate(`(() => { [...document.querySelectorAll('main .segmented button')].find(b => b.textContent.trim() === 'Yes').focus(); return true; })()`);
    await keys(['Enter']); out.answer = await at();
    await evaluate(`(() => { State.deal = window.__T.focusDeal; saveDeal(); navigate('/us-options/wheel'); return true; })()`);
    await sleep(500);
    await evaluate(`(() => { const n = document.getElementById('w-putStrike'); n.focus(); n.select(); return true; })()`);
    await keys(['4', '5', 'Tab']); out.wheel = await at();
    await evaluate(`(() => { State.wheel = window.__T.focusWheel; saveWheel(); navigate('/property/calculator'); return true; })()`);
    const lost = [];
    if (!/^d-/.test(out.field) || out.field === 'd-price') lost.push(`typed price then Tab → ${out.field}`);
    if (out.select !== 'ev-price') lost.push(`evidence grade by arrow key → ${out.select}`);
    if (!/^chk-/.test(out.answer)) lost.push(`checklist answer → ${out.answer}`);
    if (!/^w-/.test(out.wheel) || out.wheel === 'w-putStrike') lost.push(`Cash Wheel strike then Tab → ${out.wheel}`);
    if (lost.length) fail('focus falls out of the page when a control redraws it', lost.join('; '));
    else ok('focus stays where the keyboard put it through every redraw — the next field, the same select, the same answer', out);
  }
  /* ---- end bugfix: grade-area-registers ---- */

  /* ---- bugfix3: property ---- */
  /* Q1 — a tax total over years whose tax is unknown is unknown. With a
          tenure of 0 every year's tax is null, the running sum left RM0, and
          the decision record read "after tax on the rent at 24%, totalling
          RM0 across the hold".
          The record's half went vacuous when the sentence was reworded
          (bugfix4: misc M1): it looked for "Figures are after tax", which the
          record no longer prints, so it read "" and could not fail — a record
          printing "which comes to RM0 across the hold" passed. It now takes
          the tax sentence in whichever of its three forms the record uses,
          fails when there is none, and is anchored: the taxed deal's sentence
          must carry the model's own total, so a rewording that loses the
          sentence fails here rather than passing. */
  {
    const r = JSON.parse(await evaluate(`(() => {
      const kept = State.deal;
      const d = { ...window.__T.base, tenureYears: 0, rent: 3600, marginalTaxPct: 24 };
      const m = dealModel(d), t = dealModel(window.__T.taxed);
      const sentence = (deal) => {
        State.deal = deal;
        try { return (decisionRecordProperty().textContent.match(/(Every figure in this record is BEFORE tax|No tax on the rent has been computed|The rate of return is after tax)[^.]*\\./) || [''])[0]; }
        finally { State.deal = kept; }
      };
      return JSON.stringify({ cumTax: m.cumTax, said: sentence(d), taxedSaid: sentence(window.__T.taxed), taxedTotal: fmtMoney(t.cumTax, 'MYR', 0),
        taxed: t.cumTax, taxedSum: t.path.reduce((a, p) => a + p.tax, 0) });
    })()`));
    if (r.cumTax !== null) fail('the tax total over years whose tax is unknown is a number', r);
    else if (!(r.taxed > 0) || Math.abs(r.taxed - r.taxedSum) > 1e-6) fail('the tax total no longer sums the years it can compute', r);
    else if (!r.taxedSaid.includes(r.taxedTotal)) fail('the decision record does not print the tax total the model computes, or this check no longer finds the record\'s tax sentence', r);
    else if (!r.said || /after tax|comes to|totalling|RM/.test(r.said)) fail('the decision record prints a tax total the model cannot compute, or states no tax basis', r.said || r);
    else ok(`a tax total over unknown years is unknown, not RM0 — the record reads "${r.said}"; a computable one still sums its years and the record prints it, ${r.taxedTotal}`, r);
  }

  /* Q2 — a cash purchase has nothing to service whatever the tenure box
          says. With no loan and a tenure of 0 the instalment was null, the
          reserve could not be computed and was listed as a missing cost
          line, and the page warned that the schedule was unavailable. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = JSON.parse(JSON.stringify(State.deal));
      const cash = { ...window.__T.base, downPct: 100, tenureYears: 0 };
      const m = dealModel(cash);
      const fin = dealModel({ ...window.__T.base, tenureYears: 0 });
      const aff = borrowerAffordability({ verifiedNetMonthlyIncome: 9000, existingMonthlyDebtPayments: 500 }, m);
      State.deal = cash; navigate('/property/calculator'); render();
      await new Promise(res => setTimeout(res, 200));
      const text = document.querySelector('main').innerText;
      /* The anchor for "warned": the same words on the loan that has no
         schedule, so a reworded warning fails here rather than leaving the
         cash purchase's clause unable to fail (as Q1's sentence clause was). */
      State.deal = { ...window.__T.base, tenureYears: 0 }; render();
      await new Promise(res => setTimeout(res, 200));
      const finText = document.querySelector('main').innerText;
      State.deal = kept; saveDeal(); render();
      return JSON.stringify({ inst: m.instalment, reserve: m.reserve, computable: m.reserveComputable,
        missing: m.missingCostLines.map(x => x.label), stressed: aff.stressedInstalment,
        warned: /loan tenure is zero or negative/.test(text), zeroRate: dealModel({ ...cash, ratePct: 0 }).zeroRateModelled,
        finWarned: /loan tenure is zero or negative/.test(finText), finZeroRate: dealModel({ ...window.__T.base, ratePct: 0 }).zeroRateModelled,
        finInst: fin.instalment, finComputable: fin.reserveComputable });
    })()`));
    if (r.inst !== 0 || !r.computable || !(r.reserve > 0) || r.missing.length) fail('a cash purchase with a tenure of 0 has no instalment of nought or no reserve', r);
    else if (!r.finWarned || r.finZeroRate !== true) fail('a loan with no tenure or no rate is not flagged, so the cash purchase\'s "not warned" proves nothing', r);
    else if (r.warned || r.zeroRate) fail('a cash purchase is warned about a loan schedule or rate it does not have', r);
    else if (r.stressed !== 0) fail('a cash purchase has an unknown stressed instalment', r);
    else if (r.finInst !== null || r.finComputable) fail('a financed deal with a tenure of 0 now claims an instalment', r);
    else ok(`a cash purchase with a tenure of 0 has an instalment of RM0 and a reserve of RM${r.reserve}, and no loan warning; a loan with no tenure is still unknown`, r);
  }

  /* Q3 — the gains-tax flag names the seller as a sentence does. It
          lower-cased the short label: "charged at 30% for citizen or pr". */
  {
    const r = await evaluate(`(() => {
      const d = { ...window.__T.base, holdYears: 3 };
      return propertyRiskFlags(d, dealModel(d)).find(f => /gains tax/.test(f.t))?.n || null;
    })()`);
    if (!r || /\bpr\b|citizen or pr/.test(r) || !/for a citizen or permanent resident/.test(r)) fail('the gains-tax flag names the seller category as a lower-cased label', r);
    else ok(`the gains-tax flag reads as a sentence — "${r.slice(0, 80)}…"`, r);
  }

  /* Q4 — the property report meter counts the reader's month. It keyed on
          the UTC month, so at 00:30 on 1 October in Kuching (16:30 on 30
          September in UTC) September's used reports still counted. */
  {
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kuching' }, sessionId);
    const r = JSON.parse(await evaluate(`(() => {
      const Real = Date, fixed = Real.parse('2026-09-30T16:30:00Z');
      const keptLog = State.propertyReportLog;
      window.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } };
      try {
        State.propertyReportLog = { month: '2026-09', ids: ['a', 'b'] };
        const month = propertyReportLogNow().month;
        return JSON.stringify({ month, used: propertyReportLogNow().ids.length });
      } finally { window.Date = Real; State.propertyReportLog = keptLog; }
    })()`));
    await send('Emulation.setTimezoneOverride', { timezoneId: '' }, sessionId);
    if (r.month !== '2026-10' || r.used !== 0) fail('the property report meter counts the UTC month, not the reader\'s', r);
    else ok('the property report meter turns over at midnight in Kuching — October at 00:30 on the 1st, with none used', r);
  }

  /* Q5 — the area screen's "Last transacted" is the newest sale of either
          kind. It preferred any built sale to every land sale: a 2019 house
          beside last month's parcel showed 2019. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const keptObs = State.observations, keptLog = localStorage.getItem('vl.registerLog');
      const keptScreen = { ...State.areaScreen };
      const recent = new Date(); recent.setMonth(recent.getMonth() - 1);
      State.observations = [];
      addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 620000, date:'2019-03-01', evidence:'user', sourceRef:'old sale' });
      addObservation({ city:'kuching', area:'Tabuan', kind:'land-sold', value: 333000, date: caseRaisedAt(recent).slice(0, 10), evidence:'user', sourceRef:'new parcel' });
      State.areaScreen = { ...State.areaScreen, city: 'kuching', editing: null };
      navigate('/property/areas'); render();
      await new Promise(res => setTimeout(res, 300));
      const table = [...document.querySelectorAll('main table.dt')].find(t => /Last transacted/.test(t.querySelector('thead')?.textContent || ''));
      const col = [...table.querySelectorAll('thead th')].findIndex(th => th.textContent === 'Last transacted');
      const row = [...table.querySelectorAll('tbody tr')].find(tr => tr.querySelector('th')?.textContent === 'Tabuan');
      const cell = row ? row.children[col]?.textContent : null;
      State.observations = keptObs; saveObservations();
      if (keptLog == null) localStorage.removeItem('vl.registerLog'); else localStorage.setItem('vl.registerLog', keptLog);
      loadRegisterLog(); State.areaScreen = keptScreen;
      return JSON.stringify({ cell });
    })()`));
    if (!r.cell || !/333,000/.test(r.cell) || !/land/.test(r.cell) || /620,000/.test(r.cell)) fail('"Last transacted" shows an older built sale over a newer land sale', r);
    else ok(`"Last transacted" is the newest sale of either kind — ${r.cell}`, r);
  }

  /* Q6 — a class that can never be graded says so. A financed parcel has no
          rent, so debt-service cover and rental cash flow cannot apply: at
          most 60% of the weight can be scored against the 80% a grade needs.
          It read "Not enough evidence", and the page said the grade was
          withheld for want of coverage, as though evidence could lift it.
          The model is unchanged: still U, still 60%. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = JSON.parse(JSON.stringify(State.deal));
      const drivers = evidenceDriversFor({ ...window.__T.base, propertyType: 'Land' });
      const strong = { ...window.__T.base, propertyType: 'Land', titleType: 'mixed-zone', bankValuation: window.__T.base.price,
        evidence: Object.fromEntries(drivers.map(k => [k, 'verified'])), touched: Object.fromEntries(drivers.map(k => [k, true])),
        checks: Object.fromEntries(SARAWAK_CHECKS.map(c => [c.id, c.adverse === 'yes' ? 'no' : 'yes'])) };
      const out = {};
      for (const [name, d] of [['financed', strong], ['cash', { ...strong, downPct: 100 }], ['noTenure', { ...window.__T.base, tenureYears: 0 }]]) {
        const g = propertyGrade(d, dealModel(d));
        State.deal = d; navigate('/property/calculator'); render();
        await new Promise(res => setTimeout(res, 150));
        const card = [...document.querySelectorAll('main h3')].find(x => /Underwriting Grade/.test(x.textContent))?.closest('.card');
        const text = card ? card.textContent : '';
        out[name] = { grade: g.grade, verdict: g.verdict, coverage: g.coverage, reachable: g.reachable, gates: g.gates.length,
          noEvidence: /no further evidence changes that/.test(text), wantOfCoverage: /could be scored, against the 80% a grade requires/.test(text),
          doesNotApply: [...(card ? card.querySelectorAll('td span.caption') : [])].filter(s => s.textContent === 'does not apply').length,
          aCeiling: /short of the 90% an A needs/.test(text) };
      }
      State.deal = kept; saveDeal(); render();
      return JSON.stringify(out);
    })()`));
    const f = r.financed, c = r.cash, n = r.noTenure;
    if (f.grade !== 'U' || Math.abs(f.coverage - 0.6) > 1e-9 || f.gates) fail('the financed parcel is not the case this check is about — U at 60% with no gate', f);
    else if (f.verdict === 'Not enough evidence' || !f.noEvidence || f.wantOfCoverage || f.doesNotApply !== 2) fail('a financed parcel that no evidence can grade is told it lacks evidence', f);
    else if (c.verdict === 'Not gradeable for this class' || !c.aCeiling || c.doesNotApply !== 1) fail('a cash parcel does not say it can reach a B and never an A', c);
    /* n is also the anchor for f.wantOfCoverage: the words the parcel must not
       read are the ones a deal short of evidence does read. */
    else if (n.verdict !== 'Not enough evidence' || n.doesNotApply || !n.wantOfCoverage) fail('a loan with no tenure is called inapplicable rather than uncomputed, or is not told the coverage it lacks', n);
    else ok(`a financed parcel reads "${f.verdict}" — two pillars do not apply and no evidence lifts ${Math.round(f.reachable * 100)}% to 80%; a cash parcel says an A is out of reach; a let deal with no tenure still lacks evidence`, r);
  }

  /* Q7 — the keyboard keeps its place on the controls that still dropped it.
          The borrower's fields sat in a disclosure that came back closed on
          every redraw, so focus could not return to them; Sarawak Add and
          Remove, a map point, the calculator's Record, and the comparables
          drawer's Delete and Import each redrew the page and left focus on
          <body>. Driven with real key events. */
  {
    const keys = async (seq) => {
      for (const k of seq) {
        const code = { Tab: 9, Enter: 13, ArrowDown: 40 }[k] || k.charCodeAt(0);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code,
          ...(k.length === 1 ? { text: k } : k === 'Enter' ? { text: '\r' } : {}) }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code }, sessionId);
        await sleep(120);
      }
      await sleep(300);
    };
    const at = () => evaluate(`(() => { const a = document.activeElement; if (!a) return null; if (a.id) return a.id; const pt = a.getAttribute && a.getAttribute('role') === 'button' && a.closest && a.closest('svg'); return pt ? 'area:' + a.getAttribute('aria-label').split('.')[0] : a.tagName; })()`);
    const out = {};
    await evaluate(`(() => { window.__T.q7 = { deal: JSON.parse(JSON.stringify(State.deal)), borrower: localStorage.getItem('vl.borrowerProfile'), borrowerState: JSON.parse(JSON.stringify(State.borrower)),
      swk: localStorage.getItem('vl.sarawakExposure'), obs: localStorage.getItem('vl.observations'), log: localStorage.getItem('vl.registerLog') };
      navigate('/property/calculator'); return true; })()`);
    await sleep(600);
    /* the borrower's disclosure */
    await evaluate(`(() => { const d = document.getElementById('b-credit').closest('details'); d.open = true; return true; })()`);
    await sleep(100);
    await evaluate(`(() => { const n = document.getElementById('b-verifiedNetMonthlyIncome'); n.scrollIntoView({ block: 'center' }); n.focus(); n.select(); return true; })()`);
    await keys(['9', '1', '0', '0', 'Tab']); out.income = await at();
    out.stillOpen = await evaluate(`!!document.getElementById('b-credit')?.closest('details')?.open`);
    await evaluate(`(() => { document.getElementById('b-credit').focus(); return true; })()`);
    await keys(['ArrowDown']); out.credit = await at();
    await evaluate(`(() => { document.getElementById('b-credit').closest('details').open = false; return true; })()`);
    /* a map point */
    const pick = await evaluate(`(() => { const name = (g) => g.getAttribute('aria-label').split('.')[0]; const g = [...document.querySelectorAll('main svg g[role="button"]')].find(x => name(x) !== State.deal.district); if (!g) return null; g.scrollIntoView({ block: 'center' }); g.focus(); return name(g); })()`);
    await keys(['Enter']); await sleep(300); out.map = await at(); out.picked = pick;
    out.district = await evaluate(`State.deal.district`);
    /* the calculator's Record — found by its words, so the check runs on a
       build without the ids it relies on and fails rather than stopping */
    const button = (label, scope = 'main') => `[...document.querySelectorAll('${scope} button')].find(x => x.textContent.trim() === '${label}')`;
    const said = () => evaluate(`(() => { const a = document.activeElement; return a && a !== document.body ? (a.tagName + ':' + a.textContent.trim().slice(0, 24)) : 'BODY'; })()`);
    await evaluate(`(() => { const v = document.querySelector('main input[aria-label="Observed value"]'); v.value = '2100'; const b = ${button('Record')}; b.scrollIntoView({ block: 'center' }); b.focus(); return true; })()`);
    await keys(['Enter']); out.record = await said();
    /* Sarawak Add and Remove */
    await evaluate(`(() => { State.sarawakExposure = []; saveExposures(); navigate('/discover/sarawak'); return true; })()`);
    await sleep(500);
    await evaluate(`(() => { ${button('Add')}.focus(); return true; })()`);
    await keys(['Enter']); out.add = await said();
    await evaluate(`(() => { const s = document.querySelector('main select[aria-label="Company"]'); s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); ${button('Add')}.focus(); return true; })()`);
    await keys(['Enter']);
    out.second = await evaluate(`State.sarawakExposure[1]?.tk || null`);
    const removeFirst = `(() => { const d = document.querySelector('main details'); d.open = true; [...d.querySelectorAll('button')].find(b => b.textContent.trim() === 'Remove').focus(); return true; })()`;
    await evaluate(removeFirst);
    await keys(['Enter']); out.remove = await said();
    await evaluate(removeFirst);
    await keys(['Enter']); out.removeLast = await said();
    /* the comparables drawer */
    await evaluate(`(() => { State.observations = []; for (let i = 0; i < 3; i++) addObservation({ city:'kuching', area:'Tabuan', kind:'sold-price', value: 100 + i, date: '2026-05-0' + (i + 1), evidence:'user', sourceRef:'q7-' + i });
      navigate('/property/comparables'); return true; })()`);
    await sleep(500);
    const openRow = (src) => `[...document.querySelectorAll('main tbody tr')].find(tr => tr.textContent.includes('${src}'))?.querySelector('button')`;
    await evaluate(`(() => { const b = ${openRow('q7-1')}; b.scrollIntoView({ block: 'center' }); b.focus(); return true; })()`);
    await keys(['Enter']);
    await evaluate(`(() => { ${button('Delete this record', '')}.focus(); return true; })()`);
    await keys(['Enter']); await sleep(400);
    out.del = await said();
    out.delRow = await evaluate(`document.activeElement?.closest('tr')?.textContent.includes('q7-0') || false`);
    await evaluate(`(() => { const b = ${button('Import')}; b.scrollIntoView({ block: 'center' }); b.focus(); return true; })()`);
    await keys(['Enter']);
    await evaluate(`(() => { const ta = [...document.querySelectorAll('textarea')].find(t => /Paste JSON/.test(t.placeholder)); ta.value = JSON.stringify([{ city:'kuching', area:'Tabuan', kind:'sold-price', value: 555, date:'2026-06-01', evidence:'user', sourceRef:'q7-import' }]);
      ${button('Check this paste', '')}.click(); return true; })()`);
    await sleep(200);
    await evaluate(`(() => { [...document.querySelectorAll('button')].find(x => /^Import \\d+ record/.test(x.textContent.trim())).focus(); return true; })()`);
    await keys(['Enter']); await sleep(400); out.imp = await said();
    await evaluate(`(() => { const k = window.__T.q7;
      const put = (key, v) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v);
      put('borrowerProfile', k.borrower); put('sarawakExposure', k.swk); put('observations', k.obs); put('registerLog', k.log);
      State.borrower = k.borrowerState; State.sarawakExposure = store.read('sarawakExposure', []);
      State.observations = store.read('observations', []); loadRegisterLog();
      State.deal = k.deal; saveDeal(); navigate('/property/calculator'); return true; })()`);
    await sleep(300);
    const lost = [];
    if (out.income !== 'b-variableIncomeMonthlyAverage' || !out.stillOpen) lost.push(`borrower income then Tab → ${out.income}, disclosure open ${out.stillOpen}`);
    if (out.credit !== 'b-credit') lost.push(`borrower credit record by arrow key → ${out.credit}`);
    if (!out.picked || out.map !== 'area:' + out.picked || out.district !== out.picked) lost.push(`map point ${out.picked} → ${out.map}`);
    if (out.record !== 'BUTTON:Record') lost.push(`Record → ${out.record}`);
    if (out.add !== 'BUTTON:Add') lost.push(`Sarawak Add → ${out.add}`);
    if (!out.second || !out.remove.startsWith('SUMMARY:' + out.second) || out.removeLast !== 'BUTTON:Add') lost.push(`Sarawak Remove → ${out.remove}, then ${out.removeLast}`);
    if (out.del !== 'BUTTON:Open' || !out.delRow) lost.push(`drawer Delete → ${out.del} (the row that took its place: ${out.delRow})`);
    if (out.imp !== 'BUTTON:Import') lost.push(`drawer Import → ${out.imp}`);
    if (lost.length) fail('focus falls to <body> after a control redraws the page', lost.join('; '));
    else ok('focus stays in the page through every redraw — borrower fields (disclosure kept open), a map point, Record, Sarawak Add and Remove, the drawer\'s Delete and Import', out);
  }
  /* ---- end bugfix3: property ---- */

  /* ---- bugfix4: misc ---- */
  /* M1 — the decision record says which figure carries the tax, and when
          none can. "Figures are after tax" was printed whenever a rate was
          entered: with a tenure of 0 (no interest, so no tax) it read "after
          tax on the rent at 24%, totalling — across the hold" above a row of
          "Not computed"; and with the tax computed, the monthly position and
          the break-even rent it covered are the model's pre-tax figures
          (invariant 2 above holds cashflowMonthly to year one BEFORE tax). */
  {
    const r = JSON.parse(await evaluate(`(() => {
      const kept = State.deal;
      const said = (d) => { State.deal = d; try { return decisionRecordProperty().textContent; } finally { State.deal = kept; } };
      const none = { ...window.__T.base, tenureYears: 0, rent: 3600, marginalTaxPct: 24 };
      const taxed = { ...window.__T.base, tenureYears: 35, rent: 6000, marginalTaxPct: 30 };
      const t0 = said(none), t1 = said(taxed);
      const m1 = dealModel(taxed), m1u = dealModel({ ...taxed, marginalTaxPct: null });
      return JSON.stringify({
        noneClaims: /after tax on the rent at/i.test(t0) || /Figures are after tax/.test(t0),
        noneSays: /No tax on the rent has been computed/.test(t0) && /No figure in this record is after tax/.test(t0),
        taxedClaimsAll: /Figures are after tax/.test(t1),
        taxedSays: /rate of return is after tax on the rent at 30%/.test(t1) && /monthly position and the break-even rent are before tax/.test(t1),
        cfPreTax: m1.cashflowMonthly === m1u.cashflowMonthly && m1.breakEvenRent === m1u.breakEvenRent,
        irrTaxed: isNum(m1.irrPct) && isNum(m1u.irrPct) && m1.irrPct < m1u.irrPct,
      });
    })()`));
    if (r.noneClaims || !r.noneSays) fail('misc: the decision record calls figures after tax when no tax could be computed (tenure 0, rate 24%)', r);
    else if (!r.cfPreTax || !r.irrTaxed) fail('misc: the premise moved — the monthly position or break-even rent now carries the tax, or the rate of return does not', r);
    else if (r.taxedClaimsAll || !r.taxedSays) fail('misc: the decision record says every figure is after tax when only the rate of return is', r);
    else ok('misc: the decision record says no figure is after tax when none can be, and names the rate of return as the one that is', r);
  }

  /* M2 — a reserve that cannot be priced is unknown, not RM0 and not absent.
          With a loan tenure of 0 the ledger read "Cash to keep untouched RM0",
          the grade's gate "No safe reserve is held after completion", the
          loan-readiness buffer scored 100 "against RM121.8k required,
          including the reserve", and the safe-cash totals on the strip, the
          tile ("Including rent-ready and the reserve") and the decision record
          read as whole. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = State.deal;
      const who = { assessed: true, employmentType: 'salaried', verifiedNetMonthlyIncome: 9000, existingMonthlyDebtPayments: 800,
        essentialMonthlyCommitments: 2500, liquidCashAvailable: 150000, incomeStabilityMonths: 36, creditReview: 'not_checked', applicantCount: 1, docs: {} };
      const read = async (d) => {
        const m = dealModel(d), g = propertyGrade(d, m), lr = loanReadiness(who, m);
        State.deal = d; navigate('/property/calculator'); render();
        await new Promise(res => setTimeout(res, 200));
        const tile = (re) => [...document.querySelectorAll('#views .panel')].map(p => p.innerText.replace(/\\n+/g, ' | ')).find(t => re.test(t)) || null;
        const out = { reserveCash: m.reserveCash, gate: (g.gates.find(x => x.id === 'no-reserve') || {}).text || null,
          buffer: lr.scores.buffer, bufferNote: lr.notes.buffer,
          strip: document.querySelector('#views .capstrip')?.innerText.replace(/\\n+/g, ' | ') || null,
          untouched: tile(/^Cash to keep untouched/i), safeTile: tile(/^Safe cash required/i) };
        let rec = '';
        try { rec = decisionRecordProperty().textContent; } finally { State.deal = kept; }
        out.recShort = /So far — short/.test(rec) && /Not the full amount/.test(rec);
        return out;
      };
      const none = await read({ ...window.__T.base, tenureYears: 0 });
      const whole = await read({ ...window.__T.base, tenureYears: 30 });
      State.deal = kept; saveDeal(); render();
      return JSON.stringify({ none, whole });
    })()`));
    const p = [];
    if (r.none.reserveCash !== null) p.push(`reserveCash is ${r.none.reserveCash}, not unknown`);
    if (!r.none.untouched || /RM0\b/.test(r.none.untouched)) p.push(`ledger: ${r.none.untouched}`);
    if (!r.none.gate || /No safe reserve is held/.test(r.none.gate)) p.push(`gate: ${r.none.gate}`);
    if (r.none.buffer !== null || /including the reserve/.test(r.none.bufferNote)) p.push(`buffer ${r.none.buffer}: ${r.none.bufferNote}`);
    /* The strip's labels are eyebrows, upper-cased in the rendered text. */
    if (!/Safe cash required \| [^|]+ \| So far/i.test(r.none.strip || '')) p.push(`strip: ${r.none.strip}`);
    if (!r.none.safeTile || /Including rent-ready and the reserve/.test(r.none.safeTile)) p.push(`tile: ${r.none.safeTile}`);
    if (!r.none.recShort) p.push('the decision record presents the safe cash as whole');
    if (!(r.whole.reserveCash > 0) || !isFinite(r.whole.buffer) || /So far/.test(r.whole.strip || '') || r.whole.recShort
      || !/Including rent-ready and the reserve/.test(r.whole.safeTile || '')) p.push(`a priced reserve is now flagged too: ${JSON.stringify(r.whole)}`);
    if (p.length) fail('misc: an unpriced reserve reads as RM0, as absent, or as a whole total', p);
    else ok('misc: an unpriced reserve (tenure 0) is unknown in the ledger, the gate, the buffer, the strip, the tile and the record; a priced one is unchanged', r.none);
  }

  /* M3 — "Cash to complete" is one figure wherever it is printed. With a
          RM5,000 booking deposit paid at offer, the calculator's strip and
          tile read RM95.3k "Paid out on completion day" and the decision
          record RM90,254 under the same name; the ledger's "Cash still to
          complete" was the record's figure. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = State.deal;
      const d = { ...window.__T.base, bookingDepositPaid: 5000 };
      const m = dealModel(d);
      State.deal = d; navigate('/property/calculator'); render();
      await new Promise(res => setTimeout(res, 200));
      const strip = document.querySelector('#views .capstrip')?.innerText.replace(/\\n+/g, ' | ') || '';
      const tile = [...document.querySelectorAll('#views .panel')].map(p => p.innerText.replace(/\\n+/g, ' | ')).find(t => /^Cash to complete/i.test(t)) || '';
      let rec = '';
      try { rec = [...decisionRecordProperty().querySelectorAll('.dr-fig')].map(f => f.textContent).find(t => /^Cash to complete/.test(t)) || ''; }
      finally { State.deal = kept; saveDeal(); render(); }
      return JSON.stringify({ still: fmtAmount(m.cashStillRequiredToComplete, 'MYR'), whole: fmtAmount(m.transactionCash, 'MYR'),
        stillExact: fmtMoney(m.cashStillRequiredToComplete, 'MYR', 0), strip, tile, rec });
    })()`));
    const stripV = (r.strip.match(/Cash to complete \| ([^|]+)/i) || [])[1]?.trim();
    const tileV = (r.tile.match(/Cash to complete \| ([^|]+)/i) || [])[1]?.trim();
    if (stripV !== r.still || tileV !== r.still || !r.rec.includes(r.stillExact) || r.still === r.whole)
      fail('misc: "Cash to complete" is a different figure on the calculator and in the decision record once a booking deposit is paid', { stripV, tileV, ...r });
    else ok(`misc: "Cash to complete" reads ${r.still} on the strip, the tile and the record with RM5,000 paid at offer (the whole completion figure is ${r.whole})`);
  }
  /* ---- end bugfix4: misc ---- */
  /* ---- bugfix5: views ---- */
  /* V1 — the landing page's property card is the calculator's figure, and a
          short total says so. With RM5,000 paid at offer the card read "Cash
          to complete RM95.3k", the whole completion figure, beside a
          calculator and record at RM90.3k. With the reserve unpriced (tenure
          0) it printed "Safe cash RM121.8k" as the answer the calculator
          calls "so far". Completion is short only by an acquisition or
          financing line — one is unset in the fee registry for the last
          case, and put back. The card moved with the other examples from
          the homepage to /how-it-works (Release A), where it is one of three
          proof cards, so it is found by its title rather than its place. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = State.deal;
      const card = async (d) => {
        State.deal = d; navigate('/how-it-works'); render();
        await new Promise(res => setTimeout(res, 200));
        const c = [...document.querySelectorAll('#views .proof-card')].find(x => /^Sarawak property/.test(x.querySelector('.proof-hd')?.textContent || ''));
        const m = dealModel(d);
        const pk = c ? [...c.querySelectorAll('.pk')].map(x => x.textContent) : [];
        const pv = c ? [...c.querySelectorAll('.pv')].map(x => x.textContent) : [];
        return { pk, pv, still: fmtAmount(m.cashStillRequiredToComplete, 'MYR'), whole: fmtAmount(m.transactionCash, 'MYR'),
          safe: fmtAmount(m.safeCashRequired, 'MYR'), missing: (m.missingCostLines || []).map(x => x.groupId) };
      };
      const line = FEE_TABLE.lines.disbursements, was = line.status;
      let paid, unpriced, whole, noFee;
      try {
        paid = await card({ ...window.__T.base, bookingDepositPaid: 5000 });
        unpriced = await card({ ...window.__T.base, bookingDepositPaid: 5000, tenureYears: 0 });
        whole = await card({ ...window.__T.base, tenureYears: 30 });
        line.status = 'unset';
        noFee = await card({ ...window.__T.base, tenureYears: 30 });
      } finally { line.status = was; State.deal = kept; saveDeal(); render(); }
      return JSON.stringify({ paid, unpriced, whole, noFee });
    })()`));
    const p = [];
    const { paid, unpriced, whole, noFee } = r;
    if (paid.pk[0] !== 'Cash to complete' || paid.pv[0] !== paid.still || paid.still === paid.whole)
      p.push(`RM5,000 paid: card "${paid.pk[0]} ${paid.pv[0]}", calculator ${paid.still}, whole ${paid.whole}`);
    if (unpriced.pk[1] !== 'Safe cash so far' || unpriced.pv[1] !== unpriced.safe || unpriced.pk[0] !== 'Cash to complete')
      p.push(`reserve unpriced (${unpriced.missing.join(', ')}): card "${unpriced.pk[0]}" / "${unpriced.pk[1]} ${unpriced.pv[1]}"`);
    if (whole.missing.length || whole.pk[0] !== 'Cash to complete' || whole.pk[1] !== 'Safe cash' || whole.pv[0] !== whole.whole)
      p.push(`a priced deal is flagged or moved: ${JSON.stringify(whole)}`);
    if (!noFee.missing.includes('acquisition') || noFee.pk[0] !== 'Cash to complete so far' || noFee.pk[1] !== 'Safe cash so far')
      p.push(`an unset acquisition fee: card "${noFee.pk[0]}" / "${noFee.pk[1]}" (${noFee.missing.join(', ')})`);
    if (p.length) fail('views: the property card on /how-it-works prints a different cash to complete from the calculator, or a short total as whole', p);
    else ok(`views: the property card on /how-it-works reads ${paid.still} to complete with RM5,000 paid at offer, and marks a total with an unpriced line "so far"`);
  }
  /* ---- end bugfix5: views ---- */

  /* ---- bugfix: property-focus ---- */
  /* F4 — typing after Tab replaces the next field's figure, and typing after
          Enter goes on the end. A field's change redraws the page a tick
          later (renderAfterTyping) and focus was handed back to the new
          field with the caret at its start and nothing selected: Tab from
          the floor area to the land area, which selects the land area's 0,
          then 77, recorded 770 — a price retyped the same way would have
          read 600000572000 — and 600000 then Enter, then 1, read 1600000.
          Driven with real key events, because the defect is between them. */
  {
    const key = async (k, code, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code }, sessionId);
    };
    const typeIn = async (t) => { for (const ch of t) { await key(ch, ch.charCodeAt(0), ch); await sleep(40); } };
    await evaluate(`(() => { window.__T.f3 = JSON.parse(JSON.stringify(State.deal)); navigate('/property/calculator'); return true; })()`);
    await sleep(600);
    await evaluate(`(() => { const n = document.getElementById('d-sqft'); n.scrollIntoView({ block: 'center' }); n.focus(); n.select(); return true; })()`);
    await typeIn('1100');
    await key('Tab', 9); await sleep(300);
    const next = await evaluate(`JSON.stringify({ id: document.activeElement?.id || document.activeElement?.tagName, was: document.activeElement?.value })`);
    await typeIn('77'); await sleep(100);
    const tabbed = JSON.parse(await evaluate(`JSON.stringify({ ...${next}, now: document.activeElement?.value, sqft: State.deal.sqft })`));
    await evaluate(`(() => { const n = document.getElementById('d-price'); n.scrollIntoView({ block: 'center' }); n.focus(); n.select(); return true; })()`);
    await typeIn('600000');
    await key('Enter', 13, '\r'); await sleep(300);
    await typeIn('1'); await sleep(100);
    const entered = JSON.parse(await evaluate(`JSON.stringify({ at: document.activeElement?.id, now: document.activeElement?.value, price: State.deal.price })`));
    await evaluate(`(() => { document.activeElement?.blur(); State.deal = window.__T.f3; saveDeal(); render(); return true; })()`);
    const p = [];
    if (tabbed.sqft !== 1100) p.push(`the floor area typed as 1100 recorded ${tabbed.sqft}`);
    if (tabbed.now !== '77') p.push(`Tab to ${tabbed.id} (reading ${tabbed.was}), then 77, reads ${tabbed.now}`);
    if (entered.price !== 600000 || entered.at !== 'd-price' || entered.now !== '6000001') p.push(`600000, Enter, then 1 in the price reads ${entered.now} on ${entered.at} (recorded ${entered.price})`);
    if (p.length) fail('focus: a field redrawn after a change loses its caret, and typing lands at the start of the figure', p);
    else ok(`focus: Tab then typing replaces the next field's figure (${tabbed.id}: 77), and Enter keeps the caret at the end of the price (6000001)`);
  }
  /* F5 — Unlock and Restore hand focus on. Each redrew the page with plain
          render() and went itself — the offer is replaced by the report, and
          Restore goes once the deal is back — so focus fell to <body> and a
          keyboard reader started again from the top of the calculator. */
  {
    const at = () => evaluate(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY';
      return (a.id || a.tagName) + ':' + a.textContent.trim().slice(0, 32) + (a.closest('#property-report-full') ? ' (in the report)' : ''); })()`);
    const pressLabelled = async (label) => {
      const found = await evaluate(`(() => { const b = [...document.querySelectorAll('main button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(label)}));
        if (!b) return false; b.scrollIntoView({ block: 'center' }); b.focus(); return true; })()`);
      if (!found) return `no "${label}" button`;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13 }, sessionId);
      await sleep(400);
      return at();
    };
    await evaluate(`(() => { window.__T.f5 = { deal: JSON.parse(JSON.stringify(State.deal)), bought: localStorage.getItem('vl.propertyReportsBought'), before: localStorage.getItem('vl.dealBeforeLink') };
      State.propertyReportsBought = []; store.write('propertyReportsBought', []); navigate('/property/calculator'); return true; })()`);
    await sleep(600);
    const unlocked = await pressLabelled('Preview this report');
    await evaluate(`(() => { store.write('dealBeforeLink', { ...State.deal, price: 500000 }); render(); return true; })()`);
    await sleep(300);
    const restored = await pressLabelled('Restore my previous deal');
    const price = await evaluate('State.deal.price');
    await evaluate(`(() => { const k = window.__T.f5; const put = (key, v) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v);
      put('propertyReportsBought', k.bought); put('dealBeforeLink', k.before); State.propertyReportsBought = store.read('propertyReportsBought', []);
      State.deal = k.deal; saveDeal(); render(); return true; })()`);
    const p = [];
    if (!/ \(in the report\)$/.test(unlocked) || !unlocked.startsWith('H3:')) p.push(`Unlock → ${unlocked}`);
    if (!restored.startsWith('property-copy-link:') || price !== 500000) p.push(`Restore → ${restored} (the deal's price ${price})`);
    if (p.length) fail('focus: Unlock or Restore on the calculator drops focus on <body>', p);
    else ok(`focus: Unlock hands focus to the report (${unlocked}), Restore to the link control beside it`);
  }
  /* F6 — what is typed into the calculator's "record what you observed"
          form survives a redraw until Record takes it. The fields were the
          only copy, and any redraw — a deal field changed above them, the
          filings landing — drew them empty. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = { deal: JSON.parse(JSON.stringify(State.deal)), obs: localStorage.getItem('vl.observations'), log: localStorage.getItem('vl.registerLog') };
      navigate('/property/calculator'); await new Promise(res => setTimeout(res, 400));
      const q = (l) => document.querySelector('main [aria-label="' + l + '"]');
      const set = (l, v) => { const n = q(l); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
      set('What you observed', 'land-sold'); set('Observed value', '880000'); set('Land area', '4'); set('Source reference', 'SPA 7');
      set('Address or project', 'Lot 12');
      const read = () => ['What you observed', 'Observed value', 'Land area', 'Unit the area is in', 'Source reference', 'Address or project'].map(l => q(l)?.value);
      const typed = read();
      const t = document.getElementById('dealType'); t.value = [...t.options].find(o => o.value !== t.value).value; t.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(res => setTimeout(res, 200));
      const redrawn = read();
      const before = State.observations.length;
      document.getElementById('obs-record').click();
      await new Promise(res => setTimeout(res, 200));
      const rec = State.observations[0];
      const after = read();
      const put = (key, v) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v);
      put('observations', kept.obs); put('registerLog', kept.log); State.observations = store.read('observations', []); loadRegisterLog();
      State.deal = kept.deal; saveDeal(); render();
      return JSON.stringify({ typed, redrawn, added: State.observations.length === before ? 0 : 1, rec: rec && { kind: rec.kind, value: rec.value, landSqft: rec.landSqft, landUnit: rec.landUnit, sourceRef: rec.sourceRef, address: rec.address }, after });
    })()`));
    const p = [];
    if (JSON.stringify(r.redrawn) !== JSON.stringify(r.typed)) p.push(`typed ${JSON.stringify(r.typed)}, and after the property type changed the form read ${JSON.stringify(r.redrawn)}`);
    if (!r.rec || r.rec.kind !== 'land-sold' || r.rec.value !== 880000 || r.rec.landUnit !== r.typed[3] || r.rec.sourceRef !== 'SPA 7' || r.rec.address !== 'Lot 12')
      p.push(`Record after the redraw recorded ${JSON.stringify(r.rec)}`);
    if (r.after[1] !== '' || r.after[4] !== '') p.push(`the form still reads ${JSON.stringify(r.after)} after Record`);
    if (p.length) fail('state: the calculator\'s observation form is emptied by a redraw before Record', p);
    else ok(`state: the observation form keeps what was typed (${r.typed.slice(0, 3).join(', ')} ${r.typed[3]}) through a redraw, Record records it, and the form is empty after`);
  }
  /* F7 — the Cash Wheel's close debit, commission and roll figures survive a
          redraw until the transition reads them. They were drawn at 0 on
          every redraw, so a close debit of 1.20 and a commission of 0.65,
          then a contract field corrected above them, recorded the buy-back
          as free: realised result overstated by $120.65 on 100 shares. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = { wheel: JSON.parse(JSON.stringify(State.wheel)), legs: JSON.parse(JSON.stringify(State.wheelLegs || [])) };
      const tick = () => new Promise(res => setTimeout(res, 150));
      navigate('/us-options/wheel'); await tick();
      State.wheel = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true, state: 'candidate' }; State.wheelLegs = []; saveWheel(); saveWheelLegs(); render(); await tick();
      const btn = (t) => [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === t);
      const type = (id, v) => { const n = document.getElementById(id); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
      const correct = () => { const f = document.querySelector('#wheel-inputs input[type=number]'); f.value = String(Number(f.value) + 1); f.dispatchEvent(new Event('change', { bubbles: true })); };
      btn('Start a cycle').click(); await tick();
      btn('Record the put as opened').click(); await tick();
      type('r-debit', '0.40');
      type('w-closedebit', '1.20'); type('w-closecomm', '0.65');
      correct(); await tick();
      const shown = ['w-closedebit', 'w-closecomm', 'r-debit'].map(id => document.getElementById(id)?.value);
      const rollOpen = !!document.getElementById('r-debit')?.closest('details')?.open;
      btn('I bought it back').click(); await tick();
      const close = State.wheelLegs.find(l => l.action === 'close');
      const out = { shown, rollOpen, closeCash: close?.netCash ?? null, shares: close?.shares ?? null };
      State.wheel = kept.wheel; State.wheelLegs = kept.legs; saveWheel(); saveWheelLegs(); render();
      return JSON.stringify(out);
    })()`));
    const p = [];
    if (r.shown.join() !== '1.20,0.65,0.40') p.push(`after a contract field was corrected the figures read ${r.shown.join(', ')} (typed 1.20, 0.65, 0.40)`);
    if (!r.rollOpen) p.push('the roll, holding a typed figure, came back closed');
    if (r.closeCash !== -(1.20 * r.shares + 0.65)) p.push(`"I bought it back" recorded a closing cash of ${r.closeCash} for ${r.shares} shares`);
    if (p.length) fail('state: the Cash Wheel records a buy-back with figures a redraw set to 0', p);
    else ok(`state: the Cash Wheel keeps a typed close debit and commission through a redraw, and records the buy-back at ${r.closeCash}`);
  }
  /* F8 — a Sarawak exposure record open for editing stays open when another
          is added or removed. Add and Remove redraw the page, and every
          record came back closed. */
  {
    const r = JSON.parse(await evaluate(`(async () => {
      const kept = localStorage.getItem('vl.sarawakExposure');
      const tick = () => new Promise(res => setTimeout(res, 200));
      State.sarawakExposure = []; saveExposures(); navigate('/discover/sarawak'); await tick();
      const add = (i) => { const s = document.querySelector('main select[aria-label="Company"]'); s.selectedIndex = i; s.dispatchEvent(new Event('change', { bubbles: true })); document.getElementById('swk-add').click(); };
      const openOf = (rec) => !!document.getElementById(swkRecordId(rec))?.parentElement.open;
      add(0); await tick();
      document.getElementById(swkRecordId(State.sarawakExposure[0])).parentElement.open = true;
      add(1); await tick(); add(2); await tick();
      const afterAdd = State.sarawakExposure.map(openOf);
      const [first, second, third] = State.sarawakExposure;
      [...document.getElementById(swkRecordId(second)).parentElement.querySelectorAll('button')].find(b => b.textContent.trim() === 'Remove').click();
      await tick();
      const afterRemove = { first: openOf(first), third: openOf(third), n: State.sarawakExposure.length };
      if (kept == null) localStorage.removeItem('vl.sarawakExposure'); else localStorage.setItem('vl.sarawakExposure', kept);
      State.sarawakExposure = store.read('sarawakExposure', []); render();
      return JSON.stringify({ afterAdd, afterRemove });
    })()`));
    if (r.afterAdd.join() !== 'true,false,false' || !r.afterRemove.first || r.afterRemove.third || r.afterRemove.n !== 2)
      fail('state: a Sarawak exposure record open for editing closes when another is added or removed', r);
    else ok('state: a Sarawak exposure record open for editing stays open through two Adds and a Remove, and the others stay closed');
  }
  /* ---- end bugfix: property-focus ---- */

  /* ---- fixwave: shell ---- */
  /* THE SITE HUNT OF 2026-09-29, ON THE CALCULATOR (fixwave: shell). Both
     failed on 0e1119b. P4 — "Weeks a year you would use it yourself" redraws
     the page from its change, which fires as Tab or Shift+Tab leaves it:
     nothing held focus at that moment, so render() had nothing to give back,
     and focus fell to <body>. P14 — the dock's "Review N sample inputs"
     opened its list and left focus on the dock, so the next Tab went on into
     the footer. Driven with real key events. */
  {
    const key = async (k, code, text, shift = false) => {
      const modifiers = shift ? 8 : 0;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}), modifiers }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code, modifiers }, sessionId);
      await sleep(40);
    };
    const DESC = `((a) => !a || a === document.body ? 'BODY' : a.id === 'main' ? 'MAIN' : (a.id || a.tagName + ':' + (a.getAttribute('aria-label') || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40)))`;
    const STOPS = `[...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]')]
      .filter(n => n.tabIndex >= 0 && n.getClientRects().length && !n.closest('[inert]'))`;
    await evaluate(`(() => { window.__T.fw = JSON.parse(JSON.stringify(State.deal)); navigate('/property/calculator'); return true; })()`);
    await sleep(700);
    const p = [];
    for (const [typed, shift] of [['3', false], ['5', true]]) {
      const want = await evaluate(`(() => { const n = document.getElementById('ownUseWeeks'); if (!n) return null; n.scrollIntoView({ block: 'center' }); n.focus(); n.select();
        const s = ${STOPS}; return ${DESC}(s[s.indexOf(n) + (${shift} ? -1 : 1)]); })()`);
      if (!want) { p.push('no "Weeks a year you would use it yourself" field'); break; }
      await key(typed, typed.charCodeAt(0), typed);
      await key('Tab', 9, '', shift); await sleep(400);
      const got = JSON.parse(await evaluate(`JSON.stringify({ at: ${DESC}(document.activeElement), weeks: State.deal.ownUseWeeks })`));
      if (got.at !== want || got.weeks !== Number(typed)) p.push(`${typed} typed, then ${shift ? 'Shift+Tab' : 'Tab'}: focus ${got.at}, not ${want}; recorded ${got.weeks}`);
    }
    const dockBtn = await evaluate(`(() => { const b = [...document.querySelectorAll('body > .dock button')].find(x => /^Review \\d+ sample input/.test(x.textContent.trim())); if (!b) return false; b.focus(); return document.activeElement === b; })()`);
    if (!dockBtn) p.push('no "Review N sample inputs" in the dock');
    else {
      await key('Enter', 13, '\r'); await sleep(200);
      /* The page scrolls to the list smoothly, for longer the further it goes. */
      for (let i = 0, y = null; i < 40; i++) { const now = await evaluate('scrollY'); if (now === y) break; y = now; await sleep(150); }
      const opened = JSON.parse(await evaluate(`JSON.stringify((() => { const a = document.activeElement, det = a?.closest?.('details'), r = a.getBoundingClientRect();
        const dock = document.querySelector('body > .dock')?.getBoundingClientRect().top ?? innerHeight;
        return { at: ${DESC}(a), inList: !!det && det.open && /Review \\d+ sample input/.test(det.querySelector('summary')?.textContent || ''), seen: r.top >= 0 && r.bottom <= dock }; })())`));
      await key('Tab', 9, ''); await sleep(200);
      const next = JSON.parse(await evaluate(`JSON.stringify({ at: ${DESC}(document.activeElement), inList: !!document.activeElement.closest('details') && /Review \\d+ sample input/.test(document.activeElement.closest('details').querySelector('summary')?.textContent || '') })`));
      if (!opened.inList || !opened.seen || !next.inList) p.push(`Enter on the dock's review button: focus ${opened.at}${opened.inList ? ' in the list' : ''}${opened.seen ? '' : ', out of sight'}; the next Tab: ${next.at}${next.inList ? ' in the list' : ''}`);
    }
    await evaluate(`(() => { document.activeElement?.blur(); State.deal = window.__T.fw; saveDeal(); render(); return true; })()`);
    if (p.length) fail('fixwave: shell — on the calculator, Tab past a field that redraws, and the dock\'s review button, leave focus where the reader cannot use it', p);
    else ok('fixwave: shell — Tab and Shift+Tab past "Weeks a year you would use it yourself" move one stop on after the redraw, and the dock\'s review button takes focus into the list it opens');
  }
  /* ---- end fixwave: shell ---- */
  /* ---- fixwave: property ---- */
  /* The property findings of the 2026-09-29 hunt. Each check is named by its
     finding and states the rule the page broke, so a failure here reads as
     the defect rather than as a changed number. */
  const fwKeep = (keys) => evaluate(`(() => { window.__fwKept = { deal: JSON.parse(JSON.stringify(State.deal)),
    lang: State.lang, store: Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, localStorage.getItem('vl.' + k)])) }; return true; })()`);
  const fwPut = () => evaluate(`(() => { const k = window.__fwKept;
    Object.entries(k.store).forEach(([key, v]) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v));
    State.observations = store.read('observations', []); State.opportunities = store.read('opportunities', []);
    State.propertyReportsBought = store.read('propertyReportsBought', []); State.areaProfiles = store.read('areaProfiles', {});
    if (typeof loadRegisterLog === 'function') loadRegisterLog();
    State.lang = k.lang; State.deal = k.deal; saveDeal(); navigate('/property/calculator'); return true; })()`);
  const FW_KEYS = ['observations', 'registerLog', 'opportunities', 'propertyReportsBought', 'areaProfiles', 'lang', 'deal', 'borrowerProfile'];

  /* P18 — one month of reserve reads "1 month", and P9 — with no instalment
          (a loan tenure of 0) the burn and the three- and six-month figures
          are not computed. The null instalment was added as nought, so a
          RM514,800 loan contributed nothing and the paragraph printed
          "burns RM0 a month … 6 months with no rent is RM2.5k" beside a tile
          saying the reserve could not be priced. */
  {
    await fwKeep(FW_KEYS);
    const r = await evaluate(`(async () => {
      const tick = (ms = 250) => new Promise(res => setTimeout(res, ms));
      const base = window.__fwKept.deal;
      const tile = () => ([...document.querySelectorAll('main .panel')].map(p => p.textContent).find(t => t.startsWith('Cash to keep untouched')) || '');
      const para = () => document.getElementById('d-reserveMonths')?.closest('.row')?.querySelector('p')?.textContent || '';
      navigate('/property/calculator'); await tick(400);
      State.deal = { ...base, reserveMonths: 1 }; saveDeal(); render(); await tick();
      const one = tile();
      State.deal = { ...base, tenureYears: 0 }; saveDeal(); render(); await tick();
      const m = dealModel(State.deal);
      return { one, para: para(), loan: m.loan, instalment: m.instalment, burnWithRent: m.burnWithRent, burnWithoutRent: m.burnWithoutRent,
        scen: m.reserveScenarios.map(s => [s.noRent, s.stressedRent]) };
    })()`);
    await fwPut();
    if (!/(^|\D)1 month of instalment/.test(r.one) || /(^|\D)1 months\b/.test(r.one)) fail('fixwave P18: one month of reserve is written "1 months"', r.one.slice(0, 120));
    else ok('fixwave P18: a reserve of one month reads "1 month of instalment"');
    const p = [];
    if (r.burnWithRent !== null || r.burnWithoutRent !== null) p.push(`burns ${r.burnWithRent} with rent and ${r.burnWithoutRent} without, on a RM${r.loan} loan with no instalment`);
    if (r.scen.some(s => s.some(v => v !== null))) p.push(`reserve scenarios ${JSON.stringify(r.scen)}`);
    if (/burns RM|months with no rent is RM/.test(r.para)) p.push(`the paragraph reads "${r.para.slice(0, 160)}"`);
    if (p.length) fail('fixwave P9: with a loan tenure of 0 the reserve paragraph prices a burn that leaves the loan out', p);
    else ok(`fixwave P9: with no instalment the burn and the reserve scenarios are not computed, and the paragraph says so ("${r.para.slice(0, 70)}…")`);
  }

  /* P11 — "Application structure" is not scored from nothing. It scored 70
           as soon as an income existed, with a basis that said the applicant
           count and tenure fit were "recorded"; the page has no control for
           either. */
  {
    const r = await evaluate(`(() => {
      const lr = loanReadiness({ assessed: true, employmentType: 'salaried', verifiedNetMonthlyIncome: 9000, creditReview: 'not_checked',
        applicantCount: 1, docs: {} }, dealModel(window.__T.base));
      const c = lr.components.find(x => x.k === 'structure');
      return { score: c.score, note: c.note };
    })()`);
    if (r.score !== null || /\brecorded\b/.test(r.note)) fail('fixwave P11: application structure is scored, or said to be recorded, with no input for it', r);
    else ok(`fixwave P11: application structure is not tested — "${r.note.slice(0, 80)}…"`);
  }

  /* Also found — the loan-readiness note agrees with the total beside it.
     With only the liquid buffer open (a cost line unpriced), the tile showed
     a total and the note under the table said "A total is withheld while
     any of these is open". */
  {
    await fwKeep(FW_KEYS);
    const r = await evaluate(`(async () => {
      const line = FEE_TABLE.lines.disbursements, was = line.status;
      const keptB = JSON.parse(JSON.stringify(State.borrower));
      try {
        line.status = 'unset';
        Object.assign(State.borrower, { assessed: true, verifiedNetMonthlyIncome: 15000, creditReview: 'none_reported', incomeStabilityMonths: 36, liquidCashAvailable: 200000 });
        navigate('/property/calculator'); await new Promise(res => setTimeout(res, 450));
        const lr = loanReadiness(State.borrower, dealModel(State.deal));
        const note = [...document.querySelectorAll('main p')].map(p => p.textContent).find(t => t.startsWith('Not assessed:')) || '';
        return { score: lr.score, unknowns: lr.unknowns, note };
      } finally {
        line.status = was;
        Object.keys(State.borrower).forEach(k => delete State.borrower[k]); Object.assign(State.borrower, keptB);
      }
    })()`);
    await fwPut();
    if (typeof r.score !== 'number' || r.unknowns.join() !== 'liquid buffer' || !r.note || /A total is withheld/.test(r.note))
      fail('fixwave (also found): the loan-readiness note says a total is withheld beside the total it shows', r);
    else ok(`fixwave (also found): with only the buffer open the readiness total ${r.score}/100 is shown and the note says it is weighted over what was tested`);
  }

  /* P13 — the leasehold question can be answered, and an answer that
           establishes nothing earns nothing. It asked "how many years remain
           and has extension been applied for?" and took Yes or No; with no
           adverse answer, either one moved the local-demand pillar from 0 to
           10 as "settled without an adverse finding". */
  {
    const r = await evaluate(`(() => {
      const q = SARAWAK_CHECKS.find(c => c.id === 'lease-remaining');
      const at = (a) => { const d = { ...window.__T.base, checks: a ? { 'lease-remaining': a } : {} }; const m = dealModel(d);
        return { demand: propertyGrade(d, m).scores.demand, flagged: !!q.flag && propertyRiskFlags(d, m).some(f => f.t === q.flag) }; };
      return { q: q.q, adverse: q.adverse, none: at(null), yes: at('yes'), no: at('no'), unsure: at('unknown') };
    })()`);
    const answered = r.adverse ? (r.adverse === 'yes' ? r.no : r.yes) : null;
    const against = r.adverse ? r[r.adverse] : null;
    if (!r.adverse || against.demand !== r.none.demand || !against.flagged || r.none.flagged || !(answered.demand > r.none.demand))
      fail('fixwave P13: an answer to the leasehold question that establishes nothing still earns local-demand credit', r);
    else ok(`fixwave P13: "${r.q}" — "${r.adverse}" earns nothing and raises a flag, the other answer settles it`);
  }

  /* P8 — the environmental allowance follows the asset. A bare parcel was
          charged for roof membranes, repainting, windows and furniture, and
          the furniture fit-out that "applies only where the letting is
          furnished" was added to every total, although no furnished input
          exists — so a cash parcel with no outgoings failed Net economics on
          the allowance alone. */
  {
    const r = await evaluate(`(() => {
      const k = 'sibu|Town centre'; const had = State.areaProfiles[k];
      State.areaProfiles[k] = { flood: { class: 'recurrent' }, coastal: { class: 'saline' } };
      try {
        const at = (x) => ({ ...window.__T.base, city: 'sibu', district: 'Town centre', projectId: customProjectId('sibu'), ...x });
        const land = environmentalAllowance(at({ propertyType: 'Land' }));
        const flat = environmentalAllowance(at({}));
        const fit = flat.items.find(i => i.id === 'fitout');
        const others = flat.items.filter(i => i.id !== 'fitout').reduce((s, i) => s + i.annual, 0);
        const cash = at({ propertyType: 'Land', downPct: 100, assessment: 0, quitRent: 0, insurance: 0, maintenance: 0, sinkingFund: 0 });
        const m = dealModel(cash);
        const net = propertyIpsAnswers(cash, m, propertyGrade(cash, m)).find(a => a.id === 'net');
        return { landAnnual: land.annual, landItems: land.items.map(i => i.id), flatAnnual: flat.annual, others, fit: fit && { annual: fit.annual, offered: !!fit.offered },
          net: net && { verdict: net.verdict.label, failed: net.verdict === IPS_VERDICTS.fail, why: net.why } };
      } finally { if (had) State.areaProfiles[k] = had; else delete State.areaProfiles[k]; }
    })()`);
    const p = [];
    if (r.landAnnual !== 0 || r.landItems.length) p.push(`a bare parcel is charged RM${Math.round(r.landAnnual)} a year (${r.landItems.join(', ')})`);
    if (Math.abs(r.flatAnnual - r.others) > 0.5) p.push(`the condominium's total RM${Math.round(r.flatAnnual)} includes fit-out RM${Math.round(r.fit?.annual || 0)} for a furnished letting nobody entered`);
    if (!r.fit || !r.fit.offered) p.push('fit-out is not offered beside the total');
    if (!r.net || r.net.failed) p.push(`a cash parcel with no outgoings: Net economics ${r.net?.verdict} — ${r.net?.why}`);
    if (p.length) fail('fixwave P8: the environmental allowance charges building items to land, or furnished fit-out to every letting', p);
    else ok(`fixwave P8: land carries no building allowance, fit-out is offered and kept out of the RM${Math.round(r.flatAnnual)} total, and a cash parcel with no outgoings passes Net economics`);
  }

  /* P16 — the words match the figures. The negative-cash-flow flag said the
           monthly cost was "before any repairs or void periods" when it is
           after the vacancy allowance and the repair reserve; the rent-or-buy
           tile called 7% of the whole initial cash what "the deposit is not
           earning". */
  /* P12 — a class with no tenancy is not described in tenancy terms. The
           page withholds rent, vacancy, yield and cover for land, and went on
           to say the shortfall was "in the price against the rent", that the
           entered vacancy was "the figure every output above uses", that "the
           price and the rent drive every output", and listed the rent and the
           maintenance as illustrative defaults. */
  {
    await fwKeep(FW_KEYS);
    const r = await evaluate(`(async () => {
      const tick = (ms = 300) => new Promise(res => setTimeout(res, ms));
      const base = window.__fwKept.deal;
      const draw = async (deal) => {
        State.deal = { ...deal, touched: {}, evidence: { ...(deal.evidence || {}) } };
        State.propertyReportsBought = [...(State.propertyReportsBought || []), State.deal.projectId];
        store.write('propertyReportsBought', State.propertyReportsBought);
        saveDeal(); navigate('/property/calculator'); await tick(450);
        return document.querySelector('main').innerText;
      };
      const flat = await draw(base);
      const m = dealModel(State.deal);
      const trueCost = [...document.querySelectorAll('main .panel')].map(p => p.textContent).find(t => t.startsWith('True cost to own')) || '';
      const land = await draw({ ...base, propertyType: 'Land' });
      const lm = dealModel(State.deal), lg = propertyGrade(State.deal, lm);
      const evRail = [...document.querySelectorAll('main select[id^="ev-"]')].map(s => s.id);
      const evCard = [...document.querySelectorAll('main .card')].find(c => /What this rests on/.test(c.querySelector('h2,h3')?.textContent || ''));
      const evRows = evCard ? [...evCard.querySelectorAll('tbody tr')].map(tr => tr.cells[0].textContent) : null;
      return { flag: /before any repairs or void periods/.test(flat), trueCost, committed: fmtMoney(m.totalInitialCash, 'MYR', 0),
        landSaid: ['in the price against the rent', 'that is the figure every output above uses', 'the price and the rent drive every output', 'deepest vacancy']
          .filter(s => land.includes(s) || (lg.notes.downside || '').includes(s)),
        negativeAtBest: lm.negativeAtBest, evRail, evRows };
    })()`);
    await fwPut();
    const p16 = [];
    if (r.flag) p16.push('the negative cash flow flag says "before any repairs or void periods"');
    if (/the deposit is not earning/.test(r.trueCost) || !r.trueCost.includes(r.committed)) p16.push(`"${r.trueCost}" (the cash put in is ${r.committed})`);
    if (p16.length) fail('fixwave P16: a sentence on the calculator contradicts the figure it describes', p16);
    else ok(`fixwave P16: the flag is after the vacancy allowance and repair reserve, and the opportunity cost is on the ${r.committed} put in`);
    const p12 = [];
    if (r.landSaid.length) p12.push(`land is described as: ${r.landSaid.join(' | ')}`);
    if (!r.negativeAtBest) p12.push('the land deal was not negative at best, so the structural-shortfall sentence was not reached');
    if (r.evRail.includes('ev-rent') || r.evRail.includes('ev-maintenance')) p12.push(`the rail grades ${r.evRail.join(', ')}`);
    if (!r.evRows || r.evRows.some(x => /rent|Maintenance/i.test(x))) p12.push(`"What this rests on" lists ${JSON.stringify(r.evRows)}`);
    if (p12.length) fail('fixwave P12: a land parcel is described in the tenancy terms the page says it withholds', p12);
    else ok(`fixwave P12: a land parcel's shortfall, vacancy note, evidence rows and downside note name no tenancy (evidence: ${r.evRows.join(', ')})`);
  }

  /* P17 — the language note says what is translated, and it is. In Bahasa
           Malaysia the note said input labels and evidence grades were
           translated while 24 of the rail's labels and every "Illustrative
           default" stayed English. */
  {
    await fwKeep(FW_KEYS);
    const r = await evaluate(`(async () => {
      const tick = (ms = 300) => new Promise(res => setTimeout(res, ms));
      navigate('/property/calculator'); await tick(400);
      /* Every section's column of inputs. The calculator's inputs sit in five
         columns since it was sectioned (audit1/property-model), and the first
         alone was read: Acquisition's 15 of the 50 labels, and none of the
         evidence grades, which are in Report's. */
      const inRails = (sel) => [...document.querySelectorAll('main .rail-sticky')].flatMap(r => [...r.querySelectorAll(sel)]);
      const labels = () => Object.fromEntries([
        ...[...inRails('label[for]')].map(l => [l.htmlFor, l.textContent.trim()]),
        ...[...inRails('label.checkline')].map(l => [l.querySelector('input')?.id, l.textContent.trim()])]);
      State.lang = 'en'; render(); await tick();
      const en = labels();
      State.lang = 'ms'; render(); await tick();
      const ms = labels();
      const evOpts = [...inRails('select[id^="ev-"] option')].map(o => o.textContent);
      const same = Object.keys(en).filter(id => ms[id] === en[id]
        && !Object.values(PROPERTY_I18N).some(e => e.en === en[id] && e.ms === e.en));
      const secOf = (id) => (id && document.getElementById(id)?.closest('section.pc-sec')?.id) || null;
      const secsRead = [...new Set(Object.keys(en).map(secOf).filter(Boolean))];
      const secsWithLabels = [...new Set([...document.querySelectorAll('main section.pc-sec .pc-inputs label')].map(l => l.closest('section.pc-sec').id))];
      return { secsRead, secsWithLabels, n: Object.keys(en).length, same: same.map(id => en[id]), englishGrades: evOpts.filter(t => EVIDENCE.some(e => e.label === t)),
        evN: evOpts.length, note: (SUMMARY_COPY.ms || {}).note };
    })()`);
    await fwPut();
    /* And it reads what it names: the labels of every section that asks for
       something, and the evidence grades — a check of none of them passes
       whatever they say. */
    if (!r.evN || r.secsRead.length < r.secsWithLabels.length) fail(`fixwave P17: the check read the labels of ${r.secsRead.join(', ') || 'no section'} of the sections with inputs (${r.secsWithLabels.join(', ')}) and ${r.evN} evidence grades`);
    else if (r.same.length || r.englishGrades.length) fail(`fixwave P17: in Bahasa Malaysia the note says "${r.note}", and ${r.same.length} of ${r.n} rail labels and ${r.englishGrades.length} evidence grades are English`,
      [...r.same.slice(0, 8), ...new Set(r.englishGrades)]);
    else ok(`fixwave P17: every one of the rail's ${r.n} labels and its evidence grades read in Bahasa Malaysia, as its note says`);
  }

  /* P5 — a register record opens in the calculator at one of its city's
          districts. A blank district put null into the deal ("Demand — null",
          "No sourced transactions recorded in null"), with the select showing
          "City centre" and the district panel listing the whole city; a free
          text district the city does not list was modelled while the select
          showed another, and the link carried a district the recipient could
          not match. */
  {
    await fwKeep(FW_KEYS);
    const r = await evaluate(`(async () => {
      const tick = (ms = 300) => new Promise(res => setTimeout(res, ms));
      const rec = (id, name, city, district) => ({ id, name, source: '', state: 'captured', capturedAt: '2026-09-01',
        availabilityCheckedAt: null, available: null,
        deal: { city, district, propertyType: 'Condominium', price: 0, sqft: 0, projectId: customProjectId(city), bankValuation: 0, titleType: 'unknown' },
        touched: {}, evidence: {}, negotiatedPrice: null, valuerEstimate: null, nextAction: '', nextActionOwner: '', nextActionDue: '' });
      State.opportunities = [rec('opp-fw-a', 'FW blank district', 'kuching', null), rec('opp-fw-b', 'FW free text', 'sibu', 'Jalan Pedada')];
      saveOpportunities();
      addObservation({ city: 'kuching', area: 'Stutong', kind: 'ask-rent', value: 1700, evidence: 'user', date: '2026-09-01' });
      const open = async (name) => {
        navigate('/property/opportunities'); await tick();
        const card = [...document.querySelectorAll('main .card')].find(c => c.querySelector('h3')?.textContent === name);
        [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open in the calculator').click();
        await tick(500);
        const text = document.querySelector('main').innerText;
        const listed = SARAWAK_CITIES.find(c => c.id === State.deal.city)?.districts || [];
        return { city: State.deal.city, district: State.deal.district, listed: listed.includes(State.deal.district),
          sel: document.getElementById('dealDistrict')?.value, nulls: text.split('\\n').filter(l => /\\bnull\\b/.test(l)).slice(0, 4),
          url: new URLSearchParams(location.search).get('district'), slug: slugParam(State.deal.district || '') };
      };
      const a = await open('FW blank district');
      const b = await open('FW free text');
      navigate('/property/opportunities'); await tick();
      const kind = document.getElementById('opp-new-district')?.tagName;
      const cityBox = document.getElementById('opp-new-city');
      cityBox.value = 'sibu'; cityBox.dispatchEvent(new Event('input', { bubbles: true })); cityBox.dispatchEvent(new Event('change', { bubbles: true }));
      await tick();
      const offered = [...(document.getElementById('opp-new-district')?.options || [])].map(o => o.value).filter(Boolean);
      oppDraft = null;
      return { a, b, kind, offered, sibu: SARAWAK_CITIES.find(c => c.id === 'sibu').districts, cityWide: observationsFor('kuching', null).total };
    })()`);
    await fwPut();
    const p = [];
    for (const [k, x] of [['blank', r.a], ['free text', r.b]]) {
      if (!x.listed || x.sel !== x.district) p.push(`${k}: the deal's district is ${JSON.stringify(x.district)}, the select shows ${x.sel}`);
      if (x.nulls.length) p.push(`${k}: the page reads ${JSON.stringify(x.nulls)}`);
      if (x.url !== x.slug) p.push(`${k}: the link carries district=${x.url} for ${x.district}`);
    }
    if (r.kind !== 'SELECT' || r.offered.join('|') !== r.sibu.join('|')) p.push(`"Area or district" is a ${r.kind} offering ${JSON.stringify(r.offered)} for Sibu`);
    if (r.cityWide !== 0) p.push(`observationsFor with no district returns ${r.cityWide} records from the whole city`);
    if (p.length) fail('fixwave P5: a register record opens in the calculator at a district its city does not have', p);
    else ok(`fixwave P5: a blank district opens at ${r.a.district} and a district Sibu does not list at ${r.b.district}, the select and the link agree, and the register offers the city's own districts`);
  }

  /* P10 — an imported comparable's town is the town. "Kuching" was stored
           beside the id "kuching" and never matched anywhere evidence is
           read; 2026-13-45 passed a format-only date check; the register
           printed the raw id. */
  {
    await fwKeep(FW_KEYS);
    const r = await evaluate(`(async () => {
      const tick = (ms = 300) => new Promise(res => setTimeout(res, ms));
      const before = new Set((State.observations || []).map(o => o.id));
      navigate('/property/comparables'); await tick();
      document.getElementById('register-import').click(); await tick();
      const ta = drawerBody.querySelector('textarea');
      ta.value = ['city,area,kind,value,date,evidence,sourceRef,reviewedBy,propertyType',
        'Kuching,Tabuan,let-rent,2000,2026-08-01,verified,FW 1,Auditor,Condominium',
        'kuching,tabuan,let-rent,2100,2026-08-02,verified,FW 2,Auditor,Condominium',
        'Sibu,Town centre,let-rent,1500,2026-13-45,verified,FW 3,Auditor,Condominium',
        'Atlantis,Harbour,let-rent,1500,2026-08-03,verified,FW 4,Auditor,Condominium'].join('\\n');
      const btn = (t) => [...drawerBody.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
      btn('Check this paste').click(); await tick();
      const report = drawerBody.innerText;
      btn('Import ')?.click(); await tick();
      const added = State.observations.filter(o => !before.has(o.id)).map(o => ({ city: o.city, area: o.area, date: o.date }));
      const row = [...document.querySelectorAll('main tr')].find(tr => tr.textContent.includes('FW 1'));
      const where = row ? [...row.cells].map(c => c.textContent).find(t => /Tabuan/i.test(t)) : null;
      const counted = observationsFor('kuching', 'Tabuan').groups['let-rent']?.n || 0;
      closeDrawer();
      return { report: report.split('\\n').filter(l => /would be added|Row \\d/.test(l)), added, where, counted };
    })()`);
    await fwPut();
    const p = [];
    if (r.added.length !== 2 || r.added.some(x => x.city !== 'kuching' || x.area !== 'Tabuan')) p.push(`stored ${JSON.stringify(r.added)}`);
    if (r.counted < 2) p.push(`the calculator counts ${r.counted} of the two Tabuan rents`);
    if (r.where !== 'Tabuan, Kuching') p.push(`the register's Where reads "${r.where}"`);
    if (!r.report.some(l => /13-45/.test(l)) || !r.report.some(l => /Atlantis/.test(l))) p.push(`the check did not refuse the impossible date and the unknown town: ${JSON.stringify(r.report)}`);
    if (p.length) fail('fixwave P10: an imported comparable is stored under a town no page reads, or with an impossible date', p);
    else ok('fixwave P10: "Kuching" and "kuching" import as kuching · Tabuan and both count, 2026-13-45 and an unknown town are refused with a reason, and the register names the town');
  }

  /* P15 — a land record is corrected as land. The drawer offered only
           "Built-up area (sq ft)" — a field a land sale never uses — so the
           4-point area behind the register's RM45,000/pt could be neither seen
           nor corrected, and the record was stamped with the deal's
           "Condominium". */
  {
    await fwKeep(FW_KEYS);
    const r = await evaluate(`(async () => {
      const tick = (ms = 300) => new Promise(res => setTimeout(res, ms));
      navigate('/property/calculator'); await tick(400);
      const q = (l) => document.querySelector('main [aria-label="' + l + '"]');
      const set = (l, v) => { const n = q(l); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
      set('What you observed', 'land-sold'); set('Observed value', '180000'); set('Land area', '4'); set('Unit the area is in', 'point'); set('Source reference', 'SPA 9');
      document.getElementById('obs-record').click(); await tick();
      const o = State.observations[0];
      openObservationDrawer(o); await tick();
      const labels = [...drawerBody.querySelectorAll('label')].map(l => l.textContent.trim());
      const land = [...drawerBody.querySelectorAll('input')].find(i => /land area/i.test(i.labels?.[0]?.textContent || ''));
      const shown = land ? land.value : null;
      if (land) { land.value = '5'; land.dispatchEvent(new Event('change', { bubbles: true })); await tick(); }
      const after = State.observations.find(x => x.id === o.id);
      closeDrawer();
      return { type: o.propertyType, labels, shown, landSqft: after.landSqft, want: toSqft(5, 'point'), unit: after.landUnit, sqft: after.sqft };
    })()`);
    await fwPut();
    const p = [];
    if (r.type !== 'Land') p.push(`a transacted land price is stamped "${r.type}"`);
    if (r.labels.some(l => /Built-up area/.test(l))) p.push(`the drawer offers ${JSON.stringify(r.labels.filter(l => /area/i.test(l)))}`);
    if (r.shown !== '4') p.push(`the land area shows ${JSON.stringify(r.shown)} for 4 points`);
    if (!isFinite(r.landSqft) || Math.abs(r.landSqft - r.want) > 0.01 || r.unit !== 'point' || r.sqft != null) p.push(`correcting it to 5 points stored ${r.landSqft} sq ft in ${r.unit} (sqft ${r.sqft})`);
    if (p.length) fail('fixwave P15: a land record\'s area cannot be seen or corrected in its drawer', p);
    else ok('fixwave P15: a land sale is recorded as Land, and its drawer shows and corrects the land area in points');
  }

  /* P7 — the decision record is dated on the reader's clock. It printed the
          UTC minute with no zone — 04:11 at 12:11 in Kuching, and the day
          before until 08:00 — on the page that leaves the browser. */
  {
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kuching' }, sessionId);
    const r = await evaluate(`(() => {
      const now = caseRaisedAt(new Date());
      const heads = [decisionRecordProperty(), decisionRecordWheel()].map(n => n.querySelector('.dr-head .metaline')?.textContent || '');
      return { now, heads };
    })()`);
    await send('Emulation.setTimezoneOverride', { timezoneId: '' }, sessionId).catch(() => {});
    const stamp = (s) => (s.match(/Prepared (\d{4}-\d\d-\d\d \d\d:\d\d)( UTC[+−]\d\d:\d\d)?/) || []);
    const want = stamp('Prepared ' + r.now);
    const bad = r.heads.filter(h => { const [, t, z] = stamp(h); return !t || z !== want[2] || Math.abs(new Date(t) - new Date(want[1])) > 60000; });
    if (bad.length) fail(`fixwave P7: at ${r.now} in Kuching the decision record says`, bad.map(h => h.slice(0, 40)));
    else ok(`fixwave P7: the property and wheel records say "Prepared ${r.now}"`);
  }

  /* P6 — what another tab or another document saved is not written over.
          The borrower profile is never in the address, so a tab opened
          earlier erased an income entered in a later one for good; and a
          page restored from the back-forward cache held the deal it had
          before, showed 572000 while storage held 650000, and wrote it
          back on the next edit. */
  {
    await fwKeep(FW_KEYS);
    const { result: { targetId: tB } } = await send('Target.createTarget', { url: 'about:blank' });
    const { result: { sessionId: sB } } = await send('Target.attachToTarget', { targetId: tB, flatten: true });
    const evalB = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sB)).result?.result?.value;
    let two;
    try {
      await send('Runtime.enable', {}, sB);
      await send('Page.navigate', { url: `${BASE}/property/calculator` }, sB);
      for (const t = Date.now(); Date.now() - t < 30000; await sleep(150))
        if (await evalB(`typeof propertyPagesSettled === 'function' && propertyPagesSettled()`) === true) break;
      const typeA = (id, v) => evaluate(`(() => { const n = document.getElementById(${JSON.stringify(id)}); n.value = ${JSON.stringify(v)};
        n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await evaluate(`(() => { navigate('/property/calculator'); return true; })()`);
      await sleep(500);
      /* Waited for, not slept on: until this tab holds what the other wrote,
         or three seconds — where nothing re-reads it, it never will. */
      const heard = async (expr) => { for (const t = Date.now(); Date.now() - t < 3000; await sleep(100)) if (await evaluate(expr)) return true; return false; };
      const wroteB = await evalB(`(() => { State.borrower.verifiedNetMonthlyIncome = 9000; State.borrower.assessed = true; saveBorrower(); return store.read('borrowerProfile', {}).verifiedNetMonthlyIncome; })()`);
      await heard(`State.borrower.verifiedNetMonthlyIncome === 9000`);
      await typeA('b-existingMonthlyDebtPayments', '500'); await sleep(400);
      const kept = await evaluate(`store.read('borrowerProfile', {})`);
      await evalB(`(() => { store.write('borrowerProfile', null); return true; })()`);
      await heard(`State.borrower.existingMonthlyDebtPayments === 0`);
      await typeA('b-essentialMonthlyCommitments', '1200'); await sleep(400);
      const erased = await evaluate(`store.read('borrowerProfile', {})`);
      two = { wroteB, income: kept.verifiedNetMonthlyIncome, debt: kept.existingMonthlyDebtPayments, afterErase: erased.verifiedNetMonthlyIncome, debtAfterErase: erased.existingMonthlyDebtPayments };
    } finally { await send('Target.closeTarget', { targetId: tB }).catch(() => {}); }
    /* The restore itself, without relying on the browser choosing to cache:
       another document saves a price behind this one's back, and this one is
       shown again from the cache. */
    const bf = await evaluate(`(async () => {
      const tick = (ms = 300) => new Promise(res => setTimeout(res, ms));
      navigate('/property/areas'); await tick();
      localStorage.setItem('vl.deal', JSON.stringify({ ...State.deal, price: 650000 }));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await tick();
      const mem = State.deal.price;
      navigate('/property/calculator'); await tick(450);
      return { mem, box: document.getElementById('d-price')?.value, stored: store.read('deal').price };
    })()`);
    await fwPut();
    const p = [];
    if (two.wroteB !== 9000) p.push(`tab B could not save an income (it read back ${two.wroteB})`);
    else if (two.income !== 9000 || two.debt !== 500) p.push(`tab B entered an income of 9000, tab A a debt of 500: stored income ${two.income}, debt ${two.debt}`);
    if (two.afterErase !== 0 || two.debtAfterErase !== 0) p.push(`tab B erased the financing details and tab A's next edit wrote back income ${two.afterErase}, debt ${two.debtAfterErase}`);
    if (bf.mem !== 650000 || bf.box !== '650000') p.push(`restored from the back-forward cache with 650000 stored: the page holds ${bf.mem} and shows ${bf.box}`);
    if (p.length) fail('fixwave P6: a stale copy in one tab or document writes over what another saved', p);
    else ok('fixwave P6: an income entered in another tab survives this tab\'s next edit, an erase in another tab stays erased, and a page restored from the cache reads the deal saved since');
  }
  /* ---- end fixwave: property ---- */

  /* ---- audit: quality ---- */
  /* The launch audit's accessibility pass over the calculator, beyond what
     Lighthouse scores. The locality map was an img holding eight buttons —
     one picture to a screen reader, its points not there at all; the loan
     cover table's corner header was empty, so its row headers' column had
     no name; and "What this rests on" is a table wider than its card at
     every width in a box nothing in which takes focus, so the keyboard
     could not reach its last column. Also Lighthouse's own failure on this
     page, aria-allowed-attr: aria-selected on the checklist's buttons. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
      const out = {};
      for (const p of ['/property/calculator', '/property/areas']) {
        navigate(p);
        for (let i = 0; i < 20 && (typeof geoLoadState === 'undefined' || geoLoadState === 'loading'); i++) await w(150);
        await w(400);
        out[p] = {
          nested: [...document.querySelectorAll('main [role=img]')].filter(n => n.querySelector(FOCUSABLE)).map(n => (n.getAttribute('aria-label') || n.tagName).slice(0, 60)),
          maps: document.querySelectorAll('main svg[data-city]').length,
          emptyTh: [...document.querySelectorAll('main th')].filter(th => !th.textContent.trim() && !(th.getAttribute('aria-label') || '').trim()).length,
          selected: [...document.querySelectorAll('main [aria-selected]')].filter(n => !/^(tab|option|row|gridcell|columnheader|rowheader|treeitem)$/.test(n.getAttribute('role') || '')).length,
        };
      }
      navigate('/property/calculator'); await w(400);
      const card = [...document.querySelectorAll('main .card')].find(c => /^What this rests on/.test(c.querySelector('.h-card')?.textContent || ''));
      const box = card && [...card.querySelectorAll('div')].find(d => getComputedStyle(d).overflowX === 'auto' && d.querySelector('table'));
      out.box = box ? { tab: box.tabIndex, role: box.getAttribute('role'), name: box.getAttribute('aria-label') || '', focusable: !!box.querySelector(FOCUSABLE) } : null;
      return out;
    })()`);
    const p = [];
    for (const path of ['/property/calculator', '/property/areas']) {
      const x = r[path];
      if (x.nested.length) p.push(`${path}: an img holds tab stops — ${x.nested.join('; ')}`);
      if (x.emptyTh) p.push(`${path}: ${x.emptyTh} table header(s) with no name`);
      if (x.selected) p.push(`${path}: ${x.selected} element(s) carry aria-selected where their role does not allow it`);
    }
    if (!r['/property/calculator'].maps && !r['/property/areas'].maps) p.push('no locality map was drawn, so the map was not tested');
    if (!r.box) p.push('the "What this rests on" table box was not found');
    else if (!r.box.focusable && !(r.box.tab === 0 && r.box.role === 'region' && r.box.name)) p.push(`the "What this rests on" box scrolls and the keyboard cannot reach it: ${JSON.stringify(r.box)}`);
    if (p.length) fail('audit quality: the calculator has an img holding buttons, an unnamed header, aria-selected on a button, or a scroll box the keyboard cannot reach', p);
    else ok(`audit quality: the locality map is a group of buttons, every table header is named, no button carries aria-selected, and the evidence table's box is a named tab stop`);
  }
  /* ---- end audit: quality ---- */

  /* ---- audit1: property-model ---- */
  /* ONE PROPERTY MODEL (daily audit #1, item 7). A saved property is a model
     the calculator edits: one store (the saved-work list), the calculator's
     deal its working copy, scenarios as overrides of it, a list at
     /property/models, and the calculator in five sections. Each check below
     fails on 30af04c, where none of it existed: the migration, the same
     price reaching every tool, scenarios compared, an opportunity opened as
     its own property, the list's create/open/duplicate/rename/delete, a
     locality passed in from the area screen and the register, the sections
     and their contracts, and one primary action per screen. */
  {
    const A1 = `const w = (ms) => new Promise(r => setTimeout(r, ms));
      const txt = (n) => (n ? n.innerText : '').replace(/\\s+/g, ' ').trim();
      const btn = (t, root = document) => [...root.querySelectorAll('button, a')].find(x => x.offsetParent !== null && x.textContent.trim() === t);
      const primaries = () => [...document.querySelectorAll('main .btn-primary')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim());
      window.prompt = (m, d) => (window.__a1Prompt.length ? window.__a1Prompt.shift() : d);
      window.confirm = () => true;`;
    const KEYS = ['savedWork', 'deal', 'dealBeforeLink', 'opportunities', 'observations', 'registerLog', 'lang', 'propertyReportsBought'];
    const kept = await evaluate(`JSON.stringify(Object.fromEntries(${JSON.stringify(KEYS)}.map(k => [k, localStorage.getItem('vl.' + k)])))`);
    const settle = async () => {
      for (const t = Date.now(); Date.now() - t < 30000; await sleep(100)) {
        const r = await send('Runtime.evaluate', { expression: `typeof propertyPagesSettled === 'function' && propertyPagesSettled()`, returnByValue: true }, sessionId);
        if (r.result?.result?.value === true) return;
      }
      throw new Error('the page did not settle after a reload');
    };
    const reload = async (path) => { await send('Page.navigate', { url: `${BASE}${path}` }, sessionId); await sleep(300); await settle(); await sleep(300); };
    try {
      /* Each check on its own: on a build without the store, the first
         missing function would otherwise end the block before the rest
         reported anything. */
      const step = async (name, fn) => {
        try { await fn(); } catch (e) { fail(`audit1 property-model ${name}: the check could not run`, String(e.message).split('\n')[0]); }
      };
      await step('A1', async () => {
        /* A1 — THE MIGRATION, ON EVERY STORED SHAPE. Written as the old build
           wrote them, then read by a fresh load: a work-bar snapshot with its
           stamp, one saved before stamps, one that holds no deal, a Cash Wheel
           snapshot, the deal in progress (an unchanged copy of the first, from
           before the pointer existed), and a deal kept aside by a shared link. */
        const legacy = await evaluate(`(() => {
          const base = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: { flood: 'no' } };
          const dealA = { ...base, price: 640000, rent: 2100, holdYears: 7.5, district: 'stutong', touched: { price: true, rent: true } };
          const dealB = { ...base, city: 'miri', district: 'Lutong', projectId: 'custom-miri', price: 398000, touched: { price: true } };
          const kept = { ...base, price: 777000, touched: { price: true } };
          const recs = [
            { id: 'w-property-legacy-a', kind: 'property', name: 'Legacy A', savedAt: '2026-09-20 03:10', modelVersion: MODEL_VERSION, asOf: AS_OF, editor: 'this browser',
              stamp: { v: 1, model: MODEL_VERSION, data: {}, savedAt: '2026-09-20T03:10:12.000Z' }, payload: { deal: dealA } },
            { id: 'w-property-legacy-b', kind: 'property', name: 'Legacy B', savedAt: '2026-09-01 01:00', modelVersion: 'old', asOf: AS_OF, editor: 'this browser', payload: { deal: dealB } },
            { id: 'w-property-legacy-c', kind: 'property', name: 'Holds nothing', savedAt: '2026-08-30 09:00', payload: { deal: null } },
            { id: 'w-wheel-legacy', kind: 'wheel', name: 'A wheel', savedAt: '2026-09-02 02:00', payload: { wheelPlan: { putStrike: 50 }, wheelLegs: [] } },
          ];
          localStorage.setItem('vl.savedWork', JSON.stringify(recs));
          localStorage.setItem('vl.deal', JSON.stringify({ ...dealA, holdYears: 8, district: 'Stutong' }));
          localStorage.setItem('vl.dealBeforeLink', JSON.stringify(kept));
          return JSON.stringify({ recs, dealA, dealB, kept });
        })()`);
        await reload('/property/models');
        const L = JSON.parse(legacy);
        const r1 = await evaluate(`(async () => { ${A1}
          const list = loadWork();
          const a = list.find(r => r.id === 'w-property-legacy-a'), b = list.find(r => r.id === 'w-property-legacy-b');
          const c = list.find(r => r.id === 'w-property-legacy-c'), wh = list.find(r => r.id === 'w-wheel-legacy');
          const rows = [...document.querySelectorAll('main .pm-list .pm-row:not(.pm-head)')].map(txt);
          const out = { a, b, c, wh, rows, deal: { modelId: State.deal.modelId }, kept: store.read('dealBeforeLink', null),
            keptRow: rows.some(t => /Kept aside — your previous deal/.test(t)) };
          navigate('/property/calculator'); await w(300);
          out.status = txt(document.getElementById('pm-status'));
          out.restore = !!btn('Restore my previous deal');
          navigate('/my/workspace'); await w(250);
          out.ws = [...document.querySelectorAll('.ws-row')].map(txt).filter(t => /Legacy [AB]|Holds nothing/.test(t)).length;
          const resume = [...document.querySelectorAll('.ws-row')].find(r => /Legacy B/.test(r.textContent))?.querySelector('.ws-open');
          resume?.click(); await w(350);
          out.fromWs = { view: State.view, modelId: State.deal.modelId, status: txt(document.getElementById('pm-status')) };
          return out;
        })()`);
        const p1 = [];
        const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
        if (!r1.a || r1.a.createdAt !== '2026-09-20T03:10:12.000Z' || r1.a.updatedAt !== r1.a.createdAt || !same(r1.a.scenarios, []))
          p1.push(`the stamped snapshot is not a property with its times and no scenarios: ${JSON.stringify(r1.a && { c: r1.a.createdAt, u: r1.a.updatedAt, s: r1.a.scenarios })}`);
        else {
          const want = { ...L.dealA, holdYears: 8, district: 'Stutong' };
          const got = { ...r1.a.payload.deal };
          const lost = Object.keys(want).filter(k => JSON.stringify(want[k]) !== JSON.stringify(got[k]));
          if (lost.length) p1.push(`the stamped snapshot's inputs changed in migration: ${lost.join(', ')}`);
        }
        if (!r1.b || r1.b.createdAt !== '2026-09-01T01:00:00.000Z' || r1.b.payload.deal.price !== 398000) p1.push(`the unstamped snapshot: ${JSON.stringify(r1.b && { c: r1.b.createdAt, price: r1.b.payload?.deal?.price })}`);
        if (!r1.c || !same(r1.c, L.recs[2])) p1.push('the snapshot that holds nothing was changed');
        if (!r1.wh || !same(r1.wh, L.recs[3])) p1.push('the Cash Wheel snapshot was changed');
        if (!r1.rows.some(t => /Legacy A/.test(t)) || !r1.rows.some(t => /Legacy B/.test(t)) || r1.rows.some(t => /Holds nothing|A wheel/.test(t)))
          p1.push(`My properties lists: ${r1.rows.map(t => t.slice(0, 40)).join(' | ')}`);
        if (r1.deal.modelId !== 'w-property-legacy-a' || !/^Editing: Legacy A · saved /.test(r1.status)) p1.push(`the deal in progress, an unchanged copy of Legacy A, is not attached to it: ${r1.deal.modelId}, "${r1.status}"`);
        if (!r1.kept || r1.kept.modelId !== null || r1.kept.price !== 777000 || !r1.keptRow || !r1.restore) p1.push(`the deal kept aside: ${JSON.stringify({ kept: r1.kept && { m: r1.kept.modelId, p: r1.kept.price }, row: r1.keptRow, restore: r1.restore })}`);
        if (r1.ws !== 3) p1.push(`Saved Models lists ${r1.ws} of the three property snapshots`);
        if (r1.fromWs.view !== 'property' || r1.fromWs.modelId !== 'w-property-legacy-b' || !/^Editing: Legacy B/.test(r1.fromWs.status)) p1.push(`Saved Models' Resume did not open Legacy B as the property the calculator edits: ${JSON.stringify(r1.fromWs)}`);
        const again = await evaluate(`localStorage.getItem('vl.savedWork')`);
        await reload('/property/models');
        if ((await evaluate(`localStorage.getItem('vl.savedWork')`)) !== again) p1.push('a second load changed the store again — the migration is not idempotent');
        if (p1.length) fail('audit1 property-model A1: every stored shape migrates into the one property store without loss', p1);
        else ok('audit1 property-model A1: a stamped snapshot, an unstamped one, the deal in progress and the deal kept aside migrate — two properties with their times, inputs intact, the deal attached to its property, the kept deal restorable; a snapshot holding nothing and a Cash Wheel one untouched; Saved Models opens a property as the one the calculator edits; a second load writes nothing');
      });

      await step('A2', async () => {
        /* A2 — THE SAME PRICE, TYPED ONCE, IN EVERY TOOL. Typed into the
           Acquisition section's field, read back from Financing (the loan),
           Scenarios (the rate of return, its sensitivity and the break-even
           rate), Report, and the decision record — each against the model's
           own figure for that price. */
        const r2 = await evaluate(`(async () => { ${A1}
          window.__a1Prompt = [];
          newPropertyDeal({ show: false }); navigate('/property/calculator'); await w(300);
          const f = document.getElementById('d-price');
          f.value = '612345'; f.dispatchEvent(new Event('change', { bubbles: true })); await w(350);
          const m = dealModel(State.deal), s = propertySensitivity(State.deal);
          const sec = (id) => txt(document.getElementById(id));
          const out = {
            inAcq: !!document.getElementById('acquisition')?.contains(document.getElementById('d-price')),
            price: State.deal.price, status: txt(document.getElementById('pm-status')), primaries: primaries(),
            loan: sec('financing').includes(fmtAmount(m.loan, 'MYR')), instalment: sec('financing').includes(fmtAmount(m.instalment, 'MYR')),
            irr: isNum(m.irrPct) && sec('scenarios').includes(fmtPct(m.irrPct, 2)),
            sens: s.ok && Math.abs(s.baseIrr - m.irrPct) < 1e-9 && sec('scenarios').includes('Effect on a ' + fmtPct(s.baseIrr, 2) + ' rate of return'),
            stress: isNum(m.breakEvenRate) ? sec('scenarios').includes(fmtPct(m.breakEvenRate, 2)) : 'no rate',
            report: sec('report').includes('Against the methodology'),
          };
          window.__a1Prompt = ['A2 typed once'];
          document.getElementById('wb-property-save').click(); await w(300);
          out.saved = pmFind(State.deal.modelId)?.payload.deal.price;
          out.after = { status: txt(document.getElementById('pm-status')), primaries: primaries() };
          document.getElementById('pm-record').click(); await w(400);
          const rec = txt(document.querySelector('main .decision-record'));
          out.record = rec.includes(fmtMoney(612345, 'MYR', 0)) && rec.includes(fmtMoney(m.cashStillRequiredToComplete, 'MYR', 0));
          out.recordView = State.view;
          out.recordOf = /Of “A2 typed once”\./.test(rec);
          return out;
        })()`);
        const p2 = [];
        if (!r2.inAcq) p2.push('the price field is not in the Acquisition section');
        if (r2.price !== 612345) p2.push(`the typed price did not reach the deal (${r2.price})`);
        if (!/^Unsaved changes/.test(r2.status) || r2.primaries.join('|') !== 'Save this property') p2.push(`before saving: "${r2.status}", primary ${JSON.stringify(r2.primaries)}`);
        if (!r2.loan || !r2.instalment) p2.push(`Financing does not show the loan or the instalment for that price (${r2.loan}, ${r2.instalment})`);
        if (!r2.irr) p2.push('Scenarios does not show the rate of return the model gives that price');
        if (!r2.sens) p2.push('the sensitivity is not measured on the same rate of return');
        if (r2.stress !== true && r2.stress !== 'no rate') p2.push('the stress test does not show the break-even rate for that price');
        if (!r2.report) p2.push('Report does not draw the methodology gates');
        if (r2.saved !== 612345) p2.push(`Save this property did not store the price (${r2.saved})`);
        if (!/^Editing: A2 typed once · saved /.test(r2.after.status) || r2.after.primaries.join('|') !== 'Compare scenarios') p2.push(`after saving: "${r2.after.status}", primary ${JSON.stringify(r2.after.primaries)}`);
        if (!r2.record || r2.recordView !== 'decisionRecord') p2.push(`the decision record does not print that price and its cash to complete (${r2.record}, ${r2.recordView})`);
        if (!r2.recordOf) p2.push('the decision record does not say which saved property it is of');
        if (p2.length) fail('audit1 property-model A2: a price typed once reaches financing, returns, sensitivity, the tests and the report', p2);
        else ok('audit1 property-model A2: a price typed once in Acquisition is the price Financing lends against, Scenarios returns, measures sensitivity on and stress-tests, Report grades and the decision record prints; Save this property stores it and the primary action becomes Compare scenarios');
      });

      await step('A3', async () => {
        /* A3 — SCENARIOS COMPARE. Two variations of the saved property, each
           kept as only what it changes, set side by side on the calculator's
           own model; a change to the property reaches a scenario on every
           input it does not change; one opens to edit; three at most. */
        const r3 = await evaluate(`(async () => { ${A1}
          navigate('/property/calculator'); await w(250);
          const id = State.deal.modelId;
          const set = async (k, v) => { const f = document.getElementById('d-' + k); f.value = String(v); f.dispatchEvent(new Event('change', { bubbles: true })); await w(300); };
          await set('rent', 2600);
          window.__a1Prompt = ['Higher rent']; document.getElementById('wb-property-scenario').click(); await w(300);
          document.getElementById('wb-property-base').click(); await w(300);
          await set('ratePct', 5.2);
          window.__a1Prompt = ['Higher rate']; document.getElementById('wb-property-scenario').click(); await w(300);
          const rec = pmFind(id);
          const [s1, s2] = rec.scenarios;
          const out = { n: rec.scenarios.length, o1: s1?.overrides, o2: s2?.overrides, base: pmInputsOf(rec).price };
          /* The property as saved and both scenarios. */
          PM_COMPARE[id] = ['base', s1.id, s2.id]; render(); await w(250);
          const t = document.querySelector('#scenarios .pm-sc-table');
          out.head = [...(t?.querySelectorAll('thead th') || [])].map(th => th.textContent.trim()).slice(1);
          const rowOf = (label) => [...(t?.querySelectorAll('tbody tr') || [])].find(tr => txt(tr.querySelector('th')) === label);
          const cells = (label) => [...(rowOf(label)?.querySelectorAll('td') || [])].map(txt);
          const want = [pmInputsOf(rec), pmMerge(pmInputsOf(rec), s1.overrides), pmMerge(pmInputsOf(rec), s2.overrides)].map(d => { const m = dealModel(d), g = propertyGrade(d, m);
            return { mp: fmtAmount(m.cashflowMonthly, 'MYR'), ny: isNum(m.netYield) ? fmtPct(m.netYield, 2) : '—', be: isNum(m.breakEvenRent) ? fmtAmount(m.breakEvenRent, 'MYR') : '—', gr: g.grade }; });
          out.cells = { mp: cells('Monthly position'), ny: cells('Net yield'), be: cells('Break-even rent'), gr: cells('Grade'), cash: cells('Cash required') };
          out.want = want;
          /* A fourth is refused: with a change not saved, the changes on the
             calculator are a column on offer too. Then discarded. */
          await set('sinkingFund', 55);
          const extra = document.getElementById('pm-sc-cmp-current');
          out.fourth = extra ? (extra.click(), await w(200), PM_COMPARE[id].length) : 'no unsaved column';
          document.getElementById('wb-property-discard')?.click(); await w(250);
          out.discarded = State.deal.sinkingFund !== 55;
          /* The property's price moves; the scenario follows it. */
          document.getElementById('wb-property-base')?.click(); await w(250);
          openPropertyModel(id, { show: false }); render(); await w(200);
          await set('price', 590000);
          document.getElementById('wb-property-save').click(); await w(300);
          out.follows = pmMerge(pmInputsOf(pmFind(id)), pmFind(id).scenarios[0].overrides).price;
          /* Open to edit: the scenario is what the calculator holds, and a save
             writes its changes, not the property's. */
          document.getElementById('pm-sc-open-' + s1.id).click(); await w(300);
          out.open = { sc: State.deal.scenarioId, rent: State.deal.rent, status: txt(document.getElementById('pm-status')) };
          await set('vacancyPct', 12);
          document.getElementById('wb-property-save').click(); await w(300);
          const after = pmFind(id);
          out.edited = { ov: after.scenarios[0].overrides.vacancyPct, base: pmInputsOf(after).vacancyPct };
          document.getElementById('wb-property-base').click(); await w(250);
          out.back = { sc: State.deal.scenarioId, rent: State.deal.rent };
          return out;
        })()`);
        const p3 = [];
        if (r3.n !== 2) p3.push(`${r3.n} scenarios saved, not 2`);
        const keys = (o) => Object.keys(o || {}).filter(k => !['touched', 'evidence'].includes(k)).sort().join(',');
        if (keys(r3.o1) !== 'rent' || r3.o1.rent !== 2600) p3.push(`"Higher rent" keeps more than its change: ${JSON.stringify(r3.o1)}`);
        if (keys(r3.o2) !== 'ratePct' || r3.o2.ratePct !== 5.2) p3.push(`"Higher rate" keeps more than its change: ${JSON.stringify(r3.o2)}`);
        if (JSON.stringify(r3.head) !== JSON.stringify(['As saved', 'Higher rent', 'Higher rate'])) p3.push(`the comparison's columns: ${JSON.stringify(r3.head)}`);
        r3.want.forEach((x, i) => {
          if (r3.cells.mp[i] !== x.mp || r3.cells.ny[i] !== x.ny || r3.cells.be[i] !== x.be || !String(r3.cells.gr[i]).startsWith(x.gr))
            p3.push(`column ${i + 1} is not the model's: ${JSON.stringify({ got: [r3.cells.mp[i], r3.cells.ny[i], r3.cells.be[i], r3.cells.gr[i]], want: x })}`);
        });
        if (!(r3.cells.cash || []).every(Boolean) || (r3.cells.cash || []).length !== 3) p3.push('the comparison has no cash required for every column');
        if (r3.fourth !== 3) p3.push(`a fourth column: ${r3.fourth}`);
        if (!r3.discarded) p3.push('Discard changes did not put the scenario back as saved');
        if (r3.follows !== 590000) p3.push(`a scenario did not follow the property's new price (${r3.follows})`);
        if (!r3.open.sc || r3.open.rent !== 2600 || !/scenario “Higher rent”/.test(r3.open.status)) p3.push(`Open to edit: ${JSON.stringify(r3.open)}`);
        if (r3.edited.ov !== 12 || r3.edited.base === 12) p3.push(`a save while a scenario is open wrote the property, not the scenario: ${JSON.stringify(r3.edited)}`);
        if (r3.back.sc !== null || r3.back.rent === 2600) p3.push(`Back to the property: ${JSON.stringify(r3.back)}`);
        if (p3.length) fail('audit1 property-model A3: scenarios are saved as their changes, compared on the model, follow the property and open to edit', p3);
        else ok(`audit1 property-model A3: two scenarios each keep only what they change, and the comparison sets the property and both side by side on the calculator's own model (monthly ${r3.cells.mp.join(' / ')}); a fourth is refused, a scenario follows the property's new price, and one opens to edit and saves as itself`);
      });

      await step('A4', async () => {
        /* A4 — AN OPPORTUNITY OPENS AS ITS OWN PROPERTY, WITHOUT RE-ENTRY. */
        const r4 = await evaluate(`(async () => { ${A1}
          State.opportunities = [{ id: 'opp-a1-x', name: 'A1 Lanang terrace', source: 'agent listing', state: 'captured', capturedAt: '2026-09-30',
            availabilityCheckedAt: null, available: null, deal: { city: 'sibu', district: 'Lanang', propertyType: 'Terrace (2 storey)', price: 455000, sqft: 1500,
            projectId: 'custom-sibu', bankValuation: 0, titleType: 'unknown' }, touched: { price: true }, evidence: { price: 'user' }, checks: {},
            negotiatedPrice: null, valuerEstimate: null, nextAction: '', nextActionOwner: '', nextActionDue: '' }];
          saveOpportunities();
          /* An unsaved deal of the reader's own on the calculator first. */
          newPropertyDeal({ show: false }); State.deal.price = 777777; markTouched(State.deal, 'price'); saveDeal();
          const openIt = async () => { navigate('/property/opportunities'); await w(250);
            const card = [...document.querySelectorAll('main .card')].find(c => c.querySelector('h3')?.textContent === 'A1 Lanang terrace');
            [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open in the calculator').click(); await w(400); };
          await openIt();
          const tied = () => pmAll().filter(r => r.source?.id === 'opp-a1-x');
          const out = { n1: tied().length, view: State.view, price: State.deal.price, district: State.deal.district, modelId: State.deal.modelId,
            id: tied()[0]?.id, kept: store.read('dealBeforeLink', null)?.price, status: txt(document.getElementById('pm-status')) };
          const f = document.getElementById('d-rent'); f.value = '1650'; f.dispatchEvent(new Event('change', { bubbles: true })); await w(300);
          document.getElementById('wb-property-save').click(); await w(300);
          await openIt();
          out.again = { n: tied().length, modelId: State.deal.modelId, rent: State.deal.rent, price: State.deal.price };
          return out;
        })()`);
        const p4 = [];
        if (r4.n1 !== 1 || r4.view !== 'property' || r4.modelId !== r4.id) p4.push(`the first Open did not save and open a property tied to the record: ${JSON.stringify(r4)}`);
        if (r4.price !== 455000 || r4.district !== 'Lanang') p4.push(`the record's figures did not reach the calculator: price ${r4.price}, district ${r4.district}`);
        if (!/^Editing: A1 Lanang terrace · saved /.test(r4.status)) p4.push(`the calculator says "${r4.status}"`);
        if (r4.kept !== 777777) p4.push(`the unsaved deal it replaced was not kept aside (${r4.kept})`);
        if (r4.again.n !== 1 || r4.again.modelId !== r4.id || r4.again.rent !== 1650 || r4.again.price !== 455000) p4.push(`the second Open re-entered the record instead of reopening its property: ${JSON.stringify(r4.again)}`);
        if (p4.length) fail('audit1 property-model A4: an opportunity opens as its own property, and again without re-entry', p4);
        else ok('audit1 property-model A4: "Open in the calculator" saves the record as a property tied to it and opens it (the unsaved deal it replaces kept aside); a rent changed and saved there is still there when the record is opened again — one property, nothing retyped');
      });

      await step('A5', async () => {
        /* A5 — MY PROPERTIES: NEW, SAVE, OPEN, DUPLICATE, RENAME, DELETE; THE
           SAMPLE IS CALLED ONE; ITS TAB IS THE ROW'S FIRST. */
        const r5 = await evaluate(`(async () => { ${A1}
          navigate('/property/models'); await w(250);
          const out = { tabs: [...document.querySelectorAll('.ptabs .ptab')].map(a => [txt(a), a.getAttribute('aria-current')]),
            primaries: primaries(), sample: txt(document.querySelector('main .pm-sample')), title: document.title };
          document.getElementById('pm-new').click(); await w(300);
          out.new = { view: State.view, modelId: State.deal.modelId, status: txt(document.getElementById('pm-status')), calcTab: [...document.querySelectorAll('.ptabs .ptab')].find(a => a.getAttribute('aria-current'))?.textContent.trim() };
          const f = document.getElementById('d-price'); f.value = '505000'; f.dispatchEvent(new Event('change', { bubbles: true })); await w(300);
          window.__a1Prompt = ['CRUD one'];
          document.getElementById('wb-property-save').click(); await w(250);
          const id = State.deal.modelId;
          navigate('/property/models'); await w(250);
          const n0 = pmAll().length;
          out.listed = !![...document.querySelectorAll('main .pm-row')].find(r => /CRUD one/.test(r.textContent) && /On the calculator/.test(r.textContent));
          document.getElementById('pm-dup-' + id).click(); await w(250);
          const copy = pmAll().find(r => r.name === 'CRUD one (copy)');
          out.dup = { n: pmAll().length - n0, copy: !!copy, focus: document.activeElement?.id };
          window.__a1Prompt = ['CRUD renamed'];
          document.getElementById('pm-ren-' + copy.id).click(); await w(250);
          out.ren = pmFind(copy.id)?.name;
          document.getElementById('pm-open-' + copy.id).click(); await w(350);
          out.open = { view: State.view, modelId: State.deal.modelId === copy.id, status: txt(document.getElementById('pm-status')) };
          navigate('/property/models'); await w(250);
          const del = [...document.querySelectorAll('main .pm-row')].find(r => /CRUD renamed/.test(r.textContent))?.querySelector('button[aria-label^="Delete"]');
          del.click(); await w(300);
          out.del = { gone: !pmFind(copy.id), onCalc: State.deal.modelId, price: State.deal.price, focus: document.activeElement?.className || document.activeElement?.id };
          navigate('/property/calculator'); await w(250);
          out.afterDel = txt(document.getElementById('pm-status'));
          deletePropertyModel(id);
          return out;
        })()`);
        const p5 = [];
        if (JSON.stringify(r5.tabs[0]) !== JSON.stringify(['My properties', 'page']) || r5.tabs[1]?.[0] !== 'Calculator') p5.push(`the Property tab row: ${JSON.stringify(r5.tabs)}`);
        if (JSON.stringify(r5.primaries) !== JSON.stringify(['New property'])) p5.push(`My properties' primary actions: ${JSON.stringify(r5.primaries)}`);
        if (!/Sample — not a real listing/.test(r5.sample) || !/Open the sample/.test(r5.sample)) p5.push(`the sample row: "${r5.sample.slice(0, 120)}"`);
        if (!/^My properties/.test(r5.title)) p5.push(`the page title is "${r5.title}"`);
        if (r5.new.view !== 'property' || r5.new.modelId !== null || !/^Sample deal/.test(r5.new.status) || r5.new.calcTab !== 'Calculator') p5.push(`New property: ${JSON.stringify(r5.new)}`);
        if (!r5.listed) p5.push('a saved property is not listed as the one on the calculator');
        if (r5.dup.n !== 1 || !r5.dup.copy) p5.push(`Duplicate: ${JSON.stringify(r5.dup)}`);
        if (r5.ren !== 'CRUD renamed') p5.push(`Rename: ${r5.ren}`);
        if (r5.open.view !== 'property' || !r5.open.modelId || !/^Editing: CRUD renamed/.test(r5.open.status)) p5.push(`Open: ${JSON.stringify(r5.open)}`);
        if (!r5.del.gone || r5.del.onCalc !== null || !/^Unsaved changes/.test(r5.afterDel)) p5.push(`Delete: ${JSON.stringify(r5.del)}, then "${r5.afterDel}"`);
        if (p5.length) fail('audit1 property-model A5: My properties creates, opens, duplicates, renames and deletes a property, with the sample called one', p5);
        else ok('audit1 property-model A5: My properties is the Property row\'s first tab with New property its one primary action; a new property opens from the sample, saves, is listed as the one on the calculator, duplicates, renames, opens, and deletes — leaving its deal on the calculator unsaved; the sample row says it is one');
      });

      await step('A6', async () => {
        /* A6 — A LOCALITY FROM THE AREA SCREEN AND A RECORD FROM THE
           REGISTER BECOME THE DISTRICT OF THE PROPERTY ON THE CALCULATOR; A
           LOCALITY THE TOWN DOES NOT LIST IS SAID TO BE ONE, NOT OFFERED. */
        const r6 = await evaluate(`(async () => { ${A1}
          newPropertyDeal({ show: false });
          const price = State.deal.price;
          navigate('/property/areas'); await w(200);
          State.areaScreen.city = 'miri'; State.areaScreen.editing = 'Lutong'; render(); await w(250);
          document.getElementById('area-use-in-calc').click(); await w(350);
          const out = { a: { view: State.view, city: State.deal.city, district: State.deal.district, price: State.deal.price === price } };
          navigate('/property/areas'); await w(200);
          State.areaScreen.city = 'miri'; State.areaScreen.editing = 'A1 private lane'; render(); await w(250);
          out.unlisted = { button: !!document.getElementById('area-use-in-calc'), said: /not one of Miri's listed districts/.test(txt(document.querySelector('main .pm-handoff'))) };
          State.areaScreen.editing = null;
          addObservation({ city: 'bintulu', area: 'Kidurong', kind: 'ask-rent', value: 1500, evidence: 'user', date: '2026-09-01' });
          navigate('/property/comparables'); await w(250);
          const o = State.observations.find(x => x.area === 'Kidurong' && x.value === 1500);
          document.getElementById(obsOpenId(o)).click(); await w(350);
          document.getElementById('obs-use-in-calc').click(); await w(400);
          out.b = { view: State.view, city: State.deal.city, district: State.deal.district, drawer: document.getElementById('drawer')?.dataset.open };
          return out;
        })()`);
        const p6 = [];
        if (r6.a.view !== 'property' || r6.a.city !== 'miri' || r6.a.district !== 'Lutong' || !r6.a.price) p6.push(`the area screen: ${JSON.stringify(r6.a)}`);
        if (r6.unlisted.button || !r6.unlisted.said) p6.push(`an unlisted locality: ${JSON.stringify(r6.unlisted)}`);
        if (r6.b.view !== 'property' || r6.b.city !== 'bintulu' || r6.b.district !== 'Kidurong' || r6.b.drawer === '1') p6.push(`the register: ${JSON.stringify(r6.b)}`);
        if (p6.length) fail('audit1 property-model A6: the area screen and the comparables register pass a district into the property on the calculator', p6);
        else ok('audit1 property-model A6: "Use Lutong in the calculator" (area screen) and "Use Kidurong in the calculator" (a register record) make that district the property\'s, its figures untouched; a locality the town does not list is said to be one, not offered');
      });

      await step('A7', async () => {
        /* A7 — FIVE SECTIONS IN THE BRIEF'S ORDER, EACH WITH ITS CONTRACT; A
           STICKY INDEX THAT REACHES EACH WITHOUT A ROUTE, AND A HEADING IT
           JUMPS TO NOT UNDER IT; THE ADDRESS'S #scenarios OPENS AT SCENARIOS. */
        const r7 = await evaluate(`(async () => { ${A1}
          document.documentElement.style.scrollBehavior = 'auto';
          navigate('/property/calculator'); await w(300);
          const secs = [...document.querySelectorAll('main section.pc-sec')];
          const out = {
            ids: secs.map(s => s.id), titles: secs.map(s => txt(s.querySelector('h2'))),
            contracts: secs.map(s => [...s.querySelectorAll('.pc-contract')].map(p => txt(p).split(':')[0])),
            links: [...document.querySelectorAll('.pc-index .pc-index-link')].map(a => [txt(a), a.getAttribute('href')]),
            sticky: getComputedStyle(document.querySelector('.pc-index')).position,
            inputs: secs.map(s => s.querySelectorAll('.pc-inputs input, .pc-inputs select').length),
            path: location.pathname,
          };
          [...document.querySelectorAll('.pc-index .pc-index-link')].find(a => a.dataset.sec === 'rental').click(); await w(250);
          const idx = document.querySelector('.pc-index').getBoundingClientRect(), h = document.getElementById('pc-h-rental').getBoundingClientRect();
          out.jump = { below: h.top >= idx.bottom - 1, focus: document.activeElement?.id, current: document.querySelector('.pc-index-link[aria-current]')?.dataset.sec, path: location.pathname + location.hash };
          return out;
        })()`);
        await reload('/property/calculator#scenarios');
        const r7b = await evaluate(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms));
          const at = () => { const idx = document.querySelector('.pc-index').getBoundingClientRect(); const h = document.getElementById('pc-h-scenarios').getBoundingClientRect();
            return { top: Math.round(h.top), idx: Math.round(idx.bottom), inView: h.top >= idx.bottom - 1 && h.top < innerHeight, y: Math.round(scrollY) }; };
          for (let i = 0; i < 20 && !at().inView; i++) await w(150);
          return at(); })()`);
        const p7 = [];
        const order = ['acquisition', 'financing', 'rental', 'scenarios', 'report'];
        if (JSON.stringify(r7.ids) !== JSON.stringify(order)) p7.push(`sections: ${JSON.stringify(r7.ids)}`);
        if (JSON.stringify(r7.titles) !== JSON.stringify(['Acquisition', 'Financing', 'Rental & expenses', 'Scenarios', 'Report'])) p7.push(`titles: ${JSON.stringify(r7.titles)}`);
        if (!r7.contracts.every(c => JSON.stringify(c) === JSON.stringify(['You provide', 'Quantum calculates']))) p7.push(`contracts: ${JSON.stringify(r7.contracts)}`);
        if (JSON.stringify(r7.links.map(l => l[1])) !== JSON.stringify(order.map(x => '#' + x))) p7.push(`index: ${JSON.stringify(r7.links)}`);
        if (r7.sticky !== 'sticky') p7.push(`the index is ${r7.sticky}, not sticky`);
        if (r7.inputs.some(n => !n)) p7.push(`a section asks for nothing: ${JSON.stringify(r7.inputs)}`);
        if (!r7.jump.below || r7.jump.focus !== 'pc-h-rental' || r7.jump.current !== 'rental' || r7.jump.path !== '/property/calculator') p7.push(`the index's Rental link: ${JSON.stringify(r7.jump)}`);
        if (!r7b.inView) p7.push(`/property/calculator#scenarios did not open at Scenarios: ${JSON.stringify(r7b)}`);
        if (p7.length) fail('audit1 property-model A7: the calculator is five sections in the brief\'s order, each with its contract, reached from a sticky index', p7);
        else ok('audit1 property-model A7: Acquisition, Financing, Rental & expenses, Scenarios and Report, each opening "You provide" / "Quantum calculates" with its own inputs; the sticky index reaches each without a route, the heading clear of it and marked current, and /property/calculator#scenarios opens at Scenarios');
      });

      /* THE VERIFICATION'S OWN CHECKS (audit1/property-model-verify). Each
         failed on the builder's commit 46c0e76 and holds after the fix it
         names. */
      await step('V1', async () => {
        /* V1 — A LINK DOES NOT WRITE OVER WORK KEPT NOWHERE ELSE. Opening a
           property, a new one or an opportunity keeps unsaved work aside,
           and the slot it goes to is the one a shared link writes. The link
           wrote the deal it replaced there unconditionally, so a deal kept
           aside by "New property" was gone the moment a link was opened —
           replaced by a saved property that was never at risk. */
        await evaluate(`(async () => { ${A1}
          window.__a1Prompt = [];
          localStorage.removeItem('vl.dealBeforeLink');
          newPropertyDeal({ show: false }); State.deal.price = 711111; markTouched(State.deal, 'price'); saveDeal();
          newPropertyDeal({ show: false }); State.deal.price = 522222; markTouched(State.deal, 'price'); saveDeal();
          saveActiveProperty({ name: 'V1 saved' });
          return true; })()`);
        await reload('/property/calculator?city=kuching&d=price:333000~touched:price');
        const snap = `(async () => { await new Promise(r => setTimeout(r, 200));
          return { price: State.deal.price, kept: store.read('dealBeforeLink', null)?.price ?? null,
            saved: pmAll().map(r => pmInputsOf(r).price), toast: document.getElementById('toast')?.textContent || '' }; })()`;
        const a = await evaluate(snap);
        /* A second link, while the deal on the calculator (the first link's)
           is unsaved work too: both it and the deal already kept aside survive. */
        await reload('/property/calculator?city=kuching&d=price:344000~touched:price');
        const b = await evaluate(snap);
        /* And "Restore it" on My properties restores without writing the
           deal's city, district and figures into My properties' address. */
        const c = await evaluate(`(async () => { ${A1}
          navigate('/property/models'); await w(250);
          const before = location.search; restoreDealBeforeLink(); return { before, after: location.search, view: State.view }; })()`);
        const pv1 = [];
        if (c.view !== 'propertyModels' || c.after !== c.before) pv1.push(`restoring on My properties changed its address from "${c.before}" to "${c.after.slice(0, 80)}"`);
        if (a.price !== 333000) pv1.push(`the link did not open (${a.price})`);
        if (a.kept !== 711111 && !a.saved.includes(711111)) pv1.push(`the deal kept aside before the link (711,111) is gone: the slot holds ${a.kept}, the saved properties ${a.saved.join(', ')}`);
        if (!a.saved.includes(522222)) pv1.push('the saved property the link replaced is not listed');
        if (!/V1 saved/.test(a.toast)) pv1.push(`the toast does not say where the replaced property is: "${a.toast}"`);
        if (b.price !== 344000 || b.kept !== 333000 || !b.saved.includes(711111)) pv1.push(`a second link: deal ${b.price}, slot ${b.kept}, saved ${b.saved.join(', ')} — 333,000 kept aside and 711,111 saved expected`);
        if (pv1.length) fail('audit1 property-model V1: a shared link keeps what it replaces without writing over a deal already kept aside', pv1);
        else ok('audit1 property-model V1: a link opened over a saved property leaves the deal already kept aside where it was (the property stays in My properties, and the toast says so); a link opened over unsaved work keeps that aside and saves the older kept deal as a property first — nothing entered is dropped');
      });

      await step('V2', async () => {
        /* V2 — BACK TO THE CALCULATOR IS BACK TO THE PROPERTY IT HELD. The
           address carries the deal, not which property it is; Back from My
           properties to a calculator address rebuilt the deal from the link
           as an unsaved one, "not saved as a property yet", so its next Save
           made a second copy of a property already saved. */
        const r = await evaluate(`(async () => { ${A1}
          window.__a1Prompt = [];
          /* Started by the reader (userStarted), which no address carries: the
             property comes back as saved, not rebuilt from its address as changed. */
          newPropertyDeal({ show: false }); State.deal.price = 610000; markTouched(State.deal, 'price'); State.deal.userStarted = true; saveDeal();
          const A = saveActiveProperty({ name: 'V2 A' });
          newPropertyDeal({ show: false }); State.deal.price = 420000; markTouched(State.deal, 'price'); saveDeal();
          const B = saveActiveProperty({ name: 'V2 B' });
          openPropertyModel(A.id, { show: false });
          navigate('/property/calculator'); await w(400);
          const n0 = pmAll().length;
          document.getElementById('wb-property-list').click(); await w(400);
          document.getElementById('pm-open-' + B.id).click(); await w(500);
          const onB = State.deal.modelId === B.id;
          history.back(); await w(600);
          history.back(); await w(800);
          const out = { onB, view: State.view, modelId: State.deal.modelId, A: A.id, price: State.deal.price,
            status: txt(document.getElementById('pm-status')), added: pmAll().length - n0 };
          /* A duplicate has the same figures, so the same address: Back from
             it to the property it copies is still Back to that property. */
          const C = duplicatePropertyModel(A.id);
          document.getElementById('wb-property-list').click(); await w(400);
          document.getElementById('pm-open-' + C.id).click(); await w(500);
          const onC = State.deal.modelId === C.id;
          history.back(); await w(600);
          history.back(); await w(800);
          out.dup = { onC, modelId: State.deal.modelId, status: txt(document.getElementById('pm-status')) };
          deletePropertyModel(C.id);
          return out;
        })()`);
        const pv2 = [];
        if (!r.onB) pv2.push('My properties did not open V2 B');
        if (r.view !== 'property' || r.price !== 610000) pv2.push(`Back did not return to V2 A's figures: ${r.view}, ${r.price}`);
        if (r.modelId !== r.A || !/^Editing: V2 A · saved /.test(r.status)) pv2.push(`Back returned V2 A's figures as "${r.status}" (modelId ${r.modelId}), not as the saved property`);
        if (r.added) pv2.push(`${r.added} properties were added by going Back`);
        if (!r.dup.onC || r.dup.modelId !== r.A) pv2.push(`Back from V2 A's duplicate (same figures, same address) stayed on ${r.dup.modelId === r.A ? 'V2 A' : 'the duplicate'}: "${r.dup.status}"`);
        if (pv2.length) fail('audit1 property-model V2: Back to a calculator address reopens the property it showed', pv2);
        else ok('audit1 property-model V2: calculator (V2 A) → My properties → Open V2 B → Back → Back returns to V2 A as the saved property it is — "Editing: V2 A · saved …" — not an unsaved copy whose Save would list it twice; and Back from its duplicate, the same figures at the same address, returns to V2 A too');
      });

      await step('V3', async () => {
        /* V3 — EACH CONTRACT SAYS WHAT ITS SECTION ASKS. On a land parcel
           the Rental section said it asked "for no rent, vacancy or service
           charge" above the rent, vacancy and service-charge fields; the
           Report section asked for the demand sources and its contract did
           not name them. */
        const r = await evaluate(`(async () => { ${A1}
          window.__a1Prompt = [];
          const read = () => ({
            rentalProvide: txt(document.querySelector('#rental .pc-contract')),
            rentInput: !!document.querySelector('#rental #d-rent'), vacInput: !!document.querySelector('#rental #d-vacancyPct'),
            scInput: !!document.querySelector('#rental #d-maintenance'),
            reportProvide: txt(document.querySelector('#report .pc-contract')),
            demandInputs: document.querySelectorAll('#report select[id^="demand-"]').length,
          });
          newPropertyDeal({ show: false }); navigate('/property/calculator'); await w(300);
          const lets = read();
          State.deal.propertyType = 'Land'; State.deal.propertyClassOverride = 'land'; saveDeal(); render(); await w(300);
          const land = read();
          return { lets, land };
        })()`);
        const pv3 = [];
        for (const [k, x] of Object.entries(r)) {
          if ((x.rentInput || x.vacInput || x.scInput) && /asked for no rent|no rent, vacancy or service charge/i.test(x.rentalProvide))
            pv3.push(`${k}: Rental says "${x.rentalProvide}" above its rent, vacancy and service-charge fields`);
          if (x.demandInputs && !/demand/i.test(x.reportProvide)) pv3.push(`${k}: Report asks for ${x.demandInputs} demand sources and says "${x.reportProvide}"`);
        }
        if (r.land.rentInput && !/uses none of them/i.test(r.land.rentalProvide)) pv3.push(`land: Rental does not say its rent fields go unused: "${r.land.rentalProvide}"`);
        if (pv3.length) fail('audit1 property-model V3: each section\'s "You provide" line names what the section asks for', pv3);
        else ok('audit1 property-model V3: on a let property and a land parcel, Rental\'s "You provide" line matches its fields (a parcel\'s rent, vacancy and service-charge fields said to go unused, not said to be absent) and Report\'s names the demand sources it asks for');
      });

      await step('V4', async () => {
        /* V4 — THE PRIMARY SAYS WHAT IT SAVES. With a scenario open, the
           slot's "Save this property" wrote the scenario and left the
           property as it was. It reads "Save this scenario" there. */
        const r = await evaluate(`(async () => { ${A1}
          window.__a1Prompt = [];
          newPropertyDeal({ show: false }); State.deal.price = 500500; markTouched(State.deal, 'price'); saveDeal();
          const rec = saveActiveProperty({ name: 'V4 base' });
          navigate('/property/calculator'); await w(300);
          State.deal.rent = 2100; markTouched(State.deal, 'rent'); saveDeal();
          window.__a1Prompt = ['V4 rent']; saveAsScenario(); render(); await w(250);
          const out = { clean: primaries() };
          State.deal.vacancyPct = 13; markTouched(State.deal, 'vacancyPct'); saveDeal(); render(); await w(250);
          out.scenario = primaries();
          document.getElementById('wb-property-save').click(); await w(300);
          const after = pmFind(rec.id);
          out.wrote = { sc: after.scenarios[0]?.overrides?.vacancyPct, base: pmInputsOf(after).vacancyPct };
          openPropertyModel(rec.id, { show: false }); State.deal.rent = 1999; markTouched(State.deal, 'rent'); saveDeal(); render(); await w(250);
          out.property = primaries();
          deletePropertyModel(rec.id);
          return out;
        })()`);
        const pv4 = [];
        if (r.clean.join('|') !== 'Compare scenarios') pv4.push(`a saved scenario open: ${JSON.stringify(r.clean)}`);
        if (r.scenario.join('|') !== 'Save this scenario') pv4.push(`a scenario open with changes: the primary reads ${JSON.stringify(r.scenario)}`);
        if (r.wrote.sc !== 13 || r.wrote.base === 13) pv4.push(`it saved ${JSON.stringify(r.wrote)}`);
        if (r.property.join('|') !== 'Save this property') pv4.push(`the property open with changes: ${JSON.stringify(r.property)}`);
        if (pv4.length) fail('audit1 property-model V4: the primary action names what it saves', pv4);
        else ok('audit1 property-model V4: the primary reads "Save this scenario" while a scenario with changes is open — and saves the scenario — and "Save this property" on the property itself');
      });

      await step('V5', async () => {
        /* V5 — TWO REGISTER RECORDS THAT SHARE AN ID OPEN AS TWO PROPERTIES.
           Before d7fec29 (28 Sep 2026) a record's id was its position and
           its name — record two, remove one, add the same name, and two
           records shared "opp-2-…". The handoff ties a property to a record
           by id, so the second record opened the first one's property, with
           the first one's price. */
        const r = await evaluate(`(async () => { ${A1}
          window.__a1Prompt = [];
          const rec = (price) => ({ id: 'opp-2-v5-terrace', name: 'V5 terrace', source: '', state: 'captured', capturedAt: '2026-09-01',
            availabilityCheckedAt: null, available: null, deal: { city: 'sibu', district: 'Lanang', propertyType: 'Terrace (2 storey)', price, sqft: 1400,
            projectId: 'custom-sibu', bankValuation: 0, titleType: 'unknown' }, touched: { price: true }, evidence: { price: 'user' }, checks: {},
            negotiatedPrice: null, valuerEstimate: null, nextAction: '', nextActionOwner: '', nextActionDue: '' });
          State.opportunities = [rec(300000), rec(400000)]; saveOpportunities();
          const openNth = async (n) => { navigate('/property/opportunities'); await w(250);
            const card = [...document.querySelectorAll('main .card')].filter(c => c.querySelector('h3')?.textContent === 'V5 terrace')[n];
            [...card.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open in the calculator').click(); await w(400);
            return { price: State.deal.price, modelId: State.deal.modelId }; };
          const first = await openNth(0);
          const second = await openNth(1);
          const again = await openNth(0);
          const ids = State.opportunities.map(o => o.id);
          return { first, second, again, ids, tied: pmAll().filter(p => p.source?.kind === 'opportunity' && /v5-terrace/.test(p.source.id)).length };
        })()`);
        const pv5 = [];
        if (r.first.price !== 300000) pv5.push(`the first record opened at ${r.first.price}`);
        if (r.second.price !== 400000 || r.second.modelId === r.first.modelId) pv5.push(`the second record opened ${r.second.modelId === r.first.modelId ? 'the first one\'s property' : 'a property'} at ${r.second.price}`);
        if (r.again.modelId !== r.first.modelId || r.again.price !== 300000) pv5.push(`the first record, opened again, did not reopen its own property: ${JSON.stringify(r.again)}`);
        if (new Set(r.ids).size !== r.ids.length) pv5.push(`the register still holds a shared id: ${r.ids.join(', ')}`);
        if (r.tied !== 2) pv5.push(`${r.tied} properties are tied to the two records`);
        if (pv5.length) fail('audit1 property-model V5: two register records that shared an id open as their own properties', pv5);
        else ok('audit1 property-model V5: two records written with one id (the pre-d7fec29 scheme) open as two properties at their own prices — the shared id is made unique on the first Open, before any property is tied to it — and each reopens its own');
      });

      await step('V6', async () => {
        /* V6 — THE SAMPLE WITH THE READER'S ANSWERS IN IT IS KEPT TOO. A town
           and district chosen and the checklist answered on the sample's
           figures move no figure, so the deal was not "the reader's" and
           "New property" dropped it without keeping it aside; a link, which
           kept everything, now keeps it the same way. */
        const r = await evaluate(`(async () => { ${A1}
          window.__a1Prompt = [];
          localStorage.removeItem('vl.dealBeforeLink');
          newPropertyDeal({ show: false });
          const id = SARAWAK_CHECKS[0].id;
          State.deal.city = 'miri'; State.deal.district = 'Lutong'; State.deal.projectId = customProjectId('miri');
          State.deal.checks = { ...(State.deal.checks || {}), [id]: 'no' }; saveDeal();
          newPropertyDeal({ show: false });
          const kept = store.read('dealBeforeLink', null);
          /* The untouched sample is not kept over it. */
          newPropertyDeal({ show: false });
          const still = store.read('dealBeforeLink', null);
          return { id, kept: kept && { city: kept.city, district: kept.district, answer: kept.checks?.[id] }, still: still && still.district };
        })()`);
        const pv6 = [];
        if (!r.kept || r.kept.district !== 'Lutong' || r.kept.answer !== 'no') pv6.push(`New property over the sample with a district and an answer of the reader's kept ${JSON.stringify(r.kept)}`);
        if (r.still !== 'Lutong') pv6.push(`a second New property, over the untouched sample, replaced it (${r.still})`);
        if (pv6.length) fail('audit1 property-model V6: New property keeps the sample aside when the reader has chosen a place or answered the checklist on it', pv6);
        else ok('audit1 property-model V6: New property keeps aside the sample with a district chosen and a checklist question answered on it, and a second New property over the untouched sample leaves that kept deal in place');
      });
    } finally {
      await evaluate(`(() => { const k = ${kept}; Object.entries(k).forEach(([key, v]) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v)); return true; })()`);
    }
  }
  /* ---- end audit1: property-model ---- */

} catch (e) {
  fail('harness error', e.message);
} finally {
  try { ws?.close(); } catch {}
  proc.kill();
  /* Chrome holds its profile for a moment after the kill, and its child
     processes a moment longer. Removed at once, the rm failed quietly on
     Windows, and every run left its profile in TEMP: 1,781 of them, 14 GB,
     had filled C: by 28 September 2026 and parallel runs were failing with
     ENOSPC. Wait for the exit, then retry the removal. */
  await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}

console.log(failures
  ? `\n${failures} failed, ${passes} passed. A figure that fails one of these is mislabelled, not merely imprecise.`
  : `\nall ${passes} model invariants hold`);
process.exitCode = failures ? 1 : 0;
