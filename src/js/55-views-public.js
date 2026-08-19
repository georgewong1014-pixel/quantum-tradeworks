/* ==========================================================================
   PUBLIC HOMEPAGE

   Separate from the dashboard on purpose. The previous root behaved like an
   existing user's workspace — watchlist, alerts, research queue — which tells
   a first-time visitor nothing about what the product is or why they would
   use it. The dashboard now lives at /app and this is what the domain root
   serves.
   ========================================================================== */
function taskCard(title, body, path, cta) {
  const card = el('a', { class: 'card task-card', href: href(path),
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate(path); } });
  card.append(el('h3', { class: 'h-card' }, title));
  card.append(el('p', { class: 'metaline', style: 'margin:6px 0 10px' }, body));
  card.append(el('span', { class: 'task-cta' }, cta));
  return card;
}

VIEWS.marketing = () => {
  const wrap = el('div', { class: 'stack-lg' });

  /* -- 1. hero ---------------------------------------------------------- */
  const hero = el('section', { class: 'hero' });
  const grid = el('div', { class: 'hero-grid' });

  const left = el('div');
  left.append(el('h1', { class: 'hero-h1' },
    'Know what a Sarawak property does to your cash, and what a filed company actually reports.'));
  left.append(el('p', { class: 'hero-lede' },
    'Every figure shows its formula, its source and its date — and the product says so when it cannot work one out, '
    + 'rather than filling the gap.'));
  const heroCtas = el('div', { class: 'row row-wrap', style: 'gap:10px;margin-top:var(--lg)' });
  /* Primary was "Research a Bursa company", which opens the one dataset here
     that is entirely illustrative — the strongest call to action pointing at
     the weakest evidence. The property calculator needs no market data to be
     completely honest, and it is the surface that answers a decision. */
  heroCtas.append(el('a', { class: 'btn btn-primary', href: href('/property/calculator'),
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/calculator'); } },
    'Check a Sarawak property'));
  heroCtas.append(el('a', { class: 'btn', href: href('/research'),
    onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/research'); } },
    'Research an SEC-filed company'));
  left.append(heroCtas);
  left.append(el('p', { class: 'metaline', style: 'margin-top:var(--lg);max-width:56ch' },
    'No stock tips, no rankings, no recommendations. '
    + 'Malaysian company financials here are illustrative — they are labelled on every page that shows them.'));
  grid.append(left);

  /* THE PROOF, COMPUTED RATHER THAN DRAWN.
     Each card runs the real engine on a fixture and shows what comes back. No
     figure below is written by hand, and each says where it came from. */
  const proof = el('div', { class: 'hero-proof' });
  const proofCard = (title, source, rows, note) => {
    const c = el('div', { class: 'proof-card' });
    c.append(el('div', { class: 'proof-hd' }, [
      el('span', { style: 'font-size:13px;font-weight:700' }, title),
      el('span', { class: 'proof-src' }, source),
    ]));
    /* Two passes, not three wrappers: every label, then every value. Siblings
       in one grid line up; nested wrappers do not when one of them wraps. */
    const r = el('div', { class: 'proof-row' });
    rows.forEach(([k]) => r.append(el('span', { class: 'pk' }, k)));
    rows.forEach(([, v, tone]) => r.append(el('span', { class: 'pv', style: tone ? `color:var(${tone})` : null }, v)));
    c.append(r);
    if (note) c.append(el('p', { class: 'proof-src', style: 'margin-top:8px' }, note));
    return c;
  };

  /* 1 — the property engine on its own default deal. */
  const pm = dealModel(State.deal);
  proof.append(proofCard('Sarawak property', 'your inputs', [
    ['Cash to complete', fmtAmount(pm.transactionCash, 'MYR')],
    ['Safe cash', fmtAmount(pm.safeCashRequired, 'MYR')],
    ['Monthly', isNum(pm.cashflowMonthly) ? fmtAmount(pm.cashflowMonthly, 'MYR') : '—',
      isNum(pm.cashflowMonthly) && pm.cashflowMonthly < 0 ? '--dn-text' : null],
  ], 'Computed live from the calculator’s current inputs, which start as illustrative defaults until you replace them.'));

  /* 2 — the Wheel engine on a worked contract. */
  const wm = wheelMath({ ...State.wheel, contractMultiplier: 100, contracts: 1,
    putStrike: 50, putCredit: 1.10, openCommission: 1, assignmentFees: 0,
    eligibleCashUsd: 5000, myrPerUsd: 4.42, fxBufferPct: 5, calendarDaysOpen: 30 });
  /* fmtAmount, not fmtMoney, so the three cards share one scale. Beside
     "RM95.3k" a "$5000.00" reads as a different kind of number. */
  proof.append(proofCard('US options Cash Wheel', 'figures you enter', [
    ['Assignment cash', fmtAmount(wm.requiredAssignmentCash, 'USD')],
    ['In ringgit', fmtAmount(wm.safeAssignmentCashMyr, 'MYR')],
    ['Worst case', fmtAmount(wm.putMaxLossIfZero, 'USD'), '--dn-text'],
  ], 'One cash-secured put at a $50 strike. The obligation is shown before any premium, because the obligation is the decision.'));

  /* 3 — the Trading Index on the specification's published example. */
  const qr = qttiRun(qttiWorkedExample());
  proof.append(proofCard('QT Trading Index', 'worked example §14', [
    ['Trend regime', String(qr.regime)],
    ['Tranche ready', String(qr.tranche), '--dn-text'],
    ['Screenshot conf.', String(qr.confidence)],
  ], `Three outputs, never blended. This example is blocked on ${qr.gates.length} conditions and the page names every one.`));
  grid.append(proof);

  hero.append(grid);
  wrap.append(hero);
  const wl = waitlistCard();
  if (wl) wrap.append(wl);

  /* -- 1b. start with a goal --------------------------------------------
     Directly beneath the hero, above the task grid. The grid below is five
     links, which serves a reader who already knows which tool they want; this
     serves the one who has a question and does not know that the answer lives
     behind a nav item called Discover. */
  const startCard = el('section', { class: 'card', style: 'border-left:3px solid var(--brand)' });
  startCard.append(el('div', { class: 'row row-wrap', style: 'gap:var(--md);align-items:center' }, [
    el('div', { style: 'flex:1 1 320px;min-width:0' }, [
      el('h2', { class: 'h-card' }, 'Not sure where to start?'),
      el('p', { class: 'body', style: 'font-size:14px;margin-top:6px' },
        'Answer up to three questions and the right tool opens with your answers already filled in. '
        + 'It routes a workflow — it is not a suitability assessment and it recommends nothing.'),
    ]),
    el('a', { class: 'btn btn-primary', style: 'flex:0 0 auto', href: href('/start'),
      onclick: (e) => { e.preventDefault(); navigate('/start'); } }, 'Start with my goal'),
  ]));
  wrap.append(startCard);

  /* -- 2. choose what you want to do ------------------------------------ */
  const tasks = el('section');
  tasks.append(el('h2', { class: 'h-section' }, 'Choose what you want to do'));
  const tgrid = el('div', { class: 'grid grid-tasks', style: 'margin-top:var(--md)' });
  tgrid.append(taskCard('Find companies worth researching',
    'Screen on quality, financial strength and valuation. Every filter states what it measures.',
    '/discover/screener', 'Open the screener'));
  tgrid.append(taskCard('Check whether a dividend is sustainable',
    'Cover the distribution against earnings and free cash flow, and see how much headroom is left.',
    '/discover/screener', 'Check cover'));
  tgrid.append(taskCard('Compare similar businesses',
    'Compare on the measures that fit the business model rather than one generic table.',
    '/compare', 'Compare companies'));
  tgrid.append(taskCard('Calculate a property’s real cash flow',
    'Instalment, maintenance, vacancy and exit costs — down to the monthly number.',
    '/property/calculator', 'Open the calculator'));
  tgrid.append(taskCard('Monitor changes to your investment case',
    'Write down what must stay true, and be told when the evidence moves against it.',
    '/my/theses', 'Build a case'));
  tasks.append(tgrid);
  wrap.append(tasks);

  /* -- 3. interactive demonstration ------------------------------------- */
  const demo = el('section');
  demo.append(el('h2', { class: 'h-section' }, 'See what a report actually contains'));
  demo.append(el('p', { class: 'body-lg' }, 'Pick one. Five outputs, then the full report.'));
  const picks = [
    { id: 'MAYBANK', label: 'Maybank' }, { id: 'PBBANK', label: 'Public Bank' },
    { id: 'TENAGA', label: 'Tenaga' }, { id: 'AAPL-SEC', label: 'Apple' },
  ].filter(p => BY_ID.has(p.id));
  State.demoPick = picks.some(p => p.id === State.demoPick) ? State.demoPick : (picks[0]?.id || null);

  const seg = el('div', { class: 'segmented', style: 'margin:var(--md) 0' });
  picks.forEach(p => seg.append(el('button', {
    'aria-selected': State.demoPick === p.id ? 'true' : 'false',
    onclick: () => { State.demoPick = p.id; render(); } }, p.label)));
  seg.append(el('button', { 'aria-selected': State.demoPick === 'property' ? 'true' : 'false',
    onclick: () => { State.demoPick = 'property'; render(); } }, 'A Kuching property'));
  demo.append(seg);

  const panel = el('div', { class: 'card' });
  if (State.demoPick === 'property') {
    panel.append(el('div', { class: 'grid grid-5' }, [
      statTile('Monthly cash flow', '−RM840', { sub: 'after instalment, maintenance and vacancy' }),
      statTile('Break-even rent', 'RM2,810', { sub: 'rent needed to cover every cost' }),
      statTile('Cash required upfront', 'RM91,000', { sub: 'deposit, fees, renovation' }),
      statTile('Gross yield', '4.15%', { sub: 'RM1,900 rent on RM550,000' }),
      statTile('Evidence quality', 'Illustrative', { sub: 'user-supplied inputs, no verified comparables' }),
    ]));
    panel.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
      'An example, not a listing. Enter your own numbers to get your own answer.'));
  } else if (State.demoPick && BY_ID.has(State.demoPick)) {
    const r = BY_ID.get(State.demoPick);
    panel.append(el('div', { class: 'grid grid-5' }, [
      statTile('Business quality', `${r.scores.quality.score}/100`, { sub: 'margin durability, returns, consistency' }),
      statTile('Financial strength', `${r.scores.strength.score}/100`, { sub: 'leverage, cover, liquidity' }),
      statTile('Valuation range', isNum(r.val?.vals?.bear) && isNum(r.val?.vals?.bull)
        ? `${fmtMoney(r.val.vals.bear, r.c.ccy)} – ${fmtMoney(r.val.vals.bull, r.c.ccy)}` : 'not computable',
        { sub: r.val?.pack?.name || '—' }),
      statTile('Principal risks', String((r.flags || []).length || 'none flagged'),
        { sub: 'raised from the reported figures' }),
      statTile('Data completeness', `${r.m.coverage}%`, { sub: 'computable ÷ applicable metrics' }),
    ]));
    panel.append(el('div', { class: 'row', style: 'margin-top:var(--md)' },
      el('a', { class: 'btn btn-primary', href: href(companyPath(r.c)),
        onclick: (e) => { e.preventDefault(); openResearch(r.c.id); } }, 'Open the complete research report')));
  }
  demo.append(panel);
  wrap.append(demo);

  /* -- 4. property ------------------------------------------------------ */
  const prop = el('section');
  prop.append(el('h2', { class: 'h-section' }, 'Sarawak property deal check'));
  const cityGrid = el('div', { class: 'grid grid-4', style: 'margin-top:var(--md)' });
  ['Kuching', 'Sibu', 'Miri', 'Bintulu'].forEach(city => {
    const c = el('a', { class: 'card task-card', href: href('/property/calculator'),
      href: href('/property/calculator') + '?city=' + city.toLowerCase(),
      onclick: (e) => { e.preventDefault(); navigate('/property/calculator?city=' + city.toLowerCase()); } });
    c.append(el('h3', { class: 'h-card' }, city));
    c.append(el('span', { class: 'task-cta' }, 'Model a purchase here'));
    cityGrid.append(c);
  });
  prop.append(cityGrid);
  const example = el('div', { class: 'card', style: 'margin-top:var(--md)' });
  example.append(el('div', { class: 'grid grid-5' }, [
    statTile('Purchase price', 'RM550,000'),
    statTile('Expected rent', 'RM1,900', { sub: 'per month' }),
    statTile('Monthly cash flow', '−RM840', { tone: '--dn-text' }),
    statTile('Break-even rent', 'RM2,810'),
    statTile('Cash required upfront', 'RM91,000'),
  ]));
  example.append(el('div', { class: 'row', style: 'margin-top:var(--md)' },
    el('a', { class: 'btn btn-primary', href: href('/property/calculator'),
      onclick: (e) => { e.preventDefault(); navigate('/property/calculator'); } }, 'Calculate my property')));
  prop.append(example);
  wrap.append(prop);

  /* -- 5. how it works -------------------------------------------------- */
  const how = el('section');
  how.append(el('h2', { class: 'h-section' }, 'How it works'));
  const steps = el('div', { class: 'grid grid-3', style: 'margin-top:var(--md)' });
  [['1', 'Select a company or enter a property.'],
   ['2', 'Review the evidence and assumptions.'],
   ['3', 'Save what you believe and monitor what changes.']].forEach(([n, t]) => {
    const s = el('div', { class: 'card' });
    s.append(el('div', { class: 'step-n' }, n));
    s.append(el('p', { style: 'margin-top:8px' }, t));
    steps.append(s);
  });
  how.append(steps);
  wrap.append(how);

  /* -- 6. trust --------------------------------------------------------- */
  const trust = el('section');
  trust.append(el('h2', { class: 'h-section' }, 'What you can check for yourself'));
  const tg = el('div', { class: 'grid grid-3', style: 'margin-top:var(--md)' });
  [['Data sources', 'Every provider, its coverage, its delay and its licence status.', '/data-sources'],
   ['Methodology', 'Metric definitions, scoring weights, peer grouping and model routing.', '/methodology'],
   ['Corrections log', 'What was wrong, what it is now, and whether anyone was told.', '/corrections'],
   ['Model version', `Currently ${MODEL_VERSION}. Saved screens record the version that produced them.`, '/methodology'],
   /* Promised a legal entity, a location and a contact, then linked to a page
      whose answer to all three is "not yet established". A card should not
      advertise what the page it opens says does not exist. */
   ['Who runs this', 'No entity is registered yet, and this page says so plainly.', '/about'],
   ['Conflicts of interest', 'What we are and are not paid for, and what can never change a score.', '/about'],
  ].forEach(([t, b, p]) => tg.append(taskCard(t, b, p, 'Read')));
  trust.append(tg);
  trust.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    `Data as of ${AS_OF}. This date does not advance on its own — nothing here is fed by a live source.`));
  wrap.append(trust);

  /* -- 7. pricing ------------------------------------------------------- */
  const pricing = el('section');
  pricing.append(el('h2', { class: 'h-section' }, 'Pricing'));
  const pg = el('div', { class: 'grid grid-3', style: 'margin-top:var(--md)' });
  [PRICING.free, PRICING.founding, PRICING.property].forEach(t => {
    const card = el('div', { class: 'card' });
    card.append(el('h3', { class: 'h-card' }, t.name));
    card.append(el('div', { style: 'font-size:24px;font-weight:700;margin:4px 0 2px' }, t.price));
    if (t.period) card.append(el('div', { class: 'metaline' }, t.period));
    card.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' }, t.line));
    pg.append(card);
  });
  pricing.append(pg);
  pricing.append(el('div', { class: 'row', style: 'margin-top:var(--md);gap:10px' }, [
    el('a', { class: 'btn', href: href('/pricing'), onclick: (e) => { e.preventDefault(); navigate('/pricing'); } }, 'Compare plans'),
  ]));
  pricing.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    'No payment is processed anywhere in this build. Billing, trials, renewal and cancellation are not implemented — see Plans for what that means.'));
  wrap.append(pricing);

  return wrap;
};

