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
   and no push. Alerts land in a file the worker writes and this page reads.

   ONE ENGINE. The engine lives in 24-market-engine.js, between the
   @scan-engine markers; scanner/scan.mjs slices that region out of
   index.html and runs it in Node, so the daily worker and this page cannot
   evaluate a rule differently — the Trading Index pattern. This file is the
   page only.
   ========================================================================== */

/* ---------------------------------------------------------------- page --- */
/* Files the worker writes and this page reads. Both are git-ignored and live
   only on the reader's machine; on the deployed site they 404 and the page
   says what it would show. */
let scanSetupsFile = null, scanAlertsFile = null;
/* data/price-history.json exactly as the worker reads it, taken before the
   closes the reader pasted into this browser are merged into trackedHistory.
   The page scanned the merged copy, so "Evaluate now" and "Test" showed
   matches on series the worker cannot see, and on a later bar than it has. */
let scanHistoryFile = null;

/* The builder's draft lives in memory for the session, not in storage: the
   setups file is the record, and a second copy in the browser would be the
   drift this codebase keeps finding in itself. */
let scanDraft = null;
const scanBlankRule = () => ({ left: { indicator: 'price' }, op: 'CROSSES_ABOVE', right: { indicator: 'ema', n: 50 } });
const scanBlankDraft = () => ({ id: '', name: '', enabled: true, universe: { kind: 'symbols', symbols: [] }, timeframe: 'daily',
  confirmation: 'close', logic: 'AND', cooldownBars: 5, expires: null, rules: [scanBlankRule()] });

/* The engine's own label for each side, so the rule a reader sees is the
   rule that runs — the page used to print SMA20 for a side the engine read
   as SMA1. A missing value prints as '?', never as a number. */
const scanRuleProse = (r) => {
  if (!r || typeof r !== 'object') return '(not a rule)';
  const val = (v) => (scanNumeric(v) ? String(Number(v)) : '?');
  if (scanOpName(r.op) === 'BETWEEN') return `${scanSideLabel(r.left)} between ${val(r.range?.[0])} and ${val(r.range?.[1])}`;
  return `${scanSideLabel(r.left)} ${SCAN_OPERATORS[scanOpName(r.op)]?.label || r.op} ${r.right?.indicator ? scanSideLabel(r.right) : val(r.right?.value)}`;
};
const scanUniverseProse = (u) => !u || u.kind === 'all' ? 'every instrument with a series'
  : u.kind === 'market' ? `every ${u.market || '?'} instrument in the registry`
  : u.kind === 'watchlist' ? `watchlist “${u.name || u.watchlistId || '?'}” — ${(u.symbols || []).length} symbol${(u.symbols || []).length === 1 ? '' : 's'} as of ${u.asOf || '?'}: ${(u.symbols || []).join(', ') || '—'}`
  : `${(u.symbols || []).length} named instrument${(u.symbols || []).length === 1 ? '' : 's'}: ${(u.symbols || []).join(', ') || '—'}`;

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

