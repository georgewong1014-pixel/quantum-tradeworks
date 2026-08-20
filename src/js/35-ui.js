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

function marketChip(mkt) {
  return el('span', { class: 'chip ' + (mkt === 'US' ? 'chip-us' : 'chip-my') }, mkt === 'US' ? 'US' : 'MY');
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
  return `${AS_OF} 17:00 ${c.mkt === 'US' ? 'ET' : 'MYT'}`;
}

/* Freshness + lineage, shown on every analytical surface. */
function provenance(row, extra = []) {
  const { c, m } = row;
  /* AS_OF is the sample set's fixed stamp. A company carrying a real supplied
     price has its own date, and showing the sample stamp next to it would
     misdate the number on every analytical surface. */
  const priceStamp = priceAsOfLabel(c);
  const bits = [
    `<b>Price</b> ${priceStamp}`,
    `<b>Period</b> FY${last(YEARS)} reported`,
    `<b>Currency</b> ${c.ccy}`,
    `<b>Coverage</b> <span title="Computable ÷ applicable metrics${m.inapplicable ? `. ${m.inapplicable} dictionary metrics do not apply to this business model and are excluded from the denominator rather than counted as missing.` : ''}">${m.coverage}%${m.inapplicable ? ` <span style="color:var(--ink-3)">(${m.inapplicable} n/a)</span>` : ''}</span>`,
    ...extra,
  ];
  return el('div', { class: 'prov', html: bits.join('<span class="dotsep"></span>') });
}

