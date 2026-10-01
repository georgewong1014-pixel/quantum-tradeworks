/* ==========================================================================
   RECENT — WHAT THE READER LAST OPENED, IN THIS BROWSER (Release B, B4)

   With nothing typed, the search lists the last things the reader opened —
   companies, pages and tools, and their own saved work — newest first, each
   with when (95-boot.js draws it). This is the record behind that list. It
   lives where everything else the reader keeps lives, in this browser's
   local storage; nothing is sent anywhere, and nothing asks the network
   for anything to keep it. It holds twenty at most, and the search's
   "Clear recent" empties it.

   ONE RECORD OF WHICH COMPANIES WERE OPENED. The company page already keeps
   one: recentCompanies, written when a report is actually drawn — after the
   plan's meter, so a report it refused was never "opened" — and read by
   Equities' "Recently viewed" and by the dashboard, whose "Continue where
   you left off" lists the recently opened companies and whose "Research a
   company" step is ticked by it. A second list of companies here would be a
   second tracker, free to disagree with the first. So the companies Recent
   lists ARE that list, in its order; this record adds only the time each one
   was opened, and the pages and the saved work, which nothing else kept.
   Clearing recent clears both, so no page goes on listing a company the
   reader asked to be forgotten.

   RECORDED AS THE READER MOVES. A page is noted when it is drawn — never
   the skeleton that waits for the filings, never the not-found card — and
   once a visit: redrawing the page on screen (a theme switch, a filter
   moved, the filings landing) notes nothing. What is noted is what the
   reader would open again:
   - a company page, as the company, once the page has counted it as read;
   - a company's printable report, as that page, on the same condition;
   - a scanner setup's page or its editor, as the setup, while this browser
     holds it;
   - the property calculator while it edits a saved property, as that
     property;
   - a saved item opened from the search, as that item (recentOpen) — not as
     the page it happens to open on;
   - any other page with an address of its own, by its canonical address, so
     /wheel and /us-options/wheel are one page. A page of one record — a
     scanner alert — is not noted: its record is the worker's, and can be
     gone the next time the list is read.
   Every entry is resolved again whenever the list is drawn, and one that no
   longer resolves — a company not loaded here, a deleted setup, a page this
   build does not have — is left out, so Recent never offers a door to
   nothing.
   ========================================================================== */

const RECENT_CAP = 20;

/* The record as this module writes it, whatever storage holds. A backup
   restored through Your data writes whatever the file carries, and a
   hand-edited one must not take the search down with it: anything not in
   the shape written here is dropped, entry by entry. */
function recentRead() {
  const raw = store.read('recent', null);
  const rec = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const when = (t) => typeof t === 'string' && Number.isFinite(Date.parse(t));
  const items = (Array.isArray(rec.items) ? rec.items : []).filter(e => e && typeof e === 'object'
    && (e.k === 'page' || (e.k === 'saved' && typeof e.type === 'string' && e.type))
    && typeof e.id === 'string' && e.id && when(e.t)).slice(0, RECENT_CAP);
  const co = {};
  if (rec.co && typeof rec.co === 'object' && !Array.isArray(rec.co))
    for (const [id, t] of Object.entries(rec.co)) if (when(t)) co[id] = t;
  return { items, co };
}
/* A refused write of this record is not the reader's work being refused.
   The count a save reads to say "Not saved" (store.failed, 00-core.js) is
   left as it was, so a page noted in the same moment as a save cannot make
   that save report a refusal that was not its own. */
function recentWrite(r) {
  const failed = store.failed;
  const ok = store.write('recent', { items: r.items.slice(0, RECENT_CAP), co: r.co });
  store.failed = failed;
  return ok;
}

/* The company a stored id is now: a retired stand-in's id resolves to the
   filer's row (BY_ID keeps the alias), so a time noted under the old id
   still belongs to the company. */
const recentCompanyId = (id) => BY_ID.get(id)?.c.id || null;
/* The company page's list and the meter's, read as lists whatever a
   restored backup put there: this runs on every page drawn. */
const recentCompanyList = () => (Array.isArray(State.recentCompanies) ? State.recentCompanies : []);
const recentReportsRead = () => (Array.isArray(State.reportLog?.ids) ? State.reportLog.ids : []);

/* One thing opened, now: k is 'company', 'page' or 'saved'; a saved item
   also carries its type ('watchlist', 'setup', 'property'…). Newest first,
   one entry per thing. */
function recentNote(k, id, { type = null, at = new Date() } = {}) {
  if (!id) return;
  const r = recentRead();
  const t = at.toISOString();
  if (k === 'company') {
    /* Only a company the company page's own list holds, and only the
       companies it still holds keep a time here — by the id it holds, or
       the company that id is now, loaded or not. */
    const list = recentCompanyList();
    const held = new Set([...list, ...list.map(recentCompanyId).filter(Boolean)]);
    const cid = recentCompanyId(id) || id;
    if (!held.has(cid)) return;
    r.co[cid] = t;
    for (const x of Object.keys(r.co)) if (!held.has(recentCompanyId(x) || x) || (x !== cid && recentCompanyId(x) === cid)) delete r.co[x];
  } else {
    const same = (e) => e.k === k && e.id === id && (e.type || null) === (type || null);
    r.items = [{ k, ...(type ? { type } : {}), id, t }, ...r.items.filter(e => !same(e))];
  }
  recentWrite(r);
}

/* Everything recent, newest first, as entries still to be resolved: the
   companies of the company page's own list — in its order, each with the
   time this record noted, where it has one — and the pages and saved work.
   A company whose row is not loaded here (a filed company while the
   filings are still on their way) is left out until it is. A company opened
   before times were kept comes after everything that has one, in the list's
   own order, with no time: it is not given one it does not have. */
