/* ==========================================================================
   WORKED EXAMPLE — A FULL DISTRICT, EVERY FIGURE MARKED AS INVENTED
   --------------------------------------------------------------------------
   A first-time visitor met honest empty states everywhere: an area screen with
   nine layers and nothing in them, a comparables register saying the register
   is empty, a wheel with no contract. All of that is correct — it is the true
   state of the evidence and it should not be dressed up. It is also completely
   unpersuasive, because nobody can tell the difference between a product that
   is empty and a product that does nothing.

   So there is one button that fills a district, and the rule governing it is
   the same rule the rest of the product runs on: SAY WHERE EVERY FIGURE CAME
   FROM. These came from nowhere. They are not scraped, not modelled, not a
   real Kuching transaction with the address filed off — they were typed to
   demonstrate the shape of the tool, and every one of them says so:

     · every record carries sample:true, and observationStanding() checks that
       FIRST, so a seeded row can never present as Verified however complete
       its fields look
     · the source reference on every row is the sentence "Worked example — no
       document exists", which is unmistakable in an export or a CSV
     · the area attributes are recorded with source class "unstated"
     · the whole set is removable in one action, and removing it takes nothing
       the reader entered

   Seeding goes through the same recorders as manual entry, so the events land
   in the register log with their own actor and the reader can see, in the
   history, that these are not theirs.
   ========================================================================== */

const SAMPLE_ACTOR = 'Worked example';
const SAMPLE_REF = 'Worked example — no document exists';
const SAMPLE_CITY = 'kuching';

/* Three districts of one city, chosen to be different from each other rather
   than flattering: one with a flood history and thin cover, one clean and
   dearer, one mid. A demo where every district looks the same demonstrates
   nothing, and a demo where every district looks good is a brochure. */
const SAMPLE_AREAS = [
  {
    area: 'Tabuan',
    attrs: {
      flood: { class: 'occasional' }, title: { class: 'strata' },
      drainage: { class: 'building' }, insurance: { class: 'loaded' },
      ground: { class: 'alluvial' }, coastal: { class: 'tidal' },
      lease: { value: 78 },
    },
    records: [
      { kind: 'sold-price', value: 565000, date: '2026-02-11', sqft: 1050, titleType: 'strata', propertyType: 'Condominium', address: 'Riveria-style block, Jalan Tabuan' },
      { kind: 'sold-price', value: 598000, date: '2026-04-27', sqft: 1120, titleType: 'strata', propertyType: 'Condominium', address: 'Same scheme, higher floor' },
      { kind: 'let-rent',   value: 1850,   date: '2026-05-02', sqft: 1050, propertyType: 'Condominium', address: 'Two-bedroom, furnished' },
      { kind: 'vacancy',    value: 7,      date: '2026-05-02', propertyType: 'Condominium', address: 'Weeks between tenancies' },
      { kind: 'mgmt-fee',   value: 336,    date: '2026-05-02', sqft: 1050, propertyType: 'Condominium', address: 'Monthly service charge' },
      { kind: 'land-sold',  value: 396000, date: '2026-01-19', landSqft: 3484.8, landUnit: 'point', propertyType: 'Vacant lot', address: 'Eight points, road frontage' },
    ],
  },
  {
    area: 'Stutong',
    attrs: {
      flood: { class: 'none' }, title: { class: 'strata' },
      drainage: { class: 'complete' }, insurance: { class: 'ready' },
      ground: { class: 'residual' }, coastal: { class: 'none' },
      lease: { value: 91 },
    },
    records: [
      { kind: 'sold-price', value: 712000, date: '2026-03-19', sqft: 1180, titleType: 'strata', propertyType: 'Condominium', address: 'Corner unit, Jalan Stutong' },
      { kind: 'let-rent',   value: 2250,   date: '2026-04-08', sqft: 1180, propertyType: 'Condominium', address: 'Three-bedroom, partly furnished' },
      { kind: 'vacancy',    value: 3,      date: '2026-04-08', propertyType: 'Condominium', address: 'Weeks between tenancies' },
      { kind: 'mgmt-fee',   value: 425,    date: '2026-04-08', sqft: 1180, propertyType: 'Condominium', address: 'Monthly service charge' },
      { kind: 'land-sold',  value: 612000, date: '2026-02-25', landSqft: 4356, landUnit: 'point', propertyType: 'Vacant lot', address: 'Ten points, corner' },
    ],
  },
  {
    area: 'Batu Kawa',
    attrs: {
      flood: { class: 'recurrent' }, title: { class: 'leasehold' },
      drainage: { class: 'proposed' }, insurance: { class: 'restricted' },
      ground: { class: 'peat-deep' }, coastal: { class: 'settling' },
      lease: { value: 61 },
    },
    records: [
      { kind: 'sold-price', value: 438000, date: '2026-01-23', sqft: 1400, titleType: 'mixed-zone', propertyType: 'Terrace', address: 'Intermediate terrace, Batu Kawa' },
      { kind: 'let-rent',   value: 1400,   date: '2026-03-30', sqft: 1400, propertyType: 'Terrace', address: 'Unfurnished, annual tenancy' },
      { kind: 'vacancy',    value: 14,     date: '2026-03-30', propertyType: 'Terrace', address: 'Weeks between tenancies' },
      { kind: 'mgmt-fee',   value: 90,     date: '2026-03-30', sqft: 1400, propertyType: 'Terrace', address: 'Monthly estate charge' },
      { kind: 'land-sold',  value: 174000, date: '2025-11-08', landSqft: 3484.8, landUnit: 'point', propertyType: 'Vacant lot', address: 'Eight points, interior' },
    ],
  },
];

