/* ==========================================================================
   PLANS AND ENTITLEMENTS
   The free-to-paid boundary is enforced in code, not described in marketing.
   The intent is that the free tier delivers one complete small success rather
   than a page of locked controls — so what free users get is whole, just
   bounded in quantity.
   ========================================================================== */
const PLANS = {
  free: {
    id:'free', name:'Free', tagline:'Acquisition and trust', priceMo:0, priceYr:0,
    blurb:'A complete small success: research a handful of companies properly, track one list and one portfolio, and model a property by hand.',
    limits:{ reportsPerMonth:5, watchlists:1, watchlistStocks:25, portfolios:1, holdings:10,
             compare:2, screenerFields:8, percentileMode:false, savedScreens:1,
             valuationEditable:false, exports:false, fundamentalAlerts:false, priceAlerts:3,
             propertyCalculator:true, propertyReports:0, crossAsset:false, priceDelayMin:15 },
  },
  pro: {
    id:'pro', name:'Equities Research', tagline:'The recurring research subscription', priceMo:29, priceYr:299,
    founding:199, foundingSeats:500, foundingName:'Founding Research',
    /* "Unlimited company research" was true about the report limit and false
       about everything a reader would take from it. Unlimited access to a
       universe of this size is a statement about a cap, not about breadth, and
       phrasing it as breadth is the kind of claim this product refuses
       everywhere else. The count is appended at render time from the universe
       actually loaded, so the sentence cannot drift from it. */
    blurb:'Every company in the beta universe, editable valuation assumptions, the full screener, comparison, multiple portfolios and watchlists, fundamental alerts and exports. Research only — no recommendations, no ratings, no target prices.',
    limits:{ reportsPerMonth:Infinity, watchlists:20, watchlistStocks:100, portfolios:20, holdings:100,
             compare:5, screenerFields:Infinity, percentileMode:true, savedScreens:50,
             valuationEditable:true, exports:true, fundamentalAlerts:true, priceAlerts:100,
             propertyCalculator:true, propertyReports:0, crossAsset:false, priceDelayMin:0 },
  },
  all: {
    /* Not launched. Kept in the registry so the entitlement map stays complete
       and a later launch is a flag change rather than a rebuild, but never
       offered — a tier a user cannot obtain must not appear purchasable. */
    id:'all', name:'All-Access', launched:false,
    tagline:'Cross-asset — not launched. Introduce only after both products show demand', priceMo:79, priceYr:699,
    blurb:'Everything in Equities Research, plus the property portfolio, two standard property reports a month, and the consolidated net-worth view.',
    limits:{ reportsPerMonth:Infinity, watchlists:20, watchlistStocks:100, portfolios:20, holdings:100,
             compare:5, screenerFields:Infinity, percentileMode:true, savedScreens:50,
             valuationEditable:true, exports:true, fundamentalAlerts:true, priceAlerts:100,
             propertyCalculator:true, propertyReports:2, crossAsset:true, priceDelayMin:0 },
  },
};
const PROPERTY_REPORT_PRICE = { basic:19, full:49, verified:89 };

/* The single pricing surface. Anything that displays a price reads this, so a
   change lands everywhere at once and two pages cannot drift apart again. */
const PRICING = {
  free:     { name:'Free', price:'RM0',
              line:`${PLANS.free.limits.reportsPerMonth} company reports a month` },
  founding: { name:PLANS.pro.foundingName, price:`RM${PLANS.pro.founding}`,
              period:'for the first year',
              line:`Limited to ${PLANS.pro.foundingSeats} members. Renews at RM${PLANS.pro.priceYr} a year.` },
  standard: { name:PLANS.pro.name, price:`RM${PLANS.pro.priceMo}`, period:'a month',
              line:`Or RM${PLANS.pro.priceYr} a year after the beta.` },
  property: { name:'Property report', price:`RM${PROPERTY_REPORT_PRICE.basic}`, period:'and up',
              line:`Saved analysis RM${PROPERTY_REPORT_PRICE.basic} · full report RM${PROPERTY_REPORT_PRICE.full} · verified RM${PROPERTY_REPORT_PRICE.verified}.` },
};

