/* ==========================================================================
   SHARED UI COMPONENTS
   ========================================================================== */

const ICON = {
  check:'<path d="M20 6 9 17l-5-5"/>',
  alert:'<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.9 18a2 2 0 0 0 1.7 3h16.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  doc:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  chart:'<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>',
  coin:'<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h5M9.5 14.5h5"/>',
  bell:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  ext:'<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
  down:'<path d="M12 5v14M19 12l-7 7-7-7"/>',
  filter:'<path d="M3 4h18l-7 8v6l-4 2v-8Z"/>',
  scale:'<path d="M12 3v18M5 7h14"/><path d="m5 7-3 6h6ZM19 7l-3 6h6Z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  briefcase:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  home:'<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M9 22V12h6v10"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  /* The sidebar's (Release A). */
  layout:'<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 21V9"/>',
  list:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  database:'<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/><path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  tag:'<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  chev:'<path d="m6 9 6 6 6-6"/>',
};
const icon = (name, size = 14) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:${size}px;height:${size}px;flex:none">${ICON[name] || ''}</svg>`;

const SEV_STYLE = {
  good:     { v:'--ok',       label:'Positive',  icon:'check' },
  warning:  { v:'--warn',     label:'Watch',     icon:'alert' },
  serious:  { v:'--serious',  label:'Serious',   icon:'alert' },
  critical: { v:'--critical', label:'Critical',  icon:'alert' },
  info:     { v:'--s3',       label:'Information', icon:'info' },
};

/* Status colours never travel alone — always icon + label. */
function sevChip(sev, text) {
  const s = SEV_STYLE[sev] || SEV_STYLE.info;
  return el('span', { class: 'chip', style: `background:color-mix(in srgb, var(${s.v}) 13%, transparent);border-color:color-mix(in srgb, var(${s.v}) 34%, transparent)`,
    html: `<span class="chip-dot" style="background:var(${s.v})"></span>${esc(text || s.label)}` });
}

/* The chip names the market the instrument is listed on. It used to answer
   'MY' for anything that was not 'US', and the tracked registry holds indices
   and listings from seventeen other markets — so the search called the DAX a
   Malaysian listing. US and MY keep their colours; any other market shows its
   own code on a plain chip, and an instrument with no market gets no chip. */
function marketChip(mkt) {
  const m = String(mkt || '').toUpperCase();
  if (!m) return null;
  return el('span', { class: 'chip' + (m === 'US' ? ' chip-us' : m === 'MY' ? ' chip-my' : '') }, m);
}

/* How a price is dated, decided once.
   ---------------------------------------------------------------------------
   The company header carried a hardcoded "today" beside the day-one change
   while this function, four hundred lines away, worked out the real stamp. On
   the 115 filed companies that hold no price at all, "today" therefore sat
   beside an em dash and dated a number that does not exist; on a company with a
   supplied close it presented a 2026-07-31 figure as though it were current.
   Both surfaces now read the same function, so a price cannot be dated two ways
   on one page. */
function priceAsOfLabel(c) {
  if (c?.px?.eod && c.px.asOf) return `${c.px.asOf} close`;
  if (isNum(c?.px?.p) && c.px.manual) return 'entered by you';
  if (!isNum(c?.px?.p)) return 'none supplied';
  /* Only the illustrative set reaches here. Its prices are hand-written
     figures, and stamping one "30 Jul 2026 17:00 MYT" dressed it as a market
     close that happened. It is a sample figure with a date, and says so. */
  if (!c.real) return `sample price, ${AS_OF}`;
  return `${AS_OF} 17:00 ${c.mkt === 'US' ? 'ET' : 'MYT'}`;
}
/* When a company's STATEMENTS date from — the illustrative set's fixed stamp
   is not the date filed statements were retrieved, and dating Apple's audited
   figures "30 Jul 2026" when they were fetched on 3 August was the same
   defect as the price stamp, one row down. */
function dataDateLabel(c) {
  if (c?.real) return c.retrieved ? `statements retrieved ${c.retrieved}` : 'filed statements';
  return `sample set, ${AS_OF}`;
}

/* Freshness + lineage, shown on every analytical surface. */
function provenance(row, extra = [], { freshness = false } = {}) {
  const { c, m } = row;
  /* AS_OF is the sample set's fixed stamp. A company carrying a real supplied
     price has its own date, and showing the sample stamp next to it would
     misdate the number on every analytical surface. */
  const priceStamp = priceAsOfLabel(c);
  /* The company header's form: the statements' period, their source and their
     date lead, because on a company with no price they are the only fresh
     thing to state. Optioned, since the screener and compare share this strip
     and carry the source on every row already. The period end is read where
     the data holds it and said to be missing where it does not. */
  const fy = latestFy(c), end = fyEndOf(c, fy);
  const lead = freshness ? [
    `<b>Statements</b> FY${fy}${end ? ` ended ${esc(fmtFyEnd(end))}` : c.real && !c.personal ? ' <span title="The period end date is not in this dataset yet: the statements were retrieved before the ingest recorded it.">(period end not yet held)</span>' : ''}`,
    `<b>Source</b> ${c.real ? (c.personal ? 'your annual statements, personal research' : `SEC EDGAR companyfacts, CIK ${esc(String(Number(c.cik)))}`) : 'synthetic sample, not a filing'}`,
    `<b>As of</b> ${esc(dataDateLabel(c))}`,
  ] : [];
  const bits = [
    ...lead,
    `<b>Price</b> ${priceStamp}`,
    ...(freshness ? [] : [`<b>Period</b> FY${latestFy(c)} reported`]),
    `<b>Currency</b> ${c.ccy}`,
    `<b>Coverage</b> <span title="Computable ÷ applicable metrics${m.inapplicable ? `. ${m.inapplicable} dictionary metrics do not apply to this business model and are excluded from the denominator rather than counted as missing.` : ''}">${m.coverage}%${m.inapplicable ? ` <span style="color:var(--ink-3)">(${m.inapplicable} n/a)</span>` : ''}</span>`,
    ...extra,
  ];
  return el('div', { class: 'prov', html: bits.join('<span class="dotsep"></span>') });
}

/* The one word that separates a synthetic company from an audited one, for
   every list that names companies by ticker. As an element beside the ticker
   or as text after a name — never at the END of a span that truncates, which
   is where the first version put it and where a 190px ellipsis ate it on
   sixteen of eighteen illustrative rows. */
const ILLUS_TITLE = 'Illustrative figures — synthetic, created for interface demonstration. Not filed, and not real.';
const illusChip = (c) => c?.real ? null : el('span', { class: 'illus', title: ILLUS_TITLE }, 'illustrative');
const illusText = (c) => c?.real ? '' : ' · illustrative';

function tickerCell(row) {
  /* Filed and illustrative companies sit in the same screener, heatmap and
     comparison rows. The company page says which is which; these rows did
     not, so a synthetic Bursa company and an audited US filer were
     indistinguishable in the one place they are ranked side by side. The
     marker sits on the ticker line, which does not truncate. */
  const b = el('button', { class: 'tickerbtn', onclick: () => openResearch(row.c.id),
    title: row.c.real ? undefined : ILLUS_TITLE });
  b.append(el('span', { class: 'tk' }, [row.c.tk, illusChip(row.c)]));
  b.append(el('span', { class: 'nm' }, row.c.mkt === 'MY' ? `${row.c.code} · ${row.c.name}` : row.c.name));
  return b;
}

function scoreBar(label, value, pct, tone = '--brand') {
  const wrap = el('div', { class: 'scorerow' });
  wrap.append(el('span', { class: 'sr-name' }, label));
  const meter = el('div', { class: 'meter' });
  meter.append(el('i', { style: `width:${isNum(value) ? value : 0}%;background:var(${tone})` }));
  const cell = el('div');
  cell.append(meter);
  if (isNum(pct)) cell.append(el('div', { class: 'metaline', style: 'margin-top:3px;white-space:nowrap', title: 'Percentile within the market cohort' }, `${ord(pct)} percentile`));
  wrap.append(cell);
  wrap.append(el('span', { class: 'sr-val' }, isNum(value) ? value : '—'));
  return wrap;
}

function statTile(label, value, { delta, sub, spark, tone } = {}) {
  const t = el('div', { class: 'stat' });
  t.append(el('div', { class: 'stat-label' }, label));
  const vr = el('div', { class: 'row', style: 'gap:10px;align-items:baseline' });
  vr.append(el('div', { class: 'stat-value' + (String(value).length > 9 ? ' sm' : ''), style: tone ? `color:var(${tone})` : '' }, value));
  if (spark) vr.append(spark);
  t.append(vr);
  if (delta != null) t.append(el('div', { class: 'stat-delta ' + signClass(delta.v), html: `${withSign(delta.v, delta.dp ?? 1, delta.suffix ?? '%')} <span style="color:var(--ink-3);font-weight:500">${esc(delta.label)}</span>` }));
  if (sub) t.append(el('div', { class: 'stat-sub' }, sub));
  return t;
}

function cardHead(title, subtitle, right) {
  const h = el('div', { class: 'card-hd' });
  const l = el('div');
  l.append(el('h3', { class: 'h-card' }, title));
  if (subtitle) l.append(el('p', { class: 'caption', style: 'margin-top:2px;max-width:60ch' }, subtitle));
  h.append(l);
  if (right) h.append(right);
  return h;
}

/* THE PAGE DECIDES A HEADING'S LEVEL, NOT THE COMPONENT THAT DREW IT.
   ---------------------------------------------------------------------------
   cardHead titles every card h3, because h2 was kept for section headings —
   and most pages have none. Forty-one of fifty-three routes measured stepped
   from their h1 straight to an h3 or an h4 (the property calculator's first
   heading under its h1 was an h4), and the printable record and report
   opened on an h3 above their h1. A screen reader listing the headings heard
   every card as part of a section that is not there, and "next heading at
   level 2" found nothing on most of the product. A card cannot know where it
   will sit — the same card is a page's section on one page and part of a
   section on another — and some 220 cards and 150 other headings are drawn
   by twenty-two view files. So the level is read off the page once the
   heading is on it. The order the author wrote is kept: a heading written
   deeper than the one before it belongs to that one, and one written at the
   same depth or shallower closes it. Only the size of each step changes, to
   exactly one. A heading above the page's h1 belongs to the page.

   It is stated as aria-level, which is the level assistive technology reads,
   rather than by changing the tag: a tag cannot change without replacing the
   element, and that would drop the focus the scanner pages put on a result
   heading as they draw it, and every style and selector written for an h3
   or an h4. A heading already at its level carries no attribute. `parent` is
   the level of the heading the region sits under: 1 for a page, whose h1 is
   inside it, and 2 for the drawer's body, under the drawer's h2 title. */
function fitHeadingLevels(root, parent = 1) {
  if (!root) return;
  const open = [{ tag: parent, level: parent }];
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const tag = Number(h.tagName[1]);
    while (open.length > 1 && open[open.length - 1].tag >= tag) open.pop();
    let level = tag;
    if (tag > parent) { level = Math.min(6, open[open.length - 1].level + 1); open.push({ tag, level }); }
    if (level === tag) h.removeAttribute('aria-level');
    else if (h.getAttribute('aria-level') !== String(level)) h.setAttribute('aria-level', String(level));
  }
}

function emptyState(text) {
  return el('div', { class: 'emptystate', html: `${icon('search', 30)}<p>${esc(text)}</p>` });
}

/* ------------------------------------------------------------ drawer/toast */
const scrim = $('#scrim'), drawer = $('#drawer'), drawerBody = $('#drawerBody'), drawerTitle = $('#drawerTitle');
let lastFocus = null, closeTimer = null, closingBack = null;
/* Each open and each close takes the next number. The open marks the drawer
   and the scrim open a frame later, and a close that came first — in the
   same frame, or in a background tab where the frame waits past the close's
   own timer — used to be overridden by it: the drawer closed, then the scrim
   was marked open again over the page, invisible, taking every click. A
   frame that is no longer the latest open does nothing. */
let drawerSeq = 0;

/* A drawer opened while the previous one is still closing (the case-recorded
   confirmation, the dashboard customiser reopening after a reorder) used to be
   hidden by the close's 300ms timer, which nothing cancelled: the confirmation
   of a recorded correction case opened and vanished in the same tick. Opening
   now cancels the pending close and inherits the element that close would have
   handed focus back to, because the button that opened this drawer sits in the
   body about to be replaced. */
