/* ==========================================================================
   TREND CONTEXT ENGINE

   For instruments that have no fundamentals and never will: indices, currency
   pairs, commodities, crypto, and Bursa listings whose statements this product
   cannot reach. Price is the only evidence they have, so price is what gets
   analysed — and nothing here is allowed to leak into a quality or valuation
   score, because a chart is not a business.

   The governing rule of this module is that an indicator with too little
   history does not get computed. A 200-day average built from twelve closes is
   not an approximation of a 200-day average; it is a different number wearing
   its name, and it would be the most dangerous kind of output this product
   could produce — confident, precise, and meaningless.
   ========================================================================== */

/* Each indicator declares what it needs. Nothing computes below that. */
const TREND_INDICATORS = [
  { id:'sma20',  label:'20-day average',   needs:20,  kind:'level' },
  { id:'sma50',  label:'50-day average',   needs:50,  kind:'level' },
  { id:'sma200', label:'200-day average',  needs:200, kind:'level' },
  { id:'dist50', label:'Distance from 50-day',  needs:50,  kind:'pct' },
  { id:'dist200',label:'Distance from 200-day', needs:200, kind:'pct' },
  { id:'cross',  label:'50/200 crossover',      needs:200, kind:'event' },
  { id:'hi52',   label:'52-week high',     needs:252, kind:'level' },
  { id:'lo52',   label:'52-week low',      needs:252, kind:'level' },
  { id:'ddown',  label:'Drawdown from high', needs:252, kind:'pct' },
  { id:'ret1m',  label:'1-month return',   needs:22,  kind:'pct' },
  { id:'ret3m',  label:'3-month return',   needs:66,  kind:'pct' },
  { id:'ret6m',  label:'6-month return',   needs:126, kind:'pct' },
  { id:'ret12m', label:'12-month return',  needs:252, kind:'pct' },
  { id:'vol',    label:'Realised volatility (annualised)', needs:30, kind:'pct' },
];
const TREND_BY_ID = Object.fromEntries(TREND_INDICATORS.map(i => [i.id, i]));

const sma = (a, n) => a.length < n ? null : a.slice(-n).reduce((s, v) => s + v, 0) / n;
const pctChange = (a, n) => (a.length <= n || !(a[a.length - 1 - n] > 0))
  ? null : (a[a.length - 1] / a[a.length - 1 - n] - 1) * 100;

/* Returns every indicator plus, for each one that could not be computed, how
   many more closes it needs. "Not yet" and "not applicable" are different
   answers and the interface has to be able to tell them apart. */
