/* ==========================================================================
   CANONICAL INSTRUMENTS — one identity per listed thing, and every name it
   goes by

   Three id spaces grew up in this file's neighbours and never met. A company
   row is keyed by c.id, which is a ticker for the illustrative US set
   ('AAPL'), a short name for the illustrative Bursa set ('MAYBANK', with the
   listing code kept in c.code), 'TICKER-SEC' for a filer and 'CODE-MY' for a
   statement set the owner supplied. The price history and the tracked-
   instrument registry are keyed by the bare symbol ('AAPL', '1155'). The
   scanner's setups name bare symbols too. So the same business is 'MAYBANK'
   on the company page, '1155' in the history and '1155-MY' once its
   statements are loaded, and nothing in the code said those were one thing.

   This module says it. Every company row and every registry entry becomes
   one Instrument with a canonical id of the form MARKET:SYMBOL — 'US:AAPL',
   'MY:1155' — that does not change when a filer replaces its illustrative
   stand-in, because the market and the symbol do not change. Everything
   else the instrument has been called is an alias: the old c.id (so every
   link ever shared still resolves), the ticker, the listing code, the
   '-SEC' and '-MY' forms, the CIK, the vendor forms ('1155.KL'). One resolver
   turns any of them into the instrument, and from the instrument into the
   company row when there is one.

   WHAT IT DOES NOT CLAIM. The brief this answers asks for an exchange code,
   an ISIN, a listing status and timestamps on every instrument. The exchange
   is recorded where the data states it (the illustrative set names its
   venue; SEC companyfacts does not, so a filer's exchange is 'unknown' until
   the ingest records it); ISIN has no reachable licensed source and is null;
   status is ACTIVE by assumption and says so, because no exchange status
   feed is connected. A field the data cannot support is a null with a
   stated reason, not a plausible default — the same rule as every figure.

   Pure with respect to the DOM: this file builds maps and answers lookups.
   ========================================================================== */

/* The two markets this product knows. Session hours are the exchanges'
   published regular sessions, recorded for display; nothing derives bar
   timing from them, and holiday calendars are not held (a hand-typed list
   goes stale, and a maintained one comes with a licensed feed). */
const MARKETS = {
  US: { code: 'US', country: 'US', currency: 'USD', label: 'United States', tz: 'America/New_York',
        session: '09:30–16:00 local', exchanges: ['XNAS', 'XNYS'], calendar: 'not held — needs a licensed exchange calendar' },
  MY: { code: 'MY', country: 'MY', currency: 'MYR', label: 'Malaysia', tz: 'Asia/Kuala_Lumpur',
        session: '09:00–12:30 and 14:30–17:00 local', exchanges: ['XKLS'], calendar: 'not held — needs a licensed exchange calendar' },
};

/* ISO 10383 market identifier codes for the venues the data names. */
const EXCHANGE_MIC = [
  ['NASDAQ', 'XNAS'], ['NYSE ARCA', 'ARCX'], ['NYSE AMERICAN', 'XASE'], ['NYSE', 'XNYS'],
  ['BURSA', 'XKLS'], ['MAIN MARKET', 'XKLS'], ['ACE MARKET', 'XKLS'],
];
function exchangeCodeOf(c) {
  if (c.mkt === 'MY') return { code: 'XKLS', source: 'listed' };
  const e = String(c.exch || '').toUpperCase();
  for (const [name, mic] of EXCHANGE_MIC) if (e.includes(name)) return { code: mic, source: 'listed' };
  return { code: 'US', source: 'unknown — SEC companyfacts carries no listing venue; the ingest can record it from the submissions file once data/us.json is regenerated' };
}

const REGISTRY_KIND_TYPE = { equity: 'STOCK', etf: 'ETF', reit: 'REIT', index: 'INDEX', fx: 'FX', commodity: 'COMMODITY', crypto: 'CRYPTO' };

const INSTRUMENTS = new Map();          /* canonical id → Instrument */
const INSTRUMENT_ALIASES = new Map();   /* upper-cased alias → canonical id */
const INSTRUMENT_ALIAS_CLASHES = [];    /* { alias, kept, dropped } — the same name claimed by two instruments */
const DATA_STATUS_RANK = { FILED: 0, ILLUSTRATIVE: 1, UNAVAILABLE: 2 };

const instrumentId = (mkt, symbol) => `${String(mkt || 'US').toUpperCase()}:${String(symbol || '').toUpperCase()}`;
const padCik = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');

/* A company row as an instrument. The symbol is the thing the market trades
   — the listing code for Bursa, the ticker for the US — never the short name. */
