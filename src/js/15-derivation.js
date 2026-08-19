/* ==========================================================================
   DERIVATION ENGINE
   Nothing below is stored — every ratio is computed from the statement lines
   above, so the metric dictionary can show the formula and the exact inputs.
   ========================================================================== */

const MODEL_VERSION = 'metrics 1.4.0 · scores 1.2.0 · valuation 1.3.0';
const AS_OF = '30 Jul 2026';

/* SAVED WORK — NAMED, VERSIONED, AND HONESTLY LOCATED.
   ---------------------------------------------------------------------------
   Every tool here already autosaves: change a field and it is written to local
   storage immediately. What did not exist is a way to keep MORE THAN ONE of
   anything. A reader modelling a second property had to overwrite the first,
   so the tool quietly punished the exact behaviour it is for — comparing two
   candidates — and any session's work was one stray edit from gone.

   A record is a named snapshot of the keys one tool owns, stamped with the
   model version, the data date and when it was taken, because a result whose
   inputs you cannot reproduce is an anecdote.

   WHAT THIS IS NOT. It is not accounts and it is not a server. Records live in
   the same browser as everything else and die with it, so the label says "this
   browser only" wherever they appear and a full backup is one click away. The
   audit asks for "last editor" on every saved result; there is no identity in
   this build to record, and inventing one would be worse than the gap, so the
   field says "this browser" and means it. */
const WORK_KINDS = {
  property: { label:'Property deal',        keys:['deal'],
              name:() => `${(State.deal?.district || 'Property')} — ${fmtAmount(num0(State.deal?.price), 'MYR')}` },
  wheel:    { label:'Cash Wheel contract',  keys:['wheelPlan', 'wheelLegs'],
              name:() => `${State.wheel?.symbol || 'Contract'} — ${fmtMoney(num0(State.wheel?.putStrike), 'USD', 0)} put` },
  trading:  { label:'Trading Index run',    keys:['qttiPlan'],
              name:() => `${State.qtti?.symbol || 'Run'} — ${new Date().toISOString().slice(0, 10)}` },
};

const loadWork = () => store.read('savedWork', []);
const persistWork = (list) => store.write('savedWork', list);

/* A monotonic counter, because timestamps collide.
   The first version keyed records on Date.now() plus a sub-millisecond figure
   that only advances once per millisecond, so two saves in the same tick got
   the SAME id — and every lookup is a .find() on id, which returns the first
   match. Resuming one record restored the other; duplicating "Deal A" produced
   "Deal B (copy)". Caught in a round-trip test, not by reading the code, and it
   would have been near-impossible to reproduce by hand. */
let WORK_SEQ = 0;
const nextWorkId = (kind) => `w-${kind}-${Date.now().toString(36)}-${(WORK_SEQ++).toString(36)}`;

function saveWork(kind, nameOverride) {
  const def = WORK_KINDS[kind];
  if (!def) return null;
  const payload = {};
  def.keys.forEach(k => { payload[k] = store.read(k, null); });
  const rec = {
    id: nextWorkId(kind),
    kind,
    name: (nameOverride || def.name() || def.label).slice(0, 80),
    savedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    modelVersion: MODEL_VERSION,
    asOf: AS_OF,
    editor: 'this browser',
    payload,
  };
  persistWork([rec, ...loadWork()]);
  return rec;
}

/* Resume writes the record's keys back and re-reads State from them, so the
   page reflects the record rather than whatever was on screen a moment ago. */
function resumeWork(id) {
  const rec = loadWork().find(r => r.id === id);
  if (!rec) return false;
  Object.entries(rec.payload || {}).forEach(([k, v]) => { if (v != null) store.write(k, v); });
  if (rec.payload.deal) State.deal = rec.payload.deal;
  if (rec.payload.wheelPlan) State.wheel = rec.payload.wheelPlan;
  if (rec.payload.wheelLegs) State.wheelLegs = rec.payload.wheelLegs;
  if (rec.payload.qttiPlan) State.qtti = rec.payload.qttiPlan;
  return true;
}

function duplicateWork(id) {
  const rec = loadWork().find(r => r.id === id);
  if (!rec) return null;
  const copy = { ...rec, id: nextWorkId(rec.kind),
    name: `${rec.name} (copy)`.slice(0, 80),
    savedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) };
  persistWork([copy, ...loadWork()]);
  return copy;
}

const deleteWork = (id) => persistWork(loadWork().filter(r => r.id !== id));

/* A FULL BACKUP ENUMERATES STORAGE, IT DOES NOT LIST KEYS FROM MEMORY.
   There are 36 persisted keys today. A hardcoded list would be correct on the
   day it was written and silently incomplete from the next key onwards — and
   the failure only surfaces when somebody restores a backup and finds their
   watchlists missing. Reading the prefix back off localStorage cannot go
   stale, because it is the same source of truth the app writes to. */
const STORE_PREFIX = 'vl.';
function backupPayload() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(STORE_PREFIX)) continue;
    try { data[k.slice(STORE_PREFIX.length)] = JSON.parse(localStorage.getItem(k)); }
    catch { /* a value this app did not write; skipped rather than corrupted */ }
  }
  return {
    format: 'quantum-tradeworks-backup',
    version: 1,
    takenAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
    asOf: AS_OF,
    note: 'Everything this browser holds for Quantum Tradeworks. No account, no server — this file is the only copy.',
    keys: Object.keys(data).length,
    data,
  };
}

/* Returns {ok, restored, error}. Refuses anything that is not one of our own
   backups rather than writing arbitrary JSON into the app's storage. */
function restoreBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok:false, error:'That file is not valid JSON.' }; }
  if (!obj || obj.format !== 'quantum-tradeworks-backup' || !obj.data || typeof obj.data !== 'object')
    return { ok:false, error:'That file is not a Quantum Tradeworks backup.' };
  let restored = 0;
  Object.entries(obj.data).forEach(([k, v]) => { store.write(k, v); restored++; });
  return { ok:true, restored };
}

/* LAUNCH CONFIGURATION — the two things a campaign needs that code cannot supply.
   ---------------------------------------------------------------------------
   Both are empty, and both surfaces stay HIDDEN while they are. That is
   deliberate and it is the same rule the corrections form now follows: a
   waitlist that thanks somebody while storing nothing is worse than no
   waitlist, because it converts a willing reader into one who thinks they have
   already signed up.

   waitlistEndpoint  A URL that accepts a POST. Any form backend does —
                     Formspree, Buttondown, a Vercel function, anything that
                     returns 2xx. Until it is set the waitlist does not render.

   contactEmail      Used for the fallback mail link and for the contact page.
                     Until it is set, /contact keeps saying no route is
                     published, because none is.

   ANALYTICS is Vercel Web Analytics, enabled in the Vercel dashboard rather
   than here. It is first-party, cookieless and collects no personal data, which
   is the only kind this product can honestly run before a privacy notice exists
   — and the privacy page states exactly what it records. Nothing loads unless
   the deployment has it switched on. */
