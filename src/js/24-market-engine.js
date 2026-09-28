/* ==========================================================================
   MARKET ENGINE — bars, indicators, rules and the scan, in one pure region

   The scanner's engine, moved out of the scanner page so that everything
   which reads a price series reads it through the same code: the scanner
   page, the daily worker (scanner/scan.mjs slices this region out of
   index.html by its markers and runs it in Node), historical testing, and
   the trend context on the company and tracked pages (60-trend.js). It is
   numbered 24 so it loads before 26-instruments, which takes its market
   time zones from SCAN_MARKETS, and before 60-trend, which takes its
   averages from here.

   ONE LIBRARY. Two copies of an indicator drift, and then a match on the
   page and a match in the record disagree about whether a rule held. There
   is one SMA, one EMA, one RSI in this product, and they are these.

   PURE. No DOM, no State, no storage, no clock: every function that needs
   "now" is handed it. The only module-level state is two memo tables (a
   date formatter per time zone, a session lookup per calendar), which
   change no answer.

   WHAT IT DOES NOT KNOW. No exchange calendar is held — a maintained one
   comes with a licensed feed — so sessions are inferred from the reader's
   own history and labelled as inferred. No corporate actions are held, so
   closes are not adjusted. No finality flag comes with a screen capture, so
   a bar is FINAL only when its capture time is recorded and falls after the
   session's close plus a settle margin; a bar with no capture time is
   UNKNOWN, and the record says so.

   THE PRODUCT BOUNDARY, which the scanner page states in full: conditions
   the reader defines, evaluated on price history the reader supplied,
   producing a record of which conditions held on which completed bar. It
   ranks nothing, delivers nothing, and claims nothing about any indicator.
   ========================================================================== */

/* @scan-engine-start — sliced by scanner/scan.mjs; keep this region pure. */
/* 0.3.0: rule trees, the full operator set with a stated tolerance, bar
   status and staleness, the weekly timeframe, versioned setups and the V2
   alert. An alert records the engine that produced it, so a record from
   0.2.0 is read as produced by 0.2.0. */
const SCAN_VERSION = '0.3.0';

/* ---------------------------------------------------------------- numbers -- */
/* ONE READING OF EVERY NUMBER A SETUP CARRIES. A quoted number is the
   number; null, true, '' and anything non-finite are not numbers. */
const scanNumeric = (v) => (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const scanMultiplier = (v) => (scanNumeric(v) && Number(v) > 0 ? Number(v) : 1);

/* --------------------------------------------------------------- hashing -- */
/* FNV-1a, 32 bits, over the UTF-8 bytes, as eight hex digits. It names a
   thing (a setup version, a series as read, an alert key); at this scale a
   collision is not a practical concern, and it is not an integrity hash —
   nothing here is protected by it. */
function scanHash(str) {
  const s = String(str);
  let h = 0x811c9dc5;
  const put = (b) => { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; };
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) put(c);
    else if (c < 0x800) { put(0xc0 | (c >> 6)); put(0x80 | (c & 63)); }
    else if (c < 0x10000) { put(0xe0 | (c >> 12)); put(0x80 | ((c >> 6) & 63)); put(0x80 | (c & 63)); }
    else { put(0xf0 | (c >> 18)); put(0x80 | ((c >> 12) & 63)); put(0x80 | ((c >> 6) & 63)); put(0x80 | (c & 63)); }
  }
  return h.toString(16).padStart(8, '0');
}
/* JSON with its keys sorted at every level, so two objects that say the
   same thing serialise the same way whatever order their keys were typed
   in. Undefined members are dropped, as JSON.stringify drops them. */
function scanStable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(x => (x === undefined ? 'null' : scanStable(x))).join(',')}]`;
  return `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${scanStable(v[k])}`).join(',')}}`;
}

/* ------------------------------------------------------- markets and time -- */
/* Each market's session, in its own time zone. `close` is the end of the
   regular session and `settleMin` the margin after it before a captured bar
   is treated as final (closing auctions and the vendor's settle). `days` are
   the weekdays sessions fall on (0 = Sunday). Markets without a row here —
   26 of the registry's 30 — take _default: weekdays, and a close at the end
   of the UTC day, which is later than every one of their real closes and so
   never calls a bar final early. Half-days and holidays are not held. */
const SCAN_MARKETS = {
  US: { code: 'US', label: 'United States', tz: 'America/New_York', open: '09:30', close: '16:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  MY: { code: 'MY', label: 'Bursa Malaysia', tz: 'Asia/Kuala_Lumpur', open: '09:00', close: '17:00', breaks: [['12:30', '14:30']], days: [1, 2, 3, 4, 5], settleMin: 30 },
  FX: { code: 'FX', label: 'Currency pairs', tz: 'America/New_York', open: null, close: '17:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 0 },
  CRYPTO: { code: 'CRYPTO', label: 'Crypto', tz: 'UTC', open: null, close: '24:00', breaks: [], days: [0, 1, 2, 3, 4, 5, 6], settleMin: 0 },
  _default: { code: '_default', label: 'Other markets', tz: 'UTC', open: null, close: '24:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 0, calendar: 'weekday-only' },
};
const scanMarket = (m) => SCAN_MARKETS[String(m || '').toUpperCase()] || SCAN_MARKETS._default;
const scanHm = (s) => { const [h, m] = String(s || '24:00').split(':').map(Number); return h * 60 + (m || 0); };
const SCAN_ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/* A key is a date only if it names a real day: '2026-02-30' is not one. */
const scanIsDay = (d) => typeof d === 'string' && SCAN_ISO_DAY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
  && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const scanWeekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const scanAddDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const scanDayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const scanMs = (t) => (typeof t === 'number' ? t : Date.parse(t));

/* The wall-clock date and minute in a time zone at an instant. Intl is the
   same in the browser and in Node, so the page and the worker agree on it.
   One formatter per zone: building one is the expensive part. */
const SCAN_DTF = new Map();
function scanTzParts(ms, tz) {
  let f = SCAN_DTF.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    SCAN_DTF.set(tz, f);
  }
  const p = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), seconds: Number(p.second) };
}
/* The instant at which a wall-clock time on a date occurs in a zone. The
   offset is found by asking the zone what it calls a guess and correcting;
   a second pass settles it across a daylight-saving change. */
function scanZonedInstant(date, minutes, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d) + minutes * 60000;
  let guess = target;
  for (let k = 0; k < 3; k++) {
    const p = scanTzParts(guess, tz);
    const [py, pm, pd] = p.date.split('-').map(Number);
    const seen = Date.UTC(py, pm - 1, pd) + p.minutes * 60000 + p.seconds * 1000;
    const next = target - (seen - guess);
    if (next === guess) break;
    guess = next;
  }
  return guess;
}
/* When a session's bar may be treated as final: its close plus the settle
   margin, in the market's zone. */
const scanSessionEnd = (market, date) => { const M = scanMarket(market); return scanZonedInstant(date, scanHm(M.close) + (M.settleMin || 0), M.tz); };
/* The market's own calendar date at an instant. */
const scanLocalDate = (market, instant) => scanTzParts(scanMs(instant), scanMarket(market).tz).date;

/* The last session whose close plus settle had passed at `instant`, on the
   market's weekdays (and, when a calendar is given, on its sessions). */
function scanSessionDateAt(market, instant, calendar = null) {
  const ms = scanMs(instant);
  if (!Number.isFinite(ms)) return null;
  const M = scanMarket(market);
  let d = scanTzParts(ms, M.tz).date;
  for (let k = 0; k < 40; k++) {
    const isSession = calendar ? scanIsSession(calendar, d) : M.days.includes(scanWeekday(d));
    if (isSession && scanSessionEnd(market, d) <= ms) return d;
    d = scanAddDays(d, -1);
  }
  return null;
}
/* A bar is FINAL when it was captured at or after its session's close plus
   settle, PROVISIONAL when captured before (an in-progress bar written as
   though it were the day's), UNKNOWN when no capture time is recorded —
   which is every bar the history held before schema 2. */
function scanBarStatus(market, sessionDate, capturedAt) {
  const at = capturedAt == null ? NaN : scanMs(capturedAt);
  if (!Number.isFinite(at) || !scanIsDay(sessionDate)) return 'UNKNOWN';
  return at >= scanSessionEnd(market, sessionDate) ? 'FINAL' : 'PROVISIONAL';
}

/* ------------------------------------------------------------- timeframes -- */
const SCAN_INTRADAY_WHY = 'intraday data is not held — your history carries one bar per session, and intraday bars need a licensed feed (SC-317)';
const SCAN_TIMEFRAMES = {
  '1D': { id: '1D', label: 'Daily', built: true, legacy: 'daily', note: 'one bar per session, dated by the exchange session in its own time zone' },
  '1W': { id: '1W', label: 'Weekly', built: true, legacy: 'weekly', derivedFrom: '1D',
          note: 'derived from your daily bars: the first open, the highest high, the lowest low, the last close and the summed volume of the week; a week is complete once its last expected session is held and final' },
  '1H': { id: '1H', label: '1 hour', built: false, reason: SCAN_INTRADAY_WHY },
  '15M': { id: '15M', label: '15 minutes', built: false, reason: SCAN_INTRADAY_WHY },
  '5M': { id: '5M', label: '5 minutes', built: false, reason: SCAN_INTRADAY_WHY },
};
/* 'daily' and 'weekly' are the 0.2 names; absent is daily, as it was. */
function scanTimeframe(tf) {
  if (tf == null || tf === '') return '1D';
  const t = String(tf).trim();
  const k = { daily: '1D', '1d': '1D', weekly: '1W', '1w': '1W', '1h': '1H', hourly: '1H', '15m': '15M', '5m': '5M' }[t.toLowerCase()];
  return k || t;
}

/* ------------------------------------------------------------------ limits -- */
/* How big a setup may be. A rule tree deeper than three groups or wider
   than twenty conditions is not a setup anyone can read back, and a period
   past 520 bars (ten years of weeks, two of sessions) is past what the
   history keeps. */
const SCAN_LIMITS = { maxDepth: 3, maxConditions: 20, maxPeriod: 520, maxSetups: 200 };

/* THE FLOAT RULE. 0.1 + 0.2 is not 0.3 in binary, and a rule that says
   "equals 0.3" means the decimal. Two values are equal when they differ by
   no more than a billionth of the larger (never less than 1e-12); a strict
   comparison needs more than that margin. */
const SCAN_TOLERANCE = { relative: 1e-9, absolute: 1e-12,
  text: 'Two values are equal when they differ by no more than one billionth of the larger (and never by less than 1e-12). So 0.1 + 0.2 equals 0.3, and "above" means above by more than that margin.' };
const scanTol = (l, r) => Math.max(SCAN_TOLERANCE.absolute, SCAN_TOLERANCE.relative * Math.max(Math.abs(l), Math.abs(r)));

/* ------------------------------------------------------------------- units -- */
/* What an indicator's number measures, and so what it may be compared
   with. RSI against volume is a comparison of two unrelated scales; it
   used to validate. `literal` is the domain a fixed value must fall in. */
const SCAN_UNITS = {
  price:       { label: 'price',               literal: (v) => v > 0,             domain: 'a price above 0' },
  price_delta: { label: 'price difference',    literal: () => true,               domain: 'any number' },
  volume:      { label: 'volume',              literal: (v) => v >= 0,            domain: 'a volume of 0 or more' },
  osc_0_100:   { label: 'oscillator (0–100)',  literal: (v) => v >= 0 && v <= 100, domain: 'a number from 0 to 100' },
  percent:     { label: 'percent',             literal: () => true,               domain: 'any number' },
  ratio:       { label: 'ratio',               literal: (v) => v > 0,             domain: 'a ratio above 0' },
  position:    { label: 'position in the band', literal: () => true,              domain: 'any number (0 is the lower band, 1 the upper)' },
};

/* -------------------------------------------------------------- indicators -- */
/* Every indicator the engine computes, with what it reads, what it
   measures, how many bars it needs before it says anything, and the formula
   in words. A 50-bar average from 22 bars is a different number wearing its
   name, so below `needs` the answer is INSUFFICIENT_DATA, never a value.
   calcVersion changes whenever a formula's output can change, so a record
   says which arithmetic produced it. */
const scanNP = (def, max = SCAN_LIMITS.maxPeriod) => ({ def, min: 1, max, integer: true });
const SCAN_INDICATORS = {
  price: { label: 'price', params: {}, inputs: ['close'], unit: 'price', calcVersion: 1,
    needs: () => 1, formula: 'the close of the bar' },
  volume: { label: 'volume', params: {}, inputs: ['volume'], unit: 'volume', calcVersion: 1,
    needs: () => 1, formula: 'the volume of the bar; an unrecorded volume is not a volume of nought' },
  sma: { label: 'SMA', params: { n: scanNP(20) }, inputs: ['close'], unit: 'price', calcVersion: 1,
    needs: (p) => p.n, formula: 'the arithmetic mean of the last n closes' },
  ema: { label: 'EMA', params: { n: scanNP(20) }, inputs: ['close'], unit: 'price', calcVersion: 1,
    needs: (p) => p.n, formula: 'seeded with the mean of the first n closes at bar n, then e = close × k + e × (1 − k), with k = 2 / (n + 1)' },
  rsi: { label: 'RSI', params: { n: scanNP(14) }, inputs: ['close'], unit: 'osc_0_100', calcVersion: 2,
    needs: (p) => p.n + 1,
    formula: "Wilder's: the mean gain and mean loss of the first n changes, then each smoothed as (previous × (n − 1) + today) / n; RSI = 100 − 100 / (1 + gain / loss). With no loss it is 100; with neither gain nor loss (a flat window) it is undefined" },
  macd: { label: 'MACD', params: { fast: scanNP(12), slow: scanNP(26), signal: scanNP(9) }, inputs: ['close'], calcVersion: 1,
    fields: { line: 'price_delta', signal: 'price_delta', hist: 'price_delta' }, defaultField: 'line',
    needs: (p, f) => (f === 'signal' || f === 'hist' ? p.slow + p.signal - 1 : p.slow),
    formula: 'line = EMA(fast) − EMA(slow); signal = an EMA of the line from its first value, seeded with the mean of its first `signal` values; histogram = line − signal' },
  volume_avg: { label: 'average volume', params: { n: scanNP(20) }, inputs: ['volume'], unit: 'volume', calcVersion: 1,
    needs: (p) => p.n, formula: 'the arithmetic mean of the last n volumes, the current bar included' },
  bb: { label: 'Bollinger', params: { n: scanNP(20), k: { def: 2, min: 0.1, max: 10, integer: false } }, inputs: ['close'], calcVersion: 1,
    fields: { upper: 'price', middle: 'price', lower: 'price', width: 'ratio', pctb: 'position' }, defaultField: 'middle',
    needs: (p) => p.n,
    formula: "middle = the mean of the last n closes; σ = their POPULATION standard deviation (Bollinger's definition — a platform using the sample deviation draws wider bands); upper and lower = middle ± k × σ; width = (upper − lower) / middle; %b = (close − lower) / (upper − lower), undefined when σ is 0" },
  atr: { label: 'ATR', params: { n: scanNP(14) }, inputs: ['high', 'low', 'close'], unit: 'price_delta', calcVersion: 1,
    needs: (p) => p.n + 1,
    formula: "Wilder's: true range = the largest of high − low, |high − previous close| and |low − previous close|; the first ATR is the mean of the first n true ranges, then (previous × (n − 1) + TR) / n. Needs highs and lows; never estimated from closes" },
  high_n: { label: 'high', params: { n: scanNP(252) }, inputs: ['high'], unit: 'price', calcVersion: 1,
    needs: (p) => p.n, formula: 'the highest high of the last n bars (252 sessions is the 52-week high); needs highs' },
  low_n: { label: 'low', params: { n: scanNP(252) }, inputs: ['low'], unit: 'price', calcVersion: 1,
    needs: (p) => p.n, formula: 'the lowest low of the last n bars; needs lows' },
  close_high_n: { label: 'highest close', params: { n: scanNP(252) }, inputs: ['close'], unit: 'price', calcVersion: 1,
    needs: (p) => p.n, formula: 'the highest CLOSE of the last n bars — a closing high, not the high of the range' },
  close_low_n: { label: 'lowest close', params: { n: scanNP(252) }, inputs: ['close'], unit: 'price', calcVersion: 1,
    needs: (p) => p.n, formula: 'the lowest CLOSE of the last n bars — a closing low, not the low of the range' },
  change: { label: 'change', params: { n: scanNP(1) }, inputs: ['close'], unit: 'percent', calcVersion: 1,
    needs: (p) => p.n + 1, formula: '(close ÷ the close n bars earlier − 1) × 100' },
  rvol: { label: 'relative volume', params: { n: scanNP(20) }, inputs: ['volume'], unit: 'ratio', calcVersion: 1,
    needs: (p) => p.n + 1,
    formula: "the bar's volume ÷ the mean volume of the n bars BEFORE it — the current bar is left out of its own reference" },
};
/* The default n of every indicator that has one — the builder's
   placeholders read this. */
