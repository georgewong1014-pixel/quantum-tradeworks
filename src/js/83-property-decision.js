/* ==========================================================================
   THE PROPERTY DECISION LAYER — P1 AND P2 (the owner's brief, 7 Oct 2026:
   briefs/README-property-decision-layer.md; the owner's answers: the lens
   never reorders columns, and no ranked risk ladder)
   --------------------------------------------------------------------------
   P1, THE QUESTIONS. At the start of /property (the Scenario Lab) and of
   the calculator: What are you buying? — Residential · Commercial (and its
   subtype) · Land; How are you buying? — New development · Subsale ·
   Auction; and, optional, the objective, which decides which figures lead
   and nothing else. The registries and the rule that an unanswered deal is
   a subsale of its current class are in 70-property.js (PROPERTY_ROUTES).
   On a phone each question is one line of chips that scrolls sideways
   (ls-chips), its legend beside it.

   WHERE AN ANSWER IS WRITTEN (the owner's decision, 9 Oct 2026: saving is
   the only write). On the calculator, to the deal there (saveDeal), as any
   field of it is — a saved property's working copy, saved to it by its
   Save. On the Lab, nowhere until Save: an answer is a move of every
   column (a column is a scenario of the same property), the figures follow
   at once and the property reads as not saved; the guided Save of an
   unsaved deal saves it with the property, and a saved property's Save
   beside its name writes it there (82-property-lab.js, labAnswer).

   ON A PHONE the questions fold into one summary line (pqChangeButton).

   P2, THE SUBSALE EVIDENCE MODEL. Two figures, from the reader's own
   evidence and the calculator's own model:
   - the price gap: the asking price against the value the comparables the
     reader named imply (priceGap, 70-property.js) — the comparables named
     every time, never a market figure;
   - the price that makes this work: the highest price at which the
     figures entered meet a target the reader sets (solveDealPrice,
     75-property-grade.js: a goal-seek on dealModel, to the ringgit).
   Shown with the layout system's card types (an insight card each, or an
   action card while something it needs is missing), the working in the
   evidence (L3). The wording is the figures': "the figures you entered
   imply…", never a verdict on the deal.
   ========================================================================== */

/* -------------------------------------------------------------- answers */
/* The class, through the override the calculator's Asset class select
   writes: none while it is the class the property type implies. */
function setDealClass(d, cls, { touch = true } = {}) {
  if (!d || !PROPERTY_CLASSES[cls]) return false;
  const inferred = PROPERTY_TYPE_CLASS[d.propertyType] || propertyClassOfCategory(d.category) || 'residential';
  const next = cls === inferred ? null : cls;
  if ((d.propertyClassOverride || null) === next) return false;
  d.propertyClassOverride = next;
  if (touch) markTouched(d, 'propertyClassOverride');
  return true;
}
/* One answer, as a writer of a deal: the class through setDealClass, the
   rest through setDealAnswer (70-property.js). */
/* Several at once as a record — { targetKind, targetValue } — so one edit is one write and one drawing. */
/* `touch: false` for a what-if (the Lab's moves): which figures are the
   reader's is marked when a commit makes them so (labNext), not before. */
const pqWriter = (k, v, opts = {}) => (d) => (isRecord(k)
  ? Object.entries(k).map(([kk, vv]) => pqWriter(kk, vv, opts)(d)).some(Boolean)
  : k === 'propertyClass' ? setDealClass(d, v, opts) : setDealAnswer(d, k, v));

/* A saved property's answer, written where it is kept. Stamped as saved
   now; null, and said, if the browser refused it. */
function pmAnswerRecord(recId, write) {
  const list = loadWork();
  const rec = list.find(r => r.id === recId && pmIsProperty(r));
  if (!rec) return false;
  const deal = pmCopy(pmInputsOf(rec));
  if (!write(deal)) return false;
  rec.payload = { ...rec.payload, deal };
  pmStampRecord(rec, new Date().toISOString());
  const refused = store.failed;
  if (!persistWork(list) || store.failed !== refused) { toast(STORE_REFUSED); return false; }
  return true;
}

/* --------------------------------------------------------- the questions */
const PQ_WHAT = () => PROPERTY_CLASS_IDS.map(id => [id, PROPERTY_CLASSES[id].label]);
const PQ_HOW = () => PROPERTY_ROUTE_IDS.map(id => [id, PROPERTY_ROUTES[id].label]);
const PQ_SUB = () => COMMERCIAL_SUBTYPE_IDS.map(id => [id, COMMERCIAL_SUBTYPES[id].label]);
const PQ_WHY = () => [[null, PROPERTY_OBJECTIVE_NONE.label], ...PROPERTY_OBJECTIVE_IDS.map(id => [id, PROPERTY_OBJECTIVES[id].label])];

function pqGroup(prefix, group, legend, options, cur, onPick) {
  const name = `${prefix}-q-${group}`;
  const fs = el('fieldset', { class: `lab-pick pq-q pq-q-${group}`, id: name, 'data-q': group });
  fs.append(el('legend', { class: 'lab-legend pq-legend' }, legend));
  fs.append(el('div', { class: 'lab-seg ls-chips pq-seg', role: 'presentation' }, options.map(([id, label]) => {
    const rid = `${name}-${id ?? 'none'}`, on = (id ?? null) === (cur ?? null);
    return el('label', { class: `lab-seg-opt pq-opt${on ? ' is-on' : ''}`, for: rid }, [
      el('input', { type: 'radio', class: 'lab-radio', name, id: rid, value: id ?? '', checked: on ? '' : null,
        onchange: () => onPick(id ?? null) }),
      el('span', {}, label)]);
  })));
  return fs;
}

/* THE BLOCK. `d` is the deal the answers are read from; `answer(k, v)`
   writes one (the page's own writer). Ids under `prefix`, so the Lab and
   the calculator each have their own. */
/* ON A PHONE, ONE LINE (the owner's decision, 9 Oct 2026). Under 640px the
   questions fold behind a summary — "Residential · Subsale" and Change, a
   44px target — and open in place, under it: nothing above them moves.
   Desk and tablet show them whole. Folded by the stylesheet alone, and only
   where a script runs (scripting: enabled): the page served before the
   script is laid out as the page it draws, and with no script at all the
   questions stand open under their summary. Whether they are open is kept
   for the tab (PQ_OPEN), so a page drawn again after an answer keeps them
   open. */
const PQ_OPEN = new Set();
const pqSummaryText = (d) => {
  const cls = propertyClassOf(d), sub = dealCommercialSubtype(d), o = dealObjective(d);
  return [`${PROPERTY_CLASSES[cls].label}${sub ? ` — ${COMMERCIAL_SUBTYPES[sub].label}` : ''}`, PROPERTY_ROUTES[dealRoute(d)].label, o.id ? o.label : null].filter(Boolean).join(' · ');
};
/* Whether the questions fold here: their Change is drawn (a phone). From
   640px it is out of sight, never display:none — so asked of its style. */
