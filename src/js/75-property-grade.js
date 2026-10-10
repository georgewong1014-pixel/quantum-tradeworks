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

const blankBorrower = () => ({
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
});
State.borrower = store.read('borrowerProfile', null) || blankBorrower();
const saveBorrower = () => store.write('borrowerProfile', State.borrower);
/* ANOTHER TAB'S FINANCING DETAILS ARE KEPT, AND AN ERASE STAYS ERASED.
   The profile is saved whole and never travels in the address, so a tab
   opened earlier held the copy it read at boot: an income of 9,000 entered in
   a second tab was set back to 0 for good by the first tab's next edit, and
   "Erase my financing details" there was undone by the same edit here. It is
   read again when another tab writes it (PROPERTY_SHARED_KEYS, 70-property.js)
   — in place, because the fields on screen hold this object from when they
   were drawn, and a new one would take their next edit to a copy nobody
   saves. */
function rereadBorrower() {
  const fresh = store.read('borrowerProfile', null) || blankBorrower();
  Object.keys(State.borrower).forEach(k => { if (!Object.hasOwn(fresh, k)) delete State.borrower[k]; });
  Object.assign(State.borrower, fresh);
}

/* Specification 30.3. Every figure shows its own formula on screen, because a
   ratio a reader cannot reproduce is a number they have to trust. */
function borrowerAffordability(b, m) {
  const income = num0(b.verifiedNetMonthlyIncome);
  const existing = num0(b.existingMonthlyDebtPayments);
  const essentials = num0(b.essentialMonthlyCommitments);
  const instalment = isNum(m?.instalment) ? m.instalment : null;
  /* Three points above the entered rate, the top of the range 31.7 asks for. */
  /* No loan, no instalment to stress — nought at any rate, as the model's own
     instalment is, rather than unknown because the tenure box reads 0. */
  const stressedInstalment = !isNum(m?.loan) ? null
    : !(m.loan > 0) ? 0
    : m.tenureValid ? monthlyInstalment(m.loan, num0(m.inputRatePct) + 3, num0(m.tenureYears)) : null;

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

  /* Not against a requirement that is short. With a line unpriced — the
     reserve, whenever the instalment cannot be computed — the total is what
     is priced so far, and the buffer scored against it and said "required,
     including the reserve" when the reserve was the line missing. It is
     open until the requirement is whole, as the total below it already is. */
  const shortBy = m?.missingCostLines || [];
  if (shortBy.length) {
    scores.buffer = null;
    notes.buffer = `The cash requirement is incomplete — ${shortBy.length === 1 ? 'one line' : `${shortBy.length} lines`} could not be priced (${shortBy.map(x => x.label.toLowerCase()).join(', ')}) — so the buffer cannot be tested against it.`;
    unknowns.push('liquid buffer');
  } else if (isNum(m?.safeCashRequired) && m.safeCashRequired > 0) {
    const cash = num0(b.liquidCashAvailable);
    scores.buffer = Math.round(clamp(cash / m.safeCashRequired * 100, 0, 100));
    notes.buffer = cash >= m.safeCashRequired
      ? `${fmtAmount(cash, 'MYR')} available against ${fmtAmount(m.safeCashRequired, 'MYR')} required, including the reserve.`
      : `${fmtAmount(cash, 'MYR')} available against ${fmtAmount(m.safeCashRequired, 'MYR')} required — short by ${fmtAmount(m.safeCashRequired - cash, 'MYR')}, and borrowing that shortfall would change the affordability above.`;
  } else { scores.buffer = null; notes.buffer = 'The cash requirement could not be computed.'; unknowns.push('liquid buffer'); }

  const provided = BORROWER_DOCS.filter(x => b.docs?.[x.k] === 'verified' || b.docs?.[x.k] === 'provided').length;
  scores.documents = Math.round(provided / BORROWER_DOCS.length * 100);
  notes.documents = `${provided} of ${BORROWER_DOCS.length} documents gathered. A lender's own checklist overrides this one.`;

  /* NOT TESTED, BECAUSE NOTHING HERE ASKS. It scored 70 as soon as an income
     was entered, on a basis that said the applicant count and tenure fit were
     "recorded" — the page has no control for either (applicantCount is a
     hidden default of 1), and the 70 went into the total. Scored when there
     is something to score it on. Not an open item for the reader either: no
     answer they could give would settle it, so it is not listed with the
     ones a total waits for. */
  scores.structure = null;
  notes.structure = 'Not tested: this build has no input for the number of applicants or for how the loan tenure fits their ages, and joint-applicant evidence and declared source of funds are not modelled.';

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

  /* And withheld from the tile as well as the band. The tile printed "46/100
     · Not assessed" while the disclosure below it said a total is withheld
     while any of these is open. The partial figure is kept as rawScore, as
     propertyFinanceability keeps its own. */
  return { score: band === 'Not assessed' ? null : score, rawScore: score, band, scores, notes, unknowns, affordability: a,
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

  /* Credited only when the resale period has been established. Any answer
     at all — "No" and "Not sure" included — used to lift this from 55 to 75. */
  const resale = d.checks?.['resale-time'];
  scores.liquidity = m.proj?.custom ? 40 : (resale === 'yes' ? 75 : 55);
  notes.liquidity = m.proj?.custom
    ? 'No transacted evidence is held for this location, so the buyer pool and realistic sale period are unknown.'
    : 'Sample comparable transactions exist for this project.';

  /* "Not sure" is the reader saying the question is still open. */
  const answered = SARAWAK_CHECKS.filter(c => d.checks?.[c.id] && d.checks[c.id] !== 'unknown').length;
  scores.documents = Math.round(answered / SARAWAK_CHECKS.length * 100);
  notes.documents = `${answered} of ${SARAWAK_CHECKS.length} verification questions answered — "Not sure" counts as open.`;

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
  /* An unpriced reserve is not a missing one. With a loan tenure of 0 the
     reserve could not be priced, and this said "No safe reserve is held after
     completion" while the reader's months of reserve stood in the ledger. The
     gate and its cap are unchanged; the sentence says which it is. */
  if (m.reserveComputable === false)
    gates.push({ id:'no-reserve', severity:'serious',
      text:'The reserve cannot be priced: the loan’s instalment could not be computed from the entered tenure, so neither can the months of it the reserve has to cover. Until it is, nothing shows a vacancy or a major repair could be met without new borrowing.',
      caps:'B' });
  else if (!isNum(m.reserveCash) || m.reserveCash <= 0)
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

  const untouchedDrivers = evidenceDriversFor(d).filter(k => shownEvidence(d, k) === 'illustrative_default');
  if (untouchedDrivers.length)
    gates.push({ id:'illustrative', severity:'critical',
      text:`${untouchedDrivers.length} of the figures driving every output — ${untouchedDrivers.join(', ')} — are still this tool's starting numbers rather than yours.`,
      caps:'U' });

  /* An ACHIEVED rent comparable is an executed tenancy by definition, so it is
     exactly the evidence this gate asks for. A verified one in the same
     district and property type clears it whatever the dropdown says; an asking
     rent never does, however many are recorded. */
  /* Only where there is a rent to evidence. Telling the buyer of a bare parcel
     that "the rent is not supported by an executed tenancy" states a shortfall
     in evidence for a figure the model has just declined to compute. */
  const rentEvidence = evidenceOf(shownEvidence(d, 'rent'));
  if (m.letsToTenant !== false && rentEvidence.rank < 3 && !cmp.hasVerifiedRent)
    gates.push({ id:'unverified-rent', severity:'warning',
      text: cmp.rent.all
        ? `${cmp.rent.all} achieved-rent comparable${cmp.rent.all === 1 ? '' : 's'} recorded for this district and property type, but none is verified, so every return figure below is still assumption-driven.`
        : 'The rent is not supported by an executed tenancy or a transacted comparable, so every return figure below is assumption-driven.',
      caps:null, capsPillar:'evidence' });

  /* ---- pillars -------------------------------------------------------- */
  /* Each returns 0–100 or null. Null is not zero: a pillar that could not be
     tested is excluded from the weighted score and reduces coverage instead,
     so a company cannot lose points for evidence nobody has. */
  /* Scoped to the class, and the divisor is scoped with it — an inapplicable
     driver leaves the average rather than entering it as a zero. */
  const evDrivers = evidenceDriversFor(d);
  const evRanks = evDrivers.map(k => evidenceOf(shownEvidence(d, k)).rank);
  scores.evidence = evDrivers.length
    ? Math.round(evRanks.reduce((a, b) => a + Math.max(0, b), 0) / (evDrivers.length * 5) * 100)
    : null;
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

  /* A PILLAR THAT CANNOT APPLY IS NOT ONE WAITING FOR EVIDENCE.
     Debt-service cover and rental cash flow are both measured on rent, and a
     non-letting class has none — so on a financed parcel the two are null
     whatever is entered, 40% of the weight, and at most 60% can ever be
     scored against the 80% a grade needs. The grade was still reported as
     "Not enough evidence", and the page said the grade was withheld for want
     of coverage, as though more evidence could lift it. No evidence can.
     The model is unchanged — the pillars stay out of the score and the grade
     stays withheld — and the words now say why: the class, not the file.
     How such a class should be graded, if at all, is a decision for the
     framework, not for this sentence. */
  const noTenancy = m.letsToTenant === false;
  const classWord = String(PROPERTY_CLASSES[m.propertyClass]?.label || 'non-letting').toLowerCase();
  const inapplicable = [];

  if (isNum(m.dscr)) {
    /* 1.00x is the floor at which rent just covers the loan before tax and any
       major repair. 1.50x is comfortable. */
    scores.financing = Math.round(clamp((m.dscr - 0.9) / 0.6 * 100, 0, 100));
    notes.financing = `Debt-service cover ${fmtX(m.dscr, 2)}.`;
  } else if (m.loan === 0) {
    scores.financing = 100; notes.financing = 'Cash purchase — no financing risk.';
  } else if (noTenancy) {
    scores.financing = null; inapplicable.push('financing');
    notes.financing = `Does not apply: debt-service cover is rent over the instalment, and a ${classWord} class has no tenancy to pay rent.`;
  } else { scores.financing = null; notes.financing = 'Debt-service cover could not be computed.'; }

  if (isNum(m.netYield) && isNum(m.cashflowMonthly)) {
    const yieldPart = clamp(m.netYield / 5 * 60, 0, 60);
    const cashPart = m.cashflowMonthly >= 0 ? 40 : clamp(40 + m.cashflowMonthly / 40, 0, 40);
    scores.cashflow = Math.round(yieldPart + cashPart);
    notes.cashflow = m.annualOwnerSubsidy > 0
      ? `Net yield ${fmtPct(m.netYield, 2)}, and the property costs ${fmtAmount(m.annualOwnerSubsidy, 'MYR')} a year to hold.`
      : `Net yield ${fmtPct(m.netYield, 2)}, cash-flow positive.`;
  } else if (noTenancy) {
    scores.cashflow = null; inapplicable.push('cashflow');
    notes.cashflow = `Does not apply: a ${classWord} class earns no rent, so there is no yield to score. What it costs to hold is stated above, and the downside pillar tests it.`;
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
  /* No vacancy stress for a class with no tenancy — the stress card tests
     none, and the note named "the deepest vacancy tested" regardless. */
  const worstVac = noTenancy ? null : m.stress?.vacancy?.[m.stress.vacancy.length - 1]?.monthly;
  const worstCase = [worstRate, worstVac].filter(isNum);
  if (worstCase.length) {
    const worst = Math.min(...worstCase);
    scores.downside = Math.round(clamp(50 + worst / 30, 0, 100));
    notes.downside = `Worst modelled month is ${fmtAmount(worst, 'MYR')}, across the highest rate${isNum(worstVac) ? ' and the deepest vacancy' : ''} tested.`;
  } else { scores.downside = null; notes.downside = 'The downside cases could not be computed.'; }

  /* Demand and management readiness together, per directive 6.5. The management
     half is the operating plan, which arrives in a later release — so it is
     named as absent inside this pillar rather than carried as a separate weight
     nothing can earn. */
  /* By what the answers say, not by how many there are. It counted any answer,
     so "yes" to flood, single-employer demand and unsold supply scored 100 —
     the same as "no" to all of them. Each question now earns its share only
     when it is settled without an adverse finding; an adverse answer and an
     open one ("Not sure", or unanswered) both earn nothing. No weight is
     invented between the questions: each is one tenth. */
  const settled = SARAWAK_CHECKS.filter(c => { const a = d.checks?.[c.id]; return a && a !== 'unknown' && a !== c.adverse; }).length;
  const adverseN = SARAWAK_CHECKS.filter(c => c.adverse && d.checks?.[c.id] === c.adverse).length;
  const openN = SARAWAK_CHECKS.length - settled - adverseN;
  scores.demand = Math.round(settled / SARAWAK_CHECKS.length * 100);
  notes.demand = `${settled} of ${SARAWAK_CHECKS.length} checklist questions settled without an adverse finding; ${adverseN} adverse, ${openN} open or not sure. Management readiness is not yet modelled in this build and contributes nothing to this pillar either way.`;


  /* ---- weighted score over what was actually tested -------------------- */
  const tested = GRADE_PILLARS.filter(p => isNum(scores[p.k]));
  const testedWeight = tested.reduce((s, p) => s + p.weight, 0);
  const totalWeight = GRADE_PILLARS.reduce((s, p) => s + p.weight, 0);
  const coverage = testedWeight / totalWeight;
  const score = testedWeight > 0
    ? Math.round(tested.reduce((s, p) => s + scores[p.k] * p.weight, 0) / testedWeight)
    : null;
  /* The most that could ever be scored for this class, with every input
     evidenced. Below 80% no grade is reachable; below 90%, no A. */
  const inapplicableWeight = GRADE_PILLARS.filter(p => inapplicable.includes(p.k)).reduce((s, p) => s + p.weight, 0);
  const reachable = (totalWeight - inapplicableWeight) / totalWeight;
  const classUngradeable = reachable < 0.80;

  /* ---- grade ---------------------------------------------------------- */
  const capU = gates.some(g => g.caps === 'U');
  const capB = gates.some(g => g.caps === 'B');
  let grade, verdict;
  if (capU || coverage < 0.80 || score == null) {
    grade = 'U';
    verdict = classUngradeable ? 'Not gradeable for this class' : 'Not enough evidence';
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
           reachable, classUngradeable, inapplicable,
           pillars: GRADE_PILLARS.map(p => ({ ...p, score: scores[p.k], note: notes[p.k], applies: !inapplicable.includes(p.k) })) };
}

function dealModel(d) {
  /* The input, the address and the stored deal all normalise the hold; this
     covers every other caller — a register record, a probe, an old store. */
  if (d.holdYears !== normHoldYears(d.holdYears)) d = { ...d, holdYears: normHoldYears(d.holdYears) };
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
  const feeLine = (id, bases, opts) => { const r = resolveFee(id, bases, opts); return [r.label, r.amount, r]; };
  /* The fees service tax is charged on (the rulebook: the purchase and loan
     legal fees; the valuation fee, on its own line), resolved once so the
     tax and the fee cannot disagree. Null, not zero: coercing an unpriced
     legal fee to 0 made the tax on it resolve to a priced RM0 line — a
     real-looking row for a cost that exists and has not been calculated,
     absent from the missing-lines list because it had a number. A tax on
     an unknown fee is unknown, and no better than the fee it is on. */
  /* THE AUCTION ROUTE (the decision layer, P3): the reader's lawyer's quote
     for the legal and search costs, once entered, takes the place of the
     rulebook's purchase legal fees — an auction has no SPA — and is marked
     as theirs, as an MRTA quote is. Not entered, the rulebook's line stands. */
  const auctionRoute = dealRoute(d) === 'auction';
  const legalQuote = auctionRoute && isNum(d.auctionLegal) && d.auctionLegal >= 0 ? d.auctionLegal : null;
  const purchaseLegalR = legalQuote != null
    ? { id: 'auctionLegal', amount: legalQuote, provenance: 'quote', status: 'quote', quotedLine: true, label: 'Legal and search costs — your quote', line: FEE_TABLE.lines.purchaseLegal, why: null,
        note: 'Your lawyer’s quote for the auction purchase: the searches, the Proclamation’s review and the transfer. In place of the rulebook’s purchase legal fees, which price an SPA.' }
    : resolveFee('purchaseLegal', { price: d.price });
  const loanLegalR = resolveFee('loanLegal', { loan });
  /* What the auction passes to the buyer, as the reader entered it: each a
     line only once entered, so a deal answered Auction with nothing entered
     is the deal it was. */
  /* Of this class's arrears only: a bare parcel has no maintenance or
     sinking fund to be in arrears with (ROUTE_ASSET_GATES). */
  const auctionArrears = auctionRoute ? auctionArrearsFor(d).map(([k]) => d[k]).filter(isNum) : [];
  const auctionLines = !auctionRoute ? [] : [
    ...(auctionArrears.length && auctionArrears.some(v => v > 0) ? [['Arrears the Proclamation passes to you', auctionArrears.reduce((t, v) => t + v, 0)]] : []),
    ...(num0(d.auctionRepairs) > 0 ? [['Repairs', num0(d.auctionRepairs)]] : []),
    ...(num0(d.possessionCost) > 0 ? [['Possession cost', num0(d.possessionCost)]] : []),
  ];
  /* THE NEW-DEVELOPMENT ROUTE (the decision layer, P4): interest during
     construction — interest only, on what the loan has released, until
     vacant possession (ndConstruction, below) — is cash the buyer pays
     before any rent, and a line of the financing costs once the reader's
     schedule, its months and both dates are entered; never before, never
     at a schedule assumed. A rebate or incentive the developer gives, as
     the reader entered it, comes off the acquisition costs. Neither exists
     until entered, so a deal answered New development with nothing entered
     is the deal it was. */
  /* Not for land (ROUTE_ASSET_GATES): a bare parcel is not built in
     stages, so no construction interest enters its cash required. */
  const newDevRoute = dealRoute(d) === 'newdev' && propertyClassOf(d) !== 'land';
  const ndBuild = newDevRoute ? ndConstruction(d, loan) : null;
  const ndRebate = newDevRoute && isNum(d.ndRebates) && d.ndRebates > 0 ? d.ndRebates : 0;
  const valuationR = resolveFee('valuationFee', { price: d.price });
  const loanDutyR = resolveFee('loanStampDuty', { loan });
  /* Mortgage protection: quoted, included at the estimate, or out. */
  const mrtaQuoted = isNum(d.mrtaPremium) && d.mrtaPremium > 0;
  const mrtaIncluded = !mrtaQuoted && d.mortgageProtection === 'included';
  const optionalCostLines = mrtaQuoted || mrtaIncluded ? [] : [{ id: 'mortgageProtection', group: 'financing',
    label: FEE_TABLE.lines.mortgageProtection.optionalLabel, line: FEE_TABLE.lines.mortgageProtection,
    estimate: FEE_TABLE.lines.mortgageProtection.fixed, included: false,
    why: 'Optional, and left out of the cash required: include it, or enter the premium you were quoted on the financing panel.' }];
  const legalBase = isNum(purchaseLegalR.amount) && isNum(loanLegalR.amount) ? purchaseLegalR.amount + loanLegalR.amount : null;
  const asLine = (r) => [r.label, r.amount, r];
  const costGroups = [
    { id:'acquisition', label:'Acquisition costs', items:[
        ['Deposit', deposit],
        /* Only when it exists. A zero row for a gap there isn't would train the
           reader to skip the line that matters when there is one. */
        ...(valuationGapCash > 0 ? [['Valuation-gap cash', valuationGapCash]] : []),
        /* Arrears the sale passes to the buyer, as the reader's SPA or the
           management's statement says (the subsale evidence model, P2): their
           own figure, and only when entered — a deal without it is the deal it
           was, line for line. */
        ...(!auctionRoute && num0(d.chargesToBuyer) > 0 ? [['Outstanding charges passed to you', num0(d.chargesToBuyer)]] : []),
        /* On the auction route, the arrears its Proclamation passes to the
           buyer take that line's place (P3). */
        ...auctionLines,
        /* What the developer gives back (P4), as entered: off the cash. */
        ...(ndRebate > 0 ? [['Developer rebates and incentives', -ndRebate]] : []),
        feeLine('transferStampDuty', { price: d.price }),
        asLine(purchaseLegalR),
        /* The transfer, and the charge where there is a loan (fee rulebook
           1.1.0: verified, out of the disbursements estimate). */
        feeLine('registration', { instruments: loan > 0 ? 2 : 1 }),
        feeLine('disbursements', {}),
        feeLine('professionalServiceTax', { legalFees: legalBase }, { basedOn: [purchaseLegalR.provenance, loanLegalR.provenance] }),
      ] },
    { id:'financing', label:'Financing costs', items:[
        feeLine('loanStampDuty', { loan }),
        /* The charge, the collateral security: one-fifth of the loan
           agreement's duty, at most RM10 (Item 27(b)). */
        feeLine('chargeStampDuty', { loanDuty: loanDutyR.amount }),
        asLine(loanLegalR),
        asLine(valuationR),
        feeLine('valuationServiceTax', { valuationFee: isNum(valuationR.amount) ? valuationR.amount : null }, { basedOn: [valuationR.provenance] }),
        /* The reader's own quote, when there is one. The financing panel asked
           for the MRTA premium and used it to compare cover — and the ledger
           beside it went on charging the RM8,000 placeholder, so a reader who
           had typed RM4,200 from a real quote saw RM8,000 in their cash to
           complete. A quoted figure is not verified against any schedule, but
           it is not a placeholder either, and it is marked as what it is: a
           lender's or insurer's quotation (Quoted).
           OPTIONAL SINCE THE RULEBOOK'S 1.1.0 (the owner's decision of 9 Oct
           2026): with no quote it is in the cash required only when the
           reader includes it, at the rulebook's estimate; otherwise it is out,
           and listed as out (optionalCostLines) so its absence is seen. */
        ...(mrtaQuoted
          ? [['Mortgage protection — your quote', d.mrtaPremium,
             { status:'quote', provenance:'quote', quotedLine:true, id:'mortgageProtection', label:'Mortgage protection — your quote', line: FEE_TABLE.lines.mortgageProtection,
               why:null, note:'The one-off premium you entered on the financing panel. A lender’s or insurer’s quotation, not a figure from the fee rulebook.' }]]
          : mrtaIncluded ? [feeLine('mortgageProtection', {})] : []),
        /* Interest during construction (P4), once it can be worked out. */
        ...(ndBuild?.status === 'ok' && ndBuild.idc > 0 ? [['Interest during construction', ndBuild.idc]] : []),
      ] },
    { id:'improvement', label:'Initial improvement costs', items:[
        ['Renovation and furnishing', renovation],
        feeLine('utilityDeposits', {}),
      ] },
  ];

  /* Which lines exist but cannot yet be priced. Carried on the model so every
     total that depends on them can say it is incomplete rather than presenting
     a short number as though it were the answer. */
  /* The group's id travels with each line, so a total can ask whether a
     missing line is one of its own without matching on label text. */
  const missingCostLines = costGroups.flatMap(g =>
    g.items.filter(it => !isNum(it[1])).map(it => ({ group: g.label, groupId: g.id, label: it[0], why: it[2]?.why })));

  /* How much of the completion cash rests on a figure nobody has checked. A
     placeholder total looks exactly like a finished one, so the proportion has
     to be computed and stated rather than left for the reader to work out from
     a scatter of markers. */
  /* A figure the reader took from their own quotation is theirs to stand
     behind; it is not one "nobody has checked". */
  /* By the fee rulebook's provenance (70-property.js): a line is checked
     when it is Verified — its rule, and every fee it is charged on — or the
     reader's own quotation. An Estimated line, and one resting on a rule
     Unknown for its jurisdiction, are not; each is listed, so the
     total can say which lines and how much (unconfirmedLines). */
  const unconfirmedLines = costGroups.flatMap(g => g.items)
    .filter(it => it[2]?.provenance && it[2].provenance !== 'verified' && it[2].provenance !== 'quote' && isNum(it[1]))
    .map(it => ({ id: it[2].id || null, label: it[0], amount: it[1], provenance: it[2].provenance, jurisdiction: it[2].line?.jurisdiction || null }));
  const unconfirmedCost = unconfirmedLines.reduce((t, x) => t + x.amount, 0);
  const placeholderCostLines = unconfirmedLines.map(x => ({ label: x.label, amount: x.amount, provenance: x.provenance }));

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
  /* With no loan there is no schedule to need: the instalment is nought
     whatever the tenure box says. A cash purchase with a tenure of 0 was given
     a null instalment, so its reserve could not be computed and "Emergency
     reserve" was listed as a missing cost line on a purchase with nothing to
     service — and the page warned that the instalment, the reserve and the
     closing balance were unavailable. Only a loan makes the tenure matter. */
  const instalment = !(loan > 0) ? 0
    : tenureValid ? monthlyInstalment(loan, d.ratePct, d.tenureYears) : null;
  /* A cleared rate box reads as 0 through num0, and 0% is a legitimate entry —
     so the two cannot be told apart from the value alone, and a zero rate cuts
     the instalment by roughly half. Flagged rather than guessed at — where
     there is a loan for the rate to be charged on. */
  const zeroRateModelled = num0(d.ratePct) === 0 && loan > 0;
  /* WHICH QUANTITIES THIS ASSET ACTUALLY HAS.
     ------------------------------------------------------------------------
     The class was asked for, displayed and then discarded: this model never
     read it, so a bare parcel was given a rental yield, a debt-service cover
     and a break-even rent. Those are not small figures to invent — cover and
     break-even are hard gates on the grade.

     TWO VARIABLES PER QUANTITY, AND THE REASON IS THE CASH-FLOW VECTOR.
     The reported figure is null where the class cannot carry it, because null
     is the only honest answer and this file already treats null that way —
     breakEvenOccupancy, landPsf and dscr all null out rather than return a
     number. But the ARITHMETIC keeps a finite number, because path[] feeds
     flows[] and irrOf() rejects a vector containing a non-number: pushing a
     null through here would blank the entire return panel and report it as
     "a period is missing a cash flow", which would be false. A parcel's cash
     flow is not missing. It is negative, and that is the answer. */
  const propertyClass = propertyClassOf(d);
  const propertyClassSrc = propertyClassSource(d);
  const letsToTenant = PROPERTY_CLASSES[propertyClass].letsToTenant;
  const strataCharges = PROPERTY_CLASSES[propertyClass].strataCharges;

  const grossAnnualRentN = letsToTenant ? num0(d.rent) * 12 : 0;
  const effectiveRentN = grossAnnualRentN * (1 - num0(d.vacancyPct) / 100);
  const grossAnnualRent = letsToTenant ? grossAnnualRentN : null;
  const effectiveRent = letsToTenant ? effectiveRentN : null;
  /* Running costs, separated so each is visible and editable rather than
     folded into one figure the reader has to take on trust. A repair reserve
     is charged against rent because the repairs happen whether or not anyone
     budgeted for them. */
  /* A service charge and a sinking fund are strata obligations. A bare parcel
     has neither — not "zero of them", none — so they leave the total rather
     than entering it as a confident nought. Assessment, land rent and
     insurance stay: those a parcel does carry. */
  const maintenanceY = strataCharges ? num0(d.maintenance) * 12 : 0;
  const sinkingY = strataCharges ? num0(d.sinkingFund) * 12 : 0;
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
  /* No tenant, no letting agent. Management, placement and renewal all price a
     tenancy that a non-letting class does not have. */
  const managed = letsToTenant && !d.selfManaged;
  const monthsPerCycle = Math.max(1, num0(d.tenancyMonths));
  const cyclesPerYear = 12 / monthsPerCycle;
  const mgmtY = managed ? effectiveRentN * num0(d.mgmtPct) / 100 : 0;
  const mgmtMinAnnual = managed ? num0(d.mgmtMinMonthly) * 12 : 0;
  const mgmtMinTopUp = Math.max(0, mgmtMinAnnual - mgmtY);
  const placementAnnual = managed ? num0(d.leasingFeeMonths) * num0(d.rent) * cyclesPerYear : 0;
  const renewalAnnual = managed ? num0(d.renewalFeeMonths) * num0(d.rent) * cyclesPerYear : 0;
  const mgmtFixedAnnual = mgmtMinTopUp + placementAnnual;
  const repairY = letsToTenant ? effectiveRentN * num0(d.repairReservePct) / 100 : 0;
  /* THE SAME OUTGOINGS AT ANY RENT, SO THE STRESS TESTS AGREE WITH THE MODEL.
     The stress helper further down used to carry its own copy of this sum, and
     the copy drifted: it charged the management percentage to a self-managed
     owner and left out the minimum fee and placement fee entirely. So the
     "what breaks it" rows and the solved break-even rate and vacancy disagreed
     with cashflowMonthly on the same screen whenever an agent was involved —
     two implementations of one quantity, which this repository has caught in
     itself before. There is now one composition, evaluated at whatever
     effective rent the caller supplies. The association of the terms is kept
     identical to the former inline sum so `opex` is bit-for-bit what it was. */
  const opexAt = (eff) => {
    const mv = managed ? eff * num0(d.mgmtPct) / 100 : 0;
    const topUp = Math.max(0, mgmtMinAnnual - mv);
    const rep = letsToTenant ? eff * num0(d.repairReservePct) / 100 : 0;
    return maintenanceY + sinkingY + statutoryY + insuranceY + mv + (topUp + placementAnnual) + rep;
  };
  const opex = opexAt(effectiveRentN);
  const noiN = effectiveRentN - opex;
  const noi = letsToTenant ? noiN : null;
  /* A loan whose instalment cannot be computed (a tenure of zero, or a
     cleared box) has no debt service to subtract — which is not the same as
     none. Multiplying null gave 0, and the model reported the purchase as if
     the loan were never serviced and never repaid: a 26.6% rate of return on
     the default deal. With no loan there is genuinely nothing to service. */
  const debtUnknown = loan > 0 && !isNum(instalment);
  const annualDebtService = debtUnknown ? null : num0(instalment) * 12;
  /* THE LOAN ENDS WHEN ITS TENURE DOES. A hold longer than the tenure used to
     go on paying the full instalment every year after the last one — with a
     five-year loan and a ten-year hold, years six to ten each paid RM114,608
     against a balance of nought, and booked all of it as deductible interest.
     These give the months of instalment actually owed in a year of the hold,
     and in the months after it while the property sells. */
  const tenureMonths = tenureValid ? num0(d.tenureYears) * 12 : 0;
  const debtInYear = (y) => debtUnknown ? null
    : num0(instalment) * clamp(tenureMonths - (y - 1) * 12, 0, 12);
  const instalmentWhileSelling = (yrs, months) => debtUnknown ? null
    : num0(instalment) * clamp(tenureMonths - yrs * 12, 0, months);
  /* The balance owed after a number of months: unknown with the debt service,
     nothing without a loan. */
  const balanceAt = (months) => debtUnknown ? null
    : loan > 0 ? balanceAfter(loan, d.ratePct, d.tenureYears, months) : 0;

  const grossYield = (letsToTenant && d.price > 0) ? grossAnnualRentN / d.price * 100 : null;
  const netYield = (letsToTenant && d.price > 0) ? noiN / d.price * 100 : null;
  /* Cash flow survives every class, and for a parcel it is the whole question:
     what does holding this cost me each month while it appreciates. */
  const cashflowMonthly = debtUnknown ? null : (noiN / 12) - num0(instalment);
  const cashOnCash = (letsToTenant && acquisitionCost > 0 && !debtUnknown)
    ? (noiN - annualDebtService) / acquisitionCost * 100 : null;
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
  /* No break-even while the debt service is unknown: adding a null loan
     payment added nothing, and the page quoted the rent that covers the
     running costs alone as the rent that covers "everything". */
  const breakEvenRent = (letsToTenant && beDenominator > 0 && !debtUnknown)
    ? (fixedOperatingCosts + annualDebtService) / beDenominator
    : null;

  /* Occupancy at which the property covers its fixed costs and the loan, per
     31.5. Above 100% means it cannot break even at the entered rent however
     full it is — which is a different and more serious statement than a thin
     margin, and one of the grade's hard gates. */
  const beOccDenominator = letsToTenant ? grossAnnualRentN * (1 - variableCostRate) : 0;
  const breakEvenOccupancy = (beOccDenominator > 0 && !debtUnknown)
    ? (fixedOperatingCosts + annualDebtService) / beOccDenominator * 100
    : null;
  /* What the owner pays each year to hold a property that does not pay for
     itself. Shown rather than buried in a negative cash-flow figure, because
     "minus RM1,200 a month" and "RM14,400 a year out of your pocket, RM72,000
     over five" land differently and the second is the commitment. */
  /* For a non-letting class there is no income to offset, so the subsidy is the
     whole of the debt service and the outgoings — which is the correct and
     considerably larger answer. */
  const annualOwnerSubsidy = isNum(noiN) && isNum(annualDebtService) && (noiN - annualDebtService) < 0
    ? annualDebtService - noiN : 0;
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
  /* The property's value in year y: the price appreciating, plus whatever
     share of the renovation spend a buyer will pay for. The model used to
     drop the renovation at the sale entirely — a RM25,000 refit added nothing
     to the exit and was deducted in full from the gain — which is one
     assumption (nothing recovered) presented as none. It is an input now,
     defaulting to the old behaviour. */
  const renoRecovered = num0(d.renovation) * num0(d.renoValueRecoveryPct) / 100;
  const exitValueAt = (y) => d.price * Math.pow(1 + d.apprecPct / 100, y) + renoRecovered;
  const exitValue = exitValueAt(d.holdYears);
  const outstanding = balanceAt(d.holdYears * 12);
  const agentFee = exitValue * num0(d.agentPct) / 100;
  const exitLegal = Math.max(500, exitValue * num0(d.exitLegalPct) / 100);
  const sellMonths = num0(d.sellMonths);
  const carryWhileSelling = debtUnknown ? null
    : instalmentWhileSelling(d.holdYears, sellMonths) + sellMonths * (opex / 12);
  /* Renovation that is still reflected in the property at disposal is an
     allowable enhancement cost. Leaving it out overstated the gain by whatever
     was spent improving the asset. */
  const rpgtResult = rpgtCharge({
    disposalPrice: exitValue, acquisitionPrice: d.price,
    acquisitionCosts: duty + legal, disposalCosts: agentFee + exitLegal,
    enhancementCosts: num0(d.renovation),
    holdYears: d.holdYears, categoryId: d.disposerCategory,
  });
  const gain = rpgtResult.chargeableGain;
  const rpgt = rpgtResult.tax;
  /* Without a repayment schedule the balance at the sale is unknown, and so
     is what the sale returns. It was the price less costs, as if the loan had
     vanished. */
  const netExitProceeds = debtUnknown ? null
    : exitValue - outstanding - agentFee - exitLegal - rpgt - carryWhileSelling;

  /* Cumulative rental cash flow across the hold, with rent growth, now after
     tax on the rent. */
  /* ONE YEAR'S CASH, COMPUTED IN ONE PLACE.
     The five- and ten-year exit table further down used to total the rent with
     its own loop, and that loop was written before tax on the rent existed —
     so once a marginal rate was entered, the year-by-year path was after tax
     and the exit table's "rental cash over the hold" was still before it, on
     the same page, under the same heading. A year's flow is now one function
     and both surfaces call it. */
  const yearFlow = (y) => {
    const rentY = grossAnnualRentN * Math.pow(1 + d.rentGrowthPct / 100, y - 1);
    const effY = rentY * (1 - num0(d.vacancyPct) / 100);
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

    const debtY = debtInYear(y);
    const cfPreTax = debtUnknown ? null : effY - opexY - debtY;
    const cf = debtUnknown ? null : cfPreTax - taxY.tax;
    /* VALUE LESS LOAN, the row's own two figures set against each other —
       what the property would be worth in year y less what is still owed on
       it, before any cost of selling. Not "equity": that word already means
       the equities comparison (m.equity) and the cash committed (equityOut)
       on these pages. Unknown with the balance (a loan with no schedule). */
    const value = exitValueAt(y), balance = balanceAt(y * 12);
    return { y, rent: effY, opex: opexY, debt: debtY,
             interest: interestY, principal: debtUnknown ? null : Math.max(0, debtY - interestY),
             taxable: taxY.taxable, tax: taxY.tax, taxComputed: taxY.computed,
             cfPreTax, cf,
             value, balance,
             valueLessLoan: isNum(balance) ? value - balance : null };
  };
  let cumCash = 0, cumTax = 0, cumPreTax = 0;
  const path = [];
  for (let y = 1; y <= d.holdYears; y++) {
    const f = yearFlow(y);
    cumPreTax += f.cfPreTax; cumCash += f.cf; cumTax += f.tax;
    path.push({ ...f, cum: debtUnknown ? null : cumCash });
  }
  /* A sum of unknown years is unknown, not the nought `0 + null` makes it.
     The tax too: with the interest unknown every year's tax is null, and
     the running sum left RM0 behind — which the decision record printed as
     "after tax on the rent at 24%, totalling RM0 across the hold". */
  if (debtUnknown) { cumCash = null; cumPreTax = null; }
  if (!path.every(p => isNum(p.tax))) cumTax = null;
  const taxComputed = isNum(d.marginalTaxPct) && d.marginalTaxPct > 0;
  const totalProfit = debtUnknown ? null : cumCash + netExitProceeds - acquisitionCost;
  const multiple = (acquisitionCost > 0 && !debtUnknown) ? (cumCash + netExitProceeds) / acquisitionCost : null;

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
    /* With no repayment schedule the instalment came back as Infinity, every
       stressed month read −Infinity and the deal was declared structurally
       negative. Unknown is reported as unknown. */
    if (debtUnknown) return null;
    const inst = loan > 0 ? monthlyInstalment(loan, ratePct, d.tenureYears) : 0;
    const eff = grossAnnualRentN * (1 - vacancyPct / 100);
    return ((eff - opexAt(eff)) / 12) - inst;
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
               cashOnCash: (letsToTenant && !debtUnknown && isNum(cash) && cash > 0)
                 ? (noiN - annualDebtService) / cash * 100 : null };
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
    if (!isNum(fn(lo)) || !isNum(fn(hi))) return { value: null, reason: 'unknown' };
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
  const bestMonth = monthlyAt({ ratePct: 0, vacancyPct: 0 });
  const negativeAtBest = isNum(bestMonth) && bestMonth <= 0;

  /* ---- five and ten year exits ----------------------------------------- */
  const exitAt = (yrs) => {
    const val = exitValueAt(yrs);
    const bal = balanceAt(yrs * 12);
    const agent = val * num0(d.agentPct) / 100;
    const lg = Math.max(500, val * num0(d.exitLegalPct) / 100);
    const carry = debtUnknown ? null : instalmentWhileSelling(yrs, sellMonths) + sellMonths * (opex / 12);
    const rc = rpgtCharge({
      disposalPrice: val, acquisitionPrice: d.price,
      acquisitionCosts: duty + legal, disposalCosts: agent + lg,
      enhancementCosts: num0(d.renovation),
      holdYears: yrs, categoryId: d.disposerCategory,
    });
    const tax = rc.tax;
    const net = debtUnknown ? null : val - bal - agent - lg - tax - carry;
    /* After tax on the rent, the same as the year-by-year path — see yearFlow. */
    let cum = 0, cumPre = 0;
    for (let y = 1; y <= yrs; y++) { const f = yearFlow(y); cum += f.cf; cumPre += f.cfPreTax; }
    if (debtUnknown) { cum = null; cumPre = null; }
    const profit = debtUnknown ? null : cum + net - acquisitionCost;
    const mult = (acquisitionCost > 0 && !debtUnknown) ? (cum + net) / acquisitionCost : null;
    return { yrs, value: val, outstanding: bal, agentFee: agent, exitLegal: lg, carry,
             rpgtPct: rc.rate, rpgtRelief: rc.relief, rpgt: tax, sellingCosts: debtUnknown ? null : agent + lg + tax + carry,
             net, cumCash: cum, cumCashPreTax: cumPre, profit,
             annualised: isNum(mult) && mult > 0 ? (Math.pow(mult, 1 / yrs) - 1) * 100 : null };
  };
  const exits = [5, 10].map(exitAt);

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
  /* NOT WITHOUT THE INSTALMENT. With a loan tenure of 0 the instalment is
     null, and null added as nought: a RM514,800 loan contributed nothing, and
     the paragraph beside the reserve said the property "burns RM0 a month
     with rent still coming in … 6 months with no rent is RM2.5k" under a tile
     saying the reserve could not be priced. Unknown, as the reserve is. */
  const burnable = isNum(instalment) && isNum(opex);
  const ownerFixedMonthly = burnable ? instalment + (opex - mgmtY - repairY) / 12 : null;
  const stressedRentMonthly = effectiveRentN / 12;
  const burnWithRent = burnable ? Math.max(0, ownerFixedMonthly + rentLinkedMonthly - stressedRentMonthly) : null;
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
    noRent: burnable ? Math.round(mo * burnWithoutRent) : null,
    stressedRent: burnable ? Math.round(mo * burnWithRent) : null }));

  costGroups.push({ id:'reserve', label:'Emergency reserve', items:[
    [`${reserveMonths} month${reserveMonths === 1 ? '' : 's'} of instalment and owner-paid running costs`, reserve,
     reserveComputable ? null : { status:'unset', why:'The instalment or the running costs could not be computed, so the reserve cannot be either.' }]] });
  /* Recomputed after the reserve is pushed, so an unpriced reserve is reported
     as a missing line rather than quietly leaving the total short. */
  if (!reserveComputable) missingCostLines.push({ group:'Emergency reserve', groupId:'reserve',
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
  /* A reserve that cannot be priced is unknown, not nought. The group's only
     line is null then, and summing the priced lines of a group with none
     priced gave 0 — so with a loan tenure of 0 the ledger read "Cash to keep
     untouched RM0 — 3 months of instalment and owner-paid running costs", and
     the grade's gate said no reserve was held at all, beside the reader's own
     three months. The safe-cash total still adds what is priced and names
     the reserve among its missing lines, as it always did. */
  const reserveCash = reserveComputable ? groupTotal('reserve') : null;
  const safeCashRequired = transactionCash + improvementCash + num0(reserveCash);

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
    /* A missing year stays missing: null + 0 is 0 in JavaScript, which turned
       an unknown cash flow into a known nought and gave the IRR a number. */
    flows.push(isNum(p.cf) ? p.cf + (last ? netExitProceeds + num0(reserveCash) : 0) : null);
  });
  const irrResult = irrOf(flows);
  const irrPct = irrResult.rate;

  /* HOLD OR SELL, YEAR BY YEAR. The same flows the rate of return above is
     built from, cut at every possible exit: the equity out, each year's
     after-tax cash, and in the final year the net proceeds of a sale then
     plus the reserve coming back. exitAt already prices a sale in any year;
     this gives each one its rate. Selling in the final year of the hold IS
     the model's own case, so the last row must equal irrPct — a definition
     the test suite holds it to. Bounded at thirty years: past that the
     figures describe a different owner. */
  /* The reason travels with the rate. The exits card printed "the capital
     does not come back" for every missing rate, beside a positive profit on
     the same sale when the real reason was a second sign change. */
  const exitIrr = (e) => {
    const cfs = Array.from({ length: e.yrs }, (_, y) => yearFlow(y + 1).cf);
    if (!cfs.every(isNum) || !isNum(e.net)) return { rate: null, why: 'The loan’s instalment could not be computed, so neither can the cash flows.' };
    const fl = [-equityOut, ...cfs];
    fl[fl.length - 1] += e.net + num0(reserveCash);
    return irrOf(fl);
  };
  /* One row per year of the hold, which normHoldYears keeps to thirty — so
     the final row is always the model's own case. */
  const holdVsSell = Array.from({ length: path.length }, (_, k) => {
    const e = exitAt(k + 1);
    const r = exitIrr(e);
    return { ...e, irrPct: r.rate, irrWhy: r.why };
  });
  exits.forEach(e => { const r = exitIrr(e); e.irrPct = r.rate; e.irrWhy = r.why; });

  /* ---- the same cash, in equities -------------------------------------- */
  /* Not a recommendation and not a forecast — the point is that the deposit
     has an alternative use, and a property model that never mentions it is
     answering an easier question than the one being asked.

     On the equity the rate of return is measured on — every ringgit committed
     at the start, the reserve included — so the comparison and the rate beside
     it describe the same capital. It grew the cash before the reserve, while
     the card printed the rate on the cash after it. The property's profit is
     the same on either base: the reserve goes in and comes back out. */
  const equity = exits.map(e => {
    const grown = equityOut * Math.pow(1 + num0(d.equityReturnPct) / 100, e.yrs);
    const profit = grown - equityOut;
    return { yrs: e.yrs, committed: equityOut, value: grown, profit, propertyProfit: e.profit,
             annualised: num0(d.equityReturnPct), vsProperty: isNum(e.profit) ? e.profit - profit : null };
  });
  /* NPV at the return the reader says their capital could earn elsewhere —
     already collected for the opportunity-cost comparison and never used for
     this. Positive means the deal beats that alternative after tax. */
  const hurdlePct = num0(d.equityReturnPct);
  const npvAtHurdle = hurdlePct > 0 ? npvAt(hurdlePct / 100, flows) : null;

  /* THE LEDGER BY KIND (the fee rulebook 1.1.0; the owner's decision of 9
     Oct 2026): every priced line of the cash required in one of the five
     kinds (FEE_TABLE.categories) — or, for a line the rulebook does not
     price (the deposit, the renovation, the reserve, what the reader
     entered from a Proclamation or an SPA), the buyer's own money and
     figures. The kinds and 'own' sum to the cash required, line for line
     (model-test holds them to it); the optional lines left out are listed
     with no amount. */
  const ledgerSplit = (() => {
    const kinds = Object.keys(FEE_TABLE.categories);
    const by = Object.fromEntries([...kinds, 'own'].map(k => [k, { total: 0, lines: [] }]));
    for (const g of costGroups) for (const it of g.items) {
      if (!isNum(it[1])) continue;
      const k = it[2]?.provenance ? feeKindOf(it[2]) || 'own' : 'own';
      const slot = by[k] || by.own;
      slot.total += it[1];
      slot.lines.push({ label: it[0], amount: it[1], provenance: it[2]?.provenance || null, id: it[2]?.id || null, group: g.id });
    }
    return { kinds: by, optionalOut: optionalCostLines.map(x => ({ id: x.id, label: x.label, estimate: x.estimate })) };
  })();

  return { proj, loan, deposit, duty, legal, loanDuty, renovation, acquisitionCost,
           costGroups, missingCostLines, unconfirmedCost, unconfirmedLines, placeholderCostLines,
           optionalCostLines, ledgerSplit, mrtaIncluded, mrtaQuoted,
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
           gain, rpgt, rpgtPct: rpgtResult.rate, rpgtResult, netExitProceeds,
           cumCash, cumPreTax, cumTax, taxComputed, path, totalProfit, multiple,
           irrPct, irrWhy: irrResult.why, irrSignChanges: irrResult.signChanges,
           npvAtHurdle, hurdlePct, annualisedMultiplePct, equityOut, flows,
           propertyClass, propertyClassSrc, letsToTenant, strataCharges,
           stress, exits, holdVsSell, renoRecovered, equity,
           /* Two figures the Scenario Lab names (82-property-lab.js), each
              from figures above and nothing new. The value at the sale less
              the loan still owed then, before agent, legal, gains tax and
              the months carried while selling — unknown with the balance;
              and the growth on the price alone at the reader's rate, which
              with the price and the renovation recovered makes up the value
              at the sale. Neither is called equity, for the reason at
              yearFlow. */
           valueLessLoanAtExit: debtUnknown ? null : exitValue - outstanding,
           priceGrowthAtExit: exitValue - renoRecovered - d.price };
}