/* A drawer that repaints ITSELF — a metric's explanation switching depth, say —
   opens again while already open, and its opener is still the one to go back
   to. Taking document.activeElement then recorded the depth button inside the
   drawer, which the new body replaces, so closing it handed focus to a
   detached node and dropped it on <body>. */
function openDrawer(title, node) {
  if (closeTimer) {
    clearTimeout(closeTimer); closeTimer = null;
    lastFocus = closingBack; closingBack = null;
  } else if (drawer.hidden || !drawer.contains(document.activeElement)) lastFocus = document.activeElement;
  drawerTitle.textContent = title;
  drawerBody.replaceChildren(node);
  /* The body sits under the drawer's h2 title; its headings step from there. */
  fitHeadingLevels(drawerBody, 2);
  drawer.hidden = false;
  const seq = ++drawerSeq;
  requestAnimationFrame(() => { if (seq !== drawerSeq) return; drawer.dataset.open = '1'; scrim.dataset.open = '1'; });
  $$('[data-close-drawer]', drawer)[0]?.focus();
}
/* Closes whichever is open. The scrim sits under both dialogs, so a click on
   it with only the search box open used to run the drawer's close path too —
   and 300ms later hand focus to whatever had opened the LAST drawer, undoing
   the search box's own focus restore. A drawer that is not open has nothing
   to close and no focus to give back. restore:false is for a navigation away
   from the page the drawer belonged to, where the new page takes focus. */
function closeDrawer({ restore = true } = {}) {
  /* Already closing: the pending close owns the focus hand-back. */
  if (drawer.hidden || closeTimer) { closeSearch(); return; }
  drawerSeq++;
  drawer.dataset.open = '0'; scrim.dataset.open = '0';
  const back = lastFocus; lastFocus = null;
  closingBack = restore ? back : null;
  closeTimer = setTimeout(() => {
    closeTimer = null; closingBack = null;
    drawer.hidden = true;
    if (!restore || !back || back === document.body) return;
    if (document.contains(back)) { back.focus?.({ preventScroll: true }); return; }
    /* THE OPENER A REDRAW REPLACED. A drawer whose own action redraws the
       page — an edit to a comparable, a recorded correction case — detaches
       the button that opened it, and the hand-back above found nothing and
       left the keyboard on <body>. The redraw brought the same control back
       under the same id, as renderKeepFocus relies on, so focus goes there;
       with no such control, to <main>, as focusAfterRedraw's last resort.
       Only while focus is lost: an action that put it somewhere on purpose,
       or a navigation that has focused the new page, keeps it. */
    const at = document.activeElement;
    if (at && at !== document.body && !drawer.contains(at)) return;
    const again = back.id ? document.getElementById(back.id) : null;
    if (again) again.focus({ preventScroll: true });
    if (!again || document.activeElement !== again) focusMain();
  }, 300);
  closeSearch();
}
scrim.addEventListener('click', () => closeDrawer());
$$('[data-close-drawer]').forEach(b => b.addEventListener('click', () => closeDrawer()));

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.dataset.show = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.dataset.show = '0', 2600);
}

/* --------------------------------------------------------------- routing */
/* ==========================================================================
   NAVIGATION AND ROUTING

   TWO CHROMES, FOUR PRODUCTS (Release A). The header's six destinations —
   Discover, Research, Scanner, My Investments, Property, Learn — were the
   code's sections, and a first-time visitor had to learn that map before
   doing anything. The product is four products and a personal workspace, so
   the chrome says that, and which chrome a page wears follows who the page
   is for (chromeOf):

   PUBLIC — the front door, How it works, pricing and the trust and method
   pages — wear a header: Products, How it works, Pricing, Resources, the
   theme, and one action, "Open workspace". There is no Sign In because there
   are no accounts: everything a visitor saves lives in their browser.

   APP — every page a reader works in — wear a sidebar: their own workspace
   first (dashboard, watchlists, alerts, saved models), then the products,
   then their data and the plans. Below 1024px it is a drawer behind a slim
   bar that keeps the search one tap away.

   Nothing was removed to get here. Screener, Value map, Sarawak Economy
   Watch and the Cash Wheel are tabs of Equities Research (PRODUCT_TABS); the
   Trading Index is a section of the Scanner; every address that opened a
   page before still opens it. docs/route-map.md is the whole map.
   ========================================================================== */

/* THE FOUR PRODUCTS. The one list the header, the sidebar, the footer, the
   homepage and How it works read, so a product's name, its status and the
   sentence qualifying that status cannot differ between two of them. Each
   status was checked against what the code does, not what the brief hoped:

   - Equities is Beta. The US companies are audited SEC filings (data/us.json);
     the Malaysian ones are the illustrative set (10-dataset.js); no market-data
     licence is held for either exchange, so a filed company carries no price.
   - The Scanner is Beta. Setups, the builder and every page work anywhere,
     but every evaluation reads data/price-history.json — git-ignored, built on
     the reader's own machine — and matches are written by a worker on that
     machine and never sent (86-scanner.js). The hosted site has nothing to
     scan, which is what the note says rather than a Live badge implying it.
   - Property is Live. Every figure is dealModel() over the inputs on the page
     (70-property.js); what is not the reader's own — the seeded example deal,
     the sample projects' synthetic transactions, fee lines still placeholders
     — is labelled where it shows, and the note says so.
   - Business Intelligence is not built. It is text with a badge, never a
     link or a button, and SHOW_UNBUILT keeps it out of the app sidebar. */
const PRODUCTS = [
  { id: 'equities', name: 'Equities Research', short: 'Equities', path: '/research',
    task: 'Research a company', blurb: 'Financial statements, ratios and valuation models.',
    question: 'How is this company performing financially?', action: 'Research a company', actionPath: '/research',
    status: 'beta', statusNote: 'US companies from their audited SEC filings and Malaysian companies from illustrative figures, with no licensed prices for either market.' },
  { id: 'scanner', name: 'Quantum Scanner', short: 'Scanner', path: '/app/scanner',
    task: 'Monitor my setups', blurb: 'Your own rules, checked against each daily close in your price history, with a record of every match.',
    question: 'Has my preferred technical setup appeared?', action: 'Create a setup', actionPath: '/app/scanner/setups/new',
    status: 'beta', statusNote: 'Runs on daily price history you supply, with the worker on your own computer; this site ships no prices, so here it has nothing to scan, and a match is recorded, never sent.' },
  { id: 'property', name: 'Property Intelligence', short: 'Property', path: '/property',
    task: 'Analyse a property', blurb: 'Financing, cash flow, rental yield and ROI.',
    question: 'What are the financial implications of this investment?', action: 'Analyse a property', actionPath: '/property/calculator',
    status: 'live', statusNote: 'Computed from the figures you enter; the starting deal and the sample projects’ transactions are synthetic and labelled so, and fee lines not yet verified are marked as placeholders.' },
  { id: 'business', name: 'Business Intelligence', short: 'Business', path: null,
    task: 'Plan my business', blurb: 'Cash flow, profitability and financing scenarios.',
    question: 'What will happen to my company’s cash flow?', action: null, actionPath: null,
    status: 'soon', statusNote: 'Not built yet — nothing to open.' },
];
const PRODUCT_STATUS = { live: 'Live', beta: 'Beta', demo: 'Demo', soon: 'Coming soon' };
/* A product that is not built never appears in the app's navigation. */
const SHOW_UNBUILT = false;
/* "Reports" joins My Workspace once a list of reports exists. Today a report
   is printed from a company page and nothing keeps it, so an item would open
   a list that is not there. */
const SHOW_REPORTS = false;
const productById = (id) => PRODUCTS.find(p => p.id === id) || null;

/* The badge a product wears, with its note as the title. It is an element,
   for el() children; its own markup when put in a template string, because
   the pages that call it build both ways. */
function productBadge(id) {
  const p = productById(id);
  if (!p) return null;
  const b = el('span', { class: `status-badge status-${p.status}`, title: p.statusNote }, PRODUCT_STATUS[p.status] || p.status);
  b.toString = () => b.outerHTML;
  return b;
}
/* The product a view belongs to, or null — the dashboard, the personal pages
   and the public pages belong to none. Read from SECTION_OF (below), the one
   table that says where every view sits. */
function productOf(view) {
  const s = SECTION_OF[view];
  return PRODUCTS.some(p => p.id === s) ? s : null;
}

/* Which chrome a view wears. Everything not listed is a page a reader works
   in. The not-found card is public: a stranger who followed a dead link is
   not in anyone's workspace. */
const PUBLIC_VIEWS = new Set(['marketing', 'howItWorks', 'plans', 'about', 'contact', 'privacy', 'terms',
  'learn', 'boundaries', 'status', 'ips', 'notfound']);
const chromeOf = (view) => (PUBLIC_VIEWS.has(view) ? 'public' : 'app');

/* The Resources menu, and the footer's Resources column less the four that
   sit under Company there. */
const RESOURCES = [
  { label: 'Methodology',                   path: '/methodology',               group: 'method' },
  { label: 'Data sources',                  path: '/data-sources',              group: 'method' },
  { label: 'Glossary',                      path: '/learn/glossary',            group: 'method' },
  { label: 'Learn',                         path: '/learn',                     group: 'method' },
  { label: 'Corrections',                   path: '/corrections',               group: 'method' },
  { label: 'What this product will not do', path: '/learn/product-boundaries',  group: 'method' },
  { label: 'Build status',                  path: '/status',                    group: 'company' },
  { label: 'About',                         path: '/about',                     group: 'company' },
  { label: 'Contact',                       path: '/contact',                   group: 'company' },
  { label: 'Privacy',                       path: '/privacy',                   group: 'company' },
  { label: 'Terms',                         path: '/terms',                     group: 'company' },
];

/* The sidebar. My Workspace, then the products (from PRODUCTS), then the
   reader's data and the plans. Each id is a SECTION_OF value. */
const APP_NAV_WORKSPACE = [
  { id: 'dashboard',  label: 'My Dashboard', icon: 'layout', path: '/app' },
  { id: 'watchlists', label: 'Watchlists',   icon: 'list',   path: '/my/watchlists' },
  { id: 'alerts',     label: 'My Alerts',    icon: 'bell',   path: '/my/alerts' },
  { id: 'workspace',  label: 'Saved Models', icon: 'folder', path: '/my/workspace' },
];
const APP_NAV_FOOT = [
  { id: 'userdata', label: 'Your data & settings', icon: 'database', path: '/my/data' },
  { id: 'plans',    label: 'Plans',                icon: 'tag',      path: '/pricing' },
];
const PRODUCT_ICON = { equities: 'chart', scanner: 'target', property: 'home', business: 'briefcase' };

/* ONE ROW OF TABS PER PRODUCT, above the product's pages. The tools the
   brief does not name are here rather than gone: Screener, Value map,
   Sarawak Economy Watch and the Cash Wheel are Equities pages. A tab is
   current for the views it lists (and, on the discover view, for its own
   tabs), so the Screener tab stays lit on the strategies and heatmap tabs
   that share its page. The Scanner keeps its own section strip (scanSubnav,
   86-scanner.js), where the Trading Index is its last section.

   Property has no Overview tab. /property and /property/calculator are one
   view — the calculator, whose canonical address is /property — so an
   "Overview" beside "Calculator" would be two names for the same page, the
   second one promising a summary that does not exist. The row gains it when
   a Property overview is built (docs/route-map.md). */
const PRODUCT_TABS = {
  equities: [
    { id: 'overview', label: 'Overview',       path: '/research',           views: ['researchHome'] },
    { id: 'screener', label: 'Screener',       path: '/discover/screener',  views: ['discover'], tabs: ['screener', 'ideas', 'heatmap'] },
    { id: 'valuemap', label: 'Value map',      path: '/discover/value-map', views: ['discover'], tabs: ['radar'] },
    { id: 'compare',  label: 'Compare',        path: '/compare',            views: ['compare'] },
    { id: 'queue',    label: 'Research queue', path: '/research/queue',     views: ['researchQueue'] },
    { id: 'sarawak',  label: 'Sarawak watch',  path: '/discover/sarawak',   views: ['sarawak'] },
    { id: 'wheel',    label: 'Cash Wheel',     path: '/us-options/wheel',   views: ['wheel'] },
  ],
  property: [
    { id: 'calculator',    label: 'Calculator',    path: '/property/calculator',    views: ['property'] },
    { id: 'areas',         label: 'Area screen',   path: '/property/areas',         views: ['areas'] },
    { id: 'comparables',   label: 'Comparables',   path: '/property/comparables',   views: ['comparables'] },
    { id: 'opportunities', label: 'Opportunities', path: '/property/opportunities', views: ['opportunities'] },
  ],
};
/* The company page and its report belong to Equities but keep their own
   tabs; a second row above them would be two strips of tabs on one page. */