const State = {
  view: 'home',
  discoverTab: 'screener',
  researchTab: 'snapshot',
  ticker: 'AAPL',
  /* Malaysia-first, so a Malaysian browser starts in ringgit. USD remains
     available as a reporting currency; this is the default, not a restriction.
     Detected from the browser's own locale and time zone rather than assumed,
     and any stored preference overrides it. */
  baseCcy: store.read('baseCcy', (() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const langs = [navigator.language, ...(navigator.languages || [])].join(' ');
      if (tz === 'Asia/Kuala_Lumpur' || tz === 'Asia/Kuching' || /-MY/i.test(langs)) return 'MYR';
    } catch { /* locale unavailable — fall through */ }
    return 'USD';
  })()),
  /* Null until the reader chooses, so it follows the base currency rather than
     pinning itself to whatever the base happened to be on first visit. */
  screenCcy: store.read('screenCcy', null),
  theses: store.read('theses', null),
  savedScreens: store.read('savedScreens', []),
  screen: null,
  recentCompanies: store.read('recentCompanies', []),
  /* The user's own area observations. Local to this browser, never sent
     anywhere, and carrying no redistribution right. */
  observations: store.read('observations', []),
  lang: store.read('lang', 'en'),
  /* Sarawak exposure records — the user's own research, local to this browser. */
  sarawakExposure: store.read('sarawakExposure', []),
  /* Seeded with two, not three. The page states the limit from the plan — two
     on Free — and then displayed three, so the copy and the contents
     contradicted each other on first load. The stored value is clamped on
     read as well, further down, so an existing saved set of three cannot
     reintroduce the contradiction after a downgrade. */
  compare: store.read('compare', ['MAYBANK', 'PBBANK']),
  valuation: {},

  /* Multiple watchlists and portfolios. The single-list shape used earlier is
     migrated into the first entry so existing saved data is not lost. */
  watchlists: store.read('watchlists', null) || [
    { id:'wl-1', name:'Core watchlist',
      ids: store.read('watchlist', ['AAPL', 'MAYBANK', 'PBBANK', 'NVDA', 'AXREIT', 'TENAGA']) },
    { id:'wl-2', name:'Bursa income', ids:['MAYBANK', 'PBBANK', 'PETGAS', 'KLCC', 'IGBREIT'] },
  ],
  wlIdx: 0,
  portfolios: store.read('portfolios', null),
  pfIdx: 0,
  priceAlerts: store.read('priceAlerts', [
    { id:'pa-1', ticker:'AAPL', op:'<', price:190, note:'Revisit if it reaches the base-case range' },
    { id:'pa-2', ticker:'MAYBANK', op:'>', price:11.50, note:'Above my bull case' },
  ]),
};

/* --------------------------------------------------------- entitlements */
State.plan = store.read('plan', 'free');
State.reportLog = store.read('reportLog', { month: new Date().toISOString().slice(0, 7), ids: [] });
State.propertyReportsBought = store.read('propertyReportsBought', []);

const planOf = () => PLANS[State.plan] || PLANS.free;
const lim = (k) => planOf().limits[k];
/* Enforced once, at the point the value is used, so the stated cap and the
   contents can never disagree — including for a workspace saved under a
   higher plan and opened under a lower one. */
State.compare = (State.compare || []).slice(0, lim('compare'));

const LIMITS = new Proxy({}, {                     /* workspace caps now follow the plan */
  get: (_, k) => ({ watchlists:lim('watchlists'), watchlistStocks:lim('watchlistStocks'),
                    portfolios:lim('portfolios'), holdings:lim('holdings'),
                    priceAlerts:lim('priceAlerts'), compare:lim('compare') })[k],
});

/* Company reports are metered per calendar month on the free plan. Opening a
   company already read this month never costs another report. */