const LAUNCH = {
  waitlistEndpoint: '',
  contactEmail: '',
};
const waitlistReady = () => !!(LAUNCH.waitlistEndpoint || LAUNCH.contactEmail);

/* THE COVERAGE MANIFEST — one count, counted once, in one place.
   ---------------------------------------------------------------------------
   Four surfaces stated the coverage four ways and a reader comparing them found
   a contradiction:

     Discover / Pricing   138 companies, 120 US and 18 Bursa
     Data sources         120 US and 18 Bursa
     Build status         119 companies with audited SEC filings
                          "18 Malaysian companies carry illustrative figures"

   Every one of those numbers was arithmetically right. They contradict because
   they measure two DIFFERENT AXES without saying which:

     by market   120 US + 18 Bursa      = 138
     by source   119 SEC-filed + 19 illustrative = 138

   And the gap between 120 US and 119 filed is one real company. PGR, Progressive
   Corporation on the NYSE, is a US row with illustrative figures and a synthetic
   $246.80 price. It has no SEC twin, so retireIllustrativeTwin never removed it
   the way it removed the other seventeen. "18 Malaysian companies carry
   illustrative figures" was therefore not merely incomplete — it told a reader
   that every illustrative company is Malaysian, and one of them is not.

   Counting is now done here and nowhere else, and every statement names its
   axis. A count computed at the call site is a count that will disagree with
   the next one. */
/* COVERAGE IS NOT KNOWN UNTIL THE AUDITED UNIVERSE HAS LANDED.
   ---------------------------------------------------------------------------
   U holds the 36-company sample set until loadRealData() resolves, so for the
   first few hundred milliseconds every count below is computable, confident
   and wrong. Measured on production: for 313ms the Build Status page — the one
   page whose entire job is reporting what this build contains — stated "0 US
   companies with audited SEC filings, of 18 US listings held" and "36
   companies carry illustrative figures", then replaced both with 119 of 120
   and 19.

   Two false figures for a third of a second is not a rendering nicety. This
   product's claim is that it says so when it cannot work something out rather
   than filling the gap, and a stale count fills the gap with the most
   convincing thing there is: a specific number.

   So `resolved` is part of the manifest, and covText() below is the only
   sanctioned way to print a figure derived from it. */
function coverage() {
  const rows = typeof U !== 'undefined' ? U : [];
  const filed = rows.filter(r => r.c.real);
  const illus = rows.filter(r => !r.c.real);
  const us = rows.filter(r => r.c.mkt === 'US');
  const my = rows.filter(r => r.c.mkt === 'MY');
  const usIllus = us.filter(r => !r.c.real);
  const priced = rows.filter(r => isNum(r.c.px?.p));
  return {
    /* False while the audited set is still in flight, and false if the
       universe is empty — an empty universe yields zeroes that read as facts. */
    resolved: !(typeof realPending !== 'undefined' && realPending) && rows.length > 0,
    total: rows.length,
    filed: filed.length, illustrative: illus.length,
    us: us.length, my: my.length,
    usFiled: us.length - usIllus.length, usIllustrative: usIllus.length,
    usIllustrativeNames: usIllus.map(r => r.c.tk || r.c.id),
    priced: priced.length, filedPriced: filed.filter(r => isNum(r.c.px?.p)).length,
    filedUnpriced: filed.length - filed.filter(r => isNum(r.c.px?.p)).length,
  };
}

/* PRINT A COVERAGE FIGURE, OR SAY YOU ARE STILL COUNTING.
   The single sanctioned way to render anything derived from coverage(). Read
   the manifest directly for a count you are about to display and you reproduce
   the flash this exists to stop; the failure is silent, because the wrong
   number is replaced by the right one before anyone looks twice.
   coverage-frames.mjs fails the build if any route ever shows two different
   answers to the same question. */
const COVERAGE_PENDING = 'Checking coverage';
function covText(fn, pending = COVERAGE_PENDING) {
  const k = coverage();
  return k.resolved ? fn(k) : pending;
}

/* The same fact as a sentence, so two surfaces cannot word it differently.
   `axis` picks which split leads; both are always reachable from the other. */
function coverageSentence(axis) {
  const k = coverage();
  if (!k.resolved) return `${COVERAGE_PENDING} — the audited set is still loading.`;
  if (!k.total) return 'The universe is still loading.';
  const bySource = `${k.filed} carry audited statements filed with the SEC and ${k.illustrative} carry illustrative figures that are synthetic`;
  const byMarket = `${k.us} are US-listed and ${k.my} are Bursa-listed`;
  const oddity = k.usIllustrative
    ? ` Not every illustrative company is Malaysian: ${k.usIllustrativeNames.join(', ')} ${k.usIllustrative === 1 ? 'is a US listing' : 'are US listings'} whose figures are synthetic too.`
    : '';
  return axis === 'market'
    ? `${k.total} companies: ${byMarket}. By source, ${bySource}.${oddity}`
    : `${k.total} companies: ${bySource}. By market, ${byMarket}.${oddity}`;
}
const TAX = { US: 0.21, MY: 0.24 };

/* Deterministic PRNG so generated series are stable across reloads. */
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const F = { REV:0, EBIT:1, NI:2, OCF:3, CAPEX:4, EQ:5, DEBT:6, CASH:7, SH:8, DPS:9 };
const col = (fin, k) => fin.map(r => r[k]);

/* Standard deviation of the year-on-year growth series — our stability input. */
function growthVol(series) {
  const g = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    if (!isNum(a) || !isNum(b) || a === 0) continue;
    g.push((b - a) / Math.abs(a) * 100);
  }
  if (g.length < 2) return null;
  const mean = sum(g) / g.length;
  return Math.sqrt(sum(g.map(v => (v - mean) ** 2)) / g.length);
}

/* Largest peak-to-trough fall in a series, as a positive percentage. */
function maxDrawdown(series) {
  let peak = -Infinity, worst = 0;
  for (const v of series) {
    if (!isNum(v)) continue;
    peak = Math.max(peak, v);
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak * 100);
  }
  return worst;
}

