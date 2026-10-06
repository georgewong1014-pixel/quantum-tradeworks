/* ==========================================================================
   DOES EACH TOOL WORK? — the /status section (daily audit #1, item 1)

   /status said what is built, what is gated and what holds it. It could not
   say whether any of it worked on the site in front of the reader — present
   is not working, and a page that renders can hold a button that does
   nothing. This section answers with two kinds of evidence, and each says
   only what it checked:

   CHECKED IN YOUR BROWSER NOW. Each product's own code, run in this tab when
   the page opens, on inputs whose answers are known without it: the property
   model on a fixed deal worked by hand, the scanner engine's own self-test
   (the fixture every worker run proves itself on), Apple's filed statements
   through the equities pipeline against its 10-K, and whether the data files
   each tool reads are served and loaded. Quick enough to run on opening —
   the budget is 1.5s and it takes a few milliseconds of work; the heavier
   checks wait for a button. Nothing is sent anywhere.

   COMPLETE JOURNEYS ON THE LIVE SITE. health/journeys.json, written by
   journeys.mjs when .github/workflows/journeys.yml drives a real browser
   through the deployed site: after each production deployment that changes
   the app, twice a day on a schedule, and by hand. It lives outside data/ —
   whose files are versioned by the build and cached for a year — is served
   with no-cache, and is fetched here with no-store, so the result shown is
   the one the site holds now. Absent, it is "not run yet"; unreadable, it
   says so; a result is never invented and a stale one says how old it is.

   SERVED, TOO (N1c, the 5 Oct audit; D16). The page is served with the
   committed record already in it: build.mjs writes it into the journeys
   block, and into one line beside the product's badge on /property,
   /research and /app/scanner, with journeysServed — journeys.mjs's one
   renderer, whose source the build puts in place of the marker below — and
   this script draws the same words with the same function, in UTC. Until
   its own no-store read returns, the page keeps what it was served, so
   nothing moves when it is drawn (coverage-frames). A fetch of /status that
   runs no script reads the last recorded run, its time, its commit, its
   public log and every journey's steps.
   ========================================================================== */

const HEALTH_JOURNEYS_FILE = 'health/journeys.json';
/* The one renderer of the recorded result (journeys.mjs, journeysServed):
   put here by the build. */
const journeysServed = /*@INJECT:journeysServed*/ null;
/* Each journey's name by its id (journeys.mjs, JOURNEY_NAMES): put here by
   the build, so a Live badge names the journey that proves it as the
   journeys themselves are named (proofSection). */
const JOURNEY_NAMES = /*@INJECT:journeyNames*/ null;
const journeyNameOf = (id) => (JOURNEY_NAMES && JOURNEY_NAMES[id]) || id;
/* What the line beside a product's badge proves, and what it does not. */
const JOURNEY_LINE_TITLE = 'A journey proves that a reader can get through this tool to a result on the live site. It does not show that any figure on the page is accurate.';
/* A recorded run older than this says so. Runs are recorded at least twice
   a day (D16). */
const HEALTH_STALE_MS = 24 * 3600 * 1000;
const HEALTH_BUDGET_MS = 1500;
/* A second visit to the page within this time shows the same run rather than
   running again: render() redraws the page when the filings land. */
const HEALTH_RERUN_MS = 60000;
const HEALTH_STATE = {
  PASS: { chip: 'chip-ok', label: 'Pass' },
  DEGRADED: { chip: 'chip-warn', label: 'Degraded' },
  FAIL: { chip: 'chip-critical', label: 'Fail' },
};

/* THE FIXED DEAL, WORKED BY HAND. Every figure the model reads that could
   move the answer is written here, so a changed default elsewhere does not
   change what this deal is. The expected figures come from the textbook
   formulas, not from the model:
     loan 90% of RM500,000 = RM450,000, at 4.20%/12 a month over 420 months:
       450,000 × 0.0035 / (1 − 1.0035^−420) = RM2,046.83 a month
     rent RM2,000 × 12 = 24,000 − 5% vacancy = 22,800 a year
     costs 3,600 maintenance + 360 sinking fund + 800 assessment + 300 quit
       rent + 450 insurance + 1,140 repair reserve (5% of 22,800) = 6,650
     net operating income 16,150 a year = 1,345.83 a month
     monthly cash flow 1,345.83 − 2,046.83 = −RM700.99
     gross yield 24,000 / 500,000 = 4.80%; net 16,150 / 500,000 = 3.23% */
const HEALTH_DEAL = {
  price: 500000, bankValuation: 0, renovation: 0, bookingDepositPaid: 0, downPct: 10, ratePct: 4.2, tenureYears: 35,
  rent: 2000, vacancyPct: 5, renoRentUpliftPct: 0,
  maintenance: 300, sinkingFund: 30, assessment: 800, quitRent: 300, insurance: 450,
  selfManaged: true, mgmtPct: 0, mgmtMinMonthly: 0, leasingFeeMonths: 0, renewalFeeMonths: 0, repairReservePct: 5,
  propertyType: 'Condominium', titleType: 'strata', propertyClassOverride: null,
};
const HEALTH_DEAL_EXPECT = { instalment: 2046.83, cashflowMonthly: -700.99, grossYield: 4.80, netYield: 3.23 };
/* Apple's 10-K for the year ended 28 September 2024: net sales $391,035m and
   total shareholders' equity $56,950m — the figures equity-test.mjs pins. */
