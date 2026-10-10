/* ==========================================================================
   OFFICIAL MARKET BENCHMARKS — AND THE FIELD THIS DATA CANNOT FILL
   --------------------------------------------------------------------------
   NAPIC's H1 2025 files are now loaded, reconciled to the published Sarawak
   totals to the ringgit, and they still cannot answer the question this
   product was asked for first.

   There is no transaction date in them. The finest period is a half-year.
   There is no individual consideration — every figure is either a count and a
   value for a whole price band in a whole division, or a price range observed
   across a sample of a scheme. There is no lot, no tenure, and no floor area
   attached to any particular sale.

   So "Latest recorded transaction" is not quietly filled with the nearest
   plausible number. It is shown as unavailable, with the reason, next to the
   data that IS here. The four ways it would have been filled, each of which
   produces a figure that looks entirely reasonable:

     the MAXIMUM of a price range is not the latest price
     the MIDPOINT of a range is not a median
     value divided by count is not an individual sale
     a PROMINENT sale is not a representative comparable

   THREE KINDS OF EVIDENCE, NEVER MIXED IN ONE COLUMN.

     Official transaction activity   counts and values, whole division, half-year
     Observed price/rental range     a sample of one scheme, from NAPIC's own survey
     Your own records                what the reader recorded, which is the only
                                     thing that can carry a date

   They are shown as separate blocks with separate headings, because a reader
   who cannot tell which is which will read the tightest number as the truest.
   ========================================================================== */

/* ONE DIVISION AT A TIME (plan item 1.6; the owner's D7, 6 Oct 2026).
   The whole extract was served at /data/napic-h1-2025.json and read by every
   page at boot: 1MB, all 1,583 benchmarks of twelve divisions, against its
   own licence note — "Record-level republication, bulk export and raw-file
   download stay disabled until JPPH confirms commercial redistribution
   rights". It is no longer deployed. build.mjs writes one file per division
   (napicSlices), holding only what the panel below shows, and the panel asks
   for the one division its locality lies in, when it is drawn. Each
   division's file is asked for once a page; the panel redraws when it lands.
   napicStatus says what the last request did, for /status and the harnesses. */
const NAPIC_FILE_PREFIX = 'napic-h1-2025/';
const napicSlug = (division) => String(division).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const napicFile = (division) => `${NAPIC_FILE_PREFIX}${napicSlug(division)}.json`;
/* The division files this build ships, from the versions build.mjs stamps. */
const napicFiles = () => Object.keys(DATA_VERSIONS).filter(f => f.startsWith(NAPIC_FILE_PREFIX));
/* division → { state: 'loading' | 'done' | 'failed', doc, ready } — ready
   resolves to the doc (or null), for a second caller while it is in flight. */
const napicDivisions = new Map();
let napicStatus = { tried: false, ok: false };
const napicDoc = (division) => napicDivisions.get(division)?.doc || null;
const napicLoading = () => [...napicDivisions.values()].some(d => d.state === 'loading');

function loadNapic(division) {
  if (!division) return Promise.resolve(null);
  if (napicDivisions.has(division)) return napicDivisions.get(division).ready;
  const entry = { state: 'loading', doc: null, ready: null };
  napicDivisions.set(division, entry);
  napicStatus.tried = true;
  entry.ready = (async () => {
    try {
      const j = await fetchJson(dataUrl(napicFile(division)));
      if (j && j.division === division && Array.isArray(j.summary) && Array.isArray(j.benchmarks)) entry.doc = j;
    } catch { /* absent is a normal state and the panel says so */ }
    entry.state = entry.doc ? 'done' : 'failed';
    napicStatus.ok = !!entry.doc;
    /* The panel is drawn on the area screen only; it said "loading" there. */
    if (State.view === 'areas') render();
    return entry.doc;
  })();
  return entry.ready;
}

/* A SINGLE OBSERVATION IS NOT A PRICE (D7's display rule, until JPPH
   answers). 165 of Kuching's 208 residential price rows were sampled from
   one property: a figure from one sale, as near to an individual transacted
   price as these files come. Such a row appears only in a list or a table,
   and says what it is in these words; it is never a price on a map, a
   headline or a starting value. A range over two or more is shown as it
   was. */
const napicSampleWords = (b, period) => b.sampleSize === 1
  ? `1 observation in NAPIC’s ${period} sample` : b.sampleSize == null ? '—' : String(b.sampleSize);

/* Which NAPIC division a town sits in. The product files by town; NAPIC files
   by division, and a division holds several towns — so a division figure is
   labelled as the division's, never as the town's. */
const townDivision = (cityId) => (SARAWAK_CITIES.find(c => c.id === cityId) || {}).division || null;
/* A locality can sit in a different division from the town it is listed
   under. The town's division is the answer only when the locality names
   none of its own. */
const localityDivision = (cityId, area) =>
  (SARAWAK_CITIES.find(c => c.id === cityId) || {}).localityDivision?.[area] || townDivision(cityId);

const napicActivity = (division, period = 'H1 2025') =>
  (napicDoc(division)?.summary || []).filter(r => r.periodCode === period);

