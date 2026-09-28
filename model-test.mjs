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

  /* P10 — the NAPIC type column wraps between words on a phone. */
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
        const words = c.textContent.split(/\\s+/);
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;white-space:nowrap;visibility:hidden';
        probe.className = 'caption';
        c.appendChild(probe);
        const w = Math.max(...words.map(x => { probe.textContent = x; return probe.getBoundingClientRect().width; }));
        probe.remove();
        return w;
      }));
      const col = cells[0].getBoundingClientRect().width;
      host.remove();
      return { col, widest };
    })()`);
    if (r.skip) fail('the NAPIC dataset did not load, so the type column could not be checked');
    else if (!(r.col >= r.widest)) fail(`the NAPIC type column is ${Math.round(r.col)}px at 358px, narrower than its longest word (${Math.round(r.widest)}px) — words break inside`, r);
    else ok(`the NAPIC type column holds its longest word at 358px — ${Math.round(r.col)}px`, r);
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
      document.getElementById('disposerCategory').focus();
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
    if (sel.active !== 'disposerCategory' || sel.v !== 'foreign') fail('arrow keys on the seller lose focus after the first press', r);
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
        const btns = [...document.querySelectorAll('main .segmented button')];
        out[path] = { n: btns.length, silent: btns.filter(b => b.getAttribute('aria-pressed') !== (b.getAttribute('aria-selected') === 'true' ? 'true' : 'false')).length };
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
