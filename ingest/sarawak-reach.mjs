#!/usr/bin/env node
/**
 * Caches the "everyday reach" evidence the Property tools show beside an area:
 * who lives in the district, and what is mapped within 5 km of the area's point.
 *
 *   REACH_UA="quantum-tradeworks/0.1 (you@example.com)" node ingest/sarawak-reach.mjs
 *   … --check                      (validate the committed file; no network)
 *   … --dosm <csv> --osm <json>    (read local copies of the two sources)
 *   … --out <path>                 (write somewhere else; a test's copy)
 *   … --retrieved 2026-11-01       (stamp that date rather than today's)
 *
 * (The owner, 1 Nov 2026: rental demand rests on population, jobs, schools,
 * universities and healthcare, and most people spend their time near where
 * they live. Quantum asked the right questions in the demand test and held no
 * evidence for any of them. This file is that evidence, for the owner's own
 * decisions and the same logic under the public Property tools. It is shown;
 * it is never scored, ranked or turned into a grade.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SOURCES, TWO OPEN LICENCES, ONE TRACKED FILE
 *
 *   Population comes from the Department of Statistics Malaysia (DOSM), the
 *   district population file on storage.dosm.gov.my. The developer portal
 *   (developer.data.gov.my) states "License: CC BY 4.0" (read 1 Nov 2026).
 *   DOSM's own terms page could not be retrieved, so that portal statement is
 *   what is recorded, with the attribution "Source: Department of Statistics
 *   Malaysia (DOSM), CC BY 4.0". A different position found later is a
 *   one-line change here and a reason to stop publishing the file — not to
 *   argue the portal's sentence.
 *
 *   Places come from OpenStreetMap through the Overpass API, under the Open
 *   Database Licence: redistribution with attribution, share-alike on the
 *   database. The same reasoning as sarawak-geo.mjs, which tracks its OSM
 *   coordinates for the same reason.
 *
 *   Both permit publishing with attribution, so the file is tracked and
 *   served like data/sarawak-geo.json. Neither is fetched from a visitor's
 *   browser: Overpass's policy is not one a page view can keep, and these are
 *   facts that change over months, so they belong in a file.
 *
 * WHAT THE COUNTS ARE, AND ARE NOT
 *
 *   Every OpenStreetMap count is "mapped in OpenStreetMap — at least this
 *   many", never a total. Schools and clinics are plainly under-mapped (Sarawak
 *   has well over a thousand schools; about 690 are mapped). The job
 *   indicators are places of work that are MAPPED — offices, and industrial,
 *   commercial and retail land-use areas, and malls, each counted apart — and
 *   not jobs: nothing here knows how many people work in any of them. A
 *   land-use area is counted by the centre point of its outline. Distances are
 *   straight line (great circle), not travel time: a river, a bridge or a
 *   one-way system can double a road journey that is 2 km on the map.
 *
 * WHEN IT REFUSES
 *
 *   A partial file is worse than the old one: an Overpass answer cut short
 *   would quietly turn into "no hospital within 5 km". So the file is written
 *   only when both sources arrived whole and the result passes its own
 *   --check; otherwise the file already held is kept and the run exits 1.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, rename, mkdir, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const GEO_FILE   = resolve(ROOT, 'data/sarawak-geo.json');
const OUT        = resolve(flag('out', resolve(ROOT, 'data/sarawak-reach.json')));
const DOSM_URL   = 'https://storage.dosm.gov.my/population/population_district.csv';
const DOSM_FILE  = flag('dosm', null);
const OSM_FILE   = flag('osm', null);
/* The same three public instances map-assets.mjs asks, in turn. */
const OVERPASS   = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const QUERY = '[out:json][timeout:90];area["name"="Sarawak"]["admin_level"="4"]->.s;'
  + '(nwr["amenity"~"^(hospital|clinic|doctors)$"](area.s);nwr["healthcare"~"^(hospital|clinic|centre)$"](area.s);'
  + 'nwr["amenity"~"^(school|college|university|kindergarten)$"](area.s);nwr["office"](area.s);'
  + 'nwr["landuse"~"^(industrial|commercial|retail)$"](area.s);nwr["shop"="mall"](area.s););out tags center qt;';

