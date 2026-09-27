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

/* A hung evaluate() used to leave the job running to the runner's limit. */
let closing = false;
const watchdog = setTimeout(() => { console.error('FAIL  timed out after 240s'); process.exit(1); }, 240000);
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
      else ok('MSFT-SEC statement table prints no NaN or undefined');
      if (!r.quarterly) fail('a filed company still shows an invented quarterly profile', r);
      else ok('a filed company shows no invented quarters — the page says they are not carried');
    }
  }

  /* 6b — an absent line reads n/a in the cell where it is absent, on a company
          that actually has one. Microsoft has none, so the check above could
          not fail on the defect it was written for. Ford carries no debt line
          in its latest years; Dominion no capex line in its latest. */
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
    else if (r.latest !== 'n/a' || /-0\.000/.test(r.cells.join(' '))) fail(`${id}: ${label} prints "${r.latest}" for an absent latest line, not n/a`, r);
    else ok(`${id}: ${label} reads n/a where its input is absent`, r);
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
          button's route exists, the analytics script is included once. */
  {
    const r = await evaluate(`(() => {
      runSearch('1155');
      const found = [...searchResults.querySelectorAll('button')].some(b => /MAYBANK|Malayan Banking/.test(b.textContent));
      searchResults.replaceChildren();
      return { found, theses: !!matchRoute('/my/theses'), insights: document.querySelectorAll('script[src*="_vercel/insights"]').length };
    })()`);
    if (!r.found) fail('searching the Bursa code 1155 does not list Maybank', r);
    else if (!r.theses) fail('/my/theses does not resolve to a route', r);
    else if (r.insights !== 1) fail(`the analytics script is included ${r.insights} times`, r);
    else ok('the search finds a Bursa code, /my/theses resolves, and the analytics script is included once', r);
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
      for (const p of ['/app/equities', '/discover/sarawak', '/property/areas', '/learn/product-boundaries', '/my/scanner']) {
        navigate(p);
        out.nav[p] = document.querySelector('#mainnav a[aria-current=page]')?.textContent || null;
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
    const wantNav = { '/app/equities': 'Research', '/discover/sarawak': 'Discover', '/property/areas': 'Property', '/learn/product-boundaries': 'Learn', '/my/scanner': 'My Investments' };
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
      const SPAN = { rev5: 5, eps5: 5, fcf5: 5, dps5: 5, epsVol: 5, revDD: 5, ocfPosYears: 5, buyback: 99, dilution: 99 };
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
      const inNav = [...document.querySelectorAll('main .segmented a')].some(a => a.textContent === 'Workspace' && a.getAttribute('aria-selected') === 'true');
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

} catch (e) {
  fail('harness error', e.message);
} finally {
  closing = true;
  clearTimeout(watchdog);
  try { ws?.close(); } catch { /* closed */ }
  proc.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