const pqFolds = (prefix) => { const b = document.getElementById(`${prefix}-q-change`); return !!b && getComputedStyle(b).visibility !== 'hidden' && b.getClientRects().length > 0; };
function pqSetOpen(prefix, open, { focus = false } = {}) {
  if (open) PQ_OPEN.add(prefix); else PQ_OPEN.delete(prefix);
  document.getElementById(`${prefix}-q`)?.classList.toggle('is-open', open);
  const b = document.getElementById(`${prefix}-q-change`);
  if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (focus && b) b.focus({ preventScroll: true });
}
/* The summary's control: "Change", named for the ear by what it opens. Its
   ::after reaches over the whole summary line, so the line is the target. */
const pqChangeButton = (prefix) => el('button', { type: 'button', class: 'pq-change', id: `${prefix}-q-change`,
  'aria-expanded': PQ_OPEN.has(prefix) ? 'true' : 'false', 'aria-controls': `${prefix}-q`,
  onclick: () => pqSetOpen(prefix, !PQ_OPEN.has(prefix)) },
  ['Change', el('span', { class: 'sr-only' }, ' what you are buying and how'), el('span', { class: 'pq-change-chev', 'aria-hidden': 'true' }, '›')]);
const pqSummaryLine = (d, prefix) => el('span', { class: 'pq-sumline', id: `${prefix}-q-sum` }, pqSummaryText(d));

function propertyQuestions({ d, prefix, answer, summary = true }) {
  const cls = propertyClassOf(d), route = dealRoute(d);
  const box = el('section', { class: `pq${PQ_OPEN.has(prefix) ? ' is-open' : ''}`, id: `${prefix}-q`, 'data-pq': '', 'aria-label': 'What you are buying, and how',
    /* Escape folds them again, the keyboard back on Change. */
    onkeydown: (e) => { if (e.key === 'Escape' && PQ_OPEN.has(prefix) && pqFolds(prefix)) { e.preventDefault(); pqSetOpen(prefix, false, { focus: true }); } } });
  /* Where the page has no line of its own to carry the summary (the
     calculator), it heads the questions; the Lab's is its identity line. */
  if (summary) box.append(el('p', { class: 'pq-sum' }, [pqSummaryLine(d, prefix), pqChangeButton(prefix)]));
  const body = el('div', { class: 'pq-body' });
  box.append(body);
  const row = el('div', { class: 'pq-row' });
  row.append(pqGroup(prefix, 'what', 'What are you buying?', PQ_WHAT(), cls, (v) => answer('propertyClass', v)));
  row.append(pqGroup(prefix, 'how', 'How are you buying?', PQ_HOW(), route, (v) => answer('route', v)));
  if (cls === 'commercial') row.append(pqGroup(prefix, 'sub', 'Which kind?', PQ_SUB(), dealCommercialSubtype(d), (v) => answer('commercialSubtype', v)));
  row.append(pqGroup(prefix, 'why', 'Objective (optional)', PQ_WHY(), dealObjective(d).id, (v) => answer('objective', v)));
  body.append(row);
  /* What the answers mean for the figures, one line each, only where they
     change something: a route not modelled yet, and a class whose fees
     and duties are not the residential defaults' to assume. */
  const notes = [];
  if (PROPERTY_ROUTES[route].coming) notes.push(el('p', { class: 'pq-note pq-note-route', 'data-note': 'route' }, PROPERTY_ROUTES[route].coming));
  /* The auction risk mode (P3): where its terms go, and the gate. */
  if (route === 'auction') notes.push(el('p', { class: 'pq-note pq-note-route', 'data-note': 'route' },
    'Auction: the purchase price is the winning bid you expect. Enter the Proclamation’s terms below — nothing of them is assumed — and no auction figure is final until its checklist is ticked.'));
  const book = propertyClassRulebook(cls);
  if (book) notes.push(el('p', { class: 'pq-note', 'data-note': 'class' }, book.line));
  /* The rules that differ by class, each with its standing and source: in
     reach, not in the way (L3). */
  if (book?.differs.length) notes.push(el('details', { class: 'pq-more ls-l3', id: `${prefix}-q-differs` }, [
    el('summary', { class: 'pq-more-sum' }, 'The lines that differ by class'),
    el('ul', { class: 'pq-more-list' }, book.differs.map(x => el('li', {}, [
      el('strong', {}, x.title), ` — ${x.state}. ${x.what}`,
      ...(x.source ? [' Source: ', x.source.url ? el('a', { href: x.source.url, target: '_blank', rel: 'noopener' }, x.source.title) : x.source.title, '.'] : [])]))),
  ]));
  if (dealObjective(d).id) notes.push(el('p', { class: 'pq-note', 'data-note': 'objective' },
    `${dealObjective(d).label} sets which figures lead; it ranks nothing and moves no column.`));
  if (notes.length) body.append(el('div', { class: 'pq-notes' }, notes));
  return box;
}

/* -------------------------------------------------- the subsale evidence */
const pqMoney = (v) => fmtMoney(v, 'MYR', 0);
const pqSigned = (v) => `${v < 0 ? '−' : '+'}${pqMoney(Math.abs(v))}`;
const pqPctAbs = (v) => `${fmtNum(Math.abs(v), 1)}%`;
const pqWhen = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : 'undated'; };
const pqCompWords = (c) => `${c.name} — ${pqMoney(c.price)}, ${pqWhen(c.date)}, ${c.standing.label.toLowerCase()}`;

/* The gap, in words: the asking price against the comparable value. */
function priceGapWords(g) {
  const n = g.comps.length, named = `the ${n === 1 ? 'comparable' : `${n} comparables`} you named`;
  const ag = g.askingGap;
  const finding = !ag ? null : Math.abs(ag.amount) < 0.5
    ? `The asking price of ${pqMoney(g.asking)} is the ${pqMoney(g.value)} ${named} imply.`
    : `The asking price of ${pqMoney(g.asking)} is ${pqMoney(Math.abs(ag.amount))} (${pqPctAbs(ag.pct)}) ${ag.amount > 0 ? 'above' : 'below'} the ${pqMoney(g.value)} ${named} imply.`;
  const pg = g.priceGap;
  const price = !pg ? null : Math.abs(pg.amount) < 0.5 ? `The price modelled, ${pqMoney(g.price)}, is that value.`
    : `The price modelled, ${pqMoney(g.price)}, is ${pqMoney(Math.abs(pg.amount))} (${pqPctAbs(pg.pct)}) ${pg.amount > 0 ? 'above' : 'below'} it.`;
  return { finding, price, figure: ag ? `${pqSigned(ag.amount)} · ${ag.amount < 0 ? '−' : '+'}${pqPctAbs(ag.pct)}` : null };
}
/* How the gap is worked out (L3): each named comparable, what it implies
   and why, and the median. */