const SCAN_DEFAULT_N = Object.fromEntries(Object.entries(SCAN_INDICATORS).filter(([, d]) => d.params.n).map(([k, d]) => [k, d.params.n.def]));

/* An operand's parameters as the engine reads them: every declared
   parameter present (its default when absent), each a number within its
   bounds. Anything else is a problem with a reason, and the indicator is
   INVALID_INPUT BAD_PARAMS rather than computed on a guess. */
function scanParams(spec) {
  const def = SCAN_INDICATORS[spec?.indicator];
  if (!def) return { params: {}, problems: [] };
  const params = {}, problems = [];
  for (const [k, p] of Object.entries(def.params)) {
    const v = spec[k];
    if (v == null) { params[k] = p.def; continue; }
    if (!scanNumeric(v)) { problems.push(`${k === 'n' ? 'period' : k} "${v}" is not a number`); params[k] = p.def; continue; }
    let x = Number(v);
    if (p.integer) x = Math.round(x);
    if (x < p.min || x > p.max) { problems.push(`${k === 'n' ? 'period' : k} ${x} is outside ${p.min}–${p.max}`); params[k] = p.def; continue; }
    params[k] = x;
  }
  if (spec.indicator === 'macd' && !problems.length && params.fast >= params.slow) problems.push(`the fast period (${params.fast}) must be shorter than the slow (${params.slow})`);
  return { params, problems };
}
const scanFieldOf = (spec) => { const def = SCAN_INDICATORS[spec?.indicator]; return def?.fields ? (spec.field == null ? def.defaultField : spec.field) : null; };
/* The unit of an operand: the indicator's, or its field's. */
function scanUnitOf(spec) {
  const def = SCAN_INDICATORS[spec?.indicator];
  if (!def) return null;
  return def.fields ? (def.fields[scanFieldOf(spec)] || null) : def.unit;
}
/* 0.2 compatibility: the period a side is read with. */
const scanPeriodOf = (s) => scanParams(s).params.n ?? SCAN_DEFAULT_N[s?.indicator] ?? 20;

/* The canonical name of an operand, e.g. 'ema(n=50)',
   'macd(fast=12,slow=26,signal=9).hist', 'volume_avg(n=20)*1.5'. Defaults
   are filled, parameters are in their declared order, and the multiplier
   comes last because it is applied after the cache: the cached series is
   the unscaled one. */
function scanSpecKey(spec, { multiplier = true } = {}) {
  const id = spec?.indicator;
  const def = SCAN_INDICATORS[id];
  if (!def) return `${id}(?)`;
  const { params } = scanParams(spec);
  const ps = Object.keys(def.params).map(k => `${k}=${params[k]}`).join(',');
  const f = scanFieldOf(spec);
  const m = scanMultiplier(spec.multiplier);
  return `${id}(${ps})${f ? `.${f}` : ''}${multiplier && m !== 1 ? `*${m}` : ''}`;
}

/* How a side reads in words — the page's list, the builder and the alert
   text all use this, so the rule a reader sees is the rule that ran. */
function scanSideLabel(s) {
  const id = s?.indicator, def = SCAN_INDICATORS[id];
  if (!def) return id ? `unknown indicator “${id}”` : '—';
  const p = scanParams(s).params;
  let base;
  switch (id) {
    case 'volume_avg': base = `${p.n}-bar average volume`; break;
    case 'sma': case 'ema': case 'rsi': case 'atr': base = `${def.label}${p.n}`; break;
    case 'macd': {
      const f = scanFieldOf(s);
      base = `MACD${p.fast === 12 && p.slow === 26 && p.signal === 9 ? '' : `(${p.fast},${p.slow},${p.signal})`} ${['line', 'signal', 'hist'].includes(f) ? f : f || 'line'}`;
      break;
    }
    case 'bb': { const f = scanFieldOf(s); base = `Bollinger(${p.n},${p.k}) ${f === 'pctb' ? '%b' : f}`; break; }
    case 'high_n': base = p.n === 252 ? '52-week high' : `${p.n}-bar high`; break;
    case 'low_n': base = p.n === 252 ? '52-week low' : `${p.n}-bar low`; break;
    case 'close_high_n': base = p.n === 252 ? '52-week closing high' : `${p.n}-bar closing high`; break;
    case 'close_low_n': base = p.n === 252 ? '52-week closing low' : `${p.n}-bar closing low`; break;
    case 'change': base = `${p.n}-bar change %`; break;
    case 'rvol': base = `relative volume (${p.n}-bar)`; break;
    default: base = def.label;
  }
  const m = scanMultiplier(s.multiplier);
  return m === 1 ? base : `${m}× ${base}`;
}

/* --------------------------------------------------------------- operators -- */
/* The specification's names. The 0.2 names are read as aliases, so every
   setup written before this version still means what it meant. */
const SCAN_OPERATORS = {
  GREATER_THAN:          { label: 'above',         symbol: '>',  needsPrev: false, arity: 'binary' },
  LESS_THAN:             { label: 'below',         symbol: '<',  needsPrev: false, arity: 'binary' },
  GREATER_THAN_OR_EQUAL: { label: 'at or above',   symbol: '≥',  needsPrev: false, arity: 'binary' },
  LESS_THAN_OR_EQUAL:    { label: 'at or below',   symbol: '≤',  needsPrev: false, arity: 'binary' },
  /* Equality is allowed against a fixed value, or between two prices or two
     volumes. Exact equality of two oscillators or ratios is noise; BETWEEN
     says what such a rule means. */
  EQUALS:                { label: 'equals',        symbol: '=',  needsPrev: false, arity: 'binary', equatableUnits: ['price', 'volume'] },
  CROSSES_ABOVE:         { label: 'crosses above', symbol: '↗', needsPrev: true,  arity: 'binary' },
  CROSSES_BELOW:         { label: 'crosses below', symbol: '↘', needsPrev: true,  arity: 'binary' },
  BETWEEN:               { label: 'between',       symbol: '∈',  needsPrev: false, arity: 'range' },
};
const SCAN_OP_ALIASES = { above: 'GREATER_THAN', below: 'LESS_THAN', crosses_above: 'CROSSES_ABOVE', crosses_below: 'CROSSES_BELOW', between: 'BETWEEN' };
const scanOpName = (op) => (SCAN_OPERATORS[op] ? op : SCAN_OP_ALIASES[op] || null);

/* Every comparison goes through here, with the stated tolerance. The
   crossings compare the previous completed bar with the current one: from
   at-or-below to above is a cross up; staying above is not. */
function scanCompare(op, l, r, { lp = null, rp = null, lo = null, hi = null } = {}) {
  switch (scanOpName(op)) {
    case 'GREATER_THAN': return l > r + scanTol(l, r);
    case 'LESS_THAN': return l < r - scanTol(l, r);
    case 'GREATER_THAN_OR_EQUAL': return l >= r - scanTol(l, r);
    case 'LESS_THAN_OR_EQUAL': return l <= r + scanTol(l, r);
    case 'EQUALS': return Math.abs(l - r) <= scanTol(l, r);
    case 'CROSSES_ABOVE': return lp <= rp + scanTol(lp, rp) && l > r + scanTol(l, r);
    case 'CROSSES_BELOW': return lp >= rp - scanTol(lp, rp) && l < r - scanTol(l, r);
    case 'BETWEEN': { const a = Math.min(lo, hi), b = Math.max(lo, hi); return l >= a - scanTol(l, a) && l <= b + scanTol(l, b); }
    default: return null;
  }
}

/* ------------------------------------------------------------------ series -- */
/* Series helpers. Each returns an array the length of its input with null
   wherever the window is not yet full — alignment is what makes "the bar
   before" a defined thing. A window containing an unrecorded value has no
   value: a missing volume is not a volume of nought. Windows are summed
   afresh, left to right, rather than by a running total, so a value never
   carries rounding from bars outside its window and equals the same sum
   written out by hand. */
const scanOk = (v) => v != null && Number.isFinite(v);
function scanSma(a, n) {
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let s = 0, ok = true;
    for (let j = i - n + 1; j <= i; j++) { if (!scanOk(a[j])) { ok = false; break; } s += a[j]; }
    if (ok) out[i] = s / n;
  }
  return out;
}
/* Seeded with the mean of the first n values, then smoothed. An
   unrecorded value ends the run: the next value is seeded afresh from n
   recorded ones, never averaged in as 0. */
