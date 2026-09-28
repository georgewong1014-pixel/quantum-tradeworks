/* ==========================================================================
   QUANTUM SCANNER — DASHBOARD, SCREENING, SIMULATION AND OPERATIONS
   (Phase 3: SC-312, SC-313, SC-314's page, SC-316; docs/phase3-plan.md)

   Seven pages that READ what the worker recorded and run the one engine
   (24-market-engine.js) on the reader's own history. None of them is a
   second source of truth: the dashboard's four answers come from the run
   log and the alerts file through scanStatus, never from a scan this page
   ran and presented as the worker's.

   A STALE RESULT IS NEVER CALLED CURRENT. The dashboard shows the state the
   records support — current, behind, failed, paused, or no run recorded —
   with every reason dated, and the matches of an old scan sit under a
   heading that says they are not current.

   SCREENING IS OF YOUR OWN SERIES, IN SYMBOL ORDER. A market screen runs a
   setup over the instruments of a market that have a series in the reader's
   history — not the market — and lists them alphabetically. No order by any
   value is offered, because a list ordered by strength is a pick list.

   HISTORICAL TESTING IS A SIMULATION OF DATES. It lists the bars on which the
   conditions held and the values that made them hold. It has no entry, exit,
   cost or return, so it can say nothing about performance, and it says so.

   OPERATIONS HAS NO ADMINISTRATOR. There are no accounts, so there is no
   role to gate /admin/scanner with: the four pages are read-only views of
   this machine's worker files, identical for anyone who opens them, and
   empty on the deployed site. Every control is the command that performs it,
   run where the worker runs.
   ========================================================================== */

/* ------------------------------------------------------------------ files -- */
/* The worker's operations files, loaded with the other scanner files in
   25-universe.js (loadRealData). Each is optional and git-ignored:
     data/scan-runs.json        { schema, runs: [ScanRun], audit: [control] }
     data/scan-control.json     { paused, since, reason }
     data/scan-deliveries.json  { schema, channels, deliveries: [delivery] }
     data/ingest-runs.json      { schema, runs: [{ startedAt, status, steps }] }
   Another page reads them only through a guard —
   typeof scanRunsFile !== 'undefined' ? scanRunsFile : null — and says "not
   loaded" when the guard gives null. `scanOpsRead` is whether the load has
   tried yet, so "absent" is never said about a file still on its way. */
let scanRunsFile = null, scanControlFile = null, scanDeliveriesFile = null, ingestRunsFile = null;
let scanOpsRead = false;
/* Files the reader opened from their own disk in this tab ("Open your
   files"), by name — held in memory only, and listed where they are used. */
let scanOpsOpened = [];
/* The clock the pages judge staleness by. null is the real clock; a check
   pins it so a fixture's state does not drift with the calendar. */
let scanOpsClock = null;
const scanOpsNow = () => scanOpsClock || new Date().toISOString();

/* The page files of 86-scanner.js, read through the same guard the other
   builders' pages use for these four, so this file never throws in a build
   that renamed one. */
const scanOpsAlertsDoc = () => (typeof scanAlertsFile !== 'undefined' ? scanAlertsFile : null);
const scanOpsSetupsDoc = () => (typeof scanSetupsFile !== 'undefined' ? scanSetupsFile : null);
const scanOpsHistory = () => (typeof scanHistoryFile !== 'undefined' ? scanHistoryFile : null);
const scanOpsRegistry = () => (typeof instruments !== 'undefined' && instruments?.instruments) || [];

/* The run log read defensively: scan runs, newest first, and the control
   log — the file's `audit` list, plus any control entry written into `runs`
   (the plan allows either). An entry that is not an object is dropped, and
   counted, rather than breaking the page. */
function scanOpsRuns() {
  const f = scanRunsFile;
  const raw = Array.isArray(f) ? f : Array.isArray(f?.runs) ? f.runs : [];
  const ok = raw.filter(r => r && typeof r === 'object');
  const at = (r) => String(r.startedAt || r.at || '');
  const runs = ok.filter(r => (r.kind || 'scan') === 'scan').sort((a, b) => at(b).localeCompare(at(a)));
  const audit = [...(Array.isArray(f?.audit) ? f.audit.filter(a => a && typeof a === 'object') : []), ...ok.filter(r => r.kind === 'control')]
    .sort((a, b) => at(b).localeCompare(at(a)));
  return { runs, audit, dropped: raw.length - ok.length, file: !!f };
}
/* What scanStatus needs to know about the history: when it was written, its
   newest bar and its symbols. The newest bar is read off the series, since
   `generated` is when the file was written, not what it holds. */
function scanOpsHistoryMeta(h) {
  if (!h?.series) return null;
  let newestBar = null;
  const symbols = Object.keys(h.series);
  symbols.forEach(sym => {
    const keys = Object.keys(h.series[sym] || {}).filter(scanIsDay);
    for (const d of keys) if (!newestBar || d > newestBar) newestBar = d;
  });
  return { generated: h.generated || null, newestBar, symbols };
}
/* The four answers, from the records. */
function scanOpsStatus() {
  return scanStatus({ runs: scanRunsFile, alertsDoc: scanOpsAlertsDoc(), setupsDoc: scanOpsSetupsDoc(),
    historyMeta: scanOpsHistoryMeta(scanOpsHistory()), control: scanControlFile, now: scanOpsNow(),
    instruments: scanOpsRegistry(), alertState: null });
}
/* The setups the worker refuses, and the problems it refuses them for,
   read off scanStatus's `active` — the counts --status prints — never
   counted again here. This page counted the ids the problems were keyed
   under, and two entries sharing an id are keyed once though the worker
   refuses both: a file of [a, a, b] read "1 setup refused, for 2 problems"
   beside --status's "2 refused". A setup refused for two problems is still
   one setup (the engine counts entries, not problems). A file that is not
   a list is refused whole, and how many setups it meant to hold is not
   known: refused is null there, and the reason is `file`. */
const scanOpsRefused = (active) => ({ setups: active?.refused ?? null, problems: active?.problems ?? 0, file: active?.fileRefused || null });
/* The alerts pages' unread count, guarded: null when that function is not
   in this build, or when it has no alerts file to count. */
function scanOpsUnread() {
  if (typeof scanUnreadCount !== 'function') return null;
  try { const n = scanUnreadCount(); return Number.isInteger(n) ? n : null; } catch { return null; }
}

/* ----------------------------------------------------------------- pieces -- */
/* A close, as the engine prints a price: never shortened, at the decimals
   it is quoted in, two to four (the alerts pages' scanPriceText, from the
   engine's own functions so this file stands without them). scanFmt's
   defaults are a volume's: a screened close of 0.345 read 0.34 beside the
   condition "price 0.345 below 0.500", and 45,120.5 read 45.1k. */
const scanOpsPrice = (v) => (isNum(v) ? scanFmt(v, Math.max(2, Math.min(4, scanDecimals(v))), false) : '—');
const scanOpsDay = (t) => (t ? String(t).slice(0, 10) : '—');
const scanOpsWhen = (t) => (t ? `${String(t).replace('T', ' ').slice(0, 16)} UTC` : '—');
/* How long ago, in calendar days of the same UTC date scanOpsDay prints
   beside it. Counted in elapsed 24-hour spans, a run at 23:00 read at
   01:00 the next day was "today" next to yesterday's date. A time after
   the page's clock has no age. */
const scanOpsAge = (t) => {
  const a = t ? String(t).slice(0, 10) : '', b = scanOpsNow().slice(0, 10);
  if (!scanIsDay(a) || !scanIsDay(b)) return null;
  const d = scanDayDiff(a, b);
  return d < 0 ? null : d === 0 ? 'today' : d === 1 ? 'a day ago' : `${d} days ago`;
};
/* A duration, rounded once at the unit it is shown in. Each part was
   rounded on its own after the unit was chosen, so 119.6 s read "1 min
   60 s", 59.96 s "60.0 s" and 999.6 ms "1000 ms". */
const scanOpsDuration = (ms) => {
  if (!Number.isFinite(ms)) return '—';
  if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};
const scanOpsPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/* Shows or hides a node. The hidden attribute alone loses to any author
   display — .btn sets one, and so does a scanner table row on a phone — so
   the screen's and the simulation's Cancel, meant only for a run in
   progress, was on screen all the time. The inline display wins; the
   attribute keeps the meaning for assistive technology. */
const scanOpsShow = (node, on) => { node.hidden = !on; node.style.display = on ? '' : 'none'; return node; };

function scanOpsLink(path, label, attrs = {}) {
  return el('a', { href: href(path), ...attrs, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(path); } }, label);
}
/* An alert's own page, by its id — 'a' + the hash of its key, so the
   address never carries a dotted symbol. A 0.2 record with neither has no
   page, and is shown as text. */
function scanOpsAlertLink(a, label) {
  const id = a?.id || (a?.key ? scanAlertId(a.key) : null);
  return id ? scanOpsLink(`/app/scanner/alerts/${id}`, label) : el('span', {}, label);
}

/* The scanner's own sections. Shared by every scanner page, the setups
   batch's included: scannerSubnav('dashboard' | 'market' | 'setups' |
   'watchlists' | 'alerts' | 'backtest' | 'settings'). The operations pages
   are not in it — they are the worker's, reached from the dashboard. */
const SCANNER_SUBNAV = [
  { id: 'dashboard',  label: 'Dashboard',            path: '/app/scanner' },
  { id: 'market',     label: 'Market (your series)', path: '/app/scanner/market' },
  { id: 'setups',     label: 'Setups',               path: '/app/scanner/setups' },
  { id: 'watchlists', label: 'Watchlists',           path: '/app/scanner/watchlists' },
  { id: 'alerts',     label: 'Alerts',               path: '/app/scanner/alerts' },
  { id: 'backtest',   label: 'Historical',           path: '/app/scanner/backtest' },
  { id: 'settings',   label: 'Settings',             path: '/app/scanner/settings' },
];
/* The Alerts link carries the unread count — "Alerts · n", named "Alerts,
   n unread" — as the alerts pages' own strip did (SC-309 as built). This
   strip replaces that one on every scanner page and had dropped it, so the
   main navigation read "Scanner 24" over a strip that read only "Alerts".
   No count when nothing is counted (no alerts file, in-app off) or none is
   unread, as the main navigation's badge. */
function scannerSubnav(active) {
  const row = el('nav', { class: 'segmented scan-subnav', 'aria-label': 'Scanner sections' });
  const unread = scanOpsUnread();
  SCANNER_SUBNAV.forEach(s => {
    const n = s.id === 'alerts' && unread > 0 ? unread : 0;
    row.append(scanOpsLink(s.path, n ? `${s.label} · ${n}` : s.label, {
      'aria-selected': active === s.id ? 'true' : 'false', 'aria-current': active === s.id ? 'page' : null, 'aria-label': n ? `${s.label}, ${n} unread` : null }));
  });
  return row;
}
const SCANNER_OPS_NAV = [
  { id: 'overview', label: 'Overview',    path: '/admin/scanner' },
  { id: 'data',     label: 'Data health', path: '/admin/scanner/data' },
  { id: 'jobs',     label: 'Runs',        path: '/admin/scanner/jobs' },
  { id: 'delivery', label: 'Delivery',    path: '/admin/scanner/delivery' },
];
function scanOpsSubnav(active) {
  const row = el('nav', { class: 'segmented scan-subnav', 'aria-label': 'Operations sections' });
  SCANNER_OPS_NAV.forEach(s => row.append(scanOpsLink(s.path, s.label, {
    'aria-selected': active === s.id ? 'true' : 'false', 'aria-current': active === s.id ? 'page' : null })));
  return row;
}
function scanOpsHead(eyebrow, title, lead) {
  return el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, eyebrow),
    el('h1', {}, title),
    lead ? el('p', { class: 'body-lg', style: 'margin-top:8px;max-width:72ch' }, lead) : null,
  ]));
}
/* Every operations page opens with this, before anything that could be
   read as supervision. */