function priceGapFormula(g) {
  if (!g.comps.length) return 'No comparable is named for this property. Name transacted prices from your register — your own records, never a market figure — and the value they imply is their median.';
  const area = g.areaKey === 'landSqft' ? 'land area' : 'built-up area';
  const each = g.comps.map(c => c.basis === 'rate'
    ? `${c.name}: ${pqMoney(c.price)} ÷ ${fmtNum(c.area, 0)} sq ft = ${pqMoney(c.rate)} a sq ft × this property’s ${fmtNum(g.subjectArea, 0)} sq ft = ${pqMoney(c.implied)}`
    : `${c.name}: ${pqMoney(c.price)} as recorded (${g.subjectArea ? `no ${area} recorded with it` : `no ${area} entered for this property`})`);
  return `${each.join('; ')}. The comparable value is the median of ${g.comps.length === 1 ? 'that one figure' : `these ${g.comps.length}`}: ${pqMoney(g.value)}.`
    + (g.asking ? ` Asking ${pqMoney(g.asking)} − ${pqMoney(g.value)} = ${pqSigned(g.askingGap.amount)}.` : ' No asking price is entered.')
    + (g.notUsed ? ` ${g.notUsed} named record${g.notUsed === 1 ? ' is' : 's are'} not used: no longer in the register, or not a transacted price of this kind of property.` : '')
    + ' Each comparable is a record you made; its standing is the register’s. Not a valuation.';
}
/* The solve, in words. */
function priceSolveWords(s, d) {
  const t = s.target;
  if (s.status === 'solved') {
    const rel = [isNum(s.vsPrice) && s.vsPrice !== 0 ? `${pqMoney(Math.abs(s.vsPrice))} ${s.vsPrice < 0 ? 'below' : 'above'} the ${pqMoney(num0(d.price))} modelled` : null,
      isNum(s.vsAsking) && s.vsAsking !== 0 ? `${pqMoney(Math.abs(s.vsAsking))} ${s.vsAsking < 0 ? 'below' : 'above'} the asking price` : null].filter(Boolean);
    return { figure: pqMoney(s.price),
      finding: `At ${pqMoney(s.price)} or less, the figures you entered give ${t.words} of at least ${t.fmt(s.value)}.`,
      sub: rel.length ? `${rel.join('; ')}.` : 'The price modelled.' };
  }
  if (s.status === 'infeasible') return { figure: 'No price',
    finding: `The figures you entered do not reach ${t.words} of ${t.fmt(s.value)} at any price from ${pqMoney(s.floor)}: at ${pqMoney(s.floor)} it is ${t.fmt(s.atFloor)}.`,
    sub: t.id === 'monthly' ? 'The rent, the running costs or the loan terms, not the price, stand in the way.' : 'The rent and the running costs, not the price, stand in the way.' };
  if (s.status === 'unbounded') return { figure: `Above ${pqMoney(s.ceiling)}`,
    finding: `The figures you entered give ${t.words} of at least ${t.fmt(s.value)} at every price up to ${pqMoney(s.ceiling)}, the top of the range tried.`,
    sub: 'A loan held to an entered valuation stops following the price.' };
  return { figure: '—', finding: s.why || 'Not computable for these inputs.', sub: null };
}
function priceSolveFormula(s, d) {
  if (!s || s.status === 'no-target') return 'Set a target — a monthly position or a net yield — and the price that meets it is found by running the calculator’s own model at trial prices, every other input held.';
  const t = s.target && { ...s.target, fmt: s.target.id === 'monthly' ? (v) => fmtMoney(v, 'MYR', 2) : (v) => fmtPct(v, 4) };
  const how = `The calculator’s model (dealModel) is run at trial prices with every other figure as entered, halving the range each time between ${pqMoney(PRICE_SOLVE_FLOOR)} and four times the larger of the price and the asking price: as the price rises the loan and its repayment rise and the net yield falls, so the target holds below one price and fails above it.`;
  if (s.status === 'solved') return `${how} Tolerance: one ringgit on the price, none on the target — at ${pqMoney(s.price)} ${t.label.toLowerCase()} is ${t.fmt(s.achieved)}, at least the ${t.fmt(s.value)} you set; at ${pqMoney(s.price + 1)} it is ${t.fmt(s.above)}${s.aboveMeets ? '' : ', short of it'}. ${s.runs} runs of the model.`;
  if (s.status === 'infeasible') return `${how} At ${pqMoney(s.floor)}, the bottom of the range, ${t.label.toLowerCase()} is ${t.fmt(s.atFloor)} — short of ${t.fmt(s.value)} — so no price in the range meets it. ${s.runs} run${s.runs === 1 ? '' : 's'} of the model.`;
  if (s.status === 'unbounded') return `${how} At ${pqMoney(s.ceiling)}, the top of the range, ${t.label.toLowerCase()} is still ${t.fmt(s.atCeiling)}. ${s.runs} runs of the model.`;
  return s.why || '';
}

/* THE TWO CARDS, from the results. `gapWhy` and `solveWhy` are what "See
   why →" opens; `enter` is where the missing inputs are entered (a path),
   or null where this page is that place. */
function priceEvidenceCards({ d, g, s, prefix, gapWhy, solveWhy, enter = null, setTarget = null }) {
  const cards = el('div', { class: 'pe-cards' });
  /* The price gap. */
  if (g.status === 'ok') {
    const w = priceGapWords(g);
    cards.append(lsInsightCard({ label: 'Price gap', cls: 'pe-card pe-gap', attrs: { 'data-pe': 'gap', 'data-value': String(g.askingGap.amount) },
      figure: el('p', { class: 'ls-card-figure num pe-fig' }, w.figure),
      finding: el('p', { class: 'ls-card-title' }, w.finding),
      sub: el('p', { class: 'ls-card-sub' }, [w.price ? `${w.price} ` : '', `Named: ${g.comps.map(pqCompWords).join('; ')}.`]),
      cta: lsCta('See why', { id: `${prefix}-pe-gap-why`, onclick: gapWhy, sr: ' the price gap is what it is' }) }));
  } else {
    const missing = g.status === 'no-comparables'
      ? (g.asking ? 'Name the comparables from your register that this price is set against.' : 'Enter the asking price and name the comparables from your register it is set against.')
      : `Enter the asking price to set it against the ${pqMoney(g.value)} your ${g.comps.length === 1 ? 'comparable implies' : `${g.comps.length} comparables imply`}.`;
    cards.append(lsActionCard({ title: 'Price gap', line: missing, cls: 'pe-card pe-gap', attrs: { 'data-pe': 'gap', 'data-value': '' },
      cta: enter ? lsCta('Enter them in the calculator', { path: enter, id: `${prefix}-pe-gap-go` })
        : lsCta('Enter them', { id: `${prefix}-pe-gap-go`, onclick: () => { const n = document.getElementById('d-askingPrice'); if (n) { n.scrollIntoView({ block: 'center' }); n.focus({ preventScroll: true }); } } }) }));
  }
  /* The price that makes this work. */
  if (s.status === 'no-target') {
    cards.append(lsActionCard({ title: 'The price that makes this work', line: 'Set a target — a monthly position or a net yield — and the highest price that meets it is solved from these figures.',
      cls: 'pe-card pe-solve', attrs: { 'data-pe': 'solve', 'data-status': s.status, 'data-value': '' },
      cta: lsCta('Set a target', { id: `${prefix}-pe-target-go`, onclick: setTarget }) }));
  } else {
    const w = priceSolveWords(s, d);
    cards.append(lsInsightCard({ label: 'The price that makes this work', cls: 'pe-card pe-solve',
      attrs: { 'data-pe': 'solve', 'data-status': s.status, 'data-value': s.status === 'solved' ? String(s.price) : '' },
      figure: el('p', { class: 'ls-card-figure num pe-fig' }, w.figure),
      finding: el('p', { class: 'ls-card-title' }, w.finding),
      sub: w.sub ? el('p', { class: 'ls-card-sub' }, w.sub) : null,
      cta: lsCta('See why', { id: `${prefix}-pe-solve-why`, onclick: solveWhy, sr: ' this price is solved' }) }));
  }
  return cards;
}