function derive(c) {
  const fin = c.fin, n = fin.length, i = n - 1;
  const isBank = c.type === 'bank', isReit = c.type === 'reit';
  const rev = col(fin, F.REV), ebit = col(fin, F.EBIT), ni = col(fin, F.NI);
  const ocf = col(fin, F.OCF), capex = col(fin, F.CAPEX), eq = col(fin, F.EQ);
  const debt = col(fin, F.DEBT), cash = col(fin, F.CASH), sh = col(fin, F.SH), dps = col(fin, F.DPS);

  /* NULL IS NOT ZERO, AND THIS FILE KEPT TREATING IT AS ONE.
     ---------------------------------------------------------------------
     `capex[k] || 0` substituted zero for a capital programme nobody had
     reported, so free cash flow silently became operating cash flow — and on
     16 of the 119 filers it did. ConocoPhillips read a 38.2% free cash flow
     margin and EOG 44.4%, on oil businesses whose capital spending is most of
     what they do. That figure then feeds the FCF yield, the DCF and the value
     pillar.

     This is the same defect the product exists to prevent, written into the
     arithmetic rather than the copy: an absent input rendered as a confident
     number instead of an absence. A missing capex line makes free cash flow
     unknown, and unknown is a thing this product already knows how to say. */
  const fcf = ocf.map((v, k) => (isNum(v) && isNum(capex[k])) ? v - capex[k] : null);
  const eps = ni.map((v, k) => isNum(v) && sh[k] ? v / sh[k] : null);
  const bvps = eq.map((v, k) => isNum(v) && sh[k] ? v / sh[k] : null);
  const fcfps = fcf.map((v, k) => isNum(v) && sh[k] ? v / sh[k] : null);

  /* Fundamentals can exist without a price: SEC filings are free, market data
     is licensed. Everything price-derived degrades to null rather than NaN, so
     a company with real statements and no feed stays usable. */
  const price = isNum(c.px?.p) ? c.px.p : null;
  const hasPx = price != null;
  const mcap = hasPx ? price * sh[i] : null;
  /* Both lines, or neither. `debt[i] - cash[i]` with a missing debt line
     returned negative net debt, which made m.netCash true and m.netGearing
     negative — the product asserting a net cash position for a company whose
     borrowings it simply had not read. */
  const netDebt = (isBank || !isNum(debt[i]) || !isNum(cash[i])) ? null : debt[i] - cash[i];
  const ev = (isBank || !hasPx) ? null : mcap + netDebt;

  const m = {};
  m.mcap = mcap; m.ev = ev; m.netDebt = netDebt;
  m.eps = eps[i]; m.bvps = bvps[i]; m.fcfps = fcfps[i]; m.dps = dps[i];
  m.fcf = fcf[i];

  /* --- valuation multiples ------------------------------------------- */
  m.pe    = hasPx && isNum(m.eps)  && m.eps  > 0 ? price / m.eps  : null;
  m.pb    = hasPx && isNum(m.bvps) && m.bvps > 0 ? price / m.bvps : null;
  m.pfcf  = hasPx && isNum(m.fcfps) && m.fcfps > 0 ? price / m.fcfps : null;
  m.evebit = isNum(ev) && ebit[i] > 0 ? ev / ebit[i] : null;
  m.dy    = hasPx && price > 0 ? dps[i] / price * 100 : null;
  m.fcfy  = isNum(m.fcf) && isNum(mcap) && mcap > 0 ? m.fcf / mcap * 100 : null;
  m.ey    = isNum(m.pe) ? 100 / m.pe : null;

  /* --- profitability -------------------------------------------------- */
  /* A MARGIN OVER 100% IS NOT A GOOD MARGIN, IT IS A BROKEN DENOMINATOR.
     ---------------------------------------------------------------------
     American Tower reported an operating margin of 517.8% on this build: EBIT
     of 4.85bn against revenue of 0.94bn. Its real revenue is around 11bn, so
     the XBRL revenue tag has captured a partial line — a segment or a single
     period — while EBIT and net income came through whole. Operating profit
     cannot exceed turnover; when it appears to, the two figures disagree and
     the ratio between them is arithmetic on a mismatch.

     The screener sorts on these, so the company with the broken tag arrives at
     the top of "most profitable". Withholding is the only honest answer,
     because it is not possible to tell from here WHICH figure is wrong — and
     picking one would be a guess presented as a correction. The raw lines stay
     on the financials tab, where a reader can see the mismatch themselves. */
  const revenueSuspect = rev[i] > 0 && isNum(ebit[i]) && ebit[i] > rev[i];
  m.revenueSuspect = revenueSuspect
    ? `Operating profit of ${fmtNum(ebit[i], 2)}bn exceeds revenue of ${fmtNum(rev[i], 2)}bn, which cannot both be right — the revenue line looks partially captured. Every margin that divides by revenue is withheld rather than computed from figures that disagree.`
    : null;
  /* isNum on the numerator too. A missing EBIT made `null / rev * 100` exactly
     0, printed as "0.0%" — an operating margin of precisely zero on Phillips 66,
     a business with revenue in the hundreds of billions. A genuine breakeven
     year is real, which is why the test is on whether the line was reported and
     not on whether the answer is small. */
  m.om  = isNum(ebit[i]) && rev[i] > 0 && !revenueSuspect ? ebit[i] / rev[i] * 100 : null;
  m.nm  = isNum(ni[i]) && rev[i] > 0 && !revenueSuspect ? ni[i] / rev[i] * 100 : null;
  m.fcfm = isNum(m.fcf) && rev[i] > 0 && !revenueSuspect ? m.fcf / rev[i] * 100 : null;
  /* RETURN ON EQUITY, WITHHELD WHERE THERE IS BARELY ANY EQUITY.
     ---------------------------------------------------------------------
     The risk flags already say, in these words, that "sustained buybacks have
     reduced book equity, so return-on-equity is not a meaningful comparison" —
     and the number was printed, scored and screened on anyway. AbbVie read
     15,367%, Colgate 1,603%. Those are not returns; they are what division by
     something near zero produces, and a reader sorting on return on equity met
     them at the top.

     The test is the one the flag already uses, so the code now matches the
     sentence beside it: equity below 5% of revenue, excluding banks and REITs
     whose capital structures make that ratio meaningless in the other
     direction. Apple at 181% and Mastercard at 211% survive it, because those
     are real returns on a genuinely small equity base — the rule is about a
     denominator that has stopped carrying information, not about a large
     number. */
  /* The divisor is the AVERAGE, so the test has to be on the average. It was on
     eq[i] alone, which meant the rule the code already believes in was being
     applied to a variable that is not the one it divides by — a company thin at
     the year end but not on average, or the reverse, was judged on the wrong
     number. The sign test is the second half: an average spanning negative and
     positive equity is the midpoint of two opposite states, not a capital base. */
  const avgEq = (isNum(eq[i]) && isNum(eq[i - 1])) ? (eq[i] + eq[i - 1]) / 2 : null;
  const equitySignFlip = isNum(eq[i]) && isNum(eq[i - 1]) && eq[i] * eq[i - 1] < 0;
  const equityTooThin = isNum(avgEq) && isNum(rev[i]) && rev[i] > 0
    && (avgEq < 0.05 * rev[i] || equitySignFlip) && !isBank && c.type !== 'reit';
  m.roe = avgEq > 0 && !equityTooThin ? ni[i] / avgEq * 100 : null;
  m.roeWithheld = avgEq > 0 && equityTooThin
    ? 'Book equity is under 5% of revenue, so return on equity divides by a base too small to carry meaning. The underlying figures are on the financials tab.'
    : null;
  m.roic = isBank ? null : (() => {
    /* All three lines, or the denominator is not invested capital. With debt
       missing it became equity minus cash — a net-cash residual, which on a
       cash-rich filer is a small difference between two large numbers and
       produced a return on nothing much. Nine non-bank rows. */
    if (!isNum(eq[i]) || !isNum(debt[i]) || !isNum(cash[i]) || !isNum(ebit[i])) return null;
    const invested = eq[i] + debt[i] - cash[i];
    return invested > 0 ? ebit[i] * (1 - TAX[c.mkt]) / invested * 100 : null;
  })();
  /* ni > 0 was the only guard, which is the AbbVie failure with a different
     denominator: it tests the sign and not whether there is enough of it to
     divide by. General Motors legitimately reaches 966% in a trough year, so
     the floor sits well below that. */
  m.cashconv = isNum(ocf[i]) && ni[i] > 0 && Math.abs(ocf[i]) / ni[i] <= 15
    ? ocf[i] / ni[i] * 100 : null;

  /* --- growth ---------------------------------------------------------- */
  /* Scored growth and stability inputs stay on the most recent five reported
     points — a four-year CAGR — because the score anchors were calibrated on
     that window. The full ten-year history is exposed separately below and in
     the statements view rather than silently re-basing every score. */
  const W = (a) => a.slice(-5);
  const safeCagr = (a) => { const s = a.filter(isNum); return s.length >= 2 ? cagr(s) : null; };
  /* How many annual intervals the growth measures below were actually computed
     over. Every US filer carries ten years, so the window is always the full
     four and the number is uninteresting — until a company arrives with four
     years of statements, at which point "Revenue CAGR (4y)" would silently mean
     three. The label has to follow the data rather than the field definition,
     so the span travels with the metrics and the page states it. */
  m.growthYears = Math.max(0, W(rev).filter(isNum).length - 1);
  m.rev5 = safeCagr(W(rev));
  m.eps5 = safeCagr(W(eps));
  m.fcf5 = safeCagr(W(fcf));
  m.dps5 = W(dps)[0] > 0 ? safeCagr(W(dps)) : null;
  m.bv5  = safeCagr(W(bvps));
  m.revVol = growthVol(W(rev));
  m.epsVol = growthVol(W(ni));
  m.revDD  = maxDrawdown(W(rev));
  m.epsDD  = maxDrawdown(W(ni));
  /* Full-window equivalents, for the ten-year view. */
  /* Full-window measures, and only where the full window exists. A company
     holding five reported years has no ten-year view, and computing one over
     four intervals produces a different statistic under the same name — the
     same trap as the four-year window above, one level up. Currently unread by
     any view, which is exactly why it was worth closing now rather than when
     something starts reading it. */
  m.fullSpanYears = rev.filter(isNum).length;
  const hasFullSpan = m.fullSpanYears >= YEARS.length;
  m.rev10 = hasFullSpan ? safeCagr(rev) : null;
  m.eps10 = hasFullSpan ? safeCagr(eps) : null;
  m.dps10 = (hasFullSpan && dps[0] > 0) ? safeCagr(dps) : null;
  m.revDD10 = maxDrawdown(rev);

  /* --- balance sheet ---------------------------------------------------- */
  m.ndEbit = isBank ? null : (isNum(netDebt) && ebit[i] > 0 ? netDebt / ebit[i] : null);
  /* `debt[i] / eq[i]` with no debt line rendered 0.00x — not "unknown" but a
     positive claim of no borrowings, on Ford, General Motors, Deere and
     Berkshire among nine others. Debt/equity of exactly zero is the strongest
     balance-sheet statement this product can make and it was making it from an
     absent line. */
  m.de     = isBank ? null : (isNum(debt[i]) && eq[i] > 0 ? debt[i] / eq[i] : null);
  m.netCash = (isBank || !isNum(netDebt)) ? null : netDebt < 0;
  /* Interest expense is not a line in this sample dataset, so interest cover
     genuinely cannot be computed. It is reported as missing, never imputed. */
  m.icov = null;

  /* Net gearing — net debt against equity. Section 7.3 lists this separately
     from debt/equity above, and they are not interchangeable: one nets off cash
     and the other does not, so a cash-rich borrower looks levered on de and
     unlevered here. Section 18.3 screens on this one. */
  m.netGearing = isBank ? null : (isNum(netDebt) && eq[i] > 0 ? netDebt / eq[i] * 100 : null);

  /* Years of positive operating cash flow in the last five — section 18.3 asks
     for four of five. Counted over the years actually reported, so a company
     with three years of history can never satisfy a five-year test by accident;
     it reports how many were examined alongside how many passed. */
  {
    const w = ocf.slice(-5).filter(isNum);
    m.ocfPosYears = w.length ? w.filter(v => v > 0).length : null;
    m.ocfYearsSeen = w.length;
  }

  /* --- capital allocation ------------------------------------------------ */
  /* Share counts arrive from the filings unadjusted for splits, and a split is
     indistinguishable from issuance to a CAGR. Apple's series runs
     4.75bn -> 17.77bn across its 2020 four-for-one, which this reported as
     "share count rising 12.0% a year, which dilutes per-share growth" — the
     exact opposite of the truth for a company that has bought back stock for a
     decade. NVDA read 51.3% and Alphabet 37.4%, each matching its own split.

     No corporate-action feed exists in this build, so the split cannot be
     undone. What can be done is refusing to describe a discontinuity as
     issuance: a year-on-year move beyond half or above one-and-a-half times is
     a corporate action, not a financing decision — real issuance and buybacks
     do not move a share count by that much in a year. Where one is present the
     measure is withheld and the reason is recorded. */
  const shSeries = sh.filter(isNum);
  let shBreak = null;
  for (let k = 1; k < shSeries.length; k++) {
    const prev = shSeries[k - 1], cur = shSeries[k];
    if (!(prev > 0) || !(cur > 0)) continue;
    const ratio = cur / prev;
    if (ratio > 1.5 || ratio < 0.67) { shBreak = { from: prev, to: cur, ratio: +ratio.toFixed(2) }; break; }
  }
  m.shareSeriesBreak = shBreak;
  const shCagr = shBreak ? null : cagr(sh);
  m.dilution = isNum(shCagr) ? shCagr : null;          /* +ve = issuing */
  m.buyback  = isNum(shCagr) ? -shCagr : null;         /* +ve = shrinking */
  /* EARNINGS AND DIVIDENDS ON DIFFERENT SCALES.
     ---------------------------------------------------------------------
     Charles Schwab published a payout ratio of 22,070%. Its net income is
     stored as 0.005942bn — five point nine MILLION for a business that earned
     five point nine BILLION. The digits are right and the scale is out by a
     thousand, which also made earnings per share 0.0049 against a dividend of
     1.08, and a net margin of 0.037% for one of the most profitable brokers
     in the United States.

     A dividend more than fifty times earnings per share is the tell. No
     dividend policy survives that; it means the two per-share figures were
     built from inputs on different scales. Which of the two is wrong cannot be
     established from here — so everything downstream of the disagreement is
     withheld rather than one of them being quietly "corrected", the same rule
     applied to American Tower's revenue.

     Fifty, not five: a payout of several hundred percent is real in a bad year
     and this must not fire on one. */
  const perShareScaleBroken = isNum(m.eps) && m.eps > 0 && isNum(dps[i]) && dps[i] / m.eps > 50;
  m.perShareScaleBroken = perShareScaleBroken
    ? `A dividend of ${fmtNum(dps[i], 2)} a share against earnings of ${fmtNum(m.eps, 4)} a share is a ratio of ${Math.round(dps[i] / m.eps)}:1. No dividend policy produces that, so the two figures were built from inputs on different scales — most likely a reported value read at the wrong magnitude. Every earnings-derived ratio is withheld until the underlying lines agree.`
    : null;
  m.payout   = isNum(m.eps) && m.eps > 0 && !perShareScaleBroken ? dps[i] / m.eps * 100 : null;
  /* Everything else that divides by the same earnings figure. Withheld here
     rather than at each computation above, because they run before the two
     per-share figures are both in hand — and a metric suppressed in one place
     and left standing in another is worse than either choice made throughout. */
  if (perShareScaleBroken) { m.nm = null; m.roe = null; m.pe = null; m.cashconv = null; }
  m.cashPayout = isNum(m.fcf) && m.fcf > 0 ? (dps[i] * sh[i]) / m.fcf * 100 : null;
  m.reinv    = isNum(ocf[i]) && ocf[i] > 0 ? capex[i] / ocf[i] * 100 : null;

  /* --- market ------------------------------------------------------------ */
  /* Momentum comes from observed closes or it does not exist.

     These fields used to read c.px.m12 and c.px.hi, which are hand-written
     literals on the illustrative companies and absent on every real filing. A
     screen on twelve-month strength therefore returned 36 invented companies
     and 4 real ones, and ranked the invented ones at the top — the least
     trustworthy rows winning the screen outright.

     Now they are computed by the same engine the company page and the Tracked
     view use, from imported or captured history, and are null without it. A
     momentum filter that matches nothing is telling the truth: no price history
     has been imported yet. The illustrative price series is still drawn on the
     sample charts, where it is labelled as an illustration; it is not evidence
     and no longer reaches a screen. */
  const obs = (typeof realSeriesFor === 'function') ? realSeriesFor(c) : null;
  const tr = obs ? trendContext(obs.series) : null;
  m.rs12    = tr && isNum(tr.values.ret12m)  ? tr.values.ret12m  : null;
  m.from52  = tr && isNum(tr.values.ddown)   ? tr.values.ddown   : null;
  m.sma200d = tr && isNum(tr.values.dist200) ? tr.values.dist200 : null;
  m.range52 = (tr && isNum(tr.values.hi52) && isNum(tr.values.lo52) && tr.values.hi52 !== tr.values.lo52)
    ? (tr.last - tr.values.lo52) / (tr.values.hi52 - tr.values.lo52) * 100 : null;
  /* How many observed closes back these four, so the interface can say why a
     momentum field is empty rather than leaving a dash to be guessed at. */
  m.pxPoints = tr ? tr.points : 0;

  /* --- sector-specific ---------------------------------------------------- */
  /* Sector-specific measures are supplementary disclosures, not statement
     lines. A bank ingested from SEC filings has no CET1 or impaired-loan ratio
     because those sit in regulatory returns, so they resolve to null and the
     coverage figure reflects the gap rather than the code throwing. */
  if (isBank && c.bank) { Object.assign(m, { cet1:c.bank.cet1, npl:c.bank.npl, nim:c.bank.nim, cir:c.bank.cir, casa:c.bank.casa, ldr:c.bank.loans/c.bank.dep*100 }); }
  if (isReit && c.reit) { Object.assign(m, { occ:c.reit.occ, wale:c.reit.wale, gearing:c.reit.gearing, cap:c.reit.cap, aff:c.reit.aff });
                m.dpuCover = c.reit.aff && dps[i] ? c.reit.aff / dps[i] * 100 : null;
                m.pnav = m.bvps > 0 ? price / m.bvps : null; }

  /* --- data coverage ------------------------------------------------------
     Coverage is computable ÷ *applicable*. A metric that does not apply to a
     business model is not a gap: enterprise value and free cash flow are not
     meaningful for a deposit-taking balance sheet, so counting them as missing
     would penalise every bank for being a bank. Interest cover stays in the
     denominator everywhere, because that one genuinely is a gap in this
     dataset rather than an inapplicable measure. */
  const dictKeys = ['pe','pb','evebit','pfcf','dy','fcfy','om','nm','fcfm','roe','roic','cashconv',
                    'rev5','eps5','fcf5','dps5','ndEbit','de','icov','dilution','payout','cashPayout','reinv','rs12'];
  const INAPPLICABLE = {
    bank: ['roic','fcfm','fcf5','ndEbit','de','evebit','pfcf','fcfy','cashconv','cashPayout','reinv'],
    insurer: ['roic','ndEbit','evebit'],
    early: ['pe','pfcf','evebit','roic','payout','cashPayout','dps5','dy'],
    reit: [],
  };
  const skip = INAPPLICABLE[c.type] || [];
  const applicable = dictKeys.filter(k => !skip.includes(k));
  const have = applicable.filter(k => isNum(m[k])).length;
  m.coverage = Math.round(have / applicable.length * 100);
  m.inapplicable = skip.length;

  return { fin, rev, ebit, ni, ocf, capex, eq, debt, cash, sh, dps, fcf, eps, bvps, fcfps, m };
}

