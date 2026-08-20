/* ==========================================================================
   THE IPS ON SCREEN — THE DOCUMENT, THE GATES AND THE THREE NEW TESTS
   ========================================================================== */

/* ---- the eight gates, for whichever asset supplied the answers ---- */
function ipsGatePanel(assessment, { title = 'Against the methodology' } = {}) {
  const a = assessment;
  const card = el('div', { class: 'card' });
  card.append(cardHead(title,
    `The eight gates every asset passes through, in the order IPS §3 fixes them. `
    + 'A gate is answered, partly answered, not established, or failing — there is no fifth state, because "probably fine" is what lets an unexamined asset through.'));

  card.append(el('p', { class: 'body', style: 'font-weight:600;margin-top:var(--md)' }, a.sentence));

  const t = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  t.append(el('thead', {}, el('tr', {}, ['#', 'Gate', 'State', 'Why'].map((h, i) =>
    el('th', { style: i === 3 ? 'text-align:left' : (i ? null : 'text-align:left') }, h)))));
  const tb = el('tbody');
  a.answers.forEach(x => {
    tb.append(el('tr', {}, [
      el('th', { scope: 'row', style: 'text-align:left' }, String(x.gate.n)),
      el('td', { style: 'text-align:left', title: x.gate.ask }, x.gate.label),
      el('td', { style: 'text-align:left' }, el('span', { class: x.verdict.tone }, x.verdict.label)),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, x.why),
    ]));
  });
  t.append(tb);
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  gridKeyboard(t, 'Assessment against the eight IPS gates. Arrow keys move between cells.');

  /* THE LINE THAT KEEPS THIS HONEST. */
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'This states what is true of the evidence. It is not a recommendation, a rating or a suitability assessment, '
    + 'and no part of it tells you what to do — this product holds no licence to advise and asks nothing about your circumstances. '
    + `Governing document: ${IPS_VERSION}.`));
  return card;
}

/* ---- §6.5 demand ---- */
function demandPanel(city, area) {
  const test = demandTest(city, area);
  const card = el('div', { class: 'card' });
  card.append(cardHead(`Demand — ${area}`,
    'Who has a recurring reason to occupy or buy here. IPS §6.5 makes this a required test and penalises concentration: '
    + 'one source that can stop is not a demand base.'));

  const v = IPS_VERDICTS[test.verdict] || IPS_VERDICTS.unknown;
  card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md);align-items:center' }, [
    el('span', { class: v.tone }, v.label),
    el('span', { class: 'body', style: 'font-size:13px' }, test.why),
  ]));

  const t = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  t.append(el('thead', {}, el('tr', {}, ['Source', 'State', 'Counts', 'Note', ''].map((h, i) =>
    el('th', { style: i ? null : 'text-align:left' }, h)))));
  const tb = el('tbody');
  test.items.forEach(i => {
    const sel = el('select', { class: 'select select-sm', 'aria-label': `State of ${i.source.label} demand`,
      onchange: e => {
        setDemand(city, area, i.source.id, e.target.value ? { state: e.target.value, asOf: new Date().toISOString().slice(0, 10) } : null);
        render();
      } });
    sel.append(el('option', { value: '' }, 'Not recorded'));
    DEMAND_STATES.forEach(s => sel.append(el('option', { value: s.id, title: s.note,
      selected: i.state && i.state.id === s.id ? '' : null }, s.label)));
    tb.append(el('tr', {}, [
      el('th', { scope: 'row', style: 'text-align:left' }, [
        i.source.label,
        i.source.notDemand ? el('span', { class: 'chip chip-bronze', style: 'margin-left:6px' }, 'not occupier demand') : null,
        i.source.fragile && !i.source.notDemand ? el('span', { class: 'chip chip-bronze', style: 'margin-left:6px' }, 'fragile') : null,
      ].filter(Boolean)),
      el('td', { style: 'text-align:left' }, sel),
      el('td', { style: 'text-align:left' }, i.counts
        ? el('span', { class: 'chip chip-ok' }, 'yes')
        : el('span', { class: 'caption' }, i.state ? 'no' : '—')),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
        i.state ? i.state.note : i.source.ask),
      el('td', {}, ''),
    ]));
  });
  t.append(tb);
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  test.warnings.forEach(w => card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' }, w)));
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'An announced source is recorded and never counted until it operates. That single rule is the one this product would keep '
    + 'if it could keep only one: the demand story that has not happened yet has carried more Malaysian off-plan losses than any other.'));
  return card;
}