VIEWS.scanner = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(mySubnav('scanner'));
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Personal lane'),
    el('h1', {}, 'Trade-setup scanner'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Conditions you define, evaluated on price history you supplied, producing a record of which conditions held on which daily bar. '
      + 'It does not rank, it does not deliver anything, and it does not say that any condition means anything.'),
  ])));

  /* The file, not the merged copy: this page evaluates what the worker
     evaluates, so a pasted series is named below as left out, not scanned. */
  const history = scanHistoryFile;
  const pasted = Object.keys(userData.series || {});
  const haveHistory = !!(history?.series && Object.keys(history.series).length);
  const registry = instruments?.instruments || [];
  /* Validated here exactly as the worker validates, so "evaluate now" can
     never show a match for a setup the record will refuse. */
  const checked = scanSetupsFile ? scanValidate(scanSetupsFile) : { setups: [], problems: [] };
  const setups = checked.setups;
  const alerts = Array.isArray(scanAlertsFile?.alerts) ? scanAlertsFile.alerts : Array.isArray(scanAlertsFile) ? scanAlertsFile : [];
  const lastRun = scanAlertsFile && !Array.isArray(scanAlertsFile) ? scanAlertsFile.lastRun || null : null;

  /* ---- what this is, and is not ---- */
  const bd = el('div', { class: 'card' });
  bd.append(cardHead('What this will and will not do', 'Named rather than implied.'));
  bd.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'It reads only your own price history — data/price-history.json, built from your screen or your export under your subscription. No feed is licensed to this product, so no other data is scanned and none of this is offered to anyone else.'),
    el('li', {}, 'A match is a record that the conditions you wrote held on the last daily bar your history holds, with the values. It is not a signal, and no indicator here has been validated on point-in-time data, so none is claimed to work.'),
    el('li', {}, 'Nothing is ranked or sorted by strength. Matches appear in the order of your setups and your instruments.'),
    el('li', {}, 'Nothing is delivered. The worker writes a file; this page reads it. Email, Telegram and push need a server and a contact address held under a privacy notice, and this build has neither.'),
    el('li', {}, 'Daily bars, and weekly bars derived from them, evaluated on the last final bar your history holds. A bar whose capture time is recorded before its session closed and settled is provisional and never confirms a match; a bar with no capture time recorded (every bar captured before this version) is read as final once its session has closed. A series behind the session expected by now is stale and is reported as untested, not evaluated. Sessions are inferred from your own history, not from an exchange calendar. Intraday needs a licensed feed; a performance backtest needs point-in-time history. Both are named in the plan as gated, not as missing.'),
  ]));
  wrap.append(bd);

  /* ---- data present ---- */
  const dataCard = el('div', { class: 'card' });
  dataCard.append(cardHead('Price history the scanner reads', haveHistory
    ? `${Object.keys(history.series).length} instruments, generated ${history.generated ? String(history.generated).slice(0, 10) : '—'}. Personal research — not redistributable.`
    : 'None loaded.'));
  if (!haveHistory) dataCard.append(el('p', { class: 'body', style: 'font-size:13px' },
    'On the deployed site there is no price history to scan, by design: none of the prices this product could ship are licensed for it to redistribute. Locally, run the daily capture (ingest/daily.mjs) or import an export (ingest/history-import.mjs) and this page reads data/price-history.json.'));
  else {
    const depth = Object.values(history.series).map(s => Object.keys(s).length);
    dataCard.append(el('p', { class: 'metaline' }, `Series depth ${Math.min(...depth)}–${Math.max(...depth)} bars. A rule whose indicator needs more bars than an instrument holds is reported as untested for it, never as met or failed.`));
    const withVol = Object.keys(history.series).filter(s => Object.values(history.volume?.[s] || {}).some(v => Number.isFinite(v) && v > 0)).length;
    dataCard.append(el('p', { class: 'metaline' }, `Volume is recorded for ${withVol} of ${Object.keys(history.series).length}. The screen capture (ingest/daily.mjs) records closes only; volume comes from ingest/live.mjs or from an export imported with a volume column (ingest/history-import.mjs). A volume or average-volume rule is untested on a bar with no recorded volume, and on an instrument that carries none — FX pairs, indices and yields.`));
  }
  if (pasted.length) dataCard.append(el('p', { class: 'metaline' },
    `${pasted.length} series you pasted in this browser (${pasted.slice(0, 8).join(', ')}${pasted.length > 8 ? ', …' : ''}) ${pasted.length === 1 ? 'is' : 'are'} not scanned, and pasted closes do not replace the file’s: the worker reads only data/price-history.json and cannot see this browser, so the page scans the same file.`));
  wrap.append(dataCard);

  /* ---- setups on file, and a live evaluation of them ---- */
  const sc = el('div', { class: 'card' });
  sc.append(cardHead('Your setups', setups.length || checked.problems.length
    ? `${setups.length} valid in data/scan-setups.json${checked.problems.length ? `, ${checked.problems.length} refused` : ''}. The worker evaluates the valid ones after each daily run; the button below evaluates them now, here, and records nothing.`
    : 'No setups file is loaded.'));
  if (checked.problems.length) {
    const pr = el('div', { class: 'panel', style: 'margin-top:8px;border-color:var(--warn-line, var(--line))' });
    pr.append(el('p', { class: 'metaline', style: 'font-weight:600' }, 'Refused — the worker leaves these out too. A setup passes whole or not at all:'));
    pr.append(el('ul', { class: 'rulelist' }, checked.problems.map(p => el('li', {}, p))));
    sc.append(pr);
  }
  if (!setups.length && !checked.problems.length) sc.append(el('p', { class: 'body', style: 'font-size:13px' },
    'Write your first setup with the builder below, save it as data/scan-setups.json (a committed example is at scanner/setups.example.json), and run node scanner/scan.mjs. The file stays on your machine — it is git-ignored and CI fails if it is ever tracked.'));
  setups.forEach(s => {
    const p = el('div', { class: 'panel', style: 'margin-top:8px' });
    p.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
      el('span', { style: 'font-weight:600' }, s.name || s.id),
      el('span', { class: 'chip' }, s.id),
      s.enabled === false ? el('span', { class: 'chip chip-bronze' }, 'disabled') : null,
      el('span', { class: 'chip' }, `v${s.version}`),
      el('span', { class: 'chip' }, `${s.ruleTree?.logic === 'ANY' ? 'any' : 'all'} of ${scanConditionCount(s.ruleTree)} condition${scanConditionCount(s.ruleTree) === 1 ? '' : 's'}`),
      el('span', { class: 'chip' }, s.cooldownMode === 'NEW_MATCH' ? 'new matches only' : 'every match'),
      el('span', { class: 'chip' }, `cooldown ${s.cooldownBars ?? 0} bars`),
      s.expires ? el('span', { class: 'chip' }, `expires ${s.expires}`) : null,
    ]));
    p.append(el('p', { class: 'metaline', style: 'margin-top:4px' }, `Universe: ${scanUniverseProse(s.universe)} · ${s.timeframe === '1W' ? 'weekly bars derived from your daily ones' : 'daily bars'}, the last final one your history holds.`));
    /* The tree as written: a nested group is a line of its own, and its
       conditions sit one step in. */
    p.append(el('ul', { class: 'rulelist' }, scanTreeLines(s.ruleTree).map(l => el('li', { style: l.depth > 1 ? `margin-left:${(l.depth - 1) * 16}px` : null }, l.text))));
    sc.append(p);
  });
  if (setups.length && haveHistory) {
    const host = el('div', { style: 'margin-top:var(--md)' });
    sc.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--md)', onclick: () => {
      const r = scanRun(setups, history, { instruments: registry, existing: alerts, now: new Date().toISOString() });
      host.replaceChildren(scanRunSummary(r, 'Evaluated now, in this browser — nothing recorded. The worker writes the record.'));
    } }, 'Evaluate now (not recorded)'));
    sc.append(host);
  }
  wrap.append(sc);

  /* ---- the record ---- */
  const ac = el('div', { class: 'card' });
  ac.append(cardHead('Alert history', alerts.length
    ? `${alerts.length} recorded match${alerts.length === 1 ? '' : 'es'} in data/scan-alerts.json, newest first. Each is one setup, one instrument, one daily bar; the same bar is never recorded twice.`
    : 'Nothing recorded yet.'));
  /* What the worker said on its last run — the refusals and the setups no
     instrument could test are the part a reader needs and never saw. */
  if (lastRun) {
    const lr = el('div', { class: 'panel', style: 'margin-top:8px' });
    lr.append(el('p', { class: 'metaline' }, `Last worker run ${lastRun.at ? String(lastRun.at).replace('T', ' ').slice(0, 16) : '—'} on bars ${lastRun.asOf ? scanBarRange(lastRun.asOfFrom, lastRun.asOf) : '—'} (${lastRun.engine || 'engine unknown'}): ${lastRun.setups ?? 0} setup${lastRun.setups === 1 ? '' : 's'}, ${lastRun.evaluated ?? 0} evaluation${lastRun.evaluated === 1 ? '' : 's'}, ${lastRun.matched ?? 0} matched, ${lastRun.recorded ?? 0} recorded, ${lastRun.untested ?? 0} untested.`));
    const probs = [...(lastRun.problems || []).map(p => `refused — ${p}`), ...(lastRun.untestedEverywhere || []).map(u => typeof u === 'string'
      ? `${u}: no instrument in its universe could test its rules`
      : `${u.setup}: untested on every instrument in its universe — ${u.why}`),
      ...(lastRun.stale || []).map(x => `${x.symbol}: ${x.why}`)];
    if (probs.length) lr.append(el('ul', { class: 'rulelist' }, probs.map(p => el('li', {}, p))));
    ac.append(lr);
  }
  if (!alerts.length) ac.append(el('p', { class: 'body', style: 'font-size:13px' }, 'The worker appends a record here when a setup matches. An empty history is the normal state of a scanner with tight conditions, not a fault.'));
  else {
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Bar', 'Setup', 'Instrument', 'Close', 'What held', 'Recorded'].map(h => el('th', {}, h)))));
    t.append(el('tbody', {}, [...alerts].sort((a, b) => (b.bar || '').localeCompare(a.bar || '') || (b.recordedAt || '').localeCompare(a.recordedAt || '')).slice(0, 200).map(a => el('tr', {}, [
      el('td', { class: 'ident' }, a.bar || '—'),
      el('td', {}, a.setupName || a.setupId),
      el('td', {}, scanSymbolLink(a.symbol)),
      el('td', { class: 'num' }, isNum(a.close) ? scanFmt(a.close) : '—'),
      el('td', { style: 'text-align:left;white-space:normal;max-width:360px' }, (a.rules || []).map(x => x.text).join('; ')),
      el('td', { class: 'caption' }, a.recordedAt ? String(a.recordedAt).replace('T', ' ').slice(0, 16) : '—'),
    ]))));
    ac.append(el('div', { class: 'tablewrap' }, t));
    if (alerts.length > 200) ac.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, `Showing the newest 200 of ${alerts.length}.`));
  }
  wrap.append(ac);

  /* ---- builder ---- */
  wrap.append(scanBuilder(history, registry, alerts));
  return wrap;
};

