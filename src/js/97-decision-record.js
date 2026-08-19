/* ==========================================================================
   DECISION RECORD — THE PAGE THAT LEAVES THE BROWSER
   --------------------------------------------------------------------------
   An hour of work in this tool produced a browser tab. The tab is where the
   thinking happened and it is the wrong artefact for what comes next, because
   what comes next is a conversation with a spouse, a banker, a lawyer or a
   business partner — none of whom are sitting at this laptop, and all of whom
   will ask the same two questions: what did you assume, and what does it turn
   on.

   So this is one page, built to be printed or saved as PDF, holding exactly
   the things a person would be embarrassed not to have if challenged:

     · the figures, recomputed from the same engine the app used
     · EVERY driving input with what it actually is — a figure the reader
       entered, one this tool seeded, or one nobody has looked at
     · the two pictures that carry the decision
     · every open gate, not the worst one — the dock shows the worst because a
       screen has to prioritise; a record has to be complete
     · what the product does not know, and the date it was true

   The provenance column is the reason this is worth printing at all. A page of
   numbers with no provenance is what every other spreadsheet already produces.
   A page that says "the rent is a figure this tool invented and nobody has
   replaced" is a different document, and it is the honest one.
   ========================================================================== */

const DECISION_SUBJECTS = [
  { id: 'property', label: 'Property deal', ready: () => !!State.deal },
  { id: 'wheel', label: 'Options cash wheel', ready: () => num0(State.wheel?.putStrike) > 0 },
  { id: 'tradingIndex', label: 'Trading Index', ready: () => qttiRun(State.qtti).assessable },
];

/* The provenance word for one property input, in the reader's terms rather than
   the storage layer's. "Missing" is a real answer and gets said. */
function inputProvenance(d, k) {
  const ev = shownEvidence(d, k);
  if (!isNum(d[k]) && !d[k]) return { word: 'Missing', why: 'Nothing has been entered.', tone: '--dn-text' };
  if (ev === 'illustrative_default')
    return { word: 'Sample', tone: '--bronze',
             why: 'Carried by this tool as a starting number. Nobody chose it for this property.' };
  if (isTouched(d, k))
    return { word: evidenceOf(ev).rank >= 4 ? 'Verified' : 'User entered', tone: null,
             why: evidenceOf(ev).note };
  return { word: evidenceOf(ev).label, tone: null, why: evidenceOf(ev).note };
}

