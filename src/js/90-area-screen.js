/* ==========================================================================
   SARAWAK COMPARABLES REGISTER

   It ships empty, and that is the honest state rather than an unfinished one.
   No source publishes Sarawak transacted prices or achieved rents that this
   product may redistribute — that finding is recorded in the source review and
   has not changed. So every row here is one a person entered from something
   they can point at, and the register's job is to make the difference between
   a sourced figure and a remembered one impossible to miss.

   What it deliberately does not do: scrape, republish anyone's listing data,
   ship seeded rows to look populated, or rank areas. A median of four readings
   is four readings.
   ========================================================================== */
/* ==========================================================================
   AREA SCREEN — MAP AND FILTERS OVER RECORDED AREA EVIDENCE
   ========================================================================== */
/* `classes` holds one selected-id array per class attribute, so a filter on
   title and a filter on flood are the same code path. */
State.areaScreen = { city:'kuching', layer:'flood', classes:{}, minRecords:0, maxWeeks:null,
  minLease:null, editing:null, drafts:null };

/* Each control that redraws the page carries an id, so renderKeepFocus can
   hand focus back to it — see renderAfterTyping in 75-property-grade.js. A
   locality's Record button is found again by its name. */
const areaRowButtonId = (n) => `area-rec-${String(n).replace(/[^A-Za-z0-9]+/g, '-')}`;
/* A comparable's Open button, found again by the record it opens. */
const obsOpenId = (o) => `obs-open-${String(o.id).replace(/[^A-Za-z0-9]+/g, '-')}`;

