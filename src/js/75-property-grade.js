/* ==========================================================================
   BORROWER LOAN READINESS — specification 28.1, 30

   THE THING THIS MUST NOT BECOME

   The obvious feature is "you have a 72% chance of approval". It cannot be
   built. A real approval probability needs a large, current, lender-specific
   dataset of applications, verified inputs and outcomes, and nobody outside a
   lender has one. A number that looks like a probability and is not one is
   worse than no number, because a reader will plan around it.

   So this is a DIAGNOSTIC score: how much of what a lender will look at has
   been evidenced, and how much of it holds up under stress. It is labelled as
   that everywhere it appears.

   THREE SEPARATE THINGS, NEVER COLLAPSED (30.1)

     Borrower Loan Readiness      is the applicant strong and evidenced
     Property Financeability      is the property itself lendable
     Modelled Financing Coverage  what share of the price the scenario funds

   A strong borrower can face an unfinanceable property and the reverse. One
   opaque percentage hides exactly the fact the reader needs.

   PRIVACY

   Income, debts and credit conduct are the most sensitive data this product
   touches, and this build has no accounts and no server. They are held under
   their own storage key, never written to the URL, never included in the
   property export, and never used for anything but affordability — 2.1 forbids
   personal circumstances influencing security research, and there is no path
   from here into the equity engine.
   ========================================================================== */
const EMPLOYMENT_TYPES = [
  { id:'salaried', label:'Salaried' },
  { id:'commission', label:'Salaried with commission' },
  { id:'self_employed', label:'Self-employed' },
  { id:'company_director', label:'Company director' },
  { id:'mixed', label:'Mixed sources' },
];
const CREDIT_STATES = [
  { id:'not_checked', label:'Not checked yet', ok:false },
  { id:'none_reported', label:'Reviewed — nothing adverse reported', ok:true },
  { id:'present', label:'Reviewed — arrears or restructuring present', ok:true, adverse:true },
];
const BORROWER_DOCS = [
  { k:'identity',   label:'Identity documents' },
  { k:'payslips',   label:'Recent payslips or income statements' },
  { k:'epf',        label:'EPF contribution statement' },
  { k:'bank',       label:'Bank statements showing income credited' },
  { k:'tax',        label:'Filed tax return or assessment' },
  { k:'employment', label:'Employment or business confirmation' },
  { k:'existing',   label:'Statements for existing loans' },
  { k:'deposit',    label:'Evidence of where the deposit came from' },
];

State.borrower = store.read('borrowerProfile', null) || {
  assessed: false,
  employmentType: 'salaried',
  verifiedNetMonthlyIncome: 0,
  variableIncomeMonthlyAverage: 0,
  variableIncomeLookbackMonths: 0,
  existingMonthlyDebtPayments: 0,
  essentialMonthlyCommitments: 0,
  creditCardUtilisationPct: 0,
  liquidCashAvailable: 0,
  incomeStabilityMonths: 0,
  creditReview: 'not_checked',
  applicantCount: 1,
  docs: {},
};
const saveBorrower = () => store.write('borrowerProfile', State.borrower);

/* Specification 30.3. Every figure shows its own formula on screen, because a
   ratio a reader cannot reproduce is a number they have to trust. */
function borrowerAffordability(b, m) {
  const income = num0(b.verifiedNetMonthlyIncome);
  const existing = num0(b.existingMonthlyDebtPayments);
  const essentials = num0(b.essentialMonthlyCommitments);
  const instalment = isNum(m?.instalment) ? m.instalment : null;
  /* Three points above the entered rate, the top of the range 31.7 asks for. */
  const stressedInstalment = (isNum(m?.loan) && m?.tenureValid)
    ? monthlyInstalment(m.loan, num0(m.inputRatePct) + 3, num0(m.tenureYears)) : null;

  const ok = income > 0 && isNum(instalment);
  return {
    income, existing, essentials, instalment, stressedInstalment,
    baseTotalDebt: ok ? existing + instalment : null,
    baseDSR: ok ? (existing + instalment) / income * 100 : null,
    stressedDSR: (ok && isNum(stressedInstalment)) ? (existing + stressedInstalment) / income * 100 : null,
    cashLeftAfterDebt: ok ? income - existing - instalment : null,
    cashLeftAfterEssentials: ok ? income - existing - instalment - essentials : null,
    computable: ok,
  };
}

const READINESS_COMPONENTS = [
  { k:'affordability', label:'Affordability and stress capacity', weight:25 },
  { k:'credit',        label:'Credit conduct',                    weight:20 },
  { k:'income',        label:'Income quality and stability',      weight:20 },
  { k:'buffer',        label:'Liquid buffer',                     weight:15 },
  { k:'documents',     label:'Documentation readiness',           weight:10 },
  { k:'structure',     label:'Application structure',             weight:10 },
];

function loanReadiness(b, m) {
  const a = borrowerAffordability(b, m);
  const scores = {}, notes = {}, unknowns = [];

  if (a.computable && isNum(a.stressedDSR)) {
    /* Not a pass mark. BNM's financial-stability work identifies debt service
       above 60% of net income as a higher-vulnerability group, which is a
       description of risk rather than a lender's threshold — individual lenders
       set their own and they differ. Scored as a gradient for that reason. */
    const dsrPart = clamp((75 - a.stressedDSR) / 45 * 60, 0, 60);
    const cashPart = a.cashLeftAfterEssentials > 0
      ? clamp(a.cashLeftAfterEssentials / (a.income * 0.2) * 40, 0, 40) : 0;
    scores.affordability = Math.round(dsrPart + cashPart);
    notes.affordability = `Debt service ${fmtPct(a.baseDSR, 1)} of net income now, ${fmtPct(a.stressedDSR, 1)} at three points higher. ${fmtAmount(a.cashLeftAfterEssentials, 'MYR')} left after debt and essentials.`;
  } else { scores.affordability = null; notes.affordability = 'Net income or the instalment is missing, so affordability cannot be tested.'; unknowns.push('affordability'); }

  const credit = CREDIT_STATES.find(c => c.id === b.creditReview);
  if (!credit?.ok) { scores.credit = null; notes.credit = 'The credit record has not been reviewed. This is the single most common reason an application that looks affordable is declined.'; unknowns.push('credit conduct'); }
  else {
    const util = num0(b.creditCardUtilisationPct);
    scores.credit = Math.round(clamp((credit.adverse ? 35 : 100) - util * 0.4, 0, 100));
    notes.credit = credit.adverse
      ? 'Arrears or restructuring are present on the record. Lenders weigh recency and resolution, and this needs explaining rather than hiding.'
      : `Nothing adverse reported. Revolving utilisation ${fmtPct(util, 0)}.`;
  }

  const months = num0(b.incomeStabilityMonths);
  const variable = num0(b.variableIncomeMonthlyAverage);
  const lookback = num0(b.variableIncomeLookbackMonths);
  if (a.income > 0) {
    let s = clamp(months / 24 * 60, 0, 60);
    /* Variable income counts only where it has been averaged over a period.
       A single good month is not income, and 30.1 forbids treating it as one. */
    s += variable > 0 ? (lookback >= 6 ? 40 : lookback >= 3 ? 20 : 0) : 40;
    scores.income = Math.round(clamp(s, 0, 100));
    notes.income = variable > 0
      ? `${months} months in the current role or business; variable income averaged over ${lookback} months.`
      : `${months} months in the current role or business; no variable component entered.`;
    if (variable > 0 && lookback < 3) notes.income += ' A variable component with under three months of history is not evidence of recurring income.';
  } else { scores.income = null; notes.income = 'No verified net income entered.'; unknowns.push('income'); }

  if (isNum(m?.safeCashRequired) && m.safeCashRequired > 0) {
    const cash = num0(b.liquidCashAvailable);
    scores.buffer = Math.round(clamp(cash / m.safeCashRequired * 100, 0, 100));
    notes.buffer = cash >= m.safeCashRequired
      ? `${fmtAmount(cash, 'MYR')} available against ${fmtAmount(m.safeCashRequired, 'MYR')} required, including the reserve.`
      : `${fmtAmount(cash, 'MYR')} available against ${fmtAmount(m.safeCashRequired, 'MYR')} required — short by ${fmtAmount(m.safeCashRequired - cash, 'MYR')}, and borrowing that shortfall would change the affordability above.`;
  } else { scores.buffer = null; notes.buffer = 'The cash requirement could not be computed.'; unknowns.push('liquid buffer'); }

  const provided = BORROWER_DOCS.filter(x => b.docs?.[x.k] === 'verified' || b.docs?.[x.k] === 'provided').length;
  scores.documents = Math.round(provided / BORROWER_DOCS.length * 100);
  notes.documents = `${provided} of ${BORROWER_DOCS.length} documents gathered. A lender's own checklist overrides this one.`;

  scores.structure = num0(b.applicantCount) >= 1 && a.income > 0 ? 70 : null;
  notes.structure = 'Applicant count and tenure fit recorded. Joint-applicant evidence and declared source of funds are not modelled in this build.';
  if (scores.structure == null) unknowns.push('application structure');

  const tested = READINESS_COMPONENTS.filter(c => isNum(scores[c.k]));
  const testedWeight = tested.reduce((s, c) => s + c.weight, 0);
  const total = READINESS_COMPONENTS.reduce((s, c) => s + c.weight, 0);
  const score = testedWeight > 0
    ? Math.round(tested.reduce((s, c) => s + scores[c.k] * c.weight, 0) / testedWeight) : null;

  /* A critical unknown must not be hidden behind a numeric total. */
  let band;
  if (unknowns.includes('credit conduct') || unknowns.includes('affordability') || score == null) band = 'Not assessed';
  else if (score >= 80) band = 'Strong readiness';
  else if (score >= 65) band = 'Workable with conditions';
  else if (score >= 50) band = 'Marginal';
  else band = 'Currently weak';

  return { score, band, scores, notes, unknowns, affordability: a,
           coverage: testedWeight / total,
           components: READINESS_COMPONENTS.map(c => ({ ...c, score: scores[c.k], note: notes[c.k] })) };
}

/* ==========================================================================
   QT PROPERTY UNDERWRITING GRADE — specification 31

   Named for what it is. Not "investment grade", which reads as a credit
   rating, and not a bank decision: it answers one question only —

     on the evidence and assumptions entered, how well does this property meet
     the selected acquisition criteria, and does it survive reasonable downside?

   It does not say whether a lender will approve the loan, what the property is
   worth, or whether the title is clear. Those are a lender, a registered valuer
   and a lawyer, and the grade names them rather than standing in for them.

   HARD GATES ARE NOT AVERAGED. A pillar score can be pulled up by its
   neighbours; a gate cannot. An unresolved title question caps the whole report
   at U however good the arithmetic is, because arithmetic on a property you may
   not be permitted to buy is not a finding about the property.
   ========================================================================== */
/* Six pillars, per the execution directive 6.5, which supersedes the migration
   specification's seven at 31.2. The two disagree in two places: the directive
   raises evidence quality from 15 to 20, and folds operations readiness into
   local demand rather than scoring it separately at 5.

   Merging was the right call and not merely the controlling one. Operations
   readiness had nothing to score against — the operating plan is a later
   release — so it sat permanently untestable, holding maximum coverage at 95%
   and making a nominal weight look like a measured one. A weight that can never
   be earned is not strictness, it is a rounding error with a label. */
const GRADE_PILLARS = [
  { k:'evidence',  label:'Evidence quality',            weight:20 },
  { k:'price',     label:'Price and valuation support', weight:15 },
  { k:'financing', label:'Financing resilience',        weight:20 },
  { k:'cashflow',  label:'Rental cash flow',            weight:20 },
  { k:'downside',  label:'Downside and exit',           weight:15 },
  { k:'demand',    label:'Local demand and management readiness', weight:10 },
];

/* Specification 30.4. Deliberately independent of the borrower: a strong
   applicant can face a property no lender will take, and the reverse. Where a
   hard gate is unknown the answer is "verify this", never zero and never a
   pass — an averaged pass on a title question is the most expensive kind of
   false comfort this tool could offer. */
const FINANCEABILITY_COMPONENTS = [
  { k:'title',      label:'Title and legal transfer',        weight:25 },
  { k:'valuation',  label:'Valuation support',               weight:20 },
  { k:'status',     label:'Lender-acceptable property status',weight:15 },
  { k:'tenure',     label:'Tenure and remaining lease',      weight:10 },
  { k:'condition',  label:'Physical and insurance condition', weight:10 },
  { k:'liquidity',  label:'Market liquidity',                weight:10 },
  { k:'documents',  label:'Documentation readiness',         weight:10 },
];

function propertyFinanceability(d, m) {
  const scores = {}, notes = {}, gates = [];
  const title = TITLE_TYPES.find(t => t.id === d.titleType);

  if (!d.titleType || d.titleType === 'unknown') {
    scores.title = null;
    notes.title = 'Title class not established.';
    gates.push('Title class and transfer eligibility are unverified. Nothing else here can compensate for that.');
  } else if (title?.restricted) {
    scores.title = null;
    notes.title = `${title.label} — a restricted class.`;
    gates.push(`Transfer of ${title.label} is restricted under the Sarawak Land Code and eligibility has not been confirmed.`);
  } else { scores.title = 100; notes.title = `${title.label}, recorded from what you entered and not independently verified.`; }

  if (m.financingBasisConfirmed) {
    const gapPct = d.price > 0 ? m.valuationGapCash / d.price * 100 : 0;
    scores.valuation = Math.round(clamp(100 - gapPct * 8, 0, 100));
    notes.valuation = gapPct > 0
      ? `Valuation ${fmtPct(gapPct, 1)} below the price, leaving ${fmtAmount(m.valuationGapCash, 'MYR')} to fund in cash.`
      : 'Valuation at or above the price.';
  } else { scores.valuation = null; notes.valuation = 'No bank or valuer estimate entered.'; gates.push('No valuation evidence, so whether a lender will lend against this price is unknown.'); }

  if (d.titleType === 'strata') {
    scores.status = 70;
    notes.status = 'Strata parcel. Whether the strata title has actually issued, or the property is still on a master title, changes what a lender will accept.';
  } else { scores.status = 80; notes.status = 'Completion and occupancy documentation is not modelled in this build.'; }

  if (d.titleType === 'strata') { scores.tenure = 90; notes.tenure = 'Not applicable to a strata parcel in this build.'; }
  else {
    const yrs = num0(d.remainingLease);
    scores.tenure = yrs === 0 ? 100 : Math.round(clamp((yrs - 30) / 60 * 100, 0, 100));
    notes.tenure = yrs === 0 ? 'Recorded as freehold.'
      : `${yrs} years remaining. Lenders apply their own minimum against the loan tenure and the borrower's age — confirm with the intended lender rather than against a general rule.`;
  }

  const flood = d.checks?.flood;
  scores.condition = flood === 'yes' ? 35 : flood === 'no' ? 90 : null;
  notes.condition = flood === 'yes' ? 'A flood history is recorded, which bears on insurability and therefore on financing.'
    : flood === 'no' ? 'No flood history recorded against this site.'
    : 'Flood history has not been answered, and insurance availability follows from it.';
  if (scores.condition == null) gates.push('Flood history and insurability are unanswered, and financing commonly requires insurance.');

  const resale = d.checks?.['resale-time'];
  scores.liquidity = m.proj?.custom ? 40 : (resale ? 75 : 55);
  notes.liquidity = m.proj?.custom
    ? 'No transacted evidence is held for this location, so the buyer pool and realistic sale period are unknown.'
    : 'Sample comparable transactions exist for this project.';

  const answered = SARAWAK_CHECKS.filter(c => d.checks?.[c.id]).length;
  scores.documents = Math.round(answered / SARAWAK_CHECKS.length * 100);
  notes.documents = `${answered} of ${SARAWAK_CHECKS.length} verification questions answered.`;

  const tested = FINANCEABILITY_COMPONENTS.filter(c => isNum(scores[c.k]));
  const testedWeight = tested.reduce((s, c) => s + c.weight, 0);
  const total = FINANCEABILITY_COMPONENTS.reduce((s, c) => s + c.weight, 0);
  const score = testedWeight > 0
    ? Math.round(tested.reduce((s, c) => s + scores[c.k] * c.weight, 0) / testedWeight) : null;

  return { score: gates.length ? null : score, rawScore: score, gates, scores, notes,
           coverage: testedWeight / total,
           components: FINANCEABILITY_COMPONENTS.map(c => ({ ...c, score: scores[c.k], note: notes[c.k] })) };
}

function propertyGrade(d, m) {
  const gates = [];
  const scores = {};
  const notes = {};

  /* ---- hard gates ---------------------------------------------------- */
  const title = TITLE_TYPES.find(t => t.id === d.titleType);
  if (!d.titleType || d.titleType === 'unknown')
    gates.push({ id:'title-unknown', severity:'critical',
      text:'The title class has not been established, so whether this purchase is open to you at all is unknown.',
      caps:'U', who:'A Sarawak property lawyer and the Land and Survey Department' });
  else if (title?.restricted)
    gates.push({ id:'title-restricted', severity:'critical',
      text:`Title recorded as ${title.label}. Transfer of this class is restricted under the Sarawak Land Code and eligibility has not been verified.`,
      caps:'U', who:'A Sarawak property lawyer and the Land and Survey Department' });

  if (isNum(m.dscr) && m.dscr < 1)
    gates.push({ id:'dscr', severity:'serious',
      text:`Rent does not cover debt service. Cover is ${fmtX(m.dscr, 2)}, so the shortfall is funded from your own income every month.`,
      caps:null });
  if (isNum(m.breakEvenOccupancy) && m.breakEvenOccupancy > 100)
    gates.push({ id:'breakeven', severity:'serious',
      text:`Cannot break even at the entered rent and cost structure. It would need ${fmtPct(m.breakEvenOccupancy, 0)} occupancy, and 100% is the maximum.`,
      caps:null });
  if (!isNum(m.reserveCash) || m.reserveCash <= 0)
    gates.push({ id:'no-reserve', severity:'serious',
      text:'No safe reserve is held after completion. A single vacancy or major repair would have to be funded by new borrowing.',
      caps:'B' });
  /* Recorded evidence now clears this. It used to fire purely on whether a
     sample project was selected, so a reader who had sourced twenty verified
     transactions for their own district still read "no transacted price or
     rental evidence is held for this location" — the register recorded evidence
     and nothing consumed it, which made the sourcing pointless. */
  const cmp = comparableSupport(d);
  if (m.proj?.custom && !cmp.hasVerifiedPrice)
    gates.push({ id:'no-comparable', severity:'warning',
      text: cmp.price.all
        ? `${cmp.price.all} transacted comparable${cmp.price.all === 1 ? '' : 's'} recorded for this district and property type, but none is verified — each needs a source reference and a check against it before it can support a grade.`
        : 'No transacted price or rental evidence is held for this location, so nothing here has been checked against a market.',
      caps:'B' });

  /* A comparable set that disagrees with the entered price is a finding, not a
     footnote — and it is only available once somebody has done the sourcing. */
  if (cmp.hasVerifiedPrice && isNum(cmp.priceVsMedian) && Math.abs(cmp.priceVsMedian) > 15)
    gates.push({ id:'price-vs-comparables', severity:'warning',
      text:`The entered price is ${fmtPct(Math.abs(cmp.priceVsMedian), 0)} ${cmp.priceVsMedian > 0 ? 'above' : 'below'} the median of ${cmp.price.verified} verified transacted comparable${cmp.price.verified === 1 ? '' : 's'} for this district and property type (${fmtAmount(cmp.price.lo, 'MYR')}–${fmtAmount(cmp.price.hi, 'MYR')}). That can be right — condition, floor, tenure and timing all move a price — but it is the difference to explain before relying on the return figures.`,
      caps:null });

  const untouchedDrivers = EVIDENCE_DRIVERS.filter(k => shownEvidence(d, k) === 'illustrative_default');
  if (untouchedDrivers.length)
    gates.push({ id:'illustrative', severity:'critical',
      text:`${untouchedDrivers.length} of the figures driving every output — ${untouchedDrivers.join(', ')} — are still this tool's starting numbers rather than yours.`,
      caps:'U' });

  /* An ACHIEVED rent comparable is an executed tenancy by definition, so it is
     exactly the evidence this gate asks for. A verified one in the same
     district and property type clears it whatever the dropdown says; an asking
     rent never does, however many are recorded. */
  const rentEvidence = evidenceOf(shownEvidence(d, 'rent'));
  if (rentEvidence.rank < 3 && !cmp.hasVerifiedRent)
    gates.push({ id:'unverified-rent', severity:'warning',
      text: cmp.rent.all
        ? `${cmp.rent.all} achieved-rent comparable${cmp.rent.all === 1 ? '' : 's'} recorded for this district and property type, but none is verified, so every return figure below is still assumption-driven.`
        : 'The rent is not supported by an executed tenancy or a transacted comparable, so every return figure below is assumption-driven.',
      caps:null, capsPillar:'evidence' });

  /* ---- pillars -------------------------------------------------------- */
  /* Each returns 0–100 or null. Null is not zero: a pillar that could not be
     tested is excluded from the weighted score and reduces coverage instead,
     so a company cannot lose points for evidence nobody has. */
  const evRanks = EVIDENCE_DRIVERS.map(k => evidenceOf(shownEvidence(d, k)).rank);
  scores.evidence = Math.round(evRanks.reduce((a, b) => a + Math.max(0, b), 0) / (EVIDENCE_DRIVERS.length * 5) * 100);
  if (gates.some(g => g.capsPillar === 'evidence')) {
    scores.evidence = Math.min(scores.evidence, 50);
    notes.evidence = 'Capped at 50 because the rent has no transacted support.';
  }

  if (m.financingBasisConfirmed && isNum(m.valuationGapCash) && d.price > 0) {
    const gapPct = m.valuationGapCash / d.price * 100;
    scores.price = Math.round(clamp(100 - gapPct * 8, 0, 100));
    notes.price = gapPct > 0
      ? `Valuation is ${fmtPct(gapPct, 1)} below the price, which is cash you must find.`
      : 'Valuation is at or above the price.';
  } else {
    scores.price = null;
    notes.price = 'No bank or valuer estimate has been entered, so there is nothing to test the price against.';
  }

  if (isNum(m.dscr)) {
    /* 1.00x is the floor at which rent just covers the loan before tax and any
       major repair. 1.50x is comfortable. */
    scores.financing = Math.round(clamp((m.dscr - 0.9) / 0.6 * 100, 0, 100));
    notes.financing = `Debt-service cover ${fmtX(m.dscr, 2)}.`;
  } else if (m.loan === 0) {
    scores.financing = 100; notes.financing = 'Cash purchase — no financing risk.';
  } else { scores.financing = null; notes.financing = 'Debt-service cover could not be computed.'; }

  if (isNum(m.netYield) && isNum(m.cashflowMonthly)) {
    const yieldPart = clamp(m.netYield / 5 * 60, 0, 60);
    const cashPart = m.cashflowMonthly >= 0 ? 40 : clamp(40 + m.cashflowMonthly / 40, 0, 40);
    scores.cashflow = Math.round(yieldPart + cashPart);
    notes.cashflow = m.annualOwnerSubsidy > 0
      ? `Net yield ${fmtPct(m.netYield, 2)}, and the property costs ${fmtAmount(m.annualOwnerSubsidy, 'MYR')} a year to hold.`
      : `Net yield ${fmtPct(m.netYield, 2)}, cash-flow positive.`;
  } else { scores.cashflow = null; notes.cashflow = 'Operating cash flow could not be computed.'; }

  /* Downside rests on the stress the model already runs. Its own resilience is
     how far the worst case sits from the break-even. */
  /* The stress rows carry `monthly`, not `cashflowMonthly` — reading the wrong
     key returned undefined, made this pillar untestable, and silently held
     coverage at 80% so an A could never be awarded however good the deal was.
     A scoring model whose top grade is unreachable is not a strict model, it is
     a broken one.

     Both stresses are taken, not just the rate: a property can survive higher
     rates and not survive a vacancy, and the weaker of the two is the one that
     decides whether it holds. */
  const worstRate = m.stress?.rate?.[m.stress.rate.length - 1]?.monthly;
  const worstVac = m.stress?.vacancy?.[m.stress.vacancy.length - 1]?.monthly;
  const worstCase = [worstRate, worstVac].filter(isNum);
  if (worstCase.length) {
    const worst = Math.min(...worstCase);
    scores.downside = Math.round(clamp(50 + worst / 30, 0, 100));
    notes.downside = `Worst modelled month is ${fmtAmount(worst, 'MYR')}, across the highest rate and the deepest vacancy tested.`;
  } else { scores.downside = null; notes.downside = 'The downside cases could not be computed.'; }

  /* Demand and management readiness together, per directive 6.5. The management
     half is the operating plan, which arrives in a later release — so it is
     named as absent inside this pillar rather than carried as a separate weight
     nothing can earn. */
  const answered = SARAWAK_CHECKS.filter(c => d.checks?.[c.id]).length;
  scores.demand = Math.round(answered / SARAWAK_CHECKS.length * 100);
  notes.demand = `${answered} of ${SARAWAK_CHECKS.length} local demand questions answered. Management readiness is not yet modelled in this build and contributes nothing to this pillar either way.`;


  /* ---- weighted score over what was actually tested -------------------- */
  const tested = GRADE_PILLARS.filter(p => isNum(scores[p.k]));
  const testedWeight = tested.reduce((s, p) => s + p.weight, 0);
  const totalWeight = GRADE_PILLARS.reduce((s, p) => s + p.weight, 0);
  const coverage = testedWeight / totalWeight;
  const score = testedWeight > 0
    ? Math.round(tested.reduce((s, p) => s + scores[p.k] * p.weight, 0) / testedWeight)
    : null;

  /* ---- grade ---------------------------------------------------------- */
  const capU = gates.some(g => g.caps === 'U');
  const capB = gates.some(g => g.caps === 'B');
  let grade, verdict;
  if (capU || coverage < 0.80 || score == null) {
    grade = 'U';
    verdict = 'Not enough evidence';
  } else {
    if (score >= 80 && coverage >= 0.90) grade = 'A';
    else if (score >= 65 && coverage >= 0.80) grade = 'B';
    else if (score >= 50) grade = 'C';
    else grade = 'D';
    if (capB && grade === 'A') grade = 'B';
    verdict = { A:'Meets the selected underwriting criteria',
                B:'Conditional — verify the named items',
                C:'Does not yet meet several criteria',
                D:'Does not meet the selected underwriting criteria' }[grade];
  }

  return { grade, verdict, score, coverage, scores, notes, gates,
           pillars: GRADE_PILLARS.map(p => ({ ...p, score: scores[p.k], note: notes[p.k] })) };
}