const HEALTH_FILING = { id: 'AAPL-SEC', name: 'Apple', fy: 2024, rev: 391.035, eq: 56.950 };

const healthRM = (v) => `${v < 0 ? '−' : ''}RM${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const healthPass = (detail) => ({ status: 'PASS', detail });
const healthDegraded = (detail) => ({ status: 'DEGRADED', detail });
const healthFail = (detail) => ({ status: 'FAIL', detail });
const healthUntil = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100)); return cond(); };

/* The deal as the calculator would hold it, with the fixed figures over the
   defaults. */
const healthDeal = (over = {}) => ({ ...PROPERTY_DEFAULT_DEAL, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence }, checks: {}, touched: {}, ...HEALTH_DEAL, ...over });

/* Waits for the filed statements, then says why it cannot look if it cannot. */
async function healthFilings() {
  if (!realEnabled()) return { why: healthDegraded('The filed statements are switched off in this browser, so only the illustrative sample is loaded and the pipeline was not run on a filed company.') };
  await healthUntil(() => !realPending && realStatus !== null, 20000);
  if (realStatus === null) return { why: healthDegraded('The filed statements had not finished loading after 20 seconds, so the pipeline was not run.') };
  if (!realStatus.ok) return { why: healthFail(`data/us.json did not load (${realStatus.error}), so Equities Research is showing the illustrative sample only.`) };
  return {};
}

/* ---- the quick checks: run when the page opens ---- */
const HEALTH_QUICK = [
  {
    id: 'property-model', product: 'property', title: 'Property Intelligence — the deal model',
    run() {
      const E = HEALTH_DEAL_EXPECT;
      const m = dealModel(healthDeal());
      const off = [];
      const cmp = (k, label, fmt) => { const v = m[k]; if (!isNum(v) || Math.abs(v - E[k]) >= 0.005) off.push(`${label} ${isNum(v) ? fmt(v) : 'not computed'}, where ${fmt(E[k])} is expected`); };
      cmp('instalment', 'the instalment is', healthRM);
      cmp('cashflowMonthly', 'the monthly cash flow is', healthRM);
      cmp('grossYield', 'the gross yield is', v => `${v.toFixed(2)}%`);
      cmp('netYield', 'the net yield is', v => `${v.toFixed(2)}%`);
      if (off.length) return healthFail(`On the fixed deal, ${off.join('; ')}.`);
      return healthPass(`A RM500,000 deal with a 10% deposit at 4.20% over 35 years, let at RM2,000: instalment ${healthRM(E.instalment)}, monthly cash flow ${healthRM(E.cashflowMonthly)}, gross yield 4.80%, net 3.23% — each as worked by hand from its formula.`);
    },
  },
  {
    id: 'scanner-engine', product: 'scanner', title: 'Quantum Scanner — the engine’s self-test',
    run() {
      const r = scanSelfTest();
      if (!r.ok) return healthFail(`The fixture every worker run is checked against came out wrong: ${r.alerts} match(es) where 1 is expected, ${r.again} on a second pass (0), ${r.legacy} against the old key (0), ${r.tree} for the grouped form (1), ${r.stale} from a clock four months on (0).`);
      return healthPass(`The fixture every worker run is checked against: one match on its last bar (${r.bar}), none on a second pass, none against the old key, one for the grouped form of the same conditions, and none when a clock four months on finds the series stale.`);
    },
  },
  {
    id: 'equities-pipeline', product: 'equities', title: 'Equities Research — filed statements through the pipeline', waits: true,
    async run() {
      const f = await healthFilings();
      if (f.why) return f.why;
      const t0 = performance.now();
      const row = BY_ID.get(HEALTH_FILING.id);
      if (!row) return healthFail(`${HEALTH_FILING.name}'s filed statements are not in the set that loaded.`);
      const c = row.c;
      if (!c.real || !c.cik) return healthFail(`${HEALTH_FILING.name} is loaded, but not as an SEC filer.`);
      const k = yearsOf(c).indexOf(HEALTH_FILING.fy);
      if (k < 0) return healthFail(`${HEALTH_FILING.name}'s statements hold no FY${HEALTH_FILING.fy}.`);
      const rev = c.fin[k][F.REV], eq = c.fin[k][F.EQ];
      const off = [];
      if (!isNum(rev) || Math.abs(rev - HEALTH_FILING.rev) > 1e-6) off.push(`revenue reads ${rev} where the 10-K reports ${HEALTH_FILING.rev}`);
      if (!isNum(eq) || Math.abs(eq - HEALTH_FILING.eq) > 1e-6) off.push(`equity reads ${eq} where the 10-K reports ${HEALTH_FILING.eq}`);
      const d = derive(c);
      const ocf = d.ocf[k], capex = d.capex[k], ni = d.ni[k], sh = d.sh[k];
      if (isNum(ocf) && isNum(capex) && !(Math.abs(d.fcf[k] - (ocf - capex)) < 1e-9)) off.push('free cash flow is not operating cash flow less capital spending');
      if (isNum(ni) && sh && !(Math.abs(d.eps[k] - ni / sh) < 1e-9)) off.push('earnings per share is not net income over shares');
      const ms = performance.now() - t0;
      if (off.length) return { ...healthFail(`FY${HEALTH_FILING.fy}: ${off.join('; ')}.`), ms };
      return { ...healthPass(`${HEALTH_FILING.name}'s FY${HEALTH_FILING.fy} statements, derived again here: revenue $${HEALTH_FILING.rev.toFixed(3)}bn and equity $${HEALTH_FILING.eq.toFixed(3)}bn as its 10-K reports them, found under their own fiscal-year label; free cash flow and earnings per share by their definitions.`), ms };
    },
  },
  {
    id: 'data-files', product: null, title: 'The data files each tool reads', waits: true,
    async run() {
      await healthUntil(() => typeof realPending === 'undefined' || !realPending, 20000);
      /* loaded(): ok true (this page holds it), false (this page asked for
         it and holds nothing usable) or null (this page does not read it, or
         has not yet) — with the words for each. */
      /* With the filed statements switched off in this browser the page
         asks for neither of the files loaded with them (loadRealData): that
         is the reader's choice, not a file failing to load. */
      const OFF = { ok: null, off: true, text: 'not asked for: the filed statements are switched off in this browser' };
      const FILES = [
        { file: 'us.json', uses: 'the filed statements, for Equities Research', essential: true,
          loaded: () => (!realEnabled() ? OFF
            : realStatus?.ok ? { ok: true, text: 'loaded here' } : realStatus ? { ok: false, text: `not loaded here (${realStatus.error})` } : { ok: null, text: 'not loaded yet' }) },
        { file: 'instruments.json', uses: 'the instrument registry, for search and the scanner',
          loaded: () => (!realEnabled() ? OFF : instruments?.instruments?.length ? { ok: true, text: 'loaded here' } : { ok: false, text: 'not loaded here' }) },
        { file: 'napic-h1-2025.json', uses: 'the NAPIC benchmarks, for Property Intelligence',
          loaded: () => (napicStatus?.ok ? { ok: true, text: 'loaded here' } : napicStatus?.tried ? { ok: false, text: 'not loaded here' } : { ok: null, text: null }) },
        /* Read by the property pages only, so this page has no copy of it. */
        { file: 'sarawak-geo.json', uses: 'the area map, for Property Intelligence', loaded: () => ({ ok: null, text: null }) },
      ];
      const res = await Promise.all(FILES.map(async (x) => {
        try {
          const r = await fetch(dataUrl(x.file), { method: 'HEAD', cache: 'no-store' });
          return { ...x, served: r.ok && /json/i.test(r.headers.get('content-type') || ''), code: r.status, l: x.loaded() };
        } catch (e) { return { ...x, served: false, code: e.message, l: x.loaded() }; }
      }));
      /* A file that is served but did not load is as absent to the tool that
         reads it as one that is not served: a HEAD that answers 200 over a
         body the page could not use is not a Pass. */
      const failed = res.filter(x => !x.served || x.l.ok === false);
      /* The filed statements still loading after the wait above: not a
         failure, and not yet a Pass. */
      const pending = res.filter(x => x.served && x.essential && x.l.ok === null && !x.l.off);
      /* One line a file: which tool reads it, and whether it is there. */
      const lines = res.map(x => `data/${x.file} — ${x.uses}: ${x.served ? `served${x.l.text ? ` ${x.l.ok === true ? 'and' : 'but'} ${x.l.text}` : ''}` : `not served (${x.code})`}.`);
      if (failed.some(x => x.essential)) return healthFail(lines);
      if (failed.length || pending.length) return healthDegraded(lines);
      return healthPass(lines);
    },
  },
];

