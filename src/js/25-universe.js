/* ==========================================================================
   UNIVERSE ASSEMBLY
   ========================================================================== */

/* Declared here, not beside the other loaders: the universe build below reads
   it through realSeriesFor(), and a later `let` would be a temporal dead zone
   rather than a null. It stays null until the history file loads. */
let trackedHistory = null;

/* ==========================================================================
   DATA THE READER BRINGS

   The deployed site carries no prices and no Malaysian statements, because
   nothing it could carry is licensed to redistribute. That is settled and is
   not what this is for.

   What it left broken was the beta: a tester opening the Sarawak page met four
   empty columns, and the app's own advice for filling them was to run a Node
   script from a terminal. That is a reasonable instruction for the person who
   built it and no instruction at all for anyone else.

   So the reader can paste their own figures in, and they stay in their browser.
   This is the licence position turned the right way round: the product ships no
   data it may not ship, and the reader supplies data they already have every
   right to hold — a broker export, their own subscription, a figure read off an
   annual report. Nothing is uploaded, nothing is shared, and every number that
   arrives this way is labelled as theirs rather than promoted to a source of
   record.
   ========================================================================== */
const USER_DATA_KEY = 'userData';
let userData = store.read(USER_DATA_KEY, null) || { series: {}, statements: {}, added: null };
userData.series = userData.series || {};
userData.statements = userData.statements || {};
const saveUserData = () => store.write(USER_DATA_KEY, userData);

const userSeriesCount = () => Object.keys(userData.series).length;
const userCloseCount = () => Object.values(userData.series)
  .reduce((n, s) => n + Object.keys(s).length, 0);

/* Reads a pasted close series. Deliberately permissive about SHAPE and strict
   about VALUES: a broker export, a spreadsheet copy and a hand-typed list all
   arrive differently, and refusing them on formatting would push the reader
   back to the terminal this exists to replace. But a row that cannot be read as
   a date and a positive number is REPORTED, never skipped — a silent drop is
   how someone ends up with a 40-close series they believe is 200, and every
   trend indicator downstream gates on that count.

   Accepts, per line: SYMBOL,DATE,CLOSE  or  DATE,CLOSE when a symbol is given
   separately. Comma, tab or semicolon separated. A header line is detected and
   skipped rather than counted as a failure. */
function parseCloses(text, defaultSymbol) {
  const out = {};                       /* symbol -> { date: close } */
  const rejected = [];
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const cells = line.split(/[,;\t]/).map(s => s.trim().replace(/^["']|["']$/g, ''));
    if (cells.length < 2) { rejected.push({ line: i + 1, text: line, why: 'fewer than two columns' }); return; }

    /* A header names its columns rather than holding a date, so it fails the
       date test like any bad row would — detected here so it is not reported
       as an error the reader has to go and look at. */
    const looksHeader = /date|close|price|symbol|ticker/i.test(line) && !/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(line);
    if (looksHeader) return;

    let symbol, dateCell, closeCell;
    if (cells.length >= 3) { [symbol, dateCell, closeCell] = cells; }
    else { symbol = defaultSymbol; [dateCell, closeCell] = cells; }

    if (!symbol) { rejected.push({ line: i + 1, text: line, why: 'no symbol on the row and none given above' }); return; }

    /* ISO first, then the day-first forms a Malaysian or UK export uses.
       Month-first is NOT guessed: 03/04/2026 is genuinely ambiguous, and
       picking one silently would shift a series by months. */
    let iso = null;
    const d = dateCell;
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) iso = d;
    else {
      const m = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
      if (m) {
        const [, a, b, y] = m;
        if (Number(a) > 12) iso = `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
        else if (Number(b) > 12) iso = `${y}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
        else { rejected.push({ line: i + 1, text: line, why: `ambiguous date "${d}" — use YYYY-MM-DD` }); return; }
      }
    }
    if (!iso) { rejected.push({ line: i + 1, text: line, why: `date "${d}" not recognised — use YYYY-MM-DD` }); return; }

    const close = Number(String(closeCell).replace(/[^0-9.\-]/g, ''));
    if (!Number.isFinite(close) || close <= 0) {
      rejected.push({ line: i + 1, text: line, why: `"${closeCell}" is not a positive price` }); return;
    }

    const sym = String(symbol).toUpperCase();
    (out[sym] = out[sym] || {})[iso] = close;
  });

  const accepted = Object.values(out).reduce((n, s) => n + Object.keys(s).length, 0);
  return { series: out, accepted, rejected, symbols: Object.keys(out) };
}

/* Merged into the deployed history rather than read separately, so every view
   that already reads trackedHistory sees it without knowing it exists. The
   reader's own figure wins on a collision: they supplied it deliberately and
   more recently than anything shipped. */
