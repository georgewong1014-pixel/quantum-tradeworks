/* ==========================================================================
   DATA LICENCE — WHAT MAY BE DONE WITH A FIGURE, WHICH IS NOT HOW GOOD IT IS
   --------------------------------------------------------------------------
   This product has graded every figure by EVIDENCE since it was built: is this
   a transacted price somebody saw, a published record, a recollection, or a
   default the tool carried. That ladder answers "how much should I believe it".

   It never answered the other question, and the two are orthogonal. A NAPIC
   transaction record is tier-one evidence AND may not be republished to
   subscribers without a licence. A figure the reader typed themselves is weak
   evidence AND is entirely theirs to do as they like with. Grading only one
   axis meant the second was carried in prose, in a source-review document, and
   in the memory of whoever last read it.

   A CORRECTION THIS FILE EXISTS TO MAKE.

   The area-observations header said "there is no neighbourhood-level rental or
   transaction dataset for Sarawak — NAPIC would not respond". That was wrong,
   and wrong in the direction that costs the most: it wrote off a real source.

   NAPIC publishes Open Sales Data, quarterly Sarawak transaction tables, and
   record-level data through PRISM e-Data, which was opened to public access on
   1 February 2026. The correct position is narrower and it is about rights, not
   existence:

     QT CAN source and analyse official Sarawak transaction evidence through
     NAPIC. RECORD-LEVEL REPUBLICATION stays restricted until NAPIC or another
     licensed provider grants commercial redistribution rights.

   So a record now carries a licence state, the state decides what the product
   will do with it, and "we hold this but may not show it to you" is a thing the
   software can express instead of a thing someone has to remember.
   ========================================================================== */

const DATA_LICENCES = [
  { id: 'own', label: 'Your own record', rank: 3,
    show: true, export: true, publish: false,
    note: 'Recorded by you, held in your browser. Yours to keep, edit and export. It carries no redistribution right, because a figure you observed is not a dataset you may licence on.' },

  { id: 'public-domain', label: 'Public domain', rank: 3,
    show: true, export: true, publish: true,
    note: 'No rights reserved by the publisher. SEC EDGAR company facts sit here.' },

  { id: 'open-attrib', label: 'Open, with attribution', rank: 3,
    show: true, export: true, publish: true,
    note: 'Redistributable under an open licence provided the attribution travels with it. OpenStreetMap geocoding sits here, under ODbL.' },

  { id: 'licence-pending', label: 'Held — licence pending', rank: 2,
    show: true, export: true, publish: false,
    note: 'Sourced from an official publisher whose reuse terms have not yet been confirmed in writing. Usable as internal evidence and for your own analysis; not republished, and excluded from anything this product would show to another subscriber.' },

  { id: 'derived-only', label: 'Derived statistics only', rank: 2,
    show: true, export: false, publish: true,
    note: 'The underlying records may not be republished, but statistics derived from them may — subject to the publisher confirming it. A median is published; the transactions behind it are not.' },

  { id: 'licensed', label: 'Licensed for redistribution', rank: 3,
    show: true, export: true, publish: true,
    note: 'A commercial agreement is in place and its terms are recorded. Nothing in this product holds this state yet.' },

  { id: 'restricted', label: 'Restricted — do not republish', rank: 1,
    show: true, export: false, publish: false,
    note: 'Terms expressly forbid extracting or redistributing. Portal listings sit here, and so does anything obtained by scraping — which this product does not do.' },
];
const LICENCE_BY_ID = Object.fromEntries(DATA_LICENCES.map(l => [l.id, l]));

/* A record with no licence recorded is the reader's own, because until NAPIC
   import exists that is the only way anything gets in. Stated rather than
   assumed silently, so the default can be found and changed. */
const licenceOf = (rec) => LICENCE_BY_ID[rec?.licence] || LICENCE_BY_ID.own;
const mayPublish = (rec) => licenceOf(rec).publish;
const mayExport = (rec) => licenceOf(rec).export;

/* ---- THE SOURCES, AND WHERE EACH ONE ACTUALLY STANDS ---------------------
   Published on the data-sources page. The `position` column is the point: a
   source being publicly accessible is not the same as being redistributable,
   and this product has one page where that difference is written down. */
