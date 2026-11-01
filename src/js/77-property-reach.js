/* ==========================================================================
   EVERYDAY REACH — WHO LIVES IN THE DISTRICT, AND WHAT IS MAPPED NEAR AN AREA
   --------------------------------------------------------------------------
   The owner, 1 Nov 2026: rental demand rests on population, jobs, schools and
   universities, and healthcare — most people spend their time near where they
   live. The demand test (77-property-tests.js) asked all of it and held no
   evidence for any of it: the reader marked each source from memory.

   data/sarawak-reach.json (ingest/sarawak-reach.mjs) is that evidence:
     - per DOSM district, the population on 1 January each year from 2020, its
       change since, and the working-age (20–64) and children's (0–14) shares;
     - per area with a mapped point, its district and what OpenStreetMap maps
       within 5 km of the point, straight line, with the nearest hospital,
       college or university and mall.

   IT IS SHOWN; IT IS NEVER SCORED. No count here becomes a grade, a rank, a
   score or a gate: the reader still marks each demand source, and the grade
   and the IPS read what they always read. Every OpenStreetMap count is "at
   least this many are mapped", never a total, and says so once where it
   stands. The places of work are places MAPPED — offices, industrial,
   commercial and retail land-use areas, malls — and are not jobs.
   ========================================================================== */

const REACH_FACILITIES = [
  { key: 'hospitals', label: 'Hospitals', one: 'hospital', many: 'hospitals', near: 'hospital', nearWord: 'hospital' },
  { key: 'clinics', label: 'Clinics and doctors', one: 'clinic', many: 'clinics' },
  { key: 'schools', label: 'Schools', one: 'school', many: 'schools' },
  { key: 'kindergartens', label: 'Kindergartens', one: 'kindergarten', many: 'kindergartens' },
  { key: 'collegesAndUniversities', label: 'Colleges and universities', one: 'college or university', many: 'colleges and universities', near: 'collegeOrUniversity', nearWord: 'college or university' },
];
const REACH_WORK = [
  { key: 'offices', label: 'Offices', one: 'office', many: 'offices' },
  { key: 'industrialLanduse', label: 'Industrial land-use areas', one: 'industrial land-use area', many: 'industrial land-use areas' },
  { key: 'commercialLanduse', label: 'Commercial land-use areas', one: 'commercial land-use area', many: 'commercial land-use areas' },
  { key: 'retailLanduse', label: 'Retail land-use areas', one: 'retail land-use area', many: 'retail land-use areas' },
  { key: 'malls', label: 'Malls', one: 'mall', many: 'malls', near: 'mall', nearWord: 'mall' },
];