function trendContext(series) {
  const dates = Object.keys(series || {}).sort();
  const closes = dates.map(d => series[d]).filter(v => isNum(v) && v > 0);
  const n = closes.length;
  const last = n ? closes[n - 1] : null;
  const out = { points: n, first: dates[0] || null, lastDate: dates[dates.length - 1] || null,
                values: {}, pending: [] };

  const need = (id) => { const req = TREND_BY_ID[id].needs; if (n < req) { out.pending.push({ id, needs: req, have: n, more: req - n }); return true; } return false; };
  const set = (id, v) => { out.values[id] = v; };

  if (!need('sma20'))  set('sma20',  sma(closes, 20));
  if (!need('sma50'))  set('sma50',  sma(closes, 50));
  if (!need('sma200')) set('sma200', sma(closes, 200));
  if (!need('dist50'))  set('dist50',  (last / sma(closes, 50) - 1) * 100);
  if (!need('dist200')) set('dist200', (last / sma(closes, 200) - 1) * 100);

  if (!need('cross')) {
    /* The most recent day on which the 50-day crossed the 200-day, found by
       walking the two series rather than inferring from today's positions. */
    let found = null;
    for (let i = n - 1; i >= 200; i--) {
      const w = closes.slice(0, i + 1);
      const a = sma(w, 50), b = sma(w, 200);
      const wp = closes.slice(0, i);
      const ap = sma(wp, 50), bp = sma(wp, 200);
      if (a == null || b == null || ap == null || bp == null) break;
      if ((a > b) !== (ap > bp)) { found = { date: dates[i], dir: a > b ? 'up' : 'down' }; break; }
    }
    set('cross', found);
  }

  if (!need('hi52')) {
    const w = closes.slice(-252);
    set('hi52', Math.max(...w)); set('lo52', Math.min(...w));
    set('ddown', (last / Math.max(...w) - 1) * 100);
  }
  [['ret1m', 22], ['ret3m', 66], ['ret6m', 126], ['ret12m', 252]].forEach(([id, k]) => {
    if (!need(id)) set(id, pctChange(closes, k));
  });

  if (!need('vol')) {
    const w = closes.slice(-30);
    const rets = w.slice(1).map((v, i) => Math.log(v / w[i])).filter(Number.isFinite);
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, rets.length - 1);
    set('vol', Math.sqrt(variance) * Math.sqrt(252) * 100);
  }

  /* Splicing an imported series onto screen-read closes leaves a seam: the
     import may end weeks before the daily capture began, and the step between
     them is a gap in the record rather than a move in the market. Left
     unflagged it inflates volatility, distorts every return and can invent a
     drawdown. Found by looking for moves too large to be plausible for the
     instrument, and for calendar gaps wide enough to hide one. */
  out.seams = [];
  for (let i = 1; i < n; i++) {
    const move = (closes[i] / closes[i - 1] - 1) * 100;
    const days = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
    if (Math.abs(move) > 15 || (days > 5 && Math.abs(move) > 5)) {
      out.seams.push({ from: dates[i - 1], to: dates[i], movePct: move, gapDays: Math.round(days) });
    }
  }

  /* Named apart. lastDate is when the series ends; last is what it closed at.
     They shared a name and the drawer printed a price where a date belonged. */
  out.last = last;
  return out;
}

/* Section 13.3. Volume is the one input the capture pipeline never had — a
   screenshot of a watchlist shows a price, not a day's turnover — so this
   works only where a series was imported from an export that carried it. */
function volumeContext(volSeries, priceSeries) {
  const dates = Object.keys(volSeries || {}).sort();
  const vols = dates.map(d => volSeries[d]).filter(v => isNum(v) && v >= 0);
  const n = vols.length;
  if (n < 20) return { points: n, pending: { needs: 20, more: 20 - n } };
  const latest = vols[n - 1];
  const avg = (k) => n < k ? null : vols.slice(-k).reduce((s, v) => s + v, 0) / k;
  const a20 = avg(20), a50 = avg(50);

  /* Up-day and down-day turnover, over the window where both a close and a
     volume exist for the day and the one before it. */
  let upVol = 0, downVol = 0, upDays = 0, downDays = 0;
  const pDates = Object.keys(priceSeries || {}).sort();
  for (let i = 1; i < pDates.length; i++) {
    const d = pDates[i], prev = pDates[i - 1];
    const v = volSeries[d];
    if (!isNum(v)) continue;
    const chg = priceSeries[d] - priceSeries[prev];
    if (chg > 0) { upVol += v; upDays++; } else if (chg < 0) { downVol += v; downDays++; }
  }
  return {
    points: n, latest, avg20: a20, avg50: a50,
    ratio20: a20 ? latest / a20 : null,
    ratio50: a50 ? latest / a50 : null,
    upAvg: upDays ? upVol / upDays : null,
    downAvg: downDays ? downVol / downDays : null,
    /* Above 1 means buyers turned over more than sellers across the window. */
    upDownRatio: (upDays && downDays && downVol) ? (upVol / upDays) / (downVol / downDays) : null,
    upDays, downDays,
  };
}

/* Real observed history for a company, or null. Deliberately separate from
   priceHistory(), which generates a seeded random walk for the sample charts:
   running trend indicators over invented prices would produce a confident
   200-day average of a series that never existed, which is the single most
   misleading thing this module could emit. A company gets trend analysis only
   once genuine closes have been imported or captured for it. */
function realSeriesFor(c) {
  const s = trackedHistory?.series;
  if (!s) return null;
  for (const key of [c.tk, c.code, c.id].filter(Boolean)) {
    const hit = s[String(key).toUpperCase()];
    if (hit && Object.keys(hit).length >= 2) return { symbol: String(key).toUpperCase(), series: hit };
  }
  return null;
}

