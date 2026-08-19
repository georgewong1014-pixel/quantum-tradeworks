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

/* CAGR over an array; null when the base is non-positive (a growth rate off a
   negative base is meaningless — we surface "n/m" rather than a fake number). */
function cagr(series) {
  const a = series[0], b = last(series), n = series.length - 1;
  if (!isNum(a) || !isNum(b) || a <= 0 || b <= 0 || n < 1) return null;
  return (Math.pow(b / a, 1 / n) - 1) * 100;
}

/* ------------------------------------------------------------- formatting */
const NA = '<span class="caption" title="Not available or not meaningful for this company type">n/a</span>';

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
function fmtX(v, dp = 1)   { return isNum(v) ? `${v.toFixed(dp)}×` : '—'; }

function fmtCap(v, ccy) {
  if (!isNum(v)) return '—';
  const sym = ccy === 'MYR' ? 'RM' : '$';
  /* Sign leads the symbol — "−$51.5B", never "$-51.5B". */
  const sign = v < 0 ? '−' : '', a = Math.abs(v);
  if (a >= 1000) return `${sign}${sym}${(a / 1000).toFixed(2)}T`;
  if (a >= 1)    return `${sign}${sym}${a.toFixed(1)}B`;
  return `${sign}${sym}${(a * 1000).toFixed(0)}M`;
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
  roe: { label: 'Return on equity',
    simple: 'How much profit the company earns from the money shareholders have put in and left in.',
    context: 'Most useful for banks and insurers, where equity is the constraint on how much business can be written. Comparing a bank against an industrial company on this measure is comparing two different things — bank balance sheets are structured completely differently.',
    technical: 'Net income ÷ average shareholders’ equity, using opening and closing equity for the period.' },
  roic: { label: 'Return on invested capital',
    simple: 'How much profit the business earns from all the money in it — both shareholders’ and borrowed.',
    context: 'The cleanest single measure of whether a business is good, because it ignores how the company chose to finance itself. Not meaningful for banks, where borrowing is the raw material rather than the funding.',
    technical: 'Operating profit after tax ÷ (total debt + equity − cash). Excluded for deposit-taking institutions.' },
  om: { label: 'Operating margin',
    simple: 'Out of every ringgit of sales, how much is left after the costs of running the business.',
    context: 'Compare it only within an industry. A supermarket at 4% can be excellent and a software company at 20% can be poor — the cost structures are not alike.',
    technical: 'Operating profit ÷ revenue for the reported period.' },
  fcfm: { label: 'Free cash flow margin',
    simple: 'Out of every ringgit of sales, how much becomes cash the company can actually use.',
    context: 'Profit is an opinion, cash is a fact. A company reporting rising profit with falling free cash flow is the single most common warning sign in fundamental analysis.',
    technical: 'Operating cash flow less capital expenditure, ÷ revenue.' },
  pe: { label: 'Price to earnings',
    simple: 'How many years of current profit you are paying for the shares.',
    context: 'Low is not automatically cheap. A cyclical company looks cheapest at the top of its cycle, when earnings are at their peak and about to fall.',
    technical: 'Market price per share ÷ earnings per share for the latest reported year.' },
  pb: { label: 'Price to book',
    simple: 'What you pay for the shares compared with the accounting value of what the company owns, less what it owes.',
    context: 'Central for banks and property companies, where the balance sheet is the business. Close to meaningless for a company whose value is people and brands, which the balance sheet does not record.',
    technical: 'Market price per share ÷ shareholders’ equity per share.' },
  evebit: { label: 'Enterprise value to EBIT',
    simple: 'What the whole business costs — shares plus debt, less cash — compared with its operating profit.',
    context: 'Fairer than price-to-earnings when comparing companies with very different borrowings, because it prices the debt as part of what you are buying.',
    technical: '(Market capitalisation + total debt − cash) ÷ operating profit.' },
  dy: { label: 'Dividend yield',
    simple: 'The cash paid out per year as a percentage of the share price.',
    context: 'A high yield is sometimes generosity and sometimes a falling share price. Always read it beside whether earnings and cash flow actually cover the payment.',
    technical: 'Dividend per share for the trailing year ÷ current price. Shown gross, before any withholding.' },
  ndEbit: { label: 'Net debt to EBIT',
    simple: 'How many years of operating profit it would take to repay the borrowings.',
    context: 'The most direct measure of whether debt is a problem. Above roughly 3×, a downturn stops being uncomfortable and starts being dangerous. Not applicable to banks.',
    technical: '(Total debt − cash) ÷ operating profit.' },
  de: { label: 'Debt to equity',
    simple: 'How much the company has borrowed for every ringgit shareholders have put in.',
    context: 'Read alongside the stability of earnings. Steady utilities safely carry debt that would sink a cyclical manufacturer.',
    technical: 'Total debt ÷ shareholders’ equity.' },
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
    'aria-selected': explainDepth() === id ? 'true' : 'false',
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

/* Pick ink or white for a label sitting inside a coloured fill. */
function inkOn(hex) {
  const m = hex.replace('#', '');
  if (m.length < 6) return '#fff';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.42 ? '#141a18' : '#ffffff';
}

/* ------------------------------------------------------------------ state */
const store = {
  read(key, fallback) {
    try { const v = localStorage.getItem('vl.' + key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem('vl.' + key, JSON.stringify(value)); } catch { /* private mode */ }
  }
};

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
];

function exportEverything() {
  const out = { format:'quantum-tradeworks/user-data', version:1,
                exportedAt:new Date().toISOString(), model:MODEL_VERSION, data:{} };
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
function importEverything(doc) {
  if (!doc || doc.format !== 'quantum-tradeworks/user-data')
    return { ok:false, err:'That file is not a Quantum Tradeworks export.' };
  if (!doc.data || typeof doc.data !== 'object')
    return { ok:false, err:'That export carries no data block.' };
  const known = PORTABLE_KEYS.map(x => x.k);
  const incoming = Object.keys(doc.data).filter(k => known.includes(k));
  const ignored = Object.keys(doc.data).filter(k => !known.includes(k));
  if (!incoming.length) return { ok:false, err:'That export holds nothing this build recognises.' };
  return { ok:true, incoming, ignored, exportedAt:doc.exportedAt,
    apply() { incoming.forEach(k => store.write(k, doc.data[k])); } };
}

