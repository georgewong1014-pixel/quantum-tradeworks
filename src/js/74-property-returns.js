/* ==========================================================================
   A REAL RATE OF RETURN, AND TAX ON THE RENT
   --------------------------------------------------------------------------
   Two corrections to figures this calculator was already showing.

   THE FIRST. `irrApprox` was (multiple ^ 1/years) − 1: the geometric average of
   the TOTAL multiple. It ignores when every intermediate ringgit arrives. A
   deal bleeding cash for five years and exiting big, and one cash-positive from
   month one, produce the same number off the same total profit — and they are
   not the same investment. The cash flow vector was already being built in
   path[]; nothing was reading it.

   THE SECOND. RPGT on disposal was modelled properly, by holding year. Tax on
   the RENT was not modelled at all — there was no marginal rate anywhere in the
   codebase — so every net cash flow, break-even rent and yield figure was
   pre-tax while reading as though it were what the owner keeps.

   The deductibility rules are the substance here, not the rate. The mistake an
   unaided owner makes is deducting the whole instalment, and the whole
   instalment is not deductible: interest is, principal is not.
   ========================================================================== */

/* ------------------------------------------------------------------- IRR ---
   Bisection rather than Newton. Property cash flows are not well behaved — a
   long negative run then one large positive exit — and a derivative method
   walks off the edge of that. Bisection is slower and cannot fail to converge
   once a sign change is bracketed, which is the trade this wants.

   Returns null, with a reason, when no rate exists. A deal that never returns
   its capital has no internal rate of return; printing a large negative number
   there implies a precision the arithmetic does not have. */
function npvAt(rate, flows) {
  let v = 0;
  for (let t = 0; t < flows.length; t++) {
    /* A flow that is not a number makes the value unknown, not smaller. It
       was added as it came, and null divides to nought, so a loan whose
       instalment could not be computed valued every year's cash and the sale
       at nothing: "−RM121,754, falls short of the alternative you named",
       beside a rate of return rightly withheld for the same flows. */
    if (!isNum(flows[t])) return null;
    v += flows[t] / Math.pow(1 + rate, t);
  }
  return v;
}

