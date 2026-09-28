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
/* The alerts pages' unread count, guarded: null when that function is not
   in this build, or when it has no alerts file to count. */
function scanOpsUnread() {
  if (typeof scanUnreadCount !== 'function') return null;
  try { const n = scanUnreadCount(); return Number.isInteger(n) ? n : null; } catch { return null; }
}

/* ----------------------------------------------------------------- pieces -- */
const scanOpsDay = (t) => (t ? String(t).slice(0, 10) : '—');
const scanOpsWhen = (t) => (t ? `${String(t).replace('T', ' ').slice(0, 16)} UTC` : '—');
const scanOpsAge = (t) => {
  const ms = Date.parse(scanOpsNow()) - Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  const d = Math.floor(ms / 86400000);
  return d < 1 ? 'today' : d === 1 ? 'a day ago' : `${d} days ago`;
};
const scanOpsDuration = (ms) => (!Number.isFinite(ms) ? '—' : ms < 1000 ? `${Math.round(ms)} ms`
  : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const scanOpsPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
function scannerSubnav(active) {
  const row = el('nav', { class: 'segmented scan-subnav', 'aria-label': 'Scanner sections' });
  SCANNER_SUBNAV.forEach(s => row.append(scanOpsLink(s.path, s.label, {
    'aria-selected': active === s.id ? 'true' : 'false', 'aria-current': active === s.id ? 'page' : null })));
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
  SKIPPED_NO_DATA: ['info', 'skipped — no history'], SKIPPED_NO_SETUPS: ['info', 'skipped — no setups'],
  SKIPPED_LOCKED: ['warning', 'skipped — another run held the lock'], SKIPPED_PAUSED: ['info', 'skipped — paused'],
  RUNNING: ['info', 'running'], PENDING: ['info', 'pending'],
};
const scanRunChip = (s) => sevChip((SCAN_RUN_STATUS[s] || ['info'])[0], (SCAN_RUN_STATUS[s] || [null, s ? String(s).toLowerCase().replace(/_/g, ' ') : 'no status'])[1]);
/* A run's counts, whichever form the worker wrote them in. */
function scanRunCounts(r) {
  const k = r?.skippedByReason || {};
  const n = (v) => (Number.isFinite(v) ? v : null);
  return { setups: n(r?.setups), evaluated: n(r?.evaluated), matched: n(r?.matched), recorded: n(r?.recorded), untested: n(r?.untested),
           deduped: n(r?.deduped ?? k.alreadyRecorded), cooldown: n(r?.cooldown ?? k.cooldown), continuing: n(r?.continuing) };
}
const scanRunError = (r) => (r?.error ? { category: r.error.category || r.error.code || 'error', code: r.error.code || null,
  message: r.error.message || String(r.error), correlation: r.error.correlationId || r.id || null } : null);

/* A condition list: each line says whether it held, then the engine's own
   sentence with the values it compared. Untested is not failed. */
function scanOpsConds(conds) {
  const tag = { MET: ['held', 'scan-c-met'], NOT_MET: ['not held', 'scan-c-not'], UNAVAILABLE: ['untested', 'scan-c-na'] };
  return el('ul', { class: 'scan-conds' }, (conds || []).map(c => {
    const [label, cls] = tag[c.state] || ['—', 'scan-c-na'];
    return el('li', {}, [el('span', { class: `scan-c ${cls}` }, label), ' ', c.text || '(no text)']);
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
/* Rows a page at a time, so a long list is bounded on screen too. */
function scanOpsPaged(rows, build, { step = 50, noun = 'rows' } = {}) {
  const host = el('div');
  let shown = Math.min(step, rows.length);
  const draw = () => {
    host.replaceChildren(build(rows.slice(0, shown)));
    if (shown < rows.length) host.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px;align-items:center' }, [
      el('span', { class: 'metaline' }, `Showing ${shown} of ${rows.length} ${noun}.`),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { shown = Math.min(rows.length, shown + step); draw(); } }, `Show ${Math.min(step, rows.length - shown)} more`),
    ]));
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
  [/price-history/i, 'price-history.json', (d) => { if (typeof scanHistoryFile !== 'undefined') scanHistoryFile = d; }],
];
function scanOpsOpenFiles() {
  const box = el('div', { class: 'scan-open' });
  const input = el('input', { type: 'file', accept: '.json,application/json', multiple: '', hidden: '', 'aria-hidden': 'true', tabindex: '-1' });
  const out = el('p', { class: 'metaline', role: 'status' });
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
    if (took.length) scanOpsRead = true;
    toast(took.length ? `Opened ${took.join(', ')} — in this tab only` : 'Nothing opened');
    if (took.length) render();
    else out.textContent = left.length ? `Not opened: ${left.join('; ')}.` : '';
  });
  box.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' }, [
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => input.click() }, 'Open your files…'), input,
    el('span', { class: 'metaline' }, 'scan-runs, scan-alerts, scan-setups, price-history, scan-control, scan-deliveries, ingest-runs'),
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
  tiles.append(tile('Are my setups active?',
    setupsDoc ? `${a.enabled - a.expired} active` : 'No setups file',
    setupsDoc ? [`${a.valid} valid in data/scan-setups.json: ${a.enabled} enabled, ${a.disabled} disabled, ${a.expired} expired.`,
                 a.refused ? `${scanOpsPlural(a.refused, 'problem')} refused — the worker leaves those setups out.` : null]
              : [scanOpsRead ? 'The worker reads data/scan-setups.json; none is on this machine.' : 'Not loaded yet.'],
    scanOpsLink('/app/scanner/setups', 'Your setups')));
  const ls = st.lastSuccess, la = st.lastAttempt;
  const lsAt = ls ? (ls.finishedAt || ls.startedAt) : null;
  tiles.append(tile('When did the last scan succeed?',
    ls ? scanOpsDay(lsAt) : 'Never',
    ls ? [`On bars of ${ls.asOf ? scanBarRange(ls.asOfFrom, ls.asOf) : 'no bar'}${scanOpsAge(lsAt) ? ` · ${scanOpsAge(lsAt)}` : ''}.`,
          ls.legacy ? 'From the alerts file’s last run: no run log is on this machine, so failures are not recorded anywhere.' : null,
          la && la !== ls ? `Latest attempt ${scanOpsDay(la.startedAt)}: ${(SCAN_RUN_STATUS[la.status] || [null, la.status])[1]}.` : null]
       : [la ? `The latest attempt, ${scanOpsDay(la.startedAt)}, ${(SCAN_RUN_STATUS[la.status] || [null, 'did not complete'])[1]}.` : 'Nothing has run here.'],
    scanOpsLink('/admin/scanner/jobs', 'Every run')));
  const current = st.state === 'current';
  const lm = st.latestMatches;
  tiles.append(tile(current ? 'Which setups matched on the last scan?' : `Which setups matched? As of ${ls?.asOf || 'no scan'} — not current`,
    ls ? scanOpsPlural(lm.length, 'match', 'matches') : '—',
    ls ? [lm.length ? `${[...new Set(lm.map(x => x.setupName || x.setupId))].slice(0, 3).join(', ')}${new Set(lm.map(x => x.setupId)).size > 3 ? ', …' : ''}.` : 'No setup matched on the bars of that scan. An empty day is the normal state of tight conditions, not a fault.',
          !current ? 'These are the last scan’s matches, not today’s: the scan is not current.' : null]
       : ['No scan has been recorded, so no match can be shown.'],
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
  if (ls) {
    const mc = el('section', { class: 'card' });
    mc.append(cardHead(current ? `Matched on the last scan — bars of ${ls.asOf || '—'}` : `Matches as of ${ls.asOf || '—'} — not current`,
      current ? 'In the order your setups are written, then the instruments. Nothing is ranked.'
              : `The last successful scan evaluated bars of ${ls.asOf || '—'}. It is ${S.label.toLowerCase()}, so these are a record of that scan, not a statement about today.`));
    mc.append(lm.length ? matchRows(lm) : el('p', { class: 'body', style: 'font-size:13px' }, 'No match was recorded on that scan’s bars.'));
    wrap.append(mc);
  }
  const older = st.recent.filter(x => !lm.includes(x));
  if (older.length || (!ls && alerts.length)) {
    const rc = el('section', { class: 'card' });
    const list = older.length ? older : alerts.slice(-25).reverse();
    rc.append(cardHead(ls ? 'Earlier matches — the last five bars with one' : 'Recorded matches — no run recorded, so none is current',
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
  const msg = el('p', { class: 'metaline', role: 'status' });
  const use = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    state.pasted = ta.value;
    const r = scanOpsParsePasted(ta.value);
    if (r.error) { msg.textContent = r.error; return; }
    state.pastedSetup = r.setup; state.setup = 'pasted'; state.result = null;
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
  const asOf = el('input', { class: 'input', type: 'date', id: 'scan-market-asof', value: S.asOf || '', onchange: (e) => { S.asOf = scanIsDay(e.target.value) ? e.target.value : ''; S.result = null; } });
  g.append(el('div', { class: 'field' }, [el('label', { for: 'scan-market-asof' }, 'As of (blank for now)'), asOf,
    el('p', { class: 'metaline' }, 'Blank judges your history against today’s clock, as the worker does: a series behind the session expected by now is untested, not evaluated. A date replays that evening — the history cut at it, judged the morning after.')]));
  form.append(g);

  const progress = el('p', { class: 'metaline', role: 'status' });
  const runBtn = el('button', { class: 'btn btn-primary btn-sm' }, 'Screen now (not recorded)');
  const cancelBtn = el('button', { class: 'btn btn-quiet btn-sm', hidden: '' }, 'Cancel');
  runBtn.disabled = !pick.setup || !haveHistory;
  form.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:center' }, [runBtn, cancelBtn, progress]));
  if (!haveHistory) form.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' },
    'No price history is loaded, so there is nothing to screen. On the deployed site that is by design — none of the prices this product could ship is licensed for redistribution. Locally, the worker’s data/price-history.json is read here.'));
  wrap.append(form);

  runBtn.addEventListener('click', async () => {
    const setup = pick.setup;
    if (!setup) return;
    const job = { cancelled: false };
    S.job = job;
    runBtn.disabled = true; cancelBtn.hidden = false;
    const s = { ...setup, enabled: true, expires: null, universe: S.market === '__all' ? { kind: 'all' } : { kind: 'market', market: S.market } };
    const hist = S.asOf ? scanTruncateHistory(history, S.asOf) : history;
    const now = S.asOf ? scanReplayNow(S.asOf) : scanOpsNow();
    const reg = scanRegistry(scanOpsRegistry());
    const cals = new Map();
    const ctx = { reg, now, cache: scanCache(), calFor: (m) => { const k = m || ''; if (!cals.has(k)) cals.set(k, scanCalendar(hist, scanOpsRegistry(), m || null)); return cals.get(k); } };
    /* Symbol order, as plain code-point order of the symbols: the one order
       that says nothing about any instrument. */
    const all = scanUniverse(s, hist, scanOpsRegistry()).slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const symbols = all.slice(0, SCAN_OPS_MAX_SCREEN);
    const rows = [];
    const done = await scanOpsChunked(symbols, (sym) => rows.push(scanScreenOne(s, hist, sym, ctx)), {
      onProgress: (i, n) => { progress.textContent = `Screened ${i} of ${n}…`; }, cancelled: () => job.cancelled });
    cancelBtn.hidden = true; runBtn.disabled = false;
    if (!done) { progress.textContent = `Cancelled after ${rows.length} of ${symbols.length}. Nothing was kept.`; return; }
    progress.textContent = '';
    const regCount = S.market === '__all' ? scanOpsRegistry().length : scanOpsRegistry().filter(i => String(i.market || '').toUpperCase() === S.market).length;
    S.result = { at: new Date().toISOString(), setup: s, market: S.market, asOf: S.asOf || null, now, rows, capped: all.length > symbols.length ? all.length : 0, registry: regCount };
    results.replaceChildren(scanScreenResult(S.result));
    results.querySelector('h2, h3')?.setAttribute('tabindex', '-1');
    results.querySelector('h2, h3')?.focus({ preventScroll: false });
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
      list.map(r => [r.symbol, r.market || 'no market row', r.bar || '—', isNum(r.close) ? scanFmt(r.close) : '—',
        state === 'UNAVAILABLE' ? el('span', {}, r.why) : scanOpsConds(r.conditions)]), { wrapCols: [4], caption: `${title}, in symbol order` }), { step: 50, noun: 'instruments' }));
    box.append(sec);
  });
  const stepped = R.rows.filter(r => r.stepped);
  if (stepped.length) box.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `${scanOpsPlural(stepped.length, 'instrument')} had a provisional last bar (captured before its session closed and settled); the bar before it was evaluated instead: ${stepped.map(r => r.symbol).join(', ')}.`));
  box.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, [
    'To have the worker record matches on this market, give a setup this market as its universe in the ', scanOpsLink('/app/scanner/setups/new', 'setup builder'), '.']));
  return box;
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
  const cancelBtn = el('button', { class: 'btn btn-quiet btn-sm', hidden: '' }, 'Cancel');
  runBtn.disabled = !pick.setup || !universe.length;
  form.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:center' }, [runBtn, cancelBtn, progress]));
  if (!haveHistory) form.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' },
    'No price history is loaded, so there is nothing to simulate on. The simulation reads only data/price-history.json on your own machine.'));
  else if (pick.setup && !universe.length) form.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, 'No instrument in this setup’s universe holds a series in your history.'));
  wrap.append(form);

  const results = el('div', { 'aria-live': 'polite' });
  runBtn.addEventListener('click', async () => {
    const s = pick.setup;
    if (!s) return;
    const job = { cancelled: false };
    S.job = job; runBtn.disabled = true; cancelBtn.hidden = false;
    const syms = S.symbol ? [S.symbol] : universe;
    const cache = scanCache();
    const parts = [];
    const done = await scanOpsChunked(syms, (sym) => parts.push(scanHistorical(s, history, { symbols: [sym], from: S.from || null, to: S.to || null,
      maxBars: SCAN_BACKTEST_MAX_BARS, instruments: scanOpsRegistry(), cache })), {
      size: 2, onProgress: (i, n) => { progress.textContent = `Simulated ${i} of ${n} instrument${n === 1 ? '' : 's'}…`; }, cancelled: () => job.cancelled });
    cancelBtn.hidden = true; runBtn.disabled = false;
    if (!done) { progress.textContent = `Cancelled after ${parts.length} of ${syms.length}. Nothing was kept.`; return; }
    progress.textContent = '';
    S.result = { setup: s, from: S.from || null, to: S.to || null, out: scanBacktestMerge(parts, s) };
    results.replaceChildren(scanBacktestResult(S.result));
    const hd = results.querySelector('h3');
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
    el('p', { class: 'caption', style: 'margin-top:2px' }, `Setup hash ${o.setupHash} · ${o.timeframe === '1W' ? 'weekly bars derived from your daily ones' : 'daily bars'} · ${o.cooldownMode === 'NEW_MATCH' ? 'records new matches only' : 'records every match'}${o.cooldownBars ? `, ${o.cooldownBars}-bar cooldown` : ''} · ${R.from || 'first bar'} to ${R.to || 'last bar'} · simulation, not a guarantee.`),
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
      return [r.symbol, r.bar, isNum(r.close) ? scanFmt(r.close) : '—', r.eventType ? r.eventType.replace(/_/g, ' ').toLowerCase() : 'held', det];
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
  wrap.append(panel('Data sources', 'No provider is licensed to this product. The sources are yours: your screen capture, your export, your live reader — combined into one history file.',
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
  wrap.append(panel('Scan jobs', 'Runs are started by your task scheduler or by hand. There is no job queue, so nothing is ever queued; a run in progress exists only as the lock file, which this page cannot read.',
    runs.length ? el('div', { class: 'row row-wrap', style: 'gap:8px' }, Object.entries(byStatus).map(([s, n]) => el('span', { class: 'row', style: 'gap:6px;align-items:center' }, [scanRunChip(s), el('span', { class: 'metaline' }, `× ${n}`)]))) : null,
    runs.length ? el('p', { class: 'metaline', style: 'margin-top:6px' }, `The last ${last30.length} of ${runs.length} runs recorded. Latest: ${scanOpsWhen(runs[0].startedAt)}. `, scanOpsLink('/admin/scanner/jobs', 'Every run')) : null,
    dropped ? el('p', { class: 'metaline' }, `${scanOpsPlural(dropped, 'entry', 'entries')} in the run log could not be read and ${dropped === 1 ? 'is' : 'are'} left out.`) : null,
    scanOpsFileState('scan-runs.json', scanRunsFile, 'The worker writes it on every attempt, success or failure.'),
    !scanRunsFile && scanOpsAlertsDoc()?.lastRun ? el('p', { class: 'metaline' }, `Without it, the only record is the alerts file’s last successful run (${scanOpsWhen(scanOpsAlertsDoc().lastRun.at)}); a failure writes nothing there.`) : null));

  /* 4 — indicator cache. */
  const lr = runs[0] || null;
  wrap.append(panel('Indicator cache', 'None is kept between runs. Each run computes an indicator once per series, data version and formula version, and reuses it across every setup in that run; the next run starts empty.',
    el('dl', { class: 'kv scan-kv' }, [el('dt', {}, 'Engine'), el('dd', {}, `this page runs scan ${SCAN_VERSION}${lr?.engine ? `; the last run, ${lr.engine}` : ''}`),
      el('dt', {}, 'Last run’s cache'), el('dd', {}, lr?.cacheStats ? `${fmtNum(lr.cacheStats.hits, 0)} reused, ${fmtNum(lr.cacheStats.misses, 0)} computed` : 'not recorded')])));

  /* 5 — alert engine. */
  const lc = scanRunCounts(lr || scanOpsAlertsDoc()?.lastRun || null);
  const cnt = (v) => (v == null ? 'not recorded' : fmtNum(v, 0));
  wrap.append(panel('Alert engine', lr || scanOpsAlertsDoc()?.lastRun ? `The last run${lr ? ` (${lr.id || scanOpsWhen(lr.startedAt)})` : ', from the alerts file'}. An alert is written before anything else happens to it, and nothing is ever sent, so no alert can be lost to a delivery failure.` : 'No run is recorded.',
    lr || scanOpsAlertsDoc()?.lastRun ? el('dl', { class: 'kv scan-kv' }, [
      el('dt', {}, 'Evaluated'), el('dd', {}, cnt(lc.evaluated)), el('dt', {}, 'Matched'), el('dd', {}, cnt(lc.matched)),
      el('dt', {}, 'Recorded'), el('dd', {}, cnt(lc.recorded)), el('dt', {}, 'Already recorded (deduplicated)'), el('dd', {}, cnt(lc.deduped)),
      el('dt', {}, 'Held back by a cooldown'), el('dd', {}, cnt(lc.cooldown)), el('dt', {}, 'Still matching (not new)'), el('dd', {}, cnt(lc.continuing)),
      el('dt', {}, 'Untested'), el('dd', {}, cnt(lc.untested)), el('dt', {}, 'Failed to record'), el('dd', {}, 'not a state: the record is one file, written whole or not at all'),
    ]) : null));

  /* 6 — notifications. */
  wrap.append(panel('Notifications', 'In-app only. Email, Telegram and push need a server, credentials and a contact address held under a privacy notice; this build has none of them.',
    el('p', { class: 'metaline' }, [`${st.notifications.text} `, scanOpsLink('/admin/scanner/delivery', 'Delivery')])));

  /* 7 — usage. */
  const a = st.active;
  wrap.append(panel('Usage', 'On this machine. There are no users to count.',
    el('dl', { class: 'kv scan-kv' }, [el('dt', {}, 'Active setups'), el('dd', {}, scanOpsSetupsDoc() ? `${a.enabled - a.expired} (of ${a.valid} valid, ${a.refused} refused)` : 'no setups file'),
      el('dt', {}, 'Monitored instruments'), el('dd', {}, st.monitored ? fmtNum(st.monitored.instruments, 0) : 'no price history loaded'),
      el('dt', {}, 'Alerts recorded'), el('dd', {}, (() => { const d = scanOpsAlertsDoc(); const l = Array.isArray(d) ? d : d?.alerts; return Array.isArray(l) ? fmtNum(l.length, 0) : 'no alerts file'; })())])));

  /* 8 — errors. */
  const errs = runs.filter(r => r.status === 'FAILED' || r.status === 'PARTIAL' || r.error).slice(0, 50);
  wrap.append(panel('Errors', 'Failed and partial runs, newest first. The run id is the correlation id: the worker prints it, and --runs finds it.',
    errs.length ? scanOpsTable(['When', 'Run', 'Status', 'Category', 'What happened', 'Retry'], errs.map(r => {
      const e = scanRunError(r);
      return [scanOpsWhen(r.startedAt), el('code', {}, r.id || '—'), scanRunChip(r.status), e?.category || (r.status === 'PARTIAL' ? 'partial' : '—'),
        e?.message || (r.problems?.length ? r.problems.join('; ') : r.untestedEverywhere?.length ? `untested everywhere: ${r.untestedEverywhere.map(u => u.setup || u).join(', ')}` : '—'),
        r.status === 'FAILED' && r.id ? el('code', { class: 'scan-cmd-code scan-nowrap' }, `node scanner/scan.mjs --retry ${r.id}`) : r.status === 'FAILED' ? 'node scanner/scan.mjs' : 'not needed'];
    }), { wrapCols: [4], caption: 'Failed and partial runs' })
      : el('p', { class: 'metaline' }, scanRunsFile ? 'No failed or partial run is recorded.' : 'No run log, so no failure can be listed — and the alerts file records successes only.')));

  /* 9 — controls. */
  wrap.append(panel('Controls', 'Commands, run where the worker runs. Each is written to the worker’s control log (the audit list on Runs) with its time and arguments — a local, append-only file with no identity behind it.',
    scanOpsCmd('node scanner/scan.mjs --retry <run id>', 'Runs a failed run again. Alerts are keyed by setup, version, instrument, timeframe, bar and event, so nothing already recorded is recorded twice; a plain node scanner/scan.mjs is just as safe.'),
    scanOpsCmd('node scanner/scan.mjs --as-of YYYY-MM-DD', 'Replays a session: the history cut at that date, judged as that evening. Deduplicated against the record, so a replay adds only what was never recorded — and nothing is resent, because nothing is ever sent.'),
    scanOpsCmd('node scanner/scan.mjs --pause "why"', 'Stops scheduled runs: each records itself skipped, and writes nothing else, until you resume.'),
    scanOpsCmd('node scanner/scan.mjs --resume', 'Lifts the pause.'),
    scanOpsCmd('node scanner/scan.mjs --unlock', 'Clears data/scan.lock when a crashed run left it. A lock whose process is dead, or an hour old, is taken over by the next run anyway, and the takeover is recorded.'),
    scanOpsCmd('node scanner/scan.mjs --runs 20', 'Prints the last twenty runs with their errors — the way to inspect a failure.'),
    audit.length ? el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, `${scanOpsPlural(audit.length, 'control')} in the log; the latest ${scanOpsWhen(audit[0].at || audit[0].startedAt)} (${audit[0].action || 'control'}). `, scanOpsLink('/admin/scanner/jobs', 'The control log')) : null));
  if (!scanRunsFile) wrap.append(panel('Your own files', 'On a machine that does not run the worker — the deployed site included — open the worker’s files from your disk to read them here.', scanOpsOpenFiles()));
  return wrap;
};

VIEWS.scannerAdminData = () => {
  const wrap = scanOpsPage('data', 'Data health',
    'Your price history as the engine reads it: every bar validated, gaps counted against the sessions of its market, price breaks tagged, staleness judged against the clock. Nothing is corrected here — only named.');
  const history = scanOpsHistory();
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
  [['Series', t.series], ['Bars', t.bars], ['Invalid bars', t.invalid], ['Gaps counted', t.gaps], ['Price breaks', t.jumps], ['Stale series', t.stale], ['Provisional bars', t.provisional]]
    .forEach(([l, v]) => g.append(statTile(l, fmtNum(v, 0))));
  sum.append(g);
  sum.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `Held beyond closes and volumes: ${[H.file.ohlc ? 'open, high and low' : null, H.file.meta ? 'capture times' : null, H.file.corrections ? 'corrections' : null].filter(Boolean).join(', ') || 'nothing — no open, high, low, capture time or correction is in this file yet'}. Prices are not adjusted for splits or dividends; a break is tagged, never corrected.`));
  wrap.append(sum);

  const mk = el('section', { class: 'card' });
  mk.append(cardHead('Markets', 'In market order. The calendar is inferred from your own series — marked so — or, where fewer than five of your series share a market, weekdays with holidays unknown.'));
  mk.append(scanOpsTable(['Market', 'Series', 'Session', 'Calendar', 'Inferred holidays', 'Ambiguous days', 'Expected by now', 'Newest bar', 'Stale'],
    H.markets.map(m => [m.market ? `${m.market}${m.label && m.label !== m.market ? ` — ${m.label}` : ''}` : 'no market row', fmtNum(m.symbols, 0), `${m.session} (${m.tz})`,
      el('span', {}, [el('span', { class: 'chip' + (m.calendar.basis === 'inferred' ? ' chip-bronze' : '') }, m.calendar.basis === 'inferred' ? 'inferred' : 'weekdays'), ' ', el('span', { class: 'caption' }, m.calendar.basis === 'inferred' ? `from ${m.calendar.series} series — not an exchange calendar` : 'holidays not held')]),
      m.calendar.inferredHolidays?.length ? `${m.calendar.inferredHolidays.length}${m.calendar.inferredHolidays.length <= 4 ? `: ${m.calendar.inferredHolidays.join(', ')}` : `, latest ${m.calendar.inferredHolidays[m.calendar.inferredHolidays.length - 1]}`}` : 'none',
      m.calendar.ambiguous?.length ? String(m.calendar.ambiguous.length) : 'none', m.expected || '—', m.newestBar || '—',
      m.staleSymbols.length ? `${m.staleSymbols.length} of ${m.symbols}` : 'none']), { wrapCols: [2, 3], caption: 'Health per market' }));
  wrap.append(mk);

  const flagged = (s) => s.invalid.length || s.gaps.some(x => x.counted) || s.jumps.length || s.stale || s.dropped.badDate || s.dropped.nonFinite || s.dropped.nonPositive;
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
        s.jumps.length ? s.jumps.slice(0, 2).map(j => `${j.bar} ${fmtPct(j.pct, 0)} (${j.tag})`).join('; ') + (s.jumps.length > 2 ? '; …' : '') : 'none',
        `${Math.round(s.volumeCoverage * 100)}% of bars`, s.stale ? `${s.behindSessions} session${s.behindSessions === 1 ? '' : 's'} behind ${s.stale.expected}` : 'no',
        s.atKeepLimit ? 'at the 500-bar keep' : 'no']), { wrapCols: [4, 5, 6], caption: 'Health per series' }), { step: 50, noun: 'series' })
      : el('p', { class: 'metaline' }, 'Nothing to look at: no series has an invalid bar, a counted gap, a price break or a stale last bar.'));
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
    const lr = scanOpsAlertsDoc()?.lastRun;
    if (lr) card.append(el('p', { class: 'metaline' }, `The alerts file records one successful run, ${scanOpsWhen(lr.at)} on bars of ${lr.asOf || '—'} (${lr.engine || 'engine unknown'}). It is overwritten by the next success, and a failure writes nothing, so it is not a history.`));
    if (!scanRunsFile) card.append(scanOpsOpenFiles());
    wrap.append(card);
  } else {
    const groups = { all: () => true, COMPLETED: r => r.status === 'COMPLETED', PARTIAL: r => r.status === 'PARTIAL', FAILED: r => r.status === 'FAILED', SKIPPED: r => /^SKIPPED|CANCELLED/.test(r.status || '') };
    const F = scanJobsState;
    if (!groups[F.filter]) F.filter = 'all';
    card.append(cardHead(`${scanOpsPlural(runs.length, 'run')} recorded`, 'Newest first. Open a row for its readiness, problems and error.'));
    const seg = el('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter runs by status', style: 'margin-bottom:var(--sm)' });
    const host = el('div');
    const labels = { all: 'All', COMPLETED: 'Completed', PARTIAL: 'Partial', FAILED: 'Failed', SKIPPED: 'Skipped' };
    const draw = () => {
      seg.replaceChildren(...Object.keys(groups).map(k => el('button', { 'aria-pressed': F.filter === k ? 'true' : 'false', 'aria-selected': F.filter === k ? 'true' : 'false',
        onclick: () => { F.filter = k; draw(); seg.querySelector('[aria-pressed="true"]')?.focus(); } }, `${labels[k]} (${runs.filter(groups[k]).length})`)));
      const list = runs.filter(groups[F.filter]);
      host.replaceChildren(list.length ? scanOpsPaged(list, (rows) => scanOpsTable(['Started', 'Status', 'Trigger', 'Duration', 'Bars', 'Counts', 'Detail'], rows.map(r => {
        const c = scanRunCounts(r), e = scanRunError(r);
        const det = el('details', { class: 'scan-row-det' });
        det.append(el('summary', { class: 'caption' }, e ? `${e.category}: ${e.message}`.slice(0, 90) : 'Details'));
        det.append(el('dl', { class: 'kv scan-kv' }, [
          el('dt', {}, 'Run id'), el('dd', {}, el('code', {}, r.id || '—')),
          el('dt', {}, 'Engine'), el('dd', {}, r.engine || '—'),
          el('dt', {}, 'Exit code'), el('dd', {}, r.exitCode != null ? String(r.exitCode) : '—'),
          el('dt', {}, 'Finished'), el('dd', {}, scanOpsWhen(r.finishedAt)),
          el('dt', {}, 'History'), el('dd', {}, r.history ? `${r.history.symbols ?? '—'} series, newest bar ${r.history.newestBar || '—'}, written ${scanOpsWhen(r.history.generated)}` : '—'),
          el('dt', {}, 'Setups hash'), el('dd', {}, r.setupsHash || '—'),
          r.replayAsOf ? el('dt', {}, 'Replay of') : null, r.replayAsOf ? el('dd', {}, r.replayAsOf) : null,
          e ? el('dt', {}, 'Error') : null, e ? el('dd', {}, `${e.category}${e.code && e.code !== e.category ? ` (${e.code})` : ''}: ${e.message}${e.correlation ? ` · correlation ${e.correlation}` : ''}`) : null,
        ]));
        const lines = [...(r.problems || []).map(p => `refused — ${p}`), ...(r.untestedEverywhere || []).map(u => typeof u === 'string' ? `${u}: untested everywhere` : `${u.setup}: untested everywhere — ${u.why}`),
          ...((r.readiness?.markets || []).filter(m => m.inRun !== false && m.state && m.state !== 'READY').map(m => m.text))];
        if (lines.length) det.append(el('ul', { class: 'rulelist' }, lines.slice(0, 40).map(t => el('li', {}, t))));
        if (r.status === 'FAILED' && r.id) det.append(scanOpsCmd(`node scanner/scan.mjs --retry ${r.id}`, 'Runs it again; nothing already recorded is recorded twice.'));
        return [scanOpsWhen(r.startedAt), scanRunChip(r.status), r.trigger || r.origin || '—', scanOpsDuration(r.durationMs ?? (Date.parse(r.finishedAt) - Date.parse(r.startedAt))),
          r.asOf ? scanBarRange(r.asOfFrom, r.asOf) : '—',
          c.evaluated == null ? '—' : `${fmtNum(c.evaluated, 0)} evaluated · ${fmtNum(c.matched ?? 0, 0)} matched · ${fmtNum(c.recorded ?? 0, 0)} recorded${c.untested ? ` · ${fmtNum(c.untested, 0)} untested` : ''}`, det];
      }), { wrapCols: [5, 6], caption: 'Runs, newest first' }), { step: 50, noun: 'runs' }) : el('p', { class: 'metaline' }, 'No run has this status.'));
    };
    draw();
    card.append(seg, host);
    if (dropped) card.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, `${scanOpsPlural(dropped, 'entry', 'entries')} could not be read and ${dropped === 1 ? 'is' : 'are'} left out.`));
    card.append(scanOpsFileState('scan-runs.json', scanRunsFile, ''));
    wrap.append(card);
  }
  const au = el('section', { class: 'card' });
  au.append(cardHead('Control log', 'Pause, resume, replay, retry and unlock, as the worker recorded them: when, what, and the arguments. A local append-only file — not tamper-evident, and with no identity, because there are no accounts.'));
  au.append(audit.length ? scanOpsTable(['When', 'Control', 'Reason or arguments'], audit.map(x => [scanOpsWhen(x.at || x.startedAt), el('span', { class: 'chip chip-bronze' }, x.action || x.control || 'control'),
    [x.reason, Array.isArray(x.argv) ? x.argv.join(' ') : x.argv].filter(Boolean).join(' · ') || '—']), { wrapCols: [2], caption: 'Controls, newest first' })
    : el('p', { class: 'metaline' }, runs.length || scanRunsFile ? 'No control has been run.' : 'No run log, so no control is recorded.'));
  wrap.append(au);
  return wrap;
};