VIEWS.areas = () => {
  const S = State.areaScreen;
  /* What the recorder holds unsaved goes when it closes — see areaRecorder. */
  if (!S.editing) S.drafts = null;
  if (geoLoadState === 'idle') loadSarawakLayers();
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  /* The one head every product page wears (pageHead, 36-layouts.js). */
  wrap.append(pageHead({ title: 'Area screen', lede: 'Localities in one town, shaded by what you have recorded about them.',
    note: 'Flood exposure is entered from a source you name; rents, vacancy and prices come from the comparables register. Nothing here is modelled, inferred or bought in — an area with '
      + 'no record is drawn hollow, because an unexamined area must never look like a safe one.' }));

  const city = SARAWAK_CITIES.find(c => c.id === S.city) || SARAWAK_CITIES[0];
  const geoAreas = sarawakGeo?.cities?.[S.city]?.areas || {};
  const mapped = Object.keys(geoAreas);
  /* Geocoded localities first, then any gazetted district the geocode does not
     cover, then anything the reader has recorded against a locality of their
     own — a register has to be able to hold a place no list anticipated. */
  const recorded = [...new Set((State.observations || [])
    .filter(o => o.city === S.city && o.area).map(o => o.area))];
  const names = [...new Set([...mapped, ...(city.districts || []), ...recorded])];
  const canMap = mapped.length > 0;

  /* ---- filters, one row above everything they scope ---- */
  const bar = el('div', { class: 'card', style: 'padding:var(--sm) var(--md)' });
  const row = el('div', { class: 'row row-wrap', style: 'gap:var(--md);align-items:center' });
  const seg = (label, key, opts, onPick) => {
    const g = el('div', { class: 'row seg-group', style: 'gap:8px;align-items:center' });
    g.append(el('span', { class: 'caption', style: 'font-weight:600' }, label));
    /* aria-pressed carries the state, and the stylesheet keys on it;
       aria-selected means nothing on a plain button, so a screen reader heard
       fifteen identical buttons with no word of which layer was drawn. */
    g.append(el('div', { class: 'segmented' }, opts.map(([v, l]) =>
      el('button', { id: `af-${key}-${v}`, 'aria-pressed': S[key] === v ? 'true' : 'false',
        onclick: () => { if (onPick) onPick(v); else S[key] = v; renderKeepFocus(); } }, l))));
    return g;
  };

  /* TWENTY TOWNS IS A SELECT, NOT A STRIP.
     A segmented control is right for four options and wrong for twenty — it
     becomes a horizontally scrolling strip where most of the state is off
     screen. Grouped by division, because that is how the places relate to each
     other and how somebody looking for Dalat will go looking for it. */
  const townField = el('div', { class: 'row seg-group', style: 'gap:8px;align-items:center' });
  townField.append(el('label', { class: 'caption', style: 'font-weight:600', for: 'areaTown' }, 'Town'));
  /* "table only" is known once the positions are in: before that, and when
     they failed to load, every town read "— table only", Kuching included.
     Until they are in it is the towns with no map shape (CITY_MAP_SHAPE,
     70-property.js — held to the positions' file by build.mjs --check), so
     the choices are the same words before and after: the page is served
     before the positions arrive, and on a phone the field took 26px more
     with the shorter list, the page under it moving when they came (the
     integration's re-verification, 2026-10-04). */
  const townSel = el('select', { class: 'select select-sm', id: 'areaTown',
    onchange: e => { S.city = e.target.value; S.editing = null; renderKeepFocus(); } });
  Object.entries(SARAWAK_DIVISIONS).forEach(([division, towns]) => {
    const grp = el('optgroup', { label: `${division} Division` });
    towns.forEach(c => grp.append(el('option', { value: c.id, selected: S.city === c.id ? '' : null },
      /* Say which towns can be drawn, rather than letting a reader pick one and
         find the map missing with no explanation. */
      `${c.name}${(sarawakGeo ? sarawakGeo.cities?.[c.id] : CITY_MAP_SHAPE[c.id]) ? '' : ' — table only'}`)));
    townSel.append(grp);
  });
  townField.append(townSel);
  row.append(townField);

  row.append(seg('Shade by', 'layer', AREA_LAYERS.map(l => [l.id, l.label.replace(/,.*$/, '')])));
  bar.append(row);

  /* ---- the units rates are read in ---- */
  const unitRow = el('div', { class: 'row row-wrap',
    style: 'gap:var(--md);align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--grid)' });
  const unitSeg = (label, which, ids) => {
    const g = el('div', { class: 'row seg-group', style: 'gap:8px;align-items:center' });
    g.append(el('span', { class: 'caption', style: 'font-weight:600' }, label));
    g.append(el('div', { class: 'segmented' }, ids.map(id =>
      el('button', { id: `af-unit-${which}-${id}`, 
        'aria-pressed': State.rateUnits[which] === id ? 'true' : 'false',
        title: areaUnit(id).why,
        onclick: () => { setRateUnit(which, id); renderKeepFocus(); } }, areaUnit(id).short))));
    return g;
  };
  unitRow.append(unitSeg('Floor area in', 'built', BUILT_UP_UNITS));
  unitRow.append(unitSeg('Land in', 'land', LAND_UNITS.filter(u => u !== 'sqm')));
  bar.append(unitRow);
  bar.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    `${POINT_DEFINITION} Rates are held per square foot and converted for display, so the same transaction reads the same in every unit.`));

  /* One filter row per class attribute, generated from the registry. */
  AREA_ATTRS.filter(a => a.kind === 'class').forEach(attr => {
    const sel = S.classes[attr.id] || [];
    const r = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid var(--grid)' });
    r.append(el('span', { class: 'caption', style: 'font-weight:600;min-width:92px' }, attr.short));
    attr.classes.forEach(c => {
      const on = sel.includes(c.id);
      r.append(el('button', { id: `af-${attr.id}-${c.id}`, class: `chip${on ? ' chip-brand' : ''}`, 'aria-pressed': on ? 'true' : 'false',
        title: c.note, style: 'cursor:pointer', onclick: () => {
          S.classes[attr.id] = on ? sel.filter(x => x !== c.id) : [...sel, c.id]; renderKeepFocus();
        } }, c.label + (c.restricted ? ' · restricted' : '')));
    });
    bar.append(r);
  });

  const row3 = el('div', { class: 'row row-wrap', style: 'gap:var(--md);align-items:center;margin-top:8px' });
  const numFilter = (label, key, ph) => {
    const f = el('div', { class: 'row', style: 'gap:6px;align-items:center' });
    f.append(el('label', { class: 'caption', for: `af-${key}`, style: 'font-weight:600' }, label));
    f.append(el('input', { class: 'input input-inline', id: `af-${key}`, type: 'number', min: '0',
      value: S[key] == null ? '' : String(S[key]), placeholder: ph, style: 'width:88px',
      onchange: e => { S[key] = e.target.value === '' ? (key === 'minRecords' ? 0 : null) : num0(e.target.value); renderAfterTyping(); } }));
    return f;
  };
  row3.append(numFilter('Minimum records held', 'minRecords', '0'));
  row3.append(numFilter('Weeks vacant at most', 'maxWeeks', 'any'));
  row3.append(numFilter('Lease years at least', 'minLease', 'any'));
  row3.append(el('button', { id: 'af-clear', class: 'chip', style: 'cursor:pointer',
    onclick: () => { S.classes = {}; S.minRecords = 0; S.maxWeeks = null; S.minLease = null; renderKeepFocus(); } },
    'Clear filters'));
  bar.append(row3);
  wrap.append(bar);

  if (!names.length) {
    wrap.append(emptyState(geoLoadState === 'loading'
      ? 'Loading locality positions…'
      : geoLoadState === 'failed'
        ? `The locality positions could not be loaded, and nothing is recorded for ${city.name} yet. Reload the page to try again.`
        : `No mapped localities are held for ${city.name}. The map draws only places this build has a recorded position for; none has been invented.`));
    return wrap;
  }

  /* ---- apply the filters ---- */
  const layer = LAYER_BY_ID[S.layer] || AREA_LAYERS[0];
  /* A filter on an attribute excludes areas with nothing recorded, and that is
     the intended reading: "show me the recurrent-flood areas" cannot honestly
     include the ones nobody has checked. The unfiltered view is where absence
     is visible, and it is the default. */
  const passes = (n) => {
    const m = areaMetrics(S.city, n);
    for (const attr of AREA_ATTRS) {
      const want = S.classes[attr.id];
      if (want && want.length && !want.includes(areaAttr(S.city, n, attr.id)?.class)) return false;
    }
    if (S.minRecords && m.total < S.minRecords) return false;
    if (S.maxWeeks != null && !(isNum(m.lettingWeeks) && m.lettingWeeks <= S.maxWeeks)) return false;
    if (S.minLease != null) {
      const l = areaAttr(S.city, n, 'lease')?.value;
      if (!(isNum(l) && l >= S.minLease)) return false;
    }
    return true;
  };
  const shown = names.filter(passes);
  const bands = layerBands(layer, S.city, shown);

  /* ---- the map ---- */
  const mapCard = el('div', { class: 'card' });
  mapCard.append(cardHead(`${city.name} — ${layer.label.toLowerCase()}`, layer.why));

  const paint = (n) => {
    if (!shown.includes(n)) return null;
    return layerColour(layer, bands, layer.value(S.city, n));
  };
  paint.describe = (n) => {
    const t = layer.text(S.city, n);
    return t ? `${layer.label}: ${t}` : `${layer.label}: not recorded`;
  };
  /* The positions on their way to a town that has them: the card is drawn
     whole, round a box the map's size (cityMapHold, 70-property.js) — the
     page is served so, and a reader scrolled past it stays where they were
     when the map comes. */
  const holding = !canMap && !sarawakGeo && geoLoadState !== 'failed' && !!CITY_MAP_SHAPE[S.city];
  const mapHost = el('div', { style: 'margin-top:var(--md)' });
  mapCard.append(mapHost);
  mapHost.append(holding
    ? cityMapHold(S.city, 'Loading the locality positions. The map is drawn when they arrive; the table below works now.')
    : cityMap(S.city, S.editing, (n) => { S.editing = n; render(); }, paint));

  /* Legend — two series or more means one is never optional. */
  const legend = el('div', { class: 'row row-wrap', style: 'gap:var(--md);margin-top:var(--md)' });
  const swatch = (fill, text, dashed) => el('span', { class: 'caption', style: 'display:inline-flex;align-items:center;gap:6px' }, [
    el('span', { 'aria-hidden': 'true', style: `width:12px;height:12px;border-radius:50%;`
      + (dashed ? 'border:1.4px dashed var(--ink-3)' : `background:${fill}`) }),
    text]);
  if (layer.kind === 'class') layer.attr.classes.forEach(c =>
    legend.append(swatch(`var(${c.tone})`, c.label + (c.restricted ? ' · restricted' : ''))));
  else if (bands) {
    /* Each swatch is the colour layerColour gives that value — the colour its
       point is drawn in. They were the two ends of the ramp, which is right
       while the values differ; with one area recorded, or every area at one
       value, the point is drawn in the middle step and the legend showed two
       end colours, both labelled with that one value, neither on the map. */
    const said = (v) => layer.text(S.city, shown.find(n => layer.value(S.city, n) === v)) || fmtNum(v, 0);
    if (bands.lo === bands.hi) legend.append(swatch(layerColour(layer, bands, bands.lo),
      `${said(bands.lo)} (every area recorded here)`));
    else {
      legend.append(swatch(layerColour(layer, bands, bands.lo), `${said(bands.lo)} (lowest here)`));
      legend.append(swatch(layerColour(layer, bands, bands.hi), `${said(bands.hi)} (highest here)`));
    }
  }
  legend.append(swatch(null, 'Not recorded', true));
  mapCard.append(legend);
  if (layer.caveat) mapCard.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm);color:var(--bronze)' }, layer.caveat));
  mapCard.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    layer.kind === 'quantity'
      ? 'Shading is banded against the range present in this town, not an absolute scale — RM1,800 does not mean the same thing in Kuching and Bintulu, and the map is read one town at a time.'
      : 'Positions are geocoded approximations of the locality, not parcel boundaries. Confirm any address against the title and the Land and Survey Department.'));
  if (hasWorkedExample()) {
    const n = sampleObservations().length;
    const warn = el('div', { class: 'card', style: 'border-color:var(--bronze)' });
    warn.append(el('p', { class: 'body', style: 'font-weight:600;margin:0' },
      'The worked example is loaded — the shading and the medians below include invented figures.'));
    warn.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `${n} of the records behind this map were typed to demonstrate the tool. There is no property, no `
      + 'document and no transaction behind any of them. Districts carrying them are marked in the table. '
      + 'Remove the example before reading anything here as evidence.'));
    warn.append(workedExampleControls({ compact: true }));
    wrap.insertBefore(warn, wrap.firstChild.nextSibling);
  }

  if (canMap || holding) wrap.append(mapCard);
  /* NOT YET, OR NOT THIS TIME — NOT "NO COORDINATES".
     While the positions were in flight, and for good when they failed to
     load, the card below told a reader on Kuching that coordinates were
     retrieved "for Kuching, Sibu, Miri and Bintulu only" and that Kuching
     had no geocoded point to shade. */
  else if (!sarawakGeo) {
    const wait = el('div', { class: 'card' });
    const hd = cardHead(`${city.name} — map`, geoLoadState === 'failed'
      ? 'The locality positions could not be loaded, so the map cannot be drawn. The table below works without them. Reload the page to try again.'
      : 'Loading the locality positions. The map is drawn when they arrive; the table below works now.');
    /* "Loading" is this tab's, now (data-now, NOW in 35-ui.js): served, it
       was the page's first draw with nothing loaded, and to a reader with no
       script it said so for good. */
    if (geoLoadState !== 'failed') hd.querySelector('.caption')?.setAttribute('data-now', 'The map is drawn by this page’s script, from the locality positions it loads; the table below is the same without it.');
    wait.append(hd);
    wrap.append(wait);
  }
  else {
    /* NO GUESSED POSITIONS. Coordinates were retrieved for four towns; drawing
       the other sixteen from invented positions would put a locality on the
       wrong side of a river and shade it with real recorded evidence, which is
       a worse failure than having no picture at all. */
    const noMap = el('div', { class: 'card' });
    noMap.append(cardHead(`${city.name} — no map`,
      `Coordinates were retrieved for Kuching, Sibu, Miri and Bintulu only. Everything below works for ${city.name} exactly as it does for them; there is simply no geocoded point to shade, and a diagram of guessed positions would be worse than none.`));
    noMap.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      `Localities listed for ${city.name} are the gazetted administrative districts of the ${city.division} Division, plus any locality you have recorded yourself. They are not neighbourhood boundaries, and none of them implies a property market exists there.`));
    wrap.append(noMap);
  }

  /* ---- the same thing as a table, which is where the detail lives ---- */
  /* Headers carry the CURRENT unit rather than a fixed one. "RM/sq ft" printed
     above a column of square-metre rates is the kind of mislabelling that
     survives review because the numbers all look plausible. */
  const bu = areaUnit(builtUnit()).short, lu = areaUnit(landUnit()).short;
  const cols = ['Area', ...AREA_ATTRS.map(a => a.short),
    'Achieved rent', 'Weeks vacant',
    `Floor RM/${bu}`, `Land RM/${lu}`, `Charge RM/${bu}/mo`,
    'Last transacted', 'Records', ''];
  const t = el('table', { class: 'dt' });
  /* The last column, the Record buttons', is named for a screen reader: an
     empty header left each of its buttons announced with no column at all. */
  t.append(el('thead', {}, el('tr', {},
    cols.map((h, i) => el('th', { class: i ? null : 'pin', style: i ? null : 'text-align:left' }, h || el('span', { class: 'sr-only' }, 'Actions'))))));
  const tb = el('tbody');
  shown.forEach(n => {
    const m = areaMetrics(S.city, n);
    const attrCells = AREA_ATTRS.map(attr => {
      const rec = areaAttr(S.city, n, attr.id);
      if (!rec) return el('td', {}, el('span', { class: 'caption' }, 'not recorded'));
      const src = AREA_SOURCE_BY_ID[rec.source];
      /* The source rides in the title, not a column of its own: five
         attributes each needing a source column would be a fifteen-column
         table nobody can read on a phone. */
      const tip = `${src ? src.label : 'source not stated'}${rec.asOf ? ` · ${rec.asOf}` : ''}`
        + `${src && !src.verified ? ' · unverified' : ''}${rec.ref ? ` · ${rec.ref}` : ''}`;
      if (attr.kind === 'number') return el('td', { class: 'num', title: tip },
        isNum(rec.value) ? `${fmtNum(rec.value, 0)}` : '—');
      const c = attrClass(attr, rec.class);
      return el('td', { title: tip }, c
        ? el('span', { class: src && !src.verified ? 'chip chip-bronze' : 'chip' },
            c.label + (c.restricted ? ' · restricted' : ''))
        : el('span', { class: 'caption' }, 'not recorded'));
    });
    /* A rate is null when nothing supports it, and prints as a dash. A locality
       with transactions but no recorded areas genuinely has no price per unit,
       and showing one would mean inventing the divisor. */
    const rate = (perSqft, unit, dp) => {
      const v = rateInUnit(perSqft, unit);
      return isNum(v) ? fmtMoney(v, 'MYR', dp) : '—';
    };
    /* The most recent transaction THE READER RECORDED, with WHEN. Their own
       records are the only dated ones this product holds — NAPIC publishes no
       transaction dates — so this column can exist here and nowhere else.
       An amount without a date is the
       most misleading figure a property register can print: RM620,000 reads as
       current until you learn it was 2017. Both, or neither. */
    /* The newer of the two by the date it happened — areaMetrics' own
       lastTransaction, which the age layer reads too. `lastSold || lastLand`
       showed a 2019 house sale beside last month's parcel, and marked a sale
       as land only when no built sale existed at all. */
    const last = m.lastTransaction;
    const lastCell = () => {
      if (!last) return el('span', { class: 'caption' }, 'none recorded');
      const age = monthsSince(last.date);
      const isLand = last.kind === 'land-sold';
      return el('span', { title: `${OBS_BY_ID[last.kind] ? OBS_BY_ID[last.kind].label : last.kind}`
        + `${last.address ? ` · ${last.address}` : ''} · ${observationStanding(last).label}` }, [
        el('span', {}, fmtMoney(last.value, 'MYR', 0)),
        el('span', { class: 'metaline', style: 'display:block' },
          `${last.date}${isNum(age) ? ` · ${fmtNum(age, 0)} mo ago` : ''}${isLand ? ' · land' : ''}`),
      ]);
    };

    tb.append(el('tr', {}, [
      el('th', { class: 'pin ident', scope: 'row', style: 'text-align:left' }, n),
      ...attrCells,
      el('td', { class: 'num' }, isNum(m.achievedRent) ? `${fmtMoney(m.achievedRent, 'MYR', 0)}` : '—'),
      el('td', { class: 'num' }, isNum(m.lettingWeeks) ? fmtNum(m.lettingWeeks, 1) : '—'),
      el('td', { class: 'num', title: m.psfN ? `${m.psfN} transacted price(s) with a recorded floor area` : null },
        rate(m.psf, builtUnit(), rateDp(builtUnit()))),
      el('td', { class: 'num', title: m.landPsfN ? `${m.landPsfN} transacted land price(s) with a recorded land area` : null },
        rate(m.landPsf, landUnit(), rateDp(landUnit()))),
      el('td', { class: 'num', title: m.mgmtPsfN ? `${m.mgmtPsfN} service charge(s) with a recorded floor area` : null },
        rate(m.mgmtPsf, builtUnit(), 2)),
      el('td', { style: 'text-align:left' }, lastCell()),
      el('td', { class: 'num', title: m.sampleN
        ? `${m.sampleN} of these ${m.sampleN === 1 ? 'is a' : 'are'} worked-example record${m.sampleN === 1 ? '' : 's'}`
        : null },
        m.sampleN
          ? el('span', { class: 'chip chip-bronze' }, `${m.total} · ${m.sampleN} example`)
          : String(m.total)),
      el('td', {}, el('button', { id: areaRowButtonId(n), class: 'btn btn-quiet btn-sm',
        onclick: () => { S.editing = S.editing === n ? null : n; renderKeepFocus(); } },
        S.editing === n ? 'Close' : 'Record')),
    ]));
    if (S.editing === n) tb.append(el('tr', {},
      el('td', { colspan: cols.length, style: 'padding:0' }, areaRecorder(S.city, n))));
  });
  t.append(tb);
  const tCard = el('div', { class: 'card' });
  tCard.append(cardHead(`${shown.length} of ${names.length} localit${names.length === 1 ? 'y' : 'ies'}`,
    shown.length === names.length
      ? 'Every mapped locality in this town. Rent, vacancy and price columns are medians of your own records.'
      : 'Filtered. The map shades the same set.'));
  gridKeyboard(t, 'Localities by recorded attribute and rate. Arrow keys move between cells.');
  /* A size container, so the recorder in its row can be as wide as what shows
     of the table rather than the table itself — see areaRecorder. */
  tCard.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--md);container-type:inline-size' }, t));
  /* Sixteen columns can say what a locality is classified as. They cannot say
     what the classification MEANS, and the consequence is the half a buyer
     needs — "peat, 3 m or deeper" is a fact, "deep piling dominates build cost"
     is the reason to care. */
  if (S.editing) {
    /* THE LOCALITY BEING READ, CARRIED TO THE PROPERTY BEING MODELLED.
       A reader who screened Stutong and wanted to model a flat there went
       to the calculator and chose the town and the district again by hand.
       It is passed into the property on the calculator instead — its city
       and district, nothing else (usePlaceInCalculator,
       71-property-models.js). */
    const st = propertyStatus(State.deal);
    wrap.append(el('div', { class: 'card pm-handoff' }, [
      propertyPlaceListed(S.city, S.editing) ? el('p', { class: 'body', style: 'margin:0;flex:1 1 320px' }, [
        el('strong', {}, `${S.editing}, ${city.name}`),
        ` — model a property here. The district of ${st.kind === 'model' ? `“${st.rec.name}”` : 'the deal on the calculator'} becomes ${S.editing}; its figures stay as they are.`]) : null,
      usePlaceControl(S.city, S.editing, { id: 'area-use-in-calc' }),
    ]));
    wrap.append(officialBenchmarkPanel(S.city, S.editing));
    wrap.append(localityTransactionPanel(S.city, S.editing));
    wrap.append(landRiskPanel(S.city, S.editing));
  }
  tCard.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Rent, vacancy and price columns are medians over the comparables register and move as you add to it. '
    + 'A dash is an absence of evidence, never a zero.'));
  wrap.append(tCard);

  wrap.append(el('div', { class: 'card' }, [
    cardHead('What this screen cannot tell you',
      'Named, because a map is the most persuasive thing this product draws.'),
    el('ul', { class: 'ticklist blocklist' }, [
      el('li', {}, 'No flood hazard model, depth, return period or official flood zone is held here. A class appears only where somebody recorded one against a named source, and "no known history" means it was checked and nothing was found — not that the area is safe.'),
      el('li', {}, 'Title classification recorded from user input. Eligibility has not been verified. Confirm with a Sarawak property lawyer and the Land and Survey Department. A predominant class is a description of a locality and says nothing certain about any individual title within it.'),
      el('li', {}, 'Drainage works and insurer appetite are both dated facts that move. A scheme completes; an insurer withdraws after a flood year. The date beside each is part of the record, not decoration.'),
      el('li', {}, 'Rent, vacancy and price figures are medians of your own register. Where an area holds two records, the median is two records, and it will move.'),
      el('li', {}, 'Positions are geocoded approximations of a locality name. They are not parcel boundaries and cannot establish whether a specific title is affected.'),
      el('li', {}, 'Nothing here is a valuation, and nothing here is a recommendation to buy in one area over another.'),
    ]),
  ]));
  return wrap;
};