/* The calculator's "Monthly commitment": what the owner funds from their
   own income each month — the monthly position's shortfall, and nothing
   when the property pays for itself; null where the position is unknown.
   One function, read by the equity card below and by the client proposal
   (72-property-proposal.js), so the two print one figure. */
function monthlyCommitment(m) {
  return isNum(m?.cashflowMonthly) ? Math.max(0, -m.cashflowMonthly) : null;
}

/* WHAT THE RENOVATION RETURNS. Two runs of the model, not one: this deal as
   entered, and the same deal with no renovation, the rent reduced by the
   share that depends on it, and nothing recovered at exit. The difference in
   the rate of return is what the spend buys. Computed here rather than inside
   dealModel because it calls dealModel — the sensitivity module makes the
   same choice for the same reason. Not applicable where nothing is budgeted;
   said so, rather than a card of zeros. */
function renovationReturn(d, m) {
  const cost = num0(d.renovation);
  if (!(cost > 0)) return { applicable: false, why: 'No renovation or furnishing budget is entered, so there is nothing to assess.' };
  const uplift = num0(d.renoRentUpliftPct) / 100, recovery = num0(d.renoValueRecoveryPct) / 100;
  /* The input is the SHARE of the entered rent that depends on the work, so
     the rent without it is the rent less that share. It was divided by
     (1 + share), which attributed share/(1 + share) — 16.7% for an input of
     20% — while the label, the card and the plan all said 20%. */
  const without = dealModel({ ...d, renovation: 0, rent: num0(d.rent) * (1 - clamp(uplift, 0, 1)), renoRentUpliftPct: 0, renoValueRecoveryPct: 0 });
  const rentUpliftAnnual = isNum(m.effectiveRent) && isNum(without.effectiveRent) ? m.effectiveRent - without.effectiveRent : null;
  return {
    applicable: true, cost,
    rentUpliftPct: uplift * 100, recoveryPct: recovery * 100,
    rentUpliftAnnual,
    paybackYears: isNum(rentUpliftAnnual) && rentUpliftAnnual > 0 ? cost / rentUpliftAnnual : null,
    valueRecovered: cost * recovery,
    irrWith: m.irrPct, irrWithout: without.irrPct,
    irrDelta: isNum(m.irrPct) && isNum(without.irrPct) ? m.irrPct - without.irrPct : null,
    cashWith: m.safeCashRequired, cashWithout: without.safeCashRequired,
  };
}

/* THE PRICE THAT MAKES THIS WORK (the property decision layer, P2).
   ---------------------------------------------------------------------------
   The highest purchase price at which the figures the reader entered meet a
   target they set — a monthly position of at least X, or a net yield of at
   least Y — found by running THIS model (dealModel) at trial prices with
   every other input held. No second model, no shortcut formula: what the
   page shows at the solved price is what the solve tested.

   WHY BISECTION IS ENOUGH. With every other input held, both measures can
   only fall as the price rises: the loan is a share of the price (or of the
   lower of the price and an entered valuation), so the repayment rises and
   the monthly position falls or stays; the net operating income does not
   depend on the price, so the net yield is it divided by a larger price.
   So "meets the target" holds below some price and fails above it.

   TOLERANCE: ONE RINGGIT, ON THE PRICE — NONE ON THE TARGET. The search is
   over whole ringgit, between RM1,000 and four times the larger of the
   price and the asking price (and at least RM400,000). The price returned
   is the highest whole-ringgit price at which the model's figure meets the
   target exactly (>=, no allowance), and at one ringgit more it does not;
   both runs are returned, so a test or a reader can see it. Said otherwise:
   - infeasible — the target is not met even at RM1,000 (the rent, the
     running costs or the loan terms, not the price, stand in the way);
   - unbounded — it is met even at the top of the range (a loan held to an
     entered valuation stops following the price);
   - not applicable — a net yield for a class with no tenancy;
   - unknown — the model cannot compute the measure (a loan with no
     schedule). */
