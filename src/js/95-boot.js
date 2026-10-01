/* ==========================================================================
   SEARCH · THEME · BOOT
   ========================================================================== */

const searchModal = $('#searchModal'), searchInput = $('#searchInput'), searchResults = $('#searchResults');

/* Where focus was when the search opened, so closing it puts focus back —
   on the search button, or wherever "/" was pressed — rather than dropping it
   on the document body, where the next Tab starts from the top of the page. */
let searchOpen = false, searchLastFocus = null, searchHideTimer = null;
function openSearch() {
  /* "/" pressed while the box is already open — with focus on a result, say —
     used to reopen it and wipe the results. It now just returns to the box. */
  if (searchOpen) { searchInput.focus(); return; }
  /* A close still finishing its fade owns a timer that hides the box and
     empties it. Reopened inside those 200ms — Escape then "/", or the close
     button and straight back — the timer fired on the NEW box: hidden, its
     results gone, while searchOpen said it was open, so "/" only focused an
     invisible input and the search was dead until Escape. */
  clearTimeout(searchHideTimer); searchHideTimer = null;
  /* A menu or the navigation drawer the search was opened from closes first,
     handing focus to its own button — which is then where the search returns
     it, rather than to a link inside a drawer that is no longer open. */
  closeShellMenus({ restore: true });
  searchOpen = true;
  searchLastFocus = document.activeElement;
  searchModal.hidden = false;
  /* A close before this frame was overridden by it, leaving the scrim over
     the page: the frame does nothing once the box has closed. */
  requestAnimationFrame(() => { if (!searchOpen) return; searchModal.dataset.open = '1'; scrim.dataset.open = '1'; searchInput.focus(); searchInput.select(); });
  /* The results answer the box as it reopens. The last query is kept, and
     selected so that typing replaces it, but the list drawn under it was
     the empty box's: "nvda" in the box over Maybank, Public Bank, CIMB,
     and Enter opened Maybank. */
  runSearch(searchInput.value);
}
function closeSearch({ restore = true } = {}) {
  /* closeDrawer calls this unconditionally; a search that is not open has no
     focus to give back and must not take any. */
  if (!searchOpen) return;
  searchOpen = false;
  /* A search still waiting on its debounce would refill the closed box. */
  clearTimeout(searchTimer); searchTimer = null;
  searchModal.dataset.open = '0';
  /* Stale results were left in the box after it closed, and — because the
     closed box is display:none only since the [hidden] rule below — they used
     to sit in the page's tab order, invisible, after the footer. */
  searchHideTimer = setTimeout(() => { searchHideTimer = null; searchModal.hidden = true; searchResults.replaceChildren(); $('#searchStatus')?.replaceChildren(); }, 200);
  if (drawer.dataset.open !== '1') scrim.dataset.open = '0';
  const back = searchLastFocus; searchLastFocus = null;
  if (!restore) return;
  /* Back to the opener, or to the search button when the opener was the
     document body (the "/" key with nothing focused) or has since been
     destroyed by a render — never left inside the invisible box. */
  /* The main landmark is the usual opener — every route change focuses it —
     but it is focusable only while it holds the tabindex focusMain() gives it
     and takes away on blur. Opening the box blurred it, so a plain focus()
     here failed silently and dropped focus on <body>; focusMain() puts the
     tabindex back first. Anything else that did not take focus falls back to
     the search button. */
  /* There are three search buttons since Release A — the sidebar's, the slim
     bar's, and none at all in the public header — and at most one shows, so
     the fallback is whichever is on screen, and the page's main landmark
     where none is. Focusing a hidden button fails silently and leaves focus
     on <body>. */
  const button = searchButtonShown();
  const target = back && back !== document.body && document.contains(back) && back !== searchInput ? back : button;
  if (!target || target.id === 'main') { focusMain(); return; }
  target.focus?.({ preventScroll: true });
  if (document.activeElement !== target) { if (button) button.focus({ preventScroll: true }); else focusMain(); }
}
function searchButtonShown() {
  return [...document.querySelectorAll('[data-open-search]')].find(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden') || null;
}
/* SEARCH EVERYTHING (Release B, B3). One box, and its results under three
   headings:
   - Companies: the canonical registry, as before — symbol, old id, listing
     code, CIK, vendor form, then name, then sector — price-only
     instruments too, each saying so.
   - Pages and tools: the four products, every tool in the registry (TOOLS)
     that this build holds, the public pages as the header and its
     Resources menu name them, and any other page with an address of its
     own. A tool whose state is soon or unavailable is text with its badge
     and its reason, never a link — read from toolState, as every other link
     to it is (gateToolLink, 35-ui.js); the product that is not built is text
     with its badge, as the header's menu has it.
   - Your saved work: watchlists, scanner setups, and every kind Saved
     Models lists (workspaceItems: saved properties, investment cases, saved
     screens, comparisons, valuation runs, tool snapshots) — read from the
     stores that hold them and opened by each kind's own open, so an item
     behaves here as it does on its own page. A sample says so, and so does
     a company whose figures are illustrative.
   With nothing typed, the box lists Recent: what was last opened in this
   browser (59-recent.js). Never a result that goes nowhere: a page is
   listed only when its address opens a view in this build, a saved item
   only while its store holds it, and one whose tool cannot be used here is
   text with the reason. Ranked by how the words matched, never by any
   measure of what matched. */
const SEARCH_WORKSPACE_ICON = { dashboard: 'layout', watchlists: 'list', myAlerts: 'bell', saved: 'folder', portfolio: 'briefcase',
  theses: 'book', tracked: 'chart', userdata: 'database' };
const SEARCH_SAVED_ICON = { watchlist: 'list', setup: 'target', property: 'home', thesis: 'book', screen: 'filter', comparison: 'scale', run: 'coin', work: 'folder' };
const SEARCH_SHOWN = 8;
const searchPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* The address a path names as its page's own — what <link rel=canonical>
   says — so /discover and /discover/screener, one page, are one row. The
   router reads the tab of Learn and the screener from the address on
   screen; an index must not change with the page it is opened over, so a
   bare Learn or screener address is their first tab's page, as a fresh
   load of it is. */
function searchCanonical(path) {
  const rt = matchRoute(String(path).split('?')[0]);
  if (!rt) return String(path);
  if ((rt.view === 'learn' || rt.view === 'discover') && !rt.tab) return canonicalPath({ ...rt, tab: (rt.view === 'learn' ? LEARN_TABS : DISCOVER_TABS)[0].id });
  return canonicalPath(rt);
}
const searchOpens = (path) => { const rt = matchRoute(String(path).split('?')[0]); return !!(rt && VIEWS[rt.view]); };
/* The state of the tool an address opens, where that tool cannot be used
   here — the registry's own reading, as the gate on every link reads it. */
function searchOff(path) {
  const t = path ? toolForPath(path) : null;
  const s = t ? toolState(t) : null;
  return s && !s.actionable ? s : null;
}

/* EVERY PAGE THE BOX CAN OPEN, AND WHAT IT IS CALLED. The products; every
   tool this build holds (a tool whose address is its product's front page
   is that product's row); the public pages; then every other page with an
   address of its own, by its route's title. One row per page: an alias, a
   route's own title for the page, the sidebar's word for it, are other
   names of the row, not rows of their own. */
function searchPageIndex() {
  const rows = [], byPath = new Map(), byCanon = new Map();
  const add = (r) => {
    rows.push(r);
    if (!r.path) return;
    byPath.set(r.path, r);
    const c = searchCanonical(r.path);
    if (!byCanon.has(c)) byCanon.set(c, r);
  };
  const alsoCalled = (r, name) => { if (name && name !== r.label && !r.aka.includes(name)) r.aka.push(name); };
  PRODUCTS.forEach(p => {
    if (p.path && !searchOpens(p.path)) return;
    add({ label: p.name, in: 'Product', note: p.path ? p.blurb : p.statusNote, path: p.path || null,
      icon: PRODUCT_ICON[p.id] || 'grid', product: p.id, tool: null, aka: [p.short, p.task].filter(Boolean) });
  });
  TOOLS.forEach(t => {
    if (!toolPresent(t)) return;
    const have = byPath.get(t.path);
    if (have) { alsoCalled(have, t.label); have.tool = have.tool || t; return; }
    const p = t.product ? productById(t.product) : null;
    add({ label: t.label, in: p ? p.name : 'My workspace', note: t.statusNote, path: t.path,
      icon: p ? PRODUCT_ICON[p.id] || 'grid' : SEARCH_WORKSPACE_ICON[t.id] || 'folder', product: null, tool: t, aka: [t.action?.label].filter(Boolean) });
  });
  [{ label: 'Home', path: '/', icon: 'grid' }, { label: 'How it works', path: '/how-it-works', icon: 'info' }, { label: 'Pricing', path: '/pricing', icon: 'tag' },
    ...RESOURCES.map(r => ({ label: r.label, path: r.path, icon: r.group === 'method' ? 'book' : 'doc', in: 'Resources' }))].forEach(r => {
    if (byPath.has(r.path) || !searchOpens(r.path)) return;
    add({ label: r.label, in: r.in || 'Page', note: META[matchRoute(r.path).view] || '', path: r.path, icon: r.icon, product: null, tool: null, aka: [] });
  });
  [...APP_NAV_WORKSPACE, ...APP_NAV_FOOT].forEach(n => { const r = byPath.get(n.path); if (r) alsoCalled(r, n.label); });
  ROUTES.forEach(rt => {
    if (rt.alias || rt.path.includes(':') || !VIEWS[rt.view]) return;
    const have = byPath.get(rt.path) || byCanon.get(searchCanonical(rt.path));
    if (have) { alsoCalled(have, rt.title); return; }
    add({ label: rt.title, in: 'Page', note: META[rt.view] || '', path: rt.path, icon: 'doc', product: null, tool: null, aka: [] });
  });
  return rows;
}

/* The page an address recorded in Recent is: its row, a tab of Learn or the
   screener named after its row, or a company's printable report. Null for
   an address this build no longer opens. */
function searchPageAt(path, index = searchPageIndex()) {
  const [p, q = ''] = String(path).split('?');
  const rt = matchRoute(p);
  if (!rt || !VIEWS[rt.view]) return null;
  if (rt.view === 'researchReport') {
    const id = companyFromSlug(rt.params?.id);
    const row = id ? BY_ID.get(id) : null;
    return row ? { label: `${row.c.tk} research report`, in: row.c.name, note: 'The company on one printable page, every figure with its source.',
      path: `${companyPath(row.c)}/report`, icon: 'doc', product: null, tool: null, aka: [] } : null;
  }
  if (rt.path.includes(':')) return null;
  const base = index.find(r => r.path === p) || index.find(r => r.path && searchCanonical(r.path) === searchCanonical(p))
    || { label: rt.title, in: 'Page', note: META[rt.view] || '', path: p, icon: 'doc', product: null, tool: null, aka: [] };
  const tab = new URLSearchParams(q).get('tab');
  const tabs = rt.view === 'learn' ? LEARN_TABS : rt.view === 'discover' ? DISCOVER_TABS : null;
  const said = tabs && tab ? tabs.find(t => t.id === ((rt.view === 'learn' && LEARN_TAB_ALIAS[tab]) || tab))?.label : null;
  return said ? { ...base, label: `${base.label}: ${said}`, path: `${p}?tab=${encodeURIComponent(tab)}` } : base;
}

/* EVERYTHING THE READER HAS SAVED, from the stores that hold it. */
function searchSavedIndex() {
  const out = [];
  (State.watchlists || []).forEach(w => {
    if (!w || typeof w !== 'object' || !w.id) return;
    const ids = Array.isArray(w.ids) ? w.ids : [];
    const rows = ids.map(id => BY_ID.get(id)).filter(Boolean);
    const illN = rows.filter(r => !r.c.real).length;
    out.push({ type: 'watchlist', id: w.id, name: w.name || 'Watchlist', kind: 'Watchlist', icon: 'list',
      detail: searchPlural(ids.length, 'company', 'companies'), subject: rows.map(r => r.c.tk).join(' '),
      sample: typeof isSeededWL === 'function' && isSeededWL(w), illus: illN && illN === rows.length ? 'all' : illN ? 'some' : null,
      path: '/my/watchlists', open: () => searchOpenWatchlist(w.id) });
  });
  if (typeof scanBrowserSetups === 'function') scanBrowserSetups().forEach(s => out.push({ type: 'setup', id: s.id, name: s.name || s.id,
    kind: 'Scanner setup', icon: 'target', detail: `Version ${s.version} · ${s.enabled === false ? 'disabled' : 'enabled'}`, subject: s.id,
    sample: false, illus: null, path: scanSetupPath(s.id), open: () => navigate(scanSetupPath(s.id)) }));
  if (typeof workspaceItems === 'function') workspaceItems().forEach(i => {
    const prop = i.kind === 'work' && typeof pmFind === 'function' && !!pmFind(i.key);
    const type = prop ? 'property' : i.kind;
    out.push({ type, id: i.key, name: i.name, kind: prop ? 'Saved property' : WORKSPACE_KIND_ONE[i.kind] || 'Saved item', icon: SEARCH_SAVED_ICON[type] || 'folder',
      detail: i.detail, subject: i.subject, sample: !!i.sample, illus: i.illustrative === 'all' || i.illustrative === 'some' ? i.illustrative : null,
      path: i.path || (prop ? '/property/calculator' : type === 'thesis' ? '/my/theses' : null), open: () => i.open() });
  });
  return out;
}
/* A list is opened where the reader keeps it: the watchlists page, with the
   keyboard on that list's card rather than on the page's first control. */
function searchOpenWatchlist(id) {
  const w = (State.watchlists || []).find(x => x.id === id);
  navigate('/my/watchlists');
  if (!w) return;
  const name = [...document.querySelectorAll('#views input[aria-label]')].find(n => n.getAttribute('aria-label') === `Name of watchlist ${w.name}`);
  const card = name?.closest('.card');
  if (card) focusAfterRedraw(card);
}

/* How well a query names something: all of a name, its start, the start of
   one of its words, anywhere in it; then the same over its other names;
   then every word of the query at the start of a word somewhere in them;
   then every word of it in its description, and the query in its address.
   Null when nothing matches. A query of one letter matches names only. */
function searchScore(term, name, others = [], { about = '', path = '' } = {}) {
  const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const n = String(name || '').toLowerCase();
  if (n === term) return 0;
  if (n.startsWith(term)) return 1;
  if (words(n).some(w => w.startsWith(term))) return 2;
  if (term.length < 2) return null;
  if (n.includes(term)) return 3;
  const o = others.filter(Boolean).map(s => String(s).toLowerCase());
  if (o.some(s => s === term || s.startsWith(term) || words(s).some(w => w.startsWith(term)))) return 4;
  if (o.some(s => s.includes(term))) return 5;
  const tokens = words(term);
  if (tokens.length > 1) { const all = words([n, ...o].join(' ')); if (tokens.every(t => all.some(w => w.startsWith(t)))) return 6; }
  if (about && term.length >= 3) { const said = words(about); if (tokens.length && tokens.every(t => said.some(w => w.startsWith(t)))) return 7; }
  if (path && term.length >= 3 && String(path).toLowerCase().includes(term)) return 8;
  return null;
}
const searchRank = (list, scoreOf) => list.map((x, n) => ({ x, n, s: scoreOf(x) })).filter(y => y.s !== null)
  .sort((a, b) => a.s - b.s || a.n - b.n).map(y => y.x);

/* ----------------------------------------------------------------- rows */
/* One row: its mark, its name with its chips and where it belongs, and a
   line saying what it is. A link where it has an address of its own (the
   browser's link behaviour — a new tab, the address in the status bar), a
   button where a saved item opens by its own function, and text — nothing
   to press — where its tool cannot be used here. */
function searchItemRow({ ic, name, chips = [], place = null, note = null, path = null, open = null, toolPath = null, off = null, text = false, when = null }) {
  const kids = [
    el('i', { class: 'search-ico', 'aria-hidden': 'true', html: icon(ic || 'doc', 16) }),
    el('span', { class: 'search-main' }, [
      el('span', { class: 'search-title' }, [el('span', { class: 'search-name' }, name), ...chips.filter(Boolean), place ? el('span', { class: 'search-in' }, place) : null]),
      note ? el('span', { class: 'search-note' }, note) : null,
    ]),
    when,
  ];
  if (off || text) return el('div', { class: 'search-row search-item search-off', 'data-tool': off ? off.id : null, 'data-tool-state': off ? off.status : null }, kids);
  if (path) return el('a', { class: 'search-row search-item', href: href(path), 'data-result': '',
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); open(); } }, kids);
  return el('button', { type: 'button', class: 'search-row search-item', 'data-result': '', 'data-tool-path': toolPath, onclick: () => open() }, kids);
}
/* A page or a tool: its product's badge on a product; a tool's badge where
   its state is worth marking (Demo, Delayed), with why; a tool that cannot
   be used here as text, its badge and its reason in full. */