/* The recorder. Deliberately demands a source before it will call anything
   verified — the register is only worth having if a later reader can tell a
   DID record from something a neighbour mentioned. */
function areaRecorder(city, area) {
  /* As wide as the visible part of the table, and held at its left edge. It
     sat in a cell spanning all sixteen columns, so it was the table's width —
     1,674px — and inside a 310px scrolling wrapper on a phone every sentence
     and field ran off the right edge ("Each fact is saved on its own, with its
     own source and date…"), and the recorder opened out of sight to the left
     of the Record button a reader had scrolled across to press. It also
     inherited the cell's nowrap, so no sentence in it wrapped at any width. */
  const box = el('div', { class: 'sunk',
    style: 'margin:var(--sm);width:calc(100cqw - 2 * var(--sm));box-sizing:border-box;position:sticky;left:var(--sm);white-space:normal' });
  box.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:8px' }, `Record for ${area}`));
  box.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' },
    'Each fact is saved on its own, with its own source and date — a title class established from the title '
    + 'document and a flood account from a neighbour are not the same evidence and are never dated together.'));

  /* WHAT IS ENTERED AND NOT YET SAVED IS HELD IN STATE, NOT IN THE DRAWING.
     Each section's entries lived in a closure made when the page was drawn,
     and every Save redraws the page: a flood class picked, then the title
     class saved, came back "Not recorded", and Save under flood then said
     there was nothing to save. The redraw when the filings land did the same
     to whatever had been entered by then. A section's entries are held here
     from its first edit, per locality, read by each drawing, and let go when
     the section is saved or removed or the recorder closes. A section not
     edited is drawn from what is recorded, so a change made elsewhere (Undo
     on the register, another tab) shows. */
  const key = `${city}|${area}`;
  if (State.areaScreen.drafts?.key !== key) State.areaScreen.drafts = { key, byAttr: {} };
  const drafts = State.areaScreen.drafts.byAttr;

  AREA_ATTRS.forEach(attr => {
    const cur = areaAttr(city, area, attr.id);
    const draft = drafts[attr.id] || { class: cur?.class || '', value: isNum(cur?.value) ? cur.value : null,
      source: cur?.source || 'unstated', asOf: cur?.asOf || '', ref: cur?.ref || '' };
    const put = (k, v) => { draft[k] = v; drafts[attr.id] = draft; };

    const sec = el('div', { style: 'padding:var(--md) 0;border-top:1px solid var(--grid)' });
    sec.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:baseline' }, [
      el('h5', { style: 'font-size:14px;font-weight:600;margin:0' }, attr.label),
      cur ? el('span', { class: 'chip chip-ok', style: 'margin-left:auto' }, 'recorded') : null,
    ]));
    if (attr.caveat) sec.append(el('p', { class: 'metaline', style: 'margin-top:4px;color:var(--bronze)' }, attr.caveat));

    const uid = `ar-${attr.id}`;
    const f1 = el('div', { class: 'assumption' });
    if (attr.kind === 'class') {
      f1.append(el('label', { for: uid }, 'Classification'));
      const sc = el('select', { class: 'select a-text', id: uid, 'aria-label': `${attr.label} classification`,
        onchange: e => put('class', e.target.value) });
      sc.append(el('option', { value: '' }, 'Not recorded'));
      attr.classes.forEach(c => sc.append(el('option', { value: c.id, selected: draft.class === c.id ? '' : null },
        `${c.label} — ${c.note}`)));
      f1.append(sc);
    } else {
      f1.append(el('label', { for: uid }, `Value (${attr.unit})`));
      f1.append(el('input', { class: 'input a-text', id: uid, type: 'number', min: '0',
        value: draft.value == null ? '' : String(draft.value), 'aria-label': `${attr.label} in ${attr.unit}`,
        onchange: e => put('value', e.target.value === '' ? null : num0(e.target.value)) }));
    }
    sec.append(f1);

    const f2 = el('div', { class: 'assumption' });
    f2.append(el('label', { for: `${uid}-src` }, 'Established from'));
    const ss = el('select', { class: 'select a-text', id: `${uid}-src`, 'aria-label': `Source for ${attr.label}`,
      onchange: e => put('source', e.target.value) });
    AREA_SOURCES.forEach(s => ss.append(el('option', { value: s.id, selected: draft.source === s.id ? '' : null },
      s.label + (s.verified ? '' : ' (unverified)'))));
    f2.append(ss); sec.append(f2);

    const f3 = el('div', { class: 'assumption' });
    f3.append(el('label', { for: `${uid}-asof` }, 'As at'));
    f3.append(el('input', { class: 'input a-text', id: `${uid}-asof`, type: 'date', value: draft.asOf,
      'aria-label': `Date ${attr.label} was established`, onchange: e => put('asOf', e.target.value) }));
    sec.append(f3);

    const f4 = el('div', { class: 'assumption' });
    f4.append(el('label', { for: `${uid}-ref` }, 'Reference'));
    f4.append(el('input', { class: 'input a-text', id: `${uid}-ref`, type: 'text', value: draft.ref,
      placeholder: 'Document, map sheet, policy or file number, or who said it',
      'aria-label': `Reference for ${attr.label}`, onchange: e => put('ref', e.target.value) }));
    sec.append(f4);

    sec.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--sm)' }, [
      el('button', { id: `${uid}-save`, class: 'btn btn-ghost btn-sm', onclick: () => {
        const empty = attr.kind === 'class' ? !draft.class : !isNum(draft.value);
        if (empty) { toast(`Enter a value for ${attr.short.toLowerCase()}, or use Remove`); return; }
        setAreaAttr(city, area, attr.id, draft); delete drafts[attr.id];
        renderKeepFocus(); toast(`${attr.short} recorded for ${area}`);
      } }, 'Save'),
      /* Remove goes with what it removed, so focus moves to Save beside it. */
      cur ? el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
        setAreaAttr(city, area, attr.id, null); delete drafts[attr.id];
        render(); document.getElementById(`${uid}-save`)?.focus(); toast(`${attr.short} cleared for ${area}`);
      } }, 'Remove') : null,
    ]));
    box.append(sec);
  });

  box.append(el('div', { class: 'row', style: 'margin-top:var(--md)' },
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      State.areaScreen.editing = null; render(); document.getElementById(areaRowButtonId(area))?.focus();
    } }, 'Close')));
  box.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'Held in this browser only, alongside the comparables register. Back it up from Your data.'));
  return box;
}