const PRICE_TARGETS = {
  monthly: { id: 'monthly', label: 'Monthly position', field: 'cashflowMonthly', words: 'a monthly position', fmt: (v) => fmtMoney(v, 'MYR', 0), unit: 'RM a month' },
  yield: { id: 'yield', label: 'Net yield', field: 'netYield', words: 'a net yield', fmt: (v) => fmtPct(v, 2), unit: '%' },
};
const PRICE_SOLVE_FLOOR = 1000;
const dealTarget = (d) => (d && PRICE_TARGETS[d.targetKind] && isNum(d.targetValue) ? { kind: d.targetKind, value: d.targetValue } : null);
function solveDealPrice(d, target = dealTarget(d)) {
  const t = target && PRICE_TARGETS[target.kind];
  if (!t || !isNum(target.value)) return { status: 'no-target' };
  if (t.id === 'yield' && !PROPERTY_CLASSES[propertyClassOf(d)].letsToTenant)
    return { status: 'not-applicable', target: t, value: target.value, why: 'A class with no tenancy earns no rent, so no price gives it a net yield.' };
  let runs = 0;
  const at = (p) => { runs++; return dealModel({ ...d, price: p }); };
  const reads = (m) => m[t.field];
  const meets = (m) => isNum(reads(m)) && reads(m) >= target.value;
  let lo = PRICE_SOLVE_FLOOR;
  const mLo = at(lo);
  if (!isNum(reads(mLo))) return { status: 'unknown', target: t, value: target.value, runs,
    why: 'The model cannot compute this figure for these inputs: the loan has no schedule of repayments (a tenure of 0).' };
  if (!meets(mLo)) return { status: 'infeasible', target: t, value: target.value, floor: lo, atFloor: reads(mLo), runs };
  let hi = Math.ceil(Math.max(num0(d.price), num0(d.askingPrice), 100000) * 4);
  const mHi = at(hi);
  if (meets(mHi)) return { status: 'unbounded', target: t, value: target.value, ceiling: hi, atCeiling: reads(mHi), runs };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (meets(at(mid))) lo = mid; else hi = mid;
  }
  const m = at(lo), over = at(lo + 1);
  return { status: 'solved', target: t, value: target.value, price: lo, achieved: reads(m), above: reads(over), aboveMeets: meets(over),
    vsPrice: num0(d.price) > 0 ? lo - num0(d.price) : null,
    vsAsking: isNum(d.askingPrice) && d.askingPrice > 0 ? lo - d.askingPrice : null, runs };
}

/* THE AUCTION RISK MODE (the property decision layer, P3).
   ---------------------------------------------------------------------------
   From the market value the reader's comparables imply, down to the reserve
   price and the winning bid they expect, then up again by what an auction
   adds — repairs, the arrears the Proclamation passes to the buyer,
   possession, the transaction costs and the months of holding — to the
   EFFECTIVE ACQUISITION COST; the TRUE DISCOUNT is the market value less
   that, against the market value. And the FORFEITURE EXPOSURE: the deposit
   at risk if the balance is not paid within the days the Proclamation
   gives.

   NOTHING ASSUMED. Every figure is the reader's: the winning bid is the
   purchase price the model runs on (every figure of dealModel is worked
   from it); the market value is the median of the comparables they named
   from their register (priceGap) and the comparable prices they typed;
   the costs are what they entered. A cost not entered is not counted and
   is named as not entered — the effective cost says so, never "nought".
   The deposit, what it is a share of and the days to pay the balance are
   entered from the Proclamation and Conditions of Sale; until all three
   are, the deposit, the balance and the forfeiture exposure are
   Unavailable — no default figure, ever.

   THE TRANSACTION COSTS are the ledger's own fee lines (dealModel's
   costGroups): the statutory, professional and disbursement lines of the
   acquisition and the financing — the reader's legal quote in place of the
   purchase legal fees where entered — and not the deposit, the insurance or
   the utility deposits. THE HOLDING COST is the months of holding entered
   times what the property costs its owner a month with no rent coming in
   (burnWithoutRent: the instalment and the running costs).

   NOT FINAL until every check of the checklist (AUCTION_CHECKS, from the
   Malaysian Bar's guidance) is ticked: `final` is false and `checksOpen`
   names the ones open. */
/* By the rulebook's kinds (1.1.0): the statutory charges and the scale
   fees, and of the estimates the searches and disbursements — not the
   utility deposits, and no optional product. */
const AUCTION_FEE_CATEGORIES = ['statutory', 'professional'];
const AUCTION_FEE_ESTIMATES = ['disbursements'];
function auctionModel(d, m = dealModel(d)) {
  const has = (k) => isNum(d?.[k]);
  const kindOf = (k) => KIND_OF_EVIDENCE[d?.evidence?.[k] || 'user'] || 'yours';
  /* The market value, from comparables only. */
  const g = priceGap(d);
  const typed = AUCTION_COMP_KEYS.filter(k => has(k) && d[k] > 0).map(k => ({ key: k, price: d[k], kind: kindOf(k) }));
  const values = [...g.comps.map(c => c.implied), ...typed.map(c => c.price)];
  const market = values.length ? median(values) : null;
  const marketKind = values.length ? kindFirst([...g.comps.map(c => KIND_OF_EVIDENCE[c.evidence] || 'yours'), ...typed.map(c => c.kind)]) || 'yours' : 'unavailable';
  const reserve = has('reservePrice') && d.reservePrice > 0 ? d.reservePrice : null;
  const bid = num0(d?.price) > 0 ? num0(d.price) : null;
  const bidKind = inputIsSeeded(d, 'price') ? 'illustrative' : KIND_OF_EVIDENCE[shownEvidence(d, 'price')] || 'yours';
  /* What an auction adds. */
  const arrearsParts = auctionArrearsFor(d).map(([k, label]) => ({ key: k, label, amount: has(k) ? d[k] : null, kind: has(k) ? kindOf(k) : 'unavailable' }));
  const arrearsIn = arrearsParts.filter(p => p.amount != null);
  const fees = (m.costGroups || []).filter(gr => gr.id === 'acquisition' || gr.id === 'financing').flatMap(gr => gr.items)
    .filter(it => it[2]?.line && (it[2].quotedLine ? it[2].id === 'auctionLegal'
      : AUCTION_FEE_CATEGORIES.includes(it[2].line.category) || AUCTION_FEE_ESTIMATES.includes(it[2].id)));
  const feesPriced = fees.filter(it => isNum(it[1]));
  /* The badge of the lines priced; a line the rulebook cannot price is
     named as unpriced beside the sum, not counted in it. */
  const feeKinds = feesPriced.map(it => feeKindBadge(it[2], it[1]) || 'placeholder');
  const holdMonths = has('auctionHoldMonths') ? d.auctionHoldMonths : null;
  const burn = isNum(m.burnWithoutRent) ? m.burnWithoutRent : null;
  const step = (id, label, amount, kind, extra = {}) => ({ id, label, amount, kind: amount == null ? 'unavailable' : kind, ...extra });
  const adds = [
    step('repairs', 'Repairs', has('auctionRepairs') ? d.auctionRepairs : null, kindOf('auctionRepairs'), { key: 'auctionRepairs' }),
    step('arrears', 'Arrears passed to you', arrearsIn.length ? arrearsIn.reduce((t, p) => t + p.amount, 0) : null,
      kindFirst(arrearsIn.map(p => p.kind)) || 'yours', { parts: arrearsParts, partsMissing: arrearsParts.filter(p => p.amount == null).map(p => p.label) }),
    step('possession', 'Possession', has('possessionCost') ? d.possessionCost : null, kindOf('possessionCost'), { key: 'possessionCost', months: has('possessionMonths') ? d.possessionMonths : null }),
    step('transaction', 'Transaction costs', feesPriced.length ? feesPriced.reduce((t, it) => t + it[1], 0) : null, kindFirst(feeKinds) || 'derived',
      { lines: fees.map(it => ({ label: it[0], amount: isNum(it[1]) ? it[1] : null, provenance: it[2].provenance })), unpriced: fees.length - feesPriced.length }),
    step('holding', 'Holding', holdMonths != null && burn != null ? holdMonths * burn : null, 'modelled', { months: holdMonths, monthly: burn }),
  ];
  const counted = adds.filter(a => a.amount != null);
  const effective = bid != null ? bid + counted.reduce((t, a) => t + a.amount, 0) : null;
  const effectiveKind = effective == null ? 'unavailable' : kindFirst([bidKind, ...counted.map(a => a.kind)]) || 'derived';
  const vs = (x) => (isNum(x) && isNum(market) && market > 0 ? { amount: market - x, pct: (market - x) / market * 100 } : null);
  /* The terms of the sale: never assumed. */
  const depositPct = has('auctionDepositPct') ? d.auctionDepositPct : null;
  const depositOf = Object.hasOwn(AUCTION_DEPOSIT_OF, d?.auctionDepositOf) ? d.auctionDepositOf : null;
  const days = has('auctionBalanceDays') ? d.auctionBalanceDays : null;
  const depositBase = depositOf === 'reserve' ? reserve : depositOf === 'bid' ? bid : null;
  const deposit = depositPct != null && depositBase != null ? Math.round(depositBase * depositPct) / 100 : null;
  const termsMissing = [
    depositPct == null ? 'the deposit (%)' : null,
    depositOf == null ? 'what the deposit is a share of' : null,
    depositOf === 'reserve' && reserve == null ? 'the reserve price' : null,
    days == null ? 'the days to pay the balance' : null,
  ].filter(Boolean);
  const balance = deposit != null && bid != null ? bid - deposit : null;
  const loan = isNum(m.loan) ? m.loan : null;
  /* Of the balance, what the loan does not cover: cash, by the day the
     balance is due. And the buffer the reader holds against it. */
  const cashForBalance = balance != null && loan != null ? Math.max(0, balance - loan) : null;
  const buffer = has('auctionBuffer') ? d.auctionBuffer : null;
  const forfeiture = termsMissing.length
    ? { status: 'unavailable', missing: termsMissing, atRisk: null, days, depositPct, depositOf, deposit, balance }
    : { status: 'ok', missing: [], atRisk: deposit, days, depositPct, depositOf, deposit, balance, cashForBalance, loan, buffer,
        bufferShort: buffer != null && cashForBalance != null ? Math.max(0, cashForBalance - buffer) : null };
  const ticked = Array.isArray(d?.auctionChecks) ? d.auctionChecks.filter(id => AUCTION_CHECK_IDS.includes(id)) : [];
  const checksOpen = AUCTION_CHECK_IDS.filter(id => !ticked.includes(id));
  return {
    market, marketKind, marketFrom: { named: g.comps, typed, notUsed: g.notUsed }, reserve, bid, bidKind,
    steps: [
      step('market', 'Market value', market, marketKind, { total: true }),
      step('reserve', 'Reserve price', reserve, kindOf('reservePrice'), { total: true, key: 'reservePrice' }),
      step('bid', 'Winning bid', bid, bidKind, { total: true }),
      ...adds,
      step('effective', 'Effective acquisition cost', effective, effectiveKind, { total: true }),
    ],
    adds, notEntered: adds.filter(a => a.amount == null).map(a => a.label),
    effective, effectiveKind,
    trueDiscount: vs(effective), bidDiscount: vs(bid), reserveDiscount: vs(reserve),
    forfeiture, checksTicked: ticked, checksOpen, final: checksOpen.length === 0,
  };
}

/* THE BID CEILING (the validation pass, audit #4, 10 Oct 2026).
   ---------------------------------------------------------------------------
   The highest winning bid, to the ringgit, at which the effective
   acquisition cost — auctionModel's own, run at that bid with every other
   input held — stays at or under the ceiling the reader sets:
   - a cost of their own, all in (auctionCapKind 'cost', RM); or
   - the market value their comparables imply less a margin they choose
     (auctionCapKind 'margin', %) — Unavailable without a market value,
     never a market figure standing in for one.
   WHY BISECTION IS ENOUGH. Every step of the effective cost rises or stays
   as the bid rises: the bid itself; the transfer duty and the scale fees,
   charged on it; the loan, a share of it, and with it the loan's fees, the
   instalment and so the holding cost; the repairs, the arrears and the
   possession cost do not move. So the cost is at or under the ceiling
   below some bid and over it above.
   A cost not entered is not counted (auctionModel's rule), and a fee line
   not priced is not either: the ceiling names both, so a reader sees what
   it leaves out. Whole ringgit, no tolerance on the ceiling: at the bid
   returned the cost is at or under it, at one ringgit more it is over. */
function auctionBidCeiling(d, a = auctionModel(d)) {
  const kind = Object.hasOwn(AUCTION_CAP_KINDS, d?.auctionCapKind) ? d.auctionCapKind : null;
  const value = isNum(d?.auctionCapValue) ? d.auctionCapValue : null;
  const missing = [kind == null ? 'what the ceiling is' : null, value == null ? 'its figure' : null].filter(Boolean);
  const valueKind = value == null ? 'unavailable' : KIND_OF_EVIDENCE[d?.evidence?.auctionCapValue || 'user'] || 'yours';
  if (missing.length) return { status: 'no-target', missing, kind, value };
  if (kind === 'margin' && !(value < 100)) return { status: 'invalid', kind, value, why: 'A margin of 100% or more leaves no price to bid.' };
  if (kind === 'margin' && !isNum(a.market)) return { status: 'unavailable', kind, value, why: 'needs the market value — enter comparable prices or name comparables from your register' };
  const cap = kind === 'margin' ? a.market * (1 - value / 100) : value;
  let runs = 0;
  const at = (bid) => { runs++; return auctionModel({ ...d, price: bid }); };
  const eff = (x) => x.effective;
  const lo0 = PRICE_SOLVE_FLOOR;
  const aLo = at(lo0);
  const base = { kind, value, cap, capKind: kindFirst([valueKind, kind === 'margin' ? a.marketKind : null].filter(Boolean)) || 'yours',
    notEntered: a.notEntered, unpriced: a.adds.find(s => s.id === 'transaction')?.unpriced || 0 };
  if (!isNum(eff(aLo))) return { ...base, status: 'unknown', runs, why: 'The effective cost cannot be worked out for these inputs.' };
  if (eff(aLo) > cap) return { ...base, status: 'infeasible', runs, floor: lo0, atFloor: eff(aLo) };
  let lo = lo0, hi = Math.max(lo0 + 1, Math.floor(cap) + 1);
  if (eff(at(hi)) <= cap) return { ...base, status: 'unbounded', runs, ceiling: hi };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (eff(at(mid)) <= cap) lo = mid; else hi = mid;
  }
  const mAt = at(lo), mOver = at(lo + 1);
  return { ...base, status: 'solved', runs, bid: lo, effective: eff(mAt), above: eff(mOver),
    vsBid: num0(d?.price) > 0 ? lo - num0(d.price) : null,
    resultKind: kindFirst([base.capKind, a.effectiveKind]) || 'derived' };
}

/* THE DEVELOPER PREMIUM MODEL (the property decision layer, P4).
   ---------------------------------------------------------------------------
   A new development is bought off plan at the SPA price, paid by stages as
   it is built, and earns nothing until vacant possession (VP). Five
   figures, each from the reader's own figures:
   - THE DEVELOPER PREMIUM: the price paid — the SPA price less the
     developer's rebates and incentives entered — against the value a
     completed comparable implies: the median of the comparable price the
     reader typed (with its source and date) and the transacted prices they
     named from their register (priceGap). Unavailable with none: no market
     figure stands in for it.
   - INTEREST DURING CONSTRUCTION, from the reader's schedule of progressive
     drawdown (ndConstruction): the buyer's own money pays the first stages
     and the loan the rest, each release charged interest only, at the
     rate entered, from the month it is drawn until VP.
   - THE CASH REQUIRED: the calculator's own (dealModel's ledger), which
     carries that interest and the rebate once entered.
   - THE MONTHLY POSITION FROM VP: the calculator's monthly position, at the
     rent and the vacancy the reader assumes for completion — badged
     Modelled, an assumption.
   - EXIT VALUES at VP+3, VP+5 and VP+10: the completed comparable's value
     grown at the reader's appreciation rate from the SPA month — Modelled,
     never a forecast; Unavailable without a comparable or the two dates.
   And what would justify the premium: the rent at which the deal at the
   SPA price gives the monthly position it gives priced at the comparable
   (a solve on dealModel, to the ringgit), and the yearly growth at which a
   completed unit's value reaches the price paid by VP.
   Defect liability is a feature of the route (NEWDEV_DLP), never a figure. */
const ndMonthsBetween = (a, b) => { const i = ndMonthIndex(a), j = ndMonthIndex(b); return i == null || j == null ? null : j - i; };
function ndConstruction(d, loan) {
  const stages = parseNdSchedule(d?.ndSchedule);
  const template = ndTemplateOf(stages);
  const vpMonths = ndMonthsBetween(d?.ndSpaMonth, d?.ndVpMonth);
  const total = stages ? +stages.reduce((t, s) => t + s.pct, 0).toFixed(4) : null;
  const missing = [
    !stages ? 'your schedule of progressive drawdown' : null,
    stages && Math.abs(total - 100) > 1e-6 ? `stages that add to 100% (yours add to ${fmtNum(total, total % 1 ? 2 : 0)}%)` : null,
    stages && stages.some(s => s.month == null) ? `the month of ${stages.filter(s => s.month == null).length === stages.length ? 'each stage' : `${stages.filter(s => s.month == null).length} of ${stages.length} stages`}` : null,
    ndMonthIndex(d?.ndSpaMonth) == null ? 'the SPA month' : null,
    ndMonthIndex(d?.ndVpMonth) == null ? 'the month of vacant possession' : null,
    vpMonths != null && vpMonths <= 0 ? 'a vacant-possession month after the SPA month' : null,
  ].filter(Boolean);
  /* THE COMPLETION DELAY (the validation pass, audit #4): whole months past
     the expected VP, the reader's. Vacant possession is then `vpAt` months
     after signing: every release is charged to it, and the rent begins
     after it. Not entered, none — and the figures are what they were. */
  const delay = isNum(d?.ndDelayMonths) && d.ndDelayMonths > 0 ? d.ndDelayMonths : 0;
  const vpAt = vpMonths == null ? null : vpMonths + delay;
  const base = { stages, template, vpMonths, delay, vpAt, total, missing, ratePct: num0(d?.ratePct) };
  if (missing.length) return { ...base, status: 'unavailable', idc: null, draws: null };
  const price = num0(d.price), lent = Math.max(0, num0(loan));
  /* Own money first, then the loan: the buyer's share of the price (the
     price less the loan) pays the stages until it is spent. Billed in the
     order of their months, in the schedule's order within a month. */
  const own = Math.max(0, price - lent);
  const order = stages.map((s, i) => ({ ...s, i })).sort((a, b) => a.month - b.month || a.i - b.i);
  const r = num0(d.ratePct) / 100 / 12;
  const run = (vp) => {
    let paid = 0, idc = 0;
    const draws = order.map(s => {
      const amount = price * s.pct / 100;
      const fromLoan = Math.max(0, Math.min(paid + amount, price) - Math.max(paid, own));
      paid += amount;
      const months = Math.max(0, vp - s.month);
      const interest = fromLoan * r * months;
      idc += interest;
      return { i: s.i, pct: s.pct, month: s.month, amount, own: amount - fromLoan, fromLoan, months, interest };
    });
    return { idc, draws };
  };
  const at = run(vpAt);
  /* What the delay alone adds: the same schedule charged to the expected VP. */
  const onTime = delay ? Math.round(run(vpMonths).idc) : null;
  return { ...base, status: lent > 0 ? 'ok' : 'no-loan', idc: Math.round(at.idc), draws: at.draws, own, loan: lent,
    idcOnTime: onTime, delayIdc: delay ? Math.round(at.idc) - onTime : 0 };
}
/* The rent that justifies the premium: the lowest monthly rent (to the
   ringgit) at which dealModel at the deal's own price gives at least the
   monthly position it gives priced the premium lower — every other figure
   held. The monthly position rises with the rent, so bisection finds it. */
function ndRentNeeded(d, premium) {
  if (!PROPERTY_CLASSES[propertyClassOf(d)].letsToTenant) return { status: 'not-applicable', why: 'A class with no tenancy earns no rent.' };
  if (!(premium > 0)) return { status: 'no-premium' };
  const target = dealModel({ ...d, price: num0(d.price) - premium }).cashflowMonthly;
  const at = (rent) => dealModel({ ...d, rent }).cashflowMonthly;
  if (!isNum(target) || !isNum(at(num0(d.rent)))) return { status: 'unknown', why: 'The loan has no schedule of repayments (a tenure of 0).' };
  let lo = 0, hi = Math.max(1000, num0(d.rent) * 4);
  let runs = 0;
  while (at(hi) < target && runs < 20) { hi *= 2; runs++; }
  if (at(hi) < target) return { status: 'unknown', why: 'No rent the model can reach covers it.' };
  if (at(lo) >= target) return { status: 'solved', rent: 0, target, extra: -num0(d.rent) };
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (at(mid) >= target) hi = mid; else lo = mid; }
  return { status: 'solved', rent: hi, target, achieved: at(hi), below: at(hi - 1), extra: hi - num0(d.rent) };
}
function newDevModel(d, m = dealModel(d), { solve = true } = {}) {
  const has = (k) => isNum(d?.[k]);
  const kindOf = (k) => KIND_OF_EVIDENCE[d?.evidence?.[k] || 'user'] || 'yours';
  const price = num0(d?.price) > 0 ? num0(d.price) : null;
  const priceKind = inputIsSeeded(d, 'price') ? 'illustrative' : KIND_OF_EVIDENCE[shownEvidence(d, 'price')] || 'yours';
  const rebates = has('ndRebates') && d.ndRebates > 0 ? d.ndRebates : 0;
  const paid = price != null ? price - rebates : null;
  /* The completed comparable: typed, and named from the register. */
  const g = priceGap(d);
  const typed = has('ndCompPrice') && d.ndCompPrice > 0
    ? { price: d.ndCompPrice, source: String(d.ndCompSource || '').trim() || null, date: d.ndCompDate || null, kind: kindOf('ndCompPrice') } : null;
  const values = [...g.comps.map(c => c.implied), ...(typed ? [typed.price] : [])];
  const comp = values.length ? medianOf(values) : null;
  const compKind = values.length ? kindFirst([...g.comps.map(c => KIND_OF_EVIDENCE[c.evidence] || 'yours'), ...(typed ? [typed.kind] : [])]) || 'yours' : 'unavailable';
  /* NOT FOR LAND (ROUTE_ASSET_GATES, 70-property.js): a bare parcel is not
     bought off plan, so nothing of this model is run for it — no premium,
     no construction interest, no exit from VP — and it says why. */
  const gate = routeAssetGate(d);
  const gated = gate?.scope === 'route';
  const premium = !gated && isNum(paid) && isNum(comp) && comp > 0 ? { amount: paid - comp, pct: (paid - comp) / comp * 100 } : null;
  const premiumKind = premium ? kindFirst([priceKind, compKind]) || 'derived' : 'unavailable';
  /* The construction. */
  const build = gated ? { status: 'gated', missing: [], idc: null, draws: null, vpMonths: null, vpAt: null, delay: 0, stages: null, template: null }
    : ndConstruction(d, m.loan);
  /* Exit values, from the comparable, at the reader's rate — from vacant
     possession as it falls, the delay entered included. */
  const growth = num0(d?.apprecPct);
  const exitMissing = gated ? [] : [!isNum(comp) ? 'a completed comparable' : null, build.vpMonths == null || build.vpMonths <= 0 ? 'the SPA month and the month of vacant possession' : null].filter(Boolean);
  const exits = [3, 5, 10].map(n => {
    if (gated || exitMissing.length) return { n, status: gated ? 'gated' : 'unavailable', value: null, years: null };
    const years = build.vpAt / 12 + n;
    return { n, status: 'ok', years, value: comp * Math.pow(1 + growth / 100, years) };
  });
  /* What would justify the premium. */
  const rentNeeded = gated ? { status: 'not-applicable', why: gate.why } : !premium ? { status: 'no-comparable' } : solve ? ndRentNeeded(d, premium.amount) : { status: 'pending' };
  const growthNeeded = gated ? { status: 'not-applicable', why: gate.why } : !premium ? { status: 'no-comparable' }
    : !(build.vpMonths > 0) ? { status: 'no-dates' }
    : !(premium.amount > 0) ? { status: 'no-premium' }
    : { status: 'solved', pct: (Math.pow(paid / comp, 12 / build.vpAt) - 1) * 100, years: build.vpAt / 12 };
  const rentKind = PROPERTY_CLASSES[propertyClassOf(d)].letsToTenant ? (inputIsSeeded(d, 'rent') || KIND_OF_EVIDENCE[shownEvidence(d, 'rent')] === 'illustrative' ? 'illustrative' : 'modelled') : 'unavailable';
  /* The first month of rent: the month after vacant possession falls, the
     delay included — "N months after signing". */
  const rentFrom = isNum(build.vpAt) && build.vpAt > 0 ? build.vpAt : null;
  return {
    gate, gated,
    /* Sarawak's prescribed stages and defect liability: for housing
       accommodation only (ROUTE_ASSET_GATES 'newdev|commercial'). */
    templates: !gate,
    price, priceKind, rebates, paid, comp, compKind, compFrom: { named: g.comps, typed, notUsed: g.notUsed },
    premium, premiumKind, build,
    idcKind: build.status === 'ok' || build.status === 'no-loan' ? 'modelled' : 'unavailable',
    cash: m.safeCashRequired, cashMissing: m.missingCostLines || [], cashUnverified: m.unconfirmedCost,
    vpMonthly: m.cashflowMonthly, rent: num0(d?.rent), occupancyPct: 100 - num0(d?.vacancyPct), rentKind,
    delay: build.delay || 0, delayIdc: build.delayIdc || 0, rentFrom,
    growth, exits, exitMissing, rentNeeded, growthNeeded,
  };
}