/* ==========================================================================
   START WITH MY GOAL — ROUTING, NOT ADVICE.
   ==========================================================================
   The homepage already had a task grid, and it was five links. A link grid
   answers "where is the thing" for someone who already knows which thing they
   want. It does nothing for the reader this product actually has to serve: one
   who has a question about a property or a contract and no idea that the
   answer lives behind a nav item called Discover.

   So: pick a goal, answer at most three more questions, and land in the right
   tool with what you said already filled in.

   THE LINE THIS MUST NOT CROSS. This routes a workflow. It does not ask what
   the reader wants to achieve financially, does not score their answers, and
   does not select an instrument for them — the questions only decide which
   tool opens and which fields are pre-set, and every one of them is a fact
   about the task rather than about the person. "Which city" is routing.
   "What return do you need" would not be, and is not asked.

   Both paths are named. "Use my own figures" and "Open a worked example" are
   different intentions and the second must never be mistaken for the first, so
   the destination keeps saying which it is — the property review queue, the
   Wheel's illustrative banner, the Trading Index coverage notes. */
/* Answers persist, the chosen goal does not. Returning to a page called "Start"
   and landing halfway through a form you filled in last week is a small
   surprise with no upside — the menu is the predictable entry. Re-picking the
   goal restores everything you said, which is what "Back preserves answers"
   actually asks for. */