function searchPageRow(r, { when = null } = {}) {
  if (!r.path) return searchItemRow({ ic: r.icon, name: r.label, chips: [productBadge(r.product)], place: r.in, note: r.note, text: true, when });
  const tool = r.tool || toolForPath(r.path);
  const s = tool ? toolState(tool) : null;
  if (s && !s.actionable) return searchItemRow({ ic: r.icon, name: r.label, chips: [toolBadge(tool)], place: r.in, note: s.note, off: s, when });
  const flag = s && TOOL_FLAGGED.has(s.status) ? toolBadge(tool) : null;
  return searchItemRow({ ic: r.icon, name: r.label, chips: [r.product ? productBadge(r.product) : flag], place: r.in, note: flag ? s.note : r.note,
    path: r.path, open: () => { closeSearch(); navigate(r.path); }, when });
}
/* A saved item: its kind, what it holds, and whether it is a sample or
   carries illustrative figures. Opened by its own kind's function, and
   noted in Recent as itself. */
function searchSavedRow(item, { when = null } = {}) {
  const chips = [
    item.sample ? el('span', { class: 'chip chip-bronze', title: 'Seeded on a first visit to show what one looks like. Not your work.' }, 'sample') : null,
    item.illus === 'all' ? el('span', { class: 'chip chip-bronze', title: ILLUS_TITLE }, 'illustrative figures')
      : item.illus === 'some' ? el('span', { class: 'chip chip-bronze', title: 'Some of the companies in it carry synthetic figures.' }, 'partly illustrative') : null,
  ];
  const s = searchOff(item.path);
  if (s) return searchItemRow({ ic: item.icon, name: item.name, chips: [...chips, toolBadge(s.tool)], place: item.kind, note: s.note, off: s, when });
  return searchItemRow({ ic: item.icon, name: item.name, chips, place: item.kind, note: item.detail, toolPath: item.path,
    open: () => { closeSearch(); recentOpen(item.type, item.id, item.open); }, when });
}
/* A company in Recent: its ticker, its name, and what its figures are. */
function searchRecentCompanyRow(row, when) {
  const c = row.c;
  return searchItemRow({ ic: 'chart', name: c.tk, chips: [illusChip(c), marketChip(c.mkt)], place: c.name,
    note: ['Company', c.exch, c.personal ? 'personal research' : null].filter(Boolean).join(' · '),
    path: companyPath(c), open: () => { closeSearch(); openResearch(c.id); }, when });
}
/* A company found by the query, as it has always been drawn: the ticker
   and its chips, the name and sector, then the price and the day's move —
   an illustrative company's, since no licensed price is held for a filed
   one. Its mark is in the name's column, so the column is the row's first
   child and the ticker its first word, as they have always been. */