function instrumentFromCompany(c) {
  const symbol = String(c.code || c.tk || c.id).toUpperCase();
  const ex = exchangeCodeOf(c);
  const m = MARKETS[c.mkt] || MARKETS.US;
  const aliases = new Set([c.id, c.tk, c.code, `${symbol}-SEC`, `${symbol}-MY`, c.mkt === 'MY' ? `${symbol}.KL` : null]
    .filter(Boolean).map(a => String(a).toUpperCase()));
  /* EVERY WRITTEN FORM OF THE CIK. The record stores it zero-padded, so only
     "CIK0000320193" resolved; "CIK 320193" and "320193" — the form EDGAR's
     own URLs and most readers use — matched nothing. The unpadded number on
     its own is registered only from five digits up: a four-digit bare number
     is a Bursa listing code (AMD's CIK 2488 is also Alliance Bank's code), and
     the listing code keeps it. "CIK 2488" still reaches AMD. */
  if (c.cik) {
    const padded = padCik(c.cik), bare = String(Number(padded));
    [`CIK${padded}`, `CIK ${padded}`, padded, `CIK${bare}`, `CIK ${bare}`].forEach(a => aliases.add(a));
    if (bare.length >= 5) aliases.add(bare);
  }
  return {
    id: instrumentId(c.mkt, symbol), symbol, market: c.mkt, exchangeCode: ex.code, exchangeCodeSource: ex.source,
    companyName: c.name, displayName: c.mkt === 'MY' ? (c.tk || c.name) : symbol,
    country: m.country, currency: c.ccy || m.currency,
    isin: null, isinSource: 'no licensed reference source — not recorded',
    cik: c.cik ? padCik(c.cik) : null,
    sector: c.sector || null, industry: c.industry || null,
    instrumentType: c.type === 'reit' ? 'REIT' : 'STOCK',
    status: 'ACTIVE', statusSource: 'assumed — no exchange status feed is connected',
    dataStatus: c.real ? 'FILED' : 'ILLUSTRATIVE',
    lane: c.personal ? 'personal' : 'product',
    companyId: c.id,
    updatedAt: c.retrieved || null, updatedAtSource: c.retrieved ? 'statements retrieved' : 'illustrative set — no retrieval date',
    aliases: [...aliases],
  };
}

/* A tracked-only registry entry (data/instruments.json): a price series and a
   name, no statements. It is an instrument the scanner can see and the
   research lane cannot value, and its dataStatus says so. */
function instrumentFromRegistry(e) {
  const symbol = String(e.symbol || '').toUpperCase();
  const mkt = String(e.market || 'US').toUpperCase();
  const m = MARKETS[mkt] || MARKETS.US;
  return {
    id: instrumentId(mkt, symbol), symbol, market: mkt, exchangeCode: mkt === 'MY' ? 'XKLS' : 'US',
    exchangeCodeSource: mkt === 'MY' ? 'listed' : 'unknown — registry entry carries no venue',
    companyName: e.name || symbol, displayName: symbol,
    country: m.country, currency: m.currency,
    isin: null, isinSource: 'no licensed reference source — not recorded',
    cik: null, sector: e.sector || null, industry: null,
    instrumentType: REGISTRY_KIND_TYPE[e.kind] || 'STOCK',
    status: 'ACTIVE', statusSource: 'assumed — no exchange status feed is connected',
    dataStatus: 'UNAVAILABLE', dataStatusWhy: 'tracked by price only — no statements are held for it',
    lane: 'personal', companyId: null,
    updatedAt: null, updatedAtSource: 'registry entry — no retrieval date',
    aliases: [symbol, ...(e.aliases || []).map(a => String(a).toUpperCase()), mkt === 'MY' ? `${symbol}.KL` : null].filter(Boolean),
  };
}

function registerAlias(alias, id) {
  const key = String(alias || '').toUpperCase().trim();
  if (!key) return;
  const have = INSTRUMENT_ALIASES.get(key);
  if (!have || have === id) { INSTRUMENT_ALIASES.set(key, id); return; }
  /* Two instruments answer to one name. Filed beats illustrative beats
     price-only; a tie keeps the first and records the clash, so the search
     can show both rather than silently pick. */
  const a = INSTRUMENTS.get(have), b = INSTRUMENTS.get(id);
  const ra = DATA_STATUS_RANK[a?.dataStatus] ?? 9, rb = DATA_STATUS_RANK[b?.dataStatus] ?? 9;
  if (rb < ra) { INSTRUMENT_ALIASES.set(key, id); INSTRUMENT_ALIAS_CLASHES.push({ alias: key, kept: id, dropped: have }); }
  else INSTRUMENT_ALIAS_CLASHES.push({ alias: key, kept: have, dropped: id });
}

/* Rebuilt whenever the universe changes — cheap, and a map built once at
   startup would miss every filer that loads afterwards. */