State.launcher = { goal: null, a: store.read('launcherAnswers', {}) };
const saveLauncher = () => store.write('launcherAnswers', State.launcher.a);

const LAUNCH_GOALS = [
  { id:'property', label:'Check a Sarawak property',
    blurb:'What it costs to complete, what it costs to hold, and what would have to be true for it to pay for itself.',
    tool:'Property deal calculator' },
  { id:'company', label:'Research a US company',
    blurb:'Audited SEC filings, with every metric showing its formula, its period and what could not be computed.',
    tool:'Company report' },
  { id:'wheel', label:'Model options cash flow',
    blurb:'A cash-secured put and covered call cycle, from a contract you enter. No chain data is connected.',
    tool:'Options Cash Wheel' },
  { id:'trading', label:'Assess trend and first tranche',
    blurb:'A multi-timeframe reading and a test of your own entry rules, from chart evidence you record.',
    tool:'QT Trading Index' },
  { id:'screen', label:'Screen a market',
    blurb:'Narrow the universe on quality, financial risk or valuation evidence before reading anything in depth.',
    tool:'Stock screener' },
];

VIEWS.launcher = () => {
  const L = State.launcher;
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Start here'),
    el('h1', {}, 'Start with your goal'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Five things this product does. Pick one and it opens the right tool with what you tell it already filled in. '
      + 'These questions route a workflow — they are not a suitability assessment and nothing here recommends an investment.'),
  ])));

  /* ---- step 1: the goal ---- */
  if (!L.goal) {
    const grid = el('div', { class: 'grid g-2' });
    LAUNCH_GOALS.forEach(g => {
      const c = el('button', { class: 'card', style: 'text-align:left;cursor:pointer;border:1px solid var(--line);width:100%',
        onclick: () => { L.goal = g.id; saveLauncher(); render(); } });
      c.append(el('h3', { class: 'h-card' }, g.label));
      c.append(el('p', { class: 'body', style: 'font-size:14px;margin-top:6px' }, g.blurb));
      c.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, `Opens the ${g.tool}`));
      grid.append(c);
    });
    wrap.append(grid);

    /* THE THIRTY-SECOND PATH, offered beside the five goals rather than instead
       of them. Somebody who has not decided which of the five they want is
       exactly the person who should be allowed to look at a filled-in one
       first — and the honest empty states this product is built on are the
       reason that person otherwise sees nothing at all. */
    const demo = el('div', { class: 'card', style: 'margin-top:var(--md)' });
    demo.append(cardHead(hasWorkedExample() ? 'The worked example is loaded' : 'Or look at a filled-in one first',
      WORKED_EXAMPLE_NOTE));
    demo.append(workedExampleControls());
    wrap.append(demo);
    return wrap;
  }

  const goal = LAUNCH_GOALS.find(g => g.id === L.goal);
  const a = (L.a[L.goal] = L.a[L.goal] || {});
  const set = (k, v) => { a[k] = v; saveLauncher(); render(); };

  const card = el('div', { class: 'card' });
  card.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
    el('h2', { class: 'h-card' }, goal.label),
    /* Back clears the goal and NOT the answers — a reader who changes their
       mind and comes back should not retype what they already told us. */
    el('button', { class: 'btn btn-quiet btn-sm', style: 'margin-left:auto',
      onclick: () => { L.goal = null; saveLauncher(); render(); } }, 'Back'),
  ]));

  const q = (label, hint) => {
    card.append(el('h3', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, label));
    if (hint) card.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' }, hint));
  };
  const seg = (k, opts, dflt) => {
    const cur = a[k] ?? dflt;
    card.append(el('div', { class: 'segmented', style: 'flex-wrap:wrap' }, opts.map(([v, lab]) =>
      el('button', { 'aria-selected': cur === v ? 'true' : 'false', onclick: () => set(k, v) }, lab))));
    return cur;
  };

  let open = null;

  if (L.goal === 'property') {
    q('Which town or city?', 'Sample projects are held for some of these and not others. The tool says which, and never borrows a comparable from a different market.');
    const city = seg('city', SARAWAK_CITIES.map(c => [c.id, c.name]), 'kuching');
    q('Start from what?');
    const mode = seg('mode', [['own', 'My own figures'], ['example', 'A worked example']], 'example');
    open = () => {
      State.deal = { ...PROPERTY_DEFAULT_DEAL, city,
        district: (SARAWAK_CITIES.find(c => c.id === city)?.districts || [''])[0],
        projectId: (projectsForCity(city)[0] || {}).id || customProjectId(city),
        touched: {}, evidence: { ...PROPERTY_DEFAULT_DEAL.evidence },
        checks: { ...PROPERTY_DEFAULT_DEAL.checks } };
      /* "My own figures" does not blank the model — it cannot, or nothing
         computes. It opens the review queue instead, which is the honest
         version of the same intention: here is every figure that is still
         ours, replace them. */
      saveDeal();
      navigate('/property/calculator');
      if (mode === 'own') setTimeout(() => {
        const det = [...document.querySelectorAll('details')]
          .find(x => /Review \d+ sample input/.test(x.querySelector('summary')?.textContent || ''));
        if (det) { det.open = true; det.scrollIntoView({ block: 'center' }); }
      }, 400);
    };
  }

  if (L.goal === 'company') {
    q('Which company?', 'Only companies with audited statements filed with the SEC are listed here. Bursa figures in this build are illustrative and are not offered as a research destination.');
    const filed = (typeof U !== 'undefined' ? U : []).filter(r => r.c.real && r.c.mkt === 'US')
      .sort((x, y) => String(x.c.name).localeCompare(String(y.c.name)));
    if (!filed.length) {
      card.append(el('p', { class: 'body' }, `${COVERAGE_PENDING} — the audited set is still loading.`));
    } else {
      const cur = a.company || filed[0].c.id;
      const sel = el('select', { class: 'select', 'aria-label': 'Company',
        onchange: e => set('company', e.target.value) });
      filed.forEach(r => sel.append(el('option', { value: r.c.id, selected: r.c.id === cur ? '' : null },
        `${r.c.tk} — ${r.c.name}`)));
      card.append(sel);
      open = () => {
        const row = BY_ID.get(cur) || filed[0];
        navigate(companyPath(row.c));
      };
    }
  }

  if (L.goal === 'wheel') {
    q('Start from what?', 'This build carries no option-chain data, so a contract is entered by hand either way.');
    const mode = seg('mode', [['own', 'My own contract'], ['example', 'A worked contract']], 'example');
    open = () => {
      State.wheel = mode === 'example'
        ? { ...State.wheel, ...WHEEL_WORKED_EXAMPLE, isWorkedExample: true }
        : { ...State.wheel, ...WHEEL_BLANK_CONTRACT, isWorkedExample: false };
      saveWheel();
      navigate('/wheel');
    };
  }

  if (L.goal === 'trading') {
    q('Start from what?', 'Phase 1 reads nothing from your screenshot — every panel is transcribed by you.');
    const mode = seg('mode', [['own', 'My own chart evidence'], ['example', 'The §14 worked example']], 'example');
    open = () => {
      if (mode === 'example') State.qtti = qttiWorkedExample();
      else State.qtti = { ...State.qtti, symbol:'',
        timeframes:{ daily:qttiBlankPanel(), weekly:qttiBlankPanel(), monthly:qttiBlankPanel() },
        confidence:{ metadata:null, panels:null, indicators:null, legibility:null, recency:null },
        entryLocation:'unknown', identityConsistent:false, capturedAt:'', triggerComplete:false };
      saveQtti();
      navigate('/trading-index');
    };
  }

  if (L.goal === 'screen') {
    q('Which market?');
    const universe = seg('universe', [['all', 'All markets'], ['US', 'US listings'], ['MY', 'Bursa']], 'all');
    q('Which measures?', 'A preset chooses which columns are on screen. It does not filter, sort or rank anything.');
    const preset = seg('preset', COL_PRESETS.map(p => [p.id, p.label]), 'essentials');
    open = () => {
      const p = COL_PRESETS.find(x => x.id === preset) || COL_PRESETS[0];
      State.screen = { ...blankScreen(), universe, cols: [...p.cols] };
      store.write('screen', State.screen);
      State.appliedTemplate = null;
      navigate('/discover/screener');
    };
  }

  if (open) {
    card.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--xl)' }, [
      el('button', { class: 'btn btn-primary', onclick: open }, `Open the ${goal.tool.toLowerCase()}`),
    ]));
    card.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The tool will say which of its figures are still samples and which are yours.'));
  }
  wrap.append(card);
  return wrap;
};