function scanEma(a, n) {
  const out = new Array(a.length).fill(null);
  const k = 2 / (n + 1);
  let e = null, run = 0, seed = 0;
  for (let i = 0; i < a.length; i++) {
    if (!scanOk(a[i])) { e = null; run = 0; seed = 0; continue; }
    if (e == null) {
      run++; seed += a[i];
      if (run === n) { e = seed / n; out[i] = e; }
      continue;
    }
    e = a[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
/* Wilder's RSI. `zd` (optional) receives the indices where it is undefined:
   a window with neither a gain nor a loss. 0.2 called that 100. */
function scanRsi(a, n, zd = null) {
  const out = new Array(a.length).fill(null);
  if (a.length < n + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  const put = (i) => {
    if (loss === 0 && gain === 0) { out[i] = null; if (zd) zd.push(i); }
    else out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  };
  put(n);
  for (let i = n + 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    put(i);
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
/* Bollinger bands with the population deviation of the same window. */
function scanBb(a, n, k) {
  const len = a.length, mid = scanSma(a, n);
  const upper = new Array(len).fill(null), lower = new Array(len).fill(null), width = new Array(len).fill(null), pctb = new Array(len).fill(null), zd = [];
  for (let i = 0; i < len; i++) {
    const m = mid[i];
    if (m == null) continue;
    let ss = 0;
    for (let j = i - n + 1; j <= i; j++) ss += (a[j] - m) * (a[j] - m);
    const sd = Math.sqrt(ss / n);
    upper[i] = m + k * sd; lower[i] = m - k * sd;
    width[i] = (upper[i] - lower[i]) / m;
    if (sd === 0) zd.push(i); else pctb[i] = (a[i] - lower[i]) / (upper[i] - lower[i]);
  }
  return { upper, middle: mid, lower, width, pctb, zd };
}
/* Wilder's ATR from highs, lows and closes. A bar without a high or a low
   has no true range, and the average starts again after it. */
function scanAtr(high, low, close, n) {
  const len = close.length, out = new Array(len).fill(null);
  let atr = null, run = 0, seed = 0;
  for (let t = 1; t < len; t++) {
    const h = high[t], l = low[t], pc = close[t - 1];
    if (!scanOk(h) || !scanOk(l) || !scanOk(pc)) { atr = null; run = 0; seed = 0; continue; }
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    if (atr == null) {
      run++; seed += tr;
      if (run === n) { atr = seed / n; out[t] = atr; }
      continue;
    }
    atr = (atr * (n - 1) + tr) / n;
    out[t] = atr;
  }
  return out;
}
function scanRollExtreme(a, n, pick) {
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let x = null, ok = true;
    for (let j = i - n + 1; j <= i; j++) { if (!scanOk(a[j])) { ok = false; break; } x = x == null ? a[j] : pick(x, a[j]); }
    if (ok) out[i] = x;
  }
  return out;
}
function scanChange(a, n) {
  const out = new Array(a.length).fill(null);
  for (let i = n; i < a.length; i++) if (scanOk(a[i]) && scanOk(a[i - n]) && a[i - n] > 0) out[i] = (a[i] / a[i - n] - 1) * 100;
  return out;
}
/* Relative volume: the bar against the mean of the n bars before it. */
function scanRvol(v, n, zd = null) {
  const out = new Array(v.length).fill(null);
  for (let i = n; i < v.length; i++) {
    if (!scanOk(v[i])) continue;
    let s = 0, ok = true;
    for (let j = i - n; j < i; j++) { if (!scanOk(v[j])) { ok = false; break; } s += v[j]; }
    if (!ok) continue;
    const m = s / n;
    if (m === 0) { if (zd) zd.push(i); continue; }
    out[i] = v[i] / m;
  }
  return out;
}

/* ---------------------------------------------------------------- bar checks -- */
/* One validation of a bar for the page, the worker and the ingest. Each
   code names one thing wrong; a bar with any code is not evaluated, and is
   listed rather than silently dropped. `today` is the market's own date at
   `now`, when a clock was given. */
function scanValidateBar(bar, { market = null, now = null, today = null } = {}) {
  const codes = [];
  const d = bar?.date;
  if (!scanIsDay(d)) return ['BAD_DATE'];
  const day = today || (now != null && Number.isFinite(scanMs(now)) ? scanLocalDate(market, now) : null);
  if (day && d > day) codes.push('FUTURE');
  const prices = ['open', 'high', 'low', 'close'].map(k => bar[k]);
  if (!(Number.isFinite(bar.close) && bar.close > 0) || prices.some(p => p != null && !(Number.isFinite(p) && p > 0))) codes.push('NEG_PRICE');
  if (bar.volume != null && !(Number.isFinite(bar.volume) && bar.volume >= 0)) codes.push('NEG_VOLUME');
  const has = (v) => Number.isFinite(v) && v > 0;
  const { open: o, high: h, low: l, close: c } = bar;
  if (has(h) && [o, c, l].some(v => has(v) && h < v)) codes.push('HIGH_BELOW');
  if (has(l) && [o, c, h].some(v => has(v) && l > v)) codes.push('LOW_ABOVE');
  if (!scanMarket(market).days.includes(scanWeekday(d))) codes.push('NON_SESSION_DAY');
  return codes;
}

/* --------------------------------------------------------------- calendars -- */
/* No exchange calendar is held. What can be said honestly is what the
   reader's own history shows: a weekday on which most of a market's series
   hold a bar was a session; a weekday on which none does was a holiday (or
   a day nothing was captured — the two cannot be told apart); anything in
   between is ambiguous. That needs enough series to mean anything: below
   five, the market's weekdays are the calendar, and a gap of up to two
   weekdays is read as a possible holiday rather than a missing session. */
const SCAN_CAL_SETS = new WeakMap();
function scanWeekdayCalendar(market) {
  const M = scanMarket(market);
  return { market: market || null, basis: 'weekday', days: M.days.slice(), tolerance: 2, series: 0, sessions: null, inferredHolidays: [], ambiguous: [], from: null, to: null,
           text: 'weekdays — no exchange calendar is held and too few of your series are in this market to infer one; a gap of up to two weekdays is read as a possible holiday' };
}
function scanRegistry(instruments) {
  const m = new Map();
  (instruments || []).forEach(i => { if (i?.symbol != null) m.set(String(i.symbol).toUpperCase(), i); });
  return m;
}
/* The market a history symbol belongs to, from the registry the worker
   reads — null when it has no row. */
const scanMarketOf = (symbol, instruments, reg = null) => ((reg || scanRegistry(instruments)).get(String(symbol).toUpperCase())?.market || null);

function scanCalendar(history, instruments, market, { quorum = 0.6, minSeries = 5 } = {}) {
  const reg = scanRegistry(instruments);
  const M = scanMarket(market);
  const want = market ? String(market).toUpperCase() : null;
  const syms = Object.keys(history?.series || {}).filter(s => {
    const m = reg.get(String(s).toUpperCase())?.market || null;
    return want ? String(m || '').toUpperCase() === want : m == null;
  });
  if (syms.length < minSeries) return { ...scanWeekdayCalendar(market), series: syms.length };
  const held = syms.map(s => {
    const ser = history.series[s] || {};
    const ds = Object.keys(ser).filter(d => scanIsDay(d) && Number.isFinite(ser[d]) && ser[d] > 0 && M.days.includes(scanWeekday(d))).sort();
    return { set: new Set(ds), first: ds[0], last: ds[ds.length - 1] };
  }).filter(x => x.first);
  if (held.length < minSeries) return { ...scanWeekdayCalendar(market), series: held.length };
  const from = held.map(x => x.first).sort()[0], to = held.map(x => x.last).sort().pop();
  const sessions = [], inferredHolidays = [], ambiguous = [];
  for (let d = from, k = 0; d <= to && k < 20000; d = scanAddDays(d, 1), k++) {
    if (!M.days.includes(scanWeekday(d))) continue;
    const active = held.filter(x => x.first <= d && x.last >= d);
    if (!active.length) continue;
    const n = active.filter(x => x.set.has(d)).length;
    if (n === 0) inferredHolidays.push(d);
    else if (n / active.length >= quorum) sessions.push(d);
    else ambiguous.push(d);
  }
  return { market: market || null, basis: 'inferred', days: M.days.slice(), tolerance: 0, series: held.length, quorum, from, to, sessions, inferredHolidays, ambiguous,
           text: `inferred from your history — not an exchange calendar: a weekday on which at least ${Math.round(quorum * 100)}% of your ${held.length} series in this market hold a bar is a session, one on which none does is read as a holiday` };
}
/* Whether a date is a session of a calendar. Outside the dates an inferred
   calendar covers, its weekdays are assumed; an ambiguous day is not a
   session, so a series that lacks it has no gap there. */
function scanIsSession(cal, d) {
  if (!cal) return true;
  if (!cal.days.includes(scanWeekday(d))) return false;
  if (cal.basis !== 'inferred' || !cal.sessions || d < cal.from || d > cal.to) return true;
  let set = SCAN_CAL_SETS.get(cal);
  if (!set) { set = new Set(cal.sessions); SCAN_CAL_SETS.set(cal, set); }
  return set.has(d);
}
/* Sessions strictly between two dates. */
function scanSessionsBetween(cal, a, b) {
  if (!a || !b || b <= a) return 0;
  let n = 0;
  for (let d = scanAddDays(a, 1), k = 0; d < b && k < 4000; d = scanAddDays(d, 1), k++) if (scanIsSession(cal, d)) n++;
  return n;
}
/* The last session that should be final by `now`. */
function scanExpectedLastSession(cal, market, now) {
  if (now == null || !Number.isFinite(scanMs(now))) return null;
  return scanSessionDateAt(market, now, cal);
}

/* -------------------------------------------------------------------- bars -- */
/* The name of a series as it was read: every bar's date, open, high, low,
   close, volume and status, hashed. The cache keys on it, an alert records
   it, and a corrected close anywhere up to the bar changes it. Computed at
   run time because the history file is git-ignored and the build does not
   hash it. */
function scanDataVersion(bars, upto = null) {
  const n = bars?.dates?.length || 0;
  const last = upto == null ? n - 1 : Math.min(upto, n - 1);
  const f = (v) => (v == null ? '' : String(v));
  const lines = [];
  for (let i = 0; i <= last; i++) {
    lines.push(`${bars.dates[i]}|${f(bars.open?.[i])}|${f(bars.high?.[i])}|${f(bars.low?.[i])}|${f(bars.closes[i])}|${f(bars.volumes?.[i])}|${bars.status?.[i] || 'UNKNOWN'}`);
  }
  return `fnv1a:${scanHash(lines.join('\n'))}`;
}

/* An instrument's bars from the history file. Schema 1 holds
   { series: {SYM: {date: close}}, volume: {SYM: {date: v}} }; schema 2 adds,
   each optional, ohlc {SYM: {date: [open, high, low]}}, meta {SYM: {date:
   {src, at}}} and corrections {SYM: [{date, …}]} — read additively, so a
   close-only history reads exactly as before. Every bar is validated; a bad
   one is listed in `invalid` with its codes and left out, never silently
   dropped and never made the last bar. With a clock, each bar gets a status
   and the series is marked stale when its last final bar is older than the
   session that should be held by now. */
function scanBars(history, symbol, { timeframe = '1D', market = undefined, instruments = null, now = null, calendar = null, staleTolerance = 0 } = {}) {
  const mk = market !== undefined ? market : (instruments ? scanMarketOf(symbol, instruments) : null);
  const s = history?.series?.[symbol] || {}, v = history?.volume?.[symbol] || {};
  const o = history?.ohlc?.[symbol] || {}, meta = history?.meta?.[symbol] || {};
  const corrected = new Set((Array.isArray(history?.corrections?.[symbol]) ? history.corrections[symbol] : []).map(c => c?.date).filter(Boolean));
  const clock = now != null && Number.isFinite(scanMs(now));
  const today = clock ? scanLocalDate(mk, now) : null;
  const cal = calendar || scanWeekdayCalendar(mk);
  const b = { symbol, market: mk, instrumentId: mk ? `${String(mk).toUpperCase()}:${String(symbol).toUpperCase()}` : null, timeframe: '1D',
              dates: [], closes: [], volumes: [], open: [], high: [], low: [], status: [], source: [], capturedAt: [],
              invalid: [], gapBefore: [], hasOHLC: false, gapTolerance: cal.tolerance ?? 0,
              calendar: { basis: cal.basis, text: cal.text }, stale: null, dataVersion: null };
  for (const d of Object.keys(s).sort()) {
    const row = Array.isArray(o[d]) ? o[d] : null;
    const px = (x) => (x == null ? null : typeof x === 'number' ? x : NaN);
    const bar = { date: d, open: row ? px(row[0]) : null, high: row ? px(row[1]) : null, low: row ? px(row[2]) : null,
                  close: typeof s[d] === 'number' ? s[d] : NaN, volume: v[d] == null ? null : typeof v[d] === 'number' ? v[d] : NaN };
    const codes = scanValidateBar(bar, { market: mk, today });
    if (codes.length) { b.invalid.push({ date: d, codes }); continue; }
    b.dates.push(d); b.closes.push(bar.close); b.volumes.push(bar.volume);
    b.open.push(bar.open); b.high.push(bar.high); b.low.push(bar.low);
    if (scanOk(bar.high) && scanOk(bar.low)) b.hasOHLC = true;
    const m = meta[d] && typeof meta[d] === 'object' ? meta[d] : {};
    b.status.push(corrected.has(d) || m.status === 'CORRECTED' ? 'CORRECTED' : scanBarStatus(mk, d, m.at));
    b.source.push(m.src ?? null); b.capturedAt.push(m.at ?? null);
  }
  for (let i = 0; i < b.dates.length; i++) b.gapBefore.push(i === 0 ? 0 : scanSessionsBetween(cal, b.dates[i - 1], b.dates[i]));
  if (clock && b.dates.length) {
    let at = b.dates.length - 1;
    while (at >= 0 && b.status[at] === 'PROVISIONAL') at--;
    const expected = scanExpectedLastSession(cal, mk, now);
    if (at >= 0 && expected && b.dates[at] < expected) {
      const behind = scanSessionsBetween(cal, b.dates[at], expected) + 1;
      if (behind > staleTolerance) b.stale = { at, last: b.dates[at], expected, sessionsBehind: behind };
    }
  }
  b.dataVersion = scanDataVersion(b);
  return scanTimeframe(timeframe) === '1W' ? scanResample(b, '1W', { calendar: cal, now }) : b;
}
/* Bars from a bare list of closes (and, optionally, volumes, highs and
   lows) with no dates checked and no calendar: the trend context's input,
   which reads a series the page already holds. Nothing is cached on it. */
function scanSeriesBars(closes, { dates = null, volumes = null, open = null, high = null, low = null } = {}) {
  const n = closes.length, nil = () => new Array(n).fill(null);
  const hi = high || nil(), lo = low || nil();
  return { symbol: null, market: null, instrumentId: null, timeframe: '1D', dates: dates || closes.map((_, i) => String(i)), closes,
           volumes: volumes || nil(), open: open || nil(), high: hi, low: lo, status: new Array(n).fill('UNKNOWN'),
           source: nil(), capturedAt: nil(), invalid: [], gapBefore: new Array(n).fill(0),
           hasOHLC: hi.some(scanOk) && lo.some(scanOk), gapTolerance: 0, calendar: null, stale: null, dataVersion: null };
}
/* The first n bars, as though the history ended there — what historical
   testing's no-look-ahead check compares against. */
function scanSliceBars(bars, n) {
  const cut = (a) => (Array.isArray(a) ? a.slice(0, n) : a);
  const out = { ...bars };
  ['dates', 'closes', 'volumes', 'open', 'high', 'low', 'status', 'source', 'capturedAt', 'gapBefore', 'complete', 'missingDays'].forEach(k => { if (k in bars) out[k] = cut(bars[k]); });
  out.stale = null;
  out.dataVersion = scanDataVersion(out);
  return out;
}

/* WEEKLY BARS FROM DAILY ONES. A week is its ISO week (Monday first), and
   the dates are already session dates in the market's own zone, so no time
   zone arithmetic is needed. Open is the first session's, high the highest,
   low the lowest, close the last; volume is the sum only when every
   expected session of the week is held with a volume — a missing day is not
   a day of nought. The weekly bar is dated by its last held session.
   A week is COMPLETE when a later week is held, or when its last expected
   session (by the calendar) is held. An incomplete week is PROVISIONAL, so
   a week in progress never confirms a match; when a Friday is a holiday
   the week closes on the Thursday. gapBefore counts whole weeks with
   sessions that no bar covers. */
const scanWeekOf = (d) => scanAddDays(d, -((scanWeekday(d) + 6) % 7));
function scanResample(bars, tf = '1W', { calendar = null, now = null } = {}) {
  if (scanTimeframe(tf) !== '1W') return bars;
  const cal = calendar || scanWeekdayCalendar(bars.market);
  const groups = [];
  bars.dates.forEach((d, i) => { const wk = scanWeekOf(d); const g = groups[groups.length - 1]; if (g && g.wk === wk) g.idx.push(i); else groups.push({ wk, idx: [i] }); });
  const w = { symbol: bars.symbol, market: bars.market, instrumentId: bars.instrumentId, timeframe: '1W',
              dates: [], closes: [], volumes: [], open: [], high: [], low: [], status: [], source: [], capturedAt: [],
              complete: [], missingDays: [], invalid: bars.invalid || [], gapBefore: [], hasOHLC: bars.hasOHLC,
              gapTolerance: 0, calendar: bars.calendar, stale: null, dataVersion: null, fromDaily: bars.dataVersion };
  const all = (a) => a.every(scanOk);
  groups.forEach((g, gi) => {
    const idx = g.idx, first = idx[0], last = idx[idx.length - 1];
    const lastHeld = bars.dates[last];
    const expected = [];
    for (let k = 0; k < 7; k++) { const d = scanAddDays(g.wk, k); if (scanIsSession(cal, d)) expected.push(d); }
    const lastExpected = expected[expected.length - 1] || lastHeld;
    const later = gi < groups.length - 1;
    const complete = later || lastHeld >= lastExpected;
    const held = new Set(idx.map(i => bars.dates[i]));
    const missing = expected.filter(d => !held.has(d) && (complete || d < lastHeld));
    const hs = idx.map(i => bars.high[i]), ls = idx.map(i => bars.low[i]), vs = idx.map(i => bars.volumes[i]);
    const sts = idx.map(i => bars.status[i]);
    w.dates.push(lastHeld);
    w.open.push(bars.open[first] ?? null);
    w.high.push(all(hs) ? Math.max(...hs) : null);
    w.low.push(all(ls) ? Math.min(...ls) : null);
    w.closes.push(bars.closes[last]);
    w.volumes.push(all(vs) && !missing.length ? vs.reduce((t, x) => t + x, 0) : null);
    w.status.push(!complete || sts.includes('PROVISIONAL') ? 'PROVISIONAL' : sts.includes('CORRECTED') ? 'CORRECTED' : sts.every(x => x === 'FINAL') ? 'FINAL' : 'UNKNOWN');
    w.source.push(bars.source?.[last] ?? null); w.capturedAt.push(bars.capturedAt?.[last] ?? null);
    w.complete.push(complete); w.missingDays.push(missing);
    let gap = 0;
    if (gi > 0) {
      for (let wk = scanAddDays(groups[gi - 1].wk, 7), k = 0; wk < g.wk && k < 600; wk = scanAddDays(wk, 7), k++) {
        let any = false;
        for (let j = 0; j < 7 && !any; j++) any = scanIsSession(cal, scanAddDays(wk, j));
        if (any) gap++;
      }
    }
    w.gapBefore.push(gap);
  });
  /* A daily series that is behind is behind in weeks too: its last complete
     week is the one marked stale. */
  if (bars.stale) {
    let at = w.dates.length - 1;
    while (at >= 0 && w.status[at] === 'PROVISIONAL') at--;
    if (at >= 0) w.stale = { ...bars.stale, at };
  }
  w.dataVersion = scanDataVersion(w);
  return w;
}

/* Close-to-close moves too large to be a day's trading: above 1.5× or
   below 0.67×, the thresholds the statement rule uses for a share-count
   break. Tagged with the nearest plain split ratio when within 2%, else
   'unexplained'. Closes are not adjusted — this names the break, nothing
   more. */
function scanPriceBreaks(bars) {
  const out = [];
  for (let i = 1; i < (bars?.closes?.length || 0); i++) {
    const a = bars.closes[i - 1], c = bars.closes[i];
    if (!(a > 0 && c > 0)) continue;
    const r = c / a;
    if (r <= 1.5 && r >= 1 / 1.5) continue;
    let tag = 'unexplained';
    for (const k of [2, 3, 4, 5, 10]) {
      if (Math.abs(r * k - 1) <= 0.02) { tag = `split ${k}-for-1`; break; }
      if (Math.abs(r / k - 1) <= 0.02) { tag = `consolidation 1-for-${k}`; break; }
    }
    out.push({ bar: bars.dates[i], prev: bars.dates[i - 1], ratio: r, pct: (r - 1) * 100, tag });
  }
  return out;
}

/* READINESS. Per market, is the session that should be final by now held
   final? Built on the inferred calendar and the bar statuses above, so it
   is exactly as sure as they are, and says which basis it used. */
function scanReadiness(history, instruments, now, { calendars = null, barsOf = null } = {}) {
  const reg = scanRegistry(instruments);
  const clock = now != null && Number.isFinite(scanMs(now));
  const groups = new Map();
  Object.keys(history?.series || {}).forEach(sym => {
    const m = reg.get(String(sym).toUpperCase())?.market || null;
    const k = m ? String(m).toUpperCase() : '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(sym);
  });
  const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : a > b ? 1 : 0));
  const markets = order.map(k => {
    const market = k || null, syms = groups.get(k);
    const cal = (calendars && calendars(market)) || scanCalendar(history, instruments, market);
    const M = scanMarket(market);
    const expected = clock ? scanExpectedLastSession(cal, market, now) : null;
    let newestHeld = null, newestFinal = null;
    const behind = [], provisional = [];
    syms.forEach(sym => {
      const b = barsOf ? barsOf(sym, market) : scanBars(history, sym, { market, now, calendar: cal });
      const n = b.dates.length;
      if (!n) return;
      const last = b.dates[n - 1];
      if (!newestHeld || last > newestHeld) newestHeld = last;
      let at = n - 1;
      while (at >= 0 && b.status[at] === 'PROVISIONAL') at--;
      if (at < n - 1) provisional.push(sym);
      const lf = at >= 0 ? b.dates[at] : null;
      if (lf && (!newestFinal || lf > newestFinal)) newestFinal = lf;
      if (expected && (!lf || lf < expected)) behind.push(sym);
    });
    const name = market ? (SCAN_MARKETS[market] ? `${market} (${SCAN_MARKETS[market].label})` : market) : 'no market row';
    let state, text;
    if (!clock) { state = 'NO_CLOCK'; text = `${name}: no clock was given, so readiness was not judged`; }
    else if (!newestHeld) { state = 'NO_SERIES'; text = `${name}: no bars held`; }
    else if (newestFinal && expected && newestFinal >= expected) { state = 'READY'; text = `${name}: the session of ${expected} is held${behind.length ? `; ${behind.length} of ${syms.length} series are behind it` : ''}`; }
    else if (newestHeld >= (expected || '')) { state = 'PROVISIONAL'; text = `${name}: the session of ${expected} is held only as a provisional bar, captured before the close and settle`; }
    else {
      state = 'BEHIND';
      const gap = newestFinal ? scanSessionsBetween(cal, newestFinal, expected) + 1 : null;
      text = `${name}: the session of ${expected} should be held by now; the newest final bar is ${newestFinal || 'none'}${gap ? ` (${gap} session${gap === 1 ? '' : 's'} behind)` : ''}`;
    }
    return { market, label: market ? (SCAN_MARKETS[market]?.label || market) : null, tz: M.tz, close: M.close, settleMin: M.settleMin,
             calendar: cal.basis, calendarText: cal.text, symbols: syms.length, expected, newestHeld, newestFinal, behind, provisional, state, text };
  });
  return { at: clock ? new Date(scanMs(now)).toISOString() : null, ready: clock && markets.length > 0 && markets.every(m => m.state === 'READY'), markets };
}

/* ------------------------------------------------------------------- cache -- */
/* One computation per series per run. The key is the symbol, timeframe,
   the series' data version, the operand's canonical name without its
   multiplier, and the formula's calcVersion — so a corrected close or a
   changed formula is a miss, never a stale hit. It lives for a run (or a
   page session) and is not persisted: at a hundred series of a few hundred
   bars, recomputing costs milliseconds. */
function scanCache() {
  const m = new Map();
  const stats = { hits: 0, misses: 0 };
  return {
    get(k) { if (m.has(k)) { stats.hits++; return m.get(k); } stats.misses++; return undefined; },
    set(k, v) { m.set(k, v); return v; },
    stats,
    size() { return m.size; },
  };
}

/* -------------------------------------------------------------- indicators -- */
const SCAN_STATUSES = ['VALID', 'INSUFFICIENT_DATA', 'STALE_DATA', 'INVALID_INPUT'];
const SCAN_REASONS = {
  NEEDS_BARS: 'fewer bars are held than the indicator needs',
  MISSING_SESSION: 'a session is missing inside the window, or between the bar and the one before it',
  NO_VOLUME: 'volume is not recorded (for the instrument, or for a bar in the window)',
  NO_HIGH_LOW: 'highs and lows are not held; this indicator is never estimated from closes',
  ZERO_DENOMINATOR: 'the formula divides by zero here, so it has no value',
  BAD_PARAMS: 'a parameter is not a number within its bounds',
  UNKNOWN_INDICATOR: 'no indicator of that name exists',
  STALE: 'the series ends before the session that should be held by now',
  PROVISIONAL_BAR: 'the bar was captured before its session closed and settled',
};
/* A reason in words. The label comes first so each line names the operand
   it is about: 'SMA20 needs 20 bars; 10 held'. */
function scanReasonText(label, code, note, needs, have) {
  if (code === 'NEEDS_BARS') return `${label} needs ${needs} bars; ${have} held`;
  if (code === 'UNKNOWN_INDICATOR') return note;
  return `${label}: ${note}`;
}
function scanComputeSeries(id, params, field, bars, needs) {
  const def = SCAN_INDICATORS[id];
  const len = bars?.closes?.length || 0;
  const closes = bars?.closes || [], vols = bars?.volumes || new Array(len).fill(null);
  const values = new Array(len).fill(null), status = new Array(len).fill('VALID'), reason = new Array(len).fill(null);
  const whole = (st, code, note, extra = {}) => ({ values, status: status.fill(st), reason: reason.fill({ code, note }), ...extra });
  const usesVol = def.inputs.includes('volume'), usesHL = def.inputs.includes('high') || def.inputs.includes('low');
  /* No positive reading anywhere is no volume at all. FX pairs, indices and
     yields have no traded volume, and a history path can store that
     absence as 0 on every bar — which a "volume below 1" rule then matched.
     A real instrument's odd zero-trade day sits among positive readings. */
  if (usesVol && !vols.some(v => scanOk(v) && v > 0)) return whole('INVALID_INPUT', 'NO_VOLUME', 'no volume is carried for this instrument', { noVolume: true });
  if (usesHL && !bars.hasOHLC) return whole('INVALID_INPUT', 'NO_HIGH_LOW', 'needs highs and lows, and your history holds closes only for this instrument — it is never estimated from closes');
  const zd = [];
  let raw;
  switch (id) {
    case 'price': raw = closes; break;
    case 'volume': raw = vols; break;
    case 'sma': raw = scanSma(closes, params.n); break;
    case 'ema': raw = scanEma(closes, params.n); break;
    case 'rsi': raw = scanRsi(closes, params.n, zd); break;
    case 'macd': raw = scanMacd(closes, params.fast, params.slow, params.signal)[field]; break;
    case 'volume_avg': raw = scanSma(vols, params.n); break;
    case 'bb': { const r = scanBb(closes, params.n, params.k); raw = r[field]; if (field === 'pctb') zd.push(...r.zd); break; }
    case 'atr': raw = scanAtr(bars.high, bars.low, closes, params.n); break;
    case 'high_n': raw = scanRollExtreme(bars.high, params.n, Math.max); break;
    case 'low_n': raw = scanRollExtreme(bars.low, params.n, Math.min); break;
    case 'close_high_n': raw = scanRollExtreme(closes, params.n, Math.max); break;
    case 'close_low_n': raw = scanRollExtreme(closes, params.n, Math.min); break;
    case 'change': raw = scanChange(closes, params.n); break;
    case 'rvol': raw = scanRvol(vols, params.n, zd); break;
    default: raw = new Array(len).fill(null);
  }
  const zdSet = new Set(zd);
  /* Missing sessions inside a window: a gap between bar j−1 and bar j
     larger than the calendar tolerates, for any j in the window after its
     first bar. Counted with a running total so each window is O(1). */
  const tol = bars?.gapTolerance ?? 0;
  const gapPre = new Array(len + 1).fill(0);
  for (let j = 0; j < len; j++) gapPre[j + 1] = gapPre[j] + (((bars?.gapBefore?.[j] || 0) > tol) ? 1 : 0);
  const volMiss = new Array(len + 1).fill(0), hlMiss = new Array(len + 1).fill(0);
  for (let j = 0; j < len; j++) {
    volMiss[j + 1] = volMiss[j] + (scanOk(vols[j]) ? 0 : 1);
    hlMiss[j + 1] = hlMiss[j] + (scanOk(bars?.high?.[j]) && scanOk(bars?.low?.[j]) ? 0 : 1);
  }
  const zdNote = id === 'rsi' ? 'a window with neither a gain nor a loss has no RSI'
    : id === 'bb' ? 'the band has no width (every close in the window is equal), so %b is undefined'
    : id === 'rvol' ? 'the reference volume is 0, so relative volume is undefined' : 'the formula divides by zero here';
  for (let i = 0; i < len; i++) {
    const from = i - needs + 1;
    if (from < 0) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'NEEDS_BARS', note: null }; continue; }
    const gaps = gapPre[i + 1] - gapPre[from + 1];
    if (gaps > 0) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'MISSING_SESSION', note: `${gaps} gap${gaps === 1 ? '' : 's'} of missing sessions inside its ${needs}-bar window` }; continue; }
    if (usesVol) {
      const k = volMiss[i + 1] - volMiss[from];
      if (k > 0) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'NO_VOLUME', note: needs === 1 ? 'volume is not recorded for the last bar' : `volume is not recorded for ${k} of the last ${needs} bars` }; continue; }
    }
    if (usesHL) {
      const hlFrom = id === 'atr' ? Math.max(0, from) : from;
      const k = hlMiss[i + 1] - hlMiss[hlFrom];
      if (k > 0) { status[i] = 'INVALID_INPUT'; reason[i] = { code: 'NO_HIGH_LOW', note: `high and low are not held for ${k} of the last ${needs} bars` }; continue; }
    }
    if (zdSet.has(i)) { status[i] = 'INVALID_INPUT'; reason[i] = { code: 'ZERO_DENOMINATOR', note: zdNote }; continue; }
    if (!scanOk(raw[i])) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'NEEDS_BARS', note: null }; continue; }
    values[i] = raw[i];
  }
  return { values, status, reason };
}