/* THE TARGET'S CONTROLS: what it is (chips) and its figure. `answer(k, v)`
   writes it, as an answer of the property. */
function priceTargetControls({ d, prefix, answer }) {
  const t = dealTarget(d);
  const kind = PRICE_TARGETS[d?.targetKind] ? d.targetKind : null;
  const box = el('div', { class: 'pe-target', id: `${prefix}-pe-target` });
  box.append(pqGroup(prefix, 'target', 'Target, at least', PRICE_TARGET_KINDS.map(k => [k, PRICE_TARGETS[k].label]), kind, (v) => answer('targetKind', v)));
  const id = `${prefix}-pe-target-value`;
  const unit = kind ? PRICE_TARGETS[kind].unit : 'RM a month or %';
  box.append(el('div', { class: 'pe-target-val' }, [
    el('label', { for: id, class: 'pe-target-label' }, `Target figure (${unit})`),
    el('input', { class: 'input input-inline pe-target-input', id, type: 'number', inputmode: 'decimal', step: kind === 'yield' ? '0.1' : '50',
      value: t ? String(t.value) : '', placeholder: kind === 'yield' ? 'e.g. 4' : 'e.g. 0',
      onchange: (e) => {
        const raw = String(e.target.value).trim();
        answer(raw && !kind ? { targetKind: 'monthly', targetValue: raw } : { targetValue: raw === '' ? null : raw });
      } }),
  ]));
  return box;
}

/* --------------------------------------------------- on the calculator */
/* Where a figure of the subsale evidence came from: the evidence ladder
   (EVIDENCE), never the tool's own default — nothing here is seeded. */
const PC_SUB_EVIDENCE = () => EVIDENCE.filter(e => e.rank >= 0);
function pcEvidencePick(d, k, label) {
  const id = `ev-${k}`;
  const cur = d.evidence?.[k] || 'user';
  return el('div', { class: 'pc-sub-ev' }, [
    el('label', { for: id, class: 'metaline', title: `Where the ${label} came from` }, ptr('in.evidenceFrom', 'Where this figure came from')),
    el('select', { class: 'select select-sm', id, onchange: (e) => { d.evidence = { ...(d.evidence || {}), [k]: e.target.value }; saveDeal(); renderKeepFocus(); } },
      PC_SUB_EVIDENCE().map(ev => el('option', { value: ev.id, selected: ev.id === cur ? '' : null }, ptr(`ev.${ev.id}`, ev.label)))),
  ]);
}
/* An answer typed or chosen on the calculator: written, its evidence "You
   supplied" until the reader says otherwise, and the page drawn again. */
function pcSubAnswer(d, k, v) {
  if (!setDealAnswer(d, k, v)) return false;
  if (d[k] != null && !d.evidence?.[k]) d.evidence = { ...(d.evidence || {}), [k]: 'user' };
  saveDeal();
  return true;
}
function pcSubsaleInputs(d) {
  const box = el('div', { class: 'pc-subsale', id: 'subsale' });
  box.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 8px' }, 'Subsale evidence'));
  box.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' },
    'The purchase price above is the price you negotiated: every figure is worked from it. These set it against what was asked and what you have recorded — your own figures, never a market one.'));
  const field = (k, label, control, evLabel) => {
    const f = el('div', { class: 'assumption pc-sub-field' }, [el('label', { for: `d-${k}` }, ptr(`in.${k}`, label)), control]);
    if (d[k] != null) f.append(pcEvidencePick(d, k, evLabel));
    return f;
  };
  const num = (k, label, step, evLabel) => field(k, label, el('input', { class: 'input input-inline', id: `d-${k}`, type: 'number', min: '0', step,
    value: d[k] ?? '', placeholder: '—', style: 'text-align:right',
    onchange: (e) => { const raw = String(e.target.value).trim(); if (pcSubAnswer(d, k, raw === '' ? null : raw)) renderAfterTyping(); } }), evLabel);
  const pick = (k, label, reg, evLabel) => field(k, label, el('select', { class: 'select select-sm', id: `d-${k}`,
    onchange: (e) => { if (pcSubAnswer(d, k, e.target.value || null)) renderKeepFocus(); } },
    [el('option', { value: '', selected: d[k] == null ? '' : null }, 'Not recorded'),
     ...Object.values(reg).map(o => el('option', { value: o.id, selected: d[k] === o.id ? '' : null }, o.label))]), evLabel);
  box.append(num('askingPrice', 'Asking price (RM)', 1000, 'asking price'));
  box.append(pick('tenancy', 'Existing tenancy', SUBSALE_TENANCY, 'tenancy'));
  if (d.tenancy === 'tenanted') box.append(num('tenancyRent', 'Rent under the existing tenancy (RM a month)', 50, 'tenancy’s rent'));
  box.append(pick('condition', 'Condition', SUBSALE_CONDITION, 'condition'));
  box.append(num('buildingAge', 'Age of the building (years)', 1, 'age'));
  box.append(num('chargesToBuyer', 'Outstanding charges passed to you (RM)', 100, 'charges'));
  box.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
    'Arrears of maintenance, sinking fund, quit rent or assessment: only what your SPA or the management’s statement passes to you. It is added to the cash to complete.'));
  /* What the model already holds, said where the evidence is gathered. */
  const ttl = TITLE_TYPES.find(t => t.id === d.titleType);
  box.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `Already in the model: the market rent is the expected rent you enter in Rental & expenses (${fmtMoney(num0(d.rent), 'MYR', 0)} a month, ${evidenceOf(shownEvidence(d, 'rent')).label.toLowerCase()}); maintenance ${fmtMoney(num0(d.maintenance), 'MYR', 0)} and sinking fund ${fmtMoney(num0(d.sinkingFund), 'MYR', 0)} a month are there too; the title is ${ttl ? ttl.label : 'not recorded'}${d.titleType !== 'strata' ? `, ${num0(d.remainingLease) > 0 ? `${fmtNum(num0(d.remainingLease), 0)} years remaining` : 'freehold or not entered'}` : ''} (under Where, above), and the renovation is under Purchase.`));
  box.append(pcComparablesFieldset(d, 'Comparables this price is set against'));
  return box;
}
/* The comparables, from the reader's register, named one by one — for the
   subsale's price gap and the auction's market value alike. */
