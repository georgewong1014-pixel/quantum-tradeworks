/* ==========================================================================
   WHICH ASSUMPTION DECIDES THIS, AND WHERE IT BREAKS
   --------------------------------------------------------------------------
   The equity studio has had a tornado since it was built. The property side has
   had a stress test on two variables at fixed steps and nothing that ranks
   them, so a reader facing forty inputs had no way to tell which three decide
   the answer and which thirty-seven are decoration.

   MEASURED IN THE RATE OF RETURN, which only became measurable when a real
   internal rate replaced the annualised multiple. It is the right measure
   because it is the only one that integrates everything a move touches: a rate
   rise raises the instalment, cuts the cash flow, raises the interest
   deduction and so cuts the tax, and shifts the balance outstanding at exit.
   A tornado on monthly cash flow would show the first of those and miss the
   rest.

   IN PERCENTAGE POINTS, not as a percentage change of a percentage. A 40% fall
   in a 2.38% return is a sentence nobody can hold in their head; 2.38% falling
   to 1.43% is one they can.

   WHAT IS DELIBERATELY NOT HERE: a second break-even rent. dealModel already
   computes breakEvenRent, and the property view already charts it against a
   threshold. Solving for it again by bisection would be a second
   implementation of one quantity, free to disagree with the first on a screen
   showing both. The pre-tax row below cites that figure rather than recomputing
   it. The after-tax figure IS solved here, because it does not exist elsewhere.
   ========================================================================== */

/* Steps sized to a realistic move in each variable rather than to a round
   number. A percentage point on the rate is about four moves in the policy
   rate — a cycle, not a shock. Five points of vacancy is roughly one more void
   month a year. */
const PROPERTY_DRIVERS = [
  { k: 'ratePct', step: 1, unit: 'pp', label: 'Interest rate', kind: 'quoted',
    why: 'About four moves in the policy rate — a cycle, not a shock.' },
  { k: 'rent', pct: 10, unit: '10%', label: 'Achieved rent', kind: 'observed',
    why: 'Covers the gap between an asking rent and a signed one.' },
  { k: 'vacancyPct', step: 5, unit: 'pp', label: 'Vacancy', kind: 'observed',
    why: 'Roughly one more void month a year.' },
  { k: 'apprecPct', step: 1, unit: 'pp', label: 'Appreciation', kind: 'observed',
    why: 'The assumption with the least evidence behind it and often the most weight.' },
  { k: 'price', pct: 5, unit: '5%', label: 'Purchase price', kind: 'observed',
    why: 'What a successful negotiation is worth, against what overpaying costs.' },
  { k: 'maintenance', pct: 20, unit: '20%', label: 'Maintenance charge', kind: 'observed',
    why: 'Revised by a management corporation, not by you.' },
  { k: 'holdYears', step: 3, unit: 'yrs', label: 'Holding period', kind: 'decision',
    why: 'Also moves the RPGT band, which is why selling early costs more than the rent forgone.' },
  { k: 'tenureYears', step: 5, unit: 'yrs', label: 'Loan tenure', kind: 'decision',
    why: 'Longer lowers the instalment and raises the total interest.' },
];

/* Computed here rather than inside dealModel, because dealModel is what it
   calls — putting it in the model would make the model run itself sixteen
   times per render, and then sixteen times inside each of those. */
