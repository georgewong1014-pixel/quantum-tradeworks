/* ==========================================================================
   THE KUCHING SCHEME MAP — /property/areas/map (the owner's decision of
   12 Oct 2026; the feasibility study of 3 Oct, kuching-map-feasibility.md)
   --------------------------------------------------------------------------
   A second view of the area screen: Greater Kuching on a map drawn from this
   site's own files, and on it the NAPIC housing schemes OpenStreetMap lets
   us place. What it is, and what it refuses to be:

   EVERY FILE IS THIS SITE'S. The basemap is one Protomaps extract of Greater
   Kuching (data/tiles/kuching-<date>.pmtiles, OpenStreetMap data), read in
   byte ranges; the style, the glyphs and the sprites are under data/map/;
   MapLibre GL JS and the pmtiles reader are vendored under vendor/ and
   loaded by this page only, when the map is drawn (map-assets.mjs makes and
   records all of them). A reader's browser asks this site for the map and
   nothing else: the policy it is served with (vercel.json) adds only
   worker-src 'self' and blob: images, and connect-src stays 'self'.

   POSITIONS, NEVER PRICES. A scheme is placed only on an exact OpenStreetMap
   name — a residential area, a place or a building named as NAPIC names
   the scheme — or on lanes carrying its name, and it is drawn at the scale
   of that evidence: a neighbourhood round the named area or the lanes,
   never a pin on a house. Each placed scheme says how it was placed (its
   confidence) and on what (its evidence). Nothing on the map carries a
   figure: NAPIC's observed ranges stay in the list, under each scheme,
   where a single observation says it is one ("1 observation in NAPIC's
   H1 2025 sample") — D7's rule until JPPH answers. A scheme with only a
   partial match, or none, is listed as not placed, with its figures, and
   none is guessed (the owner reviews the weak ones from a sheet).

   2D FIRST. Tilting raises only the buildings OpenStreetMap records a
   height for (data/map/kuching-heights.json); every other building is
   drawn flat, and the legend says flat does not mean single-storey.

   THE LIST IS THE PRIMARY PATH. The map is a canvas a screen reader cannot
   read and a keyboard can only pan, so the list beside it carries every
   scheme — its position, its evidence, its figures — with "Show on the
   map" and, for a placed scheme, "Open the Scenario Lab" on the listed
   Kuching locality nearest it: a what-if of the Lab's column, nothing
   written until Save (labOpen, 82-property-lab.js).

   THE FALLBACK IS THE LOCALITY DIAGRAM (cityMap, 70-property.js): drawn
   where the browser offers no WebGL2 (or only a software renderer), and
   where the reader asks their device for reduced motion or reduced data —
   with a button to draw the interactive map all the same.

   SERVED AS DRAWN. The page is served as its first draw (prerender.mjs):
   the map's box, its attribution, the legend, the panel and the list. The
   map is drawn into the box after the script — the box keeps its height
   (styles.css, kuching-map), and what it says while it loads is the tab's,
   now (data-now). NAPIC's figures arrive with the division's file and are
   drawn under each scheme then; they are never in the served page.
   ========================================================================== */
/* What the build stamps in (build.mjs, kuchingMapData): the schemes and
   where each is placed, from data/map/kuching-schemes.json, and the map's
   files by their addresses on this site. */
const KM_DATA = /*@INJECT:kuchingMap*/ null;

const KM_CONF = {
  'named-feature': { label: 'Named in OpenStreetMap', dash: false,
    said: 'OpenStreetMap names a residential area, a place or a building as NAPIC names the scheme; it is drawn round that.' },
  'lanes-named': { label: 'Its lanes carry the name', dash: true,
    said: 'OpenStreetMap lanes carry the scheme’s name; it is drawn round the middle of those lanes.' },
};
const KM_NOT = {
  weak: { label: 'Not placed — a partial or ambiguous match', said: 'Only a partial or ambiguous match in OpenStreetMap: held for review, not guessed.' },
  street: { label: 'Not placed — named after a street', said: 'A street is a line, often kilometres long; a neighbourhood’s mark on it would claim more than the name says.' },
  none: { label: 'Not placed — no OpenStreetMap match', said: 'No OpenStreetMap name matches it, and no other source this map may use places it.' },
  'not-a-place': { label: 'Not a place', said: 'An extraction label from NAPIC’s rental table — a floor of a building — not a scheme’s name.' },
};
const kmReason = (s) => (s.status === 'not-a-place' ? 'not-a-place' : s.reason);

/* The page's state for this tab: the map, its mode and what is selected. The
   map itself is kept across redraws of the page (its box is moved into each
   new drawing), and let go once the page is left (kmLetGo, below). */