VIEWS.comparables = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  /* The one head every product page wears (pageHead, 36-layouts.js). */
  wrap.append(pageHead({ title: 'Sarawak comparables register', lede: 'Transacted prices and achieved rents you have recorded, each with its source.',
    note: 'With what each one rests on. Asking and achieved are never combined, and a figure with no source is marked as a note rather than evidence.' }));

  /* WHO IS RECORDING, AND UNDO.
     Both belong here rather than in a settings page: this is the screen someone
     sits on while keying in forty transactions, and a name they have to go
     somewhere else to set is a name that stays blank. */
  const admin = el('div', { class: 'card' });
  admin.append(cardHead('Recording as',
    'Every change is logged with this name. Leave it blank if you are the only one recording — the history still works, it simply says nobody in particular.'));
  const actorRow = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:flex-end' });
  const actorField = el('div', { class: 'field', style: 'flex:1 1 220px;margin:0' });
  actorField.append(el('label', { for: 'registerActorInput' }, 'Name or initials'));
  const actorInput = el('input', { class: 'input', id: 'registerActorInput', type: 'text',
    value: registerActor(), placeholder: 'e.g. AL — sourcing agent' });
  actorInput.addEventListener('change', e => { setRegisterActor(e.target.value); toast(e.target.value.trim() ? `Recording as ${e.target.value.trim()}` : 'Recording without a name'); });
  actorField.append(actorInput);
  actorRow.append(actorField);

  if (hasWorkedExample()) {
    admin.append(el('p', { class: 'metaline', style: 'margin-top:var(--md);color:var(--bronze)' },
      `${sampleObservations().length} of the records below are the worked example — invented figures, marked on every row. They are counted in the medians on the area screen, which is what makes the demonstration work and what makes removing them the first thing to do before relying on anything.`));
    admin.append(workedExampleControls({ compact: true }));
  }

  const logN = registerLog().length;
  /* Focus stays on Undo, or on the name field beside it once nothing is left
     to undo and the button is disabled. */
  const undoBtn = el('button', { id: 'register-undo', class: 'btn btn-ghost btn-sm', disabled: !canUndoRegister() ? '' : null,
    onclick: () => {
      const what = undoLastRegisterChange(); renderKeepFocus();
      if (document.activeElement === document.body) document.getElementById('registerActorInput')?.focus();
      toast(what || 'Nothing left to undo');
    } },
    'Undo last change');
  actorRow.append(undoBtn);
  admin.append(actorRow);
  /* The integrity line. A history that cannot account for the figures beside
     it is worse than no history, because it invites trust it has not earned. */
  const integ = registerIntegrity();
  admin.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    integ.state === 'ok'
      ? `History checked: replaying all ${integ.events} events reproduces every one of the ${integ.held} record${integ.held === 1 ? '' : 's'} held, exactly.`
      : integ.state === 'unverifiable'
        ? `History cannot be fully checked — ${integ.why}. The ${integ.held} record${integ.held === 1 ? '' : 's'} held ${integ.held === 1 ? 'is' : 'are'} still correct; only the trail behind the oldest is incomplete.`
        : `History does not account for what is held: ${integ.missing} record${integ.missing === 1 ? '' : 's'} with no events, ${integ.extra} in the log but not held, ${integ.differing} differing. Something wrote around the recorder — export before making further changes.`));

  admin.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    logN ? `${logN} change${logN === 1 ? '' : 's'} recorded. Corrections and deletions are kept as entries rather than erasing what they replaced, so a figure can always be traced back.`
         : 'No changes recorded yet. From the first one, every correction and deletion is kept as an entry rather than erasing what it replaced.'));

  const rows = State.observations || [];
  const stand = rows.map(o => ({ o, s: observationStanding(o) }));
  const counts = stand.reduce((a, x) => { a[x.s.id] = (a[x.s.id] || 0) + 1; return a; }, {});

  const head = el('div', { class: 'card' });
  head.append(cardHead(`${rows.length} record${rows.length === 1 ? '' : 's'}`,
    rows.length ? 'Standing is decided by the source, not by the number.'
                : 'The register is empty, which is the true state of the evidence rather than a gap in the software.'));
  if (rows.length) {
    /* Every standing has a tile, so the tiles add up to the count above them.
       A worked-example row has its own standing and had no tile: with the
       example loaded the card read "17 records" over tiles totalling 1. */
    const tiles = [['Verified', counts.verified || 0], ['Awaiting review', counts.awaiting_review || 0],
       ['Sourced', counts.sourced || 0], ['No source', counts.unsourced || 0],
       ...(counts.sample ? [['Worked example', counts.sample]] : [])];
    head.append(el('div', { class: tiles.length > 4 ? 'grid grid-5' : 'grid g-4', style: 'margin-top:var(--md)' },
      tiles.map(([k, v]) => el('div', { class: 'panel' }, statTile(k, String(v))))));
  } else {
    head.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:var(--md);max-width:60ch' },
      'Roughly forty sources were tested for Sarawak transaction and rental evidence and none can be redistributed by this product — the review is on the data-sources page. That leaves one honest option: evidence a person gathers and can point at. Record it from the district panel on the calculator, where the city and district are already set.'));
    head.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' }, WORKED_EXAMPLE_NOTE));
    head.append(workedExampleControls());
    head.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
      el('a', { class: 'btn btn-ghost btn-sm', href: href('/property/calculator'),
        onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/calculator'); } },
        'Open the calculator to record one'),
      el('a', { class: 'btn btn-ghost btn-sm', href: href('/data-sources'),
        onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/data-sources'); } },
        'Why nothing can be loaded'),
    ]));
  }
  wrap.append(head);

  if (rows.length) {
    const t = el('table', { class: 'dt register-dt' });
    t.append(el('thead', {}, el('tr', {}, ['Standing', 'What', 'Amount', 'Area', 'Rate', 'Ownership',
      'Where', 'Address or project', 'Dated', 'Source', ''].map((h, i, all) =>
      el('th', { class: i === all.length - 1 ? 'pin-end' : null, style: 'text-align:left' }, h)))));
    const tb = el('tbody');
    stand.forEach(({ o, s }) => {
      const kind = OBS_BY_ID[o.kind];
      /* A record's area is shown in the unit it was TYPED in, not the unit it
         is stored in. Somebody who entered eight points should not have to
         recognise their own parcel as 3,484.8 square feet. */
      const isLand = kind && kind.area === 'land';
      const storedSqft = isLand ? o.landSqft : o.sqft;
      const typedUnit = isLand ? (o.landUnit || 'point') : (o.areaUnit || 'sqft');
      const areaCell = isNum(storedSqft) && storedSqft > 0
        ? fmtArea(fromSqft(storedSqft, typedUnit), typedUnit)
        : '—';
      /* A cost per unit needs two decimals and a price does not: a service
         charge of RM0.06 a square foot rounds to RM0.1 at one decimal, which
         reads as nearly double and answers a different question from the one
         asked.
         The rate, in the same unit the area was given in — so a point purchase
         reads per point and a condominium reads per square foot, without the
         reader setting anything. */
      const rateCell = kind && kind.area && isNum(storedSqft) && storedSqft > 0 && isNum(o.value)
        ? `${fmtMoney(o.value / fromSqft(storedSqft, typedUnit), 'MYR', kind.family === 'cost' ? 2 : rateDp(typedUnit))}/${areaUnit(typedUnit).short}`
          + (kind.family === 'cost' ? '/mo' : '')
        : '—';
      const title = TITLE_TYPES.find(x => x.id === o.titleType);
      tb.append(el('tr', {}, [
        el('td', { style: 'text-align:left' }, el('span', { class: s.tone, title: s.why }, s.label)),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
          `${kind ? kind.label : o.kind}${kind && kind.asking ? ' · quoted, not achieved' : ''}`),
        el('td', { class: 'num', style: 'text-align:left' },
          `${fmtNum(o.value, 0)}${kind ? ` ${kind.unit.replace('RM', '').trim()}` : ''}`),
        el('td', { class: 'num', style: 'text-align:left' }, areaCell),
        el('td', { class: 'num', style: 'text-align:left' }, rateCell),
        el('td', { style: 'text-align:left' }, title
          ? el('span', { class: title.restricted ? 'chip chip-bronze' : 'chip', title: title.note }, title.label)
          : el('span', { class: 'caption' }, '—')),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, `${o.area || '—'}, ${townName(o.city)}`),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, o.address || '—'),
        el('td', { class: 'caption', style: 'text-align:left' }, o.date || '—'),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, o.sourceRef || '—'),
        /* Pinned to the right edge (.pin-end): the control each row exists for
           stays in view when the table is wider than its card. */
        el('td', { class: 'pin-end', style: 'text-align:left' }, el('button', { class: 'btn btn-ghost btn-sm', id: obsOpenId(o),
          onclick: () => openObservationDrawer(o) }, 'Open')),
      ]));
    });
    t.append(tb);
    gridKeyboard(t, 'Comparables register. Arrow keys move between cells.');
    wrap.append(el('div', { class: 'card' }, el('div', { class: 'tablewrap' }, t)));
  }

  wrap.append(admin);

  /* THE WORK HAS TO BE ABLE TO LEAVE THE MACHINE IT WAS DONE ON.
     Records live in this browser's localStorage. Somebody sourcing a district's
     transactions builds a week of work that a cleared browser, a second laptop
     or a different profile destroys with no copy anywhere — and there was no
     way to hand it to anyone either. */
  const io = el('div', { class: 'card' });
  io.append(cardHead('Move this evidence',
    'Records are held in this browser only. Export is how the work survives a cleared browser, and how it reaches somebody else.'));

  const dl = (name, text, type) => {
    const blob = new Blob([text], { type });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const CSV_COLS = ['id', 'city', 'area', 'propertyType', 'address', 'kind', 'value', 'unit',
                    'date', 'evidence', 'sourceRef', 'reviewedBy', 'sqft', 'areaUnit',
                    'landSqft', 'landUnit', 'titleType', 'standing'];
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

  io.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      if (!rows.length) { toast('Nothing to export yet'); return; }
      dl('quantum-comparables.json', JSON.stringify({
        format: 'quantum-tradeworks/comparables', version: 2,
        exportedAt: new Date().toISOString(),
        records: rows,
        /* Only the events about these records. A whole-log dump would carry area
           attributes and other districts into a file labelled comparables. */
        history: registerLog().filter(e => e.entity === 'observation'),
      }, null, 2), 'application/json');
    } }, `Export JSON${rows.length ? ` — ${rows.length}` : ''}`),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      if (!rows.length) { toast('Nothing to export yet'); return; }
      const lines = [CSV_COLS.join(',')].concat(rows.map(o => CSV_COLS.map(c =>
        csvCell(c === 'unit' ? (OBS_BY_ID[o.kind] || {}).unit
              : c === 'standing' ? observationStanding(o).id : o[c])).join(',')));
      dl('quantum-comparables.csv', lines.join('\n'), 'text/csv');
    } }, 'Export CSV'),
    /* Beside its two exports, in their weight: the page's one primary action
       is what fills the register first (Release B, B5), and on an empty one
       two filled buttons asked the reader to choose between them. */
    el('button', { class: 'btn btn-ghost btn-sm', id: 'register-import', onclick: () => openComparableImport() }, 'Import'),
  ]));
  io.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'CSV is for reading; JSON brings back every field of each record, worked-example marks and land areas included. The file also carries the change history for reading — an import starts each record\'s history afresh, at the import. Import skips a record it already holds rather than doubling its weight in a median — same district, kind, amount and date is the same transaction however many times it is pasted.'));
  wrap.append(io);

  const rules = el('div', { class: 'card' });
  rules.append(cardHead('What this register will not do', 'Named, because each one is a way a comparables list normally goes wrong.'));
  const rl = el('ul', { class: 'ticklist blocklist' });
  ['Ship with rows already in it. A populated register on a build that holds no licensed Sarawak evidence would be inventing the market this layer exists because nobody publishes.',
   'Republish anyone\'s listing or transaction data. What is here is what you recorded from something you can point at.',
   'Average asking against achieved. A quoted rent and a signed tenancy are different facts about different things.',
   'Rank districts or call one a better area. It reports what was recorded and how many readings that is.',
   'Treat a figure with no source as evidence. It is kept, because a half-remembered number is worth writing down before it is lost, and it is labelled a note.',
  ].forEach(x => rl.append(el('li', {}, x)));
  rules.append(rl);
  rules.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'Held in this browser only. It is never sent anywhere, it is not published with the site, and it carries no redistribution right.'));
  wrap.append(rules);
  return wrap;
};

/* A record's town by the name every page shows. The register printed the
   stored id — "Tabuan, kuching" — beside rows that said "Kuching". */
const townName = (id) => SARAWAK_CITIES.find(c => c.id === id)?.name || id || '—';