/* --------------------------------------------------------- scoring engine */
/* Absolute anchors: raw value -> 0..100. Published, inspectable, versioned. */
const anchor = (v, lo, hi, invert = false) => {
  if (!isNum(v)) return null;
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return (invert ? 1 - t : t) * 100;
};

/* ==========================================================================
   RESEARCH-CASE COMPOSITE — section 14

   Five pillars: business quality 35, valuation evidence 30, balance sheet and
   risk 15, catalysts and change 10, macro and sector context 10. Technical
   context is weighted zero and is not consulted here at all — the trend engine
   feeds the price surfaces and stops there.

   Three of the five can be scored. Catalysts needs the registry of section 11
   and macro needs the engine of section 6; neither exists, so a fifth of the
   framework weight has nothing behind it.

   The composite is therefore reported over the weight actually tested, and the
   tested weight is reported with it. It is NOT renormalised to 100. Spreading
   the missing 20 points across the three surviving pillars would score
   catalysts and macro as though each had been examined and found average, which
   is precisely the move section 4.1 prohibits — a company cannot earn points
   for a metric that was not tested. Scoring them zero would be the mirror
   error, penalising a company for the product's own gap.

   Section 14 decomposes business quality differently from section 7: there it
   is one pillar of five at 35% here, while section 7 splits it into its own
   five. The app's quality, growth and capital pillars each stand for one of
   section 7's five, so they combine into this 35% in equal thirds; the app's
   strength pillar is section 14's separate balance-sheet weight. Moat is absent
   from both, as declared in the coverage table below.
   ========================================================================== */
