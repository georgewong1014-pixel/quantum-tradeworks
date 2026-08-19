/* ==========================================================================
   SEARCH · THEME · BOOT
   ========================================================================== */

const searchModal = $('#searchModal'), searchInput = $('#searchInput'), searchResults = $('#searchResults');

function openSearch() {
  searchModal.hidden = false;
  requestAnimationFrame(() => { searchModal.dataset.open = '1'; scrim.dataset.open = '1'; searchInput.focus(); searchInput.select(); });
  runSearch('');
}
function closeSearch() {
  searchModal.dataset.open = '0';
  setTimeout(() => searchModal.hidden = true, 200);
  if (drawer.dataset.open !== '1') scrim.dataset.open = '0';
}
function runSearch(q) {
  const term = q.trim().toLowerCase();
  const hits = U.filter(r => !term
    || r.c.tk.toLowerCase().includes(term) || r.c.id.toLowerCase().includes(term)
    || r.c.name.toLowerCase().includes(term) || r.c.sector.toLowerCase().includes(term)
    || r.c.industry.toLowerCase().includes(term)).slice(0, 10);
  searchResults.replaceChildren(...(hits.length ? hits.map(r => {
    const b = el('button', { class: 'row', style: 'width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:9px 10px;gap:10px;border-radius:var(--r-sm)',
      onclick: () => { closeSearch(); openResearch(r.c.id); } });
    b.addEventListener('pointerenter', () => b.style.background = 'color-mix(in srgb, var(--brand) 8%, transparent)');
    b.addEventListener('pointerleave', () => b.style.background = 'none');
    const nm = el('div', { style: 'min-width:0;flex:1' });
    nm.append(el('div', { class: 'row', style: 'gap:6px' }, [
      el('span', { style: 'font-size:13px;font-weight:600' }, r.c.tk), marketChip(r.c.mkt),
      el('span', { class: 'metaline' }, r.c.exch)]));
    nm.append(el('div', { class: 'metaline', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, `${r.c.name} · ${r.c.sector}`));
    b.append(nm);
    b.append(el('span', { class: 'num', style: 'font-size:13px;font-weight:600' }, fmtMoney(r.c.px.p, r.c.ccy)));
    b.append(el('span', { class: 'num ' + signClass(r.c.px.d1), style: 'font-size:12px;min-width:48px;text-align:right' }, withSign(r.c.px.d1, 2)));
    return b;
  }) : []));

  /* Pages, not only companies. Search indexed the universe and nothing else, so
     "wheel" answered "No company matches that search" while the Cash Wheel
     workspace sat two clicks away with no inbound link — the search box
     confirmed the feature did not exist. Every route already carries a title,
     so this is a filter over data that was there all along. */
  const routeHits = !term ? [] : ROUTES.filter(rt =>
    !rt.path.includes(':') && (rt.title.toLowerCase().includes(term) || rt.path.toLowerCase().includes(term)))
    /* Aliases share a title with their canonical route; show each page once. */
    .filter((rt, i, a) => a.findIndex(x => x.view === rt.view && x.title === rt.title) === i)
    .slice(0, 6);
  if (routeHits.length) {
    searchResults.append(el('p', { class: 'eyebrow', style: 'padding:10px 10px 4px' }, 'Pages'));
    routeHits.forEach(rt => {
      const a = el('a', { class: 'row', href: href(rt.path),
        style: 'width:100%;text-decoration:none;padding:9px 10px;gap:10px;border-radius:var(--r-sm)',
        onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
          e.preventDefault(); closeSearch(); navigate(rt.path); } });
      a.addEventListener('pointerenter', () => a.style.background = 'color-mix(in srgb, var(--brand) 8%, transparent)');
      a.addEventListener('pointerleave', () => a.style.background = 'none');
      a.append(el('div', { style: 'min-width:0;flex:1' }, [
        el('div', { style: 'font-size:13px;font-weight:600' }, rt.title),
        el('div', { class: 'metaline' }, rt.path),
      ]));
      searchResults.append(a);
    });
  }
  if (!hits.length && !routeHits.length)
    searchResults.append(emptyState('Nothing matches that search — no company, and no page.'));
}
searchInput.addEventListener('input', e => runSearch(e.target.value));
$('#openSearch').addEventListener('click', openSearch);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSearch(); if (drawer.dataset.open === '1') closeDrawer(); }
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
});

