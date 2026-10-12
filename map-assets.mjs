#!/usr/bin/env node
/**
 * THE KUCHING MAP'S OWN FILES, MADE ON A DEVELOPER'S MACHINE (12 Oct 2026).
 *
 *   node map-assets.mjs --tmp <folder> [--date YYYYMMDD] [--pmtiles <cli>] [--only step,step]
 *                                         make every file below; downloads go to <folder>
 *   node map-assets.mjs --check           no network: the committed files against
 *                                         data/map/manifest.json (build.mjs --check runs it too)
 *
 * Steps, in order: tiles, vendor, style, glyphs, sprites, osm, places, heights, manifest.
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The owner's decision of 12 Oct 2026: a map of Kuching whose every file is
 * this site's own. A visitor's browser asks this site for the map and nothing
 * else — no tile server, no font server, no account, no token. So everything
 * the map draws with is made here, once, by a developer, and committed:
 *
 *   data/tiles/kuching-<date>.pmtiles   one Protomaps-schema basemap extract of
 *                     Greater Kuching (bbox 110.18,1.35,110.48,1.66, z0–15),
 *                     taken with `pmtiles extract` from the Protomaps daily
 *                     build of <date> (OpenStreetMap data, ODbL). Named by the
 *                     build it came from: /data/ is cached for a year
 *                     (vercel.json), so a refresh must be a new name.
 *   vendor/maplibre-gl-<v>/            MapLibre GL JS (BSD-3), the three ESM
 *                     files and its stylesheet, byte for byte from npm, kept
 *                     together because the worker imports the shared file by a
 *                     relative path. Loaded only on the map page.
 *   vendor/pmtiles-<v>/                the PMTiles reader (BSD-3, with fflate,
 *                     MIT, inside it), the package's browser build.
 *   data/map/style-light.json, style-dark.json   the basemap's style, made with
 *                     @protomaps/basemaps (BSD-3) and tuned to the site's
 *                     palette; every address in it is a path on this site.
 *   data/map/basemaps-assets-<commit>/  the glyphs (Noto Sans, OFL) for the
 *                     three ranges the labels need and the sprites (v4 light
 *                     and dark), from protomaps/basemaps-assets at one commit.
 *   data/map/kuching-schemes.json      every Kuching residential scheme name in
 *                     NAPIC's H1 2025 extract, and where — if anywhere — an
 *                     OpenStreetMap name places it, with the evidence. Placed
 *                     only on an exact name or on lanes carrying the name; every
 *                     other scheme is "not placed", and none is guessed.
 *   data/map/kuching-heights.json      the buildings OpenStreetMap records a
 *                     height for (the tag, in metres), the only ones the map
 *                     raises when tilted. Nothing is estimated.
 *   data/map/manifest.json             what each file is, where it came from,
 *                     its bytes and its SHA-256.
 *
 * The review sheet of the schemes not placed — the weak matches, each with its
 * evidence — is written with --review <file> (it holds no figure and is the
 * owner's to read; it is not deployed).
 *
 * NOT DONE HERE, ON PURPOSE: no geocoder (Nominatim forbids systematic
 * queries, and Google's terms forbid copying coordinates), no Overture or
 * machine-learned footprints, no estimated heights, no price on any position.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };

/* ─── WHAT IS MADE, AND FROM WHAT ─────────────────────────────────────────── */
export const MAP_BBOX = [110.18, 1.35, 110.48, 1.66];
export const MAP_MAXZOOM = 15;
export const MAPLIBRE = '6.11.2';
export const PMTILES = '4.5.0';
export const BASEMAPS = '5.7.2';
export const ASSETS_COMMIT = '028c18f713baecad011301ff7a69acc39bcc2ae7';
export const MAP_DIR = 'data/map';
export const TILE_DIR = 'data/tiles';
export const ASSET_DIR = `${MAP_DIR}/basemaps-assets-${ASSETS_COMMIT.slice(0, 7)}`;
export const VENDOR_ML = `vendor/maplibre-gl-${MAPLIBRE}`;
export const VENDOR_PM = `vendor/pmtiles-${PMTILES}`;
export const GLYPH_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
/* The ranges the labels of the extract use from zoom 10 (the map's least
   zoom), measured by decoding every tile: Basic Latin and Latin-1, Latin
   Extended-A ("İ"), and General Punctuation („“). Chinese is drawn with the
   reader's own font (MapLibre's localIdeographFontFamily), so it needs none.
   One label (a café's name in mathematical bold letters, U+1D400…) is in no
   range the fonts carry, and its letters are not drawn. */
export const GLYPH_RANGES = ['0-255', '256-511', '8192-8447'];
export const SPRITES = ['light', 'light@2x', 'dark', 'dark@2x'];
export const STYLE_FILES = { light: `${MAP_DIR}/style-light.json`, dark: `${MAP_DIR}/style-dark.json` };
export const SCHEMES_FILE = `${MAP_DIR}/kuching-schemes.json`;
export const HEIGHTS_FILE = `${MAP_DIR}/kuching-heights.json`;
export const MANIFEST_FILE = `${MAP_DIR}/manifest.json`;
/* The most a tile file may weigh: Vercel's largest cacheable response. */
export const TILE_LIMIT = 10 * 1024 * 1024;
/* The vendored files, as npm ships them (dist/), and the licences beside them. */
export const VENDOR_FILES = [
  `${VENDOR_ML}/maplibre-gl.mjs`, `${VENDOR_ML}/maplibre-gl-shared.mjs`, `${VENDOR_ML}/maplibre-gl-worker.mjs`,
  `${VENDOR_ML}/maplibre-gl.css`, `${VENDOR_ML}/LICENSE.txt`,
  `${VENDOR_PM}/pmtiles.js`, `${VENDOR_PM}/LICENSE`, `${VENDOR_PM}/LICENSE-fflate`,
];
/* WHAT THE VENDORED CODE SAYS OF OTHER SITES, AND WHY NONE OF IT IS A
   REQUEST. Read off the files and reviewed (12 Oct 2026); a version that
   says anything else fails the check until it is read again:
   - the licence links in the files' header comments;
   - MapLibre's own link, which its attribution control and logo would draw
     (the page turns both off and draws its own attribution);
   - the address in its WebGL error message, which the page never shows (it
     catches the error and draws the locality diagram);
   - a placeholder origin it parses relative addresses against
     (maplibre.invalid, a name reserved never to resolve);
   - an issue link in a console warning;
   - the XML namespaces of SVG and XHTML;
   - pmtiles' own repository, in an error message. */