function pcComparablesFieldset(d, legend) {
  const choices = dealComparableChoices(d);
  const ids = new Set(Array.isArray(d.comparableIds) ? d.comparableIds : []);
  const town = (SARAWAK_CITIES.find(c => c.id === d.city) || {}).name || d.city;
  const fs = el('fieldset', { class: 'pc-sub-comps', id: 'pc-sub-comps' });
  fs.append(el('legend', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, legend));
  if (!choices.length) fs.append(el('p', { class: 'metaline' },
    `No ${PRICE_GAP_KINDS[propertyClassOf(d)] === 'land-sold' ? 'transacted land price' : 'transacted price'} is recorded in ${town} yet. Record one under “What you have recorded”, above, or in the comparables register.`));
  choices.forEach(o => {
    const id = `pc-comp-${slugParam(o.id)}`;
    const st = observationStanding(o);
    fs.append(el('label', { class: 'pc-sub-comp', style: 'gap:8px;display:flex;align-items:flex-start;margin-top:4px' }, [
      el('input', { type: 'checkbox', id, checked: ids.has(o.id) ? '' : null, onchange: (e) => {
        const next = new Set(Array.isArray(d.comparableIds) ? d.comparableIds : []);
        if (e.target.checked) next.add(o.id); else next.delete(o.id);
        if (setDealAnswer(d, 'comparableIds', [...next])) { saveDeal(); renderKeepFocus(); }
      } }),
      el('span', {}, `${comparableName(o)} — ${fmtMoney(o.value, 'MYR', 0)}${num0(o.sqft || o.landSqft) > 0 ? `, ${fmtNum(num0(o.sqft || o.landSqft), 0)} sq ft` : ''}, ${pqWhen(o.date)} · ${st.label}`),
    ]));
  });
  fs.append(el('p', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px' }, [
    el('a', { class: 'btn btn-ghost btn-sm', href: href('/property/comparables'), onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/comparables'); } },
      'Open the comparables register')]));
  return fs;
}
/* The two figures, on the calculator: the cards, the target, what the
   existing tenancy's rent would make of the month, and the working (L3). */
function pcPriceEvidence(d) {
  const g = priceGap(d), s = solveDealPrice(d);
  const sec = el('section', { class: 'card ls-section pc-pe', id: 'pc-pe', 'aria-labelledby': 'pc-pe-h' });
  sec.append(el('h3', { class: 'h-card', id: 'pc-pe-h' }, 'The price, against your evidence'));
  const coming = PROPERTY_ROUTES[dealRoute(d)].coming;
  if (coming) sec.append(el('p', { class: 'metaline pe-route' }, `${coming} ${feeRouteNote(dealRoute(d))}`));
  const det = (id, summary, text) => el('details', { class: 'pc-more ls-l3', id }, [el('summary', { class: 'pc-more-sum' }, summary), el('p', { class: 'pc-more-body lab-formula' }, text)]);
  const gapDet = det('pc-pe-gap-ev', 'How the price gap is worked out', priceGapFormula(g));
  const solveDet = det('pc-pe-solve-ev', 'How the price is solved', priceSolveFormula(s, d));
  sec.append(priceEvidenceCards({ d, g, s, prefix: 'pc', gapWhy: () => lsOpenEvidence(gapDet), solveWhy: () => lsOpenEvidence(solveDet),
    setTarget: () => { const r = document.getElementById('pc-q-target-monthly'); if (r) { r.closest('.pe-target')?.scrollIntoView({ block: 'center' }); r.focus({ preventScroll: true }); } } }));
  sec.append(priceTargetControls({ d, prefix: 'pc', answer: (k, v) => { if (pqWriter(k, v)(d)) { saveDeal(); renderKeepFocus(); } } }));
  if (s.status === 'solved' && Math.round(num0(d.price)) !== s.price) sec.append(el('p', { class: 'pe-try' }, el('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'pc-pe-use',
    onclick: () => { d.price = s.price; markTouched(d, 'price'); saveDeal(); renderKeepFocus(); toast(`The purchase price is now ${pqMoney(s.price)} — every figure follows it.`); } },
    `Model it at ${pqMoney(s.price)}`)));
  /* The month with the tenancy that is in place, beside the expected rent's. */
  if (d.tenancy === 'tenanted' && num0(d.tenancyRent) > 0 && PROPERTY_CLASSES[propertyClassOf(d)].letsToTenant) {
    const now = dealModel(d), t = dealModel({ ...d, rent: num0(d.tenancyRent) });
    if (isNum(t.cashflowMonthly)) sec.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      `With the existing tenancy’s ${pqMoney(num0(d.tenancyRent))} a month in place of the expected rent, the figures you entered give a monthly position of ${pqMoney(t.cashflowMonthly)}${isNum(now.cashflowMonthly) ? ` (at the expected rent: ${pqMoney(now.cashflowMonthly)})` : ''}.`));
  }
  sec.append(gapDet, solveDet);
  return sec;
}

/* ==========================================================================
   P3, THE AUCTION RISK MODE (the brief's "Auction: the auction risk mode";
   the model is auctionModel, 75-property-grade.js)
   --------------------------------------------------------------------------
   Inputs, each with where it came from and its kind badge (D6): the
   Proclamation's terms — the reserve price, the deposit and what it is a
   share of, the days to pay the balance, the arrears it passes to the
   buyer; the market value's comparables; and the reader's estimates —
   repairs, possession, the legal and search costs, a financing buffer and
   the holding period. The winning bid is the purchase price the model runs
   on (on the Lab, the Price slider).
   Outputs on the layout system: L1 the effective acquisition cost and the
   true discount (metric cards), L2 the waterfall and the forfeiture
   exposure, L3 how each is worked out and where the checklist comes from.
   THE GATE: until every check is ticked an alert card says "Not final: N
   checks open", and every auction figure says it is not final.
   Wording is the figures': "the figures you entered imply…", never a
   verdict on the deal or the route; nothing is ranked.
   ========================================================================== */
const auMoney = (v) => (isNum(v) ? fmtMoney(v, 'MYR', 0) : 'Unavailable');
const auPct = (v) => `${fmtNum(Math.abs(v), 1)}%`;
const auR4 = (v) => Math.round(v * 1e4) / 1e4;
const auList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const auKindOfInput = (d, k) => (d?.[k] == null ? 'unavailable' : KIND_OF_EVIDENCE[d.evidence?.[k] || 'user'] || 'yours');
const auBadge = (kind, fine = null) => kindBadge(kind, { fine: fine || (kind === 'unavailable' ? 'not entered' : null) });
const AUCTION_LEAD = 'Nothing of the sale is assumed: its terms are the ones you enter from the Proclamation of Sale. Not a valuation.';
const auLower = (s) => `${s.charAt(0).toLowerCase()}${s.slice(1)}`;
const auNotFinal = (a) => (a.final ? '' : ' Not final.');

/* THE INPUTS, in three groups. `answer(k, v)` writes one (the page's own
   writer); `evidence(k, label)` draws where a figure came from, where the
   page asks it (the calculator). */