function mergeUserHistory() {
  if (!userSeriesCount()) return;
  trackedHistory = trackedHistory || { series: {}, volume: {} };
  trackedHistory.series = trackedHistory.series || {};
  for (const [sym, series] of Object.entries(userData.series)) {
    trackedHistory.series[sym] = { ...(trackedHistory.series[sym] || {}), ...series };
  }
  trackedHistory.hasUserData = true;
}

const U = [];          /* the working universe */
const BY_ID = new Map();

function addCompany(c) {
  c.flags = c.flags || { shariah: null, pn17: false, board: c.mkt === 'US' ? 'US listed' : 'Main Market', idx: c.mkt === 'US' ? 'S&P 500' : null };
  /* Bursa companies trade under a numeric code but are read by their short
     name. Display the short name; keep the code for the identity line. */
  if (!c.real) { c.code = c.tk; c.tk = c.id; }   /* real records set both already */
  /* Extend to the full ten-year window before anything is derived from it —
     but ONLY for the illustrative set, where the whole series is synthetic and
     reconstructing earlier years adds no new class of fiction.

     The test used to be "does this company have exactly five rows", which was a
     safe proxy only while five rows meant illustrative and real meant ten. It
     stopped being safe the moment Malaysian statements arrived: four of them
     returned five reported years, matched the count, and had five invented
     years silently prepended to audited figures — which then fed the ten-year
     growth rates, the revenue drawdown and the earnings variability. One of the
     four was Naim, a Sarawak company.

     The proxy is now the fact itself. A real company's history is what was
     reported and nothing else; where that is shorter, the measures needing a
     longer window report themselves unavailable. */
  if (!c.real && c.fin.length === AUTHORED_YEARS) c.fin = [...backcast(c), ...c.fin];
  const d = derive(c);
  const inputs = defaultInputs(c, d);
  const val = valuationRun(c, d, inputs);
  const flags = riskFlags(c, d);
  const risk = riskGrade(flags);

  const scores = {
    quality:  scorePillar('quality', c, d),
    growth:   scorePillar('growth', c, d),
    strength: scorePillar('strength', c, d),
    capital:  scorePillar('capital', c, d),
  };
  /* Valuation pillar leans on the model output, so it is scored separately. */
  const discount = val.mos ? -val.mos.base : null;   /* +ve = trading above base-case model estimate */
  /* Scored across the inputs that could be computed, and null when none could.
     It previously substituted 50, 40 and 40 for missing inputs, so a company
     with no price — which is every company in this build — scored exactly
     50x0.6 + 40x0.2 + 40x0.2 = 46, reported coverage 100%, carried 30% of the
     composite and could be sorted on. All three of its inputs need a price.

     That is the failure the missing-data policy names first: a company cannot
     earn points for a metric that was not tested. Re-based over tested weight
     now, with coverage reporting what was actually tested rather than the
     constant 100 it asserted. */
  const valueParts = [
    { w:.6, s:anchor(val.mos?.base, -35, 45) },
    { w:.2, s:anchor(d.m.fcfy, 0, 9) },
    { w:.2, s:anchor(d.m.dy, 0, 6) },
  ];
  const valueTested = valueParts.filter(x => isNum(x.s));
  const valueWeight = valueTested.reduce((a, x) => a + x.w, 0);
  scores.value = {
    score: valueWeight > 0
      ? Math.round(clamp(valueTested.reduce((a, x) => a + x.s * x.w, 0) / valueWeight, 0, 100))
      : null,
    coverage: Math.round(valueWeight * 100),
    parts: [
      { k:'mosBase', w:.6, label:'Difference to model estimate vs base-case model estimate', raw:val.mos?.base, score:anchor(val.mos?.base, -35, 45), fmt:v=>fmtPct(v), lo:-35, hi:45 },
      { k:'fcfy',    w:.2, label:'Free cash flow yield',           raw:d.m.fcfy,      score:anchor(d.m.fcfy, 0, 9),        fmt:v=>fmtPct(v), lo:0, hi:9 },
      { k:'dy',      w:.2, label:'Dividend yield',                 raw:d.m.dy,        score:anchor(d.m.dy, 0, 6),          fmt:v=>fmtPct(v), lo:0, hi:6 },
    ] };

  /* Section 18.1 screens on the composite scores and the difference to the
     base-case model. Those are derived above, after the metric block has
     already run, so they are attached to the same metric object rather than
     recomputed — the screener then reaches them through the ordinary field
     machinery instead of needing a parallel path. */
  d.m.qscore  = isNum(scores.quality?.score) ? scores.quality.score : null;
  d.m.vscore  = isNum(scores.value?.score)   ? scores.value.score   : null;
  /* Already a percentage — the feed thresholds on `val.mos.base > 18` and
     formats it with fmtPct. Scaling it again put the median model difference at
     -769% and the maximum at 12,544%, and silently turned this screen's
     20% floor into 0.2%. */
  d.m.mosBase = isNum(val.mos?.base) ? val.mos.base : null;

  const row = { c, d, m: d.m, scores, val, inputs, flags, risk, discount };
  U.push(row);
  BY_ID.set(c.id, row);
  return row;
}