const searchCoMark = () => el('i', { class: 'search-ico', 'aria-hidden': 'true', html: icon('chart', 16) });
function searchCompanyRow({ ins, r }) {
  if (!r) {
    const b = el('button', { type: 'button', class: 'search-row search-co', 'data-result': '', onclick: () => { closeSearch(); navigate('/my/tracked'); } });
    b.append(el('div', { class: 'search-co-main' }, [searchCoMark(), el('div', { class: 'search-co-text' }, [
      el('div', { class: 'search-co-line' }, [
        el('span', { class: 'search-co-tk' }, ins.symbol), marketChip(ins.market),
        el('span', { class: 'chip chip-bronze', style: 'flex:none' }, 'price only — no statements')]),
      el('div', { class: 'metaline search-co-name' }, `${ins.companyName} · tracked by price on Watchlists › Tracked`)])]));
    return b;
  }
  const b = el('button', { type: 'button', class: 'search-row search-co', 'data-result': '', onclick: () => { closeSearch(); openResearch(r.c.id); } });
  /* The row of chips wraps. Its tokens are nowrap and do not shrink, and on a
     phone the last of them, the exchange, ran out of the name's column and
     over the price: "Bursa Main" printed across RM10.86 at 360, 390 and 430. */
  b.append(el('div', { class: 'search-co-main' }, [searchCoMark(), el('div', { class: 'search-co-text' }, [
    el('div', { class: 'search-co-line' }, [
      el('span', { class: 'search-co-tk' }, r.c.tk), illusChip(r.c), marketChip(r.c.mkt),
      r.c.personal ? el('span', { class: 'chip chip-bronze', style: 'flex:none' }, 'personal research') : null,
      /* The code the reader may have typed, so a hit on it is visibly a hit.
         A fixed-width numeric token: .metaline wraps anywhere, and inside a
         nowrap flex row that broke "1155" into two lines at 360px. */
      r.c.code && r.c.code !== r.c.tk ? el('span', { class: 'metaline search-co-tok' }, r.c.code) : null,
      el('span', { class: 'metaline search-co-tok' }, r.c.exch)]),
    el('div', { class: 'metaline search-co-name' }, `${r.c.name} · ${r.c.sector}`)])]));
  b.append(el('span', { class: 'num search-co-px' }, fmtMoney(r.c.px.p, r.c.ccy)));
  b.append(el('span', { class: 'num search-co-d1 ' + signClass(r.c.px.d1) }, withSign(r.c.px.d1, 2)));
  return b;
}
/* When a Recent entry was opened, on the reader's own clock: how long ago
   within the day, "yesterday", then the date; the full date and time on
   hover. An entry from before times were kept says so rather than being
   given a time it does not have. */
