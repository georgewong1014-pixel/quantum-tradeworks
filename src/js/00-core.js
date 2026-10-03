"use strict";
/* ==========================================================================
   Quantum Tradeworks — evidence-led research prototype
   --------------------------------------------------------------------------
   ALL FIGURES ARE SYNTHETIC. Raw statement lines are stored once per company
   and every ratio is derived at runtime, so the metric dictionary can show the
   real formula and the exact inputs behind each number.
   ========================================================================== */

/* --------------------------------------------------------- data versions */
/* Content hashes of the data files that ship with this build, stamped in by
   build.mjs. dataUrl() turns each one into ?v=<hash>, which makes every data URL
   content-addressed: the bytes behind a URL can never change, so the CDN and the
   browser may hold it for a year, and a data update simply arrives as a new URL.

   Before this, fetchJson sent cache: 'no-store' for everything and us.json —
   1.4MB — was re-downloaded on every single navigation.

   Files absent from this table are the licensed lane. They are git-ignored, they
   exist only on the reader's own machine, and they keep no-store. */
const DATA_VERSIONS = /*@INJECT:dataversions*/;

/* WHETHER THIS BROWSER HELD ANYTHING OF THE READER'S BEFORE THE APP RAN
   (2026-10-04). A static route's page is served with the app's own render of
   it (prerender.mjs), drawn for a visitor whose browser holds nothing — and a
   page that waits for the filed statements kept that render on screen after
   the script had run, until they landed (drawPage, 35-ui.js). To a returning
   reader it then said, for seconds after the script had read their storage,
   that their own watchlists were "sample watchlists … not yours", "0 of 4
   done", the Free plan "Current" for a reader on another, and showed again a
   panel they had hidden. Read here, first, before any module writes a key
   (the sample data a first visit is given is written later), so that the
   served page stands only for a browser that is what it was drawn for. */
const READER_HELD_AT_START = (() => {
  try { for (let i = 0; i < localStorage.length; i++) if (String(localStorage.key(i)).startsWith('vl.')) return true; }
  catch { /* storage switched off: nothing is held */ }
  return false;
})();

/* ------------------------------------------------------------------ utils */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'data') Object.entries(v).forEach(([dk, dv]) => node.dataset[dk] = dv);
    else node.setAttribute(k, v);
  }
  kids.flat().forEach(kid => { if (kid != null && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(kid)); });
  return node;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = (a) => a.reduce((t, v) => t + (v || 0), 0);
const last = (a) => a[a.length - 1];
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
/* A date as the reader's calendar has it. toISOString().slice(0, 10) is the
   UTC date, which from 16:00 to midnight in Los Angeles — and from midnight
   to 08:00 in Kuala Lumpur — is a different day: a watchlist made on the
   28th read "created 2026-09-29", and a dividend's "Date paid" defaulted to
   tomorrow. localDayOf takes a stored timestamp to the reader's date; a bare
   date (no clock time to place) is already one and is kept as it is. */
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const localDayOf = (v) => {
  const s = String(v ?? '');
  if (s.length <= 10) return s;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? localDay(d) : s.slice(0, 10);
};

/* CAGR over an array; null when the base is non-positive (a growth rate off a
   negative base is meaningless — we surface "n/m" rather than a fake number). */
function cagr(series) {
  const a = series[0], b = last(series), n = series.length - 1;
  if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0 || n < 1) return null;
  return (Math.pow(b / a, 1 / n) - 1) * 100;
}

/* ------------------------------------------------------------- formatting */
const NA = '<span class="caption" title="Not available or not meaningful for this company type">n/a</span>';
/* Distinct from n/a: the figure exists in principle and was withheld, because
   the share count moves by a corporate action inside the window and a
   per-share rate across that boundary would measure the split. */
const NA_SPLIT = '<span class="caption" title="Withheld: the share count moves by a corporate action inside this window, so a growth rate over a per-share line would measure the split, not the company.">withheld</span>';

