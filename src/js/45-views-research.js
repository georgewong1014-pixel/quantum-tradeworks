/* ==========================================================================
   VIEW — RESEARCH
   ========================================================================== */

/* ==========================================================================
   EQUITY STRATEGY LENS — directive 7, specification 37 to 43

   THE FOUR THINGS "STOCK TYPE" USED TO MEAN AT ONCE

     legal instrument   ordinary share, REIT, stapled security, ETF
     business archetype bank, plantation, contractor, utility, developer
     return role        why someone might own it
     entry method       lump sum, staged, DCA, trend

   Capital gain is an outcome, not an asset type. DCA is an entry method, not
   evidence the business is worth owning. Collapsing these produced one score
   that answered none of them.

   THE GATE THAT DECIDES MOST OF THIS

   Directive 7.9 and specification 37.3: a fit grade may not be produced from
   synthetic, reconstructed, stale or missing data. That is not a footnote here,
   it is the dominant fact — 18 Malaysian companies carry illustrative figures,
   and no company in this build carries a licensed price. So most fits return U,
   and the honest reading of this page is that it says what it cannot assess far
   more often than it grades anything.

   That is the intended behaviour. A weak grade computed from an illustration
   would be worse than no grade, because it would look like research. */
const INSTRUMENT_TYPES = {
  reit:    { label:'Real estate investment trust', note:'A trust distributing rental income, taxed and regulated differently from an ordinary share.' },
  bank:    { label:'Ordinary share', note:'Ordinary equity in a licensed bank.' },
  insurer: { label:'Ordinary share', note:'Ordinary equity in an insurer.' },
  default: { label:'Ordinary share', note:'Ordinary equity carrying residual claims on earnings and assets.' },
};
const BUSINESS_ARCHETYPES = {
  bank:'Bank', insurer:'Insurer', reit:'Real estate trust', mature:'Mature operating company',
  growth:'Secular grower', saas:'Software and subscription', cyclical:'Cyclical or commodity-linked',
  holding:'Holding company', early:'Early-stage or loss-making',
};
const RETURN_ROLES = {
  income:     { label:'Dividend income',        why:'Recurring distributions supported by earnings and a balance sheet that can keep paying them.' },
  compounder: { label:'Long-term compounding',  why:'Growth in per-share earnings and business value over several years.' },
  cyclical:   { label:'Cyclical recovery',      why:'Earnings may recover as a commodity, inventory or credit cycle turns.' },
  value:      { label:'Value or re-rating',     why:'Price may differ from an evidence-based valuation range, with a mechanism to close the gap.' },
  catalyst:   { label:'Catalyst or event',      why:'A dated event may change earnings, cash flow or capital structure.' },
  trend:      { label:'Trend following',        why:'Capture a persistent price trend while controlling the loss when it fails.' },
  turnaround: { label:'Turnaround',             why:'Material improvement from a distressed or loss-making base.' },
  defensive:  { label:'Capital preservation',   why:'Lower variability of outcome rather than growth.' },
};

/* Which fits are even applicable before any data is considered. A REIT is not a
   turnaround candidate by virtue of being a REIT, and a bank has no
   conventional free cash flow to test a compounder case against. */
const STRATEGY_FITS = [
  { k:'income',     label:'Income' },
  { k:'compounder', label:'Quality compounder' },
  { k:'cyclical',   label:'Cyclical' },
  { k:'value',      label:'Value / re-rating' },
  { k:'catalyst',   label:'Catalyst' },
  { k:'trend',      label:'Trend' },
  { k:'dca',        label:'DCA eligibility' },
  { k:'wheel',      label:'US Cash Wheel' },
];

/* ==========================================================================
   US OPTIONS CASH WHEEL — specification 41A, directive 7.11

   A repeating, FULLY COLLATERALISED two-phase process:

     cash-secured put -> assignment or expiry
     shares held      -> covered call -> called away or expiry

   THE TWO GATES THAT CANNOT BE BYPASSED

   A put is cash-secured only when reserved cash covers the ENTIRE assignment
   notional plus fees. The opening premium is NOT deducted from that
   requirement — 41A.7 is explicit, and the reason is that the broker's
   treatment of unsettled premium, withdrawal rules and settlement state are not
   knowable here. Reserving less than the full exercise cost is how a "cash
   secured" put stops being cash secured.

   A call is covered only when unencumbered shares cover the ENTIRE deliverable.
   Shares pledged, lent, committed to another call or subject to a pending sale
   cannot be counted twice.

   Failing either gate does not produce a lower score. It produces a refusal.

   THE ARITHMETIC THAT MATTERS MOST

   Premium cash received is not realised profit while the option is open. The
   ledger shows the cash receipt and the open obligation side by side, because
   a premium presented as income while an unlimited-ish downside sits open is
   the single most misleading thing this module could do.

   Contract multiplier and deliverable come from the contract, never from an
   assumption that every option is 100 unadjusted shares. A split or special
   distribution changes the deliverable, and an adjusted contract whose terms
   are unavailable returns U rather than a guess.
   ========================================================================== */
const WHEEL_STATES = [
  { id:'candidate',   label:'Candidate',          phase:'none' },
  { id:'put_planned', label:'Put planned',        phase:'put' },
  { id:'put_open',    label:'Put open',           phase:'put' },
  { id:'put_expired', label:'Put expired',        phase:'put' },
  { id:'put_closed',  label:'Put closed',         phase:'put' },
  { id:'put_assigned',label:'Put assigned',       phase:'shares' },
  { id:'shares_held', label:'Shares held',        phase:'shares' },
  { id:'call_planned',label:'Call planned',       phase:'call' },
  { id:'call_open',   label:'Call open',          phase:'call' },
  { id:'call_expired',label:'Call expired',       phase:'call' },
  { id:'call_closed', label:'Call closed',        phase:'call' },
  { id:'called_away', label:'Shares called away', phase:'complete' },
  { id:'complete',    label:'Cycle complete',     phase:'complete' },
  { id:'paused',      label:'Paused',             phase:'paused' },
];

/* Every calculation in 41A.7 to 41A.9, in one place so the UI cannot invent a
   variant. Returns nulls rather than guesses wherever a term is unknown. */
function wheelMath(p) {
  const mult = num0(p.contractMultiplier);
  const contracts = num0(p.contracts);
  const deliverableShares = mult * contracts;
  /* W6. An adjusted contract whose deliverable has not been verified cannot be
     collateralised or yielded, because the number of shares it delivers is the
     input every other figure depends on. Suppressed rather than computed from
     the standard multiplier — a plausible number here would be worse than none,
     since the whole hazard of an adjusted contract is that it looks normal. */
  const deliverableUnknown = !!p.adjustedContract && !p.adjustmentVerified;
  const out = { deliverableShares, deliverableUnknown,
                valid: deliverableShares > 0 && !deliverableUnknown,
                suppressedReason: deliverableUnknown ? 'Adjusted contract terms incomplete' : null };
  if (!out.valid) return out;

  /* ---- put ---- */
  out.assignmentNotional = num0(p.putStrike) * deliverableShares;
  out.grossPutPremium = num0(p.putCredit) * deliverableShares;
  out.putPremiumCashReceived = out.grossPutPremium - num0(p.openCommission) - num0(p.openFees);
  out.requiredAssignmentCash = out.assignmentNotional + num0(p.assignmentFees);
  /* The premium is deliberately NOT netted off. 41A.7. */
  out.cashCoveragePct = out.requiredAssignmentCash > 0
    ? num0(p.eligibleCashUsd) / out.requiredAssignmentCash : null;
  out.cashSecured = isNum(out.cashCoveragePct) && out.cashCoveragePct >= 1;
  out.putPeriodCashYield = out.assignmentNotional > 0
    ? out.putPremiumCashReceived / out.assignmentNotional : null;
  /* TWO BASES, AND THEY ARE NOT INTERCHANGEABLE.

     shareCostBasis is what the shares COST: the strike plus the fees paid to
     acquire them. It is the accounting basis, and it is the one the ledger uses,
     because the ledger reports the put premium separately as option P&L.

     economicShareBasis subtracts the put premium as well. It is a BREAK-EVEN —
     the price below which the whole position is under water once the premium is
     counted — and it is the right number for the forward-looking projections
     beneath it, which add only the call premium on top.

     Mixing them is what produced a completed cycle overstated by exactly the put
     premium: realised share P&L was measured against the premium-reduced basis
     while realised option P&L added the same premium again. £1 of cash, counted
     twice, because two self-consistent conventions were half-applied. */
  out.shareCostBasis = deliverableShares > 0
    ? num0(p.putStrike) + num0(p.assignmentFees) / deliverableShares
    : null;
  out.economicShareBasis = deliverableShares > 0
    ? num0(p.putStrike) + num0(p.assignmentFees) / deliverableShares
      - out.putPremiumCashReceived / deliverableShares
    : null;
  out.putMaxLossIfZero = out.assignmentNotional + num0(p.assignmentFees) - out.putPremiumCashReceived;
  out.putBreakEven = out.economicShareBasis;

  /* MYR, with the user's own FX buffer. A USD obligation met from ringgit is a
     larger obligation than the USD figure suggests. */
  const rate = num0(p.myrPerUsd) || FX.USDMYR;
  out.safeAssignmentCashMyr = out.requiredAssignmentCash * rate * (1 + num0(p.fxBufferPct) / 100)
    + num0(p.fxConversionCostMyr);

  /* ---- call ---- */
  out.requiredCoveredShares = deliverableShares;
  out.shareCoveragePct = out.requiredCoveredShares > 0
    ? num0(p.eligibleShares) / out.requiredCoveredShares : null;
  out.covered = isNum(out.shareCoveragePct) && out.shareCoveragePct >= 1;
  out.grossCallPremium = num0(p.callCredit) * deliverableShares;
  out.callPremiumCashReceived = out.grossCallPremium - num0(p.callOpenCommission) - num0(p.callOpenFees);
  const basis = isNum(p.economicShareBasisOverride) ? p.economicShareBasisOverride : out.economicShareBasis;
  out.basisUsed = basis;
  out.calledAwayGrossValue = num0(p.callStrike) * out.requiredCoveredShares;
  out.coveredCallBreakEven = isNum(basis) && out.requiredCoveredShares > 0
    ? basis - out.callPremiumCashReceived / out.requiredCoveredShares : null;
  out.coveredCallMaxProfit = isNum(basis)
    ? (num0(p.callStrike) - basis) * out.requiredCoveredShares + out.callPremiumCashReceived
      + num0(p.realisedDividends) - num0(p.remainingResolutionCosts)
    : null;
  out.coveredCallMaxLoss = isNum(basis)
    ? basis * out.requiredCoveredShares - out.callPremiumCashReceived
      - num0(p.realisedDividends) + num0(p.remainingResolutionCosts)
    : null;
  /* A call struck below the basis locks in a loss if assigned. Named, because
     the premium alone would read as income. */
  out.callBelowBasis = isNum(basis) && num0(p.callStrike) < basis;
  out.lockedInLossIfCalled = out.callBelowBasis
    ? (basis - num0(p.callStrike)) * out.requiredCoveredShares - out.callPremiumCashReceived : null;

  /* Simple annualisation, labelled as such wherever it appears. */
  const days = num0(p.calendarDaysOpen);
  out.simpleAnnualisedPutYield = (isNum(out.putPeriodCashYield) && days > 0)
    ? out.putPeriodCashYield * 365 / days : null;

  return out;
}

/* Scenario payoff at an expiry price, per 41A.8 and 41A.9. */
function wheelScenario(p, m, expiryPrice) {
  const s = { expiryPrice };
  if (!m.valid) return s;
  s.shortPutPnl = m.putPremiumCashReceived
    - Math.max(0, num0(p.putStrike) - expiryPrice) * m.deliverableShares
    - num0(p.remainingResolutionCosts);
  const basis = m.basisUsed;
  if (isNum(basis)) {
    s.coveredCallPnl = Math.min(expiryPrice, num0(p.callStrike)) * m.requiredCoveredShares
      - basis * m.requiredCoveredShares
      + m.callPremiumCashReceived + num0(p.realisedDividends) - num0(p.remainingResolutionCosts);
  }
  return s;
}

/* 41A.4 and 7.11.3. Every gate must be KNOWN, not merely favourable. */
function wheelFit(p, m, r) {
  const gates = [], supports = [];
  if (m.deliverableUnknown)
    gates.push('Adjusted contract terms incomplete. Splits, mergers and special distributions change what a contract delivers, so collateral and yield are suppressed rather than computed from a standard multiplier.');
  else if (!m.valid) gates.push('Contract multiplier and number of contracts are required before anything can be assessed.');
  if (p.settlementType && p.settlementType !== 'physical')
    gates.push('Only physically settled options are supported. A cash-settled contract cannot deliver the shares the Wheel depends on.');
  if (!p.willingToOwnFull) gates.push('You have not confirmed you are willing and able to own the entire put deliverable at the strike.');
  if (p.phase === 'call' && !p.willingToSellAtStrike)
    gates.push('You have not confirmed you are willing to sell the entire covered quantity at the call strike.');
  if (!p.optionsApprovalAttested) gates.push('Broker options approval and US market access have not been attested.');
  if (!p.quoteTimestamp) gates.push('No quote timestamp. A premium yield computed from an undated quote is not assessable.');
  if (p.phase !== 'call' && !m.cashSecured)
    gates.push(isNum(m.cashCoveragePct)
      ? `Cash covers ${fmtPct(m.cashCoveragePct * 100, 1)} of the ${fmtMoney(m.requiredAssignmentCash, 'USD')} assignment obligation. A put is not cash-secured below 100%, and the premium does not reduce the requirement.`
      : 'Eligible cash has not been entered, so the put cannot be shown as cash-secured.');
  if (p.phase === 'call' && !m.covered)
    gates.push(isNum(m.shareCoveragePct)
      ? `Unencumbered shares cover ${fmtPct(m.shareCoveragePct * 100, 1)} of the ${m.requiredCoveredShares}-share deliverable. A call is not covered below 100%.`
      : 'Eligible shares have not been entered, so the call cannot be shown as covered.');

  const thesis = p.underlyingThesisStatus || 'unknown';
  if (thesis !== 'pass') gates.push(`The underlying thesis is "${thesis}". The Wheel is a way of acquiring or holding a company, so the company has to be researched first.`);
  else supports.push('Underlying thesis passes.');

  if (m.cashSecured) supports.push('Full assignment cash reserved, before premium.');
  if (p.phase === 'call' && m.covered) supports.push('Full share deliverable held and unencumbered.');
  if (p.eventWindowClear) supports.push('No earnings or ex-dividend date inside the contract window.');
  else gates.push('Earnings, ex-dividend and corporate-action dates in the contract window have not been confirmed clear.');

  let grade = 'U', score = null;
  if (!gates.length) {
    score = Math.round(clamp(60 + supports.length * 8, 0, 100));
    grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  }
  return { grade, score, gates, supports };
}

