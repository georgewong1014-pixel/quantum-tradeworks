/* ==========================================================================
   MARKET PULSE — SUPPLY, ASKING PRICE, DEMAND, TRANSACTED PRICE, BY AREA
   --------------------------------------------------------------------------
   The owner, 1 Nov 2026: "Track an indicator allowing to monitor supply,
   supply asking price, demand, demand bidding price." The owner buys,
   refurbishes and lets across Kuching, Miri, Sibu and Bintulu. This is for
   their own decisions, and the same page serves a visitor.

   WHERE THE NUMBERS COME FROM. Mudah and PropertyGuru forbid automated
   collection, so nothing here is fetched or scraped from a listing site and
   the browser makes no new request: the owner chose QUICK MANUAL SNAPSHOTS.
   A reader runs a search themselves, types in how many were listed and the
   asking prices they saw, with a source note. Each snapshot is written to
   the comparables register (the same record, the same log, the same undo,
   the same export and backup) as one `listed` record and up to three
   `ask-price` records. Nothing is stored apart from the register.

   FOUR SERIES, KEPT APART, FOR EACH AREA AND PROPERTY TYPE:
     Supply                 the listings counted: the latest snapshot and its
                            change against the one before
     Supply asking price    the median of the asking prices recorded
     Demand                 how many sales the reader recorded in the period;
                            NAPIC's count for the division and half-year is
                            context beside it, on its own geography
     Demand bidding price   the median of the transacted prices recorded. A
                            transacted price is where a buyer and a seller
                            met, not a bid; real bids are not public.

   RULES THE PAGE KEEPS
   - A median shows only with n of 3 or more; below that the count and "too
     few" are shown. Every figure shows its n and its dates. A cell with
     nothing recorded is "No record", never nought.
   - A snapshot's low, median and high asking prices are ONE observation, the
     median: counting all three as three listings would turn a single search
     into n = 3. A record that carries no snapshot mark (one entered in the
     register by hand) counts as one observation, as it always has.
   - The reader's records are Yours; NAPIC is Official (NAPIC), on its own
     geography, shown beside and never added in. Worked-example rows are
     Illustrative and are not counted.
   - A derived signal needs both sides, for the same area, type and period.
   - Direction is shown as up, down or flat, with the numbers. Nothing is
     ranked, scored, sorted by merit or called hot or cold; nothing advises.
   ========================================================================== */

const MP_MIN_N = 3;                 /* a median needs this many */
const MP_SOLD_WINDOW_MONTHS = 3;    /* the sales counted against a listings count */
const MP_KINDS = ['listed', 'ask-price', 'sold-price', 'ask-rent', 'let-rent', 'vacancy'];
const MP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* What the quick form offers: the residential types. A record of any other
   type already in the register is still shown. */
const MP_FORM_TYPES = PROPERTY_TYPES.filter(t => t !== 'Land' && t !== 'Commercial lot');
const MP_NO_TYPE = 'Type not stated';