function tickerCell(row) {
  const b = el('button', { class: 'tickerbtn', onclick: () => openResearch(row.c.id) });
  b.append(el('span', { class: 'tk' }, row.c.tk));
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

function emptyState(text) {
  return el('div', { class: 'emptystate', html: `${icon('search', 30)}<p>${esc(text)}</p>` });
}

/* ------------------------------------------------------------ drawer/toast */
const scrim = $('#scrim'), drawer = $('#drawer'), drawerBody = $('#drawerBody'), drawerTitle = $('#drawerTitle');
let lastFocus = null;

function openDrawer(title, node) {
  lastFocus = document.activeElement;
  drawerTitle.textContent = title;
  drawerBody.replaceChildren(node);
  drawer.hidden = false;
  requestAnimationFrame(() => { drawer.dataset.open = '1'; scrim.dataset.open = '1'; });
  $$('[data-close-drawer]', drawer)[0]?.focus();
}
function closeDrawer() {
  drawer.dataset.open = '0'; scrim.dataset.open = '0';
  setTimeout(() => { drawer.hidden = true; lastFocus?.focus(); }, 300);
  closeSearch();
}
scrim.addEventListener('click', closeDrawer);
$$('[data-close-drawer]').forEach(b => b.addEventListener('click', closeDrawer));

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

   Five destinations, not eleven. The previous header gave equal weight to
   Home, Compare, Thesis, Portfolio, Alerts, Tracked and Plans, which made
   nothing look important. Compare belongs inside Research, the four personal
   surfaces belong together, and pricing is reached from the call to action
   and the footer rather than competing with the product.
   ========================================================================== */
const NAV = [
  { id:'discover',  label:'Discover',       icon:'grid',      path:'/discover' },
  { id:'research',  label:'Research',       icon:'chart',     path:'/research' },
  { id:'my',        label:'My Investments', icon:'briefcase', path:'/my/portfolio' },
  { id:'property',  label:'Property',       icon:'home',      path:'/property' },
  { id:'learn',     label:'Learn',          icon:'book',      path:'/learn' },
];

/* Views reachable by URL but not in the header. */
const SUBNAV_MY = [
  { id:'portfolio',  label:'Portfolio',  path:'/my/portfolio' },
  { id:'watchlists', label:'Watchlists', path:'/my/watchlists' },
  { id:'thesis',     label:'Investment cases', path:'/my/theses' },
  { id:'alerts',     label:'Alerts',     path:'/my/alerts' },
  { id:'tracked',    label:'Tracked',    path:'/my/tracked' },
  { id:'userdata',   label:'Your data',  path:'/my/data' },
];

const VIEWS = {};
const viewRoot = $('#views');

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

function companyFromSlug(s) {
  if (!s) return null;
  const raw = decodeURIComponent(s).toUpperCase();
  if (BY_ID.has(raw)) return raw;

  const head = raw.split('-')[0];
  if (BY_ID.has(head)) return head;
  if (BY_ID.has(`${head}-SEC`)) return `${head}-SEC`;
  /* -SEC ids carry their own hyphen, so the first two segments may be the id. */
  const two = raw.split('-').slice(0, 2).join('-');
  if (BY_ID.has(two)) return two;

  /* Then the listing code and the ticker. Scanned rather than indexed because
     companies load asynchronously and a map built at startup would miss every
     SEC-filed company. The universe is small enough that this is free. */
  const hit = U.find(r => String(r.c.code || '').toUpperCase() === head
                       || String(r.c.tk || '').toUpperCase() === head);
  return hit ? hit.c.id : null;
}

const ROUTES = [
  { path: '/',                    view: 'marketing', title: 'Quantum Tradeworks — research the company, test the property' },
  { path: '/app',                 view: 'home',      title: 'Dashboard' },
  { path: '/welcome',             view: 'onboarding',title: 'Get started' },
  { path: '/discover',            view: 'discover',  title: 'Discover' },
  { path: '/discover/screener',   view: 'discover',  tab: 'screener',  title: 'Screener' },
  { path: '/discover/value-map',  view: 'discover',  tab: 'radar',     title: 'Quality vs Value Map' },
  { path: '/research',            view: 'researchHome', title: 'Research' },
  { path: '/company/:id',         view: 'research',  title: 'Company report' },
  { path: '/compare',             view: 'compare',   title: 'Compare' },
  { path: '/my/portfolio',        view: 'portfolio', title: 'Portfolio' },
  { path: '/my/watchlists',       view: 'watchlists',title: 'Watchlists' },
  { path: '/my/theses',           view: 'thesis',    title: 'My investment cases' },
  { path: '/my/alerts',           view: 'alerts',    title: 'Alerts' },
  { path: '/my/tracked',          view: 'tracked',   title: 'Tracked' },
  { path: '/start',               view: 'launcher',  title: 'Start with your goal' },
  { path: '/my/data',             view: 'userdata',  title: 'Your data' },
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
  { path: '/trading-index',       view: 'tradingIndex', title: 'QT Trading Index' },
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
  marketing: 'Transparent research tools for Bursa Malaysia and US equities, plus property cash-flow analysis built for Malaysian investors.',
  discover:  'Screen Bursa Malaysia and US companies on quality, financial strength and valuation — every filter and every metric explained.',
  research:  'A company report where every number shows its formula, its period and its source.',
  researchHome: 'A way into the universe by company, market or business model — never a company chosen for you.',
  sarawak: 'Companies with material exposure to the Sarawak economy. Inclusion is descriptive and does not indicate preference.',
  compare:   'Compare companies using the measures that fit their business model, not a single generic table.',
  property:  'Model a Malaysian property purchase to its real monthly cash flow, break-even rent and cash required upfront.',
  tradingIndex: 'A multi-timeframe trend reading and a test of your own first-tranche rules, from chart evidence you record yourself.',
  learn:     'How the metrics are defined, how the models are chosen, and what the data does and does not cover.',
  plans:     'Plans and pricing for Quantum Tradeworks research and property reports.',
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
  const name = route?.view === 'research' && State.ticker && BY_ID.get(State.ticker)
    ? `${BY_ID.get(State.ticker).c.tk} — ${BY_ID.get(State.ticker).c.name}`
    : (route?.title || 'Not found');
  document.title = route?.path === '/' ? route.title : `${name} · Quantum Tradeworks`;
  const desc = META[route?.view] || META.marketing;
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', 'description'); document.head.append(tag); }
  tag.setAttribute('content', desc);
  let canon = document.querySelector('link[rel="canonical"]');
  if (!canon) { canon = document.createElement('link'); canon.setAttribute('rel', 'canonical'); document.head.append(canon); }
  canon.setAttribute('href', location.origin + location.pathname);
}

/* Navigate. push=false is for popstate, where the browser already moved. */
function navigate(path, { push = true, replace = false } = {}) {
  const url = href(path) + (path.includes('?') ? '' : location.search.replace(/^\?$/, ''));
  if (replace) history.replaceState({ path }, '', url);
  else if (push && (location.pathname + location.search) !== url) history.pushState({ path }, '', url);
  applyRoute();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function applyRoute() {
  const route = matchRoute(location.pathname);
  if (!route) { State.view = 'notfound'; setDocumentMeta(null); render(); return; }

  /* Onboarding intercepts the dashboard only. Everything else is a legitimate
     entry point: a shared company link, a screener someone was sent, a
     property calculator found by search. Putting a setup sequence in front of
     any of those loses the visitor the link was meant to bring — they asked
     for a specific page, not to start a product. */
  const ENTRY = ['home'];
  if (!onboarded() && ENTRY.includes(route.view)) {
    State.view = 'onboarding';
    setDocumentMeta({ ...route, view: 'onboarding', title: 'Get started' });
    if (location.pathname !== href('/welcome')) history.replaceState({ path: '/welcome' }, '', href('/welcome'));
    render();
    return;
  }
  if (route.params?.id) {
    const id = companyFromSlug(route.params.id);
    if (id) State.ticker = id;
    else { State.view = 'notfound'; State.notFoundWhat = `company “${route.params.id}”`; setDocumentMeta(null); render(); return; }
  }
  if (route.tab) {
    if (route.view === 'discover') State.discoverTab = route.tab;
    if (route.view === 'research') State.researchTab = route.tab;
    if (route.view === 'learn') State.learnTab = route.tab;
  }
  const qs = new URLSearchParams(location.search);
  if (route.view === 'compare' && qs.get('companies')) {
    const ids = qs.get('companies').split(',').map(s => s.trim().toUpperCase()).filter(x => BY_ID.has(x));
    if (ids.length) State.compare = ids.slice(0, lim('compare'));
  }
  if (route.view === 'research' && qs.get('tab')) State.researchTab = qs.get('tab');
  State.view = route.view;
  setDocumentMeta(route);
  render();
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
    navigate(companyPath(c) + (opts.tab ? `?tab=${opts.tab}` : ''));
    return;
  }
  const r = ROUTES.find(x => x.view === view && (!opts.tab || x.tab === opts.tab))
         || ROUTES.find(x => x.view === view && !x.path.includes(':'));
  navigate(r ? r.path : '/app');
}
function openResearch(id, tab) {
  State.ticker = id;
  const row = BY_ID.get(id);
  navigate(companyPath(row ? row.c : id) + (tab && tab !== 'snapshot' ? `?tab=${tab}` : ''));
}

function buildNav() {
  const nav = $('#mainnav');
  /* Real anchors, so the whole browser contract works: middle-click, open in
     a new tab, copy link address, and the status bar showing where it goes. */
  nav.replaceChildren(...NAV.map(n => {
    const active = State.view === n.id
      || (n.id === 'my' && SUBNAV_MY.some(s => s.id === State.view))
      || (n.id === 'research' && State.view === 'compare');
    return el('a', {
      class: 'navlink', href: href(n.path), 'aria-current': active ? 'page' : null,
      onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(n.path); },
    }, n.label);
  }));
}