const RADIUS_KM = 5;
const FIRST_YEAR = 2020;
const EXPECTED_DISTRICTS = 45;         /* Sarawak's, in DOSM's file on 1 Nov 2026 */
const DEDUPE_M = 150;                  /* one hospital drawn as a node and a building is one hospital */
const CHILD_BANDS = ['0-4', '5-9', '10-14'];
const WORKING_BANDS = ['20-24', '25-29', '30-34', '35-39', '40-44', '45-49', '50-54', '55-59', '60-64'];

const SOURCES = {
  population: {
    name: 'Department of Statistics Malaysia (DOSM) — population by district',
    url: DOSM_URL,
    licence: 'CC BY 4.0',
    licenceBasis: 'developer.data.gov.my states "License: CC BY 4.0" (read 1 Nov 2026). DOSM\'s own terms page could not be retrieved.',
    attribution: 'Source: Department of Statistics Malaysia (DOSM), CC BY 4.0',
    measure: 'Population in thousands as published, annual on 1 January, both sexes, all ethnic groups; stored here in persons to the 100.',
  },
  places: {
    name: 'OpenStreetMap, through the Overpass API',
    url: 'https://www.openstreetmap.org/copyright',
    licence: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
    measure: 'Features mapped by volunteers. Counts are "mapped in OpenStreetMap — at least this many", not totals.',
  },
};

/* ─────────────────────────────────────── AREA → DISTRICT, WRITTEN OUT ─────
   Each area of data/sarawak-geo.json is placed in the DOSM district its point
   lies in, by hand, with the reason. OpenStreetMap's district boundary
   (admin_level 6) containing each point was read on 1 Nov 2026 and is what
   each `basis` says. A point on a boundary, or one this table does not name,
   is recorded as unmapped rather than put in the nearest district: the
   counts are still computed for it, since they need only the point. */
const BOUNDARY = (district) => `inside the OpenStreetMap boundary of ${district} district (a district-level Nominatim lookup, 1 Nov 2026)`;
const AREA_DISTRICT = {
  'kuching/City centre'       : { district: 'Kuching', basis: `${BOUNDARY('Kuching')}` },
  'kuching/Tabuan'            : { district: 'Kuching', basis: `${BOUNDARY('Kuching')}` },
  'kuching/Stutong'           : { district: 'Kuching', basis: `${BOUNDARY('Kuching')}` },
  'kuching/Batu Kawa'         : { district: 'Kuching', basis: `${BOUNDARY('Kuching')}` },
  'kuching/Matang'            : { district: 'Kuching', basis: `${BOUNDARY('Kuching')}` },
  'kuching/Petra Jaya'        : { district: 'Kuching', basis: `${BOUNDARY('Kuching')}` },
  'kuching/Samarahan'         : { district: 'Kuching', basis: `${BOUNDARY('Kuching')}; “Samarahan” here is the Kuching–Samarahan expressway corridor, not Kota Samarahan` },
  'kuching/Kota Samarahan'    : { district: 'Samarahan', basis: `${BOUNDARY('Samarahan')}; Kota Samarahan is a town of the Samarahan Division` },
  'sibu/Town centre'          : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'sibu/Rejang Park'          : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'sibu/Ulu Sungai Merah'     : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'sibu/Jalan Salim'          : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'sibu/Jalan Teku'           : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'sibu/Permai'               : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'sibu/Lanang'               : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'sibu/Sibujaya'             : { district: 'Sibu', basis: `${BOUNDARY('Sibu')}` },
  'miri/City centre'          : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'miri/Marina'               : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'miri/Pujut'                : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'miri/Lutong'               : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'miri/Permyjaya'            : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'miri/Senadin'              : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'miri/Tudan'                : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'miri/Taman Tunku'          : { district: 'Miri', basis: `${BOUNDARY('Miri')}` },
  'bintulu/Town centre'       : { district: 'Bintulu', basis: `${BOUNDARY('Bintulu')}` },
  'bintulu/Tanjung Batu'      : { district: 'Bintulu', basis: `${BOUNDARY('Bintulu')}` },
  'bintulu/Kidurong'          : { district: 'Bintulu', basis: `${BOUNDARY('Bintulu')}` },
  'bintulu/Samalaju'          : { district: null, reason: "OpenStreetMap puts the point in Bintulu district, but Samalaju lies toward the Bintulu–Sebauh district line and DOSM's boundary could not be checked, so no district is assigned" },
  'bintulu/Jepak'             : { district: 'Bintulu', basis: `${BOUNDARY('Bintulu')}` },
  'bintulu/Kemena'            : { district: 'Bintulu', basis: `${BOUNDARY('Bintulu')}` },
  'bintulu/Parkcity'          : { district: 'Bintulu', basis: `${BOUNDARY('Bintulu')}` },
  'bintulu/Sibiew'            : { district: 'Bintulu', basis: `${BOUNDARY('Bintulu')}` },
};

