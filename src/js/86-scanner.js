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

   ONE ENGINE. scanner/scan.mjs slices the region between the markers below
   out of index.html and runs it in Node, so the daily worker and this page
   cannot evaluate a rule differently — the Trading Index pattern. Everything
   above the closing marker is pure: no DOM, no State, no localStorage.
   ========================================================================== */

/* @scan-engine-start — sliced by scanner/scan.mjs; keep this region pure. */
const SCAN_VERSION = '0.1.0';

/* Indicators and how many bars each needs before it says anything. A 50-bar
   average from 22 bars is a different number wearing its name, so a rule on
   it is UNTESTED rather than met or failed. Crossings need one bar more. */
const SCAN_INDICATORS = {
  price:      { label: 'price',                    needs: () => 1 },
  volume:     { label: 'volume',                   needs: () => 1 },
  sma:        { label: 'SMA',  param: 'n', needs: (s) => Math.max(1, s.n || 20) },
  ema:        { label: 'EMA',  param: 'n', needs: (s) => Math.max(1, s.n || 20) },
  rsi:        { label: 'RSI',  param: 'n', needs: (s) => Math.max(2, (s.n || 14) + 1) },
  macd:       { label: 'MACD', needs: (s) => Math.max(2, (s.slow || 26) + (s.signal || 9) - 1) },
  volume_avg: { label: 'average volume', param: 'n', needs: (s) => Math.max(1, s.n || 20) },
};
const SCAN_OPERATORS = {
  above:         { label: 'above',         needsPrev: false },
  below:         { label: 'below',         needsPrev: false },
  crosses_above: { label: 'crosses above', needsPrev: true },
  crosses_below: { label: 'crosses below', needsPrev: true },
  between:       { label: 'between',       needsPrev: false },
};

/* Series helpers. Each returns an array the length of its input with null
   wherever the window is not yet full — alignment is what makes "the bar
   before" a defined thing. */
function scanSma(a, n) {
  const out = new Array(a.length).fill(null);
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i];
    if (i >= n) s -= a[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}