/* ==========================================================================
   CYCLE LEDGER AND STATE MACHINE — specification 41A.5, 41A.11, 41A.13

   THE ROLL RULE IS THE POINT OF THIS

   "Rolled for a credit" is the most comfortable sentence in options trading
   and frequently the least informative. A roll is TWO transactions: a close
   that realises a result, and an opening that creates a new obligation. Netting
   them into one credit hides whichever half was a loss.

   So a roll here can only be recorded as two legs. The closed leg keeps its
   realised result permanently, the new leg carries its own contract and expiry,
   and the net figure is shown as a third line beside both rather than instead
   of them.

   PREMIUM IS NOT PROFIT UNTIL THE LEG RESOLVES

   41A.11 separates cash received from realised profit. A leg that is still open
   contributes its premium to CASH and nothing to realised P&L, and carries an
   open obligation alongside. Only expiry, close or assignment moves it.
   ========================================================================== */
const WHEEL_TRANSITIONS = {
  candidate:   ['put_planned'],
  put_planned: ['put_open', 'candidate'],
  put_open:    ['put_expired', 'put_closed', 'put_assigned', 'paused'],
  put_expired: ['candidate'],
  put_closed:  ['candidate'],
  put_assigned:['shares_held'],
  shares_held: ['call_planned', 'complete', 'paused'],
  call_planned:['call_open', 'shares_held'],
  call_open:   ['call_expired', 'call_closed', 'called_away', 'paused'],
  call_expired:['shares_held'],
  call_closed: ['shares_held'],
  called_away: ['complete'],
  complete:    ['candidate'],
  paused:      ['candidate', 'shares_held'],
};

State.wheelLegs = store.read('wheelLegs', []);
const saveWheelLegs = () => store.write('wheelLegs', State.wheelLegs);

/* Every figure 41A.11 requires kept apart. Nothing is netted that the
   specification asks to be shown separately. */
function wheelLedger(legs) {
  const L = legs || [];
  const t = {
    grossPremiumQuoted: 0, premiumCashReceived: 0, openOptionLiability: 0,
    realisedOptionPnl: 0, shareAcquisitionCash: 0, realisedSharePnl: 0, shareSaleProceeds: 0,
    dividends: 0, commissions: 0, fees: 0, fxCostMyr: 0,
    openLegs: 0, resolvedLegs: 0, maxCapitalCommitted: 0,
  };
  L.forEach(l => {
    t.grossPremiumQuoted += num0(l.grossPremium);
    t.commissions += num0(l.commissions);
    t.fees += num0(l.fees);
    t.fxCostMyr += num0(l.fxCostMyr);
    t.dividends += num0(l.dividends);
    if (l.action === 'open') {
      t.premiumCashReceived += num0(l.netCash);
      if (l.status === 'open') { t.openLegs++; t.openOptionLiability += num0(l.currentCloseCost); }
    }
    /* A close is cash OUT. Recorded as a negative receipt so the cash column
       stays a cash column rather than becoming a profit column. */
    if (l.action === 'close') t.premiumCashReceived += num0(l.netCash);
    if (isNum(l.realisedPnl)) { t.realisedOptionPnl += l.realisedPnl; t.resolvedLegs++; }
    if (l.action === 'assign') t.shareAcquisitionCash += num0(l.cashPaid);
    if (l.action === 'called_away') {
      t.realisedSharePnl += num0(l.realisedSharePnl);
      t.shareSaleProceeds += num0(l.shareSaleProceeds);
    }
    t.maxCapitalCommitted = Math.max(t.maxCapitalCommitted, num0(l.capitalCommitted));
  });
  t.totalRealisedCyclePnl = t.realisedOptionPnl + t.realisedSharePnl + t.dividends;

  /* THE SAME ANSWER, DERIVED A SECOND WAY.

     The total above is built from per-leg P&L. This one is built from cash that
     actually moved: premiums received net of what was paid to close, plus what
     the shares sold for, less what they cost. On a closed cycle the two must
     agree, and when they do not it is because some figure has been counted
     twice or not at all — which is exactly the defect that shipped here.

     It is computed rather than asserted so the page can show the difference
     instead of quietly presenting whichever number it happened to reach first. */
  t.cashFlowRealised = t.premiumCashReceived + t.shareSaleProceeds
    - t.shareAcquisitionCash + t.dividends;
  t.cycleClosed = t.openLegs === 0 && t.resolvedLegs > 0;
  t.reconciliationGap = t.totalRealisedCyclePnl - t.cashFlowRealised;
  t.reconciles = !t.cycleClosed || Math.abs(t.reconciliationGap) < 0.005;

  t.cycleReturnOnMaxCommitted = t.maxCapitalCommitted > 0
    ? t.totalRealisedCyclePnl / t.maxCapitalCommitted : null;
  return t;
}

const newLegId = () => `leg-${(State.wheelLegs || []).length + 1}-${WHEEL_LEG_SEQ++}`;
let WHEEL_LEG_SEQ = 1;

function addWheelLeg(leg) {
  State.wheelLegs = [...(State.wheelLegs || []), { id: newLegId(), ...leg }];
  saveWheelLegs();
}

/* A roll, recorded the only way it may be. Returns both legs so a caller
   cannot accidentally create one without the other. */
function rollWheelLeg(openLeg, closeDebitPerShare, newContract) {
  const shares = num0(openLeg.shares);
  const closeCash = -(num0(closeDebitPerShare) * shares) - num0(newContract.closeCommission);
  const realised = num0(openLeg.netCash) + closeCash;
  addWheelLeg({ ...openLeg, id: undefined, action:'close', status:'resolved',
    parentLegId: openLeg.id, netCash: closeCash, realisedPnl: realised,
    grossPremium: -(num0(closeDebitPerShare) * shares),
    commissions: num0(newContract.closeCommission), note:'Closing the previous contract.' });
  /* The original open leg is marked resolved but keeps its own record. */
  const idx = State.wheelLegs.findIndex(x => x.id === openLeg.id);
  if (idx > -1) State.wheelLegs[idx] = { ...State.wheelLegs[idx], status:'resolved', rolledInto: newContract.label };
  const openCash = num0(newContract.creditPerShare) * num0(newContract.shares) - num0(newContract.openCommission);
  addWheelLeg({ phase: openLeg.phase, action:'open', status:'open',
    contractLabel: newContract.label, strike: newContract.strike, expiry: newContract.expiry,
    shares: newContract.shares, grossPremium: num0(newContract.creditPerShare) * num0(newContract.shares),
    commissions: num0(newContract.openCommission), netCash: openCash,
    capitalCommitted: num0(newContract.strike) * num0(newContract.shares),
    rollGroupId: openLeg.id, note:'New contract opened as part of a roll. A separate obligation, not a continuation.' });
  saveWheelLegs();
  return { realisedOnClose: realised, openedFor: openCash, netRollCash: closeCash + openCash };
}

State.wheel = store.read('wheelPlan', null) || {
  symbol:'', underlyingThesisStatus:'unknown', phase:'put', state:'candidate',
  contractMultiplier:100, contracts:1, adjustedContract:false, adjustmentVerified:false,
  settlementType:'physical',
  putStrike:0, putCredit:0, openCommission:0, openFees:0, assignmentFees:0,
  callStrike:0, callCredit:0, callOpenCommission:0, callOpenFees:0,
  eligibleCashUsd:0, eligibleShares:0, realisedDividends:0, remainingResolutionCosts:0,
  myrPerUsd:0, fxBufferPct:5, fxConversionCostMyr:0, calendarDaysOpen:30,
  willingToOwnFull:false, willingToSellAtStrike:false, optionsApprovalAttested:false,
  eventWindowClear:false, quoteTimestamp:'',
  economicShareBasisOverride:null, shareCostBasisOverride:null,
  /* Which company page sent the reader here, if any. Recorded so a saved plan
     can name the research it came from rather than floating free of it. */
  sourceCompanyId:null, sourceTicker:'', sourceLinkedAt:'',
};
const saveWheel = () => store.write('wheelPlan', State.wheel);

/* THE WORKED CONTRACT, AND THE WAY BACK OUT OF IT.
   ---------------------------------------------------------------------------
   Round numbers on no particular company, deliberately. A worked example that
   named a real ticker would have to carry a strike and a premium for it, and
   the moment those appear beside the company's name they read as a quote —
   which this build has no chain data to support and no right to imply. A $50
   strike against 100 shares and $5,000 of collateral is transparently a
   teaching case and reconciles exactly: $109 of premium against $4,891 of
   downside, the same pair the homepage states.

   WHEEL_BLANK_CONTRACT is the same keys with the contract emptied, so clearing
   restores a genuinely blank tool rather than leaving fragments of the example
   behind for the reader's own figures to be mixed into. */
const WHEEL_WORKED_EXAMPLE = {
  symbol: '', contractMultiplier: 100, contracts: 1,
  putStrike: 50, putCredit: 1.10,
  openCommission: 1, openFees: 0, assignmentFees: 0,
  eligibleCashUsd: 5000, myrPerUsd: 4.42, fxBufferPct: 5, calendarDaysOpen: 30,
  quoteTimestamp: '',
};
const WHEEL_BLANK_CONTRACT = {
  putStrike: 0, putCredit: 0, contracts: 0,
  openCommission: 0, openFees: 0, assignmentFees: 0,
  eligibleCashUsd: 0, calendarDaysOpen: 0, quoteTimestamp: '',
};

/* Directive 7.9. The tier decides what may be shown at all, and it is decided
   by the data rather than by the company. */
function coverageTier(r) {
  const c = r.c;
  if (!c.real) return { id:'unassessed', label:'Unassessed',
    why:'Financial figures for this company are illustrative, not filed. Nothing here may produce a strategy grade.' };
  const priced = isNum(c.px?.p);
  const complete = isNum(c.completeness) ? c.completeness : (isNum(r.m?.coverage) ? r.m.coverage / 100 : 0);
  if (priced && complete >= 0.9) return { id:'verified', label:'Verified Core',
    why:'Filed statements and a price, with high coverage.' };
  if (complete >= 0.7) return { id:'standard', label:'Standard Coverage',
    why: priced ? 'Filed statements and a price, with gaps in the statement lines.'
                : 'Filed statements with no licensed price, so anything price-derived cannot be assessed.' };
  return { id:'directory', label:'Basic Directory',
    why:'Identity and partial figures only. Not enough to assess a strategy.' };
}

/* WHY ONE LETTER WAS NOT ENOUGH
   ---------------------------------------------------------------------------
   748 of the 1,104 fit grades in this universe read U, and U was carrying at
   least four different statements at once: this does not apply to the business,
   the evidence is missing, the feature does not exist in this prototype, and
   the figures are illustrative. On a single company "Cyclical U", "Catalyst U"
   and "Trend U" sat side by side and were indistinguishable — one meant the
   business is not cyclical, one meant no catalyst registry has been built, one
   meant no price licence exists.

   Two of those are statements about the COMPANY and two are statements about
   the PRODUCT, which is the distinction a reader most needs and the one a
   single letter destroys. Two-thirds of everything this lens outputs was a
   letter with no legend.

   There is deliberately no "Demo only" GRADE. A grade is never computed on
   illustrative figures, so a grade-shaped token would imply one had been. The
   illustrative case is a state instead, and it says the figures are synthetic
   rather than implying a result was reached from them. */
const FIT_STATES = {
  graded:         { token:null,     label:'Graded',         why:'Evidence was sufficient to grade against the criteria.' },
  missing:        { token:'U',      label:'Unassessed',     why:'The strategy applies here, but evidence it needs is missing.' },
  not_applicable: { token:'n/a',    label:'Not applicable', why:'The strategy does not apply to this instrument or business. More data would not change it.' },
  not_built:      { token:'—',      label:'Not built',      why:'This prototype does not hold what the test would need, for every company.' },
  illustrative:   { token:'illus.', label:'Illustrative',   why:'This company’s figures are synthetic, so no grade may be produced from them at all.' },
};