function decisionRecordProperty() {
  const d = State.deal, m = dealModel(d), g = propertyGrade(d, m);
  const out = el('div', { class: 'decision-record' });

  const where = [d.district, SARAWAK_CITIES.find(c => c.id === d.city)?.name].filter(Boolean).join(', ');
  out.append(el('div', { class: 'dr-head' }, [
    el('p', { class: 'eyebrow' }, 'Decision record · property'),
    el('h1', {}, `${d.propertyType || 'Property'}${where ? ` — ${where}` : ''}`),
    el('p', { class: 'metaline' },
      `Prepared ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${MODEL_VERSION} · research only, not advice`),
  ]));

  /* ---- what it comes to ------------------------------------------------ */
  const figs = el('div', { class: 'dr-figs' });
  [['Cash to complete', isNum(m.cashStillRequiredToComplete) ? fmtMoney(m.cashStillRequiredToComplete, 'MYR', 0) : null],
   ['Safe cash', isNum(m.safeCashRequired) ? fmtMoney(m.safeCashRequired, 'MYR', 0) : null],
   ['Monthly position', isNum(m.cashflowMonthly) ? fmtMoney(m.cashflowMonthly, 'MYR', 0) : null],
   ['Break-even rent', isNum(m.breakEvenRent) ? fmtMoney(m.breakEvenRent, 'MYR', 0) : null],
   ['Grade', g.grade || null]]
    .forEach(([k, v]) => figs.append(el('div', { class: 'dr-fig' }, [
      el('div', { class: 'caption' }, k),
      /* A withheld figure is printed as a withheld figure. An em dash in a
         document somebody carries into a bank is better than a zero. */
      el('div', { class: 'dr-fig-v' }, v ?? 'Not computed'),
    ])));
  out.append(figs);

  /* ---- what it rests on ------------------------------------------------ */
  out.append(el('h2', {}, 'What these figures rest on'));
  out.append(el('p', { class: 'body' },
    'Every input that moves an output above, and where each one came from. A figure marked Sample was '
    + 'carried by this tool, not chosen for this property.'));
  const t = el('table', { class: 'dt dr-table' });
  t.append(el('thead', {}, el('tr', {}, ['Input', 'Value', 'Where it came from', 'What it affects']
    .map(h => el('th', { style: 'text-align:left' }, h)))));
  const tb = el('tbody');
  PROPERTY_REVIEW.forEach(f => {
    const p = inputProvenance(d, f.k);
    tb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, f.label),
      el('td', { class: 'num', style: 'text-align:left' }, isNum(d[f.k]) ? f.fmt(d[f.k]) : '—'),
      el('td', { style: `text-align:left${p.tone ? `;color:var(${p.tone})` : ''}`, title: p.why }, p.word),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, f.affects),
    ]));
  });
  t.append(tb);
  const tw = el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' });
  tw.append(t);
  out.append(tw);
  gridKeyboard(t, 'What these figures rest on. Use the arrow keys to move between cells.');

  const unreviewed = propertyReviewQueue(d);
  if (unreviewed.length) out.append(el('p', { class: 'dr-warn' },
    `${unreviewed.length} of these ${unreviewed.length === 1 ? 'is' : 'are'} still the figure this tool seeded: `
    + `${unreviewed.map(f => f.label.toLowerCase()).join(', ')}. `
    + 'Nobody has replaced them with anything observed, so every output above inherits that.'));

  /* ---- the two pictures ------------------------------------------------ */
  if (isNum(m.breakEvenRent) && m.breakEvenRent > 0 && isNum(d.rent)) {
    out.append(el('h2', {}, 'Rent against break-even'));
    const host = el('div');
    out.append(host);
    thresholdBar(host, {
      value: d.rent, valueLabel: 'your rent',
      threshold: m.breakEvenRent, thresholdLabel: 'break-even', ccy: 'MYR',
      aria: (covers, gap) => `Entered rent ${fmtMoney(d.rent, 'MYR')} a month against a break-even rent of `
        + `${fmtMoney(m.breakEvenRent, 'MYR')} a month. `
        + (covers ? `The rent covers costs and the loan by ${fmtMoney(gap, 'MYR')} a month.`
                  : `The rent is ${fmtMoney(gap, 'MYR')} a month short.`),
    });
  }
  if ((m.costGroups || []).length >= 2) {
    out.append(el('h2', {}, 'What the cash is for'));
    const host = el('div');
    out.append(host);
    cashWaterfall(host, m);
  }

  /* ---- what is open ---------------------------------------------------- */
  out.append(el('h2', {}, 'What is unresolved'));
  const gates = g.gates || [];
  if (!gates.length) {
    out.append(el('p', { class: 'body' }, 'No gate is open on the figures as entered. That is a statement about '
      + 'the inputs above, not about the property.'));
  } else {
    const ul = el('ul', { class: 'ticklist blocklist' });
    gates.forEach(x => ul.append(el('li', {},
      `${x.severity === 'critical' ? 'Critical — ' : ''}${x.text || x}`)));
    out.append(ul);
  }

  out.append(el('h2', {}, 'What this record does not tell you'));
  const lim = el('ul', { class: 'ticklist blocklist' });
  [
    'No valuation of the property. Nothing here is a price opinion, a target price or a recommendation.',
    (() => {
      const own = (State.observations || []).filter(o => !o.sample).length;
      return 'No comparables beyond what has been recorded in this browser. The register holds '
        + (own ? `${own} record${own === 1 ? '' : 's'} of your own` : 'nothing of your own')
        + ', so nothing above has been checked against a transaction anyone else can see.';
    })(),
    'Title, tenure and eligibility are recorded from user input and have not been verified. Confirm with a '
      + 'Sarawak property lawyer and the Land and Survey Department.',
    'Costs, duties and fees follow the registry in this build and change without notice. Confirm every figure '
      + 'with the lender, the solicitor and the local authority before committing.',
  ].forEach(x => lim.append(el('li', {}, x)));
  out.append(lim);

  return out;
}

function decisionRecordWheel() {
  const p = State.wheel, m = wheelMath(p), fit = wheelFit(p, m, null);
  const out = el('div', { class: 'decision-record' });
  out.append(el('div', { class: 'dr-head' }, [
    el('p', { class: 'eyebrow' }, 'Decision record · options cash wheel'),
    el('h1', {}, `${(p.symbol || '').trim() || 'Unnamed contract'} — cash-secured put and covered call`),
    el('p', { class: 'metaline' },
      `Prepared ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${MODEL_VERSION} · research only, not advice`),
  ]));

  if (p.isWorkedExample) out.append(el('p', { class: 'dr-warn' },
    'This is the worked contract this tool carries as an illustration. The strike, premium and expiry were not '
    + 'quoted by any broker and no chain data is connected.'));

  const figs = el('div', { class: 'dr-figs' });
  [['Cash to secure', isNum(m.requiredAssignmentCash) ? fmtMoney(m.requiredAssignmentCash, 'USD') : null],
   ['Premium received', isNum(m.putPremiumCashReceived) ? fmtMoney(m.putPremiumCashReceived, 'USD') : null],
   ['Break-even', isNum(m.putBreakEven) ? fmtMoney(m.putBreakEven, 'USD') : null],
   ['Worst case at zero', isNum(m.putMaxLossIfZero) ? fmtMoney(m.putMaxLossIfZero, 'USD') : null]]
    .forEach(([k, v]) => figs.append(el('div', { class: 'dr-fig' }, [
      el('div', { class: 'caption' }, k),
      el('div', { class: 'dr-fig-v' }, v ?? 'Not computed'),
    ])));
  out.append(figs);

  out.append(el('h2', {}, 'Payoff at expiry'));
  const host = el('div');
  out.append(host);
  payoffChart(host, m, p);

  out.append(el('h2', {}, 'What is unresolved'));
  const gates = fit.gates || [];
  if (!gates.length) out.append(el('p', { class: 'body' }, 'No gate is open on the contract as entered.'));
  else {
    const ul = el('ul', { class: 'ticklist blocklist' });
    gates.forEach(x => ul.append(el('li', {}, typeof x === 'string' ? x : x.text)));
    out.append(ul);
  }

  out.append(el('h2', {}, 'What this record does not tell you'));
  const lim = el('ul', { class: 'ticklist blocklist' });
  ['No live option chain is connected. Every contract figure is one you entered.',
   'No assessment of whether this trade suits you. This product does not ask about your circumstances and could not answer that if it did.',
   'Assignment, early exercise, dividends and corporate actions are modelled simply and will differ from a broker’s treatment.',
  ].forEach(x => lim.append(el('li', {}, x)));
  out.append(lim);
  return out;
}

