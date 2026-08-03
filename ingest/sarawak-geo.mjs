#!/usr/bin/env node
/**
 * Caches the two Sarawak reference layers the property map needs.
 *
 *   GEO_UA="quantum-tradeworks/0.1 (you@example.com)" node ingest/sarawak-geo.mjs
 *   … --only geo        (coordinates only, skip the income fetch)
 *   … --refresh         (re-geocode areas already cached)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO SOURCES, TWO LICENCE POSITIONS, TWO FILES
 *
 *   Coordinates come from OpenStreetMap under the Open Database Licence, which
 *   permits redistribution with attribution and share-alike on the database.
 *   That is confirmed, so they are written to a file the repository tracks.
 *
 *   Household income comes from data.gov.my. Malaysian government open data is
 *   generally published under an attribution licence, but the terms page could
 *   not be read programmatically — every candidate URL serves a Javascript
 *   shell with no licence string in the response. Unconfirmed redistribution
 *   rights on a public repository is exactly the situation this product treats
 *   as a refusal elsewhere, so the income file is written to a git-ignored path
 *   and the app reads it as an optional local layer.
 *
 *   Confirm the licence in writing and moving it into the tracked set is a
 *   one-line change. Do not make that change on an assumption.
 *
 * WHY CACHE RATHER THAN FETCH LIVE
 *   Nominatim's usage policy caps automated use at one request a second and
 *   asks for an identifying user agent. A browser calling it per page view
 *   would breach both. These are reference facts that change on the scale of
 *   years, so they belong in a file, not in a request.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const GEO_OUT    = 'data/sarawak-geo.json';        /* tracked — ODbL, attribution below */
const INCOME_OUT = 'data/sarawak-income.json';     /* git-ignored — licence unconfirmed */
const ONLY       = flag('only', null);
const REFRESH    = has('refresh');

/* Nominatim asks that automated use identify itself and carry a contact. The
   same rule the SEC extractor applies: no contact, no request. */
const UA = process.env.GEO_UA;
if (!UA || !/@/.test(UA)) {
  console.error(`GEO_UA must identify this tool and carry a contact address, for example:

  GEO_UA="quantum-tradeworks/0.1 (you@example.com)" node ingest/sarawak-geo.mjs

OpenStreetMap's Nominatim policy requires automated clients to identify
themselves. Requests without a contact are throttled or blocked, and sending
them anonymously would be taking a free service without accountability.`);
  process.exit(1);
}

/* The areas the calculator offers, kept in step with SARAWAK_CITIES in the app.
   If a city gains an area there, add it here and re-run. */
const AREAS = {
  kuching: { name:'Kuching', areas:['City centre','Tabuan','Stutong','Batu Kawa','Matang','Petra Jaya','Samarahan','Kota Samarahan'] },
  sibu:    { name:'Sibu',    areas:['Town centre','Rejang Park','Ulu Sungai Merah','Jalan Salim','Jalan Teku','Permai','Lanang','Sibujaya'] },
  miri:    { name:'Miri',    areas:['City centre','Marina','Pujut','Lutong','Permyjaya','Senadin','Tudan','Taman Tunku'] },
  bintulu: { name:'Bintulu', areas:['Town centre','Tanjung Batu','Kidurong','Samalaju','Jepak','Kemena','Parkcity','Sibiew'] },
};

const norm = (x) => String(x).toLowerCase().replace(/[^a-z ]/g, '').trim();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const readJson = async (p, fallback) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };

