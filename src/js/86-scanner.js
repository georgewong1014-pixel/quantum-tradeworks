/* ==========================================================================
   TRADE-SETUP SCANNER — personal lane

   Conditions you define, evaluated on price history you supplied, producing a
   record of which conditions were met on which completed bar. That sentence
   is the whole product boundary, and every clause in it is load-bearing:

   YOURS. The rules are the reader's. Nothing here proposes a setup, ranks one
   setup against another, or orders the instruments that matched. A table of
   matches sorted by "strength" is a pick list, and this product does not make
   those — Malaysia's SC treats algorithmic ranking as advice for licensing
   purposes, and the boundary is a design, not a disclaimer.

   YOUR DATA. The only prices this evaluates are the ones in the reader's own
   data/price-history.json — read off their own screen under their own
   subscription, or imported from their own export. No feed is licensed to
   this product, so no scan can run on anything else, and none is offered to
   anyone else. A scanner for other people needs a licensed end-of-day feed
   and written legal classification; neither exists, and the page says so.

   A RECORD, NOT A SIGNAL. A match says "on this bar these conditions held",
   with the values. It does not say buy, sell, or that the conditions mean
   anything. No indicator here has been validated on point-in-time data, so
   none is claimed to work — the same statement the Trading Index makes.

   NOTHING DELIVERED. There is no server, so there is no email, no Telegram
   and no push. Alerts land in a file the worker writes and this page reads;
   the in-app notification centre is the alerts page and its unread count.

   ONE ENGINE. The engine lives in 24-market-engine.js, between the
   @scan-engine markers; scanner/scan.mjs slices that region out of
   index.html and runs it in Node, so the daily worker and this page cannot
   evaluate a rule differently — the Trading Index pattern. This file is the
   reader's pages: setups and their versions, the builder, the watchlist
   scanner, the alerts and their detail, and the settings. The dashboard,
   market screening, historical testing and the operations views belong to
   the operations pages (87-scanner-ops.js).
   ========================================================================== */

/* ---------------------------------------------------------------- files --- */
/* Files the worker writes and this page reads. Both are git-ignored and live
   only on the reader's machine; on the deployed site they 404 and the page
   says what it would show. */
let scanSetupsFile = null, scanAlertsFile = null;
/* data/price-history.json exactly as the worker reads it, taken before the
   closes the reader pasted into this browser are merged into trackedHistory.
   The page scanned the merged copy, so "Evaluate now" and "Test" showed
   matches on series the worker cannot see, and on a later bar than it has. */
let scanHistoryFile = null;

/* Every page here names companies through scanSymbolLink, which reads BY_ID,
   so each waits for the filings as the old combined page did. Registered
   from this file, so the route table's other owners and this one do not edit
   the same lines. */
const SCAN_USER_VIEWS = ['scannerSetups', 'scannerSetupNew', 'scannerSetup', 'scannerSetupEdit', 'scannerWatchlists', 'scannerAlerts', 'scannerAlert', 'scannerSettings'];
SCAN_USER_VIEWS.forEach(v => UNIVERSE_VIEWS.add(v));
Object.assign(META, {
  scannerSetups: 'Your scanner setups, each with its versions, and whether this browser and the worker’s file agree. Nothing proposed, nothing ranked.',
  scannerSetupNew: 'Write a scanner setup from conditions you choose, test it on your own history, and save it as a version.',
  scannerSetup: 'One scanner setup: its current version, every earlier version, and the matches each version recorded.',
  scannerSetupEdit: 'Edit a scanner setup. A change to what it evaluates saves as a new version; the old one is kept.',
  scannerWatchlists: 'Your watchlists as scanner universes: which setups use each list, and whether their snapshot still matches it.',
  scannerAlerts: 'Every match the worker recorded, in date order, with its status in this browser. Nothing ranked, nothing sent.',
  scannerAlert: 'One recorded match: the bar, the data behind it, the setup version, and every condition with its values.',
  scannerSettings: 'Scanner notifications and display preferences. In-app only; email, Telegram and push are not configured.',
});

/* ------------------------------------------------------------- helpers --- */
/* The engine's own words for a rule, so the rule a reader sees is the rule
   that runs. A missing value prints as '?', never as a number. A 0.2 rule
   and a V2 condition read the same through scanConditionProse. */
const scanRuleProse = (r) => scanConditionProse(scanNormaliseNode(r));
/* A watchlist universe is resolved one of two ways (round 3 contract C3):
   from the snapshot of symbols the setup carries, which is the default and
   what an absent `resolve` means, or by the worker from the lists last
   exported for it (data/watchlists.json). Only the second changes who
   decides the members at run time, so only it is named. */
const scanResolvesByExport = (u) => u?.kind === 'watchlist' && u.resolve === 'export';
const scanUniverseProse = (u) => !u || u.kind === 'all' ? 'every instrument with a series in your history'
  : u.kind === 'market' ? `the ${u.market === 'MY' ? 'Bursa Malaysia' : u.market || '?'} instruments in your history`
  : u.kind === 'watchlist' ? (scanResolvesByExport(u)
    ? `watchlist “${u.name || u.watchlistId || '?'}”, resolved at run time from your latest export of it (data/watchlists.json) — its snapshot of ${u.asOf || '?'} (${(u.symbols || []).join(', ') || '—'}) stands in when the export does not hold it`
    : `watchlist “${u.name || u.watchlistId || '?'}” — ${(u.symbols || []).length} symbol${(u.symbols || []).length === 1 ? '' : 's'} as of ${u.asOf || '?'}: ${(u.symbols || []).join(', ') || '—'}`)
  : `${(u.symbols || []).length} named instrument${(u.symbols || []).length === 1 ? '' : 's'}: ${(u.symbols || []).join(', ') || '—'}`;
const scanDay = (t) => (t ? String(t).slice(0, 10) : '—');
const scanStamp = (t) => (t ? String(t).replace('T', ' ').slice(0, 16) : '—');
const scanPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const scanRegistryList = () => (typeof instruments !== 'undefined' && instruments?.instruments) || [];
const scanClone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));

/* ONE INDICATOR CACHE FOR THE PAGE SESSION. "Evaluate now", the builder's
   Test and an alert's re-evaluation each built a cache for one click, so
   the same EMA50 on the same series was computed again at every click. The
   page keeps one, keyed exactly as a run's is — symbol, timeframe, the
   series' data version, the operand without its multiplier, and the
   formula's calcVersion — so a changed close is a new data version and a
   miss, never a stale hit. Nothing is stored: at a hundred series of a few
   hundred bars recomputing costs milliseconds, so the cache is dropped when
   the history object is replaced, or past a size no session of clicks
   reaches. */
const SCAN_SESSION_CACHE_MAX = 20000;
let scanSessionCache = null, scanSessionCacheOf = null;
function scanPageCache() {
  if (!scanSessionCache || scanSessionCacheOf !== scanHistoryFile || scanSessionCache.size() > SCAN_SESSION_CACHE_MAX) {
    scanSessionCache = scanCache();
    scanSessionCacheOf = scanHistoryFile;
  }
  return scanSessionCache;
}
/* A run on this page, on the session's cache. The run's own cacheStats are
   the cache's totals since the session began; what this run computed and
   what it found already computed are the difference, which its summary
   states. */
function scanRunHere(setups, history, opts = {}) {
  const C = scanPageCache();
  const h0 = C.stats.hits, m0 = C.stats.misses;
  const r = scanRun(setups, history, { ...opts, cache: C });
  r.sessionCache = { hits: C.stats.hits - h0, misses: C.stats.misses - m0 };
  return r;
}

/* A symbol in the record, as a link to what the app knows about it: the
   company page where the symbol is a company's, the Tracked view where it is
   price-only, plain text where it is neither. */
function scanSymbolLink(symbol) {
  const id = companyIdFor(symbol);
  const row = id ? BY_ID.get(id) : null;
  if (row) return el('a', { href: href(companyPath(row.c)), onclick: (e) => { e.preventDefault(); openResearch(row.c.id); } }, symbol);
  if (resolveInstrument(symbol)) return el('a', { href: href('/my/tracked'), onclick: (e) => { e.preventDefault(); navigate('/my/tracked'); } }, symbol);
  return el('span', {}, symbol);
}
/* An in-app link that keeps the browser's own link behaviour. */
function scanLink(path, text, attrs = {}) {
  return el('a', { href: href(path), ...attrs, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(path); } }, text);
}
const scanSetupPath = (id, version = null) => `/app/scanner/setups/${encodeURIComponent(id)}${version != null ? `?version=${version}` : ''}`;
/* An alert's address is its id. Two different keys can, rarely, hash to
   one eight-digit id; where the loaded record holds such a pair, each one's
   address also carries its key, so every row still opens its own record. */
const scanAlertPath = (a) => {
  const id = scanAlertIdOf(a) || '';
  return `/app/scanner/alerts/${encodeURIComponent(id)}${a?.key && scanIdCollisions().has(id) ? `?key=${encodeURIComponent(a.key)}` : ''}`;
};

/* The scanner's section strip. The operations pages own the dashboard and
   may define scannerSubnav(); where they have, every scanner page shares
   it. Otherwise this one lists the scanner pages whose routes resolve, so a
   link never leads to the not-found card. */
const SCAN_SUBNAV = [
  { id: 'dashboard', label: 'Dashboard', path: '/app/scanner' },
  { id: 'market', label: 'Market', path: '/app/scanner/market' },
  { id: 'setups', label: 'Setups', path: '/app/scanner/setups' },
  { id: 'watchlists', label: 'Watchlists', path: '/app/scanner/watchlists' },
  { id: 'alerts', label: 'Alerts', path: '/app/scanner/alerts' },
  { id: 'backtest', label: 'Historical', path: '/app/scanner/backtest' },
  { id: 'settings', label: 'Settings', path: '/app/scanner/settings' },
];
function scanSubnav(active) {
  if (typeof scannerSubnav === 'function') return scannerSubnav(active);
  const row = el('nav', { class: 'segmented', 'aria-label': 'Scanner pages', style: 'flex-wrap:wrap;align-self:flex-start' });
  const unread = scanUnreadCount();
  SCAN_SUBNAV.filter(s => { const r = matchRoute(s.path); return r && VIEWS[r.view]; }).forEach(s => {
    const n = s.id === 'alerts' && unread ? unread : 0;
    row.append(el('a', {
      href: href(s.path), 'aria-selected': active === s.id ? 'true' : 'false', 'aria-current': active === s.id ? 'page' : null,
      'aria-label': n ? `${s.label}, ${n} unread` : null,
      onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(s.path); } }, n ? `${s.label} · ${n}` : s.label));
  });
  return row;
}
function scanPageHead(title, lede, eyebrow = 'Quantum Scanner · personal lane') {
  return el('div', { class: 'page-hd', style: 'margin-bottom:0' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, eyebrow),
    el('h1', {}, title),
    lede ? el('p', { class: 'body-lg', style: 'margin-top:8px' }, lede) : null,
  ]));
}
const scanPage = () => el('div', { class: 'scan-page' });
/* A download of a JSON document, as the watchlists page does it. */
function scanDownload(name, doc) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function scanCopy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); return true; }
  catch { toast('Could not reach the clipboard — the JSON is shown on the page to copy by hand'); return false; }
}
/* A card saying an address names nothing in the reader's record — never the
   not-found card: the page exists; the record does not hold that one. */
function scanNotInRecord(what, detail, back) {
  const card = el('div', { class: 'card' });
  card.append(el('p', { class: 'eyebrow' }, 'Not in your record'));
  card.append(el('h2', { class: 'h-card', style: 'margin-top:4px' }, what));
  card.append(el('p', { class: 'body', style: 'margin-top:8px' }, detail));
  if (back) card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, scanLink(back[0], back[1], { class: 'btn btn-ghost btn-sm' })));
  return card;
}
/* Whether a pointer is pressed at this moment: from its pointerdown until
   the click that ends it (a touch blurs a field only after it lifts, so
   pointerup is too early), or two seconds if no click comes. */
let scanPressedAt = -Infinity, scanPressOver = true;
document.addEventListener('pointerdown', () => { scanPressedAt = Date.now(); scanPressOver = false; }, true);
['click', 'pointercancel'].forEach(t => document.addEventListener(t, () => { scanPressOver = true; }, true));
const scanPressing = () => !scanPressOver && Date.now() - scanPressedAt < 2000;
/* REDRAW, AND KEEP THE READER'S PLACE. render() replaces the page, so the
   select, checkbox or button that asked for it was destroyed under the
   reader and focus fell to <body>: an alerts filter changed by arrow key
   took the first press and ignored the next, and every Mark read, Disable,
   Archive or display setting sent a keyboard reader back to the top of the
   page. The screener's renderKeepFocus finds the control again by its id;
   scanner fields are numbered afresh at every render, so this finds it by
   name — a data-scan-focus key where a control's label changes with its
   state (Disable and Enable, Archive and Unarchive), else its accessible
   name, else its text — passing over one now disabled, and falls back to
   the control named when the one pressed is gone. `focus` names the
   control focus is moving to, where that is not yet the active one. */
const scanFocusKey = (n) => n?.dataset?.scanFocus || n?.getAttribute?.('aria-label') || (n?.tagName ? `${n.tagName}:${n.textContent.trim()}` : null);
function scanRender({ fallback = null, focus = null } = {}) {
  const a = focus || document.activeElement;
  const key = a && a !== document.body && document.querySelector('main')?.contains(a) ? scanFocusKey(a) : null;
  render();
  if (!key) return;
  const pool = [...document.querySelectorAll('main button, main a[href], main input, main select, main textarea')].filter(n => !n.disabled);
  (pool.find(n => scanFocusKey(n) === key) || (fallback ? pool.find(n => scanFocusKey(n) === fallback) : null))?.focus({ preventScroll: true });
}

/* A labelled fact, for the detail pages' key–value grids. An absent value
   says why it is absent rather than printing a dash that could be a zero. */
function scanFact(label, value, sub) {
  const d = el('div', { class: 'scan-fact' });
  d.append(el('div', { class: 'stat-label' }, label));
  d.append(el('div', { class: 'scan-fact-v' }, value == null || value === '' ? el('span', { class: 'caption' }, 'not recorded') : value));
  if (sub) d.append(el('div', { class: 'caption', style: 'margin-top:2px' }, sub));
  return d;
}

/* =====================================================================
   SETUPS IN THIS BROWSER — versioned

   The builder used to write JSON for the reader to paste, and kept nothing:
   a second copy in the browser would be the drift this codebase keeps
   finding in itself. The specification asks for saved setups with versions,
   so the copy exists now — and the drift is the thing the pages show, per
   setup, in words: in step with the worker's file, saved here and not
   exported, the file holding a version this browser has not seen, or only
   on one side. Export is explicit: the worker cannot read a browser.

   Store key scanSetups:
     { schema: 1, exported: { at, setups: { id: { version, hash, enabled } } } | null,
       setups: { [id]: { id, name, description, enabled, created, updated, deleted,
                         current, versions: [{ version, savedAt, hash, source, setup }] } } }
   `setup` is a version's evaluation fields only — timeframe, universe,
   confirmationMode, cooldownMode, cooldownBars, expires, ruleTree — frozen
   when saved. The hash is the engine's (scanCanonical through scanHash), so
   the page, the export and the worker name a version the same way. Name,
   description and enabled are not versioned: they do not change what a rule
   means, so they do not change its hash. A deleted setup keeps its versions,
   because the alerts it recorded still name them.
   ===================================================================== */
const SCAN_EVAL_FIELDS = ['timeframe', 'universe', 'confirmationMode', 'cooldownMode', 'cooldownBars', 'expires', 'ruleTree'];
function scanStoreRead() {
  const raw = store.read('scanSetups', null);
  const ok = raw && typeof raw === 'object' && raw.setups && typeof raw.setups === 'object' && !Array.isArray(raw.setups);
  const st = ok ? raw : { schema: 1, setups: {}, exported: null };
  if (!st.exported || typeof st.exported !== 'object' || Array.isArray(st.exported)) st.exported = null;
  st.schema = 1;
  /* Each record read in the shape this file writes. A record restored from
     a hand-edited or truncated backup ("Your data" writes whatever the file
     holds) — versions that are not a list, a null version, no versions —
     threw in scanVersionOf or the edit page's version count, and the throw
     took down every page that reads the store: the setups, a setup, its
     edit, the watchlist scanner and the settings. A version is kept when it
     has a number; a record with none names no conditions, so it cannot be
     shown, evaluated, exported or restored, and is dropped; a current
     version the record does not hold becomes its highest. The key is the
     id every lookup uses. */
  Object.keys(st.setups).forEach(id => {
    const r = st.setups[id];
    const versions = r && typeof r === 'object' && Array.isArray(r.versions)
      ? r.versions.filter(v => v && typeof v === 'object' && Number.isInteger(v.version) && v.version > 0) : [];
    if (!versions.length) { delete st.setups[id]; return; }
    r.versions = versions;
    r.id = id;
    if (!versions.some(v => v.version === r.current)) r.current = Math.max(...versions.map(v => v.version));
  });
  const wx = st.watchlistsExported;
  if (wx !== undefined && !(wx && typeof wx === 'object' && typeof wx.at === 'string' && wx.lists && typeof wx.lists === 'object')) delete st.watchlistsExported;
  else if (wx) Object.keys(wx.lists).forEach(k => { const l = wx.lists[k]; if (!l || typeof l !== 'object') delete wx.lists[k]; else if (!Array.isArray(l.symbols)) l.symbols = []; });
  return st;
}
const scanStoreWrite = (st) => store.write('scanSetups', st);
const scanEvalOf = (s) => Object.fromEntries(SCAN_EVAL_FIELDS.map(k => [k, scanClone(s[k] ?? null)]));
const scanVersionOf = (rec, v = null) => (rec?.versions || []).find(x => x.version === (v ?? rec.current)) || null;
/* A stored setup at a version, as the engine reads a setup: normalised,
   with the version's number and a hash computed afresh (which equals the one
   stored, unless the record was edited by hand). */
function scanRecordSetup(rec, v = null) {
  const ver = scanVersionOf(rec, v);
  if (!ver) return null;
  return scanNormaliseSetup({ id: rec.id, version: ver.version, name: rec.name, ...(rec.description ? { description: rec.description } : {}),
    enabled: rec.enabled !== false, created: rec.created || null, updated: rec.updated || null, ...scanClone(ver.setup) });
}
/* The current version of every setup this browser holds, oldest first. */
function scanBrowserSetups({ st = scanStoreRead(), deleted = false } = {}) {
  return Object.values(st.setups).filter(r => r && (deleted || !r.deleted))
    .sort((a, b) => String(a.created || '').localeCompare(String(b.created || '')) || String(a.id).localeCompare(String(b.id)))
    .map(r => scanRecordSetup(r)).filter(Boolean);
}

/* Save a setup. Validated exactly as the worker validates: a setup passes
   whole or is refused with every reason, and nothing is stored. A change to
   an evaluation field is a new version; a change to the name, description
   or enabled flag is not. A setup adopted from the file keeps the file's
   version number when it is ahead, so the alerts the worker recorded under
   it still name the version the browser now holds. */
/* THE RESOLVE CHOICE IS PART OF THE VERSION. A watchlist universe resolved
   from the export can evaluate different symbols from its snapshot, so
   switching between the two changes what the setup evaluates. The engine's
   hash covers it (resolve and the list's id, when resolve is 'export'); the
   page still compares the choice beside the hash, because a version saved
   before the hash covered it carries the old hash, and a switch must not be
   taken for "no change" and dropped. */
const scanResolveOf = (s) => (scanResolvesByExport(s?.universe) ? 'export' : 'snapshot');
const scanSameVersion = (stored, s) => !!stored && !!s && stored.hash === s.hash && scanResolveOf(stored.setup || stored) === scanResolveOf(s);
function scanSaveSetup(draft, { source = 'builder', now = new Date().toISOString(), st = scanStoreRead() } = {}) {
  const v = scanValidate({ setups: [draft] });
  if (v.problems.length) return { ok: false, problems: v.problems, problemsBySetup: v.problemsBySetup };
  const s = v.setups[0];
  let rec = st.setups[s.id];
  const meta = { name: s.name, description: s.description || '', enabled: s.enabled };
  if (!rec) {
    const first = source === 'file' ? s.version : 1;
    rec = st.setups[s.id] = { id: s.id, ...meta, created: s.created || now, updated: now, deleted: null, current: first,
      versions: [{ version: first, savedAt: now, hash: s.hash, source, setup: scanEvalOf(s) }] };
    scanStoreWrite(st);
    return { ok: true, id: s.id, version: first, created: true, bumped: true, setup: scanRecordSetup(rec) };
  }
  const cur = scanVersionOf(rec);
  const metaChanged = rec.name !== meta.name || (rec.description || '') !== meta.description || (rec.enabled !== false) !== meta.enabled || !!rec.deleted;
  Object.assign(rec, meta);
  rec.deleted = null;
  /* The file numbering these same conditions ahead of every version held
     here (another browser saved and reverted, or the number was edited by
     hand) was taken for "no change": the file's number was not kept, so
     the setup still read "file newer" and its Adopt button did nothing,
     and the alerts the worker records under that number named a version
     this browser does not hold. It is kept, as for new conditions. */
  const fileAhead = source === 'file' && s.version > Math.max(0, ...rec.versions.map(x => x.version));
  if (scanSameVersion(cur, s) && !fileAhead) {
    if (metaChanged) rec.updated = now;
    scanStoreWrite(st);
    return { ok: true, id: s.id, version: rec.current, created: false, bumped: false, metaChanged, setup: scanRecordSetup(rec) };
  }
  /* The file's version already held here with this content: adopting it
     makes it current again, rather than a copy under a new number. */
  const same = source === 'file' ? rec.versions.find(x => x.version === s.version && scanSameVersion(x, s)) : null;
  if (same) { rec.current = same.version; rec.updated = now; scanStoreWrite(st); return { ok: true, id: s.id, version: same.version, created: false, bumped: false, reverted: true, setup: scanRecordSetup(rec) }; }
  const max = Math.max(0, ...rec.versions.map(x => x.version));
  const next = source === 'file' && s.version > max ? s.version : max + 1;
  rec.versions.push({ version: next, savedAt: now, hash: s.hash, source, setup: scanEvalOf(s) });
  rec.current = next;
  rec.updated = now;
  scanStoreWrite(st);
  return { ok: true, id: s.id, version: next, created: false, bumped: true, setup: scanRecordSetup(rec) };
}
/* Enable, disable, delete and restore change metadata only, so none of them
   is a version. */
function scanSetMeta(id, patch, { now = new Date().toISOString() } = {}) {
  const st = scanStoreRead();
  const rec = st.setups[id];
  if (!rec) return false;
  Object.assign(rec, patch);
  rec.updated = now;
  scanStoreWrite(st);
  return true;
}

/* THE EXPORT — the schema-2 setups document the worker reads, carrying each
   setup's current version with its number, hash and dates. Deleted setups
   are left out. Recorded as exported, so the drift can say "exported on …"
   when the file itself cannot be seen from here. */
function scanExportDoc({ st = scanStoreRead(), now = new Date().toISOString() } = {}) {
  return {
    kind: 'quantum-tradeworks-scan-setups', schema: 2, exportedAt: now,
    owner: 'this browser — there are no accounts, so no ownerId; anyone with this machine or browser profile can read it',
    _note: 'Save as data/scan-setups.json (git-ignored) for node scanner/scan.mjs. Every setup is yours: the product proposes none, ranks none and delivers nothing.',
    setups: scanBrowserSetups({ st }).map(s => {
      const out = { id: s.id, version: s.version, hash: s.hash, name: s.name };
      if (s.description) out.description = s.description;
      Object.assign(out, { enabled: s.enabled, created: s.created || null, updated: s.updated || null }, scanEvalOf(s));
      return out;
    }),
  };
}
function scanMarkExported(doc, { st = scanStoreRead() } = {}) {
  st.exported = { at: doc.exportedAt, setups: Object.fromEntries(doc.setups.map(s => [s.id, { version: s.version, hash: s.hash, enabled: s.enabled }])) };
  scanStoreWrite(st);
}
const scanExportName = () => 'scan-setups.json';

/* THE LISTS FILE FOR THE WORKER (round 3 contract C3). A setup whose
   watchlist universe resolves by export is resolved by the worker from
   data/watchlists.json: the watchlists export exactly as watchlistsExport()
   writes it, saved under that name. The worker cannot read this browser,
   so "the list at run time" is the list as of the last export, and the
   pages say so rather than call it current. What was exported — when, and
   each list's symbols — is recorded beside the setups, so a page can say
   where a list and the file have parted; the file itself is not kept. */
const SCAN_WATCHLISTS_FILE = 'watchlists.json';
function scanExportWatchlists({ st = scanStoreRead() } = {}) {
  const doc = watchlistsExport();
  scanDownload(SCAN_WATCHLISTS_FILE, doc);
  st.watchlistsExported = { at: doc.exportedAt,
    lists: Object.fromEntries((doc.watchlists || []).map(w => [w.id, { name: w.name, symbols: (w.items || []).filter(i => i.symbol).map(i => i.symbol) }])) };
  scanStoreWrite(st);
  return doc;
}
/* A list against its last export for the scanner, in words: never
   exported from this browser, not in that export, deleted here since, the
   same, or changed (which members). */
function scanWatchlistExportState(wlId, st = scanStoreRead()) {
  const ex = st.watchlistsExported;
  if (!ex?.at) return { state: 'NEVER', text: 'Not exported for the scanner from this browser. Until data/watchlists.json holds this list, the worker evaluates each setup’s snapshot instead and marks the run partial.' };
  const held = ex.lists?.[wlId];
  if (!held) return { state: 'NOT_IN_EXPORT', at: ex.at, text: `Not in the export of ${scanStamp(ex.at)} — made before this list existed. Until you export again, the worker evaluates each setup’s snapshot instead and marks the run partial.` };
  if (!wlById(wlId)) return { state: 'DELETED', at: ex.at, text: `Deleted here since the export of ${scanStamp(ex.at)}, which still holds it with ${scanPlural(held.symbols.length, 'symbol')}; the worker resolves that until you export again.` };
  const d = scanSnapshotDrift(held.symbols, watchlistSymbols(wlId).symbols);
  const parts = [d.added.length ? `${d.added.length} added (${d.added.join(', ')})` : null, d.removed.length ? `${d.removed.length} removed (${d.removed.join(', ')})` : null].filter(Boolean);
  return d.same ? { state: 'IN_STEP', at: ex.at, text: `Exported for the scanner ${scanStamp(ex.at)}, as the list stands now (${scanPlural(held.symbols.length, 'symbol')}).` }
    : { state: 'CHANGED', at: ex.at, text: `Changed since the export of ${scanStamp(ex.at)}: ${parts.join(', ')}. The worker resolves the export until you export again.` };
}

/* THE DRIFT, per setup, in the words the pages use. The engine's
   scanSetupDrift says which ids differ and which side has the higher
   version; this adds what the browser knows and the engine cannot — its own
   history of versions — to tell "saved here, not exported" from "the file
   holds a version this browser has not seen".
     IN_STEP       the file carries this browser's current version
     NOT_EXPORTED  saved here after the file was written; the worker runs the older one
     FILE_NEWER    the file holds a version this browser has not seen (edited by hand or elsewhere)
     BROWSER_ONLY  only in this browser
     FILE_ONLY     only in the file
     UNCONFIRMED   the file cannot be seen from here; exported on a date, or never */
