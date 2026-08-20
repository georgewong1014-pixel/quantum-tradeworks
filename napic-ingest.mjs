#!/usr/bin/env node
/**
 * NAPIC / JPPH H1 2025 ingest — transaction aggregates, market benchmarks,
 * prominent sales and market summaries, kept apart because they are four
 * different kinds of evidence.
 *
 *   node napic-ingest.mjs            extract, reconcile, write data/napic-h1-2025.json
 *   node napic-ingest.mjs --check    extract and reconcile, write nothing
 *   node napic-ingest.mjs --verbose  print every table as it is read
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * None of these sources supports a latest-transaction field. They carry counts
 * and values by half-year and price band, sample-based price and rent ranges,
 * and a curated list of prominent sales. There is no transaction date, no
 * individual consideration, no lot, no tenure and no floor area against a
 * specific sale anywhere in them.
 *
 * So every record this produces is stamped with a granularity — AGGREGATE,
 * SAMPLE_BENCHMARK, CURATED_PROMINENT or REGIONAL_SUMMARY — and the app refuses
 * to let anything but a reader's own observation reach a "latest transaction"
 * field. The four temptations, named so they can be checked for:
 *
 *   a price-range MAXIMUM is not the latest price
 *   a range MIDPOINT is not a median
 *   value divided by count is not an individual sale
 *   a PROMINENT sale is not a representative comparable
 *   a HALF-YEAR is not a transaction date
 *
 * PROVENANCE POINTS AT THE ORIGINAL. Checksums are taken over the untouched
 * files in property-data/raw. Nothing here modifies a source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, 'property-data/raw/napic/2025/H1');
const OUT = join(ROOT, 'data/napic-h1-2025.json');
const VERBOSE = process.argv.includes('--verbose');
const CHECK_ONLY = process.argv.includes('--check');

const PERIOD = { code: 'H1 2025', start: '2025-01-01', end: '2025-06-30' };

/* ---------------------------------------------------------------- registry ---
   Step 1 of the spec: every source is registered and checksummed BEFORE it is
   opened, so a record can always be traced to the exact bytes that produced it. */
function registerSources() {
  if (!existsSync(RAW)) throw new Error(`no raw directory at ${RAW}`);
  return readdirSync(RAW).sort().map(name => {
    const bytes = readFileSync(join(RAW, name));
    return {
      sourceFile: name,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      publisher: 'NAPIC / JPPH',
      reportPeriod: PERIOD.code,
      periodStart: PERIOD.start,
      periodEnd: PERIOD.end,
      /* Never anything else until JPPH answers in writing. */
      licenceStatus: 'REVIEW_REQUIRED',
    };
  });
}

/* ------------------------------------------------------------- geography ---
   The workbook spells Sarikei "Sarikie". Normalising in a dictionary rather
   than by fuzzy match means the misspelling is recorded as the source's, and a
   division this product has never heard of fails loudly instead of being
   guessed into a neighbour. */
const DIVISION_MAP = {
  'BAHAGIAN KUCHING': 'Kuching',
  'BAHAGIAN SRI AMAN': 'Sri Aman',
  'BAHAGIAN SIBU': 'Sibu',
  'BAHAGIAN MIRI': 'Miri',
  'BAHAGIAN LIMBANG': 'Limbang',
  'BAHAGIAN SAMARAHAN': 'Samarahan',
  'BAHAGIAN BINTULU': 'Bintulu',
  'BAHAGIAN KAPIT': 'Kapit',
  'BAHAGIAN MUKAH': 'Mukah',
  'BAHAGIAN SARIKIE': 'Sarikei',      /* as printed in the source */
  'BAHAGIAN SARIKEI': 'Sarikei',
  'BAHAGIAN BETONG': 'Betong',
  'BAHAGIAN SERIAN': 'Serian',
};
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const divisionOf = (raw) => DIVISION_MAP[norm(raw).toUpperCase()] || null;

/* ----------------------------------------------------------------- values ---
   N.A. and N.D. are answers, not zeroes: "not available" and "not disclosed"
   both mean nobody knows, and turning either into 0 would drag every average
   that touched it downward. */
const NULL_TOKENS = new Set(['', '-', '–', 'NA', 'N.A', 'N.A.', 'ND', 'N.D', 'N.D.', 'NIL', 'TIADA']);
function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = norm(v).replace(/,/g, '');
  if (NULL_TOKENS.has(s.toUpperCase())) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* "100,001 - 200,000" -> [100001, 200000]. An open top band keeps a null max
   rather than an invented ceiling. */