const KM = { box: null, map: null, mode: 'idle', why: '', theme: null, sel: null, tilt: false, anyway: false, libs: null, filter: '', from: null };
const kmPlaced = () => (KM_DATA?.schemes || []).filter(s => s.status === 'placed');
const kmIdOf = (s) => `km-${String(s.scheme).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const kmFind = (name) => (KM_DATA?.schemes || []).find(s => s.scheme === name) || null;
const kmAt = (path) => `${location.origin}${BASE}/${String(path).replace(/^\//, '')}`;

/* ---------------------------------------------------------------- the data */
/* THE DRAWN LAYER'S DATA, AND ALL OF IT: each placed scheme as the
   neighbourhood round its evidence (a ring of 64 points, its radius in
   metres) and as the point its name is set at. A feature carries the
   scheme's name, how it was placed and its index — never a figure: no
   price, no range, no rent, no count of observations (build.mjs --check
   and served-check scan these properties; the journey scans what the map
   holds). */
function kmFeatures(schemes = kmPlaced()) {
  const ring = (lon, lat, m) => {
    const out = [];
    const dLat = m / 111320, dLon = m / (111320 * Math.cos(lat * Math.PI / 180));
    for (let i = 0; i <= 64; i++) {
      const a = (i % 64) / 64 * 2 * Math.PI;
      out.push([Math.round((lon + dLon * Math.cos(a)) * 1e6) / 1e6, Math.round((lat + dLat * Math.sin(a)) * 1e6) / 1e6]);
    }
    return out;
  };
  const props = (s, i) => ({ i, name: s.scheme, method: s.method, confidence: s.confidence });
  return {
    areas: { type: 'FeatureCollection', features: schemes.map((s, i) => ({ type: 'Feature', id: i, properties: props(s, i),
      geometry: { type: 'Polygon', coordinates: [ring(s.centre[0], s.centre[1], s.radius)] } })) },
    points: { type: 'FeatureCollection', features: schemes.map((s, i) => ({ type: 'Feature', id: i, properties: props(s, i),
      geometry: { type: 'Point', coordinates: s.centre } })) },
  };
}

/* NAPIC's rows under a scheme's name, from the division's file — every row
   of that name, each labelled by its type and basis, as the area screen's
   benchmark panel shows them (81-napic.js). */
const kmRowsOf = (scheme) => (napicDoc('Kuching')?.benchmarks || []).filter(b => b.scheme === scheme);
/* change: the panel's — each row's change on the half-year before, as
   NAPIC states it. */
function kmFigures(scheme, { change = false } = {}) {
  const doc = napicDoc('Kuching');
  if (!doc) return null;
  const rows = kmRowsOf(scheme);
  const period = doc.period.code;
  const range = (b) => (b.min === b.max ? fmtMoney(b.min, 'MYR', 0) : `${fmtMoney(b.min, 'MYR', 0)}–${fmtMoney(b.max, 'MYR', 0)}`);
  const type = (b) => [b.propertyType, b.floorLevel, b.roadPosition].filter(Boolean).join(' · ').toLowerCase();
  if (!rows.length) return el('p', { class: 'metaline' }, `No row under this name in NAPIC’s ${period} Kuching file.`);
  return el('ul', { class: 'km-figs' }, rows.map(b => el('li', { class: `km-fig${b.sampleSize === 1 ? ' napic-single' : ''}` }, [
    el('span', { class: 'km-fig-type' }, type(b)), ' ',
    el('span', { class: 'km-fig-range num', title: b.sampleSize === 1 ? `${b.rangeLabel}: one property, not the scheme’s price` : b.rangeLabel }, range(b)),
    el('span', { class: 'caption' }, ` ${napicUnitLabel(b)} · ${b.sampleSize == null ? 'sample size not published' : b.sampleSize === 1 ? napicSampleWords(b, period) : `${b.sampleSize} in NAPIC’s ${period} sample`}`
      + (change ? ` · change ${b.changeStated ? b.changeStated : isNum(b.changePct) ? withSign(b.changePct, 1) : 'not stated'}` : '')),
  ])));
}

/* --------------------------------------------------------------- the page */
VIEWS.areaMap = () => {
  const wrap = el('div', { class: 'km-page' });
  if (!KM_DATA) { wrap.append(emptyState('The Kuching map is not in this build.')); return wrap; }
  /* NAPIC's Kuching file, asked for as the page is first drawn: the figures
     under each scheme come with it (loadNapic redraws the page). */
  if (!napicDivisions.has('Kuching')) loadNapic('Kuching');
  const placed = kmPlaced(), all = KM_DATA.schemes;
  wrap.append(pageHead({ title: 'Kuching scheme map',
    /* Its own state, as the register row has it (80-registers.js): the area
       screen's tab is Live, and this view of it is new. */
    badge: el('span', { class: 'status-badge status-beta', title: 'New: positions only, most schemes not yet placed, nothing on the map priced.' }, 'Beta'),
    lede: 'Where NAPIC’s Kuching housing schemes are, wherever OpenStreetMap names them — positions only, never prices.',
    note: `${placed.length} of ${all.length} residential schemes in NAPIC’s ${KM_DATA.period} sample are placed, each with its evidence and how sure it is. `
      + 'NAPIC’s observed ranges stay in the list, under each scheme; the map carries no figure.' }));
  wrap.append(areaViewsNav('areaMap'));

  const layout = el('div', { class: 'km-layout' });
  layout.append(kmMapCard());
  layout.append(kmPanel());
  wrap.append(layout);
  wrap.append(kmList());
  wrap.append(el('div', { class: 'card' }, [
    cardHead('What this map cannot tell you', 'Named, because a map is the most persuasive thing this product draws.'),
    el('ul', { class: 'ticklist blocklist' }, [
      el('li', {}, 'A scheme’s position is a neighbourhood drawn round OpenStreetMap’s evidence for its name — never a building, a lot, a boundary or a title. Confirm any property against its title and the Land and Survey Department.'),
      el('li', {}, 'No price, rent or range is drawn on the map. NAPIC’s observed ranges are in the list: a range observed across its sample for one half-year (H1 2025), not the scheme’s price, not the latest sale, and never a midpoint.'),
      el('li', {}, 'A scheme not placed is not missing from the market: OpenStreetMap does not name it, or names it only in part. An empty block on the map is not empty land — many suburbs are not yet mapped.'),
      el('li', {}, `Heights are drawn only where OpenStreetMap records one (${KM_DATA.heights.count} buildings); a flat building is one with no recorded height, not a single-storey one.`),
      el('li', {}, 'No flood, zoning or title status is held here, and nothing on the map ranks, scores or recommends a place.'),
    ]),
  ]));
  return wrap;
};

/* THE AREA SCREEN'S TWO VIEWS, side by side as links (they work with no
   script): the localities, and this map. */
function areaViewsNav(here) {
  const link = (view, path, words) => el('a', { href: href(path), class: 'km-view-link', 'aria-current': here === view ? 'page' : null,
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return; e.preventDefault(); if (here !== view) navigate(path); } }, words);
  return el('nav', { class: 'km-views', 'aria-label': 'Area screen views' }, el('div', { class: 'segmented km-views-seg' }, [
    link('areas', '/property/areas', 'Localities'), link('areaMap', '/property/areas/map', 'Kuching scheme map')]));
}

/* The box the map is drawn in, kept across redraws: a fresh box on a new
   visit, the same one (with its map) on a redraw of the page. */
const KM_SERVED_SAY = 'The map is drawn here by the page’s script, from this site’s own map file. The list below has every scheme it places, with its evidence.';
function kmBox() {
  if (KM.box && KM.box.isConnected) return KM.box;
  if (KM.box && KM.map) return KM.box;
  KM.box = el('div', { class: 'km-box', id: 'km-box' }, [
    el('div', { class: 'km-say', id: 'km-say', role: 'status', 'data-now': KM_SERVED_SAY }, KM_SERVED_SAY),
    el('div', { class: 'km-canvas', id: 'km-canvas' }),
    el('p', { class: 'km-attrib' }, ['© ', el('a', { href: 'https://www.openstreetmap.org/copyright', rel: 'license' }, 'OpenStreetMap'), ' contributors']),
  ]);
  return KM.box;
}
function kmMapCard() {
  const card = el('section', { class: 'card km-card', 'aria-labelledby': 'km-map-h' });
  const tools = el('div', { class: 'segmented km-tools', role: 'group', 'aria-label': 'Map view' }, [
    el('button', { type: 'button', id: 'km-flat', 'aria-pressed': KM.tilt ? 'false' : 'true', onclick: () => kmTilt(false) }, '2D'),
    /* Nothing to tilt in the locality diagram. */
    el('button', { type: 'button', id: 'km-tilt', 'aria-pressed': KM.tilt ? 'true' : 'false', disabled: KM.mode === 'fallback' ? '' : null,
      title: KM.mode === 'fallback' ? 'Tilting needs the interactive map' : null, onclick: () => kmTilt(true) }, 'Tilt'),
  ]);
  const head = cardHead('Kuching — NAPIC schemes placed from OpenStreetMap', null, tools);
  head.querySelector('h3')?.setAttribute('id', 'km-map-h');
  card.append(head);
  card.append(kmBox());
  /* The legend: how a scheme was placed, and what a raised building means. */
  const swatch = (dash, words) => el('span', { class: 'km-key' }, [el('span', { class: `km-swatch${dash ? ' km-swatch-dash' : ''}`, 'aria-hidden': 'true' }), words]);
  card.append(el('div', { class: 'km-legend' }, [
    swatch(false, 'Named in OpenStreetMap — drawn round the named area, place or building'),
    swatch(true, 'Its lanes carry the name — drawn round the middle of those lanes'),
  ]));
  card.append(el('p', { class: 'metaline km-note' }, `Tilt raises only the ${KM_DATA.heights.count} buildings OpenStreetMap records a height for; every other building is drawn flat, and flat does not mean single-storey. Many suburbs are not yet mapped in OpenStreetMap: an empty block is not empty land.`));
  card.append(el('p', { class: 'metaline km-note' }, `Map data: OpenStreetMap, as of ${KM_DATA.tileAsOf} (Protomaps build ${KM_DATA.build}); scheme positions from OpenStreetMap names as of ${KM_DATA.osmAsOf}; NAPIC ${KM_DATA.period}.`));
  /* The map, once the page is up: a frame after, so the box has its size. */
  setTimeout(kmStart, 0);
  return card;
}

/* ------------------------------------------------------------- the panel */
function kmPanel() {
  const s = KM.sel ? kmFind(KM.sel) : null;
  const panel = el('aside', { class: 'card km-panel', id: 'km-panel', 'aria-labelledby': 'km-panel-h',
    onkeydown: (e) => { if (e.key === 'Escape' && KM.sel) { e.preventDefault(); kmSelect(null); } } });
  if (!s) {
    panel.append(el('h3', { class: 'h-card', id: 'km-panel-h', tabindex: '-1' }, 'A scheme, its evidence and its figures'));
    const t = KM_DATA.tally || {};
    panel.append(el('p', { class: 'body km-panel-lede' }, 'Choose a scheme on the map or in the list: its position, what places it, NAPIC’s figures for it and the Scenario Lab, here.'));
    panel.append(el('dl', { class: 'km-tally' }, [
      ['Placed on the map', kmPlaced().length],
      ['Not placed — a partial or ambiguous match', t['not-placed:weak'] || 0],
      ['Not placed — named after a street', t['not-placed:street'] || 0],
      ['Not placed — no OpenStreetMap match', t['not-placed:none'] || 0],
      ['Not a place', t['not-a-place'] || 0],
    ].flatMap(([k, v]) => [el('dt', {}, k), el('dd', { class: 'num' }, String(v))])));
    return panel;
  }
  const placed = s.status === 'placed';
  panel.append(el('p', { class: 'eyebrow' }, placed ? 'Placed on the map' : 'Not placed on the map'));
  panel.append(el('h3', { class: 'h-card', id: 'km-panel-h', tabindex: '-1' }, s.scheme));
  if (placed) {
    const c = KM_CONF[s.confidence];
    panel.append(el('p', { class: 'km-chips' }, [el('span', { class: `chip km-conf km-conf-${s.confidence}`, title: c.said }, c.label)]));
    panel.append(el('p', { class: 'metaline' }, s.said));
    panel.append(el('p', { class: 'metaline' }, `Drawn as a circle ${s.radius} m round its evidence: it marks where the scheme is, not one building or lot. OpenStreetMap ${s.osm.join(', ')}.`));
  } else panel.append(el('p', { class: 'metaline' }, [el('strong', {}, KM_NOT[kmReason(s)].label), ' — ', KM_NOT[kmReason(s)].said]));
  panel.append(el('div', { class: 'card-hd-t km-panel-sub' }, [el('h4', { class: 'eyebrow' }, `NAPIC ${KM_DATA.period}, under this name`), kindBadge('filed', { fine: `NAPIC ${KM_DATA.period}` })]));
  panel.append(kmFigures(s.scheme, { change: true }) || el('p', { class: 'metaline' }, 'Loading NAPIC’s Kuching file…'));
  panel.append(el('p', { class: 'metaline' }, 'A range observed across NAPIC’s sample for the half-year: not the scheme’s price, not the latest sale, never a midpoint. A row from one observation is one property in the sample.'));
  const acts = el('div', { class: 'km-acts' });
  if (placed) {
    acts.append(kmLabButton(s, 'km-panel-lab'));
    if (KM.mode === 'map') acts.append(el('button', { type: 'button', class: 'btn btn-ghost', id: 'km-panel-zoom', onclick: () => kmShow(s, { focus: false }) }, 'Zoom the map to it'));
  }
  acts.append(el('button', { type: 'button', class: 'btn btn-quiet', id: 'km-panel-close', onclick: () => kmSelect(null) }, 'Close'));
  panel.append(acts);
  if (placed) panel.append(el('p', { class: 'metaline' }, `${s.nearest.name} is the calculator’s listed Kuching locality whose point lies nearest this scheme — ${s.nearest.km} km away. Localities are points, not boundaries: change the district in the Lab if the scheme lies in another. Nothing is saved until you save there.`));
  return panel;
}
function kmLabButton(s, id) {
  return el('button', { type: 'button', class: 'btn btn-ghost km-lab', id, 'data-km-lab': s.scheme, onclick: () => kmOpenLab(s) }, `Open the Scenario Lab on ${s.nearest.name}`);
}
/* THE SCENARIO LAB, ON THE SCHEME'S LOCALITY: the work the Lab holds, where
   it holds one (pfContext, 88-property-flow.js), else the calculator's
   deal; its active column moved to the locality as a what-if (labOpen,
   82-property-lab.js, on the Lab's page once it is up). Nothing written. */
function kmOpenLab(s) {
  State.labPlace = { city: 'kuching', district: s.nearest.name, scheme: s.scheme };
  const ctx = pfContext();
  if (ctx) pfToLab(ctx); else navigate('/property/lab?');
}

/* -------------------------------------------------------------- the list */
function kmList() {
  const card = el('section', { class: 'card km-list-card', id: 'km-list', 'aria-labelledby': 'km-list-h' });
  card.append(cardHead(`Every Kuching residential scheme in NAPIC’s ${KM_DATA.period} sample — ${KM_DATA.schemes.length}`,
    'The map’s list, and the way to it from a keyboard or a screen reader: each scheme’s position and evidence, NAPIC’s figures under it, and the Scenario Lab.', null, { kind: 'filed', fine: `NAPIC ${KM_DATA.period}` }));
  const find = el('div', { class: 'km-find' }, [
    el('label', { for: 'km-find' }, 'Find a scheme'),
    el('input', { class: 'input', id: 'km-find', type: 'search', autocomplete: 'off', value: KM.filter, placeholder: 'A name, or part of one',
      oninput: (e) => { KM.filter = e.target.value; kmFilter(card); } }),
    el('p', { class: 'metaline', id: 'km-find-said', 'aria-live': 'polite' }, ''),
  ]);
  card.append(find);
  card.append(el('p', { class: 'metaline km-figs-say' }, `Under each scheme, NAPIC’s observed ranges for ${KM_DATA.period} once the page’s script has loaded NAPIC’s Kuching file; a row from one observation says so.`));
  const groups = [
    ['placed', `Placed on the map — ${kmPlaced().length}`, (s) => s.status === 'placed'],
    ['weak', null, (s) => kmReason(s) === 'weak'],
    ['street', null, (s) => kmReason(s) === 'street'],
    ['none', null, (s) => kmReason(s) === 'none'],
    ['not-a-place', null, (s) => kmReason(s) === 'not-a-place'],
  ];
  for (const [key, title, test] of groups) {
    const rows = KM_DATA.schemes.filter(test);
    if (!rows.length) continue;
    const g = el('section', { class: `km-group km-group-${key}`, 'aria-labelledby': `km-g-${key}` });
    g.append(el('h4', { class: 'km-group-h', id: `km-g-${key}` }, title || `${KM_NOT[key].label} — ${rows.length}`));
    if (key !== 'placed') g.append(el('p', { class: 'metaline' }, KM_NOT[key].said));
    g.append(el('ol', { class: 'km-items' }, rows.map(s => kmItem(s))));
    card.append(g);
  }
  if (KM.filter) queueMicrotask(() => kmFilter(card));
  return card;
}
function kmItem(s) {
  const placed = s.status === 'placed';
  const li = el('li', { class: `km-item${KM.sel === s.scheme ? ' is-sel' : ''}`, 'data-scheme': s.scheme, id: kmIdOf(s) });
  li.append(el('div', { class: 'km-item-hd' }, [
    el('span', { class: 'km-name' }, s.scheme),
    placed ? el('span', { class: `chip km-conf km-conf-${s.confidence}`, title: KM_CONF[s.confidence].said }, KM_CONF[s.confidence].label) : null,
  ]));
  if (placed) li.append(el('p', { class: 'metaline km-ev' }, s.said));
  const figs = kmFigures(s.scheme);
  if (figs) li.append(figs);
  if (placed) li.append(el('div', { class: 'km-acts' }, [
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: `${kmIdOf(s)}-show`, onclick: () => kmShow(s) }, 'Show on the map'),
    kmLabButton(s, `${kmIdOf(s)}-lab`),
  ]));
  return li;
}
/* The list narrowed to a name as it is typed, here, with no request. */
function kmFilter(root = document.getElementById('km-list')) {
  if (!root) return;
  const q = KM.filter.trim().toLowerCase();
  let shown = 0;
  for (const li of root.querySelectorAll('.km-item')) {
    const on = !q || li.dataset.scheme.toLowerCase().includes(q);
    li.hidden = !on; if (on) shown++;
  }
  for (const g of root.querySelectorAll('.km-group')) g.hidden = !g.querySelector('.km-item:not([hidden])');
  const said = root.querySelector('#km-find-said');
  if (said) said.textContent = q ? `${shown} of ${KM_DATA.schemes.length} schemes match “${KM.filter.trim()}”.` : '';
}