/* One fit. Returns a grade, or far more often a state saying why there is none. */
function fitGrade(r, key, tier) {
  const { c, m } = r;
  const out = { key, label: STRATEGY_FITS.find(f => f.k === key).label,
                grade:'U', state:'missing', score:null, supports:[], weakens:[], missing:[], cap:null };

  /* APPLICABILITY BEFORE DATA QUALITY.
     The coverage-tier gate used to run first, so a Bursa company's Cash Wheel
     reported "Filed financial statements. The figures held are illustrative."
     — telling the reader that audited filings would unlock it. They would not.
     This build covers no Bursa options at all, and no amount of data changes
     a market that is not in the product. */
  if (key === 'wheel' && c.mkt !== 'US') {
    out.state = 'not_applicable';
    out.cap = 'The Cash Wheel covers US-listed stocks and ETFs. Bursa options are not in this build, so this is not a question data could answer.';
    return out;
  }

  if (tier.id === 'unassessed') {
    out.state = 'illustrative';
    out.missing.push('Filed financial statements. The figures held for this company are illustrative.');
    return out;
  }

  const priced = isNum(c.px?.p);
  /* Trend needs an observed, adjusted price series. There is none in this
     build, and specification 39.6 forbids substituting a reconstruction. */
  if (key === 'trend') {
    out.state = 'not_built';
    out.missing.push('An observed, corporate-action-adjusted price history under a licence that permits its use.');
    out.cap = 'No licensed price history exists in this build, for any company. A reconstructed series may not be substituted.';
    return out;
  }

  const need = (cond, label) => { if (!cond) out.missing.push(label); return cond; };

  if (key === 'income') {
    const hasDiv = isNum(m.dy) || isNum(m.payout);
    need(priced, 'A price, without which distribution yield cannot be computed.');
    need(hasDiv, 'Distribution history and payout evidence.');
    if (!priced || !hasDiv) return out;
    if (isNum(m.payout) && m.payout < 80) out.supports.push(`Payout ratio ${fmtPct(m.payout, 0)} of earnings.`);
    else if (isNum(m.payout)) out.weakens.push(`Payout ratio ${fmtPct(m.payout, 0)} leaves little room for a weaker year.`);
    if (isNum(m.cashPayout) && m.cashPayout < 90) out.supports.push(`Distributions are ${fmtPct(m.cashPayout, 0)} of free cash flow.`);
    else if (isNum(m.cashPayout)) out.weakens.push('Distributions exceed or nearly exhaust free cash flow.');
    out.score = Math.round(clamp(60 + (isNum(m.dy) ? m.dy * 5 : 0) - (isNum(m.payout) ? Math.max(0, m.payout - 70) : 0), 0, 100));
  }

  else if (key === 'compounder') {
    const hasGrowth = isNum(m.rev5) && isNum(m.roe);
    if (!need(hasGrowth, 'Multi-year per-share growth and returns on equity.')) return out;
    if (m.roe > 12) out.supports.push(`Return on equity ${fmtPct(m.roe, 1)}.`); else out.weakens.push(`Return on equity ${fmtPct(m.roe, 1)}.`);
    if (m.rev5 > 4) out.supports.push(`Revenue compounding ${fmtPct(m.rev5, 1)} a year over the window held.`);
    else out.weakens.push(`Revenue growth ${fmtPct(m.rev5, 1)} a year.`);
    if (isNum(m.dilution) && m.dilution > 2) out.weakens.push(`Share count rising ${fmtPct(m.dilution, 1)} a year, which dilutes per-share growth.`);
    out.score = Math.round(clamp((r.scores?.quality?.score ?? 50) * 0.7 + clamp(m.rev5 * 2, 0, 30), 0, 100));
    if (isNum(m.growthYears) && m.growthYears < 4) out.cap = `Growth measured over ${m.growthYears} years, not four.`;
  }

  else if (key === 'cyclical') {
    if (c.type !== 'cyclical') {
      out.state = 'not_applicable';
      out.cap = `Classified as ${BUSINESS_ARCHETYPES[c.type] ? BUSINESS_ARCHETYPES[c.type].toLowerCase() : 'a non-cyclical business'}, so there is no cycle to test. This is a statement about the business, not about the data held on it.`;
      return out;
    }
    if (!need(isNum(m.revDD), 'Revenue drawdown history to locate the cycle.')) return out;
    out.supports.push(`Largest revenue fall in the window held: ${fmtPct(m.revDD, 0)}.`);
    out.missing.push('A named cycle indicator, mid-cycle normalisation and supply-response evidence.');
    out.cap = 'Capped without cycle evidence — a cyclical case needs the cycle, not only the volatility.';
    out.score = 45;
  }

  else if (key === 'value') {
    if (!need(priced, 'A price. Without one there is no gap between price and model to measure.')) return out;
    if (!need(!r.val?.err && isNum(r.val?.mos?.base), 'A valuation model that could be built.')) return out;
    const mos = r.val.mos.base;
    if (mos > 20) out.supports.push(`Price sits ${fmtPct(mos, 0)} below the base-case model estimate.`);
    else out.weakens.push(`Price is ${fmtPct(Math.abs(mos), 0)} ${mos < 0 ? 'above' : 'below'} the base-case estimate.`);
    out.missing.push('A named mechanism and time path for the gap to close.');
    out.score = Math.round(clamp(50 + mos, 0, 100));
  }

  else if (key === 'catalyst') {
    out.state = 'not_built';
    out.missing.push('A dated, sourced event with dependencies and a failure case.');
    out.cap = 'No catalyst registry exists in this build, for any company. This is a missing feature rather than a missing figure.';
    return out;
  }

  else if (key === 'wheel') {
    /* 41A.3: US-listed underlyings only, and the contract, collateral and quote
       evidence live in the Wheel workspace rather than on a company page. This
       fit reports whether the UNDERLYING could support a Wheel at all. */
    /* The non-US case is decided at the top of this function, before the
       coverage tier, so it cannot be reported as a data problem. */
    const q = r.scores?.quality?.score;
    if (!need(isNum(q), 'A business-quality assessment of the underlying.')) return out;
    out.missing.push('A verified contract, its deliverable, an authorised quote and your full collateral. Those are entered in the Wheel workspace, and no chain data exists in this build.');
    if (q >= 60) out.supports.push(`Business quality ${q}/100 — the Wheel means being willing to own this company.`);
    else out.weakens.push(`Business quality ${q}/100. A Wheel on a business you would not want to own is a way of acquiring it anyway.`);
    out.cap = 'Underlying assessment only. Wheel fit itself is decided in the workspace, where collateral is checked.';
    out.score = Math.round(clamp(q, 0, 100));
  }

  else if (key === 'dca') {
    /* An entry method, gated on the thing being worth owning at all. */
    const q = r.scores?.quality?.score;
    if (!need(isNum(q), 'A business-quality assessment.')) return out;
    if (!need(tier.id !== 'directory', 'Sufficient data coverage to keep a schedule under review.')) return out;
    if (c.type === 'early' || c.type === 'cyclical') {
      /* This branch returned with an EMPTY missing array, so the card's tooltip
         fell through to "Not assessable: required evidence is missing." when
         nothing was missing at all — the evidence was present and the policy
         refused it. That tooltip was simply false, on 32 companies. */
      out.state = 'not_applicable';
      out.weakens.push('Early-stage and cyclical businesses are not eligible by default — a schedule can average into a deteriorating position.');
      out.cap = 'Refused by policy for this business type, with the evidence present. Nothing is missing; a schedule is not offered here.';
      return out;
    }
    if (q >= 60) out.supports.push(`Business quality ${q}/100.`); else out.weakens.push(`Business quality ${q}/100.`);
    out.missing.push('A review cadence and maximum exposure, which are yours to set rather than this tool’s to assume.');
    out.score = Math.round(clamp(q, 0, 100));
  }

  if (isNum(out.score) && !out.missing.length) {
    out.state = 'graded';
    out.grade = out.score >= 80 ? 'A' : out.score >= 65 ? 'B' : out.score >= 50 ? 'C' : 'D';
  } else if (isNum(out.score)) {
    out.state = 'graded';
    /* Evidence exists but is incomplete: graded no higher than B, per the
       specification's rule that a missing requirement caps rather than passes. */
    out.grade = out.score >= 65 ? 'B' : out.score >= 50 ? 'C' : 'D';
    out.cap = out.cap || 'Capped while evidence is missing.';
  }
  return out;
}

function strategyLens(r) {
  const { c, m } = r;
  const tier = coverageTier(r);
  const instrument = INSTRUMENT_TYPES[c.type] || INSTRUMENT_TYPES.default;
  const archetype = BUSINESS_ARCHETYPES[c.type] || 'Operating company';
  const fits = STRATEGY_FITS.map(f => fitGrade(r, f.k, tier));

  /* The primary role follows the best-supported fit, and is withheld entirely
     when nothing could be assessed — an unassessable company has no return
     role this product is entitled to name. */
  const graded = fits.filter(f => f.state === 'graded' && isNum(f.score)).sort((a, b) => b.score - a.score);
  /* DCA is deliberately absent from this map: it is an entry METHOD, not a
     reason to own the business, and 37.1 is explicit that treating it as one is
     the confusion this whole section exists to undo. The role search therefore
     skips past it rather than stopping — an earlier version checked only the
     top-scoring fit, so a company whose best score was DCA reported no return
     role at all while three roles sat graded beneath it. */
  const roleOf = { income:'income', compounder:'compounder', cyclical:'cyclical', value:'value', catalyst:'catalyst' };
  const roleFits = graded.filter(f => roleOf[f.key]);
  const primary = roleFits[0] ? RETURN_ROLES[roleOf[roleFits[0].key]] : null;
  const secondary = roleFits[1] ? RETURN_ROLES[roleOf[roleFits[1].key]] : null;
  /* notSuited was computed here and never rendered — dead since it was written,
     and actively misleading if it ever had been: a fit this product cannot test
     is not one the company is unsuited to. Counting by state replaces it. */
  const byState = {};
  fits.forEach(f => { byState[f.state] = (byState[f.state] || 0) + 1; });

  return { tier, instrument, archetype, fits, primary, secondary, byState,
           assessable: graded.length > 0 };
}

const RESEARCH_TABS = [
  { id:'snapshot',  label:'Snapshot' },
  { id:'business',  label:'Business' },
  { id:'financials',label:'Financials' },
  { id:'quality',   label:'Quality' },
  { id:'valuation', label:'Valuation' },
  { id:'moat',      label:'Moat' },
  { id:'risks',     label:'Risks' },
  { id:'ownership', label:'Ownership & actions' },
  { id:'filings',   label:'Filings' },
  { id:'thesis',    label:'Thesis' },
];

function toggleWatch(id, wlIdx = State.wlIdx) {
  const wl = State.watchlists[wlIdx] || activeWL();
  if (wl.ids.includes(id)) {
    wl.ids = wl.ids.filter(x => x !== id);
    toast(`Removed from “${wl.name}”`);
  } else {
    if (wl.ids.length >= LIMITS.watchlistStocks) {
      toast(`“${wl.name}” already holds the maximum of ${LIMITS.watchlistStocks} companies`); return;
    }
    wl.ids = [...wl.ids, id];
    toast(`Added to “${wl.name}”`);
  }
  saveWatchlists();
  render();
}

/* /research is a way in, not a company. It used to fall through to whichever
   company happened to be first in the universe — Apple — so a Malaysian
   visitor clicking "Research" was shown a US technology report and could
   reasonably read that as the product's own preference. A navigation link must
   never silently choose a security. */
VIEWS.researchHome = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const hd = el('div', { class: 'page-hd' });
  hd.append(el('div', {}, [
    el('p', { class: 'eyebrow' }, 'Research'),
    el('h1', {}, 'Start from a company, a market or a question'),
    el('p', { class: 'body-lg', style: 'margin-top:8px' },
      'Nothing on this page is ordered by preference, and opening it does not choose a company for you.'),
  ]));
  wrap.append(hd);

  const search = el('div', { class: 'card' });
  search.append(cardHead('Find a company', 'By name, ticker or Bursa code.'));
  const inp = el('input', { class: 'input', type:'search', placeholder:'Maybank, 1155, AAPL…',
    'aria-label':'Search for a company' });
  const results = el('div', { style: 'margin-top:10px;display:flex;flex-direction:column;gap:4px' });
  const runSearch = () => {
    const q = inp.value.trim().toLowerCase();
    results.replaceChildren();
    if (q.length < 2) return;
    U.filter(r => [r.c.name, r.c.tk, r.c.code].filter(Boolean)
        .some(f => String(f).toLowerCase().includes(q)))
     .slice(0, 8)
     .forEach(r => results.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'justify-content:flex-start',
        onclick: () => { State.ticker = r.c.id; navigate(companyPath(r.c)); } },
        `${r.c.tk || r.c.code} — ${r.c.name}`)));
    if (!results.children.length) results.append(el('p', { class: 'metaline' }, `Nothing in the beta universe matches “${inp.value.trim()}”.`));
  };
  inp.addEventListener('input', runSearch);
  search.append(inp); search.append(results);
  wrap.append(search);

  /* Collections, described by what they contain. */
  const colls = [
    ['Bursa Malaysia',  'Malaysian listings in the beta universe.',      () => { const s = blankScreen(); s.universe='MY'; State.screen=s; State.appliedTemplate=null; navigate('/discover/screener'); }],
    ['US equities',     'US listings, filed with the SEC.',              () => { const s = blankScreen(); s.universe='US'; State.screen=s; State.appliedTemplate=null; navigate('/discover/screener'); }],
    ['Banks',           'Deposit takers, on measures that fit a bank balance sheet.', () => applyTemplate(SCREEN_TEMPLATES.find(t => t.id === 'my-banks'))],
    ['REITs',           'Property trusts, on distribution and gearing.', () => applyTemplate(SCREEN_TEMPLATES.find(t => t.id === 'my-reits'))],
    ['Dividend research','Payout covered by cash rather than borrowing.', () => applyTemplate(SCREEN_TEMPLATES.find(t => t.id === 'div-cover'))],
    ['Sarawak Economy Watch','Companies with material exposure to the Sarawak economy. Descriptive, not a preference.', () => navigate('/discover/sarawak')],
  ];
  const cg = el('div', { class: 'grid grid-3' });
  colls.forEach(([t, b, go]) => {
    const card = el('div', { class: 'card task-card', role:'button', tabindex:'0' });
    card.append(el('h3', { class: 'h-card' }, t));
    card.append(el('p', { class: 'body', style: 'font-size:13px' }, b));
    const act = () => go();
    card.addEventListener('click', act);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    cg.append(card);
  });
  wrap.append(cg);

  /* Two finished workspaces that had no inbound link anywhere in the product
     and were reachable only by typing the URL. These are real anchors rather
     than role="button" divs, so they can be opened in a new tab, copied,
     reached by keyboard and read by a screen reader as the links they are —
     every other tile on this page is a div and none of them can. */
  const tools = el('div', { class: 'card' });
  tools.append(cardHead('Timing and position workspaces',
    'Separate from company research, and gated separately. Neither carries any weight in a research score.'));
  const tl = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px' });
  [['/research/trading-index', 'QT Trading Index',
    'Multi-timeframe trend and your own first-tranche rules, from chart evidence you record. Works on an ETF or a contract, which have no filings to research.'],
   ['/us-options/wheel', 'US Options Cash Wheel',
    'Cash-secured put and covered-call arithmetic with collateral gates, from figures you enter.']].forEach(([path, title, note]) => {
    const a = el('a', { class: 'card task-card', href: href(path), style: 'flex:1 1 260px;text-decoration:none',
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(path); } });
    a.append(el('h3', { class: 'h-card' }, title));
    a.append(el('p', { class: 'body', style: 'font-size:13px' }, note));
    tl.append(a);
  });
  tools.append(tl);
  wrap.append(tools);

  /* Recently viewed and saved cases, each empty-stated honestly. */
  const recent = (State.recentCompanies || []).map(id => BY_ID.get(id)).filter(Boolean).slice(0, 6);
  const rc = el('div', { class: 'card' });
  rc.append(cardHead('Recently viewed', 'The last companies you opened in this browser.'));
  if (recent.length) {
    const row = el('div', { class: 'row row-wrap', style: 'gap:8px' });
    recent.forEach(r => row.append(el('button', { class: 'btn btn-ghost btn-sm',
      onclick: () => { State.ticker = r.c.id; navigate(companyPath(r.c)); } }, r.c.tk || r.c.code)));
    rc.append(row);
  } else rc.append(el('p', { class: 'metaline' }, 'Nothing yet. Companies you open will be listed here.'));
  wrap.append(rc);

  const cases = el('div', { class: 'card' });
  cases.append(cardHead('Saved research cases', 'Your own written theses and their conditions.'));
  const th = State.theses || [];
  if (th.length) {
    const row = el('div', { class: 'row row-wrap', style: 'gap:8px' });
    th.slice(0, 8).forEach(t => row.append(el('button', { class: 'btn btn-ghost btn-sm',
      onclick: () => navigate('/theses') }, t.ticker)));
    cases.append(row);
  } else cases.append(el('p', { class: 'metaline' }, 'No cases saved yet. A case records your own reasoning and the conditions that would change it.'));
  wrap.append(cases);

  wrap.append(el('p', { class: 'metaline' },
    coverageSentence('source') + ' It is not a complete listing of either market.'));
  return wrap;
};