/* ==========================================================================
   RELATIVE STRENGTH

   Price return against a benchmark, over matched windows.

   Two things make this easy to get wrong and both are handled explicitly.

   First, calendars. Bursa and the US do not share holidays, so two series of
   the same length do not cover the same days. Counting back N rows in each is
   silently comparing different periods. Every window here is built from the
   dates the two series have in COMMON, and counted back within that.

   Second, benchmarks. Not everything has one. Gold measured against the S&P
   500 is a number without a question behind it, so "no appropriate benchmark"
   is an available answer rather than a fallback to whatever is at hand.
   ========================================================================== */
const RS_HORIZONS = [
  { id:'1m',  label:'1 month',   days:22 },
  { id:'3m',  label:'3 months',  days:66 },
  { id:'6m',  label:'6 months',  days:126 },
  { id:'12m', label:'12 months', days:252 },
];

/* An instrument is compared against the market it actually trades in. Where
   there is no defensible comparison the answer is that there is none. */
function benchmarkFor(meta, symbol) {
  /* A symbol may be a registry instrument or a company in the research
     universe; both need a benchmark and only the first carries meta. Falling
     back to the company record is what stops a US equity being told no
     benchmark exists for it. */
  if (!meta && symbol) {
    const hit = U.find(r => String(r.c.tk || '').toUpperCase() === String(symbol).toUpperCase()
                         || String(r.c.code || '').toUpperCase() === String(symbol).toUpperCase());
    if (hit) meta = { market: hit.c.mkt, kind: 'equity' };
  }
  if (!meta) return null;
  if (meta.kind === 'crypto') return { symbol:'BTCUSD', label:'Bitcoin', why:'Crypto is compared against Bitcoin, which is the sector benchmark in practice.' };
  if (meta.kind === 'commodity') return null;
  if (meta.kind === 'fx') return null;
  if (meta.market === 'MY') return { symbol:'KLSE', label:'FTSE Bursa Malaysia KLCI', why:'Malaysian listings and indices are compared against the KLCI.' };
  if (meta.market === 'US') return { symbol:'US500', label:'S&P 500', why:'US listings and indices are compared against the S&P 500.' };
  if (['JP','HK','CN','KR','TW','IN','AU','NZ','SG','TH','ID','PH','VN'].includes(meta.market))
    return { symbol:'US500', label:'S&P 500', why:'No regional benchmark is carried in this build, so a global equity benchmark is used. Read it as global context rather than a like-for-like comparison.', weak:true };
  return null;
}

/* Return over a window measured on dates both series share. */
function alignedReturn(a, b, days) {
  const common = Object.keys(a).filter(d => b[d] != null).sort();
  if (common.length <= days) return { insufficient: true, have: common.length, needs: days + 1 };
  const now = common[common.length - 1], then = common[common.length - 1 - days];
  if (!(a[then] > 0) || !(b[then] > 0)) return { insufficient: true, have: common.length, needs: days + 1 };
  const ra = (a[now] / a[then] - 1) * 100;
  const rb = (b[now] / b[then] - 1) * 100;
  return { insufficient: false, from: then, to: now, instrument: ra, benchmark: rb, excess: ra - rb };
}

function relativeStrength(symbol, meta, allSeries) {
  const bench = benchmarkFor(meta, symbol);
  if (!bench) return { benchmark: null, reason: `No benchmark is defensible here${meta?.kind ? ` for ${meta.kind === 'fx' ? 'a currency pair' : `a ${meta.kind}`}` : ''}. Measuring it against an equity index would be a number with no question behind it.` };
  if (symbol.toUpperCase() === bench.symbol) return { benchmark: bench, isBenchmark: true };
  const a = allSeries[symbol], b = allSeries[bench.symbol];
  if (!a || !b) return { benchmark: bench, reason: `No series for ${!b ? bench.symbol : symbol}. Import one to compare.` };
  return { benchmark: bench, horizons: RS_HORIZONS.map(h => ({ ...h, ...alignedReturn(a, b, h.days) })) };
}

/* Percentile across the instruments sharing a benchmark. Reported only when
   enough peers have the depth — a percentile computed over three instruments
   describes those three, not a market. */