/* THE COMMERCIAL MODELS (the property decision layer, P5).
   ---------------------------------------------------------------------------
   For a commercial class, of any subtype and on any route. Nothing here
   changes a figure of the calculator's own (dealModel is untouched: its
   rent is the model rent, as it always was), so a commercial deal prints
   what it printed before; these are figures beside it, each from the
   reader's own figures.
   - FOUR RENTS, NEVER MIXED: the contract rent (the tenancy's — Yours),
     the asking rent (Yours), the observed comparable rent (the median of
     the achieved rents the reader named from their register, with their
     count and dates — Unavailable with none; never an asking rent, and no
     NAPIC rent, because NAPIC records transactions, not tenancies) and the
     model rent (the calculator's expected rent — the reader's assumption,
     Modelled). Each is its own figure; none is a blend.
   - RENT SUSTAINABILITY: the contract rent against the observed
     comparables, as a range — against the highest of them and the lowest,
     and their median — "10–23% above the observed comparables you
     recorded". Unavailable without them. The model rent is set against
     them the same way, since the renewal is modelled at it.
   - THE YIELD BOTH WAYS: the calculator's own net yield, at the contract
     rent and at the model rent (the model run with each as its rent).
   - LEASE-DOWN: 3, 6, 12 and 18 months vacant from the lease expiry (or
     from now, for a unit the reader says is vacant). The cash reserve each
     needs is its months of what the property costs with no rent coming in
     (burnWithoutRent: the instalment and the owner-paid running costs)
     plus the fit-out the reader enters for a re-let — not entered, not
     counted, and said so. The effective annual yield over the holding
     period: the contract rent until the expiry, nothing for the months
     vacant, the model rent after; less the model's rent-linked costs on
     the rent received, its fixed running costs for every month and the
     fit-out; a year's worth of it over the purchase price. Rents held flat.
   Nothing the reader must supply is assumed: a lease-down without the
   lease expiry (or a vacant unit) and the contract rent is Unavailable. */
const CM_LEASE_DOWN_MONTHS = [3, 6, 12, 18];
/* This month, as a month index (ndMonthIndex's scale). */
const cmThisMonth = () => { const t = new Date(); return t.getFullYear() * 12 + t.getMonth(); };
function commercialModel(d, m = dealModel(d), { asOf = null } = {}) {
  const kindOf = (k) => KIND_OF_EVIDENCE[d?.evidence?.[k] || 'user'] || 'yours';
  const vacant = d?.tenancy === 'vacant';
  const contract = !vacant && isNum(d?.tenancyRent) && d.tenancyRent > 0 ? d.tenancyRent : null;
  const asking = isNum(d?.cmAskingRent) && d.cmAskingRent > 0 ? d.cmAskingRent : null;
  const model = num0(d?.rent) > 0 ? num0(d.rent) : null;
  const modelKind = !model ? 'unavailable' : inputIsSeeded(d, 'rent') || KIND_OF_EVIDENCE[shownEvidence(d, 'rent')] === 'illustrative' ? 'illustrative' : 'modelled';
  /* The observed comparables: achieved rents named, and nothing else. */
  const ids = Array.isArray(d?.rentComparableIds) ? d.rentComparableIds : [];
  const all = State.observations || [];
  const named = ids.map(id => all.find(o => o && o.id === id)).filter(Boolean);
  const used = named.filter(o => o.kind === 'let-rent' && !o.sample && isNum(o.value) && o.value > 0);
  const comps = used.map(o => ({ id: o.id, name: comparableName(o), rent: o.value, date: o.date || null, source: comparableSource(o),
    standing: observationStanding(o), evidence: o.evidence || null, type: String(o.propertyType || '').trim() || null }));
  const vals = comps.map(x => x.rent).sort((a, b) => a - b);
  const dates = comps.map(x => x.date).filter(Boolean).sort();
  const observed = comps.length ? { median: medianOf(vals), n: comps.length, lo: vals[0], hi: vals[vals.length - 1], first: dates[0] || null, last: dates[dates.length - 1] || null } : null;
  const observedKind = observed ? kindFirst(comps.map(x => KIND_OF_EVIDENCE[x.evidence] || 'yours')) || 'yours' : 'unavailable';
  const rents = [
    { id: 'contract', label: 'Contract rent', value: contract, kind: contract ? kindOf('tenancyRent') : 'unavailable' },
    { id: 'asking', label: 'Asking rent', value: asking, kind: asking ? kindOf('cmAskingRent') : 'unavailable' },
    { id: 'observed', label: 'Observed comparable rent', value: observed ? observed.median : null, kind: observedKind },
    { id: 'model', label: 'Model rent', value: model, kind: modelKind },
  ];
  /* Sustainability: a rent against the highest, the lowest and the median
     of the observed comparables, in per cent of each. */
  const against = (r) => (observed && r > 0 ? { rent: r, lo: (r - observed.hi) / observed.hi * 100, hi: (r - observed.lo) / observed.lo * 100, median: (r - observed.median) / observed.median * 100 } : null);
  const sustain = { status: !observed ? 'no-comparables' : contract ? 'ok' : vacant ? 'vacant' : 'no-contract', contract: against(contract), model: against(model) };
  /* The yield both ways: the model's own net yield, run at each rent. */
  const mC = contract ? dealModel({ ...d, rent: contract }) : null;
  const costsSeeded = ['price', 'maintenance'].some(k => inputIsSeeded(d, k));
  const yields = {
    contract: mC && isNum(mC.netYield) ? mC.netYield : null, model: isNum(m.netYield) ? m.netYield : null,
    grossContract: mC && isNum(mC.grossYield) ? mC.grossYield : null, grossModel: isNum(m.grossYield) ? m.grossYield : null,
    vacancyPct: num0(d?.vacancyPct),
    contractKind: !(mC && isNum(mC.netYield)) ? 'unavailable' : costsSeeded ? 'illustrative' : 'modelled',
    modelKind: !isNum(m.netYield) ? 'unavailable' : costsSeeded || modelKind === 'illustrative' ? 'illustrative' : 'modelled',
  };
  /* The lease-down. */
  const now = asOf ?? cmThisMonth();
  const expiry = ndMonthIndex(d?.cmLeaseExpiry);
  const hold = normHoldYears(d?.holdYears) * 12;
  const fitOut = isNum(d?.cmFitOut) ? d.cmFitOut : null;
  const burn = isNum(m.burnWithoutRent) ? m.burnWithoutRent : null;
  const missing = [
    !vacant && expiry == null ? 'the lease expiry' : null,
    !vacant && !contract ? 'the contract rent' : null,
    !model ? 'the model rent' : null,
    burn == null ? 'a loan with a schedule of repayments' : null,
  ].filter(Boolean);
  const start = vacant ? 0 : expiry == null ? null : Math.max(0, expiry - now);
  const price = num0(d?.price);
  const rentKept = 1 - num0(m.variableCostRate);
  const fixedMonthly = num0(m.fixedOperatingCosts) / 12;
  /* THE TENANCY'S RENT-FREE MONTHS AND ITS SERVICE CHARGE (the validation
     pass, audit #4): the reader's, from the tenancy. Rent-free months are
     the first months of the contract still to run from now, in which no
     rent is paid; the service charge is what the tenancy has the tenant
     pay the owner a month, for the months the contract runs — received in
     full, no management or repair share taken off it (it is not rent).
     Neither exists for a vacant unit; neither is assumed. */
  const rentFree = !vacant && isNum(d?.cmRentFreeMonths) && d.cmRentFreeMonths > 0 ? d.cmRentFreeMonths : 0;
  const serviceCharge = !vacant && isNum(d?.cmServiceCharge) && d.cmServiceCharge > 0 ? d.cmServiceCharge : 0;
  const scenarios = CM_LEASE_DOWN_MONTHS.map(n => {
    if (missing.length) return { months: n, status: 'unavailable', reserve: null, effYield: null };
    const reserve = Math.round(n * burn + (fitOut || 0));
    const cMonths = Math.min(start, hold);
    const free = Math.min(rentFree, cMonths);
    const vMonths = Math.max(0, Math.min(n, hold - start));
    const mMonths = Math.max(0, hold - start - n);
    const rentIn = (contract || 0) * (cMonths - free) + model * mMonths;
    const scIn = serviceCharge * cMonths;
    const fit = start < hold ? (fitOut || 0) : 0;
    const costs = fixedMonthly * hold;
    const net = rentIn * rentKept + scIn - costs - fit;
    const effYield = price > 0 ? net / (hold / 12) / price * 100 : null;
    return { months: n, status: start >= hold ? 'beyond' : 'ok', reserve, cMonths, free, vMonths, mMonths, rentIn, scIn, costs, fit, net, effYield };
  });
  /* THE CONTRACT RENT'S CASH FLOW, over the rest of the lease: from now to
     the expiry, the contract rent less its rent-free months, plus the
     service charge received, less the rent-linked costs on the rent and
     the fixed running costs every month — a year's worth of it over the
     price (the effective yield), and a month's worth less the instalment
     (the monthly position, averaged). Unavailable without the contract
     rent and the expiry; not for a vacant unit. */
  const term = (() => {
    if (vacant) return { status: 'vacant', missing: [] };
    const miss = [!contract ? 'the contract rent' : null, expiry == null ? 'the lease expiry' : null].filter(Boolean);
    if (miss.length) return { status: 'unavailable', missing: miss };
    const months = Math.max(0, expiry - now);
    if (!(months > 0)) return { status: 'expired', missing: [], months: 0 };
    const free = Math.min(rentFree, months);
    const rentIn = contract * (months - free), scIn = serviceCharge * months, costs = fixedMonthly * months;
    const net = rentIn * rentKept + scIn - costs;
    return { status: 'ok', missing: [], months, free, rentFree, serviceCharge, rentIn, scIn, costs, net,
      effYield: price > 0 ? net / (months / 12) / price * 100 : null,
      monthly: isNum(m.instalment) ? net / months - m.instalment : null };
  })();
  const seeded = ['price', 'downPct', 'ratePct', 'tenureYears'].some(k => inputIsSeeded(d, k));
  const lease = {
    vacant, expiry, expiryText: d?.cmLeaseExpiry || null, expired: !vacant && expiry != null && expiry < now, now, start, hold, fitOut, burn, missing,
    rentKept, fixedMonthly, price, scenarios, rentFree, serviceCharge,
    reserveKind: missing.length ? 'unavailable' : seeded ? 'illustrative' : 'modelled',
    effKind: missing.length ? 'unavailable' : seeded || costsSeeded || modelKind === 'illustrative' ? 'illustrative' : 'modelled',
  };
  const termKind = term.status !== 'ok' ? 'unavailable' : seeded || costsSeeded ? 'illustrative' : 'modelled';
  return { contract, asking, model, modelKind, vacant, tenancy: d?.tenancy || null, observed, observedKind, comps, notUsed: ids.length - used.length,
    rents, sustain, yields, lease, term: { ...term, kind: termKind } };
}

/* Inputs arrive from number fields, where an emptied box is '' and not 0. */
function num0(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function propertyRiskFlags(d, m) {
  const out = [];
  if (m.dscr != null && m.dscr < 1) out.push({ sev:'serious', t:'The rent does not cover the loan',
    n:`Debt-service cover of ${fmtX(m.dscr, 2)} means net operating income falls short of the instalments. The shortfall is funded from your own income every month.` });
  /* After them, not before: the monthly position is taken on the rent less
     the vacancy allowance, with the repair reserve among the costs. It said
     "before any repairs or void periods", which made the figure sound as if
     it would grow once those were counted. */
  if (m.cashflowMonthly < 0) out.push({ sev:'warning', t:'Negative monthly cash flow',
    n: m.letsToTenant === false
      ? `This costs ${fmtAmount(Math.abs(m.cashflowMonthly), 'MYR')} a month to hold, with no rent to set against it.`
      : `This costs ${fmtAmount(Math.abs(m.cashflowMonthly), 'MYR')} a month to hold, after the ${fmtPct(num0(d.vacancyPct), 0)} vacancy allowance and the ${fmtPct(num0(d.repairReservePct), 0)} repair reserve modelled here.` });
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
    /* The category as a sentence names it. Lower-casing the short label
       printed "charged at 30% for citizen or pr" — `who` exists for this. */
    n:`Selling in year ${d.holdYears} is charged at ${m.rpgtPct}% for ${m.rpgtResult.category.who}, which is ${fmtAmount(m.rpgt, 'MYR')} on this scenario.` });
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
  /* Raised on the ADVERSE answer, which is 'no' for the questions that ask
     whether something good is established. A 'yes' to "has the strata title
     issued" used to be raised as a risk, and so did 'yes' to the resale
     question. Read from the deal passed in, not State.deal, so a register
     record's flags are its own. */
  for (const chk of SARAWAK_CHECKS) {
    if (!chk.adverse || d.checks?.[chk.id] !== chk.adverse) continue;
    if (chk.id === 'comparables')
      out.push({ sev:'serious', t: chk.flag,
        n:'Every figure on this page is driven by the rent assumption. Until a transacted rent is confirmed, the outputs are arithmetic on a guess.' });
    else out.push({ sev: chk.sev, t: chk.flag || chk.q.replace(/\?$/, ''), n: `${chk.why} Confirm with: ${chk.who}.` });
  }

  /* Provenance is itself a risk. A model whose two largest drivers came from
     the seller is a sales projection wearing a spreadsheet. */
  const weak = ['price', 'rent'].filter(k => ['developer', 'assumed'].includes(d.evidence?.[k]));
  if (weak.length) out.push({ sev:'warning', t:'Key figures are not independently evidenced',
    n:`${weak.join(' and ')} ${weak.length === 1 ? 'is' : 'are'} marked as supplied by the seller or assumed by this tool. Those two drive every output here.` });

  if (!out.length) out.push({ sev:'good', t:'No threshold breached', n:'On the assumptions entered, none of the modelled risk thresholds is crossed. That is a statement about the assumptions, not about the property.' });
  return out;
}

/* A recorded exposure's summary, by company and theme — the pair Add refuses
   to record twice — so focus can be handed to a record after a redraw. */
const swkRecordId = (rec) => `swk-rec-${slugParam(`${rec.id}-${rec.theme}`)}`;
/* Which records the reader has open, by the same key — see the record's <details>. */
const swkOpenRecords = new Set();

VIEWS.sarawak = () => {
  /* The records open on the page this drawing replaces stay open in it —
     those still held: one just removed, or gone from another tab, is
     forgotten, so a record added again later does not come back open. */
  const swkHeld = new Set((State.sarawakExposure || []).map(swkRecordId));
  document.querySelectorAll('#views details > summary[id^="swk-rec-"]').forEach(sm => {
    if (sm.parentElement.open) swkOpenRecords.add(sm.id); else swkOpenRecords.delete(sm.id);
  });
  [...swkOpenRecords].forEach(k => { if (!swkHeld.has(k)) swkOpenRecords.delete(k); });
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  /* The one head every product page wears (pageHead, 36-layouts.js); the
     watch's own name is its tab in the header above. */
  wrap.append(pageHead({ title: 'Companies with material exposure to the Sarawak economy',
    lede: 'The Bursa companies that operate in Sarawak, and what you record about them.',
    note: 'Inclusion is descriptive and does not indicate preference. This is a research collection, not a recommended-stock list, and nothing here is ordered by merit.' }));

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
      /* Whole words, the heading taking the wrap: squeezed beside a long
         heading at 1280, "none yet" broke as "non" over "e yet". */
      el('span', { class: 'metaline', style: 'margin-left:auto;flex:none;white-space:nowrap' },
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
      /* D6, once a column: closes and the 200-day gap are the reader's own
         (Unavailable while none is held); no statements are held. */
      el('th', { style: i === 1 || i === 2 ? 'text-align:left' : null }, i === 3 || i === 4
        ? [h, kindTh(flagged.some(x => trackedHistory?.series?.[x.symbol]) ? 'yours' : 'unavailable', 'Closes you supplied')]
        : i === 5 ? [h, kindTh('unavailable', 'No statements held for these companies')] : h)))));
    const rb = el('tbody');
    [...flagged].sort((a, b) => String(a.symbol).localeCompare(String(b.symbol))).forEach(i => {
      const series = trackedHistory?.series?.[i.symbol] || null;
      const t = series ? trendContext(series, { ohlc: trackedHistory?.ohlc?.[i.symbol] || null }) : null;
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
  /* Add and Remove redraw the page. Add keeps focus on itself, by id; Remove
     takes it with the record it removes, so focus moves to the record that
     took its place, or the one before it, or back to Add when none is left.
     Both called render() and dropped the keyboard on <body>. */
  addRow.append(el('button', { class: 'btn', id: 'swk-add', onclick: () => {
    const co = candidates.find(x => x.id === coSel.value);
    if (!co) return;
    /* The list as it is now, not as it was drawn: another tab's record lands
       in State between the two (70-property.js), and appending to the drawn
       copy wrote it away. */
    const cur = State.sarawakExposure || [];
    if (cur.some(r => r.id === co.id && r.theme === thSel.value)) { toast('Already recorded under that theme'); return; }
    State.sarawakExposure = [...cur, { id: co.id, tk: co.tk, name: co.name,
      theme: thSel.value, fields: {}, evidence: 'user', source: co.source,
      hasFundamentals: co.hasFundamentals,
      /* The reader's calendar day, not UTC's: before 08:00 in Kuching the UTC
         date is yesterday's. caseRaisedAt formats on the local clock. */
      added: caseRaisedAt(new Date()).slice(0, 10) }];
    saveExposures(); toast(`${co.tk} added — the ${EXPOSURE_FIELDS.length} exposure fields are still empty`); renderKeepFocus();
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
      /* OPEN STAYS OPEN. Add and Remove redraw the page, and every record
         came back closed: a reader halfway through one company's fields who
         added the next found the first shut, and had to find it and open it
         again to go on. The view reads which were open off the page it
         replaces (swkOpenRecords, at its top). */
      const det = el('details', { style: 'border-top:1px solid var(--line);padding:10px 0',
        open: swkOpenRecords.has(swkRecordId(rec)) ? '' : null });
      /* Both numbers on the summary line, never averaged into one. A record can
         be fully written and entirely unsourced, and a reader has to be able to
         see that without opening it. */
      /* EDITS UPDATE THE RECORD IN PLACE. The sourcing fields used to call
         render(), which rebuilt the page with this record closed and focus on
         the body — so filling the three in order meant reopening it after
         each — while the eleven exposure fields saved without any update, and
         the summary's "% of fields recorded" stayed at whatever it was when
         the page was drawn. Every figure that depends on a field is now a
         node this closure rewrites. */
      const pctNode = el('span', { class: 'metaline' });
      const sumChip = el('span', { style: 'margin-left:8px' });
      const metaChip = el('span', { style: 'margin-left:auto' });
      const basisNote = el('p', { class: 'metaline', style: 'margin-top:4px' });
      const staleNote = el('p', { class: 'metaline', style: 'margin-top:8px;color:var(--bronze)' });
      /* An edit is written to the record as it is held NOW. The list is read
         again when another tab saves it, so the object this page was drawn
         from can be a copy the save no longer contains — an edit made only
         to it would be lost without a word. Same company, same theme: the
         pair Add will not record twice. */
      const same = (r) => r.id === rec.id && r.theme === rec.theme;
      const write = (change) => {
        change(rec);
        const live = (State.sarawakExposure || []).find(same);
        if (live && live !== rec) change(live);
        saveExposures(); paint();
      };
      const paint = () => {
        const s = exposureSourcing(rec);
        pctNode.textContent = `  ${theme?.label} · ${exposureCompleteness(rec)}% of fields recorded`;
        sumChip.className = s.score === 100 ? 'chip chip-ok' : 'chip chip-bronze';
        sumChip.textContent = s.score === 100
          ? `sourced${rec.basis && rec.basis !== 'unstated' ? ' · ' + rec.basis : ''}`
          : `${s.missing.length} sourcing gap${s.missing.length === 1 ? '' : 's'}`;
        metaChip.className = s.score === 100 ? 'chip chip-ok' : 'chip chip-bronze';
        metaChip.textContent = s.score === 100 ? 'sourced, dated and classified' : s.missing.join(' · ');
        basisNote.textContent = (EXPOSURE_BASIS.find(b => b.id === (rec.basis || 'unstated')) || EXPOSURE_BASIS[2]).note;
        const age = exposureStale(rec);
        staleNote.textContent = age != null && age > 365
          ? `Last verified ${Math.floor(age / 30)} months ago. An order book or a project status moves faster than that.` : '';
        staleNote.style.display = staleNote.textContent ? '' : 'none';
      };
      det.append(el('summary', { id: swkRecordId(rec), style: 'cursor:pointer' }, [
        el('span', { style: 'font-weight:600' }, `${rec.tk} — ${rec.name}`),
        pctNode, sumChip,
      ]));
      /* How it was established, before what it says. A reader scanning the
         record should meet the sourcing first — it qualifies everything below
         it, and putting it at the bottom would make it a footnote to claims
         they have already read. */
      const meta = el('div', { style: 'padding:10px;border:1px solid var(--line);border-radius:8px;margin-bottom:10px;background:var(--surface-sunk)' });
      meta.append(el('div', { class: 'row', style: 'gap:8px;align-items:baseline;margin-bottom:8px' }, [
        el('h4', { class: 'eyebrow', style: 'margin:0' }, 'How this was established'),
        metaChip,
      ]));

      EXPOSURE_META.forEach(f => {
        const row = el('div', { class: 'field', style: 'margin-top:8px' });
        row.append(el('label', {}, f.label));
        const inp = f.kind === 'date'
          ? el('input', { class: 'input', type: 'date', value: rec.verified || '', 'aria-label': f.label })
          : el('textarea', { class: 'input', rows: '2', placeholder: 'Not recorded', 'aria-label': f.label });
        if (f.kind !== 'date') inp.value = rec[f.k] || '';
        inp.addEventListener('change', () => write(r => { r[f.k] = inp.value; }));
        row.append(inp);
        row.append(el('p', { class: 'metaline', style: 'margin-top:4px' }, f.hint));
        meta.append(row);
      });

      const basisRow = el('div', { class: 'field', style: 'margin-top:8px' });
      basisRow.append(el('label', {}, 'Exposure classification'));
      const basisSel = el('select', { class: 'select', 'aria-label': 'Exposure classification' });
      EXPOSURE_BASIS.forEach(b => basisSel.append(el('option', { value: b.id,
        selected: (rec.basis || 'unstated') === b.id ? '' : null }, b.label)));
      basisSel.addEventListener('change', () => write(r => { r.basis = basisSel.value; }));
      basisRow.append(basisSel);
      basisRow.append(basisNote);
      meta.append(basisRow);
      meta.append(staleNote);
      det.append(meta);

      EXPOSURE_FIELDS.forEach(f => {
        const row = el('div', { class: 'field', style: 'margin-top:8px' });
        row.append(el('label', {}, f.label));
        const ta = el('textarea', { class: 'input', rows: '2', placeholder: 'Not recorded',
          'aria-label': f.label });
        ta.value = rec.fields?.[f.k] || '';
        ta.addEventListener('change', () => write(r => { r.fields = { ...(r.fields || {}), [f.k]: ta.value }; }));
        row.append(ta);
        det.append(row);
      });
      det.append(el('div', { class: 'row', style: 'margin-top:10px;gap:8px' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
          /* By company and theme in the list as it is now, not by position
             in the list as it was drawn — see Add. */
          const cur = State.sarawakExposure || [];
          const at = cur.findIndex(same);
          const left = cur.filter(r => !same(r));
          const next = at < 0 ? null : left[at] || left[at - 1] || null;
          State.sarawakExposure = left; saveExposures(); render();
          document.getElementById(next ? swkRecordId(next) : 'swk-add')?.focus();
        } }, 'Remove'),
        el('span', { class: 'metaline' }, `Added ${rec.added}. If a field is blank it is unresearched, not zero.`),
      ]));
      paint();
      list.append(det);
    });
    wrap.append(list);
  }

  wrap.append(el('p', { class: 'metaline' },
    'Exposure that cannot be quantified should be recorded as qualitative with the limitation stated, rather than left to imply a number nobody has.'));
  return wrap;
};

/* INCLUDED PROPERTY REPORTS ARE COUNTED. A plan that includes two a month
   used to unlock every report for every deal — any allowance above nought
   was read as unlimited. They are now metered the way company reports are:
   per calendar month, by project, and reopening one already used this month
   never costs another. Spent only when the reader chooses to use one, not
   on browsing, so looking at a deal does not use up the month. */
/* The reader's calendar month (meterMonth, 05-plans.js), as the company
   report meter counts it. This keyed on toISOString — the UTC month — so in
   Kuching the month's used reports went on counting until 08:00 on the 1st,
   and a reader who had used them was told none were left. */
State.propertyReportLog = store.read('propertyReportLog', { month: meterMonth(), ids: [] });
function propertyReportLogNow(now = new Date()) {
  const month = meterMonth(now);
  if (State.propertyReportLog?.month !== month) State.propertyReportLog = { month, ids: [] };
  return State.propertyReportLog;
}
const propertyReportsLeft = () => Math.max(0, num0(lim('propertyReports')) - propertyReportLogNow().ids.length);
const propertyReportUnlocked = (id) =>
  State.propertyReportsBought.includes(id) || (num0(lim('propertyReports')) > 0 && propertyReportLogNow().ids.includes(id));
function usePropertyReport(id) {
  const log = propertyReportLogNow();
  if (log.ids.includes(id)) return true;
  if (!(propertyReportsLeft() > 0)) return false;
  State.propertyReportLog = { ...log, ids: [...log.ids, id] };
  store.write('propertyReportLog', State.propertyReportLog);
  return true;
}

/* THE CONTROL BEING USED SURVIVES THE REDRAW.
   Every control on these pages saves and calls render(), which replaces the
   page — and the control that had focus went with it. Focus fell to <body>:
   a price typed and Tabbed past left the keyboard at "Skip to content" at the
   top of the page, an evidence grade changed with an arrow key could not be
   changed again, and a checklist answer, an area-screen layer, Undo and every
   Cash Wheel field did the same. renderKeepFocus (40-views-discover.js)
   returns focus to the new control with the same id, and each control that
   redraws carries one. A typed field is redrawn a tick later, once Tab has
   moved focus on, so focus lands where the reader went rather than back on
   the field they left. */