/* Removes the illustrative stand-in for a company once the real filing arrives.
   The two carry different ids — 'AAPL' and 'AAPL-SEC' — so nothing collided and
   both stayed in the universe. Seventeen companies were present twice, which is
   not a cosmetic duplication: every cohort percentile counted them twice, so
   each one moved its own ranking, and a screen returned the same business on two
   rows with different numbers. The real filing always wins; the stand-in goes. */
function retireIllustrativeTwin(c) {
  const key = String(c.tk || c.code || '').toUpperCase();
  if (!key) return null;
  const i = U.findIndex(r => !r.c.real && String(r.c.tk || r.c.code || '').toUpperCase() === key
                          && r.c.mkt === c.mkt);
  if (i === -1) return null;
  const [gone] = U.splice(i, 1);
  BY_ID.delete(gone.c.id);
  return gone.c.tk || gone.c.id;
}

RAW.forEach(addCompany);

/* ------------------------------------------------------------ percentiles */
/* Scores are ranked inside valid cohorts — market, sector and business model —
   never against the whole universe alone. */
const COHORTS = {
  all:    () => U,
  market: (r) => U.filter(x => x.c.mkt === r.c.mkt),
  sector: (r) => U.filter(x => x.c.sector === r.c.sector),
  type:   (r) => U.filter(x => x.c.type === r.c.type),
};

