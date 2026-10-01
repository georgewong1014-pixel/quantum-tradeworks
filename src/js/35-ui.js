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
/* BOTH HALVES OF THE LABEL (Release B, E2 — the daily audit's #8). Every
   figure's company is labelled SEC-filed or illustrative where the figure
   appears. illusChip marks only the synthetic half, so in the screener, a
   peer table, a metric's distribution, a comparison and the portfolio a
   filed company was known by a missing word — which also reads as a marker
   cut off or never drawn. dataChip and dataText say which, the personal
   lane's statements included; a chart mark's name carries dataTag. The
   one-sided pair stays where only the synthetic needs saying. */
const FILED_TITLE = 'SEC-filed — figures from the audited statements the company filed with the SEC (EDGAR companyfacts), not adjusted.';
const PERSONAL_TITLE = 'Personal research — figures from annual statements you supplied on this machine: not an SEC filing, and not redistributable.';
const dataTag = (c) => (!c ? '' : !c.real ? 'illustrative' : c.personal ? 'personal research' : 'SEC-filed');
const dataChip = (c) => (!c ? null : !c.real ? illusChip(c)
  : el('span', { class: 'filed-mark', title: c.personal ? PERSONAL_TITLE : FILED_TITLE }, dataTag(c)));
const dataText = (c) => (c ? ` · ${dataTag(c)}` : '');