/* ==========================================================================
   WATCHLISTS — its own destination, not a panel on a dashboard.
   ========================================================================== */
VIEWS.userdata = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  wrap.append(mySubnav('userdata'));
  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Your data'),
    el('h1', {}, 'Bring your own prices'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'This site ships no market prices, because none of the prices it could ship are licensed for it to redistribute. Yours are a different question.'),
  ]));
  wrap.append(hd);

  /* Why this exists, said once and without hedging. */
  const why = el('div', { class: 'card' });
  why.append(cardHead('What happens to what you paste',
    'It stays in this browser.'));
  why.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'Held in this browser’s local storage, on this device. It is not uploaded, not sent to a server, and not visible to anyone else — this build has no accounts and no backend to send it to.'),
    el('li', {}, 'Every figure derived from it is labelled as yours rather than treated as a source of record. A price you supplied and a licensed close are not the same evidence.'),
    el('li', {}, 'Clearing your browser data removes it. There is no copy anywhere else, so export it if it took work to assemble.'),
    el('li', {}, 'Whatever you paste remains under whatever terms you obtained it. This tool does not acquire it, republish it, or give you a right to share it — a broker export is still your broker’s data.'),
  ]));
  wrap.append(why);

  /* ---------- backup, restore and saved work ----------
     This page already explained that everything lives in this browser and dies
     with it, and then offered no way to act on that. A warning without a remedy
     is just an apology in advance. */
  const bk = el('div', { class: 'card' });
  bk.append(cardHead('Back up everything in this browser',
    'One file with every calculation, saved deal, watchlist, screen and correction case this browser holds. There is no server copy, so this file is the only copy.'));

  const bkRow = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
  bkRow.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
    const payload = backupPayload();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob),
      download: `quantum-tradeworks-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    toast(`Downloaded ${payload.keys} stored item${payload.keys === 1 ? '' : 's'}`);
  } }, 'Download a backup'));

  /* A hidden input behind a button, because the native file control cannot be
     styled and reads as a browser artefact rather than part of the page. */
  const fileIn = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const res = restoreBackup(await file.text());
      e.target.value = '';
      if (!res.ok) { toast(res.error); return; }
      toast(`Restored ${res.restored} item${res.restored === 1 ? '' : 's'} — reloading`);
      /* A reload rather than a re-render: State was populated from storage at
         boot, and half the app would still be holding the pre-restore values. */
      setTimeout(() => location.reload(), 700);
    } });
  bkRow.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => fileIn.click() },
    'Restore from a backup'));
  bkRow.append(fileIn);
  bk.append(bkRow);
  bk.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Restoring overwrites what this browser currently holds for any key present in the file, then reloads. '
    + 'Nothing is merged, because a half-merged calculation is a figure nobody entered.'));
  wrap.append(bk);

  /* Saved records, listed once in a place that is about storage. */
  const recs = loadWork();
  const sw = el('div', { class: 'card' });
  sw.append(cardHead(`Saved work — ${recs.length}`,
    recs.length ? 'Named snapshots you took inside the tools. Each carries the model version and data date it was taken against.'
                : 'Nothing saved yet. The Property, Cash Wheel and Trading Index tools each have a Save control.'));
  if (recs.length) {
    const tw2 = el('div', { class: 'tablewrap' });
    const t2 = el('table', { class: 'dt' });
    t2.append(el('thead', {}, el('tr', {}, ['Name', 'Kind', 'Saved', 'Model version', ''].map((h, i) =>
      el('th', { style: i ? null : 'text-align:left' }, h)))));
    const tb2 = el('tbody');
    recs.forEach(r => {
      tb2.append(el('tr', {}, [
        el('td', { style: 'text-align:left' }, r.name),
        el('td', {}, WORK_KINDS[r.kind]?.label || r.kind),
        el('td', {}, r.savedAt),
        el('td', { class: 'metaline' }, `${r.modelVersion} · data ${r.asOf} · ${r.editor}`),
        el('td', {}, el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
          if (!confirm(`Delete "${r.name}"?`)) return;
          deleteWork(r.id); render(); toast('Deleted');
        } }, 'Delete')),
      ]));
    });
    t2.append(tb2);
    tw2.append(t2);
    sw.append(tw2);
  }
  wrap.append(sw);

  /* ---------- what is loaded now ---------- */
  const have = userSeriesCount();
  const status = el('div', { class: 'card' });
  status.append(cardHead('Loaded now',
    have ? 'Every view that uses price history is reading these.' : 'Nothing yet.'));
  if (have) {
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Symbol', 'Company', 'Closes', 'From', 'To', ''].map((h, i) =>
      el('th', { style: i === 1 ? 'text-align:left' : null }, h)))));
    const tb = el('tbody');
    const reg = instruments?.instruments || [];
    Object.entries(userData.series).sort().forEach(([sym, series]) => {
      const dates = Object.keys(series).sort();
      const known = reg.find(x => x.symbol === sym);
      tb.append(el('tr', {}, [
        el('td', { class: 'ident' }, sym),
        el('td', { style: 'text-align:left;white-space:normal' },
          known ? known.name : el('span', { class: 'caption' }, 'not in the instrument registry')),
        el('td', { class: 'num' }, String(dates.length)),
        el('td', { class: 'num' }, dates[0] || '—'),
        el('td', { class: 'num' }, dates[dates.length - 1] || '—'),
        el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          delete userData.series[sym]; saveUserData();
          toast(`${sym} removed`); location.reload();
        } }, 'Remove')),
      ]));
    });
    t.append(tb); tw.append(t); status.append(tw);
    status.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
      `${userCloseCount().toLocaleString()} closes across ${have} instrument${have === 1 ? '' : 's'}. A trend indicator appears once its own minimum history is met — 20 closes for the 20-day average, 200 for the 200-day, 252 for the 52-week range — and says how many more it needs until then.`));
    const exp = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:10px' });
    exp.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      const blob = new Blob([JSON.stringify(userData, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'quantum-tradeworks-my-data.json' });
      document.body.append(a); a.click(); a.remove();
    } }, 'Export everything'));
    exp.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      if (!confirm('Remove every price you have added? This cannot be undone and there is no copy on any server.')) return;
      userData.series = {}; saveUserData(); location.reload();
    } }, 'Remove all'));
    status.append(exp);
  } else {
    status.append(el('p', { class: 'body', style: 'font-size:13px' },
      'Without prices, anything price-derived is shown as unavailable rather than estimated: market capitalisation, multiples, dividend yield, the difference to a model estimate, and every trend indicator. The statements, scorecards and risk flags all work without them.'));
  }
  wrap.append(status);

  /* ---------- everything, not only the prices ----------
     The export above covers pasted price series. Everything else a reader makes
     — portfolios, investment cases, watchlists, property comparables,
     correction cases, both workspaces — was unreachable, so the work that takes
     the longest was the work most easily lost. */
  const all = el('div', { class: 'card' });
  all.append(cardHead('Everything you have made',
    'All of it is held in this browser and nowhere else. This is the only copy that survives a cleared browser, a second machine, or private mode closing.'));

  const held = PORTABLE_KEYS.map(({ k, label }) => {
    const v = store.read(k, null);
    const n = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? 1 : 0);
    return { k, label, n, has: v !== null && v !== undefined && n > 0 };
  });
  const kv = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
  held.filter(x => x.has).forEach(x => {
    kv.append(el('dt', {}, x.label));
    kv.append(el('dd', {}, Array.isArray(store.read(x.k, null)) ? `${x.n} record${x.n === 1 ? '' : 's'}` : 'saved'));
  });
  if (held.some(x => x.has)) all.append(kv);
  else all.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'Nothing saved yet. Anything you build — a property model, an investment case, a comparable — appears here and can be carried to another browser.'));

  all.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' }, [
    el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
      const doc = exportEverything();
      if (!Object.keys(doc.data).length) { toast('Nothing saved yet'); return; }
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob),
        download: `quantum-tradeworks-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } }, 'Export everything'),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openRestoreDrawer() }, 'Restore from a file'),
  ]));
  all.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'The file never leaves your machine unless you send it. It is plain JSON — you can read it, and so can anyone you give it to.'));
  wrap.append(all);

  /* ---------- paste ---------- */
  const add = el('div', { class: 'card' });
  add.append(cardHead('Paste closes',
    'One row per day. A column copied out of a spreadsheet or a broker export works as it is.'));

  const symField = el('div', { class: 'field', style: 'max-width:280px' });
  symField.append(el('label', { for: 'ud-sym' }, 'Symbol, if the rows do not carry one'));
  const symInput = el('input', { class: 'input', id: 'ud-sym', placeholder: '2852, 1155, AAPL…' });
  symField.append(symInput);
  add.append(symField);

  const ta = el('textarea', { class: 'input', rows: '9', style: 'margin-top:10px;width:100%;font-family:var(--mono, monospace);font-size:12px',
    'aria-label': 'Paste closes',
    placeholder: '2026-08-06,7.93\n2026-08-05,7.88\n2026-08-04,7.90\n\n…or with the symbol on each row:\n2852,2026-08-06,0.995' });
  add.append(ta);

  const report = el('div', { style: 'margin-top:10px' });
  add.append(report);

  const actions = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:10px' });
  actions.append(el('button', { class: 'btn btn-primary', onclick: () => {
    const res = parseCloses(ta.value, symInput.value.trim().toUpperCase());
    report.replaceChildren();
    if (!res.accepted && !res.rejected.length) { report.append(el('p', { class: 'metaline' }, 'Nothing to read.')); return; }

    if (res.accepted) {
      for (const [sym, series] of Object.entries(res.series)) {
        userData.series[sym] = { ...(userData.series[sym] || {}), ...series };
      }
      userData.added = new Date().toISOString().slice(0, 10);
      saveUserData();
    }

    /* Both halves reported, always. A partial import that only announces its
       successes is how a reader ends up trusting a series with holes in it. */
    const summary = el('p', { class: 'body', style: 'font-size:13px' },
      `${res.accepted} close${res.accepted === 1 ? '' : 's'} read across ${res.symbols.length} symbol${res.symbols.length === 1 ? '' : 's'}`
      + (res.rejected.length ? `, and ${res.rejected.length} row${res.rejected.length === 1 ? '' : 's'} could not be read.` : '.'));
    report.append(summary);

    if (res.rejected.length) {
      const det = el('details', { style: 'margin-top:8px' });
      det.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
        `Show the ${res.rejected.length} row${res.rejected.length === 1 ? '' : 's'} that were not read`));
      const ul = el('ul', { class: 'ticklist', style: 'margin-top:6px' });
      res.rejected.slice(0, 40).forEach(r => ul.append(el('li', {},
        `Line ${r.line}: ${r.why} — ${r.text.slice(0, 80)}`)));
      if (res.rejected.length > 40) ul.append(el('li', { class: 'caption' },
        `…and ${res.rejected.length - 40} more.`));
      det.append(ul);
      report.append(det);
    }

    if (res.accepted) {
      report.append(el('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:10px',
        onclick: () => location.reload() },
        'Reload to apply'));
      report.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
        'Everything derived from a price is computed once when the page loads, so the new closes appear after a reload rather than part-way through a session where half the figures used them and half did not.'));
    }
  } }, 'Read what I pasted'));
  actions.append(el('button', { class: 'btn btn-ghost', onclick: () => { ta.value = ''; report.replaceChildren(); } }, 'Clear'));
  add.append(actions);

  add.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    'Dates must be YYYY-MM-DD, or day-first where the day is unambiguous. 03/04/2026 is refused rather than guessed — reading it the wrong way round would move the whole series by months.'));
  wrap.append(add);

  /* Restore an export. */
  const restore = el('div', { class: 'card' });
  restore.append(cardHead('Restore an export', 'A file previously exported from this page.'));
  const file = el('input', { class: 'input', type: 'file', accept: '.json', 'aria-label': 'Restore an export' });
  file.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j?.series || typeof j.series !== 'object') { toast('That file has no price series in it'); return; }
      let n = 0;
      for (const [sym, series] of Object.entries(j.series)) {
        if (!series || typeof series !== 'object') continue;
        userData.series[sym] = { ...(userData.series[sym] || {}), ...series };
        n += Object.keys(series).length;
      }
      saveUserData();
      toast(`${n} closes restored`);
      location.reload();
    } catch { toast('That file could not be read as JSON'); }
  });
  restore.append(file);
  wrap.append(restore);

  return wrap;
};