/* ---- §6.7 environmental depreciation ---- */
function environmentalPanel(d) {
  const env = environmentalAllowance(d);
  const card = el('div', { class: 'card' });
  card.append(cardHead('Environmental allowance',
    'IPS §6.7 requires recurring allowances in coastal, flood-prone or humid environments. '
    + 'Every one below is triggered by something recorded against this locality — nothing is inferred from the town.'));

  if (!env.anyRecorded) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' }, env.why));
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Record coastal exposure, flood history or ground conditions for ${d.district} on the area screen and this fills in.`));
    return card;
  }

  const t = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  t.append(el('thead', {}, el('tr', {}, ['Allowance', 'Triggered by', '% of value a year', 'Per year', 'What it covers']
    .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
  const tb = el('tbody');
  env.items.forEach(i => {
    tb.append(el('tr', {}, [
      el('th', { scope: 'row', style: 'text-align:left' }, i.label),
      el('td', { class: 'caption', style: 'text-align:left' },
        `${ATTR_BY_ID[i.triggeredBy] ? ATTR_BY_ID[i.triggeredBy].short : i.triggeredBy}: ${i.triggeredByClass}`),
      el('td', { class: 'num' }, fmtPct(i.pctOfValue, 2)),
      el('td', { class: 'num' }, fmtMoney(i.annual, 'MYR', 0)),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, i.note),
    ]));
  });
  tb.append(el('tr', { style: 'background:var(--surface-sunk)' }, [
    el('th', { scope: 'row', style: 'text-align:left;font-weight:600' }, 'Total'),
    el('td', {}, ''), el('td', {}, ''),
    el('td', { class: 'num', style: 'font-weight:600' }, fmtMoney(env.annual, 'MYR', 0)),
    el('td', { class: 'caption', style: 'text-align:left' }, `${fmtMoney(env.monthly, 'MYR', 0)} a month`),
  ]));
  t.append(tb);
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  gridKeyboard(t, 'Environmental allowances. Arrow keys move between cells.');

  if (env.unexamined.length) card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
    `${env.unexamined.map(u => (ATTR_BY_ID[u] || {}).short || u).join(', ')} ${env.unexamined.length === 1 ? 'has' : 'have'} not been recorded for this locality, `
    + 'so any allowance those would trigger is missing from the total. The figure below is a floor, not an estimate.'));
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'These percentages are planning figures, not survey results. No condition report underlies them and they are stated so they can be replaced: '
    + 'a quantity surveyor who has seen the building will produce better ones, and this exists so the line is not simply absent.'));
  return card;
}

/* ---- §6.8 rent versus buy ---- */
function rentVersusBuyPanel(d, m) {
  const card = el('div', { class: 'card' });
  card.append(cardHead('Rent, or buy',
    'IPS §6.8. For a property you would use yourself rather than let, the comparison is between owning it all year '
    + 'and renting it for the weeks you actually want it.'));

  const weeks = num0(State.deal.ownUseWeeks);
  const f = el('div', { class: 'assumption', style: 'margin-top:var(--md)' });
  f.append(el('label', { for: 'ownUseWeeks' }, 'Weeks a year you would use it yourself'));
  f.append(el('input', { class: 'input a-text', id: 'ownUseWeeks', type: 'number', min: '0', max: '52',
    value: weeks > 0 ? String(weeks) : '',
    placeholder: 'e.g. 4',
    'aria-label': 'Weeks a year of your own use',
    onchange: e => { State.deal.ownUseWeeks = Number(e.target.value) || 0; saveDeal(); render(); } }));
  card.append(f);

  const r = rentVersusBuy(d, m, weeks > 0 ? weeks : null);
  if (!r.ok) { card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' }, r.why)); return card; }

  const g = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
  g.append(el('div', { class: 'panel' }, statTile('Price to rent', `${fmtNum(r.priceToRent, 1)}×`,
    { sub: 'Purchase price over one year of market rent' })));
  g.append(el('div', { class: 'panel' }, statTile('True cost to own', fmtMoney(r.trueCarrying, 'MYR', 0),
    { sub: `A year, including ${fmtMoney(r.opportunity, 'MYR', 0)} the deposit is not earning elsewhere` })));
  g.append(el('div', { class: 'panel' }, statTile('Cost to rent instead',
    isNum(r.rentInstead) ? fmtMoney(r.rentInstead, 'MYR', 0) : '—',
    { sub: isNum(r.weeks) ? `${fmtNum(r.weeks, 0)} weeks at this property's own rent` : 'Enter your weeks of use' })));
  card.append(g);

  card.append(el('p', { class: 'body', style: 'font-weight:600;margin-top:var(--md)' }, r.classification));
  card.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:6px' }, r.why));
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'Classifying a purchase as consumption is not a judgement about whether to make it. People buy things they enjoy, and that is a '
    + 'complete reason. It matters here only because consumption modelled as income overstates what the property returns, '
    + 'and every figure elsewhere in this report would inherit that.'));
  return card;
}