/* A run's outcome as a card body: what matched, what was untested, what was
   skipped and why. In setup-then-symbol order. */
function scanRunSummary(r, note) {
  const box = el('div');
  box.append(el('p', { class: 'metaline' }, `${r.setups} setup${r.setups === 1 ? '' : 's'} · ${r.evaluated} evaluation${r.evaluated === 1 ? '' : 's'}, each on its instrument’s last bar${r.asOf ? ` (${scanBarRange(r.asOfFrom, r.asOf)})` : ''} · ${r.matched} match${r.matched === 1 ? '' : 'es'} · ${r.untested} untested · ${r.skipped.length} skipped. ${note || ''}`));
  if (r.alerts.length) {
    const ul = el('ul', { class: 'ticklist', style: 'margin-top:6px' });
    r.alerts.forEach(a => ul.append(el('li', {}, [`${a.setupName} · `, scanSymbolLink(a.symbol), ` · ${a.bar} · close ${scanFmt(a.close)} — ${a.rules.map(x => x.text).join('; ')}`])));
    box.append(ul);
  }
  /* Every pair that was not a plain met-or-failed, with its reason: untested
     ones first (the rule that could not be read), then the skips, then the
     series evaluated on a bar well behind the rest. The count alone said
     "1 untested" and nothing about which rule or why. */
  const un = (r.untestedList || []).map(s => `${s.setup} · ${s.symbol}: untested — ${s.why}`);
  const sk = r.skipped.filter(s => s.why).map(s => `${s.setup}${s.symbol ? ' · ' + s.symbol : ''}: ${s.why}`);
  const st = (r.stale || []).map(s => `${s.symbol}: ${s.why}`);
  /* A provisional last bar is not an error, but it is why a bar other than
     the newest was evaluated. And per market, whether the session expected
     by now is held — the reason a whole run can come back untested. */
  const pv = (r.provisional || []).map(s => `${s.symbol}: ${s.why}`);
  const rd = (r.readiness?.markets || []).filter(m => m.inRun && m.state !== 'READY').map(m => m.text);
  const lines = [...un, ...sk, ...st, ...pv, ...rd];
  if (lines.length) {
    const parts = [un.length ? `untested ${un.length}` : null, sk.length ? `skipped ${sk.length}` : null, st.length ? `behind the rest ${st.length}` : null,
      pv.length ? `provisional ${pv.length}` : null, rd.length ? `markets not ready ${rd.length}` : null].filter(Boolean);
    const det = el('details', { style: 'margin-top:6px' });
    det.append(el('summary', { class: 'caption', style: 'cursor:pointer' }, `Why — ${parts.join(' · ')}`));
    det.append(el('ul', { class: 'rulelist' }, lines.slice(0, 80).map(t => el('li', { class: 'caption' }, t))));
    if (lines.length > 80) det.append(el('p', { class: 'caption' }, `Showing 80 of ${lines.length}.`));
    box.append(det);
  }
  return box;
}