function searchWhen(iso, now = Date.now()) {
  if (!iso) return el('span', { class: 'search-when', title: 'Opened before this browser kept the time' }, 'earlier');
  const t = Date.parse(iso), d = new Date(t), s = Math.max(0, (now - t) / 1000);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const said = s < 60 ? 'just now'
    : s < 3600 ? `${Math.floor(s / 60)} min ago`
    : s < 86400 ? `${searchPlural(Math.floor(s / 3600), 'hour')} ago`
    : d.toDateString() === yesterday.toDateString() ? 'yesterday'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
  return el('time', { class: 'search-when', datetime: d.toISOString(),
    title: d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }, said);
}

/* One group: its heading — the name a screen reader gives the group — a
   count to the eye (the status line says it in words), its rows, and a
   line when more matched than are shown. */
function searchGroup(id, title, rows, { count = null, more = null, action = null } = {}) {
  const hid = `search-h-${id}`;
  return el('div', { class: `search-group search-group-${id}`, role: 'group', 'aria-labelledby': hid, 'data-group': id }, [
    el('div', { class: 'search-group-hd' }, [
      el('h2', { class: 'search-group-t', id: hid }, title),
      count ? el('span', { class: 'search-group-n', 'aria-hidden': 'true' }, count) : null,
      action]),
    rows.length ? el('ul', { class: 'search-list', role: 'list' }, rows.map(r => el('li', {}, r))) : null,
    more ? el('p', { class: 'search-more' }, more) : null,
  ]);
}
/* RECENT (B4): what was last opened, newest first, each with when — the
   record 59-recent.js keeps, each entry resolved again now, and one that no
   longer resolves left out. One row per page, however it was reached; and
   not the page on screen, which is where the reader already is. */
