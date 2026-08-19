/* ==========================================================================
   VIEW — PLANS
   ========================================================================== */
/* The scope statement. It exists because the boundary between research and
   advice is a product decision that has to be legible to a user, a regulator
   and the team building the next feature — not a paragraph in a terms page. */
/* The boundary argument in full, on its own page. It was the first thing on the
   pricing page and is now the whole of this one — the same content, reached by
   someone who has decided they want it rather than imposed on someone who came
   to read a price. */
/* ==========================================================================
   FEATURE STATUS REGISTER — execution directive 2.3, 3 and 9.3

   The directive's central rule is that nothing is deleted. A capability may be
   gated, limited or queued, but "deleted", "abandoned" and "hidden
   indefinitely" are not valid states — and 9.3 requires every release to prove
   that no capability silently disappeared.

   That proof needs somewhere to live, so it lives here, publicly. A status
   register kept in a private document is a claim; one a reader can open is a
   commitment. Each row names what the capability is, what state it is in, and
   for anything gated, the specific thing that is holding it and who clears it —
   because "coming soon" is what a roadmap says when nobody has decided.
   ========================================================================== */
const FEATURE_STATUS = [
  { id:'active-core', label:'Active Core Build', note:'Receiving current build capacity.' },
  { id:'maintenance', label:'Active Maintenance', note:'Available and supported; reliability work continues.' },
  { id:'beta',        label:'Beta', note:'Available with a stated limitation.' },
  { id:'data-gated',  label:'Data Gated', note:'Interface and model retained; investable output waits on authorised data.' },
  { id:'compliance',  label:'Compliance Gated', note:'Capability retained; activation waits on legal approval or licence.' },
  { id:'queued',      label:'Expansion Queue', note:'In the roadmap, sequenced after core quality gates.' },
];

const CAPABILITY_REGISTER = [
  { name:'Sarawak property underwriting', status:'active-core', path:'/property/calculator',
    now:'Capital ledger, valuation gap, grade, downside and plain-language result.' },
  { name:'True capital ledger', status:'active-core', path:'/property/calculator',
    now:'Every completion, rent-ready and reserve line, reconciled.',
    gate:'Seven fee lines carry placeholder values pending verification against the Solicitors’ Remuneration Order 2023 and the current rate orders.' },
  { name:'Borrower Loan Readiness', status:'active-core', path:'/property/calculator',
    now:'Income, debts, disposable income, credit conduct and documents, as a diagnostic score.' },
  { name:'Property Financeability', status:'active-core', path:'/property/calculator',
    now:'Title, valuation gap, tenure, condition and marketability, scored separately from the borrower.' },
  { name:'Property underwriting grade', status:'active-core', path:'/property/calculator',
    now:'A/B/C/D/U with hard gates and evidence caps.' },
  { name:'Property opportunity register', status:'active-core', path:'/property/opportunities',
    now:'Records real candidates with source, availability date, four separate prices, grade and a next action with an owner.',
    gate:'Holds nothing until you add cases. This product sources no listings and republishes none.' },
  { name:'Sarawak comparables register', status:'data-gated', path:'/property/comparables',
    now:'The structure: address, district, title, built-up area, asking and achieved kept apart, date, evidence class, source reference and a reviewer.',
    gate:'Ships empty, and stays empty until a person records evidence. No source publishes Sarawak transacted prices or achieved rents this product may redistribute.' },
  { name:'Loan comparison across lenders', status:'queued', path:null,
    gate:'Needs the offer-status workflow. Financing scenarios at 70/80/90% exist today; named lender offers do not.' },
  { name:'Operations Excellence handoff', status:'queued', path:null,
    gate:'Book 2. Generated from Book 1 once acquisition underwriting is settled.' },
  { name:'Property map and area observations', status:'maintenance', path:'/property/calculator',
    now:'Cached coordinates under ODbL with per-area match confidence.' },
  { name:'Discover and screener', status:'maintenance', path:'/discover/screener',
    now:'Reproducible filters, cohort medians and a reporting-currency selector.' },
  { name:'Company research', status:'maintenance', path:'/research',
    now:'Statements, scorecards, valuation router and risk flags.' },
  /* Was listed as queued with no route while it had been live on every company
     page for weeks. One row was describing two things — the classifier that
     ships and the saved strategy plan that does not — so shipping half of it
     left the row wrong about both. Split. */
  { name:'Equity Strategy Lens', status:'active-core', path:'/research',
    now:'On every company page: instrument type, business archetype, return role, and eight fit grades that separate graded from unassessed, not applicable, not built and illustrative.',
    gate:'Grades describe how far the evidence meets a strategy’s requirements. They are not an entry plan and imply no allocation.' },
  { name:'Saved strategy plans and leverage stress', status:'queued', path:null,
    gate:'P1. Staged entry tranches, invalidation conditions, leverage stress and outcome review, saved against a company and a model version. The Lens grades the underlying; it does not record what you decided to do about it.' },
  { name:'Bursa universe', status:'data-gated', path:'/research',
    gate:() => covText(k => `${k.illustrative} companies carry illustrative figures — ${k.my} Bursa`
       + (k.usIllustrative ? ` and ${k.usIllustrativeNames.join(', ')} on the US side` : '')
       + '. No investable grade is offered for any of them.',
       `${COVERAGE_PENDING} — how many companies carry illustrative figures is not known until the audited set has loaded. No investable grade is offered for any of them either way.`) },
  { name:'US equities', status:'maintenance', path:'/research',
    now:() => covText(k => `${k.usFiled} US companies with audited SEC filings, of ${k.us} US listings held.`,
      `${COVERAGE_PENDING} — the audited US set is still loading. This row states a count only once it can state the right one.`) },
  { name:'US Options Cash Wheel', status:'data-gated', path:'/us-options/wheel',
    now:'Cash-secured put and covered-call arithmetic, collateral gates, downside scenarios and the full risk card, from figures you enter.',
    gate:'No authorised option-chain data, so contracts are entered by hand. Live chains, any recommended contract, broker routing and execution stay Compliance Gated and are not built.' },
  { name:'QT Trading Index', status:'active-core', path:'/research/trading-index',
    now:'Multi-timeframe trend regime, first-tranche readiness against your own rules, screenshot confidence, template and derivative hard gates, from chart evidence you record.',
    gate:'Phase 1 only. It does not read your screenshot — OCR and vision extraction are phase 2. No indicator here has been backtested on point-in-time data, so no rule is claimed to be effective.' },
  { name:'Sarawak Economy Watch', status:'data-gated', path:'/discover/sarawak',
    gate:'11 companies identified with price history. Exposure evidence, filings and coverage are not yet recorded, so no fit grade is shown.' },
  { name:'Portfolio and My Investments', status:'maintenance', path:'/my/portfolio',
    now:'Holdings, weights, currency attribution and thesis links.' },
  { name:'Thesis, catalysts and invalidation', status:'maintenance', path:'/my/theses',
    now:'User-authored conditions evaluated against current data, with the proximity rule published.' },
  { name:'Alerts and monitoring', status:'beta', path:'/my/alerts',
    now:'Fact-change alerts.', gate:'Stale-data and duplicate controls are not yet implemented.' },
  { name:'Bring your own market data', status:'maintenance', path:'/my/data',
    now:'Paste closes; they stay in this browser and never reach the site.' },
  { name:'Multilingual property workflow', status:'beta', path:'/property/calculator',
    now:'Input labels, evidence grades and the ten risk questions in Bahasa Malaysia and Chinese.',
    gate:'The longer explanations remain English-only.' },
  { name:'Learn and methodology', status:'maintenance', path:'/learn',
    now:'Formulas, weights, anchor ranges and limitations.' },
  { name:'Plans and pricing', status:'maintenance', path:'/pricing',
    now:'Tiers and what each includes.',
    gate:'No payment is processed anywhere in this build, and none will be until the operating entity is registered.' },
  { name:'Brokerage connection and execution', status:'compliance', path:null,
    gate:'Not built and not activated. Requires licensing, suitability, custody and consent work well beyond this product’s current boundary.' },
  { name:'Personalised advice mode', status:'compliance', path:null,
    gate:'Would require written Malaysian legal classification and SC authorisation. The research boundary is a product design, not a disclaimer.' },
];