/* ---- the published governing document ---- */
VIEWS.ips = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Methodology'),
    el('h1', {}, 'Investment Policy Statement'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'The governing document. Everything this product computes is an execution of what is written here, and where the two '
      + 'ever disagree, this page is what is wrong — not the code.'),
    el('p', { class: 'metaline', style: 'margin-top:6px' }, IPS_VERSION),
  ])));

  /* The deviation, stated at the top rather than buried. */
  const dev = el('div', { class: 'card', style: 'border-color:var(--bronze)' });
  dev.append(cardHead('One deviation from the IPS as written',
    'Section 8 requires every decision to state Buy, Watch/Hold or Reject, and section 10 calls the output a recommendation. '
    + 'This product publishes neither, and the reason is not stylistic.'));
  dev.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
    'It is research only. It holds no licence to advise, it asks nothing about your circumstances, and the disclosure on every '
    + 'page rests on that. The substance of section 8 is kept in full; only the verb changes.'));
  const dl = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  dl.append(el('thead', {}, el('tr', {}, ['IPS §8 says', 'This product says', 'Why it is the same information']
    .map(h => el('th', { style: 'text-align:left' }, h)))));
  dl.append(el('tbody', {}, [
    ['Reject', 'A hard gate refuses; no assessment is produced',
     'Already how this works. Refusing to answer is the absence of advice, not a form of it.'],
    ['Buy', '"Meets every condition in the methodology"',
     'A statement about the analysis rather than an instruction to the reader. Nothing is withheld.'],
    ['Watch / Hold', '"Conditions not yet met", naming each one',
     'The outstanding gates are listed, which is more than a Hold would have told you.'],
  ].map(r => el('tr', {}, r.map((c, i) =>
    el(i ? 'td' : 'th', { scope: i ? null : 'row', class: i === 2 ? 'caption' : '', style: 'text-align:left;white-space:normal' }, c))))));
  dev.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, dl));
  wrap.append(dev);

  /* §2 */
  const phil = el('div', { class: 'card' });
  phil.append(cardHead('The ten principles', 'IPS §2. Malaysia-first, cross-asset, evidence-based.'));
  const pl = el('ol', { style: 'margin:var(--md) 0 0;padding-left:1.3em;display:flex;flex-direction:column;gap:8px' });
  IPS_PRINCIPLES.forEach(p => pl.append(el('li', {}, [
    el('span', { style: 'font-weight:600' }, p.t),
    el('span', { class: 'caption', style: 'display:block' }, p.d),
  ])));
  phil.append(pl);
  phil.append(el('p', { class: 'body', style: 'font-weight:600;margin-top:var(--lg)' }, IPS_ONE_SENTENCE));
  phil.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'IPS §11 states this as an instruction. It is published here as the condition it describes, for the same reason section 8 is.'));
  wrap.append(phil);

  /* §3 */
  const gates = el('div', { class: 'card' });
  gates.append(cardHead('The eight gates', 'IPS §3. Every asset, same order. A high score does not carry an asset past a failing gate.'));
  const gt = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  gt.append(el('thead', {}, el('tr', {}, ['#', 'Gate', 'The question it asks'].map((h, i) =>
    el('th', { style: i ? 'text-align:left' : 'text-align:left' }, h)))));
  gt.append(el('tbody', {}, IPS_GATES.map(g => el('tr', {}, [
    el('th', { scope: 'row', style: 'text-align:left' }, String(g.n)),
    el('td', { style: 'text-align:left' }, g.label),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, g.ask),
  ]))));
  gates.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, gt));
  wrap.append(gates);

  /* §4 — and the honest admission that tier 3 is empty here. */
  const ev = el('div', { class: 'card' });
  ev.append(cardHead('The evidence hierarchy, and where this product actually sits',
    'IPS §4 names five tiers. This states which of them each grade in this product belongs to, so the mapping can be checked rather than trusted.'));
  const et = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  et.append(el('thead', {}, el('tr', {}, ['Tier', 'IPS description', 'Grades in this product', 'Note']
    .map((h, i) => el('th', { style: i ? 'text-align:left' : null }, h)))));
  et.append(el('tbody', {}, IPS_EVIDENCE_TIERS.map(t => el('tr', {}, [
    el('th', { scope: 'row', class: 'num' }, String(t.tier)),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, t.label),
    el('td', { style: 'text-align:left' }, t.maps.length
      ? t.maps.map(id => el('span', { class: 'chip', style: 'margin-right:4px' },
          (EVIDENCE.find(e => e.id === id) || { label: id }).label))
      : el('span', { class: 'chip chip-bronze' }, 'empty here')),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, t.note),
  ]))));
  ev.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, et));
  wrap.append(ev);

  /* §6.1 */
  const ord = el('div', { class: 'card' });
  ord.append(cardHead('The property screening order', 'IPS §6.1. Fixed, and the order is the control.'));
  ord.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
    'Financeability is answered first so that an attractive price cannot hide an asset a bank will not lend against, '
    + 'and yield comes fourth so that nobody reaches it before establishing who would rent the place.'));
  const ol = el('ol', { style: 'margin:var(--md) 0 0;padding-left:1.3em;display:flex;flex-direction:column;gap:8px' });
  IPS_PROPERTY_ORDER.forEach(o => ol.append(el('li', {}, [
    el('span', { style: 'font-weight:600' }, o.label),
    el('span', { class: 'caption', style: 'display:block' }, o.why),
  ])));
  ord.append(ol);
  wrap.append(ord);

  /* §6.9 */
  const rej = el('div', { class: 'card' });
  rej.append(cardHead('Auto-reject conditions', 'IPS §6.9. Any one of these refuses regardless of every other figure.'));
  const rl = el('ul', { class: 'ticklist blocklist', style: 'margin-top:var(--md)' });
  IPS_PROPERTY_REJECTS.forEach(r => rl.append(el('li', {}, r.label)));
  rej.append(rl);
  rej.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'These are enforced, not listed. A refusal produces no assessment at all rather than a lower one — a deduction can be '
    + 'outweighed by a good number somewhere else, and that is exactly what must not happen here.'));
  wrap.append(rej);

  wrap.append(el('div', { class: 'card' }, [
    cardHead('What is not implemented', 'Stated because a published methodology that overstates its own coverage is worse than none.'),
    (() => {
      const ul = el('ul', { class: 'ticklist blocklist', style: 'margin-top:var(--md)' });
      [
        'IPS §4 tier 3 — no market-data provider is licensed to this product. NAPIC and JPPH transaction data, which §6.2 names, cannot be redistributed here.',
        'IPS §5 — the equity engine answers the eight gates only for property so far. Equities and the cash wheel still use their own scorecards.',
        'IPS §7 — cross-asset comparison of after-cost risk-adjusted forward return is not built.',
        'IPS §9 — portfolio-level correlation, concentration and stress testing across positions is not built.',
        'IPS §6.2 — the mortgage stress test here uses three percentage points, not the one point the IPS specifies. The more conservative figure was already in place and has been kept; this is a deliberate departure and not an oversight.',
      ].forEach(x => ul.append(el('li', {}, x)));
      return ul;
    })(),
  ]));
  return wrap;
};