const AU_GROUPS = () => [
  { id: 'terms', legend: 'From the Proclamation of Sale and its Conditions',
    note: 'Entered from the Proclamation and the Conditions of Sale — nothing here is assumed. Until the deposit, what it is a share of and the days are entered, the deposit, the balance and the forfeiture exposure read Unavailable.',
    fields: [['reservePrice', 'Reserve price (RM)', 1000], ['auctionDepositPct', 'Deposit (%)', 0.5], ['auctionDepositOf', 'The deposit is a share of', null],
      ['auctionBalanceDays', 'Days to pay the balance', 1],
      ['arrearsMaintenance', 'Arrears passed to you: maintenance and sinking fund (RM)', 100], ['arrearsQuitRent', 'Arrears passed to you: quit rent (RM)', 10],
      ['arrearsAssessment', 'Arrears passed to you: assessment (RM)', 10], ['arrearsUtilities', 'Arrears passed to you: utilities (RM)', 10]],
    after: 'Arrears: only what the Proclamation passes to you — 0 where it pays them out of the purchase money.' },
  { id: 'market', legend: 'The market value, from comparables',
    note: 'The median of the comparable prices you enter here and the comparables you name from your register — your own records, never a market figure. Not a valuation.',
    fields: [['auctionComp1', 'Comparable price 1 (RM)', 1000], ['auctionComp2', 'Comparable price 2 (RM)', 1000], ['auctionComp3', 'Comparable price 3 (RM)', 1000]] },
  { id: 'costs', legend: 'Your estimates',
    note: null,
    fields: [['auctionRepairs', 'Repairs (RM)', 500], ['possessionCost', 'Possession cost (RM)', 500], ['possessionMonths', 'Possession time (months)', 1],
      ['auctionLegal', 'Legal and search costs — your lawyer’s quote (RM)', 100], ['auctionBuffer', 'Financing buffer (RM)', 1000], ['auctionHoldMonths', 'Holding period (months)', 1]] },
];
function auctionInputs({ d, prefix, answer, evidence = null, extra = {} }) {
  const box = el('div', { class: 'au-inputs', id: `${prefix}-au-inputs` });
  const m = dealModel(d);
  for (const g of AU_GROUPS()) {
    const fs = el('fieldset', { class: `au-group au-group-${g.id}`, id: `${prefix}-au-${g.id}` });
    fs.append(el('legend', { class: 'au-legend' }, g.legend));
    const note = g.id === 'costs'
      ? `The winning bid you expect is the purchase price, ${auMoney(num0(d.price))} — every figure is worked from it. The holding period is the months from the sale until the property earns or is sold; each costs ${auMoney(m.burnWithoutRent)}, what it costs you a month with no rent coming in (the instalment and the running costs). The financing buffer is cash you hold back in case the loan is late or short when the balance falls due.`
      : g.note;
    if (note) fs.append(el('p', { class: 'au-note' }, note));
    const grid = el('div', { class: 'au-grid' });
    for (const [k, label, step] of g.fields) {
      const id = `${prefix}-au-${k}`;
      const kind = auKindOfInput(d, k);
      /* What the deposit is a share of: two chips, as the questions are —
         neither chosen until the reader chooses (pqGroup's ids:
         `${prefix}-q-au-depositOf-reserve`). */
      const control = step == null
        ? pqGroup(prefix, 'au-depositOf', label, Object.values(AUCTION_DEPOSIT_OF).map(o => [o.id, o.label]), d[k] ?? null, (v) => answer(k, v))
        : el('input', { class: 'input au-in num', id, type: 'number', min: '0', step: String(step), inputmode: 'decimal',
            value: d[k] ?? '', placeholder: 'Not entered',
            onchange: (e) => { const raw = String(e.target.value).trim(); answer(k, raw === '' ? null : raw); } });
      if (step == null) control.classList.add('au-pick');
      const f = el('div', { class: 'au-field', 'data-au': k, 'data-kind': kind }, [
        step == null ? null : el('label', { for: id, class: 'au-label' }, label),
        control,
        el('p', { class: 'au-kind' }, [auBadge(kind), evidence && d[k] != null ? evidence(k, label.toLowerCase()) : null]),
      ]);
      grid.append(f);
    }
    fs.append(grid);
    if (g.after) fs.append(el('p', { class: 'au-note' }, g.after));
    if (extra[g.id]) fs.append(extra[g.id]);
    box.append(fs);
  }
  return box;
}

/* THE CHECKLIST: six checks from the Malaysian Bar's guidance, each ticked
   by the reader once found out. Written as an answer (auctionChecks). */
function auctionChecklist({ d, prefix, answer }) {
  const ticked = new Set(Array.isArray(d.auctionChecks) ? d.auctionChecks : []);
  const fs = el('fieldset', { class: 'au-checks', id: `${prefix}-au-checks`, tabindex: '-1' });
  fs.append(el('legend', { class: 'au-legend' }, `Before any auction figure is final — ${AUCTION_CHECK_IDS.length - AUCTION_CHECK_IDS.filter(id => ticked.has(id)).length} of ${AUCTION_CHECK_IDS.length} open`));
  fs.append(el('p', { class: 'au-note' }, 'Drawn from the guidance the Malaysian Bar publishes on buying at an auction — guidance, not this tool’s rules, and not legal advice. Tick each once you have found it out; where the guidance comes from is under the evidence.'));
  const list = el('ul', { class: 'au-check-list' });
  for (const id of AUCTION_CHECK_IDS) {
    const c = AUCTION_CHECKS[id], cid = `${prefix}-au-ck-${id}`;
    list.append(el('li', { class: 'au-check', 'data-check': id }, el('label', { class: 'au-check-row', for: cid }, [
      el('input', { type: 'checkbox', id: cid, checked: ticked.has(id) ? '' : null, onchange: (e) => {
        const next = AUCTION_CHECK_IDS.filter(x => (x === id ? e.target.checked : ticked.has(x)));
        answer('auctionChecks', next.length ? next : null);
      } }),
      el('span', { class: 'au-check-body' }, [el('strong', {}, c.label), el('span', { class: 'au-check-what' }, c.what)]),
    ])));
  }
  fs.append(list);
  return fs;
}

/* THE WATERFALL (L2): from the market value down to the reserve and the
   bid, then up by what the auction adds, to the effective cost. A row a
   step: its name, its kind, its amount, and a bar on one scale — totals
   from nought, additions floating from the running total — with the market
   value marked on every bar, so how far each stands from it is a length.
   Positions are percentages of the widest figure, rounded to 1/10000 of a
   per cent so every browser draws them alike (0c4ba54b). Each row's words
   are its figures, so no value waits behind a pointer. */