function reportAllowed(id) {
  const month = new Date().toISOString().slice(0, 7);
  if (State.reportLog.month !== month) State.reportLog = { month, ids: [] };
  if (State.reportLog.ids.includes(id)) return { ok: true, counted: false };
  if (State.reportLog.ids.length < lim('reportsPerMonth')) return { ok: true, counted: true };
  return { ok: false, counted: false };
}
function noteReportRead(id) {
  const r = reportAllowed(id);
  if (r.ok && r.counted) {
    State.reportLog.ids = [...State.reportLog.ids, id];
    store.write('reportLog', State.reportLog);
  }
  return r.ok;
}
const reportsLeft = () => Math.max(0, lim('reportsPerMonth') - State.reportLog.ids.length);

function setPlan(id) {
  State.plan = id; store.write('plan', id);
  toast(`Switched to ${PLANS[id].name} — no payment was taken, this is a prototype`);
  render();
}

/* An upgrade prompt that names the limit rather than hiding behind a paywall. */
function upsell(title, detail) {
  const box = el('div', { class: 'card', style: 'border-left:3px solid var(--bronze)' });
  box.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:6px' }, [
    el('span', { class: 'chip chip-bronze' }, planOf().name),
    el('h3', { class: 'h-card' }, title),
  ]));
  box.append(el('p', { class: 'body', style: 'font-size:13px;margin-bottom:var(--sm)' }, detail));
  box.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => go('plans') }, 'See plans'),
    el('span', { class: 'metaline' }, 'No payment is processed in this prototype.'),
  ]));
  return box;
}

/* State.watchlist stays readable as the active list, so every existing read
   site keeps working; only mutation goes through the helpers below. */
Object.defineProperty(State, 'watchlist', {
  get() { return (this.watchlists[this.wlIdx] || this.watchlists[0] || { ids: [] }).ids; },
});
const activeWL = () => State.watchlists[State.wlIdx] || State.watchlists[0];
const saveWatchlists = () => store.write('watchlists', State.watchlists);
const activePF = () => State.portfolios[State.pfIdx] || State.portfolios[0];
const savePortfolios = () => store.write('portfolios', State.portfolios);
const savePriceAlerts = () => store.write('priceAlerts', State.priceAlerts);

/* Indicative FX for the cross-market view. The sample rate is fixed so the
   synthetic dataset stays reproducible; a supplied price file that carries
   USDMYR replaces it at load and says where the number came from. Every US
   figure shown in MYR passes through this one number, so a stale rate misstates
   the whole cross-market view rather than one field. */
const FX = { USDMYR: 4.42, asOf: '30 Jul 2026 17:00 MYT', source: 'sample', personal: false };
let fxRejected = null;

/* Illustrative dividend withholding, per market of listing. These are user
   inputs, not tax advice and not a lookup of anyone's actual position — the
   rate that applies depends on residency, account type and any treaty. The
   product shows gross first and never replaces it with a net figure. */
State.wht = store.read('wht', { US: 30, MY: 0 });
const netYield = (grossPct, mkt) => isNum(grossPct) ? grossPct * (1 - (State.wht[mkt] ?? 0) / 100) : null;
const toBase = (v, ccy) => {
  if (!isNum(v)) return null;
  if (State.baseCcy === ccy) return v;
  return State.baseCcy === 'MYR' ? v * FX.USDMYR : v / FX.USDMYR;
};
const baseSym = () => State.baseCcy === 'MYR' ? 'RM' : '$';

/* Convert between the two currencies this product knows about, to a named
   target rather than to whatever the global base happens to be. toBase above
   answers "in the currency I read in"; this answers "in this currency", which
   is a different question and the one a mixed table has to settle explicitly. */
const convertTo = (v, from, to) => {
  if (!isNum(v)) return null;
  if (from === to) return v;
  if (from === 'USD' && to === 'MYR') return v * FX.USDMYR;
  if (from === 'MYR' && to === 'USD') return v / FX.USDMYR;
  return null;                      /* a pair with no rate is not guessed */
};

/* The screener's own reporting currency, separate from the global base. Starts
   at whatever the reader already reads in rather than at a fixed default. */
const screenCcy = () => State.screenCcy || State.baseCcy;

