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
       offered — a tier a user cannot obtain must not appear purchasable. The
       plans page shows it marked not on sale, at a proposed price, and its
       button previews the entitlements in this browser as every card's
       button does (VIEWS.plans, 90-area-screen.js) — since the launch audit
       no plan is on sale, so every paid tier is a proposal and a preview.
       Whether that preview should be reachable at all is an open product
       decision. */
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

/* PLANS and PROPERTY_REPORT_PRICE are the pricing surface: the plans page
   and every offer read them. A second table, PRICING, held the same prices
   as sales lines — "Limited to 500 members. Renews at RM299 a year." — and
   nothing read it; with no plan on sale (launch audit, 29 Sep 2026) a
   renewal line waiting to be surfaced was a purchase claim in waiting, so it
   is gone rather than kept in step. */

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
      if (tz === 'Asia/Kuala_Lumpur' || tz === 'Asia/Kuching' || /-MY\b/i.test(langs)) return 'MYR';
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

/* THE ACTIVE WATCHLIST IS REMEMBERED. wlIdx was a plain field, never stored,
   so every reload, new tab or shared link made the first list active again:
   a company page that read "Add to watchlist" for the list the reader had
   just made read "✓ On your watchlist" after a reload — it was showing the
   first list — and pressing it removed the company from that one. Every
   change of the active list goes through this setter, which keeps the
   list's id (not its place, which a deletion shifts); the id is resolved
   back to a place once the lists are read (06-watchlists.js). */
{
  let wlIdx = State.wlIdx;
  Object.defineProperty(State, 'wlIdx', { enumerable: true, configurable: true,
    get: () => wlIdx,
    set(i) { wlIdx = i; const w = State.watchlists?.[i]; if (w?.id) store.write('wlActive', w.id); } });
}

/* --------------------------------------------------------- entitlements */
State.plan = store.read('plan', 'free');
/* The reader's calendar month, on their own clock. The meter keyed on
   toISOString — the UTC month — so in Malaysia September's allowance ran on
   until 08:00 on 1 October, and a reader who had used it was told at 01:00
   that they had used all their reports "this month". */
const meterMonth = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
State.reportLog = store.read('reportLog', { month: meterMonth(), ids: [] });
State.propertyReportsBought = store.read('propertyReportsBought', []);

const planOf = () => PLANS[State.plan] || PLANS.free;
const lim = (k) => planOf().limits[k];
/* Enforced once, at the point the value is used, so the stated cap and the
   contents can never disagree — including for a workspace saved under a
   higher plan and opened under a lower one. */
const clampToPlan = () => { State.compare = (State.compare || []).slice(0, lim('compare')); };
clampToPlan();

const LIMITS = new Proxy({}, {                     /* workspace caps now follow the plan */
  get: (_, k) => ({ watchlists:lim('watchlists'), watchlistStocks:lim('watchlistStocks'),
                    portfolios:lim('portfolios'), holdings:lim('holdings'),
                    priceAlerts:lim('priceAlerts'), compare:lim('compare') })[k],
});

/* Company reports are metered per calendar month on the free plan. Opening a
   company already read this month never costs another report. */
function reportAllowed(id, now = new Date()) {
  const month = meterMonth(now);
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

/* WHERE FOCUS GOES WHEN A REDRAW TAKES THE CONTROL AWAY.
   render() replaces the whole view, so a button whose action redraws the
   page destroys itself under the keyboard, and focus fell to <body>: a
   screen reader lost its place and the next Tab started again from the top.
   Where the same control comes back under the same id, renderKeepFocus
   (40-views-discover.js) hands focus back to it. Where the action changes
   what is there — a button that comes back as the disabled "Current plan",
   a record that is gone, an offer that has been taken up — focus goes to the
   first of `targets` the redrawn page holds (a selector, an element, or a
   function that finds one), and to <main> only when there is none. A heading
   or a card takes tabindex=-1, so it can hold focus without joining the Tab
   order. */
function focusAfterRedraw(...targets) {
  for (const t of targets) {
    const n = typeof t === 'function' ? t() : typeof t === 'string' ? document.querySelector(t) : t;
    if (!n || !n.isConnected) continue;
    if (!n.matches('a[href], button, input, select, textarea, summary, [tabindex]')) n.setAttribute('tabindex', '-1');
    n.focus();
    if (document.activeElement === n) return n;
  }
  focusMain();
  return null;
}

function setPlan(id) {
  State.plan = id; store.write('plan', id);
  /* And again when the plan changes in the session. Enforced at load only,
     a switch from Equities Research to Free left five companies in a
     comparison that the page, a click later, said holds up to two. */
  clampToPlan();
  /* A tier that is not on sale is previewed, not switched to: "Switched to
     All-Access" read as a plan the reader now had. Since the launch audit
     (29 Sep 2026) no tier is on sale, so "Switched to Equities Research — no
     payment was taken" read the same way: every paid tier is previewed, and
     the toast says so; going back to Free is only that. */
  const pl = PLANS[id];
  toast(id === 'free' ? `Back on ${pl.name} in this browser`
    : pl.launched === false ? `Previewing ${pl.name} in this browser — it has not launched and cannot be bought`
    : `Previewing ${pl.name} in this browser — plans are not on sale yet, and nothing was charged`);
  /* The button pressed on /pricing comes back from the redraw as the
     disabled "Current plan", which cannot hold focus, so a keyboard reader
     who switched plan was left on <body>. Focus goes to the heading of the
     plan now in force — the card the button was in, now marked Current. */
  const pressed = document.activeElement;
  render();
  if (pressed && pressed !== document.body && !pressed.isConnected)
    focusAfterRedraw(() => $$('#views .card h3').find(h => h.textContent.trim() === PLANS[id].name));
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
    /* Outline: a plan prompt is never the page's primary action — on the
       property calculator it was the only filled button, at the page's end. */
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('plans') }, 'See plans'),
    /* Said as the pricing page says it: nothing is on sale, not merely
       unpaid in a prototype. */
    el('span', { class: 'metaline' }, 'Plans are not on sale yet — nothing can be bought.'),
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
/* A sample rate has no observation time. It was stamped "17:00 MYT" like a
   fixing, which is what a reader takes a time-of-day for. */
const FX = { USDMYR: 4.42, asOf: null, source: 'sample', personal: false };
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

