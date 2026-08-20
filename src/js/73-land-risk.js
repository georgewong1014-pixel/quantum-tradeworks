/* ==========================================================================
   LAND RISK — WHAT IS KNOWN, WHAT IS NOT, AND NO SINGLE NUMBER
   --------------------------------------------------------------------------
   The obvious build is a land risk score. It is also the wrong one, and for a
   reason worth writing down: the hazards here are not commensurable. Deep peat
   is a construction cost that lands before completion. Shoreline erosion is a
   loss of the asset itself. Native area title is not a risk at all — it is a
   question of whether the transaction is lawful for the buyer. Averaging those
   into a 7.4 produces a number with no referent, and a reader who is told 7.4
   stops asking which of the four it was.

   So this returns a PROFILE: every hazard, its recorded class, when it was
   recorded and who says so — and, given equal billing, the hazards nobody has
   established. An unrecorded hazard is the most dangerous state a site can be
   in and the one a score hides best, because a score has to put something in
   the gap and whatever it puts there is invented.

   THE MOST IMPORTANT LINE THIS PRODUCES IS THE LAST ONE.

   "Four of seven recorded" is the honest headline for most localities in this
   register, and it should stay uncomfortable. It is the difference between a
   site that has been looked at and one that has not.
   ========================================================================== */

/* Which recorded attributes are hazards, in the order a buyer meets them.
   Title comes first because it can end the transaction rather than price it,
   and no amount of good ground makes restricted land transferable. */
const LAND_RISK_ATTRS = ['title', 'ground', 'coastal', 'flood', 'drainage', 'insurance', 'lease'];

/* What a class MEANS for a decision, in one line, where the attribute registry's
   own note is about the classification rather than its consequence. */
const RISK_CONSEQUENCE = {
  title: {
    'native-area': 'Transfer is restricted by status, not by price. Establish eligibility before anything else is worth costing.',
    'native-cust': 'NCR land. Documentation is frequently unresolved and this is not a matter a calculator can help with.',
    'interior': 'Restricted class. Nothing below is actionable until the Land and Survey Department has confirmed the position.',
  },
  ground: {
    'peat-deep': 'Deep piling dominates build cost, and unpiled ground keeps settling for decades. Price the piling before the plot.',
    'peat-shallow': 'The building is piled and stands; aprons, drains and boundary walls settle around it as recurring maintenance.',
    'fill': 'Made ground of unrecorded origin. This is the class that most often turns out worse than assumed once a borehole is put down.',
    'alluvial': 'Piling generally required above single storey. Long-term settlement of unpiled ground is normal, not a defect.',
  },
  coastal: {
    'erosion': 'The parcel itself can shrink. Verify against a survey rather than an account, and check the setback.',
    'settling': 'Ground movement already observed. The rate matters more than the fact — find out when it was measured, not just that it was seen.',
    'saline': 'A durability cost rather than an event: reinforcement and buried services have shorter lives here.',
    'tidal': 'Sets a floor under how well the site can ever drain, whether or not it has flooded.',
  },
  insurance: {
    'refused': 'If cover is refused, a lender will usually follow. Establish financeability before price.',
    'restricted': 'Cover with material exclusions changes what a loss actually pays out, and lenders read the exclusions.',
  },
};

/* One hazard's state for one locality. */
function landRiskItem(city, area, attrId) {
  const attr = ATTR_BY_ID[attrId];
  if (!attr) return null;
  const rec = areaAttr(city, area, attrId);
  if (!rec) {
    return { id: attrId, label: attr.label, short: attr.short, recorded: false,
             why: attr.why, caveat: attr.caveat };
  }
  const src = AREA_SOURCE_BY_ID[rec.source];
  const base = { id: attrId, label: attr.label, short: attr.short, recorded: true,
                 asOf: rec.asOf || '', ref: rec.ref || '',
                 source: src ? src.label : 'source not stated',
                 verified: !!(src && src.verified),
                 caveat: attr.caveat, sample: !!rec.sample };
  if (attr.kind === 'number') {
    return { ...base, kind: 'number', value: rec.value,
             text: isNum(rec.value) ? `${fmtNum(rec.value, 0)} ${attr.unit}` : '—',
             rank: isNum(rec.value) ? null : null };
  }
  const c = attrClass(attr, rec.class);
  return { ...base, kind: 'class', class: rec.class, text: c ? c.label : '—',
           rank: c ? c.rank : null, tone: c ? c.tone : null,
           note: c ? c.note : '',
           consequence: (RISK_CONSEQUENCE[attrId] || {})[rec.class] || null,
           restricted: !!(c && c.restricted) };
}