VIEWS.research = () => {
  const r = BY_ID.get(State.ticker) || U[0];
  /* Recorded here rather than at navigation, so it reflects reports actually
     rendered instead of every URL that was touched. */
  State.recentCompanies = [r.c.id, ...(State.recentCompanies || []).filter(x => x !== r.c.id)].slice(0, 12);
  store.write('recentCompanies', State.recentCompanies);
  const { c, m } = r;
  const wrap = el('div');

  /* Metered company reports. A company already opened this month is free to
     revisit — the meter counts distinct research, not page views. */
  if (!noteReportRead(c.id)) {
    wrap.append(upsell(`You have used all ${lim('reportsPerMonth')} company reports this month`,
      `The Free plan covers ${lim('reportsPerMonth')} distinct company reports a calendar month, and revisiting one you have already opened never costs another. ${State.reportLog.ids.length ? `This month you have read ${State.reportLog.ids.map(x => BY_ID.get(x)?.c.tk).filter(Boolean).join(', ')}.` : ''} Equities Research removes the limit.`));
    const back = el('div', { class: 'row', style: 'gap:8px;margin-top:var(--md)' });
    back.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => go('discover', { tab: 'screener' }) }, 'Back to the screener'));
    State.reportLog.ids.slice(0, 5).forEach(id => {
      const rr = BY_ID.get(id); if (!rr) return;
      back.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openResearch(id) }, rr.c.tk));
    });
    wrap.append(back);
    return wrap;
  }

  /* ---------- identity header ---------- */
  const head = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  const top = el('div', { class: 'row row-wrap identity-row', style: 'gap:var(--md);align-items:flex-start' });
  const idBlock = el('div', { style: 'min-width:0;flex:1 1 320px' });
  idBlock.append(el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:4px' }, [
    marketChip(c.mkt),
    el('span', { class: 'chip' }, `${c.exch} · ${c.code}`),
    el('span', { class: 'chip' }, c.sector),
    /* Bursa publishes no industry classification below sector, so the two are
       the same string for a Malaysian company and rendering both put
       "Materials Materials" in the header. One fact, shown once. */
    c.industry && c.industry !== c.sector ? el('span', { class: 'chip' }, c.industry) : null,
    c.flags.shariah === true ? el('span', { class: 'chip chip-my' }, 'Shariah-compliant') : null,
    c.flags.idx ? el('span', { class: 'chip' }, c.flags.idx) : null,
    c.flags.pn17 ? sevChip('critical', 'PN17') : null,
  ]));
  idBlock.append(el('h1', { style: 'font-size:24px;letter-spacing:-.02em' }, c.name));
  idBlock.append(el('p', { class: 'body', style: 'margin-top:6px;font-size:13px' }, c.desc));
  top.append(idBlock);

  const pxBlock = el('div', { style: 'text-align:right;flex:none' });
  pxBlock.append(el('div', { class: 'num', style: 'font-size:28px;font-weight:700;letter-spacing:-.02em' }, fmtMoney(c.px.p, c.ccy)));
  /* The change and its date render only when there is a price to have changed.
     Previously this printed "— today" on every filed company, which dates a
     figure that was never observed. */
  if (isNum(c.px.p) && isNum(c.px.d1)) pxBlock.append(el('div', { class: 'row', style: 'gap:8px;justify-content:flex-end;margin-top:2px' }, [
    el('span', { class: 'num ' + signClass(c.px.d1), style: 'font-size:13px;font-weight:600' }, withSign(c.px.d1, 2)),
    el('span', { class: 'metaline' }, priceAsOfLabel(c)),
  ]));
  else if (!isNum(c.px.p)) pxBlock.append(el('div', { class: 'metaline', style: 'margin-top:2px' },
    'No licensed price'));
  /* toBase returns null for an absent price, and this called .toFixed on it.
     Every SEC-filed company has no price — SEC publishes filings, not market
     data — so on the deployed site this threw on every company page opened in
     a currency other than the company's own. It did not surface earlier because
     the sample companies all carry a hardcoded price and the filings were
     behind a flag. A missing price is the normal state here, not an edge. */
  const pxBase = toBase(c.px.p, c.ccy);
  if (State.baseCcy !== c.ccy && isNum(pxBase)) pxBlock.append(el('div', { class: 'metaline', style: 'margin-top:2px' },
    `${baseSym()}${pxBase.toFixed(2)} in ${State.baseCcy} at ${FX.USDMYR.toFixed(2)}`));
  const acts = el('div', { class: 'row', style: 'gap:6px;justify-content:flex-end;margin-top:10px' });
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => toggleWatch(c.id) },
    State.watchlist.includes(c.id) ? '✓ Watching' : '+ Watchlist'));
  acts.append(el('button', { class: 'btn btn-primary btn-sm', onclick: () => { State.researchTab = 'valuation'; render(); } }, 'Valuation Studio'));
  pxBlock.append(acts);
  top.append(pxBlock);
  head.append(top);

  head.append(el('div', { style: 'margin-top:var(--md);padding-top:var(--sm);border-top:1px solid var(--grid)' },
    provenance(r, [`<b>Model</b> ${r.val.pack.name}`, `<b>Confidence</b> ${r.val.confBand}`])));

  /* Real-data companies get their own provenance strip: which filer, how
     complete, which XBRL tags, and the price gap with a way to close it. */
  if (c.real) {
    const rp = el('div', { style: 'margin-top:var(--sm);padding-top:var(--sm);border-top:1px solid var(--grid)' });
    /* This strip described one source because there was only ever one. A
       Malaysian company loaded from annual statements is not an SEC filer, has
       no CIK, and carries no redistribution right — labelling it "SEC-filed"
       beside "CIK undefined" got all three wrong at once. */
    rp.append(el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:8px' }, [
      c.personal
        ? el('span', { class: 'chip chip-bronze' }, 'annual statements — personal research')
        : sevChip('good', 'SEC-filed statements'),
      c.cik ? el('span', { class: 'chip' }, `CIK ${c.cik}`) : null,
      c.personal ? el('span', { class: 'chip chip-bronze' }, 'not redistributable') : null,
      el('span', { class: 'chip' }, `${Math.round(c.completeness * 100)}% of lines present`),
      isNum(c.fin?.length) && c.fin.length < 6
        ? el('span', { class: 'chip chip-bronze' }, `${c.fin.length} years held`) : null,
      el('span', { class: 'chip' }, `retrieved ${c.retrieved}`),
      c.px?.eod ? (c.pricePersonal
          ? el('span', { class: 'chip chip-bronze' }, `read from your screen${c.px.asOf ? ' ' + c.px.asOf : ''}`)
          : sevChip('good', `end-of-day close${c.px.asOf ? ' ' + c.px.asOf : ''}`))
        : isNum(c.px?.p) ? el('span', { class: 'chip chip-bronze' }, 'price entered by you')
        : sevChip('warning', 'no licensed price feed'),
      c.px?.eod ? (c.pricePersonal
          ? el('span', { class: 'chip chip-bronze' }, 'personal research — not redistributable')
          : el('span', { class: c.priceLicence ? 'chip' : 'chip chip-bronze' },
              c.priceLicence ? `licence: ${c.priceLicence}` : 'licence not stated')) : null,
    ]));
    const mixed = Object.entries(c.provenance || {}).filter(([, p]) => p.mixedTags);
    if (mixed.length) rp.append(el('p', { class: 'metaline', style: 'margin-bottom:6px' },
      `Assembled from more than one XBRL tag: ${mixed.map(([k, p]) => `${k} (${p.concept})`).join('; ')}. Comparability across peers is weaker where this happens.`));

    const pr = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:flex-end' });
    const f = el('div', { class: 'field', style: 'width:150px' });
    f.append(el('label', { for: 'realpx' }, `Price (${c.ccy || 'USD'})`));
    f.append(el('input', { class: 'input input-inline', id: 'realpx', type: 'number', step: '0.01',
      value: isNum(c.px?.p) ? c.px.p : '', placeholder: 'not available',
      onchange: e => { setManualPrice(c.id, parseFloat(e.target.value)); location.reload(); } }));
    pr.append(f);
    pr.append(el('p', { class: 'metaline', style: 'flex:1 1 300px' },
      c.px?.eod && c.pricePersonal
        ? `Read from your own screen${c.px.asOf ? ', as of ' + c.px.asOf : ''}, and confirmed by you before import. Character recognition misreads digits, so treat this as your working note rather than a source of record — and it carries no right to redistribute.`
      : c.px?.eod
        /* "the price file you supplied" attributed data/prices.json to the
           reader, who supplied nothing — /my/data reads "Nothing yet" on the
           same profile. That file is git-ignored and 404s in production, so no
           deployed reader sees this branch at all; it fires only where someone
           has put a price file in the data directory, and it should name the
           file and its stated licence rather than credit whoever is looking. */
        ? `End-of-day close from data/prices.json in this deployment${c.px.asOf ? ', as of ' + c.px.asOf : ''} — licence: ${c.priceLicence || 'not stated'}. This is not a licensed market feed and not a file you supplied. Delayed closes are sufficient for valuation, screening and portfolio work; what is missing here is the licence, not the latency.`
        : isNum(c.px?.p)
        ? 'This price was typed in by you. It is not market data, and every price-derived figure below inherits that.'
        : `${c.personal
              ? 'These are annual statements, not market data, and no licensed price feed is configured for Bursa Malaysia.'
              : 'SEC publishes filings, not prices.'} Valuation still computes a value per share; market capitalisation, multiples, yield and difference to model estimate cannot be computed without a price. Enter one to complete the picture.`));
    rp.append(pr);
    head.append(rp);
  }
  wrap.append(head);

  /* ---------- Strategy Lens (directive 7.1) ----------
     Above the research tabs, not replacing them. The tabs answer "what are the
     numbers"; this answers "what is this and why would anyone own it", which is
     the question a reader arrives with. */
  const lens = strategyLens(r);
  const lensCard = el('div', { class: 'card', style: 'border-left:3px solid var(--brand)' });
  lensCard.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
    el('p', { class: 'eyebrow', style: 'margin:0' }, 'Strategy Lens'),
    el('span', { class: lens.tier.id === 'unassessed' ? 'chip chip-bronze' : 'chip', style: 'margin-left:auto',
      title: lens.tier.why }, lens.tier.label),
  ]));

  const idRow = el('div', { class: 'grid g-2', style: 'margin-top:10px' });
  idRow.append(el('div', {}, [
    el('p', { class: 'metaline', style: 'margin-bottom:2px' }, 'What it is'),
    el('p', { class: 'body', style: 'font-size:13px;font-weight:600;margin:0' }, `${lens.instrument.label} — ${lens.archetype}`),
    el('p', { class: 'metaline', style: 'margin-top:2px' }, lens.instrument.note),
  ]));
  idRow.append(el('div', {}, [
    el('p', { class: 'metaline', style: 'margin-bottom:2px' }, 'Why it might be owned'),
    lens.primary
      ? el('div', {}, [
          el('p', { class: 'body', style: 'font-size:13px;font-weight:600;margin:0' }, lens.primary.label),
          el('p', { class: 'metaline', style: 'margin-top:2px' }, lens.primary.why),
          lens.secondary ? el('p', { class: 'metaline', style: 'margin-top:4px' }, `Secondary: ${lens.secondary.label}.`) : null,
        ])
      : el('p', { class: 'body', style: 'font-size:13px;margin:0;color:var(--bronze)' },
          'Not stated. No strategy could be assessed from the data held, and naming a return role without one would be a guess dressed as a classification.'),
  ]));
  lensCard.append(idRow);

  /* The fit grades, side by side. Most will read U, and that is the point. */
  const fitRow = el('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:var(--md)' });
  lens.fits.forEach(f => {
    const st = FIT_STATES[f.state] || FIT_STATES.missing;
    const token = f.state === 'graded' ? f.grade : st.token;
    const tone = f.state === 'graded'
      ? ({ A:'chip chip-ok', B:'chip chip-ok', C:'chip chip-bronze', D:'chip chip-bronze' }[f.grade] || 'chip')
      : 'chip';
    /* cap before missing[0] before the generic string. The generic one used to
       fire whenever `missing` was empty, which is exactly the case where
       nothing IS missing — the policy refused a fit whose evidence was present,
       and the tooltip then said the evidence was absent. */
    fitRow.append(el('span', { class: tone, title: f.state === 'graded'
      ? `${f.score}/100${f.cap ? ' — ' + f.cap : ''}`
      : `${st.label}. ${f.cap || f.missing[0] || st.why}` }, `${f.label} ${token}`));
  });
  lensCard.append(fitRow);

  /* A grade with nowhere to go.
     The Cash Wheel fit scored this company and the workspace that acts on it sat
     behind a URL with no link from here — the reader was told the underlying
     qualifies and left to guess where. Real anchors, and only for the strategies
     that actually apply to this instrument, so a Bursa company is not offered a
     workspace that does not cover it. */
  /* The company travels with the link. `from` carries the id and resolves; the
     ticker is readable decoration the workspace re-derives and never trusts. */
  const ctx = `?from=${encodeURIComponent(c.id)}&symbol=${encodeURIComponent(c.tk || c.code || c.id)}`;
  const wsLinks = [];
  const wheelFitRow = lens.fits.find(f => f.key === 'wheel');
  if (wheelFitRow && wheelFitRow.state === 'graded')
    wsLinks.push([`/us-options/wheel${ctx}`, `Open the Cash Wheel workspace`,
      'Collateral, assignment and the covered-call cycle, from figures you enter.']);
  wsLinks.push([`/research/trading-index${ctx}`, 'Record timing evidence',
    'Multi-timeframe trend and your own first-tranche rules. It carries no weight in any score above.']);
  const wsRow = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
  wsLinks.forEach(([path, label, note]) => {
    const a = el('a', { class: 'btn btn-ghost btn-sm', href: href(path), title: note,
      onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
        e.preventDefault(); navigate(path); } }, label);
    wsRow.append(a);
  });
  lensCard.append(wsRow);
  lensCard.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    wheelFitRow && wheelFitRow.state === 'not_applicable'
      ? `The Cash Wheel does not apply to this company — ${wheelFitRow.cap} Neither workspace changes any grade above.`
      : 'Neither workspace changes any grade above. Both record your own plan and are weighted zero in the research composite.'));

  /* Counted per state, because "not assessable from the data held" was false
     for more than half of them. A strategy that does not apply to this business
     and one whose registry has never been built are not short of data. */
  const bs = lens.byState || {};
  const n = lens.fits.length;
  const phrases = [];
  if (bs.graded) phrases.push(`${bs.graded} graded`);
  if (bs.missing) phrases.push(`${bs.missing} awaiting evidence this product could hold but does not`);
  if (bs.not_applicable) phrases.push(`${bs.not_applicable} that ${bs.not_applicable === 1 ? 'does' : 'do'} not apply to this business at all`);
  if (bs.not_built) phrases.push(`${bs.not_built} that no company here can be graded on, because the feature is not built`);
  if (bs.illustrative) phrases.push(`${bs.illustrative} withheld because this company’s figures are synthetic`);
  lensCard.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    bs.illustrative === n
      ? `No strategy is graded for this company. ${lens.tier.why} A grade computed from figures this product cannot stand behind would look like research and would not be any.`
      : `Of ${n} strategies: ${phrases.join(', ')}.`));

  /* The legend, on request rather than always.
     Three sentences of vocabulary sat permanently between the grades and the
     workspaces, so the explanation of the tokens competed with the tokens. It
     is one line now, opened by whoever needs it — and it is still always
     present, because a token without a key anywhere is decoration. */
  const shown = ['missing', 'not_applicable', 'not_built', 'illustrative'].filter(k => bs[k]);
  if (shown.length) {
    const key = el('details', { style: 'margin-top:8px' });
    key.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
      `What ${shown.map(k => FIT_STATES[k].token).join(', ')} mean${shown.length === 1 ? 's' : ''}`));
    const kl = el('dl', { class: 'kv', style: 'margin-top:8px' });
    shown.forEach(k => {
      kl.append(el('dt', {}, `${FIT_STATES[k].token} — ${FIT_STATES[k].label.toLowerCase()}`));
      kl.append(el('dd', { style: 'text-align:left' }, FIT_STATES[k].why));
    });
    key.append(kl);
    lensCard.append(key);
  }

  /* Each fit opens to what supports it, what weakens it, and what is missing. */
  const det = el('details', { style: 'margin-top:10px' });
  det.append(el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'What each grade rests on'));
  const ft = el('table', { class: 'dt', style: 'margin-top:8px' });
  ft.append(el('thead', {}, el('tr', {}, ['Strategy', 'Grade', 'Supports', 'Weakens or missing'].map((h, i) =>
    el('th', { style: i === 1 ? null : 'text-align:left' }, h)))));
  const fb = el('tbody');
  lens.fits.forEach(f => fb.append(el('tr', {}, [
    el('td', { style: 'text-align:left' }, f.label),
    el('td', {}, f.state === 'graded' ? f.grade : (FIT_STATES[f.state] || FIT_STATES.missing).token),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
      f.supports.length ? f.supports.join(' ') : '—'),
    el('td', { class: 'caption', style: 'text-align:left;white-space:normal' },
      [...f.weakens, ...f.missing.map(x => `Missing: ${x}`), ...(f.cap ? [f.cap] : [])].join(' ') || '—'),
  ])));
  ft.append(fb);
  det.append(el('div', { class: 'tablewrap' }, ft));
  det.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    'These are research criteria, not instructions. A grade describes how well the evidence meets a strategy’s requirements — it does not say to buy, sell or hold anything, and no allocation is implied by any of them.'));
  lensCard.append(det);
  wrap.append(lensCard);

  /* ---------- sticky identity + tabs ----------
     Once the header scrolls away there is nothing on screen saying which
     company you are reading, which is how people misattribute a number. */
  const stick = el('div', { class: 'ticker-sticky' });
  const ident = el('div', { class: 'ts-ident' });
  ident.append(el('span', { class: 'ts-tk' }, c.tk));
  ident.append(el('span', { class: 'ts-name' }, c.name));
  ident.append(el('span', { class: 'ts-px num' }, fmtMoney(c.px.p, c.ccy)));
  ident.append(el('span', { class: 'ts-chg num ' + signClass(c.px.d1) }, withSign(c.px.d1, 2)));
  /* Filled in below, once the panel exists and its headings can be read.
     Placed on the identity row rather than a row of its own: the topbar, this
     strip and the tab bar are already stuck to the top of a phone, and a
     fourth band would take more of the viewport than the section it navigates
     to. */
  const jump = el('div', { class: 'ts-jump' });
  ident.append(jump);
  stick.append(ident);
  const sub = el('div', { class: 'subnav' });
  RESEARCH_TABS.forEach(t => sub.append(el('button', {
    role: 'tab', 'aria-selected': State.researchTab === t.id ? 'true' : 'false',
    onclick: () => { State.researchTab = t.id; render(); } }, t.label)));
  stick.append(sub);
  wrap.append(stick);

  /* The plain-language summary sits above the tabs, on every tab, because it
     is the orientation the rest of the page assumes you already have. Four
     questions in the order a reader actually asks them — and "what needs
     attention" comes before any valuation, because a number you cannot trust
     is worse than no number. */
  if (State.researchTab !== 'thesis') wrap.append(companySummary(r));

  const panel = {
    snapshot: tabSnapshot, business: tabBusiness, financials: tabFinancials, quality: tabQuality,
    valuation: tabValuation, moat: tabMoat, risks: tabRisks, ownership: tabOwnership,
    filings: tabFilings, thesis: tabThesisFor,
  }[State.researchTab] || tabSnapshot;

  /* THE SECTION NAVIGATOR.
     -----------------------------------------------------------------------
     Measured at 390px, this report is 8,083px — nine and a half screens — with
     thirteen headings and no way to reach any of them but scrolling. The tab
     strip switches panels; it does nothing for the distance inside one.

     A <select> rather than a chip row or a rail: it is one control high at
     every viewport, it is keyboard and screen-reader navigable without any
     code from me, and the strip it lives in is already carrying the ticker and
     ten tabs. A row of section chips would have needed its own band and would
     itself have scrolled sideways on a phone — reintroducing the problem this
     is meant to solve one level down. */
  const panelNode = panel(r);
  const heads = [...panelNode.querySelectorAll('h3.h-card, h2.h-section')]
    .filter(h => (h.textContent || '').trim());
  if (heads.length >= 4) {
    heads.forEach((h, i) => { if (!h.id) h.id = `sec-${i}-${slug(h.textContent).slice(0, 28)}`; });
    const s = el('select', { class: 'select select-sm', 'aria-label': 'Jump to a section of this report',
      onchange: (e) => {
        const t = document.getElementById(e.target.value);
        if (t) { t.scrollIntoView({ block: 'start' }); t.focus?.(); }
        e.target.selectedIndex = 0;
      } });
    s.append(el('option', { value: '' }, `Jump to… (${heads.length})`));
    heads.forEach(h => s.append(el('option', { value: h.id }, h.textContent.trim().slice(0, 46))));
    jump.append(s);
  }

  wrap.append(panelNode);
  return wrap;
};