VIEWS.watchlists = () => {
  const wrap = el('div', { class: 'stack' });
  /* Above the heading, matching the other five. A strip that sits above the
     title on four pages and below it on two reads as a different control. */
  wrap.append(mySubnav('watchlists'));
  appendSampleBanner(wrap);
  wrap.append(el('div', {}, [
    el('h1', { class: 'h-display' }, 'Watchlists'),
    el('p', { class: 'body-lg' }, 'Companies you follow. Adding one here does not imply a view on it — it decides what the daily change feed covers.'),
  ]));

  /* State.watchlists is an array of { id, name, ids } — the shape the rest of
     the app migrated to when multiple lists were added. */
  const lists = Array.isArray(State.watchlists) ? State.watchlists : [];
  if (!lists.length) {
    wrap.append(emptyStateCta('No watchlists yet',
      'A watchlist decides which companies the change feed and alerts cover.',
      'Find companies', '/discover/screener'));
    return wrap;
  }
  lists.forEach(list => {
    const ids = list.ids || [];
    const card = el('div', { class: 'card' });
    card.append(el('div', { class: 'row', style: 'gap:8px' }, [
      el('h2', { class: 'h-card' }, list.name),
      el('span', { class: 'chip' }, `${ids.length} compan${ids.length === 1 ? 'y' : 'ies'}`),
    ]));
    if (!ids.length) card.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, 'Nothing in this list yet.'));
    else {
      const ul = el('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:10px' });
      ids.forEach(id => {
        const row = BY_ID.get(id);
        if (!row) return;
        ul.append(el('a', { class: 'chip', href: href(companyPath(row.c)),
          onclick: (e) => { e.preventDefault(); openResearch(id); } }, `${row.c.tk} · ${row.c.name}`));
      });
      card.append(ul);
    }
    wrap.append(card);
  });
  return wrap;
};