/* ---- the full checks: on request ---- */
const HEALTH_FULL = [
  {
    id: 'equities-all', title: 'Equities Research — every filed company through the pipeline',
    async run() {
      const f = await healthFilings();
      if (f.why) return f.why;
      const rows = [...new Set(BY_ID.values())].filter(r => r?.c?.real && r.c.cik);
      if (!rows.length) return healthFail('No filed company is loaded.');
      const bad = [];
      let years = 0;
      for (const r of rows) {
        try {
          const d = derive(r.c);
          const arrays = ['rev', 'ebit', 'ni', 'ocf', 'capex', 'eq', 'fcf', 'eps', 'bvps'];
          if (arrays.some(k => (d[k] || []).some(v => Number.isNaN(v)))) { bad.push(`${r.c.tk}: a figure is NaN`); continue; }
          d.fcf.forEach((v, k) => { if (isNum(d.ocf[k]) && isNum(d.capex[k]) && !(Math.abs(v - (d.ocf[k] - d.capex[k])) < 1e-9)) bad.push(`${r.c.tk} FY${yearsOf(r.c)[k]}: free cash flow is not operating cash flow less capital spending`); });
          d.fcf.forEach((v, k) => { if (!(isNum(d.ocf[k]) && isNum(d.capex[k])) && v !== null) bad.push(`${r.c.tk} FY${yearsOf(r.c)[k]}: free cash flow is shown where an input is absent`); });
          years += r.c.fin.length;
        } catch (e) { bad.push(`${r.c.tk}: ${e.message}`); }
      }
      if (bad.length) return healthFail(`${bad.length} problem(s) across ${rows.length} filers — ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? '; …' : ''}.`);
      return healthPass(`${rows.length} filers, ${years.toLocaleString('en-US')} fiscal years: no figure is NaN, free cash flow is operating cash flow less capital spending wherever both are filed, and absent wherever either is not.`);
    },
  },
  {
    id: 'property-breakeven', title: 'Property Intelligence — break-even and yields by definition',
    run() {
      const m = dealModel(healthDeal());
      if (!isNum(m.breakEvenRent)) return healthFail('The fixed deal has no break-even rent.');
      const at = dealModel(healthDeal({ rent: m.breakEvenRent }));
      const off = [];
      if (!(Math.abs(at.cashflowMonthly) < 0.5)) off.push(`at the break-even rent of ${healthRM(m.breakEvenRent)} the monthly cash flow is ${healthRM(at.cashflowMonthly)}, not nought`);
      if (!(Math.abs(m.grossYield - HEALTH_DEAL.rent * 12 / HEALTH_DEAL.price * 100) < 1e-9)) off.push('the gross yield is not the annual rent over the price');
      if (!(Math.abs(m.netYield - m.noi / HEALTH_DEAL.price * 100) < 1e-9)) off.push('the net yield is not the net operating income over the price');
      if (off.length) return healthFail(`${off.join('; ')}.`);
      return healthPass(`At the break-even rent of ${healthRM(m.breakEvenRent)} a month the monthly cash flow is nought (${healthRM(at.cashflowMonthly)}); the gross yield is the annual rent over the price and the net yield the net operating income over it.`);
    },
  },
  {
    id: 'data-read', title: 'The data files, read in full',
    async run() {
      const files = ['us.json', 'instruments.json', 'napic-h1-2025.json', 'sarawak-geo.json'];
      const out = await Promise.all(files.map(async (f) => {
        try {
          const r = await fetch(dataUrl(f));
          if (!r.ok) return { f, ok: false, why: `served ${r.status}` };
          const text = await r.text();
          JSON.parse(text);
          return { f, ok: true, kb: Math.round(text.length / 1024) };
        } catch (e) { return { f, ok: false, why: e.message }; }
      }));
      const bad = out.filter(x => !x.ok);
      const said = out.map(x => `data/${x.f} ${x.ok ? `parsed (${x.kb.toLocaleString('en-US')} kB)` : `failed: ${x.why}`}`).join(', ');
      if (bad.some(x => x.f === 'us.json')) return healthFail(`${said}.`);
      return bad.length ? healthDegraded(`${said}.`) : healthPass(`${said}.`);
    },
  },
];