function dealModel(d) {
  const proj = activeProject(d);

  /* ---- financing basis (specification 29.2) ---------------------------- */
  /* A lender lends against its own value, not against what the buyer agreed to
     pay. Where the valuation comes in below the price, the difference is not a
     smaller loan — it is cash the buyer has to find on completion day, on top
     of the deposit. The calculator previously took the loan straight off the
     price, so a low valuation was invisible until it was someone's problem.

     The lower-of rule is this scenario's default, not a claim that every lender
     applies it. The rule in force is stored so it can be replaced with a
     lender's actual policy and evidence. */
  const marginOfFinancePct = clamp(100 - num0(d.downPct), 0, 100);
  const bankValuation = isNum(d.bankValuation) && d.bankValuation > 0 ? d.bankValuation : null;
  const valuationRule = d.valuationRule || 'lower_of';
  const lenderValueBasis = (bankValuation != null && valuationRule === 'lower_of')
    ? Math.min(d.price, bankValuation)
    : (bankValuation != null && valuationRule === 'valuation_only' ? bankValuation : d.price);
  /* Absent a valuation the basis IS the price, and that is an assumption rather
     than a finding — the report says so rather than letting the number pass as
     lender-confirmed. */
  const financingBasisConfirmed = bankValuation != null;
  const valuationGapCash = Math.max(0, d.price - lenderValueBasis);

  const loan = lenderValueBasis * marginOfFinancePct / 100;
  /* Split as the specification's ledger splits it: the deposit against the
     basis the lender used, and the gap as its own line. Together they are the
     buyer's whole equity, and separating them shows which part is a choice and
     which part the valuation forced. */
  const deposit = lenderValueBasis - loan;

  /* What the same purchase looks like at other margins of finance. Scenarios,
     not offers — no lender has seen this. */
  /* The entered margin is included as its own row rather than matched against
     the three fixed ones. The chip used to sit on whichever of 70/80/90 came
     within half a point, so an entered 89.6% marked the 90% row and reported a
     loan and cash equity that were not the model's. */
  const scenarioMargins = [...new Set([70, 80, 90, +marginOfFinancePct.toFixed(2)])].sort((a, b) => a - b);
  const financingScenarios = scenarioMargins.map(mof => {
    const scLoan = lenderValueBasis * mof / 100;
    return { mof, loan: scLoan,
             cashEquity: d.price - scLoan,
             instalment: monthlyInstalment(scLoan, d.ratePct, d.tenureYears),
             coverageOfPrice: scLoan / d.price * 100 };
  });
  const duty = stampDutyMOT(d.price);
  const legal = legalFeesBuy(d.price);
  const loanDuty = loanStampDuty(loan);
  /* Renovation and furnishing is cash out of the same pocket on the same day
     as the deposit. Leaving it out of "cash required" is the most common way a
     property model understates what the purchase actually takes. */
  const renovation = num0(d.renovation);
  /* Grouped rather than summed into one figure. The headline used to name four
     components and total five, so the arithmetic on screen did not add up:
     RM57.2k + RM11.2k + RM6.3k + RM2.6k is RM77.3k, and the stated total was
     RM102.2k. The missing RM25k was renovation, included in the sum and absent
     from the sentence. Every total below reconciles from its own parts. */
  /* Section 29.4 requires every completion-cost line to appear, with its basis
     and whether it is unset. A line the registry cannot price is listed with a
     null amount rather than omitted — an absent row reads as a cost that does
     not exist, and these all exist. */
  const feeLine = (id, bases) => { const r = resolveFee(id, bases); return [r.label, r.amount, r]; };
  /* Null, not zero. Coercing an unpriced legal fee to 0 made the tax on it
     resolve to a priced RM0 line — a real-looking row for a cost that exists
     and has not been calculated, absent from the missing-lines list because it
     had a number. A tax on an unknown fee is unknown. */
  const legalBase = isNum(legal) ? legal : null;
  const costGroups = [
    { id:'acquisition', label:'Acquisition costs', items:[
        ['Deposit', deposit],
        /* Only when it exists. A zero row for a gap there isn't would train the
           reader to skip the line that matters when there is one. */
        ...(valuationGapCash > 0 ? [['Valuation-gap cash', valuationGapCash]] : []),
        feeLine('transferStampDuty', { price: d.price }),
        feeLine('purchaseLegal', { price: d.price }),
        feeLine('disbursements', {}),
        feeLine('professionalServiceTax', { legalFees: legalBase }),
      ] },
    { id:'financing', label:'Financing costs', items:[
        feeLine('loanStampDuty', { loan }),
        feeLine('loanLegal', { loan }),
        feeLine('valuationFee', { price: d.price }),
        feeLine('mortgageProtection', {}),
      ] },
    { id:'improvement', label:'Initial improvement costs', items:[
        ['Renovation and furnishing', renovation],
        feeLine('utilityDeposits', {}),
      ] },
  ];

  /* Which lines exist but cannot yet be priced. Carried on the model so every
     total that depends on them can say it is incomplete rather than presenting
     a short number as though it were the answer. */
  const missingCostLines = costGroups.flatMap(g =>
    g.items.filter(it => !isNum(it[1])).map(it => ({ group: g.label, label: it[0], why: it[2]?.why })));

  /* How much of the completion cash rests on a figure nobody has checked. A
     placeholder total looks exactly like a finished one, so the proportion has
     to be computed and stated rather than left for the reader to work out from
     a scatter of markers. */
  const unconfirmedCost = costGroups.flatMap(g => g.items)
    .filter(it => it[2] && it[2].status !== 'verified' && isNum(it[1]))
    .reduce((t, it) => t + it[1], 0);
  const placeholderCostLines = costGroups.flatMap(g => g.items)
    .filter(it => it[2]?.status === 'placeholder' && isNum(it[1]))
    .map(it => ({ label: it[0], amount: it[1] }));

  /* Three months of instalment and running cost, held back rather than spent.
     Not part of the purchase, but part of what the purchase requires.

     Sums only what is priced. It was deposit + duty + legal + loanDuty +
     renovation with every term assumed present; a single null now makes the
     whole figure NaN rather than quietly short, and the report says how many
     lines are missing beside it. */
  const sumPriced = (xs) => xs.reduce((t, v) => t + (isNum(v) ? v : 0), 0);
  /* Every cash line except the reserve, which has not been added to the groups
     at this point. Derived from the groups rather than by re-listing the terms,
     because the previous version matched on label text and would silently drop
     a line the moment one was renamed. */
  const acquisitionCost = sumPriced(costGroups.flatMap(g => g.items.map(it => it[1])));

  /* Financing coverage as a share of what is actually being paid, which is the
     figure a buyer needs — a 90% margin of finance against a valuation 10%
     below the price funds 81% of the price, and the difference is cash. */
  const financingCoverageOfPrice = d.price > 0 ? loan / d.price * 100 : null;

  /* A tenure of zero or less has no amortisation schedule. It used to produce a
     negative instalment, a zero reserve and a closing balance several times the
     principal, none of it flagged. Reported as not computable instead. */
  const tenureValid = num0(d.tenureYears) > 0;
  const instalment = tenureValid ? monthlyInstalment(loan, d.ratePct, d.tenureYears) : null;
  /* A cleared rate box reads as 0 through num0, and 0% is a legitimate entry —
     so the two cannot be told apart from the value alone, and a zero rate cuts
     the instalment by roughly half. Flagged rather than guessed at. */
  const zeroRateModelled = num0(d.ratePct) === 0;
  const grossAnnualRent = d.rent * 12;
  const effectiveRent = grossAnnualRent * (1 - d.vacancyPct / 100);
  /* Running costs, separated so each is visible and editable rather than
     folded into one figure the reader has to take on trust. A repair reserve
     is charged against rent because the repairs happen whether or not anyone
     budgeted for them. */
  const maintenanceY = num0(d.maintenance) * 12;
  const sinkingY = num0(d.sinkingFund) * 12;
  const statutoryY = num0(d.assessment) + num0(d.quitRent);
  const insuranceY = num0(d.insurance);
  /* MANAGEMENT, SPLIT THE WAY THE BREAK-EVEN NEEDS IT.

     A percentage of collected rent scales with rent; a minimum monthly fee and
     a tenant-placement fee do not. The break-even calculation below depends on
     that distinction — it puts rent-linked costs in the denominator as a rate
     and fixed costs in the numerator — so folding a flat fee into the
     percentage would reintroduce exactly the defect the note down there
     describes.

     Placement is charged once per tenancy cycle and amortised. It assumes the
     tenant leaves at the end of every tenancy, which is the conservative case;
     the renewal figure is reported beside it so the better case is visible
     rather than assumed. */
  const managed = !d.selfManaged;
  const monthsPerCycle = Math.max(1, num0(d.tenancyMonths));
  const cyclesPerYear = 12 / monthsPerCycle;
  const mgmtY = managed ? effectiveRent * num0(d.mgmtPct) / 100 : 0;
  const mgmtMinAnnual = managed ? num0(d.mgmtMinMonthly) * 12 : 0;
  const mgmtMinTopUp = Math.max(0, mgmtMinAnnual - mgmtY);
  const placementAnnual = managed ? num0(d.leasingFeeMonths) * num0(d.rent) * cyclesPerYear : 0;
  const renewalAnnual = managed ? num0(d.renewalFeeMonths) * num0(d.rent) * cyclesPerYear : 0;
  const mgmtFixedAnnual = mgmtMinTopUp + placementAnnual;
  const repairY = effectiveRent * num0(d.repairReservePct) / 100;
  const opex = maintenanceY + sinkingY + statutoryY + insuranceY + mgmtY + mgmtFixedAnnual + repairY;
  const noi = effectiveRent - opex;
  const annualDebtService = instalment * 12;

  const grossYield = grossAnnualRent / d.price * 100;
  const netYield = noi / d.price * 100;
  const cashflowMonthly = (noi / 12) - instalment;
  const cashOnCash = acquisitionCost > 0 ? (noi - annualDebtService) / acquisitionCost * 100 : null;
  /* Null when there is no debt, and null when the instalment could not be
     computed — those are different states and neither is 0.00x. It reported an
     exact 0.00x cover off a non-computable instalment, which reads as "the rent
     covers none of the loan" rather than "this could not be worked out". */
  const dscr = (isNum(annualDebtService) && annualDebtService > 0 && isNum(noi))
    ? noi / annualDebtService : null;
  /* Rent at which the property covers operating costs and the loan. */
  /* Break-even rent, per specification 31.5.

     The previous form divided total opex by the vacancy factor. But opex already
     contains the management fee and repair reserve, which are percentages of
     rent COLLECTED — so those two were frozen at the entered rent, carried into
     a figure that assumes a different rent, and then grossed up for vacancy a
     second time. Feeding the answer back into the model left cash flow at
     −RM204 a month: a break-even rent at which the deal does not break even.

     Only the fixed costs belong in the numerator. The rent-linked costs scale
     with the answer, so they belong in the denominator as a rate. */
  const variableCostRate = ((managed ? num0(d.mgmtPct) : 0) + num0(d.repairReservePct)) / 100;
  /* The flat half of management belongs here, with the other costs that do not
     move with rent — a minimum fee and a placement fee are owed whatever the
     rent turns out to be. */
  const fixedOperatingCosts = maintenanceY + sinkingY + statutoryY + insuranceY + mgmtFixedAnnual;
  const beDenominator = 12 * (1 - num0(d.vacancyPct) / 100) * (1 - variableCostRate);
  const breakEvenRent = beDenominator > 0
    ? (fixedOperatingCosts + annualDebtService) / beDenominator
    : null;

  /* Occupancy at which the property covers its fixed costs and the loan, per
     31.5. Above 100% means it cannot break even at the entered rent however
     full it is — which is a different and more serious statement than a thin
     margin, and one of the grade's hard gates. */
  const beOccDenominator = grossAnnualRent * (1 - variableCostRate);
  const breakEvenOccupancy = beOccDenominator > 0
    ? (fixedOperatingCosts + annualDebtService) / beOccDenominator * 100
    : null;
  /* What the owner pays each year to hold a property that does not pay for
     itself. Shown rather than buried in a negative cash-flow figure, because
     "minus RM1,200 a month" and "RM14,400 a year out of your pocket, RM72,000
     over five" land differently and the second is the commitment. */
  const annualOwnerSubsidy = isNum(noi) && isNum(annualDebtService) && (noi - annualDebtService) < 0
    ? annualDebtService - noi : 0;
  const psf = d.sqft > 0 ? d.price / d.sqft : null;
  /* Land is a separate divisor, not a conversion of the floor rate: a terrace
     on 4 points with 1,400 sq ft of floor has both, and they answer different
     questions. Null where no land area was entered, because a price per point
     of a parcel nobody measured is unanswerable rather than large. */
  const landPsf = num0(d.landSqft) > 0 ? d.price / d.landSqft : null;
  /* Service charge per unit of floor, monthly — the figure that most often
     turns a yield calculation wrong after completion, and the one a buyer is
     quoted per square foot without being told what it is per month. */
  const maintPsf = d.sqft > 0 && isNum(d.maintenance) ? d.maintenance / d.sqft : null;

  /* Exit at the chosen holding period. Selling is not instantaneous: the
     property is carried, unlet, for however long the sale takes, and in a
     Sarawak secondary market that is months rather than weeks. */
  const exitValue = d.price * Math.pow(1 + d.apprecPct / 100, d.holdYears);
  const outstanding = balanceAfter(loan, d.ratePct, d.tenureYears, d.holdYears * 12);
  const agentFee = exitValue * num0(d.agentPct) / 100;
  const exitLegal = Math.max(500, exitValue * num0(d.exitLegalPct) / 100);
  const sellMonths = num0(d.sellMonths);
  const carryWhileSelling = sellMonths * (instalment + (opex / 12));
  const gain = Math.max(0, exitValue - d.price - duty - legal - agentFee - exitLegal);
  const rpgt = gain * rpgtRate(d.holdYears) / 100;
  const netExitProceeds = exitValue - outstanding - agentFee - exitLegal - rpgt - carryWhileSelling;

  /* Cumulative rental cash flow across the hold, with rent growth, now after
     tax on the rent. */
  let cumCash = 0, cumTax = 0, cumPreTax = 0;
  const path = [];
  for (let y = 1; y <= d.holdYears; y++) {
    const rentY = grossAnnualRent * Math.pow(1 + d.rentGrowthPct / 100, y - 1);
    const effY = rentY * (1 - d.vacancyPct / 100);
    const opexY = opex * Math.pow(1.02, y - 1);

    /* WHAT THE REVENUE OFFICE ALLOWS IS NOT WHAT LEFT THE BANK ACCOUNT.
       Two differences, and both run the same way — they make the taxable figure
       HIGHER than the cash figure, so an owner who nets them off is under-
       providing for tax:

         the instalment is not deductible, only the interest inside it
         the fee for the FIRST tenant is capital and never deductible

       Everything else in opex is an outgoing incurred to produce the rent and
       is allowed. The reserve for repairs is treated as allowed on the basis
       that it is spent; if it is genuinely banked and not spent, the deduction
       belongs in the year it is finally used. */
    const scale = Math.pow(1.02, y - 1);
    const firstTenancyFee = y === 1 ? placementAnnual * scale : 0;
    const deductibleOpexY = opexY - firstTenancyFee;
    const interestY = interestInYear(loan, d.ratePct, d.tenureYears, y);
    const taxY = rentalTaxYear({
      effectiveRent: effY, deductibleOpex: deductibleOpexY,
      interest: interestY, marginalTaxPct: d.marginalTaxPct,
    });

    const cfPreTax = effY - opexY - annualDebtService;
    const cf = cfPreTax - taxY.tax;
    cumPreTax += cfPreTax; cumCash += cf; cumTax += taxY.tax;
    path.push({ y, rent: effY, opex: opexY, debt: annualDebtService,
                interest: interestY, principal: Math.max(0, annualDebtService - interestY),
                taxable: taxY.taxable, tax: taxY.tax, taxComputed: taxY.computed,
                cfPreTax, cf, cum: cumCash,
                value: d.price * Math.pow(1 + d.apprecPct / 100, y),
                balance: balanceAfter(loan, d.ratePct, d.tenureYears, y * 12) });
  }
  const taxComputed = isNum(d.marginalTaxPct) && d.marginalTaxPct > 0;
  const totalProfit = cumCash + netExitProceeds - acquisitionCost;
  const multiple = acquisitionCost > 0 ? (cumCash + netExitProceeds) / acquisitionCost : null;

  /* Kept, renamed, and no longer presented as a rate of return: it is the
     annualised multiple, which is a much cruder statement. The real internal
     rate is computed below, once the committed equity is known. */
  const annualisedMultiplePct = isNum(multiple) && multiple > 0
    ? (Math.pow(multiple, 1 / d.holdYears) - 1) * 100 : null;

  /* ---- stress tests ---------------------------------------------------- */
  /* Each re-runs the monthly position with one assumption moved, because the
     question a buyer actually has is not "what does this return" but "at what
     point does this stop working". Rate and vacancy are the two that move, and
     renovation is the one that overruns. */
  const monthlyAt = ({ ratePct = d.ratePct, vacancyPct = d.vacancyPct } = {}) => {
    const inst = monthlyInstalment(loan, ratePct, d.tenureYears);
    const eff = grossAnnualRent * (1 - vacancyPct / 100);
    const ox = maintenanceY + sinkingY + statutoryY + insuranceY
             + (eff * num0(d.mgmtPct) / 100) + (eff * num0(d.repairReservePct) / 100);
    return ((eff - ox) / 12) - inst;
  };
  const stress = {
    rate: [0, 1, 2, 3].map(bump => ({
      label: bump === 0 ? 'as entered' : `+${bump}.0 pp`,
      ratePct: d.ratePct + bump, monthly: monthlyAt({ ratePct: d.ratePct + bump }),
    })),
    vacancy: [d.vacancyPct, 15, 25, 40].map((v, i) => ({
      label: i === 0 ? 'as entered' : `${v}% vacant`,
      vacancyPct: v, monthly: monthlyAt({ vacancyPct: v }),
    })),
    /* Renovation does not change the monthly position — it changes how much
       cash the purchase consumes and therefore every return measured on it. */
    renovation: [0, 25, 50, 100].map(over => {
      const reno = renovation * (1 + over / 100);
      /* Derived from the ledger, not re-listed. This was
         `deposit + duty + legal + loanDuty + reno`, a five-term sum written
         before the ledger had eleven lines — so it silently dropped the
         valuation gap, disbursements, service tax, loan legal fees, the
         valuation fee, mortgage protection and utility deposits.

         The visible effect was two different cash figures for the same
         scenario on one screen: RM121.8k as cash invested, RM102.9k in this
         table, with two different cash-on-cash returns. Worse, because the
         valuation gap was among the dropped terms, entering a LOWER valuation
         made this figure fall while the real requirement rose — undoing the
         one thing the gap line exists to show. It also added a null legal fee
         as though it were a number, producing a finite total from an unpriced
         input.

         Only the renovation varies down this table, so the base is the ledger
         total with the entered renovation swapped for the stressed one. */
      const cash = acquisitionCost - renovation + reno;
      return { label: over === 0 ? 'as budgeted' : `+${over}% over`, renovation: reno, cash,
               cashOnCash: isNum(cash) && cash > 0 ? (noi - annualDebtService) / cash * 100 : null };
    }),
  };
  /* The point at which the monthly position crosses zero, by bisection.
     Crucially it returns null when there is no crossing — a property can be
     cash-flow negative at a 0% interest rate and with no vacancy at all, and
     collapsing that case to "0%" reads as an excellent result when it means
     the exact opposite. A missing answer is stated as missing. */
  /* Returns WHY there is no crossing, not just that there isn't one. Collapsing
     "negative at every rate" and "positive at every rate" both to null is how a
     failing deal gets displayed as one that never fails. */
  const crossing = (fn, lo, hi) => {
    if (fn(lo) <= 0) return { value: null, reason: 'never-positive' };
    if (fn(hi) > 0) return { value: null, reason: 'always-positive' };
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (fn(mid) > 0) lo = mid; else hi = mid;
    }
    return { value: (lo + hi) / 2, reason: 'crosses' };
  };
  const rateBE = crossing(r2 => monthlyAt({ ratePct: r2 }), 0, 25);
  const vacBE = crossing(v => monthlyAt({ vacancyPct: v }), 0, 100);
  const breakEvenRate = rateBE.value, breakEvenRateWhy = rateBE.reason;
  const breakEvenVacancy = vacBE.value, breakEvenVacancyWhy = vacBE.reason;
  /* The genuinely structural case: no rate and no occupancy level fixes it. */
  const negativeAtBest = monthlyAt({ ratePct: 0, vacancyPct: 0 }) <= 0;

  /* ---- five and ten year exits ----------------------------------------- */
  const exitAt = (yrs) => {
    const val = d.price * Math.pow(1 + d.apprecPct / 100, yrs);
    const bal = balanceAfter(loan, d.ratePct, d.tenureYears, yrs * 12);
    const agent = val * num0(d.agentPct) / 100;
    const lg = Math.max(500, val * num0(d.exitLegalPct) / 100);
    const carry = sellMonths * (instalment + (opex / 12));
    const gn = Math.max(0, val - d.price - duty - legal - agent - lg);
    const tax = gn * rpgtRate(yrs) / 100;
    const net = val - bal - agent - lg - tax - carry;
    let cum = 0;
    for (let y = 1; y <= yrs; y++) {
      const rentY = grossAnnualRent * Math.pow(1 + d.rentGrowthPct / 100, y - 1);
      const effY = rentY * (1 - d.vacancyPct / 100);
      cum += effY - (opex * Math.pow(1.02, y - 1)) - annualDebtService;
    }
    const profit = cum + net - acquisitionCost;
    const mult = acquisitionCost > 0 ? (cum + net) / acquisitionCost : null;
    return { yrs, value: val, outstanding: bal, agentFee: agent, exitLegal: lg, carry,
             rpgtPct: rpgtRate(yrs), rpgt: tax, sellingCosts: agent + lg + tax + carry,
             net, cumCash: cum, profit,
             annualised: isNum(mult) && mult > 0 ? (Math.pow(mult, 1 / yrs) - 1) * 100 : null };
  };
  const exits = [5, 10].map(exitAt);

  /* ---- the same cash, in equities -------------------------------------- */
  /* Not a recommendation and not a forecast — the point is that the deposit
     has an alternative use, and a property model that never mentions it is
     answering an easier question than the one being asked. */
  const equity = exits.map(e => {
    const grown = acquisitionCost * Math.pow(1 + num0(d.equityReturnPct) / 100, e.yrs);
    return { yrs: e.yrs, value: grown, profit: grown - acquisitionCost,
             annualised: num0(d.equityReturnPct), vsProperty: e.profit - (grown - acquisitionCost) };
  });

  /* Three months of instalment and running cost, held rather than spent. Not
     part of the purchase price, but part of what the purchase requires — a
     buyer who arrives at completion with nothing behind the deposit is one
     vacancy away from distress. */
  /* ---- reserve (specification 29.5) ------------------------------------ */
  /* Configurable rather than fixed at three months. A fragile property needs
     more liquidity than a tenanted one, and the number of months is a policy
     the buyer sets rather than a constant this tool imposes.

     Two floors, because they answer different questions: what it costs to hold
     the property with rent coming in under stress, and what it costs to hold it
     with no rent at all. The reserve is the larger — a reserve that only
     survives the gentler case is not a reserve. */
  const reserveMonths = clamp(num0(d.reserveMonths) || 3, 1, 24);
  /* Two cases, and the costs differ between them. Management and repair fees
     are charged as a percentage of rent collected, so they accrue in the
     with-rent case and not in the without-rent case — the previous version
     excluded them from both, which understated the with-rent burn and
     contradicted cashflowMonthly on the same screen. */
  const rentLinkedMonthly = (mgmtY + repairY) / 12;
  const ownerFixedMonthly = instalment + (opex - mgmtY - repairY) / 12;
  const stressedRentMonthly = effectiveRent / 12;
  const burnWithRent = Math.max(0, ownerFixedMonthly + rentLinkedMonthly - stressedRentMonthly);
  const burnWithoutRent = ownerFixedMonthly;
  /* The larger of the two, at full value. An earlier draft of this line scaled
     the no-rent case by 0.6, which had no basis and made the reserve smaller
     than the case it is meant to survive — understating required liquidity,
     which is the direction that hurts. The specification takes the maximum of
     the burn with rent and the full owner cost without it, and so does this. */
  /* Not computable when the instalment or the running costs are not, and
     null in that case rather than a rounded NaN. Math.round(NaN) is NaN, which
     sumPriced then skips — so the reserve disappeared from the safe-cash total
     without the total ever declaring itself short. The most consequential
     figure on the page could go missing silently, which is the exact failure
     this product's own rule forbids. */
  const reserveComputable = isNum(instalment) && isNum(opex) && isNum(burnWithoutRent);
  const reserve = reserveComputable
    ? Math.round(reserveMonths * Math.max(burnWithRent, burnWithoutRent))
    : null;
  /* Shown alongside, because the specification asks for three and six months at
     minimum and a single figure hides how quickly the answer moves. */
  const reserveScenarios = [3, 6].map(mo => ({ months: mo,
    noRent: Math.round(mo * burnWithoutRent),
    stressedRent: Math.round(mo * burnWithRent) }));

  costGroups.push({ id:'reserve', label:'Emergency reserve', items:[
    [`${reserveMonths} month${reserveMonths === 1 ? '' : 's'} of instalment and owner-paid running costs`, reserve,
     reserveComputable ? null : { status:'unset', why:'The instalment or the running costs could not be computed, so the reserve cannot be either.' }]] });
  /* Recomputed after the reserve is pushed, so an unpriced reserve is reported
     as a missing line rather than quietly leaving the total short. */
  if (!reserveComputable) missingCostLines.push({ group:'Emergency reserve',
    label:'Emergency reserve', why:'The instalment or the running costs could not be computed.' });

  /* ---- the three cash figures (specification 29.1) --------------------- */
  /* One "total initial cash" answered three different questions at once: what
     leaves the account at completion, what it takes to make the property
     earn, and what must still be there afterwards. A buyer can meet the first
     and be ruined by the third.

     Derived from the ledger groups rather than recomputed, so a line added to a
     group cannot be left out of its own total. */
  /* Derived from the ledger groups rather than recomputed, so a line added to
     a group cannot be left out of its own total. */
  const groupTotal = (id) => sumPriced((costGroups.find(g => g.id === id)?.items || []).map(it => it[1]));
  const transactionCash = groupTotal('acquisition') + groupTotal('financing');
  const improvementCash = groupTotal('improvement');
  const reserveCash = groupTotal('reserve');
  const safeCashRequired = transactionCash + improvementCash + reserveCash;

  /* Directive 6.3 asks for four totals, not three. The fourth is what has
     already left the buyer's account — a booking or earnest deposit paid at
     the point of offer, weeks before completion.

     It is a TIMING split inside the down payment, never an addition to it.
     Counting a booking deposit as its own cost is the double-count the
     directive names explicitly, and it inflates the requirement by exactly the
     amount the buyer has already handed over. So "still required" is the
     completion figure less what is paid, and the two always reconcile to the
     same total. */
  const cashAlreadyPaid = clamp(num0(d.bookingDepositPaid), 0, transactionCash);
  const cashStillRequiredToComplete = transactionCash - cashAlreadyPaid;
  /* Kept: existing callers read these, and both remain true — completion cash
     is everything but the reserve. */
  const totalInitialCash = safeCashRequired;

  /* ---- the actual internal rate of return ------------------------------
     The equity is every ringgit committed at the start, INCLUDING the reserve —
     it is capital the owner cannot use elsewhere while the property is held.
     It comes back at the exit, so the reserve neither flatters nor penalises
     the rate; it simply sits at its correct place in time, which is the whole
     point of doing this properly rather than annualising a multiple. */
  const equityOut = num0(totalInitialCash) > 0 ? num0(totalInitialCash) : num0(acquisitionCost);
  const flows = [-equityOut];
  path.forEach((p, i) => {
    const last = i === path.length - 1;
    flows.push(p.cf + (last ? netExitProceeds + num0(reserveCash) : 0));
  });
  const irrResult = irrOf(flows);
  const irrPct = irrResult.rate;
  /* NPV at the return the reader says their capital could earn elsewhere —
     already collected for the opportunity-cost comparison and never used for
     this. Positive means the deal beats that alternative after tax. */
  const hurdlePct = num0(d.equityReturnPct);
  const npvAtHurdle = hurdlePct > 0 ? npvAt(hurdlePct / 100, flows) : null;

  return { proj, loan, deposit, duty, legal, loanDuty, renovation, acquisitionCost,
           costGroups, missingCostLines, unconfirmedCost, placeholderCostLines,
           transactionCash, improvementCash, reserveCash, safeCashRequired,
           cashAlreadyPaid, cashStillRequiredToComplete,
           reserveMonths, reserveScenarios, burnWithRent, burnWithoutRent,
           reserveComputable, tenureValid, zeroRateModelled,
           breakEvenOccupancy, annualOwnerSubsidy, fixedOperatingCosts, variableCostRate,
           inputRatePct: d.ratePct, tenureYears: d.tenureYears,
           bankValuation, lenderValueBasis, valuationGapCash, marginOfFinancePct,
           financingBasisConfirmed, financingCoverageOfPrice, financingScenarios, valuationRule,
           reserve, totalInitialCash, instalment,
           grossAnnualRent, effectiveRent, opex, noi, annualDebtService, grossYield, netYield,
           maintenanceY, sinkingY, statutoryY, insuranceY, mgmtY, repairY,
           /* management operations, P1-7 */
           managed, mgmtFixedAnnual, mgmtMinTopUp, placementAnnual, renewalAnnual,
           mgmtTotalAnnual: mgmtY + mgmtFixedAnnual,
           /* What the service costs per month the property is actually let, and
              per tenancy signed — the two figures that make a percentage
              comparable between one agent and another. */
           mgmtCostPerOccupiedMonth: (mgmtY + mgmtFixedAnnual) / Math.max(0.01, 12 * (1 - num0(d.vacancyPct) / 100)),
           mgmtCostPerTenancy: cyclesPerYear > 0 ? (mgmtY + mgmtFixedAnnual) / cyclesPerYear : null,
           /* The vacancy the placement target implies, against the vacancy that
              was entered. Two numbers describing the same thing, kept apart so
              the reader reconciles them rather than the model quietly picking. */
           impliedVacancyPct: (num0(d.daysToFirstTenant) + monthsPerCycle * 30) > 0
             ? num0(d.daysToFirstTenant) / (num0(d.daysToFirstTenant) + monthsPerCycle * 30) * 100 : null,
           monthsPerCycle, cyclesPerYear,
           cashflowMonthly, cashOnCash, dscr, breakEvenRent,
           breakEvenRate, breakEvenRateWhy, breakEvenVacancy, breakEvenVacancyWhy, negativeAtBest,
           psf, landPsf, maintPsf, exitValue, outstanding, agentFee, exitLegal, carryWhileSelling,
           gain, rpgt, rpgtPct: rpgtRate(d.holdYears), netExitProceeds,
           cumCash, cumPreTax, cumTax, taxComputed, path, totalProfit, multiple,
           irrPct, irrWhy: irrResult.why, irrSignChanges: irrResult.signChanges,
           npvAtHurdle, hurdlePct, annualisedMultiplePct, equityOut, flows,
           stress, exits, equity };
}