const COMPOSITE_PILLARS = [
  { id:'quality', label:'Business Quality', w:35,
    get: (r) => {
      /* Equal thirds of the section 7 pillars this build actually scores. */
      const parts = [r.scores.quality?.score, r.scores.growth?.score, r.scores.capital?.score].filter(isNum);
      return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    },
    from: 'the business quality, growth quality and capital allocation pillars' },
  { id:'value',  label:'Valuation Evidence', w:30, get: (r) => r.scores.value?.score,
    from: 'the valuation pillar' },
  { id:'risk',   label:'Balance Sheet and Risk', w:15, get: (r) => r.scores.strength?.score,
    from: 'the financial strength pillar' },
  { id:'catalysts', label:'Catalysts and Change', w:10, get: () => null,
    absent:'The catalyst registry of section 11 does not exist, so no catalyst has been counted, dated or expired for any company.' },
  { id:'macro',  label:'Macro and Sector Context', w:10, get: () => null,
    absent:'The macro engine of section 6 does not exist — no cycle state, rate context, currency exposure or policy evidence is carried.' },
];

/* Section 14.2, in the section 2 language: a state, never an instruction. */
const COMPOSITE_BANDS = [
  { min:85, state:'Research criteria strongly met', next:'Open the evidence behind each pillar, then record a thesis if you agree with it.' },
  { min:70, state:'Several criteria met',           next:'Read the unmet criteria and the valuation sensitivities before going further.' },
  { min:55, state:'Mixed research case',            next:'Review the weaker pillars individually; the aggregate is not informative at this level.' },
  { min:0,  state:'Research criteria not met',      next:'Read the failed gates and the missing evidence rather than the score.' },
];