/* ─────────────────────────────────────────────────────────────── helpers ── */
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const rnd = (x, dp) => { const v = Number(x.toFixed(dp)); return Object.is(v, -0) ? 0 : v; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* Sorted keys all the way down, so the same inputs write the same bytes. */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])]));
  return v;
}
const stringify = (doc) => JSON.stringify(canon(doc), null, 2) + '\n';

function haversineKm(a, b) {
  const R = 6371.0088, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ─────────────────────────────────────────────────────────── CHECK MODE ──
   Validates a reach file's shape and its own arithmetic, with no network.
   Returns the problems; empty means it holds. */
export async function checkReach(path = OUT, geoPath = GEO_FILE) {
  const bad = [];
  let text;
  try { text = await readFile(path, 'utf8'); } catch { return [`${path} is missing — run ingest/sarawak-reach.mjs and commit the file`]; }
  let d;
  try { d = JSON.parse(text); } catch (e) { return [`${path} is not valid JSON: ${e.message}`]; }
  if (text !== stringify(d)) bad.push('the file is not in canonical form (sorted keys, two-space JSON, one final newline), so a regenerated copy would differ in every line');

  if (d.version !== 1) bad.push(`version is ${JSON.stringify(d.version)}, not 1`);
  const s = d.sources || {};
  if (s.population?.licence !== 'CC BY 4.0') bad.push('sources.population.licence must be "CC BY 4.0"');
  if (s.population?.attribution !== SOURCES.population.attribution) bad.push(`sources.population.attribution must be "${SOURCES.population.attribution}"`);
  if (s.places?.licence !== 'ODbL 1.0') bad.push('sources.places.licence must be "ODbL 1.0"');
  if (s.places?.attribution !== SOURCES.places.attribution) bad.push(`sources.places.attribution must be "${SOURCES.places.attribution}"`);
  for (const k of ['population', 'places']) for (const f of ['name', 'url', 'licence', 'attribution']) if (!s[k]?.[f]) bad.push(`sources.${k}.${f} is missing`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.retrieved || '')) bad.push('retrieved must be a date, YYYY-MM-DD');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(d.osmBase || '')) bad.push('osmBase must be the OpenStreetMap base timestamp, like 2026-11-01T07:42:21Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.populationAsOf || '')) bad.push('populationAsOf must be a date, YYYY-MM-DD');
  for (const [f, re] of [['attribution', /Department of Statistics Malaysia \(DOSM\), CC BY 4\.0.*© OpenStreetMap contributors|© OpenStreetMap contributors.*Department of Statistics Malaysia \(DOSM\), CC BY 4\.0/s],
                         ['note', /at least this many/], ['note', /straight[- ]line/], ['note', /not (jobs|travel)/i]]) {
    if (!re.test(d[f] || '')) bad.push(`${f} must say what it is for: ${re}`);
  }

  /* districts */
  const dist = d.districts || {};
  const names = Object.keys(dist);
  if (names.length !== EXPECTED_DISTRICTS) bad.push(`${names.length} districts, where DOSM's Sarawak file has ${EXPECTED_DISTRICTS}`);
  const asOfYear = Number(String(d.populationAsOf || '').slice(0, 4));
  for (const n of names) {
    const x = dist[n];
    const years = Object.keys(x.population || {}).map(Number).sort((a, b) => a - b);
    if (!years.length || years.at(-1) !== asOfYear || years[0] < FIRST_YEAR || years.some((y, i) => i && y !== years[i - 1] + 1)) { bad.push(`${n}: population years are ${years.join(', ') || 'none'}, expected one run of years up to ${asOfYear}`); continue; }
    if (!years.every(y => Number.isInteger(x.population[y]) && x.population[y] > 0 && x.population[y] % 100 === 0)) bad.push(`${n}: a population is not a whole number of persons to the 100`);
    if (x.growthPct === null) { if (!x.seriesNote) bad.push(`${n}: no growth figure and no reason`); }
    else {
      if (years[0] !== FIRST_YEAR) bad.push(`${n}: growth since ${FIRST_YEAR} given for a series that starts in ${years[0]}`);
      else if (!isNum(x.growthPct) || Math.abs(x.growthPct - rnd((x.population[asOfYear] / x.population[FIRST_YEAR] - 1) * 100, 2)) > 0.005) bad.push(`${n}: growthPct ${x.growthPct} is not ${FIRST_YEAR}→${asOfYear} of its own population series`);
      if (years.some((y, i) => i && Math.abs(x.population[y] / x.population[y - 1] - 1) > STEP_LIMIT)) bad.push(`${n}: growth is shown across a step of more than ${STEP_LIMIT * 100}% in one year`);
    }
    for (const f of ['workingAgeSharePct', 'childrenSharePct']) if (!isNum(x[f]) || x[f] <= 0 || x[f] >= 100) bad.push(`${n}: ${f} ${x[f]} is not a share between 0 and 100`);
    if (isNum(x.workingAgeSharePct) && isNum(x.childrenSharePct) && x.workingAgeSharePct + x.childrenSharePct >= 100) bad.push(`${n}: working-age and children's shares together reach 100%`);
  }

  /* areas, held to the geocoded areas exactly */
  const geo = await readJson(geoPath, null);
  const COUNTS = ['clinics', 'collegesAndUniversities', 'commercialLanduse', 'hospitals', 'industrialLanduse', 'kindergartens', 'malls', 'offices', 'retailLanduse', 'schools'];
  const NEAR = ['collegeOrUniversity', 'hospital', 'mall'];
  const NEAR_COUNT = { collegeOrUniversity: 'collegesAndUniversities', hospital: 'hospitals', mall: 'malls' };
  const tot = d.totals || {};
  for (const c of COUNTS) if (!Number.isInteger(tot[c]) || tot[c] < 1) bad.push(`totals.${c} must be a positive whole number (it is the Sarawak-wide count)`);
  if (!geo) bad.push('data/sarawak-geo.json could not be read, so the areas cannot be held to it');
  else {
    for (const [cid, city] of Object.entries(geo.cities || {})) {
      for (const a of Object.keys(city.areas || {})) {
        const r = d.cities?.[cid]?.areas?.[a];
        const where = `${cid}/${a}`;
        if (!r) { bad.push(`${where} is in data/sarawak-geo.json and has no reach record`); continue; }
        if (r.district === null) { if (!r.unmapped) bad.push(`${where}: no district and no reason`); }
        else {
          if (!dist[r.district]) bad.push(`${where}: district "${r.district}" is not a DOSM Sarawak district`);
          if (!r.districtBasis) bad.push(`${where}: a district with no stated basis`);
        }
        for (const c of COUNTS) {
          const v = r.within5km?.[c];
          if (!Number.isInteger(v) || v < 0) bad.push(`${where}: within5km.${c} is not a count`);
          else if (v > tot[c]) bad.push(`${where}: within5km.${c} (${v}) exceeds the Sarawak-wide ${tot[c]}`);
        }
        for (const n of NEAR) {
          const x = r.nearest?.[n];
          if (!x || !(x.km === null || (isNum(x.km) && x.km >= 0))) { bad.push(`${where}: nearest.${n}.km must be a distance in km or null`); continue; }
          const k = r.within5km?.[NEAR_COUNT[n]];
          if (x.km !== null && x.km <= RADIUS_KM - 0.05 && k === 0) bad.push(`${where}: nearest ${n} is ${x.km} km away and none is counted within ${RADIUS_KM} km`);
          if (x.km !== null && x.km > RADIUS_KM + 0.05 && k > 0) bad.push(`${where}: ${k} ${n} counted within ${RADIUS_KM} km and the nearest is ${x.km} km`);
          if (x.km === null && k > 0) bad.push(`${where}: no nearest ${n}, and ${k} counted`);
        }
      }
    }
    for (const [cid, city] of Object.entries(d.cities || {})) for (const a of Object.keys(city.areas || {}))
      if (!geo.cities?.[cid]?.areas?.[a]) bad.push(`${cid}/${a} has a reach record and is not in data/sarawak-geo.json`);
  }
  return bad;
}