/* Inputs arrive from number fields, where an emptied box is '' and not 0. */
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function propertyRiskFlags(d, m) {
  const out = [];
  if (m.dscr != null && m.dscr < 1) out.push({ sev:'serious', t:'The rent does not cover the loan',
    n:`Debt-service cover of ${fmtX(m.dscr, 2)} means net operating income falls short of the instalments. The shortfall is funded from your own income every month.` });
  if (m.cashflowMonthly < 0) out.push({ sev:'warning', t:'Negative monthly cash flow',
    n:`This costs ${fmtAmount(Math.abs(m.cashflowMonthly), 'MYR')} a month to hold before any repairs or void periods.` });
  /* Every comparison below needs a comparable to compare against. On a custom
     entry there is none, so the flag is absent rather than evaluated against a
     missing bound — `price > undefined` is false, and a silent false here would
     read as "within the transacted range" when nothing was checked. */
  if (isNum(m.proj.psfHi) && m.psf && m.psf > m.proj.psfHi) out.push({ sev:'serious', t:'Above the transacted range',
    n:`At RM${m.psf.toFixed(0)} psf you would be paying above the highest recent transaction in ${m.proj.name} (RM${m.proj.psfHi} psf).` });
  else if (isNum(m.proj.psfMid) && m.psf && m.psf > m.proj.psfMid) out.push({ sev:'warning', t:'Above the median transaction',
    n:`RM${m.psf.toFixed(0)} psf sits above the median of RM${m.proj.psfMid} psf recently transacted here.` });
  if (isNum(m.proj.rentHi) && d.rent > m.proj.rentHi) out.push({ sev:'serious', t:'Rent assumption above the observed range',
    n:`RM${d.rent} exceeds the top of the observed rental range (RM${m.proj.rentHi}). The whole model rests on this figure.` });
  if (isNum(m.proj.vacancyPct) && !m.proj.custom && d.vacancyPct < m.proj.vacancyPct) out.push({ sev:'warning', t:'Vacancy assumed below the area norm',
    n:`You have assumed ${fmtPct(d.vacancyPct, 0)} vacancy against roughly ${fmtPct(m.proj.vacancyPct, 0)} observed in ${m.proj.area}.` });
  if (m.proj.custom) out.push({ sev:'warning', t:'No comparable attached',
    n:`This tool holds no transacted price, rental band or vacancy observation for ${m.proj.area}. The price, rent and vacancy below are entirely yours, and none of them has been checked against a market.` });
  if (d.holdYears <= 5) out.push({ sev:'warning', t:'Real property gains tax applies at this holding period',
    n:`Selling in year ${d.holdYears} attracts RPGT at ${m.rpgtPct}% for an individual Malaysian citizen, which is ${fmtAmount(m.rpgt, 'MYR')} on this scenario.` });
  if (m.proj.tenure === 'Leasehold') out.push({ sev:'warning', t:'Leasehold tenure',
    n:'Financing and resale liquidity both tighten as the remaining lease shortens. Check the balance term before committing.' });
  /* Title class outranks everything financial. A restricted class is not a
     risk to be priced — it is a question about whether the purchase is open to
     you at all, and that is answered by a lawyer and the Land and Survey
     Department rather than by this page. */
  const title = TITLE_TYPES.find(t => t.id === d.titleType);
  if (title?.restricted) out.unshift({ sev:'serious', t:`Title class: ${title.label}`,
    n:`${title.note} Nothing below is meaningful until the class on the title document is confirmed.` });

  if (d.titleType !== 'strata' && isNum(d.remainingLease) && d.remainingLease > 0 && d.remainingLease < 60)
    out.push({ sev:'serious', t:`Only ${d.remainingLease} years remain on the lease`,
      n:'A short remaining lease can shorten the tenure a lender will offer and narrow the pool of buyers at your own exit. Thresholds vary between lenders and are theirs to state — confirm with the intended lender rather than relying on a rule of thumb, including this well.' });

  /* Answers the buyer gave to the checklist, surfaced as findings. */
  for (const chk of SARAWAK_CHECKS) {
    if (State.deal.checks?.[chk.id] === 'yes' && chk.id !== 'comparables' && chk.id !== 'lease-remaining')
      out.push({ sev: chk.sev, t: chk.q.replace(/\?$/, ''), n: `${chk.why} Confirm with: ${chk.who}.` });
    if (chk.id === 'comparables' && State.deal.checks?.[chk.id] === 'no')
      out.push({ sev:'serious', t:'Rental comparables have not been verified',
        n:'Every figure on this page is driven by the rent assumption. Until a transacted rent is confirmed, the outputs are arithmetic on a guess.' });
  }

  /* Provenance is itself a risk. A model whose two largest drivers came from
     the seller is a sales projection wearing a spreadsheet. */
  const weak = ['price', 'rent'].filter(k => ['developer', 'assumed'].includes(State.deal.evidence?.[k]));
  if (weak.length) out.push({ sev:'warning', t:'Key figures are not independently evidenced',
    n:`${weak.join(' and ')} ${weak.length === 1 ? 'is' : 'are'} marked as supplied by the seller or assumed by this tool. Those two drive every output here.` });

  if (!out.length) out.push({ sev:'good', t:'No threshold breached', n:'On the assumptions entered, none of the modelled risk thresholds is crossed. That is a statement about the assumptions, not about the property.' });
  return out;
}