function priceBand(raw) {
  const s = norm(raw);
  if (!s) return null;
  const up = s.toUpperCase();
  const nums = (s.match(/[\d,]+/g) || []).map(x => Number(x.replace(/,/g, ''))).filter(Number.isFinite);
  if (/ABOVE|MELEBIHI|>|\bAND ABOVE\b/.test(up) && nums.length) return { raw: s, min: nums[0], max: null };
  if (nums.length >= 2) return { raw: s, min: nums[0], max: nums[1] };
  if (nums.length === 1) return { raw: s, min: 0, max: nums[0] };
  return { raw: s, min: null, max: null };
}

const YEAR_CYCLE = ['H1 2024', 'H2 2024', 'H1 2025'];

/* -------------------------------------------------- transaction aggregates ---
   Tables 16.5 to 16.14, in count/value pairs. A sheet's first three data rows
   carry the year labels and the rest inherit the same three-row cycle, so the
   cycle is applied by position and cross-checked against any label that IS
   printed — a silent drift here would attribute H1 2024 volumes to H1 2025. */
function readBreakdownSheet(wb, sheetName, subsector, measure) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });

  /* THE HEADER ROW IS NOT ALWAYS ROW 3, AND THE UNIT IS NOT ALWAYS RINGGIT.
     Count tables put their header on row 3. Value tables carry a "(RM MILLION)"
     units line first and push the header to row 4. Two traps in one place:
     hardcoding row 3 reads a blank line and finds no divisions, and missing the
     units line understates every value table by a factor of a million while
     every number still looks entirely plausible. So both are detected. */
  let headerRow = -1;
  for (let r = 0; r < Math.min(12, rows.length); r++) {
    const cells = (rows[r] || []).map(norm);
    if (cells.some(c => divisionOf(c)) && cells.some(c => /^(PRO_TYPE|PRICE RANGE)$/i.test(c))) { headerRow = r; break; }
  }
  if (headerRow < 0) throw new Error(`${sheetName}: no header row carrying both a label column and a division`);

  const preamble = rows.slice(0, headerRow).flat().map(norm).join(' ').toUpperCase();
  const unitScale = /RM\s*MILLION/.test(preamble) ? 1e6 : 1;
  if (measure === 'VALUE_RM' && unitScale === 1)
    throw new Error(`${sheetName}: a value table with no "(RM MILLION)" units line — refusing to guess the scale`);
  if (measure === 'COUNT' && unitScale !== 1)
    throw new Error(`${sheetName}: a count table carrying a currency unit line`);

  const header = (rows[headerRow] || []).map(norm);

  const hasType = /PRO_TYPE/i.test(header[0] || '');
  const iType = hasType ? 0 : -1;
  const iBand = hasType ? 1 : 0;
  const iYear = hasType ? 2 : 1;

  /* Which columns are divisions, and which is the printed total. */
  const cols = [];
  let iTotal = -1;
  header.forEach((h, i) => {
    const d = divisionOf(h);
    if (d) cols.push({ i, division: d });
    else if (/^TOTAL$/i.test(h)) iTotal = i;
  });
  if (!cols.length) throw new Error(`${sheetName}: no division columns found`);

  const out = [];
  let curType = hasType ? null : subsector, curBand = null, cycle = 0;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    /* Only a PRINTED type restarts the cycle. Defaulting a type-less table's
       type to its subsector made this truthy on every row, so 16.13 and 16.14
       reset the year cycle each line and read every figure as H1 2024. The
       printed-year cross-check caught it; without that it would have silently
       relabelled two whole tables. */
    const rawType = hasType ? norm(row[iType]) : '';
    const rawBand = norm(row[iBand]);
    const rawYear = norm(row[iYear]);

    /* Forward-fill the merged cells. A new property type or a new band restarts
       the three-row year cycle. */
    if (rawType) { curType = rawType; cycle = 0; }
    if (rawBand) { curBand = rawBand; cycle = 0; }

    const anyValue = cols.some(c => num(row[c.i]) != null) || num(row[iTotal]) != null;
    if (!anyValue) { if (!rawBand && !rawType) continue; }

    const year = rawYear || YEAR_CYCLE[cycle % 3];
    /* If the sheet printed a year, it must agree with where the cycle thinks it
       is. Disagreement means the row pattern changed and the fill is wrong. */
    if (rawYear && rawYear !== YEAR_CYCLE[cycle % 3]) {
      throw new Error(`${sheetName} row ${r + 1}: printed year "${rawYear}" but the row cycle expected "${YEAR_CYCLE[cycle % 3]}" — the merged-cell fill has drifted`);
    }
    cycle++;

    /* EVERY SHEET CARRIES ITS OWN SUBTOTALS, IN BOTH DIRECTIONS.
       There is a "Total" price band inside each property type AND a whole
       "Total" property-type block repeating every band. Summing either
       alongside the detail double-counts the state exactly, which is what
       produced 9,978 residential transactions against a published 4,989 — a
       figure wrong by a factor of two and entirely plausible on its face.
       Both are skipped here and the printed totals are kept separately, for
       the reconciliation to check the detail against. */
    if (!curBand || /^TOTAL$/i.test(curBand)) continue;
    if (curType && /^TOTAL$/i.test(curType)) continue;
    const band = priceBand(curBand);

    cols.forEach(c => {
      const raw = num(row[c.i]);
      if (raw == null) return;
      const v = raw * unitScale;
      out.push({
        sourceSheet: sheetName, sourceRow: r + 1,
        periodCode: year,
        state: 'Sarawak', geoLevel: 'DIVISION',
        geographyRaw: norm(header[c.i]), geography: c.division,
        subsector,
        propertyTypeRaw: curType, propertyType: curType,
        priceBandRaw: band.raw, priceBandMin: band.min, priceBandMax: band.max,
        measure,                       /* COUNT or VALUE_RM */
        value: v,
      });
    });
    /* The printed total is kept for the reconciliation in §11, not published. */
    const t0 = num(row[iTotal]);
    const t = t0 == null ? null : t0 * unitScale;
    if (t != null) out.push({
      sourceSheet: sheetName, sourceRow: r + 1, periodCode: year,
      state: 'Sarawak', geoLevel: 'STATE', geographyRaw: 'Total', geography: 'Sarawak',
      subsector, propertyTypeRaw: curType, propertyType: curType,
      priceBandRaw: band.raw, priceBandMin: band.min, priceBandMax: band.max,
      measure, value: t, printedTotal: true,
    });
  }
  if (VERBOSE) console.log(`    ${sheetName} ${subsector}/${measure}: ${out.length} cells`);
  return out;
}

