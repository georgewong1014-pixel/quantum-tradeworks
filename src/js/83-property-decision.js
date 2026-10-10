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
    'Auction: the price is the winning bid you expect, and no auction figure is final until its checklist is ticked.'));
  /* The developer premium model (P4): where its figures come from. */
  if (route === 'newdev') notes.push(el('p', { class: 'pq-note pq-note-route', 'data-note': 'route' },
    'New development: the price is the SPA price, set against a completed comparable you enter; nothing of the developer’s schedule is assumed.'));
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
/* A comparable as it is named wherever it is used: what and where, its
   amount, its date and its source, and its standing — the source and the
   date travel with it (the owner's decision of 9 Oct 2026). */
const pqCompWords = (c) => `${c.name} — ${pqMoney(c.price)}, ${pqWhen(c.date)}, source: ${c.source || 'no source recorded'}, ${c.standing.label.toLowerCase()}`;
const pqAskingWords = (g) => (g.askingComps?.length
  ? `Asking prices you named, set apart and never in that value: ${g.askingComps.length === 1 ? pqMoney(g.askingValue) : `a median of ${pqMoney(g.askingValue)} over ${g.askingComps.length}`} — ${g.askingComps.map(pqCompWords).join('; ')}.`
  : '');

/* The gap, in words: the asking price against the comparable value. */
function priceGapWords(g) {
  const n = g.comps.length, named = `the ${n === 1 ? 'comparable' : `${n} comparables`} you named`;
  const ag = g.askingGap;
  const finding = !ag ? null : Math.abs(ag.amount) < 0.5
    ? `The asking price of ${pqMoney(g.asking)} is the ${pqMoney(g.value)} ${named} ${n === 1 ? 'implies' : 'imply'}.`
    : `The asking price of ${pqMoney(g.asking)} is ${pqMoney(Math.abs(ag.amount))} (${pqPctAbs(ag.pct)}) ${ag.amount > 0 ? 'above' : 'below'} the ${pqMoney(g.value)} ${named} ${n === 1 ? 'implies' : 'imply'}.`;
  const pg = g.priceGap;
  const price = !pg ? null : Math.abs(pg.amount) < 0.5 ? `The price modelled, ${pqMoney(g.price)}, is that value.`
    : `The price modelled, ${pqMoney(g.price)}, is ${pqMoney(Math.abs(pg.amount))} (${pqPctAbs(pg.pct)}) ${pg.amount > 0 ? 'above' : 'below'} it.`;
  return { finding, price, figure: ag ? `${pqSigned(ag.amount)} · ${ag.amount < 0 ? '−' : '+'}${pqPctAbs(ag.pct)}` : null };
}
/* How the gap is worked out (L3): each named comparable, what it implies
   and why, and the median. */