/* One side of a rule, as a series over the bars, with a status and a
   reason at every bar. The value is null wherever the status is not VALID:
   the engine never fabricates one. */
function scanIndicatorSeries(spec, bars, { cache = null } = {}) {
  const id = spec?.indicator, def = SCAN_INDICATORS[id];
  const len = bars?.closes?.length || 0;
  const label = scanSideLabel(spec || {});
  const fill = (st, code, text) => ({ id, specKey: scanSpecKey(spec || {}), label, unit: null, needs: Infinity, field: null, calcVersion: null,
    values: new Array(len).fill(null), status: new Array(len).fill(st), reason: new Array(len).fill({ code, text }),
    series: null, noVolume: false, note: null });
  if (!def) return fill('INVALID_INPUT', 'UNKNOWN_INDICATOR', id ? `unknown indicator “${id}”` : 'no indicator is named');
  const { params, problems } = scanParams(spec);
  const field = scanFieldOf(spec);
  if (def.fields && !(field in def.fields)) problems.push(`field "${field}" is not one of ${Object.keys(def.fields).join(', ')}`);
  if (problems.length) return fill('INVALID_INPUT', 'BAD_PARAMS', `${label}: ${problems.join('; ')}`);
  const needs = def.needs(params, field);
  const key = cache && bars?.symbol != null && bars?.dataVersion
    ? `${bars.symbol}|${bars.timeframe || '1D'}|${bars.dataVersion}|${scanSpecKey(spec, { multiplier: false })}|${def.calcVersion}` : null;
  let base = key ? cache.get(key) : undefined;
  if (!base) { base = scanComputeSeries(id, params, field, bars, needs); if (key) cache.set(key, base); }
  const mult = scanMultiplier(spec.multiplier);
  const values = mult === 1 ? base.values : base.values.map(v => (v == null ? null : v * mult));
  const reason = base.reason.map((r, i) => (r ? { code: r.code, text: scanReasonText(label, r.code, r.note, needs, i + 1) } : null));
  const lastR = reason[len - 1];
  return { id, specKey: scanSpecKey(spec), label, unit: scanUnitOf(spec), needs, field, calcVersion: def.calcVersion,
           values, status: base.status, reason,
           /* 0.2 names: the series, whether the instrument carries no volume,
              and the volume note on the last bar. */
           series: values, noVolume: !!base.noVolume, note: lastR && lastR.code === 'NO_VOLUME' ? lastR.text.replace(/^[^:]*: /, '') : null };
}

/* The canonical decimal form of a value for a record: twelve significant
   digits, which is past every price's precision and short of binary noise. */
const scanDec = (v) => (scanOk(v) ? Number(v.toPrecision(12)).toString() : null);

/* The spec's IndicatorResult: one operand at one bar. STALE_DATA is decided
   here, for the bar the series is marked stale at. */
function scanIndicator(spec, bars, { at = null, cache = null } = {}) {
  const S = scanIndicatorSeries(spec, bars, { cache });
  const n = bars?.closes?.length || 0;
  const i = at == null ? n - 1 : at;
  const def = SCAN_INDICATORS[spec?.indicator];
  const base = { instrumentId: bars?.instrumentId ?? null, symbol: bars?.symbol ?? null, indicator: S.specKey, label: S.label, unit: S.unit, field: S.field,
                 timeframe: bars?.timeframe || '1D', needs: S.needs, calculationVersion: def ? `${spec.indicator}@${def.calcVersion}` : null,
                 dataVersion: bars?.dataVersion ?? null };
  if (i < 0 || i >= n) {
    const reason = S.reason[0]?.code && S.reason[0].code !== 'NEEDS_BARS' ? S.reason[0]
      : { code: 'NEEDS_BARS', text: scanReasonText(S.label, 'NEEDS_BARS', null, S.needs, Math.max(0, i + 1)) };
    return { ...base, timestamp: null, value: null, valueText: null, status: S.status[0] && S.status[0] !== 'VALID' ? S.status[0] : 'INSUFFICIENT_DATA', reason, have: Math.max(0, Math.min(i + 1, n)), barStatus: null };
  }
  let status = S.status[i], reason = S.reason[i], value = S.values[i];
  if (status === 'VALID' && bars.stale && bars.stale.at === i) {
    status = 'STALE_DATA'; value = null;
    reason = { code: 'STALE', text: `its last final bar is ${bars.stale.last}, and the session of ${bars.stale.expected} should be held by now — a stale series is not evaluated` };
  }
  return { ...base, timestamp: bars.dates[i], value, valueText: scanDec(value), status, reason: status === 'VALID' ? null : reason, have: i + 1, barStatus: bars.status?.[i] || 'UNKNOWN' };
}

/* Numbers in rule text. Two decimals, as before — but never so few that two
   different values print the same: 0.345 against 0.34 prints '0.345 above
   0.340', where it once printed '0.34 above 0.34'. */
const scanFmt = (v, dp = 2) => (v == null ? '—' : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(dp));
function scanFmtAll(vals) {
  const xs = vals.filter(scanOk);
  const distinct = new Set(xs.map(scanDec)).size;
  let dp = 2;
  while (dp < 8 && new Set(xs.map(v => scanFmt(v, dp))).size < distinct) dp++;
  return (v) => scanFmt(v, dp);
}

/* ------------------------------------------------------------------ setups -- */
/* SetupV2 = { id, version, hash, name, description?, enabled, universe,
   timeframe '1D' | '1W', confirmationMode 'BAR_CLOSE', cooldownMode
   'NEW_MATCH' | 'EVERY_MATCH', cooldownBars, expires, ruleTree }, where the
   tree is RuleGroup { type: 'group', logic: 'ALL' | 'ANY', children } of
   Conditions { type: 'condition', left, op, right?, range? } and an operand
   is an indicator spec or { value }.

   THE ONLY READER OF 0.2. A 0.2 setup ({ logic AND/OR, rules[] }, the
   lower-case operators, timeframe 'daily') is read into that shape here and
   nowhere else, so the builder and the worker cannot drift in how they read
   an old file. A 0.2 setup recorded every bar it matched on, so it reads as
   EVERY_MATCH and keeps doing that; a setup written as a tree defaults to
   NEW_MATCH. Quoted numerals become numbers here, once. Idempotent on V2. */
function scanNormaliseOperand(o) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return o;
  if (o.indicator != null) return { ...o };
  if ('value' in o) return { ...o, value: scanNumeric(o.value) ? Number(o.value) : o.value };
  return { ...o };
}
function scanNormaliseNode(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  if (node.type === 'group' || (node.type !== 'condition' && Array.isArray(node.children))) {
    const logic = node.logic === 'AND' ? 'ALL' : node.logic === 'OR' ? 'ANY' : node.logic;
    return { type: 'group', logic, children: Array.isArray(node.children) ? node.children.map(scanNormaliseNode) : node.children };
  }
  const c = { type: 'condition' };
  if (node.id != null) c.id = node.id;
  c.left = scanNormaliseOperand(node.left);
  c.op = scanOpName(node.op) || node.op;
  if (node.right !== undefined) c.right = scanNormaliseOperand(node.right);
  if (node.range !== undefined) {
    c.range = Array.isArray(node.range)
      ? node.range.map(x => (x != null && typeof x === 'object' ? scanNormaliseOperand(x) : { value: scanNumeric(x) ? Number(x) : x }))
      : node.range;
  }
  return c;
}
function scanNormaliseSetup(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const tree = raw.ruleTree != null ? scanNormaliseNode(raw.ruleTree)
    : { type: 'group', logic: raw.logic === 'OR' ? 'ANY' : 'ALL', children: Array.isArray(raw.rules) ? raw.rules.map(scanNormaliseNode) : [] };
  const s = {
    id: raw.id,
    version: Number.isInteger(raw.version) && raw.version >= 1 ? raw.version : 1,
    hash: null,
    name: raw.name != null && raw.name !== '' ? raw.name : raw.id,
    ...(raw.description != null ? { description: raw.description } : {}),
    enabled: raw.enabled !== false,
    universe: raw.universe && typeof raw.universe === 'object' ? { ...raw.universe, kind: raw.universe.kind || 'all' } : { kind: 'all' },
    timeframe: scanTimeframe(raw.timeframe),
    confirmationMode: raw.confirmationMode != null ? raw.confirmationMode : 'BAR_CLOSE',
    cooldownMode: raw.cooldownMode != null ? raw.cooldownMode : (raw.ruleTree != null ? 'NEW_MATCH' : 'EVERY_MATCH'),
    cooldownBars: raw.cooldownBars == null ? 0 : scanNumeric(raw.cooldownBars) && Number(raw.cooldownBars) >= 0 ? Math.round(Number(raw.cooldownBars)) : raw.cooldownBars,
    expires: raw.expires ?? null,
    ruleTree: tree,
  };
  ['created', 'updated'].forEach(k => { if (raw[k] != null) s[k] = raw[k]; });
  s.hash = scanHash(scanCanonicalOf(s));
  return s;
}
/* The evaluation fields of a setup, and nothing else, as sorted-key JSON:
   the name, the description and whether it is enabled do not change what a
   rule means, so they do not change its hash. Operands are written by
   their canonical names, so 'sma' and 'sma, n 20' are one operand. */