const NO_PRODUCT_TABS = new Set(['research', 'researchReport']);

/* Views reachable by URL but not in the header. */
const SUBNAV_MY = [
  { id:'portfolio',  label:'Portfolio',  path:'/my/portfolio' },
  { id:'watchlists', label:'Watchlists', path:'/my/watchlists' },
  { id:'thesis',     label:'Investment cases', path:'/my/theses' },
  { id:'alerts',     label:'Alerts',     path:'/my/alerts' },
  { id:'tracked',    label:'Tracked',    path:'/my/tracked' },
  /* Everything saved, across kinds, in one list — beside the page that
     exports it. */
  { id:'workspace',  label:'Workspace',  path:'/my/workspace' },
  { id:'userdata',   label:'Your data',  path:'/my/data' },
];

/* Every view of the scanner, by the ids docs/phase3-plan.md §2 fixes. One
   list, because three things need all of them: the header's section, the
   views that wait for the data load, and the checks. 'scanner' is the page
   that was the whole scanner before Phase 3. */
const SCANNER_VIEWS = ['scanner', 'scannerDashboard', 'scannerMarket', 'scannerSetups', 'scannerSetupNew', 'scannerSetup',
  'scannerSetupEdit', 'scannerWatchlists', 'scannerAlerts', 'scannerAlert', 'scannerBacktest', 'scannerSettings',
  'scannerAdmin', 'scannerAdminData', 'scannerAdminJobs', 'scannerAdminDelivery'];

const VIEWS = {};
const viewRoot = $('#views');
/* Some views draw part of themselves without render() — a market screen's
   or a simulation's result, "Evaluate now" on a setup — and a drawer can
   repaint its own body. Each brings headings at the level they were written
   at, so the levels are fitted again after every such change. Only children
   are watched: fitting sets attributes, which do not call it back. */
const headingWatch = new MutationObserver(() => { fitHeadingLevels(viewRoot); fitHeadingLevels(drawerBody, 2); });
headingWatch.observe(viewRoot, { childList: true, subtree: true });
headingWatch.observe(drawerBody, { childList: true, subtree: true });

/* --------------------------------------------------------------- routing */
/* Real paths, not fragments. Previously go() changed State and re-rendered
   without touching the URL at all, so back and forward did nothing, a refresh
   dropped you back to the start, and no company page could be shared or
   linked. Every addressable state now has a path, and the path is the source
   of truth — render reads it rather than the other way round. */

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/* A company's URL carries a readable slug but resolves on the leading code, so
   /company/1155-maybank and /company/1155 are the same page and a renamed
   company does not break an old link. */
/* A Bursa company is known by its four-digit code, so that leads its URL —
   /company/1155-maybank, which is what a Malaysian reader recognises. A US
   company leads with its ticker. Either way the readable tail is decoration:
   resolution happens on the leading segment, so an old link survives a rename. */
function companyPath(c) {
  const lead = c.mkt === 'MY' && c.code ? c.code : (c.tk || c.id);
  const tail = c.name ? `-${slug(c.name).split('-').slice(0, 2).join('-')}` : '';
  return `/company/${slug(String(lead))}${tail}`;
}

/* The brief's names for the company page's tabs, where they differ. */
const RESEARCH_TAB_ALIAS = { ratios: 'quality', statements: 'financials', 'source-data': 'filings', sources: 'filings', overview: 'snapshot' };

function companyFromSlug(s) {
  if (!s) return null;
  /* A malformed escape ('%', '%E0%A4%A') is an address nobody can resolve,
     not an error: decodeURIComponent throws on it, and thrown from the router
     at boot it left the page blank. It is matched as typed and ends at the
     not-found card like any other unknown slug. */
  let raw;
  try { raw = decodeURIComponent(s); } catch { raw = String(s); }
  raw = raw.toUpperCase();
  /* A retired stand-in's id aliases the filer's row in BY_ID; the answer is
     always the row's own id, so State.ticker never carries a retired name. */
  const own = (id) => BY_ID.get(id)?.c.id || null;
  if (BY_ID.has(raw)) return own(raw);
  /* The canonical registry knows every name an instrument goes by — 'MY:1155',
     '1155.KL', 'CIK0000320193', a listing code, an old id. */
  const viaRegistry = companyIdFor(raw);
  if (viaRegistry && BY_ID.has(viaRegistry)) return own(viaRegistry);

  const head = raw.split('-')[0];
  if (BY_ID.has(head)) return own(head);
  const headReg = companyIdFor(head);
  if (headReg && BY_ID.has(headReg)) return own(headReg);
  if (BY_ID.has(`${head}-SEC`)) return own(`${head}-SEC`);
  /* -SEC ids carry their own hyphen, so the first two segments may be the id. */
  const two = raw.split('-').slice(0, 2).join('-');
  if (BY_ID.has(two)) return own(two);
  /* A ticker with a hyphen of its own (BRK-B) puts its SEC id's stem in the
     first two segments, and companyPath writes exactly that form —
     /company/brk-b-berkshire-hathaway — so the resolver has to read it back,
     or the company's own link is a 404. */
  const twoReg = companyIdFor(two);
  if (twoReg && BY_ID.has(twoReg)) return own(twoReg);
  if (BY_ID.has(`${two}-SEC`)) return own(`${two}-SEC`);

  /* Then the listing code and the ticker. Scanned rather than indexed because
     companies load asynchronously and a map built at startup would miss every
     SEC-filed company. The universe is small enough that this is free. */
  const hit = U.find(r => String(r.c.code || '').toUpperCase() === head
                       || String(r.c.tk || '').toUpperCase() === head);
  return hit ? hit.c.id : null;
}

const ROUTES = [
  { path: '/',                    view: 'marketing', title: 'Quantum Tradeworks — your financial decision workspace' },
  { path: '/app',                 view: 'home',      title: 'My Dashboard' },
  /* Release A: how each product works, with the examples that left the
     homepage (55-views-public.js); and the Equities research queue, which
     was the dashboard's body until the dashboard became the reader's own
     (40-views-discover.js). Until a branch that defines a view is merged,
     its route shows the not-found card (applyRoute), never a blank page. */
  { path: '/how-it-works',        view: 'howItWorks', title: 'How it works' },
  { path: '/research/queue',      view: 'researchQueue', title: 'Research queue' },
  { path: '/welcome',             view: 'onboarding',title: 'Get started' },
  { path: '/discover',            view: 'discover',  title: 'Discover' },
  { path: '/discover/screener',   view: 'discover',  tab: 'screener',  title: 'Screener' },
  { path: '/discover/value-map',  view: 'discover',  tab: 'radar',     title: 'Quality vs Value Map' },
  { path: '/research',            view: 'researchHome', title: 'Research' },
  { path: '/company/:id',         view: 'research',  title: 'Company report' },
  /* The print-first research report — one company on one printable page. */
  { path: '/company/:id/report',  view: 'researchReport', title: 'Research report' },
  /* The Phase 2 brief's paths — aliases of the routes around them: the same
     views, the same header, so a company is one page whichever address opens
     it. A symbol here resolves through the instrument registry, so
     /app/equities/1155 and /app/equities/maybank are the same company, and
     the tab segment accepts the brief's names for our tabs. alias:true keeps
     go() from choosing one as the address of its view: go() takes the first
     matching row, and these sit above the canonical rows, so the Learn tab
     "Valuation model router" moved the address to /equities/methodology and
     go('compare') and go('watchlists') to their /app/ forms. */
  { path: '/app/equities',          view: 'researchHome', title: 'Equities', alias: true },
  { path: '/app/equities/explore',  view: 'researchHome', title: 'Company explorer', alias: true },
  { path: '/app/equities/compare',  view: 'compare',   title: 'Compare companies', alias: true },
  { path: '/app/equities/:id',      view: 'research',  title: 'Company report' },
  /* Above :tab, which would otherwise read "report" as a tab name. */
  { path: '/app/equities/:id/report', view: 'researchReport', title: 'Research report' },
  { path: '/app/equities/:id/:tab', view: 'research',  title: 'Company report' },
  { path: '/app/watchlists',        view: 'watchlists', title: 'Watchlists', alias: true },
  { path: '/equities/methodology',  view: 'learn',     tab: 'models',    title: 'Methodology', alias: true },
  { path: '/compare',             view: 'compare',   title: 'Compare' },
  { path: '/my/portfolio',        view: 'portfolio', title: 'Portfolio' },
  { path: '/my/watchlists',       view: 'watchlists',title: 'Watchlists' },
  { path: '/my/theses',           view: 'thesis',    title: 'My investment cases' },
  { path: '/my/alerts',           view: 'alerts',    title: 'Alerts' },
  { path: '/my/tracked',          view: 'tracked',   title: 'Tracked' },
  /* Phase 3 — ops */
  /* The scanner's dashboard, its two P1 surfaces and the four operations
     pages. /my/scanner was the scanner's only address and stays one, as an
     alias of the dashboard: alias:true keeps go('scannerDashboard') on
     /app/scanner, and a link carrying ?symbol= (the company page's old one)
     is sent on to the builder by the dashboard itself. None of these takes a
     parameter; applyRoute resolves :id as a company only on the company
     views (COMPANY_ROUTE_VIEWS), so a scanner :id would no longer be read
     as one — but the names :setup and :alert still say what they are. */
  { path: '/app/scanner',            view: 'scannerDashboard',     title: 'Scanner' },
  { path: '/app/scanner/market',     view: 'scannerMarket',        title: 'Market screening — your series' },
  { path: '/app/scanner/backtest',   view: 'scannerBacktest',      title: 'Historical matches — simulation' },
  { path: '/admin/scanner',          view: 'scannerAdmin',         title: 'Scanner operations' },
  { path: '/admin/scanner/data',     view: 'scannerAdminData',     title: 'Scanner operations — data health' },
  { path: '/admin/scanner/jobs',     view: 'scannerAdminJobs',     title: 'Scanner operations — runs' },
  { path: '/admin/scanner/delivery', view: 'scannerAdminDelivery', title: 'Scanner operations — delivery' },
  { path: '/my/scanner',             view: 'scannerDashboard',     title: 'Scanner', alias: true },
  /* /Phase 3 — ops */
  /* Phase 3 — user */
  /* The reader's scanner pages (86-scanner.js). /setups/new sits above
     /setups/:setup, which would otherwise read "new" as a setup id; the
     parameters are :setup and :alert. The router reads :id as a company
     only on the company views (COMPANY_ROUTE_VIEWS), so the names are for
     the reader of this table, not a guard. */
  { path: '/app/scanner/setups',             view: 'scannerSetups',     title: 'Scanner setups' },
  { path: '/app/scanner/setups/new',         view: 'scannerSetupNew',   title: 'New scanner setup' },
  { path: '/app/scanner/setups/:setup',      view: 'scannerSetup',      title: 'Scanner setup' },
  { path: '/app/scanner/setups/:setup/edit', view: 'scannerSetupEdit',  title: 'Edit scanner setup' },
  { path: '/app/scanner/watchlists',         view: 'scannerWatchlists', title: 'Watchlist scanner' },
  { path: '/app/scanner/alerts',             view: 'scannerAlerts',     title: 'Scanner alerts' },
  { path: '/app/scanner/alerts/:alert',      view: 'scannerAlert',      title: 'Scanner alert' },
  { path: '/app/scanner/settings',           view: 'scannerSettings',   title: 'Scanner settings' },
  /* end Phase 3 — user */
  { path: '/start',               view: 'launcher',  title: 'Start with your goal' },
  { path: '/my/data',             view: 'userdata',  title: 'Your data' },
  { path: '/my/workspace',        view: 'workspace', title: 'Workspace' },
  { path: '/app/workspace',       view: 'workspace', title: 'Workspace', alias: true },
  { path: '/discover/sarawak',    view: 'sarawak',   title: 'Sarawak Economy Watch' },
  { path: '/property',            view: 'property',  title: 'Property' },
  { path: '/property/calculator', view: 'property',  title: 'Property deal calculator' },
  { path: '/property/opportunities', view: 'opportunities', title: 'Opportunity register' },
  { path: '/property/comparables', view: 'comparables', title: 'Sarawak comparables register' },
  { path: '/property/areas',      view: 'areas',       title: 'Area screen' },
  { path: '/us-options/wheel',    view: 'wheel',     title: 'US Options Cash Wheel' },
  /* The paths a reader actually types. All five rendered the not-found card
     while the workspace sat behind a URL nobody would guess, and the workspace
     had no inbound link either — so the only door was one nobody could find. */
  { path: '/wheel',               view: 'wheel',     title: 'US Options Cash Wheel' },
  { path: '/cash-wheel',          view: 'wheel',     title: 'US Options Cash Wheel' },
  { path: '/options',             view: 'wheel',     title: 'US Options Cash Wheel' },
  { path: '/my/wheel',            view: 'wheel',     title: 'US Options Cash Wheel' },
  { path: '/my/options',          view: 'wheel',     title: 'US Options Cash Wheel' },
  /* The short form is an alias, as sitemap.xml has always said: the page's
     address is /research/trading-index, in the section it belongs to.
     Unmarked, it was the view's first row, so all three addresses named
     /trading-index as their canonical — the one the sitemap leaves out. */
  { path: '/trading-index',       view: 'tradingIndex', title: 'QT Trading Index', alias: true },
  { path: '/research/trading-index', view: 'tradingIndex', title: 'QT Trading Index' },
  /* §18.1 asks for /learn/trading-index as well. It resolves to the same view
     rather than a second page: the methodology is on the page beside the thing
     it describes, and a duplicate would be one more surface to drift. */
  { path: '/learn/trading-index', view: 'tradingIndex', title: 'QT Trading Index methodology' },
  { path: '/learn',               view: 'learn',     title: 'Learn' },
  { path: '/learn/glossary',      view: 'learn',     tab: 'glossary',  title: 'Glossary' },
  { path: '/methodology',         view: 'learn',     tab: 'models',    title: 'Methodology' },
  { path: '/data-sources',        view: 'learn',     tab: 'data',      title: 'Data sources' },
  { path: '/learn/product-boundaries', view: 'boundaries', title: 'What this product will not do' },
  { path: '/status',              view: 'status',    title: 'Build status' },
  { path: '/decision-record',     view: 'decisionRecord', title: 'Decision record' },
  { path: '/methodology/ips',     view: 'ips',       title: 'Investment Policy Statement' },
  { path: '/corrections',         view: 'learn',     tab: 'trust',     title: 'Corrections log' },
  { path: '/pricing',             view: 'plans',     title: 'Pricing' },
  { path: '/about',               view: 'about',     title: 'About' },
  { path: '/contact',             view: 'contact',   title: 'Contact' },
  { path: '/privacy',             view: 'privacy',   title: 'Privacy' },
  { path: '/terms',               view: 'terms',     title: 'Terms' },
];