/* The setup builder. It writes JSON for the reader to save — the same
   pattern as the Trading Index observations file — and can test the draft
   against the loaded history without recording anything.

   Text, number and date fields update the draft on every keystroke and
   refresh the outputs in place; nothing is rebuilt under the cursor, so focus
   stays, a click straight after an edit lands, and a date is not committed at
   its first year digit. Only a select that changes which fields exist rebuilds
   the card, and focus returns to it. A blank number is absent — the default
   applies, or the setup is refused with the reason — never a silent 0. */
let scanIdAuto = true;
function scanBuilder(history, registry, alerts) {
  const card = el('div', { class: 'card' });
  card.append(cardHead('Setup builder', 'Write a setup, test it against your history, then save the JSON as data/scan-setups.json for the worker.'));
  /* Opened from a company page, the builder starts on that company's symbol
     — the ?symbol= the page's link carries. Only a fresh draft takes it, so
     returning to a half-written setup never loses it. */
  const fromSymbol = String(new URLSearchParams(location.search).get('symbol') || '').trim().toUpperCase().replace(/[^A-Z0-9.^=:-]/g, '');
  const d = scanDraft || (scanDraft = { ...scanBlankDraft(), ...(fromSymbol ? { universe: { kind: 'symbols', symbols: [fromSymbol] } } : {}) });
  const rebuild = () => {
    const a = document.activeElement;
    let key = null;
    if (a && card.contains(a) && a.getAttribute('aria-label')) {
      const lab = a.getAttribute('aria-label');
      key = { lab, i: [...card.querySelectorAll('[aria-label]')].filter(n => n.getAttribute('aria-label') === lab).indexOf(a) };
    }
    const next = scanBuilder(history, registry, alerts);
    card.replaceWith(next);
    if (key) [...next.querySelectorAll('[aria-label]')].filter(n => n.getAttribute('aria-label') === key.lab)[key.i]?.focus();
  };
  const field = (label, input) => { const f = el('div', { class: 'field' }); f.append(el('label', {}, label)); if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', label); f.append(input); return f; };
  /* Live fields: the draft follows the keystrokes; the outputs follow the draft. */
  const text = (val, on, attrs = {}) => el('input', { class: 'input', value: val ?? '', ...attrs, oninput: e => { on(e.target.value); refresh(); } });
  const numOrAbsent = (v) => (String(v).trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));
  const select = (val, opts, on) => { const s = el('select', { class: 'select', onchange: e => { on(e.target.value); rebuild(); } }); opts.forEach(([v, l]) => s.append(el('option', { value: v, selected: String(val) === String(v) ? '' : null }, l))); return s; };
  const PERIOD = ['sma', 'ema', 'rsi', 'volume_avg'];
  const freshSide = (v) => ({ indicator: v, ...(PERIOD.includes(v) ? { n: SCAN_DEFAULT_N[v] } : {}) });

  const g = el('div', { class: 'grid g-3', style: 'gap:var(--sm)' });
  const slug = (v) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const idInput = text(d.id, v => { d.id = v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40); scanIdAuto = !d.id; });
  g.append(field('Name', text(d.name, v => { d.name = v; if (scanIdAuto) { d.id = slug(v); idInput.value = d.id; } })));
  g.append(field('Id (stable; part of every alert key)', idInput));
  g.append(field('Logic', select(d.logic, [['AND', 'all rules must hold'], ['OR', 'any rule may hold']], v => { d.logic = v; })));
  g.append(field('Universe', select(d.universe.kind, [['symbols', 'named instruments'], ['watchlist', 'one of your watchlists (its symbols, snapshotted)'], ['market', 'a market'], ['all', 'everything with a series']], v => {
    d.universe = v === 'market' ? { kind: 'market', market: 'US' }
      : v === 'symbols' ? { kind: 'symbols', symbols: d.universe.symbols || [] }
      : v === 'watchlist' ? { kind: 'watchlist', watchlistId: d.universe.watchlistId || State.watchlists[0]?.id || null }
      : { kind: 'all' }; })));
  if (d.universe.kind === 'symbols') g.append(field('Instruments (comma-separated symbols as they appear in your history)', text((d.universe.symbols || []).join(', '), v => { d.universe.symbols = v.split(/[,\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean); })));
  if (d.universe.kind === 'watchlist') {
    g.append(field('Watchlist', select(d.universe.watchlistId, (State.watchlists || []).map(w => [w.id, `${w.name} (${(w.ids || []).length})`]), v => { d.universe.watchlistId = v; })));
    const snap = watchlistSymbols(d.universe.watchlistId);
    const noSeries = scanUniverseGaps({ universe: { kind: 'watchlist', symbols: snap.symbols } }, history, registry).missing;
    g.append(el('p', { class: 'metaline', style: 'grid-column:1/-1' }, snap.name
      ? `${snap.symbols.length} symbol${snap.symbols.length === 1 ? '' : 's'} as of ${snap.asOf}: ${snap.symbols.join(', ') || '—'}${snap.unresolved.length ? ` · not resolvable to a symbol: ${snap.unresolved.join(', ')}` : ''}${noSeries.length ? ` · no series in your history, so not scanned: ${noSeries.join(', ')}` : ''}. The worker cannot read this browser, so the setup carries this snapshot — copy the JSON again when the list changes.`
      : 'No watchlist selected.'));
  }
  /* The markets the registry the worker reads actually holds, in its own
     order — the select used to offer US and MY only, of thirty. */
  if (d.universe.kind === 'market') {
    const mkts = [...new Set(registry.map(i => String(i.market || '').toUpperCase()).filter(Boolean))];
    if (!mkts.includes(String(d.universe.market))) mkts.unshift(String(d.universe.market));
    g.append(field('Market', select(d.universe.market, mkts.map(m => [m, m === 'MY' ? 'MY — Bursa Malaysia' : m]), v => { d.universe.market = v; })));
    g.append(el('p', { class: 'metaline', style: 'grid-column:1/-1' }, 'Membership is read from data/instruments.json, the file the worker reads. A series with no row there has no market and is listed as skipped when you test.'));
  }
  g.append(field('Cooldown (bars before the same instrument can match again)', text(d.cooldownBars, v => { const n = numOrAbsent(v); d.cooldownBars = n === undefined ? 0 : Math.max(0, Math.round(n)); }, { type: 'number', min: '0', step: '1' })));
  g.append(field('Expires (blank for persistent)', text(d.expires || '', v => { d.expires = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }, { type: 'date' })));
  card.append(g);

  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Rules'));
  const INDS = [['price', 'price'], ['volume', 'volume'], ['sma', 'SMA'], ['ema', 'EMA'], ['rsi', 'RSI'], ['macd', 'MACD'], ['volume_avg', 'average volume']];
  const OPS = Object.entries(SCAN_OPERATORS).map(([k, v]) => [k, v.label]);
  const proseSpans = [];
  const periodField = (side, which) => field('Period (bars)', text(side.n, v => { const n = numOrAbsent(v); if (n === undefined) delete side.n; else side.n = n; }, { type: 'number', min: '1', step: '1', placeholder: String(SCAN_DEFAULT_N[side.indicator] ?? ''), 'aria-label': `${which} period (bars)` }));
  d.rules.forEach((r, i) => {
    const row = el('div', { class: 'panel', style: 'margin-bottom:8px' });
    const grid = el('div', { class: 'grid g-4', style: 'gap:var(--sm)' });
    grid.append(field('Left', select(r.left?.indicator || 'price', INDS, v => { r.left = freshSide(v); })));
    if (PERIOD.includes(r.left?.indicator)) grid.append(periodField(r.left, 'Left'));
    if (r.left?.indicator === 'macd') grid.append(field('MACD field', select(r.left.field || 'line', [['line', 'line'], ['signal', 'signal'], ['hist', 'histogram']], v => { r.left.field = v; })));
    grid.append(field('Operator', select(scanOpName(r.op) || r.op, OPS, v => { r.op = v; if (v === 'BETWEEN') { r.range = r.range || [50, 70]; delete r.right; } else { delete r.range; if (!r.right) r.right = { indicator: 'ema', n: 50 }; } })));
    if (scanOpName(r.op) === 'BETWEEN') {
      r.range = Array.isArray(r.range) ? r.range : [null, null];
      grid.append(field('From', text(r.range[0], v => { r.range[0] = numOrAbsent(v) ?? null; }, { type: 'number', step: 'any' })));
      grid.append(field('To', text(r.range[1], v => { r.range[1] = numOrAbsent(v) ?? null; }, { type: 'number', step: 'any' })));
    } else {
      grid.append(field('Right', select(r.right?.indicator ? r.right.indicator : 'value', [['value', 'a fixed value'], ...INDS], v => { r.right = v === 'value' ? { value: null } : freshSide(v); })));
      if (r.right?.indicator && PERIOD.includes(r.right.indicator)) grid.append(periodField(r.right, 'Right'));
      if (r.right?.indicator === 'macd') grid.append(field('MACD field (right)', select(r.right.field || 'line', [['line', 'line'], ['signal', 'signal'], ['hist', 'histogram']], v => { r.right.field = v; })));
      if (r.right?.indicator) grid.append(field('Multiplier (1 = none)', text(r.right.multiplier ?? 1, v => { const m = numOrAbsent(v); if (m !== undefined && m > 0 && m !== 1) r.right.multiplier = m; else delete r.right.multiplier; }, { type: 'number', step: 'any', min: '0' })));
      if (r.right && !r.right.indicator) grid.append(field('Value', text(r.right.value, v => { r.right.value = numOrAbsent(v) ?? null; }, { type: 'number', step: 'any' })));
    }
    /* Each field's accessible name says which rule it edits: every rule
       repeated "Left", "Operator", "Period (bars)", so a screen reader could
       not tell one rule's period from another's, or left from right. */
    grid.querySelectorAll('[aria-label]').forEach(n => n.setAttribute('aria-label', `Rule ${i + 1}: ${n.getAttribute('aria-label')}`));
    row.append(grid);
    const prose = el('span', { class: 'metaline' }, scanRuleProse(r));
    proseSpans.push([prose, r]);
    row.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:6px;align-items:center' }, [
      prose,
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Remove rule ${i + 1}`, onclick: () => { d.rules.splice(i, 1); if (!d.rules.length) d.rules.push(scanBlankRule()); rebuild(); } }, 'Remove'),
    ]));
    card.append(row);
  });
  card.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { d.rules.push(scanBlankRule()); rebuild(); } }, 'Add a rule'));

  /* Test and output. */
  const outHost = el('div', { style: 'margin-top:var(--md)' });
  const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
  /* The setup as the worker will read it. A watchlist universe is expanded
     here, at the moment the JSON is written, into the symbols the list holds. */
  const draftSetup = () => {
    const out = JSON.parse(JSON.stringify({ ...d, enabled: true }));
    if (d.universe.kind === 'watchlist') {
      const snap = watchlistSymbols(d.universe.watchlistId);
      out.universe = { kind: 'watchlist', watchlistId: d.universe.watchlistId, name: snap.name, symbols: snap.symbols, asOf: snap.asOf, unresolved: snap.unresolved };
    }
    return out;
  };
  const draftJson = () => JSON.stringify({ setups: [draftSetup()] }, null, 2);
  const testBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
    const r = scanRun([draftSetup()], history, { instruments: registry, existing: alerts, now: new Date().toISOString() });
    outHost.replaceChildren(scanRunSummary(r, 'A test of the draft against the loaded history. Nothing is recorded.'));
  } }, 'Test against your history (not recorded)');
  const copyBtn = el('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
    try { await navigator.clipboard.writeText(draftJson()); toast('Setup JSON copied — save it as data/scan-setups.json'); }
    catch { toast('Could not reach the clipboard — copy the JSON below'); }
  } }, 'Copy setup JSON');
  acts.append(testBtn, copyBtn, el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { scanDraft = scanBlankDraft(); scanIdAuto = true; rebuild(); } }, 'Start over'));
  card.append(acts);
  const problemsHost = el('ul', { class: 'rulelist', style: 'margin-top:6px' });
  card.append(problemsHost);
  card.append(outHost);
  const pre = el('pre', { class: 'caption', style: 'margin-top:var(--md);white-space:pre-wrap;max-height:320px;overflow:auto;padding:var(--sm);background:var(--surface-sunk);border-radius:var(--r-sm)' });
  card.append(pre);
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'To add this to an existing file, paste the object inside the file’s "setups" array. Then: node scanner/scan.mjs — or let the daily run pick it up. Ids are part of every alert key, so renaming a setup starts its history afresh.'));

  /* In place: the buttons, the reasons, the JSON and each rule's prose. */
  function refresh() {
    const v = scanValidate({ setups: [draftSetup()] });
    const ready = v.problems.length === 0;
    copyBtn.disabled = !ready;
    testBtn.disabled = !ready || !history?.series;
    problemsHost.replaceChildren(...(ready ? [] : v.problems.map(p => el('li', { class: 'caption' }, `Not ready — ${p.replace(/^[^:]*: /, '')}`))));
    pre.textContent = ready ? draftJson() : '';
    pre.hidden = !ready;
    proseSpans.forEach(([span, r]) => { span.textContent = scanRuleProse(r); });
  }
  refresh();
  return card;
}