function searchRecentGroup() {
  const index = searchPageIndex();
  let saved = null;
  const savedOf = (type, id) => (saved || (saved = searchSavedIndex())).find(i => i.type === type && i.id === id) || null;
  /* An entry as what it opens now, and the key that says two entries open
     the same thing. */
  const resolve = (e) => {
    if (e.k === 'company') { const row = BY_ID.get(e.id); return row ? { key: `c:${row.c.id}`, row } : null; }
    if (e.k === 'page') { const p = searchPageAt(e.id, index); return p ? { key: `p:${p.path}`, page: p } : null; }
    const item = savedOf(e.type, e.id);
    return item ? { key: `s:${item.type}:${item.id}`, item } : null;
  };
  const here = recentHere();
  const shown = new Set(here ? [resolve(here)?.key].filter(Boolean) : []);
  const rows = recentEntries().map(e => {
    const r = resolve(e);
    if (!r || shown.has(r.key)) return null;
    shown.add(r.key);
    const when = searchWhen(e.t);
    return r.row ? searchRecentCompanyRow(r.row, when) : r.page ? searchPageRow(r.page, { when }) : searchSavedRow(r.item, { when });
  }).filter(Boolean);
  const clear = rows.length ? el('button', { type: 'button', class: 'search-clear', onclick: () => {
    recentClear();
    runSearch('');
    searchInput.focus();
    const st = $('#searchStatus');
    if (st) st.textContent = 'Recent cleared.';
  } }, 'Clear recent') : null;
  const g = searchGroup('recent', 'Recent', rows, { action: clear });
  g.append(rows.length
    ? el('p', { class: 'search-keep' }, 'Opened in this browser, newest first — twenty at most, kept on this device and sent nowhere.')
    : el('div', { class: 'search-empty' }, [
        el('p', { class: 'search-empty-t' }, 'Nothing opened yet'),
        el('p', { class: 'search-empty-s' }, 'The companies, pages and saved work you open are listed here, newest first — kept in this browser, sent nowhere. Or type a ticker, a company’s name or Bursa code, a page or tool, or the name of something you saved.'),
      ]));
  return g;
}