function propertySensitivity(d) {
  const base = dealModel(d);
  if (!isNum(base.irrPct)) {
    return { ok: false, base, why: base.irrWhy || 'The base case has no rate of return for an assumption to move.' };
  }
  const baseIrr = base.irrPct;

  const drivers = PROPERTY_DRIVERS.map(p => {
    const cur = num0(d[p.k]);
    const step = isNum(p.step) ? p.step : Math.abs(cur * (p.pct / 100));
    if (!(step > 0)) return null;

    /* An input moved somewhere meaningless is left unprobed rather than probed
       at a clamped value, which would quietly understate that driver. */
    const at = (v) => {
      if (v < 0) return null;
      if ((p.k === 'holdYears' || p.k === 'tenureYears') && v < 1) return null;
      if (p.k === 'vacancyPct' && v > 100) return null;
      const m = dealModel({ ...d, [p.k]: v });
      return isNum(m.irrPct) ? m.irrPct : null;
    };
    const upIrr = at(cur + step), dnIrr = at(cur - step);
    const hi = isNum(upIrr) ? upIrr - baseIrr : null;
    const lo = isNum(dnIrr) ? dnIrr - baseIrr : null;
    const money = p.k === 'rent' || p.k === 'price' || p.k === 'maintenance';
    const stepLabel = p.unit === 'pp' ? `${fmtNum(step, step % 1 === 0 ? 0 : 2)} pp`
      : p.unit === 'yrs' ? `${fmtNum(step, 0)} years`
      : `${p.unit}, ${money ? fmtAmount(step, 'MYR') : fmtNum(step, 2)}`;

    /* The grade the reader already assigned this figure. Untouched driving
       figures are what the tool seeded whatever the stored label says, which
       is what isTouched exists to answer. */
    const ev = p.kind === 'observed'
      ? evidenceOf(isTouched(d, p.k) ? (d.evidence || {})[p.k] : 'illustrative_default')
      : null;

    return { k: p.k, label: p.label, unit: p.unit, why: p.why, kind: p.kind, ev, step, stepLabel,
             base: cur, upIrr, dnIrr, hi, lo,
             span: Math.max(Math.abs(hi ?? 0), Math.abs(lo ?? 0)) };
  }).filter(Boolean).sort((a, b) => b.span - a.span);

  return { ok: true, base, baseIrr, drivers };
}

/* --------------------------------------------------------- break-points ---
   Solved on the model itself rather than by algebra. The model is not
   invertible, and any closed form would be a second implementation of it —
   free to disagree with the very figure it claims to be the break-point of.

   Brackets span the full plausible range rather than starting at the current
   value, so the same call works whether the deal is approaching the point or
   already past it. Equal signs at both ends means no crossing, which is
   reported rather than fudged: "never covers itself at any rate a bank would
   lend at" is a real answer, and a more useful one than a number. */
function propertyBreakPoint(d, key, { measure = 'cashflow', lo, hi, iterations = 80 } = {}) {
  const value = (v) => {
    if (v < 0) return null;
    const m = dealModel({ ...d, [key]: v });
    if (measure === 'cashflowAfterTax') {
      /* path[0].cfPreTax / 12 equals cashflowMonthly by construction — same
         effective rent, same year-one opex, same debt service. So this differs
         from the pre-tax break-even by tax alone, which is the point of it. */
      return m.path && m.path[0] ? m.path[0].cf / 12 : null;
    }
    return isNum(m.cashflowMonthly) ? m.cashflowMonthly : null;
  };
  const a = value(lo), b = value(hi);
  if (!isNum(a) || !isNum(b)) return { value: null, why: 'The measure cannot be computed across this range.' };
  if (Math.sign(a) === Math.sign(b)) return { value: null, atLo: a, atHi: b, sign: Math.sign(a) };

  let l = lo, h = hi, fl = a;
  for (let i = 0; i < iterations; i++) {
    const mid = (l + h) / 2;
    const f = value(mid);
    if (f === null) break;
    if (Math.abs(f) < 1e-6 || (h - l) < 1e-7) return { value: mid };
    if (Math.sign(f) === Math.sign(fl)) { l = mid; fl = f; } else { h = mid; }
  }
  return { value: (l + h) / 2 };
}