/* Bulk entry. A district's worth of transactions through a seven-control inline
   form is an afternoon of clicking and a reliable source of typing errors. */
function openComparableImport() {
  const body = el('div');
  body.append(el('p', { class: 'body', style: 'margin-bottom:var(--md)' },
    'Paste JSON exported from this register, or a CSV whose first row names the columns. Nothing is written until you have seen what would be added.'));
  body.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' },
    `CSV columns: city, area, propertyType, address, kind, value, date, evidence, sourceRef, reviewedBy, sqft. `
    + `kind is one of ${OBSERVATION_KINDS.map(k => k.id).join(', ')}. date is YYYY-MM-DD. `
    + `A row with no sourceRef imports as a note, not as evidence.`));
  const ta = el('textarea', { class: 'input', style: 'min-height:200px;font-family:var(--mono,monospace);font-size:12px',
    placeholder: 'Paste JSON or CSV here' });
  body.append(ta);
  const report = el('div', { style: 'margin-top:var(--md)' });
  body.append(report);

  const parse = (text) => {
    const t = text.trim();
    if (!t) return { rows: [], errors: ['Nothing pasted.'] };
    if (t.startsWith('[') || t.startsWith('{')) {
      try {
        const j = JSON.parse(t);
        /* Three shapes, because all three exist in the wild now: a bare array
           (what this register exported before it carried history), the v2
           envelope it exports today, and a single record someone pasted by
           hand. Missing the envelope would read {format, records, history} as
           one malformed row and reject a file this very screen produced. */
        if (Array.isArray(j)) return { rows: j, errors: [] };
        if (Array.isArray(j.records)) return { rows: j.records, errors: [] };
        return { rows: [j], errors: [] };
      } catch (e) { return { rows: [], errors: [`That is not valid JSON — ${e.message}`] }; }
    }
    /* CSV. Quoted fields with embedded commas are handled; anything more exotic
       belongs in the JSON path rather than in a parser nobody can audit. */
    const lines = t.split(/\r?\n/).filter(l => l.trim());
    const split = (line) => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true;
        else if (ch === ',') { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur); return out.map(s => s.trim());
    };
    const head = split(lines[0]).map(h => h.replace(/^﻿/, ''));
    return { rows: lines.slice(1).map(l => {
      const cells = split(l); const o = {};
      head.forEach((h, i) => { if (cells[i] !== undefined && cells[i] !== '') o[h] = cells[i]; });
      return o;
    }), errors: [] };
  };

  const normalise = (r) => {
    const kind = String(r.kind || '').trim();
    const value = Number(r.value);
    if (!OBS_BY_ID[kind]) return { err: `kind "${r.kind}" is not one of ${OBSERVATION_KINDS.map(k => k.id).join(', ')}` };
    if (!Number.isFinite(value) || value <= 0) return { err: `value "${r.value}" is not a number above zero` };
    if (!r.city) return { err: 'no city' };
    /* THE TOWN AS EVERY PAGE KEYS IT. The city was stored as pasted, so
       "Kuching" — the name every page shows — sat beside the id "kuching"
       and its rows were read nowhere: the calculator's district panel, the
       area screen, the grade and the exit gate all match the id. Matched by
       id or name in any case, and refused, with its reason, when it is no
       town this register keeps. A district on the town's list is spelt as
       the list spells it; one that is not stays as typed, a locality of the
       reader's own, as the area screen allows. */
    const town = SARAWAK_CITIES.find(c => slugParam(c.id) === slugParam(r.city) || slugParam(c.name) === slugParam(r.city));
    if (!town) return { err: `city "${r.city}" is not one of the Sarawak towns this register keeps` };
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) return { err: `date "${r.date}" is not YYYY-MM-DD` };
    /* A calendar date, not only its shape: 2026-13-45 passed. */
    const day = new Date(`${r.date}T00:00:00Z`);
    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== String(r.date)) return { err: `date "${r.date}" is not a date on the calendar` };
    const ev = String(r.evidence || 'user');
    if (!EVIDENCE.some(e => e.id === ev)) return { err: `evidence "${ev}" is not a known source class` };
    /* EVERY FIELD THE EXPORT WRITES COMES BACK. The record was rebuilt from
       eleven fields, so a worked-example row came back without `sample` —
       sixteen invented transactions re-entered the medians as ordinary
       sourced records, unlabelled — and a land sale came back without its
       land area. An area that is absent stays absent: Number(null) is 0,
       which turned a missing floor area into a measured one of nought.
       A row is an example if it says so, in JSON or in the CSV's standing. */
    const areaOf = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) || !(Number(v) > 0)) ? null : Number(v);
    const unit = (v, fallback) => (v && AREA_UNIT_BY_ID[v]) ? v : fallback;
    const title = String(r.titleType || '');
    return { ok: { city: town.id, area: listedDistrict(town.id, r.area) || String(r.area || ''), kind, value,
                   date: String(r.date), evidence: ev,
                   propertyType: String(r.propertyType || ''), address: String(r.address || ''),
                   sourceRef: String(r.sourceRef || ''), reviewedBy: String(r.reviewedBy || ''),
                   reviewedAt: String(r.reviewedAt || ''),
                   sqft: areaOf(r.sqft), areaUnit: unit(r.areaUnit, 'sqft'),
                   landSqft: areaOf(r.landSqft), landUnit: unit(r.landUnit, 'point'),
                   titleType: TITLE_TYPES.some(t => t.id === title) ? title : '',
                   ...(r.sample === true || r.sample === 'true' || r.standing === 'sample' ? { sample: true } : {}) } };
  };

  const isDup = (a, b) => a.city === b.city && a.area === b.area && a.kind === b.kind
                       && Number(a.value) === Number(b.value) && a.date === b.date;

  body.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
      const { rows: raw, errors } = parse(ta.value);
      report.replaceChildren();
      if (errors.length) { report.append(el('p', { class: 'body', style: 'color:var(--dn-text)' }, errors[0])); return; }
      const ok = [], bad = [], dup = [];
      raw.forEach((r, i) => {
        const n = normalise(r);
        if (n.err) { bad.push(`Row ${i + 1}: ${n.err}`); return; }
        if ((State.observations || []).some(x => isDup(x, n.ok)) || ok.some(x => isDup(x, n.ok))) { dup.push(n.ok); return; }
        ok.push(n.ok);
      });
      const sum = el('ul', { class: 'ticklist' });
      sum.append(el('li', {}, `${ok.length} would be added.`));
      if (dup.length) sum.append(el('li', {}, `${dup.length} already held and would be skipped.`));
      report.append(sum);
      if (bad.length) {
        const bl = el('ul', { class: 'ticklist blocklist', style: 'margin-top:8px' });
        bad.slice(0, 8).forEach(x => bl.append(el('li', {}, x)));
        if (bad.length > 8) bl.append(el('li', {}, `…and ${bad.length - 8} more.`));
        report.append(bl);
        report.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
          'Rejected rows are not imported and not partially imported. Fix them and paste again.'));
      }
      if (!ok.length) return;
      const examples = ok.filter(x => x.sample).length;
      if (examples) report.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
        `${examples} of these are worked-example rows. They stay marked as invented wherever they are shown, and leave when the worked example is removed.`));
      const unsourced = ok.filter(x => !x.sourceRef).length;
      if (unsourced) report.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
        `${unsourced} of these carry no source reference and will be held as notes rather than evidence.`));
      report.append(el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:var(--md)', onclick: () => {
        ok.forEach(x => addObservation(x));
        /* The drawer hands focus back to the Import button that opened it —
           which render() has just replaced, so it fell to <body>. Back to the
           new one, by id. */
        closeDrawer({ restore: false }); render();
        document.getElementById('register-import')?.focus();
        toast(`${ok.length} record${ok.length === 1 ? '' : 's'} imported${dup.length ? `, ${dup.length} skipped` : ''}`);
      } }, `Import ${ok.length} record${ok.length === 1 ? '' : 's'}`));
    } }, 'Check this paste'),
  ]));
  openDrawer('Import comparables', body);
}

/* One record, with the fields the calculator's compact form has no room for. */
function openObservationDrawer(o) {
  const body = el('div');
  /* The standing and the history are redrawn after every edit. They were
     built once, so naming a reviewer turned the table's chip to Verified
     while the open drawer still said Awaiting review, and the edit just
     logged was missing from the History below it. */
  const chipRow = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:var(--md)' });
  const whyP = el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' });
  const histHost = el('div');
  const paint = () => {
    const cur = (State.observations || []).find(x => x.id === o.id) || o;
    const s = observationStanding(cur);
    chipRow.replaceChildren(el('span', { class: s.tone }, s.label));
    whyP.textContent = s.why;
    histHost.replaceChildren();
    /* WHAT HAPPENED TO THIS RECORD.
       A register that only shows the current figure asks the reader to trust
       that it was always that figure. This is the whole reason the log exists,
       so it is shown where the figure is edited rather than filed away in a
       settings page nobody opens. */
    const hist = registerHistory('observation', o.id);
    if (hist.length) {
      histHost.append(el('h3', { class: 'h-card', style: 'margin-top:var(--lg)' }, 'History'));
      const ul = el('ul', { class: 'log-list' });
      hist.slice(0, 12).forEach(e => ul.append(el('li', { class: 'metaline' }, registerEventText(e))));
      if (hist.length > 12) ul.append(el('li', { class: 'metaline' }, `… and ${hist.length - 12} earlier change${hist.length - 12 === 1 ? '' : 's'}`));
      histHost.append(ul);
    }
  };
  body.append(chipRow, whyP);

  const edit = (label, key, kind, unit) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    /* Tied to its field. The label stood beside an input with no id, so all
       five fields reached a screen reader as unnamed edit boxes. */
    const id = `obs-edit-${key}`;
    f.append(el('label', { for: id }, label));
    /* An area kept in square feet is shown and corrected in the unit it was
       typed in (unit), as the register shows it: 4 points, not 1,742.4. */
    const shown = unit ? fromSqft(o[key], unit) : o[key];
    const node = kind === 'number'
      ? el('input', { class: 'input', id, type: 'number', value: isNum(shown) ? String(unit ? +shown.toFixed(areaUnit(unit).dp) : shown) : '' })
      : el('input', { class: 'input', id, type: 'text', value: o[key] || '' });
    node.addEventListener('change', e => {
      const typed = kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
      const v = unit && isNum(typed) ? toSqft(typed, unit) : typed;
      const i = State.observations.findIndex(x => x.id === o.id);
      if (i > -1) {
        recordObservationEdited(o.id, key, State.observations[i][key], v);
        State.observations[i] = { ...State.observations[i], [key]: v };
        saveObservations();
      }
      o[key] = v;
      render(); paint();
    });
    f.append(node);
    body.append(f);
  };
  edit('Address or project', 'address');
  edit('Property type', 'propertyType');
  /* A land record's area is its land area. The drawer offered only the
     built-up area — a field a land sale never uses — so the 4 points behind
     the register's RM45,000/pt could be neither seen nor corrected, and a
     figure typed there changed nothing the register showed. */
  if (OBS_BY_ID[o.kind]?.area === 'land') edit(`Land area (${areaUnit(o.landUnit || 'point').label})`, 'landSqft', 'number', o.landUnit || 'point');
  else edit('Built-up area (sq ft)', 'sqft', 'number');
  edit('Source reference — the filing, listing, tenancy or document this came from', 'sourceRef');
  edit('Checked against the source by', 'reviewedBy');

  const kv = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
  /* recordedAt is stored as the UTC minute, and was printed as stored with no
     zone — eight hours early in Kuching, and the day before until 08:00. Shown
     on the reader's clock with its offset, as the History below it is. */
  const recAt = o.recordedAt ? new Date(`${String(o.recordedAt).replace(' ', 'T')}:00Z`) : null;
  const recorded = recAt && !Number.isNaN(recAt.getTime()) ? caseRaisedAt(recAt) : (o.recordedAt || '—');
  [['Recorded', recorded], ['Dated', o.date || '—'],
   ['Evidence class', evidenceOf(o.evidence).label], ['District', `${o.area || '—'}, ${townName(o.city)}`]]
    .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, String(v))); });
  body.append(kv);
  /* The record's district, carried to the property on the calculator — as
     the area screen carries a locality (usePlaceInCalculator). The drawer
     goes with the page it belonged to (afterRoute). */
  if (o.city && o.area) body.append(el('div', { style: 'margin-top:var(--md)' }, usePlaceControl(o.city, o.area, { id: 'obs-use-in-calc' })));
  body.append(histHost);
  paint();

  /* The row that opened the drawer is gone, so focus cannot go back to it —
     the drawer tried, found it detached, and left the keyboard on <body>.
     It goes to the row that took its place, or the one before it, or to
     Undo when the register is empty — the toast points there. */
  body.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--md)', onclick: () => {
    recordObservationDeleted(State.observations.find(x => x.id === o.id) || o);
    const at = State.observations.findIndex(x => x.id === o.id);
    State.observations = State.observations.filter(x => x.id !== o.id);
    const next = at < 0 ? null : State.observations[at] || State.observations[at - 1] || null;
    saveObservations(); closeDrawer({ restore: false }); render();
    document.getElementById(next ? obsOpenId(next) : 'register-undo')?.focus();
    toast('Record deleted — undo from the register');
  } }, 'Delete this record'));
  openDrawer(`${OBS_BY_ID[o.kind] ? OBS_BY_ID[o.kind].label : 'Observation'} · ${fmtNum(o.value, 0)}`, body);
}