function scanOpsNotice() {
  return el('div', { class: 'scan-notice', role: 'note', 'aria-label': 'Operations: read-only' }, [
    el('p', { class: 'scan-notice-hd' }, [el('span', { class: 'chip chip-bronze' }, 'Read-only'), el('strong', {}, 'Operations — a read-only view of this machine’s scanner worker.')]),
    el('p', {}, 'There is no administrator role: this build has no accounts, so anyone who opens this address sees this page, and on the deployed site it has nothing to show, because the worker’s files never leave the machine that runs it. Nothing here can change anything. Each control is the command that performs it, run where the worker runs, and the worker writes it to its own log — an append-only local file, not an audit trail with an identity behind it.'),
  ]);
}
/* A command, copyable, with what it does. */
function scanOpsCmd(cmd, what) {
  const code = el('code', { class: 'scan-cmd-code' }, cmd);
  return el('div', { class: 'scan-cmd' }, [
    el('div', { class: 'scan-cmd-row' }, [code,
      el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Copy the command ${cmd}`, onclick: async () => {
        try { await navigator.clipboard.writeText(cmd); toast('Command copied — run it where the worker runs'); }
        catch { toast('Could not reach the clipboard — select the command and copy it'); }
      } }, 'Copy')]),
    what ? el('p', { class: 'metaline' }, what) : null,
  ]);
}
/* A file this page reads, and what its absence means. Absent before the
   load has tried is "not loaded yet", never "absent". */
function scanOpsFileState(name, doc, madeBy) {
  const opened = scanOpsOpened.find(o => o.as === name);
  if (doc) return el('p', { class: 'metaline' }, `data/${name} — ${opened ? `opened from your disk (${opened.name}), in this tab only` : 'read from this machine'}.`);
  const failed = typeof realStatus !== 'undefined' && realStatus && !realStatus.ok;
  return el('p', { class: 'metaline' }, !scanOpsRead
    ? `data/${name} — not loaded: ${failed ? 'the data load stopped before the scanner’s files were read' : 'the data load has not reached it yet'}.`
    : `data/${name} — absent. ${madeBy} It is git-ignored and never deployed, so the deployed site never has it.`);
}

/* The state, as a chip with a label (never colour alone) and a headline. */
const SCAN_STATE = {
  current: { sev: 'good',     label: 'Current',         head: 'The last scan is current.' },
  behind:  { sev: 'warning',  label: 'Behind',          head: 'The last scan is behind — its result is not current.' },
  failed:  { sev: 'critical', label: 'Failed',          head: 'The latest scan failed.' },
  paused:  { sev: 'serious',  label: 'Paused',          head: 'The worker is paused.' },
  never:   { sev: 'info',     label: 'No run recorded', head: 'No scan has been recorded on this machine.' },
};
const SCAN_RUN_STATUS = {
  COMPLETED: ['good', 'completed'], PARTIAL: ['warning', 'partial'], FAILED: ['critical', 'failed'], CANCELLED: ['info', 'cancelled'],
  /* The worker writes SKIPPED_NO_DATA for no history, no bar on or before a
     replay's date, and inputs unchanged since the last run — "no history"
     misread the last, the commonest. The run's own reason says which. */
  SKIPPED_NO_DATA: ['info', 'skipped — no new data'], SKIPPED_NO_SETUPS: ['info', 'skipped — no setups'],
  SKIPPED_LOCKED: ['warning', 'skipped — another run held the lock'], SKIPPED_PAUSED: ['info', 'skipped — paused'],
  RUNNING: ['info', 'running'], PENDING: ['info', 'pending'],
};
const scanRunChip = (s) => sevChip((SCAN_RUN_STATUS[s] || ['info'])[0], (SCAN_RUN_STATUS[s] || [null, s ? String(s).toLowerCase().replace(/_/g, ' ') : 'no status'])[1]);

/* THE RUN RECORD AS THE WORKER WRITES IT (scanner/scan.mjs makeRun, and the
   round 3 contract C4). The counts are nested in run.counts; readiness is a
   plain array of { market, state, expected, newestFinal, inRun, text };
   every problem is an entry of errors[] ({ category, message, setup?,
   correlationId }); the history is historyHash and historyNewest at the
   top; stale and provisional are counts. The alerts file's lastRun keeps
   the older flat form — counts at the top, problems and stale as lists.
   These pages first read the plan's shape, which no worker ever wrote, so
   with a real run log every count, the history and the problems read "not
   recorded". Each reader below takes either form, and an absent figure is
   still said to be absent, never shown as zero. */
const scanOpsN = (v) => (Number.isFinite(v) ? v : Array.isArray(v) ? v.length : null);
function scanRunCounts(r) {
  const c = r?.counts && typeof r.counts === 'object' ? r.counts : r || {};
  const k = r?.skippedByReason || {};
  const n = scanOpsN;
  return { setups: n(c.setups), evaluated: n(c.evaluated), matched: n(c.matched), recorded: n(c.recorded), untested: n(c.untested),
           deduped: n(c.deduped ?? k.alreadyRecorded), cooldown: n(c.cooldown ?? k.cooldown), continuing: n(c.continuing),
           skipped: n(c.skipped), problems: n(c.problems), untestedEverywhere: n(c.untestedEverywhere), deliveries: n(c.deliveries),
           stale: n(r?.stale), provisional: n(r?.provisional) };
}
const scanRunError = (r) => (r?.error ? { category: r.error.category || r.error.code || 'error', code: r.error.code || null,
  message: r.error.message || String(r.error), correlation: r.error.correlationId || r.id || null } : null);
/* Every problem the run recorded, in the order it recorded them. The
   worker's errors[] when there is one; otherwise the single error, and the
   flat form's refused setups and untested-everywhere list. */
function scanRunProblems(r) {
  if (Array.isArray(r?.errors) && r.errors.length) return r.errors.filter(e => e && typeof e === 'object')
    .map(e => ({ category: e.category || 'error', message: e.message || '(no message)', setup: e.setup || null, correlation: e.correlationId || null }));
  const out = [];
  const e = scanRunError(r);
  if (e) out.push({ category: e.category, message: e.message, setup: null, correlation: e.correlation });
  (Array.isArray(r?.problems) ? r.problems : []).forEach(p => out.push({ category: 'VALIDATION', message: String(p), setup: null, correlation: null }));
  (Array.isArray(r?.untestedEverywhere) ? r.untestedEverywhere : []).forEach(u => out.push({ category: 'DATA',
    message: typeof u === 'string' ? `${u}: untested everywhere` : `${u?.setup}: untested everywhere — ${u?.why}`, setup: u?.setup || null, correlation: null }));
  return out;
}
/* The markets of the run that were not ready, as the readiness gate wrote
   them — the worker's array, or the plan's { markets } object. */
const scanRunReadiness = (r) => (Array.isArray(r?.readiness) ? r.readiness : Array.isArray(r?.readiness?.markets) ? r.readiness.markets : [])
  .filter(m => m && typeof m === 'object');
/* The history the run read: its newest bar and its hash (the worker), or
   the plan's { history } object. A run that stopped before reading it says
   so rather than showing a dash. */
function scanRunHistoryText(r) {
  if (r?.historyNewest || r?.historyHash) return `newest bar ${r.historyNewest || 'not recorded'}${r.historyHash ? ` · ${r.historyHash}` : ''}`;
  if (r?.history && typeof r.history === 'object') return `${r.history.symbols ?? '—'} series, newest bar ${r.history.newestBar || '—'}, written ${scanOpsWhen(r.history.generated)}`;
  return r?.status === 'PENDING' || r?.status === 'RUNNING' ? 'not read yet' : 'not read — the run ended before it read the history';
}
/* The four round 3 additions (C4), each optional. A worker that does not
   write one is not a worker that found nothing: absent reads "not recorded
   by this worker", an empty list reads "none". */
const SCAN_NOT_WRITTEN = 'not recorded — this worker does not write it';
/* skippedMarkets lists what the ready gate held back, and the gate runs
   only when asked (--ready; the daily task asks). An empty list from a run
   that was not gated, or whose readiness still names a market behind, is
   not "every market was ready": a manual run on a history a month old said
   so over its own readiness list naming MY and US behind. */
function scanRunSkippedMarketsText(r) {
  if (!Array.isArray(r?.skippedMarkets)) return SCAN_NOT_WRITTEN;
  const list = r.skippedMarkets.filter(m => m && typeof m === 'object');
  if (list.length) return list.map(m => `${m.market || 'no market row'} — ${m.reason || 'no reason recorded'}`).join('; ');
  const behind = scanRunReadiness(r).filter(m => m.inRun !== false && m.state && m.state !== 'READY');
  if (!behind.length) return 'none — every market in the run was ready';
  const names = behind.map(m => m.market || 'no market row').join(', ');
  return `none held back — ${names} ${behind.length === 1 ? 'was' : 'were'} not ready${r.ready === false ? ', and the run was not asked to hold such a market back (--ready)' : ''}; the run’s readiness says why`;
}
function scanRunCatchUpText(r) {
  const c = r?.catchUp;
  /* The worker writes catchUp: null on a run that does not catch up — a
     replay, which evaluates the session it was asked for — and leaves the
     key out only when it predates catch-up. Read as absent, a replay said
     "this worker does not write it" of the worker that had just written it. */
  if (c === null && r && 'catchUp' in r && (r.replayAsOf || r.trigger === 'replay')) return `none — a replay evaluates the session it was asked for${r.replayAsOf ? ` (${r.replayAsOf})` : ''} and catches nothing up`;
  if (!c || typeof c !== 'object') return SCAN_NOT_WRITTEN;
  const pairs = scanOpsN(c.pairs), bars = scanOpsN(c.bars);
  /* A run the ready gate held back entirely evaluated no pair, and "each
     was evaluated on that bar alone" was said of none. */
  if (scanRunCounts(r).evaluated === 0) return 'none — the run evaluated no pair';
  if (pairs === 0 || bars === 0) return 'none — no pair was behind its newest bar, so each was evaluated on that bar alone';
  const many = (v, one, more) => (v == null ? `an unrecorded number of ${more}` : `${fmtNum(v, 0)} ${v === 1 ? one : more}`);
  /* capped may be a count of pairs, their list, or a yes or no. */
  const cut = c.capped === true ? 'the cap was reached' : c.capped === false ? 0 : scanOpsN(c.capped);
  const tail = cut == null ? '' : cut === 0 ? '; no pair reached the cap'
    : `; ${typeof cut === 'string' ? cut : `${many(cut, 'pair', 'pairs')} reached the cap`}, so bars older than the cap were not evaluated — node scanner/scan.mjs --as-of DATE evaluates one on purpose`;
  return `${many(pairs, 'setup × instrument pair', 'setup × instrument pairs')} caught up over ${many(bars, 'bar', 'bars')} since each one’s last evaluated bar${tail}`;
}
/* A run whose ledger write failed (written: false — the run is PARTIAL,
   with an IO problem) recorded none of its new versions: they were read
   "recorded for the first time" over a ledger that holds none of them. They
   are new and not recorded, and why is among the run's problems; the next
   run that writes the ledger numbers them the same way. A record from a
   worker that does not write `written` reads as before. */
function scanRunLedgerText(r) {
  const l = r?.ledger;
  if (!l || typeof l !== 'object') return SCAN_NOT_WRITTEN;
  const f = (v) => (scanOpsN(v) == null ? 'not recorded' : fmtNum(scanOpsN(v), 0));
  const unwritten = l.written === false;
  return `${f(l.known)} version${scanOpsN(l.known) === 1 ? '' : 's'} already in the ledger · ${f(l.newVersions)} ${unwritten ? 'new, not recorded' : 'recorded for the first time'} · ${f(l.refused)} refused${scanOpsN(l.refused) ? ' — a version number reused with other content; the run’s problems name it' : ''}${unwritten ? ' · the ledger could not be written; the run’s problems say why' : ''}`;
}
const scanRunCacheText = (cs) => (cs && typeof cs === 'object' && (Number.isFinite(cs.hits) || Number.isFinite(cs.misses))
  ? `${Number.isFinite(cs.hits) ? fmtNum(cs.hits, 0) : 'not recorded'} reused, ${Number.isFinite(cs.misses) ? fmtNum(cs.misses, 0) : 'not recorded'} computed` : null);

/* A condition list: each line says whether it held, then the engine's own
   sentence with the values it compared. Untested is not failed. A
   condition read on a higher timeframe than its setup's carries the
   timeframe and the date of the bar read (contract B3), and the line says
   which bar that was, unless the engine's sentence already does. */
function scanOpsConds(conds) {
  const tag = { MET: ['held', 'scan-c-met'], NOT_MET: ['not held', 'scan-c-not'], UNAVAILABLE: ['untested', 'scan-c-na'] };
  return el('ul', { class: 'scan-conds' }, (conds || []).map(c => {
    const [label, cls] = tag[c.state] || ['—', 'scan-c-na'];
    const tf = c.timeframe != null && c.timeframe !== '' ? scanTimeframe(c.timeframe) : null;
    const word = tf ? (SCAN_TIMEFRAMES[tf]?.label || tf).toLowerCase() : null;
    const at = tf && c.barDate && !String(c.text || '').includes(c.barDate) ? ` — on the ${word} bar closing ${c.barDate}` : '';
    return el('li', {}, [el('span', { class: `scan-c ${cls}` }, label), ' ', `${c.text || '(no text)'}${at}`]);
  }));
}
/* A plain table: first column an identifier, the rest as given. No header
   is a control, so nothing can be re-ordered by a value. */
function scanOpsTable(headers, rows, { caption = null, wrapCols = [] } = {}) {
  const t = el('table', { class: 'dt scan-dt' });
  if (caption) t.append(el('caption', { class: 'sr-only' }, caption));
  t.append(el('thead', {}, el('tr', {}, headers.map(h => el('th', { scope: 'col' }, h)))));
  t.append(el('tbody', {}, rows.map(r => el('tr', {}, r.map((cell, i) =>
    el('td', { class: i === 0 ? 'ident' : wrapCols.includes(i) ? 'scan-wrap' : null, 'data-label': headers[i] || null }, cell ?? '—'))))));
  return el('div', { class: 'tablewrap' }, t);
}
/* Rows a page at a time, so a long list is bounded on screen too.
   "Show more" redraws the list, and the button that had focus went with
   it: focus fell to the page's body, and every disclosure the reader had
   opened closed. The disclosures reopen, and focus lands on the first row
   the button revealed — where the reader's attention goes next. */
function scanOpsPaged(rows, build, { step = 50, noun = 'rows' } = {}) {
  const host = el('div');
  let shown = Math.min(step, rows.length);
  const draw = (land = null) => {
    const open = [...host.querySelectorAll('details')].map(d => d.open);
    host.replaceChildren(build(rows.slice(0, shown)));
    host.querySelectorAll('details').forEach((d, i) => { if (open[i]) d.open = true; });
    if (shown < rows.length) host.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px;align-items:center' }, [
      el('span', { class: 'metaline' }, `Showing ${shown} of ${rows.length} ${noun}.`),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { const from = shown; shown = Math.min(rows.length, shown + step); draw(from); } }, `Show ${Math.min(step, rows.length - shown)} more`),
    ]));
    if (land == null) return;
    const table = host.querySelector('table');
    const cell = table ? [...table.querySelectorAll(':scope > tbody > tr:not(.scan-detail-row)')][land]?.cells[0] : null;
    if (cell) { cell.tabIndex = -1; cell.focus(); }
  };
  draw();
  return host;
}

/* OPEN YOUR FILES. On the deployed site the worker's files cannot be there,
   so a reader may open their own: each is read into this tab's memory with
   FileReader, recognised by its name, and used exactly as a file served
   from data/ would be. Nothing is uploaded — there is nowhere to upload it
   to — and nothing is kept once the tab is closed. */
const SCAN_OPS_OPENABLE = [
  [/scan-runs/i, 'scan-runs.json', (d) => { scanRunsFile = d; }],
  [/scan-control/i, 'scan-control.json', (d) => { scanControlFile = d; }],
  [/scan-deliveries/i, 'scan-deliveries.json', (d) => { scanDeliveriesFile = d; }],
  [/ingest-runs/i, 'ingest-runs.json', (d) => { ingestRunsFile = d; }],
  [/scan-alerts/i, 'scan-alerts.json', (d) => { if (typeof scanAlertsFile !== 'undefined') scanAlertsFile = d; }],
  [/scan-setups/i, 'scan-setups.json', (d) => { if (typeof scanSetupsFile !== 'undefined') scanSetupsFile = d; }],
  /* The splits the reader recorded, opened like the rest, and applied to the
     history already open. Without this entry an opened history was read
     unadjusted on the deployed site, where the served file cannot exist. */
  [/price-adjustments/i, 'price-adjustments.json', (d) => {
    if (typeof scanAdjustmentsFile !== 'undefined') scanAdjustmentsFile = d;
    if (typeof scanHistoryFile !== 'undefined' && scanHistoryFile) scanHistoryFile = scanAttachAdjustments(scanHistoryFile, d);
  }],
  /* An opened history carries the recorded splits, as the served one does
     (the loader attaches them); read raw, every scanner page disagreed with
     the worker on a split series. The rejects file the store writes beside
     it (price-history.rejects.json) is not a history: the pattern matched
     it too, and opening it replaced the history with the refused rows. */
  [/price-history(?!\.rejects)/i, 'price-history.json', (d) => {
    if (typeof scanHistoryFile !== 'undefined') scanHistoryFile = scanAttachAdjustments(d, typeof scanAdjustmentsFile !== 'undefined' ? scanAdjustmentsFile : null);
  }],
];
/* What the last choice of files left unopened. A choice that opened one
   file re-renders the page, and the status line saying the others were
   refused went with it: a file that did not parse, chosen beside one that
   did, was dropped without a word. Kept for this tab, until the next choice. */
let scanOpsOpenNote = '';
function scanOpsOpenFiles() {
  const box = el('div', { class: 'scan-open' });
  const input = el('input', { type: 'file', accept: '.json,application/json', multiple: '', hidden: '', 'aria-hidden': 'true', tabindex: '-1' });
  const out = el('p', { class: 'metaline', role: 'status' }, scanOpsOpenNote);
  input.addEventListener('change', async () => {
    const took = [], left = [];
    for (const f of [...(input.files || [])]) {
      const hit = SCAN_OPS_OPENABLE.find(([re]) => re.test(f.name));
      if (!hit) { left.push(`${f.name} (not a scanner file)`); continue; }
      try {
        const doc = JSON.parse(await f.text());
        hit[2](doc);
        scanOpsOpened = [...scanOpsOpened.filter(o => o.as !== hit[1]), { name: f.name, as: hit[1] }];
        took.push(hit[1]);
      } catch { left.push(`${f.name} (not readable as JSON)`); }
    }
    /* Cleared, so choosing the same file again — mended, or regenerated —
       is a change the browser reports. */
    input.value = '';
    if (took.length) scanOpsRead = true;
    scanOpsOpenNote = left.length ? `Not opened: ${left.join('; ')}.` : '';
    toast(took.length ? `Opened ${took.join(', ')} — in this tab only${left.length ? `; ${scanOpsPlural(left.length, 'file')} not opened` : ''}` : 'Nothing opened');
    if (took.length) render();
    else out.textContent = scanOpsOpenNote;
  });
  box.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => input.click() }, 'Open your files…'), input,
    el('span', { class: 'metaline' }, 'scan-runs, scan-alerts, scan-setups, price-history, price-adjustments, scan-control, scan-deliveries, ingest-runs'),
  ]));
  box.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, 'Read in this tab only. Nothing is uploaded, nothing is stored, and closing the tab forgets them.'));
  if (scanOpsOpened.length) box.append(el('p', { class: 'metaline' }, `Opened in this tab: ${scanOpsOpened.map(o => `${o.name} as ${o.as}`).join(', ')}.`));
  box.append(out);
  return box;
}

/* ============================================================ dashboard === */
/* /app/scanner (and /my/scanner). The four questions in the brief's order,
   from persisted records only. */
VIEWS.scannerDashboard = () => {
  /* /my/scanner?symbol= was the company page's door into the builder, and
     shared links carry it. It still opens the builder — synchronously, so
     the address, the header and the page change together — when the
     builder is in this build; otherwise the dashboard says where it went. */
  const q = new URLSearchParams(location.search);
  const alias = location.pathname.replace(/\/+$/, '').endsWith('/my/scanner');
  const builder = alias && q.get('symbol') ? matchRoute('/app/scanner/setups/new') : null;
  if (builder && VIEWS[builder.view]) {
    history.replaceState(history.state, '', href('/app/scanner/setups/new') + location.search);
    State.view = builder.view;
    setDocumentMeta(builder);
    return VIEWS[builder.view]();
  }

  const st = scanOpsStatus();
  const S = SCAN_STATE[st.state] || SCAN_STATE.never;
  const wrap = el('div', { class: 'scan-page', style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(scannerSubnav('dashboard'));
  wrap.append(scanOpsHead('Quantum Scanner · personal lane', 'Scanner',
    'Whether your setups are active, when the last scan succeeded, which setups matched and whether anything is delivered — read from what the worker recorded on this machine. Nothing here is a scan run by this page and presented as the worker’s.'));
  if (alias && q.get('symbol') && !builder) wrap.append(el('p', { class: 'metaline' },
    `This link asked for the setup builder with ${q.get('symbol')}; the builder is not in this build, so the dashboard opened instead.`));

  /* ---- the band: the state, and every reason for it ---- */
  const band = el('section', { class: 'card scan-band', data: { state: st.state }, 'aria-labelledby': 'scan-band-hd' });
  band.append(el('div', { class: 'scan-band-hd' }, [sevChip(S.sev, S.label), el('h2', { id: 'scan-band-hd', class: 'h-card' }, S.head)]));
  if (st.reasons.length) band.append(el('ul', { class: 'rulelist', style: 'margin-top:10px' }, st.reasons.map(r => el('li', {}, r))));
  if (st.state === 'current') band.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `The last scan ran on the newest bar your history holds, with the setups and the engine as they stand. No exchange calendar is held, so “current” is judged against your own history and a four-day rule, not a trading calendar.`));
  if (st.state === 'never') {
    band.append(el('p', { class: 'body', style: 'margin-top:10px;font-size:13px;max-width:72ch' },
      'The worker writes its run log (data/scan-runs.json) and its record of matches (data/scan-alerts.json) on the machine that runs it. Neither is ever deployed, so on the public site this page has nothing to read — by design, not by fault. Locally, run the worker once and reload; or open your own files below.'));
    band.append(scanOpsOpenFiles());
  }
  wrap.append(band);

  /* ---- the four questions ---- */
  const tiles = el('div', { class: 'scan-tiles', role: 'list' });
  const tile = (q, value, subs, link) => el('div', { class: 'panel scan-q', role: 'listitem' }, [
    el('p', { class: 'stat-label' }, q),
    el('p', { class: 'stat-value sm' }, value),
    ...subs.filter(Boolean).map(s => el('p', { class: 'stat-sub' }, s)),
    link ? el('p', { class: 'scan-q-link' }, link) : null,
  ]);
  const a = st.active;
  const setupsDoc = scanOpsSetupsDoc();
  const refused = scanOpsRefused(a);
  tiles.append(tile('Are my setups active?',
    setupsDoc ? `${a.enabled - a.expired} active` : 'No setups file',
    setupsDoc ? [`${a.valid} valid in data/scan-setups.json: ${a.enabled} enabled, ${a.disabled} disabled, ${a.expired} expired.`,
                 refused.file ? `The whole file is refused — ${refused.file}.`
                   : refused.setups ? `${scanOpsPlural(refused.setups, 'setup')} refused, for ${scanOpsPlural(refused.problems, 'problem')} — the worker leaves ${refused.setups === 1 ? 'it' : 'them'} out.` : null]
              : [scanOpsRead ? 'The worker reads data/scan-setups.json; none is on this machine.' : 'Not loaded yet.'],
    scanOpsLink('/app/scanner/setups', 'Your setups')));
  const ls = st.lastSuccess, la = st.lastAttempt;
  const lsAt = ls ? (ls.finishedAt || ls.startedAt) : null;
  tiles.append(tile('When did the last scan succeed?',
    ls ? scanOpsDay(lsAt) : 'Never',
    ls ? [`On bars of ${ls.asOf ? scanBarRange(ls.asOfFrom, ls.asOf) : 'no bar'}${scanOpsAge(lsAt) ? ` · ${scanOpsAge(lsAt)}` : ''}.`,
          /* The alerts file's last run stands in for a success whenever no
             run in the log succeeded — also when the log is here and holds
             only failures, which it does record. */
          ls.legacy ? (scanRunsFile ? 'From the alerts file’s last run: no run in the run log succeeded, so this is the last success any file records.'
                                    : 'From the alerts file’s last run: no run log is on this machine, so failures are not recorded anywhere.') : null,
          la && la !== ls ? `Latest attempt ${scanOpsDay(la.startedAt)}: ${(SCAN_RUN_STATUS[la.status] || [null, la.status])[1]}.` : null]
       : [la ? `The latest attempt, ${scanOpsDay(la.startedAt)}, ${(SCAN_RUN_STATUS[la.status] || [null, 'did not complete'])[1]}.` : 'Nothing has run here.'],
    scanOpsLink('/admin/scanner/jobs', 'Every run')));
  const current = st.state === 'current';
  const lm = st.latestMatches;
  /* With no successful scan there is no date to be "as of", and a run the
     ready gate held back entirely is an attempt, not a success: it is
     recorded, so "no scan has been recorded" would be false. */
  tiles.append(tile(current ? 'Which setups matched on the last scan?' : ls ? `Which setups matched? As of ${ls.asOf || 'an unrecorded date'} — not current` : 'Which setups matched?',
    ls ? scanOpsPlural(lm.length, 'match', 'matches') : '—',
    ls ? [lm.length ? `${[...new Set(lm.map(x => x.setupName || x.setupId))].slice(0, 3).join(', ')}${new Set(lm.map(x => x.setupId)).size > 3 ? ', …' : ''}.` : 'No setup matched on the bars of that scan. An empty day is the normal state of tight conditions, not a fault.',
          !current ? 'These are the last scan’s matches, not today’s: the scan is not current.' : null]
       : [la ? 'No scan has evaluated a bar yet, so no match can be shown — see the latest attempt beside this.' : 'No scan has been recorded, so no match can be shown.'],
    scanOpsLink('/app/scanner/alerts', 'Alert history')));
  const unread = scanOpsUnread();
  tiles.append(tile('Are notifications working?', 'No channel',
    [st.notifications.text,
     unread == null ? (typeof scanUnreadCount === 'function' ? 'Unread in this browser: not counted — no alerts file is visible here.' : 'Unread in this browser: not counted — the alerts pages are not in this build.') : `${scanOpsPlural(unread, 'alert')} unread in this browser.`],
    el('span', {}, [scanOpsLink('/app/scanner/settings', 'Settings'), ' · ', scanOpsLink('/admin/scanner/delivery', 'Delivery')])));
  wrap.append(tiles);

  /* ---- the matches of the last scan, under a heading that dates them ---- */
  const alerts = (() => { const d = scanOpsAlertsDoc(); return Array.isArray(d) ? d : Array.isArray(d?.alerts) ? d.alerts : []; })();
  const matchRows = (list) => scanOpsTable(['Setup', 'Instrument', 'Bar', 'Event', 'What held'], list.map(x => [
    x.setupName || x.setupId || '—', x.symbol || x.instrumentId || '—', scanOpsAlertLink(x, x.candleDate || x.bar || '—'),
    x.eventType ? x.eventType.replace(/_/g, ' ').toLowerCase() : 'match',
    (x.matchedConditions || x.rules || []).map(c => c.text).join('; ') || '—']), { wrapCols: [4] });
  /* The last scan's matches are those on its newest bar and those it
     recorded itself, which can sit on an earlier bar it evaluated — a
     caught-up day, or a market a session behind another. The heading named
     only the newest ("bars of 2026-09-25" over a row of 2026-09-24, beside
     a tile reading "2026-09-24 … 2026-09-25"); it names the run's range of
     bars, as the tile does. "As of" stays the newest: it dates the scan. */
  if (ls) {
    const bars = ls.asOf ? scanBarRange(ls.asOfFrom, ls.asOf) : '—';
    const mc = el('section', { class: 'card' });
    mc.append(cardHead(current ? `Matched on the last scan — bars of ${bars}` : `Matches as of ${ls.asOf || '—'} — not current`,
      current ? 'In the order your setups are written, then the instruments. Nothing is ranked.'
              : `The last successful scan evaluated bars of ${bars}. It is ${S.label.toLowerCase()}, so these are a record of that scan, not a statement about today.`));
    mc.append(lm.length ? matchRows(lm) : el('p', { class: 'body', style: 'font-size:13px' }, 'No match was recorded on that scan’s bars.'));
    wrap.append(mc);
  }
  const older = st.recent.filter(x => !lm.includes(x));
  if (older.length || (!ls && alerts.length)) {
    const rc = el('section', { class: 'card' });
    const list = older.length ? older : alerts.slice(-25).reverse();
    /* scanStatus's recent is the five newest bars with a match, and the
       last scan's bar is usually one of them: the heading said five over
       four. It counts what is listed. With no success, a run can still be
       recorded — a failure — so "no run recorded" was not always true. */
    const nBars = new Set(list.map(x => x.candleDate || x.bar || '')).size;
    rc.append(cardHead(ls ? `Earlier matches — the last ${nBars === 1 ? 'bar' : `${nBars} bars`} with one`
      : `Recorded matches — ${la ? 'no scan has succeeded' : 'no run recorded'}, so none is current`,
      'Newest bar first; within a bar, in the order of your setups.'));
    rc.append(scanOpsPaged(list, matchRows, { step: 25, noun: 'matches' }));
    wrap.append(rc);
  }

  /* ---- what the worker watches ---- */
  const h = scanOpsHistory();
  const hm = scanOpsHistoryMeta(h);
  const mon = el('section', { class: 'card' });
  mon.append(cardHead('Monitored instruments', 'The instruments in the universes of your enabled setups that hold a series in your price history — the only ones the worker can evaluate.'));
  const m = st.monitored;
  mon.append(el('dl', { class: 'kv scan-kv' }, [
    el('dt', {}, 'Monitored'), el('dd', {}, m ? scanOpsPlural(m.instruments, 'instrument') : hm ? 'no enabled setup' : 'no price history loaded'),
    el('dt', {}, 'Named but no series'), el('dd', {}, m ? (m.missing.length ? m.missing.join(', ') : 'none') : '—'),
    el('dt', {}, 'No market row'), el('dd', {}, m ? (m.unplaced.length ? m.unplaced.join(', ') : 'none') : '—'),
    el('dt', {}, 'Price history'), el('dd', {}, hm ? `${scanOpsPlural(hm.symbols.length, 'series', 'series')}, newest bar ${hm.newestBar || '—'}, ${hm.generated ? `written ${scanOpsDay(hm.generated)}` : 'no write date in the file'}` : 'none loaded'),
  ]));
  wrap.append(mon);

  /* ---- how it runs ---- */
  const run = el('section', { class: 'card' });
  run.append(cardHead('How the scan runs', 'The worker runs on your machine, after your own capture. This page never runs it.'));
  run.append(scanOpsCmd('node scanner/scan.mjs', 'Evaluates data/scan-setups.json on data/price-history.json and appends new matches to data/scan-alerts.json. A bar already recorded is never recorded again, so running it twice is safe.'));
  run.append(scanOpsCmd('node ingest/daily.mjs', 'The daily task: your capture, then the history, then the scan — the scan only if the history step succeeded.'));
  run.append(scanOpsCmd('node scanner/scan.mjs --status', 'Prints the four answers above, from the same files, in a terminal.'));
  run.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, [
    'The worker’s runs, data health, errors and controls: ', scanOpsLink('/admin/scanner', 'Operations'), '.']));
  if (st.state !== 'never') run.append(el('div', { style: 'margin-top:var(--sm)' }, scanOpsOpenFiles()));
  wrap.append(run);
  return wrap;
};

/* ======================================================= market screening === */
/* /app/scanner/market (SC-316, P1, flagged). One setup, one market's
   instruments that hold a series in the reader's history, evaluated on
   each one's last final bar. Recorded nowhere. */
const SCAN_OPS_MAX_SCREEN = 2000;
const scanMarketState = { market: '__all', setup: null, pasted: '', pastedSetup: null, asOf: '', result: null, job: null };

/* The setups a screen or a simulation can take: the setups file (validated
   exactly as the worker validates it), the builder's draft when there is
   one and it validates, and a setup pasted here. Keyed so a choice survives
   a re-render. */
function scanOpsSetupChoices(pasted) {
  const out = [];
  const doc = scanOpsSetupsDoc();
  if (doc) scanValidate(doc).setups.forEach(s => out.push({ key: `file:${s.id}`, label: `${s.name || s.id} (v${s.version}${s.enabled ? '' : ', disabled'})`, setup: s }));
  const draft = typeof scanDraft !== 'undefined' ? scanDraft : null;
  if (draft && typeof draft === 'object') {
    const v = scanValidate({ setups: [{ ...draft, id: draft.id || 'builder-draft', enabled: true }] });
    if (v.setups.length) out.push({ key: 'draft', label: 'The builder’s draft (not saved)', setup: v.setups[0] });
  }
  if (pasted) out.push({ key: 'pasted', label: `Pasted here: ${pasted.name || pasted.id}`, setup: pasted });
  return out;
}
/* A pasted setup, validated with the worker's own function: the JSON the
   builder copies, a whole setups file, or one setup object. */
function scanOpsParsePasted(text) {
  let doc;
  try { doc = JSON.parse(text); } catch { return { error: 'That is not JSON.' }; }
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.setups) ? doc.setups : doc && typeof doc === 'object' ? [doc] : [];
  const v = scanValidate({ setups: list.slice(0, 1) });
  if (!v.setups.length) return { error: `Refused, as the worker would refuse it — ${v.problems.join('; ') || 'no setup found'}.` };
  return { setup: v.setups[0], note: list.length > 1 ? `The first of ${list.length} setups was taken.` : null };
}
/* A setup chooser with a paste box, shared by screening and simulation. */
function scanOpsSetupPicker(state, onChange) {
  const box = el('div', { class: 'grid g-2 scan-form' });
  const choices = scanOpsSetupChoices(state.pastedSetup);
  if (!choices.some(c => c.key === state.setup)) state.setup = choices[0]?.key || null;
  const sel = el('select', { class: 'select', id: 'scan-setup-pick', onchange: (e) => { state.setup = e.target.value; state.result = null; onChange('scan-setup-pick'); } },
    choices.length ? choices.map(c => el('option', { value: c.key, selected: c.key === state.setup ? '' : null }, c.label))
                   : [el('option', { value: '' }, 'No setup available — paste one')]);
  if (!choices.length) sel.disabled = true;
  box.append(el('div', { class: 'field' }, [el('label', { for: 'scan-setup-pick' }, 'Setup'), sel,
    el('p', { class: 'metaline' }, scanOpsSetupsDoc() ? 'From data/scan-setups.json, validated as the worker validates it.' : 'No setups file is loaded; paste a setup to use one.')]));
  const ta = el('textarea', { class: 'input scan-paste', id: 'scan-paste', rows: '3', spellcheck: 'false', placeholder: '{ "id": "…", "ruleTree": { … } }' }, state.pasted || '');
  /* Which of several pasted setups was taken is said, and kept across the
     re-render the choice causes: the note was worked out and never shown,
     so a pasted file of five ran its first without a word. */
  const msg = el('p', { class: 'metaline', role: 'status' }, state.pastedSetup && state.pasteNote ? state.pasteNote : '');
  const use = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    state.pasted = ta.value;
    const r = scanOpsParsePasted(ta.value);
    if (r.error) { msg.textContent = r.error; return; }
    state.pastedSetup = r.setup; state.setup = 'pasted'; state.result = null;
    state.pasteNote = r.note ? `${r.note} It is “${r.setup.name || r.setup.id}”.` : '';
    onChange('scan-setup-pick');
  } }, 'Use this setup');
  box.append(el('div', { class: 'field' }, [el('label', { for: 'scan-paste' }, 'Or paste a setup (the JSON the builder copies)'), ta,
    el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [use, msg])]));
  return { node: box, setup: choices.find(c => c.key === state.setup)?.setup || null };
}
/* A choice that changes which fields exist re-renders the page through
   render(), so the register's flag notice is mounted as on any render, and
   focus goes back to the control that was changed. */
function scanOpsRerender(focusId) {
  const y = window.scrollY;
  render();
  window.scrollTo({ top: y, behavior: 'instant' });
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
/* Runs fn over items a few at a time, yielding to the page between chunks
   so a long list keeps the tab responsive and the cancel button live. */
async function scanOpsChunked(items, fn, { size = 8, onProgress = () => {}, cancelled = () => false } = {}) {
  for (let i = 0; i < items.length; i += size) {
    if (cancelled()) return false;
    items.slice(i, i + size).forEach(fn);
    onProgress(Math.min(i + size, items.length), items.length);
    await new Promise(r => setTimeout(r, 0));
  }
  return !cancelled();
}
/* A screen's or a simulation's run, from its button to its end.
   THE RUN OUTLIVES THE PAGE IT STARTED ON. Its progress, its Cancel and
   its result were written to the elements of the render that started it;
   any later render — the theme switched, a page visited and left — drew
   an idle form over a run still going, with no Cancel, and the result
   landed in elements no longer on screen: seen only on some later render,
   and, if the reader had started a shorter run meanwhile, over that one's.
   A running job now reports to `job.ui`, the controls of the render on
   screen, which each render hands it (scanOpsJobAttach).
   FOCUS IS HANDED ON. Started from the keyboard, focus fell to the page's
   body twice: the run button is disabled for the run, and a disabled
   control is blurred; and Cancel is hidden when the run stops. It goes to
   Cancel while the run can be stopped, and back to the run button after. */
function scanOpsJobAttach(job, ui) {
  job.ui = ui;
  ui.runBtn.disabled = true; scanOpsShow(ui.cancelBtn, true);
  ui.progress.textContent = job.said || '';
}
function scanOpsJobStart(S, ui) {
  if (S.job) S.job.cancelled = true;
  const job = { cancelled: false, said: '', ui };
  S.job = job;
  const focused = document.activeElement === ui.runBtn;
  scanOpsJobAttach(job, ui);
  if (focused) ui.cancelBtn.focus();
  return job;
}
const scanOpsJobSay = (job, text) => { job.said = text; job.ui.progress.textContent = text; };
/* False when a newer run has taken over: nothing of this one is shown or kept. */
function scanOpsJobEnd(S, job) {
  if (S.job !== job) return false;
  S.job = null;
  const { runBtn, cancelBtn } = job.ui;
  const focused = document.activeElement === cancelBtn;
  scanOpsShow(cancelBtn, false); runBtn.disabled = !job.ui.ready;
  if (focused) runBtn.focus();
  return true;
}
/* The markets a screen can take: those the registry places at least one of
   the reader's series in, alphabetically — the order of the codes, not of
   anything about them. */
function scanOpsMarkets(history) {
  const reg = scanRegistry(scanOpsRegistry());
  const count = new Map();
  let unplaced = 0;
  Object.keys(history?.series || {}).forEach(sym => {
    const m = reg.get(String(sym).toUpperCase())?.market;
    if (m) count.set(String(m).toUpperCase(), (count.get(String(m).toUpperCase()) || 0) + 1); else unplaced++;
  });
  const registryCount = (m) => scanOpsRegistry().filter(i => String(i.market || '').toUpperCase() === m).length;
  return { list: [...count.keys()].sort().map(m => ({ market: m, series: count.get(m), registry: registryCount(m), label: SCAN_MARKETS[m]?.label || null })), unplaced };
}
/* One screen: the setup, its universe replaced by the market, each
   instrument evaluated on its last final bar exactly as a run would pick
   it (a provisional last bar is stepped over, a stale series is untested).
   Results in symbol order; nothing is recorded. */
function scanScreenOne(s, history, sym, ctx) {
  const mk = ctx.reg.get(String(sym).toUpperCase())?.market || null;
  const bars = scanBars(history, sym, { timeframe: s.timeframe, market: mk, now: ctx.now, calendar: ctx.calFor(mk) });
  let at = bars.dates.length - 1;
  while (at >= 0 && bars.status[at] === 'PROVISIONAL') at--;
  if (at < 1) return { symbol: sym, market: mk, bar: bars.dates[at] || null, close: null, state: 'UNAVAILABLE', conditions: [], why: 'fewer than two bars are held' };
  const r = scanEvaluate(s.ruleTree, bars, { at, cache: ctx.cache });
  const why = r.state === 'UNAVAILABLE'
    ? ([...new Set(r.conditions.filter(c => c.state === 'UNAVAILABLE').map(c => c.text))].join('; ') || r.reason?.text || 'could not be evaluated') : null;
  return { symbol: sym, market: mk, bar: r.bar, close: r.close, barStatus: r.barStatus, state: r.state, conditions: r.conditions, why,
           stepped: at < bars.dates.length - 1 ? bars.dates[bars.dates.length - 1] : null };
}

VIEWS.scannerMarket = () => {
  const S = scanMarketState;
  const wrap = el('div', { class: 'scan-page', style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(scannerSubnav('market'));
  wrap.append(scanOpsHead('Quantum Scanner · personal lane', 'Market screening — your series',
    'Run one of your setups over every instrument of a market that holds a series in your own price history, now, in this browser. The result is listed in symbol order and recorded nowhere. It screens your history, not the market, and none of it is offered to anyone else.'));

  const history = scanOpsHistory();
  const haveHistory = !!(history?.series && Object.keys(history.series).length);
  const form = el('section', { class: 'card' });
  form.append(cardHead('What to screen', 'A setup and a market. The setup’s own universe is set aside for this screen; its conditions are not changed.'));
  const results = el('div', { class: 'scan-results', 'aria-live': 'polite' });
  const rerender = scanOpsRerender;
  const pick = scanOpsSetupPicker(S, rerender);
  form.append(pick.node);
  const mk = scanOpsMarkets(history);
  if (S.market !== '__all' && !mk.list.some(m => m.market === S.market)) S.market = '__all';
  const g = el('div', { class: 'grid g-2 scan-form', style: 'margin-top:var(--sm)' });
  const msel = el('select', { class: 'select', id: 'scan-market-pick', onchange: (e) => { S.market = e.target.value; S.result = null; rerender('scan-market-pick'); } }, [
    el('option', { value: '__all', selected: S.market === '__all' ? '' : null }, `Everything with a series (${haveHistory ? Object.keys(history.series).length : 0})`),
    ...mk.list.map(m => el('option', { value: m.market, selected: S.market === m.market ? '' : null }, `${m.market}${m.label ? ` — ${m.label}` : ''} (${m.series} of your series)`)),
  ]);
  g.append(el('div', { class: 'field' }, [el('label', { for: 'scan-market-pick' }, 'Market'), msel,
    el('p', { class: 'metaline' }, `Markets as the instrument registry (data/instruments.json) places your series, alphabetically.${mk.unplaced ? ` ${scanOpsPlural(mk.unplaced, 'series', 'series')} with no registry row can be screened only under “everything”.` : ''}`)]));
  /* A replay is of a session that has happened: the worker refuses an
     --as-of after today, and so does the screen (below). */
  const today = scanOpsNow().slice(0, 10);
  const asOf = el('input', { class: 'input', type: 'date', id: 'scan-market-asof', max: today, value: S.asOf || '', onchange: (e) => { S.asOf = scanIsDay(e.target.value) ? e.target.value : ''; S.result = null; } });
  g.append(el('div', { class: 'field' }, [el('label', { for: 'scan-market-asof' }, 'As of (blank for now)'), asOf,
    el('p', { class: 'metaline' }, 'Blank judges your history against today’s clock, as the worker does: a series behind the session expected by now is untested, not evaluated. A date replays that evening — the history cut at it, judged the morning after.')]));
  form.append(g);

  const progress = el('p', { class: 'metaline', role: 'status' });
  const runBtn = el('button', { class: 'btn btn-primary btn-sm' }, 'Screen now (not recorded)');
  const cancelBtn = scanOpsShow(el('button', { class: 'btn btn-quiet btn-sm' }, 'Cancel'), false);
  runBtn.disabled = !pick.setup || !haveHistory;
  form.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:center' }, [runBtn, cancelBtn, progress]));
  if (!haveHistory) form.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' },
    'No price history is loaded, so there is nothing to screen. On the deployed site that is by design — none of the prices this product could ship is licensed for redistribution. Locally, the worker’s data/price-history.json is read here.'));
  wrap.append(form);

  const ui = { runBtn, cancelBtn, progress, results, ready: !runBtn.disabled };
  if (S.job) scanOpsJobAttach(S.job, ui);
  runBtn.addEventListener('click', async () => {
    const setup = pick.setup;
    if (!setup) return;
    if (S.asOf && S.asOf > scanOpsNow().slice(0, 10)) {
      progress.textContent = `${S.asOf} is not a past date, so there is no session to replay — the worker refuses it too. Clear the date to screen now.`;
      return;
    }
    const job = scanOpsJobStart(S, ui);
    /* What was asked, taken now: the market and the date stay live on the
       form while the screen runs, and read at its end they labelled a
       screen of one market with another. */
    const market = S.market, asOfDay = S.asOf || null, setupKey = S.setup;
    const s = { ...setup, enabled: true, expires: null, universe: market === '__all' ? { kind: 'all' } : { kind: 'market', market } };
    const hist = asOfDay ? scanTruncateHistory(history, asOfDay) : history;
    const now = asOfDay ? scanReplayNow(asOfDay) : scanOpsNow();
    const reg = scanRegistry(scanOpsRegistry());
    const cals = new Map();
    const ctx = { reg, now, cache: scanCache(), calFor: (m) => { const k = m || ''; if (!cals.has(k)) cals.set(k, scanCalendar(hist, scanOpsRegistry(), m || null)); return cals.get(k); } };
    /* Symbol order, as plain code-point order of the symbols: the one order
       that says nothing about any instrument. */
    const all = scanUniverse(s, hist, scanOpsRegistry()).slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const symbols = all.slice(0, SCAN_OPS_MAX_SCREEN);
    const rows = [];
    const done = await scanOpsChunked(symbols, (sym) => rows.push(scanScreenOne(s, hist, sym, ctx)), {
      onProgress: (i, n) => scanOpsJobSay(job, `Screened ${i} of ${n}…`), cancelled: () => job.cancelled });
    if (!scanOpsJobEnd(S, job)) return;
    if (!done) { job.ui.progress.textContent = `Cancelled after ${rows.length} of ${symbols.length}. Nothing was kept.`; return; }
    job.ui.progress.textContent = '';
    const regCount = market === '__all' ? scanOpsRegistry().length : scanOpsRegistry().filter(i => String(i.market || '').toUpperCase() === market).length;
    /* Where the setup came from decides what the builder can be handed:
       only a setup in the file has an id the builder can find (?from=). */
    const source = String(setupKey || '').startsWith('file:') ? 'file' : setupKey === 'draft' ? 'draft' : 'pasted';
    S.result = { at: new Date().toISOString(), setup: s, source, market, asOf: asOfDay, now, rows, capped: all.length > symbols.length ? all.length : 0, registry: regCount };
    const out = job.ui.results;
    out.replaceChildren(scanScreenResult(S.result));
    out.querySelector('h2, h3')?.setAttribute('tabindex', '-1');
    out.querySelector('h2, h3')?.focus({ preventScroll: false });
  });
  cancelBtn.addEventListener('click', () => { if (S.job) S.job.cancelled = true; });

  if (S.result) results.append(scanScreenResult(S.result));
  wrap.append(results);
  return wrap;
};

function scanScreenResult(R) {
  const box = el('section', { class: 'card', 'aria-labelledby': 'scan-screen-hd' });
  const n = R.rows.length;
  const where = R.market === '__all' ? 'every instrument with a series in your own history' : `the ${R.market} instruments with a series in your own history`;
  box.append(el('div', { class: 'card-hd' }, el('div', {}, [
    el('h3', { class: 'h-card', id: 'scan-screen-hd' }, `${R.setup.name || R.setup.id} on ${R.market === '__all' ? 'everything with a series' : R.market}`),
    /* THE COVERAGE STATEMENT COMES FIRST: what was screened, and what was not. */
    el('p', { class: 'body scan-coverage', style: 'font-size:13px;margin-top:4px;max-width:75ch' },
      `Screened ${scanOpsPlural(n, 'instrument')} — ${where}. The registry lists ${R.registry} instruments ${R.market === '__all' ? 'across all markets' : 'in this market'}; the market itself has many more, and none of those is screened.${R.capped ? ` The screen is bounded at ${SCAN_OPS_MAX_SCREEN}; ${R.capped - n} more were not evaluated.` : ''}`),
    el('p', { class: 'metaline', style: 'margin-top:4px' },
      `${R.asOf ? `Replayed as of ${R.asOf}` : `Judged at ${scanOpsWhen(R.now)}`} · each instrument on its last final bar · listed in symbol order, the only order offered · nothing recorded.`),
  ])));
  const groups = [['MET', 'Matched', 'The conditions held on the instrument’s last final bar. Whether that match is new is the worker’s question (NEW_MATCH), not this screen’s.'],
                  ['NOT_MET', 'Not matched', 'Every condition could be read, and together they did not hold.'],
                  ['UNAVAILABLE', 'Untested', 'At least one condition could not be read, so the setup neither held nor failed. Each row says why.']];
  groups.forEach(([state, title, note]) => {
    const rows = R.rows.filter(r => r.state === state);
    const sec = el('div', { class: 'scan-group', style: 'margin-top:var(--md)' });
    sec.append(el('h4', { class: 'scan-h4' }, `${title} — ${rows.length}`));
    sec.append(el('p', { class: 'metaline', style: 'margin-bottom:6px' }, note));
    if (!rows.length) { sec.append(el('p', { class: 'metaline' }, 'None.')); box.append(sec); return; }
    sec.append(scanOpsPaged(rows, (list) => scanOpsTable(['Instrument', 'Market', 'Bar', 'Close', state === 'UNAVAILABLE' ? 'Why untested' : 'Conditions'],
      list.map(r => [r.symbol, r.market || 'no market row', r.bar || '—', scanOpsPrice(r.close),
        state === 'UNAVAILABLE' ? el('span', {}, r.why) : scanOpsConds(r.conditions)]), { wrapCols: [4], caption: `${title}, in symbol order` }), { step: 50, noun: 'instruments' }));
    box.append(sec);
  });
  const stepped = R.rows.filter(r => r.stepped);
  if (stepped.length) box.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `${scanOpsPlural(stepped.length, 'instrument')} had a provisional last bar (captured before its session closed and settled); the bar before it was evaluated instead: ${stepped.map(r => r.symbol).join(', ')}.`));
  box.append(scanScreenSave(R));
  return box;
}
/* SAVE AS A SETUP. A screen records nothing; to have the worker record
   matches on this market, the reader saves a setup whose universe is it.
   The builder takes the screen along through its address (the round 3
   contract C5): ?market= sets the universe to this market, and ?from=
   starts the draft from the setup screened — a copy under a new id, so the
   setup in the file is never changed from here. Only a setup in the file
   has an id the builder can find; the builder's own draft is already in
   the builder, and a pasted one has to be pasted there. "Everything with a
   series" has no parameter in C5, so that link carries the setup alone and
   says which universe to choose. */
function scanScreenSave(R) {
  const q = new URLSearchParams();
  if (R.market !== '__all') q.set('market', R.market);
  if (R.source === 'file' && R.setup?.id) q.set('from', R.setup.id);
  const path = `/app/scanner/setups/new${q.toString() ? `?${q}` : ''}`;
  const name = R.setup?.name || R.setup?.id || 'this setup';
  const where = R.market === '__all' ? null : R.market;
  const pick = where ? '' : ' Choose that universe there: the link cannot carry it.';
  const what = R.source === 'file'
    ? `opens the builder on a copy of ${name}${where ? ` with ${where} as its universe` : ''}. The setup in your file is not changed.${pick}`
    : R.source === 'draft'
      ? `opens the builder, where your draft is${where ? `, asking it for ${where} as the universe` : ''}.${pick}`
      : `opens the builder${where ? ` with ${where} as the universe` : ''}. A pasted setup is not in your setups file, so its conditions do not travel in the link: paste them there.${pick}`;
  return el('p', { class: 'metaline scan-save', style: 'margin-top:var(--sm)' }, [
    where ? 'To have the worker record matches on this market, save a setup with it as the universe. '
          : 'To have the worker record matches on these instruments, save a setup whose universe is every instrument with a series. ',
    scanOpsLink(path, 'Save as a setup', { 'data-from': R.source }), ` ${what}`]);
}

/* ===================================================== historical testing === */
/* /app/scanner/backtest (SC-314, P1, flagged). scanHistorical, one symbol at
   a time so the tab stays live and a run can be stopped. Matches, events
   and what the worker would have recorded — never a return. */
const scanBacktestState = { setup: null, pasted: '', pastedSetup: null, symbol: '', from: '', to: '', view: 'events', result: null, job: null };
const SCAN_BACKTEST_MAX_BARS = 600;

/* Merges the per-symbol outputs back into the one shape scanHistorical
   returns for a whole universe — symbol order, then date order. */
function scanBacktestMerge(parts, s) {
  const out = { simulation: true, note: SCAN_SIMULATION_NOTE, setupId: s.id, setupVersion: s.version, setupHash: s.hash, timeframe: s.timeframe,
                cooldownMode: s.cooldownMode, cooldownBars: s.cooldownBars, coverage: [], matches: [], events: [], recorded: [], missingSessions: [], skipped: [] };
  parts.forEach(p => { ['coverage', 'matches', 'events', 'recorded', 'missingSessions', 'skipped'].forEach(k => out[k].push(...(p[k] || []))); });
  out.counts = { symbols: out.coverage.length, evaluatedBars: out.coverage.reduce((t, c) => t + c.evaluated, 0), matchedBars: out.matches.length,
                 events: out.events.length, recorded: out.recorded.length, unavailableBars: out.coverage.reduce((t, c) => t + c.unavailable, 0) };
  return out;
}

VIEWS.scannerBacktest = () => {
  const S = scanBacktestState;
  const wrap = el('div', { class: 'scan-page', style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(scannerSubnav('backtest'));
  wrap.append(scanOpsHead('Quantum Scanner · simulation', 'Historical matches — simulation',
    'The dates on which a setup’s conditions held in your own history, with the values that made them hold — evaluated by the same engine the worker runs, one bar at a time.'));

  /* THE LABEL IS FIXED AND COMES FIRST — before any number it qualifies. */
  const sim = el('section', { class: 'scan-sim', role: 'note', 'aria-label': 'This is a simulation' }, [
    el('p', { class: 'scan-notice-hd' }, [el('span', { class: 'chip chip-bronze' }, 'Simulation'), el('strong', {}, 'A simulation of when the conditions held — not a backtest of performance.')]),
    el('p', {}, SCAN_SIMULATION_NOTE),
    el('p', { class: 'scan-lookahead' }, 'No look-ahead: the row for a bar is computed from the bars up to and including that bar, never from any bar after it. The checks evaluate every bar both ways — on the full history and on the history cut at that bar — and fail if a single row differs.'),
  ]);
  wrap.append(sim);

  const history = scanOpsHistory();
  const haveHistory = !!(history?.series && Object.keys(history.series).length);
  const form = el('section', { class: 'card' });
  form.append(cardHead('What to simulate', `One setup over its own universe, or one instrument of it; at most the last ${SCAN_BACKTEST_MAX_BARS} bars of each instrument inside the dates you give.`));
  const rerender = scanOpsRerender;
  const pick = scanOpsSetupPicker(S, rerender);
  form.append(pick.node);
  const g = el('div', { class: 'grid g-3 scan-form', style: 'margin-top:var(--sm)' });
  const universe = pick.setup && haveHistory ? scanUniverse(pick.setup, history, scanOpsRegistry()).slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) : [];
  if (S.symbol && !universe.includes(S.symbol)) S.symbol = '';
  g.append(el('div', { class: 'field' }, [el('label', { for: 'scan-bt-sym' }, 'Instruments'),
    el('select', { class: 'select', id: 'scan-bt-sym', onchange: (e) => { S.symbol = e.target.value; S.result = null; } }, [
      el('option', { value: '', selected: !S.symbol ? '' : null }, `The setup’s universe (${universe.length} with a series)`),
      ...universe.map(sym => el('option', { value: sym, selected: S.symbol === sym ? '' : null }, sym))])]));
  const date = (id, label, key) => el('div', { class: 'field' }, [el('label', { for: id }, label),
    el('input', { class: 'input', type: 'date', id, value: S[key] || '', onchange: (e) => { S[key] = scanIsDay(e.target.value) ? e.target.value : ''; S.result = null; } })]);
  g.append(date('scan-bt-from', 'From (blank for the first bar)', 'from'));
  g.append(date('scan-bt-to', 'To (blank for the last bar)', 'to'));
  form.append(g);
  const progress = el('p', { class: 'metaline', role: 'status' });
  const runBtn = el('button', { class: 'btn btn-primary btn-sm' }, 'Run the simulation');
  const cancelBtn = scanOpsShow(el('button', { class: 'btn btn-quiet btn-sm' }, 'Cancel'), false);
  runBtn.disabled = !pick.setup || !universe.length;
  form.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:center' }, [runBtn, cancelBtn, progress]));
  if (!haveHistory) form.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' },
    'No price history is loaded, so there is nothing to simulate on. The simulation reads only data/price-history.json on your own machine.'));
  else if (pick.setup && !universe.length) form.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, 'No instrument in this setup’s universe holds a series in your history.'));
  wrap.append(form);

  const results = el('div', { 'aria-live': 'polite' });
  const ui = { runBtn, cancelBtn, progress, results, ready: !runBtn.disabled };
  if (S.job) scanOpsJobAttach(S.job, ui);
  runBtn.addEventListener('click', async () => {
    const s = pick.setup;
    if (!s) return;
    /* A From after the To holds no bar. Run anyway, the coverage read a
       window that ended before it began ("2026-03-20 … 2026-01-30") and
       "testable from: never" for a series every bar of which is testable. */
    if (S.from && S.to && S.from > S.to) {
      progress.textContent = `From (${S.from}) is after To (${S.to}), so no bar lies between them. Nothing was simulated.`;
      return;
    }
    const job = scanOpsJobStart(S, ui);
    /* The window, taken now: the dates stay live on the form while the
       run goes on, and each instrument read them as it came up, so a date
       changed mid-run gave the later instruments another window than the
       earlier ones and the heading the last one typed. */
    const from = S.from || null, to = S.to || null;
    const syms = S.symbol ? [S.symbol] : universe;
    const cache = scanCache();
    const parts = [];
    const done = await scanOpsChunked(syms, (sym) => parts.push(scanHistorical(s, history, { symbols: [sym], from, to,
      maxBars: SCAN_BACKTEST_MAX_BARS, instruments: scanOpsRegistry(), cache })), {
      size: 2, onProgress: (i, n) => scanOpsJobSay(job, `Simulated ${i} of ${n} instrument${n === 1 ? '' : 's'}…`), cancelled: () => job.cancelled });
    if (!scanOpsJobEnd(S, job)) return;
    if (!done) { job.ui.progress.textContent = `Cancelled after ${parts.length} of ${syms.length}. Nothing was kept.`; return; }
    job.ui.progress.textContent = '';
    S.result = { setup: s, from, to, out: scanBacktestMerge(parts, s) };
    job.ui.results.replaceChildren(scanBacktestResult(S.result));
    const hd = job.ui.results.querySelector('h3');
    if (hd) { hd.setAttribute('tabindex', '-1'); hd.focus(); }
  });
  cancelBtn.addEventListener('click', () => { if (S.job) S.job.cancelled = true; });
  if (S.result) results.append(scanBacktestResult(S.result));
  wrap.append(results);
  return wrap;
};

function scanBacktestResult(R) {
  const S = scanBacktestState;
  const o = R.out;
  const box = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const head = el('section', { class: 'card' });
  head.append(el('div', { class: 'card-hd' }, el('div', {}, [
    el('h3', { class: 'h-card' }, `Simulated: ${R.setup.name || R.setup.id}, version ${o.setupVersion}`),
    el('p', { class: 'caption', style: 'margin-top:2px' }, `Setup hash ${o.setupHash} · ${o.timeframe === '1W' ? 'weekly bars, imported where your history holds them and otherwise derived from your daily ones' : o.timeframe === '1M' ? 'monthly bars, imported where your history holds them and otherwise derived from your daily ones' : 'daily bars'} · ${o.cooldownMode === 'NEW_MATCH' ? 'records new matches only' : 'records every match'}${o.cooldownBars ? `, ${o.cooldownBars}-bar cooldown` : ''} · ${R.from || 'first bar'} to ${R.to || 'last bar'} · simulation, not a guarantee.`),
  ])));
  const c = o.counts;
  const grid = el('div', { class: 'grid scan-counts' });
  [['Instruments', c.symbols], ['Bars evaluated', c.evaluatedBars], ['Bars on which the conditions held', c.matchedBars],
   ['Bars on which a match began', c.events], ['What the worker would have recorded', c.recorded], ['Bars untested', c.unavailableBars]]
    .forEach(([l, v]) => grid.append(statTile(l, fmtNum(v, 0))));
  head.append(grid);
  head.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, 'Counts of bars and dates. There is no return, hit rate or performance figure here, because none can be computed without entries, exits and costs, and none is implied.'));
  box.append(head);

  /* Coverage: what each instrument could and could not be tested on. */
  const cov = el('section', { class: 'card' });
  cov.append(cardHead('Coverage', 'Per instrument, in symbol order: the bars held, the window evaluated, the first bar every condition could be read on, and the sessions missing from the series.'));
  cov.append(scanOpsTable(['Instrument', 'Calendar', 'Bars held', 'Window', 'Testable from', 'Untested bars', 'Invalid bars', 'Missing sessions'],
    o.coverage.map(v => {
      const counted = v.missingSessions.filter(m => !m.tolerated).length, tolerated = v.missingSessions.length - counted;
      return [v.symbol, v.calendar === 'inferred' ? 'inferred' : 'weekdays', fmtNum(v.bars, 0), v.from ? `${v.from} … ${v.to}` : '—', v.testableFrom || 'never',
        fmtNum(v.unavailable, 0), fmtNum(v.invalid, 0), v.missingSessions.length ? `${counted} gap${counted === 1 ? '' : 's'}${tolerated ? `, ${tolerated} read as a possible holiday` : ''}` : 'none'];
    }), { caption: 'Coverage per instrument' }));
  const gaps = o.missingSessions.filter(m => !m.tolerated);
  if (gaps.length) {
    const det = el('details', { style: 'margin-top:var(--sm)' });
    det.append(el('summary', { class: 'caption' }, `The ${scanOpsPlural(gaps.length, 'gap')} with missing sessions`));
    det.append(el('ul', { class: 'rulelist' }, gaps.slice(0, 200).map(m => el('li', {}, `${m.symbol}: ${m.sessions} session${m.sessions === 1 ? '' : 's'} missing between ${m.after} and ${m.before} — no crossing is read across it, and a window spanning it is untested.`))));
    cov.append(det);
  }
  box.append(cov);

  /* The dates, in one of three readings. */
  const dates = el('section', { class: 'card' });
  const views = [['events', 'Where a match began', o.events], ['recorded', 'What the worker would have recorded', o.recorded], ['every', 'Every bar that held', o.matches]];
  const cur = views.find(v => v[0] === S.view) || views[0];
  dates.append(cardHead('Matching dates', 'Symbol order, then date order. Each row opens the conditions and the values they compared on that bar.'));
  const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Which dates', style: 'margin-bottom:var(--sm)' });
  views.forEach(([id, label, list]) => seg.append(el('button', { 'aria-pressed': id === cur[0] ? 'true' : 'false', 'aria-selected': id === cur[0] ? 'true' : 'false',
    onclick: () => { S.view = id; const fresh = scanBacktestResult(R); box.replaceWith(fresh); fresh.querySelector(`.segmented button[aria-pressed="true"]`)?.focus(); } }, `${label} (${list.length})`)));
  dates.append(seg);
  const byBar = new Map(o.matches.map(m => [`${m.symbol}|${m.bar}`, m]));
  const list = cur[2];
  if (!list.length) dates.append(el('p', { class: 'body', style: 'font-size:13px' }, 'None in this window. Tight conditions often hold on no bar at all; that is a result, not a fault.'));
  else dates.append(scanOpsPaged(list, (rows) => scanOpsTable(['Instrument', 'Bar', 'Close', 'Event', 'Conditions and values'],
    rows.map(r => {
      const m = byBar.get(`${r.symbol}|${r.bar}`) || r;
      const det = el('details', { class: 'scan-row-det' });
      det.append(el('summary', { class: 'caption' }, `${(m.conditions || []).filter(x => x.state === 'MET').length} of ${(m.conditions || []).length} conditions held${m.barStatus === 'UNKNOWN' ? ' · no capture time recorded for the bar' : m.barStatus ? ` · bar ${m.barStatus.toLowerCase()}` : ''}`));
      det.append(scanOpsConds(m.conditions));
      return [r.symbol, r.bar, scanOpsPrice(r.close), r.eventType ? r.eventType.replace(/_/g, ' ').toLowerCase() : 'held', det];
    }), { wrapCols: [4], caption: `${cur[1]}, symbol then date order` }), { step: 100, noun: 'dates' }));
  box.append(dates);
  return box;
}

/* ============================================================= operations === */
/* The four /admin/scanner pages. Read-only; each states which of its files
   is absent and what writes it. */
function scanOpsPage(active, title, lead) {
  const wrap = el('div', { class: 'scan-page', style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(scanOpsSubnav(active));
  wrap.append(scanOpsHead('Scanner operations · this machine', title, lead));
  wrap.append(scanOpsNotice());
  return wrap;
}
/* The regular session in the market's zone, now: open, closed, or closed
   and settling (a bar captured now would be provisional). Holidays are not
   held, so a holiday reads as the weekday it falls on — said, not hidden. */
function scanOpsSessionNow(market, now) {
  const M = scanMarket(market);
  const p = scanTzParts(Date.parse(now), M.tz);
  const wd = scanWeekday(p.date);
  /* No hours held (currency pairs, crypto): nothing is said about open or
     closed, only how the day's bar is dated. */
  if (!M.open) return { text: `no session hours held; the day's bar is dated at ${M.close} ${M.tz}`, local: p };
  if (!M.days.includes(wd)) return { text: `closed — ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]}`, local: p };
  const mins = p.minutes, open = scanHm(M.open), close = scanHm(M.close);
  const inBreak = (M.breaks || []).some(([a, b]) => mins >= scanHm(a) && mins < scanHm(b));
  if (mins >= open && mins < close) return { text: inBreak ? 'open — in the midday break' : 'open (regular session)', local: p };
  if (mins >= close && mins < close + (M.settleMin || 0)) return { text: `closed — settling for ${M.settleMin} minutes; a bar captured now would be provisional`, local: p };
  return { text: mins < open ? 'closed — before the open' : 'closed — after the close', local: p };
}

VIEWS.scannerAdmin = () => {
  const wrap = scanOpsPage('overview', 'Scanner operations',
    'Data, sessions, runs, the alert engine, delivery, usage and errors, in that order — each read from a file the worker or the daily task writes on this machine.');
  const now = scanOpsNow();
  const history = scanOpsHistory();
  const hm = scanOpsHistoryMeta(history);
  const { runs, audit, dropped } = scanOpsRuns();
  const st = scanOpsStatus();
  const panel = (title, sub, ...kids) => { const c = el('section', { class: 'card' }); c.append(cardHead(title, sub)); kids.flat().filter(Boolean).forEach(k => c.append(k)); return c; };

  /* 1 — data sources. */
  const ing = Array.isArray(ingestRunsFile) ? ingestRunsFile : Array.isArray(ingestRunsFile?.runs) ? ingestRunsFile.runs : [];
  const lastIng = [...ing].filter(r => r && typeof r === 'object').sort((a, b) => String(b.startedAt || b.at || '').localeCompare(String(a.startedAt || a.at || '')))[0] || null;
  const steps = lastIng ? (Array.isArray(lastIng.steps) ? lastIng.steps : Object.entries(lastIng.steps || {}).map(([name, v]) => ({ name, ...(v && typeof v === 'object' ? v : { status: v }) }))) : [];
  wrap.append(panel('Data sources', 'No provider is licensed to this product. The sources are yours: your screen capture, your export, and the end-of-day quotes you fetch yourself — combined into one history file.',
    el('dl', { class: 'kv scan-kv' }, [
      el('dt', {}, 'Price history'), el('dd', {}, hm ? `data/price-history.json · ${scanOpsPlural(hm.symbols.length, 'series', 'series')} · newest bar ${hm.newestBar || '—'} · ${hm.generated ? `written ${scanOpsWhen(hm.generated)}` : 'no write date in the file'}${history?.source ? ` · source ${history.source}` : ''}` : 'not loaded'),
      el('dt', {}, 'Last ingestion'), el('dd', {}, lastIng ? `${scanOpsWhen(lastIng.startedAt || lastIng.at)} · ${lastIng.status || (lastIng.exitCode === 0 ? 'completed' : lastIng.exitCode != null ? `exit ${lastIng.exitCode}` : 'no status recorded')}` : 'no ingest log'),
    ]),
    steps.length ? scanOpsTable(['Step', 'Status', 'Detail'], steps.map(s => [s.name || s.step || '—', String(s.status || (s.exitCode != null ? `exit ${s.exitCode}` : '—')).toLowerCase(), s.detail || s.message || s.note || '—']), { wrapCols: [2], caption: 'Steps of the last ingestion' }) : null,
    scanOpsFileState('ingest-runs.json', ingestRunsFile, 'The daily task (node ingest/daily.mjs) writes it, one record per run with each step’s outcome.'),
    el('p', { class: 'metaline' }, 'Disabling a provider: there is none to disable. Leaving a capture step out of ingest/daily.mjs is the equivalent, and it is your task’s configuration, not a switch here.')));

  /* 2 — exchange sessions. */
  const rd = history ? scanReadiness(history, scanOpsRegistry(), now) : null;
  const mkts = rd ? rd.markets.filter(m => m.market) : [];
  /* The markets whose hours this build holds (SCAN_MARKETS) get a row each;
     the rest share one table behind a disclosure, because for them the only
     thing known is the weekday — thirty rows saying "no session hours held"
     buried the four that say something. */
  const held = mkts.filter(m => SCAN_MARKETS[m.market]), other = mkts.filter(m => !SCAN_MARKETS[m.market]);
  const finalText = (m) => m.state === 'READY' ? 'held' : m.state === 'PROVISIONAL' ? 'pending — held only as a provisional bar'
    : m.state === 'BEHIND' ? `behind — newest final bar ${m.newestFinal || 'none'}` : m.state.toLowerCase().replace(/_/g, ' ');
  const hhmm = (p) => `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`;
  const calText = (m) => (m.calendar === 'inferred' ? 'inferred from your series — not an exchange calendar' : scanMarket(m.market).days.length === 7 ? 'every day' : 'weekdays — holidays not held');
  const otherDet = other.length ? el('details', { style: 'margin-top:var(--sm)' }, [
    el('summary', { class: 'caption' }, `${scanOpsPlural(other.length, 'other market')} with your series, no session hours held: ${other.map(m => m.market).join(', ')}`),
    el('p', { class: 'metaline', style: 'margin:6px 0' }, 'For these a bar is dated at the end of the UTC day — later than every real close — so no bar is called final early.'),
    scanOpsTable(['Market', 'Series', 'Calendar', 'Expected by now', 'Final data'], other.map(m => [m.market, fmtNum(m.symbols, 0), calText(m), m.expected || '—', finalText(m)]),
      { wrapCols: [2, 4], caption: 'Other markets' })]) : null;
  wrap.append(panel('Exchange sessions', 'Regular hours only. No exchange calendar is held: holidays and half-days are not known, and a session is inferred from your own series where five or more share a market.',
    held.length ? scanOpsTable(['Market', 'Local time', 'Now', 'Calendar', 'Expected by now', 'Final data'],
      held.map(m => { const s = scanOpsSessionNow(m.market, now);
        return [`${m.market}${m.label && m.label !== m.market ? ` — ${m.label}` : ''}`, `${s.local.date} ${hhmm(s.local)} ${m.tz}`, s.text, calText(m), m.expected || '—', finalText(m)]; }),
      { wrapCols: [2, 3, 5], caption: 'Sessions per market' })
      : el('p', { class: 'metaline' }, history ? 'None of your series is in a market whose hours this build holds.' : 'No price history is loaded, so no market is held.'),
    otherDet,
    el('p', { class: 'metaline', style: 'margin-top:6px' }, 'Whether a provider has confirmed a session final is not knowable here: no provider exists to confirm it. A bar is final by the clock — captured after its session’s close and settle — or, with no capture time recorded, once its session has closed.')));

  /* 3 — scan jobs. */
  const last30 = runs.slice(0, 30);
  const byStatus = {};
  last30.forEach(r => { byStatus[r.status || 'NO STATUS'] = (byStatus[r.status || 'NO STATUS'] || 0) + 1; });
  wrap.append(panel('Scan jobs', 'Runs are started by your task scheduler or by hand. There is no job queue, so nothing is ever queued. A run in progress is in the log as pending or running; what holds a second run off is the lock file, which this page cannot read.',
    runs.length ? el('div', { class: 'row row-wrap', style: 'gap:8px' }, Object.entries(byStatus).map(([s, n]) => el('span', { class: 'row', style: 'gap:6px;align-items:center' }, [scanRunChip(s), el('span', { class: 'metaline' }, `× ${n}`)]))) : null,
    runs.length ? el('p', { class: 'metaline', style: 'margin-top:6px' }, `The last ${last30.length} of ${runs.length} runs recorded. Latest: ${scanOpsWhen(runs[0].startedAt)}. `, scanOpsLink('/admin/scanner/jobs', 'Every run')) : null,
    dropped ? el('p', { class: 'metaline' }, `${scanOpsPlural(dropped, 'entry', 'entries')} in the run log could not be read and ${dropped === 1 ? 'is' : 'are'} left out.`) : null,
    scanOpsFileState('scan-runs.json', scanRunsFile, 'The worker writes it on every attempt, success or failure.'),
    !scanRunsFile && scanOpsAlertsDoc()?.lastRun ? el('p', { class: 'metaline' }, `Without it, the only record is the alerts file’s last successful run (${scanOpsWhen(scanOpsAlertsDoc().lastRun.at)}); a failure writes nothing there.`) : null));

  /* 4 — indicator cache. From the newest run that recorded one: a run that
     stopped before evaluating has no cache to report. A worker from before
     round 3 wrote the figures only to the alerts file's lastRun, so where no
     run in the log carries them, that is where they are read — and the
     page says which file they came from. */
  const lastRunDoc = scanOpsAlertsDoc()?.lastRun || null;
  const cacheRun = runs.find(r => scanRunCacheText(r.cacheStats)) || null;
  const cacheDoc = !cacheRun && scanRunCacheText(lastRunDoc?.cacheStats) ? lastRunDoc : null;
  const engineRun = runs.find(r => r.engine) || null;
  wrap.append(panel('Indicator cache', 'None is kept between runs. Each run computes an indicator once per series, data version and formula version, and reuses it across every setup in that run; the next run starts empty.',
    el('dl', { class: 'kv scan-kv' }, [el('dt', {}, 'Engine'), el('dd', {}, `this page runs scan ${SCAN_VERSION}${engineRun ? `; the last run to load one, ${engineRun.engine}` : ''}`),
      el('dt', {}, 'Last run’s cache'), el('dd', {}, cacheRun ? scanRunCacheText(cacheRun.cacheStats) : cacheDoc ? scanRunCacheText(cacheDoc.cacheStats) : 'not recorded'),
      el('dt', {}, 'Read from'), el('dd', {}, cacheRun ? `run ${cacheRun.id || '(no id)'}, ${scanOpsWhen(cacheRun.startedAt)}`
        : cacheDoc ? `the alerts file’s last run${cacheDoc.runId ? `, ${cacheDoc.runId}` : ''} (${scanOpsWhen(cacheDoc.at)}) — no run in the log carries the figures`
        : runs.length || lastRunDoc ? 'no run records its cache' : 'no run is recorded')])));

  /* 5 — alert engine. From the newest run that evaluated — one with counts.
     A run that was skipped, turned away by the lock or failed before
     evaluating has none, and that absence is not a zero: when the latest
     attempt is such a run it is named beside the one that did evaluate.
     So is a run that has counts but evaluated no bar — every market held
     back by the ready gate — which the dashboard, by scanStatus's rule,
     calls a run that "evaluated no bar"; this panel called it "the last
     run that evaluated", over a count of 0 pairs. */
  const evaluatedSome = (r) => { const n = scanRunCounts(r).evaluated; return n != null && (n > 0 || !!r.asOf); };
  const evalRun = runs.find(evaluatedSome) || null;
  const engSrc = evalRun || (lastRunDoc && evaluatedSome(lastRunDoc) ? lastRunDoc : null);
  const lc = scanRunCounts(engSrc);
  const latest = runs[0] || null;
  const cnt = (v) => (v == null ? 'not recorded' : fmtNum(v, 0));
  const fromDoc = (fn) => (evalRun ? fn(evalRun) : 'not in the alerts file’s last run — the run log carries it');
  /* The alerts file stands in whenever no run in the log evaluated — also
     with a log loaded that holds only skipped or failed runs, where "no run
     log is loaded" was false. */
  const noEvalWhy = runs.length ? 'no run in the run log evaluated anything' : scanRunsFile ? 'the run log holds no scan run' : 'no run log is loaded';
  wrap.append(panel('Alert engine', engSrc ? `The last run that evaluated: ${evalRun ? `${evalRun.id || 'a run with no id'}, ${scanOpsWhen(evalRun.startedAt)}` : `the alerts file’s last run, ${scanOpsWhen(lastRunDoc.at)} — ${noEvalWhy}`}.${latest && evalRun && latest !== evalRun ? ` The latest attempt, ${latest.id || scanOpsWhen(latest.startedAt)}, was ${(SCAN_RUN_STATUS[latest.status] || [null, String(latest.status || 'unrecorded').toLowerCase()])[1]} and evaluated nothing.` : ''} An alert is written before anything else happens to it, and nothing is ever sent, so no alert can be lost to a delivery failure.`
      : runs.length ? 'No run in the log evaluated anything: each was skipped, turned away, failed first or had every market held back as not ready.' : 'No run is recorded.',
    engSrc ? el('dl', { class: 'kv scan-kv scan-engine' }, [
      el('dt', {}, 'Evaluated'), el('dd', {}, lc.evaluated == null ? 'not recorded' : `${cnt(lc.evaluated)} setup × instrument pairs${lc.setups != null ? `, ${scanOpsPlural(lc.setups, 'setup')}` : ''}`),
      el('dt', {}, 'Matched'), el('dd', {}, cnt(lc.matched)),
      el('dt', {}, 'Recorded'), el('dd', {}, cnt(lc.recorded)), el('dt', {}, 'Already recorded (deduplicated)'), el('dd', {}, cnt(lc.deduped)),
      el('dt', {}, 'Held back by a cooldown'), el('dd', {}, cnt(lc.cooldown)), el('dt', {}, 'Still matching (not new)'), el('dd', {}, cnt(lc.continuing)),
      el('dt', {}, 'Untested'), el('dd', {}, cnt(lc.untested)),
      el('dt', {}, 'Series behind the rest'), el('dd', {}, lc.stale == null ? 'not recorded' : `${cnt(lc.stale)} — evaluated, on an older bar`),
      el('dt', {}, 'Provisional last bars'), el('dd', {}, lc.provisional == null ? 'not recorded' : `${cnt(lc.provisional)} — the bar before was evaluated`),
      el('dt', {}, 'Markets not ready'), el('dd', {}, fromDoc(scanRunSkippedMarketsText)),
      el('dt', {}, 'Caught up'), el('dd', {}, fromDoc(scanRunCatchUpText)),
      el('dt', {}, 'Version ledger'), el('dd', {}, fromDoc(scanRunLedgerText)),
      el('dt', {}, 'Delivered in the app'), el('dd', {}, lc.deliveries == null ? 'not recorded' : `${cnt(lc.deliveries)} — written to the record; nothing is sent`),
      el('dt', {}, 'Failed to record'), el('dd', {}, 'not a state: the record is one file, written whole or not at all'),
    ]) : null));

  /* 6 — notifications. */
  wrap.append(panel('Notifications', 'In-app only. Email, Telegram and push need a server, credentials and a contact address held under a privacy notice; this build has none of them.',
    el('p', { class: 'metaline' }, [`${st.notifications.text} `, scanOpsLink('/admin/scanner/delivery', 'Delivery')])));

  /* 7 — usage. */
  const a = st.active, refused = scanOpsRefused(a);
  wrap.append(panel('Usage', 'On this machine. There are no users to count.',
    el('dl', { class: 'kv scan-kv' }, [el('dt', {}, 'Active setups'), el('dd', {}, scanOpsSetupsDoc()
      ? `${a.enabled - a.expired} (of ${a.valid} valid, ${refused.file ? 'the whole file refused' : `${refused.setups} refused`})` : 'no setups file'),
      el('dt', {}, 'Monitored instruments'), el('dd', {}, st.monitored ? fmtNum(st.monitored.instruments, 0) : 'no price history loaded'),
      el('dt', {}, 'Alerts recorded'), el('dd', {}, (() => { const d = scanOpsAlertsDoc(); const l = Array.isArray(d) ? d : d?.alerts; return Array.isArray(l) ? fmtNum(l.length, 0) : 'no alerts file'; })())])));

  /* 8 — errors. The runs that did not finish their work: failed, cancelled
     and partial. A run turned away by the lock or skipped while paused
     carries a LOCK or no error, but another run (or the pause) accounts
     for it, so it is on Runs, not here. Each problem shows the correlation
     id the worker printed beside it on screen. */
  const errs = runs.filter(r => ['FAILED', 'PARTIAL', 'CANCELLED'].includes(r.status)).slice(0, 50);
  wrap.append(panel('Errors', 'Failed, cancelled and partial runs, newest first. Each problem carries the correlation id the worker printed beside it — the run id and the problem’s number — and node scanner/scan.mjs --runs finds the run.',
    errs.length ? scanOpsTable(['When', 'Run', 'Status', 'Category', 'What happened', 'Retry'], errs.map(r => {
      const ps = scanRunProblems(r), e = ps[0];
      return [scanOpsWhen(r.startedAt), el('code', {}, r.id || '—'), scanRunChip(r.status), e?.category || '—',
        e ? `${e.message}${e.correlation ? ` [${e.correlation}]` : ''}${ps.length > 1 ? ` — and ${scanOpsPlural(ps.length - 1, 'more problem')}, listed on Runs` : ''}`
          : r.status === 'PARTIAL' ? 'partial, with no problem recorded' : 'no error recorded',
        /* Kept whole on one line it was 433px, and once a phone turns the
           table into blocks it pushed a 390px page sideways. It may now
           break in one place only — between the command and the run id —
           so neither half is ever cut mid-word. */
        r.status !== 'PARTIAL' && r.id ? el('code', { class: 'scan-cmd-code' }, [el('span', { style: 'white-space:nowrap' }, 'node scanner/scan.mjs --retry'), ' ', el('span', { style: 'white-space:nowrap' }, r.id)])
          : r.status !== 'PARTIAL' ? 'node scanner/scan.mjs' : 'not needed — its alerts are recorded'];
    }), { wrapCols: [4], caption: 'Failed, cancelled and partial runs' })
      : el('p', { class: 'metaline' }, scanRunsFile ? 'No failed, cancelled or partial run is recorded.' : 'No run log, so no failure can be listed — and the alerts file records successes only.')));

  /* 9 — controls. */
  wrap.append(panel('Controls', 'Commands, run where the worker runs. Each is written to the worker’s control log (on Runs) with its time, its arguments and the machine’s own account name — a local, append-only file, not a verified identity.',
    scanOpsCmd('node scanner/scan.mjs --retry <run id>', 'Runs a failed run again. Alerts are keyed by setup, version, instrument, timeframe, bar and event, so nothing already recorded is recorded twice; a plain node scanner/scan.mjs is just as safe.'),
    scanOpsCmd('node scanner/scan.mjs --as-of YYYY-MM-DD', 'Replays a session: the history cut at that date, judged as that evening. Deduplicated against the record, so a replay adds only what was never recorded — and nothing is resent, because nothing is ever sent.'),
    scanOpsCmd('node scanner/scan.mjs --pause "why"', 'Stops scheduled runs: each records itself skipped, and writes nothing else, until you resume.'),
    scanOpsCmd('node scanner/scan.mjs --resume', 'Lifts the pause.'),
    scanOpsCmd('node scanner/scan.mjs --unlock', 'Clears data/scan.lock when a crashed run left it. A lock whose process is dead, or an hour old, is taken over by the next run anyway, and the takeover is recorded.'),
    scanOpsCmd('node scanner/scan.mjs --runs 20', 'Prints the last twenty runs with their errors — the way to inspect a failure.'),
    audit.length ? el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, `${scanOpsPlural(audit.length, 'control')} in the log; the latest ${scanOpsWhen(audit[0].at || audit[0].startedAt)} (${audit[0].action || 'control'}). `, scanOpsLink('/admin/scanner/jobs', 'The control log')) : null));
  /* Kept once files are opened here: opening scan-runs.json took the panel
     away in the same render, and with it the line naming any file chosen
     beside it that could not be opened. */
  if (!scanRunsFile || scanOpsOpened.length) wrap.append(panel('Your own files', 'On a machine that does not run the worker — the deployed site included — open the worker’s files from your disk to read them here.', scanOpsOpenFiles()));
  return wrap;
};

/* ----------------------------------------------------- round 3 — data page -- */
/* THE ADJUSTMENTS DRAFT. data/price-adjustments.json is the reader's own
   record, and this page never writes it: it composes the file — the actions
   the loaded one holds, plus the breaks ticked below — for the reader to
   download and save beside data/price-history.json. Nothing is applied
   until the file is there and the page is reloaded, and the worker reads
   the same file. Held for this tab only. */
const scanAdjDraft = new Map();
const scanAdjKey = (sym, date) => `${String(sym).toUpperCase()}|${date}`;
function scanAdjDraftDoc(now) {
  const loaded = Array.isArray(scanAdjustmentsFile) ? scanAdjustmentsFile : Array.isArray(scanAdjustmentsFile?.actions) ? scanAdjustmentsFile.actions : [];
  const held = new Set(loaded.filter(a => a && typeof a === 'object').map(a => scanAdjKey(a.symbol, a.date)));
  const added = [...scanAdjDraft.values()].filter(a => !held.has(scanAdjKey(a.symbol, a.date))).map(a => ({ ...a, recordedAt: now }));
  return { doc: { schema: 1, note: 'Corporate actions you recorded for your own price history. date is the first bar on the new basis; ratio is new units per old unit (2 for a 2-for-1 split, 0.5 for a 1-for-2 consolidation, 1 for a move that is the market\'s own). Save as data/price-adjustments.json (git-ignored); the page and node scanner/scan.mjs apply it on read.',
                     actions: [...loaded, ...added] }, loaded: loaded.length, added: added.length };
}
/* A break's state in words, as a chip with a label — never colour alone. */
const SCAN_BREAK_STATE = {
  unexplained: ['warning', 'unexplained'], remains: ['warning', 'still a break after the recorded ratio'], created: ['warning', 'made by the recorded ratio'],
  adjusted: ['good', 'adjusted'], acknowledged: ['good', 'recorded as the market’s move'],
};
const scanBreakChip = (st) => sevChip((SCAN_BREAK_STATE[st] || ['info'])[0], (SCAN_BREAK_STATE[st] || [null, st])[1]);
const scanRatioText = (r) => `×${Number(r.toPrecision(3))}`;

VIEWS.scannerAdminData = () => {
  const wrap = scanOpsPage('data', 'Data health',
    'Your price history as the engine reads it: every bar validated, gaps counted against the sessions of its market, dates checked against the days each market trades, price breaks named with what explains them, staleness judged against the clock. Nothing in the file is corrected here — only named.');
  let history = scanOpsHistory();
  /* A history opened from disk on this page arrives without the recorded
     actions the loader attaches; they are attached for this page's reading
     the same way, so it reports what the worker would apply. */
  if (history?.series && !Array.isArray(history.adjustments)) history = scanAttachAdjustments(history, scanAdjustmentsFile);
  if (!history?.series) {
    const c = el('section', { class: 'card' });
    c.append(cardHead('No price history loaded', 'There is nothing to check.'));
    c.append(scanOpsFileState('price-history.json', null, 'Your daily capture (node ingest/daily.mjs) or an import of your own export (node ingest/history-import.mjs) writes it.'));
    c.append(scanOpsOpenFiles());
    wrap.append(c);
    return wrap;
  }
  const now = scanOpsNow();
  const H = scanDataHealth(history, scanOpsRegistry(), now);
  const t = H.totals;
  const sum = el('section', { class: 'card' });
  sum.append(cardHead('The file', `data/price-history.json · schema ${H.file.schema} · written ${scanOpsWhen(H.file.generated)} · judged at ${scanOpsWhen(H.at)} · engine ${H.engine}`));
  const g = el('div', { class: 'grid scan-counts' });
  [['Series', t.series], ['Bars', t.bars], ['Invalid bars', t.invalid], ['Gaps counted', t.gaps], ['Price breaks', t.jumps, t.jumps ? `${fmtNum(t.unexplained, 0)} unexplained` : null], ['Stale series', t.stale], ['Provisional bars', t.provisional]]
    .forEach(([l, v, sub]) => g.append(statTile(l, fmtNum(v, 0), sub ? { sub } : {})));
  sum.append(g);
  /* A ratio of 1 records a break as the market's own move and adjusts
     nothing; counted with the applied actions, a file holding only such a
     record read "prices are adjusted on read for the 1 corporate action". */
  const applied = H.adjustments.actions.filter(a => a.state === 'applied').length;
  const acknowledged = H.adjustments.actions.filter(a => a.state === 'acknowledged').length;
  const ackText = acknowledged ? ` ${scanOpsPlural(acknowledged, 'break')} you recorded as the market’s own move (ratio 1) ${acknowledged === 1 ? 'is' : 'are'} explained, and ${acknowledged === 1 ? 'its' : 'their'} prices are not adjusted.` : '';
  sum.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `Held beyond closes and volumes: ${[H.file.ohlc ? 'open, high and low' : null, H.file.meta ? 'capture times' : null, H.file.corrections ? 'corrections' : null].filter(Boolean).join(', ') || 'nothing — no open, high, low, capture time or correction is in this file yet'}. ${applied
      ? `Prices are adjusted on read for the ${scanOpsPlural(applied, 'corporate action')} you recorded in data/price-adjustments.json — never for dividends; the file on disk is unchanged.`
      : 'No corporate action you recorded changes a price, so no price is adjusted.'}${ackText} An indicator is not computed across a break nothing explains.`));
  wrap.append(sum);

  const mk = el('section', { class: 'card' });
  mk.append(cardHead('Markets', 'In market order. The calendar is inferred from your own series — marked so — or, where fewer than five of your series share a market, weekdays with holidays unknown.'));
  mk.append(scanOpsTable(['Market', 'Series', 'Session', 'Calendar', 'Inferred holidays', 'Ambiguous days', 'Expected by now', 'Newest bar', 'Stale'],
    H.markets.map(m => [m.market ? `${m.market}${m.label && m.label !== m.market ? ` — ${m.label}` : ''}` : 'no market row', fmtNum(m.symbols, 0), `${m.session} (${m.tz})`,
      el('span', {}, [el('span', { class: 'chip' + (m.calendar.basis === 'inferred' ? ' chip-bronze' : '') }, m.calendar.basis === 'inferred' ? 'inferred' : scanMarket(m.market).days.length === 7 ? 'every day' : 'weekdays'), ' ', el('span', { class: 'caption' }, m.calendar.basis === 'inferred' ? `from ${m.calendar.series} series — not an exchange calendar` : 'holidays not held')]),
      m.calendar.inferredHolidays?.length ? `${m.calendar.inferredHolidays.length}${m.calendar.inferredHolidays.length <= 4 ? `: ${m.calendar.inferredHolidays.join(', ')}` : `, latest ${m.calendar.inferredHolidays[m.calendar.inferredHolidays.length - 1]}`}` : 'none',
      m.calendar.ambiguous?.length ? String(m.calendar.ambiguous.length) : 'none', m.expected || '—', m.newestBar || '—',
      m.staleSymbols.length ? `${m.staleSymbols.length} of ${m.symbols}` : 'none']), { wrapCols: [2, 3], caption: 'Health per market' }));
  wrap.append(mk);

  /* DATING. A bar dated by the UTC day of its timestamp lands a day early
     for an exchange ahead of UTC; the engine refuses it as NON_SESSION_DAY
     and the rest of the series is off by a day without looking wrong. The
     repair is a fetch dated in the exchange's own zone, never an edit of
     dates in place — so this card names the series and the command. */
  const dating = el('section', { class: 'card', 'aria-label': 'Dating' });
  dating.append(cardHead('Dating', 'Bars dated on a day their market does not trade, series whose weekdays are shifted, and sessions written under two dates. No date is rewritten — here or in the file.'));
  const shiftedS = H.series.filter(s => s.shifted), dupS = H.series.flatMap(s => s.duplicates), wkM = H.markets.filter(m => m.weekend.bars);
  const dg = el('div', { class: 'grid scan-counts', style: 'margin-bottom:var(--sm)' });
  [['Weekend-dated bars', t.weekend], ['Shifted series', t.shifted], ['Sessions held twice', t.duplicates]].forEach(([l, v]) => dg.append(statTile(l, fmtNum(v, 0))));
  dating.append(dg);
  if (!wkM.length && !shiftedS.length && !dupS.length) {
    dating.append(el('p', { class: 'metaline' }, 'Every bar falls on a weekday its market trades, no series is shifted, and no session is held under two dates.'));
  } else {
    const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    if (wkM.length) {
      dating.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Bars on a day the market does not trade'));
      dating.append(scanOpsTable(['Market', 'Bars', 'Series'], wkM.map(m => [m.market ? `${m.market}${m.label && m.label !== m.market ? ` — ${m.label}` : ''}` : 'no market row', fmtNum(m.weekend.bars, 0),
        m.weekend.symbols.slice(0, 6).map(x => `${x.symbol} (${x.bars})`).join(', ') + (m.weekend.symbols.length > 6 ? `, and ${m.weekend.symbols.length - 6} more` : '')]),
        { wrapCols: [2], caption: 'Weekend-dated bars per market' }));
    }
    if (shiftedS.length) {
      dating.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Series dated a day off'));
      dating.append(scanOpsTable(['Series', 'Market', 'Bars by weekday', 'Reading'], shiftedS.map(s => [s.symbol, s.market || 'no market row',
        s.weekdays.map((n, wd) => `${DAY[wd]} ${n}`).join(' · '),
        `a day ${s.shifted.direction} — ${s.shifted.partial ? 'part of the series' : 'the whole series'} (${fmtPct(s.shifted.share * 100, 1)} of its bars on a non-trading day)`]),
        { wrapCols: [2, 3], caption: 'Series whose weekdays are shifted' }));
    }
    if (dupS.length) {
      dating.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'One session under two dates'));
      dating.append(scanOpsPaged(dupS, (list) => scanOpsTable(['Series', 'Dates', 'Close', 'Why'], list.map(d => [d.symbol, `${d.dates[0]} and ${d.dates[1]}`, scanFmt(d.close, 4, false), d.why]),
        { wrapCols: [3], caption: 'Sessions held under two dates' }), { step: 20, noun: 'pairs' }));
    }
  }
  dating.append(scanOpsCmd('node ingest/history-check.mjs --report', 'Prints this report — weekend-dated bars per market, shifted series, sessions held twice, invalid bars and price breaks — from the history on this machine. Exits 2 when there is something to repair.'));
  dating.append(scanOpsCmd('node ingest/history-check.mjs --refetch', 'Fetches the shifted, weekend-dated and doubly-held series again through your provider reader, each bar dated in its exchange’s own zone. A value that changes is recorded as a correction, and the old weekend copies the provider superseded move to the rejects file — nothing is lost, and no date is moved. Add --dry to see the run first. Personal lane: Yahoo, under its terms, for your own research.'));
  wrap.append(dating);

  /* PRICE BREAKS AND ADJUSTMENTS. Each break with what explains it, the
     recorded actions with what became of each, and the draft of the file. */
  const brk = el('section', { class: 'card', 'aria-label': 'Price breaks and adjustments' });
  brk.append(cardHead('Price breaks and adjustments', 'A close-to-close move above ×1.5 or below ×0.67 is a break. No corporate-action feed is held: a break is explained only by an action you record, and until then no indicator is computed across it (INVALID_INPUT, UNADJUSTED_BREAK).'));
  const adj = H.adjustments;
  /* A file with no list of actions is refused whole: its one problem has no
     entry (index null), and it read "0 actions read, 1 entry refused" over
     a list saying "the file: no list of actions". Entries are counted as
     entries; the file refused whole says so. */
  const refusedEntries = adj.problems.filter(p => p.index != null).length, refusedWhole = adj.problems.some(p => p.index == null);
  const fileLine = scanAdjustmentsFile || adj.actions.length
    ? el('p', { class: 'metaline' }, `data/price-adjustments.json — ${refusedWhole ? 'refused whole, so no action is read from it' : `${scanOpsPlural(adj.actions.length, 'action')} read`}${adj.version !== 'none' ? ` (${adj.version})` : ''}${refusedEntries ? `, ${scanOpsPlural(refusedEntries, 'entry', 'entries')} refused` : ''}.`)
    : scanOpsFileState('price-adjustments.json', null, 'You write it yourself: tick a break below, download the file and save it beside data/price-history.json.');
  fileLine.style.marginBottom = 'var(--sm)';
  brk.append(fileLine);
  if (adj.problems.length) {
    brk.append(el('ul', { class: 'metaline', style: 'margin:calc(-1 * var(--sm) + 4px) 0 var(--sm) 18px' }, adj.problems.map(p => el('li', {}, `${p.index != null ? `entry ${p.index + 1}` : 'the file'}${p.symbol ? ` (${p.symbol}${p.date ? ` ${p.date}` : ''})` : ''}: ${p.why}`))));
  }
  const allBreaks = H.series.flatMap(s => s.jumps.map(j => ({ ...j, symbol: s.symbol })));
  const draftHost = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center;margin-top:var(--sm)' });
  const drawDraft = () => {
    const d = scanAdjDraftDoc(scanOpsNow());
    const text = JSON.stringify(d.doc, null, 2);
    draftHost.replaceChildren(
      el('span', { class: 'metaline' }, d.added ? `The draft holds ${scanOpsPlural(d.loaded + d.added, 'action')}: ${d.loaded} from the file, ${d.added} ticked here. Nothing applies until it is saved as data/price-adjustments.json and the page reloaded.` : 'Tick a break to add it to a draft of the file; nothing is applied from here.'),
      el('button', { class: 'btn btn-ghost btn-sm', disabled: d.added ? null : '', onclick: async () => {
        try { await navigator.clipboard.writeText(text); toast('Adjustments JSON copied — save it as data/price-adjustments.json'); }
        catch { toast('Could not reach the clipboard — download the file instead'); }
      } }, 'Copy JSON'),
      el('button', { class: 'btn btn-primary btn-sm', disabled: d.added ? null : '', onclick: () => { scanDownload('price-adjustments.json', d.doc); toast('Saved price-adjustments.json — move it into data/ beside price-history.json, then reload'); } }, 'Download price-adjustments.json'));
  };
  const tick = (b, ratio, kind, label) => {
    const k = scanAdjKey(b.symbol, b.bar);
    const on = scanAdjDraft.get(k)?.ratio === ratio;
    const id = `scan-adj-${k}-${ratio}`.replace(/[^A-Za-z0-9_-]/g, '-');
    const btn = el('button', { id, class: 'btn btn-ghost btn-sm', 'aria-pressed': on ? 'true' : 'false', 'aria-label': `Record ${b.symbol} ${b.bar} as ${label}` }, on ? `✓ ${label}` : label);
    btn.addEventListener('click', () => {
      if (scanAdjDraft.get(k)?.ratio === ratio) scanAdjDraft.delete(k);
      else scanAdjDraft.set(k, { symbol: b.symbol, date: b.bar, ratio, kind, note: `recorded from the data page: the close moved ${scanRatioText(b.ratio)} from ${b.prev} to ${b.bar}` });
      scanOpsRerender(id);
    });
    return btn;
  };
  if (!allBreaks.length) brk.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, 'No series has a price break.'));
  else {
    brk.append(scanOpsPaged(allBreaks, (list) => scanOpsTable(['Series', 'Break', 'Move', 'Looks like', 'State', 'Record as'], list.map(b => [b.symbol, `${b.prev} → ${b.bar}`,
      `${scanRatioText(b.ratio)}${b.adjustedRatio != null && b.state !== 'created' ? `, ${scanRatioText(b.adjustedRatio)} adjusted` : ''}`, b.tag === 'unexplained' ? 'no plain split ratio' : b.tag, scanBreakChip(b.state),
      b.state === 'unexplained' ? el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
        b.suggestedRatio ? tick(b, b.suggestedRatio, b.suggestedRatio > 1 ? 'split' : 'consolidation', `${b.tag} (ratio ${Number(b.suggestedRatio.toPrecision(4))})`) : null,
        tick(b, 1, 'other', 'market’s own move (ratio 1)')].filter(Boolean))
        : b.action ? `ratio ${b.action.ratio} (${b.action.kind || 'no kind'}) recorded` : '—']),
      { wrapCols: [3, 5], caption: 'Price breaks and what explains each' }), { step: 25, noun: 'breaks' }));
    brk.append(draftHost);
    drawDraft();
  }
  if (adj.actions.length) {
    brk.append(el('h3', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Recorded actions'));
    brk.append(scanOpsTable(['Series', 'First bar on the new basis', 'Ratio', 'Kind', 'What became of it'],
      adj.actions.map(a => [a.symbol, a.date, String(a.ratio), a.kind, `${a.state.replace(/-/g, ' ')} — ${a.why}${a.note ? ` · “${a.note}”` : ''}`]),
      { wrapCols: [4], caption: 'Recorded corporate actions' }));
  }
  wrap.append(brk);

  const flagged = (s) => s.invalid.length || s.gaps.some(x => x.counted) || s.jumps.length || s.stale || s.shifted || s.duplicates.length || s.dropped.badDate || s.dropped.nonFinite || s.dropped.nonPositive;
  const ser = el('section', { class: 'card' });
  const only = el('button', { class: 'btn btn-ghost btn-sm', 'aria-pressed': 'true' }, 'Only series with something to look at');
  ser.append(cardHead('Series', 'In market order, then symbol order — the order of the file’s keys, not of anything about the series.'));
  const host = el('div');
  const draw = (all) => {
    const rows = H.series.filter(s => all || flagged(s));
    host.replaceChildren(rows.length ? scanOpsPaged(rows, (list) => scanOpsTable(['Series', 'Market', 'Bars', 'First … last', 'Invalid', 'Gaps', 'Price breaks', 'Volume', 'Stale', 'Keep limit'],
      list.map(s => [s.symbol, s.market || 'no market row', fmtNum(s.bars, 0), `${s.first || '—'} … ${s.last || '—'}`,
        s.invalid.length ? `${s.invalid.length}: ${s.invalid.slice(0, 3).map(x => `${x.date} ${x.codes.join('/')}`).join('; ')}${s.invalid.length > 3 ? '; …' : ''}` : 'none',
        (() => { const c = s.gaps.filter(x => x.counted); return s.gaps.length ? `${c.length} counted${s.gaps.length - c.length ? `, ${s.gaps.length - c.length} read as a possible holiday` : ''}${c.length ? ` (latest ${c[c.length - 1].after} → ${c[c.length - 1].before})` : ''}` : 'none'; })(),
        s.jumps.length ? s.jumps.slice(0, 2).map(j => `${j.bar} ${fmtPct(j.pct, 0)} (${j.tag === 'unexplained' ? '' : `${j.tag}; `}${(SCAN_BREAK_STATE[j.state] || [null, j.state])[1]})`).join('; ') + (s.jumps.length > 2 ? '; …' : '') : 'none',
        `${Math.round(s.volumeCoverage * 100)}% of bars`, s.stale ? `${s.behindSessions} session${s.behindSessions === 1 ? '' : 's'} behind ${s.stale.expected}` : 'no',
        /* The store's keep, read from the engine rather than typed: this
           said 500 after the store moved to 2000. */
        s.atKeepLimit ? `at the ${fmtNum(SCAN_HISTORY_KEEP, 0)}-bar keep` : 'no']), { wrapCols: [4, 5, 6], caption: 'Health per series' }), { step: 50, noun: 'series' })
      : el('p', { class: 'metaline' }, 'Nothing to look at: no series has an invalid bar, a counted gap, a price break, a shifted date or a stale last bar.'));
  };
  let all = false;
  only.addEventListener('click', () => { all = !all; only.setAttribute('aria-pressed', all ? 'false' : 'true'); only.textContent = all ? 'Show only series with something to look at' : 'Only series with something to look at'; draw(all); });
  ser.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center;margin-bottom:var(--sm)' }, [only,
    el('span', { class: 'metaline' }, `${H.series.filter(flagged).length} of ${H.series.length} series have something to look at.`)]));
  ser.append(host);
  draw(false);
  wrap.append(ser);
  return wrap;
};

