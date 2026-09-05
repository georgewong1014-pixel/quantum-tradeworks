/* ==========================================================================
   TWO FINANCING CHOICES, IN PLAIN WORDS
   --------------------------------------------------------------------------
   Both are decisions a buyer makes once, at the counter, under time pressure,
   on the strength of a number that has been quoted to them in a way they have
   no reason to distrust. Both cost real money. Neither was in this tool.

   1  FLAT AGAINST REDUCING. A lender may quote "4%" and mean two entirely
      different things. On a housing loan the interest is charged on what is
      still owed, which falls every month. On a flat-rate quote — common in
      renovation and personal financing, which is exactly what a buyer reaches
      for after completing — the interest is charged on the WHOLE amount for
      the WHOLE term, no matter how much has been paid back. Over a long term
      the same headline number costs close to twice as much.

      This is not modelled as an alternative for the property loan, because a
      Malaysian housing loan is a reducing-balance product and pretending
      otherwise would be its own error. It is modelled as a translator: enter a
      flat quote, and see what rate it really is.

   2  MRTA AGAINST MLTA. Previously one lumped line at a placeholder figure,
      which hid a decision with a large number attached — the premium is
      usually offered financed into the loan, so it is borrowed, and it is
      repaid over thirty-five years with interest on top.

   NO PREMIUMS ARE INVENTED HERE. A premium depends on age, health, sum, term
   and product; it comes from a quotation. The tool does the arithmetic on what
   the reader enters and explains what differs structurally. That is the part
   that can be got right without a quote.

   LANGUAGE. Every term of art in this file is introduced by what it means
   before it is named, or is not named at all. "Sum assured" is the payout.
   "Surrender value" is money you can get back. Nobody is asked to already know
   what amortisation is.
   ========================================================================== */

/* ------------------------------------------------- flat against reducing --- */

/* Flat: interest on the full amount for the full term. No solving needed —
   that is the whole point of it, and the whole reason it is quotable. */
function flatRateSchedule(principal, flatPct, years) {
  const months = Math.round(num0(years) * 12);
  if (!(principal > 0) || !(months > 0) || !isNum(flatPct)) {
    return { ok: false, why: 'Enter an amount, a rate and a term.' };
  }
  const totalInterest = principal * (flatPct / 100) * years;
  const total = principal + totalInterest;
  return { ok: true, principal, months, totalInterest, total, monthly: total / months };
}

/* The rate a reducing-balance loan would have to charge to cost the same
   monthly. Solved rather than approximated: there is no closed form.

   THE DIRECTION IS THE OPPOSITE OF THE OBVIOUS ONE, and this file first
   claimed it wrongly. A flat 4% is 7.42% over five years and only 6.02% over
   thirty-five. The penalty is WIDEST ON SHORT TERMS, because a long
   reducing-balance loan accumulates so much interest of its own that the flat
   quote has less room to be worse. The "roughly double" rule people repeat is
   about right for a short personal loan and overstates a long one.

   Which makes the point sharper rather than softer: flat quotes are used on
   short-term borrowing — renovation, furnishing, hire purchase — so they are
   used exactly where the penalty peaks. */
function reducingEquivalent(principal, flatPct, years) {
  const flat = flatRateSchedule(principal, flatPct, years);
  if (!flat.ok) return { rate: null, why: flat.why, flat };
  if (flatPct <= 0) return { rate: 0, flat };

  const f = (r) => monthlyInstalment(principal, r, years) - flat.monthly;
  let lo = 0, hi = 100;
  /* f is increasing in the rate. Below zero at lo and above at hi, or the
     bracket does not hold and no answer is reported rather than guessed. */
  if (!(f(lo) < 0) || !(f(hi) > 0)) return { rate: null, why: 'No equivalent rate inside a plausible range.', flat };
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = f(mid);
    if (Math.abs(v) < 1e-9 || hi - lo < 1e-12) return { rate: mid, flat };
    if (v < 0) lo = mid; else hi = mid;
  }
  return { rate: (lo + hi) / 2, flat };
}

