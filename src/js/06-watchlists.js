/* ==========================================================================
   WATCHLISTS — one service, not four call sites

   A watchlist was mutated from three places (the company page's toggle, the
   manager drawer, the seed in 05-plans.js) and read from a dozen, each
   reaching into `w.ids` directly. The Phase 2 brief asks for a shared
   service: create, rename, delete, add without duplicates, remove, and a
   stable shape a scanner can take as its universe. This is that service.

   THE SHAPE IS KEPT, AND EXTENDED. `w.ids` — an ordered list of company ids —
   stays exactly what it was, because every reader in the app (the change
   feed, the alerts, the screener's watchlist filter, the Tracked view) reads
   it, and a second copy of the membership would drift. What is added beside
   it: `createdAt` and `updatedAt` on the list, `added[companyId]` with the
   date each company was added, and an accessor that presents the brief's
   WatchlistItem shape — an item id, the watchlist id, the canonical
   instrument id, the date — without storing it twice.

   NO OWNER. There are no accounts, so there is no ownerId to enforce; a
   watchlist belongs to the browser it was saved in, and the export says so.
   That is a limitation stated, not a field invented.
   ========================================================================== */

const WATCHLIST_SCHEMA = 2;

/* A monotonic suffix, because timestamps collide. Ids were `wl-${Date.now()}`,
   and an import creates its lists in one synchronous loop, so two lists made
   in the same millisecond shared an id — every lookup is a find() on id, so
   the second list's members went into the first, and a later rename or delete
   acted on the wrong one. The same collision, and the same cure, as saved
   work's ids in 15-derivation.js. */
let WL_SEQ = 0;
const nextWatchlistId = () => `wl-${Date.now().toString(36)}-${(WL_SEQ++).toString(36)}`;

/* One-time migration of what the browser already holds. Lists that predate
   timestamps get null with the reason, never a plausible date. */
function migrateWatchlists() {
  const now = new Date().toISOString();
  let touched = false;
  /* A stored value this service never writes — not a list of lists, or an
     entry that is not a list (a hand-edited or truncated backup restored
     through "Your data", which writes whatever the file holds) — threw
     below on w.id. This runs at the top level of the one script, so the
     throw stopped the whole app: every page blank until the browser's
     storage was cleared, which nothing on a blank page can do. What cannot
     be read as a list is dropped. With nothing readable left the reader
     gets one empty list of their own, as clearing the sample data does,
     because the active-list readers (activeWL, toggleWatch) assume one. */
  if (!Array.isArray(State.watchlists)) { State.watchlists = []; touched = true; }
  const readable = State.watchlists.filter(w => w && typeof w === 'object' && !Array.isArray(w));
  if (readable.length !== State.watchlists.length) { State.watchlists = readable; touched = true; }
  if (!State.watchlists.length) {
    State.watchlists = [{ id: nextWatchlistId(), name: 'My watchlist', ids: [], added: {}, createdAt: now, updatedAt: now, schema: WATCHLIST_SCHEMA }];
    State.wlIdx = 0;
    touched = true;
  }
  /* Lists already stored under a shared id (an import made before ids had a
     suffix) are separated: the first keeps the id and each later one gets its
     own. Members already merged cannot be told apart again, but the lists stop
     colliding. */
  const seenIds = new Set();
  (State.watchlists || []).forEach(w => {
    if (!w.id || seenIds.has(w.id)) { w.id = nextWatchlistId(); touched = true; }
    seenIds.add(w.id);
    if (!Array.isArray(w.ids)) { w.ids = []; touched = true; }
    if (!('createdAt' in w)) { w.createdAt = null; w.createdAtSource = 'list predates timestamps — unknown'; touched = true; }
    if (!('updatedAt' in w)) { w.updatedAt = null; touched = true; }
    /* An array passed the object test, and the dates written onto it were
       dropped by JSON.stringify at every save — each member's date lost. */
    if (!w.added || typeof w.added !== 'object' || Array.isArray(w.added)) { w.added = {}; touched = true; }
    w.ids.forEach(id => { if (!(id in w.added)) { w.added[id] = null; touched = true; } });
    if (w.schema !== WATCHLIST_SCHEMA) { w.schema = WATCHLIST_SCHEMA; w.migratedAt = now; touched = true; }
  });
  if (touched) saveWatchlists();
}