export const VENDOR_URLS = {
  [`${VENDOR_ML}/maplibre-gl.mjs`]: ['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg', `https://github.com/maplibre/maplibre-gl-js/blob/v${MAPLIBRE}/LICENSE.txt`,
    'https://maplibre.invalid/', 'https://maplibre.org/', 'https://wiki.openstreetmap.org/wiki/This_map_requires_WebGL'],
  [`${VENDOR_ML}/maplibre-gl-shared.mjs`]: ['https://github.com/mapbox/mapbox-gl-js/issues/2907', `https://github.com/maplibre/maplibre-gl-js/blob/v${MAPLIBRE}/LICENSE.txt`],
  [`${VENDOR_ML}/maplibre-gl-worker.mjs`]: [`https://github.com/maplibre/maplibre-gl-js/blob/v${MAPLIBRE}/LICENSE.txt`],
  [`${VENDOR_ML}/maplibre-gl.css`]: [],
  [`${VENDOR_PM}/pmtiles.js`]: ['https://github.com/protomaps/PMTiles/tree/main/js'],
};
export const urlsIn = (text) => [...new Set([...String(text).matchAll(/https?:\/\/[A-Za-z0-9.\-]+(?:\/[A-Za-z0-9._~\-/%?=&#:+]*)?/g)].map(m => m[0].replace(/[.,;:)]+$/, '')))].sort();

/* The site's palette (src/styles.css): the basemap is tuned to it, light and
   dark, so the map reads as the page's and not as a borrowed picture. */
const PALETTE = {
  light: { background: '#f1ede4', earth: '#f1ede4', water: '#c6d8dc', park_a: '#dfe6d4', park_b: '#d3dec6', wood_a: '#d9e2cf', wood_b: '#cfdac2',
    scrub_a: '#e1e5d3', scrub_b: '#d8dec8', buildings: '#e2dccf', school: '#ece5d6', hospital: '#efe2dc', industrial: '#e8e3d9', pedestrian: '#ede8de',
    minor_a: '#fbfaf6', minor_b: '#fbfaf6', minor_service: '#fbfaf6', other: '#f6f3ec', link: '#ffffff', major: '#ffffff', highway: '#ffffff',
    minor_casing: '#ddd6c8', minor_service_casing: '#e3ddd1', link_casing: '#d6cebe', major_casing_early: '#d6cebe', major_casing_late: '#d6cebe',
    highway_casing_early: '#cfc6b4', highway_casing_late: '#cfc6b4', boundaries: '#b8b0a0',
    roads_label_minor: '#6a6a61', roads_label_minor_halo: '#fbfaf6', roads_label_major: '#55574f', roads_label_major_halo: '#fbfaf6',
    subplace_label: '#55574f', subplace_label_halo: '#f1ede4', city_label: '#16191a', city_label_halo: '#f1ede4', ocean_label: '#4f6e75' },
  dark: { background: '#111413', earth: '#141816', water: '#0e1f24', park_a: '#17201a', park_b: '#19241c', wood_a: '#18211b', wood_b: '#1a251d',
    scrub_a: '#1a201b', scrub_b: '#1c231d', buildings: '#202624', school: '#1b1f1c', hospital: '#211c1b', industrial: '#1c1f1d', pedestrian: '#1b1f1d',
    minor_a: '#262c29', minor_b: '#262c29', minor_service: '#232825', other: '#232825', link: '#2e3531', major: '#323a36', highway: '#3a433e',
    minor_casing: '#141816', minor_service_casing: '#141816', link_casing: '#141816', major_casing_early: '#141816', major_casing_late: '#141816',
    highway_casing_early: '#141816', highway_casing_late: '#141816', boundaries: '#4a514c',
    roads_label_minor: '#94968c', roads_label_minor_halo: '#111413', roads_label_major: '#a9aa9f', roads_label_major_halo: '#111413',
    subplace_label: '#a9aa9f', subplace_label_halo: '#111413', city_label: '#f2f0ea', city_label_halo: '#111413', ocean_label: '#7f9ca3' },
};

/* ─── SMALL HELPERS ───────────────────────────────────────────────────────── */
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const abs = (rel) => join(ROOT, rel);
const put = (rel, body) => { mkdirSync(dirname(abs(rel)), { recursive: true }); writeFileSync(abs(rel), body); };
const json = (v) => JSON.stringify(v, null, 1) + '\n';
async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': 'quantum-tradeworks map-assets (developer build)' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return buf;
}
const npmPack = (tmp, spec) => {
  const dir = join(tmp, 'pack', spec.replace(/[^A-Za-z0-9.@-]+/g, '_'));
  if (!existsSync(join(dir, 'package'))) {
    mkdirSync(dir, { recursive: true });
    if (!/^[@A-Za-z0-9./_-]+@[0-9.]+$/.test(spec)) throw new Error(`npm pack: ${spec} is not a pinned package`);
    const tgz = execSync(`npm pack ${spec} --silent`, { cwd: dir, encoding: 'utf8' }).trim().split(/\r?\n/).pop();
    execFileSync('tar', ['-xzf', tgz], { cwd: dir });
  }
  return join(dir, 'package');
};
/* Metres between two [lon, lat] points (haversine). */
export const metres = (a, b) => {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const r5 = (v) => Math.round(v * 1e5) / 1e5;

/* ─── 1. TILES ────────────────────────────────────────────────────────────── */
function stepTiles({ tmp, date, cli }) {
  if (!cli || !existsSync(cli)) throw new Error('tiles: give --pmtiles <path to the pmtiles CLI> (github.com/protomaps/go-pmtiles releases)');
  const out = join(tmp, `kuching-${date}.pmtiles`);
  if (!existsSync(out)) execFileSync(cli, ['extract', `https://build.protomaps.com/${date}.pmtiles`, out, `--bbox=${MAP_BBOX.join(',')}`, `--maxzoom=${MAP_MAXZOOM}`], { stdio: 'inherit' });
  const show = execFileSync(cli, ['show', out], { encoding: 'utf8' });
  const rel = `${TILE_DIR}/kuching-${date}.pmtiles`;
  for (const f of existsSync(abs(TILE_DIR)) ? readdirSync(abs(TILE_DIR)) : []) if (`${TILE_DIR}/${f}` !== rel) rmSync(abs(`${TILE_DIR}/${f}`));
  mkdirSync(abs(TILE_DIR), { recursive: true });
  copyFileSync(out, abs(rel));
  const meta = (k) => (show.match(new RegExp(`^${k} (.*)$`, 'm')) || [])[1]?.trim() || null;
  return { file: rel, osmAsOf: meta('planetiler:osm:osmosisreplicationtime'), schema: meta('version'), build: date };
}

/* ─── 2. VENDOR ───────────────────────────────────────────────────────────── */
async function stepVendor({ tmp }) {
  const ml = npmPack(tmp, `maplibre-gl@${MAPLIBRE}`);
  for (const f of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) put(`${VENDOR_ML}/${f}`, readFileSync(join(ml, 'dist', f)));
  put(`${VENDOR_ML}/LICENSE.txt`, readFileSync(join(ml, 'LICENSE.txt')));
  const pm = npmPack(tmp, `pmtiles@${PMTILES}`);
  put(`${VENDOR_PM}/pmtiles.js`, readFileSync(join(pm, 'dist', 'pmtiles.js')));
  /* The npm package carries no licence file; the repository's, at the
     package's tag, and fflate's (bundled inside pmtiles.js), from its own
     package. */
  put(`${VENDOR_PM}/LICENSE`, await download('https://raw.githubusercontent.com/protomaps/PMTiles/main/LICENSE', join(tmp, 'pmtiles-LICENSE')));
  const fflateVersion = JSON.parse(readFileSync(join(pm, 'package.json'), 'utf8')).dependencies.fflate.replace(/^[^\d]*/, '');
  const ff = npmPack(tmp, `fflate@${fflateVersion}`);
  put(`${VENDOR_PM}/LICENSE-fflate`, readFileSync(join(ff, 'LICENSE')));
  return { maplibre: MAPLIBRE, pmtiles: PMTILES, fflate: fflateVersion };
}

/* ─── 3. STYLE ────────────────────────────────────────────────────────────── */
async function stepStyle({ tmp, tile }) {
  const bm = npmPack(tmp, `@protomaps/basemaps@${BASEMAPS}`);
  const { layers, namedFlavor } = await import(pathToFileURL(join(bm, 'dist', 'esm', 'index.js')).href);
  const out = {};
  for (const flavor of ['light', 'dark']) {
    const f = { ...namedFlavor(flavor), ...PALETTE[flavor] };
    const style = {
      version: 8,
      name: `Quantum Tradeworks — Kuching (${flavor})`,
      /* Paths on this site; the page makes each an address on its own origin
         as it loads the style (kmStyle, 92-kuching-map.js). */
      glyphs: `/${ASSET_DIR}/fonts/{fontstack}/{range}.pbf`,
      sprite: `/${ASSET_DIR}/sprites/v4/${flavor}`,
      sources: { protomaps: { type: 'vector', url: `pmtiles:///${tile}`, attribution: '© OpenStreetMap contributors' } },
      layers: layers('protomaps', f, { lang: 'en' }),
    };
    put(STYLE_FILES[flavor], JSON.stringify(style) + '\n');
    out[flavor] = STYLE_FILES[flavor];
  }
  /* The style is made by @protomaps/basemaps (BSD-3): its licence beside it. */
  put(`${MAP_DIR}/LICENSE-protomaps-basemaps.md`, await download('https://raw.githubusercontent.com/protomaps/basemaps/main/LICENSE.md', join(tmp, 'basemaps-LICENSE.md')));
  return { basemaps: BASEMAPS, files: out };
}

/* ─── 4. GLYPHS AND 5. SPRITES ────────────────────────────────────────────── */
async function stepGlyphs({ tmp }) {
  for (const stack of GLYPH_STACKS) for (const range of GLYPH_RANGES) {
    const src = `https://raw.githubusercontent.com/protomaps/basemaps-assets/${ASSETS_COMMIT}/fonts/${encodeURIComponent(stack)}/${range}.pbf`;
    put(`${ASSET_DIR}/fonts/${stack}/${range}.pbf`, await download(src, join(tmp, 'glyphs', stack, `${range}.pbf`)));
  }
  put(`${ASSET_DIR}/fonts/OFL.txt`, await download(`https://raw.githubusercontent.com/protomaps/basemaps-assets/${ASSETS_COMMIT}/fonts/OFL.txt`, join(tmp, 'glyphs', 'OFL.txt')));
}
async function stepSprites({ tmp }) {
  for (const s of SPRITES) for (const ext of ['.json', '.png'])
    put(`${ASSET_DIR}/sprites/v4/${s}${ext}`, await download(`https://raw.githubusercontent.com/protomaps/basemaps-assets/${ASSETS_COMMIT}/sprites/v4/${s}${ext}`, join(tmp, 'sprites', `${s}${ext}`)));
  /* The sprites' licence: basemaps-assets' README says they are derived from
     the MIT-licensed tangrams/icons, whose licence is kept beside them. */
  put(`${ASSET_DIR}/sprites/LICENSE-tangrams-icons.md`, await download('https://raw.githubusercontent.com/tangrams/icons/master/LICENSE.md', join(tmp, 'sprites', 'LICENSE.md')));
}

/* ─── 6. OSM: THE NAMES AND THE HEIGHTS, THREE QUERIES ───────────────────── */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const BB = `${MAP_BBOX[1]},${MAP_BBOX[0]},${MAP_BBOX[3]},${MAP_BBOX[2]}`;
const QUERIES = {
  names: `[out:json][timeout:300][bbox:${BB}];
(
  way["landuse"]["name"]; relation["landuse"]["name"];
  node["place"]["name"]; way["place"]["name"]; relation["place"]["name"];
  way["building"]["name"]; relation["building"]["name"]; node["building"]["name"];
  way["residential"]["name"]; node["landuse"]["name"];
  way["shop"="mall"]["name"]; node["shop"="mall"]["name"];
  node["name"~"^(Taman|RPR|Kampung|Kpg|Desa|Bandar|Residensi|Perumahan)",i];
  way["name"~"^(Taman|RPR|Kampung|Kpg|Desa|Bandar|Residensi|Perumahan)",i]["highway"!~"."];
);
out tags center bb;`,
  roads: `[out:json][timeout:300][bbox:${BB}];
way["highway"]["name"];
out tags center;`,
  heights: `[out:json][timeout:300][bbox:${BB}];
(
  way["building"]["height"]; relation["building"]["height"];
  way["building:part"]["height"]; relation["building:part"]["height"];
);
out tags geom;`,
};
async function stepOsm({ tmp }) {
  const out = {};
  for (const [k, q] of Object.entries(QUERIES)) {
    const file = join(tmp, 'osm', `${k}.json`);
    if (!existsSync(file)) {
      /* The public instances are busy; each is asked once, in turn, a pause
         between. */
      let body = null, said = [];
      for (const url of OVERPASS) {
        const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: q }),
          headers: { 'User-Agent': 'quantum-tradeworks map-assets (developer build, three queries)' } }).catch(e => ({ ok: false, status: e.message, text: async () => '' }));
        if (r.ok) { body = Buffer.from(await r.arrayBuffer()); break; }
        said.push(`${url} ${r.status}`);
        await new Promise(res => setTimeout(res, 10000));
      }
      if (!body) throw new Error(`overpass ${k}: ${said.join('; ')}`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
      await new Promise(res => setTimeout(res, 5000));
    }
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    out[k] = { elements: doc.elements, asOf: doc.osm3s?.timestamp_osm_base || null };
  }
  return out;
}

/* ─── 7. PLACES: EACH SCHEME, AND WHAT PLACES IT ──────────────────────────── */
/* The normal form a name is compared in: letters and digits, the common
   abbreviations written out, an apostrophe and a bracket dropped. It does
   not correct spelling — "Prsitana Garden" is not taken for "Pristana
   Garden": a name that matches only once corrected is a weak match, for the
   owner's review. */
export const normName = (s) => String(s || '').toLowerCase()
  .replace(/[’'`]/g, '')
  .replace(/\bjln\.?\b/g, 'jalan').replace(/\bkpg\.?\b/g, 'kampung').replace(/\bkg\.?\b/g, 'kampung')
  .replace(/\blrg\.?\b/g, 'lorong').replace(/\btmn\.?\b/g, 'taman')
  .replace(/\(.*?\)/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const PREFIX = /^(taman|rpr|perumahan|residensi|kampung|desa) /;
const SUFFIX = / (park|garden|gardens|estate|heights|height|residence|residences|apartment|apartments|condominium|condominiums|suites|commercial centre|commercial center)$/;
const coreName = (n) => n.replace(PREFIX, '').replace(SUFFIX, '').trim();
const kindOf = (t) => (t.building || t['building:part'] ? 'building'
  : t.shop === 'mall' ? 'mall'
  : t.landuse === 'residential' || t.residential ? 'residential area'
  : t.landuse ? `${t.landuse} land`
  : t.place ? t.place
  : t.highway ? 'road' : 'feature');
/* How a kind of OSM feature is drawn: a named area by its own extent, a
   place point as a neighbourhood, a building or a mall as the few hundred
   metres round it — never a pin on a house. */
const STRONG_KINDS = new Set(['residential area', 'neighbourhood', 'village', 'hamlet', 'locality', 'isolated_dwelling', 'building', 'mall']);
/* A name OpenStreetMap gives a whole suburb or town ("Petra Jaya") is the
   scheme's name, but a neighbourhood's mark on the suburb's point would say
   where in it the sample lies, which NAPIC does not: held for review. */
const BROAD_KINDS = new Set(['suburb', 'town', 'city', 'quarter', 'borough', 'district', 'county', 'municipality']);
/* What may stand round a scheme's name in a lane's name and leave it the
   scheme's lane: the road's own word before it ("Jalan", "Lorong"…), and
   after it only the lane's numbering ("6", "8A1", "2A4", "B") or a compass
   point ("Timur 1F", "West"). Anything else — "Jalan Taman Dusun Indah
   Sejijak", "Lorong Demak Sepakat Jaya 6B1D", and "Baru", "Hilir", "Hulu"
   or "Tengah", which name a new or an up- or downriver village of its own —
   names another place as well, and the lane is not counted. */
const ROAD_WORDS = new Set(['jalan', 'lorong', 'lrg', 'jln', 'bulatan', 'persiaran', 'lebuh', 'lebuhraya', 'lingkaran', 'laluan', 'simpang', 'road', 'lane', 'street', 'avenue', 'drive']);
const LANE_TAIL = /^(\d+[a-z0-9-]*|[a-z]\d+[a-z0-9-]*|[a-z]|utara|selatan|timur|barat|north|south|east|west)$/;
export function laneCarries(lane, phrase) {
  const i = (` ${lane} `).indexOf(` ${phrase} `);
  if (i < 0) return false;
  const before = lane.slice(0, i).trim(), after = lane.slice(i + phrase.length).trim();
  return before.split(' ').filter(Boolean).every(w => ROAD_WORDS.has(w)) && after.split(' ').filter(Boolean).every(w => LANE_TAIL.test(w))
    && (before !== '' || after !== '');
}
/* The localities the calculator lists for Kuching that a scheme may be opened
   on (data/sarawak-geo.json): not "Samarahan", which geocoded to the
   expressway corridor and is the one point the feasibility study found
   misplaced, and not Kota Samarahan, which is the Samarahan Division's —
   NAPIC files these schemes under Kuching. */
export const LAB_LOCALITIES = ['City centre', 'Tabuan', 'Stutong', 'Batu Kawa', 'Matang', 'Petra Jaya'];

function stepPlaces({ osm, date }) {
  const napic = JSON.parse(readFileSync(abs('data/napic-h1-2025.json'), 'utf8'));
  const geo = JSON.parse(readFileSync(abs('data/sarawak-geo.json'), 'utf8'));
  const locs = LAB_LOCALITIES.map(n => [n, geo.cities.kuching.areas[n]]).filter(([, a]) => a);
  const rows = napic.benchmarks.filter(r => r.division === 'Kuching');
  const names = [...new Set(rows.filter(r => r.subsector === 'RESIDENTIAL').map(r => r.scheme))];

  /* The OSM names, by normal form. */
  const feat = new Map();
  for (const e of osm.names.elements) {
    const t = e.tags || {};
    /* "out bb" gives a way or a relation its bounds; its middle is the
       middle of those. */
    const b = e.bounds ? [[e.bounds.minlon, e.bounds.minlat], [e.bounds.maxlon, e.bounds.maxlat]] : null;
    const c = e.type === 'node' ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2] : null;
    if (!c) continue;
    for (const k of ['name', 'name:en', 'name:ms', 'official_name', 'alt_name']) {
      if (!t[k]) continue;
      const key = normName(t[k]);
      if (!feat.has(key)) feat.set(key, []);
      feat.get(key).push({ osm: `${e.type}/${e.id}`, name: t[k], tag: k, kind: kindOf(t), centre: c, bounds: b });
    }
  }
  const lanes = new Map();
  for (const e of osm.roads.elements) {
    const t = e.tags || {};
    if (!t.name || !e.center) continue;
    const key = normName(t.name);
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key).push({ osm: `way/${e.id}`, name: t.name, centre: [e.center.lon, e.center.lat] });
  }
  const laneKeys = [...lanes.keys()];
  const near = (c) => {
    const d = locs.map(([n, a]) => [n, metres(c, [a.lon, a.lat])]).sort((x, y) => x[1] - y[1])[0];
    return { name: d[0], km: Math.round(d[1] / 100) / 10 };
  };
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

  const out = [];
  for (const scheme of names) {
    const n = normName(scheme);
    const mine = rows.filter(r => r.scheme === scheme);
    const counts = {
      residential: mine.filter(r => r.subsector === 'RESIDENTIAL').length,
      other: mine.filter(r => r.subsector !== 'RESIDENTIAL').length,
    };
    const rec = { scheme, napicRows: counts };
    const cands = [];
    if (/^\d+(st|nd|rd|th) floor$/.test(n)) {
      out.push({ ...rec, status: 'not-a-place', why: 'Not a place: an extraction label from NAPIC’s rental table (a floor of a building), not a scheme name.' });
      continue;
    }
    /* Two NAPIC schemes that are one name once a bracket is dropped —
       "Taman Sri Makmur (Matang Batu 6)" and "Taman Sri Makmur (RPR Batu 6)" —
       may be two phases in two places: which is where is the owner's call. */
    const twins = names.filter(x => x !== scheme && normName(x) === n);
    if (twins.length) cands.push(`NAPIC lists ${twins.map(x => `“${x}”`).join(', ')} too, the same name once case, apostrophes and brackets are set aside — which is where?`);
    /* A: an OSM feature with the very name. */
    const exact = twins.length ? [] : (feat.get(n) || []).filter(f => f.tag !== 'alt_name');
    if (twins.length && (feat.get(n) || []).length) { const f = feat.get(n)[0]; cands.push(`OpenStreetMap names a ${f.kind} “${f.name}” (${f.osm})`); }
    const strong = exact.filter(f => STRONG_KINDS.has(f.kind));
    if (strong.length) {
      /* One feature, or several within a kilometre of the best: one place. */
      const rank = (f) => (f.kind === 'residential area' ? 0 : f.kind === 'building' || f.kind === 'mall' ? 1 : 2);
      const best = [...strong].sort((a, b) => rank(a) - rank(b))[0];
      const far = strong.filter(f => metres(f.centre, best.centre) > 1000);
      if (!far.length) {
        const radius = best.bounds ? Math.min(600, Math.max(150, Math.round(metres(best.bounds[0], best.bounds[1]) / 2 / 10) * 10))
          : best.kind === 'building' || best.kind === 'mall' ? 150 : 300;
        out.push({ ...rec, status: 'placed', method: 'osm-named', confidence: 'named-feature',
          centre: best.centre.map(r5), radius,
          evidence: { osm: strong.slice(0, 4).map(f => ({ id: f.osm, name: f.name, kind: f.kind })),
            said: `OpenStreetMap names a ${best.kind} “${best.name}” (${best.osm})${strong.length > 1 ? `, and ${strong.length - 1} more feature${strong.length > 2 ? 's' : ''} of that name within 1 km` : ''}.` },
          nearest: near(best.centre) });
        continue;
      }
      cands.push(`${strong.length} OpenStreetMap features named “${strong[0].name}”, ${Math.round(metres(far[0].centre, best.centre) / 100) / 10} km apart (${strong.slice(0, 3).map(f => `${f.kind} ${f.osm}`).join('; ')}) — which one is the scheme?`);
    } else if (exact.some(f => BROAD_KINDS.has(f.kind))) {
      const f = exact.find(x => BROAD_KINDS.has(x.kind));
      cands.push(`OpenStreetMap names a whole ${f.kind} “${f.name}” (${f.osm}) — the sample could lie anywhere in it; a neighbourhood’s mark would say more than NAPIC does`);
    } else if (exact.length) {
      cands.push(`OpenStreetMap names a ${exact[0].kind} “${exact[0].name}” (${exact[0].osm}) — a ${exact[0].kind}, not a housing area`);
    }
    /* The scheme is itself a street. */
    if (lanes.has(n) && /^(jalan|lorong) /.test(n)) {
      const ls = lanes.get(n);
      out.push({ ...rec, status: 'not-placed', reason: 'street',
        why: 'The scheme is named after a street. A street is a line, often kilometres long; a neighbourhood mark on it would claim more than the name says.',
        review: [`${ls.length} OpenStreetMap way${ls.length === 1 ? '' : 's'} named “${ls[0].name}” (${ls.slice(0, 3).map(l => l.osm).join(', ')})`, ...cands] });
      continue;
    }
    /* B: lanes carrying the scheme's name. The full name in a lane's name
       ("Lorong Taman Yen Yen 1C") is enough on one lane; the name without its
       Taman/RPR prefix, of two words or more ("Sri Wangi" in "Lorong Sri
       Wangi 3"), takes two lanes or more — a family of lanes is a scheme's
       numbering, one lane is only a name. And the lanes must lie together:
       all within 1.5 km of their middle, or which of them is the scheme is
       not known. */
    const words = n.split(' ').length;
    const stripped = n.replace(PREFIX, '');
    const coreOk = stripped !== n && stripped.split(' ').length >= 2;
    const fullHits = !twins.length && words >= 2 ? laneKeys.filter(k => k !== n && laneCarries(k, n)) : [];
    const coreHits = !twins.length && coreOk ? laneKeys.filter(k => k !== n && !fullHits.includes(k) && laneCarries(k, stripped)) : [];
    const hits = fullHits.length ? fullHits : coreHits.length >= 2 ? coreHits : [];
    /* Lanes that carry the name with another place's word round it: said,
       for the review, never counted. */
    const dirty = hits.length ? [] : laneKeys.filter(k => k !== n && (words >= 2 && (` ${k} `).includes(` ${n} `) || coreOk && (` ${k} `).includes(` ${stripped} `)));
    if (dirty.length) cands.push(`lanes carry the name with another place’s word beside it: ${dirty.slice(0, 3).map(k => `“${lanes.get(k)[0].name}” (${lanes.get(k)[0].osm})`).join(', ')}`);
    if (hits.length) {
      const ls = hits.flatMap(k => lanes.get(k));
      const c = [median(ls.map(l => l.centre[0])), median(ls.map(l => l.centre[1]))];
      const spread = Math.max(...ls.map(l => metres(l.centre, c)));
      if (spread <= 1500) {
        out.push({ ...rec, status: 'placed', method: 'osm-lanes', confidence: 'lanes-named',
          centre: c.map(r5), radius: Math.min(800, Math.max(300, Math.round((spread + 100) / 10) * 10)),
          evidence: { osm: ls.slice(0, 6).map(l => ({ id: l.osm, name: l.name, kind: 'road' })), lanes: ls.length,
            said: `${ls.length} OpenStreetMap lane${ls.length === 1 ? '' : 's'} carr${ls.length === 1 ? 'ies' : 'y'} the scheme’s name (${[...new Set(ls.map(l => l.name))].slice(0, 3).map(x => `“${x}”`).join(', ')}${new Set(ls.map(l => l.name)).size > 3 ? ' …' : ''}); ${ls.length === 1 ? 'the mark is the middle of that lane.' : `the mark is the middle of those lanes, ${Math.round(spread)} m to the farthest.`}` },
          nearest: near(c) });
        continue;
      }
      cands.push(`${ls.length} lanes carry the name, but ${Math.round(spread / 100) / 10} km apart (${[...new Set(ls.map(l => l.name))].slice(0, 4).join('; ')}) — more than one place?`);
    } else if (coreHits.length === 1) {
      const l = lanes.get(coreHits[0])[0];
      cands.push(`one lane only carries “${stripped}”: “${l.name}” (${l.osm}) — a lane named so is not yet a scheme`);
    }
    /* C: what only overlaps. */
    const c = coreName(n);
    if (c.length >= 4) {
      for (const [k, fs] of feat) {
        if (k === n || cands.length >= 4) continue;
        if (coreName(k) === c) cands.push(`OpenStreetMap ${fs[0].kind} “${fs[0].name}” (${fs[0].osm}) shares the core name “${c}”`);
      }
      if (c.length >= 5 && cands.length < 4) {
        const k = laneKeys.find(x => x.includes(c));
        if (k) cands.push(`a road carries “${c}”: “${lanes.get(k)[0].name}” (${lanes.get(k)[0].osm})`);
      }
    }
    out.push({ ...rec, status: 'not-placed', reason: cands.length ? 'weak' : 'none',
      why: cands.length ? 'Only a partial or ambiguous match in OpenStreetMap; held for review rather than guessed.'
        : 'No OpenStreetMap name matches it. Placing it would need a source this map does not have.',
      ...(cands.length ? { review: cands.slice(0, 4) } : {}) });
  }
  out.sort((a, b) => (a.status === b.status ? a.scheme.localeCompare(b.scheme) : a.status === 'placed' ? -1 : b.status === 'placed' ? 1 : a.status.localeCompare(b.status)));
  const tally = out.reduce((t, x) => { const k = x.status === 'not-placed' ? `not-placed:${x.reason}` : x.status; t[k] = (t[k] || 0) + 1; return t; }, {});
  const doc = {
    format: 'quantum-tradeworks/kuching-schemes', version: 1,
    division: 'Kuching', period: napic.period.code,
    osm: { source: 'OpenStreetMap via the Overpass API', asOf: [osm.names.asOf, osm.roads.asOf].sort()[0], namesAsOf: osm.names.asOf, lanesAsOf: osm.roads.asOf,
      licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' },
    made: date, method: 'An exact match of the scheme’s name with a named OpenStreetMap feature, or lanes carrying its name; nothing else is placed. Positions are neighbourhoods drawn round the evidence, never a building.',
    localities: LAB_LOCALITIES,
    tally, schemes: out,
  };
  put(SCHEMES_FILE, '{\n' + Object.entries(doc).map(([k, v]) => `  ${JSON.stringify(k)}: ${k === 'schemes'
    ? `[\n${v.map(r => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]` : JSON.stringify(v)}`).join(',\n') + '\n}\n');
  return { tally, total: out.length };
}

/* ─── 8. HEIGHTS: ONLY WHAT OSM RECORDS ───────────────────────────────────── */
/* "45", "45 m", "45m", "45.5": metres. A height in feet is converted, being a
   recorded height in another unit; anything else is left out, as unknown. */
export const heightMetres = (v) => {
  const s = String(v || '').trim().toLowerCase();
  let m = /^(\d+(?:\.\d+)?)\s*(m|metres|meters)?$/.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*(ft|feet|')$/.exec(s);
  if (m) return Math.round(Number(m[1]) * 0.3048 * 10) / 10;
  return null;
};
function stepHeights({ osm }) {
  const feats = [];
  let skipped = 0;
  for (const e of osm.heights.elements) {
    const t = e.tags || {};
    const h = heightMetres(t.height);
    const minH = t.min_height != null ? heightMetres(t.min_height) : 0;
    if (h == null || !(h > 0) || minH == null) { skipped++; continue; }
    let rings = [];
    if (e.type === 'way' && e.geometry) rings = [e.geometry.map(p => [r5(p.lon), r5(p.lat)])];
    else if (e.type === 'relation' && e.members) rings = e.members.filter(m => m.role === 'outer' && m.geometry).map(m => m.geometry.map(p => [r5(p.lon), r5(p.lat)]));
    rings = rings.filter(r => r.length >= 4);
    if (!rings.length) { skipped++; continue; }
    for (const r of rings) if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0]);
    feats.push({ type: 'Feature', properties: { osm: `${e.type}/${e.id}`, height: h, base: minH || 0, tag: String(t.height) },
      geometry: rings.length === 1 ? { type: 'Polygon', coordinates: rings } : { type: 'MultiPolygon', coordinates: rings.map(r => [r]) } });
  }
  const doc = { type: 'FeatureCollection', name: 'kuching-heights',
    osm: { asOf: osm.heights.asOf, licence: 'ODbL 1.0', attribution: '© OpenStreetMap contributors' },
    said: 'Every building in the Greater Kuching box that OpenStreetMap records a height for (its height tag, in metres). No height is estimated: a building without the tag is drawn flat.',
    features: feats };
  put(HEIGHTS_FILE, JSON.stringify(doc) + '\n');
  return { buildings: feats.length, skipped };
}

/* ─── 9. MANIFEST ─────────────────────────────────────────────────────────── */
export function mapFiles(root = ROOT) {
  const under = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir), { withFileTypes: true })
    .flatMap(d => (d.isDirectory() ? under(`${dir}/${d.name}`) : [`${dir}/${d.name}`])) : []);
  return [...under(TILE_DIR), ...under(MAP_DIR).filter(f => f !== MANIFEST_FILE), ...under('vendor')].sort();
}
function stepManifest(info) {
  const old = existsSync(abs(MANIFEST_FILE)) ? JSON.parse(readFileSync(abs(MANIFEST_FILE), 'utf8')) : {};
  const files = Object.fromEntries(mapFiles().map(f => { const b = readFileSync(abs(f)); return [f, { bytes: b.length, sha256: sha256(b) }]; }));
  const tile = Object.keys(files).find(f => f.startsWith(`${TILE_DIR}/`));
  const doc = {
    format: 'quantum-tradeworks/map-manifest', version: 1,
    tiles: { file: tile, bbox: MAP_BBOX, maxzoom: MAP_MAXZOOM, source: 'Protomaps daily build (OpenStreetMap)', ...(info.tiles || old.tiles || {}), file: tile },
    libraries: { 'maplibre-gl': MAPLIBRE, pmtiles: PMTILES, '@protomaps/basemaps': BASEMAPS, ...(info.vendor ? { fflate: info.vendor.fflate } : old.libraries?.fflate ? { fflate: old.libraries.fflate } : {}) },
    assets: { repository: 'protomaps/basemaps-assets', commit: ASSETS_COMMIT, glyphStacks: GLYPH_STACKS, glyphRanges: GLYPH_RANGES, sprites: SPRITES },
    licences: {
      'OpenStreetMap data (tiles, scheme positions, heights)': 'ODbL 1.0 — © OpenStreetMap contributors',
      'MapLibre GL JS': 'BSD-3-Clause', pmtiles: 'BSD-3-Clause', fflate: 'MIT', '@protomaps/basemaps (the style)': 'BSD-3-Clause',
      'Noto Sans glyphs': 'SIL Open Font License 1.1', 'Protomaps sprites': 'MIT (derived from tangrams/icons, per basemaps-assets)',
    },
    vendorUrls: VENDOR_URLS,
    files,
  };
  put(MANIFEST_FILE, json(doc));
  return doc;
}

/* ─── THE CHECK (no network) ──────────────────────────────────────────────── */
/* Each problem a sentence. build.mjs --check runs it (mapAssetProblems). */
export function mapAssetProblems(root = ROOT) {
  const out = [];
  const at = (f) => join(root, f);
  if (!existsSync(at(MANIFEST_FILE))) return [`${MANIFEST_FILE} is missing — run node map-assets.mjs`];
  const man = JSON.parse(readFileSync(at(MANIFEST_FILE), 'utf8'));
  const listed = Object.keys(man.files || {}).sort();
  const there = mapFiles(root);
  for (const f of there) if (!listed.includes(f)) out.push(`${f} is not in ${MANIFEST_FILE} — a map file nobody recorded`);
  for (const f of listed) {
    if (!existsSync(at(f))) { out.push(`${f} is in ${MANIFEST_FILE} and missing`); continue; }
    const b = readFileSync(at(f));
    if (sha256(b) !== man.files[f].sha256) out.push(`${f} is not the file ${MANIFEST_FILE} records (SHA-256 ${sha256(b).slice(0, 12)}, recorded ${man.files[f].sha256.slice(0, 12)}): a file changed under the same name, which a year-long cache would never fetch again`);
  }
  /* One tile file, named by the build it came from, under the limit. */
  const tiles = there.filter(f => f.startsWith(`${TILE_DIR}/`));
  if (tiles.length !== 1) out.push(`${TILE_DIR}/ holds ${tiles.length} files, not the one tile file`);
  for (const f of tiles) {
    if (!/^data\/tiles\/kuching-\d{8}\.pmtiles$/.test(f)) out.push(`${f} is not named kuching-<YYYYMMDD>.pmtiles, after the build it came from`);
    const size = statSync(at(f)).size;
    if (size >= TILE_LIMIT) out.push(`${f} is ${(size / 1048576).toFixed(1)}MB, at or over the 10MB Vercel caches`);
    if (man.tiles?.file !== f) out.push(`${MANIFEST_FILE} names ${man.tiles?.file} as the tile file, not ${f}`);
  }
  for (const f of VENDOR_FILES) if (!existsSync(at(f))) out.push(`${f} is missing — run node map-assets.mjs --only vendor`);
  /* The vendored code says no other site's address it was not reviewed for. */
  for (const [f, allowed] of Object.entries(VENDOR_URLS)) {
    if (!existsSync(at(f))) continue;
    const said = urlsIn(readFileSync(at(f), 'utf8'));
    const extra = said.filter(u => !allowed.includes(u));
    if (extra.length) out.push(`${f} names ${extra.join(', ')}, which was not reviewed (VENDOR_URLS, map-assets.mjs)`);
  }
  /* The style: every address a path on this site, the files it names there. */
  for (const [flavor, f] of Object.entries(STYLE_FILES)) {
    if (!existsSync(at(f))) { out.push(`${f} is missing`); continue; }
    out.push(...styleProblems(JSON.parse(readFileSync(at(f), 'utf8')), { root, label: f, tile: tiles[0], flavor }));
  }
  out.push(...schemeProblems(root));
  return out;
}
/* A style's addresses: glyphs, sprite and each source's, and any string in
   it that looks like one. Same-origin means a path from the site's root
   ("/data/…") or the pmtiles protocol on such a path — never "//host" or a
   scheme of its own. */
export function styleAddresses(style) {
  const out = [];
  if (style.glyphs) out.push(['glyphs', style.glyphs]);
  for (const s of [].concat(style.sprite || [])) out.push(['sprite', typeof s === 'string' ? s : s.url]);
  for (const [k, src] of Object.entries(style.sources || {})) {
    if (src.url) out.push([`source ${k}`, src.url]);
    for (const t of src.tiles || []) out.push([`source ${k} tile`, t]);
    if (typeof src.data === 'string') out.push([`source ${k} data`, src.data]);
  }
  return out;
}
export const sameOrigin = (u) => /^\/(?!\/)/.test(u) || /^pmtiles:\/\/\/(?!\/)/.test(u);
export function styleProblems(style, { root = ROOT, label = 'the style', tile = null, flavor = null } = {}) {
  const out = [];
  const addrs = styleAddresses(style);
  for (const [what, u] of addrs) if (!sameOrigin(u)) out.push(`${label}: its ${what} is ${u}, not a path on this site`);
  const text = JSON.stringify(style);
  const off = urlsIn(text);
  if (off.length) out.push(`${label} names another site: ${off.join(', ')}`);
  if (/mapbox:\/\//.test(text)) out.push(`${label} names a mapbox:// address`);
  if (!style.glyphs || !style.sprite) out.push(`${label} has no glyphs or no sprite`);
  else if (root) {
    const g = style.glyphs.replace(/^\//, '');
    for (const stack of GLYPH_STACKS) for (const range of GLYPH_RANGES) {
      const f = g.replace('{fontstack}', stack).replace('{range}', range);
      if (!existsSync(join(root, f))) out.push(`${label}: its glyphs ${f} are not on this site`);
    }
    const used = [...new Set(style.layers.flatMap(l => (l.layout?.['text-font'] ? JSON.stringify(l.layout['text-font']).match(/Noto Sans [A-Za-z]+/g) || [] : [])))];
    for (const u of used) if (!GLYPH_STACKS.includes(u)) out.push(`${label}: a layer draws with ${u}, whose glyphs are not shipped`);
    const sp = String(style.sprite).replace(/^\//, '');
    for (const ext of ['.json', '.png', '@2x.json', '@2x.png']) if (!existsSync(join(root, `${sp}${ext}`))) out.push(`${label}: its sprite ${sp}${ext} is not on this site`);
    if (flavor && !sp.endsWith(`/${flavor}`)) out.push(`${label}: the ${flavor} style draws with the ${sp.split('/').pop()} sprites`);
  }
  if (tile && style.sources?.protomaps?.url !== `pmtiles:///${tile}`) out.push(`${label}: its tiles are ${style.sources?.protomaps?.url}, not pmtiles:///${tile}`);
  return out;
}
/* Every placed scheme carries its method, its confidence and its evidence;
   every scheme not placed says why; no record holds a figure. */
export const PLACEMENT_CONFIDENCE = ['named-feature', 'lanes-named'];
export function schemeProblems(root = ROOT) {
  const out = [];
  const f = join(root, SCHEMES_FILE);
  if (!existsSync(f)) return [`${SCHEMES_FILE} is missing`];
  const doc = JSON.parse(readFileSync(f, 'utf8'));
  const napic = JSON.parse(readFileSync(join(root, 'data/napic-h1-2025.json'), 'utf8'));
  const res = new Set(napic.benchmarks.filter(r => r.division === 'Kuching' && r.subsector === 'RESIDENTIAL').map(r => r.scheme));
  const seen = new Set();
  for (const s of doc.schemes || []) {
    if (seen.has(s.scheme)) out.push(`${SCHEMES_FILE}: ${s.scheme} twice`);
    seen.add(s.scheme);
    if (!res.has(s.scheme)) out.push(`${SCHEMES_FILE}: “${s.scheme}” is not a Kuching residential scheme name in NAPIC’s extract`);
    if (s.status === 'placed') {
      if (!['osm-named', 'osm-lanes'].includes(s.method)) out.push(`${SCHEMES_FILE}: ${s.scheme} is placed by ${s.method}, which is not a method this map uses`);
      if (!PLACEMENT_CONFIDENCE.includes(s.confidence)) out.push(`${SCHEMES_FILE}: ${s.scheme} carries no placement confidence`);
      if (!s.evidence?.said || !(s.evidence.osm || []).length || s.evidence.osm.some(o => !/^(node|way|relation)\/\d+$/.test(o.id))) out.push(`${SCHEMES_FILE}: ${s.scheme} is placed without its evidence (an OpenStreetMap object and what it says)`);
      const [lon, lat] = s.centre || [];
      if (!(lon >= MAP_BBOX[0] && lon <= MAP_BBOX[2] && lat >= MAP_BBOX[1] && lat <= MAP_BBOX[3])) out.push(`${SCHEMES_FILE}: ${s.scheme} is placed outside the map's box`);
      if (!(s.radius >= 150 && s.radius <= 800)) out.push(`${SCHEMES_FILE}: ${s.scheme} is drawn ${s.radius} m round — a neighbourhood is 150–800 m`);
      if (!doc.localities.includes(s.nearest?.name)) out.push(`${SCHEMES_FILE}: ${s.scheme}'s nearest locality ${s.nearest?.name} is not one the Lab may be opened on`);
    } else if (!['not-placed', 'not-a-place'].includes(s.status) || !s.why) out.push(`${SCHEMES_FILE}: ${s.scheme} is ${s.status} and says no why`);
    const figure = JSON.stringify({ ...s, napicRows: undefined }).match(/RM\s?\d|\d{2,3},\d{3}/);
    if (figure) out.push(`${SCHEMES_FILE}: ${s.scheme}'s record holds a figure (“${figure[0]}”) — the map holds positions only`);
  }
  for (const n of res) if (!seen.has(n)) out.push(`${SCHEMES_FILE} does not list the scheme “${n}” — every Kuching residential scheme is listed, placed or not`);
  return out;
}

/* ─── THE REVIEW SHEET ────────────────────────────────────────────────────── */
function reviewSheet(file) {
  const doc = JSON.parse(readFileSync(abs(SCHEMES_FILE), 'utf8'));
  const t = doc.tally;
  const placed = doc.schemes.filter(s => s.status === 'placed');
  const weak = doc.schemes.filter(s => s.status === 'not-placed' && s.reason === 'weak');
  const street = doc.schemes.filter(s => s.status === 'not-placed' && s.reason === 'street');
  const none = doc.schemes.filter(s => s.status === 'not-placed' && s.reason === 'none');
  const np = doc.schemes.filter(s => s.status === 'not-a-place');
  const lines = [
    `# Kuching scheme map — placement review sheet (${doc.made})`, '',
    `For the owner to review later. Source: \`${SCHEMES_FILE}\` (generated by \`node map-assets.mjs\`), NAPIC ${doc.period}, OpenStreetMap as of ${doc.osm.asOf}.`, '',
    `Kuching residential scheme names in NAPIC's extract: **${doc.schemes.length}**. Placed on the map: **${placed.length}** (named feature ${placed.filter(s => s.method === 'osm-named').length}, lanes ${placed.filter(s => s.method === 'osm-lanes').length}). Not placed: weak or ambiguous **${weak.length}**, the scheme is a street **${street.length}**, no OpenStreetMap match **${none.length}**, not a place **${np.length}**.`, '',
    'How to use it: for each weak match below, say "place it at <OSM object>" (with the reason), or "leave it unplaced". Nothing here is placed until you say so; the map shows only the placed list. No figure is in this sheet.', '',
    '## 1. Weak or ambiguous matches — not placed, your call', '',
    '| # | NAPIC scheme | NAPIC rows | What OpenStreetMap has | Decision |', '|---|---|---|---|---|',
    ...weak.map((s, i) => `| ${i + 1} | ${s.scheme} | ${s.napicRows.residential} residential${s.napicRows.other ? ` + ${s.napicRows.other} other` : ''} | ${(s.review || []).join('<br>')} | |`), '',
    '## 2. Schemes named after a street — not placed', '',
    '| # | NAPIC scheme | What OpenStreetMap has | Decision |', '|---|---|---|---|',
    ...street.map((s, i) => `| ${i + 1} | ${s.scheme} | ${(s.review || []).join('<br>')} | |`), '',
    '## 3. Placed — for a spot check', '',
    '| # | NAPIC scheme | Method | Evidence | Drawn | Lab locality |', '|---|---|---|---|---|---|',
    ...placed.map((s, i) => `| ${i + 1} | ${s.scheme} | ${s.method === 'osm-named' ? 'named feature' : 'lanes carry the name'} | ${s.evidence.said} | ${s.radius} m round ${s.centre[1]}, ${s.centre[0]} | ${s.nearest.name} (${s.nearest.km} km) |`), '',
    '## 4. No OpenStreetMap match — not placed', '',
    none.map(s => s.scheme).join(' · '), '',
    '## 5. Not a place', '',
    np.map(s => `${s.scheme} — ${s.why}`).join('<br>'), '',
  ];
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join('\n'));
}

/* ─── RUN ─────────────────────────────────────────────────────────────────── */
async function main() {
  if (argv.includes('--check')) {
    const p = mapAssetProblems();
    if (p.length) { p.forEach(x => console.error(`FAIL  ${x}`)); process.exit(1); }
    const man = JSON.parse(readFileSync(abs(MANIFEST_FILE), 'utf8'));
    console.log(`ok    ${Object.keys(man.files).length} map files match ${MANIFEST_FILE}; one tile file (${man.tiles.file}); the styles' addresses are this site's; every placed scheme carries its evidence`);
    return;
  }
  if (argv.includes('--review')) { reviewSheet(resolve(flag('review'))); console.log(`wrote ${flag('review')}`); return; }
  const tmp = flag('tmp');
  if (!tmp) { console.error('give --tmp <folder> for the downloads (it is not part of the repository)'); process.exit(2); }
  const date = flag('date') || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const only = (flag('only') || 'tiles,vendor,style,glyphs,sprites,osm,places,heights,manifest').split(',');
  const info = {};
  let osm = null;
  const tile = () => mapFiles().find(f => f.startsWith(`${TILE_DIR}/`));
  if (only.includes('tiles')) { info.tiles = stepTiles({ tmp, date, cli: flag('pmtiles') }); console.log('tiles', info.tiles); }
  if (only.includes('vendor')) { info.vendor = await stepVendor({ tmp }); console.log('vendor', info.vendor); }
  if (only.includes('style')) { info.style = await stepStyle({ tmp, tile: tile() }); console.log('style', info.style); }
  if (only.includes('glyphs')) { await stepGlyphs({ tmp }); console.log('glyphs', GLYPH_STACKS.length * GLYPH_RANGES.length); }
  if (only.includes('sprites')) { await stepSprites({ tmp }); console.log('sprites', SPRITES.length * 2); }
  if (only.some(s => ['osm', 'places', 'heights'].includes(s))) osm = await stepOsm({ tmp });
  if (only.includes('places')) { info.places = stepPlaces({ osm, date }); console.log('places', info.places); }
  if (only.includes('heights')) { info.heights = stepHeights({ osm }); console.log('heights', info.heights); }
  if (only.includes('manifest')) { const m = stepManifest(info); console.log('manifest', Object.keys(m.files).length, 'files'); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