/* ------------------------------------------------ plain-language summary */
function companySummary(r) {
  const { c, m, val } = r;
  const card = el('div', { class: 'card', style: 'margin-bottom:var(--md)' });
  const grid = el('div', { class: 'grid g-4' });

  const block = (heading, nodes, note) => {
    const b = el('div');
    b.append(el('p', { class: 'eyebrow', style: 'margin-bottom:6px' }, heading));
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(n =>
      b.append(typeof n === 'string' ? el('p', { class: 'body', style: 'margin:0 0 4px' }, n) : n));
    if (note) b.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, note));
    return b;
  };

  /* 1. What it does — from the company's own description, kept short. */
  const does = String(c.desc || '').split(/(?<=\.)\s+/).slice(0, 2).join(' ')
    || `${c.name} is listed on ${c.exch}. No business description has been recorded for it.`;
  grid.append(block('What the company does', does,
    `${c.sector}${c.industry && c.industry !== c.sector ? ' · ' + c.industry : ''}`));

  /* 2. What changed — from the computed feed, which is derived from the
     reported figures rather than from news. */
  const changes = (typeof FEED !== 'undefined' && Array.isArray(FEED))
    ? FEED.filter(f => f.id === c.id).slice(0, 3) : [];
  grid.append(block('What changed recently',
    changes.length
      ? changes.map(f => el('p', { class: 'body', style: 'margin:0 0 4px' }, f.title))
      : ['Nothing has changed state since the last model run.'],
    changes.length ? 'Computed from the reported figures, not from news.' : null));

  /* 3. What needs attention — the most serious risk flags, worst first. */
  const rank = { critical: 0, serious: 1, warning: 2, good: 3 };
  const attention = [...(r.flags || [])].sort((a, b) => (rank[a.sev] ?? 9) - (rank[b.sev] ?? 9))
    .filter(f => f.sev !== 'good').slice(0, 3);
  grid.append(block('What needs attention',
    attention.length
      ? attention.map(f => el('p', { class: 'body', style: 'margin:0 0 4px' }, [
          el('span', { class: `chip chip-${f.sev === 'serious' || f.sev === 'critical' ? 'critical' : 'warn'}`,
                       style: 'margin-right:6px' }, f.sev), f.t || f.title || '']))
      : ['No risk threshold is crossed on the reported figures.'],
    attention.length ? 'Open Risks for what each one is measuring.' : null));

  /* 4. Data confidence — what is present, what is old, what is missing. */
  const conf = el('div');
  conf.append(el('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin-bottom:6px' }, [
    el('span', { class: m.coverage >= 90 ? 'chip chip-ok' : m.coverage >= 70 ? 'chip' : 'chip chip-bronze' },
      `${m.coverage}% complete`),
    val?.confBand ? el('span', { class: val.confBand === 'High' ? 'chip chip-ok' : val.confBand === 'Low' ? 'chip chip-bronze' : 'chip' },
      `${val.confBand} confidence`) : null,
    c.real ? el('span', { class: 'chip' }, 'audited filings') : el('span', { class: 'chip chip-bronze' }, 'sample data'),
  ]));
  const gaps = [];
  if (!isNum(c.px?.p)) gaps.push('No price is attached, so market capitalisation, multiples and yield cannot be computed.');
  if (m.inapplicable) gaps.push(`${m.inapplicable} measures do not apply to this business model and are excluded rather than counted as missing.`);
  if (c.real && c.completeness != null && c.completeness < 1)
    gaps.push(`${Math.round((1 - c.completeness) * 100)}% of statement lines were not reported in the filings.`);
  if (!gaps.length) gaps.push('Every applicable measure is computable from what has been reported.');
  gaps.forEach(g => conf.append(el('p', { class: 'body', style: 'margin:0 0 4px' }, g)));
  grid.append(block('Data confidence', conf,
    metricLabel('coverage', 'What completeness measures')));

  card.append(grid);
  return card;
}