VIEWS.status = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Status'),
    el('h1', {}, 'What is built, what is gated, and what is holding it'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Nothing here is removed when it cannot yet work. It is labelled, and the thing blocking it is named — a capability with no stated gate and no owner is a promise, not a plan.'),
  ])));
  wrap.append(healthSection());   /* Does each tool work? — 91-health.js */

  const key = el('div', { class: 'card' });
  /* Counted, so the sentence cannot fall behind the list it describes — it
     said "Six states" and would have gone on saying it beside seven. */
  const nStates = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][FEATURE_STATUS.length] || String(FEATURE_STATUS.length);
  key.append(cardHead('What the statuses mean', `${nStates} states. "Deleted" and "coming soon" are not among them.`));
  const kt = el('table', { class: 'dt' });
  kt.append(el('thead', {}, el('tr', {}, ['Status', 'Meaning'].map(h => el('th', { style: 'text-align:left' }, h)))));
  const kb = el('tbody');
  FEATURE_STATUS.forEach(s => kb.append(el('tr', {}, [
    el('td', { style: 'text-align:left' }, el('span', { class: 'chip' }, s.label)),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, s.note),
  ])));
  kt.append(kb); key.append(el('div', { class: 'tablewrap' }, kt));
  wrap.append(key);

  /* THE RELEASE CONDITION, IN NUMBERS. The Phase 2 brief's rule is that no
     P0 item is marked complete until its checks pass and no P1 surface is
     shown as operational until it is. Both halves are read off the rows
     below, not written here, so this card cannot disagree with them. */
  /* One card per brief: Phase 2's equities items and Phase 3's scanner
     items are released separately, so neither's count hides the other's. */
  [[2, 'Release condition — the Phase 2 equities brief', PRIORITY_NOTE],
   [3, 'Release condition — the Phase 3 scanner brief', PRIORITY_NOTE_P3]].forEach(([phase, title, NOTE]) => {
    const pri = CAPABILITY_REGISTER.filter(c => c.priority && registerPhase(c) === phase);
    if (!pri.length) return;
    const p0 = pri.filter(c => c.priority === 'P0'), p1 = pri.filter(c => c.priority === 'P1'), p2 = pri.filter(c => c.priority === 'P2');
    const briefItems = new Set(pri.flatMap(c => c.brief || []));
    const blocked = p0.filter(c => ['data-gated', 'compliance'].includes(c.status));
    const rel = el('div', { class: 'card' });
    rel.append(cardHead(title, `${briefItems.size} brief items, answered by ${pri.length} rows below. Priority comes from the brief, not from this page.`));
    const rl = el('dl', { class: 'kv' });
    [['P0', `${p0.length} rows. ${NOTE.P0} ${p0.filter(c => c.complete).length} of ${p0.length} complete${blocked.length ? `; ${blocked.length} blocked by decision (${blocked.map(c => c.brief.join(', ')).join('; ')})` : ''}; the rest are partial and say what they lack.`],
     ['P1', `${p1.length} rows. ${NOTE.P1} ${p1.filter(c => c.status === 'flagged').length} feature-flagged, ${p1.filter(c => !c.path).length} with no surface yet, ${p1.filter(c => c.complete).length} complete.`],
     p2.length ? ['P2', `${p2.length} rows. ${NOTE.P2 || ''} None has a surface.`] : null,
     ['Checked', `On every push, a static check fails the build if a row in an operational state has no working route, a prioritised row names a check that does not exist, or a partial P1 surface is not flagged${phase === 3 ? ', or a P2 row looks available' : ''}.`]]
      .filter(Boolean).forEach(([k, v]) => { rl.append(el('dt', {}, k)); rl.append(el('dd', { style: 'text-align:left' }, v)); });
    rel.append(rl);
    wrap.append(rel);
  });

  FEATURE_STATUS.forEach(s => {
    const rows = CAPABILITY_REGISTER.filter(c => c.status === s.id);
    if (!rows.length) return;
    const card = el('div', { class: 'card' });
    /* A flagged group is reachable, so its heading has to say what reachable
       does not mean here. */
    card.append(cardHead(`${s.label} — ${rows.length}${s.id === 'flagged' ? ' · not operational' : ''}`, s.note));
    const t = el('table', { class: 'dt status-dt' });
    t.append(el('thead', {}, el('tr', {}, ['Capability', 'Where', 'State'].map(h =>
      el('th', { style: 'text-align:left' }, h)))));
    const tb = el('tbody');
    /* Widths, so a phone scrolls the table rather than crushing it. The
       paths are unbroken strings, and /company/AAPL-SEC?tab=valuation took
       the width the State column needed: at 390px it set one letter per
       line. The path may now break anywhere; the State column keeps a
       readable measure and the table scrolls inside its wrapper. */
    rows.forEach(c => tb.append(el('tr', {}, [
      el('td', { style: 'text-align:left;white-space:normal;min-width:8rem' }, [
        el('div', { style: 'font-weight:600' }, c.name),
        c.priority ? el('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:6px;align-items:center' }, [
          el('span', { class: 'chip' + (c.priority === 'P0' ? ' chip-brand' : ' chip-bronze'), title: priorityNoteOf(c) }, c.priority),
          el('span', { class: 'metaline' }, `${(c.brief || []).join(' · ')} · ${c.complete ? 'complete' : 'partial'}`),
        ]) : null,
      ]),
      el('td', { style: 'text-align:left;white-space:normal;overflow-wrap:anywhere;min-width:11rem;max-width:14rem' }, c.path
        ? el('a', { href: href(c.path), onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(c.path); } }, c.path)
        : el('span', { class: 'caption' }, 'no route yet')),
      /* A field may be a function, resolved at render. CAPABILITY_REGISTER is a
         const evaluated when the file parses — before loadRealData has fetched
         anything — so any count written into it as a literal string counted the
         36-row sample set and froze that. It reported "0 US companies with
         audited SEC filings" on a build holding 119 of them. */
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal;min-width:15rem' }, [
        c.now ? coverageCell('div', {}, typeof c.now === 'function' ? c.now() : c.now) : null,
        c.gate ? coverageCell('div', { style: 'color:var(--bronze);margin-top:4px' },
          `Gate: ${typeof c.gate === 'function' ? c.gate() : c.gate}`) : null,
        c.flag ? el('div', { style: 'color:var(--bronze);margin-top:4px' }, `Flagged: ${c.flag}`) : null,
        c.checks?.length ? el('div', { style: 'margin-top:4px' },
          `Checked by: ${c.checks.map(x => `${x.file} — ${x.name}`).join('; ')}.`) : null,
      ]),
    ])));
    t.append(tb); card.append(el('div', { class: 'tablewrap' }, t));
    wrap.append(card);
  });

  const foot = el('div', { class: 'card' });
  foot.append(cardHead('Why a gate is named rather than hidden',
    'A capability that quietly vanishes is indistinguishable from one that never worked.'));
  foot.append(el('p', { class: 'body', style: 'font-size:13px' },
    'Three things here are blocked by something no amount of engineering resolves: the Malaysian financial statements need a data licence, the paid tiers need a registered operating entity, and advice mode needs Securities Commission authorisation. Naming them is more useful than a progress bar, because it tells a reader which of these is a matter of time and which is a matter of decision.'));
  wrap.append(foot);
  return wrap;
};

VIEWS.boundaries = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Learn'),
    el('h1', {}, 'What this product will not do'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Several obvious features are absent by design rather than by backlog. This page says which, and why each one would change what the product is.'),
  ])));
  wrap.append(scopeCard());

  const legal = el('div', { class: 'card' });
  legal.append(cardHead('Why the absent list is not a roadmap',
    'It is a licensing boundary, not a set of features waiting their turn.'));
  legal.append(el('p', { class: 'body', style: 'font-size:13px' },
    'Advising on securities to specific people is a regulated activity in Malaysia under the Capital Markets and Services Act. A disclaimer does not change what a feature does: a screen that ranks companies by attractiveness and calls the result a "top pick" is making a recommendation whatever the footer says.'));
  legal.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' },
    'So the boundary is built into the product rather than applied to it afterwards. There are no ratings to suppress, no target prices to caveat, and no suitability questions to disclaim — the question does not arise. That is a harder constraint to work inside and a much easier one to be honest about.'));
  wrap.append(legal);

  const back = el('div', { class: 'card' });
  back.append(cardHead('Prices', 'What the product costs, on its own page.'));
  back.append(el('a', { class: 'btn btn-primary', href: href('/pricing'),
    onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate('/pricing'); } }, 'See plans and prices'));
  wrap.append(back);
  return wrap;
};