const BREAKDOWN_TABLES = [
  ['16.5', 'RESIDENTIAL', 'COUNT'], ['16.6', 'RESIDENTIAL', 'VALUE_RM'],
  ['16.7', 'COMMERCIAL', 'COUNT'], ['16.8', 'COMMERCIAL', 'VALUE_RM'],
  ['16.9', 'INDUSTRIAL', 'COUNT'], ['16.10', 'INDUSTRIAL', 'VALUE_RM'],
  ['16.11', 'AGRICULTURE', 'COUNT'], ['16.12', 'AGRICULTURE', 'VALUE_RM'],
  ['16.13', 'DEVELOPMENT_LAND', 'COUNT'], ['16.14', 'DEVELOPMENT_LAND', 'VALUE_RM'],
];

/* ---------------------------------------------------- market benchmarks ---
   The price and rent workbook is not a table with columns for everything; it is
   an indented outline flattened into a sheet. A row is one of four things and
   only its shape says which:

     ALL CAPS, no numbers          a property-type heading
     "Bahagian X", no numbers      a division heading
     a name plus numbers           a benchmark record
     blank                         a separator

   So it is read as a state machine, and a record inherits whichever type and
   division headings it last sat under. Getting that wrong does not throw — it
   files a Kuching terrace under Miri — so the classifier is deliberately strict
   and anything it cannot place is rejected rather than guessed.

   WHAT THESE ROWS ARE. A sample-based RANGE over `sampleSize` properties in one
   scheme for one half-year. The maximum is not the latest price, the midpoint
   is not a median, and neither is a transaction. */