function scanEma(a, n) {
  const out = new Array(a.length).fill(null);
  if (a.length < n) return out;
  const k = 2 / (n + 1);
  let e = a.slice(0, n).reduce((t, v) => t + v, 0) / n;
  out[n - 1] = e;
  for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); out[i] = e; }
  return out;
}
/* Wilder's RSI: a simple average of the first n changes, then smoothed. */
function scanRsi(a, n) {
  const out = new Array(a.length).fill(null);
  if (a.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  const rsi = (g, l) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  out[n] = rsi(gain, loss);
  for (let i = n + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = rsi(gain, loss);
  }
  return out;
}
function scanMacd(a, fast, slow, signal) {
  const ef = scanEma(a, fast), es = scanEma(a, slow);
  const line = a.map((_, i) => (ef[i] == null || es[i] == null) ? null : ef[i] - es[i]);
  const first = line.findIndex(v => v != null);
  const sig = new Array(a.length).fill(null);
  if (first >= 0) {
    const tail = scanEma(line.slice(first), signal);
    tail.forEach((v, j) => { sig[first + j] = v; });
  }
  const hist = line.map((v, i) => (v == null || sig[i] == null) ? null : v - sig[i]);
  return { line, signal: sig, hist };
}

/* One side of a rule, as a series over the bars. `spec` names the indicator
   and its parameters; `multiplier` scales it (1.5 × average volume). */
function scanIndicatorSeries(spec, bars) {
  const id = spec?.indicator;
  const def = SCAN_INDICATORS[id];
  if (!def) return { series: null, label: `unknown indicator “${id}”`, needs: Infinity };
  const mult = Number.isFinite(spec.multiplier) && spec.multiplier > 0 ? spec.multiplier : 1;
  const scale = (arr) => mult === 1 ? arr : arr.map(v => v == null ? null : v * mult);
  const n = Math.max(1, Math.round(Number(spec.n) || 0)) || null;
  let series, label;
  switch (id) {
    case 'price':      series = bars.closes; label = 'price'; break;
    case 'volume':     series = bars.volumes; label = 'volume'; break;
    case 'sma':        series = scanSma(bars.closes, n || 20); label = `SMA${n || 20}`; break;
    case 'ema':        series = scanEma(bars.closes, n || 20); label = `EMA${n || 20}`; break;
    case 'rsi':        series = scanRsi(bars.closes, n || 14); label = `RSI${n || 14}`; break;
    case 'volume_avg': series = scanSma(bars.volumes, n || 20); label = `${n || 20}-bar average volume`; break;
    case 'macd': {
      const m = scanMacd(bars.closes, spec.fast || 12, spec.slow || 26, spec.signal || 9);
      const field = ['line', 'signal', 'hist'].includes(spec.field) ? spec.field : 'line';
      series = m[field]; label = `MACD ${field}`;
      break;
    }
  }
  if (id === 'volume' || id === 'volume_avg') {
    if (!bars.volumes || bars.volumes.every(v => v == null)) return { series: null, label, needs: def.needs(spec), noVolume: true };
  }
  return { series: scale(series), label: mult === 1 ? label : `${mult}× ${label}`, needs: def.needs(spec) };
}

const scanFmt = (v) => v == null ? '—' : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(2);

/* One rule on the last completed bar. `met` is true, false, or null for
   untested — and untested is not failed: a rule that could not be evaluated
   has not been satisfied and has not been broken either. */
function scanRule(rule, bars) {
  const op = SCAN_OPERATORS[rule?.op];
  if (!op) return { met: null, text: `unknown operator “${rule?.op}”`, untested: true };
  const L = scanIndicatorSeries(rule.left || {}, bars);
  if (L.noVolume) return { met: null, text: `${L.label}: no volume is carried for this instrument`, untested: true };
  if (!L.series) return { met: null, text: L.label, untested: true };
  const last = bars.closes.length - 1, prev = last - 1;
  const needs = L.needs + (op.needsPrev ? 1 : 0);
  const lv = L.series[last], lp = op.needsPrev ? L.series[prev] : null;
  if (lv == null || (op.needsPrev && lp == null)) {
    return { met: null, untested: true, needs, text: `${L.label} needs ${needs} bars; ${bars.closes.length} held` };
  }
  if (rule.op === 'between') {
    const [lo, hi] = Array.isArray(rule.range) && rule.range.length === 2 ? rule.range.map(Number) : [NaN, NaN];
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { met: null, untested: true, text: `${L.label}: no range given` };
    const met = lv >= Math.min(lo, hi) && lv <= Math.max(lo, hi);
    return { met, text: `${L.label} ${scanFmt(lv)} ${met ? 'between' : 'outside'} ${scanFmt(lo)} and ${scanFmt(hi)}`, left: lv };
  }
  /* The right-hand side: a fixed value, or another indicator. */
  let rv, rp, rlabel;
  if (rule.right && rule.right.indicator) {
    const R = scanIndicatorSeries(rule.right, bars);
    if (R.noVolume) return { met: null, text: `${R.label}: no volume is carried for this instrument`, untested: true };
    if (!R.series) return { met: null, text: R.label, untested: true };
    const rneeds = R.needs + (op.needsPrev ? 1 : 0);
    rv = R.series[last]; rp = op.needsPrev ? R.series[prev] : null; rlabel = R.label;
    if (rv == null || (op.needsPrev && rp == null)) {
      return { met: null, untested: true, needs: Math.max(needs, rneeds), text: `${R.label} needs ${rneeds} bars; ${bars.closes.length} held` };
    }
  } else {
    const v = Number(rule.right?.value);
    if (!Number.isFinite(v)) return { met: null, untested: true, text: `${L.label}: no value to compare against` };
    rv = v; rp = v; rlabel = scanFmt(v);
  }
  let met;
  switch (rule.op) {
    case 'above': met = lv > rv; break;
    case 'below': met = lv < rv; break;
    case 'crosses_above': met = lp <= rp && lv > rv; break;
    case 'crosses_below': met = lp >= rp && lv < rv; break;
  }
  const verb = rule.op === 'crosses_above' ? (met ? 'crossed above' : 'did not cross above')
             : rule.op === 'crosses_below' ? (met ? 'crossed below' : 'did not cross below')
             : rule.op === 'above' ? (met ? 'above' : 'not above') : (met ? 'below' : 'not below');
  const rtext = rule.right?.indicator ? `${rlabel} ${scanFmt(rv)}` : rlabel;
  return { met, text: `${L.label} ${scanFmt(lv)} ${verb} ${rtext}`, left: lv, right: rv };
}

/* A whole setup on one instrument's bars. */
function scanSetup(setup, symbol, bars) {
  const rules = (setup.rules || []).map(r => scanRule(r, bars));
  const anyUntested = rules.some(r => r.met === null);
  const logic = setup.logic === 'OR' ? 'OR' : 'AND';
  let matched;
  if (!rules.length) matched = false;
  else if (logic === 'AND') matched = rules.every(r => r.met === true);
  else matched = rules.some(r => r.met === true);
  /* An AND with an untested rule cannot match; an OR can match on the rules
     that could be tested, and says the others were not. */
  const untested = logic === 'AND' ? anyUntested : (!matched && anyUntested);
  const last = bars.closes.length - 1;
  return { symbol, matched: matched && !(logic === 'AND' && anyUntested), untested, rules,
           bar: bars.dates[last] || null, close: bars.closes[last] ?? null };
}

/* Which instruments a setup looks at. `all` is everything with a series;
   `market` reads the instrument registry; `symbols` is the reader's list. */
function scanUniverse(setup, history, instruments) {
  const have = Object.keys(history?.series || {});
  const u = setup.universe || { kind: 'all' };
  /* A watchlist universe is the list's symbols, snapshotted into the setup
     when the JSON was written: the worker cannot read a browser's storage. */
  if (u.kind === 'symbols' || u.kind === 'watchlist') {
    const want = new Set((u.symbols || []).map(s => String(s).toUpperCase()));
    return have.filter(s => want.has(String(s).toUpperCase()));
  }
  if (u.kind === 'market') {
    const mkt = String(u.market || '').toUpperCase();
    const reg = new Map((instruments || []).map(i => [String(i.symbol).toUpperCase(), i]));
    return have.filter(s => reg.get(String(s).toUpperCase())?.market === mkt);
  }
  return have;
}

/* An instrument's bars from the history file's {date: close} shape, in date
   order, with volumes aligned (null where none was recorded). */
function scanBars(history, symbol) {
  const s = history?.series?.[symbol] || {};
  const v = history?.volume?.[symbol] || {};
  const dates = Object.keys(s).filter(d => Number.isFinite(s[d]) && s[d] > 0).sort();
  return { dates, closes: dates.map(d => s[d]), volumes: dates.map(d => (Number.isFinite(v[d]) ? v[d] : null)) };
}

const scanKey = (setupId, symbol, timeframe, bar) => `${setupId}|${symbol}|${timeframe}|${bar}`;

/* The run. Every enabled, unexpired setup against every instrument in its
   universe, on the last completed bar of each; a match becomes one alert
   record unless the same key already exists or the setup matched this
   instrument within its cooldown. Nothing is sorted by anything but the
   order of the setups and the symbols. */
function scanRun(setups, history, { instruments = [], existing = [], now = null } = {}) {
  const out = { engine: `scan ${SCAN_VERSION}`, alerts: [], evaluated: 0, matched: 0, untested: 0, skipped: [], setups: 0 };
  const seen = new Set((existing || []).map(a => a.key));
  const lastBar = (sym) => { const d = Object.keys(history?.series?.[sym] || {}).sort(); return d[d.length - 1] || null; };
  for (const setup of setups || []) {
    if (!setup || setup.enabled === false) continue;
    if (!setup.id) { out.skipped.push({ setup: setup.name || '(unnamed)', why: 'no id' }); continue; }
    if ((setup.timeframe || 'daily') !== 'daily') { out.skipped.push({ setup: setup.id, why: `timeframe “${setup.timeframe}” is not built — daily only` }); continue; }
    out.setups++;
    const symbols = scanUniverse(setup, history, instruments);
    if (!symbols.length) { out.skipped.push({ setup: setup.id, why: 'no instrument in its universe has a series' }); continue; }
    for (const sym of symbols) {
      const bars = scanBars(history, sym);
      if (bars.closes.length < 2) { out.skipped.push({ setup: setup.id, symbol: sym, why: 'fewer than two bars' }); continue; }
      const bar = bars.dates[bars.dates.length - 1];
      if (setup.expires && bar > setup.expires) { out.skipped.push({ setup: setup.id, symbol: sym, why: `expired ${setup.expires}` }); continue; }
      out.evaluated++;
      const r = scanSetup(setup, sym, bars);
      if (r.untested) out.untested++;
      if (!r.matched) continue;
      out.matched++;
      const key = scanKey(setup.id, sym, 'daily', bar);
      if (seen.has(key)) { out.skipped.push({ setup: setup.id, symbol: sym, why: 'already recorded for this bar' }); continue; }
      /* Cooldown counts BARS of this instrument, not days: a holiday is not a
         bar. The most recent recorded alert for this setup and symbol is found
         and its bar's position compared with today's. */
      const cd = Math.max(0, Math.round(Number(setup.cooldownBars) || 0));
      if (cd > 0) {
        const mine = (existing || []).filter(a => a.setupId === setup.id && a.symbol === sym).map(a => a.bar).sort();
        const prevBar = mine[mine.length - 1];
        if (prevBar) {
          const i = bars.dates.indexOf(prevBar);
          if (i >= 0 && (bars.dates.length - 1 - i) <= cd) { out.skipped.push({ setup: setup.id, symbol: sym, why: `within the ${cd}-bar cooldown of ${prevBar}` }); continue; }
        }
      }
      const rec = { key, setupId: setup.id, setupName: setup.name || setup.id, symbol: sym, timeframe: 'daily',
                    bar, close: r.close, recordedAt: now || null,
                    rules: r.rules.map(x => ({ text: x.text, met: x.met })), engine: out.engine };
      out.alerts.push(rec);
      seen.add(key);
    }
  }
  /* The run's as-of: the latest bar any series holds. */
  out.asOf = Object.keys(history?.series || {}).map(lastBar).filter(Boolean).sort().pop() || null;
  return out;
}

/* The fixture every run self-tests against. Sixty bars of a flat-ish series,
   then a rise that carries price above its 50-bar EMA on the last bar with
   volume at twice its average and RSI inside 50–70 — and a second instrument
   that does none of that. Returns the history and the setup; the expected
   answer is that ONE alert exists, for MATCH, and the numbers below are what
   the engine must produce from these exact inputs. */
function scanFixture() {
  const closes = [], vols = [];
  for (let i = 0; i < 60; i++) { closes.push(100 + Math.sin(i / 3) * 1.5); vols.push(1000); }
  /* A drift down, then a last bar that jumps through the average on volume. */
  for (let i = 0; i < 5; i++) { closes.push(97.5 - i * 0.3); vols.push(1000); }
  closes.push(104.5); vols.push(2200);
  const flat = closes.map(() => 100), flatV = vols.map(() => 1000);
  const dates = closes.map((_, i) => { const d = new Date(Date.UTC(2026, 0, 5)); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
  const series = (arr) => Object.fromEntries(dates.map((d, i) => [d, arr[i]]));
  const history = { series: { MATCH: series(closes), FLAT: series(flat) }, volume: { MATCH: series(vols), FLAT: series(flatV) } };
  const setup = { id: 'fixture-breakout', name: 'Fixture breakout', enabled: true, universe: { kind: 'all' }, timeframe: 'daily',
    confirmation: 'close', logic: 'AND', cooldownBars: 5, expires: null,
    rules: [
      { left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } },
      { left: { indicator: 'volume' }, op: 'above', right: { indicator: 'volume_avg', n: 20, multiplier: 1.5 } },
      { left: { indicator: 'rsi', n: 14 }, op: 'between', range: [50, 70] },
    ] };
  return { history, setup, lastBar: dates[dates.length - 1] };
}

function scanSelfTest() {
  const { history, setup, lastBar } = scanFixture();
  const r = scanRun([setup], history, { now: '2026-01-01T00:00:00Z' });
  const a = r.alerts[0];
  const ok = r.alerts.length === 1 && a && a.symbol === 'MATCH' && a.bar === lastBar
    && a.key === scanKey('fixture-breakout', 'MATCH', 'daily', lastBar) && a.rules.length === 3 && a.rules.every(x => x.met === true);
  /* And the run is idempotent: the same alerts as existing produce none. */
  const again = scanRun([setup], history, { existing: r.alerts, now: '2026-01-01T00:00:00Z' });
  return { ok: ok && again.alerts.length === 0, alerts: r.alerts.length, again: again.alerts.length, symbol: a?.symbol, bar: a?.bar, rules: a?.rules?.map(x => x.text) };
}
/* @scan-engine-end — everything above is pure; the page begins here. */

/* ---------------------------------------------------------------- page --- */
/* Files the worker writes and this page reads. Both are git-ignored and live
   only on the reader's machine; on the deployed site they 404 and the page
   says what it would show. */
let scanSetupsFile = null, scanAlertsFile = null;

/* The builder's draft lives in memory for the session, not in storage: the
   setups file is the record, and a second copy in the browser would be the
   drift this codebase keeps finding in itself. */
let scanDraft = null;
const scanBlankRule = () => ({ left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } });
const scanBlankDraft = () => ({ id: '', name: '', enabled: true, universe: { kind: 'symbols', symbols: [] }, timeframe: 'daily',
  confirmation: 'close', logic: 'AND', cooldownBars: 5, expires: null, rules: [scanBlankRule()] });

const scanRuleProse = (r) => {
  const side = (s) => { if (!s) return '—'; const def = SCAN_INDICATORS[s.indicator]; if (!def) return s.indicator || '—';
    const base = def.param ? `${def.label}${s.n || (s.indicator === 'rsi' ? 14 : 20)}` : s.indicator === 'macd' ? `MACD ${s.field || 'line'}` : def.label;
    return s.multiplier && s.multiplier !== 1 ? `${s.multiplier}× ${base}` : base; };
  if (r.op === 'between') return `${side(r.left)} between ${r.range?.[0] ?? '?'} and ${r.range?.[1] ?? '?'}`;
  return `${side(r.left)} ${SCAN_OPERATORS[r.op]?.label || r.op} ${r.right?.indicator ? side(r.right) : (r.right?.value ?? '?')}`;
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
      'Conditions you define, evaluated on price history you supplied, producing a record of which conditions held on which completed bar. '
      + 'It does not rank, it does not deliver anything, and it does not say that any condition means anything.'),
  ])));

  const history = trackedHistory;
  const haveHistory = !!(history?.series && Object.keys(history.series).length);
  const registry = instruments?.instruments || [];
  const setups = Array.isArray(scanSetupsFile?.setups) ? scanSetupsFile.setups : Array.isArray(scanSetupsFile) ? scanSetupsFile : [];
  const alerts = Array.isArray(scanAlertsFile?.alerts) ? scanAlertsFile.alerts : [];

  /* ---- what this is, and is not ---- */
  const bd = el('div', { class: 'card' });
  bd.append(cardHead('What this will and will not do', 'Named rather than implied.'));
  bd.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'It reads only your own price history — data/price-history.json, built from your screen or your export under your subscription. No feed is licensed to this product, so no other data is scanned and none of this is offered to anyone else.'),
    el('li', {}, 'A match is a record that the conditions you wrote held on a completed daily bar, with the values. It is not a signal, and no indicator here has been validated on point-in-time data, so none is claimed to work.'),
    el('li', {}, 'Nothing is ranked or sorted by strength. Matches appear in the order of your setups and your instruments.'),
    el('li', {}, 'Nothing is delivered. The worker writes a file; this page reads it. Email, Telegram and push need a server and a contact address held under a privacy notice, and this build has neither.'),
    el('li', {}, 'Daily bars, confirmed at the close, only. Intraday needs a licensed feed; backtesting needs point-in-time history. Both are named in the plan as gated, not as missing.'),
  ]));
  wrap.append(bd);

  /* ---- data present ---- */
  const dataCard = el('div', { class: 'card' });
  dataCard.append(cardHead('Price history in this browser', haveHistory
    ? `${Object.keys(history.series).length} instruments, generated ${history.generated ? String(history.generated).slice(0, 10) : '—'}. Personal research — not redistributable.`
    : 'None loaded.'));
  if (!haveHistory) dataCard.append(el('p', { class: 'body', style: 'font-size:13px' },
    'On the deployed site there is no price history to scan, by design: none of the prices this product could ship are licensed for it to redistribute. Locally, run the daily capture (ingest/daily.mjs) or import an export (ingest/history-import.mjs) and this page reads data/price-history.json.'));
  else {
    const depth = Object.values(history.series).map(s => Object.keys(s).length);
    dataCard.append(el('p', { class: 'metaline' }, `Series depth ${Math.min(...depth)}–${Math.max(...depth)} bars. A rule whose indicator needs more bars than an instrument holds is reported as untested for it, never as met or failed.`));
  }
  wrap.append(dataCard);

  /* ---- setups on file, and a live evaluation of them ---- */
  const sc = el('div', { class: 'card' });
  sc.append(cardHead('Your setups', setups.length ? `${setups.length} in data/scan-setups.json. The worker evaluates them after each daily run; the button below evaluates them now, here, and records nothing.` : 'No setups file is loaded.'));
  if (!setups.length) sc.append(el('p', { class: 'body', style: 'font-size:13px' },
    'Write your first setup with the builder below, save it as data/scan-setups.json (a committed example is at scanner/setups.example.json), and run node scanner/scan.mjs. The file stays on your machine — it is git-ignored and CI fails if it is ever tracked.'));
  setups.forEach(s => {
    const p = el('div', { class: 'panel', style: 'margin-top:8px' });
    p.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
      el('span', { style: 'font-weight:600' }, s.name || s.id),
      el('span', { class: 'chip' }, s.id),
      s.enabled === false ? el('span', { class: 'chip chip-bronze' }, 'disabled') : null,
      el('span', { class: 'chip' }, `${s.logic === 'OR' ? 'any' : 'all'} of ${(s.rules || []).length} rule${(s.rules || []).length === 1 ? '' : 's'}`),
      el('span', { class: 'chip' }, `cooldown ${s.cooldownBars ?? 0} bars`),
      s.expires ? el('span', { class: 'chip' }, `expires ${s.expires}`) : null,
    ]));
    p.append(el('p', { class: 'metaline', style: 'margin-top:4px' }, `Universe: ${scanUniverseProse(s.universe)} · ${s.timeframe || 'daily'} bars, confirmed at the close.`));
    p.append(el('ul', { class: 'rulelist' }, (s.rules || []).map(r => el('li', {}, scanRuleProse(r)))));
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
    ? `${alerts.length} recorded match${alerts.length === 1 ? '' : 'es'} in data/scan-alerts.json, newest first. Each is one setup, one instrument, one completed bar; the same bar is never recorded twice.`
    : 'Nothing recorded yet.'));
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
  box.append(el('p', { class: 'metaline' }, `${r.setups} setup${r.setups === 1 ? '' : 's'} · ${r.evaluated} evaluation${r.evaluated === 1 ? '' : 's'} on the last completed bar${r.asOf ? ` (${r.asOf})` : ''} · ${r.matched} match${r.matched === 1 ? '' : 'es'} · ${r.untested} untested · ${r.skipped.length} skipped. ${note || ''}`));
  if (r.alerts.length) {
    const ul = el('ul', { class: 'ticklist', style: 'margin-top:6px' });
    r.alerts.forEach(a => ul.append(el('li', {}, [`${a.setupName} · `, scanSymbolLink(a.symbol), ` · ${a.bar} · close ${scanFmt(a.close)} — ${a.rules.map(x => x.text).join('; ')}`])));
    box.append(ul);
  }
  const untestedWhy = r.skipped.filter(s => s.why);
  if (untestedWhy.length) {
    const det = el('details', { style: 'margin-top:6px' });
    det.append(el('summary', { class: 'caption', style: 'cursor:pointer' }, `Skipped and untested (${untestedWhy.length})`));
    det.append(el('ul', { class: 'rulelist' }, untestedWhy.slice(0, 60).map(s => el('li', { class: 'caption' }, `${s.setup}${s.symbol ? ' · ' + s.symbol : ''}: ${s.why}`))));
    box.append(det);
  }
  return box;
}