/* ---------------------------------------------------------------- geometry */
async function geocode() {
  const prev = await readJson(GEO_OUT, { cities: {} });
  const out = { cities: {} };
  let fetched = 0, cached = 0, missed = 0;

  for (const [id, city] of Object.entries(AREAS)) {
    out.cities[id] = { name: city.name, areas: {} };
    for (const area of city.areas) {
      const before = prev.cities?.[id]?.areas?.[area];
      if (before && !REFRESH) { out.cities[id].areas[area] = before; cached++; continue; }

      /* "Town centre" is a label, not a place name. Asking for the city itself
         is what a reader means by it and is what Nominatim can answer. */
      const generic = /^(town|city) centre$/i.test(area);
      const q = generic ? `${city.name}, Sarawak, Malaysia` : `${area}, ${city.name}, Sarawak, Malaysia`;

      try {
        /* Ask for several and choose by type. Taking the first result made
           "Marina, Miri" resolve to a nail salon and "Kota Samarahan" to a
           kindergarten — businesses inside the area rather than the area. A
           place, suburb or neighbourhood is what an area query means; a shop
           that happens to sit in one is a different kind of answer. */
        const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=8&addressdetails=1`,
          { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
        const raw = await r.json();
        const RANK = { place:0, boundary:1, landuse:2, highway:3, amenity:8, shop:9, office:9, leisure:7, building:6 };
        const j = raw.slice().sort((a, b) =>
          (RANK[a.class] ?? 5) - (RANK[b.class] ?? 5) || (b.importance ?? 0) - (a.importance ?? 0));
        if (j[0]) {
          out.cities[id].areas[area] = {
            lat: +Number(j[0].lat).toFixed(5), lon: +Number(j[0].lon).toFixed(5),
            /* What was actually matched, so a wrong match is visible rather
               than hidden behind the name that was asked for. */
            matched: j[0].display_name,
            /* What OSM says this thing is, so a weak match is visible in the
               file rather than only in the map. */
            kind: `${j[0].class}/${j[0].type}`,
            /* Three honest grades, not a boolean. A mapped locality is the
               thing itself. A road or land parcel carrying the area's own name
               is a fair proxy — several of these areas ARE roads, and Jalan
               Teku is not less located for being a street. A shop or building
               that merely sits inside the area is the weak case: the point is
               somewhere in the right neighbourhood and no more precise than
               that, and a map should not draw it as if it were a centre. */
            confidence: generic ? 'city-point'
              : ['place', 'boundary'].includes(j[0].class) ? 'locality'
              : (['highway', 'landuse'].includes(j[0].class)
                 && norm(j[0].display_name.split(',')[0]).includes(norm(area).replace(/^(jalan|ulu) /, ''))) ? 'named-feature'
              : 'landmark-proxy',
            approximate: generic || undefined,
          };
          fetched++;
        } else { missed++; console.warn(`  no match: ${city.name} / ${area}`); }
      } catch (e) { missed++; console.warn(`  failed:  ${city.name} / ${area} — ${e.message}`); }
      await sleep(1100);                      /* the policy is one a second */
    }
  }
  return { out, fetched, cached, missed };
}

/* ------------------------------------------------------------------ income */
async function income() {
  const r = await fetch('https://api.data.gov.my/data-catalogue?id=hh_income_district&limit=2000',
    { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(40000) });
  if (!r.ok) throw new Error(`${r.status} from data.gov.my`);
  const all = await r.json();
  const swk = all.filter(x => /sarawak/i.test(x.state || ''));

  /* Keep every year rather than the latest only: a single figure cannot show
     whether a district is rising or flat, and the difference matters more to a
     buyer than the level does. */
  const byDistrict = {};
  for (const row of swk) {
    const d = row.district;
    (byDistrict[d] = byDistrict[d] || []).push({
      year: Number(String(row.date).slice(0, 4)),
      mean: row.income_mean ?? null,
      median: row.income_median ?? null,
    });
  }
  for (const d of Object.keys(byDistrict)) byDistrict[d].sort((a, b) => a.year - b.year);
  return { districts: byDistrict, rows: swk.length };
}

/* -------------------------------------------------------------------- main */
if (ONLY !== 'income') {
  console.log('geocoding areas (one request a second, as the policy asks)…');
  const { out, fetched, cached, missed } = await geocode();
  out.source = 'OpenStreetMap via Nominatim';
  out.licence = 'ODbL 1.0';
  out.attribution = '© OpenStreetMap contributors, openstreetmap.org/copyright';
  out.retrieved = new Date().toISOString().slice(0, 10);
  out.note = 'Coordinates are a single representative point per area, not a boundary. Redistribution is permitted under ODbL with attribution.';
  await mkdir(dirname(GEO_OUT), { recursive: true });
  await writeFile(GEO_OUT, JSON.stringify(out, null, 2));
  const total = Object.values(out.cities).reduce((s, c) => s + Object.keys(c.areas).length, 0);
  const grades = {};
  Object.values(out.cities).forEach(c => Object.values(c.areas).forEach(a => { grades[a.confidence] = (grades[a.confidence] || 0) + 1; }));
  console.log(`wrote ${GEO_OUT} — ${total} areas (${fetched} fetched, ${cached} from cache, ${missed} unresolved)`);
  console.log('  ' + Object.entries(grades).map(([k, v]) => `${v} ${k}`).join(' · '));
  const weak = [];
  Object.values(out.cities).forEach(c => Object.entries(c.areas).forEach(([n, a]) => {
    if (a.confidence === 'landmark-proxy') weak.push(`${c.name}/${n} → ${a.matched.split(',')[0]}`); }));
  if (weak.length) {
    console.log('  landmark proxies — a point inside the area, not the area itself:');
    weak.forEach(w => console.log('    ' + w));
  }
  console.log('  licence: ODbL 1.0 — tracked by the repository, attribution carried in the file');
}

if (ONLY !== 'geo') {
  console.log('\nfetching household income by district…');
  try {
    const inc = await income();
    const payload = {
      source: 'data.gov.my — household income by district (DOSM)',
      licenceStatus: 'unconfirmed',
      licenceNote: 'The published terms could not be read programmatically. Until redistribution rights are confirmed in writing this file is git-ignored and is treated as a local layer, not as product data.',
      retrieved: new Date().toISOString().slice(0, 10),
      districts: inc.districts,
    };
    await mkdir(dirname(INCOME_OUT), { recursive: true });
    await writeFile(INCOME_OUT, JSON.stringify(payload, null, 2));
    const ds = Object.keys(inc.districts);
    console.log(`wrote ${INCOME_OUT} — ${ds.length} districts, ${inc.rows} observations`);
    const years = [...new Set(Object.values(inc.districts).flat().map(x => x.year))].sort();
    console.log(`  years: ${years.join(', ')}`);
    for (const c of ['Kuching', 'Sibu', 'Miri', 'Bintulu']) {
      const hit = inc.districts[c];
      if (hit) { const l = hit[hit.length - 1]; console.log(`  ${c.padEnd(9)} ${l.year} median RM${l.median?.toLocaleString()} · mean RM${l.mean?.toLocaleString()}`); }
      else console.log(`  ${c.padEnd(9)} not present`);
    }
    console.log('  licence: UNCONFIRMED — git-ignored. Confirm before publishing or redistributing.');
  } catch (e) {
    console.error(`income fetch failed — ${e.message}`);
    console.error('The map can still be built from coordinates alone; the income layer simply stays absent.');
  }
}

console.log('\nNeither layer is a rent, a price or a transaction. No source consulted here');
console.log('carries neighbourhood-level rents or land costs for Sarawak.');
