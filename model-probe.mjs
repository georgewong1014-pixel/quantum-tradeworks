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
  /* The page's own uncaught errors, kept so a check that could not run can
     say what the page threw on the way. */
  const pageErrors = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params?.exceptionDetails?.exception?.description || m.params?.exceptionDetails?.text || '').split('\n').slice(0, 3).join(' | '));
  });
  const send = (method, params = {}, sid) => new Promise(res => {
    const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params, sessionId: sid }));
  });
  /* ---- unsaved-prompt ---- */
  /* The Scenario Lab asks before a page holding what-ifs not saved is left
     (beforeunload, 88-property-flow.js; the 11 Oct audit, #8): answered
     "leave", as a reader moving on does — unanswered, the navigation waits
     on it for ever. Nothing else is answered here. */
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data);
    if (m.method === 'Page.javascriptDialogOpening' && m.params?.type === 'beforeunload') send('Page.handleJavaScriptDialog', { accept: true }, m.sessionId).catch(() => {}); });
  /* ---- end unsaved-prompt ---- */

  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);

  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
    /* The protocol's own error (a context destroyed by a navigation, a
       promise collected) said as itself, not as "reading 'result'". */
    if (r.error) throw new Error(`the browser answered: ${r.error.message}${r.error.data ? ` (${r.error.data})` : ''}`);
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description
        || r.result.exceptionDetails.text || 'evaluation threw');
    }
    return r.result.result.value;
  };

  console.log(`target  ${BASE}\n`);
  await send('Page.navigate', { url: `${BASE}/property/calculator?view=full` }, sessionId);
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

  /* ---- scenario-lab ---- */
  /* THE SCENARIO LAB (the owner's decision, 3 Oct 2026): /property/lab, five
     sliders moved live over up to three columns, every figure the
     calculator's own model. Each check is a definition, not an expected
     value, and each fails before the lab existed (d381b5e, ee173ce): the
     route drew the not-found card, the model's two new fields were
     undefined and 82-property-lab.js was absent.
       L1  every [data-lab] figure is dealModel's (or propertyGrade's) field
           for the column's base with its moves, and prints as its format
           — six deals, every slider at its ends, its quarters and ten
           random places, by `input` alone;
       L2  value less loan and the growth on the price are the quantities
           their names say, and net sale proceeds is value less loan less
           the costs of selling;
       L3  one engine: the lab names none of the model's functions;
       L4  one model run a frame, however many inputs arrive in it;
       L5  exploring writes nothing — no storage, no address, no deal, and
           no figure marked as the reader's;
       L6  a commit writes exactly the moved figure, marked as the reader's,
           and Open in the calculator stores the mark with it;
       L7  the keyboard: steps, big steps, the ends and Escape, focus kept,
           a ring shown;
       L8  every control named, every summary saying its label and value;
       L9  the live region: silent on input, one sentence on change, the
           comparison said in A, B, C order;
       L10 the six comparisons are the model's, always A, B, C, never
           ranked;
       L11 the sample's figures are labelled as the tool's;
       L12 the paywall holds: net sale proceeds only with the report;
       L13 a paint takes under a frame on a 4× slower processor;
       L14 no motion under reduced motion, and no transition: all;
       L15 a column with no price runs no model and prints no NaN;
       L16 a redraw nobody asked for waits for the finger, a navigation
           does not;
       L17 the address opens its columns and comparison, an unknown
           property says so, a second panel mounts beside the first, and a
           place opened moves the active column only. */
  {
    const { readFileSync } = await import('node:fs');
    const LKEYS = ['savedWork', 'deal', 'dealBeforeLink', 'propertyReportsBought', 'plan', 'observations', 'lang', 'propertyReportLog', 'servedReads'];
    const lKept = await evaluate(`JSON.stringify(Object.fromEntries(${JSON.stringify(LKEYS)}.map(k => [k, localStorage.getItem('vl.' + k)])))`);
    const lStep = async (name, fn) => {
      try { await fn(); } catch (e) { fail(`scenario-lab ${name}: the check could not run`, String(e.message).split('\n')[0]); }
    };
    /* The page's own helpers. */
    const LH = `const w = (ms) => new Promise(r => setTimeout(r, ms));
      const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const txt = (n) => (n ? n.textContent : '').replace(/\\s+/g, ' ').trim();
      window.prompt = () => null; window.confirm = () => true;
      const L = () => LAB[labSubject];
      const A = () => labActive(L());
      const near = (a, b) => (a === null && b === null) || (isNum(a) && isNum(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));
      /* Every [data-lab] on the page against the model run on the active
         column's base with its moves. */
      const labFigs = () => {
        const col = A(), d = pmMerge(col.baseInputs, col.moves);
        const run = num0(d.price) > 0 ? (() => { const m = dealModel(d); return { m, g: propertyGrade(d, m) }; })() : null;
        const bad = [];
        const nodes = [...document.querySelectorAll('#views [data-lab]')];
        for (const n of nodes) {
          const k = n.dataset.lab, fmt = n.dataset.labFmt;
          const want = !run ? null : k === 'grade' ? run.g.grade : k === 'monthlyCommitment' ? monthlyCommitment(run.m) : run.m[k];
          const dv = n.getAttribute('data-value');
          const got = dv === '' || dv === null ? null : k === 'grade' ? dv : Number(dv);
          const ok = k === 'grade' ? got === (want ?? null) : near(got, isNum(want) ? want : null);
          const shown = LAB_FORMATS[fmt] ? LAB_FORMATS[fmt](want) : '(no format ' + fmt + ')';
          if (!ok || txt(n) !== shown) bad.push(k + ': data-value ' + dv + ' text "' + txt(n) + '", the model ' + want + ' prints "' + shown + '"');
        }
        return { n: nodes.length, bad, run: !!run };
      };
      const setRange = async (k, v) => { const r = document.getElementById('lab-r-' + k); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); await frame(); return r; };
      const typeBox = async (k, v) => { const n = document.getElementById('lab-n-' + k); n.value = String(v); n.dispatchEvent(new Event('change', { bubbles: true })); await frame(); return n; };`;
    const lReload = async (path) => {
      await send('Page.navigate', { url: `${BASE}${path}` }, sessionId);
      await sleep(300);
      for (const t = Date.now(); Date.now() - t < 30000; await sleep(100)) {
        const r = await send('Runtime.evaluate', { expression: `typeof propertyPagesSettled === 'function' && propertyPagesSettled() && State.view !== undefined`, returnByValue: true }, sessionId);
        if (r.result?.result?.value === true) break;
      }
      await sleep(300);
      return evaluate(`State.view`);
    };
    /* A deal on the calculator, and the lab opened on it from a fresh load. */
    const lDeal = async (set, path = '/property/lab') => {
      await evaluate(`(() => { const d = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {}, modelId: null, scenarioId: null, ...${JSON.stringify(set)} };
        localStorage.setItem('vl.deal', JSON.stringify(d)); localStorage.removeItem('vl.dealBeforeLink'); return true; })()`);
      return lReload(path);
    };
    try {
      await lStep('L1', async () => {
        const deals = [['the sample', {}], ['a 30-year hold', { holdYears: 30 }], ['a taxed deal', { marginalTaxPct: 24, rent: 3400 }],
          ['a land class', { propertyType: 'Land', landSqft: 4000 }], ['tenure 0', { tenureYears: 0 }]];
        const problems = [];
        let checked = 0, figures = 0;
        const sweep = async (label) => evaluate(`(async () => { ${LH}
          const out = { checked: 0, figures: 0, bad: [], ranges: [] };
          let seed = 7;
          const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
          for (const inp of LAB_INPUTS) {
            const r = document.getElementById('lab-r-' + inp.k);
            if (!r) continue;
            out.ranges.push(inp.k);
            const lo = Number(r.min), hi = Number(r.max);
            const at = [0, .25, .5, .75, 1, ...Array.from({ length: 10 }, rnd)].map(f => labSnap(lo + (hi - lo) * f, inp.step));
            for (const v of at) {
              await setRange(inp.k, v);
              const col = A();
              if (pmMerge(col.baseInputs, col.moves)[inp.k] !== v) out.bad.push(inp.k + ' at ' + v + ': the column holds ' + pmMerge(col.baseInputs, col.moves)[inp.k]);
              const f = labFigs();
              out.checked++; out.figures += f.n;
              f.bad.slice(0, 2).forEach(b => out.bad.push(inp.k + ' at ' + v + ': ' + b));
              if (f.n < 8) out.bad.push(inp.k + ' at ' + v + ': only ' + f.n + ' figures carry data-lab');
            }
          }
          /* The sweep has moved every knob, the tenure's and the deposit's too
             (phase 2): the column put back as it was opened before its edge
             cases are read, a deal with no tenure being one of them. */
          for (const inp of LAB_INPUTS) { const c = A(); if (c.work[inp.k] !== c.baseInputs[inp.k]) labWrite(c, inp.k, c.baseInputs[inp.k]); }
          labSchedule(); await frame();
          /* The edge cases, in words. */
          const row = (k) => txt(document.querySelector('#views .lab-row[data-row="' + k + '"] summary'));
          out.rows = { netYield: row('netYield'), breakEvenOccupancy: row('breakEvenOccupancy'), instalment: row('instalment') };
          out.view = State.view;
          return out;
        })()`);
        for (const [label, set] of deals) {
          const view = await lDeal(set);
          if (view !== 'propertyLab') { problems.push(`${label}: /property/lab opened ${view}`); continue; }
          const r = await sweep(label);
          checked += r.checked; figures += r.figures;
          r.bad.slice(0, 4).forEach(b => problems.push(`${label}: ${b}`));
          if (r.checked < 15) problems.push(`${label}: only ${r.checked} slider positions were set (sliders: ${r.ranges.join(', ') || 'none'})`);
          if (label === 'a land class') {
            if (!/Net yield\s*—/.test(r.rows.netYield) || !/not a quantity this asset has/.test(r.rows.netYield)) problems.push(`a land class: the yield row reads "${r.rows.netYield}"`);
            if (!/Break-even occupancy\s*—/.test(r.rows.breakEvenOccupancy)) problems.push(`a land class: the occupancy row reads "${r.rows.breakEvenOccupancy}"`);
            if (r.ranges.includes('rent')) problems.push('a land class: the rent slider is offered');
          }
          if (label === 'tenure 0' && (!/Monthly repayment\s*—/.test(r.rows.instalment) || !/tenure is 0/.test(r.rows.instalment))) problems.push(`tenure 0: the repayment row reads "${r.rows.instalment}"`);
        }
        /* A saved property with two scenarios: B is the first scenario. */
        const id = await evaluate(`(async () => { ${LH}
          newPropertyDeal({ show: false });
          const rec = saveActiveProperty({ name: 'L1 two scenarios' });
          pmAddScenario(rec.id, { rent: 2300, touched: { rent: true } }, 'L1 rent 2300');
          pmAddScenario(rec.id, { ratePct: 5.1, touched: { ratePct: true } }, 'L1 rate 5.1');
          return rec.id; })()`);
        const view = await lReload(`/property/lab?model=${id}`);
        if (view !== 'propertyLab') problems.push(`a saved property: /property/lab?model= opened ${view}`);
        else {
          const r = await sweep('a saved property');
          const cols = await evaluate(`LAB[labSubject].cols.map(c => c.source)`);
          if (cols.length !== 3 || cols[0] !== 'base' || !String(cols[1]).startsWith('sc:') || !String(cols[2]).startsWith('sc:')) problems.push(`a saved property with two scenarios opened the columns ${JSON.stringify(cols)}`);
          checked += r.checked; figures += r.figures;
          r.bad.slice(0, 4).forEach(b => problems.push(`a saved property: ${b}`));
        }
        if (problems.length) fail('scenario-lab L1: every live figure is the model’s for the column’s base and moves', problems.slice(0, 20));
        else ok(`scenario-lab L1: ${checked} slider positions over six deals (the sample, a 30-year hold, a taxed deal, a land class, tenure 0, a saved property with two scenarios), ${figures} [data-lab] figures each the model’s field and its own format; land prints — for yield and occupancy, tenure 0 a — with its reason`);
      });

      await lStep('L2', async () => {
        const r = await evaluate(`(() => {
          const base = { ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {} };
          const out = [];
          for (const [label, d] of [['default', base], ['taxed', { ...base, marginalTaxPct: 24, rent: 3400 }], ['30-year', { ...base, holdYears: 30 }],
            ['renovation recovered 50%', { ...base, renoValueRecoveryPct: 50 }], ['tenure 0', { ...base, tenureYears: 0 }]]) {
            const m = dealModel(d), H = m.path.length, bad = [];
            const close = (a, b, t = 1e-6) => isNum(a) && isNum(b) && Math.abs(a - b) <= t;
            if (!isNum(m.outstanding)) {
              if (m.valueLessLoanAtExit !== null) bad.push('valueLessLoanAtExit is ' + m.valueLessLoanAtExit + ' with the debt unknown');
              if (m.path.some(p => p.valueLessLoan !== null)) bad.push('a year carries a value less loan with the debt unknown');
              if (m.netExitProceeds !== null) bad.push('netExitProceeds is ' + m.netExitProceeds + ' with the debt unknown');
            } else {
              if (!isNum(m.valueLessLoanAtExit) || m.valueLessLoanAtExit !== m.exitValue - m.outstanding) bad.push('valueLessLoanAtExit ' + m.valueLessLoanAtExit + ' is not exitValue − outstanding ' + (m.exitValue - m.outstanding));
              if (m.path[H - 1].valueLessLoan !== m.valueLessLoanAtExit) bad.push('path[H−1].valueLessLoan ' + m.path[H - 1].valueLessLoan + ' is not valueLessLoanAtExit');
              m.path.forEach(p => { if (p.valueLessLoan !== p.value - p.balance) bad.push('year ' + p.y + ': valueLessLoan is not value − balance'); });
              if (!close(m.netExitProceeds, m.valueLessLoanAtExit - m.agentFee - m.exitLegal - m.rpgt - m.carryWhileSelling)) bad.push('netExitProceeds ' + m.netExitProceeds + ' is not value less loan less the costs of selling');
            }
            if (!close(num0(d.price) + m.priceGrowthAtExit + m.renoRecovered, m.exitValue)) bad.push('price + priceGrowthAtExit + renoRecovered ' + (num0(d.price) + m.priceGrowthAtExit + m.renoRecovered) + ' is not exitValue ' + m.exitValue);
            out.push({ label, bad, vll: m.valueLessLoanAtExit, growth: m.priceGrowthAtExit, H });
          }
          return out;
        })()`);
        const bad = r.flatMap(x => x.bad.map(b => `${x.label}: ${b}`));
        if (bad.length) fail('scenario-lab L2: the new fields hold their definitions', bad.slice(0, 12));
        else ok(`scenario-lab L2: value less loan is the value at the sale less the loan then, in every year's row and at the exit, null with the debt unknown; price + growth on the price + renovation recovered is the value at the sale; net sale proceeds is value less loan less agent, legal, gains tax and the carry — default, taxed, 30-year, 50% recovered, tenure 0 (${r.map(x => `${x.label} ${Number.isFinite(x.vll) ? x.vll.toFixed(0) : 'null'}`).join(', ')})`);
      });

      await lStep('L3', async () => {
        const BANNED = ['monthlyInstalment', 'balanceAfter', 'interestInYear', 'irrOf', 'npvAt', 'rpgtCharge', 'resolveFee', 'stampDutyMOT', 'legalFeesBuy', 'loanStampDuty', 'Math.pow'];
        let src = '';
        try { src = readFileSync(new URL('./src/js/82-property-lab.js', import.meta.url), 'utf8'); } catch { /* absent */ }
        if (!src) { fail('scenario-lab L3: one engine — src/js/82-property-lab.js is absent'); return; }
        const names = [...new Set([...src.matchAll(/(?:function|const|let)\s+((?:lab|scenarioLab)\w*)/g)].map(m => m[1]))];
        const r = await evaluate(`(() => { const out = {}; ${names.map(n => `if (typeof ${n} === 'function') out[${JSON.stringify(n)}] = Function.prototype.toString.call(${n});`).join(' ')} return out; })()`);
        const hits = [];
        BANNED.forEach(b => { if (src.includes(b)) hits.push(`82-property-lab.js names ${b}`); });
        Object.entries(r).forEach(([n, body]) => BANNED.forEach(b => { if (body.includes(b)) hits.push(`${n} names ${b}`); }));
        if (Object.keys(r).length < 20) hits.push(`only ${Object.keys(r).length} lab functions were found in the page`);
        if (hits.length) fail('scenario-lab L3: the lab carries no second copy of the model', hits);
        else ok(`scenario-lab L3: neither 82-property-lab.js nor any of its ${Object.keys(r).length} lab functions in the page names ${BANNED.join(', ')}`);
      });

      await lStep('L4', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          await frame();
          const real = window.dealModel; let n = 0;
          window.dealModel = function (...a) { n++; return real.apply(this, a); };
          try {
            const rg = document.getElementById('lab-r-ratePct');
            for (let i = 0; i < 50; i++) { rg.value = String(labSnap(Number(rg.min) + (i % 40) * 0.05, 0.05)); rg.dispatchEvent(new Event('input', { bubbles: true })); }
            await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            return { n, rate: A().work.ratePct };
          } finally { window.dealModel = real; }
        })()`);
        if (!(r.n >= 1 && r.n <= 2)) fail('scenario-lab L4: fifty inputs in a frame make one model run', r);
        else ok(`scenario-lab L4: fifty input events in one frame ran the model ${r.n} time${r.n === 1 ? '' : 's'}`);
      });

      await lStep('L5', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const calls = [];
          const rs = history.replaceState, ps = history.pushState, si = Storage.prototype.setItem;
          history.replaceState = function (...a) { calls.push('replaceState'); return rs.apply(this, a); };
          history.pushState = function (...a) { calls.push('pushState'); return ps.apply(this, a); };
          Storage.prototype.setItem = function (k, v) { calls.push('setItem ' + k); return si.call(this, k, v); };
          const before = { deal: pmCanon(State.deal), stored: localStorage.getItem('vl.deal'), href: location.href, work: JSON.stringify(loadWork()),
            marks: JSON.stringify([State.deal.touched, State.deal.evidence]) };
          try {
            let n = 0;
            for (const key of ['B', 'A', 'B']) {
              const radio = document.getElementById('lab-col-' + key);
              if (radio && !radio.checked) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await frame(); }
              for (const inp of LAB_INPUTS) {
                const r = document.getElementById('lab-r-' + inp.k);
                if (!r) continue;
                for (let i = 0; i < 7 && n < 100; i++, n++) {
                  r.value = String(labSnap(Number(r.min) + (Number(r.max) - Number(r.min)) * ((i * 37 + n) % 10) / 10, inp.step));
                  r.dispatchEvent(new Event('input', { bubbles: true }));
                  r.dispatchEvent(new Event('change', { bubbles: true }));
                }
                await frame();
              }
            }
            await w(800);
            const lab = L();
            return { n, calls, cols: lab.cols.map(c => ({ key: c.key, moves: Object.keys(c.moves).length, marks: JSON.stringify([c.work.touched, c.work.evidence]), base: JSON.stringify([c.baseInputs.touched, c.baseInputs.evidence]) })),
              same: { deal: pmCanon(State.deal) === before.deal, stored: localStorage.getItem('vl.deal') === before.stored, href: location.href === before.href,
                work: JSON.stringify(loadWork()) === before.work, marks: JSON.stringify([State.deal.touched, State.deal.evidence]) === before.marks } };
          } finally { history.replaceState = rs; history.pushState = ps; Storage.prototype.setItem = si; }
        })()`);
        const p = [];
        if (r.n < 100) p.push(`only ${r.n} moves were made`);
        if (r.calls.length) p.push(`${r.calls.length} writes: ${[...new Set(r.calls)].join(', ')}`);
        Object.entries(r.same).forEach(([k, v]) => { if (!v) p.push(`${k} changed`); });
        r.cols.forEach(c => { if (c.marks !== c.base) p.push(`column ${c.key}'s touched or evidence changed: ${c.marks}`); });
        if (!r.cols.some(c => c.moves)) p.push('no column holds a move');
        if (p.length) fail('scenario-lab L5: exploring writes nothing and marks nothing as the reader’s', p);
        else ok(`scenario-lab L5: ${r.n} input and change events over every slider and both columns wrote nothing — no replaceState, pushState or setItem; the calculator's deal, its stored copy, the address and the saved work unchanged; no column's touched or evidence moved`);
      });

      await lStep('L6', async () => {
        await lDeal({});
        const id = await evaluate(`(() => { newPropertyDeal({ show: false }); const rec = saveActiveProperty({ name: 'L6 commits' }); return rec.id; })()`);
        await lReload(`/property/lab?model=${id}`);
        const r = await evaluate(`(async () => { ${LH}
          const out = {};
          out.cols = L().cols.map(c => c.source);
          const rent = labSnap(Number(document.getElementById('lab-r-rent').max) - 150, 50);
          await setRange('rent', rent);
          out.rent = rent;
          document.getElementById('lab-save').click(); await frame();
          const f = document.getElementById('lab-scenario-name');
          out.field = !!f && document.activeElement === f;
          f.value = 'L6 rent moved'; f.dispatchEvent(new Event('input', { bubbles: true }));
          document.getElementById('lab-name-save').click(); await frame(); await w(100);
          const rec = pmFind(${JSON.stringify(id)});
          const sc = (rec.scenarios || []).at(-1);
          out.sc = sc && { id: sc.id, name: sc.name, keys: Object.keys(sc.overrides).filter(k => !['touched', 'evidence'].includes(k)), rent: sc.overrides.rent, touched: sc.overrides.touched?.rent };
          out.compare = PM_COMPARE[rec.id];
          out.b = { source: L().cols[1].source, moves: Object.keys(L().cols[1].moves).length };
          /* Update scenario. */
          const rent2 = labSnap(rent - 100, 50);
          await setRange('rent', rent2);
          document.getElementById('lab-update').click(); await frame();
          const rec2 = pmFind(${JSON.stringify(id)});
          out.updated = pmSavedInputs(rec2, pmScenario(rec2, sc.id)).rent;
          out.rent2 = rent2;
          /* Open in the calculator. */
          const rent3 = labSnap(rent2 - 100, 50);
          await setRange('rent', rent3);
          out.rent3 = rent3;
          document.getElementById('lab-open').click(); await w(300);
          out.open = { rent: State.deal.rent, storedTouched: store.read('deal', {}).touched?.rent, modelId: State.deal.modelId, dirty: propertyStatus().dirty, view: State.view };
          return out;
        })()`);
        const p = [];
        if (!r.field) p.push('Save B as a scenario did not put the keyboard in its name field');
        if (!r.sc || JSON.stringify(r.sc.keys) !== '["rent"]' || r.sc.rent !== r.rent) p.push(`the new scenario's overrides: ${JSON.stringify(r.sc)} (moved rent ${r.rent})`);
        if (r.sc && r.sc.touched !== true) p.push('the new scenario does not mark the rent as the reader’s');
        if (!r.compare || !r.sc || !r.compare.includes(r.sc.id)) p.push(`PM_COMPARE: ${JSON.stringify(r.compare)}`);
        if (!r.sc || r.b.source !== `sc:${r.sc.id}` || r.b.moves) p.push(`B after the save: ${JSON.stringify(r.b)}`);
        if (r.updated !== r.rent2) p.push(`Update scenario left the rent at ${r.updated}, not ${r.rent2}`);
        if (r.open.rent !== r.rent3) p.push(`Open B in the calculator: the deal's rent is ${r.open.rent}, not ${r.rent3}`);
        if (r.open.storedTouched !== true) p.push('Open B in the calculator: the stored deal does not mark the rent as the reader’s');
        if (r.open.modelId !== id) p.push(`Open B in the calculator: the deal is of ${r.open.modelId}`);
        if (!r.open.dirty) p.push('Open B in the calculator: the calculator does not say it has unsaved changes');
        if (r.open.view !== 'property') p.push(`Open B in the calculator opened ${r.open.view}`);
        if (p.length) fail('scenario-lab L6: a commit writes exactly what moved, marked as the reader’s', p);
        else ok(`scenario-lab L6: Save B as a scenario (the name asked in the page) wrote overrides of the rent alone, ${r.rent}, marked as the reader's, added to the comparison, and B became the scenario with no moves; Update scenario wrote ${r.rent2}; Open B in the calculator put ${r.rent3} on the calculator's deal and stored it marked as the reader's, of the same property, unsaved`);
      });

      await lStep('L7', async () => {
        await lDeal({});
        await evaluate(`(() => { const r = document.getElementById('lab-r-ratePct'); r.scrollIntoView({ block: 'center' }); r.focus(); return document.activeElement === r; })()`);
        const key = async (k, code, vk, mods = 0) => {
          await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }, sessionId);
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }, sessionId);
          return evaluate(`(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            const n = document.getElementById('lab-r-ratePct');
            return { v: LAB[labSubject] && labActive(LAB[labSubject]).work.ratePct, min: Number(n?.min), max: Number(n?.max), focus: document.activeElement?.id,
              text: document.querySelector('#views [data-lab="instalment"]')?.textContent, outline: n ? getComputedStyle(n).outlineStyle : null }; })()`);
        };
        const s0 = await evaluate(`({ v: labActive(LAB[labSubject]).work.ratePct, text: document.querySelector('#views [data-lab="instalment"]').textContent })`);
        const p = [];
        const r1 = await key('ArrowRight', 'ArrowRight', 39); await key('ArrowRight', 'ArrowRight', 39); const r3 = await key('ArrowRight', 'ArrowRight', 39);
        if (Math.abs(r3.v - (s0.v + 0.15)) > 1e-9) p.push(`ArrowRight ×3 took ${s0.v} to ${r3.v}`);
        if (r1.text === s0.text) p.push('the repayment did not change a frame after the key');
        const r4 = await key('ArrowRight', 'ArrowRight', 39, 8);
        if (Math.abs(r4.v - (r3.v + 0.5)) > 1e-9) p.push(`Shift+ArrowRight took ${r3.v} to ${r4.v}`);
        const r5 = await key('PageUp', 'PageUp', 33);
        if (Math.abs(r5.v - (r4.v + 0.5)) > 1e-9) p.push(`PageUp took ${r4.v} to ${r5.v}`);
        const r6 = await key('PageDown', 'PageDown', 34);
        if (Math.abs(r6.v - r4.v) > 1e-9) p.push(`PageDown took ${r5.v} to ${r6.v}`);
        const r7 = await key('Home', 'Home', 36);
        if (r7.v !== r7.min) p.push(`Home gave ${r7.v}, the span starts at ${r7.min}`);
        const r8 = await key('End', 'End', 35);
        if (r8.v !== r8.max) p.push(`End gave ${r8.v}, the span ends at ${r8.max}`);
        const r9 = await key('Escape', 'Escape', 27);
        if (r9.v !== s0.v) p.push(`Escape left the rate at ${r9.v}, not the gesture's start ${s0.v}`);
        for (const r of [r1, r3, r4, r5, r6, r7, r8, r9]) if (r.focus !== 'lab-r-ratePct') { p.push(`focus moved to ${r.focus}`); break; }
        if (!r9.outline || r9.outline === 'none') p.push(`the focused slider's outline is ${r9.outline}`);
        if (p.length) fail('scenario-lab L7: the keyboard steps, jumps, reaches the ends and undoes, focus kept', p);
        else ok(`scenario-lab L7: on the rate, ArrowRight ×3 is +0.15, Shift+ArrowRight, PageUp and PageDown ±0.50, Home and End the span's ends (${r7.min} and ${r8.max}), Escape back to ${s0.v}; the repayment moved a frame after the key; focus stayed on the slider, ringed (${r9.outline})`);
      });

      await lStep('L8', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const out = { unnamed: [], valuetext: [], summaries: [], legends: [] };
          const named = (n) => (n.labels && n.labels.length) || n.getAttribute('aria-label') || n.getAttribute('aria-labelledby');
          const inputs = [...document.querySelectorAll('#views .lab input[type=range], #views .lab input[type=number]')];
          inputs.forEach(n => { if (!named(n)) out.unnamed.push(n.id); });
          out.inputs = inputs.length;
          const col = A();
          for (const inp of LAB_INPUTS) {
            const r = document.getElementById('lab-r-' + inp.k);
            if (!r) continue;
            const v = col.work[inp.k], t = r.getAttribute('aria-valuetext') || '';
            const want = inp.k === 'ratePct' ? fmtNum(v, 2) + ' percent a year' : inp.k === 'downPct' ? fmtNum(v, 0) + ' percent'
              : inp.k === 'tenureYears' || inp.k === 'holdYears' ? v + ' year' : inp.k === 'vacancyPct' ? fmtNum(v, 0) + ' percent vacant' : fmtNum(v, 0) + ' ringgit';
            if (!t.startsWith(want)) out.valuetext.push(inp.k + ': "' + t + '", not "' + want + '…"');
          }
          document.querySelectorAll('#views .lab-row').forEach(d => {
            const s = txt(d.querySelector('summary')), label = txt(d.querySelector('.lab-row-label')), value = txt(d.querySelector('[data-lab]'));
            if (!s.includes(label) || !s.includes(value)) out.summaries.push(d.dataset.row + ': "' + s + '"');
          });
          out.rows = document.querySelectorAll('#views .lab-row').length;
          out.legends = [...document.querySelectorAll('#views .lab fieldset')].map(f => txt(f.querySelector(':scope > legend')));
          return out;
        })()`);
        const p = [];
        if (r.inputs < 9) p.push(`only ${r.inputs} sliders and boxes`);
        if (r.unnamed.length) p.push(`unnamed: ${r.unnamed.join(', ')}`);
        r.valuetext.forEach(x => p.push(`aria-valuetext ${x}`));
        r.summaries.forEach(x => p.push(`a summary without its label and value: ${x}`));
        if (r.rows !== 8) p.push(`${r.rows} chain rows`);
        for (const want of ['Sliders move', 'Input', 'Compare by']) if (!r.legends.includes(want)) p.push(`no "${want}" legend (${JSON.stringify(r.legends)})`);
        if (p.length) fail('scenario-lab L8: every control and row is named', p);
        else ok(`scenario-lab L8: all ${r.inputs} sliders and boxes are labelled, every slider's aria-valuetext is its value as formatted, all ${r.rows} summaries say their label and value, and the three groups have their legends`);
      });

      await lStep('L9', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const live = document.getElementById('liveStatus');
          live.textContent = '';
          const said = [];
          const mo = new MutationObserver(() => { const t = live.textContent.trim(); if (t) said.push(t); });
          mo.observe(live, { childList: true, characterData: true, subtree: true });
          const rg = document.getElementById('lab-r-ratePct');
          for (let i = 1; i <= 20; i++) { rg.value = String(labSnap(Number(rg.min) + i * 0.05, 0.05)); rg.dispatchEvent(new Event('input', { bubbles: true })); await frame(); }
          await w(200);
          const onInput = said.length;
          const t0 = performance.now();
          rg.dispatchEvent(new Event('change', { bubbles: true }));
          while (performance.now() - t0 < 700 && said.length === onInput) await w(20);
          const after = said.slice(onInput); const at = Math.round(performance.now() - t0);
          await w(300);
          const total = said.length - onInput;
          const radio = document.getElementById('lab-by-cashflow');
          radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
          await w(50);
          const metric = said.at(-1);
          mo.disconnect();
          return { onInput, after, at, total, metric };
        })()`);
        const p = [];
        if (r.onInput) p.push(`${r.onInput} announcement(s) during 20 input events`);
        if (r.total !== 1 || !r.after.length) p.push(`${r.total} announcement(s) after the change`);
        else if (!/Interest rate/.test(r.after[0]) || !/Repayment/.test(r.after[0])) p.push(`the change said "${r.after[0]}"`);
        if (!/Comparing by .*: A .*, B .*Order A, B/.test(r.metric || '')) p.push(`the metric switch said "${r.metric}"`);
        if (p.length) fail('scenario-lab L9: the live region says one sentence a change and the comparison in order', p);
        else ok(`scenario-lab L9: silent through 20 input events; one sentence ${r.at}ms after the change ("${r.after[0]}"); the switch to cash flow said "${r.metric}"`);
      });

      await lStep('L10', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          /* B moved apart from A first, so the two columns differ. */
          await setRange('rent', labSnap(Number(document.getElementById('lab-r-rent').max) - 200, 50));
          await setRange('ratePct', labSnap(Number(document.getElementById('lab-r-ratePct').min) + 1, 0.05));
          const out = { metrics: [], bad: [] };
          const lab = L();
          const runOf = (c) => (c.key === lab.active ? (() => { const m = dealModel(c.work); return { m, g: propertyGrade(c.work, m) }; })() : pmCompareRun(c.work));
          const want = (field, c) => {
            const { m } = runOf(c);
            if (field === 'district') return c.work.district;
            if (field === 'worstMonth') { const xs = [m.stress?.rate?.at(-1)?.monthly, m.letsToTenant === false ? null : m.stress?.vacancy?.at(-1)?.monthly].filter(isNum); return xs.length ? Math.min(...xs) : null; }
            if (field === 'priceVsMedian') return comparableSupport(c.work).priceVsMedian;
            return m[field];
          };
          for (const id of LAB_METRIC_IDS) {
            const radio = document.getElementById('lab-by-' + id);
            radio.focus(); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
            await frame();
            const tables = [...document.querySelectorAll('#views .lab-cmp')];
            const m = { id, tables: tables.length, fields: tables.map(t => t.dataset.field) };
            out.metrics.push(m);
            if (!tables.length) out.bad.push(id + ': no table');
            for (const t of tables) {
              const rows = [...t.querySelectorAll('tr[data-lab-col]')];
              const order = rows.map(x => x.dataset.labCol).join('');
              if (order !== lab.cols.map(c => c.key).join('')) out.bad.push(id + ' ' + t.dataset.field + ': rows in the order ' + order);
              for (const row of rows) {
                const c = lab.cols.find(x => x.key === row.dataset.labCol);
                const w0 = want(t.dataset.field, c), dv = row.getAttribute('data-value');
                const got = typeof w0 === 'string' ? dv : dv === '' ? null : Number(dv);
                if (typeof w0 === 'string' ? got !== w0 : !near(got, isNum(w0) ? w0 : null)) out.bad.push(id + ' ' + t.dataset.field + ' ' + c.key + ': ' + dv + ', the model ' + w0);
              }
            }
            const checked = [...document.querySelectorAll('#views input[name="lab-by"]')].filter(x => x.checked).map(x => x.value);
            if (checked.length !== 1 || checked[0] !== id) out.bad.push(id + ': checked ' + JSON.stringify(checked));
            if (document.activeElement !== document.getElementById('lab-by-' + id)) out.bad.push(id + ': focus went to ' + (document.activeElement?.id || document.activeElement?.tagName));
            if (id === 'entry') for (const row of document.querySelectorAll('#views .lab-cmp[data-field="safeCashRequired"] tr[data-lab-col]')) {
              const c = lab.cols.find(x => x.key === row.dataset.labCol), { m: mm } = runOf(c);
              const segs = [...row.nextElementSibling.querySelectorAll('[data-part]')];
              const parts = Object.fromEntries(segs.map(s => [s.dataset.part, Number(s.getAttribute('data-value'))]));
              for (const k of ['transactionCash', 'improvementCash', 'reserveCash']) if (!near(parts[k], mm[k])) out.bad.push('entry ' + c.key + ': ' + k + ' segment ' + parts[k] + ', the model ' + mm[k]);
              if (Math.abs(Object.values(parts).reduce((a, b) => a + b, 0) - mm.safeCashRequired) > 1e-6) out.bad.push('entry ' + c.key + ': the segments do not sum to cash required');
            }
            if (id === 'appreciation') for (const row of document.querySelectorAll('#views .lab-cmp[data-field="exitValue"] tr[data-lab-col]')) {
              const parts = Object.fromEntries([...row.nextElementSibling.querySelectorAll('[data-part]')].map(s => [s.dataset.part, Number(s.getAttribute('data-value'))]));
              if (Math.abs(parts.price + parts.priceGrowthAtExit + parts.renoRecovered - Number(row.getAttribute('data-value'))) > 1e-6) out.bad.push('appreciation ' + row.dataset.labCol + ': price + growth + renovation recovered is not the value at the sale');
            }
            if (id === 'location' && !/are the same place — location does not separate them/.test(txt(document.getElementById('lab-cmp')))) out.bad.push('location: no same-place card for two columns in one district');
            const words = txt(document.querySelector('#views .lab'));
            const banned = words.match(/\\b(recommend(ed)?|best|winner|top pick|you should|better deal|outperform)\\b/i);
            if (banned) out.bad.push(id + ': the page says "' + banned[0] + '"');
          }
          return out;
        })()`);
        if (r.bad.length) fail('scenario-lab L10: the six comparisons are the model’s, in the order A, B, C', r.bad.slice(0, 16));
        else ok(`scenario-lab L10: all six comparisons (${r.metrics.map(m => `${m.id} ${m.fields.join('+')}`).join('; ')}) carry the model's figure for each column, rows always A, B, one radio checked and focus kept on it; entry cash is completion, renovation and reserve summing to cash required; appreciation is price, growth and renovation recovered summing to the value at the sale; one place said once; no ranking word`);
      });

      await lStep('L11', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const out = {};
          out.status = txt(document.getElementById('lab-status'));
          out.price = txt(document.getElementById('lab-ev-price')); out.rent = txt(document.getElementById('lab-ev-rent'));
          out.row6 = txt(document.querySelector('#views .lab-row[data-row="valueLessLoanAtExit"] .lab-formula'));
          out.row7 = txt(document.querySelector('#views .lab-row[data-row="irrPct"] .lab-formula'));
          const radio = document.getElementById('lab-by-appreciation'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); await frame();
          out.apprec = txt(document.getElementById('lab-cmp'));
          const before = { work: JSON.stringify(A().work.evidence), deal: JSON.stringify(State.deal.evidence) };
          await setRange('rent', labSnap(Number(document.getElementById('lab-r-rent').min) + 100, 50));
          const knob = document.getElementById('lab-knob-rent');
          out.whatIf = [...knob.querySelectorAll('.lab-tag-whatif')].some(t => !t.hidden && t.getClientRects().length && /What-if — not saved/.test(t.textContent));
          out.touched = A().work.touched?.rent === true;
          out.evidence = JSON.stringify(A().work.evidence) === before.work && JSON.stringify(State.deal.evidence) === before.deal;
          return out;
        })()`);
        const p = [];
        if (!/^Sample deal/.test(r.status)) p.push(`the status reads "${r.status}"`);
        for (const k of ['price', 'rent']) if (r[k] !== 'Illustrative default — not yours, and not from any market') p.push(`the ${k} chip reads "${r[k]}"`);
        for (const k of ['row6', 'row7', 'apprec']) if (!/sample assumption/.test(r[k])) p.push(`${k} does not say "sample assumption"`);
        if (!r.whatIf) p.push('a moved rent does not show “What-if — not saved”');
        if (r.touched) p.push('a moved rent is marked as the reader’s');
        if (!r.evidence) p.push('a moved rent changed an evidence grade');
        if (p.length) fail('scenario-lab L11: the sample is labelled as the tool’s, and a move is a what-if', p);
        else ok('scenario-lab L11: on the sample the status says Sample deal, the price and rent chips say Illustrative default — not yours, and not from any market, and rows 6 and 7 and the Appreciation view say sample assumption; a moved rent shows What-if — not saved and is neither touched nor regraded');
      });

      await lStep('L12', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const out = {};
          localStorage.removeItem('vl.plan'); State.plan = 'free';
          State.propertyReportsBought = State.propertyReportsBought.filter(x => x !== State.deal.projectId);
          render(); await frame();
          const col = A(), m = dealModel(col.work);
          const panel = document.querySelector('#views .lab');
          const net = fmtMoney(m.netExitProceeds, 'MYR', 0);
          out.locked = { irr: txt(document.querySelector('#views [data-lab="irrPct"]')) === fmtPct(m.irrPct, 2),
            text: panel.textContent.includes(net), values: [...panel.querySelectorAll('[data-value]')].some(n => n.getAttribute('data-value') === String(m.netExitProceeds)),
            figs: !!panel.querySelector('[data-lab="netExitProceeds"]') };
          State.propertyReportsBought = [...State.propertyReportsBought, State.deal.projectId];
          render(); await frame();
          const node = (k) => document.querySelector('#views [data-lab="' + k + '"]');
          out.open = { net: node('netExitProceeds') && Number(node('netExitProceeds').getAttribute('data-value')) === m.netExitProceeds && txt(node('netExitProceeds')) === net,
            profit: node('totalProfit') && Number(node('totalProfit').getAttribute('data-value')) === m.totalProfit };
          State.propertyReportsBought = State.propertyReportsBought.filter(x => x !== State.deal.projectId);
          render(); await frame();
          return out;
        })()`);
        const p = [];
        if (!r.locked.irr) p.push('locked: row 7 does not show the rate of return');
        if (r.locked.text || r.locked.values || r.locked.figs) p.push(`locked: net sale proceeds reach the panel (${JSON.stringify(r.locked)})`);
        if (!r.open.net || !r.open.profit) p.push(`unlocked: ${JSON.stringify(r.open)}`);
        if (p.length) fail('scenario-lab L12: net sale proceeds and total profit only with the report unlocked', p);
        else ok('scenario-lab L12: with the report locked row 7 shows the rate of return and neither the text nor any data-value carries net sale proceeds; with it unlocked row 7 shows net sale proceeds and total profit, the model’s');
      });

      await lStep('L13', async () => {
        const measure = async () => evaluate(`(async () => { ${LH}
          const rg = document.getElementById('lab-r-ratePct');
          performance.clearMeasures('lab-paint');
          for (let i = 0; i < 200; i++) {
            rg.value = String(labSnap(Number(rg.min) + (i % 120) * 0.05, 0.05));
            rg.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => requestAnimationFrame(r));
          }
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const xs = performance.getEntriesByName('lab-paint').map(e => e.duration).sort((a, b) => a - b);
          const q = (f) => xs[Math.min(xs.length - 1, Math.floor(f * xs.length))];
          return { n: xs.length, median: q(0.5), p95: q(0.95), max: xs.at(-1) };
        })()`);
        await lDeal({});
        await send('Emulation.setCPUThrottlingRate', { rate: 4 }, sessionId);
        let ten, thirty;
        try {
          ten = await measure();
          await send('Emulation.setCPUThrottlingRate', { rate: 1 }, sessionId);
          await lDeal({ holdYears: 30 });
          await send('Emulation.setCPUThrottlingRate', { rate: 4 }, sessionId);
          thirty = await measure();
        } finally { await send('Emulation.setCPUThrottlingRate', { rate: 1 }, sessionId); }
        const p = [];
        if (!(ten.n >= 150)) p.push(`only ${ten.n} paints were measured at a 10-year hold`);
        if (!(ten.median <= 8) || !(ten.p95 <= 16)) p.push(`10-year hold, 4× slower: median ${ten.median?.toFixed(2)}ms, 95th percentile ${ten.p95?.toFixed(2)}ms`);
        if (!(thirty.p95 <= 33)) p.push(`30-year hold, 4× slower: 95th percentile ${thirty.p95?.toFixed(2)}ms`);
        const said = `lab-paint at 4× CPU — 10-year hold: median ${ten.median?.toFixed(2)}ms, p95 ${ten.p95?.toFixed(2)}ms, max ${ten.max?.toFixed(2)}ms (${ten.n} paints); 30-year hold: median ${thirty.median?.toFixed(2)}ms, p95 ${thirty.p95?.toFixed(2)}ms, max ${thirty.max?.toFixed(2)}ms (${thirty.n} paints)`;
        console.log(`      ${said}`);
        if (p.length) fail('scenario-lab L13: a paint fits a frame on a 4× slower processor', p);
        else ok(`scenario-lab L13: ${said}`);
      });

      await lStep('L14', async () => {
        await lDeal({});
        await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
        let r;
        try {
          r = await evaluate(`(() => { const n = document.querySelector('#views .lab-bar-fill'); return n ? getComputedStyle(n).transitionDuration : null; })()`);
        } finally { await send('Emulation.setEmulatedMedia', { features: [] }, sessionId); }
        const normal = await evaluate(`(() => { const n = document.querySelector('#views .lab-bar-fill'); return n ? getComputedStyle(n).transitionDuration : null; })()`);
        const css = readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8');
        const all = /transition\s*:\s*all\b/i.test(css);
        const p = [];
        if (r !== '0s') p.push(`under reduced motion a bar's transition lasts ${r}`);
        if (normal === '0s' || normal === null) p.push(`with motion a bar's transition lasts ${normal}`);
        if (all) p.push('src/styles.css carries transition: all');
        if (p.length) fail('scenario-lab L14: bars hold still under reduced motion, and nothing transitions all', p);
        else ok(`scenario-lab L14: a bar's transition is ${normal} with motion and 0s under reduced motion; src/styles.css has no transition: all`);
      });

      await lStep('L15', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const real = window.dealModel; let n = 0;
          window.dealModel = function (...a) { n++; return real.apply(this, a); };
          let out;
          try {
            await typeBox('price', 0); await frame();
            const panel = document.querySelector('#views .lab');
            const vals = [...document.querySelectorAll('#views .lab-chain [data-lab]')].map(x => txt(x));
            const notes = [...document.querySelectorAll('#views .lab-row-note')].map(x => txt(x));
            out = { n, active: A().key, price: A().work.price, vals, notes, nan: /NaN|Infinity/.test(panel.textContent), cmp: txt(document.querySelector('#views tr[data-lab-col="B"] .lab-cmp-v')) };
          } finally { window.dealModel = real; }
          return out;
        })()`);
        const p = [];
        if (r.price !== 0) p.push(`the box did not set B's price (${r.price})`);
        if (r.n) p.push(`B ran the model ${r.n} time(s) with no price`);
        if (!r.vals.length || r.vals.some(v => v !== '—')) p.push(`values: ${r.vals.join(', ')}`);
        if (r.notes.some(v => v !== 'Needs a purchase price')) p.push(`notes: ${[...new Set(r.notes)].join(' | ')}`);
        if (r.nan) p.push('the panel prints NaN or Infinity');
        if (r.cmp !== 'not computed yet') p.push(`B's comparison row reads "${r.cmp}"`);
        if (p.length) fail('scenario-lab L15: a column with no price runs no model', p);
        else ok(`scenario-lab L15: 0 typed as B's price runs no model; all ${r.vals.length} figures read — with "Needs a purchase price", B's comparison row "not computed yet", and nothing prints NaN or Infinity`);
      });

      await lStep('L16', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const views = document.getElementById('views');
          let replaced = 0;
          const mo = new MutationObserver(recs => { for (const x of recs) if (x.target === views && x.type === 'childList') replaced++; });
          mo.observe(views, { childList: true });
          const out = {};
          const down = (n) => n.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
          const r0 = document.getElementById('lab-r-price');
          down(r0); render(); await w(30);
          out.held = { connected: r0.isConnected, replaced };
          r0.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); await w(30);
          out.up = replaced;
          const r1 = document.getElementById('lab-r-price');
          down(r1); render(); await w(30); const heldBlur = replaced;
          r1.blur(); await w(30); out.blur = replaced - heldBlur;
          const r2 = document.getElementById('lab-r-price');
          down(r2); render(); await w(30); const heldCancel = replaced;
          r2.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })); await w(30); out.cancel = replaced - heldCancel;
          const r3 = document.getElementById('lab-r-price');
          down(r3); navigate('/property/calculator' + (State.view === 'property' && new URLSearchParams(location.search).get('view') === 'full' ? '' : '?view=full')); await w(200);
          out.nav = { view: State.view, drawn: !!document.querySelector('#views #acquisition') };
          render(); await w(30);
          out.afterNav = State.view === 'property';
          mo.disconnect();
          navigate('/property/lab'); await w(200);
          return out;
        })()`);
        const p = [];
        if (!r.held.connected || r.held.replaced) p.push(`a render() during a drag replaced the page (${JSON.stringify(r.held)})`);
        if (r.up !== 1) p.push(`pointerup drew the held redraw ${r.up} time(s)`);
        if (r.blur !== 1) p.push(`blur drew the held redraw ${r.blur} time(s)`);
        if (r.cancel !== 1) p.push(`pointercancel drew the held redraw ${r.cancel} time(s)`);
        if (r.nav.view !== 'property' || !r.nav.drawn) p.push(`a navigation during a drag was held: ${JSON.stringify(r.nav)}`);
        if (p.length) fail('scenario-lab L16: a redraw nobody asked for waits for the finger; a navigation does not', p);
        else ok('scenario-lab L16: render() during a pointer on the price slider left the slider in place and drew nothing; pointerup, blur and pointercancel each drew the held redraw once; a navigation during the hold went at once');
      });

      await lStep('L17', async () => {
        await lDeal({});
        const ids = await evaluate(`(() => { newPropertyDeal({ show: false }); const rec = saveActiveProperty({ name: 'L17 address' });
          const sc = pmAddScenario(rec.id, { rent: 2100, touched: { rent: true } }, 'L17 rent'); return { id: rec.id, sc: sc.id }; })()`);
        const r = await evaluate(`(async () => { ${LH}
          const out = {};
          navigate(${JSON.stringify(`/property/lab?model=${ids.id}&cols=base,${ids.sc}&by=risk`)}); await w(300);
          out.open = { view: State.view, cols: L().cols.map(c => c.source), metric: L().metric, risk: !!document.querySelector('#views .lab-cmp[data-field="dscr"]') };
          const rs = history.replaceState; let n = 0;
          history.replaceState = function (...a) { n++; return rs.apply(this, a); };
          try {
            const radio = document.getElementById('lab-by-cashflow'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
            await w(500);
            out.write = { n, by: new URLSearchParams(location.search).get('by'), model: new URLSearchParams(location.search).get('model') };
            /* A second panel, compact, beside the page's. */
            const box = document.createElement('div'); box.style.width = '420px'; document.getElementById('views').append(box);
            const p2 = scenarioLabPanel(box, { idPrefix: 'map-lab', compact: true, address: false });
            const all = [...document.querySelectorAll('[id]')].map(x => x.id);
            out.dupes = [...new Set(all.filter((x, i) => all.indexOf(x) !== i))];
            const r2 = document.getElementById('map-lab-r-price');
            const before = A().work.price;
            r2.value = String(labSnap(Number(r2.min) + 3000, 1000)); r2.dispatchEvent(new Event('input', { bubbles: true })); await frame();
            out.second = { node: !!p2.node, moved: A().work.price !== before && A().work.price === Number(r2.value), panelShows: txt(box.querySelector('[data-lab="instalment"]')) === txt(document.querySelector('#lab-root [data-lab="instalment"]')) };
            box.remove();
            /* A place opened: the active column only. */
            const dealBefore = pmCanon(State.deal);
            const d0 = A().work.district;
            const other = SARAWAK_CITIES.find(c => c.id === 'kuching').districts.find(x => x !== d0);
            n = 0;
            const res = labOpen({ kind: 'place', city: 'kuching', district: other });
            await w(450);
            out.place = { ok: res.ok, district: A().work.district, want: other, deal: pmCanon(State.deal) === dealBefore, writes: n };
            const refused = labOpen({ kind: 'place', city: 'kuching', district: 'Nowhere in particular' });
            out.refused = refused;
          } finally { history.replaceState = rs; }
          navigate('/property/lab?model=nope'); await w(300);
          out.nope = { view: State.view, subject: labSubject, want: State.deal.modelId ? 'm:' + State.deal.modelId : 'deal', note: txt(document.getElementById('lab-status')) };
          return out;
        })()`);
        const p = [];
        if (r.open.view !== 'propertyLab' || JSON.stringify(r.open.cols) !== JSON.stringify(['base', `sc:${ids.sc}`]) || r.open.metric !== 'risk' || !r.open.risk)
          p.push(`?model=&cols=base,<scenario>&by=risk opened ${JSON.stringify(r.open)}`);
        if (r.write.n !== 1 || r.write.by !== 'cashflow' || r.write.model !== ids.id) p.push(`a metric switch wrote the address ${r.write.n} time(s), by=${r.write.by}, model=${r.write.model}`);
        if (r.dupes?.length) p.push(`duplicate ids with a second panel: ${r.dupes.slice(0, 5).join(', ')}`);
        if (!r.second?.moved) p.push(`the second panel's slider did not move its column (${JSON.stringify(r.second)})`);
        if (!r.place?.ok || r.place.district !== r.place.want || !r.place.deal || r.place.writes) p.push(`labOpen place: ${JSON.stringify(r.place)}`);
        if (r.refused?.ok !== false || !/not one of Kuching's listed districts/.test(r.refused?.why || '')) p.push(`an unlisted district: ${JSON.stringify(r.refused)}`);
        if (r.nope.view !== 'propertyLab' || r.nope.subject !== r.nope.want || !/That property is not saved in this browser/.test(r.nope.note)) p.push(`?model=nope: ${JSON.stringify(r.nope)}`);
        if (p.length) fail('scenario-lab L17: the address, an unknown property, a second panel and a place', p);
        else ok(`scenario-lab L17: ?model=&cols=base,<scenario>&by=risk opens those columns and the Risk view; a switch to cash flow wrote the address once (by=cashflow); a compact second panel (map-lab) mounted with no duplicate id and its slider moved its column; a place opened moved the active column to ${r.place.district} with the calculator's deal unchanged and no address written, and an unlisted district was refused; ?model=nope says the property is not saved and shows the deal on the calculator`);
      });

      /* PHASE 2 (plan 4.1, 4.2, 4.5; 16 Oct 2026): the four knobs the Lab
         gained — the loan tenure, the vacancy allowance, the monthly
         maintenance and the holding period — are inputs the model already
         takes, so the checks are of the knobs and not of any arithmetic:
         each span stays inside what the calculator's own refusal accepts
         (dealEntryRefused); a column's move travels in the address — the
         calculator's deal link, which the Lab's commits write (dealToParam)
         — and comes back the same (applyDealParam); and a refused value in
         that address is skipped, the rest applied. A refused entry typed
         into a knob's box keeps its figure; a cash purchase shows the
         tenure as not applying, in place. Fails on b7ce1a77, which has
         none of the four knobs. */
      await lStep('L18', async () => {
        await lDeal({});
        const r = await evaluate(`(async () => { ${LH}
          const out = { missing: [], spans: [], trip: [], refusedTyped: [], dormant: null, link: null, occ: null };
          const NEW = ['tenureYears', 'vacancyPct', 'maintenance', 'holdYears'];
          for (const k of NEW) if (!LAB_INPUT_BY_K[k] || !document.getElementById('lab-r-' + k)) out.missing.push(k);
          if (out.missing.length) return out;
          /* A span, at any anchor, holds only what the calculator takes. */
          for (const k of NEW) {
            const inp = LAB_INPUT_BY_K[k];
            for (const a of [0, 1, 7, 9, 10, 35, 40, 60, 100, 294, 1850, 572000]) {
              const [lo, hi] = inp.span(a);
              for (const v of [lo, hi, labSnap((lo + hi) / 2, inp.step)]) {
                const why = dealEntryRefused(k, v);
                if (why) out.spans.push(k + ' span at ' + a + ' holds ' + v + ', which the calculator refuses: ' + why);
                if (inp.whole && !Number.isInteger(v)) out.spans.push(k + ' span at ' + a + ' holds ' + v + ', not whole years');
                if (k === 'holdYears' && normHoldYears(v) !== v) out.spans.push('holdYears span at ' + a + ' holds ' + v + ', outside the model\\'s limits');
              }
            }
          }
          /* Real moves, in the active column. */
          const to = { tenureYears: 30, vacancyPct: 14, maintenance: 340, holdYears: 12 };
          for (const k of NEW) await setRange(k, to[k]);
          const col = A();
          for (const k of NEW) if (col.moves[k] !== to[k]) out.trip.push(k + ' is not a move of the column: ' + JSON.stringify(col.moves[k]));
          const fresh = () => ({ ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {} });
          const param = dealToParam(labNext(col));
          const back = fresh();
          applyDealParam(back, param);
          for (const k of NEW) {
            if (back[k] !== to[k]) out.trip.push(k + ' went into the address as "' + param + '" and came back ' + back[k] + ', not ' + to[k]);
            if (!back.touched[k]) out.trip.push(k + ' came back from the address not marked as the reader\\'s own');
          }
          out.param = param;
          /* A refused value in the address is skipped, the rest applied. */
          const linked = fresh();
          applyDealParam(linked, 'tenureYears:-5~vacancyPct:101~maintenance:-10~holdYears:12~rent:2100');
          out.link = { tenure: linked.tenureYears, vac: linked.vacancyPct, maint: linked.maintenance, hold: linked.holdYears, rent: linked.rent,
            def: [PROPERTY_DEFAULT_DEAL.tenureYears, PROPERTY_DEFAULT_DEAL.vacancyPct, PROPERTY_DEFAULT_DEAL.maintenance] };
          /* A refused entry typed into a box keeps its figure. */
          for (const [k, v] of [['maintenance', -50], ['vacancyPct', 101], ['tenureYears', -3]]) {
            const was = A().work[k];
            const n = await typeBox(k, v);
            if (A().work[k] !== was || n.value !== String(was)) out.refusedTyped.push(k + ' typed ' + v + ' left the column at ' + A().work[k] + ' and the box at ' + n.value);
          }
          const whole = await typeBox('tenureYears', 27.6);
          if (A().work.tenureYears !== 28) out.refusedTyped.push('a tenure typed as 27.6 years is ' + A().work.tenureYears + ', not whole years (28)');
          const longHold = await typeBox('holdYears', 99);
          if (A().work.holdYears !== HOLD_YEARS_MAX) out.refusedTyped.push('a hold typed as 99 is ' + A().work.holdYears + ', not the model\\'s ' + HOLD_YEARS_MAX);
          /* A cash purchase has no loan: the tenure is shown as not applying, in place. */
          const rangeBefore = document.getElementById('lab-r-tenureYears');
          await setRange('downPct', 100);
          out.dormant = { off: document.getElementById('lab-r-tenureYears').disabled && document.getElementById('lab-n-tenureYears').disabled,
            same: document.getElementById('lab-r-tenureYears') === rangeBefore, chip: document.getElementById('lab-in-tenureYears').disabled,
            why: txt(document.getElementById('lab-span-tenureYears')) };
          await setRange('downPct', 10);
          out.dormant.on = !document.getElementById('lab-r-tenureYears').disabled && !document.getElementById('lab-in-tenureYears').disabled;
          /* The vacancy knob says its occupancy: exactly 100 less it. */
          await setRange('vacancyPct', 14);
          out.occ = txt(document.querySelector('#lab-knob-vacancyPct .lab-knob-note'));
          return out;
        })()`);
        const p = [];
        if (r.missing.length) p.push(`the Lab has no slider for ${r.missing.join(', ')}`);
        else {
          r.spans.slice(0, 6).forEach(x => p.push(x));
          r.trip.slice(0, 6).forEach(x => p.push(x));
          if (r.link.tenure !== r.link.def[0] || r.link.vac !== r.link.def[1] || r.link.maint !== r.link.def[2] || r.link.hold !== 12 || r.link.rent !== 2100)
            p.push(`an address of refused values was not skipped as they are: ${JSON.stringify(r.link)}`);
          r.refusedTyped.forEach(x => p.push(x));
          if (!r.dormant.off || !r.dormant.same || !r.dormant.chip || !/A cash purchase has no loan/.test(r.dormant.why) || !r.dormant.on)
            p.push(`a deposit of 100% should show the tenure as not applying in place, and back on at 10%: ${JSON.stringify(r.dormant)}`);
          if (!/Assumed occupancy is exactly 100 less this allowance: 86%/.test(r.occ)) p.push(`the vacancy knob's note reads "${r.occ}"`);
        }
        if (p.length) fail('scenario-lab L18: the tenure, vacancy, maintenance and holding-period knobs', p);
        else ok(`scenario-lab L18: the four knobs added in phase 2 each stand as a slider; every span, at twelve anchors, holds only what dealEntryRefused takes (and whole years, and the model's own hold limits); a move of each travels in the address as ${r.param.split('~').filter(x => /^(tenureYears|vacancyPct|maintenance|holdYears):/.test(x)).join(', ')} and comes back the same, marked the reader's; an address of tenureYears:-5, vacancyPct:101 and maintenance:-10 skips those and applies holdYears:12 and rent:2100; typed, a negative maintenance, a 101% vacancy and a negative tenure keep their figures, 27.6 years is 28 and 99 is held to ${30}; a 100% deposit shows the tenure off in place, its reason in sight, and on again at 10%; the vacancy knob says its occupancy is exactly 100 less it`);
      });
    } finally {
      await send('Emulation.setCPUThrottlingRate', { rate: 1 }, sessionId).catch(() => {});
      await send('Emulation.setEmulatedMedia', { features: [] }, sessionId).catch(() => {});
      await evaluate(`(() => { const k = ${lKept}; Object.entries(k).forEach(([key, v]) => v == null ? localStorage.removeItem('vl.' + key) : localStorage.setItem('vl.' + key, v)); return true; })()`).catch(() => {});
    }
  }
  /* ---- end scenario-lab ---- */

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