const BENCH_SHEETS = {
  '16.1': { title: 'Prices of Residential Property', kind: 'PRICE', subsector: 'RESIDENTIAL' },
  '16.2': { title: 'Prices of Residential Building Land', kind: 'PRICE', subsector: 'RESIDENTIAL' },
  '16.3': { title: 'Rentals of Residential Property', kind: 'RENT', subsector: 'RESIDENTIAL' },
  '16.4': { title: 'Prices of Shop', kind: 'PRICE', subsector: 'COMMERCIAL' },
  '16.5': { title: 'Rentals of Ground Floor Shop', kind: 'RENT', subsector: 'COMMERCIAL' },
  '16.6': { title: 'Prices of Serviced Apartment and SOHO', kind: 'PRICE', subsector: 'COMMERCIAL' },
  '16.7': { title: 'Rentals of Serviced Apartment and SOHO', kind: 'RENT', subsector: 'COMMERCIAL' },
  '16.8': { title: 'Prices of Retail Space', kind: 'PRICE', subsector: 'COMMERCIAL' },
  '16.9': { title: 'Rentals of Retail Space', kind: 'RENT', subsector: 'COMMERCIAL' },
  '16.10': { title: 'Rentals of Purpose-Built Office', kind: 'RENT', subsector: 'COMMERCIAL' },
  '16.11': { title: 'Rentals of Office in Shop', kind: 'RENT', subsector: 'COMMERCIAL' },
  '16.12': { title: 'Prices of Industrial Property', kind: 'PRICE', subsector: 'INDUSTRIAL' },
  '16.13': { title: 'Agricultural Land', kind: 'PRICE', subsector: 'AGRICULTURE' },
  '16.14': { title: 'Development Land', kind: 'PRICE', subsector: 'DEVELOPMENT_LAND' },
};

/* "190,000 - 260,000" -> {min,max}; "318000" -> {min:v,max:v}; "Stable" -> null. */
function rangeOf(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? { min: raw, max: raw } : null;
  const s = norm(raw);
  if (!s || NULL_TOKENS.has(s.toUpperCase()) || /^STABLE$/i.test(s)) return null;
  const nums = (s.match(/[\d][\d,\.]*/g) || []).map(x => Number(x.replace(/,/g, ''))).filter(Number.isFinite);
  if (!nums.length) return null;
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  return { min: Math.min(...nums), max: Math.max(...nums) };
}
/* "Stable" is a real answer and means no change — distinct from N.A., which
   means nobody measured it. */
function changeOf(raw) {
  if (raw == null) return { pct: null, stated: null };
  const s = norm(raw);
  if (/^STABLE$/i.test(s)) return { pct: 0, stated: 'Stable' };
  const n = num(raw);
  return { pct: n, stated: n == null ? (s || null) : null };
}