/* ------------------------------------------------------------------ dates */
const mpDateOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const mpMonthKey = (d) => d.slice(0, 7);
const mpQuarterKey = (d) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const mpKey = (d, g) => (g === 'q' ? mpQuarterKey(d) : mpMonthKey(d));
const mpPeriodLabel = (k) => (k.includes('Q') ? `${k.slice(5)} ${k.slice(0, 4)}` : `${MP_MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`);
const mpDay = (d) => `${Number(d.slice(8, 10))} ${MP_MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const mpDates = (a, b) => (a === b ? mpDay(a) : `${mpDay(a)} to ${mpDay(b)}`);
/* The date n months before d (the day kept, or the month's last day). */
function mpMinusMonths(d, n) {
  const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) - 1, day = Number(d.slice(8, 10));
  const t = new Date(Date.UTC(y, m - n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ the numbers */
/* A register row this page can use: a kind it reads, a positive number, a
   calendar date, a town and an area. */
const mpUsable = (o) => !!o && typeof o === 'object' && MP_KINDS.includes(o.kind) && isNum(o.value) && o.value > 0
  && mpDateOk(o.date) && !!o.city && !!String(o.area || '').trim();

/* One observation per asking-price snapshot (its median), one per record that
   carries no snapshot mark. A snapshot that gave only a low or a high has no
   median to stand for it: it is counted in `skipped`, not used. */
function mpAskObservations(records) {
  const snaps = new Map(), obs = [];
  for (const r of records) {
    if (!r.snapshotId) { obs.push({ value: r.value, date: r.date }); continue; }
    const s = snaps.get(r.snapshotId) || { date: r.date, lo: null, med: null, hi: null };
    if (r.snapshotRole === 'low') s.lo = r.value; else if (r.snapshotRole === 'high') s.hi = r.value; else s.med = r.value;
    snaps.set(r.snapshotId, s);
  }
  let skipped = 0;
  for (const s of snaps.values()) {
    if (s.med == null) { skipped++; continue; }
    obs.push({ value: s.med, date: s.date, lo: s.lo, hi: s.hi });
  }
  return { obs, skipped };
}

/* Observations grouped by month ('m') or quarter ('q'), oldest first. A bucket
   carries its median only with n of MP_MIN_N or more. */
function mpSeries(obs, g) {
  const by = new Map();
  for (const o of obs) { const k = mpKey(o.date, g); (by.get(k) || by.set(k, []).get(k)).push(o); }
  const buckets = [...by.keys()].sort().map(key => {
    const xs = by.get(key), dates = xs.map(o => o.date).sort();
    const median = xs.length >= MP_MIN_N ? medianOf(xs.map(o => o.value)) : null;
    const los = xs.map(o => o.lo).filter(isNum), his = xs.map(o => o.hi).filter(isNum);
    return { key, label: mpPeriodLabel(key), n: xs.length, median, dateMin: dates[0], dateMax: dates[dates.length - 1],
      lo: los.length ? Math.min(...los) : null, hi: his.length ? Math.max(...his) : null };
  });
  return { g, n: obs.length, buckets, latest: buckets[buckets.length - 1] || null };
}

/* Monthly when every price or rent series the cell has holds MP_MIN_N or more
   in its own latest month; otherwise quarterly (the records are thin). */
function mpGranularity(groups) {
  const present = groups.filter(a => a.length);
  if (!present.length) return 'm';
  return present.every(a => {
    const mk = mpMonthKey(a.reduce((m, o) => (o.date > m ? o.date : m), ''));
    return a.filter(o => mpMonthKey(o.date) === mk).length >= MP_MIN_N;
  }) ? 'm' : 'q';
}

/* The median against the last earlier period that has a median. */
function mpTrend(series) {
  const b = series.latest;
  if (!b || b.median == null) return null;
  const i = series.buckets.indexOf(b);
  for (let j = i - 1; j >= 0; j--) {
    const p = series.buckets[j];
    if (p.median == null) continue;
    const pct = (b.median - p.median) / p.median * 100;
    return { from: p.median, label: p.label, pct, dir: Math.abs(pct) < 0.05 ? 0 : pct > 0 ? 1 : -1 };
  }
  return null;
}

/* Listings counted: snapshots in date order (a later record on the same day
   is later), the latest and the one before. */
function mpSupply(records) {
  if (!records.length) return null;
  const snaps = records.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.recordedAt || '') < String(b.recordedAt || '') ? -1 : String(a.recordedAt || '') > String(b.recordedAt || '') ? 1 : 0));
  const cur = snaps[snaps.length - 1], prev = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const change = prev ? cur.value - prev.value : null;
  return { n: snaps.length, cur, prev, change, pct: prev ? change / prev.value * 100 : null,
    dir: change == null ? null : change > 0 ? 1 : change < 0 ? -1 : 0, dateMin: snaps[0].date, dateMax: cur.date };
}

/* (a - b) / b, in the latest period where BOTH series hold a median. null when
   either side has no record at all; 'few' when both do and no period qualifies. */
function mpGap(sa, sb) {
  if (!sa.n || !sb.n) return null;
  for (let i = sa.buckets.length - 1; i >= 0; i--) {
    const ba = sa.buckets[i], bb = sb.buckets.find(x => x.key === ba.key);
    if (ba.median != null && bb && bb.median != null)
      return { status: 'ok', pct: (ba.median - bb.median) / bb.median * 100, key: ba.key, label: ba.label, a: ba, b: bb };
  }
  return { status: 'few', a: sa.latest, b: sb.latest };
}

/* Listings counted against the sales recorded in the MP_SOLD_WINDOW_MONTHS
   months to the snapshot's date: needs MP_MIN_N of them. */
function mpMonthsOfSupply(supply, soldObs) {
  if (!supply) return null;
  const to = supply.cur.date, from = mpMinusMonths(to, MP_SOLD_WINDOW_MONTHS);
  const n = soldObs.filter(o => o.date > from && o.date <= to).length;
  if (n < MP_MIN_N) return { status: 'few', n, to, from };
  const perMonth = n / MP_SOLD_WINDOW_MONTHS;
  return { status: 'ok', n, to, from, perMonth, listed: supply.cur.value, months: supply.cur.value / perMonth };
}

/* Every cell (a town's area and property type) the register holds a record for. */
function marketPulseModel(rows) {
  const cells = new Map();
  let examples = 0;
  for (const o of rows || []) {
    if (!mpUsable(o)) continue;
    if (o.sample) { examples++; continue; }
    const type = String(o.propertyType || '').trim();
    const key = [o.city, o.area, type].join('\u0001');
    let c = cells.get(key);
    if (!c) { c = { key, city: o.city, area: String(o.area).trim(), type, rec: Object.fromEntries(MP_KINDS.map(k => [k, []])) }; cells.set(key, c); }
    c.rec[o.kind].push(o);
  }
  const out = [...cells.values()].map(c => {
    const askBuilt = mpAskObservations(c.rec['ask-price']);
    const sold = c.rec['sold-price'].map(o => ({ value: o.value, date: o.date }));
    const askRent = c.rec['ask-rent'].map(o => ({ value: o.value, date: o.date }));
    const letRent = c.rec['let-rent'].map(o => ({ value: o.value, date: o.date }));
    const vac = c.rec.vacancy.map(o => ({ value: o.value, date: o.date }));
    const g = mpGranularity([askBuilt.obs, sold, askRent, letRent]);
    const supply = mpSupply(c.rec.listed);
    const ask = mpSeries(askBuilt.obs, g), bid = mpSeries(sold, g);
    const rAsk = mpSeries(askRent, g), rLet = mpSeries(letRent, g), rVac = mpSeries(vac, g);
    return { key: c.key, city: c.city, area: c.area, type: c.type, gran: g,
      supply, ask, askSkipped: askBuilt.skipped, bid, rAsk, rLet, rVac,
      gap: mpGap(ask, bid), months: mpMonthsOfSupply(supply, sold), rentGap: mpGap(rAsk, rLet),
      records: MP_KINDS.reduce((t, k) => t + c.rec[k].length, 0) };
  });
  /* The register's own order, never by what a cell shows: the towns as the
     product lists them, the areas as the town lists them, the types as the
     calculator lists them, a type not stated last. */
  const townI = (id) => { const i = SARAWAK_CITIES.findIndex(t => t.id === id); return i < 0 ? 999 : i; };
  const areaI = (id, a) => { const i = (SARAWAK_CITIES.find(t => t.id === id)?.districts || []).indexOf(a); return i < 0 ? 999 : i; };
  const typeI = (t) => { const i = PROPERTY_TYPES.indexOf(t); return t === '' ? 998 : i < 0 ? 997 : i; };
  out.sort((a, b) => townI(a.city) - townI(b.city) || areaI(a.city, a.area) - areaI(b.city, b.area) || a.area.localeCompare(b.area)
    || typeI(a.type) - typeI(b.type) || a.type.localeCompare(b.type));
  return { cells: out, examples };
}

/* ------------------------------------------------------------------ NAPIC */
/* NAPIC files by division and half-year; the cell is an area of a town. The
   division's residential count is context on its own geography. Its scheme
   price ranges are shown only where a scheme's NAPIC name contains the area's
   name (napicBenchmarks, the area screen's own match) and the scheme is of the
   cell's property type (below). The match is by name, so it is shown as
   "schemes whose NAPIC name contains …", never as the area's prices. */
const MP_NAPIC_TYPE = {
  'Condominium': /^CONDOMINIUM$/,
  'Apartment / flat': /^(LOW-COST )?(APARTMENT|FLAT)$/,
  'Terrace (single storey)': /^SINGLE STOREY (LOW-COST |MEDIUM-COST )?TERRACE$/,
  'Terrace (2 storey)': /^DOUBLE STOREY (LOW-COST |MEDIUM-COST )?TERRACE$/,
  'Semi-detached': /STOREY SEMI-DETACHED$/,
  'Detached / bungalow': /STOREY DETACHED$/,
  'Shophouse': /\bSHOP$/,
};
function mpNapicContext(city, area, type) {
  const division = localityDivision(city, area);
  const doc = division ? napicDoc(division) : null;
  const out = { division, loaded: !!doc, period: doc?.period?.code || null, residential: null, schemes: null };
  if (!doc) return out;
  const res = napicActivity(division, doc.period.code).find(r => r.subsector === 'RESIDENTIAL');
  out.residential = res && isNum(res.count) ? { count: res.count, valueRm: res.valueRm } : null;
  const re = MP_NAPIC_TYPE[type];
  const m = napicBenchmarks(division, { locality: area, limit: 100000 });
  if (!m.matched) out.schemes = { status: 'no-name' };
  else if (!re) out.schemes = { status: 'no-type', matched: m.total };
  else {
    const rows = m.rows.filter(b => b.basisUnit === 'RM_PER_UNIT' && !b.perMonth && re.test(String(b.propertyType || '').trim()));
    out.schemes = rows.length ? { status: 'ok', rows, matched: m.total } : { status: 'no-row', matched: m.total };
  }
  return out;
}

/* ------------------------------------------------------------- the writer */
/* One snapshot, through the register's own writer (addObservation), so each
   record is logged and Undo reverses it. Returns the records written. The
   count and the prices share a date, area, type, source and snapshot id. */
function mpRecordSnapshot({ city, area, propertyType, date, count, low, median, high, source }) {
  const snapshotId = `snap-${date}-${Math.floor(performance.now())}-${(State.observations || []).length}`;
  const base = { city, area, propertyType, date, evidence: 'user', sourceRef: String(source || '').trim(), sourceKind: 'note',
    scope: 'area', snapshot: true, snapshotId };
  const made = [];
  if (isNum(count)) made.push(addObservation({ ...base, kind: 'listed', value: count, snapshotRole: 'count' }));
  [['low', low], ['median', median], ['high', high]].forEach(([role, v]) => {
    if (isNum(v)) made.push(addObservation({ ...base, kind: 'ask-price', value: v, snapshotRole: role }));
  });
  return made;
}

/* The records of the newest snapshot that can still be undone, newest first:
   the register's undo stack read down while the events are adds of one snapshot. */
function mpUndoableSnapshot() {
  const log = registerLog(), undone = new Set(log.filter(e => e.undoOf).map(e => e.undoOf));
  let id = null, n = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (e.undoOf || undone.has(e.seq) || !registerEntity(e.entity)) continue;
    const sid = e.entity === 'observation' && e.op === 'add' ? e.after?.snapshotId : null;
    if (!sid || (id && sid !== id)) break;
    id = sid; n++;
  }
  return id ? { id, n } : null;
}
function mpUndoSnapshot() {
  const s = mpUndoableSnapshot();
  if (!s) return null;
  for (let i = 0; i < s.n; i++) undoLastRegisterChange();
  return s.n;
}

/* ------------------------------------------------------------------ words */
const mpMoney = (v) => fmtMoney(v, 'MYR', 0);
const mpPct = (v, dp = 1) => withSign(v, dp, '%');
const mpArrow = (d) => (d > 0 ? '↑' : d < 0 ? '↓' : '→');
const mpWord = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');
const mpNplural = (n, one, many = `${one}s`) => `${fmtNum(n, 0)} ${n === 1 ? one : many}`;
const mpTooFew = (n) => `n = ${n} — too few`;

/* The words of each series for one cell: what is shown, in one place, so the
   page and the checks read the same sentences. Each is { value, trend, meta,
   hollow }; hollow cells say "No record". */
function mpWords(c) {
  const W = {};
  const so = c.supply;
  W.supply = !so ? { hollow: true, value: 'No record' } : {
    value: `${mpNplural(so.cur.value, 'listing')} counted`,
    asAt: `as at ${mpDay(so.cur.date)}${so.cur.sourceRef ? `, ${so.cur.sourceRef}` : ''}`,
    trend: so.prev ? `${mpArrow(so.dir)} ${mpWord(so.dir)}${so.dir ? ` ${fmtNum(Math.abs(so.change), 0)} (${mpPct(so.pct)})` : ''} from ${fmtNum(so.prev.value, 0)} on ${mpDay(so.prev.date)}` : 'no earlier snapshot to compare',
    meta: `n = ${mpNplural(so.n, 'snapshot')}, ${mpDates(so.dateMin, so.dateMax)}`,
  };
  const med = (s, noun, tr) => {
    if (!s.n) return { hollow: true, value: 'No record' };
    const b = s.latest, dates = mpDates(b.dateMin, b.dateMax);
    if (b.median == null) return { value: mpTooFew(b.n), meta: `${b.label}, ${dates}`, few: true };
    const t = mpTrend(s);
    return { value: mpMoney(b.median), unit: noun, period: b.label,
      trend: t ? `${mpArrow(t.dir)} ${mpWord(t.dir)}${t.dir ? ` ${fmtNum(Math.abs(t.pct), 1)}%` : ''} from ${mpMoney(t.from)} in ${t.label}` : 'no earlier period with 3 or more to compare',
      meta: `${b.label}: n = ${b.n}, ${dates}`,
      range: b.lo != null || b.hi != null ? `snapshot lows and highs: ${b.lo != null ? mpMoney(b.lo) : '—'} to ${b.hi != null ? mpMoney(b.hi) : '—'}` : null };
  };
  W.ask = med(c.ask, 'median asking price');
  W.bid = med(c.bid, 'median transacted price');
  /* Demand: a count of the reader's sold records in the period. */
  const d = c.bid;
  if (!d.n) W.demand = { hollow: true, value: 'No record' };
  else {
    const b = d.latest, i = d.buckets.indexOf(b), p = i > 0 ? d.buckets[i - 1] : null;
    const dir = p ? Math.sign(b.n - p.n) : null;
    W.demand = { value: `${mpNplural(b.n, 'sale')} recorded`, period: b.label,
      trend: p ? `${mpArrow(dir)} ${mpWord(dir)}${dir ? ` ${fmtNum(Math.abs(b.n - p.n), 0)}` : ''} from ${p.n} in ${p.label}` : 'no earlier period to compare',
      meta: `${b.label}: n = ${b.n}, ${mpDates(b.dateMin, b.dateMax)}` };
  }
  return W;
}

/* ------------------------------------------------------------------- page */
const MP_TYPE_NOTE = 'Type not stated: records entered without a property type, kept apart from the typed ones.';
/* The town and area, then the property type, as the form offers them first:
   the last snapshot recorded, else the calculator's deal. */
function mpFormDefaults() {
  const last = (State.observations || []).find(o => o && o.snapshotId && !o.sample && o.city && o.area);
  const deal = State.deal || {};
  const town = (id) => SARAWAK_CITIES.some(c => c.id === id && !c.deprecated);
  const city = last && town(last.city) ? last.city : town(deal.city) ? deal.city : 'kuching';
  const def = SARAWAK_CITIES.find(c => c.id === city);
  const area = last && last.city === city ? last.area : (city === deal.city && deal.district) ? deal.district : (def?.districts || [])[0] || '';
  const type = last && MP_FORM_TYPES.includes(last.propertyType) ? last.propertyType : MP_FORM_TYPES.includes(deal.propertyType) ? deal.propertyType : MP_FORM_TYPES[0];
  return { city, area, type };
}

function mpSnapshotForm() {
  const dft = mpFormDefaults();
  const card = el('section', { class: 'card mp-form', id: 'mp-form', 'aria-labelledby': 'mp-form-h' });
  card.append(cardHead('Record a snapshot', 'Type in what you saw on a search you ran yourself. Nothing is fetched from any listing site.'));
  const field = (id, label, control, hint) => el('div', { class: 'mp-field' }, [el('label', { for: id }, label), control, hint ? el('p', { class: 'metaline mp-hint' }, hint) : null]);

  const towns = SARAWAK_CITIES.filter(c => !c.deprecated);
  const town = el('select', { class: 'select', id: 'mp-town' }, towns.map(c => el('option', { value: c.id }, c.name)));
  town.value = dft.city;
  const area = el('select', { class: 'select', id: 'mp-area', 'aria-label': 'Area' });
  const other = el('input', { class: 'input', id: 'mp-area-other', type: 'text', autocomplete: 'off', 'aria-label': 'Name of the area', placeholder: 'Name of the area', hidden: '' });
  const fillAreas = (city, want) => {
    const names = efLocalities(city);
    if (want && !names.includes(want)) names.unshift(want);
    area.replaceChildren(...names.map(n => el('option', { value: n }, n)), el('option', { value: '__other' }, 'Another area…'));
    area.value = want && names.includes(want) ? want : (names[0] || '__other');
    other.hidden = area.value !== '__other';
  };
  fillAreas(dft.city, dft.area);
  town.addEventListener('change', () => fillAreas(town.value, null));
  area.addEventListener('change', () => { other.hidden = area.value !== '__other'; if (!other.hidden) other.focus(); });
  const type = el('select', { class: 'select', id: 'mp-type' }, MP_FORM_TYPES.map(t => el('option', { value: t }, t)));
  type.value = dft.type;
  /* Today on the reader's calendar, the tab's own (data-now): the served page says no day. */
  const date = el('input', { class: 'input', id: 'mp-date', type: 'date', value: localDay(), 'aria-label': 'Date of the search', 'data-now': '' });
  const num = (id, label, ph) => el('input', { class: 'input', id, type: 'number', inputmode: 'numeric', min: '0', step: '1', placeholder: ph, 'aria-label': label });
  const count = num('mp-count', 'Number listed', 'e.g. 42');
  const low = num('mp-low', 'Asking price, lowest', 'RM, optional');
  const med = num('mp-med', 'Asking price, median', 'RM, optional');
  const high = num('mp-high', 'Asking price, highest', 'RM, optional');
  const src = el('input', { class: 'input', id: 'mp-src', type: 'text', autocomplete: 'off', placeholder: 'e.g. Mudah search, 1 Nov', 'aria-label': 'Source note' });

  card.append(el('div', { class: 'mp-row' }, [field('mp-town', 'Town', town), field('mp-area', 'Area', el('div', { class: 'mp-stack' }, [area, other])), field('mp-type', 'Property type', type)]));
  card.append(el('div', { class: 'mp-row' }, [field('mp-date', 'Date', date), field('mp-count', 'Number listed', count, 'How many were listed for sale.')]));
  card.append(el('div', { class: 'mp-row' }, [field('mp-low', 'Asking price, lowest (RM)', low), field('mp-med', 'Asking price, median (RM)', med), field('mp-high', 'Asking price, highest (RM)', high)]));
  card.append(el('div', { class: 'mp-row' }, [field('mp-src', 'Source note', src, 'Where the numbers came from. Without one the record is kept as a note.')]));

  const status = el('p', { class: 'metaline mp-status', id: 'mp-status', role: 'status' }, '');
  const undo = mpUndoableSnapshot();
  const save = el('button', { type: 'button', class: 'btn btn-primary mp-save', id: 'mp-save', onclick: () => {
    const areaName = area.value === '__other' ? other.value.trim() : area.value;
    const v = (n) => (n.value.trim() === '' ? null : Number(n.value));
    const vals = { count: v(count), low: v(low), median: v(med), high: v(high) };
    const bad = (m) => { status.textContent = m; toast(m); };
    if (!areaName) return bad('Name the area first.');
    if (!mpDateOk(date.value)) return bad('Choose the date of the search.');
    for (const [k, label] of [['count', 'The number listed'], ['low', 'The lowest asking price'], ['median', 'The median asking price'], ['high', 'The highest asking price']]) {
      if (vals[k] != null && (!Number.isFinite(vals[k]) || vals[k] <= 0)) return bad(`${label} must be above zero.`);
      if (vals[k] != null && k === 'count' && !Number.isInteger(vals[k])) return bad('The number listed is a whole number.');
    }
    if (Object.values(vals).every(x => x == null)) return bad('Enter the number listed, or at least one asking price.');
    const ps = [vals.low, vals.median, vals.high].filter(x => x != null);
    if (ps.some((x, i) => i && x < ps[i - 1])) return bad('Lowest, median and highest should run from smaller to larger.');
    const made = mpRecordSnapshot({ city: town.value, area: areaName, propertyType: type.value, date: date.value,
      count: vals.count, low: vals.low, median: vals.median, high: vals.high, source: src.value });
    const where = `${areaName}, ${townName(town.value)} · ${type.value}`;
    State.mpSaved = `Saved ${mpNplural(made.length, 'record')} for ${where}, ${mpDay(date.value)}.`;
    toast(State.mpSaved);
    renderKeepFocus();
  } }, 'Save snapshot');
  const undoBtn = el('button', { type: 'button', class: 'btn btn-ghost mp-undo', id: 'mp-undo', disabled: undo ? null : '', onclick: () => {
    const n = mpUndoSnapshot();
    State.mpSaved = n ? `Undid the last snapshot (${mpNplural(n, 'record')}).` : 'Nothing to undo.';
    toast(State.mpSaved);
    renderKeepFocus();
  } }, undo ? `Undo last snapshot (${undo.n})` : 'Undo last snapshot');
  card.append(el('div', { class: 'mp-act' }, [save, undoBtn]));
  if (State.mpSaved) { status.textContent = State.mpSaved; State.mpSaved = null; }
  card.append(status);
  card.append(el('p', { class: 'metaline mp-hint' },
    'A snapshot is saved to the comparables register: the count as Listings counted, each asking price as an Asking price, all with the date, area, type and source note above. A snapshot’s lowest, median and highest count once, as its median. Kept in this browser, in Export everything and in backups with the register.'));
  return card;
}

function mpNapicLine(ctx) {
  const where = `${ctx.division} division, ${ctx.period || 'H1 2025'} (NAPIC)`;
  if (!ctx.division) return el('p', { class: 'mp-ctx' }, [el('span', { class: 'chip' }, 'Official (NAPIC)'), ' No NAPIC division is recorded for this town, so there is no official count to set beside it.']);
  if (!ctx.loaded) return el('p', { class: 'mp-ctx' }, [el('span', { class: 'chip' }, 'Official (NAPIC)'), ` The ${ctx.division} division’s count is loading, or could not be loaded.`]);
  if (!ctx.residential) return el('p', { class: 'mp-ctx' }, [el('span', { class: 'chip' }, 'Official (NAPIC)'), ` ${where}: no residential count published.`]);
  return el('p', { class: 'mp-ctx', 'data-mp-napic': ctx.division }, [el('span', { class: 'chip' }, 'Official (NAPIC)'),
    ` ${where}: ${mpNplural(ctx.residential.count, 'residential transaction')}, the whole division. A different measure on a wider geography, set beside your count and never added to it.`]);
}

function mpNapicSchemes(ctx, area) {
  const s = ctx.schemes;
  if (!ctx.loaded || !s) return null;
  const box = el('details', { class: 'mp-schemes' });
  box.append(el('summary', {}, 'NAPIC scheme price ranges, as context'));
  const where = `${ctx.division} division, ${ctx.period} (NAPIC)`;
  if (s.status === 'no-name') box.append(el('p', { class: 'metaline' }, `No NAPIC scheme name contains “${area}”, so no scheme ranges are shown for this area.`));
  else if (s.status === 'no-type') box.append(el('p', { class: 'metaline' }, `${s.matched} NAPIC scheme${s.matched === 1 ? '' : 's'} contain “${area}” in the name. Choose a property type that has a NAPIC match to see their ranges.`));
  else if (s.status === 'no-row') box.append(el('p', { class: 'metaline' }, `${s.matched} NAPIC scheme${s.matched === 1 ? '' : 's'} contain “${area}” in the name, none with a price range for this property type.`));
  else {
    box.append(el('p', { class: 'metaline' }, [el('span', { class: 'chip' }, 'Official (NAPIC)'),
      ` ${where}. Schemes whose NAPIC name contains “${area}”, of this property type: ${s.rows.length} of ${s.matched}. Observed ranges across NAPIC’s sample of each scheme, not transacted prices of this area and not a bid.`]));
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Scheme', 'NAPIC type', 'Sample', 'Observed range'].map((h, i) => el('th', { style: i === 2 || i === 3 ? null : 'text-align:left', class: i === 2 || i === 3 ? 'num' : null }, h)))));
    t.append(el('tbody', {}, s.rows.slice(0, 6).map(b => el('tr', {}, [
      el('th', { scope: 'row', style: 'text-align:left' }, b.scheme),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, String(b.propertyType || '').toLowerCase()),
      el('td', { class: 'num' }, napicSampleWords(b, ctx.period)),
      el('td', { class: 'num', title: b.sampleSize === 1 ? 'One property, not the scheme’s price' : b.rangeLabel }, b.min === b.max ? mpMoney(b.min) : `${mpMoney(b.min)}–${mpMoney(b.max)}`),
    ]))));
    box.append(el('div', { class: 'tablewrap' }, t));
    if (s.rows.length > 6) box.append(el('p', { class: 'metaline' }, `Showing the first 6 of ${s.rows.length}.`));
  }
  return box;
}

function mpFig(series, title, sub, w, extra = []) {
  const f = el('div', { class: `mp-fig${w.hollow ? ' is-hollow' : ''}`, 'data-mp-series': series });
  f.append(el('p', { class: 'mp-fig-t' }, title));
  f.append(el('p', { class: 'mp-fig-sub' }, sub));
  f.append(el('p', { class: `mp-fig-v${w.few ? ' is-few' : ''}`, 'data-mp-value': w.hollow || w.few ? '' : null }, w.value));
  if (w.asAt) f.append(el('p', { class: 'metaline' }, w.asAt));
  if (w.trend) f.append(el('p', { class: 'mp-fig-trend' }, w.trend));
  if (w.range) f.append(el('p', { class: 'metaline' }, w.range));
  if (w.meta) f.append(el('p', { class: 'metaline', 'data-mp-n': '' }, w.meta));
  extra.forEach(x => x && f.append(x));
  return f;
}

function mpSignal(id, title, value, detail, note) {
  return el('div', { class: 'mp-sig', 'data-mp-signal': id }, [
    el('p', { class: 'mp-sig-t' }, title),
    el('p', { class: 'mp-sig-v' }, value),
    detail ? el('p', { class: 'metaline' }, detail) : null,
    note ? el('p', { class: 'metaline' }, note) : null,
  ]);
}

function mpCell(c, ctx) {
  const W = mpWords(c);
  const typeName = c.type || MP_NO_TYPE;
  const card = el('article', { class: 'card mp-cell', 'data-mp-cell': `${c.city}|${c.area}|${c.type}`, 'aria-label': `${c.area}, ${typeName}` });
  card.append(el('div', { class: 'mp-cell-hd' }, [
    el('h3', { class: 'h-card' }, `${c.area} · ${typeName}`),
    kindBadge('yours', { fine: 'Your own records', link: false }),
  ]));
  if (!c.type) card.append(el('p', { class: 'metaline' }, MP_TYPE_NOTE));
  const demandCtx = mpNapicLine(ctx);
  const figs = el('div', { class: 'mp-figs' }, [
    mpFig('supply', 'Supply', 'Listings counted', W.supply),
    mpFig('ask', 'Supply asking price', 'Median asking price', W.ask, c.askSkipped ? [el('p', { class: 'metaline' }, `${mpNplural(c.askSkipped, 'snapshot')} with a lowest or highest price and no median not used.`)] : []),
    mpFig('demand', 'Demand', 'Sales you recorded in the period', W.demand, [demandCtx]),
    mpFig('bid', 'Demand bidding price', 'Median transacted price', W.bid,
      [el('p', { class: 'metaline' }, 'A transacted price is where a buyer and a seller met, not a bid. Real bids are not public.')]),
  ]);
  card.append(figs);

  /* Signals: only where both sides exist for the same area, type and period. */
  const sig = [];
  if (c.gap) {
    const g = c.gap;
    sig.push(g.status === 'ok'
      ? mpSignal('gap', 'Ask–transacted gap', `${mpPct(g.pct)} in ${g.label}`,
        `(median asking ${mpMoney(g.a.median)}, n = ${g.a.n}, − median transacted ${mpMoney(g.b.median)}, n = ${g.b.n}) ÷ median transacted.`)
      : mpSignal('gap', 'Ask–transacted gap', 'not shown',
        `Needs 3 or more asking prices and 3 or more transacted prices in the same period. Latest: asking n = ${g.a.n}, transacted n = ${g.b.n}.`));
  }
  if (c.months) {
    const m = c.months;
    sig.push(m.status === 'ok'
      ? mpSignal('months', 'Months of supply', `${fmtNum(m.months, 1)} months`,
        `${fmtNum(m.listed, 0)} listed on ${mpDay(m.to)} ÷ ${fmtNum(m.perMonth, 2)} sold records a month (${m.n} in the ${MP_SOLD_WINDOW_MONTHS} months to ${mpDay(m.to)}).`,
        'Counts only the sales you recorded, so it describes your records, not every sale.')
      : mpSignal('months', 'Months of supply', 'too few sales recorded',
        `${m.n} sold record${m.n === 1 ? '' : 's'} in the ${MP_SOLD_WINDOW_MONTHS} months to ${mpDay(m.to)}; ${MP_MIN_N} are needed.`));
  }
  if (sig.length) {
    card.append(el('div', { class: 'mp-sigs' }, [
      el('p', { class: 'mp-sigs-h' }, 'Derived from the two sides'), ...sig]));
  }

  /* The rental side, from the register's rent and vacancy kinds. */
  if (c.rAsk.n || c.rLet.n || c.rVac.n) {
    const line = (s, label) => {
      if (!s.n) return [label, 'No record'];
      const b = s.latest;
      return [label, b.median == null ? `${mpTooFew(b.n)} (${b.label})` : `${mpMoney(b.median)} a month (${b.label}: n = ${b.n}, ${mpDates(b.dateMin, b.dateMax)})`];
    };
    const rows = [line(c.rAsk, 'Asking rent, median'), line(c.rLet, 'Achieved rent, median')];
    const v = c.rVac;
    rows.push(['Weeks vacant, median', !v.n ? 'No record' : v.latest.median == null ? `${mpTooFew(v.latest.n)} (${v.latest.label})` : `${fmtNum(v.latest.median, 1)} weeks (${v.latest.label}: n = ${v.latest.n}, ${mpDates(v.latest.dateMin, v.latest.dateMax)})`]);
    const gap = c.rentGap;
    rows.push(['Asking against achieved rent', !gap ? 'Needs both an asking and an achieved rent' : gap.status === 'ok'
      ? `${mpPct(gap.pct)} in ${gap.label} (asking n = ${gap.a.n}, achieved n = ${gap.b.n})`
      : `not shown: needs 3 or more of each in the same period (asking n = ${gap.a.n}, achieved n = ${gap.b.n})`]);
    card.append(el('div', { class: 'mp-rent', 'data-mp-rent': '' }, [
      el('p', { class: 'mp-sigs-h' }, 'Rental side'),
      el('dl', { class: 'mp-dl' }, rows.flatMap(([k, val]) => [el('dt', {}, k), el('dd', {}, val)])),
    ]));
  }
  const sch = mpNapicSchemes(ctx, c.area);
  if (sch) card.append(sch);
  return card;
}

function mpEmpty() {
  const card = el('section', { class: 'card mp-empty', id: 'mp-empty', 'aria-labelledby': 'mp-empty-h' });
  card.append(el('h2', { class: 'h-card', id: 'mp-empty-h' }, 'Nothing recorded yet'));
  card.append(el('p', { class: 'body mp-copy' }, 'Record a snapshot above and this page shows four things for each area and property type, kept apart:'));
  const ul = el('ul', { class: 'ticklist mp-copy' });
  [['Supply', 'how many listings you counted, and how that changed since the snapshot before.'],
   ['Supply asking price', 'the median of the asking prices you saw. Asking is what sellers hope for.'],
   ['Demand', 'how many sales you recorded in the period. NAPIC’s count for the whole division and half-year is shown beside it as context: a different measure on a wider geography, never added to yours.'],
   ['Demand bidding price', 'the median of the transacted prices you recorded. A transacted price is where a buyer and a seller met, not a bid, and real bids are not public.']]
    .forEach(([k, v]) => ul.append(el('li', {}, [el('strong', {}, `${k}: `), v])));
  card.append(ul);
  card.append(el('p', { class: 'metaline mp-copy' }, 'A median shows once 3 or more are recorded; below that the page shows the count and says there are too few. An area with nothing recorded reads “No record”, never nought. Where both sides are recorded for the same area, type and period, the page also shows the gap between asking and transacted prices and the months of supply.'));
  card.append(el('p', { class: 'metaline mp-copy' }, 'Sales and rents are recorded on the comparables register, and count here once they carry an area. Nothing is fetched from Mudah, PropertyGuru or any other listing site.'));
  return card;
}

VIEWS.marketPulse = () => {
  const wrap = el('div', { class: 'mp-page', style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(pageHead({ title: 'Market pulse',
    lede: 'Supply, asking price, demand and transacted price for the areas you track, from the counts and prices you record.',
    note: 'Your own snapshots, by town, area and property type. Nothing is fetched from a listing site, and nothing here is ranked or scored.' }));
  wrap.append(mpSnapshotForm());

  const model = marketPulseModel(State.observations || []);
  if (!model.cells.length) { wrap.append(mpEmpty()); }
  else {
    /* Each division's NAPIC file is asked for once; the page is drawn again when it lands. */
    const divs = [...new Set(model.cells.map(c => localityDivision(c.city, c.area)).filter(Boolean))];
    divs.forEach(d => { if (!napicDivisions.has(d)) loadNapic(d).then(() => { if (State.view === 'marketPulse') render(); }); });
    const byTown = new Map();
    model.cells.forEach(c => (byTown.get(c.city) || byTown.set(c.city, []).get(c.city)).push(c));
    byTown.forEach((cells, city) => {
      const sec = el('section', { class: 'mp-town', 'data-mp-town': city, 'aria-labelledby': `mp-town-${city}` });
      sec.append(el('h2', { class: 'h-card mp-town-h', id: `mp-town-${city}` }, townName(city)));
      cells.forEach(c => sec.append(mpCell(c, mpNapicContext(c.city, c.area, c.type))));
      wrap.append(sec);
    });
    if (model.examples) wrap.append(el('p', { class: 'metaline' }, [kindBadge('illustrative', { link: false }),
      ` ${mpNplural(model.examples, 'worked-example record')} in the register ${model.examples === 1 ? 'is' : 'are'} not counted here.`]));
    wrap.append(el('div', { class: 'card mp-notes' }, [
      cardHead('How to read this page', 'What each figure rests on.'),
      el('ul', { class: 'ticklist mp-copy' }, [
        'Each figure is your own record (Yours) with its n and the dates it covers. A period is a month, or a quarter where the records are thin.',
        'A median shows once 3 or more are recorded; below that the count is shown and the figure says too few. A cell with nothing recorded reads No record, never nought.',
        'Asking and transacted prices are never mixed in one median. A snapshot’s lowest, median and highest asking prices count once, as its median.',
        'NAPIC’s figures (Official) are for the division and half-year named beside them. They are shown beside your records, never added to them.',
        'Direction is shown as up, down or flat with the numbers. Nothing is ranked, scored or advised.',
      ].map(x => el('li', {}, x))),
      el('p', { class: 'metaline' }, 'Stored in this browser with the comparables register, in Export everything and in backups.'),
    ]));
  }
  wrap.append(el('div', { class: 'row row-wrap', style: 'gap:8px' }, [
    el('a', { class: 'btn btn-ghost', href: href('/property/comparables'),
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/comparables'); } },
      `Open the comparables register${(State.observations || []).length ? ` — ${State.observations.length}` : ''}`)]));
  return wrap;
};