function median(values) {
  const arr = values.filter(isNum).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function percentile(value, values) {
  const arr = values.filter(isNum).sort((a, b) => a - b);
  if (!arr.length || !isNum(value)) return null;
  const below = arr.filter(v => v < value).length;
  const equal = arr.filter(v => v === value).length;
  return Math.round((below + equal / 2) / arr.length * 100);
}

function pctFor(row, pillar, cohort = 'market') {
  const peers = COHORTS[cohort](row);
  return percentile(row.scores[pillar]?.score, peers.map(p => p.scores[pillar]?.score));
}
function metricPct(row, key, cohort = 'market', invert = false) {
  const peers = COHORTS[cohort](row);
  const p = percentile(row.m[key], peers.map(x => x.m[key]));
  return isNum(p) ? (invert ? 100 - p : p) : null;
}

/* Momentum / Change is a separate context indicator. It is deliberately kept
   out of the composite pillars — the blueprint is explicit that quality, value,
   risk and momentum must stay separable so the trade-off between them stays
   visible. It needs the whole universe to compute a relative measure, so it
   runs in a second pass. */
const MOM_INPUTS = [
  { k:'rel',     w:.50, label:'Relative strength vs market cohort', lo:-25, hi:25, fmt:v => withSign(v, 1) },
  { k:'ebitDir', w:.30, label:'Operating profit direction',         lo:-20, hi:25, fmt:v => withSign(v, 1) },
  { k:'revDir',  w:.20, label:'Revenue direction',                  lo:-10, hi:20, fmt:v => withSign(v, 1) },
];

function momentumOf(r) {
  const peers = U.filter(x => x.c.mkt === r.c.mkt);
  const medRs = median(peers.map(x => x.c.px.m12)) ?? 0;
  const pc = (a, b) => isNum(a) && isNum(b) && a !== 0 ? (b - a) / Math.abs(a) * 100 : null;
  const raw = {
    rel: isNum(r.c.px?.m12) ? r.c.px.m12 - medRs : null,
    ebitDir: pc(r.d.ebit[LYI - 1], r.d.ebit[LYI]),
    revDir: pc(r.d.rev[LYI - 1], r.d.rev[LYI]),
  };
  let acc = 0, wsum = 0;
  const parts = MOM_INPUTS.map(i => {
    const s = anchor(raw[i.k], i.lo, i.hi);
    if (isNum(s)) { acc += s * i.w; wsum += i.w; }
    return { ...i, raw: raw[i.k], score: s };
  });
  return { score: wsum ? Math.round(acc / wsum) : null, parts, coverage: Math.round(wsum * 100),
           cohortMedian: medRs };
}

/* Re-runnable: cohort percentiles and momentum are relative measures, so they
   must be recomputed whenever the universe changes size. */
/* Recomputes the four observed-price fields once history is available. Metrics
   are otherwise derived once, at build time, which happens before the history
   file has loaded — so without this every momentum field would stay null no
   matter how much history was imported. */
function refreshMomentum() {
  let backed = 0;
  for (const r of U) {
    const obs = realSeriesFor(r.c);
    const t = obs ? trendContext(obs.series) : null;
    const m = r.m;
    m.rs12    = t && isNum(t.values.ret12m)  ? t.values.ret12m  : null;
    m.from52  = t && isNum(t.values.ddown)   ? t.values.ddown   : null;
    m.sma200d = t && isNum(t.values.dist200) ? t.values.dist200 : null;
    m.range52 = (t && isNum(t.values.hi52) && isNum(t.values.lo52) && t.values.hi52 !== t.values.lo52)
      ? (t.last - t.values.lo52) / (t.values.hi52 - t.values.lo52) * 100 : null;
    m.pxPoints = t ? t.points : 0;
    if (t) backed++;
  }
  return backed;
}

function finaliseUniverse() {
U.forEach(r => { r.mom = momentumOf(r); });
U.forEach(r => {
  r.pct = {
    quality:  pctFor(r, 'quality'),
    growth:   pctFor(r, 'growth'),
    strength: pctFor(r, 'strength'),
    capital:  pctFor(r, 'capital'),
    value:    pctFor(r, 'value'),
  };
  r.pctAll = { quality: pctFor(r, 'quality', 'all'), value: pctFor(r, 'value', 'all') };
});
}
finaliseUniverse();

/* ==========================================================================
   GENERATED SERIES — deterministic, seeded by ticker
   ========================================================================== */

/* 52 weekly closes ending at the current price, consistent with the stated
   12-month return and the 52-week range. */
function priceHistory(c) {
  if (!isNum(c.px?.p) || !isNum(c.px?.m12)) return null;   /* nothing to draw */
  const rnd = seeded(c.id + 'px');
  const n = 52;
  const start = c.px.p / (1 + c.px.m12 / 100);
  /* Random walk pinned at both ends (a Brownian bridge), so the series joins the
     current price naturally instead of jumping to it on the last step. */
  const walk = [0];
  for (let i = 1; i <= n; i++) walk.push(walk[i - 1] + (rnd() - 0.5) * c.px.p * 0.030);
  const drift = walk[n];
  return walk.map((w, i) => {
    const t = i / n;
    const bridged = w - drift * t;                 /* forces the walk back to zero at t = 1 */
    return clamp(start + (c.px.p - start) * t + bridged, c.px.lo * 0.985, c.px.hi * 1.015);
  });
}

/* Annual closes, for point-in-time views. The latest year is the current price
   and the prior year is implied by the stated twelve-month return; earlier years
   are generated deterministically from the seed. */
function priceSeries(c) {
  if (!isNum(c.px?.p) || !isNum(c.px?.m12)) return new Array(YEARS.length).fill(null);
  const rnd = seeded(c.id + 'annual');
  const n = YEARS.length, out = new Array(n);
  out[n - 1] = c.px.p;
  out[n - 2] = c.px.p / (1 + c.px.m12 / 100);
  for (let i = n - 3; i >= 0; i--) {
    const ret = (rnd() - 0.40) * 0.55;              /* roughly −22% to +33% */
    out[i] = Math.max(0.05, out[i + 1] / (1 + ret));
  }
  return out;
}

/* A point-in-time universe. Statements are truncated to the chosen fiscal year
   and the price that applied then is used, then the SAME derivation, model
   router and scoring code is re-run. Nothing is read from the present, which is
   what makes the time slider a genuine "as it looked then" rather than today's
   answer replotted. Bank and REIT sector metrics (capital, occupancy, gearing)
   are the exception — the dataset carries only their current values. */
const _asOfCache = new Map();
function universeAsOf(yi) {
  if (_asOfCache.has(yi)) return _asOfCache.get(yi);
  const rows = U.map(r => {
    const c = r.c;
    const shadow = { ...c, fin: c.fin.slice(0, yi + 1), px: { ...c.px, p: priceSeries(c)[yi] } };
    const d = derive(shadow);
    const inputs = defaultInputs(shadow, d);
    const val = valuationRun(shadow, d, inputs);
    const q = scorePillar('quality', shadow, d);
    return { id: c.id, c, shadow, d, inputs, val, q, price: shadow.px.p };
  });
  rows.forEach(x => {
    const mkt = rows.filter(p => p.c.mkt === x.c.mkt);
    const sec = rows.filter(p => p.c.sector === x.c.sector);
    x.qpctMarket = percentile(x.q.score, mkt.map(p => p.q.score));
    x.qpctSector = sec.length > 1 ? percentile(x.q.score, sec.map(p => p.q.score)) : null;
  });
  _asOfCache.set(yi, rows);
  return rows;
}

/* Eight quarters split out of the last two reported years with a stable,
   company-specific seasonal shape. Labelled as derived wherever it is shown. */
function quarters(c, d) {
  const rnd = seeded(c.id + 'q');
  const shape = [0, 1, 2, 3].map(() => 0.85 + rnd() * 0.3);
  const norm = shape.map(s => s / sum(shape) * 4);
  const out = [];
  [LYI - 1, LYI].forEach((yi, k) => {
    for (let q = 0; q < 4; q++) {
      out.push({
        label: `Q${q + 1} FY${YEARS[yi]}`,
        rev: d.rev[yi] / 4 * norm[q],
        ni: d.ni[yi] / 4 * norm[(q + 1) % 4],
      });
    }
  });
  return out;
}

const US_DOCS = [
  ['10-Q', 'Quarterly report for the period ended 30 June 2026', 'Filing'],
  ['8-K',  'Results of operations and financial condition', 'Filing'],
  ['Form 4','Statement of changes in beneficial ownership — director', 'Ownership'],
  ['8-K',  'Entry into a material definitive agreement', 'Filing'],
  ['10-K', 'Annual report for the fiscal year ended 2025', 'Filing'],
];
const MY_DOCS = [
  ['Quarterly report', 'Interim financial report for the quarter ended 30 June 2026', 'Filing'],
  ['Announcement', 'Entitlement notice — interim single-tier dividend', 'Dividend'],
  ['Announcement', 'Changes in substantial shareholder’s interest', 'Ownership'],
  ['Circular', 'Notice of annual general meeting and statement to shareholders', 'Governance'],
  ['Annual report', 'Annual report for the financial year ended 2025', 'Filing'],
];

function documents(c) {
  const rnd = seeded(c.id + 'doc');
  const src = c.mkt === 'US' ? US_DOCS : MY_DOCS;
  const days = [4, 12, 23, 41, 96];
  return src.map(([form, title, kind], i) => {
    const dt = new Date(2026, 6, 30);
    dt.setDate(dt.getDate() - days[i] - Math.floor(rnd() * 4));
    return {
      form, title, kind,
      date: dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      changed: i === 0 ? changeSummary(c) : null,
      href: c.mkt === 'US' ? 'https://www.sec.gov/search-filings' : 'https://www.bursamalaysia.com/market_information/announcements/company_announcement',
    };
  });
}

/* "What changed" is computed from the company's own last two reported years —
   it is a diff, not a generated narrative. */
function changeSummary(c) {
  const r = BY_ID.get(c.id); if (!r) return null;
  const d = r.d, i = LYI;
  const pctChange = (a, b) => isNum(a) && isNum(b) && a !== 0 ? (b - a) / Math.abs(a) * 100 : null;
  return [
    { label:'Revenue',            v:pctChange(d.rev[i-1], d.rev[i]) },
    { label:'Operating profit',   v:pctChange(d.ebit[i-1], d.ebit[i]) },
    { label:'Net profit',         v:pctChange(d.ni[i-1], d.ni[i]) },
    { label:c.type==='reit' ? 'Distribution per unit' : 'Dividend per share', v:pctChange(d.dps[i-1], d.dps[i]) },
    { label:'Shares in issue',    v:pctChange(d.sh[i-1], d.sh[i]) },
  ].filter(x => isNum(x.v));
}

/* --------------------------------------------------- change feed for Home */
function buildFeed() {
  const feed = [];
  U.forEach(r => {
    const { c, m, val } = r;
    if (val.mos && val.mos.base > 18 && val.confBand !== 'Low')
      feed.push({ kind:'valuation', sev:'good', id:c.id, title:`${c.tk} moved to a ${fmtPct(val.mos.base,0)} discount to base-case model estimate`,
        detail:`${val.pack.name}, ${val.confBand.toLowerCase()} confidence. Largest driver: ${driverImpact(c, r.d, r.inputs)[0].label}.` });
    if (isNum(m.cashPayout) && m.cashPayout > 100)
      feed.push({ kind:'dividend', sev:'serious', id:c.id, title:`${c.tk} distribution is ${fmtPct(m.cashPayout,0)} of free cash flow`,
        detail:'Cash cover below 1.0× — the payout is being funded from the balance sheet rather than from operations.' });
    if (isNum(c.px?.m3) && Math.abs(c.px.m3) > 10)
      feed.push({ kind:'price', sev: c.px.m3 > 0 ? 'good' : 'warning', id:c.id, title:`${c.tk} ${c.px.m3 > 0 ? 'up' : 'down'} ${fmtPct(Math.abs(c.px.m3),1)} over three months`,
        detail:'Price move only. Check the "Why moved?" attribution before treating this as new information.' });
    if (isNum(m.revDD) && m.revDD > 25)
      feed.push({ kind:'fundamental', sev:'warning', id:c.id, title:`${c.tk} revenue drawdown of ${fmtPct(m.revDD,0)} in the reported window`,
        detail:'Cyclical profile — the valuation model has been routed to a mid-cycle normalised pack.' });
    if (r.risk.band === 'High')
      feed.push({ kind:'risk', sev:'serious', id:c.id, title:`${c.tk} carries a High composite risk grade`,
        detail:`${r.flags.filter(f => f.sev !== 'good').length} open risk flags, led by "${r.flags.find(f => f.sev !== 'good')?.title}".` });
  });
  return feed;
}
let FEED = buildFeed();

/* ==========================================================================
   REAL DATA — SEC-filed fundamentals, behind a flag
   --------------------------------------------------------------------------
   Enable with ?real=1 or the toggle on Home. Companies loaded this way carry
   audited statements from SEC EDGAR and NO PRICE, because SEC publishes
   filings and not market data. That is the licensing gap made visible rather
   than described: everything price-derived shows as unavailable until a price
   is supplied, and nothing is imputed to paper over it.
   ========================================================================== */
/* On by default. It was opt-in, and the cost of that was not visible from
   inside: an external audit of the deployed site counted 36 companies and
   concluded the product's data was entirely synthetic. It was not — 119 real
   SEC filings were deployed and working the whole time, behind a flag nobody
   had a reason to find. Hiding audited statements to avoid showing the gaps
   they carry is the wrong side of this product's own argument, which is that a
   missing figure should be visible rather than filled in.

   ?real=0 still turns it off, so the sample-only view remains reachable for
   comparison and for screenshots of the illustrative set. */
const realEnabled = () => {
  const q = new URLSearchParams(location.search).get('real');
  if (q === '1') return true;
  if (q === '0') return false;
  return store.read('realData', true);
};

/* A price a user typed in themselves. Explicitly not market data, and labelled
   as such everywhere it is used. */
const manualPrices = store.read('manualPrices', {});
const setManualPrice = (id, p) => {
  if (isNum(p) && p > 0) manualPrices[id] = p; else delete manualPrices[id];
  store.write('manualPrices', manualPrices);
};

/* Business model drives the valuation router, and SEC filings do not carry a
   classification we can trust for it. Rather than guess from SIC codes, the
   mapping is explicit and small — and anything unmapped defaults to the
   general pack with the assumption stated on the page. */
const REAL_TYPES = { JPM:'bank', RIVN:'early', XOM:'cyclical', CAT:'cyclical', NEE:'mature' };
const REAL_SECTORS = {
  AAPL:['Technology','Consumer Electronics'], MSFT:['Technology','Software — Infrastructure'],
  GOOGL:['Communication Services','Interactive Media'], NVDA:['Technology','Semiconductors'],
  JPM:['Financials','Diversified Banks'], XOM:['Energy','Integrated Oil & Gas'],
  NEE:['Utilities','Electric Utilities'], CAT:['Industrials','Construction Machinery'],
  KO:['Consumer Staples','Soft Drinks'], RIVN:['Consumer Discretionary','Automobile Manufacturers'],
};

function realToCompany(r) {
  /* Ingestion emits nulls for lines a filer does not report. The engine already
     treats null as "not available" rather than zero, so they pass through. */
  const fin = r.fin.map(row => row.map(v => (v == null ? null : v)));
  /* Order matters. A curated entry wins, then the filer's own SIC registration,
     then Unclassified. Without the SIC step every newly ingested company fell
     back to "mature" — which routes a bank into a free-cash-flow DCF, an answer
     that is not merely imprecise but meaningless. */
  const [sector, industry] = REAL_SECTORS[r.id]
    || (r.sector && r.sector !== 'Unclassified' ? [r.sector, r.industry] : ['Unclassified', 'Unclassified']);
  /* The ingested tickers deliberately overlap the sample set, so the real
     record takes a distinct id and the two sit side by side. Comparing
     synthetic AAPL against filed AAPL is the most useful thing this flag can
     show — it makes the difference between invented and audited legible. */
  const id = `${r.id}-SEC`;
  const px = isNum(manualPrices[id])
    ? { p: manualPrices[id], d1: null, m1: null, m3: null, m12: null, lo: null, hi: null, manual: true }
    : { p: null, d1: null, m1: null, m3: null, m12: null, lo: null, hi: null };
  return {
    id, name: r.name, tk: r.id, code: r.id, exch: 'SEC filer', mkt: 'US', ccy: 'USD',
    sector, industry, type: REAL_TYPES[r.id] || r.type || 'mature',
    /* Recorded so the page can say the model was assumed rather than let a
       default read as a decision. */
    typeAssumed: !REAL_TYPES[r.id] && (r.assumed !== false),
    sic: r.sic || null, sicDescription: r.sicDescription || null,
    desc: `Audited annual statements retrieved from SEC EDGAR (CIK ${r.cik}) on ${r.retrieved}. SEC publishes filings, not market data — the price basis is stated separately below.`,
    px, fin,
    real: true, cik: r.cik, provenance: r.provenance, gaps: r.gaps,
    completeness: r.completeness, retrieved: r.retrieved,
    seg: [], moat: { kind:'Not assessed', dur:'—', conf:'Low',
      support:[], counter:['No moat assessment exists for a company loaded from filings alone. Moat evidence is analyst work, not a computed field.'] },
    qrisk: 'Loaded from filings only. Segment mix, ownership and qualitative risk have not been researched for this company.',
    own: { insider: null, inst: null, top: [] },
    flags: { shariah: null, pn17: false, board: 'US listed', idx: null },
  };
}

/* ==========================================================================
   MALAYSIAN STATEMENTS — the personal-research lane

   Bursa publishes no machine-readable statements, and no licensed feed has been
   bought, so the deployed site holds no Malaysian financials and says so on
   every surface. Those two facts are unchanged.

   What changed is that the statements turned out to be obtainable, for the
   owner's own research, from the same unlicensed source the prices come from.
   So this file exists on one machine, is git-ignored, cannot reach the deploy,
   and loads only when explicitly asked for with ?personal=1 — never as a silent
   fallback. Every company built from it is marked personal-research, and the
   marking is what makes it safe to look at: nobody, including the owner six
   months from now, should have to remember which numbers these were.
   ========================================================================== */
function myFundamentalsToCompany(r) {
  const fin = r.fin.map(row => row.map(v => (v == null ? null : v)));
  const id = `${r.id}-MY`;
  const px = isNum(manualPrices[id])
    ? { p: manualPrices[id], d1: null, m1: null, m3: null, m12: null, lo: null, hi: null, manual: true }
    : { p: null, d1: null, m1: null, m3: null, m12: null, lo: null, hi: null };
  return {
    id, name: r.name, tk: r.tk || r.id, code: r.id, exch: r.exch || 'Bursa Malaysia',
    mkt: 'MY', ccy: r.ccy || 'MYR',
    sector: r.sector || 'Unclassified', industry: r.sector || 'Unclassified',
    /* No SIC equivalent is published for Bursa, so the model router has nothing
       to route on and the type is assumed. Recorded as assumed so the page can
       say so rather than let a default read as a decision. */
    type: r.type || 'mature', typeAssumed: true,
    desc: `Annual statements for ${r.years[0]}–${r.years[r.years.length - 1]}, retrieved ${r.retrieved} for personal research. Not licensed market data and not redistributable. Bursa Malaysia publishes no machine-readable statements, so nothing equivalent is available to the deployed product.`,
    px, fin,
    real: true, personal: true, provenance: 'personal-research',
    gaps: r.gaps, completeness: r.completeness, retrieved: r.retrieved,
    sarawak: !!r.sarawak, sarawakTheme: r.sarawakTheme || null,
    seg: [], moat: { kind:'Not assessed', dur:'—', conf:'Low', support:[],
      counter:['No moat assessment exists for a company loaded from statements alone.'] },
    qrisk: 'Loaded from annual statements only. Segment mix, ownership and qualitative risk have not been researched for this company.',
    own: { insider: null, inst: null, top: [] },
    flags: { shariah: null, pn17: false, board: 'Bursa Main Market', idx: null },
  };
}

/* End-of-day prices, if a licensed file has been supplied. Absent by default:
   broker-supplied data, a personal TradingView subscription and Yahoo Finance
   all permit viewing but not redistribution, so nothing ships with the repo. */
let priceBook = null;
let myFundamentals = null;
/* Instruments that are tracked by price alone — Malaysian listings, indices,
   FX, commodities, crypto. They are deliberately NOT companies: the engine
   values businesses from financial statements, and none of these has any that
   can be reached. Keeping them out of the universe is what stops an empty
   scorecard from being rendered as though it were a finding. */
let instruments = null;

function applyPrices(c) {
  const p = priceBook?.prices?.[c.tk];
  if (!p || !isNum(p.close)) return false;
  c.px = { p: p.close, d1: p.d1 ?? null, m1: null, m3: null,
           m12: isNum(p.m12) ? p.m12 : null, lo: p.lo ?? null, hi: p.hi ?? null,
           eod: true, asOf: p.date || priceBook.asOf || null };
  c.priceLicence = priceBook.licence || null;
  c.pricePersonal = !!priceBook.personal;
  return true;
}

/* TradingView and most vendors quote the pair as USDMYR; the =X forms turn up
   in files exported from other tools. */
const FX_KEYS = ['USDMYR', 'USDMYR=X', 'MYR=X', 'USD/MYR'];

function applyFx() {
  if (!priceBook?.prices) return false;
  for (const k of FX_KEYS) {
    const p = priceBook.prices[k];
    if (!p || !isNum(p.close) || p.close <= 0) continue;
    /* An inverted or order-of-magnitude-wrong rate would silently rescale every
       cross-market figure on every page, and nothing on screen would look odd.
       USDMYR has not left roughly 2.4–4.8 in modern history, so anything beyond
       a generous band is refused and reported rather than applied. A misread
       digit turning 4.08 into 40.8 is exactly the failure this catches. */
    if (p.close < 2 || p.close > 8) {
      fxRejected = { value: p.close, key: k, why: 'outside a plausible band for USD/MYR — probably a misread digit or an inverted quote' };
      continue;
    }
    FX.USDMYR = p.close;
    FX.asOf = p.date || priceBook.asOf || null;
    /* Per-symbol provenance wins over the file's. An official central-bank rate
       merged into a file of screen-read prices is not itself screen-read, and
       labelling it that way would understate a number that is actually sound. */
    FX.named = p.src || null;
    FX.crossChecked = p.crossChecked || null;
    FX.source = p.src ? 'named' : (priceBook.personal ? 'personal' : 'file');
    FX.personal = p.src ? false : !!priceBook.personal;
    return true;
  }
  return false;
}

async function loadRealData() {
  const j = await fetchJson(dataUrl('us.json'));
  if (!j) throw new Error(`could not load ${dataUrl('us.json')} — it is missing, or the host returned a page instead of the file`);

  /* Optional and non-fatal: no price file simply means the companies load
     without prices, which the engine already handles.

     ?personal=1 reads data/personal-prices.json instead — prices you recognised
     from your own screen, under your own subscription, for your own research.
     Never a silent fallback: it is opt-in, it is git-ignored so it cannot reach
     the deployed site, and every price it supplies is labelled personal
     research rather than licensed market data. */
  const personal = new URLSearchParams(location.search).get('personal') === '1';
  const priceFile = personal ? 'data/personal-prices.json' : 'data/prices.json';
  try {
    const pb = await fetchJson(dataUrl(priceFile.split('/').pop()));
    if (pb) { priceBook = pb; priceBook.personal = personal; priceBook.file = priceFile; }
  } catch { /* no price file supplied */ }

  /* Malaysian statements, personal-research lane only. Requested explicitly or
     not at all: this file is git-ignored so it is absent from any deployment,
     and loading it silently where it happened to exist would make the same
     screen mean two different things depending on whose machine it ran on. */
  if (personal) {
    try {
      const mf = await fetchJson(dataUrl('personal-fundamentals.json'));
      if (mf?.results?.length) myFundamentals = mf;
    } catch { /* absent, which is the normal case */ }
  }

  /* Identity and accumulated series for instruments that are tracked by price
     alone. Both optional: without them the Tracked view simply has less to
     say, and nothing else in the app depends on either. */
  try { instruments = await fetchJson(dataUrl('instruments.json')); }
  catch { /* no registry */ }
  try { trackedHistory = await fetchJson(dataUrl('price-history.json')); }
  catch { /* no history yet */ }
  /* Outside the try, because the deployed site has no history file at all and
     the reader's own closes are the only ones it will ever see. Merging only on
     a successful fetch would have made the feature work everywhere except the
     one place it was built for. */
  mergeUserHistory();

  /* Before anything is derived or drawn: every MYR figure translates through
     this rate, so it has to be settled first. */
  const fxUpdated = applyFx();

  let added = 0, priced = 0;
  const broken = [], superseded = [];
  for (const r of (j.results || [])) {
    if (BY_ID.has(`${r.id}-SEC`)) continue;         /* already loaded */
    /* Per company, not per batch. One filer whose shape the engine cannot
       handle used to abort the whole load: ten companies were in the universe,
       a hundred were not, and the ten that were in had no percentiles because
       finaliseUniverse never ran. A dataset of a hundred names will always
       contain one awkward filer, so the failure has to be contained to it and
       reported by name. */
    try {
      const c = realToCompany(r);
      /* Prices must be attached before the company is derived — everything
         price-dependent is computed once, at build time. */
      if (!isNum(c.px?.p) && applyPrices(c)) priced++;
      RAW.push(c);
      const replaced = retireIllustrativeTwin(c);
      if (replaced) superseded.push(replaced);
      addCompany(c);
      added++;
    } catch (e) {
      broken.push({ id: r.id, error: e.message });
      console.warn(`skipped ${r.id}: ${e.message}`);
    }
  }
  /* Malaysian statements, if the personal file was asked for and found. Built
     after the SEC set so an illustrative Bursa twin is retired by a real record
     the same way a US one is. */
  let addedMY = 0;
  for (const r of (myFundamentals?.results || [])) {
    if (BY_ID.has(`${r.id}-MY`)) continue;
    try {
      const c = myFundamentalsToCompany(r);
      if (!isNum(c.px?.p) && applyPrices(c)) priced++;
      RAW.push(c);
      const replaced = retireIllustrativeTwin(c);
      if (replaced) superseded.push(replaced);
      addCompany(c);
      addedMY++;
    } catch (e) {
      broken.push({ id: r.id, error: e.message });
      console.warn(`skipped ${r.id}: ${e.message}`);
    }
  }

  const momentumBacked = refreshMomentum();
  if (added || addedMY) { finaliseUniverse(); FEED = buildFeed(); }
  return { added, addedMY, priced, fxUpdated, broken, superseded, momentumBacked, generated: j.generated, failures: j.failures || [],
           myStatements: myFundamentals ? { count: myFundamentals.count, retrieved: myFundamentals.results?.[0]?.retrieved || null,
             years: myFundamentals.yearsAvailable || null } : null,
           priceSource: priceBook ? { asOf: priceBook.asOf, licence: priceBook.licence,
             count: priceBook.count, personal: !!priceBook.personal, file: priceBook.file } : null };
}
let realStatus = null;