function researchComposite(r) {
  const parts = COMPOSITE_PILLARS.map(p => ({ ...p, score: p.get(r) }));
  const tested = parts.filter(p => isNum(p.score));
  const testedWeight = tested.reduce((s, p) => s + p.w, 0);
  const untested = parts.filter(p => !isNum(p.score));

  /* Weighted over the tested weight only, and the divisor is reported. */
  const score = testedWeight
    ? Math.round(tested.reduce((s, p) => s + p.score * p.w, 0) / testedWeight)
    : null;

  /* Section 14.3. Coverage below 70% yields no aggregate classification at all,
     and that is a per-company data test, separate from the weight above. */
  const dataCoverage = isNum(r.m.coverage) ? r.m.coverage : 0;
  const classified = isNum(score) && dataCoverage >= 70;

  /* Section 7.1 makes governance a hard gate and section 4.1 makes an untested
     hard gate manual review rather than a pass. No governance register exists,
     so no company in this build can be cleared of it. That is a standing
     condition of the product, identical for every company, so it is stated once
     as a property of the composite rather than raised as a per-company alarm
     that carries no per-company information. */
  const gates = [{ id:'governance', state:'manual_review',
    why:'No governance event register exists, so the governance hard gate is untested for every company. An untested hard gate is manual review, never a pass.' }];
  if (!classified && isNum(score))
    gates.push({ id:'coverage', state:'not_classified',
      why:`Data completeness is ${dataCoverage}%, below the 70% the framework requires before an aggregate classification may be shown.` });

  const band = classified ? COMPOSITE_BANDS.find(b => score >= b.min) : null;
  return { score, band, classified, testedWeight, dataCoverage, parts, tested, untested, gates };
}

/* ==========================================================================
   SCORECARD COVERAGE AGAINST THE FIVE-PILLAR FRAMEWORK

   The framework weights five pillars at 20% each. This product scores four
   pillars of its own, and every factor in them is a financial-statement ratio.
   Nothing here tests a moat, an owner, a board or a disclosure practice.

   That gap cannot be closed with the data this build holds, and inventing a
   moat score from return on capital would be the specific move section 7.5
   prohibits — a moat inferred from a financial outcome is a restatement of the
   outcome, not evidence of a barrier. So the gap is declared instead.

   Read with section 4.1: a company cannot earn points for a metric that was not
   tested, and a score has to be shown beside its tested coverage. A reader
   holding the framework would otherwise take "Business Quality 82" to include
   the moat and management judgements it weights at a fifth each, and it does
   not include them at all.
   ========================================================================== */