function fmtNum(v, dp = 1) {
  if (!isNum(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtPct(v, dp = 1) {
  if (!isNum(v)) return '—';
  /* Round to the displayed precision first, so a value that renders as zero
     never picks up a stray minus sign. */
  if (Math.abs(v) < Math.pow(10, -dp) / 2) v = 0;
  return `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(dp)}%`;
}
/* Rounded before it is signed, as fmtPct is, and with the same minus. A bare
   toFixed printed Nvidia's net cash — net debt of −0.016× EBIT — as "-0.0×"
   on its Quality tab and in Compare: a zero with a hyphen in front of it. */
function fmtX(v, dp = 1) {
  if (!isNum(v)) return '—';
  if (Math.abs(v) < Math.pow(10, -dp) / 2) v = 0;
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}×`;
}

function fmtCap(v, ccy) {
  if (!isNum(v)) return '—';
  const sym = ccy === 'MYR' ? 'RM' : '$';
  const a = Math.abs(v);
  /* The unit is chosen on the figure as it will print: 999.97 billion rounds
     to "1000.0B" and 0.9997 billion to "1000M", which belong a unit up. */
  const body = a >= 999.95 ? `${(a / 1000).toFixed(2)}T`
    : a >= 0.9995 ? `${a.toFixed(1)}B`
    : `${(a * 1000).toFixed(0)}M`;
  /* Sign leads the symbol — "−$51.5B", never "$-51.5B" — and, as fmtMoney's
     does, belongs to the figure as it prints. It was taken from the raw value,
     so anything under half a million below zero printed "−$0M": a zero with a
     minus in front of it. */
  const sign = v < 0 && /[1-9]/.test(body) ? '−' : '';
  return `${sign}${sym}${body}`;
}
function fmtMoney(v, ccy, dp = 2) {
  if (!isNum(v)) return '—';
  const sym = ccy === 'MYR' ? 'RM' : '$';
  /* Group thousands, and carry the sign ahead of the symbol. This used to be a
     bare toFixed, which printed the worst case of a cash-secured put as
     "$-4891.00": no separator, so a four-figure obligation is read digit by
     digit, and a minus wedged between the currency and the number, where it
     reads as part of the symbol rather than as the sign of the quantity.
     Rounding to the displayed precision FIRST, so a value that lands on zero
     prints "$0.00" rather than "−$0.00" — the payoff crosses zero at the
     break-even by construction, and floating point put it a hair below. */
  const r = Math.abs(v) < 0.5 / 10 ** dp ? 0 : v;
  return `${r < 0 ? '−' : ''}${sym}${Math.abs(r).toLocaleString('en-US',
    { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
function signClass(v) { return !isNum(v) || Math.abs(v) < 0.005 ? '' : (v > 0 ? 'pos' : 'neg'); }

/* For price-versus-model differences specifically. Deliberately NOT signClass:
   a discount to a modelled estimate is not a profit, and rendering it in the
   same green as a real gain turns an assumption into an implied instruction. */
function diffClass(v) {
  if (!isNum(v) || Math.abs(v) < 0.005) return 'mdiff';
  return v > 0 ? 'mdiff-below' : 'mdiff-above';
}
function withSign(v, dp = 1, suffix = '%') {
  if (!isNum(v)) return '—';
  if (Math.abs(v) < Math.pow(10, -dp) / 2) v = 0;
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}${suffix}`;
}

/* English ordinal suffix. Percentiles were rendering as "92th" and "42th"
   because the suffix was a hardcoded literal. 11, 12 and 13 take "th" despite
   ending in 1, 2 and 3, which is why this is a lookup rather than a switch on
   the last digit alone. */
function ord(n) {
  if (!isNum(n)) return '—';
  const i = Math.trunc(Math.abs(n)), t = i % 100, u = i % 10;
  const sfx = (t >= 11 && t <= 13) ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th';
  return `${Math.trunc(n)}${sfx}`;
}

/* ==========================================================================
   METRIC EXPLANATIONS — three depths, simple by default

   The same measure has to answer three different questions depending on who is
   reading: what does this word mean, why would I look at it for THIS kind of
   business, and exactly how was it computed. Showing all three at once buries
   the first reader; showing only the third is what most finance tools do and
   is why they are unreadable to the person who needs them most.

   Simple is the default and it is written for someone who has not used a ratio
   before. It never uses another undefined term to define a term.
   ========================================================================== */
const METRIC_HELP = {
  /* The screener measures — returns, margins, multiples and the rest — are
     defined in the metric registry (13-metrics.js), which adds each one here
     as it loads. What stays is what is not a screener measure. */
  coverage: { label: 'Data completeness',
    simple: 'How much of the information needed to analyse this company is actually present.',
    context: 'A low figure does not mean the company is bad — it means this page knows less about it. Confidence is reduced instead of the gaps being filled in with estimates.',
    technical: 'Computable metrics ÷ metrics applicable to this business model. Measures that do not apply are excluded from the denominator rather than counted as missing.' },
  mos: { label: 'Difference to model estimate',
    simple: 'How far today’s price sits from what this model estimates, given the assumptions shown.',
    context: 'A large difference means the model and the market disagree. That is a reason to examine the assumptions, not a signal — the market may be right and the model wrong.',
    technical: '(Base-case model estimate − price) ÷ price. The base case is an output of the assumptions listed beside it.' },
  dscr: { label: 'Debt-service cover',
    simple: 'Whether the rent covers the loan repayments, and by how much.',
    context: 'Below 1.0 the shortfall comes out of your own income every month. Lenders generally want comfortably above 1.0 before the rent is treated as self-supporting.',
    technical: 'Net operating income ÷ annual debt service.' },
  grossYield: { label: 'Gross yield',
    simple: 'A year of rent as a percentage of the purchase price, before any costs.',
    context: 'Useful only for a first comparison between properties. It ignores maintenance, vacancy, tax and the loan, all of which decide whether the property actually pays.',
    technical: 'Annual gross rent ÷ purchase price.' },
  netYield: { label: 'Net yield',
    simple: 'Rent left after running costs, as a percentage of the purchase price.',
    context: 'Closer to the truth than gross yield because it subtracts what the property costs to hold. Still before the loan.',
    technical: 'Net operating income ÷ purchase price, where NOI is effective rent less operating costs.' },
};

/* Remembered so a reader who wants the technical depth is not returned to the
   simple one on every metric they open.

   Read lazily: this block sits above the State and store declarations, and
   touching either at module scope here is a temporal dead zone error that
   takes the whole page down on load. */
const explainDepth = () => (State.explainDepth ??= store.read('explainDepth', 'simple'));
const setExplainDepth = (v) => { State.explainDepth = v; store.write('explainDepth', v); };

function explainMetric(key, opts = {}) {
  const h = METRIC_HELP[key];
  if (!h) return;
  const body = el('div', { class: 'stack' });

  const DEPTHS = [['simple', 'Simple'], ['context', 'Investor context'], ['technical', 'Technical']];
  const seg = el('div', { class: 'segmented' });
  DEPTHS.forEach(([id, label]) => seg.append(el('button', {
    'aria-pressed': explainDepth() === id ? 'true' : 'false',
    onclick: () => { setExplainDepth(id); explainMetric(key, opts); },
  }, label)));
  body.append(seg);

  body.append(el('p', { class: 'body-lg' }, h[explainDepth()] || h.simple));

  if (opts.value != null) {
    body.append(el('div', { class: 'panel' }, statTile(opts.valueLabel || h.label, opts.value,
      { sub: opts.valueSub || null })));
  }
  if (explainDepth() !== 'technical') {
    body.append(el('p', { class: 'metaline' },
      'Switch to Technical above for the exact formula and period.'));
  }
  openDrawer(h.label, body);
}

/* A metric label that can be asked about. The affordance is a real button so
   it is reachable by keyboard and announced as one. */
function metricLabel(key, text, opts = {}) {
  const h = METRIC_HELP[key];
  const label = text || h?.label || key;
  if (!h) return el('span', {}, label);
  return el('button', {
    class: 'metric-label', type: 'button',
    'aria-label': `${label} — what this means`,
    onclick: () => explainMetric(key, opts),
  }, [el('span', {}, label), el('span', { class: 'metric-label-q', 'aria-hidden': 'true' }, '?')]);
}

/* ---------------------------------------------------------------- palette */
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
/* Diverging ramp, warm/cool poles with a neutral gray midpoint. */
const DIVERGING = ['--dn-5', '--dn-4', '--dn-3', '--dn-2', '--dn-1', '--mid', '--up-1', '--up-2', '--up-3', '--up-4', '--up-5'];
const SEQUENTIAL = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'];

/* Map a signed value to a diverging step. `full` is the magnitude that saturates. */
function divergingVar(v, full) {
  if (!isNum(v)) return '--mid';
  const t = clamp(v / full, -1, 1);
  const idx = Math.round((t + 1) / 2 * (DIVERGING.length - 1));
  return DIVERGING[idx];
}
function sequentialVar(t) { return SEQUENTIAL[clamp(Math.round(t * (SEQUENTIAL.length - 1)), 0, SEQUENTIAL.length - 1)]; }

/* Pick ink or white for a label sitting inside a coloured fill — whichever of
   the two contrasts more with it. The switch was at luminance 0.42, which put
   white on every mid-tone step: 2.48:1 on light --up-3, 2.87:1 on --dn-3,
   2.29:1 on dark --dn-5, on the heatmap tiles and the sensitivity grid. The
   two contrasts cross at about 0.18, and black rather than the near-black
   #141a18 is what keeps the worse side of that crossing at 4.58:1 — with
   #141a18 light --up-4 could reach only 4.35:1. Every diverging step now
   clears 4.5:1 in both themes (4.67:1 at worst). */
function inkOn(hex) {
  const m = hex.replace('#', '');
  if (m.length < 6) return '#fff';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#000000';
}

/* ------------------------------------------------------------------ state */
/* THE SHAPE EACH KEPT KEY IS WRITTEN IN.
   A restore wrote whatever the file held ("Restore from a file" checked the
   format and the key names, never the values), so a hand-edited or truncated
   export with "portfolios": {…} — one portfolio, not a list of them — was
   accepted, and every workspace page threw on .filter or .forEach. The throw
   reached the top level of the one script, so the filings never loaded
   either, and it survived every reload: /my/data, which could put it right,
   was the only page left standing. Each key the export carries is declared
   here in the shape this app writes it. A restore refuses a value in any
   other shape, key by key, with the reason; and store.read gives back a
   value already stored in another shape as the app can read it, so a
   browser that took such a file before this check existed works again
   without its storage being cleared by hand. A list keeps its readable
   entries and drops the rest, as migrateWatchlists does for watchlists.
   What has nothing readable left is absent — the caller's fallback, as for
   a key never written — except the three lists the first visit seeds:
   those read as they do once the samples are cleared, the reader's own and
   empty (clearSeededData), which is what migrateWatchlists already does
   for the watchlists, rather than as the samples come back. */
const isRecord = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const SHAPE_RECORDS = { list: true, item: isRecord, what: 'a record' };
const SHAPE_RECORD = { ok: isRecord, what: 'a record' };
const STORE_SHAPES = {
  /* activePF() reads the first portfolio and the views assume it exists, and
     every one of them maps its holdings. */
  portfolios: { list: true, nonEmpty: true, what: 'a portfolio with a list of holdings',
                item: (p) => isRecord(p) && Array.isArray(p.holdings) && p.holdings.every(isRecord),
                emptied: () => [{ id: 'pf-user', name: 'My portfolio', cash: 0, cashCcy: 'MYR', holdings: [] }] },
  /* The case card and its evaluation read these three lists unguarded. */
  theses: { list: true, what: 'an investment case with its lists of conditions, catalysts and risks',
            item: (t) => isRecord(t) && ['conds', 'catalysts', 'risks'].every(k => Array.isArray(t[k])), emptied: () => [] },
  /* migrateWatchlists makes the one empty list of the reader's own. */
  watchlists: { ...SHAPE_RECORDS, emptied: () => [] }, priceAlerts: { ...SHAPE_RECORDS, emptied: () => [] },
  observations: SHAPE_RECORDS, registerLog: SHAPE_RECORDS, corrections: SHAPE_RECORDS,
  opportunities: SHAPE_RECORDS, wheelLegs: SHAPE_RECORDS, dividendsReceived: SHAPE_RECORDS,
  savedScreens: SHAPE_RECORDS, savedWork: SHAPE_RECORDS, runs: SHAPE_RECORDS, sarawakExposure: SHAPE_RECORDS, comparisons: SHAPE_RECORDS,
  areaProfiles: SHAPE_RECORD, demand: SHAPE_RECORD, deal: SHAPE_RECORD, wheelPlan: SHAPE_RECORD, qttiPlan: SHAPE_RECORD,
  manualPrices: SHAPE_RECORD, userData: SHAPE_RECORD, wht: SHAPE_RECORD, reviews: SHAPE_RECORD, borrowerProfile: SHAPE_RECORD,
  valuation: SHAPE_RECORD, scanSetups: SHAPE_RECORD, scanAlertState: SHAPE_RECORD, scanPrefs: SHAPE_RECORD,
  registerActor: { ok: (v) => typeof v === 'string', what: 'text' },
  baseCcy: { ok: (v) => v === 'MYR' || v === 'USD', what: 'MYR or USD' },
};
const kindOfValue = (v) => v === null ? 'nothing' : Array.isArray(v) ? 'a list' : typeof v === 'object' ? 'a record'
  : typeof v === 'string' ? `the text “${v.slice(0, 24)}”` : typeof v === 'number' ? 'a number' : typeof v === 'boolean' ? 'true or false' : typeof v;
/* Why a value is not in its key's shape, or null when it is. */
function storedShapeFault(k, v) {
  const s = STORE_SHAPES[k];
  if (!s) return null;
  if (s.list) {
    if (!Array.isArray(v)) return `holds ${kindOfValue(v)} where this app writes a list`;
    if (s.nonEmpty && !v.length) return 'holds an empty list, and this app always keeps at least one';
    const bad = v.filter(x => !s.item(x)).length;
    return bad ? `has ${bad} of ${v.length} entries that ${bad === 1 ? 'is not' : 'are not'} ${s.what}` : null;
  }
  return s.ok(v) ? null : `holds ${kindOfValue(v)} where this app writes ${s.what}`;
}
/* A stored value as the app can read it: itself, its readable entries, its
   emptied state, or undefined for absent. null is left as null — the app
   writes it itself (a cleared borrower profile), and store.read has always
   returned it. */
function readAsWritten(k, v) {
  const s = STORE_SHAPES[k];
  if (!s || v === null) return v;
  const none = () => (s.emptied ? s.emptied() : undefined);
  if (!s.list) return s.ok(v) ? v : none();
  if (!Array.isArray(v)) return none();
  const kept = v.filter(s.item);
  if (kept.length === v.length) return s.nonEmpty && !v.length ? none() : v;
  return kept.length ? kept : none();
}
const store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem('vl.' + key);
      if (!raw) return fallback;
      const v = readAsWritten(key, JSON.parse(raw));
      return v === undefined ? fallback : v;
    } catch { return fallback; }
  },
  /* A refused write — the quota full, storage switched off, private mode — is
     still swallowed, so the page keeps working in memory; but it returns
     false and is counted, because a caller that says "Saved" has to be able
     to know. With the quota full the tools confirmed 'Saved "Deal A"' over a
     record that was never written, and a reader who trusted it lost the work
     at the next reload. `failed` lets an action that makes several writes ask
     whether any of them was refused. */
  failed: 0,
  write(key, value) {
    try { localStorage.setItem('vl.' + key, JSON.stringify(value)); return true; }
    catch { store.failed++; return false; }
  }
};
const STORE_REFUSED = 'Not saved — this browser refused the write (its storage is full or switched off), so nothing was kept.';

/* EVERYTHING A READER HAS MADE, IN ONE PLACE.
   ---------------------------------------------------------------------------
   All of it lives in this browser's localStorage. A cleared browser, a second
   laptop, private mode, or a phone instead of a desk destroys the lot with no
   copy anywhere — and there was no way to carry it either. Somebody who models
   a property, writes two investment cases and sources a district's transactions
   has done hours of work that one wrong click ends.

   The list is explicit rather than "every vl.* key" so that adding a key does
   not silently start exporting something the reader did not expect to travel —
   and so each one can say what it is. */
const PORTABLE_KEYS = [
  { k:'portfolios',   label:'Portfolios and holdings' },
  { k:'theses',       label:'Investment cases' },
  { k:'watchlists',   label:'Watchlists' },
  { k:'observations', label:'Property comparables' },
  { k:'areaProfiles', label:'Area attributes' },
  /* The history travels WITH the figures. An export holding only the current
     values is a register that arrives on the other machine unauditable — and
     it is also what makes an import mergeable rather than a replacement. */
  /* Added with the demand test. Its absence meant a backup carried the
     observations and the area attributes and silently dropped every demand
     record — the reader would have restored on a new machine and found IPS §6.5
     unanswered for every locality, with nothing saying why. */
  { k:'demand',       label:'Demand sources' },
  { k:'registerLog',  label:'Register history' },
  { k:'registerActor',label:'Who is recording' },
  { k:'corrections',  label:'Correction cases' },
  { k:'deal',         label:'Property deal inputs' },
  { k:'opportunities',label:'Opportunity register' },
  { k:'wheelPlan',    label:'Cash Wheel plan' },
  { k:'wheelLegs',    label:'Cash Wheel cycle legs' },
  { k:'qttiPlan',     label:'Trading Index evidence' },
  { k:'manualPrices', label:'Prices you entered' },
  { k:'userData',     label:'Price series you pasted' },
  /* Everything below is also made by the reader, and the card that exports
     this list calls itself the only copy that survives a cleared browser. They
     were missing, so a restore into a clean browser lost them — and the seeded
     sample alerts reappeared in place of the reader's own, as if they were
     theirs. Display preferences (theme, density, the companies in a
     comparison) stay out on purpose; the full backup carries them. */
  { k:'priceAlerts',       label:'Price alerts' },
  { k:'dividendsReceived', label:'Dividends you recorded' },
  { k:'wht',               label:'Withholding rates you set' },
  { k:'baseCcy',           label:'Base currency' },
  { k:'savedScreens',      label:'Saved screens' },
  { k:'savedWork',         label:'Saved work' },
  { k:'reviews',           label:'Decision reviews' },
  { k:'runs',              label:'Saved valuation runs' },
  { k:'borrowerProfile',   label:'Borrower profile' },
  { k:'sarawakExposure',   label:'Sarawak exposure records' },
  /* The two saved kinds the research workspace added: assumptions edited in
     the Valuation Studio (kept per company across reloads), and named
     comparisons. Every kind the workspace lists travels in this one file. */
  { k:'valuation',         label:'Valuation assumptions you edited' },
  { k:'comparisons',       label:'Saved comparisons' },
  /* The scanner's three: the setups with every version (the export to the
     worker's file carries only the current ones), which recorded matches
     were read or archived here, and the scanner's notification and display
     preferences. The match record itself is the worker's file, not this. */
  { k:'scanSetups',        label:'Scanner setups and their versions' },
  { k:'scanAlertState',    label:'Scanner alerts read or archived' },
  { k:'scanPrefs',         label:'Scanner notification and display preferences' },
];

function exportEverything() {
  /* The envelope says which data the file was taken against, as well as
     which model: every saved item inside carries its own stamp, and this is
     the same record for the file as a whole. */
  const out = { format:'quantum-tradeworks/user-data', version:1,
                exportedAt:new Date().toISOString(), model:MODEL_VERSION,
                dataVersions: buildStamp('universe').data, data:{} };
  PORTABLE_KEYS.forEach(({ k }) => {
    const v = store.read(k, null);
    if (v !== null && v !== undefined) out.data[k] = v;
  });
  return out;
}

/* Replaces wholesale rather than merging. Merging two portfolios that both
   contain "Long-term core" is a guess about which the reader meant, and a wrong
   guess here silently corrupts the thing they were trying to protect. The
   confirmation says exactly what is about to be overwritten. */
/* The page's other two files, recognised by their own marks, so a refusal
   can name the control that takes them. The backup the same page downloads
   was told only that it was "not a Quantum Tradeworks export". */
const SIBLING_FILES = {
  backup: 'That file is a full backup, from “Download a backup”. “Restore from a backup”, on the same card, restores it.',
  everything: 'That file is from “Export everything”. “Restore from a file”, under Everything you have made, restores it.',
  prices: 'That file holds the prices you pasted, from “Export these prices”. “Restore exported prices”, at the foot of this page, restores it.',
};
const siblingFileOf = (doc) => !doc || typeof doc !== 'object' ? null
  : doc.format === 'quantum-tradeworks-backup' ? 'backup'
  : doc.format === 'quantum-tradeworks/user-data' ? 'everything'
  : !doc.format && isRecord(doc.series) ? 'prices' : null;

function importEverything(doc) {
  const sibling = siblingFileOf(doc);
  if (sibling && sibling !== 'everything') return { ok:false, err: SIBLING_FILES[sibling] };
  if (!doc || doc.format !== 'quantum-tradeworks/user-data')
    return { ok:false, err:'That file is not a Quantum Tradeworks export.' };
  if (!doc.data || typeof doc.data !== 'object')
    return { ok:false, err:'That export carries no data block.' };
  const known = PORTABLE_KEYS.map(x => x.k);
  const recognised = Object.keys(doc.data).filter(k => known.includes(k));
  const ignored = Object.keys(doc.data).filter(k => !known.includes(k));
  if (!recognised.length) return { ok:false, err:'That export holds nothing this build recognises.' };
  /* Refused key by key (see STORE_SHAPES): the rest of the file is still
     offered, and what is here now under a refused key is kept. An export
     never carries null, so a null is nothing to restore. */
  const refused = recognised.map(k => ({ k, why: doc.data[k] === null ? 'holds nothing' : storedShapeFault(k, doc.data[k]) })).filter(x => x.why);
  const incoming = recognised.filter(k => !refused.some(x => x.k === k));
  const labelOf = (k) => (PORTABLE_KEYS.find(x => x.k === k) || {}).label || k;
  if (!incoming.length) return { ok:false, refused,
    err:`Nothing in that file can be restored, because nothing in it is in the shape this app writes: ${refused.map(x => `${labelOf(x.k)} ${x.why}`).join('; ')}.` };
  return { ok:true, incoming, ignored, refused, exportedAt:doc.exportedAt,
    apply() { incoming.forEach(k => store.write(k, doc.data[k])); } };
}