/* The full trend picture for one instrument, including what is not yet
   computable and exactly how far away it is. */
function openTrendDrawer(row, t) {
  const body = el('div', { class: 'stack' });
  body.append(el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
    el('span', { class: 'chip' }, row.sym),
    el('span', { class: t.points >= 252 ? 'chip chip-ok' : 'chip chip-bronze' },
      `${t.points} close${t.points === 1 ? '' : 's'}`),
    row.meta?.kind ? el('span', { class: 'chip' }, row.meta.kind) : null,
  ]));
  body.append(el('p', { class: 'metaline' },
    `${row.name}. Price evidence only — this instrument has no financial statements, so nothing here is a valuation and nothing here feeds a quality score.`));

  if (t.seams?.length) {
    const s0 = t.seams[0];
    body.append(el('div', { class: 'card', style: 'border-left:3px solid var(--warn)' }, [
      el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' },
        `${t.seams.length} discontinuit${t.seams.length === 1 ? 'y' : 'ies'} in the series`),
      el('p', { class: 'metaline' },
        `${withSign(s0.movePct, 1)} between ${s0.from} and ${s0.to}${s0.gapDays > 1 ? ` across a ${s0.gapDays}-day gap` : ''}. ` +
        'A step like this is usually where an imported history was joined to daily readings, not a move in the market. ' +
        'Volatility, returns and drawdown are all distorted by it — reimport a continuous series before relying on them.'),
    ]));
  }

  /* Relative strength, computed against the benchmark for this instrument. */
  const series = trackedHistory?.series || {};
  const reg = instruments?.instruments || [];
  const rs = relativeStrength(row.sym, row.meta, series);
  const rsCard = el('div', { class: 'panel' });
  const rsDef = TREND_STRATEGIES.find(s => s.id === 'qt_relative_strength_v1');
  rsCard.append(el('div', { class: 'row', style: 'gap:8px' }, [
    el('span', { style: 'font-weight:600;font-size:13px' }, rsDef.name),
    el('span', { class: 'metaline', style: 'margin-left:auto' }, `v${rsDef.version}`),
  ]));
  if (!rs.benchmark) {
    rsCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, rs.reason));
  } else if (rs.isBenchmark) {
    rsCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `${row.sym} is the benchmark other ${row.meta?.market === 'MY' ? 'Malaysian' : ''} instruments are measured against, so it has no relative strength of its own.`));
  } else if (rs.reason) {
    rsCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, rs.reason));
  } else {
    rsCard.append(el('p', { class: 'metaline', style: 'margin:6px 0 8px' },
      `Against ${rs.benchmark.label}. ${rs.benchmark.why}`));
    if (rs.benchmark.weak) rsCard.append(el('p', { class: 'metaline', style: 'color:var(--bronze)' },
      'Not a like-for-like benchmark — read it as global context.'));
    const rt = el('table', { class: 'dt' });
    rt.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Window'), el('th', { class: 'num' }, row.sym),
      el('th', { class: 'num' }, rs.benchmark.symbol), el('th', { class: 'num' }, 'Difference'), el('th', {}, 'Percentile')])));
    const rb = el('tbody');
    rs.horizons.forEach(h => {
      if (h.insufficient) {
        rb.append(el('tr', {}, [el('td', {}, h.label),
          el('td', { class: 'metaline', colspan: 4 },
            `needs ${h.needs} shared closes, has ${h.have}`)]));
        return;
      }
      const pc = rsPercentile(row.sym, row.meta, series, reg, h.days);
      rb.append(el('tr', {}, [
        el('td', {}, h.label),
        el('td', { class: 'num' }, withSign(h.instrument, 1)),
        el('td', { class: 'num' }, withSign(h.benchmark, 1)),
        el('td', { class: 'num ' + diffClass(h.excess) }, withSign(h.excess, 1)),
        el('td', { class: 'metaline' }, !pc ? '—'
          : pc.insufficient ? `${pc.have} of ${pc.needs} peers` : `${ord(pc.pct)} of ${pc.peers}`),
      ]));
    });
    rt.append(rb);
    rsCard.append(el('div', { style: 'overflow-x:auto' }, rt));
    const done = rs.horizons.filter(h => !h.insufficient);
    if (done.length) rsCard.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      `Windows are measured on dates both series share, not on row counts — ${done[0].from} to ${done[0].to} for the shortest window shown. Price return only; dividends are not included.`));
  }
  rsCard.append(el('details', { style: 'margin-top:8px' }, [
    el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'What this does and does not tell you'),
    el('ul', { class: 'ticklist', style: 'margin-top:6px' }, rsDef.limitations.map(l => el('li', {}, l))),
  ]));
  body.append(rsCard);

  TREND_STRATEGIES.filter(s => s.evaluate && !s.external).forEach(s => {
    const res = s.evaluate(t);
    const card = el('div', { class: 'panel' });
    card.append(el('div', { class: 'row', style: 'gap:8px' }, [
      el('span', { style: 'font-weight:600;font-size:13px' }, s.name),
      el('span', { class: 'metaline', style: 'margin-left:auto' }, `v${s.version}`),
    ]));
    if (res) {
      card.append(el('p', { style: 'margin:6px 0 2px;font-weight:600' }, res.state));
      card.append(el('p', { class: 'metaline' }, res.detail));
    } else {
      const missing = s.requires.map(id => t.pending.find(x => x.id === id)).filter(Boolean);
      const worst = missing.sort((a, b) => b.more - a.more)[0];
      card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
        worst
          ? `Not computed. Needs ${worst.needs} closes and has ${worst.have} — ${worst.more} more trading days, or one import.`
          : 'Not computed for this instrument.'));
    }
    card.append(el('details', { style: 'margin-top:8px' }, [
      el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'What this does and does not tell you'),
      el('ul', { class: 'ticklist', style: 'margin-top:6px' }, s.limitations.map(l => el('li', {}, l))),
    ]));
    body.append(card);
  });

  /* Volume, where the imported file carried it. */
  const vol = volumeContext(trackedHistory?.volume?.[row.sym] || {}, series[row.sym] || {});
  const vCard = el('div', { class: 'panel' });
  vCard.append(el('div', { class: 'row', style: 'gap:8px' }, [
    el('span', { style: 'font-weight:600;font-size:13px' }, 'Volume context'),
    el('span', { class: 'metaline', style: 'margin-left:auto' }, 'section 13.3'),
  ]));
  if (vol.pending || !vol.points) {
    vCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      vol.points
        ? `Needs 20 days of volume and has ${vol.points}.`
        : 'No volume for this instrument. A watchlist screenshot shows a price, not a day’s turnover — import an export that carries a volume column.'));
  } else {
    const vt = el('table', { class: 'dt' });
    vt.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Measure'), el('th', { class: 'num' }, 'Value')])));
    vt.append(el('tbody', {}, [
      ['Latest volume', fmtNum(vol.latest, 0)],
      ['20-day average', isNum(vol.avg20) ? fmtNum(vol.avg20, 0) : '—'],
      ['50-day average', isNum(vol.avg50) ? fmtNum(vol.avg50, 0) : '—'],
      ['Latest vs 20-day', isNum(vol.ratio20) ? `${fmtNum(vol.ratio20, 2)}×` : '—'],
      ['Latest vs 50-day', isNum(vol.ratio50) ? `${fmtNum(vol.ratio50, 2)}×` : '—'],
      ['Average on up days', isNum(vol.upAvg) ? `${fmtNum(vol.upAvg, 0)} (${vol.upDays} days)` : '—'],
      ['Average on down days', isNum(vol.downAvg) ? `${fmtNum(vol.downAvg, 0)} (${vol.downDays} days)` : '—'],
      ['Up/down turnover', isNum(vol.upDownRatio) ? `${fmtNum(vol.upDownRatio, 2)}×` : '—'],
    ].map(([k, v]) => el('tr', {}, [el('td', {}, k), el('td', { class: 'num' }, v)]))));
    vCard.append(el('div', { style: 'overflow-x:auto;margin-top:6px' }, vt));
    vCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'Heavier turnover on up days than down days is a description of the tape, not evidence about the business. Breakout volume is not shown: the specification defines it against a resistance level you set, and this build has no place to set one.'));
  }
  body.append(vCard);

  /* Every indicator, computed or pending, so the gap is legible. */
  const tbl = el('table', { class: 'dt' });
  tbl.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Indicator'), el('th', { class: 'num' }, 'Value'), el('th', {}, 'Status')])));
  const tb2 = el('tbody');
  TREND_INDICATORS.forEach(ind => {
    const v = t.values[ind.id];
    const pend = t.pending.find(x => x.id === ind.id);
    let shown = '—';
    if (ind.id === 'cross') shown = v ? `${v.dir === 'up' ? 'upward' : 'downward'} on ${v.date}` : (pend ? '—' : 'none in the window');
    else if (isNum(v)) shown = ind.kind === 'pct' ? withSign(v, 2) : fmtNum(v, 2);
    tb2.append(el('tr', {}, [
      el('td', {}, ind.label),
      el('td', { class: 'num' }, shown),
      el('td', { class: 'metaline' }, pend ? `needs ${pend.more} more closes` : 'computed'),
    ]));
  });
  tbl.append(tb2);
  body.append(el('div', { style: 'overflow-x:auto' }, tbl));
  body.append(el('p', { class: 'metaline' },
    `Series runs ${t.first || '—'} to ${t.lastDate || '—'}. Extend it by pasting closes under My Investments → Your data.`));

  openDrawer(`${row.sym} — trend context`, body);
}