const META = {
  marketing: 'Your financial decision workspace: research companies, monitor your own market setups and evaluate property investments in one place. Business planning is next. Research only — no recommendations.',
  howItWorks: 'How each product works — what you put in, what it works out, what you can save and what to do next — and what Live, Beta, Demo and Coming soon mean.',
  researchQueue: 'The Equities research queue: companies drawn from the statements held for each, each labelled filed or illustrative, with no recommendations.',
  discover:  'Screen Bursa Malaysia and US companies on quality, financial strength and valuation — every filter and every metric explained.',
  research:  'A company report where every number shows its formula, its period and its source.',
  researchHome: 'A way into the universe by company, market or business model — never a company chosen for you.',
  sarawak: 'Companies with material exposure to the Sarawak economy. Inclusion is descriptive and does not indicate preference.',
  compare:   'Compare companies using the measures that fit their business model, not a single generic table.',
  property:  'Model a Malaysian property purchase to its real monthly cash flow, break-even rent and cash required upfront.',
  tradingIndex: 'A multi-timeframe trend reading and a test of your own first-tranche rules, from chart evidence you record yourself.',
  scanner:   'Conditions you define, evaluated on price history you supplied, recording which held on the last daily bar your history holds. Nothing ranked, nothing delivered.',
  /* Phase 3 — ops */
  scannerDashboard:     'Whether your scanner setups are active, when the last scan succeeded, which setups matched and whether anything is delivered — read from the worker’s own records.',
  scannerMarket:        'Run one of your setups over every instrument with a series in your own price history, listed in symbol order. Nothing ranked, nothing recorded.',
  scannerBacktest:      'A simulation of the dates on which your conditions held in your own history — no returns, no performance, no guarantee.',
  scannerAdmin:         'A read-only view of this machine’s scanner worker: its data, sessions, runs, alert engine, delivery and errors. The controls are commands.',
  scannerAdminData:     'The health of your price history: invalid bars, gaps against an inferred calendar, price breaks and staleness, per market and per series.',
  scannerAdminJobs:     'Every run the scanner worker recorded on this machine, with status, duration and errors, and the log of controls.',
  scannerAdminDelivery: 'Which delivery channels exist for scanner alerts — in-app only — and why email, Telegram and push are not configured.',
  /* /Phase 3 — ops */
  learn:     'How the metrics are defined, how the models are chosen, and what the data does and does not cover.',
  plans:     'Plans and pricing for Quantum Tradeworks research and property reports.',
  /* Every other view fell back to the marketing sentence above, so a shared
     link to the privacy policy or a watchlist previewed as the landing page.
     Each says what the page is, and claims nothing it does not do. */
  home:        'My Dashboard: what changed since your last visit, which of your setups matched, and what you monitor and have saved — read from this browser, with nothing recommended.',
  onboarding:  'Five questions that decide where you land in Quantum Tradeworks, and nothing else.',
  launcher:    'Start with your goal: pick one of the five things this product does and it opens the right tool.',
  portfolio:   'Holdings kept in this browser, with business performance separated from currency movement.',
  watchlists:  'Lists of companies you follow, each one usable as the scanner’s universe. Adding one implies no view on it.',
  thesis:      'What you believe about a company and what would prove you wrong, checked against the latest data.',
  alerts:      'Alerts that name the fact that changed and its source period. Nothing is sent outside this browser.',
  tracked:     'Instruments followed by price and trend only — nothing valued, scored or ranked.',
  userdata:    'Bring your own prices: what you paste stays in this browser, and how it is used.',
  opportunities: 'Real properties you record, each with what is known about it and what is not, never ordered by merit.',
  comparables: 'Sarawak transacted prices and achieved rents you have recorded, with what each one rests on.',
  areas:       'Localities in one town, shaded by what you have recorded about them. An area with no record is drawn hollow.',
  wheel:       'A cash-secured put and covered call cycle modelled from figures you enter — no chain data, no recommended contract.',
  boundaries:  'What this product will not do, and why each of those absences is deliberate.',
  status:      'What is built, what is gated, and what is holding it.',
  decisionRecord: 'One printable page: the figures, every input with where it came from, and everything still open.',
  researchReport: 'One company on one printable page: statements, metrics with their status, your valuation assumptions, and where every figure came from. Saved as PDF through your browser’s print.',
  workspace:   'Everything you have saved in this browser, across kinds, with the model and data version each was saved against.',
  ips:         'The Investment Policy Statement this product’s calculations carry out, and where the product departs from it.',
  about:       'What Quantum Tradeworks is and is not, and who is responsible for it.',
  contact:     'How to report a wrong figure, and where the contact route will be published.',
  privacy:     'What this build stores, where it stores it, and what leaves your device.',
  terms:       'The terms this build is offered under: research, not advice.',
};

/* The app is mounted at the domain root in production, but served from a
   subdirectory in some local setups. Deriving the base once keeps every
   generated link correct in both. */
const BASE = (() => {
  const p = location.pathname;
  const i = p.indexOf('/index.html');
  return i > -1 ? p.slice(0, i) : '';
})();
const href = (path) => `${BASE}${path}` || '/';
/* Data files live at the app's base, never relative to the current route. A
   relative 'data/x.json' worked only while every URL was the root; on
   /my/tracked it resolves to /my/data/x.json and 404s, which silently disabled
   real data on every nested route. */
/* A versioned file gets its content hash in the query string; the host serves
   /data/* as immutable, so that hash is what makes a year of caching correct
   rather than reckless. An unversioned file — the licensed lane — is requested
   bare and fetchJson keeps it out of every cache. */
const dataUrl = (file) => {
  const v = DATA_VERSIONS[file];
  return `${BASE}/data/${file}${v ? `?v=${v}` : ''}`;
};
const isVersioned = (url) => /[?&]v=[0-9a-f]{6,}$/.test(url);

/* Returns the parsed body, or null when the file is genuinely absent. A host
   configured with a catch-all rewrite answers 200 and text/html for a missing
   path, so status alone cannot distinguish "not deployed" from "here it is". */
async function fetchJson(url) {
  /* no-store ONLY where the URL cannot prove what it holds. A ?v= URL is
     content-addressed, so the default cache is not merely safe there — it is the
     entire point of stamping the hash in. */
  const r = await fetch(url, isVersioned(url) ? { cache: 'default' } : { cache: 'no-store' });
  if (!r.ok) return null;
  const ct = r.headers.get('content-type') || '';
  if (!/json/i.test(ct)) return null;      /* an HTML fallback, not the file */
  try { return await r.json(); } catch { return null; }
}

function matchRoute(pathname) {
  const clean = (pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname).replace(/\/+$/, '') || '/';
  for (const r of ROUTES) {
    if (!r.path.includes(':')) { if (r.path === clean) return { ...r, params: {} }; continue; }
    const rp = r.path.split('/'), cp = clean.split('/');
    if (rp.length !== cp.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      if (rp[i].startsWith(':')) params[rp[i].slice(1)] = cp[i];
      else if (rp[i] !== cp[i]) { ok = false; break; }
    }
    if (ok) return { ...r, params };
  }
  return null;
}

function setDocumentMeta(route) {
  const co = (route?.view === 'research' || route?.view === 'researchReport') && !route.pending && State.ticker && BY_ID.get(State.ticker);
  const name = co
    ? `${route.view === 'researchReport' ? 'Research report: ' : ''}${co.c.tk} — ${co.c.name}`
    : (route?.title || 'Not found');
  document.title = route?.path === '/' ? route.title : `${name} · Quantum Tradeworks`;
  const desc = META[route?.view] || META.marketing;
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', 'description'); document.head.append(tag); }
  tag.setAttribute('content', desc);
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.setAttribute('rel', 'canonical'); document.head.append(canon); }
  canon.setAttribute('href', location.origin + href(canonicalPath(route)));
}

/* ONE PAGE, ONE CANONICAL ADDRESS. The canonical was location.pathname, so
   /company/aapl, /company/aapl-sec, /app/equities/aapl and /app/ each named
   themselves — the aliases were declared to be one page and then told every
   crawler they were five. A company page canonicalises to companyPath (with
   its tab, which is different content); any other route to the first route
   that shows the same view and tab, which is where the aliases point. */
function canonicalPath(route) {
  if (!route || route.pending) {
    const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
    return p.replace(/\/+$/, '') || '/';
  }
  if (route.view === 'research' && State.ticker && BY_ID.get(State.ticker)) {
    const tab = State.researchTab && State.researchTab !== 'snapshot' ? `?tab=${State.researchTab}` : '';
    return companyPath(BY_ID.get(State.ticker).c) + tab;
  }
  if (route.view === 'researchReport' && State.ticker && BY_ID.get(State.ticker))
    return `${companyPath(BY_ID.get(State.ticker).c)}/report`;
  /* A parameterised page that is not a company's — a scanner setup, an
     alert — is its own address. The fallback below returned route.path
     verbatim, so the canonical link read /app/scanner/alerts/:alert. */
  if (route.path.includes(':')) {
    const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
    return p.replace(/\/+$/, '') || '/';
  }
  /* Never an alias row. The brief's aliases sit ABOVE the canonical rows (so
     that matchRoute reads them first), and go() already skips them for that
     reason; this lookup did not, so /compare named /app/equities/compare as
     its canonical, /methodology named /equities/methodology, and
     /my/watchlists named /app/watchlists — an address robots.txt disallows. */
  const fits = (r) => !r.path.includes(':') && r.view === route.view && (r.tab || null) === (route.tab || null);
  const same = ROUTES.find(r => !r.alias && fits(r)) || ROUTES.find(fits);
  return same ? same.path : route.path;
}