function rsPercentile(symbol, meta, allSeries, registry, horizonDays, minPeers = 8) {
  const bench = benchmarkFor(meta, symbol);
  if (!bench) return null;
  const peers = registry.filter(i => {
    const b2 = benchmarkFor(i, i.symbol);
    return b2 && b2.symbol === bench.symbol && i.symbol.toUpperCase() !== bench.symbol;
  });
  const scored = [];
  for (const pRow of peers) {
    const s = allSeries[pRow.symbol];
    if (!s || !allSeries[bench.symbol]) continue;
    const r = alignedReturn(s, allSeries[bench.symbol], horizonDays);
    if (!r.insufficient) scored.push({ symbol: pRow.symbol, excess: r.excess });
  }
  if (scored.length < minPeers) return { insufficient: true, have: scored.length, needs: minPeers };
  const mine = scored.find(x => x.symbol === symbol);
  if (!mine) return null;
  const below = scored.filter(x => x.excess < mine.excess).length;
  return { insufficient: false, pct: Math.round(below / scored.length * 100), peers: scored.length };
}

/* ==========================================================================
   TREND STRATEGY REGISTRY

   Versioned definitions rather than logic buried in a view, per section 5 of
   the migration specification. A strategy states what it requires, and when a
   requirement is unmet it returns "insufficient history" — never a pass and
   never a fail, because an untested rule has not been satisfied and has not
   been broken either.
   ========================================================================== */
const TREND_STRATEGIES = [
  {
    id: 'qt_trend_context_v1', name: 'Long-term trend context', version: '1.0.0',
    market: 'ALL', status: 'active',
    what: 'Where price sits against its own 50- and 200-day averages, and which way the averages last crossed.',
    limitations: [
      'Describes price only. It says nothing about what the instrument is worth.',
      'Moving averages lag by construction. A crossover confirms a move that has already happened.',
      'On an index this is market context. It is not a signal, and this product does not produce signals.',
    ],
    requires: ['sma50', 'sma200'],
    evaluate: (t) => {
      const a = t.values.sma50, b = t.values.sma200, p = t.last;
      if (!isNum(a) || !isNum(b) || !isNum(p)) return null;
      const above200 = p > b, above50 = p > a, stacked = a > b;
      return {
        state: above200 && stacked ? 'Long-term uptrend context'
             : !above200 && !stacked ? 'Long-term downtrend context'
             : 'Mixed trend context',
        detail: `Price is ${above50 ? 'above' : 'below'} the 50-day and ${above200 ? 'above' : 'below'} the 200-day. The 50-day sits ${stacked ? 'above' : 'below'} the 200-day.`,
      };
    },
  },
  {
    id: 'qt_drawdown_context_v1', name: 'Drawdown and range position', version: '1.0.0',
    market: 'ALL', status: 'active',
    what: 'How far price sits below its own 52-week high, and where it falls in the 52-week range.',
    limitations: [
      'A deep drawdown is not evidence of value, and a new high is not evidence of quality.',
      'Needs a full year of closes before it means anything.',
    ],
    requires: ['hi52', 'lo52', 'ddown'],
    evaluate: (t) => {
      const hi = t.values.hi52, lo = t.values.lo52, p = t.last;
      if (!isNum(hi) || !isNum(lo) || !isNum(p) || hi <= lo) return null;
      const pos = (p - lo) / (hi - lo) * 100;
      return { state: `${pos.toFixed(0)}% of the 52-week range`,
               detail: `${fmtPct(t.values.ddown, 1)} from the high of ${fmtNum(hi, 2)}; the low was ${fmtNum(lo, 2)}.` };
    },
  },
  {
    id: 'qt_relative_strength_v1', name: 'Relative strength against a benchmark', version: '1.0.0',
    market: 'ALL', status: 'active',
    what: 'Total price return against a chosen benchmark over one, three, six and twelve months.',
    limitations: [
      'Price return only. Dividends and distributions are not included.',
      'Outperformance is evidence about price, not about the business or the economy behind it.',
    ],
    requires: ['ret3m'],
    /* Needs a second series, so it is computed where both are available rather
       than from one instrument's indicators. */
    evaluate: () => null,
    external: true,
  },
];