const scanJobsState = { filter: 'all' };
VIEWS.scannerAdminJobs = () => {
  const wrap = scanOpsPage('jobs', 'Runs',
    'Every attempt the worker recorded — completed, partial, failed or skipped — newest first, with its duration, its counts and its error; and the log of the controls run against it.');
  const { runs, audit, dropped } = scanOpsRuns();
  const card = el('section', { class: 'card' });
  if (!runs.length) {
    card.append(cardHead('No run recorded', scanRunsFile ? 'The run log is present and holds no scan run.' : 'There is no run log on this machine.'));
    card.append(scanOpsFileState('scan-runs.json', scanRunsFile, 'The worker (node scanner/scan.mjs) writes it on every attempt, success or failure.'));
    /* The run's range of bars, as its lastRun records it (asOfFrom), not
       only the newest of them. */
    const lr = scanOpsAlertsDoc()?.lastRun;
    if (lr) card.append(el('p', { class: 'metaline' }, `The alerts file records one successful run, ${scanOpsWhen(lr.at)} on bars of ${lr.asOf ? scanBarRange(lr.asOfFrom, lr.asOf) : '—'} (${lr.engine || 'engine unknown'}). It is overwritten by the next success, and a failure writes nothing, so it is not a history.`));
    if (!scanRunsFile) card.append(scanOpsOpenFiles());
    wrap.append(card);
  } else {
    /* One filter per state the worker writes (scanner/scan.mjs
       RUN_STATUSES), and "other" for a status this page does not know, so
       a run a newer worker records is never filtered out of sight. A group
       with no run is left out, except the one chosen. */
    const known = new Set(Object.keys(SCAN_RUN_STATUS));
    const GROUPS = [
      ['all', 'All', () => true],
      ['COMPLETED', 'Completed', r => r.status === 'COMPLETED'],
      ['PARTIAL', 'Partial', r => r.status === 'PARTIAL'],
      ['FAILED', 'Failed', r => r.status === 'FAILED'],
      ['CANCELLED', 'Cancelled', r => r.status === 'CANCELLED'],
      ['SKIPPED', 'Skipped', r => /^SKIPPED/.test(r.status || '')],
      ['UNFINISHED', 'Pending or running', r => r.status === 'PENDING' || r.status === 'RUNNING'],
      ['OTHER', 'Other', r => !known.has(r.status)],
    ];
    const F = scanJobsState;
    if (!GROUPS.some(([k]) => k === F.filter)) F.filter = 'all';
    card.append(cardHead(`${scanOpsPlural(runs.length, 'run')} recorded`, 'Newest first. Open a row for its history, readiness, problems and how it ran.'));
    const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter runs by status', style: 'margin-bottom:var(--sm)' });
    const host = el('div');
    const draw = () => {
      seg.replaceChildren(...GROUPS.filter(([k, , fn]) => k === 'all' || k === F.filter || runs.some(fn)).map(([k, label, fn]) => el('button', {
        'aria-pressed': F.filter === k ? 'true' : 'false', 'aria-selected': F.filter === k ? 'true' : 'false',
        onclick: () => { F.filter = k; draw(); seg.querySelector('[aria-pressed="true"]')?.focus(); } }, `${label} (${runs.filter(fn).length})`)));
      const list = runs.filter(GROUPS.find(([k]) => k === F.filter)[2]);
      host.replaceChildren(list.length ? scanOpsPaged(list, (rows) => scanOpsDetailRows(scanOpsTable(['Started', 'Status', 'Trigger', 'Duration', 'Bars', 'Counts', 'Detail'],
        rows.map(scanJobRow), { wrapCols: [5, 6], caption: 'Runs, newest first' })), { step: 50, noun: 'runs' }) : el('p', { class: 'metaline' }, 'No run has this status.'));
    };
    draw();
    card.append(seg, host);
    if (dropped) card.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, `${scanOpsPlural(dropped, 'entry', 'entries')} could not be read and ${dropped === 1 ? 'is' : 'are'} left out.`));
    card.append(scanOpsFileState('scan-runs.json', scanRunsFile, ''));
    wrap.append(card);
  }
  const au = el('section', { class: 'card' });
  au.append(cardHead('Control log', 'Pause, resume, replay, retry, unlock and lock takeovers, as the worker recorded them: when, what it did, and the account on the machine that ran it. A local append-only file — not tamper-evident, and the account name is the machine’s own, not a verified identity, because there are no accounts here.'));
  au.append(audit.length ? scanOpsTable(['When', 'Control', 'What it did', 'Account on machine'], audit.map(x => {
    const args = Array.isArray(x.args) ? x.args : Array.isArray(x.argv) ? x.argv : null;
    return [scanOpsWhen(x.at || x.startedAt), el('span', { class: 'chip chip-bronze' }, x.action || x.control || 'control'),
      el('span', {}, [scanAuditText(x), args?.length ? el('span', { class: 'caption', style: 'display:block;margin-top:2px;overflow-wrap:anywhere' }, args.join(' ')) : null]),
      x.operator || x.host ? `${x.operator || 'account not recorded'}${x.host ? ` on ${x.host}` : ''}` : 'not recorded'];
  }), { wrapCols: [2], caption: 'Controls, newest first' })
    : el('p', { class: 'metaline' }, runs.length || scanRunsFile ? 'No control has been run.' : 'No run log, so no control is recorded.'));
  wrap.append(au);
  return wrap;
};