function runSearch(q) {
  const term = String(q || '').trim().toLowerCase();
  const status = $('#searchStatus');
  searchResults.scrollTop = 0;
  /* Nothing typed: Recent. The status line says nothing for an empty box. */
  if (!term) {
    searchResults.replaceChildren(searchRecentGroup());
    gateToolLinks(searchResults);
    if (status) status.textContent = '';
    return;
  }
  /* The box promises "ticker, name, or Bursa code". addCompany moves a Bursa
     company's numeric code into c.code and its short name into c.tk, so a
     search that read only tk and id could never match 1155 to Maybank — the
     placeholder described a field the filter did not look at. */
  /* Through the canonical registry: symbol, old id, listing code, CIK, vendor
     form, then name, then sector. A price-only instrument is listed too and
     says so — a reader who tracks it should not be told it does not exist. */
  const found = searchInstruments(term, {}, { limit: 10 });
  const cos = found.hits.map(ins => ({ ins, r: ins.companyId ? BY_ID.get(ins.companyId) : null }));
  /* Pages, not only companies. Search indexed the universe and nothing else, so
     "wheel" answered "No company matches that search" while the Cash Wheel
     workspace sat two clicks away with no inbound link — the search box
     confirmed the feature did not exist. */
  /* A tool's or a product's own sentence says what it does ("rental yield"),
     so its words find it; a page's description is the page's summary for a
     link preview, and matched every other query. */
  const pages = searchRank(searchPageIndex(), r => searchScore(term, r.label, [...r.aka, r.in], { about: r.tool || r.product ? r.note : '', path: r.path }));
  const saved = searchRank(searchSavedIndex(), i => searchScore(term, i.name, [i.kind, i.subject], { about: i.detail }));
  const more = (shown, total) => (total > shown ? `Showing ${shown} of ${total} — keep typing to narrow.` : null);
  const groups = [];
  if (cos.length) groups.push(searchGroup('companies', 'Companies', cos.map(searchCompanyRow),
    { count: found.total > cos.length ? `${cos.length} of ${found.total}` : String(cos.length), more: more(cos.length, found.total) }));
  const pagesShown = pages.slice(0, SEARCH_SHOWN), savedShown = saved.slice(0, SEARCH_SHOWN);
  if (pages.length) groups.push(searchGroup('pages', 'Pages and tools', pagesShown.map(r => searchPageRow(r)),
    { count: pages.length > pagesShown.length ? `${pagesShown.length} of ${pages.length}` : String(pages.length), more: more(pagesShown.length, pages.length) }));
  if (saved.length) groups.push(searchGroup('saved', 'Your saved work', savedShown.map(i => searchSavedRow(i)),
    { count: saved.length > savedShown.length ? `${savedShown.length} of ${saved.length}` : String(saved.length), more: more(savedShown.length, saved.length) }));
  if (!groups.length) groups.push(emptyState('Nothing matches that search — no company, no page or tool, and nothing you have saved.'));
  searchResults.replaceChildren(...groups);
  /* The shell's one gate, over what was drawn: a link to a tool that cannot
     be used here is text wherever it was drawn, this box included. */
  gateToolLinks(searchResults);
  /* The count, said. The list appears silently under the box, so a screen
     reader heard what it typed and nothing else — not that anything had
     matched, nor how many. Said once the list is drawn, for the text in the
     box; an empty box says nothing. */
  if (status) {
    const said = [
      cos.length ? (found.total > cos.length ? `${cos.length} of ${found.total} companies shown` : searchPlural(cos.length, 'company', 'companies')) : null,
      pages.length ? `${pagesShown.length} ${pagesShown.length === 1 ? 'page or tool' : 'pages and tools'}${pages.length > pagesShown.length ? ` of ${pages.length}` : ''}` : null,
      saved.length ? `${searchPlural(savedShown.length, 'saved item')}${saved.length > savedShown.length ? ` of ${saved.length}` : ''}` : null,
    ].filter(Boolean);
    status.textContent = !said.length ? 'Nothing matches that search.'
      : said.length === 1 ? `${said[0]}.` : `${said.slice(0, -1).join(', ')} and ${said[said.length - 1]}.`;
  }
}
/* Debounced: a keystroke every 40ms re-ranked the whole registry each time. */
let searchTimer = null;
searchInput.addEventListener('input', e => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { searchTimer = null; runSearch(e.target.value); }, 120); });
$$('[data-open-search]').forEach(b => b.addEventListener('click', openSearch));
$('#closeSearch')?.addEventListener('click', closeSearch);
document.addEventListener('keydown', e => {
  /* Escape closes the dialog on top, not every dialog. The search box opened
     over a drawer ("/" works there) closed both on one press, and the drawer
     the reader had gone back to went with it — its focus hand-back landing on
     the page underneath. A second Escape closes the drawer. Then the chrome's
     own: the navigation drawer, an open header menu, the phone's sheet — each
     handing focus back to the button that opened it. */
  if (e.key === 'Escape') {
    if (searchOpen) closeSearch();
    else if (drawer.dataset.open === '1') closeDrawer();
    else closeNavDrawer() || closeMenu() || closeSheet();
    return;
  }
  if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); return; }
  /* Ctrl+K and Cmd+K, the other key a reader reaches for. From anywhere, a
     field included — it is a chord, and types nothing. */
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openSearch(); return; }

  /* BOTH DIALOGS SAY aria-modal AND NEITHER WAS. Tab walked straight out of
     the drawer and the search box into the page behind them. While one is
     open, Tab and Shift+Tab cycle inside it — and inside the navigation
     drawer, which says aria-modal too while it is open. */
  const dialog = searchOpen ? searchModal : drawer.dataset.open === '1' ? drawer : navDrawerOpen ? $('#sidebar') : null;
  if (dialog && e.key === 'Tab') {
    const f = [...dialog.querySelectorAll('button,[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')]
      .filter(n => !n.disabled && n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], inside = dialog.contains(document.activeElement);
    if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    return;
  }

  /* Typing on a result goes on in the box, where the words are: a letter
     pressed after the arrows had walked into the list was lost on the
     result. Space and Enter stay the result's own. */
  if (searchOpen && searchResults.contains(document.activeElement) && !e.ctrlKey && !e.metaKey && !e.altKey
      && ((e.key.length === 1 && e.key !== ' ') || e.key === 'Backspace')) {
    const end = searchInput.value.length;
    searchInput.focus();
    searchInput.setSelectionRange(end, end);
    return;
  }

  /* Enter in the box opens the first result — what a reader typing a ticker
     expects, and with nothing typed, the newest thing in Recent; nothing
     opens when nothing matched. */
  if (searchOpen && e.key === 'Enter' && document.activeElement === searchInput) {
    /* The list on screen may belong to the previous query: typing is
       debounced by 120ms, and Enter pressed inside that window opened the old
       first result — Maybank, on a fresh box, for "nvda". The pending search
       is run now, so Enter answers the text actually in the box. */
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; runSearch(searchInput.value); }
    const first = searchResults.querySelector('[data-result]');
    if (first) { e.preventDefault(); first.click(); }
    return;
  }

  /* The arrow keys walk every result, on across the groups' headings; Up
     from the first returns to the box. Only the results: a tool listed as
     text, a heading and "Clear recent" are not stops on the walk. */
  if (searchOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    const items = [...searchResults.querySelectorAll('[data-result]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    e.preventDefault();
    if (e.key === 'ArrowDown') (i < 0 ? items[0] : items[Math.min(items.length - 1, i + 1)]).focus();
    else (i <= 0 ? searchInput : items[i - 1]).focus();
  }
});