/* -------------------------------------------------------- choosing one */
/* A scheme chosen, from the map or the list: the panel says it, and focus
   goes to the panel's heading — from where Escape (or Close) returns it to
   the control that chose it. */
/* scroll: what is brought into view — the panel (a scheme chosen from the
   list with no map to show it on), the map (shown on it), or nothing (a
   scheme tapped on the map, the panel beside or under it). */
function kmSelect(name, { from = null, scroll = 'panel' } = {}) {
  const was = KM.sel;
  KM.sel = name;
  if (name) KM.from = from || (document.activeElement && document.activeElement !== document.body ? document.activeElement.id : null);
  render();
  kmPaintSelection();
  if (name) {
    document.getElementById('km-panel-h')?.focus({ preventScroll: true });
    const into = scroll === 'map' && KM.mode === 'map' ? KM.box : scroll === 'panel' ? document.getElementById('km-panel') : null;
    into?.scrollIntoView({ block: 'nearest' });
  } else if (was) {
    /* Back where it was chosen: a list's button, or the map itself. */
    const back = KM.from === 'km-map' ? KM.map?.getCanvas() : KM.from && document.getElementById(KM.from);
    (back || document.getElementById('km-panel-h'))?.focus();
    KM.from = null;
  }
}
function kmShow(s, { focus = true } = {}) {
  if (focus) kmSelect(s.scheme, { scroll: 'map' });
  if (KM.mode === 'map' && KM.map) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const zoom = s.radius >= 500 ? 14 : s.radius >= 300 ? 14.6 : 15.2;
    KM.map[reduce ? 'jumpTo' : 'easeTo']({ center: s.centre, zoom, ...(reduce ? {} : { duration: 600 }) });
  }
}