function auctionWaterfall(a, prefix) {
  const fig = el('figure', { class: 'au-wf', id: `${prefix}-au-wf`, 'aria-labelledby': `${prefix}-au-wf-h` });
  fig.append(el('figcaption', { class: 'au-wf-h', id: `${prefix}-au-wf-h` }, 'From the market value to the effective acquisition cost'));
  const top = Math.max(...a.steps.map(s => s.amount).filter(isNum), 1);
  const X = (v) => auR4(Math.max(0, Math.min(100, v / top * 100)));
  const list = el('ol', { class: 'au-wf-rows' });
  let run = a.bid;
  for (const s of a.steps) {
    const add = !s.total;
    const has = isNum(s.amount);
    const from = add ? (isNum(run) ? run : 0) : 0;
    const to = has ? (add ? from + s.amount : s.amount) : null;
    if (add && has && isNum(run)) run = to;
    const word = !has ? 'Not entered' : add ? `+${auMoney(s.amount)}` : auMoney(s.amount);
    const why = !has ? (s.id === 'market' ? 'No comparable entered or named' : s.id === 'bid' ? 'No purchase price' : s.id === 'transaction' ? 'No line priced' : s.id === 'holding' ? (s.months == null ? null : 'The monthly cost is not computable') : null) : null;
    const svg = sv('svg', { class: 'au-wf-bar', width: '100%', height: '14', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(sv('rect', { class: 'au-wf-track', x: '0', y: '2', width: '100%', height: '10', rx: '3' }));
    if (has && isNum(from)) {
      const x0 = X(from), x1 = X(to);
      const r = sv('rect', { class: `au-wf-mark ${add ? 'is-add' : s.id === 'effective' ? 'is-end' : 'is-total'}`, x: `${x0}%`, y: '2', width: `${auR4(Math.max(0.4, x1 - x0))}%`, height: '10', rx: '3' });
      r.append(sv('title', {}, `${s.label}: ${word}`));
      svg.append(r);
    }
    if (isNum(a.market) && s.id !== 'market') svg.append(sv('line', { class: 'au-wf-mv', x1: `${X(a.market)}%`, x2: `${X(a.market)}%`, y1: '0', y2: '14' }));
    const label = add ? `+ ${s.label}` : s.label;
    const sub = s.id === 'market' && has ? `the median of ${a.marketFrom.named.length + a.marketFrom.typed.length} comparable${a.marketFrom.named.length + a.marketFrom.typed.length === 1 ? '' : 's'}`
      : s.id === 'holding' && has ? `${fmtNum(s.months, s.months % 1 ? 1 : 0)} month${s.months === 1 ? '' : 's'} × ${auMoney(s.monthly)}`
      : s.id === 'transaction' && has && s.unpriced ? `${s.unpriced} line${s.unpriced === 1 ? '' : 's'} not priced`
      : s.id === 'arrears' && has && s.partsMissing.length ? `${s.partsMissing.length} of 4 not entered`
      : s.id === 'possession' && has && isNum(s.months) ? `${fmtNum(s.months, s.months % 1 ? 1 : 0)} month${s.months === 1 ? '' : 's'}` : why;
    list.append(el('li', { class: `au-wf-row${add ? ' is-add' : ' is-total'}${has ? '' : ' is-na'}${s.id === 'effective' ? ' is-end' : ''}`, 'data-step': s.id, 'data-value': has ? String(s.amount) : '' }, [
      el('p', { class: 'au-wf-hd' }, [el('span', { class: 'au-wf-label' }, label), ' ', auBadge(s.kind), el('span', { class: 'au-wf-amt num' }, word)]),
      svg,
      sub ? el('p', { class: 'au-wf-sub' }, sub) : null,
    ]));
  }
  fig.append(list);
  if (isNum(a.market)) fig.append(el('p', { class: 'au-wf-key' }, [el('span', { class: 'au-wf-key-mv', 'aria-hidden': 'true' }), `The upright line on each bar is the market value your comparables imply, ${auMoney(a.market)}.`]));
  return fig;
}

/* THE FIGURES: L1, L2 and the gate. `why` holds what "See why →" opens. */
function auctionResults({ a, prefix, why = {}, toChecklist = null }) {
  const box = el('div', { class: 'au-results', id: `${prefix}-au-results`, 'data-final': a.final ? 'true' : 'false' });
  /* The gate first: no auction figure is final while a check is open. */
  if (!a.final) box.append(lsAlertCard({ text: `Not final: ${a.checksOpen.length} check${a.checksOpen.length === 1 ? '' : 's'} open`,
    sub: `Open: ${auList(a.checksOpen.map(id => auLower(AUCTION_CHECKS[id].label)))} — from the Malaysian Bar’s guidance on buying at an auction.`,
    cta: lsCta('Review', { id: `${prefix}-au-review`, onclick: toChecklist, sr: ' the checks still open' }), cls: 'au-alert', attrs: { id: `${prefix}-au-alert` } }));
  const cards = el('div', { class: 'au-cards' });
  const notIn = a.notEntered.length ? ` Not entered, so not counted: ${auList(a.notEntered.map(x => x.toLowerCase()))}.` : '';
  cards.append(lsMetricCard({ label: 'Effective acquisition cost', value: auMoney(a.effective), badge: auBadge(a.effectiveKind), level: 1, cls: 'au-card au-effective',
    attrs: { 'data-au-fig': 'effective', 'data-final': a.final ? 'true' : 'false' }, valueAttrs: { 'data-value': isNum(a.effective) ? String(a.effective) : '' },
    sub: isNum(a.effective) ? `The winning bid of ${auMoney(a.bid)} and ${auMoney(a.effective - a.bid)} the auction adds.${notIn}${auNotFinal(a)}` : 'Needs a purchase price — the winning bid you expect.' }));
  const td = a.trueDiscount;
  const tdKind = td ? kindFirst([a.marketKind, a.effectiveKind]) || 'derived' : 'unavailable';
  cards.append(lsMetricCard({ label: 'True discount', badge: auBadge(tdKind, td ? null : 'no comparable entered'), level: 1, cls: 'au-card au-discount',
    value: td ? `${td.amount < 0 ? '−' : ''}${auPct(td.pct)}` : 'Unavailable',
    attrs: { 'data-au-fig': 'discount', 'data-final': a.final ? 'true' : 'false' }, valueAttrs: { 'data-value': td ? String(td.pct) : '' },
    sub: td ? `${td.amount >= 0
        ? `The figures you entered imply an effective cost ${auMoney(td.amount)} under the ${auMoney(a.market)} market value your comparables imply`
        : `The figures you entered imply an effective cost ${auMoney(-td.amount)} over the ${auMoney(a.market)} market value your comparables imply — no discount once the costs are in`}${a.bidDiscount ? `; the bid alone stands ${auPct(a.bidDiscount.pct)} ${a.bidDiscount.amount >= 0 ? 'under' : 'over'} it` : ''}.${auNotFinal(a)}`
      : 'Enter comparable prices, or name comparables from your register: the market value is theirs, never a market figure.' }));
  const f = a.forfeiture;
  cards.append(lsMetricCard({ label: 'Forfeiture exposure', badge: auBadge(f.status === 'ok' ? 'yours' : 'unavailable', f.status === 'ok' ? 'the Proclamation’s terms you entered' : 'terms not entered'), level: 2, cls: 'au-card au-forfeit',
    value: f.status === 'ok' ? auMoney(f.atRisk) : 'Unavailable',
    attrs: { 'data-au-fig': 'forfeiture', 'data-status': f.status }, valueAttrs: { 'data-value': f.status === 'ok' ? String(f.atRisk) : '' },
    sub: f.status === 'ok'
      ? `The deposit — ${fmtNum(f.depositPct, f.depositPct % 1 ? 2 : 0)}% ${f.depositOf === 'reserve' ? 'of the reserve price' : 'of the winning bid'} — at risk if the balance of ${auMoney(f.balance)} is not paid within ${f.days} day${f.days === 1 ? '' : 's'}${isNum(f.cashForBalance) ? `; ${auMoney(f.cashForBalance)} of it is cash beyond the loan${isNum(f.buffer) ? `, against your buffer of ${auMoney(f.buffer)}` : ''}` : ''}.${auNotFinal(a)}`
      : `Enter ${auList(f.missing)} from the Proclamation — never assumed.` }));
  box.append(cards);
  box.append(auctionWaterfall(a, prefix));
  const links = [why.wf ? lsCta('How the waterfall is worked out', { id: `${prefix}-au-wf-why`, onclick: why.wf }) : null,
    why.fx ? lsCta('How the forfeiture exposure is worked out', { id: `${prefix}-au-fx-why`, onclick: why.fx }) : null].filter(Boolean);
  if (links.length) box.append(el('p', { class: 'au-why' }, links));
  return box;
}

/* L3: the working, in words. */
function auctionWaterfallFormula(a) {
  const named = a.marketFrom.named.map(c => `${c.name} ${auMoney(c.implied)}${c.basis === 'rate' ? ' (by its rate a sq ft)' : ''}`);
  const typed = a.marketFrom.typed.map((c, i) => `your comparable price ${i + 1}, ${auMoney(c.price)}`);
  const mv = isNum(a.market) ? `Market value: the median of ${auList([...named, ...typed])} = ${auMoney(a.market)}.` : 'Market value: none — no comparable is entered or named, so the true discount is Unavailable.';
  const t = a.adds.find(x => x.id === 'transaction');
  const tl = t.lines.map(l => `${l.label.charAt(0).toLowerCase()}${l.label.slice(1)} ${isNum(l.amount) ? auMoney(l.amount) : 'not priced'}`);
  const hold = a.adds.find(x => x.id === 'holding');
  const sum = a.adds.filter(x => isNum(x.amount)).map(x => `${x.label.toLowerCase()} ${auMoney(x.amount)}`);
  return `${mv} Reserve price: ${isNum(a.reserve) ? auMoney(a.reserve) : 'not entered'}. Winning bid: the purchase price, ${auMoney(a.bid)}. `
    + `Transaction costs: the ledger’s own fee lines — ${auList(tl)}. `
    + `Holding: ${hold.months == null ? 'no holding period entered' : `${fmtNum(hold.months, 1)} months × ${auMoney(hold.monthly)} a month with no rent (the instalment and the running costs)`}. `
    + `Effective acquisition cost = the bid${sum.length ? ` + ${sum.join(' + ')}` : ''} = ${auMoney(a.effective)}${a.notEntered.length ? `; not entered and not counted: ${auList(a.notEntered.map(x => x.toLowerCase()))}` : ''}. `
    + (a.trueDiscount ? `True discount = (market value − effective cost) ÷ market value = (${auMoney(a.market)} − ${auMoney(a.effective)}) ÷ ${auMoney(a.market)} = ${a.trueDiscount.amount < 0 ? '−' : ''}${auPct(a.trueDiscount.pct)}. ` : '')
    + `${auctionFeeNote()} Every figure is yours or the fee rulebook’s, as each badge says. Not a valuation.`;
}
function auctionForfeitureFormula(a) {
  const f = a.forfeiture;
  if (f.status !== 'ok') return `Unavailable until you enter ${auList(f.missing)} from the Proclamation of Sale and its Conditions. Nothing is assumed: the Malaysian Bar’s guidance says the balance is usually due within 90 or 120 days, and that some Proclamations allow an extension and some do not — the terms of your sale are the ones that count.`;
  const base = f.depositOf === 'reserve' ? `the reserve price, ${auMoney(a.reserve)}` : `the winning bid, ${auMoney(a.bid)}`;
  return `Deposit = ${fmtNum(f.depositPct, 2)}% of ${base} = ${auMoney(f.deposit)}. Balance = the bid ${auMoney(a.bid)} − the deposit = ${auMoney(f.balance)}, due within ${f.days} days. `
    + `${isNum(f.loan) ? `The loan in this model is ${auMoney(f.loan)}, so ${auMoney(f.cashForBalance)} of the balance is cash${isNum(f.buffer) ? `; your financing buffer of ${auMoney(f.buffer)} ${f.bufferShort > 0 ? `leaves ${auMoney(f.bufferShort)} uncovered` : 'covers it'}` : ''}. ` : ''}`
    + 'The exposure is the deposit: the Malaysian Bar’s guidance records buyers who bid without arranging their loan first “ended up losing their deposits”. Whether yours is forfeited, and any extension, is for the Conditions of Sale — read them with your lawyer.';
}
function auctionGuidanceList() {
  return el('div', {}, [
    el('p', { class: 'lab-formula' }, 'The checklist is drawn from the guidance the Malaysian Bar publishes on buying property at an auction, as written in these articles. It is guidance, cited as such: this tool makes no rule of it, and none of it is legal advice.'),
    el('ul', { class: 'au-src' }, Object.values(AUCTION_GUIDANCE).map(s => el('li', {}, el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.title)))),
  ]);
}

/* --------------------------------------------------- on the calculator */
function pcAuctionInputs(d) {
  const box = el('div', { class: 'pc-auction', id: 'auction' });
  box.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 8px' }, 'The auction'));
  box.append(auctionInputs({ d, prefix: 'pc',
    answer: (k, v) => { if (pcSubAnswer(d, k, v)) renderKeepFocus(); },
    evidence: (k, label) => pcEvidencePick(d, k, label),
    extra: { market: pcComparablesFieldset(d, 'Comparables named from your register') } }));
  return box;
}
function pcAuction(d) {
  const a = auctionModel(d);
  const sec = el('section', { class: 'card ls-section au', id: 'pc-au', 'aria-labelledby': 'pc-au-h' });
  sec.append(el('h3', { class: 'h-card', id: 'pc-au-h' }, 'The auction, worked through'));
  sec.append(el('p', { class: 'metaline au-route' }, AUCTION_LEAD));
  const det = (id, summary, body) => el('details', { class: 'pc-more ls-l3', id }, [el('summary', { class: 'pc-more-sum' }, summary), typeof body === 'string' ? el('p', { class: 'pc-more-body lab-formula' }, body) : body]);
  const wfDet = det('pc-au-wf-ev', 'How the waterfall is worked out', auctionWaterfallFormula(a));
  const fxDet = det('pc-au-fx-ev', 'How the forfeiture exposure is worked out', auctionForfeitureFormula(a));
  const srcDet = det('pc-au-src-ev', 'Where the checklist comes from', auctionGuidanceList());
  sec.append(auctionResults({ a, prefix: 'pc', why: { wf: () => lsOpenEvidence(wfDet), fx: () => lsOpenEvidence(fxDet) },
    toChecklist: () => lsGoTo(document.getElementById('pc-au-checks'), document.querySelector('#pc-au-checks input:not(:checked)')) }));
  sec.append(auctionChecklist({ d, prefix: 'pc', answer: (k, v) => { if (setDealAnswer(d, k, v)) { saveDeal(); renderKeepFocus(); } } }));
  sec.append(wfDet, fxDet, srcDet);
  return sec;
}