/* Navigate. push=false is for popstate, where the browser already moved. */
/* "path?query" built from the current address, with `tab` set or dropped as
   the caller says. navigate() strips a trailing "?" so an empty query is clean.
   Which other parameters travel is navigate()'s rule for a bare path, applied
   here too: within the same view they all do; leaving the view keeps only the
   two global ones, ?personal=1 and ?real=0. This helper used to keep every
   parameter unconditionally, and because go() and openResearch() build their
   address through it, navigate()'s rule never ran for them — "See plans" on
   the property calculator opened /pricing?city=…&district=…&d=price:600000,
   a shareable link carrying the reader's deal figures to a page that reads
   none of them. */
const GLOBAL_PARAMS = new Set(['personal', 'real']);
function keptQuery(path) {
  const target = matchRoute(path.split('?')[0]);
  const q = new URLSearchParams(location.search);
  if (!target || target.view !== State.view) { for (const k of [...q.keys()]) if (!GLOBAL_PARAMS.has(k)) q.delete(k); }
  return q;
}
function withQuery(path, tab) {
  const q = keptQuery(path); q.delete('tab');
  if (tab) q.set('tab', tab);
  return `${path}?${q.toString()}`;
}
/* The tab the address currently names, if it is one of this view's. */
const currentTabIn = (tabs) => { const t = new URLSearchParams(location.search).get('tab'); return t && tabs.some(x => x.id === t) ? t : null; };
/* The research tab a move to another company keeps. The address names it as
   ?tab= on /company/ but as a path segment on /app/equities/:id/:tab, which
   ?tab= alone never saw — so Financials on /app/equities/aapl/financials fell
   back to the next company's Snapshot. State.researchTab is what the router
   resolved from either form. Snapshot is the default and is left out. */
const carriedResearchTab = () => currentTabIn(RESEARCH_TABS)
  || (State.view === 'research' && State.researchTab !== 'snapshot' ? State.researchTab : null);

let lastPath = location.pathname;
function navigate(path, { push = true, replace = false } = {}) {
  /* A path with no query keeps the current one — MINUS a tab that belongs to
     another view. A tab id means something only inside its own view, and a
     research tab riding onto /discover reached a panel lookup with no such
     panel and threw. It is also dropped when the target route names its own
     tab in the path. A path ending in a bare "?" means "and no query". */
  let url;
  if (path.includes('?')) {
    /* A path that brings its own query (a footer link to /learn?tab=scoring)
       still keeps the two global parameters, as every other route change
       does; one the path names itself wins. */
    const [p, s0] = path.split('?');
    const q = new URLSearchParams(s0), here = new URLSearchParams(location.search);
    for (const k of GLOBAL_PARAMS) if (here.has(k) && !q.has(k)) q.set(k, here.get(k));
    const s = q.toString();
    url = href(p) + (s ? `?${s}` : '');
  }
  else {
    /* Parameters belong to a view. A tab id means something only inside its
       own view; the property calculator's ?city, ?district and ?d= mean
       nothing on /learn and used to ride there. Leaving a view keeps only the
       two that are global — ?personal=1 and ?real=0, read at boot. */
    const target = matchRoute(path);
    const q = keptQuery(path);
    if (target && target.view === State.view && target.tab) q.delete('tab');
    const s = q.toString();
    url = href(path) + (s ? `?${s}` : '');
  }
  url = url.replace(/\?$/, '');
  if (replace) history.replaceState({ path }, '', url);
  else if (push && (location.pathname + location.search) !== url) history.pushState({ path }, '', url);
  const before = State.view;
  applyRoute();
  afterRoute(before);
}

/* What happens after the address changed and the page re-rendered — shared
   by navigate() and the browser's Back/Forward, which used to get none of it.
   A different page (view or path) scrolls to the top, closes a drawer that
   belonged to the old page, and puts focus on the main landmark so a screen
   reader starts at the new content and the next Tab is its first control. A
   different TAB on the same page does not scroll — the tab strip is sticky so
   it can be used far down the page — and puts focus back on the tab now
   selected, because render() rebuilt the strip and destroyed the button that
   had focus, which drops focus to <body>. */
function afterRoute(beforeView) {
  const pathChanged = location.pathname !== lastPath;
  lastPath = location.pathname;
  /* A menu or the navigation drawer that led here has done its job, and the
     new page takes focus, so neither hands focus back. Chosen from one of
     them, the page already on screen takes focus too: the link that had it
     is about to be hidden with its menu, and focus would fall to <body>. */
  const fromMenu = openMenuLi || sheetOpen || navDrawerOpen;
  closeShellMenus({ restore: false });
  if (State.view !== beforeView || pathChanged) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (drawer.dataset.open === '1') closeDrawer({ restore: false });
    focusMain();
  } else {
    document.querySelector('.subnav [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
    if (fromMenu) focusMain();
  }
}

/* The landmark takes tabindex only for the moment it is focused and drops it
   on blur. Left in place, every mouse click on non-interactive content would
   focus main, and the next Tab would start from the top of the page rather
   than from where the reader clicked. */
function focusMain() {
  const main = document.getElementById('main');
  if (!main) return;
  main.setAttribute('tabindex', '-1');
  main.addEventListener('blur', () => main.removeAttribute('tabindex'), { once: true });
  main.focus({ preventScroll: true });
}

/* The views whose :id is a company. register-check's route rule reads the
   same two, so the checker and the router agree on what a path names. */
const COMPANY_ROUTE_VIEWS = new Set(['research', 'researchReport']);
function applyRoute() {
  const route = matchRoute(location.pathname);
  if (!route) { State.view = 'notfound'; setDocumentMeta(null); render(); return; }
  /* A route whose view is defined in a module this build does not carry —
     How it works and the research queue arrive with their own branches — is
     the not-found card, not a page reading "Not found" in plain text under
     the route's own title, and not a throw. */
  if (!VIEWS[route.view]) { State.view = 'notfound'; State.notFoundWhat = null; setDocumentMeta(null); render(); return; }

  /* Onboarding intercepted the dashboard, and only the dashboard: every other
     address is a legitimate entry point, and a setup sequence in front of a
     shared link loses the visitor the link was meant to bring. Since Release
     A it intercepts nothing. My Dashboard's first-time state is itself the
     onboarding — a checklist read from what the visitor has actually done —
     so a gate in front of it would ask five questions before showing the
     page that answers them. /welcome is still a page anyone can open. */
  const ENTRY = [];
  if (!onboarded() && ENTRY.includes(route.view)) {
    State.view = 'onboarding';
    setDocumentMeta({ ...route, view: 'onboarding', title: 'Get started' });
    /* The global parameters travel with the redirect. Dropping them left a
       ?real=0 session running on the sample set under an address that no
       longer said so — a refresh, or the link copied from it, switched data
       modes silently. */
    const g = keptQuery('/welcome').toString();
    const to = href('/welcome') + (g ? `?${g}` : '');
    if (location.pathname + location.search !== to) history.replaceState({ path: '/welcome' }, '', to);
    render();
    return;
  }
  /* Only a company page's :id names a company. The branch below is what
     makes /app/equities/1155 and /company/1155.KL the same page, so it stays;
     but it once ran for any route with a parameter called id, and the
     scanner's routes escaped it only because their parameters happen to be
     :setup and :alert — a rename would have sent /app/scanner/setups/:id to
     "No company “trend-breakout”". The guard is by view, not by name. */
  if (route.params?.id && COMPANY_ROUTE_VIEWS.has(route.view)) {
    const id = companyFromSlug(route.params.id);
    if (id) {
      State.ticker = id;
      /* A registry alias with a dot in it (1155.KL) opens the page in-app, but
         the host serves any dotted path as a file: the rewrite to index.html
         excludes it on Vercel and serve.mjs falls back only for extensionless
         paths, so a reload or a shared link 404'd. The address is swapped for
         the company's own dotless segment, keeping the route, tab and query,
         so every address the router accepts is one that survives a reload. */
      if (String(route.params.id).includes('.')) {
        const clean = (location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname).split('/');
        const at = route.path.split('/').indexOf(':id');
        clean[at] = companyPath(BY_ID.get(id).c).split('/').pop();
        history.replaceState(history.state, '', href(clean.join('/')) + location.search);
      }
    }
    /* While the filings are in flight only the sample set can be searched, so
       every filed company is "unknown" for that second — and a cold deep link
       to one painted "404 No company" under the title "Not found" until
       us.json arrived. An unresolved slug waits with the view's skeleton
       instead; boot runs this router again once the filings land (or fail),
       and only then is an unknown slug a 404. */
    else if (realPending) {
      State.view = route.view;
      setDocumentMeta({ ...route, title: 'Loading company report', pending: true });
      render(); return;
    }
    else { State.view = 'notfound'; State.notFoundWhat = `company “${route.params.id}”`; setDocumentMeta(null); render(); return; }
  }
  if (route.tab) {
    if (route.view === 'discover') State.discoverTab = route.tab;
    if (route.view === 'research') State.researchTab = route.tab;
    if (route.view === 'learn') State.learnTab = route.tab;
  }
  const qs = new URLSearchParams(location.search);
  if (route.view === 'compare' && qs.get('companies')) {
    /* Through the same resolver as a company address, so every name
       /app/equities/:id accepts — 1155, maybank, aapl, a CIK — works here too.
       Matching BY_ID alone dropped 1155 without a word. */
    const ids = [...new Set(qs.get('companies').split(',').map(s => companyFromSlug(s.trim())).filter(Boolean))];
    if (ids.length) State.compare = ids.slice(0, lim('compare'));
  }
  /* THE TAB IS PART OF THE ADDRESS. Tab clicks used to change State and
     re-render without touching the URL, so Back never restored a tab and a
     shared link never carried one. Every tab strip now navigates, and the
     tab is read back from the path where a route carries it and from ?tab=
     where it does not. A company page with no tab in its address is on its
     snapshot; anything unknown falls back the same way. */
  if (route.view === 'research') {
    /* The tab may be a path segment (/app/equities/aapl/financials — the
       brief's form, with its names for our tabs) or ?tab= on /company/. */
    const raw = route.params?.tab ? String(route.params.tab).toLowerCase() : qs.get('tab');
    const t = RESEARCH_TAB_ALIAS[raw] || raw;
    State.researchTab = t && RESEARCH_TABS.some(x => x.id === t) ? t : 'snapshot';
  }
  /* Validated against the view's own tabs, as research is above. An unknown
     id leaves the view's tab as it was: a research tab that leaked onto
     /discover once became State.discoverTab, and the panel lookup threw. */
  if (!route.tab && qs.get('tab')) {
    const t = qs.get('tab');
    if (route.view === 'discover' && DISCOVER_TABS.some(x => x.id === t)) State.discoverTab = t;
    if (route.view === 'learn' && (LEARN_TABS.some(x => x.id === t) || LEARN_TAB_ALIAS[t])) State.learnTab = t;
  }
  /* /learn with no tab in its address is the Metric dictionary, as a fresh
     load of it is. Left alone, the previous tab survived: Back from
     /learn?tab=scoring kept Scoring under /learn, and the header's Learn link
     from /corrections showed the Corrections tab. Research does the same with
     its snapshot above. */
  if (route.view === 'learn' && !route.tab) {
    const t = qs.get('tab');
    if (!(t && (LEARN_TABS.some(x => x.id === t) || LEARN_TAB_ALIAS[t]))) State.learnTab = 'dictionary';
  }

  /* A screen template named in the address (?template=div-cover) loads as the
     screen, so a link can open the screener on the question it promises —
     "Check whether a dividend is sustainable" opened the default columns. It
     is applied once and the parameter dropped from the address, so a later
     tab change inside Discover does not reload it over the reader's edits. */
  if (route.view === 'discover' && qs.get('template')) {
    const t = SCREEN_TEMPLATES.find(x => x.id === qs.get('template'));
    if (t) { const s = blankScreen(); t.apply(s); State.screen = s; State.appliedTemplate = t.id; }
    qs.delete('template');
    const rest = qs.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : ''));
  }
  /* The launcher's goal does not persist (55-views-public.js says why), but it
     lived on in State for the session, so coming back to /start from another
     page reopened the last goal's questions instead of the menu. Entering the
     view resets it; the answers are kept. */
  if (route.view === 'launcher' && State.view !== 'launcher' && State.launcher) State.launcher.goal = null;
  State.view = route.view;
  setDocumentMeta(route);
  render();
}

/* The comparison set changed on the page. ?companies= wins over storage on
   every route apply, so a page opened from such a link reverted every chip or
   preset edit on reload or Back while storage held the edit. The address is
   rewritten in place (replace, not push: a chip click is not a new page). */
function saveCompare() {
  store.write('compare', State.compare);
  const q = new URLSearchParams(location.search);
  if (State.view !== 'compare' || !q.has('companies')) return;
  q.set('companies', State.compare.join(','));
  history.replaceState(history.state, '', `${location.pathname}?${q.toString().replace(/%2C/gi, ',')}`);
}