/* --------------------------------------------------------------- snapshot */
function tabSnapshot(r) {
  const { c, m, val } = r;
  const wrap = el('div', { class: 'research-layout' });
  const main = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md);min-width:0' });

  /* Research-case composite, section 14. Shown with its divisor: a number that
     hides how much of the framework it covers is worse than no number. */
  const rc = researchComposite(r);
  const rcCard = el('div', { class: 'card' });
  rcCard.append(cardHead('Research case',
    'Five weighted pillars from the framework. Technical context is weighted zero here and is not consulted — price evidence lives on its own card.'));

  const head = el('div', { class: 'row', style: 'gap:var(--lg);align-items:baseline;flex-wrap:wrap' });
  head.append(el('div', {}, [
    el('div', { style: 'font-size:32px;font-weight:700;line-height:1' },
      isNum(rc.score) ? String(rc.score) : '—'),
    el('div', { class: 'metaline' }, `out of 100, over ${rc.testedWeight}% of the framework weight`),
  ]));
  head.append(el('div', { style: 'flex:1;min-width:220px' }, [
    el('div', { style: 'font-weight:600;font-size:13px' },
      rc.classified ? rc.band.state : 'No aggregate classification'),
    el('div', { class: 'metaline' },
      rc.classified ? rc.band.next
        : `Data completeness is ${rc.dataCoverage}%. The framework requires 70% before an aggregate may be classified.`),
  ]));
  rcCard.append(head);

  /* Every pillar, including the two with nothing behind them. */
  const pt = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
  pt.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Pillar'), el('th', { class: 'num' }, 'Weight'),
    el('th', { class: 'num' }, 'Score'), el('th', {}, 'Source')])));
  const pb = el('tbody');
  rc.parts.forEach(p => {
    pb.append(el('tr', {}, [
      el('td', { style: isNum(p.score) ? '' : 'opacity:.7' }, p.label),
      el('td', { class: 'num' }, `${p.w}%`),
      el('td', { class: 'num' }, isNum(p.score) ? fmtNum(p.score, 0) : 'not tested'),
      el('td', { class: 'metaline' }, isNum(p.score) ? `From ${p.from}.` : p.absent),
    ]));
  });
  pt.append(pb);
  rcCard.append(el('div', { style: 'overflow-x:auto' }, pt));

  if (rc.untested.length) rcCard.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    `${rc.untested.map(p => p.label).join(' and ')} contribute nothing to the number above, and the missing ${100 - rc.testedWeight}% is not redistributed. Spreading it across the other pillars would score them as examined and average; leaving it out keeps the score an honest average of what was measured.`));

  rc.gates.forEach(g => rcCard.append(el('div', { class: 'note', style: 'margin-top:var(--md)' }, [
    el('p', { style: 'margin:0 0 4px;font-weight:600;font-size:13px' },
      g.state === 'manual_review' ? 'Governance: manual review required' : 'No aggregate classification'),
    el('p', { class: 'metaline' }, g.why),
  ])));
  main.append(rcCard);

  /* key figures */
  const tiles = el('div', { class: 'card' });
  const tg = el('div', { class: 'grid g-4' });
  tg.append(statTile('Market capitalisation', fmtCap(toBase(m.mcap, c.ccy), State.baseCcy), { sub: `${fmtNum(last(r.d.sh), 2)}bn shares` }));
  tg.append(statTile(c.type === 'bank' ? 'Price / book' : 'Price / earnings', c.type === 'bank' ? fmtX(m.pb, 2) : (isNum(m.pe) ? fmtX(m.pe) : 'n/m'),
    { sub: c.type === 'bank' ? `ROE ${fmtPct(m.roe)}` : `EPS ${fmtMoney(m.eps, c.ccy)}` }));
  tg.append(statTile(c.type === 'reit' ? 'Distribution yield' : 'Dividend yield', fmtPct(m.dy, 2),
    { sub: isNum(m.cashPayout) ? `${fmtPct(m.cashPayout, 0)} of free cash flow` : (isNum(m.payout) ? `${fmtPct(m.payout, 0)} of earnings` : '—') }));
  tg.append(statTile('vs base-case value', val.mos ? withSign(val.mos.base, 1) : '—',
    { sub: `${val.pack.name.split('/')[0].trim()} · ${val.confBand} confidence`, tone: val.mos && val.mos.base >= 0 ? '--ok-text' : '--dn-text' }));
  tiles.append(tg);
  main.append(tiles);

  /* valuation range */
  const vr = el('div', { class: 'card' });
  vr.append(cardHead('Valuation range', `${val.pack.name}. ${val.pack.why}`,
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { State.researchTab = 'valuation'; render(); } }, 'Adjust assumptions')));
  if (val.err) vr.append(el('div', { class: 'guardrail', html: `${icon('alert')}<span>${esc(val.err)}</span>` }));
  else {
    vr.append(rangeStrip(val.vals.bear, val.vals.base, val.vals.bull, c.px.p, c.ccy));
    const g = el('div', { class: 'grid g-3', style: 'margin-top:var(--lg)' });
    [['Bear', val.vals.bear, val.mos?.bear], ['Base', val.vals.base, val.mos?.base], ['Bull', val.vals.bull, val.mos?.bull]].forEach(([label, v, mos]) => {
      const p = el('div', { class: 'panel' });
      p.append(el('div', { class: 'stat-label' }, `${label} case`));
      p.append(el('div', { class: 'num', style: 'font-size:18px;font-weight:700;margin:2px 0' }, fmtMoney(v, c.ccy)));
      p.append(el('div', { class: 'num ' + diffClass(mos), style: 'font-size:12px;font-weight:600' },
        isNum(mos) ? `${withSign(mos, 1)} vs price` : 'no price to compare'));
      g.append(p);
    });
    vr.append(g);

    /* The required discount is the reader's, not the product's. This product
       will not say a company is cheap; it will say whether the difference the
       model produces clears the threshold you set, and that threshold starts
       unset so nothing is implied by a default. */
    const req = el('div', { style: 'margin-top:var(--lg);padding-top:var(--md);border-top:1px solid var(--line)' });
    const cur = State.requiredDiscount;
    const row = el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:center' });
    row.append(el('label', { class: 'metaline', for: 'reqDisc', style: 'margin:0' },
      'Discount you require before you would research further'));
    row.append(el('input', { class: 'input input-inline', id: 'reqDisc', type: 'number', step: '5',
      style: 'width:74px;text-align:right', placeholder: 'none', value: isNum(cur) ? String(cur) : '',
      onchange: e => {
        const v2 = e.target.value === '' ? null : num0(e.target.value);
        State.requiredDiscount = v2; store.write('requiredDiscount', v2); render();
      } }));
    row.append(el('span', { class: 'metaline' }, '%'));
    req.append(row);
    if (isNum(cur) && isNum(val.mos?.base)) {
      const meets = val.mos.base >= cur;
      req.append(el('p', { class: 'body', style: 'margin-top:8px;font-size:13px' },
        meets
          ? `The base case sits ${withSign(val.mos.base, 0)} from the price, which clears the ${fmtPct(cur, 0)} you asked for. That is your rule applied to this model, not a view on the company.`
          : `The base case sits ${withSign(val.mos.base, 0)} from the price, short of the ${fmtPct(cur, 0)} you asked for.`));
    } else {
      req.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
        'Left blank, nothing is judged against it. This product does not carry a default required discount, because that would be a recommendation wearing a number.'));
    }
    vr.append(req);
  }
  main.append(vr);

  /* price */
  /* Trend context, but only where real closes exist for this company. The
     chart below may be a generated illustration; indicators must never be. */
  const real = realSeriesFor(c);
  const tc = el('div', { class: 'card' });
  tc.append(cardHead('Trend context',
    'Price evidence, kept separate from the scores. Nothing here raises or lowers business quality or valuation — a chart is not a business.'));
  if (!real) {
    tc.append(el('p', { class: 'body', style: 'font-size:13px' },
      `No observed price history has been imported for ${c.tk}. The chart below is a generated illustration consistent with the stated 12-month return, and running a 200-day average over it would produce a confident figure for a series that never existed.`));
    tc.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Add closes for ${c.tk} under My Investments → Your data to enable this. They stay in this browser.`));
  } else {
    const t = trendContext(real.series);
    const ctx = TREND_STRATEGIES[0].evaluate(t);
    const vol = volumeContext(trackedHistory?.volume?.[real.symbol] || {}, real.series);
    const g2 = el('div', { class: 'grid g-4' });
    g2.append(el('div', { class: 'panel' }, statTile('Observed closes', String(t.points),
      { sub: `${t.first || '—'} to ${t.lastDate || '—'}` })));
    g2.append(el('div', { class: 'panel' }, statTile('Trend', ctx ? ctx.state : 'not computable',
      { sub: ctx ? '' : `needs ${(t.pending.find(x => x.id === 'sma200') || {}).more || '—'} more closes` })));
    g2.append(el('div', { class: 'panel' }, statTile('vs 200-day',
      isNum(t.values.dist200) ? withSign(t.values.dist200, 1) : '—', { sub: 'distance from the long-term average' })));
    g2.append(el('div', { class: 'panel' }, statTile('Volume vs 50-day',
      isNum(vol.ratio50) ? `${fmtNum(vol.ratio50, 2)}×` : 'no volume',
      { sub: vol.pending ? `needs ${vol.pending.more} more days` : vol.ratio50 ? 'latest day against its average' : 'the imported file carried no volume column' })));
    tc.append(g2);
    tc.append(el('div', { class: 'row', style: 'margin-top:var(--md)' },
      el('button', { class: 'btn btn-ghost btn-sm',
        onclick: () => openTrendDrawer({ sym: real.symbol, name: c.name, meta: { market: c.mkt, kind: 'equity' } }, t) },
        'Full trend detail and relative strength')));
  }
  main.append(tc);

  const hist = priceHistory(c);
  const pc = el('div', { class: 'card' });
  if (!hist) {
    /* Fundamentals without a feed. Say so rather than draw an empty chart. */
    pc.append(cardHead('Price history', 'Not available for this company.'));
    pc.append(el('p', { class: 'body', style: 'font-size:13px' },
      c.real
        ? 'This company was loaded from SEC filings, which carry statements and not market data. A price series needs a licensed feed. Everything above that does not depend on a price — statements, quality, the valuation itself — is computed from the filings as normal.'
        : 'No price series is attached to this company.'));
  } else {
    pc.append(cardHead('Price, last 52 weeks', 'Weekly closes reconstructed from the sample dataset.'));
    const ph = el('div', { style: 'width:100%' });
    pc.append(ph);
    lineChart(ph, { values: hist, labels: hist.map((_, i) => i === hist.length - 1 ? AS_OF : `Week ${i + 1}`), fmt: v => fmtMoney(v, c.ccy, 2), varName: '--s1' });
    pc.append(el('div', { class: 'row row-wrap', style: 'gap:var(--lg);margin-top:var(--sm)' }, [
      el('span', { class: 'metaline' }, `52-week range ${fmtMoney(c.px.lo, c.ccy)} – ${fmtMoney(c.px.hi, c.ccy)}`),
      el('span', { class: 'metaline' }, `${fmtPct(m.from52)} from the high`),
      el('span', { class: 'metaline ' + signClass(c.px.m12) }, `${withSign(c.px.m12)} over 12 months`),
    ]));
  }
  main.append(pc);

  /* peers — economically comparable, not merely same-sector */
  const peers = U.filter(x => x.c.id !== c.id && x.c.type === c.type && (x.c.mkt === c.mkt || x.c.sector === c.sector))
    .sort((a, b) => {
      if (!isNum(m.mcap)) return 0;                 /* no anchor to sort against */
      const da = isNum(a.m.mcap) ? Math.abs(a.m.mcap - m.mcap) : Infinity;
      const db = isNum(b.m.mcap) ? Math.abs(b.m.mcap - m.mcap) : Infinity;
      return da - db;
    }).slice(0, 5);
  if (peers.length) {
    const pcard = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
    const ph2 = el('div', { style: 'padding:var(--md) var(--lg);border-bottom:1px solid var(--line)' });
    ph2.append(el('h3', { class: 'h-card' }, 'Closest peers'));
    ph2.append(el('p', { class: 'caption', style: 'margin-top:2px' },
      `Matched on business model (${c.type}) as well as sector — the metrics below mean the same thing across these companies.`));
    ph2.append(el('button', { class: 'btn btn-quiet btn-sm', style: 'margin-top:6px;padding:0',
      onclick: () => { State.compare = [c.id, ...peers.map(p => p.c.id)].slice(0, 8); store.write('compare', State.compare); go('compare'); } }, 'Open full comparison →'));
    pcard.append(ph2);
    const tw2 = el('div', { class: 'tablewrap', style: 'border:0;border-radius:0' });
    const t2 = el('table', { class: 'dt' });
    const isB = c.type === 'bank', isR = c.type === 'reit';
    const cols2 = isB ? ['Company', 'ROE', 'CET1', 'Impaired', 'P/B', 'Yield', 'Quality']
                : isR ? ['Company', 'Occupancy', 'Gearing', 'P/NAV', 'Yield', 'Quality', 'vs base']
                      : ['Company', 'ROIC', 'Op margin', 'P/E', 'FCF yield', 'Quality', 'vs base'];
    t2.append(el('thead', {}, el('tr', {}, cols2.map((h, i) => el('th', { class: i === 0 ? 'pin' : '' }, h)))));
    const tb2 = el('tbody');
    [r, ...peers].forEach(p => {
      const tr = el('tr', p.c.id === c.id ? { style: 'background:color-mix(in srgb, var(--brand) 7%, transparent)' } : {});
      const td0 = el('td', { class: 'pin ident' }); td0.append(tickerCell(p)); tr.append(td0);
      const cells = isB ? [fmtPct(p.m.roe), fmtPct(p.m.cet1), fmtPct(p.m.npl, 2), fmtX(p.m.pb, 2), fmtPct(p.m.dy, 2), scorePill(p.scores.quality.score, p.pct.quality)]
                  : isR ? [fmtPct(p.m.occ), fmtPct(p.m.gearing), fmtX(p.m.pnav, 2), fmtPct(p.m.dy, 2), scorePill(p.scores.quality.score, p.pct.quality), `<span class="${diffClass(p.val.mos?.base)}">${withSign(p.val.mos?.base, 0)}</span>`]
                        : [isNum(p.m.roic) ? fmtPct(p.m.roic) : NA, fmtPct(p.m.om), isNum(p.m.pe) ? fmtX(p.m.pe) : '<span class="caption">n/m</span>',
                           isNum(p.m.fcfy) ? fmtPct(p.m.fcfy, 2) : NA, scorePill(p.scores.quality.score, p.pct.quality), `<span class="${diffClass(p.val.mos?.base)}">${withSign(p.val.mos?.base, 0)}</span>`];
      cells.forEach(v => tr.append(el('td', { html: v })));
      tb2.append(tr);
    });
    t2.append(tb2); tw2.append(t2); pcard.append(tw2);
    main.append(pcard);
  }
  wrap.append(main);

  /* right rail: scorecard + changes + risks */
  const rail = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  const sc = el('div', { class: 'card' });
  sc.append(cardHead('Scorecard', 'Pillars stay separate — trade-offs are not hidden inside one number.',
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { State.researchTab = 'quality'; render(); } }, 'Detail')));
  [['quality', 'Business Quality'], ['growth', 'Growth Quality'], ['strength', 'Financial Strength'], ['capital', 'Capital Allocation'], ['value', 'Valuation']]
    .forEach(([k, label]) => sc.append(scoreBar(label, r.scores[k].score, r.pct[k])));
  const riskRow = el('div', { class: 'row', style: 'padding-top:10px;margin-top:6px;border-top:1px solid var(--grid)' });
  riskRow.append(el('span', { class: 'sr-name' }, 'Risk grade'));
  riskRow.append(el('span', { class: 'spacer' }));
  riskRow.append(el('span', { html: riskPill(r.risk.band) }));
  sc.append(riskRow);

  /* Momentum sits below the rule, outside the pillars, so it cannot be read as
     part of the quality judgement. */
  const momRow = el('div', { style: 'padding-top:10px;margin-top:6px;border-top:1px solid var(--grid)' });
  momRow.append(el('div', { class: 'row' }, [
    el('span', { class: 'sr-name' }, 'Momentum / change'),
    el('span', { class: 'spacer' }),
    el('span', { class: 'num', style: 'font-size:13px;font-weight:600' }, isNum(r.mom.score) ? String(r.mom.score) : '—'),
  ]));
  const momMeter = el('div', { class: 'meter', style: 'margin-top:5px' });
  momMeter.append(el('i', { style: `width:${r.mom.score ?? 0}%;background:var(--s3)` }));
  momRow.append(momMeter);
  momRow.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
    'Context indicator — deliberately not part of any pillar above.'));
  sc.append(momRow);
  sc.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, `Scores computed within the ${c.mkt} market cohort · coverage ${m.coverage}%`));
  rail.append(sc);

  const chg = el('div', { class: 'card' });
  chg.append(cardHead('What changed', `FY${YEARS[LYI - 1]} to FY${YEARS[LYI]}, as reported.`));
  const ch = changeSummary(c) || [];
  const kv = el('dl', { class: 'kv' });
  ch.forEach(x => { kv.append(el('dt', {}, x.label)); kv.append(el('dd', { class: signClass(x.v) }, withSign(x.v, 1))); });
  chg.append(kv);
  rail.append(chg);

  const rk = el('div', { class: 'card' });
  rk.append(cardHead('Open risk flags', null, el('button', { class: 'btn btn-quiet btn-sm', onclick: () => { State.researchTab = 'risks'; render(); } }, 'All')));
  const notable = r.flags.filter(f => f.sev !== 'good').slice(0, 3);
  if (!notable.length) rk.append(el('p', { class: 'caption' }, 'No flag triggered by the current thresholds.'));
  notable.forEach(f => {
    rk.append(el('div', { style: 'padding:7px 0;border-bottom:1px solid var(--grid)' }, [
      el('div', { class: 'row', style: 'gap:6px;margin-bottom:2px' }, [sevChip(f.sev), el('span', { style: 'font-size:13px;font-weight:600' }, f.title)]),
      el('p', { class: 'caption' }, f.detail),
    ]));
  });
  rail.append(rk);
  wrap.append(rail);
  return wrap;
}

/* --------------------------------------------------------------- business */
function tabBusiness(r) {
  const { c, d, m } = r;
  const wrap = el('div', { class: 'grid g-2' });

  const seg = el('div', { class: 'card' });
  seg.append(cardHead('Revenue mix', 'Share of the latest reported year. Segment split is part of the sample dataset.'));
  const bar = el('div', { class: 'pillbar', style: 'height:14px;margin-bottom:var(--md)' });
  (c.seg || []).forEach((s, i) => bar.append(el('i', { style: `width:${s[1]}%;background:var(${SERIES[i % 8]})`, title: `${s[0]} ${s[1]}%` })));
  seg.append(bar);
  const legend = el('div', { style: 'display:flex;flex-direction:column;gap:1px' });
  (c.seg || []).forEach((s, i) => {
    legend.append(el('div', { class: 'row', style: 'gap:8px;padding:6px 0;border-bottom:1px solid var(--grid)' }, [
      el('span', { class: 'legend-key', style: `background:var(${SERIES[i % 8]})` }),
      el('span', { style: 'font-size:13px;color:var(--ink-2)' }, s[0]),
      el('span', { class: 'spacer' }),
      el('span', { class: 'num', style: 'font-size:13px;font-weight:600' }, `${s[1]}%`),
      el('span', { class: 'metaline' }, fmtCap(last(d.rev) * s[1] / 100, c.ccy)),
    ]));
  });
  seg.append(legend);
  wrap.append(seg);

  const prof = el('div', { class: 'card' });
  prof.append(cardHead('Business profile', 'How this company is classified, and what that means for the models it is routed to.'));
  const kv = el('dl', { class: 'kv' });
  [['Business model', c.type], ['Model pack', r.val.pack.name], ['Reporting currency', c.ccy],
   ['Primary listing', `${c.exch} · ${c.tk}`], ['Sector / industry', `${c.sector} — ${c.industry}`],
   ['Cyclicality', isNum(m.revDD) ? `Revenue drawdown ${fmtPct(m.revDD, 0)} in the window` : '—'],
   ['Capital intensity', isNum(m.reinv) ? `Capex is ${fmtPct(m.reinv, 0)} of operating cash flow` : 'Not meaningful'],
   ['Shares in issue', m.shareSeriesBreak
     ? `${fmtNum(last(d.sh), 3)}bn — annual change withheld, see capital allocation`
     : `${fmtNum(last(d.sh), 3)}bn (${withSign(m.dilution, 2)} a year)`],
  ].forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, String(v))); });
  prof.append(kv);
  prof.append(el('p', { class: 'body', style: 'margin-top:var(--md);font-size:13px' }, c.desc));
  wrap.append(prof);

  /* ---------- competitive position ---------- */
  const rivals = U.filter(x => x.c.id !== c.id && x.c.type === c.type &&
    (x.c.sector === c.sector || x.c.mkt === c.mkt)).slice(0, 6);
  const comp = el('div', { class: 'card', style: 'grid-column:1/-1' });
  comp.append(cardHead('Competitive position',
    `Ranked against ${rivals.length} companies sharing this business model. Rank is computed from the sample universe, so it says where this company sits among the peers carried here — not among every listed competitor.`));
  if (!rivals.length) {
    comp.append(el('p', { class: 'caption' }, 'No comparable peer of the same business model is carried in the sample universe.'));
  } else {
    const set = [r, ...rivals];
    const measures = c.type === 'bank'
      ? [['Return on equity', x => x.m.roe, false], ['Cost-to-income', x => x.m.cir, true],
         ['Impaired loans', x => x.m.npl, true], ['CET1 ratio', x => x.m.cet1, false]]
      : c.type === 'reit'
      ? [['Occupancy', x => x.m.occ, false], ['Net property margin', x => x.m.om, false],
         ['Gearing', x => x.m.gearing, true], ['Distribution yield', x => x.m.dy, false]]
      : [['Operating margin', x => x.m.om, false], ['Return on invested capital', x => x.m.roic, false],
         ['Revenue CAGR (4y)', x => x.m.rev5, false], ['Free cash flow margin', x => x.m.fcfm, false]];

    const tw2 = el('div', { class: 'tablewrap' });
    const t2 = el('table', { class: 'dt' });
    t2.append(el('thead', {}, el('tr', {}, ['Measure', c.tk, 'Peer median', 'Rank', 'Standing'].map(h => el('th', {}, h)))));
    t2.append(el('tbody', {}, measures.map(([label, get, lowerBetter]) => {
      const own = get(r), vals = set.map(get).filter(isNum);
      const med = median(vals);
      let rank = null;
      if (isNum(own) && vals.length > 1) {
        const sorted = [...vals].sort((a, b) => lowerBetter ? a - b : b - a);
        rank = sorted.indexOf(own) + 1;
      }
      const better = isNum(own) && isNum(med) && (lowerBetter ? own < med : own > med);
      const f = SECTOR_FMT[label] || (v => fmtPct(v, 1));
      return el('tr', {}, [
        el('td', { class: 'ident' }, label),
        el('td', { html: isNum(own) ? f(own) : NA }),
        el('td', { html: isNum(med) ? f(med) : NA }),
        el('td', {}, rank ? `${rank} of ${vals.length}` : '—'),
        el('td', { html: !isNum(own) || !isNum(med) ? '<span class="caption">—</span>'
          : (better ? sevChip('good', 'Above peers').outerHTML : sevChip('warning', 'Below peers').outerHTML) }),
      ]);
    })));
    tw2.append(t2); comp.append(tw2);
    comp.append(el('div', { class: 'row row-wrap', style: 'gap:5px;margin-top:var(--sm)' },
      [el('span', { class: 'caption' }, 'Peer set:'), ...rivals.map(x =>
        el('button', { class: 'chip', style: 'cursor:pointer', onclick: () => openResearch(x.c.id) }, x.c.tk))]));
    comp.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:var(--sm)', onclick: () => {
      State.compare = [c.id, ...rivals.map(x => x.c.id)].slice(0, LIMITS.compare);
      store.write('compare', State.compare); go('compare');
    } }, 'Open the full comparison'));
  }
  wrap.append(comp);
  return wrap;
}

/* ------------------------------------------------------------- financials */
State.finMode = 'abs';
function tabFinancials(r) {
  const { c, d, m } = r;
  const isBank = c.type === 'bank';
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  const chartCard = el('div', { class: 'card' });
  chartCard.append(cardHead('Revenue, operating profit and free cash flow',
    `Reported ${c.ccy} billions, FY${YEARS[0]}–FY${last(YEARS)}.` + (isBank ? ' Free cash flow is not shown for a bank — it is not a meaningful measure for a deposit-taking balance sheet.' : ''),
    el('div', { class: 'segmented' }, [['abs', 'Reported'], ['idx', 'Indexed to 100']].map(([v, l]) =>
      el('button', { 'aria-selected': State.finMode === v ? 'true' : 'false', onclick: () => { State.finMode = v; render(); } }, l)))));
  const host = el('div', { style: 'width:100%' });
  chartCard.append(host);

  const idx = (arr) => { const b = arr.find(isNum); return arr.map(v => isNum(v) && b ? v / b * 100 : null); };
  const series = [
    { key:'rev', label:isBank ? 'Total income' : 'Revenue', values:State.finMode === 'idx' ? idx(d.rev) : d.rev, varName:'--s1' },
    { key:'ebit', label:isBank ? 'Pre-provision profit' : 'Operating profit', values:State.finMode === 'idx' ? idx(d.ebit) : d.ebit, varName:'--s2' },
  ];
  if (!isBank) series.push({ key:'fcf', label:'Free cash flow', values:State.finMode === 'idx' ? idx(d.fcf) : d.fcf, varName:'--s3' });

  const leg = el('div', { class: 'legend', style: 'margin-top:var(--sm)' });
  series.forEach(s => leg.append(el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(${s.varName})"></span>${esc(s.label)}` })));
  chartCard.append(leg);
  chartCard.append(tableTwin('Show the table view',
    ['Line', ...YEARS.map(y => `FY${y}`)],
    series.map(s => [s.label, ...s.values.map(v => isNum(v) ? fmtNum(v, 2) : 'n/a')])));
  wrap.append(chartCard);
  columnChart(host, { cats: YEARS.map(y => `FY${y}`), series, fmt: v => State.finMode === 'idx' ? fmtNum(v, 0) : fmtNum(v, Math.abs(v) < 10 ? 1 : 0), title: 'Reported financials' });

  /* statement table */
  const stmt = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
  const sh = el('div', { style: 'padding:var(--md) var(--lg);border-bottom:1px solid var(--line)' });
  sh.append(el('h3', { class: 'h-card' }, 'Normalised statements'));
  sh.append(el('p', { class: 'caption', style: 'margin-top:2px' },
    `All values in ${c.ccy} billions unless stated. Derived lines are marked — they are computed from the reported lines above them, not stored separately.`));
  stmt.append(sh);

  const lines = [
    ['Revenue', d.rev, false], ['Operating profit', d.ebit, false], ['Net profit', d.ni, false],
    ...(isBank ? [] : [['Operating cash flow', d.ocf, false], ['Capital expenditure', d.capex.map(v => -v), false], ['Free cash flow', d.fcf, true]]),
    ['Shareholders’ equity', d.eq, false], [isBank ? 'Borrowings' : 'Total debt', d.debt, false],
    ...(isBank ? [] : [['Cash and equivalents', d.cash, false], ['Net debt', d.debt.map((v, i) => v - d.cash[i]), true]]),
    ['Shares in issue (bn)', d.sh, false],
    [c.type === 'reit' ? 'Distribution per unit' : 'Dividend per share', d.dps, false],
    ['Earnings per share', d.eps, true],
    ['Book value per share', d.bvps, true],
  ];
  const tw = el('div', { class: 'tablewrap', style: 'border:0;border-radius:0' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, [el('th', { class: 'pin' }, 'Line'), ...YEARS.map(y => el('th', {}, `FY${y}`)), el('th', {}, `${YEARS.length - 1}y CAGR`)])));
  const tb = el('tbody');
  lines.forEach(([label, arr, derivedLine]) => {
    const tr = el('tr');
    tr.append(el('td', { class: 'pin ident', html: esc(label) + (derivedLine ? ' <span class="chip" style="height:16px;font-size:12px;padding:0 5px">derived</span>' : '') }));
    arr.forEach(v => tr.append(el('td', { html: isNum(v) ? fmtNum(v, Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 3 : 2) : 1) : NA })));
    const g = cagr(arr);
    tr.append(el('td', { class: signClass(g), html: isNum(g) ? withSign(g, 1) : '<span class="caption">n/m</span>' }));
    tb.append(tr);
  });
  t.append(tb); tw.append(t); stmt.append(tw);
  stmt.append(el('div', { style: 'padding:var(--sm) var(--lg)' },
    el('p', { class: 'metaline' }, 'CAGR is null where the base period is non-positive — shown as n/m rather than as a computed number that would not mean anything.')));
  wrap.append(stmt);

  /* derived quarterly */
  const q = quarters(c, d);
  const qc = el('div', { class: 'card' });
  qc.append(cardHead('Quarterly shape (derived)',
    'These quarters are apportioned from the two most recent reported years using a fixed company-specific seasonal profile. They are labelled derived because they are not separately reported in the sample dataset.'));
  const qh = el('div', { style: 'width:100%' });
  qc.append(qh);
  qc.append(tableTwin('Show the table view', ['Quarter', 'Revenue', 'Net profit'], q.map(x => [x.label, fmtNum(x.rev, 2), fmtNum(x.ni, 2)])));
  wrap.append(qc);
  columnChart(qh, { cats: q.map(x => x.label.replace(' FY', ' ’')), series: [
    { key:'rev', label:'Revenue', values:q.map(x => x.rev), varName:'--s1' },
    { key:'ni', label:'Net profit', values:q.map(x => x.ni), varName:'--s2' }],
    fmt: v => fmtNum(v, Math.abs(v) < 10 ? 1 : 0) });

  return wrap;
}