/* Shared secondary navigation for the personal surfaces. */
function mySubnav(active) {
  const row = el('div', { class: 'segmented', style: 'margin-bottom:var(--md);flex-wrap:wrap' });
  SUBNAV_MY.forEach(s => row.append(el('a', {
    href: href(s.path), 'aria-selected': active === s.id ? 'true' : 'false',
    onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(s.path); } }, s.label)));
  return row;
}

/* A consistent empty state: says what the surface is for and offers the one
   action that fills it, rather than rendering a blank container. */
function emptyStateCta(title, body, ctaLabel, ctaPath) {
  const card = el('div', { class: 'card', style: 'text-align:center;padding:var(--xxl) var(--lg)' });
  card.append(el('h2', { class: 'h-card' }, title));
  card.append(el('p', { class: 'metaline', style: 'margin:8px auto 14px;max-width:52ch' }, body));
  if (ctaLabel) card.append(el('a', { class: 'btn btn-primary', href: href(ctaPath),
    onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(ctaPath); } }, ctaLabel));
  return card;
}

/* ==========================================================================
   TRUST PAGES

   These state what is known and mark what is not. An About page carrying an
   invented registration number would be worse than one that says the entity
   is not yet registered — a reader can act on the second and is misled by the
   first.
   ========================================================================== */