/* -------------------------------------------------------- drawing the map */
function kmSay(text, extra = null) {
  const say = KM.box?.querySelector('#km-say');
  if (!say) return;
  say.replaceChildren(text, ...(extra ? [' ', extra] : []));
  say.hidden = !text;
}
/* WHICH MAP, decided once a visit: the interactive one where the browser
   draws WebGL2 on its graphics hardware, else the locality diagram. A
   reader whose device asks for reduced motion or reduced data is given the
   diagram first, and a button for the map. */
function kmWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch { return false; }
}
function kmStart() {
  if (!KM.box || !KM.box.isConnected || KM.mode !== 'idle') return;
  const quiet = matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(prefers-reduced-data: reduce)').matches;
  if (quiet && !KM.anyway) return kmFallback('reduce');
  if (!kmWebGL()) return kmFallback('webgl');
  kmDraw();
}
function kmFallback(why, detail = '') {
  KM.mode = 'fallback'; KM.why = why;
  const host = KM.box.querySelector('#km-canvas');
  const say = why === 'reduce'
    ? 'Your device asks for reduced motion or data, so Kuching’s localities are drawn instead of the interactive map. The list below has every placed scheme.'
    : why === 'webgl'
      ? 'This browser cannot draw the interactive map (it needs WebGL2 on graphics hardware), so Kuching’s localities are drawn instead. The list below has every placed scheme.'
      : `The interactive map could not be drawn (${detail || 'an error in the drawing'}), so Kuching’s localities are drawn instead. The list below has every placed scheme.`;
  kmSay(say, why === 'reduce' ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'km-anyway',
    onclick: () => { KM.anyway = true; KM.mode = 'idle'; KM.box.querySelector('#km-canvas')?.replaceChildren(); if (kmWebGL()) kmDraw(); else kmFallback('webgl'); } }, 'Draw the map') : null);
  /* Nothing on the box itself changes (no class, no attribute): the served
     page is drawn so, in a browser asking for reduced motion, and what it
     says here is the tab's (data-now). The stylesheet reads the mode off
     what the box holds (styles.css, kuching-map: :has(svg), :has(canvas)). */
  const draw = () => {
    if (!sarawakGeo) { if (geoLoadState === 'idle') loadSarawakLayers(); return; }
    /* The room between the words and the attribution: the box's height
       less theirs. */
    const said = KM.box.querySelector('#km-say'), credit = KM.box.querySelector('.km-attrib');
    const room = KM.box.clientHeight - (said && !said.hidden ? said.offsetHeight + 12 : 0) - (credit ? credit.offsetHeight : 0) - 8;
    host.replaceChildren(cityMap('kuching', null, (n) => { State.areaScreen.city = 'kuching'; State.areaScreen.editing = n; navigate('/property/areas'); }, null,
      { label: 'Kuching’s localities, drawn in place of the interactive map. The list below has every placed scheme.', maxH: room }));
  };
  KM.drawFallback = draw;
  draw();
}
async function kmLibs() {
  if (KM.libs) return KM.libs;
  KM.libs = (async () => {
    const base = `${BASE}/${KM_DATA.vendor.maplibre}`;
    if (!document.querySelector('link[data-km-css]')) document.head.append(el('link', { rel: 'stylesheet', href: `${base}/maplibre-gl.css`, 'data-km-css': '' }));
    await new Promise((res, rej) => {
      if (window.pmtiles) return res();
      const s = el('script', { src: `${BASE}/${KM_DATA.vendor.pmtiles}`, 'data-km-pmtiles': '' });
      s.onload = res; s.onerror = () => rej(new Error('the map file reader did not load'));
      document.head.append(s);
    });
    const ml = await import(`${base}/maplibre-gl.mjs`);
    const protocol = new window.pmtiles.Protocol();
    ml.addProtocol('pmtiles', protocol.tile);
    return ml;
  })();
  KM.libs.catch(() => { KM.libs = null; });
  return KM.libs;
}
/* A style, its addresses made this site's: the file holds paths ("/data/…",
   "pmtiles:///data/…"), and the page puts its own origin before each. */