/* ───────────────────────────────────────────────────────────── POPULATION */
function parsePopulation(csv) {
  const lines = csv.split(/\r?\n/);
  if (lines[0].trim() !== 'state,district,date,sex,age,ethnicity,population') throw new Error(`the DOSM file's header is "${lines[0].slice(0, 80)}", not the one this script reads`);
  const by = {};                                  /* district → date → age → thousands */
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.startsWith('Sarawak,')) continue;
    if (ln.includes('"')) throw new Error(`line ${i + 1} is quoted; this reader does not parse quoted fields`);
    const [, district, date, sex, age, eth, pop] = ln.split(',');
    if (sex !== 'both' || eth !== 'overall') continue;
    const v = Number(pop);
    if (!Number.isFinite(v) || v < 0) throw new Error(`line ${i + 1}: "${pop}" is not a population`);
    ((by[district] = by[district] || {})[date] = by[district][date] || {})[age] = v;
  }
  return by;
}

/* DOSM split districts in 2025: Serian gave up Siburan, Simunjan gave up
   Sebuyau and Gedong, Sri Aman gave up Pantu and Lingga (their 2024 totals fall
   by a third to two thirds in a single step, and the new districts first
   appear that year). A district whose series steps by more than a tenth in one
   year, or that has no 2020 figure, has no like-for-like growth since 2020, so
   none is shown for it and the reason travels with it. The four towns' districts
   (Kuching, Samarahan, Sibu, Miri, Bintulu) move by under 4% a year. */