function irrOf(flows) {
  if (!Array.isArray(flows) || flows.length < 2) return { rate: null, why: 'Not enough periods to compute a rate.' };
  if (!flows.every(isNum)) return { rate: null, why: 'A period is missing a cash flow.' };

  /* DESCARTES, AND WHY IT IS REPORTED RATHER THAN IGNORED.
     One sign change gives one rate. More than one can give several, all of them
     arithmetically valid and none of them meaningful on its own — a property
     with a mid-hold refinancing or a big year-five refurbishment can do this.
     The figure is still shown, with the caveat, because suppressing it would
     hide a deal shape the reader should know about. */
  /* A nil period has no sign, so it is stepped over and each flow is compared
     with the last flow that had one. The count compared neighbours and skipped
     any pair containing a nil, so a nil between the outlay and the return hid
     the change: [−100, 0, 110] counted none and was told "no period is
     positive". A parcel bought outright with its outgoings entered as nought
     is exactly that shape — nine nil years between the price and the sale —
     and the calculator said the capital never comes back beside a sale that
     returns more than it cost. */
  let signChanges = 0, lastSign = 0;
  for (const f of flows) {
    const s = Math.sign(f);
    if (s === 0) continue;
    if (lastSign !== 0 && s !== lastSign) signChanges++;
    lastSign = s;
  }
  if (signChanges === 0) {
    const first = flows.find(f => f !== 0);
    return { rate: null, signChanges,
      why: first === undefined
        ? 'Every period is nil, so there is no capital outflow to earn a return on.'
        : first > 0
        ? 'Every period is positive, so there is no capital outflow to earn a return on.'
        : 'No period is positive. The capital is never returned, so no rate of return exists.' };
  }

  const LO = -0.9999, HI = 10;      /* −99.99% to +1000% a year */
  let lo = LO, hi = HI;
  let fLo = npvAt(lo, flows), fHi = npvAt(hi, flows);
  if (!isFinite(fLo) || !isFinite(fHi)) return { rate: null, signChanges, why: 'The cash flows do not resolve to a finite value.' };
  if (Math.sign(fLo) === Math.sign(fHi)) {
    /* THE SAME SIGN AT BOTH ENDS IS NOT THE SAME AS NO RATE. With two sign
       changes — the equity out, rent that more than repays it, then a sale
       that does not clear the loan — the flows can have two rates inside the
       range and the ends agree. This said "no rate" beside a positive profit
       on the same sale. A grid finds every bracket; two or more rates are
       named, and none is chosen, because none describes the flows alone. */
    const roots = [];
    if (signChanges > 1) {
      /* Evenly spaced in log(1 + r), from −99.99% to +1000%, so the fine
         steps sit where property returns are. */
      let a = LO, fa = fLo;
      for (let i = 1; i <= 400; i++) {
        const b = (1 + LO) * Math.pow((1 + HI) / (1 + LO), i / 400) - 1;
        const fb = npvAt(b, flows);
        if (isFinite(fa) && isFinite(fb) && Math.sign(fa) !== Math.sign(fb)) {
          let l = a, h = b, fl = fa;
          for (let k = 0; k < 200 && (h - l) > 1e-10; k++) {
            const mid = (l + h) / 2, fm = npvAt(mid, flows);
            if (Math.sign(fm) === Math.sign(fl)) { l = mid; fl = fm; } else h = mid;
          }
          roots.push((l + h) / 2 * 100);
        }
        a = b; fa = fb;
      }
    }
    if (roots.length === 1) return { rate: roots[0], signChanges, why: null };
    if (roots.length > 1) return { rate: null, signChanges, rates: roots,
      why: `These cash flows change sign more than once and have more than one rate of return — ${roots.map(r => fmtPct(r, 2)).join(' and ')} a year. No single rate describes them.` };
    return { rate: null, signChanges,
      why: 'No rate between −99.99% and 1000% a year makes these cash flows sum to zero.' };
  }

  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const f = npvAt(mid, flows);
    if (Math.abs(f) < 1e-6 || (hi - lo) < 1e-9) return { rate: mid * 100, signChanges, why: null };
    if (Math.sign(f) === Math.sign(fLo)) { lo = mid; fLo = f; } else { hi = mid; }
  }
  return { rate: ((lo + hi) / 2) * 100, signChanges, why: null };
}

/* ------------------------------------------------- Malaysian rental tax ---
   Rental income from a non-business source is taxed at the owner's marginal
   rate on rent LESS the outgoings incurred to produce it.

   WHAT IS DEDUCTIBLE, AND THE ONE THAT CATCHES PEOPLE.

     deductible      loan INTEREST, quit rent, assessment, fire insurance,
                     maintenance and sinking fund, management fees, repairs,
                     and the cost of finding a REPLACEMENT tenant
     not deductible  loan PRINCIPAL, capital improvements, and the cost of
                     finding the FIRST tenant

   The instalment is the trap. An owner who deducts all of it — which is the
   natural thing to do, since it is what leaves the bank account — overstates
   the deduction by the whole principal portion, and the error is largest in the
   final years when principal dominates the payment.

   The first-tenancy letting fee is the second one. Getting a property into a
   lettable state is capital in nature; keeping it let is not. So year one's
   placement fee is excluded and every later one is allowed.

   NO RATE TABLE. This product holds no schedule of Malaysian personal tax
   bands. Rates are set each Budget and a stale table stated confidently is
   worse than no table, so the marginal rate is the reader's own figure. Absent
   it, no tax is computed and every downstream figure is labelled pre-tax
   rather than quietly reading as net. */