let stickyObserver = null;
let stickySizer = null;
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
  'watchlists', 'thesis', 'alerts', 'tracked', 'sarawak', 'plans',
]);

function bootSkeleton() {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const card = el('div', { class: 'card' });
  card.append(el('p', { class: 'eyebrow' }, 'Loading filings'));
  card.append(el('h2', { class: 'h-card', style: 'margin-top:4px' }, 'Reading the audited statements'));
  card.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px;max-width:60ch' },
    'Annual statements for the US companies are being fetched from SEC EDGAR. This page waits for them '
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
  const node = (realPending && UNIVERSE_VIEWS.has(State.view))
    ? bootSkeleton()
    : (VIEWS[State.view] ? VIEWS[State.view]() : el('div', {}, 'Not found'));
  const section = el('section', { class: 'view', data: { active: '1' } }, el('div', { class: 'shell' }, node));
  viewRoot.replaceChildren(section);

  /* The dock is mounted at body level, not inside the view. A fixed element is
     positioned against the viewport only while no ancestor establishes a
     containing block, and any future transform, filter or `contain` on a view
     wrapper would silently turn it into an absolutely positioned box halfway
     down the page. Mounting it outside removes the possibility rather than
     relying on nobody adding one.

     Skipped while the universe is loading: a dock is a summary of the page
     below it, and there is no page below a skeleton yet. */
  document.querySelectorAll('.dock').forEach(n => n.remove());
  const dockSpec = (!realPending || !UNIVERSE_VIEWS.has(State.view)) ? DOCKS[State.view]?.() : null;
  if (dockSpec) { document.body.append(decisionDock(dockSpec)); viewRoot.dataset.dock = '1'; }
  else delete viewRoot.dataset.dock;
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
  const strip = $('.ticker-sticky', section);
  if (strip) {
    const sentinel = strip.previousElementSibling;
    if (sentinel) {
      stickyObserver = new IntersectionObserver(([e]) => {
        strip.classList.toggle('is-stuck', !e.isIntersecting);
      }, { rootMargin: `-${parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) + 8}px 0px 0px 0px`, threshold: 0 });
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