const SCAN_DRIFT = {
  IN_STEP:      { label: 'in step', chip: 'chip-ok' },
  NOT_EXPORTED: { label: 'not exported', chip: 'chip-warn' },
  FILE_NEWER:   { label: 'file newer', chip: 'chip-bronze' },
  BROWSER_ONLY: { label: 'browser only', chip: 'chip-warn' },
  FILE_ONLY:    { label: 'file only', chip: 'chip-bronze' },
  UNCONFIRMED:  { label: 'file not visible', chip: '' },
};
function scanDriftRows({ st = scanStoreRead(), fileDoc = scanSetupsFile } = {}) {
  const browser = scanBrowserSetups({ st });
  const byId = new Map(browser.map(s => [s.id, s]));
  const rows = new Map();
  /* A setup deleted here is left out of the export, but the worker runs
     whatever the file holds. The engine's drift reads only the setups
     standing here, so one deleted here and still in the file came out
     "only in the file — adopt it to keep its versions here": its versions
     are kept here already, adopting it silently undid the deletion, and
     nothing asked for the export that would stop the worker running it.
     It is named as deleted and not yet exported. */
  const deletedHere = Object.values(st.setups).filter(r => r && r.deleted);
  if (fileDoc == null) {
    browser.forEach(b => {
      const ex = st.exported?.setups?.[b.id];
      const same = ex && ex.version === b.version && ex.hash === b.hash && ex.enabled === b.enabled;
      rows.set(b.id, same
        ? { id: b.id, state: 'UNCONFIRMED', browser: b, file: null, text: `Exported ${scanDay(st.exported.at)} as v${b.version}. The worker’s file cannot be seen from here, so whether it still holds that version cannot be confirmed.` }
        : { id: b.id, state: 'NOT_EXPORTED', browser: b, file: null, text: ex
            ? `Changed since the export of ${scanDay(st.exported.at)} (which carried v${ex.version}${ex.enabled ? '' : ', disabled'}). The worker’s file cannot be seen from here; until you export, the worker runs whatever that file holds.`
            : 'Never exported. The worker’s file cannot be seen from here, and this browser’s copy is the only copy until you export it.' });
    });
    /* Deleted here after the last export, which carried it: the worker's
       file still holds it, as far as this browser knows. */
    deletedHere.forEach(r => {
      const ex = st.exported?.setups?.[r.id];
      if (ex) rows.set(r.id, { id: r.id, state: 'NOT_EXPORTED', deleted: true, browser: null, file: null, name: r.name,
        text: `Deleted here ${scanDay(r.deleted)}, after the export of ${scanDay(st.exported.at)}, which carried v${ex.version}. The worker’s file cannot be seen from here; until you export, the worker runs whatever that file holds — the export leaves deleted setups out.` });
    });
    return [...rows.values()];
  }
  const fileList = Array.isArray(fileDoc) ? fileDoc : Array.isArray(fileDoc?.setups) ? fileDoc.setups : [];
  const fileById = new Map(fileList.filter(s => s && typeof s === 'object' && s.id).map(s => [s.id, scanNormaliseSetup(s)]));
  const d = scanSetupDrift(browser, fileDoc);
  d.same.forEach(id => rows.set(id, { id, state: 'IN_STEP', browser: byId.get(id), file: fileById.get(id), text: `The file carries v${byId.get(id).version}, the version saved here.` }));
  d.onlyInBrowser.forEach(id => rows.set(id, { id, state: 'BROWSER_ONLY', browser: byId.get(id), file: null, text: 'Only in this browser. The worker does not run it until you export.' }));
  const gone = new Map(deletedHere.map(r => [r.id, r]));
  d.onlyInFile.forEach(id => rows.set(id, gone.has(id)
    ? { id, state: 'NOT_EXPORTED', deleted: true, browser: null, file: fileById.get(id), name: gone.get(id).name,
        text: `Deleted here ${scanDay(gone.get(id).deleted)}; the file still holds v${fileById.get(id).version}, which the worker runs until you export — the export leaves deleted setups out. Restore it to keep it.` }
    : { id, state: 'FILE_ONLY', browser: null, file: fileById.get(id), text: `Only in the file (v${fileById.get(id).version}). Adopt it to keep its versions here and edit it in the builder.` }));
  d.differ.forEach(x => {
    const rec = st.setups[x.id], b = byId.get(x.id), f = fileById.get(x.id);
    const known = (rec?.versions || []).some(v => v.hash === x.fileHash);
    let state;
    if (!x.rulesDiffer) state = x.newer === 'file' ? 'FILE_NEWER' : x.newer === 'browser' ? 'NOT_EXPORTED'
      : (f.updated && rec?.updated && String(f.updated) > String(rec.updated) ? 'FILE_NEWER' : 'NOT_EXPORTED');
    else state = known && x.fileVersion <= x.browserVersion ? 'NOT_EXPORTED' : 'FILE_NEWER';
    const en = x.enabledDiffers ? ` It is ${b.enabled ? 'enabled' : 'disabled'} here and ${f.enabled ? 'enabled' : 'disabled'} in the file.` : '';
    const text = state === 'NOT_EXPORTED'
      ? `Saved here as v${x.browserVersion}; the file still holds v${x.fileVersion}, which is what the worker runs.${en}`
      : x.rulesDiffer
        ? `The file holds v${x.fileVersion} with conditions this browser has not seen (edited by hand, or in another browser); here the current version is v${x.browserVersion}.${en}`
        : `The file was changed after this browser’s copy.${en}`;
    rows.set(x.id, { id: x.id, state, browser: b, file: f, text, enabledDiffers: x.enabledDiffers });
  });
  return [...rows.values()];
}
/* Adopt the file's copy of a setup into this browser: a new version when
   its conditions are new here, the file's version number kept when ahead. */
function scanAdoptFromFile(id, { now = new Date().toISOString() } = {}) {
  const list = Array.isArray(scanSetupsFile) ? scanSetupsFile : Array.isArray(scanSetupsFile?.setups) ? scanSetupsFile.setups : [];
  const raw = list.find(s => s && s.id === id);
  if (!raw) return { ok: false, problems: [`${id} is not in the file`] };
  return scanSaveSetup(raw, { source: 'file', now });
}

/* A watchlist universe against the list as it stands now. On a snapshot,
   the worker evaluates the snapshot; the list may have moved since. A
   setup resolved by export is evaluated on the list as last exported for
   the scanner, and on its snapshot only when that export does not hold the
   list. The snapshot's drift alone told its reader "the worker evaluates
   the snapshot until you save the setup again and export" — which the
   worker does not do while the export holds the list, and the wrong remedy:
   it is the lists that need exporting. Such a setup is judged against the
   export (byExport), and where the export does not hold the list, the
   export's words come before the snapshot's, and it is not in step. */
function scanWatchlistDrift(setup) {
  const u = setup?.universe;
  if (!u || u.kind !== 'watchlist') return null;
  const ex = scanResolvesByExport(u) ? scanWatchlistExportState(u.watchlistId) : null;
  if (ex && ['IN_STEP', 'CHANGED', 'DELETED'].includes(ex.state))
    return { same: ex.state === 'IN_STEP', deleted: ex.state === 'DELETED', byExport: true, name: wlById(u.watchlistId)?.name || u.name || null, asOf: u.asOf || null,
      text: `Resolved from your latest export for the scanner. ${ex.text}` };
  const pre = ex ? `${ex.text} ` : '';
  const w = wlById(u.watchlistId);
  if (!w) return { deleted: true, byExport: !!ex, asOf: u.asOf || null, text: `${pre}The watchlist this setup snapshotted (${u.name || u.watchlistId || '?'}) is not in this browser — deleted, or saved in another browser. The worker still evaluates the ${scanPlural((u.symbols || []).length, 'symbol')} of the snapshot of ${u.asOf || '?'}.` };
  const now = watchlistSymbols(u.watchlistId);
  const d = scanSnapshotDrift(u.symbols, now.symbols);
  const parts = [d.added.length ? `${d.added.length} added (${d.added.join(', ')})` : null, d.removed.length ? `${d.removed.length} removed (${d.removed.join(', ')})` : null].filter(Boolean);
  return { ...d, same: ex ? false : d.same, byExport: !!ex, deleted: false, name: now.name, asOf: u.asOf || null,
    text: pre + (d.same ? `The snapshot of ${u.asOf || '?'} matches “${now.name}” as it stands.`
      : `“${now.name}” has changed since the snapshot of ${u.asOf || '?'}: ${parts.join(', ')}. The worker evaluates the snapshot until you save the setup again and export.`) };
}

/* =====================================================================
   ALERT STATUS AND THE UNREAD COUNT

   The record (data/scan-alerts.json) is the worker's and is never edited
   here. Whether a reader has seen an alert is a per-browser convenience,
   kept under scanAlertState as { alertId: 'READ' | 'ARCHIVED' }; absent is
   NEW. A second device keeps its own, and the pages say so.
   ===================================================================== */
const scanAlertList = () => (Array.isArray(scanAlertsFile?.alerts) ? scanAlertsFile.alerts : Array.isArray(scanAlertsFile) ? scanAlertsFile : []);
/* An alert written before engine 0.3.0 carries a key but no id; its id is
   the one the engine would give that key, so its address is stable. */
const scanAlertIdOf = (a) => a?.id || (a?.key ? scanAlertId(a.key) : null);
/* Ids that records with different keys share, in the loaded record. The id
   is 'a' + an eight-hex-digit FNV-1a of the key, so among a few thousand
   records a collision is unlikely but possible, and a page must never show
   one record's evidence at another's address (NAV 1). Worked out once per
   list: the file's own array, until the file is replaced. */
let scanCollisionMemo = { list: null, ids: new Set() };
function scanIdCollisions(list = scanAlertList()) {
  if (scanCollisionMemo.list === list) return scanCollisionMemo.ids;
  const keys = new Map();
  list.forEach(a => { const id = scanAlertIdOf(a); if (!id) return; if (!keys.has(id)) keys.set(id, new Set()); keys.get(id).add(a.key ?? ''); });
  scanCollisionMemo = { list, ids: new Set([...keys].filter(([, k]) => k.size > 1).map(([id]) => id)) };
  return scanCollisionMemo.ids;
}
const scanAlertBar = (a) => a?.candleDate || a?.bar || '';
/* Only the two statuses this page writes are read. Any other value (a
   restored backup edited by hand) read as NEW in the list and the tiles
   but as read in the unread count, and the tile put the difference down
   to "muted setups" when none was muted. */
function scanAlertStateRead() {
  const s = store.read('scanAlertState', {});
  return s && typeof s === 'object' && !Array.isArray(s)
    ? Object.fromEntries(Object.entries(s).filter(([, v]) => v === 'READ' || v === 'ARCHIVED')) : {};
}
const scanAlertStatus = (a, st = scanAlertStateRead()) => { const v = st[scanAlertIdOf(a)]; return v === 'READ' || v === 'ARCHIVED' ? v : 'NEW'; };
function scanSetAlertStatus(ids, status) {
  const st = scanAlertStateRead();
  ids.filter(Boolean).forEach(id => { if (status === 'NEW') delete st[id]; else st[id] = status; });
  store.write('scanAlertState', st);
}
/* Date order — the bar, then when it was detected, then the file's own
   order. A record, not a ranking: no value column is ever a sort key. */
function scanAlertsInOrder(list = scanAlertList()) {
  return list.map((a, i) => ({ a, i })).sort((x, y) => scanAlertBar(y.a).localeCompare(scanAlertBar(x.a))
    || String(y.a.detectedAt || y.a.recordedAt || '').localeCompare(String(x.a.detectedAt || x.a.recordedAt || '')) || x.i - y.i).map(x => x.a);
}
/* The unread count for the navigation badge: alerts with no status in this
   browser, leaving out setups the reader muted. null — no badge, and never
   "0 unread" — when no alerts file is visible (the deployed site) or when
   in-app notifications are switched off. */
function scanUnreadCount() {
  if (!scanAlertsFile) return null;
  const p = scanPrefsRead();
  if (p.inApp === false) return null;
  const st = scanAlertStateRead();
  return scanAlertList().filter(a => { const id = scanAlertIdOf(a); return id && !st[id] && !p.muted[a.setupId]; }).length;
}

/* Preferences, per browser. The only notification preference that does
   anything is in-app: whether the unread count shows, and which setups it
   counts. The rest is how the pages display. */
const SCAN_PREFS_DEFAULT = { inApp: true, muted: {}, pageSize: 50, statusFilter: 'OPEN', precision: 'full' };
function scanPrefsRead() {
  const p = store.read('scanPrefs', null);
  const out = { ...SCAN_PREFS_DEFAULT, ...(p && typeof p === 'object' && !Array.isArray(p) ? p : {}) };
  if (!out.muted || typeof out.muted !== 'object') out.muted = {};
  if (![25, 50, 100, 200].includes(out.pageSize)) out.pageSize = 50;
  if (!['OPEN', 'NEW', 'ALL'].includes(out.statusFilter)) out.statusFilter = 'OPEN';
  if (!['full', 'rounded'].includes(out.precision)) out.precision = 'full';
  return out;
}
const scanPrefsWrite = (patch) => store.write('scanPrefs', { ...scanPrefsRead(), ...patch });
/* A CLOSE PRINTS AS A PRICE. It went through scanFmt's defaults, which are
   a volume's — two decimals, shortened from 10,000 — so the alerts table
   and a run's summary read 0.34 for a close of 0.345, on the line where the
   engine's own rule read "price 0.345 below 0.500", and 45.1k for 45,120.5
   and 45,149.9 alike. The engine's rule is that a price is never shortened
   and prints at the precision it is quoted in. A lone close has no series
   to read that from, so it is read from the close itself: at least two
   decimals and at most four, as scanSeriesDp reads a series. */
const scanPriceDp = (v) => Math.max(2, Math.min(4, scanDecimals(v)));
const scanPriceText = (v) => (isNum(v) ? scanFmt(v, scanPriceDp(v), false) : '—');
/* Recorded values as the preference asks: every significant digit the
   engine keeps, or rounded as the tables round. Rounded, a price was
   shortened too (a close of 45,120.5 read 45.1k), and values printed
   together were rounded one at a time, so a close that had moved by 0.004
   read "recorded 96.60, now 96.60". Rounded now goes through the engine's
   scanFmtAll, which adds a decimal until different values read
   differently, and `unit` 'price' rounds as a price. */
function scanValuesFmt(vals, prefs = scanPrefsRead(), unit = null) {
  const xs = vals.flat().map(Number).filter(Number.isFinite);
  const f = prefs.precision !== 'rounded' ? scanDec
    : scanFmtAll(xs, unit === 'price' ? { dp: Math.max(2, ...xs.map(scanPriceDp)), compact: false } : {});
  /* A yes-or-no reading (unit 'flag') is 1 or 0 to the engine and true or
     false to its reader, as the condition's sentence says it. */
  if (unit === 'flag') return (v) => (Number(v) === 1 ? 'true (1)' : Number(v) === 0 ? 'false (0)' : v == null || !Number.isFinite(Number(v)) ? '—' : f(Number(v)));
  return (v) => (v == null || !Number.isFinite(Number(v)) ? '—' : f(Number(v)));
}
const scanValueText = (v, prefs = scanPrefsRead(), unit = null) => scanValuesFmt([v], prefs, unit)(v);
/* The unit a recorded condition's values are in: its left side's, the one
   the engine prints both sides in — read off the setup the record carries,
   at the condition's path ('2.1' is the first child of the second). Null
   when the record carries no tree, and the values round as before. */
function scanCondUnit(tree, path) {
  let n = tree;
  if (n?.type === 'group') for (const k of String(path || '').split('.')) n = Array.isArray(n?.children) ? n.children[Number(k) - 1] : null;
  return n?.type === 'condition' ? scanUnitOf(n.left) : null;
}

/* A route parameter of the current address, decoded. The router keeps only
   a company id in State; the scanner's :setup and :alert are read here. */
const scanParam = (name) => {
  const p = matchRoute(location.pathname)?.params?.[name];
  if (p == null) return null;
  try { return decodeURIComponent(p); } catch { return String(p); }
};

/* A setup's shape at a glance, as chips. */
function scanSetupChips(s, extra = []) {
  const n = scanConditionCount(s.ruleTree);
  return el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
    el('span', { class: 'chip' }, `v${s.version}`),
    s.enabled === false ? el('span', { class: 'chip chip-bronze' }, 'disabled') : el('span', { class: 'chip chip-ok' }, 'enabled'),
    el('span', { class: 'chip' }, SCAN_TIMEFRAMES[s.timeframe]?.label || String(s.timeframe)),
    el('span', { class: 'chip' }, `${s.ruleTree?.logic === 'ANY' ? 'any' : 'all'} of ${scanPlural(n, 'condition')}`),
    el('span', { class: 'chip' }, s.cooldownMode === 'NEW_MATCH' ? 'new matches only' : 'every match'),
    s.cooldownBars ? el('span', { class: 'chip' }, `cooldown ${scanPlural(s.cooldownBars, 'bar')}`) : null,
    s.expires ? el('span', { class: 'chip' }, `expires ${s.expires}`) : null,
    ...extra,
  ]);
}
/* A CONDITION MAY READ A HIGHER TIMEFRAME THAN ITS SETUP'S (contract B1–B3).
   A setup on daily bars can hold a condition read on the last closed weekly
   or monthly bar, built from the same daily bars — how the reader's
   TradingView bot judges its trade timeframe. Absent, a condition reads the
   setup's own. The engine validates, hashes and evaluates it; these pages
   say it in the condition's own sentence, so a weekly criterion never reads
   as a daily one. */
/* SCAN_TF_RANK is the engine's (24-market-engine.js). */
const scanCondTf = (c) => (c && typeof c === 'object' && c.timeframe != null && c.timeframe !== '' ? scanTimeframe(c.timeframe) : null);
const scanTfWord = (tf) => ({ '1D': 'daily', '1W': 'weekly', '1M': 'monthly' }[scanTimeframe(tf)] || String(tf || '').toLowerCase());
const scanTfPeriod = (tf) => ({ '1D': 'session', '1W': 'week', '1M': 'month' }[scanTimeframe(tf)] || 'bar');
/* The timeframes a condition in a setup on `tf` may read besides the
   setup's own: the built ones above it, never one below. */
const scanHigherTfs = (tf) => Object.values(SCAN_TIMEFRAMES)
  .filter(t => t.built && SCAN_TF_RANK[t.id] != null && SCAN_TF_RANK[t.id] > (SCAN_TF_RANK[scanTimeframe(tf)] ?? 0)).map(t => t.id);
/* A condition in words: the engine's sentence, with two things it leaves to
   its reader said here. A yes-or-no reading (unit 'flag') compared with 1 or
   0 reads "is true" or "is false" — "equals 1" asked the reader to know
   the encoding — and a condition read on a timeframe other than its
   setup's names it ("on the last closed weekly bar"). The engine's own
   words stand wherever they already say either. */
function scanCondSentence(c, setupTf = null) {
  let t = scanConditionProse(c);
  /* The engine names a condition's own timeframe first ("weekly: …"); these
     pages say it last, and only where it is not the setup's own. */
  t = t.replace(/^(daily|weekly|monthly): /i, '');
  if (c && typeof c === 'object' && scanUnitOf(c.left) === 'flag' && scanOpName(c.op) === 'EQUALS'
    && c.right && typeof c.right === 'object' && c.right.indicator == null && scanNumeric(c.right.value) && [0, 1].includes(Number(c.right.value)))
    t = t.replace(/ equals [01](?=$| on | \()/, Number(c.right.value) === 1 ? ' is true' : ' is false');
  const tf = scanCondTf(c);
  if (tf && tf !== scanTimeframe(setupTf) && !/\b(daily|weekly|monthly)\b/i.test(t)) t += ` on the last closed ${scanTfWord(tf)} bar`;
  return t;
}
/* The tree as indented lines, as the engine's scanTreeLines walks it, in
   the sentences above. */
function scanTreeLinesAt(tree, setupTf = null) {
  const out = [];
  const walk = (n, depth) => {
    if (n?.type === 'group') {
      if (depth > 0) out.push({ depth, text: `${n.logic === 'ANY' ? 'any' : 'all'} of:`, group: true });
      (Array.isArray(n.children) ? n.children : []).forEach(c => walk(c, depth + 1));
    } else out.push({ depth, text: scanCondSentence(n, setupTf) });
  };
  walk(tree, 0);
  return out;
}
/* The timeframes other than `setupTf` a tree's conditions read, lowest
   first, and how many of its conditions read one. */
const scanTreeTfs = (tree, setupTf) => {
  const out = new Set();
  const walk = (n) => { if (n?.type === 'group') (n.children || []).forEach(walk); else { const t = scanCondTf(n); if (t && t !== scanTimeframe(setupTf)) out.add(t); } };
  walk(tree);
  return [...out].sort((a, b) => (SCAN_TF_RANK[a] ?? 9) - (SCAN_TF_RANK[b] ?? 9));
};
const scanTreeTfCount = (tree, setupTf) => { let n = 0; const w = (x) => { if (x?.type === 'group') (x.children || []).forEach(w); else { const t = scanCondTf(x); if (t && t !== scanTimeframe(setupTf)) n++; } }; w(tree); return n; };
/* The tree as written: a nested group is a line of its own, and its
   conditions sit one step in. Given the setup's timeframe, a condition read
   on another says which. */
const scanTreeList = (tree, setupTf = null) => el('ul', { class: 'rulelist' }, scanTreeLinesAt(tree, setupTf).map(l =>
  el('li', { style: l.depth > 1 ? `margin-left:${(l.depth - 1) * 16}px` : null, class: l.group ? 'scan-group-line' : null }, l.text)));
/* Where a recorded condition was read (B3): the record carries the
   timeframe and the date of the bar read only when they differ from the
   setup's own, so a condition without them was read on the alert's own
   bar. A weekly or monthly bar is dated by its last session. */
function scanReadOn(c, a) {
  const own = scanTimeframe(a?.timeframe);
  const tf = c?.timeframe != null && c.timeframe !== '' ? scanTimeframe(c.timeframe) : null;
  const other = !!tf && tf !== own;
  const t = other ? tf : own, date = other ? (c.barDate || null) : scanAlertBar(a) || null;
  return { tf: t, date, other, text: date ? `${SCAN_TIMEFRAMES[t]?.label || t} bar closing ${date}` : `${SCAN_TIMEFRAMES[t]?.label || t} bar — the record does not say which` };
}
/* The bars of other timeframes a record's conditions were read on, in
   words: "weekly bar closing 2026-09-25 and the monthly bar closing
   2026-08-31". */
const scanReadOnOthers = (a) => [...new Set((Array.isArray(a?.matchedConditions) ? a.matchedConditions : []).map(c => scanReadOn(c, a)).filter(r => r.other)
  .map(r => r.text.replace(/^\w/, ch => ch.toLowerCase())))].join(' and the ');
const scanDriftChip = (row) => (row ? el('span', { class: `chip ${SCAN_DRIFT[row.state].chip}`, title: row.text }, SCAN_DRIFT[row.state].label) : null);
/* Monthly joined weekly as a timeframe built from the daily bars; the page
   said "daily bars" of a monthly setup until it was named here. */
const scanTimeframeProse = (s) => {
  const hi = scanTreeTfs(s.ruleTree, s.timeframe), n = scanTreeTfCount(s.ruleTree, s.timeframe);
  return (s.timeframe === '1W' ? 'weekly bars derived from your daily ones' : s.timeframe === '1M' ? 'monthly bars derived from your daily ones' : 'daily bars') + ', each evaluated once its session has closed'
    + (hi.length ? `; ${scanPlural(n, 'condition')} ${n === 1 ? 'reads' : 'read'} the last closed ${hi.map(scanTfWord).join(' or ')} bar instead` : '');
};
const scanAlertsOf = (id) => scanAlertList().filter(a => a.setupId === id);

/* A run's outcome as a card body: what matched, what was untested, what was
   skipped and why. In setup-then-symbol order. */
function scanRunSummary(r, note) {
  const box = el('div');
  box.append(el('p', { class: 'metaline' }, `${scanPlural(r.setups, 'setup')} · ${scanPlural(r.evaluated, 'evaluation')}, each on its instrument’s last final bar${r.asOf ? ` (${scanBarRange(r.asOfFrom, r.asOf)})` : ''} · ${scanPlural(r.matched, 'match', 'matches')} · ${r.untested} untested · ${r.skipped.length} skipped. ${note || ''}`));
  /* What the session's cache saved this run, so a reader can see the
     second click reuse the first one's series. */
  if (r.sessionCache) box.append(el('p', { class: 'caption scan-cache-line', style: 'margin-top:2px' }, `Indicators: ${r.sessionCache.misses} computed, ${r.sessionCache.hits} reused from earlier in this session. The page keeps one cache while it is open, keyed by each series’ data version, so a changed close is computed afresh.`));
  if (r.alerts.length) {
    const ul = el('ul', { class: 'ticklist', style: 'margin-top:6px' });
    r.alerts.forEach(a => ul.append(el('li', {}, [`${a.setupName} · `, scanSymbolLink(a.symbol), ` · ${a.bar} · close ${scanPriceText(a.close)} — ${a.rules.map(x => x.text).join('; ')}`])));
    box.append(ul);
  }
  /* Every pair that was not a plain met-or-failed, with its reason: untested
     ones first (the rule that could not be read), then the skips, then the
     series evaluated on a bar well behind the rest. */
  const un = (r.untestedList || []).map(s => `${s.setup} · ${s.symbol}: untested — ${s.why}`);
  const sk = r.skipped.filter(s => s.why).map(s => `${s.setup}${s.symbol ? ' · ' + s.symbol : ''}: ${s.why}`);
  const stl = (r.stale || []).map(s => `${s.symbol}: ${s.why}`);
  /* A provisional last bar is not an error, but it is why a bar other than
     the newest was evaluated. And per market, whether the session expected
     by now is held — the reason a whole run can come back untested. */
  const pv = (r.provisional || []).map(s => `${s.symbol}: ${s.why}`);
  const rd = (r.readiness?.markets || []).filter(m => m.inRun && m.state !== 'READY').map(m => m.text);
  const lines = [...un, ...sk, ...stl, ...pv, ...rd];
  if (lines.length) {
    const parts = [un.length ? `untested ${un.length}` : null, sk.length ? `skipped ${sk.length}` : null, stl.length ? `behind the rest ${stl.length}` : null,
      pv.length ? `provisional ${pv.length}` : null, rd.length ? `markets not ready ${rd.length}` : null].filter(Boolean);
    const det = el('details', { style: 'margin-top:6px' });
    det.append(el('summary', { class: 'caption', style: 'cursor:pointer' }, `Why — ${parts.join(' · ')}`));
    det.append(el('ul', { class: 'rulelist' }, lines.slice(0, 80).map(t => el('li', { class: 'caption' }, t))));
    if (lines.length > 80) det.append(el('p', { class: 'caption' }, `Showing 80 of ${lines.length}.`));
    box.append(det);
  }
  return box;
}

/* The export controls, the same on every page that shows drift. */
function scanExportControls({ primary = false } = {}) {
  const st = scanStoreRead();
  const n = scanBrowserSetups({ st }).length;
  const pre = el('pre', { class: 'scan-json', hidden: '' });
  const dl = el('button', { class: `btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm`, disabled: n ? null : '', onclick: () => {
    const doc = scanExportDoc();
    scanDownload(scanExportName(), doc);
    scanMarkExported(doc);
    toast(`Exported ${scanPlural(doc.setups.length, 'setup')} — save it over data/scan-setups.json`);
    scanRender();
  } }, 'Export scan-setups.json');
  const cp = el('button', { class: 'btn btn-ghost btn-sm', disabled: n ? null : '', onclick: async () => {
    const doc = scanExportDoc();
    const text = JSON.stringify(doc, null, 2);
    pre.textContent = text; pre.hidden = false;
    if (await scanCopy(text, 'Setups JSON copied — paste it as data/scan-setups.json')) { scanMarkExported(doc); }
  } }, 'Copy JSON');
  const box = el('div');
  box.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [dl, cp]));
  box.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, n
    ? `The export is the schema-2 setups document: every setup saved here at its current version, with its number and hash. Replace data/scan-setups.json with it, then run node scanner/scan.mjs or let the daily run pick it up. Deleted setups are left out.`
    : 'Nothing to export yet — no setup is saved in this browser.'));
  box.append(pre);
  return box;
}

