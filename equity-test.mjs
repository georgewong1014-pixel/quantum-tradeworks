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
/* CDP_PORT pins the debugging port, so harnesses run side by side (several
   worktrees, or CI jobs on one runner) cannot land on the same Chrome. */
const port = Number(process.env.CDP_PORT) || 9360 + (process.pid % 40);
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
/* Equity too, because the ingest's instant rule is what a regeneration can
   change and revenue is a duration fact it cannot touch. Apple's balance
   sheet at 28 September 2024 reports total shareholders' equity of $56,950m;
   Microsoft's at 30 June 2025 reports $343,479m. */
const GOLDEN = [
  { id: 'AAPL-SEC', fy: 2024, rev: 391.035, eq: 56.950 },
  { id: 'MSFT-SEC', fy: 2025, rev: 281.724, eq: 343.479 },
  { id: 'NVDA-SEC', fy: 2025, rev: 130.497 },
];

/* A hung evaluate() used to leave the job running to the runner's limit.
   The limit was 240s when this file held 23 checks; it holds over 200 now.
   Measured on the Release A merge (2026-09-29): 160s and 175s for a whole
   run on a desktop machine, of which the three Release A blocks take about
   4s — so 240s left a quarter of the run as headroom, and a runner half as
   fast again would have been killed mid-check with nothing hung. 360s is
   twice the measured run: still minutes short of any runner's own limit,
   which is the hang this exists to end early. */
let closing = false;
const WATCHDOG_S = 360;
const watchdog = setTimeout(() => { console.error(`FAIL  timed out after ${WATCHDOG_S}s`); process.exit(1); }, WATCHDOG_S * 1000);
proc.on('exit', () => { if (!closing) { console.error('FAIL  the browser exited before the checks finished'); process.exit(1); } });

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
  /* Every company in the file, not "at least a hundred". loadRealData skips a
     company whose shape breaks the engine, by name, in a console warning —
     and the awkward shapes are exactly the ones the checks below exist to
     examine. A gate at 100 let up to nineteen of them go missing unremarked,
     and would have passed a regeneration that lost three tickers to a 429. */
  const expected = (await (await fetch(`${BASE}/data/us.json`)).json()).results.length;
  let real = 0, status = null;
  for (let i = 0; i < 80 && real < expected; i++) {
    await sleep(500);
    try { real = await evaluate(`typeof U === 'undefined' ? 0 : U.filter(r => r.c.real).length`); } catch { /* not booted yet */ }
  }
  try { status = await evaluate(`typeof realStatus === 'undefined' || !realStatus ? null : { added: realStatus.added, broken: realStatus.broken || [] }`); } catch { /* absent */ }
  if (real !== expected || (status && status.broken.length)) {
    fail(`${real} of ${expected} filed companies loaded — the checks below need every one`, { real, expected, broken: status?.broken });
    throw new Error('the filed set did not load in full; the remaining checks would be vacuous');
  }
  ok(`${real} filed companies loaded, all ${expected} in the file`, { real, expected });

  /* An entitled session. The Free plan covers five distinct company reports
     a month and this harness opens more than that; the sixth used to render
     the "you have used all 5" card in place of the page under test, which is
     the product working and the test not. The prototype's plan toggle takes
     no payment; the profile is temporary. */
  await evaluate(`State.plan = 'pro'; store.write('plan', 'pro'); true`);

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
      return { k, rev: k < 0 ? null : row.c.fin[k][0], eq: k < 0 ? null : row.c.fin[k][5], years: [y[0], y[y.length - 1]] };
    })()`);
    if (r.missing) fail(`${g.id} is not in the universe`, r);
    else if (r.k < 0) fail(`${g.id} has no FY${g.fy} — window is FY${r.years[0]}–FY${r.years[1]}`, r);
    else if (Math.abs(r.rev - g.rev) > 1e-6) fail(`${g.id} FY${g.fy} revenue is ${r.rev}, filing says ${g.rev}`, r);
    else if (g.eq != null && (!Number.isFinite(r.eq) || Math.abs(r.eq - g.eq) > 1e-6)) fail(`${g.id} FY${g.fy} equity is ${r.eq}, the balance sheet says ${g.eq}`, r);
    else ok(`${g.id} FY${g.fy} revenue ${r.rev}bn${g.eq != null ? ` and equity ${r.eq}bn` : ''} match the filing, found under its own label`, r);
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

  /* 5 — a split withholds every per-share growth rate whose window spans it:
         the whole-series rates on a break anywhere, the four-year rates on a
         break among the five rows they read (perShareBreak). */
  {
    const r = await evaluate(`(() => {
      const split = U.filter(r => r.c.real && r.m.shareSeriesBreak);
      const leaks = [];
      for (const r of split) for (const k of ['eps5', 'bv5', 'dps5', 'eps10', 'dps10', 'dilution', 'buyback'])
        if (isNum(r.m[k]) && (!['eps5', 'bv5', 'dps5'].includes(k) || r.m.perShareBreak)) leaks.push({ id: r.c.id, k, v: r.m[k] });
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
      else ok('MSFT-SEC statement table prints no NaN or undefined');
      if (!r.quarterly) fail('a filed company still shows an invented quarterly profile', r);
      else ok('a filed company shows no invented quarters — the page says they are not carried');
    }
  }

  /* 6b — an absent line names its reason in the cell where it is absent, on a
          company that actually has one. Microsoft has none, so the check above
          could not fail on the defect it was written for. Ford carries no debt
          line in its latest years; Dominion no capex line in its latest. The
          cell read a blanket n/a until the statements explorer; it now prints
          the short reason (not reported, withheld) and carries the sentence. */
  for (const [id, label] of [['F-SEC', 'Net debt'], ['D-SEC', 'Capital expenditure'], ['D-SEC', 'Free cash flow']]) {
    await evaluate(`openResearch(${JSON.stringify(id)}, 'financials'); true`);
    await sleep(1200);
    const r = await evaluate(`(() => {
      const tables = [...document.querySelectorAll('table.dt')];
      const stmt = tables.find(t => t.querySelector('thead th')?.textContent.trim() === 'Line' && /CAGR/.test(t.querySelector('thead')?.textContent || ''));
      if (!stmt) return { missing: true };
      const row = [...stmt.querySelectorAll('tbody tr')].find(tr => (tr.querySelector('td')?.textContent.trim() || '').startsWith(${JSON.stringify(label)}));
      if (!row) return { noRow: true };
      const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim());
      return { latest: cells[cells.length - 2], cells: cells.slice(1) };
    })()`);
    if (r.missing || r.noRow) fail(`${id}: the ${label} row was not found on the Financials tab`, r);
    else if (!['not reported', 'withheld'].includes(r.latest) || /-0\.000/.test(r.cells.join(' '))) fail(`${id}: ${label} prints "${r.latest}" for an absent latest line, not its reason`, r);
    else ok(`${id}: ${label} reads "${r.latest}" where its input is absent`, r);
  }

  /* 7 — a filed company's Filings tab holds the real index and no sample list. */
  {
    await evaluate(`openResearch('MSFT-SEC', 'filings'); true`);
    await sleep(1200);
    const r = await evaluate(`(() => {
      const c = BY_ID.get('MSFT-SEC').c;
      const cards = [...document.querySelectorAll('main .card')];
      /* Scoped to the Filings card: the identity header and the provenance
         strip also say "CIK", so a page-wide match could not fail. */
      const card = cards.find(cd => /SEC filings/.test(cd.textContent));
      const links = card ? [...card.querySelectorAll('a[href*="sec.gov"]')].map(a => a.href) : [];
      return { hasCard: !!card, cik: card ? card.textContent.includes('CIK ' + c.cik) : false,
               sample: cards.some(cd => /Sample document list/.test(cd.textContent)), links: links.length,
               edgar: links.some(h => /browse-edgar/.test(h)), facts: links.some(h => /companyfacts/.test(h)) };
    })()`);
    if (r.sample) fail('a filed company\'s Filings tab still carries the invented sample document list', r);
    else if (!r.hasCard || !r.cik || !r.edgar || !r.facts) fail('a filed company\'s Filings card does not carry its CIK and link the real EDGAR index and companyfacts record', r);
    else ok(`a filed company's Filings card carries its CIK, links EDGAR and its companyfacts record (${r.links} links), and invents nothing`, r);
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

  /* 9 — the no-valuation card names the reason and prints no undefined, on
         whichever company currently needs a bridge and lacks one. Chosen
         from the data rather than named, so a dataset change cannot turn the
         check into a fallback that passes. */
  {
    const pick = await evaluate(`(() => {
      /* Every earlier refusal ruled out — a share count, and a positive base
         for the packs that compound one — so the bridge is what is missing. */
      const r = U.find(r => r.c.real && r.c.type !== 'bank' && !isNum(r.m.netDebt) && ['dcf', 'scenario', 'sotp'].includes(r.val.pack.id)
        && last(r.d.sh) > 0 && (r.val.pack.id === 'scenario' || last(r.d.fcf) > 0));
      return r ? { id: r.c.id, err: r.val.err || null, pack: r.val.pack.id } : null;
    })()`);
    if (!pick) fail('no filed company needs a net-debt bridge and lacks one — the no-valuation card has no case to render');
    else if (!pick.err || !/Net debt could not be established/.test(pick.err)) fail(`${pick.id} has no net debt and its valuation does not say so`, pick);
    else {
      await evaluate(`openResearch(${JSON.stringify(pick.id)}, 'valuation'); true`);
      await sleep(1200);
      const t = await evaluate(`document.querySelector('main')?.textContent || ''`);
      if (/undefined/.test(t)) fail(`${pick.id} valuation tab prints "undefined"`);
      else if (!/Net debt could not be established/.test(t)) fail(`${pick.id} valuation tab does not state why no estimate is shown`);
      else ok(`${pick.id} valuation tab states that net debt could not be established, and prints no undefined`);
    }
  }

  /* 10 — fiscal-year labels on every tab, not only the statement table. The
          original defect was a label from the global axis; any surface that
          still reads it would print FY2016 for a 2017–2026 company. */
  {
    const bad = [];
    for (const tab of ['snapshot', 'business', 'financials', 'quality', 'valuation', 'moat', 'risks', 'ownership', 'filings']) {
      await evaluate(`openResearch('MSFT-SEC', ${JSON.stringify(tab)}); true`);
      await sleep(900);
      const r = await evaluate(`(() => { const t = document.querySelector('main')?.textContent || ''; return { fy2016: /FY2016\\b/.test(t), fy2026: /FY2026\\b/.test(t) }; })()`);
      if (r.fy2016) bad.push(`${tab}: FY2016`);
      if (['snapshot', 'financials', 'quality', 'ownership', 'filings'].includes(tab) && !r.fy2026) bad.push(`${tab}: no FY2026`);
    }
    if (bad.length) fail('a research tab still labels MSFT-SEC from the illustrative axis', bad);
    else ok('every research tab labels MSFT-SEC with its own fiscal years — no FY2016 anywhere, FY2026 where the latest year is named');
  }

  /* 11 — the nine methods refuse a missing bridge or share count rather than
          producing a number. */
  {
    /* FCFE (method 4) is an equity flow and needs no bridge — Schlumberger,
       with debt but no cash line, legitimately carries one — so it is held
       only to the share count; EPV and the peer multiple (7, 8) to both. */
    const r = await evaluate(`(() => {
      const leaks = [];
      for (const r of U.filter(r => r.c.real && r.c.type !== 'bank' && r.c.type !== 'reit')) {
        const noShares = !(last(r.d.sh) > 0), noBridge = !isNum(r.m.netDebt);
        if (!noShares && !noBridge) continue;
        for (const x of nineMethods(r)) {
          const mustBeNull = (x.n === 4 && noShares) || ([7, 8].includes(x.n) && (noShares || noBridge));
          if (mustBeNull && isNum(x.value)) leaks.push({ id: r.c.id, n: x.n, name: x.name, value: x.value });
        }
      }
      return leaks;
    })()`);
    if (r.length) fail(`${r.length} nine-method values computed without a bridge or a share count`, r.slice(0, 6));
    else ok('FCFE, EPV and the peer multiple report not applicable wherever the bridge or the share count is missing');
  }

  /* 12 — the statement table's per-share CAGR cell reads "withheld" across a
          split, and a whole-company line keeps its rate. */
  {
    await evaluate(`openResearch('NVDA-SEC', 'financials'); true`);
    await sleep(1200);
    const r = await evaluate(`(() => {
      const tables = [...document.querySelectorAll('table.dt')];
      const stmt = tables.find(t => t.querySelector('thead th')?.textContent.trim() === 'Line' && /CAGR/.test(t.querySelector('thead')?.textContent || ''));
      if (!stmt) return { noTable: true, where: location.pathname + location.search, view: State.view, tab: State.researchTab, heads: tables.map(t => t.querySelector('thead th')?.textContent.trim()), main: (document.querySelector('main')?.textContent || '').slice(0, 120) };
      const lastCell = (label) => { const row = [...stmt.querySelectorAll('tbody tr')].find(tr => (tr.querySelector('td')?.textContent.trim() || '').startsWith(label)); const c = row ? [...row.querySelectorAll('td')] : []; return c.length ? c[c.length - 1].textContent.trim() : null; };
      return { split: !!BY_ID.get('NVDA-SEC').m.shareSeriesBreak, eps: lastCell('Earnings per share'), rev: lastCell('Revenue') };
    })()`);
    if (r.noTable) fail('NVDA-SEC statement table not found on the Financials tab', r);
    else if (!r.split) ok('NVDA-SEC no longer carries a share-series break — withheld cell covered by check 5', r);
    else if (r.eps !== 'withheld' || !/^[+−-]\d/.test(r.rev)) fail('the statement table does not withhold the per-share CAGR across a split while keeping revenue\'s', r);
    else ok(`NVDA-SEC's EPS CAGR reads withheld across its split while revenue keeps its rate (${r.rev})`, r);
  }

  /* 13 — no unpriced filed company is warned that a per-share input is "far
          above the share price" of nought. */
  {
    const r = await evaluate(`(() => U.filter(r => r.c.real && !isNum(r.c.px?.p))
      .flatMap(r => consistencyWarnings(r.c, r.d, r.inputs).map(w => ({ id: r.c.id, text: w.text })))
      .filter(w => /far above the share price/.test(w.text)))()`);
    if (r.length) fail(`${r.length} unpriced companies are warned against a share price of nought`, r.slice(0, 4));
    else ok('no unpriced filed company is warned against a share price it does not have');
  }

  /* 14 — three small promises: the search finds a Bursa code, the saved-case
          button's route exists, and no analytics script is included. It was
          included once; analytics was never switched on, so the tag only
          logged a 404 on every first load, and the launch audit removed it
          until it returns with a consent notice. */
  {
    const r = await evaluate(`(() => {
      runSearch('1155');
      const found = [...searchResults.querySelectorAll('button')].some(b => /MAYBANK|Malayan Banking/.test(b.textContent));
      searchResults.replaceChildren();
      return { found, theses: !!matchRoute('/my/theses'), insights: document.querySelectorAll('script[src*="_vercel/insights"]').length };
    })()`);
    if (!r.found) fail('searching the Bursa code 1155 does not list Maybank', r);
    else if (!r.theses) fail('/my/theses does not resolve to a route', r);
    else if (r.insights !== 0) fail(`the analytics script is included ${r.insights} times — analytics is not switched on and the tag only 404s`, r);
    else ok('the search finds a Bursa code, /my/theses resolves, and no analytics script is included', r);
  }

  /* 15 — the tab is in the address, a foreign tab does not cross views, and
          focus lands where the page changed. */
  {
    const r = await evaluate(`(async () => {
      const out = {};
      navigate('/company/msft-microsoft-corp?personal=1');
      openResearch('MSFT-SEC', 'financials');
      out.tabInAddress = location.search;
      out.selectedTabFocused = document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.getAttribute('aria-selected') === 'true';
      go('discover', { tab: 'screener' });
      out.screenerPath = location.pathname; out.screenerSearch = location.search;
      out.mainFocused = document.activeElement === document.getElementById('main');
      let threw = null;
      try { navigate('/discover?tab=financials'); } catch (e) { threw = e.message; }
      out.threw = threw; out.discoverTab = State.discoverTab; out.view = State.view;
      out.rendered = /Stock Screener|Narrow the universe/.test(document.querySelector('main')?.textContent || '');
      navigate('/company/msft-microsoft-corp?tab=valuation');
      navigate('/learn');
      out.learnSearch = location.search;
      return out;
    })()`);
    const problems = [];
    if (!/(^|[?&])tab=financials(&|$)/.test(r.tabInAddress)) problems.push(`tab not in address: ${r.tabInAddress}`);
    if (!/(^|[?&])personal=1(&|$)/.test(r.tabInAddress)) problems.push(`?personal=1 dropped by a tab click: ${r.tabInAddress}`);
    if (!r.selectedTabFocused) problems.push('focus did not return to the selected tab after a tab change');
    /* The tab must leave the query; every other parameter — ?personal=1 from
       the step before — must stay. That is the rule, not a leak. */
    if (!/\/discover\/screener$/.test(r.screenerPath) || /(^|[?&])tab=/.test(r.screenerSearch)) problems.push(`go(discover, screener) went to ${r.screenerPath}${r.screenerSearch}`);
    if (!/(^|[?&])personal=1(&|$)/.test(r.screenerSearch)) problems.push(`?personal=1 did not survive go(): ${r.screenerSearch}`);
    if (!r.mainFocused) problems.push('focus did not land on main after a view change');
    if (r.threw) problems.push(`/discover?tab=financials threw: ${r.threw}`);
    if (r.view !== 'discover' || !r.rendered || !['screener', 'radar', 'ideas', 'heatmap'].includes(r.discoverTab)) problems.push(`a research tab reached the discover view: tab=${r.discoverTab} rendered=${r.rendered}`);
    if (/tab=valuation/.test(r.learnSearch)) problems.push(`a research tab rode onto /learn: ${r.learnSearch}`);
    if (problems.length) fail('the address, focus and cross-view tab rules do not hold', problems);
    else ok('tabs live in the address, other parameters survive, a foreign tab never crosses views, and focus follows the page');
  }
  /* THE STATUS BEHIND EVERY ABSENCE. An empty screener cell has to say why —
     one of five reasons — and the reason has to be the true one: a bank's
     return on invested capital is not applicable, an unpriced filer's P/E
     needs a price, interest cover is not reported for anyone, a partially
     captured revenue line withholds the margins, a filer with no dividend
     line names that line, an illustrative company's figure is illustrative
     and a filer's computed margin is calculated. Then every field on every
     company: a status always comes back, and it agrees with whether the
     value is there. */
  {
    const r = await evaluate(`(() => {
      const pick = (pred) => U.find(pred);
      const bank = pick(x => x.c.type === 'bank' && x.c.real);
      const noPx = pick(x => x.c.real && !isNum(x.c.px?.p) && isNum(x.m.eps) && x.m.eps > 0);
      const illus = pick(x => !x.c.real && isNum(x.m.roe));
      /* Chosen from the raw lines, not from the flag under test: picked by
         m.revenueSuspect, a derive() that stopped setting the flag left no
         fixture, the check was skipped and the test still passed. */
      const suspect = pick(x => { const l = x.c.fin[x.c.fin.length - 1];
        return x.c.real && l[F.REV] > 0 && isNum(l[F.EBIT]) && l[F.EBIT] > l[F.REV]; });
      const anyReal = pick(x => x.c.real);
      const calcRow = pick(x => x.c.real && isNum(x.m.om));
      const missing = pick(x => x.c.real && !isNum(x.c.fin[x.c.fin.length - 1][F.DPS]) && !x.m.perShareScaleBroken);
      const out = {
        bankRoic: bank ? metricStatus(bank, 'roic') : null,
        noPxPe: noPx ? metricStatus(noPx, 'pe') : null,
        illusRoe: illus ? metricStatus(illus, 'roe') : null,
        icov: anyReal ? metricStatus(anyReal, 'icov') : null,
        suspectOm: suspect ? metricStatus(suspect, 'om') : null,
        calc: calcRow ? metricStatus(calcRow, 'om') : null,
        noDps: missing ? metricStatus(missing, 'payout') : null,
        /* A rule with no company to test it on is reported, not passed. */
        untested: [!suspect && 'withheld (no filer has EBIT above revenue)',
                   !missing && 'dividend line not reported (every filer reports DPS)'].filter(Boolean),
      };
      let bad = 0, n = 0; const reasons = {};
      for (const row of U) for (const f of FIELDS) {
        n++;
        const s = metricStatus(row, f.k);
        if (!s || s.available !== isNum(row.m[f.k]) || (!s.available && !(s.reason && s.text && s.label))) bad++;
        if (s && !s.available) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
      }
      out.bad = bad; out.n = n; out.reasons = reasons;
      return out;
    })()`);
    const problems = [];
    if (r.bankRoic?.reason !== 'not applicable') problems.push(`a bank's ROIC: ${JSON.stringify(r.bankRoic)}`);
    if (r.noPxPe?.reason !== 'needs a price') problems.push(`an unpriced filer's P/E: ${JSON.stringify(r.noPxPe)}`);
    if (r.illusRoe?.id !== 'illustrative') problems.push(`an illustrative company's ROE: ${JSON.stringify(r.illusRoe)}`);
    if (r.icov?.reason !== 'not reported') problems.push(`interest cover: ${JSON.stringify(r.icov)}`);
    if (r.suspectOm && r.suspectOm.reason !== 'withheld') problems.push(`a suspect revenue line's margin: ${JSON.stringify(r.suspectOm)}`);
    if (r.calc?.id !== 'calculated') problems.push(`a filer's computed margin: ${JSON.stringify(r.calc)}`);
    if (r.noDps && !(r.noDps.reason === 'not reported' && /dividend per share/.test(r.noDps.text))) problems.push(`a filer without a dividend line, payout: ${JSON.stringify(r.noDps)}`);
    if (r.bad) problems.push(`${r.bad} of ${r.n} field × company statuses disagree with the value`);
    if (problems.length) fail('every absent figure names its reason and every present one its kind', problems);
    else ok(`every absent figure names its reason and every present one its kind (${r.n} pairs; absences: ${Object.entries(r.reasons).map(([k, v]) => `${k} ${v}`).join(', ')})`
      + (r.untested.length ? `; UNTESTED — no fixture: ${r.untested.join('; ')}` : ''));

    /* And on the screener itself: an empty cell prints the reason, carries it
       as a title, and opens the drawer that names the input behind it. */
    await evaluate(`navigate('/discover/screener')`);
    await sleep(800);
    const d = await evaluate(`(() => {
      const span = document.querySelector('td.cell-sourced .cell-absent');
      if (!span) return { none: true, sourced: document.querySelectorAll('td.cell-sourced').length };
      const td = span.closest('td');
      td.click();
      const drawer = document.querySelector('.drawer');
      const txt = drawer ? drawer.textContent : '';
      const out = { label: span.textContent, title: span.getAttribute('title') || '',
        open: !!drawer && !drawer.hidden,   /* data-open lands a frame later; hidden flips at once */
        why: /Why it is absent/.test(txt), inputs: /Inputs/.test(txt) };
      try { closeDrawer(); } catch { /* already closed */ }
      return out;
    })()`);
    const p2 = [];
    if (d.none) p2.push(`no empty cell on the default screener (${d.sourced} sourced cells)`);
    else {
      if (!['not reported', 'n/a', 'withheld', 'no price', 'n/m'].includes(d.label)) p2.push(`cell prints "${d.label}"`);
      if (!d.title) p2.push('cell carries no title');
      if (!d.open || !d.why) p2.push(`drawer did not open with the reason (open=${d.open} why=${d.why})`);
      if (!d.inputs) p2.push('drawer has no inputs table');
    }
    if (p2.length) fail('an empty screener cell says why and opens the drawer that names the input', p2);
    else ok(`an empty screener cell says why ("${d.label}") and opens the drawer that names the input`);
  }
  /* ONE IDENTITY PER LISTED THING. A company has one row; a market and a
     symbol name one instrument; every name it has ever had — the ticker, the
     listing code, the CIK, the vendor form, the id a link was shared under
     before its filer loaded — resolves to that instrument; a filer retires its
     illustrative stand-in even when the stand-in's ticker sits in c.code; and
     the ids the app seeds its watchlists, compare set and alerts with all
     resolve after the filers have loaded. */
  {
    const r = await evaluate(`(() => {
      const ids = U.map(x => x.c.id);
      const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);
      const keys = U.map(x => x.c.mkt + ':' + String(x.c.code || x.c.tk).toUpperCase());
      const dupKeys = keys.filter((v, i) => keys.indexOf(v) !== i);
      const reg = rebuildInstruments();
      const own = (t) => { const id = companyIdFor(t); return id ? BY_ID.get(id)?.c.id || null : null; };
      const aapl = own('AAPL'), sec = own('AAPL-SEC'), cik = own('CIK0000320193'), us = own('US:AAPL');
      const kl = own('1155.KL'), my = own('MY:1155'), name = own('MAYBANK'), code = own('1155');
      const seeds = State.watchlists.flatMap(w => w.ids).concat(State.compare, State.priceAlerts.map(a => a.ticker));
      const dangling = seeds.filter(id => !BY_ID.has(id));
      const slug = companyFromSlug('aapl-apple-inc'), slugMy = companyFromSlug('1155-malayan-banking-berhad'), slugCik = companyFromSlug('CIK0000320193');
      const tracked = [...INSTRUMENTS.values()].filter(i => i.dataStatus === 'UNAVAILABLE').length;
      const filed = [...INSTRUMENTS.values()].filter(i => i.dataStatus === 'FILED').length;
      const clash = INSTRUMENT_ALIAS_CLASHES.slice(0, 5);
      const sym = instrumentSymbolFor(BY_ID.get(my).c);
      return { dupIds, dupKeys, reg, aapl, sec, cik, us, kl, my, name, code, dangling, slug, slugMy, slugCik, tracked, filed, clash, sym, total: U.length };
    })()`);
    const problems = [];
    if (r.dupIds.length) problems.push(`duplicate company ids: ${r.dupIds.join(', ')}`);
    if (r.dupKeys.length) problems.push(`the same market:symbol on two rows: ${r.dupKeys.join(', ')}`);
    if (!(r.aapl === 'AAPL-SEC' && r.sec === 'AAPL-SEC' && r.cik === 'AAPL-SEC' && r.us === 'AAPL-SEC')) problems.push(`AAPL by ticker / -SEC / CIK / canonical id resolves to ${r.aapl} / ${r.sec} / ${r.cik} / ${r.us}`);
    if (r.slug !== 'AAPL-SEC' || r.slugCik !== 'AAPL-SEC') problems.push(`/company/aapl-apple-inc → ${r.slug}; /company/CIK0000320193 → ${r.slugCik}`);
    if (!r.my || !(r.my === r.kl && r.my === r.name && r.my === r.code && r.my === r.slugMy)) problems.push(`Maybank's names disagree: MY:1155 ${r.my}, 1155.KL ${r.kl}, MAYBANK ${r.name}, 1155 ${r.code}, slug ${r.slugMy}`);
    if (r.sym !== '1155') problems.push(`Maybank's history symbol is ${r.sym}, not 1155`);
    if (r.dangling.length) problems.push(`seeded ids that no longer resolve: ${r.dangling.join(', ')}`);
    if (r.filed < 100) problems.push(`only ${r.filed} filed instruments in the registry`);
    if (problems.length) fail('one identity per listed thing, every old name resolving to it', problems);
    else ok(`one identity per listed thing: ${r.reg} instruments (${r.filed} filed, ${r.tracked} price-only), ${r.total} company rows, no duplicate ids, every alias and seed resolves${r.clash.length ? `, ${r.clash.length} alias clash(es) recorded` : ''}`);

    /* The brief's paths open the same pages, and its tab names land on ours. */
    const p = {};
    for (const [path, want] of [['/app/equities/aapl/financials', ['research', 'financials', 'AAPL-SEC']], ['/app/equities/1155/ratios', ['research', 'quality', null]],
                                ['/app/equities/CIK0000320193', ['research', 'snapshot', 'AAPL-SEC']], ['/app/watchlists', ['watchlists']], ['/app/equities/explore', ['researchHome']], ['/app/equities/compare', ['compare']], ['/equities/methodology', ['learn']]]) {
      const got = await evaluate(`(() => { navigate(${JSON.stringify(path)}); return { view: State.view, tab: State.researchTab, ticker: State.ticker, rendered: !!document.querySelector('main h1, main h2') }; })()`);
      const bad = got.view !== want[0] || (want[1] && got.tab !== want[1]) || (want[2] && got.ticker !== want[2]) || !got.rendered;
      if (bad) p[path] = got;
    }
    if (Object.keys(p).length) fail('the brief\'s /app/equities paths open the existing pages with the right tab and company', p);
    else ok('the brief\'s /app/equities and /app/watchlists paths open the existing pages, with its tab names mapped to ours');
  }
  /* WATCHLISTS AS ONE SERVICE. Create; add by a listing code, a CIK, an old
     id; refuse the same company under another name as a duplicate; refuse an
     unknown name and a price-only instrument with the reason; present each
     member with its canonical instrument id; hand the scanner the symbols;
     rename, remove, delete; and export a versioned document that says it
     belongs to this browser. Then the page: create, add and scanner controls. */
  {
    const r = await evaluate(`(() => {
      const before = State.watchlists.length;
      const c = wlCreate('Harness list'); if (!c.ok) return { err: c.why };
      const w = c.watchlist;
      const a1 = wlAdd(w.id, '1155'), a2 = wlAdd(w.id, 'MAYBANK'), a3 = wlAdd(w.id, 'CIK0000320193'), a4 = wlAdd(w.id, 'ZZZNOPE');
      const po = [...INSTRUMENTS.values()].find(i => i.dataStatus === 'UNAVAILABLE');
      const a5 = po ? wlAdd(w.id, po.symbol) : null;
      const items = watchlistItems(w);
      const syms = watchlistSymbols(w.id);
      const rn = wlRename(w.id, 'Harness renamed');
      const ex = watchlistsExport();
      const exList = ex.watchlists.find(x => x.id === w.id);
      const rm = wlRemove(w.id, a1.id);
      const afterRemove = w.ids.length;
      const del = wlDelete(w.id);
      return { before, after: State.watchlists.length, a1: a1.ok, a2dup: !!a2.duplicate, a3: a3.ok,
        a4: a4.ok ? 'added?!' : a4.why, a5: a5 ? (a5.ok ? 'added?!' : a5.why) : 'no price-only instrument loaded',
        n: items.length, instIds: items.map(i => i.instrumentId), syms: syms.symbols,
        rn: rn.ok && w.name === 'Harness renamed', exSchema: ex.schema, exOwner: ex.owner, exItems: exList?.items?.length,
        exHasInst: !!exList?.items?.every(i => i.instrumentId), rm: rm.ok, afterRemove, del: del.ok, stamped: !!w.createdAt && !!w.updatedAt };
    })()`);
    const problems = [];
    if (r.err) problems.push(r.err);
    else {
      if (!r.a1 || !r.a3) problems.push(`adding by listing code / CIK: ${r.a1} / ${r.a3}`);
      if (!r.a2dup) problems.push('the same company under another name was not refused as a duplicate');
      if (r.a4 === 'added?!' || !/nothing in the universe/.test(r.a4)) problems.push(`an unknown name: ${r.a4}`);
      if (r.a5 === 'added?!' || !(/price only/.test(r.a5) || /no price-only/.test(r.a5))) problems.push(`a price-only instrument: ${r.a5}`);
      if (r.n !== 2 || !r.instIds.every(x => /^(US|MY):/.test(x || ''))) problems.push(`items ${r.n}, instrument ids ${JSON.stringify(r.instIds)}`);
      if (!(r.syms.length === 2 && r.syms.includes('1155') && r.syms.includes('AAPL'))) problems.push(`symbols for the scanner: ${JSON.stringify(r.syms)}`);
      if (!r.rn) problems.push('rename did not take');
      if (r.exSchema !== 2 || !/this browser/.test(r.exOwner || '') || r.exItems !== 2 || !r.exHasInst) problems.push(`export: schema ${r.exSchema}, owner "${r.exOwner}", ${r.exItems} items, all with instrument ids ${r.exHasInst}`);
      if (!r.rm || r.afterRemove !== 1) problems.push(`remove: ${r.rm}, ${r.afterRemove} left`);
      if (!r.del || r.after !== r.before) problems.push(`delete: ${r.del}, ${r.after} lists (was ${r.before})`);
      if (!r.stamped) problems.push('a new list carries no timestamps');
    }
    if (problems.length) fail('watchlists are one service: create, add by any name, no duplicates, remove, rename, delete, export with instrument ids', problems);
    else ok('watchlists are one service: create, add by any name, no duplicates, remove, rename, delete, export with instrument ids');

    await evaluate(`navigate('/app/watchlists')`);
    await sleep(500);
    const page = await evaluate(`(() => ({ view: State.view,
      create: !!document.querySelector('input[aria-label="New watchlist name"]'),
      add: document.querySelectorAll('input[aria-label^="Add a company to"]').length,
      scan: [...document.querySelectorAll('button')].some(b => /scanner universe/.test(b.textContent)),
      rows: document.querySelectorAll('main table.dt tbody tr').length,   /* main: the drawer keeps its last table after closing */
      instIds: [...document.querySelectorAll('main table.dt tbody tr td:nth-child(4)')].map(td => td.textContent).filter(t => /^(US|MY):/.test(t)).length }))()`);
    if (page.view !== 'watchlists' || !page.create || !page.add || !page.scan || page.instIds !== page.rows) fail('the watchlists page carries create, add and scanner controls and an instrument id per member', page);
    else ok(`the watchlists page carries create, add and scanner controls, and an instrument id on each of its ${page.rows} member rows`);
  }
  /* THE REASON IS THE TRUE ONE. An insurer's inapplicable measure names the
     insurer, not a bank; a non-bank whose equity is negative is told about its
     equity, not about banks; a missing statement line is named before a price
     is asked for, because a price would not fill it; a price measure shows no
     "prior period" made of today's price and last year's statements; and a
     share count that came from the weighted diluted line says so. */
  {
    const r = await evaluate(`(() => {
      const ins = U.find(x => x.c.real && x.c.type === 'insurer' && !isNum(x.m.roic));
      const negEq = U.find(x => x.c.real && x.c.type !== 'bank' && !isNum(x.m.netGearing) && isNum(x.m.netDebt) && isNum(x.c.fin[x.c.fin.length - 1][F.EQ]) && x.c.fin[x.c.fin.length - 1][F.EQ] <= 0);
      const noDps = U.find(x => x.c.real && !isNum(x.c.px?.p) && !isNum(x.c.fin[x.c.fin.length - 1][F.DPS]));
      const out = {
        ins: ins ? { ...metricStatus(ins, 'roic'), cid: ins.c.id } : null,
        negEq: negEq ? { ...metricStatus(negEq, 'netGearing'), cid: negEq.c.id } : null,
        noDps: noDps ? { ...metricStatus(noDps, 'dy'), cid: noDps.c.id } : null,
      };
      /* The drawer for a price measure and for a share-count input. */
      const aapl = BY_ID.get('AAPL-SEC');
      openSourceDrawer(aapl, FIELD_BY_K.pe);
      const peTxt = document.querySelector('.drawer')?.textContent || '';
      closeDrawer({ restore: false });
      const wtd = U.find(x => x.c.real && x.c.provenance?.sh && !x.c.provenance.sh.byYear?.[latestFy(x.c)] && x.c.provenance.shWtd?.byYear?.[latestFy(x.c)]);
      let shTxt = null;
      if (wtd) { openSourceDrawer(wtd, FIELD_BY_K.pb); shTxt = document.querySelector('.drawer')?.textContent || ''; closeDrawer({ restore: false }); }
      out.pePrior = /Prior period\\s*not shown/.test(peTxt);
      out.wtd = wtd ? { id: wtd.c.id, weighted: /weighted diluted/.test(shTxt), tag: /WeightedAverage/.test(shTxt) } : null;
      return out;
    })()`);
    const p = [];
    if (!r.ins) p.push('no filed insurer without ROIC to test');
    else if (r.ins.reason !== 'not applicable' || /bank/i.test(r.ins.text) || !/insurer/.test(r.ins.text)) p.push(`insurer ${r.ins.cid} ROIC: ${r.ins.reason} — ${r.ins.text}`);
    if (r.negEq && (/bank/i.test(r.negEq.text) || !/equity/i.test(r.negEq.text))) p.push(`negative-equity ${r.negEq.cid} net gearing: ${r.negEq.text}`);
    if (r.noDps && (r.noDps.reason !== 'not reported' || !/dividend per share/.test(r.noDps.text) || !/price alone would not fill it/.test(r.noDps.text))) p.push(`unpriced ${r.noDps.cid} with no DPS line, yield: ${r.noDps.reason} — ${r.noDps.text}`);
    if (!r.pePrior) p.push('the drawer for P/E still prints a prior period made of today\'s price');
    if (r.wtd && !(r.wtd.weighted && r.wtd.tag)) p.push(`${r.wtd.id}: the share-count input does not name the weighted diluted tag it came from`);
    if (p.length) fail('every absent figure gives the true reason, and the drawer states what it used', p);
    else ok(`every absent figure gives the true reason (insurer ${r.ins.cid}${r.negEq ? `, negative equity ${r.negEq.cid}` : ''}${r.noDps ? `, no dividend line ${r.noDps.cid}` : ''}), a price measure shows no false prior period${r.wtd ? `, and ${r.wtd.id}'s share count names its weighted diluted tag` : ''}`);
  }
  /* THE SHELL KEEPS ITS WORD. Every company's own path resolves to it (BRK-B's
     did not); a malformed escape is an unknown company, not an exception; the
     compare list reads any name a company address accepts; moving between
     companies keeps a tab carried in the path; leaving a view drops its
     parameters on go() as on navigate(); /learn with no tab is the dictionary;
     the header marks the section of every sub-page; aliases share a canonical;
     the market chip names the market; and Enter in the search answers the text
     in the box, not the list from before the debounce. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const out = {};
      out.roundtrip = U.filter(x => companyFromSlug(companyPath(x.c).split('/')[2]) !== x.c.id).map(x => x.c.id);
      out.total = U.length;
      try { out.malformed = String(companyFromSlug('%E0%A4%A')); } catch (e) { out.malformed = 'threw ' + e.message; }
      history.replaceState(null, '', '/app/equities/compare?companies=aapl-sec,1155,klcc');
      applyRoute();
      out.compare = State.compare.slice(0, 3).join(',');
      out.compareWant = [companyFromSlug('aapl-sec'), companyFromSlug('1155'), companyFromSlug('klcc')].join(',');
      navigate('/app/equities/aapl/financials'); openResearch('JPM-SEC');
      out.carried = State.researchTab;
      history.replaceState(null, '', '/property/calculator?city=sibu&d=x&real=1'); applyRoute();
      go('plans');
      out.plans = location.pathname + location.search;
      navigate('/learn?tab=scoring'); navigate('/corrections'); navigate('/learn');
      out.learn = State.learnTab;
      out.nav = {};
      /* Release A: the app's sidebar or, on a public page, the header's
         Resources menu — whichever chrome the page wears marks it. */
      for (const p of ['/app/equities', '/discover/sarawak', '/property/areas', '/learn/product-boundaries', '/my/scanner']) {
        navigate(p);
        out.nav[p] = (document.querySelector('#appnav a[aria-current=page] .sb-text') || document.querySelector('#pubnav a[aria-current=page]'))?.textContent.trim() || null;
      }
      const canon = () => document.querySelector('link[rel=canonical]').getAttribute('href').replace(location.origin, '');
      navigate('/app/equities/aapl'); const c1 = canon();
      navigate('/company/aapl-sec'); const c2 = canon();
      out.canon = [c1, c2];
      const reg = [...INSTRUMENTS.values()].find(i => i.market && !['US', 'MY'].includes(i.market));
      out.chip = reg ? [reg.market, marketChip(reg.market)?.textContent, reg.currency] : null;
      navigate('/learn'); openSearch(); await w(100);
      searchInput.value = 'nvda'; searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await w(200);
      out.enter = State.ticker;
      /* ?real=1 was set above to test that go() keeps it; it is global by
         design, so it would ride into every later check's address. Cleared. */
      history.replaceState(null, '', location.pathname);
      return out;
    })()`);
    const p = [];
    if (r.roundtrip.length) p.push(`companyPath does not resolve back for: ${r.roundtrip.join(', ')}`);
    if (r.malformed !== 'null') p.push(`a malformed escape: ${r.malformed}`);
    if (r.compare !== r.compareWant) p.push(`?companies=aapl-sec,1155,klcc selected ${r.compare}, not ${r.compareWant}`);
    if (r.carried !== 'financials') p.push(`moving to JPM from /app/equities/aapl/financials landed on ${r.carried}`);
    if (r.plans !== '/pricing?real=1') p.push(`go('plans') from the calculator went to ${r.plans}`);
    if (r.learn !== 'dictionary') p.push(`/learn after /corrections shows the ${r.learn} tab`);
    const wantNav = { '/app/equities': 'Equities Research', '/discover/sarawak': 'Equities Research', '/property/areas': 'Property Intelligence', '/learn/product-boundaries': 'What this product will not do', '/my/scanner': 'Quantum Scanner' };
    for (const [k, v] of Object.entries(wantNav)) if (r.nav[k] !== v) p.push(`${k}: the header marks ${r.nav[k]}, not ${v}`);
    if (r.canon[0] !== r.canon[1] || !/^\/company\/aapl-/.test(r.canon[0])) p.push(`AAPL's canonicals: ${r.canon.join(' vs ')}`);
    if (r.chip && (r.chip[1] !== r.chip[0] || r.chip[2] !== null)) p.push(`a ${r.chip[0]} instrument shows the chip ${r.chip[1]} and currency ${r.chip[2]}`);
    if (r.enter !== 'NVDA-SEC') p.push(`Enter inside the search debounce opened ${r.enter}, not NVDA-SEC`);
    if (p.length) fail('the shell: every company path resolves, parameters and tabs travel as documented, the header and canonical are right, search answers the box', p);
    else ok(`the shell: all ${r.total} company paths resolve back, a malformed escape is unknown, ?companies= reads any name, a path tab travels, go() drops view parameters, /learn is the dictionary, the header marks every sub-page, aliases share a canonical, and Enter answers the box`);
  }


  /* 16 — the shipped file's misassembled figures are withheld, never shown as
          filed: a share count read from CommonStockSharesIssued (treasury
          included), a debt figure that is a current portion alone or a total
          with its own current portion added again, and a sector label from a
          SIC rule since corrected. Each withheld cell names its reason. */
  {
    const r = await evaluate(`(() => {
      const leaks = [];
      for (const row of U.filter(x => x.c.real && !x.c.personal && !x.c.basis)) {
        const c = row.c, p = c.provenance || {};
        c.years.forEach((y, k) => {
          const L = p.debtL?.byYear?.[y], C = p.debtC?.byYear?.[y];
          if (isNum(c.fin[k][6]) && C && (!L || L === 'LongTermDebt')) leaks.push(c.id + ' debt FY' + y);
          if (isNum(c.fin[k][8]) && p.sh?.byYear?.[y] === 'CommonStockSharesIssued') leaks.push(c.id + ' shares FY' + y);
        });
        const sic = String(c.sic || '');
        if ((/^37/.test(sic) && !/^371/.test(sic) && c.industry === 'Automobiles') || (/^28/.test(sic) && !/^283/.test(sic) && c.industry === 'Pharmaceuticals') || (/^738/.test(sic) && c.industry === 'Media & Services'))
          leaks.push(c.id + ' sector ' + c.industry);
      }
      const ko = BY_ID.get('KO-SEC'), apd = BY_ID.get('APD-SEC');
      return { leaks, koPayout: metricStatus(ko, 'payout'), apdDe: metricStatus(apd, 'de'), apdCash: apd.m.netCash };
    })()`);
    const p = [];
    if (r.leaks.length) p.push(`${r.leaks.length} misassembled figures still shown: ${r.leaks.slice(0, 6).join(', ')}`);
    if (r.koPayout.reason !== 'withheld' || !/CommonStockSharesIssued/.test(r.koPayout.text)) p.push(`KO payout: ${r.koPayout.reason} — ${r.koPayout.text}`);
    if (r.apdDe.reason !== 'withheld' || r.apdCash != null) p.push(`APD debt/equity: ${r.apdDe.reason}, net cash ${r.apdCash}`);
    if (p.length) fail('the shipped file\'s misassembled shares, debt and sector labels are withheld with their reason', p);
    else ok('no share count read from the issued tag, no current-portion-only or double-counted debt, no misfiled sector is shown; KO\'s payout and APD\'s debt/equity read "withheld" with the reason');
  }

  /* 17 — a measure declared not applicable is not computed, and a growth rate
          needs both endpoints of its window. Capital One's 324% FCF margin,
          Cigna's ROIC and ConocoPhillips' 55.5% "four-year" FCF CAGR over a
          window whose last three years are missing were all published. */
  {
    const r = await evaluate(`(() => {
      const inapplicable = [], cagr = [], coverage = [];
      for (const row of U) {
        for (const k of INAPPLICABLE[row.c.type] || []) if (isNum(row.m[k])) inapplicable.push(row.c.id + '.' + k);
        for (const [k, s] of [['rev5', row.d.rev], ['fcf5', row.d.fcf], ['eps5', row.d.eps], ['bv5', row.d.bvps]]) {
          const w = s.slice(-5);
          if (isNum(row.m[k]) && !(isNum(w[0]) && isNum(w[w.length - 1]))) cagr.push(row.c.id + '.' + k);
        }
        if (row.m.coverage !== metricCoverage(row.m, row.c.type)) coverage.push(row.c.id + ' ' + row.m.coverage + ' vs ' + metricCoverage(row.m, row.c.type));
      }
      const s = blankScreen(); s.crit.fcfm = { min: 100, max: null }; s.minCoverage = 0;
      return { inapplicable, cagr, coverage, fcfm100: U.filter(x => evaluateScreen(x, s).pass).map(x => x.c.id) };
    })()`);
    const p = [];
    if (r.inapplicable.length) p.push(`${r.inapplicable.length} not-applicable measures carry a value: ${r.inapplicable.slice(0, 6).join(', ')}`);
    if (r.cagr.length) p.push(`${r.cagr.length} growth rates computed without both window endpoints: ${r.cagr.slice(0, 6).join(', ')}`);
    if (r.coverage.length) p.push(`${r.coverage.length} rows whose stored coverage differs from their measures: ${r.coverage.slice(0, 4).join(', ')}`);
    if (r.fcfm100.length) p.push(`FCF margin ≥ 100% still matches ${r.fcfm100.join(', ')}`);
    if (p.length) fail('not-applicable measures are null, growth rates span their whole window, and coverage matches the measures present', p);
    else ok('every not-applicable measure is null, every growth rate has both window endpoints, and every row\'s coverage is recounted after history loads');
  }

  /* 18 — the valuation engine: no negative value per share, no DCF from a
          non-positive base, no WACC outside its own components, no insurer
          combined ratio or solvency that was never reported, no residual
          income without a reported ROE, no "zero share price" for a missing
          one, and a bull or bear shift that breaks leaves the base standing. */
  {
    const r = await evaluate(`(() => {
      const p = [];
      for (const row of U) {
        const v = row.val, i = row.inputs, c = row.c;
        if (v.vals) for (const [k, x] of Object.entries(v.vals)) if (isNum(x) && x < 0) p.push(c.id + ' ' + k + ' ' + x.toFixed(2));
        if (i.model === 'dcf' && !(i.fcf0 > 0)) p.push(c.id + ' DCF from fcf0 ' + i.fcf0);
        if ((i.model === 'dcf' || i.model === 'scenario') && i.waccFromBook !== false && !isNum(row.m.mcap) && !(last(row.d.eq) > 0)) p.push(c.id + ' WACC weighted on non-positive book equity');
        if (i.model === 'insurer' && !c.ins && (i.combined != null || i.solvency != null)) p.push(c.id + ' insurer combined/solvency invented');
        if ((i.model === 'ri' || i.model === 'insurer') && !isNum(row.m.roe)) p.push(c.id + ' residual income without a reported ROE');
        if (/zero share price/.test(v.err || '') && !isNum(c.px?.p)) p.push(c.id + ' blames a zero price it does not have');
        if (v.vals && isNum(v.vals.base) && !(v.vals.base > 0) && v.confBand !== 'Low') p.push(c.id + ' nil value at ' + v.confBand + ' confidence');
      }
      const ten = BY_ID.get('TENAGA');
      const bull = valuationRun(ten.c, ten.d, { ...ten.inputs, wacc: 6, gt: 5.4 });
      const wiped = valuationRun(ten.c, ten.d, { ...ten.inputs, fcf0: 0.05 });
      const years0 = ['MSFT-SEC', 'SAPNRG', 'TENAGA'].map(id => { const x = BY_ID.get(id); try { return runModel({ ...studioInputs(x), years: 0 }).error || 'no error'; } catch (e) { return 'threw ' + e.message; } });
      const sap = BY_ID.get('SAPNRG');
      const ax = sensAxis(SENS_AXES.early.x, { ...sap.inputs, pSuccess: 95 }).values;
      return { p, bull: { err: bull.err, notes: bull.caseNotes.length, bullVal: bull.vals?.bull, base: bull.vals?.base },
               wiped: { base: wiped.vals?.base, flag: wiped.base.equityWipedOut, band: wiped.confBand }, years0, ax };
    })()`);
    const p = [...r.p];
    if (r.bull.err || r.bull.notes !== 1 || r.bull.bullVal !== null || !(r.bull.base > 0)) p.push(`a broken bull shift hid the base case: ${JSON.stringify(r.bull)}`);
    if (r.wiped.base !== 0 || !r.wiped.flag || r.wiped.band !== 'Low') p.push(`negative modelled equity is not nil at Low confidence: ${JSON.stringify(r.wiped)}`);
    if (r.years0.some(e => !/whole number of at least 1/.test(e))) p.push(`zero forecast years: ${r.years0.join(' | ')}`);
    if (r.ax.some(v => v > 100) || new Set(r.ax).size !== r.ax.length) p.push(`the probability axis leaves 0–100: ${r.ax.join(', ')}`);
    if (p.length) fail('the valuation engine produces no figure its inputs cannot support', p.slice(0, 10));
    else ok(`no negative or unsupported value anywhere in the universe; a broken bull shift leaves the base; nil equity is Low confidence; zero forecast years is an engine error; the probability axis stays inside 0–100 (${r.ax.join(', ')})`);
  }

  /* 19 — the nine methods place every pack's primary estimate on its own row,
          and a peer multiple compares like with like — filed with filed, in
          the same market, and an insurer on price-to-book. */
  {
    const r = await evaluate(`(() => {
      const p = [];
      for (const row of U) {
        const nm = nineMethods(row), prim = nm.filter(x => x.primary);
        if (prim.length !== 1) p.push(row.c.id + ' has ' + prim.length + ' primary rows');
        else if (row.val.vals && prim[0].value !== row.val.vals.base) p.push(row.c.id + ' primary row value differs from the base case');
        const peer = nm.find(x => x.n === 8);
        if (isNum(peer.value)) {
          const kind = row.c.personal ? 'personal-research' : row.c.real ? 'filed' : 'illustrative';
          if (!new RegExp(kind + ' peers').test(peer.why)) p.push(row.c.id + ' peer multiple from other kinds: ' + peer.why);
          if (row.c.type === 'insurer' && /EV\\/EBIT/.test(peer.why)) p.push(row.c.id + ' insurer valued on EV/EBIT');
        }
      }
      return p;
    })()`);
    if (r.length) fail('every pack has one primary row and every peer multiple is like-for-like', r.slice(0, 8));
    else ok('every company has exactly one primary row carrying its base case, and every peer multiple names peers of its own kind and market');
  }

  /* 20 — any written form of a CIK resolves; an older-shape price entry is
          read; the REIT quality pillar does not score an operating margin as
          a net property margin; a save before any edit restores what was on
          screen. */
  {
    const r = await evaluate(`(() => {
      const cik = ['CIK 320193', 'CIK320193', '320193', 'CIK 0000320193', 'CIK0000320193'].map(t => companyIdFor(t));
      const legacy = priceEntry({ price: 4.096, currency: 'MYR', asOf: '2026-08-04T02:05:02.000Z' });
      const reit = U.filter(x => x.c.real && x.c.type === 'reit').map(x => ({ id: x.c.id, npm: x.m.npm, q: x.scores.quality.score, npmPart: x.scores.quality.parts.find(pp => pp.k === 'npm')?.raw }));
      const savedWheel = State.wheel, savedLegs = State.wheelLegs;
      localStorage.removeItem('vl.wheelPlan');
      State.wheel = { ...savedWheel, symbol: 'ONSCREEN', putStrike: 11 };
      const rec = saveWork('wheel', 'harness');
      State.wheel = { ...State.wheel, symbol: 'CHANGED', putStrike: 7 };
      const resumed = resumeWork(rec.id);
      const after = [State.wheel.symbol, State.wheel.putStrike];
      deleteWork(rec.id); State.wheel = savedWheel; State.wheelLegs = savedLegs; saveWheel();
      return { cik, legacy, reit, payload: rec.payload.wheelPlan?.symbol || null, resumed, after };
    })()`);
    const p = [];
    if (r.cik.some(x => x !== 'AAPL-SEC')) p.push(`CIK forms: ${JSON.stringify(r.cik)}`);
    if (!r.legacy || r.legacy.close !== 4.096 || r.legacy.date !== '2026-08-04') p.push(`older price entry: ${JSON.stringify(r.legacy)}`);
    const badReit = r.reit.filter(x => x.npm != null || x.npmPart != null || x.q === 0);
    if (badReit.length) p.push(`filed REITs scored on an operating margin as net property margin: ${JSON.stringify(badReit.slice(0, 3))}`);
    if (r.payload !== 'ONSCREEN' || !r.resumed || r.after[0] !== 'ONSCREEN' || r.after[1] !== 11) p.push(`save/resume: payload ${r.payload}, resumed ${r.resumed}, after ${r.after}`);
    if (p.length) fail('CIK aliases, older price entries, the REIT quality pillar and saved work', p);
    else ok(`every written form of a CIK resolves, an older-shape price entry is read, ${r.reit.length} filed REITs carry no net property margin they do not report, and a save before any edit restores the screen it was taken from`);
  }
  /* "NOT MEANINGFUL" MEANS EVERY INPUT IS THERE — IN EVERY YEAR READ. The
     legend says so, and a growth, variability or share-count measure reads
     more than the latest year: META's dividend line is absent in its early
     years and its dividend CAGR read "n/m, every input is present". The
     windows are written out here rather than read from the page, so the check
     does not agree with the code by construction. */
  {
    const r = await evaluate(`(() => {
      const SPAN = { rev5: 5, eps5: 5, ni5: 5, fcf5: 5, dps5: 5, epsVol: 5, revDD: 5, ocfPosYears: 5, revYoY: 2, niYoY: 2, buyback: 99, dilution: 99 };
      const bad = [];
      for (const row of U) for (const f of FIELDS) {
        const s = metricStatus(row, f.k);
        if (s.available || s.reason !== 'not meaningful') continue;
        const span = SPAN[f.k] || 1;
        const gap = (FIELD_INPUTS[f.k] || []).filter(l => LINE_COL[l] != null && row.c.fin.slice(-span).some(x => !isNum(x[LINE_COL[l]])));
        if (gap.length) bad.push(row.c.tk + ' ' + f.k + ' (' + gap.join(', ') + ')');
      }
      const meta = U.find(x => x.c.tk === 'META' && x.c.real);
      return { bad, meta: meta ? metricStatus(meta, 'dps5') : null };
    })()`);
    const p = [];
    if (r.bad.length) p.push(`${r.bad.length} "not meaningful" cells have an input missing in a year the measure reads: ${r.bad.slice(0, 8).join('; ')}`);
    if (r.meta && !(r.meta.reason === 'not reported' && /FY\d{4}/.test(r.meta.text))) p.push(`META dividend CAGR: ${r.meta.reason} — ${r.meta.text}`);
    if (p.length) fail('"not meaningful" is only said where every input is present in every year the measure reads', p);
    else ok('"not meaningful" is only said where every input is present in every year the measure reads; a gap names the line and its years');
  }

  /* THE SCREENER'S OWN ARITHMETIC AND COPY. A money threshold is read in the
     currency the column shows; a template's banner goes when its criteria
     do; a mode switch does not reinterpret thresholds; the export carries the
     definition, the on-screen order and its units; every exclusion is listed;
     no absent score prints "null"; and the formula text is the computation. */
  {
    await evaluate(`navigate('/discover/screener')`);
    await sleep(700);
    const r = await evaluate(`(async () => {
      const out = {};
      const s = blankScreen(); s.minCoverage = 0; s.crit = { mcap: { min: 100, max: null } };
      const prevCcy = State.screenCcy; State.screenCcy = 'USD';
      out.mcapUsd = U.filter(x => evaluateScreen(x, s).pass).filter(x => (convertTo(x.m.mcap, x.c.ccy, 'USD') ?? -1) < 100).map(x => x.c.tk);
      const aapl = BY_ID.get('AAPL-SEC');
      out.mos = aapl && isNum(aapl.m.mosBase) ? { formula: FIELD_BY_K.mosBase.formula, v: aapl.m.mosBase, byPrice: (aapl.val.vals.base - aapl.c.px.p) / aapl.c.px.p * 100 } : null;

      const tpl = SCREEN_TEMPLATES.find(t => t.untestable?.length);
      applyTemplate(tpl);
      out.tplOn = /not evaluated/.test(document.querySelector('main').innerText);
      State.screen.crit.qscore = { min: 10, max: null }; render();
      out.tplAfterEdit = { flag: State.appliedTemplate, banner: /rule not evaluated/.test(document.querySelector('main').innerText) };

      State.screen = blankScreen(); State.screen.mode = 'pct'; State.screen.crit = { roic: { min: 50, max: null } }; render();
      out.pctChip = [...document.querySelectorAll('main .chip.chip-brand')].map(x => x.textContent).find(t => /Return on invested capital/.test(t)) || null;
      [...document.querySelectorAll('main .segmented button')].find(x => x.textContent === 'Absolute').click();
      out.afterSwitch = JSON.stringify(State.screen.crit);

      State.screen = blankScreen(); State.screen.cols = ['roic', 'mcap']; render();
      let blob = null; const oc = URL.createObjectURL, ac = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (x) => { blob = x; return 'blob:x'; }; HTMLAnchorElement.prototype.click = function () {};
      try { exportScreen(); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = ac; }
      const lines = (await blob.text()).split('\\n');
      out.exp = { head: lines[0], first: lines.slice(1, 4).map(l => l.split(',')[0]),
        shown: [...document.querySelectorAll('main table.dt tbody tr')].slice(0, 3).map(tr => tr.querySelector('.tk')?.childNodes[0]?.textContent),
        criteria: lines.filter(l => l.startsWith('# Criterion:')).length, json: lines.some(l => l.startsWith('# Definition (JSON):')) };

      const failed = U.map(x => ({ r: x, ev: evaluateScreen(x, State.screen) })).filter(x => !x.ev.pass);
      openExclusions(failed);
      out.excl = { failed: failed.length, panels: document.querySelectorAll('.drawer .panel').length };
      closeDrawer({ restore: false });

      const def = JSON.parse(JSON.stringify(State.screen));
      const keep = State.savedScreens;
      State.savedScreens = [{ name: 'harness', def, snapshot: screenSnapshot(def), alertOnMatch: false }];
      openSavedScreen(0);
      out.savedNull = /\\bnull\\b/.test(document.querySelector('.drawer')?.innerText || '');
      closeDrawer({ restore: false });
      State.savedScreens = keep;
      out.cardNull = [...document.querySelectorAll('.screener-card')].filter(c => /\\bnull\\b/.test(c.textContent)).length;
      State.screenCcy = prevCcy; State.screen = blankScreen(); render();
      return out;
    })()`);
    const p = [];
    if (r.mcapUsd.length) p.push(`a market-cap floor of $100B in USD passes ${r.mcapUsd.join(', ')}, below it once converted`);
    if (r.mos && (!/÷ price$/.test(r.mos.formula) || Math.abs(r.mos.v - r.mos.byPrice) > 0.01)) p.push(`difference to base case: formula "${r.mos.formula}", value ${r.mos.v}, (estimate − price) ÷ price = ${r.mos.byPrice}`);
    if (!r.tplOn) p.push('the section 18.1 template shows no "not evaluated" banner');
    if (r.tplAfterEdit.flag || r.tplAfterEdit.banner) p.push(`an edited template keeps its flag or banner: ${JSON.stringify(r.tplAfterEdit)}`);
    if (!/50th pct/.test(r.pctChip || '')) p.push(`a percentile chip reads "${r.pctChip}"`);
    if (r.afterSwitch !== '{}') p.push(`thresholds survive a switch from percentile to absolute: ${r.afterSwitch}`);
    if (!/mcap_bn_/.test(r.exp.head) || !/roic_pct/.test(r.exp.head)) p.push(`export headers carry no units: ${r.exp.head}`);
    if (JSON.stringify(r.exp.first) !== JSON.stringify(r.exp.shown)) p.push(`export order ${r.exp.first} is not the table's ${r.exp.shown}`);
    if (!r.exp.criteria || !r.exp.json) p.push('the export carries no screen definition');
    if (r.excl.panels !== r.excl.failed) p.push(`Explain exclusions lists ${r.excl.panels} of ${r.excl.failed}`);
    if (r.savedNull) p.push('the saved-screen reproducibility table prints "null"');
    if (r.cardNull) p.push(`${r.cardNull} phone cards print "null"`);
    if (p.length) fail('the screener filters, labels, exports and explains what it shows', p);
    else ok(`the screener filters money in the column's currency, drops a template once edited, clears thresholds on a mode switch, exports in the table's order with units and the definition, lists all ${r.excl.failed} exclusions, and prints no "null"`);

    /* Keyboard: the completeness slider keeps focus across the re-render, so
       a second arrow press still moves it. */
    await evaluate(`document.getElementById('covRange').focus()`);
    for (let k = 0; k < 2; k++) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 }, sessionId);
      await sleep(250);
    }
    const kb = await evaluate(`({ v: State.screen.minCoverage, active: document.activeElement?.id || document.activeElement?.tagName })`);
    if (kb.v !== 70 || kb.active !== 'covRange') fail('the completeness slider keeps focus and moves on every arrow press', kb);
    else ok('the completeness slider keeps focus and moves on every arrow press (60% → 70% in two presses)');
    await evaluate(`State.screen = blankScreen(); render(); true`);
  }

  /* STRATEGIES, HEATMAP, VALUE MAP, HOME. A bank meeting Dividend
     Durability's yield and payout rules is admitted, since leverage is "where
     applicable"; no card claims a rebalance; exclusions a test cannot read are
     marked; a quality-score split prints point differences, not the score
     with 50 added; heatmap tiles are keyboard buttons; the value map's table
     prints no invented midpoint rank; the movement row is in points with the
     model-difference colour; and the home market card averages one
     provenance. */
  {
    const r = await evaluate(`(async () => {
      const out = {};
      const dd = THEMES.find(t => t.id === 'divdur');
      out.bankOk = U.filter(x => x.c.type === 'bank' && x.m.dy > 2.5 && (x.m.payout ?? 99) < 85).map(x => x.c.tk + ':' + dd.test(x));
      out.untestedMarked = THEMES.every(t => !(t.excl || []).some(e => /yield trap|special distribution|going-concern|lease or pension|debt-funded|revaluation|status changed/i.test(e)));
      out.rebalance = THEMES.some(t => 'rebalance' in t);
      const mb = U.find(x => x.c.mkt === 'MY' && isNum(x.m.mcap) && isNum(x.scores.quality.score));
      const a = mb ? attribution(mb, 'qual') : null;
      out.qual = a ? { market: a.market, shown: (a.m.dfmt || a.m.fmt)(a.market) } : null;
      const us = marketSummary('US');
      out.home = { mixed: new Set(us.rows.map(x => !!x.c.real)).size > 1 };
      navigate('/discover?tab=heatmap'); await new Promise(res => setTimeout(res, 700));
      out.tiles = document.querySelectorAll('main svg g.tile[role="button"][tabindex="0"]').length;
      const g = document.querySelector('main svg g.tile');
      if (g) { g.focus(); g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
      await new Promise(res => setTimeout(res, 300));
      out.tileOpens = !!document.querySelector('.drawer') && /Why moved|How this figure splits/.test(document.querySelector('.drawer').innerText);
      closeDrawer({ restore: false });
      out.klciLabel = [...document.querySelectorAll('main .segmented button')].some(b => /S&P 500|FBM KLCI/.test(b.textContent));
      navigate('/discover/value-map'); await new Promise(res => setTimeout(res, 700));
      State.radar.cohort = 'sector'; render();
      const noPeer = universeAsOf(State.radar.yi).find(x => x.val.mos && x.qpctSector == null);
      const row = noPeer ? [...document.querySelectorAll('main details tbody tr')].find(tr => tr.children[0].textContent.startsWith(noPeer.c.tk + ' ')) : null;
      out.noPeer = noPeer ? { tk: noPeer.c.tk, cell: row?.children[4]?.textContent } : null;
      out.unplotted = /not plotted/.test(document.querySelector('main').innerText);
      State.radar.cohort = 'market'; render();
      const past = universeAsOf(RADAR_MIN_YI).find(x => x.val.mos && BY_ID.get(x.id)?.val.mos);
      if (past) { openRadarDetail(past.id, RADAR_MIN_YI); out.move = [...document.querySelectorAll('.drawer dl.kv dd')].map(dd => dd.textContent + '|' + dd.className).find(t => /points/.test(t)) || null; closeDrawer({ restore: false }); }
      return out;
    })()`);
    const p = [];
    if (r.bankOk.some(x => x.endsWith(':false'))) p.push(`banks meeting Dividend Durability's yield and payout rules are excluded: ${r.bankOk.join(', ')}`);
    if (!r.untestedMarked) p.push('an exclusion no test evaluates is still listed as applied');
    if (r.rebalance) p.push('a strategy still claims a rebalance schedule');
    if (r.qual && Math.abs(r.qual.market) < 40 && /^\d{2}$/.test(r.qual.shown)) p.push(`a quality-score component of ${r.qual.market.toFixed(1)} prints as "${r.qual.shown}"`);
    if (r.home.mixed) p.push('the home US card averages filed closes and sample prices together');
    if (!r.tiles || !r.tileOpens) p.push(`heatmap tiles: ${r.tiles} keyboard buttons, Enter opens the drawer ${r.tileOpens}`);
    if (r.klciLabel) p.push('the heatmap universe is still labelled as an index it does not filter on');
    if (r.noPeer && /^\d+$/.test(r.noPeer.cell || '')) p.push(`${r.noPeer.tk} with no sector peers prints a sector percentile of ${r.noPeer.cell}`);
    if (!r.unplotted) p.push('the value map does not say who is not plotted');
    if (r.move && (/% points/.test(r.move) || /\|(pos|neg)$/.test(r.move))) p.push(`value-map movement row: ${r.move}`);
    if (p.length) fail('strategies, heatmap, value map and home state what they test and show', p);
    else ok(`strategies admit ${r.bankOk.length} bank(s) on the payout branch and mark untested exclusions, ${r.tiles} heatmap tiles are keyboard buttons, a score split prints points, the value map names what it leaves out, and the home card averages one provenance`);
  }

  /* THE COMPANY PAGE SAYS WHAT IT HOLDS. A filed bank's pre-tax income is not
     pre-provision profit; a Basic Directory company is not graded, and a D is
     not a reason to own anything; a share-count jump is not asserted to be a
     split; a short growth window names the missing revenue, not missing
     statements; the company at the peer median is not "below peers"; and a
     momentum score re-based over half its weight says so. */
  {
    const r = await evaluate(`(() => {
      const lbl = (id) => typeof ebitLabel !== 'function' ? 'no ebitLabel' : BY_ID.get(id) ? ebitLabel(BY_ID.get(id).c) : null;
      const labels = { jpm: lbl('JPM-SEC'), maybank: lbl('MAYBANK'), blk: lbl('BLK-SEC') };
      let dirGraded = 0, fromD = 0;
      U.forEach(x => { const l = strategyLens(x);
        if (l.tier.id === 'directory' && l.fits.some(f => f.state === 'graded')) dirGraded++;
        const role = l.fits.filter(f => f.state === 'graded' && ['income','compounder','cyclical','value','catalyst'].includes(f.key)).sort((a, b) => b.score - a.score).find(f => f.grade !== 'D');
        if (l.primary && !role) fromD++; });
      openResearch('JPM-SEC', 'financials');
      const legend = [...document.querySelectorAll('main .legend-item')].map(x => x.textContent).join(' | ');
      openResearch('O-SEC', 'ownership');
      const breakNote = [...document.querySelectorAll('main .note')].map(n => n.textContent).find(t => /withheld/.test(t)) || '';
      openResearch('BLK-SEC', 'quality');
      const blk = BY_ID.get('BLK-SEC');
      const caveat = [...document.querySelectorAll('main .metaline')].map(n => n.textContent).find(t => /^Computed over/.test(t)) || '';
      openResearch('ABBV-SEC', 'business');
      const medianRows = [...document.querySelectorAll('main table.dt tbody tr')].map(tr => [...tr.cells].map(td => td.textContent))
        .filter(cells => cells.length === 5 && /^(\\d+) of (\\d+)$/.test(cells[3]))
        .filter(cells => { const [, k, n] = cells[3].match(/^(\\d+) of (\\d+)$/).map(Number); return n % 2 === 1 && k === (n + 1) / 2; });
      openResearch('ABBV-SEC', 'quality');
      const abbv = BY_ID.get('ABBV-SEC');
      const momCard = [...document.querySelectorAll('main h3.h-card')].find(h => /Momentum/.test(h.textContent))?.closest('.card')?.textContent || '';
      return { labels, dirGraded, fromD, legend, breakNote, blkFin: blk ? blk.c.fin.length : null, caveat, medianRows,
               momCoverage: abbv?.mom?.coverage, momNote: /re-based/.test(momCard) };
    })()`);
    const p = [];
    if (r.labels.jpm !== 'Profit before tax, after provisions' || r.labels.maybank !== 'Pre-provision profit' || (r.labels.blk && r.labels.blk !== 'Operating profit'))
      p.push(`profit labels: ${JSON.stringify(r.labels)}`);
    if (/Pre-provision/.test(r.legend)) p.push(`JPM's Financials legend still reads "${r.legend}"`);
    if (r.dirGraded) p.push(`${r.dirGraded} Basic Directory companies carry a strategy grade`);
    if (r.fromD) p.push(`${r.fromD} companies name a return role from a D-graded fit`);
    if (!r.breakNote || /no issuance or buyback/.test(r.breakNote) || /measure the split/.test(r.breakNote)) p.push(`O's share-count note: ${r.breakNote.slice(0, 200)}`);
    if (r.blkFin >= 5 && /annual statements are held/.test(r.caveat)) p.push(`BLK holds ${r.blkFin} statements and the caveat says "${r.caveat.slice(0, 120)}"`);
    const below = r.medianRows.filter(cells => /Below peers|Above peers/.test(cells[4]));
    if (below.length) p.push(`the median company is told ${below.map(c => `${c[0]}: ${c[4]}`).join('; ')}`);
    if (r.momCoverage < 100 && !r.momNote) p.push(`ABBV's momentum is re-based over ${r.momCoverage}% of its weight and the card does not say so`);
    if (p.length) fail('the company page labels what it holds: filed profit lines, directory tier, share-count breaks, growth window, median, momentum re-basing', p);
    else ok(`the company page labels what it holds — JPM "${r.labels.jpm}", no directory-tier grades, no role from a D, the share-count break left undiagnosed, the median at the median${r.medianRows.length ? ` (${r.medianRows.length} row)` : ''}, momentum re-basing stated`);
  }

  /* EVERY CONTROL ON THE COMPANY PAGE DOES WHAT IT SAYS. The peers button
     keeps to the plan's Compare limit; the research-home template cards open
     the screener; "Create a price alert" opens the editor on this company;
     the tab strip is a tablist the arrow keys move along; the illustrative
     price card computes its distance from the high on the sample it prints;
     and edited assumptions are named on the snapshot that does not use them. */
  {
    const r = await evaluate(`(() => {
      const out = {};
      openResearch('MAYBANK', 'snapshot');
      const pc = [...document.querySelectorAll('main h3.h-card')].find(h => /Price, last 52 weeks/.test(h.textContent))?.closest('.card');
      const mb = BY_ID.get('MAYBANK').c.px;
      const want = fmtPct((mb.p - mb.hi) / mb.hi * 100);
      out.priceCard = pc ? { generated: /generated illustration/.test(pc.textContent), fromHigh: pc.textContent.includes(want + ' from the high'), want } : null;
      const sub = document.querySelector('.subnav');
      const tabs = [...sub.querySelectorAll('[role=tab]')];
      out.tablist = sub.getAttribute('role') === 'tablist' && tabs.filter(t => t.tabIndex === 0).length === 1;
      tabs[0].focus();
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      out.arrow = document.activeElement === tabs[1];
      [...document.querySelectorAll('main button')].find(b => /Open full comparison/.test(b.textContent))?.click();
      out.compare = { n: State.compare.length, cap: LIMITS.compare };
      openResearch('MAYBANK', 'filings');
      [...document.querySelectorAll('main button')].find(b => /price alert/i.test(b.textContent))?.click();
      out.alert = { editor: !!document.getElementById('pa-co'), co: document.getElementById('pa-co')?.value || null,
                    falseBuilder: [...document.querySelectorAll('main, .drawer, .toast, [role=status]')].some(n => /Alert rule builder/.test(n.textContent)) };
      closeDrawer({ restore: false });
      /* An unpriced filer whose valuation computes: the note sits beside the
         range, and the absent "vs base-case value" is what the tile check reads.
         ABBV was the fixture until the engine rightly withheld its valuation
         (negative book equity and no price), which left no range to annotate. */
      const abbv = U.find(x => x.c.real && !x.c.personal && !x.val?.err && !isNum(x.c.px?.p) && isNum(x.inputs?.wacc));
      const saved = State.valuation[abbv.c.id];
      State.valuation[abbv.c.id] = { ...abbv.inputs, wacc: (abbv.inputs.wacc || 8) + 1 };
      openResearch(abbv.c.id, 'snapshot');
      out.editedNote = [...document.querySelectorAll('main .metaline')].some(n => /^Default assumptions\\./.test(n.textContent));
      const tile = [...document.querySelectorAll('main .stat-label')].find(x => /vs base-case/.test(x.textContent))?.parentElement;
      out.tile = tile ? { value: tile.querySelector('.stat-value').textContent, style: tile.querySelector('.stat-value').getAttribute('style') || '' } : null;
      if (saved) State.valuation[abbv.c.id] = saved; else delete State.valuation[abbv.c.id];
      navigate('/research');
      const card = [...document.querySelectorAll('[role=button]')].find(x => x.querySelector('h3')?.textContent === 'Banks');
      card?.click();
      out.banks = { view: State.view, path: location.pathname, tpl: State.appliedTemplate };
      return out;
    })()`);
    const p = [];
    if (!r.priceCard || !r.priceCard.generated || !r.priceCard.fromHigh) p.push(`Maybank's price card: ${JSON.stringify(r.priceCard)}`);
    if (!r.tablist || !r.arrow) p.push(`tab strip: tablist with one tab stop ${r.tablist}, ArrowRight moves focus ${r.arrow}`);
    if (r.compare.n > r.compare.cap) p.push(`the peers button put ${r.compare.n} companies in a comparison capped at ${r.compare.cap}`);
    if (!r.alert.editor || r.alert.co !== 'MAYBANK' || r.alert.falseBuilder) p.push(`Create a price alert: ${JSON.stringify(r.alert)}`);
    if (!r.editedNote) p.push('edited assumptions are not named on the snapshot that still shows the defaults');
    if (r.tile && r.tile.value === '—' && /--dn-text|--ok-text/.test(r.tile.style)) p.push(`the absent "vs base-case value" is coloured: ${r.tile.style}`);
    if (r.banks.path !== '/discover/screener' || r.banks.tpl !== 'my-banks') p.push(`the research-home Banks card: ${JSON.stringify(r.banks)}`);
    if (p.length) fail('every control on the company page does what it says', p);
    else ok(`every control on the company page does what it says — peers capped at ${r.compare.cap}, Banks opens the screener, the alert editor opens on MAYBANK, the tabs are a tablist, ${r.priceCard.want} from the high on the sample`);
  }

  /* A ROLL IS TWO LEGS, AND EACH CARRIES ONLY ITS OWN COSTS. The close leg
     used to be spread from the opening one: it inherited the opening fees, so
     the ledger counted them twice, and its id was overwritten with undefined.
     A rolled call committed strike × shares, which a call opened directly
     never does. */
  {
    const r = await evaluate(`(() => {
      const saved = State.wheelLegs;
      State.wheelLegs = [];
      addWheelLeg({ phase:'put', action:'open', status:'open', contractLabel:'P50', strike:50, shares:100, grossPremium:110,
        commissions:0, fees:0.5, netCash:109.5, capitalCommitted:5000, currentCloseCost:40 });
      rollWheelLeg(State.wheelLegs[0], 0.8, { label:'P45', strike:45, shares:100, creditPerShare:1.2, openCommission:1, closeCommission:1 });
      const close = State.wheelLegs[1];
      const t = wheelLedger(State.wheelLegs);
      const put = { closeId: close.id || null, closeFees: close.fees ?? null, costs: t.fees + t.commissions };
      State.wheelLegs = [];
      addWheelLeg({ phase:'call', action:'open', status:'open', contractLabel:'C55', strike:55, shares:100, grossPremium:100,
        commissions:0, fees:0, netCash:100, capitalCommitted:0 });
      rollWheelLeg(State.wheelLegs[0], 0.5, { label:'C57', strike:57, shares:100, creditPerShare:1, openCommission:0, closeCommission:0 });
      const callCap = State.wheelLegs[2].capitalCommitted;
      State.wheelLegs = saved; saveWheelLegs();
      return { ...put, callCap };
    })()`);
    if (!r.closeId || r.closeFees != null || Math.abs(r.costs - 2.5) > 1e-9 || r.callCap !== 0)
      fail('a roll records a close leg with its own id and only its own costs, and a rolled call commits no capital', r);
    else ok('a roll records a close leg with its own id and only its own costs ($2.50 of fees and commissions, not $3.00), and a rolled call commits no capital');
  }

  /* THE THESIS AND THE STUDIO SAY WHAT THEY DO. A decision review opens on a
     company no model could be built for; deleting a thesis deletes the review
     history the dialog says it deletes; coverage counts watchlist entries with
     a thesis; the "price above the estimate" condition divides by the
     estimate; a new thesis's review date follows its creation and a passed one
     does not satisfy step 7; a saved run keeps its figures and the replay is
     compared with them. */
  {
    const r = await evaluate(`(() => {
      const out = {};
      window.confirm = () => true;
      const noModel = U.find(x => x.c.real && x.inputs.model === 'unavailable' && !State.theses.some(t => t.ticker === x.c.id));
      const offList = U.find(x => !State.watchlist.includes(x.c.id) && !State.theses.some(t => t.ticker === x.c.id) && x.c.id !== noModel?.c.id);
      out.noModel = noModel?.c.id || null;
      if (noModel) {
        addToThesis(noModel.c.id);
        const t = State.theses.find(x => x.ticker === noModel.c.id);
        const today = new Date().toISOString().slice(0, 10);
        out.reviewAhead = t.review > today && (new Date(t.review) - Date.now()) > 80 * 86400000;
        try { openReview(t); out.reviewOpened = /no driver to name/.test(document.querySelector('.drawer')?.textContent || ''); }
        catch (e) { out.reviewOpened = 'threw: ' + e.message; }
        closeDrawer({ restore: false });
        const past = { ...t, review: '2020-01-01' };
        out.pastStep7 = sevenSteps(noModel, past)[6].ok;
        const all = store.read('reviews', {}); all[t.id] = [{ date: today, breaches: 0, answers: [{ question: 'q', answer: 'a' }] }]; store.write('reviews', all);
        openThesisEditor(t);
        [...document.querySelectorAll('.drawer button')].find(b => b.textContent.trim() === 'Delete')?.click();
        out.reviewsGone = !(t.id in (store.read('reviews', {}) || {})) && !State.theses.some(x => x.id === t.id);
      }
      if (offList) {
        const covered = () => State.watchlist.filter(id => State.theses.some(t => t.ticker === id)).length;
        const want = covered() + '/' + State.watchlist.length;
        addToThesis(offList.c.id);
        navigate('/my/theses');
        const tile = [...document.querySelectorAll('.card')].find(c => /Watchlist coverage/.test(c.textContent) && c.textContent.length < 200);
        out.coverage = { want, shown: tile?.querySelector('.stat-value')?.textContent };
        State.theses = State.theses.filter(t => t.ticker !== offList.c.id); saveTheses();
      }
      const priced = U.find(x => isNum(x.val.price) && isNum(x.val.vals?.base) && x.val.vals.base > 0 && Math.abs(x.val.price / x.val.vals.base - 1) > 0.05);
      if (priced) {
        const e = evaluateThesis({ ticker: priced.c.id, conds: [{ type: 'val', op: '>', v: 15, label: 'x' }] });
        const cd = [...e.breaches, ...e.ok][0];
        out.premium = { id: priced.c.id, got: cd.actual, want: (priced.val.price - priced.val.vals.base) / priced.val.vals.base * 100 };
      }
      return out;
    })()`);
    const p = [];
    if (!r.noModel) p.push('no filed company without a valuation model to test');
    else {
      if (r.reviewOpened !== true) p.push(`decision review on ${r.noModel}: ${r.reviewOpened}`);
      if (!r.reviewAhead) p.push('a new thesis does not get a review date about ninety days ahead');
      if (r.pastStep7 !== false) p.push('a review date in the past still satisfies step 7');
      if (!r.reviewsGone) p.push('deleting a thesis left its review history in storage');
    }
    if (!r.coverage || r.coverage.want !== r.coverage.shown) p.push(`watchlist coverage ${JSON.stringify(r.coverage)}`);
    if (!r.premium || Math.abs(r.premium.got - r.premium.want) > 1e-9) p.push(`premium to the base-case estimate ${JSON.stringify(r.premium)}`);
    if (p.length) fail('the thesis page does what its labels say', p);
    else ok(`the thesis page does what its labels say — review opens on ${r.noModel}, deletion takes the reviews, coverage ${r.coverage.shown}, premium measured on the estimate (${r.premium.id})`);
  }

  /* THE STUDIO. A cleared input is absent, not the previous value; the nine-
     methods sentence has no price clause without a price; the bull shifts are
     printed as applied; Go changes the address; a saved run is compared with
     its replay and a different data date is stated. */
  {
    await evaluate(`navigate('/company/MAYBANK?tab=valuation')`);
    await sleep(600);
    const r = await evaluate(`(() => {
      const out = {};
      const txt = () => document.querySelector('main')?.innerText || '';
      out.bull = /bull case applies [a-zA-Z]+ [+−-]/.test(txt()) && !/mirror image/.test(txt());
      const f = document.querySelector('#as-coe') || document.querySelector('.assumption input[type=number]');
      const k = f.id.slice(3);
      const set = (v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(f, v); f.dispatchEvent(new Event('input', { bubbles: true })); };
      set('');
      out.cleared = { stored: State.valuation.MAYBANK[k], empty: /is empty — no estimate/.test(txt()), noRange: !/Base case\\n/.test(document.querySelector('.studio-layout')?.innerText || '') };
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Reset')?.click();
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Save this valuation run')?.click();
      const runs = store.read('runs', []);
      out.savedVals = !!(runs[0]?.vals && isNum(runs[0].vals.base));
      const t = State.theses.find(x => x.ticker === 'MAYBANK') || (addToThesis('MAYBANK'), State.theses.find(x => x.ticker === 'MAYBANK'));
      t.runRef = runs[0].runId;
      openSavedRun(t);
      out.exact = /gives the saved figures exactly/.test(document.querySelector('.drawer')?.textContent || '');
      closeDrawer({ restore: false });
      if (runs[0].vals) runs[0].vals.base *= 1.1;
      runs[0].asOf = '01 Jan 2020'; store.write('runs', runs);
      openSavedRun(t);
      const d = document.querySelector('.drawer')?.textContent || '';
      out.differs = /different figures from the ones saved/.test(d) && /data as of 01 Jan 2020/.test(d);
      closeDrawer({ restore: false });
      return out;
    })()`);
    await evaluate(`navigate('/company/UNH-SEC?tab=valuation')`);
    await sleep(600);
    r.unpriced = await evaluate(`(() => { const s = [...document.querySelectorAll('p.metaline')].map(p => p.textContent).find(t => /Applicable methods span/.test(t)); return s === undefined ? 'absent' : !/market price of —/.test(s); })()`);
    await evaluate(`navigate('/company/MAYBANK?tab=thesis')`);
    await sleep(600);
    r.go = await evaluate(`(() => { const b = [...document.querySelectorAll('main button')].filter(x => x.textContent === 'Go')[1]; b?.click(); return location.search; })()`);
    const p = [];
    if (!r.bull) p.push('the scenario note does not print the bull shifts');
    if (!(r.cleared.stored === null && r.cleared.empty && r.cleared.noRange)) p.push(`a cleared input: ${JSON.stringify(r.cleared)}`);
    if (!r.savedVals) p.push('a saved run keeps no output figures');
    if (!r.exact) p.push('an untouched saved run is not reported as reproduced');
    if (!r.differs) p.push('a saved run whose figures or data date differ is not reported as such');
    if (r.unpriced !== true) p.push(`nine-methods sentence on an unpriced company: ${r.unpriced}`);
    if (r.go !== '?tab=risks') p.push(`seven-step Go left the address at ${r.go}`);
    if (p.length) fail('the Valuation Studio states what it computed and nothing it did not', p);
    else ok('the Valuation Studio states what it computed — an emptied input stops the estimate, saved runs are compared with their replay, the bull shifts are printed, Go changes the address');
  }

  /* COMPARE AND ONBOARDING. The currency sentence follows the toggle; no
     preset promises more companies than a comparison holds; the US answer
     lands on a filed company; the market answer sets the screener's universe;
     the counter counts the questions and focus follows the question. */
  {
    const r = await evaluate(`(() => {
      const out = {};
      State.compare = ['AAPL-SEC', 'MAYBANK']; State.compareCcy = 'local'; navigate('/compare');
      const g = [...document.querySelectorAll('.guardrail')].map(n => n.textContent).find(t => /currenc/.test(t)) || '';
      out.local = !/converted/.test(g) && /not comparable across markets/.test(g);
      out.wholeUniverse = [...document.querySelectorAll('button')].some(b => /Whole universe/.test(b.textContent));
      State.compareCcy = 'common'; store.write('compareCcy', 'common');
      State.obStep = 0; State.obDraft = {}; navigate('/welcome');
      out.counter = document.querySelector('.ob-wrap .eyebrow')?.textContent;
      document.querySelector('.ob-option')?.click();
      out.focus = document.activeElement?.tagName;
      completeOnboarding({ goal: 'us', level: 'experienced', market: 'US', ccy: State.baseCcy });
      out.landed = { id: State.ticker, real: !!BY_ID.get(State.ticker)?.c.real, universe: State.screen?.universe };
      return out;
    })()`);
    const p = [];
    if (!r.local) p.push('the mixed-currency warning says "converted" in Local-currency mode');
    if (r.wholeUniverse) p.push('a "Whole universe" preset is still offered');
    if (r.counter !== 'Step 1 of 4') p.push(`onboarding counter reads "${r.counter}"`);
    if (r.focus !== 'H1') p.push(`focus after an onboarding answer is on ${r.focus}`);
    if (!r.landed.real || r.landed.universe !== 'US') p.push(`onboarding US answer: ${JSON.stringify(r.landed)}`);
    if (p.length) fail('compare and onboarding do what their labels say', p);
    else ok(`compare and onboarding do what their labels say — local-currency warning, no uncapped preset, "Step 1 of 4", focus on the question, US lands on ${r.landed.id}`);
  }

  /* MY INVESTMENTS: THE EDITORS, THE LISTS AND THE FEED SAY WHAT THEY DO.
     Lists imported in one tick get their own ids; deleting a list above the
     active one keeps the active one; an untouched Add-holding form saves the
     company its select shows; closing an editor without saving changes
     nothing; a negative quantity is refused; a sleeve with no priced holding
     has no return rather than −100%; an alert on an unpriced company is not
     "Crossed"; the alert-type switches filter the feed and persist; the
     export carries price alerts; no trend indicator reads computed without a
     value; clearing the sample removes the seeded lists and alerts; and the
     Compare page carries the net yield its withholding control produces. */
  {
    const r = await evaluate(`(() => {
      const out = {};
      const imp = watchlistsImport({ watchlists: [{ name: 'H Imp A', ids: ['MAYBANK'] }, { name: 'H Imp B', ids: ['TENAGA'] }, { name: 'H Imp C', ids: ['CIMB'] }] });
      const mine = State.watchlists.filter(w => w.name.startsWith('H Imp '));
      out.importIds = new Set(mine.map(w => w.id)).size === 3 && mine.every(w => w.ids.length === 1);
      State.wlIdx = State.watchlists.findIndex(w => w.name === 'H Imp B');
      wlDelete(mine.find(w => w.name === 'H Imp A').id);
      out.activeKept = activeWL().name === 'H Imp B';

      navigate('/my/portfolio');
      const pf = activePF(), n0 = pf.holdings.length;
      openAddHolding();
      const shown = document.querySelector('#hd-co').value;
      const set = (sel, v) => { const n = document.querySelector(sel); n.value = v; n.dispatchEvent(new Event('change', { bubbles: true })); };
      set('#hd-qty', '10'); set('#hd-cost', '5');
      [...document.querySelectorAll('#drawer button')].find(b => b.textContent.trim() === 'Add holding').click();
      const added = pf.holdings[n0];
      out.addSaves = !!added && added.id === shown;
      openAddHolding(added); set('#hd-qty', '999'); closeDrawer({ restore: false });
      out.cancelKeeps = added.qty === 10;
      openAddHolding(added); set('#hd-qty', '-5');
      [...document.querySelectorAll('#drawer button')].find(b => b.textContent.trim() === 'Save').click();
      out.negRefused = added.qty === 10;
      closeDrawer({ restore: false });

      State.portfolios.push({ id: 'pf-h', name: 'H unpriced', cash: 0, cashCcy: 'MYR',
        holdings: [{ id: 'O-SEC', qty: 10, cost: 50, fx0: 4.4, fee: 0, rebate: 0 }] });
      State.pfIdx = State.portfolios.length - 1; render();
      const tile = [...document.querySelectorAll('main .card')].map(c => c.innerText).find(t => t.startsWith('Unrealised change')) || '';
      out.unpricedTile = tile.split('\\n').filter(Boolean)[1] || tile;
      State.portfolios.pop(); State.pfIdx = 0;

      State.priceAlerts.push({ id: 'pa-h', ticker: 'O-SEC', op: '<', price: 50, note: '' });
      navigate('/my/alerts');
      const rail = [...document.querySelectorAll('main .card')].map(c => c.innerText).find(t => t.startsWith('Price alerts')) || '';
      const oRow = rail.split('\\n').findIndex(l => l.trim() === 'O');
      out.unpricedChip = rail.split('\\n').slice(oRow, oRow + 4).join(' ');
      const feedN = () => +((document.querySelector('main .card h3, main .card .h-card')?.textContent || '').match(/— (\\d+)/) || [])[1];
      const before = feedN();
      const box = [...document.querySelectorAll('.checkline')].find(l => l.innerText.startsWith('Risk flag'))?.querySelector('input');
      box?.click();
      out.kinds = { before, after: feedN(), stored: !(store.read('alertKinds', []) || []).includes('risk'),
        disabled: [...document.querySelectorAll('.checkline input')].filter(i => i.disabled).length };
      box && document.querySelector('.checkline') && [...document.querySelectorAll('.checkline')].find(l => l.innerText.startsWith('Risk flag')).querySelector('input').click();

      out.exportsAlerts = 'priceAlerts' in exportEverything().data;

      const s = {}; const d0 = Date.UTC(2025, 0, 1);
      for (let i = 0; i < 66; i++) s[new Date(d0 + i * 864e5).toISOString().slice(0, 10)] = 100 + i;
      const t = trendContext(s);
      out.hollow = TREND_INDICATORS.filter(ind => ind.id !== 'cross' && !isNum(t.values[ind.id]) && !t.pending.some(p => p.id === ind.id)).map(i => i.id);

      clearSeededData();
      out.seedLeft = State.watchlists.filter(w => ['wl-1', 'wl-2'].includes(w.id)).length + State.priceAlerts.filter(p => ['pa-1', 'pa-2'].includes(p.id)).length;

      State.compare = ['AAPL-SEC', 'MAYBANK']; navigate('/compare');
      out.netRow = [...document.querySelectorAll('main table.dt td.pin')].some(td => /illustrative net/.test(td.textContent));
      return out;
    })()`);
    const p = [];
    if (!r.importIds) p.push('lists imported in one tick share an id, or a member landed in the wrong list');
    if (!r.activeKept) p.push('deleting a list above the active one changed the active list');
    if (!r.addSaves) p.push('an untouched Add-holding form saved a company other than the one its select shows');
    if (!r.cancelKeeps) p.push('closing the holding editor without saving kept the edit');
    if (!r.negRefused) p.push('a negative quantity was saved');
    if (/−100/.test(r.unpricedTile) || r.unpricedTile.trim() !== '—') p.push(`a portfolio with no priced holding shows an unrealised change of ${r.unpricedTile}`);
    if (/Crossed/.test(r.unpricedChip) || !/No price/.test(r.unpricedChip)) p.push(`an alert on an unpriced company reads: ${r.unpricedChip}`);
    if (!(r.kinds.after < r.kinds.before) || !r.kinds.stored || r.kinds.disabled !== 3) p.push(`alert-type switches: feed ${r.kinds.before} → ${r.kinds.after}, stored ${r.kinds.stored}, ${r.kinds.disabled} disabled`);
    if (!r.exportsAlerts) p.push('Export everything leaves out the price alerts');
    if (r.hollow.length) p.push(`on 66 closes these read computed with no value: ${r.hollow.join(', ')}`);
    if (r.seedLeft) p.push(`${r.seedLeft} seeded watchlists or alerts survive "Clear and start my own"`);
    if (!r.netRow) p.push('the Compare table has no illustrative net yield row');
    if (p.length) fail('My Investments: editors save what they show, lists keep their identity, the feed and its switches agree', p);
    else ok('My Investments: editors save what they show and only on Save, lists keep their identity, unpriced holdings and alerts are not counted at nought, alert types filter and persist, the export and the sample clear are complete');
  }

  /* A CORRECTION CASE IS KEPT, AND SHOWN. Recording one closed the form and
     opened the confirmation in the same tick, and the close's timer then hid
     the confirmation. Ids were numbered by count, so after a delete the next
     case reused a live id and Delete removed both. The raised time was UTC
     with no zone beside a local-date id. */
  {
    const r = await evaluate(`(async () => {
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      const saved = State.corrections;
      State.corrections = [];
      const record = async (text) => {
        openReportError(); await wait(50);
        const d = document.getElementById('err-description');
        d.value = text; d.dispatchEvent(new Event('input'));
        [...document.querySelectorAll('#drawer button')].find(b => b.textContent === 'Record this case').click();
      };
      await record('one');
      await wait(450);
      const shown = { hidden: drawer.hidden, title: drawerTitle.textContent,
        link: [...drawer.querySelectorAll('a')].some(a => /See my recorded cases/.test(a.textContent)) };
      closeDrawer({ restore: false }); await wait(350);
      await record('two'); closeDrawer({ restore: false }); await wait(350);
      State.corrections = State.corrections.filter(c => !c.id.endsWith('-001'));
      await record('three'); closeDrawer({ restore: false }); await wait(350);
      const ids = State.corrections.map(c => c.id);
      const raised = State.corrections[0].createdAt;
      const id = State.corrections[0].id;
      State.corrections = saved; saveCorrections();
      return { shown, ids, raised, id };
    })()`);
    const p = [];
    if (r.shown.hidden || !/recorded/.test(r.shown.title) || !r.shown.link) p.push(`the confirmation drawer: ${JSON.stringify(r.shown)}`);
    if (new Set(r.ids).size !== r.ids.length || r.ids.length !== 2) p.push(`ids after a delete: ${JSON.stringify(r.ids)}`);
    const stamp = r.id.slice(3, 11);
    if (!/ UTC[+−]\d\d:\d\d$/.test(r.raised) || r.raised.slice(0, 10).replace(/-/g, '') !== stamp) p.push(`raised "${r.raised}" against id ${r.id}`);
    if (p.length) fail('a recorded correction case is confirmed, keeps a unique id, and is dated on one labelled clock', p);
    else ok(`a recorded correction case is confirmed, keeps a unique id after a delete (${r.ids.join(', ')}), and is dated on one labelled clock (${r.raised})`);
  }
  /* LEARN PUBLISHES WHAT THE PRODUCT DOES. The router table lists every type
     routeModel handles with the pack it routes to; the scoring page carries
     the valuation pillar the screener and composite use; the router tab keeps
     its own address; pricing prints no limit the build does not apply; and a
     dotted registry alias is replaced by an address that survives a reload. */
  {
    await evaluate(`navigate('/learn')`); await sleep(400);
    await evaluate(`[...document.querySelectorAll('main .subnav button')].find(b => b.textContent === 'Valuation model router').click()`);
    await sleep(400);
    const r = await evaluate(`(() => {
      const rows = [...document.querySelectorAll('main table.dt')[0].querySelectorAll('tbody tr')].map(tr => [tr.cells[0].textContent, tr.cells[1].textContent]);
      const out = { path: location.pathname, rows };
      navigate('/learn?tab=scoring');
      const vc = [...document.querySelectorAll('main .card')].find(c => c.querySelector('.h-card')?.textContent === 'Valuation Evidence');
      out.valueRows = vc ? [...vc.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)) : null;
      out.valueWeights = (typeof VALUE_PILLAR === 'undefined' ? [] : VALUE_PILLAR.all).map(i => Math.round(i.w * 100) + '%');
      out.parts = (U.find(x => isNum(x.scores.value?.score)) || U[0]).scores.value.parts.map(p => [p.k, p.w, p.lo, p.hi]);
      navigate('/pricing');
      const dd = (k) => [...document.querySelectorAll('main dl.kv dt')].find(d => d.textContent === k)?.nextElementSibling.textContent;
      out.metrics = dd('Screener metrics'); out.alerts = dd('Fundamental alerts'); out.nFields = FIELDS.length;
      navigate('/app/equities/1155.KL/financials');
      out.dotted = { path: location.pathname, view: State.view, ticker: State.ticker, tab: State.researchTab };
      return out;
    })()`);
    const p = [];
    if (r.path !== '/methodology') p.push(`the router tab moved the address to ${r.path}`);
    const types = r.rows.map(x => x[0]);
    if (r.rows.length !== 9 || !types.includes('Insurer') || !types.some(t => /Early-stage/.test(t)) || r.rows.some(x => x[1] === '—')) p.push(`router rows: ${JSON.stringify(r.rows)}`);
    if (!r.valueRows || r.valueRows.map(x => x[1]).join() !== r.valueWeights.join()) p.push(`valuation pillar card: ${JSON.stringify(r.valueRows)}`);
    if (JSON.stringify(r.parts) !== JSON.stringify([['mosBase', .6, -35, 45], ['fcfy', .2, 0, 9], ['dy', .2, 0, 6]])) p.push(`value score inputs: ${JSON.stringify(r.parts)}`);
    if (!new RegExp('^All ' + r.nFields + '\\b').test(r.metrics || '') || !/not applied/.test(r.metrics) || !/not applied/.test(r.alerts || '')) p.push(`free plan card: metrics "${r.metrics}", alerts "${r.alerts}"`);
    if (r.dotted.path.includes('.') || r.dotted.ticker !== 'MAYBANK' || r.dotted.tab !== 'financials') p.push(`dotted alias: ${JSON.stringify(r.dotted)}`);
    if (p.length) fail('Learn and pricing publish what the product does, and every accepted address survives a reload', p);
    else ok(`Learn routes all ${r.rows.length} company types and publishes the valuation pillar, the router tab stays on /methodology, pricing names its unapplied limits, and 1155.KL becomes ${r.dotted.path}`);
  }

  /* 21 — ONE METRIC REGISTRY. FIELDS, FIELD_INPUTS, FIELD_PROVENANCE,
          INAPPLICABLE, ALSO_INAPPLICABLE, COVERAGE_KEYS, NM_WHY and
          METRIC_HELP are projections of METRICS (13-metrics.js). Checked key
          by key rather than trusted, because the failure this replaces was
          five hand-kept objects that disagreed: net margin computed and
          published nowhere, twenty-four screener fields with no definition. */
  {
    const r = await evaluate(`(() => {
      const p = [];
      const rowOf = (k) => METRIC_BY_K[k];
      const screener = METRICS.filter(x => x.screener !== false).map(x => x.k);
      if (FIELDS.map(f => f.k).join() !== screener.join()) p.push('FIELDS is not the registry in order: ' + FIELDS.map(f => f.k).join());
      for (const f of FIELDS) {
        const x = rowOf(f.k);
        if (!x) { p.push(f.k + ' has no registry row'); continue; }
        if (f.formula !== x.formula || f.label !== x.label) p.push(f.k + ' formula or label differs');
        if (JSON.stringify(FIELD_INPUTS[f.k]) !== JSON.stringify(x.inputs)) p.push(f.k + ' inputs ' + JSON.stringify(FIELD_INPUTS[f.k]));
        if (provenanceOf(f.k) !== x.kind) p.push(f.k + ' kind ' + provenanceOf(f.k) + ' vs ' + x.kind);
        const h = METRIC_HELP[f.k];
        if (!h || !h.simple || !h.context || !h.technical) p.push(f.k + ' has no three-depth definition');
        if (!f.unit || !f.period || !METRIC_UNIT[f.unit]) p.push(f.k + ' has no unit or period');
        if (!!f.money !== !!x.money) p.push(f.k + ' money flag differs');
      }
      for (const [proj, counted] of [[INAPPLICABLE, true], [ALSO_INAPPLICABLE, false]])
        for (const t of ['bank', 'insurer', 'early', 'reit']) {
          const want = METRICS.filter(x => !!x.counted === counted && !x.blocked && (x.na || []).includes(t)).map(x => x.k).sort().join();
          if ((proj[t] || []).slice().sort().join() !== want) p.push((counted ? 'INAPPLICABLE.' : 'ALSO_INAPPLICABLE.') + t + ' = ' + (proj[t] || []).join());
        }
      if (COVERAGE_KEYS.slice().sort().join() !== METRICS.filter(x => x.counted).map(x => x.k).sort().join()) p.push('COVERAGE_KEYS differs');
      for (const k of Object.keys(NM_WHY)) if (NM_WHY[k] !== rowOf(k)?.nmWhy) p.push('NM_WHY.' + k);
      /* derive() produces every published key, and no company has a value for
         a blocked one. */
      const aapl = BY_ID.get('AAPL-SEC');
      const missing = METRICS.filter(x => !x.blocked && !(x.k in aapl.m)).map(x => x.k);
      if (missing.length) p.push('derive() does not produce ' + missing.join(', '));
      const leak = [];
      for (const row of U) for (const x of METRICS.filter(x => x.blocked)) if (isNum(row.m[x.k])) leak.push(row.c.id + '.' + x.k);
      if (leak.length) p.push('a blocked measure has a value: ' + leak.slice(0, 4).join(', '));
      const blocked = METRICS.filter(x => x.blocked);
      if (blocked.some(x => !x.needs?.length)) p.push('a blocked row does not name the line it needs');
      return { p, n: METRICS.length, fields: FIELDS.length, blocked: blocked.map(x => x.k) };
    })()`);
    if (r.p.length) fail('the screener, drawer, explanations and coverage all read one metric registry', r.p.slice(0, 8));
    else ok(`one registry of ${r.n} measures: ${r.fields} screener fields, their inputs, kinds, applicability, coverage keys, "n/m" reasons and three-depth definitions all agree with it; ${r.blocked.join(', ')} are blocked and carry no value anywhere`);
  }

  /* 22 — the six measures published in metrics 1.7.0 are the quantities their
          formulas name, on every filed company; free cash flow is not a bank
          measure; net-income growth survives a split that withholds the
          per-share rate; and each absence gives its reason. */
  {
    const r = await evaluate(`(() => {
      const bad = [], near = (a, b) => (a == null && b == null) || (isNum(a) && isNum(b) && Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)));
      let checked = 0;
      for (const row of U.filter(x => x.c.real)) {
        const { c, m } = row, f = c.fin, i = f.length - 1, L = f[i], P = f[i - 1] || [];
        const bank = c.type === 'bank', susp = !!m.revenueSuspect, scale = !!m.perShareScaleBroken;
        checked++;
        const want = {
          nm: !susp && !scale && isNum(L[2]) && L[0] > 0 ? L[2] / L[0] * 100 : null,
          ocfm: !bank && !susp && isNum(L[3]) && L[0] > 0 ? L[3] / L[0] * 100 : null,
          fcf: !bank && isNum(L[3]) && isNum(L[4]) ? L[3] - L[4] : null,
          revYoY: isNum(L[0]) && P[0] > 0 ? (L[0] / P[0] - 1) * 100 : null,
          niYoY: !scale && isNum(L[2]) && P[2] > 0 ? (L[2] / P[2] - 1) * 100 : null,
          ni5: scale ? null : (() => { const w = f.slice(-5).map(x => x[2]); return isNum(w[0]) && isNum(w[w.length - 1]) ? cagr(w) : null; })(),
        };
        for (const [k, v] of Object.entries(want)) if (!near(m[k], v)) bad.push(c.id + '.' + k + ' ' + m[k] + ' vs ' + v);
      }
      const split = U.filter(x => x.c.real && x.m.shareSeriesBreak);
      const survives = split.filter(x => isNum(x.m.ni5) && !isNum(x.m.eps5)).map(x => x.c.tk);
      const pick = (fn) => U.find(fn) || null;
      const calc = pick(x => x.c.real && isNum(x.m.ocfm));
      const susp = pick(x => x.c.real && x.m.revenueSuspect);
      const bank = pick(x => x.c.real && x.c.type === 'bank');
      const scale = pick(x => x.c.real && x.m.perShareScaleBroken);
      return { bad, checked, split: split.length, survives,
        calc: calc && metricStatus(calc, 'ocfm'), susp: susp && metricStatus(susp, 'ocfm'),
        bankOcfm: bank && metricStatus(bank, 'ocfm'), bankFcf: bank && metricStatus(bank, 'fcf'),
        scaleNi5: scale && metricStatus(scale, 'ni5'), fcfMoney: FIELD_BY_K.fcf.money === true,
        yoyNm: (() => { const x = U.find(x => x.c.real && x.c.fin.length > 1 && !isNum(x.m.niYoY) && x.c.fin[x.c.fin.length - 2][2] <= 0 && isNum(x.c.fin[x.c.fin.length - 1][2]) && !x.m.perShareScaleBroken); return x ? metricStatus(x, 'niYoY') : null; })() };
    })()`);
    const p = [];
    if (r.bad.length) p.push(`${r.bad.length} values differ from their formula: ${r.bad.slice(0, 6).join('; ')}`);
    if (!r.split || !r.survives.length) p.push(`no split company keeps its net-income growth (${r.split} split)`);
    if (r.calc?.id !== 'calculated') p.push(`a filer's OCF margin: ${JSON.stringify(r.calc)}`);
    if (r.susp && r.susp.reason !== 'withheld') p.push(`OCF margin on a revenue line EBIT exceeds: ${JSON.stringify(r.susp)}`);
    if (r.bankOcfm?.reason !== 'not applicable' || r.bankFcf?.reason !== 'not applicable') p.push(`a bank's OCF margin / FCF: ${r.bankOcfm?.reason} / ${r.bankFcf?.reason}`);
    if (r.scaleNi5 && r.scaleNi5.reason !== 'withheld') p.push(`net income growth on a scale-broken filer: ${JSON.stringify(r.scaleNi5)}`);
    if (!r.fcfMoney) p.push('free cash flow is not flagged as money, so the screener would not convert or label it');
    if (r.yoyNm && !(r.yoyNm.reason === 'not meaningful' && /prior year/.test(r.yoyNm.text))) p.push(`one-year growth off a loss: ${JSON.stringify(r.yoyNm)}`);
    if (p.length) fail('net margin, OCF margin, free cash flow and the growth rates are what their formulas say', p);
    else ok(`net margin, OCF margin, free cash flow, net-income CAGR and both one-year rates match their formulas on all ${r.checked} filed companies; net-income growth stands on ${r.survives.length} of the ${r.split} split companies whose per-share rate is withheld (${r.survives.slice(0, 4).join(', ')}…); a bank's FCF and OCF margin read "not applicable"`);
  }

  /* 23 — Learn lists every registry row by category with its definition,
          inputs, unit and period, and says which measures are blocked and on
          what. The company page's provenance strip names the ingest version,
          or says the shipped file has none. */
  {
    await evaluate(`navigate('/learn/glossary')`); await sleep(500);
    const r = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('main .card')];
      const heads = cards.map(c => c.querySelector('.h-card')?.textContent || '');
      const tables = [...document.querySelectorAll('main table.dict')];
      const rows = tables.flatMap(t => [...t.querySelectorAll('tbody tr')]);
      const cols = tables[0] ? [...tables[0].querySelectorAll('thead th')].map(th => th.textContent) : [];
      const blockedRows = rows.filter(tr => tr.classList.contains('dict-row-blocked')).map(tr => tr.cells[0].querySelector('.metric-label span')?.textContent || tr.cells[0].textContent);
      const liq = cards.find(c => c.querySelector('.h-card')?.textContent === 'Liquidity');
      const nm = rows.find(tr => /^Net margin/.test(tr.cells[0].textContent));
      const intro = cards[0]?.textContent || '';
      return { heads, cols, n: rows.length, blockedRows, liqAllBlocked: !!liq && [...liq.querySelectorAll('tbody tr')].every(tr => tr.classList.contains('dict-row-blocked')),
        nm: nm ? [...nm.cells].map(td => td.textContent) : null, intro, cats: METRIC_CATEGORIES.map(c => c.label), total: METRICS.length,
        blockedWant: METRICS.filter(x => x.blocked).length };
    })()`);
    const p = [];
    if (r.n !== r.total) p.push(`${r.n} dictionary rows for ${r.total} registry rows`);
    if (JSON.stringify(r.heads.slice(1)) !== JSON.stringify(r.cats)) p.push(`category cards: ${r.heads.join(' | ')}`);
    if (r.cols.join('|') !== 'Metric|What it is|Formula and inputs|Unit and period|Computable|Missing-data behaviour') p.push(`columns: ${r.cols.join('|')}`);
    if (r.blockedRows.length !== r.blockedWant || !r.liqAllBlocked) p.push(`blocked rows: ${r.blockedRows.join(', ')}`);
    if (!/blocked/.test(r.intro) || !/Gross margin/.test(r.intro) || !/current assets/.test(r.intro)) p.push('the intro does not name the blocked measures and their lines');
    if (!r.nm || !/Net margin/.test(r.nm[0]) || !/net income ÷ revenue/.test(r.nm[2]) || !/percent/.test(r.nm[3]) || !/^\d+\/\d+$/.test(r.nm[4])) p.push(`net margin row: ${JSON.stringify(r.nm)}`);

    await evaluate(`openResearch('AAPL-SEC', 'snapshot'); true`); await sleep(500);
    const strip = await evaluate(`(() => {
      const chips = () => [...document.querySelectorAll('main .chip')].map(c => c.textContent);
      const before = chips().filter(t => /ingest/.test(t));
      const row = BY_ID.get('AAPL-SEC'); row.c.ingestVersion = 'sec 1.2.0';
      row.c.provenance = { ...row.c.provenance, rev: { ...row.c.provenance.rev, restated: { 2023: { from: 1, to: 2 } } } };
      render();
      const after = chips().filter(t => /ingest/.test(t));
      const restated = [...document.querySelectorAll('main .metaline')].some(p => /Restated in a later filing/.test(p.textContent) && /revenue FY2023/.test(p.textContent));
      row.c.ingestVersion = null; delete row.c.provenance.rev.restated; render();
      return { before, after, restated };
    })()`);
    if (strip.before.join() !== 'ingest version not in this dataset yet') p.push(`strip without a version: ${JSON.stringify(strip.before)}`);
    if (strip.after.join() !== 'ingest 1.2.0' || !strip.restated) p.push(`strip with a version and a restatement: ${JSON.stringify(strip)}`);
    if (p.length) fail('Learn publishes the registry with blocked measures named; the provenance strip carries the ingest version', p);
    else ok(`Learn lists all ${r.n} measures in ${r.cats.length} categories with definition, inputs, unit and period, and ${r.blockedRows.length} blocked rows (${r.blockedRows.join(', ')}); the provenance strip says the shipped file has no ingest version, and names one and a restated year when the record carries them`);
  }

  /* PHASE 2 C — THE COMPANY PAGE AS A RESEARCH DASHBOARD.
     The four overview tiles are the stored lines, not a recomputation; every
     company carries its source badge and the same freshness line; the header
     offers its four actions, with the scanner off unless the reader's own
     history is loaded; and a filer's exchange is not called "SEC filer". */
  {
    await evaluate(`openResearch('MSFT-SEC', 'snapshot'); true`);
    await sleep(1200);
    const r = await evaluate(`(() => {
      const rr = BY_ID.get('MSFT-SEC'), c = rr.c, row = c.fin[c.fin.length - 1];
      const want = [row[F.REV], row[F.NI], row[F.OCF], row[F.EQ]].map(v => fmtNum(v, Math.abs(v) < 10 ? 2 : 1));
      const tiles = [...document.querySelectorAll('main .overview-tiles .tile-btn')];
      const got = tiles.map(t => t.querySelector('.stat-value').textContent.trim());
      const badges = tiles.map(t => t.querySelector('.chip')?.textContent.trim());
      const fyOk = tiles.every(t => t.textContent.includes('FY' + latestFy(c)));
      tiles[0]?.click();
      const d = document.querySelector('#drawer');
      const dtxt = d && !d.hidden ? d.textContent : '';
      closeDrawer({ restore: false });
      const head = document.querySelector('main .card');
      const acts = [...head.querySelectorAll('.company-acts a, .company-acts button')].map(b => b.textContent.trim());
      const cmp = [...head.querySelectorAll('.company-acts a')].find(a => a.textContent.trim() === 'Compare');
      const scan = [...head.querySelectorAll('.company-acts a, .company-acts button')].find(b => b.textContent.trim() === 'Open scanner');
      const prov = head.querySelector('.prov')?.textContent || '';
      const exch = [...head.querySelectorAll('.chip')].map(x => x.textContent).find(t => t.includes(' · MSFT')) || '';
      const noDashRow = ![...document.querySelectorAll('main .stat-label')].some(x => /Market capitalisation/.test(x.textContent)) || isNum(c.px.p);
      return { want, got, badges, fyOk, dtxt: dtxt.slice(0, 2000), acts, cmpHref: cmp?.getAttribute('href') || null,
               scan: scan ? { tag: scan.tagName, disabled: !!scan.disabled, href: scan.getAttribute('href') } : null,
               lane: scannerLaneOn(), prov, exch, noDashRow,
               concept: c.provenance.rev.byYear[latestFy(c)] };
    })()`);
    const p = [];
    if (JSON.stringify(r.got) !== JSON.stringify(r.want)) p.push(`tiles read ${JSON.stringify(r.got)}, the stored lines are ${JSON.stringify(r.want)}`);
    if (r.badges.length !== 4 || r.badges.some(b => b !== 'Filed')) p.push(`source badges: ${JSON.stringify(r.badges)}`);
    if (!r.fyOk) p.push('a tile does not name its fiscal year');
    if (!r.dtxt.includes(r.concept) || !/Original unit/.test(r.dtxt) || !/Transformation/.test(r.dtxt)) p.push('the Revenue tile does not open a drawer naming its XBRL concept, original unit and transformation');
    for (const a of ['Add to watchlist', 'Compare', 'Save research', 'Open scanner'])
      if (!r.acts.some(x => x === a || (a === 'Add to watchlist' && /watchlist/.test(x)) || (a === 'Save research' && /investment case|Save research/.test(x)))) p.push(`header action missing: ${a}`);
    if (!r.cmpHref || !/\/compare\?companies=.*MSFT-SEC/.test(decodeURIComponent(r.cmpHref))) p.push(`Compare links to ${r.cmpHref}`);
    if (!r.scan) p.push('no scanner control');
    else if (r.lane ? !(r.scan.tag === 'A' && /\/my\/scanner\?.*symbol=MSFT/.test(r.scan.href || '')) : !r.scan.disabled) p.push(`scanner control with history ${r.lane}: ${JSON.stringify(r.scan)}`);
    if (!/Statements\s*FY/.test(r.prov) || !/Source/.test(r.prov) || !/As of/.test(r.prov)) p.push(`freshness line: ${r.prov.slice(0, 200)}`);
    if (/SEC filer/.test(r.exch)) p.push(`the exchange chip reads "${r.exch}"`);
    if (!r.noDashRow) p.push('market tiles render as dashes on an unpriced filer');
    if (p.length) fail('the company page opens on its reported figures, its actions and one freshness line', p);
    else ok(`MSFT-SEC opens on four filed tiles equal to its stored lines (${r.got.join(', ')}), each opening its source; Watchlist, Compare, Save research and a ${r.lane ? 'live' : 'switched-off'} personal-lane scanner; one freshness line; exchange "${r.exch}"`);
  }
  {
    const r = await evaluate(`(() => {
      const out = {};
      for (const id of ['MAYBANK', 'AAPL-SEC']) {
        openResearch(id, 'snapshot');
        const head = document.querySelector('main .card');
        out[id] = { badges: [...document.querySelectorAll('main .overview-tiles .chip')].map(x => x.textContent.trim()),
                    prov: head.querySelector('.prov')?.textContent || '' };
      }
      navigate('/compare?companies=MSFT-SEC');
      out.compare = State.compare.includes('MSFT-SEC');
      return out;
    })()`);
    const p = [];
    if (!r.MAYBANK.badges.length || r.MAYBANK.badges.some(b => b !== 'Illustrative')) p.push(`MAYBANK badges ${JSON.stringify(r.MAYBANK.badges)}`);
    for (const id of ['MAYBANK', 'AAPL-SEC']) if (!/Statements\s*FY\d{4}/.test(r[id].prov) || !/Source/.test(r[id].prov)) p.push(`${id} freshness line: ${r[id].prov.slice(0, 160)}`);
    if (!/synthetic sample/.test(r.MAYBANK.prov)) p.push('the illustrative freshness line does not say synthetic');
    if (!r.compare) p.push('/compare?companies=MSFT-SEC does not select it');
    if (p.length) fail('every company carries its source badge and the same freshness line', p);
    else ok('an illustrative company badges its tiles Illustrative and says "synthetic sample" on the same freshness line a filer carries; the Compare link selects the company');
  }

  /* The statements explorer: three statements, changes on request agreeing
     with changeSummary, a reason in every empty cell, and each cell opening
     the line drawer with its XBRL concept and the EDGAR record. */
  {
    await evaluate(`State.finChanges = false; openResearch('MSFT-SEC', 'financials'); true`);
    await sleep(1200);
    const r = await evaluate(`(() => {
      const rr = BY_ID.get('MSFT-SEC'), c = rr.c, fy = latestFy(c);
      const t = document.querySelector('main table.stmt-table');
      const groups = [...t.querySelectorAll('tr.grp th')].map(th => th.textContent.trim());
      State.finChanges = true; render();
      const t2 = document.querySelector('main table.stmt-table');
      const rev = [...t2.querySelectorAll('tbody tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'Revenue');
      const tds = [...rev.querySelectorAll('td')];
      const pct = tds[tds.length - 2].textContent.trim();
      const want = withSign(changeSummary(c).find(x => x.label === 'Revenue').v, 1);
      State.finChanges = false; render();
      const cell = [...document.querySelectorAll('main table.stmt-table tbody tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'Revenue').querySelectorAll('td.cell-sourced');
      const last = cell[cell.length - 1];
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const d = document.querySelector('#drawer');
      const txt = d.hidden ? '' : d.textContent;
      const sec = [...d.querySelectorAll('a[href*="sec.gov"]')];
      const out = { groups, pct, want, fy, concept: c.provenance.rev.byYear[fy], title: document.getElementById('drawerTitle').textContent,
        txtOk: txt.includes(c.provenance.rev.byYear[fy]) && /Original unit/.test(txt) && /USD, whole dollars/.test(txt) && /not in this dataset yet/.test(txt),
        links: sec.length, rel: sec.every(a => /noopener/.test(a.rel)), role: last.getAttribute('role'), tab: last.tabIndex };
      closeDrawer({ restore: false });
      return out;
    })()`);
    const p = [];
    if (r.groups.join('|') !== 'Income statement|Balance sheet|Cash flow') p.push(`group rows: ${JSON.stringify(r.groups)}`);
    if (r.pct !== r.want) p.push(`Revenue Δ% FY${r.fy} reads ${r.pct}, changeSummary says ${r.want}`);
    if (!/Revenue · FY/.test(r.title) || !r.txtOk) p.push(`the Revenue FY${r.fy} drawer ("${r.title}") does not name ${r.concept}, the original unit and the filing status`);
    if (r.links < 3 || !r.rel) p.push(`drawer EDGAR links: ${r.links}, rel noopener ${r.rel}`);
    if (r.role !== 'button' || r.tab !== 0) p.push('a statement cell is not a keyboard button');
    if (p.length) fail('the statements table is three statements whose every cell opens its source', p);
    else ok(`MSFT-SEC statements group into three statements, Revenue Δ% ${r.pct} agrees with changeSummary, and Enter on a cell opens its drawer naming ${r.concept} with ${r.links} EDGAR links`);
  }
  {
    await evaluate(`openResearch('ABT-SEC', 'financials'); true`);
    await sleep(1000);
    const r = await evaluate(`(() => {
      const row = [...document.querySelectorAll('main table.stmt-table tbody tr')].find(tr => tr.querySelector('td')?.textContent.trim() === 'Dividend per share');
      if (!row) return { missing: true };
      const first = row.querySelectorAll('td')[1];
      const span = first.querySelector('.cell-absent');
      return { text: first.textContent.trim(), title: span?.getAttribute('title') || '' };
    })()`);
    if (r.missing) fail('ABT-SEC has no dividend row on the Financials tab');
    else if (r.text !== 'not reported' || !/CommonStockDividendsPerShareDeclared/.test(r.title)) fail('ABT-SEC\'s absent early dividend does not name its reason and tag', r);
    else ok('ABT-SEC\'s absent early dividend reads "not reported" and names the tag that returned nothing');
  }

  /* The CSV reproduces the table: one row per line per year, full-precision
     values equal to the stored cells, the concept per cell, and empty where
     absent. Personal-lane statements are refused; the Free plan's rule is
     stated beside the button. */
  {
    const r = await evaluate(`(() => {
      const out = {};
      for (const id of ['MSFT-SEC', 'ABT-SEC', 'MAYBANK']) {
        const rr = BY_ID.get(id), c = rr.c, yrs = yearsOf(c), lines = statementLines(rr);
        const text = statementsCsv(rr);
        const rows = text.split('\\n').filter(l => l && !l.startsWith('#'));
        const parse = (l) => { const o = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i];
          if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
          else if (ch === '"') q = true; else if (ch === ',') { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
        const head = parse(rows[0]), body = rows.slice(1).map(parse);
        const col = (n) => head.indexOf(n);
        const bad = [];
        body.forEach(cells => {
          const line = lines.find(l => l.key === cells[col('line_key')]); const i = yrs.indexOf(Number(cells[col('fiscal_year')]));
          const v = line?.arr[i], got = cells[col('value')];
          if (!line || i < 0) bad.push('unknown row ' + cells.slice(3, 7).join('/'));
          else if (isNum(v) ? Number(got) !== v : got !== '') bad.push(line.key + ' FY' + yrs[i] + ': ' + got + ' vs ' + v);
          else if (c.real && !c.personal && !line.derived && (cells[col('xbrl_concept')] || '') !== (lineConcept(c, line.key, yrs[i]) || '')) bad.push(line.key + ' concept');
        });
        out[id] = { rows: body.length, want: lines.length * yrs.length, bad: bad.slice(0, 5), unit: col('unit') >= 0 && col('currency') >= 0 && col('source') >= 0,
                    footer: /Research only/.test(text), illus: /synthetic/.test(text) };
      }
      let toastText = '';
      const t0 = window.toast; window.toast = (m) => { toastText = m; };
      try { exportStatements({ c: { personal: true, tk: 'X' } }); } finally { window.toast = t0; }
      out.personal = toastText;
      openResearch('MSFT-SEC', 'financials');
      out.note = document.getElementById('stmt-csv-note')?.textContent || '';
      out.exports = !!lim('exports');
      return out;
    })()`);
    const p = [];
    for (const id of ['MSFT-SEC', 'ABT-SEC', 'MAYBANK']) {
      const x = r[id];
      if (x.rows !== x.want) p.push(`${id}: ${x.rows} CSV rows for ${x.want} cells`);
      if (x.bad.length) p.push(`${id}: ${x.bad.join('; ')}`);
      if (!x.unit || !x.footer) p.push(`${id}: unit/currency/source columns or footer missing`);
    }
    if (!r.MAYBANK.illus) p.push('the illustrative CSV does not say synthetic');
    if (!/not redistributable/.test(r.personal)) p.push(`personal-lane export: "${r.personal}"`);
    if (r.exports ? !/every line and year/.test(r.note) : !/Equities Research/.test(r.note)) p.push(`CSV note on plan exports=${r.exports}: "${r.note}"`);
    if (p.length) fail('the statements CSV round-trips the table', p);
    else ok(`the statements CSV round-trips every cell of MSFT-SEC (${r['MSFT-SEC'].rows}), ABT-SEC and MAYBANK with its concept, refuses personal-lane statements, and states the plan rule`);
  }

  /* The measure drawer, completed: original unit, the ingest's
     transformation for the lines it reads, the filing status, and EDGAR links
     from the one builder the Filings tab also uses. Reused by Compare. */
  {
    const r = await evaluate(`(() => {
      const rr = BY_ID.get('MSFT-SEC');
      openSourceDrawer(rr, FIELD_BY_K.de);
      const d = document.querySelector('#drawer'), txt = d.textContent;
      const links = [...d.querySelectorAll('a[href*="sec.gov"]')].map(a => a.href);
      closeDrawer({ restore: false });
      const same = JSON.stringify(edgarLinks(rr.c).map(x => x.href));
      openResearch('MSFT-SEC', 'filings');
      const card = [...document.querySelectorAll('main .card')].find(cd => /SEC filings/.test(cd.textContent));
      const filingLinks = JSON.stringify([...card.querySelectorAll('a[href*="sec.gov"]')].map(a => a.getAttribute('href')));
      const ids = U.filter(x => x.c.real && !x.c.personal && !isNum(x.c.px.p)).slice(0, 2).map(x => x.c.id);
      State.compare = ids; navigate('/compare');
      const cells = [...document.querySelectorAll('main table.dt td.cell-sourced')];
      const absent = cells.find(td => td.querySelector('.cell-absent'));
      absent?.click();
      const ctxt = document.querySelector('#drawer').hidden ? '' : document.querySelector('#drawer').textContent;
      closeDrawer({ restore: false });
      return { unit: /Original unit/.test(txt) && /USD, whole dollars/.test(txt), sum: /non-current line plus the current portion/.test(txt),
               filing: /Filing/.test(txt) && /not in this dataset yet/.test(txt), stale: /None\\. The figure is computed directly/.test(txt),
               links: links.length, same: same === filingLinks, sourced: cells.length,
               absent: absent ? absent.textContent.trim() : null, opened: /Why it is absent|What it is/.test(ctxt) };
    })()`);
    const p = [];
    if (!r.unit) p.push('no original unit');
    if (!r.sum) p.push('debt / equity drawer does not say debt is summed');
    if (!r.filing) p.push('no filing row saying the filing date is not held yet');
    if (r.stale) p.push('the drawer still says nothing was transformed');
    if (r.links < 3) p.push(`only ${r.links} EDGAR links in the drawer`);
    if (!r.same) p.push('the Filings tab builds its EDGAR links differently from edgarLinks()');
    if (!r.sourced || !['not reported', 'n/a', 'withheld', 'no price', 'n/m'].includes(r.absent) || !r.opened) p.push(`compare: ${r.sourced} sourced cells, absent "${r.absent}", drawer opened ${r.opened}`);
    if (p.length) fail('the source drawer states unit, transformation, filing and EDGAR, and Compare opens it', p);
    else ok(`the source drawer names the original unit, the debt sum, the filing status and ${r.links} EDGAR links from the Filings tab's own builder; Compare cells open it (${r.sourced} sourced, an absent one reads "${r.absent}")`);
  }
  {
    const r = await evaluate(`(() => {
      scanDraft = null;
      navigate('/app/scanner/setups/new?symbol=MSFT');
      const inp = [...document.querySelectorAll('main input')].find(i => /Instruments/.test(i.getAttribute('aria-label') || ''));
      const v = inp ? inp.value : null;
      scanDraft = null;
      return { v };
    })()`);
    if (r.v !== 'MSFT') fail('the scanner builder does not start on the ?symbol= the company page sends', r);
    else ok('the scanner builder starts on the symbol the company page sends (?symbol=MSFT)');
  }
  /* ===================================================================== */
  /* PHASE 2 BATCH F — compare, valuation bridge, stamps, workspace, report */
  /* ===================================================================== */

  /* THE DCF ARITHMETIC, AGAINST A HAND COMPUTATION. No harness asserted what
     valueDCF returns, only that a missing bridge refuses. The fixture is the
     plan's: FCF 1, year-1 growth 5% fading to 2%, 8%, five years, net debt 2,
     one share, and the reader's +0.5 adjustment — recomputed here in plain
     arithmetic, not by calling the engine twice. */
  {
    const r = await evaluate(`(() => {
      const inp = { model:'dcf', fcf0:1, g1:5, gt:2, wacc:8, years:5, netDebt:2, shares:1, adj:0.5, hold:0 };
      let f = 1, pv = 0;
      for (let t = 1; t <= 5; t++) { const g = 0.05 + (0.02 - 0.05) * (t - 1) / 4; f *= 1 + g; pv += f / Math.pow(1.08, t); }
      const tv = f * 1.02 / (0.08 - 0.02) / Math.pow(1.08, 5);
      const want = pv + tv - 2 + 0.5;
      const got = valueDCF(inp);
      const noAdj = valueDCF({ ...inp, adj: 0 }), legacy = valueDCF({ ...inp, adj: undefined });
      const scen = valueScenario({ model:'scenario', rev0:10, revCagr:10, margin0:20, termMargin:25, fcfConv:80, wacc:9, gt:2, years:6, dilution:0, netDebt:1, shares:2, adj:-1 });
      const scen0 = valueScenario({ model:'scenario', rev0:10, revCagr:10, margin0:20, termMargin:25, fcfConv:80, wacc:9, gt:2, years:6, dilution:0, netDebt:1, shares:2, adj:0 });
      return { want, got: got.perShare, adjStep: got.perShare - noAdj.perShare, legacySame: legacy.perShare === noAdj.perShare,
        gtErr: !!valueDCF({ ...inp, gt: 8 }).error, scenStep: scen0.perShare - scen.perShare,
        defaults: ['AAPL-SEC', 'MSFT-SEC'].map(id => BY_ID.get(id).inputs.adj) };
    })()`);
    const p = [];
    if (Math.abs(r.want - r.got) > 1e-9) p.push(`value per share ${r.got} against a hand computation of ${r.want}`);
    if (Math.abs(r.adjStep - 0.5) > 1e-12) p.push(`a +0.5 adjustment moved the value by ${r.adjStep}`);
    if (!r.legacySame) p.push('a run saved before the adjustment existed does not value as an adjustment of nil');
    if (!r.gtErr) p.push('terminal growth equal to the discount rate did not refuse');
    if (Math.abs(r.scenStep - 0.5) > 1e-12) p.push(`the scenario pack's −1 adjustment over two shares moved the value by ${r.scenStep}`);
    if (r.defaults.some(v => v !== 0)) p.push(`the derived default adjustment is not nil: ${JSON.stringify(r.defaults)}`);
    if (p.length) fail('the DCF bridge is equity = EV − net debt + your adjustment, to the cent', p);
    else ok(`the DCF values the hand-computed fixture to 1e-9 (${r.got.toFixed(4)} a share), the adjustment moves it by exactly adj ÷ shares in both packs, and the default claims nothing`);
  }

  /* THE BRIDGE IS THE READER'S ONCE CHANGED, AND IT SURVIVES A RELOAD. Net
     debt edited in the Studio is labelled as theirs beside the reported
     figure, warned about above the estimate, written to storage, and read
     back after a full reload; the explainer carries the current discount
     rate and the confidence parts add to the score shown. */
  {
    const id = await evaluate(`(U.find(x => x.c.real && x.inputs.model === 'dcf' && !x.val.err && x.val.confParts) || {}).c?.id || null`);
    if (!id) fail('no filed company with a DCF estimate to edit', id);
    else {
      await evaluate(`store.write('valuation', {}); State.valuation = {}; navigate(companyPath(BY_ID.get(${JSON.stringify(id)}).c) + '?tab=valuation')`);
      await sleep(600);
      const before = await evaluate(`(() => {
        const r = BY_ID.get(${JSON.stringify(id)});
        const f = document.getElementById('as-netDebt');
        if (!f) return { missing: true };
        const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
        const want = +(r.inputs.netDebt + 3).toFixed(3);
        set(f, String(want));
        set(document.getElementById('as-adj'), '-1.5');
        persistValuation(r, true);
        const main = document.querySelector('main').innerText;
        return { want, hint: f.closest('.assumption').querySelector('.a-default')?.textContent || '',
          warned: /Net debt is your figure/.test(main) && /Subtracts/.test(main),
          stored: store.read('valuation', {})[${JSON.stringify(id)}] };
      })()`);
      await send('Page.reload', {}, sessionId);
      let back = null;
      for (let i = 0; i < 60 && !back; i++) { await sleep(500); try { back = await evaluate(`typeof realPending !== 'undefined' && !realPending && document.getElementById('as-netDebt') ? true : null`); } catch { /* booting */ } }
      const after = await evaluate(`(() => {
        const r = BY_ID.get(${JSON.stringify(id)});
        document.querySelectorAll('details.explain').forEach(d => d.open = true);
        const run = valuationRun(r.c, r.d, studioInputs(r));
        const ex = [...document.querySelectorAll('details.explain')].map(d => d.textContent);
        const p = run.confParts;
        return { value: document.getElementById('as-netDebt')?.value, adj: document.getElementById('as-adj')?.value,
          whose: document.querySelector('.a-whose')?.textContent || '',
          waccShown: ex[0]?.includes(fmtPct(studioInputs(r).wacc, 2)), conf: run.conf, parts: p.coverage + p.type + (p.band || 0),
          confText: ex[1]?.includes(run.conf + ' of 100'), snapshotSays: (() => { const r2 = BY_ID.get(${JSON.stringify(id)}); return editedKeys(r2).length; })() };
      })()`);
      const p = [];
      if (before.missing) p.push('the DCF rail has no net debt input');
      else {
        if (!/Your figure · reported/.test(before.hint)) p.push(`the edited input is not labelled as the reader's: "${before.hint}"`);
        if (!before.warned) p.push('no warning above the estimate says the bridge is the reader\'s');
        if (!before.stored || before.stored.over?.netDebt !== before.want || before.stored.over?.adj !== -1.5 || !before.stored.stamp?.model) p.push(`stored edit ${JSON.stringify(before.stored)}`);
        if (Number(after.value) !== before.want || Number(after.adj) !== -1.5) p.push(`after a reload the inputs read ${after.value} and ${after.adj}`);
        if (!/Your assumptions · 2 of/.test(after.whose)) p.push(`rail header after reload: "${after.whose}"`);
        if (!after.waccShown) p.push('the explainer does not carry the current discount rate');
        if (after.parts !== after.conf || !after.confText) p.push(`confidence parts ${after.parts} against the score ${after.conf}`);
        if (after.snapshotSays !== 2) p.push(`the snapshot's edited check sees ${after.snapshotSays} edits`);
      }
      await evaluate(`store.write('valuation', {}); State.valuation = {}; true`);
      if (p.length) fail('net debt and the adjustment are the reader\'s, labelled, and kept across a reload', p);
      else ok(`net debt and a signed adjustment on ${id} are labelled as the reader's, warned about, kept across a reload, and explained with the current discount rate — confidence ${after.conf} = the sum of its three parts`);
    }
  }

  /* SENSITIVITY ON THE READER'S AXES. A chosen pair builds a 5×5 grid whose
     centre is the base case; the choice is kept per model; the pack's pair is
     what an untouched page shows. */
  {
    const r = await evaluate(`(() => {
      const row = U.find(x => x.c.real && x.inputs.model === 'dcf' && !x.val.err);
      const inputs = { ...row.inputs };
      const out = { def: sensitivityAxes(row, inputs).custom };
      store.write('sensAxes', { dcf: { x: 'netDebt', xs: 2, y: 'years', ys: 1 } });
      const ch = sensitivityAxes(row, inputs);
      const g = sensitivityGrid(inputs, ch.ax);
      out.custom = ch.custom; out.dims = [g.length, g[0].length];
      out.centre = g[2][2]; out.base = valuationRun(row.c, row.d, inputs).vals.base;
      out.yearsInt = sensAxis(ch.ax.y, inputs).values.every(Number.isInteger);
      store.write('sensAxes', {});
      return out;
    })()`);
    const p = [];
    if (r.def !== false) p.push('an untouched page does not show the pack\'s own pair');
    if (!r.custom || r.dims.join('x') !== '5x5') p.push(`custom grid ${JSON.stringify(r.dims)}`);
    if (Math.abs(r.centre - r.base) > 1e-9) p.push(`centre ${r.centre} against base ${r.base}`);
    if (!r.yearsInt) p.push('a forecast-years axis stepped through a fractional year');
    if (p.length) fail('the sensitivity grid takes the reader\'s own axes and steps', p);
    else ok('the sensitivity grid takes any two inputs and steps — 5×5, centred on the base case, whole forecast years — and defaults to the pack\'s pair');
  }

  /* COMPARE SAYS WHAT EACH COLUMN IS. A filed FY2026 company beside a filed
     FY2025 one and a synthetic bank: the period, basis and scale rows exist,
     the banner names the period gap and the synthetic-beside-filed mix, a
     bank has no free cash flow, and no cell is the bare generic "n/a". An
     unpriced filer's price says "no price". */
  {
    const r = await evaluate(`(() => {
      const unpriced = U.find(x => x.c.real && !isNum(x.c.px?.p) && x.c.type !== 'bank');
      const ids = ['MSFT-SEC', 'AAPL-SEC', 'MAYBANK'];
      State.compare = [...ids]; State.plan = 'pro'; navigate('/compare?companies=' + ids.join(','));
      const labels = [...document.querySelectorAll('main table.dt tbody tr')].map(tr => tr.cells[0]?.textContent);
      const rowOf = (l) => [...document.querySelectorAll('main table.dt tbody tr')].find(tr => tr.cells[0]?.textContent === l);
      const banner = [...document.querySelectorAll('main .guardrail')].map(n => n.textContent).join(' ');
      const bare = [...document.querySelectorAll('main table.dt td')].filter(td => td.innerHTML === NA).length;
      const basis = [...rowOf('Accounting basis').cells].slice(1).map(td => td.textContent);
      const fcfBank = rowOf('Free cash flow')?.cells[3]?.textContent;
      const out = { labels, banner, bare, basis, fcfBank };
      State.compare = [unpriced.c.id, 'AAPL-SEC']; navigate('/compare?companies=' + State.compare.join(','));
      out.price = rowOf('Price')?.cells[1]?.textContent; out.unpriced = unpriced.c.id;
      out.periodSame = ![...document.querySelectorAll('main .guardrail')].some(n => /twelve months/.test(n.textContent)) || latestFy(unpriced.c) !== latestFy(BY_ID.get('AAPL-SEC').c);
      State.compare = ['MAYBANK', 'PBBANK']; navigate('/compare?companies=MAYBANK,PBBANK');
      out.bankFcfRow = !!rowOf('Free cash flow');
      return out;
    })()`);
    const p = [];
    for (const l of ['Reporting period', 'Accounting basis', 'Revenue, latest year', 'Operating cash flow', 'Free cash flow', 'Net debt', 'Revenue growth, latest year'])
      if (!r.labels.includes(l)) p.push(`no "${l}" row`);
    if (!/FY2025 statements with FY2026 statements/.test(r.banner)) p.push('the banner does not name the period gap');
    if (!/synthetic demonstration figures beside filed statements/.test(r.banner)) p.push('the banner does not flag synthetic beside filed');
    if (r.basis.join('|') !== 'US GAAP|US GAAP|None — illustrative') p.push(`basis row ${r.basis.join('|')}`);
    if (r.fcfBank !== 'n/a') p.push(`a bank's free cash flow cell reads "${r.fcfBank}"`);
    if (r.bare) p.push(`${r.bare} cells print the bare generic n/a`);
    if (r.price !== 'no price') p.push(`${r.unpriced}'s price cell reads "${r.price}"`);
    if (!r.periodSame) p.push('two filers with the same fiscal year were flagged as different periods');
    if (r.bankFcfRow) p.push('an all-bank selection carries a free cash flow row');
    if (p.length) fail('the comparison states each column\'s period, basis and scale, and every absence\'s reason', p);
    else ok(`the comparison carries period, basis and scale rows, flags FY2025 against FY2026 and synthetic beside filed, prints "no price" for ${r.unpriced}, and no cell is a bare n/a`);
  }

  /* ONE STAMP, AND WHAT MOVED. A stamp records model and data; a moved
     model and a moved dataset are reported apart; an item from before
     stamping says so; every saved kind carries one. */
  {
    const r = await evaluate(`(() => {
      const c = BY_ID.get('AAPL-SEC').c;
      const s = buildStamp(c);
      const out = { s, illus: buildStamp(BY_ID.get('MAYBANK').c).illustrative, mixed: buildStamp([c, BY_ID.get('MAYBANK').c]).illustrative };
      out.current = stampDiff(s).status;
      out.model = stampDiff({ ...s, model: 'metrics 1.5.0 · scores 1.3.0 · valuation 1.4.0' });
      out.data = stampDiff({ ...s, data: { 'us.json': { v: 'a635756100ff', generated: '2026-08-03' } } });
      out.legacy = stampDiff(null, { model: MODEL_VERSION });
      out.none = stampDiff(null);
      out.work = buildStamp('property').data;
      return out;
    })()`);
    const p = [];
    if (r.s.model !== await evaluate('MODEL_VERSION') || !r.s.data['us.json']?.v || r.s.illustrative !== 'none' || !r.s.savedAt) p.push(`stamp ${JSON.stringify(r.s)}`);
    if (r.illus !== 'all' || r.mixed !== 'some') p.push(`illustrative flags ${r.illus}, ${r.mixed}`);
    if (r.current !== 'current') p.push(`a fresh stamp reads ${r.current}`);
    if (r.model.status !== 'model' || !/valuation 1\.4\.0 → 1\.5\.0|valuation 1\.4\.0 →/.test(r.model.text) || r.model.dataMoved) p.push(`model move ${JSON.stringify(r.model)}`);
    if (r.data.status !== 'data' || r.data.modelMoved || !/Data moved: saved against us\.json a635756/.test(r.data.text)) p.push(`data move ${JSON.stringify(r.data)}`);
    if (r.legacy.status !== 'unstamped' || r.legacy.modelMoved !== false || r.none.status !== 'unstamped') p.push('an unstamped item is not reported as such');
    if (!r.work['napic-h1-2025.json']?.v) p.push(`a property snapshot does not stamp the data it reads ${JSON.stringify(r.work)}`);
    if (p.length) fail('one stamp on every saved item, and stampDiff says which of model and data moved', p);
    else ok('a stamp records the model, each data file by hash and the illustrative flag; stampDiff reports a model move, a data move and an unstamped item apart');
  }

  /* THE WORKSPACE AND THE ONE EXPORT. A run, a comparison, a screen, a case
     and a tool snapshot each appear once in the workspace list with a stamp;
     the export carries every kind and the data versions; a clear and import
     brings the same keys back; a saved comparison reopens with its verdict. */
  {
    const r = await evaluate(`(async () => {
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      const keep = Object.fromEntries(['runs', 'comparisons', 'savedScreens', 'savedWork', 'theses', 'valuation'].map(k => [k, localStorage.getItem('vl.' + k)]));
      ['runs', 'comparisons', 'savedWork'].forEach(k => store.write(k, []));
      State.savedScreens = []; store.write('savedScreens', []);
      const aapl = BY_ID.get('AAPL-SEC');
      saveValuationRun(aapl, studioInputs(aapl));
      State.compare = ['AAPL-SEC', 'MSFT-SEC']; navigate('/compare?companies=AAPL-SEC,MSFT-SEC');
      const cmp = saveComparison('Two filers');
      const def = JSON.parse(JSON.stringify(State.screen));
      State.savedScreens = [{ name: 'Test screen', def, snapshot: screenSnapshot(def), alertOnMatch: false }]; store.write('savedScreens', State.savedScreens);
      saveWork('property', 'Test deal');
      /* The checks above may have deleted every case; one is written so the
         fifth kind is present, and the stored list is restored below. */
      const thesesBefore = State.theses;
      if (!(State.theses || []).length) { State.theses = [{ id: 't-ws-test', ticker: 'AAPL-SEC', oneLine: 'test case', conds: [], catalysts: [], risks: [], questions: [], created: '2026-09-28', stamp: buildStamp(aapl.c) }]; saveTheses(); }
      const items = workspaceItems();
      const want = store.read('runs', []).length + loadComparisons().length + State.savedScreens.length + (State.theses || []).length + loadWork().length;
      const kinds = [...new Set(items.map(i => i.kind))].sort();
      const stamped = items.filter(i => i.kind !== 'thesis').every(i => i.stamp?.model);
      navigate('/my/workspace'); await wait(200);
      const listed = document.querySelectorAll('.ws-list .ws-row:not(.ws-head)').length;
      const inNav = [...document.querySelectorAll('main nav.my-subnav a[aria-current=page]')].some(a => a.textContent === 'Workspace');
      const doc = exportEverything();
      const exported = ['runs', 'comparisons', 'savedScreens', 'savedWork', 'theses'].filter(k => k in doc.data);
      const run0 = doc.data.runs[0];
      ['runs', 'comparisons', 'savedScreens', 'savedWork'].forEach(k => localStorage.removeItem('vl.' + k));
      const imp = importEverything(JSON.parse(JSON.stringify(doc)));
      imp.apply();
      const back = store.read('runs', [])[0];
      const replay = valuationRun(aapl.c, aapl.d, back.inputs).vals.base;
      openComparison(cmp.id); await wait(200);
      const card = [...document.querySelectorAll('main .card')].find(c => /Saved comparison — Two filers/.test(c.textContent))?.textContent || '';
      Object.entries(keep).forEach(([k, v]) => v == null ? localStorage.removeItem('vl.' + k) : localStorage.setItem('vl.' + k, v));
      State.savedScreens = store.read('savedScreens', []);
      State.theses = thesesBefore;
      return { n: items.length, want, kinds, stamped, listed, inNav, exported, dataVersions: doc.dataVersions,
        replaySame: Math.abs(replay - run0.vals.base) < 1e-9, runHas: ['stamp', 'assumptions', 'statements', 'sources'].filter(k => run0[k]),
        card: /Current/.test(card) && /Every cell of the companies still selected reads as it did/.test(card),
        portable: ['valuation', 'comparisons', 'runs'].every(k => PORTABLE_KEYS.some(x => x.k === k)) };
    })()`);
    const p = [];
    if (r.n !== r.want) p.push(`workspace lists ${r.n} of ${r.want} saved items`);
    if (r.kinds.join() !== 'comparison,run,screen,thesis,work') p.push(`kinds ${r.kinds}`);
    if (!r.stamped) p.push('an item saved in this run carries no stamp');
    if (r.listed !== r.n) p.push(`the page shows ${r.listed} rows for ${r.n} items`);
    if (!r.inNav) p.push('Workspace is not the selected tab in the My Investments subnav');
    if (r.exported.length !== 5 || !r.dataVersions?.['us.json']) p.push(`export carries ${r.exported} and data versions ${JSON.stringify(r.dataVersions)}`);
    if (!r.portable) p.push('PORTABLE_KEYS lacks valuation, comparisons or runs');
    if (r.runHas.length !== 4) p.push(`a saved run keeps only ${r.runHas}`);
    if (!r.replaySame) p.push('an imported run does not replay to its saved base case');
    if (!r.card) p.push('a reopened comparison does not say it is current and unchanged');
    if (p.length) fail('the workspace lists every saved kind with its stamp, and one export carries them all', p);
    else ok(`the workspace lists all ${r.n} saved items across five kinds with stamps, the export carries every kind plus the data versions, an imported run replays to its saved base case, and a reopened comparison reports itself unchanged`);
  }

  /* THE REPORT. A filed company's cover says SEC-filed, an illustrative
     one's says illustrative; the five figure kinds are legended; every
     absent metric prints a reason; a report from a saved run prints the
     saved statements and says the live data has moved; the chrome says the
     PDF is the browser's print. */
  {
    const r = await evaluate(`(async () => {
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      const txt = () => document.querySelector('.research-report')?.innerText || '';
      const out = {};
      navigate('/company/aapl-apple-inc/report'); await wait(150);
      const cover = () => document.querySelector('.rr-cover')?.textContent || '';
      out.view = State.view; out.filed = /SEC-filed statements/.test(cover()) && !/illustrative figures/.test(cover());
      out.legend = ['Reported', 'Calculated', 'Market', 'Modelled', 'Illustrative'].every(k => new RegExp('\\\\n' + k + '\\\\n').test(txt()));
      out.chrome = /your browser’s own/.test(document.querySelector('.dr-chrome')?.textContent || '') && /Nothing is generated on a server/.test(document.querySelector('.dr-chrome')?.textContent || '');
      out.blankMetric = [...document.querySelectorAll('.research-report table.dt tbody tr')].filter(tr => tr.cells.length === 5 && !tr.cells[1].textContent.trim()).length;
      navigate('/app/equities/maybank/report'); await wait(150);
      out.alias = State.view === 'researchReport'; out.illus = /illustrative figures/.test(cover());
      const aapl = BY_ID.get('AAPL-SEC');
      saveValuationRun(aapl, studioInputs(aapl));
      const runs = store.read('runs', []); const run = runs[0];
      run.statements.fin[run.statements.fin.length - 1][0] = 999.5;
      run.stamp.data['us.json'].v = '000000000000';
      store.write('runs', runs);
      navigate(companyPath(aapl.c) + '/report?run=' + run.runId); await wait(150);
      out.fromRun = /From saved run/.test(cover());
      out.savedRevenue = [...document.querySelectorAll('.research-report .dr-fig')].find(f => /Revenue/.test(f.textContent))?.textContent.includes(fmtCap(999.5, 'USD'));
      out.movedNotice = /differ from the ones saved with the run; this report prints the saved ones/.test(txt()) && /Data moved/.test(txt());
      store.write('runs', runs.filter(x => x.runId !== run.runId));
      return out;
    })()`);
    const p = [];
    if (r.view !== 'researchReport' || !r.filed) p.push(`filed cover ${JSON.stringify(r)}`);
    if (!r.alias || !r.illus) p.push('the /app/equities alias or the illustrative cover label');
    if (!r.legend) p.push('the five figure kinds are not all legended');
    if (!r.chrome) p.push('the page does not say the PDF is the browser\'s print');
    if (r.blankMetric) p.push(`${r.blankMetric} metric rows print a blank value`);
    if (!r.fromRun || !r.savedRevenue) p.push('a report from a saved run does not print the saved statements');
    if (!r.movedNotice) p.push('a report from a run whose data moved does not say so');
    if (p.length) fail('the research report identifies, legends and reproduces what it prints', p);
    else ok('the research report labels filed and illustrative covers, legends all five figure kinds, leaves no metric blank, says the PDF is the browser\'s print, and from a saved run prints the saved statements with a moved-data notice');
  }
  /* ═══════════════════════════════════════════════════════════════════════
     THE RESEARCH QA CHECKLIST (Phase 2 brief EQ-215; docs/phase2-qa.md maps
     all eighteen items). What follows are the items no check above covered.
     Each names its checklist number so the map can point at it, and each is
     a definition or a pinned fact rather than a snapshot of today's page.
     ═══════════════════════════════════════════════════════════════════════ */

  /* Waits for the whole filed set after a reload or a navigation that boots
     the app again. The first wait at the top of the file is the model. */
  const waitFiled = async (n = expected) => {
    let got = 0;
    for (let i = 0; i < 80 && got !== n; i++) {
      await sleep(500);
      try { got = await evaluate(`typeof U === 'undefined' || typeof realPending === 'undefined' || realPending ? -1 : U.filter(r => r.c.real).length`); } catch { /* booting */ }
    }
    return got === n;
  };

  /* Checklist 1 and 2 — CANONICAL IDS ACROSS EXCHANGES, AND EVERY ALIAS.
     One instrument per market and symbol, of the MARKET:SYMBOL form; every
     company row is exactly one instrument and the instrument names it back;
     and not a sample of aliases but all of them — every filer by its
     ticker, its -SEC id and its CIK, every Bursa row by its listing code,
     its short name and the vendor's .KL form. */
  {
    const r = await evaluate(`(() => {
      rebuildInstruments();
      const bad = [];
      for (const k of INSTRUMENTS.keys()) if (!/^[A-Z]{2,6}:[^\\s:]+$/.test(k)) bad.push('id shape ' + k);
      const seen = new Map();
      for (const row of U) {
        const ins = instrumentOfCompany(row.c);
        if (!INSTRUMENTS.has(ins.id)) { bad.push(row.c.id + ' has no instrument'); continue; }
        if (INSTRUMENTS.get(ins.id).companyId !== row.c.id) bad.push(ins.id + ' names ' + INSTRUMENTS.get(ins.id).companyId + ', not ' + row.c.id);
        if (seen.has(ins.id)) bad.push(ins.id + ' is both ' + seen.get(ins.id) + ' and ' + row.c.id);
        seen.set(ins.id, row.c.id);
        const names = row.c.real && !row.c.personal ? [row.c.tk, row.c.id, 'CIK' + String(row.c.cik).padStart(10, '0'), 'CIK ' + Number(row.c.cik)]
          : row.c.mkt === 'MY' ? [row.c.code, row.c.id, row.c.code + '.KL', 'MY:' + row.c.code] : [row.c.tk, row.c.id];
        for (const n of names) { const got = resolveInstrument(n)?.id; if (got !== ins.id) bad.push(n + ' → ' + got + ', not ' + ins.id); }
      }
      return { bad, instruments: INSTRUMENTS.size, rows: U.length, filers: U.filter(x => x.c.real).length };
    })()`);
    if (r.bad.length) fail(`canonical ids are one per instrument (checklist 1, 2) — ${r.bad.length} problems`, r.bad.slice(0, 8));
    else ok(`canonical ids are one per instrument across both markets (checklist 1, 2) — ${r.instruments} instruments of the MARKET:SYMBOL form, all ${r.rows} company rows on one each, every filer answering to its ticker, -SEC id and CIK, every Bursa row to its code, short name and .KL form`);
  }

  /* Checklist 3 — A DUPLICATE INSTRUMENT IS REFUSED, at each of the three
     places one could enter: the shipped file (the ingest CLI does not
     de-duplicate its arguments, and the loader would drop the second record
     silently), the registry (a stand-in beside its filer must not become a
     second instrument), and the universe (a filer retires its stand-in). The
     registry and universe cases use a stand-in made for the check and put
     everything back. */
  {
    const file = (await (await fetch(`${BASE}/data/us.json`)).json()).results.map(x => x.id);
    const dupInFile = file.filter((v, i) => file.indexOf(v) !== i);
    const r = await evaluate(`(() => {
      const out = {};
      const before = rebuildInstruments();
      const filer = BY_ID.get('AAPL-SEC');
      const standIn = { c: { ...filer.c, id: 'QA-AAPL-STANDIN', real: false, cik: null, personal: false } };
      U.push(standIn);
      out.sizeWith = rebuildInstruments();
      out.kept = INSTRUMENTS.get('US:AAPL')?.companyId;
      U.pop();
      out.sizeAfter = rebuildInstruments();
      out.before = before;
      const fake = { c: { id: 'QAZZ', tk: 'QAZZ', code: 'QAZZ', mkt: 'US', real: false } };
      U.push(fake); BY_ID.set('QAZZ', fake);
      const retired = retireIllustrativeTwin({ tk: 'QAZZ', code: 'QAZZ', mkt: 'US' });
      out.retired = retired?.from || null;
      out.gone = !U.includes(fake) && !BY_ID.has('QAZZ');
      if (!out.gone) { U.splice(U.indexOf(fake), 1); BY_ID.delete('QAZZ'); }
      out.refusedAdd = (() => { const w = State.watchlists[0]; const had = w.ids.includes('MSFT-SEC'); if (!had) wlAdd(w.id, 'MSFT-SEC'); const again = wlAdd(w.id, 'CIK0000789019'); if (!had) wlRemove(w.id, 'MSFT-SEC'); return !!again.duplicate; })();
      return out;
    })()`);
    const p = [];
    if (dupInFile.length) p.push(`data/us.json names ${dupInFile.join(', ')} more than once`);
    if (r.sizeWith !== r.before || r.kept !== 'AAPL-SEC') p.push(`a stand-in beside AAPL-SEC made ${r.sizeWith} instruments (was ${r.before}) and US:AAPL names ${r.kept}`);
    if (r.sizeAfter !== r.before) p.push(`the registry did not return to ${r.before} instruments`);
    if (r.retired !== 'QAZZ' || !r.gone) p.push(`a filer did not retire its stand-in: ${JSON.stringify(r)}`);
    if (!r.refusedAdd) p.push('a watchlist took the same company under its CIK');
    if (p.length) fail('a duplicate instrument is refused (checklist 3)', p);
    else ok(`a duplicate instrument is refused (checklist 3) — the shipped file names each of its ${file.length} filers once, a stand-in beside its filer does not become a second instrument, a filer retires its stand-in, and a watchlist refuses a company under a second name`);
  }

  /* Checklist 18 — EXCHANGE METADATA, AND NOTHING INVENTED FOR IT. Every
     instrument in the two markets carries a market, a currency and a
     country, and an exchange code with where it came from. A filer's venue
     is not in SEC companyfacts, so its code is the market and its source
     says "unknown"; a venue made up here would be the first thing a scanner
     trusted. When the ingest records venues, this check still holds. */
  {
    const r = await evaluate(`(() => {
      const bad = [];
      const mics = new Set(EXCHANGE_MIC.map(x => x[1]));
      for (const ins of INSTRUMENTS.values()) {
        if (!['US', 'MY'].includes(ins.market)) continue;
        if (!ins.currency || !ins.country) bad.push(ins.id + ': no currency or country');
        if (!ins.exchangeCodeSource) bad.push(ins.id + ': no source for its exchange code');
        const listed = mics.has(ins.exchangeCode) && ins.exchangeCodeSource === 'listed';
        const unknown = ins.exchangeCode === ins.market && /^unknown/.test(ins.exchangeCodeSource);
        if (!listed && !unknown) bad.push(ins.id + ': ' + ins.exchangeCode + ' from "' + ins.exchangeCodeSource + '"');
        if (ins.market === 'MY' && ins.exchangeCode !== 'XKLS') bad.push(ins.id + ': a Bursa listing on ' + ins.exchangeCode);
      }
      for (const m of ['US', 'MY']) if (!MARKETS[m]?.tz || !MARKETS[m]?.session || !MARKETS[m]?.currency) bad.push('MARKETS.' + m + ' lacks a time zone, session or currency');
      const filers = [...INSTRUMENTS.values()].filter(i => i.dataStatus === 'FILED' && i.market === 'US');
      return { bad, filers: filers.length, unknown: filers.filter(i => /^unknown/.test(i.exchangeCodeSource)).length };
    })()`);
    if (r.bad.length) fail('every instrument states its exchange metadata and where it came from (checklist 18)', r.bad.slice(0, 8));
    else ok(`every instrument states its exchange metadata and where it came from (checklist 18) — ${r.unknown} of ${r.filers} filers say their venue is unknown rather than name one; SEC companyfacts carries none`);
  }

  /* Checklist 16 — ONE SCANNER IDENTIFIER PER INSTRUMENT. The scanner keys
     its history, its alerts and its dedupe on the bare symbol, so a symbol
     two markets share would be two instruments under one key — "TM" is
     Telekom on Bursa and Toyota in New York. None shares one today; this
     fails the day one arrives, before an alert is recorded against the wrong
     company. And the symbol a company hands the scanner is its instrument's,
     the one that does not change when a filer retires its stand-in. */
  {
    const r = await evaluate(`(() => {
      const bySym = new Map(), clash = [], drift = [];
      for (const ins of INSTRUMENTS.values()) {
        const k = String(ins.symbol).toUpperCase();
        if (bySym.has(k) && bySym.get(k) !== ins.id) clash.push(k + ': ' + bySym.get(k) + ' and ' + ins.id);
        bySym.set(k, ins.id);
      }
      for (const row of U) {
        const sym = instrumentSymbolFor(row.c), ins = instrumentOfCompany(row.c);
        if (sym !== ins.symbol || resolveInstrument(sym)?.id !== ins.id) drift.push(row.c.id + ': ' + sym + ' vs ' + ins.id);
      }
      const ins = resolveInstrument('AAPL');
      const key = scanKey('qa', 1, ins.id, 'daily', '2026-01-02', 'MATCH');
      return { clash, drift, key, legacy: scanLegacyKey('qa', 'AAPL', '2026-01-02'), n: INSTRUMENTS.size };
    })()`);
    const p = [...r.clash.map(x => `two instruments share the scanner key ${x}`), ...r.drift.slice(0, 5)];
    if (r.key !== 'qa|v1|US:AAPL|1D|2026-01-02|MATCH' || r.legacy !== 'qa|AAPL|daily|2026-01-02') p.push(`the alert key is ${r.key} (0.2 form ${r.legacy})`);
    if (p.length) fail('every instrument has one scanner identifier (checklist 16)', p);
    else ok(`every instrument has one scanner identifier (checklist 16) — ${r.n} symbols, none shared across markets, each resolving back to its own instrument, and the alert key built on it`);
  }

  /* Checklist 4 and 9 — THE SOURCE RECORD RECONCILES WITH THE PAGE, FOR
     EVERY FILER. The goldens pin three companies to their filings; this
     holds all of them to the file they were loaded from. data/us.json is
     fetched afresh, each company's Financials tab is built, and every cell
     of every line that maps to a stored column is read back: a present
     figure equals the file's to the precision printed, an absent one prints
     no number, and a figure the loader withholds (the shipped file's
     misassembled debt and share counts) prints no number and is named in
     the company's withheld record. The columns are the company's own
     fiscal years, and both captions state the currency and the unit. */
  {
    const r = await evaluate(`(async () => {
      const src = await (await fetch(dataUrl('us.json'), { cache: 'no-store' })).json();
      const byId = new Map(src.results.map(x => [x.id + '-SEC', x]));
      const LINE = [[/^(Revenue|Total income)\\b/, F.REV], [/^Net (profit|income)\\b/, F.NI], [/^Operating cash flow\\b/, F.OCF],
        [/^Capital expenditure\\b/, F.CAPEX], [/^Shareholders/, F.EQ], [/^(Total debt|Borrowings)\\b/, F.DEBT],
        [/^Cash and equivalents\\b/, F.CASH], [/^Shares in issue\\b/, F.SH], [/^(Dividend per share|Distribution per unit)\\b/, F.DPS]];
      const HELD = { [F.DEBT]: 'debt', [F.SH]: 'sh' };
      const num = (t) => { const m = String(t).replace(/,/g, '').replace(/\\u2212/g, '-').trim().match(/^(-?\\d+)(\\.(\\d+))?$/); return m ? { v: +m[0], dp: (m[3] || '').length } : null; };
      const bad = []; let companies = 0, cells = 0, absent = 0, held = 0;
      for (const row of U.filter(x => x.c.real && !x.c.personal)) {
        const c = row.c, s = byId.get(c.id);
        if (!s) { bad.push(c.id + ': not in data/us.json'); continue; }
        companies++;
        const node = tabFinancials(row), text = node.textContent;
        const span = 'FY' + s.years[0] + '\\u2013FY' + s.years[s.years.length - 1];
        if (!text.includes('Reported ' + c.ccy + ' billions, ' + span)) bad.push(c.id + ': the chart caption does not say ' + c.ccy + ' billions over ' + span);
        /* The unit, whatever words lead into it — the statements card was
           re-captioned ("USD billions unless stated, FY…") when it became
           three statements. */
        if (!text.includes(c.ccy + ' billions unless stated')) bad.push(c.id + ': the statement caption does not state its unit');
        const lines = new Set();
        for (const t of node.querySelectorAll('table')) {
          const col = new Map();
          [...t.querySelectorAll('thead th')].forEach((th, i) => { const m = th.textContent.trim().match(/^FY(\\d{4})$/); if (m) col.set(+m[1], i); });
          if (!col.size) continue;
          if ([...col.keys()].join() !== s.years.join()) bad.push(c.id + ': columns ' + [...col.keys()].join(',') + ' are not its years ' + s.years.join(','));
          for (const tr of t.querySelectorAll('tbody tr')) {
            const td = [...tr.children], label = (td[0]?.textContent || '').trim();
            const j = label.startsWith(ebitLabel(c)) ? F.EBIT : (LINE.find(([re]) => re.test(label)) || [])[1];
            if (j == null) continue;
            lines.add(j);
            for (const [y, i] of col) {
              const k = s.years.indexOf(y), filed = s.fin[k]?.[j], shown = (td[i]?.textContent || '').trim(), p = num(shown);
              const withheld = HELD[j] && c.withheld?.[HELD[j]]?.years?.includes(y);
              cells++;
              if (filed == null || withheld) {
                if (p) bad.push(c.id + ' ' + label + ' FY' + y + ': ' + (withheld ? 'withheld' : 'absent') + ' in the source, "' + shown + '" on the page');
                else if (withheld) held++; else absent++;
                continue;
              }
              if (!p) { bad.push(c.id + ' ' + label + ' FY' + y + ': the file holds ' + filed + ', the page "' + shown + '"'); continue; }
              const want = j === F.CAPEX ? Math.abs(filed) : filed, got = j === F.CAPEX ? Math.abs(p.v) : p.v;
              if (Math.abs(got - want) > 0.5 * Math.pow(10, -p.dp) + 1e-9) bad.push(c.id + ' ' + label + ' FY' + y + ': the file holds ' + filed + ', the page ' + shown);
            }
          }
        }
        const need = c.type === 'bank' ? [F.REV, F.EBIT, F.NI, F.EQ, F.DEBT, F.SH, F.DPS] : Object.values(F);
        const missing = need.filter(j => !lines.has(j));
        if (missing.length) bad.push(c.id + ': no row for stored column(s) ' + missing.join(','));
      }
      return { bad: bad.slice(0, 10), nBad: bad.length, companies, cells, absent, held, file: src.results.length };
    })()`);
    if (r.nBad || r.companies !== r.file) fail(`every filed company’s statement table reconciles with data/us.json (checklist 4, 9) — ${r.nBad} disagreements over ${r.companies} of ${r.file} filers`, r.bad);
    else ok(`every filed company’s statement table reconciles with data/us.json (checklist 4, 9) — ${r.cells} cells across all ${r.companies} filers: every figure equal to the file at the precision printed, ${r.absent} absent and ${r.held} withheld cells printing no number, columns on each company’s own years, and USD billions stated on both captions`);
  }

  /* Checklist 10 — RATIOS AGAINST FIGURES RECOMPUTED BY HAND. The inputs
     below are typed from the filings, not read from data/us.json, so a
     re-ingest that moved a line would fail here as well as in the goldens.
     Apple's 10-K for the year ended 28 September 2024: net sales 391,035;
     operating income 123,216; net income 93,736; cash generated by
     operating activities 118,254; payments for property, plant and
     equipment 9,447; total shareholders' equity 56,950, and 62,146 a year
     earlier. Microsoft's 10-K for the year ended 30 June 2025: revenue
     281,724; operating income 128,528; net income 101,832; net cash from
     operations 136,162; additions to property and equipment 64,551; total
     stockholders' equity 343,479, and 268,477 a year earlier. All $m. The
     engine's ratio for that year is computed on the statements cut at that
     year, as the source drawer's prior-period figure is, and compared to
     0.01 of a percentage point. Bursa ratios have no independent reference
     to meet: the Bursa figures are synthetic (docs/phase2-qa.md). */
  {
    const REF = [
      { id: 'AAPL-SEC', fy: 2024, rev: 391035, ebit: 123216, ni: 93736, ocf: 118254, capex: 9447, eq: 56950, eqPrior: 62146 },
      { id: 'MSFT-SEC', fy: 2025, rev: 281724, ebit: 128528, ni: 101832, ocf: 136162, capex: 64551, eq: 343479, eqPrior: 268477 },
    ];
    const p = [], shown = [];
    for (const g of REF) {
      /* The definitions, as the dictionary publishes them. */
      const want = {
        om: g.ebit / g.rev * 100,                          /* operating margin */
        nm: g.ni / g.rev * 100,                            /* net margin */
        fcfm: (g.ocf - g.capex) / g.rev * 100,             /* free cash flow margin */
        roe: g.ni / ((g.eq + g.eqPrior) / 2) * 100,        /* return on average equity */
        cashconv: g.ocf / g.ni * 100,                      /* cash conversion */
      };
      const got = await evaluate(`(() => {
        const c = BY_ID.get(${JSON.stringify(g.id)}).c, k = c.years.indexOf(${g.fy});
        if (k < 0) return null;
        const m = derive({ ...c, fin: c.fin.slice(0, k + 1), years: c.years.slice(0, k + 1) }).m;
        return { om: m.om, nm: m.nm, fcfm: m.fcfm, roe: m.roe, cashconv: m.cashconv };
      })()`);
      if (!got) { p.push(`${g.id} has no FY${g.fy}`); continue; }
      for (const [k, v] of Object.entries(want)) {
        if (typeof got[k] !== 'number' || Math.abs(got[k] - v) > 0.01) p.push(`${g.id} FY${g.fy} ${k}: engine ${got[k]}, by hand ${v.toFixed(4)}`);
      }
      shown.push(`${g.id.replace('-SEC', '')} FY${g.fy} net margin ${want.nm.toFixed(2)}%, ROE ${want.roe.toFixed(2)}%`);
    }
    if (p.length) fail('ratios match figures recomputed by hand from the filings (checklist 10)', p);
    else ok(`ratios match figures recomputed by hand from the filings (checklist 10) — operating, net and FCF margin, return on average equity and cash conversion for ${shown.join('; ')}`);
  }

  /* Checklist 11 — SOURCE LINKS, WELL-FORMED FOR EVERY FILER. Each filer's
     Filings tab links its own EDGAR index and its own companyfacts record:
     https, an SEC host, and the filer's own ten-digit CIK — never another
     company's. Whether SEC answers is a network question the CI runner
     cannot ask (SEC refuses a request without a contact address), so it is
     asked only with --links and SEC_UA set; see docs/phase2-qa.md. */
  {
    const r = await evaluate(`(() => {
      const bad = [], sample = [];
      let n = 0, links = 0;
      for (const row of U.filter(x => x.c.real && x.c.cik)) {
        const cik10 = String(row.c.cik).padStart(10, '0');
        const hrefs = [...tabFilings(row).querySelectorAll('a[href*="sec.gov"]')].map(a => a.href);
        n++; links += hrefs.length;
        const kinds = { index: 0, facts: 0 };
        for (const h of hrefs) {
          let u; try { u = new URL(h); } catch { bad.push(row.c.id + ': not a URL ' + h); continue; }
          if (u.protocol !== 'https:' || !['www.sec.gov', 'data.sec.gov'].includes(u.host)) { bad.push(row.c.id + ': ' + h); continue; }
          if (u.pathname === '/cgi-bin/browse-edgar') { kinds.index++; if (u.searchParams.get('CIK') !== cik10 || u.searchParams.get('action') !== 'getcompany') bad.push(row.c.id + ': index link names CIK ' + u.searchParams.get('CIK')); }
          else if (/^\\/api\\/xbrl\\/companyfacts\\/CIK\\d{10}\\.json$/.test(u.pathname)) { kinds.facts++; if (u.pathname !== '/api/xbrl/companyfacts/CIK' + cik10 + '.json') bad.push(row.c.id + ': companyfacts link is ' + u.pathname); }
          else bad.push(row.c.id + ': an SEC link of no known form ' + h);
        }
        if (!kinds.index || !kinds.facts) bad.push(row.c.id + ': ' + kinds.index + ' index and ' + kinds.facts + ' companyfacts links');
        if (sample.length < 5 && n % 24 === 1) sample.push(hrefs.find(h => /companyfacts/.test(h)));
      }
      return { bad, n, links, sample };
    })()`);
    if (r.bad.length) fail('source links are well-formed for every filer (checklist 11)', r.bad.slice(0, 8));
    else ok(`source links are well-formed for every filer (checklist 11) — ${r.links} links across ${r.n} filers, each https on an SEC host and naming the filer's own CIK`);
    if (args.includes('--links')) {
      if (!process.env.SEC_UA) console.log('skip  --links: SEC refuses a request without a contact address in the User-Agent; set SEC_UA="Name email@example.com" to follow the links');
      else {
        let reached = 0; const missing = [];
        for (const u of r.sample) {
          try { const res = await fetch(u, { method: 'HEAD', headers: { 'User-Agent': process.env.SEC_UA }, signal: AbortSignal.timeout(5000) });
            if (res.status === 404) missing.push(u); else if (res.ok) reached++; }
          catch { /* offline or throttled: not a broken link */ }
        }
        if (missing.length) fail('an SEC source link answers 404', missing);
        else ok(`--links: ${reached} of ${r.sample.length} sampled companyfacts links answered, none 404`);
      }
    }
  }

  /* Checklist 17 — THE WATCHLIST HANDOFF KEEPS ITS CONTRACT. Phase 3's
     scanner and any later server take a watchlist in the shape
     watchlistsExport writes, so the shape is pinned here field by field
     (docs/phase2-qa.md, "watchlist contract v2"): the document's kind,
     schema, date and owner; each list's id, name and dates; each member's
     item id, list id, company id, canonical instrument id, symbol, market,
     coverage and date added. Then it is used as a contract: every
     instrument id resolves to the symbol it states, the symbols are what the
     scanner's watchlist universe reads, and the export imports back into
     the same list. */
  {
    const r = await evaluate(`(() => {
      const made = wlCreate('QA handoff');
      if (!made.ok) return { err: made.why };
      const w = made.watchlist;
      ['MSFT-SEC', '1155'].forEach(t => wlAdd(w.id, t));
      const doc = watchlistsExport(), list = doc.watchlists.find(x => x.id === w.id);
      const bad = [];
      const is = (v, t) => t === 'string?' ? v === null || typeof v === 'string' : typeof v === t;
      const docShape = { kind: 'string', schema: 'number', exportedAt: 'string', owner: 'string' };
      for (const [k, t] of Object.entries(docShape)) if (!is(doc[k], t)) bad.push('document.' + k + ' is ' + typeof doc[k]);
      if (doc.kind !== 'quantum-tradeworks-watchlists' || doc.schema !== WATCHLIST_SCHEMA || WATCHLIST_SCHEMA !== 2) bad.push('kind/schema ' + doc.kind + ' v' + doc.schema);
      const listShape = { id: 'string', name: 'string', createdAt: 'string?', updatedAt: 'string?' };
      for (const l of doc.watchlists) for (const [k, t] of Object.entries(listShape)) if (!is(l[k], t)) bad.push('list ' + l.id + '.' + k + ' is ' + typeof l[k]);
      const itemShape = { id: 'string', watchlistId: 'string', companyId: 'string', instrumentId: 'string', symbol: 'string', market: 'string', coverage: 'string', addedAt: 'string?', resolves: 'boolean' };
      for (const it of list.items) {
        for (const [k, t] of Object.entries(itemShape)) if (!is(it[k], t)) bad.push('item ' + it.id + '.' + k + ' is ' + typeof it[k]);
        if (it.id !== w.id + ':' + it.companyId || it.watchlistId !== w.id) bad.push('item id ' + it.id);
        const ins = resolveInstrument(it.instrumentId);
        if (!ins || ins.symbol !== it.symbol || ins.market !== it.market) bad.push(it.instrumentId + ' does not resolve to ' + it.market + ' ' + it.symbol);
      }
      const syms = watchlistSymbols(w.id).symbols;
      const history = { series: Object.fromEntries(syms.map(s => [s, { '2026-01-02': 1 }])) };
      const scanned = scanUniverse({ universe: { kind: 'watchlist', symbols: syms } }, history, []);
      const ids = w.ids.slice();
      wlDelete(w.id);
      const imp = watchlistsImport({ watchlists: [list] });
      const back = State.watchlists.find(x => x.name === 'QA handoff');
      const out = { bad, syms, scanned, items: list.items.length, imported: imp.ok && !!back && JSON.stringify(back.ids) === JSON.stringify(ids) };
      if (back) wlDelete(back.id);
      return out;
    })()`);
    const p = r.err ? [r.err] : [...r.bad];
    if (!r.err) {
      if (r.items !== 2 || r.syms.join() !== 'MSFT,1155') p.push(`symbols handed over: ${r.syms.join(',')}`);
      /* As a set: the scanner walks the history's keys, and an object puts
         the numeric key 1155 ahead of MSFT whatever order it was written in. */
      if ([...r.scanned].sort().join() !== [...r.syms].sort().join()) p.push(`the scanner's watchlist universe read ${r.scanned.join(',')}`);
      if (!r.imported) p.push('the export did not import back into the same list');
    }
    if (p.length) fail('the watchlist handoff keeps its contract (checklist 17)', p);
    else ok(`the watchlist handoff keeps its contract (checklist 17) — schema 2, every field of the document, list and member typed, each instrument id resolving to its symbol, ${r.syms.join(' and ')} read by the scanner's watchlist universe, and the export importing back into the same list`);
  }

  /* Checklist 12 and 14 — A WATCHLIST AND A SAVED MODEL SURVIVE A RELOAD.
     Everything a reader makes lives in this browser's storage, so the test
     that it persists is a reload, not a read of State: a list and a saved
     valuation run with two assumptions moved are written, the page is
     reloaded and boots from nothing, and both are read back — the list with
     its members, dates and page, the run with every input as saved, the
     model version it was saved under, and a replay that gives its saved
     figures exactly. (Unsaved Studio edits do not survive a reload; the
     register's Valuation models row says so, and this does not test it.) */
  let qaRunId = null;
  {
    const before = await evaluate(`(() => {
      const made = wlCreate('QA persist');
      if (!made.ok) return { err: made.why };
      const w = made.watchlist;
      wlAdd(w.id, 'MSFT-SEC'); wlAdd(w.id, '1155');
      const r = ['AAPL-SEC', 'MSFT-SEC', 'JNJ-SEC', 'KO-SEC'].map(id => BY_ID.get(id)).find(x => x && x.inputs?.model === 'dcf' && !x.val.err);
      if (!r) return { err: 'no filer with a computable DCF among AAPL, MSFT, JNJ, KO' };
      const inputs = { ...r.inputs, wacc: +(r.inputs.wacc + 0.7).toFixed(2), g1: +(r.inputs.g1 - 1).toFixed(2) };
      saveValuationRun(r, inputs);
      const run = store.read('runs', [])[0];
      return { wl: { id: w.id, ids: w.ids.slice(), createdAt: w.createdAt, added: { ...w.added } }, run, co: r.c.id };
    })()`);
    if (before.err) fail('a watchlist survives a reload (checklist 12)', before.err);
    else {
      qaRunId = before.run?.runId || null;
      await send('Page.reload', {}, sessionId);
      const booted = await waitFiled();
      if (!booted) throw new Error('the filed set did not load again after the reload');
      const r = await evaluate(`(() => {
        const w = State.watchlists.find(x => x.id === ${JSON.stringify(before.wl.id)});
        const out = { found: !!w };
        if (w) {
          out.ids = w.ids; out.createdAt = w.createdAt; out.added = w.added; out.name = w.name;
          State.wlIdx = State.watchlists.indexOf(w);
          navigate('/my/watchlists');
          /* The name is the value of its rename field, not text; the members
             are the rows of the card that field sits in. */
          const card = [...document.querySelectorAll('main input')].find(i => i.value === 'QA persist')?.closest('.card');
          out.onPage = !!card && card.textContent.includes('US:MSFT') && card.textContent.includes('MY:1155');
        }
        const run = (store.read('runs', []) || []).find(x => x.runId === ${JSON.stringify(before.run.runId)});
        out.run = run || null;
        if (run) {
          const row = BY_ID.get(run.id);
          const replay = valuationRun(row.c, row.d, run.inputs).vals;
          const same = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
          out.replayed = !!replay && ['bear', 'base', 'bull'].every(k => same(replay[k], run.vals?.[k]));
          out.model = run.model === MODEL_VERSION;
          out.exported = JSON.stringify(exportEverything().data.runs?.find(x => x.runId === run.runId)?.inputs) === JSON.stringify(run.inputs);
        }
        return out;
      })()`);
      const p = [];
      if (!r.found) p.push('the list is gone after the reload');
      else {
        if (JSON.stringify(r.ids) !== JSON.stringify(before.wl.ids)) p.push(`members ${r.ids} vs ${before.wl.ids}`);
        if (r.createdAt !== before.wl.createdAt || JSON.stringify(r.added) !== JSON.stringify(before.wl.added)) p.push('the dates changed across the reload');
        if (!r.onPage) p.push('/my/watchlists does not show the list with its members\' instrument ids');
      }
      if (p.length) fail('a watchlist survives a reload (checklist 12)', p);
      else ok(`a watchlist survives a reload (checklist 12) — its ${r.ids.length} members, its creation date and each member's date added read back from storage, and /my/watchlists shows it`);
      const q = [];
      if (!r.run) q.push('the saved run is gone after the reload');
      else {
        if (JSON.stringify(r.run.inputs) !== JSON.stringify(before.run.inputs)) q.push(`inputs ${JSON.stringify(r.run.inputs)} vs ${JSON.stringify(before.run.inputs)}`);
        if (!r.model) q.push(`saved under ${r.run.model}, not the running model`);
        if (!r.replayed) q.push('replaying the stored inputs does not give the saved figures');
        if (!r.exported) q.push('Export everything does not carry the run\'s inputs');
      }
      if (q.length) fail('a saved valuation run keeps its assumptions across a reload (checklist 14)', q);
      else ok(`a saved valuation run keeps its assumptions across a reload (checklist 14) — ${before.co}'s ${Object.keys(r.run.inputs).length} inputs, two of them moved, read back as saved, stamped with the running model, replaying to its saved bear/base/bull exactly, and carried by the export`);
    }
  }

  /* Checklist 15 — EXPORTS REPRODUCE WHAT THE PAGE SHOWS. The screener's
     CSV is caught as the page builds it (no file is written) and read
     against the table on screen: the same companies in the same order, and
     every score, difference, metric and coverage cell equal to the table's
     to the precision the table prints — an empty cell where the table says
     why a figure is absent. Then the full export: written, the stored keys
     cleared, imported, and exported again, byte for byte. */
  {
    const r = await evaluate(`(async () => {
      navigate('/discover/screener');
      await new Promise(res => setTimeout(res, 400));
      let blob = null;
      const oc = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (b) => { blob = b; return 'blob:qa'; };
      HTMLAnchorElement.prototype.click = function () { if (!this.download) click.call(this); };
      try { exportScreen(); } finally { URL.createObjectURL = oc; HTMLAnchorElement.prototype.click = click; }
      if (!blob) return { err: 'exportScreen wrote nothing' };
      const text = await blob.text();
      const parse = (line) => { const out = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) { const ch = line[i];
          if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
          else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
        out.push(cur); return out; };
      const lines = text.split('\\n'), head = parse(lines[0]);
      const rows = []; for (let i = 1; i < lines.length && lines[i]; i++) rows.push(parse(lines[i]));
      const table = [...document.querySelectorAll('main table.dt')].find(t => t.querySelector('thead th')?.textContent.startsWith('Company'));
      if (!table) return { err: 'no results table' };
      const trs = [...table.querySelectorAll('tbody tr')];
      const sc = State.screen;
      const shownNum = (td) => {
        if (!td || td.querySelector('.cell-absent')) return null;
        const t = td.textContent.replace(/,/g, '').replace(/\\u2212/g, '-');
        const m = t.match(/([-+]?\\d+)(\\.(\\d+))?\\s*([TBM])?/);
        if (!m) return null;
        const scale = { T: 1000, B: 1, M: 0.001 }[m[4]] ?? 1;
        return { v: parseFloat(m[1] + (m[2] || '')) * scale, tol: 0.5 * Math.pow(10, -(m[3] || '').length) * scale + 1e-6 };
      };
      /* Table column → CSV column. The table leads with the company, the two
         scores and the model difference, then the chosen metrics, then risk
         and coverage; the CSV leads with identity and price. */
      const pairs = [[1, 'quality_score'], [2, 'value_score'], [3, 'mos_vs_base_pct'],
        ...sc.cols.map((k, i) => [4 + i, head[9 + i]]), [4 + sc.cols.length + 1, 'coverage_pct']];
      const bad = [];
      if (rows.length !== trs.length) bad.push('CSV ' + rows.length + ' rows, table ' + trs.length);
      let cells = 0;
      trs.forEach((tr, i) => {
        const tk = tr.querySelector('.tk')?.firstChild?.textContent.trim();
        const row = rows[i];
        if (!row || row[0] !== tk) { if (bad.length < 12) bad.push('row ' + i + ': CSV ' + (row && row[0]) + ', table ' + tk); return; }
        for (const [ti, name] of pairs) {
          const ci = head.indexOf(name), csv = row[ci], shown = shownNum(tr.children[ti]);
          cells++;
          if (csv === '' && !shown) continue;
          if (csv === '' || !shown || Math.abs(parseFloat(csv) - shown.v) > shown.tol) { if (bad.length < 12) bad.push(tk + ' ' + name + ': CSV "' + csv + '", table "' + (tr.children[ti]?.textContent.trim() || '') + '"'); }
        }
      });
      const doc = exportEverything(), json = JSON.stringify(doc);
      PORTABLE_KEYS.forEach(({ k }) => { try { localStorage.removeItem('vl.' + k); } catch {} });
      const imp = importEverything(JSON.parse(json));
      if (imp.ok) imp.apply();
      const again = exportEverything();
      return { bad, rows: rows.length, cells, cols: sc.cols.length, keys: Object.keys(doc.data).length,
               roundTrip: imp.ok && JSON.stringify(again.data) === JSON.stringify(doc.data), hasRuns: Array.isArray(doc.data.runs) && doc.data.runs.length > 0,
               footer: /# Quantum Tradeworks screen export/.test(text) && /# Definition \\(JSON\\)/.test(text) };
    })()`);
    const p = r.err ? [r.err] : [...r.bad];
    if (!r.err) {
      if (!r.footer) p.push('the CSV lost its model stamp or its definition');
      if (!r.roundTrip) p.push('Export everything → clear → import → export does not reproduce the file');
      if (!r.hasRuns) p.push('the full export carries no saved valuation run');
    }
    if (p.length) fail('exports reproduce the figures on the page (checklist 15)', p);
    else ok(`exports reproduce the figures on the page (checklist 15) — the screener CSV matches the table on all ${r.rows} rows and ${r.cells} score, metric and coverage cells in its order, and Export everything round-trips ${r.keys} kinds of saved work byte for byte`);
    /* The list and the run were made for the checks above; nothing after
       them should find either. */
    await evaluate(`(() => { const w = State.watchlists.find(x => x.name === 'QA persist'); if (w) wlDelete(w.id);
      store.write('runs', (store.read('runs', []) || []).filter(x => x.runId !== ${JSON.stringify(qaRunId)})); return true; })()`);
  }

  /* KEYBOARD. '/' from anywhere outside a field opens the search with the
     cursor in the box; typing and ArrowDown walk into the results; Enter on
     a result opens that company; Escape closes the box. And the first Tab
     on a page lands on the skip link. Real key events through the browser,
     not handlers called by name, so a listener on the wrong element fails. */
  {
    const key = async (k, code, vk, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, sessionId);
    };
    /* Chrome keeps the Tab starting point where focus was blurred, and
       navigate() puts focus on main — so a blur alone would start the walk
       mid-page. A throwaway stop at the top of the body moves the starting
       point there, as a fresh page load would. */
    await evaluate(`navigate('/research'); window.scrollTo(0, 0);
      const s = document.createElement('span'); s.tabIndex = -1; document.body.prepend(s); s.focus(); s.blur(); s.remove(); true`);
    await sleep(300);
    await key('Tab', 'Tab', 9);
    const tab1 = await evaluate(`document.activeElement?.className || document.activeElement?.tagName`);
    await evaluate(`document.activeElement?.blur(); true`);
    await key('/', 'Slash', 191, '/');
    await sleep(150);
    const opened = await evaluate(`({ focused: document.activeElement === searchInput, value: searchInput.value })`);
    await send('Input.insertText', { text: 'maybank' }, sessionId);
    await sleep(350);
    await key('ArrowDown', 'ArrowDown', 40);
    const onResult = await evaluate(`searchResults.contains(document.activeElement) && /MAYBANK|Malayan/.test(document.activeElement.textContent)`);
    await key('Enter', 'Enter', 13, '\r');
    await sleep(400);
    const landed = await evaluate(`({ view: State.view, ticker: State.ticker })`);
    await key('/', 'Slash', 191, '/');
    await sleep(150);
    await key('Escape', 'Escape', 27);
    await sleep(150);
    const closed = await evaluate(`!searchOpen && searchModal.dataset.open === '0' && document.activeElement !== searchInput`);
    const p = [];
    if (!/skip-link/.test(tab1)) p.push(`the first Tab lands on ${tab1}, not the skip link`);
    if (!opened.focused || opened.value.includes('/')) p.push(`'/' did not put the cursor in an empty search box: ${JSON.stringify(opened)}`);
    if (!onResult) p.push('ArrowDown did not move to the Maybank result');
    if (landed.view !== 'research' || landed.ticker !== 'MAYBANK') p.push(`Enter on the result opened ${landed.view} ${landed.ticker}`);
    if (!closed) p.push('Escape did not close the search');
    if (p.length) fail('the keyboard reaches the search, its results and the page', p);
    else ok('the keyboard reaches the search, its results and the page — the first Tab is the skip link, / opens the box, ArrowDown and Enter open Maybank, Escape closes it');
  }

  /* THE RELEASE RULE ON THE PAGE. A P1 surface the register flags says so
     where it is read — the compare page under its heading, the valuation tab
     above its panel and no other tab — in the register's own words; and
     /status shows the priorities, the flagged group as not operational, and
     the release card. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const out = {};
      const flagOf = (name) => CAPABILITY_REGISTER.find(c => c.name === name)?.flag || '';
      navigate('/compare'); await w(200);
      const cn = document.querySelector('main .flag-notice');
      out.compare = !!cn && cn.textContent.includes(flagOf('Company comparison')) && cn.previousElementSibling?.classList.contains('page-hd');
      openResearch('AAPL-SEC', 'valuation'); await w(300);
      const vn = document.querySelector('main .flag-notice');
      out.valuation = !!vn && vn.textContent.includes(flagOf('Valuation models')) && vn.nextElementSibling === vn.parentElement.lastElementChild;
      openResearch('AAPL-SEC', 'snapshot'); await w(300);
      out.snapshotClean = !document.querySelector('main .flag-notice');
      navigate('/status'); await w(200);
      const main = document.querySelector('main')?.textContent || '';
      out.status = { flaggedGroup: /Feature-flagged — \\d+ · not operational/.test(main), release: main.includes('Release condition'),
        p0: [...document.querySelectorAll('main .chip')].filter(c => c.textContent === 'P0').length,
        p1: [...document.querySelectorAll('main .chip')].filter(c => c.textContent === 'P1').length,
        rowsP0: CAPABILITY_REGISTER.filter(c => c.priority === 'P0').length, rowsP1: CAPABILITY_REGISTER.filter(c => c.priority === 'P1').length };
      return out;
    })()`);
    const p = [];
    if (!r.compare) p.push('/compare carries no flag notice under its heading in the register\'s words');
    if (!r.valuation) p.push('the valuation tab carries no flag notice above its panel');
    if (!r.snapshotClean) p.push('the snapshot tab carries the valuation flag');
    if (!r.status.flaggedGroup || !r.status.release) p.push(`/status: flagged group ${r.status.flaggedGroup}, release card ${r.status.release}`);
    if (r.status.p0 !== r.status.rowsP0 || r.status.p1 !== r.status.rowsP1) p.push(`/status shows ${r.status.p0} P0 and ${r.status.p1} P1 chips for ${r.status.rowsP0} and ${r.status.rowsP1} rows`);
    if (p.length) fail('a feature-flagged surface says so where it is read', p);
    else ok(`a feature-flagged surface says so where it is read — /compare and the valuation tab carry the register's notice and the snapshot tab does not; /status shows ${r.status.rowsP0} P0 and ${r.status.rowsP1} P1 rows and the flagged group as not operational`);
  }

  /* LOADING AND ERROR STATES. The filings arrive after first paint, so the
     universe pages wait on a skeleton rather than paint the sample and
     correct themselves; and if the file never arrives the sample is painted,
     labelled as the only thing there is, rather than the skeleton forever.
     The request is held, then failed, by the browser's own interception —
     the page's code runs unmodified. The cache is off so a cached copy
     cannot answer for the network. */
  {
    const events = [];
    const listen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Fetch.requestPaused' || m.method === 'Runtime.exceptionThrown') events.push(m); };
    ws.addEventListener('message', listen);
    await send('Network.enable', {}, sessionId);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/us.json*', requestStage: 'Request' }] }, sessionId);
    const paused = async () => { for (let i = 0; i < 40; i++) { const m = events.find(x => x.method === 'Fetch.requestPaused' && !x.seen); if (m) { m.seen = true; return m; } await sleep(250); } return null; };
    try {
      /* Held: the skeleton, not the sample. */
      await send('Page.navigate', { url: `${BASE}/discover/screener` }, sessionId);
      const held = await paused();
      await sleep(800);
      const during = held ? await evaluate(`({ pending: realPending, skeleton: /Reading the audited statements/.test(document.querySelector('main')?.textContent || ''), rows: document.querySelectorAll('main table.dt tbody tr').length })`) : null;
      if (held) await send('Fetch.continueRequest', { requestId: held.params.requestId }, sessionId);
      const arrived = held && await waitFiled();
      const after = arrived ? await evaluate(`({ skeleton: /Reading the audited statements/.test(document.querySelector('main')?.textContent || ''), rows: document.querySelectorAll('main table.dt tbody tr').length })`) : null;
      const p = [];
      if (!held) p.push('the page never requested data/us.json');
      else if (!during.pending || !during.skeleton || during.rows) p.push(`while the file was held: ${JSON.stringify(during)}`);
      if (held && (!after || after.skeleton || !after.rows)) p.push(`after it arrived: ${JSON.stringify(after)}`);
      if (p.length) fail('the skeleton holds the page while the filings load', p);
      else ok(`the skeleton holds the page while the filings load — no sample row is painted while the file is in flight, and the screener's ${after.rows} rows replace it when it lands`);

      /* Failed: the sample, and the banner saying so. */
      events.length = 0;
      await send('Page.navigate', { url: `${BASE}/discover/screener` }, sessionId);
      const req = await paused();
      if (req) await send('Fetch.fulfillRequest', { requestId: req.params.requestId, responseCode: 404,
        responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('not here').toString('base64') }, sessionId);
      let settled = false;
      for (let i = 0; i < 40 && !settled; i++) { await sleep(250); try { settled = await evaluate(`typeof realPending !== 'undefined' && !realPending && !!realStatus`); } catch { /* booting */ } }
      const st = settled ? await evaluate(`({ ok: realStatus.ok, error: realStatus.error, filed: U.filter(r => r.c.real).length, n: U.length,
        banner: document.getElementById('disclosureText')?.textContent || '', rows: document.querySelectorAll('main table.dt tbody tr').length,
        skeleton: /Reading the audited statements/.test(document.querySelector('main')?.textContent || '') })`) : null;
      const thrown = events.filter(m => m.method === 'Runtime.exceptionThrown').map(m => m.params.exceptionDetails?.exception?.description?.split('\n')[0]);
      const q = [];
      if (!req) q.push('the page never requested data/us.json');
      else if (!st) q.push('the page never settled after the file failed');
      else {
        if (st.ok !== false || !st.error) q.push(`realStatus ${JSON.stringify({ ok: st.ok, error: st.error })}`);
        if (st.filed) q.push(`${st.filed} filed companies after a failed load`);
        if (!/filings did not load/.test(st.banner)) q.push(`the banner reads "${st.banner.slice(0, 90)}"`);
        if (st.skeleton || !st.rows) q.push(`the screener shows ${st.rows} rows${st.skeleton ? ' and the skeleton' : ''}`);
      }
      if (thrown.length) q.push(`exceptions: ${thrown.join('; ')}`);
      if (q.length) fail('a failed load paints the sample, labelled', q);
      else ok(`a failed load paints the sample, labelled — realStatus carries "${st.error}", the banner says the filings did not load, ${st.rows} illustrative rows are painted instead of a skeleton, and nothing throws`);
    } finally {
      await send('Fetch.disable', {}, sessionId);
      await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
      ws.removeEventListener('message', listen);
    }
  }

  /* NO STICKY HEADER COVERS ITS OWN FIRST ROW. A page-sticky table inside a
     sideways-scrolling .tablewrap measured its top-bar offset from the wrap,
     so the Compare header dropped over the Price row. Every table on the
     pages below: the header ends where the body starts, not below it. */
  {
    const bad = [];
    for (const path of ['/compare?companies=AAPL-SEC,MSFT-SEC', '/discover/screener', '/company/MSFT-SEC?tab=financials', '/my/watchlists']) {
      await evaluate(`navigate(${JSON.stringify(path)})`);
      await sleep(700);
      const r = await evaluate(`(() => [...document.querySelectorAll('main table.dt')].filter(t => t.tHead && t.tBodies[0]?.rows.length && t.offsetParent).map(t => {
        const h = t.tHead.getBoundingClientRect(), b = t.tBodies[0].rows[0].getBoundingClientRect();
        return { cls: t.className, over: Math.round(h.bottom - b.top) };
      }).filter(x => x.over > 1))()`);
      r.forEach(x => bad.push(`${path}: table.${x.cls.replace(/ /g, '.')} header covers ${x.over}px of its first row`));
    }
    if (bad.length) fail('no table header covers its own first row', bad);
    else ok('no table header covers its own first row — Compare, the screener, the statements and the watchlists');
  }

  /* ===================================================================== */
  /* PHASE 3 ROUND 1 — the market engine (src/js/24-market-engine.js)      */
  /* ===================================================================== */
  /* ONE ENGINE, TWO HOSTS. The page's engine and the one scanner/scan.mjs
     slices out of index.html give byte-identical runs on the fixture; the
     instrument registry's time zones are the engine's; the trend context
     labels a closing high as one. */
  {
    const { loadEngine } = await import('./scanner/scan.mjs');
    const NE = await loadEngine();
    const fx = NE.scanFixture();
    const nodeRun = JSON.stringify(NE.scanRun([fx.setup, fx.setupV2], fx.history, { now: fx.now, runId: 'det', origin: 'det' }));
    const nodeHist = JSON.stringify(NE.scanHistorical(fx.setupV2, fx.history));
    const r = await evaluate(`(() => {
      const fx = scanFixture();
      const s = {}; const d0 = Date.UTC(2024, 0, 1);
      for (let i = 0; i < 300; i++) s[new Date(d0 + i * 864e5).toISOString().slice(0, 10)] = 100 + Math.sin(i / 9) * 5 + i * 0.05;
      const t = trendContext(s);
      return { run: JSON.stringify(scanRun([fx.setup, fx.setupV2], fx.history, { now: fx.now, runId: 'det', origin: 'det' })),
               hist: JSON.stringify(scanHistorical(fx.setupV2, fx.history)), selfTest: scanSelfTest().ok, version: SCAN_VERSION,
               tz: { us: MARKETS.US.tz === SCAN_MARKETS.US.tz, my: MARKETS.MY.tz === SCAN_MARKETS.MY.tz },
               hiLabel: t.labels.hi52, sma50: t.values.sma50, sma50e: scanIndicator({ indicator: 'sma', n: 50 }, scanSeriesBars(Object.keys(s).sort().map(d => s[d]))).value };
    })()`);
    const p = [];
    if (r.run !== nodeRun) p.push('scanRun on the fixture differs between the page and Node');
    if (r.hist !== nodeHist) p.push('scanHistorical on the fixture differs between the page and Node');
    if (!r.selfTest || r.version !== NE.SCAN_VERSION) p.push(`self-test ${r.selfTest}, version ${r.version} vs ${NE.SCAN_VERSION}`);
    if (!r.tz.us || !r.tz.my) p.push(`MARKETS time zones disagree with SCAN_MARKETS: ${JSON.stringify(r.tz)}`);
    if (r.hiLabel !== '52-week closing high' || r.sma50 !== r.sma50e) p.push(`trend: label "${r.hiLabel}", sma50 ${r.sma50} vs the engine's ${r.sma50e}`);
    if (p.length) fail('the page runs the same market engine as the worker', p);
    else ok(`the page runs the same market engine as the worker — byte-identical scanRun (${r.run.length} chars) and scanHistorical on the fixture, engine ${r.version}, MARKETS' zones read from SCAN_MARKETS, the trend context's averages from the engine and its 52-week high labelled a closing high`);
  }
  /* THE CURRENT SCANNER PAGE ON THE NEW ENGINE. With the fixture's files
     injected: the setups list reads V2 (version chip, tree lines), "Evaluate
     now" runs and — the fixture being months old against today's clock —
     reports it untested as stale rather than matched; the builder's Test
     runs its draft. Nothing throws. */
  {
    const events = [];
    const listen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') events.push(m); };
    ws.addEventListener('message', listen);
    try {
      const r = await evaluate(`(async () => {
        const keep = { h: scanHistoryFile, s: scanSetupsFile, a: scanAlertsFile, d: scanDraft, st: localStorage.getItem('vl.scanSetups') };
        const fx = scanFixture();
        scanHistoryFile = fx.history; scanSetupsFile = { setups: [fx.setup, fx.setupV2] }; scanAlertsFile = { alerts: [], lastRun: null };
        localStorage.removeItem('vl.scanSetups');
        scanAdoptFromFile(fx.setup.id); scanAdoptFromFile(fx.setupV2.id);
        scanDraft = { ...scanBlankDraft(), id: 'qa-draft', name: 'QA draft', universe: { kind: 'symbols', symbols: ['MATCH'] } };
        navigate('/app/scanner/setups');
        await new Promise(r => setTimeout(r, 300));
        let main = document.querySelector('main');
        const out = { h1: main.querySelector('h1')?.textContent || '', chips: [...main.querySelectorAll('.chip')].map(c => c.textContent).filter(t => /^v\\d+$|condition|new matches|every match/.test(t)),
                      tree: [...main.querySelectorAll('.rulelist li')].map(l => l.textContent).filter(t => /any of:|crosses above EMA50|between 50 and 70/.test(t)).length };
        const ev = [...main.querySelectorAll('button')].find(b => /Evaluate the file/.test(b.textContent));
        ev?.click();
        await new Promise(r => setTimeout(r, 200));
        out.summary = [...main.querySelectorAll('details summary, .metaline')].map(x => x.textContent).join(' | ');
        out.stale = [...main.querySelectorAll('details li')].some(li => /stale series is not evaluated/.test(li.textContent));
        navigate('/app/scanner/setups/new');
        await new Promise(r => setTimeout(r, 300));
        main = document.querySelector('main');
        const test = [...main.querySelectorAll('button')].find(b => /Test against your history/.test(b.textContent));
        out.testDisabled = test ? test.disabled : null;
        test?.click();
        await new Promise(r => setTimeout(r, 200));
        out.tested = [...(test?.closest('.card')?.querySelectorAll('.metaline') || [])].some(x => /1 setup · 1 evaluation/.test(x.textContent));
        const ops = [...main.querySelectorAll('select')].find(s => /operator/i.test(s.getAttribute('aria-label') || ''));
        out.ops = ops ? [...ops.options].map(o => o.value) : [];
        scanHistoryFile = keep.h; scanSetupsFile = keep.s; scanAlertsFile = keep.a; scanDraft = keep.d;
        if (keep.st == null) localStorage.removeItem('vl.scanSetups'); else localStorage.setItem('vl.scanSetups', keep.st);
        return out;
      })()`);
      const thrown = events.map(m => m.params.exceptionDetails?.exception?.description?.split('\n')[0]);
      const p = [];
      if (!/Your setups/.test(r.h1)) p.push(`heading "${r.h1}"`);
      if (!r.chips.includes('v1') || !r.chips.some(c => /new matches only/.test(c)) || !r.chips.some(c => /every match/.test(c))) p.push(`chips ${JSON.stringify(r.chips)}`);
      if (r.tree < 3) p.push(`only ${r.tree} tree lines`);
      if (!/2 setups · 4 evaluations/.test(r.summary) || !r.stale) p.push(`evaluate-now summary: ${r.summary.slice(0, 200)} (stale named: ${r.stale})`);
      if (r.testDisabled !== false || !r.tested) p.push(`builder Test disabled: ${r.testDisabled}, ran: ${r.tested}`);
      if (r.ops.join() !== 'GREATER_THAN,LESS_THAN,GREATER_THAN_OR_EQUAL,LESS_THAN_OR_EQUAL,EQUALS,CROSSES_ABOVE,CROSSES_BELOW,BETWEEN') p.push(`builder operators ${r.ops.join()}`);
      if (thrown.length) p.push(`exceptions: ${thrown.join('; ')}`);
      if (p.length) fail('the scanner page renders and evaluates on engine 0.3.0', p);
      else ok('the scanner setups page renders and evaluates on engine 0.3.0 — setups adopted from the file listed with version, mode and tree lines; "Evaluate the file’s setups" reports the months-old fixture as stale, not matched; the builder tests its draft and offers all eight operators');
    } finally { ws.removeEventListener('message', listen); }
  }


  /* ===================================================================== */
  /* PHASE 3 — user: setups, versions, the builder, alerts and settings     */
  /* ===================================================================== */
  /* The reader's scanner pages run on fixture files injected into the page
     and a clean scanner store; everything is put back afterwards. The seed
     replays an EVERY_MATCH setup and the fixture's tree over the fixture
     history, so the alerts are the engine's own V2 records, plus one 0.2
     record with no id. */
  const scanSeedP3 = `(() => {
    window.__p3keep = window.__p3keep || { h: scanHistoryFile, s: scanSetupsFile, a: scanAlertsFile, d: scanDraft,
      st: localStorage.getItem('vl.scanSetups'), as: localStorage.getItem('vl.scanAlertState'), pr: localStorage.getItem('vl.scanPrefs') };
    ['vl.scanSetups', 'vl.scanAlertState', 'vl.scanPrefs'].forEach(k => localStorage.removeItem(k));
    const fx = scanFixture();
    const above = { id: 'qa-above', name: 'QA close above SMA5', version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D',
      cooldownMode: 'EVERY_MATCH', cooldownBars: 0, ruleTree: { type: 'group', logic: 'ALL', children: [
        { type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'sma', n: 5 } }] } };
    let alerts = [];
    Object.keys(fx.history.series.MATCH).sort().slice(20).forEach(d => {
      const r = scanRun([above, fx.setupV2], fx.history, { existing: alerts, asOf: d, now: scanReplayNow(d), runId: 'run-' + d, origin: 'replay' });
      alerts = alerts.concat(r.alerts);
    });
    alerts.push({ key: 'old-setup|MATCH|daily|2026-02-02', setupId: 'old-setup', setupName: 'A 0.2 setup', symbol: 'MATCH', timeframe: 'daily', bar: '2026-02-02',
      close: 101.2, recordedAt: '2026-02-03T01:00:00Z', rules: [{ text: 'price above SMA20', met: true }], engine: 'scan 0.2.0' });
    scanHistoryFile = fx.history; scanAlertsFile = { alerts, lastRun: null }; scanSetupsFile = { setups: [above, fx.setupV2] };
    scanDraft = null; scanEditDraft = null;
    return { n: alerts.length, above, tree: fx.setupV2 };
  })()`;
  const scanRestoreP3 = `(() => { const k = window.__p3keep; if (!k) return true;
    scanHistoryFile = k.h; scanSetupsFile = k.s; scanAlertsFile = k.a; scanDraft = k.d; scanEditDraft = null;
    [['vl.scanSetups', k.st], ['vl.scanAlertState', k.as], ['vl.scanPrefs', k.pr]].forEach(([n, v]) => { if (v == null) localStorage.removeItem(n); else localStorage.setItem(n, v); });
    delete window.__p3keep; navigate('/research'); return true; })()`;
  const p3events = [];
  const p3listen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') p3events.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0]); };
  ws.addEventListener('message', p3listen);
  try {
    await evaluate(scanSeedP3);

    /* THE BUILDER WRITES VALID RULES AND REFUSES INVALID ONES. A new setup
       from the form alone saves as v1; RSI is offered no price or volume
       on its right (only a fixed value or another RSI); EQUALS on RSI
       offers no indicator at all; an RSI of 150 and an RSI-versus-volume
       condition typed into the draft are refused at their condition, and
       Save stays disabled. */
    {
      const r = await evaluate(`(async () => {
        const w = (ms) => new Promise(r => setTimeout(r, ms));
        const main = () => document.querySelector('main');
        const q = (lab) => [...main().querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label') === lab);
        const set = (n, v) => { const proto = n.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
        navigate('/app/scanner/setups/new'); await w(200);
        const out = { view: State.view };
        set(q('Name'), 'QA builder cross'); await w(50);
        out.id = q('Id').value;
        set(q('Instruments (comma-separated symbols as they appear in your history)'), 'MATCH, FLAT'); await w(50);
        const save = [...main().querySelectorAll('button')].find(b => b.textContent.trim() === 'Save');
        out.readyDisabled = save.disabled;
        set(q('Condition 1: left side'), 'rsi'); await w(80);
        out.rsiRight = [...q('Condition 1: right side').options].map(o => o.value);
        set(q('Condition 1: operator'), 'EQUALS'); await w(80);
        out.eqRight = [...q('Condition 1: right side').options].filter(o => !o.disabled).map(o => o.value);
        set(q('Condition 1: operator'), 'GREATER_THAN'); await w(80);
        set(q('Condition 1: right side value'), '150'); await w(50);
        const c1 = () => main().querySelector('.scan-cond .scan-problems');
        out.domain = c1()?.hidden ? '' : c1()?.textContent || '';
        out.domainDisabled = [...main().querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').disabled;
        scanDraft.ruleTree.children[0].right = { indicator: 'volume' };
        navigate('/app/scanner/setups/new?x=1'); await w(200);
        out.unit = c1()?.hidden ? '' : c1()?.textContent || '';
        out.unitOption = q('Condition 1: right side')?.selectedOptions[0]?.textContent || '';
        out.unitDisabled = [...main().querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').disabled;
        scanDraft.ruleTree.children[0] = scanBlankCondition();
        navigate('/app/scanner/setups/new'); await w(200);
        [...main().querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click(); await w(250);
        const rec = scanStoreRead().setups['qa-builder-cross'];
        out.saved = rec ? { v: rec.current, n: rec.versions.length, path: location.pathname, view: State.view } : null;
        /* Edit: the operator changes, so v2; v1 stays. */
        navigate('/app/scanner/setups/qa-builder-cross/edit'); await w(200);
        out.editView = State.view;
        out.idLocked = q('Id')?.readOnly;
        set(q('Condition 1: operator'), 'CROSSES_BELOW'); await w(80);
        out.status = main().querySelector('.scan-status')?.textContent || '';
        [...main().querySelectorAll('button')].find(b => /Save \\(new version\\)/.test(b.textContent)).click(); await w(250);
        const rec2 = scanStoreRead().setups['qa-builder-cross'];
        out.edited = { v: rec2.current, versions: rec2.versions.map(v => v.version), ops: rec2.versions.map(v => v.setup.ruleTree.children[0].op) };
        return out;
      })()`);
      const p = [];
      if (r.view !== 'scannerSetupNew') p.push(`view ${r.view}`);
      if (r.id !== 'qa-builder-cross') p.push(`id from the name: "${r.id}"`);
      if (r.readyDisabled !== false) p.push('Save disabled on a valid draft');
      /* The engine's RSI and TradingView's (the pine section: its RSI, its
         RSI-based MA and bands) measure the same 0–100 scale. */
      if (r.rsiRight.join() !== 'value,rsi,tv_rsi.rsi,tv_rsi.ma,tv_rsi.bbUpper,tv_rsi.bbLower') p.push(`right side offered for RSI: ${r.rsiRight.join()}`);
      if (r.eqRight.join() !== 'value') p.push(`right side offered for RSI equals: ${r.eqRight.join()}`);
      if (!/outside what RSI14 can be/.test(r.domain) || !r.domainDisabled) p.push(`RSI 150: "${r.domain}", Save disabled ${r.domainDisabled}`);
      if (!/cannot be compared with volume/.test(r.unit) || !/not comparable/.test(r.unitOption) || !r.unitDisabled) p.push(`RSI vs volume: "${r.unit}" / "${r.unitOption}", Save disabled ${r.unitDisabled}`);
      if (!r.saved || r.saved.v !== 1 || r.saved.n !== 1 || r.saved.view !== 'scannerSetup' || r.saved.path !== '/app/scanner/setups/qa-builder-cross') p.push(`save: ${JSON.stringify(r.saved)}`);
      if (r.editView !== 'scannerSetupEdit' || r.idLocked !== true || !/saving creates v2/.test(r.status)) p.push(`edit: ${r.editView}, id locked ${r.idLocked}, "${r.status}"`);
      if (r.edited.v !== 2 || r.edited.versions.join() !== '1,2' || r.edited.ops.join() !== 'CROSSES_ABOVE,CROSSES_BELOW') p.push(`edited: ${JSON.stringify(r.edited)}`);
      if (p.length) fail('the scanner builder writes valid rules, refuses invalid operand combinations, and edits as a new version', p);
      else ok('the scanner builder writes valid rules and refuses invalid ones — RSI is offered only a fixed value or another RSI (the engine\'s, or TradingView\'s with its average and bands), EQUALS on RSI no indicator, RSI 150 and RSI-versus-volume are refused at their condition with Save disabled; saved as v1, edited to v2 with v1 kept and the id locked');
    }

    /* VERSIONS BUMP ONLY ON WHAT IS EVALUATED, AND ALERTS KEEP THEIRS. A
       rename is metadata (no version); a period change is v2, v1 kept with
       its hash. An alert recorded under v1 still names v1 on the setup page
       and on its own page, whose link opens that version. */
    {
      const r = await evaluate(`(async () => {
        const w = (ms) => new Promise(r => setTimeout(r, ms));
        const { above } = ${scanSeedP3};
        const a1 = scanSaveSetup(above, { source: 'file' });
        const a2 = scanSaveSetup({ ...above, name: 'Renamed' });
        const a3 = scanSaveSetup({ ...above, name: 'Renamed', ruleTree: { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'sma', n: 7 } }] } });
        const rec = scanStoreRead().setups['qa-above'];
        const v1Alert = scanAlertList().find(a => a.setupId === 'qa-above');
        navigate('/app/scanner/setups/qa-above'); await w(200);
        const v1 = document.getElementById('v1');
        const out = { a1: [a1.version, a1.bumped], a2: [a2.version, a2.bumped, a2.metaChanged], a3: [a3.version, a3.bumped],
          hashes: rec.versions.map(v => v.hash), canon: scanHash(scanCanonical(above)), name: rec.name,
          v1Links: v1 ? v1.querySelectorAll('.scan-alert-mini a').length : -1, v1Count: scanAlertList().filter(a => a.setupId === 'qa-above' && a.setupVersion === 1).length,
          v2Open: document.getElementById('v2')?.open, alertVersion: v1Alert.setupVersion };
        navigate('/app/scanner/setups/qa-above?version=1'); await w(150);
        out.v1Open = document.getElementById('v1')?.open;
        navigate(scanAlertPath(v1Alert)); await w(150);
        out.link = [...document.querySelectorAll('main a')].find(x => /^v\\d+$/.test(x.textContent))?.getAttribute('href') || '';
        out.nowText = document.querySelector('main').innerText.includes('the setup is now v2');
        return out;
      })()`);
      const p = [];
      if (r.a1.join() !== '1,true' || r.a2.join() !== '1,false,true' || r.a3.join() !== '2,true') p.push(`saves: ${JSON.stringify([r.a1, r.a2, r.a3])}`);
      if (r.hashes[0] !== r.canon || r.hashes[0] === r.hashes[1] || r.name !== 'Renamed') p.push(`hashes ${r.hashes.join(',')} vs canonical ${r.canon}; name ${r.name}`);
      if (r.alertVersion !== 1 || r.v1Links < 1 || r.v1Links !== Math.min(20, r.v1Count) || !r.v2Open) p.push(`v1 lists ${r.v1Links} of ${r.v1Count} alerts; v2 open ${r.v2Open}`);
      if (!r.v1Open || !/\/app\/scanner\/setups\/qa-above\?version=1$/.test(r.link) || !r.nowText) p.push(`?version=1 open ${r.v1Open}; alert's version link ${r.link}; "now v2" ${r.nowText}`);
      if (p.length) fail('scanner versions bump on evaluation fields only, and alerts keep the version that recorded them', p);
      else ok(`scanner versions bump on evaluation fields only — a rename stays v1, a period change is v2 with v1's hash (the engine's canonical hash) kept; the ${r.v1Count} alerts recorded under v1 stay under v1, and an alert's version link opens v1 while saying the setup is now v2`);
    }

    /* THE EXPORT ROUND-TRIPS, AND THE DRIFT NAMES EVERY STATE. The export is
       the schema-2 document; scanValidate reads it with no problem and the
       same versions and hashes. The example configuration validates too. */
    {
      const r = await evaluate(`(() => {
        ${scanSeedP3};
        const fx = scanFixture();
        const base = { version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D', cooldownMode: 'NEW_MATCH',
          ruleTree: { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'ema', n: 20 } }] } };
        const mk = (id, n = 20) => ({ ...base, id, name: id, ruleTree: { ...base.ruleTree, children: [{ ...base.ruleTree.children[0], right: { indicator: 'ema', n } }] } });
        ['same', 'ahead', 'behind', 'mine'].forEach(id => scanSaveSetup(mk(id), { source: 'file', now: '2026-01-01T00:00:00Z' }));
        scanSaveSetup(mk('ahead', 30), { now: '2026-02-01T00:00:00Z' });
        const doc = scanExportDoc();
        const v = scanValidate(doc);
        const rt = { problems: v.problems.length, kind: doc.kind, schema: doc.schema, n: doc.setups.length,
          same: v.setups.every(s => { const b = scanBrowserSetups().find(x => x.id === s.id); return b && b.version === s.version && b.hash === s.hash; }) };
        const ex = scanValidate(SCAN_EXAMPLE_DOC);
        const file = { setups: [mk('same'), mk('ahead'), { ...mk('behind', 50), version: 2 }, mk('theirs')] };
        const states = Object.fromEntries(scanDriftRows({ fileDoc: file }).map(x => [x.id, x.state]));
        const hidden = Object.fromEntries(scanDriftRows({ fileDoc: null }).map(x => [x.id, x.state]));
        scanMarkExported(scanExportDoc());
        const after = Object.fromEntries(scanDriftRows({ fileDoc: null }).map(x => [x.id, x.state]));
        const adopted = (() => { scanSetupsFile = file; const o = scanAdoptFromFile('behind'); return [o.ok, o.version]; })();
        return { rt, ex: [ex.problems.length, ex.setups.length], states, hidden, after, adopted };
      })()`);
      const p = [];
      if (r.rt.problems || r.rt.kind !== 'quantum-tradeworks-scan-setups' || r.rt.schema !== 2 || r.rt.n !== 4 || !r.rt.same) p.push(`round trip ${JSON.stringify(r.rt)}`);
      if (r.ex[0] || r.ex[1] !== 1) p.push(`example: ${r.ex}`);
      const want = { same: 'IN_STEP', ahead: 'NOT_EXPORTED', behind: 'FILE_NEWER', mine: 'BROWSER_ONLY', theirs: 'FILE_ONLY' };
      Object.entries(want).forEach(([id, s]) => { if (r.states[id] !== s) p.push(`${id}: ${r.states[id]}, not ${s}`); });
      if (Object.values(r.hidden).some(s => s !== 'NOT_EXPORTED') || Object.values(r.after).some(s => s !== 'UNCONFIRMED')) p.push(`no file: ${JSON.stringify(r.hidden)} then ${JSON.stringify(r.after)}`);
      if (r.adopted.join() !== 'true,2') p.push(`adopting the file's v2: ${r.adopted}`);
      if (p.length) fail('the scanner export round-trips through scanValidate and the drift names every state', p);
      else ok('the scanner export round-trips — the schema-2 document validates with no problem and the same versions and hashes, as does the example configuration; drift reads in step, not exported, file newer, browser only and file only, and with no file visible "not exported" until exported, then "file not visible", never in step; adopting keeps the file\'s v2');
    }

    /* ALERT STATUS PERSISTS ACROSS A RELOAD, AND THE UNREAD COUNT FOLLOWS IT.
       Mark read and archive from the page's bulk actions; reload; the status
       is still there. The count is null with no file, and leaves out a
       muted setup and everything when in-app is off. */
    {
      const before = await evaluate(`(async () => {
        const w = (ms) => new Promise(r => setTimeout(r, ms));
        ${scanSeedP3};
        const noFile = (() => { const k = scanAlertsFile; scanAlertsFile = null; const u = scanUnreadCount(); scanAlertsFile = k; return u; })();
        const total = scanUnreadCount();
        navigate('/app/scanner/alerts'); await w(200);
        const boxes = [...document.querySelectorAll('main tbody input[type=checkbox]')];
        boxes[0].click(); boxes[1].click();
        [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Mark read').click(); await w(150);
        const b2 = [...document.querySelectorAll('main tbody input[type=checkbox]')];
        b2[2].click();
        [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Archive').click(); await w(150);
        const st = scanAlertStateRead();
        const ordered = scanAlertsInOrder();
        return { noFile, total, after: scanUnreadCount(), st, ids: ordered.slice(0, 3).map(scanAlertIdOf), rows: document.querySelectorAll('main tbody tr').length,
          chips: [...document.querySelectorAll('main tbody tr')].slice(0, 3).map(tr => tr.querySelector('.chip')?.textContent) };
      })()`);
      await send('Page.reload', {}, sessionId);
      let back = null;
      for (let i = 0; i < 60 && !back; i++) { await sleep(500); try { back = await evaluate(`typeof realPending !== 'undefined' && !realPending ? true : null`); } catch { /* booting */ } }
      const after = await evaluate(`(async () => {
        const w = (ms) => new Promise(r => setTimeout(r, ms));
        const st = scanAlertStateRead();
        const fx = scanFixture();
        /* The page reloaded, so the injected record is gone; put the same one back without clearing storage. */
        const above = { id: 'qa-above', name: 'QA close above SMA5', version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D',
          cooldownMode: 'EVERY_MATCH', cooldownBars: 0, ruleTree: { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'sma', n: 5 } }] } };
        let alerts = [];
        Object.keys(fx.history.series.MATCH).sort().slice(20).forEach(d => { alerts = alerts.concat(scanRun([above, fx.setupV2], fx.history, { existing: alerts, asOf: d, now: scanReplayNow(d), runId: 'run-' + d, origin: 'replay' }).alerts); });
        alerts.push({ key: 'old-setup|MATCH|daily|2026-02-02', setupId: 'old-setup', setupName: 'A 0.2 setup', symbol: 'MATCH', timeframe: 'daily', bar: '2026-02-02',
          close: 101.2, recordedAt: '2026-02-03T01:00:00Z', rules: [{ text: 'price above SMA20', met: true }], engine: 'scan 0.2.0' });
        scanAlertsFile = { alerts }; scanHistoryFile = fx.history;
        navigate('/app/scanner/alerts?status=ALL'); await w(200);
        const chips = [...document.querySelectorAll('main tbody tr')].slice(0, 3).map(tr => tr.querySelector('.chip')?.textContent);
        scanPrefsWrite({ muted: { 'fixture-breakout-v2': true } });
        const muted = scanUnreadCount();
        scanPrefsWrite({ muted: {}, inApp: false });
        const off = scanUnreadCount();
        scanPrefsWrite({ inApp: true });
        return { st, chips, muted, off, all: alerts.length, treeNew: alerts.filter(a => a.setupId === 'fixture-breakout-v2' && !st[a.id]).length };
      })()`);
      const p = [];
      if (before.noFile !== null) p.push(`unread with no file: ${before.noFile}`);
      if (before.total !== 24 || before.after !== 21) p.push(`unread ${before.total} then ${before.after}`);
      if (before.st[before.ids[0]] !== 'READ' || before.st[before.ids[1]] !== 'READ' || Object.values(before.st).filter(s => s === 'ARCHIVED').length !== 1) p.push(`state ${JSON.stringify(before.st)}`);
      if (JSON.stringify(after.st) !== JSON.stringify(before.st)) p.push(`after reload the state is ${JSON.stringify(after.st)}`);
      if (after.chips.slice(0, 2).join() !== 'read,read') p.push(`after reload the first rows read ${after.chips.join(',')}`);
      if (after.muted !== 21 - after.treeNew || after.off !== null) p.push(`muted count ${after.muted} (tree NEW ${after.treeNew}), off ${after.off}`);
      if (p.length) fail('scanner alert status persists across a reload and the unread count follows it', p);
      else ok(`scanner alert status persists across a reload — two marked read and one archived from the bulk actions are still so after it; unread ${before.total} → ${before.after}, no count at all with no alerts file, a muted setup left out, and none with in-app off`);
    }

    /* ALERT DETAIL RESOLVES FROM ITS ID. Every fact the page states comes
       from the record: candle date, bar status, source, data version, the
       setup and its version, each condition with its values, the event and
       the lineage; the same bars recomputed read "unchanged". A 0.2 record
       with no id resolves from the id its key gives it. An unknown id is a
       card, not the not-found page. */
    {
      const r = await evaluate(`(async () => {
        const w = (ms) => new Promise(r => setTimeout(r, ms));
        ${scanSeedP3};
        const a = scanAlertList().find(x => x.setupId === 'fixture-breakout-v2');
        navigate('/app/scanner/alerts/' + a.id); await w(200);
        const main = document.querySelector('main'), text = main.innerText;
        const out = { view: State.view, h1: main.querySelector('h1')?.textContent || '', title: document.title,
          has: ['Candle date', 'Bar status', 'Data source', 'Data version', 'Lineage', 'Every condition, with its values', a.candleDate, a.dataVersion, a.dataSourceId, a.barStatus, 'new match'].filter(t => !text.toLowerCase().includes(String(t).toLowerCase())),
          rows: main.querySelectorAll('.card:nth-of-type(n) table.dt tbody tr').length, conds: a.matchedConditions.length,
          left: a.matchedConditions.map(c => scanDec(c.left)), unchanged: /bars up to [0-9-]+ are as they were/.test(text),
          read: scanAlertStatus(a), advice: /\\b(buy|sell|enter|exit|target|stop)\\b/i.test(text) };
        out.leftShown = out.left.every(v => text.includes(v));
        const legacy = scanAlertList().find(x => !x.id);
        navigate('/app/scanner/alerts/' + scanAlertIdOf(legacy)); await w(150);
        out.legacy = { view: State.view, h1: document.querySelector('main h1')?.textContent || '', nr: /predates engine 0.3.0/.test(document.querySelector('main').innerText) };
        navigate('/app/scanner/alerts/a00000000'); await w(150);
        out.unknown = { view: State.view, card: /Not in your record/i.test(document.querySelector('main').innerText) };
        navigate('/app/scanner/setups/no-such-setup'); await w(150);
        out.unknownSetup = { view: State.view, card: /Not in your record/i.test(document.querySelector('main').innerText) };
        return out;
      })()`);
      const p = [];
      if (r.view !== 'scannerAlert' || !/Fixture breakout \(tree\) · MATCH · 2026-/.test(r.h1)) p.push(`view ${r.view}, h1 "${r.h1}"`);
      if (r.has.length) p.push(`missing from the page: ${r.has.join(', ')}`);
      if (!r.leftShown || !r.unchanged) p.push(`values shown ${r.leftShown} (${r.left.join(', ')}); data unchanged ${r.unchanged}`);
      if (r.read !== 'READ') p.push(`opening it left it ${r.read}`);
      if (r.advice) p.push('an instruction word on the alert page');
      if (r.legacy.view !== 'scannerAlert' || !/A 0.2 setup/.test(r.legacy.h1) || !r.legacy.nr) p.push(`legacy: ${JSON.stringify(r.legacy)}`);
      if (r.unknown.view !== 'scannerAlert' || !r.unknown.card || r.unknownSetup.view !== 'scannerSetup' || !r.unknownSetup.card) p.push(`unknown: ${JSON.stringify(r.unknown)} ${JSON.stringify(r.unknownSetup)}`);
      if (p.length) fail('a scanner alert\'s page resolves from its id and states the record', p);
      else ok(`a scanner alert's page resolves from its id — candle date, bar status, source, data version, setup version, ${r.conds} conditions with their unrounded values, the event and the lineage, the bars recomputed as unchanged, and opening it marks it read; a 0.2 record resolves from its key's id and says what it predates; an unknown alert or setup is a card, not the not-found page`);
    }

    /* EMPTY STATES. No alerts file (the deployed site), a file with none,
       filters that exclude everything, no setups saved, and a builder with no
       history to test on: each says which, and none says "0 unread". */
    {
      const r = await evaluate(`(async () => {
        const w = (ms) => new Promise(r => setTimeout(r, ms));
        ${scanSeedP3};
        const t = () => document.querySelector('main').innerText;
        const out = {};
        navigate('/app/scanner/alerts?symbol=NOPE'); await w(150); out.filtered = /No match fits these filters/.test(t());
        scanAlertsFile = { alerts: [] }; navigate('/app/scanner/alerts'); await w(150); out.none = /Nothing recorded yet/.test(t());
        scanAlertsFile = null; navigate('/app/scanner/alerts'); await w(150); out.noFile = /cannot be seen from here/.test(t()) && !/0 unread/.test(t());
        out.subnav = [...document.querySelectorAll('main nav a')].map(a => a.textContent).join('|');
        localStorage.removeItem('vl.scanSetups'); scanSetupsFile = null; navigate('/app/scanner/setups'); await w(150);
        out.noSetups = /No setups saved in this browser/.test(t()) && /cannot be seen from here/.test(t());
        scanHistoryFile = null; navigate('/app/scanner/setups/new'); await w(150);
        const test = [...document.querySelectorAll('main button')].find(b => /Test against your history/.test(b.textContent));
        out.noHistory = test?.disabled === true && /nothing to test against/.test(t());
        navigate('/app/scanner/watchlists'); await w(150); out.watch = State.view === 'scannerWatchlists' && /Watchlist scanner/.test(t());
        navigate('/app/scanner/settings'); await w(150);
        out.settings = ['Email', 'Telegram', 'Push'].every(c => new RegExp(c + '\\\\s*not configured', 'i').test(t())) && document.querySelectorAll('main input[type=checkbox]').length >= 1
          && ![...document.querySelectorAll('main input')].some(i => /email|telegram|push/i.test(i.getAttribute('aria-label') || ''));
        out.portable = ['scanSetups', 'scanAlertState', 'scanPrefs'].every(k => PORTABLE_KEYS.some(x => x.k === k));
        navigate('/privacy'); await w(150); out.privacy = /scanner setups with every version/.test(t()) && /scanner alerts you have read or archived/.test(t());
        return out;
      })()`);
      const p = Object.entries(r).filter(([k, v]) => k !== 'subnav' && v !== true).map(([k]) => k);
      if (/Alerts ·/.test(r.subnav)) p.push(`subnav shows a count with no file: ${r.subnav}`);
      if (p.length) fail('the scanner pages state their empty cases, and the three store keys travel and are named', p);
      else ok('the scanner pages state their empty cases — no alerts file (and no count), none recorded, filters excluding all, no setups saved, no history to test on; settings list email, Telegram and push as not configured with no switch; scanSetups, scanAlertState and scanPrefs are portable and named on the privacy page');
    }

    /* THE BUILDER BY KEYBOARD. Real key events: Tab walks from the name to
       the id; a select changed from the keyboard keeps focus through the
       rebuild; typing in a number field does not rebuild under the cursor;
       Enter on "Add a condition" lands on the new condition's left side. */
    {
      const key = async (k, code, vk, text) => {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, ...(text ? { text } : {}) }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }, sessionId);
        await sleep(80);
      };
      await evaluate(`${scanSeedP3}; navigate('/app/scanner/setups/new'); document.querySelector('main [aria-label="Name"]').focus(); true`);
      await sleep(200);
      await key('Tab', 'Tab', 9);
      const tab = await evaluate(`document.activeElement?.getAttribute('aria-label')`);
      await evaluate(`document.querySelector('main [aria-label="Condition 1: operator"]').focus(); true`);
      await key('ArrowDown', 'ArrowDown', 40);
      const sel = await evaluate(`({ label: document.activeElement?.getAttribute('aria-label'), value: document.activeElement?.value, draft: scanDraft.ruleTree.children[0].op })`);
      await evaluate(`window.__p3n = document.querySelector('main [aria-label="Condition 1: right side period (bars)"]'); window.__p3n.focus(); window.__p3n.select(); true`);
      await send('Input.insertText', { text: '34' }, sessionId);
      await sleep(80);
      const typed = await evaluate(`({ same: document.activeElement === window.__p3n && window.__p3n.isConnected, n: scanDraft.ruleTree.children[0].right.n })`);
      await evaluate(`document.querySelector('main [aria-label="Add a condition"]').focus(); true`);
      await key('Enter', 'Enter', 13, '\r');
      await sleep(120);
      const added = await evaluate(`({ label: document.activeElement?.getAttribute('aria-label'), n: scanDraft.ruleTree.children.length })`);
      const p = [];
      if (tab !== 'Id') p.push(`Tab from Name reached "${tab}"`);
      if (sel.label !== 'Condition 1: operator' || sel.draft !== sel.value || sel.value === 'CROSSES_ABOVE') p.push(`operator by keyboard: ${JSON.stringify(sel)}`);
      if (!typed.same || typed.n !== 34) p.push(`typing a period: ${JSON.stringify(typed)}`);
      if (added.label !== 'Condition 2: left side' || added.n !== 2) p.push(`Enter on Add: ${JSON.stringify(added)}`);
      if (p.length) fail('the scanner builder works from the keyboard', p);
      else ok('the scanner builder works from the keyboard — Tab from the name reaches the id, an operator changed by arrow key keeps focus through the rebuild, a typed period keeps the cursor in its field, and Enter on "Add a condition" lands on the new condition');
    }
    if (p3events.length) fail('the Phase 3 scanner pages threw', p3events.slice(0, 5));
    else ok('the Phase 3 scanner pages ran every check above with no exception');
  } finally {
    ws.removeEventListener('message', p3listen);
    await evaluate(scanRestoreP3).catch(() => null);
  }
  /* PHASE 3 — ops: the dashboard, screening, simulation and operations    */
  /* (src/js/87-scanner-ops.js). Every check below sets the scanner's files */
  /* in memory, pins the page's clock (scanOpsClock), and puts both back.   */
  /* ===================================================================== */
  const opsKeep = `const keep = { h: scanHistoryFile, s: scanSetupsFile, a: scanAlertsFile, r: scanRunsFile, c: scanControlFile, d: scanDeliveriesFile, i: ingestRunsFile, k: scanOpsClock, read: scanOpsRead };
    const restore = () => { scanHistoryFile = keep.h; scanSetupsFile = keep.s; scanAlertsFile = keep.a; scanRunsFile = keep.r; scanControlFile = keep.c;
      scanDeliveriesFile = keep.d; ingestRunsFile = keep.i; scanOpsClock = keep.k; scanOpsRead = keep.read; scanMarketState.result = null; scanBacktestState.result = null; };`;
  const opsWait = `const w = (ms) => new Promise(r => setTimeout(r, ms));`;

  /* NAVIGATION. The scanner is the product after Equities Research — in the
     app's sidebar since Release A, the header's successor — every scanner
     address (and the Trading Index, a section of it now) marks it current,
     /my/scanner is an alias whose canonical is /app/scanner, and My
     Investments no longer carries a scanner tab. */
  {
    const r = await evaluate(`(async () => {
      const out = { labels: [...document.querySelectorAll('#appnav a.sb-link .sb-text')].map(n => n.textContent.trim()), my: SUBNAV_MY.map(s => s.id), cur: {}, views: {} };
      for (const p of ['/app/scanner', '/app/scanner/market', '/app/scanner/backtest', '/admin/scanner', '/admin/scanner/data', '/admin/scanner/jobs', '/admin/scanner/delivery', '/my/scanner', '/research/trading-index']) {
        navigate(p);
        out.cur[p] = document.querySelector('#appnav a[aria-current=page] .sb-text')?.textContent.trim() || null;
        out.views[p] = State.view;
      }
      out.trading = document.querySelector('main nav[aria-label="Scanner sections"] a[aria-current=page]')?.textContent.trim() || null;
      navigate('/my/scanner');
      out.canon = document.querySelector('link[rel=canonical]').getAttribute('href').replace(location.origin, '');
      navigate('/my/scanner?symbol=MSFT');
      out.symbol = { view: State.view, path: location.pathname };
      out.section = SCANNER_VIEWS.every(v => SECTION_OF[v] === 'scanner');
      out.noId = ROUTES.filter(r => /^\\/(app\\/scanner|admin)/.test(r.path)).every(r => !r.path.includes(':id'));
      navigate('/learn');
      return out;
    })()`);
    const p = [];
    if (r.labels.join() !== 'My Dashboard,Watchlists,My Alerts,Saved Models,Equities Research,Quantum Scanner,Property Intelligence,Your data & settings,Plans') p.push(`sidebar ${r.labels.join(', ')}`);
    if (r.my.includes('scanner')) p.push('My Investments still carries a scanner tab');
    for (const [k, v] of Object.entries(r.cur)) if (v !== 'Quantum Scanner') p.push(`${k} marks ${v}`);
    if (r.trading !== 'Trading Index') p.push(`the Trading Index page's scanner strip marks ${r.trading}`);
    const wantView = { '/app/scanner': 'scannerDashboard', '/app/scanner/market': 'scannerMarket', '/app/scanner/backtest': 'scannerBacktest', '/admin/scanner': 'scannerAdmin',
      '/admin/scanner/data': 'scannerAdminData', '/admin/scanner/jobs': 'scannerAdminJobs', '/admin/scanner/delivery': 'scannerAdminDelivery', '/my/scanner': 'scannerDashboard',
      '/research/trading-index': 'tradingIndex' };
    for (const [k, v] of Object.entries(wantView)) if (r.views[k] !== v) p.push(`${k} renders ${r.views[k]}, not ${v}`);
    if (r.canon !== '/app/scanner') p.push(`/my/scanner's canonical is ${r.canon}`);
    if (r.symbol.view === 'notfound' || !(r.symbol.path === '/app/scanner/setups/new' || r.symbol.view === 'scannerDashboard')) p.push(`/my/scanner?symbol=MSFT went to ${JSON.stringify(r.symbol)}`);
    if (!r.section) p.push('a scanner view is not in the Scanner section');
    if (!r.noId) p.push('a scanner route names a parameter :id, which the router reads as a company');
    if (p.length) fail('the scanner is in the sidebar after Equities Research, on every scanner address', p);
    else ok(`the scanner is in the sidebar after Equities Research, on every scanner address — the app sidebar lists Quantum Scanner straight after Equities Research, ${Object.keys(r.cur).length} addresses mark it current (the Trading Index among them, its strip naming itself), /my/scanner canonicalises to /app/scanner, and /my/scanner?symbol= opens ${r.symbol.path === '/app/scanner/setups/new' ? 'the builder' : 'the dashboard (no builder in this build)'}`);
  }

  /* THE DASHBOARD'S STATES, from injected records only: never, current,
     behind (the clock moved on), failed (a failure after the success) and
     paused. A stale result is never under a "current" heading. */
  {
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const fx = scanFixture();
        const setupsDoc = { setups: [fx.setup, fx.setupV2] };
        const run = scanRun(setupsDoc.setups, fx.history, { now: fx.now, runId: 'run-qa-1', origin: 'cli' });
        const ok = { id: 'run-qa-1', kind: 'scan', status: 'COMPLETED', trigger: 'cli', startedAt: fx.now, finishedAt: fx.now, engine: 'scan ' + SCAN_VERSION,
                     setupsHash: scanSetupsHash(setupsDoc), asOf: run.asOf, asOfFrom: run.asOfFrom, evaluated: run.evaluated, matched: run.matched, recorded: run.alerts.length };
        const failed = { id: 'run-qa-2', kind: 'scan', status: 'FAILED', startedAt: scanAddDays(fx.lastBar, 1) + 'T12:00:00Z', engine: 'scan ' + SCAN_VERSION, error: { code: 'BAD_ALERTS', message: 'QA: the alerts file did not parse' } };
        const cases = {
          never:   { runs: null, alerts: { alerts: [], lastRun: null }, control: null, clock: fx.now },
          current: { runs: { schema: 1, runs: [ok] }, alerts: { alerts: run.alerts }, control: null, clock: fx.now },
          behind:  { runs: { schema: 1, runs: [ok] }, alerts: { alerts: run.alerts }, control: null, clock: scanAddDays(fx.lastBar, 30) + 'T09:00:00Z' },
          failed:  { runs: { schema: 1, runs: [ok, failed] }, alerts: { alerts: run.alerts }, control: null, clock: scanAddDays(fx.lastBar, 1) + 'T13:00:00Z' },
          paused:  { runs: { schema: 1, runs: [ok] }, alerts: { alerts: run.alerts }, control: { paused: true, since: fx.now, reason: 'QA pause' }, clock: fx.now },
        };
        const out = {};
        for (const [name, c] of Object.entries(cases)) {
          scanHistoryFile = fx.history; scanSetupsFile = setupsDoc; scanAlertsFile = c.alerts; scanRunsFile = c.runs; scanControlFile = c.control; scanOpsClock = c.clock; scanOpsRead = true;
          navigate('/app/scanner'); render();
          await w(50);
          const main = document.querySelector('main');
          const heads = [...main.querySelectorAll('h3.h-card, .scan-q .stat-label')].map(h => h.textContent);
          out[name] = { state: main.querySelector('.scan-band')?.dataset.state, chip: main.querySelector('.scan-band .chip')?.textContent,
                        reasons: [...main.querySelectorAll('.scan-band li')].map(l => l.textContent).join(' | '),
                        currentHead: heads.some(h => /^Matched on the last scan|on the last scan\\?$/.test(h)), notCurrent: heads.some(h => /not current/.test(h)),
                        links: [...main.querySelectorAll('a')].filter(a => /\\/app\\/scanner\\/alerts\\/a[0-9a-f]{8}$/.test(a.getAttribute('href') || '')).length,
                        open: !!main.querySelector('.scan-open') };
        }
        return out;
      } finally { restore(); navigate('/learn'); }
    })()`);
    const p = [];
    const want = { never: 'No run recorded', current: 'Current', behind: 'Behind', failed: 'Failed', paused: 'Paused' };
    for (const [k, chip] of Object.entries(want)) {
      const v = r[k];
      if (!v || v.state !== k || v.chip !== chip) p.push(`${k}: state ${v?.state}, chip "${v?.chip}"`);
      else if (k === 'current' && (!v.currentHead || v.notCurrent || v.links < 2)) p.push(`current: current heading ${v.currentHead}, "not current" ${v.notCurrent}, ${v.links} alert links`);
      else if (k !== 'current' && k !== 'never' && (v.currentHead || !v.notCurrent)) p.push(`${k}: a stale result under a current heading (current ${v.currentHead}, not-current ${v.notCurrent})`);
    }
    if (!/days old/.test(r.behind?.reasons || '')) p.push(`behind gives no dated reason: ${r.behind?.reasons}`);
    if (!/QA: the alerts file did not parse/.test(r.failed?.reasons || '')) p.push(`failed does not name the error: ${r.failed?.reasons}`);
    if (!/QA pause/.test(r.paused?.reasons || '')) p.push(`paused does not name the reason: ${r.paused?.reasons}`);
    if (!r.never?.open) p.push('the never state offers no way to open your own files');
    if (p.length) fail('the dashboard answers from persisted records in every state', p);
    else ok('the dashboard answers from persisted records in every state — never, current, behind, failed and paused each from injected records, with the dated reason, the error or the pause; only the current state heads its matches as the last scan’s, and each match links to its alert page');
  }

  /* MARKET SCREENING. Four series whose names and values disagree on
     order: the screen lists each group in symbol order, the table has no
     sortable header, the coverage line comes first, and the flag notice
     from the register is on the page. */
  {
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const fx = scanFixture();
        const h = JSON.parse(JSON.stringify(fx.history));
        h.series.ZZZ = h.series.MATCH; h.volume.ZZZ = h.volume.MATCH; h.series.AAA = h.series.FLAT; h.volume.AAA = h.volume.FLAT;
        scanHistoryFile = h; scanSetupsFile = { setups: [fx.setup] }; scanAlertsFile = { alerts: [] }; scanOpsClock = fx.now; scanOpsRead = true;
        scanMarketState.market = '__all'; scanMarketState.asOf = ''; scanMarketState.result = null; scanMarketState.setup = null;
        navigate('/app/scanner/market');
        const main = document.querySelector('main');
        const flag = !!main.querySelector('.flag-notice');
        [...main.querySelectorAll('button')].find(b => /Screen now/.test(b.textContent))?.click();
        for (let i = 0; i < 40 && !main.querySelector('.scan-coverage'); i++) await w(50);
        const groups = [...main.querySelectorAll('.scan-group')].map(g => ({ title: g.querySelector('h4')?.textContent, syms: [...g.querySelectorAll('tbody tr td.ident')].map(td => td.textContent) }));
        const ths = [...main.querySelectorAll('.scan-results th')];
        return { flag, groups, coverage: main.querySelector('.scan-coverage')?.textContent || '',
                 sortable: ths.filter(t => (t.getAttribute('aria-sort') && t.getAttribute('aria-sort') !== 'none') || t.querySelector('button')).length,
                 order: [...main.querySelectorAll('.scan-results tbody td.ident')].map(t => t.textContent) };
      } finally { restore(); navigate('/learn'); }
    })()`);
    const p = [];
    const matched = r.groups.find(g => /^Matched/.test(g.title || '')), notMatched = r.groups.find(g => /^Not matched/.test(g.title || ''));
    if (!r.flag) p.push('no feature-flag notice on the page');
    if (!matched || matched.syms.join() !== 'MATCH,ZZZ') p.push(`matched ${matched?.syms.join()}`);
    if (!notMatched || notMatched.syms.join() !== 'AAA,FLAT') p.push(`not matched ${notMatched?.syms.join()}`);
    r.groups.forEach(g => { if (g.syms.join() !== [...g.syms].sort().join()) p.push(`${g.title} is not in symbol order: ${g.syms.join()}`); });
    if (!/^Screened 4 instruments/.test(r.coverage) || !/none of those is screened/.test(r.coverage)) p.push(`coverage line: ${r.coverage}`);
    if (r.sortable) p.push(`${r.sortable} sortable headers`);
    if (p.length) fail('market screening lists your own series in symbol order, never by value', p);
    else ok(`market screening lists your own series in symbol order, never by value — matched ${matched.syms.join(', ')}, not matched ${notMatched.syms.join(', ')}, the coverage line first, no header a control, and the register's flag on the page`);
  }

  /* HISTORICAL TESTING. The fixed simulation label and the no-look-ahead
     statement come before any figure; the page's events are scanHistorical's;
     each event row is the row a history cut at that bar produces; and no
     column is a return. */
  {
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const fx = scanFixture();
        scanHistoryFile = fx.history; scanSetupsFile = { setups: [fx.setupV2] }; scanAlertsFile = { alerts: [] }; scanOpsClock = fx.now; scanOpsRead = true;
        Object.assign(scanBacktestState, { setup: null, symbol: '', from: '', to: '', view: 'events', result: null });
        navigate('/app/scanner/backtest');
        const main = document.querySelector('main');
        const sim = main.querySelector('.scan-sim')?.textContent || '';
        const simFirst = !!main.querySelector('.scan-sim') && main.querySelector('.scan-sim').compareDocumentPosition(main.querySelector('.scan-form')) & Node.DOCUMENT_POSITION_FOLLOWING;
        const flag = !!main.querySelector('.flag-notice');
        [...main.querySelectorAll('button')].find(b => /Run the simulation/.test(b.textContent))?.click();
        for (let i = 0; i < 60 && !main.querySelector('.scan-counts'); i++) await w(50);
        const rows = [...main.querySelectorAll('.card')].find(c => /Matching dates/.test(c.textContent))?.querySelectorAll('tbody tr') || [];
        const shown = [...rows].map(tr => [...tr.cells].slice(0, 2).map(td => td.textContent).join('|'));
        const direct = scanHistorical(fx.setupV2, fx.history);
        const want = direct.events.map(e => e.symbol + '|' + e.bar);
        const cut = shown.every(s => { const [sym, bar] = s.split('|'); return scanHistorical(fx.setupV2, scanTruncateHistory(fx.history, bar)).events.some(e => e.symbol === sym && e.bar === bar); });
        const heads = [...main.querySelectorAll('th')].map(t => t.textContent);
        return { sim, simFirst: !!simFirst, flag, shown, want, cut, heads };
      } finally { restore(); navigate('/learn'); }
    })()`);
    const p = [];
    if (!r.sim.includes('A simulation on the closes you captured') || !/No look-ahead/.test(r.sim)) p.push(`simulation label: ${r.sim.slice(0, 120)}`);
    if (!r.simFirst) p.push('the label does not come before the form and the figures');
    if (!r.flag) p.push('no feature-flag notice');
    if ([...r.shown].sort().join() !== [...r.want].sort().join() || !r.shown.length) p.push(`events on the page ${r.shown.join()} vs scanHistorical ${r.want.join()}`);
    if (!r.cut) p.push('an event row differs from the history cut at its own bar');
    if (r.heads.some(h => /\breturn|profit|p&l|performance|win rate|hit rate/i.test(h))) p.push(`a column reads as performance: ${r.heads.join(', ')}`);
    if (p.length) fail('historical testing is labelled a simulation and shows no look-ahead', p);
    else ok(`historical testing is labelled a simulation and shows no look-ahead — the fixed label and the no-look-ahead statement come first, the page's events (${r.shown.join(', ')}) are scanHistorical's and each equals the history cut at its bar, and no column is a return`);
  }

  /* THE OPERATIONS PAGES, from the committed fixture files: the notice,
     the failed and partial runs with their ids and a retry command, the
     filters, the control log, data health and the channels. Nothing on
     them can change anything: every button copies, opens a file, or filters. */
  {
    const { readFileSync } = await import('node:fs');
    const fx = (f) => readFileSync(new URL(`./scanner/fixtures/${f}`, import.meta.url), 'utf8');
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const f = scanFixture();
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setup, f.setupV2] }; scanAlertsFile = { alerts: scanRun([f.setup], f.history, { now: f.now }).alerts };
        scanRunsFile = ${fx('scan-runs.fixture.json')}; scanControlFile = ${fx('scan-control.fixture.json')};
        scanDeliveriesFile = ${fx('scan-deliveries.fixture.json')}; ingestRunsFile = ${fx('ingest-runs.fixture.json')};
        scanOpsClock = '2026-04-07T09:00:00.000Z'; scanOpsRead = true;
        const out = {};
        const text = () => document.querySelector('main').innerText;
        const buttons = () => [...document.querySelectorAll('main button')].map(b => b.textContent.trim());
        navigate('/admin/scanner');
        out.overview = { notice: /There is no administrator role/.test(text()), failed: /run-20260402T220000-3870-9f3a/.test(text()), partial: /run-20260403T220000-3977-6e41/.test(text()),
                         retry: /--retry run-20260402T220000-3870-9f3a/.test(text()), controls: ['--as-of', '--pause', '--resume', '--unlock', '--runs'].every(c => text().includes(c)),
                         ingest: /capture/.test(text()) && /2026-04-06 21:30 UTC/.test(text()), buttons: buttons() };
        navigate('/admin/scanner/jobs');
        const rows = () => document.querySelectorAll('main .card:first-of-type tbody tr').length;
        out.jobs = { runs: [...document.querySelectorAll('main .scan-dt')][0]?.querySelectorAll('tbody tr:not(.scan-detail-row)').length, notice: /no administrator role/.test(text()) };
        [...document.querySelectorAll('main button')].find(b => /^Failed/.test(b.textContent))?.click();
        out.jobs.failedOnly = [...document.querySelectorAll('main .scan-dt')][0]?.querySelectorAll('tbody tr:not(.scan-detail-row)').length;
        out.jobs.controls = [...document.querySelectorAll('main .scan-dt')].pop()?.querySelectorAll('tbody tr').length;
        out.jobs.buttons = buttons();
        scanJobsState.filter = 'all';
        navigate('/admin/scanner/data');
        [...document.querySelectorAll('main button')].find(b => /^Only series/.test(b.textContent))?.click();
        out.data = { weekdays: /weekdays/.test(text()), series: /MATCH/.test(text()) && /FLAT/.test(text()), notice: /no administrator role/.test(text()) };
        navigate('/admin/scanner/delivery');
        const ch = [...document.querySelectorAll('main .scan-dt')][0];
        out.delivery = { channels: ch ? [...ch.querySelectorAll('tbody tr')].map(tr => tr.cells[0].textContent + ':' + tr.cells[1].textContent) : [],
                         records: [...document.querySelectorAll('main .scan-dt')][1]?.querySelectorAll('tbody tr').length || 0, buttons: buttons() };
        return out;
      } finally { restore(); navigate('/learn'); }
    })()`);
    const p = [];
    const o = r.overview;
    if (!o.notice || !o.failed || !o.partial || !o.retry || !o.controls || !o.ingest) p.push(`overview: ${JSON.stringify({ ...o, buttons: undefined })}`);
    if (r.jobs.runs !== 12 || r.jobs.failedOnly !== 1 || r.jobs.controls !== 6 || !r.jobs.notice) p.push(`runs page: ${JSON.stringify(r.jobs)}`);
    if (!r.data.weekdays || !r.data.series || !r.data.notice) p.push(`data health: ${JSON.stringify(r.data)}`);
    if (r.delivery.channels.join() !== 'In-app:active,Email:not configured,Telegram:not configured,Web push:not configured' || r.delivery.records !== 1) p.push(`delivery: ${JSON.stringify(r.delivery)}`);
    const acting = [...o.buttons, ...r.jobs.buttons, ...r.delivery.buttons].filter(b => !/^(Copy|Open your files…|Show \d+ more|(All|Completed|Partial|Failed|Cancelled|Skipped|Pending or running|Other) \(\d+\))$/.test(b));
    if (acting.length) p.push(`controls that act: ${acting.join(', ')}`);
    if (p.length) fail('the operations pages render the worker files read-only', p);
    else ok('the operations pages render the worker files read-only — from the committed fixtures: the no-administrator notice on each, the failed and partial runs by id with the exact retry command, twelve runs (one of every status the worker writes) filtering to one failure, six control-log entries, the last ingestion, data health on weekday calendars, four channels with only in-app active, and no button that does anything but copy, filter or open');
  }

  /* EMPTY STATES. With no scanner file at all — the deployed site — every
     ops page says which file is absent and what writes it; none is near
     empty or prints a raw value. The loader itself ran (scanOpsRead). */
  {
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      const loaded = scanOpsRead === true || !!(realStatus && !realStatus.ok);
      try {
        scanHistoryFile = null; scanSetupsFile = null; scanAlertsFile = null; scanRunsFile = null; scanControlFile = null; scanDeliveriesFile = null; ingestRunsFile = null; scanOpsRead = true; scanOpsClock = null;
        const out = { loaded, pages: {} };
        for (const p of ['/app/scanner', '/app/scanner/market', '/app/scanner/backtest', '/admin/scanner', '/admin/scanner/data', '/admin/scanner/jobs', '/admin/scanner/delivery']) {
          navigate(p);
          const t = document.querySelector('main').innerText;
          out.pages[p] = { len: t.length, absent: /absent|No price history is loaded|No scan has been recorded|no setups file|No setup available/i.test(t),
                           raw: /undefined|NaN|\\[object Object\\]|null–null/.test(t) };
        }
        return out;
      } finally { restore(); navigate('/learn'); }
    })()`);
    const p = [];
    if (!r.loaded) p.push('the loader never marked the scanner files as read');
    for (const [k, v] of Object.entries(r.pages)) if (v.len < 600 || !v.absent || v.raw) p.push(`${k}: ${JSON.stringify(v)}`);
    if (p.length) fail('the scanner pages state which file is absent', p);
    else ok(`the scanner pages state which file is absent — ${Object.keys(r.pages).length} pages with no scanner file at all each say what is missing and what writes it, and print no raw value`);
  }

  /* ---- round 3: user ---- */
  /* PHASE 3 ROUND 3 — user: the alert history under an injected record of
     250, id collisions, an alert evaluated again, the builder's doors and
     examples, the session's indicator cache, and watchlists resolved by
     export. The alerts file arrives through the browser's own request
     interception, so the loader reads it as it reads the real one; every
     other file is set in memory. Everything is put back afterwards. */
  {
    const r3events = [];
    const r3listen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') r3events.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0]); };
    ws.addEventListener('message', r3listen);
    const { readFileSync: r3read } = await import('node:fs');
    const { loadEngine: r3load } = await import('./scanner/scan.mjs');
    const R3E = await r3load();
    /* 250 records: five symbols of fifty each, three setups, eighty
       sessions, so most bars carry several records and the order's
       tie-breaks (detection time, then file order) are exercised. Closes
       have nothing to do with the order. */
    const r3days = [];
    for (let d = '2026-01-05'; r3days.length < 80; d = R3E.scanAddDays(d, 1)) if (R3E.scanWeekday(d) >= 1 && R3E.scanWeekday(d) <= 5) r3days.push(d);
    const r3alerts = Array.from({ length: 250 }, (_, i) => {
      const setupId = ['qa-r3-a', 'qa-r3-b', 'qa-r3-c'][i % 3], symbol = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'][Math.floor(i / 50)], bar = r3days[(i * 13) % 80];
      const key = R3E.scanKey(setupId, 1, symbol, '1D', bar, 'MATCH');
      return { id: R3E.scanAlertId(key), key, setupId, setupName: `QA ${setupId}`, setupVersion: 1, symbol, market: null, timeframe: '1D', candleDate: bar, bar,
        detectedAt: `${R3E.scanAddDays(bar, 1)}T0${i % 7}:00:00Z`, eventType: 'MATCH', close: Math.round((50 + ((i * 7919) % 1000) / 7) * 100) / 100,
        engine: `scan ${R3E.SCAN_VERSION}`, rules: [] };
    });
    /* The order, stated independently of the page: bar descending, then
       detection time descending, then the file's own order. */
    const r3order = r3alerts.map((a, i) => ({ a, i })).sort((x, y) => y.a.candleDate.localeCompare(x.a.candleDate) || y.a.detectedAt.localeCompare(x.a.detectedAt) || x.i - y.i).map(x => x.a.id);
    const r3count = (f) => r3alerts.filter(f).length;
    const body = Buffer.from(JSON.stringify({ alerts: r3alerts, lastRun: null })).toString('base64');
    const r3fulfil = (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Fetch.requestPaused') send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body }, sessionId);
    };
    try {
      ws.addEventListener('message', r3fulfil);
      await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/scan-alerts.json*', requestStage: 'Request' }] }, sessionId);
      await send('Page.reload', {}, sessionId);
      await waitFiled();

      /* SC-310 2 — THE HISTORY PAGE UNDER 250 RECORDS. Page 2 exists and
         holds the next fifty in order; setup, symbol and the bar range
         (held in the address) each narrow the set to the count the record
         gives; a range that is not a date bounds nothing and says so; the
         date field applies when left, not while it is typed; and permuting
         every close across the record leaves the order exactly as it was. */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          const keep = { pr: localStorage.getItem('vl.scanPrefs'), as: localStorage.getItem('vl.scanAlertState') };
          localStorage.removeItem('vl.scanPrefs'); localStorage.removeItem('vl.scanAlertState');
          const main = () => document.querySelector('main');
          const ids = () => [...main().querySelectorAll('table.scan-alerts-t tbody a')].map(a => a.getAttribute('href')).filter(h => h.includes('/app/scanner/alerts/')).map(h => decodeURIComponent(h.split('/').pop().split('?')[0]));
          const showing = () => { const m = main().innerText.match(/Showing (\\d+)–(\\d+) of (\\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
          const out = { loaded: scanAlertList().length };
          navigate('/app/scanner/alerts'); await w(250);
          out.p1 = { showing: showing(), ids: ids() };
          [...main().querySelectorAll('button')].find(b => b.textContent.trim() === 'Next').click(); await w(250);
          out.p2 = { showing: showing(), ids: ids(), q: location.search };
          navigate('/app/scanner/alerts?setup=qa-r3-b'); await w(200); out.setup = showing();
          navigate('/app/scanner/alerts?symbol=CCC'); await w(200); out.symbol = showing();
          navigate('/app/scanner/alerts?from=2026-02-02&to=2026-02-27'); await w(200);
          out.range = { showing: showing(), bars: [...main().querySelectorAll('table.scan-alerts-t tbody tr')].map(tr => tr.cells[2].textContent), says: /Bars between 2026-02-02 and 2026-02-27, inclusive/.test(main().innerText) };
          navigate('/app/scanner/alerts?setup=qa-r3-a&symbol=AAA&from=2026-02-02'); await w(200); out.both = showing();
          navigate('/app/scanner/alerts?from=2026-13-45'); await w(200); out.bad = { showing: showing(), says: /not a date/.test(main().innerText) };
          navigate('/app/scanner/alerts'); await w(200);
          const inp = main().querySelector('input[aria-label="Bar to"]');
          inp.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '2026-03-06');
          inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); await w(120);
          out.typing = location.search;
          inp.blur(); await w(250);
          out.blurred = { q: location.search, showing: showing() };
          navigate('/app/scanner/alerts'); await w(200);
          const before = scanAlertsInOrder().map(scanAlertIdOf);
          const list = scanAlertList(), closes = list.map(a => a.close);
          list.forEach((a, i) => { a.close = closes[list.length - 1 - i] * (1 + (i % 5)); });
          navigate('/app/scanner/alerts?page=1'); await w(200);
          out.permuted = { same: JSON.stringify(scanAlertsInOrder().map(scanAlertIdOf)) === JSON.stringify(before), p1: ids() };
          list.forEach((a, i) => { a.close = closes[i]; });
          [['vl.scanPrefs', keep.pr], ['vl.scanAlertState', keep.as]].forEach(([k, v]) => { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
          return out;
        })()`);
        const p = [];
        const inRange = (a, f, t) => (!f || a.candleDate >= f) && (!t || a.candleDate <= t);
        if (r.loaded !== 250) p.push(`the loader read ${r.loaded} records from the intercepted file, not 250`);
        if (JSON.stringify(r.p1.showing) !== '[1,50,250]' || JSON.stringify(r.p1.ids) !== JSON.stringify(r3order.slice(0, 50))) p.push(`page 1: ${JSON.stringify(r.p1.showing)}, order ${r.p1.ids.slice(0, 3)} vs ${r3order.slice(0, 3)}`);
        if (JSON.stringify(r.p2.showing) !== '[51,100,250]' || !/page=2/.test(r.p2.q) || JSON.stringify(r.p2.ids) !== JSON.stringify(r3order.slice(50, 100))) p.push(`page 2: ${JSON.stringify(r.p2.showing)} at "${r.p2.q}"`);
        if (r.setup?.[2] !== r3count(a => a.setupId === 'qa-r3-b')) p.push(`setup filter: ${JSON.stringify(r.setup)}`);
        if (r.symbol?.[2] !== 50) p.push(`symbol filter: ${JSON.stringify(r.symbol)}`);
        const nRange = r3count(a => inRange(a, '2026-02-02', '2026-02-27'));
        if (r.range.showing?.[2] !== nRange || !r.range.says || r.range.bars.some(b => b < '2026-02-02' || b > '2026-02-27') || r.range.bars.join() !== [...r.range.bars].sort().reverse().join()) p.push(`range: ${JSON.stringify(r.range.showing)} vs ${nRange}, says ${r.range.says}`);
        if (r.both?.[2] !== r3count(a => a.setupId === 'qa-r3-a' && a.symbol === 'AAA' && inRange(a, '2026-02-02', null))) p.push(`combined filters: ${JSON.stringify(r.both)}`);
        if (r.bad.showing?.[2] !== 250 || !r.bad.says) p.push(`a bad date: ${JSON.stringify(r.bad)}`);
        if (/to=/.test(r.typing) || !/to=2026-03-06/.test(r.blurred.q) || r.blurred.showing?.[2] !== r3count(a => inRange(a, null, '2026-03-06'))) p.push(`the date field: while typed "${r.typing}", when left "${r.blurred.q}" ${JSON.stringify(r.blurred.showing)}`);
        if (!r.permuted.same || JSON.stringify(r.permuted.p1) !== JSON.stringify(r3order.slice(0, 50))) p.push('permuting the closes moved the order');
        if (p.length) fail('round 3 user: the alert history pages, filters and orders 250 injected records by date alone', p);
        else ok(`round 3 user: the alert history pages, filters and orders 250 injected records by date alone — read through the loader from an intercepted data/scan-alerts.json; pages of 50 with page 2 in the address holding records 51–100 in bar, detection, file order; setup, symbol and a bar range held in the address narrow to ${r.setup[2]}, 50 and ${nRange}; a bad date bounds nothing and says so; the date applies when the field is left; permuting every close leaves the order unchanged`);
      }

      /* NAV 1 — AN ID TWO RECORDS SHARE. Given two records with different
         keys and one id, the address lists both rather than showing the
         first; each opens by its key and names the other; the history
         page's rows carry the key; and nothing is marked read until one
         record is actually opened. */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          const keepFile = scanAlertsFile, keepSt = localStorage.getItem('vl.scanAlertState');
          localStorage.removeItem('vl.scanAlertState');
          const list = scanAlertList(), x = list[3], y0 = list[4];
          const y = { ...y0, id: x.id };
          scanAlertsFile = { ...keepFile, alerts: list.map(a => (a === y0 ? y : a)) };
          const main = () => document.querySelector('main');
          const out = {};
          navigate('/app/scanner/alerts/' + x.id); await w(200);
          out.card = { view: State.view, says: /2 records share the id/.test(main().innerText), links: [...main().querySelectorAll('.scan-collision a')].map(a => a.getAttribute('href')), status: scanAlertStatus(x) };
          navigate(out.card.links.map(h => h.replace(location.origin, '')).find(h => h.includes(encodeURIComponent(y.key))) || '/'); await w(200);
          out.second = { view: State.view, h1: main().querySelector('h1')?.textContent || '', note: /shared by 2 records/.test(main().innerText), other: main().innerText.includes(x.key), status: scanAlertStatus(x) };
          out.paths = [scanAlertPath(x), scanAlertPath(y), scanAlertPath(list[5])];
          navigate('/app/scanner/alerts?status=ALL&symbol=' + x.symbol + '&from=' + x.candleDate + '&to=' + x.candleDate); await w(200);
          out.row = [...main().querySelectorAll('table.scan-alerts-t tbody a')].map(a => a.getAttribute('href')).find(h => h.includes(x.id)) || '';
          out.keys = { x: x.key, y: y.key, yBar: y.candleDate };
          scanAlertsFile = keepFile;
          if (keepSt == null) localStorage.removeItem('vl.scanAlertState'); else localStorage.setItem('vl.scanAlertState', keepSt);
          return out;
        })()`);
        const p = [];
        if (r.card.view !== 'scannerAlert' || !r.card.says || r.card.links.length !== 2 || !r.card.links.every(h => /\?key=/.test(h)) || r.card.status !== 'NEW') p.push(`the shared id: ${JSON.stringify(r.card)}`);
        if (r.second.view !== 'scannerAlert' || !r.second.h1.includes(r.keys.yBar) || !r.second.note || !r.second.other || r.second.status !== 'READ') p.push(`the second record by its key: ${JSON.stringify(r.second)}`);
        if (!r.paths[0].includes(`?key=${encodeURIComponent(r.keys.x)}`) || !r.paths[1].includes(`?key=${encodeURIComponent(r.keys.y)}`) || r.paths[2].includes('?key=')) p.push(`addresses: ${JSON.stringify(r.paths)}`);
        if (!r.row.includes(`?key=${encodeURIComponent(r.keys.x)}`)) p.push(`the history row's link: ${r.row}`);
        if (p.length) fail('round 3 user: an alert id two records share lists both, and each opens by its key', p);
        else ok('round 3 user: an alert id two records share lists both, and each opens by its key — the address alone gives a card naming both with their keys (nothing marked read); each record opens by its key and links the other; only colliding records carry ?key= in their address, on the history page too');
      }
    } finally {
      await send('Fetch.disable', {}, sessionId);
      ws.removeEventListener('message', r3fulfil);
      /* The real record back, as the loader would read it. */
      await evaluate(`(async () => { scanAlertsFile = await fetchJson(dataUrl('scan-alerts.json')).catch(() => null); return true; })()`).catch(() => null);
    }

    /* The fixture files for the rest, as the round 2 checks set them: an
       EVERY_MATCH setup and the fixture's tree replayed over the fixture
       history, plus one 0.2 record with no id. */
    const r3Seed = `(() => {
      window.__r3keep = window.__r3keep || { h: scanHistoryFile, s: scanSetupsFile, a: scanAlertsFile, d: scanDraft, ds: scanDraftSeed, dl: scanDownload, cf: window.confirm,
        st: localStorage.getItem('vl.scanSetups'), as: localStorage.getItem('vl.scanAlertState'), pr: localStorage.getItem('vl.scanPrefs') };
      ['vl.scanSetups', 'vl.scanAlertState', 'vl.scanPrefs'].forEach(k => localStorage.removeItem(k));
      const fx = scanFixture();
      const above = { id: 'qa-above', name: 'QA close above SMA5', version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D',
        cooldownMode: 'EVERY_MATCH', cooldownBars: 0, ruleTree: { type: 'group', logic: 'ALL', children: [
          { type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'sma', n: 5 } }] } };
      let alerts = [];
      Object.keys(fx.history.series.MATCH).sort().slice(20).forEach(d => {
        alerts = alerts.concat(scanRun([above, fx.setupV2], fx.history, { existing: alerts, asOf: d, now: scanReplayNow(d), runId: 'run-' + d, origin: 'replay' }).alerts);
      });
      alerts.push({ key: 'old-setup|MATCH|daily|2026-02-02', setupId: 'old-setup', setupName: 'A 0.2 setup', symbol: 'MATCH', timeframe: 'daily', bar: '2026-02-02',
        close: 101.2, recordedAt: '2026-02-03T01:00:00Z', rules: [{ text: 'price above SMA20', met: true }], engine: 'scan 0.2.0' });
      scanHistoryFile = fx.history; scanAlertsFile = { alerts, lastRun: null }; scanSetupsFile = { setups: [above, fx.setupV2] };
      scanDraft = null; scanEditDraft = null; scanDraftSeed = null;
      scanAdoptFromFile('qa-above');
      return { tree: alerts.find(a => a.setupId === 'fixture-breakout-v2' && a.eventType === 'NEW_MATCH').id, legacy: scanAlertIdOf(alerts[alerts.length - 1]) };
    })()`;
    const r3Restore = `(() => { const k = window.__r3keep; if (!k) return true;
      scanHistoryFile = k.h; scanSetupsFile = k.s; scanAlertsFile = k.a; scanDraft = k.d; scanDraftSeed = k.ds; scanEditDraft = null; scanDownload = k.dl; window.confirm = k.cf;
      [['vl.scanSetups', k.st], ['vl.scanAlertState', k.as], ['vl.scanPrefs', k.pr]].forEach(([n, v]) => { if (v == null) localStorage.removeItem(n); else localStorage.setItem(n, v); });
      delete window.__r3keep; navigate('/research'); return true; })()`;
    const r3Helpers = `const w = (ms) => new Promise(r => setTimeout(r, ms));
      const main = () => document.querySelector('main');
      const q = (lab) => [...main().querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label') === lab);
      const set = (n, v) => { const proto = n.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
      const btn = (re) => [...main().querySelectorAll('button')].find(b => re.test(b.textContent.trim()));`;
    try {
      /* SC-310 1 AND 3 — AN ALERT, EVALUATED AGAIN. The fixture's tree
         alert: its recorded values equal EMA50, the 20-bar volume average,
         relative volume and RSI14 computed afresh on the history cut at the
         bar (to 1e-9); it "Reproduces"; the sparkline draws the closes up
         to the bar and no further; the volume on the bar is the record's,
         or — on a record that predates the field — the history's, labelled
         so. "Build a setup from this one" opens the builder on a copy with
         the record's hash. With the bar's close altered in the history, the
         page says the history has changed, that it does not reproduce, and
         names that bar with both closes, and a correction logged after
         detection by its date. A record carrying C2's fields states them. */
      {
        const r = await evaluate(`(async () => {
          ${r3Helpers}
          const { tree } = ${r3Seed};
          const a = scanAlertList().find(x => x.id === tree);
          navigate('/app/scanner/alerts/' + tree); await w(250);
          const cut = scanTruncateHistory(scanHistoryFile, a.candleDate);
          const bars = scanBars(cut, 'MATCH', { market: a.market, now: a.detectedAt, calendar: scanCalendar(cut, scanRegistryList(), a.market) });
          const at = bars.dates.length - 1;
          const v = (spec) => scanIndicator(spec, bars, { at }).value;
          const c = Object.fromEntries(a.matchedConditions.map(m => [m.path, m]));
          const near = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
          const spark = main().querySelector('svg.spark');
          const t1 = main().innerText;
          const out = {
            values: near(c['1'].right, v({ indicator: 'ema', n: 50 })) && near(c['2.1'].right, v({ indicator: 'volume_avg', n: 20 }) * 1.5) && near(c['2.2'].left, v({ indicator: 'rvol', n: 20 })) && near(c['3'].left, v({ indicator: 'rsi', n: 14 })),
            reproduces: /^Reproduces\\./.test(main().querySelector('.scan-reproduce')?.textContent || ''),
            spark: { pts: spark ? (spark.querySelector('path').getAttribute('d').match(/[ML]/g) || []).length : 0, want: Math.min(60, at + 1), last: bars.dates[at] === a.candleDate,
              caption: /nothing after the bar is drawn/.test(t1) && t1.includes('up to and including ' + a.candleDate) },
            volume: 'barVolume' in a ? /2200\\s+as the record holds it/.test(t1) : /Not on the record, which predates the field\\. The history as loaded holds 2200 for this bar now/.test(t1),
            build: [...main().querySelectorAll('a')].find(x => /Build a setup from this one/.test(x.textContent))?.getAttribute('href') || '',
          };
          navigate('/app/scanner/setups/new?fromAlert=' + tree); await w(250);
          out.draft = { id: scanDraft.id, name: scanDraft.name, hash: scanHash(scanCanonical(scanDraftSetup(scanDraft))) === a.setupHash, note: /Started from the setup that recorded MATCH on/.test(main().innerText) };
          const base = scanHistoryFile;
          const alt = JSON.parse(JSON.stringify(base));
          alt.series.MATCH[a.candleDate] = 103.9;
          const earlier = Object.keys(alt.series.MATCH).sort()[10];
          alt.corrections = { MATCH: [{ date: earlier, field: 'close', from: 99, to: alt.series.MATCH[earlier], src: 'qa-import', at: '2099-01-01T00:00:00Z' }] };
          scanHistoryFile = alt;
          navigate('/app/scanner/alerts/' + tree + '?v=alt'); await w(250);
          const t2 = main().innerText;
          out.altered = { changed: /has changed since this was recorded/.test(t2), differs: /^Does not reproduce\\./.test(main().querySelector('.scan-reproduce')?.textContent || ''),
            named: t2.includes(a.candleDate + ' — recorded 104.5, now 103.9'), corrected: t2.includes(earlier + ' — corrected') };
          scanHistoryFile = base;
          const c2 = { ...a, id: 'a0c2c2c2c', key: a.key + '|qa-c2', barVolume: null, historyGenerated: '2026-04-07T01:02:03Z', gapBefore: true, gapText: 'the session of 2026-04-03 is not held',
            universeResolvedFrom: { source: 'export', exportedAt: '2026-04-06T20:00:00Z' } };
          scanAlertsFile = { ...scanAlertsFile, alerts: [...scanAlertList(), c2] };
          navigate('/app/scanner/alerts/a0c2c2c2c'); await w(250);
          const t3 = main().innerText;
          out.c2 = { none: /none held/.test(t3) && /not a volume of nought/.test(t3), gap: /across a gap/.test(t3) && t3.includes('the session of 2026-04-03 is not held'),
            exported: t3.includes('your export of 2026-04-06 20:00'), generated: t3.includes('2026-04-07 01:02') };
          navigate('/app/scanner/alerts?status=ALL'); await w(200);
          out.c2.row = /new match · across a gap/.test(main().innerText);
          return out;
        })()`);
        const p = [];
        if (!r.values) p.push('the recorded values differ from EMA50, the volume average, RVOL or RSI14 computed on the history cut at the bar');
        if (!r.reproduces) p.push('no "Reproduces" line');
        if (r.spark.pts !== r.spark.want || !r.spark.last || !r.spark.caption) p.push(`sparkline: ${JSON.stringify(r.spark)}`);
        if (!r.volume) p.push('volume on the bar not stated as the record or the history holds it');
        if (!/\/app\/scanner\/setups\/new\?fromAlert=a[0-9a-f]{8}$/.test(r.build)) p.push(`build link: ${r.build}`);
        if (r.draft.id !== 'fixture-breakout-v2-copy' || r.draft.name !== 'Copy of Fixture breakout (tree)' || !r.draft.hash || !r.draft.note) p.push(`built draft: ${JSON.stringify(r.draft)}`);
        if (!r.altered.changed || !r.altered.differs || !r.altered.named || !r.altered.corrected) p.push(`altered history: ${JSON.stringify(r.altered)}`);
        if (Object.values(r.c2).some(x => x !== true)) p.push(`C2 fields: ${JSON.stringify(r.c2)}`);
        if (p.length) fail('round 3 user: an alert is evaluated again on the history cut at its bar, and the changes are named', p);
        else ok(`round 3 user: an alert is evaluated again on the history cut at its bar, and the changes are named — its values equal EMA50, the volume average, RVOL and RSI14 to 1e-9 and it reproduces; the sparkline draws the ${r.spark.want} closes up to the bar and no further; volume on the bar is stated; "Build a setup from this one" opens a copy with the record's hash; an altered close reads "changed", "does not reproduce", and names the bar with both closes and a later correction by date; barVolume null, historyGenerated, universeResolvedFrom and gapBefore are each stated`);
      }

      /* C5, SC-316 1 — THE BUILDER'S DOORS. ?market= gives a market
         universe; ?from= a copy under a new id and "Copy of …", its tree the
         setup's, combined with ?market=; the same address again keeps what
         was typed; a different address over a changed draft asks, and "Keep
         my draft" keeps it; the company page's ?from=<company>&symbol= opens
         on the symbol with no complaint; an unknown setup and a record with
         no copy of its setup say why the draft is blank. */
      {
        const r = await evaluate(`(async () => {
          ${r3Helpers}
          const { legacy } = ${r3Seed};
          const out = {};
          navigate('/app/scanner/setups/new?market=MY'); await w(200);
          out.market = { u: scanDraft.universe, sel: q('Market')?.value || null };
          navigate('/app/scanner/setups/new?from=qa-above&market=US'); await w(200);
          const src = scanRecordSetup(scanStoreRead().setups['qa-above']);
          out.copy = { id: scanDraft.id, name: scanDraft.name, u: scanDraft.universe, tree: JSON.stringify(scanDraft.ruleTree) === JSON.stringify(src.ruleTree), mode: scanDraft.cooldownMode,
            note: /Started from QA close above SMA5 \\(saved here, v1\\)/.test(main().innerText) && /as the link asked/.test(main().innerText) };
          set(q('Name'), 'Mine'); await w(50);
          navigate('/app/scanner/alerts'); await w(150);
          navigate('/app/scanner/setups/new?from=qa-above&market=US'); await w(200);
          out.kept = q('Name')?.value;
          navigate('/app/scanner/setups/new?market=MY'); await w(200);
          out.ask = { card: !!main().querySelector('.scan-seed-ask'), name: scanDraft.name };
          btn(/^Keep my draft$/).click(); await w(200);
          out.keep = { card: !!main().querySelector('.scan-seed-ask'), name: scanDraft.name, u: scanDraft.universe.kind };
          navigate('/app/scanner/setups/new?from=qa-above'); await w(200);
          btn(/^Start from this link$/).click(); await w(200);
          out.started = { name: scanDraft.name, u: scanDraft.universe.kind };
          navigate('/my/scanner?from=AAPL-SEC&symbol=AAPL'); await w(250);
          out.company = { view: State.view, u: scanDraft.universe, blank: /No setup/.test(main().innerText) };
          navigate('/app/scanner/setups/new?from=nope'); await w(200);
          out.nope = /No setup “nope” is saved here/.test(main().innerText);
          navigate('/app/scanner/setups/new?fromAlert=' + legacy); await w(200);
          out.legacy = /predates engine 0.3.0 and carries no copy of its setup/.test(main().innerText) && scanDraft.id === '';
          return out;
        })()`);
        const p = [];
        if (JSON.stringify(r.market.u) !== '{"kind":"market","market":"MY"}' || r.market.sel !== 'MY') p.push(`?market=MY: ${JSON.stringify(r.market)}`);
        if (r.copy.id !== 'qa-above-copy' || r.copy.name !== 'Copy of QA close above SMA5' || JSON.stringify(r.copy.u) !== '{"kind":"market","market":"US"}' || !r.copy.tree || r.copy.mode !== 'EVERY_MATCH' || !r.copy.note) p.push(`?from=&market=: ${JSON.stringify(r.copy)}`);
        if (r.kept !== 'Mine') p.push(`the same address again lost the typed name (${r.kept})`);
        if (!r.ask.card || r.ask.name !== 'Mine' || r.keep.card || r.keep.name !== 'Mine' || r.keep.u !== 'market') p.push(`a new address over a changed draft: ${JSON.stringify([r.ask, r.keep])}`);
        if (r.started.name !== 'Copy of QA close above SMA5' || r.started.u !== 'all') p.push(`"Start from this link": ${JSON.stringify(r.started)}`);
        if (r.company.view !== 'scannerSetupNew' || JSON.stringify(r.company.u) !== '{"kind":"symbols","symbols":["AAPL"]}' || r.company.blank) p.push(`the company page's link: ${JSON.stringify(r.company)}`);
        if (!r.nope || !r.legacy) p.push(`unknown setup ${r.nope}, legacy record ${r.legacy}`);
        if (p.length) fail('round 3 user: the builder starts from ?market=, ?from= and ?fromAlert=, and never drops a changed draft', p);
        else ok('round 3 user: the builder starts from ?market=, ?from= and ?fromAlert=, and never drops a changed draft — a market universe; a copy under qa-above-copy and "Copy of …" with the setup\'s tree, on the market the link names; the same address keeps typing; a different one asks, and keeps the draft when told; the company page\'s ?from=&symbol= opens on the symbol; an unknown setup and a record with no copy each say why the draft is blank');
      }

      /* SC-305 4, SC-317 1 — START FROM AN EXAMPLE; NO INTRADAY OPTION.
         The select offers every committed example, labelled not a
         suggestion; choosing the rule-tree one loads it (read-only nested
         tree) and keeps focus on the select; over a changed draft it asks,
         and a refusal keeps the draft. "Copy example configuration" is the
         file's rule-tree example, disabled. The timeframe select offers
         1D and 1W and shows 1H, 15M and 5M disabled. */
      {
        const exIds = JSON.parse(r3read(new URL('./scanner/setups.example.json', import.meta.url), 'utf8')).setups.map(s => s.id);
        const r = await evaluate(`(async () => {
          ${r3Helpers}
          ${r3Seed};
          navigate('/app/scanner/setups/new?'); await w(200);
          const sel = q('Start from an example');
          const out = { options: [...sel.options].map(o => o.value).filter(Boolean), caption: /not a suggestion/.test(sel.closest('.card').innerText) };
          const tf = q('Timeframe');
          out.tf = { on: [...tf.options].filter(o => !o.disabled).map(o => o.value), off: [...tf.options].filter(o => o.disabled).map(o => o.value + ':' + /not available/.test(o.textContent)) };
          set(sel, 'trend-breakout-tree'); await w(250);
          out.tree = { name: scanDraft.name, nested: !scanTreeIsFlat(scanDraft.ruleTree), readOnly: !!q('Replace the nested conditions with one group'),
            note: /an illustration of the syntax, not a suggestion/.test(main().innerText), focus: document.activeElement?.getAttribute('aria-label') };
          set(q('Name'), 'Changed'); await w(50);
          window.confirm = () => false;
          set(q('Start from an example'), 'rsi-below-30'); await w(200);
          out.refused = { name: scanDraft.name, sel: q('Start from an example').value };
          window.confirm = () => true;
          set(q('Start from an example'), 'rsi-below-30'); await w(200);
          out.replaced = { name: scanDraft.name, left: scanDraft.ruleTree.children[0].left.indicator, op: scanDraft.ruleTree.children[0].op };
          /* A draft set by another page (as "New setup on this list" does)
             is not the example's: its words are not shown over it, and a
             link that would replace it asks first. */
          scanDraft = { ...scanBlankDraft(), name: 'From elsewhere' };
          navigate('/app/scanner/setups/new?'); await w(200);
          out.foreign = { notes: !!main().querySelector('.scan-seed-notes'), name: scanDraft.name };
          navigate('/app/scanner/setups/new?market=US'); await w(200);
          out.foreign.ask = !!main().querySelector('.scan-seed-ask');
          out.copyDoc = { n: SCAN_EXAMPLE_DOC.setups.length, disabled: SCAN_EXAMPLE_DOC.setups.every(s => s.enabled === false),
            same: JSON.stringify(SCAN_EXAMPLE_DOC.setups.map(s => ({ ...s, enabled: null }))) === JSON.stringify(SCAN_EXAMPLES.setups.filter(s => s.ruleTree).map(s => ({ ...s, enabled: null }))) };
          return out;
        })()`);
        const p = [];
        if (r.options.join() !== exIds.join() || !r.caption) p.push(`the examples offered: ${r.options.join()} (file: ${exIds.join()}), labelled ${r.caption}`);
        if (r.tf.on.join() !== '1D,1W,1M' || r.tf.off.join() !== '1H:true,15M:true,5M:true') p.push(`timeframes: ${JSON.stringify(r.tf)}`);
        if (r.tree.name !== 'Trend breakout, written as a rule tree' || !r.tree.nested || !r.tree.readOnly || !r.tree.note || r.tree.focus !== 'Start from an example') p.push(`the rule-tree example: ${JSON.stringify(r.tree)}`);
        /* fixwave: shell (SCN-05) — the picker shows the example the draft
           was started from, so a refusal puts it back to that, not to "Choose
           an example…". */
        if (r.refused.name !== 'Changed' || r.refused.sel !== 'trend-breakout-tree') p.push(`refusing kept ${JSON.stringify(r.refused)}`);
        if (r.replaced.name !== 'RSI below 30' || r.replaced.left !== 'rsi' || r.replaced.op !== 'LESS_THAN') p.push(`replacing: ${JSON.stringify(r.replaced)}`);
        if (r.foreign.notes || r.foreign.name !== 'From elsewhere' || !r.foreign.ask) p.push(`a draft set by another page: ${JSON.stringify(r.foreign)}`);
        if (r.copyDoc.n !== 1 || !r.copyDoc.disabled || !r.copyDoc.same) p.push(`the example configuration: ${JSON.stringify(r.copyDoc)}`);
        if (p.length) fail('round 3 user: the builder starts from a committed example, and offers no intraday timeframe', p);
        else ok(`round 3 user: the builder starts from a committed example, and offers no intraday timeframe — all ${r.options.length} examples of scanner/setups.example.json, labelled an illustration and not a suggestion; the rule tree loads read-only with focus kept on the select; a changed draft is replaced only when the reader agrees; "Copy example configuration" is the file's rule-tree example, disabled; 1D, 1W and 1M (weeks and months from the daily bars) are the only enabled timeframes, 1H, 15M and 5M shown as not available`);
      }

      /* SC-303 4 — ONE CACHE FOR THE SESSION. "Evaluate now" computes the
         series; the builder's Test of a copy of the same setup on the same
         history computes none and reuses them, from the same cache; a
         changed close is computed afresh. */
      {
        const r = await evaluate(`(async () => {
          ${r3Helpers}
          ${r3Seed};
          const nums = () => { const m = (main().querySelector('.scan-cache-line')?.textContent || '').match(/Indicators: (\\d+) computed, (\\d+) reused/); return m ? [+m[1], +m[2]] : null; };
          navigate('/app/scanner/setups'); await w(200);
          const C0 = scanPageCache();
          btn(/^Evaluate this browser/).click(); await w(200);
          const out = { evaluate: nums() };
          navigate('/app/scanner/setups/new?from=qa-above'); await w(200);
          btn(/^Test against your history/).click(); await w(200);
          out.test = nums();
          out.same = scanPageCache() === C0;
          /* On a clock at the fixture's last bar, so nothing is stale and
             both sides of the condition are read: once to fill the cache,
             then with one close changed, then unchanged again. */
          const alt = JSON.parse(JSON.stringify(scanHistoryFile));
          const last = Object.keys(alt.series.MATCH).sort().pop();
          alt.series.MATCH[last] += 1;
          const setup = [scanRecordSetup(scanStoreRead().setups['qa-above'])];
          scanRunHere(setup, scanHistoryFile, { instruments: [], now: scanReplayNow(last) });
          const again = scanRunHere(setup, alt, { instruments: [], now: scanReplayNow(last) });
          const same = scanRunHere(setup, scanHistoryFile, { instruments: [], now: scanReplayNow(last) });
          out.changed = again.sessionCache; out.unchanged = same.sessionCache;
          return out;
        })()`);
        const p = [];
        if (!r.evaluate || !(r.evaluate[0] > 0)) p.push(`Evaluate now: ${JSON.stringify(r.evaluate)}`);
        if (!r.test || r.test[0] !== 0 || !(r.test[1] > 0) || !r.same) p.push(`Test after it: ${JSON.stringify(r.test)}, same cache ${r.same}`);
        if (!(r.changed.misses > 0) || r.unchanged.misses !== 0) p.push(`a changed close: ${JSON.stringify(r.changed)}; unchanged: ${JSON.stringify(r.unchanged)}`);
        if (p.length) fail('round 3 user: "Evaluate now" and the builder\'s Test share one indicator cache for the session', p);
        else ok(`round 3 user: "Evaluate now" and the builder's Test share one indicator cache for the session — Evaluate computed ${r.evaluate[0]} series, the Test of a copy computed none and reused ${r.test[1]}, from the same cache; a changed close is computed afresh (${r.changed.misses} computed) where the same history computes nothing`);
      }

      /* SC-311 1 — A WATCHLIST RESOLVED FROM THE EXPORT (page side, C3).
         The builder offers the snapshot or "your latest export", worded as
         the export and not as the browser; "Export for the scanner" writes
         watchlists.json in watchlistsExport()'s own shape and the page
         records when; the setup saves with resolve 'export' and its
         snapshot; switching back to the snapshot is a new version; a list
         changed since the export says so; the scanner's watchlists page and
         the watchlists page both offer the export. */
      {
        const r = await evaluate(`(async () => {
          ${r3Helpers}
          ${r3Seed};
          const lists = State.watchlists || [];
          /* A list with a member that has a symbol: an empty one is refused
             by the builder, rightly, and other checks leave lists behind. */
          const w0 = lists.find(l => watchlistSymbols(l.id).symbols.length);
          if (!w0) return { none: true };
          let got = null;
          scanDownload = (name, doc) => { got = { name, doc }; };
          const radio = (l) => [...main().querySelectorAll('input[type=radio]')].find(x => x.getAttribute('aria-label') === 'Resolve the list from: ' + l);
          navigate('/app/scanner/setups/new?'); await w(200);
          set(q('Name'), 'QA export list'); await w(50);
          set(q('Universe'), 'watchlist'); await w(200);
          set(q('Watchlist'), w0.id); await w(200);
          const out = { radios: !!radio('The list as you save it') && !!radio('Your latest export for the scanner') && radio('The list as you save it').checked,
            never: /Not exported for the scanner from this browser/.test(main().innerText) };
          radio('Your latest export for the scanner').click(); await w(100);
          out.wording = /resolved from your latest export — the worker cannot read this browser/.test(main().innerText) && /The worker resolves the list from your latest export of it/.test(main().innerText);
          q('Export for the scanner (watchlists.json)').click(); await w(200);
          out.download = got && { name: got.name, kind: got.doc.kind, lists: got.doc.watchlists.map(x => x.id).join() === lists.map(x => x.id).join(),
            shape: JSON.stringify(Object.keys(got.doc)) === JSON.stringify(Object.keys(watchlistsExport())), symbols: got.doc.watchlists[0].items.some(i => i.symbol) };
          out.recorded = !!got && scanStoreRead().watchlistsExported?.at === got.doc.exportedAt && /as the list stands now/.test(main().innerText);
          out.pre = { list: w0.name, status: main().querySelector('.scan-status')?.textContent || '', problems: [...main().querySelectorAll('.scan-problems-all li')].map(l => l.textContent) };
          const sb = btn(/^Save$/);
          out.pre.button = sb ? { label: sb.getAttribute('aria-label'), disabled: sb.disabled, connected: sb.isConnected } : null;
          out.pre.id = scanDraft?.id;
          sb?.click(); await w(250);
          out.pre.after = { path: location.pathname, view: State.view, keys: Object.keys(scanStoreRead().setups) };
          const rec = scanStoreRead().setups['qa-export-list'];
          out.saved = rec ? { v: rec.current, resolve: rec.versions[0].setup.universe.resolve, snap: (rec.versions[0].setup.universe.symbols || []).length, asOf: !!rec.versions[0].setup.universe.asOf } : null;
          if (!rec) return out;
          navigate('/app/scanner/watchlists'); await w(200);
          out.page = { chip: /resolved from your latest export/.test(main().innerText), card: /The lists file the worker reads/.test(main().innerText) && /Last exported for the scanner from this browser/.test(main().innerText) };
          navigate('/app/scanner/setups/qa-export-list/edit'); await w(200);
          radio('The list as you save it').click(); await w(100);
          out.status = main().querySelector('.scan-status')?.textContent || '';
          btn(/^Save \\(new version\\)$/).click(); await w(250);
          const rec2 = scanStoreRead().setups['qa-export-list'];
          out.v2 = { v: rec2.current, resolves: rec2.versions.map(x => x.setup.universe.resolve || 'snapshot').join() };
          const st = scanStoreRead(); st.watchlistsExported.lists[w0.id].symbols = st.watchlistsExported.lists[w0.id].symbols.slice(1); scanStoreWrite(st);
          const ch = scanWatchlistExportState(w0.id);
          out.changed = ch.state === 'CHANGED' && /1 added/.test(ch.text);
          got = null;
          navigate('/my/watchlists'); await w(300);
          q('Export for the scanner (watchlists.json)')?.click(); await w(100);
          out.myPage = got?.name || null;
          return out;
        })()`);
        const p = [];
        if (r.none) p.push('the test profile holds no watchlist with a member that has a symbol');
        else {
          if (!r.radios || !r.never || !r.wording) p.push(`the resolve choice: ${JSON.stringify({ radios: r.radios, never: r.never, wording: r.wording })}`);
          if (!r.download || r.download.name !== 'watchlists.json' || r.download.kind !== 'quantum-tradeworks-watchlists' || !r.download.lists || !r.download.shape || !r.download.symbols || !r.recorded) p.push(`the export: ${JSON.stringify(r.download)}, recorded ${r.recorded}`);
          if (!r.saved || r.saved.v !== 1 || r.saved.resolve !== 'export' || !r.saved.snap || !r.saved.asOf) p.push(`saved: ${JSON.stringify(r.saved)} — before saving: ${JSON.stringify(r.pre)}`);
          if (r.saved && (!r.page.chip || !r.page.card)) p.push(`the watchlist scanner page: ${JSON.stringify(r.page)}`);
          if (r.saved && (!/saving creates v2/.test(r.status) || r.v2.v !== 2 || r.v2.resolves !== 'export,snapshot')) p.push(`back to the snapshot: "${r.status}", ${JSON.stringify(r.v2)}`);
          if (r.saved && !r.changed) p.push('a list changed since the export is not reported');
          if (r.saved && r.myPage !== 'watchlists.json') p.push(`the watchlists page's export: ${r.myPage}`);
        }
        if (p.length) fail('round 3 user: a watchlist setup can resolve from the scanner export, and says what that means', p);
        else ok('round 3 user: a watchlist setup can resolve from the scanner export, and says what that means — "resolved from your latest export — the worker cannot read this browser"; "Export for the scanner" writes watchlists.json in watchlistsExport()\'s shape and is recorded; the setup saves with resolve export and its snapshot; back to the snapshot is v2; a list changed since the export is named; both watchlist pages offer the export');
      }
    } finally {
      await evaluate(r3Restore).catch(() => null);
    }
    ws.removeEventListener('message', r3listen);
    if (r3events.length) fail('round 3 user: the scanner pages threw', r3events.slice(0, 5));
    else ok('round 3 user: the scanner pages ran every round 3 check above with no exception');
  }
  /* ---- end round 3: user ---- */

  /* ---- round 3: data ---- */
  /* THE DATA PAGE ON A HISTORY WITH EVERYTHING WRONG IN IT: a gap, a zero
     close, an unrecorded 2-for-1 split, a series dated a day early, a
     session held under two dates, and a series at the store's keep. The page
     names each; the split is ticked, the drafted file is "saved", and the
     page and the Node engine then agree the split is adjusted — the same
     scanRun, byte for byte, before and after. Then the loader itself, with
     the two files served by the browser's own interception. */
  {
    const { loadEngine } = await import('./scanner/scan.mjs');
    const NE = await loadEngine();
    const wdays = (from, n) => { const out = []; for (let d = from; out.length < n; d = NE.scanAddDays(d, 1)) { const w = NE.scanWeekday(d); if (w > 0 && w < 6) out.push(d); } return out; };
    const D = wdays('2026-01-05', 40);
    const at = (dates, f) => Object.fromEntries(dates.map((d, i) => [d, f(i)]));
    const K = wdays('2018-06-04', 2000);
    const hist = { schema: 2, generated: '2026-03-01T00:00:00.000Z', series: {
      GAPS: at(D.filter((_, i) => i < 20 || i > 22), (i) => 50 + (i % 3)),
      ZERO: at(D, (i) => (i === 15 ? 0 : 20 + (i % 4) / 10)),
      SPLT: at(D, (i) => (i >= 25 ? (100 + i / 10) / 2 : 100 + i / 10)),
      SHFT: Object.fromEntries(D.map((d, i) => [NE.scanAddDays(d, -1), 70 + (i % 5)])),
      DUPL: { ...at(D, (i) => 30 + i / 10), '2026-01-10': 30.4 },
      KEEP: at(K, (i) => 10 + (i % 50) / 10),
    } };
    const setup = { id: 'r3-rsi', version: 1, name: 'RSI held', enabled: true, universe: { kind: 'symbols', symbols: ['SPLT'] }, timeframe: '1D',
      confirmationMode: 'BAR_CLOSE', cooldownMode: 'EVERY_MATCH', cooldownBars: 0, expires: null,
      ruleTree: { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'rsi', n: 14 }, op: 'BETWEEN', range: [{ value: 0 }, { value: 100 }] }] } };
    const now = NE.scanReplayNow(D[39]);
    const adjDoc = { schema: 1, actions: [{ symbol: 'SPLT', date: D[25], ratio: 2, kind: 'split' }] };
    const nodeBefore = JSON.stringify(NE.scanRun([setup], NE.scanAttachAdjustments(hist, null), { now, runId: 'r3', origin: 'r3' }));
    const nodeAfter = JSON.stringify(NE.scanRun([setup], NE.scanAttachAdjustments(hist, adjDoc), { now, runId: 'r3', origin: 'r3' }));
    const r = await evaluate(`(async () => {
      const keep = { h: scanHistoryFile, a: scanAdjustmentsFile, k: scanOpsClock, read: scanOpsRead };
      const hist = ${JSON.stringify(hist)}, setup = ${JSON.stringify(setup)}, now = ${JSON.stringify(now)};
      const out = {};
      const main = () => document.querySelector('main');
      const table = (cap) => [...main().querySelectorAll('table')].find(t => t.caption?.textContent === cap);
      const rows = (cap) => Object.fromEntries([...(table(cap)?.tBodies[0]?.rows || [])].map(tr => [tr.cells[0].textContent.trim(), [...tr.cells].map(c => c.textContent.trim())]));
      const tileSub = (label) => [...main().querySelectorAll('.stat')].find(s => s.querySelector('.stat-label')?.textContent === label)?.querySelector('.stat-sub')?.textContent || null;
      try {
        scanAdjDraft.clear();
        scanAdjustmentsFile = null; scanHistoryFile = scanAttachAdjustments(hist, null); scanOpsClock = now; scanOpsRead = true;
        out.runBefore = JSON.stringify(scanRun([setup], scanHistoryFile, { now, runId: 'r3', origin: 'r3' }));
        navigate('/admin/scanner/data');
        [...main().querySelectorAll('button')].find(b => /^Only series/.test(b.textContent))?.click();
        const ser = rows('Health per series');
        out.series = { zero: ser.ZERO?.[4] || '', gaps: ser.GAPS?.[5] || '', splt: ser.SPLT?.[6] || '', keep: ser.KEEP?.[9] || '' };
        out.shifted = rows('Series whose weekdays are shifted').SHFT?.[3] || '';
        out.dupl = Object.keys(rows('Sessions held under two dates'));
        out.weekend = Object.keys(rows('Weekend-dated bars per market'));
        out.breakSub = tileSub('Price breaks');
        out.breakState = rows('Price breaks and what explains each').SPLT?.[4] || '';
        out.fileLine = /data\\/price-adjustments\\.json — absent/.test(main().innerText);
        const tick = [...main().querySelectorAll('button')].find(b => b.textContent === 'split 2-for-1 (ratio 2)');
        tick?.click();
        const draft = scanAdjDraftDoc(now);
        out.draft = { pressed: document.getElementById(tick?.id)?.getAttribute('aria-pressed'), focus: document.activeElement?.id === tick?.id, added: draft.added,
                      actions: draft.doc.actions.map(a => [a.symbol, a.date, a.ratio, a.kind].join('|')),
                      download: [...main().querySelectorAll('button')].find(b => b.textContent === 'Download price-adjustments.json')?.disabled === false };
        /* The file saved beside the history and the page reloaded, as the loader would attach it. */
        scanAdjustmentsFile = JSON.parse(JSON.stringify(draft.doc));
        scanHistoryFile = scanAttachAdjustments(hist, scanAdjustmentsFile);
        out.runAfter = JSON.stringify(scanRun([setup], scanHistoryFile, { now, runId: 'r3', origin: 'r3' }));
        navigate('/admin/scanner/data');
        out.after = { state: rows('Price breaks and what explains each').SPLT?.[4] || '', sub: tileSub('Price breaks'),
                      recorded: rows('Recorded corporate actions').SPLT?.[4] || '', line: /price-adjustments\\.json — 1 action read \\(adj:[0-9a-f]{8}\\)/.test(main().innerText) };
        return out;
      } finally {
        scanHistoryFile = keep.h; scanAdjustmentsFile = keep.a; scanOpsClock = keep.k; scanOpsRead = keep.read; scanAdjDraft.clear(); navigate('/learn');
      }
    })()`);
    const p = [];
    const before = JSON.parse(r.runBefore), after = JSON.parse(r.runAfter);
    if (r.runBefore !== nodeBefore || r.runAfter !== nodeAfter) p.push('the page\'s scanRun on the injected history differs from the Node engine\'s, before or after the adjustment');
    if (before.alerts.length || !before.untestedList.some(u => /no recorded adjustment explains/.test(u.why)) || after.alerts.length !== 1 || !/\+adj:[0-9a-f]{8}$/.test(after.alerts[0].dataVersion))
      p.push(`the split: before ${before.alerts.length} alert(s), after ${after.alerts.length} (${after.alerts[0]?.dataVersion})`);
    if (!/NEG_PRICE/.test(r.series.zero) || !/^1 counted/.test(r.series.gaps) || !/split 2-for-1; unexplained/.test(r.series.splt) || r.series.keep !== 'at the 2,000-bar keep')
      p.push(`series table: ${JSON.stringify(r.series)}`);
    if (!/a day early — the whole series/.test(r.shifted) || r.dupl.join() !== 'DUPL' || !r.weekend.length) p.push(`dating: shifted "${r.shifted}", held twice ${r.dupl}, weekend ${r.weekend}`);
    if (r.breakSub !== '1 unexplained' || !/unexplained/.test(r.breakState) || !r.fileLine) p.push(`breaks: tile "${r.breakSub}", state "${r.breakState}", file line ${r.fileLine}`);
    if (r.draft.pressed !== 'true' || !r.draft.focus || r.draft.added !== 1 || r.draft.actions.join() !== `SPLT|${D[25]}|2|split` || !r.draft.download) p.push(`draft: ${JSON.stringify(r.draft)}`);
    if (!/adjusted/.test(r.after.state) || r.after.sub !== '0 unexplained' || !/^applied/.test(r.after.recorded) || !r.after.line) p.push(`after saving: ${JSON.stringify(r.after)}`);
    if (p.length) fail('round 3 data: the data page names a gap, a zero close, a split, a shifted series and a session held twice, and the recorded split is applied the same way in the page and in Node', p);
    else ok(`round 3 data: the data page names a gap, a zero close, a split, a shifted series and a session held twice, and the recorded split is applied the same way in the page and in Node — the keep reads ${r.series.keep}; ticking the split drafts ${r.draft.actions[0]}; saved, the break reads adjusted, the RSI setup untested before records one match after, with a +adj data version, byte-identical to scanRun in Node`);
  }
  /* ONE 52-WEEK RANGE. Where the history holds highs and lows, every caller
     of the trend context hands them over, so the range is the high of the
     range and not the highest close: the derived metric (15-derivation), the
     momentum refresh (25-universe), the company page's trend drawer
     (45-views-research) and the Tracked view's (60-trend). */
  {
    const r = await evaluate(`(async () => {
      const keepT = trackedHistory;
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const out = {};
      try {
        const dates = [];
        for (let d = new Date(Date.UTC(2025, 0, 6)); dates.length < 300; d = new Date(d.getTime() + 864e5)) { const k = d.getUTCDay(); if (k > 0 && k < 6) dates.push(d.toISOString().slice(0, 10)); }
        const close = (i) => 100 + Math.sin(i / 7) * 10 + i * 0.02;
        const s = Object.fromEntries(dates.map((d, i) => [d, close(i)]));
        const o = Object.fromEntries(dates.map((d, i) => [d, [close(i), close(i) + 3, close(i) - 3]]));
        const inst = (instruments?.instruments || []).find(x => x.symbol && !BY_ID.has(String(x.symbol).toUpperCase() + '-SEC'))?.symbol;
        trackedHistory = { series: { AAPL: s, [inst]: s }, ohlc: { AAPL: o, [inst]: o } };
        const hi = Math.max(...dates.slice(-252).map(d => o[d][1])), closeHi = Math.max(...dates.slice(-252).map(d => s[d]));
        out.want = (close(299) / hi - 1) * 100; out.closeWant = (close(299) / closeHi - 1) * 100;
        const row = U.find(x => x.c.id === 'AAPL-SEC');
        out.obs = realSeriesFor(row.c)?.ohlc === trackedHistory.ohlc.AAPL;
        out.derive = derive(row.c).m.from52;
        refreshMomentum(); out.refresh = row.m.from52;
        const drawerText = async (open) => { closeDrawer({ restore: false }); await w(250); open(); await w(400); const t = drawer.innerText; closeDrawer({ restore: false }); await w(250); return t; };
        navigate('/company/AAPL-SEC'); await w(500);
        out.company = await drawerText(() => [...document.querySelectorAll('main button')].find(b => /Full trend detail/.test(b.textContent))?.click());
        navigate('/my/tracked'); await w(500);
        out.tracked = await drawerText(() => document.querySelector('main td[aria-label="Trend detail for ' + inst + '"]')?.click());
        out.inst = inst;
        return out;
      } finally { trackedHistory = keepT; refreshMomentum(); navigate('/learn'); }
    })()`);
    const p = [];
    const near = (a, b) => Number.isFinite(a) && Math.abs(a - b) < 1e-9;
    if (!r.obs) p.push('realSeriesFor does not hand over the symbol\'s highs and lows');
    if (!near(r.derive, r.want) || !near(r.refresh, r.want)) p.push(`from52: derive ${r.derive}, refresh ${r.refresh}; want ${r.want} (the closing high gives ${r.closeWant})`);
    if (!/from the high of/.test(r.company) || /highest close/.test(r.company)) p.push(`the company page's trend drawer: ${(r.company.match(/[^\n]*(high of|highest close)[^\n]*/) || [''])[0].slice(0, 120)}`);
    if (!/from the high of/.test(r.tracked) || /highest close/.test(r.tracked)) p.push(`the Tracked view's drawer for ${r.inst}: ${(r.tracked.match(/[^\n]*(high of|highest close)[^\n]*/) || [''])[0].slice(0, 120)}`);
    if (p.length) fail('round 3 data: every trend-context caller reads the 52-week range from highs and lows where the history holds them', p);
    else ok(`round 3 data: every trend-context caller reads the 52-week range from highs and lows where the history holds them — the derived and refreshed distance from the high are ${r.want.toFixed(4)}% (not the closing high's ${r.closeWant.toFixed(4)}%), and the company and Tracked drawers say "from the high of"`);
  }

  /* THE LOADER. data/price-history.json and data/price-adjustments.json
     served by the browser's own interception on a fresh load: the scanner's
     copy of the history carries the recorded actions, the trend context's
     keeps the closes as captured, and the data page says what was read. */
  {
    const events = [];
    const listen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Fetch.requestPaused') events.push(m); };
    ws.addEventListener('message', listen);
    const d0 = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-12'];
    const files = {
      'price-history.json': { schema: 2, generated: '2026-01-13T00:00:00.000Z', series: { SPLT: Object.fromEntries(d0.map((d, i) => [d, i >= 3 ? 50 + i : 100 + i])) } },
      'price-adjustments.json': { schema: 1, actions: [{ symbol: 'SPLT', date: '2026-01-08', ratio: 2, kind: 'split', note: 'served by the harness' }] },
    };
    let served = 0;
    const answer = async () => {
      for (let i = 0; i < 120 && served < 2; i++) {
        const m = events.find(x => !x.seen);
        if (!m) { await sleep(100); continue; }
        m.seen = true;
        const name = Object.keys(files).find(f => m.params.request.url.includes(`/data/${f}`));
        if (!name) { await send('Fetch.continueRequest', { requestId: m.params.requestId }, sessionId); continue; }
        await send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify(files[name])).toString('base64') }, sessionId);
        served++;
      }
    };
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/price-history.json*', requestStage: 'Request' }, { urlPattern: '*/data/price-adjustments.json*', requestStage: 'Request' }] }, sessionId);
    let r = null;
    try {
      await send('Page.navigate', { url: `${BASE}/admin/scanner/data` }, sessionId);
      await answer();
      for (let i = 0; i < 80 && !r; i++) {
        await sleep(250);
        try { r = await evaluate(`typeof scanOpsRead !== 'undefined' && scanOpsRead && typeof scanHistoryFile !== 'undefined' && scanHistoryFile ? {
          version: scanHistoryFile.adjustmentVersion, actions: (scanHistoryFile.adjustments || []).length, fileActions: scanAdjustmentsFile?.actions?.length ?? null,
          tracked: trackedHistory?.series?.SPLT?.['2026-01-05'] ?? null, scanned: scanBars(scanHistoryFile, 'SPLT').closes[0],
          sameEngine: scanAttachAdjustments(${JSON.stringify(files['price-history.json'])}, ${JSON.stringify(files['price-adjustments.json'])}).adjustmentVersion } : null`); } catch { /* booting */ }
      }
      if (r) { await sleep(600); r.line = await evaluate(`/price-adjustments\\.json — 1 action read/.test(document.querySelector('main')?.innerText || '')`); }
    } finally {
      await send('Fetch.disable', {}, sessionId);
      await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
      ws.removeEventListener('message', listen);
      await send('Page.navigate', { url: `${BASE}/learn` }, sessionId);
      await waitFiled();
    }
    const p = [];
    if (served < 2) p.push(`only ${served} of the two files were requested`);
    if (!r) p.push('the page never finished loading the scanner files');
    else {
      if (!/^adj:[0-9a-f]{8}$/.test(r.version || '') || r.version !== r.sameEngine || r.actions !== 1 || r.fileActions !== 1) p.push(`scanner history: ${JSON.stringify(r)}`);
      if (r.tracked !== 100 || r.scanned !== 50) p.push(`closes: the trend context holds ${r.tracked} (want 100, as captured), the scanner reads ${r.scanned} (want 50, adjusted)`);
      if (!r.line) p.push('the data page does not say the adjustments file was read');
    }
    if (p.length) fail('round 3 data: the loader attaches data/price-adjustments.json to the scanner\'s history', p);
    else ok(`round 3 data: the loader attaches data/price-adjustments.json to the scanner's history — served by interception on a fresh load, the scanner reads the split adjusted (${r.version}) while the trend context keeps the closes as captured, and the data page says one action was read`);
  }
  /* ---- end round 3: data ---- */

  /* ---- round 3: ops ---- */
  /* THE OPERATIONS PAGES READ THE RUN RECORD THE WORKER WRITES (SC-313 item
     3; contract C4). The committed fixture is now the worker's own shape —
     scanner-test holds its keys to a real run — so this fails if a page goes
     back to reading the plan's shape: the counts must come out of
     run.counts, the history out of historyNewest and historyHash, the
     problems out of errors[], and each round 3 addition must be read where
     the run carries it and called "not recorded" where it does not. */
  {
    const { readFileSync } = await import('node:fs');
    const fx = (f) => readFileSync(new URL(`./scanner/fixtures/${f}`, import.meta.url), 'utf8');
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const f = scanFixture();
        const runsDoc = ${fx('scan-runs.fixture.json')};
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setup, f.setupV2] }; scanAlertsFile = { alerts: scanRun([f.setup], f.history, { now: f.now }).alerts };
        scanRunsFile = runsDoc; scanControlFile = null; scanDeliveriesFile = null; ingestRunsFile = null;
        scanOpsClock = '2026-04-07T09:00:00.000Z'; scanOpsRead = true; scanJobsState.filter = 'all';
        const out = {};
        const dd = (root, label) => { const dt = root ? [...root.querySelectorAll('dt')].find(d => d.textContent === label) : null; return dt ? dt.nextElementSibling.textContent : null; };
        const card = (title) => [...document.querySelectorAll('main section.card')].find(c => c.querySelector('.h-card')?.textContent === title) || null;
        navigate('/admin/scanner');
        const eng = card('Alert engine'), cache = card('Indicator cache'), errs = card('Errors');
        out.engine = { sub: eng?.textContent || '', evaluated: dd(eng, 'Evaluated'), matched: dd(eng, 'Matched'), recorded: dd(eng, 'Recorded'), continuing: dd(eng, 'Still matching (not new)'),
          delivered: dd(eng, 'Delivered in the app'), notReady: dd(eng, 'Markets not ready'), caught: dd(eng, 'Caught up'), ledger: dd(eng, 'Version ledger') };
        out.cache = { value: dd(cache, 'Last run’s cache'), from: dd(cache, 'Read from') };
        out.errors = [...(errs?.querySelectorAll('tbody tr') || [])].map(tr => [...tr.cells].map(td => td.textContent));
        navigate('/admin/scanner/jobs');
        const shownRows = () => [...document.querySelectorAll('main tr.scan-detail-row')].filter(x => getComputedStyle(x).display !== 'none').length;
        out.closedShown = shownRows();
        document.querySelectorAll('main details').forEach(d => { d.open = true; });
        await w(30);
        out.openShown = shownRows();
        const table = document.querySelector('main .scan-dt');
        /* Each run's detail is the full-width row under it, shown while its
           disclosure is open. */
        out.jobs = [...(table?.querySelectorAll(':scope > tbody > tr:not(.scan-detail-row)') || [])].map(tr => {
          const det = tr.nextElementSibling?.classList.contains('scan-detail-row') ? tr.nextElementSibling : null;
          return { id: det?.querySelector('dd code')?.textContent, status: tr.cells[1].textContent, counts: tr.cells[5].textContent, shown: !!det && getComputedStyle(det).display !== 'none',
                   detail: tr.cells[6].textContent + ' ' + (det?.textContent || ''), history: dd(det, 'History'), cache: dd(det, 'Indicator cache'), notReady: dd(det, 'Markets not ready') };
        });
        out.filters = [...document.querySelectorAll('main [aria-label="Filter runs by status"] button')].map(b => b.textContent);
        const log = [...document.querySelectorAll('main .scan-dt')].pop();
        out.log = [...(log?.querySelectorAll('tbody tr') || [])].map(tr => [...tr.cells].map(td => td.textContent).join(' | '));
        /* A worker from before round 3: no C4 field on any run, and the
           cache figures only in the alerts file's lastRun. */
        const bare = JSON.parse(JSON.stringify(runsDoc));
        bare.runs.forEach(x => { delete x.cacheStats; delete x.skippedMarkets; delete x.catchUp; delete x.ledger; });
        scanRunsFile = bare;
        scanAlertsFile = { ...scanAlertsFile, lastRun: { at: '2026-04-06T22:00:01.380Z', runId: 'run-20260406T220000-4102-9a55', cacheStats: { hits: 7, misses: 5 } } };
        navigate('/admin/scanner');
        const eng2 = card('Alert engine'), cache2 = card('Indicator cache');
        out.fallback = { cache: dd(cache2, 'Last run’s cache'), from: dd(cache2, 'Read from'), caught: dd(eng2, 'Caught up'), ledger: dd(eng2, 'Version ledger'), notReady: dd(eng2, 'Markets not ready'),
                         evaluated: dd(eng2, 'Evaluated') };
        return out;
      } finally { restore(); scanJobsState.filter = 'all'; navigate('/learn'); }
    })()`);
    const p = [];
    const e = r.engine;
    if (e.evaluated !== '4 setup × instrument pairs, 2 setups' || e.matched !== '2' || e.recorded !== '1' || e.continuing !== '1' || !/^1 — /.test(e.delivered || '')) p.push(`alert engine counts: ${JSON.stringify({ ...e, sub: undefined })}`);
    if (!e.sub.includes('run-20260406T220000-4102-9a55') || !e.sub.includes('The latest attempt, run-20260407T085958-4311-4f08, was pending and evaluated nothing')) p.push(`alert engine source: ${e.sub.slice(0, 260)}`);
    if (!/^2 setup × instrument pairs caught up over 3 bars since each one’s last evaluated bar; no pair reached the cap$/.test(e.caught || '')
      || e.ledger !== '2 versions already in the ledger · 0 recorded for the first time · 0 refused' || !/^none — /.test(e.notReady || '')) p.push(`round 3 additions: ${JSON.stringify({ caught: e.caught, ledger: e.ledger, notReady: e.notReady })}`);
    if (r.cache.value !== '26 reused, 12 computed' || !(r.cache.from || '').includes('run-20260406T220000-4102-9a55')) p.push(`indicator cache: ${JSON.stringify(r.cache)}`);
    const errRows = Object.fromEntries(r.errors.map(c => [c[1], c]));
    const failedRow = errRows['run-20260402T220000-3870-9f3a'], partialRow = errRows['run-20260403T220000-3977-6e41'], cancelledRow = errRows['run-20260402T210000-3811-c40f'];
    if (r.errors.length !== 3 || !failedRow || !partialRow || !cancelledRow) p.push(`errors panel rows: ${r.errors.map(c => `${c[1]} ${c[2]}`).join('; ')}`);
    else {
      if (failedRow[3] !== 'IO' || !failedRow[4].includes('[run-20260402T220000-3870-9f3a/e1]') || failedRow[5] !== 'node scanner/scan.mjs --retry run-20260402T220000-3870-9f3a') p.push(`failed row: ${failedRow.join(' | ')}`);
      if (partialRow[3] !== 'DATA' || !partialRow[4].includes('untested everywhere') || !/^not needed/.test(partialRow[5])) p.push(`partial row: ${partialRow.join(' | ')}`);
      if (cancelledRow[3] !== 'CANCELLED') p.push(`cancelled row: ${cancelledRow.join(' | ')}`);
    }
    const job = Object.fromEntries(r.jobs.map(j => [j.id, j]));
    const done = job['run-20260406T220000-4102-9a55'], part = job['run-20260403T220000-3977-6e41'], paused = job['run-20260401T220000-3760-1b9e'], running = job['run-20260405T220000-4020-e9d0'];
    if (r.jobs.length !== 12 || !done || !part || !paused || !running) p.push(`runs table: ${r.jobs.length} rows, ids ${r.jobs.map(j => j.id).join(', ')}`);
    else {
      if (!r.jobs.every(j => j.shown)) p.push(`an opened run's detail row is not shown: ${r.jobs.filter(j => !j.shown).map(j => j.id).join(', ')}`);
      if (r.closedShown !== 0 || r.openShown !== 12) p.push(`detail rows shown: ${r.closedShown} while closed, ${r.openShown} of 12 once opened`);
      if (done.counts !== '4 evaluated · 2 matched · 1 recorded' || done.history !== 'newest bar 2026-04-06 · sha256:bf9784399709a381' || done.cache !== '26 reused, 12 computed') p.push(`completed run: ${JSON.stringify({ counts: done.counts, history: done.history, cache: done.cache })}`);
      if (!part.detail.includes('DATA: fixture-breakout-v2: untested everywhere') || !part.detail.includes('held only as a provisional bar') || !/^MY — the session of 2026-04-03/.test(part.notReady || '')) p.push(`partial run: ${part.detail.slice(0, 400)}`);
      if (paused.counts !== 'none — skipped before evaluating' || !paused.detail.includes('paused since 2026-03-31') || paused.history !== 'not read — the run ended before it read the history') p.push(`paused run: ${JSON.stringify({ counts: paused.counts, history: paused.history })}`);
      if (!running.detail.includes('It is either running now, or its process ended')) p.push(`running run: ${running.detail.slice(0, 200)}`);
      if (r.jobs.some(j => /not recorded/.test(j.counts))) p.push(`a run's counts read "not recorded": ${r.jobs.filter(j => /not recorded/.test(j.counts)).map(j => j.id).join(', ')}`);
    }
    ['All (12)', 'Completed (3)', 'Partial (1)', 'Failed (1)', 'Cancelled (1)', 'Skipped (4)', 'Pending or running (2)'].forEach(b => { if (!r.filters.includes(b)) p.push(`no filter "${b}" (${r.filters.join(', ')})`); });
    if (r.log.length !== 6 || !r.log.some(l => l.includes('a run took the lock over, its holder over an hour old')) || !r.log.some(l => l.includes('removed the lock (dead)'))
      || !r.log.some(l => l.includes('replayed 2026-04-03: completed, 0 added, 0 already recorded')) || !r.log.every(l => l.includes('reader on this-pc'))) p.push(`control log: ${r.log.join(' // ').slice(0, 500)}`);
    if (p.length) fail('ops pages read the worker\'s run record (C4)', p);
    else ok('ops pages read the worker\'s run record (C4) — the alert engine from run.counts of the last run that evaluated (4 pairs, 2 matched, 1 recorded, 1 delivered), naming the pending attempt after it; the cache from the run; catch-up, ledger and markets not ready from the round 3 fields; the errors panel from errors[] with correlation ids; each run\'s history from historyNewest and historyHash; a filter per status; the control log in words, with the machine\'s account');
    const fb = r.fallback;
    if (fb.cache !== '7 reused, 5 computed' || !/alerts file’s last run/.test(fb.from || '') || [fb.caught, fb.ledger, fb.notReady].some(v => v !== 'not recorded — this worker does not write it') || !/^4 setup × instrument pairs/.test(fb.evaluated || ''))
      fail('ops pages fall back to the alerts file\'s lastRun.cacheStats and name what an older worker does not record', fb);
    else ok('ops pages fall back to the alerts file\'s lastRun.cacheStats and name what an older worker does not record — a run log with no round 3 field reads the cache from the alerts file (said so), and catch-up, the ledger and markets not ready as "not recorded — this worker does not write it", never as zero');

    /* On a phone every scanner table row is display:block, which beats the
       hidden attribute: a closed run's detail row must still be off screen,
       and open under its run when asked. */
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    let ph;
    try {
      ph = await evaluate(`(async () => {
        ${opsKeep} ${opsWait}
        try {
          scanRunsFile = ${fx('scan-runs.fixture.json')}; scanOpsClock = '2026-04-07T09:00:00.000Z'; scanOpsRead = true; scanJobsState.filter = 'all';
          navigate('/admin/scanner/jobs');
          await w(50);
          const shown = () => [...document.querySelectorAll('main tr.scan-detail-row')].filter(x => getComputedStyle(x).display !== 'none');
          const closed = shown().length;
          const d = document.querySelector('main details.scan-row-det');
          d.open = true; await w(30);
          const open = shown();
          return { closed, open: open.length, under: open[0]?.previousElementSibling?.contains(d) || false,
                   over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        } finally { restore(); scanJobsState.filter = 'all'; navigate('/learn'); }
      })()`);
    } finally { await send('Emulation.clearDeviceMetricsOverride', {}, sessionId); }
    if (ph.closed !== 0 || ph.open !== 1 || !ph.under || ph.over > 2) fail('a run\'s detail stays closed on a phone until it is opened, under its run', ph);
    else ok('a run\'s detail stays closed on a phone until it is opened, under its run — at 390px no closed detail row is displayed, one opened shows directly beneath its run, and the page does not scroll sideways');
  }

  /* SC-316: SAVE AS A SETUP CARRIES THE SCREEN (contract C5), AND AN
     UNTESTED ROW SAYS WHY. A market screen of a setup from the file links to
     /app/scanner/setups/new?market=&from=; "everything" carries the setup
     alone; a pasted setup, not in the file, carries the market alone. A
     five-bar series is untested, and its row names the reason. */
  {
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      const keepReg = instruments;
      try {
        const fx = scanFixture();
        const h = JSON.parse(JSON.stringify(fx.history));
        const days = Object.keys(h.series.MATCH).sort().slice(-5);
        h.series.SHORT = Object.fromEntries(days.map(d => [d, 10])); h.volume.SHORT = Object.fromEntries(days.map(d => [d, 1000]));
        instruments = { ...(instruments || {}), instruments: [...((instruments && instruments.instruments) || []).filter(i => !['MATCH', 'FLAT', 'SHORT'].includes(String(i.symbol).toUpperCase())),
          { symbol: 'MATCH', market: 'US' }, { symbol: 'FLAT', market: 'US' }, { symbol: 'SHORT', market: 'US' }] };
        scanHistoryFile = h; scanSetupsFile = { setups: [fx.setup] }; scanAlertsFile = { alerts: [] }; scanOpsClock = fx.now; scanOpsRead = true;
        const screen = async (market, setupKey, pasted = null) => {
          Object.assign(scanMarketState, { market, asOf: '', result: null, setup: setupKey, pastedSetup: pasted });
          navigate('/app/scanner/market');
          const main = document.querySelector('main');
          [...main.querySelectorAll('button')].find(b => /Screen now/.test(b.textContent))?.click();
          for (let i = 0; i < 60 && !main.querySelector('.scan-coverage'); i++) await w(50);
          const link = main.querySelector('.scan-save a');
          const untested = [...main.querySelectorAll('.scan-group')].find(g => /^Untested/.test(g.querySelector('h4')?.textContent || ''));
          const cancel = [...main.querySelectorAll('button')].find(b => b.textContent.trim() === 'Cancel');
          return { search: link ? new URL(link.href).search : null, path: link ? new URL(link.href).pathname : null, text: main.querySelector('.scan-save')?.textContent || '',
                   cancelIdle: cancel ? getComputedStyle(cancel).display : 'absent',
                   untested: [...(untested?.querySelectorAll('tbody tr') || [])].map(tr => ({ sym: tr.cells[0].textContent, why: tr.cells[tr.cells.length - 1].textContent })) };
        };
        const pastedSetup = scanValidate({ setups: [{ ...fx.setup, id: 'qa-pasted' }] }).setups[0];
        return { us: await screen('US', 'file:' + fx.setup.id), all: await screen('__all', 'file:' + fx.setup.id), pasted: await screen('US', 'pasted', pastedSetup), id: fx.setup.id };
      } finally { instruments = keepReg; restore(); scanMarketState.market = '__all'; scanMarketState.setup = null; scanMarketState.pastedSetup = null; navigate('/learn'); }
    })()`);
    const p = [];
    const q = (s) => Object.fromEntries(new URLSearchParams(s || ''));
    if (r.us.path !== '/app/scanner/setups/new' || JSON.stringify(q(r.us.search)) !== JSON.stringify({ market: 'US', from: r.id })) p.push(`US screen of a file setup links to ${r.us.path}${r.us.search}`);
    if (JSON.stringify(q(r.all.search)) !== JSON.stringify({ from: r.id }) || !/cannot carry it/.test(r.all.text)) p.push(`"everything" links to ${r.all.search}: ${r.all.text}`);
    if (JSON.stringify(q(r.pasted.search)) !== JSON.stringify({ market: 'US' }) || !/paste them there/.test(r.pasted.text)) p.push(`a pasted setup links to ${r.pasted.search}: ${r.pasted.text}`);
    if (r.us.cancelIdle !== 'none') p.push(`Cancel is on screen with no screen running (display ${r.us.cancelIdle})`);
    const short = r.us.untested.find(u => u.sym === 'SHORT');
    if (!short) p.push(`the five-bar series is not untested: ${JSON.stringify(r.us.untested)}`);
    r.us.untested.forEach(u => { if (!u.why || u.why === '—' || !/\d+ held|needs|bars|stale|could not/.test(u.why)) p.push(`untested ${u.sym} names no reason: "${u.why}"`); });
    if (p.length) fail('market screening hands the builder its market and setup, and every untested row names its reason', p);
    else ok(`market screening hands the builder its market and setup, and every untested row names its reason — Save as a setup opens /app/scanner/setups/new${r.us.search} for a file setup on US, ${r.all.search} for "everything" (saying the universe is chosen there), ${r.pasted.search} for a pasted one; the untested five-bar series says "${short.why}"`);
  }

  /* NAV 1: ONLY THE COMPANY VIEWS READ :id AS A COMPANY. A route of any
     other view with a parameter called id renders its view; the company
     views still resolve an alias and still refuse an unknown company. */
  {
    const r = await evaluate(`(async () => {
      const row = { path: '/qa-guard/:id', view: 'scannerDashboard', title: 'QA guard' };
      ROUTES.push(row);
      try {
        navigate('/qa-guard/trend-breakout');
        const other = { view: State.view, what: State.notFoundWhat || null };
        navigate('/app/equities/aapl');
        const company = { view: State.view, ticker: State.ticker };
        navigate('/company/no-such-company-qa');
        const unknown = State.view;
        return { other, company, unknown };
      } finally { ROUTES.splice(ROUTES.indexOf(row), 1); navigate('/learn'); }
    })()`);
    const p = [];
    if (r.other.view !== 'scannerDashboard') p.push(`/qa-guard/trend-breakout (view scannerDashboard, param :id) rendered ${r.other.view}${r.other.what ? ` — ${r.other.what}` : ''}`);
    if (r.company.view !== 'research' || !/AAPL/.test(r.company.ticker || '')) p.push(`/app/equities/aapl: ${JSON.stringify(r.company)}`);
    if (r.unknown !== 'notfound') p.push(`/company/no-such-company-qa rendered ${r.unknown}`);
    if (p.length) fail('applyRoute resolves :id as a company only on the company views', p);
    else ok('applyRoute resolves :id as a company only on the company views — a non-company route with a parameter called id renders its own view, /app/equities/aapl still opens Apple and an unknown company is still not found');
  }

  /* SC-317: NO PAGE OF THE SCANNER CLAIMS LIVE OR REAL-TIME DATA. With the
     fixture's files loaded and every disclosure open, each scanner page's
     text is split into sentences; any sentence that says "live" or "real
     time" must be one that denies it (not built, needs, no, later …).
     wording-check does the same over the modules' strings, offline. */
  {
    const { readFileSync } = await import('node:fs');
    const fx = (f) => readFileSync(new URL(`./scanner/fixtures/${f}`, import.meta.url), 'utf8');
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const f = scanFixture();
        const alerts = scanRun([f.setup, f.setupV2], f.history, { now: f.now }).alerts;
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setup, f.setupV2] }; scanAlertsFile = { alerts };
        scanRunsFile = ${fx('scan-runs.fixture.json')}; scanControlFile = ${fx('scan-control.fixture.json')};
        scanDeliveriesFile = ${fx('scan-deliveries.fixture.json')}; ingestRunsFile = ${fx('ingest-runs.fixture.json')};
        scanOpsClock = '2026-04-07T09:00:00.000Z'; scanOpsRead = true;
        const a0 = alerts[0];
        const pages = ['/app/scanner', '/app/scanner/market', '/app/scanner/backtest', '/app/scanner/setups', '/app/scanner/setups/new', '/app/scanner/setups/' + f.setup.id,
          '/app/scanner/watchlists', '/app/scanner/alerts', a0 ? '/app/scanner/alerts/' + (a0.id || scanAlertId(a0.key)) : null, '/app/scanner/settings',
          '/admin/scanner', '/admin/scanner/data', '/admin/scanner/jobs', '/admin/scanner/delivery'].filter(Boolean);
        const out = {};
        for (const pg of pages) {
          navigate(pg);
          await w(30);
          document.querySelectorAll('main details').forEach(d => { d.open = true; });
          await w(30);
          out[pg] = { view: State.view, text: document.querySelector('main').innerText };
        }
        return out;
      } finally { restore(); navigate('/learn'); }
    })()`);
    const CLAIM = /\blive\b|\breal[\s-]?time\b|\brealtime\b/i;
    const DENY = /\b(not|no|never|cannot|neither|nor|none|needs?|without|later|blocked|waits?|unavailable|refused)\b|n’t|n't/i;
    const p = [];
    let said = 0;
    for (const [pg, v] of Object.entries(r)) {
      if (v.view === 'notfound') { p.push(`${pg} did not render`); continue; }
      v.text.split(/(?<=[.!?])\s+|\n+/).filter(s => CLAIM.test(s)).forEach(s => { said++; if (!DENY.test(s)) p.push(`${pg}: "${s.trim().slice(0, 160)}"`); });
    }
    if (p.length) fail('no scanner page claims live or real-time data', p);
    else ok(`no scanner page claims live or real-time data — ${Object.keys(r).length} scanner pages with the fixture's files loaded and every disclosure open; ${said} sentence${said === 1 ? '' : 's'} naming live or real-time data, each one denying it`);
  }
  /* ---- end round 3: ops ---- */

  /* ---- integration: round 3 ---- */
  /* OPENING YOUR OWN FILES, after the data branch. An opened history must
     carry the recorded splits as the served one does, the adjustments file
     must be openable beside it (on the deployed site nothing is served), and
     the rejects file the store writes beside the history is not a history:
     the old pattern matched it, and opening it replaced the history. */
  {
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      const keepAdj = scanAdjustmentsFile, keepOpened = scanOpsOpened;
      try {
        const f = scanFixture();
        const sym = Object.keys(f.history.series)[0];
        const firstDay = Object.keys(f.history.series[sym]).sort()[5];
        const adjDoc = { schema: 1, actions: [{ symbol: sym, date: firstDay, ratio: 2, kind: 'split' }] };
        scanAdjustmentsFile = null; scanOpsOpened = []; scanOpsRead = true;
        navigate('/admin/scanner');
        await w(80);
        const open = async (files) => {
          const input = document.querySelector('main .scan-open input[type=file]');
          if (!input) return false;
          const dt = new DataTransfer();
          files.forEach(([name, doc]) => dt.items.add(new File([JSON.stringify(doc)], name, { type: 'application/json' })));
          input.files = dt.files;
          input.dispatchEvent(new Event('change'));
          await w(150);
          return true;
        };
        const out = {};
        scanHistoryFile = f.history;
        const before = scanHistoryFile;
        out.inputFound = await open([['price-history.rejects.json', { schema: 1, rejected: [] }]]);
        out.rejectsKept = scanHistoryFile === before;
        out.rejectsSaid = /price-history\\.rejects\\.json \\(not a scanner file\\)/.test(document.querySelector('main .scan-open [role=status]')?.textContent || '');
        await open([['price-history.json', f.history]]);
        out.historyVersion = scanHistoryFile?.adjustmentVersion ?? null;
        await open([['price-adjustments.json', adjDoc]]);
        out.afterAdj = { version: scanHistoryFile?.adjustmentVersion ?? null, actions: (scanHistoryFile?.adjustments || []).length, file: !!scanAdjustmentsFile };
        await open([['price-history (1).json', f.history]]);
        out.reopened = { version: scanHistoryFile?.adjustmentVersion ?? null, actions: (scanHistoryFile?.adjustments || []).length };
        out.listed = /price-adjustments/.test(document.querySelector('main .scan-open')?.textContent || '');
        return out;
      } finally { restore(); scanAdjustmentsFile = keepAdj; scanOpsOpened = keepOpened; }
    })()`);
    const p = [];
    if (!r.inputFound) p.push('no file input on /admin/scanner');
    if (!r.rejectsKept || !r.rejectsSaid) p.push(`the rejects file was taken as the history or not named: ${JSON.stringify({ kept: r.rejectsKept, said: r.rejectsSaid })}`);
    if (r.historyVersion !== 'none') p.push(`an opened history with no adjustments file should read adjustmentVersion 'none', got ${r.historyVersion}`);
    if (!/^adj:/.test(r.afterAdj?.version || '') || r.afterAdj.actions !== 1 || !r.afterAdj.file) p.push(`opening the adjustments file did not attach it: ${JSON.stringify(r.afterAdj)}`);
    if (r.reopened?.version !== r.afterAdj?.version || r.reopened.actions !== 1) p.push(`a history opened after the adjustments lost them: ${JSON.stringify(r.reopened)}`);
    if (!r.listed) p.push('the open-files line does not name price-adjustments');
    if (p.length) fail('integration: an opened history carries the recorded splits; the rejects file is not taken for the history', p);
    else ok('integration: an opened history carries the recorded splits, the adjustments file opens beside it in either order, and price-history.rejects.json is refused as not a history');
  }
  /* ---- end integration: round 3 ---- */

  /* ---- bugfix: scanner-ops ---- */
  /* BUG HUNT — THE SCANNER'S OWN PAGES (src/js/87-scanner-ops.js), each
     check against the record the page reads or the control it drives:
     numbers the record holds read back as the record holds them, a
     sentence true of the record it is about, and focus that never falls to
     the page's body. Every file is set in memory and put back. */
  {
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const f = scanFixture();
        const out = {};
        const card = (title) => [...document.querySelectorAll('main section.card')].find(c => c.querySelector('.h-card')?.textContent === title) || null;
        const dd = (root, label) => { const dt = root ? [...root.querySelectorAll('dt')].find(d => d.textContent === label) : null; return dt ? dt.nextElementSibling.textContent : null; };
        /* Durations rounded at the unit shown; ages in calendar days. */
        out.dur = [999.6, 59960, 119600].map(scanOpsDuration);
        scanOpsClock = '2026-04-07T01:00:00Z';
        out.age = scanOpsAge('2026-04-06T23:00:00Z');
        /* One setup refused for two problems. */
        const bad = { id: 'qa-bad', name: 'QA bad', enabled: true, universe: { kind: 'all' }, timeframe: '9Z',
          ruleTree: { type: 'group', logic: 'XX', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 1 } }] } };
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setupV2, bad] }; scanAlertsFile = { alerts: [] }; scanRunsFile = null; scanControlFile = null;
        scanOpsRead = true; scanOpsClock = f.now;
        out.problems = scanValidate(scanSetupsFile).problems.length;
        navigate('/admin/scanner');
        out.usage = dd(card('Usage'), 'Active setups');
        navigate('/app/scanner');
        out.tile = document.querySelector('main .scan-q')?.innerText || '';
        /* The alerts file's last run standing in, beside a run log that
           holds one failure. */
        const doc = { setups: [f.setup] };
        const run = scanRun(doc.setups, f.history, { now: f.now });
        const a0 = run.alerts[0];
        scanSetupsFile = doc;
        scanAlertsFile = { alerts: run.alerts, lastRun: { at: f.now, asOf: run.asOf, engine: 'scan ' + SCAN_VERSION, evaluated: run.evaluated, setupsHash: scanSetupsHash(doc) } };
        const failed = { id: 'run-qa-failed', kind: 'scan', status: 'FAILED', startedAt: scanAddDays(f.lastBar, 1) + 'T00:30:00Z', error: { category: 'VALIDATION', message: 'QA' }, errors: [{ category: 'VALIDATION', message: 'QA' }] };
        scanRunsFile = { schema: 1, runs: [failed], audit: [] };
        scanOpsClock = scanAddDays(f.lastBar, 1) + 'T01:00:00Z';
        navigate('/app/scanner');
        out.legacyTile = [...document.querySelectorAll('main .scan-q')][1]?.innerText || '';
        navigate('/admin/scanner');
        out.legacyEngine = card('Alert engine')?.querySelector('.caption')?.textContent || '';
        /* Matches on the last scan's bar and on four bars before it. */
        const earlier = [1, 2, 3, 4].map(k => ({ ...a0, id: undefined, key: a0.key + '|qa' + k, candleDate: scanAddDays(a0.candleDate, -7 * k), bar: undefined }));
        const ok1 = { id: 'run-qa-ok', kind: 'scan', status: 'COMPLETED', trigger: 'daily', startedAt: f.now, finishedAt: f.now, engine: 'scan ' + SCAN_VERSION,
                      setupsHash: scanSetupsHash(doc), asOf: run.asOf, asOfFrom: run.asOf, counts: { evaluated: run.evaluated, matched: run.matched, recorded: run.alerts.length } };
        scanAlertsFile = { alerts: [...earlier, ...run.alerts] };
        scanRunsFile = { schema: 1, runs: [ok1], audit: [] }; scanOpsClock = f.now;
        navigate('/app/scanner');
        const heads = () => [...document.querySelectorAll('main h3.h-card')].map(h => h.textContent);
        out.earlier = heads().find(h => /^Earlier matches/.test(h)) || null;
        scanAlertsFile = { alerts: [...earlier, ...run.alerts] };
        scanRunsFile = { schema: 1, runs: [failed], audit: [] };
        navigate('/app/scanner');
        out.noSuccess = heads().find(h => /^Recorded matches/.test(h)) || null;
        /* An adjustments file holding only a ratio-1 record. */
        const keepAdj = scanAdjustmentsFile;
        try {
          const days = Object.keys(f.history.series.MATCH).sort();
          const h = JSON.parse(JSON.stringify(f.history));
          for (let i = 30; i < days.length; i++) h.series.MATCH[days[i]] *= 2;
          scanAdjustmentsFile = { schema: 1, actions: [{ symbol: 'MATCH', date: days[30], ratio: 1, kind: 'other' }] };
          scanHistoryFile = scanAttachAdjustments(h, scanAdjustmentsFile);
          navigate('/admin/scanner/data');
          out.adjLine = document.querySelector('main section.card .metaline')?.textContent || '';
        } finally { scanAdjustmentsFile = keepAdj; }
        return out;
      } finally { restore(); navigate('/learn'); }
    })()`);
    const p = [];
    if (r.dur.join() !== '1.0 s,1 min 0 s,2 min 0 s') p.push(`durations of 999.6 ms, 59.96 s and 119.6 s read ${r.dur.join(', ')}`);
    if (r.age !== 'a day ago') p.push(`a run at 23:00 read at 01:00 the next day is "${r.age}"`);
    if (r.problems !== 2 || !/\(of 1 valid, 1 refused\)$/.test(r.usage || '')) p.push(`one setup refused for ${r.problems} problems: Usage reads "${r.usage}"`);
    if (!/1 setup refused, for 2 problems/.test(r.tile)) p.push(`the setups tile: ${r.tile.replace(/\n+/g, ' | ')}`);
    if (/no run log is on this machine/.test(r.legacyTile) || !/no run in the run log succeeded/.test(r.legacyTile)) p.push(`with a run log of one failure, the last-success tile: ${r.legacyTile.replace(/\n+/g, ' | ')}`);
    if (/no run log is loaded/.test(r.legacyEngine) || !/no run in the run log evaluated anything/.test(r.legacyEngine)) p.push(`with a run log of one failure, the alert engine: ${r.legacyEngine.slice(0, 200)}`);
    if (r.earlier !== 'Earlier matches — the last 4 bars with one') p.push(`four earlier bars headed "${r.earlier}"`);
    if (r.noSuccess !== 'Recorded matches — no scan has succeeded, so none is current') p.push(`matches with only a failed run recorded headed "${r.noSuccess}"`);
    if (/adjusted on read/.test(r.adjLine) || !/market’s own move \(ratio 1\)/.test(r.adjLine)) p.push(`a ratio-1 record: ${r.adjLine}`);
    if (p.length) fail('bugfix scanner-ops: the scanner pages\' numbers and sentences match the records they read', p);
    else ok('bugfix scanner-ops: the scanner pages\' numbers and sentences match the records they read — 119.6 s is 2 min 0 s, a run at 23:00 read at 01:00 was a day ago, one setup refused for two problems is one refused, the alerts file standing in beside a run log of failures does not say there is no run log, four earlier bars are four, and a ratio-1 record adjusts no price');
  }
  {
    /* The run record as the worker writes it for a replay (catchUp null),
       a run the ready gate did not guard (readiness naming a market
       behind, skippedMarkets empty), a gated run that held every market
       back (counts, but no pair evaluated), and a record with no match
       count. */
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      try {
        const f = scanFixture();
        const base = { kind: 'scan', engine: 'scan ' + SCAN_VERSION, historyNewest: f.lastBar, historyHash: 'sha256:qa', setupsHash: 'qa', cacheStats: { hits: 1, misses: 1 },
                       ledger: { known: 1, newVersions: [], refused: [] }, errors: [], error: null, stale: 0, provisional: 0 };
        const t = (h) => '2026-04-07T0' + h + ':00:00.000Z';
        const runs = [
          { ...base, id: 'run-qa-plain', status: 'PARTIAL', trigger: 'manual', ready: false, startedAt: t(1), finishedAt: t(1), asOf: f.lastBar, asOfFrom: f.lastBar,
            counts: { setups: 1, evaluated: 2, matched: 0, recorded: 0 }, readiness: [{ market: 'MY', state: 'BEHIND', expected: f.lastBar, newestFinal: '2026-03-01', inRun: true, text: 'MY: behind' }],
            skippedMarkets: [], catchUp: { pairs: 0, bars: 0, capped: 0, cap: 10 } },
          { ...base, id: 'run-qa-replay', status: 'COMPLETED', trigger: 'replay', replayAsOf: '2026-04-01', startedAt: t(2), finishedAt: t(2), asOf: '2026-04-01', asOfFrom: '2026-04-01',
            counts: { setups: 1, evaluated: 2, matched: 0, recorded: 0 }, readiness: [{ market: null, state: 'READY', inRun: true }], skippedMarkets: [], catchUp: null },
          { ...base, id: 'run-qa-nocount', status: 'COMPLETED', trigger: 'manual', startedAt: t(3), finishedAt: t(3), asOf: f.lastBar, asOfFrom: f.lastBar, counts: { evaluated: 3 } },
          { ...base, id: 'run-qa-gated', status: 'PARTIAL', trigger: 'daily', ready: true, startedAt: t(4), finishedAt: t(4), asOf: null, asOfFrom: null,
            counts: { setups: 1, evaluated: 0, matched: 0, recorded: 0 }, readiness: [{ market: 'MY', state: 'BEHIND', inRun: true, text: 'MY: behind' }],
            skippedMarkets: [{ market: 'MY', reason: 'QA: not held final' }], catchUp: { pairs: 0, bars: 0, capped: 0, cap: 10 } },
        ];
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setup] }; scanAlertsFile = { alerts: [] };
        scanRunsFile = { schema: 1, runs, audit: [] }; scanOpsRead = true; scanOpsClock = t(5); scanJobsState.filter = 'all';
        const dd = (root, label) => { const dt = root ? [...root.querySelectorAll('dt')].find(d => d.textContent === label) : null; return dt ? dt.nextElementSibling.textContent : null; };
        navigate('/admin/scanner/jobs');
        const table = document.querySelector('main .scan-dt');
        const out = { jobs: {} };
        [...table.querySelectorAll(':scope > tbody > tr:not(.scan-detail-row)')].forEach(tr => {
          const det = tr.nextElementSibling;
          const id = det?.querySelector('dd code')?.textContent;
          out.jobs[id] = { counts: tr.cells[5].textContent, caught: dd(det, 'Caught up'), notReady: dd(det, 'Markets not ready') };
        });
        navigate('/admin/scanner');
        const eng = [...document.querySelectorAll('main section.card')].find(c => c.querySelector('.h-card')?.textContent === 'Alert engine');
        out.engine = { sub: eng?.querySelector('.caption')?.textContent || '', evaluated: dd(eng, 'Evaluated') };
        return out;
      } finally { restore(); scanJobsState.filter = 'all'; navigate('/learn'); }
    })()`);
    const p = [];
    const j = r.jobs;
    if (!/^none — a replay evaluates the session it was asked for \(2026-04-01\)/.test(j['run-qa-replay']?.caught || '')) p.push(`a replay's catch-up: "${j['run-qa-replay']?.caught}"`);
    if (/every market in the run was ready/.test(j['run-qa-plain']?.notReady || '') || !/MY was not ready/.test(j['run-qa-plain']?.notReady || '')) p.push(`a run not gated, with MY behind: "${j['run-qa-plain']?.notReady}"`);
    if (j['run-qa-gated']?.caught !== 'none — the run evaluated no pair') p.push(`a run that evaluated no pair: catch-up "${j['run-qa-gated']?.caught}"`);
    if (/\b0 matched|\b0 recorded/.test(j['run-qa-nocount']?.counts || '') || !/no count of matches/.test(j['run-qa-nocount']?.counts || '')) p.push(`a record with no match count: "${j['run-qa-nocount']?.counts}"`);
    if (!/^The last run that evaluated: run-qa-nocount/.test(r.engine.sub) || !/The latest attempt, run-qa-gated, was partial and evaluated nothing/.test(r.engine.sub)) p.push(`the alert engine's source: ${r.engine.sub.slice(0, 220)}`);
    if (p.length) fail('bugfix scanner-ops: a run\'s catch-up, readiness and counts say what the run record holds', p);
    else ok('bugfix scanner-ops: a run\'s catch-up, readiness and counts say what the run record holds — a replay (catchUp null) catches nothing up rather than "this worker does not write it", a run not gated names the market that was behind rather than "every market was ready", a run that evaluated no pair is not the alert engine\'s "last run that evaluated", and a missing match count is not 0');
  }
  {
    /* FOCUS, PAGING AND RUNS. Every control that takes itself away hands
       focus on; a newer run supersedes an older one; a window that ends
       before it begins, or a replay of a day not yet come, is refused. */
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      const keepOpened = scanOpsOpened, hasNote = typeof scanOpsOpenNote !== 'undefined', keepNote = hasNote ? scanOpsOpenNote : null;
      try {
        const f = scanFixture();
        const out = {};
        const act = () => { const a = document.activeElement; return !a || a === document.body ? 'BODY' : a.tagName + ':' + (a.textContent || '').trim().slice(0, 24); };
        const btn = (re) => [...document.querySelectorAll('main button')].find(b => re.test(b.textContent.trim()));
        /* Show more, with a run's detail open. */
        const mk = (i) => ({ id: 'run-qa-' + String(i).padStart(3, '0'), kind: 'scan', status: 'SKIPPED_NO_DATA', skipReason: 'qa ' + i,
                             startedAt: '2026-04-06T' + String(23 - Math.floor(i / 60)).padStart(2, '0') + ':' + String(59 - (i % 60)).padStart(2, '0') + ':00Z' });
        scanRunsFile = { schema: 1, runs: Array.from({ length: 60 }, (_, i) => mk(i)), audit: [] };
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setupV2] }; scanAlertsFile = { alerts: [] }; scanOpsRead = true; scanOpsClock = f.now; scanJobsState.filter = 'all';
        navigate('/admin/scanner/jobs');
        const firstDet = document.querySelector('main details.scan-row-det');
        firstDet.open = true; await w(20);
        const more = btn(/^Show \\d+ more$/);
        more.focus(); more.click(); await w(40);
        out.more = { active: act(), first: !!document.querySelector('main details.scan-row-det')?.open,
                     rows: document.querySelector('main .scan-dt').querySelectorAll(':scope > tbody > tr:not(.scan-detail-row)').length,
                     landed: document.activeElement?.closest('tr') === [...document.querySelector('main .scan-dt').querySelectorAll(':scope > tbody > tr:not(.scan-detail-row)')][50] };
        /* A screen and a simulation started from the keyboard, and cancelled. */
        const big = { series: {}, volume: {} };
        for (let i = 0; i < 300; i++) { const k = 'QA' + String(i).padStart(3, '0'); big.series[k] = f.history.series.MATCH; big.volume[k] = f.history.volume.MATCH; }
        scanHistoryFile = big;
        Object.assign(scanMarketState, { market: '__all', asOf: '', result: null, setup: null, job: null });
        Object.assign(scanBacktestState, { setup: null, symbol: '', from: '', to: '', result: null, job: null });
        const runCancel = async (path, runRe) => {
          navigate(path); await w(20);
          const run = btn(runRe);
          run.focus(); run.click();
          await w(30);
          const during = act();
          const cancel = btn(/^Cancel$/);
          cancel.focus(); cancel.click();
          for (let i = 0; i < 50 && !/Cancelled/.test(document.querySelector('main').innerText); i++) await w(20);
          return { during, after: act() };
        };
        out.screen = await runCancel('/app/scanner/market', /^Screen now/);
        out.sim = await runCancel('/app/scanner/backtest', /^Run the simulation/);
        /* A simulation left running while the reader looked elsewhere and
           came back, with its From changed meanwhile: the page shows it
           running, and its result, on the window it was asked for, lands on
           the page on screen. */
        const mid = { series: {}, volume: {} };
        for (let i = 0; i < 40; i++) { const k = 'QB' + String(i).padStart(3, '0'); mid.series[k] = f.history.series.MATCH; mid.volume[k] = f.history.volume.MATCH; }
        scanHistoryFile = mid;
        Object.assign(scanBacktestState, { symbol: '', from: '', to: '', result: null, job: null });
        navigate('/app/scanner/backtest'); await w(20);
        btn(/^Run the simulation/).click();
        navigate('/learn'); scanBacktestState.from = '2026-03-02'; navigate('/app/scanner/backtest'); await w(20);
        const cancelNow = btn(/^Cancel$/);
        out.back = { cancel: cancelNow ? getComputedStyle(cancelNow).display : 'absent', runDisabled: btn(/^Run the simulation/).disabled,
                     said: [...document.querySelectorAll('main p[role=status]')].map(x => x.textContent).join(' ') };
        for (let i = 0; i < 150 && scanBacktestState.job; i++) await w(20);
        await w(40);
        out.back.shown = document.querySelector('main .scan-counts .stat-value')?.textContent || null;
        out.back.from = scanBacktestState.result ? scanBacktestState.result.from : 'no result';
        out.back.runEnabled = !btn(/^Run the simulation/).disabled;
        /* A screen whose market is changed while it runs keeps the market
           it screened. */
        Object.assign(scanMarketState, { market: '__all', asOf: '', result: null, setup: null, job: null });
        scanHistoryFile = big;
        navigate('/app/scanner/market'); await w(20);
        btn(/^Screen now/).click();
        scanMarketState.market = 'US';
        for (let i = 0; i < 150 && scanMarketState.job; i++) await w(20);
        out.label = { market: scanMarketState.result?.market ?? null, screened: scanMarketState.result?.rows?.length ?? null };
        scanMarketState.market = '__all';
        /* From after To; an as-of after today. */
        scanHistoryFile = f.history;
        Object.assign(scanBacktestState, { symbol: '', from: '2026-03-20', to: '2026-02-01', result: null, job: null });
        navigate('/app/scanner/backtest'); await w(20);
        btn(/^Run the simulation/).click(); await w(150);
        out.window = { result: !!scanBacktestState.result, said: [...document.querySelectorAll('main p[role=status]')].map(x => x.textContent).join(' ') };
        Object.assign(scanBacktestState, { from: '', to: '' });
        Object.assign(scanMarketState, { asOf: scanAddDays(f.now.slice(0, 10), 30), result: null, job: null });
        navigate('/app/scanner/market'); await w(20);
        out.future = { max: document.querySelector('#scan-market-asof')?.getAttribute('max') };
        btn(/^Screen now/).click(); await w(150);
        out.future.result = !!scanMarketState.result;
        out.future.said = [...document.querySelectorAll('main p[role=status]')].map(x => x.textContent).join(' ');
        scanMarketState.asOf = '';
        /* Several setups pasted at once. */
        scanSetupsFile = null;
        navigate('/app/scanner/market'); await w(20);
        document.querySelector('#scan-paste').value = JSON.stringify({ setups: [{ ...f.setupV2, id: 'qa-first', name: 'QA first' }, { ...f.setupV2, id: 'qa-second' }] });
        btn(/^Use this setup$/).click(); await w(40);
        out.paste = [...document.querySelectorAll('main p[role=status]')].map(x => x.textContent).join(' ');
        Object.assign(scanMarketState, { pasted: '', pastedSetup: null, pasteNote: '', setup: null });
        /* A good file chosen beside one that does not parse. */
        scanOpsOpened = []; if (hasNote) scanOpsOpenNote = ''; scanRunsFile = null;
        navigate('/admin/scanner'); await w(40);
        const input = document.querySelector('main .scan-open input[type=file]');
        const dt = new DataTransfer();
        dt.items.add(new File([JSON.stringify({ schema: 1, runs: [], audit: [] })], 'scan-runs.json', { type: 'application/json' }));
        dt.items.add(new File(['{ not json'], 'scan-control.json', { type: 'application/json' }));
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
        await w(200);
        out.open = { said: document.querySelector('main .scan-open [role=status]')?.textContent || '', opened: scanOpsOpened.map(o => o.as).join() };
        return out;
      } finally { restore(); scanOpsOpened = keepOpened; if (hasNote) scanOpsOpenNote = keepNote; scanJobsState.filter = 'all';
        Object.assign(scanMarketState, { market: '__all', asOf: '', result: null, setup: null, job: null, pasted: '', pastedSetup: null, pasteNote: '' });
        Object.assign(scanBacktestState, { setup: null, symbol: '', from: '', to: '', result: null, job: null }); navigate('/learn'); }
    })()`);
    const p = [];
    if (r.more.active === 'BODY' || !r.more.landed || !r.more.first || r.more.rows !== 60) p.push(`"Show 10 more" on the runs: ${JSON.stringify(r.more)}`);
    for (const [k, v] of Object.entries({ screen: r.screen, simulation: r.sim })) {
      if (v.during !== 'BUTTON:Cancel' || !/^BUTTON:(Screen now|Run the simulation)/.test(v.after)) p.push(`${k} run from the keyboard: focus ${v.during} while running, ${v.after} after Cancel`);
    }
    const bk = r.back;
    if (bk.cancel === 'none' || bk.cancel === 'absent' || !bk.runDisabled || !/^Simulated \d+ of 40/.test(bk.said.trim()) || bk.shown !== '40' || bk.from !== null || !bk.runEnabled)
      p.push(`a simulation still running when the reader came back: ${JSON.stringify(bk)}`);
    if (r.label.market !== '__all' || r.label.screened !== 300) p.push(`a screen of everything, its market changed while it ran, is labelled ${JSON.stringify(r.label)}`);
    if (r.window.result || !/is after To/.test(r.window.said)) p.push(`From after To: ${JSON.stringify(r.window)}`);
    if (r.future.result || !/is not a past date/.test(r.future.said) || !r.future.max) p.push(`an as-of after today: ${JSON.stringify(r.future)}`);
    if (!/The first of 2 setups was taken\. It is “QA first”/.test(r.paste)) p.push(`two setups pasted: "${r.paste}"`);
    if (r.open.opened !== 'scan-runs.json' || !/scan-control\.json \(not readable as JSON\)/.test(r.open.said)) p.push(`a good and a broken file chosen together: ${JSON.stringify(r.open)}`);
    if (p.length) fail('bugfix scanner-ops: focus, paging and runs on the scanner pages', p);
    else ok('bugfix scanner-ops: focus, paging and runs on the scanner pages — "Show more" lands on the first row it revealed and keeps an open run open, a screen and a simulation hand focus to Cancel and back, a simulation still running when the reader comes back is shown running and lands on the page on the window it was asked for, a screen keeps the market it screened, a From after To and an as-of after today are refused with the reason, the setup taken from several pasted is named, and a file that did not parse is named beside one that opened');
  }
  /* ---- end bugfix: scanner-ops ---- */

  /* ---- bugfix: studio-trading ---- */
  /* S1 — the reader's pages survive a company that is not loaded, date their
          own review window, name every control in their drawers, keep an
          absent property cash flow absent, and explain a holding-company
          value with the equity actually divided. */
  {
    const r = await evaluate(`(async () => {
      const wait = (ms = 150) => new Promise(res => setTimeout(res, ms));
      const out = {};
      const keep = { theses: JSON.stringify(State.theses), pf: JSON.stringify(State.portfolios), deal: JSON.stringify(State.deal), plan: State.plan, pfIdx: State.pfIdx };
      try {
        /* The checks above may have deleted every case; one is added, and the
           stored list is restored below. */
        let t0 = State.theses.find(t => BY_ID.get(t.ticker));
        if (!t0) { t0 = { id: 't-s1', ticker: 'AAPL-SEC', oneLine: 'test case', quality: '', valCase: '', catalysts: [], risks: [], conds: [],
          horizon: '1y', review: '2026-12-01', conf: 'Low', questions: [], created: '2026-09-28' }; State.theses.push(t0); }
        const unnamed = () => [...document.querySelectorAll('#drawerBody input, #drawerBody select, #drawerBody textarea')]
          .filter(n => n.type !== 'hidden' && !(n.labels && n.labels.length) && !n.getAttribute('aria-label') && !n.getAttribute('aria-labelledby')).length;
        openThesisEditor(t0); await wait(); out.editorUnnamed = unnamed(); closeDrawer(); await wait();
        openReview(t0); await wait(); out.reviewUnnamed = unnamed(); closeDrawer(); await wait();
        State.portfolios = [...State.portfolios, { id: 'pf-nocc', name: 'No currency', cash: 100, holdings: [] }];
        openPortfolioManager(); await wait();
        out.managerUnnamed = unnamed();
        const cs = [...document.querySelectorAll('#drawerBody select')];
        out.legacyCcy = { shown: cs[cs.length - 1]?.value, base: State.baseCcy };
        closeDrawer(); await wait();
        /* A portfolio holding cash, so the page draws past its empty state. */
        State.portfolios = [...JSON.parse(keep.pf), { id: 'pf-s1', name: 'Cash only', cash: 1000, cashCcy: 'MYR', holdings: [] }];
        State.pfIdx = State.portfolios.length - 1;
        State.plan = 'all';
        State.deal = { ...State.deal, tenureYears: 0 };
        const dm = dealModel(State.deal);
        out.precondition = { loan: dm.loan, cf: dm.cashflowMonthly };
        navigate('/my/portfolio'); await wait();
        out.cross = [...document.querySelectorAll('main .panel')].map(x => x.innerText).find(t => /Combined annual cash flow/.test(t)) || null;
        State.deal = JSON.parse(keep.deal); State.plan = keep.plan; State.portfolios = JSON.parse(keep.pf); State.pfIdx = keep.pfIdx;
        /* Last, because before the fix this view threw and left nothing drawn. */
        State.theses = [...State.theses, { id: 't-gone', ticker: 'GONE-SEC', oneLine: 'A case on a company this page has not loaded', quality: '', valCase: '',
          catalysts: [], risks: [], conds: [{ type: 'val', op: '>', v: 15, label: 'x' }], horizon: '1y', review: '2026-12-01', conf: 'Low', questions: [], created: '2026-09-01' }];
        let threw = null;
        try { VIEWS.thesis(); } catch (e) { threw = e.message; }
        try { navigate('/my/theses'); } catch (e) { threw = threw || e.message; }
        await wait();
        const main = document.querySelector('main');
        const due = [...main.querySelectorAll('.grid.g-4 .card')].map(c => c.innerText).find(t => /Reviews due/.test(t)) || '';
        const want = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
        out.thesis = { threw, view: State.view, gone: /GONE-SEC — not in the companies loaded now/.test(main.innerText), due: due.split('\\n')[0], want };
      } finally {
        State.theses = JSON.parse(keep.theses); State.portfolios = JSON.parse(keep.pf); State.deal = JSON.parse(keep.deal); State.plan = keep.plan; State.pfIdx = keep.pfIdx;
        saveTheses(); savePortfolios(); saveDeal();
      }
      navigate('/company/SIME?tab=valuation'); await wait(250);
      const sime = BY_ID.get('SIME'); const run = valuationRun(sime.c, sime.d, studioInputs(sime));
      const line = [...document.querySelectorAll('.explain-list li')].map(li => li.textContent).find(t => /^Per share/.test(t)) || '';
      out.holdco = { hold: run.base.hold, line, named: fmtCap(run.base.equity - run.base.holdDiscount, sime.c.ccy) };
      return out;
    })()`);
    const p = [];
    if (r.thesis.threw || r.thesis.view !== 'thesis' || !r.thesis.gone) p.push(`/my/theses with a case on an unloaded company: ${JSON.stringify(r.thesis)}`);
    if (r.thesis.due !== 'Reviews due by ' + r.thesis.want) p.push(`the review tile reads "${r.thesis.due}", not a window from today ("Reviews due by ${r.thesis.want}")`);
    if (r.editorUnnamed || r.reviewUnnamed || r.managerUnnamed) p.push(`unnamed drawer controls — thesis editor ${r.editorUnnamed}, decision review ${r.reviewUnnamed}, portfolio manager ${r.managerUnnamed}`);
    if (r.legacyCcy.shown !== r.legacyCcy.base) p.push(`a portfolio with no stored cash currency shows ${r.legacyCcy.shown} in the manager while the page values it in ${r.legacyCcy.base}`);
    if (!(r.precondition.loan > 0) || r.precondition.cf !== null) p.push(`precondition: a loan with no tenure should leave the monthly position absent — ${JSON.stringify(r.precondition)}`);
    else if (!r.cross || /RM0 net rent|\$0 net rent/.test(r.cross) || !/not computed/.test(r.cross)) p.push(`the cross-asset card states an uncomputed property cash flow as a figure: ${JSON.stringify(r.cross)}`);
    if (!(r.holdco.hold > 0) || !r.holdco.line.includes(r.holdco.named)) p.push(`the holding-company per-share line does not name the equity it divides: ${JSON.stringify(r.holdco)}`);
    if (p.length) fail('theses survive an unloaded company; drawers are named; an absent property cash flow stays absent; the holdco line names what it divides', p);
    else ok('/my/theses keeps a case on an unloaded company and dates its review window from today; the thesis, review and portfolio drawers name every control; the cross-asset card withholds an uncomputed cash flow; the holdco per-share line names the equity after the discount', r);

    /* S2 — Compare and Portfolio keep keyboard focus through their redraws. */
    const press = async (key, code, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code }, sessionId);
      await sleep(250);
    };
    const keepCmp = await evaluate(`JSON.stringify({ c: State.compare, i: State.pfIdx, pf: State.portfolios })`);
    await evaluate(`(async () => { State.compare = ['AAPL-SEC', 'MSFT-SEC']; navigate('/compare?companies=AAPL-SEC,MSFT-SEC'); await new Promise(r => setTimeout(r, 250));
      window.__chip = [...document.querySelectorAll('main button.chip')].find(b => !b.classList.contains('chip-brand'))?.textContent;
      [...document.querySelectorAll('main button.chip')].find(b => b.textContent === window.__chip).focus(); return 1; })()`);
    await press('Enter', 13, '\r');
    const chip = await evaluate(`({ tag: document.activeElement.tagName, text: document.activeElement.textContent.trim().slice(0, 40), want: window.__chip, n: State.compare.length })`);
    /* Two portfolios, so the arrow key changes the selection and redraws. */
    await evaluate(`(async () => { State.portfolios = [...State.portfolios, { id: 'pf-s2a', name: 'Second', cash: 10, cashCcy: 'MYR', holdings: [] }, { id: 'pf-s2b', name: 'Third', cash: 10, cashCcy: 'MYR', holdings: [] }];
      State.pfIdx = State.portfolios.length - 2; navigate('/my/portfolio'); await new Promise(r => setTimeout(r, 250)); document.querySelector('select[aria-label="Active portfolio"]').focus(); return 1; })()`);
    await press('ArrowDown', 40);
    const pfSel = await evaluate(`[document.activeElement.getAttribute('aria-label'), State.portfolios[State.pfIdx]?.id]`);
    await evaluate(`(() => { const k = ${JSON.stringify(keepCmp)}; const o = JSON.parse(k); State.compare = o.c; saveCompare(); State.pfIdx = o.i; State.portfolios = o.pf; savePortfolios(); return 1; })()`);
    const q = [];
    if (chip.tag !== 'BUTTON' || chip.text !== String(chip.want || '').trim().slice(0, 40) || chip.n !== 3) q.push(`Enter on a Compare chip left focus on ${chip.tag} “${chip.text}” (${chip.n} selected)`);
    if (pfSel[1] !== 'pf-s2b') q.push(`precondition: the arrow key did not move the active portfolio (${pfSel[1]})`);
    else if (pfSel[0] !== 'Active portfolio') q.push(`an arrow key on the portfolio select left focus on ${pfSel[0]}`);
    if (q.length) fail('Compare and Portfolio keep keyboard focus through a redraw', q);
    else ok('Compare chips and the portfolio select keep keyboard focus through the redraw they cause', { chip, pfSel });
  }
  /* ---- end bugfix: studio-trading ---- */

  /* ---- bugfix: merge ---- */
  /* A DRAWER OPENED AND CLOSED IN ONE FRAME. The open marks the drawer and
     the scrim open a frame later; a close before that frame was overridden
     by it, and the scrim stayed over the page, invisible, taking every click.
     Found at merge: the equity-views check closes one drawer and opens and
     closes the next in one tick, and the scanner check after it could not
     click. The search box had the same frame, and a reopen within 200ms of a
     close was hidden by the close's timer. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const out = {};
      openDrawer('QA one', el('p', {}, 'one'));
      closeDrawer({ restore: false });
      openDrawer('QA two', el('p', {}, 'two'));
      closeDrawer({ restore: false });
      await w(450);
      out.scrimAfterDrawers = scrim.dataset.open;
      out.drawerHidden = drawer.hidden;
      openSearch(); closeSearch({ restore: false });
      await w(250);
      out.scrimAfterSearch = scrim.dataset.open;
      out.searchHidden = searchModal.hidden;
      openSearch(); await w(20); closeSearch({ restore: false }); await w(20); openSearch();
      await w(300);
      out.reopened = { hidden: searchModal.hidden, open: searchModal.dataset.open };
      closeSearch({ restore: false });
      await w(250);
      out.finalScrim = scrim.dataset.open;
      return out;
    })()`);
    const p = [];
    if (r.scrimAfterDrawers === '1' || !r.drawerHidden) p.push(`after open, close, open, close in one frame the scrim is ${r.scrimAfterDrawers} and the drawer hidden is ${r.drawerHidden}`);
    if (r.scrimAfterSearch === '1' || !r.searchHidden) p.push(`after the search box opened and closed in one frame the scrim is ${r.scrimAfterSearch}, the box hidden ${r.searchHidden}`);
    if (r.reopened?.hidden || r.reopened?.open !== '1') p.push(`the search box reopened within 200ms of closing is hidden ${r.reopened?.hidden}, open ${r.reopened?.open}`);
    if (r.finalScrim === '1') p.push('the scrim stayed open after the last close');
    if (p.length) fail('bugfix merge: a drawer or the search box closed before its first frame leaves no scrim over the page', p);
    else ok('bugfix merge: a drawer or the search box closed before its first frame leaves no scrim over the page, and a search reopened within 200ms of a close stays open');
  }
  /* ---- end bugfix: merge ---- */

  /* ---- bugfix: equities-views ---- */
  /* WHAT THE EQUITY VIEWS SAID AGAINST WHAT THEY HELD. Each check below failed
     before its fix: the moat page named a margin measure it did not compute,
     two model differences were coloured as gains, a missing share count
     printed units around a dash, the printable report kept its own line list
     (a bank's pre-tax income as operating profit, a bank's cash flows, a
     dividend CAGR across a split) and its "save this run" opened a stale run,
     the screener's price-history note read a property no screen carries, two
     templates filtered on a measure no company has, Discover and Learn had
     orphan tabs, three drawer controls had no name, the homepage's worked
     Wheel contract read the reader's own plan, the financials chart indexed a
     series to a negative first year, and the explorer quoted an empty search. */
  {
    const r = await evaluate(`(async () => {
      const out = {};
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      const nameOf = (n) => n.getAttribute('aria-label') || n.getAttribute('aria-labelledby') || n.getAttribute('title')
        || n.getAttribute('placeholder') || [...(n.labels || [])].map(l => l.textContent.trim()).join(' ');

      /* 1. The moat page: the row over revVol is named for revenue growth,
         and an absent lease expiry is a dash, not "— yrs". */
      openResearch('MSFT-SEC', 'moat');
      const moatRows = [...document.querySelectorAll('main table tbody tr')].map(tr => tr.cells[0].textContent);
      out.moat = { margin: moatRows.includes('Margin stability'), revenue: moatRows.includes('Revenue growth stability') };
      const reit = U.find(x => x.c.real && x.c.type === 'reit' && !isNum(x.m.wale));
      openResearch(reit.c.id, 'moat');
      out.wale = [...document.querySelectorAll('main table tbody tr')].find(tr => tr.cells[0].textContent === 'Weighted lease expiry')?.cells[1].textContent ?? null;

      /* 2. A model difference is never the green of a gain. */
      /* The research queue is what /app was before Release A (40-views-discover.js). */
      navigate('/research/queue');
      const cardEl = [...document.querySelectorAll('main h3.h-card')].find(h => /Largest differences/.test(h.textContent))?.closest('.card');
      const cells = cardEl ? [...cardEl.querySelectorAll('.num')].filter(x => /%$/.test(x.textContent)) : [];
      out.largest = { n: cells.length, pos: cells.filter(x => x.classList.contains('pos')).length,
        mdiff: cells.filter(x => /\\bmdiff/.test(x.className)).length };
      const priced = U.find(x => isNum(x.val?.mos?.base) && x.val.mos.base > 0 && !x.val.err);
      openResearch(priced.c.id, 'snapshot');
      const tv = [...document.querySelectorAll('main .stat-label')].find(x => /vs base-case/.test(x.textContent))?.parentElement.querySelector('.stat-value');
      out.tile = tv ? { style: tv.getAttribute('style') || '', cls: tv.className } : null;

      /* 3. A filer with no latest share count reads as such on Business. */
      const noSh = U.find(x => x.c.real && !isNum(last(x.d.sh)));
      if (noSh) { openResearch(noSh.c.id, 'business');
        const dt = [...document.querySelectorAll('main dt')].find(x => x.textContent === 'Shares in issue');
        out.shares = { id: noSh.c.id, text: dt?.nextElementSibling?.textContent || null }; }

      /* 4. The report's lines are the page's lines. */
      navigate('/company/JPM-SEC/report');
      const jpmLab = statementLines(BY_ID.get('JPM-SEC')).find(l => l.key === 'ebit').label;
      out.jpm = { lab: jpmLab,
        rows: [...document.querySelectorAll('.rr-hist tbody tr')].map(tr => tr.cells[0].textContent),
        figs: [...document.querySelectorAll('.dr-fig')].slice(0, 6).map(x => [x.children[0].textContent, x.children[1].textContent]) };
      /* A break among the five rows the four-year rate reads (bugfix4:
         equities). On the whole-series break this picked Apple, whose break
         lies outside its window, and passed only while the report withheld
         a rate the engine and Ownership & actions both print. */
      const split = U.find(x => x.m.perShareBreak && isNum(cagr(x.d.dps.slice(-5))));
      navigate(companyPath(split.c) + '/report');
      out.split = { id: split.c.id, dps: [...document.querySelectorAll('.rr-hist tbody tr')].find(tr => tr.cells[0].textContent === (split.c.type === 'reit' ? 'Distribution per unit' : 'Dividend per share'))
        ?.cells[8 - 1 - (6 - Math.min(6, yearsOf(split.c).length))]?.textContent ?? null };

      /* 5. "Save this run" opens the run it saved, or none. With an assumption
         emptied in the Studio the report prints the defaults, and a run of
         them is saved; an older run is never opened in its place. */
      const live = BY_ID.get('MSFT-SEC');
      const keepRuns = store.read('runs', []), keepVal = State.valuation['MSFT-SEC'];
      saveValuationRun(live, { ...studioInputs(live) });
      const older = store.read('runs', [])[0].runId;
      const first = (ASSUMPTIONS[studioInputs(live).model] || []).find(a => !a.onlyIf || a.onlyIf === live.val.pack.id).k;
      State.valuation['MSFT-SEC'] = { ...studioInputs(live), [first]: null };
      navigate('/company/MSFT-SEC/report');
      [...document.querySelectorAll('main button')].find(x => /Save this run/.test(x.textContent))?.click();
      await wait(300);
      const runQs = new URLSearchParams(location.search).get('run');
      out.save = { older, run: runQs, newest: store.read('runs', [])[0].runId };
      store.write('runs', keepRuns);
      if (keepVal) State.valuation['MSFT-SEC'] = keepVal; else delete State.valuation['MSFT-SEC'];

      /* 6. A threshold on an observed-price field says who was never measured. */
      const keepScreen = State.screen, keepTpl = State.appliedTemplate;
      navigate('/discover/screener');
      State.screen = { ...blankScreen(), crit: { rs12: { min: 0 } } }; render();
      out.priceNote = /companies have no observed price history/.test(document.querySelector('main').innerText);

      /* 7. A template does not filter on a measure no company carries. */
      out.tpl = ['conservative', 'infra'].map(id => {
        const t = SCREEN_TEMPLATES.find(x => x.id === id);
        applyTemplate(t);
        const icovFails = U.filter(x => evaluateScreen(x, State.screen).fails.some(f => /^Interest cover/.test(f))).length;
        const banner = /interest cover ≥/.test(document.querySelector('main').innerText);
        return { id, icovFails, banner };
      });
      State.screen = keepScreen; State.appliedTemplate = keepTpl;

      /* 8. Discover and Learn: a tablist, one tab stop, arrows move focus. */
      out.tabs = [];
      for (const p of ['/discover/screener', '/learn/glossary']) {
        navigate(p);
        const tabs = [...document.querySelectorAll('main [role=tab]')];
        const list = tabs[0]?.parentElement;
        const sel = tabs.find(t => t.getAttribute('aria-selected') === 'true');
        sel?.focus();
        sel?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        out.tabs.push({ p, n: tabs.length, tablist: list?.getAttribute('role') === 'tablist' && !!list.getAttribute('aria-label'),
          orphans: tabs.filter(t => t.parentElement !== list).length, stops: tabs.filter(t => t.tabIndex === 0).length,
          arrow: document.activeElement === tabs[(tabs.indexOf(sel) + 1) % tabs.length] });
      }

      /* 9. Every control in the case and restore drawers has a name. */
      const keepCases = State.corrections;
      State.corrections = [{ id: 'QT-20260928-001', createdAt: '2026-09-28 09:00 UTC+08:00', route: '/', status: 'recorded — not sent',
        modelVersion: MODEL_VERSION, asOf: AS_OF, coverage: 'x', item: 'Operating margin', subject: 'MSFT', description: 'x' }];
      navigate('/corrections');
      [...document.querySelectorAll('main button')].find(x => x.textContent === 'Open')?.click();
      const caseCtl = [...document.querySelectorAll('.drawer textarea, .drawer input, .drawer select')];
      out.caseNames = caseCtl.map(nameOf);
      closeDrawer({ restore: false });
      openRestoreDrawer();
      out.restoreNames = [...document.querySelectorAll('.drawer textarea, .drawer input, .drawer select')].map(nameOf);
      closeDrawer({ restore: false });
      State.corrections = keepCases;

      /* 10. The worked contract's card is the worked contract, whatever the
         reader's own plan holds. It moved with the other examples from the
         homepage to /how-it-works (Release A). */
      const keepWheel = State.wheel;
      State.wheel = { ...State.wheel, adjustedContract: true, adjustmentVerified: false, openFees: 20, fxConversionCostMyr: 500 };
      navigate('/how-it-works');
      const wheelCard = [...document.querySelectorAll('.proof-card')].find(x => /Cash Wheel/.test(x.textContent));
      const want = wheelMath({ ...WHEEL_WORKED_EXAMPLE });
      out.wheel = { shown: wheelCard ? [...wheelCard.querySelectorAll('.pv')].map(x => x.textContent) : null,
        want: [fmtAmount(want.requiredAssignmentCash, 'USD'), fmtAmount(want.safeAssignmentCashMyr, 'MYR'), fmtAmount(want.putMaxLossIfZero, 'USD')] };
      State.wheel = keepWheel;

      /* 11. "Indexed to 100" is not drawn off a base at or below zero: the
         index turns sign there, and a profit after a loss plots as a fall. */
      const negBase = U.find(x => x.c.type !== 'bank' && ['rev', 'ebit', 'fcf'].some(k => x.d[k].find(isNum) <= 0));
      const keepMode = State.finMode;
      State.finMode = 'idx';
      openResearch(negBase.c.id, 'financials');
      const card = [...document.querySelectorAll('main h3.h-card')].find(h => /Revenue|Total income/.test(h.textContent))?.closest('.card');
      const twin = [...(card?.querySelectorAll('details table tbody tr') || [])].map(tr => [...tr.cells].map(td => td.textContent));
      const flagged = twin.filter(row => { const k = /Free cash flow/.test(row[0]) ? 'fcf' : /Revenue|Total income/.test(row[0]) ? 'rev' : 'ebit';
        return negBase.d[k].find(isNum) <= 0; });
      out.idx = { id: negBase.c.id, flagged: flagged.length,
        drawn: flagged.flatMap(row => row.slice(1)).filter(v => /[0-9]/.test(v)).length,
        legend: /not indexed/.test(card?.querySelector('.legend')?.textContent || '') };
      State.finMode = keepMode;

      /* 12. A search from the filters alone does not quote an empty query. */
      navigate('/research');
      const mk = document.querySelector('main select[aria-label="Market"]'), cv = document.querySelector('main select[aria-label="Coverage"]');
      mk.value = 'MY'; cv.value = 'FILED';
      cv.dispatchEvent(new Event('change', { bubbles: true }));
      out.search = [...document.querySelectorAll('main .metaline')].map(x => x.textContent).find(t => /^Nothing in the beta universe/.test(t)) || null;
      return out;
    })()`);
    const p = [];
    if (r.moat.margin || !r.moat.revenue) p.push(`the moat row over revenue-growth volatility is named ${JSON.stringify(r.moat)}`);
    if (r.wale !== '—') p.push(`an absent lease expiry reads "${r.wale}"`);
    if (!r.largest.n || r.largest.pos || r.largest.mdiff !== r.largest.n) p.push(`"Largest differences" colours a model gap as a gain: ${JSON.stringify(r.largest)}`);
    if (!r.tile || /--ok-text|--dn-text/.test(r.tile.style) || !/mdiff/.test(r.tile.cls)) p.push(`the snapshot's "vs base-case value" is toned as a gain or loss: ${JSON.stringify(r.tile)}`);
    if (r.shares && (/—bn|— a year/.test(r.shares.text || '') || !r.shares.text)) p.push(`an absent share count reads ${JSON.stringify(r.shares)}`);
    if (r.jpm.rows[1] !== r.jpm.lab || r.jpm.figs[1]?.[0] !== r.jpm.lab) p.push(`the report calls JPM's ${r.jpm.lab} ${JSON.stringify([r.jpm.rows[1], r.jpm.figs[1]?.[0]])}`);
    if (r.jpm.rows.some(x => /Operating cash flow|Capital expenditure|Free cash flow|Cash and equivalents/.test(x))) p.push(`the report prints lines the page omits for a bank: ${r.jpm.rows.join(', ')}`);
    if (['Operating cash flow', 'Free cash flow'].some(k => r.jpm.figs.find(f => f[0] === k)?.[1] !== 'Not applicable')) p.push(`the report's bank headline figures: ${JSON.stringify(r.jpm.figs)}`);
    if (r.split.dps !== 'withheld') p.push(`${r.split.id}'s report prints a per-share CAGR across its share-count break: ${r.split.dps}`);
    if (r.save.run === r.save.older) p.push(`"Save this run" opened the older run ${r.save.older} as though it were the one saved: ${JSON.stringify(r.save)}`);
    if (r.save.run && r.save.run !== r.save.newest) p.push(`"Save this run" opened ${r.save.run}, not the run it saved (${r.save.newest})`);
    if (!r.priceNote) p.push('a threshold on the 12-month price change does not say which companies were never measured');
    r.tpl.forEach(t => { if (t.icovFails || !t.banner) p.push(`template ${t.id}: ${t.icovFails} companies excluded for the blocked interest cover, banner ${t.banner}`); });
    r.tabs.forEach(t => { if (!t.tablist || t.orphans || t.stops !== 1 || !t.arrow) p.push(`${t.p} tab strip: ${JSON.stringify(t)}`); });
    if (!r.caseNames.length || r.caseNames.some(n => !n)) p.push(`the case drawer has an unnamed control: ${JSON.stringify(r.caseNames)}`);
    if (r.restoreNames.length < 2 || r.restoreNames.some(n => !n)) p.push(`the restore drawer has an unnamed control: ${JSON.stringify(r.restoreNames)}`);
    if (!r.search || /“”/.test(r.search)) p.push(`a filters-only search with no match reads ${JSON.stringify(r.search)}`);
    if (!r.idx.flagged || r.idx.drawn || !r.idx.legend) p.push(`${r.idx.id} is indexed off a base at or below zero: ${JSON.stringify(r.idx)}`);
    if (JSON.stringify(r.wheel.shown) !== JSON.stringify(r.wheel.want)) p.push(`the worked Wheel contract on /how-it-works read the reader's plan: ${JSON.stringify(r.wheel)}`);
    if (p.length) fail('the equity views say what they hold — moat, model differences, report lines, saved runs, price note, templates, tab strips, drawer names, worked contract, indexed chart, explorer search', p);
    else ok(`the equity views say what they hold — "Revenue growth stability" on the moat page, ${r.largest.n} model gaps in the neutral tone, the report's ${r.jpm.lab} and no bank cash-flow lines, ${r.split.id}'s per-share CAGR withheld, "Save this run" opens only the run it saved, the price-history note, both interest-cover templates stated not applied, two tablists, named drawer controls, the worked contract at ${r.wheel.want.join(' / ')}, ${r.idx.id}'s index left undrawn off its non-positive base`);
  }
  /* ---- end bugfix: equities-views ---- */

  /* ---- bugfix: scanner-user ---- */
  /* What the scanner-user bug hunt proved wrong in 86-scanner.js and
     06-watchlists.js after Phase 3 round 3. Each check fails on the code
     before its fix. The pages run on this file's scanner seed (scanSeedP3),
     put back afterwards; the last check reloads the page twice with a
     damaged watchlist store and once more with the reader's own. */
  {
    const bfSleep = (ms) => new Promise(r => setTimeout(r, ms));
    const bfKey = async (key, vk) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: vk }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: vk }, sessionId);
      await bfSleep(150);
    };
    const bfType = async (s) => {
      for (const ch of s) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, windowsVirtualKeyCode: ch.charCodeAt(0) }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, windowsVirtualKeyCode: ch.charCodeAt(0) }, sessionId);
        await bfSleep(30);
      }
    };
    /* A real press and release at the element's centre, once it has
       scrolled into view and nothing covers it. */
    /* What stood over the last target a real click could not reach, so a
       covered control names its cover. */
    let bfCover = null;
    const bfClick = async (expr) => {
      await evaluate(`(() => { const n = ${expr}; n.scrollIntoView({ block: 'center', behavior: 'instant' }); return true; })()`);
      await bfSleep(300);
      const p = await evaluate(`(() => { const n = ${expr}; const r = n.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return { x, y, ok: !!hit && (hit === n || n.contains(hit)), cover: hit ? hit.tagName.toLowerCase() + (typeof hit.className === 'string' && hit.className ? '.' + hit.className.trim().split(' ').filter(Boolean).join('.') : '') + ' “' + (hit.textContent || '').trim().slice(0, 40) + '”' : 'nothing' }; })()`);
      bfCover = p.ok ? null : p.cover;
      if (!p.ok) return false;
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }, sessionId);
      await bfSleep(300);
      return true;
    };
    const bfThrown = [];
    const bfListen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') bfThrown.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0]); };
    ws.addEventListener('message', bfListen);
    try {
      /* A DAMAGED SETUPS STORE. Versions that are not a list, a null
         version, no versions, a current version not held — a restored
         backup edited by hand — threw in scanVersionOf and took down the
         setups, a setup, its edit page, the watchlist scanner and the
         settings. Every page renders; a record with a readable version
         is listed. */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          ${scanSeedP3};
          const tree = { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'sma', n: 5 } }] };
          scanSaveSetup({ id: 'bf-good', name: 'Kept', version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D', cooldownMode: 'NEW_MATCH', ruleTree: tree });
          scanSaveSetup({ id: 'bf-cur', name: 'Current not held', version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D', cooldownMode: 'NEW_MATCH', ruleTree: tree });
          const st = JSON.parse(localStorage.getItem('vl.scanSetups'));
          st.setups['bf-obj'] = { id: 'bf-obj', name: 'Versions not a list', current: 1, versions: {} };
          st.setups['bf-null'] = { id: 'bf-null', name: 'A null version', current: 1, versions: [null] };
          st.setups['bf-none'] = { id: 'bf-none', name: 'No versions', current: 1 };
          st.setups['bf-cur'].current = 7;
          localStorage.setItem('vl.scanSetups', JSON.stringify(st));
          const out = { threw: [] };
          const go = async (p) => { try { navigate(p); await w(60); return true; } catch (e) { out.threw.push(p + ': ' + String(e.message).split('\\n')[0]); return false; } };
          for (const p of ['/app/scanner/setups/bf-good', '/app/scanner/setups/bf-null', '/app/scanner/setups/bf-none/edit', '/app/scanner/setups/bf-cur/edit', '/app/scanner/watchlists', '/app/scanner/settings']) await go(p);
          out.listed = (await go('/app/scanner/setups')) ? [...document.querySelectorAll('main .scan-setup-name')].map(a => a.textContent) : [];
          return out;
        })()`);
        const p = [];
        if (r.threw.length) p.push(...r.threw);
        if (!r.listed.includes('Kept') || !r.listed.includes('Current not held')) p.push(`listed: ${JSON.stringify(r.listed)}`);
        if (p.length) fail('bugfix scanner-user: a damaged vl.scanSetups record takes no scanner page down', p);
        else ok(`bugfix scanner-user: a damaged vl.scanSetups record takes no scanner page down — versions not a list, a null version, none at all and a current version not held; every page renders and the readable setups are listed (${r.listed.join(', ')})`);
      }

      /* A WATCHLIST UNIVERSE WITH NO LIST CHOSEN showed the first list as
         chosen while the draft held none — "choose a watchlist", and the
         only list could not be chosen. */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          ${scanSeedP3};
          scanDraft = { ...scanBlankDraft(), universe: { kind: 'watchlist', watchlistId: null } }; scanIdAuto = true;
          navigate('/app/scanner/setups/new'); await w(80);
          const sel = document.querySelector('main select[aria-label="Watchlist"]');
          const out = { shown: sel?.value ?? null, held: scanDraft.universe.watchlistId, lists: State.watchlists.length };
          const first = State.watchlists[0]?.id;
          sel.value = first; sel.dispatchEvent(new Event('change', { bubbles: true })); await w(60);
          out.chosen = scanDraft.universe.watchlistId === first;
          out.stillAsks = [...document.querySelectorAll('main .scan-problems-all li')].some(li => /choose a watchlist/.test(li.textContent));
          return out;
        })()`);
        if (!r.lists || r.shown !== (r.held || '') || !r.chosen || r.stillAsks) fail('bugfix scanner-user: the builder\'s watchlist select shows what the draft holds', r);
        else ok('bugfix scanner-user: the builder\'s watchlist select shows what the draft holds — "Choose a watchlist…" while none is chosen, and choosing a list takes');
      }

      /* THE ALERT PAGE. "Mark new" left the alert read (the redraw marked
         it read again under a toast saying "Marked new"), and the main
         navigation's count stayed one too high after an alert was opened. */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          ${scanSeedP3};
          /* The main navigation's count sits on My Alerts in the sidebar since Release A. */
          const navCount = () => document.querySelector('#appnav [data-item="alerts"] .sb-count .nav-count')?.textContent || null;
          const a = scanAlertsInOrder().find(x => x.id && scanAlertStatus(x) === 'NEW');
          const id = scanAlertIdOf(a);
          navigate('/app/scanner/alerts/' + id); await w(80);
          const out = { opened: scanAlertStatus(a), badge: navCount(), unread: String(scanUnreadCount()) };
          [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Mark new').click(); await w(60);
          Object.assign(out, { afterNew: scanAlertStatus(a), chip: document.querySelector('main .page-hd .chip')?.textContent, badgeNew: navCount(), unreadNew: String(scanUnreadCount()) });
          navigate('/app/scanner/alerts'); await w(40);
          navigate('/app/scanner/alerts/' + id); await w(60);
          out.reopened = scanAlertStatus(a);
          return out;
        })()`);
        const p = [];
        if (r.opened !== 'READ' || r.badge !== r.unread) p.push(`opened: status ${r.opened}, nav badge ${r.badge} with ${r.unread} unread`);
        if (r.afterNew !== 'NEW' || r.chip !== 'new' || r.badgeNew !== r.unreadNew) p.push(`Mark new: status ${r.afterNew}, chip ${r.chip}, badge ${r.badgeNew} with ${r.unreadNew} unread`);
        if (r.reopened !== 'READ') p.push(`opened again: ${r.reopened}`);
        if (p.length) fail('bugfix scanner-user: an alert\'s own "Mark new" keeps it new, and the navigation counts it', p);
        else ok(`bugfix scanner-user: an alert's own "Mark new" keeps it new until it is opened again, and the navigation's count follows each (${r.unread}, then ${r.unreadNew})`);
      }

      /* KEYBOARD FOCUS through a redraw: a filter select changed, a bulk
         button, a display setting and a setup's Disable each kept focus
         on the control (Disable as the Enable it became). It fell to
         <body>, so an arrow key changed a filter once and then nothing. */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          ${scanSeedP3};
          const who = () => document.activeElement === document.body ? 'BODY' : (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent.trim());
          const out = {};
          navigate('/app/scanner/alerts?status=OPEN'); await w(60);
          let s = document.querySelector('main select[aria-label="Status"]'); s.focus();
          s.value = 'NEW'; s.dispatchEvent(new Event('change', { bubbles: true })); await w(60);
          out.filter = who();
          navigate('/app/scanner/alerts?status=OPEN'); await w(60);
          let b = [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === 'Mark read'); b.focus(); b.click(); await w(60);
          out.bulk = who();
          navigate('/app/scanner/settings'); await w(60);
          s = document.querySelector('main select[aria-label="Alerts per page"]'); s.focus(); s.value = '100'; s.dispatchEvent(new Event('change', { bubbles: true })); await w(60);
          out.setting = who();
          scanAdoptFromFile('qa-above');
          navigate('/app/scanner/setups'); await w(60);
          b = document.querySelector('main button[aria-label="Disable QA close above SMA5"]'); b.focus(); b.click(); await w(60);
          out.toggle = who();
          return out;
        })()`);
        const want = { filter: 'Status', bulk: 'Mark read', setting: 'Alerts per page', toggle: 'Enable QA close above SMA5' };
        const p = Object.entries(want).filter(([k, v]) => r[k] !== v).map(([k, v]) => `${k}: focus on ${r[k]}, not ${v}`);
        if (p.length) fail('bugfix scanner-user: a scanner page redrawn by a control keeps focus on it', p);
        else ok('bugfix scanner-user: a scanner page redrawn by a control keeps focus on it — an alerts filter, "Mark read", a display setting, and Disable as the Enable it became');
      }

      /* A DATE, THEN A CLICK. Typed into "Bar from" and left by a click on
         "Clear the dates", the date was applied under the pointer and the
         click lost; left by Tab, focus fell to <body>. Real keys and a
         real press and release. */
      {
        await evaluate(`(async () => { ${scanSeedP3}; navigate('/app/scanner/alerts?status=ALL&to=2026-03-31'); await new Promise(r => setTimeout(r, 80)); document.querySelector('main input[aria-label="Bar from"]').focus(); return true; })()`);
        await bfType('02012026');
        const typed = await evaluate(`document.querySelector('main input[aria-label="Bar from"]').value`);
        const clicked = await bfClick(`[...document.querySelectorAll('main button')].find(x => /Clear the dates/.test(x.textContent))`);
        const cleared = await evaluate(`location.search`);
        await evaluate(`(async () => { navigate('/app/scanner/alerts?status=ALL'); await new Promise(r => setTimeout(r, 80)); document.querySelector('main input[aria-label="Bar from"]').focus(); return true; })()`);
        await bfType('02012026');
        let left = null;
        for (let i = 0; i < 4; i++) { await bfKey('Tab', 9); left = await evaluate(`document.activeElement === document.body ? 'BODY' : document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName`); if (left !== 'Bar from') break; }
        const tabbed = await evaluate(`location.search`);
        const p = [];
        if (!typed) p.push('no date could be typed into "Bar from"');
        if (!clicked) p.push(`"Clear the dates" was covered by ${bfCover}`);
        if (/from=|to=/.test(cleared)) p.push(`one click on "Clear the dates" after typing left ${cleared}`);
        if (!/from=/.test(tabbed) || left !== 'Bar to') p.push(`Tab out of "Bar from": ${tabbed}, focus on ${left}`);
        if (p.length) fail('bugfix scanner-user: a typed alert date keeps the click that follows it, and Tab keeps focus', p);
        else ok(`bugfix scanner-user: a typed alert date (${typed}) keeps the click that follows it — "Clear the dates" clears both — and Tab out of it applies it and lands on "Bar to"`);
      }

      /* THE TICK BOXES ON A PHONE: 22px with nothing round them to take
         the press. Each sits in a 44px label now. */
      {
        await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
        let r;
        try {
          r = await evaluate(`(async () => { ${scanSeedP3}; navigate('/app/scanner/alerts'); await new Promise(r => setTimeout(r, 150));
            return [...document.querySelectorAll('main .scan-alerts-t input[type=checkbox]')].slice(0, 4).map(n => { const b = (n.closest('label') || n).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }); })()`);
        } finally { await send('Emulation.clearDeviceMetricsOverride', {}, sessionId); }
        if (!r.length || r.some(([w, h]) => w < 44 || h < 44)) fail('bugfix scanner-user: each alert tick box is a 44px target at 390px', r);
        else ok(`bugfix scanner-user: each alert tick box is a 44px target at 390px (${r.map(x => x.join('×')).join(', ')})`);
      }

      /* THE HEADER BOX AND THE BULK LINE. Ticked from the header with one
         row unticked, the header box still read "every row"; and across
         pages "act on all 60 shown" sat beside "Showing 1–25 of 60". */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          ${scanSeedP3};
          const base = scanAlertsFile.alerts.filter(a => a.id);
          const many = [];
          for (let i = 0; i < 60; i++) { const a = base[i % base.length]; many.push({ ...a, key: a.key + '#' + i, id: 'a' + (0x10000000 + i).toString(16) }); }
          scanAlertsFile = { alerts: many };
          scanPrefsWrite({ pageSize: 25 });
          navigate('/app/scanner/alerts?status=ALL'); await w(80);
          const info = document.querySelector('main .scan-bulk [role=status]').textContent;
          const head = document.querySelector('main thead input[type=checkbox]');
          head.click(); await w(20);
          document.querySelector('main tbody input[type=checkbox]').click(); await w(20);
          return { info, checked: head.checked, mixed: head.indeterminate, ticked: scanAlertSel.size };
        })()`);
        const p = [];
        if (!/on every page/.test(r.info)) p.push(`bulk line with three pages: "${r.info}"`);
        if (r.checked || !r.mixed || r.ticked !== 24) p.push(`header box after one row unticked: checked ${r.checked}, mixed ${r.mixed}, ${r.ticked} ticked`);
        if (p.length) fail('bugfix scanner-user: the alerts header box and bulk line say what the buttons act on', p);
        else ok('bugfix scanner-user: the alerts header box follows the rows (mixed with 24 of 25 ticked), and with three pages the bulk line says the buttons act on every page');
      }

      /* A STATUS VALUE THE PAGE NEVER WRITES read as new in the list and as
         read in the count, and the tile blamed muted setups. */
      {
        const r = await evaluate(`(async () => {
          ${scanSeedP3};
          const a = scanAlertsInOrder().find(x => x.id);
          localStorage.setItem('vl.scanAlertState', JSON.stringify({ [scanAlertIdOf(a)]: 'read' }));
          navigate('/app/scanner/alerts'); await new Promise(r => setTimeout(r, 60));
          const tiles = [...document.querySelectorAll('main .scan-counts > *')].map(n => n.innerText);
          return { unread: scanUnreadCount(), news: scanAlertList().filter(x => scanAlertStatus(x) === 'NEW').length, tile: tiles[1] || '' };
        })()`);
        if (r.unread !== r.news || /muted/.test(r.tile)) fail('bugfix scanner-user: a status value the page never writes is not counted as read', r);
        else ok(`bugfix scanner-user: a status value the page never writes reads as new everywhere — ${r.unread} unread, and no tile blames a muted setup`);
      }

      /* DELETED HERE, STILL IN THE FILE: it read "only in the file — adopt
         it to keep its versions here", adopting undid the deletion, and
         nothing asked for the export that stops the worker running it. */
      {
        const r = await evaluate(`(async () => {
          ${scanSeedP3};
          scanAdoptFromFile('qa-above'); scanAdoptFromFile('fixture-breakout-v2');
          scanSetMeta('qa-above', { deleted: '2026-09-01T00:00:00Z' });
          const row = scanDriftRows().find(x => x.id === 'qa-above');
          navigate('/app/scanner/setups'); await new Promise(r => setTimeout(r, 60));
          const adopt = !!document.querySelector('main button[aria-label="Adopt qa-above from the file"]');
          const primary = !!document.querySelector('main button.btn-primary') && [...document.querySelectorAll('main button.btn-primary')].some(b => b.textContent === 'Export scan-setups.json');
          scanSetMeta('qa-above', { deleted: null });
          scanMarkExported(scanExportDoc());
          scanSetMeta('qa-above', { deleted: '2026-09-02T00:00:00Z' });
          const hidden = scanDriftRows({ fileDoc: null }).find(x => x.id === 'qa-above');
          return { state: row?.state, deleted: !!row?.deleted, text: row?.text, adopt, primary, hidden: hidden?.state || null };
        })()`);
        if (r.state !== 'NOT_EXPORTED' || !r.deleted || r.adopt || !r.primary || r.hidden !== 'NOT_EXPORTED') fail('bugfix scanner-user: a setup deleted here and still in the worker\'s file reads as not exported', r);
        else ok('bugfix scanner-user: a setup deleted here and still in the worker\'s file reads as not exported, with no "Adopt" and the export offered first — and, with the file not visible, deleted since the export that carried it');
      }

      /* THE FILE AHEAD WITH THE SAME CONDITIONS (a number edited by hand,
         or another browser's revert): Adopt kept this browser's number, so
         the setup stayed "file newer" and the button did nothing. */
      {
        const r = await evaluate(`(() => {
          ${scanSeedP3};
          scanAdoptFromFile('qa-above');
          const f = scanSetupsFile.setups.find(s => s.id === 'qa-above');
          scanSetupsFile = { setups: [{ ...f, version: 3 }, scanSetupsFile.setups[1]] };
          const before = scanDriftRows().find(x => x.id === 'qa-above')?.state;
          const out = scanAdoptFromFile('qa-above');
          const rec = scanStoreRead().setups['qa-above'];
          return { before, version: out.version, current: rec.current, held: rec.versions.map(v => v.version), after: scanDriftRows().find(x => x.id === 'qa-above')?.state };
        })()`);
        if (r.before !== 'FILE_NEWER' || r.version !== 3 || r.current !== 3 || r.after !== 'IN_STEP') fail('bugfix scanner-user: adopting the file\'s higher number for the same conditions keeps it', r);
        else ok(`bugfix scanner-user: adopting the file's v3 of the conditions held here as v1 keeps v3 (held ${r.held.join(', ')}), and the setup is then in step`);
      }

      /* A SETUP RESOLVED FROM THE EXPORT, its list changed since: the pages
         said "the worker evaluates the snapshot until you save the setup
         again and export", which it does not while the export holds the
         list — and the remedy is exporting the lists. */
      {
        const r = await evaluate(`(async () => {
          ${scanSeedP3};
          const keepWl = localStorage.getItem('vl.watchlists'), keepState = JSON.parse(JSON.stringify(State.watchlists)), keepIdx = State.wlIdx, keepDl = scanDownload;
          try {
            const made = wlCreate('BF export list'); wlAdd(made.watchlist.id, 'AAPL'); wlAdd(made.watchlist.id, 'NVDA');
            const tree = { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'sma', n: 5 } }] };
            const saved = scanSaveSetup(scanDraftSetup({ ...scanBlankDraft(), id: 'bf-by-export', name: 'By export', universe: { kind: 'watchlist', watchlistId: made.watchlist.id, resolve: 'export' }, ruleTree: tree }));
            scanDownload = () => {};
            scanExportWatchlists();
            wlAdd(made.watchlist.id, 'MSFT');
            const wd = scanWatchlistDrift(saved.setup);
            navigate('/app/scanner/setups'); await new Promise(r => setTimeout(r, 60));
            const note = [...document.querySelectorAll('main .scan-setup-row .scan-note')].map(n => n.textContent).join(' ');
            return { ok: saved.ok, byExport: !!wd?.byExport, same: wd?.same, text: wd?.text, note };
          } finally { scanDownload = keepDl; State.watchlists = keepState; State.wlIdx = keepIdx; if (keepWl == null) localStorage.removeItem('vl.watchlists'); else localStorage.setItem('vl.watchlists', keepWl); }
        })()`);
        if (!r.ok || !r.byExport || r.same !== false || /evaluates the snapshot/.test(r.text) || !/Changed since the export/.test(r.text) || !/Changed since the export/.test(r.note))
          fail('bugfix scanner-user: a setup resolved from the export is judged against the export, not its snapshot', r);
        else ok('bugfix scanner-user: a setup resolved from the export is judged against the export — its list changed since, the pages say the worker resolves the export until the lists are exported again, not that it evaluates the snapshot');
      }

      /* THE ID FIELD kept what was typed — "My Setup" on screen, my-setup
         saved. Left, it shows the id. */
      {
        const r = await evaluate(`(async () => {
          ${scanSeedP3};
          navigate('/app/scanner/setups/new'); await new Promise(r => setTimeout(r, 60));
          const id = document.querySelector('main input[aria-label="Id"]');
          id.focus(); id.value = 'My Setup';
          id.dispatchEvent(new Event('input', { bubbles: true })); id.dispatchEvent(new Event('change', { bubbles: true }));
          return { shown: id.value, held: scanDraft.id };
        })()`);
        if (r.shown !== r.held || r.held !== 'my-setup') fail('bugfix scanner-user: the builder\'s id field shows the id that will be saved', r);
        else ok('bugfix scanner-user: the builder\'s id field shows the id that will be saved — "My Setup" becomes my-setup once the field is left');
      }

      /* "NEW SETUP ON THIS LIST" replaced a draft with changes in it
         without asking, where every other start asks. */
      {
        const r = await evaluate(`(async () => {
          const w = (ms) => new Promise(r => setTimeout(r, ms));
          ${scanSeedP3};
          navigate('/app/scanner/setups/new'); await w(60);
          const nm = document.querySelector('main input[aria-label="Name"]');
          nm.value = 'Half written'; nm.dispatchEvent(new Event('input', { bubbles: true }));
          const keep = window.confirm; let asked = 0;
          try {
            window.confirm = () => { asked++; return false; };
            navigate('/app/scanner/watchlists'); await w(60);
            document.querySelector('main button[aria-label^="New setup on "]').click(); await w(60);
            return { asked, kept: scanDraft?.name, view: State.view };
          } finally { window.confirm = keep; }
        })()`);
        if (r.asked !== 1 || r.kept !== 'Half written' || r.view !== 'scannerWatchlists') fail('bugfix scanner-user: "New setup on this list" asks before replacing a changed draft', r);
        else ok('bugfix scanner-user: "New setup on this list" asks before replacing a draft with changes, and declined, keeps it');
      }

      /* THE WATCHLIST IMPORT. A company refused for the plan's limit was
         reported as "not recognised"; an entry that is not a list threw
         part-way through the import. */
      {
        const r = await evaluate(`(() => {
          const keepWl = localStorage.getItem('vl.watchlists'), keepState = JSON.parse(JSON.stringify(State.watchlists)), keepIdx = State.wlIdx, keepPlan = State.plan;
          const out = {};
          try {
            State.plan = 'free';
            const ids = U.filter(r => r.c.real).slice(0, 30).map(r => r.c.id);
            State.watchlists = [{ id: 'wl-bf', name: 'Mine', ids: [], added: {}, createdAt: null, updatedAt: null, schema: 2 }]; State.wlIdx = 0;
            const big = watchlistsImport({ watchlists: [{ name: 'Mine', items: ids.map(companyId => ({ companyId })) }] });
            Object.assign(out, { limit: LIMITS.watchlistStocks, added: big.added, unresolved: big.unresolved.length, refused: big.refused.length });
            try { const odd = watchlistsImport([null, { name: 'Mine', ids: [] }]); out.odd = odd.refused; } catch (e) { out.odd = 'threw ' + e.message; }
          } finally { State.plan = keepPlan; State.watchlists = keepState; State.wlIdx = keepIdx; if (keepWl == null) localStorage.removeItem('vl.watchlists'); else localStorage.setItem('vl.watchlists', keepWl); }
          return out;
        })()`);
        const p = [];
        if (r.added !== r.limit || r.unresolved !== 0 || r.refused !== 30 - r.limit) p.push(`30 companies into a list of ${r.limit}: ${r.added} added, ${r.unresolved} "not recognised", ${r.refused} refused`);
        if (!Array.isArray(r.odd) || r.odd[0] !== 'entry 1: not a watchlist') p.push(`an entry that is not a list: ${JSON.stringify(r.odd)}`);
        if (p.length) fail('bugfix scanner-user: the watchlist import tells a refusal from a name it cannot resolve', p);
        else ok(`bugfix scanner-user: the watchlist import tells a refusal from a name it cannot resolve — ${r.refused} companies over the free plan's ${r.limit} refused with the reason, none "not recognised"; an entry that is not a list refused by position`);
      }
      if (bfThrown.length) fail('bugfix scanner-user: the pages threw', bfThrown.slice(0, 5));
    } finally {
      ws.removeEventListener('message', bfListen);
      await evaluate(scanRestoreP3);
    }

    /* A DAMAGED WATCHLIST STORE STOPPED THE APP. migrateWatchlists runs at
       the top of the one script, and a null or text entry, or an object in
       place of the list, threw there: every page blank until storage was
       cleared. The page boots, the readable lists are kept, and with none
       readable the reader has one empty list. */
    {
      const keep = await evaluate(`localStorage.getItem('vl.watchlists')`);
      const boot = async (value) => {
        if (value === undefined) await evaluate(`localStorage.removeItem('vl.watchlists'); true`);
        else await evaluate(`localStorage.setItem('vl.watchlists', ${JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value))}); true`);
        await send('Page.reload', {}, sessionId);
        let up = null;
        for (let i = 0; i < 40 && !up; i++) { await bfSleep(500); try { up = await evaluate(`typeof realPending !== 'undefined' && !realPending ? true : null`); } catch { /* booting */ } }
        await bfSleep(300);
        return evaluate(`({ up: (document.querySelector('main')?.innerText || '').length > 50,
          lists: typeof State !== 'undefined' && Array.isArray(State.watchlists) ? State.watchlists.map(w => ({ name: w?.name, ids: w?.ids, added: Array.isArray(w?.added) ? 'array' : typeof w?.added })) : null })`).catch(e => ({ up: false, err: e.message }));
      };
      const mixed = await boot([null, 'x', { id: 'wl-bf-kept', name: 'Kept', ids: ['AAPL-SEC'], added: [] }]);
      const object = await boot({ a: 1 });
      const back = await boot(keep == null ? undefined : keep);
      const p = [];
      if (!mixed.up || JSON.stringify(mixed.lists) !== JSON.stringify([{ name: 'Kept', ids: ['AAPL-SEC'], added: 'object' }])) p.push(`null, text and a list: ${JSON.stringify(mixed)}`);
      if (!object.up || object.lists?.length !== 1 || object.lists[0].ids.length !== 0) p.push(`an object in place of the lists: ${JSON.stringify(object)}`);
      if (!back.up) p.push('the page did not come back with the reader\'s own lists');
      if (p.length) fail('bugfix scanner-user: a damaged vl.watchlists does not stop the app', p);
      else ok('bugfix scanner-user: a damaged vl.watchlists does not stop the app — null and text entries are dropped and the readable list kept with its dates as an object; an object in place of the lists boots with one empty list of the reader\'s own');
    }
  }
  /* ---- end bugfix: scanner-user ---- */

  /* ---- bugfix: equities-data ---- */
  /* THE FOUR-YEAR PER-SHARE RATES READ A BREAK INSIDE THEIR OWN WINDOW. A
     share-count break anywhere in the ten stored years withheld earnings,
     book-value and dividend growth over FY2021–FY2025, and the pages said the
     count moved "inside the window": Apple's stored count breaks between
     FY2018 and FY2019. Now withheld only on a break among the five rows read. */
  {
    const r = await evaluate(`(() => {
      const a = BY_ID.get('AAPL-SEC'), n = BY_ID.get('NVDA-SEC');
      const want = (x) => { const w = x.d.eps.slice(-5); return w.length >= 2 && isNum(w[0]) && isNum(w[w.length - 1]) ? cagr(w) : null; };
      const outside = U.filter(x => x.c.real && x.m.shareSeriesBreak && !x.m.perShareBreak);
      const wrong = outside.filter(x => { const v = want(x); return !(v === x.m.eps5 || (isNum(v) && isNum(x.m.eps5) && Math.abs(v - x.m.eps5) < 1e-9)); }).map(x => x.c.tk);
      const leak = U.filter(x => x.m.perShareBreak && ['eps5', 'bv5', 'dps5'].some(k => isNum(x.m[k]))).map(x => x.c.tk);
      return { a: { eps5: a.m.eps5, want: want(a), series: !!a.m.shareSeriesBreak, window: a.m.perShareBreak },
               n: { ratio: n.m.perShareBreak?.ratio ?? null, eps5: n.m.eps5 }, outside: outside.map(x => x.c.tk), wrong, leak };
    })()`);
    const p = [];
    if (!r.a.series || r.a.window || typeof r.a.eps5 !== 'number' || Math.abs(r.a.eps5 - r.a.want) > 1e-9) p.push(`Apple's four-year EPS growth over a window with no break: ${JSON.stringify(r.a)}`);
    if (!(r.n.ratio > 5) || r.n.eps5 !== null) p.push(`Nvidia's in-window ten-for-one is the break its per-share rates are withheld on: ${JSON.stringify(r.n)}`);
    if (r.outside.length < 5 || r.wrong.length) p.push(`companies with a break only outside the window: ${r.outside.length}, eps5 differing from the window's own rate: ${r.wrong.join(', ')}`);
    if (r.leak.length) p.push(`a per-share rate survives a break inside its window: ${r.leak.join(', ')}`);
    if (p.length) fail('bugfix equities-data: the four-year per-share rates are withheld only for a split inside their five rows', p);
    else ok(`bugfix equities-data: the four-year per-share rates are withheld only for a split inside their five rows — Apple's EPS growth is ${r.a.eps5.toFixed(2)}% over a window its stored count's FY2019 break does not reach, Nvidia's is withheld on its in-window ×${r.n.ratio}, and ${r.outside.length} filers with a break outside the window carry their window's own rate`);
  }

  /* A DRAWDOWN NEEDS TWO YEARS. One reported year of revenue read as a
     revenue drawdown of exactly 0% — "sales never fell" — where the registry
     says the measure is absent. */
  {
    const r = await evaluate(`(() => {
      const c = BY_ID.get('AAPL-SEC').c;
      const at = (k) => derive({ ...c, fin: c.fin.slice(-k), years: c.years.slice(-k) }).m;
      const one = at(1), two = at(2);
      return { one: [one.revDD, one.revDD10], two: two.revDD, why: NM_WHY.revDD };
    })()`);
    if (r.one[0] !== null || r.one[1] !== null || typeof r.two !== 'number') fail('bugfix equities-data: a revenue drawdown over one reported year is absent, not 0%', r);
    else ok(`bugfix equities-data: a revenue drawdown over one reported year is absent, not 0% — with two it is ${r.two.toFixed(1)}%; the registry's reason: "${r.why}"`);
  }

  /* LICENCE PENDING IS NOT EXPORTED. The ladder said it was, on the page
     whose next card says licence-pending records are "excluded from export". */
  {
    const r = await evaluate(`(async () => {
      navigate('/data-sources');
      await new Promise(res => setTimeout(res, 400));
      const main = document.querySelector('main');
      const t = [...main.querySelectorAll('table.dt')].find(x => /In an export/.test(x.tHead?.textContent || ''));
      const row = t && [...t.tBodies[0].rows].find(x => /licence pending/i.test(x.cells[0].textContent));
      return { export: row ? row.cells[2].textContent.trim() : null, said: /excluded from export/.test(main.innerText),
               ladder: LICENCE_BY_ID['licence-pending'].export, asked: NAPIC_LICENCE_QUESTIONS.some(q => /export/i.test(q)) };
    })()`);
    if (r.export !== 'no' || r.ladder !== false || !r.said || !r.asked) fail('bugfix equities-data: a licence-pending record is not exported, as the data-sources page says', r);
    else ok('bugfix equities-data: a licence-pending record is not exported — the licence ladder\'s "In an export" reads no, beside the sentence "excluded from export" and the open NAPIC question on exports');
  }

  /* THE 52-WEEK HIGH IS DEFINED AS THE ENGINE READS IT. With highs and lows
     held the distance is from the day's high; the dictionary said "highest
     close" in all three depths. */
  {
    const r = await evaluate(`(() => { const h = METRIC_BY_K.from52.help; return { h, learn: METRIC_HELP.from52?.technical === h.technical }; })()`);
    const all = `${r.h.simple} ${r.h.context} ${r.h.technical}`;
    if (!/highs and lows/.test(r.h.technical) || /highest close of the last year|highest close over 252 sessions\) ÷/.test(all) || !r.learn) fail('bugfix equities-data: the distance from the 52-week high is defined on the high the engine uses', r.h);
    else ok('bugfix equities-data: the distance from the 52-week high is defined on the high the engine uses — the day\'s high where highs and lows are held, the highest close where they are not');
  }

  /* NO "null" IN THE ALERT FEED. A filed company entering a saved screen
     read "Quality 72, Value null" — its valuation pillar is unscored without
     a price. */
  {
    const r = await evaluate(`(async () => {
      const keep = { screens: State.savedScreens, kinds: State.alertKinds };
      try {
        const def = JSON.parse(JSON.stringify(State.screen));
        const snap = screenSnapshot(def);
        const filed = snap.matches.filter(m => BY_ID.get(m.id)?.c.real).length;
        snap.matches = snap.matches.filter(m => !BY_ID.get(m.id)?.c.real);
        State.savedScreens = [{ name: 'bugfix probe', def, snapshot: snap, alertOnMatch: true, asOf: snap.asOf, model: snap.model }];
        State.alertKinds = [...new Set([...(State.alertKinds || []), 'screen'])];
        navigate('/my/alerts');
        await new Promise(res => setTimeout(res, 400));
        const text = document.querySelector('main').innerText;
        return { filed, entered: (text.match(/is a new match for/g) || []).length, nulls: text.split('\\n').filter(l => /\\bnull\\b|undefined|NaN/.test(l)).slice(0, 3) };
      } finally { State.savedScreens = keep.screens; State.alertKinds = keep.kinds; navigate('/learn'); }
    })()`);
    if (!r.filed || !r.entered || r.nulls.length) fail('bugfix equities-data: a screen\'s new matches print an unscored pillar as a dash, never "null"', r);
    else ok(`bugfix equities-data: a screen's new matches print an unscored pillar as a dash, never "null" — ${r.entered} filed companies entering a saved screen, no null in the feed`);
  }

  /* FOCUS STAYS ON THE CONTROL. The demand selects and the weeks-of-use box
     re-render the calculator; with render() the keyboard reader landed on
     the document body after every change. */
  {
    const r = await evaluate(`(async () => {
      const keep = { weeks: State.deal.ownUseWeeks, demand: JSON.parse(JSON.stringify(State.demand || {})) };
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const change = async (sel, value) => {
        const n = document.querySelector(sel); if (!n) return 'missing';
        n.focus();
        const proto = n.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, value);
        n.dispatchEvent(new Event('change', { bubbles: true }));
        await w(120);
        return document.activeElement?.id || document.activeElement?.tagName;
      };
      try {
        navigate('/property/calculator');
        await w(400);
        const box = document.querySelector('#ownUseWeeks');
        const named = !!box && !box.hasAttribute('aria-label') && box.labels?.[0]?.textContent.trim() === 'Weeks a year you would use it yourself';
        const weeks = await change('#ownUseWeeks', '6');
        const demand = await change('#demand-employment', 'operating');
        return { weeks, demand, named };
      } finally {
        State.deal.ownUseWeeks = keep.weeks; saveDeal();
        State.demand = keep.demand; saveDemand();
        navigate('/learn');
      }
    })()`);
    if (r.weeks !== 'ownUseWeeks' || r.demand !== 'demand-employment' || !r.named) fail('bugfix equities-data: changing a demand source or the weeks of own use keeps keyboard focus on the control, and the weeks box is named by its visible label', r);
    else ok('bugfix equities-data: changing a demand source or the weeks of own use keeps keyboard focus on the control through the re-render, and the weeks box is named by its visible label');
  }

  /* THE ILLUSTRATIVE SET AGREES WITH ITSELF. Sapura's institutional stake
     (41.2%) was less than the two institutions listed under it hold (44.1%),
     so the implied free float disagreed with the holder table's "Retail and
     other"; Petronas Chemicals' risk note put a fall of 84% at "roughly 75%". */
  {
    const r = await evaluate(`(() => {
      const bad = [];
      for (const x of U.filter(x => !x.c.real && x.c.own)) {
        const o = x.c.own;
        const inst = o.top.filter(([n]) => !/founder|retail/i.test(n)).reduce((s, [, p]) => s + p, 0);
        if (inst > o.inst + 0.05) bad.push(x.c.tk + ': listed institutions ' + inst.toFixed(1) + '% above institutional ' + o.inst + '%');
        const retail = o.top.find(([n]) => /retail and other/i.test(n));
        if (retail && Math.abs(100 - o.inst - o.insider - retail[1]) > 0.05) bad.push(x.c.tk + ': free float ' + (100 - o.inst - o.insider).toFixed(1) + '% against "Retail and other" ' + retail[1] + '%');
        const said = /fallen (?:about|roughly) (\\d+)% peak-to-trough/.exec(x.c.qrisk || '');
        if (said) { const dd = maxDrawdown(x.d.ni); if (Math.abs(dd - Number(said[1])) > 2) bad.push(x.c.tk + ': says ' + said[1] + '%, net income fell ' + dd.toFixed(1) + '%'); }
      }
      return bad;
    })()`);
    if (r.length) fail('bugfix equities-data: the illustrative ownership and risk notes agree with the figures beside them', r);
    else ok('bugfix equities-data: the illustrative ownership and risk notes agree with the figures beside them — no listed institutions above the institutional stake, every "Retail and other" equal to the implied free float, every stated earnings fall equal to the rows');
  }

  /* WHAT THE SCORE TESTS, STATED AS IT IS. Balance Sheet was "tested" — in
     full — over its own list of three untested factors, and named net
     gearing, which no pillar scores. */
  {
    const r = await evaluate(`(async () => {
      const scored = new Set([...Object.values(PILLARS).flatMap(p => Object.values(p).filter(Array.isArray).flat()), ...VALUE_PILLAR.all].map(i => i.k));
      const full = SCORECARD_COVERAGE.filter(p => p.state === 'tested' && p.untested.length).map(p => p.pillar);
      const unscored = SCORECARD_COVERAGE.flatMap(p => p.tested).filter(l => l === METRIC_BY_K.netGearing.label && !scored.has('netGearing'));
      openResearch('AAPL-SEC', 'quality');
      await new Promise(res => setTimeout(res, 500));
      const said = (document.querySelector('main').innerText.match(/\\d of 5 pillars are tested in full[^.]*/) || [''])[0];
      navigate('/learn');
      return { full, unscored, said };
    })()`);
    if (r.full.length || r.unscored.length || !/^0 of 5 pillars are tested in full/.test(r.said)) fail('bugfix equities-data: the scorecard coverage calls no pillar tested in full while it lists untested factors, and names only scored inputs', r);
    else ok(`bugfix equities-data: the scorecard coverage calls no pillar tested in full while it lists untested factors, and names only scored inputs — "${r.said}"`);
  }

  /* THE FEED NAMES THE PACK A COMPANY IS VALUED ON. A revenue drawdown over
     25% said the model "has been routed to a mid-cycle normalised pack" for
     every company, and the router reads the business type: Pfizer, 3M and
     Mastercard are valued on the FCFF pack. */
  {
    const r = await evaluate(`(() => {
      const items = FEED.filter(f => f.kind === 'fundamental' && /revenue drawdown/.test(f.title));
      const wrong = items.filter(f => /routed to a mid-cycle/.test(f.detail) !== (BY_ID.get(f.id).val.pack.id === 'dcfMid')).map(f => f.id);
      return { n: items.length, other: items.filter(f => BY_ID.get(f.id).val.pack.id !== 'dcfMid').map(f => BY_ID.get(f.id).c.tk), wrong };
    })()`);
    if (!r.other.length || r.wrong.length) fail('bugfix equities-data: a drawdown in the change feed names the pack the company is actually valued on', r);
    else ok(`bugfix equities-data: a drawdown in the change feed names the pack the company is actually valued on — ${r.n} drawdown items, ${r.other.join(', ')} not on the mid-cycle pack and not said to be`);
  }
  /* ---- end bugfix: equities-data ---- */

  /* ---- bugfix: shell ---- */
  /* THE SHELL: search, drawer, plans, charts, storage, theme and the router's
     legacy links, each checked against the defect it had. */
  const shellWait = `const w = (ms) => new Promise(r => setTimeout(r, ms));`;
  {
    /* A search closed and reopened inside its 200ms fade: the close's timer
       hid the new box and emptied it while searchOpen said it was open. */
    const r = await evaluate(`(async () => {
      ${shellWait}
      navigate('/learn'); await w(60);
      openSearch(); await w(250); closeSearch(); openSearch(); await w(350);
      const out = { open: searchOpen, hidden: searchModal.hidden, results: searchResults.children.length, focus: document.activeElement === searchInput };
      closeSearch(); await w(260);
      return out;
    })()`);
    if (!r.open || r.hidden || !r.results || !r.focus) fail('shell: a search reopened while the last one is still fading stays open, filled and focused', r);
    else ok(`shell: a search reopened while the last one is still fading stays open, filled and focused (${r.results} rows)`);
  }
  {
    /* A drawer that repaints itself (a metric's explanation changing depth)
       recorded its own button as the opener, so closing it lost focus. And
       Escape with the search open over a drawer closed both. */
    const r = await evaluate(`(async () => {
      ${shellWait}
      const depth0 = State.explainDepth;
      navigate('/company/AAPL-SEC'); await w(150);
      const opener = document.querySelector('main .metric-label');
      if (!opener) return { missing: true };
      opener.focus(); opener.click(); await w(350);
      const btn = [...document.querySelectorAll('#drawerBody .segmented button')][2];
      btn.focus(); btn.click(); await w(80);
      closeDrawer(); await w(420);
      const back = document.activeElement === opener;
      setExplainDepth(depth0 || 'simple');
      openDrawer('Check', el('div', {}, el('button', { id: 'bf-shell-inner', type: 'button' }, 'inside')));
      await w(350);
      document.getElementById('bf-shell-inner').focus();
      openSearch(); await w(80);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await w(300);
      const esc1 = { search: searchOpen, drawer: drawer.dataset.open, focus: document.activeElement?.id || document.activeElement?.tagName };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await w(420);
      return { back, esc1, esc2: drawer.dataset.open };
    })()`);
    const p = [];
    if (r.missing) p.push('no metric label on /company/AAPL-SEC');
    if (!r.missing && !r.back) p.push('closing a drawer that repainted itself did not return focus to the control that opened it');
    if (!r.missing && (r.esc1.search || r.esc1.drawer !== '1' || r.esc1.focus !== 'bf-shell-inner')) p.push(`one Escape over a drawer should close only the search and return focus inside the drawer: ${JSON.stringify(r.esc1)}`);
    if (!r.missing && r.esc2 !== '0') p.push('a second Escape did not close the drawer');
    if (p.length) fail('shell: a drawer keeps its opener across a repaint, and Escape closes the top dialog only', p);
    else ok('shell: a drawer keeps its opener across a repaint, and Escape closes the search over a drawer without closing the drawer');
  }
  {
    /* A plan switch left a comparison of five under a page that said two. */
    const r = await evaluate(`(() => {
      const keep = { plan: State.plan, compare: State.compare.slice() };
      State.plan = 'pro'; State.compare = ['AAPL-SEC', 'MSFT-SEC', 'NVDA-SEC', 'MAYBANK', 'PBBANK'];
      setPlan('free');
      const out = { n: State.compare.length, cap: lim('compare') };
      State.plan = keep.plan; store.write('plan', keep.plan); State.compare = keep.compare; render();
      return out;
    })()`);
    if (r.n > r.cap) fail('shell: switching to a lower plan clamps the comparison to its cap', r);
    else ok(`shell: switching to a lower plan clamps the comparison to its cap (${r.n} of ${r.cap})`);
  }
  {
    /* The report meter keyed on the UTC month. At 00:30 on the first of a
       month in Kuala Lumpur it is still the last day of the old month in UTC,
       so the old month's spent allowance still blocked the reader. */
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Kuala_Lumpur' }, sessionId);
    let r;
    try {
      r = await evaluate(`(() => {
        const keep = { plan: State.plan, log: JSON.stringify(State.reportLog) };
        const M = new Date().toISOString().slice(0, 7);
        const [y, m] = M.split('-').map(Number);
        const firstLocal = new Date(Date.UTC(y, m, 1, 0, 30) - 8 * 3600e3);
        State.plan = 'free';
        State.reportLog = { month: M, ids: ['A', 'B', 'C', 'D', 'E'] };
        const res = reportAllowed('F', firstLocal);
        const out = { ok: res.ok, month: State.reportLog.month, utc: firstLocal.toISOString() };
        State.plan = keep.plan; State.reportLog = JSON.parse(keep.log);
        return out;
      })()`);
    } finally { await send('Emulation.setTimezoneOverride', { timezoneId: '' }, sessionId); }
    if (!r.ok) fail('shell: the company-report meter resets on the reader\'s own first of the month', r);
    else ok(`shell: the company-report meter resets on the reader's own first of the month (${r.utc} is ${r.month} in Kuala Lumpur)`);
  }
  {
    /* The table under the timeframe bars judged the floor on the unrounded
       score while the bars and the gates round it: 59.5 read "clear" above
       and "no" below. And a column chart given no figure at all divided by a
       zero span and wrote NaN into the axis — the Ownership tab of every
       filed company without a share count. */
    const r = await evaluate(`(() => {
      const host = el('div', { style: 'width:600px' }); document.body.append(host);
      const tf = (s) => ({ present: true, score: s, coverage: 1, unknown: [] });
      timeframeScoreBars(host, { monthly: tf(59.5), weekly: tf(70), daily: tf(80) }, { monthly: 60, weekly: 50, daily: 40 });
      const bar = /Monthly 60 against a floor of 60, clear/.test(host.querySelector('svg').getAttribute('aria-label'));
      const cell = [...host.querySelectorAll('tbody tr')][0].children[4].textContent;
      host.replaceChildren();
      const nan = (n) => [...n.querySelectorAll('*')].filter(x => [...x.attributes].some(a => /NaN|Infinity/.test(a.value))).length;
      columnChart(host, { cats: ['FY2023', 'FY2024'], series: [{ key: 'x', label: 'X', values: [null, null], varName: '--s1' }] });
      const empty = { nan: nan(host), said: /nothing to draw/.test(host.textContent) };
      host.replaceChildren();
      columnChart(host, { cats: ['FY2023', 'FY2024'], series: [{ key: 'x', label: 'X', values: [0, 0], varName: '--s1' }] });
      const zero = nan(host);
      host.remove();
      return { bar, cell, empty, zero };
    })()`);
    const p = [];
    if (!r.bar || r.cell !== 'yes') p.push(`a monthly 59.5 against 60: the bar says ${r.bar ? 'clear' : 'short'}, the table says "${r.cell}"`);
    if (r.empty.nan || !r.empty.said) p.push(`a column chart with no figure: ${r.empty.nan} NaN attributes, absence ${r.empty.said ? '' : 'not '}stated`);
    if (r.zero) p.push(`an all-zero column chart wrote ${r.zero} NaN attributes`);
    if (p.length) fail('shell: the timeframe table clears a floor as the engine does; an empty or flat column chart draws no NaN', p);
    else ok('shell: the timeframe table clears a floor as the engine does (59.5 against 60), and a column chart with no figure says so instead of drawing NaN');
  }
  {
    /* A multiple that rounds to zero printed with a hyphen — Nvidia's net
       debt of −0.016× EBIT read "-0.0×" — and a capitalisation a hair under
       a unit printed as 1000 of the unit below it. */
    const r = await evaluate(`({ nz: fmtX(-0.016), neg: fmtX(-1.24), pos: fmtX(2.5, 2), t: fmtCap(999.97, 'USD'), b: fmtCap(0.9997, 'MYR'), m: fmtCap(0.4, 'MYR'),
      page: (() => { const m = BY_ID.get('NVDA-SEC')?.m?.ndEbit; return isNum(m) ? fmtX(m) : null; })() })`);
    const want = { nz: '0.0×', neg: '−1.2×', pos: '2.50×', t: '$1.00T', b: 'RM1.0B', m: 'RM400M' };
    const p = Object.entries(want).filter(([k, v]) => r[k] !== v).map(([k, v]) => `${k}: ${r[k]} (want ${v})`);
    if (r.page && /^-/.test(r.page)) p.push(`NVDA net debt / EBIT prints ${r.page}`);
    if (p.length) fail('shell: multiples and capitalisations round before they take a sign or a unit', p);
    else ok(`shell: multiples and capitalisations round before they take a sign or a unit (NVDA net debt / EBIT ${r.page})`);
  }
  {
    /* Labels inside a coloured cell: the ink switched at luminance 0.42 and
       put white on mid-tone fills at 2.3-2.9:1. Every diverging step, both
       themes, must now clear 4.5:1 with the ink inkOn picks. */
    const r = await evaluate(`(async () => {
      ${shellWait}
      const lum = (h) => { const m = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const six = (h) => h.length === 4 ? '#' + [...h.slice(1)].map(x => x + x).join('') : h;
      const had = document.documentElement.dataset.theme;
      const bad = [];
      for (const t of ['light', 'dark']) {
        document.documentElement.dataset.theme = t; await w(30);
        DIVERGING.forEach(v => { const f = cssVar(v), ink = six(inkOn(f)); const a = lum(f), b = lum(ink);
          const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (cr < 4.5) bad.push(t + ' ' + v + ' ' + f + ' ' + ink + ' ' + cr.toFixed(2)); });
      }
      if (had) document.documentElement.dataset.theme = had; else delete document.documentElement.dataset.theme;
      return bad;
    })()`);
    if (r.length) fail('shell: a label inside a diverging fill clears 4.5:1 in both themes', r);
    else ok('shell: a label inside a diverging fill clears 4.5:1 on every step of the ramp in both themes');
  }
  {
    /* With no theme chosen the palette follows the OS, and what is drawn with
       colours read from it must follow as well: an OS switch left the heatmap
       in the other theme's fills and the toggle offering the theme showing. */
    const had = await evaluate(`(() => { const t = document.documentElement.dataset.theme || null; delete document.documentElement.dataset.theme; return t; })()`);
    let r;
    try {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
      await evaluate(`(async () => { navigate('/discover?tab=heatmap'); await new Promise(r => setTimeout(r, 400)); return true; })()`);
      const before = await evaluate(`document.querySelector('g.tile rect')?.getAttribute('fill') || null`);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
      await sleep(500);
      r = await evaluate(`(() => { const g = document.querySelector('g.tile rect'); return { fill: g?.getAttribute('fill') || null, plane: cssVar('--plane'), label: themeToggle.getAttribute('aria-label'), valueOpacity: [...document.querySelectorAll('g.tile text')].filter(t => t.hasAttribute('opacity')).length }; })()`);
      r.before = before;
    } finally {
      await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
      if (had) await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(had)}; render(); true`);
    }
    const p = [];
    if (!r.before) p.push('no heatmap tile drawn');
    else if (r.fill === r.before) p.push(`the tiles kept the light fills after the OS went dark: ${r.before} under a ${r.plane} page`);
    if (r.label !== 'Switch to the light theme') p.push(`the toggle says "${r.label}" in the dark theme`);
    if (r.valueOpacity) p.push(`${r.valueOpacity} tile labels are drawn translucent, under the contrast floor`);
    if (p.length) fail('shell: an OS theme switch with no theme chosen repaints the drawn colours and the toggle', p);
    else ok(`shell: an OS theme switch with no theme chosen repaints the drawn colours (${r.before} → ${r.fill}) and the toggle`);
  }
  {
    /* A refused storage write was swallowed and the tool said "Saved" over
       a record that was never written. The backup link swallowed a
       modified click. Saved clock times are UTC and must say so. */
    const r = await evaluate(`(async () => {
      ${shellWait}
      navigate('/us-options/wheel'); await w(200);
      const out = {};
      const keepPrompt = window.prompt, keepSet = Storage.prototype.setItem;
      const count = () => loadWork().length;
      const n0 = count();
      try {
        window.prompt = () => 'bf-shell refused';
        Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
        [...document.querySelectorAll('main button')].find(b => b.textContent.trim() === 'Save').click();
        await w(60);
      } finally { Storage.prototype.setItem = keepSet; window.prompt = keepPrompt; }
      out.toast = document.getElementById('toast').textContent;
      out.kept = count() - n0;
      const a = [...document.querySelectorAll('main a')].find(x => x.textContent.trim() === 'Back up everything');
      let seen = null;
      window.addEventListener('click', (e) => { seen = e.defaultPrevented; e.preventDefault(); }, { once: true });
      a?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
      out.ctrlPrevented = seen;
      out.path = location.pathname;
      out.stamp = fmtSaved('2026-09-28 07:28');
      return out;
    })()`);
    const p = [];
    if (/^Saved/.test(r.toast) || !/Not saved/.test(r.toast)) p.push(`a refused write was confirmed: "${r.toast}"`);
    if (r.kept) p.push(`${r.kept} record(s) appeared although the write was refused`);
    if (r.ctrlPrevented !== false || r.path !== '/us-options/wheel') p.push(`Ctrl-click on "Back up everything" was taken over by the page: ${JSON.stringify({ prevented: r.ctrlPrevented, path: r.path })}`);
    if (!/ UTC$/.test(r.stamp)) p.push(`a saved clock time prints without its zone: "${r.stamp}"`);
    if (p.length) fail('shell: a refused save is not confirmed, a modified click is the browser\'s, and saved times say UTC', p);
    else ok('shell: a refused save says it was not saved, a Ctrl-click on the backup link is left to the browser, and saved clock times say UTC');
  }
  {
    /* The workspace's Duplicate and Delete re-rendered the list and dropped
       focus on <body>. */
    const r = await evaluate(`(async () => {
      ${shellWait}
      const keepConfirm = window.confirm;
      const made = [saveWork('wheel', 'bf-shell A'), saveWork('wheel', 'bf-shell B')].map(x => x.id);
      const who = () => { const a = document.activeElement; return !a || a === document.body ? 'body' : (a.id || a.textContent.trim()); };
      const out = {};
      try {
        window.confirm = () => true;
        navigate('/my/workspace'); await w(150);
        const dup = document.getElementById('ws-dup-' + made[0]) || [...document.querySelectorAll('main .ws-acts button')].find(x => x.textContent.trim() === 'Duplicate');
        dup.focus(); dup.click(); await w(60);
        out.afterDuplicate = who();
        const del = [...document.querySelectorAll('main .ws-acts button')].find(b => b.getAttribute('aria-label') === 'Delete bf-shell B');
        del.focus(); del.click(); await w(60);
        out.afterDelete = who();
      } finally {
        window.confirm = keepConfirm;
        loadWork().filter(x => /^bf-shell/.test(x.name)).forEach(x => deleteWork(x.id));
        render();
      }
      return out;
    })()`);
    if (!/^ws-dup-/.test(r.afterDuplicate) || r.afterDelete === 'body') fail('shell: focus stays in the workspace list after Duplicate and Delete', r);
    else ok(`shell: focus stays in the workspace list after Duplicate (${r.afterDuplicate.slice(0, 22)}…) and Delete ("${r.afterDelete}")`);
  }
  {
    /* Typing in the workspace's search re-renders the list, and the caret
       came back at the start of the field: "alp" searched for "pla". Real
       key presses, because a scripted value never moves a caret. */
    await evaluate(`(async () => { saveWork('wheel', 'bf-shell Alpha'); navigate('/my/workspace'); await new Promise(r => setTimeout(r, 150)); document.getElementById('ws-q').focus(); return true; })()`);
    for (const k of ['a', 'l', 'p']) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0) }, sessionId);
      await sleep(60);
    }
    const r = await evaluate(`(() => { const out = { value: document.getElementById('ws-q')?.value, rows: document.querySelectorAll('main .ws-row:not(.ws-head)').length };
      State.workspace.q = ''; loadWork().filter(x => /^bf-shell/.test(x.name)).forEach(x => deleteWork(x.id)); render(); return out; })()`);
    if (r.value !== 'alp' || r.rows < 1) fail('shell: typing in the workspace search keeps the caret where it was', r);
    else ok('shell: typing in the workspace search keeps the caret where it was ("alp" finds the saved "bf-shell Alpha")');
  }
  {
    /* ONE PAGE, ONE ADDRESS, AND THE SITEMAP AGREES. The canonical lookup took
       the first row for a view, alias rows included, and the aliases sit above
       the rows they alias: /compare named /app/equities/compare, /methodology
       /equities/methodology, /my/watchlists the disallowed /app/watchlists.
       Every sitemap address must be its own canonical, and no address may
       name an alias as its canonical. */
    const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
    const locs = [...sm.matchAll(/<loc>https?:\/\/[^/<]+([^<]*)<\/loc>/g)].map(m => m[1] || '/');
    const r = await evaluate(`(() => {
      const locs = ${JSON.stringify(locs)};
      const own = locs.map(p => { const rt = matchRoute(p); return [p, rt ? canonicalPath(rt) : 'no route']; }).filter(([p, c]) => p !== c);
      const aliasPaths = new Set(ROUTES.filter(x => x.alias).map(x => x.path));
      const toAlias = ROUTES.filter(x => !x.path.includes(':')).map(x => [x.path, canonicalPath(x)]).filter(([, c]) => aliasPaths.has(c));
      return { n: locs.length, own, toAlias };
    })()`);
    const p = [];
    if (r.n < 20) p.push(`only ${r.n} addresses read from sitemap.xml`);
    r.own.forEach(([a, c]) => p.push(`sitemap lists ${a}, whose canonical is ${c}`));
    r.toAlias.forEach(([a, c]) => p.push(`${a} names the alias ${c} as its canonical`));
    if (p.length) fail('shell: every sitemap address is its own canonical, and no page names an alias as its canonical', p);
    else ok(`shell: every sitemap address is its own canonical (${r.n}), and no page names an alias as its canonical`);
  }
  {
    /* The loading card said the statements were "being fetched from SEC
       EDGAR". They load from this site's data/us.json, and the policy the
       site is served under lets the page connect to its own origin only. */
    const csp = (await fetch(`${BASE}/`)).headers.get('content-security-policy') || '';
    const t = await evaluate(`bootSkeleton().textContent`);
    const p = [];
    if (/fetched from SEC EDGAR/i.test(t) || !/loading from this site/.test(t)) p.push(`the loading card says: "${t.slice(0, 160)}"`);
    if (!/connect-src 'self'/.test(csp)) p.push(`the served policy no longer limits connections to the site itself: "${csp.slice(0, 120)}"`);
    if (p.length) fail('shell: the loading card says where the statements load from', p);
    else ok('shell: the loading card says the statements load from this site, as the policy (connect-src to its own origin) makes true');
  }
  {
    /* An old #research link to a filed company is read at boot, before the
       filings arrive — and fell through to /research, losing the company. */
    await send('Page.navigate', { url: `${BASE}/#research/abbv/financials` }, sessionId);
    const loaded = await waitFiled();
    const r = loaded ? await evaluate(`({ path: location.pathname + location.search, view: State.view, ticker: State.ticker, tab: State.researchTab })`) : null;
    if (!r || r.view !== 'research' || r.ticker !== 'ABBV-SEC' || r.tab !== 'financials') fail('shell: a legacy #research link to a filed company opens that company once the filings land', r);
    else ok(`shell: a legacy #research link to a filed company opens that company once the filings land (${r.path})`);
  }
  /* ---- end bugfix: shell ---- */

  /* ---- bugfix2: scanner ---- */
  /* SECOND BUG HUNT — THE SCANNER (86-scanner.js, 87-scanner-ops.js and the
     operations fixture), each check against what the page prints: a close
     printed as the engine prints a price, wherever a scanner page prints
     one; the last scan's matches dated by the run's range of bars; the
     section strip's unread count; and the fixture's replay read as the
     worker writes it. Every file is set in memory and put back, and so are
     the two stores the checks write. */
  {
    const { readFileSync } = await import('node:fs');
    const fx = (f) => readFileSync(new URL(`./scanner/fixtures/${f}`, import.meta.url), 'utf8');
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      const keepPrefs = store.read('scanPrefs', null), keepState = store.read('scanAlertState', null);
      try {
        const f = scanFixture();
        const out = {};
        const main = () => document.querySelector('main');
        const dd = (root, label) => { const dt = root ? [...root.querySelectorAll('dt')].find(d => d.textContent === label) : null; return dt ? dt.nextElementSibling.textContent : null; };
        /* The engine's rule for a price, worked here on its own: the
           close's decimals at seven significant figures, two to four, never
           shortened. */
        const px = (v) => { const s = String(Number(v.toPrecision(7))); const k = s.indexOf('.'); return v.toFixed(Math.max(2, Math.min(4, k < 0 ? 0 : s.length - k - 1))); };
        /* A history whose MATCH closes are above 10,000 and whose FLAT
           closes are 0.345 — the two a volume's format gets wrong. */
        const h = JSON.parse(JSON.stringify(f.history));
        Object.keys(h.series.MATCH).forEach(d => { h.series.MATCH[d] *= 500; });
        Object.keys(h.series.FLAT).forEach(d => { h.series.FLAT[d] = 0.345; });
        const base = scanRun([f.setup], h, { now: f.now }).alerts[0];
        const mk = (id, extra) => ({ ...base, id, key: base.key + '|' + id, ...extra });

        /* 1. The alerts table, a run's summary, the screen and the simulation. */
        scanHistoryFile = h; scanSetupsFile = { setups: [f.setup, f.setupV2] };
        scanAlertsFile = { alerts: [mk('a0b2f001', { close: 0.345 }), mk('a0b2f002', { close: 45120.5 }), mk('a0b2f003', { close: 45149.9 })] };
        store.write('scanAlertState', {}); store.write('scanPrefs', { ...scanPrefsRead(), inApp: true, muted: {}, statusFilter: 'ALL', precision: 'full' });
        navigate('/app/scanner/alerts'); await w(150);
        const at = main().querySelector('table.scan-alerts-t');
        const ci = at ? [...at.querySelectorAll('thead th')].findIndex(th => th.textContent === 'Close') : -1;
        out.table = at ? [...at.querySelectorAll('tbody tr')].map(tr => tr.children[ci]?.textContent).sort() : [];
        const sum = scanRunSummary(scanRun([f.setup], h, { now: f.now }), '');
        out.summary = [...sum.querySelectorAll('li')].map(li => li.textContent).find(t => t.includes(' · close ')) || '';
        out.summaryWant = px(h.series.MATCH[f.lastBar]);
        scanSetupsFile = { setups: [f.setup] }; scanAlertsFile = { alerts: [] }; scanOpsClock = f.now; scanOpsRead = true;
        Object.assign(scanMarketState, { market: '__all', asOf: '', result: null, setup: null });
        navigate('/app/scanner/market'); await w(100);
        [...main().querySelectorAll('button')].find(b => /Screen now/.test(b.textContent))?.click();
        for (let i = 0; i < 60 && !main().querySelector('.scan-coverage'); i++) await w(50);
        out.screen = [...main().querySelectorAll('.scan-group tbody tr')].filter(tr => tr.cells.length > 3).map(tr => [tr.cells[0].textContent, tr.cells[3].textContent]);
        out.screenWant = { MATCH: px(h.series.MATCH[f.lastBar]), FLAT: px(0.345) };
        scanSetupsFile = { setups: [f.setupV2] };
        Object.assign(scanBacktestState, { setup: null, symbol: '', from: '', to: '', view: 'events', result: null });
        navigate('/app/scanner/backtest'); await w(100);
        [...main().querySelectorAll('button')].find(b => /Run the simulation/.test(b.textContent))?.click();
        for (let i = 0; i < 80 && !main().querySelector('.scan-counts'); i++) await w(50);
        const simRows = [...main().querySelectorAll('.card')].find(c => /Matching dates/.test(c.textContent))?.querySelectorAll('tbody tr:not(.scan-detail-row)') || [];
        out.sim = [...simRows].map(tr => [tr.cells[0].textContent, tr.cells[1].textContent, tr.cells[2].textContent]).map(([s, b, c]) => [s, b, c, h.series[s]?.[b] != null ? px(h.series[s][b]) : null]);

        /* 2. An alert's page, rounded: its close, the closes that moved,
           the line's lowest and highest, and a condition's two sides. */
        const bars = Object.keys(h.series.MATCH).sort(), prevBar = bars[bars.length - 3];
        const moved = mk('a0b2f011', { candleDate: prevBar, bar: prevBar, close: h.series.MATCH[prevBar] + 0.004 });
        const big = mk('a0b2f012', { close: 45120.5, matchedConditions: base.matchedConditions.map(c => c.path === '2' ? { ...c, left: 45120, right: 45149 } : c) });
        scanSetupsFile = { setups: [f.setup] }; scanAlertsFile = { alerts: [moved, big] };
        store.write('scanPrefs', { ...scanPrefsRead(), precision: 'rounded' });
        navigate(scanAlertPath(big)); await w(200);
        const facts = Object.fromEntries([...main().querySelectorAll('.scan-fact')].map(d => [d.querySelector('.stat-label')?.textContent, d.querySelector('.scan-fact-v')?.textContent]));
        const condRows = [...main().querySelectorAll('.card')].find(c => /Every condition, with its values/.test(c.textContent))?.querySelectorAll('tbody tr') || [];
        out.detail = { close: facts['Close on the bar'], diffs: [...main().querySelectorAll('.scan-close-diffs li')].map(li => li.textContent),
          fig: main().querySelector('figcaption')?.textContent || '', conds: [...condRows].map(tr => [tr.cells[0].textContent, tr.cells[3].lastChild?.textContent, tr.cells[4].lastChild?.textContent]),
          prevBar, priceLeft: px(Array.isArray(base.matchedConditions[0].left) ? base.matchedConditions[0].left.at(-1) : base.matchedConditions[0].left) };
        store.write('scanPrefs', { ...scanPrefsRead(), precision: 'full' });

        /* 3. The last scan's matches: a run over 2026-04-03 … 2026-04-06
           that recorded one on each end. */
        const one = scanRun([f.setup], f.history, { now: f.now }).alerts[0];
        const early = { ...one, id: 'a0b2f021', key: one.key + '|early', candleDate: '2026-04-03', bar: '2026-04-03', runId: 'run-bugfix2' };
        const late = { ...one, runId: 'run-bugfix2' };
        const runRec = { id: 'run-bugfix2', kind: 'scan', trigger: 'daily', origin: 'daily', status: 'COMPLETED', startedAt: '2026-04-06T22:00:00.000Z', finishedAt: '2026-04-06T22:00:01.000Z',
          engine: 'scan ' + SCAN_VERSION, asOf: f.lastBar, asOfFrom: '2026-04-03', counts: { setups: 1, evaluated: 2, matched: 2, recorded: 2 }, readiness: [], errors: [], error: null, transitions: [] };
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setup] }; scanAlertsFile = { alerts: [early, late] }; scanRunsFile = { runs: [runRec] };
        navigate('/app/scanner'); await w(150);
        const heads = () => [...main().querySelectorAll('section.card .h-card')].map(x => x.textContent);
        out.current = { state: main().querySelector('.scan-band')?.dataset.state, head: heads().find(x => /^Matched on the last scan/.test(x)) || heads().join(' | ') };
        scanRunsFile = { runs: [{ ...runRec, setupsHash: 'not-these-setups' }] };
        navigate('/app/scanner'); await w(150);
        const mc = [...main().querySelectorAll('section.card')].find(c => /Matches as of/.test(c.querySelector('.h-card')?.textContent || ''));
        out.behind = { state: main().querySelector('.scan-band')?.dataset.state, text: mc?.innerText.slice(0, 300) || '' };
        scanRunsFile = null; scanAlertsFile = { alerts: [early, late], lastRun: { at: '2026-04-06T22:00:01.000Z', asOf: f.lastBar, asOfFrom: '2026-04-03', engine: 'scan ' + SCAN_VERSION } };
        navigate('/admin/scanner/jobs'); await w(150);
        out.lastRun = (main().innerText.match(/The alerts file records one successful run[^.]*\\./) || [''])[0];

        /* 4. The section strip's Alerts link, on three scanner pages. */
        const strip = () => { const a = [...main().querySelectorAll('nav.scan-subnav a')].find(x => (x.getAttribute('href') || '').endsWith('/app/scanner/alerts')); return a ? [a.textContent, a.getAttribute('aria-label')] : null; };
        scanHistoryFile = f.history; scanSetupsFile = { setups: [f.setup] };
        scanAlertsFile = { alerts: [mk('a0b2f031', {}), mk('a0b2f032', {}), mk('a0b2f033', {})] }; store.write('scanAlertState', {});
        out.strip = {};
        navigate('/app/scanner/alerts'); await w(150); out.strip.alerts = strip();
        navigate('/app/scanner'); await w(150); out.strip.dashboard = strip();
        navigate('/app/scanner/setups'); await w(150); out.strip.setups = strip();
        store.write('scanPrefs', { ...scanPrefsRead(), inApp: false });
        navigate('/app/scanner/setups'); await w(150); out.strip.off = strip();
        store.write('scanPrefs', { ...scanPrefsRead(), inApp: true, statusFilter: 'ALL' });
        navigate('/app/scanner/alerts'); await w(150);
        [...main().querySelectorAll('button')].find(b => b.textContent.trim() === 'Mark read')?.click(); await w(200);
        out.strip.read = strip();

        /* 5. The fixture's replay, on the runs page. */
        scanRunsFile = ${fx('scan-runs.fixture.json')}; scanAlertsFile = { alerts: [] }; scanOpsClock = '2026-04-07T09:00:00.000Z'; scanJobsState.filter = 'all';
        navigate('/admin/scanner/jobs'); await w(150);
        main().querySelectorAll('details').forEach(d => { d.open = true; });
        await w(30);
        const rd = [...main().querySelectorAll('tr.scan-detail-row')].find(tr => tr.querySelector('dd code')?.textContent === 'run-20260406T214000-4188-71e3');
        out.replay = dd(rd, 'Caught up');
        return out;
      } finally {
        restore(); scanJobsState.filter = 'all';
        try { if (keepPrefs == null) localStorage.removeItem('vl.scanPrefs'); else store.write('scanPrefs', keepPrefs); } catch { /* storage off */ }
        try { if (keepState == null) localStorage.removeItem('vl.scanAlertState'); else store.write('scanAlertState', keepState); } catch { /* storage off */ }
        navigate('/learn');
      }
    })()`);
    const p1 = [];
    if (r.table.join() !== '0.345,45120.50,45149.90') p1.push(`alerts table Close: ${r.table.join(', ')}`);
    if (!r.summary.includes(` · close ${r.summaryWant} — `)) p1.push(`run summary (want close ${r.summaryWant}): ${r.summary.slice(0, 160)}`);
    const scr = Object.fromEntries(r.screen);
    if (scr.MATCH !== r.screenWant.MATCH || scr.FLAT !== r.screenWant.FLAT) p1.push(`screen Close: ${JSON.stringify(r.screen)} (want ${JSON.stringify(r.screenWant)})`);
    if (!r.sim.length || r.sim.some(([, , c, want]) => c !== want)) p1.push(`simulation Close: ${JSON.stringify(r.sim.slice(0, 4))}`);
    const d = r.detail;
    if (d.close !== '45120.50') p1.push(`alert page, rounded, "Close on the bar": ${d.close}`);
    const movedLine = d.diffs.find(t => t.startsWith(d.prevBar)) || '';
    const [was, now] = (movedLine.match(/recorded (\S+), now (\S+)$/) || []).slice(1);
    if (!was || was === now) p1.push(`alert page, rounded, a close that moved reads: "${movedLine}"`);
    if (/\d[km]\b/.test(d.fig)) p1.push(`alert page, rounded, the closes line shortens a price: ${d.fig.slice(-120)}`);
    const c1 = d.conds.find(c => c[0] === '1'), c2 = d.conds.find(c => c[0] === '2');
    if (!c1 || c1[1] !== d.priceLeft) p1.push(`alert page, rounded, the price condition's left side: ${JSON.stringify(c1)} (want ${d.priceLeft})`);
    if (!c2 || c2[1] === c2[2]) p1.push(`alert page, rounded, the volume condition's two sides read alike: ${JSON.stringify(c2)}`);
    if (p1.length) fail('bugfix2 scanner: every scanner page prints a close as a price', p1);
    else ok(`bugfix2 scanner: every scanner page prints a close as a price, never shortened, at its own decimals — the alerts table (${r.table.join(', ')}), a run's summary, the screen (${scr.MATCH}, ${scr.FLAT}) and the simulation; and rounded, an alert's page reads its close ${d.close}, a moved close as ${was} then ${now}, and a condition's two sides apart (${c2[1]} against ${c2[2]})`);

    const p2 = [];
    if (r.current.state !== 'current' || r.current.head !== 'Matched on the last scan — bars of 2026-04-03 … 2026-04-06') p2.push(`current: ${JSON.stringify(r.current)}`);
    if (r.behind.state !== 'behind' || !r.behind.text.includes('The last successful scan evaluated bars of 2026-04-03 … 2026-04-06.')) p2.push(`behind: ${JSON.stringify(r.behind)}`);
    if (!r.lastRun.includes('on bars of 2026-04-03 … 2026-04-06')) p2.push(`runs page, the alerts file's run: ${r.lastRun}`);
    if (p2.length) fail('bugfix2 scanner: the last scan\'s matches are dated by the bars the run evaluated', p2);
    else ok('bugfix2 scanner: the last scan\'s matches are dated by the bars the run evaluated — "bars of 2026-04-03 … 2026-04-06" over a match on each, current or behind, and on the runs page for the alerts file\'s run');

    const s = r.strip, want = ['Alerts · 3', 'Alerts, 3 unread'];
    const p3 = [];
    ['alerts', 'dashboard', 'setups'].forEach(k => { if (JSON.stringify(s[k]) !== JSON.stringify(want)) p3.push(`${k}: ${JSON.stringify(s[k])}`); });
    if (JSON.stringify(s.off) !== JSON.stringify(['Alerts', null])) p3.push(`in-app off: ${JSON.stringify(s.off)}`);
    if (JSON.stringify(s.read) !== JSON.stringify(['Alerts', null])) p3.push(`after "Mark read" on every row: ${JSON.stringify(s.read)}`);
    if (p3.length) fail('bugfix2 scanner: the scanner\'s section strip shows "Alerts · n" with its accessible name', p3);
    else ok('bugfix2 scanner: the scanner\'s section strip shows "Alerts · 3", named "Alerts, 3 unread", on the alerts, dashboard and setups pages — and plain "Alerts" with in-app off or once every alert is read');

    if (!/^none — a replay evaluates the session it was asked for \(2026-04-03\) and catches nothing up$/.test(r.replay || '')) fail('bugfix2 scanner: the fixture\'s replay reads as the worker writes it', r.replay);
    else ok('bugfix2 scanner: the fixture\'s replay carries catchUp null as the worker writes it, so the runs page\'s replay sentence is exercised — "none — a replay evaluates the session it was asked for (2026-04-03) and catches nothing up"');
  }
  /* ---- end bugfix2: scanner ---- */

  /* ---- bugfix2: shell ---- */
  const levelsOf = `const lv = (h) => Number(h.getAttribute('aria-level') || h.tagName[1]);
    const skips = (hs, start) => { const out = []; let prev = start;
      hs.forEach(h => { const l = lv(h); if (l > prev + 1) out.push(prev + '→' + l + ' "' + h.textContent.trim().slice(0, 40) + '"'); prev = l; });
      return out; };`;
  {
    /* THE HEADING ORDER. cardHead titled every card h3 under a page h1 with
       no h2, so most pages stepped from h1 to h3 — the property calculator
       to h4, and the printable record and report opened on an h3 above their
       h1. Each heading's level, as assistive technology reads it (aria-level
       where the page states one, the tag otherwise), steps at most one below
       the heading before it; a page's first heading is its h1 or a heading
       that belongs to the page. */
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      ${levelsOf}
      const out = {};
      for (const p of ['/app/scanner/market', '/app/scanner/backtest', '/admin/scanner', '/admin/scanner/data', '/admin/scanner/jobs',
        '/admin/scanner/delivery', '/discover/screener', '/app/scanner/setups', '/property', '/methodology/ips', '/company/AAPL-SEC',
        '/company/AAPL-SEC/report', '/decision-record', '/learn', '/data-sources', '/methodology', '/my/alerts', '/my/theses', '/research']) {
        navigate(p); await w(150);
        const hs = [...document.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6')];
        const bad = skips(hs, 1);
        out[p] = { n: hs.length, bad, stated: hs.filter(h => h.hasAttribute('aria-level')).length };
      }
      return out;
    })()`);
    const p = Object.entries(r).filter(([, v]) => !v.n || v.bad.length).map(([k, v]) => `${k}: ${v.n ? v.bad.slice(0, 2).join(', ') : 'no headings'}`);
    const stated = Object.values(r).reduce((a, v) => a + v.stated, 0);
    if (p.length) fail('bugfix2 shell: no page\'s headings skip a level', p);
    else ok(`bugfix2 shell: no page's headings skip a level — ${Object.keys(r).length} pages, ${stated} headings given the level the page puts them at`);
  }
  {
    /* The level a page states is the level Chrome's accessibility tree
       reports: a card's h3 directly under the page h1 is a level-2 heading
       to a screen reader. */
    await evaluate(`(async () => { navigate('/app/scanner/market'); await new Promise(r => setTimeout(r, 200)); return true; })()`);
    await send('Accessibility.enable', {}, sessionId);
    const h = await send('Runtime.evaluate', { expression: `document.querySelector('main h3.h-card')` }, sessionId);
    const objectId = h.result?.result?.objectId;
    const ax = objectId ? await send('Accessibility.getPartialAXTree', { objectId, fetchRelatives: false }, sessionId) : null;
    const node = ax?.result?.nodes?.[0];
    const level = node?.properties?.find(x => x.name === 'level')?.value?.value;
    const stated = await evaluate(`document.querySelector('main h3.h-card')?.getAttribute('aria-level') || null`);
    if (node?.role?.value !== 'heading' || level !== 2 || stated !== '2') fail('bugfix2 shell: a card title under the page h1 is a level-2 heading in the accessibility tree', { role: node?.role?.value, level, stated });
    else ok('bugfix2 shell: a card title under the page h1 is a level-2 heading in the accessibility tree (an h3 stating aria-level 2)');
  }
  {
    /* A part of the page drawn after render() — a scanner run's result, a
       setup evaluated now — and a drawer's body are fitted too: the drawer's
       column headings sat an h4 under its h2 title. */
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      ${levelsOf}
      navigate('/learn'); await w(150);
      const host = document.querySelector('main .shell');
      const card = el('div', { class: 'card', id: 'bf2-shell-card' }, cardHead('Drawn after render'), el('h4', {}, 'A part of it'));
      host.append(card); await w(0);
      const late = [...card.querySelectorAll('h3, h4')].map(lv);
      card.remove();
      navigate('/discover/screener'); await w(150);
      openColumnPicker(); await w(350);
      const body = [...document.querySelectorAll('#drawerBody h1, #drawerBody h2, #drawerBody h3, #drawerBody h4, #drawerBody h5, #drawerBody h6')];
      const drawerBad = skips(body, 2);
      closeDrawer(); await w(350);
      return { late, n: body.length, drawerBad };
    })()`);
    const p = [];
    if (r.late.join() !== '2,3') p.push(`a card drawn after render reads ${r.late.join(', ')}, not 2, 3`);
    if (!r.n || r.drawerBad.length) p.push(`the column picker's headings under its h2 title: ${r.n ? r.drawerBad.slice(0, 2).join(', ') : 'none found'}`);
    if (p.length) fail('bugfix2 shell: headings drawn after render, and a drawer\'s, step one level at a time', p);
    else ok(`bugfix2 shell: headings drawn after render, and a drawer's, step one level at a time — a late card reads 2 then 3, and the column picker's ${r.n} headings sit one under its title`);
  }
  {
    /* The Trading Index dock printed "Screenshot confidence: null": a run is
       assessable before its five confidence components are scored, and the
       dock stringified the null the run carries until they are. */
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      navigate('/research/trading-index'); await w(150);
      const keep = State.qtti;
      const p = qttiWorkedExample();
      p.confidence = { metadata: null, panels: null, indicators: null, legibility: null, recency: null };
      State.qtti = p; render();
      const run = qttiRun(p);
      const fig = [...document.querySelectorAll('.dock .dock-fig')].find(f => /Screenshot confidence/.test(f.textContent));
      const out = { assessable: run.assessable, confidence: run.confidence, shown: fig?.querySelector('.dock-fig-v')?.textContent ?? null };
      State.qtti = keep; render();
      return out;
    })()`);
    if (!r.assessable || r.confidence !== null || r.shown !== '—') fail('bugfix2 shell: the Trading Index dock withholds a confidence that has not been scored', r);
    else ok('bugfix2 shell: the Trading Index dock withholds a confidence that has not been scored — an assessable run with five unscored components shows "—", not "null"');
  }
  /* ---- end bugfix2: shell ---- */

  /* ---- bugfix2: studio ---- */
  /* S2 — the studio says what its figures are. An unscored pillar is not
          "null/100" and an unassessed moat is not a low-confidence one; the
          comparison calls an earnings rate withheld only for a split inside
          its window; the compact money figure never prints a signed zero or
          a unit it has rounded past; and the comparison chart draws only what
          has both axes and names the rest. */
  {
    const r = await evaluate(`(async () => {
      const wait = (ms = 200) => new Promise(res => setTimeout(res, ms));
      const out = {};
      const keepCompare = [...State.compare];
      let restoreQ = null;
      try {
        /* 1. The seven-step review on an unscored pillar and an unassessed moat. */
        const bank = U.find(x => x.c.real && x.c.type === 'bank' && !isNum(x.scores.strength.score));
        const reit = U.find(x => x.c.real && x.c.type === 'reit' && !isNum(x.scores.quality.score));
        out.pre = { bank: bank?.c.id || null, reit: reit?.c.id || null };
        if (bank && reit) {
          const sb = sevenSteps(bank, null), sr = sevenSteps(reit, null);
          out.steps = { bank2: sb[1].note, bank2ok: sb[1].ok, reit3: sr[2].note, reit3ok: sr[2].ok, moat: sb[3].note, moatOk: sb[3].ok };
          openResearch(bank.c.id, 'thesis'); await wait(300);
          out.nullOnPage = /null\\/100/.test(document.querySelector('main').innerText);
        }

        /* 2. The comparison's earnings-rate cell, as the saved snapshot keeps it. */
        const notSplit = U.find(x => x.c.real && !isNum(x.m.eps5) && x.m.shareSeriesBreak && !x.m.perShareBreak && !['bank', 'reit'].includes(x.c.type));
        const split = U.find(x => x.c.real && !isNum(x.m.eps5) && x.m.perShareBreak && !['bank', 'reit'].includes(x.c.type));
        out.cmpPre = { notSplit: notSplit?.c.id || null, split: split?.c.id || null };
        if (notSplit && split) {
          navigate('/compare?companies=' + [notSplit.c.id, split.c.id].join(',')); await wait(400);
          const snap = CMP_LIVE && CMP_LIVE.snapshotNow();
          out.cmp = snap ? { notSplit: snap[notSplit.c.id]?.cells['Earnings CAGR (4y)'], split: snap[split.c.id]?.cells['Earnings CAGR (4y)'] } : null;
        }

        /* 3. The compact money figure, and the payoff table that showed it. */
        out.amt = [-3e-13, -0.4, -0.5, 999.4, 999.6, -999.6, 999949, 999960, 1e6].map(v => fmtAmount(v, 'USD'));
        const p = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE }, m = wheelMath(p);
        const host = document.createElement('div'); document.body.append(host);
        payoffChart(host, m, p);
        out.beRow = [...host.querySelectorAll('tr')].map(tr => [...tr.cells].map(td => td.textContent.trim())).find(c => /Break-even/.test(c[2] || '')) || null;
        host.remove();

        /* 4. The comparison chart: a company with no quality percentile is not
              drawn at 50, an unpriced one is named, and a difference under half
              a point carries no sign. */
        const noQ = U.find(x => x.c.real && !isNum(x.pct.quality) && isNum(x.val.vals?.base));
        const unpriced = U.find(x => x.c.real && !isNum(x.c.px?.p) && isNum(x.pct.quality));
        const small = U.find(x => isNum(x.val.mos?.base) && Math.abs(x.val.mos.base) < 0.5 && isNum(x.pct.quality));
        const priced = U.find(x => isNum(x.val.mos?.base) && x.val.mos.base <= -0.5 && isNum(x.pct.quality) && x !== small);
        out.chartPre = { noQ: noQ?.c.id || null, unpriced: unpriced?.c.id || null, small: small?.c.id || null, priced: priced?.c.id || null };
        if (noQ && unpriced && small && priced) {
          /* Priced as a typed price would price it, so the company without a
             quality score has a difference and would otherwise be drawn. */
          const px0 = noQ.c.px, val0 = noQ.val;
          restoreQ = () => { noQ.c.px = px0; noQ.val = val0; };
          noQ.c.px = { p: 50, manual: true }; noQ.val = valuationRun(noQ.c, noQ.d, noQ.inputs);
          navigate('/compare?companies=' + [noQ.c.id, unpriced.c.id, small.c.id, priced.c.id].join(',')); await wait(500);
          const card = [...document.querySelectorAll('main h3')].find(h => /Quality against valuation/.test(h.textContent))?.closest('.card');
          out.chart = card ? {
            labels: [...card.querySelectorAll('g[role=button]')].map(g => g.getAttribute('aria-label')),
            note: [...card.querySelectorAll('p.metaline')].map(x => x.textContent).join(' '),
            noQ: noQ.c.tk, unpriced: unpriced.c.tk, small: small.c.tk, priced: priced.c.tk } : null;
        }
      } finally {
        restoreQ?.();
        State.compare = keepCompare; store.write('compare', keepCompare);
      }
      return out;
    })()`);
    const p = [];
    if (!r.pre.bank || !r.pre.reit) p.push(`no filed bank without a Financial Strength score, or filed REIT without a Business Quality score, to test (${JSON.stringify(r.pre)})`);
    else {
      if (/null/.test(r.steps.bank2) || !/not scored/.test(r.steps.bank2) || r.steps.bank2ok) p.push(`step 2 on ${r.pre.bank} reads "${r.steps.bank2}" (satisfied: ${r.steps.bank2ok})`);
      if (/null/.test(r.steps.reit3) || !/not scored/.test(r.steps.reit3) || r.steps.reit3ok) p.push(`step 3 on ${r.pre.reit} reads "${r.steps.reit3}" (satisfied: ${r.steps.reit3ok})`);
      if (/confidence|counter-evidence/.test(r.steps.moat) || !/Not assessed/.test(r.steps.moat) || r.steps.moatOk) p.push(`step 4 on an unassessed moat reads "${r.steps.moat}"`);
      if (r.nullOnPage) p.push(`the thesis tab of ${r.pre.bank} still prints "null/100"`);
    }
    if (!r.cmpPre.notSplit || !r.cmpPre.split) p.push(`no pair of filers to test the earnings-rate cell (${JSON.stringify(r.cmpPre)})`);
    else if (!r.cmp || r.cmp.notSplit !== 'n/a' || r.cmp.split !== 'withheld')
      p.push(`the comparison's earnings rate reads ${JSON.stringify(r.cmp)} — ${r.cmpPre.notSplit}'s break is outside its window and should read n/a, ${r.cmpPre.split}'s is inside and should read withheld`);
    const wantAmt = ['$0', '$0', '−$1', '$999', '$1.0k', '−$1.0k', '$999.9k', '$1.00m', '$1.00m'];
    if (JSON.stringify(r.amt) !== JSON.stringify(wantAmt)) p.push(`fmtAmount gives ${JSON.stringify(r.amt)}, wanted ${JSON.stringify(wantAmt)}`);
    if (!r.beRow || r.beRow[1] !== '$0') p.push(`the worked contract's break-even row reads ${JSON.stringify(r.beRow)}`);
    if (!r.chartPre.noQ || !r.chartPre.unpriced || !r.chartPre.small || !r.chartPre.priced) p.push(`no companies to test the comparison chart (${JSON.stringify(r.chartPre)})`);
    else if (!r.chart) p.push('the comparison chart card did not render');
    else {
      const { labels, note, noQ, unpriced, small, priced } = r.chart;
      if (labels.some(l => l.startsWith(noQ + ','))) p.push(`${noQ}, with no quality percentile, is drawn: ${labels.find(l => l.startsWith(noQ + ','))}`);
      if (!new RegExp(noQ + ' has no Business Quality score').test(note)) p.push(`${noQ} is not named as unplotted: "${note}"`);
      if (!new RegExp(unpriced + ' carries no price').test(note)) p.push(`${unpriced} is not named as unplotted: "${note}"`);
      const sl = labels.find(l => l.startsWith(small + ','));
      if (!sl || !/, 0% to base-case/.test(sl)) p.push(`${small}'s mark reads "${sl}"`);
      const pl = labels.find(l => l.startsWith(priced + ','));
      if (!pl || !/, −\d+% to base-case/.test(pl)) p.push(`${priced}'s mark reads "${pl}"`);
    }
    if (p.length) fail('bugfix2 studio: the studio says what its figures are', p);
    else ok(`bugfix2 studio: the studio says what its figures are — an unscored pillar reads "not scored" with its missing inputs (${r.pre.bank}, ${r.pre.reit}) and an unassessed moat "Not assessed"; ${r.cmpPre.notSplit}'s earnings rate is n/a and ${r.cmpPre.split}'s withheld; the break-even row reads $0 and 999.6 reads $1.0k; the comparison chart leaves ${r.chart.noQ} and ${r.chart.unpriced} off and names why, and ${r.chart.small} reads 0%`);
  }
  /* ---- end bugfix2: studio ---- */

  /* ---- bugfix2: equities ---- */
  /* SECOND PASS, EQUITIES: what the first pass's owners reported in these
     files — a bank's pre-tax line named "Operating profit", per-share rates
     withheld on a break outside their window, saves and restores that said
     they were kept when the browser refused them, an import that hid its
     refusals, a builder draft replaced without asking, and a freshness line
     that claimed a live fetch. */
  const eq2Wait = `const w = (ms) => new Promise(r => setTimeout(r, ms));`;
  {
    /* The EBIT row of "What changed" is named as the statement names it, and
       the Filings table finds its figures by the row's key. */
    const r = await evaluate(`(async () => {
      ${eq2Wait}
      const rows = (id) => { const c = BY_ID.get(id).c, ch = changeSummary(c) || [], e = ch.find(x => x.key === 'ebit');
        return { label: e ? e.label : null, want: ebitLabel(c), keyless: ch.filter(x => !x.key).length }; };
      const out = { jpm: rows('JPM-SEC'), maybank: rows('MAYBANK'), msft: rows('MSFT-SEC') };
      navigate('/company/JPM-SEC?tab=snapshot');
      let card = null;
      for (let i = 0; i < 20 && !card; i++) { await w(100); card = [...document.querySelectorAll('#views .card')].find(c => /^What changed/.test((c.querySelector('h2,h3') || {}).textContent || '')); }
      out.rail = card ? [...card.querySelectorAll('dl.kv dt')].map(x => x.textContent) : [];
      navigate('/company/JPM-SEC?tab=filings'); await w(400);
      const trs = [...document.querySelectorAll('#views table.dt tbody tr')];
      const tr = trs.find(t => t.firstElementChild && t.firstElementChild.textContent === out.jpm.want);
      const d = BY_ID.get('JPM-SEC').d, i = d.ebit.length - 1;
      out.filings = tr ? [...tr.children].slice(1, 3).map(x => x.textContent) : null;
      out.want = [fmtNum(d.ebit[i - 1], 2), fmtNum(d.ebit[i], 2)];
      out.opRow = trs.some(t => t.firstElementChild && t.firstElementChild.textContent === 'Operating profit');
      return out;
    })()`);
    const p = [];
    for (const k of ['jpm', 'maybank', 'msft']) if (r[k].label !== r[k].want || r[k].keyless) p.push(`${k}: the change row reads "${r[k].label}", the statement "${r[k].want}"${r[k].keyless ? `, ${r[k].keyless} row(s) without a key` : ''}`);
    if (!r.rail.includes(r.jpm.want) || r.rail.includes('Operating profit')) p.push(`JPMorgan's snapshot "What changed" lists ${JSON.stringify(r.rail.slice(0, 8))}`);
    if (r.opRow || JSON.stringify(r.filings) !== JSON.stringify(r.want)) p.push(`JPMorgan's Filings table: row ${JSON.stringify(r.filings)} against ${JSON.stringify(r.want)}${r.opRow ? ', and an "Operating profit" row' : ''}`);
    if (p.length) fail('bugfix2 equities: "What changed" names the EBIT row as the statement does, and the Filings table reads it by key', p);
    else ok(`bugfix2 equities: "What changed" names the EBIT row as the statement does — JPMorgan "${r.jpm.want}" (${r.filings.join(' → ')}), Maybank "${r.maybank.want}", Microsoft "${r.msft.want}" — on the snapshot and the Filings table`);
  }
  {
    /* The four-year per-share rates are said to be withheld only for a
       break inside their own five rows; the share-count rate names no cause
       nothing here can know. */
    const r = await evaluate(`(async () => {
      ${eq2Wait}
      const wrong = [];
      U.forEach(x => ['eps5', 'dps5', 'bv5'].forEach(k => {
        if (isNum(x.m[k])) return;
        const s = metricStatus(x, k), said = s.reason === 'withheld' && /share count moves/.test(s.text || '');
        if (said && !x.m.perShareBreak) wrong.push(x.c.tk + ' ' + k + ' withheld with no break in its window');
        if (!said && x.m.perShareBreak && s.reason !== 'not applicable') wrong.push(x.c.tk + ' ' + k + ' not said withheld: ' + s.reason);
      }));
      const nv = BY_ID.get('NVDA-SEC'), ge = metricStatus(BY_ID.get('GE-SEC'), 'eps5'), nvs = metricStatus(nv, 'eps5'), o = metricStatus(BY_ID.get('O-SEC'), 'dilution');
      navigate('/company/GE-SEC?tab=quality'); await w(400);
      const geRow = [...document.querySelectorAll('#views table.dt tbody tr')].find(t => t.firstElementChild && t.firstElementChild.textContent === 'Earnings CAGR (4y)');
      navigate('/company/GOOGL-SEC?tab=ownership'); await w(400);
      const dt = [...document.querySelectorAll('#views dl.kv dt')].find(d => /Dividend per share CAGR/.test(d.textContent));
      return { wrong, ge: ge.reason, nv: nvs.reason, nvNames: (nvs.text || '').includes(fmtNum(nv.m.perShareBreak.to, 2) + 'bn'), oCause: /not issuance/.test(o.text || ''),
        geCell: geRow ? geRow.children[1].textContent : null, googlDps: dt ? dt.nextElementSibling.textContent : null };
    })()`);
    const p = [...r.wrong.slice(0, 6)];
    if (r.ge === 'withheld' || r.geCell === 'withheld') p.push(`GE's earnings growth (a negative FY2021 base) reads withheld: drawer ${r.ge}, quality tab "${r.geCell}"`);
    if (r.nv !== 'withheld' || !r.nvNames) p.push(`Nvidia's earnings growth is not withheld on its in-window step: ${r.nv}`);
    if (r.oCause) p.push('Realty Income\'s share-count rate calls its merger "a corporate action, not issuance"');
    if (/Withheld/.test(r.googlDps || '')) p.push(`Alphabet's dividend CAGR reads "${r.googlDps}" with no break in its window`);
    if (p.length) fail('bugfix2 equities: a per-share rate is said withheld only for a break inside its own window', p);
    else ok(`bugfix2 equities: a per-share rate is said withheld only for a break inside its own window — GE's earnings growth reads "${r.geCell}" (${r.ge}), Alphabet's dividend CAGR "${r.googlDps}", Nvidia's is withheld naming its in-window step`);
  }
  {
    /* A refused write is never confirmed: the saved-work helpers return
       nothing, a backup restores all or nothing, and the data page, the
       screener and a typed price say so instead of "Saved", "Deleted" or a
       silent reload. */
    const r = await evaluate(`(async () => {
      ${eq2Wait}
      const keepSet = Storage.prototype.setItem, keepPrompt = window.prompt, keepConfirm = window.confirm;
      const full = () => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; };
      const unfull = () => { Storage.prototype.setItem = keepSet; };
      const toast = () => document.getElementById('toast').textContent;
      const out = {};
      const base = saveWork('wheel', 'bf2-eq base');
      try {
        full(); try { out.save = saveWork('wheel', 'bf2-eq refused'); out.dup = duplicateWork(base.id); } finally { unfull(); }
        out.kept = loadWork().filter(x => /^bf2-eq/.test(x.name)).length;
        localStorage.setItem('vl.bf2A', JSON.stringify('before')); localStorage.removeItem('vl.bf2B');
        let n = 0; Storage.prototype.setItem = function (k, v) { if (++n === 2) throw new DOMException('full', 'QuotaExceededError'); return keepSet.call(this, k, v); };
        try { out.restore = restoreBackup(JSON.stringify({ format: 'quantum-tradeworks-backup', version: 1, data: { bf2A: 'after', bf2B: 'after' } })); } finally { unfull(); }
        out.restoreA = localStorage.getItem('vl.bf2A'); out.restoreB = localStorage.getItem('vl.bf2B');
        localStorage.removeItem('vl.bf2A'); localStorage.removeItem('vl.bf2B');
        navigate('/my/data'); await w(250);
        window.confirm = () => true;
        const del = [...document.querySelectorAll('#views button')].find(x => x.textContent.trim() === 'Delete');
        full(); try { del.click(); } finally { unfull(); window.confirm = keepConfirm; }
        await w(60); out.delToast = toast(); out.delKept = loadWork().some(x => x.id === base.id);
        const ta = document.querySelector('#views textarea[aria-label="Paste closes"]');
        ta.value = '2026-08-06,7.93'; document.getElementById('ud-sym').value = 'BF2EQ';
        full(); try { [...document.querySelectorAll('#views button')].find(x => x.textContent.trim() === 'Read what I pasted').click(); } finally { unfull(); }
        await w(60);
        const card = ta.closest('.card');
        out.pasteReload = [...card.querySelectorAll('button')].some(x => x.textContent.trim() === 'Reload to apply');
        out.pasteSays = card.textContent.includes(STORE_REFUSED); out.pasteMemory = !!userData.series.BF2EQ;
        navigate('/discover/screener'); await w(300);
        const s0 = State.savedScreens.length; window.prompt = () => 'bf2-eq screen';
        full(); try { saveScreen(); } finally { unfull(); window.prompt = keepPrompt; }
        await w(60); out.screenToast = toast(); out.screenHeld = State.savedScreens.length - s0;
      } finally {
        Storage.prototype.setItem = keepSet; window.prompt = keepPrompt; window.confirm = keepConfirm;
        loadWork().filter(x => /^bf2-eq/.test(x.name)).forEach(x => deleteWork(x.id));
        State.savedScreens = State.savedScreens.filter(x => x.name !== 'bf2-eq screen'); store.write('savedScreens', State.savedScreens);
      }
      return out;
    })()`);
    /* A typed price reloads the page when it is kept. Refused, it reloaded
       anyway and came back without it, saying nothing — so the page is
       marked, and a reload is seen as the mark gone. */
    await evaluate(`(async () => { ${eq2Wait} navigate('/company/JPM-SEC'); await w(400);
      const keepSet = Storage.prototype.setItem, px = document.getElementById('realpx');
      window.__bf2Had = manualPrices['JPM-SEC'] ?? null; px.value = '123.45';
      Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      try { px.dispatchEvent(new Event('change', { bubbles: true })); } finally { Storage.prototype.setItem = keepSet; }
      return true; })()`);
    await sleep(300); await waitFiled();
    Object.assign(r, await evaluate(`({ pxToast: document.getElementById('toast').textContent, pxReloaded: window.__bf2Had === undefined,
      pxHeld: window.__bf2Had !== undefined && (manualPrices['JPM-SEC'] ?? null) === window.__bf2Had })`));
    /* A saved screen's Delete, and Remove on a pasted series (which reloads
       when it is kept), each under a refused write. */
    Object.assign(r, await evaluate(`(async () => { ${eq2Wait}
      const keepSet = Storage.prototype.setItem, keepPrompt = window.prompt;
      const full = () => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; };
      const out = {};
      navigate('/discover/screener'); await w(300);
      window.prompt = () => 'bf2-eq screen'; try { saveScreen(); } finally { window.prompt = keepPrompt; }
      openSavedScreen(State.savedScreens.findIndex(x => x.name === 'bf2-eq screen')); await w(150);
      const del = [...document.querySelectorAll('button')].filter(x => x.textContent.trim() === 'Delete').pop();
      full(); try { del.click(); } finally { Storage.prototype.setItem = keepSet; }
      await w(60); out.screenDelToast = document.getElementById('toast').textContent;
      out.screenDelHeld = State.savedScreens.some(x => x.name === 'bf2-eq screen');
      closeDrawer();
      State.savedScreens = State.savedScreens.filter(x => x.name !== 'bf2-eq screen'); store.write('savedScreens', State.savedScreens);
      userData.series.BF2EQ = { '2026-08-06': 7.93 }; saveUserData();
      navigate('/my/data'); await w(250);
      window.__bf2Mark = 1;
      const rm = [...document.querySelectorAll('#views tr')].find(t => t.firstElementChild && t.firstElementChild.textContent === 'BF2EQ');
      full(); try { rm.querySelector('button').click(); } finally { Storage.prototype.setItem = keepSet; }
      return out;
    })()`));
    await sleep(300); await waitFiled();
    Object.assign(r, await evaluate(`(() => { const out = { rmReloaded: window.__bf2Mark === undefined, rmToast: document.getElementById('toast').textContent, rmHeld: !!userData.series.BF2EQ };
      delete userData.series.BF2EQ; saveUserData(); return out; })()`));
    const p = [];
    if (r.pxReloaded) p.push('a typed price the browser refused reloaded the page, which came back without it and said nothing');
    if (!/^Not deleted/.test(r.screenDelToast || '') || !r.screenDelHeld) p.push(`a saved screen's refused Delete toasts "${r.screenDelToast}" and ${r.screenDelHeld ? 'keeps' : 'drops'} it`);
    if (r.rmReloaded || !/^Not deleted/.test(r.rmToast || '') || !r.rmHeld) p.push(`Remove on a pasted series under a refused write: ${JSON.stringify({ reloaded: r.rmReloaded, toast: r.rmToast, held: r.rmHeld })}`);
    if (r.save || r.dup) p.push(`saveWork/duplicateWork returned a record the browser refused: ${JSON.stringify({ save: !!r.save, dup: !!r.dup })}`);
    if (r.kept !== 1) p.push(`${r.kept} bf2 records held, not the one base record`);
    if (!r.restore || r.restore.ok || r.restoreA !== '"before"' || r.restoreB !== null) p.push(`a backup refused part-way reports ${JSON.stringify(r.restore)} and leaves A=${r.restoreA}, B=${r.restoreB}`);
    if (!/^Not deleted/.test(r.delToast || '') || !r.delKept) p.push(`/my/data Delete under a refused write toasts "${r.delToast}"`);
    if (r.pasteReload || !r.pasteSays || r.pasteMemory) p.push(`a paste the browser refused offers "Reload to apply": ${JSON.stringify({ reload: r.pasteReload, says: r.pasteSays, memory: r.pasteMemory })}`);
    if (!/^Not saved/.test(r.screenToast || '') || r.screenHeld) p.push(`a refused screen save toasts "${r.screenToast}" and lists ${r.screenHeld} screen(s)`);
    if (!/^Not saved/.test(r.pxToast || '') || !r.pxHeld) p.push(`a refused price toasts "${r.pxToast}"`);
    if (p.length) fail('bugfix2 equities: a write the browser refuses is never confirmed as kept', p);
    else ok('bugfix2 equities: a write the browser refuses is never confirmed as kept — saveWork and duplicateWork return nothing, a backup refused part-way puts back what it wrote, and /my/data, the screener and a typed price say "Not saved" or "Not deleted"');
  }
  {
    /* The import toast carries the refusals; "Use as scanner universe" asks
       before replacing a changed draft; the freshness line claims no fetch. */
    const r = await evaluate(`(async () => {
      ${eq2Wait}
      const keepPlan = State.plan, keepLists = JSON.parse(JSON.stringify(State.watchlists)), keepRaw = localStorage.getItem('vl.watchlists'), keepIdx = State.wlIdx;
      const keepConfirm = window.confirm, keepDraft = scanDraft;
      const out = {};
      try {
        State.plan = 'free';
        navigate('/my/watchlists'); await w(250);
        const ids = U.filter(x => x.c.real).slice(0, 30).map(x => x.c.id);
        const doc = { watchlists: [{ name: State.watchlists[0].name, items: ids.map(companyId => ({ companyId })) }, { name: 'bf2-eq second', ids: ids.slice(0, 2) }] };
        const inp = document.querySelector('#views input[type=file][aria-label="Import a watchlists file"]');
        const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(doc)], 'w.json', { type: 'application/json' }));
        inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
        await w(300); out.toast = document.getElementById('toast').textContent;
      } finally {
        State.plan = keepPlan; State.watchlists = keepLists; State.wlIdx = keepIdx;
        if (keepRaw === null) localStorage.removeItem('vl.watchlists'); else localStorage.setItem('vl.watchlists', keepRaw);
      }
      try {
        navigate('/my/watchlists'); await w(250);
        scanDraft = { ...scanBlankDraft(), name: 'bf2-eq typed' };
        let asked = null; window.confirm = (m) => { asked = m; return false; };
        [...document.querySelectorAll('#views button')].find(x => x.textContent.trim() === 'Use as scanner universe').click();
        await w(150);
        out.asked = !!asked; out.kept = scanDraft && scanDraft.name === 'bf2-eq typed'; out.stayed = location.pathname;
        scanDraft = null; asked = null;
        navigate('/my/watchlists'); await w(250);
        [...document.querySelectorAll('#views button')].find(x => x.textContent.trim() === 'Use as scanner universe').click();
        await w(250);
        out.blankAsked = !!asked; out.opened = location.pathname; out.universe = scanDraft && scanDraft.universe && scanDraft.universe.kind;
      } finally { window.confirm = keepConfirm; scanDraft = keepDraft; }
      /* The freshness card moved with the research queue (Release A). */
      navigate('/research/queue'); await w(300);
      const fresh = () => [...document.querySelectorAll('#views .card')].find(c => /Freshness/.test(c.textContent));
      out.loaded = fresh() ? fresh().textContent : null;
      const keepStatus = realStatus; realStatus = null; render(); await w(60);
      out.loading = fresh() ? fresh().textContent : null;
      realStatus = keepStatus; render();
      return out;
    })()`);
    const p = [];
    if (!/[0-9]+ refused — [^;]*maximum of 25/.test(r.toast) || !/bf2-eq second/.test(r.toast)) p.push(`the Free-plan import toast: "${r.toast}"`);
    if (!r.asked || !r.kept || r.stayed !== '/my/watchlists') p.push(`a changed draft and "Use as scanner universe": ${JSON.stringify({ asked: r.asked, kept: r.kept, at: r.stayed })}`);
    if (r.blankAsked || r.opened !== '/app/scanner/setups/new' || r.universe !== 'watchlist') p.push(`with no draft open: ${JSON.stringify({ asked: r.blankAsked, at: r.opened, universe: r.universe })}`);
    for (const [k, t] of [['loaded', r.loaded], ['loading', r.loading]]) if (!t || /(from|filings from) SEC EDGAR[.…]/.test(t) || /Loading filings from SEC EDGAR|loaded from SEC EDGAR/.test(t)) p.push(`the ${k} freshness line claims a fetch from SEC EDGAR: "${(t || 'no card').slice(0, 200)}"`);
    if (p.length) fail('bugfix2 equities: the import names its refusals, the scanner draft is asked for, the freshness line claims no fetch', p);
    else ok(`bugfix2 equities: the import names its refusals ("${(r.toast.match(/[0-9]+ refused — [^(]*/) || [''])[0].trim()}"), a changed scanner draft is asked for and an empty one is not, and the freshness line says the statements were retrieved when the dataset was built`);
  }
  /* ---- end bugfix2: equities ---- */

  /* ---- bugfix3: sweep ---- */
  /* A CONTROL THAT REDRAWS THE PAGE KEEPS THE KEYBOARD'S PLACE.
     render() replaces the whole view, and every control below destroyed
     itself under the keyboard: focus fell to <body>, a screen reader lost
     its place, and the next Tab started from the top. Each is pressed as
     Enter or Space presses it — focused, then clicked — and focus must land
     where the fix sends it. And the workspace's kind filter, left set to a
     kind with nothing left, no longer hides every item behind a button that
     is not there. */
  const bf3 = `const w = (ms) => new Promise(r => setTimeout(r, ms));
    const btn = (t) => [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && x.textContent.trim() === t);
    const press = async (n, ms = 150) => { if (!n) return false; n.focus(); n.click(); await w(ms); return true; };
    const at = () => { const a = document.activeElement; return !a || a === document.body ? 'BODY'
      : a.tagName + (a.id ? '#' + a.id : '') + ' ' + (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48); };
    window.confirm = () => true;`;
  {
    const r = await evaluate(`(async () => {
      ${bf3}
      const out = {};
      navigate('/pricing'); await w(150);
      out.free = await press(btn('Switch to Free')) && at();
      out.pro = await press(btn('Switch to Equities Research')) && at();
      return out;
    })()`);
    await evaluate(`State.plan = 'pro'; store.write('plan', 'pro'); true`);
    if (r.free !== 'H3 Free' || r.pro !== 'H3 Equities Research') fail('sweep: a plan switch on /pricing leaves focus on the heading of the plan now in force', r);
    else ok('sweep: a plan switch on /pricing leaves focus on the heading of the plan now in force, not on <body>');
  }
  {
    const r = await evaluate(`(async () => {
      ${bf3}
      const out = {};
      if (hasWorkedExample()) clearWorkedExample();
      navigate('/start'); await w(150);
      out.startLoad = await press(btn('Load the worked example')) && at();
      out.startRemove = await press(btn('Remove the worked example')) && at();
      navigate('/property/comparables'); await w(150);
      out.regLoad = await press(btn('Load the worked example')) && at();
      navigate('/property/areas'); await w(150);
      out.areaRemove = await press(btn('Remove the worked example')) && at();
      return out;
    })()`);
    const p = [];
    if (!/^BUTTON Remove the worked example/.test(r.startLoad)) p.push(`/start Load: ${r.startLoad}`);
    if (!/^BUTTON Load the worked example/.test(r.startRemove)) p.push(`/start Remove: ${r.startRemove}`);
    if (!/^BUTTON Remove the worked example/.test(r.regLoad)) p.push(`/property/comparables Load: ${r.regLoad}`);
    if (!/^MAIN#main/.test(r.areaRemove)) p.push(`/property/areas Remove: ${r.areaRemove}`);
    if (p.length) fail('sweep: loading or removing the worked example hands focus to its counterpart, or to <main> where there is none', p);
    else ok('sweep: loading or removing the worked example hands focus to its counterpart, or to <main> where the page offers none');
  }
  {
    const r = await evaluate(`(async () => {
      ${bf3}
      const out = {};
      navigate('/research/trading-index?from=AAPL'); await w(200);
      out.qtti = await press(btn('Fill in the identity')) && at();
      navigate('/us-options/wheel?from=AAPL'); await w(200);
      out.wheelLink = await press(btn('Fill in the identity')) && at();
      navigate('/us-options/wheel'); await w(150);
      out.load = await press(btn('Load a worked contract')) && at();
      out.clear = await press(btn('Clear and enter my own')) && (at() + (document.activeElement.closest('#wheel-inputs') ? ' [contract field]' : ''));
      await press(btn('Load a worked contract'));
      await press(btn('Start a cycle'));
      await press(btn('Record the put as opened'));
      [...document.querySelectorAll('#views details')].forEach(d => { if (/Roll this contract/.test(d.textContent)) d.open = true; });
      out.roll = await press(btn('Record the roll')) && at();
      out.clearCycle = await press(btn('Clear the cycle')) && at();
      return out;
    })()`);
    const p = [];
    if (!/^H3 Linked to/.test(r.qtti)) p.push(`trading index, Fill in the identity: ${r.qtti}`);
    if (!/^H3 Linked to/.test(r.wheelLink)) p.push(`Cash Wheel, Fill in the identity: ${r.wheelLink}`);
    if (!/^BUTTON#wheel-clear-example/.test(r.load)) p.push(`Load a worked contract: ${r.load}`);
    if (!/\[contract field\]$/.test(r.clear)) p.push(`Clear and enter my own: ${r.clear}`);
    if (!/^H3#wheel-cycle-state/.test(r.roll)) p.push(`Record the roll: ${r.roll}`);
    if (!/^H3#wheel-cycle-state Candidate/.test(r.clearCycle)) p.push(`Clear the cycle: ${r.clearCycle}`);
    if (p.length) fail('sweep: the Trading Index and Cash Wheel controls that redraw the page keep focus', p);
    else ok('sweep: the Trading Index and Cash Wheel keep focus through Fill in the identity, the worked contract, a roll and a cleared cycle');
  }
  {
    const r = await evaluate(`(async () => {
      ${bf3}
      const out = {};
      State.opportunities = []; saveOpportunities();
      navigate('/property/opportunities'); await w(150);
      const add = async (name) => {
        const f = document.getElementById('opp-new-name');
        f.value = name; f.dispatchEvent(new Event('change', { bubbles: true }));
        return press(btn('Add to register'));
      };
      out.add = await add('bf3 first') && at();
      await add('bf3 second');
      out.removeOne = await press(btn('Remove')) && at();
      out.removeLast = await press(btn('Remove')) && at();
      navigate('/my/alerts'); await w(150);
      const cb = document.querySelector('#views .checkline input[type=checkbox]:not([disabled])');
      out.alertKind = await press(cb) && at() + ' ' + (document.activeElement.type || '');
      await press(document.querySelector('#views .checkline input[type=checkbox]:not([disabled])'));
      return out;
    })()`);
    const p = [];
    if (!/^BUTTON#opp-add/.test(r.add)) p.push(`Add to register: ${r.add}`);
    if (!/^H3#opp-0-name bf3 first/.test(r.removeOne)) p.push(`Remove, one left: ${r.removeOne}`);
    if (!/^H3 No properties recorded yet/.test(r.removeLast)) p.push(`Remove, none left: ${r.removeLast}`);
    if (!/checkbox$/.test(r.alertKind)) p.push(`an alert-type switch: ${r.alertKind}`);
    if (p.length) fail('sweep: the opportunity register and the alert-type switches keep focus when they redraw', p);
    else ok('sweep: the opportunity register (add, remove) and the alert-type switches keep focus when they redraw');
  }
  {
    const r = await evaluate(`(async () => {
      ${bf3}
      const out = {};
      State.corrections = []; saveCorrections();
      navigate('/corrections'); await w(150);
      const record = async (what) => {
        await press(btn('Open the report form'), 400);
        const d = document.getElementById('err-description');
        d.value = what; d.dispatchEvent(new Event('input', { bubbles: true }));
        await press(btn('Record this case'), 400);
        closeDrawer(); await w(450);
        return at();
      };
      out.recorded = await record('bf3 first case');
      await record('bf3 second case');
      await press(document.getElementById('case-open-0') || btn('Open'), 400);
      await press(btn('Delete this case'), 450);
      out.deleteOne = at();
      await press(btn('Open'), 400);
      await press(btn('Delete this case'), 450);
      out.deleteLast = at();
      return out;
    })()`);
    const p = [];
    if (!/^BUTTON#open-report-form/.test(r.recorded)) p.push(`closing the recorded-case confirmation: ${r.recorded}`);
    if (!/^BUTTON#case-open-0 Open/.test(r.deleteOne)) p.push(`Delete, one case left: ${r.deleteOne}`);
    if (!/^H3 Cases you have recorded — 0/.test(r.deleteLast)) p.push(`Delete, none left: ${r.deleteLast}`);
    if (p.length) fail('sweep: recording and deleting a correction case return focus to the page, not <body>', p);
    else ok('sweep: recording and deleting a correction case return focus to the form button, the next case, or the list heading');
  }
  {
    const r = await evaluate(`(async () => {
      ${bf3}
      State.savedScreens = [{ name: 'bf3 screen', snapshot: { matches: [] } }]; store.write('savedScreens', State.savedScreens);
      State.workspace = { kind: 'screen', q: '' };
      navigate('/my/workspace'); await w(150);
      const del = document.querySelector('#views .ws-row:not(.ws-head) button[aria-label="Delete bf3 screen"]');
      if (!del) return { missing: true };
      await press(del);
      return { kind: State.workspace.kind, pressed: document.getElementById('ws-kind-all')?.getAttribute('aria-pressed'),
        rows: document.querySelectorAll('#views .ws-row:not(.ws-head)').length, left: workspaceItems().length, focus: at() };
    })()`);
    if (r.missing || r.kind !== 'all' || r.pressed !== 'true' || !r.left || r.rows !== r.left || !/^BUTTON Open/.test(r.focus))
      fail('sweep: deleting the last item of the kind the workspace is filtered to returns the filter to All', r);
    else ok(`sweep: deleting the last item of the kind the workspace is filtered to returns the filter to All (${r.rows} saved item${r.rows === 1 ? '' : 's'} shown, focus on the next Open)`);
  }
  /* ---- end bugfix3: sweep ---- */

  /* ---- bugfix4: scanner ---- */
  /* FOURTH BUG HUNT — WHAT THE SCANNER PAGES SAY THE WORKER REFUSED AND
     RECORDED (87-scanner-ops.js):
     1. the setups refused are scanStatus's count, on the dashboard's "Are my
        setups active?" and on Overview's Usage, as --status prints it — two
        entries sharing an id are two (the page counted the ids the problems
        were keyed under, and read "1 setup refused, for 2 problems"); a file
        refused whole says so on both;
     2. a run whose version ledger could not be written — the real worker's
        record, made here with the ledger's temporary file a folder — does
        not say its new version was "recorded for the first time", on Runs
        or on Overview; one whose ledger was written still does.
     Every file is set in memory and put back. */
  {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { mkdir, writeFile, readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { loadEngine } = await import('./scanner/scan.mjs');
    const F4 = (await loadEngine()).scanFixture();
    const dir4 = join(tmpdir(), `qt-bugfix4-scanner-eq-${process.pid}`);
    let ledgerRun = null, workerError = null;
    try {
      await rm(dir4, { recursive: true, force: true });
      await mkdir(join(dir4, 'scan-ledger.json.tmp'), { recursive: true });
      const { version, ...unnumbered } = F4.setupV2;
      await writeFile(join(dir4, 'scan-setups.json'), JSON.stringify({ setups: [unnumbered] }));
      await writeFile(join(dir4, 'price-history.json'), JSON.stringify(F4.history));
      try { await promisify(execFile)(process.execPath, [fileURLToPath(new URL('./scanner/scan.mjs', import.meta.url)), '--data', dir4, '--now', F4.now]); }
      catch { /* exit 2 — PARTIAL, the ledger not written — is the case wanted */ }
      const runs = JSON.parse(await readFile(join(dir4, 'scan-runs.json'), 'utf8')).runs || [];
      ledgerRun = runs[runs.length - 1] || null;
    } catch (e) { workerError = e.message; }
    finally { await rm(dir4, { recursive: true, force: true }).catch(() => {}); }
    const r = await evaluate(`(async () => {
      ${opsKeep} ${opsWait}
      const keepAdj = scanAdjustmentsFile;
      try {
        const f = scanFixture();
        const out = {};
        const main = () => document.querySelector('main');
        const dd = (root, label) => { const dt = root ? [...root.querySelectorAll('dt')].find(d => d.textContent === label) : null; return dt ? dt.nextElementSibling.textContent : null; };
        const usage =() => dd([...main().querySelectorAll('section.card')].find(c => /^Usage/.test(c.querySelector('h2, h3')?.textContent || '')), 'Active setups');
        const tile = () => (main().querySelector('.scan-q')?.innerText || '').replace(/\\n+/g, ' | ');
        scanHistoryFile = f.history; scanAlertsFile = { alerts: [] }; scanControlFile = null; scanOpsRead = true;
        scanRunsFile = { schema: 1, runs: [], audit: [] }; scanOpsClock = f.now;
        /* 1. Two entries sharing an id beside a sound one, then a file that is not a list. */
        scanSetupsFile = { setups: [f.setup, { ...f.setup, name: 'A copy' }, { ...f.setup, id: 'bf4-other' }] };
        out.refused = scanOpsStatus().active.refused;
        navigate('/app/scanner'); await w(150);
        out.tile = tile();
        navigate('/admin/scanner'); await w(150);
        out.usage = usage();
        scanSetupsFile = { setups: 'x' };
        navigate('/app/scanner'); await w(150);
        out.wholeTile = tile();
        navigate('/admin/scanner'); await w(150);
        out.wholeUsage = usage();
        /* 2. The worker's run whose ledger could not be written. */
        const run = ${JSON.stringify(ledgerRun)};
        if (run) {
          scanSetupsFile = { setups: [f.setupV2] }; scanRunsFile = { schema: 1, runs: [run], audit: [] }; scanOpsClock = run.now || f.now; scanJobsState.filter = 'all';
          navigate('/admin/scanner/jobs'); await w(150);
          main().querySelectorAll('details').forEach(d => { d.open = true; });
          await w(30);
          out.jobs = dd(main().querySelector('tr.scan-detail-row'), 'Version ledger');
          navigate('/admin/scanner'); await w(150);
          out.overview = dd(main(), 'Version ledger');
          out.written = scanRunLedgerText({ ...run, ledger: { ...run.ledger, written: true } });
        }
        /* 3. Data health's line for an adjustments file with no list of actions, and for refused entries. */
        const adjLine = () => [...main().querySelectorAll('section[aria-label="Price breaks and adjustments"] p.metaline')].map(p => p.textContent).find(t => t.startsWith('data/price-adjustments.json')) || null;
        scanAdjustmentsFile = { actions: 'x' }; scanHistoryFile = { ...f.history };
        navigate('/admin/scanner/data'); await w(150);
        out.adjWhole = adjLine();
        scanAdjustmentsFile = { schema: 1, actions: [{ symbol: 'MATCH', date: '2026-02-02', ratio: 2, kind: 'split' }, { symbol: 'MATCH', date: '2026-02-02', ratio: 2, kind: 'split' },
          { symbol: 'FLAT', date: 'x', ratio: 2, kind: 'split' }, { symbol: 'FLAT', date: '2026-02-03', ratio: 1, kind: 'other' }] };
        scanHistoryFile = { ...f.history };
        navigate('/admin/scanner/data'); await w(150);
        out.adjEntries = adjLine();
        return out;
      } finally {
        restore(); scanAdjustmentsFile = keepAdj; scanJobsState.filter = 'all';
        navigate('/learn');
      }
    })()`);
    const p1 = [];
    if (r.refused !== 2) p1.push(`scanStatus's active.refused is ${r.refused}, not 2`);
    if (!r.tile.includes('2 setups refused, for 2 problems — the worker leaves them out.')) p1.push(`the setups tile: ${r.tile}`);
    if (r.usage !== '1 (of 1 valid, 2 refused)') p1.push(`Usage, Active setups: ${r.usage}`);
    if (!r.wholeTile.includes('The whole file is refused — the setups file is neither a list nor an object with a "setups" list.')) p1.push(`the setups tile, a file that is not a list: ${r.wholeTile}`);
    if (r.wholeUsage !== '0 (of 0 valid, the whole file refused)') p1.push(`Usage, a file that is not a list: ${r.wholeUsage}`);
    if (p1.length) fail('bugfix4 scanner: the scanner pages count the refused setups as the worker does', p1);
    else ok('bugfix4 scanner: the scanner pages count the refused setups as the worker does — two entries sharing an id beside a sound one read "2 setups refused, for 2 problems" on the dashboard and "(of 1 valid, 2 refused)" on Usage, as --status reads "2 refused" (they read 1), and a file that is not a list is refused whole on both');

    const p2 = [];
    const l = ledgerRun?.ledger;
    if (workerError || ledgerRun?.status !== 'PARTIAL' || l?.written !== false || l?.newVersions?.length !== 1) p2.push(`the worker's run: ${workerError || JSON.stringify({ status: ledgerRun?.status, ledger: l })}`);
    const unwritten = '0 versions already in the ledger · 1 new, not recorded · 0 refused · the ledger could not be written; the run’s problems say why';
    ['jobs', 'overview'].forEach(k => { if (r[k] !== unwritten) p2.push(`${k === 'jobs' ? 'Runs' : 'Overview'}, Version ledger: ${r[k]}`); });
    if (!/^0 versions already in the ledger · 1 recorded for the first time · 0 refused$/.test(r.written || '')) p2.push(`the same run with its ledger written: ${r.written}`);
    if (p2.length) fail('bugfix4 scanner: a run whose version ledger could not be written does not say its new version was recorded', p2);
    else ok(`bugfix4 scanner: a run whose version ledger could not be written (the worker's own PARTIAL record) does not say its new version was "recorded for the first time" — Runs and Overview read "${unwritten}"; with the ledger written it still reads "1 recorded for the first time"`);

    const p3 = [];
    if (r.adjWhole !== 'data/price-adjustments.json — refused whole, so no action is read from it.') p3.push(`a file with no list of actions: ${r.adjWhole}`);
    if (!/^data\/price-adjustments\.json — 1 action read \(adj:[0-9a-f]+\), 3 entries refused\.$/.test(r.adjEntries || '')) p3.push(`two actions for one day, a bad date and one sound: ${r.adjEntries}`);
    if (p3.length) fail('bugfix4 scanner: data health counts the refused adjustment entries as entries, and a file refused whole as that', p3);
    else ok('bugfix4 scanner: data health says an adjustments file with no list of actions is refused whole (it read "0 actions read, 1 entry refused" of a file with no entry), and still counts refused entries as entries — two for one day and a bad date are 3 refused beside 1 read');
  }
  /* ---- end bugfix4: scanner ---- */

  /* ---- bugfix4: shell ---- */
  /* The shell's fourth pass. Everything it changes in this browser —
     saved work, the three tools' figures, a comparable edited, a correction
     case — is put back at the end, and the page reloaded from it, so a
     block after this one starts from the state it would have had. */
  const bf4 = `const w = (ms) => new Promise(r => setTimeout(r, ms));
    const btn = (t) => [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && x.textContent.trim() === t);
    const press = async (n, ms = 200) => { if (!n) return false; n.focus(); n.click(); await w(ms); return true; };
    const at = () => { const a = document.activeElement; return !a || a === document.body ? 'BODY'
      : a.tagName + (a.id ? '#' + a.id : '') + ' ' + (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40); };
    window.confirm = () => true; window.prompt = (m, d) => d;`;
  const bf4Saved = await evaluate(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))`);
  {
    /* THE FOOTER'S HEADINGS STEP FROM THE PAGE'S. Its four column headings
       were h4, and main ends on an h2 or an h3, so every route's outline
       skipped a level into the footer — 2→4 on each page measured here.
       The whole document is walked, footer included; the closed drawer is
       not on the page. They keep their 12px uppercase look. */
    const r = await evaluate(`(async () => {
      ${bf4}
      const lv = (h) => Number(h.getAttribute('aria-level') || h.tagName[1]);
      const out = {};
      for (const p of ['/about', '/contact', '/privacy', '/terms', '/discover/value-map', '/app/scanner/alerts', '/learn', '/company/AAPL-SEC']) {
        navigate(p); await w(150);
        const hs = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter(h => !h.closest('#drawer'));
        let prev = 0; const bad = [];
        hs.forEach(h => { const l = lv(h); if (l > prev + 1) bad.push(prev + '→' + l + ' "' + h.textContent.trim().slice(0, 24) + '"'); prev = l; });
        if (bad.length) out[p] = bad;
      }
      const fh = [...document.querySelectorAll('footer.footer .footer-grid h1, footer.footer .footer-grid h2, footer.footer .footer-grid h3, footer.footer .footer-grid h4')];
      const cs = fh[0] ? getComputedStyle(fh[0]) : null;
      return { out, n: fh.length, tags: [...new Set(fh.map(h => h.tagName))].join(','), size: cs?.fontSize, tt: cs?.textTransform };
    })()`);
    /* Three columns since Release A — Products, Resources, Company. */
    if (Object.keys(r.out).length || r.n !== 3 || r.tags !== 'H2' || r.size !== '12px' || r.tt !== 'uppercase')
      fail('bugfix4 shell: no page skips a heading level into the footer, whose three headings are h2 at 12px uppercase', r);
    else ok('bugfix4 shell: no page skips a heading level into the footer — its three column headings are h2, still 12px uppercase');
  }
  {
    /* A MARKET CAP UNDER HALF A MILLION BELOW ZERO IS NOUGHT. fmtCap took
       the sign from the raw value, so −0.00001 and −0.0004 billion printed
       "−$0M". The sign belongs to the figure as it prints, as fmtMoney's
       does; anything that still prints a digit keeps it. */
    const got = await evaluate(`[fmtCap(-0.00001, 'USD'), fmtCap(-0.0004, 'MYR'), fmtCap(-0.0006, 'USD'), fmtCap(-51.5, 'USD'), fmtCap(-0.99951, 'USD'), fmtCap(-1200, 'MYR'), fmtCap(0, 'USD')]`);
    const want = ['$0M', 'RM0M', '−$1M', '−$51.5B', '−$1.0B', '−RM1.20T', '$0M'];
    if (JSON.stringify(got) !== JSON.stringify(want)) fail('bugfix4 shell: fmtCap never prints a signed zero', { got, want });
    else ok(`bugfix4 shell: fmtCap never prints a signed zero (${got.slice(0, 3).join(', ')}), and keeps the sign on a figure that prints one`);
  }
  {
    /* SAVE, RESUME, DUPLICATE LATEST AND RESET KEEP THE KEYBOARD'S PLACE.
       Each redrew the page with render(), which replaced the bar and the
       control in it, and focus fell to <body> — on all three tools. Pressed
       as Enter presses them, focus must be back on the same control. */
    const r = await evaluate(`(async () => {
      ${bf4}
      const out = {};
      for (const [p, k] of [['/research/trading-index', 'trading'], ['/us-options/wheel', 'wheel'], ['/property/calculator', 'property']]) {
        navigate(p); await w(200);
        const o = out[k] = {};
        o.save = await press(document.getElementById('wb-' + k + '-save') || btn('Save')) && at();
        o.dup = await press(document.getElementById('wb-' + k + '-dup') || btn('Duplicate latest')) && at();
        const sel = document.getElementById('wb-' + k + '-resume') || document.querySelector('#views select[aria-label^="Resume a saved"]');
        if (sel) { sel.focus(); sel.value = sel.options[1]?.value || ''; sel.dispatchEvent(new Event('change', { bubbles: true })); await w(200); o.resume = at(); }
        o.reset = await press(document.getElementById('wb-' + k + '-reset') || btn('Reset')) && at();
      }
      return out;
    })()`);
    const p = [];
    for (const k of ['trading', 'wheel', 'property']) for (const [what, want] of [['save', 'save'], ['dup', 'dup'], ['resume', 'resume'], ['reset', 'reset']])
      if (!new RegExp(`^(BUTTON|SELECT)#wb-${k}-${want}\\b`).test(r[k]?.[what] || '')) p.push(`${k} ${what}: ${r[k]?.[what]}`);
    if (p.length) fail('bugfix4 shell: the work bar\'s Save, Resume, Duplicate latest and Reset keep focus on the control pressed', p);
    else ok('bugfix4 shell: the work bar\'s Save, Resume, Duplicate latest and Reset keep focus on the control pressed — trading index, Cash Wheel, property calculator');
  }
  {
    /* A DRAWER WHOSE OPENER A REDRAW REPLACED HANDS FOCUS TO ITS SUCCESSOR.
       closeDrawer gave focus back only to the very node that opened it, so a
       drawer whose own action redraws the page — an edit to a comparable —
       closed onto <body>. The control that came back under the opener's id
       takes focus; with none, <main> does. Focus a close did not lose (put
       somewhere on purpose) is left where it is. */
    const r = await evaluate(`(async () => {
      ${bf4}
      const out = {};
      navigate('/property/comparables'); await w(200);
      if (!document.querySelector('#views [id^="obs-open-"]')) await press(btn('Load the worked example'), 300);
      const o = document.querySelector('#views [id^="obs-open-"]');
      if (!o) return { missing: 'no comparable to open' };
      const oid = o.id;
      await press(o, 400);
      const f = document.getElementById('obs-edit-reviewedBy') || document.querySelector('#drawerBody input');
      f.focus(); f.value = (f.value || '') + ' bf4'; f.dispatchEvent(new Event('change', { bubbles: true })); await w(100);
      out.detached = !o.isConnected;
      await press(document.querySelector('#drawer [data-close-drawer]'), 450);
      out.comparable = at(); out.oid = oid;

      navigate('/corrections'); await w(200);
      await press(btn('Open the report form'), 400);
      const d = document.getElementById('err-description');
      d.value = 'bf4 case'; d.dispatchEvent(new Event('input', { bubbles: true }));
      await press(btn('Record this case'), 400);
      closeDrawer(); await w(450);
      await press(document.getElementById('case-open-0'), 400);
      render(); await w(50);
      closeDrawer(); await w(450);
      out.caseAfterRedraw = at();

      await press(document.getElementById('case-open-0'), 400);
      render(); await w(50);
      closeDrawer(); document.getElementById('open-report-form').focus(); await w(450);
      out.placed = at();

      navigate('/learn/glossary'); await w(200);
      await press(document.querySelector('#views table.dict .metric-label'), 400);
      render(); await w(50);
      closeDrawer(); await w(450);
      out.noId = at();
      return out;
    })()`);
    const p = [];
    if (r.missing) p.push(r.missing);
    else {
      if (!r.detached) p.push('the edit did not redraw the register, so the case is not exercised');
      if (!(r.comparable || '').startsWith('BUTTON#' + r.oid)) p.push(`closing a comparable after an edit: ${r.comparable}`);
      if (!/^BUTTON#case-open-0 /.test(r.caseAfterRedraw)) p.push(`closing a case after a redraw: ${r.caseAfterRedraw}`);
      if (!/^BUTTON#open-report-form /.test(r.placed)) p.push(`focus placed by the action was moved: ${r.placed}`);
      if (!/^MAIN#main/.test(r.noId)) p.push(`an opener with no id, redrawn away: ${r.noId}`);
    }
    if (p.length) fail('bugfix4 shell: closing a drawer whose opener a redraw replaced returns focus to the replacement, or to <main>', p);
    else ok('bugfix4 shell: closing a drawer whose opener a redraw replaced returns focus to the control under its id (a comparable, a correction case), or to <main>');
  }
  {
    /* A MARK WITH NO QUALITY PERCENTILE SAYS SO. scatterChart printed p.y, so
       a company the value map could not rank — plotted at 50 — read "quality
       percentile 50", and one given no y at all read "quality percentile
       null" and sat on the zero line. A y that is not a number is drawn at
       the midpoint and named as having no percentile, in the mark's name and
       its tooltip; a ranked mark is unchanged. */
    const r = await evaluate(`(async () => {
      ${bf4}
      const host = document.createElement('div'); host.style.width = '640px'; document.body.append(host);
      const pt = (id, x, y, size) => ({ id, label: id, name: id + ' Bhd', x, y, size, capLabel: 'RM1.0B', model: 'm', conf: 'Low', varName: '--s1' });
      scatterChart(host, { points: [pt('NORANK', 12, null, 1), pt('RANKED', -20, 70, 2)], xLabel: 'x', yLabel: 'y', xFmt: v => withSign(v, 0), onPick: () => {} });
      const gs = [...host.querySelectorAll('g[role="button"]')];
      const nr = gs.find(g => g.getAttribute('aria-label').startsWith('NORANK'));
      const rk = gs.find(g => g.getAttribute('aria-label').startsWith('RANKED'));
      const mid = [...host.querySelectorAll('line.gridline')].filter(l => l.getAttribute('x1') !== l.getAttribute('x2'))[2]?.getAttribute('y1');
      nr?.focus(); await w(50);
      const tip = document.getElementById('viztip').textContent.replace(/\\s+/g, ' ');
      nr?.blur(); host.remove();
      return { nr: nr?.getAttribute('aria-label'), rk: rk?.getAttribute('aria-label'), cy: nr?.querySelector('circle')?.getAttribute('cy'), mid, tip };
    })()`);
    if (!/no quality percentile/.test(r.nr || '') || /null|percentile 50/.test(r.nr || '') || !/quality percentile 70$/.test(r.rk || '')
      || !r.mid || Number(r.cy) !== Number(r.mid) || !/Quality percentile ?none/.test(r.tip) || /null/.test(r.tip))
      fail('bugfix4 shell: a value-map mark with no quality percentile is drawn at the midpoint and says it has none', r);
    else ok(`bugfix4 shell: a value-map mark with no quality percentile is drawn at the midpoint and says so ("${r.nr}")`);
  }
  {
    /* A TILE TOO SMALL TO DRAW IS STILL OFFERED. The treemap dropped a tile
       under 2px either way with nothing said, so a company in the table view
       could be neither seen, pointed at nor reached by Tab. It is offered as
       a button under the map that opens what the tile would have. */
    const r = await evaluate(`(async () => {
      ${bf4}
      const host = document.createElement('div'); host.style.width = '900px'; document.body.append(host);
      const picked = [];
      const it = (id, value) => ({ id, label: id, name: id, value, change: 0.5, capLabel: '$1B', metricLabel: 'Day change' });
      treemap(host, { items: [it('BIG', 1e6), it('MID', 4e5), it('TINY', 0.001)], valueFmt: v => withSign(v, 2), onPick: id => picked.push(id) });
      const tiles = [...host.querySelectorAll('g[role="button"]')].map(g => g.getAttribute('aria-label').split(',')[0]);
      const b = [...host.querySelectorAll('button')].find(x => /^TINY /.test(x.getAttribute('aria-label') || ''));
      b?.click();
      const text = host.textContent;
      host.remove();
      return { tiles, offered: !!b, picked, text: text.slice(0, 80) };
    })()`);
    if (r.tiles.includes('TINY') || !r.offered || r.picked.join() !== 'TINY' || !/Too small to (draw|tap)/.test(r.text))
      fail('bugfix4 shell: a heatmap tile too small to draw is offered as a button that opens it', r);
    else ok('bugfix4 shell: a heatmap tile too small to draw is named under the map as a button that opens it');
  }
  /* Everything this block wrote is put back, and the page reloaded from it. */
  await evaluate(`(() => { const s = ${JSON.stringify(bf4Saved)}; const keep = JSON.parse(s);
    Object.keys(localStorage).forEach(k => { if (!(k in keep)) localStorage.removeItem(k); });
    Object.entries(keep).forEach(([k, v]) => localStorage.setItem(k, v)); return true; })()`);
  await send('Page.navigate', { url: `${BASE}/research` }, sessionId);
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { if (await evaluate(`typeof realPending !== 'undefined' && !realPending && U.some(r => r.c.real)`)) break; } catch { /* booting */ }
  }
  /* ---- end bugfix4: shell ---- */

  /* ---- bugfix4: equities ---- */
  /* FOURTH PASS, EQUITIES: the report withheld a per-share rate on a break
     outside the window it reads and named the wrong step; the value map
     printed "+0%", "-0%" and a hyphen for a minus, handed the chart 50 for a
     company with no percentile (whose mark then read "quality percentile
     50"), said nothing in the market cohort and the wrong thing in the
     sector one, and left the confidence filter's drop-outs uncounted; the
     compounder fit graded a REIT on a quality score nobody measured; and the
     company tabs and the report gave an absent figure "n/a", "n/m" or "not
     reported" whatever the cause, where the screener names it. */
  const eq4Wait = `const w = (ms) => new Promise(r => setTimeout(r, ms));`;
  {
    /* 1. The report's four-year per-share CAGR is withheld only for a break
       among the five rows it reads, and its footnote names that step; an
       absent statement cell and an absent headline figure say why. */
    const r = await evaluate(`(async () => {
      ${eq4Wait}
      const out = { wrong: [], checked: [] };
      const rowOf = (re) => [...document.querySelectorAll('#views .rr-hist tbody tr')].find(tr => re.test(tr.cells[0].textContent));
      const note = () => [...document.querySelectorAll('#views p.metaline')].map(p => p.textContent).find(t => /^Billions of/.test(t)) || '';
      const has = (x) => isNum(cagr(x.d.dps.slice(-5)));
      const pick = [
        ...['AAPL-SEC', 'GE-SEC'].map(id => BY_ID.get(id)).filter(x => x && x.m.shareSeriesBreak && !x.m.perShareBreak && has(x)),
        ...U.filter(x => x.c.real && x.m.shareSeriesBreak && !x.m.perShareBreak && has(x) && !['AAPL-SEC', 'GE-SEC'].includes(x.c.id)).slice(0, 2),
        ...U.filter(x => x.c.real && x.m.perShareBreak && has(x)).slice(0, 2),
        ...U.filter(x => x.c.real && x.m.shareSeriesBreak && !x.m.perShareBreak && !has(x)).slice(0, 1),
      ];
      for (const x of pick) {
        navigate(companyPath(x.c) + '/report'); await w(250);
        const tr = rowOf(/^(Dividend per share|Distribution per unit)$/), cell = tr ? tr.cells[tr.cells.length - 2].textContent : null, n = note();
        out.checked.push(x.c.tk + ' ' + cell);
        if (x.m.perShareBreak) {
          if (cell !== 'withheld') out.wrong.push(x.c.tk + ': a break inside the window and the rate reads ' + cell);
          if (!n.includes(fmtNum(x.m.perShareBreak.to, 2) + 'bn') || !/five years that rate reads/.test(n)) out.wrong.push(x.c.tk + ': the footnote does not name the in-window step: ' + n.slice(-240));
        } else {
          const want = isNum(x.m.dps5) ? fmtPct(x.m.dps5) : '—';
          if (cell !== want) out.wrong.push(x.c.tk + ': no break in the window, the engine holds ' + want + ' and the report reads ' + cell);
          if (/per-share CAGR is withheld/.test(n)) out.wrong.push(x.c.tk + ': the footnote says a per-share CAGR is withheld with no break in its window');
        }
      }
      /* A share count held and withheld: its cells say withheld, as the
         company page's statement table does, not "not reported". */
      const held = U.find(x => x.c.real && x.c.withheld?.sh?.years?.includes(latestFy(x.c)));
      if (held) {
        navigate(companyPath(held.c) + '/report'); await w(250);
        const tr = rowOf(/^Shares in issue/), ys = yearsOf(held.c).slice(-6);
        const cells = tr ? [...tr.cells].slice(1, 1 + ys.length).map(td => td.textContent) : [];
        out.checked.push(held.c.tk + ' shares ' + cells.join('/'));
        if (!cells.length || cells.some((t, j) => held.c.withheld.sh.years.includes(ys[j]) && t !== 'withheld')) out.wrong.push(held.c.tk + ': a withheld share count reads ' + JSON.stringify(cells));
      } else out.wrong.push('no filed company with a withheld share count to check');
      /* A debt line held and withheld: the headline's net debt says so. */
      const debt = U.find(x => x.c.real && x.c.type !== 'bank' && !isNum(x.m.netDebt) && x.c.withheld?.debt?.years?.includes(latestFy(x.c)));
      if (debt) {
        navigate(companyPath(debt.c) + '/report'); await w(250);
        const fig = [...document.querySelectorAll('#views .dr-fig')].find(f => f.children[0].textContent === 'Net debt');
        const t = fig ? fig.children[1].textContent : null;
        out.checked.push(debt.c.tk + ' net debt ' + t);
        if (t !== 'Withheld') out.wrong.push(debt.c.tk + ': net debt, its debt line withheld, reads ' + t);
      } else out.wrong.push('no filed company with a withheld debt line to check');
      return out;
    })()`);
    if (r.wrong.length || r.checked.length < 6) fail('bugfix4 equities: the report withholds a per-share CAGR only inside its own window and says why a figure is absent', r);
    else ok(`bugfix4 equities: the report withholds a per-share CAGR only inside its own window and says why a figure is absent — ${r.checked.join(', ')}`);
  }
  {
    /* 2. The value map: its differences print with withSign; a company with
       no percentile reaches the chart as null, not as the midpoint's 50; the
       unranked are counted with their reason; and the confidence filter's
       drop-outs are counted with the rest. */
    const r = await evaluate(`(async () => {
      ${eq4Wait}
      const keep = { ...State.radar };
      const orig = scatterChart; let cap = null;
      window.scatterChart = function (host, o) { cap = o; return orig(host, o); };
      const out = {};
      try {
        const draw = async (patch) => { Object.assign(State.radar, keep, patch); cap = null; navigate('/discover/value-map'); render(); await w(300);
          return { points: (cap?.points || []).map(p => ({ tk: p.label, y: p.y })),
                   ticks: cap ? [-12.4, 0.12, -0.3, 38].map(v => cap.xFmt(v)) : [],
                   labels: [...document.querySelectorAll('#views svg g[role=button]')].map(g => g.getAttribute('aria-label')),
                   notes: [...document.querySelectorAll('#views p.metaline')].map(p => p.textContent),
                   rows: [...document.querySelectorAll('#views details tbody tr')].map(tr => [tr.children[0].textContent.split(' ')[0], tr.children[4]?.textContent]) }; };
        out.market = await draw({ cohort: 'market', minConf: 'all', universe: 'all', yi: YEARS.length - 1 });
        out.sector = await draw({ cohort: 'sector', minConf: 'all', universe: 'all', yi: YEARS.length - 1 });
        const high = await draw({ cohort: 'market', minConf: 'high', universe: 'all', yi: YEARS.length - 1 });
        out.high = { marks: high.labels.length, scoped: universeAsOf(YEARS.length - 1).length, note: high.notes.find(t => /not plotted/.test(t)) || '' };
        out.alone = universeAsOf(YEARS.length - 1).filter(x => x.val.mos && isNum(x.q.score) && x.qpctSector == null).map(x => x.c.tk);
      } finally { window.scatterChart = orig; Object.assign(State.radar, keep); }
      return out;
    })()`);
    const p = [];
    if (JSON.stringify(r.market.ticks) !== JSON.stringify(['−12%', '0%', '0%', '+38%'])) p.push(`the difference axis and marks print ${JSON.stringify(r.market.ticks)} for −12.4, +0.12, −0.3 and 38`);
    const bad = r.market.labels.filter(l => /(^|\s)-\d|[+−-]0%/.test(l));
    if (bad.length) p.push(`marks read ${bad.slice(0, 3).join(' | ')}`);
    /* Each point's height is the table's percentile, or null where the
       table says there is none. */
    for (const k of ['market', 'sector']) {
      const rows = new Map(r[k].rows);
      const off = r[k].points.filter(pt => pt.y === null ? !/^— \(/.test(rows.get(pt.tk) || '') : rows.get(pt.tk) !== String(pt.y));
      if (!r[k].points.length || off.length) p.push(`${k}: a point's height is not the table's percentile: ${JSON.stringify(off.slice(0, 3).map(pt => [pt.tk, pt.y, rows.get(pt.tk)]))}`);
    }
    const alonePts = r.sector.points.filter(pt => r.alone.includes(pt.tk));
    const aloneRows = r.sector.rows.filter(([tk]) => r.alone.includes(tk));
    if (!r.alone.length || alonePts.some(pt => pt.y !== null) || aloneRows.some(([, t]) => t !== '— (no sector peer)')) p.push(`the only company in its sector: points ${JSON.stringify(alonePts)}, rows ${JSON.stringify(aloneRows)}`);
    const secNote = r.sector.notes.find(t => /no sector percentile/.test(t)) || '';
    if (!/only company in its sector/.test(secNote) || /fewer than two peers/.test(r.sector.notes.join(' '))) p.push(`the sector note reads "${secNote}"`);
    const m = r.high.note.match(/^(\d+) of (\d+) companies/);
    if (!m || Number(m[1]) !== r.high.scoped - r.high.marks || !/confidence filter/.test(r.high.note)) p.push(`at "High only" ${r.high.marks} of ${r.high.scoped} are drawn and the page says "${r.high.note}"`);
    if (p.length) fail('bugfix4 equities: the value map signs its differences, gives no unranked company a percentile and counts every company it leaves off', p);
    else ok(`bugfix4 equities: the value map signs its differences (${r.market.ticks.join(', ')}), hands the chart no percentile for ${r.alone.join(', ')} ("— (no sector peer)"), and counts the confidence filter's drop-outs — "${r.high.note}"`);
  }
  {
    /* 3. A company with no quality score is not graded a compounder on one
       read as 50; and an absent figure on the Quality, Ownership & actions,
       Business, Snapshot and Moat tabs gives the reason the screener gives. */
    const r = await evaluate(`(async () => {
      ${eq4Wait}
      const graded = U.filter(x => !isNum(x.scores?.quality?.score)).map(x => [x.c.tk, strategyLens(x).fits.find(f => f.key === 'compounder')])
        .filter(([, f]) => f.state === 'graded').map(([tk, f]) => tk + ' ' + f.grade);
      /* Realty Income read "Long-term compounding" off a B on a quality of 50. */
      const noQ = [BY_ID.get('O-SEC'), ...U].find(x => x && x.c.real && !isNum(x.scores?.quality?.score) && isNum(x.m.rev5) && isNum(x.m.roe));
      let role = null;
      if (noQ) { openResearch(noQ.c.id, 'snapshot'); await w(300);
        const lab = [...document.querySelectorAll('#views p.metaline')].find(p => p.textContent === 'Why it might be owned');
        role = { tk: noQ.c.tk, text: lab?.nextElementSibling?.textContent || null }; }
      const wrong = [], cases = [];
      const cellsOf = (label, n) => [...document.querySelectorAll('#views table.dt tbody tr')].filter(tr => (!n || tr.cells.length === n) && tr.cells[0]?.textContent === label).map(tr => tr.cells[1].textContent);
      const ddOf = (label) => { const dt = [...document.querySelectorAll('#views dl.kv dt')].find(d => d.textContent === label); return dt ? dt.nextElementSibling.textContent : null; };
      /* Quality: one company per absent reason among the scored inputs the screener lists. */
      const seen = new Set();
      for (const x of U) for (const pk of ['quality', 'growth', 'strength', 'capital']) for (const part of x.scores[pk].parts) {
        if (isNum(part.raw) || !FIELD_BY_K[part.k]) continue;
        const st = metricStatus(x, part.k);
        if (seen.has(st.reason) && !(x.c.id === 'AAPL-SEC' && part.k === 'buyback')) continue;
        seen.add(st.reason);
        openResearch(x.c.id, 'quality'); await w(200);
        const got = cellsOf(part.label, 7);
        cases.push('quality ' + x.c.tk + ' ' + part.label + ' ' + st.label);
        if (!got.length || got.some(t => t !== st.label)) wrong.push('quality ' + x.c.tk + ' ' + part.label + ': ' + JSON.stringify(got) + ', the screener says ' + st.label);
      }
      /* Ownership & actions: an absent figure with no break note below it. */
      const own = [['Share count CAGR', 'dilution', x => !x.m.shareSeriesBreak], ['Net buyback yield', 'buyback', x => !x.m.shareSeriesBreak],
        ['Dividend per share CAGR', 'dps5', x => !x.m.perShareBreak && x.c.type !== 'reit'], ['Payout ratio', 'payout', () => true],
        ['Dividends as % of free cash flow', 'cashPayout', () => true]];
      const ownSeen = new Set();
      for (const x of [BY_ID.get('GOOGL-SEC'), ...U]) for (const [label, k, applies] of own) {
        if (!x || isNum(x.m[k]) || !applies(x)) continue;
        const st = metricStatus(x, k);
        if (ownSeen.has(k + st.reason)) continue;
        ownSeen.add(k + st.reason);
        openResearch(x.c.id, 'ownership'); await w(200);
        const got = ddOf(label);
        cases.push('ownership ' + x.c.tk + ' ' + k + ' ' + got);
        if (got !== st.label) wrong.push('ownership ' + x.c.tk + ' ' + label + ': "' + got + '", the screener says ' + st.label);
      }
      /* Business: a filer's absent share count, withheld or not reported. */
      for (const [x, want] of [[U.find(x => x.c.real && !isNum(last(x.d.sh)) && x.c.withheld?.sh?.years?.includes(latestFy(x.c))), 'withheld'],
                               [U.find(x => x.c.real && !isNum(last(x.d.sh)) && !x.c.withheld?.sh), 'not reported']]) {
        if (!x) { wrong.push('no filer whose share count is ' + want); continue; }
        openResearch(x.c.id, 'business'); await w(200);
        const got = ddOf('Shares in issue');
        cases.push('business ' + x.c.tk + ' shares "' + got + '"');
        if (got !== want + ' for FY' + latestFy(x.c)) wrong.push('business ' + x.c.tk + ': shares in issue reads "' + got + '", the count is ' + want);
      }
      /* Snapshot peers: an unpriced filer's P/E and FCF yield need a price. */
      const unpriced = U.find(x => x.c.real && !isNum(x.c.px?.p) && !['bank', 'reit'].includes(x.c.type) && metricStatus(x, 'pe').reason === 'needs a price' && metricStatus(x, 'fcfy').reason === 'needs a price');
      if (unpriced) {
        openResearch(unpriced.c.id, 'snapshot'); await w(250);
        const pt = [...document.querySelectorAll('#views table')].find(t => [...t.querySelectorAll('thead th')].some(th => th.textContent === 'P/E'));
        const hs = pt ? [...pt.querySelectorAll('thead th')].map(th => th.textContent) : [];
        const row0 = pt?.querySelector('tbody tr');
        const got = row0 ? [row0.cells[hs.indexOf('P/E')]?.textContent, row0.cells[hs.indexOf('FCF yield')]?.textContent] : null;
        cases.push('snapshot ' + unpriced.c.tk + ' P/E, FCF yield ' + JSON.stringify(got));
        if (!got || got.some(t => t !== 'no price')) wrong.push('snapshot ' + unpriced.c.tk + ': unpriced, its P/E and FCF yield read ' + JSON.stringify(got));
      } else wrong.push('no unpriced filer to check');
      /* Business and Moat: a withheld return on invested capital. */
      const roicW = U.find(x => x.c.real && !['bank', 'reit'].includes(x.c.type) && !isNum(x.m.roic) && metricStatus(x, 'roic').reason === 'withheld');
      if (roicW) for (const tab of ['business', 'moat']) {
        openResearch(roicW.c.id, tab); await w(250);
        const got = cellsOf('Return on invested capital');
        cases.push(tab + ' ' + roicW.c.tk + ' ROIC ' + JSON.stringify(got));
        if (!got.length || got.some(t => t !== 'withheld')) wrong.push(tab + ' ' + roicW.c.tk + ': a withheld return on invested capital reads ' + JSON.stringify(got));
      } else wrong.push('no filer with a withheld return on invested capital');
      return { graded, role, cases, wrong };
    })()`);
    const p = [];
    if (r.graded.length) p.push(`graded a compounder with no quality score: ${r.graded.join(', ')}`);
    if (r.role && /compounding/i.test(r.role.text || '')) p.push(`${r.role.tk}, with no quality score, "Why it might be owned: ${r.role.text}"`);
    if (!r.cases.some(c => /^quality AAPL Net buyback yield withheld$/.test(c)) || !r.cases.some(c => /^ownership GOOGL dps5 not reported$/.test(c))) p.push(`the cases checked miss Apple's buyback yield or Alphabet's dividend growth: ${JSON.stringify(r.cases)}`);
    p.push(...r.wrong.slice(0, 6));
    if (p.length) fail('bugfix4 equities: no compounder grade on an absent quality score, and every company tab says why a figure is absent', p);
    else ok(`bugfix4 equities: no compounder grade on an absent quality score (${r.role ? r.role.tk + ' reads "' + (r.role.text || '').slice(0, 40) + '"' : 'none unscored'}), and every company tab says why a figure is absent — ${r.cases.join('; ')}`);
  }
  {
    /* 4. A filed REIT given a price reaches the map without a quality score:
       it is counted and named in the market cohort too, and its point has no
       percentile rather than the midpoint's 50. */
    const keep = await evaluate(`localStorage.getItem('vl.manualPrices')`);
    const boot = async (value) => {
      if (value == null) await evaluate(`localStorage.removeItem('vl.manualPrices'); true`);
      else await evaluate(`localStorage.setItem('vl.manualPrices', ${JSON.stringify(value)}); true`);
      await send('Page.reload', {}, sessionId);
      let up = null;
      for (let i = 0; i < 60 && !up; i++) { await sleep(500); try { up = await evaluate(`typeof realPending !== 'undefined' && !realPending ? true : null`); } catch { /* booting */ } }
      await sleep(300);
      return up;
    };
    let r = null;
    try {
      const ids = await evaluate(`U.filter(x => x.c.real && x.c.type === 'reit' && !isNum(x.scores?.quality?.score)).slice(0, 2).map(x => x.c.id)`);
      const seeded = { ...(keep ? JSON.parse(keep) : {}), ...Object.fromEntries(ids.map(id => [id, 50])) };
      await boot(JSON.stringify(seeded));
      r = await evaluate(`(async () => {
        ${eq4Wait}
        const orig = scatterChart; let cap = null;
        window.scatterChart = function (host, o) { cap = o; return orig(host, o); };
        try {
          Object.assign(State.radar, { cohort: 'market', minConf: 'all', universe: 'all', yi: YEARS.length - 1 });
          navigate('/discover/value-map'); render(); await w(300);
          const ids = ${JSON.stringify(ids)}.map(id => BY_ID.get(id).c.tk);
          const rows = new Map([...document.querySelectorAll('#views details tbody tr')].map(tr => [tr.children[0].textContent.split(' ')[0], tr.children[4]?.textContent]));
          return { ids,
            points: (cap?.points || []).filter(p => ids.includes(p.label)).map(p => [p.label, p.y, rows.get(p.label)]),
            note: [...document.querySelectorAll('#views p.metaline')].map(p => p.textContent).find(t => /no market percentile/.test(t)) || '' };
        } finally { window.scatterChart = orig; }
      })()`);
    } finally { await boot(keep); }
    const p = [];
    if (!r || r.ids.length < 1 || r.points.length !== r.ids.length || r.points.some(([, y, t]) => y !== null || t !== '— (no quality score)')) p.push(`the priced REITs' points: ${JSON.stringify(r)}`);
    if (!r || !/have no quality score|has no quality score/.test(r.note) || !/plotting position, not a rank/.test(r.note)) p.push(`the market cohort does not say who is drawn without a percentile: "${r?.note}"`);
    if (p.length) fail('bugfix4 equities: a priced company with no quality score is named on the value map, not given the median', p);
    else ok(`bugfix4 equities: a priced company with no quality score is named on the value map, not given the median — ${r.points.map(x => x[0] + ' ' + x[2]).join(', ')}; "${r.note.slice(0, 90)}…"`);
  }
  /* ---- end bugfix4: equities ---- */

  /* ---- bugfix4: misc ---- */
  /* A TIER THAT IS NOT ON SALE DOES NOT LOOK LIKE ONE THAT IS. All-Access
     carries launched:false, and PLANS says a tier nobody can obtain must not
     appear purchasable — yet /pricing gave it "Phase 2", RM79 a month and a
     primary "Switch to All-Access", the toast after it said "Switched to
     All-Access", and the portfolio's cross-asset offer read "All-Access adds
     the property portfolio to this view" above "See plans". The button still
     does what every card's does (a local change of entitlements); what it
     says is now what it does. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const card = () => [...document.querySelectorAll('#views .grid.g-3 > .card')].find(c => c.querySelector('h3')?.textContent.trim() === PLANS.all.name);
      State.plan = 'free'; store.write('plan', 'free');
      navigate('/pricing'); await w(150);
      const c = card(), b = c?.querySelector('button');
      const out = { launched: PLANS.all.launched, chips: [...(c?.querySelectorAll('.chip') || [])].map(x => x.textContent.trim()),
        text: c?.innerText.replace(/\\n+/g, ' / ') || '', btn: b?.textContent.trim(), primary: !!b?.classList.contains('btn-primary') };
      b.focus(); b.click(); await w(150);
      out.plan = State.plan; out.toast = document.getElementById('toast')?.textContent || '';
      /* The plan in force is a marked line, not a disabled button (release-a fix). */
      out.after = card()?.querySelector('.plan-cta')?.textContent.trim();
      State.plan = 'pro'; store.write('plan', 'pro');
      /* A portfolio holding cash, so the page draws past its empty state. */
      const keep = { pf: JSON.stringify(State.portfolios), pfIdx: State.pfIdx };
      State.portfolios = [...JSON.parse(keep.pf), { id: 'pf-misc4', name: 'Cash only', cash: 1000, cashCcy: 'MYR', holdings: [] }];
      State.pfIdx = State.portfolios.length - 1;
      navigate('/my/portfolio'); await w(150);
      out.offer = [...document.querySelectorAll('#views .card')].map(x => x.innerText).find(t => /Combine shares and property/.test(t))?.replace(/\\n+/g, ' / ') || '';
      State.portfolios = JSON.parse(keep.pf); State.pfIdx = keep.pfIdx;
      return out;
    })()`);
    await evaluate(`State.plan = 'pro'; store.write('plan', 'pro'); true`);
    const p = [];
    if (r.launched !== false) p.push('PLANS.all is launched now — this check describes a tier that is not');
    if (/^Switch to/.test(r.btn || '') || r.primary || !/Preview/.test(r.btn || '')) p.push(`button "${r.btn}"${r.primary ? ' (primary)' : ''}`);
    if (!r.chips.includes('Not on sale') || r.chips.includes('Phase 2')) p.push(`chips ${JSON.stringify(r.chips)}`);
    if (!/proposed/i.test(r.text) || !/cannot be bought/.test(r.text)) p.push('the card does not say its price is proposed and cannot be paid');
    if (r.plan !== 'all' || /^Switched to/.test(r.toast) || !/Previewing/.test(r.toast)) p.push(`after the press: plan ${r.plan}, toast "${r.toast}"`);
    if (r.after !== 'Previewing in this browser') p.push(`after the press the button reads "${r.after}"`);
    if (/All-Access adds/.test(r.offer) || !/not launched and cannot be bought/.test(r.offer)) p.push(`portfolio offer: ${r.offer.slice(0, 160)}`);
    if (p.length) fail('misc: the unlaunched All-Access tier is offered as a plan that can be switched to or bought', p);
    else ok('misc: All-Access reads "Not on sale", its price as proposed, its button as a preview in this browser, and the portfolio offer as a tier that has not launched');
  }
  /* ---- end bugfix4: misc ---- */

  /* ---- bugfix5: shell ---- */
  /* The shell's fifth pass. The deal and the wheel this block edits are put
     back at the end, and the page reloaded from them. */
  const bf5Saved = await evaluate(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))`);
  {
    /* THE RANGE STRIP'S LABELS NEITHER BREAK NOR MEET. Bear and Bull were
       absolute boxes placed by percentage and free to wrap, so at 390px on
       JPM's valuation "Bull $503.10", at 91% of a 310px strip, had 27px and
       was cut in two down three lines; at 360px "Bear $196.89" ran into the
       Base label. Drawn at JPM's figures in strips 310 and 280px wide, and
       with the bull not computable in one of 200px, every label is one line
       inside the strip and none overlaps another; a line too long for the
       strip breaks between its cases, never inside one. At 800px the three
       cases keep their own places. */
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const draw = async (width, bull) => {
        const host = document.createElement('div'); host.style.cssText = 'width:' + width + 'px;position:absolute;left:0;top:0';
        document.body.append(host);
        host.append(rangeStrip(196.89, 318.26, bull, 268.90, 'USD'));
        await w(120);
        const hb = host.getBoundingClientRect();
        /* The text's own box: a label in the flow carries the bar's height as padding. */
        const labs = [...host.querySelectorAll('.metaline')].map(l => { const rg = document.createRange(); rg.selectNodeContents(l); const b = rg.getBoundingClientRect();
          return { t: l.textContent, x: b.left - hb.left, r: b.right - hb.left, y: b.top, bottom: b.bottom, h: b.height,
            flow: getComputedStyle(l).position !== 'absolute',
            split: [...l.querySelectorAll('span')].filter(s => s.getClientRects().length > 1).map(s => s.textContent) }; });
        host.remove();
        const p = [];
        labs.forEach(l => {
          if (!l.flow && l.h > 22) p.push(width + 'px: "' + l.t + '" is ' + Math.round(l.h) + 'px tall');
          if (l.split.length) p.push(width + 'px: split inside ' + l.split.join(', '));
          if (l.x < -0.5 || l.r > width + 0.5) p.push(width + 'px: "' + l.t + '" runs outside the strip (' + Math.round(l.x) + ' to ' + Math.round(l.r) + ')');
        });
        for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
          const a = labs[i], b = labs[j];
          if (a.x < b.r && b.x < a.r && a.y < b.bottom && b.y < a.bottom) p.push(width + 'px: "' + a.t + '" overlaps "' + b.t + '"');
        }
        return { p, n: labs.length, texts: labs.map(l => l.t) };
      };
      const out = { narrow: await draw(310, 503.10), narrower: await draw(280, 503.10), missing: await draw(200, null), wide: await draw(800, 503.10) };
      return out;
    })()`);
    const p = [...r.narrow.p, ...r.narrower.p, ...r.missing.p, ...r.wide.p];
    if (!r.narrow.n || !r.missing.texts.some(t => /bull not computable/i.test(t))) p.push('the strip drew no labels, or did not name the bull case it could not compute: ' + JSON.stringify(r));
    if (r.wide.n !== 4) p.push(`at 800px the cases do not keep their own places: ${JSON.stringify(r.wide.texts)}`);
    if (p.length) fail('bugfix5 shell: the valuation range strip breaks a price across lines or lets its labels meet on a narrow strip', p);
    else ok(`bugfix5 shell: the valuation range strip keeps every label whole, inside the strip and clear of the others at 310, 280 and 200px ("${r.narrow.texts[0]}"), and its own places at 800px`);
  }
  {
    /* THE VALUE MAP'S CAPTION AND TICKS STAY ON THE CHART ON A PHONE. The
       short x caption measured 318px, so at 390px (a 310px chart) it ran past
       the right edge and at 360px (280px) past both; the last tick, centred
       on the plot's edge, clipped the "%" of "+70%". Drawn with the value
       map's own captions in charts 310 and 280px wide, every text sits inside
       the chart and the caption is whole across its lines; at 900px it is
       one line, as it was. */
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const pt = (id, x, y) => ({ id, label: id, name: id, x, y, size: 1, capLabel: '$1B', model: 'm', conf: 'Low', varName: '--s1' });
      const short = 'Difference to model estimate vs base-case model estimate', long = 'Difference to model estimate vs base-case value — right of the line is below it, left is above it';
      const draw = async (width, cap) => {
        const host = document.createElement('div'); host.style.cssText = 'width:' + width + 'px;position:absolute;left:0;top:0';
        document.body.append(host);
        scatterChart(host, { points: [pt('A', -35, 20), pt('B', 64, 80), pt('C', 10, null)],
          xLabel: long, xLabelShort: short,
          yLabel: 'Quality percentile within market cohort', yLabelShort: 'Quality percentile (market)', xFmt: v => withSign(v, 0), onPick: () => {} });
        await w(60);
        const svg = host.querySelector('svg'), sb = svg.getBoundingClientRect();
        /* The rotated y caption's box is its line height, not its ink. */
        const texts = [...svg.querySelectorAll('text')].filter(t => !t.hasAttribute('transform')).map(t => { const b = t.getBoundingClientRect(); return { t: t.textContent, l: b.left - sb.left, r: b.right - sb.left, y: t.getAttribute('y') }; });
        host.remove();
        const out = texts.filter(x => x.l < -0.5 || x.r > sb.width + 0.5).map(x => width + 'px: "' + x.t + '" runs from ' + Math.round(x.l) + ' to ' + Math.round(x.r) + ' of ' + Math.round(sb.width));
        const capLines = texts.filter(x => cap.includes(x.t) && x.t.split(' ').length > 1 && x.t !== 'Base-case model estimate');
        if (capLines.map(x => x.t).join(' ') !== cap) out.push(width + 'px: the caption reads "' + capLines.map(x => x.t).join(' / ') + '"');
        return { out, lines: capLines.length, ticks: texts.map(x => x.t).filter(t => /%$/.test(t)) };
      };
      const n310 = await draw(310, short), n280 = await draw(280, short), wide = await draw(900, long);
      return { p: [...n310.out, ...n280.out, ...wide.out], lines: [n310.lines, n280.lines, wide.lines], ticks: n310.ticks };
    })()`);
    const p = [...r.p];
    if (r.lines[2] !== 1) p.push(`at 900px the caption takes ${r.lines[2]} lines`);
    if (!r.ticks.includes('+70%')) p.push(`the ticks are not the ones this check describes: ${r.ticks.join(' ')}`);
    if (p.length) fail('bugfix5 shell: the value map lets its caption or its last tick run off the chart on a phone', p);
    else ok(`bugfix5 shell: the value map's caption and ticks stay on the chart at 310 and 280px (caption in ${r.lines[0]} and ${r.lines[1]} lines), one line at 900px`);
  }
  {
    /* THE DOCK SAYS WHAT THE PAGE SAYS. With the reserve unpriced (a loan
       tenure of 0) the property dock read "Safe cash" beside a total the
       capstrip above calls so far; it says "Safe cash so far" while a cost
       line is unpriced, and "Safe cash" again once none is. And on a Cash
       Wheel contract with no deliverable — no contracts, or an adjusted
       contract not yet verified — the dock read "$5.0k Cash buffer" in the
       colour of a surplus above a page suppressing the collateral; the
       buffer waits for an obligation, and a withheld figure takes no tone,
       as "Worst case at zero" did in the loss colour on a blank contract. */
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const figs = () => [...document.querySelectorAll('.dock .dock-fig')].map(f => ({
        k: f.querySelector('.dock-fig-k').textContent, v: f.querySelector('.dock-fig-v').textContent,
        tone: f.querySelector('.dock-fig-v').getAttribute('style') || '' }));
      const out = {};
      navigate('/property/calculator'); await w(150);
      State.deal.tenureYears = 0; saveDeal(); render(); await w(150);
      out.short = { figs: figs(), strip: /So far/.test(document.querySelector('main').textContent), missing: dealModel(State.deal).missingCostLines.length };
      State.deal.tenureYears = 35; saveDeal(); render(); await w(150);
      out.whole = { figs: figs(), missing: dealModel(State.deal).missingCostLines.length };
      navigate('/wheel'); await w(150);
      const set = async (patch) => { State.wheel = { ...State.wheel, ...patch }; saveWheel(); render(); await w(150); return figs(); };
      out.adjusted = await set({ ...WHEEL_WORKED_EXAMPLE, adjustedContract: true, adjustmentVerified: false });
      out.noContracts = await set({ ...WHEEL_WORKED_EXAMPLE, adjustedContract: false, contracts: 0 });
      out.worked = await set({ ...WHEEL_WORKED_EXAMPLE, adjustedContract: false });
      out.blank = await set({ ...WHEEL_BLANK_CONTRACT });
      return out;
    })()`);
    const p = [];
    const f = (list, k) => (list || []).find(x => x.k === k || x.k.startsWith(k));
    const safeShort = f(r.short.figs, 'Safe cash'), safeWhole = f(r.whole.figs, 'Safe cash');
    if (!r.short.missing || !r.short.strip) p.push(`tenure 0 no longer leaves a line unpriced (${r.short.missing}) — this check needs another way in`);
    if (safeShort?.k !== 'Safe cash so far') p.push(`tenure 0: the dock reads "${safeShort?.v} ${safeShort?.k}" under a capstrip reading "So far"`);
    if (r.whole.missing || safeWhole?.k !== 'Safe cash') p.push(`tenure 35: the dock reads "${safeWhole?.k}" with ${r.whole.missing} line(s) unpriced`);
    for (const [name, list] of [['adjusted, unverified', r.adjusted], ['no contracts', r.noContracts]]) {
      const buf = f(list, 'Cash buffer');
      if (buf?.v !== '—' || buf?.tone) p.push(`${name}: Cash buffer "${buf?.v}" ${buf?.tone}`);
    }
    const wBuf = f(r.worked, 'Cash buffer'), wWorst = f(r.worked, 'Worst case at zero');
    if (wBuf?.v !== '$0' || !/--ok-text/.test(wBuf?.tone) || !/--dn-text/.test(wWorst?.tone || '')) p.push(`the worked contract changed: ${JSON.stringify(r.worked)}`);
    const bWorst = f(r.blank, 'Worst case at zero');
    if (bWorst?.v !== '—' || bWorst?.tone) p.push(`blank contract: Worst case at zero "${bWorst?.v}" ${bWorst?.tone}`);
    if (p.length) fail('bugfix5 shell: the dock shows a short safe cash as whole, or a cash buffer against an obligation the page does not compute', p);
    else ok('bugfix5 shell: the dock reads "Safe cash so far" while a cost line is unpriced, withholds the Cash Wheel buffer until there is an obligation, and tones no withheld figure');
  }
  /* The deal and the wheel are put back, and the page reloaded from them. */
  await evaluate(`(() => { const keep = JSON.parse(${JSON.stringify(bf5Saved)});
    Object.keys(localStorage).forEach(k => { if (!(k in keep)) localStorage.removeItem(k); });
    Object.entries(keep).forEach(([k, v]) => localStorage.setItem(k, v)); return true; })()`);
  await send('Page.navigate', { url: `${BASE}/research` }, sessionId);
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try { if (await evaluate(`typeof realPending !== 'undefined' && !realPending && U.some(r => r.c.real)`)) break; } catch { /* booting */ }
  }
  /* ---- end bugfix5: shell ---- */

  /* ---- bot: pages ---- */
  /* THE READER'S TRADINGVIEW BOT ON THE SCANNER PAGES (the bot contract,
     B1–B4, 86-scanner.js):
     1. the builder offers each condition the setup's timeframe and the
        higher ones only, and names the one chosen in the condition's
        sentence ("… on the last closed weekly bar");
     2. a yes-or-no left side becomes "equals 1", reads "is true" or "is
        false", and its right side is a true-or-false choice, not a number;
     3. "Add your TradingView bot's signals" on the setups page offers the
        history's instruments with XAUUSD first and ticked, weekly and
        monthly ticked, every one of the script's alert titles as the
        script's in three groups with its three aggregates unticked, new
        matches and the EMA 200 by default; it saves what scanBotPack makes
        into this browser, says they must be exported, and says per
        instrument what weekly and monthly conditions need against the
        daily bars held;
     4. the setup page and the alert page say each condition's timeframe,
        and the alert page and the setup's matches the bar each was read on.
     On synthetic data only. The engine carries B1 (a condition's timeframe
     kept through normalising) and B4 (SCAN_BOT_SIGNALS, scanBotPack): the
     stand-ins this block installed while the pages were built ahead of the
     engine are gone (H3, A10), and the block fails if either is missing,
     rather than read the pages on a stand-in. A condition read on a higher
     timeframe says in "Read on" whether its bar was imported or built from
     the daily bars (H3, A9); the record here reads an imported week. */
  botPages: {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const main = () => document.querySelector('main');
      const keep = { h: scanHistoryFile, a: scanAlertsFile, s: scanSetupsFile, store: localStorage.getItem('vl.scanSetups'),
        bot: JSON.stringify(scanBotState), draft: scanDraft };
      /* The engine's own B1 and B4, or the block stops here and fails. */
      const out = { engine: {
        b1: typeof scanNormaliseNode === 'function' && scanNormaliseNode({ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 1 }, timeframe: '1W' }).timeframe === '1W',
        b4: typeof scanBotPack === 'function' && typeof SCAN_BOT_SIGNALS !== 'undefined' && Array.isArray(SCAN_BOT_SIGNALS) && SCAN_BOT_SIGNALS.length > 0 } };
      if (!out.engine.b1 || !out.engine.b4) return out;
      try {
        /* Synthetic: 300 weekday sessions of three instruments, with highs and lows. */
        const series = {}, ohlc = {}, days = [];
        for (let d = new Date('2026-09-25T00:00:00Z'); days.length < 300; d.setUTCDate(d.getUTCDate() - 1)) if (d.getUTCDay() % 6) days.unshift(d.toISOString().slice(0, 10));
        [['XAUUSD', 2000, 1], ['EURUSD', 1.1, 0.001], ['BTCUSD', 60000, 30]].forEach(([sym, base, step], si) => { series[sym] = {}; ohlc[sym] = {};
          days.forEach((day, i) => { const c = +(base + step * (Math.sin(i / 9 + si) * 20 + i * 0.3)).toFixed(4); series[sym][day] = c; ohlc[sym][day] = [c, +(c + 3 * step).toFixed(4), +(c - 3 * step).toFixed(4), c]; }); });
        scanHistoryFile = { generated: '2026-09-25T22:00:00Z', series, ohlc, volume: {} };
        scanAlertsFile = { alerts: [] }; scanSetupsFile = null;
        localStorage.removeItem('vl.scanSetups');
        Object.assign(scanBotState, { open: false, symbols: null, tfs: ['1W', '1M'], signals: null, cooldownMode: 'NEW_MATCH', criterion3: 'ema', result: null });

        /* 1 and 2 — the builder. */
        scanDraft = null;
        navigate('/app/scanner/setups/new'); await w(200);
        const sel = (l) => main().querySelector('select[aria-label="' + l + '"]');
        const pick = async (l, v) => { const s = sel(l); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); await w(60); };
        const prose = () => main().querySelector('.scan-cond .scan-prose')?.textContent || '';
        out.tfDaily = [...(sel('Condition 1: timeframe')?.options || [])].map(o => o.value);
        await pick('Condition 1: timeframe', '1W');
        out.tfProse = prose(); out.tfDraft = scanDraft.ruleTree.children[0].timeframe;
        await pick('Timeframe', '1W');
        out.tfWeekly = [...(sel('Condition 1: timeframe')?.options || [])].map(o => o.value + (o.disabled ? '!' : ''));
        out.tfWeeklyProse = prose();
        await pick('Timeframe', '1M');
        out.tfMonthly = [...(sel('Condition 1: timeframe')?.options || [])].map(o => o.value + (o.disabled ? '!' : ''));
        await pick('Timeframe', '1D');
        await pick('Condition 1: timeframe', '');
        out.tfCleared = 'timeframe' in scanDraft.ruleTree.children[0];
        await pick('Condition 1: timeframe', '1M');
        await pick('Condition 1: left side', 'wavetrend.crossUp');
        const c0 = scanDraft.ruleTree.children[0];
        out.flag = { op: c0.op, right: { ...c0.right }, prose: prose(), number: !!main().querySelector('input[aria-label="Condition 1: right side value"]'),
          choices: [...(sel('Condition 1: right side value')?.options || [])].map(o => o.value) };
        await pick('Condition 1: right side value', '0');
        out.flagFalse = prose();
        scanDraft = null;

        /* 3 — the bot's signals on the setups page. */
        navigate('/app/scanner/setups'); await w(200);
        const card = () => main().querySelector('details.scan-bot');
        out.cardClosed = !!card() && !card().open && /^Add your TradingView bot’s signals/.test(card().querySelector('summary').textContent);
        card().querySelector('summary').click(); await w(150);
        const boxes = (sels) => [...card().querySelectorAll(sels)];
        out.syms = boxes('.scan-bot-syms input').map(i => i.getAttribute('aria-label').replace('Instrument ', '') + (i.checked ? '*' : ''));
        out.tfs = boxes('input[aria-label^="Trade timeframe "]').map(i => i.getAttribute('aria-label').replace('Trade timeframe ', '') + (i.checked ? '*' : ''));
        out.legends = boxes('fieldset.scan-bot-set > legend').map(l => l.textContent);
        const sig = scanBotSignals();
        out.signals = sig.map(s => ({ id: s.id, title: s.title, aggregate: s.aggregate, group: s.group,
          boxes: boxes('input[aria-label="Your script’s ' + s.title + '"]').map(i => i.checked),
          label: boxes('input[aria-label="Your script’s ' + s.title + '"]').map(i => i.closest('label').querySelector('.scan-radio-l').textContent)[0] || null }));
        out.defaults = { record: card().querySelector('input[aria-label="Record: New matches"]')?.checked, crit: card().querySelector('input[aria-label="Criterion 3: Close above the EMA 200"]')?.checked };
        out.needs = card().querySelector('.scan-needs')?.innerText || '';
        out.expected = scanBotPack(scanBotOptions()).map(s => s.id);
        card().querySelector('input[aria-label="Criterion 3: Close above the SMA 200"]').click(); await w(40);
        out.sma = scanBotOptions().criterion3;
        card().querySelector('input[aria-label="Criterion 3: Close above the EMA 200"]').click(); await w(40);
        out.button = card().querySelector('button[data-scan-focus="bot-create"]').textContent;
        const save = card().querySelector('button[data-scan-focus="bot-create"]');
        save.focus(); save.click(); await w(250);
        const st = scanStoreRead();
        out.saved = Object.keys(st.setups).sort();
        out.sources = [...new Set(Object.values(st.setups).map(r => r.versions[0]?.source))];
        out.status = card()?.querySelector('.scan-bot-status')?.textContent || '';
        out.stillOpen = !!card()?.open;
        out.focus = document.activeElement?.dataset?.scanFocus || null;

        /* 4 — the setup page, and a record of it read on a closed week. */
        const id = 'mtfbot-w-strong-buy-continuous';
        const s = scanBrowserSetups().find(x => x.id === id);
        const conds = []; const walk = (n, p) => { if (n.type === 'group') n.children.forEach((c, j) => walk(c, p ? p + '.' + (j + 1) : String(j + 1))); else conds.push([n, p]); };
        walk(s.ruleTree, '');
        out.weeklyConds = conds.filter(([n]) => n.timeframe === '1W').length;
        navigate('/app/scanner/setups/' + id); await w(200);
        const cur = [...main().querySelectorAll('.card')].find(c => /^Current version/.test(c.querySelector('h2, h3')?.textContent || ''));
        out.setupLines = [...cur.querySelectorAll('.rulelist li')].map(li => li.textContent);
        out.setupTf = [...cur.querySelectorAll('.scan-fact')].find(f => f.querySelector('.stat-label')?.textContent === 'Timeframe')?.innerText || '';
        out.setupNeeds = cur.querySelector('.scan-needs')?.innerText || '';
        out.title = scanBotSignals().find(x => x.id === 'strong-buy-continuous')?.title || null;
        out.origin = [main().querySelector('.scan-bot-origin')?.textContent || ''];
        const mc = conds.map(([n, p]) => ({ path: p, text: scanConditionProse(n), state: 'MET', status: 'VALID', left: 1, right: 1, ...(n.timeframe ? { timeframe: n.timeframe, barDate: '2026-09-18', barOrigin: 'imported' } : {}) }));
        scanAlertsFile = { alerts: [{ id: 'abf0b07a', key: id + '|v1|XAUUSD|1D|2026-09-24|NEW_MATCH', setupId: id, setupName: s.name, setupVersion: 1, setupHash: s.hash, symbol: 'XAUUSD',
          timeframe: '1D', candleDate: '2026-09-24', close: 2100.5, eventType: 'NEW_MATCH', detectedAt: '2026-09-24T22:05:00Z', setupSnapshot: JSON.parse(JSON.stringify(s)), matchedConditions: mc }] };
        navigate('/app/scanner/alerts/abf0b07a'); await w(200);
        const t = [...main().querySelectorAll('table.dt')].find(x => /Conditions evaluated/.test(x.querySelector('caption')?.textContent || ''));
        out.head = [...t.querySelectorAll('thead th')].map(h => h.textContent);
        const ri = out.head.indexOf('Read on');
        out.rows = [...t.querySelectorAll('tbody tr')].map(tr => { const c = [...tr.children]; return [c[0].textContent, ri < 0 ? '' : c[ri].innerText.replace(/\\s+/g, ' ')]; });
        out.origin.push(main().querySelector('.scan-bot-origin')?.textContent || '');
        navigate('/app/scanner/setups/' + id); await w(200);
        out.mini = main().querySelector('.scan-alert-mini')?.textContent || '';
        return out;
      } finally {
        scanHistoryFile = keep.h; scanAlertsFile = keep.a; scanSetupsFile = keep.s; scanDraft = keep.draft;
        if (keep.store == null) localStorage.removeItem('vl.scanSetups'); else localStorage.setItem('vl.scanSetups', keep.store);
        Object.assign(scanBotState, JSON.parse(keep.bot));
        navigate('/learn');
      }
    })()`);
    if (!r.engine?.b1 || !r.engine?.b4) {
      fail('bot pages: the engine carries a condition\'s own timeframe through normalising (B1) and SCAN_BOT_SIGNALS and scanBotPack (B4) — the pages are no longer read on a stand-in', r.engine);
      break botPages;
    }

    const p1 = [];
    if (JSON.stringify(r.tfDaily) !== JSON.stringify(['', '1W', '1M'])) p1.push(`a daily setup's condition offers ${JSON.stringify(r.tfDaily)}, not the setup's, weekly and monthly`);
    if (!/ on the last closed weekly bar$/.test(r.tfProse) || r.tfDraft !== '1W') p1.push(`weekly chosen: "${r.tfProse}", draft ${r.tfDraft}`);
    if (JSON.stringify(r.tfWeekly) !== JSON.stringify(['', '1M']) || / on the last closed/.test(r.tfWeeklyProse)) p1.push(`a weekly setup: offers ${JSON.stringify(r.tfWeekly)}, and its weekly condition reads "${r.tfWeeklyProse}"`);
    if (JSON.stringify(r.tfMonthly) !== JSON.stringify(['', '1W!'])) p1.push(`a monthly setup with a weekly condition offers ${JSON.stringify(r.tfMonthly)} — the lower one should show as refused, not as a choice`);
    if (r.tfCleared) p1.push('"the setup’s timeframe" left a timeframe on the condition');
    if (p1.length) fail('bot pages: a condition in the builder reads the setup’s timeframe or a higher one, named in its sentence', p1);
    else ok(`bot pages: a condition in the builder offers the setup's timeframe and the higher ones only — daily: setup's, weekly, monthly; weekly: setup's, monthly; a weekly condition under a monthly setup shows as refused — and says the one chosen: "${r.tfProse}"`);

    const p2 = [];
    if (r.flag.op !== 'EQUALS' || r.flag.right?.value !== 1) p2.push(`a yes-or-no left side left the condition at ${r.flag.op} ${JSON.stringify(r.flag.right)}, not equals 1`);
    if (!/crosses over WT2 is true on the last closed monthly bar$/.test(r.flag.prose)) p2.push(`its sentence: "${r.flag.prose}"`);
    if (r.flag.number || JSON.stringify(r.flag.choices) !== JSON.stringify(['1', '0'])) p2.push(`its right side: a number box ${r.flag.number}, choices ${JSON.stringify(r.flag.choices)}`);
    if (!/ is false on the last closed monthly bar$/.test(r.flagFalse)) p2.push(`false chosen: "${r.flagFalse}"`);
    if (p2.length) fail('bot pages: a yes-or-no condition is "is true" or "is false", chosen, not typed', p2);
    else ok(`bot pages: a yes-or-no left side becomes equals 1 with a true-or-false choice for its right side, no number box, and reads "${r.flag.prose}" / "… is false …"`);

    const p3 = [];
    if (!r.cardClosed) p3.push('the setups page has no closed "Add your TradingView bot’s signals" card');
    if (JSON.stringify(r.syms) !== JSON.stringify(['XAUUSD*', 'BTCUSD', 'EURUSD'])) p3.push(`instruments ${JSON.stringify(r.syms)} — XAUUSD first and ticked, the rest unticked`);
    if (JSON.stringify(r.tfs) !== JSON.stringify(['Weekly*', 'Monthly*'])) p3.push(`trade timeframes ${JSON.stringify(r.tfs)}`);
    ['Trade timeframe', 'Entry (daily)', 'Combined'].forEach(g => { if (!r.legends.includes(g)) p3.push(`no "${g}" group`); });
    if (r.signals.length < 15) p3.push(`${r.signals.length} of the script's 15 alerts listed`);
    r.signals.forEach(s => {
      if (s.boxes.length !== 1) p3.push(`${s.title}: ${s.boxes.length} boxes`);
      else if (s.boxes[0] === s.aggregate) p3.push(`${s.title} is ${s.boxes[0] ? '' : 'un'}ticked by default`);
      if (s.label !== 'your script’s ' + s.title) p3.push(`${s.title} is labelled "${s.label}", not as the script's`);
    });
    const agg = r.signals.filter(s => s.aggregate).map(s => s.title).sort();
    if (agg.length !== 3 || ![/^ANY STRONG/i, /^ANY WEAK/i, /^Entry TF Trade$/i].every(re => agg.some(t => re.test(t)))) p3.push(`the aggregates read as ${JSON.stringify(agg)}`);
    if (!r.defaults.record || !r.defaults.crit || r.sma !== 'sma') p3.push(`defaults ${JSON.stringify(r.defaults)}, SMA switch ${r.sma}`);
    ['XAUUSD — 300 daily bars held', '200 weekly bars (about 1,000 daily bars)', 'about 17 years', 'about 4 years'].forEach(x => { if (!r.needs.includes(x)) p3.push(`the history note lacks "${x}": ${r.needs.slice(0, 400)}`); });
    if (r.button !== `Save ${r.expected.length} setups` || !r.expected.length) p3.push(`the button reads "${r.button}" for ${r.expected.length}`);
    if (JSON.stringify(r.saved) !== JSON.stringify([...r.expected].sort()) || !r.saved.every(x => /^mtfbot-[wmd]-/.test(x))) p3.push(`saved ${JSON.stringify(r.saved)} for ${JSON.stringify(r.expected)}`);
    if (JSON.stringify(r.sources) !== '["bot"]') p3.push(`saved from ${JSON.stringify(r.sources)}`);
    if (!new RegExp(`^Saved ${r.expected.length} setups in this browser`).test(r.status) || !r.status.includes('until you export scan-setups.json above') || !r.stillOpen || r.focus !== 'bot-create') p3.push(`after saving: "${r.status}", open ${r.stillOpen}, focus ${r.focus}`);
    if (p3.length) fail(`bot pages: "Add your TradingView bot’s signals" offers the script's alerts as its own and saves what the engine's scanBotPack makes`, p3);
    else ok(`bot pages: "Add your TradingView bot’s signals" offers XAUUSD first and ticked, weekly and monthly, all ${r.signals.length} of the script's alerts labelled "your script’s …" in three groups with ANY STRONG, ANY WEAK and Entry TF Trade unticked, new matches and the EMA 200 by default; it names what weekly and monthly need against 300 daily bars (about 1,000 daily bars, 4 and 17 years), saves the ${r.expected.length} setups the engine's scanBotPack makes, and says they must be exported`);

    const p4 = [];
    const weeklyLines = r.setupLines.filter(l => / on the last closed weekly bar$/.test(l)).length;
    if (!r.weeklyConds || weeklyLines < r.weeklyConds) p4.push(`${weeklyLines} lines of the setup page name the weekly bar, for ${r.weeklyConds} weekly conditions`);
    if (!/with weekly conditions/.test(r.setupTf) || !/reads? the last closed week/.test(r.setupTf)) p4.push(`its Timeframe fact: ${r.setupTf}`);
    if (!/XAUUSD — 300 daily bars held/.test(r.setupNeeds) || !/Weekly — 60 closed weeks held/.test(r.setupNeeds)) p4.push(`its history note: ${r.setupNeeds.slice(0, 300)}`);
    if (!r.head.includes('Read on')) p4.push(`the alert's conditions table has no "Read on": ${r.head.join(', ')}`);
    /* The record's weekly conditions read an imported week (barOrigin), and
       "Read on" says so; the daily ones name no origin. */
    const wk = r.rows.filter(x => x[1] === 'Weekly bar closing 2026-09-18 · imported').length, dy = r.rows.filter(x => x[1] === 'Daily bar closing 2026-09-24').length;
    if (wk !== r.weeklyConds || wk + dy !== r.rows.length) p4.push(`read on: ${JSON.stringify(r.rows)}`);
    if (!/read on the weekly bar closing 2026-09-18 · imported/.test(r.mini)) p4.push(`the setup's matches: ${r.mini}`);
    r.origin.forEach((o, i) => { if (!r.title || !o.startsWith(`Your script’s ${r.title}, with its trade timeframe read on the last closed weekly bar`)) p4.push(`the ${i ? 'alert' : 'setup'} page does not name the alert as the script's: "${o}"`); });
    if (p4.length) fail('bot pages: the setup and alert pages say each condition’s timeframe and the bar it was read on', p4);
    else ok(`bot pages: the setup page names each of the ${r.weeklyConds} weekly conditions "on the last closed weekly bar", says what the history holds for them, and the alert page reads each condition on its bar — ${wk} on the imported weekly bar closing 2026-09-18, ${dy} on the daily bar of the alert — as the setup's matches do; both pages name it "your script’s ${r.title}"`);
  }
  /* ---- end bot: pages ---- */
  /* ---- release-a: public ---- */
  /* THE HOMEPAGE AND /how-it-works (Release A, 55-views-public.js).
     The homepage is the brief's: its eyebrow and headline, one primary action
     (the workspace), the four products read from PRODUCTS — each one with a
     path a whole-card link to a route that renders, the one without a path
     text with no link in it — the disclosure line to /data-sources and the
     line about where saved work lives; and no figure, chart, table or example
     at all, because it must not read as a trading terminal. The examples are
     on /how-it-works: five steps for every built product and none for the
     unbuilt one, the four status meanings, the five-step journey, the three
     computed proof cards, every primary button to /app, and a company pick
     that repaints its panel under the pressed button — it used to re-render
     the page and drop focus to <body> — with the illustrative label on an
     illustrative company. Every link on both pages resolves to a route that
     renders. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const P = PRODUCTS;
      const LABEL = PRODUCT_STATUS;
      const main = () => document.querySelector('#views');
      const resolves = (h) => { const u = new URL(h, location.origin); const rt = matchRoute(u.pathname); return !!rt && typeof VIEWS[rt.view] === 'function'; };
      const dead = (root) => [...root.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => !h.startsWith('#') && !resolves(h));
      const out = {};
      navigate('/'); await w(150);
      const m = main();
      out.home = {
        view: State.view,
        h1: m.querySelector('h1')?.textContent,
        kicker: m.querySelector('.pub-kicker')?.textContent,
        primary: [...m.querySelectorAll('.btn-primary')].map(b => [b.textContent.trim(), b.getAttribute('href')]),
        explore: [...m.querySelectorAll('a')].find(a => a.textContent.trim() === 'Explore products')?.getAttribute('href'),
        cards: [...m.querySelectorAll('.pub-card')].map(c => ({ tag: c.tagName, href: c.getAttribute('href'),
          title: c.querySelector('.pub-card-title')?.textContent, links: c.querySelectorAll('a').length,
          badge: c.querySelector('.status-badge')?.textContent.trim() })),
        want: P.map(p => ({ path: p.path ? href(p.path) : null, task: p.task, badge: LABEL[p.status] })),
        figures: m.querySelectorAll('svg[aria-label], canvas, table, .proof-card, .stat, .segmented, .hero-proof').length,
        dataSources: !!m.querySelector('.pub-disclose a[href$="/data-sources"]'),
        myData: !!m.querySelector('a[href$="/my/data"]'),
        dead: dead(m),
      };
      navigate('/how-it-works'); await w(150);
      const h = main();
      out.hiw = {
        view: State.view,
        primary: [...h.querySelectorAll('.btn-primary')].map(b => b.getAttribute('href')),
        sections: P.map(p => { const s = h.querySelector('#hiw-' + p.id);
          return s ? { id: p.id, built: !!p.path, steps: s.querySelectorAll('.hiw-step').length, links: s.querySelectorAll('a').length } : { id: p.id, missing: true }; }),
        legend: h.querySelectorAll('.hiw-status-item').length,
        journey: h.querySelectorAll('.hiw-path-step').length,
        proofs: [...h.querySelectorAll('.proof-card .proof-hd')].map(x => x.firstElementChild?.textContent),
        dead: dead(h),
      };
      const btns = [...h.querySelectorAll('.hiw-seg button')];
      const pick = async (b) => {
        if (!b) return null;
        b.focus(); b.click(); await w(60);
        return { focused: b.isConnected && document.activeElement === b,
          pressed: main().querySelector('.hiw-seg button[aria-pressed="true"]') === b,
          label: main().querySelector('.hiw-panel .hiw-label')?.textContent || '' };
      };
      out.pick = { n: btns.length,
        illus: await pick(btns.find(b => BY_ID.get(b.dataset.pick) && !BY_ID.get(b.dataset.pick).c.real)),
        real: await pick(btns.find(b => BY_ID.get(b.dataset.pick)?.c.real)) };
      navigate('/');
      return out;
    })()`);
    const p = [];
    const { home, hiw, pick } = r;
    if (home.view !== 'marketing') p.push(`/ renders ${home.view}`);
    if (home.h1 !== 'Make financial decisions with greater clarity.') p.push(`homepage h1: "${home.h1}"`);
    if (home.kicker !== 'Research · Monitor · Model · Plan') p.push(`homepage eyebrow: "${home.kicker}"`);
    if (home.primary.length !== 1 || home.primary[0][0] !== 'Open your workspace' || !/\/app$/.test(home.primary[0][1] || ''))
      p.push(`homepage primary actions: ${JSON.stringify(home.primary)}`);
    if (home.explore !== '#products') p.push(`"Explore products" goes to ${home.explore}`);
    if (home.cards.length !== home.want.length) p.push(`${home.cards.length} product cards for ${home.want.length} products`);
    home.want.forEach((want, i) => {
      const c = home.cards[i] || {};
      if (c.title !== want.task) p.push(`card ${i + 1} is titled "${c.title}", not "${want.task}"`);
      if (c.badge !== want.badge) p.push(`card "${want.task}" wears "${c.badge}", not "${want.badge}"`);
      if (want.path && (c.tag !== 'A' || c.href !== want.path)) p.push(`card "${want.task}" is ${c.tag} to ${c.href}, not a link to ${want.path}`);
      if (!want.path && (c.tag === 'A' || c.links)) p.push(`card "${want.task}" has no product to open and still links (${c.tag}, ${c.links} links)`);
    });
    if (home.figures) p.push(`the homepage carries ${home.figures} figures, charts, tables or examples`);
    if (!home.dataSources || !home.myData) p.push(`homepage links: data sources ${home.dataSources}, your data ${home.myData}`);
    if (home.dead.length) p.push(`homepage links to no page: ${home.dead.join(', ')}`);
    if (hiw.view !== 'howItWorks') p.push(`/how-it-works renders ${hiw.view}`);
    if (!hiw.primary.length || hiw.primary.some(x => !/\/app$/.test(x || ''))) p.push(`/how-it-works primary actions: ${JSON.stringify(hiw.primary)}`);
    hiw.sections.forEach(s => {
      if (s.missing) p.push(`/how-it-works has no section for ${s.id}`);
      else if (s.built && s.steps !== 5) p.push(`${s.id}: ${s.steps} workflow steps, not 5`);
      else if (!s.built && (s.steps || s.links)) p.push(`${s.id} is not built and shows ${s.steps} steps and ${s.links} links`);
    });
    if (hiw.legend !== 4) p.push(`${hiw.legend} status meanings, not 4`);
    if (hiw.journey !== 5) p.push(`${hiw.journey} journey steps, not 5`);
    for (const t of ['Sarawak property', 'US options Cash Wheel', 'QT Trading Index'])
      if (!hiw.proofs.includes(t)) p.push(`/how-it-works lost the "${t}" example (${hiw.proofs.join(', ')})`);
    if (hiw.dead.length) p.push(`/how-it-works links to no page: ${hiw.dead.join(', ')}`);
    if (pick.n < 3 || !pick.illus || !pick.real) p.push(`the report preview offers ${pick.n} companies (illustrative ${!!pick.illus}, filed ${!!pick.real})`);
    for (const [k, x] of [['illustrative', pick.illus], ['filed', pick.real]]) {
      if (x && (!x.focused || !x.pressed)) p.push(`picking the ${k} company lost focus or its pressed state: ${JSON.stringify(x)}`);
    }
    if (pick.illus && !/illustrative figures/.test(pick.illus.label)) p.push(`an illustrative company's preview is not labelled: "${pick.illus.label}"`);
    if (pick.real && !/filed with the SEC/.test(pick.real.label)) p.push(`a filed company's preview does not say so: "${pick.real.label}"`);
    if (p.length) fail('release-a public: the homepage and /how-it-works say what the brief says, and every link on them opens a page', p);
    else ok(`release-a public: the homepage has one action, ${home.cards.length} product cards from PRODUCTS and no figures; /how-it-works has the steps, ${hiw.legend} labels, ${hiw.journey} journey steps and ${hiw.proofs.length} computed examples, and a pick keeps focus`);
  }
  /* ---- end release-a: public ---- */
  /* ---- release-a: dashboard ---- */
  /* MY DASHBOARD COUNTS ONLY WHAT IS THE VISITOR'S, AND EVERY COUNT IS A DOOR.
     /app was the equities research queue; Release A makes it the visitor's
     own dashboard and moves the queue to /research/queue. The rules it must
     keep: with nothing of the visitor's own saved it is a checklist, never
     tiles of zeros; the samples seeded on a first visit are never counted as
     the visitor's; an absent scanner record is said to be absent, never a
     nought; "new since the last visit" is by when the worker recorded a match
     and survives a redraw inside the visit; a setup's name is quoted as the
     visitor's own; and every link on the page opens a route that renders. A
     clean profile is loaded for it (onboarded, so the router's gate is not
     what is measured), and the reader's storage is put back after. */
  {
    const keepLs = await evaluate(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))`);
    const reload = async (path) => {
      await send('Page.navigate', { url: `${BASE}${path}` }, sessionId);
      for (let i = 0; i < 60; i++) {
        await sleep(300);
        try { if (await evaluate(`typeof realPending !== 'undefined' && !realPending && U.some(r => r.c.real)`)) break; } catch { /* booting */ }
      }
    };
    await evaluate(`(() => { Object.keys(localStorage).filter(k => k.startsWith('vl.')).forEach(k => localStorage.removeItem(k));
      localStorage.setItem('vl.plan', JSON.stringify('pro'));
      localStorage.setItem('vl.onboarding', JSON.stringify({ done: true, at: '2026-09-27T00:00:00Z' })); return true; })()`);
    await reload('/app');
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const main = () => document.querySelector('#views');
      /* Every link the page draws, by the route it opens. */
      const deadLinks = () => [...main().querySelectorAll('a[href]')].map(a => new URL(a.href).pathname)
        .filter(p => { const rt = matchRoute(p); return !rt || !VIEWS[rt.view]; });
      const tiles = () => Object.fromEntries([...main().querySelectorAll('.dash-tile')].map(t => [t.querySelector('.stat-label').textContent, { v: t.querySelector('.dash-tile-v').textContent, href: new URL(t.href).pathname }]));
      const out = {};
      /* The deployed site: the worker's files are never there. */
      scanSetupsFile = null; scanAlertsFile = null; navigate('/app'); await w(200);
      out.first = { view: State.view, start: !!main().querySelector('.dash-start'), tiles: main().querySelectorAll('.dash-tile').length,
        steps: [...main().querySelectorAll('.dash-step')].map(s => s.dataset.done).join(''), progress: main().querySelector('.dash-progress-t')?.textContent,
        primary: main().querySelectorAll('.dash-start .btn-primary').length, samples: !!main().querySelector('.dash-note'), seeded: hasSeededData(),
        prefs: !!main().querySelector('a[href$="/welcome"]'), start2: !!main().querySelector('a[href$="/start"]'), dead: deadLinks() };
      /* Two steps taken: a company read, and a list of the reader's own. */
      openResearch('MAYBANK'); await w(200); openResearch('MSFT-SEC'); await w(200);
      const made = wlCreate('release-a list'); wlAdd(made.watchlist.id, 'MSFT-SEC'); wlAdd(made.watchlist.id, 'MAYBANK');
      navigate('/app'); await w(200);
      out.second = { tiles: tiles(), steps: [...main().querySelectorAll('.dash-step')].length, dead: deadLinks(),
        text: main().textContent.replace(/\\s+/g, ' ') };
      /* A visit two hours ago, and the worker's record: two matches found
         since, one before, one of them read here. */
      store.write('dashVisit', { prev: null, seen: new Date(Date.now() - 2 * 3600e3).toISOString() });
      const now = new Date().toISOString();
      scanAlertsFile = { alerts: [
        { id: 'a0ra00001', setupId: 'ra-wt', setupName: 'WaveTrend Buy', setupVersion: 1, symbol: 'MSFT', candleDate: '2026-09-28', eventType: 'NEW_MATCH', close: 510, detectedAt: now },
        { id: 'a0ra00002', setupId: 'ra-wt', setupName: 'WaveTrend Buy', setupVersion: 1, symbol: 'AAPL', candleDate: '2026-09-28', eventType: 'MATCH', close: 230, detectedAt: now },
        { id: 'a0ra00003', setupId: 'ra-wt', setupName: 'WaveTrend Buy', setupVersion: 1, symbol: 'NVDA', candleDate: '2026-09-24', eventType: 'MATCH', close: 180, detectedAt: '2026-09-25T00:00:00Z' },
      ] };
      scanSetAlertStatus(['a0ra00002'], 'READ');
      navigate('/app'); await w(200);
      const rows = () => [...main().querySelectorAll('.dash-matches a.dash-row')];
      out.third = { tiles: tiles(), lede: main().querySelector('.dash-hd .body-lg').textContent,
        rows: rows().map(a => ({ href: new URL(a.href).pathname, text: a.textContent.replace(/\\s+/g, ' ').trim() })), dead: deadLinks() };
      /* A redraw inside the same visit keeps the count. */
      render(); await w(100);
      out.redraw = tiles()['New scanner alerts']?.v;
      /* The research queue is the old dashboard, whole. */
      navigate('/research/queue'); if (State.view !== 'researchQueue') { State.view = 'researchQueue'; render(); } await w(200);
      out.queue = { h1: main().querySelector('h1')?.textContent, fresh: /Freshness/.test(main().textContent), largest: /Largest differences/.test(main().textContent),
        waits: UNIVERSE_VIEWS.has('researchQueue') };
      return out;
    })()`);
    const p = [];
    const f = r.first;
    if (f.view !== 'home' || !f.start || f.tiles !== 0) p.push(`first time: view ${f.view}, checklist ${f.start}, ${f.tiles} tiles`);
    if (f.steps !== '0000' || f.progress !== '0 of 4 done') p.push(`first time: steps ${f.steps}, "${f.progress}" — the seeded samples were counted as the visitor's`);
    if (f.primary !== 1) p.push(`first time: ${f.primary} primary actions in the checklist, not one`);
    if (!f.seeded || !f.samples) p.push(`first time: the seeded samples (${f.seeded}) are not named on the page (${f.samples})`);
    if (!f.prefs || !f.start2) p.push(`first time: "Set your preferences" ${f.prefs}, "Not sure where to start?" ${f.start2}`);
    const s = r.second, t2 = s.tiles;
    if (t2['Instruments watchlisted']?.v !== '2') p.push(`one list of two companies reads ${JSON.stringify(t2['Instruments watchlisted'])} — the samples were counted`);
    if (t2['Scanner alerts']?.v !== 'No record') p.push(`with no record visible the alerts tile reads ${JSON.stringify(t2['Scanner alerts'])}, not "No record"`);
    if (t2['Active setups']?.v !== '0' || t2['Saved models']?.v !== '0') p.push(`counts with nothing saved: ${JSON.stringify(t2)}`);
    if (s.steps !== 2) p.push(`next steps list ${s.steps} steps, not the two not taken`);
    const hrefs = { 'Active setups': '/app/scanner/setups', 'Scanner alerts': '/app/scanner/alerts', 'Instruments watchlisted': '/my/watchlists', 'Saved models': '/my/workspace' };
    for (const [k, h] of Object.entries(hrefs)) if (!t2[k] || !t2[k].href.endsWith(h)) p.push(`the ${k} tile opens ${t2[k]?.href}, not ${h}`);
    if (!/MSFT/.test(s.text) || !/illustrative/i.test(s.text)) p.push('the recently read companies are not named, or the illustrative one is not marked');
    const t = r.third;
    if (t.tiles['New scanner alerts']?.v !== '2' || r.redraw !== '2') p.push(`new since the visit: ${t.tiles['New scanner alerts']?.v}, after a redraw ${r.redraw} — want 2 and 2`);
    if (!/2 new matches/.test(t.lede)) p.push(`the lede does not say what changed: "${t.lede}"`);
    if (t.rows.length !== 3 || t.rows.some(x => !/^\/app\/scanner\/alerts\/a0ra0000[123]$/.test(x.href))) p.push(`match rows: ${JSON.stringify(t.rows.map(x => x.href))}`);
    if (t.rows.some(x => !/Your setup “WaveTrend Buy”/.test(x.text))) p.push(`a setup's name is not quoted as the visitor's own: ${JSON.stringify(t.rows.map(x => x.text))}`);
    if (!/^MSFT/.test(t.rows[0]?.text || '') || !/new/.test(t.rows[0]?.text || '') || /new/.test((t.rows[1]?.text || '').replace(/new match/, ''))) p.push(`order or read state: ${JSON.stringify(t.rows.map(x => x.text))}`);
    const dead = [...f.dead, ...s.dead, ...t.dead];
    if (dead.length) p.push(`links to routes that do not render: ${[...new Set(dead)].join(', ')}`);
    if (r.queue.h1 !== 'Research queue' || !r.queue.fresh || !r.queue.largest || !r.queue.waits) p.push(`the research queue: ${JSON.stringify(r.queue)}`);
    if (p.length) fail('release-a dashboard: the visitor’s own counts, doors and record', p);
    else ok(`release-a dashboard: a clean profile gets the four-step checklist (0 of 4, samples named and not counted, one primary action); a list of its own reads 2 instruments, an absent record reads "No record", and ${t.tiles['New scanner alerts'].v} matches recorded since the last visit stay ${r.redraw} after a redraw; each of ${t.rows.length} rows opens its alert as “your setup”, no link leads to a route that does not render, and the research queue keeps the old dashboard`);
    await evaluate(`(() => { const keep = JSON.parse(${JSON.stringify(keepLs)});
      Object.keys(localStorage).forEach(k => { if (!(k in keep)) localStorage.removeItem(k); });
      Object.entries(keep).forEach(([k, v]) => localStorage.setItem(k, v)); return true; })()`);
    await reload('/research');
  }
  /* ---- end release-a: dashboard ---- */

  /* ---- release-a: integration ---- */
  /* WHERE THE THREE RELEASE A BRANCHES MEET. What the merge decided, held:
     1. every public page wears the short disclosure '/' wears — no chips, the
        long text folded — with "Which sources?" opening every word of it, and
        every app page the full strip; the surface follows the chrome;
     2. one row of navigation per level on the screener: the product row has
        one "Screener" tab, current on all four tabs of the screener's page,
        and no "Value map" tab, whose page is one click away in the page's own
        strip; the research queue is Equities', in the sidebar and the tabs;
     3. the Trading Index is the last row of the strip every scanner page
        draws (SCANNER_SUBNAV), not a row copied into it at boot;
     4. the scanner's unread count beside My Alerts is named for the page it
        opens, and carries the Scanner's mark;
     5. /welcome's way out is a 44px target at every width;
     6. the dashboard's footnote names the page its link opens. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const shown = (n) => !!n && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none';
      const out = { surfaces: {}, tabs: {} };
      for (const p of ['/', '/how-it-works', '/pricing', '/about', '/learn/glossary', '/data-sources', '/status', '/app', '/discover/screener', '/research/trading-index']) {
        navigate(p); await w(40);
        out.surfaces[p] = { chrome: document.documentElement.dataset.chrome, surface: document.body.dataset.surface,
          chips: [...document.querySelectorAll('.disclosure-in .chip')].some(shown), long: shown(document.querySelector('.disclosure-long')),
          more: shown(document.getElementById('disclosureMore')) };
      }
      navigate('/how-it-works'); await w(40);
      const more = document.getElementById('disclosureMore');
      more.click(); await w(20);
      out.opened = { long: shown(document.querySelector('.disclosure-long')), exp: more.getAttribute('aria-expanded') };
      more.click(); await w(20);
      out.closed = { long: shown(document.querySelector('.disclosure-long')), exp: more.getAttribute('aria-expanded') };
      for (const p of ['/discover/screener', '/discover/value-map', '/discover?tab=ideas', '/discover?tab=heatmap', '/research/queue']) {
        navigate(p); await w(40);
        out.tabs[p] = { labels: [...document.querySelectorAll('#productTabs .ptab')].map(a => a.textContent),
          current: [...document.querySelectorAll('#productTabs .ptab[aria-current=page]')].map(a => a.textContent),
          sub: [...document.querySelectorAll('#views [role=tablist][aria-label="Screener tools"] [role=tab]')].map(t => t.textContent),
          side: document.querySelector('#appnav a[aria-current=page] .sb-text')?.textContent.trim() || null };
      }
      out.strip = SCANNER_SUBNAV.map(s => s.id);
      navigate('/app/scanner/setups'); await w(40);
      out.stripOnPage = [...document.querySelectorAll('#views nav[aria-label="Scanner sections"] a')].map(a => a.textContent);
      const keepA = scanAlertsFile, keepSt = localStorage.getItem('vl.scanAlertState'), keepPrefs = localStorage.getItem('vl.scanPrefs');
      try {
        localStorage.removeItem('vl.scanAlertState'); localStorage.removeItem('vl.scanPrefs');
        scanAlertsFile = { alerts: [1, 2, 3].map(i => ({ id: 'aint000' + i, key: 'int|' + i, setupId: 'int-setup', setupName: 'Integration', setupVersion: 1,
          symbol: 'XAUUSD', timeframe: '1D', candleDate: '2026-09-2' + i, close: 1, eventType: 'NEW_MATCH', detectedAt: '2026-09-2' + i + 'T22:00:00Z' })) };
        navigate('/app'); await w(60);
        const c = document.querySelector('#appnav [data-item="alerts"] .sb-count');
        out.count = c ? { label: c.getAttribute('aria-label'), href: new URL(c.href).pathname, text: c.textContent.trim(), mark: !!c.querySelector('.sb-count-ico svg') } : null;
      } finally {
        scanAlertsFile = keepA;
        if (keepSt == null) localStorage.removeItem('vl.scanAlertState'); else localStorage.setItem('vl.scanAlertState', keepSt);
        if (keepPrefs == null) localStorage.removeItem('vl.scanPrefs'); else localStorage.setItem('vl.scanPrefs', keepPrefs);
      }
      const keepOb = State.obStep;
      State.obStep = 1; navigate('/welcome'); await w(60);
      out.welcome = [...document.querySelectorAll('.ob-foot .btn')].map(b => ({ t: b.textContent.trim(), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }));
      State.obStep = keepOb;
      navigate('/app'); await w(60);
      const foot = [...document.querySelectorAll('#views .dash-foot a')].find(a => new URL(a.href).pathname === '/research/queue');
      out.foot = foot ? foot.textContent : null;
      navigate('/research');
      return out;
    })()`);
    const p = [];
    for (const [path, s] of Object.entries(r.surfaces)) {
      const pub = s.chrome === 'public';
      if (s.surface !== s.chrome) p.push(`${path}: surface ${s.surface} under the ${s.chrome} chrome`);
      if (pub && (s.chips || s.long || !s.more)) p.push(`${path} (public) shows the app's strip: ${JSON.stringify(s)}`);
      if (!pub && s.long === false && s.more === false) p.push(`${path} (app) hides the long disclosure with no way to it: ${JSON.stringify(s)}`);
    }
    if (!r.opened.long || r.opened.exp !== 'true' || r.closed.long || r.closed.exp !== 'false') p.push(`"Which sources?" on /how-it-works: opened ${JSON.stringify(r.opened)}, closed ${JSON.stringify(r.closed)}`);
    for (const [path, t] of Object.entries(r.tabs)) {
      if (t.labels.includes('Value map')) p.push(`${path}: the product row still carries "Value map" (${t.labels.join(' · ')})`);
      if (t.side !== 'Equities Research') p.push(`${path}: the sidebar marks ${t.side}`);
      const want = path === '/research/queue' ? 'Research queue' : 'Screener';
      if (t.current.length !== 1 || t.current[0] !== want) p.push(`${path}: product tab current ${JSON.stringify(t.current)}, not "${want}"`);
      if (path !== '/research/queue' && t.sub.join('|') !== 'Stock Screener|Quality vs Value Map|Screening Strategies|Heatmap') p.push(`${path}: the screener's own strip reads ${t.sub.join(' · ')}`);
    }
    if (r.strip[r.strip.length - 1] !== 'trading' || r.strip.filter(x => x === 'trading').length !== 1) p.push(`SCANNER_SUBNAV: ${r.strip.join(', ')}`);
    if (r.stripOnPage[r.stripOnPage.length - 1] !== 'Trading Index') p.push(`a scanner page's strip ends ${r.stripOnPage.slice(-1)[0]}`);
    if (!r.count || r.count.label !== 'Scanner alerts, 3 unread' || r.count.href !== '/app/scanner/alerts' || r.count.text !== '3' || !r.count.mark) p.push(`the unread count beside My Alerts: ${JSON.stringify(r.count)}`);
    if (r.welcome.length < 2 || r.welcome.some(b => b.h < 44 || b.w < 44)) p.push(`/welcome's Back and Skip: ${JSON.stringify(r.welcome)}`);
    if (r.foot !== 'Research queue') p.push(`the dashboard's footnote link to /research/queue reads "${r.foot}"`);
    if (p.length) fail('release-a integration: public pages wear the short disclosure, one navigation row per level, the Trading Index in the scanner strip, a named unread count, 44px on /welcome', p);
    else ok(`release-a integration: ${Object.values(r.surfaces).filter(s => s.chrome === 'public').length} public pages wear the short disclosure with every word behind "Which sources?"; one "Screener" product tab, current on all four screener tabs, over the page's own strip; the Trading Index last in SCANNER_SUBNAV; the unread count named "${r.count.label}"; /welcome's ${r.welcome.map(b => b.t.split(' ')[0]).join(' and ')} at ${Math.min(...r.welcome.map(b => b.h))}px; the footnote's link says "${r.foot}"`);
  }
  /* ---- end release-a: integration ---- */

  /* ---- release-a: fixes ---- */
  /* THE DASHBOARD COUNTS ONLY WHAT THE VISITOR DID. One "Add to watchlist" on
     a company page adds to the active list — the seeded Core watchlist on a
     fresh profile, and step 2 of the journey /how-it-works describes — and
     that one touch made all six seeded companies "yours": 7 instruments "in 1
     list of your own", and "Create a watchlist" ticked with no list created.
     Also: the Continue rows use the reader's clock, as the lede does, and a
     list of illustrative companies wears the illustrative chip. */
  {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const keep = { wl: JSON.stringify(State.watchlists), idx: State.wlIdx, visit: localStorage.getItem('vl.dashVisit'),
        recent: JSON.stringify(State.recentCompanies || []) };
      const out = {};
      try {
        /* A fresh profile's lists, as 05-plans.js seeds them and the migration dates them: no member dated. */
        const seed = (id, name, ids) => ({ id, name, ids: [...ids], added: Object.fromEntries(ids.map(x => [x, null])), createdAt: null, updatedAt: null, schema: WATCHLIST_SCHEMA });
        State.watchlists = [seed('wl-1', 'Core watchlist', ['AAPL', 'MAYBANK', 'PBBANK', 'NVDA', 'AXREIT', 'TENAGA'].filter(x => BY_ID.has(x))),
                            seed('wl-2', 'Bursa income', ['MAYBANK', 'PBBANK', 'PETGAS', 'KLCC', 'IGBREIT'].filter(x => BY_ID.has(x)))];
        State.wlIdx = 0; saveWatchlists();
        const msft = [...BY_ID.keys()].find(k => /^MSFT/.test(k)) || 'MSFT';
        toggleWatch(msft, 0); await w(40);
        navigate('/app'); await w(120);
        const tile = [...document.querySelectorAll('#views .dash-tile')].find(t => /Instruments watchlisted/.test(t.textContent));
        out.tile = tile ? { v: tile.querySelector('.dash-tile-v')?.textContent, sub: tile.querySelector('.stat-sub')?.textContent, note: tile.querySelector('.dash-tile-note')?.textContent || null } : null;
        const own = myDashOwn();
        out.instruments = own.instruments.size; out.created = own.createdLists.length;
        out.stepDone = myDashSteps(own).find(s => s.k === 'watchlist')?.done;
        /* A list the visitor made, of illustrative companies, edited an hour ago. */
        const illus = U.filter(r => !r.c.real).slice(0, 2).map(r => r.c.id);
        const hourAgo = new Date(Date.now() - 3600e3).toISOString();
        State.watchlists.push({ id: 'wl-fix-own', name: 'Fix own', ids: illus, added: Object.fromEntries(illus.map(x => [x, hourAgo])), createdAt: hourAgo, updatedAt: hourAgo, schema: WATCHLIST_SCHEMA });
        saveWatchlists();
        navigate('/app'); await w(120);
        const row = [...document.querySelectorAll('#views .dash-cont .dash-row')].find(x => /Fix own/.test(x.textContent));
        out.row = row ? { meta: row.querySelector('.dash-row-s')?.textContent || '', chip: row.querySelector('.chip-bronze')?.textContent || null } : null;
        out.local = myDashWhen(Date.parse(hourAgo));
      } finally {
        State.watchlists = JSON.parse(keep.wl); State.wlIdx = keep.idx; saveWatchlists();
        State.recentCompanies = JSON.parse(keep.recent);
        if (keep.visit == null) localStorage.removeItem('vl.dashVisit'); else localStorage.setItem('vl.dashVisit', keep.visit);
      }
      return out;
    })()`);
    const p = [];
    if (r.instruments !== 1) p.push(`one company added to the seeded list counts ${r.instruments} instruments, not 1`);
    if (r.stepDone !== false || r.created !== 0) p.push(`"Create a watchlist" is ${r.stepDone ? 'ticked' : 'not ticked'} with ${r.created} list(s) created`);
    if (r.tile && (r.tile.v !== '1' || /of your own/.test(r.tile.sub || '') || !/Sample companies not counted/.test(r.tile.note || ''))) p.push(`the tile reads ${JSON.stringify(r.tile)}`);
    if (!r.row) p.push("a list of the visitor's own is not in Continue");
    else {
      if (/UTC/.test(r.row.meta) || !r.row.meta.includes(r.local)) p.push(`the Continue row's time is "${r.row.meta}", not the reader's clock ("${r.local}")`);
      if (r.row.chip !== 'illustrative figures') p.push(`a list of illustrative companies wears ${JSON.stringify(r.row.chip)}`);
    }
    if (p.length) fail("release-a fixes: the dashboard counts only what the visitor did, on the reader's clock, with the illustrative chip", p);
    else ok(`release-a fixes: one company added to the seeded list counts as 1 instrument (${r.tile ? r.tile.note : 'no tile'}), "Create a watchlist" stays open, and a list of the visitor's own reads "${r.row.meta}" with its illustrative chip`);
  }
  /* ---- end release-a: fixes ---- */

  /* ---- frames: verify ---- */
  /* H3-D: an alert of a daily setup whose conditions read imported weeks and
     months. "The same bars now" recomputed the setup's own (daily) bars only,
     so after a re-import that changed the week the conditions read it still
     said the bars were as they were. The record now carries each such
     timeframe's version (barVersion) and the page recomputes it. A symbol
     the history holds only imported weeks for says so in "What your history
     holds". Synthetic history, the worker's own scanRun for the record. */
  framesVerify: {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const keep = { h: scanHistoryFile, a: scanAlertsFile, s: scanSetupsFile };
      const out = {};
      try {
        const days = [];
        for (let d = new Date('2026-09-25T00:00:00Z'); days.length < 320; d.setUTCDate(d.getUTCDate() - 1)) if (d.getUTCDay() % 6) days.unshift(d.toISOString().slice(0, 10));
        const series = { XAUUSD: {} }, ohlc = { XAUUSD: {} }, meta = { XAUUSD: {} };
        days.forEach((d, i) => { const c = +(2000 + i * 0.7 + 20 * Math.sin(i / 7)).toFixed(3); series.XAUUSD[d] = c; ohlc.XAUUSD[d] = [c, +(c + 4).toFixed(3), +(c - 4).toFixed(3)]; meta.XAUUSD[d] = { src: 'import:SYN, 1D.csv', at: d + 'T23:00:00Z' }; });
        const frame = (key) => { const f = { series: {}, ohlc: {}, volume: {}, meta: {} }, g = new Map();
          days.forEach(d => { const k = key(d); if (!g.has(k)) g.set(k, []); g.get(k).push(d); });
          for (const [k, ds] of g) { f.series[k] = +(series.XAUUSD[ds[ds.length - 1]] * 1.001).toFixed(3); f.ohlc[k] = [ohlc.XAUUSD[ds[0]][0], Math.max(...ds.map(d => ohlc.XAUUSD[d][1])), Math.min(...ds.map(d => ohlc.XAUUSD[d][2]))]; f.meta[k] = { src: 'import:SYN, x.csv', at: '2026-09-26T12:00:00Z' }; }
          return f; };
        const H = { schema: 2, generated: '2026-09-26T12:00:00Z', series, ohlc, meta, volume: {}, frames: { '1W': { XAUUSD: frame(scanWeekOf) }, '1M': { XAUUSD: frame(scanMonthOf) } } };
        const cond = (tf) => ({ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 1 }, timeframe: tf });
        const setup = scanNormaliseSetup({ id: 'fv-dv', version: 1, name: 'frames verify', enabled: true, universe: { kind: 'symbols', symbols: ['XAUUSD'] }, timeframe: '1D', confirmationMode: 'BAR_CLOSE',
          cooldownMode: 'EVERY_MATCH', cooldownBars: 0, expires: null, ruleTree: { type: 'group', logic: 'ALL', children: [cond('1W'), cond('1M')] } });
        const run = scanRun([setup], H, { now: '2026-09-26T12:00:00Z', instruments: scanRegistryList(), runId: 'fv', origin: 'test' });
        const a = run.alerts[0];
        out.read = a ? a.matchedConditions.map(c => [c.timeframe, c.barDate, c.barOrigin, !!c.barVersion]) : null;
        if (!a) return out;
        scanHistoryFile = H; scanAlertsFile = { alerts: [a] }; scanSetupsFile = { setups: [setup] };
        const fact = (label) => [...document.querySelectorAll('main .scan-fact')].find(f => f.querySelector('.stat-label')?.textContent === label)?.innerText.replace(/\\s+/g, ' ') || '';
        const open = async () => { navigate('/app/scanner/setups'); await w(80); navigate('/app/scanner/alerts/' + a.id); await w(250); };
        await open();
        out.version = fact('Data version'); out.before = fact('The same bars now');
        /* A re-import: the week the conditions read, and nothing else. */
        const wk = scanWeekOf(a.matchedConditions[0].barDate);
        const H2 = JSON.parse(JSON.stringify(H)); H2.frames['1W'].XAUUSD.series[wk] = +(H2.frames['1W'].XAUUSD.series[wk] * 1.01).toFixed(3);
        scanHistoryFile = H2; await open();
        out.after = fact('The same bars now');
        const only = JSON.parse(JSON.stringify(H)); only.frames['1W'].ONLYW = only.frames['1W'].XAUUSD;
        out.onlyHead = scanHistoryNeeds(['ONLYW', 'NOSUCH'], new Map(), only).map(x => x.head);
        return out;
      } finally {
        scanHistoryFile = keep.h; scanAlertsFile = keep.a; scanSetupsFile = keep.s;
        navigate('/learn');
      }
    })()`);
    const p = [];
    if (!r.read || r.read.length !== 2 || !r.read.every(x => x[2] === 'imported' && x[3])) p.push(`the record's reads: ${JSON.stringify(r.read)}`);
    if (!/the weekly bars up to \d{4}-\d{2}-\d{2} its conditions read: fnv1a:[0-9a-f]+; the monthly bars up to \d{4}-\d{2}-\d{2} its conditions read: fnv1a:/.test(r.version || '')) p.push(`Data version: ${r.version}`);
    if (!/^The same bars now unchanged .* — the bars up to \d{4}-\d{2}-\d{2}, and the weekly bars up to \d{4}-\d{2}-\d{2} and the monthly bars up to \d{4}-\d{2}-\d{2} its conditions read, are as they were when this was recorded\.$/.test(r.before || '')) p.push(`before: ${r.before}`);
    if (!/^The same bars now changed .* the bars up to \d{4}-\d{2}-\d{2} are as they were, but the weekly bars up to \d{4}-\d{2}-\d{2} its conditions read are fnv1a:[0-9a-f]+, not fnv1a:[0-9a-f]+: your imported bars have changed since this was recorded/.test(r.after || '')) p.push(`after a re-import: ${r.after}`);
    if (!/^ONLYW — no daily series in your history, only imported weekly bars, which are read beside a daily series and never without one/.test(r.onlyHead?.[0] || '') || !/^NOSUCH — no series in your history/.test(r.onlyHead?.[1] || '')) p.push(`history needs: ${JSON.stringify(r.onlyHead)}`);
    if (p.length) fail('frames verify: an alert whose conditions read imported weeks says whether those weeks are as they were', p);
    else ok('frames verify: an alert of a daily setup whose conditions read imported weeks and months names their versions, says "unchanged" while they are, and "changed" once the week read is re-imported with another close (it said "unchanged", recomputing the daily bars only); a symbol held only as imported weeks says it has no daily series');
  }
  /* ---- end frames: verify ---- */

  /* ---- bugfix: scanner-pages ---- */
  /* TODAY'S SCANNER PAGES, HELD TO WHAT THEY SAY (86-scanner.js,
     87-scanner-ops.js), on synthetic history only:
     1. a record made sessions after its bar — a weekly setup's week
        recorded on the Tuesday after, a replay (--as-of) carrying the wall
        clock, a day the worker caught up on — is evaluated again on the
        history cut at its bar, and reproduces; the cut was judged stale
        against the record's clock and every such record said "Does not
        reproduce". A re-imported week still does not;
     2. "Add your TradingView bot's signals" saved over a setup the
        worker's file held and this browser did not as v1 with other
        conditions, which the worker refuses; it adopts the file's version
        first and saves its own as the next;
     3. what a save says: "No change" when nothing changed (it said "Saved
        2 setups"), and not "none of them records a match until you export"
        when the file already carries them;
     4. a yes-or-no left side replaced by a number's does not leave its 1
        or 0 behind as "price equals 1";
     5. the boundary names imported weekly and monthly bars, not only bars
        derived from the daily ones;
     6. a monthly EMA 200 is more daily bars than the history keeps, and
        the history note says only the monthly export holds that many;
     7. the historical page says whether a weekly setup's bar was imported;
     8. a condition whose timeframe had no bar to read says "no monthly bar
        could be read", not that the record leaves the bar out;
     9. the builder refuses a new setup under an id only the worker's file
        holds, and a copy's id passes over the file's ids — each was a
        second v1 the worker refuses. */
  scannerPages: {
    const r = await evaluate(`(async () => {
      const w = (ms) => new Promise(res => setTimeout(res, ms));
      const main = () => document.querySelector('main');
      const keep = { h: scanHistoryFile, a: scanAlertsFile, s: scanSetupsFile, store: localStorage.getItem('vl.scanSetups'), read: localStorage.getItem('vl.scanAlertState'),
        bot: JSON.stringify(scanBotState), draft: scanDraft, view: scanBacktestState.view };
      const out = {};
      try {
        const reg = scanRegistryList();
        /* Synthetic: gold's weekday sessions to Monday 2026-09-28, captured
           after each close, and its weeks and months as imported frames
           captured on the Tuesday morning — the week of the 28th still in
           progress, so provisional. */
        const days = [];
        for (let d = new Date('2026-09-28T00:00:00Z'); days.length < 320; d.setUTCDate(d.getUTCDate() - 1)) if (d.getUTCDay() % 6) days.unshift(d.toISOString().slice(0, 10));
        const series = { XAUUSD: {} }, ohlc = { XAUUSD: {} }, meta = { XAUUSD: {} };
        days.forEach((d, i) => { const c = +(2000 + i * 0.7 + 20 * Math.sin(i / 7)).toFixed(3); series.XAUUSD[d] = c; ohlc.XAUUSD[d] = [c, +(c + 4).toFixed(3), +(c - 4).toFixed(3)]; meta.XAUUSD[d] = { src: 'import:SYN, 1D.csv', at: d + 'T23:30:00Z' }; });
        const frame = (key) => { const f = { series: {}, ohlc: {}, volume: {}, meta: {} }, g = new Map();
          days.forEach(d => { const k = key(d); if (!g.has(k)) g.set(k, []); g.get(k).push(d); });
          for (const [k, ds] of g) { f.series[k] = +(series.XAUUSD[ds[ds.length - 1]] * 1.001).toFixed(3); f.ohlc[k] = [ohlc.XAUUSD[ds[0]][0], Math.max(...ds.map(d => ohlc.XAUUSD[d][1])), Math.min(...ds.map(d => ohlc.XAUUSD[d][2]))]; f.meta[k] = { src: 'import:SYN, x.csv', at: '2026-09-29T02:00:00Z' }; }
          return f; };
        const H = { schema: 2, generated: '2026-09-29T02:00:00Z', series, ohlc, meta, volume: {}, frames: { '1W': { XAUUSD: frame(scanWeekOf) }, '1M': { XAUUSD: frame(scanMonthOf) } } };
        const cond = (tf, right = { value: 1 }) => ({ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right, ...(tf ? { timeframe: tf } : {}) });
        const mk = (id, timeframe, children) => scanNormaliseSetup({ id, version: 1, name: id, enabled: true, universe: { kind: 'symbols', symbols: ['XAUUSD'] }, timeframe,
          confirmationMode: 'BAR_CLOSE', cooldownMode: 'EVERY_MATCH', cooldownBars: 0, expires: null, ruleTree: { type: 'group', logic: 'ALL', children } });
        const wk = mk('sp-weekly', '1W', [cond()]), dy = mk('sp-daily', '1D', [cond(), cond('1W')]);

        /* 1 — records made sessions after their bar, evaluated again. */
        const now = '2026-09-29T02:00:00Z';
        const recs = {
          weekly: scanRun([wk], H, { now, instruments: reg, runId: 'sp1', origin: 'test' }).alerts[0] || null,
          replay: scanRun([dy], H, { now, asOf: '2026-08-20', instruments: reg, runId: 'sp2', origin: 'replay' }).alerts[0] || null,
          catchUp: scanRun([dy], H, { now, instruments: reg, runId: 'sp3', origin: 'test', pairs: { [scanPairKey(dy.id, dy.version, 'XAUUSD', '1D')]: { lastEvaluatedBar: '2026-09-22' } } }).alerts.find(a => a.candleDate === '2026-09-23') || null,
        };
        out.recs = Object.fromEntries(Object.entries(recs).map(([k, a]) => [k, a ? [a.timeframe, a.candleDate, a.detectedAt] : null]));
        out.reproduce = Object.fromEntries(Object.entries(recs).map(([k, a]) => { const r = a ? scanReproduce(a, { history: H, list: [a] }) : null; return [k, r ? [r.state, r.text] : null]; }));
        /* The control: the week the weekly record read, re-imported with
           another close, still does not reproduce. */
        const H2 = JSON.parse(JSON.stringify(H)); H2.frames['1W'].XAUUSD.series['2026-09-21'] = +(H2.frames['1W'].XAUUSD.series['2026-09-21'] * 1.5).toFixed(3);
        out.control = recs.weekly ? scanReproduce(recs.weekly, { history: H2, list: [recs.weekly] }).state : null;
        scanHistoryFile = H; scanAlertsFile = { alerts: Object.values(recs).filter(Boolean) }; scanSetupsFile = null;
        if (recs.weekly) { navigate('/app/scanner/alerts/' + scanAlertIdOf(recs.weekly)); await w(250); }
        out.verdict = main().querySelector('.scan-reproduce')?.textContent || '';

        /* 2 — the bot's signals saved over a setup the worker's file holds. */
        localStorage.removeItem('vl.scanSetups');
        const filePack = scanBotPack({ symbols: ['XAUUSD'], tradeTimeframes: ['1W'], signals: ['tier2-buy'], cooldownMode: 'EVERY_MATCH' });
        const fileId = filePack[0].id;
        scanSetupsFile = { kind: 'quantum-tradeworks-scan-setups', schema: 2, setups: filePack };
        Object.assign(scanBotState, { open: true, symbols: ['XAUUSD'], tfs: ['1W'], signals: ['tier2-buy', 'entry-buy'], cooldownMode: 'NEW_MATCH', criterion3: 'ema', result: null });
        navigate('/app/scanner/setups'); await w(250);
        const card = () => main().querySelector('details.scan-bot');
        const save = async () => { const b = card().querySelector('button[data-scan-focus="bot-create"]'); b.focus(); b.click(); await w(300);
          return { status: card()?.querySelector('.scan-bot-status')?.textContent || '', toast: [...document.querySelectorAll('.toast')].pop()?.textContent || '', focus: document.activeElement?.dataset?.scanFocus || null }; };
        out.save1 = await save();
        const st = scanStoreRead();
        out.collide = { id: fileId, versions: (st.setups[fileId]?.versions || []).map(v => [v.version, v.source, v.hash === filePack[0].hash]), current: st.setups[fileId]?.current ?? null,
          exported: scanExportDoc().setups.filter(s => s.id === fileId).map(s => [s.version, s.hash === filePack[0].hash]),
          entry: (st.setups['mtfbot-d-entry-buy']?.versions || []).map(v => [v.version, v.source]) };
        out.save2 = await save();
        scanSetupsFile = scanExportDoc();
        navigate('/app/scanner/alerts'); await w(80); navigate('/app/scanner/setups'); await w(250);
        out.save3 = await save();

        /* 3 — a yes-or-no left side replaced by a number's. */
        scanDraft = null;
        navigate('/app/scanner/setups/new'); await w(250);
        const pick = async (l, v) => { const s = main().querySelector('select[aria-label="' + l + '"]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); await w(80); };
        await pick('Condition 1: left side', 'wavetrend.bull');
        out.flagIn = JSON.stringify(scanDraft.ruleTree.children[0].right);
        await pick('Condition 1: left side', 'price');
        out.flagOut = { right: JSON.stringify(scanDraft.ruleTree.children[0].right), prose: main().querySelector('.scan-cond .scan-prose')?.textContent || '',
          value: main().querySelector('input[aria-label="Condition 1: right side value"]')?.value ?? null, focus: document.activeElement?.getAttribute('aria-label') || null };
        await pick('Condition 1: left side', 'wavetrend.bull');
        await pick('Condition 1: right side value', '0');
        await pick('Condition 1: left side', 'cm_macd.above');
        out.flagToFlag = JSON.stringify(scanDraft.ruleTree.children[0].right);
        scanDraft = null;

        /* 4 — the boundary names the imported weeks and months. */
        navigate('/app/scanner/setups'); await w(200);
        out.boundary = [...main().querySelectorAll('details.scan-boundary li')].map(li => li.textContent).find(t => /^Daily bars/.test(t)) || '';

        /* 5 — what a monthly EMA200 needs, against what the history keeps. */
        const ema = (tf) => ({ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { indicator: 'ema', n: 200 }, timeframe: tf });
        const needM = scanNeedsOf([mk('sp-needs', '1D', [ema('1W'), ema('1M')])]);
        out.needs = scanHistoryNeeds(['XAUUSD'], needM, { schema: 2, series, ohlc, meta, volume: {} })[0].lines.map(l => l.text);

        /* 6 — the historical page names a weekly bar's origin. */
        const hist = scanHistorical(wk, H, { symbols: ['XAUUSD'], maxBars: 600, instruments: reg });
        scanBacktestState.view = 'every';
        const box = scanBacktestResult({ setup: wk, from: null, to: null, out: scanBacktestMerge([hist], wk) });
        out.histOrigin = [...new Set(hist.matches.map(m => m.barOrigin || null))];
        out.histRows = [...box.querySelectorAll('details.scan-row-det > summary')].slice(-2).map(s => s.textContent);
        const histD = scanHistorical(dy, H, { symbols: ['XAUUSD'], maxBars: 600, instruments: reg });
        const boxD = scanBacktestResult({ setup: dy, from: null, to: null, out: scanBacktestMerge([histD], dy) });
        out.histRowsDaily = [...boxD.querySelectorAll('details.scan-row-det > summary')].slice(-1).map(s => s.textContent);

        /* 7 — a record whose monthly condition read no bar: no month had
           closed in a history that begins in September. */
        const cut = (m) => Object.fromEntries(Object.entries(m).filter(([d]) => d >= '2026-09-14'));
        const Hs = { schema: 2, generated: now, series: { XAUUSD: cut(series.XAUUSD) }, ohlc: { XAUUSD: cut(ohlc.XAUUSD) }, meta: { XAUUSD: cut(meta.XAUUSD) }, volume: {} };
        const anyM = scanNormaliseSetup({ ...mk('sp-any', '1D', [cond(), cond('1M')]), ruleTree: { type: 'group', logic: 'ANY', children: [cond(), cond('1M')] } });
        const recM = scanRun([anyM], Hs, { now, instruments: reg, runId: 'sp4', origin: 'test' }).alerts[0] || null;
        out.unread = recM ? recM.matchedConditions.map(c => [c.path, c.state, c.timeframe || null, c.barDate ?? null]) : null;
        if (recM) {
          scanHistoryFile = Hs; scanAlertsFile = { alerts: [recM] }; scanSetupsFile = { kind: 'quantum-tradeworks-scan-setups', schema: 2, setups: [anyM] };
          navigate('/app/scanner/alerts/' + scanAlertIdOf(recM)); await w(250);
          const t = [...main().querySelectorAll('table.dt')].find(x => /Conditions evaluated/.test(x.querySelector('caption')?.textContent || ''));
          const ri = [...t.querySelectorAll('thead th')].map(h => h.textContent).indexOf('Read on');
          out.unreadCells = [...t.querySelectorAll('tbody tr')].map(tr => tr.children[ri].innerText.replace(/\\s+/g, ' '));
          navigate('/app/scanner/setups/' + anyM.id); await w(250);
          out.unreadMini = main().querySelector('.scan-alert-mini')?.textContent || '';
        }

        /* 9 — a new setup under an id only the worker's file holds. */
        localStorage.removeItem('vl.scanSetups');
        scanSetupsFile = { kind: 'quantum-tradeworks-scan-setups', schema: 2, setups: [wk] };
        const draft = { ...scanAsDraft(dy), id: wk.id, name: 'Another' };
        out.fileId = scanDraftCheck(draft, { mode: 'new' }).problems.filter(p => p.path === 'id').map(p => p.code);
        out.copyId = scanCopyId('sp');
        scanSetupsFile = { kind: 'quantum-tradeworks-scan-setups', schema: 2, setups: [wk, { ...wk, id: 'sp-copy' }] };
        out.copyIdTaken = scanCopyId('sp');
        return out;
      } finally {
        scanHistoryFile = keep.h; scanAlertsFile = keep.a; scanSetupsFile = keep.s; scanDraft = keep.draft; scanBacktestState.view = keep.view;
        if (keep.store == null) localStorage.removeItem('vl.scanSetups'); else localStorage.setItem('vl.scanSetups', keep.store);
        if (keep.read == null) localStorage.removeItem('vl.scanAlertState'); else localStorage.setItem('vl.scanAlertState', keep.read);
        Object.assign(scanBotState, JSON.parse(keep.bot));
        navigate('/learn');
      }
    })()`);
    if (!r || !r.recs) { fail('scanner pages: the block ran', r); break scannerPages; }

    const p1 = [];
    Object.entries(r.recs).forEach(([k, v]) => { if (!v) p1.push(`no ${k} record was made`); });
    Object.entries(r.reproduce).forEach(([k, v]) => { if (v && v[0] !== 'REPRODUCES') p1.push(`${k}: ${v[1]}`); });
    if (r.control !== 'DIFFERS') p1.push(`the weekly record, its week re-imported with another close, reads ${r.control}`);
    if (!/^Reproduces\./.test(r.verdict)) p1.push(`the alert page says: ${r.verdict}`);
    if (p1.length) fail('scanner pages: a record made sessions after its bar is evaluated again as the run read it', p1);
    else ok('scanner pages: a weekly setup\'s week recorded on the Tuesday after, a replayed day and a caught-up day each reproduce on the history cut at the bar (each said "Does not reproduce": the cut was judged stale against the record\'s clock), and a re-imported week still does not');

    const p2 = [];
    if (JSON.stringify(r.collide.versions) !== JSON.stringify([[1, 'file', true], [2, 'bot', false]]) || r.collide.current !== 2) p2.push(`${r.collide.id} holds ${JSON.stringify(r.collide.versions)}, current v${r.collide.current} — the file's v1 adopted first, the card's as v2`);
    if (JSON.stringify(r.collide.exported) !== JSON.stringify([[2, false]])) p2.push(`the export carries ${JSON.stringify(r.collide.exported)} for it — a v1 the worker already holds with other conditions is refused`);
    if (JSON.stringify(r.collide.entry) !== JSON.stringify([[1, 'bot']])) p2.push(`a setup the file does not hold: ${JSON.stringify(r.collide.entry)}`);
    if (!/adopted from it first/.test(r.save1.status) || r.save1.focus !== 'bot-create') p2.push(`after saving: "${r.save1.status}", focus ${r.save1.focus}`);
    if (p2.length) fail('scanner pages: the bot\'s signals saved over a setup the worker\'s file holds follow the file\'s version', p2);
    else ok('scanner pages: the bot\'s signals saved over a setup the worker\'s file holds at v1 adopt that v1 first and save as v2 — the export no longer carries a second v1 the worker refuses — and say so; one the file does not hold is v1');

    const p3 = [];
    if (!/^Saved 2 setups in this browser at /.test(r.save1.status) || !r.save1.status.includes('until you export scan-setups.json above') || !/^Saved 2 setups in this browser — export/.test(r.save1.toast)) p3.push(`a save that changed them: "${r.save1.status}" / "${r.save1.toast}"`);
    if (!/^No change at /.test(r.save2.status) || /^Saved/.test(r.save2.toast) || !/^No change/.test(r.save2.toast)) p3.push(`a save that changed nothing: "${r.save2.status}" / "${r.save2.toast}"`);
    if (!/data\/scan-setups\.json already carries each of them as saved here/.test(r.save3.status) || /none of them records a match/.test(r.save3.status)) p3.push(`saved as the file carries them: "${r.save3.status}"`);
    if (p3.length) fail('scanner pages: the bot card says what its save did', p3);
    else ok('scanner pages: the bot card says "No change" of a save that changed nothing (it said "Saved 2 setups"), and that the worker\'s file already carries them where it does (it said none records a match until exported)');

    const p4 = [];
    if (r.flagIn !== '{"value":1}') p4.push(`a yes-or-no left side's right side: ${r.flagIn}`);
    if (r.flagOut.right !== '{"value":null}' || r.flagOut.prose !== 'price equals ?' || r.flagOut.value !== '') p4.push(`replaced by price: ${JSON.stringify(r.flagOut)}`);
    if (r.flagToFlag !== '{"value":0}') p4.push(`one yes-or-no reading replaced by another kept ${r.flagToFlag}, not false (0)`);
    if (p4.length) fail('scanner pages: a yes-or-no left side replaced by a number\'s leaves no true or false behind as a number', p4);
    else ok('scanner pages: a yes-or-no left side replaced by price leaves the right side blank ("price equals ?", refused until a number is typed) rather than "price equals 1"; replaced by another yes-or-no reading it keeps false');

    const p5 = [];
    if (!/your imported TradingView weekly and monthly bars where your history holds them/.test(r.boundary) || /monthly bars derived from them;/.test(r.boundary)) p5.push(r.boundary);
    const wkLine = r.needs.find(l => /^Weekly/.test(l)) || '', moLine = r.needs.find(l => /^Monthly/.test(l)) || '';
    if (!/EMA200, which needs 200 monthly bars \(about 17 years of daily bars — more than the 2,000 daily bars your history keeps, so only your imported TradingView monthly bars can hold that many\)/.test(moLine)) p5.push(`monthly: ${moLine}`);
    if (!/EMA200, which needs 200 weekly bars \(about 1,000 daily bars\)\./.test(wkLine)) p5.push(`weekly: ${wkLine}`);
    if (!r.histOrigin.includes('imported') || !r.histRows.length || !r.histRows.every(t => / · imported$/.test(t)) || r.histRowsDaily.some(t => /imported|built from/.test(t))) p5.push(`historical rows: ${JSON.stringify(r.histRows)} / daily ${JSON.stringify(r.histRowsDaily)}`);
    if (p5.length) fail('scanner pages: weekly and monthly bars are named as imported where they are, and a monthly EMA200 as more than the history keeps', p5);
    else ok('scanner pages: the boundary names your imported weekly and monthly bars, a monthly EMA200 says it is more daily bars than the 2,000 the history keeps (a weekly one does not), and the historical page marks a weekly setup\'s imported bars');

    const p6 = [];
    if (!r.unread || r.unread[1]?.[2] !== '1M' || r.unread[1]?.[3] !== null) p6.push(`the record: ${JSON.stringify(r.unread)}`);
    if (r.unreadCells?.[1] !== 'Monthly no bar could be read — see its status') p6.push(`Read on: ${JSON.stringify(r.unreadCells)}`);
    if (!/no monthly bar could be read$/.test(r.unreadMini || '') || /does not say which/.test(r.unreadMini || '')) p6.push(`the setup's matches: ${r.unreadMini}`);
    if (p6.length) fail('scanner pages: a condition whose timeframe had no bar to read says so', p6);
    else ok('scanner pages: a monthly condition with no month closed reads "no bar could be read" in Read on and "no monthly bar could be read" in the setup\'s matches — not "bar not dated on the record"');

    const p7 = [];
    if (JSON.stringify(r.fileId) !== '["FILE_ID"]') p7.push(`a new setup under an id only the worker's file holds: ${JSON.stringify(r.fileId)} — saved, it is a second v1 the worker refuses`);
    if (r.copyId !== 'sp-copy' || r.copyIdTaken !== 'sp-copy-2') p7.push(`a copy's id: ${r.copyId}, and with sp-copy in the file ${r.copyIdTaken}`);
    if (p7.length) fail('scanner pages: the builder does not reuse an id the worker\'s file holds', p7);
    else ok('scanner pages: the builder refuses a new setup under an id only the worker\'s file holds (FILE_ID — adopt it, or choose another), and a copy\'s id passes over the file\'s ids as over this browser\'s');
  }
  /* ---- end bugfix: scanner-pages ---- */
  /* ---- bugfix: held across a gap ---- */
  /* What the history holds for a setup is judged as the evaluator reads it: a
     reading never spans a gap, so imported weeks to December and daily bars
     from March leave only the weeks since March readable. The setup page and
     the bot card counted every closed week (395) against a need of 200 and
     said every condition could be read; every weekly reading was untested. */
  {
    const r = await evaluate(`(() => {
      const add = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
      const H = { schema: 2, series: { GAPX: {} }, ohlc: { GAPX: {} }, volume: { GAPX: {} }, meta: { GAPX: {} },
        frames: { '1W': { GAPX: { series: {}, ohlc: {}, volume: {}, meta: {} } } } };
      const F = H.frames['1W'].GAPX;
      let px = 100, k = 0;
      for (let d = '2019-01-07'; d <= '2025-12-29'; d = add(d, 7)) { px += Math.sin(k++); F.series[d] = px; F.ohlc[d] = [px - 1, px + 2, px - 2]; F.meta[d] = { src: 'import:test', at: '2026-09-28T21:00:00Z' }; }
      for (let d = '2026-03-02'; d <= '2026-09-25'; d = add(d, 1)) { const wd = new Date(d + 'T00:00:00Z').getUTCDay(); if (wd === 0 || wd === 6) continue; px += 0.3;
        H.series.GAPX[d] = px; H.ohlc.GAPX[d] = [px - 0.5, px + 1, px - 1]; H.meta.GAPX[d] = { src: 'test', at: add(d, 1) + 'T12:00:00Z' }; }
      const byTf = new Map([['1W', new Map([['ema200', { label: 'EMA(200)', needs: 200, ohlc: false }], ['ema20', { label: 'EMA(20)', needs: 20, ohlc: false }]])]]);
      const held = scanHeldOf('GAPX', H), line = scanHistoryNeeds(['GAPX'], byTf, H)[0].lines[0];
      return { weeks: held.weeks, run: held.runs?.["1W"], known: line.known, text: line.text };
    })()`);
    const p = [];
    if (!r || r.weeks < 300 || r.run?.run !== 30 || r.run?.gapFrom !== '2026-03-06') p.push(`held ${JSON.stringify(r)}`);
    if (r?.known !== false || !/Unknown: EMA\(200\)/.test(r?.text || '') || /EMA\(20\),/.test(r?.text || '') || !/a gap, and your history has one before 2026-03-06, so 30 closed weeks since it can be read/.test(r?.text || '')) p.push(`the line: ${r?.text}`);
    if (p.length) fail('scanner pages: what the history holds is judged since its last gap, as a reading is', p);
    else ok(`scanner pages: 395 closed weeks with a gap before 2026-03-06 leave 30 readable — EMA(200) is named unknown and EMA(20) readable, and the line says where the gap is: "${r.text.slice(0, 140)}…"`);
  }
  /* ---- end bugfix: held across a gap ---- */
  /* ---- bugfix: render-focus ---- */
  /* R1–R5 — render() gives the control in use back when it redraws the page
          on screen (35-ui.js). It replaced the view, the product tabs, the
          dock and the sidebar's alert count under the reader, and focus fell
          to <body> whenever a redraw nobody asked for landed — the filings
          arriving a moment after a page opened, the OS switching to dark —
          and a field redrawn a tick after Tab came back with the caret
          before its figure, so typing went in front of it. The Cash Wheel
          dock's action took itself away and left focus on <body>. The
          filings are HELD here (the Fetch domain) until the control is in
          use, so the redraw lands under it on every run. */
  {
    let holdRe = null;
    const held = [];
    const onPause = (e) => {
      const m = JSON.parse(e.data);
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
      if (holdRe && holdRe.test(m.params.request.url)) held.push(m.params.requestId);
      else send('Fetch.continueRequest', { requestId: m.params.requestId }, sessionId);
    };
    ws.addEventListener('message', onPause);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Network.enable', {}, sessionId);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/us.json*' }, { urlPattern: '*/data/sarawak-geo.json*' }] }, sessionId);
    const key = async (k, code, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code }, sessionId);
    };
    const typeIn = async (t) => { for (const ch of t) { await key(ch, ch.toUpperCase().charCodeAt(0), ch); await sleep(20); } };
    const until = async (expr, what) => {
      for (const t = Date.now(); Date.now() - t < 30000; await sleep(50)) { try { if (await evaluate(expr)) return; } catch { /* booting */ } }
      throw new Error(`${what} — not seen in 30s`);
    };
    /* Opens `path`. With `hold`, what it matches is held back, and this
       returns once `ready` holds on the page drawn without it. */
    const open = async (path, hold, ready) => {
      holdRe = hold;
      await evaluate('window.__rfLeaving = true');
      await send('Page.navigate', { url: `${BASE}${path}` }, sessionId);
      await until(`!window.__rfLeaving && ${hold ? 'realPending === true' : 'propertyPagesSettled()'} && (${ready})`,
        `${path} drawn${hold ? ' with its data held' : ''}`);
    };
    const release = async (path) => {
      holdRe = null;
      while (held.length) await send('Fetch.continueRequest', { requestId: held.shift() }, sessionId);
      await until('propertyPagesSettled()', `${path} redrawn with its data`);
      await sleep(300);
    };
    /* The control in focus: which it is, what it holds, where its caret is,
       and whether every disclosure round it is open. */
    const said = (x) => x.at === 'BODY' ? 'BODY' : `${x.at} reading ${JSON.stringify(x.value)}${x.caret ? `, caret ${JSON.stringify(x.caret)}` : ''}${x.open ? '' : ' in a closed disclosure'}`;
    const at = async () => JSON.parse(await evaluate(`JSON.stringify((() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { at: 'BODY' };
      let caret = null;
      try { if (typeof a.selectionStart === 'number') caret = [a.selectionStart, a.selectionEnd]; } catch { /* a number field */ }
      return { at: a.id || a.getAttribute('href') || a.tagName + ':' + a.textContent.trim().slice(0, 32), value: a.value ?? null, caret,
        open: [...document.querySelectorAll('details')].filter(d => d.contains(a)).every(d => d.open) };
    })())`));
    const kept = { landing: [], pressed: [], os: [], tab: [] };
    const lost = { landing: [], pressed: [], os: [], tab: [] };
    const saved = {};
    /* How many cases each group holds, so one that stopped part-way fails
       rather than passing on the cases it reached. */
    const cases = { landing: 4, pressed: 1, os: 3, tab: 2 };
    let broke = null;
    try {
      /* R1 — "Record a property": a name being typed, the caret inside it,
         and a city and a price given before it. */
      await open('/property/opportunities', /us\.json/, `!!document.getElementById('opp-new-name')`);
      saved.opportunities = await evaluate(`localStorage.getItem('vl.opportunities')`);
      await evaluate(`(() => { const s = document.getElementById('opp-new-city'); s.value = 'sibu'; s.dispatchEvent(new Event('change', { bubbles: true }));
        document.getElementById('opp-new-askingPrice').focus(); return true; })()`);
      await typeIn('450000');
      await evaluate(`document.getElementById('opp-new-name').focus()`);
      await typeIn('Lot 7'); await key('ArrowLeft', 37); await key('ArrowLeft', 37);
      await release('/property/opportunities');
      const name = await at();
      const form = JSON.parse(await evaluate(`JSON.stringify({ city: document.getElementById('opp-new-city')?.value, price: document.getElementById('opp-new-askingPrice')?.value })`));
      await typeIn('X');
      const typed = await evaluate(`document.getElementById('opp-new-name')?.value`);
      const added = JSON.parse(await evaluate(`(() => { const n = State.opportunities.length; document.getElementById('opp-add').click();
        const o = State.opportunities[0]; return JSON.stringify(State.opportunities.length > n ? { name: o.name, city: o.deal.city, price: o.deal.price } : null); })()`));
      await evaluate(`(() => { const v = ${JSON.stringify(saved.opportunities)}; if (v == null) localStorage.removeItem('vl.opportunities'); else localStorage.setItem('vl.opportunities', v);
        State.opportunities = store.read('opportunities', []); return true; })()`);
      const r1 = `the name with "Lot 7" typed and the caret after "Lot" → ${said(name)}; then X → ${JSON.stringify(typed)}; the city ${form.city}, the price ${JSON.stringify(form.price)}; Add recorded ${JSON.stringify(added)}`;
      (name.at === 'opp-new-name' && name.value === 'Lot 7' && JSON.stringify(name.caret) === '[3,3]' && typed === 'LotX 7'
        && form.city === 'sibu' && form.price === '450000' && added?.name === 'LotX 7' && added.city === 'sibu' && added.price === 450000
        ? kept : lost).landing.push(r1);

      /* R2 — an Equities or Property tab, and the sidebar's scanner-alert
         count (the one sidebar link render() draws afresh; a stand-in count,
         since this build ships no alerts file). */
      await open('/property/areas', /us\.json|sarawak-geo\.json/, `document.querySelectorAll('#productTabs a.ptab').length > 1`);
      const tab = await evaluate(`(() => { const a = document.querySelectorAll('#productTabs a.ptab')[1]; a.focus(); return a.getAttribute('href'); })()`);
      await release('/property/areas');
      const onTab = await at();
      (onTab.at === tab ? kept : lost).landing.push(`the product tab ${tab} → ${onTab.at}`);
      await open('/property/areas', /us\.json|sarawak-geo\.json/, `!!document.querySelector('#appnav a.sb-link')`);
      const count = await evaluate(`(() => { scanUnreadCount = () => 3; render(); const a = document.querySelector('#appnav .sb-count'); a?.focus();
        return a && document.activeElement === a ? a.getAttribute('href') : null; })()`);
      await release('/property/areas');
      const onCount = await at();
      (count && onCount.at === count ? kept : lost).landing.push(`the sidebar's alert count ${count} → ${onCount.at}`);

      /* R3 — the dock's action, on a Cash Wheel with no contract entered;
         then pressed, when it goes from the dock with the empty card. */
      saved.wheel = await evaluate(`localStorage.getItem('vl.wheelPlan')`);
      await evaluate(`localStorage.removeItem('vl.wheelPlan')`);
      const dockAction = `[...document.querySelectorAll('.dock button')].find(b => b.textContent.trim() === 'Load a worked contract')`;
      await open('/us-options/wheel', /us\.json/, `!!${dockAction}`);
      await evaluate(`${dockAction}.focus()`);
      await release('/us-options/wheel');
      const onDock = await at();
      (onDock.at === 'BUTTON:Load a worked contract' ? kept : lost).landing.push(`the dock's "Load a worked contract" → ${onDock.at}`);
      await evaluate(`${dockAction}?.focus()`);
      await key('Enter', 13, '\r'); await sleep(300);
      const pressed = await at();
      /* The next page is a fresh load, which reads the plan back from storage. */
      await evaluate(`(() => { const v = ${JSON.stringify(saved.wheel)}; if (v == null) localStorage.removeItem('vl.wheelPlan'); else localStorage.setItem('vl.wheelPlan', v); return true; })()`);
      (pressed.at === 'wheel-clear-example' ? kept : lost).pressed.push(`the dock's "Load a worked contract", pressed → ${pressed.at}`);

      /* R4 — the screener's slider, and a figure being typed into an
         advanced filter — two disclosures deep, both opened by the reader —
         across the OS switching theme (no theme chosen, so the page redraws
         to follow it). */
      saved.theme = await evaluate(`localStorage.getItem('vl.theme')`);
      await evaluate(`localStorage.removeItem('vl.theme')`);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
      await open('/discover/screener', null, `!!document.getElementById('covRange')`);
      saved.screen = await evaluate(`JSON.stringify(State.screen)`);
      await evaluate(`(() => { State.screen.crit = {}; State.screen.minCoverage = 50; State.appliedTemplate = null; render();
        const n = document.getElementById('covRange'); n.scrollIntoView({ block: 'center' }); n.focus(); return true; })()`);
      await key('ArrowRight', 39); await sleep(200);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
      await sleep(400);
      const onSlider = await at();
      (onSlider.at === 'covRange' ? kept : lost).os.push(`the completeness slider → ${onSlider.at}`);
      const adv = await evaluate(`(() => { const d = [...document.querySelectorAll('main details')].find(x => /Advanced filters/.test(x.querySelector('summary')?.textContent || ''));
        const f = d.querySelector('input'); for (let x = f.closest('details'); x; x = x.parentElement.closest('details')) x.open = true;
        f.scrollIntoView({ block: 'center' }); f.focus(); return document.activeElement === f ? f.id : null; })()`);
      await typeIn('7');
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);
      await sleep(400);
      const onAdv = await at();
      await typeIn('5');
      const advTyped = await evaluate(`document.getElementById(${JSON.stringify(adv)})?.value`);
      (adv && onAdv.at === adv && onAdv.value === '7' && onAdv.open && advTyped === '75' ? kept : lost).os
        .push(`the advanced filter ${adv} with 7 typed → ${said(onAdv)}, then 5 → ${JSON.stringify(advTyped)}`);

      /* R5 — Tab to a field holding a figure, then type: the figure Tab
         selected is replaced. On the screener a maximum of 30, and on
         /compare a Bursa withholding of 0. */
      await evaluate(`(() => { document.activeElement?.blur(); State.screen.crit = { roic: { min: null, max: 30 } }; render();
        const n = document.getElementById('crit-roic-min'); n.scrollIntoView({ block: 'center' }); n.focus(); return true; })()`);
      await typeIn('5'); await key('Tab', 9); await sleep(300);
      await typeIn('40'); await key('Tab', 9); await sleep(300);
      const crit = await evaluate(`JSON.stringify(State.screen.crit.roic)`);
      (crit === '{"min":5,"max":40}' ? kept : lost).tab.push(`the screener's ROIC: 5, Tab, 40 over a maximum of 30 → ${crit}`);
      await evaluate(`(() => { document.activeElement?.blur(); State.screen = JSON.parse(${JSON.stringify(saved.screen)}); return true; })()`);
      saved.cmp = await evaluate(`JSON.stringify({ compare: State.compare, wht: State.wht })`);
      await evaluate(`(async () => { State.compare = U.filter(r => r.c.real).slice(0, 2).map(r => r.c.id); State.wht = { US: 15, MY: 0 };
        navigate('/compare'); await new Promise(r => setTimeout(r, 400));
        const n = document.getElementById('wht-US'); n.scrollIntoView({ block: 'center' }); n.focus(); n.select(); return true; })()`);
      await typeIn('10'); await key('Tab', 9); await sleep(300);
      await typeIn('7'); await key('Tab', 9); await sleep(300);
      const wht = await evaluate(`JSON.stringify(State.wht)`);
      (wht === '{"US":10,"MY":7}' ? kept : lost).tab.push(`/compare's withholding: 10, Tab, 7 over a Bursa rate of 0 → ${wht}`);
      await evaluate(`(() => { document.activeElement?.blur(); const k = JSON.parse(${JSON.stringify(saved.cmp)}); State.compare = k.compare; saveCompare();
        State.wht = k.wht; store.write('wht', k.wht); return true; })()`);

      /* R4, again — a Scanner section tab, drawn inside the page, across
         the OS switching theme back to dark. */
      await evaluate(`(async () => { navigate('/app/scanner'); await new Promise(r => setTimeout(r, 400)); return true; })()`);
      const sTab = await evaluate(`(() => { const a = document.querySelectorAll('#views .scan-subnav a.ptab')[1]; if (!a) return null;
        a.focus(); return document.activeElement === a ? a.getAttribute('href') : null; })()`);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, sessionId);
      await sleep(400);
      const onSTab = await at();
      (sTab && onSTab.at === sTab ? kept : lost).os.push(`the Scanner's section tab ${sTab} → ${onSTab.at}`);
    } catch (err) {
      broke = `the checks stopped: ${String(err.message).split('\n')[0]}`;
    } finally {
      holdRe = null;
      while (held.length) await send('Fetch.continueRequest', { requestId: held.shift() }, sessionId);
      await send('Fetch.disable', {}, sessionId);
      await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
      await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
      if (saved.theme != null) await evaluate(`localStorage.setItem('vl.theme', ${JSON.stringify(saved.theme)}); true`).catch(() => {});
      ws.removeEventListener('message', onPause);
    }
    const short = (g) => lost[g].length > 0 || kept[g].length < cases[g];
    const why = (g) => [...lost[g], ...(kept[g].length + lost[g].length < cases[g] ? [broke || 'not every case ran'] : [])];
    if (short('landing')) fail('render-focus: the filings landing take the control in use from the reader', why('landing'));
    else ok(`render-focus: the control in use keeps focus, what was typed and its caret when the filings land — ${kept.landing.length} cases: a name mid-typing with a city and a price beside it, a product tab, the sidebar's alert count, the dock's action`);
    if (short('pressed')) fail('render-focus: the dock\'s action drops focus on <body> when it takes itself away', why('pressed'));
    else ok('render-focus: the Cash Wheel dock\'s "Load a worked contract" hands focus to the banner\'s control that undoes the load, as the page\'s own button does');
    if (short('os')) fail('render-focus: the OS switching theme takes the control in use from the reader', why('os'));
    else ok('render-focus: the screener\'s slider, a figure being typed into an advanced filter two disclosures deep, and a Scanner section tab keep focus when the OS switches theme');
    if (short('tab')) fail('render-focus: typing after Tab goes in front of the next field\'s figure', why('tab'));
    else ok('render-focus: Tab then typing replaces the next field\'s figure — the screener\'s ROIC maximum (30 → 40) and /compare\'s Bursa withholding (0 → 7)');
  }
  /* ---- end bugfix: render-focus ---- */

  /* ---- bugfix: render-focus-verify ---- */
  /* V1–V12 — what render()'s restore still got wrong (35-ui.js), found by
          keyboard walks of every route at 1440 and 390: with a redraw of
          the page on screen at every stop, and with the data held back and
          released under a spread of each page's stops. A chart given focus
          back was drawn again a frame later and focus fell to <body>; a
          control below a chart or under the company page's sticky strip
          rose by that height at every redraw, until it left the screen; a
          heading focus had been sent to lost it; a card's "Delete" pressed
          handed focus to the next card's; a scanner field went to <body>;
          a figure in a table swiped sideways, and a tab in a strip
          scrolled along to, came back out of sight; typing kept
          through one redraw went with the next; a field dropped down the
          screen when more was drawn above it; a table's scroller lost focus
          when the filings changed its figures; /decision-record read "That
          page does not exist" until the filings landed; and every redraw
          played the page's entrance again. Each is driven through a real
          redraw: the OS switching theme (no theme chosen, so the page
          redraws to follow it), the filings landing (held back through the
          Fetch domain), or the key that asked for it. */
  {
    let holdRe = null;
    const held = [];
    const onPause = (e) => {
      const m = JSON.parse(e.data);
      if (m.method !== 'Fetch.requestPaused' || m.sessionId !== sessionId) return;
      if (holdRe && holdRe.test(m.params.request.url)) held.push(m.params.requestId);
      else send('Fetch.continueRequest', { requestId: m.params.requestId }, sessionId);
    };
    ws.addEventListener('message', onPause);
    const view = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 1000 }, sessionId);
    await send('Network.enable', {}, sessionId);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern: '*/data/us.json*' }, { urlPattern: '*/data/sarawak-geo.json*' }] }, sessionId);
    const key = async (k, code, text) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}) }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code }, sessionId);
    };
    const typeIn = async (t) => { for (const ch of t) { await key(ch, ch.toUpperCase().charCodeAt(0), ch); await sleep(20); } };
    const until = async (expr, what) => {
      for (const t = Date.now(); Date.now() - t < 30000; await sleep(50)) { try { if (await evaluate(expr)) return; } catch { /* booting */ } }
      throw new Error(`${what} — not seen in 30s`);
    };
    const open = async (path, hold, ready) => {
      holdRe = hold;
      await evaluate('window.__rvLeaving = true');
      await send('Page.navigate', { url: `${BASE}${path}` }, sessionId);
      await until(`!window.__rvLeaving && ${hold ? 'realPending === true' : 'propertyPagesSettled()'} && (${ready})`,
        `${path} drawn${hold ? ' with its data held' : ''}`);
      await sleep(300);
    };
    const release = async (path) => {
      holdRe = null;
      while (held.length) await send('Fetch.continueRequest', { requestId: held.shift() }, sessionId);
      await until('propertyPagesSettled()', `${path} redrawn with its data`);
      await sleep(300);
    };
    let scheme = 'light';
    const flip = async () => {
      scheme = scheme === 'light' ? 'dark' : 'light';
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
      await sleep(400);
    };
    /* The control in focus: which, what it holds, its caret, where it sits
       on screen, and the box round it that hides it, if one does. */
    const at = async () => JSON.parse(await evaluate(`JSON.stringify((() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { at: 'BODY' };
      let caret = null;
      try { if (typeof a.selectionStart === 'number') caret = [a.selectionStart, a.selectionEnd]; } catch { /* a number field */ }
      const r = a.getBoundingClientRect();
      let hidden = null;
      for (let p = a.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p); if (!/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) continue;
        const q = p.getBoundingClientRect();
        if (r.right <= q.left + 1 || r.left >= q.right - 1) { hidden = p.className || p.tagName; break; }
      }
      /* A cell under the table's pinned first column is hidden by it. */
      const pin = a.closest('tr')?.querySelector('.pin, th[scope=row], td:first-child');
      if (!hidden && pin && pin !== a && getComputedStyle(pin).position === 'sticky' && r.left < pin.getBoundingClientRect().right - 2) hidden = 'the pinned column';
      return { at: a.id || (a.tagName === 'A' ? a.getAttribute('href') : a.tagName + ':' + (a.getAttribute('aria-label') || a.textContent).trim().slice(0, 48)),
        value: /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) ? a.value : null, caret, top: Math.round(r.top), y: Math.round(scrollY), hidden };
    })())`));
    const said = (x) => x.at === 'BODY' ? 'BODY' : `${x.at}${x.value != null ? ` reading ${JSON.stringify(x.value)}` : ''}${x.caret ? `, caret ${JSON.stringify(x.caret)}` : ''}, ${x.top}px down${x.hidden ? `, hidden by ${x.hidden}` : ''}`;
    const kept = [], lost = [];
    const saved = {};
    const CASES = 14;
    let broke = null;
    try {
      saved.theme = await evaluate(`localStorage.getItem('vl.theme')`);
      saved.watchlists = await evaluate(`localStorage.getItem('vl.watchlists')`);
      await evaluate(`localStorage.removeItem('vl.theme')`);
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);

      /* V1 — a chart given focus back is not drawn again under it: the
         value map's, across the OS switching theme. */
      await view(1440, 900);
      await open('/discover/value-map', null, `!!document.querySelector('#main svg.chart-focusable')`);
      const chart = await evaluate(`(() => { const s = document.querySelector('#main svg.chart-focusable'); s.scrollIntoView({ block: 'center' }); s.focus(); return document.activeElement === s ? 'SVG:' + s.getAttribute('aria-label').slice(0, 48) : null; })()`);
      await flip();
      const onChart = await at();
      (chart && onChart.at.toUpperCase() === chart.toUpperCase() ? kept : lost).push(`the value map's chart → ${said(onChart)}`);

      /* V2 — nothing below a chart, or under the company page's sticky
         strip, moves when the page redraws: three OS theme switches with
         focus on a control there — under the strip at 1440, below the
         price line at 390, and below the valuation tab's charts, which are
         drawn in microtasks after the page. */
      for (const [w, h, path, tag, words] of [[1440, 900, '/company/maybank', 'button', 'Price / book'], [390, 844, '/company/maybank', 'button', 'Open full comparison'],
        [1440, 900, '/company/maybank?tab=valuation', 'summary', 'Show the table view']]) {
        const find = `[...document.querySelectorAll('#main ${tag}')].find(b => b.textContent.trim().startsWith(${JSON.stringify(words)}))`;
        await view(w, h);
        await open(path, null, `!!${find}`);
        await evaluate(`(() => { const b = ${find}; b.scrollIntoView({ block: 'center' }); b.focus({ preventScroll: true }); return true; })()`);
        await sleep(400);
        const was = await at();
        for (let k = 0; k < 3; k++) await flip();
        const now = await at();
        (now.at === was.at && Math.abs(now.top - was.top) <= 2 && !now.hidden ? kept : lost)
          .push(`${w}px, ${was.at} ${was.top}px down → after three redraws ${said(now)}`);
      }

      /* V3 — a heading focus was sent to (a jump link on the home page)
         keeps it when the filings land. */
      await view(1440, 900);
      await open('/', /us\.json/, `!!document.querySelector('#main a[href="#products"]')`);
      await evaluate(`document.querySelector('#main a[href="#products"]').focus()`);
      await key('Enter', 13, '\r'); await sleep(200);
      const jumped = await at();
      await release('/');
      const onHead = await at();
      (jumped.at === 'pub-products-h' && onHead.at === 'pub-products-h' ? kept : lost).push(`the Products heading, reached by its jump link → ${said(jumped)}; the filings land → ${said(onHead)}`);

      /* V4 — a card's "Delete", pressed, does not hand focus to the next
         card's: three watchlists, the first deleted by keyboard. */
      await evaluate(`localStorage.setItem('vl.watchlists', JSON.stringify([
        { id: 'wl-rv-a', name: 'Alpha list', ids: ['MAYBANK'], created: '2026-09-01' },
        { id: 'wl-rv-b', name: 'Beta list', ids: [], created: '2026-09-02' },
        { id: 'wl-rv-c', name: 'Gamma list', ids: [], created: '2026-09-03' }]))`);
      await open('/my/watchlists', null, `[...document.querySelectorAll('#main button')].filter(b => b.textContent.trim() === 'Delete').length === 3`);

      /* V7 — a name typed into a list's "Add a company" and not yet added,
         across two OS theme switches: put back after the first as a plain
         value, it went with the second. */
      await evaluate(`(() => { const n = document.querySelector('#main input[aria-label="Add a company to Beta list"]'); n.scrollIntoView({ block: 'center' }); n.focus(); return true; })()`);
      await typeIn('ma');
      await flip();
      const addOnce = await at();
      await flip();
      const addTwice = await at();
      (addTwice.at.includes('Add a company to Beta list') && addTwice.value === 'ma' && JSON.stringify(addTwice.caret) === '[2,2]' ? kept : lost)
        .push(`"ma" typed into Beta list's "Add a company" → one OS switch: ${said(addOnce)}; two: ${said(addTwice)}`);

      await evaluate(`(() => { window.confirm = () => true; [...document.querySelectorAll('#main button')].find(b => b.textContent.trim() === 'Delete').focus(); return true; })()`);
      await key('Enter', 13, '\r'); await sleep(400);
      const afterDelete = await at();
      const lists = await evaluate(`State.watchlists.map(w => w.name).join(', ')`);
      /* fixwave: shell (WS-16) — not <main> at the top of the page but the
         New watchlist field; still never the next card. */
      (lists === 'Beta list, Gamma list' && afterDelete.at === 'INPUT:New watchlist name' ? kept : lost).push(`Delete on "Alpha list" → ${said(afterDelete)}; lists left: ${lists}`);
      await evaluate(`(() => { const v = ${JSON.stringify(saved.watchlists)}; if (v == null) localStorage.removeItem('vl.watchlists'); else localStorage.setItem('vl.watchlists', v); return true; })()`);

      /* V5 — a scanner field, whose id is numbered afresh at every draw,
         with a name half typed, across the OS switching theme. */
      await open('/app/scanner/setups/new', null, `!!document.querySelector('#main .scan-builder input[aria-label="Name"]')`);
      await evaluate(`(() => { const n = document.querySelector('#main .scan-builder input[aria-label="Name"]'); n.scrollIntoView({ block: 'center' }); n.focus(); n.select(); return true; })()`);
      await typeIn('ab');
      await flip();
      const onName = await at();
      const nameField = await evaluate(`document.activeElement?.getAttribute('aria-label')`);
      await typeIn('c');
      const named = await evaluate(`document.querySelector('#main .scan-builder input[aria-label="Name"]')?.value`);
      (nameField === 'Name' && onName.value === 'ab' && JSON.stringify(onName.caret) === '[2,2]' && named === 'abc' ? kept : lost)
        .push(`the setup's Name with "ab" typed → ${said(onName)} (${nameField}); then c → ${JSON.stringify(named)}`);
      await evaluate(`(() => { scanDraft = null; return true; })()`);

      /* V6 — a figure in a statement table swiped back to the earliest year
         on a phone, across the OS switching theme: still in sight, not
         swung to the latest years under the pinned line names. */
      await view(390, 844);
      await open('/app/equities/aapl/financials', null, `[...document.querySelectorAll('#main td[tabindex]')].length > 4`);
      const cell = await evaluate(`(() => { const c = document.querySelector('#main td[tabindex]'); const tw = c.closest('.tablewrap');
        if (!tw || tw.scrollWidth <= tw.clientWidth + 4) return null; c.scrollIntoView({ block: 'center' }); tw.scrollLeft = 0; c.focus({ preventScroll: true });
        return c.getAttribute('aria-label'); })()`);
      await sleep(300);
      const cellWas = await at();
      await flip();
      const onCell = await at();
      (cell && onCell.at.includes(cell.slice(0, 40)) && !cellWas.hidden && !onCell.hidden ? kept : lost).push(`${cell ? cell.slice(0, 40) : 'no table wider than its card'} → ${said(onCell)}`);
      /* V8 — the control in use stays where it was on the screen when the
         data lands and the page is drawn with more above it: the
         calculator's "What you observed", with the map of the town's areas
         drawn above it when the locality positions land. */
      await view(1440, 900);
      const observed = `[...document.querySelectorAll('#main select')].find(s => (s.labels?.[0]?.textContent || s.getAttribute('aria-label') || '').includes('What you observed'))`;
      await open('/property/calculator', /us\.json|sarawak-geo\.json/, `!!${observed}`);
      await evaluate(`(() => { const s = ${observed}; s.scrollIntoView({ block: 'center' }); s.focus({ preventScroll: true }); return true; })()`);
      await sleep(200);
      const obsWas = await at();
      await release('/property/calculator');
      const obsNow = await at();
      (obsNow.at === obsWas.at && Math.abs(obsNow.top - obsWas.top) <= 2 ? kept : lost).push(`"What you observed" ${obsWas.top}px down → after the data lands ${said(obsNow)}`);

      /* V9 — a box that holds focus because it scrolls (the methodology's
         table of company types, whose figures the filings change) keeps it
         when the filings land. At 390: since fixwave: shell (SHELL-05) the
         table wraps inside its card at 1440, and a box that does not scroll
         takes no focus. */
      await view(390, 844);
      await open('/methodology', /us\.json/, `[...document.querySelectorAll('#main .tablewrap')].some(t => /Company type/.test(t.textContent))`);
      const box = await evaluate(`(() => { const t = [...document.querySelectorAll('#main .tablewrap')].find(t => /Company type/.test(t.textContent));
        t.scrollIntoView({ block: 'center' }); t.focus({ preventScroll: true }); return document.activeElement === t; })()`);
      await release('/methodology');
      const onBox = await evaluate(`(() => { const a = document.activeElement; return a.matches?.('.tablewrap') && /Company type/.test(a.textContent) ? 'the company-type table' : a === document.body ? 'BODY' : a.id || a.tagName; })()`);
      (box && onBox === 'the company-type table' ? kept : lost).push(`the company-type table's scroller → ${onBox}`);
      await view(1440, 900);

      /* V10 — /decision-record is the record from the first paint, not
         "That page does not exist" until the filings land — and with the
         filings off (?real=0), for good. */
      await open('/decision-record', /us\.json/, `document.readyState === 'complete' && !!document.querySelector('#main h1')`);
      const drHeld = await evaluate(`State.view`);
      await release('/decision-record');
      holdRe = null;
      await evaluate('window.__rvLeaving = true');
      await send('Page.navigate', { url: `${BASE}/decision-record?real=0` }, sessionId);
      await until(`!window.__rvLeaving && document.readyState === 'complete' && !!document.querySelector('#main h1')`, '/decision-record?real=0 drawn');
      await sleep(300);
      const drOff = await evaluate(`State.view`);
      (drHeld === 'decisionRecord' && drOff === 'decisionRecord' ? kept : lost).push(`/decision-record with the filings on their way: ${drHeld}; with them off: ${drOff}`);

      /* V11 — a redraw of the page on screen does not fade the page out and
         slide it in again; a new page still enters. */
      await open('/discover/screener', null, `!!document.getElementById('covRange')`);
      const entering = "document.querySelector('#views > section.view').getAnimations().length";
      const onRedraw = await evaluate(`(() => { render(); return ${entering}; })()`);
      const onNavigate = await evaluate(`(() => { navigate('/discover/value-map'); return ${entering}; })()`);
      (onRedraw === 0 && onNavigate > 0 ? kept : lost).push(`animations on the page after a redraw: ${onRedraw}; after a navigation: ${onNavigate}`);
      /* V12 — a tab in the Scanner's own strip, scrolled along to it on a
         phone, is still in sight in its strip after the OS switches theme
         (the new strip started at its beginning and then swung to the
         current tab). */
      await view(360, 780);
      await open('/app/scanner', null, `!!document.querySelector('#views .ptabs-list')`);
      const lastTab = await evaluate(`(() => { const l = [...document.querySelectorAll('#views .ptabs-list')].find(x => x.scrollWidth > x.clientWidth + 4);
        if (!l) return null; const tabs = [...l.querySelectorAll('a')]; const t = tabs[tabs.length - 1]; t.focus(); t.scrollIntoView({ block: 'center', inline: 'nearest' });
        return t.textContent.trim(); })()`);
      await sleep(300);
      await flip();
      const inStrip = await evaluate(`(() => { const a = document.activeElement; const l = a?.closest?.('.ptabs-list'); if (!l) return a === document.body ? 'BODY' : 'not in the strip';
        const r = a.getBoundingClientRect(), q = l.getBoundingClientRect(); return (r.left >= q.left - 1 && r.right <= q.right + 1 ? 'in sight' : 'out of sight') + ': ' + a.textContent.trim(); })()`);
      (lastTab && inStrip === `in sight: ${lastTab}` ? kept : lost).push(`the strip's last tab, ${lastTab || 'no strip wider than the screen'} → ${inStrip}`);
    } catch (err) {
      broke = `the checks stopped: ${String(err.message).split('\n')[0]}`;
    } finally {
      holdRe = null;
      while (held.length) await send('Fetch.continueRequest', { requestId: held.shift() }, sessionId);
      await send('Fetch.disable', {}, sessionId);
      await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
      await send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
      await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
      if (saved.theme != null) await evaluate(`localStorage.setItem('vl.theme', ${JSON.stringify(saved.theme)}); true`).catch(() => {});
      ws.removeEventListener('message', onPause);
    }
    if (lost.length || kept.length < CASES) fail('render-focus-verify: a redraw of the page on screen still loses, hides, moves or misplaces the control in use',
      [...lost, ...(kept.length + lost.length < CASES ? [broke || 'not every case ran'] : [])]);
    else ok(`render-focus-verify: the control in use comes back where the reader left it — ${kept.length} cases: a chart; a control under the sticky strip, one below a chart and one below the valuation tab's charts that stay put through three redraws; a heading reached by a jump link; a name typed and not yet added, through two redraws; a card's Delete that does not pass to the next card; a scanner field mid-typing; a figure in a table swiped sideways; a field with more drawn above it; a table's scroller; /decision-record from the first paint and with the filings off; no entrance replayed by a redraw; a tab scrolled along to in the Scanner's strip on a phone`);
  }
  /* ---- end bugfix: render-focus-verify ---- */

  /* ---- fixwave: shell ---- */
  /* THE SITE HUNT OF 2026-09-29 — THE SHELL, AND FOCUS THE READER'S OWN KEYS
     LOST. Each is driven as the finding drove it, with real key events where
     the fault lies between the keys, and each failed on 0e1119b:
     SHELL-01 the search reopened holding "nvda" over the empty box's list,
     and Enter opened Maybank; SHELL-04 /discover showed whichever tab was
     used last; SHELL-05 the methodology's router table ran 1,865px past its
     card; SHELL-08 /learn and /learn/glossary each named themselves while
     /learn?tab=scoring named /learn, the dictionary; SHELL-09 a tab whose
     address is a path put focus on <main> and went to the top; SHELL-12
     /index.html was the 404 card; EQ-12 the section jump left focus on the
     select; EQ-19 a name in ?companies= that is no company was dropped
     without a word; EQ-22 a figure typed and Tabbed past, and a toggle whose
     words change, dropped focus; WS-16 × Remove, Delete and the sample
     banner's Clear left focus at the top of the page; SCN-05 the example
     picker went back to "Choose an example…" at every change; SCN-07 Adopt
     and a bulk Archive left focus at the top of the page. */
  {
    const kept = [], lost = [];
    const say = (good, text) => (good ? kept : lost).push(text);
    const KEY = { Enter: [13, '\r'], Escape: [27, ''], Tab: [9, ''], ArrowRight: [39, ''], '/': [191, '/'] };
    const key = async (k, shift = false) => {
      const [code, text] = KEY[k] || [k.toUpperCase().charCodeAt(0), k];
      const modifiers = shift ? 8 : 0;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, windowsVirtualKeyCode: code, ...(text ? { text } : {}), modifiers }, sessionId);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, windowsVirtualKeyCode: code, modifiers }, sessionId);
      await sleep(60);
    };
    const typeIn = async (t) => { for (const ch of t) await key(ch); };
    const view = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    const DESC = `((a) => !a || a === document.body ? 'BODY' : a.id === 'main' ? 'MAIN'
      : a.tagName + ':' + (a.getAttribute('aria-label') || a.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 48))`;
    const active = () => evaluate(`${DESC}(document.activeElement)`);
    const focusOn = (expr) => evaluate(`(() => { const n = ${expr}; if (!n) return false; n.scrollIntoView({ block: 'center' }); n.focus(); return document.activeElement === n; })()`);
    const visit = async (path, ms = 350) => { await evaluate(`(() => { navigate(${JSON.stringify(path)}); return true; })()`); await sleep(ms); };
    const CASES = 12;
    let broke = null;
    const snapshot = await evaluate(`JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))`);
    try {
      await view(1440, 900);

      /* SHELL-01 — the reopened search answers the text in its box. */
      await visit('/research');
      await evaluate(`(() => { focusMain(); return true; })()`);
      await key('/'); await sleep(300);
      await typeIn('nvda'); await sleep(400);
      await key('Escape'); await sleep(350);
      await key('/'); await sleep(350);
      const reopened = await evaluate(`({ box: searchInput.value, first: (searchResults.querySelector('button')?.querySelector('span')?.textContent || '').trim() })`);
      await key('Enter'); await sleep(400);
      const opened = await evaluate(`State.view === 'research' ? State.ticker : State.view`);
      say(reopened.box === 'nvda' && reopened.first === 'NVDA' && opened === 'NVDA-SEC',
        `SHELL-01 the search reopened with "${reopened.box}" in the box lists ${reopened.first || 'nothing'} first; Enter opened ${opened}`);

      /* SHELL-04 — /discover with no tab in its address is the screener. */
      const disc = await evaluate(`(async () => {
        const w = (ms) => new Promise(r => setTimeout(r, ms));
        const shown = () => ({ at: location.pathname + location.search, tab: State.discoverTab,
          selected: document.querySelector('#views [role=tablist][aria-label="Screener tools"] [aria-selected=true]')?.textContent.trim() });
        navigate('/discover'); await w(150);
        go('discover', { tab: 'heatmap' }); await w(150);
        const popped = new Promise(r => addEventListener('popstate', () => setTimeout(r, 150), { once: true }));
        history.back(); await popped;
        const back = shown();
        navigate('/discover?tab=ideas'); await w(100); navigate('/about'); await w(100); navigate('/discover'); await w(150);
        return { back, again: shown() };
      })()`);
      say(disc.back.at === '/discover' && disc.back.tab === 'screener' && disc.back.selected === 'Stock Screener' && disc.again.tab === 'screener' && disc.again.selected === 'Stock Screener',
        `SHELL-04 Back from the Heatmap to ${disc.back.at} shows ${disc.back.selected}; /discover after /discover?tab=ideas shows ${disc.again.selected}`);

      /* SHELL-05 — the router table's Companies column wraps inside its card. */
      await visit('/methodology', 500);
      const router = await evaluate(`(() => { const t = [...document.querySelectorAll('#main table')].find(x => /Company type/.test(x.tHead?.textContent || '')); if (!t) return null;
        const w = t.closest('.tablewrap'), td = t.tBodies[0].rows[0].cells[3];
        return { table: Math.round(t.scrollWidth), wrap: Math.round(w.clientWidth), ws: getComputedStyle(td).whiteSpace }; })()`);
      say(router && router.table <= router.wrap + 1 && router.ws !== 'nowrap',
        `SHELL-05 at 1440 the router table is ${router?.table}px in a ${router?.wrap}px card, its Companies cells white-space ${router?.ws}`);

      /* SHELL-08 — one page, one canonical address: the tab on screen names it. */
      const canon = await evaluate(`(() => { const out = {};
        for (const p of ['/learn', '/learn/glossary', '/learn?tab=scoring', '/learn?tab=models', '/methodology', '/equities/methodology', '/corrections',
          '/discover', '/discover/screener', '/discover/value-map', '/discover?tab=heatmap', '/discover?tab=ideas']) {
          navigate(p); out[p] = document.querySelector('link[rel=canonical]').getAttribute('href').replace(location.origin, ''); }
        return out; })()`);
      const wantCanon = { '/learn': '/learn/glossary', '/learn/glossary': '/learn/glossary', '/learn?tab=scoring': '/learn?tab=scoring', '/learn?tab=models': '/methodology',
        '/methodology': '/methodology', '/equities/methodology': '/methodology', '/corrections': '/corrections', '/discover': '/discover/screener',
        '/discover/screener': '/discover/screener', '/discover/value-map': '/discover/value-map', '/discover?tab=heatmap': '/discover?tab=heatmap', '/discover?tab=ideas': '/discover?tab=ideas' };
      const canonWrong = Object.entries(wantCanon).filter(([p, c]) => canon[p] !== c).map(([p, c]) => `${p} → ${canon[p]} (want ${c})`);
      say(!canonWrong.length, `SHELL-08 canonicals: ${canonWrong.length ? canonWrong.join('; ') : `${Object.keys(wantCanon).length} addresses, each naming the page its tab shows`}`);

      /* SHELL-09 — choosing a tab keeps focus on the tab chosen and the page
         where it is, whether the tab's address is a path or ?tab=. */
      const tabWalk = [];
      for (const [path, label, steps] of [['/learn/glossary', 'Methodology sections', ['Scoring architecture', 'Valuation model router']],
        ['/discover/screener', 'Screener tools', ['Quality vs Value Map']]]) {
        await visit(path, 500);
        await evaluate(`(() => { window.scrollTo({ top: 200, behavior: 'instant' }); document.querySelector('#views [role=tablist][aria-label="${label}"] [aria-selected=true]').focus({ preventScroll: true }); return true; })()`);
        for (const want of steps) {
          await key('ArrowRight'); await key('Enter'); await sleep(400);
          const r = await evaluate(`({ at: ${DESC}(document.activeElement), y: Math.round(scrollY), path: location.pathname + location.search })`);
          tabWalk.push({ want, ...r });
        }
      }
      /* Not to the top: the page stays where it was, give or take the few
         pixels that bring the chosen tab out from under the sticky header. */
      const tabBad = tabWalk.filter(t => t.at !== `BUTTON:${t.want}` || t.y < 150);
      say(!tabBad.length, `SHELL-09 ${tabWalk.map(t => `${t.want} → ${t.path}: focus ${t.at}, scrolled to ${t.y}`).join('; ')}`);

      /* EQ-19 — a name in ?companies= that is no company is named on the page. */
      const cmp = await evaluate(`(() => { const main = () => document.querySelector('#main').innerText;
        navigate('/compare?companies=zzz,yyy'); const none = { ids: State.compare.join(','), named: /zzz/.test(main()) && /yyy/.test(main()) };
        navigate('/compare?companies=AAPL,zzz'); const one = { ids: State.compare.join(','), named: /zzz/.test(main()) };
        navigate('/compare'); return { none, one }; })()`);
      say(cmp.none.ids === '' && cmp.none.named && cmp.one.ids === 'AAPL-SEC' && cmp.one.named,
        `EQ-19 ?companies=zzz,yyy compares [${cmp.none.ids}], naming the misses: ${cmp.none.named}; ?companies=AAPL,zzz compares [${cmp.one.ids}], naming zzz: ${cmp.one.named}`);

      /* EQ-22 — a figure typed and Tabbed past moves on one stop; a toggle
         whose words change keeps focus. */
      await visit('/company/PGR', 600);
      const wasDisc = await evaluate(`State.requiredDiscount`);
      await focusOn(`document.getElementById('reqDisc')`);
      await evaluate(`(() => { document.getElementById('reqDisc').select(); return true; })()`);
      await typeIn('10'); await key('Tab'); await sleep(400);
      const tabbed = await evaluate(`(() => { const a = document.activeElement, f = document.getElementById('reqDisc');
        const stops = [...document.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]')]
          .filter(n => n.tabIndex >= 0 && n.getClientRects().length);
        return { at: ${DESC}(a), next: stops[stops.indexOf(f) + 1] === a, disc: State.requiredDiscount }; })()`);
      await evaluate(`(() => { State.requiredDiscount = ${JSON.stringify(wasDisc)}; store.write('requiredDiscount', State.requiredDiscount); return true; })()`);
      const toggles = [];
      for (const [path, find] of [['/company/PGR', `[...document.querySelectorAll('#main button')].find(b => /watchlist/i.test(b.textContent))`],
        ['/discover/screener', `[...document.querySelectorAll('#main button')].find(b => /medians/.test(b.textContent))`]]) {
        await visit(path, 500);
        await focusOn(find);
        const before = await active();
        await key('Enter'); await sleep(350);
        const once = await active();
        await key('Enter'); await sleep(350);
        toggles.push({ before, once, twice: await active() });
      }
      say(tabbed.disc === 10 && tabbed.next && toggles.every(t => t.once !== t.before && /^BUTTON:/.test(t.once) && t.twice === t.before),
        `EQ-22 10 typed into the required discount, then Tab: recorded ${tabbed.disc}, focus ${tabbed.at}${tabbed.next ? ', the next stop' : ''}; ${toggles.map(t => `${t.before} → Enter → ${t.once} → Enter → ${t.twice}`).join('; ')}`);

      /* EQ-12 — the section jump lands the heading clear of the strip and
         takes focus there. */
      await send('Page.navigate', { url: `${BASE}/company/aapl-apple-inc` }, sessionId);
      await waitFiled(); await sleep(500);
      const jumpTo = await evaluate(`(() => { window.scrollTo({ top: 0, behavior: 'instant' }); const s = document.querySelector('select[aria-label="Jump to a section of this report"]'); if (!s) return null;
        s.focus(); return ([...s.options].find(o => o.textContent.trim() === 'Valuation range') || s.options[3]).value; })()`);
      await sleep(300);
      await evaluate(`(() => { const s = document.querySelector('select[aria-label="Jump to a section of this report"]'); s.value = ${JSON.stringify(jumpTo)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await sleep(1200);
      const jumped = await evaluate(`(() => { const h = document.getElementById(${JSON.stringify(jumpTo)}); if (!h) return null;
        return { top: Math.round(h.getBoundingClientRect().top), strip: Math.round(document.querySelector('.ticker-sticky').getBoundingClientRect().bottom), onIt: document.activeElement === h, at: ${DESC}(document.activeElement) }; })()`);
      say(jumped && jumped.top >= jumped.strip && jumped.onIt, `EQ-12 "${jumpTo}" jumped to: heading ${jumped?.top}px down under a strip ending at ${jumped?.strip}px, focus ${jumped?.at}`);

      /* WS-16 — × Remove, Delete and Clear hand focus to what follows. */
      const tks = await evaluate(`(() => { const ids = U.filter(r => !r.c.real).slice(0, 3).map(r => r.c.id); const now = '2026-09-02T00:00:00Z';
        State.watchlists = [{ id: 'wl-1', name: 'Core watchlist', ids, added: {}, createdAt: '2026-09-01T00:00:00Z', updatedAt: null, schema: WATCHLIST_SCHEMA },
          { id: 'wl-fw', name: 'Fixwave list', ids: [], added: {}, createdAt: now, updatedAt: now, schema: WATCHLIST_SCHEMA }];
        State.wlIdx = 0; saveWatchlists(); window.confirm = () => true; navigate('/my/watchlists'); return ids.map(id => BY_ID.get(id).c.tk); })()`);
      await sleep(400);
      const wl = {};
      await focusOn(`document.querySelector('#main button[aria-label="Remove ${tks[1]} from Core watchlist"]')`);
      await key('Enter'); await sleep(350); wl.middle = await active();
      await focusOn(`document.querySelector('#main button[aria-label="Remove ${tks[2]} from Core watchlist"]')`);
      await key('Enter'); await sleep(350); wl.last = await active();
      await focusOn(`[...document.querySelectorAll('#main .card')].find(c => c.querySelector('input[aria-label="Name of watchlist Fixwave list"]'))?.querySelector('button.btn-quiet')`);
      await key('Enter'); await sleep(350); wl.deleted = await active();
      /* The removals changed Core watchlist, which is the reader's now; an
         untouched sample list brings the banner back. */
      await evaluate(`(() => { State.watchlists.push({ id: 'wl-2', name: 'Sample list', ids: [], added: {}, createdAt: '2026-09-01T00:00:00Z', updatedAt: null, schema: WATCHLIST_SCHEMA });
        saveWatchlists(); render(); return true; })()`);
      wl.banner = await focusOn(`document.querySelector('#main .sample-banner button')`);
      await key('Enter'); await sleep(350); wl.cleared = await active();
      say(wl.middle === `BUTTON:Remove ${tks[2]} from Core watchlist` && wl.last === 'INPUT:Add a company to Core watchlist' && wl.deleted === 'INPUT:New watchlist name'
        && wl.banner && wl.cleared === 'H1:Watchlists',
        `WS-16 × on the middle row → ${wl.middle}; × on the last → ${wl.last}; Delete → ${wl.deleted}; Clear and start my own → ${wl.cleared}`);

      /* SCN-05 — the example picker shows the example loaded, so the next
         change moves on from it. */
      const ex = await evaluate(`(async () => { const w = (ms) => new Promise(r => setTimeout(r, ms));
        scanDraft = null; scanDraftSeed = null; window.confirm = () => true; navigate('/app/scanner/setups/new'); await w(200);
        const pick = () => document.querySelector('#main select[aria-label="Start from an example"]');
        const step = async () => { const s = pick(); s.selectedIndex = s.selectedIndex + 1; s.dispatchEvent(new Event('change', { bubbles: true })); await w(150);
          return { shown: pick().value, name: document.querySelector('#main .scan-builder input[aria-label="Name"]')?.value }; };
        const first = await step(), second = await step();
        const want = SCAN_EXAMPLES.setups.slice(0, 2).map(x => ({ id: x.id, name: x.name }));
        scanDraft = null; scanDraftSeed = null;
        return { first, second, want }; })()`);
      say(ex.first.shown === ex.want[0].id && ex.second.shown === ex.want[1].id && ex.second.name === ex.want[1].name,
        `SCN-05 one change: the picker shows "${ex.first.shown}"; the next: "${ex.second.shown}", the draft named "${ex.second.name}" (want ${ex.want[1].name})`);

      /* SCN-07 — Adopt and a bulk Archive hand focus to what is left. Each Adopt
         button is named "Adopt from file: <id>", its visible words first (SCN-13). */
      await evaluate(`(() => { window.__fwScan = { f: scanSetupsFile, a: scanAlertsFile };
        scanSetupsFile = { kind: 'quantum-tradeworks-scan-setups', schema: 2, setups: JSON.parse(JSON.stringify(SCAN_EXAMPLES.setups)) };
        ['vl.scanSetups', 'vl.scanAlertState', 'vl.scanPrefs'].forEach(k => localStorage.removeItem(k)); navigate('/app/scanner/setups'); return true; })()`);
      await sleep(400);
      const adoptId = await evaluate(`document.querySelectorAll('#main button[aria-label^="Adopt from file: "]')[1]?.getAttribute('aria-label').replace(/^Adopt from file: /, '')`);
      await focusOn(`document.querySelector('#main button[aria-label="Adopt from file: ${adoptId}"]')`);
      await key('Enter'); await sleep(400);
      const adoptOne = await evaluate(`(() => { const a = document.activeElement; return { at: ${DESC}(a), row: a.tagName === 'A' && !!a.closest('.scan-drift') && decodeURIComponent(a.getAttribute('href')).endsWith('/${adoptId}') }; })()`);
      await focusOn(`[...document.querySelectorAll('#main button')].find(b => /^Adopt all/.test(b.textContent))`);
      await key('Enter'); await sleep(400);
      const adoptAll = await active();
      const firstId = await evaluate(`(() => { localStorage.removeItem('vl.scanSetups'); const id = scanSetupsFile.setups[0].id; navigate('/app/scanner/setups/' + encodeURIComponent(id)); return id; })()`);
      await sleep(400);
      const pageBtn = await focusOn(`[...document.querySelectorAll('#main button')].find(b => b.textContent.trim() === 'Adopt from file')`);
      if (pageBtn) { await key('Enter'); await sleep(400); }
      const adoptPage = pageBtn ? await active() : 'no Adopt from file on the setup page';
      await evaluate(`(() => { scanAlertsFile = { alerts: ['AAA', 'BBB', 'CCC'].map((symbol, i) => ({ id: 'afw0000' + i, key: 'fixwave-' + i, setupId: ${JSON.stringify(firstId)}, setupName: 'Fixwave', setupVersion: 1,
          symbol, market: null, timeframe: '1D', candleDate: '2026-09-0' + (i + 1), bar: '2026-09-0' + (i + 1), detectedAt: '2026-09-0' + (i + 2) + 'T01:00:00Z', eventType: 'MATCH', close: 10 + i, engine: 'scan ' + SCAN_VERSION, rules: [] })), lastRun: null };
        navigate('/app/scanner/alerts'); return true; })()`);
      await sleep(400);
      await focusOn(`[...document.querySelectorAll('#main button')].find(b => b.textContent.trim() === 'Archive')`);
      await key('Enter'); await sleep(400);
      const archived = await active();
      await evaluate(`(() => { scanSetupsFile = window.__fwScan.f; scanAlertsFile = window.__fwScan.a; delete window.__fwScan; return true; })()`);
      say(adoptOne.row && adoptAll === 'BUTTON:Export scan-setups.json' && /^BUTTON:(Disable|Enable)$/.test(adoptPage) && archived === 'BUTTON:Show every match',
        `SCN-07 Adopt ${adoptId} → ${adoptOne.at}${adoptOne.row ? ' (its row)' : ''}; Adopt all → ${adoptAll}; Adopt on the setup page → ${adoptPage}; Archive of every alert shown → ${archived}`);

      /* SHELL-12 — /index.html is the front door. */
      await send('Page.navigate', { url: `${BASE}/index.html` }, sessionId);
      await waitFiled(); await sleep(300);
      const door = await evaluate(`({ view: State.view, path: location.pathname, canon: document.querySelector('link[rel=canonical]').getAttribute('href').replace(location.origin, '') })`);
      say(door.view === 'marketing' && door.path === '/' && door.canon === '/', `SHELL-12 /index.html → ${door.view} at ${door.path}, canonical ${door.canon}`);
    } catch (err) {
      broke = `the checks stopped: ${String(err.message).split('\n')[0]}`;
    } finally {
      await evaluate(`(() => { const s = ${JSON.stringify(snapshot)}; const o = JSON.parse(s); localStorage.clear(); Object.entries(o).forEach(([k, v]) => localStorage.setItem(k, v)); return true; })()`).catch(() => {});
      await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
      await send('Page.navigate', { url: `${BASE}/research` }, sessionId);
      await waitFiled();
    }
    if (lost.length || kept.length < CASES) fail('fixwave: shell — the shell, and focus after the reader\'s own keys, as the 2026-09-29 hunt found them',
      [...lost, ...(kept.length + lost.length < CASES ? [broke || `${kept.length + lost.length} of ${CASES} cases ran`] : [])]);
    else ok(`fixwave: shell — ${kept.length} cases: the reopened search answers its box; /discover is the screener; the router table wraps in its card; one canonical per page and tab; a tab keeps focus whether its address is a path or ?tab=; the section jump takes focus to the heading; a missing ?companies= name is named; Tab past a typed figure and a toggle keep focus; × Remove, Delete and Clear hand focus on; the example picker shows the example; Adopt and Archive hand focus on; /index.html is the front door`);
  }
  /* ---- end fixwave: shell ---- */
  /* ---- fixwave: workspace ---- */
  /* THE WORKSPACE PAGES, AFTER THE 2026-09-29 HUNT. One check per finding,
     each named by its id. It runs last because it starts from a cleared
     browser (the first visit's samples are what several findings are
     about) and reloads the app five times; nothing after it reads what it
     leaves. Exceptions and console errors are collected while it runs, so
     a page that throws fails the check that opened it. */
  {
    const wsErrors = [];
    const wsListen = (e) => {
      const m = JSON.parse(e.data);
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Runtime.exceptionThrown') wsErrors.push(String(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception').split('\n')[0]);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') wsErrors.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').split('\n')[0].slice(0, 200));
    };
    ws.addEventListener('message', wsListen);
    /* A fresh page load, waited on until the filings are in (or 20s, so a
       page that never finishes loading is reported rather than hung on). */
    const wsOpen = async (path, seed) => {
      await evaluate(`(() => { ${seed === undefined ? '' : `localStorage.clear(); ${seed};`} window.__wsGone = true; return true; })()`);
      await send('Page.navigate', { url: `${BASE}${path}` }, sessionId);
      for (const t = Date.now(); Date.now() - t < 20000; await sleep(100)) {
        try { if (await evaluate(`!window.__wsGone && typeof realPending !== 'undefined' && !realPending && !!State.view`)) { await sleep(300); return true; } } catch { /* booting */ }
      }
      return false;
    };
    const FRESH = (plan) => `localStorage.setItem('vl.plan', JSON.stringify('${plan}')); localStorage.setItem('vl.onboarding', JSON.stringify({ done: true, at: '2026-09-27T00:00:00Z' }))`;
    const W = 'const w = (ms) => new Promise(r => setTimeout(r, ms)); const txt = (n) => (n ? n.innerText : \'\').replace(/\\s+/g, \' \').trim();';
    const report = (id, what, p, okText) => { if (p.length) fail(`fixwave workspace ${id}: ${what}`, p); else ok(`fixwave workspace ${id}: ${okText || what}`); };
    try {
      /* ---------- A first visit on the Free plan: the seeded samples ---------- */
      await wsOpen('/app', FRESH('free'));

      /* WS-17 — a snapshot of the calculator's untouched sample inputs is a
         sample, not "your own inputs", and does not make the dashboard the
         returning one. A snapshot of an edited deal is the reader's. */
      {
        const r = await evaluate(`(async () => { ${W}
          const before = myDashOwn().propertySnaps, own0 = myDashOwn().hasOwn;
          const rec = saveWork('property', 'WS17 untouched');
          const it = workspaceItems().find(i => i.kind === 'work' && i.key === rec.id);
          const o = myDashOwn();
          navigate('/app'); await w(150);
          const out = { sample: !!it?.sample, detail: it?.detail || '', snaps: o.propertySnaps - before, own0, hasOwn: o.hasOwn, start: !!document.querySelector('.dash-start') };
          navigate('/my/workspace'); await w(150);
          const row = [...document.querySelectorAll('.ws-row')].find(x => x.textContent.includes('WS17 untouched'));
          out.chip = !!row && [...row.querySelectorAll('.chip')].some(c => c.textContent.trim() === 'sample');
          const keepDeal = JSON.stringify(State.deal);
          State.deal = { ...State.deal, price: 610000, touched: { ...(State.deal.touched || {}), price: true } };
          const mine = saveWork('property', 'WS17 edited');
          const it2 = workspaceItems().find(i => i.kind === 'work' && i.key === mine.id);
          out.mine = { sample: !!it2?.sample, snaps: myDashOwn().propertySnaps - before };
          deleteWork(rec.id); deleteWork(mine.id); State.deal = JSON.parse(keepDeal);
          return out;
        })()`);
        const p = [];
        if (!r.sample || /Your own inputs/.test(r.detail)) p.push(`an untouched deal's snapshot is listed as "${r.detail}", sample ${r.sample}`);
        if (!r.chip) p.push('Saved Models shows no sample chip on it');
        /* Judged against the browser as it was: the untouched snapshot must change
           nothing. (A browser that already holds the reader's own work — scanner
           setups in the worker's file, say — is a returning one before and after.) */
        if (r.snaps || r.hasOwn !== r.own0 || (!r.own0 && !r.start)) p.push(`it counts as own work: ${r.snaps} property snapshots, hasOwn ${r.own0} before and ${r.hasOwn} after, first-time checklist ${r.start}`);
        if (r.mine.sample || r.mine.snaps !== 1) p.push(`an edited deal's snapshot: sample ${r.mine.sample}, counted ${r.mine.snaps}`);
        report('WS-17', 'a snapshot of the sample inputs is labelled a sample and is not counted as the reader\'s work; an edited one is', p);
      }

      /* WS-05 — /my/data names the samples as samples, with the banner. */
      {
        const r = await evaluate(`(async () => { ${W}
          const held = () => { const card = [...document.querySelectorAll('main .card')].find(c => /Everything you have made/.test(c.querySelector('h3, h2')?.textContent || ''));
            const dts = [...(card?.querySelectorAll('dt') || [])]; return Object.fromEntries(dts.map(d => [d.textContent.trim(), d.nextElementSibling?.textContent.trim() || ''])); };
          navigate('/my/data'); await w(150);
          const out = { banner: !!document.querySelector('main .sample-banner'), first: held() };
          seedWorkedExample(); render(); await w(150);
          out.example = held();
          clearWorkedExample(); render();
          return out;
        })()`);
        const p = [];
        if (!r.banner) p.push('/my/data has no sample banner');
        for (const k of ['Portfolios and holdings', 'Investment cases', 'Watchlists', 'Price alerts'])
          if (!/sample/i.test(r.first[k] || '')) p.push(`first visit: "${k}" reads "${r.first[k]}"`);
        for (const k of ['Property comparables', 'Cash Wheel plan'])
          if (!/sample|worked example/i.test(r.example[k] || '')) p.push(`worked example loaded: "${k}" reads "${r.example[k]}"`);
        report('WS-05', '"Everything you have made" says which records are samples, and the page carries the sample banner', p);
      }

      /* EQ-05 — the seeded case on a company page says it is a sample and
         the seven-step review does not count it as the reader's work. */
      {
        const r = await evaluate(`(async () => { ${W}
          navigate('/company/MAYBANK'); await w(250);
          const btn = [...document.querySelectorAll('main .company-acts button')].map(b => b.textContent.trim()).find(t => /investment case|Save research/.test(t)) || '';
          navigate('/company/MAYBANK?tab=thesis'); await w(250);
          const cards = [...document.querySelectorAll('main .card')];
          const seven = cards.find(c => /Seven-step review/.test(c.textContent));
          const step6 = seven ? [...seven.querySelectorAll('.row')].map(x => txt(x)).find(t => /Write down what would prove you wrong/i.test(t)) : '';
          const card = cards.find(c => /Invalidation conditions/.test(c.textContent));
          return { btn, sampleChip: !!card && [...card.querySelectorAll('.chip')].some(c => /sample/i.test(c.textContent)), step6: step6 || '' };
        })()`);
        const p = [];
        if (!/sample/i.test(r.btn)) p.push(`header button reads "${r.btn}"`);
        if (!r.sampleChip) p.push('the Thesis tab\'s case carries no sample chip');
        if (/Satisfied/i.test(r.step6) || !/sample/i.test(r.step6)) p.push(`seven-step review, step 6: "${r.step6}"`);
        report('EQ-05', 'the seeded investment case is marked as a sample on the company page and is not counted as work done', p);
      }

      /* WS-06 / WS-07 — the reader's own portfolio: no unpriced holding at
         0.0% in the exposures, no "Sample positions." caption, and counts
         in the singular where there is one. */
      {
        const r = await evaluate(`(async () => { ${W}
          const read = () => {
            const cards = [...document.querySelectorAll('main .card')];
            const expo = cards.filter(c => /Sector exposure|Business-model exposure/.test(c.querySelector('h3')?.textContent || '')).map(txt);
            const cap = cards.map(c => c.querySelector('.caption')).find(n => n && /Return is split/.test(n.textContent))?.textContent || '';
            const tile = cards.map(txt).find(t => /^Portfolio value/i.test(t)) || '';
            const opt = [...document.querySelectorAll('#pf-active option')].map(o => o.textContent);
            const pf = activePF();
            return { expo, cap, tile, opt, unpriced: pf ? positionsOf(pf).filter(Boolean).filter(p => p.unpriced).length : 0 };
          };
          /* Chosen from the data this build holds: the owner's own prices file
             prices MSFT, and a hard-coded MSFT could not run there. */
          const UN = U.find(x => x.c.real && x.c.mkt === 'US' && !isNum(x.c.px?.p))?.c.id || null;
          const PR = isNum(BY_ID.get('PBBANK')?.c.px?.p) ? 'PBBANK' : (U.find(x => x.c.mkt === 'MY' && isNum(x.c.px?.p))?.c.id || null);
          if (!UN || !PR) return { skip: true, UN, PR };
          State.portfolios.push({ id: 'pf-ws', name: 'WS own', cash: 0, cashCcy: 'MYR', holdings: [{ id: UN, qty: 10, cost: 400, fx0: 4.4, fee: 0, rebate: 0 }] });
          State.pfIdx = State.portfolios.length - 1; navigate('/my/portfolio'); await w(150);
          const one = read();
          activePF().holdings.push({ id: PR, qty: 1000, cost: 4, fx0: 4.4, fee: 0, rebate: 0 }); render(); await w(100);
          const two = read();
          State.pfIdx = State.portfolios.findIndex(p => p.id === 'pf-2'); render(); await w(100);
          const sleeve = read();
          State.pfIdx = State.portfolios.findIndex(p => p.id === 'pf-1'); render(); await w(100);
          const seeded = read();
          State.portfolios = State.portfolios.filter(p => p.id !== 'pf-ws'); State.pfIdx = 0; savePortfolios();
          return { one, two, sleeve, seeded, UN, PR };
        })()`);
        const p6 = [], p7 = [];
        if (r.skip) p6.push(`this build holds no unpriced US filer and priced Bursa company to check with: ${r.UN}, ${r.PR}`);
        else {
          for (const [k, v] of [[`${r.UN} alone`, r.one], [`${r.UN} and ${r.PR}`, r.two], ['the US sleeve', r.sleeve]]) {
            if (v.expo.some(t => /\b0\.0%/.test(t))) p6.push(`${k}: an exposure reads 0.0% — ${v.expo.join(' || ').slice(0, 240)}`);
            /* Named wherever a holding on screen has no price, and only there. */
            if (v.unpriced && !v.expo.every(t => /no price/i.test(t))) p6.push(`${k}: the exposure cards do not say which holdings have no price`);
          }
          if (!r.two.expo.some(t => /100\.0%/.test(t))) p6.push(`${r.UN} and ${r.PR}: the priced holding is not the whole of the priced value — ${r.two.expo[0]}`);
        }
        if (!r.skip && /Sample positions/.test(r.one.cap)) p7.push(`the reader's own portfolio is captioned "…${r.one.cap.slice(-40)}"`);
        if (!r.skip && !/Sample positions/.test(r.seeded.cap)) p7.push('the seeded portfolio lost its "Sample positions." caption');
        if (!r.skip && /\b1 positions\b/.test(r.one.tile)) p7.push(`tile reads "${r.one.tile}"`);
        if (!r.skip && r.one.opt.some(o => /\b1 holdings\b/.test(o))) p7.push(`select reads ${JSON.stringify(r.one.opt)}`);
        report('WS-06', 'a holding with no price is left out of the exposure shares and named, never shown at 0.0%', p6);
        report('WS-07', '"Sample positions." captions only a seeded portfolio, and one position or holding is singular', p7);
      }

      /* WS-15 — dates are the reader's local date. The zone is chosen so its
         date differs from the UTC date at the moment the check runs. */
      {
        const tz = new Date().getUTCHours() >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
        await send('Emulation.setTimezoneOverride', { timezoneId: tz }, sessionId);
        let r;
        try {
          r = await evaluate(`(async () => { ${W}
            const d = new Date(), pad = (n) => String(n).padStart(2, '0');
            const local = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), utc = d.toISOString().slice(0, 10);
            const keepPlan = State.plan; State.plan = 'pro';
            const c = wlCreate('WS15 list'); wlAdd(c.watchlist.id, 'MSFT-SEC');
            navigate('/my/watchlists'); await w(150);
            const card = [...document.querySelectorAll('main .card')].find(k => k.querySelector('input[aria-label="Name of watchlist WS15 list"]'));
            const chips = [...(card?.querySelectorAll('.chip') || [])].map(x => x.textContent.trim());
            const added = [...(card?.querySelectorAll('tbody tr') || [])].map(tr => tr.children[4].textContent.trim());
            wlDelete(c.watchlist.id);
            State.theses = State.theses.filter(t => t.ticker !== 'TENAGA');
            addToThesis('TENAGA');
            const th = State.theses.find(t => t.ticker === 'TENAGA');
            State.theses = State.theses.filter(t => t !== th); saveTheses();
            State.pfIdx = Math.max(0, State.portfolios.findIndex(p => p.id === 'pf-1'));
            navigate('/my/portfolio'); await w(150);
            const div = document.getElementById('divDate')?.value || null;
            State.plan = keepPlan;
            return { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, local, utc, chips, added, created: th?.created, review: th?.review, div };
          })()`);
        } finally { await send('Emulation.setTimezoneOverride', { timezoneId: '' }, sessionId); }
        const p = [];
        if (r.local === r.utc) p.push(`in ${r.tz} the local date ${r.local} is the UTC date — the check cannot tell them apart`);
        if (!r.chips.includes(`created ${r.local}`) || !r.chips.includes(`updated ${r.local}`)) p.push(`watchlist chips ${JSON.stringify(r.chips)} (local ${r.local})`);
        if (!r.added.length || r.added.some(a => a !== r.local)) p.push(`Added column ${JSON.stringify(r.added)} (local ${r.local})`);
        if (r.created !== r.local) p.push(`a case started now is "Created ${r.created}" (local ${r.local})`);
        if (r.div !== r.local) p.push(`the dividend's Date paid defaults to ${r.div} (local ${r.local})`);
        report('WS-15', `dates on the watchlist, case and dividend surfaces are the reader's local date (${r.tz}, local ${r.local}, UTC ${r.utc})`, p);
      }

      /* WS-08 — the thesis editor keeps every keystroke, so closing it with
         Escape shows what was kept, and focus goes back to the card's Edit. */
      {
        const r = await evaluate(`(async () => { ${W}
          navigate('/my/theses'); await w(150);
          const t = State.theses.find(x => x.id === 't1') || State.theses[0];
          const tk = BY_ID.get(t.ticker)?.c.tk || t.ticker;
          const cardOf = () => [...document.querySelectorAll('main .card')].find(c => c.querySelector('h3')?.textContent.trim() === tk && /Invalidation conditions/.test(c.textContent));
          const edit = [...cardOf().querySelectorAll('button')].find(b => b.textContent.trim() === 'Edit');
          edit.focus(); edit.click(); await w(400);
          const f = document.getElementById('th-oneLine');
          const said = 'WS08 my own words about ' + tk;
          f.focus(); f.value = said; f.dispatchEvent(new Event('input', { bubbles: true }));
          const conf = document.getElementById('th-conf'); conf.value = 'High'; conf.dispatchEvent(new Event('change', { bubbles: true }));
          await w(60);
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          await w(800);
          const card = cardOf();
          const a = document.activeElement;
          return { stored: (store.read('theses', []).find(x => x.id === t.id) || {}).oneLine === said, shown: !!card && card.textContent.includes(said) && /High confidence/.test(card.textContent),
            focus: a && a.textContent.trim() === 'Edit' && card && card.contains(a) ? 'the card\\'s Edit' : (a?.id || a?.tagName) };
        })()`);
        const p = [];
        if (!r.stored) p.push('the typed case was not kept');
        if (!r.shown) p.push('closing the editor with Escape leaves the card showing the case as it was before the edit');
        if (r.focus !== 'the card\'s Edit') p.push(`focus after the close is on ${r.focus}`);
        report('WS-08', 'an edit kept by the thesis editor shows on the card when the drawer closes without Save, and focus returns to Edit', p);
      }

      /* WS-10 — a feed item reached through an investment case says so, and
         one reached through a list names the list. */
      {
        const r = await evaluate(`(async () => { ${W}
          State.alertKinds = ALERT_KINDS.map(k => k.id);
          const listed = new Set(State.watchlists.flatMap(w => w.ids || []));
          const viaCase = FEED.find(f => !listed.has(f.id) && BY_ID.get(f.id));
          const viaList = FEED.find(f => State.watchlist.includes(f.id) && !State.theses.some(t => t.ticker === f.id));
          if (viaCase && !State.theses.some(t => t.ticker === viaCase.id)) State.theses = [...State.theses, { id: 't-ws10', ticker: viaCase.id, oneLine: 'ws10', quality: '', valCase: '', catalysts: [], risks: [], conds: [], horizon: '3–5 years', review: '2030-01-01', conf: 'Low', questions: [], created: '2026-09-29' }];
          navigate('/my/alerts'); await w(200);
          const item = (f) => f ? txt([...document.querySelectorAll('main .noteitem')].find(n => n.textContent.includes(f.title))) : null;
          const out = { caseTitle: viaCase?.title, caseItem: item(viaCase), listTitle: viaList?.title, listItem: item(viaList), list: activeWL().name };
          State.theses = State.theses.filter(t => t.id !== 't-ws10');
          return out;
        })()`);
        const p = [];
        if (!r.caseTitle) p.push('no feed item outside every list to check with');
        else if (!r.caseItem) p.push(`"${r.caseTitle}" is not in the feed although a case is written on it`);
        else if (/Mapped to your watchlist/i.test(r.caseItem) || !/investment case/i.test(r.caseItem)) p.push(`reached through a case only: "${r.caseItem.slice(0, 200)}"`);
        if (r.listItem && !r.listItem.includes(r.list)) p.push(`reached through the active list "${r.list}": "${r.listItem.slice(0, 200)}"`);
        report('WS-10', 'an alert feed item names what it is mapped to — the list by name, or the investment case', p);
      }

      /* WS-03 — on the Free plan the samples do not use up the allowance,
         the refusals are grammatical, and an alert over the cap is refused
         before its form is filled in. */
      {
        const r = await evaluate(`(async () => { ${W}
          navigate('/my/watchlists'); await w(150);
          const head = [...document.querySelectorAll('main .card')].find(c => /New watchlist/.test(c.querySelector('h3')?.textContent || ''));
          const out = { plan: State.plan, cardSays: txt(head?.querySelector('.caption, p')), create: wlCreate('WS03 mine') };
          out.again = wlCreate('WS03 second');
          navigate('/my/portfolio'); await w(100);
          openPortfolioManager(); await w(350);
          const nb = [...document.querySelectorAll('#drawer button')].find(b => /^New portfolio/.test(b.textContent.trim()));
          const n0 = State.portfolios.length; nb?.click(); await w(100);
          out.pf = { label: nb?.textContent.trim(), made: State.portfolios.length - n0, toast: document.getElementById('toast').textContent };
          closeDrawer({ restore: false }); await w(350);
          const own = State.priceAlerts.filter(pa => !['pa-1', 'pa-2'].includes(pa.id));
          const room = LIMITS.priceAlerts - own.length;
          for (let i = 0; i < room; i++) State.priceAlerts.push({ id: 'pa-ws03-' + i, ticker: 'MAYBANK', op: '<', price: 1 + i, note: '' });
          navigate('/my/alerts'); await w(100);
          openPriceAlertEditor(); await w(350);
          out.alert = { open: drawer.dataset.open === '1', toast: document.getElementById('toast').textContent, cap: LIMITS.priceAlerts };
          closeDrawer({ restore: false }); await w(350);
          State.priceAlerts = State.priceAlerts.filter(pa => !/^pa-ws03-/.test(pa.id)); savePriceAlerts();
          return out;
        })()`);
        const p = [];
        if (r.plan !== 'free') p.push(`the check ran on the ${r.plan} plan`);
        if (!r.create.ok) p.push(`Create refused on a first visit: "${r.create.why}"`);
        if (/lists held/.test(r.cardSays)) p.push(`the card counts the samples: "${r.cardSays}"`);
        if (r.again.ok || !/^1 watchlist is the maximum/.test(r.again.why || '')) p.push(`a second list of the reader's own: ${JSON.stringify(r.again)}`);
        if (r.pf.made !== 1) p.push(`New portfolio (${r.pf.label}) refused on a first visit: "${r.pf.toast}"`);
        if (r.alert.open || !new RegExp('^' + r.alert.cap + ' price alerts? (is|are) the maximum').test(r.alert.toast)) p.push(`New price alert at the cap: drawer open ${r.alert.open}, toast "${r.alert.toast}"`);
        report('WS-03', 'the samples do not use up the Free plan\'s lists, portfolios or alerts; a refusal comes before the form and reads in the singular', p);
      }

      /* WS-04 — a company added to the seeded list, then the samples
         cleared: the list keeps only what the reader added, and the
         dashboard counts it as a list of their own. */
      {
        const r = await evaluate(`(async () => { ${W}
          State.wlIdx = State.watchlists.findIndex(w => w.id === 'wl-1');
          toggleWatch('KLCC');
          const touched = !!State.watchlists.find(w => w.id === 'wl-1')?.updatedAt;
          clearSeededData(); await w(50);
          const kept = State.watchlists.find(w => w.id === 'wl-1');
          const o = myDashOwn();
          const step = myDashSteps(o).find(s => s.k === 'watchlist');
          navigate('/my/watchlists'); await w(150);
          const unknown = [...document.querySelectorAll('main table.dt tbody tr')].filter(tr => tr.children[4]?.textContent.trim() === 'unknown').length;
          return { touched, ids: kept ? kept.ids : null, created: o.createdLists.length, sampleLists: o.sampleLists.length, step: step.done, samples: hasSeededData(), unknown };
        })()`);
        const p = [];
        if (!r.touched) p.push('adding a company did not touch the seeded list — the check is not testing the case');
        if (!r.ids || r.ids.join() !== 'KLCC') p.push(`after clearing, the list the reader added to holds ${JSON.stringify(r.ids)}`);
        if (r.sampleLists || r.samples) p.push(`samples still counted after clearing: ${r.sampleLists} sample lists, hasSeededData ${r.samples}`);
        if (!r.created || !r.step) p.push(`the dashboard does not count it as a list of the reader's own (${r.created} created, step done ${r.step})`);
        if (r.unknown) p.push(`${r.unknown} rows on /my/watchlists read Added "unknown"`);
        report('WS-04', 'clearing the samples takes the seeded companies out of a list the reader added to, and both pages then call it theirs', p);
      }

      /* WS-09 — the dashboard's unread figure agrees with the sidebar badge
         when a setup is muted, and says why the new count differs. */
      {
        const r = await evaluate(`(async () => { ${W}
          const keep = { a: scanAlertsFile, st: localStorage.getItem('vl.scanAlertState'), pr: localStorage.getItem('vl.scanPrefs'), dv: localStorage.getItem('vl.dashVisit') };
          ['vl.scanAlertState', 'vl.dashVisit'].forEach(k => localStorage.removeItem(k));
          scanPrefsWrite({ inApp: true, muted: { 'ws-muted': true } });
          const mk = (setupId, sym, d) => ({ key: setupId + '|' + sym + '|daily|' + d, setupId, setupName: setupId, symbol: sym, timeframe: 'daily', bar: d, close: 10, recordedAt: d + 'T01:00:00Z', rules: [{ text: 'price above SMA20', met: true }], engine: 'scan 0.2.0' });
          scanAlertsFile = { alerts: [mk('ws-muted', 'AAA', '2026-09-01'), mk('ws-muted', 'BBB', '2026-09-02'), mk('ws-muted', 'CCC', '2026-09-03'), mk('ws-on', 'DDD', '2026-09-04'), mk('ws-on', 'EEE', '2026-09-05')], lastRun: null };
          navigate('/app'); await w(200);
          const tile = [...document.querySelectorAll('main .dash-tile')].find(t => /scanner alerts/i.test(t.querySelector('.stat-label')?.textContent || ''));
          const out = { label: txt(tile?.querySelector('.stat-label')), value: txt(tile?.querySelector('.dash-tile-v')), sub: txt(tile?.querySelector('.stat-sub')), badge: scanUnreadCount() };
          scanAlertsFile = keep.a;
          [['vl.scanAlertState', keep.st], ['vl.scanPrefs', keep.pr], ['vl.dashVisit', keep.dv]].forEach(([k, v]) => v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v));
          render();
          return out;
        })()`);
        const p = [];
        if (r.badge !== 2) p.push(`the sidebar badge counts ${r.badge}, not the 2 unmuted — the check is not testing the case`);
        if (r.value !== String(r.badge)) p.push(`"${r.label}" reads ${r.value} while the badge reads ${r.badge}`);
        if (!/3 .*muted/.test(r.sub)) p.push(`the tile does not say the other 3 are from muted setups: "${r.sub}"`);
        report('WS-09', 'the dashboard\'s unread scanner alerts agree with the sidebar badge, and the muted ones are named', p);
      }

      /* EQ-07 — the active watchlist survives a reload. */
      {
        await evaluate(`(() => { State.plan = 'pro'; store.write('plan', 'pro'); const r = wlCreate('WS07 Tech names'); return r.ok; })()`);
        await wsOpen('/company/AAPL-SEC');
        const r = await evaluate(`(() => ({ active: activeWL()?.name, btn: [...document.querySelectorAll('main .company-acts button')].map(b => b.textContent.trim()).find(t => /watchlist/i.test(t)) }))()`);
        const p = [];
        if (r.active !== 'WS07 Tech names') p.push(`after a reload the active list is "${r.active}"`);
        if (r.btn !== 'Add to watchlist') p.push(`the company page's button reads "${r.btn}"`);
        report('EQ-07', 'the list made active stays active across a reload, so the company page\'s toggle acts on it', p);
      }

      /* WS-11 — the onboarding's market answer is the screener's default
         after a reload. */
      {
        await evaluate(`(() => { completeOnboarding({ goal: 'monitor', level: 'basic', market: 'MY', ccy: State.baseCcy }); return true; })()`);
        await wsOpen('/discover/screener');
        const r = await evaluate(`({ universe: State.screen?.universe, stored: store.read('screen', null)?.universe, sel: document.getElementById('uniSel')?.value })`);
        const p = [];
        if (r.universe !== 'MY' || (r.sel && r.sel !== 'MY')) p.push(`after a reload the screener opens on ${r.universe} (select ${r.sel}) with ${r.stored} stored`);
        report('WS-11', 'the market chosen in onboarding is still the screener\'s market after a reload', p);
      }

      /* WS-12 — Skip leaves the answers already given, and the explanation
         depth, as they were, and goes into the app. */
      {
        const r = await evaluate(`(async () => { ${W}
          const skip = () => [...document.querySelectorAll('main button')].find(b => /^Skip/.test(b.textContent.trim()))?.click();
          setExplainDepth('technical');
          State.onboarding = { goal: 'us', level: 'experienced', market: 'US', ccy: 'USD', done: true, at: '2026-09-27T00:00:00Z' }; store.write('onboarding', State.onboarding);
          State.obStep = 0; State.obDraft = {}; navigate('/welcome'); await w(120);
          skip(); await w(200);
          const a = { depth: store.read('explainDepth', null), level: store.read('onboarding', {}).level, market: store.read('onboarding', {}).market, path: location.pathname };
          State.obStep = 0; State.obDraft = {}; navigate('/welcome'); await w(120);
          [...document.querySelectorAll('main .ob-option')].find(b => /Learn investment fundamentals/.test(b.textContent))?.click(); await w(120);
          skip(); await w(200);
          return { a, b: { path: location.pathname, view: State.view } };
        })()`);
        const p = [];
        if (r.a.depth !== 'technical') p.push(`Skip reset the explanation depth to ${r.a.depth}`);
        if (r.a.level !== 'experienced' || r.a.market !== 'US') p.push(`Skip dropped the stored answers: level ${r.a.level}, market ${r.a.market}`);
        if (r.a.path !== '/app') p.push(`Skip went to ${r.a.path}`);
        if (r.b.path !== '/app') p.push(`Skip after answering "Learn investment fundamentals" went to ${r.b.path} (${r.b.view})`);
        report('WS-12', 'Skip keeps the stored preferences and takes the reader into the app', p);
      }

      /* WS-02 — the /start launcher keeps the reader's own deal, contract
         and chart evidence: the deal is kept aside for "Restore my previous
         deal", and a worked example asks before it replaces the others. */
      {
        const r = await evaluate(`(async () => { ${W}
          const asked = [], keepConfirm = window.confirm;
          let answer = false;
          window.confirm = (m) => { asked.push(m); return answer; };
          const open = async (goal, a) => {
            /* Arriving at /start from another page clears the goal (35-ui.js), so it is set once there. */
            navigate('/start'); await w(100);
            State.launcher.goal = goal; State.launcher.a[goal] = a; render(); await w(100);
            [...document.querySelectorAll('main button')].find(b => /^Open the /.test(b.textContent.trim()))?.click(); await w(600);
          };
          const out = {};
          try {
            State.deal = { ...PROPERTY_DEFAULT_DEAL, price: 888000, touched: { price: true }, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {} };
            store.write('deal', State.deal); store.write('dealBeforeLink', null);
            await open('property', { city: 'kuching', mode: 'own' });
            const restore = [...document.querySelectorAll('main button')].find(b => /Restore my previous deal/.test(b.textContent));
            out.deal = { kept: store.read('dealBeforeLink', null)?.price ?? null, offered: !!restore, path: location.pathname };
            restore?.click(); await w(200);
            out.deal.back = State.deal.price;

            State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, putStrike: 61, contracts: 1, isWorkedExample: false }; saveWheel();
            asked.length = 0; answer = false;
            await open('wheel', { mode: 'example' });
            out.wheelDeclined = { strike: store.read('wheelPlan', {}).putStrike, asked: asked.length };
            await open('wheel', { mode: 'own' });
            out.wheelOwn = { strike: store.read('wheelPlan', {}).putStrike };
            answer = true; asked.length = 0;
            await open('wheel', { mode: 'example' });
            out.wheelAccepted = { strike: store.read('wheelPlan', {}).putStrike, asked: asked.length };

            const panel = { ...qttiBlankPanel(), present: true };
            State.qtti = { ...qttiDefaultPlan(), symbol: 'WS02 OWN', timeframes: { daily: panel, weekly: qttiBlankPanel(), monthly: qttiBlankPanel() } }; saveQtti();
            answer = false; asked.length = 0;
            await open('trading', { mode: 'example' });
            out.qttiDeclined = { symbol: store.read('qttiPlan', {}).symbol, asked: asked.length };
            await open('trading', { mode: 'own' });
            out.qttiOwn = { symbol: store.read('qttiPlan', {}).symbol };
          } finally { window.confirm = keepConfirm; }
          return out;
        })()`);
        const p = [];
        if (r.deal.kept !== 888000 || !r.deal.offered || r.deal.back !== 888000) p.push(`the reader's deal: kept aside ${r.deal.kept}, restore offered ${r.deal.offered} on ${r.deal.path}, restored to ${r.deal.back}`);
        if (r.wheelDeclined.strike !== 61 || !r.wheelDeclined.asked) p.push(`a worked contract over the reader's (declined): strike ${r.wheelDeclined.strike}, asked ${r.wheelDeclined.asked}`);
        if (r.wheelOwn.strike !== 61) p.push(`"My own contract" blanked the reader's contract: strike ${r.wheelOwn.strike}`);
        if (r.wheelAccepted.strike !== 50 || !r.wheelAccepted.asked) p.push(`a worked contract, accepted: strike ${r.wheelAccepted.strike}, asked ${r.wheelAccepted.asked}`);
        if (r.qttiDeclined.symbol !== 'WS02 OWN' || !r.qttiDeclined.asked) p.push(`the §14 example over the reader's evidence (declined): ${JSON.stringify(r.qttiDeclined)}`);
        if (r.qttiOwn.symbol !== 'WS02 OWN') p.push(`"My own chart evidence" blanked the reader's: ${JSON.stringify(r.qttiOwn)}`);
        report('WS-02', 'the /start launcher never replaces the reader\'s deal, contract or chart evidence unasked', p);
      }

      /* WS-13 and WS-14 — each restore names the control that takes the
         other files, the price restore says what it takes, and a saved
         snapshot's time on /my/data carries its zone. */
      {
        const r = await evaluate(`(async () => { ${W}
          const out = { fromBackup: importEverything(backupPayload()).err || 'accepted', fromEverything: restoreBackup(JSON.stringify(exportEverything())).error || 'accepted' };
          const rec = saveWork('property', 'WS14 deal');
          navigate('/my/data'); await w(150);
          const row = [...document.querySelectorAll('main table.dt tr')].find(tr => tr.textContent.includes('WS14 deal'));
          out.saved = { cell: row?.children[2]?.textContent.trim(), want: fmtSaved(rec.savedAt) };
          const made = [...document.querySelectorAll('main .card')].find(c => /Everything you have made/.test(c.querySelector('h3')?.textContent || ''));
          out.made = { samples: hasSeededData(), dl: !!made?.querySelector('dl dt'), nothing: /Nothing saved yet/.test(made?.textContent || ''), sampleNote: /A sample was written/.test(made?.textContent || '') };
          deleteWork(rec.id);
          const card = [...document.querySelectorAll('main .card')].filter(c => c.querySelector('input[type=file].input')).pop();
          out.card = { title: txt(card?.querySelector('h3')), text: txt(card) };
          const input = card?.querySelector('input[type=file]');
          if (input) {
            const dt = new DataTransfer(); dt.items.add(new File([JSON.stringify(exportEverything())], 'everything.json', { type: 'application/json' }));
            input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); await w(300);
            out.priceToast = document.getElementById('toast').textContent;
          }
          return out;
        })()`);
        const p13 = [], p14 = [];
        if (!/Restore from a backup/.test(r.fromBackup)) p13.push(`"Restore from a file" given a backup says "${r.fromBackup}"`);
        if (!/Restore from a file/.test(r.fromEverything)) p13.push(`"Restore from a backup" given an Export-everything file says "${r.fromEverything}"`);
        if (/^Restore an export$/.test(r.card.title) || !/Export these prices/.test(r.card.text)) p13.push(`the price-restore card reads "${r.card.title}" — "${r.card.text.slice(0, 120)}"`);
        if (!/Restore from a file/.test(r.priceToast || '')) p13.push(`the price restore given an Export-everything file says "${r.priceToast}"`);
        if (r.saved.cell !== r.saved.want || !/UTC$/.test(r.saved.cell || '')) p14.push(`Saved reads "${r.saved.cell}", want "${r.saved.want}"`);
        const p5 = [];
        if (r.made.samples) p5.push('samples are still held — the check is not testing the case');
        if (!r.made.dl || r.made.nothing) p5.push(`with the samples cleared, "Everything you have made": records listed ${r.made.dl}, "Nothing saved yet" ${r.made.nothing}`);
        report('WS-05', 'with the samples cleared, "Everything you have made" lists the reader\'s records and does not also say "Nothing saved yet"', p5);
        report('WS-13', 'each restore on /my/data names what it takes and points a sibling file to the control that takes it', p13);
        report('WS-14', 'a saved snapshot\'s time on /my/data names its zone', p14);
      }

      /* SHELL-02 and SHELL-03 — the public pages say what the product does:
         the wheel card is the worked example, labelled, with its inputs; the
         claims about the reader's circumstances are scoped. */
      {
        const r = await evaluate(`(async () => { ${W}
          navigate('/how-it-works'); await w(200);
          const card = [...document.querySelectorAll('.proof-card')].find(c => /Cash Wheel/.test(c.textContent));
          const out = { tag: txt(card?.querySelector('.proof-hd .proof-src')), card: txt(card), pages: {} };
          for (const path of ['/learn/product-boundaries', '/about', '/methodology/ips', '/corrections']) {
            navigate(path); await w(200);
            const t = txt(document.querySelector('main'));
            out.pages[path] = t.split(/(?<=[.!?])\\s+/).filter(s => /circumstances|your income/i.test(s)).map(s => s.slice(0, 220));
          }
          return out;
        })()`);
        const p2 = [], p3 = [];
        if (/figures you enter/i.test(r.tag) || !/worked example|illustrative/i.test(r.tag + ' ' + r.card)) p2.push(`the wheel card's source reads "${r.tag}"`);
        if (!/4\.42/.test(r.card) || !/5%/.test(r.card)) p2.push(`the card does not state the rate and buffer its ringgit line uses: "${r.card.slice(0, 240)}"`);
        for (const [path, ss] of Object.entries(r.pages)) {
          for (const s of ss) {
            if (/Any question about your income/i.test(s)) p3.push(`${path}: "${s}"`);
            else if (/asks nothing about your circumstances/i.test(s) && !/equity research/i.test(s)) p3.push(`${path}: "${s}"`);
          }
          if (ss.length && !ss.some(s => /loan-readiness/i.test(s))) p3.push(`${path} makes a claim about the reader's circumstances without naming the loan-readiness check`);
        }
        report('SHELL-02', 'the How it works wheel card is labelled as the worked example and states the rate and buffer behind its ringgit figure', p2);
        report('SHELL-03', 'no public page says the product asks nothing about the reader\'s circumstances without naming the loan-readiness check', p3);
      }

      /* WS-01 — a restored file whose values are not the shape this app
         writes is refused key by key, and a browser that already holds such
         a value (restored before this check existed) reads it as absent —
         the seeded lists as the reader's own and empty, as clearing the
         samples leaves them, not as the samples again: no page throws and
         the filings still load. */
      {
        const r = await evaluate(`(async () => { ${W}
          const doc = (data) => ({ format: 'quantum-tradeworks/user-data', version: 1, exportedAt: '2026-09-29T00:00:00Z', data });
          const LISTS = ['portfolios', 'theses', 'watchlists', 'observations', 'registerLog', 'corrections', 'opportunities', 'wheelLegs', 'priceAlerts', 'dividendsReceived', 'savedScreens', 'savedWork', 'runs', 'sarawakExposure', 'comparisons'];
          const MAPS = ['areaProfiles', 'demand', 'deal', 'wheelPlan', 'qttiPlan', 'manualPrices', 'userData', 'wht', 'reviews', 'borrowerProfile', 'valuation', 'scanSetups', 'scanAlertState', 'scanPrefs'];
          const bad = [];
          const accepted = (k, v) => { const x = importEverything(doc({ [k]: v })); return x.ok && x.incoming.includes(k); };
          LISTS.forEach(k => { if (accepted(k, { id: 'x' })) bad.push(k + ' as a record'); if (accepted(k, [1, 'x'])) bad.push(k + ' as a list of non-records'); });
          MAPS.forEach(k => { if (accepted(k, [])) bad.push(k + ' as a list'); if (accepted(k, 'x')) bad.push(k + ' as text'); });
          if (accepted('registerActor', 5)) bad.push('registerActor as a number');
          if (accepted('baseCcy', 'EUR')) bad.push('baseCcy as EUR');
          if (accepted('portfolios', [{ id: 'p', name: 'no holdings' }])) bad.push('a portfolio with no holdings list');
          if (accepted('portfolios', [])) bad.push('an empty portfolios list');
          const unknown = PORTABLE_KEYS.map(x => x.k).filter(k => ![...LISTS, ...MAPS, 'registerActor', 'baseCcy'].includes(k));
          const good = importEverything(doc({ baseCcy: 'MYR', registerActor: 'me', theses: seedTheses() }));
          const mixed = doc({ portfolios: { name: 'x', holdings: [] }, theses: seedTheses() });
          openRestoreDrawer(); await w(350);
          document.querySelector('#drawerBody textarea').value = JSON.stringify(mixed);
          [...document.querySelectorAll('#drawerBody button')].find(b => b.textContent.trim() === 'Check this file').click(); await w(80);
          const drawerText = txt(document.getElementById('drawerBody'));
          const restoreBtn = [...document.querySelectorAll('#drawerBody button')].map(b => b.textContent.trim()).find(t => /^Restore \\d/.test(t)) || null;
          closeDrawer({ restore: false }); await w(350);
          return { bad, unknown, good: good.ok && good.incoming.length === 3, drawerText, restoreBtn };
        })()`);
        const p = [];
        if (r.bad.length) p.push(`accepted for restore: ${r.bad.join(', ')}`);
        if (r.unknown.length) p.push(`PORTABLE_KEYS holds keys this check does not classify: ${r.unknown.join(', ')}`);
        if (!r.good) p.push('a file in the shapes this app writes was not accepted in full');
        if (!/Portfolios and holdings.{0,80}not restored/i.test(r.drawerText)) p.push(`the check drawer does not say the portfolios will not be restored: "${r.drawerText.slice(0, 300)}"`);
        if (r.restoreBtn !== 'Restore 1 item') p.push(`the drawer offers "${r.restoreBtn}" for a file with one readable key`);
        report('WS-01', 'a restore refuses, key by key and with the reason, any value that is not the shape this app writes', p);

        const BAD1 = { portfolios: { name: 'x', holdings: [] }, theses: { id: 't' }, priceAlerts: { id: 'x' }, watchlists: {}, observations: {}, savedWork: {}, runs: {},
          dividendsReceived: {}, registerLog: {}, comparisons: {}, savedScreens: {}, corrections: {}, sarawakExposure: {}, opportunities: {}, wheelLegs: {},
          deal: [], wheelPlan: [], qttiPlan: [], reviews: [], valuation: [], areaProfiles: [], demand: [], manualPrices: [], userData: [], wht: [],
          scanSetups: [], scanAlertState: [], scanPrefs: [], borrowerProfile: [], registerActor: 5, baseCcy: 'EUR' };
        const BAD2 = Object.fromEntries(['theses', 'priceAlerts', 'watchlists', 'observations', 'savedWork', 'runs', 'dividendsReceived', 'registerLog', 'comparisons',
          'savedScreens', 'corrections', 'sarawakExposure', 'opportunities', 'wheelLegs'].map(k => [k, [1, 'x', null]]));
        BAD2.portfolios = [{ id: 'p-bad', name: 'no holdings' }];
        const PAGES = ['/my/portfolio', '/my/theses', '/my/alerts', '/my/workspace', '/my/watchlists', '/my/data', '/property/calculator', '/us-options/wheel',
          '/research/trading-index', '/company/AAPL-SEC', '/compare', '/discover/screener', '/app'];
        for (const [name, BAD] of [['wrong types', BAD1], ['lists of non-records', BAD2]]) {
          wsErrors.length = 0;
          const seed = `${FRESH('pro')}; ${Object.entries(BAD).map(([k, v]) => `localStorage.setItem(${JSON.stringify('vl.' + k)}, ${JSON.stringify(JSON.stringify(v))})`).join('; ')}`;
          const loaded = await wsOpen('/app', seed);
          const boot = await evaluate(`({ ok: !!(typeof realStatus !== 'undefined' && realStatus && realStatus.ok), filed: typeof U === 'undefined' ? 0 : U.filter(r => r.c.real).length, h1: !!document.querySelector('main h1'),
            emptied: typeof State === 'undefined' ? null : [State.portfolios?.length === 1 && State.portfolios[0].id === 'pf-user' && !State.portfolios[0].holdings.length, (State.theses || []).length === 0, (State.priceAlerts || []).length === 0, (State.watchlists || []).length === 1 && !(State.watchlists[0].ids || []).length, !hasSeededData()] })`).catch(e => ({ threw: e.message }));
          const pages = [];
          for (const path of PAGES) {
            const at = wsErrors.length;
            const v = await evaluate(`(async () => { ${W} try { navigate(${JSON.stringify(path)}); } catch (e) { return 'threw: ' + e.message; } await w(150); return document.querySelector('main h1') ? 'ok' : 'no heading'; })()`).catch(e => `threw: ${e.message.split('\n')[0]}`);
            const errs = wsErrors.slice(at);
            if (v !== 'ok' || errs.length) pages.push(`${path}: ${v}${errs.length ? ` — ${errs[0]}` : ''}`);
          }
          const q = [];
          if (!loaded || !boot.ok || !boot.filed || !boot.h1) q.push(`the app with ${name} stored: loaded ${loaded}, ${JSON.stringify(boot)}${wsErrors.length ? ` — ${wsErrors[0]}` : ''}`);
          if (!boot.emptied || boot.emptied.includes(false)) q.push(`portfolios, cases, alerts and watchlists do not read as the reader's own and empty (${JSON.stringify(boot.emptied)})`);
          q.push(...pages);
          report('WS-01', `a browser already holding ${name} for the kept keys reads them as absent, the seeded lists as cleared: the filings load and no page throws`, q,
            `a browser already holding ${name} for every kept key reads them as absent, the seeded lists as cleared: the filings load and ${PAGES.length} pages draw with no error`);
        }
      }
    } catch (err) {
      fail('fixwave workspace: the checks stopped', String(err.message).split('\n')[0]);
    } finally {
      ws.removeEventListener('message', wsListen);
    }
  }
  /* ---- end fixwave: workspace ---- */
  /* ---- fixwave: equities ---- */
  /* THE 2026-09-29 SITE HUNT, EQUITIES. Twenty-one confirmed findings, each
     held here by the check that failed on the build they were found on
     (0e1119b) and passes on the fix: peers chosen in universe order and
     across kinds of data; a research-loop step that opened the seeded
     company and spent a report; a "largest differences" list of discounts
     only; a conversion on /compare with no rate; a sample price "entered by
     you"; a drawer toggle that went stale; a sort the keyboard could not
     reach; a "Clear all" that cleared nothing; toggles with no pressed
     state; one metric definition for every measure; a report naming half a
     summed line; a bank's cash flow called missing; a price card and a
     volume tile that contradicted the trend card; empty charts with no
     sentence; a free float that subtracted the institutions; charts of
     synthetic companies that never said so; a refused report with no
     heading, listed as viewed; a comparison cut silently; a change feed of
     states; "a insurer" and "1 companies". */
  const fwW = `const w = (ms) => new Promise(res => setTimeout(res, ms));
    const card = (re) => [...document.querySelectorAll('#views .card')].find(k => re.test(k.querySelector('h1, h2, h3, h4')?.textContent || ''));`;
  const fwKey = async (key) => {
    const K = { Enter: ['Enter', 13, '\r'], ' ': ['Space', 32, ' '] }[key];
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: K[0], windowsVirtualKeyCode: K[1], text: K[2] }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: K[0], windowsVirtualKeyCode: K[1] }, sessionId);
    await sleep(250);
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
  try {
    /* EQ-01 — the Snapshot's closest peers and the Business tab's peer set
       are one selection: the same business model and kind of data, the
       sector first, the market only to make up the number, nearest in
       revenue first, and the caption says which rule it used. EQ-24 — the
       peer buttons say when the plan's cap cuts the set. */
    {
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [], cut: [], cutSeen: [] };
        const kindOf = (x) => x.c.personal ? 'p' : x.c.real ? 'f' : 'i';
        const byTk = new Map(U.map(x => [x.c.tk, x]));
        const tkOf = (tr) => tr.querySelector('.tk')?.childNodes[0]?.textContent.trim() || null;
        const scale = (x) => { const v = convertTo(last(x.d.rev), x.c.ccy, 'USD'); return isNum(v) && v > 0 ? Math.log(v) : null; };
        for (const id of ['KO-SEC', 'AAPL-SEC', 'JPM-SEC', 'O-SEC', 'MAYBANK', 'PGR']) {
          const row = BY_ID.get(id); if (!row) { out.bad.push(id + ' is not in the universe'); continue; }
          const c = row.c;
          const kin = U.filter(x => x.c.id !== c.id && x.c.type === c.type && kindOf(x) === kindOf(row));
          const sec = kin.filter(x => c.sector !== 'Unclassified' && x.c.sector === c.sector);
          navigate(companyPath(c) + '?tab=snapshot'); await w(250);
          const pc = card(/^Closest peers$/);
          const snap = pc ? [...pc.querySelectorAll('tbody tr')].slice(1).map(tkOf) : [];
          const cap = pc ? pc.querySelector('p.caption').textContent : '';
          navigate(companyPath(c) + '?tab=business'); await w(250);
          const cp = card(/^Competitive position$/);
          const biz = cp ? [...cp.querySelectorAll('button.chip')].map(b => b.textContent.split(' · ')[0]) : [];
          out.seen.push(c.tk + ' [' + snap.join(' ') + ']');
          for (const [where, list, n] of [['Snapshot', snap, 5], ['Business tab', biz, 6]]) {
            const rows = list.map(t => byTk.get(t));
            if (rows.some(x => !x)) { out.bad.push(c.tk + ' ' + where + ': a ticker not in the universe: ' + list.join(',')); continue; }
            const off = rows.filter(x => !kin.includes(x)).map(x => x.c.tk + (x.c.real ? '' : ' (illustrative)'));
            if (off.length) out.bad.push(c.tk + ' ' + where + ': not the same business model and kind of data: ' + off.join(', '));
            const want = Math.min(n, kin.filter(x => sec.includes(x) || x.c.mkt === c.mkt).length);
            if (list.length !== want) out.bad.push(c.tk + ' ' + where + ': ' + list.length + ' peers where ' + want + ' qualify');
            const inSec = rows.filter(x => sec.includes(x)).length;
            if (inSec < Math.min(n, sec.length)) out.bad.push(c.tk + ' ' + where + ': ' + inSec + ' of the ' + sec.length + ' same-sector companies shown, the rest from outside the sector: ' + list.join(','));
            const k = rows.findIndex(x => !sec.includes(x));
            if (k >= 0 && rows.slice(k).some(x => sec.includes(x))) out.bad.push(c.tk + ' ' + where + ': a same-sector peer listed after one from outside it');
            const own = scale(row), d = (x) => { const s = scale(x); return isNum(own) && isNum(s) ? Math.abs(s - own) : Infinity; };
            const grp = rows.filter(x => sec.includes(x));
            if (grp.some((x, i) => i && d(x) < d(grp[i - 1]))) out.bad.push(c.tk + ' ' + where + ': not nearest in revenue first: ' + grp.map(x => x.c.tk).join(','));
          }
          if (snap.join() !== biz.slice(0, 5).join()) out.bad.push(c.tk + ': the Snapshot [' + snap.join(',') + '] and the Business tab [' + biz.join(',') + '] choose different peers');
          const outside = snap.some(t => !sec.includes(byTk.get(t)));
          if (!outside && !/and sector/.test(cap)) out.bad.push(c.tk + ': the caption does not state the rule applied: ' + cap);
          if (outside && !/and market/.test(cap)) out.bad.push(c.tk + ': peers from outside the sector, and the caption does not say so: ' + cap);
        }
        navigate(companyPath(BY_ID.get('KO-SEC').c) + '?tab=snapshot'); await w(250);
        const ko = card(/^Closest peers$/), koTk = ko ? [...ko.querySelectorAll('tbody tr')].slice(1).map(tkOf) : [];
        const miss = ['PEP', 'MDLZ', 'MO', 'PM'].filter(t => !koTk.includes(t));
        if (miss.length) out.bad.push('KO: the consumer-staples filers ' + miss.join(', ') + ' are not among its closest peers: ' + koTk.join(','));
        /* EQ-24: on Free (a comparison of two) the button names who left. */
        const keep = { plan: State.plan, log: JSON.stringify(State.reportLog), compare: [...State.compare] };
        const toasts = [], orig = window.toast;
        try {
          window.toast = (m) => { toasts.push(m); return orig(m); };
          State.plan = 'free'; State.reportLog = { month: meterMonth(), ids: [] };
          for (const [path, re] of [['?tab=snapshot', /Open full comparison/], ['?tab=business', /Open the full comparison/]]) {
            toasts.length = 0;
            navigate(companyPath(BY_ID.get('KO-SEC').c) + path); await w(250);
            [...document.querySelectorAll('#views button')].find(b => re.test(b.textContent))?.click(); await w(250);
            const cut = State.compare.length, said = toasts.join(' | ');
            out.cutSeen.push('Free ' + (path || 'snapshot') + ': ' + State.compare.join(',') + ' — ' + (said || 'no toast'));
            if (cut !== lim('compare') || !/left out/.test(said) || !/2 is the most/.test(said)) out.cut.push('Free, KO ' + (path || 'Snapshot') + ': the peer set was cut to ' + cut + ' with ' + (said ? '"' + said + '"' : 'nothing said'));
          }
        } finally {
          window.toast = orig;
          State.plan = keep.plan; State.reportLog = JSON.parse(keep.log); store.write('reportLog', State.reportLog);
          State.compare = keep.compare; store.write('compare', keep.compare);
        }
        return out;
      })()`);
      if (r.bad.length) fail('fixwave equities EQ-01: the Snapshot and the Business tab choose peers of the same model, kind and sector, and say how', r.bad.slice(0, 8));
      else ok(`fixwave equities EQ-01: the Snapshot's closest peers and the Business tab's peer set are one selection — same business model and kind of data, the sector first, the market only to make up the number, nearest in revenue — and the caption says which — ${r.seen.join('; ')}`);
      if (r.cut.length) fail('fixwave equities EQ-24: a peer comparison cut to the plan\'s cap says who left', r.cut);
      else ok(`fixwave equities EQ-24: both peer buttons, cut to the plan's cap on Free, say who left — ${r.cutSeen.join('; ')}`);
    }

    /* EQ-02 — the research loop's company steps never open the seeded
       company or spend a report: the way in with none opened, the last one
       opened with one, on its valuation tab. EQ-03 — the "largest
       differences" card lists the largest distances, either side. EQ-25 —
       the feed words a state as a state. */
    {
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [] };
        const keep = { plan: State.plan, log: JSON.stringify(State.reportLog), recent: [...(State.recentCompanies || [])], ticker: State.ticker };
        const step = (re) => [...document.querySelectorAll('#views li button')].find(b => re.test(b.textContent));
        try {
          State.plan = 'free'; State.reportLog = { month: meterMonth(), ids: [] }; State.recentCompanies = []; State.ticker = 'AAPL-SEC';
          for (const re of [/Build a valuation range/, /Inspect evidence/]) {
            navigate('/research/queue'); await w(300);
            step(re)?.click(); await w(300);
            const got = location.pathname + location.search;
            out.seen.push('fresh: ' + got);
            if (got !== '/research' || State.reportLog.ids.length || State.recentCompanies.length)
              out.bad.push('fresh browser, "' + re.source + '" opened ' + got + ', spent ' + JSON.stringify(State.reportLog.ids) + ', recent ' + JSON.stringify(State.recentCompanies));
          }
          const ms = BY_ID.get('MSFT-SEC');
          navigate(companyPath(ms.c)); await w(250);
          navigate('/research/queue'); await w(300);
          const b = step(/Build a valuation range/);
          const said = b ? b.textContent : '';
          b?.click(); await w(300);
          const got = location.pathname + location.search;
          out.seen.push('after MSFT: ' + got);
          if (got !== companyPath(ms.c) + '?tab=valuation' || !/MSFT/.test(said)) out.bad.push('after opening MSFT, "Build a valuation range" (' + said + ') opened ' + got);
        } finally {
          State.plan = keep.plan; State.reportLog = JSON.parse(keep.log); store.write('reportLog', State.reportLog);
          State.recentCompanies = keep.recent; store.write('recentCompanies', keep.recent); State.ticker = keep.ticker;
        }
        navigate('/research/queue'); await w(300);
        const dc = card(/^Largest differences between market price and model estimate$/);
        const shown = dc ? [...dc.querySelectorAll('button.row')].map(b => b.querySelector('span').textContent.trim() + ' ' + b.querySelector('.num').textContent.trim()) : [];
        const want = U.filter(x => x.val.mos && isNum(x.val.mos.base) && x.val.confBand !== 'Low')
          .sort((a, b) => Math.abs(b.val.mos.base) - Math.abs(a.val.mos.base)).slice(0, 5).map(x => x.c.tk + ' ' + withSign(x.val.mos.base, 0));
        out.seen.push('largest: ' + shown.join(', '));
        if (shown.join() !== want.join()) out.bad.push('the largest differences read ' + shown.join(', ') + ' where the largest distances are ' + want.join(', '));
        if (!want.some(t => /[−-]/.test(t.split(' ')[1]))) out.bad.push('no negative difference among the five largest to hold the check: ' + want.join(', '));
        const vals = buildFeed().filter(f => f.kind === 'valuation');
        const moved = vals.filter(f => /moved/.test(f.title)).map(f => f.title);
        if (!vals.length || moved.length) out.bad.push('the change feed says a company moved with no earlier value: ' + moved.slice(0, 2).join(' | '));
        else out.seen.push('feed: ' + vals[0].title);
        return out;
      })()`);
      if (r.bad.length) fail('fixwave equities EQ-02/EQ-03/EQ-25: the research queue neither picks a company nor lists one side, and its feed does not invent a change', r.bad);
      else ok(`fixwave equities EQ-02/EQ-03/EQ-25: the loop's company steps open the way in, or the last company opened on its valuation tab, and spend nothing; the largest differences are the largest either side; a discount is a state, not a move — ${r.seen.join('; ')}`);
    }

    /* EQ-04 — a conversion on /compare shows its rate and the toggle, not
       only a mixed one. EQ-15 — a bank's operating cash flow is not
       applicable there, as on the company page and the report. EQ-11 — the
       compare chips carry aria-pressed. */
    {
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [] };
        const keep = { base: State.baseCcy, ccy: State.compareCcy, compare: [...State.compare] };
        const cells = (re) => { const tr = [...document.querySelectorAll('#views table.dt tbody tr')].find(x => re.test(x.cells[0]?.textContent || '')); return tr ? [...tr.cells].slice(1).map(td => td.textContent.trim()) : null; };
        try {
          State.compareCcy = 'common';
          State.baseCcy = 'MYR';
          navigate('/compare?companies=KO-SEC,PEP-SEC'); await w(400);
          const rate = 'USD/MYR ' + FX.USDMYR.toFixed(4);
          const myr = { toggle: !!document.getElementById('cmp-ccy-common'), rate: document.getElementById('views').textContent.includes(rate), rev: cells(/^Revenue, latest year/) };
          out.seen.push('MYR: ' + JSON.stringify(myr));
          if (!myr.rev || !myr.rev.every(t => /^RM/.test(t)) || !myr.toggle || !myr.rate) out.bad.push('two USD reporters in MYR: totals ' + JSON.stringify(myr.rev) + ', toggle ' + myr.toggle + ', rate ' + myr.rate);
          State.baseCcy = 'USD'; render(); await w(300);
          const usd = { toggle: !!document.getElementById('cmp-ccy-common'), rev: cells(/^Revenue, latest year/) };
          if (!usd.rev || !usd.rev.every(t => /^\\$/.test(t)) || usd.toggle) out.bad.push('two USD reporters in USD: totals ' + JSON.stringify(usd.rev) + ', a currency bar ' + usd.toggle);
          const on = [...document.querySelectorAll('#views button[id^="cmp-chip-"]')];
          const wrong = on.filter(b => b.getAttribute('aria-pressed') !== String(State.compare.includes(b.id.slice(9))));
          if (!on.length || wrong.length) out.bad.push(wrong.length + ' of ' + on.length + ' compare chips do not say whether they are selected, e.g. ' + (wrong[0]?.textContent || '') + ' aria-pressed=' + wrong[0]?.getAttribute('aria-pressed'));
          for (const ids of ['CIMB,PBBANK', 'JPM-SEC,BAC-SEC']) {
            navigate('/compare?companies=' + ids); await w(350);
            const tr = [...document.querySelectorAll('#views table.dt tbody tr')].find(x => /^Operating cash flow/.test(x.cells[0]?.textContent || ''));
            const ocf = tr ? [...tr.cells].slice(1).map(td => td.textContent.trim() + (td.querySelector('[title]') ? ' [' + td.querySelector('[title]').title + ']' : '')) : null;
            out.seen.push(ids + ' OCF ' + (ocf ? ocf[0].slice(0, 60) : 'none'));
            if (!ocf || !ocf.every(t => t.startsWith(ABSENCE['not applicable'].short + ' [') && /deposit-taking/.test(t))) out.bad.push(ids + ': a bank\\'s operating cash flow reads ' + JSON.stringify(ocf));
          }
        } finally {
          State.baseCcy = keep.base; State.compareCcy = keep.ccy; State.compare = keep.compare; store.write('compare', keep.compare);
        }
        return out;
      })()`);
      if (r.bad.length) fail('fixwave equities EQ-04/EQ-11/EQ-15: /compare shows the rate of any conversion, says which chips are on, and calls a bank\'s cash flow not applicable', r.bad);
      else ok(`fixwave equities EQ-04/EQ-11/EQ-15: two USD reporters read in MYR show the rate and the toggle, and in USD neither; every compare chip carries aria-pressed; a bank's operating cash flow is not applicable — ${r.seen.join('; ')}`);
    }

    /* EQ-06 — a sample price is sourced as one. EQ-13 — a measure's
       definition drawer names its own period, source and normalisation.
       EQ-26 — the type is a noun with its article. */
    {
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [] };
        const dl = () => { const o = {}; const d = drawer.querySelector('dl.kv'); if (!d) return o; [...d.children].forEach((n, i, a) => { if (n.tagName === 'DT') o[n.textContent] = a[i + 1]?.textContent || ''; }); return o; };
        const shut = async () => { closeDrawer({ restore: false }); await w(250); };
        openSourceDrawer(BY_ID.get('MAYBANK'), FIELD_BY_K.pe); await w(300);
        const tr = [...drawer.querySelectorAll('tbody tr')].find(x => x.cells[0]?.textContent === 'price');
        const src = tr ? tr.cells[tr.cells.length - 1].textContent : null;
        out.seen.push('MAYBANK price: ' + src);
        if (!src || /entered by you/.test(src) || !/sample price/.test(src)) out.bad.push('MAYBANK\\'s sample price is sourced "' + src + '"');
        await shut();
        const info = async (k) => { openMetricInfo(FIELD_BY_K[k]); await w(250); const o = dl(); await shut(); return o; };
        const rs = await info('rs12'), pe = await info('pe'), roic = await info('roic');
        if (!/Trailing twelve months of observed closes/.test(rs['Reporting period'] || '') || /statement lines/.test(rs.Source || '') || !/closes/.test(rs.Source || '') || /stored lines/.test(rs.Normalisation || ''))
          out.bad.push('12-month price change: ' + JSON.stringify(rs).slice(0, 400));
        if (!/price/.test(pe.Source || '') || !/statement lines/.test(pe.Source || '')) out.bad.push('Price / earnings source: ' + pe.Source);
        if (/price/.test(roic.Source || '') || !/statement lines/.test(roic.Source || '')) out.bad.push('Return on invested capital source: ' + roic.Source);
        out.seen.push('rs12 period "' + rs['Reporting period'] + '"');
        const pgr = BY_ID.get('PGR'), early = U.find(x => x.c.type === 'early');
        const k = [...(INAPPLICABLE.insurer || []), ...(ALSO_INAPPLICABLE.insurer || [])][0];
        const st = metricStatus(pgr, k).text;
        if (!/for an insurer\\./.test(st)) out.bad.push('metricStatus on PGR: ' + st);
        for (const x of [pgr, early]) {
          navigate(companyPath(x.c) + '/report'); await w(300);
          const t = document.getElementById('views').textContent;
          const cov = (t.match(/measures that apply to [^.]*? are computable/) || [''])[0];
          out.seen.push(x.c.tk + ': ' + cov);
          if (!cov || / a (insurer|early)/.test(cov) || !/ an insurer | a pre-profit company /.test(cov)) out.bad.push(x.c.tk + ' report: "' + cov + '"');
          if (/ a insurer| a early/.test(t)) out.bad.push(x.c.tk + ' report still reads "a insurer" or "a early"');
        }
        return out;
      })()`);
      if (r.bad.length) fail('fixwave equities EQ-06/EQ-13/EQ-26: a sample price, a measure\'s definition and a business model are each said as what they are', r.bad);
      else ok(`fixwave equities EQ-06/EQ-13/EQ-26: an illustrative sample price is sourced as one, not "entered by you"; each measure's drawer names its own period, source and normalisation; "an insurer", "a pre-profit company" — ${r.seen.join('; ')}`);
    }

    /* EQ-09 — Enter and Space sort a screener header, and focus stays on
       it. EQ-10 — "Clear all" clears every filter shown. EQ-11 — the
       business-model chips carry aria-pressed. */
    {
      await evaluate(`(async () => { State.screen = blankScreen(); navigate('/discover/screener'); await new Promise(r => setTimeout(r, 400)); return true; })()`);
      const got = [];
      const th = await evaluate(`(() => { const th = [...document.querySelectorAll('#views th.sortable')].find(x => /^Value/.test(x.textContent)); if (!th) return null; th.focus(); return { sort: JSON.stringify(State.screen.sort), focused: document.activeElement === th }; })()`);
      got.push(th);
      await fwKey('Enter');
      got.push(await evaluate(`({ sort: JSON.stringify(State.screen.sort), focus: document.activeElement?.tagName + ' ' + document.activeElement?.textContent.trim() })`));
      await fwKey(' ');
      got.push(await evaluate(`({ sort: JSON.stringify(State.screen.sort), focus: document.activeElement?.tagName + ' ' + document.activeElement?.textContent.trim() })`));
      const bad = [];
      if (!th || !th.focused) bad.push('no focusable Value header');
      else {
        if (got[1].sort !== '{"k":"value","dir":-1}' || !/^TH Value/.test(got[1].focus)) bad.push(`Enter on the Value header: sort ${got[1].sort}, focus on ${got[1].focus}`);
        if (got[2].sort !== '{"k":"value","dir":1}' || !/^TH Value/.test(got[2].focus)) bad.push(`Space on the Value header: sort ${got[2].sort}, focus on ${got[2].focus}`);
      }
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [] };
        try {
          State.screen = blankScreen(); navigate('/discover/screener'); await w(350);
          const before = activeFilters(State.screen).map(a => a.label);
          [...document.querySelectorAll('#views button')].find(b => b.textContent.trim() === 'Clear all')?.click(); await w(300);
          const after = activeFilters(State.screen).map(a => a.label);
          const said = document.querySelector('#views h3.h-card')?.textContent || '';
          out.seen.push('Clear all: ' + before.join(' + ') + ' → ' + (after.join(' + ') || 'none') + ', "' + said + '"');
          if (!before.length || after.length || !/No filters applied/.test(document.getElementById('views').textContent)) out.bad.push('Clear all left ' + JSON.stringify(after) + ' of ' + JSON.stringify(before));
          const chips = () => { const lab = [...document.querySelectorAll('#views label.caption')].find(l => l.textContent === 'Business model'); return lab ? [...lab.parentElement.querySelectorAll('button.chip')] : []; };
          const unmarked = chips().filter(b => !['true', 'false'].includes(b.getAttribute('aria-pressed')));
          chips().find(b => b.textContent === 'bank')?.click(); await w(300);
          const bank = chips().find(b => b.textContent === 'bank');
          out.seen.push('bank chip aria-pressed=' + bank?.getAttribute('aria-pressed'));
          if (!chips().length || unmarked.length || bank?.getAttribute('aria-pressed') !== 'true' || chips().some(b => b !== bank && b.getAttribute('aria-pressed') !== 'false'))
            out.bad.push('business-model chips: ' + chips().map(b => b.textContent + '=' + b.getAttribute('aria-pressed')).join(', '));
        } finally { State.screen = blankScreen(); }
        return out;
      })()`);
      bad.push(...r.bad);
      if (bad.length) fail('fixwave equities EQ-09/EQ-10/EQ-11: the screener sorts from the keyboard, clears all, and says which chips are on', bad);
      else ok(`fixwave equities EQ-09/EQ-10/EQ-11: Enter and Space on a sortable header sort it and keep focus there; "Clear all" leaves no filter; the business-model chips carry aria-pressed — ${got.slice(1).map(g => g.sort).join(' then ')}; ${r.seen.join('; ')}`);
    }

    /* EQ-08 — the value map's drawer toggle reports the list after each
       press. EQ-18 — an empty watchlist says so on both charts. EQ-21 —
       an illustrative mark or tile says so, and the charts count them.
       EQ-26 — one company is "1 company". */
    {
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [] };
        const keep = { heat: State.heat.universe, radar: State.radar.universe, ids: [...activeWL().ids] };
        const text = () => document.getElementById('views').textContent;
        try {
          State.radar.universe = 'all'; navigate('/discover/value-map'); await w(350);
          const id = U.find(x => !x.c.real && x.val.mos && !State.watchlist.includes(x.c.id))?.c.id;
          openRadarDetail(id); await w(300);
          const btn = () => [...drawer.querySelectorAll('button')].find(b => /watchlist/i.test(b.textContent));
          const st = () => [btn()?.textContent, btn()?.getAttribute('aria-pressed'), State.watchlist.includes(id)].join(' / ');
          const s0 = st(); btn()?.click(); await w(250); const s1 = st(); btn()?.click(); await w(250); const s2 = st();
          closeDrawer({ restore: false }); await w(250);
          out.seen.push(id + ': ' + s0 + ' → ' + s1 + ' → ' + s2);
          if (s0 !== 'Add to watchlist / false / false' || s1 !== '✓ On your watchlist / true / true' || s2 !== s0) out.bad.push('value-map drawer toggle: ' + s0 + ' → ' + s1 + ' → ' + s2);
          const marks = [...document.querySelectorAll('#views svg g[role=button]')].map(g => g.getAttribute('aria-label'));
          const tkOf = (l) => l.split(',')[0].split(' ')[0];
          const byTk = new Map(U.map(x => [x.c.tk, x]));
          const quiet = marks.filter(l => byTk.get(tkOf(l)) && !byTk.get(tkOf(l)).c.real && !/, illustrative,/.test(l));
          if (!marks.length || quiet.length || !/illustrative — synthetic figures on sample prices/.test(text())) out.bad.push('value map: ' + quiet.length + ' of ' + marks.length + ' illustrative marks do not say so, e.g. ' + quiet[0]);
          State.heat.universe = 'all'; navigate('/discover?tab=heatmap'); await w(400);
          const tiles = [...document.querySelectorAll('#views svg g.tile[role=button]')].map(g => g.getAttribute('aria-label'));
          const quietT = tiles.filter(l => byTk.get(tkOf(l)) && !byTk.get(tkOf(l)).c.real && !/, illustrative,/.test(l));
          out.seen.push(tiles.length + ' tiles, e.g. ' + tiles[0]);
          if (!tiles.length || quietT.length || !/illustrative — synthetic figures on sample prices/.test(text())) out.bad.push('heatmap: ' + quietT.length + ' of ' + tiles.length + ' illustrative tiles do not say so, e.g. ' + quietT[0]);
          const ones = text().match(/\\b1 companies\\b/g);
          if (ones) out.bad.push('the heatmap reads "1 companies"');
          const panelOne = [...document.querySelectorAll('#views .metaline')].map(p => p.textContent).find(t => /^1 company · area scaled/.test(t));
          const hm = HEAT_MODES.find(m => m.id === State.heat.mode) || HEAT_MODES[0];
          const per = ['US', 'MY'].map(m => U.filter(x => x.c.mkt === m && isNum(x.m.mcap) && isNum(hm.get(x))).length);
          const oneGroup = per.every(k => k > 0) && per.includes(1);
          if (oneGroup && !panelOne) out.bad.push('a one-company panel does not read "1 company"');
          activeWL().ids = [];
          State.heat.universe = 'watchlist'; render(); await w(300);
          const h0 = text();
          State.radar.universe = 'watchlist'; navigate('/discover/value-map'); await w(350);
          const v0 = text(), vChart = !!document.querySelector('#views svg[aria-label^="Valuation against quality"]');
          const nm = '“' + activeWL().name + '” is empty';
          out.seen.push('empty list: ' + (h0.includes(nm) ? 'heatmap says so' : 'heatmap silent') + ', ' + (v0.includes(nm) && !vChart ? 'value map says so' : 'value map silent'));
          if (!h0.includes(nm)) out.bad.push('heatmap on an empty watchlist does not say it is empty');
          if (!v0.includes(nm) || vChart) out.bad.push('value map on an empty watchlist: sentence ' + v0.includes(nm) + ', empty chart drawn ' + vChart);
          /* A filer this build holds no price for: the owner's prices file prices
             AAPL, so a hard-coded AAPL could not test the case there. */
          const unpricedFiler = U.find(x => x.c.real && !isNum(x.c.px?.p))?.c.id || null;
          activeWL().ids = unpricedFiler ? [unpricedFiler] : [];
          render(); await w(300);
          const v1 = text();
          State.heat.universe = 'watchlist'; navigate('/discover?tab=heatmap'); await w(350);
          const h1 = text();
          if (!unpricedFiler) out.bad.push('this build holds no filer without a price to check the one-unpriced-company case with');
          else if (!/The one company on your active watchlist .* cannot be plotted/.test(v1) || !/The one company on your active watchlist .* cannot be drawn/.test(h1)) out.bad.push('a watchlist of one unpriced filer (' + unpricedFiler + '): the charts do not say none can be drawn');
        } finally {
          activeWL().ids = keep.ids; State.heat.universe = keep.heat; State.radar.universe = keep.radar;
        }
        return out;
      })()`);
      if (r.bad.length) fail('fixwave equities EQ-08/EQ-18/EQ-21/EQ-26: the value map and heatmap keep their toggle true, say when there is nothing to draw, and mark what is illustrative', r.bad);
      else ok(`fixwave equities EQ-08/EQ-18/EQ-21/EQ-26: the drawer toggle follows the list; an empty or unpriced watchlist is said, not drawn; every illustrative mark and tile says so and the charts count them; one company is "1 company" — ${r.seen.join('; ')}`);
    }

    /* EQ-14 — the report names both concepts of a summed line. EQ-20 —
       the ownership row is named for what it computes. EQ-23 — a refused
       report has a page heading and is not listed as viewed. */
    {
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [] };
        for (const id of ['AAPL-SEC', 'MSFT-SEC']) {
          const x = BY_ID.get(id);
          navigate(companyPath(x.c) + '/report'); await w(300);
          const tr = [...document.querySelectorAll('#views .rr-hist tbody tr')].find(t => /^Total debt/.test(t.cells[0].textContent));
          const kind = tr ? tr.cells[tr.cells.length - 1].textContent : null;
          const want = (lineConcept(x.c, 'debt', latestFy(x.c)) || '').split(' + ').filter(Boolean);
          out.seen.push(x.c.tk + ' debt: ' + kind);
          if (!kind || want.length < 2 || want.some(k => !kind.includes(k))) out.bad.push(x.c.tk + ' report: Total debt reads "' + kind + '" for ' + want.join(' + '));
        }
        navigate(companyPath(BY_ID.get('PGR').c) + '?tab=ownership'); await w(300);
        const own = document.getElementById('views').textContent;
        if (/Free float/.test(own) || !/Not held by insiders or institutions/.test(own)) out.bad.push('PGR ownership still names 100 − insiders − institutions a free float');
        const keep = { plan: State.plan, log: JSON.stringify(State.reportLog), recent: [...(State.recentCompanies || [])] };
        try {
          State.plan = 'free';
          State.reportLog = { month: meterMonth(), ids: ['KO-SEC', 'AAPL-SEC', 'MSFT-SEC', 'NVDA-SEC', 'PGR'] };
          State.recentCompanies = ['PGR', 'NVDA-SEC'];
          const g = BY_ID.get('GOOGL-SEC');
          for (const path of ['', '/report']) {
            navigate(companyPath(g.c) + path); await w(300);
            const h1 = [...document.querySelectorAll('#views h1')].map(h => h.textContent);
            out.seen.push('refused ' + (path || 'page') + ': h1 ' + JSON.stringify(h1));
            if (h1.length !== 1 || !h1[0].includes(g.c.name) || !/You have used all 5/.test(document.getElementById('views').textContent)) out.bad.push('the refused ' + (path || 'company page') + ' has h1 ' + JSON.stringify(h1));
          }
          if (State.recentCompanies[0] === 'GOOGL-SEC' || State.recentCompanies.includes('GOOGL-SEC')) out.bad.push('the refused GOOGL is listed as recently viewed: ' + State.recentCompanies.join(','));
        } finally {
          State.plan = keep.plan; State.reportLog = JSON.parse(keep.log); store.write('reportLog', State.reportLog);
          State.recentCompanies = keep.recent; store.write('recentCompanies', keep.recent);
        }
        return out;
      })()`);
      if (r.bad.length) fail('fixwave equities EQ-14/EQ-20/EQ-23: the report names a summed line whole, the ownership row its own sum, and a refused report its company without listing it as read', r.bad);
      else ok(`fixwave equities EQ-14/EQ-20/EQ-23: the report's Total debt names both concepts; the ownership row is "not held by insiders or institutions"; a refused company page and report each have an h1 and neither is listed as viewed — ${r.seen.join('; ')}`);
    }

    /* EQ-16 / EQ-17 — with observed closes held for a filer, the price
       card draws them rather than asking for a feed, and the volume tile
       gives the 50-day measure's own reason. A fixture in memory, not a
       file: 260 closes for MSFT and MAYBANK (1155), 30 days of volume for
       MSFT only. */
    {
      const r = await evaluate(`(async () => {
        ${fwW}
        const out = { bad: [], seen: [] };
        const keepT = trackedHistory;
        try {
          const dates = [];
          for (let d = new Date(Date.UTC(2025, 7, 1)); dates.length < 260; d = new Date(d.getTime() + 864e5)) { const k = d.getUTCDay(); if (k > 0 && k < 6) dates.push(d.toISOString().slice(0, 10)); }
          const s = Object.fromEntries(dates.map((d, i) => [d, 400 + Math.sin(i / 9) * 20 + i * 0.1]));
          const v = Object.fromEntries(dates.slice(-30).map((d, i) => [d, 2e7 + i * 1e5]));
          trackedHistory = { series: { MSFT: s, '1155': s }, volume: { MSFT: v } };
          refreshMomentum();
          const tile = () => [...document.querySelectorAll('#views .stat')].find(t => /Volume vs 50-day/.test(t.textContent))?.textContent || '';
          navigate(companyPath(BY_ID.get('MSFT-SEC').c) + '?tab=snapshot'); await w(400);
          const ms = tile(), pc = card(/^Price history$/);
          const pcText = pc ? pc.textContent : '';
          out.seen.push('MSFT volume: ' + ms + ' | price card chart ' + !!pc?.querySelector('svg'));
          if (!/needs 20 more/.test(ms) || /no volume column/.test(ms)) out.bad.push('MSFT with 30 days of volume: "' + ms + '"');
          if (!pc || /licensed feed\\. Everything/.test(pcText) || /Not available for this company/.test(pcText) || !pc.querySelector('svg') || !/260/.test(pcText)) out.bad.push('MSFT price card with 260 closes held: "' + pcText.slice(0, 160) + '"');
          navigate(companyPath(BY_ID.get('MAYBANK').c) + '?tab=snapshot'); await w(400);
          const mb = tile();
          out.seen.push('MAYBANK volume: ' + mb);
          if (!/carries no volume/.test(mb) || /needs 20/.test(mb)) out.bad.push('MAYBANK with no volume: "' + mb + '"');
        } finally { trackedHistory = keepT; refreshMomentum(); }
        return out;
      })()`);
      if (r.bad.length) fail('fixwave equities EQ-16/EQ-17: the price card and the volume tile agree with the closes held', r.bad);
      else ok(`fixwave equities EQ-16/EQ-17: a filer with closes held draws them in Price history, and the volume tile says how many days the 50-day ratio still needs, or that there is none — ${r.seen.join('; ')}`);
    }
  } finally {
    await send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
  }
  /* ---- end fixwave: equities ---- */
  /* ---- fixwave: scanner ---- */
  /* The scanner findings of the 2026-09-29 site hunt, on the scanner pages.
     Each check fails on 0e1119b. The pages run on this file's scanner seed
     (scanSeedP3) and on histories built here from the engine's fixture;
     everything is put back. Page code is written without template
     literals, so nothing in it is filled in by this file. */
  {
    const fwThrown = [];
    const fwListen = (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') fwThrown.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0]); };
    ws.addEventListener('message', fwListen);
    const fw = (body) => evaluate(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const main = () => document.querySelector('main');
      const text = () => main().innerText;
      const q = (lab) => [...main().querySelectorAll('[aria-label]')].find(n => n.getAttribute('aria-label') === lab);
      const set = (n, v) => { const proto = n.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, v); n.dispatchEvent(new Event('input', { bubbles: true })); n.dispatchEvent(new Event('change', { bubbles: true })); };
      const any = { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'price' }, op: 'GREATER_THAN', right: { value: 1 } }] };
      ${body}
    })()`);
    try {
      await evaluate(scanSeedP3);

      /* SCN-01. A yes-or-no left side offered every operator, and one
         switched to "crosses above" kept the builder's 1 — "… crosses above
         1", ready to save, which never holds. Only "is" is offered now; a
         setup saved before with another operator is reported on the list,
         its page and its edit page (refused, Save disabled), and its
         operator is shown as it is, never changed for the reader. */
      {
        const r = await fw(`
          const out = {};
          scanDraft = null; scanEditDraft = null; localStorage.removeItem('vl.scanSetups');
          navigate('/app/scanner/setups/new'); await w(200);
          set(q('Condition 1: left side'), 'cm_macd.above'); await w(80);
          out.ops = [...q('Condition 1: operator').options].filter(o => !o.disabled).map(o => o.value);
          out.sentence = main().querySelector('.scan-cond .scan-prose')?.textContent || '';
          const tree = { type: 'group', logic: 'ALL', children: [{ type: 'condition', left: { indicator: 'cm_macd', field: 'above' }, op: 'CROSSES_ABOVE', right: { value: 1 } }] };
          const at = '2026-09-01T00:00:00Z';
          localStorage.setItem('vl.scanSetups', JSON.stringify({ schema: 1, exported: null, setups: { 'fw-old-flag': { id: 'fw-old-flag', name: 'Old flag crossing', enabled: true, created: at, updated: at, deleted: null, current: 1,
            versions: [{ version: 1, savedAt: at, hash: 'h', source: 'builder', setup: { timeframe: '1D', universe: { kind: 'symbols', symbols: ['MATCH'] }, confirmationMode: 'BAR_CLOSE', cooldownMode: 'NEW_MATCH', cooldownBars: 0, expires: null, ruleTree: tree } }] } } }));
          navigate('/app/scanner/setups'); await w(150);
          out.listNote = main().querySelector('.scan-refused')?.textContent || '';
          navigate('/app/scanner/setups/fw-old-flag'); await w(150);
          out.pageNote = main().querySelector('.scan-refused')?.textContent || '';
          navigate('/app/scanner/setups/fw-old-flag/edit'); await w(200);
          const op = q('Condition 1: operator');
          out.editOp = op ? { value: op.value, disabled: !!op.selectedOptions[0]?.disabled, enabled: [...op.options].filter(o => !o.disabled).map(o => o.value) } : null;
          const pr = main().querySelector('.scan-cond .scan-problems');
          out.problem = pr && !pr.hidden ? pr.textContent : '';
          out.saveDisabled = [...main().querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Save'))?.disabled;
          out.stored = JSON.parse(localStorage.getItem('vl.scanSetups')).setups['fw-old-flag'].versions[0].setup.ruleTree.children[0].op;
          scanEditDraft = null; scanDraft = null; localStorage.removeItem('vl.scanSetups');
          return out;
        `);
        const p = [];
        if (JSON.stringify(r.ops) !== '["EQUALS"]') p.push(`a yes-or-no left side offers ${r.ops.join(', ')}`);
        if (!/is true$/.test(r.sentence)) p.push(`the condition reads "${r.sentence}"`);
        if (!/yes-or-no reading/.test(r.listNote) || !/yes-or-no reading/.test(r.pageNote)) p.push(`a saved "crosses above 1" on a flag is not reported: list "${r.listNote}", page "${r.pageNote}"`);
        if (!r.editOp || r.editOp.value !== 'CROSSES_ABOVE' || !r.editOp.disabled || JSON.stringify(r.editOp.enabled) !== '["EQUALS"]') p.push(`its edit page's operator: ${JSON.stringify(r.editOp)}`);
        if (!/yes-or-no reading/.test(r.problem) || r.saveDisabled !== true) p.push(`its edit page's problem "${r.problem}", Save disabled: ${r.saveDisabled}`);
        if (r.stored !== 'CROSSES_ABOVE') p.push(`the stored operator became ${r.stored}`);
        if (p.length) fail('fixwave SCN-01: a yes-or-no reading is asked only "is true" or "is false" in the builder, and a setup saved with another operator on one is reported, not changed', p);
        else ok('fixwave SCN-01: a yes-or-no reading is asked only "is true" or "is false" in the builder — the only operator offered — and a setup saved with "crosses above 1" on one is reported on the list, its page and its edit page, which shows its operator as refused, disables Save and changes nothing');
      }

      /* SCN-04. The builder's sentence said "52-week high" of any 252-bar
         window: a monthly condition's is 252 months, and a daily setup's is
         252 sessions until an instrument says which market. */
      {
        const r = await fw(`
          const out = {};
          scanDraft = null;
          navigate('/app/scanner/setups/new'); await w(200);
          set(q('Condition 1: operator'), 'GREATER_THAN'); await w(60);
          set(q('Condition 1: right side'), 'high_n'); await w(60);
          out.daily = main().querySelector('.scan-cond .scan-prose')?.textContent || '';
          set(q('Condition 1: timeframe'), '1M'); await w(60);
          out.monthly = main().querySelector('.scan-cond .scan-prose')?.textContent || '';
          scanDraft = null;
          return out;
        `);
        if (!/252-session high/.test(r.daily) || !/252-month high/.test(r.monthly) || /52-week/.test(r.daily + r.monthly)) fail('fixwave SCN-04: the builder names a 252-bar window by the bars it reads', r);
        else ok(`fixwave SCN-04: the builder names a 252-bar window by the bars it reads — "${r.daily}"; on a monthly condition, "${r.monthly}"`);
      }

      /* SCN-02 and SCN-14. A weekly record read from imported weekly bars
         was compared with the daily close under its date: its own page
         said it reproduced, then listed its own bar as a close that
         differed, and every daily alert on the symbol listed it too. Each
         record is compared with the bars of its own timeframe. And one
         differing close read "has a close that differ"; a record with no
         engine or version printed "engine ?" and "v?". */
      {
        const r = await fw(`
          const out = {};
          const fx = scanFixture();
          const h = JSON.parse(JSON.stringify(fx.history));
          const weeks = {};
          Object.keys(h.series.MATCH).sort().forEach(d => { weeks[scanWeekOf(d)] = Math.round(h.series.MATCH[d] * 200) / 100; });
          h.frames = { '1W': { MATCH: { series: weeks, meta: {} } } };
          const wk = { id: 'fw-weekly', name: 'FW weekly', version: 1, enabled: true, universe: { kind: 'symbols', symbols: ['MATCH'] }, timeframe: '1W', cooldownMode: 'EVERY_MATCH', cooldownBars: 0, ruleTree: any };
          const dy = { ...wk, id: 'fw-daily', name: 'FW daily', timeframe: '1D' };
          let alerts = [];
          Object.keys(h.series.MATCH).sort().slice(-8).forEach(d => { const run = scanRun([wk, dy], h, { existing: alerts, asOf: d, now: scanReplayNow(d), runId: 'fw-' + d, origin: 'replay' }); alerts = alerts.concat(run.alerts); });
          const weekly = alerts.filter(a => a.setupId === 'fw-weekly'), daily = alerts.filter(a => a.setupId === 'fw-daily');
          out.counts = [weekly.length, daily.length];
          scanHistoryFile = h; scanAlertsFile = { alerts, lastRun: null };
          const read = async (a) => { navigate(scanAlertPath(a)); await w(150);
            return { bar: scanAlertBar(a), diffs: [...main().querySelectorAll('.scan-close-diffs li')].map(li => li.textContent),
                     line: [...main().querySelectorAll('.metaline')].map(x => x.textContent).find(t => t.includes('from the record') || t.startsWith('No close the record holds')) || '',
                     verdict: main().querySelector('.scan-reproduce')?.textContent || '' }; };
          out.weekly = await read(weekly[weekly.length - 1]);
          out.daily = await read(daily[daily.length - 1]);
          /* One daily close changed since it was recorded. */
          const moved = daily[daily.length - 3];
          h.series.MATCH[moved.candleDate] = h.series.MATCH[moved.candleDate] + 1;
          out.one = await read(daily[daily.length - 1]);
          /* A record with an id and no engine or version. */
          const bare = { ...daily[daily.length - 1], id: 'afw00bare', key: 'fw-bare-key' };
          delete bare.engine; delete bare.setupVersion;
          alerts.push(bare);
          navigate('/app/scanner/alerts/afw00bare'); await w(150);
          out.lineage = [...main().querySelectorAll('.scan-lineage li')].map(li => li.textContent);
          return out;
        `);
        const p = [];
        if (r.counts[0] < 1 || r.counts[1] < 2) p.push(`the seed recorded ${r.counts[0]} weekly and ${r.counts[1]} daily alerts`);
        if (r.weekly.diffs.length || !/^No close the record holds/.test(r.weekly.line) || !/^Reproduces/.test(r.weekly.verdict)) p.push(`the weekly alert of ${r.weekly.bar}: ${r.weekly.verdict.slice(0, 60)} | ${r.weekly.line} ${JSON.stringify(r.weekly.diffs)}`);
        if (r.daily.diffs.length) p.push(`the daily alert of ${r.daily.bar} lists ${JSON.stringify(r.daily.diffs)}`);
        if (!/^1 bar up to \S+ has a close that differs from the record:$/.test(r.one.line) || r.one.diffs.length !== 1) p.push(`one close moved: "${r.one.line}" ${JSON.stringify(r.one.diffs)}`);
        const eng = r.lineage.find(t => /evaluated setup/.test(t)) || '';
        if (/engine \?|v\?/.test(eng) || !/not recorded/.test(eng)) p.push(`lineage: "${eng}"`);
        if (p.length) fail('fixwave SCN-02/SCN-14: an alert\'s closes are compared on its own timeframe, one differing close reads in the singular, and a missing engine says it is not recorded', p);
        else ok(`fixwave SCN-02/SCN-14: a weekly record read from imported weeks is compared with its week's close, not the daily close of its date — its page and a daily alert's list no differing close; one close moved reads "${r.one.line}"; a record with no engine or version says so ("${eng.slice(0, 80)}…")`);
      }

      /* SCN-06. Market screening and Historical offered the setups file,
         the builder's draft and a pasted setup — not the setups saved in
         this browser, which the Setups page calls "Your setups"; with no
         file (the published site) a saved setup could only be pasted. */
      {
        const r = await fw(`
          const out = {};
          localStorage.removeItem('vl.scanSetups'); scanDraft = null;
          const saved = scanSaveSetup({ id: 'fw-saved', name: 'FW saved here', enabled: true, universe: { kind: 'all' }, timeframe: '1D', cooldownMode: 'NEW_MATCH', ruleTree: any });
          out.saved = saved.ok;
          const pick = () => { const s = document.getElementById('scan-setup-pick'); return s ? [...s.options].map(o => ({ v: o.value, t: o.textContent, g: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : '' })) : null; };
          navigate('/app/scanner/market'); await w(200);
          out.market = pick();
          out.note = document.getElementById('scan-setup-pick')?.parentElement.querySelector('.metaline')?.textContent || '';
          navigate('/app/scanner/backtest'); await w(200);
          out.backtest = pick();
          const keepF = scanSetupsFile; scanSetupsFile = null;
          navigate('/app/scanner/market'); await w(200);
          out.hosted = pick();
          scanSetupsFile = keepF;
          localStorage.removeItem('vl.scanSetups');
          return out;
        `);
        const has = (list) => (list || []).some(o => o.v === 'saved:fw-saved' && o.g === 'Saved in this browser' && /FW saved here \(v1, saved here\)/.test(o.t));
        if (!r.saved || !has(r.market) || !has(r.backtest) || !has(r.hosted) || !/the setups saved in this browser/.test(r.note)) fail('fixwave SCN-06: a setup saved in this browser is offered by Market screening and Historical', r);
        else ok('fixwave SCN-06: a setup saved in this browser is offered by Market screening and Historical, in a group of its own beside the file\'s — and with no setups file, as on the published site');
      }

      /* SCN-08. A rename saved here left the setup "in step" with the
         file, which still named it the old way in every match the worker
         recorded; nothing asked for the export. */
      {
        const r = await fw(`
          const out = {};
          localStorage.removeItem('vl.scanSetups'); scanEditDraft = null;
          const keepF = scanSetupsFile;
          const base = { id: 'fw-named', name: 'Nested breakout', version: 1, enabled: true, universe: { kind: 'all' }, timeframe: '1D', cooldownMode: 'NEW_MATCH', ruleTree: any };
          scanSetupsFile = { setups: [base] };
          scanAdoptFromFile('fw-named');
          out.before = scanDriftRows().find(x => x.id === 'fw-named')?.state;
          navigate('/app/scanner/setups/fw-named/edit'); await w(200);
          set(q('Name'), 'Nested breakout renamed'); await w(60);
          [...main().querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Save')).click(); await w(250);
          out.toast = document.getElementById('toast')?.textContent || '';
          const row = scanDriftRows().find(x => x.id === 'fw-named');
          out.visible = { state: row?.state, text: row?.text };
          navigate('/app/scanner/setups'); await w(150);
          out.allInStep = /in step with data\\/scan-setups\\.json\\./.test(text());
          scanSetupsFile = null;
          scanMarkExported(scanExportDoc());
          out.exported = scanDriftRows().find(x => x.id === 'fw-named')?.state;
          scanSaveSetup({ ...base, name: 'Renamed again' });
          const hosted = scanDriftRows().find(x => x.id === 'fw-named');
          out.hosted = { state: hosted?.state, text: hosted?.text };
          scanSetupsFile = keepF; scanEditDraft = null; localStorage.removeItem('vl.scanSetups');
          return out;
        `);
        const p = [];
        if (r.before !== 'IN_STEP') p.push(`adopted: ${r.before}`);
        if (!/export to tell the worker/.test(r.toast)) p.push(`toast "${r.toast}"`);
        if (r.visible.state !== 'NOT_EXPORTED' || !/Renamed here/.test(r.visible.text || '') || !/“Nested breakout”/.test(r.visible.text || '') || r.allInStep) p.push(`file visible: ${JSON.stringify(r.visible)}, the card says all in step: ${r.allInStep}`);
        if (r.exported !== 'UNCONFIRMED' || r.hosted.state !== 'NOT_EXPORTED' || !/Renamed here since the export/.test(r.hosted.text || '') || !/“Nested breakout renamed”/.test(r.hosted.text || '')) p.push(`file not visible: exported ${r.exported}, then ${JSON.stringify(r.hosted)}`);
        if (p.length) fail('fixwave SCN-08: a setup renamed here asks for the export that tells the worker its name', p);
        else ok('fixwave SCN-08: a setup renamed here asks for the export that tells the worker its name — with the file visible it is not exported ("Renamed here …"), with it not visible the rename since the last export is named, and the save says to export');
      }

      /* SCN-09. Data health never looked at the imported weekly and
         monthly bars, and said "Nothing to look at" with a recorded split
         inside them that makes the engine refuse them. */
      {
        const r = await fw(`
          const out = {};
          const keepA = scanAdjustmentsFile, keepH = scanHistoryFile;
          const fx = scanFixture();
          const h = JSON.parse(JSON.stringify(fx.history));
          const weeks = {};
          Object.keys(h.series.MATCH).sort().forEach(d => { weeks[scanWeekOf(d)] = h.series.MATCH[d]; });
          h.frames = { '1W': { MATCH: { series: weeks, meta: {} } } };
          scanHistoryFile = h; scanAdjustmentsFile = { schema: 1, actions: [{ symbol: 'MATCH', date: '2026-02-02', ratio: 1.001, kind: 'split' }] };
          navigate('/admin/scanner/data'); await w(250);
          const sec = main().querySelector('section[aria-label="Weekly and monthly bars"]');
          out.section = sec ? sec.innerText : '';
          out.tile = text().includes('Imported weekly and monthly bars');
          out.look = (text().match(/(\\d+) of (\\d+) series have something to look at/) || []).slice(1).map(Number);
          scanAdjustmentsFile = keepA; scanHistoryFile = keepH;
          return out;
        `);
        if (!/MATCH/.test(r.section) || !/not read/.test(r.section) || !/split of ratio 1\.001 on 2026-02-02/.test(r.section) || !r.tile || !(r.look[0] >= 1)) fail('fixwave SCN-09: Data health counts the imported weekly and monthly bars and names a frame the engine refuses', r);
        else ok(`fixwave SCN-09: Data health counts the imported weekly and monthly bars and names a frame the engine refuses — MATCH's weekly bars, not read for the split recorded inside them; ${r.look[0]} of ${r.look[1]} series have something to look at`);
      }

      /* SCN-10 and SCN-12. The dashboard's tile said "No channel" beside a
         Settings page saying one exists, in the app; three addresses the
         record does not hold had no h1. */
      {
        const r = await fw(`
          const out = { h1: {} };
          navigate('/app/scanner'); await w(150);
          out.tile = [...main().querySelectorAll('.scan-q')].find(t => t.textContent.includes('notifications working'))?.innerText || '';
          navigate('/admin/scanner'); await w(150);
          out.ops = text().includes('No channel');
          for (const p of ['/app/scanner/setups/nope', '/app/scanner/setups/nope/edit', '/app/scanner/alerts/a12345678']) { navigate(p); await w(120); out.h1[p] = [...main().querySelectorAll('h1')].map(x => x.textContent); }
          return out;
        `);
        const p = [];
        if (!/In-app only/.test(r.tile) || /No channel/.test(r.tile) || !/One channel exists: in the app/.test(r.tile) || r.ops) p.push(`the notifications tile: "${r.tile.replace(/\n/g, ' | ')}"; the overview says No channel: ${r.ops}`);
        Object.entries(r.h1).forEach(([k, v]) => { if (v.length !== 1 || !/^No (setup|alert) /.test(v[0])) p.push(`${k}: h1 ${JSON.stringify(v)}`); });
        if (p.length) fail('fixwave SCN-10/SCN-12: the notifications tile names the in-app channel, and every scanner address has one h1', p);
        else ok('fixwave SCN-10/SCN-12: the notifications tile names the one channel there is, in the app, as Settings does; an address naming a setup or an alert the record does not hold has one h1');
      }

      /* SCN-13. A button's accessible name holds its visible words: the
         disabled "The limit is 20 conditions" was named "Add a condition",
         and "Copy JSON", "Adopt from file" and "New setup on this list"
         were named otherwise. */
      {
        const r = await fw(`
          const out = { mismatch: [] };
          const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          const holds = (name, seen) => { const a = words(name), b = words(seen); if (!b.length) return true; for (let i = 0; i + b.length <= a.length; i++) if (b.every((x, j) => a[i + j] === x)) return true; return false; };
          const check = (where) => [...main().querySelectorAll('button[aria-label], a[aria-label]')].filter(b => b.getClientRects().length && b.textContent.trim())
            .filter(b => !holds(b.getAttribute('aria-label'), b.textContent.trim())).forEach(b => out.mismatch.push(where + ': "' + b.textContent.trim() + '" is named "' + b.getAttribute('aria-label') + '"'));
          scanDraft = null; localStorage.removeItem('vl.scanSetups');
          navigate('/app/scanner/setups/new'); await w(150);
          for (let i = 0; i < 25; i++) { const b = q('Add a condition'); if (!b || b.disabled) break; b.click(); await w(20); }
          const full = [...main().querySelectorAll('button')].find(b => b.textContent.trim().startsWith('The limit is'));
          out.limit = full ? { text: full.textContent.trim(), name: full.getAttribute('aria-label'), disabled: full.disabled } : null;
          check('builder');
          scanDraft = null;
          navigate('/app/scanner/setups'); await w(150);
          check('setups');
          navigate('/app/scanner/watchlists'); await w(150);
          check('watchlists');
          return out;
        `);
        const p = [...r.mismatch];
        if (!r.limit || !r.limit.disabled || (r.limit.name && r.limit.name !== r.limit.text)) p.push(`the condition limit: ${JSON.stringify(r.limit)}`);
        if (p.length) fail('fixwave SCN-13: every scanner button\'s accessible name holds its visible words', p);
        else ok(`fixwave SCN-13: every button on the builder, the setups and the watchlists pages is named with its visible words — the disabled "${r.limit.text}" among them`);
      }
      if (fwThrown.length) fail('fixwave scanner: the pages threw', fwThrown.slice(0, 5));
    } catch (err) {
      fail('fixwave scanner: the checks stopped', String(err.message).split('\n')[0]);
    } finally {
      ws.removeEventListener('message', fwListen);
      await evaluate(scanRestoreP3).catch(() => {});
    }
  }
  /* ---- end fixwave: scanner ---- */

  /* ---- audit: quality ---- */
  /* The launch audit's Q3: the search box and the screener, as a screen
     reader and a keyboard are given them. The search said nothing when its
     list appeared; a segmented choice said which option was on with
     aria-selected, which is not allowed on a button and which a screen
     reader drops (Lighthouse failed aria-allowed-attr on the screener and
     the calculator); the screener's strips of choices were unnamed, its
     sort arrows were read as part of every header, "Hide medians" said
     pressed beside words saying hide, and a count a filter changed was
     not said. Every state is put back. */
  {
    const aq = (body) => evaluate(`(async () => {
      const w = (ms) => new Promise(r => setTimeout(r, ms));
      const main = () => document.querySelector('main');
      const nameOf = (n) => { const lb = n.getAttribute('aria-labelledby');
        return ((n.getAttribute('aria-label') || '') || (lb ? lb.split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ') : '')).trim(); };
      ${body}
    })()`);
    try {
      /* The search box is named, described, and says its count. */
      {
        const r = await aq(`
          const out = {};
          const i = document.getElementById('searchInput'), st = document.getElementById('searchStatus');
          const hint = document.getElementById(i.getAttribute('aria-describedby') || '');
          out.named = !!(i.getAttribute('aria-label') || '').trim();
          out.hint = hint ? hint.textContent.trim() : '';
          out.controls = i.getAttribute('aria-controls') === 'searchResults' && !!document.getElementById('searchResults');
          out.role = st ? st.getAttribute('role') : null;
          if (!st) return out;
          navigate('/discover/screener'); await w(300);
          openSearch(); await w(250);
          const typeInto = async (t) => { i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); await w(450); };
          await typeInto('bank');
          out.bank = { said: st.textContent, rows: searchResults.querySelectorAll('button').length };
          await typeInto('zzqxv');
          out.none = st.textContent;
          await typeInto('');
          out.empty = st.textContent;
          await typeInto('bank');
          closeSearch(); await w(350);
          out.closed = st.textContent;
          i.value = '';
          return out;
        `);
        const p = [];
        if (!r.named) p.push('the search box has no name');
        if (!r.hint) p.push('the search box is described by nothing');
        if (!r.controls) p.push('the search box does not name the list it controls');
        if (r.role !== 'status') p.push(`the search's status line is ${r.role === null ? 'missing' : 'role ' + r.role}`);
        const m = /^(\d+) (?:of \d+ matches shown|match(?:es)?)\b/.exec(r.bank?.said || '');
        if (r.role === 'status' && (!m || Number(m[1]) !== r.bank.rows)) p.push(`"bank" listed ${r.bank?.rows} companies and the status said "${r.bank?.said}"`);
        if (r.role === 'status' && r.none !== 'Nothing matches that search.') p.push(`a search that matches nothing said "${r.none}"`);
        if (r.role === 'status' && (r.empty || r.closed)) p.push(`an empty box or a closed search still says "${r.empty || r.closed}"`);
        if (p.length) fail('audit quality Q3: the search box is not described, or its count is not said', p);
        else ok(`audit quality Q3: the search box is named, described and says its count — "${r.bank.said}" for "bank"`);
      }

      /* The screener: named strips, pressed states, headers read without
         their arrows, a medians action that is not a toggle, and a count
         said when a filter moves it. */
      {
        const r = await aq(`
          const out = {};
          navigate('/discover/screener'); await w(400);
          const segs = [...main().querySelectorAll('.segmented')].filter(s => s.querySelector('button:not([role=tab])'));
          out.segs = segs.length;
          out.unnamed = segs.filter(s => s.getAttribute('role') !== 'group' || !nameOf(s)).map(s => s.textContent.trim().slice(0, 40));
          out.unpressed = segs.flatMap(s => [...s.querySelectorAll('button:not([role=tab])')]).filter(b => !/^(true|false)$/.test(b.getAttribute('aria-pressed') || '')).map(b => b.textContent.trim());
          const bm = [...main().querySelectorAll('[role=group]')].find(g => nameOf(g) === 'Business model');
          out.bm = bm ? bm.querySelectorAll('button[aria-pressed]').length : 0;
          out.arrowsRead = [...main().querySelectorAll('th')].filter(th => { const c = th.cloneNode(true);
            c.querySelectorAll('[aria-hidden=true]').forEach(x => x.remove()); return /[▲▼↕]/.test(c.textContent); }).map(th => th.textContent.trim().slice(0, 30));
          out.sortable = main().querySelectorAll('th .sort-ind').length;
          out.medians = document.getElementById('scr-medians')?.getAttribute('aria-pressed') ?? null;
          const on = main().querySelector('.segmented button[aria-pressed=true]');
          const off = on && on.parentElement.querySelector('button[aria-pressed=false]');
          out.styled = !!(on && off) && getComputedStyle(on).backgroundColor !== getComputedStyle(off).backgroundColor
            && getComputedStyle(on).fontWeight !== getComputedStyle(off).fontWeight;
          const head = () => [...main().querySelectorAll('h3')].map(h => h.textContent).find(t => / companies match$/.test(t)) || '';
          const chip = () => bmChip();
          const bmChip = () => [...main().querySelectorAll('[role=group] button[aria-pressed]')].find(b => b.textContent.trim() === 'bank');
          const before = head();
          bmChip()?.click(); await w(350);
          out.after = head(); out.said = document.getElementById('liveStatus')?.textContent || '';
          out.liveRole = document.getElementById('liveStatus')?.getAttribute('role') || null;
          bmChip()?.click(); await w(350);
          out.restored = head() === before;
          return out;
        `);
        const p = [];
        if (!r.segs) p.push('no segmented strip found on the screener');
        if (r.unnamed.length) p.push(`strips with no group name: ${r.unnamed.join(' / ')}`);
        if (r.unpressed.length) p.push(`segmented buttons with no pressed state: ${r.unpressed.join(', ')}`);
        if (!r.bm) p.push('the business-model chips are not a group named "Business model"');
        if (!r.sortable || r.arrowsRead.length) p.push(`sort arrows read as part of ${r.arrowsRead.length} header name(s): ${r.arrowsRead.slice(0, 3).join(', ')}`);
        if (r.medians !== null) p.push(`"Hide/Show medians" says aria-pressed=${r.medians} while its words say what a press does`);
        if (!r.styled) p.push('a pressed segment looks like the others — the style did not follow aria-pressed');
        if (r.liveRole !== 'status' || !r.after || r.said !== r.after) p.push(`a filter moved the count to "${r.after}" and the live region said "${r.said}"`);
        if (!r.restored) p.push('the business-model chip was not put back');
        if (p.length) fail('audit quality Q3: the screener\'s controls are not named, or their state is not said', p);
        else ok(`audit quality Q3: the screener's ${r.segs} strips are named groups with pressed states, headers read without arrows, and "${r.said}" is said when a filter moves it`);
      }

      /* No aria-selected where it is not allowed, on the pages that carry
         segmented strips. */
      {
        const pages = ['/discover/screener', '/property/calculator', '/property/areas', '/compare?companies=MSFT-SEC,AAPL-SEC',
          '/company/aapl-apple-inc?tab=financials', '/my/workspace', '/discover?tab=heatmap', '/discover?tab=ideas', '/app/scanner',
          '/admin/scanner/jobs', '/', '/pricing', '/app'];
        const r = await aq(`
          const out = {};
          for (const p of ${JSON.stringify(pages)}) {
            navigate(p); await w(300);
            const bad = [...document.querySelectorAll('[aria-selected]')]
              .filter(n => !/^(tab|option|row|gridcell|columnheader|rowheader|treeitem)$/.test(n.getAttribute('role') || ''));
            if (bad.length) out[p] = bad.slice(0, 3).map(n => n.tagName + ':' + n.textContent.trim().slice(0, 30));
          }
          navigate('/discover/screener'); await w(200);
          return out;
        `);
        const where = Object.entries(r);
        if (where.length) fail(`audit quality: aria-selected on an element whose role does not allow it, on ${where.length} page(s)`, r);
        else ok(`audit quality: no element carries aria-selected where its role does not allow it, across ${pages.length} pages`);
      }
    } catch (err) {
      fail('audit quality: the checks stopped', String(err.message).split('\n')[0]);
    }
  }
  /* ---- end audit: quality ---- */

} catch (e) {
  fail('harness error', e.message);
} finally {
  closing = true;
  clearTimeout(watchdog);
  try { ws?.close(); } catch { /* closed */ }
  proc.kill();
  /* Chrome holds its profile for a moment after the kill, and its child
     processes a moment longer. Removed at once, the rm failed quietly on
     Windows, and every run left its profile in TEMP: 1,781 of them, 14 GB,
     had filled C: by 28 September 2026 and parallel runs were failing with
     ENOSPC. Wait for the exit, then retry the removal. */
  await new Promise(res => { if (proc.exitCode !== null || proc.signalCode) return res(); proc.once('exit', res); setTimeout(res, 5000); });
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() => {});
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