const renderAfterTyping = () => setTimeout(renderKeepFocus, 0);
/* Whether the borrower's financing disclosure is open — see its <details>. */
let borrowerPanelOpen = false;
/* Whether the Summary table's drawer is open (N3), held as the borrower's is;
   and the copy-link note under its ⓘ. */
let propertySummaryOpen = false;
let copyLinkNoteOpen = false;
/* What the calculator's "record what you observed" form holds before Record —
   see the form. */
let observationDraft = null;

/* A SENTENCE IN A TABLE CELL WRAPS BETWEEN WORDS, NEVER INSIDE ONE.
   The grade's "Basis" column and the financing components' carried .caption,
   whose overflow-wrap:anywhere (styles.css, for 62-letter XBRL tags) takes a
   column's narrowest width down to one letter. Beside three columns that do
   not wrap, a phone gave each Basis cell that width: at 390px it was 58px,
   "transacted", "property", "modelled" and "checklist" were cut in two
   and one cell ran to 720px tall. 'normal' keeps each word whole and 12rem is
   a measure a sentence can be read at; the table scrolls in its .tablewrap,
   as the IPS tables (IPS_PROSE_CELL, 79-ips-views.js) already do. */
const PROPERTY_PROSE_CELL = 'text-align:left;white-space:normal;overflow-wrap:normal;min-width:12rem';

/* The one-page answer's four metric cards, in the order a reader decides
   in, each with its level and the inputs its figure is worked from (its
   badge: labTileKind, 82-property-lab.js) — the Lab's tiles' own lists for
   the two they share. */
const PC_ANSWER_CARDS = [
  { key: 'safe', level: 1, rests: ['price', 'downPct', 'ratePct', 'tenureYears', 'maintenance'] },
  { key: 'monthly', level: 1, rests: ['price', 'downPct', 'ratePct', 'tenureYears', 'rent', 'vacancyPct', 'maintenance'] },
  { key: 'complete', level: 2, rests: ['price', 'downPct'] },
  { key: 'breakeven', level: 2, rests: ['price', 'downPct', 'ratePct', 'tenureYears', 'vacancyPct', 'maintenance'] },
];
/* Each card's figure, by the model's own name, for the objective's lead
   (PROPERTY_OBJECTIVES, 70-property.js): with an objective chosen a card
   leads (L1) when its figure is one of the two the objective leads with,
   and qualifies (L2) otherwise; with none, the levels above. */
const PC_ANSWER_FIELD = { safe: 'safeCashRequired', monthly: 'cashflowMonthly', complete: 'cashStillRequiredToComplete', breakeven: 'breakEvenRent' };
function pcAnswerLevel(d, t) {
  const o = dealObjective(d);
  if (!o.id) return t.level;
  return o.tiles.slice(0, 2).includes(PC_ANSWER_FIELD[t.key]) ? 1 : 2;
}
/* THE CALCULATOR'S ACTION BAR ON A PHONE (the layout system, under 640px,
   in its dock): Analyse — the one-page answer, the figures and the grade;
   Compare — the Scenarios section; Save this — what the model bar's Save
   does, while there is anything to save. */