/* =====================================================================
   HOW MUCH HISTORY A TIMEFRAME'S CONDITIONS NEED, AGAINST WHAT IS HELD

   A weekly EMA of 200 bars needs 200 closed weeks — about 1,000 daily bars
   — and a monthly one about seventeen years. Until the history holds them
   the condition is unknown on every bar, and a setup that turns on it is
   untested there, never recorded as not met: without this, a reader with a
   year of daily bars would wait for weekly and monthly alerts that cannot
   come. The run says so bar by bar; this says it once, per instrument, in
   words. What an operand needs is the engine's own count (SCAN_INDICATORS'
   `needs`, and one bar more for a crossing, which reads the bar before);
   what is held is the engine's bars, daily and resampled, counting only
   the weeks and months that have closed — the last closed bar is the one a
   condition reads.
   ===================================================================== */
/* A list in words: "a", "a and b", "a, b and c". */
const scanAnd = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/* Per timeframe, each indicator the conditions read — one entry for an
   indicator and its settings, naming the fields read from it (WaveTrend's
   WT1 and WT2 are one warm-up) — with the most bars any of them needs and
   whether it reads highs and lows. A bare price needs one bar and is left
   out: it is never what keeps a condition unknown. */
function scanNeedsOf(setups) {
  const byTf = new Map();
  const add = (tf, o, prev) => {
    if (!o || typeof o !== 'object' || o.indicator == null) return;
    const def = SCAN_INDICATORS[o.indicator];
    if (!def) return;
    const { params, problems } = scanParams(o);
    if (problems.length) return;
    const f = scanFieldOf(o);
    const n = (Number(def.needs(params, f)) || 1) + (prev ? 1 : 0);
    const inputs = (def.inputsOf ? def.inputsOf(params) : def.inputs) || [];
    const ohlc = inputs.includes('high') || inputs.includes('low');
    if (n <= 1 && !ohlc) return;
    /* One entry per indicator where its fields have their own names (the
       Pine indicators); the engine's own MACD and Bollinger name the field
       in their label, so each field is its own entry. */
    const key = def.sideLabel ? scanSpecKey(o, { multiplier: false }).replace(/\)\.\w+$/, ')') : scanSpecKey(o, { multiplier: false });
    const head = def.sideLabel ? def.sideLabel(params, null) : scanSideLabel({ ...o, multiplier: undefined });
    const fl = def.sideLabel && f ? def.fieldLabels?.[f] : null;
    const field = typeof fl === 'function' ? fl(params) : fl || (def.sideLabel && f && !def.fieldLabels ? f : '');
    if (!byTf.has(tf)) byTf.set(tf, new Map());
    const m = byTf.get(tf);
    const e = m.get(key) || { key, head, fields: [], needs: 0, ohlc: false };
    if (field && !e.fields.includes(field)) e.fields.push(field);
    e.needs = Math.max(e.needs, n);
    e.ohlc = e.ohlc || ohlc;
    e.label = e.fields.length ? `${e.head} ${scanAnd(e.fields)}` : e.head;
    m.set(key, e);
  };
  (setups || []).forEach(s => {
    const own = scanTimeframe(s?.timeframe);
    const walk = (n) => {
      if (n?.type === 'group') { (Array.isArray(n.children) ? n.children : []).forEach(walk); return; }
      if (!n || typeof n !== 'object') return;
      const tf = scanCondTf(n) || own, prev = !!SCAN_OPERATORS[scanOpName(n.op)]?.needsPrev;
      add(tf, n.left, prev); add(tf, n.right, prev);
      if (Array.isArray(n.range)) n.range.forEach(r => add(tf, r, false));
    };
    walk(s?.ruleTree);
  });
  return new Map([...byTf].sort((a, b) => (SCAN_TF_RANK[a[0]] ?? 9) - (SCAN_TF_RANK[b[0]] ?? 9)));
}
/* One instrument's history as the engine reads it: its valid daily bars,
   and the weeks and months among them that have closed. Kept for the
   history object it was read from, and the calendar per market with it. */
let scanHeldMemo = { history: null, map: new Map(), cal: new Map() };
function scanHeldOf(symbol, history = scanHistoryFile) {
  if (scanHeldMemo.history !== history) scanHeldMemo = { history, map: new Map(), cal: new Map() };
  if (scanHeldMemo.map.has(symbol)) return scanHeldMemo.map.get(symbol);
  let out = null;
  if (history?.series?.[symbol]) {
    const reg = scanRegistryList();
    const mkt = scanMarketOf(symbol, reg);
    if (!scanHeldMemo.cal.has(mkt || '')) scanHeldMemo.cal.set(mkt || '', scanCalendar(history, reg, mkt));
    const cal = scanHeldMemo.cal.get(mkt || '');
    const d = scanBars(history, symbol, { market: mkt, calendar: cal });
    const closed = (T) => (scanResample(d, T, { calendar: cal }).complete || []).filter(Boolean).length;
    out = { symbol, daily: d.dates.length, from: d.dates[0] || null, to: d.dates[d.dates.length - 1] || null, weeks: closed('1W'), months: closed('1M'), hasOHLC: !!d.hasOHLC };
  }
  scanHeldMemo.map.set(symbol, out);
  return out;
}
const scanHeldCount = (held, tf) => (tf === '1W' ? held.weeks : tf === '1M' ? held.months : held.daily);
/* A count of bars of a timeframe, with what it means in daily bars: a week
   is as many sessions as the instrument's own weeks hold (five for gold on
   its FX session, seven for a coin), a month a twelfth of a year. */
function scanNeedWords(tf, n, held) {
  if (tf === '1W') {
    const per = held?.weeks ? Math.max(1, Math.round(held.daily / held.weeks)) : 5;
    const d = n * per;
    return `${scanPlural(n, 'weekly bar')} (about ${(d >= 1000 ? Math.round(d / 50) * 50 : d).toLocaleString('en-US')} daily bars)`;
  }
  if (tf === '1M') return `${scanPlural(n, 'monthly bar')} (about ${n < 18 ? scanPlural(n, 'month') : scanPlural(Math.round(n / 12), 'year')} of daily bars)`;
  return scanPlural(n, `${scanTfWord(tf)} bar`);
}
/* Per instrument: a line saying what is held, then one per timeframe the
   conditions read — every indicator computable, or each one that is not
   named with what it needs. `unknown` counts those that stay unknown. */
function scanHistoryNeeds(symbols, byTf, history = scanHistoryFile) {
  return (symbols || []).map(sym => {
    const held = scanHeldOf(sym, history);
    if (!held) return { symbol: sym, unknown: null, head: `${sym} — no series in your history, so nothing is evaluated for it until you import one.`, lines: [] };
    let unknown = 0;
    const lines = [...byTf].filter(([, m]) => m.size).map(([tf, m]) => {
      const needs = [...m.values()];
      const have = scanHeldCount(held, tf);
      const heldText = tf === '1D' ? `${scanPlural(have, 'daily bar')} held` : `${scanPlural(have, `closed ${scanTfPeriod(tf)}`)} held`;
      const label = SCAN_TIMEFRAMES[tf]?.label || tf;
      const short = needs.filter(x => (x.ohlc && !held.hasOHLC) || x.needs > have);
      unknown += short.length;
      if (!short.length) {
        const most = needs.reduce((a, x) => (x.needs > a.needs ? x : a), needs[0]);
        return { tf, known: true, text: `${label} — ${heldText}. Every condition can be read: the longest warm-up, ${most.label}, needs ${scanNeedWords(tf, most.needs, held)}.` };
      }
      const why = short.map(x => (x.ohlc && !held.hasOHLC ? `${x.label}, which reads highs and lows this series does not hold` : `${x.label}, which needs ${scanNeedWords(tf, x.needs, held)}`));
      return { tf, known: false, text: `${label} — ${heldText}. Unknown: ${why.join('; ')}.` };
    });
    return { symbol: sym, unknown, held, lines,
      head: `${sym} — ${held.daily.toLocaleString('en-US')} daily bars held${held.from ? ` (${held.from} to ${held.to})` : ''}: ${scanPlural(held.weeks, 'closed week')} and ${scanPlural(held.months, 'closed month')}.` };
  });
}
/* The same, as a block of the page: at most `max` instruments, then how
   many more, and what an unknown criterion does. */
function scanHistoryNeedsBlock(symbols, byTf, { max = 8, history = scanHistoryFile } = {}) {
  const box = el('div', { class: 'scan-needs' });
  if (!history?.series) { box.append(el('p', { class: 'caption' }, 'No price history is loaded here, so what it holds against what these conditions need cannot be counted — on the deployed site it never is.')); return box; }
  const rows = scanHistoryNeeds(symbols.slice(0, max), byTf, history);
  const ul = el('ul', { class: 'scan-needs-list' });
  rows.forEach(r => ul.append(el('li', {}, [el('p', { class: 'scan-needs-hd' }, r.head),
    r.lines.length ? el('ul', { class: 'rulelist' }, r.lines.map(l => el('li', { class: l.known ? null : 'scan-needs-short' }, l.text))) : null])));
  box.append(ul);
  if (symbols.length > max) box.append(el('p', { class: 'caption' }, `And ${scanPlural(symbols.length - max, 'more instrument')}, not counted here.`));
  if (rows.some(r => r.unknown)) box.append(el('p', { class: 'caption', style: 'margin-top:6px;max-width:80ch' }, 'A condition that cannot be read is untested on that bar, never failed: a setup that turns on it records nothing where the conditions that can be read do not decide it, and each run names the timeframe that is short. It becomes readable once the history is long enough — importing your older TradingView bars is how.'));
  return box;
}

/* =====================================================================
   YOUR TRADINGVIEW BOT'S SIGNALS, AS SETUPS (contract B4)

   The reader's "Multi-Timeframe Trading Bot" script raises alerts from five
   criteria read on a trade timeframe and on an entry timeframe. The
   engine's scanBotPack writes each alert as an ordinary setup — daily bars,
   the trade timeframe's criteria read on the last closed weekly or monthly
   bar — and this card chooses which alerts, on which instruments, and
   saves them here like any setup, to be exported for the worker. The
   titles are the script's own and are shown as the script's: a match is a
   record that the reader's conditions held, not this product's call.
   The defaults are the reader's decisions of 2026-09-29: weekly and monthly
   trade timeframes, the EMA signal and the EMA 200 as the script computes
   them, and new matches only; ANY STRONG, ANY WEAK and Entry TF Trade are
   the script's aggregates of the others, so they start unticked.
   ===================================================================== */
const SCAN_BOT_GROUPS = [
  { id: 'trade', legend: 'Trade timeframe', note: 'Read on the last closed bar of each trade timeframe ticked above.' },
  { id: 'entry', legend: 'Entry (daily)', note: 'Read on each daily bar; one setup each, whatever the trade timeframes.' },
  { id: 'combined', legend: 'Combined', note: 'A daily entry with each trade timeframe ticked above.' },
];
const scanBotState = { open: false, symbols: null, tfs: ['1W', '1M'], signals: null, cooldownMode: 'NEW_MATCH', criterion3: 'ema', result: null };
/* The engine's list of the script's alerts, read whichever way a field is
   spelled, with its group: the script's own titles say it ("Trade TF …",
   "Entry TF …"), and an alert that needs no trade timeframe is an entry. */
function scanBotSignals() {
  const raw = typeof SCAN_BOT_SIGNALS !== 'undefined' ? SCAN_BOT_SIGNALS : null;
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([id, s]) => ({ id, ...s })) : [];
  return list.filter(s => s && typeof s === 'object' && s.id).map(s => {
    const title = String(s.title ?? s.alertTitle ?? s.alert ?? s.name ?? s.id);
    const needs = s.needsTradeTimeframe ?? s.needsTrade ?? s.tradeTimeframe ?? s.needsTradeTf ?? null;
    const g = String(s.group || '').toLowerCase();
    const group = /entry/.test(g) ? 'entry' : /combin|strong|weak|any/.test(g) ? 'combined' : /trade|tier/.test(g) ? 'trade'
      : /^entry\b/i.test(title) || needs === false ? 'entry' : /^trade\b/i.test(title) ? 'trade' : 'combined';
    const aggregate = s.aggregate != null ? !!s.aggregate : /^any\b/i.test(title) || /^entry tf trade$/i.test(title.trim());
    return { id: String(s.id), title, description: String(s.description ?? s.text ?? ''), needsTrade: needs == null ? group !== 'entry' : !!needs, group, aggregate };
  });
}
/* A setup the card saved, known by its id (mtfbot-<w|m|d>-<alert>): which
   of the script's alerts it is and on which trade timeframe, so every page
   that names it can say whose alert it is. */
function scanBotOrigin(id) {
  const m = /^mtfbot-([wmd])-(.+)$/.exec(String(id || ''));
  if (!m) return null;
  const sig = scanBotSignals().find(s => s.id === m[2]);
  return { tf: { w: '1W', m: '1M', d: '1D' }[m[1]], signal: m[2], title: sig?.title || null };
}
const scanBotOriginText = (o) => `Your script’s ${o.title || 'alert'}${o.tf === '1D' ? ', read on the daily bar' : `, with its trade timeframe read on the last closed ${scanTfWord(o.tf)} bar`} — added from your TradingView bot’s signals. A match records that your script’s conditions held on that bar; it is not a signal from this product.`;
/* The history's instruments, gold first when it is held: the reader's
   chart is OANDA:XAUUSD. */
function scanBotSymbols(history = scanHistoryFile) {
  const all = Object.keys(history?.series || {}).sort((a, b) => a.localeCompare(b));
  return all.includes('XAUUSD') ? ['XAUUSD', ...all.filter(s => s !== 'XAUUSD')] : all;
}
/* What the card hands scanBotPack. */
function scanBotOptions(st = scanBotState) {
  const symbols = [...(st.symbols || [])];
  return { symbols, universe: { kind: 'symbols', symbols: [...symbols] }, tradeTimeframes: ['1W', '1M'].filter(t => st.tfs.includes(t)),
    signals: [...(st.signals || [])], cooldownMode: st.cooldownMode, criterion3: st.criterion3, macdSignal: 'ema' };
}
/* The setups the card would save now, or why none. */
function scanBotPreview(st = scanBotState) {
  const o = scanBotOptions(st);
  if (!o.symbols.length) return { setups: [], why: 'Choose at least one instrument.' };
  if (!o.signals.length) return { setups: [], why: 'Choose at least one of your script’s alerts.' };
  let setups;
  try { setups = scanBotPack(o); } catch (e) { return { setups: [], why: `The engine refused these choices — ${String(e?.message || e)}` }; }
  setups = Array.isArray(setups) ? setups.filter(s => s && typeof s === 'object') : [];
  return { setups, why: setups.length ? null : 'No trade timeframe is ticked, and every alert chosen needs one — tick Weekly or Monthly, or an entry alert.' };
}
function scanBotCreate() {
  const pv = scanBotPreview();
  if (!pv.setups.length) return null;
  const st = scanStoreRead();
  const res = { at: new Date().toISOString(), created: 0, bumped: 0, same: 0, restored: 0, refused: [], ids: [] };
  pv.setups.forEach(s => {
    const was = st.setups[s.id];
    const out = scanSaveSetup(s, { source: 'bot', st });
    if (!out.ok) { res.refused.push(`${s.id}: ${out.problems[0]}`); return; }
    res.ids.push(out.id);
    if (was?.deleted) res.restored++;
    if (out.created) res.created++; else if (out.bumped) res.bumped++; else res.same++;
  });
  scanBotState.result = res;
  return res;
}
function scanBotCard() {
  const det = el('details', { class: 'card scan-bot', open: scanBotState.open ? '' : null });
  det.append(el('summary', {}, [el('span', { class: 'h-card' }, 'Add your TradingView bot’s signals'),
    el('span', { class: 'caption scan-bot-sub' }, 'Your “Multi-Timeframe Trading Bot” script’s alerts, as setups of your own: entries on the daily bar, the trade timeframe on the last closed weekly and monthly bar.')]));
  const body = el('div', { class: 'scan-bot-body' });
  det.append(body);
  let built = false;
  const fill = () => { built = true; body.replaceChildren(...scanBotForm()); };
  if (scanBotState.open) fill();
  det.addEventListener('toggle', () => { scanBotState.open = det.open; if (det.open && !built) fill(); });
  return det;
}
function scanBotForm() {
  const out = [];
  const signals = scanBotSignals();
  if (typeof scanBotPack !== 'function' || !signals.length) {
    out.push(el('p', { class: 'caption scan-note' }, 'This build’s engine does not carry your script’s alerts (scanBotPack), so they cannot be added here.'));
    return out;
  }
  const st = scanBotState;
  const history = scanHistoryFile;
  const syms = scanBotSymbols(history);
  if (st.symbols == null) st.symbols = syms.includes('XAUUSD') ? ['XAUUSD'] : [];
  if (st.signals == null) st.signals = signals.filter(s => !s.aggregate).map(s => s.id);
  out.push(el('p', { class: 'body scan-bot-intro' }, 'Your script raises its alerts from five criteria — WaveTrend’s WT1 against WT2, the MACD line against its EMA signal, the close against the 200 EMA, MCDX’s banker above 5 and, for sells, its hot money below 10 — read on a trade timeframe and on the daily entry timeframe. Each alert you tick becomes a setup of your own on daily bars, with the trade timeframe’s criteria read on the last closed weekly bar and, as a second trade timeframe, the last closed monthly bar — never the week or month in progress. A match records that your script’s conditions held on that bar, under your script’s own alert title. It is not a signal from this product, and nothing here says what to do.'));
  const check = (label, on, set, { aria = null, sub = null, focus = null } = {}) => {
    const lab = el('label', { class: 'checkline scan-bot-check' });
    lab.append(el('input', { type: 'checkbox', checked: on ? '' : null, 'aria-label': aria || label, data: focus ? { scanFocus: focus } : {}, onchange: e => { set(e.target.checked); refresh(); } }));
    lab.append(el('span', {}, [el('span', { class: 'scan-radio-l' }, label), sub ? el('span', { class: 'caption', style: 'display:block' }, sub) : null]));
    return lab;
  };
  const radios = (legend, val, opts, set) => {
    const fs = el('fieldset', { class: 'scan-radios' });
    fs.append(el('legend', {}, legend));
    const name = `scan-bot-${legend.replace(/\W+/g, '-').toLowerCase()}`;
    opts.forEach(([v, l, sub]) => {
      const lab = el('label', { class: 'checkline scan-radio' });
      lab.append(el('input', { type: 'radio', name, value: v, checked: val === v ? '' : null, 'aria-label': `${legend}: ${l}`, onchange: e => { if (e.target.checked) { set(v); refresh(); } } }));
      lab.append(el('span', {}, [el('span', { class: 'scan-radio-l' }, l), sub ? el('span', { class: 'caption', style: 'display:block' }, sub) : null]));
      fs.append(lab);
    });
    return fs;
  };
  const toggle = (list, v, on) => (on ? [...new Set([...list, v])] : list.filter(x => x !== v));

  /* ---- instruments ---- */
  const fi = el('fieldset', { class: 'scan-bot-set' });
  fi.append(el('legend', {}, 'Instruments'));
  if (!syms.length) fi.append(el('p', { class: 'caption' }, 'No price history is loaded here, so there is no instrument to choose — on the deployed site there never is. On the machine the worker runs on, import your OANDA:XAUUSD export into data/price-history.json first.'));
  else {
    fi.append(el('p', { class: 'caption', style: 'margin:0 0 6px' }, `The ${scanPlural(syms.length, 'instrument')} your history holds a series for${syms[0] === 'XAUUSD' ? ', XAUUSD — your chart’s — first' : '; XAUUSD, your chart’s, is not among them yet'}. The setups scan every one ticked.`));
    const box = el('div', { class: 'scan-bot-syms' });
    syms.forEach(sym => box.append(check(sym, st.symbols.includes(sym), on => { st.symbols = toggle(st.symbols, sym, on); }, { aria: `Instrument ${sym}` })));
    fi.append(box);
  }
  out.push(fi);

  /* ---- trade timeframes ---- */
  const ft = el('fieldset', { class: 'scan-bot-set' });
  ft.append(el('legend', {}, 'Trade timeframes'));
  const tfRow = el('div', { class: 'scan-bot-row' });
  [['1W', 'Weekly', 'the last closed week — your script’s trade timeframe'], ['1M', 'Monthly', 'the last closed month — a second trade timeframe, as you asked']]
    .forEach(([t, l, sub]) => tfRow.append(check(l, st.tfs.includes(t), on => { st.tfs = toggle(st.tfs, t, on); }, { aria: `Trade timeframe ${l}`, sub })));
  ft.append(tfRow);
  out.push(ft);

  /* ---- the script's alerts, by group ---- */
  SCAN_BOT_GROUPS.forEach(g => {
    const list = signals.filter(s => s.group === g.id);
    if (!list.length) return;
    const fs = el('fieldset', { class: 'scan-bot-set' });
    fs.append(el('legend', {}, g.legend));
    fs.append(el('p', { class: 'caption', style: 'margin:0 0 6px' }, g.note));
    const grid = el('div', { class: 'scan-bot-signals' });
    list.forEach(s => grid.append(check(`your script’s ${s.title}`, st.signals.includes(s.id), on => { st.signals = toggle(st.signals, s.id, on); },
      { aria: `Your script’s ${s.title}`, sub: [s.description, s.aggregate ? 'The script’s aggregate of the alerts above — ticked with them, it records the same bars twice.' : null].filter(Boolean).join(' ') })));
    fs.append(grid);
    out.push(fs);
  });

  /* ---- how, and criterion 3 ---- */
  const opts = el('div', { class: 'grid g-2 scan-grid scan-bot-opts' });
  opts.append(radios('Record', st.cooldownMode, [
    ['NEW_MATCH', 'New matches', 'the bar an alert’s conditions begin to hold — they held, and did not on the bar before'],
    ['EVERY_MATCH', 'Every match', 'every bar on which they hold']], v => { st.cooldownMode = v; }));
  opts.append(radios('Criterion 3', st.criterion3, [
    ['ema', 'Close above the EMA 200', 'as your script computes it — its criterion 3'],
    ['sma', 'Close above the SMA 200', 'as your chart draws it (Color MA and SMA Cross)']], v => { st.criterion3 = v; }));
  out.push(opts);
  out.push(el('p', { class: 'caption', style: 'margin:0' }, 'Criterion 2 compares the MACD line with its EMA signal, as your script does; the CM MACD on your chart draws an SMA signal, and the two disagree on some bars.'));

  /* ---- what it makes, what the history holds, and the button ---- */
  const preview = el('p', { class: 'metaline scan-bot-preview', 'aria-live': 'polite' });
  const needsHost = el('div', { class: 'scan-bot-needs' });
  const btn = el('button', { class: 'btn btn-primary', data: { scanFocus: 'bot-create' }, onclick: () => {
    const res = scanBotCreate();
    if (!res) return;
    toast(res.ids.length ? `Saved ${scanPlural(res.ids.length, 'setup')} in this browser — export scan-setups.json for the worker to run them` : `Not saved — ${res.refused[0]}`);
    scanRender();
  } }, 'Save these setups');
  const status = el('div', { class: 'scan-bot-status', role: 'status' });
  const r = st.result;
  if (r) {
    status.append(el('p', { class: 'scan-note', style: 'margin:0' }, `Saved ${scanPlural(r.ids.length, 'setup')} in this browser at ${scanStamp(r.at)}: ${r.created} new, ${scanPlural(r.bumped, 'new version')}, ${r.same} unchanged${r.restored ? `, ${r.restored} restored from deleted` : ''}${r.refused.length ? `, ${r.refused.length} refused` : ''}. They are in this browser only: the worker runs data/scan-setups.json, so none of them records a match until you export scan-setups.json above and save it over that file.`));
    if (r.refused.length) status.append(el('ul', { class: 'scan-problems' }, r.refused.map(t => el('li', {}, t))));
  }
  const tail = el('div', { class: 'scan-bot-tail' }, [preview, needsHost, el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [btn]), status]);
  out.push(tail);
  function refresh() {
    const pv = scanBotPreview(st);
    const n = pv.setups.length;
    btn.disabled = !n;
    btn.textContent = n ? `Save ${scanPlural(n, 'setup')}` : 'Save these setups';
    /* The ids say each setup's trade timeframe (mtfbot-w-…, -m-, -d- for
       an entry), so the count can say how they divide. */
    const per = new Map();
    pv.setups.forEach(s => { const k = /^mtfbot-([wmd])-/.exec(String(s.id))?.[1]; if (k) per.set(k, (per.get(k) || 0) + 1); });
    const split = [['w', 'weekly'], ['m', 'monthly'], ['d', 'daily entry']].filter(([k]) => per.get(k)).map(([k, w]) => `${per.get(k)} ${w}`).join(', ');
    preview.textContent = n
      ? `${scanPlural(n, 'setup')}, one per alert and trade timeframe${split ? ` (${split})` : ''}, each scanning ${scanPlural(st.symbols.length, 'instrument')}. One saved here already becomes a new version only if what it evaluates changed.`
      : pv.why;
    needsHost.replaceChildren(...(n ? [el('h3', { class: 'eyebrow', style: 'margin:0 0 4px' }, 'What your history holds for them'), scanHistoryNeedsBlock(st.symbols, scanNeedsOf(pv.setups), { history })] : []));
  }
  refresh();
  return out;
}

/* The boundary, stated once on the setups page and not implied anywhere. */
function scanBoundaryDetails() {
  const det = el('details', { class: 'card scan-boundary' });
  det.append(el('summary', { class: 'h-card' }, 'What this will and will not do'));
  det.append(el('ul', { class: 'ticklist', style: 'margin-top:var(--sm)' }, [
    el('li', {}, 'It reads only your own price history — data/price-history.json, built from your screen or your export under your subscription. No feed is licensed to this product, so no other data is scanned and none of this is offered to anyone else.'),
    el('li', {}, 'A match is a record that the conditions you wrote held on a completed bar, with the values. It is not a signal, and no indicator here has been validated on point-in-time data, so none is claimed to work.'),
    el('li', {}, 'Nothing is ranked or sorted by strength. Matches appear in date order, then in the order of your setups and your instruments.'),
    el('li', {}, 'Nothing is delivered. The worker writes a file; these pages read it. Email, Telegram and push need a server and a contact address held under a privacy notice, and this build has neither.'),
    el('li', {}, 'Setups are kept in this browser and in git-ignored files on this machine. That is not access control: there are no accounts, and anyone with this machine or browser profile can read them.'),
    el('li', {}, 'Daily bars, and weekly and monthly bars derived from them; a condition can read a higher timeframe than its setup’s, on that timeframe’s last closed bar. A bar captured before its session closed is provisional and never confirms a match; sessions are inferred from your own history, not from an exchange calendar. Intraday needs a licensed feed.'),
  ]));
  return det;
}

/* =====================================================================
   /app/scanner/setups
   ===================================================================== */