/* THE PROFILE. No score, deliberately. */
function landRiskProfile(city, area) {
  const items = LAND_RISK_ATTRS.map(id => landRiskItem(city, area, id)).filter(Boolean);
  const recorded = items.filter(i => i.recorded);
  const missing = items.filter(i => !i.recorded);

  /* A blocker is a recorded class that stops the transaction rather than
     pricing it. These are stated separately because they are a different kind
     of statement from "this will cost more". */
  const blockers = recorded.filter(i => i.restricted || i.class === 'refused');
  /* Everything else recorded at the top of its own scale — a cost, not a stop. */
  const material = recorded.filter(i => !blockers.includes(i) && isNum(i.rank) && i.rank >= 3);
  /* A hazard recorded from an unverified source is recorded, not established. */
  const unverified = recorded.filter(i => !i.verified);
  const stale = recorded.filter(i => i.asOf && monthsSince(i.asOf) > 60);

  return {
    items, recorded, missing, blockers, material, unverified, stale,
    total: items.length,
    /* The headline, and it should stay uncomfortable. */
    sentence: missing.length === 0
      ? `All ${items.length} hazards recorded for ${area}.`
      : `${recorded.length} of ${items.length} hazards recorded for ${area}. `
        + `${missing.map(m => m.short.toLowerCase()).join(', ')} ${missing.length === 1 ? 'has' : 'have'} not been established by anyone.`,
  };
}

/* The panel. Used on the area screen and on the calculator, from one builder,
   so the two can never describe the same locality differently. */
function landRiskPanel(city, area, { compact = false } = {}) {
  const p = landRiskProfile(city, area);
  const card = el('div', { class: 'card' });
  card.append(cardHead(`Land risk — ${area}`,
    'Every hazard this register can hold, and which of them anybody has actually established. '
    + 'No score is produced: deep peat is a build cost, erosion is a loss of the asset and restricted title is a question of lawfulness, and a number that averages the three would mean nothing.'));

  if (p.blockers.length) {
    const ul = el('ul', { class: 'ticklist blocklist', style: 'margin-top:var(--md)' });
    p.blockers.forEach(b => ul.append(el('li', {},
      `${b.label}: ${b.text}. ${b.consequence || b.note || ''}`.trim())));
    card.append(ul);
  }

  const t = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  t.append(el('thead', {}, el('tr', {}, ['Hazard', 'Recorded as', 'Source', 'As at', 'What it means']
    .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
  const tb = el('tbody');
  p.items.forEach(i => {
    tb.append(el('tr', {}, [
      el('th', { scope: 'row', style: 'text-align:left' }, i.label),
      el('td', { style: 'text-align:left' }, i.recorded
        ? el('span', { class: i.restricted ? 'chip chip-bronze' : 'chip' }, i.text)
        : el('span', { class: 'caption' }, 'nobody has established this')),
      el('td', { class: 'caption', style: 'text-align:left' },
        i.recorded ? `${i.source}${i.verified ? '' : ' · unverified'}` : '—'),
      el('td', { class: 'caption', style: 'text-align:left' }, i.recorded ? (i.asOf || 'undated') : '—'),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
        i.recorded ? (i.consequence || i.note || '—') : (i.why || '—')),
    ]));
  });
  t.append(tb);
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  gridKeyboard(t, `Land risk for ${area}. Arrow keys move between cells.`);

  card.append(el('p', { class: 'body', style: 'font-weight:600;margin-top:var(--md)' }, p.sentence));

  const notes = [];
  if (p.unverified.length) notes.push(
    `${p.unverified.length} of the recorded hazards rest on a source that has not been verified. Recorded is not the same as established.`);
  if (p.stale.length) notes.push(
    `${p.stale.map(s => s.short.toLowerCase()).join(', ')} ${p.stale.length === 1 ? 'was' : 'were'} recorded more than five years ago. Drainage schemes complete, insurers withdraw and settlement continues; a dated fact is only as good as its date.`);
  if (p.items.some(i => i.sample)) notes.push(
    'Some of these are worked-example records — invented figures loaded to demonstrate the tool. Remove the worked example before reading this as evidence.');
  notes.forEach(n => card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' }, n)));

  if (!compact) card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'Nothing here is inferred from a map, a model or a postcode. Every line is a fact somebody recorded against this locality, '
    + 'and a blank line means nobody has. This product holds no subsidence model, no soil map and no shoreline survey, and offers no forecast from any of them.'));
  return card;
}