/* A run's detail opens in a row of its own under the run, the table's full
   width. Kept in the last column it was a 260px strip, dozens of lines tall
   at 1440, once the run record carried its history, lock, transitions and
   the round 3 fields. The disclosure stays a native <details> in the run's
   row — its keyboard and its open state are the browser's — and what it
   discloses sits in the row below, shown while it is open. */
function scanOpsDetailRows(wrap) {
  const table = wrap.querySelector('table');
  const cols = table ? table.querySelectorAll('thead th').length : 0;
  (table ? [...table.querySelectorAll(':scope > tbody > tr')] : []).forEach(tr => {
    const det = tr.querySelector(':scope > td details.scan-row-det');
    if (!det) return;
    const body = el('div', { class: 'scan-row-body' });
    [...det.childNodes].filter(n => n.nodeName !== 'SUMMARY').forEach(n => body.append(n));
    const row = el('tr', { class: 'scan-detail-row' }, el('td', { colspan: String(cols), style: 'white-space:normal;padding-top:0' }, body));
    tr.after(row);
    /* No rule between a run and its open detail, and none under the last
       run while its detail is closed, where the hidden row would otherwise
       leave the table a doubled bottom edge. */
    const sync = () => {
      scanOpsShow(row, det.open);
      const clear = det.open || !row.nextElementSibling;
      [tr, ...tr.cells].forEach(n => { n.style.borderBottomColor = clear ? 'transparent' : ''; });
    };
    sync();
    det.addEventListener('toggle', sync);
  });
  return wrap;
}
/* One run, as a row of the runs table: the columns a reader scans, and a
   disclosure with everything else the worker recorded about it. */