VIEWS.decisionRecord = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  const ready = DECISION_SUBJECTS.filter(s => { try { return s.ready(); } catch { return false; } });
  const want = State.decisionSubject && ready.some(s => s.id === State.decisionSubject)
    ? State.decisionSubject : (ready[0]?.id || null);

  /* The chrome above the record — not part of what prints. */
  const bar = el('div', { class: 'card dr-chrome' });
  bar.append(cardHead('Decision record',
    'One page holding the figures, every input with where it came from, the pictures and everything still open. '
    + 'Print it or save it as PDF — this is the version that leaves the browser.'));
  if (ready.length > 1) {
    const seg = el('div', { class: 'segmented', style: 'margin-top:var(--md)', role: 'tablist' });
    ready.forEach(s => seg.append(el('button', {
      role: 'tab', 'aria-selected': s.id === want ? 'true' : 'false',
      class: s.id === want ? 'is-on' : '',
      onclick: () => { State.decisionSubject = s.id; render(); },
    }, s.label)));
    bar.append(seg);
  }
  bar.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => window.print() }, 'Print or save as PDF'),
  ]));
  bar.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Printing hides the navigation, the dock and these controls. The record itself prints in light colours '
    + 'whatever theme the screen is using, because a dark page is not what a printer should be asked to do.'));
  wrap.append(bar);

  if (!want) {
    const empty = el('div', { class: 'card' });
    empty.append(cardHead('Nothing to record yet',
      'A record is made of the work behind it. Model a property, enter a contract, or record trend evidence, '
      + 'and this page fills in from what the engine already computed.'));
    empty.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' },
      ['/property/calculator', '/us-options/wheel', '/research/trading-index'].map((h, i) =>
        el('a', { class: i ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm', href: href(h),
          onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(h); } },
          ['Property calculator', 'Cash wheel', 'Trading Index'][i]))));
    wrap.append(empty);
    return wrap;
  }

  const card = el('div', { class: 'card' });
  if (want === 'property') card.append(decisionRecordProperty());
  else if (want === 'wheel') card.append(decisionRecordWheel());
  else {
    /* The Trading Index states its own evidence rather than a modelled figure,
       so its record is its evidence table — reusing the view's own renderer
       rather than a second copy that could disagree with it. */
    const r = qttiRun(State.qtti);
    const out = el('div', { class: 'decision-record' });
    out.append(el('div', { class: 'dr-head' }, [
      el('p', { class: 'eyebrow' }, 'Decision record · Trading Index'),
      el('h1', {}, `${State.qtti?.symbol || 'Instrument'} — trend evidence`),
      el('p', { class: 'metaline' },
        `Prepared ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · research only, not advice`),
    ]));
    const figs = el('div', { class: 'dr-figs' });
    [['Trend regime', r.assessable ? String(r.regime) : null],
     ['First-tranche readiness', r.assessable ? String(r.tranche) : null],
     ['Screenshot confidence', r.assessable ? String(r.confidence) : null]]
      .forEach(([k, v]) => figs.append(el('div', { class: 'dr-fig' }, [
        el('div', { class: 'caption' }, k), el('div', { class: 'dr-fig-v' }, v ?? 'Not computed')])));
    out.append(figs);
    out.append(el('h2', {}, 'What is unresolved'));
    const all = [...(r.reject || []), ...(r.gates || [])];
    if (!all.length) out.append(el('p', { class: 'body' }, 'No gate is open on the evidence recorded.'));
    else {
      const ul = el('ul', { class: 'ticklist blocklist' });
      all.forEach(x => ul.append(el('li', {}, typeof x === 'string' ? x : x.text)));
      out.append(ul);
    }
    card.append(out);
  }
  wrap.append(card);
  return wrap;
};