const SCORECARD_COVERAGE = [
  { pillar: 'Revenue Quality', weight: 20, state: 'partial',
    tested: ['Operating margin', 'Free cash flow margin', 'Revenue growth stability', 'Revenue CAGR'],
    untested: ['Recurring or contracted share of revenue', 'Customer concentration', 'Geographic and product diversification', 'Cash collection and receivable quality'],
    why: 'Segment and customer disclosures are narrative in the filings and are not carried in this dataset.' },
  { pillar: 'Balance Sheet', weight: 20, state: 'tested',
    tested: ['Net debt / EBIT', 'Debt / equity', 'Net gearing', 'Gearing ratio and CET1 where the model applies'],
    untested: ['Interest coverage', 'Current ratio', 'Debt maturity profile and refinancing risk'],
    why: 'Interest expense and current assets and liabilities are not yet extracted from the filings; the metrics report as missing rather than being estimated.' },
  { pillar: 'Competitive Moat', weight: 20, state: 'not scored',
    tested: [],
    untested: ['Moat type', 'Durability', 'Supporting and counter-evidence', 'Analyst confidence'],
    why: 'Moat evidence is analyst work. It is recorded and shown on the Moat tab where it exists, and marked "Not assessed" on every company loaded from filings alone. It is never scored, and it is never inferred from returns — section 7.5 forbids generating a moat from sector identity or financial outcome.' },
  { pillar: 'Management', weight: 20, state: 'partial',
    tested: ['Net buyback yield', 'Payout ratio', 'Dividend cover by free cash flow', 'Return on reinvestment', 'Share count growth'],
    untested: ['Insider ownership and changes', 'Board independence', 'Audit opinion and auditor changes', 'Related-party transactions', 'Guidance accuracy'],
    why: 'Capital allocation is visible in the statements and is scored. Governance and ownership are not in this dataset, and the governance event register of section 8 does not exist yet. Share counts are filed unadjusted for splits and no corporate-action source is licensed here, so on any company whose series contains a split the two share-based inputs are withheld rather than measured — the pillar re-bases over what remains and its coverage falls to match.' },
  { pillar: 'Growth Visibility', weight: 20, state: 'partial',
    tested: ['Revenue CAGR', 'Earnings CAGR', 'Free cash flow CAGR', 'Earnings consistency'],
    untested: ['Order book and contracted revenue', 'Capacity additions', 'Catalyst pipeline', 'Forward earnings visibility'],
    why: 'Every growth factor scored here is historic. Nothing in this score is forward-looking, and a company with a deteriorating order book and four strong past years scores well on it.' },
];

const PILLARS = {
  quality: {
    label: 'Business Quality',
    general: [
      { k:'roic',     w:.35, label:'Return on invested capital', lo:2,  hi:30, fmt:v=>fmtPct(v) },
      { k:'om',       w:.25, label:'Operating margin',           lo:2,  hi:35, fmt:v=>fmtPct(v) },
      { k:'fcfm',     w:.20, label:'Free cash flow margin',      lo:0,  hi:30, fmt:v=>fmtPct(v) },
      { k:'revVol',   w:.20, label:'Revenue growth stability',   lo:3,  hi:40, inv:true, fmt:v=>`${fmtNum(v)} s.d.` },
    ],
    bank: [
      { k:'roe',  w:.40, label:'Return on equity',      lo:5,  hi:18, fmt:v=>fmtPct(v) },
      { k:'nim',  w:.25, label:'Net interest margin',   lo:1.6,hi:3.2,fmt:v=>fmtPct(v,2) },
      { k:'cir',  w:.25, label:'Cost-to-income ratio',  lo:30, hi:60, inv:true, fmt:v=>fmtPct(v) },
      { k:'npl',  w:.10, label:'Gross impaired loans',  lo:0.4,hi:4,  inv:true, fmt:v=>fmtPct(v,2) },
    ],
    reit: [
      { k:'occ',    w:.30, label:'Portfolio occupancy',    lo:85, hi:100, fmt:v=>fmtPct(v) },
      { k:'om',     w:.25, label:'Net property margin',    lo:55, hi:82,  fmt:v=>fmtPct(v) },
      { k:'wale',   w:.25, label:'Weighted lease expiry',  lo:1.5,hi:10,  fmt:v=>`${fmtNum(v)} yrs` },
      { k:'dpuCover',w:.20,label:'AFFO cover of DPU',      lo:90, hi:130, fmt:v=>fmtPct(v) },
    ],
  },
  growth: {
    label: 'Growth Quality',
    general: [
      { k:'rev5', w:.30, label:'Revenue CAGR (4y)',      lo:-2, hi:22, fmt:v=>fmtPct(v) },
      { k:'eps5', w:.30, label:'Earnings CAGR (4y)',     lo:-4, hi:25, fmt:v=>fmtPct(v) },
      { k:'fcf5', w:.20, label:'Free cash flow CAGR (4y)',lo:-6,hi:25, fmt:v=>fmtPct(v) },
      { k:'epsVol',w:.20,label:'Earnings consistency',   lo:5,  hi:60, inv:true, fmt:v=>`${fmtNum(v)} s.d.` },
    ],
  },
  strength: {
    label: 'Financial Strength',
    general: [
      { k:'ndEbit', w:.45, label:'Net debt / EBIT',        lo:0,  hi:5,  inv:true, fmt:v=>fmtX(v) },
      { k:'de',     w:.25, label:'Debt / equity',          lo:0,  hi:2.5,inv:true, fmt:v=>fmtX(v,2) },
      /* Net gearing and years of positive operating cash flow were written into
         this array in the metric-dictionary shape — g/formula/miss/note rather
         than w/lo/hi. A pillar input without a weight rendered "NaN%" in the
         Weight column and an unanchorable row that could never score, so both
         now live in FIELDS where that shape belongs. They are computed and
         published; they are deliberately not scored inputs, because giving them
         an anchor and a weight would change every Financial Strength score and
         that is a model version, not a rendering fix. */
      { k:'fcfm',   w:.15, label:'Free cash flow margin',  lo:-5, hi:25, fmt:v=>fmtPct(v) },
      { k:'bv5',    w:.15, label:'Book value CAGR (4y)',   lo:-5, hi:18, fmt:v=>fmtPct(v) },
    ],
    bank: [
      { k:'cet1', w:.40, label:'CET1 capital ratio',   lo:11, hi:17, fmt:v=>fmtPct(v) },
      { k:'npl',  w:.35, label:'Gross impaired loans', lo:0.4,hi:4,  inv:true, fmt:v=>fmtPct(v,2) },
      { k:'ldr',  w:.25, label:'Loan / deposit ratio', lo:75, hi:105,inv:true, fmt:v=>fmtPct(v) },
    ],
    reit: [
      { k:'gearing', w:.55, label:'Gearing ratio',       lo:15, hi:50, inv:true, fmt:v=>fmtPct(v) },
      { k:'dpuCover',w:.25, label:'AFFO cover of DPU',   lo:90, hi:130, fmt:v=>fmtPct(v) },
      { k:'bv5',     w:.20, label:'NAV per unit CAGR',   lo:-3, hi:10, fmt:v=>fmtPct(v) },
    ],
  },
  capital: {
    label: 'Capital Allocation',
    general: [
      { k:'buyback',    w:.25, label:'Net buyback yield',        lo:-4, hi:4,  fmt:v=>fmtPct(v) },
      { k:'payout',     w:.25, label:'Payout ratio',             lo:95, hi:25, fmt:v=>fmtPct(v) },
      { k:'cashPayout', w:.25, label:'Dividend cover by FCF',    lo:110,hi:30, fmt:v=>fmtPct(v) },
      { k:'roic',       w:.25, label:'Return on reinvestment',   lo:2,  hi:30, fmt:v=>fmtPct(v) },
    ],
    bank: [
      { k:'payout', w:.40, label:'Payout ratio',        lo:85, hi:35, fmt:v=>fmtPct(v) },
      { k:'cet1',   w:.35, label:'Capital retained (CET1)', lo:11, hi:17, fmt:v=>fmtPct(v) },
      { k:'dps5',   w:.25, label:'Dividend CAGR (4y)',   lo:-3, hi:15, fmt:v=>fmtPct(v) },
    ],
    reit: [
      { k:'dilution', w:.40, label:'Unit issuance',        lo:8,  hi:0,  fmt:v=>fmtPct(v) },
      { k:'dps5',     w:.35, label:'DPU CAGR (4y)',        lo:-3, hi:12, fmt:v=>fmtPct(v) },
      { k:'gearing',  w:.25, label:'Gearing headroom',     lo:15, hi:50, inv:true, fmt:v=>fmtPct(v) },
    ],
  },
};