function scopeCard() {
  const card = el('div', { class: 'card', style: 'border-left:3px solid var(--brand)' });
  /* It said "You are paying for analysis" on a build where nobody pays for
     anything: no plan is on sale (launch audit, 29 Sep 2026). What the
     product offers is the same; what a plan would charge for is said as a
     proposal. */
  card.append(cardHead('What is on offer: research',
    'This is research. The proposed plans would charge for analysis, evidence and tools that let you reach your own conclusion — not for a conclusion — and nothing is on sale yet. That is a deliberate product boundary, and it is the reason several obvious features do not exist here.'));
  const g = el('div', { class: 'grid g-2' });

  const inc = el('div');
  inc.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'What you get'));
  const il = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  ['Normalised financial history and derived metrics, each with its formula, period and source',
   'Scores that decompose to weighted inputs, anchor ranges and peer percentiles',
   'Model-appropriate valuation with the assumptions exposed and editable',
   'Bear, base and bull ranges with sensitivity — never a single number',
   'Published screen rules you can run, change and save',
   'Alerts that state a changed fact and its source',
   'A place to write your own thesis and record how the decision turned out'].forEach(x =>
    il.append(el('li', { class: 'evidence support', style: 'font-size:13px' }, x)));
  inc.append(il); g.append(inc);

  const exc = el('div');
  exc.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'What is deliberately absent'));
  const el2 = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  ['Buy, sell or hold ratings of any kind',
   'Target prices, price objectives or "fair value" presented as a single figure',
   'Ranked lists presented as preference — sorts are arithmetic, not editorial',
   /* Scoped to what is true. It said "any question about your income … or
      circumstances", and the property calculator's loan-readiness check asks
      for income, debts, commitments and a credit record. */
   'Any question about your goals or risk tolerance. The one input about you is optional: the property calculator’s loan-readiness check, which uses the income, debts and credit record you choose to enter, held only in this browser, to judge whether a loan is within reach',
   'Output that differs from one user to another — everyone sees the same analysis',
   'Portfolio construction, allocation guidance or rebalancing instructions',
   'Trade execution, brokerage connection or order routing'].forEach(x =>
    el2.append(el('li', { class: 'evidence counter', style: 'font-size:13px' }, x)));
  exc.append(el2); g.append(exc);
  card.append(g);

  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'The absent list is not a roadmap. Personalised recommendations are a licensed activity in Malaysia, and a disclaimer does not change what a feature does — so the product is built so that the question does not arise, rather than built and then labelled.'));
  return card;
}

VIEWS.plans = () => {
  const wrap = el('div');
  /* NOT ON SALE, SAID FIRST (launch audit, 29 Sep 2026). The owner's
     decision: the page stays in the header, and says plainly that the plans
     are proposals — nothing can be bought, no payment provider exists, and
     no refund policy is needed because nothing is charged. The heading was
     "A research subscription, and a report fee for property", which reads as
     an offer; the rationale for the two shapes of price follows the facts
     rather than standing in for them. */
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Plans'),
    el('h1', {}, 'Proposed plans — not on sale yet'),
    /* plan-lede: shown whole on a phone, where a page's standfirst is
       clamped to two lines — here it is the answer, not preamble. */
    el('p', { class: 'body-lg plan-lede', style: 'margin-top:8px' },
      'Nothing on this page can be bought. These are the prices proposed for a launch, shown so you can see what is planned and what each plan would include. There is no checkout and no payment provider, nothing is charged, and so there is no refund policy yet — there is nothing to refund.'),
    el('p', { class: 'body', style: 'margin-top:8px' },
      'Equity research is proposed as a subscription because it is used every week. Property research is episodic — most people buy a home every several years, not every month — so it is proposed as a fee per report.'),
  ])));
  /* The scope card used to open this page: two columns of what the product
     deliberately will not do, before a reader had seen a single price. It is
     the most important thing about the product and the wrong thing to lead a
     pricing page with — someone who came to find out what it costs had to read
     an argument first. It lives at /learn/product-boundaries in full now, and
     what remains here is one line, below the plans rather than above them. */

  const bar = el('div', { class: 'card', style: 'margin-bottom:var(--md);border-left:3px solid var(--bronze)' });
  bar.append(el('div', { class: 'row row-wrap', style: 'gap:10px' }, [
    el('span', { class: 'chip chip-bronze' }, 'Not on sale'),
    el('p', { class: 'body', style: 'font-size:13px;flex:1 1 320px' },
      'No payment is processed anywhere in this build: no checkout, no card capture, no trial clock, no renewal. The button on each card previews that plan’s features in this browser only, so both sides of the free-to-paid boundary can be inspected. The choice is kept in this browser and changes nothing anywhere else.'),
  ]));
  wrap.append(bar);

  /* Equal-height cards, each a column with its action at the foot, so the
     three actions sit on one line; they stood at three heights. */
  const grid = el('div', { class: 'grid g-3 plan-grid' });
  Object.values(PLANS).forEach(pl => {
    const active = State.plan === pl.id;
    /* A TIER THAT IS NOT ON SALE DOES NOT LOOK LIKE ONE THAT IS.
       All-Access carries launched:false, and the registry's own note says a
       tier nobody can obtain must not appear purchasable — yet its card was
       built exactly like the others: "Phase 2", RM79 a month in the price's
       type, and a primary "Switch to All-Access" button. The switch is what
       every card's button is, a local change of entitlements, and it still
       is; what changes is what the card says.
       Since the launch audit no paid tier is on sale, so what was true of
       All-Access is true of Equities Research as well: "Switch to Equities
       Research" was a filled primary button beside RM29 a month, the
       page's one call to action, and it read as the way to pay. Every paid
       card now carries the Not on sale chip, its price says it is proposed,
       and its button — outlined, never the page's primary action — says it
       previews the plan in this browser, which is all it does. Free is what
       every visitor has; its button only returns to it. */
    const paid = !!pl.priceMo;
    const launched = pl.launched !== false;
    const card = el('div', { class: 'card plan-card', style: active ? 'outline:2px solid var(--brand);outline-offset:-1px' : '' });
    card.append(el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:4px' }, [
      el('h3', { class: 'h-card' }, pl.name),
      active ? el('span', { class: 'chip chip-brand' }, paid ? 'Previewing' : 'Current') : null,
      paid ? el('span', { class: 'chip chip-bronze' }, 'Not on sale') : null,
    ]));
    card.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--sm)' }, pl.tagline));
    card.append(el('div', { class: 'row row-wrap', style: 'gap:6px;align-items:baseline;margin-bottom:2px' }, [
      el('span', { class: paid ? 'plan-price plan-price-proposed' : 'plan-price' }, paid ? `RM${pl.priceMo}` : 'RM0'),
      el('span', { class: 'metaline' }, !paid ? 'no charge' : launched ? '/month, proposed' : '/month, proposed — it cannot be bought'),
    ]));
    if (pl.priceYr) card.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--sm)' },
      `Proposed at RM${pl.priceYr} a year${pl.founding ? `, with a founding price of RM${pl.founding} for the first year for the first ${pl.foundingSeats} members` : ''}.`));
    card.append(el('p', { class: 'body', style: 'font-size:13px;margin-bottom:var(--md)' }, pl.blurb));
    /* The size of what is being sold, taken from the universe on screen rather
       than written into the copy, so it cannot be left behind when the universe
       changes. */
    if (pl.limits?.reportsPerMonth === Infinity) card.append(el('p', { class: 'metaline', style: 'margin:-8px 0 var(--md)' },
      coverageSentence('market') + ' It is not a complete listing of either market.'));

    const rows = [
      ['Company reports', pl.limits.reportsPerMonth === Infinity ? 'Unlimited' : `${pl.limits.reportsPerMonth} a month`],
      ['Watchlists', `${pl.limits.watchlists} × ${pl.limits.watchlistStocks} companies`],
      ['Portfolios', `${pl.limits.portfolios} × ${pl.limits.holdings} holdings`],
      ['Compare', `${pl.limits.compare} companies`],
      /* Two of the plan's limits are recorded here and applied nowhere: every
         plan can filter on every screener metric and sees the fact-change
         alert feed. The card read "8 of 28" and "No" on Free, which sold a
         boundary the build does not draw — and "28" was typed in by hand while
         the screener carried 34. The count now comes from FIELDS, and a limit
         that is not applied says so rather than being printed as a feature. */
      ['Screener metrics', pl.limits.screenerFields === Infinity ? `All ${FIELDS.length}`
        : `All ${FIELDS.length} — the limit of ${pl.limits.screenerFields} is not applied in this build`],
      ['Peer-percentile screening', pl.limits.percentileMode ? 'Yes' : 'No'],
      ['Editable valuation assumptions', pl.limits.valuationEditable ? 'Yes' : 'Read-only'],
      ['Fundamental alerts', pl.limits.fundamentalAlerts ? 'Yes'
        : 'Shown — this plan excludes them, but that is not applied in this build'],
      ['Price alerts', `${pl.limits.priceAlerts} — inactive until a price source is licensed`],
      ['Exports', pl.limits.exports ? 'Yes' : 'No'],
      ['Property calculator', pl.limits.propertyCalculator ? 'Included' : 'No'],
      ['Property reports', pl.limits.propertyReports ? `${pl.limits.propertyReports} a month` : 'Per report, proposed'],
      ['Cross-asset net worth', pl.limits.crossAsset ? 'Yes' : 'No'],
      /* No market-data licence has been signed for either exchange, so no plan
         can deliver price data at any latency. Listing a delay tier here sold a
         difference between plans that does not exist in the build. The tier is
         still recorded on the plan so the row can state what it would become. */
      ['Price data', 'Not available on any plan — no market-data licence is in place. '
        + (pl.limits.priceDelayMin ? `Licensed, this plan would carry a ${pl.limits.priceDelayMin}-minute delay.`
                                   : 'Licensed, this plan would carry real time where the exchange permits it.')],
    ];
    const dl = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
    rows.forEach(([k, v]) => { dl.append(el('dt', {}, k)); dl.append(el('dd', {}, v)); });
    card.append(dl);
    if (paid) card.append(el('p', { class: 'metaline', style: 'margin:-4px 0 var(--md)' }, launched
      ? `${pl.name} is not on sale yet. The preview turns on its features here so they can be inspected; nothing is charged.`
      : `${pl.name} has not launched and cannot be bought. The preview turns on its entitlements here, as the preview on every card does, so the view it adds can be inspected.`));
    /* The plan in force is a state, said as one — a marked line with a tick —
       not a disabled button at 45% opacity, which in the dark theme was
       barely there. The others are full-height buttons (.btn, not .btn-sm):
       a 30px "Switch to…" was outweighed by the header's 40px action. */
    card.append(active
      ? el('p', { class: 'plan-cta plan-current' }, [el('span', { 'aria-hidden': 'true', html: icon('check', 15) }),
          paid ? 'Previewing in this browser' : 'Current plan'])
      : el('button', { class: 'plan-cta btn btn-ghost', onclick: () => setPlan(pl.id) },
          paid ? `Preview ${pl.name} in this browser` : `Return to ${pl.name} in this browser`));
    grid.append(card);
  });
  wrap.append(grid);

  /* property report pricing */
  const pr = el('div', { class: 'card', style: 'margin-top:var(--md)' });
  pr.append(cardHead('Property Deal Check — proposed prices per report',
    'Proposed as a fee per report rather than a subscription, and not on sale either. The anchor is the roughly RM75 a Malaysian buyer already pays for a single project transaction report; this would cover the same ground and add the investment model on top.'));
  const ptw = el('div', { class: 'tablewrap' });
  /* "What it adds" is prose, left-aligned in its cells, so its heading is
     too — it sat right-aligned over them. Below 600px the rows stack (name
     and price, then what it adds): the table ran 336px in a 308px scroller
     and cut the description to a 100px column. */
  const pt = el('table', { class: 'dt dt-stack' });
  pt.append(el('thead', {}, el('tr', {}, ['Report', 'Proposed price', 'What it adds'].map((h, i) => el('th', { style: i === 2 ? 'text-align:left' : null }, h)))));
  pt.append(el('tbody', {}, [
    ['Saved analysis', `RM${PROPERTY_REPORT_PRICE.basic}`, 'Your own inputs saved, with yield, instalment, cash flow and break-even rent.'],
    ['Full investor report', `RM${PROPERTY_REPORT_PRICE.full}`, 'Comparable transactions, price and rental ranges, net operating income, cash-on-cash, debt-service cover, ten-year scenarios, exit costs and the equity comparison.'],
    ['Verified project report', `RM${PROPERTY_REPORT_PRICE.verified}`, 'The full report against a verified project dataset rather than user-entered figures.'],
  ].map(r2 => el('tr', {}, r2.map((cell, i) =>
    el('td', { class: i === 0 ? 'ident' : '', style: i === 2 ? 'text-align:left;white-space:normal;max-width:420px' : '' }, cell))))));
  ptw.append(pt); pr.append(ptw);
  wrap.append(pr);

  /* what is deliberately not monetised */
  const mp = el('div', { class: 'card', style: 'margin-top:var(--md)' });
  /* One line where the argument used to be, with the argument a click away. */
  /* Spaced from the report card above it, as every card on the page is:
     the two touched with no gap. */
  const boundaryLine = el('div', { class: 'card', style: 'border-left:3px solid var(--brand);margin-top:var(--md)' });
  boundaryLine.append(el('p', { class: 'body', style: 'font-size:13px' },
    'What the proposed plans would charge for is research: analysis, evidence and tools that let you reach your own conclusion — not a conclusion. There are no ratings, no target prices and no suitability questions, and that is a product boundary rather than a backlog.'));
  boundaryLine.append(el('a', { class: 'btn btn-ghost btn-sm', style: 'margin-top:10px', href: href('/learn/product-boundaries'),
    onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate('/learn/product-boundaries'); } },
    'What this product will not do, and why'));
  wrap.append(boundaryLine);

  mp.append(cardHead('What is deliberately not monetised',
    'Revenue that would compromise the research is not taken, at any price. This list is a product constraint, not a phase.'));
  const g2 = el('div', { class: 'grid g-2' });
  const never = el('div');
  never.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Never'));
  const nl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  ['Sponsored or paid placement in any score, ranking or valuation',
   'Developer-paid property recommendations',
   'Advertising inside a valuation or a research report',
   'Copy trading or automated buy-now signals',
   'Selling user portfolio data, or publishing crowd positioning as a signal'].forEach(x =>
    nl.append(el('li', { class: 'evidence counter', style: 'font-size:13px' }, x)));
  never.append(nl); g2.append(never);
  const later = el('div');
  later.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Possible later, with disclosure and after legal review'));
  const ll2 = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:5px' });
  ['Mortgage eligibility introductions', 'Licensed broker introductions',
   'Valuer and inspection bookings', 'Team and investment-club accounts',
   'White-label reports and education partnerships'].forEach(x =>
    ll2.append(el('li', { class: 'evidence', style: 'font-size:13px' }, x)));
  later.append(ll2); g2.append(later);
  mp.append(g2);
  mp.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'Compensation of any kind must never influence a score, a valuation or a ranking. Where an introduction earns a fee, the fee is disclosed at the point of the introduction — not in a terms page.'));
  wrap.append(mp);
  return wrap;
};