/* ==========================================================================
   TRACKED — instruments that are followed by price alone.

   Everything here is deliberately outside the research universe. The engine
   values a business from its financial statements, and none of these has any
   this product can reach: Bursa Malaysia publishes no machine-readable
   financials and no Malaysian issuer files XBRL anywhere accessible, while an
   index, a currency, a metal and a token have no statements to publish.

   Keeping them separate is the honest arrangement. Admitting them as companies
   would render an empty scorecard and a blank coverage figure next to real
   ones, and an empty analysis reads like a finished analysis that found
   nothing.
   ========================================================================== */
VIEWS.tracked = () => {
  const wrap = el('div', { class: 'stack' });
  wrap.append(mySubnav('tracked'));
  wrap.append(el('div', {}, [
    el('h1', { class: 'h1' }, 'Tracked'),
    el('p', { class: 'lede' },
      'Price and trend only. Nothing here is valued, scored or ranked — these are instruments the engine cannot analyse, followed so the direction is visible alongside the research.'),
  ]));

  const book = priceBook?.prices || {};
  const series = trackedHistory?.series || {};
  const reg = instruments?.instruments || [];
  /* Vendors name the same index several ways — SPX, US500 and ES1! are one
     instrument. Without aliases the same index appears twice, once named and
     once as an unregistered stranger, and its series is split across both. */
  const byId = new Map();
  for (const i of reg) {
    byId.set(i.symbol.toUpperCase(), i);
    for (const a of (i.aliases || [])) if (!byId.has(a.toUpperCase())) byId.set(a.toUpperCase(), i);
  }

  /* Union of what is registered and what actually arrived in the price file,
     so an instrument you started tracking shows up before anyone remembers to
     name it in the registry. An alias present in the price file resolves to
     its canonical row rather than adding a second one. */
  const seen = new Set(), symbols = [];
  for (const raw of [...Object.keys(book), ...reg.map(i => i.symbol)]) {
    const up = raw.toUpperCase();
    if (BY_ID.has(`${up}-SEC`)) continue;      /* a real company belongs in Research, not here */
    const canonical = (byId.get(up)?.symbol || up).toUpperCase();
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    symbols.push({ canonical, seenAs: up });
  }

  if (!symbols.length) {
    wrap.append(el('div', { class: 'card' }, [
      el('p', { class: 'metaline' },
        'No tracked instruments yet. Run the daily import — prices land in the price file and appear here, and a series builds up as the runs accumulate.'),
    ]));
    return wrap;
  }

  const KIND_LABEL = { equity:'Equity', index:'Index', fx:'FX', commodity:'Commodity', crypto:'Crypto', etf:'ETF' };
  const rows = symbols.map(({ canonical: sym, seenAs }) => {
    const meta = byId.get(sym) || byId.get(seenAs) || {};
    /* The price file is keyed by whatever the source called it, so read under
       both names and merge the series — otherwise renaming an alias in the
       registry would orphan the history collected under the old key. */
    const keys = [...new Set([sym, seenAs, meta.symbol, ...(meta.aliases || [])]
      .filter(Boolean).map(s => s.toUpperCase()))];
    const p = keys.map(k => book[k]).find(Boolean) || null;
    const hist = Object.assign({}, ...keys.map(k => series[k] || {}));
    const dates = Object.keys(hist).sort();
    const values = dates.map(d => hist[d]);
    /* Change measured across the stored series, not from the vendor's own
       day-change field, so what is drawn and what is stated agree. */
    const first = values[0], last = values[values.length - 1];
    const chg = (values.length >= 2 && first > 0) ? ((last - first) / first) * 100 : null;
    return { sym, meta, p, dates, values, chg, name: meta.name || sym,
             kind: meta.kind || 'unknown', market: meta.market || '' };
  });

  /* Ordered by what is being looked for, not alphabetically by type: the
     listings that cannot be researched anywhere else in this product come
     first, and the macro context follows. */
  const KIND_ORDER = ['equity', 'index', 'fx', 'commodity', 'crypto', 'etf'];
  const rank = (k) => { const i = KIND_ORDER.indexOf(k); return i === -1 ? KIND_ORDER.length : i; };
  rows.sort((a, b) => (rank(a.kind) - rank(b.kind)) || a.sym.localeCompare(b.sym));

  const depth = Math.max(0, ...rows.map(r => r.dates.length));
  const myEquities = rows.filter(r => r.market === 'MY' && r.kind === 'equity').length;

  const head = el('div', { class: 'card' });
  head.append(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
    el('span', { class: 'chip' }, `${rows.length} instrument${rows.length === 1 ? '' : 's'}`),
    el('span', { class: depth >= 2 ? 'chip' : 'chip chip-bronze' },
      depth >= 2 ? `${depth} day series` : depth === 1 ? '1 day — a trend needs a second run' : 'no series yet'),
    priceBook?.personal ? el('span', { class: 'chip chip-bronze' }, 'read from your screen') : null,
  ]));
  if (myEquities) head.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `${myEquities} Bursa Malaysia listing${myEquities === 1 ? '' : 's'}. ${instruments?.fundamentals?.MY || 'No fundamentals are available for these.'}`));
  wrap.append(head);

  const card = el('div', { class: 'card' });
  const tbl = el('table', { class: 'dt' });
  tbl.append(el('thead', {}, el('tr', {}, [
    el('th', {}, 'Instrument'), el('th', {}, 'Type'),
    el('th', { class: 'num' }, 'Last'), el('th', { class: 'num' }, 'As of'),
    el('th', { class: 'num' }, 'Change over series'), el('th', {}, 'Series'),
    el('th', {}, 'Trend context'),
  ])));
  const tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr');
    tr.append(el('td', {}, [
      el('div', { style: 'font-weight:600' }, r.sym),
      el('div', { class: 'metaline' }, r.name === r.sym ? 'not in the instrument registry' : r.name),
    ]));
    tr.append(el('td', {}, [
      el('span', { class: 'chip' }, KIND_LABEL[r.kind] || 'Unknown'),
      r.market === 'MY' ? el('span', { class: 'chip chip-bronze', style: 'margin-left:4px' }, 'MY') : null,
    ]));
    tr.append(el('td', { class: 'num' }, r.p && isNum(r.p.close) ? fmtNum(r.p.close, r.p.close < 10 ? 4 : 2) : '—'));
    tr.append(el('td', { class: 'num metaline' }, r.p?.date || '—'));
    tr.append(el('td', { class: 'num ' + (r.chg == null ? '' : signClass(r.chg)) },
      r.chg == null ? '—' : withSign(r.chg, 2)));
    const cell = el('td');
    if (r.values.length >= 2) cell.append(sparkline(r.values));
    else cell.append(el('span', { class: 'metaline' }, 'building'));
    tr.append(cell);

    /* Trend state, or how much more history it needs. Never a computed-looking
       value on a series too short to support it. */
    const t = trendContext(series[r.sym] || {});
    const tCell = el('td');
    const ctx = TREND_STRATEGIES[0].evaluate(t);
    if (ctx) {
      tCell.append(el('div', { style: 'font-size:12px;font-weight:600' }, ctx.state));
      tCell.append(el('div', { class: 'metaline' },
        isNum(t.values.dist200) ? `${withSign(t.values.dist200, 1)} vs 200-day` : ''));
    } else {
      const p200 = t.pending.find(x => x.id === 'sma200');
      tCell.append(el('span', { class: 'metaline' },
        p200 ? `${p200.more} more days` : 'no history'));
    }
    tCell.style.cursor = 'pointer';
    tCell.setAttribute('role', 'button');
    tCell.setAttribute('tabindex', '0');
    tCell.setAttribute('aria-label', `Trend detail for ${r.sym}`);
    const openIt = () => openTrendDrawer(r, t);
    tCell.addEventListener('click', openIt);
    tCell.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); } });
    tr.append(tCell);

    tb.append(tr);
  }
  tbl.append(tb);
  card.append(el('div', { style: 'overflow-x:auto' }, tbl));
  card.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    'Change is measured across the stored series, which starts the first time the daily import ran — it is not a 24-hour move unless the series is two days long. Nothing here is a recommendation.'));
  wrap.append(card);
  return wrap;
};