/* ---------------------------------------------------------------- quality */
function tabQuality(r) {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const intro = el('div', { class: 'card' });
  intro.append(cardHead('How each score is built',
    'Every pillar decomposes to its weighted inputs, the raw value, the anchor range that maps it to 0–100, the resulting contribution, and the peer percentile. Missing inputs reduce coverage — they are never filled in with an assumption.'));
  const chips = el('div', { class: 'row row-wrap', style: 'gap:6px' });
  chips.append(el('span', { class: 'chip' }, `Model ${MODEL_VERSION}`));
  chips.append(el('span', { class: 'chip' }, `Cohort: ${r.c.mkt} market`));
  chips.append(el('span', { class: 'chip' }, `Calculated ${AS_OF}`));
  chips.append(el('span', { class: 'chip' }, `Source periods FY${YEARS[0]}–FY${last(YEARS)}`));
  intro.append(chips);
  wrap.append(intro);

  /* What this score does not test, stated beside it rather than left to be
     discovered. Section 7.7 requires the aggregate not to conceal a weakness,
     and the largest weakness here is not a low pillar — it is two pillars that
     were never measured. */
  const cov = el('div', { class: 'card' });
  cov.append(cardHead('What this score tests, and what it does not',
    'Against the five-pillar framework, each weighted a fifth. Every factor scored here comes from the financial statements; nothing scored here tests a moat, an owner or a board.'));
  const notScored = SCORECARD_COVERAGE.filter(p => p.state === 'not scored').length;
  const partial   = SCORECARD_COVERAGE.filter(p => p.state === 'partial').length;
  cov.append(el('p', { class: 'body', style: 'font-size:13px;margin-bottom:var(--md)' },
    `${SCORECARD_COVERAGE.length - notScored - partial} of ${SCORECARD_COVERAGE.length} pillars are tested in full, ${partial} in part, and ${notScored} not at all. A high score is evidence about the statements and nothing more.`));

  const ct = el('table', { class: 'dt' });
  ct.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Pillar'), el('th', {}, 'Framework weight'),
    el('th', {}, 'State'), el('th', {}, 'Tested here'), el('th', {}, 'Not tested')])));
  const cb = el('tbody');
  SCORECARD_COVERAGE.forEach(p => {
    const tr = el('tr', {});
    tr.append(el('td', { style: 'font-weight:600' }, p.pillar));
    tr.append(el('td', { class: 'num' }, `${p.weight}%`));
    tr.append(el('td', {}, el('span', {
      class: 'chip ' + (p.state === 'tested' ? 'chip-ok' : p.state === 'partial' ? 'chip-bronze' : 'chip-warn') },
      p.state)));
    tr.append(el('td', { class: 'metaline' }, p.tested.length ? p.tested.join(' · ') : '—'));
    tr.append(el('td', { class: 'metaline' }, p.untested.join(' · ')));
    cb.append(tr);
    cb.append(el('tr', {}, el('td', { class: 'metaline', colspan: 5, style: 'padding-top:0' }, p.why)));
  });
  ct.append(cb);
  cov.append(el('div', { style: 'overflow-x:auto' }, ct));

  /* The moat status for this specific company, so a strong score is not read as
     including a judgement nobody made about it. */
  const assessed = r.c.moat && r.c.moat.kind !== 'Not assessed';
  cov.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    assessed
      ? `Moat evidence exists for ${r.c.tk} — ${r.c.moat.kind}, confidence ${String(r.c.moat.conf).toLowerCase()} — and is on the Moat tab. It is recorded, not scored, and contributes nothing to the number above.`
      : `No moat assessment exists for ${r.c.tk}. It was loaded from filings, and moat evidence is analyst work that has not been done for this company. The score above is unaffected either way, because the moat pillar is never scored.`));
  wrap.append(cov);

  [['quality', 'Business Quality'], ['growth', 'Growth Quality'], ['strength', 'Financial Strength'], ['capital', 'Capital Allocation'], ['value', 'Valuation']].forEach(([k, label]) => {
    const p = r.scores[k];
    const card = el('div', { class: 'card' });
    const hd = el('div', { class: 'card-hd' });
    hd.append(el('div', {}, [
      el('h3', { class: 'h-card' }, label),
      el('p', { class: 'metaline', style: 'margin-top:2px' }, `Weighted from ${p.parts.filter(x => isNum(x.score)).length} of ${p.parts.length} inputs · input coverage ${p.coverage}%`),
    ]));
    hd.append(el('div', { style: 'text-align:right' }, [
      el('div', { class: 'num', style: 'font-size:24px;font-weight:700' }, isNum(p.score) ? p.score : '—'),
      el('div', { class: 'metaline' }, isNum(r.pct[k]) ? `${ord(r.pct[k])} percentile` : 'no percentile'),
    ]));
    card.append(hd);

    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, ['Input', 'Raw value', 'Anchor range', 'Input score', 'Weight', 'Contribution', 'Peer pct'].map(h => el('th', {}, h)))));
    const tb = el('tbody');
    p.parts.forEach(part => {
      const tr = el('tr');
      tr.append(el('td', { class: 'ident' }, part.label));
      tr.append(el('td', { html: isNum(part.raw) ? part.fmt(part.raw) : NA }));
      tr.append(el('td', { html: `<span class="caption">${part.fmt(part.lo)} → ${part.fmt(part.hi)}${part.inv ? ' (inverted)' : ''}</span>` }));
      tr.append(el('td', { html: isNum(part.score) ? Math.round(part.score) : NA }));
      tr.append(el('td', {}, `${Math.round(part.w * 100)}%`));
      tr.append(el('td', { html: isNum(part.score) ? `<b style="color:var(--ink)">${Math.round(part.score * part.w)}</b>` : NA }));
      tr.append(el('td', { html: String(metricPct(r, part.k, 'market', part.inv) ?? '—') }));
      tb.append(tr);
    });
    t.append(tb); tw.append(t); card.append(tw);
    if (p.coverage < 100) card.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      `Weights are re-based across the inputs that could be computed, and the shortfall is reported as coverage — the score is not credited for data it does not have.`));
    /* Every field here is labelled "(4y)", which is right for a filer carrying
       ten years of statements and wrong for one carrying four. The window the
       figures were actually computed over travels with the metrics, so the card
       can correct its own labels instead of letting a shorter series pass as a
       longer one. */
    if (k === 'growth' && isNum(r.m.growthYears) && r.m.growthYears < 4)
      card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
        `Computed over ${r.m.growthYears} year${r.m.growthYears === 1 ? '' : 's'}, not four — only ${r.m.growthYears + 1} annual statements are held for this company. The labels above read "(4y)" because that is the field definition; the window is what is stated here, and a shorter window makes a growth rate more sensitive to its endpoints.`));
    wrap.append(card);
  });

  /* Momentum, shown apart from the pillars. */
  const mc = el('div', { class: 'card', style: 'border-left:3px solid var(--s3)' });
  const mh = el('div', { class: 'card-hd' });
  mh.append(el('div', {}, [
    el('div', { class: 'row', style: 'gap:6px;margin-bottom:2px' }, [
      el('h3', { class: 'h-card' }, 'Momentum / change'),
      el('span', { class: 'chip' }, 'Context indicator'),
    ]),
    el('p', { class: 'caption', style: 'max-width:62ch' },
      'Kept separate from every pillar above. Momentum describes what the market and the latest reported period have done — it is not evidence about business quality, and combining the two would hide exactly the trade-off worth seeing.'),
  ]));
  mh.append(el('div', { style: 'text-align:right' }, [
    el('div', { class: 'num', style: 'font-size:24px;font-weight:700' }, isNum(r.mom.score) ? r.mom.score : '—'),
    el('div', { class: 'metaline' }, `cohort median ${withSign(r.mom.cohortMedian, 1)} over 12m`),
  ]));
  mc.append(mh);
  const mtw = el('div', { class: 'tablewrap' });
  const mt = el('table', { class: 'dt' });
  mt.append(el('thead', {}, el('tr', {}, ['Input', 'Raw value', 'Anchor range', 'Input score', 'Weight', 'Contribution'].map(h => el('th', {}, h)))));
  mt.append(el('tbody', {}, r.mom.parts.map(part => el('tr', {}, [
    el('td', { class: 'ident' }, part.label),
    el('td', { html: isNum(part.raw) ? part.fmt(part.raw) : NA }),
    el('td', { html: `<span class="caption">${part.fmt(part.lo)} → ${part.fmt(part.hi)}</span>` }),
    el('td', { html: isNum(part.score) ? Math.round(part.score) : NA }),
    el('td', {}, `${Math.round(part.w * 100)}%`),
    el('td', { html: isNum(part.score) ? `<b style="color:var(--ink)">${Math.round(part.score * part.w)}</b>` : NA }),
  ]))));
  mtw.append(mt); mc.append(mtw);
  wrap.append(mc);
  return wrap;
}