VIEWS.scannerSetups = () => {
  const wrap = scanPage();
  wrap.append(scanSubnav('setups'));
  const st = scanStoreRead();
  const setups = scanBrowserSetups({ st });
  const deleted = Object.values(st.setups).filter(r => r && r.deleted);
  const drift = scanDriftRows({ st });
  const driftById = new Map(drift.map(r => [r.id, r]));
  const fileCheck = scanSetupsFile ? scanValidate(scanSetupsFile) : null;
  const head = scanPageHead('Your setups', 'Conditions you wrote, saved in this browser with every version, and exported to the file the worker reads. Nothing here proposes a setup or ranks one against another.');
  head.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [scanLink('/app/scanner/setups/new', 'New setup', { class: 'btn btn-primary' })]));
  wrap.append(head);

  /* ---- the two copies ---- */
  const dc = el('div', { class: 'card' });
  const off = drift.filter(r => r.state !== 'IN_STEP');
  dc.append(cardHead('This browser and the worker’s file', scanSetupsFile == null
    ? 'data/scan-setups.json cannot be seen from here — on the deployed site it never can. This browser’s copy is the only copy until you export it.'
    : !drift.length ? 'Neither this browser nor data/scan-setups.json holds a setup yet.'
    : off.length ? `${scanPlural(off.length, 'setup')} of ${drift.length} ${off.length === 1 ? 'differs' : 'differ'} from data/scan-setups.json. The worker runs the file, not this browser.`
    : `All ${scanPlural(drift.length, 'setup')} in step with data/scan-setups.json.`));
  if (drift.length) {
    const ul = el('ul', { class: 'scan-drift' });
    drift.forEach(r => {
      const s = r.browser || r.file;
      const li = el('li', {}, [
        el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
          scanLink(scanSetupPath(r.id), s?.name || r.name || r.id, { style: 'font-weight:600' }), scanDriftChip(r),
          el('span', { class: 'spacer' }),
          (r.state === 'FILE_NEWER' || r.state === 'FILE_ONLY') ? el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `Adopt ${r.id} from the file`, onclick: () => {
            const out = scanAdoptFromFile(r.id);
            toast(out.ok ? `Adopted ${r.id} as v${out.version}` : `Not adopted — ${out.problems[0]}`);
            scanRender();
          } }, 'Adopt from file') : null,
        ]),
        el('p', { class: 'caption', style: 'margin-top:2px' }, r.text),
      ]);
      ul.append(li);
    });
    dc.append(ul);
  }
  if (fileCheck?.problems.length) {
    const pr = el('div', { class: 'panel scan-warn', style: 'margin-top:var(--sm)' });
    pr.append(el('p', { class: 'metaline', style: 'font-weight:600' }, 'Refused in data/scan-setups.json — the worker leaves these out too. A setup passes whole or not at all:'));
    pr.append(el('ul', { class: 'rulelist' }, fileCheck.problems.map(p => el('li', {}, p))));
    dc.append(pr);
  }
  const fileOnly = drift.filter(r => r.state === 'FILE_ONLY');
  if (fileOnly.length > 1) dc.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--sm)', onclick: () => {
    const res = fileOnly.map(r => scanAdoptFromFile(r.id));
    toast(`Adopted ${res.filter(x => x.ok).length} of ${fileOnly.length} from the file`);
    scanRender();
  } }, `Adopt all ${fileOnly.length} from the file`));
  const exp = scanExportControls({ primary: off.some(r => r.state === 'NOT_EXPORTED' || r.state === 'BROWSER_ONLY') });
  exp.style.marginTop = 'var(--md)';
  dc.append(exp);
  wrap.append(dc);
  /* The reader's TradingView bot's alerts, as setups — below the export,
     which is what makes them run. */
  wrap.append(scanBotCard());

  /* ---- the setups ---- */
  if (!setups.length) {
    const e = el('div', { class: 'card scan-empty' });
    e.append(el('h2', { class: 'h-card' }, 'No setups saved in this browser'));
    e.append(el('p', { class: 'body', style: 'margin:6px auto 0' }, fileOnly.length
      ? `The worker’s file holds ${scanPlural(fileOnly.length, 'setup')} this browser has not adopted. Adopt them above to see their versions here and edit them in the builder, or write a new one.`
      : 'Write a setup from conditions you choose — the builder offers every indicator and operator the engine evaluates, and refuses a comparison of two unrelated scales. A committed example of the file is at scanner/setups.example.json.'));
    e.append(el('div', { class: 'row row-wrap', style: 'gap:8px;justify-content:center;margin-top:var(--md)' }, scanLink('/app/scanner/setups/new', 'Write a setup', { class: 'btn btn-primary btn-sm' })));
    wrap.append(e);
  } else {
    const list = el('div', { class: 'card' });
    list.append(cardHead(`Saved here — ${scanPlural(setups.length, 'setup')}`, 'In the order you created them. Each shows its current version; open one for its history and the matches each version recorded.'));
    setups.forEach(s => {
      const p = el('div', { class: 'panel scan-setup-row' });
      const nAlerts = scanAlertsOf(s.id).length;
      p.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
        scanLink(scanSetupPath(s.id), s.name || s.id, { class: 'scan-setup-name' }),
        el('span', { class: 'chip' }, s.id),
        scanBotOrigin(s.id) ? el('span', { class: 'chip chip-bronze', title: scanBotOriginText(scanBotOrigin(s.id)) }, 'your script’s alert') : null,
        scanDriftChip(driftById.get(s.id)),
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-quiet btn-sm', data: { scanFocus: `toggle:${s.id}` }, 'aria-label': `${s.enabled ? 'Disable' : 'Enable'} ${s.name || s.id}`, onclick: () => {
          scanSetMeta(s.id, { enabled: !s.enabled }); toast(`${s.name || s.id} ${s.enabled ? 'disabled' : 'enabled'} — not a new version; export to tell the worker`); scanRender();
        } }, s.enabled ? 'Disable' : 'Enable'),
        scanLink(`/app/scanner/setups/${encodeURIComponent(s.id)}/edit`, 'Edit', { class: 'btn btn-ghost btn-sm', 'aria-label': `Edit ${s.name || s.id}` }),
      ]));
      p.append(scanSetupChips(s));
      if (s.description) p.append(el('p', { class: 'body', style: 'margin-top:6px;font-size:13px' }, s.description));
      p.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, `Universe: ${scanUniverseProse(s.universe)} · ${scanTimeframeProse(s)}.`));
      p.append(scanTreeList(s.ruleTree, s.timeframe));
      const wd = scanWatchlistDrift(s);
      if (wd && !wd.same) p.append(el('p', { class: 'caption scan-note', style: 'margin-top:6px' }, wd.text));
      p.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, nAlerts
        ? [scanLink(`/app/scanner/alerts?setup=${encodeURIComponent(s.id)}`, `${scanPlural(nAlerts, 'recorded match', 'recorded matches')}`), ' in data/scan-alerts.json.']
        : scanAlertsFile ? 'No match recorded for it yet.' : 'The alerts file cannot be seen from here.'));
      list.append(p);
    });
    wrap.append(list);
  }
  if (deleted.length) {
    const det = el('details', { class: 'card' });
    det.append(el('summary', { class: 'h-card' }, `Deleted — ${scanPlural(deleted.length, 'setup')}`));
    det.append(el('p', { class: 'caption', style: 'margin-top:6px' }, 'A deleted setup keeps its versions, because the matches it recorded still name them. It is left out of the export.'));
    deleted.forEach(r => det.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px' }, [
      scanLink(scanSetupPath(r.id), r.name || r.id), el('span', { class: 'chip' }, `v${r.current}`), el('span', { class: 'caption' }, `deleted ${scanDay(r.deleted)}`),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `Restore ${r.name || r.id}`, onclick: () => { scanSetMeta(r.id, { deleted: null }); toast(`Restored ${r.name || r.id}`); scanRender({ fallback: `toggle:${r.id}` }); } }, 'Restore'),
    ])));
    wrap.append(det);
  }

  /* ---- evaluate now, on either copy ---- */
  const history = scanHistoryFile;
  const haveHistory = !!(history?.series && Object.keys(history.series).length);
  const ev = el('div', { class: 'card' });
  ev.append(cardHead('Evaluate now — nothing recorded', haveHistory
    ? 'Runs the engine the worker runs, here, on data/price-history.json as the worker reads it. The worker writes the record; this writes nothing.'
    : 'No price history is loaded, so there is nothing to evaluate. On the deployed site there never is: none of the prices this product could ship are licensed for it to redistribute.'));
  const host = el('div', { style: 'margin-top:var(--sm)' });
  const fileSetups = fileCheck?.setups || [];
  const run = (list, which) => {
    const r = scanRunHere(list, history, { instruments: scanRegistryList(), existing: scanAlertList(), now: new Date().toISOString() });
    host.replaceChildren(scanRunSummary(r, `Evaluated ${which} — nothing recorded.`));
  };
  ev.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
    el('button', { class: 'btn btn-ghost btn-sm', disabled: haveHistory && setups.length ? null : '', onclick: () => run(setups, 'this browser’s setups at their current versions') }, 'Evaluate this browser’s setups'),
    el('button', { class: 'btn btn-ghost btn-sm', disabled: haveHistory && fileSetups.length ? null : '', onclick: () => run(fileSetups, 'the setups in data/scan-setups.json, as the worker would') }, 'Evaluate the file’s setups'),
  ]));
  ev.append(host);
  wrap.append(ev);
  wrap.append(scanBoundaryDetails());
  return wrap;
};

/* The old combined page's address. The route table points /my/scanner at
   the dashboard once the operations pages are in; until then, and wherever
   the dashboard is absent, the address shows the setups rather than a
   not-found card — or, carrying the company page's ?symbol=, the builder
   started on that symbol. */
VIEWS.scanner = () => (new URLSearchParams(location.search).get('symbol') ? VIEWS.scannerSetupNew : VIEWS.scannerDashboard || VIEWS.scannerSetups)();

/* =====================================================================
   /app/scanner/setups/:setup — one setup, its versions and their matches
   ===================================================================== */
VIEWS.scannerSetup = () => {
  const wrap = scanPage();
  wrap.append(scanSubnav('setups'));
  const id = scanParam('setup');
  const st = scanStoreRead();
  const rec = st.setups[id] || null;
  const drift = scanDriftRows({ st }).find(r => r.id === id) || null;
  const fileSetup = drift?.file || null;
  const alerts = scanAlertsInOrder(scanAlertsOf(id));
  if (!rec && !fileSetup && !alerts.length) {
    wrap.append(scanNotInRecord(`No setup “${id}”`, `This browser holds no setup with that id, ${scanSetupsFile ? 'data/scan-setups.json does not name it' : 'data/scan-setups.json cannot be seen from here'}, and ${scanAlertsFile ? 'no recorded match names it' : 'the alerts file cannot be seen from here'}.`, ['/app/scanner/setups', 'Your setups']));
    return wrap;
  }
  const cur = rec ? scanRecordSetup(rec) : fileSetup;
  const q = Number(new URLSearchParams(location.search).get('version'));
  const wantV = Number.isInteger(q) && q > 0 ? q : null;
  const name = cur?.name || alerts[0]?.setupName || id;
  const head = scanPageHead(name, cur?.description || null, rec?.deleted ? 'Scanner setup · deleted' : 'Scanner setup');
  const acts = el('div', { class: 'row row-wrap', style: 'gap:8px' });
  if (rec && !rec.deleted) {
    acts.append(scanLink(`/app/scanner/setups/${encodeURIComponent(id)}/edit`, 'Edit', { class: 'btn btn-primary btn-sm' }));
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', data: { scanFocus: 'toggle' }, onclick: () => { scanSetMeta(id, { enabled: rec.enabled === false }); toast(`${rec.enabled === false ? 'Enabled' : 'Disabled'} — not a new version; export to tell the worker`); scanRender(); } }, rec.enabled === false ? 'Enable' : 'Disable'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', data: { scanFocus: 'delete-restore' }, onclick: () => {
      if (!confirm(`Delete “${name}”? Its versions are kept, because the matches it recorded name them; it leaves the export.`)) return;
      scanSetMeta(id, { deleted: new Date().toISOString() }); toast('Deleted — restore it from the setups page'); scanRender();
    } }, 'Delete'));
  }
  if (rec?.deleted) acts.append(el('button', { class: 'btn btn-ghost btn-sm', data: { scanFocus: 'delete-restore' }, onclick: () => { scanSetMeta(id, { deleted: null }); toast('Restored'); scanRender(); } }, 'Restore'));
  if (drift && (drift.state === 'FILE_NEWER' || drift.state === 'FILE_ONLY')) acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const out = scanAdoptFromFile(id); toast(out.ok ? `Adopted as v${out.version}` : `Not adopted — ${out.problems[0]}`); scanRender();
  } }, 'Adopt from file'));
  head.append(acts);
  wrap.append(head);
  /* One of the reader's TradingView bot's alerts: its title is the
     script's, and the page says so before anything else. */
  const origin = scanBotOrigin(id);
  if (origin) wrap.append(el('p', { class: 'caption scan-note scan-bot-origin', style: 'margin:0' }, scanBotOriginText(origin)));

  /* ---- the current version ---- */
  if (cur) {
    const cv = el('div', { class: 'card' });
    const ver = rec ? scanVersionOf(rec) : null;
    cv.append(cardHead(`${rec ? 'Current version' : 'In the file only'} — v${cur.version}`, rec
      ? `Saved ${scanStamp(ver?.savedAt)}${ver?.source === 'file' ? ', adopted from the file' : ver?.source === 'bot' ? ', added from your TradingView bot’s signals' : ' from the builder'}. Hash ${cur.hash} — the engine’s name for exactly these conditions.`
      : `Not adopted into this browser. Hash ${cur.hash}.`));
    cv.append(scanSetupChips(cur, [el('span', { class: 'chip' }, cur.id), scanDriftChip(drift)]));
    const facts = el('div', { class: 'scan-facts', style: 'margin-top:var(--md)' });
    facts.append(scanFact('Universe', scanUniverseProse(cur.universe)));
    /* A condition on a higher timeframe reads that timeframe's last closed
       bar, and the fact says so beside the setup's own. */
    const hiTfs = scanTreeTfs(cur.ruleTree, cur.timeframe);
    const hiN = scanTreeTfCount(cur.ruleTree, cur.timeframe);
    facts.append(scanFact('Timeframe', `${SCAN_TIMEFRAMES[cur.timeframe]?.label || cur.timeframe}${hiTfs.length ? `, with ${hiTfs.map(t => scanTfWord(t)).join(' and ')} conditions` : ''}`,
      `${SCAN_TIMEFRAMES[cur.timeframe]?.note || ''}${hiTfs.length ? `${SCAN_TIMEFRAMES[cur.timeframe]?.note ? '. ' : ''}${scanPlural(hiN, 'condition')} ${hiN === 1 ? 'reads' : 'read'} the last closed ${hiTfs.map(scanTfPeriod).join(' or ')} instead, built from the same daily bars — never the one in progress, and on each bar the one that had closed by then.` : ''}` || null));
    facts.append(scanFact('Confirmation', 'Bar close', 'Only a completed bar is evaluated; a provisional bar never confirms a match.'));
    facts.append(scanFact('Recording', cur.cooldownMode === 'NEW_MATCH' ? 'New match' : 'Every match', `${cur.cooldownMode === 'NEW_MATCH' ? 'Only the bar a match begins is recorded.' : 'Every bar the conditions hold is recorded.'}${cur.cooldownBars ? ` Then ${scanPlural(cur.cooldownBars, 'bar')} of cooldown per instrument.` : ' No cooldown.'}`));
    facts.append(scanFact('Expires', cur.expires || 'Never'));
    facts.append(scanFact('Created · updated', rec ? `${scanDay(rec.created)} · ${scanDay(rec.updated)}` : `${scanDay(cur.created)} · ${scanDay(cur.updated)}`));
    cv.append(facts);
    cv.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 0' }, 'Conditions'));
    cv.append(scanTreeList(cur.ruleTree, cur.timeframe));
    if (drift) cv.append(el('p', { class: 'caption scan-note', style: 'margin-top:var(--sm)' }, drift.text));
    const wd = scanWatchlistDrift(cur);
    if (wd) cv.append(el('p', { class: 'caption scan-note', style: 'margin-top:6px' }, wd.text));
    /* Conditions on a higher timeframe need years of daily bars before
       they can be read, and the bot's criteria read highs and lows; per
       instrument, what is held against that. */
    if (hiTfs.length || origin) {
      const u = cur.universe || { kind: 'all' };
      const syms = u.kind === 'symbols' || u.kind === 'watchlist' ? (u.symbols || []).map(s => String(s).toUpperCase())
        : scanHistoryFile ? scanUniverse(cur, scanHistoryFile, scanRegistryList()) : [];
      cv.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 4px' }, 'What your history holds for these conditions'));
      cv.append(scanHistoryNeedsBlock(syms, scanNeedsOf([cur])));
    }
    wrap.append(cv);
  }

  /* ---- every version, with the matches it recorded ---- */
  const byVersion = new Map();
  alerts.forEach(a => { const v = a.setupVersion ?? 1; if (!byVersion.has(v)) byVersion.set(v, []); byVersion.get(v).push(a); });
  const held = new Map((rec?.versions || []).map(v => [v.version, v]));
  const allV = [...new Set([...held.keys(), ...byVersion.keys(), ...(fileSetup && !rec ? [fileSetup.version] : [])])].sort((a, b) => b - a);
  const vc = el('div', { class: 'card' });
  vc.append(cardHead('Versions', 'A change to what the setup evaluates is a new version; the earlier ones are kept, and each match names the version that recorded it. The name, description and enabled flag are not versioned.'));
  if (wantV && !allV.includes(wantV)) vc.append(el('p', { class: 'caption scan-note' }, `v${wantV} is not held in this browser${scanSetupsFile ? ', in the file' : ''}, or on any recorded match.`));
  const stAlerts = scanAlertStateRead();
  allV.forEach(v => {
    const hv = held.get(v);
    const snap = hv ? scanRecordSetup(rec, v) : (fileSetup && fileSetup.version === v && !rec ? fileSetup : byVersion.get(v)?.[0]?.setupSnapshot ? scanNormaliseSetup({ ...byVersion.get(v)[0].setupSnapshot, id }) : null);
    const va = byVersion.get(v) || [];
    const det = el('details', { class: 'scan-version', id: `v${v}`, open: (wantV ? wantV === v : rec ? v === rec.current : v === allV[0]) ? '' : null });
    det.append(el('summary', {}, el('span', { class: 'row row-wrap', style: 'gap:6px;display:inline-flex' }, [
      el('strong', {}, `v${v}`),
      rec && v === rec.current ? el('span', { class: 'chip chip-ok' }, 'current') : null,
      el('span', { class: 'caption' }, hv ? `saved ${scanStamp(hv.savedAt)}${hv.source === 'file' ? ' · adopted from the file' : hv.source === 'bot' ? ' · from your bot’s signals' : ''}` : snap ? 'known from its matches' : 'not held'),
      el('span', { class: 'chip' }, scanPlural(va.length, 'match', 'matches')),
      hv ? el('span', { class: 'caption' }, `hash ${hv.hash}`) : null,
    ])));
    if (snap) {
      det.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, `${scanUniverseProse(snap.universe)} · ${SCAN_TIMEFRAMES[snap.timeframe]?.label || snap.timeframe} · ${snap.cooldownMode === 'NEW_MATCH' ? 'new matches only' : 'every match'}${snap.cooldownBars ? ` · cooldown ${snap.cooldownBars}` : ''}${snap.expires ? ` · expires ${snap.expires}` : ''}`));
      det.append(scanTreeList(snap.ruleTree, snap.timeframe));
      if (!hv) det.append(el('p', { class: 'caption', style: 'margin-top:4px' }, 'Not saved in this browser: shown from the snapshot the worker wrote into its matches.'));
    } else det.append(el('p', { class: 'caption', style: 'margin-top:6px' }, 'Its conditions are not held here, and its matches were recorded before alerts carried a snapshot of the setup (engine 0.3.0).'));
    if (va.length) {
      const ul = el('ul', { class: 'scan-alert-mini' });
      /* Each match with the bars of other timeframes its conditions were
         read on (B3): the daily bar it names, and the weekly or monthly
         bar that had closed by then. */
      va.slice(0, 20).forEach(a => { const other = scanReadOnOthers(a); ul.append(el('li', {}, [
        scanLink(scanAlertPath(a), `${scanAlertBar(a)} · ${a.symbol}`), ' ',
        el('span', { class: 'caption' }, `${a.eventType || 'MATCH'} · ${scanAlertStatus(a, stAlerts).toLowerCase()}${other ? ` · read on the ${other}` : ''}`),
      ])); });
      det.append(ul);
      if (va.length > 20) det.append(el('p', { class: 'caption' }, [`Showing the newest 20 of ${va.length}. `, scanLink(`/app/scanner/alerts?setup=${encodeURIComponent(id)}`, 'All of them')]));
    }
    vc.append(det);
  });
  if (!scanAlertsFile) vc.append(el('p', { class: 'caption', style: 'margin-top:var(--sm)' }, 'The alerts file cannot be seen from here, so no version shows its matches.'));
  wrap.append(vc);
  return wrap;
};

/* =====================================================================
   THE BUILDER — /app/scanner/setups/new and /app/scanner/setups/:setup/edit

   It works on the engine's rule tree through the engine's own functions:
   scanNormaliseSetup reads whatever arrives, scanValidate says what is
   wrong and where, and the operand choices come from SCAN_INDICATORS and
   SCAN_UNITS — a right-hand side is offered only where its unit matches the
   left, and a fixed value carries the left side's literal domain. So a
   comparison of RSI with volume cannot be picked, and one that arrives
   anyway (typed into the JSON) is refused at its condition with the reason.

   One group is edited: Match ALL or Match ANY of a list of conditions. The
   schema allows groups inside groups, and a setup that arrives with them
   (from the file, or the example) shows its tree read-only; the builder
   does not flatten what it did not write.

   Text, number and date fields update the draft on every keystroke and
   refresh the outputs in place; nothing is rebuilt under the cursor, so focus
   stays, a click straight after an edit lands, and a date is not committed at
   its first year digit. Only a select that changes which fields exist
   rebuilds, and focus returns to it. A blank number is absent — the default
   applies, or the setup is refused with the reason — never a silent 0.
   ===================================================================== */
/* The new-setup draft, and an edit's draft, live in memory for the session
   — a draft is not a version, and only Save makes one. */
let scanDraft = null;
let scanEditDraft = null;
let scanIdAuto = true;
let scanFieldSeq = 0;
const scanBlankCondition = () => ({ type: 'condition', left: { indicator: 'price' }, op: 'CROSSES_ABOVE', right: { indicator: 'ema', n: 50 } });
const scanBlankDraft = () => ({ id: '', name: '', description: '', enabled: true, universe: { kind: 'symbols', symbols: [] }, timeframe: '1D',
  confirmationMode: 'BAR_CLOSE', cooldownMode: 'NEW_MATCH', cooldownBars: 0, expires: null,
  ruleTree: { type: 'group', logic: 'ALL', children: [scanBlankCondition()] } });
/* Any setup — 0.2, V2, a stored version — as a draft the builder edits. */
function scanAsDraft(x) {
  const s = scanNormaliseSetup({ ...x, id: x?.id || '' });
  return { id: x?.id || '', name: x?.name || '', description: x?.description || '', enabled: x?.enabled !== false,
    universe: scanClone(s.universe), timeframe: s.timeframe, confirmationMode: 'BAR_CLOSE', cooldownMode: s.cooldownMode,
    cooldownBars: s.cooldownBars, expires: s.expires ?? null, ruleTree: scanClone(s.ruleTree) };
}
/* The draft as the worker will read it. A watchlist universe is expanded
   here, when the setup is saved or copied, into the symbols the list holds:
   the worker cannot read this browser. A list no longer here keeps the
   snapshot the setup already carries. */
function scanDraftSetup(d) {
  const out = scanClone(d);
  if (!out.description) delete out.description;
  if (out.cooldownBars == null) delete out.cooldownBars;
  if (d.universe?.kind === 'watchlist' && wlById(d.universe.watchlistId)) {
    const snap = watchlistSymbols(d.universe.watchlistId);
    /* The snapshot is taken either way: resolved by export, it is what
       the worker falls back to when the export does not hold the list. */
    out.universe = { kind: 'watchlist', watchlistId: d.universe.watchlistId, ...(scanResolvesByExport(d.universe) ? { resolve: 'export' } : {}),
      name: snap.name, symbols: snap.symbols, asOf: snap.asOf, ...(snap.unresolved.length ? { unresolved: snap.unresolved } : {}) };
  }
  return out;
}
/* Every problem with the draft, each at its path. The body is validated
   under a stand-in id while the id itself is blank or refused, so the
   reader sees every reason at once rather than one per keystroke. */
function scanDraftCheck(d, { mode = 'new', st = scanStoreRead() } = {}) {
  const setup = scanDraftSetup(d);
  const idProblems = [];
  let idOk = false;
  if (!d.id) idProblems.push({ path: 'id', code: 'NO_ID', text: 'needs an id — ids are part of every alert key and of the setup’s address' });
  else {
    const v = scanValidate({ setups: [setup] });
    const ip = (v.problemsBySetup[d.id] || []).filter(p => p.path === 'id');
    idProblems.push(...ip);
    idOk = !ip.length;
  }
  if (mode === 'new' && d.id && st.setups[d.id]) {
    idOk = false;
    idProblems.push({ path: 'id', code: 'DUPLICATE_ID', text: st.setups[d.id].deleted
      ? 'is the id of a deleted setup — restore that one from the setups page, or choose another id'
      : 'is already the id of a setup saved here — ids are part of every alert key, so each is used once' });
  }
  const probeId = idOk ? d.id : 'draft';
  const probe = scanValidate({ setups: [{ ...setup, id: probeId }] });
  /* The engine's reason for a watchlist with no snapshot speaks to a reader
     of the file; here the snapshot is taken on save, so the reason is the
     list's. */
  const body = (probe.problemsBySetup[probeId] || []).filter(p => p.path !== 'id').map(p => (p.code === 'BAD_UNIVERSE' && d.universe?.kind === 'watchlist' && !(setup.universe?.symbols || []).length
    ? { ...p, text: d.universe.watchlistId ? 'the watchlist holds no member with a symbol yet, so there is nothing to scan' : 'choose a watchlist' } : p));
  const problems = [...idProblems, ...body];
  return { setup, problems, ready: !problems.length, normalised: probe.setups[0] || null };
}

/* Operand choices, from the engine's metadata. A field-bearing indicator is
   one choice per field, because the field decides the unit. */
const SCAN_FIELD_LABEL = { line: 'line', signal: 'signal line', hist: 'histogram', upper: 'upper band', middle: 'middle band', lower: 'lower band', width: 'band width', pctb: '%b' };
const SCAN_PICK_LABEL = { price: 'Price (close)', volume: 'Volume', sma: 'SMA — simple average', ema: 'EMA — exponential average', rsi: 'RSI (Wilder)',
  macd: 'MACD', volume_avg: 'Average volume', bb: 'Bollinger', atr: 'ATR (Wilder)', high_n: 'Highest high over n bars', low_n: 'Lowest low over n bars',
  close_high_n: 'Highest close over n bars', close_low_n: 'Lowest close over n bars', change: 'Change % over n bars', rvol: 'Relative volume' };