const STEP_LIMIT = 0.10;
function populationDistricts(by) {
  const names = Object.keys(by);
  if (names.length !== EXPECTED_DISTRICTS) throw new Error(`${names.length} Sarawak districts in the DOSM file, where ${EXPECTED_DISTRICTS} were expected`);
  const dates = [...new Set(names.flatMap(n => Object.keys(by[n])))].sort();
  const latest = dates.at(-1), lastYear = Number(latest.slice(0, 4));
  const out = {};
  for (const n of names.sort()) {
    const population = {};
    for (let y = FIRST_YEAR; y <= lastYear; y++) {
      const th = by[n][`${y}-01-01`]?.overall;
      if (th > 0) population[y] = Math.round(th * 10) * 100;
      /* A district may begin late (below), never skip a year once begun. */
      else if (Object.keys(population).length) throw new Error(`${n} has no overall population for ${y}-01-01; refusing a partial series`);
    }
    const years = Object.keys(population).map(Number);
    if (!population[lastYear]) throw new Error(`${n} has no population for ${lastYear}`);
    const bands = by[n][latest];
    const sum = (list) => list.reduce((s, b) => { if (!(bands[b] >= 0)) throw new Error(`${n} ${latest}: age band ${b} is missing`); return s + bands[b]; }, 0);
    const total = bands.overall;
    const rec = {
      childrenSharePct: rnd(sum(CHILD_BANDS) / total * 100, 1),
      population,
      workingAgeSharePct: rnd(sum(WORKING_BANDS) / total * 100, 1),
    };
    let step = null;
    for (let y = years[0] + 1; y <= lastYear; y++) {
      if (population[y] && population[y - 1] && Math.abs(population[y] / population[y - 1] - 1) > STEP_LIMIT) step = { y, pct: rnd((population[y] / population[y - 1] - 1) * 100, 1) };
    }
    if (years[0] !== FIRST_YEAR) {
      rec.growthPct = null;
      rec.seriesNote = `A district DOSM first lists in ${years[0]}, so there is no ${FIRST_YEAR} figure and no growth since then.`;
    } else if (step) {
      rec.growthPct = null;
      rec.seriesNote = `A step of ${step.pct}% between ${step.y - 1} and ${step.y} in DOSM's file, the year new districts first appear: read as a change of boundary, so growth since ${FIRST_YEAR} is not shown.`;
    } else rec.growthPct = rnd((population[lastYear] / population[FIRST_YEAR] - 1) * 100, 2);
    out[n] = rec;
  }
  return { districts: out, asOf: latest };
}