function readBenchmarkSheet(wb, sheetName) {
  const meta = BENCH_SHEETS[sheetName];
  const ws = wb.Sheets[sheetName];
  if (!ws || !meta) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: true });

  let hdr = -1;
  for (let r = 0; r < Math.min(14, rows.length); r++) {
    /* Four different first-column headings across the fourteen tables:
       "District/Mukim and Scheme", "District/Mukim and Location", "Location
       and Building", "District and Location". Matching the first literally
       read exactly one sheet and threw on the next. */
    const c0 = norm((rows[r] || [])[0]).toUpperCase();
    if (/^(DISTRICT|LOCATION)/.test(c0) && /(SCHEME|LOCATION|BUILDING)/.test(c0)) { hdr = r; break; }
  }
  if (hdr < 0) throw new Error(`${sheetName}: no location column header`);

  /* Column roles by header text, over the header row and the sub-header
     beneath it, because the period labels live one row down. */
  const h0 = (rows[hdr] || []).map(norm);
  const h1 = (rows[hdr + 1] || []).map(norm);
  const role = (i) => {
    const a = (h0[i] || '').toUpperCase(), b = (h1[i] || '').toUpperCase();
    if (/SAMPLE SIZE/.test(a)) return 'sample';
    if (/AVERAGE LAND AREA/.test(a)) return 'land';
    if (/AVERAGE FLOOR AREA|FLOOR AREA/.test(a)) return 'floor';
    if (/FLOOR LEVEL/.test(a)) return 'floorLevel';
    if (/FRONTAGE|INTERIOR/.test(a)) return 'roadPosition';
    if (/CHANGE/.test(a)) return 'change';
    if (/YIELD/.test(a)) return 'yield';
    /* Two period columns share one merged "Price Range"/"Rental Range" header;
       the sub-header distinguishes them. Jan-Jun 2025 is the current period. */
    if (/JAN\s*-\s*JUN\s*2025/.test(b)) return 'current';
    if (/JUL\s*-\s*DEC\s*2024/.test(b)) return 'previous';
    return null;
  };
  const roles = {};
  const width = Math.max(h0.length, h1.length);
  for (let i = 1; i < width; i++) { const r = role(i); if (r && roles[r] === undefined) roles[r] = i; }
  if (roles.current === undefined) throw new Error(`${sheetName}: no Jan-Jun 2025 column`);

  /* THE BASIS IS NOT ALWAYS PER UNIT.
     Prices come per unit, per square metre or per hectare depending on the
     table, and rents either per unit or per square metre per month. Reading
     RM/s.m. as RM/unit understates a retail price by the whole floor area,
     and the figure still looks like money. Taken from the range header and
     carried on every row; a header it cannot read throws rather than
     defaulting to per unit. */
  const rangeHeader = (h0.slice(1).find(x => /(PRICE|RENTAL|LAND PRICE)/i.test(x) && /RM/i.test(x)) || "").toUpperCase();
  const compact = rangeHeader.replace(/[^A-Z0-9/]/g, "");
  let basisUnit = null;
  if (compact.includes("RM/HECTARE")) basisUnit = "RM_PER_HECTARE";
  else if (compact.includes("RM/SM")) basisUnit = "RM_PER_SQM";
  else if (compact.includes("RM/UNIT")) basisUnit = "RM_PER_UNIT";
  if (!basisUnit) throw new Error(`${sheetName}: cannot read a price or rent basis from "${rangeHeader}" — refusing to assume per unit`);
  const perMonth = /PER MONTH/.test(rangeHeader);

  const out = [];
  let curType = null, curDivision = null, rejected = 0;
  for (let r = hdr + 2; r < rows.length; r++) {
    const row = rows[r] || [];
    const label = norm(row[0]);
    if (!label) continue;
    const hasNumbers = row.slice(1).some(c => c != null && norm(c) !== '');

    /* A division heading. Checked before the caps rule because some divisions
       are printed in caps too. */
    const div = divisionOf(label);
    if (div && !hasNumbers) { curDivision = div; continue; }
    /* A property-type heading: all caps, no data. */
    if (!hasNumbers && label === label.toUpperCase()) { curType = label; continue; }
    if (!hasNumbers) continue;

    if (!curDivision) { rejected++; continue; }   /* a record with nowhere to file it */

    const cur = rangeOf(row[roles.current]);
    const prev = roles.previous === undefined ? null : rangeOf(row[roles.previous]);
    const ch = changeOf(roles.change === undefined ? null : row[roles.change]);
    if (!cur) { rejected++; continue; }

    out.push({
      sourceSheet: sheetName, sourceRow: r + 1,
      periodCode: PERIOD.code,
      state: 'Sarawak', geography: curDivision, geographyRaw: `Bahagian ${curDivision}`,
      schemeRaw: label, scheme: label,
      subsector: meta.subsector, propertyTypeRaw: curType, tableTitle: meta.title,
      sampleSize: roles.sample === undefined ? null : num(row[roles.sample]),
      averageLandAreaSqm: roles.land === undefined ? null : num(row[roles.land]),
      averageFloorAreaSqm: roles.floor === undefined ? null : num(row[roles.floor]),
      basis: meta.kind,
      basisUnit,
      perMonth,
      floorLevelRaw: roles.floorLevel === undefined ? null : norm(row[roles.floorLevel]) || null,
      roadPositionRaw: roles.roadPosition === undefined ? null : norm(row[roles.roadPosition]) || null,
      currentMin: cur.min, currentMax: cur.max,
      previousMin: prev ? prev.min : null, previousMax: prev ? prev.max : null,
      changePct: ch.pct, changeStated: ch.stated,
      grossYieldPct: roles.yield === undefined ? null : num(row[roles.yield]),
      sourceAuthority: 'OFFICIAL_NAPIC',
      granularity: 'SAMPLE_BENCHMARK',
      evidenceRole: meta.kind === 'RENT' ? 'RENT_BENCHMARK' : 'PRICE_BENCHMARK',
      /* Carried on every row so no display can lose it. */
      rangeLabel: (meta.kind === 'RENT' ? 'Observed rental range' : 'Observed price range')
        + ' across the sample, '
        + ({ RM_PER_UNIT: 'per unit', RM_PER_SQM: 'per square metre', RM_PER_HECTARE: 'per hectare' }[basisUnit])
        + (perMonth ? ' per month' : ''),
    });
  }
  if (VERBOSE) console.log(`    ${sheetName} ${meta.title}: ${out.length} benchmarks, ${rejected} rejected`);
  return { rows: out, rejected };
}

