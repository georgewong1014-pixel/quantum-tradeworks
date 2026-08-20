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
  minLease:null, editing:null };

VIEWS.areas = () => {
  const S = State.areaScreen;
  if (geoLoadState === 'idle') loadSarawakLayers();
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Property'),
    el('h1', {}, 'Area screen'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Localities in one town, shaded by what you have recorded about them. Flood exposure is entered from a source you name; '
      + 'rents, vacancy and prices come from the comparables register. Nothing here is modelled, inferred or bought in — an area with '
      + 'no record is drawn hollow, because an unexamined area must never look like a safe one.'),
  ])));

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
    g.append(el('div', { class: 'segmented' }, opts.map(([v, l]) =>
      el('button', { 'aria-selected': S[key] === v ? 'true' : 'false',
        onclick: () => { if (onPick) onPick(v); else S[key] = v; render(); } }, l))));
    return g;
  };

  /* TWENTY TOWNS IS A SELECT, NOT A STRIP.
     A segmented control is right for four options and wrong for twenty — it
     becomes a horizontally scrolling strip where most of the state is off
     screen. Grouped by division, because that is how the places relate to each
     other and how somebody looking for Dalat will go looking for it. */
  const townField = el('div', { class: 'row seg-group', style: 'gap:8px;align-items:center' });
  townField.append(el('label', { class: 'caption', style: 'font-weight:600', for: 'areaTown' }, 'Town'));
  const townSel = el('select', { class: 'select select-sm', id: 'areaTown',
    onchange: e => { S.city = e.target.value; S.editing = null; render(); } });
  Object.entries(SARAWAK_DIVISIONS).forEach(([division, towns]) => {
    const grp = el('optgroup', { label: `${division} Division` });
    towns.forEach(c => grp.append(el('option', { value: c.id, selected: S.city === c.id ? '' : null },
      /* Say which towns can be drawn, rather than letting a reader pick one and
         find the map missing with no explanation. */
      `${c.name}${sarawakGeo?.cities?.[c.id] ? '' : ' — table only'}`)));
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
      el('button', { 'aria-selected': State.rateUnits[which] === id ? 'true' : 'false',
        title: areaUnit(id).why,
        onclick: () => { setRateUnit(which, id); render(); } }, areaUnit(id).short))));
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
      r.append(el('button', { class: `chip${on ? ' chip-brand' : ''}`, 'aria-pressed': on ? 'true' : 'false',
        title: c.note, style: 'cursor:pointer', onclick: () => {
          S.classes[attr.id] = on ? sel.filter(x => x !== c.id) : [...sel, c.id]; render();
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
      onchange: e => { S[key] = e.target.value === '' ? (key === 'minRecords' ? 0 : null) : num0(e.target.value); render(); } }));
    return f;
  };
  row3.append(numFilter('Minimum records held', 'minRecords', '0'));
  row3.append(numFilter('Weeks vacant at most', 'maxWeeks', 'any'));
  row3.append(numFilter('Lease years at least', 'minLease', 'any'));
  row3.append(el('button', { class: 'chip', style: 'cursor:pointer',
    onclick: () => { S.classes = {}; S.minRecords = 0; S.maxWeeks = null; S.minLease = null; render(); } },
    'Clear filters'));
  bar.append(row3);
  wrap.append(bar);

  if (!names.length) {
    wrap.append(emptyState(geoLoadState === 'loading'
      ? 'Loading locality positions…'
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
  const mapHost = el('div', { style: 'margin-top:var(--md)' });
  mapCard.append(mapHost);
  mapHost.append(cityMap(S.city, S.editing, (n) => { S.editing = n; render(); }, paint));

  /* Legend — two series or more means one is never optional. */
  const legend = el('div', { class: 'row row-wrap', style: 'gap:var(--md);margin-top:var(--md)' });
  const swatch = (fill, text, dashed) => el('span', { class: 'caption', style: 'display:inline-flex;align-items:center;gap:6px' }, [
    el('span', { 'aria-hidden': 'true', style: `width:12px;height:12px;border-radius:50%;`
      + (dashed ? 'border:1.4px dashed var(--ink-3)' : `background:${fill}`) }),
    text]);
  if (layer.kind === 'class') layer.attr.classes.forEach(c =>
    legend.append(swatch(`var(${c.tone})`, c.label + (c.restricted ? ' · restricted' : ''))));
  else if (bands) {
    legend.append(swatch(`var(${SEQ_STEPS[layer.invert ? SEQ_STEPS.length - 1 : 0]})`,
      `${layer.text(S.city, shown.find(n => layer.value(S.city, n) === bands.lo)) || fmtNum(bands.lo, 0)} (lowest here)`));
    legend.append(swatch(`var(${SEQ_STEPS[layer.invert ? 0 : SEQ_STEPS.length - 1]})`,
      `${layer.text(S.city, shown.find(n => layer.value(S.city, n) === bands.hi)) || fmtNum(bands.hi, 0)} (highest here)`));
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

  if (canMap) wrap.append(mapCard);
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
  t.append(el('thead', {}, el('tr', {},
    cols.map((h, i) => el('th', { class: i ? null : 'pin', style: i ? null : 'text-align:left' }, h)))));
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
    /* The last transacted price, with WHEN. An amount without a date is the
       most misleading figure a property register can print: RM620,000 reads as
       current until you learn it was 2017. Both, or neither. */
    const last = m.lastSold || m.lastLand;
    const lastCell = () => {
      if (!last) return el('span', { class: 'caption' }, 'none recorded');
      const age = monthsSince(last.date);
      const isLand = last === m.lastLand && !m.lastSold;
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
      el('td', {}, el('button', { class: 'btn btn-quiet btn-sm',
        onclick: () => { S.editing = S.editing === n ? null : n; render(); } },
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
  tCard.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--md)' }, t));
  /* Sixteen columns can say what a locality is classified as. They cannot say
     what the classification MEANS, and the consequence is the half a buyer
     needs — "peat, 3 m or deeper" is a fact, "deep piling dominates build cost"
     is the reason to care. */
  if (S.editing) wrap.append(landRiskPanel(S.city, S.editing));
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
  const box = el('div', { class: 'sunk', style: 'margin:var(--sm)' });
  box.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:8px' }, `Record for ${area}`));
  box.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' },
    'Each fact is saved on its own, with its own source and date — a title class established from the title '
    + 'document and a flood account from a neighbour are not the same evidence and are never dated together.'));

  AREA_ATTRS.forEach(attr => {
    const cur = areaAttr(city, area, attr.id);
    const draft = { class: cur?.class || '', value: isNum(cur?.value) ? cur.value : null,
      source: cur?.source || 'unstated', asOf: cur?.asOf || '', ref: cur?.ref || '' };

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
        onchange: e => { draft.class = e.target.value; } });
      sc.append(el('option', { value: '' }, 'Not recorded'));
      attr.classes.forEach(c => sc.append(el('option', { value: c.id, selected: draft.class === c.id ? '' : null },
        `${c.label} — ${c.note}`)));
      f1.append(sc);
    } else {
      f1.append(el('label', { for: uid }, `Value (${attr.unit})`));
      f1.append(el('input', { class: 'input a-text', id: uid, type: 'number', min: '0',
        value: draft.value == null ? '' : String(draft.value), 'aria-label': `${attr.label} in ${attr.unit}`,
        onchange: e => { draft.value = e.target.value === '' ? null : num0(e.target.value); } }));
    }
    sec.append(f1);

    const f2 = el('div', { class: 'assumption' });
    f2.append(el('label', { for: `${uid}-src` }, 'Established from'));
    const ss = el('select', { class: 'select a-text', id: `${uid}-src`, 'aria-label': `Source for ${attr.label}`,
      onchange: e => { draft.source = e.target.value; } });
    AREA_SOURCES.forEach(s => ss.append(el('option', { value: s.id, selected: draft.source === s.id ? '' : null },
      s.label + (s.verified ? '' : ' (unverified)'))));
    f2.append(ss); sec.append(f2);

    const f3 = el('div', { class: 'assumption' });
    f3.append(el('label', { for: `${uid}-asof` }, 'As at'));
    f3.append(el('input', { class: 'input a-text', id: `${uid}-asof`, type: 'date', value: draft.asOf,
      'aria-label': `Date ${attr.label} was established`, onchange: e => { draft.asOf = e.target.value; } }));
    sec.append(f3);

    const f4 = el('div', { class: 'assumption' });
    f4.append(el('label', { for: `${uid}-ref` }, 'Reference'));
    f4.append(el('input', { class: 'input a-text', id: `${uid}-ref`, type: 'text', value: draft.ref,
      placeholder: 'Document, map sheet, policy or file number, or who said it',
      'aria-label': `Reference for ${attr.label}`, onchange: e => { draft.ref = e.target.value; } }));
    sec.append(f4);

    sec.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--sm)' }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
        const empty = attr.kind === 'class' ? !draft.class : !isNum(draft.value);
        if (empty) { toast(`Enter a value for ${attr.short.toLowerCase()}, or use Remove`); return; }
        setAreaAttr(city, area, attr.id, draft);
        render(); toast(`${attr.short} recorded for ${area}`);
      } }, 'Save'),
      cur ? el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
        setAreaAttr(city, area, attr.id, null);
        render(); toast(`${attr.short} cleared for ${area}`);
      } }, 'Remove') : null,
    ]));
    box.append(sec);
  });

  box.append(el('div', { class: 'row', style: 'margin-top:var(--md)' },
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      State.areaScreen.editing = null; render();
    } }, 'Close')));
  box.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'Held in this browser only, alongside the comparables register. Back it up from Your data.'));
  return box;
}

