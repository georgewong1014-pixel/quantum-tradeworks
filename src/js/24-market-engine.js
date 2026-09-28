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
   "now" is handed it. The only module-level state is memo tables (a date
   formatter per time zone, a session lookup per calendar, what a date
   string’s weekday and day arithmetic come to, the quoted precision of a
   series, the daily bars and calendar a series was read from, and the
   weekly or monthly bars built from them for a condition read there),
   which change no answer.

   WHAT IT DOES NOT KNOW. No exchange calendar is held — a maintained one
   comes with a licensed feed — so sessions are inferred from the reader's
   own history and labelled as inferred. No corporate-action feed is held:
   a split shows as a price break, and closes are adjusted only for the
   actions the reader records (data/price-adjustments.json), on read — an
   indicator is not computed across a break nobody has explained. No
   finality flag comes with a screen capture, so a bar is FINAL only when
   its capture time is recorded and falls after the session's close plus a
   settle margin; a bar with no capture time is UNKNOWN, and the record
   says so.

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
   the weekdays sessions fall on (0 = Sunday). Half-days and holidays are
   not held.

   The rows after CRYPTO are the other registry markets, added with the
   ingest (round 2) because a reading cannot be dated without them: a
   screen captured at 18:30 in Kuala Lumpur shows Monday's close for Tokyo
   and Sydney, an in-progress Monday for London, and Friday's close for New
   York, and only each exchange's own zone and hours can say which. The
   hours are the exchanges' published regular sessions, typed by hand —
   not a maintained calendar — and each errs late rather than early: a
   close later than the real one only delays the moment a bar is called
   final, while one earlier would call an auction price final. `breaks` is
   filled only where the midday break is certain; nothing reads it yet.
   Commodities (COM) trade nearly round the clock and have no session a
   screen reading could close, so they stay on _default: weekdays, and a
   close at the end of the UTC day. */