/* ---- running them ---- */
/* kept: the journeys summary standing as served until the read returns. */
const HEALTH = { quick: new Map(), quickAt: 0, full: new Map(), fullRunning: false, journeys: null, journeysAt: 0, kept: null };

async function healthRunList(list, into) {
  await Promise.all(list.map(async (c) => {
    const t0 = performance.now();
    let r;
    try { r = await c.run(); } catch (e) { r = healthFail(`The check itself threw: ${e.message}`); }
    /* A check that waited for the filings times its own work, not the wait. */
    into.set(c.id, { ...r, ms: r.ms ?? (c.waits ? null : performance.now() - t0) });
    healthPaint();
  }));
}

async function healthLoadJourneys() {
  try {
    const r = await fetch(`${BASE}/${HEALTH_JOURNEYS_FILE}`, { cache: 'no-store' });
    if (r.status === 404) return { state: 'none' };
    if (!r.ok) return { state: 'unreadable', why: `the site answered ${r.status}` };
    if (!/json/i.test(r.headers.get('content-type') || '')) return { state: 'unreadable', why: 'what the site served is not a results file' };
    let doc;
    try { doc = await r.json(); } catch { return { state: 'unreadable', why: 'it is not valid JSON' }; }
    const why = healthResultProblem(doc);
    if (why) return { state: 'unreadable', why };
    return doc.ranAt == null ? { state: 'none' } : { state: 'ok', doc };
  } catch (e) {
    return { state: 'unreadable', why: `it could not be fetched (${e.message})` };
  }
}

/* The shape journeys.mjs writes (its resultProblem holds the same rule, and
   its self-test and the /status block in sweep.mjs hold both to the same
   fixtures). The placeholder committed before any run — ranAt null, no
   journeys — is "not run yet". */
function healthResultProblem(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'it is not an object';
  if (doc.kind !== 'quantum-tradeworks-journeys') return 'it is not a journeys result';
  if (doc.ranAt == null && Array.isArray(doc.journeys) && !doc.journeys.length) return null;
  if (typeof doc.ranAt !== 'string' || !Number.isFinite(Date.parse(doc.ranAt))) return 'its run time is not a date';
  if (doc.run != null && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/\d+$/.test(String(doc.run))) return 'its run is not an Actions run’s address';
  if (doc.trigger != null && !['deployment', 'schedule', 'dispatch'].includes(doc.trigger)) return 'what started its run is not a deployment, the schedule or a person';
  if (!Array.isArray(doc.journeys) || !doc.journeys.length) return 'it lists no journeys';
  for (const j of doc.journeys) {
    if (!j || typeof j.id !== 'string' || typeof j.name !== 'string') return 'a journey has no name';
    if (!Object.hasOwn(HEALTH_STATE, j.status)) return `a journey's status is ${JSON.stringify(j.status)}`;
    if (j.status === 'FAIL' && (typeof j.failedStep !== 'string' || !j.failedStep)) return 'a failed journey names no step';
  }
  return null;
}