/* ------------------------------------------------------------------ theme */
const themeToggle = $('#themeToggle');
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';

function currentTheme() {
  return document.documentElement.dataset.theme
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.write('theme', t);
  $('#themeIcon').innerHTML = t === 'dark' ? SUN : MOON;
  themeToggle.setAttribute('aria-label', t === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme');
  /* charts read their colours from CSS custom properties, so redraw them */
  requestAnimationFrame(() => render());
}
themeToggle.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'));

const savedTheme = store.read('theme', null);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$('#themeIcon').innerHTML = currentTheme() === 'dark' ? SUN : MOON;

/* ------------------------------------------------------------------- boot */
const refreshSearchLabel = () => {
  /* No number while the filings are in flight. Writing "36" and correcting it to
     "138" a second later states a figure the product is about to contradict,
     and the static markup already says "Search companies…" — which is true in
     both states. */
  $('#searchLabel').textContent = realPending ? 'Search companies…' : `Search ${U.length} companies…`;
  $('#openSearch').setAttribute('aria-label', realPending ? 'Search companies' : `Search ${U.length} companies`);
};

/* The banner used to say every figure on the site was synthetic. That was true
   when the universe was 36 illustrative companies and became false the moment
   audited filings loaded alongside them — a disclosure that overstates the
   problem is still a disclosure that is wrong, and on this product being wrong
   about provenance is the worst kind. It now counts what is actually loaded and
   says which of the two a reader is looking at. */
const refreshDisclosure = () => {
  const node = $('#disclosureText');
  if (!node) return;
  const real = U.filter(r => r.c.real).length;
  const sample = U.length - real;
  const priced = U.filter(r => r.c.real && isNum(r.c.px?.p)).length;
  /* A failed fetch used to fall through to the static wording, which describes a
     sample-only build without saying that this one was meant to be more. The
     reader then saw 36 illustrative companies presented as the whole product,
     permanently, with nothing indicating a load had failed. */
  if (!real && realStatus && realStatus.ok === false) {
    node.innerHTML =
      `<strong>Beta preview — filings did not load.</strong> Do not use figures here for investment decisions.`
      + `<span class="disclosure-long"> The audited SEC statements this build normally carries could not be fetched`
      + `, so only the ${U.length} illustrative companies are loaded and every figure on the site is synthetic.`
      + ` Reload to try again.</span>`;
    return;
  }
  if (!real) return;                       /* the static wording is correct */
  /* Counted by the manifest, not here. This banner sits on every page, so a
     count of its own would be the one most likely to disagree with the rest. */
  const k = coverage();
  /* The banner sits on every page, so while the audited set is in flight it is
     the single largest source of wrong counts on the site — five of them, on
     whatever route the reader happened to open. The warning itself does not
     depend on the counts, so it is stated in full and the arithmetic waits. */
  if (!k.resolved) {
    node.innerHTML =
      `<strong>Beta preview — mixed sources.</strong> Do not use figures here for investment decisions.` +
      `<span class="disclosure-long"> ${COVERAGE_PENDING} — this build mixes audited SEC filings with illustrative figures, `
      + `and the exact split is stated here once the audited set has loaded. Every company page states which it is.</span>`;
    return;
  }
  node.innerHTML =
    `<strong>Beta preview — mixed sources.</strong> Do not use figures here for investment decisions.` +
    `<span class="disclosure-long"> ${k.filed} ${k.filed === 1 ? 'company carries' : 'companies carry'} audited statements filed with the SEC` +
    (k.filedUnpriced ? `, of which ${k.filedUnpriced} ${k.filedUnpriced === 1 ? 'has' : 'have'} no price because market data is not licensed for this build` : '') +
    `. ${k.illustrative} ${k.illustrative === 1 ? 'carries' : 'carry'} illustrative figures that are synthetic` +
    (k.usIllustrative ? `, and ${k.usIllustrative === 1 ? 'one of those is a US listing' : `${k.usIllustrative} of those are US listings`} rather than Bursa` : '') +
    `. Every company page states which it is.</span>`;
};

/* Real data loads asynchronously and changes the size of the universe. The
   universe-dependent views therefore wait rather than painting the sample set
   and correcting themselves a second later — see the note above render(). */
realPending = realEnabled();
if (realEnabled()) {
  loadRealData()
    .then(res => {
      realStatus = { ok: true, ...res };
      realPending = false;
      refreshSearchLabel();
      refreshDisclosure();
      /* A deep link can name a company that did not exist at first paint, so
         the route is resolved again once the filings are in. applyRoute
         re-renders, so no separate render call is needed. */
      applyRoute();
      console.info(`real data: +${res.added} SEC-filed companies`);
    })
    .catch(err => {
      realStatus = { ok: false, error: err.message };
      /* The fetch failed, so the sample set is now the only thing there is.
         Painting it, honestly labelled, beats a skeleton that waits forever —
         and realStatus carries the failure so the page can say what happened. */
      realPending = false;
      refreshSearchLabel();
      render();
      console.warn('real data failed to load:', err.message);
    });
}

/* Through the same function, so the pending case cannot be handled in one place
   and forgotten in the other. This synchronous write is what put "36" on screen
   between DOMContentLoaded and the filings landing. */
refreshSearchLabel();

$('#disclosureMore')?.addEventListener('click', (e) => {
  const open = document.body.dataset.disclosure === 'open';
  if (open) delete document.body.dataset.disclosure;
  else document.body.dataset.disclosure = 'open';
  e.currentTarget.setAttribute('aria-expanded', String(!open));
  e.currentTarget.textContent = open ? 'Which sources?' : 'Hide sources';
});
/* No render() here: the router paints, and painting twice showed the previous
   view for a frame before the routed one replaced it. */
/* Links of the old shape (#research/AAPL/valuation) are already in the wild —
   in notes, in this project's own history, possibly bookmarked. They are
   translated to the equivalent path and the URL is replaced rather than
   pushed, so the back button does not bounce between the two forms. */
const LEGACY_VIEW_PATH = {
  home: '/app', discover: '/discover', compare: '/compare', thesis: '/my/theses',
  portfolio: '/my/portfolio', alerts: '/my/alerts', tracked: '/my/tracked',
  property: '/property', learn: '/learn', plans: '/pricing',
};

function fromHash() {
  const h = location.hash.replace(/^#/, '');
  if (!h) return false;
  const [view, a, b] = h.split('/');
  if (view === 'research' && a) {
    const id = companyFromSlug(a);
    if (id) {
      State.ticker = id;
      navigate(companyPath(BY_ID.get(id).c) + (b && b !== 'snapshot' ? `?tab=${b}` : ''), { replace: true });
      return true;
    }
  }
  const path = LEGACY_VIEW_PATH[view] || (view === 'research' ? '/research' : null);
  if (!path) return false;
  if (view === 'discover' && a) State.discoverTab = a;
  if (view === 'learn' && a) State.learnTab = a;
  navigate(path, { replace: true });
  return true;
}

/* WHICH VIEWS CARRY A DOCK, AND WHAT IT SAYS.
   ---------------------------------------------------------------------------
   Only the long ones. A dock on a page the reader can already see in full is
   an extra 130px of chrome buying nothing, so Learn, Status and the trust
   pages have none.

   Every figure here is recomputed from the same engine the page body used, so
   the dock cannot drift from the card above it — and every one of them is
   withheld rather than zeroed when the input is absent. `blocker` is the
   single most severe open item, not a count of them: a reader who is told
   there are four problems still has to go and find out which one matters. */
const DOCKS = {
  property: () => {
    const d = State.deal, m = dealModel(d), g = propertyGrade(d, m);
    const worst = (g.gates || []).slice().sort((a, b) =>
      (b.severity === 'critical') - (a.severity === 'critical'))[0];
    const queue = propertyReviewQueue(d);
    return {
      figs: [
        { label: 'Safe cash', value: isNum(m.safeCashRequired) ? fmtAmount(m.safeCashRequired, 'MYR') : null },
        { label: 'Monthly position', value: isNum(m.cashflowMonthly) ? fmtAmount(m.cashflowMonthly, 'MYR') : null,
          tone: isNum(m.cashflowMonthly) && m.cashflowMonthly < 0 ? '--dn-text' : '--ok-text' },
        { label: g.verdict || 'Grade', value: g.grade },
      ],
      blocker: worst ? worst.text : null,
      next: queue.length ? {
        label: `Review ${queue.length} sample input${queue.length === 1 ? '' : 's'}`,
        onclick: () => {
          const det = [...document.querySelectorAll('details')]
            .find(x => /Review \d+ sample input/.test(x.querySelector('summary')?.textContent || ''));
          if (!det) return;
          det.open = true;
          det.scrollIntoView({ block: 'center' });
        },
      } : null,
    };
  },

  wheel: () => {
    const p = State.wheel, m = wheelMath(p), fit = wheelFit(p, m, null);
    const entered = num0(p.putStrike) > 0;
    const buffer = entered ? num0(p.eligibleCashUsd) - num0(m.requiredAssignmentCash) : null;
    return {
      figs: [
        { label: 'Assignment cash', value: entered ? fmtAmount(m.requiredAssignmentCash, 'USD') : null },
        { label: 'Cash buffer', value: buffer == null ? null : fmtAmount(buffer, 'USD'),
          tone: buffer == null ? null : (buffer < 0 ? '--dn-text' : '--ok-text') },
        { label: 'Worst case at zero', value: entered ? fmtAmount(m.putMaxLossIfZero, 'USD') : null, tone: '--dn-text' },
        { label: 'Phase', value: p.phase === 'call' ? 'Covered call' : 'Cash-secured put' },
      ],
      blocker: entered ? (fit.gates && fit.gates[0]) || null : 'No contract entered, so nothing is calculated yet.',
      next: entered ? null : {
        label: 'Load a worked contract',
        onclick: () => {
          State.wheel = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true };
          saveWheel(); render(); toast('Worked contract loaded — illustrative figures');
        },
      },
    };
  },

  tradingIndex: () => {
    const r = qttiRun(State.qtti);
    return {
      figs: [
        { label: 'Trend regime', value: r.assessable ? String(r.regime) : null },
        { label: 'First-tranche readiness', value: r.assessable ? String(r.tranche) : null },
        { label: 'Screenshot confidence', value: r.assessable ? String(r.confidence) : null },
      ],
      /* reject[] is what makes a run unassessable at all, so it outranks the
         gates that merely block a tranche. Both are arrays of STRINGS — the
         first draft read `.text` off them and silently produced no blocker at
         all on the worked example, which shows fifteen open gates and a tranche
         state of "Criteria blocked". A dock that quietly reports nothing wrong
         is worse than one that is absent. */
      blocker: (r.reject && r.reject[0]) || (r.gates && r.gates[0])
        || (!r.assessable ? 'Evidence is incomplete, so no output is produced.' : null),
      next: null,
    };
  },
};

window.addEventListener('popstate', () => applyRoute());
/* Anything else that still sets a hash keeps working. */
window.addEventListener('hashchange', () => { if (fromHash()) history.replaceState(history.state, '', location.pathname + location.search); });

if (!fromHash()) applyRoute();

console.info('Quantum Tradeworks prototype — synthetic data only. %d companies, %s', U.length, MODEL_VERSION);