function scanCanonicalOf(s) {
  const u = s.universe || { kind: 'all' };
  const uni = { kind: u.kind };
  if (u.kind === 'market') uni.market = String(u.market || '').toUpperCase();
  if (u.kind === 'symbols' || u.kind === 'watchlist') uni.symbols = (Array.isArray(u.symbols) ? u.symbols : []).map(x => String(x).toUpperCase());
  if (Array.isArray(u.instrumentIds)) uni.instrumentIds = u.instrumentIds.map(x => String(x).toUpperCase());
  const opnd = (o) => (o == null ? undefined : typeof o !== 'object' ? o : o.indicator != null ? scanSpecKey(o) : { value: scanNumeric(o.value) ? Number(o.value) : o.value });
  const node = (n) => (!n || typeof n !== 'object' ? n
    : n.type === 'group' ? { logic: n.logic, children: Array.isArray(n.children) ? n.children.map(node) : n.children }
    : { op: scanOpName(n.op) || n.op, left: opnd(n.left), right: opnd(n.right), range: Array.isArray(n.range) ? n.range.map(opnd) : n.range });
  return scanStable({ timeframe: s.timeframe, universe: uni, confirmationMode: s.confirmationMode, cooldownMode: s.cooldownMode,
                      cooldownBars: s.cooldownBars, expires: s.expires ?? null, ruleTree: node(s.ruleTree) });
}
const scanCanonical = (setup) => scanCanonicalOf(scanNormaliseSetup(setup));

/* A condition and a tree in words, for the page's list and the builder. */
function scanOperandProse(o) {
  if (o == null) return '?';
  if (typeof o !== 'object') return scanNumeric(o) ? String(Number(o)) : '?';
  if (o.indicator != null) return scanSideLabel(o);
  return scanNumeric(o.value) ? String(Number(o.value)) : '?';
}
function scanConditionProse(c) {
  if (!c || typeof c !== 'object') return '(not a condition)';
  const op = scanOpName(c.op);
  if (op === 'BETWEEN') return `${scanOperandProse(c.left)} between ${scanOperandProse(c.range?.[0])} and ${scanOperandProse(c.range?.[1])}`;
  return `${scanOperandProse(c.left)} ${op ? SCAN_OPERATORS[op].label : `“${c.op}”`} ${scanOperandProse(c.right)}`;
}
/* The tree as indented lines: { depth, text }. A group line reads "all of"
   or "any of"; its conditions follow one level in. */
function scanTreeLines(tree) {
  const out = [];
  const walk = (n, depth) => {
    if (n?.type === 'group') {
      if (depth > 0) out.push({ depth, text: `${n.logic === 'ANY' ? 'any' : 'all'} of:`, group: true });
      (Array.isArray(n.children) ? n.children : []).forEach(c => walk(c, depth + 1));
    } else out.push({ depth, text: scanConditionProse(n) });
  };
  walk(tree, 0);
  return out;
}
const scanConditionCount = (tree) => { let n = 0; const w = (x) => { if (x?.type === 'group') (x.children || []).forEach(w); else n++; }; w(tree); return n; };

/* -------------------------------------------------------------- validation -- */
/* VALIDATION — the same for the page and the worker. A setups file is
   `{ setups: [...] }` or a bare list. Every setup either passes whole or is
   left out whole, with every reason: a half-valid setup evaluated on the
   conditions that parsed would match on fewer conditions than the reader
   wrote. Each problem has a path ('group 2 › condition 1') and a code, for
   the builder; `problems` keeps the one-line form the page and the worker
   print. The setups that pass come back normalised, with their hash. */
function scanValidate(doc, { limits = null } = {}) {
  const L = { ...SCAN_LIMITS, ...(limits || {}) };
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.setups) ? doc.setups : null;
  const problems = [], problemsBySetup = {}, setups = [];
  if (!list) {
    const text = 'the setups file is neither a list nor an object with a "setups" list';
    return { setups, problems: [text], problemsBySetup: { '': [{ path: '', code: 'NOT_A_LIST', text }] } };
  }
  const ids = new Map();
  list.forEach(s => { const id = s?.id; if (typeof id === 'string' && id) ids.set(id, (ids.get(id) || 0) + 1); });
  const indicatorList = Object.keys(SCAN_INDICATORS).join(', ');
  list.forEach((raw, i) => {
    const who = (raw && typeof raw === 'object' && (raw.id || raw.name)) || `setup #${i + 1}`;
    const key = raw && typeof raw === 'object' && typeof raw.id === 'string' && raw.id ? raw.id : `#${i + 1}`;
    const errs = [];
    const bad = (path, code, text) => errs.push({ path, code, text });
    const finish = () => {
      if (!errs.length) return true;
      (problemsBySetup[key] = problemsBySetup[key] || []).push(...errs);
      errs.forEach(e => problems.push(`${who}: ${e.path ? `${e.path}: ` : ''}${e.text}`));
      return false;
    };
    if (i >= L.maxSetups) { bad('', 'TOO_MANY_SETUPS', `past the limit of ${L.maxSetups} setups in one file`); finish(); return; }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { bad('', 'NOT_OBJECT', 'is not an object'); finish(); return; }
    if (typeof raw.id !== 'string' || !raw.id) { bad('id', 'NO_ID', 'has no id — ids are part of every alert key'); finish(); return; }
    /* An id is part of every alert key ('|') and of the setup's address
       (/app/scanner/setups/:setup), so it may not carry a separator or a
       character a path or query would read as its own. */
    if (/[|\s./?#%\\]/.test(raw.id)) { bad('id', 'BAD_ID', 'id contains "|", whitespace or one of . / ? # % \\ — it is part of every alert key and of the setup’s address'); finish(); return; }
    if (ids.get(raw.id) > 1) { bad('id', 'DUPLICATE_ID', 'id is used by more than one setup'); finish(); return; }
    const s = scanNormaliseSetup(raw);
    if (raw.version != null && !(Number.isInteger(raw.version) && raw.version >= 1)) bad('version', 'BAD_VERSION', `version "${raw.version}" is not a whole number of at least 1`);
    const tf = SCAN_TIMEFRAMES[s.timeframe];
    if (!tf) bad('timeframe', 'UNKNOWN_TIMEFRAME', `timeframe "${raw.timeframe}" is not one of ${Object.keys(SCAN_TIMEFRAMES).join(', ')}`);
    else if (!tf.built) bad('timeframe', 'TIMEFRAME_NOT_BUILT', `timeframe "${raw.timeframe}" is not built — ${tf.reason}`);
    if (raw.logic != null && raw.logic !== 'AND' && raw.logic !== 'OR') bad('logic', 'BAD_LOGIC', `logic "${raw.logic}" is not AND or OR`);
    if (raw.ruleTree != null && raw.rules != null) bad('rules', 'TWO_RULE_FORMS', 'carries both "rules" and "ruleTree" — a setup has one set of conditions');
    const hasRules = raw.ruleTree != null || (Array.isArray(raw.rules) && raw.rules.length > 0);
    if (!hasRules) bad('rules', 'NO_RULES', 'has no rules');
    if (raw.expires != null && !scanIsDay(raw.expires)) bad('expires', 'BAD_EXPIRES', `expires "${raw.expires}" is not YYYY-MM-DD`);
    if (raw.cooldownBars != null && !(scanNumeric(raw.cooldownBars) && Number(raw.cooldownBars) >= 0)) bad('cooldownBars', 'BAD_COOLDOWN', `cooldownBars "${raw.cooldownBars}" is not a non-negative number`);
    if (s.cooldownMode !== 'NEW_MATCH' && s.cooldownMode !== 'EVERY_MATCH') bad('cooldownMode', 'BAD_COOLDOWN_MODE', `cooldown mode "${s.cooldownMode}" is not NEW_MATCH or EVERY_MATCH`);
    if (s.confirmationMode !== 'BAR_CLOSE' || (raw.confirmation != null && raw.confirmation !== 'close'))
      bad('confirmationMode', 'BAD_CONFIRMATION', `confirmation "${raw.confirmationMode ?? raw.confirmation}" is not BAR_CLOSE — only a completed bar is evaluated`);
    const u = s.universe;
    if (!['all', 'market', 'symbols', 'watchlist'].includes(u.kind)) bad('universe', 'BAD_UNIVERSE', `universe kind "${u.kind}" is not all, market, symbols or watchlist`);
    else if (u.kind === 'symbols' && (!Array.isArray(u.symbols) || !u.symbols.some(x => typeof x === 'string' && x.trim()))) bad('universe', 'BAD_UNIVERSE', 'universe is "symbols" but names none');
    /* A watchlist lives in a browser; the worker sees only the snapshot of
       its symbols the page wrote into the setup. Without one there is
       nothing to scan. */
    else if (u.kind === 'watchlist' && (!Array.isArray(u.symbols) || !u.symbols.length)) bad('universe', 'BAD_UNIVERSE', 'universe is a watchlist but carries no symbol snapshot — copy the setup JSON again from the scanner page');
    else if (u.kind === 'market' && !u.market) bad('universe', 'BAD_UNIVERSE', 'universe is "market" but names none');

    if (hasRules) {
      let count = 0;
      const operand = (o, path, side) => {
        if (!o || typeof o !== 'object' || Array.isArray(o)) { bad(path, 'MISSING_OPERAND', `${side} side is missing`); return false; }
        const def = SCAN_INDICATORS[o.indicator];
        if (!def) { bad(path, 'UNKNOWN_INDICATOR', `${side} indicator "${o.indicator}" is not one of ${indicatorList}`); return false; }
        const { problems: pp } = scanParams(o);
        if (pp.length) { bad(path, 'BAD_PARAMS', `${side} ${scanSideLabel({ indicator: o.indicator })}: ${pp.join('; ')}`); return false; }
        if (o.multiplier != null && !(scanNumeric(o.multiplier) && Number(o.multiplier) > 0)) { bad(path, 'BAD_MULTIPLIER', `${side} multiplier "${o.multiplier}" is not a positive number`); return false; }
        if (def.fields) {
          const f = scanFieldOf(o);
          if (!(f in def.fields)) { bad(path, 'BAD_FIELD', `${side} ${def.label} field "${f}" is not one of ${Object.keys(def.fields).join(', ')}`); return false; }
        } else if (o.field != null) { bad(path, 'BAD_FIELD', `${side} ${def.label} has no field "${o.field}"`); return false; }
        return scanUnitOf(o);
      };
      const literal = (v, unit, path, what, leftLabel) => {
        if (!scanNumeric(v)) { bad(path, 'INVALID_LITERAL', v == null ? `${what} needs an indicator or a numeric value` : `${what} "${v}" is not a number`); return false; }
        const U = SCAN_UNITS[unit];
        if (U && !U.literal(Number(v))) { bad(path, 'INVALID_LITERAL', `${what} ${Number(v)} is outside what ${leftLabel} can be — ${U.domain}`); return false; }
        return true;
      };
      const condition = (c, path) => {
        const op = scanOpName(c.op);
        if (!op) { bad(path, 'UNKNOWN_OPERATOR', `operator "${c.op}" is not one of ${Object.keys(SCAN_OPERATORS).join(', ')} (or the 0.2 names ${Object.keys(SCAN_OP_ALIASES).join(', ')})`); return; }
        if (c.left && typeof c.left === 'object' && c.left.indicator == null && 'value' in c.left) { bad(path, 'BAD_OPERAND', 'the left side must be an indicator, not a fixed value'); return; }
        const lu = operand(c.left, path, 'left');
        if (lu === false) return;
        const ll = scanSideLabel(c.left);
        if (op === 'BETWEEN') {
          if (c.right != null) { bad(path, 'EXTRA_OPERAND', '"between" takes a range, and this condition also carries a right side, which would be ignored'); return; }
          if (!Array.isArray(c.range) || c.range.length !== 2) { bad(path, 'INVALID_LITERAL', '"between" needs a range of two numbers'); return; }
          c.range.forEach((r, j) => {
            if (r && typeof r === 'object' && r.indicator != null) {
              const ru = operand(r, path, `range bound ${j + 1}`);
              if (ru !== false && ru !== lu) bad(path, 'UNIT_MISMATCH', `${ll} (${SCAN_UNITS[lu]?.label || lu}) cannot be bounded by ${scanSideLabel(r)} (${SCAN_UNITS[ru]?.label || ru})`);
            } else if (!scanNumeric(r?.value)) bad(path, 'INVALID_LITERAL', '"between" needs a range of two numbers');
            else literal(r.value, lu, path, `range bound ${j + 1}`, ll);
          });
          return;
        }
        if (c.range != null) { bad(path, 'EXTRA_OPERAND', `"${SCAN_OPERATORS[op].label}" takes a right side, and this condition also carries a range, which would be ignored`); return; }
        const r = c.right;
        if (r && typeof r === 'object' && r.indicator != null) {
          const ru = operand(r, path, 'right');
          if (ru === false) return;
          if (ru !== lu) { bad(path, 'UNIT_MISMATCH', `${ll} (${SCAN_UNITS[lu]?.label || lu}) cannot be compared with ${scanSideLabel(r)} (${SCAN_UNITS[ru]?.label || ru})`); return; }
          if (op === 'EQUALS' && !SCAN_OPERATORS.EQUALS.equatableUnits.includes(lu)) bad(path, 'EQUALS_NOT_ALLOWED', `exact equality of two ${SCAN_UNITS[lu]?.label || lu} readings is noise — use BETWEEN, or compare with a fixed value`);
        } else if (r && typeof r === 'object' && 'value' in r) literal(r.value, lu, path, 'the right-hand value', ll);
        else bad(path, 'MISSING_OPERAND', 'right side needs an indicator or a numeric value');
      };
      const walk = (n, path, depth) => {
        if (!n || typeof n !== 'object' || Array.isArray(n)) { bad(path || 'rules', 'BAD_NODE', 'is not a group or a condition'); return; }
        if (n.type === 'group') {
          if (depth > L.maxDepth) { bad(path || 'rules', 'TOO_DEEP', `groups are nested ${depth} deep; the limit is ${L.maxDepth}`); return; }
          if (n.logic !== 'ALL' && n.logic !== 'ANY') bad(path || 'rules', 'BAD_LOGIC', `group logic "${n.logic}" is not ALL or ANY`);
          if (!Array.isArray(n.children) || !n.children.length) { bad(path || 'rules', 'EMPTY_GROUP', 'a group with no conditions matches nothing'); return; }
          n.children.forEach((c, j) => {
            const g = c && typeof c === 'object' && c.type === 'group';
            walk(c, `${path ? `${path} › ` : ''}${g ? 'group' : 'condition'} ${j + 1}`, g ? depth + 1 : depth);
          });
          return;
        }
        count++;
        condition(n, path || 'condition 1');
      };
      walk(s.ruleTree, '', 1);
      if (count > L.maxConditions) bad('rules', 'TOO_MANY_CONDITIONS', `${count} conditions; the limit is ${L.maxConditions}`);
    }
    if (finish()) setups.push(s);
  });
  return { setups, problems, problemsBySetup };
}

/* -------------------------------------------------------------- evaluation -- */
const SCAN_VERBS = {
  GREATER_THAN: ['above', 'not above'], LESS_THAN: ['below', 'not below'],
  GREATER_THAN_OR_EQUAL: ['at or above', 'below'], LESS_THAN_OR_EQUAL: ['at or below', 'above'],
  EQUALS: ['equal to', 'not equal to'],
  CROSSES_ABOVE: ['crossed above', 'did not cross above'], CROSSES_BELOW: ['crossed below', 'did not cross below'],
};
/* One condition at bar i. Its state is MET or NOT_MET only when every
   value it reads is VALID; otherwise UNAVAILABLE, with the first reason —
   untested is not failed: a condition that could not be read has not been
   satisfied and has not been broken either. A crossing reads the bar
   before as well, and only when that bar is the previous session. */
function scanEvalCondition(cond, bars, i, cache) {
  const opName = scanOpName(cond?.op);
  const res = { type: 'condition', path: null, op: opName || cond?.op || null, state: 'UNAVAILABLE', met: null, text: '', reason: null,
                left: null, right: null, prevLeft: null, prevRight: null, leftLabel: null, rightLabel: null, leftValue: null, rightValue: null };
  const na = (code, text) => { res.state = 'UNAVAILABLE'; res.met = null; res.reason = { code, text }; res.text = text; return res; };
  if (!opName) return na('UNKNOWN_OPERATOR', `unknown operator “${cond?.op}”`);
  const op = SCAN_OPERATORS[opName];
  const ls = cond.left;
  if (!ls || typeof ls !== 'object' || ls.indicator == null) return na('MISSING_OPERAND', 'the left side must be an indicator');
  const ind = (spec, at) => scanIndicator(spec, bars, { at, cache });
  /* A crossing's warm-up is one bar longer than its operands'. */
  const unread = (R) => (op.needsPrev && R.reason?.code === 'NEEDS_BARS'
    ? na('NEEDS_BARS', `${R.label} needs ${R.needs + 1} bars; ${i + 1} held`) : na(R.reason.code, R.reason.text));
  const L = ind(ls, i);
  res.left = L; res.leftLabel = L.label;
  if (L.status !== 'VALID') return unread(L);
  let Lp = null;
  if (op.needsPrev) {
    Lp = ind(ls, i - 1); res.prevLeft = Lp;
    if (Lp.status !== 'VALID') return unread(Lp.reason?.code === 'NEEDS_BARS' ? { ...Lp, label: L.label, needs: L.needs } : Lp);
  }
  const lv = L.value;
  if (opName === 'BETWEEN') {
    if (!Array.isArray(cond.range) || cond.range.length !== 2) return na('INVALID_LITERAL', `${L.label}: the range needs two numbers`);
    const bounds = [];
    for (const r0 of cond.range) {
      const r = r0 != null && typeof r0 === 'object' ? r0 : { value: r0 };
      if (r.indicator != null) {
        const R = ind(r, i);
        if (R.status !== 'VALID') return unread(R);
        bounds.push({ v: R.value, label: R.label, result: R });
      } else if (scanNumeric(r.value)) bounds.push({ v: Number(r.value), label: null, result: { value: Number(r.value) } });
      else return na('INVALID_LITERAL', `${L.label}: the range needs two numbers`);
    }
    const met = scanCompare('BETWEEN', lv, null, { lo: bounds[0].v, hi: bounds[1].v });
    const fmt = scanFmtAll([lv, bounds[0].v, bounds[1].v]);
    const bt = (b) => (b.label ? `${b.label} ${fmt(b.v)}` : fmt(b.v));
    Object.assign(res, { state: met ? 'MET' : 'NOT_MET', met, right: bounds.map(b => b.result), leftValue: lv, rightValue: [bounds[0].v, bounds[1].v],
      rightLabel: `${bounds[0].label || fmt(bounds[0].v)} and ${bounds[1].label || fmt(bounds[1].v)}`,
      text: `${L.label} ${fmt(lv)} ${met ? 'between' : 'outside'} ${bt(bounds[0])} and ${bt(bounds[1])}` });
    return res;
  }
  const r = cond.right;
  let rv, rp = null, R = null, Rp = null;
  if (r && typeof r === 'object' && r.indicator != null) {
    R = ind(r, i); res.right = R; res.rightLabel = R.label;
    if (R.status !== 'VALID') return unread(R);
    if (op.needsPrev) {
      Rp = ind(r, i - 1); res.prevRight = Rp;
      if (Rp.status !== 'VALID') return unread(Rp.reason?.code === 'NEEDS_BARS' ? { ...Rp, label: R.label, needs: R.needs } : Rp);
      rp = Rp.value;
    }
    rv = R.value;
  } else {
    const v = r && typeof r === 'object' ? r.value : r;
    if (!scanNumeric(v)) return na('INVALID_LITERAL', `${L.label}: no value to compare against`);
    rv = Number(v); rp = rv; res.right = { value: rv };
  }
  if (op.needsPrev) {
    const g = bars?.gapBefore?.[i] || 0;
    if (g > (bars?.gapTolerance ?? 0)) {
      return na('MISSING_SESSION', `${L.label}: the bar before ${bars.dates[i]} is ${bars.dates[i - 1]}, with ${g} session${g === 1 ? '' : 's'} missing between them — a crossing is read only between consecutive sessions`);
    }
  }
  const met = scanCompare(opName, lv, rv, { lp: Lp?.value, rp });
  const fmt = scanFmtAll([lv, rv]);
  const verb = SCAN_VERBS[opName][met ? 0 : 1];
  Object.assign(res, { state: met ? 'MET' : 'NOT_MET', met, leftValue: lv, rightValue: rv, rightLabel: R ? R.label : fmt(rv),
    text: `${L.label} ${fmt(lv)} ${verb} ${R ? `${R.label} ${fmt(rv)}` : fmt(rv)}` });
  return res;
}
/* Groups combine by Kleene's three-valued logic. ALL is NOT_MET if any
   child is NOT_MET (decided, whatever the others say), else UNAVAILABLE if
   any child is, else MET. ANY is MET if any child is MET, else UNAVAILABLE
   if any is, else NOT_MET. */
function scanEvalNode(node, bars, i, cache, path, flat) {
  if (!node || typeof node !== 'object') {
    const c = { type: 'condition', path: path || '1', op: null, state: 'UNAVAILABLE', met: null, text: '(not a condition)', reason: { code: 'BAD_NODE', text: 'not a group or a condition' } };
    flat.push(c);
    return c;
  }
  if (node.type === 'group') {
    const kids = (Array.isArray(node.children) ? node.children : []).map((c, j) => scanEvalNode(c, bars, i, cache, path ? `${path}.${j + 1}` : `${j + 1}`, flat));
    let state, reason = null;
    if (!kids.length) { state = 'UNAVAILABLE'; reason = { code: 'EMPTY_GROUP', text: 'a group with no conditions matches nothing' }; }
    else if (node.logic === 'ANY') state = kids.some(k => k.state === 'MET') ? 'MET' : kids.some(k => k.state === 'UNAVAILABLE') ? 'UNAVAILABLE' : 'NOT_MET';
    else state = kids.some(k => k.state === 'NOT_MET') ? 'NOT_MET' : kids.some(k => k.state === 'UNAVAILABLE') ? 'UNAVAILABLE' : 'MET';
    return { type: 'group', path, logic: node.logic === 'ANY' ? 'ANY' : 'ALL', state, reason, children: kids };
  }
  const c = scanEvalCondition(node, bars, i, cache);
  c.path = path || '1';
  flat.push(c);
  return c;
}
/* A rule tree at bar `at` (the last bar when absent). Every indicator is
   causal — it reads bars 0..at only — so evaluating at i over the whole
   history is evaluating the history as it stood at i. `confirmedOnly`: a
   PROVISIONAL bar is never a match. */
function scanEvaluate(ruleTree, bars, { at = null, cache = null, confirmedOnly = true } = {}) {
  const n = bars?.closes?.length || 0;
  const i = at == null ? n - 1 : at;
  const conditions = [];
  const tree = scanEvalNode(ruleTree, bars, i, cache, '', conditions);
  const barStatus = i >= 0 && i < n ? (bars.status?.[i] || 'UNKNOWN') : null;
  let state = tree.state, reason = tree.reason || null;
  if (i < 0 || i >= n) { state = 'UNAVAILABLE'; reason = { code: 'NEEDS_BARS', text: 'no bar is held at that position' }; }
  else if (confirmedOnly && barStatus === 'PROVISIONAL') {
    state = 'UNAVAILABLE';
    reason = { code: 'PROVISIONAL_BAR', text: `the bar of ${bars.dates[i]} was captured before its session closed and settled — a provisional bar never confirms a match` };
  }
  return { state, reason, at: i, bar: bars?.dates?.[i] ?? null, close: bars?.closes?.[i] ?? null, barStatus, dataVersion: bars?.dataVersion ?? null, tree, conditions };
}
/* 0.2's one-rule evaluator, on the last bar, kept for the page and the
   tests: { met: true | false | null, text, untested, left, right }. */
function scanRule(rule, bars, { cache = null } = {}) {
  const c = scanEvalCondition(scanNormaliseNode(rule || {}), bars, (bars?.closes?.length || 0) - 1, cache);
  return { met: c.met, state: c.state, text: c.text, untested: c.state === 'UNAVAILABLE', reason: c.reason,
           left: c.leftValue ?? undefined, right: c.rightValue ?? undefined };
}
/* A whole setup on one instrument's bars, in 0.2's shape plus the state
   and the conditions. */
function scanSetup(setup, symbol, bars, { at = null, cache = null, confirmedOnly = true } = {}) {
  const s = scanNormaliseSetup(setup || {});
  const r = scanEvaluate(s.ruleTree, bars, { at, cache, confirmedOnly });
  return { symbol, state: r.state, matched: r.state === 'MET', untested: r.state === 'UNAVAILABLE', reason: r.reason,
           rules: r.conditions.map(c => ({ path: c.path, text: c.text, met: c.met, state: c.state, left: c.leftValue, right: c.rightValue })),
           conditions: r.conditions, bar: r.bar, close: r.close, barStatus: r.barStatus };
}

/* ----------------------------------------------------------------- universe -- */
/* Which instruments a setup looks at. `all` is everything with a series;
   `market` reads the instrument registry; `symbols` is the reader's list. */
function scanUniverse(setup, history, instruments) {
  const have = Object.keys(history?.series || {});
  const u = setup?.universe || { kind: 'all' };
  /* A watchlist universe is the list's symbols, snapshotted into the setup
     when the JSON was written: the worker cannot read a browser's storage. */
  if (u.kind === 'symbols' || u.kind === 'watchlist') {
    const want = new Set((u.symbols || []).map(s => String(s).toUpperCase()));
    return have.filter(s => want.has(String(s).toUpperCase()));
  }
  if (u.kind === 'market') {
    const mkt = String(u.market || '').toUpperCase();
    const reg = scanRegistry(instruments);
    return have.filter(s => String(reg.get(String(s).toUpperCase())?.market || '').toUpperCase() === mkt);
  }
  return have;
}
/* What a universe names but cannot scan, so the run can say so rather than
   drop it: a named symbol with no series in the history, and, for a market
   universe, a series with no row in the instrument registry. */
function scanUniverseGaps(setup, history, instruments) {
  const have = new Set(Object.keys(history?.series || {}).map(s => String(s).toUpperCase()));
  const u = setup?.universe || { kind: 'all' };
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
    const reg = scanRegistry(instruments);
    return { missing: [], unplaced: Object.keys(history?.series || {}).filter(s => !reg.has(String(s).toUpperCase())) };
  }
  return { missing: [], unplaced: [] };
}