/* ──────────────────────────────────────────────────────────────── PLACES */
const position = (e) => e.type === 'node' ? { lat: e.lat, lon: e.lon } : e.center ? { lat: e.center.lat, lon: e.center.lon } : null;
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* One element → the facility it is (at most one), and the places of work it
   marks (any). A school that carries an office tag is a school. A fast-food
   shop that carries one is neither: the tag is a stray. */
const NOT_AN_OFFICE = new Set(['fast_food', 'restaurant', 'cafe', 'food_court', 'marketplace']);
function classify(t) {
  let facility = null;
  const am = t.amenity, hc = t.healthcare;
  if (am === 'hospital' || (!am && hc === 'hospital')) facility = 'hospitals';
  else if (am === 'clinic' || am === 'doctors' || (!am && (hc === 'clinic' || hc === 'centre'))) facility = 'clinics';
  else if (am === 'college' || am === 'university') facility = 'collegesAndUniversities';
  else if (am === 'school') facility = 'schools';
  else if (am === 'kindergarten') facility = 'kindergartens';
  const work = [];
  if (!facility) {
    if (t.office && t.office !== 'no' && !NOT_AN_OFFICE.has(am)) work.push('offices');
    if (t.landuse === 'industrial') work.push('industrialLanduse');
    else if (t.landuse === 'commercial') work.push('commercialLanduse');
    else if (t.landuse === 'retail') work.push('retailLanduse');
  }
  if (t.shop === 'mall') work.push('malls');
  return { facility, work };
}

function places(doc) {
  const kept = [];                                /* {cat, lat, lon, name} */
  const unclassified = [];
  for (const e of doc.elements) {
    const p = position(e);
    if (!p) throw new Error(`element ${e.type}/${e.id} has no position; refusing a partial answer`);
    const { facility, work } = classify(e.tags || {});
    const cats = facility ? [facility, ...work] : work;
    if (!cats.length) { unclassified.push(`${e.type}/${e.id}`); continue; }
    for (const cat of cats) kept.push({ cat, lat: p.lat, lon: p.lon, name: e.tags?.name || null });
  }
  /* The same named facility drawn twice (a node and its building) is one. */
  const DEDUPED = new Set(['hospitals', 'clinics', 'collegesAndUniversities', 'schools', 'kindergartens', 'malls']);
  const out = [], seen = new Map();
  let collapsed = 0;
  for (const k of kept) {
    if (DEDUPED.has(k.cat) && k.name) {
      const key = `${k.cat}|${normName(k.name)}`;
      const list = seen.get(key) || [];
      if (list.some(o => haversineKm(o, k) * 1000 <= DEDUPE_M)) { collapsed++; continue; }
      list.push(k); seen.set(key, list);
    }
    out.push(k);
  }
  return { list: out, collapsed, unclassified };
}