function scanJobRow(r) {
  const c = scanRunCounts(r), probs = scanRunProblems(r);
  const unfinished = r.status === 'PENDING' || r.status === 'RUNNING';
  const evaluated = c.evaluated != null;
  const notReady = scanRunReadiness(r).filter(m => m.inRun !== false && m.state && m.state !== 'READY');
  const det = el('details', { class: 'scan-row-det' });
  det.append(el('summary', { class: 'caption' }, probs[0] ? `${probs[0].category}: ${probs[0].message}`.slice(0, 90)
    : r.skipReason ? String(r.skipReason).slice(0, 90) : unfinished ? `Recorded as ${String(r.status).toLowerCase()}` : 'Details'));
  const kv = (label, value) => (value == null || value === '' ? [] : [el('dt', {}, label), el('dd', {}, value)]);
  const hms = (t) => (t ? String(t).slice(11, 19) : '—');
  const take = r.lockTakeover && typeof r.lockTakeover === 'object' ? r.lockTakeover : null;
  det.append(el('dl', { class: 'kv scan-kv' }, [
    ...kv('Run id', el('code', {}, r.id || '—')),
    ...kv('Engine', r.engine || (r.error?.category === 'ENGINE' ? 'could not be loaded' : 'not loaded')),
    ...kv('Exit code', r.exitCode != null ? String(r.exitCode) : unfinished ? 'none yet' : 'not recorded'),
    ...kv('Finished', r.finishedAt ? scanOpsWhen(r.finishedAt) : unfinished ? 'not yet' : 'not recorded'),
    /* The clock the run judged staleness by: the real one, or the --now a
       check or a retry gave it. */
    ...kv('Judged at', r.now && r.now !== r.startedAt ? scanOpsWhen(r.now) : null),
    ...kv('History', scanRunHistoryText(r)),
    ...kv('Setups hash', r.setupsHash || (r.historyNewest || r.historyHash ? 'not recorded' : 'not read')),
    ...kv('Skipped because', r.skipReason || null),
    ...kv('Compared with', r.comparedWith || null),
    ...kv('Replay of', r.replayAsOf || null),
    ...kv('Retry of', r.retryOf ? `${r.retryOf}${r.retryBasis ? ` — on ${r.retryBasis}` : ''}` : null),
    ...kv('Lock', take ? `taken over from pid ${take.previous?.pid ?? '?'}${take.previous?.runId ? ` (${take.previous.runId})` : ''} — its holder was ${take.why === 'dead' ? 'no longer running' : take.why === 'stale' ? 'over an hour old' : take.why || 'unreadable'}` : null),
    ...kv('Run by', r.operator || r.host ? `${r.operator || 'account not recorded'}${r.host ? ` on ${r.host}` : ''}${r.pid ? ` (pid ${r.pid})` : ''}` : null),
    ...kv('Went through', Array.isArray(r.transitions) && r.transitions.length ? r.transitions.map(t => `${String(t?.status || '?').toLowerCase()} ${hms(t?.at)}`).join(' → ') : null),
    ...(evaluated ? [
      ...kv('Series behind the rest', c.stale == null ? 'not recorded' : fmtNum(c.stale, 0)),
      ...kv('Provisional last bars', c.provisional == null ? 'not recorded' : fmtNum(c.provisional, 0)),
      ...kv('Delivered in the app', c.deliveries == null ? 'not recorded' : fmtNum(c.deliveries, 0)),
      ...kv('Indicator cache', scanRunCacheText(r.cacheStats) || 'not recorded on the run'),
      ...kv('Markets not ready', scanRunSkippedMarketsText(r)),
      ...kv('Caught up', scanRunCatchUpText(r)),
      ...kv('Version ledger', scanRunLedgerText(r)),
    ] : []),
  ]));
  if (unfinished) det.append(el('p', { class: 'metaline' }, `Recorded as ${String(r.status).toLowerCase()}. It is either running now, or its process ended before it could close the record: the next run that takes the lock closes it as abandoned (failed), and node scanner/scan.mjs --unlock does so by hand.`));
  /* The worker's messages usually begin with the setup; it is added only
     where one does not. */
  const lines = [...probs.map(p => `${p.category}${p.setup && !p.message.startsWith(p.setup) ? ` · ${p.setup}` : ''}: ${p.message}${p.correlation ? ` [${p.correlation}]` : ''}`),
    ...notReady.map(m => m.text || `${m.market || 'no market row'}: ${String(m.state).toLowerCase()}`)];
  if (lines.length) det.append(el('ul', { class: 'rulelist' }, lines.slice(0, 40).map(t => el('li', {}, t))));
  if ((r.status === 'FAILED' || r.status === 'CANCELLED') && r.id) det.append(scanOpsCmd(`node scanner/scan.mjs --retry ${r.id}`, 'Runs it again on its own session dates; nothing already recorded is recorded twice.'));
  /* A count the record does not hold is said to be missing, never shown
     as 0 (this read "0 matched" of a run that recorded no match count). */
  const counts = evaluated ? `${fmtNum(c.evaluated, 0)} evaluated · ${c.matched == null ? 'no count of matches' : `${fmtNum(c.matched, 0)} matched`} · ${c.recorded == null ? 'no count of alerts recorded' : `${fmtNum(c.recorded, 0)} recorded`}${c.deduped ? ` · ${fmtNum(c.deduped, 0)} already recorded` : ''}${c.untested ? ` · ${fmtNum(c.untested, 0)} untested` : ''}`
    : /^SKIPPED/.test(r.status || '') ? 'none — skipped before evaluating' : r.status === 'FAILED' || r.status === 'CANCELLED' ? 'none — it stopped before evaluating' : unfinished ? 'not yet' : 'not recorded';
  return [scanOpsWhen(r.startedAt), scanRunChip(r.status), r.trigger || r.origin || '—', scanOpsDuration(r.durationMs ?? (Date.parse(r.finishedAt) - Date.parse(r.startedAt))),
    r.asOf ? scanBarRange(r.asOfFrom, r.asOf) : '—', counts, det];
}
/* One control, in words: what the worker recorded it doing. */
function scanAuditText(x) {
  const n = (v) => (Number.isFinite(v) ? fmtNum(v, 0) : 'not recorded');
  const st = (s) => (SCAN_RUN_STATUS[s] || [null, s ? String(s).toLowerCase() : 'status not recorded'])[1];
  const prev = x.previous && typeof x.previous === 'object' ? ` — the holder was pid ${x.previous.pid ?? '?'}${x.previous.runId ? `, ${x.previous.runId}` : ''}` : '';
  const closed = x.closedRun ? `; ${x.closedRun} was closed as abandoned` : '';
  switch (x.action) {
    case 'pause': return x.reason ? `paused: ${x.reason}` : 'paused, with no reason given';
    case 'resume': return `resumed${x.pausedSince ? `, paused since ${scanOpsWhen(x.pausedSince)}` : ''}${x.reason ? ` (${x.reason})` : ''}`;
    case 'replay': return `replayed ${x.asOf || x.replayAsOf || 'a date not recorded'}: ${st(x.status)}, ${n(x.added)} added, ${n(x.deduped)} already recorded${x.runId ? ` · ${x.runId}` : ''}`;
    case 'retry': return `retried ${x.retryOf || 'a run not recorded'}: ${st(x.status)}, ${n(x.added)} added, ${n(x.deduped)} already recorded${x.runId ? ` · ${x.runId}` : ''}`;
    case 'unlock': return `removed the lock${x.forced ? ' by force' : x.why ? ` (${x.why})` : ''}${prev}${closed}`;
    case 'lock-takeover': return `a run took the lock over, its holder ${x.why === 'dead' ? 'no longer running' : x.why === 'stale' ? 'over an hour old' : x.why || 'unreadable'}${prev}${closed}${x.runId ? ` · ${x.runId}` : ''}`;
    case 'runs-log-reset': return `the run log could not be read, so it was set aside${x.detail?.setAside ? ` as ${x.detail.setAside}` : ''} and a new one started`;
    default: return x.reason || x.detail?.text || 'recorded, with nothing more';
  }
}