/* Kept so the existing call sites keep working while the app moves to paths.
   Each one resolves to the route that owns that view. */
function go(view, opts = {}) {
  if (opts.ticker) State.ticker = opts.ticker;
  if (opts.tab) {
    if (view === 'discover') State.discoverTab = opts.tab;
    if (view === 'research') State.researchTab = opts.tab;
    if (view === 'learn') State.learnTab = opts.tab;
  }
  if (view === 'research' && State.ticker && BY_ID.has(State.ticker)) {
    const c = BY_ID.get(State.ticker).c;
    navigate(withQuery(companyPath(c), opts.tab || carriedResearchTab()));
    return;
  }
  /* A route that carries the tab in its path is used when one exists; a tab
     with no route of its own rides on the view's base path as ?tab=. Either
     way the stale ?tab= from wherever the reader came from is dropped, and the
     other parameters follow withQuery's rule: all of them within the view,
     only ?personal and ?real out of it. */
  const own = ROUTES.filter(x => !x.alias);
  const exact = opts.tab ? own.find(x => x.view === view && x.tab === opts.tab) : null;
  const base = own.find(x => x.view === view && !x.tab && !x.path.includes(':'))
            || own.find(x => x.view === view && !x.path.includes(':'));
  const target = exact ? exact.path : base ? base.path : '/app';
  navigate(withQuery(target, exact ? null : opts.tab));
}
function openResearch(id, tab) {
  State.ticker = id;
  const row = BY_ID.get(id);
  /* A tab given explicitly — snapshot included — goes in the address. No tab
     given keeps the one the address already names IF it is a research tab —
     a reader moving between companies on the Financials tab stays on it —
     and drops anything else, so a company link never carries ?tab=heatmap
     from the view it was clicked on. */
  navigate(withQuery(companyPath(row ? row.c : id), tab || carriedResearchTab()));
}

/* Which sidebar item a view sits under — the one table that says where every
   page belongs, read by the sidebar's current item and by productOf(). The
   header it replaced matched on the view id alone, so sub-pages left it with
   no current item; every view that belongs somewhere is listed. The personal
   pages that are not items of their own sit where they fit: holdings and
   investment cases are things a reader saved (Saved Models), and tracked
   instruments are followed like a watchlist. The Trading Index is a section
   of the Scanner, as its page's strip says. The decision record serves
   property, the wheel and the trading index alike, and onboarding and the
   goal launcher sit before any of them, so none of those is claimed; nor is
   any public page — the sidebar is not on them. */
const SECTION_OF = {
  home: 'dashboard',
  watchlists: 'watchlists', tracked: 'watchlists',
  alerts: 'alerts',
  workspace: 'workspace', thesis: 'workspace', portfolio: 'workspace',
  userdata: 'userdata', plans: 'plans',
  researchHome: 'equities', research: 'equities', researchReport: 'equities', researchQueue: 'equities',
  discover: 'equities', compare: 'equities', sarawak: 'equities', wheel: 'equities',
  property: 'property', opportunities: 'property', comparables: 'property', areas: 'property',
  tradingIndex: 'scanner',
  /* Every scanner page, the operations pages included: they are the
     scanner's, even though the navigation carries no link to them. */
  ...Object.fromEntries(SCANNER_VIEWS.map(v => [v, 'scanner'])),
};
/* Guarded twice: the function may not exist in a build without the alerts
   pages, and a throw inside the chrome would take every page down with it. */
function navUnread() {
  try { const n = scanUnreadCount(); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
}

/* ------------------------------------------------------------ the chrome */
/* Built once, then kept current by buildNav() on every render. Rebuilt on
   every render, as the old header was, a link that had focus was destroyed
   under the keyboard by any redraw — a theme switch, a scanner status
   change — and an open menu snapped shut. Real anchors throughout (data-path
   routes them in-app), so middle-click, open in a new tab and copy link
   address all work. */
const shellEl = {
  pubbar: $('#pubbar'), pubnav: $('#pubnav'), sheet: $('#pubSheet'), sheetBtn: $('#pubMenuBtn'),
  appbar: $('#appbar'), sidebar: $('#sidebar'), appnav: $('#appnav'), navOpen: $('#navOpen'), navClose: $('#navClose'),
  navScrim: $('#navScrim'), tabsHost: $('#productTabs'),
};
const shellLink = (path, attrs, ...kids) => el('a', { href: href(path), 'data-path': path, ...attrs }, ...kids);
const shellIcon = (name, size = 18, cls = 'sb-ico') => el('span', { class: cls, 'aria-hidden': 'true', html: icon(name, size) });

/* A resource link is current when it names the page on screen: its own
   address first, then the page its route opens — the alias /learn and
   /learn/glossary both open the dictionary, and the address decides which. */
function resourceHere() {
  const here = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  const exact = RESOURCES.find(r => r.path === (here.replace(/\/+$/, '') || '/'));
  if (exact) return exact;
  return RESOURCES.find(r => {
    const rt = matchRoute(r.path);
    if (!rt || rt.view !== State.view) return false;
    if (rt.view === 'learn') return (LEARN_TAB_ALIAS[rt.tab] || rt.tab || 'dictionary') === State.learnTab;
    return true;
  }) || null;
}

/* The four products as rows: name, badge, blurb. A product that is not built
   is a row of text — no link, no button, nothing to press. */
function productRows() {
  return PRODUCTS.map(p => {
    const kids = [
      el('span', { class: 'pp-ico', 'aria-hidden': 'true', html: icon(PRODUCT_ICON[p.id] || 'grid', 18) }),
      el('span', { class: 'pp-body' }, [
        el('span', { class: 'pp-head' }, [el('span', { class: 'pp-name' }, p.name), productBadge(p.id)]),
        el('span', { class: 'pp-blurb' }, p.blurb),
      ]),
    ];
    return el('li', {}, p.path
      ? shellLink(p.path, { class: 'pp-row', 'data-product': p.id }, kids)
      : el('div', { class: 'pp-row pp-row-off', 'data-product': p.id }, kids));
  });
}
/* Drawn twice — the menu and the phone sheet — so each copy's labels carry
   their own ids. */
function resourceLists(prefix) {
  const group = (g, label) => el('div', { class: 'rs-group' }, [
    el('p', { class: 'rs-label', id: `${prefix}-rs-${g}` }, label),
    el('ul', { class: 'rs-list', 'aria-labelledby': `${prefix}-rs-${g}` },
      RESOURCES.filter(r => r.group === g).map(r => el('li', {}, shellLink(r.path, { class: 'rs-link' }, r.label)))),
  ]);
  return [group('method', 'Method and data'), group('company', 'This build and its terms')];
}

/* A disclosure menu of the public header: a button that says whether it is
   open, and the panel after it in the reading order, so Tab walks into it. */
function pubMenu(id, label, panelKids, cls) {
  const btn = el('button', { type: 'button', class: 'publink pubmenu-btn', id: `${id}Btn`, 'aria-expanded': 'false', 'aria-controls': id },
    label, shellIcon('chev', 14, 'pub-chev'));
  const panel = el('div', { class: `pubpanel ${cls}`, id }, panelKids);
  panel.hidden = true;
  const li = el('li', { class: 'pubmenu' }, [btn, panel]);
  btn.addEventListener('click', () => (openMenuLi === li ? closeMenu() : openMenu(li)));
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault(); openMenu(li, { focusFirst: true });
  });
  /* Arrow keys walk the panel's links; Tab still leaves it, and leaving by
     Tab closes it. A pointer leaving does nothing — only a click outside. */
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...panel.querySelectorAll('a')];
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  });
  li.addEventListener('focusout', (e) => {
    if (openMenuLi === li && e.relatedTarget && !li.contains(e.relatedTarget)) closeMenu({ restore: false });
  });
  return li;
}

let openMenuLi = null, sheetOpen = false, navDrawerOpen = false, navDrawerTimer = null;
function openMenu(li, { focusFirst = false } = {}) {
  if (openMenuLi && openMenuLi !== li) closeMenu({ restore: false });
  const btn = li.querySelector('.pubmenu-btn'), panel = li.querySelector('.pubpanel');
  openMenuLi = li;
  panel.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => { if (openMenuLi === li) panel.dataset.open = '1'; });
  if (focusFirst) panel.querySelector('a')?.focus();
}
/* restore: focus goes back to the button — Escape's contract. A click
   elsewhere or a navigation leaves focus where it went. */
function closeMenu({ restore = true } = {}) {
  const li = openMenuLi;
  if (!li) return false;
  openMenuLi = null;
  const btn = li.querySelector('.pubmenu-btn'), panel = li.querySelector('.pubpanel');
  panel.hidden = true; delete panel.dataset.open;
  btn.setAttribute('aria-expanded', 'false');
  if (restore) btn.focus();
  return true;
}
function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true;
  shellEl.sheet.hidden = false;
  shellEl.sheetBtn.setAttribute('aria-expanded', 'true');
  shellEl.sheetBtn.setAttribute('aria-label', 'Close the menu');
  requestAnimationFrame(() => { if (sheetOpen) shellEl.sheet.dataset.open = '1'; });
}
function closeSheet({ restore = true } = {}) {
  if (!sheetOpen) return false;
  sheetOpen = false;
  shellEl.sheet.hidden = true; delete shellEl.sheet.dataset.open;
  shellEl.sheetBtn.setAttribute('aria-expanded', 'false');
  shellEl.sheetBtn.setAttribute('aria-label', 'Menu');
  if (restore) shellEl.sheetBtn.focus();
  return true;
}
/* THE SIDEBAR AS A DRAWER, below 1024px. A modal dialog while it is open —
   role, aria-modal and a label, focus on its close button, Tab kept inside
   it (95-boot.js), Escape and the scrim close it — and a plain part of the
   page again once it is closed, when it is also invisible and out of the
   tab order. Only transform moves; visibility changes at the ends. */
function openNavDrawer() {
  if (navDrawerOpen || !shellEl.sidebar) return;
  clearTimeout(navDrawerTimer);
  navDrawerOpen = true;
  const sb = shellEl.sidebar;
  sb.setAttribute('role', 'dialog'); sb.setAttribute('aria-modal', 'true'); sb.setAttribute('aria-label', 'Menu');
  sb.dataset.drawer = 'opening';
  shellEl.navScrim.hidden = false;
  shellEl.navOpen.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!navDrawerOpen) return;
    sb.dataset.drawer = 'open'; shellEl.navScrim.dataset.open = '1';
  }));
  shellEl.navClose.focus({ preventScroll: true });
}
function closeNavDrawer({ restore = true, instant = false } = {}) {
  if (!navDrawerOpen) return false;
  navDrawerOpen = false;
  const sb = shellEl.sidebar;
  ['role', 'aria-modal', 'aria-label'].forEach(a => sb.removeAttribute(a));
  shellEl.navOpen.setAttribute('aria-expanded', 'false');
  shellEl.navScrim.dataset.open = '0';
  const done = () => { sb.dataset.drawer = 'closed'; shellEl.navScrim.hidden = true; };
  if (instant) done();
  else { sb.dataset.drawer = 'closing'; navDrawerTimer = setTimeout(done, 260); }
  if (restore) shellEl.navOpen.focus({ preventScroll: true });
  return true;
}
function closeShellMenus({ restore = false } = {}) {
  closeMenu({ restore });
  closeSheet({ restore });
  closeNavDrawer({ restore });
}