function rebuildInstruments() {
  INSTRUMENTS.clear(); INSTRUMENT_ALIASES.clear(); INSTRUMENT_ALIAS_CLASHES.length = 0;
  for (const r of U) {
    const ins = instrumentFromCompany(r.c);
    const have = INSTRUMENTS.get(ins.id);
    /* The same market and symbol twice can only be an illustrative twin that
       has not been retired; the filed record is the instrument. */
    if (have && (DATA_STATUS_RANK[have.dataStatus] <= DATA_STATUS_RANK[ins.dataStatus])) { have.aliases = [...new Set([...have.aliases, ...ins.aliases])]; continue; }
    INSTRUMENTS.set(ins.id, ins);
  }
  for (const e of (instruments?.instruments || [])) {
    if (!e?.symbol) continue;
    const ins = instrumentFromRegistry(e);
    const have = INSTRUMENTS.get(ins.id);
    if (have) { have.aliases = [...new Set([...have.aliases, ...ins.aliases])]; have.tracked = true; continue; }
    ins.tracked = true;
    INSTRUMENTS.set(ins.id, ins);
  }
  for (const ins of INSTRUMENTS.values()) { registerAlias(ins.id, ins.id); ins.aliases.forEach(a => registerAlias(a, ins.id)); }
  return INSTRUMENTS.size;
}

/* Any name → the instrument. A market narrows an ambiguous bare symbol
   ('TM' is Telekom on Bursa and Toyota's ADR in New York). */
function resolveInstrument(term, { market = null } = {}) {
  const key = String(term || '').toUpperCase().trim();
  if (!key) return null;
  if (INSTRUMENTS.has(key)) return INSTRUMENTS.get(key);
  if (market) { const scoped = INSTRUMENTS.get(instrumentId(market, key)); if (scoped) return scoped; }
  const id = INSTRUMENT_ALIASES.get(key);
  return id ? INSTRUMENTS.get(id) : null;
}
/* Any name → the company row's id, for routes and saved state. Null for a
   price-only instrument: it has no company page to open. */
function companyIdFor(term, opts) { return resolveInstrument(term, opts)?.companyId || null; }
/* A company → the symbol its price history and the scanner use. */
function instrumentSymbolFor(c) { return c ? instrumentFromCompany(c).symbol : null; }
function instrumentOfCompany(c) { return c ? INSTRUMENTS.get(instrumentId(c.mkt, instrumentSymbolFor(c))) || instrumentFromCompany(c) : null; }

/* What a reader should be told about coverage, in two words. */
function coverageLabel(ins) {
  if (!ins) return null;
  if (ins.dataStatus === 'FILED') return ins.lane === 'personal' ? 'personal research' : 'filed';
  if (ins.dataStatus === 'ILLUSTRATIVE') return 'illustrative';
  return 'price only';
}

/* Search, ranked by how the term matched — an exact symbol or alias first,
   then a symbol prefix, then a word of the name, then anything else — and
   never by any measure of the company. */
function searchInstruments(term, { market = null, instrumentType = null, dataStatus = null } = {}, { limit = 10, offset = 0 } = {}) {
  const q = String(term || '').trim().toUpperCase();
  const all = [...INSTRUMENTS.values()].filter(ins =>
    (!market || ins.market === market) && (!instrumentType || ins.instrumentType === instrumentType) && (!dataStatus || ins.dataStatus === dataStatus));
  if (!q) return { hits: all.slice(offset, offset + limit), total: all.length };
  const scored = [];
  for (const ins of all) {
    const c = ins.companyId ? BY_ID.get(ins.companyId)?.c : null;
    const name = String(ins.companyName || '').toUpperCase();
    let score = null;
    if (ins.symbol === q || ins.id === q || ins.aliases.includes(q)) score = 0;
    else if (ins.symbol.startsWith(q) || ins.aliases.some(a => a.startsWith(q))) score = 1;
    else if (name.split(/[^A-Z0-9]+/).some(w => w.startsWith(q))) score = 2;
    else if (name.includes(q) || String(ins.displayName || '').toUpperCase().includes(q)) score = 3;
    else if (c && (String(c.sector || '').toUpperCase().includes(q) || String(c.industry || '').toUpperCase().includes(q))) score = 4;
    if (score !== null) scored.push({ ins, score });
  }
  scored.sort((a, b) => a.score - b.score || (DATA_STATUS_RANK[a.ins.dataStatus] - DATA_STATUS_RANK[b.ins.dataStatus]) || a.ins.symbol.localeCompare(b.ins.symbol));
  return { hits: scored.slice(offset, offset + limit).map(s => s.ins), total: scored.length };
}

/* Built once here, over the illustrative set the modules above have loaded;
   rebuilt by loadRealData when the filers and the tracked registry arrive. */
rebuildInstruments();