/* --------------------------------------------------------------- run it ---- */
const sources = registerSources();
console.log('SOURCE REGISTER');
sources.forEach(s => console.log(`  ${s.sha256.slice(0, 16)}  ${String(s.bytes).padStart(8)}  ${s.licenceStatus.padEnd(16)} ${s.sourceFile}`));

const txFile = join(RAW, 'Jadual Transaksi Sarawak H1 2025.xls');
console.log(`\nTRANSACTION AGGREGATES  ${PERIOD.code}`);
const wbTx = XLSX.readFile(txFile);
let cells = [];
for (const [sheet, subsector, measure] of BREAKDOWN_TABLES) {
  cells = cells.concat(readBreakdownSheet(wbTx, sheet, subsector, measure));
}
const divisionCells = cells.filter(c => !c.printedTotal);
console.log(`  ${divisionCells.length} division cells across ${BREAKDOWN_TABLES.length} tables`);

/* Fold to one row per period × division × subsector × type × band, pairing the
   count table with its value table — the spec's count/value pairing rule. */
const key = (c) => [c.periodCode, c.geography, c.subsector, c.propertyType, c.priceBandRaw].join('|');
const agg = new Map();
divisionCells.forEach(c => {
  const k = key(c);
  if (!agg.has(k)) agg.set(k, {
    periodCode: c.periodCode, state: c.state, geoLevel: c.geoLevel, geography: c.geography,
    geographyRaw: c.geographyRaw, subsector: c.subsector, propertyType: c.propertyType,
    priceBandRaw: c.priceBandRaw, priceBandMin: c.priceBandMin, priceBandMax: c.priceBandMax,
    transactionCount: null, transactionValueRm: null,
    sourceSheets: [], sourceRows: [],
  });
  const a = agg.get(k);
  if (c.measure === 'COUNT') a.transactionCount = c.value;
  else a.transactionValueRm = c.value;
  a.sourceSheets.push(c.sourceSheet); a.sourceRows.push(c.sourceRow);
});

/* IMPLIED AVERAGE, AND WHAT IT IS NOT.
   Total value over total count for the cell. It is the average of everything in
   that band, type, division and half-year — never the price of any property,
   and the label travels with it so a UI cannot lose the qualifier. */
const aggregates = [...agg.values()].map(a => ({
  ...a,
  sourceSheets: [...new Set(a.sourceSheets)],
  impliedAverageValueRm: (isFinite(a.transactionValueRm) && a.transactionValueRm != null
    && a.transactionCount) ? a.transactionValueRm / a.transactionCount : null,
  impliedAverageLabel: 'Implied aggregate average within this category',
  sourceAuthority: 'OFFICIAL_NAPIC',
  granularity: 'AGGREGATE',
  evidenceRole: 'MARKET_ACTIVITY',
}));

console.log(`  ${aggregates.length} aggregate rows`);

/* ------------------------------------------------------ §11 reconciliation ---
   Against the figures the regional report publishes for Sarawak H1 2025. */
const RECON = { count: 11773, valueRm: 4444.21e6 };
const h1 = aggregates.filter(a => a.periodCode === 'H1 2025');
const sumCount = h1.reduce((s, a) => s + (a.transactionCount || 0), 0);
const sumValue = h1.reduce((s, a) => s + (a.transactionValueRm || 0), 0);

console.log('\nRECONCILIATION  H1 2025 Sarawak');
const pct = (a, b) => ((a - b) / b * 100);
console.log(`  count  extracted ${sumCount.toLocaleString()}  target ${RECON.count.toLocaleString()}  ${pct(sumCount, RECON.count).toFixed(2)}%`);
console.log(`  value  extracted RM${(sumValue / 1e6).toFixed(2)}m  target RM${(RECON.valueRm / 1e6).toFixed(2)}m  ${pct(sumValue, RECON.valueRm).toFixed(2)}%`);

