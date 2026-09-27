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
const SCAN_VERSION = '0.2.0';

/* Indicators and how many bars each needs before it says anything. A 50-bar
   average from 22 bars is a different number wearing its name, so a rule on
   it is UNTESTED rather than met or failed. Crossings need one bar more. */
/* ONE READING OF EVERY NUMBER A SETUP CARRIES. A period was read one way by
   the series (an absent n became 1, so SMA20 was computed as the close), a
   second way by the bars-needed count (20) and a third by the page's prose
   (SMA20) — three periods for one rule. Every consumer now calls these. A
   period that is absent takes the indicator's default; a quoted number is the
   number; null, true, '' and anything below 1 are not periods. */
const scanNumeric = (v) => (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const SCAN_DEFAULT_N = { sma: 20, ema: 20, rsi: 14, volume_avg: 20 };
const scanPeriod = (v, def) => (scanNumeric(v) && Number(v) >= 1 ? Math.round(Number(v)) : def);
const scanPeriodOf = (s) => scanPeriod(s?.n, SCAN_DEFAULT_N[s?.indicator] ?? 20);
const scanMacdPeriods = (s) => ({ fast: scanPeriod(s?.fast, 12), slow: scanPeriod(s?.slow, 26), signal: scanPeriod(s?.signal, 9) });
const scanMultiplier = (v) => (scanNumeric(v) && Number(v) > 0 ? Number(v) : 1);
const SCAN_INDICATORS = {
  price:      { label: 'price',                    needs: () => 1 },
  volume:     { label: 'volume',                   needs: () => 1 },
  sma:        { label: 'SMA',  param: 'n', needs: (s) => scanPeriodOf(s) },
  ema:        { label: 'EMA',  param: 'n', needs: (s) => scanPeriodOf(s) },
  rsi:        { label: 'RSI',  param: 'n', needs: (s) => scanPeriodOf(s) + 1 },
  /* The line exists from the slow average's first value; the signal and the
     histogram need the signal average on top of it. */
  macd:       { label: 'MACD', needs: (s) => { const p = scanMacdPeriods(s); return (s?.field === 'signal' || s?.field === 'hist') ? p.slow + p.signal - 1 : p.slow; } },
  volume_avg: { label: 'average volume', param: 'n', needs: (s) => scanPeriodOf(s) },
};
/* How a side reads in words — the page's list, the builder and the alert
   text all use this, so the rule a reader sees is the rule that ran. */
function scanSideLabel(s) {
  const id = s?.indicator, def = SCAN_INDICATORS[id];
  if (!def) return id ? `unknown indicator “${id}”` : '—';
  let base;
  if (id === 'volume_avg') base = `${scanPeriodOf(s)}-bar average volume`;
  else if (def.param) base = `${def.label}${scanPeriodOf(s)}`;
  else if (id === 'macd') {
    const p = scanMacdPeriods(s), field = ['line', 'signal', 'hist'].includes(s.field) ? s.field : 'line';
    base = `MACD${p.fast === 12 && p.slow === 26 && p.signal === 9 ? '' : `(${p.fast},${p.slow},${p.signal})`} ${field}`;
  } else base = def.label;
  const m = scanMultiplier(s.multiplier);
  return m === 1 ? base : `${m}× ${base}`;
}
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
/* A window containing an unrecorded value has no average: a missing volume
   is not a volume of nought, and summing it as one produced a lower average
   and a match that should not have been one. */
function scanSma(a, n) {
  const out = new Array(a.length).fill(null);
  const ok = (v) => v != null && Number.isFinite(v);
  let s = 0, gaps = 0;
  for (let i = 0; i < a.length; i++) {
    if (ok(a[i])) s += a[i]; else gaps++;
    if (i >= n) { if (ok(a[i - n])) s -= a[i - n]; else gaps--; }
    if (i >= n - 1 && gaps === 0) out[i] = s / n;
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
  const mult = scanMultiplier(spec.multiplier);
  const scale = (arr) => mult === 1 ? arr : arr.map(v => v == null ? null : v * mult);
  const n = scanPeriodOf(spec);
  const label = scanSideLabel(spec);
  let series, note = null;
  switch (id) {
    case 'price':      series = bars.closes; break;
    case 'volume':     series = bars.volumes; break;
    case 'sma':        series = scanSma(bars.closes, n); break;
    case 'ema':        series = scanEma(bars.closes, n); break;
    case 'rsi':        series = scanRsi(bars.closes, n); break;
    case 'volume_avg': series = scanSma(bars.volumes, n); break;
    case 'macd': {
      const p = scanMacdPeriods(spec);
      const m = scanMacd(bars.closes, p.fast, p.slow, p.signal);
      series = m[['line', 'signal', 'hist'].includes(spec.field) ? spec.field : 'line'];
      break;
    }
  }
  if (id === 'volume' || id === 'volume_avg') {
    /* No positive reading anywhere is no volume at all. FX pairs, indices and
       yields have no traded volume, and the history path stores that absence
       as 0 on every bar — which a "volume below 1" rule then matched on. A
       real instrument's odd zero-trade day sits among positive readings and
       keeps its series. */
    if (!bars.volumes || !bars.volumes.some(v => Number.isFinite(v) && v > 0)) return { series: null, label, needs: def.needs(spec), noVolume: true };
    const window = id === 'volume_avg' ? n : 1;
    const miss = bars.volumes.slice(-window).filter(v => v == null).length;
    if (miss) note = window === 1 ? 'volume is not recorded for the last bar'
      : `volume is not recorded for ${miss} of the last ${window} bars`;
  }
  return { series: scale(series), label, needs: def.needs(spec), note };
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
    return { met: null, untested: true, needs, text: L.note ? `${L.label}: ${L.note}` : `${L.label} needs ${needs} bars; ${bars.closes.length} held` };
  }
  if (rule.op === 'between') {
    /* Both bounds must be numbers as written. Number(null) is 0, so a null
       bound used to be compared as nought and printed as one. */
    const ok = Array.isArray(rule.range) && rule.range.length === 2 && rule.range.every(scanNumeric);
    if (!ok) return { met: null, untested: true, text: `${L.label}: the range needs two numbers` };
    const [lo, hi] = rule.range.map(Number);
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
      return { met: null, untested: true, needs: Math.max(needs, rneeds), text: R.note ? `${R.label}: ${R.note}` : `${R.label} needs ${rneeds} bars; ${bars.closes.length} held` };
    }
  } else {
    if (!scanNumeric(rule.right?.value)) return { met: null, untested: true, text: `${L.label}: no value to compare against` };
    const v = Number(rule.right.value);
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
/* What a universe names but cannot scan, so the run can say so rather than
   drop it: a named symbol with no series in the history (the example's AAPL
   vanished from "3 named instruments" without a word), and, for a market
   universe, a series with no row in the instrument registry — the worker
   reads only data/instruments.json, so a series fetched from a watchlist
   file has no market until a row is added there. */
function scanUniverseGaps(setup, history, instruments) {
  const have = new Set(Object.keys(history?.series || {}).map(s => String(s).toUpperCase()));
  const u = setup.universe || { kind: 'all' };
  if (u.kind === 'symbols' || u.kind === 'watchlist') {
    const seen = new Set();
    const missing = (u.symbols || []).map(s => String(s)).filter(s => {
      const k = s.toUpperCase();
      if (!k.trim() || seen.has(k)) return false;
      seen.add(k);
      return !have.has(k);
    });
    return { missing, unplaced: [] };
  }
  if (u.kind === 'market') {
    const reg = new Set((instruments || []).map(i => String(i.symbol).toUpperCase()));
    return { missing: [], unplaced: Object.keys(history?.series || {}).filter(s => !reg.has(String(s).toUpperCase())) };
  }
  return { missing: [], unplaced: [] };
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
/* The bars a run was evaluated on, in words — one date when every pair
   shared it, the range when instruments end on different days. The page and
   the worker both print this, so neither names a bar nothing was read on. */
const scanBarRange = (from, to) => !to ? 'no bar' : (!from || from === to) ? to : `${from} … ${to}`;

/* The run. Every enabled, unexpired setup against every instrument in its
   universe, on the last completed bar of each; a match becomes one alert
   record unless the same key already exists or the setup matched this
   instrument within its cooldown. Nothing is sorted by anything but the
   order of the setups and the symbols. */
function scanRun(setups, history, { instruments = [], existing = [], now = null } = {}) {
  /* untestedList carries each untested pair's reason — the count alone told
     a reader "1 untested" and nothing else. stale names series evaluated on a
     bar well behind the newest one the history holds. untestedEverywhere is
     decided here, from the pairs actually evaluated, so the worker cannot
     warn about a setup the run never evaluated (an expired one). */
  const out = { engine: `scan ${SCAN_VERSION}`, alerts: [], evaluated: 0, matched: 0, untested: 0, skipped: [], setups: 0,
                untestedList: [], untestedEverywhere: [], stale: [] };
  const seen = new Set((existing || []).map(a => a.key));
  const lastBar = (sym) => { const d = Object.keys(history?.series?.[sym] || {}).sort(); return d[d.length - 1] || null; };
  /* The newest bar any series holds: the yardstick a lagging series is
     measured against. It is not the bar anything was evaluated on. */
  const newest = Object.keys(history?.series || {}).map(lastBar).filter(Boolean).sort().pop() || null;
  const dayMs = 86400000;
  const staleSeen = new Set();
  const evaluatedBars = [];
  for (const setup of setups || []) {
    if (!setup || setup.enabled === false) continue;
    if (!setup.id) { out.skipped.push({ setup: setup.name || '(unnamed)', why: 'no id' }); continue; }
    if ((setup.timeframe || 'daily') !== 'daily') { out.skipped.push({ setup: setup.id, why: `timeframe “${setup.timeframe}” is not built — daily only` }); continue; }
    out.setups++;
    const symbols = scanUniverse(setup, history, instruments);
    const gaps = scanUniverseGaps(setup, history, instruments);
    if (!symbols.length) { out.skipped.push({ setup: setup.id, why: `no instrument in its universe has a series${gaps.missing.length ? ` (${gaps.missing.join(', ')})` : ''}` }); continue; }
    gaps.missing.forEach(sym => out.skipped.push({ setup: setup.id, symbol: sym, why: 'no series in the price history' }));
    gaps.unplaced.forEach(sym => out.skipped.push({ setup: setup.id, symbol: sym, why: 'not in data/instruments.json, so it has no market to be scanned under' }));
    /* Per setup: pairs that count towards "untested everywhere" (too short,
       or evaluated and untested) against the pairs that were looked at. */
    let looked = 0, blind = 0;
    const reasons = [];
    for (const sym of symbols) {
      const bars = scanBars(history, sym);
      if (bars.closes.length < 2) { out.skipped.push({ setup: setup.id, symbol: sym, why: 'fewer than two bars' }); looked++; blind++; if (!reasons.includes('fewer than two bars')) reasons.push('fewer than two bars'); continue; }
      const bar = bars.dates[bars.dates.length - 1];
      if (setup.expires && bar > setup.expires) { out.skipped.push({ setup: setup.id, symbol: sym, why: `expired ${setup.expires}` }); continue; }
      out.evaluated++;
      looked++;
      evaluatedBars.push(bar);
      if (newest && !staleSeen.has(sym)) {
        const behind = Math.round((Date.parse(newest) - Date.parse(bar)) / dayMs);
        /* Ten calendar days clears a long holiday closure; a series further
           behind than that was not updated, and its "last bar" is old news. */
        if (behind > 10) { staleSeen.add(sym); out.stale.push({ symbol: sym, bar, why: `last bar ${bar} is ${behind} days behind the newest bar in the history (${newest})` }); }
      }
      const r = scanSetup(setup, sym, bars);
      if (r.untested) {
        out.untested++;
        blind++;
        const why = r.rules.filter(x => x.met === null).map(x => x.text).join('; ');
        out.untestedList.push({ setup: setup.id, symbol: sym, why });
        /* The reason without this instrument's bar count, so one line can
           stand for the whole universe. */
        r.rules.filter(x => x.met === null).forEach(x => { const g = x.text.replace(/; \d+ held$/, ''); if (!reasons.includes(g)) reasons.push(g); });
      }
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
        /* Counted as the bars held after the previous alert's bar, not by
           finding that bar: a bar removed from the history (or a history
           rolled back past it) used to lose the cooldown silently. */
        if (prevBar) {
          const since = bars.dates.filter(dd => dd > prevBar).length;
          if (since <= cd) { out.skipped.push({ setup: setup.id, symbol: sym, why: `within the ${cd}-bar cooldown of ${prevBar}` }); continue; }
        }
      }
      const rec = { key, setupId: setup.id, setupName: setup.name || setup.id, symbol: sym, timeframe: 'daily',
                    bar, close: r.close, recordedAt: now || null,
                    rules: r.rules.map(x => ({ text: x.text, met: x.met })), engine: out.engine };
      out.alerts.push(rec);
      seen.add(key);
    }
    /* A setup none of whose instruments could be tested is a configuration
       problem, not a quiet day. Expired pairs are not counted: they were
       never evaluated, and are reported per instrument. */
    if (looked > 0 && blind === looked) out.untestedEverywhere.push({ setup: setup.id, why: reasons.slice(0, 3).join('; ') || 'no rule could be tested' });
  }
  /* The run's as-of is the range of bars actually evaluated — each pair is
     evaluated on its own instrument's last bar. It used to be the newest bar
     in the whole file, so a summary named a date none of the evaluated
     instruments had. */
  const sortedBars = evaluatedBars.sort();
  out.asOf = sortedBars[sortedBars.length - 1] || null;
  out.asOfFrom = sortedBars[0] || null;
  out.newestInHistory = newest;
  return out;
}

/* VALIDATION — the same for the page and the worker. A setups file is
   `{ setups: [...] }` or a bare list. Every setup either passes whole or is
   left out whole, with the reason: a half-valid setup evaluated on the rules
   that parsed would match on fewer conditions than the reader wrote. */
const SCAN_ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
function scanValidate(doc) {
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.setups) ? doc.setups : null;
  const problems = [];
  if (!list) return { setups: [], problems: ['the setups file is neither a list nor an object with a "setups" list'] };
  const ids = new Map();
  list.forEach(s => { const id = s?.id; if (typeof id === 'string' && id) ids.set(id, (ids.get(id) || 0) + 1); });
  const ok = [];
  list.forEach((s, i) => {
    const who = (s && typeof s === 'object' && (s.id || s.name)) || `setup #${i + 1}`;
    const bad = (why) => problems.push(`${who}: ${why}`);
    if (!s || typeof s !== 'object') { bad('is not an object'); return; }
    if (typeof s.id !== 'string' || !s.id) { bad('has no id — ids are part of every alert key'); return; }
    if (/[|\s]/.test(s.id)) { bad('id contains "|" or whitespace'); return; }
    if (ids.get(s.id) > 1) { bad('id is used by more than one setup'); return; }
    if ((s.timeframe || 'daily') !== 'daily') { bad(`timeframe "${s.timeframe}" is not built — daily only`); return; }
    if (s.logic != null && s.logic !== 'AND' && s.logic !== 'OR') { bad(`logic "${s.logic}" is not AND or OR`); return; }
    if (!Array.isArray(s.rules) || !s.rules.length) { bad('has no rules'); return; }
    if (s.expires != null && !(typeof s.expires === 'string' && SCAN_ISO_DAY.test(s.expires))) { bad(`expires "${s.expires}" is not YYYY-MM-DD`); return; }
    if (s.cooldownBars != null && !(scanNumeric(s.cooldownBars) && Number(s.cooldownBars) >= 0)) { bad(`cooldownBars "${s.cooldownBars}" is not a non-negative number`); return; }
    const u = s.universe || { kind: 'all' };
    if (!['all', 'market', 'symbols', 'watchlist'].includes(u.kind)) { bad(`universe kind "${u.kind}" is not all, market, symbols or watchlist`); return; }
    if (u.kind === 'symbols' && (!Array.isArray(u.symbols) || !u.symbols.some(x => typeof x === 'string' && x.trim()))) { bad('universe is "symbols" but names none'); return; }
    /* A watchlist lives in a browser; the worker sees only the snapshot of its
       symbols the page wrote into the setup. Without one there is nothing to scan. */
    if (u.kind === 'watchlist' && (!Array.isArray(u.symbols) || !u.symbols.length)) { bad('universe is a watchlist but carries no symbol snapshot — copy the setup JSON again from /my/scanner'); return; }
    if (u.kind === 'market' && !u.market) { bad('universe is "market" but names none'); return; }
    const sideOk = (side, what) => {
      if (!side || typeof side !== 'object') return `${what} side is missing`;
      if (!SCAN_INDICATORS[side.indicator]) return `${what} indicator "${side.indicator}" is not one of ${Object.keys(SCAN_INDICATORS).join(', ')}`;
      for (const k of ['n', 'fast', 'slow', 'signal']) if (side[k] != null && !(scanNumeric(side[k]) && Number(side[k]) >= 1)) return `${what} ${k === 'n' ? 'period' : k + ' period'} "${side[k]}" is not a number of at least 1`;
      if (side.multiplier != null && !(scanNumeric(side.multiplier) && Number(side.multiplier) > 0)) return `${what} multiplier "${side.multiplier}" is not a positive number`;
      if (side.field != null && !['line', 'signal', 'hist'].includes(side.field)) return `${what} MACD field "${side.field}" is not line, signal or hist`;
      return null;
    };
    for (let r = 0; r < s.rules.length; r++) {
      const rule = s.rules[r];
      const where = `rule ${r + 1}`;
      if (!rule || typeof rule !== 'object') { bad(`${where} is not an object`); return; }
      if (!SCAN_OPERATORS[rule.op]) { bad(`${where}: operator "${rule.op}" is not one of ${Object.keys(SCAN_OPERATORS).join(', ')}`); return; }
      const l = sideOk(rule.left, `${where} left`); if (l) { bad(l); return; }
      if (rule.op === 'between') {
        if (!Array.isArray(rule.range) || rule.range.length !== 2 || !rule.range.every(scanNumeric)) { bad(`${where}: "between" needs a range of two numbers`); return; }
      } else if (rule.right && rule.right.indicator != null) {
        const rr = sideOk(rule.right, `${where} right`); if (rr) { bad(rr); return; }
      } else if (!scanNumeric(rule.right?.value)) {
        bad(`${where}: right side needs an indicator or a numeric value`); return;
      }
    }
    ok.push(s);
  });
  return { setups: ok, problems };
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
/* data/price-history.json exactly as the worker reads it, taken before the
   closes the reader pasted into this browser are merged into trackedHistory.
   The page scanned the merged copy, so "Evaluate now" and "Test" showed
   matches on series the worker cannot see, and on a later bar than it has. */
let scanHistoryFile = null;

/* The builder's draft lives in memory for the session, not in storage: the
   setups file is the record, and a second copy in the browser would be the
   drift this codebase keeps finding in itself. */
let scanDraft = null;
const scanBlankRule = () => ({ left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } });
const scanBlankDraft = () => ({ id: '', name: '', enabled: true, universe: { kind: 'symbols', symbols: [] }, timeframe: 'daily',
  confirmation: 'close', logic: 'AND', cooldownBars: 5, expires: null, rules: [scanBlankRule()] });

/* The engine's own label for each side, so the rule a reader sees is the
   rule that runs — the page used to print SMA20 for a side the engine read
   as SMA1. A missing value prints as '?', never as a number. */
const scanRuleProse = (r) => {
  if (!r || typeof r !== 'object') return '(not a rule)';
  const val = (v) => (scanNumeric(v) ? String(Number(v)) : '?');
  if (r.op === 'between') return `${scanSideLabel(r.left)} between ${val(r.range?.[0])} and ${val(r.range?.[1])}`;
  return `${scanSideLabel(r.left)} ${SCAN_OPERATORS[r.op]?.label || r.op} ${r.right?.indicator ? scanSideLabel(r.right) : val(r.right?.value)}`;
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
    el('li', {}, 'Daily bars only, evaluated on the last bar your history holds. The engine cannot tell whether that bar\u2019s session had closed when it was captured, so run the capture after the close. Intraday needs a licensed feed; backtesting needs point-in-time history. Both are named in the plan as gated, not as missing.'),
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
      el('span', { class: 'chip' }, `${s.logic === 'OR' ? 'any' : 'all'} of ${(s.rules || []).length} rule${(s.rules || []).length === 1 ? '' : 's'}`),
      el('span', { class: 'chip' }, `cooldown ${s.cooldownBars ?? 0} bars`),
      s.expires ? el('span', { class: 'chip' }, `expires ${s.expires}`) : null,
    ]));
    p.append(el('p', { class: 'metaline', style: 'margin-top:4px' }, `Universe: ${scanUniverseProse(s.universe)} · daily bars, the last one your history holds.`));
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
  const lines = [...un, ...sk, ...st];
  if (lines.length) {
    const parts = [un.length ? `untested ${un.length}` : null, sk.length ? `skipped ${sk.length}` : null, st.length ? `behind the rest ${st.length}` : null].filter(Boolean);
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
    grid.append(field('Operator', select(r.op, OPS, v => { r.op = v; if (v === 'between') { r.range = r.range || [50, 70]; delete r.right; } else { delete r.range; if (!r.right) r.right = { indicator: 'ema', n: 50 }; } })));
    if (r.op === 'between') {
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
