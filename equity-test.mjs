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
      const r = U.find(r => r.c.real && r.c.type !== 'bank' && !isNum(r.m.netDebt) && ['dcf', 'dcfMid', 'scenario', 'sotp'].includes(r.val.pack.id));
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