/* The setup builder. It writes JSON for the reader to save — the same
   pattern as the Trading Index observations file — and can test the draft
   against the loaded history without recording anything. */
function scanBuilder(history, registry, alerts) {
  const card = el('div', { class: 'card' });
  card.append(cardHead('Setup builder', 'Write a setup, test it against your history, then save the JSON as data/scan-setups.json for the worker.'));
  const d = scanDraft || (scanDraft = scanBlankDraft());
  /* Re-render the card in place: the page around it has nothing to redraw. */
  const rerender = () => card.replaceWith(scanBuilder(history, registry, alerts));
  const field = (label, input) => { const f = el('div', { class: 'field' }); f.append(el('label', {}, label)); if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', label); f.append(input); return f; };
  const text = (val, on, attrs = {}) => el('input', { class: 'input', value: val ?? '', ...attrs, onchange: e => { on(e.target.value); rerender(); } });
  const select = (val, opts, on) => { const s = el('select', { class: 'select', onchange: e => { on(e.target.value); rerender(); } }); opts.forEach(([v, l]) => s.append(el('option', { value: v, selected: String(val) === String(v) ? '' : null }, l))); return s; };

  const g = el('div', { class: 'grid g-3', style: 'gap:var(--sm)' });
  g.append(field('Name', text(d.name, v => { d.name = v; if (!d.id) d.id = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); })));
  g.append(field('Id (stable; part of every alert key)', text(d.id, v => { d.id = v.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40); })));
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
    g.append(el('p', { class: 'metaline', style: 'grid-column:1/-1' }, snap.name
      ? `${snap.symbols.length} symbol${snap.symbols.length === 1 ? '' : 's'} as of ${snap.asOf}: ${snap.symbols.join(', ') || '—'}${snap.unresolved.length ? ` · not resolvable to a symbol: ${snap.unresolved.join(', ')}` : ''}. The worker cannot read this browser, so the setup carries this snapshot — copy the JSON again when the list changes.`
      : 'No watchlist selected.'));
  }
  if (d.universe.kind === 'market') g.append(field('Market', select(d.universe.market, [['US', 'US'], ['MY', 'Bursa Malaysia']], v => { d.universe.market = v; })));
  g.append(field('Cooldown (bars before the same instrument can match again)', text(d.cooldownBars, v => { d.cooldownBars = Math.max(0, Math.round(Number(v) || 0)); }, { type: 'number', min: '0', step: '1' })));
  g.append(field('Expires (blank for persistent)', text(d.expires || '', v => { d.expires = v || null; }, { type: 'date' })));
  card.append(g);

  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Rules'));
  const INDS = [['price', 'price'], ['volume', 'volume'], ['sma', 'SMA'], ['ema', 'EMA'], ['rsi', 'RSI'], ['macd', 'MACD'], ['volume_avg', 'average volume']];
  const OPS = Object.entries(SCAN_OPERATORS).map(([k, v]) => [k, v.label]);
  d.rules.forEach((r, i) => {
    const row = el('div', { class: 'panel', style: 'margin-bottom:8px' });
    const grid = el('div', { class: 'grid g-4', style: 'gap:var(--sm)' });
    grid.append(field('Left', select(r.left?.indicator || 'price', INDS, v => { r.left = { indicator: v, ...(['sma', 'ema', 'rsi', 'volume_avg'].includes(v) ? { n: v === 'rsi' ? 14 : 20 } : {}) }; })));
    if (['sma', 'ema', 'rsi', 'volume_avg'].includes(r.left?.indicator)) grid.append(field('Period (bars)', text(r.left.n, v => { r.left.n = Math.max(1, Math.round(Number(v) || 1)); }, { type: 'number', min: '1', step: '1' })));
    if (r.left?.indicator === 'macd') grid.append(field('MACD field', select(r.left.field || 'line', [['line', 'line'], ['signal', 'signal'], ['hist', 'histogram']], v => { r.left.field = v; })));
    grid.append(field('Operator', select(r.op, OPS, v => { r.op = v; if (v === 'between') { r.range = r.range || [50, 70]; delete r.right; } else if (!r.right) r.right = { indicator: 'ema', n: 50 }; })));
    if (r.op === 'between') {
      grid.append(field('From', text(r.range?.[0], v => { r.range = [Number(v), r.range?.[1] ?? 0]; }, { type: 'number', step: 'any' })));
      grid.append(field('To', text(r.range?.[1], v => { r.range = [r.range?.[0] ?? 0, Number(v)]; }, { type: 'number', step: 'any' })));
    } else {
      grid.append(field('Right', select(r.right?.indicator ? r.right.indicator : 'value', [['value', 'a fixed value'], ...INDS], v => { r.right = v === 'value' ? { value: 0 } : { indicator: v, ...(['sma', 'ema', 'rsi', 'volume_avg'].includes(v) ? { n: v === 'rsi' ? 14 : 20 } : {}) }; })));
      if (r.right?.indicator && ['sma', 'ema', 'rsi', 'volume_avg'].includes(r.right.indicator)) grid.append(field('Period (bars)', text(r.right.n, v => { r.right.n = Math.max(1, Math.round(Number(v) || 1)); }, { type: 'number', min: '1', step: '1' })));
      if (r.right?.indicator) grid.append(field('Multiplier (1 = none)', text(r.right.multiplier ?? 1, v => { const m = Number(v); if (Number.isFinite(m) && m > 0 && m !== 1) r.right.multiplier = m; else delete r.right.multiplier; }, { type: 'number', step: 'any', min: '0' })));
      if (r.right && !r.right.indicator) grid.append(field('Value', text(r.right.value, v => { r.right.value = Number(v); }, { type: 'number', step: 'any' })));
    }
    row.append(grid);
    row.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:6px;align-items:center' }, [
      el('span', { class: 'metaline' }, scanRuleProse(r)),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { d.rules.splice(i, 1); if (!d.rules.length) d.rules.push(scanBlankRule()); rerender(); } }, 'Remove'),
    ]));
    card.append(row);
  });
  card.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { d.rules.push(scanBlankRule()); rerender(); } }, 'Add a rule'));

  /* Test and output. */
  const outHost = el('div', { style: 'margin-top:var(--md)' });
  const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
  const ready = d.id && d.rules.length;
  /* The setup as the worker will read it. A watchlist universe is expanded
     here, at the moment the JSON is written, into the symbols the list holds. */
  const draftSetup = () => {
    const out = { ...d, enabled: true };
    if (d.universe.kind === 'watchlist') {
      const snap = watchlistSymbols(d.universe.watchlistId);
      out.universe = { kind: 'watchlist', watchlistId: d.universe.watchlistId, name: snap.name, symbols: snap.symbols, asOf: snap.asOf, unresolved: snap.unresolved };
    }
    return out;
  };
  const draftJson = () => JSON.stringify({ setups: [draftSetup()] }, null, 2);
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', disabled: (!ready || !history?.series) ? '' : null, onclick: () => {
    const r = scanRun([draftSetup()], history, { instruments: registry, existing: alerts, now: new Date().toISOString() });
    outHost.replaceChildren(scanRunSummary(r, 'A test of the draft against the loaded history. Nothing is recorded.'));
  } }, 'Test against your history (not recorded)'));
  acts.append(el('button', { class: 'btn btn-primary btn-sm', disabled: ready ? null : '', onclick: async () => {
    try { await navigator.clipboard.writeText(draftJson()); toast('Setup JSON copied — save it as data/scan-setups.json'); }
    catch { toast('Could not reach the clipboard — copy the JSON below'); }
  } }, 'Copy setup JSON'));
  acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { scanDraft = scanBlankDraft(); rerender(); } }, 'Start over'));
  card.append(acts);
  card.append(outHost);
  if (ready) card.append(el('pre', { class: 'caption', style: 'margin-top:var(--md);white-space:pre-wrap;max-height:320px;overflow:auto;padding:var(--sm);background:var(--surface-sunk);border-radius:var(--r-sm)' }, draftJson()));
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'To add this to an existing file, paste the object inside the file’s "setups" array. Then: node scanner/scan.mjs — or let the daily run pick it up. Ids are part of every alert key, so renaming a setup starts its history afresh.'));
  return card;
}