const SCAN_PARAM_LABEL = { n: 'period (bars)', fast: 'fast period', slow: 'slow period', signal: 'signal period', k: 'band width (σ)',
  /* The owner's TradingView indicators (the Pine section of the engine). Named
     here as their scripts' inputs name them; the builder showed the raw keys
     ("Left obSwitch") before. */
  channel: 'channel length', average: 'average length', reaction: 'direction reaction (bars)',
  overbought: 'overbought level', oversold: 'oversold level',
  obSwitch: 'sell signals only when overbought', osSwitch: 'buy signals only when oversold',
  maLen: 'average length', maType: 'average type', maLen2: 'second average length', maType2: 'second average type',
  bankerBase: 'banker RSI base', bankerPeriod: 'banker RSI period', bankerSens: 'banker sensitivity',
  hotBase: 'hot money RSI base', hotPeriod: 'hot money RSI period', hotSens: 'hot money sensitivity',
  type: 'average type', start: 'start', inc: 'increment', max: 'maximum',
  length: 'length', trigger: 'trigger smoothing', atrLen: 'ATR length', mult: 'range multiplier',
  double: 'double filter', range: 'range style', threshold: 'entry threshold', bbMult: 'band width (σ)' };
/* Where one key means different things in two indicators, the indicator's
   own name wins: WaveTrend's maLen is its extra TEMA, MCDX's the length of
   its Banker_MA; Color MA's one series is its line. */
const SCAN_PARAM_LABEL_BY = {
  wavetrend: { channel: 'WT channel length', average: 'WT average length', maLen: 'TEMA length' },
  mcdx: { maLen: 'Banker_MA length', maType: 'Banker_MA type', maLen2: 'HotMoney_MA length', maType2: 'HotMoney_MA type' },
  tv_rsi: { maLen: 'RSI-based MA length', maType: 'RSI-based MA type' },
  sr_ma: { length: 'smoothing length' },
};
const SCAN_FIELD_LABEL_BY = { color_ma: { ma: 'line' } };
const scanParamLabelOf = (id, k) => SCAN_PARAM_LABEL_BY[id]?.[k] || SCAN_PARAM_LABEL[k] || k;
/* A field's label: the builder's own names first, then the indicator's
   (a Pine indicator names every plotted series, some from its parameters —
   "TEMA200 of WT1" — read here at their defaults). */
const scanFieldLabelOf = (def, f) => {
  if (SCAN_FIELD_LABEL[f] && !def.fieldLabels) return SCAN_FIELD_LABEL[f];
  const own = Object.entries(SCAN_INDICATORS).find(([, d]) => d === def)?.[0];
  if (own && SCAN_FIELD_LABEL_BY[own]?.[f]) return SCAN_FIELD_LABEL_BY[own][f];
  const l = def.fieldLabels?.[f];
  if (typeof l === 'function') {
    const p = Object.fromEntries(Object.entries(def.params || {}).map(([k, q]) => [k, q.def]));
    try { return l(p); } catch { return f; }
  }
  return l || SCAN_FIELD_LABEL[f] || f;
};
function scanOperandOptions() {
  const out = [];
  Object.entries(SCAN_INDICATORS).forEach(([id, def]) => {
    const base = SCAN_PICK_LABEL[id] || def.label;
    if (def.fields) Object.entries(def.fields).forEach(([f, u]) => out.push({ key: `${id}.${f}`, id, field: f, unit: u, label: `${base} ${scanFieldLabelOf(def, f)}` }));
    else out.push({ key: id, id, field: null, unit: def.unit, label: base });
  });
  return out;
}
const scanOperandKey = (o) => (o?.indicator == null ? 'value' : SCAN_INDICATORS[o.indicator]?.fields ? `${o.indicator}.${scanFieldOf(o)}` : o.indicator);
function scanOperandFromKey(key) {
  const [id, f] = String(key).split('.');
  const def = SCAN_INDICATORS[id];
  const o = { indicator: id };
  if (f) o.field = f;
  if (def?.params?.n) o.n = def.params.n.def;
  return o;
}
/* The right-hand choices a left unit allows: the indicators measured in the
   same unit, and none for EQUALS where exact equality of the unit is noise. */
function scanCompatibleOptions(unit, op) {
  if (op === 'EQUALS' && !SCAN_OPERATORS.EQUALS.equatableUnits.includes(unit)) return [];
  return scanOperandOptions().filter(o => o.unit === unit);
}
/* After the left side or the operator changes, a right side that no longer
   fits becomes a blank fixed value — refused until a number is typed —
   rather than a combination the engine would refuse. */
function scanFitCondition(c) {
  const unit = scanUnitOf(c.left);
  const fits = (o) => o?.indicator == null || scanCompatibleOptions(unit, scanOpName(c.op)).some(x => x.key === scanOperandKey(o));
  if (c.right && !fits(c.right)) c.right = { value: null };
  if (Array.isArray(c.range)) c.range = c.range.map(b => (b && typeof b === 'object' && fits(b) ? b : { value: null }));
}
/* "Copy example configuration": the committed rule-tree example as a
   one-setup file, disabled so that pasting it runs nothing until the
   reader means it to. Taken from SCAN_EXAMPLES (scanner/setups.example.json
   in the engine region), so the copy and the file cannot say different
   things, as this constant's own hand-written example once did. */
const SCAN_EXAMPLE_DOC = {
  kind: 'quantum-tradeworks-scan-setups', schema: 2,
  _note: 'An illustration of the file’s syntax, not a suggestion: the product proposes no setup, and no condition here is claimed to mean anything. It is disabled so that pasting it runs nothing. Groups may nest (ALL / ANY) up to three deep; operands are an indicator or { "value": n }. The whole example file is scanner/setups.example.json.',
  setups: SCAN_EXAMPLES.setups.filter(s => s.ruleTree != null).map(s => ({ ...scanClone(s), enabled: false })),
};

/* THE BUILDER'S DOORS (round 3 contract C5). The address can start a
   draft: ?from=<setup> copies a setup's evaluation fields under a new id
   and "Copy of …"; ?fromAlert=<alert> does the same from the setup snapshot
   the alert recorded; ?market= makes the universe that market's
   instruments in the history; ?symbol= names one instrument, as the company
   page's link always has. They combine — a copy, on another market. A link
   starts a draft once: coming back to the same address keeps what was typed
   since. A link to a different start while a changed draft is open asks,
   rather than dropping the draft; an untouched draft is simply replaced.
   The seed remembers which draft it made, which address it came from, the
   draft as it was seeded (to tell untouched from changed) and what the page
   should say about where it came from. A draft set some other way — the
   watchlist pages' "New setup on this list" — is not the seed's, so the
   seed's words are not shown over it, and it counts as changed unless it
   is blank. */
let scanDraftSeed = null;
const SCAN_SEED_PARAMS = ['from', 'fromAlert', 'key', 'market', 'symbol'];
const scanSeedSig = (qs = new URLSearchParams(location.search)) => SCAN_SEED_PARAMS.filter(k => qs.get(k)).map(k => `${k}=${qs.get(k)}`).join('&');
const scanSeedOwns = () => !!scanDraft && scanDraftSeed?.draft === scanDraft;
const scanDraftUntouched = () => !!scanDraft && JSON.stringify(scanDraft) === (scanSeedOwns() ? scanDraftSeed.json : JSON.stringify(scanBlankDraft()));
function scanSetDraft(d, sig, notes = []) {
  scanDraft = d;
  scanIdAuto = !d.id;
  scanDraftSeed = { draft: d, sig, json: JSON.stringify(d), notes };
}
/* A setup by id: this browser's current version, else the worker's file
   (validated as the worker validates it), else a deleted one kept here. */
function scanFindSetup(id) {
  const rec = scanStoreRead().setups[id];
  if (rec && !rec.deleted) return { setup: scanRecordSetup(rec), where: `saved here, v${rec.current}` };
  const f = scanSetupsFile ? scanValidate(scanSetupsFile).setups.find(s => s.id === id) : null;
  if (f) return { setup: f, where: `in the worker’s file, v${f.version}` };
  if (rec) return { setup: scanRecordSetup(rec), where: `deleted here, v${rec.current}` };
  return null;
}
/* An id for a copy that no setup saved here uses. */
function scanCopyId(id, st = scanStoreRead()) {
  const base = `${String(id || 'setup').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'setup'}-copy`;
  let out = base, n = 2;
  while (st.setups[out]) out = `${base}-${n++}`;
  return out;
}
/* The record an address names: by id, and by key where two records share
   the id (the key rides along only then). */
function scanFindAlert(id, key = null, list = scanAlertList()) {
  const byId = list.filter(x => scanAlertIdOf(x) === id);
  return (key ? byId.find(x => x.key === key) : null) || byId[0] || list.find(x => x.key === id) || null;
}
/* The setup a record names, as the engine reads a setup: the snapshot the
   record carries, or — for a record that predates snapshots — the version
   this browser holds under that number. */
function scanAlertSetup(a) {
  if (!a) return null;
  if (a.setupSnapshot) return { setup: scanNormaliseSetup({ ...a.setupSnapshot, id: a.setupId }), from: 'snapshot' };
  const rec = scanStoreRead().setups[a.setupId];
  const s = rec ? scanRecordSetup(rec, a.setupVersion ?? 1) : null;
  return s ? { setup: s, from: 'browser' } : null;
}
function scanSeedDraft(qs) {
  const notes = [];
  let d = null;
  const from = qs.get('from'), fromAlert = qs.get('fromAlert');
  const copyOf = (s, name, whence) => {
    const x = scanAsDraft(s);
    Object.assign(x, { id: scanCopyId(s.id), name: `Copy of ${name || s.name || s.id}`, description: '', enabled: true });
    notes.push(whence);
    return x;
  };
  if (fromAlert) {
    const a = scanFindAlert(fromAlert, qs.get('key'));
    const src = scanAlertSetup(a);
    if (src) d = copyOf(src.setup, a.setupName, `Started from the setup that recorded ${a.symbol} on ${scanAlertBar(a)}: ${a.setupName || a.setupId} v${a.setupVersion ?? 1}, ${src.from === 'snapshot' ? 'as the record’s own copy of it holds it' : 'as this browser holds that version (the record predates engine 0.3.0 and carries no copy)'}. A copy under its own id; the setup and the record are unchanged.`);
    else notes.push(!a ? `No alert “${fromAlert}” is in ${scanAlertsFile ? 'data/scan-alerts.json' : 'a loaded alerts file — data/scan-alerts.json cannot be seen from here'}, so the draft starts blank.`
      : `The record of ${a.symbol} on ${scanAlertBar(a)} predates engine 0.3.0 and carries no copy of its setup, and this browser does not hold v${a.setupVersion ?? 1} of ${a.setupId}, so the draft starts blank.`);
  } else if (from) {
    const f = scanFindSetup(from);
    if (f) d = copyOf(f.setup, f.setup.name, `Started from ${f.setup.name || f.setup.id} (${f.where}): its conditions, universe, timeframe and recording, under a new id. The original is unchanged.`);
    /* The company page's link names the company it was opened from as
       ?from= beside ?symbol=. That is where the reader came from, not a
       setup to copy, so it is not reported as missing. */
    else if (!(typeof BY_ID !== 'undefined' && BY_ID.has(from))) notes.push(`No setup “${from}” is saved here${scanSetupsFile ? ' or in the worker’s file' : ''}, so the draft starts blank.`);
  }
  d = d || scanBlankDraft();
  const market = String(qs.get('market') || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const symbol = String(qs.get('symbol') || '').trim().toUpperCase().replace(/[^A-Z0-9.^=:-]/g, '');
  if (market) {
    d.universe = { kind: 'market', market };
    if (from || fromAlert || symbol) notes.push(`Its universe is the ${market} instruments in your history, as the link asked${symbol ? ` (the link’s ${symbol} is set aside: a universe is a market or a list, not both)` : ''}.`);
  } else if (symbol) d.universe = { kind: 'symbols', symbols: [symbol] };
  return { d, notes };
}
const scanTreeIsFlat = (t) => t?.type === 'group' && Array.isArray(t.children) && t.children.every(c => c?.type !== 'group');

function scanBuilderView(mode) {
  const wrap = scanPage();
  wrap.append(scanSubnav('setups'));
  const st = scanStoreRead();
  let rec = null, d, ask = null;
  if (mode === 'edit') {
    const id = scanParam('setup');
    rec = st.setups[id] || null;
    if (!rec || rec.deleted) {
      wrap.append(scanNotInRecord(`No setup “${id}” to edit`, rec?.deleted
        ? 'That setup is deleted. Restore it from the setups page to edit it.'
        : 'This browser holds no setup with that id. A setup only in the worker’s file is adopted first, from the setups page; then it can be edited here.', ['/app/scanner/setups', 'Your setups']));
      return wrap;
    }
    if (!scanEditDraft || scanEditDraft.id !== id || scanEditDraft.base !== rec.current) scanEditDraft = { id, base: rec.current, d: scanAsDraft(scanRecordSetup(rec)) };
    d = scanEditDraft.d;
  } else {
    /* The address's doors (see scanSeedDraft). A fresh draft takes the
       link; a returning one keeps what was typed; a different link over a
       changed draft asks below. */
    const qs = new URLSearchParams(location.search);
    const sig = scanSeedSig(qs);
    if (!scanDraft) { const s = sig ? scanSeedDraft(qs) : { d: scanBlankDraft(), notes: [] }; scanSetDraft(s.d, sig, s.notes); }
    else if (!scanDraft.ruleTree) scanDraft = scanAsDraft(scanDraft);
    else if (sig && !(scanSeedOwns() && scanDraftSeed.sig === sig)) {
      if (scanDraftUntouched()) { const s = scanSeedDraft(qs); scanSetDraft(s.d, sig, s.notes); }
      else ask = sig;
    }
    d = scanDraft;
  }
  wrap.append(mode === 'edit'
    ? scanPageHead(`Edit ${rec.name || rec.id}`, `Currently v${rec.current}. A change to what it evaluates saves as v${Math.max(...rec.versions.map(v => v.version)) + 1} and keeps every earlier version; a change to the name, description or enabled flag does not.`, 'Scanner setup · edit')
    : scanPageHead('New setup', 'Conditions you choose, evaluated on your own history. Test it here, then save it as version 1; the setups page exports it to the file the worker reads.', 'Scanner setup · new'));
  if (ask) {
    const p = el('div', { class: 'card scan-seed-ask', role: 'region', 'aria-label': 'A draft is already open' });
    p.append(cardHead('A draft is already open', 'This address starts a new draft, and the one open here has changes. Nothing is replaced until you choose.'));
    p.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => { const s = scanSeedDraft(new URLSearchParams(location.search)); scanSetDraft(s.d, ask, s.notes); scanRender({ fallback: 'Name' }); } }, 'Start from this link'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { scanDraftSeed = { draft: scanDraft, sig: ask, json: scanSeedOwns() ? scanDraftSeed.json : null, notes: [] }; scanRender({ fallback: 'Name' }); } }, 'Keep my draft'),
    ]));
    wrap.append(p);
  } else if (mode === 'new' && scanSeedOwns() && scanDraftSeed.notes?.length && scanDraftSeed.sig === scanSeedSig()) {
    wrap.append(el('div', { class: 'scan-note scan-seed-notes', role: 'status', style: 'display:flex;flex-direction:column;gap:4px' }, scanDraftSeed.notes.map(t => el('p', { class: 'caption', style: 'margin:0' }, t))));
  }
  if (mode === 'new') wrap.append(scanExamplePicker());
  wrap.append(scanBuilder(d, { mode, rec }));
  return wrap;
}
/* START FROM AN EXAMPLE (SC-305). The committed examples, from
   SCAN_EXAMPLES, loaded into the draft as they are written — ids, names,
   universes and conditions — for the reader to replace. Offering them is
   the one place the product puts conditions in front of the reader, so it
   says what they are: illustrations of the file's syntax, not suggestions,
   and none claimed to mean anything. A changed draft is not replaced
   without asking. */
function scanExamplePicker() {
  const card = el('div', { class: 'card scan-examples' });
  const id = `scanf-${++scanFieldSeq}`;
  const s = el('select', { class: 'select', id, 'aria-label': 'Start from an example', onchange: (e) => {
    const ex = SCAN_EXAMPLES.setups.find(x => x.id === e.target.value);
    if (!ex) return;
    if (!scanDraftUntouched() && !confirm('Replace the draft with this example? What is in the draft now is not kept.')) { e.target.value = ''; return; }
    const d = scanAsDraft(ex);
    if (scanStoreRead().setups[d.id]) d.id = scanCopyId(d.id);
    scanSetDraft(d, scanSeedSig(), [`Started from the example “${ex.name}” (scanner/setups.example.json) — an illustration of the syntax, not a suggestion. Its id, name, universe and every condition are yours to replace.`]);
    render();
    document.querySelector('main [aria-label="Start from an example"]')?.focus();
  } });
  s.append(el('option', { value: '' }, 'Choose an example…'));
  SCAN_EXAMPLES.setups.forEach(x => s.append(el('option', { value: x.id }, `${x.name} — ${x.ruleTree != null ? 'rule tree (0.3 form)' : 'rules (0.2 form)'}${x.enabled === false ? ', disabled' : ''}`)));
  card.append(el('div', { class: 'row row-wrap', style: 'gap:var(--sm) var(--md);align-items:flex-end' }, [
    el('div', { class: 'field', style: 'flex:1 1 260px;min-width:0;margin:0' }, [el('label', { for: id }, 'Start from an example'), s]),
    el('p', { class: 'caption', style: 'flex:2 1 320px;margin:0;max-width:62ch' }, `The ${SCAN_EXAMPLES.setups.length} examples in scanner/setups.example.json, loaded into the draft as written. An illustration of the syntax, not a suggestion: the product proposes no setup, and no condition in them is claimed to mean anything.`),
  ]));
  return card;
}
VIEWS.scannerSetupNew = () => scanBuilderView('new');
VIEWS.scannerSetupEdit = () => scanBuilderView('edit');