function trustPage(title, lede, blocks) {
  const wrap = el('div', { class: 'stack' });
  wrap.append(el('div', {}, [el('h1', { class: 'h-display' }, title), el('p', { class: 'body-lg' }, lede)]));
  blocks.forEach(([heading, body, pending]) => {
    const card = el('div', { class: 'card' });
    card.append(el('div', { class: 'row', style: 'gap:8px' }, [
      el('h2', { class: 'h-card' }, heading),
      pending ? el('span', { class: 'chip chip-bronze' }, 'not yet established') : null,
    ]));
    /* A paragraph may be a [text, path] pair, which renders as a real link.
       "See the contact page." was a bare <p> whose closest('a') was null, so the
       one sentence on the About page that points somewhere pointed nowhere. */
    (Array.isArray(body) ? body : [body]).forEach(p => {
      if (Array.isArray(p)) card.append(el('p', { style: 'margin-top:8px' },
        el('a', { href: href(p[1]), 'data-path': p[1] }, p[0])));
      else card.append(el('p', { class: pending ? 'metaline' : '', style: 'margin-top:8px' }, p));
    });
    wrap.append(card);
  });
  return wrap;
}

VIEWS.about = () => trustPage('About',
  'Who is responsible for this product, and what it is and is not.',
  [
    ['What Quantum Tradeworks is',
      ['A research tool. It shows the figures a company reported, derives measures from them, and models a range of values under assumptions you can see and change.',
       'It is also a property calculator: you enter a purchase and it returns the monthly cash flow, the break-even rent and the cash required.']],
    ['What it is not',
      ['Not advice. It does not tell you what to buy, hold or sell, produces no ratings or target prices, asks nothing about your circumstances, and executes nothing.',
       'Not a data vendor. It does not redistribute market data, and where a price is shown its source and licence are stated on the page.']],
    ['Legal entity and registration',
      'No operating company has been registered for this product yet, so there is no company number, no registered address and no regulated status to state. This page will carry them once there are.', true],
    ['The people responsible',
      'Not published. Naming a team before there is a registered entity behind it would be a claim without anything standing behind it.', true],
    ['Regulatory position',
      'This product is not licensed by the Securities Commission Malaysia and does not carry on any regulated activity. It publishes research and calculators; it gives no personal recommendation.'],
    ['Conflicts of interest',
      ['Nothing on this site is paid for. There are no broker commissions, no mortgage introductions, no developer fees, no advertising, no issuer payments and no sponsored content.',
       'If any of that changes it will be declared here before it takes effect. A score or a valuation must never move because of who paid — that is the one commitment this product cannot trade away.']],
    ['Contact', [['See the contact page.', '/contact']]],
  ]);

VIEWS.contact = () => trustPage('Contact',
  'How to reach whoever is responsible for a page, a figure or a correction.',
  [
    ['Corrections',
      'If a number here is wrong, that is the most useful thing you can tell us. Every correction is published in the corrections log with what was wrong, what it is now and why.'],
    ['Contact address',
      'Not yet published. A contact route will be listed here alongside the registered entity rather than before it.', true],
    ['What to include',
      'The company or property, the figure, what you believe it should be, and where that comes from. A source makes a correction verifiable rather than a disagreement.'],
  ]);

VIEWS.privacy = () => trustPage('Privacy',
  'What this build stores, where it stores it, and what leaves your device.',
  [
    ['What is stored',
      ['Your watchlists, saved screens, investment cases, portfolio holdings, property inputs, theme and base currency are held in this browser’s local storage. They are not sent anywhere.',
       'There are no accounts in this build, so there is nothing to sign in to and no server-side record of you.']],
    ['What leaves your device',
      [
        'Page views are counted by Vercel Web Analytics: the path you visited, the site that referred you, your country, and whether you are on a phone or a desktop. It sets no cookies, stores no identifier, and cannot follow you to another site — there is no way to tell a returning visitor from a new one, which is the trade being made deliberately.',
        'When SEC-filed companies are loaded, the filing data is fetched from a file served by this site. No request identifying you is made to any third party.',
        /* Written from the same flag the waitlist renders from. If that form is
           ever switched on, this sentence appears with it — a privacy page that
           has to be remembered separately is one that will be wrong. */
        ...(waitlistReady()
          ? ['If you enter an email address in the waitlist, that address is sent to the form service configured for this deployment and used for one message about launch. Nothing else on this page is sent with it.']
          : ['There is no form on this site that sends anything anywhere. No email address is requested and none can be submitted.']),
        'Exporting your data is the only other way anything leaves, and it goes to a file on your own machine when you ask for it.',
      ]],
    ['What is never collected',
      'No brokerage credentials, no account numbers, no identity documents. The portfolio feature records what you type and nothing else.'],
    ['Clearing your data',
      'Clearing this site’s storage in your browser removes everything the product holds about you, immediately and irreversibly. Export first if you want to keep it — there is no copy on any server to fall back on.'],
    ['A formal policy',
      'This page describes the build as it actually behaves. A formal privacy policy naming a data controller follows the registered entity.', true],
  ]);

VIEWS.terms = () => trustPage('Terms',
  'The terms this build is offered under.',
  [
    ['Research, not advice',
      'Everything here is general information. It does not take account of your objectives, financial situation or needs, and nothing on this site is a recommendation to deal in any security or property.'],
    ['Sample data',
      'A substantial part of the dataset is synthetic and exists to demonstrate the interface. It is labelled as such wherever it appears. Do not use a sample figure for a decision.'],
    ['No warranty on figures',
      'Data is drawn from filings and files you supply. Errors are possible, are corrected when found, and are logged. Verify anything you intend to act on against the primary source.'],
    ['Prices and licensing',
      'No market data is redistributed. Where a price is shown, its source and the right it is shown under are stated on the page.'],
    ['Payment',
      'No payment is processed anywhere in this build. Nothing charges, renews or cancels, and the plan controls are demonstrations.'],
    ['Governing terms',
      'Formal terms follow the registered entity.', true],
  ]);

VIEWS.notfound = () => {
  const wrap = el('div', { class: 'stack' });
  const card = el('div', { class: 'card', style: 'text-align:center;padding:var(--xxxl) var(--lg)' });
  card.append(el('div', { class: 'num', style: 'font-size:44px;font-weight:700' }, '404'));
  card.append(el('h1', { class: 'h-section', style: 'margin-top:6px' },
    State.notFoundWhat ? `No ${State.notFoundWhat}` : 'That page does not exist'));
  card.append(el('p', { class: 'metaline', style: 'margin:10px auto 16px;max-width:54ch' },
    State.notFoundWhat
      ? 'It may have been renamed, or it may not be in the universe this build covers. Search for it, or start from Discover.'
      : 'The link may be out of date. Everything below is a real destination.'));
  const row = el('div', { class: 'row', style: 'gap:8px;justify-content:center;flex-wrap:wrap' });
  [['Discover', '/discover'], ['Research', '/research'], ['Property', '/property'], ['Home', '/']]
    .forEach(([l, p]) => row.append(el('a', { class: 'btn', href: href(p),
      onclick: (e) => { e.preventDefault(); State.notFoundWhat = null; navigate(p); } }, l)));
  card.append(row);
  wrap.append(card);
  return wrap;
};