VIEWS.sarawak = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Sarawak Economy Watch'),
    el('h1', {}, 'Companies with material exposure to the Sarawak economy'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Inclusion is descriptive and does not indicate preference. This is a research collection, not a recommended-stock list, and nothing here is ordered by merit.'),
  ]));
  wrap.append(hd);

  const recs = State.sarawakExposure || [];

  /* Why the collection is empty, stated once and plainly. */
  const why = el('div', { class: 'card' });
  why.append(cardHead('What is here, and what is not',
    'The names are identified. The exposure is not.'));
  why.append(el('p', { class: 'body', style: 'font-size:13px' },
    'Which companies operate in Sarawak is checkable, and they are listed below — each listing code resolved against a live quote and the returned company name checked against the one recorded here. What share of a company’s order book is state contracts, which concessions it depends on, how concentrated its state customer base is: none of that is carried by any source this product can reach.'));
  why.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px' },
    'So the two are kept apart. Identifying a company is not researching it, and a list of familiar names with pre-filled exposure fields would look like the second while only being the first. The fields stay empty until someone fills them from a document they have read.'));
  why.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'Records are stored in this browser, are never sent anywhere, and carry no redistribution right.'));
  wrap.append(why);

  /* Themes, each showing what has been recorded against it. */
  const tg = el('div', { class: 'grid grid-3' });
  SARAWAK_THEMES.forEach(t => {
    const n = recs.filter(r => r.theme === t.id).length;
    const card = el('div', { class: 'card' });
    card.append(el('div', { class: 'row', style: 'gap:8px;align-items:baseline' }, [
      el('h3', { class: 'h-card' }, t.label),
      el('span', { class: 'metaline', style: 'margin-left:auto' },
        n ? `${n} recorded` : 'none yet'),
    ]));
    card.append(el('p', { class: 'body', style: 'font-size:13px' }, t.note));
    tg.append(card);
  });
  wrap.append(tg);

  /* The identified companies. Identity and price only — everything here was
     either resolved from the registry or computed from an observed series, and
     nothing in this card is a claim about a company's Sarawak exposure. */
  const flagged = (instruments?.instruments || []).filter(i => i.sarawak);
  if (flagged.length) {
    const roster = el('div', { class: 'card' });
    roster.append(cardHead(`Companies operating in Sarawak — ${flagged.length} identified`,
      'Listing codes resolved against a live quote and checked against the company name. Ordered by listing code, not by merit.'));
    const rw = el('div', { class: 'tablewrap' });
    const rt = el('table', { class: 'dt' });
    rt.append(el('thead', {}, el('tr', {}, ['Code', 'Company', 'Suggested theme', 'Closes held',
      'vs 200-day', 'Financial statements', 'Exposure recorded'].map((h, i) =>
      el('th', { style: i === 1 || i === 2 ? 'text-align:left' : null }, h)))));
    const rb = el('tbody');
    [...flagged].sort((a, b) => String(a.symbol).localeCompare(String(b.symbol))).forEach(i => {
      const series = trackedHistory?.series?.[i.symbol] || null;
      const t = series ? trendContext(series) : null;
      const theme = SARAWAK_THEMES.find(x => x.id === i.sarawakTheme);
      const recorded = recs.filter(r => r.tk === i.symbol).length;
      rb.append(el('tr', {}, [
        el('td', { class: 'ident' }, i.symbol),
        el('td', { style: 'text-align:left;white-space:normal' }, i.name),
        el('td', { class: 'caption', style: 'text-align:left' }, theme ? theme.label : '—'),
        el('td', { class: 'num' }, t ? String(t.points) : '—'),
        /* Computed from observed closes or absent. Never estimated. */
        el('td', { class: 'num', html: t && isNum(t.values.dist200)
          ? `<span class="${signClass(t.values.dist200)}">${withSign(t.values.dist200, 1)}</span>`
          : '<span class="caption">needs 200 closes</span>' }),
        el('td', { class: 'caption' }, 'none held'),
        el('td', { class: 'caption' }, recorded ? `${recorded} theme${recorded === 1 ? '' : 's'}` : 'not yet'),
      ]));
    });
    rt.append(rb); rw.append(rt); roster.append(rw);
    /* On the deployed site there is no price history at all, so this table used
       to arrive with four empty columns and no way for a reader to fill them —
       the app's own advice was to run a Node script. Which is fine advice for
       the person who wrote it and no advice at all for anyone else. */
    const anyHistory = flagged.some(i => trackedHistory?.series?.[i.symbol]);
    roster.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
      anyHistory
        ? 'The price columns are computed from closes held in this browser. They are not licensed market data, are not redistributed, and no price ships with this site.'
        : 'No price history is loaded, so the price columns are empty. This site ships none: the closes it could ship are not licensed for it to redistribute. Your own are a different question — paste them under Your data and every column here fills in.'));
    roster.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
      '"Financial statements: none held" is the honest state of every row. Bursa Malaysia publishes no machine-readable statements this product can reach, so no valuation, scorecard or coverage figure is offered for any of these companies.'));
    if (!anyHistory) roster.append(el('a', { class: 'btn btn-sm', style: 'margin-top:10px', href: href('/my/data'),
      onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate('/my/data'); } }, 'Add your own closes'));
    wrap.append(roster);
  }

  /* Add a company against a theme. */
  const candidates = sarawakCandidates();
  const swkCands = candidates.filter(c => c.sarawak);
  const add = el('div', { class: 'card' });
  add.append(cardHead('Record an exposure',
    `Pick a company and the theme its Sarawak exposure sits under. The ${EXPOSURE_FIELDS.length} evidence fields are filled in afterwards.`));
  const coSel = el('select', { class: 'select', 'aria-label': 'Company' });
  /* Grouped so the companies this page exists for are not buried among US
     filers in an alphabetical list. */
  if (swkCands.length) {
    const g = el('optgroup', { label: 'Sarawak operations' });
    swkCands.forEach(c => g.append(el('option', { value: c.id }, `${c.tk} — ${c.name}`)));
    coSel.append(g);
  }
  const rest = candidates.filter(c => !c.sarawak)
    .sort((a, b) => String(a.tk || '').localeCompare(String(b.tk || '')));
  if (rest.length) {
    const g = el('optgroup', { label: 'Everything else in the universe' });
    rest.forEach(c => g.append(el('option', { value: c.id }, `${c.tk} — ${c.name}`)));
    coSel.append(g);
  }
  const thSel = el('select', { class: 'select', 'aria-label': 'Theme' });
  SARAWAK_THEMES.forEach(t => thSel.append(el('option', { value: t.id }, t.label)));
  /* A flagged company carries a suggested theme from the registry. It is a
     starting point for the reader, not a finding — the registry records where a
     company operates, and which theme that belongs under is a judgement. */
  const syncTheme = () => {
    const c = candidates.find(x => x.id === coSel.value);
    if (c?.theme && SARAWAK_THEMES.some(t => t.id === c.theme)) thSel.value = c.theme;
  };
  coSel.addEventListener('change', syncTheme);
  const addRow = el('div', { style: 'display:grid;grid-template-columns:2fr 2fr auto;gap:8px;align-items:end' });
  addRow.append(coSel); addRow.append(thSel);
  addRow.append(el('button', { class: 'btn', onclick: () => {
    const co = candidates.find(x => x.id === coSel.value);
    if (!co) return;
    if (recs.some(r => r.id === co.id && r.theme === thSel.value)) { toast('Already recorded under that theme'); return; }
    State.sarawakExposure = [...recs, { id: co.id, tk: co.tk, name: co.name,
      theme: thSel.value, fields: {}, evidence: 'user', source: co.source,
      hasFundamentals: co.hasFundamentals,
      added: new Date().toISOString().slice(0, 10) }];
    saveExposures(); toast(`${co.tk} added — the ${EXPOSURE_FIELDS.length} exposure fields are still empty`); render();
  } }, 'Add'));
  add.append(addRow);
  queueMicrotask(syncTheme);
  add.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    swkCands.length
      ? `${swkCands.length} companies with Sarawak operations are listed first. They are identified from the instrument registry, which carries their name, listing code and price — not their financial statements, and not their exposure. Both of those are still research, and the fields below are where it goes.`
      : 'No company has been flagged as having Sarawak operations in the instrument registry.'));
  wrap.append(add);

  /* The collection itself. */
  if (recs.length) {
    const list = el('div', { class: 'card' });
    list.append(cardHead(`Recorded — ${recs.length}`,
      'Completeness counts the eleven fields section 19.2 asks for. A thin record cannot pass for a researched one.'));
    recs.forEach((rec, i) => {
      const theme = SARAWAK_THEMES.find(t => t.id === rec.theme);
      const pct = exposureCompleteness(rec);
      const det = el('details', { style: 'border-top:1px solid var(--line);padding:10px 0' });
      /* Both numbers on the summary line, never averaged into one. A record can
         be fully written and entirely unsourced, and a reader has to be able to
         see that without opening it. */
      const src = exposureSourcing(rec);
      det.append(el('summary', { style: 'cursor:pointer' }, [
        el('span', { style: 'font-weight:600' }, `${rec.tk} — ${rec.name}`),
        el('span', { class: 'metaline' }, `  ${theme?.label} · ${pct}% of fields recorded`),
        el('span', { class: src.score === 100 ? 'chip chip-ok' : 'chip chip-bronze', style: 'margin-left:8px' },
          src.score === 100
            ? `sourced${rec.basis && rec.basis !== 'unstated' ? ' · ' + rec.basis : ''}`
            : `${src.missing.length} sourcing gap${src.missing.length === 1 ? '' : 's'}`),
      ]));
      /* How it was established, before what it says. A reader scanning the
         record should meet the sourcing first — it qualifies everything below
         it, and putting it at the bottom would make it a footnote to claims
         they have already read. */
      const meta = el('div', { style: 'padding:10px;border:1px solid var(--line);border-radius:8px;margin-bottom:10px;background:var(--surface-sunk)' });
      const srcState = exposureSourcing(rec);
      meta.append(el('div', { class: 'row', style: 'gap:8px;align-items:baseline;margin-bottom:8px' }, [
        el('h4', { class: 'eyebrow', style: 'margin:0' }, 'How this was established'),
        el('span', { class: srcState.score === 100 ? 'chip chip-ok' : 'chip chip-bronze', style: 'margin-left:auto' },
          srcState.score === 100 ? 'sourced, dated and classified' : srcState.missing.join(' · ')),
      ]));

      EXPOSURE_META.forEach(f => {
        const row = el('div', { class: 'field', style: 'margin-top:8px' });
        row.append(el('label', {}, f.label));
        const inp = f.kind === 'date'
          ? el('input', { class: 'input', type: 'date', value: rec.verified || '', 'aria-label': f.label })
          : el('textarea', { class: 'input', rows: '2', placeholder: 'Not recorded', 'aria-label': f.label });
        if (f.kind !== 'date') inp.value = rec[f.k] || '';
        inp.addEventListener('change', () => { rec[f.k] = inp.value; saveExposures(); render(); });
        row.append(inp);
        row.append(el('p', { class: 'metaline', style: 'margin-top:4px' }, f.hint));
        meta.append(row);
      });

      const basisRow = el('div', { class: 'field', style: 'margin-top:8px' });
      basisRow.append(el('label', {}, 'Exposure classification'));
      const basisSel = el('select', { class: 'select', 'aria-label': 'Exposure classification' });
      EXPOSURE_BASIS.forEach(b => basisSel.append(el('option', { value: b.id,
        selected: (rec.basis || 'unstated') === b.id ? '' : null }, b.label)));
      basisSel.addEventListener('change', () => { rec.basis = basisSel.value; saveExposures(); render(); });
      basisRow.append(basisSel);
      basisRow.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
        (EXPOSURE_BASIS.find(b => b.id === (rec.basis || 'unstated')) || EXPOSURE_BASIS[2]).note));
      meta.append(basisRow);

      const age = exposureStale(rec);
      if (age != null && age > 365) meta.append(el('p', { class: 'metaline', style: 'margin-top:8px;color:var(--bronze)' },
        `Last verified ${Math.floor(age / 30)} months ago. An order book or a project status moves faster than that.`));
      det.append(meta);

      EXPOSURE_FIELDS.forEach(f => {
        const row = el('div', { class: 'field', style: 'margin-top:8px' });
        row.append(el('label', {}, f.label));
        const ta = el('textarea', { class: 'input', rows: '2', placeholder: 'Not recorded',
          'aria-label': f.label });
        ta.value = rec.fields?.[f.k] || '';
        ta.addEventListener('change', () => {
          rec.fields = { ...(rec.fields || {}), [f.k]: ta.value };
          saveExposures();
        });
        row.append(ta);
        det.append(row);
      });
      det.append(el('div', { class: 'row', style: 'margin-top:10px;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          State.sarawakExposure = recs.filter((_, j) => j !== i); saveExposures(); render();
        } }, 'Remove'),
        el('span', { class: 'metaline' }, `Added ${rec.added}. If a field is blank it is unresearched, not zero.`),
      ]));
      list.append(det);
    });
    wrap.append(list);
  }

  wrap.append(el('p', { class: 'metaline' },
    'Exposure that cannot be quantified should be recorded as qualitative with the limitation stated, rather than left to imply a number nobody has.'));
  return wrap;
};