const SCAN_FOCUSABLE = 'input[aria-label],select[aria-label],button[aria-label],textarea[aria-label]';
function scanBuilder(d, ctx) {
  const { mode, rec } = ctx;
  const root = el('div', { class: 'scan-builder' });
  const history = scanHistoryFile;
  const haveHistory = !!(history?.series && Object.keys(history.series).length);
  const registry = scanRegistryList();
  /* Rebuild after a structural change, and put focus back on the control
     that made it — or on the one named, after an add or a remove. */
  const rebuild = (focusLabel = null) => {
    let key = null;
    const a = document.activeElement;
    if (focusLabel) key = { lab: focusLabel, i: 0 };
    else if (a && root.contains(a) && a.getAttribute('aria-label')) {
      const lab = a.getAttribute('aria-label');
      key = { lab, i: [...root.querySelectorAll(SCAN_FOCUSABLE)].filter(n => n.getAttribute('aria-label') === lab).indexOf(a) };
    }
    const next = scanBuilder(d, ctx);
    root.replaceWith(next);
    if (key) [...next.querySelectorAll(SCAN_FOCUSABLE)].filter(n => n.getAttribute('aria-label') === key.lab)[Math.max(0, key.i)]?.focus();
  };
  const hosts = new Map();
  const problemHost = (path) => { const h = el('ul', { class: 'scan-problems', hidden: '' }); hosts.set(path, h); return h; };
  const field = (label, input, { hint = null, path = null, wide = false } = {}) => {
    const f = el('div', { class: `field${wide ? ' scan-wide' : ''}` });
    const id = `scanf-${++scanFieldSeq}`;
    input.id = id;
    f.append(el('label', { for: id }, label));
    if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', label);
    f.append(input);
    if (hint) f.append(el('p', { class: 'caption' }, hint));
    if (path) f.append(problemHost(path));
    return f;
  };
  const text = (val, on, attrs = {}) => el('input', { class: 'input', value: val ?? '', ...attrs, oninput: e => { on(e.target.value); refresh(); } });
  const numOrAbsent = (v) => (String(v).trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const select = (val, opts, on, attrs = {}) => {
    const s = el('select', { class: 'select', ...attrs, onchange: e => { on(e.target.value); rebuild(); } });
    opts.forEach(o => {
      if (o.group) { const g = el('optgroup', { label: o.group }); o.items.forEach(([v, l, dis]) => g.append(el('option', { value: v, selected: String(val) === String(v) ? '' : null, disabled: dis ? '' : null }, l))); s.append(g); }
      else { const [v, l, dis] = o; s.append(el('option', { value: v, selected: String(val) === String(v) ? '' : null, disabled: dis ? '' : null }, l)); }
    });
    return s;
  };
  const radios = (name, val, opts, on, legend) => {
    const fs = el('fieldset', { class: 'scan-radios' });
    fs.append(el('legend', {}, legend));
    opts.forEach(([v, l, sub]) => {
      const lab = el('label', { class: 'checkline scan-radio' });
      lab.append(el('input', { type: 'radio', name, value: v, checked: val === v ? '' : null, 'aria-label': `${legend}: ${l}`, onchange: e => { if (e.target.checked) { on(v); refresh(); } } }));
      lab.append(el('span', {}, [el('span', { class: 'scan-radio-l' }, l), sub ? el('span', { class: 'caption', style: 'display:block' }, sub) : null]));
      fs.append(lab);
    });
    return fs;
  };

  /* ---- the setup ---- */
  const c1 = el('div', { class: 'card' });
  c1.append(cardHead('The setup', mode === 'edit' ? 'The id is locked: it is part of every alert key and of this setup’s address.' : 'The id is part of every alert key and of the setup’s address, so it is fixed once saved.'));
  const g1 = el('div', { class: 'grid g-2 scan-grid' });
  const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  /* What is typed is made an id as it is typed, and the field is set to
     that id once it is left. It kept what was typed — "My Setup" in the
     field, saved as my-setup, with no problem shown — so the id on screen
     was not the id saved. Not rewritten under the cursor. */
  const idInput = text(d.id, v => { d.id = v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40); scanIdAuto = !d.id; }, mode === 'edit' ? { readonly: '', 'aria-readonly': 'true' }
    : { onchange: (e) => { if (e.target.value !== d.id) e.target.value = d.id; } });
  g1.append(field('Name', text(d.name, v => { d.name = v; if (mode === 'new' && scanIdAuto) { d.id = slug(v); idInput.value = d.id; } }, { autocomplete: 'off' })));
  g1.append(field('Id', idInput, { hint: mode === 'edit' ? null : `Letters, digits and hyphens.${scanIdAuto ? ' Filled from the name until you type one.' : ''}`, path: 'id' }));
  g1.append(field('Description (optional)', text(d.description, v => { d.description = v; }, { autocomplete: 'off' }), { wide: true }));
  c1.append(g1);
  const en = el('label', { class: 'checkline', style: 'margin-top:var(--sm);gap:8px' });
  en.append(el('input', { type: 'checkbox', checked: d.enabled ? '' : null, 'aria-label': 'Enabled', onchange: e => { d.enabled = e.target.checked; refresh(); } }));
  en.append(el('span', {}, ['Enabled ', el('span', { class: 'caption' }, '— the worker evaluates it. Not versioned: turning it off keeps the version.')]));
  c1.append(en);
  root.append(c1);

  /* ---- what it scans ---- */
  const c2 = el('div', { class: 'card' });
  c2.append(cardHead('What it scans', 'Only instruments your own price history holds a series for. No exchange-wide list is licensed to this product.'));
  const g2 = el('div', { class: 'grid g-2 scan-grid' });
  const u = d.universe || (d.universe = { kind: 'all' });
  g2.append(field('Universe', select(u.kind, [['watchlist', 'One of your watchlists'], ['market', 'A market — its instruments in your history'], ['symbols', 'Named instruments'], ['all', 'Everything with a series in your history']], v => {
    d.universe = v === 'market' ? { kind: 'market', market: u.market || 'US' }
      : v === 'symbols' ? { kind: 'symbols', symbols: u.symbols || [] }
      : v === 'watchlist' ? { kind: 'watchlist', watchlistId: u.watchlistId || State.watchlists?.[0]?.id || null }
      : { kind: 'all' }; }), { path: u.kind === 'all' ? 'universe' : null }));
  const uniNote = el('p', { class: 'metaline scan-wide' });
  if (u.kind === 'symbols') g2.append(field('Instruments (comma-separated symbols as they appear in your history)', text((u.symbols || []).join(', '), v => { u.symbols = v.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean); }, { autocomplete: 'off', spellcheck: 'false' }), { path: 'universe' }));
  if (u.kind === 'watchlist') {
    const lists = State.watchlists || [];
    /* With no list chosen — the universe picked while no list existed, and
       a list made since — the select showed the first list as chosen while
       the draft held none: "choose a watchlist", and choosing the only list
       fired no change, so nothing could be chosen. The select says nothing
       is chosen until something is. */
    if (lists.length) g2.append(field('Watchlist', select(u.watchlistId || '', [...(u.watchlistId ? [] : [['', 'Choose a watchlist…']]), ...(wlById(u.watchlistId) || !u.watchlistId ? [] : [[u.watchlistId, `${u.name || u.watchlistId} — not in this browser`]]), ...lists.map(w => [w.id, `${w.name} (${(w.ids || []).length})`])], v => { u.watchlistId = v || null; }), { path: 'universe' }));
    else g2.append(el('div', { class: 'scan-wide' }, [el('p', { class: 'caption' }, ['You have no watchlist yet. ', scanLink('/my/watchlists', 'Make one'), ', or name the instruments instead.']), problemHost('universe')]));
    /* How the worker resolves the list (C3). Either way the setup carries a
       snapshot; by export, the worker reads data/watchlists.json at run
       time and falls back to the snapshot when the list is not in it. The
       worker cannot read this browser, so "at run time" means as of the
       reader's last export, and the choice says so. */
    const rs = el('div', { class: 'scan-wide' });
    rs.append(radios(`scan-resolve-${scanFieldSeq}`, scanResolvesByExport(u) ? 'export' : 'snapshot', [
      ['snapshot', 'The list as you save it', 'the setup carries the list’s symbols from the moment you save; saving again takes the list as it is then'],
      ['export', 'Your latest export for the scanner', 'resolved from your latest export — the worker cannot read this browser, so it reads data/watchlists.json at each run, and the snapshot stands in when that file does not hold the list']],
      v => { if (v === 'export') u.resolve = 'export'; else delete u.resolve; }, 'Resolve the list from'));
    if (u.watchlistId && wlById(u.watchlistId)) {
      const ex = scanWatchlistExportState(u.watchlistId);
      rs.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center;margin-top:6px' }, [
        el('p', { class: 'caption scan-export-state', style: 'margin:0;flex:1 1 280px;max-width:72ch' }, ex.text),
        el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': 'Export for the scanner (watchlists.json)', onclick: () => { scanExportWatchlists(); toast('Exported — save it as data/watchlists.json on the machine the worker runs on'); rebuild('Export for the scanner (watchlists.json)'); } }, 'Export for the scanner'),
      ]));
    }
    g2.append(rs);
  }
  /* The markets the registry the worker reads actually holds, in its own
     order. */
  if (u.kind === 'market') {
    const mkts = [...new Set(registry.map(i => String(i.market || '').toUpperCase()).filter(Boolean))];
    if (!mkts.includes(String(u.market))) mkts.unshift(String(u.market));
    g2.append(field('Market', select(u.market, mkts.map(m => [m, m === 'MY' ? 'MY — Bursa Malaysia' : m === 'US' ? 'US — United States' : m]), v => { u.market = v; }),
      { hint: 'Membership is read from data/instruments.json, the file the worker reads. A series with no row there has no market and is listed as skipped when you test.', path: 'universe' }));
  }
  const tfOpts = Object.values(SCAN_TIMEFRAMES).map(t => [t.id, t.built ? `${t.label}${t.derivedFrom ? ' — derived from your daily bars' : ''}` : `${t.label} — not available`, !t.built]);
  const notBuilt = Object.values(SCAN_TIMEFRAMES).filter(t => !t.built);
  g2.append(field('Timeframe', select(d.timeframe, tfOpts, v => { d.timeframe = v; }), {
    hint: `${SCAN_TIMEFRAMES[d.timeframe]?.note ? `${SCAN_TIMEFRAMES[d.timeframe].note[0].toUpperCase()}${SCAN_TIMEFRAMES[d.timeframe].note.slice(1)}. ` : ''}${notBuilt.length ? `${notBuilt.map(t => t.label).join(', ')}: not available — ${notBuilt[0].reason}.` : ''}`, path: 'timeframe' }));
  g2.append(uniNote);
  c2.append(g2);
  root.append(c2);

  /* ---- the conditions ---- */
  const c3 = el('div', { class: 'card' });
  const tree = d.ruleTree || (d.ruleTree = { type: 'group', logic: 'ALL', children: [scanBlankCondition()] });
  const flat = scanTreeIsFlat(tree);
  c3.append(cardHead('Conditions', flat
    ? `Each compares an indicator with another measured in the same unit, or with a fixed value in its range. Up to ${SCAN_LIMITS.maxConditions}.`
    : 'This setup’s conditions nest groups inside groups, which the file allows and this builder does not edit. They are shown as written; the rest of the setup can be edited and saved around them.'));
  const proseSpans = [];
  if (!flat) {
    c3.append(el('div', { class: 'panel' }, [el('p', { class: 'metaline', style: 'font-weight:600' }, `${tree.logic === 'ANY' ? 'Any' : 'All'} of:`), scanTreeList(tree, d.timeframe)]));
    c3.append(problemHost('rules'));
    c3.append(el('button', { class: 'btn btn-quiet btn-sm', style: 'margin-top:var(--sm)', 'aria-label': 'Replace the nested conditions with one group', onclick: () => {
      if (!confirm('Replace these conditions with one editable group? The nested tree is dropped from the draft; the saved versions keep it.')) return;
      d.ruleTree = { type: 'group', logic: tree.logic === 'ANY' ? 'ANY' : 'ALL', children: [scanBlankCondition()] };
      rebuild('Condition 1: left side');
    } }, 'Replace with one editable group'));
  } else {
    c3.append(radios(`scan-logic-${scanFieldSeq}`, tree.logic === 'ANY' ? 'ANY' : 'ALL', [['ALL', 'Match ALL', 'every condition holds on the bar'], ['ANY', 'Match ANY', 'at least one condition holds on the bar']], v => { tree.logic = v; }, 'Match'));
    c3.append(problemHost('rules'));
    const options = scanOperandOptions();
    const byUnit = Object.keys(SCAN_UNITS).map(unit => ({ group: SCAN_UNITS[unit].label, items: options.filter(o => o.unit === unit).map(o => [o.key, o.label]) })).filter(g => g.items.length);
    const OPS = Object.entries(SCAN_OPERATORS).map(([k, v]) => [k, `${v.label} (${v.symbol})`]);
    tree.children.forEach((c, i) => {
      const L = `Condition ${i + 1}`;
      const unit = scanUnitOf(c.left);
      const U = SCAN_UNITS[unit];
      const row = el('div', { class: 'panel scan-cond' });
      const prose = el('span', { class: 'scan-prose' }, scanCondSentence(c, d.timeframe));
      proseSpans.push([prose, c]);
      row.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:baseline' }, [
        el('span', { class: 'eyebrow' }, L), prose, el('span', { class: 'spacer' }),
        el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Remove condition ${i + 1}`, onclick: () => {
          tree.children.splice(i, 1);
          if (!tree.children.length) tree.children.push(scanBlankCondition());
          rebuild(tree.children[i] ? `Remove condition ${i + 1}` : 'Add a condition');
        } }, 'Remove'),
      ]));
      const grid = el('div', { class: 'grid g-4 scan-grid' });
      /* Parameters with their bounds: a blank is the default, shown as the
         placeholder; outside the bounds is refused at this condition. */
      const params = (o, side) => Object.entries(SCAN_INDICATORS[o.indicator]?.params || {}).forEach(([k, p]) => {
        /* A parameter with named options (on/off, an average type, a range
           style) is a choice: a select of its names, the default first as
           "default", rather than a number box that showed 0 and 1. */
        if (p.options) {
          const opts = [['', `default (${p.options[p.def] ?? p.def})`], ...Object.entries(p.options).map(([v, name]) => [v, name])];
          grid.append(field(`${side} ${scanParamLabelOf(o.indicator, k)}`, select(o[k] ?? '', opts, v => { if (v === '') delete o[k]; else o[k] = Number(v); },
            { 'aria-label': `${L}: ${side.toLowerCase()} ${scanParamLabelOf(o.indicator, k)}` })));
          return;
        }
        grid.append(field(`${side} ${scanParamLabelOf(o.indicator, k)}`, text(o[k], v => { const n = numOrAbsent(v); if (n === undefined) delete o[k]; else o[k] = n; },
          { type: 'number', inputmode: p.integer ? 'numeric' : 'decimal', min: String(p.min), max: String(p.max), step: p.integer ? '1' : 'any', placeholder: String(p.def), 'aria-label': `${L}: ${side.toLowerCase()} ${scanParamLabelOf(o.indicator, k)}` }),
          { hint: `${p.min}–${p.max}${p.integer ? ', whole' : ''}; blank is ${p.def}` }));
      });
      /* The timeframe the condition reads (B1): the setup's own, or one
         above it — that timeframe's last closed bar, built from the same
         daily bars. One not above the setup's is refused by the engine,
         with the reason, and shows here as that rather than as a choice. */
      const ownTf = scanTimeframe(d.timeframe), hiTfs = scanHigherTfs(ownTf), ctf = scanCondTf(c);
      const tfSet = ctf && ctf !== ownTf ? ctf : '';
      if (hiTfs.length || tfSet) {
        const items = [['', `The setup’s timeframe (${scanTfWord(ownTf)})`], ...hiTfs.map(t => [t, `${SCAN_TIMEFRAMES[t].label} — the last closed ${scanTfPeriod(t)}`])];
        if (tfSet && !hiTfs.includes(tfSet)) items.push([tfSet, `${SCAN_TIMEFRAMES[tfSet]?.label || tfSet} — not above the setup’s ${scanTfWord(ownTf)}, so refused`, true]);
        grid.append(field('Timeframe', select(tfSet, items, v => { if (v) c.timeframe = v; else delete c.timeframe; }, { 'aria-label': `${L}: timeframe` }),
          { hint: tfSet && hiTfs.includes(tfSet) ? `On each ${scanTfWord(ownTf)} bar, the ${scanTfPeriod(tfSet)} that had closed by then — never the one in progress.` : null }));
      }
      /* A yes-or-no reading (unit 'flag') is asked whether it holds: chosen
         as a left side, the condition becomes "is true" — equals 1 — rather
         than keep an operator and a right side that meant a number. */
      grid.append(field('Left side', select(scanOperandKey(c.left), byUnit, v => {
        const was = scanUnitOf(c.left);
        c.left = scanOperandFromKey(v);
        scanFitCondition(c);
        if (scanUnitOf(c.left) === 'flag' && was !== 'flag') { c.op = 'EQUALS'; delete c.range; c.right = { value: 1 }; }
      }, { 'aria-label': `${L}: left side` })));
      params(c.left, 'Left');
      grid.append(field('Operator', select(scanOpName(c.op) || c.op, OPS, v => {
        const was = scanOpName(c.op);
        c.op = v;
        if (v === 'BETWEEN' && was !== 'BETWEEN') { delete c.right; c.range = [{ value: null }, { value: null }]; }
        if (v !== 'BETWEEN' && was === 'BETWEEN') { delete c.range; c.right = { value: null }; }
        scanFitCondition(c);
      }, { 'aria-label': `${L}: operator` })));
      /* A right side, or one bound of a range: a fixed value in the left
         side's domain, or an indicator in the left side's unit. */
      const operand = (o, set, side, { multiplier = false } = {}) => {
        const compat = scanCompatibleOptions(unit, scanOpName(c.op));
        const cur = scanOperandKey(o);
        const items = [['value', 'a fixed value'], ...compat.map(x => [x.key, x.label])];
        if (cur !== 'value' && !compat.some(x => x.key === cur)) items.push([cur, `${SCAN_PICK_LABEL[o.indicator] || o.indicator} — not comparable with ${U?.label || 'the left side'}`, true]);
        /* A yes-or-no reading equals true or false and nothing else: the
           right side is that choice, not a number box that took any number
           and refused all but two, nor a choice of "a fixed value" alone. */
        const yesNo = unit === 'flag' && o?.indicator == null;
        if (yesNo) {
          const v = scanNumeric(o?.value) ? String(Number(o.value)) : '';
          const opts = [...(v === '1' || v === '0' ? [] : [['', v === '' ? 'Choose true or false…' : `${o.value} — not true or false`, v === '']]), ['1', 'true (1)'], ['0', 'false (0)']];
          if (compat.length) grid.append(field(side, select(cur, items, v2 => { set(v2 === 'value' ? { value: 1 } : scanOperandFromKey(v2)); }, { 'aria-label': `${L}: ${side.toLowerCase()}` })));
          grid.append(field(compat.length ? `${side} value` : `${side} — true or false`, select(v, opts, v2 => { o.value = v2 === '' ? null : Number(v2); }, { 'aria-label': `${L}: ${side.toLowerCase()} value` }),
            { hint: 'True is 1, false is 0 — the only two values a yes-or-no reading takes.' }));
          return;
        }
        grid.append(field(side, select(cur, items, v => { set(v === 'value' ? { value: null } : scanOperandFromKey(v)); }, { 'aria-label': `${L}: ${side.toLowerCase()}` }),
          { hint: compat.length ? null : scanOpName(c.op) === 'EQUALS' ? `Exact equality of two ${U?.label || ''} readings is noise; compare with a fixed value.` : null }));
        if (o?.indicator != null) {
          params(o, side);
          if (multiplier) grid.append(field(`${side} multiplier`, text(o.multiplier, v => { const m = numOrAbsent(v); if (m !== undefined) o.multiplier = m; else delete o.multiplier; },
            { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: '1', 'aria-label': `${L}: ${side.toLowerCase()} multiplier` }), { hint: 'Blank is 1 — the indicator as it is.' }));
        } else {
          const dom = unit === 'osc_0_100' ? { min: '0', max: '100' } : ['price', 'volume', 'ratio'].includes(unit) ? { min: '0' } : {};
          grid.append(field(`${side} value`, text(o?.value, v => { const n = numOrAbsent(v); o.value = n === undefined ? null : n; },
            { type: 'number', inputmode: 'decimal', step: 'any', ...dom, 'aria-label': `${L}: ${side.toLowerCase()} value` }), { hint: U ? `${U.domain[0].toUpperCase()}${U.domain.slice(1)}.` : null }));
        }
      };
      if (scanOpName(c.op) === 'BETWEEN') {
        if (!Array.isArray(c.range)) c.range = [{ value: null }, { value: null }];
        c.range = c.range.map(b => (b && typeof b === 'object' ? b : { value: b ?? null }));
        operand(c.range[0], (o) => { c.range[0] = o; }, 'From');
        operand(c.range[1], (o) => { c.range[1] = o; }, 'To');
      } else {
        if (!c.right || typeof c.right !== 'object') c.right = { value: null };
        operand(c.right, (o) => { c.right = o; }, 'Right side', { multiplier: true });
      }
      row.append(grid);
      row.append(problemHost(`condition ${i + 1}`));
      c3.append(row);
    });
    const full = tree.children.length >= SCAN_LIMITS.maxConditions;
    c3.append(el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': 'Add a condition', disabled: full ? '' : null, onclick: () => {
      tree.children.push(scanBlankCondition()); rebuild(`Condition ${tree.children.length}: left side`);
    } }, full ? `The limit is ${SCAN_LIMITS.maxConditions} conditions` : 'Add a condition'));
  }
  root.append(c3);

  /* ---- what gets recorded ---- */
  const c4 = el('div', { class: 'card' });
  c4.append(cardHead('What the worker records', 'Only a completed bar is evaluated — the bar close is the only confirmation there is. A bar captured before its session closed is provisional and never confirms a match.'));
  c4.append(radios(`scan-mode-${scanFieldSeq}`, d.cooldownMode, [
    ['NEW_MATCH', 'New match', 'record the bar a match begins — the conditions held, and did not on the bar before'],
    ['EVERY_MATCH', 'Every match', 'record every bar on which the conditions hold']], v => { d.cooldownMode = v; }, 'Record'));
  c4.append(problemHost('cooldownMode'));
  const g4 = el('div', { class: 'grid g-2 scan-grid', style: 'margin-top:var(--sm)' });
  g4.append(field('Cooldown (bars)', text(d.cooldownBars ?? '', v => { const n = numOrAbsent(v); if (n === undefined) delete d.cooldownBars; else d.cooldownBars = n; },
    { type: 'number', inputmode: 'numeric', min: '0', step: '1', placeholder: '0' }), { hint: 'Bars of the same instrument before it can be recorded again, on top of the mode. Blank is none.', path: 'cooldownBars' }));
  g4.append(field('Expires (blank for never)', text(d.expires || '', v => { d.expires = v || null; }, { type: 'date' }), { hint: 'Bars after this date are not evaluated.', path: 'expires' }));
  c4.append(g4);
  root.append(c4);

  /* ---- save, test, copy ---- */
  const c5 = el('div', { class: 'card scan-actions' });
  const status = el('p', { class: 'scan-status', role: 'status', 'aria-live': 'polite' });
  const summary = el('ul', { class: 'scan-problems scan-problems-all' });
  const saveBtn = el('button', { class: 'btn btn-primary', 'aria-label': mode === 'edit' ? 'Save (new version)' : 'Save as version 1', onclick: () => {
    const out = scanSaveSetup(scanDraftSetup(d));
    if (!out.ok) { toast(`Not saved — ${out.problems[0]}`); refresh(); return; }
    if (mode === 'new') { scanDraft = null; scanIdAuto = true; } else scanEditDraft = null;
    toast(out.created ? `Saved ${out.id} as v${out.version}` : out.bumped ? `Saved as v${out.version}; the earlier versions are kept`
      : out.metaChanged ? `No change to the conditions — still v${out.version}; the name and flags are updated` : `No change — still v${out.version}`);
    navigate(scanSetupPath(out.id));
  } }, mode === 'edit' ? 'Save (new version)' : 'Save');
  const testBtn = el('button', { class: 'btn btn-ghost', 'aria-label': 'Test against your history (not recorded)', onclick: () => {
    const chk = scanDraftCheck(d, { mode });
    if (!chk.ready) return;
    const r = scanRunHere([{ ...chk.normalised, id: d.id || 'draft', enabled: true }], history, { instruments: registry, existing: scanAlertList(), now: new Date().toISOString() });
    outHost.replaceChildren(scanRunSummary(r, `A test of the draft${d.enabled ? '' : ' (disabled, tested anyway)'} against data/price-history.json. Nothing is recorded.`));
  } }, 'Test against your history');
  const pre = el('pre', { class: 'scan-json', hidden: '' });
  const exPre = el('pre', { class: 'scan-json', hidden: '' });
  const draftDoc = () => {
    const chk = scanDraftCheck(d, { mode });
    const s = chk.normalised ? { ...chk.normalised } : chk.setup;
    if (mode === 'edit' && chk.normalised) {
      const cur = scanVersionOf(rec);
      s.version = scanSameVersion(cur, chk.normalised) ? rec.current : Math.max(...rec.versions.map(v => v.version)) + 1;
      s.hash = chk.normalised.hash;
    }
    return { kind: 'quantum-tradeworks-scan-setups', schema: 2, setups: [s] };
  };
  const copyBtn = el('button', { class: 'btn btn-ghost', 'aria-label': 'Copy setup JSON', onclick: async () => {
    const t = JSON.stringify(draftDoc(), null, 2);
    pre.textContent = t; pre.hidden = false;
    await scanCopy(t, 'Setup JSON copied — to add it to a file, paste the object inside its "setups" list');
  } }, 'Copy JSON');
  const exBtn = el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': 'Copy example configuration', onclick: async () => {
    const t = JSON.stringify(SCAN_EXAMPLE_DOC, null, 2);
    exPre.textContent = t; exPre.hidden = false;
    await scanCopy(t, 'Example copied — an illustration of the syntax, not a suggestion');
  } }, 'Copy example configuration');
  const outHost = el('div', { class: 'scan-test-out' });
  c5.append(status);
  c5.append(summary);
  c5.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--sm)' }, [
    saveBtn, testBtn, copyBtn,
    mode === 'edit' ? el('a', { class: 'btn btn-quiet btn-sm', href: href(scanSetupPath(rec.id)), onclick: (e) => { scanEditDraft = null; if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(scanSetupPath(rec.id)); } }, 'Cancel')
      : el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': 'Start over', onclick: () => {
        /* Blank, and settled against this address: the link that seeded
           the draft does not seed it again on the next render. */
        scanSetDraft(scanBlankDraft(), scanSeedSig());
        render();
        document.querySelector('main [aria-label="Name"]')?.focus();
      } }, 'Start over'),
  ]));
  const testWhy = el('p', { class: 'caption', style: 'margin-top:6px' });
  c5.append(testWhy);
  c5.append(outHost);
  c5.append(pre);
  c5.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:center' }, [exBtn,
    el('span', { class: 'caption' }, 'The file’s full syntax — nested groups, every field — as a disabled example. An illustration, not a suggestion.')]));
  c5.append(exPre);
  root.append(c5);

  /* In place: the problems at their paths, the buttons, the prose, and what
     Save will do. Called on every keystroke; it never rebuilds. */
  function refresh() {
    const chk = scanDraftCheck(d, { mode });
    const byPath = new Map();
    chk.problems.forEach(p => { const k = hosts.has(p.path) ? p.path : '*'; if (!byPath.has(k)) byPath.set(k, []); byPath.get(k).push(p); });
    hosts.forEach((h, path) => {
      const ps = byPath.get(path) || [];
      h.replaceChildren(...ps.map(p => el('li', {}, p.text)));
      h.hidden = !ps.length;
      const grp = h.closest('.scan-cond, .field');
      if (grp) grp.classList.toggle('scan-invalid', !!ps.length);
    });
    summary.replaceChildren(...chk.problems.map(p => el('li', {}, `${p.path ? `${p.path}: ` : ''}${p.text}`)));
    summary.hidden = !chk.problems.length;
    saveBtn.disabled = !chk.ready;
    copyBtn.disabled = !chk.ready;
    testBtn.disabled = !chk.ready || !haveHistory;
    testWhy.textContent = !haveHistory ? 'No price history is loaded here, so there is nothing to test against — on the deployed site there never is.' : '';
    testWhy.hidden = haveHistory;
    let what = '';
    if (chk.ready && mode === 'edit') {
      const cur = scanVersionOf(rec);
      what = scanSameVersion(cur, chk.normalised) ? ` No change to what it evaluates — saving keeps v${rec.current}.` : ` What it evaluates differs from v${rec.current} — saving creates v${Math.max(...rec.versions.map(v => v.version)) + 1}.`;
    }
    status.textContent = chk.ready ? `Ready to save.${what}` : `Not ready — ${scanPlural(chk.problems.length, 'problem')}, each shown where it is.`;
    status.classList.toggle('scan-status-bad', !chk.ready);
    proseSpans.forEach(([span, c]) => { span.textContent = scanCondSentence(c, d.timeframe); });
    const setup = chk.setup;
    const inUni = haveHistory ? scanUniverse(setup, history, registry) : [];
    const gaps = haveHistory ? scanUniverseGaps(setup, history, registry) : { missing: [], unplaced: [] };
    let note = haveHistory ? `${scanPlural(inUni.length, 'instrument')} in this universe ${inUni.length === 1 ? 'has' : 'have'} a series in your history.` : 'No price history is loaded here, so the universe cannot be counted.';
    if (gaps.missing.length) note += ` No series, so not scanned: ${gaps.missing.join(', ')}.`;
    if (setup.universe?.kind === 'watchlist') {
      const snap = setup.universe;
      note = `${scanPlural((snap.symbols || []).length, 'symbol')} as of ${snap.asOf || '?'}: ${(snap.symbols || []).join(', ') || '—'}${snap.unresolved?.length ? ` · not resolvable to a symbol: ${snap.unresolved.join(', ')}` : ''}. ${note} ${scanResolvesByExport(snap)
        ? 'The worker resolves the list from your latest export of it and falls back to this snapshot when the export does not hold it; Test here evaluates the list as it stands in this browser.'
        : 'The worker cannot read this browser, so the setup carries this snapshot; saving again takes the list as it is then.'}`;
      if (mode === 'edit') { const wd = scanWatchlistDrift(scanRecordSetup(rec)); if (wd && !wd.same) note += ` ${wd.text}`; }
    }
    uniNote.textContent = note;
  }
  refresh();
  return root;
}

/* =====================================================================
   /app/scanner/watchlists — each list as a scanner universe

   A watchlist lives in this browser; the worker evaluates the snapshot of
   its symbols a setup carries. So per list: its members and whether the
   history holds each one, the setups whose universe is the list, whether
   each snapshot still matches the list, and those setups' latest matches in
   date order.
   ===================================================================== */
VIEWS.scannerWatchlists = () => {
  const wrap = scanPage();
  wrap.append(scanSubnav('watchlists'));
  wrap.append(scanPageHead('Watchlist scanner', 'Your watchlists as scanner universes. The worker cannot read this browser, so a setup carries a snapshot of its list’s symbols, or is resolved from your latest export of the lists; this page says where either has parted from the list.'));
  const lists = State.watchlists || [];
  /* The file the worker resolves export-resolved setups from, and when
     this browser last wrote it. */
  if (lists.length) {
    const ex = scanStoreRead().watchlistsExported;
    const xc = el('div', { class: 'card' });
    xc.append(cardHead('The lists file the worker reads', ex?.at
      ? `Last exported for the scanner from this browser ${scanStamp(ex.at)}, with ${scanPlural(Object.keys(ex.lists || {}).length, 'list')}.`
      : 'Not exported for the scanner from this browser yet.',
      el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': 'Export for the scanner (watchlists.json)', onclick: () => {
        scanExportWatchlists(); toast('Exported — save it as data/watchlists.json on the machine the worker runs on'); scanRender();
      } }, 'Export for the scanner')));
    xc.append(el('p', { class: 'metaline', style: 'max-width:80ch' }, 'Save the download as data/watchlists.json (git-ignored) where the worker runs. A setup set to resolve from your latest export reads its list from that file at every run; the worker cannot read this browser, so the list it sees is the one you last exported, and a setup whose list is not in the file is evaluated on its own snapshot and the run marked partial. Setups on a snapshot never read the file.'));
    wrap.append(xc);
  }
  const history = scanHistoryFile;
  const held = new Set(Object.keys(history?.series || {}).map(s => s.toUpperCase()));
  const setups = scanBrowserSetups();
  const fileSetups = scanSetupsFile ? scanValidate(scanSetupsFile).setups : [];
  const inBrowser = new Set(setups.map(s => s.id));
  /* A setup in the file that this browser has not adopted still scans a
     list; it is listed, marked as the file's. */
  const all = [...setups.map(s => ({ s, where: 'browser' })), ...fileSetups.filter(s => !inBrowser.has(s.id)).map(s => ({ s, where: 'file' }))];
  const onList = (wid) => all.filter(x => x.s.universe?.kind === 'watchlist' && x.s.universe.watchlistId === wid);
  const alertState = scanAlertStateRead();
  if (!lists.length) {
    const e = el('div', { class: 'card scan-empty' });
    e.append(el('h2', { class: 'h-card' }, 'No watchlists in this browser'));
    e.append(el('p', { class: 'body', style: 'margin:6px auto 0' }, 'A watchlist is a list of companies you follow. Make one, then choose it as a setup’s universe in the builder.'));
    e.append(el('div', { class: 'row row-wrap', style: 'gap:8px;justify-content:center;margin-top:var(--md)' }, scanLink('/my/watchlists', 'Make a watchlist', { class: 'btn btn-primary btn-sm' })));
    wrap.append(e);
  }
  lists.forEach(w => {
    const items = watchlistItems(w);
    const card = el('div', { class: 'card' });
    const users = onList(w.id);
    card.append(cardHead(w.name, `${scanPlural(items.length, 'member')} · ${scanPlural(users.length, 'setup')} scanning it${w.updatedAt ? ` · list updated ${scanDay(w.updatedAt)}` : ''}`,
      el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
        /* A draft with changes in it was replaced without a word, where
           every other start the builder offers asks first. */
        el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': `New setup on ${w.name}`, onclick: () => {
          if (scanDraft && !scanDraftUntouched() && !confirm('Replace the draft open in the builder with a new setup on this list? What is in the draft now is not kept.')) return;
          scanDraft = { ...scanBlankDraft(), universe: { kind: 'watchlist', watchlistId: w.id } }; scanIdAuto = true; navigate('/app/scanner/setups/new');
        } }, 'New setup on this list'),
      ])));
    if (users.some(x => scanResolvesByExport(x.s.universe))) {
      const xs = scanWatchlistExportState(w.id);
      card.append(el('p', { class: `caption scan-note${xs.state === 'IN_STEP' ? '' : ' scan-warn'}`, style: 'margin:0 0 var(--sm)' }, `For the setups resolved from your latest export: ${xs.text}`));
    }
    if (!items.length) card.append(el('p', { class: 'caption' }, 'No members yet. A setup on an empty list has nothing to scan and is refused until the list holds a company with a symbol.'));
    else {
      const t = el('table', { class: 'dt' });
      t.append(el('caption', { class: 'sr-only' }, `Members of ${w.name}`));
      t.append(el('thead', {}, el('tr', {}, ['Member', 'Instrument id', 'Symbol', 'In your history'].map(h => el('th', { scope: 'col' }, h)))));
      t.append(el('tbody', {}, items.map(i => el('tr', {}, [
        el('td', { style: 'text-align:left' }, i.name || i.companyId),
        el('td', { class: 'ident' }, i.instrumentId || el('span', { class: 'caption' }, 'not resolved')),
        el('td', { class: 'ident' }, i.symbol ? scanSymbolLink(i.symbol) : '—'),
        el('td', { style: 'text-align:left' }, !i.symbol ? el('span', { class: 'caption' }, 'no symbol, so never scanned')
          : !history ? el('span', { class: 'caption' }, 'history not loaded') : held.has(String(i.symbol).toUpperCase()) ? 'series held' : el('span', { class: 'caption' }, 'no series — not scanned')),
      ]))));
      card.append(el('div', { class: 'tablewrap' }, t));
    }
    if (!users.length) card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, 'No setup scans this list.'));
    users.forEach(({ s, where }) => {
      const wd = scanWatchlistDrift(s);
      const p = el('div', { class: 'panel', style: 'margin-top:var(--sm)' });
      p.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
        scanLink(scanSetupPath(s.id), s.name || s.id, { style: 'font-weight:600' }), el('span', { class: 'chip' }, `v${s.version}`),
        where === 'file' ? el('span', { class: 'chip chip-bronze' }, 'in the file only') : null,
        scanResolvesByExport(s.universe) ? el('span', { class: 'chip' }, 'resolved from your latest export') : null,
        el('span', { class: `chip ${wd?.same ? 'chip-ok' : 'chip-warn'}` }, wd?.byExport ? (wd.same ? 'export matches the list' : 'export differs') : wd?.same ? 'snapshot matches the list' : 'snapshot differs'),
      ]));
      p.append(el('p', { class: 'caption', style: 'margin-top:4px' }, wd?.text || ''));
      const recent = scanAlertsInOrder(scanAlertsOf(s.id)).slice(0, 5);
      if (recent.length) {
        const ul = el('ul', { class: 'scan-alert-mini' });
        recent.forEach(a => ul.append(el('li', {}, [scanLink(scanAlertPath(a), `${scanAlertBar(a)} · ${a.symbol}`), ' ', el('span', { class: 'caption' }, `${a.eventType || 'MATCH'} · ${scanAlertStatus(a, alertState).toLowerCase()}`)])));
        p.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, 'Latest matches, in date order:'));
        p.append(ul);
      } else p.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, scanAlertsFile ? 'No match recorded for it yet.' : 'The alerts file cannot be seen from here.'));
      card.append(p);
    });
    wrap.append(card);
  });
  /* Setups whose list is no longer in this browser still scan its snapshot. */
  const orphans = all.filter(x => x.s.universe?.kind === 'watchlist' && !wlById(x.s.universe.watchlistId));
  if (orphans.length) {
    const card = el('div', { class: 'card' });
    card.append(cardHead('Lists no longer in this browser', 'These setups snapshotted a list this browser does not hold — deleted, or made in another browser. The worker still evaluates each snapshot.'));
    orphans.forEach(({ s }) => card.append(el('div', { class: 'panel', style: 'margin-top:var(--sm)' }, [
      el('div', { class: 'row row-wrap', style: 'gap:6px' }, [scanLink(scanSetupPath(s.id), s.name || s.id, { style: 'font-weight:600' }), el('span', { class: 'chip' }, `v${s.version}`)]),
      el('p', { class: 'caption', style: 'margin-top:4px' }, scanWatchlistDrift(s).text)])));
    wrap.append(card);
  }
  wrap.append(el('p', { class: 'caption' }, 'Watchlists hold companies. An FX pair, an index or a yield is not a company, so it cannot be on a list; name it in a setup’s instruments instead.'));
  return wrap;
};

/* =====================================================================
   /app/scanner/alerts — the notification centre

   Every match in data/scan-alerts.json, in date order, with its status in
   this browser. Filters by setup, symbol and status; bulk mark read,
   archive, or back to new. The file is never edited.
   ===================================================================== */
const SCAN_STATUS_CHIP = { NEW: 'chip-brand', READ: '', ARCHIVED: 'chip-bronze' };
const SCAN_EVENT_TEXT = {
  NEW_MATCH: 'New match — the conditions held on this bar and not on the bar before.',
  MATCH: 'Match — the conditions held on this bar (the setup records every matching bar).',
  FIRST_OBSERVED: 'First observed — the conditions held on this bar; the bar before could not be evaluated, so no change from not-matching can be shown.',
};
let scanAlertSel = new Set();
VIEWS.scannerAlerts = () => {
  const wrap = scanPage();
  wrap.append(scanSubnav('alerts'));
  const prefs = scanPrefsRead();
  const qs = new URLSearchParams(location.search);
  const f = { setup: qs.get('setup') || '', symbol: (qs.get('symbol') || '').toUpperCase(), status: (qs.get('status') || prefs.statusFilter).toUpperCase(), page: Math.max(1, parseInt(qs.get('page') || '1', 10) || 1) };
  if (!['OPEN', 'NEW', 'READ', 'ARCHIVED', 'ALL'].includes(f.status)) f.status = 'OPEN';
  /* The bar range, held in the address like the other filters (?from= and
     ?to=, inclusive session dates). A value that is not a date bounds
     nothing, and the page says it was set aside rather than guess at it. */
  const dayQ = (k) => { const v = String(qs.get(k) || '').trim(); return scanIsDay(v) ? { v, bad: null } : { v: '', bad: v || null }; };
  const fromQ = dayQ('from'), toQ = dayQ('to');
  f.from = fromQ.v; f.to = toQ.v;
  const inRange = (a) => { const b = scanAlertBar(a); return (!f.from || b >= f.from) && (!f.to || b <= f.to); };
  const rangeText = f.from && f.to ? `between ${f.from} and ${f.to}` : f.from ? `on or after ${f.from}` : f.to ? `on or before ${f.to}` : '';
  const unread = scanUnreadCount();
  wrap.append(scanPageHead('Alerts', 'Every match the worker recorded, newest bar first — a record in date order, never a ranking. Whether you have read one is kept in this browser; the record file is never edited.'));
  if (!scanAlertsFile) {
    wrap.append(scanNotInRecord('The alerts file cannot be seen from here', 'data/scan-alerts.json lives on the machine the worker runs on; it is git-ignored and never deployed, so on the published site there is nothing to show — and no unread count, rather than a count of nought. Locally, run node scanner/scan.mjs and reload.', ['/app/scanner/setups', 'Your setups']));
    return wrap;
  }
  const all = scanAlertsInOrder();
  const st = scanAlertStateRead();
  const counts = { NEW: 0, READ: 0, ARCHIVED: 0 };
  all.forEach(a => counts[scanAlertStatus(a, st)]++);
  const tiles = el('div', { class: 'grid scan-counts' });
  tiles.append(statTile('Recorded', String(all.length), { sub: 'in data/scan-alerts.json' }));
  tiles.append(statTile('New', String(counts.NEW), { sub: prefs.inApp === false ? 'in-app count switched off' : unread != null && unread !== counts.NEW ? `${unread} counted — ${counts.NEW - unread} from muted setups` : 'not yet read here' }));
  tiles.append(statTile('Read', String(counts.READ)));
  tiles.append(statTile('Archived', String(counts.ARCHIVED)));
  wrap.append(el('div', { class: 'card' }, tiles));
  const setIds = [...new Set(all.map(a => a.setupId).filter(Boolean))];
  const symbols = [...new Set(all.map(a => String(a.symbol || '').toUpperCase()).filter(Boolean))].sort();
  const shown = all.filter(a => (!f.setup || a.setupId === f.setup) && (!f.symbol || String(a.symbol || '').toUpperCase() === f.symbol) && inRange(a)
    && (f.status === 'ALL' || (f.status === 'OPEN' ? scanAlertStatus(a, st) !== 'ARCHIVED' : scanAlertStatus(a, st) === f.status)));
  const size = prefs.pageSize;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const page = Math.min(f.page, pages);
  const slice = shown.slice((page - 1) * size, page * size);
  /* Filters live in the address, so a link from a setup opens its matches
     and Back restores the view. */
  const setQ = (patch, { fallback = null, redraw = true, focus = null } = {}) => {
    const q = new URLSearchParams(location.search);
    Object.entries(patch).forEach(([k, v]) => { if (v == null || v === '' || (k === 'page' && v === 1)) q.delete(k); else q.set(k, v); });
    if (!('page' in patch)) q.delete('page');
    scanAlertSel = new Set();
    const s = q.toString();
    history.replaceState(history.state, '', location.pathname + (s ? `?${s}` : ''));
    if (redraw) scanRender({ fallback, focus });
  };
  const card = el('div', { class: 'card' });
  /* Five filters: one row on a desktop, one column on a phone. */
  const fl = el('div', { class: 'grid scan-grid scan-filters', style: 'grid-template-columns:repeat(auto-fit, minmax(180px, 1fr))' });
  const fsel = (label, val, opts, key) => {
    const id = `scanf-${++scanFieldSeq}`;
    const s = el('select', { class: 'select', id, 'aria-label': label, onchange: e => setQ({ [key]: e.target.value }) });
    opts.forEach(([v, l]) => s.append(el('option', { value: v, selected: val === v ? '' : null }, l)));
    return el('div', { class: 'field' }, [el('label', { for: id }, label), s]);
  };
  const nameOf = (id) => scanStoreRead().setups[id]?.name || all.find(a => a.setupId === id)?.setupName || id;
  fl.append(fsel('Setup', f.setup, [['', 'Every setup'], ...setIds.map(id => [id, nameOf(id)])], 'setup'));
  fl.append(fsel('Symbol', f.symbol, [['', 'Every symbol'], ...symbols.map(s => [s, s])], 'symbol'));
  fl.append(fsel('Status', f.status, [['OPEN', 'New and read'], ['NEW', 'New'], ['READ', 'Read'], ['ARCHIVED', 'Archived'], ['ALL', 'All, archived included']], 'status'));
  /* A date is applied when the field is left or Enter is pressed, not on
     each keystroke: a typed year passes through 0002 and 0020 on its way to
     2026, and re-drawing the page at each would take the field away from
     the cursor. */
  /* Left by a press on another control, the date was applied at the blur,
     which falls between the press and the release: the page was redrawn
     under the pointer and the click landed on nothing — "Clear the dates"
     applied the date it was meant to clear, and "Mark read" or "Next" did
     nothing. The address takes the date at the blur, so the pressed
     control's own action reads it, and the page is redrawn once its click
     has run (or, pressed and let go with no click, a moment later). Left
     by Tab, the redraw destroyed the control focus was moving to, and
     focus fell to <body>; it goes to that control as redrawn. */
  const fdate = (label, val, key) => {
    const id = `scanf-${++scanFieldSeq}`;
    const changed = (e) => { const v = e.target.value || ''; return v !== (val || '') && (!v || scanIsDay(v)) ? { v } : null; };
    const commit = (e) => { const c = changed(e); if (c) setQ({ [key]: c.v }); };
    const onblur = (e) => {
      const c = changed(e);
      if (!c) return;
      if (!scanPressing()) { setQ({ [key]: c.v }, { focus: e.relatedTarget }); return; }
      setQ({ [key]: c.v }, { redraw: false });
      let t = null;
      const later = () => { document.removeEventListener('click', later); clearTimeout(t); if (State.view === 'scannerAlerts') scanRender(); };
      document.addEventListener('click', later);
      t = setTimeout(later, 1500);
    };
    return el('div', { class: 'field' }, [el('label', { for: id }, label),
      el('input', { class: 'input', type: 'date', id, value: val || '', 'aria-label': label, onblur, onkeydown: (e) => { if (e.key === 'Enter') commit(e); } })]);
  };
  fl.append(fdate('Bar from', f.from, 'from'));
  fl.append(fdate('Bar to', f.to, 'to'));
  card.append(fl);
  const setAside = [fromQ.bad ? `“${fromQ.bad}” (from)` : null, toQ.bad ? `“${toQ.bad}” (to)` : null].filter(Boolean);
  if (rangeText || setAside.length) card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center;margin-top:var(--sm)' }, [
    rangeText ? el('span', { class: 'metaline' }, `Bars ${rangeText}, inclusive.`) : null,
    setAside.length ? el('span', { class: 'caption' }, `${setAside.join(' and ')} ${setAside.length === 1 ? 'is' : 'are'} not a date (YYYY-MM-DD), so ${setAside.length === 1 ? 'it bounds' : 'they bound'} nothing.`) : null,
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => setQ({ from: '', to: '' }, { fallback: 'Bar from' }) }, 'Clear the dates'),
  ]));

  if (!all.length) {
    card.append(el('div', { class: 'scan-empty', style: 'padding:var(--lg) 0 var(--sm)' }, [
      el('h2', { class: 'h-card' }, 'Nothing recorded yet'),
      el('p', { class: 'body', style: 'margin:6px auto 0' }, 'The worker appends a record here when a setup matches. An empty record is the normal state of a scanner with tight conditions, not a fault.')]));
    wrap.append(card);
    return wrap;
  }
  if (!shown.length) {
    card.append(el('div', { class: 'scan-empty', style: 'padding:var(--lg) 0 var(--sm)' }, [
      el('h2', { class: 'h-card' }, 'No match fits these filters'),
      el('p', { class: 'body', style: 'margin:6px auto 0' }, `${scanPlural(all.length, 'match', 'matches')} ${all.length === 1 ? 'is' : 'are'} recorded; none is ${f.status === 'OPEN' ? 'new or read' : f.status === 'ALL' ? 'left' : f.status.toLowerCase()}${f.setup ? ` for ${nameOf(f.setup)}` : ''}${f.symbol ? ` on ${f.symbol}` : ''}${rangeText ? ` with a bar ${rangeText}` : ''}.${f.from && f.to && f.from > f.to ? ' The range ends before it begins.' : ''}`),
      el('div', { class: 'row row-wrap', style: 'gap:8px;justify-content:center;margin-top:var(--sm)' }, el('button', { class: 'btn btn-ghost btn-sm', onclick: () => setQ({ setup: '', symbol: '', status: 'ALL', from: '', to: '' }, { fallback: 'Status' }) }, 'Show every match'))]));
    wrap.append(card);
    return wrap;
  }

  /* Bulk actions act on the ticked rows, or — with none ticked — on every
     row the filters show, which the button says. */
  scanAlertSel = new Set([...scanAlertSel].filter(id => shown.some(a => scanAlertIdOf(a) === id)));
  const bulk = el('div', { class: 'row row-wrap scan-bulk', style: 'gap:8px;margin-top:var(--md);align-items:center' });
  const selInfo = el('span', { class: 'caption', role: 'status', 'aria-live': 'polite' });
  const act = (status, label) => el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const ids = scanAlertSel.size ? [...scanAlertSel] : shown.map(scanAlertIdOf);
    scanSetAlertStatus(ids, status);
    toast(`${scanPlural(ids.length, 'alert')} marked ${status.toLowerCase()}`);
    scanAlertSel = new Set();
    scanRender();
  } }, label);
  /* The count, and the header's box, follow every tick. The box kept the
     state it was drawn with: ticked from the header and one row unticked,
     it still read "every row ticked", and a press on it then unticked all.
     And with more than one page, "all 250 shown" beside "Showing 1–50"
     told a reader who meant this page that the buttons would act on it;
     they act on every row the filters leave, on every page. */
  const refreshSel = () => {
    const n = scanAlertSel.size;
    selInfo.textContent = n ? `${n} ticked` : pages > 1 ? `None ticked — the buttons act on all ${shown.length} that fit the filters, on every page` : `None ticked — the buttons act on all ${shown.length} shown`;
    const on = slice.filter(a => scanAlertSel.has(scanAlertIdOf(a))).length;
    allBox.checked = !!slice.length && on === slice.length;
    allBox.indeterminate = on > 0 && on < slice.length;
  };
  /* The filtered rows as CSV, in the same date order, with their status
     here — the record as a spreadsheet reads it. */
  const csv = el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['candleDate', 'setupId', 'setupName', 'setupVersion', 'symbol', 'instrumentId', 'timeframe', 'eventType', 'close', 'barStatus', 'dataVersion', 'detectedAt', 'status', 'id'];
    const lines = [head.join(','), ...shown.map(a => [scanAlertBar(a), a.setupId, a.setupName, a.setupVersion ?? '', a.symbol, a.instrumentId ?? '', a.timeframe, a.eventType ?? '',
      a.close, a.barStatus ?? '', a.dataVersion ?? '', a.detectedAt || a.recordedAt || '', scanAlertStatus(a, st), scanAlertIdOf(a)].map(cell).join(','))];
    const link = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: `scan-alerts-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(link); link.click(); link.remove();
  } }, 'Download CSV');
  bulk.append(act('READ', 'Mark read'), act('ARCHIVED', 'Archive'), act('NEW', 'Mark new'), csv, selInfo);
  card.append(bulk);

  const t = el('table', { class: 'dt scan-alerts-t' });
  t.append(el('caption', { class: 'sr-only' }, 'Recorded matches, newest bar first'));
  const allBox = el('input', { type: 'checkbox', 'aria-label': 'Tick every row on this page', checked: slice.length && slice.every(a => scanAlertSel.has(scanAlertIdOf(a))) ? '' : null, onchange: e => {
    slice.forEach(a => { const id = scanAlertIdOf(a); if (e.target.checked) scanAlertSel.add(id); else scanAlertSel.delete(id); });
    t.querySelectorAll('tbody input[type=checkbox]').forEach(b => { b.checked = e.target.checked; });
    refreshSel();
  } });
  /* Each box sits in a label that takes the press: on a phone the box
     alone was 22px, half the 44px a finger needs, and nothing around it
     was a target. */
  const hit = (box) => el('label', { class: 'scan-tick-hit' }, box);
  t.append(el('thead', {}, el('tr', {}, [el('th', { scope: 'col', class: 'scan-tick' }, hit(allBox)), ...['Status', 'Bar', 'Setup', 'Instrument', 'Event', 'Close', ''].map(h => el('th', { scope: 'col', class: h === 'Close' ? 'num' : null }, h || el('span', { class: 'sr-only' }, 'Detail')))])));
  t.append(el('tbody', {}, slice.map(a => {
    const id = scanAlertIdOf(a);
    const s = scanAlertStatus(a, st);
    return el('tr', { class: s === 'NEW' ? 'scan-new' : null }, [
      el('td', { class: 'scan-tick' }, hit(el('input', { type: 'checkbox', 'aria-label': `Tick ${a.setupName || a.setupId} on ${a.symbol}, ${scanAlertBar(a)}`, checked: scanAlertSel.has(id) ? '' : null,
        onchange: e => { if (e.target.checked) scanAlertSel.add(id); else scanAlertSel.delete(id); refreshSel(); } }))),
      el('td', {}, el('span', { class: `chip ${SCAN_STATUS_CHIP[s]}` }, s.toLowerCase())),
      el('td', { class: 'ident' }, scanAlertBar(a) || '—'),
      el('td', { style: 'text-align:left' }, [a.setupName || a.setupId, a.setupVersion != null ? el('span', { class: 'caption' }, ` v${a.setupVersion}`) : null]),
      el('td', { style: 'text-align:left' }, scanSymbolLink(a.symbol)),
      el('td', { class: 'caption', style: 'text-align:left' }, `${(a.eventType || 'MATCH').replace('_', ' ').toLowerCase()}${a.gapBefore === true ? ' · across a gap' : ''}`),
      el('td', { class: 'num' }, scanPriceText(a.close)),
      el('td', {}, scanLink(scanAlertPath(a), 'Open', { 'aria-label': `Open ${a.setupName || a.setupId} on ${a.symbol}, ${scanAlertBar(a)}` })),
    ]);
  })));
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  refreshSel();
  const pager = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--sm);align-items:center' }, [
    el('span', { class: 'metaline' }, `Showing ${(page - 1) * size + 1}–${Math.min(page * size, shown.length)} of ${shown.length}${shown.length !== all.length ? ` (of ${all.length} recorded)` : ''}`),
    el('span', { class: 'spacer' }),
    el('button', { class: 'btn btn-ghost btn-sm', disabled: page > 1 ? null : '', 'aria-label': 'Previous page', onclick: () => setQ({ page: page - 1 }, { fallback: 'Next page' }) }, 'Previous'),
    el('span', { class: 'caption' }, `Page ${page} of ${pages}`),
    el('button', { class: 'btn btn-ghost btn-sm', disabled: page < pages ? null : '', 'aria-label': 'Next page', onclick: () => setQ({ page: page + 1 }, { fallback: 'Previous page' }) }, 'Next'),
  ]);
  card.append(pager);
  wrap.append(card);
  wrap.append(el('p', { class: 'caption' }, 'Status is kept in this browser (scanAlertState), so another browser or device keeps its own. Opening an alert marks it read. Nothing is sent anywhere.'));
  return wrap;
};