async function kmStyle(theme) {
  const style = await fetchJson(dataUrl(KM_DATA.styles[theme]));
  if (!style) throw new Error('the map’s style did not load');
  style.glyphs = kmAt(style.glyphs);
  style.sprite = kmAt(style.sprite);
  for (const src of Object.values(style.sources)) if (src.url?.startsWith('pmtiles:///')) src.url = `pmtiles://${kmAt(src.url.slice('pmtiles:///'.length))}`;
  return style;
}
const kmColours = (theme) => (theme === 'dark'
  ? { mark: '#6D9BF6', fill: 'rgba(109,155,246,0.16)', sel: 'rgba(109,155,246,0.32)', text: '#f2f0ea', halo: '#111413', raised: '#4a534e' }
  : { mark: '#1B4FCC', fill: 'rgba(27,79,204,0.10)', sel: 'rgba(27,79,204,0.24)', text: '#16191a', halo: '#f1ede4', raised: '#cbbfa8' });
/* The page's own layers over the basemap: the raised buildings (tilted
   only), the schemes' neighbourhoods, their outlines (dashed where lanes
   place them) and their names. */
function kmLayers(map, theme) {
  const c = kmColours(theme), f = kmFeatures();
  if (!map.getSource('km-areas')) map.addSource('km-areas', { type: 'geojson', data: f.areas });
  if (!map.getSource('km-points')) map.addSource('km-points', { type: 'geojson', data: f.points });
  if (KM.heights && !map.getSource('km-heights')) map.addSource('km-heights', { type: 'geojson', data: KM.heights });
  const sel = ['==', ['get', 'name'], KM.sel || ''];
  if (KM.heights) map.addLayer({ id: 'km-raised', type: 'fill-extrusion', source: 'km-heights', layout: { visibility: KM.tilt ? 'visible' : 'none' },
    paint: { 'fill-extrusion-color': c.raised, 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 0.9 } });
  map.addLayer({ id: 'km-fill', type: 'fill', source: 'km-areas', paint: { 'fill-color': ['case', sel, c.sel, c.fill] } });
  map.addLayer({ id: 'km-line', type: 'line', source: 'km-areas', filter: ['==', ['get', 'confidence'], 'named-feature'],
    paint: { 'line-color': c.mark, 'line-width': ['case', sel, 3, 1.6] } });
  map.addLayer({ id: 'km-line-dash', type: 'line', source: 'km-areas', filter: ['==', ['get', 'confidence'], 'lanes-named'],
    paint: { 'line-color': c.mark, 'line-width': ['case', sel, 3, 1.6], 'line-dasharray': [3, 2] } });
  map.addLayer({ id: 'km-name', type: 'symbol', source: 'km-points', minzoom: 12.2,
    layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-max-width': 9, 'text-allow-overlap': false },
    paint: { 'text-color': c.text, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } });
}
function kmPaintSelection() {
  const map = KM.map;
  if (!map || !map.getLayer?.('km-fill')) return;
  const c = kmColours(KM.theme), sel = ['==', ['get', 'name'], KM.sel || ''];
  map.setPaintProperty('km-fill', 'fill-color', ['case', sel, c.sel, c.fill]);
  map.setPaintProperty('km-line', 'line-width', ['case', sel, 3, 1.6]);
  map.setPaintProperty('km-line-dash', 'line-width', ['case', sel, 3, 1.6]);
}
async function kmDraw() {
  KM.mode = 'loading';
  kmSay('Loading the map — this site’s own map file and its drawing code, about 1.2MB the first time.');
  try {
    const theme = currentTheme() === 'dark' ? 'dark' : 'light';
    const [ml, style, heights] = await Promise.all([kmLibs(), kmStyle(theme), fetchJson(dataUrl(KM_DATA.heights.file)).catch(() => null)]);
    if (!KM.box) return;
    KM.heights = heights;
    KM.theme = theme;
    const host = KM.box.querySelector('#km-canvas');
    const [w, s, e, n] = KM_DATA.bbox;
    /* Opened on the placed schemes, all of them in view at any width. */
    const lons = kmPlaced().map(x => x.centre[0]), lats = kmPlaced().map(x => x.centre[1]);
    const map = new ml.Map({
      container: host, style, attributionControl: false, maplibreLogo: false,
      bounds: [[Math.min(...lons) - 0.008, Math.min(...lats) - 0.008], [Math.max(...lons) + 0.008, Math.max(...lats) + 0.008]], fitBoundsOptions: { padding: 16 },
      minZoom: 10, maxZoom: 17.5, maxPitch: 60,
      maxBounds: [[w - 0.08, s - 0.07], [e + 0.08, n + 0.07]],
      cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      canvasContextAttributes: { failIfMajorPerformanceCaveat: true },
      locale: { 'Map.Title': 'Map of Greater Kuching with the placed NAPIC schemes. The list below has every scheme.' },
    });
    KM.map = map;
    map.addControl(new ml.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
    map.on('style.load', () => { kmLayers(map, KM.theme); kmPaintSelection(); });
    map.on('load', () => { KM.mode = 'map'; kmSay(''); });
    /* An error in loading the style itself, before the map has drawn, is
       the end of it: the diagram instead. A tile, a glyph or an image that
       fails later is the map's to carry (it draws without it). */
    map.on('error', (ev) => {
      if (KM.mode !== 'loading' || ev?.sourceId || ev?.tile) return;
      try { map.remove(); } catch { /* gone */ }
      KM.map = null;
      kmFallback('error', ev?.error?.message);
    });
    /* A neighbourhood is chosen by a tap anywhere within 22px of it — the
       44px target the locality diagram's points have. */
    const hit = (pt) => map.queryRenderedFeatures([[pt.x - 22, pt.y - 22], [pt.x + 22, pt.y + 22]], { layers: ['km-fill', 'km-name'] });
    map.on('click', (ev) => { const f = hit(ev.point)[0]; if (f) kmSelect(f.properties.name, { from: 'km-map', scroll: 'none' }); });
    map.on('mousemove', (ev) => { map.getCanvas().style.cursor = hit(ev.point).length ? 'pointer' : ''; });
  } catch (err) {
    KM.map = null;
    kmFallback(err?.name === 'GPUInitializationError' ? 'webgl' : 'error', err?.message);
  }
}
function kmTilt(on) {
  if (on && KM.mode !== 'map') return;
  KM.tilt = !!on;
  for (const [id, v] of [['km-flat', !on], ['km-tilt', !!on]]) document.getElementById(id)?.setAttribute('aria-pressed', v ? 'true' : 'false');
  const map = KM.map;
  if (!map) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (map.getLayer('km-raised')) map.setLayoutProperty('km-raised', 'visibility', on ? 'visible' : 'none');
  if (on) { map.dragRotate.enable(); map.touchPitch.enable(); } else { map.dragRotate.disable(); map.touchPitch.disable(); }
  map[reduce ? 'jumpTo' : 'easeTo']({ pitch: on ? 55 : 0, bearing: on ? map.getBearing() : 0, ...(reduce ? {} : { duration: 500 }) });
}
/* The theme followed: a redraw of the page with the other theme on swaps
   the style, the page's layers put back once it is in. */
async function kmFollowTheme() {
  const theme = currentTheme() === 'dark' ? 'dark' : 'light';
  if (!KM.map || KM.mode !== 'map' || theme === KM.theme) return;
  KM.theme = theme;
  try { KM.map.setStyle(await kmStyle(theme), { diff: false }); } catch { /* the map keeps the style it has */ }
}
/* The page left: the map and its graphics context let go. A return draws
   a new one. */
function kmLetGo() {
  if (KM.box && !KM.box.isConnected) {
    try { KM.map?.remove(); } catch { /* gone */ }
    Object.assign(KM, { box: null, map: null, mode: 'idle', why: '', theme: null, sel: null, tilt: false, from: null, drawFallback: null });
  }
}
new MutationObserver(() => {
  if (!KM.box) return;
  if (!KM.box.isConnected) return kmLetGo();
  if (KM.mode === 'fallback' && KM.drawFallback && sarawakGeo && !KM.box.querySelector('svg')) KM.drawFallback();
  kmFollowTheme();
}).observe(viewRoot, { childList: true });