const REACH_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* "1 Nov 2026" and "Nov 2026" from an ISO date or timestamp. */
const reachDay = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${Number(iso.slice(8, 10))} ${REACH_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const reachMonth = (iso) => (iso && /^\d{4}-\d{2}/.test(iso) ? `${REACH_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : '');
const reachN = (n, one, many) => `${fmtNum(n, 0)} ${n === 1 ? one : many}`;

/* What each figure is from, and as of when — said on every row. */
const reachSrcPlaces = () => `OpenStreetMap, ${reachDay(sarawakReach?.osmBase)}`;
const reachSrcPop = () => `DOSM, ${reachDay(sarawakReach?.populationAsOf)}`;

/* The record for a locality: its reach row and its district's, or null when
   the file is not here or holds nothing for the place. Asking starts the load
   once; the page is drawn again when the file lands (loadReach). */
function reachFor(city, area) {
  if (reachLoadState === 'idle') loadReach();
  const rec = sarawakReach?.cities?.[city]?.areas?.[area];
  if (!rec) return null;
  return { rec, districtName: rec.district, district: rec.district ? sarawakReach.districts?.[rec.district] || null : null };
}
const reachCount = (city, area, key) => { const r = reachFor(city, area); return r && isNum(r.rec.within5km?.[key]) ? r.rec.within5km[key] : null; };
const reachCountText = (city, area, key) => { const v = reachCount(city, area, key); return v == null ? null : v ? `${fmtNum(v, 0)} mapped` : 'none mapped'; };
const reachGrowth = (city, area) => { const g = reachFor(city, area)?.district?.growthPct; return isNum(g) ? g : null; };
function reachWorkCount(city, area) {
  const r = reachFor(city, area);
  if (!r) return null;
  const xs = REACH_WORK.map(w => r.rec.within5km?.[w.key]);
  return xs.every(isNum) ? xs.reduce((s, x) => s + x, 0) : null;
}

/* ---- the hint beside a demand-test source -------------------------------
   A line of evidence, nothing more: the reader still marks the source, and
   nothing here changes the verdict, the grade or the IPS. No record for the
   deal's area, no line. */
function reachHint(city, area, source) {
  const r = reachFor(city, area);
  if (!r) return null;
  const w = r.rec.within5km || {};
  let parts = null;
  if (source === 'healthcare') parts = `${reachN(w.hospitals, 'hospital', 'hospitals')}, ${reachN(w.clinics, 'clinic', 'clinics')}`;
  else if (source === 'education') parts = `${reachN(w.schools, 'school', 'schools')}, ${reachN(w.kindergartens, 'kindergarten', 'kindergartens')}, ${reachN(w.collegesAndUniversities, 'college or university', 'colleges and universities')}`;
  else if (source === 'employment') parts = `${reachN(w.offices, 'office', 'offices')}, ${reachN(w.malls, 'mall', 'malls')}, and ${fmtNum(w.industrialLanduse, 0)} industrial, ${fmtNum(w.commercialLanduse, 0)} commercial and ${fmtNum(w.retailLanduse, 0)} retail land-use areas`;
  if (!parts || ![w.hospitals, w.offices].every(isNum)) return null;
  return `Within 5 km of ${area}: ${parts} mapped (OpenStreetMap, ${reachMonth(sarawakReach.osmBase)})`;
}

/* The same facts as plain lines, for the Scenario Lab's "where each column
   is" (82-property-lab.js): the places mapped near the area, and the district's
   population. Empty when the file holds nothing for the area. */
function reachLabLines(city, area) {
  const r = reachFor(city, area);
  if (!r) return [];
  const w = r.rec.within5km || {};
  const out = [`Within 5 km of ${area}, straight line: ${[reachN(w.hospitals, 'hospital', 'hospitals'), reachN(w.clinics, 'clinic', 'clinics'), reachN(w.schools, 'school', 'schools'), reachN(w.collegesAndUniversities, 'college or university', 'colleges and universities'), reachN(w.offices, 'office', 'offices')].join(', ')} mapped (OpenStreetMap, ${reachMonth(sarawakReach.osmBase)})`];
  const d = r.district;
  if (d) {
    const y = String(sarawakReach.populationAsOf).slice(0, 4);
    out.push(`${r.districtName} district: ${fmtNum(d.population[y], 0)} people on ${reachDay(sarawakReach.populationAsOf)}${isNum(d.growthPct) ? `, ${withSign(d.growthPct, 1, '%')} since 2020` : ''} (DOSM)`);
  }
  return out;
}

/* ---- the panel on the area screen ---------------------------------------- */
const reachKm = (n) => (!isNum(n) ? '' : n < 0.05 ? 'under 0.1 km' : `${n.toFixed(1)} km`);
function everydayReachPanel(city, area) {
  const card = el('div', { class: 'card', id: 'reach-panel', 'data-reach-area': `${city}/${area}` });
  card.append(cardHead(`Everyday reach — ${area}`,
    'Who lives in the district, and what is mapped within 5 km of this area’s point. Evidence as the sources give it, shown beside the figures you record: it is not scored, not turned into a grade, and nothing is inferred where a source is silent.'));
  const r = reachFor(city, area);
  if (!r) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
      sarawakReach ? `No reach record is held for ${area}. The file covers the areas with a mapped point, and for any other place nothing is estimated.`
        : reachLoadState === 'failed' ? 'The everyday-reach file could not be loaded, so nothing is shown here. Reload the page to try again.'
        : 'Loading the everyday-reach file…'));
    return card;
  }

  const table = (label, rows) => {
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Measure', 'Figure', 'Source, as of'].map((h, i) => el('th', { style: 'text-align:left' }, h)))));
    t.append(el('tbody', {}, rows.map(x => x.group
      ? el('tr', {}, el('th', { scope: 'colgroup', colspan: '3', class: 'eyebrow', style: 'text-align:left;white-space:normal' }, x.group))
      : el('tr', { 'data-reach-row': x.id }, [
          el('th', { scope: 'row', style: 'text-align:left;white-space:normal;overflow-wrap:normal' }, x.label),
          el('td', { style: 'text-align:left;white-space:normal;overflow-wrap:normal' }, [x.figure, x.sub ? el('div', { class: 'metaline' }, x.sub) : null].filter(Boolean)),
          el('td', { class: 'caption', style: 'text-align:left;white-space:normal;overflow-wrap:normal' }, x.src),
        ]))));
    gridKeyboard(t, label);
    return el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t);
  };

  /* ---- the district ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, r.districtName ? `The ${r.districtName} district` : 'The district'));
  if (!r.district) {
    card.append(el('p', { class: 'metaline' }, `No district is assigned to ${area}, so no population figure is shown for it: ${r.rec.unmapped || 'the area is not placed in a district'}.`));
  } else {
    const d = r.district, y = String(sarawakReach.populationAsOf).slice(0, 4);
    const first = Math.min(...Object.keys(d.population).map(Number));
    card.append(el('p', { class: 'metaline' }, `${area} lies in the ${r.districtName} district (${r.rec.districtBasis}). These figures are the district’s as a whole and say nothing of ${area} alone.`));
    card.append(table(`The ${r.districtName} district: population and age mix. Arrow keys move between cells.`, [
      { id: 'population', label: 'Population', figure: `${fmtNum(d.population[y], 0)} people`, src: reachSrcPop() },
      isNum(d.growthPct)
        ? { id: 'growth', label: `Change since ${first}`, figure: withSign(d.growthPct, 1, '%'), sub: `from ${fmtNum(d.population[first], 0)} on 1 Jan ${first}`, src: reachSrcPop() }
        : { id: 'growth', label: `Change since ${first}`, figure: 'not shown', sub: d.seriesNote, src: reachSrcPop() },
      { id: 'working', label: 'Working age (20–64)', figure: `${fmtNum(d.workingAgeSharePct, 1)}% of the district`, src: reachSrcPop() },
      { id: 'children', label: 'Children (0–14)', figure: `${fmtNum(d.childrenSharePct, 1)}% of the district`, src: reachSrcPop() },
    ]));
  }

  /* ---- within 5 km ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, `Within 5 km of ${area} (straight line)`));
  const w = r.rec.within5km || {}, nr = r.rec.nearest || {};
  const near = (x) => {
    if (!x.near) return null;
    const n = nr[x.near];
    return n && isNum(n.km) ? `nearest ${x.nearWord} ${reachKm(n.km)} away${n.name ? `: ${n.name}` : ''}` : `no ${x.nearWord} mapped`;
  };
  const row = (x) => ({ id: x.key, label: x.label,
    figure: w[x.key] > 0 ? `at least ${fmtNum(w[x.key], 0)}` : 'none mapped', sub: near(x), src: reachSrcPlaces() });
  card.append(table(`What is mapped within 5 km of ${area}. Arrow keys move between cells.`, [
    ...REACH_FACILITIES.map(row),
    { group: 'Places of work mapped — not jobs' },
    ...REACH_WORK.map(row),
  ]));

  /* The caveat, once. */
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Every count from OpenStreetMap is the number mapped there — at least this many, never a total — and schools and clinics in particular are under-mapped: a low count may mean a place is not mapped rather than not there. '
    + 'Distances and the 5 km are straight line from the area’s single point, not travel time. Places of work are offices, land-use areas (counted by the centre of their outline) and malls that are mapped; they are not jobs, and a large industrial estate counts once.'));
  card.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
    `${sarawakReach.attribution} Retrieved ${reachDay(sarawakReach.retrieved)}; population as of ${reachDay(sarawakReach.populationAsOf)}, OpenStreetMap as of ${reachDay(sarawakReach.osmBase)}.`));
  return card;
}