let shellBuilt = false;
function buildShell() {
  if (shellBuilt) return;
  shellBuilt = true;
  /* The public header: Products, How it works, Pricing, Resources. */
  if (shellEl.pubnav) {
    shellEl.pubnav.append(el('ul', { class: 'pubnav-list' }, [
      pubMenu('menuProducts', 'Products', [el('ul', { class: 'pp-list' }, productRows())], 'pubpanel-products'),
      el('li', {}, shellLink('/how-it-works', { class: 'publink', 'data-pub': 'howItWorks' }, 'How it works')),
      el('li', {}, shellLink('/pricing', { class: 'publink', 'data-pub': 'plans' }, 'Pricing')),
      pubMenu('menuResources', 'Resources', resourceLists('menu'), 'pubpanel-resources'),
    ]));
  }
  /* The same items, as the phone's sheet. The theme lives here below 1024px,
     where the header has room only for the brand and the one action. */
  if (shellEl.sheet) {
    shellEl.sheet.append(el('div', { class: 'sheet-in' }, [
      el('p', { class: 'rs-label', id: 'sheet-products' }, 'Products'),
      el('ul', { class: 'pp-list', 'aria-labelledby': 'sheet-products' }, productRows()),
      el('ul', { class: 'sheet-links' }, [
        el('li', {}, shellLink('/how-it-works', { class: 'sheet-link', 'data-pub': 'howItWorks' }, 'How it works')),
        el('li', {}, shellLink('/pricing', { class: 'sheet-link', 'data-pub': 'plans' }, 'Pricing')),
      ]),
      el('div', { class: 'sheet-resources' }, resourceLists('sheet')),
      el('button', { type: 'button', class: 'sheet-link sheet-theme', 'data-theme-toggle': '', 'aria-label': 'Switch colour theme' }, [
        el('span', { class: 'sb-ico', 'aria-hidden': 'true', 'data-theme-icon': '', html: '' }),
        el('span', { 'data-theme-label': '' }, 'Theme'),
      ]),
    ]));
    shellEl.sheetBtn.addEventListener('click', () => (sheetOpen ? closeSheet() : openSheet()));
  }
  /* The sidebar: My Workspace, Products, then the reader's data and plans. */
  if (shellEl.appnav) {
    const item = (n, extra = []) => el('li', { class: 'sb-item', 'data-item': n.id }, [
      shellLink(n.path, { class: 'sb-link', 'data-nav-id': n.id }, [shellIcon(n.icon), el('span', { class: 'sb-text' }, n.label), ...extra]),
    ]);
    const products = PRODUCTS.filter(p => SHOW_UNBUILT || p.path);
    shellEl.appnav.append(
      el('p', { class: 'sb-label', id: 'sb-ws' }, 'My workspace'),
      el('ul', { class: 'sb-list', 'aria-labelledby': 'sb-ws' }, APP_NAV_WORKSPACE.map(n => item(n))),
      el('p', { class: 'sb-label', id: 'sb-products' }, 'Products'),
      el('ul', { class: 'sb-list', 'aria-labelledby': 'sb-products' },
        products.map(p => item({ id: p.id, label: p.name, icon: PRODUCT_ICON[p.id], path: p.path }, [productBadge(p.id)]))),
      el('ul', { class: 'sb-list sb-list-foot' }, APP_NAV_FOOT.map(n => item(n))),
    );
    shellEl.navOpen?.addEventListener('click', openNavDrawer);
    shellEl.navClose?.addEventListener('click', () => closeNavDrawer());
    shellEl.navScrim?.addEventListener('click', () => closeNavDrawer());
    /* Widened past the breakpoint with the drawer open, the sidebar becomes
       the persistent one; the drawer's state must not linger on it. The
       sheet belongs to the narrow header and closes the same way. */
    matchMedia('(min-width: 1024px)').addEventListener('change', (e) => {
      if (!e.matches) return;
      closeNavDrawer({ restore: false, instant: true });
      closeSheet({ restore: false });
    });
  }
  /* The footer's Products and Resources, from the same tables. */
  const footP = $('#footProducts'), footR = $('#footResources');
  if (footP) footP.append(...PRODUCTS.map(p => el('li', {}, p.path
    ? shellLink(p.path, { class: 'foot-product' }, [p.name, productBadge(p.id)])
    : el('span', { class: 'foot-product foot-product-off' }, [p.name, productBadge(p.id)]))));
  if (footR) footR.append(
    ...RESOURCES.filter(r => r.group === 'method' || r.path === '/status').map(r => el('li', {}, shellLink(r.path, {}, r.label))),
    el('li', {}, el('button', { type: 'button', class: 'linklike', 'data-action': 'report-error' }, 'Report a data error')));
  /* A click outside an open menu or the sheet closes it. */
  document.addEventListener('click', (e) => {
    if (openMenuLi && !openMenuLi.contains(e.target)) closeMenu({ restore: false });
    if (sheetOpen && !shellEl.pubbar.contains(e.target)) closeSheet({ restore: false });
  });
  /* The chrome the address will wear, now, rather than at the first render
     after the rest of the modules load: an app page otherwise showed the
     public header for as long as that took. */
  document.documentElement.dataset.chrome = chromeOf(matchRoute(location.pathname)?.view || 'notfound');
}

/* The current page, in both chromes, on every render. */
function buildNav() {
  buildShell();
  const chrome = chromeOf(State.view);
  document.documentElement.dataset.chrome = chrome;
  /* A drawer or a sheet belongs to the chrome that opened it. */
  if (chrome === 'public') closeNavDrawer({ restore: false, instant: true });
  else closeSheet({ restore: false });
  const section = SECTION_OF[State.view] || null;
  shellEl.appnav?.querySelectorAll('a.sb-link').forEach(a => {
    if (a.dataset.navId === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  /* THE SCANNER'S UNREAD ALERTS, on My Alerts. Counted by the alerts page's
     own function (scanUnreadCount, null when no alerts file is visible); a
     count is shown only when there is one, since a 0 would claim a record
     exists. The count is a link of its own, to the page that lists those
     alerts: /my/alerts is the research alert feed and does not list the
     scanner's matches, so a count on its link would promise alerts the page
     it opens does not show. */
  const alertsLi = shellEl.appnav?.querySelector('[data-item="alerts"]');
  if (alertsLi) {
    alertsLi.querySelector('.sb-count')?.remove();
    const unread = typeof scanUnreadCount === 'function' ? navUnread() : null;
    if (unread) {
      const said = `${unread} unread scanner alert${unread === 1 ? '' : 's'}`;
      alertsLi.append(shellLink('/app/scanner/alerts', { class: 'sb-count', 'aria-label': said, title: said },
        el('span', { class: 'nav-count' }, unread > 99 ? '99+' : String(unread))));
    }
  }
  /* The public header's current link, and a mark on the menu that holds it. */
  const res = chrome === 'public' ? resourceHere() : null;
  document.querySelectorAll('#pubnav a, #pubSheet a').forEach(a => {
    const on = a.dataset.pub ? a.dataset.pub === State.view : res ? a.dataset.path === res.path : false;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#menuResourcesBtn')?.toggleAttribute('data-current', !!res);
}

/* THE PRODUCT'S TABS, above its pages. Drawn into their own host in <main>,
   outside the view, so a tab change does not replay the view's entrance on
   the strip the reader just pressed. A nav landmark named for the product;
   the tab for the page on screen is current. */
function renderProductTabs() {
  const host = shellEl.tabsHost;
  if (!host) return;
  const pid = productOf(State.view);
  const tabs = PRODUCT_TABS[pid];
  if (!tabs || NO_PRODUCT_TABS.has(State.view)) { host.replaceChildren(); host.hidden = true; return; }
  const p = productById(pid);
  const here = tabs.find(t => t.views.includes(State.view) && (!t.tabs || t.tabs.includes(State.discoverTab)))
    || tabs.find(t => t.views.includes(State.view));
  const nav = el('nav', { class: 'ptabs', 'aria-label': `${p.name} sections` }, [
    el('span', { class: 'ptabs-name' }, [shellIcon(PRODUCT_ICON[pid], 16, 'ptabs-ico'), el('span', {}, p.name), productBadge(pid)]),
    el('ul', { class: 'ptabs-list' }, tabs.map(t => el('li', {},
      shellLink(t.path, { class: 'ptab', 'aria-current': t === here ? 'page' : null }, t.label)))),
  ]);
  host.replaceChildren(el('div', { class: 'shell' }, nav));
  host.hidden = false;
  /* Where the row is narrower than its tabs it scrolls: the current tab is
     brought into it, so the page's own name is never the one scrolled out of
     sight, and the row fades at whichever end has more — the sign that there
     is more, which a hidden scrollbar does not give. */
  const list = nav.querySelector('.ptabs-list'), cur = nav.querySelector('.ptab[aria-current]');
  if (list && cur && list.scrollWidth > list.clientWidth + 1) {
    const l = list.getBoundingClientRect(), c = cur.getBoundingClientRect();
    list.scrollLeft += (c.left + c.width / 2) - (l.left + l.width / 2);
  }
  if (list) { list.addEventListener('scroll', () => fadeTabs(list), { passive: true }); fadeTabs(list); }
}
function fadeTabs(list) {
  const max = list.scrollWidth - list.clientWidth;
  const f = max <= 1 ? '' : list.scrollLeft <= 1 ? 'end' : list.scrollLeft >= max - 1 ? 'start' : 'both';
  if (f) list.dataset.fade = f; else delete list.dataset.fade;
}
window.addEventListener('resize', () => { const l = document.querySelector('#productTabs .ptabs-list'); if (l) fadeTabs(l); });
buildShell();

let stickyObserver = null;
let stickySizer = null;
let stickyScroll = null;
let dockSizer = null;
let railSizer = null;
let fitRails = () => {};
/* A viewport that changes height changes which rails fit, and a
   ResizeObserver on the rail itself never hears about it. */
window.addEventListener('resize', () => fitRails());
/* The topbar's real height, for scroll-padding-top and everything that sticks
   under it. --topbar-h is the design value; the measured one is what is
   actually stuck to the top of the viewport. Two bars since Release A, and at
   most one shows: the public header, or the app's slim bar below 1024px.
   With the sidebar beside the page nothing is stuck to the top at all, and
   the measure is 0 — a sticky strip, a rail or a jumped-to heading comes to
   rest at the edge instead of 60px under a bar that is not there. */
{
  const bars = [...document.querySelectorAll('.topbar')];
  const publish = () => document.documentElement.style.setProperty('--topbar-live',
    `${Math.round(Math.max(0, ...bars.map(b => b.getBoundingClientRect().height)))}px`);
  if (bars.length) { const ro = new ResizeObserver(publish); bars.forEach(b => ro.observe(b)); }
}
/* THE FIRST PAINT WAS A DIFFERENT PRODUCT
   ---------------------------------------------------------------------------
   Filings load asynchronously, and the first paint used to happen on the sample
   set — deliberately, and wrongly. For about a second on a cold load, production
   served Microsoft at a SYNTHETIC $452.10, under "Beta preview." rather than
   "mixed sources", with every strategy reading illus., over "Search 36
   companies". Then it became the SEC-filed report with no price at all.

   On a product whose central claim is that no filed company carries a price,
   showing a fabricated one for a second is not a loading artefact. A slow phone,
   a screenshot, a crawler, a print, an interrupted load — any of those captures
   the version that is not true, and it is the more reassuring of the two.

   So the universe-dependent views do not paint from the sample set while real
   data is in flight. They paint a skeleton that states what is happening. Views
   that need no company data are unaffected, because making somebody wait for
   SEC filings to read the privacy policy would be its own defect.

   If the fetch FAILS the sample set is painted, because a sample honestly
   labelled is better than an empty page — realStatus carries the failure and
   the disclosure says so. */
let realPending = false;
/* The landing page is deliberately absent. Its demo card defaults to a Malaysian
   company, which no SEC filing supersedes, so its figures do not change — the
   only difference the load makes there is that an Apple tab appears. Making a
   first-time visitor watch a skeleton on the front door to avoid a tab
   appearing would be a worse trade than the one it fixes. */
const UNIVERSE_VIEWS = new Set([
  'home', 'discover', 'research', 'researchHome', 'compare', 'portfolio',
  'watchlists', 'thesis', 'alerts', 'tracked', 'scanner', 'sarawak', 'plans',
  /* The Equities research queue is the dashboard's former body, drawn from
     the whole universe, so it waits for the filings as the dashboard did. */
  'researchQueue',
  /* Both name companies: the report is one, and the workspace lists saved
     items by company and says whether each one's data has moved. */
  'researchReport', 'workspace',
  /* Every scanner page: the worker's files are read in the same load as the
     filings, so before it ends a page would say "no run recorded" about a
     run log that is on its way — and a symbol links to its company only
     once the company is in. */
  ...SCANNER_VIEWS,
]);

function bootSkeleton() {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const card = el('div', { class: 'card' });
  card.append(el('p', { class: 'eyebrow' }, 'Loading filings'));
  card.append(el('h2', { class: 'h-card', style: 'margin-top:4px' }, 'Reading the audited statements'));
  /* Loading from this site, not from EDGAR. The statements were retrieved from
     SEC EDGAR when the dataset was built and ship in data/us.json; the page
     cannot reach sec.gov at all (the policy allows connections to this origin
     only), so "being fetched from SEC EDGAR" described a request that never
     happens and made a stored snapshot sound live. */
  card.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px;max-width:60ch' },
    'The US companies’ annual statements, retrieved from SEC EDGAR when this dataset was built, are loading from this site. This page waits for them '
    + 'rather than showing the illustrative sample first — a sample company and a filed one can share a '
    + 'ticker, and the sample carries a price the filed company does not have.'));
  const bars = el('div', { style: 'display:flex;flex-direction:column;gap:10px;margin-top:var(--lg)' });
  [72, 100, 88, 60].forEach(w => bars.append(el('div', {
    style: `height:12px;width:${w}%;border-radius:6px;background:var(--surface-sunk)` })));
  card.append(bars);
  wrap.append(card);
  return wrap;
}

function render() {
  buildNav();
  renderProductTabs();
  const node = (realPending && UNIVERSE_VIEWS.has(State.view))
    ? bootSkeleton()
    : (VIEWS[State.view] ? VIEWS[State.view]() : el('div', {}, 'Not found'));
  /* A surface the capability register marks feature-flagged says so on the
     page, from the register row itself (80-registers.js). Not on the
     skeleton: there is no surface yet to describe. */
  if (!(realPending && UNIVERSE_VIEWS.has(State.view))) mountFlagNotice(node, State.view, State.researchTab);
  const section = el('section', { class: 'view', data: { active: '1' } }, el('div', { class: 'shell' }, node));
  viewRoot.replaceChildren(section);
  /* Now, not only when headingWatch next runs, so anything that reads the
     page straight after a render reads the levels it states. */
  fitHeadingLevels(viewRoot);

  /* The dock is mounted at body level, not inside the view. A fixed element is
     positioned against the viewport only while no ancestor establishes a
     containing block, and any future transform, filter or `contain` on a view
     wrapper would silently turn it into an absolutely positioned box halfway
     down the page. Mounting it outside removes the possibility rather than
     relying on nobody adding one.

     Skipped while the universe is loading: a dock is a summary of the page
     below it, and there is no page below a skeleton yet. */
  document.querySelectorAll('.dock').forEach(n => n.remove());
  dockSizer?.disconnect();
  const dockSpec = (!realPending || !UNIVERSE_VIEWS.has(State.view)) ? DOCKS[State.view]?.() : null;
  if (dockSpec) {
    /* Still at body level, but BEFORE the footer rather than after it. Tab
       order follows the DOM, so appended last the dock's one action was the
       final stop on the page: 170 fields and every footer link came first on
       the property calculator. After main it is reached when the page is. */
    const dock = decisionDock(dockSpec);
    const footer = document.querySelector('body > .footer');
    footer ? footer.before(dock) : document.body.append(dock);
    viewRoot.dataset.dock = '1';
    /* THE DOCK COVERED THE FIELD BEING TYPED INTO. The browser scrolls a
       focused control only until it touches the bottom edge of the viewport,
       and the bottom 70-190px of the viewport is the dock. Tabbing down the
       property calculator landed 21 of its controls entirely underneath it at
       1440px and 50 at 375px — the reader typing into a field they could not
       see. scroll-padding-bottom moves the edge the browser scrolls to; its
       height is measured, because the dock wraps to two or three rows on a
       phone and the blocker line is clamped, not fixed. */
    const publish = () => document.documentElement.style.setProperty('--dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
    publish();
    dockSizer = new ResizeObserver(publish);
    dockSizer.observe(dock);
  } else {
    delete viewRoot.dataset.dock;
    document.documentElement.style.removeProperty('--dock-h');
  }
  /* The title is set by setDocumentMeta, which knows the route and the company
     on it. Setting it here as well overwrote that with a generic view label —
     so a company page announced itself as "Research" and every shared link
     previewed identically. */

  /* On the public page the disclosure is a single compact line. A four-line
     warning block above the headline buries the thing a first-time visitor
     came to read, and a warning nobody reaches is not a warning. Inside the
     app it stays in full, because there the sample data IS the context. */
  document.body.dataset.surface = State.view === 'marketing' ? 'public' : 'app';

  /* Reveal the compact ticker identity only once the full header is gone. */
  stickyObserver?.disconnect();
  stickySizer?.disconnect();
  if (stickyScroll) removeEventListener('scroll', stickyScroll);
  stickyScroll = null;
  document.documentElement.classList.remove('strip-stuck');
  const strip = $('.ticker-sticky', section);
  if (strip) {
    const sentinel = strip.previousElementSibling;
    if (sentinel) {
      /* Stuck means the sentinel has gone up past the top edge. Out of the
         region BELOW the viewport is not stuck: on a phone the strip starts a
         screen or two down, and read as stuck there it hid the topbar at the
         top of the page. The observer alone misses a jump straight from
         "past" to "not yet reached" (Home, a back-to-top link, restored
         scroll), since neither state intersects; the scroll check catches it. */
      /* Where the strip comes to rest, when that is below the 60px design
         height: from 781 to 1220px it sticks under a two-row, 101px topbar,
         and measured against 60px it read as not yet stuck for the 40px it
         was already stuck. At top:0 (a phone) the edge stays 68px, as it was. */
      const edgeNow = () => Math.max(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')),
        parseFloat(getComputedStyle(strip).top) || 0) + 8;
      const edge = edgeNow();
      /* Read at each check rather than once: the topbar's measured height
         (--topbar-live, which the strip's top follows) lands a frame after
         the first render. */
      const check = () => {
        const stuck = sentinel.isConnected && sentinel.getBoundingClientRect().bottom < edgeNow();
        strip.classList.toggle('is-stuck', stuck);
        /* The phone topbar steps aside while the strip is stuck (styles.css). */
        document.documentElement.classList.toggle('strip-stuck', stuck);
      };
      stickyObserver = new IntersectionObserver(check, { rootMargin: `-${edge}px 0px 0px 0px`, threshold: 0 });
      let queued = false;
      stickyScroll = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; check(); }); } };
      addEventListener('scroll', stickyScroll, { passive: true });
      stickyObserver.observe(sentinel);
    }
    /* How much vertical space is stuck to the top of the viewport, published
       as --sticky-h so scroll-margin-top can clear it. Observed rather than
       computed: the tab strip inside this element wraps to two rows below
       768px and could take three on a narrower phone, and the topbar is only
       part of the stack at some widths. */
    /* The strip's own `top` already says where it comes to rest, and adding
       the topbar height to it double-counts: below 780px the strip sticks at
       top:0 and sits OVER the topbar rather than under it, so summing the two
       overshot the jump by 180px on a phone — a third of the screen of blank
       space above the section the reader asked for. top + height is the
       stuck bottom edge in both arrangements. */
    const publish = () => {
      const top = parseFloat(getComputedStyle(strip).top) || 0;
      document.documentElement.style.setProperty('--sticky-h',
        `${Math.round(top + strip.getBoundingClientRect().height)}px`);
    };
    publish();
    stickySizer = new ResizeObserver(publish);
    stickySizer.observe(strip);
  } else {
    document.documentElement.style.removeProperty('--sticky-h');
  }

  /* A STICKY RAIL TALLER THAN THE VIEWPORT HID ITS OWN BOTTOM.
     A stuck box does not scroll with the page, so whatever of it hangs below
     the viewport stays there until the column beside it ends. The screener's
     filter rail is 972px against a 900px laptop screen, and the property
     calculator's deal form is several screens long: Tab walked focus onto
     "Advanced filters", "Save screen", "Export" and the comparable-evidence
     fields while every one of them sat below the fold, where no amount of
     scrolling the page could bring them. A rail that does not fit stops
     being sticky — the same behaviour it already has once the layout
     stacks — and one that fits keeps it. Measured, because opening a
     filter group or an evidence panel changes the answer. */
  railSizer?.disconnect();
  const rails = [...section.querySelectorAll('.rail-sticky')];
  fitRails = () => rails.forEach(rail => {
    const top = parseFloat(getComputedStyle(rail).top) || 0;
    rail.classList.toggle('rail-tall', rail.offsetHeight > window.innerHeight - top - 12);
  });
  if (rails.length) {
    fitRails();
    railSizer = new ResizeObserver(() => fitRails());
    rails.forEach(r => railSizer.observe(r));
  }
}