/* ==========================================================================
   PROPERTY OPPORTUNITY REGISTER — directive 6.7, specification 27.5

   A calculator answers "what would this deal do". A register answers "which
   deals exist, and what do we actually know about each" — and the second is
   the one that turns a tool into research.

   THE RULES THAT SHAPE IT

   A listing is not a recommendation, so nothing here is ordered by merit.
   Sorting is by recency or an explicit filter the reader chose, because a
   hidden merit rank is a recommendation wearing a sort order.

   "Available" is never shown unless availability was checked, and the date it
   was checked is shown beside it. A stale availability flag is worse than none:
   it sends someone to a property that sold weeks ago.

   Four prices are kept apart — asking, negotiated, bank valuation, registered
   valuer — because collapsing them is how a valuation gap disappears.

   A candidate with no verified rent, title or condition evidence stays U
   however good its yield looks. Yield on an unverified rent is arithmetic on a
   guess.

   Nothing is scraped. Each record carries where it came from, and the source is
   a reference the reader entered rather than content this product republished.
   ========================================================================== */
const CANDIDATE_STATES = [
  { id:'captured',           label:'Captured',              note:'Recorded from a listing or a conversation. Nothing verified.' },
  { id:'identity_verified',  label:'Identity verified',     note:'Address, title reference and attributes confirmed.' },
  { id:'evidence_gathering', label:'Gathering evidence',    note:'Rent, comparables, valuation and title evidence being collected.' },
  { id:'underwritten',       label:'Underwritten',          note:'Modelled and graded on the evidence held.' },
  { id:'conditional_dd',     label:'Conditional due diligence', note:'Proceeding subject to named verifications.' },
  { id:'finance_review',     label:'Finance review',        note:'With a lender or broker.' },
  { id:'closed',             label:'Acquired or closed',    note:'Concluded, either way.' },
  { id:'stale',              label:'Stale or withdrawn',    note:'No longer available, or not checked recently enough to say.' },
];

State.opportunities = store.read('opportunities', []);
const saveOpportunities = () => store.write('opportunities', State.opportunities);

/* Runs the underwriting engine over a candidate by layering its fields on the
   calculator's own defaults, so a register entry and a calculator run cannot
   diverge — one engine, two front doors. */
function candidateModel(o) {
  const d = { ...State.deal, ...o.deal, touched: o.touched || {}, evidence: o.evidence || {} };
  const m = dealModel(d);
  return { d, m, grade: propertyGrade(d, m), finance: propertyFinanceability(d, m) };
}

const daysSince = (iso) => {
  if (!iso) return null;
  const n = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return Number.isFinite(n) ? n : null;
};