/* The inverse, for a reader holding a reducing quote who is being offered a
   flat one and wants to know which is cheaper. */
function flatEquivalent(principal, reducingPct, years) {
  if (!(principal > 0) || !(years > 0) || !isNum(reducingPct)) return null;
  const pmt = monthlyInstalment(principal, reducingPct, years);
  if (!isNum(pmt)) return null;
  const totalInterest = pmt * years * 12 - principal;
  return totalInterest / (principal * years) * 100;
}

/* -------------------------------------------------- mortgage protection --- */

/* What a premium costs when it is borrowed rather than paid.
   The offer is nearly always "we can include it in the loan", which is true,
   and means the premium is repaid over the full term with interest. */
function premiumIfFinanced(premium, ratePct, tenureYears) {
  if (!(premium > 0) || !(tenureYears > 0) || !isNum(ratePct)) return null;
  const pmt = monthlyInstalment(premium, ratePct, tenureYears);
  if (!isNum(pmt)) return null;
  const totalPaid = pmt * tenureYears * 12;
  return { premium, monthlyAdded: pmt, totalPaid, interestOnPremium: totalPaid - premium };
}

/* The structural differences. Not opinions, and not a recommendation — the
   product does not make those. What each does, so a reader can decide. */
const PROTECTION_COMPARISON = [
  { q: 'What it pays out',
    mrta: 'Falls as the loan falls. Designed to clear what is still owed, and nothing more.',
    mlta: 'A fixed amount, the same for the whole term, whatever is left on the loan.' },
  { q: 'Who receives it',
    mrta: 'The bank, to settle the loan. Your family keeps the house, not a payout.',
    mlta: 'The loan is settled and anything left over goes to your family.' },
  { q: 'How you pay',
    mrta: 'One premium at the start, usually offered added to the loan.',
    mlta: 'A regular premium, paid separately from the loan.' },
  { q: 'Cost',
    mrta: 'Lower, because the cover shrinks over time.',
    mlta: 'Higher, because the cover does not shrink.' },
  { q: 'Money back if you never claim',
    mrta: 'None. Early settlement may refund part of the premium, but there is nothing to cash in.',
    mlta: 'Builds an amount you can get back if you stop it.' },
  { q: 'If you sell, refinance or move',
    mrta: 'Tied to that loan. A new loan means a new policy, at your age then.',
    mlta: 'Yours, and it carries over. Priced at the age you started.' },
  { q: 'If your health changes',
    mrta: 'A new policy later is assessed on your health at that time.',
    mlta: 'Already in force, so a later change does not reprice it.' },
];