/* =====================================================================
   /app/scanner/alerts/:alert — one recorded match

   Factual throughout: the bar, its status, the data behind it, the setup
   version that recorded it, every condition with its values. No instruction
   follows, and none is implied.
   ===================================================================== */
const SCAN_BAR_STATUS_TEXT = {
  FINAL: 'Final — captured after its session closed and settled.',
  PROVISIONAL: 'Provisional — captured before its session closed. A provisional bar never confirms a match, so a record should not carry it.',
  UNKNOWN: 'Unknown — no capture time is recorded for this bar (every bar captured before capture times were kept). It was evaluated once its session had closed.',
  CORRECTED: 'Corrected — the source revised this bar after it was first captured.',
};
/* THE RECORD, EVALUATED AGAIN (SC-310). The setup the record names — its
   snapshot, or for a record that predates snapshots the version this
   browser holds under that number — on the history as loaded, cut at the
   alert's bar and read as the run read it: the same market, the calendar
   inferred from the cut history, and the clock of the moment it was
   detected. So nothing after the bar can reach the answer. It reproduces
   when the conditions hold on that bar again, the event is the one
   recorded, and every value the record holds comes back within the
   engine's float tolerance.
   Either way, the bars whose closes differ from the record are named. The
   record holds a close for every bar it recorded on this instrument (this
   alert's and any other setup's), and the history's corrections log names
   closes changed after this one was detected; a change the record cannot
   see — an open, a volume, a bar added or trimmed — is said to be there,
   not guessed at. */
function scanReproduce(a, { history = scanHistoryFile, list = scanAlertList() } = {}) {
  const bar = scanAlertBar(a), sym = a.symbol;
  const out = { bar, sym, bars: null, at: -1, closes: [], values: [], state: null, text: '' };
  if (!history?.series) return { ...out, state: 'NO_HISTORY', text: 'The price history is not loaded here, so the bar cannot be evaluated again — on the deployed site it never is.' };
  if (!history.series[sym]) return { ...out, state: 'NO_SERIES', text: `The history holds no series ${sym}, so the bar cannot be evaluated again.` };
  const heldNow = history.series[sym];
  const since = a.detectedAt || a.recordedAt || null;
  const diffs = new Map();
  const note = (x) => {
    const d = scanAlertBar(x);
    if (!x || x.symbol !== sym || !d || d > bar || !isNum(x.close) || diffs.has(d)) return;
    const now = heldNow[d];
    if (!isNum(now) || Math.abs(now - x.close) > scanTol(now, x.close)) diffs.set(d, { date: d, recorded: x.close, now: isNum(now) ? now : null, via: 'record' });
    else diffs.set(d, null);
  };
  note(a);
  list.forEach(note);
  (Array.isArray(history.corrections?.[sym]) ? history.corrections[sym] : []).forEach(c => {
    if (c?.field !== 'close' || !c.date || c.date > bar || diffs.get(c.date)) return;
    if (since && c.at && String(c.at) <= String(since)) return;
    diffs.set(c.date, { date: c.date, recorded: c.from ?? null, now: c.to ?? null, via: 'correction', at: c.at || null, src: c.src || null });
  });
  out.closes = [...diffs.values()].filter(Boolean).sort((x, y) => y.date.localeCompare(x.date));
  const src = scanAlertSetup(a);
  const reg = scanRegistryList();
  const mkt = 'market' in a ? a.market : scanMarketOf(sym, reg);
  const cut = scanTruncateHistory(history, bar);
  const bars = scanBars(cut, sym, { timeframe: scanTimeframe(a.timeframe), market: mkt, now: a.detectedAt || scanReplayNow(bar), calendar: scanCalendar(cut, reg, mkt) });
  const at = bars.dates.length - 1;
  Object.assign(out, { bars, at });
  if (at < 0 || bars.dates[at] !== bar) return { ...out, state: 'NO_BAR', text: `The history no longer holds the ${bar} bar for ${sym}, so it cannot be evaluated again.` };
  if (!src) return { ...out, state: 'NO_SETUP', text: `The record carries no copy of its setup (it predates engine 0.3.0), and this browser does not hold v${a.setupVersion ?? 1} of ${a.setupId}, so there are no conditions to evaluate again.` };
  const C = scanPageCache();
  const r = scanEvaluate(src.setup.ruleTree, bars, { at, cache: C });
  let event = null;
  if (r.state === 'MET') {
    if (src.setup.cooldownMode === 'NEW_MATCH') {
      const p = scanEvaluate(src.setup.ruleTree, bars, { at: at - 1, cache: C });
      event = p.state === 'MET' ? 'CONTINUING' : p.state === 'NOT_MET' ? 'NEW_MATCH' : 'FIRST_OBSERVED';
    } else event = 'MATCH';
  }
  const sameV = (x, y) => (Array.isArray(x) || Array.isArray(y)
    ? Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => sameV(v, y[i]))
    : x == null || y == null ? x == null && y == null : isNum(x) && isNum(y) && Math.abs(x - y) <= scanTol(x, y));
  (Array.isArray(a.matchedConditions) ? a.matchedConditions : []).forEach(c => {
    const n = r.conditions.find(x => x.path === c.path);
    if (!n || !sameV(c.left, n.leftValue) || !sameV(c.right, n.rightValue)) out.values.push({ path: c.path, text: c.text, now: n ? n.text : 'no such condition now' });
  });
  const eventOk = a.eventType ? event === a.eventType : r.state === 'MET';
  const ev = (e) => ({ NEW_MATCH: 'a new match', MATCH: 'a match', FIRST_OBSERVED: 'a first observation', CONTINUING: 'a match continuing from the bar before' }[e] || 'no match');
  out.eval = r; out.event = event; out.from = src.from;
  if (r.state === 'MET' && eventOk && !out.values.length) {
    out.state = 'REPRODUCES';
    out.text = `Reproduces. Evaluated again on data/price-history.json as loaded, cut at ${bar}: the conditions hold on that bar${a.eventType && a.eventType !== 'MATCH' ? ` as ${ev(event)}` : ''}, and ${a.matchedConditions ? 'every value the record holds comes back the same' : 'the record holds no values to compare (it predates engine 0.3.0)'}.`;
  } else {
    out.state = 'DIFFERS';
    const why = [];
    if (r.state !== 'MET') why.push(`the setup is ${r.state === 'NOT_MET' ? 'not met' : 'untested'} on that bar now${r.state === 'UNAVAILABLE' && r.reason?.text ? ` (${r.reason.text})` : ''}`);
    else if (!eventOk) why.push(`the bar is now ${ev(event)}, where the record holds ${ev(a.eventType)}`);
    if (out.values.length) why.push(`${scanPlural(out.values.length, 'condition')} ${out.values.length === 1 ? 'reads' : 'read'} different values from the record`);
    out.text = `Does not reproduce. Evaluated again on data/price-history.json as loaded, cut at ${bar}: ${why.join('; ')}.`;
  }
  return out;
}