const sampleObservations = () => (State.observations || []).filter(o => o.sample);
const hasWorkedExample = () => sampleObservations().length > 0;

/* Every seeded record, built the same way manual entry builds one so the two
   cannot drift apart in shape. `evidence: 'assumed'` rather than a class that
   would let it lift a grade — and standing overrides it anyway. */
function seedWorkedExample() {
  if (hasWorkedExample()) return { added: 0, why: 'already loaded' };

  let added = 0;
  SAMPLE_AREAS.forEach(({ area, attrs, records }) => {
    Object.entries(attrs).forEach(([attrId, rec]) => {
      const k = areaKey(SAMPLE_CITY, area);
      const was = (State.areaProfiles[k] || {})[attrId] || null;
      if (was) return;                    /* never overwrite what the reader recorded */
      const full = { class: '', value: null, source: 'unstated', asOf: '', ref: SAMPLE_REF,
                     sample: true, ...rec };
      const prev = { ...(State.areaProfiles[k] || {}) };
      prev[attrId] = { ...full, recordedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') };
      /* actor in the detail overrides the reader's own name — these events are
         not theirs and the history must not say they are. */
      logRegister('areaAttr', 'add', k, { field: attrId, from: null, to: prev[attrId], actor: SAMPLE_ACTOR });
      State.areaProfiles[k] = prev;
    });
    saveAreaProfiles();

    records.forEach(r => {
      const rec = {
        address: '', propertyType: '', sqft: null, reviewedBy: '', reviewedAt: '',
        city: SAMPLE_CITY, area, evidence: 'assumed', sourceRef: SAMPLE_REF,
        ...r,
        sample: true,
        id: `obs-sample-${area.toLowerCase().replace(/\W+/g, '')}-${r.kind}-${r.date}-${added}`,
        recordedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };
      logRegister('observation', 'add', rec.id, { after: rec, actor: SAMPLE_ACTOR });
      State.observations = [rec, ...State.observations];
      added++;
    });
  });
  saveObservations();

  /* The other two surfaces, so the example is the whole product rather than one
     screen of it. Neither overwrites work in progress. */
  if (!State.wheel?.strike) {
    State.wheel = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true };
    saveWheel();
  }
  if (State.screen && samePreset(State.screen.cols, COL_PRESETS[0])) {
    State.screen.cols = [...COL_PRESETS[1].cols];    /* business quality */
  }

  return { added, areas: SAMPLE_AREAS.length };
}

/* Removes ONLY what was seeded. A reader who recorded three real transactions
   next to the example keeps all three — which is the difference between a demo
   you can clear and a demo you have to reinstall the browser to escape. */
function clearWorkedExample() {
  const gone = sampleObservations();
  gone.forEach(o => logRegister('observation', 'delete', o.id, { before: o, actor: SAMPLE_ACTOR }));
  State.observations = (State.observations || []).filter(o => !o.sample);
  saveObservations();

  Object.entries(State.areaProfiles).forEach(([k, prof]) => {
    const kept = Object.fromEntries(Object.entries(prof).filter(([, v]) => !v.sample));
    Object.entries(prof).filter(([, v]) => v.sample).forEach(([attrId, v]) =>
      logRegister('areaAttr', 'delete', k, { field: attrId, from: v, to: null, actor: SAMPLE_ACTOR }));
    if (Object.keys(kept).length) State.areaProfiles[k] = kept;
    else delete State.areaProfiles[k];
  });
  saveAreaProfiles();

  if (State.wheel?.isWorkedExample) {
    State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, isWorkedExample: false };
    saveWheel();
  }
  return gone.length;
}

/* The control, wherever an empty state would otherwise be the whole screen. */
function workedExampleControls({ compact = false } = {}) {
  const row = el('div', { class: 'row row-wrap', style: `gap:8px;${compact ? '' : 'margin-top:var(--md)'}` });
  if (hasWorkedExample()) {
    row.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      const n = clearWorkedExample();
      render(); toast(`Worked example removed — ${n} record${n === 1 ? '' : 's'}. Anything you recorded is untouched.`);
    } }, 'Remove the worked example'));
  } else {
    row.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
      const r = seedWorkedExample();
      render(); toast(`${r.added} illustrative records loaded across ${r.areas} districts. Every one is marked as invented.`);
    } }, 'Load the worked example'));
  }
  return row;
}

/* One sentence, used beside every control above, so the offer is never made
   without the warning attached to it. */
const WORKED_EXAMPLE_NOTE =
  'Three Kuching districts with invented transactions, rents, vacancy, flood, title, '
  + 'drainage, insurance, ground conditions and coastal exposure — plus land sales in points and service '
  + 'charges, so every rate the tool derives has something to divide. Enough to see what it does before recording anything real. '
  + 'Nothing in it is a real property or a real figure, every row is marked, and removing it leaves your own records alone.';