/* --------------------------------------------------------------------- keys -- */
/* An alert's identity: the setup and its version, the instrument (its
   canonical MARKET:SYMBOL, or the bare symbol when the registry has no row),
   the timeframe, the bar and the event. The same bar under two versions of
   a setup is two records; a retry is none. */
const scanKey = (setupId, version, inst, timeframe, bar, eventType) => `${setupId}|v${version}|${inst}|${scanTimeframe(timeframe)}|${bar}|${eventType}`;
/* The 0.2 key. A version-1 daily setup is also deduplicated against it, so
   no bar recorded before the upgrade is recorded again after it. */
const scanLegacyKey = (setupId, symbol, bar) => `${setupId}|${symbol}|daily|${bar}`;
const scanAlertId = (key) => `a${scanHash(key)}`;
/* The bars a run was evaluated on, in words — one date when every pair
   shared it, the range when instruments end on different days. */
const scanBarRange = (from, to) => !to ? 'no bar' : (!from || from === to) ? to : `${from} … ${to}`;

/* The history as though it ended on a date: every map cut to bars on or
   before it. Replay evaluates this, so a replay of a past session sees
   exactly what a run on that evening would have. */
function scanTruncateHistory(history, asOf) {
  if (!asOf || !history) return history;
  const cut = (m) => (m && typeof m === 'object' ? Object.fromEntries(Object.entries(m).map(([sym, s]) => [sym,
    Array.isArray(s) ? s.filter(x => !x?.date || x.date <= asOf)
      : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).filter(([d]) => d <= asOf)) : s])) : m);
  return { ...history, series: cut(history.series), volume: cut(history.volume), ohlc: cut(history.ohlc), meta: cut(history.meta), corrections: cut(history.corrections), truncatedAt: asOf };
}
/* The instant a replay treats as "now": the morning after the session, in
   UTC, which is after every market's close and settle on that date and
   before any market's close on the next. */
const scanReplayNow = (asOf) => `${scanAddDays(asOf, 1)}T04:00:00Z`;

/* ---------------------------------------------------------------------- run -- */
/* The run. Every enabled, unexpired setup against every instrument in its
   universe, on the last final bar of each (a provisional last bar is named,
   and the bar before it is evaluated). A match becomes one alert unless its
   key is already recorded or the setup matched this instrument within its
   cooldown. NEW_MATCH records only the bar a match begins (the tree NOT_MET
   on the bar before), and records FIRST_OBSERVED when the bar before could
   not be evaluated; EVERY_MATCH records every matching bar. Nothing is
   sorted by anything but the order of the setups and the symbols.

   `asOf` replays: the history is cut at that date and judged as of the
   morning after it. `existing` is the record so far; `runId` and `origin`
   are written on every alert. */