const wlById = (wlId) => (State.watchlists || []).find(w => w.id === wlId) || null;
const wlTouch = (w) => { w.updatedAt = new Date().toISOString(); };

/* Create. The limit is the plan's, and the reason a creation is refused is
   returned, never toasted from inside a service. */
function wlCreate(name) {
  if (State.watchlists.length >= LIMITS.watchlists) return { ok: false, why: `${LIMITS.watchlists} watchlists is the maximum on this plan` };
  const now = new Date().toISOString();
  const w = { id: nextWatchlistId(), name: String(name || '').trim() || `Watchlist ${State.watchlists.length + 1}`,
              ids: [], added: {}, createdAt: now, updatedAt: now, schema: WATCHLIST_SCHEMA };
  State.watchlists.push(w);
  State.wlIdx = State.watchlists.length - 1;
  saveWatchlists();
  return { ok: true, watchlist: w };
}
function wlRename(wlId, name) {
  const w = wlById(wlId);
  if (!w) return { ok: false, why: 'no such watchlist' };
  const next = String(name || '').trim();
  if (!next) return { ok: false, why: 'a watchlist needs a name' };
  w.name = next; wlTouch(w); saveWatchlists();
  return { ok: true, watchlist: w };
}
function wlDelete(wlId) {
  const i = (State.watchlists || []).findIndex(w => w.id === wlId);
  if (i < 0) return { ok: false, why: 'no such watchlist' };
  if (State.watchlists.length <= 1) return { ok: false, why: 'the last watchlist stays — empty it instead' };
  State.watchlists.splice(i, 1);
  /* The active list stays the active list. Removing one above it shifts its
     index down by one; only clamping made the next list along silently active,
     and the alert feed, the dashboard and the company page's toggle all follow
     the active list. */
  if (i < State.wlIdx) State.wlIdx--;
  State.wlIdx = Math.max(0, Math.min(State.wlIdx, State.watchlists.length - 1));
  saveWatchlists();
  return { ok: true };
}

/* Add by any name the registry knows — a ticker, a listing code, a CIK, an
   old id. A duplicate is refused and says so; a name that resolves to no
   company row (a price-only instrument, or nothing) is refused with the
   reason. This is an add, not a toggle: adding something already present
   never removes it. */
function wlAdd(wlId, term) {
  const w = wlById(wlId);
  if (!w) return { ok: false, why: 'no such watchlist' };
  const id = BY_ID.has(String(term || '').toUpperCase()) ? BY_ID.get(String(term).toUpperCase()).c.id : companyIdFor(term);
  if (!id || !BY_ID.has(id)) {
    const ins = resolveInstrument(term);
    return { ok: false, why: ins ? `${ins.symbol} is tracked by price only — it has no statements and no company page` : `nothing in the universe is called “${term}”`, term };
  }
  if (w.ids.includes(id)) return { ok: false, why: 'already in this watchlist', duplicate: true, id };
  if (w.ids.length >= LIMITS.watchlistStocks) return { ok: false, why: `“${w.name}” already holds the maximum of ${LIMITS.watchlistStocks} companies on this plan`, id };
  w.ids = [...w.ids, id];
  w.added[id] = new Date().toISOString();
  wlTouch(w); saveWatchlists();
  return { ok: true, id, watchlist: w };
}
function wlRemove(wlId, companyId) {
  const w = wlById(wlId);
  if (!w) return { ok: false, why: 'no such watchlist' };
  if (!w.ids.includes(companyId)) return { ok: false, why: 'not in this watchlist' };
  w.ids = w.ids.filter(x => x !== companyId);
  delete w.added[companyId];
  wlTouch(w); saveWatchlists();
  return { ok: true };
}