VIEWS.property = () => {
  const d = State.deal;
  const m = dealModel(d);
  const paid = lim('propertyReports') > 0 || State.propertyReportsBought.includes(d.projectId);
  const wrap = el('div');

  wrap.append(el('div', { class: 'page-hd' }, el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Property Deal Check'),
    el('h1', {}, 'Turn a property into a financial model'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Most property tools show you what things sold for. This models what owning it would actually do to your cash: true acquisition cost, financing, vacancy, maintenance, exit costs and tax — then compares the result against putting the same money into equities.'),
  ])));

  /* The regulated claim leads and is never hidden at any width: in Malaysia an
     official valuation requires a registered valuer, and this is not one. The
     qualifying detail follows in a span that collapses on a phone — the part a
     reader must not miss is the first sentence, and burying that to win fold
     space would be trading the wrong thing for it. */
  const disc = el('div', { class: 'card', style: 'margin-bottom:var(--md);border-left:3px solid var(--bronze)' });
  disc.append(el('div', { class: 'row row-wrap', style: 'gap:10px' }, [
    el('span', { class: 'chip chip-bronze' }, 'Not a valuation'),
    el('p', { class: 'body', style: 'font-size:13px;flex:1 1 320px' }, [
      'Not an official property valuation — in Malaysia that must be carried out by a registered valuer.',
      el('span', { class: 'disclosure-long' },
        ' This is an investment estimate built from your inputs and sample transaction data. Figures are scenarios, not predictions.'),
    ]),
  ]));
  wrap.append(disc);

  /* Reset restores the seeded defaults rather than blanking every field: a
     property calculator with no price, rent or tenure is not a fresh start, it
     is a broken model that produces nothing until twenty numbers are typed.
     `touched` and `evidence` are cleared with them, so the restored figures go
     back to being honestly labelled illustrative defaults rather than
     inheriting the previous reader's provenance. */
  wrap.append(workBar('property', () => {
    State.deal = { ...PROPERTY_DEFAULT_DEAL, touched: {},
      evidence: { ...PROPERTY_DEFAULT_DEAL.evidence },
      checks: { ...PROPERTY_DEFAULT_DEAL.checks } };
    saveDeal();
  }));

  /* Stated once, at the top, while any figure that drives the model is still a
     seeded number. "Built from your inputs" in the line above is only true once
     the inputs are the reader's. */
  /* ---- the one-page answer (specification 27.3) ------------------------ */
  /* First on the page, and deliberately not the gross yield. Gross yield
     ignores vacancy, maintenance, financing and every acquisition cost, which
     makes it the most flattering number here and the least informative. */
  const g = propertyGrade(d, m);
  const gradeTone = { A:'--ok-text', B:'--bronze', C:'--bronze', D:'--dn-text', U:'--ink-2' }[g.grade];
  const onePage = el('div', { class: 'card', style: `border-left:3px solid var(${gradeTone})` });

  /* THE MONEY, FIRST.
     The card opened on a letter grade and a score, and the three figures that
     decide whether somebody can do this at all — what leaves the account, what
     is needed to be safe, what it costs to hold each month — sat below the
     fold on a phone behind the grade, the verdict and the gates.
     A grade answers "is this a good deal". These answer "can I". */
  const strip = el('div', { class: 'capstrip' });
  [['Cash to complete', fmtAmount(m.transactionCash, 'MYR')],
   ['Safe cash required', fmtAmount(m.safeCashRequired, 'MYR')],
   ['Monthly position', isNum(m.cashflowMonthly) ? fmtAmount(m.cashflowMonthly, 'MYR') : '—']]
    .forEach(([k, v], i) => strip.append(el('div', {}, [
      el('span', { class: 'eyebrow', style: 'display:block;margin-bottom:2px' }, k),
      el('span', { class: 'num', style: `font-size:20px;font-weight:700${i === 2 && isNum(m.cashflowMonthly) && m.cashflowMonthly < 0 ? ';color:var(--dn-text)' : ''}` }, v),
    ])));
  onePage.append(strip);

  onePage.append(el('div', { class: 'row row-wrap', style: 'gap:12px;align-items:baseline;margin-top:var(--md)' }, [
    el('div', {}, [
      el('p', { class: 'eyebrow', style: 'margin-bottom:2px' }, 'QT Property Underwriting Grade'),
      el('div', { class: 'row', style: 'gap:10px;align-items:baseline' }, [
        el('span', { class: 'num', style: `font-size:32px;font-weight:700;color:var(${gradeTone})` }, g.grade),
        el('span', { style: 'font-size:15px;font-weight:600' }, g.verdict),
      ]),
    ]),
    el('div', { style: 'margin-left:auto;text-align:right' }, [
      /* "Score 9/100" beside "U — Not enough evidence" reads as a rating of the
         property. It is the weighted result over the pillars that could be
         tested, which is a different claim from the grade and has to say so. */
      el('div', { class: 'metaline' }, !isNum(g.score) ? 'Not scored'
        : g.grade === 'U' ? `Model score ${g.score}/100 — not carried into a grade`
        : `Score ${g.score}/100`),
      /* Was "Evidence coverage", which named neither the thing it measures nor
         the thing a reader assumes it measures. It is the share of scoring
         weight that could be computed — not provenance quality, and not the
         proportion of the form filled in. "Evidence quality" is separately one
         of the pillars below, and could read 0/100 while this read 85%. */
      el('div', { class: 'metaline', title: `${GRADE_PILLARS.length} pillars carry this grade. This is the share of their combined weight that returned a number at all. An A needs 90%, a B needs 80%, and below 80% the grade is withheld.` },
        `Scored on ${fmtPct(g.coverage * 100, 0)} of framework weight`),
    ]),
  ]));
  onePage.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    (g.grade === 'U' && isNum(g.score)
      ? `The score and the grade are not the same claim. The score is weighted only across the pillars that could be tested; the grade is withheld because ${g.coverage < 0.80 ? `only ${fmtPct(g.coverage * 100, 0)} of the framework weight could be scored, against the 80% a grade requires` : 'a hard gate below is unmet'}. `
      : '')
    + 'A research grade on the evidence entered. Not a bank decision, not a valuation, and not legal clearance — each of those is a named professional, and the questions below say which.'));

  /* ---------- ANSWER, THEN CAVEAT, THEN ARITHMETIC ----------
     The card used to open with four stat tiles and put the sentence that
     actually answers the question — "this property does not pay for itself,
     holding it costs RM14.4k a year" — underneath them, the reasons it cannot
     be graded under that, and the warning that the figures are Kuching's in a
     separate card eight screens further down. At 390px the fold ended on
     "U / Not enough evidence / Score 9/100", so a reader who stopped there left
     with a letter and no idea whose numbers produced it.

     Order is now: what it does to your money -> why it cannot be graded ->
     whose numbers these are -> the arithmetic. The caveat sits after the
     verdict rather than before it, because a page that opens on a caveat has
     not yet said what is being caveated. */

  /* The owner subsidy stated as a commitment rather than a monthly minus. */
  if (m.annualOwnerSubsidy > 0) onePage.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:var(--md);color:var(--dn-text)' },
    `This property does not pay for itself. Holding it costs ${fmtAmount(m.annualOwnerSubsidy, 'MYR')} a year from your own income — ${fmtAmount(m.annualOwnerSubsidy * 5, 'MYR')} over five years and ${fmtAmount(m.annualOwnerSubsidy * 10, 'MYR')} over ten, before any major repair. That can be a deliberate choice on an appreciation case; it is not an income property.`));

  if (g.gates.length) {
    /* THE THREE THAT DECIDE IT, THEN THE REST ON REQUEST.
       Every blocker was listed at equal weight, so eleven items competed and
       the critical one read like the eleventh. Severity already exists on each
       gate and was only being used for a colour; it orders them now. */
    const rank = { critical: 0, serious: 1, warning: 2 };
    const ordered = [...g.gates].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
    const lead = ordered.slice(0, 3);
    const rest = ordered.slice(3);

    onePage.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' },
      g.grade === 'U' ? 'Why this cannot be graded' : 'Why this is conditional'));
    const gateLine = (x) => el('li', { class: 'evidence counter', style: 'font-size:13px' }, [
      el('span', { class: x.severity === 'critical' ? 'chip chip-bronze' : null,
        style: x.severity === 'critical' ? 'margin-right:6px' : 'display:none' }, 'Blocking'),
      x.text + (x.who ? ` Confirm with: ${x.who}.` : ''),
    ]);
    const gl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:6px' });
    lead.forEach(x => gl.append(gateLine(x)));
    onePage.append(gl);

    if (rest.length) {
      const more = el('details', { style: 'margin-top:8px' });
      more.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
        `Show all ${g.gates.length} blockers and assumptions`));
      const rl = el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:6px;margin-top:8px' });
      rest.forEach(x => rl.append(gateLine(x)));
      more.append(rl);
      onePage.append(more);
    }
  }

  /* THE CASH WATERFALL — where the completion figure comes from.
     "Cash to complete RM95.3k" is the number a reader has to raise, and it was
     a total with no decomposition on the first screen: the parts were in a cost
     table much further down, grouped by category rather than shown as a sum. */
  if (isNum(m.transactionCash) && m.transactionCash > 0) {
    const wf = el('details', { style: 'margin-top:var(--md)' });
    wf.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
      `Where ${fmtAmount(m.safeCashRequired, 'MYR')} of safe cash goes`));
    const steps = [
      ...(m.costGroups || []).map(grp => [grp.label,
        grp.items.reduce((a, it) => a + (isNum(it[1]) ? it[1] : 0), 0)]),
      ['Rent-ready cash', m.improvementCash],
      ['Reserve held back', m.reserveCash],
    ].filter(([, v]) => isNum(v) && v > 0);
    const total = steps.reduce((a, [, v]) => a + v, 0) || 1;
    const bars = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:var(--md)' });
    steps.forEach(([label, v]) => {
      bars.append(el('div', {}, [
        el('div', { class: 'row', style: 'gap:8px;justify-content:space-between' }, [
          el('span', { style: 'font-size:13px' }, label),
          el('span', { class: 'num', style: 'font-size:13px;font-weight:600' }, fmtAmount(v, 'MYR')),
        ]),
        el('div', { style: 'height:8px;border-radius:4px;background:var(--surface-sunk);margin-top:3px;overflow:hidden' },
          el('div', { style: `height:100%;width:${Math.max(1, v / total * 100)}%;background:var(--brand);border-radius:4px` })),
      ]));
    });
    wf.append(bars);
    if (m.missingCostLines?.length) wf.append(el('p', { class: 'metaline', style: 'margin-top:10px;color:var(--bronze)' },
      `${m.missingCostLines.length} cost line${m.missingCostLines.length === 1 ? '' : 's'} could not be priced, so this total is short by an unknown amount rather than complete.`));
    onePage.append(wf);
  }

  /* Whose numbers these are, beside the verdict they produced rather than in a
     card the reader reaches long after believing it. */
  const untouched = EVIDENCE_DRIVERS.filter(k => shownEvidence(d, k) === 'illustrative_default');
  if (untouched.length) {
    const warn = el('div', { style: 'margin-top:var(--md);padding:10px 12px;border-left:3px solid var(--bronze);background:var(--surface-2)' });
    warn.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
      el('span', { class: 'chip chip-bronze' }, 'Illustrative defaults'),
      el('p', { class: 'body', style: 'font-size:13px;flex:1 1 320px;margin:0' },
        `${untouched.map(k => ptr(`in.${k}`, k).replace(/\s*\(.*\)$/, '').toLowerCase()).join(', ')} ${untouched.length === 1 ? 'is' : 'are'} still the number this tool opened with. Nobody chose ${untouched.length === 1 ? 'it' : 'them'} for this property and no market was consulted — replace ${untouched.length === 1 ? 'it' : 'them'} before relying on anything below.`),
    ]));
    if (d.city !== 'kuching') warn.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      `These defaults were written around a Kuching condominium. They are not a starting point for ${(SARAWAK_CITIES.find(c => c.id === d.city) || {}).name || 'this location'}, and this tool holds no transacted price or rent for it.`));
    onePage.append(warn);
  }

  const answers = el('div', { class: 'grid g-4', style: 'margin-top:var(--md)' });
  [['Cash to complete', fmtAmount(m.transactionCash, 'MYR'), 'Paid out on completion day'],
   ['Safe cash required', fmtAmount(m.safeCashRequired, 'MYR'), 'Including rent-ready and the reserve'],
   ['Monthly position', isNum(m.cashflowMonthly) ? fmtAmount(m.cashflowMonthly, 'MYR') : '—',
     m.annualOwnerSubsidy > 0 ? `Costs you ${fmtAmount(m.annualOwnerSubsidy, 'MYR')} a year to hold` : 'After vacancy and normal costs'],
   ['Break-even rent', isNum(m.breakEvenRent) ? fmtAmount(m.breakEvenRent, 'MYR') : '—',
     isNum(m.breakEvenOccupancy) ? `or ${fmtPct(m.breakEvenOccupancy, 0)} occupancy at the entered rent` : 'not computable']]
    .forEach(([l, v, s]) => answers.append(el('div', { class: 'panel' }, statTile(l, v, { sub: s }))));
  onePage.append(answers);

  /* Pillars, so the grade decomposes rather than being taken on trust. */
  const pw = el('details', { style: 'margin-top:var(--md)' });
  pw.append(el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'How this grade was reached'));
  const pt = el('table', { class: 'dt', style: 'margin-top:8px' });
  pt.append(el('thead', {}, el('tr', {}, ['Pillar', 'Weight', 'Score', 'Basis'].map((h, i) =>
    el('th', { style: i === 0 || i === 3 ? 'text-align:left' : null }, h)))));
  const pb = el('tbody');
  g.pillars.forEach(p => pb.append(el('tr', {}, [
    el('td', { style: 'text-align:left' }, p.label),
    el('td', { class: 'num' }, `${p.weight}%`),
    el('td', { class: 'num' }, isNum(p.score) ? String(p.score) : el('span', { class: 'caption' }, 'not tested')),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, p.note || ''),
  ])));
  pt.append(pb);
  pw.append(el('div', { class: 'tablewrap' }, pt));
  pw.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    /* Counted from the registry rather than written out. The sentence said
       "all seven" against six pillars — a number in prose beside the list it
       describes will eventually disagree with it. */
    `The score is weighted across the pillars that could be tested, not across all ${GRADE_PILLARS.length} — a pillar with no evidence reduces coverage rather than scoring zero, so nothing loses points for data nobody has. Coverage is ${fmtPct(g.coverage * 100, 0)} of the framework weight; an A needs 90% and a B needs 80%.`));
  onePage.append(pw);
  wrap.append(onePage);

  /* ---- financing readiness (specification 30) -------------------------- */
  const b = State.borrower;
  const lr = loanReadiness(b, m);
  const pf = propertyFinanceability(d, m);
  const finCard = el('div', { class: 'card' });
  finCard.append(cardHead('Can this be financed?',
    'Three separate questions. Collapsing them into one percentage would hide the one that is actually blocking.'));

  const trio = el('div', { class: 'grid g-3' });
  trio.append(el('div', { class: 'panel' }, statTile('Borrower Loan Readiness',
    b.assessed && isNum(lr.score) ? `${lr.score}/100` : '—',
    { sub: b.assessed ? lr.band : 'Loan readiness not assessed' })));
  trio.append(el('div', { class: 'panel' }, statTile('Property Financeability',
    isNum(pf.score) ? `${pf.score}/100` : '—',
    { sub: pf.gates.length ? `${pf.gates.length} item${pf.gates.length === 1 ? '' : 's'} to verify first` : 'No blocking item recorded' })));
  trio.append(el('div', { class: 'panel' }, statTile('Modelled financing coverage',
    isNum(m.financingCoverageOfPrice) ? fmtPct(m.financingCoverageOfPrice, 1) : '—',
    { sub: m.financingBasisConfirmed ? 'of the price, on the entered valuation' : 'modelled, not lender-confirmed' })));
  finCard.append(trio);

  /* The sentence this section exists to make unmissable. */
  finCard.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:var(--md)' },
    b.assessed && isNum(lr.score)
      ? `Loan Readiness ${lr.score}/100 is a diagnostic score, not a ${lr.score}% chance of approval. No approval probability is offered anywhere in this product, because calculating one honestly would need a lender's own record of applications and outcomes, and nobody outside a lender has that. Each lender applies its own credit policy and its own final assessment.`
      : 'Loan readiness has not been assessed. That is shown as unassessed rather than as a favourable default — an unanswered affordability question is not a passed one.'));

  if (pf.gates.length) {
    finCard.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Verify before a lender can be approached'));
    const gl = el('ul', { class: 'ticklist' });
    pf.gates.forEach(x => gl.append(el('li', {}, x)));
    finCard.append(gl);
    finCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'Property Financeability is left unscored rather than averaged while any of these is open. A title question cannot be offset by a good valuation.'));
  }

  /* Borrower inputs, behind a disclosure because they are the most sensitive
     data here and most readers modelling a property will not want them. */
  const bd = el('details', { style: 'margin-top:var(--md)' });
  bd.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
    b.assessed ? 'Your financing position — entered' : 'Assess your loan readiness'));
  bd.append(el('p', { class: 'metaline', style: 'margin:8px 0' },
    'Held in this browser under its own key, never written into the page address, never included in the property export, and never used for anything but this calculation. It does not reach the equity research anywhere in this product — the same analysis is shown to everyone regardless of their circumstances, and that is deliberate.'));

  const bnum = (k, label, step) => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', { for: `b-${k}` }, label));
    f.append(el('input', { class: 'input input-inline', id: `b-${k}`, type: 'number', step: step || 100,
      value: String(b[k] ?? 0), style: 'text-align:right',
      onchange: e => { b[k] = num0(e.target.value); b.assessed = true; saveBorrower(); render(); } }));
    return f;
  };
  bd.append(el('p', { class: 'eyebrow', style: 'margin:10px 0 6px' }, 'Income and commitments, monthly'));
  [['verifiedNetMonthlyIncome', 'Net income after tax and EPF (RM)'],
   ['variableIncomeMonthlyAverage', 'Commission or variable income, monthly average (RM)'],
   ['variableIncomeLookbackMonths', 'Months that average covers', 1],
   ['existingMonthlyDebtPayments', 'All existing monthly debt payments (RM)'],
   ['essentialMonthlyCommitments', 'Essential household commitments (RM)'],
   ['creditCardUtilisationPct', 'Credit card utilisation (%)', 1],
   ['liquidCashAvailable', 'Cash available now (RM)'],
   ['incomeStabilityMonths', 'Months in the current role or business', 1]]
    .forEach(([k, l, s]) => bd.append(bnum(k, l, s)));

  const crField = el('div', { class: 'field', style: 'margin-top:10px' });
  crField.append(el('label', { for: 'b-credit' }, 'Credit record (CCRIS)'));
  const crSel = el('select', { class: 'select', id: 'b-credit',
    onchange: e => { b.creditReview = e.target.value; b.assessed = true; saveBorrower(); render(); } });
  CREDIT_STATES.forEach(c => crSel.append(el('option', { value: c.id, selected: b.creditReview === c.id ? '' : null }, c.label)));
  crField.append(crSel);
  crField.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
    'Obtain your own report through Bank Negara’s eCCRIS service. This tool never asks for those credentials and cannot retrieve it for you.'));
  bd.append(crField);

  bd.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Documents gathered'));
  BORROWER_DOCS.forEach(doc => {
    const lab = el('label', { class: 'checkline', style: 'gap:8px;display:flex;margin-top:4px' });
    lab.append(el('input', { type: 'checkbox', checked: b.docs?.[doc.k] === 'provided' ? '' : null,
      onchange: e => { b.docs = { ...(b.docs || {}), [doc.k]: e.target.checked ? 'provided' : 'missing' }; b.assessed = true; saveBorrower(); render(); } }));
    lab.append(el('span', {}, doc.label));
    bd.append(lab);
  });

  if (b.assessed) {
    const a = lr.affordability;
    if (a.computable) {
      const akv = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
      [['Debt service now', `${fmtPct(a.baseDSR, 1)} of net income — (${fmtAmount(a.existing, 'MYR')} existing + ${fmtAmount(a.instalment, 'MYR')} new) ÷ ${fmtAmount(a.income, 'MYR')}`],
       ['Debt service at +3 points', isNum(a.stressedDSR) ? fmtPct(a.stressedDSR, 1) : '—'],
       ['Cash left after all debt', fmtAmount(a.cashLeftAfterDebt, 'MYR')],
       ['After essentials too', fmtAmount(a.cashLeftAfterEssentials, 'MYR')]]
        .forEach(([k, v]) => { akv.append(el('dt', {}, k)); akv.append(el('dd', {}, v)); });
      bd.append(akv);
      bd.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
        'Lenders define debt-service ratio differently and set their own limits. Bank Negara’s financial-stability analysis identifies debt service above 60% of net income as a higher-vulnerability group — that describes risk, it is not a threshold any particular lender applies. The cash left matters as much as the ratio: a ratio can look acceptable while what remains does not cover a household.'));
    }
    const ct = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
    ct.append(el('thead', {}, el('tr', {}, ['Component', 'Weight', 'Score', 'Basis'].map((h, i) =>
      el('th', { style: i === 0 || i === 3 ? 'text-align:left' : null }, h)))));
    const cb = el('tbody');
    lr.components.forEach(c => cb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, c.label),
      el('td', { class: 'num' }, `${c.weight}%`),
      el('td', { class: 'num' }, isNum(c.score) ? String(c.score) : el('span', { class: 'caption' }, 'not tested')),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, c.note || ''),
    ])));
    ct.append(cb);
    bd.append(el('div', { class: 'tablewrap' }, ct));
    if (lr.unknowns.length) bd.append(el('p', { class: 'metaline', style: 'margin-top:8px;color:var(--bronze)' },
      `Not assessed: ${lr.unknowns.join(', ')}. A total is withheld while any of these is open rather than presented with the gap inside it.`));
    bd.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:10px', onclick: () => {
      if (!confirm('Remove everything you entered about your income, debts and credit? There is no copy anywhere else.')) return;
      store.write('borrowerProfile', null); location.reload();
    } }, 'Erase my financing details'));
  }
  finCard.append(bd);
  wrap.append(finCard);

  /* Modelling states that change every figure below and cannot be inferred from
     the numbers themselves. */
  if (m.zeroRateModelled || !m.tenureValid || !m.reserveComputable) {
    const flags = el('div', { class: 'card', style: 'border-left:3px solid var(--dn-text)' });
    const ul = el('ul', { class: 'ticklist' });
    if (m.zeroRateModelled) ul.append(el('li', {},
      'The loan interest rate is 0%. If that was intended, the instalment below is right; if the box was cleared, it is roughly half what it should be. This tool cannot tell the two apart from the value.'));
    if (!m.tenureValid) ul.append(el('li', {},
      'The loan tenure is zero or negative, so there is no repayment schedule. The instalment, reserve and closing balance are not computable and are shown as unavailable rather than calculated.'));
    if (!m.reserveComputable) ul.append(el('li', {},
      'The reserve could not be computed because the instalment or the running costs could not be. It is reported as missing rather than counted as nothing.'));
    flags.append(cardHead('Check these before reading anything below', 'Each one changes every figure in the report.'));
    flags.append(ul);
    wrap.append(flags);
  }

  /* The illustrative-defaults warning used to be built here, roughly eight
     screens below the verdict it qualifies. It now renders inside the grade
     card, immediately after the reasons the deal cannot be graded. */

  /* The opportunity register had no inbound link anywhere in the product, and
     the reader who has just modelled a deal is precisely the one who wants to
     record it. A real anchor, so it can be opened in a new tab. */
  wrap.append(el('div', { class: 'note', style: 'display:flex;flex-wrap:wrap;gap:10px;align-items:center' }, [
    el('p', { class: 'body', style: 'font-size:13px;flex:1 1 320px;margin:0' },
      'Modelling one deal answers what it would do. Recording several answers which ones exist and what you actually know about each — the register keeps the source, the availability date, four separate prices and a next action with an owner.'),
    el('a', { class: 'btn btn-ghost btn-sm', href: href('/property/opportunities'),
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/opportunities'); } },
      'Open the opportunity register'),
  ]));

  const layout = el('div', { class: 'studio-layout' });

  /* ---------- inputs ---------- */
  const rail = el('div', { class: 'card rail-sticky' });
  rail.append(cardHead('Your deal', 'Everything is yours to enter. The free calculator is complete — nothing below is withheld.'));

  /* Location first. In Sarawak the district decides the title class, the flood
     exposure and who the tenants are, and every one of those matters more to
     the outcome than the purchase price does. */
  const loc = el('div', { style: 'margin-bottom:var(--md);padding-bottom:var(--md);border-bottom:1px solid var(--line)' });
  loc.append(el('p', { class: 'eyebrow', style: 'margin-bottom:8px' }, '1 · Where'));

  const cityField = el('div', { class: 'field' });
  cityField.append(el('label', { for: 'dealCity' }, 'City'));
  /* Read before the controls are built, so they render already showing what the
     link asked for. */
  if (readPropertyUrl(d)) saveDeal();
  /* Written on arrival too, so a bare /property/calculator becomes a link that
     reproduces what is on screen without the reader having to change anything
     first. */
  syncPropertyUrl(d);

  const citySel = el('select', { class: 'select', id: 'dealCity', onchange: e => {
    d.city = e.target.value;
    d.district = (SARAWAK_CITIES.find(c => c.id === d.city)?.districts || [''])[0];
    /* The project list is city-scoped, so a selection from the previous city is
       no longer on offer and must not stay selected behind the scenes. */
    if (!projectsForCity(d.city).some(x => x.id === d.projectId)) d.projectId = customProjectId(d.city);
    saveDeal(); syncPropertyUrl(d); render();
  } });
  SARAWAK_CITIES.forEach(c => citySel.append(el('option', { value: c.id, selected: d.city === c.id ? '' : null }, c.name)));
  cityField.append(citySel);
  loc.append(cityField);

  const cityDef = SARAWAK_CITIES.find(c => c.id === d.city) || SARAWAK_CITIES[0];
  const distField = el('div', { class: 'field', style: 'margin-top:10px' });
  distField.append(el('label', { for: 'dealDistrict' }, 'District or neighbourhood'));
  const distSel = el('select', { class: 'select', id: 'dealDistrict',
    onchange: e => { d.district = e.target.value; saveDeal(); syncPropertyUrl(d); render(); } });
  cityDef.districts.forEach(x => distSel.append(el('option', { value: x, selected: d.district === x ? '' : null }, x)));
  distField.append(distSel);
  loc.append(distField);

  /* What actually moves demand in the selected city. Prompts, not adjustments:
     the model changes nothing on the strength of these, because a tool that
     silently marked Miri rents down for the oil cycle would be forecasting. */
  if (cityDef.factors?.length) {
    const fx = el('div', { style: 'margin-top:12px' });
    fx.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' },
      `What moves demand in ${cityDef.name}`));
    const chips = el('div', { class: 'row row-wrap', style: 'gap:6px' });
    cityDef.factors.forEach(f => chips.append(el('span', { class: 'chip' }, f)));
    fx.append(chips);
    fx.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'These change nothing in the model. They are the questions a local buyer would ask, and the ones the numbers below cannot answer on their own.'));
    loc.append(fx);
  }

  /* Where the areas sit relative to each other, plus what the district earns.
     Loaded once and cached; absent until it arrives, and absent for good if
     the file was never fetched. */
  if (geoLoadState === 'idle') loadSarawakLayers();
  const mapAreas = sarawakGeo?.cities?.[d.city]?.areas;
  if (mapAreas && Object.keys(mapAreas).length) {
    const mapWrap = el('div', { style: 'margin-top:14px' });
    mapWrap.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' },
      `${cityDef.name} areas`));
    mapWrap.append(cityMap(d.city, d.district, (name) => {
      d.district = name; saveDeal(); render();
    }));
    mapWrap.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'Relative positions only — there is no basemap, road or boundary here. A hollow or dashed point is a coordinate taken from a landmark inside the area rather than the area itself. Click or press Enter on a point to select that area.'));
    mapWrap.append(tableTwin(`${cityDef.name} areas as a table`,
      ['Area', 'Latitude', 'Longitude', 'Coordinate is'],
      Object.entries(mapAreas).map(([n, a]) => [n, a.lat.toFixed(4), a.lon.toFixed(4),
        (AREA_CONFIDENCE[a.confidence] || {}).label || a.confidence])));
    mapWrap.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `${sarawakGeo.attribution} · ${sarawakGeo.licence}`));

    /* What has been recorded for the selected area, and a way to add to it. */
    const obs = observationsFor(d.city, d.district);
    const oc = el('div', { class: 'panel', style: 'margin-top:12px' });
    oc.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' },
      `What you have recorded — ${d.district}`));

    if (!obs.total) {
      oc.append(el('p', { class: 'body', style: 'font-size:13px' },
        'Nothing yet for this area. No source publishes neighbourhood rents or transactions for Sarawak, so the only way this becomes known is one observation at a time.'));
    } else {
      const ot = el('table', { class: 'dt' });
      ot.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Measure'), el('th', { class:'num' }, 'Observations'),
        el('th', { class:'num' }, 'Median'), el('th', { class:'num' }, 'Range'), el('th', {}, 'Best evidence')])));
      const ob = el('tbody');
      Object.values(obs.groups).forEach(g => {
        const best = EVIDENCE.find(e => e.rank === g.best);
        ob.append(el('tr', {}, [
          el('td', {}, [g.kind.label, g.kind.asking ? el('span', { class:'metaline' }, ' · quoted, not achieved') : null].filter(Boolean)),
          el('td', { class:'num' }, String(g.n)),
          el('td', { class:'num' }, g.n ? fmtNum(g.median, 0) : '—'),
          el('td', { class:'num' }, g.n > 1 ? `${fmtNum(g.lo, 0)}–${fmtNum(g.hi, 0)}` : '—'),
          el('td', { class:'metaline' }, best ? best.label : '—'),
        ]));
      });
      ot.append(ob);
      oc.append(el('div', { style:'overflow-x:auto' }, ot));
      oc.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
        'A median of a handful of readings is those readings, not the market. Asking and achieved are never combined — a quoted rent and a signed tenancy are different facts.'));
    }

    /* THE FORM CAPTURED NO AREA, SO NO RATE COULD EVER BE DERIVED FROM IT.
       The register has carried a price-per-square-foot measure for a while and
       this — the recorder a reader actually uses, sitting on the calculator —
       never asked for the floor area, so every record it made was incapable of
       contributing to it. The rate only ever worked for rows pasted in through
       the CSV importer, which is the path nobody takes first. A measure that can
       only be fed by the route people do not use is a measure that reads as
       empty and gets blamed on there being no data.

       The area field is now here, it knows which unit it is in, and it appears
       only for the kinds that need one — a weeks-vacant record has no area and
       asking for one would be noise. */
    const form = el('div', { style: 'margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;align-items:end' });
    const kindSel = el('select', { class:'select select-sm', 'aria-label':'What you observed' });
    OBSERVATION_KINDS.forEach(k => kindSel.append(el('option', { value:k.id }, `${k.label} (${k.unit})`)));
    const valInp = el('input', { class:'input input-sm', type:'number', inputmode:'decimal',
      placeholder:'Amount', 'aria-label':'Observed value' });

    /* Area, plus the unit it was typed in. Both are kept: a parcel entered as
       4 points is redisplayed as 4 points, never as 1,742.4 square feet. */
    const areaWrap = el('div', { class:'row', style:'gap:4px;align-items:center' });
    const areaInp = el('input', { class:'input input-sm', type:'number', inputmode:'decimal',
      style:'min-width:0', placeholder:'Area', 'aria-label':'Area of the property' });
    const unitSel = el('select', { class:'select select-sm', style:'max-width:5.5rem', 'aria-label':'Unit the area is in' });
    areaWrap.append(areaInp, unitSel);

    /* Ownership type on the RECORD, not only on the locality. A district whose
       transactions are all native area land is telling you something a single
       locality-level classification cannot. */
    const titleSel = el('select', { class:'select select-sm', 'aria-label':'Ownership type' });
    titleSel.append(el('option', { value:'' }, 'Ownership — not stated'));
    TITLE_TYPES.filter(t => t.id !== 'unknown').forEach(t =>
      titleSel.append(el('option', { value:t.id, title:t.note }, t.label)));

    /* Which units are offered, and whether an area is asked for at all, follow
       the selected kind rather than being fixed. */
    const syncKind = () => {
      const k = OBS_BY_ID[kindSel.value] || {};
      const wantsArea = !!k.area;
      areaWrap.style.display = wantsArea ? '' : 'none';
      titleSel.style.display = k.family === 'price' || k.family === 'land' ? '' : 'none';
      if (!wantsArea) return;
      const ids = k.area === 'land' ? LAND_UNITS : BUILT_UP_UNITS;
      const keep = unitSel.value;
      unitSel.replaceChildren();
      ids.forEach(id => unitSel.append(el('option', { value:id, title:areaUnit(id).why }, areaUnit(id).short)));
      unitSel.value = ids.includes(keep) ? keep : ids[0];
      areaInp.setAttribute('aria-label', k.area === 'land' ? 'Land area' : 'Floor area');
      areaInp.placeholder = k.area === 'land' ? 'Land area' : 'Floor area';
    };
    kindSel.addEventListener('change', syncKind);

    const evSel = el('select', { class:'select select-sm', 'aria-label':'Evidence quality' });
    /* Every class except the tool's own seeded default. Offering only rank 2 and
       above meant the weakest thing a reader could say about a number they half
       remembered was "developer supplied" — so the dropdown made them overstate
       it. "Estimated" and "assumed" are honest answers and belong here. */
    EVIDENCE.filter(e => e.rank >= 0).forEach(e => evSel.append(el('option', { value:e.id, selected: e.id === 'user' ? '' : null }, e.label)));
    const dateInp = el('input', { class:'input input-sm', type:'date',
      value: new Date().toISOString().slice(0, 10), 'aria-label':'Date observed' });
    /* The field that decides whether this is evidence or a note. Optional at
       capture, because a number nobody records is worth less than one recorded
       without its source — but the register says which it is, permanently. */
    const srcInp = el('input', { class:'input input-sm', type:'text',
      placeholder:'Source — listing, tenancy, filing', 'aria-label':'Source reference' });
    const addrInp = el('input', { class:'input input-sm', type:'text',
      placeholder:'Address or project', 'aria-label':'Address or project' });
    const addBtn = el('button', { class:'btn btn-sm', onclick: () => {
      const v = Number(valInp.value);
      if (!Number.isFinite(v) || v <= 0) { toast('Enter an amount above zero'); return; }
      const k = OBS_BY_ID[kindSel.value] || {};
      const rawArea = Number(areaInp.value);
      const hasArea = k.area && Number.isFinite(rawArea) && rawArea > 0;
      /* Stored in square feet, with the unit that was typed kept beside it. */
      const sqftValue = hasArea ? toSqft(rawArea, unitSel.value) : null;
      addObservation({ city:d.city, area:d.district, kind:kindSel.value, value:v,
                       evidence:evSel.value, date:dateInp.value,
                       sourceRef:srcInp.value.trim(), address:addrInp.value.trim(),
                       propertyType:d.propertyType,
                       titleType: titleSel.value || '',
                       ...(k.area === 'land'
                         ? { landSqft: sqftValue, landUnit: unitSel.value }
                         : { sqft: sqftValue, areaUnit: unitSel.value }) });
      toast(srcInp.value.trim()
        ? `Recorded for ${d.district}${hasArea ? '' : ' — no area, so no price per unit from this one'}`
        : `Recorded for ${d.district} — no source, so it counts as a note`);
      render();
    } }, 'Record');
    [kindSel, valInp, areaWrap, titleSel, evSel, dateInp, addrInp, srcInp, addBtn].forEach(x => form.append(x));
    syncKind();
    oc.append(form);
    oc.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'Stored in this browser only. It is never sent anywhere, it is not published with the site, and it carries no redistribution right — the same position as every other figure you supply here.'));
    const goto = (path, label) => el('a', { class: 'btn btn-ghost btn-sm', href: href(path),
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(path); } }, label);
    oc.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px' }, [
      goto('/property/comparables',
        `Open the comparables register${(State.observations || []).length ? ` — ${State.observations.length}` : ''}`),
      /* The screen is the register read by area rather than by record, so it
         belongs beside it rather than somewhere a reader has to already know
         about. */
      goto('/property/areas', 'Screen areas by flood and rent'),
    ]));
    mapWrap.append(oc);

    const aff = affordabilityPanel(cityDef.name);
    if (aff) mapWrap.append(el('div', { style: 'margin-top:12px' }, aff));
    else mapWrap.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
      'District household income is not loaded. It is cached locally by ingest/sarawak-geo.mjs and is not published with the site while its licence is unconfirmed.'));
    loc.append(mapWrap);
  }

  const typeField = el('div', { class: 'field', style: 'margin-top:10px' });
  typeField.append(el('label', { for: 'dealType' }, 'Property type'));
  const typeSel = el('select', { class: 'select', id: 'dealType',
    onchange: e => { d.propertyType = e.target.value; saveDeal(); syncPropertyUrl(d); render(); } });
  PROPERTY_TYPES.forEach(x => typeSel.append(el('option', { value: x, selected: d.propertyType === x ? '' : null }, x)));
  typeField.append(typeSel);
  loc.append(typeField);

  const titleField = el('div', { class: 'field', style: 'margin-top:10px' });
  titleField.append(el('label', { for: 'dealTitle' }, 'Title class'));
  const titleSel = el('select', { class: 'select', id: 'dealTitle',
    onchange: e => { d.titleType = e.target.value; saveDeal(); render(); } });
  TITLE_TYPES.forEach(t => titleSel.append(el('option', { value: t.id, selected: d.titleType === t.id ? '' : null }, t.label)));
  titleField.append(titleSel);
  const tDef = TITLE_TYPES.find(t => t.id === d.titleType);
  if (tDef) titleField.append(el('p', { class: 'metaline', style: 'margin-top:5px' }, tDef.note));
  /* A dropdown implies the platform has determined something. It has not: it
     recorded what the user typed. Land Code classification governs who may
     lawfully hold the title, and getting it wrong is not a modelling error —
     it is a void transfer. */
  titleField.append(el('div', { class: 'note', style: 'margin-top:8px' }, [
    el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' }, 'Title classification recorded from your input'),
    el('p', { class: 'metaline' },
      'Eligibility has not been verified. Nothing here confirms that a transfer is permitted, and this selection changes only how the tool describes the property to you. Confirm with a Sarawak property lawyer and the Land and Survey Department before relying on it.'),
  ]));
  loc.append(titleField);

  if (d.titleType !== 'strata') {
    const leaseField = el('div', { class: 'field', style: 'margin-top:10px' });
    leaseField.append(el('label', { for: 'dealLease' }, 'Years remaining on the lease (0 if freehold)'));
    leaseField.append(el('input', { class: 'input', id: 'dealLease', type: 'number', min: '0', max: '999',
      value: String(d.remainingLease ?? 0),
      oninput: e => { d.remainingLease = num0(e.target.value); saveDeal(); render(); } }));
    loc.append(leaseField);
  }
  rail.append(loc);
  rail.append(el('p', { class: 'eyebrow', style: 'margin-bottom:8px' }, '2 · What'));

  const psel = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  psel.append(el('label', { for: 'pj' }, 'Project'));
  const cityProjects = projectsForCity(d.city);
  const ps = el('select', { class: 'select', id: 'pj', onchange: e => {
    d.projectId = e.target.value;
    const pr2 = PROJECTS.find(x => x.id === d.projectId);
    /* A named project seeds the assumptions from its own observed figures. The
       custom entry seeds nothing: leaving the reader's own numbers in place is
       the honest behaviour when there is no comparable to replace them with. */
    if (pr2) {
      d.sqft = pr2.sqft; d.price = Math.round(pr2.psfMid * pr2.sqft / 1000) * 1000;
      d.rent = pr2.rentMid; d.vacancyPct = pr2.vacancyPct;
      d.maintenance = Math.round(pr2.maintPsf * pr2.sqft);
      d.evidence = { ...(d.evidence || {}), price:'estimated', rent:'estimated' };
    } else {
      d.evidence = { ...(d.evidence || {}), price:'user', rent:'user' };
    }
    saveDeal(); syncPropertyUrl(d); render();
  } });
  cityProjects.forEach(pr2 => ps.append(el('option', { value: pr2.id, selected: pr2.id === d.projectId ? '' : null },
    `${pr2.name} — ${pr2.area}`)));
  const customId = customProjectId(d.city);
  ps.append(el('option', { value: customId, selected: isCustomProject(d.projectId) ? '' : null },
    `Custom property — ${cityDef.name}`));
  psel.append(ps);
  psel.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    cityProjects.length
      ? `Sample projects in ${cityDef.name} only. Comparables from another city are not offered, because they are a different market rather than a weaker reading of this one.`
      : `No sample project is held for ${cityDef.name}, and none has been invented. Enter the property yourself — the model runs identically, and says plainly that it has no transacted evidence to check your figures against.`));
  rail.append(psel);

  /* Grouped, because a flat list of twenty numbers reads as a form to be
     endured rather than a model to be understood. Each group is one question:
     what does it cost, what does it earn, what does it cost to run, what
     happens on the way out. */
  const GROUPS = [
    ['Size and parking', [
      ['sqft', 'Built-up area (sq ft)', 10],
      ['landSqft', 'Land area (sq ft, 0 if none)', 10],
      ['parking', 'Allocated parking bays', 1],
    ]],
    ['3 · Purchase', [
      ['price', 'Purchase price (RM)', 1000],
      ['bankValuation', 'Bank or valuer estimate (RM, 0 if not yet known)', 1000],
      ['bookingDepositPaid', 'Booking deposit already paid (RM)', 500],
      ['renovation', 'Renovation and furnishing (RM)', 500],
      ['downPct', 'Deposit (%)', 1],
      ['ratePct', 'Loan interest rate (%)', 0.05],
      ['tenureYears', 'Loan tenure (years)', 1],
    ]],
    ['4 · Income', [
      ['rent', 'Expected monthly rent (RM)', 50],
      ['rentGrowthPct', 'Annual rent growth (%)', 0.25],
      ['vacancyPct', 'Vacancy allowance (%)', 1],
    ]],
    ['5 · Running costs', [
      ['maintenance', 'Monthly maintenance (RM)', 10],
      ['sinkingFund', 'Monthly sinking fund (RM)', 10],
      ['assessment', 'Annual assessment (RM)', 50],
      ['quitRent', 'Annual quit rent (RM)', 25],
      ['insurance', 'Annual insurance (RM)', 50],
      ['mgmtPct', 'Letting and management fee (% of rent)', 0.5],
      ['repairReservePct', 'Repair reserve (% of rent)', 0.5],
    ]],
    /* A fee percentage says what management costs and nothing about what it
       does. These are the terms that decide both — and the ones a landlord has
       to agree before signing a mandate, not after. */
    ['6 · Management operations', [
      ['selfManaged', 'I will manage this property myself', 'bool'],
      ['leasingFeeMonths', 'Tenant placement fee (months of rent)', 0.25],
      ['renewalFeeMonths', 'Renewal fee (months of rent)', 0.25],
      ['mgmtMinMonthly', 'Minimum monthly fee (RM)', 10],
      ['tenancyMonths', 'Expected tenancy length (months)', 6],
      ['daysToFirstTenant', 'Target days to place a tenant', 5],
      ['depositMonths', 'Tenancy deposit held (months)', 0.5],
      ['repairApprovalLimit', 'Repair the manager may authorise without asking (RM)', 50],
      ['inspectionsPerYear', 'Inspections a year, with a written report', 1],
      ['arrearsChaseDays', 'Days late before arrears are chased', 1],
      ['ownerReportCadence', 'Owner statement', ['monthly', 'quarterly', 'on request', 'not agreed']],
      ['tenantPaysUtilities', 'Tenant pays utilities, not the owner', 'bool'],
    ]],
    ['7 · Exit', [
      ['holdYears', 'Holding period (years)', 1],
      ['apprecPct', 'Annual capital growth (%)', 0.25],
      ['sellMonths', 'Expected months to sell', 1],
      ['agentPct', 'Agent commission on exit (%)', 0.25],
      ['exitLegalPct', 'Legal costs on exit (%)', 0.1],
    ]],
    ['8 · Comparison', [
      ['equityReturnPct', 'Assumed equity return (% a year)', 0.5],
    ]],
  ];
  GROUPS.forEach(([heading, fields]) => {
    rail.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 8px' }, heading));
    fields.forEach(([k, label, step]) => {
      const f = el('div', { class: 'assumption' });
      /* Two non-numeric kinds, because a management mandate is made of
         commitments and cadences as well as amounts. */
      if (step === 'bool') {
        const l = el('label', { class: 'checkline', style: 'gap:8px;display:flex;align-items:flex-start' });
        l.append(el('input', { type: 'checkbox', checked: d[k] ? '' : null,
          onchange: e => { d[k] = e.target.checked; markTouched(d, k); saveDeal(); render(); } }));
        l.append(el('span', {}, ptr(`in.${k}`, label)));
        rail.append(l);
        return;
      }
      if (Array.isArray(step)) {
        f.append(el('label', { for: `d-${k}` }, ptr(`in.${k}`, label)));
        const s = el('select', { class: 'select select-sm', id: `d-${k}`,
          onchange: e => { d[k] = e.target.value; markTouched(d, k); saveDeal(); render(); } });
        step.forEach(o => s.append(el('option', { value: o, selected: d[k] === o ? '' : null }, o)));
        f.append(s);
        rail.append(f);
        return;
      }
      f.append(el('label', { for: `d-${k}` }, ptr(`in.${k}`, label)));
      f.append(el('input', { class: 'input input-inline', id: `d-${k}`, type: 'number', step,
        value: d[k] ?? 0, style: 'text-align:right',
        onchange: e => { d[k] = num0(e.target.value); markTouched(d, k); saveDeal(); render(); } }));
      /* Said beside the number rather than only in the evidence section below,
         because this is where a reader decides whether to trust it. */
      if (EVIDENCE_DRIVERS.includes(k) && shownEvidence(d, k) === 'illustrative_default')
        f.append(el('span', { class: 'metaline', style: 'flex-basis:100%;color:var(--bronze);margin-top:2px' },
          'Illustrative default — not yours, and not from any market'));
      rail.append(f);
    });
  });

  /* Provenance for the figures that actually move the answer. */
  rail.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 8px' }, '9 · Evidence quality'));
  rail.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' },
    'Where each of the two figures that drive every output came from.'));
  [['price', 'Purchase price'], ['rent', 'Expected rent'], ['maintenance', 'Maintenance'], ['sqft', 'Built-up area']]
    .forEach(([k, label]) => {
      const f = el('div', { class: 'assumption' });
      f.append(el('label', { for: `ev-${k}` }, label));
      const sel = el('select', { class: 'select select-sm', id: `ev-${k}`,
        onchange: e => {
          d.evidence = { ...(d.evidence || {}), [k]: e.target.value };
          /* Grading a figure IS a statement about it, so it stops being an
             untouched default at that point — but only upward. Selecting
             "illustrative default" leaves it exactly what it is. */
          if (e.target.value !== 'illustrative_default') markTouched(d, k);
          saveDeal(); render();
        } });
      const shown = shownEvidence(d, k);
      EVIDENCE.forEach(ev => sel.append(el('option', { value: ev.id,
        selected: shown === ev.id ? '' : null }, ptr(`ev.${ev.id}`, ev.label))));
      f.append(sel);
      rail.append(f);
    });

  layout.append(rail);

  /* ---------- outputs ---------- */
  const out = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md);min-width:0' });

  /* free tier: the four headline numbers */
  const free = el('div', { class: 'card' });
  /* Language applies to the summary below and to the metric names in it. The
     analysis itself stays in English, which the note says rather than leaving
     the reader to discover it. */
  const langRow = el('div', { class: 'row', style: 'gap:6px;margin-bottom:10px;flex-wrap:wrap' });
  LANGUAGES.forEach(L => langRow.append(el('button', {
    class: 'btn btn-ghost btn-sm', 'aria-pressed': lang() === L.id ? 'true' : 'false',
    style: lang() === L.id ? 'border-color:var(--brand);color:var(--brand)' : '',
    onclick: () => { State.lang = L.id; store.write('lang', L.id); render(); },
  }, L.native)));
  free.append(langRow);

  const sc = SUMMARY_COPY[lang()] || SUMMARY_COPY.en;
  const summary = el('div', { class: 'panel', style: 'margin-bottom:var(--md)' });
  summary.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:8px' }, sc.title));
  const srows = [
    [tr('grossYield'),       fmtPct(m.grossYield, 2)],
    [tr('netYield'),         fmtPct(m.netYield, 2)],
    [tr('netCashFlow'),      fmtAmount(m.cashflowMonthly, 'MYR') + ' / bln'],
    [tr('breakEvenRent'),    fmtAmount(m.breakEvenRent, 'MYR')],
    [tr('monthlyInstalment'),fmtAmount(m.instalment, 'MYR')],
    [tr('totalInitialCash'), fmtAmount(m.totalInitialCash, 'MYR')],
  ];
  const sumT = el('table', { class: 'dt' });
  sumT.append(el('tbody', {}, srows.map(([k, v]) => el('tr', {}, [
    el('td', {}, k), el('td', { class: 'num' }, v)]))));
  summary.append(el('div', { style: 'overflow-x:auto' }, sumT));
  summary.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, sc.note));
  free.append(summary);

  /* THE REVIEW QUEUE, ABOVE THE RESULT IT QUALIFIES.
     Below the four headline figures it would be a footnote on a number the
     reader has already taken. */
  const queue = propertyReviewQueue(d);
  if (queue.length) {
    const q = el('div', { class: 'card', style: 'border-left:3px solid var(--bronze);margin-bottom:var(--md)' });
    const det = el('details');
    const sum = el('summary', { style: 'cursor:pointer;list-style:none;display:flex;align-items:center;gap:10px;flex-wrap:wrap' });
    sum.append(el('span', { class: 'chip chip-bronze' }, `${queue.length} sample input${queue.length === 1 ? '' : 's'}`));
    sum.append(el('span', { style: 'font-size:16px;font-weight:600' },
      `Review ${queue.length} sample input${queue.length === 1 ? '' : 's'}`));
    sum.append(el('span', { class: 'metaline', style: 'flex-basis:100%' },
      'These are figures this tool seeded, not figures you gave it. The result below is arithmetic on them.'));
    det.append(sum);

    const list = el('div', { style: 'margin-top:var(--md);display:flex;flex-direction:column;gap:2px' });
    queue.forEach(f => {
      const row = el('div', { class: 'row row-wrap',
        style: 'gap:10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--grid)' });
      row.append(el('span', { style: 'font-size:14px;font-weight:600;min-width:150px' }, f.label));
      row.append(el('span', { class: 'num', style: 'font-size:14px;min-width:120px' },
        isNum(d[f.k]) ? f.fmt(d[f.k]) : '—'));
      row.append(el('span', { class: 'metaline', style: 'flex:1 1 260px' }, f.affects));
      row.append(el('button', {
        class: 'btn btn-quiet btn-sm', style: 'margin-left:auto',
        onclick: () => {
          const input = document.querySelector(`#d-${f.k}`);
          if (!input) return;
          input.closest('.assumption')?.scrollIntoView({ block: 'center' });
          input.focus(); input.select?.();
        } }, 'Go to it'));
      list.append(row);
    });
    det.append(list);
    det.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
      'A figure leaves this list when you change it, or when you grade it under Evidence quality. '
      + 'Typing the same number yourself still counts — that is a decision about it.'));
    q.append(det);
    free.append(q);
  }

  free.append(cardHead('Free calculator', 'The four numbers that decide whether a rental property is worth analysing further.'));
  const fg = el('div', { class: 'grid g-4' });
  fg.append(el('div', { class: 'panel' }, statTile('Gross yield', fmtPct(m.grossYield, 2), { sub: 'Annual rent ÷ purchase price' })));
  fg.append(el('div', { class: 'panel' }, statTile('Monthly instalment', fmtAmount(m.instalment, 'MYR'), { sub: `${fmtPct(d.ratePct, 2)} over ${d.tenureYears} years` })));
  fg.append(el('div', { class: 'panel' }, statTile('Monthly cash flow', fmtAmount(m.cashflowMonthly, 'MYR'),
    { sub: 'After costs, vacancy and the loan', tone: m.cashflowMonthly >= 0 ? '--ok-text' : '--dn-text' })));
  fg.append(el('div', { class: 'panel' }, statTile('Break-even rent', fmtAmount(m.breakEvenRent, 'MYR'), { sub: 'Rent needed to cover everything' })));
  free.append(fg);

  /* THE SAME PRICE, IN THE UNITS IT WILL BE ARGUED IN.
     A Sarawak land negotiation happens in points, a valuer's report in square
     metres, and a brochure in square feet. Converting between them by hand is
     where a decimal goes missing, so the three are shown together and the
     reader can check the figure they were quoted against the one they think
     they are paying.

     Every tile is the same price over a different area. Nothing is converted
     twice and no rate is stored, so they cannot drift apart. */
  /* IPS §3, §6.5, §6.7 and §6.8 — the four that had no implementation. The
     gate panel goes first because it is the summary the rest explains. */
  free.append(returnsAndTaxPanel(d, m));
  free.append(ipsGatePanel(propertyIps(d, m, g), { title: 'Against the methodology' }));
  free.append(demandPanel(d.city, d.district));
  free.append(environmentalPanel(d));
  free.append(rentVersusBuyPanel(d, m));

  const unitCard = el('div', { class: 'render-block', style: 'margin-top:var(--lg)' });
  unitCard.append(el('h4', { style: 'font-size:var(--text-lead);font-weight:var(--weight-semibold);margin:0' },
    'What you are paying, per unit'));
  const unitTile = (label, perSqft, unit, dp, sub) => {
    const v = rateInUnit(perSqft, unit);
    return el('div', { class: 'panel' }, statTile(label,
      isNum(v) ? `${fmtMoney(v, 'MYR', dp)}/${areaUnit(unit).short}` : '—',
      { sub: isNum(v) ? sub : 'No area entered, so this cannot be computed' }));
  };
  const ug = el('div', { class: 'grid g-3', style: 'margin-top:var(--sm)' });
  ug.append(unitTile('Floor area', m.psf, 'sqft', 0,
    num0(d.sqft) > 0 ? `${fmtNum(d.sqft, 0)} sq ft of built-up` : ''));
  ug.append(unitTile('Floor area', m.psf, 'sqm', 0,
    num0(d.sqft) > 0 ? `${fmtArea(convertArea(d.sqft, 'sqft', 'sqm'), 'sqm')} of built-up` : ''));
  ug.append(unitTile('Land', m.landPsf, 'point', 0,
    num0(d.landSqft) > 0 ? `${fmtArea(convertArea(d.landSqft, 'sqft', 'point'), 'point')} of land` : ''));
  unitCard.append(ug);
  const ug2 = el('div', { class: 'grid g-3', style: 'margin-top:var(--sm)' });
  ug2.append(unitTile('Land', m.landPsf, 'acre', 0,
    num0(d.landSqft) > 0 ? `${fmtArea(convertArea(d.landSqft, 'sqft', 'acre'), 'acre')} of land` : ''));
  ug2.append(unitTile('Maintenance, monthly', m.maintPsf, 'sqft', 2, 'Service charge per sq ft per month'));
  ug2.append(unitTile('Maintenance, monthly', m.maintPsf, 'sqm', 2, 'Service charge per m² per month'));
  unitCard.append(ug2);
  unitCard.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' }, POINT_DEFINITION));
  free.append(unitCard);

  /* The two rent tiles above, drawn against each other. One series, so no
     legend — the title names it and both marks are directly labelled. */
  if (isNum(m.breakEvenRent) && m.breakEvenRent > 0 && isNum(d.rent)) {
    const rb = el('div', { class: 'render-block', style: 'margin-top:var(--lg)' });
    rb.append(el('h4', { style: 'font-size:var(--text-lead);font-weight:var(--weight-semibold);margin:0' },
      'Rent against break-even'));
    const rbHost = el('div', { style: 'margin-top:var(--sm)' });
    rb.append(rbHost);
    /* breakEvenRent is the gross monthly asking rent at which fixed costs and
       debt service are covered once vacancy and the rent-linked costs are
       taken out, so it is directly comparable to the entered rent. Nothing is
       rescaled to make the comparison work. */
    thresholdBar(rbHost, {
      value: d.rent, valueLabel: 'your rent',
      threshold: m.breakEvenRent, thresholdLabel: 'break-even',
      ccy: 'MYR',
      aria: (covers, gap) => `Entered rent ${fmtMoney(d.rent, 'MYR')} a month against a break-even rent of `
        + `${fmtMoney(m.breakEvenRent, 'MYR')} a month. `
        + (covers ? `The rent covers costs and the loan by ${fmtMoney(gap, 'MYR')} a month.`
                  : `The rent is ${fmtMoney(gap, 'MYR')} a month short.`),
    });
    const short = m.breakEvenRent - d.rent;
    rb.append(el('p', { class: 'metaline', style: 'margin-top:var(--xs)' },
      short > 0
        ? `At ${fmtMoney(d.rent, 'MYR')} the rent is ${fmtMoney(short, 'MYR')} a month below the rent that would cover `
          + `fixed costs and the loan, which is a rise of ${fmtPct((short / d.rent) * 100, 0)}. `
          + 'Break-even rent is a gross asking rent, measured after vacancy and the rent-linked costs.'
        : `At ${fmtMoney(d.rent, 'MYR')} the rent covers fixed costs and the loan with `
          + `${fmtMoney(-short, 'MYR')} a month over. Break-even rent is a gross asking rent, `
          + 'measured after vacancy and the rent-linked costs.'));
    free.append(rb);
  }

  /* The same build-up as a picture, above the table that itemises it. Two
     tiers means a legend is not optional — identity may never rest on colour
     alone, and here the colour carries the one distinction that matters. */
  if ((m.costGroups || []).length >= 2) {
    const wf = el('div', { class: 'render-block', style: 'margin-top:var(--lg)' });
    wf.append(el('h4', { style: 'font-size:var(--text-lead);font-weight:var(--weight-semibold);margin:0' },
      'What the cash is for'));
    const swatch = (tok, text) => el('span', { class: 'caption',
      style: 'display:inline-flex;align-items:center;gap:6px' }, [
      el('span', { 'aria-hidden': 'true', style: `width:10px;height:10px;border-radius:3px;background:var(${tok})` }),
      text]);
    wf.append(el('div', { style: 'display:flex;flex-wrap:wrap;gap:var(--md);margin:6px 0 var(--md)' }, [
      swatch('--seq-6', 'Needed to complete the purchase'),
      swatch('--seq-4', 'Needed afterwards, to be safe'),
    ]));
    const wfHost = el('div');
    wf.append(wfHost);
    cashWaterfall(wfHost, m);
    wf.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      'Completing and being safe are different amounts of money. The table below itemises every line in each group.'));
    free.append(wf);
  }

  /* A table rather than a sentence, because a sentence that lists four
     components and totals five is not a rounding problem — it is a number the
     reader cannot check. Each group subtotals and the groups sum to the total. */
  /* NO overflow-x HERE. This div was given one for its own cost-group table,
     and then grew into the container for everything below it — the financing
     block, the three cash tiles, the reserve rows. The financing block carries
     its own .tablewrap, so at 390px the reader met two horizontal scrollbars
     stacked on the same content: an outer with 166px of travel and an inner
     with 430px, and a swipe moved whichever one the finger happened to land
     on. Each table now scrolls in its own wrapper and this is a plain block. */
  const cash = el('div', { style: 'margin-top:var(--md)' });
  const cashT = el('table', { class: 'dt' });
  const cashB = el('tbody');
  m.costGroups.forEach(g => {
    const sub = g.items.reduce((s2, it) => s2 + (isNum(it[1]) ? it[1] : 0), 0);
    const gMissing = g.items.filter(it => !isNum(it[1])).length;
    cashB.append(el('tr', {}, [
      el('td', { style: 'font-weight:600', colspan: 2 }, g.label)]));
    /* An unpriced line is shown as unpriced. Omitting it would read as a cost
       that does not exist, and every one of these exists. */
    g.items.forEach(it => {
      const st = it[2]?.status;
      cashB.append(el('tr', {}, [
        el('td', { style: 'padding-left:var(--md)' }, [
          it[0],
          /* Marked at every appearance. A placeholder is plausible, which is
             precisely why it cannot be left to look like a checked figure. */
          st === 'placeholder' ? el('span', { class: 'chip chip-bronze', style: 'margin-left:6px;font-size:12px',
            title: it[2]?.line?.note || 'A commonly-quoted approximation, not a quotation and not read off the current schedule.' }, 'placeholder') : null,
          st === 'unverified' ? el('span', { class: 'chip', style: 'margin-left:6px;font-size:12px',
            title: 'A working figure nobody has checked against the cited source.' }, 'unverified') : null,
        ]),
        isNum(it[1])
          ? el('td', { class: 'num' }, fmtAmount(it[1], 'MYR'))
          : el('td', { class: 'num' }, el('span', { class: 'caption', style: 'color:var(--bronze)',
              title: it[2]?.why || 'No value has been entered for this line.' }, 'not set')),
      ]));
    });
    if (g.items.length > 1) cashB.append(el('tr', {}, [
      el('td', { class: 'metaline', style: 'padding-left:var(--md)' },
        `${g.label} subtotal${gMissing ? ` — ${gMissing} line${gMissing === 1 ? '' : 's'} unpriced` : ''}`),
      el('td', { class: 'num metaline' }, fmtAmount(sub, 'MYR'))]));
  });
  const nMissing = (m.missingCostLines || []).length;
  cashB.append(el('tr', { style: 'border-top:2px solid var(--line)' }, [
    el('td', { style: 'font-weight:700' },
      nMissing ? 'Total initial cash so far' : 'Total initial cash'),
    el('td', { class: 'num', style: 'font-weight:700' }, fmtAmount(m.totalInitialCash, 'MYR'))]));
  /* The total names its own incompleteness in the row beneath it, because a
     bold figure at the foot of a ledger is read as the answer. */
  if (nMissing) cashB.append(el('tr', {}, [
    el('td', { colspan: 2, class: 'metaline', style: 'color:var(--bronze);white-space:normal' },
      `This is not the full amount. ${nMissing} cost line${nMissing === 1 ? ' has' : 's have'} no value yet — ${m.missingCostLines.map(x => x.label.toLowerCase()).join(', ')} — so the real figure is higher by whatever those come to. They are unpriced rather than zero, and this tool will not guess them.`)]));
  /* The share of the total resting on unchecked figures, stated as a
     proportion. Individual markers tell a reader which lines; only this tells
     them how much of the answer is affected. */
  if (isNum(m.unconfirmedCost) && m.unconfirmedCost > 0 && isNum(m.totalInitialCash) && m.totalInitialCash > 0)
    cashB.append(el('tr', {}, [
      el('td', { colspan: 2, class: 'metaline', style: 'color:var(--bronze);white-space:normal' },
        `${fmtAmount(m.unconfirmedCost, 'MYR')} of this — ${fmtPct(m.unconfirmedCost / m.totalInitialCash * 100, 0)} — comes from fee lines nobody has checked against their source. `
        + (m.placeholderCostLines.length
            ? `${m.placeholderCostLines.length} ${m.placeholderCostLines.length === 1 ? 'is a placeholder' : 'are placeholders'}: approximations entered so the workflow runs, not quotations. Replace them with real quotes before this figure means anything.`
            : 'They compute, and they are not evidence.'))]));
  cashT.append(cashB);
  cash.append(el('div', { class: 'tablewrap' }, cashT));

  /* ---- financing basis (specification 29.2) ---------------------------- */
  const fin = el('div', { style: 'margin-top:var(--md);padding-top:var(--md);border-top:1px solid var(--line)' });
  fin.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'What the loan is calculated against'));
  if (!m.financingBasisConfirmed) {
    fin.append(el('p', { class: 'body', style: 'font-size:13px;color:var(--bronze)' },
      'Financing basis is modelled, not lender-confirmed. No bank or valuer estimate has been entered, so the loan below is calculated against the purchase price — which assumes a valuation at least equal to what you agreed to pay. Where a valuation comes in lower, the shortfall becomes cash you must find at completion, and this figure would understate what the purchase takes.'));
  } else {
    const kv = el('dl', { class: 'kv' });
    [['Purchase price', fmtAmount(d.price, 'MYR')],
     ['Bank or valuer estimate', fmtAmount(m.bankValuation, 'MYR')],
     ['Value the loan is calculated on', `${fmtAmount(m.lenderValueBasis, 'MYR')} — the lower of the two`],
     ['Margin of finance applied', fmtPct(m.marginOfFinancePct, 0)],
     ['Loan', fmtAmount(m.loan, 'MYR')],
     ['Share of the price this funds', fmtPct(m.financingCoverageOfPrice, 1)]]
      .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, v)); });
    fin.append(kv);
    if (m.valuationGapCash > 0) fin.append(el('p', { class: 'body', style: 'font-size:13px;margin-top:8px;color:var(--dn-text)' },
      `The valuation is ${fmtAmount(m.valuationGapCash, 'MYR')} below the price, so a ${fmtPct(m.marginOfFinancePct, 0)} margin of finance funds ${fmtPct(m.financingCoverageOfPrice, 1)} of what you are paying, not ${fmtPct(m.marginOfFinancePct, 0)}. That difference is cash, it is due on completion day, and it is listed above as valuation-gap cash.`));
    else fin.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The estimate is at or above the price, so there is no valuation gap on this scenario.'));
  }

  /* 70 / 80 / 90 scenarios. */
  const scT = el('table', { class: 'dt', style: 'margin-top:10px' });
  scT.append(el('thead', {}, el('tr', {}, ['Margin of finance', 'Loan', 'Cash equity needed', 'Monthly instalment', 'Share of price funded']
    .map((h, i) => el('th', { style: i === 0 ? 'text-align:left' : null }, h)))));
  const scB = el('tbody');
  m.financingScenarios.forEach(s => {
    const isCurrent = Math.abs(s.mof - m.marginOfFinancePct) < 1e-9;
    scB.append(el('tr', { style: isCurrent ? 'background:var(--surface-sunk)' : '' }, [
      el('td', { style: 'text-align:left' }, [`${s.mof}%`, isCurrent ? el('span', { class: 'chip', style: 'margin-left:6px;font-size:12px' }, 'entered') : null]),
      el('td', { class: 'num' }, fmtAmount(s.loan, 'MYR')),
      el('td', { class: 'num' }, fmtAmount(s.cashEquity, 'MYR')),
      el('td', { class: 'num' }, fmtAmount(s.instalment, 'MYR')),
      el('td', { class: 'num' }, fmtPct(s.coverageOfPrice, 1)),
    ]));
  });
  scT.append(scB);
  fin.append(el('div', { class: 'tablewrap' }, scT));
  fin.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'Scenarios, not offers. No lender has seen this property or this borrower, and the margin a lender will actually extend depends on its own valuation, its credit policy and the applicant. Cash equity is the purchase price less the loan, so it carries any valuation gap with it.'));
  cash.append(fin);
  /* The three figures, before the ledger's own total. One number answered three
     questions at once — what leaves the account at completion, what it takes to
     make the property earn, and what must still be there afterwards — and a
     buyer can meet the first and be ruined by the third. */
  const threeCash = el('div', { class: 'grid g-4', style: 'margin-top:var(--md)' });
  [...(m.cashAlreadyPaid > 0
        ? [['Cash already paid', m.cashAlreadyPaid, 'Booking deposit handed over at offer. Part of the down payment, not on top of it.']]
        : []),
   ['Cash still to complete', m.cashStillRequiredToComplete,
     m.cashAlreadyPaid > 0
       ? `Completion needs ${fmtAmount(m.transactionCash, 'MYR')} in total, less what you have already paid.`
       : 'Paid out at completion: deposit, any valuation gap, duties, legal fees and financing costs.'],
   ['Cash to make rent-ready', m.improvementCash, 'Spent after completion before the property can earn: renovation, furnishing and deposits.'],
   ['Cash to keep untouched', m.reserveCash, `${m.reserveMonths} months of instalment and owner-paid running costs. Not paid to anyone — it stays in your account.`],
   ['Safe cash required', m.safeCashRequired, 'Everything together, including what is already paid. This is the number that decides whether the purchase is survivable, not the deposit.']]
    .forEach(([label, amount, sub], i, arr) => threeCash.append(el('div', { class: 'panel' },
      statTile(label, fmtAmount(amount, 'MYR'), { sub, tone: i === arr.length - 1 ? '--brand' : null }))));
  cash.append(threeCash);

  /* Reserve policy, and what it costs at the two horizons the specification
     asks for. */
  const resRow = el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:end;margin-top:var(--md)' });
  const resField = el('div', { class: 'field', style: 'width:190px' });
  resField.append(el('label', { for: 'd-reserveMonths' }, 'Months of reserve to hold'));
  resField.append(el('input', { class: 'input input-inline', id: 'd-reserveMonths', type: 'number',
    min: '1', max: '24', step: '1', value: String(m.reserveMonths), style: 'text-align:right',
    onchange: e => { d.reserveMonths = num0(e.target.value); markTouched(d, 'reserveMonths'); saveDeal(); render(); } }));
  resRow.append(resField);
  resRow.append(el('p', { class: 'metaline', style: 'flex:1 1 300px' },
    `At the entered rent and costs, holding this property burns ${fmtAmount(m.burnWithRent, 'MYR')} a month with rent still coming in and ${fmtAmount(m.burnWithoutRent, 'MYR')} a month with none. `
    + m.reserveScenarios.map(s => `${s.months} months with no rent is ${fmtAmount(s.noRent, 'MYR')}`).join('; ') + '.'));
  cash.append(resRow);

  cash.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `The reserve is not paid to anyone — it is what stays in your account after completion. Completion and rent-ready together take ${fmtAmount(m.acquisitionCost, 'MYR')}; the reserve is on top of that.`));
  free.append(cash);
  out.append(free);

  /* ---------- Sarawak checklist ---------- */
  /* Questions, answered by the buyer, each naming who can actually settle it.
     The tool does not decide legal eligibility or flood exposure — it makes
     sure neither is skipped. */
  const chk = el('div', { class: 'card' });
  chk.append(cardHead('Before the numbers mean anything',
    'Ten questions that decide more than the price does. Nothing here is scored — answering "yes" to a risk simply raises it in the findings below, with who can confirm it.'));
  const answered = SARAWAK_CHECKS.filter(c => d.checks?.[c.id]).length;
  chk.append(el('div', { class: 'row', style: 'gap:8px;margin-bottom:var(--md)' }, [
    el('span', { class: answered === SARAWAK_CHECKS.length ? 'chip chip-ok' : 'chip chip-bronze' },
      `${answered} of ${SARAWAK_CHECKS.length} answered`),
    answered < SARAWAK_CHECKS.length
      ? el('span', { class: 'metaline' }, 'Unanswered questions are not neutral — they are unknowns carried into the result.') : null,
  ]));
  /* A city's own conditions decide what to ask first. Sibu sits on the Rejang
     and its flood history is the question a buyer there should reach before
     any other; Miri and Bintulu turn on single-industry employment. This
     changes the order of the questions and nothing else — no answer is
     pre-filled and no risk is assumed on the reader's behalf. */
  const CITY_PRIORITY = {
    sibu:    ['flood', 'comparables', 'resale-time'],
    miri:    ['single-employer', 'transient-demand', 'supply'],
    bintulu: ['single-employer', 'transient-demand', 'supply'],
    kuching: ['supply', 'parking', 'comparables'],
  };
  const priority = CITY_PRIORITY[d.city] || [];
  const ordered = [...SARAWAK_CHECKS].sort((a, b) => {
    const ia = priority.indexOf(a.id), ib = priority.indexOf(b.id);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  if (priority.length) chk.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' },
    `Ordered for ${cityDef.name}: ${priority.map(id => SARAWAK_CHECKS.find(c2 => c2.id === id)?.q.slice(0, -1)).filter(Boolean)[0]?.toLowerCase()} comes first here. The questions are the same everywhere; only the order changes.`));

  ordered.forEach(c => {
    const row = el('div', { style: 'padding:10px 0;border-top:1px solid var(--line)' });
    row.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:flex-start' }, [
      el('p', { style: 'flex:1 1 320px;font-size:13px;font-weight:500;margin:0' }, ptr(`chk.${c.id}`, c.q)),
      el('div', { class: 'segmented', style: 'flex:none' }, ['yes', 'no', 'unknown'].map(v =>
        el('button', { 'aria-selected': d.checks?.[c.id] === v ? 'true' : 'false',
          onclick: () => { d.checks = { ...(d.checks || {}), [c.id]: v }; saveDeal(); render(); } },
          v === 'yes' ? 'Yes' : v === 'no' ? 'No' : 'Not sure'))),
    ]));
    row.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, `${c.why} · Confirm with: ${c.who}`));
    /* What this tool actually holds on the question, stated next to the claim
       rather than left for the reader to infer. A risk described in general
       terms and a risk measured here are different things, and only one of them
       is evidence. */
    if (c.basis) row.append(el('p', { class: 'metaline', style: 'margin-top:4px;color:var(--bronze)' },
      `Evidence held: ${c.basis}`));

    /* How you know, recorded beside what you answered. */
    const ans = d.checks?.[c.id];
    if (ans) {
      const evRow = el('div', { class: 'row', style: 'gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap' });
      evRow.append(el('span', { class: 'metaline' }, 'How you established this:'));
      const evSel = el('select', { class: 'select select-sm', 'aria-label': `Evidence for: ${c.q}` });
      EVIDENCE.forEach(ev => evSel.append(el('option', { value: ev.id,
        selected: (d.checkEvidence?.[c.id] || 'assumed') === ev.id ? '' : null }, ptr(`ev.${ev.id}`, ev.label))));
      evSel.addEventListener('change', e => {
        d.checkEvidence = { ...(d.checkEvidence || {}), [c.id]: e.target.value }; saveDeal(); render();
      });
      evRow.append(evSel);
      if ((d.checkEvidence?.[c.id] || 'assumed') === 'assumed')
        evRow.append(el('span', { class: 'metaline', style: 'color:var(--bronze)' },
          'An assumed answer is not an answer.'));
      row.append(evRow);
    }

    /* What it bears on, and how to settle it. */
    if (c.affects?.length) row.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Bears on: ${c.affects.join(' · ')}. This tool changes no figure on the strength of your answer — it has no basis for a coefficient, and inventing one would be worse than leaving the number alone.`));
    if (c.steps?.length) {
      const det = el('details', { style: 'margin-top:8px' });
      det.append(el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'How to establish this'));
      det.append(el('ol', { class: 'ticklist', style: 'margin-top:6px' }, c.steps.map(x => el('li', {}, x))));
      row.append(det);
    }
    chk.append(row);
  });
  chk.append(el('p', { class: 'metaline', style: 'margin-top:var(--md);padding-top:10px;border-top:1px solid var(--line)' },
    'This tool does not determine legal eligibility, flood risk or market demand. Each question names the professional or authority who can.'));
  out.append(chk);

  /* ---------- stress tests ---------- */
  const stressCard = el('div', { class: 'card' });
  stressCard.append(cardHead('What breaks it',
    'The useful question is not what this returns but at what point it stops working. Each row moves one assumption and leaves the rest as entered.'));

  if (m.negativeAtBest) stressCard.append(el('p', { class: 'body', style: 'margin-bottom:var(--md);color:var(--dn-text)' },
    'This deal is cash-flow negative even at a 0% interest rate with the unit never empty. No interest rate or occupancy level makes it pay for itself — the shortfall is structural, in the price against the rent.'));

  const stressGrid = el('div', { class: 'grid g-3', style: 'margin-bottom:var(--md)' });
  /* The three cases are displayed as three different things, because they are:
     it crosses somewhere, it is never positive, or it is always positive. */
  const beTile = (label, value, why, entered, fmt, copy) => {
    const never = why === 'never-positive', always = why === 'always-positive';
    return el('div', { class: 'panel' }, statTile(label,
      isNum(value) ? fmt(value) : never ? copy.neverValue : copy.alwaysValue,
      { sub: isNum(value) ? copy.crosses(entered) : never ? copy.never : copy.always,
        tone: isNum(value) ? (copy.good(value, entered) ? '--ok-text' : '--dn-text')
            : never ? '--dn-text' : '--ok-text' }));
  };
  stressGrid.append(beTile('Breaks even at', m.breakEvenRate, m.breakEvenRateWhy, d.ratePct,
    v => fmtPct(v, 2), {
      neverValue: 'no rate', alwaysValue: 'any rate',
      crosses: e => `Interest rate at which monthly cash flow reaches zero. You entered ${fmtPct(e, 2)}.`,
      never: 'Negative at every rate down to 0%. The interest rate is not what makes this negative.',
      always: 'Stays positive at every rate tested, up to 25%.',
      good: (v, e) => v > e + 1,
    }));
  stressGrid.append(beTile('Survives vacancy to', m.breakEvenVacancy, m.breakEvenVacancyWhy, d.vacancyPct,
    v => fmtPct(v, 0), {
      neverValue: 'none', alwaysValue: 'fully vacant',
      crosses: e => `Vacancy at which it reaches zero. You assumed ${fmtPct(e, 0)}.`,
      never: 'Negative even with the unit never empty. Vacancy is not what makes this negative.',
      always: 'Covers its costs even with no tenant at all.',
      good: (v, e) => v > e + 10,
    }));
  stressGrid.append(el('div', { class: 'panel' }, statTile('Break-even rent', fmtAmount(m.breakEvenRent, 'MYR'),
    { sub: `Rent needed to cover everything. You expect ${fmtAmount(d.rent, 'MYR')}.`,
      tone: d.rent > m.breakEvenRent ? '--ok-text' : '--dn-text' })));
  stressCard.append(stressGrid);

  const stressTable = (caption, rows, cols) => {
    const t = el('table', { class: 'dt' });
    t.append(el('caption', { class: 'metaline', style: 'text-align:left;padding:6px 0' }, caption));
    t.append(el('thead', {}, el('tr', {}, cols.map(c2 => el('th', { class: c2.num ? 'num' : '' }, c2.label)))));
    const tb = el('tbody');
    rows.forEach(r2 => tb.append(el('tr', {}, cols.map(c2 => {
      const v = c2.get(r2);
      return el('td', { class: (c2.num ? 'num ' : '') + (c2.tone ? c2.tone(r2) : '') }, v);
    }))));
    t.append(tb);
    return el('div', { style: 'overflow-x:auto;margin-bottom:var(--md)' }, t);
  };

  stressCard.append(stressTable('If the interest rate rises', m.stress.rate, [
    { label: 'Rate', get: r2 => `${r2.label} · ${fmtPct(r2.ratePct, 2)}` },
    { label: 'Monthly cash flow', num: true, get: r2 => fmtAmount(r2.monthly, 'MYR'),
      tone: r2 => r2.monthly >= 0 ? 'pos' : 'neg' },
  ]));
  stressCard.append(stressTable('If it sits empty for longer', m.stress.vacancy, [
    { label: 'Vacancy', get: r2 => r2.label },
    { label: 'Monthly cash flow', num: true, get: r2 => fmtAmount(r2.monthly, 'MYR'),
      tone: r2 => r2.monthly >= 0 ? 'pos' : 'neg' },
  ]));
  stressCard.append(stressTable('If the renovation overruns', m.stress.renovation, [
    { label: 'Renovation', get: r2 => `${r2.label} · ${fmtAmount(r2.renovation, 'MYR')}` },
    { label: 'Cash required', num: true, get: r2 => fmtAmount(r2.cash, 'MYR') },
    { label: 'Cash-on-cash', num: true, get: r2 => isNum(r2.cashOnCash) ? fmtPct(r2.cashOnCash, 2) : '—',
      tone: r2 => isNum(r2.cashOnCash) && r2.cashOnCash >= 0 ? 'pos' : 'neg' },
  ]));
  out.append(stressCard);

  /* ---------- management operations ---------- */
  const ops = el('div', { class: 'card' });
  ops.append(cardHead(m.managed ? 'Management operations' : 'Management operations — self-managed',
    m.managed
      ? 'What the service costs, and what it has to do for it. A percentage alone is not comparable between two agents; cost per occupied month and cost per tenancy are.'
      : 'You have said you will manage this property yourself, so no management cost is charged below. The work does not disappear with the fee — it is listed here so it is a decision rather than an omission.'));

  if (m.managed) {
    ops.append(el('div', { class: 'grid g-4', style: 'margin-top:var(--md)' }, [
      el('div', { class: 'panel' }, statTile('Management cost a year', fmtAmount(m.mgmtTotalAnnual, 'MYR'),
        { sub: `${fmtPct(num0(d.mgmtPct), 1)} of collected rent plus placement` })),
      el('div', { class: 'panel' }, statTile('Cost per occupied month', fmtAmount(m.mgmtCostPerOccupiedMonth, 'MYR'),
        { sub: 'what it costs for each month the property is actually let' })),
      el('div', { class: 'panel' }, statTile('Cost per tenancy signed', isNum(m.mgmtCostPerTenancy)
        ? fmtAmount(m.mgmtCostPerTenancy, 'MYR') : '—', { sub: `over a ${m.monthsPerCycle}-month tenancy` })),
      el('div', { class: 'panel' }, statTile('Placement fee a year', fmtAmount(m.placementAnnual, 'MYR'),
        { sub: `assumes the tenant leaves each cycle` })),
    ]));
    if (m.renewalAnnual < m.placementAnnual) ops.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
      `The model charges the placement fee every cycle, which assumes the tenant leaves each time. If they renew instead the fee is `
      + `${fmtAmount(m.renewalAnnual, 'MYR')} a year rather than ${fmtAmount(m.placementAnnual, 'MYR')} — a difference of `
      + `${fmtAmount(m.placementAnnual - m.renewalAnnual, 'MYR')} a year. The conservative case is the one modelled.`));
    if (m.mgmtMinTopUp > 0) ops.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `The minimum fee bites: ${fmtPct(num0(d.mgmtPct), 1)} of this rent is less than the floor you entered, so `
      + `${fmtAmount(m.mgmtMinTopUp, 'MYR')} a year is owed regardless of what the property collects. That part does not fall with rent, and the break-even above treats it as fixed.`));
  }

  /* The placement target and the vacancy allowance describe the same thing.
     Shown side by side rather than reconciled silently — the model uses the
     vacancy figure, and if the two disagree that is the reader's to settle. */
  if (isNum(m.impliedVacancyPct)) {
    const gap = Math.abs(m.impliedVacancyPct - num0(d.vacancyPct));
    ops.append(el('div', { class: 'note', style: `margin-top:var(--md);border-left:3px solid var(${gap > 2 ? '--warn' : '--line'})` },
      el('p', { class: 'body', style: 'font-size:13px' },
        `Placing a tenant in ${num0(d.daysToFirstTenant)} days on a ${m.monthsPerCycle}-month tenancy implies `
        + `${fmtPct(m.impliedVacancyPct, 1)} vacancy. You have entered ${fmtPct(num0(d.vacancyPct), 1)}, and that is the figure every output above uses. `
        + (gap > 2
            ? `These differ by ${fmtPct(gap, 1)}. One of them is wrong for this property, and the placement target is usually the more optimistic of the two.`
            : `They agree closely enough that neither changes the answer much.`))));
  }

  /* The work itself. Named, because "management fee 5%" tells a first-time
     landlord nothing about what they are buying or what they still have to do. */
  const duties = el('details', { style: 'margin-top:var(--md)' });
  duties.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
    m.managed ? 'What the manager is agreeing to do' : 'What you are taking on by managing it yourself'));
  const dl = el('ul', { class: 'ticklist', style: 'margin-top:8px' });
  [`Verify achievable rent from signed tenancies rather than listing prices.`,
   `Market the unit, screen tenants, and prepare the tenancy documentation.`,
   `Collect rent and chase arrears from day ${num0(d.arrearsChaseDays)}.`,
   `Inspect ${num0(d.inspectionsPerYear)} time${num0(d.inspectionsPerYear) === 1 ? '' : 's'} a year and issue a written report with evidence.`,
   `Authorise repairs up to ${fmtAmount(num0(d.repairApprovalLimit), 'MYR')} without asking; anything above needs the owner.`,
   `Hold the ${num0(d.depositMonths)}-month deposit under agreed custody and handle the move-out inspection.`,
   `${d.tenantPaysUtilities ? 'Tenant' : 'Owner'} pays utilities — arrears here fall on whoever is named.`,
   `Provide an owner statement ${d.ownerReportCadence}, with receipts.`,
   `Keep an incident and maintenance history the next buyer's solicitor can read.`,
  ].forEach(x => dl.append(el('li', {}, x)));
  duties.append(dl);
  if (d.ownerReportCadence === 'not agreed') duties.append(el('p', { class: 'metaline', style: 'margin-top:8px;color:var(--bronze)' },
    'No reporting cadence has been agreed. Owner statements are the only routine evidence that the rest of this list is happening.'));
  ops.append(duties);
  out.append(ops);

  /* ---------- evidence quality ---------- */
  const ev = el('div', { class: 'card' });
  ev.append(cardHead('What this rests on',
    'A figure a seller quoted and a figure taken from a transacted comparable are not the same evidence.'));
  const evRows = [['price', 'Purchase price'], ['rent', 'Expected rent'], ['maintenance', 'Maintenance'], ['sqft', 'Built-up area']];
  /* shownEvidence, not d.evidence. Reading the stored label directly is what
     made this table contradict the selectors three inches above it: an
     untouched deal showed "Illustrative default" in every selector while this
     card reported the same four figures as "You supplied", "Estimated" and
     "Developer supplied". The stored labels were written as defaults before
     anyone typed anything, which is exactly the case shownEvidence exists to
     answer. This is the one card whose whole job is provenance, and it was the
     only surface on the page getting it wrong — in the reassuring direction. */
  const evShown = evRows.map(([k, label]) => ({ k, label, e: evidenceOf(shownEvidence(d, k)) }));
  const evT = el('table', { class: 'dt' });
  evT.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Figure'), el('th', {}, 'Source'), el('th', {}, 'What that means')])));
  const evB = el('tbody');
  evShown.forEach(({ label, e: e2 }) => {
    evB.append(el('tr', {}, [
      el('td', {}, label),
      el('td', {}, el('span', { class: e2.rank >= 4 ? 'chip chip-ok' : e2.rank >= 2 ? 'chip' : 'chip chip-bronze' }, e2.label)),
      el('td', { class: 'metaline' }, e2.note),
    ]));
  });
  evT.append(evB);
  ev.append(el('div', { style: 'overflow-x:auto' }, evT));
  /* Names the weakest row rather than asserting a floor. The previous sentence
     claimed "evidenced at least to a figure you supplied" — rank 3 — whenever
     the worst row cleared rank 1, so a table whose weakest entry was
     "Developer supplied" (rank 2, a seller's own quote) was described as the
     reader's own figure. A claim derived from the row it describes cannot
     drift away from it. */
  const weakest = evShown.reduce((a, x) => (x.e.rank < a.e.rank ? x : a), evShown[0]);
  ev.append(el('p', { class: 'metaline', style: 'margin-top:10px' },
    weakest.e.rank < 0
      ? `The weakest figure here is ${weakest.label.toLowerCase()} — ${weakest.e.label.toLowerCase()}, a number this tool carried in rather than one anyone chose for this property. Replace it before relying on any output.`
      : weakest.e.rank <= 1
        ? `The weakest figure here is ${weakest.label.toLowerCase()} — ${weakest.e.label.toLowerCase()}. A verified report is one where every row reads "verified transaction". That is the difference between the two, not extra pages.`
        : `The weakest figure here is ${weakest.label.toLowerCase()} — ${weakest.e.label.toLowerCase()}. Verified transactions are stronger still.`));
  out.append(ev);

  if (!paid) {
    /* The offer has to describe what this particular report would contain. On a
       location with no comparable held, promising "comparable transactions and
       the price and rental range for this project" would be selling a section
       that cannot be produced. */
    out.append(upsell(`Full investor report — RM${PROPERTY_REPORT_PRICE.full}`,
      m.proj.custom
        ? `Adds net operating income, cash-on-cash return, debt-service cover, a ten-year scenario, exit costs including real property gains tax, the equity comparison, and the risk flags — all computed from the figures you entered. It would contain no comparable transactions and no price or rental range, because none is held for ${m.proj.area}.`
        : 'Adds comparable transactions and the price and rental range for this project, net operating income, cash-on-cash return, debt-service cover, a ten-year scenario, exit costs including real property gains tax, the equity comparison, and the risk flags. Bought per report, or included twice monthly on All-Access.'));
    const buy = el('div', { class: 'row row-wrap', style: 'gap:8px' });
    buy.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => {
      State.propertyReportsBought = [...State.propertyReportsBought, d.projectId];
      store.write('propertyReportsBought', State.propertyReportsBought);
      toast('Report unlocked — no payment was taken, this is a prototype'); render();
    } }, `Unlock this report (prototype — no payment)`));
    buy.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('plans') }, 'See plans'));
    out.append(el('div', {}, buy));
    layout.append(out);
    wrap.append(layout);
    return wrap;
  }

  /* ---------- exits and the alternative ---------- */
  const exitCard = el('div', { class: 'card' });
  exitCard.append(cardHead('Selling in year 5 and year 10',
    'Exit costs modelled in full: agent commission, legal, real property gains tax, and the months the property is carried unlet while it sells.'));
  const exTable = el('table', { class: 'dt' });
  exTable.append(el('thead', {}, el('tr', {}, ['', 'Sell in year 5', 'Sell in year 10'].map((h, i) =>
    el('th', { class: i ? 'num' : '' }, h)))));
  const exBody = el('tbody');
  const exRows = [
    ['Sale value', e => fmtAmount(e.value, 'MYR')],
    ['Loan outstanding', e => `−${fmtAmount(e.outstanding, 'MYR')}`],
    ['Agent commission', e => `−${fmtAmount(e.agentFee, 'MYR')}`],
    ['Legal on exit', e => `−${fmtAmount(e.exitLegal, 'MYR')}`],
    [`Carried while selling`, e => `−${fmtAmount(e.carry, 'MYR')}`],
    ['Real property gains tax', e => `−${fmtAmount(e.rpgt, 'MYR')} (${e.rpgtPct}%)`],
    ['Net proceeds', e => fmtAmount(e.net, 'MYR')],
    ['Rental cash over the hold', e => fmtAmount(e.cumCash, 'MYR')],
    ['Total profit on cash invested', e => fmtAmount(e.profit, 'MYR')],
    ['Annualised', e => isNum(e.annualised) ? fmtPct(e.annualised, 2) : '—'],
  ];
  exRows.forEach(([label, get], i) => {
    const strong = i >= exRows.length - 2;
    exBody.append(el('tr', {}, [
      el('td', { style: strong ? 'font-weight:600' : '' }, label),
      ...m.exits.map(e => el('td', { class: 'num', style: strong ? 'font-weight:600' : '' }, get(e))),
    ]));
  });
  exTable.append(exBody);
  exitCard.append(el('div', { style: 'overflow-x:auto' }, exTable));

  exitCard.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    'Exit costs include the months the property is carried unlet while it sells — a real cost in a Sarawak secondary market, and one most calculators leave out.'));
  out.append(exitCard);

  /* ---------- paid report ---------- */
  const comps = el('div', { class: 'card' });
  if (m.proj.custom) {
    /* An empty comparables table with "RM null–null" beneath it would read as a
       market with no transactions rather than as a tool with no data. The card
       says which of the two it is. */
    comps.append(cardHead(`Comparable transactions — ${m.proj.area}`,
      'None held for this location.'));
    comps.append(el('p', { class: 'body', style: 'font-size:13px' },
      `Quantum Tradeworks holds no transacted price, rental band or vacancy observation for ${m.proj.area}. That is a gap in this tool, not evidence of a quiet market — the transactions exist, and none of them has been licensed into this build.`));
    comps.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      /* This said "Every figure above came from you" while the provenance table
         three cards up correctly reported all four critical figures as
         Illustrative default. On an untouched deal nothing came from the reader
         at all, and the sentence sits behind the paywall — so the one place it
         appears is the one place somebody has decided the report is worth
         paying for. It now reads what is actually true of whichever figures are
         in play. */
      `Every figure above is either one you entered or a default this tool carried in, and the source table above says which is which for each. `
      + (untouched.length
          ? `${untouched.length} of the four figures that drive this model ${untouched.length === 1 ? 'is' : 'are'} still an illustrative default. `
          : '')
      + 'Nothing on this page has been checked against a market, so treat the outputs as arithmetic on those inputs rather than as a valuation.'));
    comps.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Where a comparable can be obtained'));
    comps.append(el('ul', { class: 'ticklist' }, [
      el('li', {}, 'NAPIC (Valuation and Property Services Department) publishes transacted prices by district. Their Property Market Report is the standard reference.'),
      el('li', {}, 'A registered valuer can produce a formal comparable analysis for the specific address.'),
      el('li', {}, 'Local agents hold recent tenancies — ask for signed tenancies rather than asking rents, which are the figure most commonly quoted and least commonly achieved.'),
    ]));
  } else {
    comps.append(cardHead(`Comparable transactions — ${m.proj.name}`,
      `${m.proj.type}, ${m.proj.tenure}, ${m.proj.area}. Sample transaction data for demonstration.`));
    const ctw = el('div', { class: 'tablewrap' });
    const ct = el('table', { class: 'dt' });
    ct.append(el('thead', {}, el('tr', {}, ['Quarter', 'Median psf', 'Transactions', 'vs your price'].map(h => el('th', {}, h)))));
    ct.append(el('tbody', {}, m.proj.txns.map(([q, ppsf, n]) => el('tr', {}, [
      el('td', { class: 'ident' }, q), el('td', {}, `RM${ppsf}`), el('td', {}, String(n)),
      el('td', { class: signClass(m.psf ? ppsf - m.psf : 0) }, m.psf ? withSign((ppsf - m.psf) / m.psf * 100, 1) : '—'),
    ]))));
    ctw.append(ct); comps.append(ctw);
    const rng = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
    rng.append(el('div', { class: 'panel' }, statTile('Your price psf', m.psf ? `RM${m.psf.toFixed(0)}` : '—',
      { sub: `Project range RM${m.proj.psfLo}–${m.proj.psfHi}, median RM${m.proj.psfMid}` })));
    rng.append(el('div', { class: 'panel' }, statTile('Your rent', `RM${d.rent}`,
      { sub: `Observed range RM${m.proj.rentLo}–${m.proj.rentHi}, median RM${m.proj.rentMid}` })));
    rng.append(el('div', { class: 'panel' }, statTile('Area vacancy', fmtPct(m.proj.vacancyPct, 0),
      { sub: `You assumed ${fmtPct(d.vacancyPct, 0)}` })));
    comps.append(rng);
  }
  out.append(comps);

  const inv = el('div', { class: 'card' });
  inv.append(cardHead('Investment measures', 'Computed from your inputs. Every figure below traces to the assumptions on the left.'));
  const ig = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--md)' });
  ig.append(el('div', { class: 'panel' }, statTile('Net operating income', fmtAmount(m.noi, 'MYR'), { sub: 'Effective rent less operating costs, before the loan' })));
  ig.append(el('div', { class: 'panel' }, statTile('Net yield', fmtPct(m.netYield, 2), { sub: 'NOI ÷ purchase price' })));
  ig.append(el('div', { class: 'panel' }, statTile('Cash-on-cash', isNum(m.cashOnCash) ? fmtPct(m.cashOnCash, 2) : '—',
    { sub: 'Annual cash flow ÷ cash invested', tone: (m.cashOnCash ?? 0) >= 0 ? '--ok-text' : '--dn-text' })));
  ig.append(el('div', { class: 'panel' }, statTile('Debt-service cover', isNum(m.dscr) ? fmtX(m.dscr, 2) : '—',
    { sub: 'NOI ÷ annual instalments', tone: (m.dscr ?? 0) >= 1 ? '--ok-text' : '--dn-text' })));
  inv.append(ig);
  const kv = el('dl', { class: 'kv' });
  [['Gross annual rent', fmtAmount(m.grossAnnualRent, 'MYR')],
   [`Effective rent after ${fmtPct(d.vacancyPct, 0)} vacancy`, fmtAmount(m.effectiveRent, 'MYR')],
   ['Operating costs', fmtAmount(m.opex, 'MYR')],
   ['Annual debt service', fmtAmount(m.annualDebtService, 'MYR')],
   ['Cash invested at acquisition', fmtAmount(m.acquisitionCost, 'MYR')]]
   .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, v)); });
  inv.append(kv);
  out.append(inv);

  /* scenario path */
  const sc2 = el('div', { class: 'card' });
  sc2.append(cardHead(`${d.holdYears}-year scenario`,
    `Capital growth of ${fmtPct(d.apprecPct, 2)} and rent growth of ${fmtPct(d.rentGrowthPct, 2)} a year. A scenario, not a prediction — change either input and the whole path changes.`));
  const stw = el('div', { class: 'tablewrap' });
  const st = el('table', { class: 'dt' });
  st.append(el('thead', {}, el('tr', {}, ['Year', 'Effective rent', 'Operating costs', 'Debt service', 'Net cash flow', 'Cumulative', 'Property value', 'Loan balance'].map(h => el('th', {}, h)))));
  st.append(el('tbody', {}, m.path.map(p2 => el('tr', {}, [
    el('td', { class: 'ident' }, `Year ${p2.y}`),
    el('td', {}, fmtAmount(p2.rent, 'MYR')), el('td', {}, fmtAmount(p2.opex, 'MYR')),
    el('td', {}, fmtAmount(p2.debt, 'MYR')),
    el('td', { class: signClass(p2.cf) }, fmtAmount(p2.cf, 'MYR')),
    el('td', { class: signClass(p2.cum) }, fmtAmount(p2.cum, 'MYR')),
    el('td', {}, fmtAmount(p2.value, 'MYR')), el('td', {}, fmtAmount(p2.balance, 'MYR')),
  ]))));
  stw.append(st); sc2.append(stw);
  out.append(sc2);


  /* equity comparison — the cross-asset point of the whole product */
  const eq2 = el('div', { class: 'card' });
  eq2.append(cardHead('The same cash in equities',
    `What ${fmtAmount(m.acquisitionCost, 'MYR')} would have to compound at over ${d.holdYears} years to match this property scenario. This is the comparison a spreadsheet in one app and a portfolio in another never lets you make.`));
  /* The real rate, not the annualised multiple. Comparing a property against
     a compounding alternative on a figure that ignores timing was the least
     defensible place the old approximation appeared. */
  const need = isNum(m.irrPct) ? m.irrPct : null;
  const eg = el('div', { class: 'grid g-3', style: 'margin-bottom:var(--md)' });
  eg.append(el('div', { class: 'panel' }, statTile('Property, internal rate of return', isNum(need) ? fmtPct(need, 2) : '—',
    { sub: `Including leverage, costs and ${m.rpgtPct}% RPGT` })));
  eg.append(el('div', { class: 'panel' }, statTile('Cash committed', fmtAmount(m.acquisitionCost, 'MYR'), { sub: 'Deposit plus entry costs' })));
  eg.append(el('div', { class: 'panel' }, statTile('Monthly commitment', fmtAmount(Math.max(0, -m.cashflowMonthly), 'MYR'),
    { sub: m.cashflowMonthly >= 0 ? 'Property funds itself' : 'Funded from your income' })));
  eq2.append(eg);
  const dyRows = U.filter(x => x.c.mkt === 'MY' && x.m.dy > 3).sort((a, b) => b.m.dy - a.m.dy).slice(0, 5);
  const etw = el('div', { class: 'tablewrap' });
  const et = el('table', { class: 'dt' });
  et.append(el('thead', {}, el('tr', {}, ['Bursa alternative', 'Gross yield', 'Net yield after withholding', 'Quality', 'vs base-case model estimate'].map(h => el('th', {}, h)))));
  et.append(el('tbody', {}, dyRows.map(x => el('tr', {}, [
    el('td', { class: 'ident' }, `${x.c.tk} — ${x.c.name}`),
    el('td', {}, fmtPct(x.m.dy, 2)),
    el('td', {}, fmtPct(netYield(x.m.dy, x.c.mkt), 2)),
    el('td', { html: scorePill(x.scores.quality.score, x.pct.quality) }),
    el('td', { class: diffClass(x.val.mos?.base) }, withSign(x.val.mos?.base, 0)),
  ]))));
  etw.append(et); eq2.append(etw);
  eq2.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    `The property scenario shows a net yield of ${fmtPct(m.netYield, 2)} before leverage and ${isNum(need) ? fmtPct(need, 2) : '—'} annualised on cash after it. Equities are liquid, divisible and carry no maintenance; property is leveraged, lumpy and illiquid. The comparison is of returns, not of risk.`));
  out.append(eq2);

  /* risk flags */
  const rf = el('div', { class: 'card' });
  const flags = propertyRiskFlags(d, m);
  rf.append(cardHead(`Risk flags — ${flags.filter(f => f.sev !== 'good').length}`,
    'Computed from your assumptions against the sample project data. Each names the input that triggered it.'));
  const fl = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  flags.forEach(f => {
    const item = el('div', { class: 'panel' });
    item.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:4px' }, [sevChip(f.sev), el('span', { style: 'font-size:13px;font-weight:600' }, f.t)]));
    item.append(el('p', { class: 'body', style: 'font-size:13px' }, f.n));
    fl.append(item);
  });
  rf.append(fl);
  out.append(rf);

  layout.append(out);
  wrap.append(layout);
  return wrap;
};