/* Benchmarks are per scheme. A locality match is a substring test on the
   scheme name, and it is deliberately shown as "schemes NAPIC surveyed in this
   division" rather than "prices in your locality" — the survey does not claim
   to cover a locality and neither should this. */
/* Says what it returned. It fell back to the whole division when no scheme
   name contained the locality, and cut to forty, and said neither — so Bau
   town showed forty Kuching-city schemes and Tabuan forty of its forty-six,
   under a heading about the locality. `matched` and `total` let the panel
   state both. */
function napicBenchmarks(division, { locality = null, limit = 40 } = {}) {
  const doc = napicDoc(division);
  if (!doc) return { rows: [], matched: false, total: 0, divisionTotal: 0 };
  const all = doc.benchmarks;
  let rows = all, matched = false;
  if (locality) {
    const l = String(locality).toLowerCase();
    const hit = all.filter(b => String(b.scheme).toLowerCase().includes(l));
    if (hit.length) { rows = hit; matched = true; }
  }
  return { rows: rows.slice(0, limit), matched, total: rows.length, divisionTotal: all.length };
}

const napicUnitLabel = (b) => ({
  RM_PER_UNIT: 'per unit', RM_PER_SQM: 'per m²', RM_PER_HECTARE: 'per hectare',
}[b.basisUnit] || '') + (b.perMonth ? ' a month' : '');