function scanRun(setups, history, { instruments = [], existing = [], now = null, runId = null, origin = null, asOf = null, cache = null } = {}) {
  const hist = asOf ? scanTruncateHistory(history, asOf) : history;
  const clockNow = asOf ? scanReplayNow(asOf) : now;
  const C = cache || scanCache();
  const reg = scanRegistry(instruments);
  /* untestedList carries each untested pair's reason; stale names series
     evaluated on a bar well behind the newest one the history holds;
     untestedEverywhere is decided from the pairs actually evaluated. */
  const out = { engine: `scan ${SCAN_VERSION}`, runId, origin, replayAsOf: asOf || null, alerts: [], evaluated: 0, matched: 0, untested: 0,
                deduped: 0, cooldown: 0, continuing: 0, skipped: [], setups: 0, untestedList: [], untestedEverywhere: [], stale: [], provisional: [] };
  const prior = Array.isArray(existing) ? existing : [];
  const seen = new Set(prior.map(a => a?.key).filter(Boolean));
  /* The newest recorded bar per setup version, instrument and timeframe:
     what a cooldown is counted from. A 0.2 alert has no version (it was
     version 1) and the timeframe 'daily'. */
  const lastBy = new Map();
  const cdKey = (id, v, sym, tf) => `${id}|${v}|${String(sym).toUpperCase()}|${scanTimeframe(tf)}`;
  prior.forEach(a => {
    if (!a?.setupId || a.symbol == null) return;
    const k = cdKey(a.setupId, a.setupVersion ?? 1, a.symbol, a.timeframe), b = a.candleDate || a.bar;
    if (b && (!lastBy.has(k) || b > lastBy.get(k))) lastBy.set(k, b);
  });
  const cals = new Map();
  const calFor = (m) => { const k = m ? String(m).toUpperCase() : ''; if (!cals.has(k)) cals.set(k, scanCalendar(hist, instruments, m || null)); return cals.get(k); };
  const barsMemo = new Map();
  const barsOf = (sym, tf) => {
    const k = `${sym}|${tf}`;
    if (!barsMemo.has(k)) {
      const m = reg.get(String(sym).toUpperCase())?.market || null;
      barsMemo.set(k, scanBars(hist, sym, { timeframe: tf, market: m, now: clockNow, calendar: calFor(m) }));
    }
    return barsMemo.get(k);
  };
  const lastBar = (sym) => { const b = barsOf(sym, '1D'); return b.dates[b.dates.length - 1] || null; };
  /* The newest bar any series holds: the yardstick a lagging series is
     measured against. It is not the bar anything was evaluated on. */
  const newest = Object.keys(hist?.series || {}).map(lastBar).filter(Boolean).sort().pop() || null;
  const staleSeen = new Set(), provSeen = new Set(), evaluatedMarkets = new Set();
  const evaluatedBars = [];
  for (const raw of setups || []) {
    if (!raw || raw.enabled === false) continue;
    const s = scanNormaliseSetup(raw);
    if (!s.id) { out.skipped.push({ setup: s.name || '(unnamed)', why: 'no id' }); continue; }
    const tf = SCAN_TIMEFRAMES[s.timeframe];
    if (!tf || !tf.built) { out.skipped.push({ setup: s.id, why: `timeframe “${raw.timeframe}” is not built — ${tf ? tf.reason : 'the built timeframes are 1D and 1W'}` }); continue; }
    out.setups++;
    const symbols = scanUniverse(s, hist, instruments);
    const gaps = scanUniverseGaps(s, hist, instruments);
    if (!symbols.length) { out.skipped.push({ setup: s.id, why: `no instrument in its universe has a series${gaps.missing.length ? ` (${gaps.missing.join(', ')})` : ''}` }); continue; }
    gaps.missing.forEach(sym => out.skipped.push({ setup: s.id, symbol: sym, why: 'no series in the price history' }));
    gaps.unplaced.forEach(sym => out.skipped.push({ setup: s.id, symbol: sym, why: 'not in data/instruments.json, so it has no market to be scanned under' }));
    let looked = 0, blind = 0;
    const reasons = [];
    for (const sym of symbols) {
      const bars = barsOf(sym, s.timeframe);
      let at = bars.dates.length - 1;
      if (at >= 0 && bars.status[at] === 'PROVISIONAL') {
        const pbar = bars.dates[at];
        while (at >= 0 && bars.status[at] === 'PROVISIONAL') at--;
        const pk = `${sym}|${s.timeframe}`;
        if (!provSeen.has(pk)) {
          provSeen.add(pk);
          out.provisional.push({ symbol: sym, timeframe: s.timeframe, bar: pbar,
            why: `the ${pbar} ${s.timeframe === '1W' ? 'week is not complete' : 'bar was captured before its session closed and settled'}, so it is provisional${at >= 0 ? `; the bar of ${bars.dates[at]} was evaluated instead` : ''}` });
        }
      }
      if (at < 1) {
        out.skipped.push({ setup: s.id, symbol: sym, why: 'fewer than two bars' });
        looked++; blind++;
        if (!reasons.includes('fewer than two bars')) reasons.push('fewer than two bars');
        continue;
      }
      const bar = bars.dates[at];
      if (s.expires && bar > s.expires) { out.skipped.push({ setup: s.id, symbol: sym, why: `expired ${s.expires}` }); continue; }
      out.evaluated++;
      looked++;
      evaluatedBars.push(bar);
      evaluatedMarkets.add(bars.market ? String(bars.market).toUpperCase() : null);
      if (newest && !staleSeen.has(sym)) {
        const behind = scanDayDiff(bar, newest);
        /* Ten calendar days clears a long holiday closure; a series further
           behind than that was not updated, and its "last bar" is old news. */
        if (behind > 10) { staleSeen.add(sym); out.stale.push({ symbol: sym, bar, why: `last bar ${bar} is ${behind} days behind the newest bar in the history (${newest})` }); }
      }
      const r = scanEvaluate(s.ruleTree, bars, { at, cache: C });
      if (r.state === 'UNAVAILABLE') {
        out.untested++;
        blind++;
        const texts = [...new Set(r.conditions.filter(x => x.state === 'UNAVAILABLE').map(x => x.text))];
        const why = texts.join('; ') || r.reason?.text || 'could not be evaluated';
        out.untestedList.push({ setup: s.id, symbol: sym, why });
        /* The reason without this instrument's bar count or name, so one
           line can stand for the whole universe. */
        texts.forEach(t => {
          const g = t.replace(/; \d+ held$/, '').replace(/^its last final bar is \d{4}-\d{2}-\d{2}, and the session of (\d{4}-\d{2}-\d{2}) should be held by now/, 'the last final bar is older than the session of $1, which should be held by now');
          if (!reasons.includes(g)) reasons.push(g);
        });
      }
      if (r.state !== 'MET') continue;
      out.matched++;
      let eventType = 'MATCH';
      if (s.cooldownMode === 'NEW_MATCH') {
        const prev = scanEvaluate(s.ruleTree, bars, { at: at - 1, cache: C });
        if (prev.state === 'MET') {
          out.continuing++;
          out.skipped.push({ setup: s.id, symbol: sym, why: `still matching since the bar before (${bars.dates[at - 1]}) — a NEW_MATCH setup records only the bar a match begins` });
          continue;
        }
        eventType = prev.state === 'NOT_MET' ? 'NEW_MATCH' : 'FIRST_OBSERVED';
      }
      const SYM = String(sym).toUpperCase();
      const instrumentId = bars.instrumentId;
      const key = scanKey(s.id, s.version, instrumentId || sym, s.timeframe, bar, eventType);
      const forms = [key, scanKey(s.id, s.version, sym, s.timeframe, bar, eventType)];
      if (s.version === 1 && s.timeframe === '1D') forms.push(scanLegacyKey(s.id, sym, bar));
      if (forms.some(k => seen.has(k))) { out.deduped++; out.skipped.push({ setup: s.id, symbol: sym, why: 'already recorded for this bar' }); continue; }
      /* Cooldown counts BARS of this instrument, not days: a holiday is not
         a bar. Counted as the bars held after the previous alert's bar, so a
         bar removed from the history does not lose the cooldown. */
      const ck = cdKey(s.id, s.version, SYM, s.timeframe);
      const prevBar = lastBy.get(ck);
      if (s.cooldownBars > 0 && prevBar) {
        let since = 0;
        for (let j = 0; j <= at; j++) if (bars.dates[j] > prevBar) since++;
        if (since <= s.cooldownBars) { out.cooldown++; out.skipped.push({ setup: s.id, symbol: sym, why: `within the ${s.cooldownBars}-bar cooldown of ${prevBar}` }); continue; }
      }
      const snapshot = { id: s.id, version: s.version, hash: s.hash, name: s.name, timeframe: s.timeframe, universe: s.universe,
                         confirmationMode: s.confirmationMode, cooldownMode: s.cooldownMode, cooldownBars: s.cooldownBars, expires: s.expires, ruleTree: s.ruleTree };
      const rec = {
        id: scanAlertId(key), key, setupId: s.id, setupName: s.name || s.id, setupVersion: s.version, setupHash: s.hash, setupSnapshot: snapshot,
        instrumentId, symbol: sym, market: bars.market, timeframe: s.timeframe, candleDate: bar, detectedAt: now || null,
        eventType, cooldownMode: s.cooldownMode, close: bars.closes[at], barStatus: bars.status[at] || 'UNKNOWN',
        matchedConditions: r.conditions.map(c => ({ path: c.path, text: c.text, state: c.state, left: c.leftValue, right: c.rightValue,
          leftLabel: c.leftLabel, rightLabel: c.rightLabel, status: c.state === 'UNAVAILABLE' ? (c.left?.status || 'INVALID_INPUT') : 'VALID', reason: c.reason?.code || null })),
        dataSourceId: hist?.meta?.[sym]?.[bar]?.src || hist?.source || 'personal-history',
        dataVersion: scanDataVersion(bars, at), runId, origin, engine: out.engine,
        /* 0.2 names, kept for one release: the page and ingest/daily.mjs read them. */
        bar, rules: r.conditions.map(c => ({ text: c.text, met: c.met })), recordedAt: now || null,
      };
      out.alerts.push(rec);
      forms.forEach(k => seen.add(k));
      lastBy.set(ck, bar);
    }
    /* A setup none of whose instruments could be tested is a configuration
       problem, not a quiet day. Expired pairs are not counted: they were
       never evaluated, and are reported per instrument. */
    if (looked > 0 && blind === looked) out.untestedEverywhere.push({ setup: s.id, why: reasons.slice(0, 3).join('; ') || 'no rule could be tested' });
  }
  /* The run's as-of is the range of bars actually evaluated — each pair is
     evaluated on its own instrument's last final bar. */
  const sortedBars = evaluatedBars.sort();
  out.asOf = sortedBars[sortedBars.length - 1] || null;
  out.asOfFrom = sortedBars[0] || null;
  out.newestInHistory = newest;
  /* Readiness covers every market the history holds; `inRun` marks the ones
     this run evaluated an instrument of, which is what a page lists. */
  out.readiness = clockNow ? scanReadiness(hist, instruments, clockNow, { calendars: calFor, barsOf: (sym) => barsOf(sym, '1D') }) : null;
  if (out.readiness) out.readiness.markets.forEach(m => { m.inRun = evaluatedMarkets.has(m.market); });
  out.cacheStats = { hits: C.stats.hits, misses: C.stats.misses };
  return out;
}

/* ------------------------------------------------------ historical testing -- */
/* HISTORICAL MATCHES — A SIMULATION, NOT A BACKTEST. The same evaluator at
   every completed bar of the reader's own history: the bars on which the
   conditions held, the bars a match began, and what the worker's dedupe and
   cooldown would have recorded. No entry, exit, cost or return exists here,
   because performance needs point-in-time adjusted data and stated
   assumptions this product does not hold. Every indicator is causal, so the
   row for bar i is the row a run on the history ending at i would have
   produced — scanner-test pins that. No clock is applied: staleness is a
   property of a live run, not of the past. */
const SCAN_SIMULATION_NOTE = 'A simulation on the closes you captured. It lists the bars on which your conditions held; it has no entries, exits, costs or slippage, so it shows no return. Closes are not adjusted for splits or dividends. Your universe is the instruments you track today, so anything you stopped tracking is absent. None of this is a guarantee, and no indicator here is claimed to work.';
function scanHistorical(setup, history, { symbols = null, from = null, to = null, maxBars = 600, instruments = [], cache = null } = {}) {
  const s = scanNormaliseSetup(setup || {});
  const C = cache || scanCache();
  const reg = scanRegistry(instruments);
  const out = { engine: `scan ${SCAN_VERSION}`, simulation: true, note: SCAN_SIMULATION_NOTE,
                setupId: s?.id ?? null, setupVersion: s?.version ?? null, setupHash: s?.hash ?? null, timeframe: s?.timeframe ?? null,
                cooldownMode: s?.cooldownMode ?? null, cooldownBars: s?.cooldownBars ?? 0, from, to, maxBars,
                universe: [], coverage: [], matches: [], events: [], recorded: [], missingSessions: [], skipped: [],
                counts: { symbols: 0, evaluatedBars: 0, matchedBars: 0, events: 0, recorded: 0, unavailableBars: 0 } };
  const tf = SCAN_TIMEFRAMES[s?.timeframe];
  if (!tf || !tf.built) { out.skipped.push({ why: `timeframe “${s?.timeframe}” is not built${tf ? ` — ${tf.reason}` : ''}` }); return out; }
  const have = Object.keys(history?.series || {});
  const universe = symbols
    ? have.filter(h => symbols.map(x => String(x).toUpperCase()).includes(String(h).toUpperCase()))
    : scanUniverse(s, history, instruments);
  out.universe = universe;
  const cals = new Map();
  const calFor = (m) => { const k = m || ''; if (!cals.has(k)) cals.set(k, scanCalendar(history, instruments, m)); return cals.get(k); };
  for (const sym of universe) {
    const market = reg.get(String(sym).toUpperCase())?.market || null;
    const bars = scanBars(history, sym, { timeframe: s.timeframe, market, calendar: calFor(market) });
    const n = bars.dates.length;
    let lo = 0, hi = n - 1;
    if (from) while (lo < n && bars.dates[lo] < from) lo++;
    if (to) while (hi >= 0 && bars.dates[hi] > to) hi--;
    if (hi - lo + 1 > maxBars) lo = hi - maxBars + 1;
    const cov = { symbol: sym, market, calendar: bars.calendar?.basis || null, bars: n, first: bars.dates[0] || null, last: bars.dates[n - 1] || null,
                  from: bars.dates[lo] || null, to: bars.dates[hi] || null, evaluated: 0, unavailable: 0, matched: 0, testableFrom: null,
                  invalid: bars.invalid.length, missingSessions: [] };
    let prevState = lo > 0 && lo <= hi ? scanEvaluate(s.ruleTree, bars, { at: lo - 1, cache: C }).state : 'UNAVAILABLE';
    let lastRec = null;
    for (let i = lo; i <= hi; i++) {
      if ((bars.gapBefore[i] || 0) > 0) {
        const m = { symbol: sym, after: bars.dates[i - 1], before: bars.dates[i], sessions: bars.gapBefore[i], tolerated: bars.gapBefore[i] <= (bars.gapTolerance ?? 0) };
        cov.missingSessions.push(m); out.missingSessions.push(m);
      }
      const r = scanEvaluate(s.ruleTree, bars, { at: i, cache: C });
      cov.evaluated++;
      if (r.state === 'UNAVAILABLE') cov.unavailable++;
      else if (!cov.testableFrom) cov.testableFrom = bars.dates[i];
      if (r.state === 'MET') {
        cov.matched++;
        out.matches.push({ symbol: sym, bar: bars.dates[i], close: bars.closes[i], barStatus: r.barStatus,
          conditions: r.conditions.map(c => ({ path: c.path, text: c.text, state: c.state, left: c.leftValue, right: c.rightValue })) });
        const ev = prevState === 'NOT_MET' ? 'NEW_MATCH' : prevState === 'UNAVAILABLE' ? 'FIRST_OBSERVED' : null;
        if (ev) out.events.push({ symbol: sym, bar: bars.dates[i], close: bars.closes[i], eventType: ev });
        const recordable = s.cooldownMode === 'EVERY_MATCH' ? 'MATCH' : ev;
        if (recordable && !(s.cooldownBars > 0 && lastRec != null && i - lastRec <= s.cooldownBars)) {
          out.recorded.push({ symbol: sym, bar: bars.dates[i], close: bars.closes[i], eventType: recordable });
          lastRec = i;
        }
      }
      prevState = r.state;
    }
    out.coverage.push(cov);
  }
  out.counts = { symbols: universe.length, evaluatedBars: out.coverage.reduce((t, c) => t + c.evaluated, 0), matchedBars: out.matches.length,
                 events: out.events.length, recorded: out.recorded.length, unavailableBars: out.coverage.reduce((t, c) => t + c.unavailable, 0) };
  out.cacheStats = { hits: C.stats.hits, misses: C.stats.misses };
  return out;
}

/* -------------------------------------------------------------- data health -- */
/* Everything the data-health page shows, from the history file alone:
   per market, the session expected by now and which series hold it; per
   series, the bars, the invalid ones with their codes, the gaps against the
   calendar (inferred or weekday), the close-to-close breaks, the volume
   coverage and whether it sits at the ingest's 500-point keep. In market
   order, then symbol order — neutral, not ranked. */