/* ---------------------------------------------------------------- panel --- */
function financingChoicesPanel(d, m) {
  const card = el('div', { class: 'card' });
  card.append(cardHead('The two quotes that are easy to misread',
    'A rate can be quoted two ways that mean very different things, and the loan insurance is usually offered '
    + 'added to the loan rather than paid. Both are decided quickly at the counter and both cost real money.'));

  /* ---- 1. flat against reducing ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'When a lender says four per cent'));

  /* Compared over the term a flat quote actually runs for, not the mortgage
     term. Renovation and furnishing borrowing is a few years, and comparing it
     across thirty-five would understate the penalty and flatter the quote. */
  const mortgageYrs = num0(d.tenureYears) > 0 ? d.tenureYears : 35;
  const flatYrs = num0(d.flatQuoteYears) > 0 ? d.flatQuoteYears : 5;
  const flatAmount = num0(d.flatQuoteAmount) > 0 ? d.flatQuoteAmount
    : (num0(d.renovation) > 0 ? num0(d.renovation) : 50000);

  const f = el('div', { class: 'assumption', style: 'margin-top:var(--sm)' });
  f.append(el('label', { for: 'flatQuotePct' }, 'A rate you have been quoted as “flat” (%)'));
  f.append(el('input', { class: 'input a-text', id: 'flatQuotePct', type: 'number', min: '0', max: '30', step: '0.1',
    value: isNum(d.flatQuotePct) ? String(d.flatQuotePct) : '',
    placeholder: 'e.g. 4',
    'aria-label': 'A rate quoted to you as flat, in per cent',
    onchange: e => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      State.deal.flatQuotePct = isNum(v) && v > 0 ? v : null;
      markTouched(State.deal, 'flatQuotePct'); saveDeal(); render();
    } }));
  card.append(f);

  const fg = el('div', { class: 'grid g-2', style: 'margin-top:var(--sm)' });
  const q = (id, label, val, ph, step) => {
    const w = el('div', { class: 'assumption' });
    w.append(el('label', { for: id }, label));
    w.append(el('input', { class: 'input a-text', id, type: 'number', min: '0', step,
      value: isNum(val) ? String(val) : '', placeholder: ph, 'aria-label': label,
      onchange: e => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        State.deal[id] = isNum(v) && v > 0 ? v : null;
        markTouched(State.deal, id); saveDeal(); render();
      } }));
    return w;
  };
  fg.append(q('flatQuoteAmount', 'How much you would borrow (RM)', d.flatQuoteAmount, String(flatAmount), '1000'));
  fg.append(q('flatQuoteYears', 'Over how many years', d.flatQuoteYears, '5', '1'));
  card.append(fg);

  card.append(el('p', { class: 'body', style: 'margin-top:var(--sm)' },
    'On a housing loan, interest is charged only on what you still owe, and what you owe falls every month. '
    + 'On a flat-rate quote the interest is charged on the whole amount for the whole term, however much you have '
    + 'already paid back. The number sounds the same. The cost is not.'));
  card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'Compared below over ' + flatYrs + ' years on ' + fmtMoney(flatAmount, 'MYR', 0) + ', because that is the shape of '
    + 'the borrowing flat rates are used for. Comparing one across a thirty-five year mortgage term would flatter it.'));

  if (isNum(d.flatQuotePct) && d.flatQuotePct > 0 && flatAmount > 0) {
    const eq = reducingEquivalent(flatAmount, d.flatQuotePct, flatYrs);
    const realRate = eq.rate;
    const reducingPmt = monthlyInstalment(flatAmount, num0(d.ratePct), flatYrs);
    const reducingInterest = isNum(reducingPmt) ? reducingPmt * flatYrs * 12 - flatAmount : null;

    const g = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
    g.append(el('div', { class: 'panel' }, statTile('Quoted as flat',
      fmtPct(d.flatQuotePct, 2), { sub: `On ${fmtMoney(flatAmount, 'MYR', 0)} over ${flatYrs} years` })));
    g.append(el('div', { class: 'panel' }, statTile('What that really costs',
      isNum(realRate) ? fmtPct(realRate, 2) : '—',
      { sub: isNum(realRate) ? 'The same monthly payment, charged the normal way' : (eq.why || 'Not computable'), tone: '--bronze' })));
    g.append(el('div', { class: 'panel' }, statTile('Every month',
      isNum(eq.flat.monthly) ? fmtMoney(eq.flat.monthly, 'MYR', 0) : '—',
      { sub: isNum(reducingPmt) ? `Against ${fmtMoney(reducingPmt, 'MYR', 0)} at your ${fmtPct(num0(d.ratePct), 2)}` : 'Per month' })));
    card.append(g);

    if (isNum(realRate)) {
      const longRate = reducingEquivalent(flatAmount, d.flatQuotePct, 30).rate;
      card.append(el('p', { class: 'body', style: 'margin-top:var(--sm)' },
        `A flat ${fmtPct(d.flatQuotePct, 2)} over ${flatYrs} years is the same as paying `
        + `${fmtPct(realRate, 2)} the ordinary way — ${fmtPct(realRate - d.flatQuotePct, 2)} more than the number you were shown, `
        + 'because the interest keeps being charged on money you paid back years ago.'));
      if (isNum(longRate)) card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
        `The penalty is worst on short borrowing, which is where flat quotes are used. The same `
        + `${fmtPct(d.flatQuotePct, 2)} flat stretched over thirty years would work out at about ${fmtPct(longRate, 2)} — `
        + 'lower, because a long loan charged the ordinary way piles up plenty of interest by itself.'));
    }

    /* The picture: what you borrow against what the interest adds. */
    const block = el('div', { class: 'render-block', style: 'margin-top:var(--md)' });
    block.append(el('h4', { style: 'font-size:var(--text-lead);font-weight:var(--weight-semibold);margin:0' },
      'What you borrow, and what you hand back on top'));
    const host = el('div', { style: 'margin-top:var(--sm)' });
    block.append(host);
    const series = [
      { label: 'Amount borrowed', varName: '--s1', values: [flatAmount, flatAmount] },
      { label: 'Interest on top', varName: '--s2', values: [eq.flat.totalInterest, reducingInterest] },
    ];
    columnChart(host, {
      cats: [`Flat ${fmtPct(d.flatQuotePct, 2)}`, `Normal ${fmtPct(num0(d.ratePct), 2)}`],
      series, fmt: v => fmtMoney(v, 'MYR', 0),
      title: 'Amount borrowed and interest paid, flat quote against a normal housing loan',
    });
    const leg = el('div', { class: 'legend', style: 'margin-top:var(--sm)' });
    series.forEach(s2 => leg.append(el('span', { class: 'legend-item',
      html: `<span class="legend-key" style="background:var(${s2.varName})"></span>${esc(s2.label)}` })));
    block.append(leg);
    block.append(tableTwin('Show the table view',
      ['', `Flat ${fmtPct(d.flatQuotePct, 2)}`, `Normal ${fmtPct(num0(d.ratePct), 2)}`],
      series.map(s2 => [s2.label, ...s2.values.map(v => isNum(v) ? fmtMoney(v, 'MYR', 0) : '—')])));
    card.append(block);

    card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      'Housing loans in Malaysia are charged the ordinary way, so this is not a choice on the mortgage itself. '
      + 'It matters for the borrowing people take on afterwards — renovation and furnishing financing is frequently '
      + 'quoted flat, and it is quoted to someone who has just been reading housing-loan rates all week.'));
  } else {
    const eqFlat = flatEquivalent(flatAmount, num0(d.ratePct), flatYrs);
    if (isNum(eqFlat)) {
      card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
        `Borrowing ${fmtMoney(flatAmount, 'MYR', 0)} over ${flatYrs} years at your ${fmtPct(num0(d.ratePct), 2)} would be `
        + `about ${fmtPct(eqFlat, 2)} if it were quoted flat. A renovation lender offering less than that as a flat rate is `
        + 'genuinely cheaper. More, and it is not, whatever the headline says.'));
    }
  }

  /* ---- 2. MRTA against MLTA ---- */
  card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--lg) 0 6px' }, 'The loan insurance, and the cost of borrowing it'));
  card.append(el('p', { class: 'body' },
    'Lenders usually ask for cover that settles the loan if you die or become totally disabled. There are two kinds, '
    + 'and the difference is not the price — it is what happens to the cover over time, and what you are left with '
    + 'if you never claim.'));

  const fw = el('div', { class: 'grid g-2', style: 'margin-top:var(--md)' });
  const numField = (id, label, val, hint) => {
    const w = el('div', { class: 'assumption' });
    w.append(el('label', { for: id }, label));
    w.append(el('input', { class: 'input a-text', id, type: 'number', min: '0', step: '100',
      value: isNum(val) ? String(val) : '', placeholder: hint, 'aria-label': label,
      onchange: e => {
        const v = e.target.value === '' ? null : Number(e.target.value);
        State.deal[id] = isNum(v) && v > 0 ? v : null;
        markTouched(State.deal, id); saveDeal(); render();
      } }));
    return w;
  };
  fw.append(numField('mrtaPremium', 'One-off premium quoted for the reducing cover (RM)', d.mrtaPremium, 'from your quote'));
  fw.append(numField('mltaPremiumAnnual', 'Yearly premium quoted for the level cover (RM)', d.mltaPremiumAnnual, 'from your quote'));
  card.append(fw);

  if (isNum(d.mrtaPremium) && d.mrtaPremium > 0) {
    const fin = premiumIfFinanced(d.mrtaPremium, num0(d.ratePct), mortgageYrs);
    if (fin) {
      card.append(el('div', { style: 'margin-top:var(--md);padding:var(--md);border:1px solid var(--bronze);border-radius:var(--r-md)' }, [
        el('p', { class: 'body', style: 'font-weight:600;margin:0' }, 'Adding the premium to the loan is borrowing it.'),
        el('p', { class: 'metaline', style: 'margin-top:6px' },
          `A ${fmtMoney(d.mrtaPremium, 'MYR', 0)} premium added to the loan is repaid over ${mortgageYrs} years at `
          + `${fmtPct(num0(d.ratePct), 2)}. You hand back ${fmtMoney(fin.totalPaid, 'MYR', 0)} in total — `
          + `${fmtMoney(fin.interestOnPremium, 'MYR', 0)} of that is interest on the premium itself, and it adds `
          + `${fmtMoney(fin.monthlyAdded, 'MYR', 0)} to every monthly payment.`),
        el('p', { class: 'metaline', style: 'margin-top:6px' },
          'Paying it in cash on completion day avoids all of that, and costs you that cash on the day you have least of it. '
          + 'Both are defensible. The figure above is the price of the convenient one.'),
      ]));
    }
  }

  if (isNum(d.mltaPremiumAnnual) && d.mltaPremiumAnnual > 0 && isNum(d.mrtaPremium) && d.mrtaPremium > 0) {
    const fin = premiumIfFinanced(d.mrtaPremium, num0(d.ratePct), mortgageYrs);
    const mltaTotal = d.mltaPremiumAnnual * mortgageYrs;
    const g2 = el('div', { class: 'grid g-2', style: 'margin-top:var(--md)' });
    g2.append(el('div', { class: 'panel' }, statTile('Reducing cover, all in',
      fmtMoney(fin ? fin.totalPaid : d.mrtaPremium, 'MYR', 0),
      { sub: fin ? 'Premium plus the interest, if added to the loan' : 'Premium' })));
    g2.append(el('div', { class: 'panel' }, statTile('Level cover, all in',
      fmtMoney(mltaTotal, 'MYR', 0), { sub: `${fmtMoney(d.mltaPremiumAnnual, 'MYR', 0)} a year for ${mortgageYrs} years` })));
    card.append(g2);
    card.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'A total is not the whole comparison. The level cover leaves money behind if you claim, can be cashed in if you '
      + 'stop it, and follows you to another loan. The reducing cover does none of those and costs less. '
      + 'Which is worth more depends on what you want it to do.'));
  }

  const t = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  t.append(el('thead', {}, el('tr', {}, ['', 'Cover that shrinks with the loan', 'Cover that stays level']
    .map((h, i) => el('th', { style: i ? null : 'text-align:left' }, h)))));
  t.append(el('tbody', {}, PROTECTION_COMPARISON.map(r => el('tr', {}, [
    el('th', { scope: 'row', style: 'text-align:left' }, r.q),
    el('td', { style: 'white-space:normal;text-align:left' }, r.mrta),
    el('td', { style: 'white-space:normal;text-align:left' }, r.mlta),
  ]))));
  card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
  gridKeyboard(t, 'How the two kinds of loan cover differ. Arrow keys move between cells.');

  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'The trade names for these are MRTA for the cover that shrinks and MLTA for the cover that stays level, and the '
    + 'takaful equivalents are MRTT and MLTT. No premium is estimated here — it depends on your age, your health, '
    + 'the amount and the term, and it has to come from a quotation. Nothing here is insurance advice.'));

  return card;
}