function healthStart() {
  const now = Date.now();
  if (now - HEALTH.quickAt > HEALTH_RERUN_MS) {
    HEALTH.quickAt = now;
    HEALTH.quick = new Map();
    /* After the page has painted: the checks are the page's second thing. */
    setTimeout(() => healthRunList(HEALTH_QUICK, HEALTH.quick), 0);
  }
  healthReadJourneys();
}
/* The recorded run, read from the site with no-store: by /status and by the
   three product landing pages' lines. A second page within HEALTH_RERUN_MS
   shows the same read. */
function healthReadJourneys() {
  const now = Date.now();
  if (now - HEALTH.journeysAt <= HEALTH_RERUN_MS) return;
  HEALTH.journeysAt = now;
  HEALTH.journeys = null;
  healthLoadJourneys().then(r => { HEALTH.journeys = r; healthPaint(); journeyLinesPaint(); proofSlotsPaint(); });
}

/* ---- drawing ---- */
/* WHAT RAN IN THIS TAB IS THIS TAB'S (2026-10-04). /status is served with
   the page already drawn in it (prerender.mjs), drawn once in the render's
   browser: "Pass … <1 ms" (its clock held), "Checking…", "Checking — 2 of 4
   done", "Reading the latest recorded run…" — said to every crawler and to
   a reader with no script, for good, as if run in their tab "now". Each
   result and its time, a check still running, and the sentences that count
   them are the tab's own (data-now, NOW in 35-ui.js): served, they say the
   checks run in the reader's browser with the page's script; drawn, what
   that run found. What a check verifies — its description, which a passing
   check prints — is the same in every tab, and is served as it is. */
/* Each no longer than what the tab says there first, so nothing below moves
   when it does (a phone wraps the longer onto a second line). */
const HEALTH_NOT_RUN = { chip: 'Not run', detail: 'Run in your browser by this page’s script.',
  quick: 'Run in your browser by this page’s script.',
  journeys: 'Read from the site by this page’s script.' };
/* One width whatever it says (health-chip, styles.css): served it says
   "Not run", drawn "Checking…" and then its result, and the check's name
   beside it must not move between them. */
/* A RESULT IS SERVED WITH NONE OF ITS MARKS (N1a, the 5 Oct audit). The
   words "Not run" were served in the chip, but its colour (chip-ok) and the
   row's data-status="PASS" were the render's own run's: a fetch of /status
   read a passing check that had run nowhere. data-now-class and
   data-now-status are what the chip's class and the row's status are
   served as (servedCopy, prerender.mjs), as data-now is its words. */