function pillarInputs(pillar, c) {
  const def = PILLARS[pillar];
  return def[c.type] || def[c.type === 'bank' ? 'bank' : c.type === 'reit' ? 'reit' : 'general'] || def.general;
}

function scorePillar(pillar, c, d) {
  const inputs = pillarInputs(pillar, c);
  let wsum = 0, acc = 0;
  const parts = inputs.map(inp => {
    const raw = d.m[inp.k];
    const s = anchor(raw, inp.lo, inp.hi, inp.inv);
    if (isNum(s)) { acc += s * inp.w; wsum += inp.w; }
    return { ...inp, raw, score: s };
  });
  return { score: wsum > 0 ? Math.round(acc / wsum) : null, coverage: Math.round(wsum * 100), parts };
}

/* --------------------------------------------------------- risk assessment */
/* Every flag is computed from the statements — none are hand-assigned. */
function riskFlags(c, d) {
  const m = d.m, out = [];
  const add = (sev, title, detail, metric) => out.push({ sev, title, detail, metric });

  if (isNum(m.ndEbit)) {
    if (m.ndEbit > 3.5)      add('serious', 'Elevated leverage', `Net debt is ${fmtX(m.ndEbit)} EBIT — above the 3.5× threshold used in this model.`, 'ndEbit');
    else if (m.ndEbit < 0)   add('good', 'Net cash balance sheet', `Cash exceeds debt by ${fmtCap(Math.abs(m.netDebt), c.ccy)}.`, 'netDebt');
  }
  if (c.type === 'bank' && isNum(m.npl) && m.npl > 2.0)
    add('warning', 'Impaired loans above peer set', `Gross impaired loans of ${fmtPct(m.npl,2)} sit above the ${fmtPct(1.5,1)} peer median in this sample.`, 'npl');
  if (isNum(m.epsVol) && m.epsVol > 35)
    add('warning', 'High earnings variability', `Year-on-year net income growth has a standard deviation of ${fmtNum(m.epsVol)} points.`, 'epsVol');
  if (isNum(m.revDD) && m.revDD > 20)
    add('warning', 'Cyclical revenue drawdown', `Revenue fell ${fmtPct(m.revDD)} peak-to-trough within the reported window.`, 'revDD');
  if (isNum(m.dilution) && m.dilution > 1.5)
    add('warning', 'Share count rising', `Shares in issue have grown ${fmtPct(m.dilution)} a year, diluting per-share growth.`, 'dilution');
  if (isNum(m.cashPayout) && m.cashPayout > 100)
    add('serious', 'Distribution exceeds free cash flow', `Dividends paid are ${fmtPct(m.cashPayout,0)} of free cash flow — funded from the balance sheet, not from operations.`, 'cashPayout');
  if (isNum(m.fcf) && m.fcf < 0)
    add('serious', 'Negative free cash flow', `Capital expenditure exceeds operating cash flow in the latest reported year.`, 'fcf');
  /* These two fire on the WITHHELD flag rather than on the value, because the
     value is now null — a metric suppressed with no flag beside it looks like
     data that was never collected rather than data that disagreed with itself. */
  if (m.roeWithheld)
    add('warning', 'Equity base near zero', m.roeWithheld, 'roe');
  if (m.revenueSuspect)
    add('serious', 'Revenue line does not reconcile', m.revenueSuspect, 'om');
  if (m.perShareScaleBroken)
    add('serious', 'Earnings and dividends disagree on scale', m.perShareScaleBroken, 'payout');
  if (c.type === 'reit' && isNum(m.gearing) && m.gearing > 40)
    add('warning', 'Gearing approaching the regulatory ceiling', `Gearing of ${fmtPct(m.gearing)} leaves limited headroom for debt-funded acquisition.`, 'gearing');
  if (c.flags?.pn17) add('critical', 'PN17 status', 'Company is classified under Practice Note 17 and is subject to a regularisation plan.', null);
  if (c.qrisk) add('warning', 'Qualitative risk (analyst review)', c.qrisk, null);
  return out;
}

const RISK_WEIGHT = { critical: 40, serious: 22, warning: 11, good: -10 };
function riskGrade(flags) {
  const raw = clamp(sum(flags.map(f => RISK_WEIGHT[f.sev] || 0)), 0, 100);
  return { raw, band: raw >= 45 ? 'High' : raw >= 22 ? 'Medium' : 'Low' };
}