/* -------------------------------------------------------------------- moat */
function tabMoat(r) {
  const { c, m } = r;
  const wrap = el('div', { class: 'grid g-2' });
  const card = el('div', { class: 'card' });
  card.append(cardHead(`Moat evidence — ${c.moat.kind}`,
    'Evidence is structured, not asserted. Supporting and counter-evidence are shown together with a durability horizon and a confidence grade.'));
  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  [['Moat type', c.moat.kind], ['Durability horizon', c.moat.dur], ['Confidence', c.moat.conf],
   ['Evidence date', `FY${last(YEARS)} reported · reviewed ${AS_OF}`], ['Review status', 'Analyst-reviewed template']]
   .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, v)); });
  card.append(kv);

  card.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Supporting evidence'));
  const s = el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:var(--md)' });
  c.moat.support.forEach(x => s.append(el('div', { class: 'evidence support', style: 'font-size:13px' }, x)));
  card.append(s);

  card.append(el('h4', { class: 'eyebrow', style: 'margin-bottom:6px' }, 'Counter-evidence'));
  const cn = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  c.moat.counter.forEach(x => cn.append(el('div', { class: 'evidence counter', style: 'font-size:13px' }, x)));
  card.append(cn);
  wrap.append(card);

  const corr = el('div', { class: 'card' });
  corr.append(cardHead('Quantitative corroboration', 'The numbers that would have to hold for the moat claim to be true. If these deteriorate, the claim weakens regardless of the narrative.'));
  const rows = c.type === 'bank'
    ? [['Net interest margin', fmtPct(m.nim, 2), 'Pricing power on the funding base'],
       ['Cost-to-income ratio', fmtPct(m.cir), 'Operating efficiency versus peers'],
       ['Gross impaired loans', fmtPct(m.npl, 2), 'Underwriting quality'],
       ['CET1 ratio', fmtPct(m.cet1), 'Capacity to lend through a downturn']]
    : c.type === 'reit'
    ? [['Occupancy', fmtPct(m.occ), 'Genuine tenant demand'],
       ['Weighted lease expiry', `${fmtNum(m.wale)} yrs`, 'Contracted income duration'],
       ['Net property margin', fmtPct(m.om), 'Operating leverage on the assets'],
       ['Gearing', fmtPct(m.gearing), 'Refinancing exposure']]
    : [['Return on invested capital', isNum(m.roic) ? fmtPct(m.roic) : 'n/a', 'Excess return over the cost of capital'],
       ['Operating margin', fmtPct(m.om), 'Pricing power net of cost'],
       ['Margin stability', isNum(m.revVol) ? `${fmtNum(m.revVol)} s.d.` : '—', 'Whether the advantage holds through the cycle'],
       ['Free cash flow margin', isNum(m.fcfm) ? fmtPct(m.fcfm) : 'n/a', 'Conversion of the advantage into cash']];
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Measure'), el('th', {}, 'Latest'), el('th', {}, 'Peer pct'), el('th', {}, 'Why it matters')])));
  t.append(el('tbody', {}, rows.map(([label, v, why], i) => el('tr', {}, [
    el('td', { class: 'ident' }, label), el('td', {}, v),
    el('td', {}, String(metricPct(r, ['roic', 'om', 'revVol', 'fcfm'][i] || 'roic', 'sector') ?? '—')),
    el('td', { style: 'text-align:left;white-space:normal;max-width:220px', class: 'caption' }, why),
  ]))));
  tw.append(t); corr.append(tw);
  corr.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
    'The platform does not publish an "objective moat" verdict. It publishes the evidence, the counter-evidence and the confidence, and leaves the judgement with the reader.'));
  wrap.append(corr);
  return wrap;
}

/* -------------------------------------------------------------------- risks */
function tabRisks(r) {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const hd = el('div', { class: 'card' });
  hd.append(cardHead(`Risk grade — ${r.risk.band}`,
    'Flags are computed from the reported statements against published thresholds, then a qualitative analyst note is added. A grade is not a probability.'));
  const meter = el('div', { class: 'meter', style: 'height:8px' });
  meter.append(el('i', { style: `width:${r.risk.raw}%;background:var(${r.risk.band === 'High' ? '--critical' : r.risk.band === 'Medium' ? '--warn' : '--ok'})` }));
  hd.append(meter);
  hd.append(el('div', { class: 'row', style: 'margin-top:6px' }, [
    el('span', { class: 'metaline' }, 'Low'), el('span', { class: 'spacer' }),
    el('span', { class: 'metaline' }, `Composite ${r.risk.raw}/100`), el('span', { class: 'spacer' }),
    el('span', { class: 'metaline' }, 'High'),
  ]));
  wrap.append(hd);

  const list = el('div', { class: 'card' });
  list.append(cardHead(`${r.flags.length} flag${r.flags.length === 1 ? '' : 's'}`, 'Each flag names the measure that triggered it, so it can be checked against the statements.'));
  const l = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  r.flags.forEach(f => {
    const item = el('div', { class: 'panel' });
    item.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:4px' }, [
      sevChip(f.sev), el('span', { style: 'font-size:13px;font-weight:600' }, f.title),
      el('span', { class: 'spacer' }),
      f.metric ? el('button', { class: 'btn btn-quiet btn-sm', onclick: () => FIELD_BY_K[f.metric] ? openMetricInfo(FIELD_BY_K[f.metric]) : toast('Derived flag — see the statements tab') }, 'Check the input') : null,
    ]));
    item.append(el('p', { class: 'body', style: 'font-size:13px' }, f.detail));
    l.append(item);
  });
  list.append(l);
  wrap.append(list);
  return wrap;
}

/* ---------------------------------------------------------------- ownership */
function tabOwnership(r) {
  const { c, d, m } = r;
  const wrap = el('div', { class: 'grid g-2' });

  const own = el('div', { class: 'card' });
  own.append(cardHead('Ownership', 'Substantial holders as recorded in the sample dataset.'));
  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  [['Directors and insiders', fmtPct(c.own.insider, 2)], ['Institutional', fmtPct(c.own.inst, 1)], ['Free float (implied)', fmtPct(100 - c.own.inst - c.own.insider, 1)]]
    .forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', {}, v)); });
  own.append(kv);
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Holder'), el('th', {}, 'Stake')])));
  t.append(el('tbody', {}, c.own.top.map(([n, p]) => el('tr', {}, [el('td', { class: 'ident' }, n), el('td', {}, fmtPct(p, 1))]))));
  tw.append(t); own.append(tw);
  wrap.append(own);

  const act = el('div', { class: 'card' });
  act.append(cardHead('Corporate actions and share count',
    'Share count is the cleanest evidence of buybacks and issuance — it cannot be presented selectively.'));
  const host = el('div', { style: 'width:100%' });
  act.append(host);
  act.append(el('div', { class: 'legend', style: 'margin-top:var(--sm)' },
    el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(--s1)"></span>Shares in issue (bn)` })));
  act.append(tableTwin('Show the table view', ['Year', 'Shares (bn)', 'Change'],
    YEARS.map((y, i) => [`FY${y}`, fmtNum(d.sh[i], 3), i ? withSign((d.sh[i] - d.sh[i - 1]) / d.sh[i - 1] * 100, 2) : '—'])));
  const kv2 = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
  [['Share count CAGR', m.shareSeriesBreak ? 'Withheld — see below' : withSign(m.dilution, 2)],
   ['Net buyback yield', m.shareSeriesBreak ? 'Withheld — see below' : withSign(m.buyback, 2)],
   [c.type === 'reit' ? 'Distribution per unit CAGR' : 'Dividend per share CAGR', isNum(m.dps5) ? withSign(m.dps5, 1) : 'n/m'],
   ['Payout ratio', isNum(m.payout) ? fmtPct(m.payout, 0) : 'n/m'],
   ['Dividends as % of free cash flow', isNum(m.cashPayout) ? fmtPct(m.cashPayout, 0) : 'n/a']]
   .forEach(([k, v]) => { kv2.append(el('dt', {}, k)); kv2.append(el('dd', {}, v)); });
  act.append(kv2);
  /* Share counts arrive from the filings as reported, unadjusted for splits, and
     no corporate-action feed is licensed here to undo one. To a growth rate a
     split is indistinguishable from issuance, which is how this page came to
     report Apple's four-for-one as "share count rising 12.0% a year, which
     dilutes per-share growth" — the reverse of the truth for a company that has
     bought back stock for a decade. Rather than print a number that is wrong in
     its sign, the measure is withheld and the discontinuity is named. */
  if (m.shareSeriesBreak) {
    const b = m.shareSeriesBreak;
    act.append(el('div', { class: 'note', style: 'margin-top:var(--md);border-left:3px solid var(--warn)' },
      el('p', { class: 'body', style: 'font-size:13px' },
        `Share count CAGR and net buyback yield are withheld for this company. The series moves from `
        + `${fmtNum(b.from, 3)}bn to ${fmtNum(b.to, 3)}bn between two consecutive years — a factor of ${b.ratio}× — `
        + `which is a corporate action rather than a financing decision, since no issuance or buyback moves a share `
        + `count that far in a year. The filings are reported unadjusted for splits and no corporate-action source is `
        + `licensed here to restate them, so a growth rate over this series would measure the split, not the company. `
        + `The year-by-year counts above are as filed and remain correct on their own terms.`)));
  }
  wrap.append(act);
  columnChart(host, { cats: YEARS.map(y => `FY${y}`), series: [{ key:'sh', label:'Shares in issue', values:d.sh, varName:'--s1' }], fmt: v => fmtNum(v, 2) });
  return wrap;
}

/* ------------------------------------------------------------------ filings */
function tabFilings(r) {
  const { c } = r;
  const docs = documents(c);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  const hd = el('div', { class: 'card' });
  hd.append(cardHead(c.mkt === 'US' ? 'SEC filings' : 'Bursa announcements and company reports',
    c.mkt === 'US'
      ? 'In production these would be retrieved from EDGAR with the filing index and the extracted facts linked to each claim.'
      : 'In production these would come from a licensed Bursa feed. Announcement content and redistribution rights are a commercial prerequisite, not a scraping exercise.'));
  hd.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
    sevChip('info', 'Sample document list'),
    el('span', { class: 'chip' }, `${docs.length} documents`),
  ]));
  wrap.append(hd);

  docs.forEach((doc, i) => {
    const card = el('div', { class: 'card' });
    const top = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-bottom:6px' });
    top.append(el('span', { class: 'chip chip-brand' }, doc.form));
    top.append(el('span', { class: 'chip' }, doc.kind));
    top.append(el('span', { class: 'metaline' }, doc.date));
    top.append(el('span', { class: 'spacer' }));
    top.append(el('a', { class: 'srclink', href: doc.href, target: '_blank', rel: 'noopener noreferrer', html: `Source ${icon('ext', 10)}` }));
    card.append(top);
    card.append(el('h3', { class: 'h-card', style: 'margin-bottom:6px' }, doc.title));

    if (doc.changed) {
      card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--sm) 0 6px' }, 'What changed'));
      const tw = el('div', { class: 'tablewrap' });
      const t = el('table', { class: 'dt' });
      t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Measure'), el('th', {}, `FY${YEARS[LYI - 1]}`), el('th', {}, `FY${YEARS[LYI]}`), el('th', {}, 'Change')])));
      const map = { 'Revenue':r.d.rev, 'Operating profit':r.d.ebit, 'Net profit':r.d.ni, 'Dividend per share':r.d.dps, 'Distribution per unit':r.d.dps, 'Shares in issue':r.d.sh };
      t.append(el('tbody', {}, doc.changed.map(x => el('tr', {}, [
        el('td', { class: 'ident' }, x.label),
        el('td', {}, fmtNum(map[x.label]?.[LYI - 1] ?? 0, 2)),
        el('td', {}, fmtNum(map[x.label]?.[LYI] ?? 0, 2)),
        el('td', { class: signClass(x.v) }, withSign(x.v, 1)),
      ]))));
      tw.append(t); card.append(tw);

      card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Potential thesis impacts'));
      const imp = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
      const drivers = driverImpact(c, r.d, r.inputs).slice(0, 3);
      drivers.forEach(dr => imp.append(el('div', { class: 'evidence', style: 'font-size:13px' },
        `${dr.label} is the ${drivers.indexOf(dr) === 0 ? 'largest' : 'next largest'} driver of the valuation range — a ${dr.unit === 'pp' ? fmtNum(dr.step, 2) + ' point' : dr.unit} change moves the base-case model estimate about ${fmtNum(dr.span, 1)}%.`)));
      card.append(imp);
      card.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
        'Uncertainty label: these are arithmetic consequences of the reported change, not a claim about what management will do next.'));
    }

    const acts = el('div', { class: 'row', style: 'gap:6px;margin-top:var(--md)' });
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => addToThesis(c.id) }, 'Add to thesis'));
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { go('alerts'); toast('Alert rule builder opened'); } }, 'Create alert'));
    card.append(acts);
    wrap.append(card);
  });
  return wrap;
}