function tickerCell(row) {
  /* Filed and illustrative companies sit in the same screener, heatmap and
     comparison rows. The company page says which is which; these rows did
     not, so a synthetic Bursa company and an audited US filer were
     indistinguishable in the one place they are ranked side by side. The
     marker sits on the ticker line, which does not truncate. */
  const b = el('button', { class: 'tickerbtn', onclick: () => openResearch(row.c.id),
    title: row.c.real ? undefined : ILLUS_TITLE });
  b.append(el('span', { class: 'tk' }, [row.c.tk, dataChip(row.c)]));
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

/* heading: false draws the title as text, for a toolbar above a page's own
   h1 — the report's and the decision record's — which as an h3 was the
   first heading in main, ahead of the h1. */
function cardHead(title, subtitle, right, { heading = true } = {}) {
  const h = el('div', { class: 'card-hd' });
  const l = el('div');
  l.append(el(heading ? 'h3' : 'p', { class: 'h-card' }, title));
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

/* Marked (data-empty), so a check finds every empty state a page shows. */
function emptyState(text) {
  return el('div', { class: 'emptystate', 'data-empty': '', html: `${icon('search', 30)}<p>${esc(text)}</p>` });
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
  /* A box in the body that scrolls and holds nothing to focus is a named
     Tab stop from the moment the drawer opens (fitScrollStops). */
  fitScrollStops(drawerBody);
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

   Nothing was removed to get here. The Screener (the Value map one of its
   own tabs), Sarawak Economy Watch and the Cash Wheel are tabs of Equities
   Research (PRODUCT_TABS); the Trading Index is a tab of the Scanner's
   row; every address that opened a
   page before still opens it. docs/route-map.md is the whole map.
   ========================================================================== */

/* THE FOUR PRODUCTS. The one list the header, the sidebar, the footer, the
   homepage and How it works read, so a product's name, its status and the
   sentence qualifying that status cannot differ between two of them. Each
   status was checked against what the code does, not what the brief hoped:

   - Equities is Beta. The filed US companies are audited SEC filings
     (data/us.json); the Malaysian ones, and one US listing (PGR), are the
     illustrative set (10-dataset.js) — as the disclosure strip, the Terms and
     every company page say; no market-data licence is held for either
     exchange, so a filed company carries no price. The note said every US
     company was filed, which the strip on the same page contradicted.
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
    /* The action is worded as the goal it starts (audit 1, #3): the
       homepage card, How it works and the dashboard checklist all read it
       from here, so the three say the same words. */
    question: 'How is this company performing financially?', action: 'Start research', actionPath: '/research',
    status: 'beta', statusNote: 'Filed US companies from their audited SEC filings; the Malaysian companies, and any US listing marked illustrative, carry illustrative figures; no licensed prices for either market.' },
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
/* "Reports" sits in My Workspace, after Saved Models, now that the list of
   reports exists (/my/reports, 58-reports.js): what the reader's own work can
   print, each opening the real report. It was kept out while a report was
   printed only from its own page and nothing listed them, when an item would
   have opened a list that was not there. */
const SHOW_REPORTS = true;
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
/* THE NOTE, FOR EVERYONE. A badge's qualifying sentence was only its
   `title`: a mouse's tooltip, never reached by a keyboard, a finger or a
   screen reader — the Scanner's "this site ships no prices, so here it has
   nothing to scan" was hover-only. A link that wears a badge carries the
   note as its description (the name stays short: "Quantum Scanner, Beta"),
   and the menus link to the page that prints every note. */
const productNote = (id) => { const p = productById(id); return p ? `${PRODUCT_STATUS[p.status] || p.status}: ${p.statusNote}` : null; };
/* The product a view belongs to, or null — the dashboard, the personal pages
   and the public pages belong to none. Read from SECTION_OF (below), the one
   table that says where every view sits. */
function productOf(view) {
  const s = SECTION_OF[view] || toolProductOf(view);
  return PRODUCTS.some(p => p.id === s) ? s : null;
}
/* A view the table does not list, but a product's tool opens — a tool whose
   route another branch adds, such as My properties — belongs to that
   product: its tab row and its sidebar item follow it without a second
   entry to keep in step. */
function toolProductOf(view) {
  if (typeof TOOLS === 'undefined' || !view) return null;
  return TOOLS.find(t => t.product && toolViews(t).includes(view))?.product || null;
}

/* ==========================================================================
   THE TOOLS, ONE REGISTRY (audit 1, #2)

   PRODUCTS says what each product is. It said nothing about the tools inside
   one, so a product's badge was the only status anywhere: the Scanner's Alerts
   tab was a link on the hosted site, where the worker's record can never be,
   and led to a page that explained it was empty; the Screener stayed a link
   with the filings failed to load. Every tool the site offers is here — each
   product tab, the Scanner's sections, each workspace surface — with its
   product, its address, its status, one sentence true to the code, and its
   primary action. Tabs, section strips, the sidebar, the dashboard and How it
   works read their badges from it; no page writes a tool's status by hand.

   WRITTEN AND DERIVED. live, beta, demo and soon are written, checked against
   what the code does. delayed and unavailable are never written: they are
   read from what actually loaded (toolState) —
   - filings: data/us.json did not load → every tool that reads the filed set
     is Unavailable, with the load's own error; its `generated` stamp more than
     a year old → Delayed, because a company's annual filing since is not in it.
   - history: data/price-history.json is not here → the tools that run on it
     are Unavailable (the hosted site never has it); its newest bar more than
     four calendar days old → Delayed, the four-day rule the scanner's own
     status uses (scanStatus, 24-market-engine.js).
   - alerts: data/scan-alerts.json is not here → the worker's record cannot be
     read, so the tool that reads it is Unavailable.
   A file opened from disk on the Scanner's dashboard counts as loaded, so a
   tool comes back the moment it has what it needs.

   A TOOL THAT CANNOT BE USED IS NOT OFFERED. A tool whose state is soon or
   unavailable is text, never a link or a button — and that is enforced in one
   place, gateToolLink below, which every link on the page passes through
   whoever drew it (render, and a watch on the page for what a view draws by
   itself). Its own page still opens at its address, and says why.

   A tool that is not in this build — a route another branch adds — is not
   listed anywhere until its route and view exist (toolPresent).
   ========================================================================== */
const TOOL_STATUS = { ...PRODUCT_STATUS, delayed: 'Delayed', unavailable: 'Unavailable' };
/* The states a tab, a sidebar item or a dashboard row marks. Live and Beta
   are the product's own badge, said once beside its name; a tab wears a badge
   only when it differs in kind — illustrative only, late, not usable here. */
const TOOL_FLAGGED = new Set(['demo', 'soon', 'delayed', 'unavailable']);
const TOOL_OFF = new Set(['soon', 'unavailable']);
const TOOLS = [
  /* Equities Research */
  { id: 'overview', product: 'equities', label: 'Overview', path: '/research', views: ['researchHome'], tab: true,
    status: 'beta', statusNote: 'Find a company by name, ticker, listing code or CIK — the filed US companies and the illustrative Malaysian set, each labelled which.',
    action: { label: 'Start research', path: '/research' } },
  { id: 'screener', product: 'equities', label: 'Screener', path: '/discover/screener', views: ['discover'], tab: true, needs: ['filings'],
    status: 'beta', statusNote: 'Screens the companies loaded here on quality, financial strength and valuation, every filter and measure explained; a measure that needs a price is blank where none is held.',
    action: { label: 'Screen companies', path: '/discover/screener' } },
  { id: 'valuemap', product: 'equities', label: 'Value map', path: '/discover/value-map', views: ['discover'], routeTab: 'radar', needs: ['filings'],
    status: 'beta', statusNote: 'Places each company by quality against modelled value, which needs a price: no licensed price is held, so it places the illustrative set on sample prices and any company whose close you supplied.',
    action: { label: 'Open the value map', path: '/discover/value-map' } },
  { id: 'compare', product: 'equities', label: 'Compare', path: '/compare', views: ['compare'], tab: true, needs: ['filings'],
    status: 'beta', statusNote: 'Companies side by side on the measures that fit each business model, every period, basis and absent cell stated; period-end months cannot be aligned yet.',
    action: { label: 'Compare companies', path: '/compare' } },
  { id: 'queue', product: 'equities', label: 'Research queue', path: '/research/queue', views: ['researchQueue'], tab: true, needs: ['filings'],
    status: 'beta', statusNote: 'What changed in the reported figures, your watchlist first, with the data’s freshness — each company labelled filed or illustrative, nothing recommended.',
    action: { label: 'Open the research queue', path: '/research/queue' } },
  { id: 'sarawak', product: 'equities', label: 'Sarawak watch', path: '/discover/sarawak', views: ['sarawak'], tab: true,
    status: 'beta', statusNote: 'Names the Bursa companies that operate in Sarawak; no statements are held for them, and each one’s exposure stays empty until you record it.',
    action: { label: 'Open Sarawak watch', path: '/discover/sarawak' } },
  { id: 'wheel', product: 'equities', label: 'Cash Wheel', path: '/us-options/wheel', views: ['wheel'], tab: true,
    status: 'live', statusNote: 'A cash-secured put and covered call cycle modelled from a contract you enter; no option-chain data is connected.',
    action: { label: 'Model a wheel', path: '/us-options/wheel' } },
  /* Property Intelligence. "My properties" is the store of saved property
     models; its route arrives with that work, and until then it is listed
     nowhere (toolPresent). */
  { id: 'models', product: 'property', label: 'My properties', path: '/property/models', tab: true,
    status: 'live', statusNote: 'The properties you have saved in this browser, each with its scenarios; open one to edit it in the calculator.',
    action: { label: 'Open my properties', path: '/property/models' } },
  { id: 'calculator', product: 'property', label: 'Calculator', path: '/property/calculator', views: ['property'], tab: true,
    status: 'live', statusNote: 'Monthly cash flow, yield, break-even rent and cash required, computed from the figures you enter; it starts on illustrative defaults and marks each one until you replace it.',
    action: { label: 'Analyse a property', path: '/property/calculator' } },
  { id: 'areas', product: 'property', label: 'Area screen', path: '/property/areas', views: ['areas'], tab: true,
    status: 'live', statusNote: 'The localities of one town, shaded by what you have recorded about them; an area with no record is drawn hollow.',
    action: { label: 'Screen a town', path: '/property/areas' } },
  { id: 'comparables', product: 'property', label: 'Comparables', path: '/property/comparables', views: ['comparables'], tab: true,
    status: 'live', statusNote: 'Sarawak transacted prices and achieved rents you record, each with what it rests on.',
    action: { label: 'Record a comparable', path: '/property/comparables' } },
  { id: 'opportunities', product: 'property', label: 'Opportunities', path: '/property/opportunities', views: ['opportunities'], tab: true,
    status: 'live', statusNote: 'Real properties you record, each with what is known about it and what is not, never ordered by merit.',
    action: { label: 'Record a property', path: '/property/opportunities' } },
  /* Quantum Scanner — its sections, each a tab of the Scanner's row as the
     other two products' tools are (Release B, B5): its own strip, drawn
     inside every scanner page from a table of its own, is gone. In the order
     that strip had them, the Trading Index last (Release A); the Market
     says, as the strip did, that it screens the reader's own series, not the
     market. */
  { id: 'scanDash', product: 'scanner', label: 'Dashboard', path: '/app/scanner', views: ['scannerDashboard', 'scanner'], tab: true,
    status: 'beta', statusNote: 'Whether your setups are active, when the last scan succeeded and what matched, read from the worker’s records on your own computer — or from files you open here.',
    action: { label: 'Open the scanner', path: '/app/scanner' } },
  { id: 'market', product: 'scanner', label: 'Market (your series)', path: '/app/scanner/market', views: ['scannerMarket'], needs: ['history'], tab: true,
    status: 'beta', statusNote: 'Runs one of your setups over the instruments with a series in your own price history, in symbol order, recorded nowhere.',
    action: { label: 'Screen your series', path: '/app/scanner/market' } },
  { id: 'setups', product: 'scanner', label: 'Setups', path: '/app/scanner/setups', views: ['scannerSetups', 'scannerSetupNew', 'scannerSetup', 'scannerSetupEdit'], tab: true,
    status: 'beta', statusNote: 'Your own conditions, every version kept in this browser; the worker on your computer runs them once exported, and evaluating one here needs your price history.',
    action: { label: 'Create a setup', path: '/app/scanner/setups/new' } },
  { id: 'scanWatchlists', product: 'scanner', label: 'Watchlist scanner', path: '/app/scanner/watchlists', views: ['scannerWatchlists'], tab: true,
    status: 'beta', statusNote: 'Your watchlists as the universe a setup checks, exported to the file the worker reads.',
    action: { label: 'Scan a watchlist', path: '/app/scanner/watchlists' } },
  { id: 'scanAlerts', product: 'scanner', label: 'Alerts', path: '/app/scanner/alerts', views: ['scannerAlerts', 'scannerAlert'], needs: ['alerts'], ages: ['history'], tab: true,
    status: 'beta', statusNote: 'The worker’s record of the bars on which your setups held, read here; nothing is sent.',
    action: { label: 'Review your matches', path: '/app/scanner/alerts' } },
  { id: 'backtest', product: 'scanner', label: 'Historical', path: '/app/scanner/backtest', views: ['scannerBacktest'], needs: ['history'], tab: true,
    status: 'beta', statusNote: 'A simulation of the dates on which a setup’s conditions held in your own history — no returns, no performance.',
    action: { label: 'Simulate a setup', path: '/app/scanner/backtest' } },
  { id: 'scanSettings', product: 'scanner', label: 'Settings', path: '/app/scanner/settings', views: ['scannerSettings'], tab: true,
    status: 'live', statusNote: 'How values are shown and which matches count as unread, kept in this browser; the app is the only delivery channel.',
    action: { label: 'Open scanner settings', path: '/app/scanner/settings' } },
  { id: 'trading', product: 'scanner', label: 'Trading Index', path: '/research/trading-index', views: ['tradingIndex'], tab: true,
    status: 'live', statusNote: 'A multi-timeframe trend reading and a test of your own first-tranche rules, from chart evidence you record yourself.',
    action: { label: 'Assess a trend', path: '/research/trading-index' } },
  /* The workspace — the reader's own, in this browser. */
  { id: 'dashboard', product: null, label: 'My Dashboard', path: '/app', views: ['home'],
    status: 'live', statusNote: 'What changed since your last visit, your setups’ matches where the scanner’s record is here, and what you have saved — read from this browser.',
    action: { label: 'Open my dashboard', path: '/app' } },
  { id: 'watchlists', product: null, label: 'Watchlists', path: '/my/watchlists', views: ['watchlists'],
    status: 'live', statusNote: 'Lists of companies you follow, kept in this browser; each can be the universe a scanner setup checks.',
    action: { label: 'Create a watchlist', path: '/my/watchlists' } },
  { id: 'myAlerts', product: null, label: 'My Alerts', path: '/my/alerts', views: ['alerts'],
    status: 'live', statusNote: 'Both kinds, each labelled: the facts that changed in the research you follow, with their source period, and your price thresholds; and your scanner setups’ matches where the scanner’s record is here. Nothing leaves this browser.',
    action: { label: 'Review your alerts', path: '/my/alerts' } },
  { id: 'saved', product: null, label: 'Saved Models', path: '/my/workspace', views: ['workspace'],
    status: 'beta', statusNote: 'Everything you have saved, with the model and data version it was saved against; in this browser only — no account, so nothing follows you to another device.',
    action: { label: 'Open your saved work', path: '/my/workspace' } },
  { id: 'reports', product: null, label: 'Reports', path: '/my/reports', views: ['reports'],
    status: 'live', statusNote: 'The reports your own work here can print — a company’s research report, a saved property’s investor report and decision record, the Cash Wheel’s and the Trading Index’s records — each saved as PDF through your browser’s print.',
    action: { label: 'Open your reports', path: '/my/reports' } },
  { id: 'portfolio', product: null, label: 'Portfolio', path: '/my/portfolio', views: ['portfolio'],
    status: 'live', statusNote: 'Holdings kept in this browser, with business performance separated from currency movement.',
    action: { label: 'Open your portfolio', path: '/my/portfolio' } },
  { id: 'theses', product: null, label: 'Investment cases', path: '/my/theses', views: ['thesis'],
    status: 'live', statusNote: 'What you believe about a company and what would prove you wrong, checked against the latest data held.',
    action: { label: 'Write an investment case', path: '/my/theses' } },
  { id: 'tracked', product: null, label: 'Tracked', path: '/my/tracked', views: ['tracked'],
    status: 'beta', statusNote: 'Instruments followed by price and trend only, from closes you supply — this site ships none.',
    action: { label: 'Open tracked instruments', path: '/my/tracked' } },
  { id: 'userdata', product: null, label: 'Your data', path: '/my/data', views: ['userdata'],
    status: 'live', statusNote: 'Prices you paste, kept in this browser, and the export that carries everything you saved.',
    action: { label: 'Open your data', path: '/my/data' } },
];
const toolById = (id) => TOOLS.find(t => t.id === id) || null;
/* The views a tool is, as written, or else the view its route opens. */
const toolViews = (t) => t.views || [matchRoute(t.path)?.view].filter(Boolean);
/* In this build: its route resolves to a view that exists. */
const toolPresent = (t) => { const rt = t ? matchRoute(t.path) : null; return !!rt && typeof VIEWS[rt.view] === 'function'; };

/* The clock the derived states are judged by; a check pins it. */
let toolClock = null;
const toolNow = () => new Date(toolClock || (typeof scanOpsClock !== 'undefined' && scanOpsClock) || Date.now());
/* A filed set is annual statements: a year after it was built, a company's
   next annual report has been filed and is not in it. */
const FILINGS_STALE_DAYS = 365;
/* The scanner's own rule (scanStatus): no exchange calendar is held, so more
   than four calendar days — a weekend and a day — since the newest bar is
   behind. */
const HISTORY_BEHIND_DAYS = 4;
const toolDay = (t) => String(t || '').slice(0, 10);
/* The newest bar of a price history, read once per history. It was read
   afresh for every link to a tool that runs on the history, and
   scanOpsHistoryMeta walks every bar of every series — about 40ms for 200
   series of ten years — so a scanner page with fifty links to its alerts
   took 2.9s to draw instead of 0.45s, on the owner's own machine, the one
   place a history is held. A history is replaced, never edited, when it
   changes (loaded, opened from disk, its splits attached), so the object
   itself is the key. */
let toolHistoryRead = null;
function toolNewestBar(h) {
  if (!toolHistoryRead || toolHistoryRead.h !== h)
    toolHistoryRead = { h, bar: typeof scanOpsHistoryMeta === 'function' ? scanOpsHistoryMeta(h)?.newestBar ?? null : null };
  return toolHistoryRead.bar;
}

/* What one source's state does to the tools that read it: null when nothing
   is wrong with it or nothing is known yet (a load still on its way is not a
   failure), else { state, why }. Every name read here is guarded — a source's
   module may load after this one, or be absent from a build. */
function toolSource(name) {
  const now = toolNow();
  const filingsOn = typeof realEnabled === 'function' && realEnabled();
  const status = typeof realStatus !== 'undefined' ? realStatus : null;
  if (name === 'filings') {
    if (!filingsOn || !status) return null;
    if (!status.ok) return { state: 'unavailable', why: `The filed statements did not load (${status.error || 'no reason given'}), so only the illustrative companies are here.` };
    const g = Date.parse(status.generated || '');
    const days = Number.isFinite(g) ? Math.floor((now.getTime() - g) / 864e5) : null;
    if (days != null && days > FILINGS_STALE_DAYS) return { state: 'delayed',
      why: `The filed statements were retrieved from SEC EDGAR on ${toolDay(status.generated)}, ${days} days ago, so an annual report filed since then is not in them.` };
    return null;
  }
  /* The scanner's files. One that is here — loaded, or opened from disk on
     the Scanner's dashboard — is judged by what it holds, however it came.
     One that is not is absent only once the load has looked for it: the
     scanner's files are read in the same load as the filings, and only where
     the page is served from the owner's machine (25-universe.js). */
  const absent = (why) => {
    const read = typeof scanOpsRead !== 'undefined' && scanOpsRead;
    if (read) return { state: 'unavailable', why };
    if (filingsOn && !status) return null;
    return { state: 'unavailable', why: !filingsOn
      ? 'The scanner’s files are read with the filed statements, and those are switched off in this tab.'
      : 'The data load stopped before the scanner’s files were read.' };
  };
  if (name === 'history') {
    const h = typeof scanOpsHistory === 'function' ? scanOpsHistory() : null;
    if (!h?.series || !Object.keys(h.series).length) return absent('No price history is loaded here. The scanner reads data/price-history.json, which is built on your own computer and never deployed; open yours on the Scanner’s dashboard to use it in this tab.');
    const newest = toolNewestBar(h);
    const age = newest && typeof scanDayDiff === 'function' ? scanDayDiff(newest, now.toISOString().slice(0, 10)) : null;
    if (age > HISTORY_BEHIND_DAYS) return { state: 'delayed',
      why: `Your price history’s newest bar is ${newest}, ${age} days old — more than four calendar days (a weekend and a day), the rule the scanner’s own status uses.` };
    return null;
  }
  if (name === 'alerts') {
    const d = typeof scanOpsAlertsDoc === 'function' ? scanOpsAlertsDoc() : null;
    if (!d) return absent('No record of matches is loaded here. The worker writes data/scan-alerts.json on the computer it runs on, and it is never deployed; open yours on the Scanner’s dashboard to read it in this tab.');
    return null;
  }
  return null;
}

/* A tool's state now: its written status, or the worst its sources derive —
   unavailable before delayed. `actionable` is the one question every link to
   it asks. */
function toolState(idOrTool) {
  const t = typeof idOrTool === 'string' ? toolById(idOrTool) : idOrTool;
  if (!t) return null;
  const derived = [...(t.needs || []).map(toolSource), ...(t.ages || []).map(s => { const x = toolSource(s); return x?.state === 'delayed' ? x : null; })]
    .filter(Boolean).sort((a, b) => (a.state === 'unavailable' ? -1 : 0) - (b.state === 'unavailable' ? -1 : 0))[0] || null;
  const status = derived ? derived.state : t.status;
  return { id: t.id, tool: t, status, written: t.status, derived: !!derived,
    label: TOOL_STATUS[status] || status, note: derived ? derived.why : t.statusNote,
    present: toolPresent(t), actionable: !TOOL_OFF.has(status) };
}
/* The badge a tool wears, as productBadge draws a product's: an element with
   its note as the title, and its own markup in a template string. */
function toolBadge(idOrTool) {
  const s = toolState(idOrTool);
  if (!s) return null;
  const b = el('span', { class: `status-badge status-${s.status}`, title: s.note }, s.label);
  b.toString = () => b.outerHTML;
  return b;
}
/* The badge only where the state is worth marking (TOOL_FLAGGED). */
const toolFlag = (idOrTool) => { const s = toolState(idOrTool); return s && TOOL_FLAGGED.has(s.status) ? toolBadge(s.tool) : null; };
const toolNote = (idOrTool) => { const s = toolState(idOrTool); return s ? `${s.label}: ${s.note}` : null; };

/* The tool an address opens: by the route's view, and where two tools share
   a view (the screener and its value map), by the route's tab. */
function toolForPath(path) {
  const rt = matchRoute(String(path || '').split(/[?#]/)[0]);
  if (!rt) return null;
  const hits = TOOLS.filter(t => toolViews(t).includes(rt.view));
  if (hits.length < 2) return hits[0] || null;
  return hits.find(t => t.routeTab && t.routeTab === rt.tab) || hits.find(t => !t.routeTab) || hits[0];
}
/* The tool on screen, by the view and — on the screener's page — its tab. */
function toolForView(view = State.view) {
  const hits = TOOLS.filter(t => toolViews(t).includes(view));
  if (hits.length < 2) return hits[0] || null;
  const tab = view === 'discover' ? State.discoverTab : null;
  return hits.find(t => t.routeTab && t.routeTab === tab) || hits.find(t => !t.routeTab) || hits[0];
}

/* THE ONE PLACE A TOOL THAT CANNOT BE USED STOPS BEING OFFERED. A link to a
   tool whose state is soon or unavailable becomes text: its words, the
   tool's badge and why, and nothing to press. Every class but the button's is
   kept, so a tab still sits in its row and a tile in its grid. Links to
   anything else — another origin, a download, a place on the page — are
   left alone.
   A BUTTON THAT OPENS A TOOL SAYS WHICH. The gate saw only links, so with
   the filings failed to load the research home's collection cards, the
   research queue's "Quality vs Value Map" (its primary button), a company's
   "Open full comparison", "New thesis from a screen", the start page's
   "Open the stock screener" and a saved screen's Open — the dashboard's
   "Continue" among them — still sent the reader to the Unavailable screener
   or comparison. A control that opens a tool by script names the tool's
   address in data-tool-path, and passes through this same gate: where the
   tool cannot be used it becomes text as a link does, and a card keeps its
   place in its grid (its own tag, without the role and the Tab stop). */
function toolOfLink(a) {
  const h = a.getAttribute('data-tool-path') || a.getAttribute('data-path') || a.getAttribute('href');
  if (!h || h.startsWith('#') || a.hasAttribute('download') || /^[a-z]+:/i.test(h) && !/^https?:/i.test(h)) return null;
  let u;
  try { u = new URL(h, location.href); } catch { return null; }
  if (u.origin !== location.origin) return null;
  return toolForPath(u.pathname);
}
function gateToolLink(a) {
  const t = toolOfLink(a);
  if (!t) return a;
  const s = toolState(t);
  if (s.actionable) return a;
  const off = el(/^(A|BUTTON)$/.test(a.tagName) ? 'span' : a.tagName.toLowerCase(), { class: [...a.classList].filter(c => !/^btn/.test(c)).concat('tool-off', a.tagName === 'BUTTON' ? 'tool-off-btn' : []).join(' '),
    'data-tool': t.id, 'data-tool-state': s.status, title: s.note });
  if (a.id) off.id = a.id;
  /* A control drawn with its layout inline keeps it — but not a pointer. */
  if (a.getAttribute('style')) { off.setAttribute('style', a.getAttribute('style')); off.style.cursor = 'default'; }
  if (a.getAttribute('aria-current')) off.setAttribute('aria-current', a.getAttribute('aria-current'));
  off.append(...a.childNodes);
  if (!off.querySelector('.status-badge')) off.append(' ', toolBadge(t));
  off.append(el('span', { class: 'sr-only' }, ` — ${s.note}`));
  a.replaceWith(off);
  return off;
}
function gateToolLinks(root) {
  if (!root || root.nodeType !== 1) return;
  const sel = 'a[href], [data-tool-path]';
  const links = root.matches(sel) ? [root] : [...root.querySelectorAll(sel)];
  links.forEach(gateToolLink);
}
/* A link to a tool, for the pages that draw one by name: the same anchor
   every in-app link is, through the same gate. */
function toolLink(path, attrs = {}, ...kids) {
  const a = el('a', { href: href(path), ...attrs, onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault(); navigate(path);
  } }, ...kids);
  return a.isConnected ? gateToolLink(a) : gateDetached(a);
}
/* Not yet on the page: gated in a holder, so the caller gets what will stand. */
function gateDetached(a) {
  const holder = document.createElement('div');
  holder.append(a);
  const out = gateToolLink(a);
  out.remove();
  return out;
}

/* The page of a tool that is delayed or unavailable says so, under its
   heading, as a feature-flagged surface does (mountFlagNotice): it still
   opens at its address, and whatever it can show, it shows. */
function mountToolNotice(node) {
  const t = toolForView();
  const s = t ? toolState(t) : null;
  if (!s || !s.derived || !node?.children) return null;
  const notice = el('div', { class: `tool-notice tool-notice-${s.status}`, role: 'note', 'aria-label': `${t.label}: ${s.label.toLowerCase()}` }, [
    el('p', { class: 'tool-notice-hd' }, [toolBadge(t), el('strong', {}, s.status === 'unavailable' ? `${t.label} cannot work here.` : `${t.label} is working on data older than it should be.`)]),
    el('p', {}, s.note),
  ]);
  /* After the part of the page that holds its heading — a .page-hd, or the
     screener's own header with its strip — else at the top. */
  let hd = node.querySelector('h1');
  while (hd && hd.parentElement !== node) hd = hd.parentElement;
  if (hd) hd.after(notice); else node.prepend(notice);
  return s;
}

/* A product's row of tabs, from the registry: its tools marked as tabs that
   are in this build, in the registry's order. */
const productTabs = (pid) => TOOLS.filter(t => t.product === pid && t.tab && toolPresent(t))
  .map(t => ({ id: t.id, label: t.label, path: t.path, views: toolViews(t), tool: t }));

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
  ...(SHOW_REPORTS ? [{ id: 'reports', label: 'Reports', icon: 'doc', path: '/my/reports' }] : []),
];
const APP_NAV_FOOT = [
  { id: 'userdata', label: 'Your data & settings', icon: 'database', path: '/my/data' },
  { id: 'plans',    label: 'Plans',                icon: 'tag',      path: '/pricing' },
];
const PRODUCT_ICON = { equities: 'chart', scanner: 'target', property: 'home', business: 'briefcase' };

/* ONE ROW OF TABS PER PRODUCT, above the product's pages. The tools the
   brief does not name are here rather than gone: the Screener (and the
   Value map inside it), Sarawak Economy Watch and the Cash Wheel are
   Equities pages. A tab is current for the views it lists.

   One row of navigation per level. The screener's page draws its own strip
   — Stock Screener, Quality vs Value Map, Screening Strategies, Heatmap —
   and a "Value map" product tab above it said the same thing twice, one row
   over the other, with the Screener tab lit on two of that strip's four
   tabs and dark on the others. So the product row carries one "Screener"
   tab, current on every tab of that page, and the page's strip is the
   screener's own sub-tabs: the Value map is still one click away, in the
   row that holds it. The Scanner's row is its sections, the Trading Index
   among them (Release B): it drew them as a strip of its own inside each of
   its pages, and now wears the row the other two products wear.

   Property has no Overview tab. /property and /property/calculator are one
   view — the calculator, whose canonical address is /property — so an
   "Overview" beside "Calculator" would be two names for the same page, the
   second one promising a summary that does not exist. The row gains it when
   a Property overview is built (docs/route-map.md). */
/* Read from the registry (TOOLS, above): the tools of the product marked as
   tabs and in this build, in the registry's order — so a tab's name, its
   address and its badge cannot differ from How it works or the dashboard,
   and a tool another branch adds takes its place in the row when its route
   exists. All three built products; the workspace's row is its own
   (workspaceTabs, 36-layouts.js). */
const PRODUCT_TABS = Object.defineProperties({}, {
  equities: { enumerable: true, get: () => productTabs('equities') },
  scanner:  { enumerable: true, get: () => productTabs('scanner') },
  property: { enumerable: true, get: () => productTabs('property') },
});
/* The company page and its report belong to Equities but keep their own
   tabs; a second row above them would be two strips of tabs on one page. */
const NO_PRODUCT_TABS = new Set(['research', 'researchReport']);
/* The personal pages' own row (SUBNAV_MY) is gone: they wear My workspace's
   header, its tabs the workspace's tools in the registry (workspaceTabs,
   36-layouts.js; Release B, B5). */

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
/* The same for links to tools: a view that draws part of itself later, and a
   drawer, pass what they add through the one gate (gateToolLink), so a tool
   that cannot be used here is text wherever a page offered it. Replacing a
   link adds a node without one, so this never calls itself again. */
const toolLinkWatch = new MutationObserver((recs) => recs.forEach(r => r.addedNodes.forEach(n => gateToolLinks(n))));
toolLinkWatch.observe(viewRoot, { childList: true, subtree: true });
toolLinkWatch.observe(drawerBody, { childList: true, subtree: true });

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
  /* Release B: every report the reader's own work can print (58-reports.js). */
  { path: '/my/reports',          view: 'reports',   title: 'Reports' },
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
  { path: '/property/models',     view: 'propertyModels', title: 'My properties' },
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
  howItWorks: 'How each product works — what you put in, what it works out, what you can save and what to do next — what Live, Beta, Demo and Coming soon mean, and worked examples computed by the products’ own models.',
  researchQueue: 'The Equities research queue: market context, data freshness, what changed in the reported data, your watchlist and the largest gaps between price and model estimate — each company labelled filed or illustrative, with nothing recommended.',
  discover:  'Screen Bursa Malaysia and US companies on quality, financial strength and valuation — every filter and every metric explained.',
  research:  'A company report where every number shows its formula, its period and its source.',
  researchHome: 'A way into the universe by company, market or business model — never a company chosen for you.',
  sarawak: 'Companies with material exposure to the Sarawak economy. Inclusion is descriptive and does not indicate preference.',
  compare:   'Compare companies using the measures that fit their business model, not a single generic table.',
  property:  'Model a Malaysian property purchase to its real monthly cash flow, break-even rent and cash required upfront.',
  propertyModels: 'The properties you have saved in this browser, each with its inputs and its scenarios. Open one and the calculator edits it.',
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
  plans:     'Proposed plans and prices for Quantum Tradeworks research and property reports — not on sale yet: nothing can be bought and no payment is taken.',
  /* Every other view fell back to the marketing sentence above, so a shared
     link to the privacy policy or a watchlist previewed as the landing page.
     Each says what the page is, and claims nothing it does not do. */
  home:        'Your dashboard: your setups’ matches since your last visit where the scanner’s record is on this machine, what you monitor and what you have saved — read from this browser and the scanner’s own record.',
  onboarding:  'Four questions that set your preferences — how much is explained, which market the screener starts on, which currency totals are shown in — and where you start.',
  launcher:    'Start with your goal: pick one of the five things this product does and it opens the right tool.',
  portfolio:   'Holdings kept in this browser, with business performance separated from currency movement.',
  watchlists:  'Lists of companies you follow, each one usable as the scanner’s universe. Adding one implies no view on it.',
  thesis:      'What you believe about a company and what would prove you wrong, checked against the latest data.',
  alerts:      'Your alerts, each labelled by kind: the facts that changed in the research you follow, with their source period, and your scanner setups’ recorded matches. Nothing is sent outside this browser.',
  reports:     'Every report your own work in this browser can print — company research reports, property investor reports and decision records — each saved as PDF through your browser’s print.',
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
  contact:     'What works today to report a wrong figure — the report form records a case in your browser — and where a contact route will be published.',
  privacy:     'What this build stores, where it stores it and what leaves your device — no cookies, no accounts — and a draft PDPA 2010 notice.',
  terms:       'Draft terms for this build: a research tool, not advice, with illustrative data, no warranty and nothing for sale; governed by Malaysian law.',
};

/* The app is mounted at the domain root in production, but served from a
   subdirectory in some local setups. Deriving the base once keeps every
   generated link correct in both. */
/* Only an address that ENDS in /index.html names the folder the app is
   served from. Any address that merely contained it counted: the host
   answers /foo/index.html/bar with the 404 page, where the app took /foo
   for its folder, asked for /foo/data/us.json — a second 404, a 3MB one —
   and warned that the filings failed to load. (/foo/index.html itself is
   redirected to /foo by vercel.json before the app sees it.) */
const BASE = (() => {
  const p = location.pathname;
  return p.endsWith('/index.html') ? p.slice(0, -'/index.html'.length) : '';
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

/* The app's own file names the front door. The host serves /index.html as
   the file it is (a file is served before any rewrite), and the path
   was matched as it stood, so the app answered its own front door with
   "That page does not exist". A trailing /index.html is the directory it
   sits in, which is also what BASE takes it to be. */
function matchRoute(pathname) {
  const clean = (pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname).replace(/\/index\.html$/, '').replace(/\/+$/, '') || '/';
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

/* A company page's description: its name, its ticker (and on Bursa the
   listing code its address leads with), where it is listed and where its
   figures come from, then the page's own line — the sentence its served page
   carries (build.mjs holds the build's companyDescription to this). Once the
   script ran, the page wrote the generic research line over it. */
const COMPANY_LISTED = { US: 'listed in the US', MY: 'listed on Bursa Malaysia' };
function companyMetaDescription(c, pageLine) {
  const where = COMPANY_LISTED[c.mkt];
  if (!where) return pageLine;
  const tickers = c.mkt === 'MY' && c.code && c.code !== c.tk ? `${c.tk}, ${c.code}` : c.tk;
  const source = !c.real ? ILLUS_TITLE
    : c.personal ? 'Figures from your own personal-research statements — not licensed, not for redistribution.'
    : c.cik ? `Figures from its audited annual statements filed with the SEC (CIK ${Number(c.cik)}).` : null;
  return `${c.name} (${tickers}), ${where}. ${source ? `${source} ` : ''}${pageLine}`;
}
function setDocumentMeta(route) {
  /* While the filings load, a company address can resolve to the
     illustrative stand-in a filer will replace, and the head named the
     stand-in for a moment (/company/msft-microsoft-corp read "MSFT —
     Microsoft Corporation" with the stand-in's canonical). The served page's
     head is the company's own; it stands until the router runs again with the
     filings in. */
  const holdHead = (route?.view === 'research' || route?.view === 'researchReport') && typeof realPending !== 'undefined' && realPending;
  const co = (route?.view === 'research' || route?.view === 'researchReport') && !route.pending && State.ticker && BY_ID.get(State.ticker);
  const name = co
    ? `${route.view === 'researchReport' ? 'Research report: ' : ''}${co.c.tk} — ${co.c.name}`
    : (route?.title || 'Not found');
  if (!holdHead) {
    document.title = route?.path === '/' ? route.title : `${name} · Quantum Tradeworks`;
    const desc = co && route.view === 'research' ? companyMetaDescription(co.c, META.research) : (META[route?.view] || META.marketing);
    let tag = document.querySelector('meta[name="description"]');
    if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', 'description'); document.head.append(tag); }
    tag.setAttribute('content', desc);
    let canon = document.querySelector('link[rel="canonical"]');
    if (!canon) { canon = document.createElement('link'); canon.setAttribute('rel', 'canonical'); document.head.append(canon); }
    canon.setAttribute('href', location.origin + href(canonicalPath(route)));
  }
  /* The not-found card says noindex, wherever it is drawn. The host answers
     an address no route matches with 404.html, which carries it; but a
     parameter route is served the app with 200 whatever its parameter, so
     /company/no-such-name drew the card on a page a crawler was told was
     real — the soft 404 the launch audit found, left on every company,
     report and scanner address. And the app moves between pages without a
     load, so a page reached from the 404 kept its noindex. The tag follows
     the page on screen. */
  const robots = document.querySelector('meta[name="robots"]');
  if (route) robots?.remove();
  else if (robots) robots.setAttribute('content', 'noindex');
  else { const t = document.createElement('meta'); t.setAttribute('name', 'robots'); t.setAttribute('content', 'noindex'); document.head.append(t); }
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
  /* Learn and the Screener name the page by the tab on screen, as a company
     page does. Compared by the route row's tab alone, /learn and
     /learn/glossary — one dictionary — were each their own canonical, and
     /learn?tab=scoring and /discover?tab=heatmap, pages of their own, named
     /learn and /discover, whose content is the dictionary and the screener.
     A tab with a path of its own is named by it (the path the tab strip
     goes to); the other tabs by the view's address and ?tab=. The tab is
     the route's, else the one the address names when this is the page in
     the address, else the view's first — which is what applyRoute shows. */
  if (route.view === 'learn' || route.view === 'discover') {
    const tabs = route.view === 'learn' ? LEARN_TABS : DISCOVER_TABS;
    const norm = (t) => (route.view === 'learn' && LEARN_TAB_ALIAS[t]) || t;
    const here = matchRoute(location.pathname)?.path === route.path;
    const raw = route.tab || (here ? new URLSearchParams(location.search).get('tab') : null);
    const tab = raw && tabs.some(x => x.id === norm(raw)) ? norm(raw) : tabs[0].id;
    const own = ROUTES.find(r => !r.alias && r.view === route.view && r.tab && norm(r.tab) === tab);
    const bare = ROUTES.find(r => !r.alias && r.view === route.view && !r.tab);
    return own ? own.path : `${bare.path}?tab=${tab}`;
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
  /* Which strip of the page's own tabs asked for this, if one did — read
     before the page is drawn again and the tab that has focus goes. By the
     click too, for a browser that does not focus a button it clicks. */
  const inStrip = (n) => n?.closest?.('#views [role="tablist"]');
  const tablist = inStrip(document.activeElement) || inStrip(window.event?.target);
  const strip = tablist ? tablist.getAttribute('aria-label') || '' : null;
  applyRoute();
  afterRoute(before, { strip });
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
function afterRoute(beforeView, { strip = null } = {}) {
  const pathChanged = location.pathname !== lastPath;
  lastPath = location.pathname;
  /* A menu or the navigation drawer that led here has done its job, and the
     new page takes focus, so neither hands focus back. Chosen from one of
     them, the page already on screen takes focus too: the link that had it
     is about to be hidden with its menu, and focus would fall to <body>. */
  const fromMenu = openMenuLi || sheetOpen || navDrawerOpen;
  closeShellMenus({ restore: false });
  /* A tab of the page's own strip is a tab change wherever its address is.
     Four of Learn's five tabs and two of the Screener's have a path of their
     own, and choosing one was treated as a new page: the page went to the
     top and focus to <main>, so the next arrow key did nothing, while the
     tab beside it (a ?tab= one) kept focus where it was. */
  const tabChosen = strip !== null && State.view === beforeView;
  if (!tabChosen && (State.view !== beforeView || pathChanged)) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (drawer.dataset.open === '1') closeDrawer({ restore: false });
    focusMain();
  } else {
    /* Any tab strip, whatever it is drawn as: the screener's tools are a
       segmented control since Release A's fixes, not a .subnav row. The
       strip the tab was chosen in, where a page has more than one. */
    const lists = [...document.querySelectorAll('#views [role="tablist"]')];
    const list = (strip !== null && lists.find(l => (l.getAttribute('aria-label') || '') === strip)) || lists[0];
    list?.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
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
  /* And the address becomes the route's own (see matchRoute), so a link or a
     reload taken from it is the clean one. */
  if (/\/index\.html$/.test(location.pathname)) {
    const at = location.pathname.slice(BASE.length).replace(/\/index\.html$/, '') || '/';
    history.replaceState(history.state, '', href(at) + location.search + location.hash);
  }
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
         the host once served any dotted path as a file: the catch-all rewrite
         excluded it, so a reload or a shared link 404'd. The rewrites are one
         per route now and /company/:id takes a dot, but the address is still
         swapped for the company's own dotless segment, keeping the route, tab
         and query, so every company has one address whichever name opened it. */
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
    /* A name that resolves to no company is said on the page (VIEWS.compare),
       not dropped without a word; and a link none of whose names resolve
       compares nothing and says so, rather than showing the selection kept
       in this browser under an address naming other companies. */
    const names = qs.get('companies').split(',').map(s => s.trim()).filter(Boolean);
    const found = names.map(companyFromSlug);
    const ids = [...new Set(found.filter(Boolean))];
    State.compareMissing = names.filter((s, i) => !found[i]);
    State.compare = ids.slice(0, lim('compare'));
  } else if (route.view === 'compare') State.compareMissing = [];
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
  /* And /discover is the screener, by the same rule. Only Learn had it: Back
     from /discover?tab=heatmap left the Heatmap on screen under /discover,
     and after ?tab=ideas every later /discover opened on Screening
     Strategies — the address no longer said what was on screen. */
  if (route.view === 'discover' && !route.tab) {
    const t = qs.get('tab');
    if (!(t && DISCOVER_TABS.some(x => x.id === t))) State.discoverTab = 'screener';
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
  /* The address is about to name this selection, not the link's misses. */
  State.compareMissing = [];
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
   of the Scanner, as its page's strip says. Onboarding and the goal
   launcher are the dashboard's. The decision record serves property, the
   wheel and the trading index alike, so it is not in this table: its item
   follows the record on screen (decisionRecordSection). No public page is
   claimed — the sidebar is not on them. */
const SECTION_OF = {
  home: 'dashboard',
  watchlists: 'watchlists', tracked: 'watchlists',
  alerts: 'alerts',
  workspace: 'workspace', thesis: 'workspace', portfolio: 'workspace',
  reports: 'reports',
  userdata: 'userdata', plans: 'plans',
  researchHome: 'equities', research: 'equities', researchReport: 'equities', researchQueue: 'equities',
  discover: 'equities', compare: 'equities', sarawak: 'equities', wheel: 'equities',
  property: 'property', opportunities: 'property', comparables: 'property', areas: 'property',
  propertyModels: 'property',
  tradingIndex: 'scanner',
  /* Preferences and the goal launcher are reached from My Dashboard's
     "Other ways in", so the dashboard is where a reader on them is; with
     no item current the sidebar gave no location at all. */
  onboarding: 'dashboard', launcher: 'dashboard',
  /* Every scanner page, the operations pages included: they are the
     scanner's, even though the navigation carries no link to them. */
  ...Object.fromEntries(SCANNER_VIEWS.map(v => [v, 'scanner'])),
};
/* The decision record prints whichever of three tools' work is on it — the
   property deal, the Cash Wheel or the Trading Index — so its sidebar item
   is that tool's product, read as the page reads it (97-decision-record.js):
   the subject chosen if it is ready, else the first ready one. A switch of
   subject re-renders (renderKeepFocus), so the sidebar follows it. */
function decisionRecordSection() {
  if (State.view !== 'decisionRecord' || typeof DECISION_SUBJECTS === 'undefined') return null;
  const ready = DECISION_SUBJECTS.filter(s => { try { return s.ready(); } catch { return false; } });
  const id = State.decisionSubject && ready.some(s => s.id === State.decisionSubject) ? State.decisionSubject : ready[0]?.id;
  return { property: 'property', wheel: 'equities', tradingIndex: 'scanner' }[id] || null;
}
/* My Alerts' unread count, as the alerts page counts it (alertsUnread,
   60-trend.js). Guarded twice: the function may not exist in a build without
   the alerts pages, and a throw inside the chrome would take every page down
   with it. */
function navUnread() {
  try { const n = typeof alertsUnread === 'function' ? alertsUnread() : null; return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
}

/* ------------------------------------------------------------ the chrome */
/* Built once, then kept current by buildNav() on every render. Rebuilt on
   every render, as the old header was, a link that had focus was destroyed
   under the keyboard by any redraw — a theme switch, a scanner status
   change — and an open menu snapped shut. Real anchors throughout (data-path
   routes them in-app), so middle-click, open in a new tab and copy link
   address all work. */
const shellEl = {
  pubbar: $('#pubbar'), pubnav: $('#pubnav'), sheet: $('#pubSheet'), sheetBtn: $('#pubMenuBtn'), pubScrim: $('#pubScrim'),
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
      ? shellLink(p.path, { class: `pp-row pub-acc-${p.id}`, 'data-product': p.id, 'aria-description': productNote(p.id) }, kids)
      : el('div', { class: 'pp-row pp-row-off', 'data-product': p.id }, kids));
  });
}
/* Under the product rows: where every badge's note is printed. */
const productsLegendLink = () => el('p', { class: 'pp-foot' },
  shellLink('/how-it-works', { class: 'pp-foot-link' }, 'What Live, Beta and Coming soon mean'));
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
/* THE PAGE BEHIND AN OPEN SHEET OR DRAWER. Dimmed by a scrim, and inert:
   out of the tab order and out of a screen reader's swipe order, which
   honours aria-modal inconsistently. The sheet covered the page under the
   header, and Tab past its last item went on to "Which sources?", hidden
   under the still-open sheet; a swipe walked into the covered page. */
/* The decision dock too: render() mounts it at body level, outside #main, so
   its one action stayed in a screen reader's reach behind the modal drawer.
   A dock drawn while one is open is made inert as it is mounted (drawPage). */
const BEHIND = () => ['.disclosure', '#main', 'body > .dock', 'body > .footer'].map(s => document.querySelector(s)).filter(Boolean);
const setBehindInert = (on, extra = []) => [...BEHIND(), ...extra].forEach(n => { if (on) n.setAttribute('inert', ''); else n.removeAttribute('inert'); });
function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true;
  shellEl.sheet.hidden = false;
  /* At its top, with Products first, every time. The sheet is built once and
     kept, and it reopened where it had last been scrolled to: Terms chosen
     from its foot, the sheet opened again on /terms 564px down, mid-list. */
  shellEl.sheet.scrollTop = 0;
  shellEl.pubScrim && (shellEl.pubScrim.hidden = false);
  /* The name stays "Menu": it was swapped to "Close the menu" with
     aria-expanded, so a screen reader said "Close the menu, expanded" — the
     state twice. aria-expanded carries it; the icon turns to a cross. */
  shellEl.sheetBtn.setAttribute('aria-expanded', 'true');
  setBehindInert(true);
  requestAnimationFrame(() => { if (sheetOpen) { shellEl.sheet.dataset.open = '1'; if (shellEl.pubScrim) shellEl.pubScrim.dataset.open = '1'; } });
}
function closeSheet({ restore = true } = {}) {
  if (!sheetOpen) return false;
  sheetOpen = false;
  shellEl.sheet.hidden = true; delete shellEl.sheet.dataset.open;
  if (shellEl.pubScrim) { shellEl.pubScrim.hidden = true; delete shellEl.pubScrim.dataset.open; }
  shellEl.sheetBtn.setAttribute('aria-expanded', 'false');
  setBehindInert(false);
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
  /* The page behind is inert as well as dimmed: the Tab trap (95-boot.js)
     keeps a keyboard inside, but a screen reader's swipe walked into the
     dimmed page. */
  setBehindInert(true, [shellEl.appbar]);
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
  ['role', 'aria-modal'].forEach(a => sb.removeAttribute(a));
  /* Back to the landmark it is when it is not a dialog (index.template.html). */
  sb.setAttribute('aria-label', 'Workspace');
  setBehindInert(false, [shellEl.appbar]);
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
      pubMenu('menuProducts', 'Products', [el('ul', { class: 'pp-list' }, productRows()), productsLegendLink()], 'pubpanel-products'),
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
      productsLegendLink(),
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
    /* Leaving the header by Tab closes the sheet, as leaving a header menu
       does (pubMenu), so focus never lands on something it covers. */
    shellEl.pubbar.addEventListener('focusout', (e) => {
      if (sheetOpen && e.relatedTarget && !shellEl.pubbar.contains(e.relatedTarget)) closeSheet({ restore: false });
    });
  }
  /* The sidebar: My Workspace, Products, then the reader's data and plans. */
  if (shellEl.appnav) {
    const item = (n, extra = []) => el('li', { class: `sb-item${n.acc ? ` pub-acc-${n.acc}` : ''}`, 'data-item': n.id }, [
      shellLink(n.path, { class: 'sb-link', 'data-nav-id': n.id, 'aria-description': n.note || null }, [shellIcon(n.icon), el('span', { class: 'sb-text' }, n.label), ...extra]),
    ]);
    const products = PRODUCTS.filter(p => SHOW_UNBUILT || p.path);
    shellEl.appnav.append(
      el('p', { class: 'sb-label', id: 'sb-ws' }, 'My workspace'),
      el('ul', { class: 'sb-list', 'aria-labelledby': 'sb-ws' }, APP_NAV_WORKSPACE.map(n => item(n))),
      el('p', { class: 'sb-label', id: 'sb-products' }, 'Products'),
      el('ul', { class: 'sb-list', 'aria-labelledby': 'sb-products' },
        products.map(p => item({ id: p.id, label: p.name, icon: PRODUCT_ICON[p.id], path: p.path, note: productNote(p.id), acc: p.id }, [productBadge(p.id)]))),
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
    ? shellLink(p.path, { class: 'foot-product', 'aria-description': productNote(p.id) }, [p.name, productBadge(p.id)])
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
  const section = SECTION_OF[State.view] || decisionRecordSection() || toolProductOf(State.view) || null;
  shellEl.appnav?.querySelectorAll('a.sb-link').forEach(a => {
    if (a.dataset.navId === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  /* ONE UNREAD COUNT, ON MY ALERTS' OWN LINK (Release B). My Alerts lists
     every kind of alert the product raises, each labelled (60-trend.js), and
     carries one count: the unread among the kinds that keep a read state —
     the scanner's matches, counted by the scanner's own rule (alertsUnread:
     none when no record is visible here or the in-app count is switched off,
     never "0", which would claim a record exists). The count sat beside My
     Alerts as a link of its own to the Scanner's alerts, because the page My
     Alerts opened did not list them; it does now, so the count is part of
     the link to that page and the second link is gone. The pill is drawn,
     and said as part of the link's name — "My Alerts, 3 unread", starting
     with the words on screen so a voice command naming them finds it; the
     exact count, past 99, is in the title. Updated in place, so a link with
     the keyboard on it keeps it through a redraw. */
  const alertsA = shellEl.appnav?.querySelector('[data-item="alerts"] > a.sb-link');
  if (alertsA) {
    alertsA.querySelectorAll('.sb-count, .sb-count-said').forEach(n => n.remove());
    const unread = navUnread();
    if (unread) {
      const shown = unread > 99 ? '99+' : String(unread);
      alertsA.append(
        el('span', { class: 'sb-count', 'aria-hidden': 'true', title: `${unread} unread scanner match${unread === 1 ? '' : 'es'} — not yet opened in this browser; muted setups are not counted` }, el('span', { class: 'nav-count' }, shown)),
        el('span', { class: 'sr-only sb-count-said' }, `, ${shown} unread`));
    }
  }
  /* The public header's current link, and a mark on the menu that holds it. */
  const res = chrome === 'public' ? resourceHere() : null;
  document.querySelectorAll('#pubnav a, #pubSheet a').forEach(a => {
    const on = a.dataset.pub ? a.dataset.pub === State.view : res ? a.dataset.path === res.path : false;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  /* The mark on a closed menu is drawn, and said: the underline alone told
     assistive technology nothing until the menu was opened. */
  const resBtn = $('#menuResourcesBtn');
  if (resBtn) {
    resBtn.toggleAttribute('data-current', !!res);
    if (res) resBtn.setAttribute('aria-description', `Current page: ${res.label}`); else resBtn.removeAttribute('aria-description');
  }
}

/* THE PRODUCT'S TABS, above its pages. Drawn into their own host in <main>,
   outside the view, so a tab change does not replay the view's entrance on
   the strip the reader just pressed. A nav landmark named for the product;
   the tab for the page on screen is current.
   A strip the same as the one on screen is left in place. It was rebuilt on
   every render, so a tab the reader had reached went to <body> when the
   filings landed a moment after the page opened, and a strip scrolled along
   on a phone jumped back to its current tab.
   THE ONE HEADER OF EVERY PRODUCT PAGE AND EVERY WORKSPACE PAGE (Release B,
   B5). The Scanner's row is here with the other two, its sections from the
   registry — its pages drew their own strip inside the page, which is gone
   (scannerSubnav, 87-scanner-ops.js) — and its Alerts tab carries the unread
   count that strip carried. My Workspace's pages wear the same header, named
   for the workspace, its tabs the workspace's tools (workspaceTabs): the
   personal pages' nameless strip (mySubnav) is gone the same way. */
function renderProductTabs() {
  const host = shellEl.tabsHost;
  if (!host) return;
  const pid = productOf(State.view);
  const ws = !pid && isWorkspaceView(State.view);
  const tabs = pid ? PRODUCT_TABS[pid] : ws ? workspaceTabs() : null;
  if (!tabs || NO_PRODUCT_TABS.has(State.view)) { host.replaceChildren(); host.hidden = true; delete host.dataset.strip; return; }
  const p = pid ? productById(pid) : null;
  const here = tabs.find(t => t.views.includes(State.view));
  /* The tools' states are part of what the strip says: a tool the filings
     failed under is text in it, and comes back a link when they load. So is
     a tab's count: a match read changes the Scanner's Alerts tab. */
  const strip = JSON.stringify([pid || 'workspace', tabs.map(t => [t.label, t.path, toolState(t.tool)?.status, tabCount(t)]), here?.path ?? null]);
  if (!host.hidden && host.dataset.strip === strip) return;
  const items = tabs.map(t => {
    const n = tabCount(t);
    return { label: n ? `${t.label} · ${n}` : t.label, path: t.path, current: t === here, ariaLabel: n ? `${t.label}, ${n} unread` : null };
  });
  const nav = p
    ? sectionTabs({ label: `${p.name} sections`, pid, tabs: items, cls: pid === 'scanner' ? 'scan-subnav' : '' })
    : sectionTabs({ label: `${WORKSPACE_HEAD.name} sections`, name: WORKSPACE_HEAD, tabs: items, cls: 'ws-tabs' });
  host.replaceChildren(el('div', { class: 'shell' }, nav));
  host.hidden = false;
  host.dataset.strip = strip;
  wireSectionTabs(nav);
}

/* ONE ROW OF SECTION TABS, ONE COMPONENT. The products' rows and the
   workspace's (renderProductTabs) are the same level of navigation, and were
   two unrelated patterns: an underline row with the product's name and
   badge for two products, and for the third a grey box of pills with no
   name, wrapping into three rows on a phone. Each is now this: the product's
   name and badge — or the workspace's name — then one row of underline tabs
   that scrolls, with the current tab marked aria-current. A strip drawn
   inside a view (inView) takes the band's look where it sits, at the top of
   the page (.ptabs-inview); since Release B no page draws one of its own. */
/* One tab. Where its tool cannot be used here, text in place of the link,
   with the badge and why (gateToolLink), whichever page drew the strip.
   Where the tool works but its state is worth marking — Delayed, Demo — the
   badge stands after the tab rather than inside it, so the tab's name stays
   its own words (the Scanner's "Alerts, 9 unread" among them), and the link
   carries the state and why as its description. */
function sectionTab(t) {
  const tool = toolForPath(t.path);
  const s = tool ? toolState(tool) : null;
  const flagged = s && s.actionable && TOOL_FLAGGED.has(s.status);
  const a = shellLink(t.path, { class: 'ptab', 'aria-current': t.current ? 'page' : null, 'aria-label': t.ariaLabel || null,
    'aria-description': flagged ? `${s.label}: ${s.note}` : null }, t.label);
  if (s && !s.actionable) return gateDetached(a);
  return flagged ? [a, toolBadge(tool)] : a;
}
function sectionTabs({ label, pid = null, name = null, tabs, cls = '', inView = false }) {
  const p = pid ? productById(pid) : null;
  const nav = el('nav', { class: `ptabs ${pid ? `pub-acc-${pid} ` : ''}${cls}`.trim(), 'aria-label': label }, [
    p ? el('span', { class: 'ptabs-name' }, [shellIcon(PRODUCT_ICON[pid], 16, 'ptabs-ico'), el('span', {}, p.name), productBadge(pid)])
      : name ? el('span', { class: 'ptabs-name' }, [shellIcon(name.icon, 16, 'ptabs-ico'), el('span', {}, name.name)]) : null,
    el('ul', { class: 'ptabs-list' }, tabs.map(t => el('li', {}, sectionTab(t)))),
  ]);
  if (!inView) return nav;
  const band = el('div', { class: 'ptabs-host ptabs-inview' }, nav);
  /* Laid out once it is on the page: the view is built before render()
     mounts it, and a strip redrawn by its own page is mounted by that page. */
  requestAnimationFrame(() => { if (nav.isConnected) wireSectionTabs(nav); });
  return band;
}
/* Where the row is narrower than its tabs it scrolls: the current tab is
   brought into it, so the page's own name is never the one scrolled out of
   sight, and the row fades at whichever end has more — the sign that there
   is more, which a hidden scrollbar does not give. A tab reached by Tab is
   scrolled clear of the fade too: the browser's own focus scroll left a
   half-hidden tab at the row's edge, 80% outside it and under the mask, its
   focus ring a sliver (scroll-padding on the list keeps it clear). */
function wireSectionTabs(nav) {
  const list = nav.querySelector('.ptabs-list');
  if (!list || list.dataset.wired) return;
  list.dataset.wired = '1';
  const cur = nav.querySelector('.ptab[aria-current]');
  /* Not while a tab in it holds focus: a strip redrawn under the reader
     (render() gives focus back, and where the strip was scrolled) keeps the
     tab in use in view rather than swinging to the current one. */
  const centre = () => {
    if (!cur || list.contains(document.activeElement) || list.scrollWidth <= list.clientWidth + 1) return;
    const l = list.getBoundingClientRect(), c = cur.getBoundingClientRect();
    list.scrollLeft += (c.left + c.width / 2) - (l.left + l.width / 2);
  };
  centre();
  /* The header's row is wired before the page under it is drawn. The page's
     scrollbar, when it comes, takes 15px from the row: the Scanner's eight
     tabs then overflowed by 15px more than when they were centred, and the
     current one — the last, the Trading Index — stood 14px past the row's
     end at 1024 and 1280. Each time the row's width changes, a current tab
     not wholly in it is brought back into it. */
  if (cur && typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
      if (!list.isConnected) { ro.disconnect(); return; }
      const l = list.getBoundingClientRect(), c = cur.getBoundingClientRect();
      if (c.left < l.left - 1 || c.right > l.right + 1) centre();
      fadeTabs(list);
    });
    ro.observe(list);
  }
  list.addEventListener('scroll', () => fadeTabs(list), { passive: true });
  list.addEventListener('focusin', (e) => {
    if (!e.target.matches?.('.ptab') || list.scrollWidth <= list.clientWidth + 1) return;
    e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    fadeTabs(list);
  });
  fadeTabs(list);
}
function fadeTabs(list) {
  const max = list.scrollWidth - list.clientWidth;
  const f = max <= 1 ? '' : list.scrollLeft <= 1 ? 'end' : list.scrollLeft >= max - 1 ? 'start' : 'both';
  if (f) list.dataset.fade = f; else delete list.dataset.fade;
}
window.addEventListener('resize', () => document.querySelectorAll('.ptabs-list').forEach(fadeTabs));
buildShell();

/* ONE DOMINANT ACTION ON A PUBLIC PAGE. The header's "Open workspace" and
   the homepage's "Open your workspace" were two filled buttons of one colour
   within 550px of each other, and on /pricing the header's outweighed the
   page's own. While a primary action of the page is on screen the header's
   steps down to the outline style; scrolled past it, the header's is the
   primary again. Only the look changes — it is the same link throughout. */
let ctaWatch = null;
function watchPageCta() {
  ctaWatch?.disconnect(); ctaWatch = null;
  const cta = shellEl.pubbar?.querySelector('.pub-cta');
  if (!cta) return;
  cta.classList.remove('pub-cta-quiet');
  if (chromeOf(State.view) !== 'public' || typeof IntersectionObserver !== 'function') return;
  const primaries = [...viewRoot.querySelectorAll('.btn-primary')];
  if (!primaries.length) return;
  const seen = new Set();
  ctaWatch = new IntersectionObserver((entries) => {
    entries.forEach(e => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)));
    cta.classList.toggle('pub-cta-quiet', seen.size > 0);
  });
  primaries.forEach(p => ctaWatch.observe(p));
}

let stickyObserver = null;
let stickySizer = null;
let stickyScroll = null;
let dockSizer = null;
let railSizer = null;
let fitRails = () => {};
/* A viewport that changes height changes which rails fit, and a
   ResizeObserver on the rail itself never hears about it. */
window.addEventListener('resize', () => fitRails());

/* A SCROLL BOX THE KEYBOARD CAN REACH, AND A SCREEN READER CAN NAME.
   A box that scrolls — a wide table in its .tablewrap on a phone, any
   overflow-x container — and holds nothing that takes focus could not be
   scrolled from the keyboard: nothing in it is a Tab stop, so its hidden
   columns were out of reach (axe: scrollable-region-focusable; the launch
   audit found three on the property calculator at 390px, and the pattern is
   every static table wider than its card on a phone). Chrome now makes such
   a box a Tab stop of its own, but with no role and no name, so a screen
   reader landed on it and said nothing; other browsers do not.
   So after every draw, and whenever the page changes size, each box in the
   page that overflows and holds no Tab stop becomes
   one: tabindex=0, role=region, and a name — its table's caption, else the
   nearest heading before it, with ", table" when it holds one — numbered
   where two would share it, since two regions with one name are one
   landmark listed twice. The global :focus-visible ring marks it, outside
   its edge, where a sticky table header cannot paint over it (styles.css
   keeps the box's own corners), and the arrow keys scroll it once it has
   focus. A box that stops overflowing — the phone turned,
   the window widened — gives the attributes back. Only what this adds is
   ever taken away: a box a view named itself (the evidence table,
   75-property-grade.js) is left as it was drawn. The drawer's body, and
   the boxes in it, are fitted the same way (openDrawer, queueScrollStops). */
/* More than a pixel of rounding. axe lets 13px pass as its own margin, but
   what a box hides is hidden however little it is, and a box that measured
   exactly 13px over here measured over 13 while axe ran (the calculator's
   "If the interest rate rises" table at 360px): a stop is due wherever
   there is anything to scroll to. */
const SCROLL_STOP_SLACK = 1;
const SCROLL_STOP_TABBABLE = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';
const SCROLL_STOP_HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"], .h-card';
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
let scrollStopSizer = null, scrollStopQueued = false;
/* Drawn, and not inside a closed <details>: Chrome keeps a closed one's
   contents laid out (content-visibility: hidden), so a table in it still
   measures as overflowing though no one can see or reach it. */
const shown = (n) => (n.checkVisibility ? n.checkVisibility() : n.getClientRects().length > 0);
/* Scrolls, as axe measures it: content past the box by more than the
   slack, on an axis the box lets scroll. */
function scrollsItself(n) {
  const x = n.scrollWidth > n.clientWidth + SCROLL_STOP_SLACK, y = n.scrollHeight > n.clientHeight + SCROLL_STOP_SLACK;
  if (!x && !y) return false;
  const s = getComputedStyle(n);
  return ((x && /^(auto|scroll)$/.test(s.overflowX)) || (y && /^(auto|scroll)$/.test(s.overflowY))) && shown(n);
}
const holdsTabStop = (box) => [...box.querySelectorAll(SCROLL_STOP_TABBABLE)]
  .some(n => n.tabIndex >= 0 && !n.disabled && shown(n));
/* The table a box is the frame of: its only content, however deep — not a
   table somewhere in a larger box, which the drawer's whole body can be
   (a metric's definition, with its distribution table far down it, was
   announced "Metric definition, table"). */
function framedTable(box) {
  const t = box.querySelector('table');
  for (let p = t; p && p !== box; p = p.parentElement) if (p.parentElement.children.length !== 1) return null;
  return t;
}
/* What the box is called: its table's caption or label, else the last
   heading before it in the page — found walking out from the box through
   the siblings before each ancestor, nearest first. */
function scrollStopName(box) {
  const table = framedTable(box);
  let name = oneLine(table?.caption?.textContent) || oneLine(table?.getAttribute('aria-label'));
  /* In the page, no further out than the page; in the drawer, no further
     out than the drawer, whose own title is the heading before its body. */
  for (let n = box; !name && n && n !== viewRoot && n !== drawer && n !== document.body; n = n.parentElement) {
    for (let s = n.previousElementSibling; s && !name; s = s.previousElementSibling) {
      const h = s.matches(SCROLL_STOP_HEADING) ? s : [...s.querySelectorAll(SCROLL_STOP_HEADING)].pop();
      name = oneLine(h?.textContent);
    }
  }
  const fallback = drawer.contains(box) ? drawerTitle : viewRoot.querySelector('h1');
  name = (name || oneLine(fallback?.textContent) || 'This page').slice(0, 90);
  return `${name}${table ? ', table' : box.classList.contains('chart-scroll') ? ', chart' : ''}`;
}
function giveBackScrollStop(box) {
  /* Taken from under focus, the focus would fall to <body>: kept until
     the reader leaves it. */
  if (box === document.activeElement) { box.addEventListener('blur', () => queueScrollStops(), { once: true }); return; }
  for (const a of box.dataset.scrollStop.split(' ')) if (a) box.removeAttribute(a);
  delete box.dataset.scrollStop;
}
function fitScrollStops(root = viewRoot) {
  /* Innermost first, so a box holding a box that becomes a Tab stop is
     known to hold one; everything is measured before anything is written.
     The root itself too: the drawer's body is a box that scrolls. */
  const boxes = [], giveBack = [];
  for (const n of [root, ...root.querySelectorAll('*')].reverse()) {
    const mine = n.dataset.scrollStop !== undefined;
    if (!scrollsItself(n) || holdsTabStop(n) || boxes.some(b => n.contains(b))) { if (mine) giveBack.push(n); continue; }
    /* A tab stop its view made it: the view has said what it is. */
    if (!mine && n.hasAttribute('tabindex')) continue;
    boxes.push(n);
  }
  giveBack.forEach(giveBackScrollStop);
  if (!boxes.length) return;
  boxes.reverse();
  /* Names already given — a view's own named regions included — and how many
     boxes here would take each, so a shared one is numbered. */
  const taken = new Map();
  for (const r of root.querySelectorAll('[role="region"][aria-label]')) {
    if (!boxes.includes(r)) taken.set(r.getAttribute('aria-label'), (taken.get(r.getAttribute('aria-label')) || 0) + 1);
  }
  const named = boxes.map(b => [b, scrollStopName(b)]);
  const count = new Map();
  named.forEach(([, s]) => count.set(s, (count.get(s) || 0) + 1));
  const seen = new Map();
  for (const [box, base] of named) {
    const before = taken.get(base) || 0, total = before + count.get(base);
    const k = before + (seen.get(base) || 0) + 1;
    seen.set(base, (seen.get(base) || 0) + 1);
    const label = total > 1 ? `${base} ${k} of ${total}` : base;
    const added = new Set((box.dataset.scrollStop || '').split(' ').filter(Boolean));
    const set = (attr, value) => {
      if (box.hasAttribute(attr) && !added.has(attr)) return;
      if (box.getAttribute(attr) !== value) box.setAttribute(attr, value);
      added.add(attr);
    };
    set('tabindex', '0');
    set('role', 'region');
    if (!box.hasAttribute('aria-labelledby')) set('aria-label', label);
    const note = [...added].join(' ');
    if (box.dataset.scrollStop !== note) box.dataset.scrollStop = note;
  }
}
/* Once a frame at most: a resize or a reflow reports many sizes in a row.
   The page, and the drawer, which sits outside it. In the drawer a derived
   line's "Inputs" table (openLineDrawer) is 39px wider than the drawer at
   1440 and 104px at 360, and a metric's definition (openMetricInfo) is a
   body of text 500px taller than the drawer on a phone and on a desktop,
   with nothing in either to focus. The drawer keeps Tab inside itself
   (95-boot.js) among the stops it can find, which a box that is a Tab stop
   only by the browser's own rule is not: Tab went from the close button to
   the close button, and the arrow keys scrolled the page behind. A closed
   drawer is hidden, so its boxes give back what they were given. */
function queueScrollStops() {
  if (scrollStopQueued) return;
  scrollStopQueued = true;
  requestAnimationFrame(() => { scrollStopQueued = false; fitScrollStops(); fitScrollStops(drawerBody); });
}
window.addEventListener('resize', queueScrollStops);
/* And whenever the page's content changes without a draw — a figure filled
   in when its data lands, a row added in place — which can widen a table
   past its box while the page as a whole keeps its size, so the
   ResizeObserver on it (drawPage) hears nothing. Not attributes: this code
   writes some, and a change it makes must not call it back. The drawer's
   body the same way: openDrawer replaces it, and some drawers redraw in
   place. */
const scrollStopWatch = new MutationObserver(queueScrollStops);
scrollStopWatch.observe(viewRoot, { childList: true, subtree: true, characterData: true });
scrollStopWatch.observe(drawerBody, { childList: true, subtree: true, characterData: true });
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
  /* A screen tall, so the footer waits below the fold with the page. The
     card is 450px, and the footer painted under it was pushed 1,500px down
     when the filings landed — a layout shift of 0.12 to 0.42 on /pricing,
     the screener and the dashboard, measured by Lighthouse and by the
     layout-shift entries (the audit block in sweep.mjs). */
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md);min-height:100vh' });
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

/* THE CONTROL IN USE SURVIVES A REDRAW OF ITS OWN PAGE.
   ---------------------------------------------------------------------------
   render() replaces the whole view, the product tabs above it and the dock
   below it, so a control the reader had reached in any of them went with a
   redraw and focus fell to <body>, throwing a keyboard or screen-reader
   reader back to the skip link. The redraws a control asks for mostly hand
   focus on themselves (renderKeepFocus, focusAfterRedraw); the ones nobody
   asked for could not. Every page that does not wait behind the skeleton is
   drawn at once and drawn again when the filings land (boot routes again,
   95-boot.js), and the area screen and the calculator again when the
   locality positions do — a second or two on a fast line, as long as the
   2.4MB of filings take on a slow one. With them held back, a name being
   typed into "Record a property" on /property/opportunities, and an
   Equities or Property tab, each went to <body>. The property pages carried
   their own copy of this (keepFocusThroughRedraw, 70-property.js); this
   replaces it, for every page.

   So render() notes the control in focus before it draws anything, where it
   sits somewhere a redraw replaces (REDRAW_FOCUS_SCOPES — never a drawer,
   the search or a dialog, which a redraw leaves alone). A microtask later
   the redraw and whatever called it are over, and only if focus fell to
   <body> — a caller that moved focus has done so by then, synchronously —
   it goes back to the same control in the new page: by id, or else by
   which of its kind it was in its record, a link by its address and
   anything else by what it says (recordOf, below). What the reader was
   typing in it comes too, where it had not yet been committed, a <details>
   it sat in is opened again, since a closed one cannot hold focus, and a
   box round it that scrolls on its own is scrolled back to where it was.
   Where there is no such control any more, focus goes to the page's main
   landmark, never to <body>. Only on a redraw of the page already on
   screen: a navigation keeps its own rule (afterRoute puts focus on the new
   page), and a control is never looked for on another page. Where one task
   redraws twice, the first note stands, because it is what the reader had.

   THE CARET COMES WITH IT. A field focused by script takes the caret at its
   start, with nothing selected. A field's change redraws a tick later
   (renderKeepFocus from a setTimeout), after Tab has moved focus to the next
   field and selected its figure for typing to replace, and the next field
   came back with the caret before its figure: on the screener a maximum of
   30, retyped 40 after Tab, read 4030, and on /compare a Bursa withholding
   of 0 retyped 7 read 70. Where the redraw's caller put focus back on the
   same control (renderKeepFocus), only the caret is restored. A number field
   has no selection a page can read or set, so its state is taken from what
   Chrome reports as the document's selection — its whole figure, after
   Tab — and put back with select(), or else the caret goes to the end,
   where typing leaves it. */
const typedSinceCommit = new WeakSet();
document.addEventListener('input', (e) => typedSinceCommit.add(e.target), true);
document.addEventListener('change', (e) => typedSinceCommit.delete(e.target), true);
function fieldCaret(n) {
  if (!n || !/^(INPUT|TEXTAREA)$/.test(n.tagName)) return null;
  try { if (typeof n.selectionStart === 'number') return [n.selectionStart, n.selectionEnd, n.selectionDirection]; }
  catch { /* number and date fields throw rather than answer */ }
  if (n.type !== 'number' || n.value === '') return null;
  const s = document.getSelection();
  return s && s.type === 'Range' && s.toString() === n.value ? 'all' : 'end';
}
function putCaret(n, caret) {
  if (Array.isArray(caret)) { try { n.setSelectionRange(...caret); } catch { /* not a text field now */ } return; }
  if (caret === 'all') { n.select(); return; }
  /* Setting a value moves the caret to its end. */
  if (caret === 'end' && n.value !== '') { const v = n.value; n.value = ''; n.value = v; }
}
/* Where a control sits that render() replaces: the page and its product
   tabs (#main), the dock, and the chrome — built once, all but the
   sidebar's scanner-alert count, which is drawn afresh with every page. */
const REDRAW_FOCUS_SCOPES = ['#main', '.dock', '#sidebar', '#appbar', '#pubbar'];
/* A control drawn later than the page — a point on a locality map, a frame
   after it — is not there to be found when the redraw ends. The module that
   draws it claims it here and hands focus to it when it draws (cityMap,
   70-property.js). */
const redrawFocusClaims = [];
/* The page render() last drew, and its note of the control in focus while
   a redraw of that page is under way. */
let renderedPage = null, focusNote = null;
const pageOnScreen = () => `${State.view} ${location.pathname}`;
const saidBy = (n) => (n?.getAttribute?.('aria-label') || n?.textContent || '').replace(/\s+/g, ' ').trim();
/* What a control is called, to find it again. A box that holds focus only
   because it scrolls (Chrome makes a scroller with nothing focusable in it
   a Tab stop) has no name of its own but the whole of what it holds — a
   table, whose figures the filings landing change: the "Companies" column
   on /methodology, focused, was not found again and focus left it. Such a
   box is known by its kind of box instead. */
const FOCUS_OWN_NAME = 'a[href], button, input, select, textarea, summary, [role], [tabindex], [aria-label]';
const nameOf = (n) => n.matches(FOCUS_OWN_NAME) ? saidBy(n) : `${n.tagName}.${n.className}`;
/* WHICH RECORD A CONTROL BELONGS TO. Controls with no id were found again by
   their words and their place among the controls saying the same, and a
   card's "Delete" is word for word every other card's. Pressed on
   /my/watchlists, it took its own list away and render() handed focus to
   the next list's "Delete" — one Enter and a confirm from removing that one
   too. So a control is also known by the record it sits in — the words
   heading each row, card, panel or list item round it — and is found again
   by its place among its kind in that record only while that record holds
   as many of them as it did: a record gone, or one of its controls gone,
   leaves nothing to guess between. */
const REDRAW_RECORD = 'tr, li, .card, .panel, fieldset';
function recordOf(n, root) {
  const heads = [];
  for (let r = n.parentElement?.closest(REDRAW_RECORD); r && root.contains(r); r = r.parentElement?.closest(REDRAW_RECORD)) {
    const head = r.tagName === 'TR' ? [...r.cells].find(c => c.textContent.trim()) : r.querySelector('h1, h2, h3, h4, h5, h6, legend, caption');
    heads.push(saidBy(head).slice(0, 80));
  }
  return heads.join(' / ');
}
/* A FIELD LEFT BY TAB. A text field's change fires as Tab or Shift+Tab takes
   focus from it: the field has let go and the next control does not have it
   yet, so at that moment nothing holds focus. A change that redraws the page
   there replaced the control the browser was moving to, and focus fell to
   <body> — the calculator's "Weeks a year you would use it yourself" and the
   company page's required discount, typed and Tabbed past, sent the next Tab
   to "Skip to content" at the top of the page. The field that is committing
   is the control in use: it is noted as the one Tab is leaving, and focus
   goes one stop on from the field drawn in its place, the way the key was
   going (giveFocusBack). The key is known for the task it is pressed in. */
let tabLeaving = null;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  tabLeaving = { back: e.shiftKey };
  setTimeout(() => { tabLeaving = null; }, 0);
}, true);
const TAB_STOPS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]';
/* One stop on from `n`, as Tab would go: brought into view as Tab brings
   it, and a text field's figure selected, so typing replaces it as it would
   after the key. False where there is no stop that way to take focus. */
function tabOnFrom(n, step) {
  const stops = [...document.querySelectorAll(TAB_STOPS)].filter(x => x.tabIndex >= 0 && x.getClientRects().length && !x.closest('[inert]'));
  const at = stops.indexOf(n);
  if (at < 0) return false;
  for (let i = at + step; i >= 0 && i < stops.length; i += step) {
    const to = stops[i];
    to.focus();
    if (document.activeElement !== to) continue;
    if (to.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file)$/.test(to.type)) to.select?.();
    return true;
  }
  return false;
}
function noteFocusForRedraw() {
  let a = document.activeElement, left = 0;
  if (!a || a === document.body) {
    const e = window.event;
    if (!tabLeaving || e?.type !== 'change' || !(e.target instanceof Element) || !e.target.isConnected) return null;
    a = e.target; left = tabLeaving.back ? -1 : 1;
  }
  const scope = REDRAW_FOCUS_SCOPES.find(s => a.closest(s));
  if (!scope || redrawFocusClaims.some(claim => claim(a))) return null;
  const link = a.tagName === 'A' ? a.getAttribute('href') : null;
  const words = nameOf(a);
  /* Its kind: the same element saying the same, a link going to the same
     address. With an id, it is looked for by id first; an id numbered
     afresh at every draw (the scanner's fields, 86-scanner.js) is gone from
     the new page, and then a control that says something is found as its
     kind is. */
  const kin = (root) => [...root.querySelectorAll(a.tagName)]
    .filter(n => (a.id || !n.id) && (link !== null ? n.getAttribute('href') === link : nameOf(n) === words));
  const root = a.closest(scope);
  const record = recordOf(a, root);
  const all = kin(root);
  const mine = all.filter(n => recordOf(n, root) === record);
  const scrolled = [];
  /* From the control itself: a scroll box in focus (fitScrollStops) is the
     box the reader has been scrolling with the arrow keys. */
  for (let p = a, up = 0; p && p !== root; p = p.parentElement, up++) {
    if (p.scrollLeft || p.scrollTop) scrolled.push([up, p.scrollLeft, p.scrollTop]);
  }
  return {
    a, scope, kin, record, page: pageOnScreen(),
    nth: mine.indexOf(a), count: mine.length,
    /* The only one of its kind on the page is itself wherever it now sits. */
    alone: all.length === 1,
    findable: !a.id || link !== null || words !== '',
    /* A heading or a card that focusAfterRedraw or a jump link gave focus
       holds it through tabindex=-1, and the one drawn in its place has none. */
    tabindex: a.getAttribute('tabindex'),
    /* How far the boxes round it that scroll on their own had been scrolled
       — a statement table swiped sideways on a phone, a strip of tabs. The
       ones drawn in their place start at their beginning, and the control
       given focus back sat outside the part of its box on screen. Held by
       how many steps up from the control each one is. */
    scrolled,
    /* How far down the screen it sat, when it was on the screen: see stayPut. */
    top: onScreenTop(a, scope),
    typed: typedSinceCommit.has(a) ? a.value : null,
    /* A summary's own disclosure may have been closed; any other holder of focus sat in open ones. */
    ownOpen: a.tagName === 'SUMMARY' && !!a.parentElement?.open,
    caret: left ? null : fieldCaret(a),
    /* +1 or −1 where Tab or Shift+Tab is leaving the field (see tabLeaving). */
    left,
  };
}
function counterpartOf(h) {
  const root = document.querySelector(h.scope);
  if (!root) return null;
  if (h.a.id) {
    const n = document.getElementById(h.a.id);
    if (n && root.contains(n)) return n;
    if (!h.findable) return null;
  }
  const all = h.kin(root);
  const mine = all.filter(n => recordOf(n, root) === h.record);
  if (mine.length === h.count) return mine[h.nth];
  return h.alone && all.length === 1 ? all[0] : null;
}
/* What was typed and not yet committed, in the field drawn in its place —
   and still uncommitted there. It was put back as a plain value, so the
   next redraw before the reader typed again found nothing uncommitted and
   drew the field empty: "ma" typed into a watchlist's "Add a company"
   survived one OS theme switch and went with the second, and the locality
   positions land a moment after the filings on the area screen and the
   calculator. */
function keepTyping(h, n) {
  if (h.typed === null || !('value' in n)) return;
  if (n.value !== h.typed) n.value = h.typed;
  typedSinceCommit.add(n);
}
/* THE CONTROL STAYS WHERE IT WAS ON THE SCREEN. The browser keeps what the
   reader is looking at still when something above it changes size (scroll
   anchoring), but not across a redraw, which replaces what it was holding
   still: a page drawn again with more or less above the control in use put
   that control somewhere else on the screen. On the calculator the
   locality positions landing drew the map of the town's areas above "What
   you have recorded", and "What you observed", in use below it, dropped
   479px, to 880px down a 900px screen, under the dock. Where it was on
   screen, the page is scrolled by what it moved.
   Only in the page (a header, the sidebar and the dock do not scroll with
   it), and only where it was on screen: a control scrolled away from is not
   what the reader is looking at. */
function onScreenTop(n, scope) {
  if (scope !== '#main') return null;
  const r = n.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight ? r.top : null;
}
function stayPut(h, n) {
  if (h.top === null) return;
  const moved = n.getBoundingClientRect().top - h.top;
  /* Not for a pixel or two: the sticky strip's measured offsets settle a
     frame after a redraw, and following them crept a control 1px a redraw. */
  if (Math.abs(moved) > 2) window.scrollBy({ top: moved, behavior: 'instant' });
}
/* The scrollers round the control, as far along as they were (see scrolled). */
function scrollBack(h, n) {
  for (const [up, left, top] of h.scrolled) {
    let p = n;
    for (let k = 0; k < up && p; k++) p = p.parentElement;
    if (p && p !== document.body) { p.scrollLeft = left; p.scrollTop = top; }
  }
}
function giveFocusBack(h) {
  const { a, caret } = h;
  if (a.isConnected || renderedPage !== h.page) return;
  const at = document.activeElement;
  if (at && at !== document.body) {
    if (a.id && at.id === a.id) { scrollBack(h, at); stayPut(h, at); if (caret) putCaret(at, caret); }
    return;
  }
  const n = counterpartOf(h);
  /* A control that is gone — a record deleted, a label changed by its own
     action, a button disabled — leaves focus on the page's main landmark, as
     focusAfterRedraw does (05-plans.js), rather than on <body> or on
     another record's control. */
  if (!n) { focusMain(); return; }
  for (let d = n.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
    if (n.tagName === 'SUMMARY' && d === n.parentElement) { if (h.ownOpen) d.open = true; }
    else d.open = true;
  }
  keepTyping(h, n);
  if (h.tabindex !== null && !n.hasAttribute('tabindex')) n.setAttribute('tabindex', h.tabindex);
  scrollBack(h, n);
  n.focus({ preventScroll: true });
  if (document.activeElement !== n) { focusMain(); return; }
  stayPut(h, n);
  /* Tab was leaving it: on to where the key was going. */
  if (h.left && tabOnFrom(n, h.left)) return;
  if (caret) putCaret(n, caret);
}

function render() {
  const samePage = renderedPage === pageOnScreen();
  /* Before anything is replaced, and on a redraw of the page on screen only
     — see noteFocusForRedraw above. */
  const note = !focusNote && samePage ? (focusNote = noteFocusForRedraw()) : null;
  /* Handed back once the page is drawn — AFTER the microtasks the page's
     views queued as they drew. The valuation tab draws its three charts in
     microtasks (50-views-studio.js); handed back before them, a control
     below the charts was focused while their boxes were still empty, and
     scroll anchoring held it where the empty boxes had put it. */
  try { drawPage(samePage); }
  finally { if (note) queueMicrotask(() => { focusNote = null; giveFocusBack(note); }); }
}
function drawPage(samePage) {
  /* Whether the company page's ticker strip is stuck, read before the page
     it is on is replaced — see the strip, below. */
  const stripWasStuck = samePage && !!viewRoot.querySelector('.ticker-sticky.is-stuck');
  buildNav();
  renderProductTabs();
  const node = (realPending && UNIVERSE_VIEWS.has(State.view))
    ? bootSkeleton()
    : (VIEWS[State.view] ? VIEWS[State.view]() : el('div', {}, 'Not found'));
  /* A surface the capability register marks feature-flagged says so on the
     page, from the register row itself (80-registers.js). Not on the
     skeleton: there is no surface yet to describe. */
  if (!(realPending && UNIVERSE_VIEWS.has(State.view))) {
    mountFlagNotice(node, State.view, State.researchTab);
    /* And a tool that is delayed or unavailable here says why on its own
       page (TOOLS, toolState). */
    mountToolNotice(node);
  }
  /* A redraw of the page on screen does not play the page's entrance again
     (styles.css, .view[data-redrawn]). It did at every redraw — every
     filter changed on the screener, the filings landing, an OS switch to
     dark, a tab of the page's own strip — the whole page faded out and slid
     up 6px under the reader, and the control given focus back was measured
     6px off where it came to rest (stayPut). A new page still enters. */
  /* Above the page, in its column: the product's Start here panel, until the
     reader hides it (Release B, B6; 36-layouts.js). */
  const section = el('section', { class: 'view', data: samePage ? { active: '1', redrawn: '1' } : { active: '1' } }, el('div', { class: 'shell' }, [startHereNode(), node]));
  /* Every link the page drew, through the one gate before it is shown: a
     link to a tool that cannot be used here becomes text (gateToolLink). */
  gateToolLinks(section);
  viewRoot.replaceChildren(section);
  /* The page's charts, which could not be drawn before it had a width
     (30-charts.js): now, so a redraw puts the page back as it was, the
     chart in focus is there to be given focus back, and nothing below a
     chart jumps. */
  drawChartsInPlace();
  /* Read once the view is drawn: a view can move to another address as it
     draws (/my/scanner?symbol= opens the setup builder). */
  renderedPage = pageOnScreen();
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
    gateToolLinks(dock);
    /* Behind an open sheet or drawer, as the page it summarises is (BEHIND). */
    if (sheetOpen || navDrawerOpen) dock.setAttribute('inert', '');
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

  /* The disclosure is a single compact line on both chromes (styles.css,
     the disclosure strip). A four-line warning block above the headline
     buries the thing a reader came to read, and a warning nobody reaches is
     not a warning; inside the app the full breakdown put every workspace
     page's heading a third to two-thirds of the way down a phone. The
     material sentence is always shown, and on every page "Which sources?"
     opens the rest of it, so no word is out of reach. The surface still
     follows the chrome (chromeOf) for the rules that differ between them. */
  document.body.dataset.surface = chromeOf(State.view);
  watchPageCta();

  /* Reveal the compact ticker identity only once the full header is gone. */
  stickyObserver?.disconnect();
  stickySizer?.disconnect();
  if (stickyScroll) removeEventListener('scroll', stickyScroll);
  stickyScroll = null;
  document.documentElement.classList.remove('strip-stuck');
  const strip = $('.ticker-sticky', section);
  if (strip) {
    /* A REDRAW OF THE PAGE ON SCREEN KEEPS THE STRIP AS IT WAS. It was drawn
       unstuck and found stuck again two frames later, 44px taller at 1440
       and 56px at 390 — so the page under it jumped up and back on every
       redraw, and with focus now kept on the control in use (above), the
       browser's scroll anchoring held that control where the short strip had
       left it: each OS switch between light and dark scrolled a company page
       44px further, until the control sat under the strip. The state it had
       is its state until the observer below says otherwise. */
    if (stripWasStuck) { strip.classList.add('is-stuck'); document.documentElement.classList.add('strip-stuck'); }
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

  /* Scroll boxes the keyboard can reach (fitScrollStops): now, before focus
     is handed back, so a box in focus is found again as the Tab stop it was;
     then whenever the page changes size — a chart or a map drawn a moment
     later, the filings landing, a disclosure opened, the phone turned. */
  scrollStopSizer?.disconnect();
  fitScrollStops();
  scrollStopSizer = new ResizeObserver(queueScrollStops);
  scrollStopSizer.observe(section);
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