/* The brief's WatchlistItem shape, presented rather than stored. */
function watchlistItems(w) {
  return (w?.ids || []).map(companyId => {
    const row = BY_ID.get(companyId);
    const ins = row ? instrumentOfCompany(row.c) : null;
    return { id: `${w.id}:${companyId}`, watchlistId: w.id, companyId: row?.c.id || companyId,
             instrumentId: ins?.id || null, symbol: ins?.symbol || null, market: ins?.market || row?.c.mkt || null,
             name: row?.c.name || null, coverage: ins ? coverageLabel(ins) : 'not in the universe',
             addedAt: w.added?.[companyId] ?? null, resolves: !!row };
  });
}
/* The symbols the price history and the scanner use for a watchlist — the
   handoff the Phase 3 brief asks for, and what the scanner's 'watchlist'
   universe snapshots into a setup. Unresolved members are named, never
   dropped silently. */
function watchlistSymbols(wlId) {
  const w = wlById(wlId);
  if (!w) return { symbols: [], unresolved: [], name: null };
  const items = watchlistItems(w);
  return { name: w.name, symbols: items.filter(i => i.symbol).map(i => i.symbol),
           unresolved: items.filter(i => !i.symbol).map(i => i.companyId), asOf: new Date().toISOString().slice(0, 10) };
}
/* The export: every list with the brief's fields, versioned and stamped, and
   honest about where it lives. Import accepts the same shape and the older
   { id, name, ids } one.
   The scanner's worker reads this same document, saved as
   data/watchlists.json by "Export for the scanner" (round 3 contract C3):
   it resolves a setup's list by watchlists[].id, takes the members'
   items[].symbol, and records exportedAt as when the list was taken. So
   those three fields are the worker's input as well as the reader's
   backup, and changing their shape changes what the scanner evaluates. */
function watchlistsExport() {
  return { kind: 'quantum-tradeworks-watchlists', schema: WATCHLIST_SCHEMA, exportedAt: new Date().toISOString(),
           owner: 'this browser — there are no accounts, so no ownerId',
           watchlists: (State.watchlists || []).map(w => ({ id: w.id, name: w.name, createdAt: w.createdAt, updatedAt: w.updatedAt, items: watchlistItems(w) })) };
}
function watchlistsImport(doc) {
  const lists = Array.isArray(doc) ? doc : Array.isArray(doc?.watchlists) ? doc.watchlists : null;
  if (!lists) return { ok: false, why: 'not a watchlists export' };
  const report = { created: 0, added: 0, duplicate: 0, unresolved: [], refused: [] };
  /* An entry that is not a list threw on src.name part-way through, with
     the lists before it already made, and the reader was told only that
     the file could not be read. It is refused by position instead. */
  lists.forEach((src, n) => {
    if (!src || typeof src !== 'object' || Array.isArray(src)) { report.refused.push(`entry ${n + 1}: not a watchlist`); return; }
    const name = String(src.name || 'Imported').trim();
    let w = State.watchlists.find(x => x.name === name);
    if (!w) { const r = wlCreate(name); if (!r.ok) { report.refused.push(`${name}: ${r.why}`); return; } w = r.watchlist; report.created++; }
    const members = Array.isArray(src.items) ? src.items.map(i => i?.companyId || i?.instrumentId || i?.symbol) : (Array.isArray(src.ids) ? src.ids : []);
    for (const term of members) {
      const r = wlAdd(w.id, term);
      /* A company refused for the plan's limit was reported with the names
         nothing resolves — "not recognised" — though wlAdd had found it.
         A refusal that names the company it resolved is a refusal, with
         its reason; only a term that resolves to nothing is unresolved. */
      if (r.ok) report.added++; else if (r.duplicate) report.duplicate++;
      else if (r.id) report.refused.push(`${r.id}: ${r.why}`);
      else report.unresolved.push(String(term));
    }
  });
  return { ok: true, ...report };
}

migrateWatchlists();