function rentalTaxYear({ effectiveRent, deductibleOpex, interest, marginalTaxPct }) {
  if (!isNum(marginalTaxPct) || marginalTaxPct <= 0) {
    return { computed: false, taxable: null, tax: 0, why: 'No marginal rate entered, so no tax is computed.' };
  }
  /* The interest is the deduction that decides the answer. When it is unknown
     — a loan with no schedule — so is the tax; charging the rent as though no
     interest were paid overstated it by the whole deduction. */
  if (!isNum(interest)) {
    return { computed: false, taxable: null, tax: null,
      why: 'The loan’s interest could not be computed, so neither can the tax on the rent.' };
  }
  const taxable = num0(effectiveRent) - num0(deductibleOpex) - interest;
  /* A rental loss on a non-business source is not carried forward and cannot be
     set against other income. Relieving it here would understate the tax in
     every year that follows, so a loss simply produces no tax and no credit. */
  const tax = taxable > 0 ? taxable * (marginalTaxPct / 100) : 0;
  return {
    computed: true, taxable, tax,
    lossNotRelieved: taxable <= 0 ? -taxable : 0,
    why: taxable > 0 ? null
      : 'Deductible outgoings exceed the rent this year, so no tax is due. The loss is not carried forward — a non-business rental loss cannot be set against other income.',
  };
}

/* Interest paid in one year of an amortising loan: the instalments paid that
   year, less the principal the balance actually fell by. Derived from the same
   balanceAfter the rest of the model uses, so the two cannot disagree.

   Only the months of the year the loan still runs. It charged twelve
   instalments in every year of the hold, so once the balance reached nought
   the whole instalment — which was no longer being paid — was booked as
   deductible interest. */
/* A loan with no tenure has no schedule, so its interest is unknown — not
   nought. It returned 0 for that case as for no loan at all, and a tax rate
   entered beside a tenure of 0 was charged on the rent with no interest
   deducted: RM87,192 of tax over ten years, in a table whose every cash
   figure was rightly a dash. */
function interestInYear(loan, ratePct, tenureYears, year) {
  if (!(num0(loan) > 0)) return 0;
  if (!(num0(tenureYears) > 0)) return null;
  const months = clamp(num0(tenureYears) * 12 - (year - 1) * 12, 0, 12);
  if (!(months > 0)) return 0;
  const pmt = monthlyInstalment(loan, ratePct, tenureYears);
  const open = balanceAfter(loan, ratePct, tenureYears, (year - 1) * 12);
  const close = balanceAfter(loan, ratePct, tenureYears, (year - 1) * 12 + months);
  const principalPaid = Math.max(0, open - close);
  return Math.max(0, pmt * months - principalPaid);
}

/* ------------------------------------------- focus across a re-render ---
   Every control on these panels saves and re-renders, and render() replaces
   the page, so the control the reader was using was destroyed under them and
   focus fell to <body>. One arrow press on "Who would be selling" chose the
   next seller and the second press did nothing; typing a tax rate and pressing
   Tab sent the next Tab to the top of the page.

   renderKeepFocus hands focus back to the element that holds it, which covers
   the arrow keys. It cannot cover Tab: the change fires as focus leaves, when
   nothing holds it yet. So the key that left is remembered, and focus moves
   one stop on from the rebuilt control in the direction it was going. A
   pointer that left the control is left alone, as before. */
let propertyLeaveKey = { key: null, shift: false, at: 0 };
document.addEventListener('keydown', e => { propertyLeaveKey = { key: e.key, shift: e.shiftKey, at: Date.now() }; }, true);
const PROPERTY_TAB_STOPS = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), '
  + 'select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]';