function scanDataHealth(history, instruments, now) {
  const reg = scanRegistry(instruments);
  const syms = Object.keys(history?.series || {});
  const groups = new Map();
  syms.forEach(sym => { const m = reg.get(String(sym).toUpperCase())?.market || null; const k = m ? String(m).toUpperCase() : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sym); });
  const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : a > b ? 1 : 0));
  const markets = [], series = [];
  const totals = { series: syms.length, bars: 0, invalid: 0, gaps: 0, jumps: 0, stale: 0, provisional: 0 };
  const clock = now != null && Number.isFinite(scanMs(now));
  order.forEach(k => {
    const market = k || null;
    const cal = scanCalendar(history, instruments, market);
    const M = scanMarket(market);
    const expected = clock ? scanExpectedLastSession(cal, market, now) : null;
    let newestBar = null;
    const staleSymbols = [];
    [...groups.get(k)].sort().forEach(sym => {
      const raw = history.series[sym] || {};
      const keys = Object.keys(raw);
      const dropped = { badDate: keys.filter(d => !scanIsDay(d)).length,
                        nonFinite: keys.filter(d => !(typeof raw[d] === 'number' && Number.isFinite(raw[d]))).length,
                        nonPositive: keys.filter(d => typeof raw[d] === 'number' && Number.isFinite(raw[d]) && raw[d] <= 0).length };
      const b = scanBars(history, sym, { market, now: clock ? now : null, calendar: cal });
      const n = b.dates.length;
      const last = b.dates[n - 1] || null;
      if (last && (!newestBar || last > newestBar)) newestBar = last;
      const gaps = [];
      for (let i = 1; i < n; i++) if (b.gapBefore[i] > 0) {
        gaps.push({ after: b.dates[i - 1], before: b.dates[i], sessions: b.gapBefore[i], counted: b.gapBefore[i] > b.gapTolerance,
                    kind: cal.basis === 'inferred' ? 'others-in-market-have-bars' : 'no-calendar' });
      }
      const jumps = scanPriceBreaks(b);
      const statusCounts = { FINAL: 0, PROVISIONAL: 0, UNKNOWN: 0, CORRECTED: 0 };
      b.status.forEach(x => { statusCounts[x] = (statusCounts[x] || 0) + 1; });
      if (b.stale) staleSymbols.push(sym);
      const withVol = b.volumes.filter(scanOk).length;
      series.push({ symbol: sym, market, bars: n, first: b.dates[0] || null, last, hasOHLC: b.hasOHLC,
                    volumeCoverage: n ? withVol / n : 0, invalid: b.invalid, dropped, gaps, jumps, statusCounts,
                    stale: b.stale, behindSessions: b.stale ? b.stale.sessionsBehind : 0, atKeepLimit: keys.length >= 500, dataVersion: b.dataVersion });
      totals.bars += n; totals.invalid += b.invalid.length; totals.gaps += gaps.filter(g => g.counted).length; totals.jumps += jumps.length;
      totals.stale += b.stale ? 1 : 0; totals.provisional += statusCounts.PROVISIONAL;
    });
    markets.push({ market, label: market ? (SCAN_MARKETS[market]?.label || market) : 'no market row', tz: M.tz,
                   session: M.open ? `${M.open}–${M.close} local${M.breaks?.length ? `, break ${M.breaks.map(x => x.join('–')).join(', ')}` : ''}` : `close ${M.close} ${M.tz}`,
                   settleMin: M.settleMin, calendar: { basis: cal.basis, text: cal.text, series: cal.series, inferredHolidays: cal.inferredHolidays, ambiguous: cal.ambiguous },
                   symbols: groups.get(k).length, newestBar, expected, staleSymbols, ready: expected ? staleSymbols.length === 0 : null });
  });
  return { at: clock ? new Date(scanMs(now)).toISOString() : null, engine: `scan ${SCAN_VERSION}`,
           file: { schema: history?.schema ?? 1, generated: history?.generated ?? null, source: history?.source ?? null, symbols: syms.length,
                   ohlc: !!history?.ohlc, meta: !!history?.meta, corrections: !!history?.corrections },
           markets, series, totals };
}

/* ------------------------------------------------------------------- status -- */
/* One name for a setups file as the worker would run it: the ids, versions,
   hashes and enabled flags of the setups that validate. A run records it;
   a later edit changes it, and the dashboard says the run is behind. */
function scanSetupsHash(doc) {
  const v = scanValidate(doc || { setups: [] });
  return scanHash(v.setups.map(s => `${s.id}@${s.version}:${s.hash}:${s.enabled ? 1 : 0}`).join('\n'));
}
/* THE DASHBOARD'S FOUR QUESTIONS — are my setups active, when did the last
   scan succeed, which setups matched, are notifications working — from the
   worker's files. A stale result is never called current: every reason is
   a sentence with its dates. Staleness against the clock counts calendar
   days (no exchange calendar is held), and more than four is behind. */
function scanStatus({ runs = null, alertsDoc = null, setupsDoc = null, historyMeta = null, control = null, now = null, instruments = [], alertState = null, engine = `scan ${SCAN_VERSION}` } = {}) {
  const runList = (Array.isArray(runs) ? runs : Array.isArray(runs?.runs) ? runs.runs : []).filter(r => r && (r.kind || 'scan') === 'scan');
  const alerts = Array.isArray(alertsDoc) ? alertsDoc : Array.isArray(alertsDoc?.alerts) ? alertsDoc.alerts : [];
  const lr = alertsDoc && !Array.isArray(alertsDoc) ? alertsDoc.lastRun : null;
  /* Before the run log existed, the alerts file's lastRun was the only
     record of a success; it is read as one. */
  const legacy = lr ? { id: null, kind: 'scan', status: 'COMPLETED', trigger: null, startedAt: lr.at || null, finishedAt: lr.at || null, engine: lr.engine || null,
                        asOf: lr.asOf || null, asOfFrom: lr.asOfFrom || null, setupsHash: lr.setupsHash || null, recorded: lr.recorded ?? null, legacy: true } : null;
  const byTime = [...runList].sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const lastAttempt = byTime[byTime.length - 1] || legacy;
  const lastSuccess = [...byTime].reverse().find(r => r.status === 'COMPLETED' || r.status === 'PARTIAL') || legacy;
  const today = now != null && Number.isFinite(scanMs(now)) ? new Date(scanMs(now)).toISOString().slice(0, 10) : null;
  const v = setupsDoc ? scanValidate(setupsDoc) : { setups: [], problems: [] };
  const active = { valid: v.setups.length, enabled: v.setups.filter(s => s.enabled).length, disabled: v.setups.filter(s => !s.enabled).length,
                   expired: v.setups.filter(s => s.enabled && s.expires && today && s.expires < today).length, refused: v.problems.length };
  const histSyms = Array.isArray(historyMeta?.symbols) ? historyMeta.symbols : null;
  let monitored = null;
  if (histSyms) {
    const h = { series: Object.fromEntries(histSyms.map(sym => [sym, {}])) };
    const inst = new Set(), missing = new Set(), unplaced = new Set();
    v.setups.filter(s => s.enabled).forEach(s => {
      scanUniverse(s, h, instruments).forEach(x => inst.add(x));
      const g = scanUniverseGaps(s, h, instruments);
      g.missing.forEach(x => missing.add(x)); g.unplaced.forEach(x => unplaced.add(x));
    });
    monitored = { instruments: inst.size, withSeries: inst.size, missing: [...missing], unplaced: [...unplaced] };
  }
  const reasons = [];
  let state = 'current';
  const day = (t) => (t ? String(t).slice(0, 10) : '—');
  if (!lastAttempt) { state = 'never'; reasons.push('No scan has been recorded on this machine: neither a run log nor a last run in the alerts file.'); }
  if (control?.paused) { if (state !== 'never') state = 'paused'; reasons.push(`The worker is paused${control.since ? ` since ${day(control.since)}` : ''}${control.reason ? `: ${control.reason}` : ''}.`); }
  if (lastAttempt && lastAttempt.status === 'FAILED') {
    if (state === 'current') state = 'failed';
    reasons.push(`The latest attempt${lastAttempt.id ? ` (${lastAttempt.id})` : ''} on ${day(lastAttempt.startedAt)} failed${lastAttempt.error?.message ? `: ${lastAttempt.error.message}` : ''}.`);
  }
  if (lastSuccess) {
    const behind = [];
    const newestBar = historyMeta?.newestBar || null;
    if (newestBar && lastSuccess.asOf && lastSuccess.asOf < newestBar) behind.push(`The last scan ran ${day(lastSuccess.finishedAt || lastSuccess.startedAt)} on bars of ${lastSuccess.asOf}; your history's newest bar is ${newestBar}.`);
    if (setupsDoc && lastSuccess.setupsHash && lastSuccess.setupsHash !== scanSetupsHash(setupsDoc)) behind.push('Your setups changed after the last scan ran, so its result is for setups that no longer stand as written.');
    if (lastSuccess.engine && lastSuccess.engine !== engine) behind.push(`The last scan ran on ${lastSuccess.engine}; this page runs ${engine}.`);
    if (newestBar && today) {
      const age = scanDayDiff(newestBar, today);
      if (age > 4) behind.push(`Your history's newest bar is ${age} days old. No exchange calendar is held, so this counts calendar days; more than four (a weekend and a day) is behind.`);
    }
    if (behind.length && state === 'current') state = 'behind';
    reasons.push(...behind);
  } else if (lastAttempt && state === 'current') state = 'failed';
  const order = new Map(v.setups.map((s, i) => [s.id, i]));
  const rank = (a) => (order.has(a.setupId) ? order.get(a.setupId) : order.size);
  const barOf = (a) => a.candleDate || a.bar || '';
  const latestMatches = lastSuccess?.asOf ? alerts.map((a, i) => ({ a, i })).filter(x => barOf(x.a) === lastSuccess.asOf)
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i).map(x => x.a) : [];
  const recentBars = [...new Set(alerts.map(barOf).filter(Boolean))].sort().reverse().slice(0, 5);
  const recent = alerts.map((a, i) => ({ a, i })).filter(x => recentBars.includes(barOf(x.a)))
    .sort((x, y) => barOf(y.a).localeCompare(barOf(x.a)) || rank(x.a) - rank(y.a) || x.i - y.i).map(x => x.a);
  const unread = alertState ? alerts.filter(a => !alertState[a.id || a.key]).length : null;
  return { state, reasons, active, monitored, lastSuccess, lastAttempt, latestMatches, recent, engine,
           notifications: { channel: 'none', text: 'No channel exists: alerts are recorded in a file on this machine and shown in the app; nothing is sent.', inApp: { unread } } };
}

/* -------------------------------------------------------------------- drift -- */
/* The setups this browser holds against the setups file the worker reads.
   Pure: the pages say what to do about it. */
function scanSetupDrift(browserSetups, fileDoc) {
  const norm = (list) => new Map((Array.isArray(list) ? list : []).filter(s => s && typeof s === 'object' && s.id && !s.deleted).map(s => [s.id, scanNormaliseSetup(s)]));
  const fileList = Array.isArray(fileDoc) ? fileDoc : Array.isArray(fileDoc?.setups) ? fileDoc.setups : [];
  const B = norm(browserSetups), F = norm(fileList);
  const out = { onlyInBrowser: [], onlyInFile: [], differ: [], same: [] };
  B.forEach((b, id) => {
    const f = F.get(id);
    if (!f) { out.onlyInBrowser.push(id); return; }
    if (b.hash === f.hash && b.version === f.version && b.enabled === f.enabled) { out.same.push(id); return; }
    out.differ.push({ id, browserVersion: b.version, fileVersion: f.version, browserHash: b.hash, fileHash: f.hash,
                      rulesDiffer: b.hash !== f.hash, enabledDiffers: b.enabled !== f.enabled,
                      newer: b.version > f.version ? 'browser' : f.version > b.version ? 'file' : 'unknown' });
  });
  F.forEach((f, id) => { if (!B.has(id)) out.onlyInFile.push(id); });
  out.inSync = !out.onlyInBrowser.length && !out.onlyInFile.length && !out.differ.length;
  return out;
}
/* A watchlist snapshot against the list as it stands now. */
function scanSnapshotDrift(symbols, currentSymbols) {
  const up = (a) => (Array.isArray(a) ? a : []).map(x => String(x).toUpperCase());
  const snap = up(symbols), cur = up(currentSymbols);
  const S = new Set(snap), C = new Set(cur);
  const added = [...new Set(cur.filter(x => !S.has(x)))], removed = [...new Set(snap.filter(x => !C.has(x)))];
  return { added, removed, kept: [...new Set(snap.filter(x => C.has(x)))], same: !added.length && !removed.length };
}

/* ------------------------------------------------------------------ fixture -- */
/* The fixture every run self-tests against. Sixty-odd sessions of a
   flat-ish series, then a rise that carries price above its 50-bar EMA on
   the last bar with volume at twice its average and RSI inside 50–70 — and
   a second instrument that does none of that. Dated on weekdays from Monday
   5 January 2026, so every bar is a session of the weekday calendar. The
   expected answer is that ONE alert exists, for MATCH on its last bar. */
function scanFixture() {
  const closes = [], vols = [];
  for (let i = 0; i < 60; i++) { closes.push(100 + Math.sin(i / 3) * 1.5); vols.push(1000); }
  /* A drift down, then a last bar that jumps through the average on volume. */
  for (let i = 0; i < 5; i++) { closes.push(97.5 - i * 0.3); vols.push(1000); }
  closes.push(104.5); vols.push(2200);
  const flat = closes.map(() => 100), flatV = vols.map(() => 1000);
  const dates = [];
  for (let d = '2026-01-05'; dates.length < closes.length; d = scanAddDays(d, 1)) if (scanWeekday(d) >= 1 && scanWeekday(d) <= 5) dates.push(d);
  const series = (arr) => Object.fromEntries(dates.map((d, i) => [d, arr[i]]));
  const history = { series: { MATCH: series(closes), FLAT: series(flat) }, volume: { MATCH: series(vols), FLAT: series(flatV) } };
  /* The 0.2 form, as a setups file written before this version holds it. */
  const setup = { id: 'fixture-breakout', name: 'Fixture breakout', enabled: true, universe: { kind: 'all' }, timeframe: 'daily',
    confirmation: 'close', logic: 'AND', cooldownBars: 5, expires: null,
    rules: [
      { left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } },
      { left: { indicator: 'volume' }, op: 'above', right: { indicator: 'volume_avg', n: 20, multiplier: 1.5 } },
      { left: { indicator: 'rsi', n: 14 }, op: 'between', range: [50, 70] },
    ] };
  /* The same conditions as a V2 tree, NEW_MATCH, with a nested ANY group. */
  const setupV2 = { id: 'fixture-breakout-v2', version: 1, name: 'Fixture breakout (tree)', enabled: true, universe: { kind: 'all' }, timeframe: '1D',
    confirmationMode: 'BAR_CLOSE', cooldownMode: 'NEW_MATCH', cooldownBars: 5, expires: null,
    ruleTree: { type: 'group', logic: 'ALL', children: [
      { type: 'condition', left: { indicator: 'price' }, op: 'CROSSES_ABOVE', right: { indicator: 'ema', n: 50 } },
      { type: 'group', logic: 'ANY', children: [
        { type: 'condition', left: { indicator: 'volume' }, op: 'GREATER_THAN', right: { indicator: 'volume_avg', n: 20, multiplier: 1.5 } },
        { type: 'condition', left: { indicator: 'rvol', n: 20 }, op: 'GREATER_THAN', right: { value: 1.5 } },
      ] },
      { type: 'condition', left: { indicator: 'rsi', n: 14 }, op: 'BETWEEN', range: [{ value: 50 }, { value: 70 }] },
    ] } };
  const lastBar = dates[dates.length - 1];
  return { history, setup, setupV2, lastBar, now: scanReplayNow(lastBar) };
}

/* Extraction by marker can fail silently, so every worker run proves the
   engine it sliced reproduces the fixture: one alert for MATCH on the last
   bar under the new key; none on a second pass; none against the 0.2 key
   of the same bar; a NEW_MATCH for the tree form; and nothing at all when
   the same history is judged from a clock months later (stale). */
function scanSelfTest() {
  const { history, setup, setupV2, lastBar, now } = scanFixture();
  const r = scanRun([setup], history, { now, runId: 'self-test', origin: 'self-test' });
  const a = r.alerts[0];
  const key = scanKey('fixture-breakout', 1, 'MATCH', '1D', lastBar, 'MATCH');
  const ok = r.alerts.length === 1 && !!a && a.symbol === 'MATCH' && a.bar === lastBar && a.candleDate === lastBar && a.key === key
    && a.id === scanAlertId(key) && a.matchedConditions.length === 3 && a.matchedConditions.every(x => x.state === 'MET') && a.rules.every(x => x.met === true);
  const again = scanRun([setup], history, { existing: r.alerts, now });
  const legacy = scanRun([{ ...setup, cooldownBars: 0 }], history, { existing: [{ key: scanLegacyKey('fixture-breakout', 'MATCH', lastBar), setupId: 'fixture-breakout', symbol: 'MATCH', bar: lastBar }], now });
  const tree = scanRun([setupV2], history, { now });
  const stale = scanRun([setup], history, { now: `${scanAddDays(lastBar, 120)}T12:00:00Z` });
  const treeOk = tree.alerts.length === 1 && tree.alerts[0].eventType === 'NEW_MATCH' && tree.alerts[0].symbol === 'MATCH';
  return { ok: ok && again.alerts.length === 0 && legacy.alerts.length === 0 && treeOk && stale.alerts.length === 0,
           alerts: r.alerts.length, again: again.alerts.length, legacy: legacy.alerts.length, tree: tree.alerts.length, stale: stale.alerts.length,
           symbol: a?.symbol, bar: a?.bar, key: a?.key, rules: a?.rules?.map(x => x.text) };
}
/* @scan-engine-end — everything above is pure; the page begins in 86-scanner.js. */