VIEWS.wheel = () => {
  const p = State.wheel;
  const m = wheelMath(p);
  const fit = wheelFit(p, m, null);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'US equities'),
    el('h1', {}, 'Options Cash Wheel'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'A fully collateralised cash-secured put and covered call cycle, modelled from figures you enter. Research and arithmetic — no chain data, no recommended contract, no execution.'),
  ])));

  const wLink = workspaceLinkBanner('wheel', p, () => { saveWheel(); render(); });
  if (wLink) wrap.append(wLink);

  wrap.append(workBar('wheel', () => {
    State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, isWorkedExample: false };
    State.wheelLegs = [];
    saveWheel(); saveWheelLegs();
  }));

  /* NOTHING ENTERED YET IS A STATE, NOT AN ABSENCE.
     -----------------------------------------------------------------------
     The collateral bar and the expiry payoff are the two things this tool has
     that a spreadsheet does not, and both are computed from a contract — so
     until one is entered, neither exists. A first-time visitor therefore met a
     long empty form and no demonstration that anything would happen, which is
     how an external audit came to report the Cash Wheel as lacking the very
     graphics it contains. Checked on production: a fresh visit renders neither.

     Two named paths, because they are genuinely different intentions and the
     worked one must never be mistaken for the reader's own figures. It is
     stamped illustrative in the plan itself, not just in this copy. */
  if (!(num0(p.putStrike) > 0)) {
    const start = el('div', { class: 'card' });
    start.append(cardHead('Nothing entered yet',
      'This tool computes a collateral position and an expiry payoff from one contract. Enter yours, or load a worked one to see what it returns first.'));
    start.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
        State.wheel = { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true };
        saveWheel(); render(); toast('Worked contract loaded — illustrative figures');
      } }, 'Load a worked contract'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
        const f = document.querySelector('#wheel-inputs input');
        if (f) { f.closest('.card')?.scrollIntoView({ block: 'start' }); f.focus(); }
      } }, 'Enter my own contract'),
    ]));
    start.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      'The worked contract uses round illustrative numbers on no particular company. It is not a quote, not a recommended contract, and no chain data is connected to this build.'));
    wrap.append(start);
  }

  /* Loaded sample figures that stop announcing themselves become the reader's
     figures by default, which is the failure this whole product is built
     against. The banner stays until they are replaced or cleared. */
  if (p.isWorkedExample) {
    const note = el('div', { class: 'card', style: 'border-left:3px solid var(--bronze)' });
    note.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:center' }, [
      el('span', { class: 'chip chip-bronze' }, 'Illustrative'),
      /* Precise rather than reassuring. The flag survives an edit on purpose:
         changing one field leaves the other five illustrative, and a banner
         that vanished on the first keystroke would certify a contract that is
         still mostly the example. */
      el('span', { style: 'font-size:14px' },
        'Loaded from the worked contract. Any field you have not changed is still an illustrative figure.'),
      el('button', { class: 'btn btn-quiet btn-sm', style: 'margin-left:auto', onclick: () => {
        State.wheel = { ...State.wheel, ...WHEEL_BLANK_CONTRACT, isWorkedExample: false };
        saveWheel(); render(); toast('Contract cleared');
      } }, 'Clear and enter my own'),
    ]));
    wrap.append(note);
  }

  /* Fit and phase, then the two numbers 41A.15 requires above any yield. */
  const tone = { A:'--ok-text', B:'--bronze', C:'--bronze', D:'--dn-text', U:'--ink-2' }[fit.grade];
  const head = el('div', { class: 'card', style: `border-left:3px solid var(${tone})` });
  head.append(el('div', { class: 'row row-wrap', style: 'gap:12px;align-items:baseline' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'Wheel fit'),
      el('div', { class: 'row', style: 'gap:10px;align-items:baseline' }, [
        el('span', { class: 'num', style: `font-size:32px;font-weight:700;color:var(${tone})` }, fit.grade),
        el('span', { style: 'font-size:14px;font-weight:500' },
          fit.grade === 'U' ? 'Not assessable' : 'Meets the criteria you selected'),
      ]),
    ]),
    el('div', { style: 'margin-left:auto;text-align:right' }, [
      el('div', { class: 'metaline' }, `Phase: ${p.phase === 'call' ? 'covered call' : 'cash-secured put'}`),
      el('div', { class: 'metaline' }, `Thesis: ${p.underlyingThesisStatus}`),
    ]),
  ]));

  /* THE CYCLE RAIL.
     Fourteen internal states drive the transitions; a reader needs to know
     which of six things is happening. The rail maps them, marks where the cycle
     actually is, and shows what has been passed — a lifecycle you can only
     infer from which buttons are enabled is one you have to reverse-engineer. */
  const STAGE = [
    { id:'thesis',     label:'Thesis',      states:['candidate'] },
    { id:'put',        label:'Put open',    states:['put_planned', 'put_open'] },
    { id:'assignment', label:'Assigned',    states:['put_assigned', 'shares_held'] },
    { id:'call',       label:'Call open',   states:['call_planned', 'call_open'] },
    { id:'resolve',    label:'Closed',      states:['put_expired', 'put_closed', 'call_expired', 'call_closed', 'called_away'] },
    { id:'done',       label:'Reconciled',  states:['complete'] },
  ];
  const atIdx = STAGE.findIndex(s => s.states.includes(p.state));
  const rail = el('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:var(--md)' });
  STAGE.forEach((s, i) => {
    const done = atIdx > -1 && i < atIdx;
    const here = i === atIdx;
    rail.append(el('span', {
      class: here ? 'chip chip-ok' : 'chip',
      style: `${done ? 'opacity:.55' : ''}${here ? ';font-weight:700' : ''}`,
      title: here ? `The cycle is here. Internal state: ${p.state}.` : (done ? 'Passed.' : 'Not reached.'),
    }, `${done ? '✓ ' : ''}${s.label}`));
    if (i < STAGE.length - 1) rail.append(el('span', { class: 'metaline', style: 'opacity:.4' }, '→'));
  });
  head.append(rail);
  if (p.state === 'paused') head.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
    'This cycle is paused. The rail shows where it stopped, not where it ended.'));

  /* COLLATERAL AGAINST THE OBLIGATION.
     -----------------------------------------------------------------------
     Cash-secured is a binary gate and the figure deciding it used to be a
     percentage in a sentence, then a div bar clamped with Math.min(100, …).
     Two problems with the clamp: someone holding $10,000 against a $5,000
     obligation saw exactly the same full bar as someone holding $5,000 to the
     cent, and the obligation itself was never drawn, so "how far short" was
     only ever readable from the caption.

     It also filled with --ok-text and --dn-text, which are text tokens doing a
     mark's job — and that specific green/rust pair measures ΔE 5.3 under
     deuteranopia, below the floor that any secondary encoding can rescue.

     Now the same threshold bar the property calculator uses: a real scale, so
     surplus is visible, the obligation drawn as the line to reach, and the
     measured polarity pair. */
  if (m.requiredAssignmentCash > 0) {
    const req = m.requiredAssignmentCash;
    const have = num0(p.eligibleCashUsd);
    const bar = el('div', { class: 'render-block', style: 'margin-top:var(--md)' });
    bar.append(el('span', { class: 'eyebrow' }, 'Collateral against the obligation'));
    const barHost = el('div', { style: 'margin-top:5px' });
    bar.append(barHost);
    thresholdBar(barHost, {
      value: have, valueLabel: 'cash reserved',
      threshold: req, thresholdLabel: 'obligation',
      ccy: 'USD',
      aria: (covers, gap) => `Cash reserved ${fmtMoney(have, 'USD')} against an assignment obligation of `
        + `${fmtMoney(req, 'USD')}. `
        + (covers ? `Fully secured, with ${fmtMoney(gap, 'USD')} beyond the obligation.`
                  : `Short by ${fmtMoney(gap, 'USD')}, so the put is not cash-secured.`),
    });
    bar.append(el('p', { class: 'metaline', style: 'margin-top:5px' },
      m.cashSecured
        ? `Fully secured, with ${fmtMoney(have - req, 'USD')} beyond the obligation. The premium is not part of this and never reduces it.`
        : `Short by ${fmtMoney(Math.max(0, req - have), 'USD')}. A put is not cash-secured below 100%, and the premium received does not count toward it.`));
    head.append(bar);
  }

  /* The shape of the obligation, once there is one to draw. */
  if (num0(p.putStrike) > 0 && m.deliverableShares > 0) {
    const pay = el('div', { class: 'card', style: 'margin-top:var(--md)' });
    pay.append(cardHead('What this pays, at expiry',
      'Arithmetic on the strike, premium and multiplier you entered. Not a forecast, and no probability is implied — the horizontal axis is the underlying price, not time.'));
    const host = el('div', { style: 'margin-top:var(--md)' });
    pay.append(host);
    /* payoffChart appends its own table view — the rows are derived beside the
       marks they describe, so they cannot drift from them. The copy that used to
       be built here rendered a second table of the same figures directly beneath
       the first, and computed the payoff a second time to fill it. */
    payoffChart(host, m, p);
    pay.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The flat section is every price at or above the strike, where the premium is the entire result. '
      + 'Everything left of the strike is the shares being put to you at a price the market has left behind.'));
    wrap.append(pay);
  }

  /* Obligation and downside first. Deliberately before any premium figure. */
  const risk = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
  risk.append(el('div', { class: 'panel' }, statTile('Full assignment cash',
    m.valid ? fmtMoney(m.requiredAssignmentCash, 'USD') : '—',
    { sub: m.valid ? `${m.deliverableShares} shares at ${fmtMoney(num0(p.putStrike), 'USD')}, plus fees` : 'Enter the contract first' })));
  risk.append(el('div', { class: 'panel' }, statTile('In ringgit, with your buffer',
    m.valid ? fmtAmount(m.safeAssignmentCashMyr, 'MYR') : '—',
    { sub: `${num0(p.fxBufferPct)}% FX buffer plus conversion cost` })));
  risk.append(el('div', { class: 'panel' }, statTile('Maximum modelled downside',
    m.valid ? fmtMoney(m.putMaxLossIfZero, 'USD') : '—',
    { sub: 'If the underlying went to zero, after the premium', tone: '--dn-text' })));
  head.append(risk);
  head.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'These appear before any premium figure deliberately. The obligation is the size of the decision; the premium is the smaller number beside it.'));
  wrap.append(head);

  if (fit.gates.length) {
    const g = el('div', { class: 'card', style: 'border-left:3px solid var(--dn-text)' });
    g.append(cardHead(`Not assessable — ${fit.gates.length} gate${fit.gates.length === 1 ? '' : 's'} open`,
      'These are refusals, not deductions. A gate cannot be offset by a good score elsewhere.'));
    const ul = el('ul', { class: 'ticklist blocklist' });
    fit.gates.forEach(x => ul.append(el('li', {}, x)));
    g.append(ul);
    wrap.append(g);
  }

  /* Inputs. */
  const inputs = el('div', { class: 'card', id: 'wheel-inputs' });
  inputs.append(cardHead('The contract and your cover', 'Entered by you. This build carries no option-chain data.'));
  const nf = (k, label, step) => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', { for: `w-${k}` }, label));
    f.append(el('input', { class: 'input input-inline', id: `w-${k}`, type: 'number', step: step || 1,
      value: String(p[k] ?? 0), style: 'text-align:right',
      onchange: e => { p[k] = num0(e.target.value); saveWheel(); render(); } }));
    return f;
  };
  const cb = (k, label) => {
    const l = el('label', { class: 'checkline', style: 'gap:8px;display:flex;margin-top:6px' });
    l.append(el('input', { type: 'checkbox', checked: p[k] ? '' : null,
      onchange: e => { p[k] = e.target.checked; saveWheel(); render(); } }));
    l.append(el('span', {}, label));
    return l;
  };
  inputs.append(el('p', { class: 'eyebrow', style: 'margin:10px 0 6px' }, 'Contract'));
  [['contractMultiplier', 'Contract multiplier (shares per contract)', 1],
   ['contracts', 'Number of contracts', 1],
   ['putStrike', 'Put strike (USD)', 0.5],
   ['putCredit', 'Put credit per share (USD)', 0.01],
   ['openCommission', 'Opening commission (USD)', 1],
   ['openFees', 'Opening option fees (USD)', 0.01],
   ['assignmentFees', 'Estimated assignment fees (USD)', 1]].forEach(([k, l, s]) => inputs.append(nf(k, l, s)));
  inputs.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Your cover'));
  [['eligibleCashUsd', 'Eligible USD cash reserved', 100],
   ['eligibleShares', 'Unencumbered shares held', 1],
   ['myrPerUsd', 'MYR per USD (0 uses the site rate)', 0.01],
   ['fxBufferPct', 'FX buffer (%)', 1],
   ['calendarDaysOpen', 'Days the contract is open', 1]].forEach(([k, l, s]) => inputs.append(nf(k, l, s)));
  inputs.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Covered call, once shares are held'));
  [['callStrike', 'Call strike (USD)', 0.5],
   ['callCredit', 'Call credit per share (USD)', 0.01],
   ['callOpenCommission', 'Opening commission (USD)', 1]].forEach(([k, l, s]) => inputs.append(nf(k, l, s)));

  inputs.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Attestations'));
  inputs.append(cb('willingToOwnFull', `I am willing and able to buy all ${m.valid ? m.deliverableShares : '—'} shares at the strike, even if the market price is far below it`));
  inputs.append(cb('willingToSellAtStrike', 'I am willing to sell the entire covered quantity at the call strike'));
  inputs.append(cb('optionsApprovalAttested', 'I hold the broker options approval and US market access this would require'));
  inputs.append(cb('eventWindowClear', 'I have checked earnings, ex-dividend and corporate-action dates in the contract window'));
  inputs.append(cb('adjustedContract', 'This is an adjusted contract'));
  if (p.adjustedContract) inputs.append(cb('adjustmentVerified', 'I have verified the adjusted deliverable and multiplier from the contract terms'));
  const qt = el('div', { class: 'field', style: 'margin-top:8px' });
  qt.append(el('label', { for: 'w-qt' }, 'Quote timestamp'));
  qt.append(el('input', { class: 'input', id: 'w-qt', type: 'datetime-local', value: p.quoteTimestamp || '',
    onchange: e => { p.quoteTimestamp = e.target.value; saveWheel(); render(); } }));
  inputs.append(qt);
  const th = el('div', { class: 'field', style: 'margin-top:8px' });
  th.append(el('label', { for: 'w-th' }, 'Underlying thesis status'));
  const ths = el('select', { class: 'select', id: 'w-th',
    onchange: e => { p.underlyingThesisStatus = e.target.value; saveWheel(); render(); } });
  ['unknown', 'failed', 'review', 'pass'].forEach(v => ths.append(el('option', { value: v, selected: p.underlyingThesisStatus === v ? '' : null }, v)));
  th.append(ths);
  inputs.append(th);
  wrap.append(inputs);

  /* Cover checks — pass or refuse, never a partial score. */
  if (m.valid) {
    const cov = el('div', { class: 'card' });
    cov.append(cardHead('Collateral checks', 'Binary by design. Below 100% is a refusal, not a lower grade.'));
    const ct = el('table', { class: 'dt' });
    ct.append(el('thead', {}, el('tr', {}, ['Check', 'Required', 'You have', 'Coverage', 'Result'].map((h, i) =>
      el('th', { style: i === 0 ? 'text-align:left' : null }, h)))));
    const ctb = el('tbody');
    ctb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, 'Cash secures the put'),
      el('td', { class: 'num' }, fmtMoney(m.requiredAssignmentCash, 'USD')),
      el('td', { class: 'num' }, fmtMoney(num0(p.eligibleCashUsd), 'USD')),
      el('td', { class: 'num' }, isNum(m.cashCoveragePct) ? fmtPct(m.cashCoveragePct * 100, 1) : '—'),
      el('td', {}, m.cashSecured ? sevChip('good', 'Cash-secured') : sevChip('serious', 'Not cash-secured')),
    ]));
    ctb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, 'Shares cover the call'),
      el('td', { class: 'num' }, `${m.requiredCoveredShares}`),
      el('td', { class: 'num' }, `${num0(p.eligibleShares)}`),
      el('td', { class: 'num' }, isNum(m.shareCoveragePct) ? fmtPct(m.shareCoveragePct * 100, 1) : '—'),
      el('td', {}, m.covered ? sevChip('good', 'Covered') : sevChip('serious', 'Not covered')),
    ]));
    ct.append(ctb); cov.append(el('div', { class: 'tablewrap' }, ct));
    cov.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The premium is not deducted from the cash requirement. A broker’s treatment of unsettled premium, withdrawal rules and settlement state are not knowable here, and reserving less than the full exercise cost is how a cash-secured put stops being cash-secured.'));
    wrap.append(cov);

    /* Premium and the open obligation, side by side. */
    const prem = el('div', { class: 'card' });
    prem.append(cardHead('Premium, and what is still owed',
      'Cash received is not realised profit while the option is open.'));
    const pk = el('dl', { class: 'kv' });
    [['Premium cash received', fmtMoney(m.putPremiumCashReceived, 'USD')],
     ['Still open against it', `an obligation to buy ${m.deliverableShares} shares at ${fmtMoney(num0(p.putStrike), 'USD')}`],
     ['Period cash yield', isNum(m.putPeriodCashYield) ? fmtPct(m.putPeriodCashYield * 100, 2) : '—'],
     ['Simple annualised illustration', isNum(m.simpleAnnualisedPutYield) ? fmtPct(m.simpleAnnualisedPutYield * 100, 1) : '—'],
     ['Economic basis if assigned', isNum(m.economicShareBasis) ? fmtMoney(m.economicShareBasis, 'USD') : '—'],
     ['Break-even at expiry', isNum(m.putBreakEven) ? fmtMoney(m.putBreakEven, 'USD') : '—']]
      .forEach(([k, v]) => { pk.append(el('dt', {}, k)); pk.append(el('dd', {}, v)); });
    prem.append(pk);
    prem.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The annualised figure is a simple illustration from this single premium and holding period. It does not assume another contract can be sold on the same terms, it is not an expected annual return, and it is not comparable to a dividend yield — the denominators and the obligations are different.'));
    wrap.append(prem);

    /* Downside scenarios. */
    const sc = el('div', { class: 'card' });
    sc.append(cardHead('If the underlying falls', 'Put result at expiry, at the moves 41A.8 requires.'));
    const st = el('table', { class: 'dt' });
    st.append(el('thead', {}, el('tr', {}, ['Underlying move', 'Price at expiry', 'Put result'].map(h => el('th', {}, h)))));
    const stb = el('tbody');
    [0, -10, -20, -30, -50, -100].forEach(mv => {
      const px = num0(p.putStrike) * (1 + mv / 100);
      const s = wheelScenario(p, m, px);
      stb.append(el('tr', {}, [
        el('td', { class: 'ident' }, mv === 0 ? 'at the strike' : `${mv}%`),
        el('td', { class: 'num' }, fmtMoney(px, 'USD')),
        el('td', { class: 'num ' + signClass(s.shortPutPnl) }, fmtMoney(s.shortPutPnl, 'USD')),
      ]));
    });
    st.append(stb); sc.append(el('div', { class: 'tablewrap' }, st));
    wrap.append(sc);

    /* Covered call, including the case the premium hides. */
    if (num0(p.callStrike) > 0) {
      const cc = el('div', { class: 'card' });
      cc.append(cardHead('Covered call', 'What you receive, and what you give up.'));
      const ck = el('dl', { class: 'kv' });
      [['Premium cash received', fmtMoney(m.callPremiumCashReceived, 'USD')],
       ['Called-away value', fmtMoney(m.calledAwayGrossValue, 'USD')],
       ['Break-even', isNum(m.coveredCallBreakEven) ? fmtMoney(m.coveredCallBreakEven, 'USD') : '—'],
       ['Maximum profit on this call', isNum(m.coveredCallMaxProfit) ? fmtMoney(m.coveredCallMaxProfit, 'USD') : '—'],
       ['Maximum loss if it goes to zero', isNum(m.coveredCallMaxLoss) ? fmtMoney(m.coveredCallMaxLoss, 'USD') : '—']]
        .forEach(([k, v]) => { ck.append(el('dt', {}, k)); ck.append(el('dd', {}, v)); });
      cc.append(ck);
      if (m.callBelowBasis) cc.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px;color:var(--dn-text)' },
        `The call strike is below your economic basis. If assigned, this locks in a loss of ${fmtMoney(m.lockedInLossIfCalled, 'USD')} after the premium. The premium is not income in that case — it reduces a loss you have agreed to take.`));
      cc.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
        'Above the strike the shares are sold and further upside is not captured. American-style short calls can be assigned before expiry, and attention rises near an ex-dividend date.'));
      wrap.append(cc);
    }
  }

  /* ---- cycle state and ledger (41A.5, 41A.11, 41A.13) ------------------ */
  const legs = State.wheelLegs || [];
  const led = wheelLedger(legs);
  const st = p.state || 'candidate';
  const stDef = WHEEL_STATES.find(x => x.id === st) || WHEEL_STATES[0];
  const allowed = WHEEL_TRANSITIONS[st] || [];
  const openLeg = legs.find(l => l.status === 'open');

  const cyc = el('div', { class: 'card' });
  cyc.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'Cycle state'),
      el('h3', { class: 'h-card', style: 'margin:0' }, stDef.label),
    ]),
    el('span', { class: 'chip', style: 'margin-left:auto' },
      `${legs.length} leg${legs.length === 1 ? '' : 's'} recorded`),
  ]));
  cyc.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'Only the transitions this state permits are offered. A cycle cannot skip assignment, and a leg cannot be resolved twice.'));

  /* Where a transition needs a figure, it is asked for rather than assumed. */
  const resolveInput = (label, id) => {
    const f = el('div', { class: 'field', style: 'max-width:230px;margin-top:8px' });
    f.append(el('label', { for: id }, label));
    f.append(el('input', { class: 'input', id, type: 'number', step: '0.01', value: '0' }));
    return f;
  };
  const numFrom = (id) => num0(document.getElementById(id)?.value);
  const go = (next) => { p.state = next; saveWheel(); render(); };

  const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });

  if (allowed.includes('put_planned')) acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
    State.wheelLegs = []; saveWheelLegs(); go('put_planned');
  } }, 'Start a cycle'));

  if (allowed.includes('put_open')) acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    if (!m.valid) { toast('Enter the contract first'); return; }
    if (!m.cashSecured) { toast('Not cash-secured — the full assignment cash must be reserved'); return; }
    addWheelLeg({ phase:'put', action:'open', status:'open',
      contractLabel:`${p.symbol || 'Underlying'} ${num0(p.putStrike)}P`, strike:num0(p.putStrike),
      shares:m.deliverableShares, grossPremium:m.grossPutPremium,
      commissions:num0(p.openCommission), fees:num0(p.openFees),
      netCash:m.putPremiumCashReceived, capitalCommitted:m.requiredAssignmentCash,
      currentCloseCost:0 });
    go('put_open');
  } }, 'Record the put as opened'));

  if (st === 'put_open') {
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash),
        note:'Expired worthless. The premium becomes realised at this point and not before.' };
      saveWheelLegs(); go('put_expired');
    } }, 'It expired worthless'));
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const debit = numFrom('w-closedebit') * num0(l.shares) + numFrom('w-closecomm');
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash) - debit,
        note:'Bought back before expiry.' };
      addWheelLeg({ phase:'put', action:'close', status:'resolved', contractLabel:l.contractLabel,
        shares:l.shares, netCash:-debit, realisedPnl:null, commissions:numFrom('w-closecomm'),
        parentLegId:l.id, note:'Closing cash. The realised result sits on the opening leg it closed.' });
      go('put_closed');
    } }, 'I bought it back'));
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash),
        note:'Assigned. The premium is realised; the share position now carries the risk.' };
      addWheelLeg({ phase:'shares', action:'assign', status:'resolved',
        contractLabel:l.contractLabel, shares:l.shares,
        cashPaid: num0(l.strike) * num0(l.shares) + num0(p.assignmentFees),
        fees:num0(p.assignmentFees), capitalCommitted:num0(l.strike) * num0(l.shares),
        note:`Bought ${l.shares} shares at ${fmtMoney(num0(l.strike), 'USD')}.` });
      p.eligibleShares = num0(p.eligibleShares) + num0(l.shares);
      /* Both are frozen at assignment. The cost basis settles realised share
         P&L; the economic basis is the break-even the projections read. Storing
         only the second is how the ledger came to measure a gain against a
         number that already contained the premium it then added again. */
      p.shareCostBasisOverride = m.shareCostBasis;
      p.economicShareBasisOverride = m.economicShareBasis;
      p.phase = 'call'; saveWheel(); saveWheelLegs(); go('shares_held');
    } }, 'It was assigned'));
    cyc.append(el('div', { class: 'row row-wrap', style: 'gap:10px' }, [
      resolveInput('Close debit per share (USD)', 'w-closedebit'),
      resolveInput('Closing commission (USD)', 'w-closecomm'),
    ]));
  }

  if (allowed.includes('call_planned')) acts.append(el('button', { class: 'btn btn-sm', onclick: () => go('call_planned') }, 'Plan a covered call'));

  if (allowed.includes('call_open')) acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    if (!m.valid) { toast('Enter the contract first'); return; }
    if (!m.covered) { toast('Not covered — the full share deliverable must be held and unencumbered'); return; }
    addWheelLeg({ phase:'call', action:'open', status:'open',
      contractLabel:`${p.symbol || 'Underlying'} ${num0(p.callStrike)}C`, strike:num0(p.callStrike),
      shares:m.requiredCoveredShares, grossPremium:m.grossCallPremium,
      commissions:num0(p.callOpenCommission), fees:num0(p.callOpenFees),
      netCash:m.callPremiumCashReceived, capitalCommitted:0 });
    go('call_open');
  } }, 'Record the call as opened'));

  if (st === 'call_open') {
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash), note:'Expired. Shares retained.' };
      saveWheelLegs(); go('call_expired');
    } }, 'It expired, shares retained'));
    acts.append(el('button', { class: 'btn btn-sm', onclick: () => {
      const l = openLeg; if (!l) return;
      const i = State.wheelLegs.indexOf(l);
      /* The COST basis, not the economic one. The put premium is already
         realised as option P&L on its own leg; measuring the share gain against
         a basis that had subtracted it counted it a second time and overstated
         a completed cycle by exactly the premium. */
      const basis = isNum(p.shareCostBasisOverride) ? p.shareCostBasisOverride
                  : isNum(m.shareCostBasis) ? m.shareCostBasis : 0;
      const proceeds = num0(l.strike) * num0(l.shares);
      State.wheelLegs[i] = { ...l, status:'resolved', realisedPnl: num0(l.netCash), note:'Assigned — shares sold at the strike.' };
      addWheelLeg({ phase:'shares', action:'called_away', status:'resolved',
        contractLabel:l.contractLabel, shares:l.shares,
        shareSaleProceeds: proceeds,
        realisedSharePnl:(num0(l.strike) - basis) * num0(l.shares),
        note:`Sold ${l.shares} shares at ${fmtMoney(num0(l.strike), 'USD')} for ${fmtMoney(proceeds, 'USD')}, `
           + `against a cost basis of ${fmtMoney(basis, 'USD')}. The put premium is reported separately as option P&L, not netted into this basis.` });
      saveWheelLegs(); go('called_away');
    } }, 'Shares were called away'));
  }

  /* The roll, which can only ever be two legs. */
  if (openLeg) {
    const rollBox = el('details', { style: 'margin-top:var(--md)' });
    rollBox.append(el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'Roll this contract'));
    rollBox.append(el('p', { class: 'metaline', style: 'margin:8px 0' },
      'A roll is recorded as two transactions: closing the current contract and opening a new one. The realised result of the leg being closed is kept whatever the net cash looks like — a roll can show a credit and still have lost money, and that is exactly when the net figure alone misleads.'));
    const rg = el('div', { class: 'row row-wrap', style: 'gap:10px' });
    [['Close debit per share', 'r-debit'], ['New strike', 'r-strike'],
     ['New credit per share', 'r-credit'], ['Commissions each side', 'r-comm']]
      .forEach(([l, id]) => rg.append(resolveInput(l, id)));
    rollBox.append(rg);
    rollBox.append(el('button', { class: 'btn btn-sm', style: 'margin-top:8px', onclick: () => {
      const res = rollWheelLeg(openLeg, numFrom('r-debit'), {
        label:`${p.symbol || 'Underlying'} ${numFrom('r-strike')}${openLeg.phase === 'call' ? 'C' : 'P'}`,
        strike:numFrom('r-strike'), shares:num0(openLeg.shares),
        creditPerShare:numFrom('r-credit'),
        openCommission:numFrom('r-comm'), closeCommission:numFrom('r-comm') });
      toast(`Closed leg realised ${fmtMoney(res.realisedOnClose, 'USD')}; net roll ${fmtMoney(res.netRollCash, 'USD')}`);
      render();
    } }, 'Record the roll'));
    cyc.append(rollBox);
  }

  if (legs.length) acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
    if (!confirm('Clear this cycle and all its legs?')) return;
    State.wheelLegs = []; saveWheelLegs(); p.state = 'candidate'; p.phase = 'put';
    p.economicShareBasisOverride = null; p.shareCostBasisOverride = null; saveWheel(); render();
  } }, 'Clear the cycle'));
  cyc.append(acts);

  /* The ledger. */
  if (legs.length) {
    const lt = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
    lt.append(el('thead', {}, el('tr', {}, ['Phase', 'Action', 'Contract', 'Cash', 'Realised', 'State'].map((h, i) =>
      el('th', { style: i <= 2 || i === 5 ? 'text-align:left' : null }, h)))));
    const lb = el('tbody');
    legs.forEach(l => lb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, l.phase),
      el('td', { style: 'text-align:left' }, l.action),
      el('td', { style: 'text-align:left;white-space:normal' }, [
        el('div', {}, l.contractLabel || '—'),
        l.note ? el('div', { class: 'caption' }, l.note) : null,
      ]),
      el('td', { class: 'num ' + signClass(num0(l.netCash)) }, isNum(l.netCash) ? fmtMoney(l.netCash, 'USD') : '—'),
      el('td', { class: 'num ' + signClass(num0(l.realisedPnl)) },
        isNum(l.realisedPnl) ? fmtMoney(l.realisedPnl, 'USD')
          : el('span', { class: 'caption' }, l.status === 'open' ? 'still open' : '—')),
      el('td', { style: 'text-align:left' }, l.status === 'open'
        ? el('span', { class: 'chip chip-bronze' }, 'open obligation')
        : el('span', { class: 'caption' }, 'resolved')),
    ])));
    lt.append(lb);
    cyc.append(el('div', { class: 'tablewrap' }, lt));

    /* 41A.11 totals, kept apart. */
    const tk = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
    [['Premium cash received', fmtMoney(led.premiumCashReceived, 'USD')],
     ['Realised option profit or loss', fmtMoney(led.realisedOptionPnl, 'USD')],
     ['Open obligation', led.openLegs ? `${led.openLegs} leg still open` : 'none'],
     ['Share acquisition cash', fmtMoney(led.shareAcquisitionCash, 'USD')],
     ['Share sale proceeds', led.shareSaleProceeds ? fmtMoney(led.shareSaleProceeds, 'USD') : '—'],
     ['Realised share profit or loss', fmtMoney(led.realisedSharePnl, 'USD')],
     ['Commissions and fees', fmtMoney(led.commissions + led.fees, 'USD')],
     ['Total realised cycle result', fmtMoney(led.totalRealisedCyclePnl, 'USD')],
     /* The same total from cash movements alone. Shown beside the total rather
        than checked in private, because a reader is entitled to see that the
        two agree — and to see it immediately if they ever stop. */
     ['Same total from cash movements', led.cycleClosed ? fmtMoney(led.cashFlowRealised, 'USD') : '— (cycle still open)'],
     ['Maximum capital committed', fmtMoney(led.maxCapitalCommitted, 'USD')],
     ['Return on maximum committed', isNum(led.cycleReturnOnMaxCommitted)
        ? fmtPct(led.cycleReturnOnMaxCommitted * 100, 2) : '—']]
      .forEach(([k, v]) => { tk.append(el('dt', {}, k)); tk.append(el('dd', {}, v)); });
    cyc.append(tk);
    if (!led.reconciles) cyc.append(el('div', { class: 'note', style: 'margin-top:var(--md);border-left:3px solid var(--dn-text)' },
      el('p', { class: 'body', style: 'font-size:13px' },
        `These two totals disagree by ${fmtMoney(led.reconciliationGap, 'USD')}. On a closed cycle they cannot: `
        + `one is built from each leg's own result, the other from cash that actually moved, and both describe the `
        + `same cycle. A difference means a figure has been counted twice or not at all, so neither total should be `
        + `relied on until it is resolved. Please report this — the corrections form is linked in the footer.`)));
    if (led.openLegs) cyc.append(el('p', { class: 'metaline', style: 'margin-top:8px;color:var(--bronze)' },
      `Premium cash received includes ${led.openLegs} leg that has not resolved. That cash is in the account and the obligation is still open — it is not profit yet, and the realised line above is the one that answers how this cycle has actually gone.`));
  }
  wrap.append(cyc);

  /* Risk card, per 41A.14. */
  const rc = el('div', { class: 'card' });
  rc.append(cardHead('What can go wrong', 'Plain language, before any yield.'));
  const rl = el('ul', { class: 'ticklist' });
  ['You may have to buy the full deliverable at the strike even if the market value is far lower.',
   'If the underlying becomes worthless, the put loss approaches the whole assignment amount less the premium.',
   'A covered call caps your upside — if assigned, the shares go at the strike however high the price went.',
   'Call premium offsets only a small part of a large share-price fall.',
   'American-style short options can be assigned before expiration, including out of the money near an ex-dividend date.',
   'Earnings and corporate events can move the underlying beyond anything modelled here.',
   'Wide spreads and thin open interest can make closing or rolling materially more expensive.',
   'A USD gain can shrink or reverse in ringgit after currency moves and conversion costs.',
   'One standard contract can create a large single-stock position, because the deliverable is usually substantial.',
   'Splits, mergers and special distributions change what a contract delivers.',
   'Broker approval, collateral treatment, exercise cutoffs and tax treatment all vary.']
    .forEach(x => rl.append(el('li', {}, x)));
  rc.append(rl);
  rc.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    'Read the OCC’s Characteristics and Risks of Standardized Options before writing any option. This page is arithmetic on figures you entered — it is not a recommendation to write a put or a call, it names no best strike or expiry, and it connects to no broker.'));
  wrap.append(rc);

  const boundary = el('div', { class: 'card' });
  boundary.append(cardHead('What this is gated on',
    'Research mode only, and the gates are named rather than implied.'));
  boundary.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'No option-chain data. Every contract figure here is one you entered, and there is no licensed chain this product may redistribute.'),
    el('li', {}, 'No recommended contract. Filters and arithmetic only — “best strike” is not an output this product will produce.'),
    el('li', {}, 'No broker connection, order routing, automatic rolling or execution. Those are Compliance Gated and not built.'),
    el('li', {}, 'A roll would be recorded as a close plus a separate new opening, so a net credit could never conceal the realised result of the leg being closed.'),
  ]));
  wrap.append(boundary);
  return wrap;
};