/* ==========================================================================
   LATEST RECORDED TRANSACTIONS BY LOCALITY AND PROPERTY TYPE
   --------------------------------------------------------------------------
   The feature this replaces was called "last transacted price", and the name
   was the defect. A single last price for a locality is close to meaningless:
   the most recent transaction in a Sarawak district is as likely to be
   agricultural land or a low-cost flat as the terrace somebody is actually
   asking about, and printing one figure invites the reader to compare their
   condominium against a paddy field.

   So the unit of answer is a COHORT — locality, category, subtype, tenure and
   area band — and every cohort carries the count behind it, the spread, the
   period it covers and where it came from. A median of two is shown as a median
   of two, and a quartile of two is not shown at all.
   ========================================================================== */

/* Every distinct cohort held for a locality, newest transaction first. */
function localityTransactions(city, area, { splitBand = true } = {}) {
  const rows = (State.observations || []).filter(o =>
    o.city === city && o.area === area
    && (o.kind === 'sold-price' || o.kind === 'land-sold')
    && isNum(o.value) && o.date);

  const keyOf = (o) => [
    o.category || 'uncategorised',
    o.subtype || (o.propertyType || 'unspecified'),
    o.tenure || 'unknown',
    splitBand ? (areaBand(o.kind === 'land-sold' ? o.landSqft : o.sqft)?.id || 'unbanded') : 'all',
  ].join('|');

  const groups = new Map();
  rows.forEach(o => {
    const k = keyOf(o);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });

  const out = [...groups.entries()].map(([k, list]) => {
    const [cat, sub, ten, band] = k.split('|');
    const sorted = list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const latest = sorted[0];
    const isLand = latest.kind === 'land-sold';
    const areaField = isLand ? 'landSqft' : 'sqft';

    const prices = spread(list.map(o => o.value));
    /* Per-square-foot spread over only the rows that carry an area. The count
       differs from the price count and is reported separately, because a median
       PSF over three of nine transactions is not a median over nine. */
    const withArea = list.filter(o => isNum(o[areaField]) && o[areaField] > 0);
    const psfs = spread(withArea.map(o => o.value / o[areaField]));

    const dates = list.map(o => String(o.date)).sort();
    /* Licence is the WEAKEST in the cohort — a summary containing one
       licence-pending record is itself licence-pending, because publishing it
       would publish that record's contribution. */
    const licences = [...new Set(list.map(o => licenceOf(o).id))];
    const weakest = DATA_LICENCES
      .filter(l => licences.includes(l.id))
      .sort((a, b) => (a.publish === b.publish ? a.rank - b.rank : (a.publish ? 1 : -1)))[0]
      || LICENCE_BY_ID.own;

    return {
      key: k,
      category: CATEGORY_BY_ID[cat]?.label || (cat === 'uncategorised' ? 'Not categorised' : cat),
      subtype: sub === 'unspecified' ? '—' : sub,
      tenure: (TENURES.find(t => t.id === ten) || { label: 'Not stated' }).label,
      band: band === 'all' ? null : (AREA_BANDS.find(b => b.id === band)?.label
              || (band === 'unbanded' ? 'no area recorded' : band)),
      isLand,
      latest, latestDate: latest.date, ageMonths: monthsSince(latest.date),
      prices, psfs, psfN: psfs.n,
      periodFrom: dates[0], periodTo: dates[dates.length - 1],
      lastUpdate: list.map(o => o.recordedAt || '').sort().pop() || '',
      licence: weakest,
      sampleN: list.filter(o => o.sample).length,
      n: list.length,
    };
  });

  return out.sort((a, b) => String(b.latestDate).localeCompare(String(a.latestDate)));
}

/* The panel. Every column the correct wording requires, and the count beside
   every summary figure. */
function localityTransactionPanel(city, area) {
  const cohorts = localityTransactions(city, area);
  const card = el('div', { class: 'card' });
  card.append(cardHead(`Your own recorded transactions — ${area}`,
    'Transactions you recorded, by category, subtype, tenure and area band. These are the only dated transactions this '
    + 'product holds — NAPIC publishes no transaction dates, so nothing above this panel can contribute to a latest sale. '
    + 'A single "last price" for a locality would not be useful anyway: the most recent sale in a district is as likely to '
    + 'be agricultural land as the property you are asking about.'));

  if (!cohorts.length) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
      `No transactions recorded for ${area}.`));
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'NAPIC publishes Sarawak transaction records through Open Sales Data, its quarterly tables and PRISM e-Data. '
      + 'This product can source and analyse them; it may not republish records until NAPIC grants redistribution rights, '
      + 'so nothing is loaded here. The data-sources page states where that stands.'));
    return card;
  }

  const t = el('table', { class: 'dt register-dt' });
  t.append(el('thead', {}, el('tr', {}, ['Category', 'Subtype', 'Tenure', 'Area band',
    'Latest', 'Dated', 'Median', 'Median PSF', 'P25–P75', 'n', 'Period', 'Source', 'Licence']
    .map((h, i) => el('th', { class: i ? null : 'pin', style: i ? null : 'text-align:left' }, h)))));
  const tb = el('tbody');
  cohorts.forEach(c => {
    const money = (v) => (isNum(v) ? fmtMoney(v, 'MYR', 0) : '—');
    tb.append(el('tr', {}, [
      el('th', { class: 'pin ident', scope: 'row', style: 'text-align:left' },
        [c.category, c.sampleN ? el('span', { class: 'chip chip-bronze', style: 'margin-left:6px' }, 'example') : null].filter(Boolean)),
      el('td', { style: 'text-align:left' }, c.subtype),
      el('td', { style: 'text-align:left' }, c.tenure),
      el('td', { class: 'caption', style: 'text-align:left' }, c.band || '—'),
      el('td', { class: 'num' }, money(c.latest.value)),
      el('td', { class: 'caption', style: 'text-align:left' },
        `${c.latestDate}${isNum(c.ageMonths) ? ` · ${fmtNum(c.ageMonths, 0)} mo` : ''}`),
      el('td', { class: 'num' }, money(c.prices.median)),
      el('td', { class: 'num', title: c.psfN ? `${c.psfN} of ${c.n} carry an area` : 'no areas recorded' },
        c.psfs.median != null ? `${fmtMoney(c.psfs.median, 'MYR', c.isLand ? 0 : 1)}` : '—'),
      el('td', { class: 'num', title: c.n < 4 ? 'Quartiles are withheld below four transactions' : null },
        c.prices.p25 != null ? `${money(c.prices.p25)}–${money(c.prices.p75)}` : '—'),
      el('td', { class: 'num' }, String(c.n)),
      el('td', { class: 'caption', style: 'text-align:left' },
        c.periodFrom === c.periodTo ? c.periodFrom : `${c.periodFrom} to ${c.periodTo}`),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
        c.latest.sourceName || c.latest.sourceRef || '—'),
      el('td', { style: 'text-align:left' },
        el('span', { class: c.licence.publish ? 'chip' : 'chip chip-bronze', title: c.licence.note }, c.licence.label)),
    ]));
  });
  t.append(tb);
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--md)' }, t));
  gridKeyboard(t, `Recorded transactions for ${area}, by cohort. Arrow keys move between cells.`);

  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Median PSF is computed only over the transactions that carry an area, and its count is in the column tooltip — '
    + 'a median over three of nine is not a median over nine. Quartiles are withheld below four transactions, '
    + 'because a quartile of two numbers is arithmetic performed on an opinion.'));
  card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'A cohort takes the weakest licence of any record in it: a summary containing one record that may not be republished '
    + 'may not be republished either.'));
  return card;
}