/* Set by the alert page's own status buttons for the redraw they ask for. */
let scanAlertByHand = false;
VIEWS.scannerAlert = () => {
  const wrap = scanPage();
  const want = scanParam('alert');
  const wantKey = new URLSearchParams(location.search).get('key');
  const list = scanAlertList();
  /* By id — and where records with different keys share that id (NAV 1),
     by the key the address carries, or not at all: the page lists every
     record under the id rather than show one of them as though it were the
     only one. A 0.2 record with no id resolves by the id its key gives. */
  const byId = list.filter(x => scanAlertIdOf(x) === want);
  const clash = new Set(byId.map(x => x.key ?? '')).size > 1 ? byId : null;
  const a = clash ? (wantKey ? clash.find(x => x.key === wantKey) || null : null) : byId[0] || list.find(x => x.key === want) || null;
  /* Opening an alert is reading it — before the strip is drawn, so its
     unread count already leaves this one out. The main navigation was
     drawn before this view ran, and kept the count from before: one alert
     opened, "Scanner, 24 unread" over 23. It is drawn again.
     The redraw that follows this page's own status buttons is not an
     opening: "Mark new" set the alert new and the redraw at once marked it
     read again, under a toast saying "Marked new". */
  const byHand = scanAlertByHand;
  scanAlertByHand = false;
  if (a && !byHand && scanAlertStatus(a) === 'NEW') {
    scanSetAlertStatus([scanAlertIdOf(a)], 'READ');
    if (typeof buildNav === 'function') buildNav();
  }
  wrap.append(scanSubnav('alerts'));
  if (clash && !a) {
    const card = el('div', { class: 'card scan-collision' });
    card.append(el('p', { class: 'eyebrow' }, 'One id, several records'));
    card.append(el('h2', { class: 'h-card', style: 'margin-top:4px' }, `${scanPlural(clash.length, 'record')} share the id ${want}`));
    card.append(el('p', { class: 'body', style: 'margin-top:8px;max-width:72ch' }, `An alert’s id is an eight-digit hash of its key, so two different keys can, rarely, give the same id. Each record is listed with its own key and opens by it. Their read and archived status in this browser is shared, because status is kept by id.${wantKey ? ` None of them has the key ${wantKey}.` : ''}`));
    const ul = el('ul', { class: 'scan-alert-mini', style: 'margin-top:var(--sm)' });
    clash.forEach(x => ul.append(el('li', {}, [
      scanLink(`/app/scanner/alerts/${encodeURIComponent(want)}?key=${encodeURIComponent(x.key ?? '')}`, `${scanAlertBar(x) || '—'} · ${x.setupName || x.setupId} · ${x.symbol}`), ' ',
      el('span', { class: 'caption' }, `${(x.eventType || 'MATCH').replace('_', ' ').toLowerCase()} · detected ${scanStamp(x.detectedAt || x.recordedAt)} · key ${x.key ?? '—'}`),
    ])));
    card.append(ul);
    wrap.append(card);
    return wrap;
  }
  if (!a) {
    wrap.append(scanNotInRecord(`No alert “${want}”`, scanAlertsFile
      ? `data/scan-alerts.json holds ${scanPlural(list.length, 'record')}, and none has that id. An alert’s id is taken from its key, so it does not change; a record removed from the file cannot be shown.`
      : 'data/scan-alerts.json cannot be seen from here — it lives on the machine the worker runs on and is never deployed.', ['/app/scanner/alerts', 'All alerts']));
    return wrap;
  }
  const id = scanAlertIdOf(a);
  const status = scanAlertStatus(a);
  const prefs = scanPrefsRead();
  const legacy = !a.id;
  const nr = legacy ? 'not recorded — this alert predates engine 0.3.0' : null;
  const bar = scanAlertBar(a);
  const version = a.setupVersion ?? (legacy ? 1 : null);
  const head = scanPageHead(`${a.setupName || a.setupId} · ${a.symbol} · ${bar}`, null, 'Recorded match');
  head.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
    el('span', { class: `chip ${SCAN_STATUS_CHIP[status]}` }, status.toLowerCase()),
    status !== 'ARCHIVED' ? el('button', { class: 'btn btn-ghost btn-sm', data: { scanFocus: 'archive' }, onclick: () => { scanSetAlertStatus([id], 'ARCHIVED'); scanAlertByHand = true; toast('Archived'); scanRender(); } }, 'Archive')
      : el('button', { class: 'btn btn-ghost btn-sm', data: { scanFocus: 'archive' }, onclick: () => { scanSetAlertStatus([id], 'READ'); scanAlertByHand = true; toast('Moved back to read'); scanRender(); } }, 'Unarchive'),
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { scanSetAlertStatus([id], 'NEW'); scanAlertByHand = true; toast('Marked new'); scanRender(); } }, 'Mark new'),
  ]));
  wrap.append(head);
  if (clash) {
    wrap.append(el('div', { class: 'card', role: 'note' }, [
      el('p', { class: 'caption scan-note scan-warn', style: 'margin:0' }, `This id is shared by ${scanPlural(clash.length, 'record')} with different keys; this page shows the one whose key is ${a.key}. Their status in this browser is shared, because status is kept by id. The others:`),
      el('ul', { class: 'scan-alert-mini' }, clash.filter(x => x !== a).map(x => el('li', {}, scanLink(`/app/scanner/alerts/${encodeURIComponent(want)}?key=${encodeURIComponent(x.key ?? '')}`, `${scanAlertBar(x) || '—'} · ${x.setupName || x.setupId} · ${x.symbol} · key ${x.key ?? '—'}`)))),
    ]));
  }
  const rep = scanReproduce(a);

  /* ---- the bar ---- */
  const mk = a.market ? scanMarket(a.market) : null;
  const c1 = el('div', { class: 'card' });
  c1.append(cardHead('The bar', 'What was evaluated, and when.'));
  const f1 = el('div', { class: 'scan-facts' });
  f1.append(scanFact('Candle date', bar, `${SCAN_TIMEFRAMES[scanTimeframe(a.timeframe)]?.label || a.timeframe || 'Daily'} bar${a.market ? ` · the ${a.market} session, in ${mk?.tz || 'its time zone'}` : ''}`));
  f1.append(scanFact('Bar status', a.barStatus || nr, a.barStatus ? SCAN_BAR_STATUS_TEXT[a.barStatus] : null));
  f1.append(scanFact('Instrument', el('span', {}, [scanSymbolLink(a.symbol), a.instrumentId && a.instrumentId !== a.symbol ? el('span', { class: 'caption' }, ` · ${a.instrumentId}`) : null]),
    a.instrumentId ? null : legacy ? nr : 'no row in data/instruments.json, so no canonical id'));
  f1.append(scanFact('Close on the bar', isNum(a.close) ? scanValueText(a.close, prefs, 'price') : null));
  /* Volume on the bar (C2's barVolume). Recorded as null, the history held
     none — which is not a volume of nought. Absent, the record predates
     the field, and the history's reading now is offered as that, not as
     the record's. */
  const volNow = rep.bars && rep.at >= 0 && rep.bars.dates[rep.at] === bar ? rep.bars.volumes[rep.at] : null;
  f1.append('barVolume' in a
    ? scanFact('Volume on the bar', a.barVolume == null ? 'none held' : scanValueText(a.barVolume, prefs), a.barVolume == null ? 'The history held no volume for this bar when it was evaluated — a missing volume is not a volume of nought.' : 'as the record holds it')
    : scanFact('Volume on the bar', null, isNum(volNow) ? `Not on the record, which predates the field. The history as loaded holds ${scanValueText(volNow, prefs)} for this bar now.` : 'Not on the record, which predates the field, and the history as loaded holds none for this bar.'));
  /* A NEW_MATCH across a missing session (C2's gapBefore): the bar before
     it was not the previous session, and the record says which. */
  const gap = a.gapBefore === true ? ` Across a gap: ${a.gapText || 'a session is missing between this bar and the bar before it.'}` : '';
  f1.append(scanFact('Event', `${(a.eventType || (legacy ? 'MATCH' : '')).replace('_', ' ').toLowerCase()}${a.gapBefore === true ? ' · across a gap' : ''}` || null, `${SCAN_EVENT_TEXT[a.eventType || 'MATCH']}${gap}`));
  f1.append(scanFact('Detected', scanStamp(a.detectedAt || a.recordedAt), a.runId ? `run ${a.runId}${a.origin ? ` · ${a.origin}` : ''}` : legacy ? nr : null));
  c1.append(f1);
  wrap.append(c1);

  /* ---- the setup version ---- */
  const c2 = el('div', { class: 'card' });
  const st = scanStoreRead();
  const rec = st.setups[a.setupId];
  const cur = rec ? scanRecordSetup(rec) : null;
  const heldV = rec ? scanVersionOf(rec, version) : null;
  c2.append(cardHead('The setup that recorded it', 'The version is the one in force when the bar was evaluated; later edits do not change it.'));
  const origin = scanBotOrigin(a.setupId);
  if (origin) c2.append(el('p', { class: 'caption scan-note scan-bot-origin', style: 'margin:0 0 var(--sm)' }, scanBotOriginText(origin)));
  const f2 = el('div', { class: 'scan-facts' });
  f2.append(scanFact('Setup', scanLink(scanSetupPath(a.setupId), a.setupName || a.setupId), `id ${a.setupId}`));
  f2.append(scanFact('Version', version != null ? scanLink(scanSetupPath(a.setupId, version), `v${version}`) : null,
    [a.setupHash ? `hash ${a.setupHash}` : null, legacy ? 'a 0.2 record — read as version 1' : null,
     cur ? (cur.version === version && (!a.setupHash || cur.hash === a.setupHash) ? 'still the current version' : `the setup is now v${cur.version}`) : 'not saved in this browser'].filter(Boolean).join(' · ')));
  f2.append(scanFact('Recording', a.cooldownMode ? (a.cooldownMode === 'NEW_MATCH' ? 'New match' : 'Every match') : nr));
  const snap = a.setupSnapshot ? scanNormaliseSetup({ ...a.setupSnapshot, id: a.setupId }) : heldV ? scanRecordSetup(rec, version) : null;
  /* Where the worker took a watchlist's members from on that run (C2's
     universeResolvedFrom): the snapshot the setup carried, or the export
     it read. */
  const urf = a.universeResolvedFrom && typeof a.universeResolvedFrom === 'object' ? a.universeResolvedFrom : null;
  if (urf || snap?.universe?.kind === 'watchlist') f2.append(scanFact('Universe resolved from',
    urf ? (urf.source === 'export' ? `your export of ${scanStamp(urf.exportedAt)}` : `the snapshot of ${urf.asOf || '?'}`) : null,
    urf ? (urf.source === 'export' ? 'data/watchlists.json as the worker read it at run time — the list as of that export, not as it stands in this browser' : 'the symbols the setup carried; the list was not taken from an export on that run')
      : 'The record does not say whether the worker read the snapshot or an export.'));
  c2.append(f2);
  if (snap) {
    c2.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, `Universe: ${scanUniverseProse(snap.universe)}${a.setupSnapshot ? '' : ' (from the version held in this browser; the record carries no snapshot)'}.`));
    c2.append(scanTreeList(snap.ruleTree, snap.timeframe));
  }
  /* The setup behind this record, as a new draft (C5's ?fromAlert=). */
  const build = `/app/scanner/setups/new?fromAlert=${encodeURIComponent(id)}${clash ? `&key=${encodeURIComponent(a.key ?? '')}` : ''}`;
  c2.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center;margin-top:var(--sm)' }, snap
    ? [scanLink(build, 'Build a setup from this one', { class: 'btn btn-ghost btn-sm' }), el('span', { class: 'caption' }, 'A copy of these conditions in the builder, under a new id. The setup and this record are unchanged.')]
    : [el('span', { class: 'caption' }, `No copy of the setup to build from: the record carries none, and this browser does not hold v${version ?? '?'} of ${a.setupId}.`)]));
  wrap.append(c2);

  /* ---- every condition, with its values ---- */
  const c3 = el('div', { class: 'card' });
  const mc = Array.isArray(a.matchedConditions) ? a.matchedConditions : null;
  c3.append(cardHead('Every condition, with its values', mc ? `${prefs.precision === 'full' ? 'Values as the engine computed them, to twelve significant digits' : 'Values rounded as the tables round them'} — the display is set in the scanner settings.` : 'This record carries each condition’s text and whether it held, but not its values: it predates engine 0.3.0.'));
  const t = el('table', { class: 'dt' });
  t.append(el('caption', { class: 'sr-only' }, 'Conditions evaluated on this bar'));
  if (mc) {
    /* Each condition with the bar it was read on (B3): the alert's own,
       or — for a condition on a higher timeframe — the weekly or monthly
       bar that had closed by then, which the record dates. */
    if (mc.some(c => scanReadOn(c, a).other)) c3.append(el('p', { class: 'caption', style: 'margin:0 0 6px;max-width:72ch' }, `Some conditions read a higher timeframe than the setup’s ${scanTfWord(a.timeframe)} bars: each on that timeframe’s last closed bar as of ${bar}, dated in “Read on” by its last session.`));
    t.append(el('thead', {}, el('tr', {}, ['Path', 'Condition', 'State', 'Left', 'Right', 'Read on', 'Status'].map(h => el('th', { scope: 'col', class: h === 'Left' || h === 'Right' ? 'num' : null }, h)))));
    /* Both sides of a condition round together and in its left side's
       unit, as the engine's sentence beside them prints them. */
    t.append(el('tbody', {}, mc.map(c => { const fv = scanValuesFmt([c.left, c.right], prefs, scanCondUnit(a.setupSnapshot?.ruleTree, c.path)); const ro = scanReadOn(c, a); return el('tr', {}, [
      el('td', { class: 'ident' }, c.path || '—'),
      el('td', { style: 'text-align:left;white-space:normal;min-width:200px' }, c.text || '—'),
      el('td', {}, el('span', { class: `chip ${c.state === 'MET' ? 'chip-ok' : c.state === 'UNAVAILABLE' ? 'chip-warn' : ''}` }, String(c.state || '—').replace('_', ' ').toLowerCase())),
      el('td', { class: 'num', style: 'white-space:normal' }, [el('span', { class: 'caption', style: 'display:block' }, c.leftLabel || ''), Array.isArray(c.left) ? c.left.map(fv).join(' → ') : fv(c.left)]),
      el('td', { class: 'num', style: 'white-space:normal' }, [el('span', { class: 'caption', style: 'display:block' }, c.rightLabel || ''), Array.isArray(c.right) ? c.right.map(fv).join(' – ') : fv(c.right)]),
      el('td', { class: ro.other ? 'scan-read-on scan-read-other' : 'scan-read-on', style: 'text-align:left;white-space:normal' }, [el('span', { style: 'display:block;font-weight:600' }, SCAN_TIMEFRAMES[ro.tf]?.label || ro.tf), el('span', { class: 'caption' }, ro.date ? `bar closing ${ro.date}` : 'bar not dated on the record')]),
      el('td', { class: 'caption', style: 'text-align:left' }, `${String(c.status || '').replace('_', ' ').toLowerCase()}${c.reason ? ` · ${c.reason}` : ''}`),
    ]); })));
  } else {
    t.append(el('thead', {}, el('tr', {}, ['Condition', 'Held'].map(h => el('th', { scope: 'col' }, h)))));
    t.append(el('tbody', {}, (a.rules || []).map(r => el('tr', {}, [el('td', { style: 'text-align:left;white-space:normal' }, r.text || '—'), el('td', {}, r.met === true ? 'yes' : r.met === false ? 'no' : 'untested')]))));
  }
  c3.append(el('div', { class: 'tablewrap' }, t));
  wrap.append(c3);

  /* ---- the closes up to it, and the bar evaluated again ---- */
  const c5 = el('div', { class: 'card' });
  c5.append(cardHead('Evaluated again', 'The closes up to this bar and no further, and the same conditions on the history as it is loaded now, cut at the bar.'));
  /* The sparkline draws the cut series only, so no close after the bar is
     on it; the text beside it says what it shows, for anyone who cannot
     see the line. */
  if (rep.bars && rep.at >= 1 && rep.bars.dates[rep.at] === bar) {
    const n = Math.min(60, rep.at + 1), from = rep.at + 1 - n;
    const cl = rep.bars.closes.slice(from, rep.at + 1);
    const sp = sparkline(cl, { w: 360, h: 72 });
    sp.setAttribute('style', 'width:100%;max-width:360px;height:auto;display:block');
    sp.classList.add('scan-spark');
    const lo = Math.min(...cl.filter(isNum)), hi = Math.max(...cl.filter(isNum));
    const fc = scanValuesFmt([lo, hi, cl[cl.length - 1]], prefs, 'price');
    c5.append(el('figure', { class: 'row row-wrap', style: 'gap:var(--sm) var(--lg);align-items:center;margin:0' }, [
      el('div', { style: 'flex:1 1 260px;max-width:360px;min-width:0' }, sp),
      el('figcaption', { class: 'caption', style: 'flex:1 1 240px;max-width:60ch;margin:0' }, `Closes of the ${scanPlural(n, `${scanTimeframe(a.timeframe) === '1W' ? 'weekly' : scanTimeframe(a.timeframe) === '1M' ? 'monthly' : 'daily'} bar`)} up to and including ${bar}${from > 0 ? ` (the last ${n} of ${rep.at + 1} held)` : ''}, from the history as loaded — nothing after the bar is drawn. Lowest ${fc(lo)}, highest ${fc(hi)}; the marked point is ${bar}, at ${fc(cl[cl.length - 1])}.`),
    ]));
  } else c5.append(el('p', { class: 'caption' }, rep.state === 'NO_HISTORY' || rep.state === 'NO_SERIES' || rep.state === 'NO_BAR' ? 'No closes are drawn: ' + rep.text.charAt(0).toLowerCase() + rep.text.slice(1) : 'Fewer than two bars are held up to this one, so no line is drawn.'));
  const verdict = el('p', { class: `scan-reproduce scan-note${rep.state === 'REPRODUCES' ? '' : ' scan-warn'}`, role: 'status', style: 'margin-top:var(--sm)' }, rep.text);
  c5.append(verdict);
  if (rep.values.length) c5.append(el('ul', { class: 'rulelist' }, rep.values.map(v => el('li', { class: 'caption' }, `${v.path}: recorded “${v.text}”; now “${v.now}”`))));
  if (rep.bars) {
    /* Each line's two closes round together, so a close that moved never
       reads as the one it moved from. */
    const pair = (x) => { const f = scanValuesFmt([x.recorded, x.now], prefs, 'price'); return [x.recorded, x.now].map(v => (isNum(v) ? f(v) : 'not held')); };
    c5.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, rep.closes.length
      ? `${scanPlural(rep.closes.length, 'bar')} up to ${bar} ${rep.closes.length === 1 ? 'has a close' : 'have closes'} that differ from the record:`
      : `No close the record holds for ${a.symbol} up to ${bar} differs from the history, and its corrections log names none changed since this was detected.`));
    if (rep.closes.length) c5.append(el('ul', { class: 'rulelist scan-close-diffs' }, rep.closes.slice(0, 20).map(x => { const [was, is] = pair(x); return el('li', { class: 'caption' }, x.via === 'record'
      ? `${x.date} — recorded ${was}, now ${is}`
      : `${x.date} — corrected${x.at ? ` ${scanStamp(x.at)}` : ' (time not recorded)'}${x.src ? ` by ${x.src}` : ''}, from ${was} to ${is}`); })));
    if (rep.closes.length > 20) c5.append(el('p', { class: 'caption' }, `Showing the latest 20 of ${rep.closes.length}.`));
  }
  wrap.append(c5);

  /* ---- the data behind it ---- */
  const c4 = el('div', { class: 'card' });
  c4.append(cardHead('The data behind it', 'Where the bar came from, and whether the history still holds it as it was.'));
  const f4 = el('div', { class: 'scan-facts' });
  f4.append(scanFact('Data source', a.dataSourceId || nr, a.dataSourceId ? 'as the history names it — per bar where it records one, otherwise for the whole file' : null));
  f4.append(scanFact('Data version', a.dataVersion || nr, a.dataVersion ? 'a hash of every bar up to this one — date, open, high, low, close, volume and status' : null));
  /* C2's historyGenerated: the history file's own stamp when the worker
     read it — file-level provenance, labelled as such. */
  f4.append(scanFact('History file', a.historyGenerated ? scanStamp(a.historyGenerated) : null, a.historyGenerated ? 'when data/price-history.json was generated, as the worker read it — the whole file’s stamp, not this bar’s' : 'The record does not carry the history file’s generated time.'));
  /* The same bars now: the dataset's version recomputed from the history as
     loaded, up to this bar. Equal means the evidence is unchanged; not equal
     names that the history moved — the closes above say where, when the
     record can tell. */
  let now = null;
  if (scanHistoryFile?.series?.[a.symbol] && a.dataVersion) {
    /* Read as the run read it: the same market, the same inferred calendar,
       and the clock of the moment it was detected. */
    const reg = scanRegistryList();
    const mkt = 'market' in a ? a.market : scanMarketOf(a.symbol, reg);
    const bars = scanBars(scanHistoryFile, a.symbol, { timeframe: scanTimeframe(a.timeframe), market: mkt, instruments: reg, now: a.detectedAt || null,
      calendar: scanCalendar(scanHistoryFile, reg, mkt) });
    const at = bars.dates.indexOf(bar);
    now = at < 0 ? { text: `The history no longer holds the ${bar} bar for ${a.symbol}.`, same: false } : (() => {
      const v = scanDataVersion(bars, at);
      return v === a.dataVersion ? { text: `Recomputed from data/price-history.json as loaded: ${v} — the bars up to ${bar} are as they were when this was recorded.`, same: true }
        : { text: `Recomputed from data/price-history.json as loaded: ${v}, not ${a.dataVersion} — the history up to ${bar} has changed since this was recorded (a correction, an import or a trim).`, same: false };
    })();
  }
  f4.append(scanFact('The same bars now', now ? (now.same ? 'unchanged' : 'changed') : null, now ? now.text : !scanHistoryFile ? 'The price history is not loaded here.' : legacy ? nr : `The history holds no series ${a.symbol}.`));
  f4.append(scanFact('Engine', a.engine || null));
  /* The run that recorded it, where the worker's run log is loaded. */
  const runsDoc = typeof scanRunsFile !== 'undefined' ? scanRunsFile : null;
  const runs = Array.isArray(runsDoc) ? runsDoc : Array.isArray(runsDoc?.runs) ? runsDoc.runs : null;
  const run = runs && a.runId ? runs.find(r => r?.id === a.runId) : null;
  f4.append(scanFact('Run', a.runId || (legacy ? nr : null), run ? `${run.status || '?'}${run.trigger ? ` · ${run.trigger}` : ''} · started ${scanStamp(run.startedAt)}` : runs ? 'not in the loaded run log' : 'the run log (data/scan-runs.json) is not loaded'));
  c4.append(f4);
  const lineage = el('ol', { class: 'scan-lineage' }, [
    el('li', {}, `data/price-history.json${a.historyGenerated ? `, generated ${scanStamp(a.historyGenerated)} when this was evaluated` : scanHistoryFile?.generated ? `, generated ${scanStamp(scanHistoryFile.generated)} as loaded now` : ''}${scanHistoryFile?.source ? `, source “${scanHistoryFile.source}”` : ''}`),
    el('li', {}, `series ${a.symbol}${a.instrumentId && a.instrumentId !== a.symbol ? ` (${a.instrumentId})` : ''}, ${SCAN_TIMEFRAMES[scanTimeframe(a.timeframe)]?.label?.toLowerCase() || 'daily'} bars up to ${bar}${a.dataVersion ? ` — data version ${a.dataVersion}` : ''}`),
    el('li', {}, `engine ${a.engine || '?'} evaluated setup ${a.setupId} v${version ?? '?'}${a.runId ? ` in run ${a.runId}` : ''}${urf ? `, its list resolved from ${urf.source === 'export' ? `the export of ${scanStamp(urf.exportedAt)}` : `its snapshot of ${urf.asOf || '?'}`}` : ''}`),
    el('li', {}, 'written to data/scan-alerts.json; read here. Nothing was sent.'),
  ]);
  c4.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Lineage'));
  c4.append(lineage);
  wrap.append(c4);
  wrap.append(el('p', { class: 'caption' }, [scanLink('/app/scanner/alerts', 'All alerts'), ` · id ${id}${a.key ? ` · key ${a.key}` : ''}`]));
  return wrap;
};

/* =====================================================================
   /app/scanner/settings
   ===================================================================== */
const SCAN_CHANNELS = [
  { id: 'EMAIL', label: 'Email', why: 'No server, and no contact address is held under a privacy notice. Delivery by email waits on an operating entity and a backend.' },
  { id: 'TELEGRAM', label: 'Telegram', why: 'A Telegram bot token has to live on a server, and there is none.' },
  { id: 'PUSH', label: 'Push', why: 'Push needs a push service and a live scanner; neither exists in this build.' },
];
VIEWS.scannerSettings = () => {
  const wrap = scanPage();
  wrap.append(scanSubnav('settings'));
  wrap.append(scanPageHead('Scanner settings', 'Notifications and display, kept in this browser. The in-app notification centre is the alerts page and its unread count; nothing is sent anywhere.'));
  const prefs = scanPrefsRead();
  const deliveries = typeof scanDeliveriesFile !== 'undefined' ? scanDeliveriesFile : null;

  /* ---- notifications ---- */
  const c1 = el('div', { class: 'card' });
  c1.append(cardHead('Notifications', 'One channel exists: in the app. The others are listed with why they are not there, not as switches that do nothing.'));
  const inApp = el('div', { class: 'panel' });
  inApp.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [el('span', { style: 'font-weight:600' }, 'In the app'), el('span', { class: 'chip chip-ok' }, 'on')]));
  inApp.append(el('p', { class: 'caption', style: 'margin-top:4px' }, ['Every recorded match appears on the ', scanLink('/app/scanner/alerts', 'alerts page'), ` the next time this page loads the worker’s file. ${scanAlertsFile ? '' : 'That file cannot be seen from here, so there is nothing to count. '}The count of unread matches is per browser.`]));
  const lab = el('label', { class: 'checkline', style: 'gap:8px;margin-top:6px' });
  lab.append(el('input', { type: 'checkbox', checked: prefs.inApp !== false ? '' : null, 'aria-label': 'Show the unread count in the navigation', onchange: e => { scanPrefsWrite({ inApp: e.target.checked }); scanRender(); } }));
  lab.append(el('span', {}, 'Show the unread count in the navigation'));
  inApp.append(lab);
  const ids = [...new Set([...scanBrowserSetups().map(s => s.id), ...scanAlertList().map(a => a.setupId).filter(Boolean)])];
  if (ids.length) {
    const fs = el('fieldset', { class: 'scan-radios', style: 'margin-top:var(--sm)' });
    fs.append(el('legend', {}, 'Count unread matches from'));
    ids.forEach(id => {
      const l = el('label', { class: 'checkline', style: 'gap:8px' });
      l.append(el('input', { type: 'checkbox', checked: prefs.muted[id] ? null : '', disabled: prefs.inApp === false ? '' : null, 'aria-label': `Count unread matches from ${id}`, onchange: e => {
        const m = { ...scanPrefsRead().muted }; if (e.target.checked) delete m[id]; else m[id] = true; scanPrefsWrite({ muted: m }); scanRender();
      } }));
      l.append(el('span', {}, scanStoreRead().setups[id]?.name || scanAlertList().find(a => a.setupId === id)?.setupName || id));
      fs.append(l);
    });
    inApp.append(fs);
  }
  c1.append(inApp);
  SCAN_CHANNELS.forEach(ch => {
    const rec = deliveries?.channels?.[ch.id];
    const p = el('div', { class: 'panel', style: 'margin-top:var(--sm)' });
    p.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [el('span', { style: 'font-weight:600' }, ch.label), el('span', { class: 'chip chip-bronze' }, rec?.status ? String(rec.status).replace('_', ' ').toLowerCase() : 'not configured')]));
    p.append(el('p', { class: 'caption', style: 'margin-top:4px' }, rec?.why || ch.why));
    c1.append(p);
  });
  c1.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, deliveries
    ? `Channel states read from data/scan-deliveries.json${deliveries.generated ? `, written ${scanStamp(deliveries.generated)}` : ''}.`
    : 'The worker’s delivery record (data/scan-deliveries.json) is not loaded here; the reasons above are this build’s.'));
  wrap.append(c1);

  /* ---- display ---- */
  const c2 = el('div', { class: 'card' });
  c2.append(cardHead('Display', 'How the scanner pages show what they show. Nothing here changes a setup or a record.'));
  const g = el('div', { class: 'grid g-3 scan-grid' });
  const pick = (label, val, opts, key, conv = (x) => x) => {
    const id = `scanf-${++scanFieldSeq}`;
    const s = el('select', { class: 'select', id, 'aria-label': label, onchange: e => { scanPrefsWrite({ [key]: conv(e.target.value) }); toast('Saved in this browser'); scanRender(); } });
    opts.forEach(([v, l]) => s.append(el('option', { value: v, selected: String(val) === String(v) ? '' : null }, l)));
    return el('div', { class: 'field' }, [el('label', { for: id }, label), s]);
  };
  g.append(pick('Alerts per page', prefs.pageSize, [[25, '25'], [50, '50'], [100, '100'], [200, '200']], 'pageSize', Number));
  g.append(pick('Alerts shown by default', prefs.statusFilter, [['OPEN', 'New and read'], ['NEW', 'New only'], ['ALL', 'All, archived included']], 'statusFilter'));
  g.append(pick('Recorded values', prefs.precision, [['full', 'As computed — twelve significant digits'], ['rounded', 'Rounded as the tables round']], 'precision'));
  c2.append(g);
  wrap.append(c2);
  wrap.append(el('p', { class: 'caption' }, 'Kept under scanPrefs, scanAlertState and scanSetups in this browser’s storage, and carried by the export on the Your data page. A second device keeps its own.'));
  return wrap;
};