function recentEntries() {
  const r = recentRead();
  const at = {};
  for (const [id, t] of Object.entries(r.co)) {
    const cid = recentCompanyId(id);
    if (cid && (!at[cid] || Date.parse(t) > Date.parse(at[cid]))) at[cid] = t;
  }
  const seen = new Set(), cos = [];
  for (const id of recentCompanyList()) {
    const cid = recentCompanyId(id);
    if (!cid || seen.has(cid)) continue;
    seen.add(cid);
    cos.push({ k: 'company', id: cid, t: at[cid] || null });
  }
  const timed = [...cos.filter(e => e.t), ...r.items].sort((a, b) => Date.parse(b.t) - Date.parse(a.t));
  return [...timed, ...cos.filter(e => !e.t)].slice(0, RECENT_CAP);
}

/* "Clear recent": this record, and the company page's list with it — the
   one record of which companies were opened (above), so Equities' Recently
   viewed and the dashboard's recently opened companies go with it. */
function recentClear() {
  recentWrite({ items: [], co: {} });
  State.recentCompanies = [];
  store.write('recentCompanies', []);
}

/* ------------------------------------------------------------- the pages */
/* What the page on screen is, as something to open again — or null for a
   page that is not noted (see the head of this file). */
function recentOnScreen(route) {
  const v = route.view;
  if (v === 'research' || v === 'researchReport') {
    const row = BY_ID.get(State.ticker);
    if (!row) return null;
    /* Read, not refused: the company page put it at the head of its own
       list; a report was counted by the plan's meter. */
    if (v === 'research') return recentCompanyList()[0] === row.c.id ? { k: 'company', id: row.c.id } : null;
    return recentReportsRead().includes(row.c.id) ? { k: 'page', id: `${companyPath(row.c)}/report` } : null;
  }
  if (v === 'scannerSetup' || v === 'scannerSetupEdit') {
    let id = '';
    try { id = decodeURIComponent(route.params?.setup || ''); } catch { id = ''; }
    const st = id && typeof scanStoreRead === 'function' ? scanStoreRead() : null;
    const rec = st?.setups?.[id];
    return rec && !rec.deleted ? { k: 'saved', type: 'setup', id } : null;
  }
  if (v === 'property') {
    const mid = State.deal?.modelId;
    if (mid && typeof pmFind === 'function' && pmFind(mid)) return { k: 'saved', type: 'property', id: mid };
  }
  if (route.path.includes(':')) return null;
  /* A page by the address it was opened at, where that is its own: the
     calculator is "Calculator", though its canonical address is Property's
     front page. An alias by its canonical; Learn and the screener by theirs,
     which name the tab on screen. */
  return { k: 'page', id: route.alias || v === 'learn' || v === 'discover' ? canonicalPath(route) : route.path };
}

/* The page on screen, as it would be noted — or null. The search leaves it
   out of Recent: it is where the reader already is, and Enter in the empty
   box should take them back to where they were, not reopen it. */
function recentHere() {
  const v = State.view;
  if (!v || v === 'notfound' || (realPending && UNIVERSE_VIEWS.has(v))) return null;
  const route = matchRoute(location.pathname);
  return route && VIEWS[route.view] ? recentOnScreen(route) : null;
}

/* The page last noted, by what cheaply tells one page from another, so a
   redraw of the page on screen reads nothing more than this. */
let recentSeenAt = null;
/* A saved item the search is opening: noted as itself on the page it opens
   on (recentOpen, below). */
let recentOpening = null;
function recentOnPage() {
  const v = State.view;
  if (!v || v === 'notfound' || (realPending && UNIVERSE_VIEWS.has(v))) return;
  const route = matchRoute(location.pathname);
  if (!route || !VIEWS[route.view]) return;
  const opening = recentOpening;
  recentOpening = null;
  const tabbed = (v === 'learn' || v === 'discover') ? new URLSearchParams(location.search).get('tab') || '' : '';
  const company = v === 'research' || v === 'researchReport' ? `${State.ticker}|${recentCompanyList()[0]}|${recentReportsRead().length}` : '';
  const at = [v, location.pathname, tabbed, company, v === 'property' ? State.deal?.modelId || '' : ''].join('|');
  if (at === recentSeenAt && !opening) return;
  recentSeenAt = at;
  const what = opening ? { k: 'saved', ...opening } : recentOnScreen(route);
  if (what) recentNote(what.k, what.id, { type: what.type });
}
/* Every page is drawn into #views by render(), which replaces its one child;
   the note is taken after the draw, when the address, the view and what the
   page counted are all settled. The shell watches the same node the same
   way for its headings and its links to tools (35-ui.js). */
/* A note that cannot be taken is only a line left out of a list: it must
   never reach the reader as a fault on the page they opened. */
const recentWatch = new MutationObserver(() => {
  try { recentOnPage(); } catch (e) { console.warn('recent: this page was not noted —', e.message); }
});
recentWatch.observe(viewRoot, { childList: true });

/* Open a saved item from the search, noted as the item. Where opening it
   draws a page, the note is taken there; where it opens a drawer on the
   page already on screen, it is taken here. */
function recentOpen(type, id, open) {
  recentOpening = { type, id };
  try { open(); }
  finally {
    queueMicrotask(() => {
      if (!recentOpening || recentOpening.type !== type || recentOpening.id !== id) return;
      recentOpening = null;
      recentNote('saved', id, { type });
    });
  }
}
