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

let napic = null;
let napicStatus = { tried: false, ok: false };

async function loadNapic() {
  napicStatus.tried = true;
  try {
    const j = await fetchJson(dataUrl('napic-h1-2025.json'));
    if (j && Array.isArray(j.summary)) { napic = j; napicStatus.ok = true; }
  } catch { /* absent is a normal state and the panels say so */ }
}

/* Which NAPIC division a town sits in. The product files by town; NAPIC files
   by division, and a division holds several towns — so a division figure is
   labelled as the division's, never as the town's. */
const townDivision = (cityId) => (SARAWAK_CITIES.find(c => c.id === cityId) || {}).division || null;

const napicActivity = (division, period = 'H1 2025') =>
  !napic ? [] : napic.summary.filter(r => r.division === division && r.periodCode === period);

/* Benchmarks are per scheme. A locality match is a substring test on the
   scheme name, and it is deliberately shown as "schemes NAPIC surveyed in this
   division" rather than "prices in your locality" — the survey does not claim
   to cover a locality and neither should this. */
function napicBenchmarks(division, { locality = null, limit = 40 } = {}) {
  if (!napic) return [];
  let rows = napic.benchmarks.filter(b => b.division === division);
  if (locality) {
    const l = String(locality).toLowerCase();
    const hit = rows.filter(b => String(b.scheme).toLowerCase().includes(l));
    if (hit.length) rows = hit;
  }
  return rows.slice(0, limit);
}

const napicUnitLabel = (b) => ({
  RM_PER_UNIT: 'per unit', RM_PER_SQM: 'per m²', RM_PER_HECTARE: 'per hectare',
}[b.basisUnit] || '') + (b.perMonth ? ' a month' : '');

/* ------------------------------------------------------------------ panel --- */
function officialBenchmarkPanel(city, area) {
  const division = townDivision(city);
  const cityName = (SARAWAK_CITIES.find(c => c.id === city) || {}).name || city;
  const card = el('div', { class: 'card' });
  card.append(cardHead('Official market benchmarks by locality and property type',
    'Published by NAPIC for the half-year. Three kinds of evidence, shown apart because they answer different questions '
    + 'and none of them is a transaction record.'));

  if (!napicStatus.ok) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
      napicStatus.tried
        ? 'The NAPIC dataset is not loaded in this build.'
        : 'The NAPIC dataset has not been requested yet.'));
    return card;
  }

  /* ---- 1. official transaction activity ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'Official transaction activity'));
  const act = napicActivity(division);
  if (!act.length) {
    card.append(el('p', { class: 'metaline' }, `No H1 2025 activity published for the ${division} Division.`));
  } else {
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Sub-sector', 'Transactions', 'Total value', 'Implied aggregate average']
      .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
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
      + 'The implied aggregate average is total value over total count for the category; it is not the price of any property, '
      + 'and half the transactions in a category sit below it by construction.'));
  }

  /* ---- 2. observed ranges ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'Observed price and rental ranges'));
  const bm = napicBenchmarks(division, { locality: area });
  if (!bm.length) {
    card.append(el('p', { class: 'metaline' }, `NAPIC surveyed no schemes in the ${division} Division for this period.`));
  } else {
    const t2 = el('table', { class: 'dt' });
    t2.append(el('thead', {}, el('tr', {}, ['Scheme or location', 'Type', 'Sample', 'Observed range', 'Basis', 'Change', 'Reported gross yield']
      .map((h, i) => el('th', { class: i ? null : 'pin', style: i ? null : 'text-align:left' }, h)))));
    t2.append(el('tbody', {}, bm.map(b => el('tr', {}, [
      el('th', { class: 'pin ident', scope: 'row', style: 'text-align:left' }, b.scheme),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
        [b.propertyType, b.floorLevel, b.roadPosition].filter(Boolean).join(' · ').toLowerCase()),
      el('td', { class: 'num', title: b.sampleSize == null ? 'Sample size not published for this table' : null },
        b.sampleSize == null ? '—' : String(b.sampleSize)),
      el('td', { class: 'num', title: b.rangeLabel },
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
      + 'range over one property and a range over forty are different claims.'));
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