/* The channels the brief names, and what each is here. The file's own
   statement wins where the worker wrote one; these are what the plan fixes
   when it has not. */
const SCAN_OPS_CHANNELS = [
  ['IN_APP', 'In-app', 'ACTIVE', 'The worker writes each alert to data/scan-alerts.json; these pages read it. Read and archived are kept in this browser.'],
  ['EMAIL', 'Email', 'NOT_CONFIGURED', 'Needs a server to send from, an operating entity to send as, and an address held under a PDPA privacy notice. None exists, and credentials never go in a page.'],
  ['TELEGRAM', 'Telegram', 'NOT_CONFIGURED', 'A bot token must live on a server, and binding a chat id is holding a contact identifier under a privacy notice; neither exists.'],
  ['PUSH', 'Web push', 'NOT_CONFIGURED', 'Not built: web push belongs to a later live-scanning release (P2), which is not available here, and needs a push service and a server to hold subscriptions.'],
];
VIEWS.scannerAdminDelivery = () => {
  const wrap = scanOpsPage('delivery', 'Delivery',
    'Where scanner alerts go. In-app is the only channel: the alert is the record, written before anything else, and nothing is sent anywhere.');
  const D = scanDeliveriesFile;
  const fileCh = D?.channels ? (Array.isArray(D.channels) ? Object.fromEntries(D.channels.filter(Boolean).map(c => [c.channel || c.id, c])) : D.channels) : {};
  const unread = scanOpsUnread();
  const card = el('section', { class: 'card' });
  card.append(cardHead('Channels', 'Each with its status and the reason. A channel that is not configured is shown as not configured — never as available, and never with a count of zero sends.'));
  card.append(scanOpsTable(['Channel', 'Status', 'Why'], SCAN_OPS_CHANNELS.map(([id, label, status, why]) => {
    const f = fileCh?.[id] || {};
    const s = f.status || status;
    const ok = s === 'ACTIVE' || s === 'ENABLED';
    const extra = id === 'IN_APP' ? (unread == null ? ' Unread in this browser: not counted here.' : ` ${scanOpsPlural(unread, 'alert')} unread in this browser.`) : '';
    /* The worker writes `why` for a channel that is not configured and
       `meaning` for the one that is (scan.mjs CHANNELS). */
    return [label, sevChip(ok ? 'good' : 'info', ok ? 'active' : s === 'NOT_CONFIGURED' ? 'not configured' : String(s).toLowerCase().replace(/_/g, ' ')), `${f.why || f.meaning || f.reason || f.text || why}${extra}`];
  }), { wrapCols: [2], caption: 'Delivery channels' }));
  card.append(scanOpsFileState('scan-deliveries.json', D, 'The worker writes it: the channel list, and one in-app delivery record per alert.'));
  wrap.append(card);

  const recs = Array.isArray(D?.deliveries) ? D.deliveries.filter(x => x && typeof x === 'object') : [];
  const rc = el('section', { class: 'card' });
  rc.append(cardHead('Delivery records', 'One per alert and channel, newest first. There is no queue and no retry, because nothing is sent: an in-app record is complete when the alert is written.'));
  const alertsDoc = scanOpsAlertsDoc();
  const alerts = Array.isArray(alertsDoc) ? alertsDoc : Array.isArray(alertsDoc?.alerts) ? alertsDoc.alerts : [];
  const byId = new Map(alerts.map(a => [a.id || (a.key ? scanAlertId(a.key) : null), a]).filter(([k]) => k));
  rc.append(recs.length ? scanOpsPaged([...recs].sort((a, b) => String(b.sentAt || b.at || '').localeCompare(String(a.sentAt || a.at || ''))),
    (rows) => scanOpsTable(['Alert', 'Channel', 'Status', 'Attempts', 'When', 'Error'], rows.map(r => {
      const a = byId.get(r.alertId);
      return [a ? scanOpsAlertLink(a, `${a.setupName || a.setupId} · ${a.symbol} · ${a.candleDate || a.bar}`) : el('code', {}, r.alertId || '—'), r.channel || '—',
        String(r.status || '—').toLowerCase(), r.attemptCount != null ? String(r.attemptCount) : '—', scanOpsWhen(r.sentAt || r.at), r.errorCode || '—'];
    }), { caption: 'Delivery records' }), { step: 50, noun: 'records' })
    : el('p', { class: 'metaline' }, D ? 'The file holds no delivery record.' : 'No delivery file, so no record is listed. Every alert in the alerts file is in-app by construction.'));
  wrap.append(rc);
  return wrap;
};