/* The channels the brief names, and what each is here. The file's own
   statement wins where the worker wrote one; these are what the plan fixes
   when it has not. */
const SCAN_CHANNELS = [
  ['IN_APP', 'In-app', 'ACTIVE', 'The worker writes each alert to data/scan-alerts.json; these pages read it. Read and archived are kept in this browser.'],
  ['EMAIL', 'Email', 'NOT_CONFIGURED', 'Needs a server to send from, an operating entity to send as, and an address held under a PDPA privacy notice. None exists, and credentials never go in a page.'],
  ['TELEGRAM', 'Telegram', 'NOT_CONFIGURED', 'A bot token must live on a server, and binding a chat id is holding a contact identifier under a privacy notice; neither exists.'],
  ['PUSH', 'Web push', 'NOT_CONFIGURED', 'A later live-scanning release (P2): it needs a push service and a server to hold subscriptions.'],
];
VIEWS.scannerAdminDelivery = () => {
  const wrap = scanOpsPage('delivery', 'Delivery',
    'Where scanner alerts go. In-app is the only channel: the alert is the record, written before anything else, and nothing is sent anywhere.');
  const D = scanDeliveriesFile;
  const fileCh = D?.channels ? (Array.isArray(D.channels) ? Object.fromEntries(D.channels.filter(Boolean).map(c => [c.channel || c.id, c])) : D.channels) : {};
  const unread = scanOpsUnread();
  const card = el('section', { class: 'card' });
  card.append(cardHead('Channels', 'Each with its status and the reason. A channel that is not configured is shown as not configured — never as available, and never with a count of zero sends.'));
  card.append(scanOpsTable(['Channel', 'Status', 'Why'], SCAN_CHANNELS.map(([id, label, status, why]) => {
    const f = fileCh?.[id] || {};
    const s = f.status || status;
    const ok = s === 'ACTIVE' || s === 'ENABLED';
    const extra = id === 'IN_APP' ? (unread == null ? ' Unread in this browser: not counted here.' : ` ${scanOpsPlural(unread, 'alert')} unread in this browser.`) : '';
    return [label, sevChip(ok ? 'good' : 'info', ok ? 'active' : s === 'NOT_CONFIGURED' ? 'not configured' : String(s).toLowerCase().replace(/_/g, ' ')), `${f.why || f.reason || f.text || why}${extra}`];
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