/* ------------------------------------------------------------------ panel --- */
function propertySensitivityPanel(d, m) {
  const s = propertySensitivity(d);
  const card = el('div', { class: 'card' });
  card.append(cardHead('What actually decides this',
    'Every assumption moved one realistic step in each direction, ranked by how far it moves the rate of return. '
    + 'The ones at the top are where a valuer or a rental appraisal is worth paying for. The ones at the bottom are not.'));

  if (!s.ok) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' }, s.why));
    return card;
  }

  const block = el('div', { class: 'render-block', style: 'margin-top:var(--md)' });
  block.append(el('h4', { style: 'font-size:var(--text-lead);font-weight:var(--weight-semibold);margin:0' },
    `Effect on a ${fmtPct(s.baseIrr, 2)} rate of return`));
  const host = el('div', { style: 'margin-top:var(--sm)' });
  block.append(host);
  tornadoChart(host, {
    drivers: s.drivers,
    fmt: (v) => isNum(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} pp` : '—',
    /* Not "±": these are asymmetric. Appreciation is +2.95 up and −3.48
       down on the default deal, and the bars show it. The label carries the
       larger magnitude, and the table below carries both ends. */
    spanFmt: (v) => `${v.toFixed(2)}pp`,
    note: 'Change in the rate of return, in percentage points',
    aria: 'Assumptions ranked by how far one step moves the rate of return. '
      + s.drivers.map(x => `${x.label}, ${x.span.toFixed(2)} points.`).join(' '),
  });
  card.append(block);

  const t = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  t.append(el('thead', {}, el('tr', {}, ['Assumption', 'One step down', 'One step up', 'Swing']
    .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
  t.append(el('tbody', {}, s.drivers.map(x => el('tr', {}, [
    el('th', { scope: 'row', style: 'text-align:left' }, [
      el('div', {}, x.label),
      el('div', { class: 'caption', style: 'font-weight:400;white-space:normal;margin-top:2px' },
        `${x.stepLabel} — ${x.why}`),
    ]),
    el('td', { class: 'num' }, isNum(x.dnIrr) ? fmtPct(x.dnIrr, 2) : '—'),
    el('td', { class: 'num' }, isNum(x.upIrr) ? fmtPct(x.upIrr, 2) : '—'),
    el('td', { class: 'num', style: 'font-weight:600' }, `${x.span.toFixed(2)} pp`),
  ]))));
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  gridKeyboard(t, 'Assumptions ranked by effect on the rate of return. Arrow keys move between cells.');

  const top = s.drivers[0], tail = s.drivers.slice(-2);
  card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
    `${top.label} moves this deal further than anything else — ${top.span.toFixed(2)} points of return for one step. `
    + `The two that move it least are ${tail.map(x => x.label.toLowerCase()).join(' and ')}, at `
    + `${tail.map(x => x.span.toFixed(2)).join(' and ')} points. `
    + 'Each row moves a single assumption with the rest held, so two moving together will not simply add.'));

  /* ------------------------------------------- impact against evidence ---
     The finding neither ranking gives on its own. A driver near the top of
     this list that rests on a number nobody verified is the most dangerous
     cell in the model, and until now the two facts lived on different
     screens: the tornado here, the evidence grade in the assumption drawer.

     A filter, not a score. Inventing a weight for 'impact times weakness'
     would produce a number with no defensible units that would then get
     quoted. The rule is stated instead: above the median swing, and graded
     at estimated or below. */
  const graded = s.drivers.filter(x => x.ev);
  const spans = s.drivers.map(x => x.span).sort((a, b) => a - b);
  const median = spans[Math.floor(spans.length / 2)];
  const exposed = graded.filter(x => x.span >= median && x.ev.rank <= 1);
  if (exposed.length) {
    const box = el('div', { style: 'margin-top:var(--lg);padding:var(--md);border:1px solid var(--bronze);border-radius:var(--r-md)' });
    box.append(el('p', { class: 'body', style: 'font-weight:600;margin:0' },
      exposed.length === 1
        ? 'The assumption that moves this most is one nobody has verified.'
        : `${['', 'One', 'Two', 'Three', 'Four', 'Five'][exposed.length] || exposed.length} of the assumptions that move this most are ones nobody has verified.`));
    box.append(el('ul', { class: 'log-list', style: 'margin-top:8px' }, exposed.map(x =>
      el('li', {}, `${x.label} moves the return ${x.span.toFixed(2)} points a step, and is graded `
        + `"${x.ev.label}" — ${x.ev.note}`))));
    box.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'Listed because the swing is at or above the median for this deal and the evidence is graded estimated or weaker. '
      + 'Verification effort is worth most here and nowhere else on the list.'));
    card.append(box);
  } else if (graded.length) {
    card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
      'No assumption that moves this deal materially rests on evidence graded estimated or weaker.'));
  }

  /* Interest rate and the two term lengths carry no evidence grade because
     they are not observations. Saying so prevents the list above reading as
     though the ungraded drivers were verified. */
  card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'Interest rate is quoted by a bank, and the holding period and loan tenure are your decisions, so none of the three '
    + 'carries an evidence grade. Their absence from the list above is not a sign that they have been checked.'));

  /* ----------------------------------------------------------- break-points */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'Where it stops covering itself'));

  const rows = [
    { key: 'ratePct', label: 'Interest rate', lo: 0, hi: 25,
      fmt: v => fmtPct(v, 2), room: v => `${fmtPct(Math.abs(v - num0(d.ratePct)), 2)} of rate rises`,
      now: fmtPct(num0(d.ratePct), 2),
      none: 'Does not cover itself even at a 0% rate, so no rate cut fixes this one.' },
    { key: 'vacancyPct', label: 'Vacancy', lo: 0, hi: 100,
      fmt: v => fmtPct(v, 1), room: v => `${fmtPct(Math.abs(v - num0(d.vacancyPct)), 1)} more vacancy`,
      now: fmtPct(num0(d.vacancyPct), 1),
      none: 'Does not cover itself even at zero vacancy, so a perfect letting record does not fix it.' },
  ].map(r => ({ ...r, res: propertyBreakPoint(d, r.key, { measure: 'cashflow', lo: r.lo, hi: r.hi }) }));

  const bt = el('table', { class: 'dt' });
  bt.append(el('thead', {}, el('tr', {}, ['Assumption', 'Now', 'Turns negative at']
    .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
  const body = rows.map(r => {
    const v = r.res.value;
    const past = isNum(v) && v < num0(d[r.key]);
    return el('tr', {}, [
      el('th', { scope: 'row', style: 'text-align:left' }, [
        el('div', {}, r.label),
        el('div', { class: 'caption', style: 'font-weight:400;white-space:normal;margin-top:2px' },
          !isNum(v) ? (r.res.sign < 0 ? r.none : 'Stays positive across the whole range.')
            : past ? 'Already past this point — the monthly position is negative today.'
            : `${r.room(v)} before the monthly position turns negative.`),
      ]),
      el('td', { class: 'num' }, r.now),
      el('td', { class: 'num' }, isNum(v) ? r.fmt(v) : el('span', { class: 'caption' }, '—')),
    ]);
  });
  /* Cites the figure the model already publishes rather than solving for it a
     second time and risking two different numbers on one screen. */
  body.push(el('tr', {}, [
    el('th', { scope: 'row', style: 'text-align:left' }, [
      el('div', {}, 'Rent, before tax'),
      el('div', { class: 'caption', style: 'font-weight:400;white-space:normal;margin-top:2px' },
        'The break-even rent already shown on this page, not a second calculation of it.'),
    ]),
    el('td', { class: 'num' }, fmtMoney(num0(d.rent), 'MYR', 0)),
    el('td', { class: 'num' }, isNum(m && m.breakEvenRent) ? fmtMoney(m.breakEvenRent, 'MYR', 0) : '—'),
  ]));
  bt.append(el('tbody', {}, body));
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, bt));
  gridKeyboard(bt, 'The point at which each assumption stops covering the monthly outgoings.');

  /* --------------------------------------------------- the after-tax version
     Worth its own block because the answer is not the one people expect. At the
     pre-tax break-even, taxable rental income is NOT zero: what was deducted is
     the interest, but what left the account is the whole instalment. The
     principal inside it is taxed in the year it is repaid while never being
     available to pay the tax on itself. */
  if (m && m.taxComputed) {
    const rentBase = num0(d.rent);
    const afterTax = propertyBreakPoint(d, 'rent', {
      measure: 'cashflowAfterTax', lo: 0, hi: Math.max(rentBase * 6, 30000),
    });
    if (isNum(afterTax.value) && isNum(m.breakEvenRent)) {
      const gap = afterTax.value - m.breakEvenRent;
      card.append(el('div', { style: 'margin-top:var(--lg);padding:var(--md);border:1px solid var(--bronze);border-radius:var(--r-md)' }, [
        el('p', { class: 'body', style: 'font-weight:600;margin:0' }, 'Breaking even on cash is not breaking even after tax.'),
        el('p', { class: 'metaline', style: 'margin-top:6px' },
          `Covering the outgoings takes ${fmtMoney(m.breakEvenRent, 'MYR', 0)} a month. Covering them and the tax on the rent takes `
          + `${fmtMoney(afterTax.value, 'MYR', 0)} — ${fmtMoney(Math.abs(gap), 'MYR', 0)} more.`),
        el('p', { class: 'metaline', style: 'margin-top:6px' },
          'The two figures measure different things. At the cash break-even the whole instalment has left the account, but only '
          + 'the interest inside it was deductible. The principal is taxed as income in the year it is repaid while never being '
          + 'available to pay the tax on itself — so a property that exactly covers its costs still generates a bill.'),
      ]));
    }
  } else {
    card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
      'These are before tax on the rent. Enter your marginal rate above and the after-tax break-even appears here — it is higher '
      + 'than this one, because the principal inside the instalment is taxed but not deductible.'));
  }

  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'Break-points are solved on the model itself rather than from a formula, so one cannot disagree with the figure it breaks. '
    + 'Each moves a single assumption with the others held.'));
  return card;
}