const byDivision = {};
h1.forEach(a => {
  byDivision[a.geography] = byDivision[a.geography] || { count: 0, valueRm: 0 };
  byDivision[a.geography].count += a.transactionCount || 0;
  byDivision[a.geography].valueRm += a.transactionValueRm || 0;
});
console.log('\n  by division');
Object.entries(byDivision).sort((a, b) => b[1].count - a[1].count).forEach(([d, v]) =>
  console.log(`    ${d.padEnd(12)} ${String(v.count).padStart(6)}  RM${(v.valueRm / 1e6).toFixed(1)}m`));

const bySubsector = {};
h1.forEach(a => {
  bySubsector[a.subsector] = bySubsector[a.subsector] || { count: 0, valueRm: 0 };
  bySubsector[a.subsector].count += a.transactionCount || 0;
  bySubsector[a.subsector].valueRm += a.transactionValueRm || 0;
});
console.log('\n  by subsector');
Object.entries(bySubsector).forEach(([s, v]) =>
  console.log(`    ${s.padEnd(18)} ${String(v.count).padStart(6)}  RM${(v.valueRm / 1e6).toFixed(1)}m`));

/* ---- market benchmarks ---- */
console.log(`
MARKET BENCHMARKS  ${PERIOD.code}`);
const wbBench = XLSX.readFile(join(RAW, 'Jadual Harga dan Sewa Sarawak H1 2025.xlsx'));
let benchmarks = [], benchRejected = 0;
for (const sheet of Object.keys(BENCH_SHEETS)) {
  const r = readBenchmarkSheet(wbBench, sheet);
  benchmarks = benchmarks.concat(r.rows); benchRejected += r.rejected;
}
console.log(`  ${benchmarks.length} benchmark rows across ${Object.keys(BENCH_SHEETS).length} tables, ${benchRejected} rejected`);
const byDiv = {};
benchmarks.forEach(b => { byDiv[b.geography] = (byDiv[b.geography] || 0) + 1; });
console.log('  ' + Object.entries(byDiv).sort((a,b)=>b[1]-a[1]).map(([d,n])=>`${d} ${n}`).join(' · '));
const withYield = benchmarks.filter(b => b.grossYieldPct != null);
console.log(`  ${withYield.length} carry a reported gross yield`);

/* ------------------------------------------------------- the hard gate ----
   Nothing is written unless the extracted detail reproduces the published
   state totals. A tolerance of 0.05% allows for the report rounding its own
   figures to two decimals and nothing else — the two subtotal bugs this
   caught were 90% and 100% out, and a loose gate would have passed both. */
const TOLERANCE_PCT = 0.05;
const variances = [
  ['transaction count', pct(sumCount, RECON.count)],
  ['transaction value', pct(sumValue, RECON.valueRm)],
];
const breached = variances.filter(([, v]) => Math.abs(v) > TOLERANCE_PCT);
if (breached.length) {
  console.error(`
RECONCILIATION FAILED — tolerance ${TOLERANCE_PCT}%`);
  breached.forEach(([w, v]) => console.error(`  ${w} is ${v.toFixed(3)}% from the published Sarawak total`));
  console.error("  Nothing written. A figure that does not reconcile is not evidence, it is arithmetic.");
  process.exit(1);
}
console.log(`
reconciles within ${TOLERANCE_PCT}% on both measures`);