/* ------------------------------------------------------------------ theme */
const themeToggle = $('#themeToggle');
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>';

function currentTheme() {
  return document.documentElement.dataset.theme
    || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
/* The toggle says what pressing it does, from the theme actually showing.
   Every toggle — the public header's, the sidebar's, the phone sheet's —
   says the same thing: the icon, the name, and where there is room, the
   theme it switches to in words. */
function paintThemeToggle() {
  const t = currentTheme();
  const said = t === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme';
  $$('[data-theme-toggle]').forEach(b => {
    b.setAttribute('aria-label', said);
    const ico = b.querySelector('#themeIcon, [data-theme-icon]');
    if (ico) ico.innerHTML = ico.tagName.toLowerCase() === 'svg' ? (t === 'dark' ? SUN : MOON)
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" style="width:18px;height:18px">${t === 'dark' ? SUN : MOON}</svg>`;
    const label = b.querySelector('[data-theme-label]');
    if (label) label.textContent = t === 'dark' ? 'Light theme' : 'Dark theme';
  });
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.write('theme', t);
  paintThemeToggle();
  /* charts read their colours from CSS custom properties, so redraw them */
  requestAnimationFrame(() => render());
}
$$('[data-theme-toggle]').forEach(b => b.addEventListener('click', () => applyTheme(currentTheme() === 'dark' ? 'light' : 'dark')));

const savedTheme = store.read('theme', null);
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
paintThemeToggle();
/* WITH NO THEME CHOSEN THE PAGE FOLLOWS THE OS, AND SO MUST WHAT IS DRAWN.
   The palette flips by media query, but the heatmap's tiles, the sensitivity
   grid and the tornado's labels are painted with colours read out of the
   custom properties when they were drawn — applyTheme re-renders for exactly
   that reason, and an OS switch (a scheduled dark mode at dusk) did not: the
   page went dark around tiles and cells still in the light palette, and the
   toggle kept offering the theme already showing. A chosen theme does not
   follow the OS, so it is left alone. */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (document.documentElement.dataset.theme) return;
  paintThemeToggle();
  render();
});

/* ------------------------------------------------------------------- boot */
const refreshSearchLabel = () => {
  /* No number while the filings are in flight. Writing "36" and correcting it to
     "138" a second later states a figure the product is about to contradict.
     The box searches companies, pages and tools, and the reader's saved work
     (Release B), so the visible label is "Search" — true of all three, and
     it fits the sidebar — and the name says what it searches, starting with
     the words on the button, so a voice command naming what is visible still
     finds it. The count of companies joins it once there is a right one. */
  $('#searchLabel').textContent = 'Search';
  $$('[data-open-search]').forEach(b => b.setAttribute('aria-label',
    `Search ${realPending ? 'companies' : `${U.length} companies`}, pages and tools, and your saved work`));
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
  /* With the filings switched off (?real=0, or the dashboard's "Load SEC-filed
     companies" unticked) every company loaded is synthetic. The static wording
     — "some companies carry illustrative figures" — is written for a build
     that also carries filings, and understated this one. */
  if (!real && !realEnabled()) {
    node.innerHTML =
      `<strong>Beta preview — illustrative figures only.</strong> Do not use figures here for investment decisions.`
      + `<span class="disclosure-long"> Audited filings are switched off, so every one of the ${U.length} companies here`
      + ` carries illustrative figures that are synthetic and do not represent real financials.`
      + ` Add ?real=1 to the address to load the filings.</span>`;
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
    /* The personal-research lane (?personal=1) is stated on its own: those are
       Bursa statements from the reader's own file, not SEC filings. */
    (k.personal ? `. ${k.personal} ${k.personal === 1 ? 'carries' : 'carry'} Bursa statements from your personal-research file — not SEC filings, not licensed, and not for redistribution` : '') +
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
      /* A search open while they loaded answers again with them: a filed
         company typed, or opened recently, was not there to list. */
      if (searchOpen) runSearch(searchInput.value);
      console.info(`real data: +${res.added} SEC-filed companies`);
    })
    .catch(err => {
      realStatus = { ok: false, error: err.message };
      /* The fetch failed, so the sample set is now the only thing there is.
         Painting it, honestly labelled, beats a skeleton that waits forever —
         and realStatus carries the failure so the page can say what happened. */
      realPending = false;
      refreshSearchLabel();
      /* Routed again rather than only repainted: a company slug that waited
         for the filings is resolved against what did load, which may make it a
         404 now. */
      applyRoute();
      /* The banner has a failed-load wording; nothing called it from here. */
      refreshDisclosure();
      /* And an open search says which tools the failure made unusable. */
      if (searchOpen) runSearch(searchInput.value);
      console.warn('real data failed to load:', err.message);
    });
}

/* Through the same function, so the pending case cannot be handled in one place
   and forgotten in the other. This synchronous write is what put "36" on screen
   between DOMContentLoaded and the filings landing. */
refreshSearchLabel();
/* With the filings off nothing else ever writes the banner, so it is written
   once here; with them on it waits for the load, as above. */