document.addEventListener('click', e => {
  /* Modified clicks are left to the browser, so open-in-new-tab and
     open-in-new-window keep working on every internal link. */
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  const link = e.target.closest('[data-path]');
  if (link) { e.preventDefault(); navigate(link.dataset.path); return; }
  const nav = e.target.closest('[data-nav]');
  if (nav) { e.preventDefault(); go(nav.dataset.nav); }
  const act = e.target.closest('[data-action="report-error"]');
  if (act) { e.preventDefault(); openReportError(); }
});

/* KEYBOARD NAVIGATION FOR A DENSE TABLE.
   ---------------------------------------------------------------------------
   The screener's metric cells were already focusable — each one carries
   tabindex, a role and a label, and Enter opens its source drawer. That made
   the table technically reachable and practically unusable: twelve columns by
   forty rows is close to five hundred tab stops between the filters above the
   table and the pagination below it. "Reachable" and "usable" are not the same
   claim and only the second one is worth making.

   So the table becomes a grid with ONE tab stop. Tab moves into it and out of
   it; arrows move between cells; Home and End go to the ends of a row and, with
   Ctrl, to the ends of the table. The cell that was last visited keeps the tab
   stop, so returning to the table returns to where the reader was.

   The company column is a row header rather than a cell, which is what makes a
   screen reader announce "Maybank, return on capital, 12.4%" instead of reading
   out a number with nothing attached to it. */
function gridKeyboard(table, label) {
  table.setAttribute('role', 'grid');
  if (label) table.setAttribute('aria-label', label);

  /* Read live rather than captured: sorting, filtering and the median rows all
     rebuild the body underneath this listener. */
  const grid = () => [...table.rows].map(r => [...r.cells]);
  grid().flat().forEach(c => { c.tabIndex = -1; });
  const first = grid()[0]?.[0];
  if (first) first.tabIndex = 0;

  const go = (r, c) => {
    const g = grid();
    if (!g.length) return;
    r = clamp(r, 0, g.length - 1);
    c = clamp(c, 0, (g[r] || []).length - 1);
    const cell = g[r]?.[c];
    if (!cell) return;
    g.flat().forEach(x => { x.tabIndex = -1; });
    cell.tabIndex = 0;
    cell.focus();
    /* A sticky header and two sticky median rows can hide the cell that just
       took focus, which looks exactly like focus having gone nowhere. */
    cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    /* And a sticky label column: scrollIntoView treats it as part of the
       viewport, so a cell stepped to from the right came to rest underneath
       it. The container is scrolled back by exactly the overlap. */
    const wrap = table.closest('.tablewrap');
    const pin = cell.parentElement?.querySelector('.pin');
    if (wrap && pin && pin !== cell) {
      const over = pin.getBoundingClientRect().right - cell.getBoundingClientRect().left;
      if (over > 0) wrap.scrollLeft -= over;
    }
  };

  table.addEventListener('keydown', (e) => {
    if (e.altKey || e.metaKey) return;
    const cell = e.target.closest && e.target.closest('td, th');
    if (!cell || !table.contains(cell)) return;
    const g = grid();
    const r = g.findIndex(row => row.includes(cell));
    if (r < 0) return;
    const c = g[r].indexOf(cell);
    let done = true;
    switch (e.key) {
      case 'ArrowRight': go(r, c + 1); break;
      case 'ArrowLeft':  go(r, c - 1); break;
      case 'ArrowDown':  go(r + 1, c); break;
      case 'ArrowUp':    go(r - 1, c); break;
      case 'Home':       go(e.ctrlKey ? 0 : r, 0); break;
      case 'End':        go(e.ctrlKey ? g.length - 1 : r, g[r].length - 1); break;
      case 'PageDown':   go(Math.min(r + 10, g.length - 1), c); break;
      case 'PageUp':     go(Math.max(r - 10, 0), c); break;
      default: done = false;
    }
    /* Enter and Space are deliberately NOT handled here — the sourced cells
       already bind them to open their own drawer, and intercepting them would
       take that away. */
    if (done) { e.preventDefault(); e.stopPropagation(); }
  });

  /* Clicking a cell moves the tab stop there too, so mouse and keyboard do not
     end up disagreeing about where the reader is. */
  table.addEventListener('focusin', (e) => {
    const cell = e.target.closest && e.target.closest('td, th');
    if (!cell || !table.contains(cell)) return;
    grid().flat().forEach(x => { if (x !== cell) x.tabIndex = -1; });
    cell.tabIndex = 0;
  });
}