if (!CHECK_ONLY) {
  /* TWO OUTPUTS, AND THE SPLIT IS THE LICENCE POSITION.

     The full extract — 18,216 aggregate cells — stays in property-data, which
     is not served. Section 14 of the specification disables bulk export of
     NAPIC rows until JPPH confirms redistribution, and an 11MB JSON of them
     sitting under data/ would be exactly that, reachable by anyone who guessed
     the filename. It is also 11MB on a Malaysian mobile connection.

     What the app gets is a DERIVED summary: division by subsector, with the
     period comparison the pages actually show, plus the benchmark ranges. Small
     enough to ship and narrow enough to be the "QT-generated analysis and
     derived summaries with source attribution" the specification does permit. */
  const FULL = join(ROOT, 'property-data/normalized/napic/2025/H1/sarawak-full.json');

  const roll = new Map();
  aggregates.forEach(a => {
    const k = [a.periodCode, a.geography, a.subsector].join('|');
    if (!roll.has(k)) roll.set(k, {
      periodCode: a.periodCode, division: a.geography, subsector: a.subsector,
      count: 0, valueRm: 0, bands: {},
    });
    const t = roll.get(k);
    t.count += a.transactionCount || 0;
    t.valueRm += a.transactionValueRm || 0;
    if (a.transactionCount) t.bands[a.priceBandRaw] = (t.bands[a.priceBandRaw] || 0) + a.transactionCount;
  });
  const summary = [...roll.values()].map(t => ({
    ...t,
    /* Labelled at the point of creation so no consumer can drop the qualifier. */
    impliedAverageValueRm: t.count ? t.valueRm / t.count : null,
    impliedAverageLabel: 'Implied aggregate average within this category',
    granularity: 'AGGREGATE', sourceAuthority: 'OFFICIAL_NAPIC', evidenceRole: 'MARKET_ACTIVITY',
  }));

  const slimBench = benchmarks.map(b => ({
    division: b.geography, scheme: b.scheme, subsector: b.subsector,
    propertyType: b.propertyTypeRaw, table: b.tableTitle,
    basis: b.basis, basisUnit: b.basisUnit, perMonth: b.perMonth,
    sampleSize: b.sampleSize, landSqm: b.averageLandAreaSqm, floorSqm: b.averageFloorAreaSqm,
    min: b.currentMin, max: b.currentMax,
    prevMin: b.previousMin, prevMax: b.previousMax,
    changePct: b.changePct, changeStated: b.changeStated, grossYieldPct: b.grossYieldPct,
    floorLevel: b.floorLevelRaw, roadPosition: b.roadPositionRaw,
    granularity: 'SAMPLE_BENCHMARK', sourceAuthority: 'OFFICIAL_NAPIC',
    evidenceRole: b.evidenceRole, rangeLabel: b.rangeLabel,
  }));

  const head = {
    format: 'quantum-tradeworks/napic-derived', version: 1,
    period: PERIOD,
    licence: {
      status: 'REVIEW_REQUIRED',
      publish: 'DERIVED_ONLY',
      note: 'Official NAPIC/JPPH aggregates and sample benchmarks. Record-level republication, bulk export and raw-file download stay disabled until JPPH confirms commercial redistribution rights.',
      attribution: 'Valuation and Property Services Department (JPPH), Ministry of Finance Malaysia — NAPIC Property Market Report H1 2025',
      sourceUrl: 'https://napic.jpph.gov.my/en/latest-publication',
    },
    /* THE LINE THAT HAS TO SURVIVE EVERY REFACTOR. */
    cannotAnswer: [
      'Exact transaction date — the finest period in these files is a half-year',
      'Individual transacted price — every figure is an aggregate or a sample range',
      'A latest or most recent sale',
      'Median, P25 or P75 computed from records',
      'Tenure, lot or unit reference against a transaction',
      'Land or floor area against a specific sale',
    ],
    sources: sources.map(x => ({ sourceFile: x.sourceFile, sha256: x.sha256, licenceStatus: x.licenceStatus })),
    reconciliation: {
      target: RECON, extractedCount: sumCount, extractedValueRm: sumValue,
      countVariancePct: pct(sumCount, RECON.count), valueVariancePct: pct(sumValue, RECON.valueRm),
    },
  };

  writeFileSync(FULL, JSON.stringify({ ...head, aggregates, benchmarks }, null, 0) + '\n');
  writeFileSync(OUT, JSON.stringify({ ...head, summary, benchmarks: slimBench }, null, 0) + '\n');
  console.log(`  full     ${FULL}`);
  console.log(`  derived  ${OUT}`);
}

/* ---- spot-check against the records named in the specification ---- */
if (process.argv.includes('--spot')) {
  const want = ['RPR Bandar Baru Samariang', 'Sejingkat', 'Imperial Grand Suites'];
  console.log('\nSPOT CHECK');
  want.forEach(w => {
    benchmarks.filter(b => b.scheme.toLowerCase().includes(w.toLowerCase())).forEach(b => {
      console.log(`  ${b.scheme} [${b.sourceSheet}] ${b.geography}`);
      console.log(`    type=${b.propertyTypeRaw} sample=${b.sampleSize} land=${b.averageLandAreaSqm} floor=${b.averageFloorAreaSqm}`);
      console.log(`    ${b.basis} ${b.currentMin}–${b.currentMax} (${b.basisUnit}${b.perMonth ? ', per month' : ''}) change=${b.changePct ?? b.changeStated} yield=${b.grossYieldPct}`);
    });
  });
}