if (!realEnabled()) refreshDisclosure();

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
    /* This runs at boot, before the filings land, when only the sample set
       can be searched — so #research/abbv/financials, a filed company, fell
       through to /research and the link lost its company and its tab. The
       slug goes to the company address instead, whose route waits for the
       filings and only then calls an unknown name a 404. */
    if (realPending) {
      navigate(`/company/${encodeURIComponent(a)}` + (b && b !== 'snapshot' ? `?tab=${encodeURIComponent(b)}` : ''), { replace: true });
      return true;
    }
  }
  const path = LEGACY_VIEW_PATH[view] || (view === 'research' ? '/research' : null);
  if (!path) return false;
  if (view === 'discover' && a) State.discoverTab = a;
  if (view === 'learn' && a) State.learnTab = a;
  /* The tab goes into the address, which is where the router reads it; set
     only on State, /learn's own default (the dictionary) replaced it. */
  navigate(a && (view === 'discover' || view === 'learn') ? withQuery(path, a) : path, { replace: true });
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
    /* A safe cash with a cost line unpriced is a total so far, and the dock
       says so as the capstrip, the tile and the decision record do. With the
       reserve unpriced (a loan tenure of 0) it read "RM121.8k Safe cash" as
       the whole answer under a strip reading "So far — a line is unpriced". */
    const short = (m.missingCostLines || []).length > 0;
    return {
      figs: [
        { label: short ? 'Safe cash so far' : 'Safe cash', value: isNum(m.safeCashRequired) ? fmtAmount(m.safeCashRequired, 'MYR') : null },
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
          /* Into the list it opened. Focus stayed on the dock, which is last
             in the page, so the next Tab went on into the footer and the list
             was out of the keyboard's reach. Its summary takes focus; the
             next Tab is the list's first "Go to it". From the list's top, so
             the summary holding focus is in sight: centred, a list taller
             than the screen put it above the top edge. */
          det.querySelector('summary')?.focus({ preventScroll: true });
          det.scrollIntoView({ block: 'start' });
        },
      } : null,
    };
  },

  wheel: () => {
    const p = State.wheel, m = wheelMath(p), fit = wheelFit(p, m, null);
    const entered = num0(p.putStrike) > 0;
    /* The buffer is cash against an obligation, so it waits for one. A
       contract with no deliverable (no contracts, or an adjusted contract
       not yet verified) computes no obligation, and num0 made it nought: the
       dock read "$5.0k Cash buffer" in the colour of a surplus above a page
       saying collateral is suppressed until the terms are known. */
    const buffer = entered && isNum(m.requiredAssignmentCash) ? num0(p.eligibleCashUsd) - m.requiredAssignmentCash : null;
    return {
      figs: [
        { label: 'Assignment cash', value: entered && isNum(m.requiredAssignmentCash) ? fmtAmount(m.requiredAssignmentCash, 'USD') : null },
        { label: 'Cash buffer', value: buffer == null ? null : fmtAmount(buffer, 'USD'),
          tone: buffer == null ? null : (buffer < 0 ? '--dn-text' : '--ok-text') },
        { label: 'Worst case at zero', value: entered && isNum(m.putMaxLossIfZero) ? fmtAmount(m.putMaxLossIfZero, 'USD') : null, tone: '--dn-text' },
        { label: 'Phase', value: p.phase === 'call' ? 'Covered call' : 'Cash-secured put' },
      ],
      blocker: entered ? (fit.gates && fit.gates[0]) || null : 'No contract entered, so nothing is calculated yet.',
      next: entered ? null : {
        label: 'Load a worked contract',
        /* The dock is drawn again without this action once a contract is
           in, and focus fell to <body> with it. It goes where the page's own
           "Load a worked contract" sends it (80-registers.js): the banner
           that replaces the empty card, on the control that undoes the load. */
        onclick: () => {
          State.wheel = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true };
          saveWheel(); render(); focusAfterRedraw('#wheel-clear-example');
          toast('Worked contract loaded — illustrative figures');
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
        /* Confidence is scored apart from the run: a run is assessable before
           its five components are, and qttiRun leaves it null until all five
           are. String(null) put "Screenshot confidence: null" in the dock
           under a page that says it has not been scored. The decision record
           guards the same figure the same way. */
        { label: 'Screenshot confidence', value: r.assessable && isNum(r.confidence) ? String(r.confidence) : null },
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

/* Back and Forward are route changes too: the same scroll, drawer and focus
   treatment as a click, which they used to get none of. */
window.addEventListener('popstate', () => { const before = State.view; applyRoute(); afterRoute(before); });
/* The skip link lands focus the same way a route change does — and with the
   landmark's tabindex applied only for that moment. */
$('.skip-link')?.addEventListener('click', (e) => { e.preventDefault(); focusMain(); });
/* Anything else that still sets a hash keeps working. */
window.addEventListener('hashchange', () => { if (fromHash()) history.replaceState(history.state, '', location.pathname + location.search); });

/* Once every module has run. The build puts them in one script in file
   order, and the decision record defines its view after this one
   (97-decision-record.js): routed here, /decision-record found no view and
   drew "That page does not exist" — for as long as the filings took to
   land, when boot routes again and the page turned into the record under
   the reader, focus falling to <body>; and for good with the filings off
   (?real=0), when nothing routes again. */
queueMicrotask(() => { if (!fromHash()) applyRoute(); });

/* "Synthetic data only" was the banner's old sentence, true when the universe
   was the sample set and false since the filings joined it; at this line only
   the sample is loaded and the filings are still on their way. */
console.info('Quantum Tradeworks prototype — research only. %d illustrative companies at boot%s, %s', U.length,
  realPending ? '; the SEC-filed set is loading' : '', MODEL_VERSION);