function renderFromControl(control) {
  const id = control && control.id;
  const stayed = !!control && document.activeElement === control;
  const tabbed = !stayed && propertyLeaveKey.key === 'Tab' && Date.now() - propertyLeaveKey.at < 1000;
  const back = propertyLeaveKey.shift;
  render();
  const again = id ? document.getElementById(id) : null;
  if (!again) return;
  if (stayed) { again.focus({ preventScroll: true }); return; }
  if (!tabbed) return;
  const stops = [...document.querySelectorAll(PROPERTY_TAB_STOPS)].filter(n => n.getClientRects().length);
  const i = stops.indexOf(again);
  ((i >= 0 && stops[i + (back ? -1 : 1)]) || again).focus();
}


/* ==========================================================================
   RETURN AND TAX — the panel for the two figures that were wrong
   ========================================================================== */
function returnsAndTaxPanel(d, m) {
  const card = el('div', { class: 'card' });
  card.append(cardHead('Return, and tax on the rent',
    'The internal rate of return discounts every year’s cash flow at the time it actually arrives. '
    + 'The annualised multiple beside it does not, and the gap between them is what the timing costs.'));

  /* ---- the rate ---- */
  const g = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
  g.append(el('div', { class: 'panel' }, statTile('Internal rate of return',
    isNum(m.irrPct) ? fmtPct(m.irrPct, 2) : '—',
    { sub: isNum(m.irrPct)
        ? `On ${fmtMoney(m.equityOut, 'MYR', 0)} committed, over ${d.holdYears} years`
        : (m.irrWhy || 'Not computable') })));
  g.append(el('div', { class: 'panel' }, statTile('Annualised multiple',
    isNum(m.annualisedMultiplePct) ? fmtPct(m.annualisedMultiplePct, 2) : '—',
    { sub: 'Total money back, spread evenly. Ignores when it arrives' })));
  g.append(el('div', { class: 'panel' }, statTile(`Value against ${fmtPct(m.hurdlePct, 1)} elsewhere`,
    isNum(m.npvAtHurdle) ? fmtMoney(m.npvAtHurdle, 'MYR', 0) : '—',
    { sub: isNum(m.npvAtHurdle)
        ? (m.npvAtHurdle >= 0 ? 'Beats the alternative you named' : 'Falls short of the alternative you named')
        /* A return entered and a value still missing means the flows are
           unknown; asking for the return again would send the reader to a
           box that is already filled. */
        : m.hurdlePct > 0 ? 'The cash flows could not be computed, so neither can their value'
        : 'Enter the return your capital could earn elsewhere' })));
  card.append(g);

  if (isNum(m.irrPct) && isNum(m.annualisedMultiplePct)) {
    const gap = m.annualisedMultiplePct - m.irrPct;
    card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      Math.abs(gap) < 0.05
        ? 'The two agree here, which happens when the cash flow is level across the hold.'
        : `The annualised multiple reads ${fmtPct(Math.abs(gap), 2)} ${gap > 0 ? 'higher' : 'lower'} than the rate of return. `
          + (gap > 0
            ? 'It is higher because most of the money arrives at the exit, and money that arrives in year ten is worth less than money that arrives in year one. The rate of return is the figure that accounts for that.'
            : 'It is lower because the cash arrives early, which the multiple gives no credit for.')));
  }
  /* Only beside a figure. Where the flows have two rates irrOf names both and
     chooses neither, and the tile shows a dash — this said "the figure shown
     is the first one found" under it. */
  if (m.irrSignChanges > 1 && isNum(m.irrPct)) card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
    `The cash flow changes direction ${m.irrSignChanges} times over the hold, so more than one rate can satisfy it. `
    + 'The figure shown is the first one found and should be read alongside the year-by-year table rather than on its own.'));

  /* ---- who is selling ----
     The exit charge differs by seller, and the model used to assume one kind
     while saying so on a single screen. It is an input now. */
  const who = el('div', { class: 'assumption', style: 'margin-top:var(--lg)' });
  who.append(el('label', { for: 'disposerCategory' }, 'Who would be selling'));
  const sel = el('select', { class: 'input a-text', id: 'disposerCategory',
    'aria-label': 'Who would be selling the property',
    onchange: e => {
      State.deal.disposerCategory = e.target.value;
      markTouched(State.deal, 'disposerCategory'); saveDeal(); renderFromControl(e.target);
    } });
  RPGT_CATEGORY_IDS.forEach(id => {
    const c = RPGT_SCHEDULE.categories[id];
    sel.append(el('option', { value: id, selected: (d.disposerCategory || 'citizen') === id ? 'selected' : null }, c.label));
  });
  who.append(sel);
  card.append(who);

  if (m.rpgtResult) {
    const rr = m.rpgtResult;
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Selling in year ${d.holdYears}: ${rr.why} `
      + (rr.tax > 0
          ? `That is ${fmtMoney(rr.tax, 'MYR', 0)} on a gain of ${fmtMoney(rr.chargeableGain, 'MYR', 0)} after ${fmtMoney(rr.allowable, 'MYR', 0)} of allowable costs.`
          : 'Nothing is charged on this scenario.')));
    if (!rr.category.individual && rr.rate > 0) card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
      'A company never reaches the nil rate however long it holds, and the individual exemption does not apply to it. '
      + 'That is a cost of the corporate structure which is easy to miss at the point of incorporating.'));
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'Rates are cited to Schedule 5 of the Real Property Gains Tax Act and have not been verified against the current '
      + 'schedule or any exemption order in force. Confirm before relying on the figure.'));
  }

  /* ---- the rate the reader pays ---- */
  const f = el('div', { class: 'assumption', style: 'margin-top:var(--lg)' });
  f.append(el('label', { for: 'marginalTaxPct' }, 'Your marginal tax rate (%)'));
  f.append(el('input', { class: 'input a-text', id: 'marginalTaxPct', type: 'number', min: '0', max: '60', step: '1',
    value: isNum(d.marginalTaxPct) ? String(d.marginalTaxPct) : '',
    placeholder: 'e.g. 24',
    'aria-label': 'Your marginal income tax rate',
    onchange: e => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      State.deal.marginalTaxPct = isNum(v) && v > 0 ? v : null;
      markTouched(State.deal, 'marginalTaxPct'); saveDeal(); renderFromControl(e.target);
    } }));
  card.append(f);

  if (!m.taxComputed) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
      'No marginal rate entered, so every figure on this page is before tax on the rent.'));
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'This product holds no schedule of Malaysian personal tax bands. They are set each Budget and a stale table stated '
      + 'confidently is worse than none, so the rate is yours to supply — it is the top band your total income reaches. '
      + 'Nothing here is tax advice.'));
    return card;
  }
  /* A rate entered on a loan with no schedule: the interest is unknown, so is
     every year's tax, and a total of unknown years is not the nought the
     model's running sum leaves behind. Said once, instead of tiles and a year
     table of dashes around a figure that looks computed. */
  if (m.path.some(p => !isNum(p.tax))) {
    card.append(el('p', { class: 'body', style: 'margin-top:var(--md)' },
      'The loan’s instalment could not be computed from the entered tenure, so neither can the interest inside it — the '
      + 'deduction that decides the tax — nor the tax on the rent. Enter a loan tenure and the tax appears here.'));
    return card;
  }

  /* ---- what tax does to the deal ---- */
  const g2 = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
  g2.append(el('div', { class: 'panel' }, statTile('Tax on rent over the hold',
    fmtMoney(m.cumTax, 'MYR', 0), { sub: `At ${fmtPct(d.marginalTaxPct, 0)} on taxable rental income` })));
  g2.append(el('div', { class: 'panel' }, statTile('Rental cash, before tax',
    fmtMoney(m.cumPreTax, 'MYR', 0), { sub: 'What the older figures on this page showed' })));
  g2.append(el('div', { class: 'panel' }, statTile('Rental cash, after tax',
    fmtMoney(m.cumCash, 'MYR', 0), { sub: 'What you keep' })));
  card.append(g2);

  /* THE LINE THAT EARNS THIS PANEL.
     Year one is where the trap is widest, so year one is what gets shown. */
  const p1 = m.path[0];
  if (p1) {
    /* The same deductions with the principal added to them, which is what
       "deducting the whole instalment" means. This was rent less all of the
       outgoings less the instalment, and the outgoings include the first
       tenant's placement fee, which is not deductible either — so on a managed
       deal the understatement credited to the instalment was the principal
       plus that fee: RM8,266 against RM6,466 of principal. */
    const naive = p1.taxable - p1.principal;
    const over = p1.taxable - naive;
    card.append(el('div', { style: 'margin-top:var(--lg);padding:var(--md);border:1px solid var(--bronze);border-radius:var(--r-md)' }, [
      el('p', { class: 'body', style: 'font-weight:600;margin:0' }, 'The instalment is not deductible. The interest inside it is.'),
      el('p', { class: 'metaline', style: 'margin-top:6px' },
        `In year one this property pays ${fmtMoney(p1.debt, 'MYR', 0)} to the bank, of which `
        + `${fmtMoney(p1.interest, 'MYR', 0)} is interest and ${fmtMoney(p1.principal, 'MYR', 0)} is principal. `
        + 'Only the interest is deductible — principal is repayment of borrowing, not a cost of earning rent. '
        + `Deducting the whole instalment would put taxable income at ${fmtMoney(naive, 'MYR', 0)} instead of `
        + `${fmtMoney(p1.taxable, 'MYR', 0)}, understating it by ${fmtMoney(Math.abs(over), 'MYR', 0)}.`),
      el('p', { class: 'metaline', style: 'margin-top:6px' },
        'The gap widens every year as principal takes a larger share of the same payment — by the final year of this hold '
        + `the split is ${fmtMoney(m.path[m.path.length - 1].interest, 'MYR', 0)} interest to `
        + `${fmtMoney(m.path[m.path.length - 1].principal, 'MYR', 0)} principal.`),
      el('p', { class: 'metaline', style: 'margin-top:6px' },
        'The fee for finding the first tenant is also excluded: getting a property into a lettable state is capital in nature. '
        + 'Finding a replacement tenant in later years is deductible.'),
    ]));
  }

  /* ---- year by year ---- */
  const t = el('table', { class: 'dt', style: 'margin-top:var(--lg)' });
  t.append(el('thead', {}, el('tr', {}, ['Year', 'Rent after vacancy', 'Outgoings', 'Interest', 'Principal', 'Taxable', 'Tax', 'Cash after tax']
    .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
  t.append(el('tbody', {}, m.path.map(p => el('tr', {}, [
    el('th', { scope: 'row', style: 'text-align:left' }, String(p.y)),
    el('td', { class: 'num' }, fmtMoney(p.rent, 'MYR', 0)),
    el('td', { class: 'num' }, fmtMoney(p.opex, 'MYR', 0)),
    el('td', { class: 'num' }, fmtMoney(p.interest, 'MYR', 0)),
    el('td', { class: 'num' }, fmtMoney(p.principal, 'MYR', 0)),
    el('td', { class: 'num' }, isNum(p.taxable) ? fmtMoney(p.taxable, 'MYR', 0) : '—'),
    el('td', { class: 'num' }, fmtMoney(p.tax, 'MYR', 0)),
    el('td', { class: 'num', style: p.cf < 0 ? 'color:var(--dn-text)' : null }, fmtMoney(p.cf, 'MYR', 0)),
  ]))));
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  gridKeyboard(t, 'Year by year rent, interest, tax and cash after tax. Arrow keys move between cells.');

  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'A year whose outgoings exceed its rent produces no tax and no credit: a rental loss from a non-business source is not '
    + 'carried forward and cannot be set against other income. Nothing here is tax advice — confirm your rate and your '
    + 'deductions with your own tax agent.'));
  return card;
}