VIEWS.comparables = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Property'),
    el('h1', {}, 'Sarawak comparables register'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Transacted prices and achieved rents you have recorded, with what each one rests on. Asking and achieved are never combined, and a figure with no source is marked as a note rather than evidence.'),
  ])));

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
  const undoBtn = el('button', { class: 'btn btn-ghost btn-sm', disabled: !canUndoRegister() ? '' : null,
    onclick: () => { const what = undoLastRegisterChange(); render(); toast(what || 'Nothing left to undo'); } },
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
    head.append(el('div', { class: 'grid g-4', style: 'margin-top:var(--md)' },
      [['Verified', counts.verified || 0], ['Awaiting review', counts.awaiting_review || 0],
       ['Sourced', counts.sourced || 0], ['No source', counts.unsourced || 0]]
        .map(([k, v]) => el('div', { class: 'panel' }, statTile(k, String(v))))));
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
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Standing', 'What', 'Amount', 'Area', 'Rate', 'Ownership',
      'Where', 'Address or project', 'Dated', 'Source', ''].map(h =>
      el('th', { style: 'text-align:left' }, h)))));
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
        el('td', { class: 'caption', style: 'text-align:left' }, `${o.area || '—'}, ${o.city || '—'}`),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, o.address || '—'),
        el('td', { class: 'caption', style: 'text-align:left' }, o.date || '—'),
        el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, o.sourceRef || '—'),
        el('td', { style: 'text-align:left' }, el('button', { class: 'btn btn-ghost btn-sm',
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
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => openComparableImport() }, 'Import'),
  ]));
  io.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'CSV is for reading; JSON round-trips exactly and carries the change history with it. Import skips a record it already holds rather than doubling its weight in a median — same district, kind, amount and date is the same transaction however many times it is pasted.'));
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
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date))) return { err: `date "${r.date}" is not YYYY-MM-DD` };
    const ev = String(r.evidence || 'user');
    if (!EVIDENCE.some(e => e.id === ev)) return { err: `evidence "${ev}" is not a known source class` };
    return { ok: { city: String(r.city), area: String(r.area || ''), kind, value,
                   date: String(r.date), evidence: ev,
                   propertyType: String(r.propertyType || ''), address: String(r.address || ''),
                   sourceRef: String(r.sourceRef || ''), reviewedBy: String(r.reviewedBy || ''),
                   sqft: Number.isFinite(Number(r.sqft)) && r.sqft !== '' ? Number(r.sqft) : null } };
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
      const unsourced = ok.filter(x => !x.sourceRef).length;
      if (unsourced) report.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
        `${unsourced} of these carry no source reference and will be held as notes rather than evidence.`));
      report.append(el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:var(--md)', onclick: () => {
        ok.forEach(x => addObservation(x));
        closeDrawer(); render();
        toast(`${ok.length} record${ok.length === 1 ? '' : 's'} imported${dup.length ? `, ${dup.length} skipped` : ''}`);
      } }, `Import ${ok.length} record${ok.length === 1 ? '' : 's'}`));
    } }, 'Check this paste'),
  ]));
  openDrawer('Import comparables', body);
}