const HEALTH_NOT_RUN_STATUS = 'PENDING';
const healthChip = (status) => {
  const s = HEALTH_STATE[status];
  return el('span', { class: `chip health-chip ${s ? s.chip : ''}`, style: 'flex:none;min-width:4.75rem;justify-content:center', 'data-now': HEALTH_NOT_RUN.chip, 'data-now-class': 'chip health-chip' }, s ? s.label : 'Checking…');
};
const healthMs = (ms) => (isNum(ms) ? (ms < 1 ? '<1 ms' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`) : null);
/* The result, its name and its time on one line; what was checked below it.
   Below it sits under the name on a wide screen, and takes the whole width
   on a phone, where a third column left the words 150px to live in: the
   indent is the chip's width above 640px and nothing below (clamp() over the
   viewport — an inline style cannot hold a media query). */
const HEALTH_INDENT = 'clamp(0px, calc((100vw - 640px) * 1000), calc(4.75rem + 12px))';
function healthRow({ status, title, detail, meta }) {
  /* The whole line's width, so it always starts a line of its own; the
     measure is the text's, inside it. */
  const text = 'margin:0;max-width:72ch;overflow-wrap:anywhere';
  return el('li', { class: 'health-row', data: { status: status || HEALTH_NOT_RUN_STATUS }, 'data-now-status': HEALTH_NOT_RUN_STATUS, style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:12px 0;border-top:1px solid var(--line)' }, [
    healthChip(status),
    el('p', { style: 'flex:1 1 0;min-width:0;margin:0;font-size:14px;font-weight:600;color:var(--ink)' }, title),
    meta ? el('span', { class: 'metaline', style: 'flex:none;white-space:nowrap;font-variant-numeric:tabular-nums', 'data-now': '' }, meta) : null,
    detail ? el('div', { style: `flex:0 0 100%;box-sizing:border-box;padding-left:${HEALTH_INDENT}` },
      Array.isArray(detail)
        ? el('ul', { style: `${text};padding:0;list-style:none` }, detail.map(d => el('li', { class: 'caption' }, d)))
        : el('p', { class: 'caption', style: text, 'data-now': status ? null : HEALTH_NOT_RUN.detail }, detail)) : null,
  ]);
}
const healthList = (id) => el('ul', { id, style: 'list-style:none;padding:0;margin:var(--sm) 0 0' });
const healthCount = (map) => {
  const v = [...map.values()];
  const n = (s) => v.filter(x => x.status === s).length;
  return { n: v.length, pass: n('PASS'), degraded: n('DEGRADED'), fail: n('FAIL'), ms: v.reduce((a, x) => a + (isNum(x.ms) ? x.ms : 0), 0) };
};
const healthTally = (k, of) => `${k.pass} of ${of} pass${k.degraded ? `, ${k.degraded} degraded` : ''}${k.fail ? `, ${k.fail} failed` : ''}`;

/* Redraws whichever parts are on the page, in place: the lists and the
   sentences that count them. The button and the headings are left alone, so
   a reader's focus is not moved by a result arriving — nor, since
   2026-10-04, a reader's place: the journeys' record arriving put its rows
   above a reader who had scrolled on, and the page moved 347px under them
   (notePlace, 35-ui.js). */
function healthPaint() {
  const place = notePlace();
  try { healthPaintNow(); } finally { keepPlace(place); }
}
function healthPaintNow() {
  const q = document.getElementById('health-quick');
  if (q) {
    q.replaceChildren(...HEALTH_QUICK.map(c => { const r = HEALTH.quick.get(c.id); return healthRow({ status: r?.status, title: c.title, detail: r ? r.detail : (c.waits ? 'Waiting for the files this check reads…' : 'Running…'), meta: r ? healthMs(r.ms) : null }); }));
    const k = healthCount(HEALTH.quick);
    const s = document.getElementById('health-quick-sum');
    if (s) s.textContent = k.n < HEALTH_QUICK.length ? `Checking — ${k.n} of ${HEALTH_QUICK.length} done.`
      : `${healthTally(k, HEALTH_QUICK.length)}. The checks took ${healthMs(k.ms)} of work in this tab${k.ms > HEALTH_BUDGET_MS ? `, over the ${healthMs(HEALTH_BUDGET_MS)} this page allows them` : ''}.`;
  }
  const f = document.getElementById('health-full');
  if (f) {
    f.replaceChildren(...(HEALTH.full.size || HEALTH.fullRunning ? HEALTH_FULL.map(c => { const r = HEALTH.full.get(c.id); return healthRow({ status: r?.status, title: c.title, detail: r ? r.detail : 'Running…', meta: r ? healthMs(r.ms) : null }); }) : []));
    const s = document.getElementById('health-full-sum');
    const k = healthCount(HEALTH.full);
    if (s) s.textContent = HEALTH.fullRunning ? 'Running the full checks…' : HEALTH.full.size ? `Full checks: ${healthTally(k, HEALTH_FULL.length)}.` : '';
    /* aria-disabled, not disabled, while they run: a focused button that is
       disabled drops focus to the page, and the reader who pressed it would
       be thrown back to the top. A press while running does nothing. */
    const b = document.getElementById('health-full-run');
    if (b) {
      if (HEALTH.fullRunning) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
      b.textContent = HEALTH.full.size && !HEALTH.fullRunning ? 'Run the full checks again' : 'Run the full checks';
    }
  }
  const jl = document.getElementById('health-journeys');
  const js = document.getElementById('health-journeys-sum');
  if (jl && js) {
    const J = HEALTH.journeys;
    /* With no result to list, the sentence that says so stands as the
       section's content — a quiet panel, not a line lost under the prose. */
    js.style.cssText = `margin-top:var(--sm)${J && J.state !== 'ok' ? ';padding:12px 14px;border-radius:var(--r-sm);background:var(--surface-sunk);color:var(--ink-2)' : ''}`;
    /* Until the read returns, the run the page was served with stands
       (healthSection kept it): nothing moves. */
    if (!J && HEALTH.kept === js) return;
    HEALTH.kept = null;
    if (!J) { js.textContent = 'Reading the latest recorded run…'; jl.replaceChildren(); return; }
    if (J.state === 'none') {
      js.textContent = 'Not run yet. No run of the journeys has been recorded for this site, so there is no result to show.';
      jl.replaceChildren();
      return;
    }
    if (J.state === 'unreadable') {
      js.textContent = `The recorded result could not be read — ${J.why} — so none is shown. Nothing is guessed in its place.`;
      jl.replaceChildren();
      return;
    }
    /* The served words, drawn by the same function (journeysServed): only
       a Pass is described as within budget, a failure names its step and
       route, and each step is OK, FAIL or gated. How old the run is, is the
       reader's now, and is said by the script alone. */
    const out = journeysServed(J.doc);
    const age = Date.now() - Date.parse(J.doc.ranAt);
    js.querySelector('.journeys-age')?.remove();
    if (js.innerHTML !== out.sum) js.innerHTML = out.sum;
    if (age > HEALTH_STALE_MS) js.append(el('span', { class: 'journeys-age' }, ` · recorded ${Math.floor(age / 3600000)} hours ago: runs are recorded at least twice a day, so the scheduled runs may not have run since.`));
    if (jl.innerHTML !== out.list) jl.innerHTML = out.list;
  }
}

/* THE LINE BESIDE A PRODUCT'S BADGE (N1e, the 5 Oct audit; D16). On the
   three product landing pages — /property, /research and /app/scanner —
   one line, above the page and under the product's tab row, never in it:
   the product's journey, its last recorded result, time and commit, and a
   link to its steps on /status. Its title says what a journey proves and
   what it does not. Served by the build (journeysServed's lines), kept as
   served until this tab's own read of the record returns, then drawn from
   it with the same function. */
function journeyLineNode() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const lines = journeysServed(null).lines;
  if (!Object.hasOwn(lines, path)) return null;
  const p = el('p', { class: 'journey-line', 'data-journey': path, 'data-now': '', title: JOURNEY_LINE_TITLE });
  const J = HEALTH.journeys;
  if (J?.state === 'ok') p.innerHTML = journeysServed(J.doc).lines[path] || '';
  else {
    const was = [...document.querySelectorAll('#views .journey-line')].find(n => n.getAttribute('data-journey') === path);
    if (was && was.textContent.trim()) p.innerHTML = was.innerHTML;
    healthReadJourneys();
  }
  return p;
}
function journeyLinesPaint() {
  const J = HEALTH.journeys;
  if (!J) return;
  const lines = J.state === 'ok' ? journeysServed(J.doc).lines : journeysServed(null).lines;
  for (const p of document.querySelectorAll('#views .journey-line')) {
    const html = lines[p.getAttribute('data-journey')] ?? '';
    if (p.innerHTML !== html) p.innerHTML = html;
  }
}

/* EACH LIVE BADGE BESIDE ITS JOURNEY'S LAST RESULT (D15, the owner's
   decision of 6 Oct 2026; plan item 2.6). An outcome step in a production
   journey proves a Live badge: an action and the result it must produce. So
   /status lists every Live badge the registry writes (liveBadgeRows,
   35-ui.js), each beside the journey and outcome step that prove it and
   that journey's last recorded result — served by the build from the
   committed record (journeysServed's proof, into each .proof-result slot,
   drawn empty here with data-now), kept as served until this tab's own read
   of the record returns, then drawn from it with the same function — and,
   apart, the Live tools "not yet proven by a journey", read from the same
   rows (proof: null). Nothing is moved to Beta here: the badges stay as
   the registry writes them while their journeys are written (plan item
   6.5). */
const PROOF_UNPROVEN = 'not yet proven by a journey';
function proofResultNode(journey, step) {
  const span = el('span', { class: 'proof-result', 'data-proof-journey': journey, 'data-proof-step': step, 'data-now': '' });
  const J = HEALTH.journeys;
  if (J) span.innerHTML = (J.state === 'ok' ? journeysServed(J.doc) : journeysServed(null)).proof(journey, step);
  else {
    const was = [...document.querySelectorAll('#views .proof-result')].find(n => n.getAttribute('data-proof-journey') === journey && n.getAttribute('data-proof-step') === step);
    if (was && was.textContent.trim()) span.innerHTML = was.innerHTML;
  }
  return span;
}
function proofSlotsPaint() {
  const J = HEALTH.journeys;
  if (!J) return;
  const served = J.state === 'ok' ? journeysServed(J.doc) : journeysServed(null);
  for (const n of document.querySelectorAll('#views .proof-result')) {
    const html = served.proof(n.getAttribute('data-proof-journey'), n.getAttribute('data-proof-step'));
    if (n.innerHTML !== html) n.innerHTML = html;
  }
}
function proofSection() {
  healthReadJourneys();
  const rows = liveBadgeRows();
  const proven = rows.filter(r => r.proof), unproven = rows.filter(r => !r.proof);
  const badge = () => el('span', { class: 'status-badge status-live' }, PRODUCT_STATUS.live);
  const card = el('section', { class: 'card', id: 'proof', 'aria-labelledby': 'proof-h' });
  card.append(el('div', { class: 'card-hd' }, el('div', {}, [
    el('h2', { class: 'h-card', id: 'proof-h' }, 'What proves each Live badge'),
    el('p', { class: 'caption', style: 'margin-top:2px;max-width:72ch' },
      'A Live badge is proven by an outcome step in a journey on the live site: an action, and the result it must produce, checked. A journey that only opens a tool’s page does not count. Each badge below is beside its journey’s last recorded result, as listed above.'),
  ])));
  card.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 0' }, `Proven by an outcome step — ${proven.length} of ${rows.length}`));
  card.append(el('ul', { id: 'health-proofs', class: 'proof-list' }, proven.map(r => el('li', { class: 'proof-row', 'data-proof-row': r.key }, [
    badge(),
    el('p', { class: 'proof-name' }, [r.name, el('span', { class: 'proof-of' }, ` · ${r.of}`)]),
    el('div', { class: 'proof-body' }, [
      el('p', { class: 'caption' }, `Journey “${journeyNameOf(r.proof.journey)}”, outcome step “${r.proof.step}”.`),
      el('p', { class: 'proof-last' }, [el('span', { class: 'proof-last-label' }, 'Last result: '), proofResultNode(r.proof.journey, r.proof.step)]),
    ]),
  ]))));
  card.append(el('h3', { class: 'eyebrow', style: 'margin:var(--lg) 0 0' }, `Live, and ${PROOF_UNPROVEN} — ${unproven.length} of ${rows.length}`));
  card.append(el('p', { class: 'caption', style: 'margin-top:4px;max-width:72ch' },
    unproven.length
      ? 'No journey yet does what each of these tools is for and checks the result. Each keeps its Live badge while its journey is written; until then nothing here shows that it works on the live site.'
      : 'None: every Live badge is proven by an outcome step.'));
  card.append(el('ul', { id: 'health-unproven', class: 'proof-list' }, unproven.map(r => el('li', { class: 'proof-row', 'data-proof-row': r.key }, [
    badge(),
    el('p', { class: 'proof-name' }, [r.name, el('span', { class: 'proof-of' }, ` · ${r.of}`)]),
  ]))));
  return card;
}

function healthSection() {
  healthStart();
  const card = el('section', { class: 'card', id: 'health', 'aria-labelledby': 'health-h' });
  card.append(el('div', { class: 'card-hd' }, el('div', {}, [
    el('h2', { class: 'h-card', id: 'health-h' }, 'Does each tool work?'),
    el('p', { class: 'caption', style: 'margin-top:2px;max-width:66ch' },
      'Two kinds of evidence, each saying only what it checked: complete journeys through the live site, as last recorded, and the tools’ own code run in your browser when the page opens.'),
  ])));

  /* The recorded journeys first (N1c): the result a fetch of this page
     reads, before the checks only a browser runs. */
  card.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 0' }, 'Complete journeys on the live site'));
  card.append(el('p', { class: 'caption', style: 'margin-top:4px;max-width:72ch' },
    'A real browser, driven through the deployed site by GitHub Actions after each production deployment that changes the site, twice a day on a schedule (03:17 and 15:17 UTC, which GitHub may start late) and when started by hand: it finds a company and opens its filed statements, filters the screener, compares two filed companies and saves and reopens the comparison, models and saves a property, builds and saves a scanner setup, and presses each primary call to action. Every such run is recorded here — never the run on the deployment of the record itself, which serves the same app. Each step is marked OK, FAIL or gated: gated is a step that passes by checking that a tool refuses honestly, such as the scanner’s evaluate step, which checks that the page says there is no price history to evaluate, because this site ships no prices. A journey proves that the path works on the live site, not that any figure on it is accurate. Nothing checks the site between runs.'));
  /* As served until this tab's read of the record returns (healthPaintNow):
     the page was drawn with it, and nothing moves when it is drawn again. */
  const sum = el('p', { class: 'metaline', id: 'health-journeys-sum', role: 'status', style: 'margin-top:var(--sm)', 'data-now': HEALTH_NOT_RUN.journeys });
  const jlist = el('ul', { id: 'health-journeys', class: 'journeys-list', 'data-now': '' });
  const wasSum = document.getElementById('health-journeys-sum'), wasList = document.getElementById('health-journeys');
  if (!HEALTH.journeys && wasSum && wasList && /^Last recorded run /.test(wasSum.textContent)) {
    sum.innerHTML = wasSum.innerHTML;
    sum.querySelector('.journeys-age')?.remove();
    HEALTH.kept = sum;
    jlist.innerHTML = wasList.innerHTML;
  }
  card.append(sum, jlist);

  card.append(el('h3', { class: 'eyebrow', style: 'margin:var(--lg) 0 0' }, 'Checked in your browser now'));
  card.append(el('p', { class: 'caption', style: 'margin-top:4px;max-width:72ch' },
    'Each tool’s own code, run in your browser by this page’s script when the page opens, on inputs whose answers are known without it. Nothing is sent anywhere, and nothing here says the site stayed working after you looked.'));
  card.append(healthList('health-quick'));
  card.append(el('p', { class: 'metaline', id: 'health-quick-sum', role: 'status', style: 'margin-top:var(--sm)', 'data-now': HEALTH_NOT_RUN.quick }));
  const run = el('button', { class: 'btn btn-ghost btn-sm', id: 'health-full-run', type: 'button', onclick: async () => {
    if (HEALTH.fullRunning) return;
    HEALTH.fullRunning = true;
    HEALTH.full = new Map();
    healthPaint();
    await healthRunList(HEALTH_FULL, HEALTH.full);
    HEALTH.fullRunning = false;
    healthPaint();
  } }, 'Run the full checks');
  card.append(el('div', { class: 'row row-wrap', style: 'gap:8px 12px;align-items:center;margin-top:var(--md)' }, [
    run,
    el('span', { class: 'caption', style: 'flex:1 1 260px;max-width:60ch' },
      'Heavier: every filed company through the statements pipeline, the property model’s break-even and yields by their definitions, and each data file read in full.'),
  ]));
  card.append(healthList('health-full'));
  card.append(el('p', { class: 'metaline', id: 'health-full-sum', role: 'status', style: 'margin-top:var(--sm)' }));
  /* Filled once the card is on the page. */
  requestAnimationFrame(healthPaint);
  return card;
}