function areaReach(point, list) {
  const within5km = Object.fromEntries(['clinics', 'collegesAndUniversities', 'commercialLanduse', 'hospitals', 'industrialLanduse', 'kindergartens', 'malls', 'offices', 'retailLanduse', 'schools'].map(c => [c, 0]));
  const near = { collegeOrUniversity: null, hospital: null, mall: null };
  const NEAR = { collegesAndUniversities: 'collegeOrUniversity', hospitals: 'hospital', malls: 'mall' };
  for (const p of list) {
    const km = haversineKm(point, p);
    if (km <= RADIUS_KM) within5km[p.cat]++;
    const n = NEAR[p.cat];
    if (n && (!near[n] || km < near[n].km)) near[n] = { km, name: p.name };
  }
  const nearest = {};
  for (const [k, v] of Object.entries(near)) nearest[k] = v ? { km: rnd(v.km, 1), name: v.name } : { km: null, name: null };
  return { within5km, nearest };
}

/* ─────────────────────────────────────────────────────────────── FETCHING */
async function getDosm(ua) {
  if (DOSM_FILE) return readFile(DOSM_FILE, 'utf8');
  const r = await fetch(DOSM_URL, { headers: { 'user-agent': ua }, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`${r.status} from storage.dosm.gov.my`);
  return r.text();
}
async function getOsm(ua) {
  if (OSM_FILE) return JSON.parse(await readFile(OSM_FILE, 'utf8'));
  const said = [];
  for (const url of OVERPASS) {
    try {
      /* Overpass answers 406 to a request with no User-Agent. */
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: QUERY }),
        headers: { 'user-agent': ua }, signal: AbortSignal.timeout(150000) });
      if (!r.ok) { said.push(`${url} ${r.status}`); await sleep(8000); continue; }
      const doc = JSON.parse(await r.text());
      /* A remark is how Overpass says it stopped early (a timeout, no memory):
         whatever elements came with it are a part. */
      if (doc.remark) { said.push(`${url} remark: ${doc.remark}`); continue; }
      return doc;
    } catch (e) { said.push(`${url} ${e.message}`); await sleep(8000); }
  }
  throw new Error(`Overpass gave no complete answer — ${said.join('; ')}`);
}