/* ------------------------------------------------------------------ panel --- */
function officialBenchmarkPanel(city, area) {
  const division = localityDivision(city, area);
  const cityDef = SARAWAK_CITIES.find(c => c.id === city) || {};
  const cityName = cityDef.name || city;
  const card = el('div', { class: 'card' });
  card.append(cardHead('Official market benchmarks by locality and property type',
    'Published by NAPIC for the half-year. Three kinds of evidence, shown apart because they answer different questions '
    + 'and none of them is a transaction record.'));
  if (division !== townDivision(city)) card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `${area} is listed under ${cityName} here, but it lies in the ${division} Division, and these are that division’s figures.`));
  if (cityDef.ambiguousLocality?.[area]) card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm);color:var(--bronze)' },
    cityDef.ambiguousLocality[area]));

  /* The division's file, asked for as the panel is first drawn. */
  if (!napicDivisions.has(division)) loadNapic(division);
  const napic = napicDoc(division);
  if (!napic) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
      !division ? 'No NAPIC division is recorded for this town, so no NAPIC figures are shown.'
      : napicDivisions.get(division)?.state === 'failed'
        ? `The NAPIC figures for the ${division} Division are not loaded in this build.`
        : `Loading NAPIC’s figures for the ${division} Division…`));
    return card;
  }

  /* ---- 1. official transaction activity ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'Official transaction activity'));
  const act = napicActivity(division);
  if (!act.length) {
    card.append(el('p', { class: 'metaline' }, `No H1 2025 activity published for the ${division} Division.`));
  } else {
    const t = el('table', { class: 'dt' });
    /* D6, once a column: NAPIC's counts and values as published (Filed);
       the implied average is arithmetic on them (Derived). */
    t.append(el('thead', {}, el('tr', {}, ['Sub-sector', 'Transactions', 'Total value', 'Implied aggregate average']
      .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, i === 1 || i === 2 ? [h, kindTh('filed', `NAPIC ${napic.period.code}`)] : i === 3 ? [h, kindTh('derived', 'Total value over transactions')] : h)))));
    t.append(el('tbody', {}, act.map(r => el('tr', {}, [
      el('th', { scope: 'row', style: 'text-align:left' }, r.subsector.replace('_', ' ').toLowerCase()
        .replace(/^./, c => c.toUpperCase())),
      el('td', { class: 'num' }, fmtNum(r.count, 0)),
      el('td', { class: 'num' }, fmtMoney(r.valueRm, 'MYR', 0)),
      el('td', { class: 'num', title: r.impliedAverageLabel },
        isNum(r.impliedAverageValueRm) ? fmtMoney(r.impliedAverageValueRm, 'MYR', 0) : '—'),
    ]))));
    card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
    gridKeyboard(t, `Official transaction activity for the ${division} Division. Arrow keys move between cells.`);
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Whole of the ${division} Division, H1 2025 — not ${area} and not ${cityName}. `
      /* A mean, not a median. The line said half the transactions sit below it
         "by construction", which is true of a median; with prices skewed to
         the right, more than half usually sit below a mean. */
      + 'The implied aggregate average is total value over total count for the category — a mean, not a median. It is not the price of any property, '
      + 'and where a few large sales pull it up, most transactions in the category can sit below it.'));
  }

  /* ---- 2. observed ranges ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'Observed price and rental ranges'));
  const bmr = napicBenchmarks(division, { locality: area });
  const bm = bmr.rows;
  if (!bm.length) {
    card.append(el('p', { class: 'metaline' }, `NAPIC surveyed no schemes in the ${division} Division for this period.`));
  } else {
    card.append(el('p', { class: 'metaline', style: bmr.matched ? null : 'color:var(--bronze)' },
      (bmr.matched
        ? `${bmr.total} scheme${bmr.total === 1 ? '' : 's'} whose NAPIC name contains “${area}”`
        : `No NAPIC scheme name contains “${area}”, so these are schemes from across the ${division} Division, not from ${area}`)
      + (bm.length < bmr.total ? ` — showing the first ${bm.length} of ${bmr.total}.` : '.')));
    const t2 = el('table', { class: 'dt' });
    /* D6, once a column: the ranges and NAPIC's reported yield as published. */
    t2.append(el('thead', {}, el('tr', {}, ['Scheme or location', 'Type', 'Sample', 'Observed range', 'Basis', 'Change', 'Reported gross yield']
      .map((h, i) => el('th', { class: i ? null : 'pin', style: i ? null : 'text-align:left' }, i === 3 || i === 6 ? [h, kindTh('filed', `NAPIC ${napic.period.code}`)] : h)))));
    t2.append(el('tbody', {}, bm.map(b => el('tr', {}, [
      el('th', { class: 'pin ident', scope: 'row', style: 'text-align:left' }, b.scheme),
      /* Wrapped between words, never inside one. .caption breaks anywhere,
         which takes the column's narrowest width down to one letter; the
         table is sized to its narrowest on a phone, so at 390px this column
         was the width of its heading and read "singl / e / store / y". */
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal;overflow-wrap:normal' },
        [b.propertyType, b.floorLevel, b.roadPosition].filter(Boolean).join(' · ').toLowerCase()),
      /* D7: a row from one observation says so, in words, where the
         figure is (napicSampleWords). Wrapped between words, as the type
         column is, so it does not widen the table on a phone. */
      b.sampleSize === 1
        ? el('td', { class: 'caption napic-single', style: 'text-align:left;white-space:normal;overflow-wrap:normal;min-width:9em' },
          napicSampleWords(b, napic.period.code))
        : el('td', { class: 'num', title: b.sampleSize == null ? 'Sample size not published for this table' : null },
          napicSampleWords(b, napic.period.code)),
      el('td', { class: 'num', title: b.sampleSize === 1 ? `${b.rangeLabel}: one property, not the scheme’s price` : b.rangeLabel },
        b.min === b.max ? fmtMoney(b.min, 'MYR', 0) : `${fmtMoney(b.min, 'MYR', 0)}–${fmtMoney(b.max, 'MYR', 0)}`),
      el('td', { class: 'caption', style: 'text-align:left' }, napicUnitLabel(b)),
      el('td', { class: 'num' }, b.changeStated ? b.changeStated
        : (isNum(b.changePct) ? withSign(b.changePct, 1) : '—')),
      el('td', { class: 'num' }, isNum(b.grossYieldPct) ? fmtPct(b.grossYieldPct, 1) : '—'),
    ]))));
    card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t2));
    gridKeyboard(t2, `Observed price and rental ranges for schemes NAPIC surveyed in the ${division} Division.`);
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'A range observed across NAPIC’s sample of each scheme for the half-year. The top of a range is not the latest price '
      + 'and its midpoint is not a median — neither is a transaction. Where a sample size is published it is shown, because a '
      + 'range over one property and a range over forty are different claims. A row from one observation says so: its figure is '
      + 'one property in NAPIC’s sample, not the scheme’s price.'));
  }

  /* ---- 3. the field this cannot fill ---- */
  const gap = el('div', { style: 'margin-top:var(--lg);padding:var(--md);border:1px solid var(--bronze);border-radius:var(--r-md)' });
  gap.append(el('p', { class: 'body', style: 'font-weight:600;margin:0' }, 'Latest recorded transaction — not available from this source'));
  gap.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'These files carry no transaction date, no individual consideration, no tenure and no lot. The finest period in them is a '
    + 'half-year. A latest sale cannot be derived from an aggregate or a sample range, and this product will not manufacture one — '
    + 'the only dated transactions it holds are the ones you record yourself.'));
  const ul = el('ul', { class: 'ticklist blocklist', style: 'margin-top:var(--sm)' });
  (napic.cannotAnswer || []).forEach(x => ul.append(el('li', {}, x)));
  gap.append(ul);
  gap.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Record-level data through NAPIC e-Data / PRISM would fill it. That request is open — the data-sources page lists the seven '
    + 'permissions still to be confirmed.'));
  card.append(gap);

  /* ---- attribution and licence, on the panel rather than a footnote ---- */
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--lg)' },
    `Source period ${napic.period.code}. ${napic.licence.attribution}. `
    + 'Figures are official NAPIC aggregates or sample-based benchmarks for the stated reporting period. They are not live '
    + 'listings, complete transaction histories or professional valuations.'));
  card.append(el('p', { class: 'metaline', style: 'margin-top:4px;color:var(--bronze)' },
    `Licence ${napic.licence.status.replace(/_/g, ' ').toLowerCase()} — derived display only. `
    + 'Raw files are not published, NAPIC rows are not exported in bulk, and the extraction reconciles to the published Sarawak '
    + `total of ${fmtNum(napic.reconciliation.target.count, 0)} transactions exactly.`));
  return card;
}