function propertyBarActions() {
  const d = State.deal, st = propertyStatus(d);
  const can = st.kind !== 'model' || st.dirty;
  return [
    { id: 'ls-act-analyse', label: 'Analyse', icon: 'chart', aria: 'Analyse: the figures and the grade', onclick: () => lsGoTo(document.getElementById('pc-answer'), document.getElementById('pc-answer-h')) },
    { id: 'ls-act-compare', label: 'Compare', icon: 'scale', aria: 'Compare scenarios', onclick: () => goToPropertySection('scenarios', { focus: '#pm-sc-title' }) },
    { id: 'ls-act-save', label: 'Save this', icon: 'bookmark', primary: true, disabled: !can,
      aria: !can ? 'Saved in this browser' : st.kind === 'model' && st.sc ? 'Save this scenario' : 'Save this property',
      said: 'Saved in this browser — change a figure to save it again.', onclick: () => { if (saveActiveProperty()) renderKeepFocus(); } },
  ];
}
VIEWS.property = () => {
  /* A section the address names (#scenarios), read before this page writes
     its own address, which carries none (71-property-models.js). */
  propertyArrivalSection();
  /* The address is read when it is new — a link, a bookmark, Back — and not on
     every render, which is what used to undo an edit on /property and a Resume
     or Reset on either path. */
  const arrival = arrivePropertyUrl();
  if (arrival.changed) store.write('deal', State.deal);
  /* Said as it happened: a link or Back, and where what it replaced went —
     the slot, or, when the slot already held work kept nowhere else, My
     properties (propertyArrivalNote, 71-property-models.js). */
  if (arrival.replaced) { const note = propertyArrivalNote(arrival); setTimeout(() => toast(note), 0); }
  const d = State.deal;
  const m = dealModel(d);
  /* The kind of the page's results (D6), once: the weakest input they rest
     on (dealKind, 82-property-lab.js); the cash's, with the fee lines. */
  const DK = dealKind(d, m), DKF = dealKind(d, m, { fees: true });
  const paid = propertyReportUnlocked(d.projectId);
  const wrap = el('div', { class: 'ls-page pc-page' });

  /* The one head every product page wears (pageHead, 36-layouts.js). Its
     second line — what the model covers — is a drawer under it (N3, D18):
     the top of the page is the deal and its answer, the method a tap away. */
  wrap.append(pageHead({ title: 'Turn a property into a financial model', lede: 'What owning this property would do to your cash, from the figures you enter.' }));
  wrap.append(el('details', { class: 'pc-more pc-more-page' }, [
    el('summary', { class: 'pc-more-sum' }, 'What this calculator models'),
    el('p', { class: 'pc-more-body' }, 'Most property tools show you what things sold for. This models true acquisition cost, financing, vacancy, maintenance, exit costs and tax — then compares the result against putting the same money into equities.')]));

  /* The regulated claim leads and is never hidden at any width: in Malaysia an
     official valuation requires a registered valuer, and this is not one. The
     qualifying detail follows in a span that collapses on a phone — the part a
     reader must not miss is the first sentence, and burying that to win fold
     space would be trading the wrong thing for it. */
  const disc = el('div', { class: 'ls-disclosure', style: 'margin-bottom:var(--md)' });
  disc.append(el('div', { class: 'row row-wrap', style: 'gap:10px' }, [
    el('span', { class: 'chip chip-bronze' }, 'Not a valuation'),
    el('p', { class: 'body', style: 'font-size:var(--ls-support);flex:1 1 320px' }, [
      'Not an official property valuation — in Malaysia that must be carried out by a registered valuer.',
      el('span', { class: 'fold-phone' },
        ' This is an investment estimate built from your inputs and sample transaction data. Figures are scenarios, not predictions.'),
    ]),
  ]));
  wrap.append(disc);

  /* WHICH PROPERTY THIS IS, AND THE PAGE'S ONE PRIMARY ACTION.
     The work bar saved snapshots of the deal, and nothing said whether what
     was on screen was saved, or as what. The bar (71-property-models.js) says
     which property is being edited and whether it has changed since it was
     saved, and its primary action is the next one: Save this property until
     it is saved, then Compare scenarios. "New property" starts from the
     seeded defaults rather than blank fields — a calculator with no price,
     rent or tenure is not a fresh start, it is a model that produces nothing
     — with `touched` and `evidence` cleared, so every figure is honestly an
     illustrative default again; and work kept nowhere else is kept aside
     before it is replaced. The report paywall's buttons at the page's end
     were once its only filled ones, 15,000px down. */
  wrap.append(propertyModelBar(d));
  /* THE TWO QUESTIONS AND THE OBJECTIVE (the property decision layer, P1;
     83-property-decision.js), before every other field: what is bought and
     how select the model, and the objective which figures lead. Written to
     the deal as any field here is. */
  wrap.append(propertyQuestions({ d, prefix: 'pc', answer: (k, v) => { if (pqWriter(k, v)(d)) { saveDeal(); renderKeepFocus(); } } }));
  /* The five sections below, reached from wherever the page is scrolled to. */
  wrap.append(propertySectionIndex());

  /* Stated once, at the top, while any figure that drives the model is still a
     seeded number. "Built from your inputs" in the line above is only true once
     the inputs are the reader's. */
  /* ---- the one-page answer (specification 27.3) ------------------------ */
  /* First on the page, and deliberately not the gross yield. Gross yield
     ignores vacancy, maintenance, financing and every acquisition cost, which
     makes it the most flattering number here and the least informative. */
  const g = propertyGrade(d, m);
  const gradeTone = { A:'--ok-text', B:'--bronze', C:'--bronze', D:'--dn-text', U:'--ink-2' }[g.grade];
  const onePage = el('section', { class: 'card ls-section pc-answer', id: 'pc-answer', 'aria-labelledby': 'pc-answer-h', style: `border-left:3px solid var(${gradeTone})` });

  /* THE MONEY, FIRST, AND ONCE (N3, the owner's decision D18).
     The card opened on a letter grade and a score, and the figures that
     decide whether somebody can do this at all — what leaves the account,
     what is needed to be safe, what it costs to hold each month — sat below
     the fold on a phone behind the grade, the verdict and the gates; a strip
     of three put them first. Then the page said them three times: the strip,
     the four tiles under the gates, and the Summary table under the card.
     They are said once now, here, at the card's top: four tiles, each with
     what it means. A grade answers "is this a good deal". These answer "can
     I". The Summary table is a drawer below, for the reader's language. */
  /* What is still to be paid, as the decision record and the ledger's "Cash
     still to complete" both say. This printed the whole completion figure,
     booking deposit included, so with RM5,000 paid at offer the page read
     "Cash to complete RM95.3k — Paid out on completion day" and the record
     carried out of the browser read RM90,254 under the same name. And a safe
     cash that is short says so: "Including the reserve" when the reserve was
     the line that could not be priced — a tenure of 0 left it out of the
     total and the tile said it was in. A short total says it is short, as
     the ledger's does. */
  const answers = el('div', { class: 'grid g-4 pc-answers' });
  const unpricedLines = m.missingCostLines || [];
  /* THE SYSTEM'S METRIC CARDS (37-layout-system.js): the safe cash and the
     month are the decision (L1, first and at the card-metric size), the
     cash to complete and the break-even rent qualify them (L2); each with
     its data badge — what its figures rest on, in the Lab's tiles' words
     (labTileKind), the lowest-ranked input it is worked from. */
  const answerFigs = {
    /* While any fee line is not Verified, the headline says how much of
       it rests on those lines (the fee rulebook, 70-property.js); the
       ledger below names them. */
    safe: ['Safe cash required', fmtAmount(m.safeCashRequired, 'MYR'),
      (unpricedLines.length
        ? `So far — short by ${unpricedLines.length === 1 ? 'a line' : `${unpricedLines.length} lines`} that could not be priced: ${unpricedLines.map(x => x.label.toLowerCase()).join(', ')}`
        : 'Including rent-ready and the reserve')
      + (m.unconfirmedCost > 0 ? `. ${feeUncertainHeadline(m)}` : '')],
    monthly: ['Monthly position', isNum(m.cashflowMonthly) ? fmtAmount(m.cashflowMonthly, 'MYR') : '—',
      m.annualOwnerSubsidy > 0 ? `Costs you ${fmtAmount(m.annualOwnerSubsidy, 'MYR')} a year to hold` : 'After vacancy and normal costs',
      isNum(m.cashflowMonthly) && m.cashflowMonthly < 0 ? '--dn-text' : null],
    complete: ['Cash to complete', fmtAmount(m.cashStillRequiredToComplete, 'MYR'),
      m.cashAlreadyPaid > 0 ? `Paid out on completion day, after ${fmtAmount(m.cashAlreadyPaid, 'MYR')} paid at offer` : 'Paid out on completion day'],
    breakeven: ['Break-even rent', isNum(m.breakEvenRent) ? fmtAmount(m.breakEvenRent, 'MYR') : '—',
      isNum(m.breakEvenOccupancy) ? `or ${fmtPct(m.breakEvenOccupancy, 0)} occupancy at the entered rent` : 'not computable'],
  };
  /* The objective decides which lead (PC_ANSWER_LEAD): the cards keep
     their places, and only their weight follows it. */
  for (const t0 of PC_ANSWER_CARDS) {
    const t = { ...t0, level: pcAnswerLevel(d, t0) };
    const [l, v, s, tone] = answerFigs[t.key];
    const card = el('div', { class: `panel ls-card ls-l${t.level}`, 'data-card': 'metric', 'data-level': String(t.level), 'data-answer': t.key },
      statTile(l, v, { sub: s, tone }));
    card.append(labTag(labTileKind(d, t.rests), { fees: (t.key === 'safe' || t.key === 'complete') && m.unconfirmedCost > 0 }));
    answers.append(card);
  }
  onePage.append(answers);

  onePage.append(el('div', { class: 'row row-wrap', style: 'gap:12px;align-items:baseline;margin-top:var(--md)' }, [
    el('div', {}, [
      /* The card's heading. It was a paragraph, so the page went from its h1
         straight to the h4 below ("Why this cannot be graded") — the first
         heading a screen reader met after the title skipped two levels. */
      el('h3', { class: 'eyebrow', id: 'pc-answer-h', style: 'margin-bottom:2px' }, 'QT Property Underwriting Grade'),
      el('div', { class: 'row', style: 'gap:10px;align-items:baseline' }, [
        el('span', { class: 'num', style: `font-size:var(--ls-metric);font-weight:700;color:var(${gradeTone})` }, g.grade),
        el('span', { style: 'font-size:var(--ls-body);font-weight:600' }, g.verdict),
        kindBadge(kindFirst([DK.kind, 'modelled']), { fine: `The grade, on ${DK.fine.toLowerCase()} figures` }),
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
  /* Why a class that can never be graded is not graded: the pillars that do
     not apply, and the ceiling they leave — not a shortfall in evidence the
     reader could make up. */
  const notApplying = g.pillars.filter(p => p.applies === false).map(p => p.label.toLowerCase());
  const withheldBecause = g.classUngradeable
    ? `${notApplying.join(' and ')} ${notApplying.length === 1 ? 'does' : 'do'} not apply to a ${String(PROPERTY_CLASSES[m.propertyClass]?.label || '').toLowerCase()} class, so at most ${fmtPct(g.reachable * 100, 0)} of the framework weight can ever be scored, against the 80% a grade requires — no further evidence changes that`
    : g.coverage < 0.80 ? `only ${fmtPct(g.coverage * 100, 0)} of the framework weight could be scored, against the 80% a grade requires`
    : 'a hard gate below is unmet';
  /* What the grade is not, in sight: the methodology that says how it is
     reached — "the score and the grade are not the same claim…" — is in the
     pillars' drawer below (N3), beside the table it explains. */
  onePage.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'A research grade on the evidence entered. Not a bank decision, not a valuation, and not legal clearance — each of those is a named professional, and the questions below say which.'));

  /* The owner subsidy stated as a commitment rather than a monthly minus —
     over five and ten years; the year's figure is the Monthly position
     tile's, above. */
  if (m.annualOwnerSubsidy > 0) onePage.append(el('p', { class: 'body', style: 'font-size:var(--ls-support);margin-top:var(--sm);color:var(--dn-text)' },
    `This property does not pay for itself. Holding it is paid from your own income — ${fmtAmount(m.annualOwnerSubsidy * 5, 'MYR')} over five years and ${fmtAmount(m.annualOwnerSubsidy * 10, 'MYR')} over ten, before any major repair. That can be a deliberate choice on an appreciation case; it is not an income property.`));

  if (g.gates.length) {
    /* THE ONE THAT DECIDES IT IN SIGHT, EVERY ONE A TAP AWAY (N3).
       Every blocker was listed at equal weight, so eleven items competed and
       the critical one read like the eleventh; then three stood in full and
       the rest behind "Show all", 60-odd words before the first field.
       Severity orders them: the most serious stays in sight on one line,
       and the whole list — each with who confirms it — is the drawer. */
    const rank = { critical: 0, serious: 1, warning: 2 };
    const ordered = [...g.gates].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
    const worst = ordered[0];
    onePage.append(el('p', { class: 'pc-worst' }, [
      el('span', { class: worst.severity === 'critical' ? 'chip chip-bronze' : 'chip' }, worst.severity === 'critical' ? 'Blocking' : 'Most serious'),
      ' ', el('span', { class: 'pc-worst-text' }, worst.text)]));
    /* Named for the grade it sits under. Every graded result read "Why this
       is conditional", so a D — "Does not meet the selected underwriting
       criteria" — and an A that "Meets" them both called their findings
       conditions. Conditional is the B verdict's word and only B's. A class
       that cannot be graded is not ungraded because of these, and clearing
       them would not grade it — the sentence above says why. */
    const named = g.classUngradeable ? 'Still to check'
      : { U: 'Why this cannot be graded', B: 'Why this is conditional', A: 'Still to check' }[g.grade] || 'Why this falls short';
    const gateLine = (x) => el('li', { class: 'evidence counter', style: 'font-size:var(--ls-support)' }, [
      el('span', { class: x.severity === 'critical' ? 'chip chip-bronze' : null,
        style: x.severity === 'critical' ? 'margin-right:6px' : 'display:none' }, 'Blocking'),
      x.text + (x.who ? ` Confirm with: ${x.who}.` : ''),
    ]);
    const more = el('details', { class: 'pc-more pc-blockers' });
    more.append(el('summary', { class: 'pc-more-sum' },
      `${named}: ${g.gates.length === 1 ? 'the one blocker or assumption' : `all ${g.gates.length} blockers and assumptions`}`));
    more.append(el('ul', { style: 'list-style:none;padding:0;display:flex;flex-direction:column;gap:6px;margin-top:8px' }, ordered.map(gateLine)));
    onePage.append(more);
  }

  /* THE CASH WATERFALL — where the completion figure comes from.
     "Cash to complete RM95.3k" is the number a reader has to raise, and it was
     a total with no decomposition on the first screen: the parts were in a cost
     table much further down, grouped by category rather than shown as a sum. */
  if (isNum(m.transactionCash) && m.transactionCash > 0) {
    const wf = el('details', { class: 'pc-more' });
    wf.append(el('summary', { class: 'pc-more-sum' },
      `Where ${fmtAmount(m.safeCashRequired, 'MYR')} of safe cash goes`));
    /* The cost groups already include the improvement costs and the reserve.
       Two further rows for them counted both twice, so the parts of RM130.1k
       added to RM165.1k and every bar was drawn against the wrong total. */
    const steps = (m.costGroups || []).map(grp => [grp.label,
        grp.items.reduce((a, it) => a + (isNum(it[1]) ? it[1] : 0), 0)])
      .filter(([, v]) => isNum(v) && v > 0);
    const total = steps.reduce((a, [, v]) => a + v, 0) || 1;
    const bars = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:var(--md)' });
    steps.forEach(([label, v]) => {
      bars.append(el('div', {}, [
        el('div', { class: 'row', style: 'gap:8px;justify-content:space-between' }, [
          el('span', { style: 'font-size:var(--ls-support)' }, label),
          el('span', { class: 'num', style: 'font-size:var(--ls-support);font-weight:600' }, fmtAmount(v, 'MYR')),
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
  const untouched = evidenceDriversFor(d).filter(k => shownEvidence(d, k) === 'illustrative_default');
  if (untouched.length) {
    const warn = el('div', { style: 'margin-top:var(--md);padding:10px 12px;border-left:3px solid var(--bronze);background:var(--surface-2)' });
    warn.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
      el('span', { class: 'chip chip-bronze' }, 'Illustrative defaults'),
      el('p', { class: 'body', style: 'font-size:var(--ls-support);flex:1 1 320px;margin:0' },
        `${untouched.map(k => ptr(`in.${k}`, k).replace(/\s*\(.*\)$/, '').toLowerCase()).join(', ')} ${untouched.length === 1 ? 'is' : 'are'} still the number this tool opened with. Nobody chose ${untouched.length === 1 ? 'it' : 'them'} for this property and no market was consulted — replace ${untouched.length === 1 ? 'it' : 'them'} before relying on anything below.`),
    ]));
    if (d.city !== 'kuching') warn.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      `These defaults were written around a Kuching condominium. They are not a starting point for ${(SARAWAK_CITIES.find(c => c.id === d.city) || {}).name || 'this location'}, and this tool holds no transacted price or rent for it.`));
    onePage.append(warn);
  }

  /* Pillars, so the grade decomposes rather than being taken on trust — and
     the methodology that reads them, beside them. */
  const pw = el('details', { class: 'pc-more' });
  pw.append(el('summary', { class: 'pc-more-sum' }, 'How this grade was reached'));
  if (g.grade === 'U' && isNum(g.score)) pw.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `The score and the grade are not the same claim. The score is weighted only across the pillars that could be tested; the grade is withheld because ${withheldBecause}.`));
  const pt = el('table', { class: 'dt', style: 'margin-top:8px' });
  pt.append(el('thead', {}, el('tr', {}, ['Pillar', 'Weight', 'Score', 'Basis'].map((h, i) =>
    el('th', { style: i === 0 || i === 3 ? 'text-align:left' : null }, h)))));
  const pb = el('tbody');
  g.pillars.forEach(p => pb.append(el('tr', {}, [
    el('td', { style: 'text-align:left' }, p.label),
    el('td', { class: 'num' }, `${p.weight}%`),
    el('td', { class: 'num' }, isNum(p.score) ? String(p.score)
      : el('span', { class: 'caption' }, p.applies === false ? 'does not apply' : 'not tested')),
    el('td', { class: 'caption', style: PROPERTY_PROSE_CELL }, p.note || ''),
  ])));
  pt.append(pb);
  pw.append(el('div', { class: 'tablewrap' }, pt));
  pw.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    /* Counted from the registry rather than written out. The sentence said
       "all seven" against six pillars — a number in prose beside the list it
       describes will eventually disagree with it. */
    `The score is weighted across the pillars that could be tested, not across all ${GRADE_PILLARS.length} — a pillar with no evidence reduces coverage rather than scoring zero, so nothing loses points for data nobody has. Coverage is ${fmtPct(g.coverage * 100, 0)} of the framework weight; an A needs 90% and a B needs 80%.`
    /* And where the class rules pillars out, the ceiling that leaves — a
       cash parcel can reach a B and never an A, a financed one no grade. */
    + (notApplying.length
      ? ` For this class ${notApplying.join(' and ')} ${notApplying.length === 1 ? 'does' : 'do'} not apply, so ${fmtPct(g.reachable * 100, 0)} is the most that can be scored${g.reachable < 0.80 ? ' — short of the 80% any grade needs' : g.reachable < 0.90 ? ' — short of the 90% an A needs' : ''}.`
      : '')));
  onePage.append(pw);
  wrap.append(onePage);

  /* ---- financing readiness (specification 30) -------------------------- */
  const b = State.borrower;
  const lr = loanReadiness(b, m);
  const pf = propertyFinanceability(d, m);
  const finCard = el('div', { class: 'card ls-section' });
  finCard.append(cardHead('Can this be financed?',
    'Three separate questions. Collapsing them into one percentage would hide the one that is actually blocking.', null, DK));

  const trio = el('div', { class: 'grid g-3' });
  trio.append(el('div', { class: 'panel ls-fig' }, statTile('Borrower Loan Readiness',
    b.assessed && isNum(lr.score) ? `${lr.score}/100` : '—',
    { sub: b.assessed ? lr.band : 'Loan readiness not assessed' })));
  trio.append(el('div', { class: 'panel ls-fig' }, statTile('Property Financeability',
    isNum(pf.score) ? `${pf.score}/100` : '—',
    { sub: pf.gates.length ? `${pf.gates.length} item${pf.gates.length === 1 ? '' : 's'} to verify first` : 'No blocking item recorded' })));
  trio.append(el('div', { class: 'panel ls-fig' }, statTile('Modelled financing coverage',
    isNum(m.financingCoverageOfPrice) ? fmtPct(m.financingCoverageOfPrice, 1) : '—',
    { sub: m.financingBasisConfirmed ? 'of the price, on the entered valuation' : 'modelled, not lender-confirmed' })));
  finCard.append(trio);

  /* The sentence this section exists to make unmissable. */
  finCard.append(el('p', { class: 'body', style: 'font-size:var(--ls-support);margin-top:var(--md)' },
    b.assessed && isNum(lr.score)
      ? `Loan Readiness ${lr.score}/100 is a diagnostic score, not a ${lr.score}% chance of approval. No approval probability is offered anywhere in this product, because calculating one honestly would need a lender's own record of applications and outcomes, and nobody outside a lender has that. Each lender applies its own credit policy and its own final assessment.`
      : b.assessed
        ? `No Loan Readiness total is shown while ${lr.unknowns.filter(u => u === 'credit conduct' || u === 'affordability').join(' and ') || 'a critical item'} is open — a partial score would hide the gap inside it.`
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
  /* Open across a redraw once the reader has opened it. Every field inside
     saves and redraws, and the disclosure came back closed — so focus, which
     renderKeepFocus hands to the rebuilt field by id, had nowhere to go: a
     field inside a closed <details> cannot take it, and it fell to <body>
     after each figure, with the section shut on the reader. Held in memory
     only, like the rest of what is open on the page. */
  const bd = el('details', { style: 'margin-top:var(--md)', open: borrowerPanelOpen ? '' : null });
  bd.addEventListener('toggle', () => { borrowerPanelOpen = bd.open; });
  bd.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
    b.assessed ? 'Your financing position — entered' : 'Assess your loan readiness'));
  bd.append(el('p', { class: 'metaline', style: 'margin:8px 0' },
    'Held in this browser under its own key, never written into the page address, never included in the property export, and never used for anything but this calculation. It does not reach the equity research anywhere in this product — the same analysis is shown to everyone regardless of their circumstances, and that is deliberate.'));

  const bnum = (k, label, step) => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', { for: `b-${k}` }, label));
    f.append(el('input', { class: 'input input-inline', id: `b-${k}`, type: 'number', step: step || 100,
      value: String(b[k] ?? 0), style: 'text-align:right',
      onchange: e => {
        /* Empty is not nought here either: a cleared debt box read as no
           existing debt, and affordability improved by whatever had been in it. */
        if (String(e.target.value).trim() === '') {
          e.target.value = String(b[k] ?? 0);
          toast(`An empty box is not zero — it stays at ${num0(b[k])}. Type 0 if you mean nought.`);
          return;
        }
        b[k] = num0(e.target.value); b.assessed = true; saveBorrower(); renderAfterTyping();
      } }));
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
    onchange: e => { b.creditReview = e.target.value; b.assessed = true; saveBorrower(); renderKeepFocus(); } });
  CREDIT_STATES.forEach(c => crSel.append(el('option', { value: c.id, selected: b.creditReview === c.id ? '' : null }, c.label)));
  crField.append(crSel);
  crField.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
    'Obtain your own report through Bank Negara’s eCCRIS service. This tool never asks for those credentials and cannot retrieve it for you.'));
  bd.append(crField);

  bd.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Documents gathered'));
  BORROWER_DOCS.forEach(doc => {
    const lab = el('label', { class: 'checkline', style: 'gap:8px;display:flex;margin-top:4px' });
    lab.append(el('input', { type: 'checkbox', id: `b-doc-${doc.k}`, checked: b.docs?.[doc.k] === 'provided' ? '' : null,
      onchange: e => { b.docs = { ...(b.docs || {}), [doc.k]: e.target.checked ? 'provided' : 'missing' }; b.assessed = true; saveBorrower(); renderKeepFocus(); } }));
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
      el('td', { class: 'caption', style: PROPERTY_PROSE_CELL }, c.note || ''),
    ])));
    ct.append(cb);
    bd.append(el('div', { class: 'tablewrap' }, ct));
    /* Withheld only while credit conduct or affordability is open (the band
       above). With the buffer alone open — a cost line unpriced — the tile
       showed its total and this said a total was withheld. */
    if (lr.unknowns.length) bd.append(el('p', { class: 'metaline', style: 'margin-top:8px;color:var(--bronze)' },
      `Not assessed: ${lr.unknowns.join(', ')}. ` + (isNum(lr.score)
        ? `The total is weighted over the components that were tested, and ${lr.unknowns.length === 1 ? 'this is' : 'these are'} left out of it rather than scored as nought.`
        : 'A total is withheld while any of these is open rather than presented with the gap inside it.')));
    bd.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:10px', onclick: () => {
      if (!confirm('Remove everything you entered about your income, debts and credit? There is no copy anywhere else.')) return;
      store.write('borrowerProfile', null); location.reload();
    } }, 'Erase my financing details'));
  }
  finCard.append(bd);
  /* Drawn in the Financing section, below. */

  /* Modelling states that change every figure below and cannot be inferred from
     the numbers themselves. */
  /* A tenure matters only to a loan. A cash purchase with the box at 0 has an
     instalment of nought and a reserve, and was told both were unavailable. */
  const noSchedule = !m.tenureValid && m.loan > 0;
  if (m.zeroRateModelled || noSchedule || !m.reserveComputable) {
    const flags = el('div', { class: 'card ls-section', style: 'border-left:3px solid var(--dn-text)' });
    const ul = el('ul', { class: 'ticklist' });
    if (m.zeroRateModelled) ul.append(el('li', {},
      'The loan interest rate is 0%. If that was intended, the instalment below is right; if the box was cleared, it is roughly half what it should be. This tool cannot tell the two apart from the value.'));
    if (noSchedule) ul.append(el('li', {},
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
  const regNote = el('div', { class: 'note', style: 'display:flex;flex-wrap:wrap;gap:10px;align-items:center' }, [
    el('p', { class: 'body', style: 'font-size:var(--ls-support);flex:1 1 320px;margin:0' },
      'Modelling one deal answers what it would do. Recording several answers which ones exist and what you actually know about each — the register keeps the source, the availability date, four separate prices and a next action with an owner.'),
    el('a', { class: 'btn btn-ghost btn-sm', href: href('/property/opportunities'),
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate('/property/opportunities'); } },
      'Open the opportunity register'),
  ]);

  /* THE FIVE SECTIONS, IN THE ORDER A PURCHASE IS WORKED THROUGH.
     One card held every input, "Your deal", beside one column of every
     output, so the loan's inputs sat three screens from the loan and the
     answer to "what does the rent have to be" was below the ten-question
     checklist. Each section now holds its own inputs beside what they
     produce, and opens by saying which is which (propertySection,
     71-property-models.js). Every input keeps its id, so a link, the review
     queue's "Go to it" and a redraw's focus still find it. The contracts
     name what the section asks and shows. A class with no tenancy was said
     to be "asked for no rent, vacancy or service charge" above the rent,
     vacancy and service-charge fields, which every class is shown: the line
     now says they go unused. And Report asks for the district's demand
     sources, which its line did not name. */
  const lets = PROPERTY_CLASSES[propertyClassOf(d)].letsToTenant;
  const acq = propertySection('acquisition', {
    provide: 'where the property is, what it is — its type, class, title and size — the purchase price, any bank or valuer estimate, the booking deposit already paid, the renovation and the months of reserve you mean to hold.',
    calculates: 'the cash to complete and every cost line under it — the deposit, stamp duties, legal fees and any valuation gap — the price per unit of area, and the safe cash required once the renovation and the reserve are counted.' });
  const fnc = propertySection('financing', {
    provide: 'the deposit, the loan interest rate and its tenure; any flat-rate or loan-insurance quote you were given; and, only if you choose, your own income, debts and credit record.',
    calculates: 'the loan and the value it is lent against, the monthly instalment, the loan at a 70, 80 and 90% margin of finance, what the quotes cost, and whether the borrower and the property can each be financed.' });
  const rnt = propertySection('rental', lets ? {
    provide: 'the expected rent, its growth and the vacancy allowance, the running costs — maintenance, sinking fund, assessment, quit rent, insurance, fees and a repair reserve — the management terms, and the weeks a year you would use it yourself.',
    calculates: 'the monthly position after vacancy, costs and the loan, the gross and net yield, the rent at which it breaks even, what management costs per occupied month and per tenancy, and owning it against renting it for your own weeks.' } : {
    provide: 'the running costs a parcel carries — assessment, quit rent and insurance — and the weeks a year you would use it yourself. The rent, vacancy, service-charge and management fields stay on the page, but a class with no tenancy uses none of them: nothing is computed from a rent nobody expects to receive.',
    calculates: 'what holding it costs each month, the loan included — a yield and a break-even rent are not quantities this class has, so none is computed.' });
  const scn = propertySection('scenarios', {
    provide: 'variations of this property saved as named scenarios, the exit — how long it is held, capital growth, the months and costs of selling — the return you would expect from equities instead, who is selling, and your top rate of tax if you give it.',
    calculates: 'up to three scenarios side by side — monthly position, cash required, yield, break-even rent and grade — which inputs move the rate of return most, the rate, vacancy and overrun at which it stops working, and the return and the tax on the rent over the hold.' });
  const rpt = propertySection('report', {
    provide: 'the state of each demand source you record for the district, your answers to the ten questions that decide more than the price, how each was established, and where each driving figure came from.',
    /* The client proposal is named with what it holds. "Sets it out for a
       client" followed the grade and the risk flags, which the proposal
       leaves out on purpose (72-property-proposal.js). */
    calculates: 'the grade against the methodology’s gates, the demand and environmental allowances recorded for the district, what the answer rests on, and — in the full report — the exits, the year-by-year path, the equity comparison and the risk flags; the decision record prints it. A saved property’s client proposal sets out its costs, loan, cash flow, scenarios and sale for a client, without the grade, the gates, the equity comparison or the risk flags.' });

  /* ---------- inputs ---------- */
  const rail = acq.inputs;

  /* Location first. In Sarawak the district decides the title class, the flood
     exposure and who the tenants are, and every one of those matters more to
     the outcome than the purchase price does. */
  const loc = el('div', { style: 'margin-bottom:var(--md);padding-bottom:var(--md);border-bottom:1px solid var(--line)' });
  loc.append(el('p', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'Where'));

  const cityField = el('div', { class: 'field' });
  cityField.append(el('label', { for: 'dealCity' }, ptr('in.city', 'City')));
  /* Read before the controls are built, so they render already showing what the
     link asked for. */
  /* Written on arrival too, so a bare /property/calculator becomes a link that
     reproduces what is on screen without the reader having to change anything
     first. The address itself was read at the top of the view, once, when it
     was new. */
  syncPropertyUrl(d);
  /* The address IS the share. One control to put it on the clipboard, beside
     the fields it describes, and what travels with it behind an ⓘ beside it
     (N3, D18): 62 words stood between the page's top and its first field. */
  const copyNote = el('p', { class: 'metaline pc-tip-body', id: 'property-copy-note', hidden: copyLinkNoteOpen ? null : '' },
    'The address carries every figure that differs from the default deal, its evidence grade and which ones you entered. It carries the Sarawak checklist answers too, with how each was established. Whoever opens it sees this deal — their own saved deal is kept aside, not mixed in. Your loan-readiness inputs are about you, not the deal, and do not travel.');
  const copyAbout = el('button', { type: 'button', class: 'btn btn-quiet btn-sm pc-tip', id: 'property-copy-about', 'aria-expanded': copyLinkNoteOpen ? 'true' : 'false',
    'aria-controls': 'property-copy-note', 'aria-label': 'What a link to this deal carries', title: 'What a link to this deal carries',
    onclick: () => { copyLinkNoteOpen = !copyLinkNoteOpen; copyAbout.setAttribute('aria-expanded', copyLinkNoteOpen ? 'true' : 'false'); copyNote.hidden = !copyLinkNoteOpen; } },
    el('span', { class: 'pc-tip-i', 'aria-hidden': 'true', html: icon('info', 16) }));
  loc.append(el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center;margin-bottom:10px' }, [
    el('button', { class: 'btn btn-ghost btn-sm', id: 'property-copy-link', onclick: async () => {
      try { await navigator.clipboard.writeText(location.href); toast('Link copied — it carries every input of this deal'); }
      catch { toast('Could not reach the clipboard — copy the address bar instead'); }
    } }, 'Copy a link to this deal'),
    copyAbout,
    /* Restore goes once it has restored, and focus went with it to <body>;
       it goes to Copy, which sat beside it. */
    store.read('dealBeforeLink', null) ? el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      /* The deal it replaces is kept aside in its turn when it held work kept
         nowhere else (restoreDealBeforeLink), and the toast says so. */
      if (restoreDealBeforeLink()) {
        toast(store.read('dealBeforeLink', null) ? 'Your previous deal is restored — the one it replaced is kept aside; restore again to swap back' : 'Your previous deal is restored');
        render(); focusAfterRedraw('#property-copy-link');
      }
    } }, 'Restore my previous deal') : null,
  ]));
  loc.append(copyNote);

  const citySel = el('select', { class: 'select', id: 'dealCity', onchange: e => {
    d.city = e.target.value;
    d.district = (SARAWAK_CITIES.find(c => c.id === d.city)?.districts || [''])[0];
    /* The project list is city-scoped, so a selection from the previous city is
       no longer on offer and must not stay selected behind the scenes. */
    if (!projectsForCity(d.city).some(x => x.id === d.projectId)) d.projectId = customProjectId(d.city);
    saveDeal(); syncPropertyUrl(d); renderKeepFocus();
  } });
  SARAWAK_CITIES.forEach(c => citySel.append(el('option', { value: c.id, selected: d.city === c.id ? '' : null }, c.name)));
  cityField.append(citySel);
  loc.append(cityField);

  const cityDef = SARAWAK_CITIES.find(c => c.id === d.city) || SARAWAK_CITIES[0];
  const distField = el('div', { class: 'field', style: 'margin-top:10px' });
  distField.append(el('label', { for: 'dealDistrict' }, ptr('in.district', 'District or neighbourhood')));
  const distSel = el('select', { class: 'select', id: 'dealDistrict',
    onchange: e => { d.district = e.target.value; saveDeal(); syncPropertyUrl(d); renderKeepFocus(); } });
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
  const mapWrap = el('div', { style: 'margin-top:14px' });
  if (mapAreas && Object.keys(mapAreas).length) {
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
  }

  /* What has been recorded for the selected area, and a way to add to it —
     for every town, not only the four with coordinates. The recorder sat
     inside the map's block, so Bau, Sri Aman, Sarikei and the other unmapped
     towns had none, while the empty register told the reader to record from
     here. Only the map needs coordinates; a record needs a city and a
     district, which every deal has. */
  {
    const obs = observationsFor(d.city, d.district);
    const oc = el('div', { class: 'panel ls-section', style: 'margin-top:12px' });
    oc.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' },
      `What you have recorded — ${d.district}`));

    if (!obs.total) {
      oc.append(el('p', { class: 'body', style: 'font-size:var(--ls-support)' },
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
    /* The kind and the evidence class each take the form's whole row. In a
       120px track "What you observed" showed half its label on a phone and
       "Evidence quality" lost the end of its grade. */
    const kindSel = el('select', { class:'select select-sm', style:'grid-column:1/-1;max-width:none', 'aria-label':'What you observed' });
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

    const evSel = el('select', { class:'select select-sm', style:'grid-column:1/-1;max-width:none', 'aria-label':'Evidence quality' });
    /* Every class except the tool's own seeded default. Offering only rank 2 and
       above meant the weakest thing a reader could say about a number they half
       remembered was "developer supplied" — so the dropdown made them overstate
       it. "Estimated" and "assumed" are honest answers and belong here. */
    EVIDENCE.filter(e => e.rank >= 0).forEach(e => evSel.append(el('option', { value:e.id, selected: e.id === 'user' ? '' : null }, e.label)));
    /* Today on the reader's calendar. The UTC date is yesterday's in Kuching
       until 08:00, and a record accepted with the default was dated a day
       before it was observed. caseRaisedAt formats on the local clock — the
       reader's, now: served, the page carried the render's fixed date as the
       field's (data-now, NOW in 35-ui.js), so the field is served empty. */
    const dateInp = el('input', { class:'input input-sm', type:'date',
      value: caseRaisedAt(new Date()).slice(0, 10), 'aria-label':'Date observed', 'data-now': '' });
    /* The field that decides whether this is evidence or a note. Optional at
       capture, because a number nobody records is worth less than one recorded
       without its source — but the register says which it is, permanently. */
    const srcInp = el('input', { class:'input input-sm', type:'text',
      placeholder:'Source — listing, tenancy, filing', 'aria-label':'Source reference' });
    const addrInp = el('input', { class:'input input-sm', type:'text',
      placeholder:'Address or project', 'aria-label':'Address or project' });
    /* By id, so Record keeps focus through the redraw that shows the new
       record. It called render() and left the keyboard on <body>, a page's
       length from the form the reader was working through. */
    const addBtn = el('button', { class:'btn btn-sm', id:'obs-record', onclick: () => {
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
                       /* A land sale is of land, whatever the deal on screen
                          is: it was stamped "Condominium". */
                       propertyType: k.family === 'land' ? 'Land' : d.propertyType,
                       titleType: titleSel.value || '',
                       ...(k.area === 'land'
                         ? { landSqft: sqftValue, landUnit: unitSel.value }
                         : { sqft: sqftValue, areaUnit: unitSel.value }) });
      toast(srcInp.value.trim()
        ? `Recorded for ${d.district}${hasArea ? '' : ' — no area, so no price per unit from this one'}`
        : `Recorded for ${d.district} — no source, so it counts as a note`);
      observationDraft = null;
      renderKeepFocus();
    } }, 'Record');
    /* WHAT IS ENTERED HERE BEFORE RECORD IS KEPT THROUGH A REDRAW.
       These fields were the only copy of what had been typed, and any redraw
       of the page drew them empty: a deal field changed above the form, or
       the filings landing a moment after the page opened, turned an achieved
       rent of 2100 with its tenancy reference and address back into an
       asking rent with nothing entered. Each field writes the draft as it
       changes, a drawing reads it back, and Record lets it go. */
    const draftFields = { kind: kindSel, value: valInp, area: areaInp, unit: unitSel, title: titleSel,
      evidence: evSel, date: dateInp, source: srcInp, address: addrInp };
    const held = observationDraft;
    if (held) Object.entries(draftFields).forEach(([k, n]) => { if (k !== 'unit' && held[k] != null) n.value = held[k]; });
    [kindSel, valInp, areaWrap, titleSel, evSel, dateInp, addrInp, srcInp, addBtn].forEach(x => form.append(x));
    syncKind();
    /* The unit after the kind, whose units syncKind has just offered. */
    if (held && [...unitSel.options].some(o => o.value === held.unit)) unitSel.value = held.unit;
    const keepDraft = () => { observationDraft = Object.fromEntries(Object.entries(draftFields).map(([k, n]) => [k, n.value])); };
    Object.values(draftFields).forEach(n => { n.addEventListener('input', keepDraft); n.addEventListener('change', keepDraft); });
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
  typeField.append(el('label', { for: 'dealType' }, ptr('in.propertyType', 'Property type')));
  const typeSel = el('select', { class: 'select', id: 'dealType',
    onchange: e => { d.propertyType = e.target.value; saveDeal(); syncPropertyUrl(d); renderKeepFocus(); } });
  PROPERTY_TYPES.forEach(x => typeSel.append(el('option', { value: x, selected: d.propertyType === x ? '' : null }, x)));
  typeField.append(typeSel);
  loc.append(typeField);

  /* THE CLASS, SHOWN BECAUSE IT NOW DECIDES SOMETHING.
     ------------------------------------------------------------------------
     It is inferred from the type, which is right nearly always and not always:
     a shophouse the owner lives above is not a commercial letting, and a
     bungalow run as a homestay is not a residential one. So the inference is
     visible and the reader can overrule it. The override is stored separately
     from the type, so changing the type later does not silently discard a
     decision somebody made deliberately. */
  const classField = el('div', { class: 'field', style: 'margin-top:10px' });
  classField.append(el('label', { for: 'dealClass' }, ptr('in.assetClass', 'Asset class')));
  const inferredClass = PROPERTY_TYPE_CLASS[d.propertyType] || 'residential';
  const classSel = el('select', { class: 'select', id: 'dealClass',
    onchange: e => {
      d.propertyClassOverride = e.target.value || null;
      markTouched(d, 'propertyClassOverride'); saveDeal(); renderKeepFocus();
    } });
  classSel.append(el('option', { value: '', selected: d.propertyClassOverride ? null : '' },
    `Follow the property type — ${PROPERTY_CLASSES[inferredClass].label}`));
  PROPERTY_CLASS_IDS.forEach(id => classSel.append(el('option', { value: id,
    selected: d.propertyClassOverride === id ? '' : null }, PROPERTY_CLASSES[id].label)));
  classField.append(classSel);
  loc.append(classField);

  const activeClass = PROPERTY_CLASSES[propertyClassOf(d)];
  loc.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, activeClass.note));
  if (!activeClass.letsToTenant) loc.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
    'Because this class has no tenancy, rent, vacancy, yield, debt-service cover and break-even rent are withheld rather than '
    + 'computed — working them out would mean deriving them from a rent nobody expects to receive. The carrying cost and the '
    + 'exit are still modelled, because those are real: a parcel with a loan on it costs money every month.'));

  const titleField = el('div', { class: 'field', style: 'margin-top:10px' });
  titleField.append(el('label', { for: 'dealTitle' }, ptr('in.titleType', 'Title class')));
  const titleSel = el('select', { class: 'select', id: 'dealTitle',
    onchange: e => { d.titleType = e.target.value; saveDeal(); renderKeepFocus(); } });
  TITLE_TYPES.forEach(t => titleSel.append(el('option', { value: t.id, selected: d.titleType === t.id ? '' : null }, t.label)));
  titleField.append(titleSel);
  const tDef = TITLE_TYPES.find(t => t.id === d.titleType);
  if (tDef) titleField.append(el('p', { class: 'metaline', style: 'margin-top:5px' }, tDef.note));
  /* A dropdown implies the platform has determined something. It has not: it
     recorded what the user typed. Land Code classification governs who may
     lawfully hold the title, and getting it wrong is not a modelling error —
     it is a void transfer. */
  titleField.append(el('div', { class: 'note', style: 'margin-top:8px' }, [
    el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:var(--ls-support)' }, 'Title classification recorded from your input'),
    el('p', { class: 'metaline' },
      'Eligibility has not been verified. Nothing here confirms that a transfer is permitted, and this selection changes only how the tool describes the property to you. Confirm with a Sarawak property lawyer and the Land and Survey Department before relying on it.'),
  ]));
  loc.append(titleField);

  if (d.titleType !== 'strata') {
    const leaseField = el('div', { class: 'field', style: 'margin-top:10px' });
    leaseField.append(el('label', { for: 'dealLease' }, ptr('in.remainingLease', 'Years remaining on the lease (0 if freehold)')));
    /* On change, as every other figure on the rail is, and never from an
       empty box. It re-rendered the page on each keystroke, so focus left the
       field after the first digit — typing 45 recorded 4 and dropped the
       cursor on the page — and clearing the box to retype recorded 0, which
       the label defines as freehold and the financeability score rates as the
       best tenure there is. */
    leaseField.append(el('input', { class: 'input', id: 'dealLease', type: 'number', min: '0', max: '999',
      value: String(d.remainingLease ?? 0),
      onchange: e => {
        if (String(e.target.value).trim() === '') {
          e.target.value = String(d.remainingLease ?? 0);
          toast(`An empty box is not zero — the lease stays at ${num0(d.remainingLease)} years. Type 0 if it is freehold.`);
          return;
        }
        d.remainingLease = num0(e.target.value); saveDeal(); renderAfterTyping();
      } }));
    loc.append(leaseField);
  }
  rail.append(loc);
  rail.append(el('p', { class: 'eyebrow', style: 'margin-bottom:8px' }, 'What'));

  const psel = el('div', { class: 'field', style: 'margin-bottom:var(--md)' });
  psel.append(el('label', { for: 'pj' }, ptr('in.project', 'Project')));
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
    saveDeal(); syncPropertyUrl(d); renderKeepFocus();
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
  /* Each group in the section it belongs to (sec): the loan's three figures
     left "Purchase" for Financing, and the exit went to Scenarios, where
     what it decides — the rate of return, and its sensitivity — is drawn. */
  const GROUPS = [
    [acq, 'Size and parking', [
      ['sqft', 'Built-up area (sq ft)', 10],
      ['landSqft', 'Land area (sq ft, 0 if none)', 10],
      ['parking', 'Allocated parking bays', 1],
    ]],
    [acq, 'Purchase', [
      ['price', 'Purchase price (RM)', 1000],
      ['bankValuation', 'Bank or valuer estimate (RM, 0 if not yet known)', 1000],
      ['bookingDepositPaid', 'Booking deposit already paid (RM)', 500],
      ['renovation', 'Renovation and furnishing (RM)', 500],
      ['renoRentUpliftPct', 'Share of the rent that depends on the renovation (%)', 5],
      ['renoValueRecoveryPct', 'Share of the renovation a buyer will pay for at exit (%)', 10],
    ]],
    [fnc, 'Loan', [
      ['downPct', 'Deposit (%)', 1],
      ['ratePct', 'Loan interest rate (%)', 0.05],
      ['tenureYears', 'Loan tenure (years)', 1],
    ]],
    [rnt, 'Income', [
      ['rent', 'Expected monthly rent (RM)', 50],
      ['rentGrowthPct', 'Annual rent growth (%)', 0.25],
      ['vacancyPct', 'Vacancy allowance (%)', 1],
    ]],
    [rnt, 'Running costs', [
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
    [rnt, 'Management operations', [
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
    [scn, 'Exit', [
      ['holdYears', 'Holding period (years)', 1],
      ['apprecPct', 'Annual capital growth (%)', 0.25],
      ['sellMonths', 'Expected months to sell', 1],
      ['agentPct', 'Agent commission on exit (%)', 0.25],
      ['exitLegalPct', 'Legal costs on exit (%)', 0.1],
    ]],
    [scn, 'Comparison', [
      ['equityReturnPct', 'Assumed equity return (% a year)', 0.5],
    ]],
  ];
  GROUPS.forEach(([sec, heading, fields]) => {
    const rail = sec.inputs;
    rail.append(el('p', { class: 'eyebrow', style: rail.childElementCount ? 'margin:var(--md) 0 8px' : 'margin:0 0 8px' }, heading));
    fields.forEach(([k, label, step]) => {
      const f = el('div', { class: 'assumption' });
      /* Two non-numeric kinds, because a management mandate is made of
         commitments and cadences as well as amounts. */
      if (step === 'bool') {
        const l = el('label', { class: 'checkline', style: 'gap:8px;display:flex;align-items:flex-start' });
        l.append(el('input', { type: 'checkbox', id: `d-${k}`, checked: d[k] ? '' : null,
          onchange: e => { d[k] = e.target.checked; markTouched(d, k); saveDeal(); renderKeepFocus(); } }));
        l.append(el('span', {}, ptr(`in.${k}`, label)));
        rail.append(l);
        return;
      }
      if (Array.isArray(step)) {
        f.append(el('label', { for: `d-${k}` }, ptr(`in.${k}`, label)));
        const s = el('select', { class: 'select select-sm', id: `d-${k}`,
          onchange: e => { d[k] = e.target.value; markTouched(d, k); saveDeal(); renderKeepFocus(); } });
        step.forEach(o => s.append(el('option', { value: o, selected: d[k] === o ? '' : null }, o)));
        f.append(s);
        rail.append(f);
        return;
      }
      f.append(el('label', { for: `d-${k}` }, ptr(`in.${k}`, label)));
      f.append(el('input', { class: 'input input-inline', id: `d-${k}`, type: 'number', step,
        value: d[k] ?? 0, style: 'text-align:right',
        ...(k === 'holdYears' ? { min: 1, max: HOLD_YEARS_MAX } : {}),
        onchange: e => {
          /* AN EMPTIED BOX IS NOT ZERO. It was stored as 0, so clearing the
             price modelled a free property and clearing the rent a vacant
             one, with every figure beside them computed as if that had been
             typed. The model has no way to carry an absent price, so the
             box keeps its figure and says so; a nought has to be typed. */
          if (String(e.target.value).trim() === '') {
            e.target.value = d[k] ?? '';
            toast(`An empty box is not zero — “${label}” stays at ${isNum(d[k]) ? d[k] : 'its last figure'}. Type 0 if you mean nought.`);
            return;
          }
          d[k] = k === 'holdYears' ? normHoldYears(e.target.value) : num0(e.target.value);
          markTouched(d, k); saveDeal(); renderAfterTyping();
        } }));
      /* Said beside the number rather than only in the evidence section below,
         because this is where a reader decides whether to trust it. Only for
         a figure this class has: a parcel's rent is used by nothing. All ten
         seeded figures, not the four evidence drivers only (inputIsSeeded,
         70-property.js). */
      if (inputIsSeeded(d, k))
        f.append(el('span', { class: 'metaline', style: 'flex-basis:100%;color:var(--bronze);margin-top:2px' },
          'Illustrative default — not yours, and not from any market'));
      rail.append(f);
    });
  });

  /* THE SUBSALE EVIDENCE (the property decision layer, P2), in the
     Acquisition section beside the purchase it qualifies: what was asked,
     what is known of the unit — its tenancy, condition, age and what the
     sale passes to the buyer — each with where it came from; and the
     comparables from the register this price is set against. */
  acq.inputs.append(dealRoute(d) === 'auction' ? pcAuctionInputs(d) : dealRoute(d) === 'newdev' ? pcNewDevInputs(d) : pcSubsaleInputs(d));
  /* THE COMMERCIAL MODELS (the property decision layer, P5), in the
     Rental section beside the rent they qualify: the four rents, the lease
     and the unit as the reader recorded them, each with where it came from,
     and the achieved rents named from the register. */
  if (propertyClassOf(d) === 'commercial') rnt.inputs.append(pcCommercialInputs(d));

  /* Provenance for the figures that actually move the answer. */
  {
    const rail = rpt.inputs;
    rail.append(el('p', { class: 'eyebrow', style: 'margin:0 0 8px' }, 'Evidence quality'));
    /* The figures this class has (evidenceDriversFor, 70-property.js). A
       bare parcel was told that "the price and the rent drive every output"
       and asked to grade a rent and a service charge the page withholds. */
    const railDrivers = evidenceDriversFor(d);
    rail.append(el('p', { class: 'metaline', style: 'margin-bottom:8px' }, railDrivers.includes('rent')
      ? 'Where each of the four figures below came from — the price and the rent drive every output.'
      : `Where each of the ${railDrivers.length === 2 ? 'two' : railDrivers.length} figures below came from — the price drives every output.`));
    [['price', 'Purchase price'], ['rent', 'Expected rent'], ['maintenance', 'Maintenance'], ['sqft', 'Built-up area']]
      .filter(([k]) => railDrivers.includes(k))
      .forEach(([k, label]) => {
        const f = el('div', { class: 'assumption' });
        f.append(el('label', { for: `ev-${k}` }, ptr(`evr.${k}`, label)));
        const sel = el('select', { class: 'select select-sm', id: `ev-${k}`,
          onchange: e => {
            d.evidence = { ...(d.evidence || {}), [k]: e.target.value };
            /* Grading a figure IS a statement about it, so it stops being an
               untouched default at that point — but only upward. Selecting
               "illustrative default" leaves it exactly what it is. */
            if (e.target.value !== 'illustrative_default') markTouched(d, k);
            saveDeal(); renderKeepFocus();
          } });
        const shown = shownEvidence(d, k);
        EVIDENCE.forEach(ev => sel.append(el('option', { value: ev.id,
          selected: shown === ev.id ? '' : null }, ptr(`ev.${ev.id}`, ev.label))));
        f.append(sel);
        rail.append(f);
      });
  }

  /* ---------- outputs ---------- */
  /* The summary in the reader's language, and the review queue, above the
     sections: both are about every section at once. */
  const free = el('div', { class: 'pc-free' });
  /* Language applies to the summary below and to the metric names in it. The
     analysis itself stays in English, which the note says rather than leaving
     the reader to discover it. */
  const langRow = el('div', { class: 'row', style: 'gap:6px;margin-bottom:10px;flex-wrap:wrap' });
  LANGUAGES.forEach(L => langRow.append(el('button', {
    id: `lang-${L.id}`, class: 'btn btn-ghost btn-sm', 'aria-pressed': lang() === L.id ? 'true' : 'false',
    style: lang() === L.id ? 'border-color:var(--brand);color:var(--brand)' : '',
    onclick: () => { State.lang = L.id; store.write('lang', L.id); renderKeepFocus(); },
  }, L.native)));
  free.append(langRow);

  const sc = SUMMARY_COPY[lang()] || SUMMARY_COPY.en;
  /* THE SUMMARY TABLE AND ITS NOTE, A DRAWER (N3, D18): six figures the
     grade card's tiles and the sections already state, in the reader's
     language — and what is and is not translated. The buttons above stay in
     sight: they translate every section's labels, not only this table. Open
     across a redraw once opened (a language chosen redraws the page). */
  const summary = el('details', { class: 'panel pc-more pc-summary ls-l3', style: 'margin-bottom:var(--md)', open: propertySummaryOpen ? '' : null });
  summary.addEventListener('toggle', () => { propertySummaryOpen = summary.open; });
  summary.append(el('summary', { class: 'pc-more-sum' }, sc.title));
  const srows = [
    [tr('grossYield'),       fmtPct(m.grossYield, 2)],
    [tr('netYield'),         fmtPct(m.netYield, 2)],
    /* The unit in the reader's language: "/ bln" is Malay, and was shown in all three. */
    [tr('netCashFlow'),      isNum(m.cashflowMonthly) ? `${fmtAmount(m.cashflowMonthly, 'MYR')} ${sc.perMonth}` : '—'],
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
    /* THE SYSTEM'S ALERT CARD: how many figures still need the reader's
       evidence, and "Review →", which opens the list (L3) under it. The
       Scenario Lab's alert links here (/property/calculator#review). */
    const q = el('div', { class: 'card ls-card pc-review', 'data-card': 'alert', id: 'review', style: 'margin-bottom:var(--md)' });
    const det = el('details', { id: 'pc-review-list' });
    const n = queue.length, s = n === 1 ? '' : 's';
    const sum = el('summary', { class: 'pc-review-sum' }, [
      el('span', { class: 'ls-card-mark', 'aria-hidden': 'true' }, '!'),
      el('span', { class: 'ls-card-body' }, [
        el('span', { class: 'ls-card-title' }, `${n} sample input${s} need${n === 1 ? 's' : ''} your evidence`),
        el('span', { class: 'ls-card-sub' }, 'These are figures this tool seeded, not figures you gave it. The result below is arithmetic on them.')]),
      el('span', { class: 'ls-cta ls-card-cta' }, [`Review ${n} sample input${s}`, el('span', { class: 'ls-arrow', 'aria-hidden': 'true' }, ' →')]),
    ]);
    det.append(sum);

    const list = el('div', { style: 'margin-top:var(--md);display:flex;flex-direction:column;gap:2px' });
    queue.forEach(f => {
      const row = el('div', { class: 'row row-wrap',
        style: 'gap:10px;align-items:baseline;padding:8px 0;border-top:1px solid var(--grid)' });
      row.append(el('span', { style: 'font-size:var(--ls-support);font-weight:600;min-width:150px' }, f.label));
      row.append(el('span', { class: 'num', style: 'font-size:var(--ls-support);min-width:120px' },
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
  const summaryCard = free;

  /* The four headline numbers, in the section whose inputs make them. */
  const headline = el('div', { class: 'card ls-section' });
  headline.append(cardHead('Free calculator', 'The four numbers that decide whether a rental property is worth analysing further.', null, DK));
  const fg = el('div', { class: 'grid g-4' });
  fg.append(el('div', { class: 'panel ls-fig' }, statTile('Gross yield', fmtPct(m.grossYield, 2), { sub: 'Annual rent ÷ purchase price' })));
  fg.append(el('div', { class: 'panel ls-fig' }, statTile('Monthly instalment', fmtAmount(m.instalment, 'MYR'), { sub: `${fmtPct(d.ratePct, 2)} over ${d.tenureYears} years` })));
  fg.append(el('div', { class: 'panel ls-fig' }, statTile('Monthly cash flow', fmtAmount(m.cashflowMonthly, 'MYR'),
    { sub: 'After costs, vacancy and the loan', tone: m.cashflowMonthly >= 0 ? '--ok-text' : '--dn-text' })));
  fg.append(el('div', { class: 'panel ls-fig' }, statTile('Break-even rent', fmtAmount(m.breakEvenRent, 'MYR'), { sub: 'Rent needed to cover everything' })));
  headline.append(fg);

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
  const returnsPanel = returnsAndTaxPanel(d, m);
  /* Directly after the return, because it answers the question the return
     provokes: which of these forty inputs did that number come from. */
  const sensPanel = propertySensitivityPanel(d, m);
  const choicesPanel = financingChoicesPanel(d, m);
  const gatesPanel = ipsGatePanel(propertyIps(d, m, g), { title: 'Against the methodology' });
  const demandCard = demandPanel(d.city, d.district);
  const envCard = environmentalPanel(d);
  const rentBuyCard = rentVersusBuyPanel(d, m);

  /* What buying it takes: the price per unit, where the cash goes, the
     ledger, and the cash to hold back. */
  const buyCard = el('div', { class: 'card ls-section' });
  buyCard.append(cardHead('What buying it takes',
    'The cash to complete, where every ringgit of it goes, and the safe cash required once the renovation and the reserve are counted.', null, DKF));

  const unitCard = el('div', { class: 'render-block', style: 'margin-top:var(--lg)' });
  unitCard.append(el('h4', { style: 'font-size:var(--ls-body);font-weight:var(--weight-semibold);margin:0' },
    'What you are paying, per unit'));
  const unitTile = (label, perSqft, unit, dp, sub) => {
    const v = rateInUnit(perSqft, unit);
    return el('div', { class: 'panel ls-fig' }, statTile(label,
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
  buyCard.append(unitCard);

  /* The two rent tiles above, drawn against each other. One series, so no
     legend — the title names it and both marks are directly labelled. */
  if (isNum(m.breakEvenRent) && m.breakEvenRent > 0 && isNum(d.rent)) {
    const rb = el('div', { class: 'render-block', style: 'margin-top:var(--lg)' });
    rb.append(el('h4', { style: 'font-size:var(--ls-body);font-weight:var(--weight-semibold);margin:0' },
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
    headline.append(rb);
  }

  /* The same build-up as a picture, above the table that itemises it. Two
     tiers means a legend is not optional — identity may never rest on colour
     alone, and here the colour carries the one distinction that matters. */
  if ((m.costGroups || []).length >= 2) {
    const wf = el('div', { class: 'render-block', style: 'margin-top:var(--lg)' });
    wf.append(el('h4', { style: 'font-size:var(--ls-body);font-weight:var(--weight-semibold);margin:0' },
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
    buyCard.append(wf);
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
  /* A body a group: under 640px each is a card of its own (ls-tcards, the
     layout system's tables-become-cards), its name heading it. */
  const cashT = el('table', { class: 'dt pc-cost-table', 'aria-label': 'What the cash is for, line by line' });
  let cashB;
  m.costGroups.forEach(g => {
    cashB = el('tbody', { class: 'ls-tgroup' });
    cashT.append(cashB);
    const sub = g.items.reduce((s2, it) => s2 + (isNum(it[1]) ? it[1] : 0), 0);
    const gMissing = g.items.filter(it => !isNum(it[1])).length;
    cashB.append(el('tr', { class: 'ls-tgroup-hd' }, [
      el('td', { style: 'font-weight:600', colspan: 2 }, g.label)]));
    /* An unpriced line is shown as unpriced. Omitting it would read as a cost
       that does not exist, and every one of these exists. */
    g.items.forEach(it => {
      cashB.append(el('tr', {}, [
        el('td', { style: 'padding-left:var(--md)' }, [
          it[0],
          /* Marked at every appearance, by the fee rulebook (70-property.js):
             the D6 kind badge — Placeholder for an estimate,
             Derived for a verified scale computed, Yours for the reader's
             quote — and, under the name, the line's provenance and
             jurisdiction. A placeholder is plausible, which is precisely why
             it cannot be left to look like a checked figure. */
          ...(it[2]?.provenance ? [' ', feeBadge(it[2], it[1]), el('span', { class: 'pc-fee-prov', 'data-fee-provenance': it[2].provenance }, feeProvenanceLine(it[2])),
            /* Which of the ledger's five kinds it is (the rulebook 1.1.0). */
            el('span', { class: 'pc-fee-kind', 'data-fee-kind': feeKindOf(it[2]) || '' }, FEE_TABLE.categories[feeKindOf(it[2])] || '')] : []),
          /* Included at the estimate, it can be left out again here. */
          ...(it[2]?.id === 'mortgageProtection' && it[2].provenance !== 'quote' ? [el('button', { type: 'button', class: 'btn btn-quiet btn-sm pc-opt-btn', id: 'pc-mrta-toggle',
            onclick: () => { if (setDealAnswer(d, 'mortgageProtection', null)) { saveDeal(); renderKeepFocus(); toast('Mortgage protection left out of the cash required.'); } } }, 'Leave it out')] : []),
        ]),
        isNum(it[1])
          ? el('td', { class: 'num' }, fmtAmount(it[1], 'MYR'))
          : el('td', { class: 'num' }, el('span', { class: 'caption', style: 'color:var(--bronze)',
              title: it[2]?.why || 'No value has been entered for this line.' }, 'not set')),
      ]));
    });
    /* THE OPTIONAL LINES LEFT OUT (the rulebook 1.1.0): listed, with no
       amount and not in any total, so the absence is seen — and the
       control that puts one in. */
    (m.optionalCostLines || []).filter(x => x.group === g.id).forEach(x => {
      cashB.append(el('tr', { class: 'pc-opt-row', 'data-optional': x.id }, [
        el('td', { style: 'padding-left:var(--md)' }, [
          x.label, ' ', kindBadge('unavailable', { fine: 'not included' }),
          el('span', { class: 'pc-fee-prov', 'data-fee-provenance': 'optional' }, `Not included — ${x.why.charAt(0).toLowerCase()}${x.why.slice(1)}`),
          el('span', { class: 'pc-fee-kind', 'data-fee-kind': 'optional' }, FEE_TABLE.categories.optional),
          el('button', { type: 'button', class: 'btn btn-quiet btn-sm pc-opt-btn', id: 'pc-mrta-toggle',
            onclick: () => { if (setDealAnswer(d, 'mortgageProtection', 'included')) { saveDeal(); renderKeepFocus(); toast(`Mortgage protection included at the rulebook’s ${fmtAmount(x.estimate, 'MYR')} estimate — enter your quote on the financing panel to replace it.`); } } },
            `Include it — ${fmtAmount(x.estimate, 'MYR')} estimate`)]),
        el('td', { class: 'num' }, el('span', { class: 'caption' }, 'not included')),
      ]));
    });
    if (g.items.length > 1) cashB.append(el('tr', {}, [
      el('td', { class: 'metaline', style: 'padding-left:var(--md)' },
        `${g.label} subtotal${gMissing ? ` — ${gMissing} line${gMissing === 1 ? '' : 's'} unpriced` : ''}`),
      el('td', { class: 'num metaline' }, fmtAmount(sub, 'MYR'))]));
  });
  const nMissing = (m.missingCostLines || []).length;
  /* The total, its own card on a phone. */
  cashB = el('tbody', { class: 'ls-tgroup ls-tgroup-total' });
  cashT.append(cashB);
  cashB.append(el('tr', { style: 'border-top:2px solid var(--line)' }, [
    el('td', { style: 'font-weight:700' }, [
      nMissing ? 'Total initial cash so far' : 'Total initial cash', ' ',
      /* Its weakest input's kind, the fee lines' included (N6). */
      kindBadge(DKF.kind, { fine: DKF.fine })]),
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
      el('td', { colspan: 2, class: 'metaline pc-fee-uncertain', style: 'color:var(--bronze);white-space:normal' },
        `${fmtAmount(m.unconfirmedCost, 'MYR')} of this — ${fmtPct(m.unconfirmedCost / m.totalInitialCash * 100, 0)} — rests on unverified or unknown lines: ${feeUncertainWords(m)}. `
        + 'They compute so the total runs; they are not quotations and not checked against an official source. Replace them with real quotes before this figure means anything.')]));
  /* The same total by kind (the rulebook 1.1.0), so a reader sees how much
     is statute, how much a published scale, a quotation, an optional
     product, an estimate — and how much their own money and figures. */
  if (m.ledgerSplit) cashB.append(el('tr', {}, [
    el('td', { colspan: 2, class: 'metaline pc-fee-split', style: 'white-space:normal' }, ledgerSplitWords(m))]));
  /* The rulebook this ledger was charged by, and where its sources are. */
  cashB.append(el('tr', {}, [
    el('td', { colspan: 2, class: 'metaline', style: 'white-space:normal' }, [
      `Fees and duties from the fee rulebook ${FEE_TABLE.version}, checked ${feeDay(FEE_TABLE.checkedOn)}. Research, not advice: confirm each with the lender, the solicitor and the authority. `,
      el('a', { href: href('/data-sources#fee-rulebook') }, 'Every line’s source →')])]));
  lsTableCards(cashT, { id: 'pc-cost-table' });
  cash.append(el('div', { class: 'tablewrap' }, cashT));

  /* ---- financing basis (specification 29.2) ---------------------------- */
  const fin = el('div', { style: 'margin-top:var(--md);padding-top:var(--md);border-top:1px solid var(--line)' });
  fin.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'What the loan is calculated against'));
  if (!m.financingBasisConfirmed) {
    fin.append(el('p', { class: 'body', style: 'font-size:var(--ls-support);color:var(--bronze)' },
      'Financing basis is modelled, not lender-confirmed. No bank or valuer estimate has been entered, so the loan below is calculated against the purchase price — which assumes a valuation at least equal to what you agreed to pay. Where a valuation comes in lower, the shortfall becomes cash you must find at completion, and this figure would understate what the purchase takes.'));
  } else {
    const kv = el('dl', { class: 'kv' });
    [['Purchase price', fmtAmount(d.price, 'MYR')],
     ['Bank or valuer estimate', fmtAmount(m.bankValuation, 'MYR')],
     /* Named by the rule in force. It always said "the lower of the two",
        including under a valuation-only rule lending on more than the price. */
     ['Value the loan is calculated on', `${fmtAmount(m.lenderValueBasis, 'MYR')} — ${
       m.valuationRule === 'valuation_only' ? 'the valuation, under a valuation-only rule'
       : m.valuationRule === 'lower_of' ? 'the lower of the two'
       : 'the purchase price, under the rule in force'}`],
     ['Margin of finance applied', fmtPct(m.marginOfFinancePct, 0)],
     ['Loan', fmtAmount(m.loan, 'MYR')],
     ['Share of the price this funds', fmtPct(m.financingCoverageOfPrice, 1)]]
      .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, v)); });
    fin.append(kv);
    if (m.valuationGapCash > 0) fin.append(el('p', { class: 'body', style: 'font-size:var(--ls-support);margin-top:8px;color:var(--dn-text)' },
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
      el('td', { style: 'text-align:left' }, [`${s.mof}%`, isCurrent ? el('span', { class: 'chip', style: 'margin-left:6px;font-size:var(--ls-meta)' }, 'entered') : null]),
      el('td', { class: 'num' }, fmtAmount(s.loan, 'MYR')),
      el('td', { class: 'num' }, fmtAmount(s.cashEquity, 'MYR')),
      el('td', { class: 'num' }, fmtAmount(s.instalment, 'MYR')),
      el('td', { class: 'num' }, fmtPct(s.coverageOfPrice, 1)),
    ]));
  });
  scT.append(scB);
  /* Under 640px a card a margin (the layout system): the one entered
     stands, the others behind "Compare 70% & 80% ↓". */
  const curAt = m.financingScenarios.findIndex(s => Math.abs(s.mof - m.marginOfFinancePct) < 1e-9);
  const others = m.financingScenarios.filter((s, i) => i !== curAt).map(s => `${s.mof}%`).join(' & ');
  const { toggle: scMore } = lsTableCards(scT, { id: 'pc-fin-scenarios', selected: curAt,
    more: { open: `Compare ${others}`, close: `Hide ${others}` } });
  fin.append(el('div', { class: 'tablewrap' }, scT));
  if (scMore) fin.append(scMore);
  fin.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'Scenarios, not offers. No lender has seen this property or this borrower, and the margin a lender will actually extend depends on its own valuation, its credit policy and the applicant. Cash equity is the purchase price less the loan, so it carries any valuation gap with it.'));
  const loanCard = el('div', { class: 'card ls-section' });
  loanCard.append(cardHead('The loan', 'What the loan is lent against, what it funds, and what it would be at other margins of finance.', null, DK));
  fin.style.cssText = '';
  loanCard.append(fin);
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
   /* Unknown when it cannot be priced, and the tile says why rather than
      printing RM0 beside "3 months of instalment". One month is "1 month",
      as the ledger above already says; the tile read "1 months". */
   ['Cash to keep untouched', m.reserveCash, isNum(m.reserveCash)
     ? `${m.reserveMonths} month${m.reserveMonths === 1 ? '' : 's'} of instalment and owner-paid running costs. Not paid to anyone — it stays in your account.`
     : `${m.reserveMonths} month${m.reserveMonths === 1 ? '' : 's'} of instalment and owner-paid running costs — not priced, because the loan’s instalment could not be computed from the entered tenure.`],
   ['Safe cash required', m.safeCashRequired, (m.missingCostLines || []).length
     ? 'Everything priced so far, including what is already paid. It is short by the unpriced lines the ledger above names, so the real figure is higher.'
     : 'Everything together, including what is already paid. This is the number that decides whether the purchase is survivable, not the deposit.']]
    .forEach(([label, amount, sub], i, arr) => threeCash.append(el('div', { class: 'panel ls-fig' },
      statTile(label, fmtAmount(amount, 'MYR'), { sub, tone: i === arr.length - 1 ? '--brand' : null }))));
  cash.append(threeCash);

  /* Reserve policy, and what it costs at the two horizons the specification
     asks for. */
  const resRow = el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:end;margin-top:var(--md)' });
  const resField = el('div', { class: 'field', style: 'width:190px' });
  resField.append(el('label', { for: 'd-reserveMonths' }, 'Months of reserve to hold'));
  resField.append(el('input', { class: 'input input-inline', id: 'd-reserveMonths', type: 'number',
    min: '1', max: '24', step: '1', value: String(m.reserveMonths), style: 'text-align:right',
    onchange: e => { d.reserveMonths = num0(e.target.value); markTouched(d, 'reserveMonths'); saveDeal(); renderAfterTyping(); } }));
  resRow.append(resField);
  /* Said to be unknown where the instalment is (a loan tenure of 0), as the
     tile above says, never priced as though the loan cost nothing. */
  resRow.append(el('p', { class: 'metaline', style: 'flex:1 1 300px' }, !isNum(m.burnWithoutRent)
    ? 'What holding this property burns a month, and the three- and six-month figures, are not computed: the loan’s instalment could not be worked out from the entered tenure.'
    : `At the entered rent and costs, holding this property burns ${fmtAmount(m.burnWithRent, 'MYR')} a month with rent still coming in and ${fmtAmount(m.burnWithoutRent, 'MYR')} a month with none. `
    + m.reserveScenarios.map(s => `${s.months} months with no rent is ${fmtAmount(s.noRent, 'MYR')}`).join('; ') + '.'));
  cash.append(resRow);

  cash.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `The reserve is not paid to anyone — it is what stays in your account after completion. Completion and rent-ready together take ${fmtAmount(m.acquisitionCost, 'MYR')}; the reserve is on top of that.`));
  buyCard.append(cash);

  /* ---------- Sarawak checklist ---------- */
  /* Questions, answered by the buyer, each naming who can actually settle it.
     The tool does not decide legal eligibility or flood exposure — it makes
     sure neither is skipped. */
  const chk = el('div', { class: 'card ls-section' });
  chk.append(cardHead('Before the numbers mean anything',
    'Ten questions that decide more than the price does. No figure in the model moves on your answers. An adverse answer is raised in the findings below with who can confirm it, and the grade\'s local-demand pillar counts each question only once it is settled without one — an adverse or open answer earns nothing there.'));
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
      el('p', { style: 'flex:1 1 320px;font-size:var(--ls-support);font-weight:500;margin:0' }, ptr(`chk.${c.id}`, c.q)),
      /* A group named by its question, and the answer given carried by
         aria-pressed. Ten rows of "Yes", "No", "Not sure" reached a screen
         reader with no question attached and no word of which was chosen —
         aria-selected means nothing on a plain button, and an ARIA checker
         calls it not allowed there; the stylesheet keys on aria-pressed. */
      el('div', { class: 'segmented', style: 'flex:none', role: 'group', 'aria-label': ptr(`chk.${c.id}`, c.q) }, ['yes', 'no', 'unknown'].map(v =>
        el('button', { 'aria-pressed': d.checks?.[c.id] === v ? 'true' : 'false',
          id: `chk-${c.id}-${v}`,
          onclick: () => { d.checks = { ...(d.checks || {}), [c.id]: v }; saveDeal(); renderKeepFocus(); } },
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
      const evSel = el('select', { class: 'select select-sm', id: `chk-ev-${c.id}`, 'aria-label': `Evidence for: ${c.q}` });
      EVIDENCE.forEach(ev => evSel.append(el('option', { value: ev.id,
        selected: (d.checkEvidence?.[c.id] || 'assumed') === ev.id ? '' : null }, ptr(`ev.${ev.id}`, ev.label))));
      evSel.addEventListener('change', e => {
        d.checkEvidence = { ...(d.checkEvidence || {}), [c.id]: e.target.value }; saveDeal(); renderKeepFocus();
      });
      evRow.append(evSel);
      if ((d.checkEvidence?.[c.id] || 'assumed') === 'assumed')
        evRow.append(el('span', { class: 'metaline', style: 'color:var(--bronze)' },
          'An assumed answer is not an answer.'));
      row.append(evRow);
    }

    /* What it bears on, and how to settle it. */
    if (c.affects?.length) row.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Bears on: ${c.affects.join(' · ')}. This tool changes no modelled cash figure on the strength of your answer — it has no basis for a coefficient, and inventing one would be worse than leaving the number alone.`));
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
  const checkCard = chk;

  /* ---------- stress tests ---------- */
  const stressCard = el('div', { class: 'card ls-section' });
  stressCard.append(cardHead('What breaks it',
    'The useful question is not what this returns but at what point it stops working. Each row moves one assumption and leaves the rest as entered.', null, DK));

  /* A class with no tenancy has no rent for the price to stand against: the
     page withholds rent for it, and this said the shortfall lay "in the price
     against the rent" of a bare parcel. */
  if (m.negativeAtBest) stressCard.append(el('p', { class: 'body', style: 'margin-bottom:var(--md);color:var(--dn-text)' }, m.letsToTenant === false
    ? 'This class earns no rent, so no interest rate makes it pay for itself: whatever it costs to hold — the outgoings, and the instalment where there is a loan — comes from you until it is sold.'
    : 'This deal is cash-flow negative even at a 0% interest rate with the unit never empty. No interest rate or occupancy level makes it pay for itself — the shortfall is structural, in the price against the rent.'));

  const stressGrid = el('div', { class: 'grid g-3', style: 'margin-bottom:var(--md)' });
  /* The three cases are displayed as three different things, because they are:
     it crosses somewhere, it is never positive, or it is always positive. */
  const beTile = (label, value, why, entered, fmt, copy) => {
    const never = why === 'never-positive', always = why === 'always-positive';
    /* A fourth case: no monthly position to cross zero, because the loan's
       instalment could not be computed. It used to fall through to "any
       rate", in green. */
    if (why === 'unknown') return el('div', { class: 'panel ls-fig' }, statTile(label, '—',
      { sub: 'Not computable — the loan’s instalment could not be worked out from the entered tenure.' }));
    return el('div', { class: 'panel ls-fig' }, statTile(label,
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
  /* Vacancy and a break-even rent are tenancy quantities. The rail says they
     are withheld for a class with no tenant, and this card went on printing
     them — "You expect RM1.9k" of a bare parcel. */
  if (m.letsToTenant) {
    stressGrid.append(beTile('Survives vacancy to', m.breakEvenVacancy, m.breakEvenVacancyWhy, d.vacancyPct,
      v => fmtPct(v, 0), {
        neverValue: 'none', alwaysValue: 'fully vacant',
        crosses: e => `Vacancy at which it reaches zero. You assumed ${fmtPct(e, 0)}.`,
        never: 'Negative even with the unit never empty. Vacancy is not what makes this negative.',
        always: 'Covers its costs even with no tenant at all.',
        good: (v, e) => v > e + 10,
      }));
    stressGrid.append(el('div', { class: 'panel ls-fig' }, statTile('Break-even rent', fmtAmount(m.breakEvenRent, 'MYR'),
      { sub: `Rent needed to cover everything. You expect ${fmtAmount(d.rent, 'MYR')}.`,
        tone: !isNum(m.breakEvenRent) ? null : d.rent > m.breakEvenRent ? '--ok-text' : '--dn-text' })));
  }
  stressCard.append(stressGrid);
  if (!m.letsToTenant) stressCard.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--md)' },
    'No vacancy or break-even rent is tested: this class has no tenancy. The rate stress below is the carrying cost of the loan and the outgoings.'));

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
  if (m.letsToTenant) stressCard.append(stressTable('If it sits empty for longer', m.stress.vacancy, [
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

  /* ---------- management operations ---------- */
  const ops = el('div', { class: 'card ls-section' });
  ops.append(cardHead(m.managed ? 'Management operations' : 'Management operations — self-managed',
    m.managed
      ? 'What the service costs, and what it has to do for it. A percentage alone is not comparable between two agents; cost per occupied month and cost per tenancy are.'
      : 'You have said you will manage this property yourself, so no management cost is charged below. The work does not disappear with the fee — it is listed here so it is a decision rather than an omission.', null, DK));

  if (m.managed) {
    ops.append(el('div', { class: 'grid g-4', style: 'margin-top:var(--md)' }, [
      el('div', { class: 'panel ls-fig' }, statTile('Management cost a year', fmtAmount(m.mgmtTotalAnnual, 'MYR'),
        { sub: `${fmtPct(num0(d.mgmtPct), 1)} of collected rent plus placement` })),
      el('div', { class: 'panel ls-fig' }, statTile('Cost per occupied month', fmtAmount(m.mgmtCostPerOccupiedMonth, 'MYR'),
        { sub: 'what it costs for each month the property is actually let' })),
      el('div', { class: 'panel ls-fig' }, statTile('Cost per tenancy signed', isNum(m.mgmtCostPerTenancy)
        ? fmtAmount(m.mgmtCostPerTenancy, 'MYR') : '—', { sub: `over a ${m.monthsPerCycle}-month tenancy` })),
      el('div', { class: 'panel ls-fig' }, statTile('Placement fee a year', fmtAmount(m.placementAnnual, 'MYR'),
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
  /* Not for a class with no tenancy: its vacancy is used by nothing, and
     this called the entered figure "the figure every output above uses". */
  if (isNum(m.impliedVacancyPct) && m.letsToTenant !== false) {
    const gap = Math.abs(m.impliedVacancyPct - num0(d.vacancyPct));
    ops.append(el('div', { class: 'note', style: `margin-top:var(--md);border-left:3px solid var(${gap > 2 ? '--warn' : '--line'})` },
      el('p', { class: 'body', style: 'font-size:var(--ls-support)' },
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

  /* ---------- evidence quality ---------- */
  const ev = el('div', { class: 'card ls-section' });
  ev.append(cardHead('What this rests on',
    'A figure a seller quoted and a figure taken from a transacted comparable are not the same evidence.'));
  const evRows = [['price', 'Purchase price'], ['rent', 'Expected rent'], ['maintenance', 'Maintenance'], ['sqft', 'Built-up area']]
    .filter(([k]) => evidenceDriversFor(d).includes(k));
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
  /* The table is wider than its card at every width, and nothing in it takes
     focus, so the keyboard could not scroll to its last column: the box is a
     named tab stop of its own, which the arrow keys then scroll. */
  ev.append(el('div', { style: 'overflow-x:auto', tabindex: '0', role: 'region', 'aria-label': 'What this rests on, table' }, evT));
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

  const reportCards = [];
  if (!paid) {
    /* The offer has to describe what this particular report would contain. On a
       location with no comparable held, promising "comparable transactions and
       the price and rental range for this project" would be selling a section
       that cannot be produced.
       Nor may it read as a sale: nothing is on sale (the launch audit, 29
       Sep 2026). It read "Full investor report — RM49 … Bought per report"
       over a button "Unlock this report", in the card whose own line says
       "nothing can be bought" — a price, a purchase and its denial side by
       side. It now says what the pricing page says — a proposed price, not
       on sale — and its button says what it does, as a plan's does there:
       it previews the report in this browser.
       Debt-service cover is not among what it adds: the Scenario Lab shows
       it free, under Risk (plan item 1.4), and a report cannot offer what
       the free tool already gives. */
    reportCards.push(upsell(`Full investor report — proposed at RM${PROPERTY_REPORT_PRICE.full}`,
      m.proj.custom
        ? `Adds net operating income, cash-on-cash return, a ten-year scenario, exit costs including real property gains tax, the equity comparison, and the risk flags — all computed from the figures you entered. It would contain no comparable transactions and no price or rental range, because none is held for ${m.proj.area}.`
        /* Proposed per report. The line also offered it "included twice
           monthly on All-Access", a tier that is not launched and must not
           appear purchasable; it returns when the tier does. */
        : `Adds comparable transactions and the price and rental range for this project, net operating income, cash-on-cash return, a ten-year scenario, exit costs including real property gains tax, the equity comparison, and the risk flags. Proposed per report${PLANS.all.launched ? ', or included twice monthly on All-Access' : ''} — not on sale yet.`));
    const buy = el('div', { class: 'row row-wrap', style: 'gap:8px' });
    const included = num0(lim('propertyReports'));
    if (included > 0) {
      const left = propertyReportsLeft();
      buy.append(el('button', { class: 'btn btn-ghost btn-sm', disabled: left > 0 ? null : '',
        onclick: () => {
          if (!usePropertyReport(d.projectId)) { toast(`This month's ${included} included reports are used`); return; }
          toast(`Included report used — ${propertyReportsLeft()} left this month`); render(); focusAfterRedraw('#property-report-full h3');
        } }, left > 0
          ? `Use an included report — ${left} of ${included} left this month`
          : `All ${included} included reports used this month`));
    }
    buy.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => {
      State.propertyReportsBought = [...State.propertyReportsBought, d.projectId];
      store.write('propertyReportsBought', State.propertyReportsBought);
      /* The offer is replaced by the report, and focus went to <body> with
         the button; it goes to the report's first heading. */
      toast('Previewing the full report in this browser — nothing is on sale, and nothing was charged'); render(); focusAfterRedraw('#property-report-full h3');
    } }, 'Preview this report in this browser'));
    buy.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('plans') }, 'See plans'));
    reportCards.push(el('div', {}, buy));
  } else {
    /* ---------- exits and the alternative ---------- */
    const exitCard = el('div', { class: 'card ls-section', id: 'property-report-full' });
    exitCard.append(cardHead('Selling in year 5 and year 10',
      'Exit costs modelled in full: agent commission, legal, real property gains tax, and the months the property is carried unlet while it sells.', null, DK));
    const exTable = el('table', { class: 'dt' });
    exTable.append(el('thead', {}, el('tr', {}, ['', 'Sell in year 5', 'Sell in year 10'].map((h, i) =>
      el('th', { class: i ? 'num' : '' }, h)))));
    const exBody = el('tbody');
    const exRows = [
      ['Sale value', e => fmtAmount(e.value, 'MYR')],
      ['Loan outstanding', e => isNum(e.outstanding) ? `−${fmtAmount(e.outstanding, 'MYR')}` : '—'],
      ['Agent commission', e => `−${fmtAmount(e.agentFee, 'MYR')}`],
      ['Legal on exit', e => `−${fmtAmount(e.exitLegal, 'MYR')}`],
      [`Carried while selling`, e => isNum(e.carry) ? `−${fmtAmount(e.carry, 'MYR')}` : '—'],
      ['Real property gains tax', e => `−${fmtAmount(e.rpgt, 'MYR')} (${e.rpgtPct}%)`],
      ['Net proceeds', e => fmtAmount(e.net, 'MYR')],
      [m.taxComputed ? 'Rental cash over the hold, after tax on the rent' : 'Rental cash over the hold, before tax', e => fmtAmount(e.cumCash, 'MYR')],
      ['Total profit on cash invested', e => fmtAmount(e.profit, 'MYR')],
      ['Annualised', e => isNum(e.annualised) ? fmtPct(e.annualised, 2) : '—'],
      /* The model's own reason for a missing rate, never a fixed one: the old
         "the capital does not come back" sat beside a positive profit whenever
         the flows had two rates rather than none. */
      ['Rate of return if sold then', e => isNum(e.irrPct) ? fmtPct(e.irrPct, 2)
        : el('span', { class: 'caption', style: 'white-space:normal' }, `No rate. ${e.irrWhy || ''}`.trim())],
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
    reportCards.push(exitCard);

    /* ---------- hold or sell, year by year ---------- */
    {
      const hs = m.holdVsSell || [];
      const card = el('div', { class: 'card ls-section' });
      card.append(cardHead('If you sold in year…',
        'Every possible exit inside the holding period: what the sale returns, what the rent has produced by then, and the rate of return of the whole hold if it ended there.', null, DK));
      const rated = hs.filter(e => isNum(e.irrPct));
      const host = el('div', { style: 'width:100%' });
      card.append(host);
      const t = el('table', { class: 'dt' });
      t.append(el('thead', {}, el('tr', {}, ['Year', 'Sale value', 'Loan outstanding', 'RPGT', 'Net proceeds', 'Rental cash to date', 'Rate of return'].map((h, i) =>
        el('th', { class: i ? 'num' : '' }, h)))));
      const tb = el('tbody');
      hs.forEach(e => tb.append(el('tr', {}, [
        el('td', {}, String(e.yrs)),
        el('td', { class: 'num' }, fmtAmount(e.value, 'MYR')),
        el('td', { class: 'num' }, fmtAmount(e.outstanding, 'MYR')),
        el('td', { class: 'num' }, `${e.rpgtPct}%`),
        el('td', { class: 'num' }, fmtAmount(e.net, 'MYR')),
        el('td', { class: 'num' }, fmtAmount(e.cumCash, 'MYR')),
        el('td', { class: 'num' + (isNum(e.irrPct) ? '' : ' caption'), title: isNum(e.irrPct) ? null : (e.irrWhy || null) }, isNum(e.irrPct) ? fmtPct(e.irrPct, 2) : 'no rate'),
      ])));
      t.append(tb);
      card.append(el('div', { class: 'tablewrap', style: 'margin-top:var(--sm)' }, t));
      card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
        /* Every year, unranked. Naming the year with the highest rate was the
           model choosing an exit by its own measure — the pick this product
           leaves to the reader. */
        (rated.length ? '' : 'No exit year returns a rate under these assumptions. ')
        + 'That is arithmetic on the entered figures — the appreciation rate, the gains-tax band for the year, and how much of the loan is left — and not a view on when to sell. '
        + `Rental cash is ${m.taxComputed ? 'after' : 'before'} tax on the rent.`));
      reportCards.push(card);
      if (rated.length) columnChart(host, { cats: hs.map(e => `Y${e.yrs}`), series: [{ key:'irr', label:'Rate of return if sold that year', values: hs.map(e => isNum(e.irrPct) ? e.irrPct : null), varName:'--s1' }], fmt: v => fmtPct(v, 1), title: 'Rate of return by exit year' });
    }

    /* ---------- what the renovation returns ---------- */
    {
      const rr = renovationReturn(d, m);
      const card = el('div', { class: 'card ls-section' });
      card.append(cardHead('What the renovation returns',
        'The deal as entered against the same deal with no renovation — the rent reduced by the share that depends on it, nothing recovered at the sale.', null, DK));
      if (!rr.applicable) card.append(el('p', { class: 'body', style: 'font-size:var(--ls-support)' }, rr.why));
      else {
        const g = el('div', { class: 'grid g-3' });
        [['Renovation and furnishing', fmtAmount(rr.cost, 'MYR'), 'spent before the property can earn'],
         ['Rent that depends on it', isNum(rr.rentUpliftAnnual) ? `${fmtAmount(rr.rentUpliftAnnual, 'MYR')} a year` : '—', `${fmtPct(rr.rentUpliftPct, 0)} of the entered rent, after vacancy`],
         ['Payback from rent alone', isNum(rr.paybackYears) ? `${fmtNum(rr.paybackYears, 1)} years` : 'never — no rent is attributed to it', 'cost ÷ the rent it produces'],
         ['Recovered at the sale', fmtAmount(rr.valueRecovered, 'MYR'), `${fmtPct(rr.recoveryPct, 0)} of the spend, added to the exit value`],
         ['Rate of return with it', isNum(rr.irrWith) ? fmtPct(rr.irrWith, 2) : 'no rate', 'this deal as entered'],
         ['Rate of return without it', isNum(rr.irrWithout) ? fmtPct(rr.irrWithout, 2) : 'no rate', `${fmtAmount(rr.cashWithout, 'MYR')} safe cash instead of ${fmtAmount(rr.cashWith, 'MYR')}`],
        ].forEach(([k, v, sub]) => g.append(el('div', { class: 'panel ls-fig' }, statTile(k, v, { sub }))));
        card.append(g);
        card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
          (isNum(rr.irrDelta)
            ? `The renovation ${rr.irrDelta >= 0 ? 'adds' : 'costs'} ${fmtNum(Math.abs(rr.irrDelta), 2)} percentage points of return under these two inputs. `
            : '')
          + (rr.rentUpliftPct === 0 && rr.recoveryPct === 0
            ? 'Both inputs are at nought, so the model treats the spend as buying nothing — no rent, no value at the sale. If that is not what you believe, say what you do believe in the two fields under Purchase; the answer will follow.'
            : 'Neither input is observed: what a refit adds to rent and to a sale price is an estimate until a valuer or a tenant says otherwise, and this card says only what follows from the estimate you entered.')));
      }
      reportCards.push(card);
    }

    /* ---------- paid report ---------- */
    const comps = el('div', { class: 'card ls-section' });
    if (m.proj.custom) {
      /* An empty comparables table with "RM null–null" beneath it would read as a
         market with no transactions rather than as a tool with no data. The card
         says which of the two it is. */
      comps.append(cardHead(`Comparable transactions — ${m.proj.area}`,
        'None held for this location.', null, { kind: 'unavailable', fine: 'None held for this location' }));
      comps.append(el('p', { class: 'body', style: 'font-size:var(--ls-support)' },
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
        `${m.proj.type}, ${m.proj.tenure}, ${m.proj.area}. Sample transaction data for demonstration.`, null, { kind: 'illustrative', fine: 'Sample transaction data' }));
      const ctw = el('div', { class: 'tablewrap' });
      const ct = el('table', { class: 'dt' });
      ct.append(el('thead', {}, el('tr', {}, ['Quarter', 'Median psf', 'Transactions', 'vs your price'].map(h => el('th', {}, h)))));
      ct.append(el('tbody', {}, m.proj.txns.map(([q, ppsf, n]) => el('tr', {}, [
        el('td', { class: 'ident' }, q), el('td', {}, `RM${ppsf}`), el('td', {}, String(n)),
        el('td', { class: signClass(m.psf ? ppsf - m.psf : 0) }, m.psf ? withSign((ppsf - m.psf) / m.psf * 100, 1) : '—'),
      ]))));
      ctw.append(ct); comps.append(ctw);
      const rng = el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' });
      rng.append(el('div', { class: 'panel ls-fig' }, statTile('Your price psf', m.psf ? `RM${m.psf.toFixed(0)}` : '—',
        { sub: `Project range RM${m.proj.psfLo}–${m.proj.psfHi}, median RM${m.proj.psfMid}` })));
      rng.append(el('div', { class: 'panel ls-fig' }, statTile('Your rent', `RM${d.rent}`,
        { sub: `Observed range RM${m.proj.rentLo}–${m.proj.rentHi}, median RM${m.proj.rentMid}` })));
      rng.append(el('div', { class: 'panel ls-fig' }, statTile('Area vacancy', fmtPct(m.proj.vacancyPct, 0),
        { sub: `You assumed ${fmtPct(d.vacancyPct, 0)}` })));
      comps.append(rng);
    }
    reportCards.push(comps);

    const inv = el('div', { class: 'card ls-section' });
    inv.append(cardHead('Investment measures', 'Computed from your inputs. Every figure below traces to the assumptions on the left.', null, DK));
    const ig = el('div', { class: 'grid g-4', style: 'margin-bottom:var(--md)' });
    ig.append(el('div', { class: 'panel ls-fig' }, statTile('Net operating income', fmtAmount(m.noi, 'MYR'), { sub: 'Effective rent less operating costs, before the loan' })));
    ig.append(el('div', { class: 'panel ls-fig' }, statTile('Net yield', fmtPct(m.netYield, 2), { sub: 'NOI ÷ purchase price' })));
    ig.append(el('div', { class: 'panel ls-fig' }, statTile('Cash-on-cash', isNum(m.cashOnCash) ? fmtPct(m.cashOnCash, 2) : '—',
      { sub: 'Annual cash flow ÷ cash invested', tone: (m.cashOnCash ?? 0) >= 0 ? '--ok-text' : '--dn-text' })));
    ig.append(el('div', { class: 'panel ls-fig' }, statTile('Debt-service cover', isNum(m.dscr) ? fmtX(m.dscr, 2) : '—',
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
    reportCards.push(inv);

    /* scenario path */
    const sc2 = el('div', { class: 'card ls-section' });
    sc2.append(cardHead(`${d.holdYears}-year scenario`,
      `Capital growth of ${fmtPct(d.apprecPct, 2)} and rent growth of ${fmtPct(d.rentGrowthPct, 2)} a year. A scenario, not a prediction — change either input and the whole path changes.`, null, DK));
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
    reportCards.push(sc2);


    /* equity comparison — the cross-asset point of the whole product */
    const eq2 = el('div', { class: 'card ls-section' });
    eq2.append(cardHead('The same cash in equities',
      `What ${fmtAmount(m.equityOut, 'MYR')} would have to compound at over ${d.holdYears} years to match this property scenario. This is the comparison a spreadsheet in one app and a portfolio in another never lets you make.`, null, DK));
    /* The real rate, not the annualised multiple. Comparing a property against
       a compounding alternative on a figure that ignores timing was the least
       defensible place the old approximation appeared. */
    const need = isNum(m.irrPct) ? m.irrPct : null;
    const eg = el('div', { class: 'grid g-3', style: 'margin-bottom:var(--md)' });
    eg.append(el('div', { class: 'panel ls-fig' }, statTile('Property, internal rate of return', isNum(need) ? fmtPct(need, 2) : '—',
      { sub: `Including leverage, costs and ${m.rpgtPct}% RPGT` })));
    /* The capital the rate of return is measured on, the reserve included —
       the returns panel states the same figure. This tile showed the cash
       before the reserve beside a rate computed on the cash after it. */
    eg.append(el('div', { class: 'panel ls-fig' }, statTile('Cash committed', fmtAmount(m.equityOut, 'MYR'),
      { sub: 'Deposit, entry costs and the reserve — what the rate of return is measured on' })));
    eg.append(el('div', { class: 'panel ls-fig' }, statTile('Monthly commitment',
      isNum(m.cashflowMonthly) ? fmtAmount(monthlyCommitment(m), 'MYR') : '—',
      { sub: !isNum(m.cashflowMonthly) ? 'Not computable — the loan’s instalment is unknown'
        : m.cashflowMonthly >= 0 ? 'Property funds itself' : 'Funded from your income' })));
    eq2.append(eg);
    /* THE READER'S OWN ALTERNATIVE, NOT A PICK LIST. This table was the five
       Bursa names with the highest dividend yield in the dataset — sorted,
       cut to five, each with a quality score and an upside against a model
       estimate, and unlabelled although the rows were illustrative. A ranked
       selection of securities on a property page is a recommendation by
       another name. What the card is for is the reader's stated alternative:
       the equity return they entered, applied to the same capital. */
    const etw = el('div', { class: 'tablewrap' });
    const et = el('table', { class: 'dt' });
    et.append(el('thead', {}, el('tr', {}, ['', ...m.equity.map(q => `Year ${q.yrs}`)].map((h, i) => el('th', { class: i ? 'num' : '' }, h)))));
    et.append(el('tbody', {}, [
      ['The same cash at your equity return', q => fmtAmount(q.value, 'MYR')],
      ['Profit in equities', q => fmtAmount(q.profit, 'MYR')],
      ['Profit in this property', q => fmtAmount(q.propertyProfit, 'MYR')],
      ['Property less equities', q => isNum(q.vsProperty) ? `${q.vsProperty > 0 ? '+' : ''}${fmtAmount(q.vsProperty, 'MYR')}` : '—'],
    ].map(([label, get]) => el('tr', {}, [el('td', {}, label), ...m.equity.map(q => el('td', { class: 'num' }, get(q)))]))));
    etw.append(et); eq2.append(etw);
    eq2.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      `At the ${fmtPct(num0(d.equityReturnPct), 1)} a year you entered under “Assumed equity return” — your figure, not a forecast, and no security is named or preferred.`));
    eq2.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      `The property scenario shows a net yield of ${fmtPct(m.netYield, 2)} before leverage and ${isNum(need) ? fmtPct(need, 2) : '—'} annualised on cash after it. Equities are liquid, divisible and carry no maintenance; property is leveraged, lumpy and illiquid. The comparison is of returns, not of risk.`));
    reportCards.push(eq2);

    /* risk flags */
    const rf = el('div', { class: 'card ls-section' });
    const flags = propertyRiskFlags(d, m);
    rf.append(cardHead(`Risk flags — ${flags.filter(f => f.sev !== 'good').length}`,
      'Computed from your assumptions against the sample project data. Each names the input that triggered it.'));
    const fl = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
    flags.forEach(f => {
      const item = el('div', { class: 'pc-flag' });
      item.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:4px' }, [sevChip(f.sev), el('span', { style: 'font-size:var(--ls-support);font-weight:600' }, f.t)]));
      item.append(el('p', { class: 'body', style: 'font-size:var(--ls-support)' }, f.n));
      fl.append(item);
    });
    rf.append(fl);
    reportCards.push(rf);
  }

  /* ---------- the page, assembled ---------- */
  wrap.append(summaryCard);
  acq.outputs.append(buyCard, dealRoute(d) === 'auction' ? pcAuction(d) : dealRoute(d) === 'newdev' ? pcNewDev(d) : pcPriceEvidence(d));
  fnc.outputs.append(loanCard, finCard, choicesPanel);
  rnt.outputs.append(...[headline, propertyClassOf(d) === 'commercial' ? pcCommercial(d) : null, ops, rentBuyCard].filter(Boolean));
  scn.outputs.append(propertyScenariosPanel(d), sensPanel, stressCard, returnsPanel);
  rpt.outputs.append(checkCard, gatesPanel, demandCard, envCard, ev, ...reportCards, propertyReportNext(d), propertyProposalNext(d), regNote);
  [acq, fnc, rnt, scn, rpt].forEach(s => wrap.append(s.node));
  return wrap;
};

