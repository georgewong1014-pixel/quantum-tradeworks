/* ==========================================================================
   ONE PRODUCT LAYOUT, AND WHERE A FIRST-TIME READER STARTS (Release B)

   B5 — ONE HEADER, ONE HEAD. Every page of a product wears the same product
   header: the product's name, its badge and ONE row of tabs, all read from
   the registry (TOOLS, 35-ui.js) and drawn by the shell above the page
   (renderProductTabs). Every My Workspace page wears one workspace header
   drawn the same way. Two strips are gone with it: the Scanner drew its own
   inside each of its pages, from a table of its own whose labels the
   registry did not use ("Watchlists" there, "Watchlist scanner" in How it
   works and on the dashboard), and the personal pages drew one with no name
   whose labels were not the sidebar's ("Alerts" under "My Alerts",
   "Workspace" under "Saved Models"), on six of the eight pages.
   Under the header, one head (pageHead): the eyebrow says where the page
   sits — the product, or My workspace — the h1 what the page is for, and
   the lede says it in one line. The eyebrows had been nineteen different
   things: a product ("Property"), a section ("My workspace"), a page's own
   name ("Compare", "Thesis"), a qualifier ("Timing and risk control"). What
   an old standfirst said beyond its first line is not dropped: it is the
   head's note, under the lede. A page's one primary action, where it has
   one for the whole page, stands at the head's end.

   B6 — START HERE. The first time a reader opens Equities, the Scanner or
   Property, a compact panel sits at the top of the page: what the product
   does, its one action, what the reader gets, and a real example labelled
   for what it is — Apple's report from its SEC filings, the committed
   example setup, the sample property. It is part of the page, never a
   dialog or a tour. It stays until the reader hides it, per product, and
   comes back only from Your data & settings (startHereSettings).
   ========================================================================== */

/* THE WORKSPACE'S HEADER: the sidebar's own name for the section. */
const WORKSPACE_HEAD = { name: 'My workspace', icon: 'layout' };
/* A page of the reader's own workspace is one a workspace tool opens (TOOLS,
   product null): the dashboard, the lists, the alerts, what is saved — and a
   tool another branch adds there, once its route lands (toolPresent). */
const isWorkspaceView = (view = State.view) => TOOLS.some(t => t.product === null && toolViews(t).includes(view));
const workspaceTabs = () => TOOLS.filter(t => t.product === null && toolPresent(t))
  .map(t => ({ id: t.id, label: t.label, path: t.path, views: toolViews(t), tool: t }));

/* A tab's count. The Scanner's Alerts tab carries the unread matches, as its
   own strip did (SC-309 as built) — read from the scanner's own count, and
   none where nothing is counted (no record visible here, in-app off). */
function tabCount(t) {
  if (t.id !== 'scanAlerts' || typeof scanOpsUnread !== 'function') return 0;
  try { const n = scanOpsUnread(); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; }
}

/* WHERE THE PAGE SITS — the eyebrow of every product and workspace page. */
function pageKicker(view = State.view) {
  const p = productById(productOf(view));
  if (p) return p.name;
  return isWorkspaceView(view) ? WORKSPACE_HEAD.name : null;
}

/* ONE PAGE HEAD. The eyebrow is where the page sits (pageKicker) unless a
   page outside the products and the workspace names its own; the lede is
   one line; the note carries what the page must still say at its top — a
   disclosure, a limit — in the smaller, secondary voice under it; the action
   is the page's one primary action, where the whole page has one. */
function pageHead({ title, lede = null, note = null, action = null, eyebrow = null, cls = '' } = {}) {
  const kicker = eyebrow || pageKicker();
  return el('div', { class: `page-hd${cls ? ` ${cls}` : ''}` }, [
    el('div', { class: 'page-hd-text' }, [
      kicker ? el('p', { class: 'eyebrow' }, kicker) : null,
      el('h1', {}, title),
      lede ? el('p', { class: 'body-lg page-lede' }, lede) : null,
      note ? el('p', { class: 'page-note' }, note) : null,
    ]),
    action ? el('div', { class: 'page-hd-act' }, action) : null,
  ]);
}

/* ---------------------------------------------------------- start here */
/* What each product does and what a reader gets, in the product's own terms
   (PRODUCTS and TOOLS say the same), and the example each one opens. The
   action is the product's own (PRODUCTS.action), so the panel, the homepage
   card, How it works and the dashboard checklist say the same words. */