function priceGapFormula(g) {
  if (!g.comps.length) return 'No comparable is named for this property. Name transacted prices from your register — your own records, never a market figure — and the value they imply is their median.'
    + (g.askingComps?.length ? ` ${pqAskingWords(g)}` : '');
  const area = g.areaKey === 'landSqft' ? 'land area' : 'built-up area';
  const each = g.comps.map(c => (c.basis === 'rate'
    ? `${c.name}: ${pqMoney(c.price)} ÷ ${fmtNum(c.area, 0)} sq ft = ${pqMoney(c.rate)} a sq ft × this property’s ${fmtNum(g.subjectArea, 0)} sq ft = ${pqMoney(c.implied)}`
    : `${c.name}: ${pqMoney(c.price)} as recorded (${g.subjectArea ? `no ${area} recorded with it` : `no ${area} entered for this property`})`)
    + ` — ${pqWhen(c.date)}, source: ${c.source}`);
  return `${each.join('; ')}. The comparable value is the median of ${g.comps.length === 1 ? 'that one figure' : `these ${g.comps.length}`}: ${pqMoney(g.value)}.`
    + (g.asking ? ` Asking ${pqMoney(g.asking)} − ${pqMoney(g.value)} = ${pqSigned(g.askingGap.amount)}.` : ' No asking price is entered.')
    + (g.askingComps?.length ? ` ${pqAskingWords(g)}` : '')
    + (g.notUsed ? ` ${g.notUsed} named record${g.notUsed === 1 ? ' is' : 's are'} not used: no longer in the register, or not a price of this kind of property.` : '')
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
      sub: el('p', { class: 'ls-card-sub' }, [w.price ? `${w.price} ` : '', `Named: ${g.comps.map(pqCompWords).join('; ')}.`, g.askingComps?.length ? ` ${pqAskingWords(g)}` : '']),
      cta: lsCta('See why', { id: `${prefix}-pe-gap-why`, onclick: gapWhy, sr: ' the price gap is what it is' }) }));
  } else {
    const missing = g.status === 'no-comparables'
      ? (g.asking ? 'Needs comparables named from your register.' : 'Needs the asking price and comparables from your register.')
      : `Enter the asking price to set it against the ${pqMoney(g.value)} your ${g.comps.length === 1 ? 'comparable implies' : `${g.comps.length} comparables imply`}.`;
    cards.append(lsActionCard({ title: 'Price gap', line: missing, cls: 'pe-card pe-gap', attrs: { 'data-pe': 'gap', 'data-value': '' },
      cta: enter ? lsCta('Enter them in the calculator', { path: enter, id: `${prefix}-pe-gap-go` })
        : lsCta('Enter them', { id: `${prefix}-pe-gap-go`, onclick: () => { const n = document.getElementById('d-askingPrice'); if (n) { n.scrollIntoView({ block: 'center' }); n.focus({ preventScroll: true }); } } }) }));
  }
  /* The price that makes this work. */
  if (s.status === 'no-target') {
    /* One line (the 9 Oct audit, #5); how it is solved is "How the price is
       solved", in the evidence. */
    cards.append(lsActionCard({ title: 'The price that makes this work', line: 'The highest price that meets a target you set.',
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
  /* A commercial unit's tenancy is asked once, with the four rents, under
     Rental (P5): its contract rent is one of them. */
  if (propertyClassOf(d) === 'commercial') box.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' }, 'The tenancy and its contract rent are under Rental, with the four rents.'));
  else {
    box.append(pick('tenancy', 'Existing tenancy', SUBSALE_TENANCY, 'tenancy'));
    if (d.tenancy === 'tenanted') box.append(num('tenancyRent', 'Rent under the existing tenancy (RM a month)', 50, 'tenancy’s rent'));
  }
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
  return comparablesPick({ d, prefix: 'pc', legend, cls: 'pc-sub-comps',
    toggle: (ids) => { if (setDealAnswer(d, 'comparableIds', ids)) { saveDeal(); renderKeepFocus(); } } });
}
/* THE COMPARABLES PICK — the calculator's and the Lab's (the guided evidence
   flow, the owner's decision of 9 Oct 2026). The reader's own records of
   this town, each named with its amount, its date, its source and its
   standing, and the Yours badge: the transacted prices, which make the
   comparable value, and apart from them the asking prices, which never
   enter it. `toggle(ids)` writes the list named — on the calculator to the
   deal, on the Lab as an answer of every column (a what-if until Save). */
function comparablesPick({ d, prefix, legend, toggle, cls = '' }) {
  const choices = dealComparableChoices(d), asks = dealAskingChoices(d);
  const ids = new Set(Array.isArray(d.comparableIds) ? d.comparableIds : []);
  const town = (SARAWAK_CITIES.find(c => c.id === d.city) || {}).name || d.city;
  const land = PRICE_GAP_KINDS[propertyClassOf(d)] === 'land-sold';
  const fs = el('fieldset', { class: `comp-pick ${cls}`.trim(), id: `${prefix}-sub-comps` });
  fs.append(el('legend', { class: 'eyebrow comp-pick-legend' }, legend));
  const row = (o) => {
    const id = `${prefix}-comp-${slugParam(o.id)}`;
    const st = observationStanding(o);
    return el('label', { class: 'comp-pick-row', for: id, 'data-comp': o.id }, [
      el('input', { type: 'checkbox', id, checked: ids.has(o.id) ? '' : null, onchange: (e) => {
        const next = new Set(Array.isArray(d.comparableIds) ? d.comparableIds : []);
        if (e.target.checked) next.add(o.id); else next.delete(o.id);
        toggle([...next]);
      } }),
      el('span', { class: 'comp-pick-words' }, [
        `${comparableName(o)} — ${fmtMoney(o.value, 'MYR', 0)}${num0(o.sqft || o.landSqft) > 0 ? `, ${fmtNum(num0(o.sqft || o.landSqft), 0)} sq ft` : ''}, ${pqWhen(o.date)}`,
        ' ', kindBadge('yours', { fine: 'your own record', link: false }),
        el('span', { class: 'comp-pick-src' }, `Source: ${comparableSource(o)} · ${st.label}`)]),
    ]);
  };
  if (!choices.length) fs.append(el('p', { class: 'metaline' },
    `No ${land ? 'transacted land price' : 'transacted price'} is recorded in ${town} yet.`));
  choices.forEach(o => fs.append(row(o)));
  if (asks.length) {
    fs.append(el('p', { class: 'metaline comp-pick-apart' }, `Asking prices — shown apart, with their own median: an asking price is somebody’s hope, and is never in the value the transacted prices imply.`));
    asks.forEach(o => fs.append(row(o)));
  }
  fs.append(el('p', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px' }, [
    el('a', { class: 'btn btn-ghost btn-sm', href: href('/property/comparables'), id: `${prefix}-comp-register`, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/comparables'); } },
      choices.length || asks.length ? 'Open the comparables register' : 'Record one in the comparables register')]));
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
const AU_HOW_OPEN = new Set();
function auctionInputs({ d, prefix, answer, evidence = null, extra = {} }) {
  const box = el('div', { class: 'au-inputs', id: `${prefix}-au-inputs` });
  const m = dealModel(d);
  for (const g of AU_GROUPS()) {
    const fs = el('fieldset', { class: `au-group au-group-${g.id}`, id: `${prefix}-au-${g.id}` });
    fs.append(el('legend', { class: 'au-legend' }, g.legend));
    const note = g.id === 'costs'
      ? `The winning bid you expect is the purchase price, ${auMoney(num0(d.price))} — every figure is worked from it. The holding period is the months from the sale until the property earns or is sold; each costs ${auMoney(m.burnWithoutRent)}, what it costs you a month with no rent coming in (the instalment and the running costs). The financing buffer is cash you hold back in case the loan is late or short when the balance falls due.`
      : g.note;
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
    /* WHAT A GROUP'S FIGURES MEAN AND HOW THEY ARE USED, one tap away (L3;
       the 9 Oct audit, #5: the Lab "repeatedly explains"). In sight stay the
       section's lead — nothing of the sale assumed, not a valuation — and
       each figure's badge, which says Unavailable until it is entered. */
    const how = [note, g.after].filter(Boolean);
    if (how.length) {
      /* Kept open for the tab across the drawings an answer makes. */
      const hid = `${prefix}-au-${g.id}-how`;
      const det = el('details', { class: 'pc-more ls-l3 au-more', id: hid, open: AU_HOW_OPEN.has(hid) ? '' : null }, [
        el('summary', { class: 'pc-more-sum' }, g.id === 'costs' ? 'What these estimates are' : g.id === 'market' ? 'How the market value is found' : 'How these terms are used'),
        ...how.map(t => el('p', { class: 'pc-more-body au-note' }, t))]);
      det.addEventListener('toggle', () => { if (det.open) AU_HOW_OPEN.add(hid); else AU_HOW_OPEN.delete(hid); });
      fs.append(det);
    }
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
  /* One line: whose guidance, and that it is not legal advice. Where it
     comes from is under the evidence. */
  fs.append(el('p', { class: 'au-note' }, 'From the Malaysian Bar’s guidance — not this tool’s rules, and not legal advice. Tick each once found out.'));
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
        : `The figures you entered imply an effective cost ${auMoney(-td.amount)} over the ${auMoney(a.market)} market value your comparables imply — no discount once the costs are in`}${a.bidDiscount ? `; the bid alone stands ${auPct(a.bidDiscount.pct)} ${a.bidDiscount.amount >= 0 ? 'under' : 'over'} it` : ''}.${a.marketFrom.named.length ? ` Named from your register: ${a.marketFrom.named.map(pqCompWords).join('; ')}.` : ''}${auNotFinal(a)}`
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
  const named = a.marketFrom.named.map(c => `${c.name} ${auMoney(c.implied)}${c.basis === 'rate' ? ' (by its rate a sq ft)' : ''} (${pqWhen(c.date)}, source: ${c.source})`);
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

/* ==========================================================================
   P4, NEW DEVELOPMENT: THE DEVELOPER PREMIUM MODEL (the brief's "New
   development: the developer premium model"; the model is newDevModel,
   75-property-grade.js; the sources NEWDEV_SOURCE, NEWDEV_DLP and
   NEWDEV_TEMPLATES, 70-property.js)
   --------------------------------------------------------------------------
   Inputs, each with its kind badge (D6): the SPA price (the purchase price;
   on the Lab, the Price slider); a completed comparable typed with its
   source and date, or named from the register; the SPA month and the month
   of vacant possession; the reader's schedule of progressive drawdown —
   Sarawak's prescribed stage percentages offered only as a labelled, cited
   template the reader applies, and its months theirs to enter (or to space
   evenly, by a press of theirs, said so); the developer's rebates and
   incentives; and, from the rest of the model, the rent at completion and
   the occupancy (the reader's assumptions, badged so) and the furnishing.
   Outputs on the layout system: L1 the developer premium and the cash
   required (metric cards); L2 the interest during construction, the
   monthly position from VP, the exit values at VP+3, VP+5 and VP+10
   (Modelled — never a forecast) and what would justify the premium; L3 how
   each is worked out, and where the template and the defect liability
   period come from. Defect liability is stated as a feature of the route,
   never a figure. Wording is the figures': "the figures you entered
   imply…"; nothing is ranked.
   ========================================================================== */
const ndSign = (v) => (v < 0 ? '−' : '+');
const ndPctWords = (v) => `${ndSign(v)}${fmtNum(Math.abs(v), 1)}%`;
const ND_LEAD = 'Nothing of the developer’s terms is assumed: the comparable, the dates and the schedule are the ones you enter. Not a valuation.';
/* A typed comparable, named as the register's are: its amount, its date
   and its source — "not entered" where the reader has not given them. */
const ndTypedWords = (t) => `your completed comparable — ${pqMoney(t.price)}, ${t.date ? pqWhen(t.date) : 'date not entered'}, source: ${t.source || 'not entered'}`;
const ndCompList = (n) => [...n.compFrom.named.map(pqCompWords), ...(n.compFrom.typed ? [ndTypedWords(n.compFrom.typed)] : [])];
/* The months of a schedule, spread evenly from signing (month 0) to VP —
   the reader's press, never a default. */
const ndEvenMonths = (count, vp) => Array.from({ length: count }, (_, i) => (count < 2 ? 0 : Math.round(i * vp / (count - 1))));

/* THE INPUTS. `answer(k, v)` writes one (the page's own writer);
   `evidence(k, label)` draws where a figure came from, where the page asks
   it (the calculator); `extra.comp` is the register's pick; `where` says
   where the figures this route reads from the rest of the model are set. */
const ND_TPL_PICK = {};
function ndInputs({ d, prefix, answer, evidence = null, extra = {}, where = {} }) {
  const box = el('div', { class: 'au-inputs nd-inputs', id: `${prefix}-nd-inputs` });
  const field = (k, label, control, kind = auKindOfInput(d, k), fine = null) => el('div', { class: 'au-field', 'data-nd': k, 'data-kind': kind }, [
    el('label', { for: `${prefix}-nd-${k}`, class: 'au-label' }, label), control,
    el('p', { class: 'au-kind' }, [auBadge(kind, fine), evidence && d[k] != null ? evidence(k, label.toLowerCase()) : null])]);
  const input = (k, attrs) => el('input', { class: 'input au-in', id: `${prefix}-nd-${k}`, value: d[k] ?? '', placeholder: 'Not entered',
    onchange: (e) => { const raw = String(e.target.value).trim(); answer(k, raw === '' ? null : raw); }, ...attrs });
  const group = (id, legend, kids) => {
    const fs = el('fieldset', { class: `au-group nd-group nd-group-${id}`, id: `${prefix}-nd-${id}` });
    fs.append(el('legend', { class: 'au-legend' }, legend));
    fs.append(...kids.filter(Boolean));
    return fs;
  };
  /* The completed comparable. */
  box.append(group('comp', 'A completed comparable', [
    el('div', { class: 'au-grid' }, [
      field('ndCompPrice', 'Completed comparable price (RM)', input('ndCompPrice', { type: 'number', min: '0', step: '1000', inputmode: 'decimal', class: 'input au-in num' })),
      field('ndCompSource', 'Where it came from', input('ndCompSource', { type: 'text', maxlength: '120', autocomplete: 'off', placeholder: 'A document, or a page’s address' })),
      field('ndCompDate', 'Its date', input('ndCompDate', { type: 'date' })),
    ]),
    extra.comp || null,
  ]));
  /* The dates. */
  box.append(group('dates', 'Signing and completion', [el('div', { class: 'au-grid' }, [
    field('ndSpaMonth', 'SPA signed (month)', input('ndSpaMonth', { type: 'month', placeholder: 'YYYY-MM' })),
    field('ndVpMonth', 'Vacant possession expected (month)', input('ndVpMonth', { type: 'month', placeholder: 'YYYY-MM' })),
  ])]));
  /* The schedule of progressive drawdown. */
  box.append(ndScheduleEditor({ d, prefix, answer }));
  /* What the developer gives back. */
  box.append(group('developer', 'From the developer', [el('div', { class: 'au-grid' }, [
    field('ndRebates', 'Rebates and incentives (RM)', input('ndRebates', { type: 'number', min: '0', step: '500', inputmode: 'decimal', class: 'input au-in num' })),
  ])]));
  /* At completion: the model's own rent, vacancy and furnishing, named here
     as the assumptions they are on this route. */
  const letting = PROPERTY_CLASSES[propertyClassOf(d)].letsToTenant;
  const assumed = (k) => (inputIsSeeded(d, k) || KIND_OF_EVIDENCE[shownEvidence(d, k)] === 'illustrative' ? 'illustrative' : 'modelled');
  const line = (label, value, kind, fine, whereText) => el('div', { class: 'au-field nd-at', 'data-kind': kind }, [
    el('p', { class: 'au-label' }, label), el('p', { class: 'nd-at-v num' }, value),
    el('p', { class: 'au-kind' }, [auBadge(kind, fine), whereText ? el('span', { class: 'nd-where' }, whereText) : null])]);
  box.append(group('completion', 'At completion — your assumptions', [el('div', { class: 'au-grid' }, [
    letting ? line('Rent at completion', `${pqMoney(num0(d.rent))} a month`, assumed('rent'), 'your assumption of the rent once the keys are handed over — not an observed rent', where.rent || null) : null,
    letting ? line('Occupancy', `${fmtNum(100 - num0(d.vacancyPct), 0)}%`, assumed('vacancyPct'), 'your assumption: 100% less the vacancy you set', where.vacancy || null) : null,
    line('Furnishing on completion', pqMoney(num0(d.renovation)), inputIsSeeded(d, 'renovation') ? 'illustrative' : KIND_OF_EVIDENCE[shownEvidence(d, 'renovation')] || 'yours', 'the renovation and furnishing figure, paid at vacant possession on this route', where.furnishing || null),
  ])]));
  return box;
}
/* THE SCHEDULE, a row a stage: its share of the price and the month after
   signing it is billed, the reader's. The template, if any, is named. */
function ndScheduleEditor({ d, prefix, answer }) {
  const stages = parseNdSchedule(d.ndSchedule) || [];
  const tpl = ndTemplateOf(stages);
  const vp = ndMonthsBetween(d.ndSpaMonth, d.ndVpMonth);
  const write = (next) => answer('ndSchedule', next.length ? ndScheduleText(next) : null);
  const fs = el('fieldset', { class: 'au-group nd-group nd-group-drawdown', id: `${prefix}-nd-drawdown` });
  fs.append(el('legend', { class: 'au-legend' }, 'Progressive drawdown — your schedule'));
  const kind = !stages.length ? 'unavailable' : tpl ? 'modelled' : 'yours';
  fs.append(el('p', { class: 'au-kind nd-sched-kind', 'data-kind': kind }, [
    auBadge(kind, !stages.length ? 'no schedule entered' : tpl ? `${tpl.form}, applied by you as a template` : 'your schedule'),
    el('span', { class: 'nd-where' }, !stages.length ? 'No schedule entered — apply a template below, or add your SPA’s stages.'
      : tpl ? `Template: Sarawak’s ${tpl.form} percentages (2014 Regulations), applied by you. Replace them with your SPA’s if they differ.`
        : `Your ${stages.length} stage${stages.length === 1 ? '' : 's'}, adding to ${fmtNum(stages.reduce((t, s) => t + s.pct, 0), 1)}%.`)]));
  if (stages.length) {
    const list = el('ol', { class: 'nd-stages' });
    stages.forEach((s, i) => {
      const set = (key, raw) => {
        const next = stages.map(x => ({ ...x }));
        const v = String(raw).trim();
        if (key === 'pct') next[i].pct = v === '' ? 0 : Math.min(100, Math.max(0, +Number(v).toFixed(2) || 0));
        else next[i].month = v === '' ? null : Math.min(999, Math.max(0, Math.round(Number(v)) || 0));
        write(next);
      };
      list.append(el('li', { class: 'nd-stage', 'data-stage': String(i) }, [
        el('div', { class: 'nd-stage-f' }, [el('label', { class: 'au-label', for: `${prefix}-nd-pct-${i}` }, `Stage ${i + 1} (% of price)`),
          el('input', { class: 'input au-in num', id: `${prefix}-nd-pct-${i}`, type: 'number', min: '0', max: '100', step: '0.5', inputmode: 'decimal', value: String(s.pct), onchange: (e) => set('pct', e.target.value) })]),
        el('div', { class: 'nd-stage-f' }, [el('label', { class: 'au-label', for: `${prefix}-nd-mo-${i}` }, 'Month after signing'),
          el('input', { class: 'input au-in num', id: `${prefix}-nd-mo-${i}`, type: 'number', min: '0', max: '999', step: '1', inputmode: 'numeric', value: s.month == null ? '' : String(s.month), placeholder: 'Not entered', onchange: (e) => set('month', e.target.value) })]),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm nd-stage-rm', id: `${prefix}-nd-rm-${i}`, 'aria-label': `Remove stage ${i + 1}`,
          onclick: () => write(stages.filter((_, j) => j !== i)) }, 'Remove'),
        tpl ? el('p', { class: 'nd-stage-what' }, tpl.stages[i][1]) : null,
      ]));
    });
    fs.append(list);
  }
  const landed = d.titleType !== 'strata' && /terrace|semi|bungalow|house|landed/i.test(String(d.propertyType || ''));
  const pick = ND_TPL_PICK[prefix] || (landed ? 'swk-b2' : 'swk-c');
  const sel = el('select', { class: 'select au-in nd-tpl', id: `${prefix}-nd-tpl`, onchange: (e) => { ND_TPL_PICK[prefix] = e.target.value; } },
    NEWDEV_TEMPLATE_IDS.map(id => el('option', { value: id, selected: id === pick ? '' : null }, NEWDEV_TEMPLATES[id].label)));
  fs.append(el('div', { class: 'nd-tools' }, [
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm nd-add', id: `${prefix}-nd-add`, onclick: () => write([...stages, { pct: 0, month: null }]) }, 'Add a stage'),
    el('div', { class: 'nd-tpl-row' }, [
      el('label', { class: 'au-label', for: `${prefix}-nd-tpl` }, 'A template from Sarawak’s prescribed SPA'), sel,
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm nd-tpl-go', id: `${prefix}-nd-tpl-go`,
        onclick: () => { const t = NEWDEV_TEMPLATES[document.getElementById(`${prefix}-nd-tpl`)?.value || pick]; if (t) write(t.stages.map(([p]) => ({ pct: p, month: null }))); } }, 'Apply this template')]),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm nd-even', id: `${prefix}-nd-even`, disabled: stages.length && vp > 0 ? null : '',
      title: stages.length && vp > 0 ? null : 'Needs stages and both months',
      onclick: () => { const ms = ndEvenMonths(stages.length, vp); write(stages.map((s, i) => ({ ...s, month: ms[i] }))); } }, 'Space the stages evenly to VP'),
  ]));
  /* How the template and the months are used: one tap away (L3). */
  const hid = `${prefix}-nd-drawdown-how`;
  const det = el('details', { class: 'pc-more ls-l3 au-more', id: hid, open: AU_HOW_OPEN.has(hid) ? '' : null }, [
    el('summary', { class: 'pc-more-sum' }, 'How the schedule is used'),
    el('p', { class: 'pc-more-body au-note' }, 'Each stage is a share of the SPA price, billed in the month after signing you enter (the prescribed agreement bills it within fourteen days of the developer’s notice that the stage is complete). Your own money pays the first stages and the loan the rest; the interest during construction is the loan’s rate on what it has released, until vacant possession. The template is Sarawak’s prescribed percentages, never a default: nothing is worked out until you apply it or enter your own, and its months are yours — “Space the stages evenly to VP” spreads them for you, and the developer’s progress claims will differ.')]);
  det.addEventListener('toggle', () => { if (det.open) AU_HOW_OPEN.add(hid); else AU_HOW_OPEN.delete(hid); });
  fs.append(det);
  return fs;
}

/* THE EXIT VALUES (L2): a row a horizon, its bar on one scale with the
   price paid marked on every bar. Positions rounded to 1/10000 of a per
   cent, so every browser draws them alike (0c4ba54b). */
function ndExitFigure(n, prefix) {
  const fig = el('figure', { class: 'au-wf nd-exit', id: `${prefix}-nd-exit`, 'aria-labelledby': `${prefix}-nd-exit-h` });
  fig.append(el('figcaption', { class: 'au-wf-h', id: `${prefix}-nd-exit-h` }, 'Exit value at VP+3, VP+5 and VP+10 — modelled, not a forecast'));
  const vals = n.exits.map(e => e.value).filter(isNum);
  const top = Math.max(...vals, isNum(n.paid) ? n.paid : 0, 1);
  const X = (v) => auR4(Math.max(0, Math.min(100, v / top * 100)));
  const list = el('ol', { class: 'au-wf-rows' });
  for (const e of n.exits) {
    const has = isNum(e.value);
    const svg = sv('svg', { class: 'au-wf-bar', width: '100%', height: '14', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(sv('rect', { class: 'au-wf-track', x: '0', y: '2', width: '100%', height: '10', rx: '3' }));
    if (has) svg.append(sv('rect', { class: 'au-wf-mark is-total', x: '0%', y: '2', width: `${X(e.value)}%`, height: '10', rx: '3' }));
    if (isNum(n.paid)) svg.append(sv('line', { class: 'au-wf-mv', x1: `${X(n.paid)}%`, x2: `${X(n.paid)}%`, y1: '0', y2: '14' }));
    list.append(el('li', { class: `au-wf-row is-total${has ? '' : ' is-na'}`, 'data-exit': String(e.n), 'data-value': has ? String(Math.round(e.value)) : '' }, [
      el('p', { class: 'au-wf-hd' }, [el('span', { class: 'au-wf-label' }, `VP+${e.n}`), ' ', auBadge(has ? 'modelled' : 'unavailable', has ? 'your appreciation assumption, not a forecast' : null),
        el('span', { class: 'au-wf-amt num' }, has ? pqMoney(e.value) : 'Unavailable')]),
      svg,
      el('p', { class: 'au-wf-sub' }, has ? `${fmtNum(e.years, 1)} years from signing` : `Needs ${auList(n.exitMissing)}`),
    ]));
  }
  fig.append(list);
  if (isNum(n.paid) && vals.length) fig.append(el('p', { class: 'au-wf-key' }, [el('span', { class: 'au-wf-key-mv', 'aria-hidden': 'true' }),
    `The upright line on each bar is the ${pqMoney(n.paid)} you pay. The bars are the completed comparable’s ${pqMoney(n.comp)} grown ${fmtNum(n.growth, 1)}% a year — your assumption.`]));
  return fig;
}

/* THE FIGURES: L1 and L2, and the route's defect liability. `why` holds
   what each "How … is worked out" opens. */
function ndResults({ n, d, prefix, why = {} }) {
  const box = el('div', { class: 'au-results nd-results', id: `${prefix}-nd-results` });
  const cards = el('div', { class: 'au-cards' });
  const p = n.premium;
  cards.append(lsMetricCard({ label: 'Developer premium', level: 1, cls: 'au-card nd-card nd-premium',
    badge: auBadge(n.premiumKind, p ? null : 'no completed comparable entered'),
    value: p ? [el('span', { class: 'nd-v' }, pqSigned(p.amount)), ' · ', el('span', { class: 'nd-v' }, ndPctWords(p.pct))] : 'Unavailable',
    attrs: { 'data-nd-fig': 'premium' }, valueAttrs: { 'data-value': p ? String(Math.round(p.amount)) : '', 'data-pct': p ? String(auR4(p.pct)) : '' },
    sub: p ? `You are paying ${pqMoney(Math.abs(p.amount))} / ${ndPctWords(p.pct)} ${p.amount >= 0 ? 'over' : 'under'} the completed comparable you entered: ${pqMoney(n.paid)}${n.rebates ? ` (the SPA price ${pqMoney(n.price)} less ${pqMoney(n.rebates)} of rebates and incentives)` : ''} against ${pqMoney(n.comp)}, from ${ndCompList(n).join('; ')}.`
      : 'Enter a completed comparable, or name one from your register: the premium is set against yours only, never a market figure.' }));
  const b = n.build;
  const seededCash = ['price', 'downPct', 'ratePct', 'tenureYears'].some(k => inputIsSeeded(d, k));
  const cashKind = kindFirst([seededCash ? 'illustrative' : null, n.cashUnverified > 0 ? 'placeholder' : null, b.status === 'ok' ? 'modelled' : null].filter(Boolean)) || 'derived';
  cards.append(lsMetricCard({ label: 'Cash required', level: 1, cls: 'au-card nd-card nd-cash', badge: auBadge(cashKind),
    value: auMoney(n.cash), attrs: { 'data-nd-fig': 'cash' }, valueAttrs: { 'data-value': isNum(n.cash) ? String(Math.round(n.cash)) : '' },
    sub: `${b.status === 'ok' ? `With ${pqMoney(b.idc)} of interest during construction.` : b.status === 'no-loan' ? 'No loan, so no interest during construction.' : 'Interest during construction not included: Unavailable until it can be worked out.'}${n.rebates ? ` Less ${pqMoney(n.rebates)} of rebates and incentives.` : ''}${n.cashUnverified > 0 ? ` ${pqMoney(n.cashUnverified)} on unverified lines.` : ''}` }));
  box.append(cards);
  const ctx = el('div', { class: 'au-cards nd-l2' });
  ctx.append(lsMetricCard({ label: 'Interest during construction', level: 2, cls: 'au-card nd-card nd-idc', badge: auBadge(n.idcKind, b.status === 'unavailable' ? 'not entered' : 'the rate and the months you entered'),
    value: b.status === 'ok' || b.status === 'no-loan' ? pqMoney(b.idc ?? 0) : 'Unavailable',
    attrs: { 'data-nd-fig': 'idc', 'data-status': b.status }, valueAttrs: { 'data-value': b.status === 'ok' || b.status === 'no-loan' ? String(b.idc ?? 0) : '' },
    sub: b.status === 'ok' ? `Interest only on what the ${pqMoney(b.loan)} loan has released, at ${fmtNum(b.ratePct, 2)}% a year, until vacant possession ${b.vpMonths} months after signing — on ${b.template ? `the ${b.template.form} template you applied` : 'your schedule'}.`
      : b.status === 'no-loan' ? 'No loan: nothing is released, so nothing is charged.'
        : `Enter ${auList(b.missing)}, or apply the template — never assumed.` }));
  const letting = PROPERTY_CLASSES[propertyClassOf(d)].letsToTenant;
  ctx.append(lsMetricCard({ label: 'Monthly position from VP', level: 2, cls: 'au-card nd-card nd-vp', badge: auBadge(isNum(n.vpMonthly) ? (n.rentKind === 'illustrative' ? 'illustrative' : 'modelled') : 'unavailable', 'your assumptions of the rent and the occupancy at completion'),
    value: isNum(n.vpMonthly) ? `${n.vpMonthly < 0 ? '−' : ''}${pqMoney(Math.abs(n.vpMonthly))}` : 'Unavailable',
    attrs: { 'data-nd-fig': 'vp' }, valueAttrs: { 'data-value': isNum(n.vpMonthly) ? String(Math.round(n.vpMonthly)) : '' },
    sub: isNum(n.vpMonthly) ? (letting
      ? `At the rent you assume for completion, ${pqMoney(n.rent)} a month, ${fmtNum(n.occupancyPct, 0)}% occupied, with the loan fully released. Nothing comes in before the keys.`
      : 'A class with no tenancy: the instalment and the running costs, with the loan fully released.') : 'The loan has no schedule of repayments.' }));
  box.append(ctx);
  box.append(ndExitFigure(n, prefix));
  /* What would justify the premium. */
  const rn = n.rentNeeded, gn = n.growthNeeded;
  if (!p) {
    box.append(lsActionCard({ title: 'What would justify the premium', line: 'Needs a completed comparable: the rent and the growth that would cover the premium are worked out from yours.',
      cls: 'nd-card nd-needed', attrs: { 'data-nd-fig': 'needed', 'data-status': 'no-comparable' },
      cta: lsCta('Enter one', { id: `${prefix}-nd-needed-go`, onclick: () => { const x = document.getElementById(`${prefix}-nd-ndCompPrice`); if (x) { x.scrollIntoView({ block: 'center' }); x.focus({ preventScroll: true }); } } }) }));
  } else {
    const figure = rn.status === 'solved' ? pqMoney(rn.rent) : rn.status === 'no-premium' ? 'No premium' : rn.status === 'pending' ? '…' : '—';
    const finding = rn.status === 'solved'
      ? `The figures you entered imply a rent of ${pqMoney(rn.rent)} a month — ${pqMoney(Math.abs(rn.extra))} ${rn.extra >= 0 ? 'more' : 'less'} than the ${pqMoney(n.rent)} you assume — to give the ${rn.target < 0 ? '−' : ''}${pqMoney(Math.abs(rn.target))} monthly position the same deal gives priced at the comparable.`
      : rn.status === 'no-premium' ? 'The price you pay is at or under the completed comparable you entered: there is no premium to cover.'
        : rn.status === 'pending' ? 'Working out the rent that covers the premium.' : (rn.why || 'Not computable for these inputs.');
    const sub = gn.status === 'solved' ? `Or values growing ${fmtNum(gn.pct, 1)}% a year, for a completed unit worth ${pqMoney(n.comp)} to be worth the ${pqMoney(n.paid)} you pay by vacant possession, ${fmtNum(gn.years, 1)} years after signing.`
      : gn.status === 'no-dates' ? 'The growth that would cover it needs the SPA month and the month of vacant possession.' : null;
    box.append(lsInsightCard({ label: 'What would justify the premium', cls: 'nd-card nd-needed', attrs: { 'data-nd-fig': 'needed', 'data-status': rn.status, 'data-value': rn.status === 'solved' ? String(rn.rent) : '', 'data-growth': gn.status === 'solved' ? String(auR4(gn.pct)) : '' },
      figure: el('p', { class: 'ls-card-figure num pe-fig' }, figure), finding: el('p', { class: 'ls-card-title' }, finding), sub: sub ? el('p', { class: 'ls-card-sub' }, sub) : null,
      cta: lsCta('See why', { id: `${prefix}-nd-needed-why`, onclick: why.needed, sr: ' this rent and growth would cover the premium' }) }));
  }
  /* The route's defect liability: a feature, not a figure. */
  box.append(el('p', { class: 'nd-dlp', id: `${prefix}-nd-dlp` }, [el('strong', {}, `Defect liability, ${NEWDEV_DLP.months} months from vacant possession. `),
    'Defects that appear in that time from defective workmanship or materials are the developer’s to repair at its own cost within 14 days of your written notice. ', el('span', { class: 'nd-cite' }, NEWDEV_DLP.cite)]));
  const links = [why.premium ? lsCta('How the premium is worked out', { id: `${prefix}-nd-premium-why`, onclick: why.premium }) : null,
    why.idc ? lsCta('How construction interest is worked out', { id: `${prefix}-nd-idc-why`, onclick: why.idc }) : null,
    why.exit ? lsCta('How the exit values are worked out', { id: `${prefix}-nd-exit-why`, onclick: why.exit }) : null].filter(Boolean);
  if (links.length) box.append(el('p', { class: 'au-why' }, links));
  return box;
}

/* L3: the working, in words. */
function ndPremiumFormula(n) {
  if (!isNum(n.comp)) return 'Unavailable: no completed comparable is entered or named. The premium is the price you pay against what a completed unit like it fetched — your comparable, typed with its source and date or named from your register, never a market figure.';
  const named = n.compFrom.named.map(c => `${c.name} ${pqMoney(c.implied)}${c.basis === 'rate' ? ' (by its rate a sq ft)' : ''} (${pqWhen(c.date)}, source: ${c.source})`);
  const typed = n.compFrom.typed ? [ndTypedWords(n.compFrom.typed)] : [];
  const all = [...named, ...typed];
  return `The completed comparable: ${all.length === 1 ? all[0] : `the median of ${auList(all)}`} = ${pqMoney(n.comp)}. `
    + `The price you pay: the SPA price ${pqMoney(n.price)}${n.rebates ? ` − rebates and incentives ${pqMoney(n.rebates)} = ${pqMoney(n.paid)}` : ' (no rebate entered)'}. `
    + (n.premium ? `Premium = ${pqMoney(n.paid)} − ${pqMoney(n.comp)} = ${pqSigned(n.premium.amount)}; as a share of the comparable, ${pqSigned(n.premium.amount)} ÷ ${pqMoney(n.comp)} = ${ndPctWords(n.premium.pct)}. ` : 'No price is entered. ')
    + 'Every figure is yours, as each badge says. Not a valuation.';
}
function ndConstructionFormula(n) {
  const b = n.build;
  if (b.status === 'unavailable') return `Unavailable until you enter ${auList(b.missing)}. Nothing is assumed: no schedule, no months and no dates stand in for yours. Sarawak’s prescribed stage percentages are offered as a template you may apply — never applied for you.`;
  if (b.status === 'no-loan') return 'No loan: your own money pays every stage, so nothing is released and no interest is charged.';
  const rows = b.draws.map(x => `stage ${x.i + 1}, ${fmtNum(x.pct, x.pct % 1 ? 1 : 0)}% (${pqMoney(x.amount)}) in month ${x.month}: ${x.fromLoan > 0 ? `${pqMoney(x.fromLoan)} from the loan × ${x.months} month${x.months === 1 ? '' : 's'} = ${pqMoney(x.interest)}` : 'your own money'}`);
  return `Your own money — the price less the ${pqMoney(b.loan)} loan, ${pqMoney(b.own)} — pays the first stages; the loan the rest. Each release is charged interest only, at ${fmtNum(b.ratePct, 2)}% a year ÷ 12 a month, from the month it is drawn until vacant possession in month ${b.vpMonths} (${ndMonthWords(n.spaMonth)} to ${ndMonthWords(n.vpMonth)}); a stage billed after it adds nothing. `
    + `${rows.join('; ')}. Interest during construction = ${pqMoney(b.idc)}, a line of the cash required. `
    + `${b.template ? `The percentages are Sarawak’s ${b.template.form} (the 2014 Regulations), applied by you as a template.` : 'The percentages are yours.'} The rate is the loan rate you entered, held through the construction. Not a lender’s quotation.`;
}
function ndExitFormula(n) {
  if (n.exitMissing.length) return `Unavailable until you enter ${auList(n.exitMissing)}. The exit values are grown from what a completed unit fetched — your comparable — never from the price you pay, which carries the premium.`;
  return `Exit value = the completed comparable ${pqMoney(n.comp)} × (1 + ${fmtNum(n.growth, 1)}%) ^ years from the SPA month: `
    + `${n.exits.map(x => `VP+${x.n}, ${fmtNum(x.years, 2)} years → ${pqMoney(x.value)}`).join('; ')}. `
    + 'The growth is your appreciation assumption — Modelled, and not a forecast: another rate gives another figure. The comparable is taken as the value at the SPA month, whatever its own date. Not a valuation.';
}
function ndNeededFormula(n) {
  const rn = n.rentNeeded, gn = n.growthNeeded;
  if (!n.premium) return 'Needs a completed comparable: the premium, and what would cover it, are worked out from yours.';
  const rent = rn.status === 'solved'
    ? `Rent: the calculator’s model (dealModel) is run at trial rents, every other figure as entered, until the monthly position at the SPA price is at least the ${pqMoney(rn.target)} it gives with the price ${pqMoney(n.premium.amount)} lower — the premium taken off. At ${pqMoney(rn.rent)} a month it is ${pqMoney(rn.achieved)}; at ${pqMoney(rn.rent - 1)}, ${pqMoney(rn.below)}.`
    : rn.status === 'no-premium' ? 'Rent: there is no premium to cover.' : rn.status === 'pending' ? 'Rent: being worked out.' : `Rent: ${rn.why || 'not computable for these inputs.'}`;
  const growth = gn.status === 'solved'
    ? `Growth: (${pqMoney(n.paid)} ÷ ${pqMoney(n.comp)}) ^ (1 ÷ ${fmtNum(gn.years, 2)} years) − 1 = ${fmtNum(gn.pct, 2)}% a year, the rate at which a completed unit is worth what you pay by vacant possession.`
    : gn.status === 'no-dates' ? 'Growth: needs the SPA month and the month of vacant possession.' : '';
  return `${rent} ${growth} What the figures you entered imply — not a recommendation, and not a forecast.`.replace(/\s+/g, ' ').trim();
}
function ndSourcesList() {
  return el('div', {}, [
    el('p', { class: 'lab-formula' }, `The template percentages and the defect liability period are Sarawak’s, as the prescribed sale and purchase agreements state them — Forms B and C of the Housing Development (Control and Licensing) Regulations, 2014, under Sarawak’s Ordinance of 2013 [Cap. 69]. Peninsular Malaysia’s Schedules G and H, under the Housing Development (Control and Licensing) Act 1966, do not apply in Sarawak. Read from the gazetted text; an amendment since, or your own SPA, is what binds. ${NEWDEV_DLP.words}`),
    el('ul', { class: 'au-src' }, [el('li', {}, el('a', { href: NEWDEV_SOURCE.url, target: '_blank', rel: 'noopener' }, NEWDEV_SOURCE.title))]),
  ]);
}
/* The model, with the two months its words name. */
const ndModelOf = (d, m, opts) => Object.assign(newDevModel(d, m, opts), { spaMonth: d.ndSpaMonth, vpMonth: d.ndVpMonth });

/* --------------------------------------------------- on the calculator */
function pcNewDevInputs(d) {
  const box = el('div', { class: 'pc-auction pc-newdev', id: 'newdev' });
  box.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 8px' }, 'The new development'));
  box.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' }, 'The purchase price above is the SPA price: every figure is worked from it.'));
  box.append(ndInputs({ d, prefix: 'pc',
    answer: (k, v) => { if (pcSubAnswer(d, k, v)) renderKeepFocus(); },
    evidence: (k, label) => (k === 'ndCompPrice' || k === 'ndRebates' ? pcEvidencePick(d, k, label) : null),
    extra: { comp: pcComparablesFieldset(d, 'Completed comparables from your register') },
    where: { rent: 'Set under Rental & expenses.', vacancy: 'Set under Rental & expenses.', furnishing: 'The renovation and furnishing, under Purchase.' } }));
  return box;
}
function pcNewDev(d) {
  const n = ndModelOf(d);
  const sec = el('section', { class: 'card ls-section au nd', id: 'pc-nd', 'aria-labelledby': 'pc-nd-h' });
  sec.append(el('h3', { class: 'h-card', id: 'pc-nd-h' }, 'The new development, worked through'));
  sec.append(el('p', { class: 'metaline au-route' }, ND_LEAD));
  const det = (id, summary, body) => el('details', { class: 'pc-more ls-l3', id }, [el('summary', { class: 'pc-more-sum' }, summary), typeof body === 'string' ? el('p', { class: 'pc-more-body lab-formula' }, body) : body]);
  const prDet = det('pc-nd-premium-ev', 'How the premium is worked out', ndPremiumFormula(n));
  const idcDet = det('pc-nd-idc-ev', 'How construction interest is worked out', ndConstructionFormula(n));
  const exDet = det('pc-nd-exit-ev', 'How the exit values are worked out', ndExitFormula(n));
  const neDet = det('pc-nd-needed-ev', 'How the rent and growth needed are found', ndNeededFormula(n));
  const srcDet = det('pc-nd-src-ev', 'Where the template comes from', ndSourcesList());
  sec.append(ndResults({ n, d, prefix: 'pc', why: { premium: () => lsOpenEvidence(prDet), idc: () => lsOpenEvidence(idcDet), exit: () => lsOpenEvidence(exDet), needed: () => lsOpenEvidence(neDet) } }));
  sec.append(el('p', { class: 'metaline nd-fees' }, newDevFeeNote()));
  sec.append(prDet, idcDet, exDet, neDet, srcDet);
  return sec;
}

/* ==========================================================================
   P5, COMMERCIAL: THE FOUR RENTS, RENT SUSTAINABILITY AND LEASE-DOWN (the
   brief's "Commercial models"; the model is commercialModel,
   75-property-grade.js; the answers CM_POSITIONS and DEAL_ANSWER_FIELDS,
   70-property.js)
   --------------------------------------------------------------------------
   Drawn for a commercial class, of any subtype, on any route. Inputs, each
   with its kind badge (D6) and, on the calculator, where it came from:
   - THE FOUR RENTS, each its own field and its own figure, never blended:
     the tenancy (tenanted, vacant, not known) and its contract rent; the
     asking rent for this unit; the achieved rents the reader names from
     their register (the observed comparable rent is their median, with the
     count and the dates — asking rents are never listed there); and the
     model rent, the calculator's expected rent (on the Lab, the Rent
     slider), the reader's assumption.
   - THE LEASE: its expiry (when a lease-down begins), the escalation and
     the deposit as the tenancy states them, the fit-out a re-let would
     need, the current tenant and their business.
   - THE UNIT AND ITS LOCATION: the frontage, corner or intermediate, the
     floor, parking and loading — the reader's record. No catchment or
     footfall figure: there is no source for one.
   Outputs on the layout system: L1 the net yield at the contract rent and
   at the model rent, and the reserve twelve months vacant needs (metric
   cards); L2 rent sustainability (an insight card), the four rents on one
   scale, and the four lease-down scenarios (a table, cards on a phone — in
   the order of their months, never ranked); L3 how each is worked out.
   Wording is the figures': "the figures you entered imply…", never a
   verdict on the deal, the rent or the tenant.
   ========================================================================== */
const CM_LEAD = 'The four rents stay apart: the tenancy’s, the asking rent, the achieved rents you recorded and your model rent. No catchment or footfall figure is shown — there is no source for one. Not a valuation.';
const cmRentWords = (v) => (isNum(v) ? `${pqMoney(v)} a month` : 'Unavailable');
const cmPct = (v) => (isNum(v) ? fmtPct(v, 2) : 'Unavailable');
const cmR = (v) => Math.round(Math.abs(v));
const cmPlural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cmDates = (o) => (!o?.first ? 'undated' : o.first === o.last ? pqWhen(o.first) : `${pqWhen(o.first)} – ${pqWhen(o.last)}`);
const cmMonthAt = (i) => new Date(Date.UTC(Math.floor(i / 12), i % 12, 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });

/* A rent against the observed comparables, in words and as a figure: the
   range from the highest of them to the lowest ("10–23% above"), or the
   one figure where there is one comparable. */
function cmRangeWords(a, n) {
  const obj = n === 1 ? 'the observed comparable you recorded' : 'the observed comparables you recorded';
  if (n === 1 || cmR(a.lo) === cmR(a.hi) && Math.sign(a.lo) === Math.sign(a.hi)) {
    const v = n === 1 ? a.median : a.lo;
    return cmR(v) === 0 ? { words: `at ${obj}`, figure: '0%' } : { words: `${cmR(v)}% ${v > 0 ? 'above' : 'below'} ${obj}`, figure: `${v > 0 ? '+' : '−'}${cmR(v)}%` };
  }
  if (a.lo >= 0) return { words: `${cmR(a.lo)}–${cmR(a.hi)}% above ${obj}`, figure: `+${cmR(a.lo)}–${cmR(a.hi)}%` };
  if (a.hi <= 0) return { words: `${cmR(a.hi)}–${cmR(a.lo)}% below ${obj}`, figure: `−${cmR(a.hi)}–${cmR(a.lo)}%` };
  return { words: `between ${cmR(a.lo)}% below and ${cmR(a.hi)}% above ${obj}`, figure: `−${cmR(a.lo)}% to +${cmR(a.hi)}%` };
}
/* The sustainability line, as the card says it. */
function cmSustainWords(c) {
  const s = c.sustain, o = c.observed;
  if (s.status === 'no-comparables') return null;
  const of = `${cmPlural(o.n, 'achieved rent')} you recorded — ${o.n === 1 ? pqMoney(o.lo) : `${pqMoney(o.lo)} to ${pqMoney(o.hi)}, median ${pqMoney(o.median)}`}, ${cmDates(o)}`;
  const model = s.model ? `At renewal the lease is modelled at your model rent, ${pqMoney(c.model)} — ${cmR(s.model.median) === 0 ? 'their median' : `${cmR(s.model.median)}% ${s.model.median > 0 ? 'above' : 'below'} their median`}.` : '';
  if (s.status === 'ok') {
    const r = cmRangeWords(s.contract, o.n);
    return { figure: r.figure, finding: `Current rent is ${r.words}.`, sub: `The contract rent of ${pqMoney(c.contract)} a month against ${of}. ${model}`.trim() };
  }
  if (s.model) {
    const r = cmRangeWords(s.model, o.n);
    return { figure: r.figure, finding: `Your model rent is ${r.words}.`,
      sub: `${s.status === 'vacant' ? 'The unit is vacant: there is no current rent to set against them.' : 'No contract rent is entered, so the current rent is not set against them.'} The model rent of ${pqMoney(c.model)} a month against ${of}.` };
  }
  return { figure: '—', finding: 'Not computable for these inputs.', sub: null };
}

/* THE INPUTS. `answer(k, v)` writes one (the page's own writer);
   `evidence(k, label)` draws where a figure came from, where the page asks
   it (the calculator); `extra.rents` is the register's pick; `where.model`
   says where the model rent is set; `fold` puts the unit and its location
   one tap away (the Lab), open at first on the calculator. */
const CM_UNIT_OPEN = new Set();
function cmInputs({ d, prefix, answer, evidence = null, extra = {}, where = {}, fold = false }) {
  const box = el('div', { class: 'au-inputs cm-inputs', id: `${prefix}-cm-inputs` });
  const field = (k, label, control, fine = null) => {
    const kind = auKindOfInput(d, k);
    return el('div', { class: 'au-field', 'data-cm': k, 'data-kind': kind }, [
      el('label', { for: `${prefix}-cm-${k}`, class: 'au-label' }, label), control,
      el('p', { class: 'au-kind' }, [auBadge(kind, fine), evidence && d[k] != null ? evidence(k, label.toLowerCase()) : null])]);
  };
  const input = (k, attrs) => el('input', { class: 'input au-in', id: `${prefix}-cm-${k}`, value: d[k] ?? '', placeholder: 'Not entered',
    onchange: (e) => { const raw = String(e.target.value).trim(); answer(k, raw === '' ? null : raw); }, ...attrs });
  const money = (k, step) => input(k, { type: 'number', min: '0', step: String(step), inputmode: 'decimal', class: 'input au-in num' });
  const text = (k, placeholder) => input(k, { type: 'text', maxlength: '120', autocomplete: 'off', placeholder });
  /* A choice, as the questions' chips — none chosen until the reader chooses. */
  const chips = (k, label, opts) => {
    const kind = auKindOfInput(d, k);
    const fs = pqGroup(prefix, `cm-${k}`, label, opts, d[k] ?? null, (v) => answer(k, v));
    fs.classList.add('au-pick');
    return el('div', { class: 'au-field', 'data-cm': k, 'data-kind': kind }, [fs,
      el('p', { class: 'au-kind' }, [auBadge(kind), evidence && d[k] != null ? evidence(k, label.toLowerCase()) : null])]);
  };
  const group = (id, legend, kids) => {
    const fs = el('fieldset', { class: `au-group cm-group cm-group-${id}`, id: `${prefix}-cm-${id}` });
    fs.append(el('legend', { class: 'au-legend' }, legend));
    fs.append(...kids.filter(Boolean));
    return fs;
  };
  const vacant = d.tenancy === 'vacant';
  const modelKind = inputIsSeeded(d, 'rent') || KIND_OF_EVIDENCE[shownEvidence(d, 'rent')] === 'illustrative' ? 'illustrative' : 'modelled';
  /* The four rents. */
  box.append(group('rents', 'The four rents — each kept apart', [
    el('div', { class: 'au-grid' }, [
      chips('tenancy', 'Current tenancy', Object.keys(CM_TENANCY_WORDS).map(id => [id, CM_TENANCY_WORDS[id]])),
      vacant ? null : field('tenancyRent', 'Contract rent — from the tenancy (RM a month)', money('tenancyRent', 50), 'the rent the tenancy agreement states'),
      field('cmAskingRent', 'Asking rent for this unit (RM a month)', money('cmAskingRent', 50), 'what is asked for this unit — somebody’s hope, not a rent paid'),
      el('div', { class: 'au-field cm-model', 'data-cm': 'rent', 'data-kind': modelKind }, [
        el('p', { class: 'au-label' }, 'Model rent — your assumption'), el('p', { class: 'nd-at-v num' }, `${pqMoney(num0(d.rent))} a month`),
        el('p', { class: 'au-kind' }, [auBadge(modelKind, 'your assumption of the rent at renewal — not an observed rent'), where.model ? el('span', { class: 'nd-where' }, where.model) : null])]),
    ]),
    extra.rents || null,
  ]));
  /* The lease. */
  box.append(group('lease', 'The lease', [el('div', { class: 'au-grid' }, [
    vacant ? null : field('cmLeaseExpiry', 'Lease expiry (month)', input('cmLeaseExpiry', { type: 'month', placeholder: 'YYYY-MM' }), 'when a lease-down would begin'),
    field('cmFitOut', 'Fit-out for a re-let (RM)', money('cmFitOut', 500), 'what letting it again would cost you'),
    vacant ? null : field('cmEscalation', 'Escalation, as the tenancy states it', text('cmEscalation', 'e.g. 10% at each renewal')),
    vacant ? null : field('cmDeposit', 'Deposit held (months of rent)', input('cmDeposit', { type: 'number', min: '0', step: '0.5', inputmode: 'decimal', class: 'input au-in num' })),
    vacant ? null : field('cmTenant', 'Current tenant', text('cmTenant', 'As you know them')),
    field('cmBusiness', vacant ? 'Business the unit suits' : 'Tenant’s business', text('cmBusiness', 'e.g. clinic, café, office')),
  ])]));
  /* The unit and its location. */
  const unitKeys = ['cmFrontage', 'cmPosition', 'cmFloor', 'cmParking'];
  const unit = [el('div', { class: 'au-grid' }, [
    field('cmFrontage', 'Frontage (ft)', input('cmFrontage', { type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'input au-in num' })),
    chips('cmPosition', 'Corner or intermediate', Object.values(CM_POSITIONS).map(o => [o.id, o.label])),
    field('cmFloor', 'Floor', text('cmFloor', 'e.g. ground, first')),
    field('cmParking', 'Parking and loading', text('cmParking', 'As you found them')),
  ]), el('p', { class: 'au-note cm-unit-note' }, 'Your record of the unit, each with where it came from. No catchment or footfall figure: there is no source for one, and none is made up.')];
  if (fold) {
    const hid = `${prefix}-cm-unit-more`;
    const n = unitKeys.filter(k => d[k] != null).length;
    const det = el('details', { class: 'pc-more ls-l3 au-more cm-unit-more', id: hid, open: CM_UNIT_OPEN.has(hid) ? '' : null }, [
      el('summary', { class: 'pc-more-sum' }, `The unit and its location — ${n} of ${unitKeys.length} recorded`), group('unit', 'The unit and its location', unit)]);
    det.addEventListener('toggle', () => { if (det.open) CM_UNIT_OPEN.add(hid); else CM_UNIT_OPEN.delete(hid); });
    box.append(det);
  } else box.append(group('unit', 'The unit and its location', unit));
  return box;
}

/* THE ACHIEVED RENTS, from the reader's register, named one by one: the
   observed comparable rent is their median. Each with its amount, the type
   it was recorded with, its date, its source and its standing, and the
   Yours badge. Asking rents are not listed: never an observed rent.
   `toggle(ids)` writes the list named. */
function cmRentPick({ d, prefix, legend, toggle }) {
  const choices = dealRentChoices(d);
  const ids = new Set(Array.isArray(d.rentComparableIds) ? d.rentComparableIds : []);
  const town = (SARAWAK_CITIES.find(c => c.id === d.city) || {}).name || d.city;
  const fs = el('fieldset', { class: 'comp-pick cm-rent-pick', id: `${prefix}-cm-rent-comps` });
  fs.append(el('legend', { class: 'eyebrow comp-pick-legend' }, legend));
  if (!choices.length) fs.append(el('p', { class: 'metaline' }, `No achieved rent is recorded in ${town} yet.`));
  for (const o of choices) {
    const id = `${prefix}-cm-rc-${slugParam(o.id)}`;
    const st = observationStanding(o);
    fs.append(el('label', { class: 'comp-pick-row', for: id, 'data-rent-comp': o.id }, [
      el('input', { type: 'checkbox', id, checked: ids.has(o.id) ? '' : null, onchange: (e) => {
        const next = new Set(Array.isArray(d.rentComparableIds) ? d.rentComparableIds : []);
        if (e.target.checked) next.add(o.id); else next.delete(o.id);
        toggle([...next]);
      } }),
      el('span', { class: 'comp-pick-words' }, [
        `${comparableName(o)} — ${pqMoney(o.value)} a month${String(o.propertyType || '').trim() ? `, ${String(o.propertyType).trim()}` : ''}, ${pqWhen(o.date)}`,
        ' ', kindBadge('yours', { fine: 'your own record', link: false }),
        el('span', { class: 'comp-pick-src' }, `Source: ${comparableSource(o)} · ${st.label}`)]),
    ]));
  }
  fs.append(el('p', { class: 'metaline comp-pick-apart' }, 'Asking rents are not listed here: an asking rent is somebody’s hope, never an observed rent.'));
  fs.append(el('p', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px' }, [
    el('a', { class: 'btn btn-ghost btn-sm', href: href('/property/comparables'), id: `${prefix}-cm-register`, onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/comparables'); } },
      choices.length ? 'Open the comparables register' : 'Record one in the comparables register')]));
  return fs;
}

/* THE FOUR RENTS ON ONE SCALE (L2): a row a rent — its name, its kind, its
   figure — and a bar from nought; the observed comparables' range a band
   on theirs, and their median marked on every bar, so how far each rent
   stands from it is a length. Each its own figure: nothing is blended.
   Positions rounded to 1/10000 of a per cent (0c4ba54b). */
function cmRentsFigure(c, d, prefix) {
  const fig = el('figure', { class: 'au-wf cm-rents', id: `${prefix}-cm-rents`, 'aria-labelledby': `${prefix}-cm-rents-h` });
  fig.append(el('figcaption', { class: 'au-wf-h', id: `${prefix}-cm-rents-h` }, 'The four rents — never blended'));
  const o = c.observed;
  const top = Math.max(...c.rents.map(r => r.value).filter(isNum), o ? o.hi : 0, 1);
  const X = (v) => auR4(Math.max(0, Math.min(100, v / top * 100)));
  const list = el('ol', { class: 'au-wf-rows' });
  const lease = d.cmLeaseExpiry ? `, to ${ndMonthWords(d.cmLeaseExpiry)}` : ', its expiry not entered';
  for (const r of c.rents) {
    const has = isNum(r.value);
    const svg = sv('svg', { class: 'au-wf-bar', width: '100%', height: '14', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(sv('rect', { class: 'au-wf-track', x: '0', y: '2', width: '100%', height: '10', rx: '3' }));
    if (r.id === 'observed' && o) {
      svg.append(sv('rect', { class: 'au-wf-mark is-add', x: `${X(o.lo)}%`, y: '2', width: `${auR4(Math.max(0.4, X(o.hi) - X(o.lo)))}%`, height: '10', rx: '3' }));
    } else if (has) svg.append(sv('rect', { class: 'au-wf-mark is-total', x: '0%', y: '2', width: `${X(r.value)}%`, height: '10', rx: '3' }));
    if (o) svg.append(sv('line', { class: 'au-wf-mv', x1: `${X(o.median)}%`, x2: `${X(o.median)}%`, y1: '0', y2: '14' }));
    const sub = r.id === 'contract' ? (c.vacant ? 'Vacant — no tenancy in place' : has ? `From the tenancy${lease}` : 'Not entered — from the tenancy agreement')
      : r.id === 'asking' ? (has ? 'Asked for this unit — somebody’s hope, not a rent paid' : 'Not entered')
        : r.id === 'observed' ? (o ? `The median of ${cmPlural(o.n, 'achieved rent')} you recorded${o.n > 1 ? `, ${pqMoney(o.lo)} to ${pqMoney(o.hi)}` : ''}, ${cmDates(o)}` : 'None named from your register')
          : `Your assumption${c.modelKind === 'illustrative' ? ' — still the sample’s' : ''}; the renewal is modelled at it`;
    list.append(el('li', { class: `au-wf-row is-total${has ? '' : ' is-na'}`, 'data-rent': r.id, 'data-value': has ? String(r.value) : '', 'data-kind': r.kind }, [
      el('p', { class: 'au-wf-hd' }, [el('span', { class: 'au-wf-label' }, r.label), ' ', auBadge(r.kind, has ? null : 'not entered'), el('span', { class: 'au-wf-amt num' }, cmRentWords(r.value))]),
      svg, el('p', { class: 'au-wf-sub' }, sub)]));
  }
  fig.append(list);
  if (o) fig.append(el('p', { class: 'au-wf-key' }, [el('span', { class: 'au-wf-key-mv', 'aria-hidden': 'true' }),
    `The upright line on each bar is the median of the achieved rents you recorded, ${pqMoney(o.median)}${o.n > 1 ? '; the lighter band, their range' : ''}.`]));
  return fig;
}

/* THE LEASE-DOWN SCENARIOS (L2): a table — cards on a phone — of 3, 6, 12
   and 18 months vacant, in that order: what each needs held in cash, and
   the effective yield a year over the holding period. Not a ranking. */
function cmLeaseDownTable(c, prefix) {
  const L = c.lease;
  const box = el('div', { class: 'cm-ld', id: `${prefix}-cm-ld` });
  box.append(el('p', { class: 'au-wf-h cm-ld-h', id: `${prefix}-cm-ld-h` }, 'Lease-down: months vacant from the lease expiry'));
  const table = el('table', { class: 'dt cm-ld-table', id: `${prefix}-cm-ld-table`, 'aria-labelledby': `${prefix}-cm-ld-h` });
  table.append(el('thead', {}, el('tr', {}, [el('th', { scope: 'col', style: 'text-align:left' }, 'Vacant'), el('th', { scope: 'col' }, 'Cash reserve'), el('th', { scope: 'col' }, 'Effective yield')])));
  const tb = el('tbody');
  for (const s of L.scenarios) {
    const ok = s.status !== 'unavailable';
    tb.append(el('tr', { 'data-months': String(s.months), 'data-reserve': ok ? String(s.reserve) : '', 'data-yield': ok && isNum(s.effYield) ? String(auR4(s.effYield)) : '', 'data-status': s.status }, [
      el('td', { style: 'text-align:left' }, `${s.months} months`),
      el('td', { class: 'num' }, ok ? pqMoney(s.reserve) : 'Unavailable'),
      el('td', { class: 'num' }, ok && isNum(s.effYield) ? `${fmtPct(s.effYield, 2)} a year` : 'Unavailable'),
    ]));
  }
  table.append(tb);
  lsTableCards(table, { id: `${prefix}-cm-ld-table` });
  box.append(el('div', { class: 'tablewrap' }, table));
  box.append(el('p', { class: 'au-kind cm-ld-kind' }, [auBadge(L.reserveKind, L.missing.length ? 'not entered' : 'your figures, and the vacancy months of each scenario'),
    el('span', { class: 'nd-where' }, L.missing.length ? `Unavailable until you enter ${auList(L.missing)} — never assumed.` : cmLeaseDownWhen(c))]));
  return box;
}
/* When the lease-down begins, and what the figures hold, in one line. */
function cmLeaseDownWhen(c) {
  const L = c.lease;
  const from = L.vacant ? 'From now — the unit is vacant'
    : L.expired ? `From now — the lease expiry you entered, ${ndMonthWords(L.expiryText)}, has passed`
      : `From the lease expiry, ${ndMonthWords(L.expiryText)} — ${cmPlural(L.start, 'month')} from ${cmMonthAt(L.now)}`;
  const beyond = L.start >= L.hold ? ` The lease runs past your ${L.hold / 12}-year hold: no vacancy falls in it, and the yield is the contract rent’s.` : '';
  return `${from}, over your ${L.hold / 12}-year hold. Each reserve is its months × ${pqMoney(L.burn)} with no rent${isNum(L.fitOut) ? ` + the ${pqMoney(L.fitOut)} fit-out you entered` : ' — fit-out not entered, not counted'}.${beyond}`;
}

/* THE FIGURES: L1 and L2. `why` holds what each "How … is worked out"
   opens; `toRents` is where the achieved rents are named. */
function cmResults({ c, d, prefix, why = {}, toRents = null }) {
  const box = el('div', { class: 'au-results cm-results', id: `${prefix}-cm-results` });
  const cards = el('div', { class: 'au-cards cm-l1' });
  const y = c.yields;
  cards.append(lsMetricCard({ label: 'Net yield at the contract rent', level: 1, cls: 'au-card cm-card cm-yc', badge: auBadge(y.contractKind, isNum(y.contract) ? 'the calculator’s net yield at the tenancy’s rent' : c.vacant ? 'vacant — no contract rent' : 'no contract rent entered'),
    value: cmPct(y.contract), attrs: { 'data-cm-fig': 'yield-contract' }, valueAttrs: { 'data-value': isNum(y.contract) ? String(auR4(y.contract)) : '' },
    sub: isNum(y.contract) ? `At ${pqMoney(c.contract)} a month, the tenancy’s.` : c.vacant ? 'The unit is vacant: no tenancy, no contract rent.' : 'Needs the contract rent, from the tenancy.' }));
  cards.append(lsMetricCard({ label: 'Net yield at the model rent', level: 1, cls: 'au-card cm-card cm-ym', badge: auBadge(y.modelKind, 'the calculator’s net yield at your model rent'),
    value: cmPct(y.model), attrs: { 'data-cm-fig': 'yield-model' }, valueAttrs: { 'data-value': isNum(y.model) ? String(auR4(y.model)) : '' },
    sub: isNum(y.model) ? `At ${pqMoney(c.model)} a month — the renewal’s, your assumption.` : 'Needs a purchase price and a model rent.' }));
  const r12 = c.lease.scenarios.find(s => s.months === 12);
  const okR = r12 && r12.status !== 'unavailable';
  cards.append(lsMetricCard({ label: 'Reserve for 12 months vacant', level: 1, cls: 'au-card cm-card cm-r12', badge: auBadge(c.lease.reserveKind, okR ? null : 'not entered'),
    value: okR ? pqMoney(r12.reserve) : 'Unavailable', attrs: { 'data-cm-fig': 'reserve-12', 'data-status': okR ? r12.status : 'unavailable' }, valueAttrs: { 'data-value': okR ? String(r12.reserve) : '' },
    sub: okR ? `12 months × ${pqMoney(c.lease.burn)} with no rent coming in${isNum(c.lease.fitOut) ? `, + ${pqMoney(c.lease.fitOut)} of fit-out` : '; fit-out not entered, not counted'}.` : `Enter ${auList(c.lease.missing)} — never assumed.` }));
  box.append(cards);
  /* Rent sustainability. */
  const w = cmSustainWords(c);
  if (!w) {
    box.append(lsActionCard({ title: 'Rent sustainability', line: 'Unavailable: needs achieved rents you recorded, named from your register — never a market figure.',
      cls: 'cm-card cm-sustain', attrs: { 'data-cm-fig': 'sustain', 'data-status': c.sustain.status, 'data-value': '' },
      cta: lsCta('Name them', { id: `${prefix}-cm-sustain-go`, onclick: toRents }) }));
  } else {
    const a = c.sustain.status === 'ok' ? c.sustain.contract : c.sustain.model;
    box.append(lsInsightCard({ label: 'Rent sustainability', cls: 'cm-card cm-sustain',
      attrs: { 'data-cm-fig': 'sustain', 'data-status': c.sustain.status, 'data-lo': a ? String(auR4(a.lo)) : '', 'data-hi': a ? String(auR4(a.hi)) : '' },
      figure: el('p', { class: 'ls-card-figure num pe-fig' }, w.figure), finding: el('p', { class: 'ls-card-title' }, w.finding),
      sub: w.sub ? el('p', { class: 'ls-card-sub' }, w.sub) : null,
      cta: lsCta('See why', { id: `${prefix}-cm-sustain-why`, onclick: why.sustain, sr: ' the rent stands where it does against them' }) }));
  }
  box.append(cmRentsFigure(c, d, prefix));
  box.append(cmLeaseDownTable(c, prefix));
  const links = [why.rents ? lsCta('How the four rents are kept apart', { id: `${prefix}-cm-rents-why`, onclick: why.rents }) : null,
    why.yields ? lsCta('How the yields are worked out', { id: `${prefix}-cm-yield-why`, onclick: why.yields }) : null,
    why.lease ? lsCta('How the lease-down is worked out', { id: `${prefix}-cm-ld-why`, onclick: why.lease }) : null].filter(Boolean);
  if (links.length) box.append(el('p', { class: 'au-why' }, links));
  return box;
}

/* L3: the working, in words. */
function cmRentsFormula(c) {
  const o = c.observed;
  const each = c.comps.map(x => `${x.name}, ${pqMoney(x.rent)} a month${x.type ? ` (${x.type})` : ''} — ${pqWhen(x.date)}, source: ${x.source}, ${x.standing.label.toLowerCase()}`);
  return `Contract rent: ${c.vacant ? 'none — you recorded the unit as vacant' : isNum(c.contract) ? `${pqMoney(c.contract)} a month, from the tenancy, as you entered it` : 'not entered'}. `
    + `Asking rent: ${isNum(c.asking) ? `${pqMoney(c.asking)} a month, asked for this unit, as you entered it` : 'not entered'}. `
    + `Observed comparable rent: ${o ? `the median of ${o.n === 1 ? 'one achieved rent' : `${o.n} achieved rents`} you named from your register — ${each.join('; ')} — = ${pqMoney(o.median)}` : 'Unavailable — no achieved rent is named from your register'}. `
    + `Model rent: ${pqMoney(c.model)} a month, the calculator’s expected rent — your assumption, the rent the renewal is modelled at. `
    + `${c.notUsed ? `${cmPlural(c.notUsed, 'named record')} ${c.notUsed === 1 ? 'is' : 'are'} not used: no longer in the register, or not an achieved rent. ` : ''}`
    + 'Each is its own figure and none is worked from another. Asking rents are never in the observed median, and NAPIC records transactions, not tenancies, so no NAPIC rent is used. Not a valuation.';
}
function cmSustainFormula(c) {
  const s = c.sustain, o = c.observed;
  if (!o) return 'Unavailable: no achieved rent is named from your register. Name the achieved rents you recorded for units like this one, and the current rent is set against the highest of them, the lowest and their median — your records, never a market figure.';
  const line = (label, a) => `${label} ${pqMoney(a.rent)}: against the highest, (${pqMoney(a.rent)} − ${pqMoney(o.hi)}) ÷ ${pqMoney(o.hi)} = ${fmtPct(a.lo, 1)}; against the lowest, (${pqMoney(a.rent)} − ${pqMoney(o.lo)}) ÷ ${pqMoney(o.lo)} = ${fmtPct(a.hi, 1)}; against the median ${pqMoney(o.median)}, ${fmtPct(a.median, 1)}.`;
  return [s.contract ? line('The contract rent', s.contract) : `No current rent: ${c.vacant ? 'the unit is vacant' : 'no contract rent is entered'}.`,
    s.model ? line('The model rent', s.model) : '', 'The range is said in whole per cent. What the figures you entered imply — not a verdict on the rent or the tenant.'].filter(Boolean).join(' ');
}
function cmYieldFormula(c) {
  const y = c.yields;
  return `Net yield is the calculator’s own: (the rent × 12 × (1 − the ${fmtNum(y.vacancyPct, 1)}% vacancy allowance you set) − the running costs) ÷ the purchase price. `
    + `At the contract rent: ${isNum(y.contract) ? `${fmtPct(y.contract, 2)} (gross ${fmtPct(y.grossContract, 2)})` : 'Unavailable — no contract rent'}. `
    + `At the model rent: ${isNum(y.model) ? `${fmtPct(y.model, 2)} (gross ${fmtPct(y.grossModel, 2)})` : 'Unavailable'}. `
    + 'The model is run with each rent in turn, every other figure as entered. The lease is modelled to renew at the model rent. Not a forecast.';
}
function cmLeaseDownFormula(c) {
  const L = c.lease;
  if (L.missing.length) return `Unavailable until you enter ${auList(L.missing)}. Nothing is assumed: the lease-down begins at the expiry you enter, or now if you record the unit as vacant.`;
  const rows = L.scenarios.map(s => `${s.months} months: reserve ${s.months} × ${pqMoney(L.burn)}${isNum(L.fitOut) ? ` + ${pqMoney(L.fitOut)}` : ''} = ${pqMoney(s.reserve)}; rent ${s.cMonths} months × ${pqMoney(c.contract || 0)} + ${s.mMonths} months × ${pqMoney(c.model)} = ${pqMoney(s.rentIn)}, ${s.vMonths} vacant; (${pqMoney(s.rentIn)} × ${fmtNum(L.rentKept * 100, 1)}% − ${pqMoney(s.costs)}${s.fit ? ` − ${pqMoney(s.fit)}` : ''}) ÷ ${fmtNum(L.hold / 12, 0)} years ÷ ${pqMoney(L.price)} = ${fmtPct(s.effYield, 2)} a year`);
  return `${cmLeaseDownWhen(c)} With no rent, the property costs ${pqMoney(L.burn)} a month: the instalment and the running costs you pay whatever the rent. `
    + `The effective yield keeps ${fmtNum(L.rentKept * 100, 1)}% of the rent received (the management and repair shares of the rent come off it) and takes ${pqMoney(L.fixedMonthly)} a month of fixed running costs for every month of the hold, and the fit-out once; rents held flat, the vacancy each scenario’s in place of the allowance. `
    + `${rows.join('; ')}. What the figures you entered imply — not a forecast.`;
}

/* --------------------------------------------------- on the calculator */
function pcCommercialInputs(d) {
  const box = el('div', { class: 'pc-auction pc-commercial', id: 'commercial' });
  box.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 8px' }, `Commercial${dealCommercialSubtype(d) ? ` — ${COMMERCIAL_SUBTYPES[dealCommercialSubtype(d)].label.toLowerCase()}` : ''}`));
  box.append(cmInputs({ d, prefix: 'pc',
    answer: (k, v) => { if (pcSubAnswer(d, k, v)) renderKeepFocus(); },
    evidence: (k, label) => pcEvidencePick(d, k, label),
    extra: { rents: cmRentPick({ d, prefix: 'pc', legend: 'Achieved rents from your register',
      toggle: (ids) => { if (setDealAnswer(d, 'rentComparableIds', ids)) { saveDeal(); renderKeepFocus(); } } }) },
    where: { model: 'The expected rent, above.' } }));
  return box;
}
function pcCommercial(d) {
  const c = commercialModel(d);
  const sec = el('section', { class: 'card ls-section au cm', id: 'pc-cm', 'aria-labelledby': 'pc-cm-h' });
  sec.append(el('h3', { class: 'h-card', id: 'pc-cm-h' }, 'The commercial rents, worked through'));
  sec.append(el('p', { class: 'metaline au-route' }, CM_LEAD));
  const det = (id, summary, body) => el('details', { class: 'pc-more ls-l3', id }, [el('summary', { class: 'pc-more-sum' }, summary), el('p', { class: 'pc-more-body lab-formula' }, body)]);
  const rDet = det('pc-cm-rents-ev', 'How the four rents are kept apart', cmRentsFormula(c));
  const sDet = det('pc-cm-sustain-ev', 'How rent sustainability is worked out', cmSustainFormula(c));
  const yDet = det('pc-cm-yield-ev', 'How the yields are worked out', cmYieldFormula(c));
  const lDet = det('pc-cm-ld-ev', 'How the lease-down is worked out', cmLeaseDownFormula(c));
  sec.append(cmResults({ c, d, prefix: 'pc', why: { rents: () => lsOpenEvidence(rDet), sustain: () => lsOpenEvidence(sDet), yields: () => lsOpenEvidence(yDet), lease: () => lsOpenEvidence(lDet) },
    toRents: () => lsGoTo(document.getElementById('pc-cm-rent-comps'), document.querySelector('#pc-cm-rent-comps input, #pc-cm-register')) }));
  sec.append(rDet, sDet, yDet, lDet);
  return sec;
}