/* One record, with the fields the calculator's compact form has no room for. */
function openObservationDrawer(o) {
  const s = observationStanding(o);
  const body = el('div');
  body.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:var(--md)' },
    el('span', { class: s.tone }, s.label)));
  body.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' }, s.why));

  const edit = (label, key, kind) => {
    const f = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
    f.append(el('label', {}, label));
    const node = kind === 'number'
      ? el('input', { class: 'input', type: 'number', value: isNum(o[key]) ? String(o[key]) : '' })
      : el('input', { class: 'input', type: 'text', value: o[key] || '' });
    node.addEventListener('change', e => {
      const v = kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value;
      const i = State.observations.findIndex(x => x.id === o.id);
      if (i > -1) {
        recordObservationEdited(o.id, key, State.observations[i][key], v);
        State.observations[i] = { ...State.observations[i], [key]: v };
        saveObservations();
      }
      o[key] = v;
      render();
    });
    f.append(node);
    body.append(f);
  };
  edit('Address or project', 'address');
  edit('Property type', 'propertyType');
  edit('Built-up area (sq ft)', 'sqft', 'number');
  edit('Source reference — the filing, listing, tenancy or document this came from', 'sourceRef');
  edit('Checked against the source by', 'reviewedBy');

  const kv = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
  [['Recorded', o.recordedAt || '—'], ['Dated', o.date || '—'],
   ['Evidence class', evidenceOf(o.evidence).label], ['District', `${o.area || '—'}, ${o.city || '—'}`]]
    .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, String(v))); });
  body.append(kv);

  /* WHAT HAPPENED TO THIS RECORD.
     A register that only shows the current figure asks the reader to trust that
     it was always that figure. This is the whole reason the log exists, so it
     is shown where the figure is edited rather than filed away in a settings
     page nobody opens. */
  const hist = registerHistory('observation', o.id);
  if (hist.length) {
    body.append(el('h3', { class: 'h-card', style: 'margin-top:var(--lg)' }, 'History'));
    const ul = el('ul', { class: 'log-list' });
    hist.slice(0, 12).forEach(e => ul.append(el('li', { class: 'metaline' }, registerEventText(e))));
    if (hist.length > 12) ul.append(el('li', { class: 'metaline' }, `… and ${hist.length - 12} earlier change${hist.length - 12 === 1 ? '' : 's'}`));
    body.append(ul);
  }

  body.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--md)', onclick: () => {
    recordObservationDeleted(State.observations.find(x => x.id === o.id) || o);
    State.observations = State.observations.filter(x => x.id !== o.id);
    saveObservations(); closeDrawer(); render(); toast('Record deleted — undo from the register');
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

  const key = el('div', { class: 'card' });
  key.append(cardHead('What the statuses mean', 'Six states. "Deleted" and "coming soon" are not among them.'));
  const kt = el('table', { class: 'dt' });
  kt.append(el('thead', {}, el('tr', {}, ['Status', 'Meaning'].map(h => el('th', { style: 'text-align:left' }, h)))));
  const kb = el('tbody');
  FEATURE_STATUS.forEach(s => kb.append(el('tr', {}, [
    el('td', { style: 'text-align:left' }, el('span', { class: 'chip' }, s.label)),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, s.note),
  ])));
  kt.append(kb); key.append(el('div', { class: 'tablewrap' }, kt));
  wrap.append(key);

  FEATURE_STATUS.forEach(s => {
    const rows = CAPABILITY_REGISTER.filter(c => c.status === s.id);
    if (!rows.length) return;
    const card = el('div', { class: 'card' });
    card.append(cardHead(`${s.label} — ${rows.length}`, s.note));
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Capability', 'Where', 'State'].map(h =>
      el('th', { style: 'text-align:left' }, h)))));
    const tb = el('tbody');
    rows.forEach(c => tb.append(el('tr', {}, [
      el('td', { style: 'text-align:left;white-space:normal;font-weight:600' }, c.name),
      el('td', { style: 'text-align:left' }, c.path
        ? el('a', { href: href(c.path), onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(c.path); } }, c.path)
        : el('span', { class: 'caption' }, 'no route yet')),
      /* A field may be a function, resolved at render. CAPABILITY_REGISTER is a
         const evaluated when the file parses — before loadRealData has fetched
         anything — so any count written into it as a literal string counted the
         36-row sample set and froze that. It reported "0 US companies with
         audited SEC filings" on a build holding 119 of them. */
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, [
        c.now ? el('div', {}, typeof c.now === 'function' ? c.now() : c.now) : null,
        c.gate ? el('div', { style: 'color:var(--bronze);margin-top:4px' },
          `Gate: ${typeof c.gate === 'function' ? c.gate() : c.gate}`) : null,
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
  card.append(cardHead('What is being sold: research',
    'This is a research subscription. You are paying for analysis, evidence and tools that let you reach your own conclusion — not for a conclusion. That is a deliberate product boundary, and it is the reason several obvious features do not exist here.'));
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
   'Any question about your income, goals, risk tolerance or circumstances',
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
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Plans'),
    el('h1', {}, 'A research subscription, and a report fee for property'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Equity research earns weekly engagement, so it is priced as a subscription. Property research is episodic — most people buy a home every several years, not every month — so it is priced per report. Charging a monthly fee for something used twice a year is how churn is manufactured.'),
  ])));
  /* The scope card used to open this page: two columns of what the product
     deliberately will not do, before a reader had seen a single price. It is
     the most important thing about the product and the wrong thing to lead a
     pricing page with — someone who came to find out what it costs had to read
     an argument first. It lives at /learn/product-boundaries in full now, and
     what remains here is one line, below the plans rather than above them. */

  const bar = el('div', { class: 'card', style: 'margin-bottom:var(--md);border-left:3px solid var(--bronze)' });
  bar.append(el('div', { class: 'row row-wrap', style: 'gap:10px' }, [
    el('span', { class: 'chip chip-bronze' }, 'Prototype'),
    el('p', { class: 'body', style: 'font-size:13px;flex:1 1 320px' },
      'No payment is processed anywhere in this build. There is no checkout, no card capture, no trial clock and no renewal. The switcher below changes your entitlements locally so both sides of the free-to-paid boundary can be inspected — that is all it does.'),
  ]));
  wrap.append(bar);

  const grid = el('div', { class: 'grid g-3', style: 'align-items:start' });
  Object.values(PLANS).forEach(pl => {
    const active = State.plan === pl.id;
    const card = el('div', { class: 'card', style: active ? 'outline:2px solid var(--brand);outline-offset:-1px' : '' });
    card.append(el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:4px' }, [
      el('h3', { class: 'h-card' }, pl.name),
      active ? el('span', { class: 'chip chip-brand' }, 'Current') : null,
      pl.id === 'all' ? el('span', { class: 'chip' }, 'Phase 2') : null,
    ]));
    card.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--sm)' }, pl.tagline));
    card.append(el('div', { class: 'row', style: 'gap:6px;align-items:baseline;margin-bottom:2px' }, [
      el('span', { style: 'font-size:24px;font-weight:700;letter-spacing:-.02em' }, pl.priceMo ? `RM${pl.priceMo}` : 'RM0'),
      el('span', { class: 'metaline' }, pl.priceMo ? '/month' : 'forever'),
    ]));
    if (pl.priceYr) card.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--sm)' },
      `or RM${pl.priceYr} a year${pl.founding ? ` · founding offer RM${pl.founding} for the first year, ${pl.foundingSeats} seats` : ''}`));
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
      ['Screener metrics', pl.limits.screenerFields === Infinity ? 'All 28' : `${pl.limits.screenerFields} of 28`],
      ['Peer-percentile screening', pl.limits.percentileMode ? 'Yes' : 'No'],
      ['Editable valuation assumptions', pl.limits.valuationEditable ? 'Yes' : 'Read-only'],
      ['Fundamental alerts', pl.limits.fundamentalAlerts ? 'Yes' : 'No'],
      ['Price alerts', `${pl.limits.priceAlerts} — inactive until a price source is licensed`],
      ['Exports', pl.limits.exports ? 'Yes' : 'No'],
      ['Property calculator', pl.limits.propertyCalculator ? 'Included' : 'No'],
      ['Property reports', pl.limits.propertyReports ? `${pl.limits.propertyReports} a month` : 'Pay per report'],
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
    card.append(el('button', { class: active ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm', style: 'width:100%',
      disabled: active ? '' : null, onclick: () => setPlan(pl.id) },
      active ? 'Current plan' : `Switch to ${pl.name}`));
    grid.append(card);
  });
  wrap.append(grid);

  /* property report pricing */
  const pr = el('div', { class: 'card', style: 'margin-top:var(--md)' });
  pr.append(cardHead('Property Deal Check — priced per report',
    'Transactional rather than recurring. The anchor is the roughly RM75 a Malaysian buyer already pays for a single project transaction report; this covers the same ground and adds the investment model on top.'));
  const ptw = el('div', { class: 'tablewrap' });
  const pt = el('table', { class: 'dt' });
  pt.append(el('thead', {}, el('tr', {}, ['Report', 'Price', 'What it adds'].map(h => el('th', {}, h)))));
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
  const boundaryLine = el('div', { class: 'card', style: 'border-left:3px solid var(--brand)' });
  boundaryLine.append(el('p', { class: 'body', style: 'font-size:13px' },
    'What you are paying for is research: analysis, evidence and tools that let you reach your own conclusion — not a conclusion. There are no ratings, no target prices and no suitability questions, and that is a product boundary rather than a backlog.'));
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