const START_HERE = {
  equities: {
    does: 'Research a company from its financial statements.',
    gets: 'You get its statements, ratios and a valuation range, each figure with its formula and source — US filers from their SEC filings, the Malaysian set illustrative.',
  },
  scanner: {
    does: 'Checks rules you write against each daily close of the price history you supply.',
    gets: 'You get a record of every bar on which a setup held, kept on your own computer and never sent. This site ships no prices: setups are written here and run where your price history is.',
  },
  property: {
    does: 'Models what buying and letting a property does to your cash.',
    gets: 'You get the monthly cash flow, rental yield, break-even rent and cash needed up front, from the figures you enter — saved to My properties with its scenarios.',
  },
};
/* Apple Inc., by the registry's id for the filed company. */
const START_APPLE = 'AAPL-SEC';
const START_SETUP = 'trend-breakout';

/* Which products' panels the reader has hidden: { product: when }. */
const startHereHidden = () => { const v = store.read('startHere', {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
/* The panel a page shows: its product's, unless hidden. Only on the pages
   of the product's own tools (TOOLS) — so never on a public or a workspace
   page, nor on a company page or its report, which keep their own tabs and
   head, nor on the Scanner's operations pages, which are read-only views of
   the worker's files where nothing is there to press. */
function startHereFor(view = State.view) {
  const pid = productOf(view);
  if (!pid || !START_HERE[pid] || NO_PRODUCT_TABS.has(view)) return null;
  if (!TOOLS.some(t => t.product === pid && toolViews(t).includes(view))) return null;
  return startHereHidden()[pid] ? null : pid;
}
function hideStartHere(pid) {
  const refused = store.failed;
  store.write('startHere', { ...startHereHidden(), [pid]: new Date().toISOString() });
  render();
  /* The panel went with the control that hid it; the reader goes on at the
     page's own heading, which the panel sat above. */
  focusAfterRedraw('#views h1');
  toast(store.failed !== refused ? STORE_REFUSED
    : `Start here is hidden for ${productById(pid)?.name}. Your data & settings brings it back.`);
}

/* The example, labelled for what it is, and a way to open it that works
   wherever the panel is. */
function startHereExample(pid) {
  const line = (kids, note = null) => el('div', { class: 'start-here-ex-line' }, [
    el('span', { class: 'start-here-label' }, 'Example'), ...kids,
    note ? el('span', { class: 'caption start-here-ex-note' }, note) : null]);
  const inApp = (path, text) => el('a', { class: 'start-here-ex', href: href(path), onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault(); navigate(path);
  } }, text);
  if (pid === 'equities') {
    const r = typeof BY_ID !== 'undefined' ? BY_ID.get(START_APPLE) : null;
    const chip = el('span', { class: 'chip chip-ok' }, 'filed with the SEC');
    /* The filings are loading, or did not load: Apple is not held, and a
       link would open a page that cannot draw it. */
    if (!r?.c?.real) return line([el('span', { class: 'start-here-ex start-here-ex-off' }, 'Apple Inc.’s report'), chip],
      typeof realPending !== 'undefined' && realPending ? 'It opens once the filings have loaded.' : 'It needs the filed statements, which did not load here.');
    /* The report is metered on the Free plan, as the company page says:
       opening one not yet read this month is one of the month's reports. */
    const meter = reportAllowed(r.c.id);
    const cap = lim('reportsPerMonth');
    return line([inApp(`${companyPath(r.c)}/report`, 'Apple Inc.’s report'), chip], !Number.isFinite(cap) ? null
      : !meter.ok ? `This month’s ${cap} company reports on this plan are used, so it opens next month.`
      : meter.counted ? `On this plan it is one of this month’s ${cap} company reports.` : null);
  }
  if (pid === 'scanner') {
    const ex = typeof SCAN_EXAMPLES !== 'undefined' ? SCAN_EXAMPLES.setups.find(x => x.id === START_SETUP) : null;
    return line([inApp(`/app/scanner/setups/new?example=${encodeURIComponent(START_SETUP)}`, `The example setup: ${ex?.name || 'Trend breakout'}`),
      el('span', { class: 'chip' }, 'syntax, not a suggestion')]);
  }
  if (pid === 'property') {
    const sd = typeof pmSampleDeal === 'function' ? pmSampleDeal() : null;
    const proj = sd && typeof PROJECTS !== 'undefined' ? PROJECTS.find(x => x.id === sd.projectId) : null;
    /* The calculator's sample deal, loaded as My properties' "Open the
       sample" loads it: work in progress is kept aside first (propertyLoad). */
    return line([el('button', { type: 'button', class: 'start-here-ex linklike', onclick: () => newPropertyDeal() },
      `The sample property${proj ? `: ${proj.name}` : ''}`),
      el('span', { class: 'chip chip-bronze' }, 'sample — not a real listing')]);
  }
  return null;
}

/* The product's one action. On the page it opens, a link to the same page
   goes nowhere, so there it takes the reader to where that page starts: its
   first field. */
function startHereAction(pid) {
  const p = productById(pid);
  const same = matchRoute(p.actionPath)?.view === State.view;
  if (same) return el('button', { type: 'button', class: 'btn btn-ghost start-here-go', onclick: () => {
    const f = [...document.querySelectorAll('#views input:not([type=hidden]), #views select, #views textarea')]
      .find(n => !n.closest('.start-here') && n.getClientRects().length && !n.disabled);
    if (!f) { focusMain(); return; }
    f.scrollIntoView({ block: 'center' });
    f.focus({ preventScroll: true });
  } }, [p.action, el('span', { 'aria-hidden': 'true', html: icon('down', 15) })]);
  return el('a', { class: 'btn btn-ghost start-here-go', href: href(p.actionPath), onclick: (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault(); navigate(p.actionPath);
  } }, [p.action, el('span', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;flex:none"><path d="M5 12h14M13 6l6 6-6 6"/></svg>' })]);
}

/* THE PANEL. A named region at the top of the page — not a dialog, nothing
   that takes focus or blocks the page — with no primary button: the page's
   own action stays the one primary. */
function startHerePanel(pid) {
  const p = productById(pid), s = START_HERE[pid];
  if (!p || !s) return null;
  return el('section', { class: `start-here pub-acc-${pid}`, 'aria-label': `Start here: ${p.name}`, data: { product: pid } }, [
    el('div', { class: 'start-here-top' }, [
      el('p', { class: 'start-here-kicker' }, [
        el('span', { class: 'start-here-ico', 'aria-hidden': 'true', html: icon(PRODUCT_ICON[pid] || 'grid', 16) }),
        el('span', {}, 'Start here'), el('span', { class: 'start-here-dot', 'aria-hidden': 'true' }, '·'), el('span', { class: 'start-here-pname' }, p.name)]),
      el('button', { type: 'button', class: 'btn btn-quiet btn-sm start-here-hide', 'aria-label': `Hide Start here for ${p.name}`,
        onclick: () => hideStartHere(pid) }, [el('span', {}, 'Hide'), el('span', { 'aria-hidden': 'true', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:14px;height:14px;flex:none"><path d="M18 6 6 18M6 6l12 12"/></svg>' })]),
    ]),
    el('p', { class: 'start-here-does' }, s.does),
    el('p', { class: 'start-here-gets' }, s.gets),
    el('div', { class: 'start-here-ft' }, [startHereAction(pid), startHereExample(pid)]),
  ]);
}
/* Mounted by drawPage above the page, inside its column. */
const startHereNode = () => { const pid = startHereFor(); return pid ? startHerePanel(pid) : null; };

/* YOUR DATA & SETTINGS: which panels are hidden, and the one control that
   brings them back. Nothing to press while none is hidden. */
function startHereSettings() {
  const hidden = startHereHidden();
  const names = PRODUCTS.filter(p => START_HERE[p.id] && hidden[p.id]).map(p => p.name);
  const card = el('div', { class: 'card', id: 'start-here-settings' });
  card.append(cardHead('Start here panels',
    'Equities Research, Quantum Scanner and Property Intelligence each open with a short Start here panel — what the product does, its one action and an example — until you hide it.'));
  if (!names.length) {
    card.append(el('p', { class: 'metaline' }, 'None is hidden: each shows at the top of its product until you hide it there.'));
    return card;
  }
  card.append(el('div', { class: 'row row-wrap', style: 'gap:var(--sm) var(--md);align-items:center' }, [
    el('p', { class: 'body', style: 'flex:1 1 280px;margin:0' }, `Hidden for ${names.join(names.length > 2 ? ', ' : ' and ').replace(/, ([^,]*)$/, ' and $1')}.`),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'startHereReset', onclick: () => {
      const refused = store.failed;
      store.write('startHere', {});
      render();
      focusAfterRedraw('#start-here-settings .h-card', '#views h1');
      toast(store.failed !== refused ? STORE_REFUSED : 'The Start here panels will show again, at the top of each product.');
    } }, 'Show them again'),
  ]));
  return card;
}