const SARAWAK_TRANSACTION_SOURCES = [
  { name: 'NAPIC Open Sales Data', url: 'https://napic.jpph.gov.my/en/open-sales-data',
    gives: 'Official residential, commercial and industrial transaction records.',
    use: 'Primary transaction lookup, by state, district, mukim, category and date.',
    licence: 'licence-pending',
    position: 'Publicly accessible. Written permission is needed before bulk commercial republication.' },

  { name: 'NAPIC Data Visualisation', url: 'https://napic.jpph.gov.my/en/data-visualization',
    gives: 'Transactions by state, district, property type and price range, with medians and averages.',
    use: 'Town and district market context.',
    licence: 'derived-only',
    position: 'Cite or link, or publish derived analysis. Reuse terms to be confirmed before either.' },

  { name: 'NAPIC quarterly publications', url: 'https://napic.jpph.gov.my/en/latest-publication',
    gives: 'Downloadable quarterly tables, including the Sarawak property transaction table.',
    use: 'Historical backfill and volume, value and price-range trends by district.',
    licence: 'derived-only',
    position: 'A sound research source. Confirm permission before republishing extracted tables.' },

  { name: 'NAPIC e-Data / PRISM 2.0', url: 'https://napic.jpph.gov.my/en/services/e-data',
    gives: 'Purchasable bulk, single-property, map and customised transaction data. Public access opened 1 February 2026; a month becomes purchasable after the 15th of the following month.',
    use: 'The correct route to a record-level database, if the rights are granted.',
    licence: 'licence-pending',
    position: 'Request a commercial data and republication licence. prismsupport@jpph.gov.my.' },

  { name: 'Sarawak Land and Survey — title search', url: 'https://elasis.sarawak.gov.my/page-0-9-19-Land-Strata-Title.html',
    gives: 'Parcel and title-level verification.',
    use: 'Verifying title, ownership and land particulars for one property.',
    licence: 'restricted',
    position: 'Individual due diligence. The site states its material may not be copied, distributed or commercially dealt with without written consent, and it is not a statewide pricing feed.' },

  { name: 'Brickz', url: 'https://www.brickz.my/transactions/residential/sarawak/',
    gives: 'Searchable project and township transactions, sourced from JPPH.',
    use: 'Quick verification of a single comparable.',
    licence: 'restricted',
    position: 'Useful to check a figure against. Negotiate a data licence rather than copying the site; do not scrape.' },

  { name: 'EdgeProp past transactions', url: 'https://www.edgeprop.my/past-transaction',
    gives: 'Searchable residential, commercial, industrial and land transactions.',
    use: 'Secondary cross-check.',
    licence: 'restricted',
    position: 'Terms permit analytics for internal use and prohibit constructing or redistributing a database.' },
];

/* The questions that have to be answered before record-level NAPIC data can be
   shown to a subscriber. Published, so the licence position is checkable rather
   than asserted — and so it is obvious which of them is still open. */
const NAPIC_LICENCE_QUESTIONS = [
  'Store the records in a database',
  'Normalise and geocode them',
  'Display individual transaction prices',
  'Display derived median, P25 and P75 statistics',
  'Provide the information to paying subscribers',
  'Allow exports or API access',
  'Retain historical records after a subscription ends',
];

/* ---- NAPIC GEOGRAPHY IS NOT THIS PRODUCT'S GEOGRAPHY ---------------------
   NAPIC files a transaction under district, mukim, town and scheme. This
   product files one under town and locality. The two do not line up, and
   pretending they do is how a Kota Samarahan transaction ends up counted in
   Kuching — the district contains both, and the market does not.

   So the mapping is explicit and incomplete on purpose: a NAPIC district with
   no entry here imports as unmapped and is held for a human to place, rather
   than being guessed into the nearest town. */
const NAPIC_DISTRICT_MAP = {
  /* NAPIC district -> this product's town id */
  'KUCHING': 'kuching',
  'BAU': 'bau',
  'LUNDU': 'lundu',
  'SAMARAHAN': 'kota-samarahan',
  'KOTA SAMARAHAN': 'kota-samarahan',
  'ASAJAYA': 'kota-samarahan',
  'SIMUNJAN': 'kota-samarahan',
  'SERIAN': 'serian',
  'TEBEDU': 'serian',
  'SRI AMAN': 'sri-aman',
  'LUBOK ANTU': 'sri-aman',
  'BETONG': 'betong',
  'SARATOK': 'betong',
  'KABONG': 'betong',
  'PUSA': 'betong',
  'SARIKEI': 'sarikei',
  'MERADONG': 'sarikei',
  'JULAU': 'sarikei',
  'PAKAN': 'sarikei',
  'SIBU': 'sibu',
  'KANOWIT': 'kanowit',
  'SELANGAU': 'sibu',
  'MUKAH': 'mukah',
  'DALAT': 'mukah',
  'DARO': 'mukah',
  'MATU': 'mukah',
  'TANJUNG MANIS': 'mukah',
  'BINTULU': 'bintulu',
  'TATAU': 'tatau',
  'SEBAUH': 'tatau',
  'MIRI': 'miri',
  'MARUDI': 'marudi',
  'BELURU': 'marudi',
  'SUBIS': 'marudi',
  'LIMBANG': 'limbang',
  'LAWAS': 'lawas',
  'KAPIT': 'kapit',
  'SONG': 'kapit',
  'BELAGA': 'kapit',
  'BUKIT MABONG': 'kapit',
};