VIEWS.alerts = () => {
  const wrap = el('div');
  wrap.append(mySubnav('alerts'));
  appendSampleBanner(wrap);
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Alerts'),
    el('h1', {}, 'Tell me what changed, and why it matters to my thesis'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Every alert names the fact that changed, the source period, and which thesis condition it maps to. None of them contains an instruction to buy or sell.'),
  ])));

  /* generated alert feed, thesis-linked first */
  const items = [];
  State.theses.forEach(t => {
    const e = evaluateThesis(t);
    e.breaches.forEach(b => items.push({
      sev:'serious', kind:'thesis', id:t.ticker,
      title:`${BY_ID.get(t.ticker).c.tk} — thesis condition breached`,
      what:b.label,
      detail:`Current value ${(b.type === 'val' ? fmtPct(b.actual, 1) : fmtFor(b.k)(b.actual))} against your threshold of ${b.op} ${b.type === 'val' ? fmtPct(b.v, 1) : fmtFor(b.k)(b.v)}.`,
      source:`FY${last(YEARS)} reported · ${AS_OF}`,
    }));
  });
  /* Saved screens with alerting on: anything that entered or left since the
     snapshot was taken is reported as a membership change, with the criteria
     that produced it. */
  State.savedScreens.filter(s => s.alertOnMatch !== false).forEach(s => {
    const diff = screenDiff(s);
    diff.entered.forEach(r => items.push({
      sev:'good', kind:'screen', id:r.c.id,
      title:`${r.c.tk} is a new match for “${s.name}”`,
      what:`It did not clear this screen when the snapshot was taken on ${s.snapshot?.saved ?? s.asOf}.`,
      detail:`Quality ${r.scores.quality.score}, Value ${r.scores.value.score}, ${withSign(r.val.mos?.base, 0)} vs base-case model estimate.`,
      source:`Screen saved ${s.snapshot?.saved ?? s.asOf} · ${s.snapshot?.model ?? s.model}`,
    }));
    diff.left.forEach(m => items.push({
      sev:'warning', kind:'screen', id:m.id,
      title:`${m.tk} no longer matches “${s.name}”`,
      what:'It cleared this screen when the snapshot was taken and no longer does.',
      detail:'Open the screen detail to see which criterion it now fails.',
      source:`Screen saved ${s.snapshot?.saved ?? s.asOf} · ${s.snapshot?.model ?? s.model}`,
    }));
  });

  FEED.filter(f => State.watchlist.includes(f.id) || State.theses.some(t => t.ticker === f.id)).slice(0, 8).forEach(f => {
    items.push({ sev:f.sev, kind:f.kind, id:f.id, title:f.title, what:f.detail,
      detail:'Mapped to your watchlist. No thesis condition covers this yet.', source:`FY${last(YEARS)} reported · ${AS_OF}` });
  });

  const layout = el('div', { class: 'thesis-layout' });

  const feedCard = el('div', { class: 'card' });
  feedCard.append(cardHead(`Alert feed — ${items.length}`, 'Deduplicated: the same fact changing twice in one period produces one alert, not two.'));
  if (!items.length) feedCard.append(emptyState('Nothing has changed state since the last run.'));
  const l = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  items.forEach(a => {
    const s = SEV_STYLE[a.sev] || SEV_STYLE.info;
    const item = el('div', { class: 'noteitem' });
    item.append(el('span', { class: 'ni-icon', style: `background:color-mix(in srgb, var(${s.v}) 15%, transparent);color:var(${s.v})`, html: icon(s.icon, 13) }));
    const b = el('div', { style: 'flex:1;min-width:0' });
    b.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
      el('span', { style: 'font-size:13px;font-weight:600' }, a.title),
      el('span', { class: 'chip' }, ALERT_KINDS.find(k => k.id === a.kind)?.label || a.kind),
    ]));
    b.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:2px' }, a.what));
    b.append(el('p', { class: 'caption', style: 'margin-top:2px' }, a.detail));
    b.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:6px' }, [
      el('span', { class: 'metaline' }, a.source),
      el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openResearch(a.id) }, 'Open evidence'),
      el('button', { class: 'btn btn-quiet btn-sm', onclick: () => go('thesis') }, 'Review thesis'),
    ]));
    item.append(b);
    l.append(item);
  });
  feedCard.append(l);
  layout.append(feedCard);

  /* User-set price thresholds, evaluated against the current price. */
  State.priceAlerts.forEach(pa => {
    const r = BY_ID.get(pa.ticker);
    if (!r) return;
    const hit = pa.op === '>' ? r.c.px.p > pa.price : r.c.px.p < pa.price;
    if (!hit) return;
    items.push({
      sev:'info', kind:'price', id:pa.ticker,
      title:`${r.c.tk} is ${pa.op === '>' ? 'above' : 'below'} ${fmtMoney(pa.price, r.c.ccy)}`,
      what:pa.note || 'Price threshold you set has been crossed.',
      detail:`Now ${fmtMoney(r.c.px.p, r.c.ccy)}. A price move on its own is not new information — check the "Why moved?" attribution or the latest filing before treating it as such.`,
      source:`Price ${AS_OF} · threshold set by you`,
    });
  });

  const rail = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  /* ---------- price alert manager ---------- */
  const pac = el('div', { class: 'card' });
  pac.append(cardHead(`Price alerts — ${State.priceAlerts.length}/${LIMITS.priceAlerts}`,
    'Thresholds you set yourself. They fire on price alone, which is why they are the one alert type off by default in the list below.',
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openPriceAlertEditor(), html: `${icon('plus', 13)} Add` })));
  if (!State.priceAlerts.length) pac.append(el('p', { class: 'caption' }, 'No price alerts set.'));
  const pal = el('div', { style: 'display:flex;flex-direction:column' });
  State.priceAlerts.forEach((pa, i) => {
    const r = BY_ID.get(pa.ticker);
    const hit = r && (pa.op === '>' ? r.c.px.p > pa.price : r.c.px.p < pa.price);
    const row = el('div', { class: 'row row-wrap', style: `gap:8px;padding:8px 0;${i ? 'border-top:1px solid var(--grid)' : ''}` });
    row.append(el('span', { style: 'font-size:13px;font-weight:600;min-width:74px' }, pa.ticker));
    row.append(el('span', { class: 'metaline' }, `${pa.op} ${r ? fmtMoney(pa.price, r.c.ccy) : pa.price}`));
    row.append(el('span', { class: 'spacer' }));
    row.append(hit ? sevChip('info', 'Crossed') : el('span', { class: 'chip' }, 'Waiting'));
    row.append(el('button', { class: 'btn btn-quiet btn-sm', 'aria-label': `Edit ${pa.ticker} price alert`,
      onclick: () => openPriceAlertEditor(pa) }, 'Edit'));
    pal.append(row);
  });
  pac.append(pal);
  rail.append(pac);

  const rules = el('div', { class: 'card' });
  rules.append(cardHead('Alert types', 'Defaults are thesis-linked. Price alerts are available but off by default.'));
  ALERT_KINDS.forEach(k => {
    const lab = el('label', { class: 'checkline', style: 'align-items:flex-start;padding:7px 0;border-bottom:1px solid var(--grid)' });
    lab.append(el('input', { type: 'checkbox', checked: k.id !== 'price' ? '' : null, style: 'margin-top:3px' }));
    const tx = el('div');
    tx.append(el('div', { style: 'font-size:13px;color:var(--ink);font-weight:500' }, k.label));
    tx.append(el('div', { class: 'metaline' }, k.note));
    lab.append(tx);
    rules.append(lab);
  });
  rail.append(rules);

  const pref = el('div', { class: 'card' });
  pref.append(cardHead('Delivery', 'Alert fatigue is the failure mode. Digesting and deduplication are on by default.'));
  const kv = el('dl', { class: 'kv' });
  [['Delivery', 'Daily digest'], ['Deduplication window', '24 hours'], ['Time zone', 'Asia/Kuala_Lumpur'],
   ['Quiet hours', '22:00 – 07:00'], ['Per-company cap', '3 a day']].forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, v)); });
  pref.append(kv);
  pref.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'A US filing published after the Malaysian market closes is held to the next digest rather than sent overnight.'));
  rail.append(pref);
  layout.append(rail);
  wrap.append(layout);
  return wrap;
};