const SCAN_MARKETS = {
  US: { code: 'US', label: 'United States', tz: 'America/New_York', open: '09:30', close: '16:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  MY: { code: 'MY', label: 'Bursa Malaysia', tz: 'Asia/Kuala_Lumpur', open: '09:00', close: '17:00', breaks: [['12:30', '14:30']], days: [1, 2, 3, 4, 5], settleMin: 30 },
  FX: { code: 'FX', label: 'Currency pairs', tz: 'America/New_York', open: null, close: '17:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 0 },
  CRYPTO: { code: 'CRYPTO', label: 'Crypto', tz: 'UTC', open: null, close: '24:00', breaks: [], days: [0, 1, 2, 3, 4, 5, 6], settleMin: 0 },
  AU: { code: 'AU', label: 'Australia (ASX)', tz: 'Australia/Sydney', open: '10:00', close: '16:15', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  NZ: { code: 'NZ', label: 'New Zealand (NZX)', tz: 'Pacific/Auckland', open: '10:00', close: '16:45', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  JP: { code: 'JP', label: 'Japan (TSE)', tz: 'Asia/Tokyo', open: '09:00', close: '15:30', breaks: [['11:30', '12:30']], days: [1, 2, 3, 4, 5], settleMin: 30 },
  HK: { code: 'HK', label: 'Hong Kong (HKEX)', tz: 'Asia/Hong_Kong', open: '09:30', close: '16:10', breaks: [['12:00', '13:00']], days: [1, 2, 3, 4, 5], settleMin: 30 },
  CN: { code: 'CN', label: 'China (SSE)', tz: 'Asia/Shanghai', open: '09:30', close: '15:00', breaks: [['11:30', '13:00']], days: [1, 2, 3, 4, 5], settleMin: 30 },
  KR: { code: 'KR', label: 'Korea (KRX)', tz: 'Asia/Seoul', open: '09:00', close: '15:30', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  TW: { code: 'TW', label: 'Taiwan (TWSE)', tz: 'Asia/Taipei', open: '09:00', close: '13:30', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  IN: { code: 'IN', label: 'India (NSE)', tz: 'Asia/Kolkata', open: '09:15', close: '15:30', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  SG: { code: 'SG', label: 'Singapore (SGX)', tz: 'Asia/Singapore', open: '09:00', close: '17:15', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  TH: { code: 'TH', label: 'Thailand (SET)', tz: 'Asia/Bangkok', open: '10:00', close: '16:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  ID: { code: 'ID', label: 'Indonesia (IDX)', tz: 'Asia/Jakarta', open: '09:00', close: '16:15', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  PH: { code: 'PH', label: 'Philippines (PSE)', tz: 'Asia/Manila', open: '09:30', close: '15:15', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  VN: { code: 'VN', label: 'Vietnam (HOSE)', tz: 'Asia/Ho_Chi_Minh', open: '09:00', close: '15:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  GB: { code: 'GB', label: 'United Kingdom (LSE)', tz: 'Europe/London', open: '08:00', close: '16:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  DE: { code: 'DE', label: 'Germany (Xetra)', tz: 'Europe/Berlin', open: '09:00', close: '17:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  FR: { code: 'FR', label: 'France (Euronext Paris)', tz: 'Europe/Paris', open: '09:00', close: '17:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  EU: { code: 'EU', label: 'Euro area (STOXX)', tz: 'Europe/Berlin', open: '09:00', close: '18:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  ES: { code: 'ES', label: 'Spain (BME)', tz: 'Europe/Madrid', open: '09:00', close: '17:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  IT: { code: 'IT', label: 'Italy (Borsa Italiana)', tz: 'Europe/Rome', open: '09:00', close: '17:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  NL: { code: 'NL', label: 'Netherlands (Euronext Amsterdam)', tz: 'Europe/Amsterdam', open: '09:00', close: '17:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  CH: { code: 'CH', label: 'Switzerland (SIX)', tz: 'Europe/Zurich', open: '09:00', close: '17:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  SE: { code: 'SE', label: 'Sweden (Nasdaq Stockholm)', tz: 'Europe/Stockholm', open: '09:00', close: '17:40', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  CA: { code: 'CA', label: 'Canada (TSX)', tz: 'America/Toronto', open: '09:30', close: '16:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  BR: { code: 'BR', label: 'Brazil (B3)', tz: 'America/Sao_Paulo', open: '10:00', close: '18:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  MX: { code: 'MX', label: 'Mexico (BMV)', tz: 'America/Mexico_City', open: '08:30', close: '15:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 30 },
  _default: { code: '_default', label: 'Other markets', tz: 'UTC', open: null, close: '24:00', breaks: [], days: [1, 2, 3, 4, 5], settleMin: 0, calendar: 'weekday-only' },
};
const scanMarket = (m) => SCAN_MARKETS[String(m || '').toUpperCase()] || SCAN_MARKETS._default;
const scanHm = (s) => { const [h, m] = String(s || '24:00').split(':').map(Number); return h * 60 + (m || 0); };
const SCAN_ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/* Dates are strings, and a run asks about the same few thousand of them
   millions of times: a 2,000-instrument universe of 500 bars validates,
   weekdays and steps through a million dates, and every answer built a
   Date — most of a 2,000 × 500 run's time went there (SC-319). A date's
   weekday and its neighbours never change, so each answer is remembered by
   its string, in tables emptied when they pass a size no history reaches,
   so a long page session cannot grow them without bound. A remembered
   answer is the answer: nothing here depends on when it was asked. */
const SCAN_DAY_MEMO = { isDay: new Map(), weekday: new Map(), add: new Map(), cap: 50000 };
const scanMemo = (m, k, f) => {
  let v = m.get(k);
  if (v === undefined) { if (m.size >= SCAN_DAY_MEMO.cap) m.clear(); v = f(); m.set(k, v); }
  return v;
};
/* A key is a date only if it names a real day: '2026-02-30' is not one. */
const scanIsDay = (d) => typeof d === 'string' && scanMemo(SCAN_DAY_MEMO.isDay, d, () => SCAN_ISO_DAY.test(d)
  && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d);
const scanWeekday = (d) => scanMemo(SCAN_DAY_MEMO.weekday, d, () => new Date(`${d}T00:00:00Z`).getUTCDay());
const scanAddDays = (d, n) => scanMemo(SCAN_DAY_MEMO.add, `${d}|${n}`, () => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); });
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
/* The session day it is in a market at an instant. For most markets that is
   the local date. A market whose day opens the evening before (the 24-hour
   FX session, spot gold: 17:00 New York) is already in the next session from
   that hour, so scanBars judged Monday's bar FUTURE from 17:00 to midnight on
   Sunday while it traded. ingest/history-store.mjs sessionToday is the same
   rule, for the store. */
function scanSessionToday(market, instant) {
  const M = scanMarket(market);
  const p = scanTzParts(scanMs(instant), M.tz);
  const close = scanHm(M.close || '24:00');
  const opens = M.open ? (scanHm(M.open) > close ? scanHm(M.open) : null) : (close < 1440 ? close : null);
  return opens != null && p.minutes >= opens ? scanAddDays(p.date, 1) : p.date;
}

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
   which is every bar the history held before schema 2.
   HELD BEFORE ITS CLOSE. `heldAt` (optional) is the instant the history is
   read at, and no bar in it can have been captured later than that. So a
   bar with no capture time, read before its own session has closed and
   settled, was captured before the close: PROVISIONAL, not UNKNOWN. An
   UNKNOWN bar is evaluated as though final once its session has closed
   (the round 1 ruling); read as UNKNOWN at 11:00 in New York, Monday's
   bar — an import made mid-session, with no capture time — was evaluated
   and recorded as a match on a session still trading. */
function scanBarStatus(market, sessionDate, capturedAt, heldAt = null) {
  const at = capturedAt == null ? NaN : scanMs(capturedAt);
  if (!scanIsDay(sessionDate)) return 'UNKNOWN';
  if (!Number.isFinite(at)) {
    const held = heldAt == null ? NaN : scanMs(heldAt);
    return Number.isFinite(held) && held < scanSessionEnd(market, sessionDate) ? 'PROVISIONAL' : 'UNKNOWN';
  }
  return at >= scanSessionEnd(market, sessionDate) ? 'FINAL' : 'PROVISIONAL';
}

/* ------------------------------------------------------------- timeframes -- */
const SCAN_INTRADAY_WHY = 'intraday data is not held — your history carries one bar per session, and intraday bars need a licensed feed (SC-317)';
const SCAN_TIMEFRAMES = {
  '1D': { id: '1D', label: 'Daily', built: true, legacy: 'daily', note: 'one bar per session, dated by the exchange session in its own time zone' },
  '1W': { id: '1W', label: 'Weekly', built: true, legacy: 'weekly', derivedFrom: '1D',
          note: 'your imported weekly bars wherever your history holds a weekly export for the instrument, and otherwise derived from your daily bars: the first open, the highest high, the lowest low, the last close and the summed volume of the week; a week is complete once its last expected session is held and final' },
  '1M': { id: '1M', label: 'Monthly', built: true, derivedFrom: '1D',
          note: 'your imported monthly bars wherever your history holds a monthly export for the instrument, and otherwise derived from your daily bars: the first open, the highest high, the lowest low, the last close and the summed volume of the calendar month; a month is complete once its last expected session is held and final' },
  '1H': { id: '1H', label: '1 hour', built: false, reason: SCAN_INTRADAY_WHY },
  '15M': { id: '15M', label: '15 minutes', built: false, reason: SCAN_INTRADAY_WHY },
  '5M': { id: '5M', label: '5 minutes', built: false, reason: SCAN_INTRADAY_WHY },
};
/* 'daily' and 'weekly' are the 0.2 names; absent is daily, as it was.
   '1M' is the month, as TradingView writes it. A lower-case '1m' is not
   read as a month: beside '5m' and '15m', which are minutes, it would be a
   minute, so it is left unknown rather than guessed. */
function scanTimeframe(tf) {
  if (tf == null || tf === '') return '1D';
  const t = String(tf).trim();
  const k = { daily: '1D', '1d': '1D', weekly: '1W', '1w': '1W', '1h': '1H', hourly: '1H', '15m': '15M', '5m': '5M' }[t.toLowerCase()];
  return k || t;
}
/* The built timeframes in order, for a condition read on a timeframe of its
   own: the setup's, or a higher one (a day is inside a week, a week is not
   inside a day). null for anything else. */
const SCAN_TF_RANK = { '1D': 0, '1W': 1, '1M': 2 };
const scanTimeframeRank = (tf) => SCAN_TF_RANK[scanTimeframe(tf)] ?? null;

/* ------------------------------------------------------------------ limits -- */
/* How big a setup may be. A rule tree deeper than three groups or wider
   than twenty conditions is not a setup anyone can read back, and a period
   past 520 bars (ten years of weeks, two of sessions) is past what the
   history keeps. */
const SCAN_LIMITS = { maxDepth: 3, maxConditions: 20, maxPeriod: 520, maxSetups: 200 };

/* ---------------------------------------------------------------- examples -- */
/* SCAN_EXAMPLES — scanner/setups.example.json, held here so the builder's
   "Start from an example" loads exactly what the committed file says (the
   round 3 contract, C7: this spot is the user pages' block, and no other
   owner edits it). The page cannot read the repository's files and the
   deployed site has none of them, so the file is copied rather than
   fetched; scanner-test fails when the two differ, so they cannot drift the
   way SCAN_EXAMPLE_DOC once did. Illustrations of the syntax, not
   suggestions: the builder labels them so, and every part of one is the
   reader's to replace. */
const SCAN_EXAMPLES = {
  _note: 'Copy this file to data/scan-setups.json (git-ignored) and edit it. Every setup is yours: the product '
    + 'proposes none, ranks none, and delivers nothing. Ids are part of every alert key, so renaming a setup '
    + 'starts its history afresh. The first four are written in the 0.2 form (logic and rules), which engine '
    + '0.3.0 reads unchanged. The fifth, trend-breakout-tree, is the 0.3 form the builder writes: a version, a '
    + 'ruleTree of ALL/ANY groups that may nest (up to three deep and twenty conditions), operands that are an '
    + 'indicator or { "value": n }, cooldownMode NEW_MATCH or EVERY_MATCH, and timeframe 1D or 1W (weekly bars '
    + 'derived from the daily ones). It holds the first setup’s conditions, so it is disabled: enabled beside '
    + 'it, both would record the same crossings. Bars are evaluated on the last final bar your history holds: a '
    + 'bar captured before its session closed is provisional and never confirms a match, and a history behind '
    + 'the session expected by now is stale and is reported as untested. A watchlist universe carries the '
    + 'symbols the page snapshotted when the setup was saved — the worker cannot read a browser; with '
    + '"resolve": "export" the worker resolves the list from data/watchlists.json (the watchlists page’s '
    + '"Export for the scanner") and evaluates the snapshot when the list is not in that file. Volume rules '
    + '(trend-breakout below) need a recorded volume: the screen capture (ingest/daily.mjs) records closes '
    + 'only, so on that history alone they are untested and the setup cannot match — volume comes from '
    + 'ingest/live.mjs or an export imported with a volume column (ingest/history-import.mjs).',
  setups: [
    {
      id: 'trend-breakout',
      name: 'Trend breakout',
      enabled: true,
      universe: { kind: 'symbols', symbols: ['NVDA', 'AAPL', '1155'] },
      timeframe: 'daily',
      confirmation: 'close',
      logic: 'AND',
      rules: [
        { left: { indicator: 'price' }, op: 'crosses_above', right: { indicator: 'ema', n: 50 } },
        { left: { indicator: 'volume' }, op: 'above', right: { indicator: 'volume_avg', n: 20, multiplier: 1.5 } },
        { left: { indicator: 'rsi', n: 14 }, op: 'between', range: [50, 70] },
      ],
      cooldownBars: 5,
      expires: null,
    },
    {
      id: 'sma-50-200-cross',
      name: '50-bar average crosses above 200-bar average',
      enabled: true,
      universe: { kind: 'market', market: 'US' },
      timeframe: 'daily',
      confirmation: 'close',
      logic: 'AND',
      rules: [{ left: { indicator: 'sma', n: 50 }, op: 'crosses_above', right: { indicator: 'sma', n: 200 } }],
      cooldownBars: 20,
      expires: null,
    },
    {
      id: 'rsi-below-30',
      name: 'RSI below 30',
      enabled: false,
      universe: { kind: 'all' },
      timeframe: 'daily',
      confirmation: 'close',
      logic: 'AND',
      rules: [{ left: { indicator: 'rsi', n: 14 }, op: 'below', right: { value: 30 } }],
      cooldownBars: 10,
      expires: null,
    },
    {
      id: 'watchlist-rsi-recovery',
      name: 'RSI crosses back above 30 on a watchlist',
      enabled: false,
      universe: { kind: 'watchlist', watchlistId: 'wl-1', name: 'Core watchlist', symbols: ['NVDA', 'AAPL', '1155'], asOf: '2026-09-27', unresolved: [] },
      timeframe: 'daily',
      confirmation: 'close',
      logic: 'AND',
      rules: [{ left: { indicator: 'rsi', n: 14 }, op: 'crosses_above', right: { value: 30 } }],
      cooldownBars: 10,
      expires: null,
    },
    {
      id: 'trend-breakout-tree',
      version: 1,
      name: 'Trend breakout, written as a rule tree',
      description: 'The first setup’s conditions in the 0.3 form, with volume OR relative volume in a nested group, recording only the bar a match begins.',
      enabled: false,
      universe: { kind: 'symbols', symbols: ['NVDA', 'AAPL', '1155'] },
      timeframe: '1D',
      confirmationMode: 'BAR_CLOSE',
      cooldownMode: 'NEW_MATCH',
      cooldownBars: 5,
      expires: null,
      ruleTree: {
        type: 'group',
        logic: 'ALL',
        children: [
          { type: 'condition', left: { indicator: 'price' }, op: 'CROSSES_ABOVE', right: { indicator: 'ema', n: 50 } },
          {
            type: 'group',
            logic: 'ANY',
            children: [
              { type: 'condition', left: { indicator: 'volume' }, op: 'GREATER_THAN', right: { indicator: 'volume_avg', n: 20, multiplier: 1.5 } },
              { type: 'condition', left: { indicator: 'rvol', n: 20 }, op: 'GREATER_THAN', right: { value: 1.5 } },
            ],
          },
          { type: 'condition', left: { indicator: 'rsi', n: 14 }, op: 'BETWEEN', range: [{ value: 50 }, { value: 70 }] },
        ],
      },
    },
  ],
};

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

/* ---- pine: indicators ---- */
/* ==========================================================================
   PINE — the reader's TradingView indicators, with TradingView's arithmetic

   The reader charts XAUUSD and other symbols on TradingView with ten Pine
   scripts and asked for rules on the numbers that chart draws. This section
   is those scripts, each written from its Pine source over the engine's own
   bars, and scanner/tv-verify.mjs recomputes them from a TradingView export
   of the chart and compares them column by column: a drift from the chart
   is found by a check, not by a match that should not have been one.

   WHY NOT THE ENGINE'S OWN RSI. TradingView's primitives differ from this
   engine's at the edges, and the engine's are left exactly as they are —
   setups and recorded alerts were computed with them. ta.rsi of a window
   with neither a gain nor a loss is 100, where scanRsi calls it undefined;
   Pine compares a crossing exactly, where scanCompare allows the float
   rule's margin; and Pine carries a missing value (na) by its own rules.
   Where Pine's function IS the engine's — ta.sma is scanSma, and ta.ema is
   scanEma: the mean of the first n values seeds it, and after a missing
   value it seeds afresh, as Pine's documented equivalent does — the
   engine's own is called, so there is still one SMA and one EMA.

   A SERIES is an array as long as the bars, null wherever Pine has na.
   Pine reads a comparison with na as false; the crossing and rising
   primitives here return null there instead, so a rule is untested during
   a warm-up rather than NOT_MET. The indicators turn that null into Pine's
   false only in what they plot.

   Each indicator returns { fields, plots }. `fields` are what a rule reads,
   in the units SCAN_PINE_INDICATORS gives them; a crossing or a state is 1
   or 0 (unit 'flag') and a direction 1, 0 or −1. `plots` is every series
   the script plots, as [TradingView title, series, first], in the order
   the script declares them — the order an export's columns take — with
   the bar its warm-up ends: where this computation's first value falls,
   however long the bars (TradingView, holding more history, draws before
   it; scanner/tv-verify.mjs compares from there). A field is
   named for what happened ("crossUp"), not for a trade: the script's own
   words ("All purchases") survive only as a plot's title, because this
   product delivers no signal.
   ========================================================================== */

/* The units the Pine indicators measure in, added to SCAN_UNITS so the
   existing validation holds them apart: a WaveTrend reading is not an RSI,
   and a crossing flag compares with nothing but a 1 or a 0. */
Object.assign(SCAN_UNITS, {
  wavetrend:    { label: 'WaveTrend',                literal: () => true,                               domain: 'any number' },
  mcdx:         { label: 'MCDX (0–20)',              literal: (v) => v >= 0 && v <= 20,                  domain: 'a number from 0 to 20' },
  banker_model: { label: 'banker model',             literal: () => true,                               domain: 'any number' },
  flag:         { label: 'yes or no (1 or 0)',       literal: (v) => v === 0 || v === 1,                 domain: '1 (yes) or 0 (no)' },
  direction:    { label: 'direction (1, 0 or −1)',   literal: (v) => v === 1 || v === 0 || v === -1,     domain: '1 (up), 0 (neither) or −1 (down)' },
});

/* ------------------------------------------------------------- primitives -- */
/* A finite number, or null: Pine's na, and what a division by zero gives. */
const scanPineV = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const scanPineFlag = (b) => (b == null ? null : b ? 1 : 0);
const scanPineConst = (len, v) => new Array(len).fill(v);
/* nz(): na as 0, or as the replacement given. A series or a single value. */
const scanPineNz = (a, r = 0) => (Array.isArray(a) ? a.map(v => (scanPineV(v) == null ? r : v)) : (scanPineV(a) == null ? r : a));
/* ta.sma and ta.ema: the engine's own (see above). */
const scanPineSma = (a, n) => scanSma(a, n);
const scanPineEma = (a, n) => scanEma(a, n);
/* ta.rma: scanEma's recurrence with alpha 1/n — seeded with the mean of the
   first n values, then alpha × value + (1 − alpha) × previous; a missing
   value ends the run and the next is seeded afresh. */
function scanPineRma(a, n) {
  const out = new Array(a.length).fill(null);
  const k = 1 / n;
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
/* ta.rsi, as the v6 RSI script writes it: the change's gains and losses
   each smoothed by ta.rma; 100 when the smoothed loss is 0 (a window with
   no change at all included — the engine's RSI calls that undefined), 0
   when the smoothed gain is 0, else 100 − 100 / (1 + gain / loss). */
function scanPineRsi(a, n) {
  const len = a.length, up = new Array(len).fill(null), dn = new Array(len).fill(null);
  for (let i = 1; i < len; i++) {
    if (!scanOk(a[i]) || !scanOk(a[i - 1])) continue;
    const d = a[i] - a[i - 1];
    up[i] = Math.max(d, 0); dn[i] = -Math.min(d, 0);
  }
  const ru = scanPineRma(up, n), rd = scanPineRma(dn, n);
  return ru.map((u, i) => (u == null || rd[i] == null ? null : rd[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / rd[i])));
}
/* ta.wma, as Pine documents it: weights (n − k) × n for the value k bars
   back, divided by their sum. */
function scanPineWma(a, n) {
  const out = new Array(a.length).fill(null);
  for (let i = n - 1; i < a.length; i++) {
    let norm = 0, sum = 0, ok = true;
    for (let k = 0; k < n; k++) {
      const v = a[i - k];
      if (!scanOk(v)) { ok = false; break; }
      const w = (n - k) * n;
      norm += w; sum += v * w;
    }
    if (ok) out[i] = sum / norm;
  }
  return out;
}
/* ta.vwma: sma(value × volume) / sma(volume). No volume is no value. */
function scanPineVwma(a, vol, n) {
  const v = Array.isArray(vol) ? vol : [];
  const pv = a.map((x, i) => (scanOk(x) && scanOk(v[i]) ? x * v[i] : null));
  const num = scanSma(pv, n), den = scanSma(a.map((_, i) => (scanOk(v[i]) ? v[i] : null)), n);
  return num.map((x, i) => (x == null || den[i] == null ? null : scanPineV(x / den[i])));
}
/* ta.hma: wma(2 × wma(value, n/2) − wma(value, n), √n). Pine truncates the
   half length; ta.hma floors √n, and the Color MA script rounds it, so the
   rounding is the caller's. Below 2 the half length is 0 and there is none. */
function scanPineHma(a, n, sqrtRound = Math.floor) {
  const h = Math.floor(n / 2), r = sqrtRound(Math.sqrt(n));
  if (h < 1 || r < 1) return new Array(a.length).fill(null);
  const w1 = scanPineWma(a, h), w2 = scanPineWma(a, n);
  return scanPineWma(w1.map((v, i) => (v == null || w2[i] == null ? null : 2 * v - w2[i])), r);
}
/* DEMA = 2·e1 − e2 and TEMA = 3·(e1 − e2) + e3, e1 the EMA of the value and
   each next the EMA of the last — the TEMA as the WaveTrend script writes
   it: 3 * (v2 - ema(v2, len)) + ema(ema(v2, len), len). */
function scanPineDema(a, n) {
  const e1 = scanEma(a, n), e2 = scanEma(e1, n);
  return e1.map((v, i) => (v == null || e2[i] == null ? null : 2 * v - e2[i]));
}
function scanPineTema(a, n) {
  const e1 = scanEma(a, n), e2 = scanEma(e1, n), e3 = scanEma(e2, n);
  return e1.map((v, i) => (v == null || e2[i] == null || e3[i] == null ? null : 3 * (v - e2[i]) + e3[i]));
}
/* ta.stdev, as Pine documents it: the population deviation by default
   (biased), the sample deviation with biased false; a deviation within
   1e-10 of the mean counts as 0, as Pine's own sum does. */
function scanPineStdev(a, n, biased = true) {
  const avg = scanSma(a, n), out = new Array(a.length).fill(null);
  const div = biased ? n : n - 1;
  if (!(div > 0)) return out;
  for (let i = n - 1; i < a.length; i++) {
    if (avg[i] == null) continue;
    let ss = 0;
    for (let k = 0; k < n; k++) { let d = a[i - k] - avg[i]; if (Math.abs(d) <= 1e-10) d = 0; ss += d * d; }
    out[i] = Math.sqrt(ss / div);
  }
  return out;
}
/* ta.highest and ta.lowest over the last n, the current bar included. */
const scanPineHighest = (a, n) => scanRollExtreme(a, n, Math.max);
const scanPineLowest = (a, n) => scanRollExtreme(a, n, Math.min);
/* ta.change: the value less the value `len` bars back. */
function scanPineChange(a, len = 1) {
  const out = new Array(a.length).fill(null);
  for (let i = len; i < a.length; i++) if (scanOk(a[i]) && scanOk(a[i - len])) out[i] = a[i] - a[i - len];
  return out;
}
/* ta.crossover(a, b): a > b now and a <= b on the bar before, compared
   exactly — from equal to above is a cross. `b` may be a single level.
   true or false where all four values exist, null where Pine reads na. */
function scanPineCrossing(a, b, up) {
  const B = Array.isArray(b) ? b : null;
  const at = (i) => (B ? B[i] : b);
  const out = new Array(a.length).fill(null);
  for (let i = 1; i < a.length; i++) {
    const x = a[i], y = at(i), xp = a[i - 1], yp = at(i - 1);
    if (!scanOk(x) || !scanOk(y) || !scanOk(xp) || !scanOk(yp)) continue;
    out[i] = up ? x > y && xp <= yp : x < y && xp >= yp;
  }
  return out;
}
const scanPineCrossover = (a, b) => scanPineCrossing(a, b, true);
const scanPineCrossunder = (a, b) => scanPineCrossing(a, b, false);
/* ta.cross: either crossing. */
function scanPineCross(a, b) {
  const o = scanPineCrossover(a, b), u = scanPineCrossunder(a, b);
  return o.map((v, i) => (v == null ? null : v || u[i]));
}
/* ta.rising(a, len): the value above each of the `len` before it; ta.falling
   below each. null while any of them is na. */
function scanPineTrend(a, len, up) {
  const out = new Array(a.length).fill(null);
  for (let i = len; i < a.length; i++) {
    if (!scanOk(a[i])) continue;
    let ok = true, all = true;
    for (let k = 1; k <= len; k++) {
      if (!scanOk(a[i - k])) { ok = false; break; }
      if (up ? !(a[i] > a[i - k]) : !(a[i] < a[i - k])) all = false;
    }
    if (ok) out[i] = all;
  }
  return out;
}
const scanPineRising = (a, len) => scanPineTrend(a, len, true);
const scanPineFalling = (a, len) => scanPineTrend(a, len, false);

/* ta.sar(start, inc, max), as Pine documents it. On the second bar the
   trend is up if the close rose (the SAR starts at the first bar's low,
   the extreme at the second's high) and down if not; every bar from there
   moves the SAR towards the extreme by the acceleration, reverses when the
   SAR crosses the bar (the SAR jumps to the extreme, the acceleration
   restarts), steps the acceleration by `inc` up to `max` on each new
   extreme, and keeps the SAR outside the two bars before. The recursion
   restarts after a bar with no high, low or close, as a chart that began
   there would; `trend` is 1 while the SAR is below the bars, −1 above. */
function scanPineSarState(high, low, close, start, inc, max) {
  const n = close.length, sar = new Array(n).fill(null), trend = new Array(n).fill(null);
  let result = null, maxMin = null, acc = null, isBelow = null, from = 0;
  for (let i = 0; i < n; i++) {
    if (!scanOk(high[i]) || !scanOk(low[i]) || !scanOk(close[i])) { result = null; from = i + 1; continue; }
    const k = i - from;
    let first = false;
    if (k === 1) {
      if (close[i] > close[i - 1]) { isBelow = true; maxMin = high[i]; result = low[i - 1]; }
      else { isBelow = false; maxMin = low[i]; result = high[i - 1]; }
      first = true; acc = start;
    }
    if (k < 1 || result == null) continue;
    result = result + acc * (maxMin - result);
    if (isBelow) {
      if (result > low[i]) { first = true; isBelow = false; result = Math.max(high[i], maxMin); maxMin = low[i]; acc = start; }
    } else if (result < high[i]) { first = true; isBelow = true; result = Math.min(low[i], maxMin); maxMin = high[i]; acc = start; }
    if (!first) {
      if (isBelow) { if (high[i] > maxMin) { maxMin = high[i]; acc = Math.min(acc + inc, max); } }
      else if (low[i] < maxMin) { maxMin = low[i]; acc = Math.min(acc + inc, max); }
    }
    if (isBelow) { result = Math.min(result, low[i - 1]); if (k > 1) result = Math.min(result, low[i - 2]); }
    else { result = Math.max(result, high[i - 1]); if (k > 1) result = Math.max(result, high[i - 2]); }
    sar[i] = result; trend[i] = isBelow ? 1 : -1;
  }
  return { sar, trend };
}
const scanPineSar = (high, low, close, start, inc, max) => scanPineSarState(high, low, close, start, inc, max).sar;

/* The blackcat script's xsa(src, len, wei), line for line:
     sumf := nz(sumf[1]) - nz(src[len]) + src
     ma   := na(src[len]) ? na : sumf / len
     out  := na(out[1]) ? ma : (src * wei + out[1] * (len - wei)) / len
   a running sum that seeds a smoothing of weight wei/len. The sum is Pine's
   too, na and all: a na value empties it (nz of an na sum is 0). */
function scanPineXsa(src, len, wei) {
  const n = src.length, out = new Array(n).fill(null);
  let sumf = null, prev = null;
  for (let i = 0; i < n; i++) {
    const s = scanOk(src[i]) ? src[i] : null;
    const back = i - len >= 0 && scanOk(src[i - len]) ? src[i - len] : null;
    const sf = s == null ? null : (sumf == null ? 0 : sumf) - (back == null ? 0 : back) + s;
    const ma = back == null || sf == null ? null : sf / len;
    const o = prev == null ? ma : s == null ? null : (s * wei + prev * (len - wei)) / len;
    sumf = sf; prev = o; out[i] = o;
  }
  return out;
}

/* The moving averages the scripts let the reader choose, by the Color MA
   script's numbering (1 SMA, 2 EMA, 3 Hull, 4 WMA, 5 VWMA), with 6 for
   Wilder's (SMMA, ta.rma), which the RSI script offers. The Hull is the
   Color MA script's own: wma(2 × wma(n/2) − wma(n), round(√n)). */
const SCAN_PINE_MA_TYPES = { 1: 'SMA', 2: 'EMA', 3: 'HMA', 4: 'WMA', 5: 'VWMA', 6: 'RMA' };
function scanPineMa(type, a, n, vol) {
  switch (type) {
    case 1: return scanSma(a, n);
    case 2: return scanEma(a, n);
    case 3: return scanPineHma(a, n, Math.round);
    case 4: return scanPineWma(a, n);
    case 5: return scanPineVwma(a, vol, n);
    case 6: return scanPineRma(a, n);
    default: return new Array(a.length).fill(null);
  }
}
/* How many bars after its input's first value an average's first value
   falls: n − 1, and for the Hull n + round(√n) − 2. */
const scanPineMaLag = (type, n) => (type === 3 ? n + Math.round(Math.sqrt(n)) - 2 : n - 1);

/* ------------------------------------------------------------ indicators -- */
/* The bar a field's first value falls on: its catalogue need, less one. */
const scanPineFirst = (id, p, f) => SCAN_PINE_INDICATORS[id].needs(p, f) - 1;
/* One flag series: 1 or 0 where the test could be read, null where not. */
const scanPineFlags = (len, test) => { const out = new Array(len); for (let i = 0; i < len; i++) out[i] = scanPineFlag(test(i)); return out; };
/* Pine reads na in a condition as false; a plotted 1/0 is 0 there. */
const scanPinePlot01 = (a, on = 1) => a.map(v => (v === 1 ? on : 0));
const scanPineOn = (v) => v === 1 || v === true;

/* WaveTrend, "Oscilador WaveTrend" (WT-4h, v4): ap = hlc3; esa = ema(ap,
   channel); d = ema(|ap − esa|, channel); ci = (ap − esa) / (0.015 × d);
   wt1 = ema(ci, average); wt2 = sma(wt1, 4). Direction is 1 when wt1
   rises over `reaction` bars, −1 when it falls, else the last direction.
   The four crossings are the script's venta, venta_1, compra and compra_1:
   with "Sell when overbought" on (obSwitch 1) a cross of wt1 under wt2
   counts only at or above the overbought level (crossDownOb), and with it
   off every cross under counts (crossDown) — and the same below for the
   cross up and "Buy when oversold". The reader's chart runs both switches
   off. The extra MA is the script's TEMA of wt1 (MA PLOT_ST). */
function scanPineWaveTrend(bars, p) {
  const H = bars.high || [], L = bars.low || [], C = bars.closes || [], len = C.length;
  const ap = C.map((c, i) => (scanOk(c) && scanOk(H[i]) && scanOk(L[i]) ? (H[i] + L[i] + c) / 3 : null));
  const esa = scanEma(ap, p.channel);
  const d = scanEma(ap.map((v, i) => (v == null || esa[i] == null ? null : Math.abs(v - esa[i]))), p.channel);
  const ci = ap.map((v, i) => (v == null || esa[i] == null || d[i] == null ? null : scanPineV((v - esa[i]) / (0.015 * d[i]))));
  const wt1 = scanEma(ci, p.average), wt2 = scanSma(wt1, 4);
  const hist = wt1.map((v, i) => (v == null || wt2[i] == null ? null : v - wt2[i]));
  const up = scanPineRising(wt1, p.reaction), down = scanPineFalling(wt1, p.reaction);
  /* direction := rising ? 1 : falling ? -1 : nz(direction[1]) — Pine's
     starts at 0 and carries through the warm-up, which is read here but
     not offered: a direction is null until rising and falling can be read. */
  const direction = new Array(len).fill(null), dirChange = new Array(len).fill(null);
  for (let i = 0, prev = 0; i < len; i++) {
    const v = up[i] ? 1 : down[i] ? -1 : prev;
    if (up[i] != null && down[i] != null) direction[i] = v;
    if (i > 0 && direction[i] != null && direction[i - 1] != null) dirChange[i] = direction[i] !== direction[i - 1] ? 1 : 0;
    prev = v;
  }
  const xo = scanPineCrossover(wt1, wt2), xu = scanPineCrossunder(wt1, wt2);
  const obOn = scanPineOn(p.obSwitch), osOn = scanPineOn(p.osSwitch);
  const crossDownOb = scanPineFlags(len, i => (xu[i] == null ? null : xu[i] && wt1[i] >= p.overbought && obOn));
  const crossDown = scanPineFlags(len, i => (xu[i] == null ? null : xu[i] && !obOn));
  const crossUpOs = scanPineFlags(len, i => (xo[i] == null ? null : xo[i] && wt1[i] <= p.oversold && osOn));
  const crossUp = scanPineFlags(len, i => (xo[i] == null ? null : xo[i] && !osOn));
  const tema = scanPineTema(wt1, p.maLen);
  /* The bot's criterion 1, its wavetrend()'s `bullish`: wt1 > wt2, exactly. */
  const bull = scanPineFlags(len, i => (wt1[i] == null || wt2[i] == null ? null : wt1[i] > wt2[i]));
  /* The fractal divergences, from the script's verbatim code: a top is wt1
     two bars back above the two before it and the two after it, strictly
     (f_top_fractal), a bottom the reverse, and na anywhere in the five is
     no fractal. `fractal_top1 ? wt1[2] : na` tests a float for truth, which
     Pine v4 reads as false at na AND at 0.0, so a fractal whose wt1 is
     exactly 0 is not drawn. The plots carry offset=-2: the value found on
     bar i is drawn on bar i − 2, the fractal's own bar — so bar j of the
     plot holds wt1[j] when bar j + 2 finds the fractal, and the last two
     bars hold nothing yet, as on the chart. The divergence labels are drawn
     only with the script's divergence switches on (off by default, and on
     the reader's chart), so they are not computed. */
  const fractal = (top) => {
    const out = new Array(len).fill(null);
    for (let j = 2; j + 2 < len; j++) {
      const m = wt1[j], a = wt1[j - 2], b = wt1[j - 1], c = wt1[j + 1], e = wt1[j + 2];
      if (m == null || a == null || b == null || c == null || e == null || m === 0) continue;
      if (top ? a < m && b < m && m > c && m > e : a > m && b > m && m < c && m < e) out[j] = m;
    }
    return out;
  };
  /* The markers sit an eighth of the way from the middle to the level:
     plot(venta ? wt2[1] + ploff : na). */
  const mid = (p.overbought + p.oversold) / 2, ploff = (p.overbought - mid) / 8;
  const marker = (f, sign) => f.map((x, i) => (x === 1 && i > 0 && wt2[i - 1] != null ? wt2[i - 1] + sign * ploff : null));
  const none = scanPineConst(len, null);
  const levels = [];
  for (let k = 1; k <= 8; k++) levels.push([`Level ${k} overbought`, scanPineConst(len, p.overbought + 5 * (k - 1)), 0]);
  for (let k = 1; k <= 8; k++) levels.push([`Level ${k} oversold`, scanPineConst(len, p.oversold - 5 * k), 0]);
  const first = (f) => scanPineFirst('wavetrend', p, f);
  return {
    fields: { wt1, wt2, hist, direction, dirChange, crossUp, crossDown, crossUpOs, crossDownOb, tema, bull },
    plots: [['WT Average-WT1', wt1, first('wt1')], ['Signal average-WT2', p.showSignal ? wt2 : none, p.showSignal ? first('wt2') : 0], ['Level 0', scanPineConst(len, 0), 0], ...levels,
            ['Sell when overbought', marker(crossDownOb, 1), first('crossDownOb')], ['All sales', marker(crossDown, 1), first('crossDown')],
            ['Buy when oversold', marker(crossUpOs, -1), first('crossUpOs')], ['All purchases', marker(crossUp, -1), first('crossUp')],
            ['Histogramme', p.showHist ? hist : none, p.showHist ? first('hist') : 0],
            ['Divergencias Bajistas', fractal(true), first('wt1') + 2], ['Divergencias Alcistas', fractal(false), first('wt1') + 2], ['MA PLOT_ST', tema, first('tema')]],
  };
}

/* The line, signal and histogram both MACDs share: line = ema(fast) −
   ema(slow), signal an average of the line, histogram = line − signal. */
function scanPineMacdParts(C, p, signalOf) {
  const ef = scanEma(C, p.fast), es = scanEma(C, p.slow);
  const macd = ef.map((v, i) => (v == null || es[i] == null ? null : v - es[i]));
  const signal = signalOf(macd, p.signal);
  const hist = macd.map((v, i) => (v == null || signal[i] == null ? null : v - signal[i]));
  return { macd, signal, hist };
}
/* CM_MacD_Ult_MTF (ChrisMoody) on the chart's own timeframe: its signal is
   an SMA of the line — not the EMA of the usual MACD, nor of the bot's. The
   histogram's four colours are its four states against zero and the bar
   before (aqua histA_IsUp, blue histA_IsDown, red histB_IsDown, maroon
   histB_IsUp); the cross dot sits on the signal line. Pine v2 reads a
   number in a condition as true unless it is 0 or na, so a line of exactly
   0 is not plotted. */
function scanPineCmMacd(bars, p) {
  const C = bars.closes || [], len = C.length;
  const { macd, signal, hist } = scanPineMacdParts(C, p, scanSma);
  const cross = scanPineCross(macd, signal).map(scanPineFlag);
  const above = scanPineFlags(len, i => (macd[i] == null || signal[i] == null ? null : macd[i] >= signal[i]));
  const hs = (test) => scanPineFlags(len, i => (i === 0 || hist[i] == null || hist[i - 1] == null ? null : test(hist[i], hist[i - 1])));
  const shown = (a) => a.map(v => (v == null || v === 0 ? null : v));
  /* The bot's readings, taken on this SMA signal when the reader switches
     the bot's criterion 2 to the signal the chart draws: bull is the line
     above the signal strictly (`above` includes equality), and the
     histogram against the bar before — rising, falling, or either. */
  return {
    fields: { macd, signal, hist, cross, above,
              histUpAbove: hs((h, q) => h > q && h > 0), histDownAbove: hs((h, q) => h < q && h > 0),
              histDownBelow: hs((h, q) => h < q && h <= 0), histUpBelow: hs((h, q) => h > q && h <= 0),
              bull: scanPineFlags(len, i => (macd[i] == null || signal[i] == null ? null : macd[i] > signal[i])),
              histUp: hs((h, q) => h > q), histDown: hs((h, q) => h < q), histMoved: hs((h, q) => h !== q) },
    plots: [['MACD', shown(macd), scanPineFirst('cm_macd', p, 'macd')], ['Signal Line', shown(signal), scanPineFirst('cm_macd', p, 'signal')],
            ['Histogram', shown(hist), scanPineFirst('cm_macd', p, 'hist')], ['Cross', cross.map((x, i) => (x === 1 ? signal[i] : null)), scanPineFirst('cm_macd', p, 'cross')]],
  };
}
/* The Multi-Timeframe Trading Bot's own MACD: the same line, with an EMA
   signal (the bot's cm_ultimate_macd), which the chart's CM_Ult_MacD does
   not draw. Its numbers are the engine's MACD's; what it adds is the bot's
   readings of them. The bot plots shapes, not these, so there is nothing
   to plot. */
function scanPineBotMacd(bars, p) {
  const C = bars.closes || [], len = C.length;
  const { macd, signal, hist } = scanPineMacdParts(C, p, scanEma);
  const cmp = (test) => scanPineFlags(len, i => (macd[i] == null || signal[i] == null ? null : test(macd[i], signal[i])));
  const hs = (test) => scanPineFlags(len, i => (i === 0 || hist[i] == null || hist[i - 1] == null ? null : test(hist[i], hist[i - 1])));
  return {
    fields: { macd, signal, hist, bull: cmp((m, s) => m > s), bear: cmp((m, s) => m < s), histUp: hs((h, q) => h > q), histDown: hs((h, q) => h < q),
              /* Either of the two: "the histogram moved" — what the bot's
                 ANY STRONG SIGNAL asks of it, in one condition. */
              histMoved: hs((h, q) => h !== q) },
    plots: [],
  };
}
/* [M2J] MCDX: banker = sensitivity × (rsi(close, period) − base), held
   within 0 and 20, and hot money the same with its own settings; each has
   an average of the reader's type (Banker_MA, HotMoney_MA), and the
   script colours each by whether it rose. The retailer bar is 20, and 5,
   10 and 15 are guide lines. */
function scanPineMcdx(bars, p) {
  const C = bars.closes || [], len = C.length;
  const clamp = (v) => (v == null ? null : v > 20 ? 20 : v < 0 ? 0 : v);
  const banker = scanPineRsi(C, p.bankerPeriod).map(r => clamp(r == null ? null : p.bankerSens * (r - p.bankerBase)));
  const hotMoney = scanPineRsi(C, p.hotPeriod).map(r => clamp(r == null ? null : p.hotSens * (r - p.hotBase)));
  const bankerMa = scanPineMa(p.maType, banker, p.maLen, bars.volumes);
  const hotMoneyMa = scanPineMa(p.maType2, hotMoney, p.maLen2, bars.volumes);
  const rose = (a) => scanPineFlags(len, i => (i === 0 || a[i] == null || a[i - 1] == null ? null : a[i] > a[i - 1]));
  return {
    fields: { banker, hotMoney, bankerMa, hotMoneyMa, bankerMaUp: rose(bankerMa), hotMoneyMaUp: rose(hotMoneyMa) },
    plots: [['Retailer', scanPineConst(len, 20), 0], ['Hot Money', hotMoney, scanPineFirst('mcdx', p, 'hotMoney')], ['Banker', banker, scanPineFirst('mcdx', p, 'banker')],
            ['5', scanPineConst(len, 5), 0], ['10', scanPineConst(len, 10), 0], ['15', scanPineConst(len, 15), 0],
            ['Banker_MA', bankerMa, scanPineFirst('mcdx', p, 'bankerMa')], ['HotMoney_MA', hotMoneyMa, scanPineFirst('mcdx', p, 'hotMoneyMa')]],
  };
}
/* Color MA: an average of the close of the chosen type and length, green
   when above the bar before and red otherwise — direction 1 or −1. */
function scanPineColorMa(bars, p) {
  const C = bars.closes || [], len = C.length;
  const ma = scanPineMa(p.type, C, p.n, bars.volumes);
  const direction = new Array(len).fill(null);
  for (let i = 1; i < len; i++) if (ma[i] != null && ma[i - 1] != null) direction[i] = ma[i] > ma[i - 1] ? 1 : -1;
  return { fields: { ma, direction }, plots: [['Color MA', ma, scanPineFirst('color_ma', p, 'ma')]] };
}
/* SMA Cross: two SMAs of the close; the script's "Buy" is the fast
   crossing over the slow and its "Sell" the fast crossing under. */
function scanPineSmaCross(bars, p) {
  const C = bars.closes || [];
  const fast = scanSma(C, p.fast), slow = scanSma(C, p.slow);
  const crossUp = scanPineCrossover(fast, slow).map(scanPineFlag), crossDown = scanPineCrossunder(fast, slow).map(scanPineFlag);
  return { fields: { fast, slow, crossUp, crossDown },
           plots: [['Plot', fast, p.fast - 1], ['Plot', slow, p.slow - 1],
                   ['Chars', scanPinePlot01(crossUp), scanPineFirst('sma_cross', p, 'crossUp')], ['Chars', scanPinePlot01(crossDown), scanPineFirst('sma_cross', p, 'crossDown')]] };
}
/* Parabolic SAR: ta.sar(start, increment, maximum). */
function scanPinePsar(bars, p) {
  const { sar, trend } = scanPineSarState(bars.high || [], bars.low || [], bars.closes || [], p.start, p.inc, p.max);
  return { fields: { sar, direction: trend }, plots: [['ParabolicSAR', sar, 1]] };
}
/* Sentiment Range MA [ChartPrime]. A candle's top and bottom are its body
   (or, with range 1, its wick); a range of `mult` × the SMA of the
   candle's height over atrLen bars is set about the close, and held until
   the SMA of the tops over `trigger` + 1 bars closes above it or that of
   the bottoms below it — then it is set afresh about that bar's close. The
   MA and the range's edges are that held level filtered: a WMA of length
   `length` + 1, of its SMA when double is on. The level is state: it is
   set on every bar until the range can be measured, and from there it
   depends on the path, not on a window. Direction is the sign of the MA's
   change from the bar before; above, below and across place the bar
   against the MA (the script's "MA Cross" colours). */
function scanPineSrMa(bars, p) {
  const O = bars.open || [], H = bars.high || [], L = bars.low || [], C = bars.closes || [], len = C.length;
  const L1 = p.length + 1, T = p.trigger + 1, wick = p.range === 1;
  const top = C.map((c, i) => (wick ? (scanOk(H[i]) ? H[i] : null) : scanOk(O[i]) && scanOk(c) ? Math.max(O[i], c) : null));
  const bot = C.map((c, i) => (wick ? (scanOk(L[i]) ? L[i] : null) : scanOk(O[i]) && scanOk(c) ? Math.min(O[i], c) : null));
  const sTop = scanSma(top, T), sBot = scanSma(bot, T);
  const atr = scanSma(top.map((t, i) => (t == null || bot[i] == null ? null : t - bot[i])), p.atrLen);
  const level = new Array(len).fill(null), topR = new Array(len).fill(null), botR = new Array(len).fill(null);
  let ma = null, range = null, tR = null, bR = null;
  for (let i = 0; i < len; i++) {
    const flag = (sTop[i] != null && tR != null && sTop[i] > tR) || (sBot[i] != null && bR != null && sBot[i] < bR) || range == null;
    if (flag) {
      ma = scanOk(C[i]) ? C[i] : null;
      range = atr[i] == null ? null : atr[i] * p.mult;
      tR = ma == null || range == null ? null : ma + range;
      bR = ma == null || range == null ? null : ma - range;
    }
    level[i] = ma; topR[i] = tR; botR[i] = bR;
  }
  const filter = (x) => scanPineWma(scanPineOn(p.double) ? scanSma(x, L1) : x, L1);
  const out = filter(level), top2 = filter(topR), bot2 = filter(botR);
  const direction = new Array(len).fill(null);
  for (let i = 1; i < len; i++) if (out[i] != null && out[i - 1] != null) { const dm = out[i] - out[i - 1]; direction[i] = dm > 0 ? 1 : dm < 0 ? -1 : 0; }
  const place = (test) => scanPineFlags(len, i => (out[i] == null || !scanOk(H[i]) || !scanOk(L[i]) ? null : test(H[i], L[i], out[i])));
  return {
    fields: { ma: out, top: top2, bottom: bot2, direction,
              above: place((h, l, m) => l > m), below: place((h, l, m) => h < m), across: place((h, l, m) => h > m && l < m) },
    plots: [['SR MA', out, scanPineFirst('sr_ma', p, 'ma')], ['Top Range', top2, scanPineFirst('sr_ma', p, 'top')], ['Bottom Range', bot2, scanPineFirst('sr_ma', p, 'bottom')]],
  };
}
/* [blackcat] L1 Banker Entry: x = (close − lowest low of 27) / (highest
   high of 27 − lowest low of 27) × 100; model = 3 × xsa(x, 5, 1) − 2 ×
   xsa(xsa(x, 5, 1), 3, 1). The script plots 100 on the bar the model
   crosses above the threshold, 50 while it is at or below 3 and 25 while
   it is below 5 — the last two are fixed in the script, not the threshold. */
function scanPineBankerEntry(bars, p) {
  const H = bars.high || [], L = bars.low || [], C = bars.closes || [], len = C.length;
  const hh = scanPineHighest(H, 27), ll = scanPineLowest(L, 27);
  const x = C.map((c, i) => (hh[i] == null || ll[i] == null || !scanOk(c) ? null : scanPineV((c - ll[i]) / (hh[i] - ll[i]) * 100)));
  const s1 = scanPineXsa(x, 5, 1), s2 = scanPineXsa(s1, 3, 1);
  const model = s1.map((v, i) => (v == null || s2[i] == null ? null : 3 * v - 2 * s2[i]));
  const crossUp = scanPineCrossover(model, p.threshold).map(scanPineFlag);
  const atOrBelow3 = scanPineFlags(len, i => (model[i] == null ? null : model[i] <= 3));
  const below5 = scanPineFlags(len, i => (model[i] == null ? null : model[i] < 5));
  return { fields: { model, crossUp, atOrBelow3, below5 },
           plots: [['Plot', scanPinePlot01(crossUp, 100), scanPineFirst('banker_entry', p, 'crossUp')], ['Plot', scanPinePlot01(atOrBelow3, 50), scanPineFirst('banker_entry', p, 'atOrBelow3')],
                   ['Plot', scanPinePlot01(below5, 25), scanPineFirst('banker_entry', p, 'below5')]] };
}
/* Relative Strength Index (TradingView's v6 script): ta.rsi of the close,
   and its "RSI-based MA" of the chosen type; type 7, "SMA + Bollinger
   Bands", is the SMA with bands of bbMult × the population deviation of
   the RSI over the same length. Divergences are not computed. */
const SCAN_PINE_RSI_MA = { 1: 'SMA', 2: 'EMA', 4: 'WMA', 5: 'VWMA', 6: 'RMA', 7: 'SMA + Bollinger Bands' };
function scanPineRsiStudy(bars, p) {
  const C = bars.closes || [], len = C.length;
  const rsi = scanPineRsi(C, p.n);
  const ma = scanPineMa(p.maType === 7 ? 1 : p.maType, rsi, p.maLen, bars.volumes);
  const dev = p.maType === 7 ? scanPineStdev(rsi, p.maLen) : null;
  const band = (sign) => (dev ? ma.map((m, i) => (m == null || dev[i] == null ? null : m + sign * dev[i] * p.bbMult)) : scanPineConst(len, null));
  const bbUpper = band(1), bbLower = band(-1);
  return { fields: { rsi, ma, bbUpper, bbLower },
           plots: [['RSI', rsi, scanPineFirst('tv_rsi', p, 'rsi')], ['RSI-based MA', ma, scanPineFirst('tv_rsi', p, 'ma')],
                   ['Upper Bollinger Band', bbUpper, dev ? scanPineFirst('tv_rsi', p, 'bbUpper') : 0], ['Lower Bollinger Band', bbLower, dev ? scanPineFirst('tv_rsi', p, 'bbLower') : 0]] };
}

/* --------------------------------------------------------------- catalogue -- */
/* The Pine indicators as SCAN_INDICATORS entries, spread into it there, so
   a setup names them like any other and the validation, evaluation, cache
   and alert record read them unchanged. The defaults are the reader's own
   chart, as their export of it shows (scanner/tv-verify.mjs reproduces
   it with them), not the scripts' defaults: SMA Cross 50/200, Color MA an
   SMA of 200, RSI of 5 with an SMA of 14, both WaveTrend switches off.
   Beside what every entry carries:
     pine(bars, params)  the indicator above;
     inputsOf(params)    the inputs, when a parameter changes them (a VWMA
                         reads volume; the body of a candle reads its open);
     span(p, f, decay)   how far back a price break still moves the value,
                         for scanBreakSpan (decay(k) is the bars an
                         EMA-like weight k takes to fall below 1%);
     check(p, f)         a combination the bounds cannot refuse;
     sideLabel(p, f)     the operand in words, for scanSideLabel;
     fieldLabels         each field in words, for a page to show.
   `needs` is the bars before the field's first value, worked from the
   formulas: a Pine EMA's first value is at bar n, an SMA's at bar n, a
   crossing's one bar after both of its sides. */
const scanPineInt = (def, min = 1, max = SCAN_LIMITS.maxPeriod) => ({ def, min, max, integer: true });
const scanPineNum = (def, min, max) => ({ def, min, max, integer: false });
const scanPineSwitch = (def, names = { 0: 'off', 1: 'on' }) => ({ def, min: 0, max: 1, integer: true, options: names });
const scanPineMaParam = (def, options) => ({ def, min: Math.min(...Object.keys(options).map(Number)), max: Math.max(...Object.keys(options).map(Number)), integer: true, options });
/* The first bar an average of the chosen type moves the value forward
   from a break, as scanBreakSpan counts it: an EMA's or RMA's decay, else
   its window. */
const scanPineMaSpan = (type, n, decay) => (type === 2 ? decay(2 / (n + 1)) : type === 6 ? decay(1 / n) : scanPineMaLag(type, n) + 1);
/* An operand in words: the indicator, its parameters where they differ
   from the reader's chart, and the field. */
function scanPineSideLabel(id, p, f, head = null) {
  const def = SCAN_PINE_INDICATORS[id];
  const shown = head ? head.keys : [];
  const changed = Object.keys(def.params).filter(k => !shown.includes(k) && p[k] !== def.params[k].def).map(k => `${k} ${p[k]}`);
  const fl = def.fieldLabels?.[f];
  const field = typeof fl === 'function' ? fl(p) : fl || f || '';
  return `${head ? head.text : def.label}${changed.length ? ` (${changed.join(', ')})` : ''}${field ? ` ${field}` : ''}`;
}
const SCAN_PINE_INDICATORS = {
  wavetrend: {
    label: 'WaveTrend', calcVersion: 1, inputs: ['high', 'low', 'close'], pine: scanPineWaveTrend,
    params: { channel: scanPineInt(10), average: scanPineInt(21), reaction: scanPineInt(1), overbought: scanPineNum(53, 0, 1000), oversold: scanPineNum(-53, -1000, 0),
              obSwitch: scanPineSwitch(0), osSwitch: scanPineSwitch(0), maLen: scanPineInt(200) },
    fields: { wt1: 'wavetrend', wt2: 'wavetrend', hist: 'wavetrend', tema: 'wavetrend', direction: 'direction', dirChange: 'flag',
              crossUp: 'flag', crossDown: 'flag', crossUpOs: 'flag', crossDownOb: 'flag', bull: 'flag' },
    defaultField: 'wt1',
    fieldLabels: { wt1: 'WT1', wt2: 'WT2', hist: 'WT1 − WT2', tema: (p) => `TEMA${p.maLen} of WT1`, direction: 'direction', dirChange: 'direction change',
                   crossUp: 'WT1 crosses over WT2', crossDown: 'WT1 crosses under WT2', crossUpOs: (p) => `WT1 crosses over WT2 at or below ${p.oversold}`,
                   crossDownOb: (p) => `WT1 crosses under WT2 at or above ${p.overbought}`, bull: 'WT1 above WT2' },
    needs: (p, f) => {
      const w = 2 * p.channel + p.average - 2;
      return { wt1: w, wt2: w + 3, hist: w + 3, bull: w + 3, tema: w + 3 * p.maLen - 3, direction: w + p.reaction, dirChange: w + p.reaction + 1 }[f] ?? w + 4;
    },
    span: (p, f, decay) => 2 * decay(2 / (p.channel + 1)) + decay(2 / (p.average + 1)) + 4 + (f === 'tema' ? 3 * decay(2 / (p.maLen + 1)) : 0),
    sideLabel: (p, f) => scanPineSideLabel('wavetrend', p, f, { keys: ['channel', 'average'], text: `WaveTrend(${p.channel},${p.average})` }),
    formula: 'The WT-4h script (Oscilador WaveTrend): ap = (high + low + close) / 3; esa = EMA(ap, channel); d = EMA(|ap − esa|, channel); '
      + 'ci = (ap − esa) / (0.015 × d); wt1 = EMA(ci, average); wt2 = the SMA of wt1 over 4 bars; hist = wt1 − wt2. Every EMA is TradingView’s: '
      + 'seeded with the mean of its first n values. direction is 1 when wt1 is above each of its `reaction` values before, −1 when below each, '
      + 'else the direction before; dirChange is 1 on the bar it changes. crossUp and crossDown are 1 on the bar wt1 crosses over or under wt2 '
      + '(from equal counts), and are the script’s “All purchases” and “All sales”, which it draws only while its “Buy when oversold” (osSwitch) '
      + 'and “Sell when overbought” (obSwitch) switches are off; with a switch on, only the crossing at or beyond its level counts — crossUpOs '
      + 'at or below `oversold`, crossDownOb at or above `overbought`. Your chart runs both switches off. tema is the script’s extra MA: '
      + '3 × (e1 − e2) + e3, the EMAs of wt1 over maLen bars taken three times (MA PLOT_ST). bull is 1 while wt1 is above wt2, compared '
      + 'exactly — the Multi-Timeframe Trading Bot’s criterion 1.',
  },
  cm_macd: {
    label: 'CM MACD', calcVersion: 1, inputs: ['close'], pine: scanPineCmMacd,
    params: { fast: scanPineInt(12), slow: scanPineInt(26), signal: scanPineInt(9) },
    fields: { macd: 'price_delta', signal: 'price_delta', hist: 'price_delta', cross: 'flag', above: 'flag',
              histUpAbove: 'flag', histDownAbove: 'flag', histDownBelow: 'flag', histUpBelow: 'flag',
              bull: 'flag', histUp: 'flag', histDown: 'flag', histMoved: 'flag' },
    defaultField: 'hist',
    fieldLabels: { macd: 'line', signal: 'signal (SMA)', hist: 'histogram', cross: 'line crosses signal', above: 'line at or above signal',
                   histUpAbove: 'histogram rising above 0', histDownAbove: 'histogram falling above 0', histDownBelow: 'histogram falling at or below 0', histUpBelow: 'histogram rising at or below 0',
                   bull: 'line above signal', histUp: 'histogram rising', histDown: 'histogram falling', histMoved: 'histogram rising or falling' },
    needs: (p, f) => { const m = Math.max(p.fast, p.slow); return f === 'macd' ? m : ['signal', 'hist', 'above', 'bull'].includes(f) ? m + p.signal - 1 : m + p.signal; },
    span: (p, f, decay) => decay(2 / (Math.max(p.fast, p.slow) + 1)) + (f === 'macd' ? 0 : p.signal),
    sideLabel: (p, f) => scanPineSideLabel('cm_macd', p, f, { keys: ['fast', 'slow', 'signal'], text: `CM MACD(${p.fast},${p.slow},${p.signal})` }),
    formula: 'CM_Ult_MacD_MTF (ChrisMoody) on the setup’s own timeframe: line = EMA(close, fast) − EMA(close, slow); signal = the SMA of the line over '
      + '`signal` bars — an SMA, where the usual MACD (and the bot’s) uses an EMA; hist = line − signal. cross is 1 on the bar the line crosses '
      + 'the signal either way; above is 1 while the line is at or above the signal. The histogram’s four colours are four flags: histUpAbove '
      + 'rising and above 0 (aqua), histDownAbove falling and above 0 (blue), histDownBelow falling and at or below 0 (red), histUpBelow rising '
      + 'and at or below 0 (maroon); an unchanged histogram is none of them. bull, histUp, histDown and histMoved are the Multi-Timeframe '
      + 'Trading Bot’s readings taken on this SMA signal (its criterion 2 switched to the signal the chart draws): bull is 1 while the line '
      + 'is above the signal, strictly; histUp and histDown are 1 when the histogram is above or below the bar before’s, and histMoved when '
      + 'it is either.',
  },
  bot_macd: {
    label: 'MACD, EMA signal', calcVersion: 1, inputs: ['close'], pine: scanPineBotMacd,
    params: { fast: scanPineInt(12), slow: scanPineInt(26), signal: scanPineInt(9) },
    fields: { macd: 'price_delta', signal: 'price_delta', hist: 'price_delta', bull: 'flag', bear: 'flag', histUp: 'flag', histDown: 'flag', histMoved: 'flag' },
    defaultField: 'hist',
    fieldLabels: { macd: 'line', signal: 'signal (EMA)', hist: 'histogram', bull: 'line above signal', bear: 'line below signal', histUp: 'histogram rising', histDown: 'histogram falling',
                   histMoved: 'histogram rising or falling' },
    needs: (p, f) => { const m = Math.max(p.fast, p.slow); return f === 'macd' ? m : ['histUp', 'histDown', 'histMoved'].includes(f) ? m + p.signal : m + p.signal - 1; },
    span: (p, f, decay) => decay(2 / (Math.max(p.fast, p.slow) + 1)) + (f === 'macd' ? 0 : decay(2 / (p.signal + 1))),
    sideLabel: (p, f) => scanPineSideLabel('bot_macd', p, f, { keys: ['fast', 'slow', 'signal'], text: `MACD(${p.fast},${p.slow},${p.signal}) EMA-signal` }),
    formula: 'The Multi-Timeframe Trading Bot’s MACD: line = EMA(close, fast) − EMA(close, slow); signal = the EMA of the line over `signal` bars, '
      + 'seeded with the mean of its first `signal` values; hist = line − signal — the same numbers as the MACD indicator. bull is 1 while the '
      + 'line is above the signal and bear while below (the bot’s criterion 2); histUp and histDown are 1 when the histogram is above or below '
      + 'the bar before, and histMoved when it is either. The chart’s CM MACD takes an SMA signal instead, and the two disagree on some bars.',
  },
  mcdx: {
    label: 'MCDX', calcVersion: 1, inputs: ['close'], pine: scanPineMcdx,
    inputsOf: (p) => (p.maType === 5 || p.maType2 === 5 ? ['close', 'volume'] : ['close']),
    params: { bankerBase: scanPineInt(50, 10, 100), bankerPeriod: scanPineInt(50, 10), bankerSens: scanPineNum(1.5, 0.1, 100),
              hotBase: scanPineInt(30, 10, 100), hotPeriod: scanPineInt(40, 10), hotSens: scanPineNum(0.5, 0.1, 100),
              maLen: scanPineInt(5), maType: scanPineMaParam(2, { 1: 'SMA', 2: 'EMA', 3: 'HMA', 4: 'WMA', 5: 'VWMA' }),
              maLen2: scanPineInt(5), maType2: scanPineMaParam(2, { 1: 'SMA', 2: 'EMA', 3: 'HMA', 4: 'WMA', 5: 'VWMA' }) },
    fields: { banker: 'mcdx', hotMoney: 'mcdx', bankerMa: 'mcdx', hotMoneyMa: 'mcdx', bankerMaUp: 'flag', hotMoneyMaUp: 'flag' },
    defaultField: 'banker',
    fieldLabels: { banker: 'banker', hotMoney: 'hot money', bankerMa: 'Banker_MA', hotMoneyMa: 'HotMoney_MA', bankerMaUp: 'Banker_MA rising', hotMoneyMaUp: 'HotMoney_MA rising' },
    needs: (p, f) => ({ banker: p.bankerPeriod + 1, hotMoney: p.hotPeriod + 1, bankerMa: p.bankerPeriod + 1 + scanPineMaLag(p.maType, p.maLen),
                        hotMoneyMa: p.hotPeriod + 1 + scanPineMaLag(p.maType2, p.maLen2), bankerMaUp: p.bankerPeriod + 2 + scanPineMaLag(p.maType, p.maLen),
                        hotMoneyMaUp: p.hotPeriod + 2 + scanPineMaLag(p.maType2, p.maLen2) }[f]),
    span: (p, f, decay) => (/^hot/.test(f) ? decay(1 / p.hotPeriod) + 1 + (/Ma/.test(f) ? scanPineMaSpan(p.maType2, p.maLen2, decay) : 0)
      : decay(1 / p.bankerPeriod) + 1 + (/Ma/.test(f) ? scanPineMaSpan(p.maType, p.maLen, decay) : 0)),
    sideLabel: (p, f) => scanPineSideLabel('mcdx', p, f),
    formula: '[M2J] MCDX: banker = bankerSens × (RSI(close, bankerPeriod) − bankerBase), held within 0 and 20; hotMoney = hotSens × (RSI(close, '
      + 'hotPeriod) − hotBase), held the same way. The RSI is TradingView’s (Wilder’s smoothing, seeded with the mean of the first n changes; '
      + '100 when nothing fell). bankerMa (Banker_MA) is an average of banker over maLen bars and hotMoneyMa (HotMoney_MA) of hot money over '
      + 'maLen2, of type 1 SMA, 2 EMA, 3 Hull, 4 WMA or 5 VWMA; bankerMaUp and hotMoneyMaUp are 1 when the average is above the bar before. '
      + 'An RSI of 50 bars remembers far back: a history of a few hundred bars has not forgotten where it began, so it can differ from a chart '
      + 'that holds more.',
  },
  color_ma: {
    label: 'Color MA', calcVersion: 1, inputs: ['close'], pine: scanPineColorMa,
    inputsOf: (p) => (p.type === 5 ? ['close', 'volume'] : ['close']),
    params: { n: scanPineInt(200), type: scanPineMaParam(1, { 1: 'SMA', 2: 'EMA', 3: 'HMA', 4: 'WMA', 5: 'VWMA' }) },
    fields: { ma: 'price', direction: 'direction' }, defaultField: 'ma',
    fieldLabels: { ma: '', direction: 'direction' },
    needs: (p, f) => scanPineMaLag(p.type, p.n) + (f === 'direction' ? 2 : 1),
    span: (p, f, decay) => scanPineMaSpan(p.type, p.n, decay) + (f === 'direction' ? 1 : 0),
    check: (p) => (p.type === 3 && p.n < 2 ? 'a Hull average (type 3) needs a length of at least 2' : null),
    sideLabel: (p, f) => `Color MA ${SCAN_PINE_MA_TYPES[p.type]}${p.n}${f === 'direction' ? ' direction' : ''}`,
    formula: 'Color MA: an average of the close over n bars, of type 1 SMA, 2 EMA, 3 Hull (WMA(2 × WMA(n/2) − WMA(n), round(√n))), 4 WMA or 5 VWMA; '
      + 'direction is 1 when it is above the bar before (the script draws it green) and −1 otherwise (red). Your chart uses type 1 over 200 bars.',
  },
  sma_cross: {
    label: 'SMA Cross', calcVersion: 1, inputs: ['close'], pine: scanPineSmaCross,
    params: { fast: scanPineInt(50), slow: scanPineInt(200) },
    fields: { fast: 'price', slow: 'price', crossUp: 'flag', crossDown: 'flag' }, defaultField: 'fast',
    fieldLabels: { fast: (p) => `SMA${p.fast}`, slow: (p) => `SMA${p.slow}`, crossUp: (p) => `SMA${p.fast} crosses over SMA${p.slow}`, crossDown: (p) => `SMA${p.fast} crosses under SMA${p.slow}` },
    needs: (p, f) => (f === 'fast' ? p.fast : f === 'slow' ? p.slow : Math.max(p.fast, p.slow) + 1),
    sideLabel: (p, f) => scanPineSideLabel('sma_cross', p, f, { keys: ['fast', 'slow'], text: 'SMA Cross' }),
    formula: 'SMA Cross: fast = the SMA of the close over `fast` bars, slow = over `slow` bars; crossUp is 1 on the bar fast crosses over slow '
      + '(fast above now, at or below on the bar before) and crossDown on the bar it crosses under — the script’s “Buy” and “Sell” marks. Your '
      + 'chart uses 50 and 200.',
  },
  psar: {
    label: 'Parabolic SAR', calcVersion: 1, inputs: ['high', 'low', 'close'], pine: scanPinePsar,
    params: { start: scanPineNum(0.02, 0.0001, 1), inc: scanPineNum(0.02, 0, 1), max: scanPineNum(0.2, 0.0001, 1) },
    fields: { sar: 'price', direction: 'direction' }, defaultField: 'sar',
    fieldLabels: { sar: '', direction: 'direction' },
    needs: () => 2,
    span: (p, f, decay) => decay(p.start),
    sideLabel: (p, f) => `SAR(${p.start},${p.inc},${p.max})${f === 'direction' ? ' direction' : ''}`,
    formula: 'TradingView’s ta.sar(start, inc, max): from the second bar, up if the close rose and down if not; each bar the SAR moves towards the '
      + 'trend’s extreme by the acceleration, which starts at `start` and grows by `inc` on each new extreme up to `max`; when a bar’s low (in '
      + 'an up trend) or high (in a down trend) crosses it, the trend reverses and the SAR jumps to the extreme. It is kept outside the two bars '
      + 'before. direction is 1 while the SAR is below the bars and −1 while above. It depends on the path, so a history that begins elsewhere '
      + 'agrees with a longer one only after a reversal or two.',
  },
  sr_ma: {
    label: 'SR MA', calcVersion: 1, inputs: ['open', 'high', 'low', 'close'], pine: scanPineSrMa,
    inputsOf: (p) => (p.range === 1 ? ['high', 'low', 'close'] : ['open', 'high', 'low', 'close']),
    params: { length: scanPineInt(20, 0), trigger: scanPineInt(4, 0), atrLen: scanPineInt(200), mult: scanPineNum(6, 0, 100),
              double: scanPineSwitch(1), range: scanPineSwitch(0, { 0: 'Body', 1: 'Wick' }) },
    fields: { ma: 'price', top: 'price', bottom: 'price', direction: 'direction', above: 'flag', below: 'flag', across: 'flag' }, defaultField: 'ma',
    fieldLabels: { ma: '', top: 'top range', bottom: 'bottom range', direction: 'direction', above: 'bar above', below: 'bar below', across: 'bar across' },
    needs: (p, f) => {
      const L1 = p.length + 1, k = scanPineOn(p.double) ? 2 * L1 - 1 : L1;
      return f === 'top' || f === 'bottom' ? p.atrLen + k - 1 : f === 'direction' ? k + 1 : k;
    },
    sideLabel: (p, f) => scanPineSideLabel('sr_ma', p, f, { keys: ['length'], text: `SR MA(${p.length})` }),
    formula: 'Sentiment Range MA [ChartPrime]: a candle’s top and bottom are its body (range Body: the larger and smaller of open and close) or '
      + 'its wick (high and low). A range of mult × the SMA of top − bottom over atrLen bars is set about the close, and held until the SMA of '
      + 'the tops over trigger + 1 bars closes above its top or that of the bottoms below its bottom; then it is set afresh about that bar’s '
      + 'close. ma, top and bottom are the held close and the range’s edges, each filtered by a WMA over length + 1 bars — of their SMA over '
      + 'length + 1 bars when double is on (the settings TradingView shows are length and trigger; the script adds 1 to each). direction is the '
      + 'sign of ma’s change from the bar before; above is 1 while the bar’s low is above ma, below while its high is below, across while it '
      + 'spans it. The held level depends on the path, so a history that begins elsewhere agrees with a longer one only after the range is '
      + 'set afresh on the same bar in both.',
  },
  banker_entry: {
    label: 'Banker Entry', calcVersion: 1, inputs: ['high', 'low', 'close'], pine: scanPineBankerEntry,
    params: { threshold: scanPineInt(3, 1, 100) },
    fields: { model: 'banker_model', crossUp: 'flag', atOrBelow3: 'flag', below5: 'flag' }, defaultField: 'model',
    fieldLabels: { model: 'model', crossUp: (p) => `model crosses over ${p.threshold}`, atOrBelow3: 'model at or below 3', below5: 'model below 5' },
    needs: (p, f) => (f === 'crossUp' ? 36 : 35),
    span: (p, f, decay) => 27 + decay(1 / 5) + decay(1 / 3),
    sideLabel: (p, f) => scanPineSideLabel('banker_entry', p, f),
    formula: '[blackcat] L1 Banker Entry: x = (close − the lowest low of 27 bars) / (the highest high of 27 − that lowest low) × 100; model = '
      + '3 × xsa(x, 5, 1) − 2 × xsa(xsa(x, 5, 1), 3, 1), where xsa(src, len, w) is the script’s own average: seeded with the mean of the last '
      + 'len values (kept as a running sum), then (src × w + previous × (len − w)) / len. crossUp is 1 on the bar the model crosses over the '
      + 'threshold (the script plots 100); atOrBelow3 while the model is at or below 3 (it plots 50) and below5 while below 5 (it plots 25) — '
      + 'those two levels are fixed in the script.',
  },
  tv_rsi: {
    label: 'RSI (TradingView)', calcVersion: 1, inputs: ['close'], pine: scanPineRsiStudy,
    inputsOf: (p) => (p.maType === 5 ? ['close', 'volume'] : ['close']),
    params: { n: scanPineInt(5), maType: scanPineMaParam(1, SCAN_PINE_RSI_MA), maLen: scanPineInt(14), bbMult: scanPineNum(2, 0.001, 50) },
    fields: { rsi: 'osc_0_100', ma: 'osc_0_100', bbUpper: 'osc_0_100', bbLower: 'osc_0_100' }, defaultField: 'rsi',
    fieldLabels: { rsi: '', ma: (p) => `${SCAN_PINE_RSI_MA[p.maType]}${p.maLen}`, bbUpper: 'upper band', bbLower: 'lower band' },
    needs: (p, f) => (f === 'rsi' ? p.n + 1 : f === 'ma' ? p.n + 1 + scanPineMaLag(p.maType === 7 ? 1 : p.maType, p.maLen) : p.n + p.maLen),
    span: (p, f, decay) => decay(1 / p.n) + 1 + (f === 'rsi' ? 0 : scanPineMaSpan(p.maType === 7 ? 1 : p.maType, p.maLen, decay)),
    check: (p, f) => ((f === 'bbUpper' || f === 'bbLower') && p.maType !== 7 ? 'the Bollinger bands of the RSI exist only with maType 7 (SMA + Bollinger Bands)' : null),
    sideLabel: (p, f) => `RSI${p.n} (TradingView)${f === 'rsi' || !f ? '' : f === 'ma' ? ` ${SCAN_PINE_RSI_MA[p.maType]}${p.maLen}` : ` Bollinger ${f === 'bbUpper' ? 'upper' : 'lower'} (${p.maLen}, ${p.bbMult})`}`,
    formula: 'TradingView’s RSI script: the change of the close split into gains and losses, each smoothed by Wilder’s average (seeded with the '
      + 'mean of the first n); RSI = 100 when the smoothed loss is 0 — a window with no change at all included, where the RSI indicator says '
      + 'undefined — 0 when the smoothed gain is 0, else 100 − 100 / (1 + gain / loss). ma (RSI-based MA) is an average of the RSI over maLen '
      + 'bars, of type 1 SMA, 2 EMA, 4 WMA, 5 VWMA, 6 SMMA (RMA) or 7 SMA + Bollinger Bands, whose bands are ma ± bbMult × the population '
      + 'deviation of the RSI over maLen. Your chart uses 5 with an SMA of 14. Divergences are not computed.',
  },
};
/* ---- end pine: indicators ---- */

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
  bb: { label: 'Bollinger', params: { n: scanNP(20), k: { def: 2, min: 0.1, max: 10, integer: false } }, inputs: ['close'], calcVersion: 2,
    fields: { upper: 'price', middle: 'price', lower: 'price', width: 'ratio', pctb: 'position' }, defaultField: 'middle',
    needs: (p) => p.n,
    formula: "middle = the mean of the last n closes; σ = their POPULATION standard deviation (Bollinger's definition — a platform using the sample deviation draws wider bands); upper and lower = middle ± k × σ; width = (upper − lower) / middle; %b = (close − lower) / (upper − lower), undefined when σ is 0 — every close in the window equal, by the float rule" },
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
  /* The reader's TradingView indicators, from the pine section above. */
  ...SCAN_PINE_INDICATORS,
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
    let v = spec[k];
    if (v == null) { params[k] = p.def; continue; }
    /* A parameter with named choices (a Pine indicator's switch or type of
       average) may be given by its name, and a switch as true or false. */
    if (p.options && ((typeof v === 'boolean' && p.min === 0 && p.max === 1) || (typeof v === 'string' && !scanNumeric(v)))) {
      const code = typeof v === 'boolean' ? String(Number(v)) : Object.keys(p.options).find(c => String(p.options[c]).toLowerCase() === v.trim().toLowerCase());
      if (code == null) { problems.push(`${k} "${v}" is not one of ${scanOptionList(p)}`); params[k] = p.def; continue; }
      v = Number(code);
    }
    if (!scanNumeric(v)) { problems.push(`${k === 'n' ? 'period' : k} "${v}" is not a number`); params[k] = p.def; continue; }
    let x = Number(v);
    if (p.integer) x = Math.round(x);
    if (x < p.min || x > p.max) { problems.push(`${k === 'n' ? 'period' : k} ${x} is outside ${p.min}–${p.max}`); params[k] = p.def; continue; }
    if (p.options && !(String(x) in p.options)) { problems.push(`${k} ${x} is not one of ${scanOptionList(p)}`); params[k] = p.def; continue; }
    params[k] = x;
  }
  if (spec.indicator === 'macd' && !problems.length && params.fast >= params.slow) problems.push(`the fast period (${params.fast}) must be shorter than the slow (${params.slow})`);
  if (def.check && !problems.length) { const why = def.check(params, scanFieldOf(spec)); if (why) problems.push(why); }
  return { params, problems };
}
/* A parameter's named choices in words: '0 (off), 1 (on)'. */
const scanOptionList = (p) => Object.entries(p.options).map(([c, name]) => `${c} (${name})`).join(', ');
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
    default: base = def.sideLabel ? def.sideLabel(p, scanFieldOf(s)) : def.label;
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
/* Bollinger bands with the population deviation of the same window.
   A FLAT WINDOW HAS NO BAND. Twenty closes of 0.3 sum to 5.999999999999999
   in binary, so their mean is 0.29999999999999993 and their deviation
   came out 1e-16 rather than 0: the band had a width of noise, and %b
   was 0.75 — a "%b above 0.7" rule matched a counter that had not moved.
   A window whose closes are all equal by the float rule (scanTol) has a
   deviation of exactly 0, so its %b is undefined, as its formula says. */
function scanBb(a, n, k) {
  const len = a.length, mid = scanSma(a, n);
  const upper = new Array(len).fill(null), lower = new Array(len).fill(null), width = new Array(len).fill(null), pctb = new Array(len).fill(null), zd = [];
  for (let i = 0; i < len; i++) {
    const m = mid[i];
    if (m == null) continue;
    let ss = 0, lo = a[i], hi = a[i];
    for (let j = i - n + 1; j <= i; j++) { ss += (a[j] - m) * (a[j] - m); if (a[j] < lo) lo = a[j]; if (a[j] > hi) hi = a[j]; }
    const sd = hi - lo <= scanTol(hi, lo) ? 0 : Math.sqrt(ss / n);
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
   hash it. The values hashed are the adjusted ones; a series read with a
   recorded adjustment also carries that adjustment's name after a '+', so
   a record says it was computed on adjusted prices — and a ratio-1 entry,
   which moves no price but makes a break explained, still changes it. A
   series nobody adjusted reads exactly as it did before adjustments
   existed.
   A week or a month read where the history holds imported bars for it
   (scanFrameBars) carries `origin`, and each line then says where its bar
   came from — and, for an imported one, the file and the instant it was
   captured — so a re-import names a new series even where it moved no
   price, and a record says which bars it was computed on. Bars with no
   `origin` (every daily series, and every week or month where no frame is
   held) hash exactly as they did before imports existed. */
function scanDataVersion(bars, upto = null) {
  const n = bars?.dates?.length || 0;
  const last = upto == null ? n - 1 : Math.min(upto, n - 1);
  const f = (v) => (v == null ? '' : String(v));
  const og = Array.isArray(bars?.origin) ? bars.origin : null;
  const lines = [];
  for (let i = 0; i <= last; i++) {
    const tail = !og ? '' : og[i] === 'imported' ? `|imported|${f(bars.source?.[i])}|${f(bars.capturedAt?.[i])}` : `|${og[i] || 'daily'}`;
    lines.push(`${bars.dates[i]}|${f(bars.open?.[i])}|${f(bars.high?.[i])}|${f(bars.low?.[i])}|${f(bars.closes[i])}|${f(bars.volumes?.[i])}|${bars.status?.[i] || 'UNKNOWN'}${tail}`);
  }
  return `fnv1a:${scanHash(lines.join('\n'))}${bars?.adjustmentVersion ? `+${bars.adjustmentVersion}` : ''}`;
}

/* ------------------------------------------------------------- adjustments -- */
/* CORPORATE ACTIONS, RECORDED BY THE READER. No corporate-action feed is
   held, so a split reaches the history as a price break and nothing more —
   until the reader records it in data/price-adjustments.json (git-ignored,
   beside the history):
     { schema: 1, actions: [{ symbol, date, ratio, kind, note?, recordedAt? }] }
   `date` is the first bar on the new basis; `ratio` is new units per old
   unit — 2 for a 2-for-1 split, 0.5 for a 1-for-2 consolidation. Bars
   before the date have their prices divided by the ratio and their volume
   multiplied by it, ON READ: the history on disk is never rewritten, so a
   wrong ratio is undone by correcting the record, not the prices. A ratio
   of 1 records that a break is the market's own move, not a change of
   basis: it adjusts nothing, and the break stops counting as unexplained.
   An action that cannot be read is refused whole, with its reason; two
   actions for one symbol and date are both refused — the store refuses two
   rows for one date the same way, and neither is guessed between. */
const SCAN_ADJUSTMENT_KINDS = ['split', 'consolidation', 'bonus', 'other'];
function scanReadAdjustments(doc) {
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.actions) ? doc.actions : null;
  const out = { schema: doc && typeof doc === 'object' && !Array.isArray(doc) ? (doc.schema ?? null) : null, actions: [], problems: [], version: 'none' };
  if (!list) {
    if (doc != null) out.problems.push({ index: null, symbol: null, date: null, why: 'no list of actions — the file is { "schema": 1, "actions": [ … ] }' });
    return out;
  }
  const byKey = new Map();
  list.forEach((a, index) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) { out.problems.push({ index, symbol: null, date: null, why: 'not an action: each entry is { symbol, date, ratio, kind }' }); return; }
    const symbol = a.symbol == null ? '' : String(a.symbol).trim().toUpperCase();
    const ratio = scanNumeric(a.ratio) ? Number(a.ratio) : NaN;
    const kind = typeof a.kind === 'string' ? a.kind.trim().toLowerCase() : '';
    const why = [];
    if (!symbol) why.push('no symbol');
    if (!scanIsDay(a.date)) why.push(`date “${a.date ?? ''}” is not a day (YYYY-MM-DD, the first bar on the new basis)`);
    if (!(ratio > 0)) why.push(`ratio “${a.ratio ?? ''}” is not a number above 0 (new units per old unit: 2 for a 2-for-1 split, 0.5 for a 1-for-2 consolidation)`);
    if (!SCAN_ADJUSTMENT_KINDS.includes(kind)) why.push(`kind “${a.kind ?? ''}” is not one of ${SCAN_ADJUSTMENT_KINDS.join(', ')}`);
    if (why.length) { out.problems.push({ index, symbol: symbol || null, date: a.date ?? null, why: why.join('; ') }); return; }
    const act = { symbol, date: a.date, ratio, kind };
    if (a.note != null && a.note !== '') act.note = String(a.note);
    if (a.recordedAt != null && a.recordedAt !== '') act.recordedAt = String(a.recordedAt);
    const k = `${symbol}|${a.date}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push({ index, act });
  });
  byKey.forEach((xs) => {
    if (xs.length === 1) { out.actions.push(xs[0].act); return; }
    xs.forEach(x => out.problems.push({ index: x.index, symbol: x.act.symbol, date: x.act.date,
      why: `${xs.length} actions for ${x.act.symbol} on ${x.act.date} — none of them is applied; keep the one that is right` }));
  });
  out.actions.sort((p, q) => (p.symbol < q.symbol ? -1 : p.symbol > q.symbol ? 1 : p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
  out.problems.sort((p, q) => (p.index ?? -1) - (q.index ?? -1));
  /* Named by what changes arithmetic — symbol, date, ratio — so editing a
     note does not make every run look new. */
  if (out.actions.length) out.version = `adj:${scanHash(out.actions.map(x => `${x.symbol}|${x.date}|${x.ratio}`).join('\n'))}`;
  return out;
}
/* What a loader does with the file: the history with the readable actions
   attached, for scanBars to apply. A copy — the history as read is left as
   it was. Without a file, adjustmentVersion is 'none' and nothing changes. */
function scanAttachAdjustments(history, doc) {
  if (!history || typeof history !== 'object') return history;
  const r = scanReadAdjustments(doc);
  return { ...history, adjustments: r.actions, adjustmentVersion: r.version, adjustmentProblems: r.problems };
}
/* The moves a ratio can be read as a break at: the thresholds of
   scanPriceBreaks. */
const scanIsBreakRatio = (r) => r > 1.5 || r < 1 / 1.5;
/* One series' bars with its recorded actions applied. `providerAdjusted[i]`
   is the capture date of a bar imported as already adjusted by its provider
   (history-import --adjusted provider), else null: such a bar already
   reflects every action dated on or before its export, and is not adjusted
   for it again. A second guard needs no record: an action large enough to
   be a break (above 1.5 or below 0.67) is applied only where the series
   shows a break at its date. Where the close moved less than that across
   the date, the prices are already on the new basis — an adjusted export,
   or the same split recorded twice — and adjusting them again would make
   the break it was meant to remove. Each action says what became of it. */
function scanAdjust(bars, actions, { providerAdjusted = null } = {}) {
  const sym = String(bars?.symbol ?? '').toUpperCase();
  const mine = (Array.isArray(actions) ? actions : [])
    .filter(a => a && String(a.symbol ?? '').toUpperCase() === sym && scanIsDay(a.date) && Number.isFinite(a.ratio) && a.ratio > 0)
    .sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
  if (!mine.length) return { ...bars, adjustments: [], adjustmentVersion: null };
  const n = bars.dates.length;
  const factor = new Array(n).fill(1);
  const record = [];
  for (const a of mine) {
    let j = 0;
    while (j < n && bars.dates[j] < a.date) j++;
    const base = { date: a.date, ratio: a.ratio, kind: a.kind || null, note: a.note ?? null, boundary: j < n ? bars.dates[j] : null, bars: 0 };
    if (j >= n) { record.push({ ...base, state: 'pending', why: `no bar on or after ${a.date} is held yet, so nothing is on the new basis to adjust towards` }); continue; }
    if (j === 0) { record.push({ ...base, state: 'nothing-before', why: `no bar before ${a.date} is held — every bar is already on the new basis` }); continue; }
    if (a.ratio === 1) { record.push({ ...base, state: 'acknowledged', why: `ratio 1: the move from ${bars.dates[j - 1]} to ${bars.dates[j]} is recorded as the market's own, not a change of basis — nothing is adjusted and the break is explained` }); continue; }
    const move = bars.closes[j] / bars.closes[j - 1];
    if (scanIsBreakRatio(a.ratio) && !scanIsBreakRatio(move)) {
      record.push({ ...base, state: 'already-adjusted', why: `the close moved only ×${Number(move.toPrecision(3))} from ${bars.dates[j - 1]} to ${bars.dates[j]}, so the prices are already on the new basis — adjusting them for a ratio of ${a.ratio} would make a break, not remove one` });
      continue;
    }
    let k = 0;
    for (let i = 0; i < j; i++) {
      const pa = providerAdjusted?.[i];
      if (pa && pa >= a.date) continue;
      factor[i] *= a.ratio; k++;
    }
    record.push(k
      ? { ...base, state: 'applied', bars: k, why: `${k} bar${k === 1 ? '' : 's'} before ${bars.dates[j]}: prices divided by ${a.ratio}, volume multiplied by it` }
      : { ...base, state: 'already-adjusted', why: `every bar before ${bars.dates[j]} was imported already adjusted by its provider after ${a.date}` });
  }
  const div = (arr) => (Array.isArray(arr) ? arr.map((v, i) => (v == null || factor[i] === 1 ? v : v / factor[i])) : arr);
  const took = record.filter(r => r.state === 'applied' || r.state === 'acknowledged');
  return { ...bars, closes: div(bars.closes), open: div(bars.open), high: div(bars.high), low: div(bars.low),
           volumes: Array.isArray(bars.volumes) ? bars.volumes.map((v, i) => (v == null || factor[i] === 1 ? v : v * factor[i])) : bars.volumes,
           adjustments: record, adjustmentVersion: took.length ? `adj:${scanHash(took.map(r => `${r.date}|${r.ratio}`).join('\n'))}` : null };
}
/* Every close-to-close break in a series, raw and after adjustment, with
   what explains it: 'adjusted' (a recorded action at its date brings the
   move inside the band), 'acknowledged' (recorded with ratio 1 as the
   market's own move), 'remains' (an action was applied and the move is
   still a break — the ratio recorded is not the one that happened),
   'created' (a break only the adjusted series has) or 'unexplained'.
   The last three are the ones no indicator window may span. */
function scanExplainBreaks(raw, adj) {
  const byBoundary = new Map((adj.adjustments || []).filter(a => a.boundary).map(a => [a.boundary, a]));
  const actionOf = (bar) => { const a = byBoundary.get(bar); return a ? { date: a.date, ratio: a.ratio, kind: a.kind, state: a.state } : null; };
  const after = new Map(scanPriceBreaks(adj).map(b => [b.bar, b]));
  const out = scanPriceBreaks(raw).map(b => {
    const action = actionOf(b.bar), left = after.get(b.bar);
    after.delete(b.bar);
    const state = action?.state === 'acknowledged' ? 'acknowledged' : action?.state === 'applied' ? (left ? 'remains' : 'adjusted') : 'unexplained';
    return { ...b, state, action, adjustedRatio: action?.state === 'applied' ? adj.closes[b.at] / adj.closes[b.at - 1] : null };
  });
  after.forEach(b => out.push({ ...b, state: 'created', action: actionOf(b.bar), adjustedRatio: b.ratio }));
  return out.sort((p, q) => p.at - q.at);
}
const SCAN_BREAK_OPEN = ['unexplained', 'remains', 'created'];

/* An instrument's bars from the history file. Schema 1 holds
   { series: {SYM: {date: close}}, volume: {SYM: {date: v}} }; schema 2 adds,
   each optional, ohlc {SYM: {date: [open, high, low]}}, meta {SYM: {date:
   {src, at}}} and corrections {SYM: [{date, …}]} — read additively, so a
   close-only history reads exactly as before. Every bar is validated; a bad
   one is listed in `invalid` with its codes and left out, never silently
   dropped and never made the last bar. With a clock, each bar gets a status
   and the series is marked stale when its last final bar is older than the
   session that should be held by now.

   ADJUSTED ON READ. When a loader has attached the reader's recorded
   corporate actions (history.adjustments, scanAttachAdjustments), they are
   applied here — after validation, which judges each bar as it was
   captured — so every caller reads adjusted bars without knowing it.
   `breaks` lists each close-to-close break with what explains it, and
   breakBefore[i] is 1 where an unexplained one falls between bar i−1 and
   bar i: no indicator window is computed across it.

   TIMESTAMPS ARE RESERVED. A daily bar is named by its session date, and
   its instant would be the session's close, which scanSessionEnd gives on
   demand; `timestamps` holds null for every daily and weekly bar. The
   array exists so an intraday bar, which a date cannot name, has a place
   to carry its instant when a licensed intraday feed exists (SC-317).

   WHERE A SERIES CAME FROM. A condition read on a higher timeframe than
   its setup's builds that timeframe's bars from the same daily bars, on the
   same calendar (scanFrame). Every series scanBars returns — the daily one,
   a week or a month resampled from it, a slice of any — carries the same
   `calendar` object, so that object names the daily bars and the calendar
   they were read with, without a field any record or digest would see.
   The entry holds the imported weeks and months the history keeps for the
   symbol as well (`frames`, scanFramesOf) and the clock the bars were read
   at, so a condition read on a higher timeframe merges exactly the bars a
   weekly or monthly setup of the same symbol reads (scanFrameBars). */
const SCAN_BARS_SOURCE = new WeakMap();
function scanBars(history, symbol, { timeframe = '1D', market = undefined, instruments = null, now = null, calendar = null, staleTolerance = 0 } = {}) {
  const mk = market !== undefined ? market : (instruments ? scanMarketOf(symbol, instruments) : null);
  const s = history?.series?.[symbol] || {}, v = history?.volume?.[symbol] || {};
  const o = history?.ohlc?.[symbol] || {}, meta = history?.meta?.[symbol] || {};
  const corrected = new Set((Array.isArray(history?.corrections?.[symbol]) ? history.corrections[symbol] : []).map(c => c?.date).filter(Boolean));
  const clock = now != null && Number.isFinite(scanMs(now));
  const today = clock ? scanSessionToday(mk, now) : null;
  /* A session closes at most half an hour past midnight (a 24:00 close, or
     a close with its settle), so only a bar dated from the day before the
     market's own date at `now` can still be open by then: the rest skip the
     zone arithmetic, which at 2,000 series of 500 bars cost seconds. */
  const openFrom = clock ? scanAddDays(today, -1) : null;
  const cal = calendar || scanWeekdayCalendar(mk);
  let b = { symbol, market: mk, instrumentId: mk ? `${String(mk).toUpperCase()}:${String(symbol).toUpperCase()}` : null, timeframe: '1D',
              dates: [], timestamps: [], closes: [], volumes: [], open: [], high: [], low: [], status: [], source: [], capturedAt: [],
              invalid: [], gapBefore: [], breakBefore: [], breaks: [], adjustments: [], adjustmentVersion: null, hasOHLC: false, gapTolerance: cal.tolerance ?? 0,
              calendar: { basis: cal.basis, text: cal.text }, stale: null, dataVersion: null };
  const providerAdjusted = [];
  for (const d of Object.keys(s).sort()) {
    const row = Array.isArray(o[d]) ? o[d] : null;
    const px = (x) => (x == null ? null : typeof x === 'number' ? x : NaN);
    const bar = { date: d, open: row ? px(row[0]) : null, high: row ? px(row[1]) : null, low: row ? px(row[2]) : null,
                  close: typeof s[d] === 'number' ? s[d] : NaN, volume: v[d] == null ? null : typeof v[d] === 'number' ? v[d] : NaN };
    const codes = scanValidateBar(bar, { market: mk, today });
    if (codes.length) { b.invalid.push({ date: d, codes }); continue; }
    b.dates.push(d); b.timestamps.push(null); b.closes.push(bar.close); b.volumes.push(bar.volume);
    b.open.push(bar.open); b.high.push(bar.high); b.low.push(bar.low);
    if (scanOk(bar.high) && scanOk(bar.low)) b.hasOHLC = true;
    const m = meta[d] && typeof meta[d] === 'object' ? meta[d] : {};
    b.status.push(corrected.has(d) || m.status === 'CORRECTED' ? 'CORRECTED' : scanBarStatus(mk, d, m.at, clock && d >= openFrom ? now : null));
    b.source.push(m.src ?? null); b.capturedAt.push(m.at ?? null);
    /* An export the provider had already adjusted (history-import
       --adjusted provider) reflects every action up to the day it was
       made; with no capture time, every action. */
    providerAdjusted.push(m.adjusted === 'provider' ? (m.at != null && Number.isFinite(scanMs(m.at)) ? scanLocalDate(mk, m.at) : '9999-12-31') : null);
  }
  const acts = Array.isArray(history?.adjustments) ? history.adjustments : null;
  const adj = acts && acts.length ? scanAdjust(b, acts, { providerAdjusted }) : b;
  b.breaks = scanExplainBreaks(b, adj);
  if (adj !== b) b = { ...adj, breaks: b.breaks };
  const open = new Set(b.breaks.filter(x => SCAN_BREAK_OPEN.includes(x.state)).map(x => x.at));
  b.breakBefore = b.dates.map((_, i) => (open.has(i) ? 1 : 0));
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
  const frames = scanFramesOf(history, symbol, { market: mk });
  SCAN_BARS_SOURCE.set(b.calendar, { cal, daily: b, now: clock ? now : null, frames });
  const T = scanTimeframe(timeframe);
  return T === '1W' || T === '1M' ? scanFrameBars(b, T, { calendar: cal, now, frame: frames?.[T] || null }) : b;
}
/* Bars from a bare list of closes (and, optionally, volumes, highs and
   lows) with no dates checked and no calendar: the trend context's input,
   which reads a series the page already holds. Nothing is cached on it. */
function scanSeriesBars(closes, { dates = null, volumes = null, open = null, high = null, low = null } = {}) {
  const n = closes.length, nil = () => new Array(n).fill(null);
  const hi = high || nil(), lo = low || nil();
  return { symbol: null, market: null, instrumentId: null, timeframe: '1D', dates: dates || closes.map((_, i) => String(i)), timestamps: nil(), closes,
           volumes: volumes || nil(), open: open || nil(), high: hi, low: lo, status: new Array(n).fill('UNKNOWN'),
           source: nil(), capturedAt: nil(), invalid: [], gapBefore: new Array(n).fill(0), breakBefore: new Array(n).fill(0), breaks: [],
           adjustments: [], adjustmentVersion: null,
           hasOHLC: hi.some(scanOk) && lo.some(scanOk), gapTolerance: 0, calendar: null, stale: null, dataVersion: null };
}
/* The first n bars, as though the history ended there — what historical
   testing's no-look-ahead check compares against. */
function scanSliceBars(bars, n) {
  const cut = (a) => (Array.isArray(a) ? a.slice(0, n) : a);
  const out = { ...bars };
  ['dates', 'timestamps', 'closes', 'volumes', 'open', 'high', 'low', 'status', 'source', 'capturedAt', 'gapBefore', 'breakBefore', 'complete', 'missingDays', 'origin'].forEach(k => { if (k in bars) out[k] = cut(bars[k]); });
  if (Array.isArray(bars.breaks)) out.breaks = bars.breaks.filter(x => x.at < n);
  out.stale = null;
  out.dataVersion = scanDataVersion(out);
  return out;
}

/* WEEKLY AND MONTHLY BARS FROM DAILY ONES. A week is its ISO week (Monday
   first) and a month its calendar month, and the dates are already session
   dates in the market's own zone, so no time zone arithmetic is needed.
   Open is the first session's, high the highest, low the lowest, close the
   last; volume is the sum only when every expected session of the period
   is held with a volume — a missing day is not a day of nought. The bar is
   dated by its last held session.
   A period is COMPLETE when a later one is held, or when its last expected
   session (by the calendar) is held. An incomplete period is PROVISIONAL,
   so a week or a month in progress never confirms a match; when a Friday
   is a holiday the week closes on the Thursday, and a month whose last
   weekday is one closes on the session before. A month's last session has
   closed only when its bar is final: a bar captured before the close is
   PROVISIONAL, and so is its month. gapBefore counts whole periods with
   sessions that no bar covers. The daily bars arrive already adjusted, and
   an unexplained daily break marks the period it falls in: breaks keep
   their daily dates, with `at` the period's index. */
const scanWeekOf = (d) => scanAddDays(d, -((scanWeekday(d) + 6) % 7));
const scanMonthOf = (d) => `${d.slice(0, 7)}-01`;
function scanResample(bars, tf = '1W', { calendar = null, now = null } = {}) {
  const T = scanTimeframe(tf);
  if (T !== '1W' && T !== '1M') return bars;
  const periodOf = T === '1M' ? scanMonthOf : scanWeekOf;
  /* The calendar days of the period starting on `start`, and the start of
     the next: seven from a Monday, or every day of a month (from the 1st,
     31 days on is always in the next month). */
  const daysOf = (start) => { const out = []; for (let d = start; periodOf(d) === start; d = scanAddDays(d, 1)) out.push(d); return out; };
  const nextOf = (start) => (T === '1M' ? scanMonthOf(scanAddDays(start, 31)) : scanAddDays(start, 7));
  const cal = calendar || scanWeekdayCalendar(bars.market);
  const groups = [];
  bars.dates.forEach((d, i) => { const wk = periodOf(d); const g = groups[groups.length - 1]; if (g && g.wk === wk) g.idx.push(i); else groups.push({ wk, idx: [i] }); });
  const weekOf = new Map();
  groups.forEach((g, gi) => g.idx.forEach(i => weekOf.set(i, gi)));
  const w = { symbol: bars.symbol, market: bars.market, instrumentId: bars.instrumentId, timeframe: T,
              dates: [], timestamps: [], closes: [], volumes: [], open: [], high: [], low: [], status: [], source: [], capturedAt: [],
              complete: [], missingDays: [], invalid: bars.invalid || [], gapBefore: [], breakBefore: [],
              breaks: (bars.breaks || []).map(x => ({ ...x, at: weekOf.get(x.at) ?? x.at })), adjustments: bars.adjustments || [], adjustmentVersion: bars.adjustmentVersion ?? null,
              hasOHLC: bars.hasOHLC, gapTolerance: 0, calendar: bars.calendar, stale: null, dataVersion: null, fromDaily: bars.dataVersion };
  const all = (a) => a.every(scanOk);
  groups.forEach((g, gi) => {
    const idx = g.idx, first = idx[0], last = idx[idx.length - 1];
    const lastHeld = bars.dates[last];
    const expected = daysOf(g.wk).filter(d => scanIsSession(cal, d));
    const lastExpected = expected[expected.length - 1] || lastHeld;
    const later = gi < groups.length - 1;
    const complete = later || lastHeld >= lastExpected;
    const held = new Set(idx.map(i => bars.dates[i]));
    const missing = expected.filter(d => !held.has(d) && (complete || d < lastHeld));
    const hs = idx.map(i => bars.high[i]), ls = idx.map(i => bars.low[i]), vs = idx.map(i => bars.volumes[i]);
    const sts = idx.map(i => bars.status[i]);
    w.dates.push(lastHeld); w.timestamps.push(null);
    w.breakBefore.push(idx.some(i => bars.breakBefore?.[i]) ? 1 : 0);
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
      for (let wk = nextOf(groups[gi - 1].wk), k = 0; wk < g.wk && k < 600; wk = nextOf(wk), k++) {
        if (daysOf(wk).some(d => scanIsSession(cal, d))) gap++;
      }
    }
    w.gapBefore.push(gap);
  });
  /* A daily series that is behind is behind in weeks and months too: its
     last complete period is the one marked stale. */
  if (bars.stale) {
    let at = w.dates.length - 1;
    while (at >= 0 && w.status[at] === 'PROVISIONAL') at--;
    if (at >= 0) w.stale = { ...bars.stale, at };
  }
  w.dataVersion = scanDataVersion(w);
  return w;
}

/* IMPORTED WEEKS AND MONTHS (the reader's decision of 2026-09-29). The
   daily store keeps 2,000 sessions, about 92 months, so a monthly EMA 200
   can never be built from it; a TradingView export of the weekly or the
   monthly chart reaches back as far as the chart was scrolled — 300 weeks
   are nearly six years, 300 months twenty-five. The history keeps such an
   export beside the daily series (history.frames, written through the
   store by ingest/history-import.mjs), each bar filed under the engine's
   own period key: scanWeekOf, the Monday, or scanMonthOf, the 1st. Where a
   symbol holds one, its weekly and monthly bars are read from it, and are
   built from its daily bars only for the periods it does not hold
   (scanFrameBars).
   scanFramesOf is what the history keeps for one symbol: per timeframe,
   the frame's maps, the periods its own corrections name, its first and
   last period — or null when it keeps none. A frame is REFUSED — held and
   not read — when the reader has recorded a corporate action for the
   symbol dated inside or after the frame's periods and the frame is not
   recorded as adjusted by its provider on or after that date (the rule
   scanAdjust applies to a daily bar imported --adjusted provider): the
   daily bars are adjusted for the action on read, the imported ones would
   not be, and weeks half on one basis and half on the other are never
   mixed silently. A ratio-1 record moves no price and refuses nothing.
   The refusal says why; the weeks are then built from the daily bars. */
function scanFramesOf(history, symbol, { market = null } = {}) {
  const all = history?.frames;
  if (!all || typeof all !== 'object') return null;
  const obj = (m) => (m && typeof m === 'object' && !Array.isArray(m) ? m : {});
  const SYM = String(symbol).toUpperCase();
  const acts = (Array.isArray(history.adjustments) ? history.adjustments : [])
    .filter(a => a && String(a.symbol ?? '').toUpperCase() === SYM && scanIsDay(a.date) && Number.isFinite(a.ratio) && a.ratio > 0 && a.ratio !== 1)
    .sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
  let out = null;
  for (const tf of ['1W', '1M']) {
    const f = obj(all[tf])[symbol];
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
    const series = obj(f.series), keys = Object.keys(series).sort();
    if (!keys.length) continue;
    const meta = obj(f.meta);
    const frame = { timeframe: tf, symbol, series, ohlc: obj(f.ohlc), volume: obj(f.volume), meta,
                    corrected: new Set((Array.isArray(f.corrections) ? f.corrections : []).map(c => c?.date).filter(Boolean)),
                    first: keys[0], last: keys[keys.length - 1], periods: keys.length, refused: null };
    const unit = tf === '1M' ? 'monthly' : 'weekly';
    for (const a of acts) {
      if (a.date < frame.first) continue;
      const adjustedAfter = keys.every(k => {
        const m = obj(meta[k]);
        if (m.adjusted !== 'provider') return false;
        return !(m.at != null && Number.isFinite(scanMs(m.at))) || scanLocalDate(market, m.at) >= a.date;
      });
      if (adjustedAfter) continue;
      frame.refused = { timeframe: tf, action: { date: a.date, ratio: a.ratio, kind: a.kind || null },
        reason: `your record of a ${a.kind || 'corporate action'} of ratio ${a.ratio} on ${a.date} falls inside or after the imported ${unit} bars (${frame.first} … ${frame.last}), which are not recorded as adjusted by their provider after it — your daily bars are adjusted for it on read and the imported ones would not be, so the ${unit} bars are built from your daily bars instead` };
      break;
    }
    (out ||= {})[tf] = frame;
  }
  return out;
}
/* A WEEK OR A MONTH, IMPORTED OR BUILT. The one builder of weekly and
   monthly bars — scanBars' (a weekly or monthly setup's own bars) and
   scanFrame's (a condition read on a higher timeframe), so the two read
   identical bars. With no frame it is scanResample, and returns exactly
   what scanResample returns. With one, per period (the engine's keys,
   scanWeekOf and scanMonthOf):
   - the imported bar is read where the frame holds the period and the bar
     is not PROVISIONAL. Its status is the daily rule's (scanBarStatus) on
     the period's last expected session on the calendar, with the instant
     the bar was captured and, as heldAt, the instant the history is read
     at; CORRECTED where the frame's own corrections name the period. A
     period whose last expected session had not closed when the history is
     read is PROVISIONAL whatever its capture time says: a replay
     (scanTruncateHistory) keeps the frame's week in progress with values
     captured after it, and the history as it stood then held no such bar.
     Each imported bar is validated as a daily one (scanValidateBar), on
     its period's first weekday — a period in progress is not FUTURE, one
     not yet begun is — and an invalid one, or one filed under a key that
     is not the engine's, is listed in `invalid` and left out.
   - a PROVISIONAL imported bar gives way to the bar built from the daily
     bars for the same period where there is one (the daily series has
     moved on since the export); otherwise it stays, PROVISIONAL, and is
     never read: a condition refuses it (PROVISIONAL_BAR) and a run
     evaluates the bar before it.
   - bars built from the daily ones (scanResample) fill every period the
     frame does not hold: before its first, after its last, and any gap.
   An imported bar is dated by its period's last expected session — the
   date a complete built bar gets once that session is held — or by the
   last daily bar the symbol holds in the period where that is later (a
   day the calendar calls ambiguous), and is
   complete (unless PROVISIONAL) with no missing days. Every bar says where
   it came from (`origin`: 'imported' or 'daily'), with its source (for an
   imported bar, the frame's: the export file). gapBefore counts the whole
   periods with sessions and no bar between two merged bars, on the
   calendar; a daily break marks the period it falls in, found by its key;
   the series is stale when its daily bars are, as scanResample decides.
   dataVersion covers the origins as well (scanDataVersion). Where a frame
   is held but refused (scanFramesOf), the bars are the built ones, each
   'daily', and say why (`frameRefused`). */
function scanFrameBars(daily, tf = '1W', { calendar = null, now = null, frame = null } = {}) {
  const T = scanTimeframe(tf);
  const built = scanResample(daily, T, { calendar, now });
  if (!frame || typeof frame !== 'object' || (T !== '1W' && T !== '1M') || (frame.timeframe && scanTimeframe(frame.timeframe) !== T)) return built;
  if (frame.refused) {
    const r = { ...built, origin: built.dates.map(() => 'daily'), frameRefused: { ...frame.refused } };
    r.dataVersion = scanDataVersion(r);
    return r;
  }
  const mk = daily.market;
  const M = scanMarket(mk);
  const cal = calendar || scanWeekdayCalendar(mk);
  const periodOf = T === '1M' ? scanMonthOf : scanWeekOf;
  const daysOf = (start) => { const out = []; for (let d = start; periodOf(d) === start; d = scanAddDays(d, 1)) out.push(d); return out; };
  const nextOf = (start) => (T === '1M' ? scanMonthOf(scanAddDays(start, 31)) : scanAddDays(start, 7));
  const hasSession = (p) => daysOf(p).some(d => scanIsSession(cal, d));
  /* The period's last expected session; a period the calendar gives none
     (a week an inferred calendar reads as all holidays, which the export
     says traded) is dated by its last weekday of the market. */
  const lastExpectedOf = (p) => {
    const ds = daysOf(p), s = ds.filter(d => scanIsSession(cal, d));
    return s.length ? s[s.length - 1] : ds.filter(d => M.days.includes(scanWeekday(d))).pop() || ds[ds.length - 1];
  };
  const clock = now != null && Number.isFinite(scanMs(now));
  const today = clock ? scanSessionToday(mk, now) : null;
  const corrected = frame.corrected instanceof Set ? frame.corrected
    : new Set((Array.isArray(frame.corrections) ? frame.corrections : []).map(c => c?.date).filter(Boolean));
  const px = (x) => (x == null ? null : typeof x === 'number' ? x : NaN);
  const invalid = [];
  const imp = new Map();
  const bi = new Map();
  built.dates.forEach((d, k) => bi.set(periodOf(d), k));
  const series = frame.series && typeof frame.series === 'object' ? frame.series : {};
  for (const p of Object.keys(series).sort()) {
    if (!scanIsDay(p) || periodOf(p) !== p) { invalid.push({ date: p, codes: [scanIsDay(p) ? 'NOT_PERIOD_KEY' : 'BAD_DATE'], timeframe: T, origin: 'imported' }); continue; }
    const row = Array.isArray(frame.ohlc?.[p]) ? frame.ohlc[p] : null;
    const v = frame.volume?.[p];
    const opens = daysOf(p).find(d => M.days.includes(scanWeekday(d))) || p;
    const bar = { date: opens, open: row ? px(row[0]) : null, high: row ? px(row[1]) : null, low: row ? px(row[2]) : null,
                  close: typeof series[p] === 'number' ? series[p] : NaN, volume: v == null ? null : typeof v === 'number' ? v : NaN };
    const codes = scanValidateBar(bar, { market: mk, today });
    if (codes.length) { invalid.push({ date: p, codes, timeframe: T, origin: 'imported' }); continue; }
    /* The imported bar closes on its period's last expected session — or
       on the last daily bar the symbol holds in the period, when that is
       later: a day an inferred calendar calls ambiguous (too few of the
       market's series hold it to call it a session) is in the export's
       week when the symbol traded it, and the week built from the daily
       bars is dated by it. Dated by the calendar alone, the imported week
       was read on the Thursday's close with the Friday's close already in
       it — historical testing read a day ahead of a history cut that
       Thursday. */
    const le = lastExpectedOf(p), held = bi.has(p) ? built.dates[bi.get(p)] : null;
    const last = held && held > le ? held : le;
    const m = frame.meta?.[p] && typeof frame.meta[p] === 'object' ? frame.meta[p] : {};
    const status = clock && scanMs(now) < scanSessionEnd(mk, last) ? 'PROVISIONAL'
      : corrected.has(p) || m.status === 'CORRECTED' ? 'CORRECTED' : scanBarStatus(mk, last, m.at, clock ? now : null);
    imp.set(p, { ...bar, date: last, status, src: m.src ?? null, at: m.at ?? null });
  }
  const keys = [...new Set([...bi.keys(), ...imp.keys()])].sort();
  const w = { symbol: built.symbol, market: built.market, instrumentId: built.instrumentId, timeframe: T,
              dates: [], timestamps: [], closes: [], volumes: [], open: [], high: [], low: [], status: [], source: [], capturedAt: [],
              complete: [], missingDays: [], origin: [], invalid: [...(built.invalid || []), ...invalid], gapBefore: [], breakBefore: [],
              breaks: [], adjustments: built.adjustments, adjustmentVersion: built.adjustmentVersion ?? null,
              hasOHLC: !!built.hasOHLC, gapTolerance: 0, calendar: built.calendar, stale: null, dataVersion: null, fromDaily: built.fromDaily };
  const at = new Map();
  keys.forEach((p, gi) => {
    const I = imp.get(p), k = bi.get(p);
    at.set(p, w.dates.length);
    if (I && (I.status !== 'PROVISIONAL' || k == null)) {
      w.dates.push(I.date); w.open.push(I.open); w.high.push(I.high); w.low.push(I.low); w.closes.push(I.close); w.volumes.push(I.volume);
      w.status.push(I.status); w.source.push(I.src); w.capturedAt.push(I.at); w.complete.push(I.status !== 'PROVISIONAL'); w.missingDays.push([]); w.origin.push('imported');
      if (scanOk(I.high) && scanOk(I.low)) w.hasOHLC = true;
    } else {
      w.dates.push(built.dates[k]); w.open.push(built.open[k]); w.high.push(built.high[k]); w.low.push(built.low[k]); w.closes.push(built.closes[k]); w.volumes.push(built.volumes[k]);
      w.status.push(built.status[k]); w.source.push(built.source[k]); w.capturedAt.push(built.capturedAt[k]); w.complete.push(built.complete[k]); w.missingDays.push(built.missingDays[k]); w.origin.push('daily');
    }
    w.timestamps.push(null);
    w.breakBefore.push(k != null ? built.breakBefore[k] : 0);
    let gap = 0;
    if (gi > 0) for (let q = nextOf(keys[gi - 1]), n = 0; q < p && n < 600; q = nextOf(q), n++) if (hasSession(q)) gap++;
    w.gapBefore.push(gap);
  });
  w.breaks = (daily.breaks || []).map(x => ({ ...x, at: (scanIsDay(x.bar) ? at.get(periodOf(x.bar)) : null) ?? x.at }));
  if (daily.stale) {
    let a = w.dates.length - 1;
    while (a >= 0 && w.status[a] === 'PROVISIONAL') a--;
    if (a >= 0) w.stale = { ...daily.stale, at: a };
  }
  w.dataVersion = scanDataVersion(w);
  return w;
}

/* Close-to-close moves too large to be a day's trading: above 1.5× or
   below 0.67×, the thresholds the statement rule uses for a share-count
   break. Tagged with the nearest plain split ratio when within 2%, else
   'unexplained'. This names the break; it adjusts nothing. A tag is a
   resemblance, not a record: `suggestedRatio` is the ratio a reader would
   record for it (new units per old — 2 for a close that halved), null when
   it resembles no plain ratio. `at` is the index of the bar after the
   break. */
function scanPriceBreaks(bars) {
  const out = [];
  for (let i = 1; i < (bars?.closes?.length || 0); i++) {
    const a = bars.closes[i - 1], c = bars.closes[i];
    if (!(a > 0 && c > 0)) continue;
    const r = c / a;
    if (!scanIsBreakRatio(r)) continue;
    let tag = 'unexplained', suggestedRatio = null;
    for (const k of [2, 3, 4, 5, 10]) {
      if (Math.abs(r * k - 1) <= 0.02) { tag = `split ${k}-for-1`; suggestedRatio = k; break; }
      if (Math.abs(r / k - 1) <= 0.02) { tag = `consolidation 1-for-${k}`; suggestedRatio = 1 / k; break; }
    }
    out.push({ at: i, bar: bars.dates[i], prev: bars.dates[i - 1], ratio: r, pct: (r - 1) * 100, tag, suggestedRatio });
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
  UNADJUSTED_BREAK: 'the window spans a price break no recorded adjustment explains (a split, a consolidation or a bad bar), so nothing is computed across it',
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
/* How far back a price break still moves an indicator's value. A windowed
   indicator — an average, a band, a range, a change, a volume ratio —
   forgets a bar once it leaves the window, so the span is what it needs.
   A recursive one never forgets a bar entirely: an EMA carries a fraction
   (1 − k) of every earlier value forward, Wilder's RSI and ATR a fraction
   (1 − 1/n), and MACD is built from EMAs. For those the break counts as
   inside the window until its weight in the value has fallen below 1% —
   116 bars for EMA50, 64 for RSI14, 81 for MACD's signal line. */
function scanBreakSpan(id, params, field, needs) {
  const decay = (k) => (k > 0 && k < 1 ? Math.ceil(Math.log(0.01) / Math.log(1 - k)) : 0);
  switch (id) {
    case 'ema': return Math.max(needs, decay(2 / (params.n + 1)));
    case 'rsi': case 'atr': return Math.max(needs, decay(1 / params.n) + 1);
    case 'macd': return Math.max(needs, decay(2 / (params.slow + 1)) + (field === 'signal' || field === 'hist' ? decay(2 / (params.signal + 1)) : 0));
    /* A Pine indicator states its own (SCAN_PINE_INDICATORS' span). */
    default: { const span = SCAN_INDICATORS[id]?.span; return span ? Math.max(needs, span(params, field, decay)) : needs; }
  }
}
/* The break a window spans, in words: the move, its dates and what it looks
   like, so the reader can tell a split they can record from a bad bar. */
function scanBreakNote(bars, j, lead) {
  const br = (bars?.breaks || []).find(x => x.at === j && SCAN_BREAK_OPEN.includes(x.state));
  const move = br ? `×${Number(br.ratio.toPrecision(3))}` : 'a break';
  const why = br?.state === 'remains' ? `, which the adjustment recorded for it does not remove — check its ratio in data/price-adjustments.json`
    : br?.state === 'created' ? `, which the adjustment recorded there makes — check its ratio in data/price-adjustments.json`
    : `, which no recorded adjustment explains — record it in data/price-adjustments.json and it is adjusted`;
  return `${lead} the move of ${move} from ${br?.prev || bars.dates[j - 1]} to ${br?.bar || bars.dates[j]}${br?.tag && br.tag !== 'unexplained' ? ` (it looks like a ${br.tag})` : ''}${why}`;
}
function scanComputeSeries(id, params, field, bars, needs) {
  const def = SCAN_INDICATORS[id];
  const len = bars?.closes?.length || 0;
  const closes = bars?.closes || [], vols = bars?.volumes || new Array(len).fill(null);
  const values = new Array(len).fill(null), status = new Array(len).fill('VALID'), reason = new Array(len).fill(null);
  const whole = (st, code, note, extra = {}) => ({ values, status: status.fill(st), reason: reason.fill({ code, note }), ...extra });
  /* What it reads can turn on a parameter (a VWMA reads volume; a Pine
     indicator reading a candle's body reads its open). */
  const inputs = def.inputsOf ? def.inputsOf(params) : def.inputs;
  const usesVol = inputs.includes('volume'), usesHL = inputs.includes('high') || inputs.includes('low'), usesOpen = inputs.includes('open');
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
    default:
      /* The reader's TradingView indicators: one run of the script gives
         every field. A value it leaves na once the warm-up is past is not a
         warm-up but the formula's own blank, and says so. */
      if (def.pine) {
        raw = def.pine(bars, params).fields[field] || new Array(len).fill(null);
        for (let i = Math.max(0, needs - 1); i < len; i++) if (!scanOk(raw[i])) zd.push(i);
      } else raw = new Array(len).fill(null);
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
    hlMiss[j + 1] = hlMiss[j] + (scanOk(bars?.high?.[j]) && scanOk(bars?.low?.[j]) && (!usesOpen || scanOk(bars?.open?.[j])) ? 0 : 1);
  }
  /* Unexplained price breaks (scanBars marks breakBefore[j] for a break
     between bar j−1 and bar j that no recorded adjustment explains). A
     window that spans one would average two price bases as one series —
     a 2-for-1 split reads as a halving, and every average, RSI and range
     across it is a number about nothing — so the value is INVALID_INPUT
     UNADJUSTED_BREAK, never computed. The span is scanBreakSpan's; bars
     built from a bare list of closes (the trend context) carry no marks. */
  const span = scanBreakSpan(id, params, field, needs);
  const brPre = new Array(len + 1).fill(0), brLast = new Array(len).fill(-1);
  for (let j = 0; j < len; j++) {
    const hit = bars?.breakBefore?.[j] ? 1 : 0;
    brPre[j + 1] = brPre[j] + hit;
    brLast[j] = hit ? j : j > 0 ? brLast[j - 1] : -1;
  }
  const zdNote = id === 'rsi' ? 'a window with neither a gain nor a loss has no RSI'
    : id === 'bb' ? 'the band has no width (every close in the window is equal), so %b is undefined'
    : id === 'rvol' ? 'the reference volume is 0, so relative volume is undefined'
    : def.pine ? 'the formula has no value on this bar — TradingView would plot nothing here (a division by zero, or a high, low or open missing from the bars it still remembers)'
    : 'the formula divides by zero here';
  for (let i = 0; i < len; i++) {
    const from = i - needs + 1;
    if (from < 0) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'NEEDS_BARS', note: null }; continue; }
    const gaps = gapPre[i + 1] - gapPre[from + 1];
    if (gaps > 0) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'MISSING_SESSION', note: `${gaps} gap${gaps === 1 ? '' : 's'} of missing sessions inside its ${needs}-bar window` }; continue; }
    const bFrom = Math.max(0, i - span + 1);
    if (brPre[i + 1] - brPre[bFrom + 1] > 0) { status[i] = 'INVALID_INPUT'; reason[i] = { code: 'UNADJUSTED_BREAK', note: scanBreakNote(bars, brLast[i], `its ${span}-bar window spans`) }; continue; }
    if (usesVol) {
      const k = volMiss[i + 1] - volMiss[from];
      if (k > 0) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'NO_VOLUME', note: needs === 1 ? 'volume is not recorded for the last bar' : `volume is not recorded for ${k} of the last ${needs} bars` }; continue; }
    }
    if (usesHL) {
      const hlFrom = id === 'atr' ? Math.max(0, from) : from;
      const k = hlMiss[i + 1] - hlMiss[hlFrom];
      if (k > 0) { status[i] = 'INVALID_INPUT'; reason[i] = { code: 'NO_HIGH_LOW', note: `${usesOpen ? 'open, high and low are' : 'high and low are'} not held for ${k} of the last ${needs} bars` }; continue; }
    }
    if (zdSet.has(i)) { status[i] = 'INVALID_INPUT'; reason[i] = { code: 'ZERO_DENOMINATOR', note: zdNote }; continue; }
    if (!scanOk(raw[i])) { status[i] = 'INSUFFICIENT_DATA'; reason[i] = { code: 'NEEDS_BARS', note: null }; continue; }
    values[i] = raw[i];
  }
  return { values, status, reason };
}

/* The computed series behind an operand — the cache's, or the refusal of
   the whole series (an unknown indicator, a bad parameter) — with what
   labels it. scanCoreAt reads one bar of it exactly as scanIndicatorSeries
   writes every bar out.
   ONE BAR IS READ ONE BAR AT A TIME. scanIndicator is asked for one bar,
   and it wrote out the reason of every bar of the series to read one:
   a condition evaluated on every bar of a history was quadratic in its
   length. The reader's bot pack (27 setups, whose monthly average needs two
   hundred months) evaluated on every one of 4,826 daily bars took 26
   seconds; read a bar at a time it takes 8, and every value, status and
   reason is the one the series holds. */
function scanIndicatorCore(spec, bars, cache) {
  const id = spec?.indicator, def = SCAN_INDICATORS[id];
  const len = bars?.closes?.length || 0;
  const label = scanSideLabel(spec || {});
  const fill = (st, code, text) => ({ id, len, label, specKey: scanSpecKey(spec || {}), unit: null, needs: Infinity, field: null, calcVersion: null,
    whole: { status: st, reason: { code, text } }, base: null, mult: 1 });
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
  return { id, len, label, specKey: scanSpecKey(spec), unit: scanUnitOf(spec), needs, field, calcVersion: def.calcVersion, whole: null, base, mult: scanMultiplier(spec.multiplier) };
}
const scanCoreAt = (K, i) => {
  if (K.whole) return { value: null, status: K.whole.status, reason: K.whole.reason };
  const v = K.base.values[i], r = K.base.reason[i];
  return { value: v == null ? null : K.mult === 1 ? v : v * K.mult, status: K.base.status[i],
           reason: r ? { code: r.code, text: scanReasonText(K.label, r.code, r.note, K.needs, i + 1) } : null };
};

/* One side of a rule, as a series over the bars, with a status and a
   reason at every bar. The value is null wherever the status is not VALID:
   the engine never fabricates one. */
function scanIndicatorSeries(spec, bars, { cache = null } = {}) {
  const K = scanIndicatorCore(spec, bars, cache);
  const { id, len, label } = K;
  if (K.whole) {
    return { id, specKey: K.specKey, label, unit: null, needs: Infinity, field: null, calcVersion: null,
      values: new Array(len).fill(null), status: new Array(len).fill(K.whole.status), reason: new Array(len).fill(K.whole.reason),
      series: null, noVolume: false, note: null };
  }
  const { base, mult, needs } = K;
  const values = mult === 1 ? base.values : base.values.map(v => (v == null ? null : v * mult));
  const reason = base.reason.map((r, i) => (r ? { code: r.code, text: scanReasonText(label, r.code, r.note, needs, i + 1) } : null));
  const lastR = reason[len - 1];
  return { id, specKey: K.specKey, label, unit: K.unit, needs, field: K.field, calcVersion: K.calcVersion,
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
  const K = scanIndicatorCore(spec, bars, cache);
  const n = bars?.closes?.length || 0;
  const i = at == null ? n - 1 : at;
  const def = SCAN_INDICATORS[spec?.indicator];
  const base = { instrumentId: bars?.instrumentId ?? null, symbol: bars?.symbol ?? null, indicator: K.specKey, label: K.label, unit: K.unit, field: K.field,
                 timeframe: bars?.timeframe || '1D', needs: K.needs, calculationVersion: def ? `${spec.indicator}@${def.calcVersion}` : null,
                 dataVersion: bars?.dataVersion ?? null };
  if (i < 0 || i >= n) {
    const first = n > 0 ? scanCoreAt(K, 0) : null;
    const reason = first?.reason?.code && first.reason.code !== 'NEEDS_BARS' ? first.reason
      : { code: 'NEEDS_BARS', text: scanReasonText(K.label, 'NEEDS_BARS', null, K.needs, Math.max(0, i + 1)) };
    return { ...base, timestamp: null, value: null, valueText: null, status: first?.status && first.status !== 'VALID' ? first.status : 'INSUFFICIENT_DATA', reason, have: Math.max(0, Math.min(i + 1, n)), barStatus: null };
  }
  let { status, reason, value } = scanCoreAt(K, i);
  if (status === 'VALID' && bars.stale && bars.stale.at === i) {
    status = 'STALE_DATA'; value = null;
    reason = { code: 'STALE', text: `its last final bar is ${bars.stale.last}, and the session of ${bars.stale.expected} should be held by now — a stale series is not evaluated` };
  }
  return { ...base, timestamp: bars.dates[i], value, valueText: scanDec(value), status, reason: status === 'VALID' ? null : reason, have: i + 1, barStatus: bars.status?.[i] || 'UNKNOWN' };
}

/* Numbers in rule text. Two decimals, as before — but never so few that two
   different values print the same: 0.345 against 0.34 prints '0.345 above
   0.340', where it once printed '0.34 above 0.34'. `compact` shortens
   large numbers (12.3k, 1.20m), which suits a volume; a price is never
   shortened, because 45,120.5 and 45,149.9 both read 45.1k. When two
   values would still print alike, the short form goes first, then a
   decimal at a time is added. */
const scanFmt = (v, dp = 2, compact = true) => (v == null ? '—' : compact && Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : compact && Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : v.toFixed(dp));
function scanFmtAll(vals, { dp = 2, compact = true } = {}) {
  const xs = vals.filter(scanOk);
  const distinct = new Set(xs.map(scanDec)).size;
  let d = dp, c = compact;
  while (new Set(xs.map(v => scanFmt(v, d, c))).size < distinct && (c || d < 8)) { if (c) c = false; else d++; }
  return (v) => scanFmt(v, d, c);
}
/* THE SERIES' OWN PRECISION. A price prints with as many decimals as its
   series is quoted in — a Bursa counter quoted to the half-sen reads
   '0.345 below 0.500', not '0.34 below 0.50', which hid the one digit the
   rule turned on. The decimals of a close are read at seven significant
   figures, so a close stored through a 32-bit float (5.300000190734863)
   counts as the 5.3 it was quoted as; at least two, at most four. Read
   over the bars up to the one being printed, so a later bar never changes
   how an earlier match reads. */
const SCAN_DP_MEMO = new WeakMap();
function scanDecimals(v) {
  if (!scanOk(v) || v === 0) return 0;
  const s = String(Number(v.toPrecision(7)));
  if (/e/i.test(s)) return 4;
  const k = s.indexOf('.');
  return k < 0 ? 0 : s.length - k - 1;
}
function scanSeriesDp(bars, at = null) {
  const closes = bars?.closes;
  if (!Array.isArray(closes) || !closes.length) return 2;
  let pre = SCAN_DP_MEMO.get(closes);
  if (!pre) {
    pre = new Array(closes.length);
    let m = 0;
    for (let i = 0; i < closes.length; i++) { m = Math.max(m, Math.min(4, scanDecimals(closes[i]))); pre[i] = m; }
    SCAN_DP_MEMO.set(closes, pre);
  }
  const i = at == null ? closes.length - 1 : Math.max(0, Math.min(at, closes.length - 1));
  return Math.max(2, pre[i]);
}
/* How one side of a condition prints: a price at its series' precision and
   never shortened; a flag (1 or 0) or a direction (1, 0 or −1) as the
   whole number it is, not "1.00"; anything else at two decimals, shortened
   when large. */
const scanFmtOpts = (unit, bars, at = null) => (unit === 'price' ? { dp: scanSeriesDp(bars, at), compact: false }
  : unit === 'flag' || unit === 'direction' ? { dp: 0, compact: false } : { dp: 2, compact: true });
const scanFmtFor = (v, unit, bars, at = null) => { const o = scanFmtOpts(unit, bars, at); return scanFmt(v, o.dp, o.compact); };

/* ------------------------------------------------------------------ setups -- */
/* SetupV2 = { id, version, hash, name, description?, enabled, universe,
   timeframe '1D' | '1W' | '1M', confirmationMode 'BAR_CLOSE', cooldownMode
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
  /* The timeframe the condition is read on, when it names one: absent is the
     setup's own. 'weekly' is '1W', as for a setup. */
  if (node.timeframe != null && node.timeframe !== '') c.timeframe = scanTimeframe(node.timeframe);
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
  /* A watchlist resolved from the export scans whatever the export names at
     run time, so which list it is and how it resolves are what it means —
     both are in the hash. The snapshot is kept too: it is what the run falls
     back on. 'snapshot' is the default, and saying so changes nothing, so a
     setup written before resolution existed keeps its hash. */
  if (u.kind === 'watchlist' && u.resolve === 'export') { uni.resolve = 'export'; uni.watchlistId = u.watchlistId ?? null; }
  const opnd = (o) => (o == null ? undefined : typeof o !== 'object' ? o : o.indicator != null ? scanSpecKey(o) : { value: scanNumeric(o.value) ? Number(o.value) : o.value });
  /* A condition's own timeframe is what it means, so it is in the hash —
     only when present (undefined members are dropped), so no setup written
     before conditions had one changes its hash. */
  const node = (n) => (!n || typeof n !== 'object' ? n
    : n.type === 'group' ? { logic: n.logic, children: Array.isArray(n.children) ? n.children.map(node) : n.children }
    : { op: scanOpName(n.op) || n.op, left: opnd(n.left), right: opnd(n.right), range: Array.isArray(n.range) ? n.range.map(opnd) : n.range,
        timeframe: n.timeframe == null ? undefined : n.timeframe });
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
/* A YES-OR-NO READING (unit 'flag') asked whether it EQUALS 1 or 0 is
   asked whether it is true or false, and says so: "WaveTrend(10,21) WT1
   above WT2 is true", where the engine once said "… equals 1" and its
   evaluation "… 1 equal to 1", which asked the reader to know the
   encoding. The scanner pages rewrote the condition's sentence; the engine
   says it now, in the condition and in what an evaluation read. The
   literal a flag condition asks for — 1 or 0 — or null when the condition
   is not one. */
function scanFlagLiteral(c) {
  if (!c || typeof c !== 'object' || scanOpName(c.op) !== 'EQUALS' || scanUnitOf(c.left) !== 'flag') return null;
  const r = c.right != null && typeof c.right === 'object' ? (c.right.indicator != null ? null : c.right.value) : c.right;
  return scanNumeric(r) && (Number(r) === 0 || Number(r) === 1) ? Number(r) : null;
}
const scanFlagWord = (v) => (Number(v) === 1 ? 'true' : 'false');
function scanConditionProse(c) {
  if (!c || typeof c !== 'object') return '(not a condition)';
  const op = scanOpName(c.op);
  /* A condition read on a timeframe of its own says which, first. */
  const on = c.timeframe != null && c.timeframe !== '' ? `${scanTimeframeWord(scanTimeframe(c.timeframe))}: ` : '';
  if (op === 'BETWEEN') return `${on}${scanOperandProse(c.left)} between ${scanOperandProse(c.range?.[0])} and ${scanOperandProse(c.range?.[1])}`;
  const flag = scanFlagLiteral(c);
  if (flag != null) return `${on}${scanOperandProse(c.left)} is ${scanFlagWord(flag)}`;
  return `${on}${scanOperandProse(c.left)} ${op ? SCAN_OPERATORS[op].label : `“${c.op}”`} ${scanOperandProse(c.right)}`;
}
/* A timeframe as a word of a sentence: 'weekly', 'monthly', 'daily'. */
const scanTimeframeWord = (tf) => (SCAN_TIMEFRAMES[tf]?.label || String(tf)).toLowerCase();
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
       its symbols the page wrote into the setup, or — resolve 'export' —
       the list as the reader last exported it to data/watchlists.json.
       Without a snapshot there is nothing to scan, and nothing for an
       export-resolved setup to fall back on when its list is not in the
       export; without the list's id there is nothing to look up. */
    else if (u.kind === 'watchlist' && u.resolve != null && u.resolve !== 'snapshot' && u.resolve !== 'export') bad('universe', 'BAD_UNIVERSE', `watchlist resolve "${u.resolve}" is not snapshot or export`);
    else if (u.kind === 'watchlist' && u.resolve === 'export' && !(typeof u.watchlistId === 'string' && u.watchlistId)) bad('universe', 'BAD_UNIVERSE', 'universe is a watchlist resolved from the export but names no watchlistId to find in data/watchlists.json');
    else if (u.kind === 'watchlist' && (!Array.isArray(u.symbols) || !u.symbols.length)) bad('universe', 'BAD_UNIVERSE', u.resolve === 'export'
      ? 'universe is a watchlist resolved from the export but carries no symbol snapshot to fall back on when the list is not in the export — save it again in the builder'
      : 'universe is a watchlist but carries no symbol snapshot — copy the setup JSON again from the scanner page');
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
        /* A condition may be read on a timeframe of its own: a built one, and
           the setup's or higher — a weekly bar holds five daily ones, and no
           one of them is "the" daily reading of that week. */
        if (c.timeframe != null) {
          const ct = SCAN_TIMEFRAMES[c.timeframe], own = SCAN_TF_RANK[s.timeframe];
          const built = Object.keys(SCAN_TIMEFRAMES).filter(k => SCAN_TIMEFRAMES[k].built).join(', ');
          if (!ct) bad(path, 'UNKNOWN_TIMEFRAME', `the condition's timeframe "${c.timeframe}" is not one of ${built}`);
          else if (!ct.built) bad(path, 'TIMEFRAME_NOT_BUILT', `the condition's timeframe "${c.timeframe}" is not built — ${ct.reason}`);
          else if (own != null && SCAN_TF_RANK[c.timeframe] < own) {
            bad(path, 'LOWER_TIMEFRAME', `the condition's timeframe ${c.timeframe} (${scanTimeframeWord(c.timeframe)}) is lower than the setup's ${s.timeframe} (${scanTimeframeWord(s.timeframe)}) — a condition is read on its setup's timeframe or a higher one (${built}, in that order): a ${scanTimeframeWord(s.timeframe)} bar holds several ${scanTimeframeWord(c.timeframe)} ones, and no one of them is its ${scanTimeframeWord(c.timeframe)} reading`);
          }
        }
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

/* ------------------------------------------------------- higher timeframes -- */
/* A CONDITION READ ON A HIGHER TIMEFRAME (the bot contract, B2). A setup
   evaluated on bar i of its own timeframe — session date d — reads a
   condition that names a higher timeframe T on T's bars, built from the
   same daily bars on the same calendar (scanResample, as a weekly setup's
   own bars are), at the LAST T BAR COMPLETE AS OF d: the one whose
   period's last expected session has closed on or before d. The T bar
   containing d is read only when d closes it; before that, the one before.
   So on each daily close the weekly criteria come from the last completed
   week, never the week in progress — the reader's decision, which is the
   script's intent (TradingView's request.security with gaps on reads a
   weekly boolean as false between week closes; the reader chose the intent).
   A week whose Friday is a holiday on an inferred calendar closes on the
   Thursday; on the weekday calendar, which cannot tell a holiday from a day
   nothing was captured, the Friday is still expected, so the week is read
   as closed from the Monday after. A month whose last day is a weekend
   closes on its last weekday.
   Crossings and the flags that compare a bar with the one before (histUp,
   histDown) are T's own: T's bar against T's bar before it. Every
   indicator is causal, so T's value at a bar complete as of d is the value
   a history ending at d would give.
   A T bar holds every daily bar of its period, so it is complete only once
   its last held daily bar is on or before d as well: a bar held on a day
   the calendar calls ambiguous, after the period's last expected session,
   is in the T bar, and reading it earlier would read a day not yet closed.
   Kleene as everywhere: unknown, with a reason that names the timeframe,
   while T's value cannot be computed — its warm-up, no T bar closed yet, a
   stale read (the T period that should have closed last is not held, or
   the setup's own series is stale), a T bar holding a provisional day.
   IMPORTED BARS. Where the history holds an imported weekly or monthly
   series for the symbol, T's bars are built by scanFrameBars — the builder
   a weekly or monthly setup's own bars come from, with the same frame and
   the same clock, so the two read identical bars: the imported bar where
   the frame holds the period, one built from the daily bars where it does
   not. An imported bar is dated by its period's last expected session, so
   it closes then, as a complete built bar does. The reading says which it
   read (`barOrigin`, and "(imported)" or "(built from daily bars)" in its
   sentence). */
const SCAN_FRAME_MEMO = new WeakMap();
function scanFrame(bars, tf) {
  if (!bars || typeof bars !== 'object') return null;
  let memo = SCAN_FRAME_MEMO.get(bars);
  if (!memo) { memo = {}; SCAN_FRAME_MEMO.set(bars, memo); }
  if (tf in memo) return memo[tf];
  const src = bars.calendar && typeof bars.calendar === 'object' ? SCAN_BARS_SOURCE.get(bars.calendar) : null;
  /* A daily series is its own source; a weekly one reads months from the
     daily bars it was resampled from. */
  const daily = (bars.timeframe || '1D') === '1D' ? bars : src?.daily || null;
  /* Bars made from a bare list of closes are numbered, not dated: no week
     can be built from them. */
  if (!daily || !daily.dates.every(scanIsDay)) return (memo[tf] = null);
  const cal = src?.cal || scanWeekdayCalendar(daily.market);
  const T = scanFrameBars(daily, tf, { calendar: cal, now: src?.now ?? null, frame: src?.frames?.[tf] || null });
  const periodOf = tf === '1M' ? scanMonthOf : scanWeekOf;
  const nextOf = (p) => (tf === '1M' ? scanMonthOf(scanAddDays(p, 31)) : scanAddDays(p, 7));
  const lastSessionMemo = new Map();
  const lastSession = (p) => {
    if (!lastSessionMemo.has(p)) {
      let last = null;
      for (let d = p; periodOf(d) === p; d = scanAddDays(d, 1)) if (scanIsSession(cal, d)) last = d;
      lastSessionMemo.set(p, last);
    }
    return lastSessionMemo.get(p);
  };
  const periods = T.dates.map(periodOf);
  const closesOn = T.dates.map((d, k) => { const le = lastSession(periods[k]); return le && le > d ? le : d; });
  /* The read is its own: the setup's series being stale is asked of it
     directly (scanEvalHigher), not of T's last bar. */
  return (memo[tf] = { tf, bars: { ...T, stale: null }, periods, closesOn, nextOf, lastSession });
}
/* The last T bar complete as of date d, or −1 when none is. */
function scanFrameAt(F, d) {
  let lo = 0, hi = F.closesOn.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (F.closesOn[m] <= d) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}
/* The period after T bar k's that has a session and had closed by d but is
   not held — the read at k is then stale — or null. A period with no
   session at all (a week of holidays) is not missing. */
function scanFrameGap(F, k, d) {
  let q = F.nextOf(F.periods[k]);
  for (let n = 0; n < 60 && !F.lastSession(q); n++) q = F.nextOf(q);
  const le = F.lastSession(q);
  if (!le || le > d) return null;
  return k + 1 < F.periods.length && F.periods[k + 1] === q ? null : q;
}
function scanEvalHigher(cond, tf, bars, i, cache) {
  const own = bars?.timeframe || '1D', word = scanTimeframeWord(tf), unit = tf === '1M' ? 'month' : 'week';
  const label = cond?.left && typeof cond.left === 'object' && cond.left.indicator != null ? scanSideLabel(cond.left) : 'the condition';
  const res = { type: 'condition', path: null, op: scanOpName(cond?.op) || cond?.op || null, state: 'UNAVAILABLE', met: null, text: '', reason: null,
                left: null, right: null, prevLeft: null, prevRight: null, leftLabel: null, rightLabel: null, leftValue: null, rightValue: null,
                timeframe: tf, barDate: null, barOrigin: null };
  const na = (code, text, left = null) => { res.reason = { code, text }; res.text = text; if (left) { res.left = left; res.leftLabel = left.label; } return res; };
  if (!(tf in SCAN_TF_RANK)) return na('UNKNOWN_TIMEFRAME', `the condition's timeframe "${tf}" is not one of ${Object.keys(SCAN_TF_RANK).join(', ')}`);
  if (SCAN_TF_RANK[tf] < (SCAN_TF_RANK[own] ?? 0)) return na('LOWER_TIMEFRAME', `${label}: its timeframe ${tf} is lower than the setup's ${own}, so it has no one bar to read`);
  const n = bars?.dates?.length || 0;
  if (i < 0 || i >= n) return na('NEEDS_BARS', 'no bar is held at that position');
  const F = scanFrame(bars, tf);
  if (!F) return na('NO_DAILY_BARS', `${word} bars: ${label} — no ${word} bar can be built: these bars are not the dated daily bars of a history, nor bars resampled from them`);
  const d = bars.dates[i];
  const T = F.bars;
  const stale = (text) => na('STALE', text, { ...scanIndicator(cond.left, T, { at: -1, cache }), status: 'STALE_DATA', reason: { code: 'STALE', text } });
  /* The setup's own series is behind: nothing is read on it, on any timeframe. */
  if (bars.stale && bars.stale.at === i) {
    return stale(`its last final bar is ${bars.stale.last}, and the session of ${bars.stale.expected} should be held by now — a stale series is not evaluated, on its ${word} bars either`);
  }
  const k = scanFrameAt(F, d);
  if (k < 0) {
    const r = scanEvalCondition(cond, T, -1, cache);
    return na(r.reason?.code || 'NEEDS_BARS', `${word} bars: no ${unit} had closed by ${d} — ${r.reason?.text || `${label} cannot be read`}`, r.left);
  }
  const gap = scanFrameGap(F, k, d);
  if (gap) {
    return stale(`${word} bars: the ${unit} of ${gap} has sessions and no bar in your history, so on ${d} the last ${word} bar held (${T.dates[k]}) is not the last ${unit} closed — a stale reading is not evaluated`);
  }
  const origin = T.origin?.[k] === 'imported' ? 'imported' : 'daily';
  if (T.status[k] === 'PROVISIONAL') {
    return na('PROVISIONAL_BAR', origin === 'imported'
      ? `${word} bars: the imported ${word} bar of ${T.dates[k]} was captured before its ${unit} closed, and your daily bars do not hold that ${unit} — a provisional bar is not read`
      : `${word} bars: the ${word} bar of ${T.dates[k]} holds a day captured before its session closed and settled — a provisional bar is not read`);
  }
  const r = scanEvalCondition(cond, T, k, cache);
  r.timeframe = tf; r.barDate = T.dates[k]; r.barOrigin = origin;
  if (r.state === 'UNAVAILABLE') { const t = `${word} bars: ${r.reason?.text || 'could not be read'}`; r.reason = { ...(r.reason || { code: 'NEEDS_BARS' }), text: t }; r.text = t; }
  else r.text = `${word} bar of ${r.barDate} (${origin === 'imported' ? 'imported' : 'built from daily bars'}): ${r.text}`;
  return r;
}

/* One condition at bar i. Its state is MET or NOT_MET only when every
   value it reads is VALID; otherwise UNAVAILABLE, with the first reason —
   untested is not failed: a condition that could not be read has not been
   satisfied and has not been broken either. A crossing reads the bar
   before as well, and only when that bar is the previous session. A
   condition that names a timeframe other than its bars' is read there
   (scanEvalHigher). */
function scanEvalCondition(cond, bars, i, cache) {
  const ctf = cond?.timeframe == null || cond.timeframe === '' ? null : scanTimeframe(cond.timeframe);
  if (ctf && ctf !== (bars?.timeframe || '1D')) return scanEvalHigher(cond, ctf, bars, i, cache);
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
    const fmt = scanFmtAll([lv, bounds[0].v, bounds[1].v], scanFmtOpts(L.unit, bars, i));
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
    /* A crossing compares two bars; across an unexplained price break it
       compares two price bases, and a split reads as a cross downward. The
       operands' own windows catch this for an average, but not for the
       price against a fixed level, so it is asked here. */
    if (bars?.breakBefore?.[i]) return na('UNADJUSTED_BREAK', `${L.label}: ${scanBreakNote(bars, i, 'a crossing is not read across')}`);
  }
  const met = scanCompare(opName, lv, rv, { lp: Lp?.value, rp });
  const fmt = scanFmtAll([lv, rv], scanFmtOpts(L.unit, bars, i));
  const verb = SCAN_VERBS[opName][met ? 0 : 1];
  /* A yes-or-no reading says what it read — true or false — and, where
     that is not what was asked, what was (scanFlagLiteral). */
  const flag = !R && L.unit === 'flag' && scanFlagLiteral(cond) != null && (lv === 0 || lv === 1);
  Object.assign(res, { state: met ? 'MET' : 'NOT_MET', met, leftValue: lv, rightValue: rv, rightLabel: R ? R.label : fmt(rv),
    text: flag ? `${L.label} is ${scanFlagWord(lv)}${met ? '' : `, not ${scanFlagWord(rv)}`}` : `${L.label} ${fmt(lv)} ${verb} ${R ? `${R.label} ${fmt(rv)}` : fmt(rv)}` });
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
/* WHICH MEMBERS A WATCHLIST MEANS WHEN THE RUN READS IT. A watchlist lives
   in a browser, which the worker cannot read, so a watchlist universe
   carries a snapshot of its symbols from when the setup was saved. With
   resolve 'export' the run reads the list instead from the reader's latest
   "Export for the scanner" (data/watchlists.json, in watchlistsExport()'s
   shape, handed in as `watchlists`): that is as live as the last export and
   no more, and the record says which it was — universeResolvedFrom, with
   the snapshot's date or the export's time. A list the export does not
   hold, or no export at all, falls back to the snapshot and says so in
   `fallback`, which the worker turns into a PARTIAL run: evaluating an
   older membership quietly would record matches for a list the reader has
   since changed. A member the export holds without a symbol (a company
   with no listing the history uses) is named in `unresolved`, not dropped.
   Returns nulls for every other kind of universe. */
function scanResolveUniverse(universe, watchlists = null) {
  const u = universe || { kind: 'all' };
  if (u.kind !== 'watchlist') return { symbols: null, resolvedFrom: null, fallback: null, unresolved: [] };
  const snapshot = Array.isArray(u.symbols) ? u.symbols : [];
  const fromSnapshot = { source: 'snapshot', ...(u.asOf ? { asOf: u.asOf } : {}) };
  if (u.resolve !== 'export') return { symbols: snapshot, resolvedFrom: fromSnapshot, fallback: null, unresolved: [] };
  const lists = watchlists && Array.isArray(watchlists.watchlists) ? watchlists.watchlists : null;
  const list = lists ? lists.find(w => w && w.id === u.watchlistId) : null;
  if (!list) {
    const why = !watchlists ? 'there is no data/watchlists.json (export it from the watchlists page with "Export for the scanner")'
      : !lists ? 'data/watchlists.json is not a watchlists export'
      : `watchlist ${u.watchlistId} is not in data/watchlists.json${watchlists.exportedAt ? ` (exported ${watchlists.exportedAt})` : ''}`;
    return { symbols: snapshot, resolvedFrom: fromSnapshot, unresolved: [],
             fallback: `${why} — evaluated its snapshot of ${u.asOf || 'a date the setup did not record'}` };
  }
  const items = Array.isArray(list.items) ? list.items : [];
  const named = (i) => typeof i?.symbol === 'string' && i.symbol.trim() !== '';
  return { symbols: items.filter(named).map(i => i.symbol), fallback: null,
           resolvedFrom: { source: 'export', ...(watchlists.exportedAt ? { exportedAt: watchlists.exportedAt } : {}) },
           unresolved: items.filter(i => !named(i)).map(i => String(i?.companyId || i?.instrumentId || i?.id || '?')) };
}
/* Which instruments a setup looks at. `all` is everything with a series;
   `market` reads the instrument registry; `symbols` is the reader's list;
   `watchlist` is the list's members, resolved as above. */
function scanUniverse(setup, history, instruments, { watchlists = null } = {}) {
  const have = Object.keys(history?.series || {});
  const u = setup?.universe || { kind: 'all' };
  if (u.kind === 'symbols' || u.kind === 'watchlist') {
    const named = u.kind === 'watchlist' ? scanResolveUniverse(u, watchlists).symbols : (u.symbols || []);
    const want = new Set(named.map(s => String(s).toUpperCase()));
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
function scanUniverseGaps(setup, history, instruments, { watchlists = null } = {}) {
  const have = new Set(Object.keys(history?.series || {}).map(s => String(s).toUpperCase()));
  const u = setup?.universe || { kind: 'all' };
  if (u.kind === 'symbols' || u.kind === 'watchlist') {
    const seen = new Set();
    const named = u.kind === 'watchlist' ? scanResolveUniverse(u, watchlists).symbols : (u.symbols || []);
    const missing = named.map(s => String(s)).filter(s => {
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
   exactly what a run on that evening would have.
   Imported weeks and months (history.frames) are cut the same way, by
   their period keys: a week that had begun by then is kept, with values
   its export captured later, and is read as it stood — a period whose last
   session had not closed at the replay's "now" is PROVISIONAL, and gives
   way to the one built from the daily bars that were held (scanFrameBars). */
function scanTruncateHistory(history, asOf) {
  if (!asOf || !history) return history;
  const cutOne = (s) => (Array.isArray(s) ? s.filter(x => !x?.date || x.date <= asOf)
    : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).filter(([d]) => d <= asOf)) : s);
  const cut = (m) => (m && typeof m === 'object' ? Object.fromEntries(Object.entries(m).map(([sym, s]) => [sym, cutOne(s)])) : m);
  const out = { ...history, series: cut(history.series), volume: cut(history.volume), ohlc: cut(history.ohlc), meta: cut(history.meta), corrections: cut(history.corrections), truncatedAt: asOf };
  if (history.frames && typeof history.frames === 'object') {
    out.frames = Object.fromEntries(Object.entries(history.frames).map(([tf, bySym]) => [tf, bySym && typeof bySym === 'object'
      ? Object.fromEntries(Object.entries(bySym).map(([sym, f]) => [sym, f && typeof f === 'object' && !Array.isArray(f) ? cut(f) : f])) : bySym]));
  }
  return out;
}
/* The instant a replay treats as "now": the morning after the session, in
   UTC, which is after every market's close and settle on that date and
   before any market's close on the next. */
const scanReplayNow = (asOf) => `${scanAddDays(asOf, 1)}T04:00:00Z`;

/* What the worker keeps per pair between runs (its ledger's `pairs`): one
   entry per setup version, instrument and timeframe — the pair a run
   evaluates — holding the last bar it was evaluated on. */
const scanPairKey = (setupId, version, symbol, timeframe) => `${setupId}|v${version}|${String(symbol).toUpperCase()}|${scanTimeframe(timeframe)}`;
/* How many bars one run catches up per pair. A daily run missed for two
   weeks is ten sessions; further behind than that is not a missed run but
   a stopped worker, and --as-of replays those days on purpose, a date at a
   time, rather than one run recording a month of alerts at once. */
const SCAN_CATCH_UP_CAP = 10;

/* A missing session before bar j, in words: the sessions the calendar
   expected between j and the bar before it that the history holds, and
   what that calendar is. null when none is missing. A weekday calendar
   cannot tell a holiday from a day nothing was captured, and says so; a
   weekly or monthly bar counts whole weeks or months with sessions and no
   bar. */
function scanGapText(bars, j, cal = null) {
  const g = bars?.gapBefore?.[j] || 0;
  if (!(g > 0) || !(j >= 1)) return null;
  const a = bars.dates[j - 1], b = bars.dates[j];
  if (bars.timeframe === '1W') {
    return { count: g, sessions: [], text: `${g} week${g === 1 ? '' : 's'} with sessions and no bar ${g === 1 ? 'lies' : 'lie'} between the weekly bar of ${a} and this one of ${b}` };
  }
  if (bars.timeframe === '1M') {
    return { count: g, sessions: [], text: `${g} month${g === 1 ? '' : 's'} with sessions and no bar ${g === 1 ? 'lies' : 'lie'} between the monthly bar of ${a} and this one of ${b}` };
  }
  const missing = [];
  for (let d = scanAddDays(a, 1), k = 0; d < b && k < 400; d = scanAddDays(d, 1), k++) if (scanIsSession(cal, d)) missing.push(d);
  const n = missing.length || g;
  const list = missing.length ? `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}` : `${g} session${g === 1 ? '' : 's'}`;
  const basis = cal?.basis === 'inferred'
    ? `${n === 1 ? 'a session' : 'sessions'} of the calendar inferred from your history`
    : `${n === 1 ? 'a weekday' : 'weekdays'} — no exchange calendar is held, so ${n === 1 ? 'it' : 'each'} may have been a holiday or a day nothing was captured`;
  return { count: n, sessions: missing, text: `the bar before ${b} that your history holds is ${a}; ${list} between them ${n === 1 ? 'has' : 'have'} no bar (${basis})` };
}
/* The gap as an alert or a simulated event states it. A NEW_MATCH across a
   gap is a transition nobody saw happen: the conditions were not evaluated
   on the missing sessions, so "not met, then met" is two readings with a
   hole between them, not two consecutive sessions. */
const scanGapNote = (gap, eventType) => (!gap ? null : eventType === 'NEW_MATCH'
  ? `a new match across a gap — ${gap.text}. The conditions could not be read on ${gap.count === 1 ? 'that session' : 'those sessions'}, so the change from not met to met is not shown on consecutive sessions.`
  : gap.text);

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
   are written on every alert.

   CATCH-UP (SC-307). `pairs` is the worker's record of the bar each pair
   was last evaluated on (scanPairKey → { lastEvaluatedBar }). Given it, a
   pair evaluates every completed bar after that one, oldest first and at
   most SCAN_CATCH_UP_CAP of them, each at its own position — every
   indicator is causal, so bar j is read on exactly the history that ended
   at j — and a day the scheduler missed still records the crossing or the
   NEW_MATCH that happened on it, once, on its own bar, exactly as that
   day's run would have. A pair with no entry (a new setup, or a new
   version of one) evaluates its last bar only: replay is the way further
   back. Without `pairs` (the page, a replay, the self-test) every pair is
   evaluated on its last bar, as before. `out.pairs` is the bar each
   evaluated pair now stands on, for the worker to keep; a stale series is
   not evaluated, so it does not move and is caught up once it is current.

   READY (SC-301). With `ready`, an instrument whose market's expected
   session is not held final (scanReadiness) is not evaluated: the market
   is listed in `skippedMarkets` with the reason and its pairs do not move,
   so the next ready run catches them up. It is a judgement of capture
   times against each market's close, on the calendar the reader's own
   history implies — not a provider's word that the session is final.

   `markets` narrows a run to the instruments of those registry markets (a
   replay of one market): the others are counted as left out, not reported
   missing. `watchlists` is the reader's watchlist export, read by a
   watchlist universe that resolves from it (scanResolveUniverse). */
function scanRun(setups, history, { instruments = [], existing = [], now = null, runId = null, origin = null, asOf = null, cache = null,
                                    pairs = null, catchUpCap = SCAN_CATCH_UP_CAP, ready = false, markets = null, watchlists = null } = {}) {
  const hist = asOf ? scanTruncateHistory(history, asOf) : history;
  const clockNow = asOf ? scanReplayNow(asOf) : now;
  const C = cache || scanCache();
  const reg = scanRegistry(instruments);
  /* untestedList carries each untested pair's reason; stale names series
     evaluated on a bar well behind the newest one the history holds;
     untestedEverywhere is decided from the pairs actually evaluated. */
  const out = { engine: `scan ${SCAN_VERSION}`, runId, origin, replayAsOf: asOf || null, alerts: [], evaluated: 0, matched: 0, untested: 0,
                deduped: 0, cooldown: 0, continuing: 0, skipped: [], setups: 0, untestedList: [], untestedEverywhere: [], stale: [], provisional: [],
                pairs: {}, catchUp: null, catchUpList: [], skippedMarkets: [], narrowed: null, universeResolvedFrom: [], watchlistFallbacks: [] };
  const prior = Array.isArray(existing) ? existing : [];
  const seen = new Set(prior.map(a => a?.key).filter(Boolean));
  /* The recorded bars per setup version, instrument and timeframe: what a
     cooldown is counted from. A 0.2 alert has no version (it was version 1)
     and the timeframe 'daily'.
     A COOLDOWN RUNS FORWARD. It is counted from the newest alert on or
     before the bar being evaluated, never from a later one. Only the newest
     bar overall was kept, so a replay of a past session (--as-of) with a
     later alert already in the record was refused as "within the 5-bar
     cooldown of" a bar that came after it — a run on that evening would not
     have held that alert, and the replay records what that run would have. */
  const recordedBars = new Map();
  const cdKey = (id, v, sym, tf) => `${id}|${v}|${String(sym).toUpperCase()}|${scanTimeframe(tf)}`;
  prior.forEach(a => {
    if (!a?.setupId || a.symbol == null) return;
    const k = cdKey(a.setupId, a.setupVersion ?? 1, a.symbol, a.timeframe), b = a.candleDate || a.bar;
    if (!b) return;
    if (!recordedBars.has(k)) recordedBars.set(k, []);
    recordedBars.get(k).push(b);
  });
  const recordedOnOrBefore = (k, bar) => { let p = null; for (const x of recordedBars.get(k) || []) if (x <= bar && (p == null || x > p)) p = x; return p; };
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
  const staleSeen = new Set(), provSeen = new Set(), evaluatedMarkets = new Set(), refusedSeen = new Set();
  const evaluatedBars = [];
  const marketRow = (sym) => reg.get(String(sym).toUpperCase())?.market || null;
  const marketOf = (sym) => { const m = marketRow(sym); return m ? String(m).toUpperCase() : null; };
  /* Readiness covers every market the history holds, judged on the same
     bars the run reads; it is decided before the loop so the ready gate can
     hold a market back. `inRun` is set after it. */
  const readiness = clockNow ? scanReadiness(hist, instruments, clockNow, { calendars: calFor, barsOf: (sym) => barsOf(sym, '1D') }) : null;
  const notReady = new Map();
  if (ready && readiness) readiness.markets.forEach(m => { if (m.state !== 'READY') notReady.set(m.market, m); });
  const heldBack = new Map();
  const only = Array.isArray(markets) && markets.length ? new Set(markets.map(m => String(m).toUpperCase())) : null;
  if (only) out.narrowed = { markets: [...only], instrumentsLeftOut: 0, setupsOutside: [] };
  const caught = { pairs: 0, bars: 0, capped: 0 };
  const cap = Math.max(1, Math.floor(Number(catchUpCap)) || SCAN_CATCH_UP_CAP);
  const generated = typeof hist?.generated === 'string' ? hist.generated : null;
  for (const raw of setups || []) {
    if (!raw || raw.enabled === false) continue;
    const s = scanNormaliseSetup(raw);
    if (!s.id) { out.skipped.push({ setup: s.name || '(unnamed)', why: 'no id' }); continue; }
    const tf = SCAN_TIMEFRAMES[s.timeframe];
    if (!tf || !tf.built) { out.skipped.push({ setup: s.id, why: `timeframe “${raw.timeframe}” is not built — ${tf ? tf.reason : 'the built timeframes are 1D, 1W and 1M'}` }); continue; }
    out.setups++;
    /* A watchlist universe says which membership it read: its snapshot, or
       the reader's export — and when the export was asked for but could not
       supply the list, that it fell back, which the worker makes PARTIAL. */
    const resolution = scanResolveUniverse(s.universe, watchlists);
    if (resolution.resolvedFrom) out.universeResolvedFrom.push({ setupId: s.id, watchlistId: s.universe.watchlistId ?? null, ...resolution.resolvedFrom });
    if (resolution.fallback) out.watchlistFallbacks.push({ setup: s.id, watchlistId: s.universe.watchlistId ?? null, why: resolution.fallback });
    let symbols = scanUniverse(s, hist, instruments, { watchlists });
    const gaps = scanUniverseGaps(s, hist, instruments, { watchlists });
    if (only) {
      const inside = (sym) => only.has(marketOf(sym));
      const before = symbols.length;
      symbols = symbols.filter(inside);
      out.narrowed.instrumentsLeftOut += before - symbols.length;
      gaps.missing = gaps.missing.filter(inside);
      gaps.unplaced = [];
      /* Narrowed to a market this setup has nothing in: not a problem with
         the setup, only outside what was asked for. */
      if (!symbols.length) { out.narrowed.setupsOutside.push(s.id); continue; }
    }
    /* A symbol the history holds only imported weeks or months for has
       no series to evaluate: they are read beside its daily bars, never
       without them (the entry criteria, the clock and staleness are the
       daily bars'). Said so, rather than "no series". */
    const framedOnly = (sym) => ['1W', '1M'].filter(tf => hist?.frames?.[tf] && typeof hist.frames[tf] === 'object'
      && Object.keys(hist.frames[tf]).some(k => k.toUpperCase() === String(sym).toUpperCase())).map(scanTimeframeWord);
    const noSeries = (sym) => { const f = framedOnly(sym); return f.length ? `no daily series in the price history — only imported ${f.join(' and ')} bars, which are read beside a daily series and never without one` : 'no series in the price history'; };
    if (!symbols.length) { out.skipped.push({ setup: s.id, why: `no instrument in its universe has a series${gaps.missing.length ? ` (${gaps.missing.join(', ')})` : ''}${gaps.missing.some(x => framedOnly(x).length) ? ` — ${gaps.missing.filter(x => framedOnly(x).length).join(', ')}: ${noSeries(gaps.missing.find(x => framedOnly(x).length))}` : ''}` }); continue; }
    gaps.missing.forEach(sym => out.skipped.push({ setup: s.id, symbol: sym, why: noSeries(sym) }));
    gaps.unplaced.forEach(sym => out.skipped.push({ setup: s.id, symbol: sym, why: 'not in data/instruments.json, so it has no market to be scanned under' }));
    resolution.unresolved.forEach(m => out.skipped.push({ setup: s.id, symbol: m, why: 'in the watchlist export with no symbol your history uses' }));
    let looked = 0, blind = 0;
    const reasons = [];
    for (const sym of symbols) {
      const mk = marketOf(sym);
      if (notReady.has(mk)) {
        const m = notReady.get(mk);
        if (!heldBack.has(mk)) heldBack.set(mk, { instruments: new Set(), setups: new Set(), m });
        heldBack.get(mk).instruments.add(sym);
        heldBack.get(mk).setups.add(s.id);
        continue;
      }
      const bars = barsOf(sym, s.timeframe);
      /* Imported weeks or months held for the symbol and not read — a
         corporate action recorded against them (scanFramesOf) — are named
         once per symbol and timeframe, with why: the run reads weeks built
         from the daily bars instead, and says so rather than quietly. */
      for (const [ftf, f] of Object.entries(SCAN_BARS_SOURCE.get(bars.calendar)?.frames || {})) {
        if (!f?.refused || refusedSeen.has(`${sym}|${ftf}`)) continue;
        refusedSeen.add(`${sym}|${ftf}`);
        (out.framesRefused ||= []).push({ symbol: sym, timeframe: ftf, why: f.refused.reason });
      }
      let at = bars.dates.length - 1;
      if (at >= 0 && bars.status[at] === 'PROVISIONAL') {
        const pbar = bars.dates[at];
        while (at >= 0 && bars.status[at] === 'PROVISIONAL') at--;
        const pk = `${sym}|${s.timeframe}`;
        if (!provSeen.has(pk)) {
          provSeen.add(pk);
          out.provisional.push({ symbol: sym, timeframe: s.timeframe, bar: pbar,
            why: `the ${pbar} ${s.timeframe === '1W' ? 'week is not complete' : s.timeframe === '1M' ? 'month is not complete' : 'bar was captured before its session closed and settled'}, so it is provisional${at >= 0 ? `; the bar of ${bars.dates[at]} was evaluated instead` : ''}` });
        }
      }
      if (at < 1) {
        out.skipped.push({ setup: s.id, symbol: sym, why: 'fewer than two bars' });
        looked++; blind++;
        if (!reasons.includes('fewer than two bars')) reasons.push('fewer than two bars');
        continue;
      }
      /* The bars this run evaluates for the pair: its last final bar and,
         when the worker's record has it last evaluated on an earlier bar,
         every completed bar since — the newest `cap` of them. A stale series
         is not caught up: its last bar is not evaluated either. */
      const pk = scanPairKey(s.id, s.version, sym, s.timeframe);
      const lastDone = pairs && scanIsDay(pairs[pk]?.lastEvaluatedBar) ? pairs[pk].lastEvaluatedBar : null;
      let first = at;
      if (lastDone && !bars.stale) while (first > 1 && bars.dates[first - 1] > lastDone) first--;
      const start = Math.max(first, at - cap + 1);
      let idx = [];
      for (let j = start; j <= at; j++) idx.push(j);
      /* Past its expiry a setup is evaluated only on the bars up to it. */
      if (s.expires) idx = idx.filter(j => bars.dates[j] <= s.expires);
      if (!idx.length) { out.skipped.push({ setup: s.id, symbol: sym, why: `expired ${s.expires}` }); continue; }
      const last = idx[idx.length - 1];
      const bar = bars.dates[last];
      if (idx.length > 1 || start > first) {
        caught.pairs += idx.length > 1 ? 1 : 0;
        caught.bars += idx.length - 1;
        if (start > first) caught.capped++;
        out.catchUpList.push({ setup: s.id, version: s.version, symbol: sym, timeframe: s.timeframe, since: lastDone, from: bars.dates[idx[0]], to: bar, bars: idx.length,
                               missed: start - first, ...(start > first ? { missedFrom: bars.dates[first], missedTo: bars.dates[start - 1] } : {}) });
      }
      out.evaluated++;
      looked++;
      idx.forEach(j => evaluatedBars.push(bars.dates[j]));
      evaluatedMarkets.add(bars.market ? String(bars.market).toUpperCase() : null);
      if (!(bars.stale && bars.stale.at === last)) out.pairs[pk] = { lastEvaluatedBar: bar };
      if (newest && !staleSeen.has(sym)) {
        /* A monthly bar is dated by its month's last session, so mid-month
           the one evaluated is up to a month behind the newest daily bar on
           a series that is perfectly current: a monthly series is behind
           when its daily bars are. */
        const ref = s.timeframe === '1M' ? lastBar(sym) : bar;
        const behind = scanDayDiff(ref, newest);
        /* Ten calendar days clears a long holiday closure; a series further
           behind than that was not updated, and its "last bar" is old news. */
        if (behind > 10) { staleSeen.add(sym); out.stale.push({ symbol: sym, bar: ref, why: `last bar ${ref} is ${behind} days behind the newest bar in the history (${newest})` }); }
      }
      for (const j of idx) {
        const jb = bars.dates[j];
        const r = scanEvaluate(s.ruleTree, bars, { at: j, cache: C });
        /* Whether the pair could be tested is its newest bar's answer; a
           caught-up bar still in its warm-up is not a second untested pair. */
        if (j === last && r.state === 'UNAVAILABLE') {
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
          const prev = scanEvaluate(s.ruleTree, bars, { at: j - 1, cache: C });
          if (prev.state === 'MET') {
            out.continuing++;
            out.skipped.push({ setup: s.id, symbol: sym, why: `still matching since the bar before (${bars.dates[j - 1]}) — a NEW_MATCH setup records only the bar a match begins` });
            continue;
          }
          eventType = prev.state === 'NOT_MET' ? 'NEW_MATCH' : 'FIRST_OBSERVED';
        }
        const SYM = String(sym).toUpperCase();
        const instrumentId = bars.instrumentId;
        const key = scanKey(s.id, s.version, instrumentId || sym, s.timeframe, jb, eventType);
        const forms = [key, scanKey(s.id, s.version, sym, s.timeframe, jb, eventType)];
        if (s.version === 1 && s.timeframe === '1D') forms.push(scanLegacyKey(s.id, sym, jb));
        if (forms.some(k => seen.has(k))) { out.deduped++; out.skipped.push({ setup: s.id, symbol: sym, why: 'already recorded for this bar' }); continue; }
        /* Cooldown counts BARS of this instrument, not days: a holiday is not
           a bar. Counted as the bars held after the previous alert's bar, so a
           bar removed from the history does not lose the cooldown. */
        const ck = cdKey(s.id, s.version, SYM, s.timeframe);
        const prevBar = recordedOnOrBefore(ck, jb);
        if (s.cooldownBars > 0 && prevBar) {
          let since = 0;
          for (let k = 0; k <= j; k++) if (bars.dates[k] > prevBar) since++;
          if (since <= s.cooldownBars) { out.cooldown++; out.skipped.push({ setup: s.id, symbol: sym, why: `within the ${s.cooldownBars}-bar cooldown of ${prevBar}` }); continue; }
        }
        const snapshot = { id: s.id, version: s.version, hash: s.hash, name: s.name, timeframe: s.timeframe, universe: s.universe,
                           confirmationMode: s.confirmationMode, cooldownMode: s.cooldownMode, cooldownBars: s.cooldownBars, expires: s.expires, ruleTree: s.ruleTree };
        const gap = scanGapText(bars, j, calFor(marketRow(sym)));
        const vol = bars.volumes?.[j];
        /* The weeks or months a condition read on a higher timeframe, hashed
           up to the bar it read (scanDataVersion), where the history holds
           imported bars for that timeframe. The record's dataVersion hashes
           the setup's own bars only, and an imported week is not in them:
           a re-import that changed the week the bot's criteria read left
           the record's version as it was, and the alert page said the bars
           were unchanged. Where no frame is held there is none — every week
           and month is built from the daily bars the dataVersion covers. */
        const barVersions = new Map();
        const barVersionOf = (tf, d) => {
          const k0 = `${tf}|${d}`;
          if (!barVersions.has(k0)) {
            const F = d ? scanFrame(bars, tf) : null, k = F && Array.isArray(F.bars.origin) ? F.bars.dates.indexOf(d) : -1;
            barVersions.set(k0, k < 0 ? null : scanDataVersion(F.bars, k));
          }
          return barVersions.get(k0);
        };
        const rec = {
          id: scanAlertId(key), key, setupId: s.id, setupName: s.name || s.id, setupVersion: s.version, setupHash: s.hash, setupSnapshot: snapshot,
          instrumentId, symbol: sym, market: bars.market, timeframe: s.timeframe, candleDate: jb, detectedAt: now || null,
          eventType, cooldownMode: s.cooldownMode, close: bars.closes[j],
          /* The volume the history holds for the bar, or null when it holds
             none — an instrument with no traded volume, or a bar captured
             without it. Never 0 in its place. */
          barVolume: scanOk(vol) ? vol : null,
          barStatus: bars.status[j] || 'UNKNOWN',
          /* A weekly or monthly setup's bar, where the history holds
             imported bars for the symbol, says whether it was imported or
             built from the daily bars (scanFrameBars). Absent where no
             frame is held: then every weekly and monthly bar is built from
             the daily ones, as before imports existed. */
          ...(Array.isArray(bars.origin) ? { barOrigin: bars.origin[j] || 'daily' } : {}),
          /* A condition read on a higher timeframe than the setup's says
             which, the date of the bar it read and whether that bar was
             imported or built from the daily bars (null when none could
             be read), and — where imported bars are held for it — the
             version of that timeframe's bars up to the one read
             (barVersion); one on the setup's own carries none of them. */
          matchedConditions: r.conditions.map(c => ({ path: c.path, text: c.text, state: c.state, left: c.leftValue, right: c.rightValue,
            leftLabel: c.leftLabel, rightLabel: c.rightLabel, status: c.state === 'UNAVAILABLE' ? (c.left?.status || 'INVALID_INPUT') : 'VALID', reason: c.reason?.code || null,
            ...(c.timeframe ? { timeframe: c.timeframe, barDate: c.barDate ?? null, barOrigin: c.barOrigin ?? null,
              ...((v) => (v ? { barVersion: v } : {}))(barVersionOf(c.timeframe, c.barDate)) } : {}) })),
          /* An imported week or month names the export it came from; a
             built one, the daily bar's source as before. */
          dataSourceId: (bars.origin?.[j] === 'imported' ? bars.source?.[j] : null) || hist?.meta?.[sym]?.[jb]?.src || hist?.source || 'personal-history',
          dataVersion: scanDataVersion(bars, j),
          /* The history file's own `generated` stamp as this run read it —
             when the file was written, not when the bar was captured; null
             when the file carries none. */
          historyGenerated: generated,
          runId, origin, engine: out.engine,
          ...(resolution.resolvedFrom ? { universeResolvedFrom: resolution.resolvedFrom } : {}),
          /* Present only when a session is missing between this bar and the
             one before it (C2): absent is "none missing", never false. */
          ...(gap ? { gapBefore: true, gapText: scanGapNote(gap, eventType) } : {}),
          /* 0.2 names, kept for one release: the page and ingest/daily.mjs read them. */
          bar: jb, rules: r.conditions.map(c => ({ text: c.text, met: c.met })), recordedAt: now || null,
        };
        out.alerts.push(rec);
        forms.forEach(k => seen.add(k));
        if (!recordedBars.has(ck)) recordedBars.set(ck, []);
        recordedBars.get(ck).push(jb);
      }
    }
    /* A setup none of whose instruments could be tested is a configuration
       problem, not a quiet day. Expired pairs are not counted: they were
       never evaluated, and are reported per instrument. */
    if (looked > 0 && blind === looked) out.untestedEverywhere.push({ setup: s.id, why: reasons.slice(0, 3).join('; ') || 'no rule could be tested' });
  }
  /* The run's as-of is the range of bars actually evaluated — each pair on
     its own instrument's last final bar, and any bars it caught up. */
  const sortedBars = evaluatedBars.sort();
  out.asOf = sortedBars[sortedBars.length - 1] || null;
  out.asOfFrom = sortedBars[0] || null;
  out.newestInHistory = newest;
  out.catchUp = pairs ? { pairs: caught.pairs, bars: caught.bars, capped: caught.capped, cap } : null;
  /* The markets the ready gate held back, in readiness order (by code), each
     SKIPPED_NO_DATA for this run with the sentence readiness gave. Only the
     markets some setup would have evaluated are named. */
  out.skippedMarkets = (readiness?.markets || []).filter(m => heldBack.has(m.market)).map(m => ({
    market: m.market, reason: m.text, state: m.state, status: 'SKIPPED_NO_DATA',
    instruments: heldBack.get(m.market).instruments.size, setups: [...heldBack.get(m.market).setups] }));
  out.readyGate = ready ? (readiness ? 'applied' : 'no clock — readiness could not be judged, so no market was held back') : null;
  /* `inRun` marks the markets this run evaluated an instrument of, which is
     what a page lists. */
  out.readiness = readiness;
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
const SCAN_SIMULATION_NOTE = 'A simulation on the closes you captured. It lists the bars on which your conditions held; it has no entries, exits, costs or slippage, so it shows no return. Closes are adjusted only for the splits and consolidations you recorded yourself, never for dividends, and nothing is computed across a price break you have not explained. Your universe is the instruments you track today, so anything you stopped tracking is absent. None of this is a guarantee, and no indicator here is claimed to work.';
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
        /* As the worker's record says it: an imported or built week or
           month, where a frame is held, and each condition read on a
           higher timeframe with its bar's date and origin. */
        out.matches.push({ symbol: sym, bar: bars.dates[i], close: bars.closes[i], barStatus: r.barStatus,
          ...(Array.isArray(bars.origin) ? { barOrigin: bars.origin[i] || 'daily' } : {}),
          conditions: r.conditions.map(c => ({ path: c.path, text: c.text, state: c.state, left: c.leftValue, right: c.rightValue,
            ...(c.timeframe ? { timeframe: c.timeframe, barDate: c.barDate ?? null, barOrigin: c.barOrigin ?? null } : {}) })) });
        const ev = prevState === 'NOT_MET' ? 'NEW_MATCH' : prevState === 'UNAVAILABLE' ? 'FIRST_OBSERVED' : null;
        /* A match right after a missing session says so, as the worker's
           record does (gapBefore, gapText). */
        const gap = (bars.gapBefore[i] || 0) > 0 ? scanGapText(bars, i, calFor(market)) : null;
        const gapOf = (e) => (gap ? { gapBefore: true, gapText: scanGapNote(gap, e) } : {});
        if (ev) out.events.push({ symbol: sym, bar: bars.dates[i], close: bars.closes[i], eventType: ev, ...gapOf(ev) });
        const recordable = s.cooldownMode === 'EVERY_MATCH' ? 'MATCH' : ev;
        if (recordable && !(s.cooldownBars > 0 && lastRec != null && i - lastRec <= s.cooldownBars)) {
          out.recorded.push({ symbol: sym, bar: bars.dates[i], close: bars.closes[i], eventType: recordable, ...gapOf(recordable) });
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

/* ------------------------------------------------------------ the bot's alerts -- */
/* THE READER'S "MULTI-TIMEFRAME TRADING BOT", AS SETUPS (the bot contract,
   B4). The reader runs this Pine script on TradingView and asked for its
   alerts as scanner alerts. Each of its alertconditions is written here as
   an ordinary setup — schema 2, timeframe 1D, conditions that name the
   trade timeframe where the script reads it — so the validation, the run,
   the record and historical testing read it like any other, and the reader
   can open, change or delete it like any other. Every title is the
   script's own alert title: a record of a condition the reader's own script
   defines, never this product's recommendation.

   The criteria, per timeframe, on that timeframe's last closed bar:
     1  WaveTrend(10, 21): wt1 above wt2           (wavetrend.bull, exact)
     2  MACD(12, 26, 9): line above its signal     (bot_macd.bull — an EMA
        signal, as the script computes it; cm_macd.bull with the SMA the
        chart draws, when macdSignal is 'sma')
     3  the close above its 200-bar EMA            (price against ema(200);
        sma(200), the chart's, when criterion3 is 'sma')
     4  MCDX banker (50, 1.5, base 50) above 5
     5  MCDX hot money (40, 0.5, base 30) below 10 — a sell only
   and the trade timeframe's MACD histogram against its bar before
   (histUp, histDown; histMoved for "either", which ANY STRONG SIGNAL asks
   of it — its twenty-one conditions otherwise pass the limit of twenty).
   "Not criterion n" is the complement: at or below where n says above.
   Criteria 3 to 5 compare two numbers and so follow the float rule
   (SCAN_TOLERANCE), where Pine compares exactly: the two can differ only on
   a bar where the close is within a billionth of its average, or MCDX of
   its level. Criteria 1 and 2 are the script's own booleans, compared
   exactly. scanner-test proves the pack equal, bar for bar, to a direct
   transcription of the script's logic (the contract's B5). */
const SCAN_BOT_SCRIPT = 'Multi-Timeframe Trading Bot';
const SCAN_BOT_SIGNALS = [
  { id: 'tier1-buy', title: 'Trade TF Tier 1 Buy', needsTradeTimeframe: true,
    description: 'On the trade timeframe, WT1 is above WT2 and the MACD line above its signal (criteria 1 and 2) while neither the close is above its 200-bar average (3) nor the MCDX banker above 5 (4) — the script’s Tier 1 without its Tier 2.' },
  { id: 'tier2-buy', title: 'Trade TF Tier 2 Buy', needsTradeTimeframe: true,
    description: 'On the trade timeframe, criteria 1 and 2 hold, and the close is above its 200-bar average (3) or the MCDX banker above 5 (4).' },
  { id: 'tier1-sell', title: 'Trade TF Tier 1 Sell', needsTradeTimeframe: true,
    description: 'On the trade timeframe, neither criterion 1 nor 2 holds while criterion 3 or 4 does — the script’s Tier 1 Sell without its Tier 2.' },
  { id: 'tier2-sell', title: 'Trade TF Tier 2 Sell', needsTradeTimeframe: true,
    description: 'On the trade timeframe, none of criteria 1 to 4 holds.' },
  { id: 'entry-buy', title: 'Entry TF Buy', needsTradeTimeframe: false,
    description: 'On the daily entry timeframe, all four of criteria 1 to 4 hold.' },
  { id: 'entry-sell', title: 'Entry TF Sell', needsTradeTimeframe: false,
    description: 'On the daily entry timeframe, none of criteria 1 to 4 holds and the MCDX hot money is below 10 (criterion 5).' },
  { id: 'entry-trade', title: 'Entry TF Trade', needsTradeTimeframe: false,
    description: 'Entry TF Buy or Entry TF Sell, on the daily entry timeframe.' },
  { id: 'strong-buy-continuous', title: 'STRONG BUY CONTINUOUS', needsTradeTimeframe: true,
    description: 'Trade TF Tier 2 Buy and Entry TF Buy on the same daily close, with the trade timeframe’s MACD histogram above its bar before.' },
  { id: 'strong-buy-reversal', title: 'STRONG BUY REVERSAL', needsTradeTimeframe: true,
    description: 'Trade TF Tier 2 Buy and Entry TF Buy on the same daily close, with the trade timeframe’s MACD histogram below its bar before.' },
  { id: 'strong-sell-continuous', title: 'STRONG SELL CONTINUOUS', needsTradeTimeframe: true,
    description: 'Trade TF Tier 2 Sell and Entry TF Sell on the same daily close, with the trade timeframe’s MACD histogram below its bar before.' },
  { id: 'strong-sell-reversal', title: 'STRONG SELL REVERSAL', needsTradeTimeframe: true,
    description: 'Trade TF Tier 2 Sell and Entry TF Sell on the same daily close, with the trade timeframe’s MACD histogram above its bar before.' },
  { id: 'weak-buy', title: 'WEAK BUY', needsTradeTimeframe: true,
    description: 'Trade TF Tier 1 Buy and Entry TF Buy on the same daily close — so not the strong buy base.' },
  { id: 'weak-sell', title: 'WEAK SELL', needsTradeTimeframe: true,
    description: 'Trade TF Tier 1 Sell and Entry TF Sell on the same daily close — so not the strong sell base.' },
  { id: 'any-strong', title: 'ANY STRONG SIGNAL', needsTradeTimeframe: true,
    description: 'Any of the four STRONG alerts: the strong buy or strong sell base with the trade timeframe’s MACD histogram moved either way from its bar before.' },
  { id: 'any-weak', title: 'ANY WEAK SIGNAL', needsTradeTimeframe: true,
    description: 'WEAK BUY or WEAK SELL.' },
];
/* The operands of the five criteria and the histogram, with the owner's
   decisions as defaults: the EMA signal (criterion 2) and the EMA of 200
   (criterion 3), each with a switch to the SMA the chart draws. */
function scanBotCriteria({ criterion3 = 'ema', macdSignal = 'ema' } = {}) {
  const macd = macdSignal === 'sma' ? 'cm_macd' : 'bot_macd';
  const avg = { indicator: criterion3 === 'sma' ? 'sma' : 'ema', n: 200 };
  const flag = (left) => ({ left, yes: ['EQUALS', { value: 1 }], no: ['EQUALS', { value: 0 }] });
  const above = (left, right) => ({ left, yes: ['GREATER_THAN', right], no: ['LESS_THAN_OR_EQUAL', right] });
  return {
    c1: { ...flag({ indicator: 'wavetrend', field: 'bull' }), words: 'WaveTrend(10,21) WT1 above WT2' },
    c2: { ...flag({ indicator: macd, field: 'bull' }), words: `the MACD(12,26,9) line above its ${macdSignal === 'sma' ? 'SMA' : 'EMA'} signal` },
    c3: { ...above({ indicator: 'price' }, avg), words: `the close above its ${criterion3 === 'sma' ? 'SMA' : 'EMA'}200` },
    c4: { ...above({ indicator: 'mcdx', field: 'banker' }, { value: 5 }), words: 'the MCDX banker (50, 1.5, base 50) above 5' },
    c5: { left: { indicator: 'mcdx', field: 'hotMoney' }, yes: ['LESS_THAN', { value: 10 }], words: 'the MCDX hot money (40, 0.5, base 30) below 10' },
    histUp: { ...flag({ indicator: macd, field: 'histUp' }), words: 'the MACD(12,26,9) histogram against its bar before' },
    histDown: flag({ indicator: macd, field: 'histDown' }), histMoved: flag({ indicator: macd, field: 'histMoved' }),
  };
}
/* The rule tree of one signal: `t` is the trade timeframe (null for an
   entry signal), which each trade-timeframe condition names; the daily
   ones name none, since the setup is daily. */
function scanBotTree(id, t, K) {
  const c = (key, yes, tf = null) => {
    const [op, right] = yes ? K[key].yes : K[key].no;
    return { type: 'condition', left: { ...K[key].left }, op, right: { ...right }, ...(tf ? { timeframe: tf } : {}) };
  };
  const all = (...children) => ({ type: 'group', logic: 'ALL', children });
  const any = (...children) => ({ type: 'group', logic: 'ANY', children });
  const t1b = () => [c('c1', 1, t), c('c2', 1, t), c('c3', 0, t), c('c4', 0, t)];
  const t2b = () => [c('c1', 1, t), c('c2', 1, t), any(c('c3', 1, t), c('c4', 1, t))];
  const t1s = () => [c('c1', 0, t), c('c2', 0, t), any(c('c3', 1, t), c('c4', 1, t))];
  const t2s = () => [c('c1', 0, t), c('c2', 0, t), c('c3', 0, t), c('c4', 0, t)];
  const eb = () => [c('c1', 1), c('c2', 1), c('c3', 1), c('c4', 1)];
  const es = () => [c('c1', 0), c('c2', 0), c('c3', 0), c('c4', 0), c('c5', 1)];
  switch (id) {
    case 'tier1-buy': return all(...t1b());
    case 'tier2-buy': return all(...t2b());
    case 'tier1-sell': return all(...t1s());
    case 'tier2-sell': return all(...t2s());
    case 'entry-buy': return all(...eb());
    case 'entry-sell': return all(...es());
    case 'entry-trade': return any(all(...eb()), all(...es()));
    case 'strong-buy-continuous': return all(...t2b(), ...eb(), c('histUp', 1, t));
    case 'strong-buy-reversal': return all(...t2b(), ...eb(), c('histDown', 1, t));
    case 'strong-sell-continuous': return all(...t2s(), ...es(), c('histDown', 1, t));
    case 'strong-sell-reversal': return all(...t2s(), ...es(), c('histUp', 1, t));
    case 'weak-buy': return all(...t1b(), ...eb());
    case 'weak-sell': return all(...t1s(), ...es());
    case 'any-strong': return any(all(...t2b(), ...eb(), c('histMoved', 1, t)), all(...t2s(), ...es(), c('histMoved', 1, t)));
    case 'any-weak': return any(all(...t1b(), ...eb()), all(...t1s(), ...es()));
    default: return null;
  }
}
/* The bars each timeframe of a tree must hold before every condition on it
   can be read: the longest `needs` among its operands (a crossing one
   more), by timeframe — { '1D': 200, '1W': 200 }. */
function scanTreeNeeds(tree, setupTf = '1D') {
  const out = {};
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'group') { (n.children || []).forEach(walk); return; }
    const tf = n.timeframe ? scanTimeframe(n.timeframe) : scanTimeframe(setupTf);
    const extra = SCAN_OPERATORS[scanOpName(n.op)]?.needsPrev ? 1 : 0;
    [n.left, n.right, ...(Array.isArray(n.range) ? n.range : [])].forEach(o => {
      const def = o && typeof o === 'object' ? SCAN_INDICATORS[o.indicator] : null;
      if (!def) return;
      const need = def.needs(scanParams(o).params, scanFieldOf(o)) + extra;
      out[tf] = Math.max(out[tf] || 0, need);
    });
  };
  walk(tree);
  return out;
}
/* A number of bars of a timeframe as the daily history it takes, in words. */
const scanBarsAsHistory = (tf, n) => (tf === '1M' ? `about ${Number((n / 12).toFixed(1))} years` : tf === '1W' ? `about ${Number((n / 52.18).toFixed(1))} years`
  : `about ${Number((n / 21).toFixed(0))} months`);
const SCAN_BOT_LETTER = { '1D': 'd', '1W': 'w', '1M': 'm' };
function scanBotPack({ symbols = null, universe = null, tradeTimeframes = ['1W', '1M'], signals = null, cooldownMode = 'NEW_MATCH', criterion3 = 'ema', macdSignal = 'ema' } = {}) {
  const ids = SCAN_BOT_SIGNALS.map(x => x.id);
  const want = signals == null ? ids : signals;
  const unknown = (Array.isArray(want) ? want : [want]).filter(x => !ids.includes(x));
  if (!Array.isArray(want) || unknown.length) throw new Error(`scanBotPack: ${unknown.map(x => `"${x}"`).join(', ') || 'signals'} is not one of ${ids.join(', ')}`);
  const tfs = (Array.isArray(tradeTimeframes) ? tradeTimeframes : [tradeTimeframes]).map(scanTimeframe);
  const badTf = tfs.filter(t => t !== '1W' && t !== '1M');
  if (badTf.length) throw new Error(`scanBotPack: the trade timeframe ${badTf.join(', ')} is not 1W or 1M — it must be above the daily entry timeframe, and intraday bars are not held`);
  if (!['ema', 'sma'].includes(criterion3)) throw new Error(`scanBotPack: criterion3 "${criterion3}" is not ema or sma`);
  if (!['ema', 'sma'].includes(macdSignal)) throw new Error(`scanBotPack: macdSignal "${macdSignal}" is not ema or sma`);
  if (cooldownMode !== 'NEW_MATCH' && cooldownMode !== 'EVERY_MATCH') throw new Error(`scanBotPack: cooldownMode "${cooldownMode}" is not NEW_MATCH or EVERY_MATCH`);
  const uni = universe && typeof universe === 'object' ? { ...universe } : Array.isArray(symbols) && symbols.length ? { kind: 'symbols', symbols: symbols.map(String) } : { kind: 'all' };
  const K = scanBotCriteria({ criterion3, macdSignal });
  const criteria = `1 ${K.c1.words}; 2 ${K.c2.words}; 3 ${K.c3.words}; 4 ${K.c4.words}; 5, for a sell only, ${K.c5.words}`;
  const out = [];
  const make = (sig, tf) => {
    const tree = scanBotTree(sig.id, tf, K);
    const needs = scanTreeNeeds(tree, '1D');
    const tfWords = tf ? `the ${scanTimeframeWord(tf)} trade timeframe and the daily entry timeframe` : 'the daily entry timeframe';
    const warm = Object.entries(needs).sort(([a], [b]) => SCAN_TF_RANK[a] - SCAN_TF_RANK[b]).map(([t, n]) => `${n} closed ${scanTimeframeWord(t)} bars (${scanBarsAsHistory(t, n)} of daily history)`).join(' and ');
    const raw = {
      id: `mtfbot-${SCAN_BOT_LETTER[tf || '1D']}-${sig.id}`, version: 1,
      name: `MTF bot · ${SCAN_TIMEFRAMES[tf || '1D'].label} · ${sig.title}`,
      description: `Your ${SCAN_BOT_SCRIPT} script’s “${sig.title}” alert, written as conditions — the script’s own alert, not a recommendation of this product. `
        + `${sig.description} The criteria, read on ${tfWords}: ${criteria}. Each timeframe is read on its last closed bar: `
        + `${tf ? `on each daily close, the last completed ${tf === '1M' ? 'month' : 'week'}, never the one in progress. ` : 'the daily close. '}`
        + `Every condition can be read once your history holds ${warm}; until then a condition that cannot be read is untested, and each run says so.`,
      enabled: true, universe: uni, timeframe: '1D', confirmationMode: 'BAR_CLOSE', cooldownMode, cooldownBars: 0, expires: null, ruleTree: tree,
    };
    out.push(scanNormaliseSetup(raw));
  };
  for (const sig of SCAN_BOT_SIGNALS) {
    if (!want.includes(sig.id)) continue;
    if (sig.needsTradeTimeframe) tfs.forEach(tf => make(sig, tf));
    else make(sig, null);
  }
  return out;
}
/* WHAT THE READER'S HISTORY HOLDS AGAINST WHAT THE BOT NEEDS, per
   timeframe, for one instrument's daily bars: the closed bars held as of
   its last closed bar, the bars each criterion needs, and a sentence. 300 daily
   bars are about 60 weekly and 14 monthly ones, and the 200-bar average of
   criterion 3 needs 200 of each — so on such a history the weekly
   criterion 3 and every monthly criterion are untested for years, and the
   pages say so rather than show a quiet day.
   Where the history holds imported weeks or months for the instrument
   (scanFrameBars), the closed bars counted are the merged ones a condition
   reads, and the sentence says where they come from: how many were
   imported and how many built from the daily bars, over which periods —
   300 imported months make every monthly criterion readable where the
   daily bars alone never could. `imported` and `built` count them, with
   their first and last periods; a frame held and not read says why. */
function scanBotWarmup(bars, { tradeTimeframes = ['1W', '1M'], criterion3 = 'ema', macdSignal = 'ema' } = {}) {
  const K = scanBotCriteria({ criterion3, macdSignal });
  /* The closed bars: a last bar captured while its session traded
     (PROVISIONAL) is not one, and a run evaluates the bar before it. The
     count was every bar held, so a history exported mid-session read "300
     closed daily bars held" of 299; the weeks and months are counted as
     of the last closed session as well. */
  let n = bars?.dates?.length || 0;
  while (n > 0 && bars.status?.[n - 1] === 'PROVISIONAL') n--;
  const last = n ? bars.dates[n - 1] : null;
  const needOf = (key) => Math.max(...[K[key].left, K[key].yes[1]].map(o => (o?.indicator ? SCAN_INDICATORS[o.indicator].needs(scanParams(o).params, scanFieldOf(o)) : 0)));
  const names = { c1: 'criterion 1', c2: 'criterion 2', c3: 'criterion 3', c4: 'criterion 4', c5: 'criterion 5', histUp: 'the histogram test' };
  return ['1D', ...(Array.isArray(tradeTimeframes) ? tradeTimeframes : [tradeTimeframes]).map(scanTimeframe).filter(t => t === '1W' || t === '1M')].map(tf => {
    const F = tf === '1D' ? null : scanFrame(bars, tf);
    const held = tf === '1D' ? n : F && last ? scanFrameAt(F, last) + 1 : 0;
    const keys = tf === '1D' ? ['c1', 'c2', 'c3', 'c4', 'c5'] : ['c1', 'c2', 'c3', 'c4', 'histUp'];
    const criteria = keys.map(k => ({ criterion: k, label: names[k], words: K[k].words, needs: needOf(k), readable: held >= needOf(k) }));
    const needs = Math.max(...criteria.map(c => c.needs));
    const short = criteria.filter(c => !c.readable);
    const word = scanTimeframeWord(tf);
    /* Where the closed bars came from, when a frame is held: the first
       `held` merged bars are the ones closed as of the last daily bar. */
    const og = F && Array.isArray(F.bars.origin) ? F.bars.origin : null;
    const span = (o) => { const ks = []; for (let k = 0; k < held; k++) if (og[k] === o) ks.push(F.periods[k]); return ks.length ? { bars: ks.length, first: ks[0], last: ks[ks.length - 1] } : null; };
    const imp = og ? span('imported') : null, blt = og ? span('daily') : null;
    const refused = F?.bars?.frameRefused || null;
    const per = (p) => (tf === '1M' ? p.slice(0, 7) : p);
    const from = (x, what) => `${x.bars} ${what} (${tf === '1M' ? 'months' : 'weeks'} of ${per(x.first)}${x.bars > 1 ? ` … ${per(x.last)}` : ''})`;
    const whence = !og ? '' : refused ? `, all built from daily bars — your imported ${word} bars are not read: ${refused.reason}`
      : `, ${[imp ? from(imp, 'imported') : null, blt ? from(blt, 'built from daily bars') : null].filter(Boolean).join(' and ') || 'none imported or built'}`;
    const more = imp ? `${scanBarsAsHistory(tf, needs - held)} more` : `${scanBarsAsHistory(tf, needs - held)} of daily history`;
    const text = short.length
      ? `${word}: ${held} closed ${word} bar${held === 1 ? '' : 's'} held${whence}; ${short.map(c => `${c.label} (${c.words}) needs ${c.needs}`).join(', ')} — untested until ${needs - held} more ${tf === '1M' ? 'months' : tf === '1W' ? 'weeks' : 'sessions'} are held (${more})`
      : `${word}: ${held} closed ${word} bars held${whence} — every criterion can be read`;
    return { timeframe: tf, held, needs, ready: !short.length, criteria, text,
             ...(og ? { imported: imp?.bars || 0, built: blt?.bars || 0, importedRange: imp ? [imp.first, imp.last] : null, builtRange: blt ? [blt.first, blt.last] : null, frameRefused: refused } : {}) };
  });
}

/* -------------------------------------------------------------- data health -- */
/* A SERIES DATED BY THE WRONG DAY. A bar dated by the UTC day of its
   timestamp, in a zone ahead of UTC, lands a day early — a Monday session
   on the Sunday, and no bar on Friday: NZ50 held 66 Sunday bars and one
   Friday. A zone behind UTC lands a day late, on Saturday. A handful of
   weekend bars is a mistyped date; a series is called shifted when the day
   before its market's first session weekday (or the day after its last)
   holds at least a quarter of what one session weekday holds — 5% of the
   bars in a five-day market — and at least five bars. Below three quarters
   of a weekday's share only part of the series is shifted: one source of
   two, or the daylight-saving half of the year (ASX200's 27 Sundays). A
   market that trades every day cannot show this, and is not judged. */
function scanWeekdayProfile(dates, market) {
  const M = scanMarket(market);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  (dates || []).forEach(d => { if (scanIsDay(d)) counts[scanWeekday(d)]++; });
  const n = counts.reduce((t, x) => t + x, 0);
  const off = counts.reduce((t, x, wd) => t + (M.days.includes(wd) ? 0 : x), 0);
  const out = { counts, bars: n, offSession: off, sundayShare: n ? counts[0] / n : 0, saturdayShare: n ? counts[6] / n : 0, shifted: null };
  if (!n || M.days.length >= 7) return out;
  const before = (Math.min(...M.days) + 6) % 7, after = (Math.max(...M.days) + 1) % 7;
  const perDay = n / M.days.length, early = counts[before], late = counts[after];
  const x = Math.max(early, late);
  if (x >= 5 && x >= perDay * 0.25) {
    const direction = early >= late ? 'early' : 'late';
    const partial = x < perDay * 0.75;
    const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    out.shifted = { direction, partial, share: x / n,
      text: `${x} of ${n} bars fall on a ${dayName[direction === 'early' ? before : after]}, not a session day in ${M.code === '_default' ? 'a weekday market' : `${M.code} (${M.label})`} — ${partial ? 'part of the series is' : 'the series is'} dated a day ${direction}, the way a timestamp's UTC day dates a session in a zone ${direction === 'early' ? 'ahead of' : 'behind'} UTC` };
  }
  return out;
}
/* TWO DATES FOR ONE SESSION. A series mixed from two sources that date
   bars differently holds one session twice: once under the session's own
   date and once under the day before or after it. Two bars on consecutive
   calendar days with the same close (and the same volume, where both are
   held) are listed when one of the two days is not a session day of the
   market, or when the two came from different sources. The same close on
   two weekdays from one source is an unchanged price — common on Bursa,
   where a quiet counter closes on the same tick for days — and is not. */
function scanDuplicateSessions(history, symbol, market) {
  const M = scanMarket(market);
  const s = history?.series?.[symbol] || {}, v = history?.volume?.[symbol] || {}, meta = history?.meta?.[symbol] || {};
  const days = Object.keys(s).filter(d => scanIsDay(d) && Number.isFinite(s[d]) && s[d] > 0).sort();
  const src = (d) => (meta[d] && typeof meta[d] === 'object' ? meta[d].src ?? null : null);
  const out = [];
  for (let i = 1; i < days.length; i++) {
    const a = days[i - 1], b = days[i];
    if (scanDayDiff(a, b) !== 1) continue;
    if (Math.abs(s[a] - s[b]) > scanTol(s[a], s[b])) continue;
    if (v[a] != null && v[b] != null && v[a] !== v[b]) continue;
    const offDay = [a, b].filter(d => !M.days.includes(scanWeekday(d)));
    const two = src(a) && src(b) && src(a) !== src(b);
    if (!offDay.length && !two) continue;
    out.push({ symbol, market: market || null, dates: [a, b], close: s[b], sources: [src(a), src(b)],
               why: offDay.length ? `${offDay.join(' and ')} ${offDay.length === 1 ? 'is not a session day' : 'are not session days'} here, and the close is the same as the day ${offDay[0] === a ? 'after' : 'before'} — one session written under two dates`
                 : `the same close from two sources (${src(a)}, ${src(b)}) on consecutive days — one session dated two ways` });
  }
  return out;
}
/* Everything the data-health page shows, from the history file alone:
   per market, the session expected by now and which series hold it, and
   the bars dated on a day it does not trade; per series, the bars, the
   invalid ones with their codes, the gaps against the calendar (inferred
   or weekday), the close-to-close breaks and what explains each, a
   shifted weekday profile, sessions held under two dates, the volume
   coverage and whether it sits at the ingest's keep (SCAN_HISTORY_KEEP);
   and the recorded adjustments with what became of each. In market order,
   then symbol order — neutral, not ranked. */
/* The points per series ingest/history-store.mjs keeps (its KEEP); the
   store's test holds the two equal. It was 500 in one writer and 2000 in
   another until the store became the only writer. */
const SCAN_HISTORY_KEEP = 2000;
function scanDataHealth(history, instruments, now) {
  const reg = scanRegistry(instruments);
  const syms = Object.keys(history?.series || {});
  const groups = new Map();
  syms.forEach(sym => { const m = reg.get(String(sym).toUpperCase())?.market || null; const k = m ? String(m).toUpperCase() : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sym); });
  const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : a > b ? 1 : 0));
  const markets = [], series = [];
  const totals = { series: syms.length, bars: 0, invalid: 0, gaps: 0, jumps: 0, unexplained: 0, stale: 0, provisional: 0, weekend: 0, shifted: 0, duplicates: 0 };
  const clock = now != null && Number.isFinite(scanMs(now));
  order.forEach(k => {
    const market = k || null;
    const cal = scanCalendar(history, instruments, market);
    const M = scanMarket(market);
    const expected = clock ? scanExpectedLastSession(cal, market, now) : null;
    let newestBar = null;
    const staleSymbols = [], weekend = [];
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
      const jumps = b.breaks;
      const unexplained = jumps.filter(j => SCAN_BREAK_OPEN.includes(j.state)).length;
      const statusCounts = { FINAL: 0, PROVISIONAL: 0, UNKNOWN: 0, CORRECTED: 0 };
      b.status.forEach(x => { statusCounts[x] = (statusCounts[x] || 0) + 1; });
      if (b.stale) staleSymbols.push(sym);
      const withVol = b.volumes.filter(scanOk).length;
      /* Dating is judged on the dates as held, before validation: a bar on
         a day its market does not trade is exactly what it looks for. */
      const heldDays = keys.filter(d => scanIsDay(d) && typeof raw[d] === 'number' && Number.isFinite(raw[d]) && raw[d] > 0).sort();
      const profile = scanWeekdayProfile(heldDays, market);
      const offDays = heldDays.filter(d => !M.days.includes(scanWeekday(d)));
      if (offDays.length) weekend.push({ symbol: sym, bars: offDays.length, first: offDays[0], last: offDays[offDays.length - 1] });
      const duplicates = scanDuplicateSessions(history, sym, market);
      series.push({ symbol: sym, market, bars: n, first: b.dates[0] || null, last, hasOHLC: b.hasOHLC,
                    volumeCoverage: n ? withVol / n : 0, invalid: b.invalid, dropped, gaps, jumps, unexplained, statusCounts,
                    weekdays: profile.counts, offSession: offDays.length, shifted: profile.shifted ? { ...profile.shifted, sundayShare: profile.sundayShare, saturdayShare: profile.saturdayShare } : null,
                    duplicates, adjustments: b.adjustments || [], adjustmentVersion: b.adjustmentVersion || null,
                    stale: b.stale, behindSessions: b.stale ? b.stale.sessionsBehind : 0, atKeepLimit: keys.length >= SCAN_HISTORY_KEEP, dataVersion: b.dataVersion });
      totals.bars += n; totals.invalid += b.invalid.length; totals.gaps += gaps.filter(g => g.counted).length; totals.jumps += jumps.length;
      totals.unexplained += unexplained; totals.weekend += offDays.length; totals.shifted += profile.shifted ? 1 : 0; totals.duplicates += duplicates.length;
      totals.stale += b.stale ? 1 : 0; totals.provisional += statusCounts.PROVISIONAL;
    });
    markets.push({ market, label: market ? (SCAN_MARKETS[market]?.label || market) : 'no market row', tz: M.tz,
                   session: M.open ? `${M.open}–${M.close} local${M.breaks?.length ? `, break ${M.breaks.map(x => x.join('–')).join(', ')}` : ''}` : `close ${M.close} ${M.tz}`,
                   settleMin: M.settleMin, calendar: { basis: cal.basis, text: cal.text, series: cal.series, inferredHolidays: cal.inferredHolidays, ambiguous: cal.ambiguous },
                   symbols: groups.get(k).length, newestBar, expected, staleSymbols, ready: expected ? staleSymbols.length === 0 : null,
                   weekend: { bars: weekend.reduce((t, x) => t + x.bars, 0), symbols: weekend } });
  });
  /* The recorded actions as the loader read them, and what became of each
     on its series. An action for a symbol the history does not hold says
     so rather than vanishing. */
  const acts = Array.isArray(history?.adjustments) ? history.adjustments : [];
  const bySym = new Map(series.map(s => [String(s.symbol).toUpperCase(), s]));
  const adjustments = {
    loaded: Array.isArray(history?.adjustments), version: history?.adjustmentVersion || 'none', problems: Array.isArray(history?.adjustmentProblems) ? history.adjustmentProblems : [],
    actions: acts.map(a => {
      const s = bySym.get(String(a.symbol).toUpperCase());
      const took = s?.adjustments.find(x => x.date === a.date && x.ratio === a.ratio);
      return { ...a, heldAs: s ? s.symbol : null, state: took ? took.state : s ? 'pending' : 'no-series', bars: took?.bars || 0,
               why: took ? took.why : s ? 'not read on this series' : 'your history holds no series under this symbol' };
    }),
  };
  return { at: clock ? new Date(scanMs(now)).toISOString() : null, engine: `scan ${SCAN_VERSION}`,
           file: { schema: history?.schema ?? 1, generated: history?.generated ?? null, source: history?.source ?? null, symbols: syms.length,
                   ohlc: !!history?.ohlc, meta: !!history?.meta, corrections: !!history?.corrections },
           markets, series, totals, adjustments };
}
/* THE HISTORY REPORT, in the shape ingest/history-check.mjs prints and the
   data page reads: every refused bar with its codes, the bars dated on a
   day their market does not trade (per market), the series whose weekdays
   are shifted, sessions held under two dates, every price break with what
   explains it, the stale series and the missing sessions no calendar
   explains. Built from scanDataHealth, so the page and the tool cannot
   report the same file differently. */
function scanValidateHistory(history, { instruments = [], now = null } = {}) {
  const H = scanDataHealth(history, instruments, now);
  const pick = (s) => ({ symbol: s.symbol, market: s.market });
  return {
    at: H.at, engine: H.engine, file: H.file, totals: H.totals, adjustments: H.adjustments,
    rejected: H.series.flatMap(s => s.invalid.map(x => ({ ...pick(s), date: x.date, codes: x.codes }))),
    weekendByMarket: H.markets.filter(m => m.weekend.bars).map(m => ({ market: m.market, label: m.label, bars: m.weekend.bars, symbols: m.weekend.symbols })),
    shifted: H.series.filter(s => s.shifted).map(s => ({ ...pick(s), bars: s.weekdays.reduce((t, x) => t + x, 0), weekdays: s.weekdays, ...s.shifted })),
    duplicatesBySession: H.series.flatMap(s => s.duplicates),
    breaks: H.series.flatMap(s => s.jumps.map(j => ({ ...pick(s), bar: j.bar, prev: j.prev, ratio: j.ratio, pct: j.pct, tag: j.tag, suggestedRatio: j.suggestedRatio,
      state: j.state, action: j.action, adjustedRatio: j.adjustedRatio }))),
    stale: H.series.filter(s => s.stale).map(s => ({ ...pick(s), last: s.stale.last, expected: s.stale.expected, sessionsBehind: s.stale.sessionsBehind })),
    missing: H.series.flatMap(s => s.gaps.filter(g => g.counted).map(g => ({ ...pick(s), after: g.after, before: g.before, sessions: g.sessions }))),
  };
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
                        asOf: lr.asOf || null, asOfFrom: lr.asOfFrom || null, setupsHash: lr.setupsHash || null, recorded: lr.recorded ?? null,
                        evaluated: lr.evaluated ?? null, skippedMarkets: Array.isArray(lr.skippedMarkets) ? lr.skippedMarkets : [], replayAsOf: lr.replayAsOf || null, legacy: true } : null;
  const byTime = [...runList].sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const lastAttempt = byTime[byTime.length - 1] || legacy;
  /* A run that evaluated no bar at all — every market it would have scanned
     held back as not ready (--ready), or every pair expired — finished
     without failing, but it is not a scan that succeeded on any bar: read
     as one, the dashboard said "the last scan succeeded today, on bars of
     no bar". It stays the latest attempt and is given its reason below.
     Only a run that says so (no bar evaluated, and a count of 0) is read
     this way; a record without counts is read as before. */
  const evaluatedNothing = (r) => !r?.asOf && (r?.counts?.evaluated === 0 || r?.evaluated === 0);
  /* A REPLAY IS NOT THE LAST SCAN. --as-of DATE evaluates a past session on
     purpose, as though the history ended there (and a retry of a replay
     does the same). Read as the last success, one replay of 3 August made
     a current dashboard "behind — the last scan ran today on bars of
     2026-08-03", and headed 3 August's matches as the last scan's. It stays
     an attempt; the last success is the latest run on the history as it
     stands. */
  const replayed = (r) => !!r?.replayAsOf || r?.trigger === 'replay';
  /* A RETRY ANSWERS FOR THE RUN IT RETRIED. --retry re-runs a logged run on
     the history cut where that run read it, by that run's clock: it is a
     scan of that run's moment, not of its own. Placed by its own start, a
     retry of Friday's run made after Monday's had scanned Monday's bar was
     "the last scan" — the dashboard went behind ("the last scan ran today
     on bars of Friday") with Friday's matches as the last scan's — and a
     failed one hid that Monday's had succeeded. So a run is placed at the
     start of the run it answers for: a retry at its run's (through a retry
     of a retry), unless that run read no history — the retry then read the
     history as it stands, and answers for itself. A run the log no longer
     holds is placed by the clock the retry read by, which is its run's. A
     retry of the latest run still comes after it, as that run's scan.
     Replays answer for no moment of the scanning, and are left out of
     these runs altogether (above). */
  const byId = new Map(runList.filter(r => r.id != null).map(r => [r.id, r]));
  const answersFor = (r) => {
    let x = r;
    const seen = new Set();
    while (x.trigger === 'retry' && x.retryOf != null && !seen.has(x.retryOf)) {
      seen.add(x.retryOf);
      const o = byId.get(x.retryOf);
      if (!o) return String(x.now || x.startedAt || '');
      if (!o.historyNewest) break;
      x = o;
    }
    return String(x.startedAt || '');
  };
  const nonReplays = byTime.filter(r => !replayed(r)).map((r, i) => ({ r, i, at: answersFor(r) }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.i - b.i).map(x => x.r);
  /* THE STATE IS THE SCANNING'S, NOT A REPLAY'S. A replay was left out of
     the last success, but the latest attempt still judged the state: a
     replay that failed on a typo in --setup put FAILED over a scanner that
     was current, one that evaluated no bar put it behind, and a completed
     one hid a scheduled run that had failed before it. The state reads the
     latest run that is not a replay; a replay stays the latest attempt,
     shown as one. */
  const lastNonReplay = nonReplays[nonReplays.length - 1] || (legacy && !replayed(legacy) ? legacy : null);
  const lastSuccess = [...nonReplays].reverse().find(r => (r.status === 'COMPLETED' || r.status === 'PARTIAL') && !evaluatedNothing(r))
    || (legacy && !evaluatedNothing(legacy) && !replayed(legacy) ? legacy : null);
  const today = now != null && Number.isFinite(scanMs(now)) ? new Date(scanMs(now)).toISOString().slice(0, 10) : null;
  const v = setupsDoc ? scanValidate(setupsDoc) : { setups: [], problems: [] };
  /* REFUSED COUNTS SETUPS. It counted problems, and one setup can have
     several: a setup with a bad timeframe and a bad group logic was "2
     refused" in --status. A setup passes whole or is refused whole, so the
     refused are the entries that did not pass — two entries sharing an id
     are two, though problemsBySetup keys them once. A file that is not a
     list is refused whole, and how many setups it meant to hold is not
     known: null, with the reason in fileRefused, never a 0. problems counts
     the reasons. */
  const setupList = Array.isArray(setupsDoc) ? setupsDoc : Array.isArray(setupsDoc?.setups) ? setupsDoc.setups : null;
  const active = { valid: v.setups.length, enabled: v.setups.filter(s => s.enabled).length, disabled: v.setups.filter(s => !s.enabled).length,
                   expired: v.setups.filter(s => s.enabled && s.expires && today && s.expires < today).length,
                   refused: !setupsDoc ? 0 : setupList ? setupList.length - v.setups.length : null, problems: v.problems.length,
                   fileRefused: setupsDoc && !setupList ? v.problems[0] || null : null };
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
  /* With a later attempt that answers for an older moment — a replay, or a
     retry of an older run — the run the state reads is named as the latest
     on the history as it stands, not as the latest attempt. */
  const latest = (noun) => (lastNonReplay === lastAttempt ? `latest ${noun}` : `latest ${noun} on your history as it stands`);
  const nonReplayFailed = !!lastNonReplay && lastNonReplay.status === 'FAILED';
  if (nonReplayFailed) {
    if (state === 'current') state = 'failed';
    reasons.push(`The ${latest('attempt')}${lastNonReplay.id ? ` (${lastNonReplay.id})` : ''} on ${day(lastNonReplay.startedAt)} failed${lastNonReplay.error?.message ? `: ${lastNonReplay.error.message}` : ''}.`);
  }
  if (lastNonReplay && (lastNonReplay.status === 'COMPLETED' || lastNonReplay.status === 'PARTIAL') && evaluatedNothing(lastNonReplay)) {
    const held = Array.isArray(lastNonReplay.skippedMarkets) ? lastNonReplay.skippedMarkets : [];
    if (state === 'current') state = 'behind';
    reasons.push(`The ${latest('run')}${lastNonReplay.id ? ` (${lastNonReplay.id})` : ''} on ${day(lastNonReplay.startedAt)} evaluated no bar${held.length
      ? `: every market it would have scanned was held back as not ready — ${held.map(m => m.reason || m.market || 'no market row').join('; ')}` : ''}.`);
  }
  const newestBar = historyMeta?.newestBar || null;
  const historyAge = newestBar && today ? scanDayDiff(newestBar, today) : null;
  const ageReason = historyAge > 4 ? `Your history's newest bar is ${historyAge} days old. No exchange calendar is held, so this counts calendar days; more than four (a weekend and a day) is behind.` : null;
  if (lastSuccess) {
    const behind = [];
    if (newestBar && lastSuccess.asOf && lastSuccess.asOf < newestBar) behind.push(`The last scan ran ${day(lastSuccess.finishedAt || lastSuccess.startedAt)} on bars of ${lastSuccess.asOf}; your history's newest bar is ${newestBar}.`);
    if (setupsDoc && lastSuccess.setupsHash && lastSuccess.setupsHash !== scanSetupsHash(setupsDoc)) behind.push('Your setups changed after the last scan ran, so its result is for setups that no longer stand as written.');
    if (lastSuccess.engine && lastSuccess.engine !== engine) behind.push(`The last scan ran on ${lastSuccess.engine}; this page runs ${engine}.`);
    if (ageReason) behind.push(ageReason);
    if (behind.length && state === 'current') state = 'behind';
    reasons.push(...behind);
  } else if (lastNonReplay && evaluatedNothing(lastNonReplay)) {
    /* Held back with no success before it: an old history is usually why. */
    if (ageReason) reasons.push(ageReason);
  } else if (lastAttempt && !nonReplayFailed) {
    /* NO SUCCESS, AND NO FAILURE BUT A REPLAY'S. This read "failed" with
       no reason at all, so a first run still RUNNING, one skipped for want
       of a setups file, a cancelled one or a lone replay put "The latest
       scan failed." over an empty list, beside a tile saying the attempt
       was running or skipped. Nothing has succeeded, so it is not current;
       nothing but a replay failed, so it is behind — and it says which
       attempt, when, and what became of it: the latest that is not a
       replay, or with none, the replay (one that failed says so here). A
       run that is not a replay and FAILED has its reason above. */
    const x = lastNonReplay || lastAttempt, s = x.status;
    const done = s === 'COMPLETED' || s === 'PARTIAL';
    const what = replayed(x) && done
      ? `was a replay of ${x.replayAsOf || 'a past session'}, which evaluates that session as though the history ended there`
      : s === 'RUNNING' || s === 'PENDING' ? 'has not finished'
      : s === 'CANCELLED' ? 'was cancelled before it finished'
      : s === 'FAILED' ? `failed${x.error?.message ? `: ${String(x.error.message).replace(/\.\s*$/, '')}` : ''}`
      : String(s || '').startsWith('SKIPPED') ? `was skipped${x.skipReason ? `: ${String(x.skipReason).replace(/\.\s*$/, '')}` : ''}`
      : `ended ${s ? String(s).toLowerCase().replace(/_/g, ' ') : 'with no status recorded'}`;
    if (state === 'current') state = 'behind';
    reasons.push(`No scan of your history as it stands has succeeded on this machine: the ${x === lastAttempt ? 'latest attempt' : 'latest attempt on it'}${x.id ? ` (${x.id})` : ''} on ${day(x.startedAt)}${replayed(x) && !done ? `, a replay of ${x.replayAsOf || 'a past session'},` : ''} ${what}.`);
    if (ageReason) reasons.push(ageReason);
  }
  const order = new Map(v.setups.map((s, i) => [s.id, i]));
  const rank = (a) => (order.has(a.setupId) ? order.get(a.setupId) : order.size);
  const barOf = (a) => a.candleDate || a.bar || '';
  /* THE LAST SCAN'S MATCHES are the alerts on the bar it ran on and the
     alerts it recorded itself. Only the first were read, so a match the
     scan recorded on an earlier bar — a caught-up day (SC-307), or a market
     whose last session is a day behind another's — was left out, and the
     dashboard said "No setup matched on the bars of that scan" of a run
     whose own record counted the match as recorded. */
  const ofLastScan = (a) => barOf(a) === lastSuccess.asOf || (lastSuccess.id != null && a.runId != null && a.runId === lastSuccess.id);
  const latestMatches = lastSuccess?.asOf ? alerts.map((a, i) => ({ a, i })).filter(x => ofLastScan(x.a))
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
  /* The fixture's last bar carries 2,200 shares and its history no
     `generated` stamp: the record holds the one and says null for the
     other, rather than a 0 or a date made up. */
  const ok = r.alerts.length === 1 && !!a && a.symbol === 'MATCH' && a.bar === lastBar && a.candleDate === lastBar && a.key === key
    && a.id === scanAlertId(key) && a.matchedConditions.length === 3 && a.matchedConditions.every(x => x.state === 'MET') && a.rules.every(x => x.met === true)
    && a.barVolume === 2200 && a.historyGenerated === null && !('gapBefore' in a);
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