/* Returns the town id, or null. Null is a real answer: an unmapped district is
   held rather than placed. */
const napicTown = (district) => NAPIC_DISTRICT_MAP[String(district || '').trim().toUpperCase()] || null;

/* ---- THE NAPIC RECORD SHAPE ---------------------------------------------
   The fields a NAPIC transaction actually carries, so records import without
   being reshaped and a locality summary can break down the way the data does.
   Category and tenure are theirs; the area bands are this product's, because
   NAPIC gives an exact area and a band is what makes two transactions
   comparable. */
const PROPERTY_CATEGORIES = [
  { id: 'residential', label: 'Residential',
    subtypes: ['Terraced', 'Semi-detached', 'Detached', 'Cluster', 'Town house',
               'Low-cost house', 'Condominium/Apartment', 'Low-cost flat', 'Service apartment'] },
  { id: 'commercial', label: 'Commercial',
    subtypes: ['Shop', 'Shop-office', 'Office', 'Retail lot', 'Hotel', 'Service centre'] },
  { id: 'industrial', label: 'Industrial',
    subtypes: ['Terraced factory', 'Semi-detached factory', 'Detached factory', 'Flatted factory', 'Warehouse'] },
  { id: 'agricultural', label: 'Agricultural',
    subtypes: ['Oil palm', 'Rubber', 'Paddy', 'Mixed cultivation', 'Vacant agricultural'] },
  { id: 'development', label: 'Development land',
    subtypes: ['Residential land', 'Commercial land', 'Industrial land', 'Mixed development land'] },
];
const CATEGORY_BY_ID = Object.fromEntries(PROPERTY_CATEGORIES.map(c => [c.id, c]));

const TENURES = [
  { id: 'freehold', label: 'Freehold' },
  { id: 'leasehold', label: 'Leasehold' },
  { id: 'native', label: 'Native title' },
  { id: 'unknown', label: 'Not stated' },
];

/* Bands, not exact areas, for grouping. An exact figure stays on the record;
   this is only how two of them are judged comparable. */
const AREA_BANDS = [
  { id: 'lt700', label: 'under 700 sq ft', lo: 0, hi: 700 },
  { id: '700-1000', label: '700–1,000 sq ft', lo: 700, hi: 1000 },
  { id: '1000-1400', label: '1,000–1,400 sq ft', lo: 1000, hi: 1400 },
  { id: '1400-2000', label: '1,400–2,000 sq ft', lo: 1400, hi: 2000 },
  { id: '2000-3000', label: '2,000–3,000 sq ft', lo: 2000, hi: 3000 },
  { id: 'gte3000', label: '3,000 sq ft and above', lo: 3000, hi: Infinity },
];
const areaBand = (sqft) => (isNum(sqft) && sqft > 0
  ? AREA_BANDS.find(b => sqft >= b.lo && sqft < b.hi) || AREA_BANDS[AREA_BANDS.length - 1]
  : null);

/* ---- QUANTILES ----------------------------------------------------------
   P25 and P75 by linear interpolation between order statistics, which is the
   ordinary definition and the one a reader checking against a spreadsheet will
   reproduce. Fewer than four values returns nulls: a quartile of three numbers
   is arithmetic performed on an opinion. */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function spread(values) {
  const s = (values || []).filter(isNum).slice().sort((a, b) => a - b);
  if (!s.length) return { n: 0, median: null, p25: null, p75: null, lo: null, hi: null };
  return {
    n: s.length,
    median: quantile(s, 0.5),
    /* Withheld below four readings rather than computed on two. */
    p25: s.length >= 4 ? quantile(s, 0.25) : null,
    p75: s.length >= 4 ? quantile(s, 0.75) : null,
    lo: s[0], hi: s[s.length - 1],
  };
}