/* ──────────────────────────────────────────────────────────────────── main */
async function main() {
  if (has('check')) {
    const problems = await checkReach();
    if (problems.length) { console.error(`${OUT}: ${problems.length} problem${problems.length === 1 ? '' : 's'}`); problems.forEach(p => console.error('  ' + p)); process.exit(1); }
    const d = await readJson(OUT, {});
    console.log(`${OUT} holds — ${Object.keys(d.districts).length} districts, ${Object.values(d.cities).reduce((n, c) => n + Object.keys(c.areas).length, 0)} areas, population as of ${d.populationAsOf}, OpenStreetMap base ${d.osmBase}`);
    return;
  }

  const ua = process.env.REACH_UA || process.env.GEO_UA;
  if (!(DOSM_FILE && OSM_FILE) && (!ua || !/@/.test(ua))) {
    console.error(`REACH_UA must identify this tool and carry a contact address, for example:

  REACH_UA="quantum-tradeworks/0.1 (you@example.com)" node ingest/sarawak-reach.mjs

Overpass refuses a request with no User-Agent, and its policy asks automated
clients to say who they are. (GEO_UA, the variable sarawak-geo.mjs reads, works
here too.)`);
    process.exit(1);
  }

  const geo = await readJson(GEO_FILE, null);
  if (!geo?.cities) throw new Error('data/sarawak-geo.json could not be read; the areas come from it');

  console.log('reading the DOSM district population file…');
  const pop = populationDistricts(parsePopulation(await getDosm(ua)));
  console.log(`  ${Object.keys(pop.districts).length} Sarawak districts, ${FIRST_YEAR}–${pop.asOf.slice(0, 4)}`);

  console.log('asking Overpass for the mapped places…');
  const osm = await getOsm(ua);
  if (osm.remark) throw new Error(`Overpass stopped early (${osm.remark}); whatever it sent is a part`);
  const osmBase = osm.osm3s?.timestamp_osm_base;
  if (!osmBase || !Array.isArray(osm.elements) || osm.elements.length < 1000)
    throw new Error(`the Overpass answer carries ${osm.elements?.length ?? 'no'} elements and ${osmBase ? 'a' : 'no'} base timestamp; Sarawak has thousands, so this is a partial answer`);
  const pl = places(osm);
  const totals = {};
  for (const p of pl.list) totals[p.cat] = (totals[p.cat] || 0) + 1;
  console.log(`  ${osm.elements.length} elements → ${pl.list.length} mapped places (${pl.collapsed} duplicate drawings collapsed, ${pl.unclassified.length} stray matches dropped)`);

  const cities = {};
  const unmapped = [];
  for (const [cid, city] of Object.entries(geo.cities)) {
    cities[cid] = { areas: {}, name: city.name };
    for (const [name, pt] of Object.entries(city.areas)) {
      const m = AREA_DISTRICT[`${cid}/${name}`];
      const rec = areaReach(pt, pl.list);
      if (m?.district && pop.districts[m.district]) rec.district = m.district, rec.districtBasis = m.basis;
      else {
        rec.district = null;
        rec.unmapped = m?.district ? `${m.district} is not a district in DOSM's Sarawak file` : (m?.reason || 'no entry in the area-to-district table');
        unmapped.push(`${cid}/${name}: ${rec.unmapped}`);
      }
      cities[cid].areas[name] = rec;
    }
  }

  const retrieved = flag('retrieved', new Date().toISOString().slice(0, 10));
  const doc = {
    attribution: `${SOURCES.population.attribution}. ${SOURCES.places.attribution}, openstreetmap.org/copyright (ODbL 1.0).`,
    cities,
    districts: pop.districts,
    note: 'OpenStreetMap counts are "mapped in OpenStreetMap — at least this many", never a total: schools and clinics in particular are under-mapped. '
      + 'The job indicators are places of work that are mapped (offices, industrial, commercial and retail land-use areas counted by the centre of their outline, malls), not jobs. '
      + 'Distances are straight line from the area\'s single point, not travel time. Population is DOSM\'s district estimate for 1 January, a district-wide figure that says nothing of any one area inside it. '
      + 'Redistribution is permitted under CC BY 4.0 and ODbL with attribution.',
    osmBase,
    populationAsOf: pop.asOf,
    retrieved,
    sources: SOURCES,
    totals,
    version: 1,
  };

  /* Refuse unless the result passes its own check — written beside the target
     and moved over it, so a failed run leaves the file already held. */
  const tmp = `${OUT}.tmp`;
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(tmp, stringify(doc));
  const problems = await checkReach(tmp);
  const kept = problems.filter(p => !/^the file is not in canonical/.test(p));
  if (kept.length) {
    await unlink(tmp).catch(() => {});
    console.error(`refusing to write ${OUT}: the result fails its own check, so the file already held is kept`);
    kept.forEach(p => console.error('  ' + p));
    process.exit(1);
  }
  await rename(tmp, OUT);

  console.log(`wrote ${OUT}`);
  console.log(`  population as of ${pop.asOf}; OpenStreetMap base ${osmBase}; retrieved ${retrieved}`);
  console.log('  Sarawak-wide, as mapped: ' + Object.keys(totals).sort().map(k => `${k} ${totals[k]}`).join(' · '));
  console.log('\n  the four towns\' districts:');
  for (const n of ['Kuching', 'Samarahan', 'Sibu', 'Miri', 'Bintulu']) {
    const x = pop.districts[n]; if (!x) continue;
    console.log(`    ${n.padEnd(10)} ${String(x.population[pop.asOf.slice(0, 4)]).padStart(7)}  ${x.growthPct === null ? 'no growth figure' : (x.growthPct >= 0 ? '+' : '') + x.growthPct + '% since ' + FIRST_YEAR}  working age ${x.workingAgeSharePct}%  children ${x.childrenSharePct}%`);
  }
  if (unmapped.length) { console.log('\n  areas with no district (counts still computed):'); unmapped.forEach(u => console.log('    ' + u)); }
  console.log('\nCounts are mapped in OpenStreetMap, at least that many. Distances are straight line.');
}

/* Run only when this file is the program, so a check can import checkReach. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`failed — ${e.message}`); console.error('The file already held, if any, is untouched.'); process.exit(1); });
}
