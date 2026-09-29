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
  /* Only on a contract whose deliverable is known. While it is not, there is
     no obligation to cover and the gate above already says why; falling
     through here reported "Eligible cash has not been entered" beside a field
     holding $5,000, because an invalid contract never computes the coverage. */
  if (m.valid && p.phase !== 'call' && !m.cashSecured)
    gates.push(isNum(m.cashCoveragePct)
      ? `Cash covers ${fmtPct(m.cashCoveragePct * 100, 1)} of the ${fmtMoney(m.requiredAssignmentCash, 'USD')} assignment obligation. A put is not cash-secured below 100%, and the premium does not reduce the requirement.`
      : 'Eligible cash has not been entered, so the put cannot be shown as cash-secured.');
  if (m.valid && p.phase === 'call' && !m.covered)
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
    openLegs: 0, resolvedLegs: 0, maxCapitalCommitted: 0, sharesHeld: 0,
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
    if (l.action === 'assign') { t.shareAcquisitionCash += num0(l.cashPaid); t.sharesHeld += num0(l.shares); }
    if (l.action === 'called_away') {
      t.realisedSharePnl += num0(l.realisedSharePnl);
      t.shareSaleProceeds += num0(l.shareSaleProceeds);
      t.sharesHeld -= num0(l.shares);
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
  /* Closed means nothing is still at risk — no open option AND no shares still
     held. After an assignment every option leg is resolved, but the cash that
     bought the shares has left the account while the shares have not been
     sold: the cash total reads the purchase as a loss of the whole strike, and
     the check that follows raised a "please report this" alarm on an ordinary
     assigned cycle. The shares are an open position, so the cycle is open. */
  t.cycleClosed = t.openLegs === 0 && t.resolvedLegs > 0 && t.sharesHeld <= 0;
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
  /* Built field by field rather than spread from the opening leg. The spread
     carried the opening leg's fees, capital committed and close cost into the
     close, so the ledger counted the opening fees twice, and its `id: undefined`
     overwrote the id addWheelLeg had just generated. The close carries only
     what the close itself cost. */
  addWheelLeg({ phase: openLeg.phase, action:'close', status:'resolved',
    contractLabel: openLeg.contractLabel, strike: openLeg.strike, expiry: openLeg.expiry, shares,
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
    /* A covered call commits the shares already held, not new cash — the same
       zero the register records when a call is opened directly. Only a rolled
       put reserves strike × shares. */
    capitalCommitted: openLeg.phase === 'call' ? 0 : num0(newContract.strike) * num0(newContract.shares),
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
/* The cycle's own position, which the contract keys above do not touch. A
   clear that blanked the contract and the legs but left these behind showed a
   rail at "Assigned", a phase of "covered call" and a frozen share basis on a
   tool with nothing entered — the same keys "Clear the cycle" resets. */
const WHEEL_BLANK_CYCLE = {
  state: 'candidate', phase: 'put',
  economicShareBasisOverride: null, shareCostBasisOverride: null,
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
    /* Seven-tenths of this score is the business-quality score, and an
       absent one was read as 50. The filed REITs have none — their quality
       inputs are not among the lines the statements carry — so Realty
       Income and Prologis were graded compounder B on a quality nobody
       measured, and "Why it might be owned: Long-term compounding" was
       named from it. The Wheel and averaging fits already ask for the
       assessment; this one asks too, and says it is missing. */
    const q = r.scores?.quality?.score;
    const okGrowth = need(hasGrowth, 'Multi-year per-share growth and returns on equity.');
    const okQuality = need(isNum(q), 'A business-quality assessment.');
    if (!okGrowth || !okQuality) return out;
    if (m.roe > 12) out.supports.push(`Return on equity ${fmtPct(m.roe, 1)}.`); else out.weakens.push(`Return on equity ${fmtPct(m.roe, 1)}.`);
    if (m.rev5 > 4) out.supports.push(`Revenue compounding ${fmtPct(m.rev5, 1)} a year over the window held.`);
    else out.weakens.push(`Revenue growth ${fmtPct(m.rev5, 1)} a year.`);
    if (isNum(m.dilution) && m.dilution > 2) out.weakens.push(`Share count rising ${fmtPct(m.dilution, 1)} a year, which dilutes per-share growth.`);
    out.score = Math.round(clamp(q * 0.7 + clamp(m.rev5 * 2, 0, 30), 0, 100));
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

  /* The Basic Directory tier tells the reader, in its own tooltip, that there
     is not enough here to assess a strategy — and then Rivian carried a
     compounder D and a Wheel D beside it. The tier's statement wins: a score
     reached on a directory-tier company is withheld as missing evidence. The
     early returns above still stand, because "not applicable" and "not built"
     are statements about the business or the product, not about coverage. */
  if (isNum(out.score) && tier.id === 'directory') {
    out.score = null;
    out.missing.push('Data coverage above the Basic Directory tier. Identity and partial figures are not enough to grade a strategy.');
    return out;
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
  /* A D is the grade for evidence that meets a strategy's requirements poorly,
     so it cannot also be the stated reason to own the company — 52 filers
     read "Why it might be owned: Long-term compounding" off a compounder D.
     A role is named only from a fit graded C or better. */
  const roleFits = graded.filter(f => roleOf[f.key] && f.grade !== 'D');
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

/* Where a company lists, said honestly. The illustrative and personal sets
   name their exchange; a filer's is in the SEC submissions record, which the
   ingest now reads but the shipped statements predate. */
const EXCH_UNKNOWN = 'SEC companyfacts carries no listing venue. The ingest records it from the filer’s submissions record, and it appears here once data/us.json is regenerated.';
const listingOf = (c) => (c.cik && !c.exchKnown ? 'an exchange not recorded in this dataset' : c.exch);

/* The one toggle in the app, on top of the watchlist service — so a company
   page and the watchlists page cannot disagree about what is in a list. */
function toggleWatch(id, wlIdx = State.wlIdx) {
  const wl = State.watchlists[wlIdx] || activeWL();
  const had = wl.ids.includes(id);
  const r = had ? wlRemove(wl.id, id) : wlAdd(wl.id, id);
  toast(r.ok ? (had ? `Removed from “${wl.name}”` : `Added to “${wl.name}”`) : r.why);
  render();
}

/* THE COMPANY PAGE'S ACTIONS.
   Four things a reader does with a company, each a real link or button so it
   works from the keyboard and a link opens in a new tab. The valuation tab is
   one tab away in the strip below, so it no longer needs a button here.

   The scanner is the exception, and says so. It reads only price history the
   reader supplied — the deployed site ships none, by design — so it is live
   only where that history is loaded, and otherwise shown switched off with the
   reason beside it. Nothing here implies it scans anything else. */
const scannerLaneOn = () => !!(scanHistoryFile?.series && Object.keys(scanHistoryFile.series).length);
function companyActions(r) {
  const { c } = r;
  const box = el('div', { class: 'company-acts' });
  const acts = el('div', { class: 'row row-wrap', style: 'gap:6px;justify-content:flex-end' });
  const link = (path, label, { before, ...attrs } = {}) => el('a', { class: 'btn btn-ghost btn-sm', href: href(path), ...attrs,
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); before?.(); navigate(path); } }, label);
  const watching = State.watchlist.includes(c.id);
  /* An id, because its words change with what it does: render() finds the
     control in use again by id first, and by its words it found nothing and
     left focus on <main> after every press (35-ui.js, giveFocusBack). */
  acts.append(el('button', { class: 'btn btn-ghost btn-sm', id: 'co-watch', 'aria-pressed': watching ? 'true' : 'false',
    onclick: () => toggleWatch(c.id) }, watching ? '✓ On your watchlist' : 'Add to watchlist'));
  /* Compare adds this company to the selection already held, rather than
     replacing it, and drops the oldest when the plan's cap is reached — with a
     toast naming it, so a comparison is never cut silently. */
  const cap = lim('compare');
  const held = (State.compare || []).filter(x => x !== c.id && BY_ID.has(x));
  const next = [...held.slice(Math.max(0, held.length - (cap - 1))), c.id];
  const dropped = held.filter(x => !next.includes(x));
  acts.append(link(`/compare?companies=${next.map(encodeURIComponent).join(',')}`, 'Compare', {
    title: held.length ? `Compare with ${next.filter(x => x !== c.id).map(x => BY_ID.get(x)?.c.tk).join(', ')}` : 'Open a comparison with this company',
    before: () => { if (dropped.length) toast(`${cap} is the most a comparison holds — ${dropped.map(x => BY_ID.get(x)?.c.tk).join(', ')} left it`); } }));
  const thesis = (State.theses || []).find(t => t.ticker === c.id);
  acts.append(el('button', { class: 'btn btn-ghost btn-sm',
    title: 'Your investment case for this company: one line, quality, valuation, catalysts, risks and the conditions that would change your mind',
    onclick: () => addToThesis(c.id) }, thesis ? 'Open your investment case' : 'Save research'));
  const sym = c.tk || c.code || c.id;
  const on = scannerLaneOn();
  if (on) acts.append(link(`/my/scanner?from=${encodeURIComponent(c.id)}&symbol=${encodeURIComponent(sym)}`, 'Open scanner',
    { title: 'Personal-lane scanner: it scans only the price history you supplied' }));
  else acts.append(el('button', { class: 'btn btn-ghost btn-sm', disabled: '', 'aria-describedby': `scan-off-${c.id}` }, 'Open scanner'));
  box.append(acts);
  box.append(el('p', { class: 'metaline', id: `scan-off-${c.id}`, style: 'margin-top:6px;text-align:right' },
    on ? `The scanner is a personal-lane tool: it scans only price history you supplied${scanHistoryFile.series[sym] ? `, which holds ${sym}` : `, which holds no series for ${sym}`}.`
       : 'Scanner switched off here: it scans only price history you supplied, and none is loaded.'));
  return box;
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
  search.append(cardHead('Find a company', 'By name, ticker, listing code, CIK or an old link — and by market and coverage.'));
  const inp = el('input', { class: 'input', type:'search', placeholder:'Maybank, 1155, AAPL, CIK0000320193…',
    'aria-label':'Search for a company', style: 'flex:1;min-width:200px' });
  const sel = (label, opts) => { const x = el('select', { class: 'select', 'aria-label': label, style: 'width:auto;flex:none' });
    opts.forEach(([v, l]) => x.append(el('option', { value: v }, l))); return x; };
  const mkSel = sel('Market', [['', 'All markets'], ['US', 'United States'], ['MY', 'Bursa Malaysia']]);
  const cvSel = sel('Coverage', [['', 'Any coverage'], ['FILED', 'Filed statements'], ['ILLUSTRATIVE', 'Illustrative'], ['UNAVAILABLE', 'Price only']]);
  const results = el('div', { style: 'margin-top:10px;display:flex;flex-direction:column;gap:4px' });
  /* Over the canonical registry, so every name an instrument goes by matches,
     and a price-only instrument is listed as such rather than absent. */
  const runSearch = () => {
    const q = inp.value.trim();
    results.replaceChildren();
    const filters = { market: mkSel.value || null, dataStatus: cvSel.value || null };
    if (q.length < 2 && !filters.market && !filters.dataStatus) return;
    const { hits, total } = searchInstruments(q, filters, { limit: 8 });
    hits.forEach(ins => {
      const r = ins.companyId ? BY_ID.get(ins.companyId) : null;
      const label = r
        ? `${r.c.tk || r.c.code} — ${r.c.name}${illusText(r.c)}${r.c.personal ? ' · personal research' : ''}`
        : `${ins.symbol} — ${ins.companyName} · price only, no statements`;
      results.append(el('button', { class: 'btn btn-ghost btn-sm', style: 'justify-content:flex-start;text-align:left;white-space:normal',
        onclick: () => { if (r) { State.ticker = r.c.id; navigate(companyPath(r.c)); } else navigate('/my/tracked'); } }, label));
    });
    if (total > hits.length) results.append(el('p', { class: 'metaline' }, `Showing ${hits.length} of ${total} — narrow the search.`));
    /* A search run from the filters alone has no words to quote: Bursa with
       "Filed statements" read Nothing … matches “”. */
    if (!results.children.length) results.append(el('p', { class: 'metaline' }, q
      ? `Nothing in the beta universe matches “${q}”.`
      : 'Nothing in the beta universe matches these filters.'));
  };
  let searchTimer = null;
  inp.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 120); });
  mkSel.addEventListener('change', runSearch); cvSel.addEventListener('change', runSearch);
  /* THE PAGE'S ONE ACTION. The overview had no primary at all — its main
     affordance was a 34px field — though "Research a company" is the
     product's one action (PRODUCTS). The field is the page's largest control
     now, and the button does what it says: with one match it opens that
     company; with several it moves to the first result, so the list is one
     Tab away; with nothing typed it puts the cursor in the field. Enter in
     the field is the same press. */
  const act = () => {
    clearTimeout(searchTimer);
    if (!inp.value.trim() && !mkSel.value && !cvSel.value) { inp.focus(); return; }
    runSearch();
    const hits = [...results.querySelectorAll('button')];
    if (hits.length === 1) hits[0].click();
    else if (hits.length) hits[0].focus();
    else inp.focus();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); act(); } });
  inp.classList.add('rh-search');
  const eq = typeof productById === 'function' ? productById('equities') : null;
  search.append(el('div', { class: 'row row-wrap rh-searchrow', style: 'gap:8px' }, [inp, mkSel, cvSel,
    el('button', { type: 'button', class: 'btn btn-primary rh-go', onclick: act }, eq?.action || 'Research a company')]));
  search.append(results);
  wrap.append(search);

  /* Collections, described by what they contain. applyTemplate only sets the
     screen and re-renders whatever view is current, so the three template
     cards used to leave the reader on this page with nothing visibly changed;
     each now goes to the screener it has just set up, as the market cards do. */
  const viaTemplate = (id) => () => { applyTemplate(SCREEN_TEMPLATES.find(t => t.id === id)); navigate('/discover/screener'); };
  const colls = [
    ['Bursa Malaysia',  'Malaysian listings in the beta universe.',      () => { const s = blankScreen(); s.universe='MY'; State.screen=s; State.appliedTemplate=null; navigate('/discover/screener'); }],
    ['US equities',     'US listings, filed with the SEC.',              () => { const s = blankScreen(); s.universe='US'; State.screen=s; State.appliedTemplate=null; navigate('/discover/screener'); }],
    ['Banks',           'Deposit takers, on measures that fit a bank balance sheet.', viaTemplate('my-banks')],
    ['REITs',           'Property trusts, on distribution and gearing.', viaTemplate('my-reits')],
    ['Dividend research','Payout covered by cash rather than borrowing.', viaTemplate('div-cover')],
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
      onclick: () => { State.ticker = r.c.id; navigate(companyPath(r.c)); } }, (r.c.tk || r.c.code) + illusText(r.c))));
    rc.append(row);
  } else rc.append(el('p', { class: 'metaline' }, 'Nothing yet. Companies you open will be listed here.'));
  wrap.append(rc);

  const cases = el('div', { class: 'card' });
  cases.append(cardHead('Saved research cases', 'Your own written theses and their conditions.'));
  const th = State.theses || [];
  if (th.length) {
    const row = el('div', { class: 'row row-wrap', style: 'gap:8px' });
    /* A seeded case says it is a sample, as the dashboard and the personal
       pages do: under "Your own written theses" the two seeded ones read as
       the visitor's. */
    const seeded = (t) => typeof SEEDED_THESIS_IDS !== 'undefined' && SEEDED_THESIS_IDS.includes(t.id);
    th.slice(0, 8).forEach(t => row.append(el('button', { class: 'btn btn-ghost btn-sm',
      'aria-label': seeded(t) ? `${t.ticker}, sample case` : null,
      onclick: () => navigate('/my/theses') }, [t.ticker, seeded(t) ? el('span', { class: 'chip chip-bronze', 'aria-hidden': 'true' }, 'sample') : null])));
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
    /* Said at the top of the page, not only in the Strategy Lens and the data
       confidence block further down. The identity header is the one part of
       the page every reader sees. */
    c.real ? null : el('span', { class: 'chip chip-bronze',
      title: 'Financial figures for this company are synthetic — created for interface demonstration. They are not filed, and they are not real.' }, 'illustrative figures'),
    /* A filer's listing venue is not in companyfacts, and "SEC filer · MSFT"
       read as though the SEC were an exchange. Said as unknown until the
       statements carry it. */
    c.cik && !c.exchKnown
      ? el('span', { class: 'chip', title: EXCH_UNKNOWN }, `Exchange not in this dataset · ${c.code}`)
      : el('span', { class: 'chip' }, `${c.exch} · ${c.code}`),
    /* A withheld classification says why on hover, rather than reading as a
       filer nobody had classified. */
    el('span', c.sectorWithheld ? { class: 'chip chip-bronze', title: c.sectorWithheld } : { class: 'chip' }, c.sectorWithheld ? 'Sector withheld' : c.sector),
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
  /* The four actions (batch C), and the printable report (batch F) in the
     same row. A real link, so it opens in a new tab for printing beside the
     page it came from. */
  const actionsBox = companyActions(r);
  const reportPath = `${companyPath(c)}/report`;
  (actionsBox.querySelector('.row') || actionsBox).append(el('a', { class: 'btn btn-ghost btn-sm', href: href(reportPath), title: 'A print-first research report — saved as PDF through your browser’s print dialog',
    onclick: e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(reportPath); } }, 'Report'));
  pxBlock.append(actionsBox);
  top.append(pxBlock);
  head.append(top);

  /* One freshness line, in the same place for every company: which year the
     statements run to, where they came from and when, and how the price is
     dated. The filed strip below says more for a filer; this line is the part
     every company has. */
  head.append(el('div', { style: 'margin-top:var(--md);padding-top:var(--sm);border-top:1px solid var(--grid)' },
    provenance(r, [`<b>Model</b> ${r.val.pack.name}`, `<b>Confidence</b> ${r.val.confBand}`], { freshness: true })));

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
      /* The rules that wrote the record. A filed company from the shipped
         file has none, and the chip says the stamp is not in this dataset yet
         rather than implying the current rules produced it. */
      !c.personal ? (c.ingestVersion
        ? el('span', { class: 'chip', title: 'The version of the SEC ingest rules that produced these statements.' }, `ingest ${c.ingestVersion.replace(/^sec /, '')}`)
        : el('span', { class: 'chip chip-bronze', title: 'This file was written before the ingest stamped its version, under rules since corrected — the misassembled figures are withheld on the page. A regeneration writes the version here.' }, 'ingest version not in this dataset yet')) : null,
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
    /* Restatements: a record from the corrected ingest keeps the first-filed
       figure beside the latest. Read defensively — the shipped file predates
       it and carries none. */
    const restated = Object.entries(c.provenance || {}).filter(([, p]) => p.restated && Object.keys(p.restated).length);
    if (restated.length) rp.append(el('p', { class: 'metaline', style: 'margin-bottom:6px' },
      `Restated in a later filing, and shown as restated: ${restated.map(([k, p]) => `${LINE_LABEL[k] || k} FY${Object.keys(p.restated).join(', FY')}`).join('; ')}. The first-filed figure is kept in the dataset.`));

    const pr = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:flex-end' });
    const f = el('div', { class: 'field', style: 'width:150px' });
    f.append(el('label', { for: 'realpx' }, `Price (${c.ccy || 'USD'})`));
    f.append(el('input', { class: 'input input-inline', id: 'realpx', type: 'number', step: '0.01',
      value: isNum(c.px?.p) ? c.px.p : '', placeholder: 'not available',
      onchange: e => {
        if (setManualPrice(c.id, parseFloat(e.target.value))) { location.reload(); return; }
        e.target.value = isNum(c.px?.p) ? c.px.p : ''; toast(STORE_REFUSED);
      } }));
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
          /* Two different reasons reach here, and the old single sentence
             claimed the first even when fits had been graded. */
          lens.assessable
            ? 'Not stated. No return role graded above D, and a weak fit is not a reason to own anything.'
            : 'Not stated. No strategy could be assessed from the data held, and naming a return role without one would be a guess dressed as a classification.'),
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
  /* Sentences wrap between words. .caption breaks anywhere, which let the
     table give "Supports" the width of one letter beside the columns that do
     not wrap: at 390px it was 85px and "Distributions" and "compounding"
     were cut in two. Whole words and a readable measure; the table scrolls
     in its .tablewrap. */
  const prose = 'text-align:left;white-space:normal;overflow-wrap:normal;min-width:12rem';
  lens.fits.forEach(f => fb.append(el('tr', {}, [
    el('td', { style: 'text-align:left' }, f.label),
    el('td', {}, f.state === 'graded' ? f.grade : (FIT_STATES[f.state] || FIT_STATES.missing).token),
    el('td', { class: 'caption', style: prose },
      f.supports.length ? f.supports.join(' ') : '—'),
    el('td', { class: 'caption', style: prose },
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
  /* A tablist with arrow keys between the tabs (tabStrip, 40-views-discover).
     Through the address, so Back returns to the previous tab and a link
     carries the one it was copied from. */
  stick.append(tabStrip(`Sections of the ${c.name} report`, RESEARCH_TABS, State.researchTab,
    id => openResearch(State.ticker, id)));
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
        e.target.selectedIndex = 0;
        if (!t) return;
        /* The reader goes where the page went. A heading takes no focus of its
           own, so t.focus() did nothing: focus stayed on the select in the
           strip, and the next Tab went on from there rather than from the
           section. tabindex=-1 holds focus without joining the Tab order. */
        t.setAttribute('tabindex', '-1');
        t.focus({ preventScroll: true });
        t.scrollIntoView({ block: 'start' });
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
    || `${c.name} is listed on ${listingOf(c)}. No business description has been recorded for it.`;
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

/* AN ABSENT MEASURE SAYS WHY, AS THE SCREENER SAYS IT. The company tabs
   marked an absence "n/a" — the mark this product keeps for a measure that
   does not apply — or "n/m", whatever the cause. The peer table gave every
   unpriced filer's P/E "n/m", "not meaningful on its inputs", where the
   screener says it needs a price (67 companies); Coca-Cola's, its share
   count withheld, the same; and Adobe's return on invested capital read
   "n/a" with its debt line withheld. A measure the screener lists takes
   metricStatus's short reason, with its sentence as the title; one it does
   not list keeps the generic mark. */
function absentMark(r, k) {
  if (!FIELD_BY_K[k]) return NA;
  const st = metricStatus(r, k);
  return `<span class="caption cell-absent" title="${esc(st.text)}">${esc(st.label)}</span>`;
}

/* --------------------------------------------------------------- snapshot */
/* A stat tile that opens something, as a real button so the keyboard reaches
   it. The tile inside keeps its own markup; the button only adds the
   affordance and the focus ring. */
function tileButton(node, label, onclick) {
  const b = el('button', { type: 'button', class: 'tile-btn', 'aria-label': label, onclick });
  b.append(node);
  return b;
}

/* THE OVERVIEW TILES.
   What the business reported in its latest year, before anything is scored
   or priced: revenue, net income, operating cash flow and equity. They read
   the same statement lines the Financials table shows — no arithmetic here —
   and each names its fiscal year, carries a badge for the kind of source
   (filed, illustrative, personal) and opens the source drawer for that line
   and year. Every company has these four lines, priced or not, so the top of
   the page is never a row of dashes. */
function overviewTiles(r) {
  const { c } = r;
  const yrs = yearsOf(c), i = yrs.length - 1, fy = yrs[i];
  const lines = statementLines(r);
  const end = fyEndOf(c, fy);
  const badge = c.real
    ? (c.personal
        ? el('span', { class: 'chip chip-bronze', title: 'Annual statements you supplied for personal research. Not redistributable.' }, 'Personal')
        : el('span', { class: 'chip chip-ok', title: `Filed with the SEC. From EDGAR companyfacts, CIK ${c.cik}.` }, 'Filed'))
    : el('span', { class: 'chip chip-bronze', title: ILLUS_TITLE }, 'Illustrative');
  const card = el('div', { class: 'card' });
  card.append(cardHead('Latest reported year',
    `FY${fy}${end ? `, ended ${fmtFyEnd(end)}` : ''} · ${c.ccy} billions${c.real && !c.personal && !end ? ' · the period end date is not in this dataset yet' : ''}. Select a figure for its source.`,
    null));
  const g = el('div', { class: 'grid g-4 overview-tiles' });
  [['rev', 'Revenue'], ['ni', 'Net income'], ['ocf', 'Operating cash flow'], ['eq', 'Total equity']].forEach(([k, label]) => {
    const line = lines.find(l => l.key === k);
    /* A bank's operating cash flow is not left out silently: the tile is
       there, and says why it holds no figure. */
    if (!line) {
      g.append(el('div', { class: 'tile-static' }, statTile(label, 'not shown',
        { sub: 'Not a meaningful measure for a deposit-taking balance sheet, so the statements omit it for a bank.' })));
      return;
    }
    const v = line.arr[i], st = lineCellStatus(r, line, i), ch = lineChange(r, line, i);
    const tile = statTile(label, isNum(v) ? fmtNum(v, Math.abs(v) < 10 ? 2 : 1) : st.label,
      { sub: `FY${fy}${isNum(ch.pct) ? ` · ${withSign(ch.pct, 1)} on FY${yrs[i - 1]}` : ''}` });
    if (!isNum(v)) tile.querySelector('.stat-value').classList.add('stat-absent');
    tile.append(el('div', { class: 'row', style: 'gap:6px;margin-top:4px' }, [badge.cloneNode(true),
      isNum(v) ? null : el('span', { class: 'metaline', title: st.text }, st.reason)]));
    g.append(tileButton(tile, `${label}, FY${fy}: ${isNum(v) ? `${fmtNum(v, 2)} ${c.ccy} billion` : `unavailable, ${st.reason}`} — show source`,
      () => openLineDrawer(r, line, i)));
  });
  card.append(g);
  return card;
}

function tabSnapshot(r) {
  const { c, m, val } = r;
  const wrap = el('div', { class: 'research-layout' });
  const main = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md);min-width:0' });

  main.append(overviewTiles(r));

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
      /* Receded with the muted ink rather than with opacity. opacity:.7 on
         --ink-2 measured 3.40:1 in light and 4.45:1 in dark — body text under
         the 4.5 floor on the one row that explains why a pillar is empty.
         --ink-3 recedes as far and measures 5.15:1 and 6.18:1. */
      el('td', { style: isNum(p.score) ? '' : 'color:var(--ink-3)' }, p.label),
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

  /* Assumptions edited in the Valuation tab live in State.valuation and drive
     that tab's run only. This tile, the range below and every score stay on
     the derived defaults, so each company is compared on the same basis — and
     once the reader has edited them, the snapshot says which run it shows
     rather than sitting silently beside a different number one tab away. */
  /* Edits persist across reloads now, so they are read through the Studio's
     own accessor, which applies the stored ones — State.valuation alone is
     empty until the Studio has been opened in this session. */
  const assumptionsEdited = editedKeys(r).length > 0;
  /* Market measures. Every one divides by or compares to a price, and on a
     company with none they were a row of four dashes at the top of the page —
     a dashboard of absences. Without a price the row is one sentence saying
     what would fill it; with one, each tile opens the same source drawer as
     the screener's cell for that measure. */
  const tiles = el('div', { class: 'card' });
  if (!isNum(c.px.p)) {
    tiles.append(cardHead('Market measures', 'Market capitalisation, price multiples, yield and the difference to the model estimate all need a price.'));
    tiles.append(el('p', { class: 'body', style: 'font-size:13px' },
      c.real ? 'No licensed price is connected, so none is shown rather than a row of dashes. Enter a price in the header to compute them, labelled as a figure you supplied.'
        : 'This illustrative company carries no sample price.'));
    main.append(tiles);
  } else {
    const tg = el('div', { class: 'grid g-4' });
    const tileFor = (k, node) => { const f = FIELD_BY_K[k]; return f ? tileButton(node, `${f.label} — show source`, () => openSourceDrawer(r, f)) : node; };
    tg.append(tileFor('mcap', statTile('Market capitalisation', fmtCap(toBase(m.mcap, c.ccy), State.baseCcy), { sub: `${fmtNum(last(r.d.sh), 2)}bn shares` })));
    tg.append(tileFor(c.type === 'bank' ? 'pb' : 'pe', statTile(c.type === 'bank' ? 'Price / book' : 'Price / earnings', c.type === 'bank' ? fmtX(m.pb, 2) : (isNum(m.pe) ? fmtX(m.pe) : 'n/m'),
      { sub: c.type === 'bank' ? `ROE ${fmtPct(m.roe)}` : `EPS ${fmtMoney(m.eps, c.ccy)}` })));
    tg.append(tileFor('dy', statTile(c.type === 'reit' ? 'Distribution yield' : 'Dividend yield', fmtPct(m.dy, 2),
      { sub: isNum(m.cashPayout) ? `${fmtPct(m.cashPayout, 0)} of free cash flow` : (isNum(m.payout) ? `${fmtPct(m.payout, 0)} of earnings` : '—') })));
    /* No price means no gap to measure, and the dash for it was drawn in the
       negative colour, where it read as a shortfall. */
    /* And a gap there is is a difference to a model, not a gain or a loss:
       it takes diffClass, as the bear, base and bull panels below it do. It
       was toned --ok-text and --dn-text, so a price under the estimate was
       printed in the green this product keeps for things that improved. */
    const mosTile = statTile('vs base-case value', val.mos ? withSign(val.mos.base, 1) : '—',
      { sub: `${val.pack.name.split('/')[0].trim()} · ${val.confBand} confidence${assumptionsEdited ? ' · default assumptions' : ''}` });
    if (isNum(val.mos?.base)) mosTile.querySelector('.stat-value').classList.add(diffClass(val.mos.base));
    tg.append(tileFor('mosBase', mosTile));
    tiles.append(tg);
    main.append(tiles);
  }

  /* valuation range */
  const vr = el('div', { class: 'card' });
  vr.append(cardHead('Valuation range', `${val.pack.name}. ${val.pack.why}`,
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openResearch(State.ticker, 'valuation') }, 'Adjust assumptions')));
  if (val.err) vr.append(el('div', { class: 'guardrail', html: `${icon('alert')}<span>${esc(val.err)}</span>` }));
  else {
    /* A bear or bull case its published shift took out of bounds; the base stands. */
    (val.caseNotes || []).forEach(t => vr.append(el('div', { class: 'guardrail', html: `${icon('alert')}<span>${esc(t)}</span>` })));
    if (assumptionsEdited) vr.append(el('p', { class: 'metaline', style: 'margin-bottom:var(--sm);color:var(--bronze)' },
      'Default assumptions. You have edited them on the Valuation tab, which shows the run from your edits; this range and the scores stay on the derived defaults so every company is read on the same basis.'));
    vr.append(rangeStrip(val.vals.bear, val.vals.base, val.vals.bull, c.px.p, c.ccy));
    const g = el('div', { class: 'grid g-3', style: 'margin-top:var(--lg)' });
    [['Bear', val.vals.bear, val.mos?.bear], ['Base', val.vals.base, val.mos?.base], ['Bull', val.vals.bull, val.mos?.bull]].forEach(([label, v, mos]) => {
      const p = el('div', { class: 'panel' });
      p.append(el('div', { class: 'stat-label' }, `${label} case`));
      p.append(el('div', { class: 'num', style: 'font-size:18px;font-weight:700;margin:2px 0' }, fmtMoney(v, c.ccy)));
      p.append(el('div', { class: 'num ' + diffClass(mos), style: 'font-size:12px;font-weight:600' },
        !isNum(v) ? 'not computable' : isNum(mos) ? `${withSign(mos, 1)} vs price` : 'no price to compare'));
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
      priceHistory(c)
        ? `No observed price history has been imported for ${c.tk}. The chart below is a generated illustration consistent with the stated 12-month return, and running a 200-day average over it would produce a confident figure for a series that never existed.`
        : `No observed price history has been imported for ${c.tk}, and none is drawn: a chart generated to fit a stated return would be a series that never existed, and a 200-day average over it a confident figure for nothing.`));
    /* Named as the sidebar names it since Release A, and a link to it: the
       header item "My Investments" this pointed through no longer exists. */
    tc.append(el('p', { class: 'metaline', style: 'margin-top:6px' }, [
      `Add closes for ${c.tk} under `, el('a', { href: href('/my/data'), 'data-path': '/my/data' }, 'Your data & settings'),
      ' to enable this. They stay in this browser.']));
  } else {
    const t = trendContext(real.series, { ohlc: real.ohlc });
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
    /* priceHistory is a seeded walk pinned to the sample price, range and
       12-month return — nothing was reconstructed, so the subtitle says it was
       generated. The distance from the high is computed here from the same
       sample price and high the range line prints: m.from52 is measured on
       observed closes where any were imported, and set beside the sample range
       it read −12.8% for a price 3.4% below the high it sat next to. */
    pc.append(cardHead('Price, last 52 weeks', 'A generated illustration consistent with the sample price, 52-week range and 12-month return. Not observed closes.'));
    const ph = el('div', { style: 'width:100%' });
    pc.append(ph);
    lineChart(ph, { values: hist, labels: hist.map((_, i) => i === hist.length - 1 ? AS_OF : `Week ${i + 1}`), fmt: v => fmtMoney(v, c.ccy, 2), varName: '--s1' });
    const fromHigh = c.px.hi > 0 ? (c.px.p - c.px.hi) / c.px.hi * 100 : null;
    pc.append(el('div', { class: 'row row-wrap', style: 'gap:var(--lg);margin-top:var(--sm)' }, [
      el('span', { class: 'metaline' }, `52-week range ${fmtMoney(c.px.lo, c.ccy)} – ${fmtMoney(c.px.hi, c.ccy)}`),
      el('span', { class: 'metaline' }, `${fmtPct(fromHigh)} from the high`),
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
    /* Capped at the plan's Compare limit, as the Business tab's button is. A
       fixed 8 put six columns on Free under "Choose up to 2 companies". */
    ph2.append(el('button', { class: 'btn btn-quiet btn-sm', style: 'margin-top:6px;padding:0',
      onclick: () => { State.compare = [c.id, ...peers.map(p => p.c.id)].slice(0, LIMITS.compare); store.write('compare', State.compare); go('compare'); } }, 'Open full comparison →'));
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
                        : [isNum(p.m.roic) ? fmtPct(p.m.roic) : absentMark(p, 'roic'), isNum(p.m.om) ? fmtPct(p.m.om) : absentMark(p, 'om'),
                           isNum(p.m.pe) ? fmtX(p.m.pe) : absentMark(p, 'pe'), isNum(p.m.fcfy) ? fmtPct(p.m.fcfy, 2) : absentMark(p, 'fcfy'), scorePill(p.scores.quality.score, p.pct.quality), `<span class="${diffClass(p.val.mos?.base)}">${withSign(p.val.mos?.base, 0)}</span>`];
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
    el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openResearch(State.ticker, 'quality') }, 'Detail')));
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
  chg.append(cardHead('What changed', `FY${yearsOf(c)[yearsOf(c).length - 2]} to FY${latestFy(c)}, as reported.`));
  const ch = changeSummary(c) || [];
  const kv = el('dl', { class: 'kv' });
  ch.forEach(x => { kv.append(el('dt', {}, x.label)); kv.append(el('dd', { class: signClass(x.v), title: x.withheld || null }, changeCell(x))); });
  chg.append(kv);
  rail.append(chg);

  const rk = el('div', { class: 'card' });
  rk.append(cardHead('Open risk flags', null, el('button', { class: 'btn btn-quiet btn-sm', onclick: () => openResearch(State.ticker, 'risks') }, 'All')));
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
  seg.append(cardHead('Revenue mix', c.seg?.length
    ? 'Share of the latest reported year. This split is illustrative — it is authored, not filed.'
    : 'No segment split is carried for a company loaded from filings; the XBRL facts read here are consolidated lines.'));
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
   ['Primary listing', `${listingOf(c)} · ${c.tk}`], ['Sector / industry', `${c.sector} — ${c.industry}`],
   ['Cyclicality', isNum(m.revDD) ? `Revenue drawdown ${fmtPct(m.revDD, 0)} in the window` : '—'],
   ['Capital intensity', isNum(m.reinv) ? `Capex is ${fmtPct(m.reinv, 0)} of operating cash flow` : 'Not meaningful'],
   /* A filer with no latest share count (AbbVie, Berkshire) read "—bn (— a
      year)": two units printed around nothing. The absence then read "not
      reported" whatever its cause, and for 31 filers — Coca-Cola, AbbVie,
      Pfizer — the count is held and withheld, assembled by an ingest rule
      since corrected, which the statement table beside it says. It takes the
      statement table's reason for that cell. */
   ['Shares in issue', !isNum(last(d.sh))
     ? `${lineCellStatus(r, statementLines(r).find(l => l.key === 'sh'), yearsOf(c).length - 1).label} for FY${latestFy(c)}`
     : m.shareSeriesBreak
     ? `${fmtNum(last(d.sh), 3)}bn — annual change withheld, see capital allocation`
     : `${fmtNum(last(d.sh), 3)}bn${isNum(m.dilution) ? ` (${withSign(m.dilution, 2)} a year)` : ''}`],
  ].forEach(([k, v]) => { kv.append(el('dt', {}, k)); kv.append(el('dd', { style: 'text-align:left' }, String(v))); });
  prof.append(kv);
  prof.append(el('p', { class: 'body', style: 'margin-top:var(--md);font-size:13px' }, c.desc));
  wrap.append(prof);

  /* ---------- competitive position ---------- */
  const rivals = U.filter(x => x.c.id !== c.id && x.c.type === c.type &&
    (x.c.sector === c.sector || x.c.mkt === c.mkt)).slice(0, 6);
  const comp = el('div', { class: 'card', style: 'grid-column:1/-1' });
  comp.append(cardHead('Competitive position',
    `Ranked against ${rivals.length} companies sharing this business model. Rank is computed from the universe carried here, so it says where this company sits among these peers — not among every listed competitor.`));
  if (!rivals.length) {
    comp.append(el('p', { class: 'caption' }, 'No comparable peer of the same business model is carried in the universe here.'));
  } else {
    const set = [r, ...rivals];
    const measures = c.type === 'bank'
      ? [['Return on equity', x => x.m.roe, false], ['Cost-to-income', x => x.m.cir, true],
         ['Impaired loans', x => x.m.npl, true], ['CET1 ratio', x => x.m.cet1, false]]
      : c.type === 'reit'
      ? [['Occupancy', x => x.m.occ, false], ['Net property margin', x => x.m.npm, false],
         ['Gearing', x => x.m.gearing, true], ['Distribution yield', x => x.m.dy, false]]
      : [['Operating margin', x => x.m.om, false, 'om'], ['Return on invested capital', x => x.m.roic, false, 'roic'],
         ['Revenue CAGR (4y)', x => x.m.rev5, false, 'rev5'], ['Free cash flow margin', x => x.m.fcfm, false, 'fcfm']];

    const tw2 = el('div', { class: 'tablewrap' });
    const t2 = el('table', { class: 'dt' });
    t2.append(el('thead', {}, el('tr', {}, ['Measure', c.tk, 'Peer median', 'Rank', 'Standing'].map(h => el('th', {}, h)))));
    t2.append(el('tbody', {}, measures.map(([label, get, lowerBetter, key]) => {
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
        el('td', { html: isNum(own) ? f(own) : key ? absentMark(r, key) : NA }),
        el('td', { html: isNum(med) ? f(med) : NA }),
        el('td', {}, rank ? `${rank} of ${vals.length}` : '—'),
        /* In an odd-sized set the median is one of the values, so the company
           that IS the median was always told it was below its peers. */
        el('td', { html: !isNum(own) || !isNum(med) ? '<span class="caption">—</span>'
          : own === med ? sevChip('info', 'At median').outerHTML
          : (better ? sevChip('good', 'Above peers').outerHTML : sevChip('warning', 'Below peers').outerHTML) }),
      ]);
    })));
    tw2.append(t2); comp.append(tw2);
    comp.append(el('div', { class: 'row row-wrap', style: 'gap:5px;margin-top:var(--sm)' },
      [el('span', { class: 'caption' }, 'Peer set:'), ...rivals.map(x =>
        el('button', { class: 'chip', style: 'cursor:pointer', onclick: () => openResearch(x.c.id) }, x.c.tk + illusText(x.c)))]));
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

/* ebitLabel — what the EBIT series holds, by where it came from — lives in
   25-universe.js beside changeSummary, which labels the same row. */

/* ---------------------------------------------------------- the statements
   THE LINES, DEFINED ONCE.
   The table, its CSV and its drawers read this list, so the three cannot
   disagree about which lines exist, which are derived, or what unit each is
   in. Grouped the way a filing is read — income statement, balance sheet,
   cash flow — rather than in tuple order. The tuple holds ten lines a year and
   nothing below them, so a group has no sub-lines to expand into; the four
   derived lines are marked, and none is stored. A bank drops the lines that
   mean nothing on a deposit-taking balance sheet, as it always has. */
const STATEMENT_GROUPS = [
  { id: 'is', label: 'Income statement' },
  { id: 'bs', label: 'Balance sheet' },
  { id: 'cf', label: 'Cash flow' },
];
function statementLines(r) {
  const { c, d } = r;
  const isBank = c.type === 'bank';
  /* Derived cells follow derive()'s own rule: both inputs or nothing. `-v` on
     a missing capex printed "-0.000", and `v - cash` on a missing debt line
     printed a net cash position — the table asserting, in a cell beside the
     word "derived", the two things the engine had just declined to assert. */
  const neg = (arr) => arr.map(v => isNum(v) ? -v : null);
  const diff = (a, b) => a.map((v, i) => isNum(v) && isNum(b[i]) ? v - b[i] : null);
  const L = (group, key, label, arr, o = {}) => ({ group, groupLabel: STATEMENT_GROUPS.find(g => g.id === group).label,
    key, label, arr, derived: false, unit: 'bn', ...o });
  return [
    L('is', 'rev', 'Revenue', d.rev),
    L('is', 'ebit', ebitLabel(c), d.ebit),
    L('is', 'ni', 'Net profit', d.ni),
    L('is', 'eps', 'Earnings per share', d.eps, { derived: true, inputs: ['ni', 'sh'], formula: 'net profit ÷ shares in issue', unit: 'perShare', perShare: true }),
    L('bs', 'eq', 'Shareholders’ equity', d.eq),
    L('bs', 'debt', isBank ? 'Borrowings' : 'Total debt', d.debt),
    ...(isBank ? [] : [
      L('bs', 'cash', 'Cash and equivalents', d.cash),
      L('bs', 'netDebt', 'Net debt', diff(d.debt, d.cash), { derived: true, inputs: ['debt', 'cash'], formula: 'total debt − cash and equivalents' })]),
    L('bs', 'sh', 'Shares in issue (bn)', d.sh, { unit: 'shares', perShare: true }),
    L('bs', 'bvps', 'Book value per share', d.bvps, { derived: true, inputs: ['eq', 'sh'], formula: 'shareholders’ equity ÷ shares in issue', unit: 'perShare', perShare: true }),
    ...(isBank ? [] : [
      L('cf', 'ocf', 'Operating cash flow', d.ocf),
      L('cf', 'capex', 'Capital expenditure', neg(d.capex), { sign: -1 }),
      L('cf', 'fcf', 'Free cash flow', d.fcf, { derived: true, inputs: ['ocf', 'capex'], formula: 'operating cash flow − capital expenditure' })]),
    L('cf', 'dps', c.type === 'reit' ? 'Distribution per unit' : 'Dividend per share', d.dps, { unit: 'perShare', perShare: true }),
  ];
}

/* One year's change on one line, by changeSummary's rule: a percentage over
   the absolute base, none on a zero base, and none on a per-share line in a
   year the share count moved by a corporate action — that change is the
   split, not the company. Absolute change is withheld on the same per-share
   lines for the same reason. */
function lineChange(r, line, i) {
  const a = line.arr[i - 1], b = line.arr[i], sh = r.d.sh;
  if (i < 1) return { abs: null, pct: null, why: 'first year held — nothing to compare with' };
  if (!isNum(a) || !isNum(b)) return { abs: null, pct: null, why: `needs FY${yearsOf(r.c)[i - 1]} and FY${yearsOf(r.c)[i]}; ${!isNum(b) ? 'this year' : 'the prior year'} is not held` };
  const ratio = isNum(sh[i - 1]) && isNum(sh[i]) && sh[i - 1] > 0 ? sh[i] / sh[i - 1] : null;
  if (line.perShare && r.m.shareSeriesBreak && isNum(ratio) && (ratio > 1.5 || ratio < 0.67))
    return { abs: null, pct: null, withheld: true, why: 'The share count moves by a corporate action between these two years, so a change in a per-share line measures the split. Withheld.' };
  return { abs: b - a, pct: a !== 0 ? (b - a) / Math.abs(a) * 100 : null, why: a === 0 ? 'the prior year is zero, so a percentage has no meaning' : null };
}

/* THE CSV. Long rather than wide: one row per line per year, because every
   cell carries its own concept, status and — once the data holds them —
   period end, filing date and form, and a wide file would need four parallel
   tables to say that. Values are the stored numbers at full precision, not the
   rounded figures on screen, so the file reproduces the table rather than a
   picture of it. Pure: it returns the text, and the button does the saving. */
const csvCell = (x) => (x == null ? '' : /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : String(x));
function statementsCsv(r) {
  const { c } = r;
  const yrs = yearsOf(c);
  const cols = ['ticker', 'company', 'statement', 'line', 'line_key', 'kind', 'fiscal_year', 'period_end', 'value', 'unit',
    'original_unit', 'currency', 'xbrl_concept', 'filed', 'form', 'status', 'note', 'source'];
  const out = [cols.join(',')];
  const src = sourceSentence(c);
  let anyEnd = false, anyFiled = false;
  statementLines(r).forEach(line => yrs.forEach((fy, i) => {
    const v = line.arr[i];
    const st = lineCellStatus(r, line, i);
    const f = line.derived ? { end: fyEndOf(c, fy) } : lineFiling(c, line.key, fy);
    anyEnd = anyEnd || !!f.end; anyFiled = anyFiled || !!f.filed;
    out.push([c.tk, c.name, line.groupLabel, line.label, line.key, line.derived ? 'derived' : 'reported', fy, f.end || '',
      isNum(v) ? String(v) : '', lineUnit(line, c),
      line.derived ? 'derived — see inputs' : lineOriginalUnit(c, line.key), c.ccy,
      line.derived ? `derived: ${line.formula}` : (lineConcept(c, line.key, fy) || ''),
      f.filed || '', f.form || '',
      st.available ? st.label.toLowerCase() : `unavailable: ${st.reason}`,
      st.available ? (line.sign === -1 ? 'outflow shown negative; filed as a positive payment' : '') : st.text,
      src].map(csvCell).join(','));
  }));
  out.push('');
  out.push(`# Quantum Tradeworks statements export · ${c.name} (${c.tk}) · ${MODEL_VERSION}`);
  out.push(`# ${src}. ${dataDateLabel(c)}.`);
  out.push(`# Units: ${c.ccy} billions; shares in billions; per-share lines in ${c.ccy} per share. Values are stored figures at full precision.`);
  if (c.real && !c.personal && !anyEnd) out.push('# period_end: not in this dataset yet — the statements were retrieved before the ingest recorded it.');
  if (c.real && !c.personal && !anyFiled) out.push('# filed, form: not in this dataset yet — the statements were retrieved before the ingest recorded them.');
  if (!c.real) out.push('# Illustrative: every figure here is synthetic, created for interface demonstration. Not filed and not real.');
  out.push('# Research only. Not for investment use.');
  return out.join('\n');
}
/* Saving it. Two rules decide first: the Free plan carries no exports, as for
   the screener, and statements from the personal lane are not
   redistributable, so they are not written into a file this product hands
   out — the reader already holds the file they came from. */
function exportStatements(r) {
  const { c } = r;
  if (c.personal) { toast('Not exported: these statements are personal research and not redistributable. The file you loaded them from is already yours.'); return; }
  if (!lim('exports')) { toast('Exports are part of Equities Research'); go('plans'); return; }
  const blob = new Blob([statementsCsv(r)], { type: 'text/csv' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `${slug(c.tk)}-statements.csv` });
  document.body.append(a); a.click(); a.remove();
  toast(`Exported ${statementLines(r).length} lines × ${yearsOf(c).length} years for ${c.tk}`);
}

/* The statements card: grouped rows, a year-on-year change on request, every
   cell a way into its source, and the row labels pinned while the years
   scroll. */
function statementTable(r) {
  const { c, m } = r;
  const yrs = yearsOf(c);
  const lines = statementLines(r);
  const showChg = !!State.finChanges;
  const stmt = el('div', { class: 'card', style: 'padding:0;overflow:hidden' });
  const sh = el('div', { class: 'stmt-hd' });
  const titles = el('div', { style: 'min-width:0;flex:1 1 420px' });
  titles.append(el('h3', { class: 'h-card' }, 'Financial statements'));
  titles.append(el('p', { class: 'caption', style: 'margin-top:2px;max-width:66ch' },
    `${c.ccy} billions unless stated, FY${yrs[0]}–FY${last(yrs)}. Derived lines are marked and computed from the reported lines — not stored separately. Select any figure for its source.`));
  sh.append(titles);
  const tools = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:center' });
  tools.append(el('button', { class: 'btn btn-ghost btn-sm', 'aria-pressed': showChg ? 'true' : 'false',
    onclick: () => { State.finChanges = !showChg; render(); } }, showChg ? 'Hide changes' : 'Show changes'));
  const csvBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => exportStatements(r),
    'aria-describedby': 'stmt-csv-note' }, 'Download CSV');
  if (c.personal) csvBtn.disabled = true;
  tools.append(csvBtn);
  sh.append(tools);
  stmt.append(sh);
  /* The export rule, stated where the button is rather than discovered by
     pressing it. */
  stmt.append(el('p', { class: 'metaline stmt-note', id: 'stmt-csv-note' },
    c.personal ? 'CSV is not offered here: these statements are personal research and not redistributable.'
    : !lim('exports') ? 'CSV export is part of Equities Research; on the Free plan the button explains and does not download.'
    : c.real ? 'CSV: every line and year at full precision, with unit, currency, source and the XBRL concept for each cell.'
    : 'CSV: every line and year at full precision, with unit, currency and source — every figure labelled illustrative.'));

  const tw = el('div', { class: 'tablewrap stmt-wrap', style: 'border:0;border-radius:0' });
  const t = el('table', { class: 'dt stmt-table' + (showChg ? ' with-chg' : '') });
  const hr = el('tr', {}, [el('th', { class: 'pin', scope: 'col' }, 'Line')]);
  yrs.forEach((y, i) => {
    hr.append(el('th', { scope: 'col' }, `FY${y}`));
    if (showChg && i > 0) {
      hr.append(el('th', { class: 'chg', scope: 'col', title: `Change from FY${yrs[i - 1]} to FY${y}, in the line’s unit` }, 'Δ'));
      hr.append(el('th', { class: 'chg', scope: 'col', title: `Percentage change from FY${yrs[i - 1]} to FY${y}` }, 'Δ%'));
    }
  });
  hr.append(el('th', { scope: 'col' }, `${yrs.length - 1}y CAGR`));
  t.append(el('thead', {}, hr));
  const ncol = 1 + yrs.length + (showChg ? 2 * (yrs.length - 1) : 0) + 1;
  const tb = el('tbody');
  const split = m.shareSeriesBreak;
  STATEMENT_GROUPS.forEach(g => {
    const gl = lines.filter(l => l.group === g.id);
    if (!gl.length) return;
    tb.append(el('tr', { class: 'grp' }, [
      el('th', { class: 'pin', scope: 'colgroup' }, g.label),
      el('td', { colspan: ncol - 1 }),
    ]));
    gl.forEach(line => {
      const tr = el('tr');
      tr.append(el('td', { class: 'pin ident', html: esc(line.label) + (line.derived ? ' <span class="chip chip-derived">derived</span>' : '') }));
      line.arr.forEach((v, i) => {
        const st = lineCellStatus(r, line, i);
        const td = el('td', { class: 'cell-sourced', tabindex: '0', role: 'button',
          html: isNum(v) ? lineFmt(v, line) : `<span class="caption cell-absent" title="${esc(st.text)}">${esc(st.label)}</span>`,
          'aria-label': `${line.label}, FY${yrs[i]}: ${isNum(v) ? `${lineFmt(v, line)} ${lineUnit(line, c)}` : `unavailable, ${st.reason}`} — show source` });
        td.addEventListener('click', () => openLineDrawer(r, line, i));
        td.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLineDrawer(r, line, i); } });
        tr.append(td);
        if (showChg && i > 0) {
          const ch = lineChange(r, line, i);
          tr.append(el('td', { class: 'chg ' + signClass(ch.abs), html: isNum(ch.abs) ? withSign(ch.abs, Math.abs(ch.abs) < 10 ? 2 : 1, '')
            : `<span class="caption" title="${esc(ch.why)}">${ch.withheld ? 'withheld' : '–'}</span>` }));
          tr.append(el('td', { class: 'chg ' + signClass(ch.pct), html: isNum(ch.pct) ? withSign(ch.pct, 1)
            : `<span class="caption" title="${esc(ch.why || 'the prior year is zero, so a percentage has no meaning')}">${ch.withheld ? 'withheld' : isNum(ch.abs) ? 'n/m' : '–'}</span>` }));
        }
      });
      /* A per-share series that crosses a split has no growth rate — the same
         withholding the corporate-actions card applies to the share count.
         Withheld only where a rate would otherwise exist: a dividend line that
         is empty throughout has nothing to withhold and reads n/m as before. */
      const g0 = cagr(line.arr);
      const withheld = line.perShare && split && isNum(g0);
      const gr = withheld ? null : g0;
      tr.append(el('td', { class: signClass(gr), html: isNum(gr) ? withSign(gr, 1)
        : withheld ? '<span class="caption" title="The share count jumps inside this window — a split, merger or offering — so a growth rate over any per-share line would measure that event. Withheld.">withheld</span>'
        : '<span class="caption" title="No growth rate: the base year is zero, negative or not held.">n/m</span>' }));
      tb.append(tr);
    });
  });
  t.append(tb); tw.append(t); stmt.append(tw);
  /* The latest years are the ones read first. Where the table is wider than
     its card — every phone, and any desktop with changes shown — it opens
     scrolled to them, and the edge shadow on the left says earlier years are
     there. */
  /* Not when the reader is in it: a redraw of the page (an OS switch to
     dark) gives focus back to the figure in use and scrolls the table back to
     where it was (render(), 35-ui.js), and this, a frame later, swung it to
     the latest years and left that figure out of sight behind the pinned
     line names. */
  requestAnimationFrame(() => { if (tw.scrollWidth > tw.clientWidth + 4 && !tw.contains(document.activeElement)) tw.scrollLeft = tw.scrollWidth; });
  stmt.append(el('div', { style: 'padding:var(--sm) var(--lg)' }, [
    el('p', { class: 'metaline stmt-swipe' }, 'The line names stay pinned; swipe the table sideways for the other years.'),
    el('p', { class: 'metaline' }, 'CAGR is null where the base period is non-positive — shown as n/m rather than as a computed number that would not mean anything.'
      + (split ? ` Per-share growth is withheld: the share count moves from ${fmtNum(split.from, 2)}bn to ${fmtNum(split.to, 2)}bn inside this window — a split, merger or offering, which the filings are not restated for and no source here identifies.` : '')
      + (yrs.length < 5 ? ` Only ${yrs.length} years are held for this company.` : '')),
  ]));
  return stmt;
}

function tabFinancials(r) {
  const { c, d, m } = r;
  const isBank = c.type === 'bank';
  const yrs = yearsOf(c);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });

  const chartCard = el('div', { class: 'card' });
  /* "FY2026" means the year Microsoft calls fiscal 2026, which ended in June.
     Where the ingest recorded the date, the caption says so, because a reader
     who assumes December is a full half-year wrong about when these figures
     stop. */
  const fyEnd = fmtFyEnd(fyEndOf(c, last(yrs)));
  chartCard.append(cardHead(`${isBank ? 'Total income' : 'Revenue'}, ${ebitLabel(c).toLowerCase()}${isBank ? '' : ' and free cash flow'}`,
    `Reported ${c.ccy} billions, FY${yrs[0]}–FY${last(yrs)}${fyEnd ? ` — the latest fiscal year ended ${fyEnd}` : ''}.` + (isBank ? ' Free cash flow is not shown for a bank — it is not a meaningful measure for a deposit-taking balance sheet.' : ''),
    el('div', { class: 'segmented' }, [['abs', 'Reported'], ['idx', 'Indexed to 100']].map(([v, l]) =>
      el('button', { 'aria-selected': State.finMode === v ? 'true' : 'false', onclick: () => { State.finMode = v; render(); } }, l)))));
  const host = el('div', { style: 'width:100%' });
  chartCard.append(host);

  /* Indexed to the first reported year, and only where that year is above
     zero. Divided by a negative base the index turned sign: Chevron's
     operating profit opens its window at −2.16bn, so its 49.67bn year was
     drawn at −2,300 — the best year as the worst — and every profit after a
     loss read as a fall. As with a growth rate off a non-positive base, the
     series is left undrawn and the legend says why. */
  const indexed = State.finMode === 'idx';
  const idxOk = (arr) => arr.find(isNum) > 0;
  const idx = (arr) => { const b = arr.find(isNum); return arr.map(v => isNum(v) && b > 0 ? v / b * 100 : null); };
  const finSeries = (key, label, raw, varName) => ({ key, label, raw, values: indexed ? idx(raw) : raw, varName,
    unindexed: indexed && raw.some(isNum) && !idxOk(raw) });
  const series = [
    finSeries('rev', isBank ? 'Total income' : 'Revenue', d.rev, '--s1'),
    finSeries('ebit', ebitLabel(c), d.ebit, '--s2'),
  ];
  if (!isBank) series.push(finSeries('fcf', 'Free cash flow', d.fcf, '--s3'));

  const leg = el('div', { class: 'legend', style: 'margin-top:var(--sm)' });
  series.forEach(s => leg.append(el('span', { class: 'legend-item', html: `<span class="legend-key" style="background:var(${s.varName})"></span>${esc(s.label)}${s.unindexed ? ' — not indexed: its first reported year is at or below zero' : ''}` })));
  chartCard.append(leg);
  chartCard.append(tableTwin('Show the table view',
    ['Line', ...yrs.map(y => `FY${y}`)],
    series.map(s => [s.label, ...s.values.map((v, i) => isNum(v) ? fmtNum(v, 2) : isNum(s.raw[i]) ? 'n/m' : 'not reported')])));
  wrap.append(chartCard);
  columnChart(host, { cats: yrs.map(y => `FY${y}`), series, fmt: v => State.finMode === 'idx' ? fmtNum(v, 0) : fmtNum(v, Math.abs(v) < 10 ? 1 : 0), title: 'Reported financials' });

  wrap.append(statementTable(r));

  /* Quarters, for the illustrative set only. They are annual figures split by
     a seeded seasonal shape — one more piece of the same fiction, labelled as
     such. Drawing them under audited annual statements put an invented
     quarterly profile on a filed company; the ingest reads annual facts and
     nothing else, and the page now says so instead. */
  if (c.real) {
    wrap.append(el('div', { class: 'card' },
      [cardHead('Quarterly figures', 'Not carried in this build.'),
       el('p', { class: 'body', style: 'font-size:13px' }, c.cik
         ? 'The ingest reads annual XBRL facts — periods of a year — and no quarterly line is held for any filed company. Quarterly statements are in the 10-Q filings on EDGAR, linked from the Filings tab.'
         : 'Only annual statements were loaded for this company, so there is no quarterly line to draw and none is invented.')]));
    return wrap;
  }
  const q = quarters(c, d);
  const qc = el('div', { class: 'card' });
  qc.append(cardHead('Quarterly shape (derived, illustrative)',
    'These quarters are apportioned from the two most recent years using a fixed company-specific seasonal profile. They are labelled derived because they are not separately reported anywhere — this company’s figures are illustrative and so are these.'));
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
  chips.append(el('span', { class: 'chip' }, `Calculated at page load · ${dataDateLabel(r.c)}`));
  chips.append(el('span', { class: 'chip' }, `Source periods FY${yearsOf(r.c)[0]}–FY${latestFy(r.c)}`));
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
      /* A per-share growth input withheld for a split says so, rather than
         reading as "not meaningful" — on the break inside its own five rows
         (perShareBreak), which is what withheld it. On the whole-series
         break, GE's earnings growth, absent for a negative FY2021 base, read
         "withheld" over a split years outside the window.
         Every other absent input read "n/a", the mark for a measure that
         does not apply: Apple's net buyback yield, withheld for its
         share-count break; Adobe's payout ratio, its dividend line not
         reported; Coca-Cola's, withheld with its share count. A measure the
         screener lists is marked as the screener marks it (absentMark);
         book-value growth and the sector inputs, which it does not list,
         keep the rule above. */
      const absentRaw = FIELD_BY_K[part.k] ? absentMark(r, part.k)
        : (r.m.perShareBreak && ['eps5', 'bv5', 'dps5'].includes(part.k) ? NA_SPLIT : NA);
      tr.append(el('td', { html: isNum(part.raw) ? part.fmt(part.raw) : absentRaw }));
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
    /* growthYears counts the REPORTED revenue points in the last five years
       held, not the statements held. BlackRock carries ten annual statements
       with revenue missing from six of them, and this sentence told the reader
       only four statements were held. The count is stated as what it is. */
    if (k === 'growth' && isNum(r.m.growthYears) && r.m.growthYears < 4) {
      const held = Math.min(5, (r.d.rev || []).length);
      const pts = r.m.growthYears + 1;
      const why = pts < held
        ? `revenue is reported for only ${pts} of the last ${held} years held`
        : `only ${held} annual statement${held === 1 ? ' is' : 's are'} held for this company`;
      card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
        `Computed over ${r.m.growthYears} year${r.m.growthYears === 1 ? '' : 's'}, not four — ${why}. The labels above read "(4y)" because that is the field definition; the window is what is stated here, and a shorter window makes a growth rate more sensitive to its endpoints.`));
    }
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
    el('div', { class: 'metaline' }, isNum(r.mom.cohortMedian) ? `cohort median ${withSign(r.mom.cohortMedian, 1)} over 12m` : 'no priced cohort to compare against'),
  ]));
  mc.append(mh);
  const mtw = el('div', { class: 'tablewrap' });
  const mt = el('table', { class: 'dt' });
  mt.append(el('thead', {}, el('tr', {}, ['Input', 'Raw value', 'Anchor range', 'Input score', 'Weight', 'Contribution'].map(h => el('th', {}, h)))));
  mt.append(el('tbody', {}, r.mom.parts.map(part => el('tr', {}, [
    el('td', { class: 'ident' }, part.label),
    el('td', { html: isNum(part.raw) ? part.fmt(part.raw) : (r.m.perShareBreak && ['eps5', 'bv5', 'dps5'].includes(part.k) ? NA_SPLIT : NA) }),
    el('td', { html: `<span class="caption">${part.fmt(part.lo)} → ${part.fmt(part.hi)}</span>` }),
    el('td', { html: isNum(part.score) ? Math.round(part.score) : NA }),
    el('td', {}, `${Math.round(part.w * 100)}%`),
    el('td', { html: isNum(part.score) ? `<b style="color:var(--ink)">${Math.round(part.score * part.w)}</b>` : NA }),
  ]))));
  mtw.append(mt); mc.append(mtw);
  /* momentumOf divides by the weight of the inputs it could compute, as the
     pillars do, so the listed contributions sum to less than the headline
     whenever one is missing (AbbVie: 30 + 12 against 85). The pillars say so;
     this card did not. */
  if (isNum(r.mom.score) && r.mom.coverage < 100) mc.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
    `Weights are re-based across the inputs that could be computed — ${r.mom.coverage}% of the weight here — so the contributions above sum to ${r.mom.coverage}% of the score shown, not all of it.`));
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
   /* A company with no moat assessment has no review date and no review
      status; printing one for it described a review that did not happen. */
   ['Evidence date', c.moat?.kind === 'Not assessed' ? 'Not assessed — no review has been made' : `FY${latestFy(c)} reported · reviewed ${AS_OF}`],
   ['Review status', c.moat?.kind === 'Not assessed' ? 'Not assessed' : 'Analyst-reviewed template']]
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
  /* Each row carries the metric its percentile is taken from. The column
     used to read the percentile by ROW POSITION from a fixed list of the
     general metrics, so a bank's cost-to-income row showed the percentile of
     operating margin and a REIT's occupancy row the percentile of ROIC. */
  /* Named for what it holds. The fourth general row read "Margin stability"
     over m.revVol, which is the standard deviation of year-on-year REVENUE
     growth — the quality pillar scores the same figure as "Revenue growth
     stability" — so the moat page described a margin measure nobody
     computed. And an absent lease expiry printed "— yrs": a unit on nothing. */
  const rows = c.type === 'bank'
    ? [['Net interest margin', fmtPct(m.nim, 2), 'Pricing power on the funding base', 'nim', false],
       ['Cost-to-income ratio', fmtPct(m.cir), 'Operating efficiency versus peers', 'cir', true],
       ['Gross impaired loans', fmtPct(m.npl, 2), 'Underwriting quality', 'npl', true],
       ['CET1 ratio', fmtPct(m.cet1), 'Capacity to lend through a downturn', 'cet1', false]]
    : c.type === 'reit'
    ? [['Occupancy', fmtPct(m.occ), 'Genuine tenant demand', 'occ', false],
       ['Weighted lease expiry', isNum(m.wale) ? `${fmtNum(m.wale)} yrs` : '—', 'Contracted income duration', 'wale', false],
       ['Net property margin', fmtPct(m.npm), 'Operating leverage on the assets', 'npm', false],
       ['Gearing', fmtPct(m.gearing), 'Refinancing exposure', 'gearing', true]]
    : [['Return on invested capital', isNum(m.roic) ? fmtPct(m.roic) : el('span', { html: absentMark(r, 'roic') }), 'Excess return over the cost of capital', 'roic', false],
       ['Operating margin', fmtPct(m.om), 'Pricing power net of cost', 'om', false],
       ['Revenue growth stability', isNum(m.revVol) ? `${fmtNum(m.revVol)} s.d.` : '—', 'Whether the advantage holds through the cycle', 'revVol', true],
       ['Free cash flow margin', isNum(m.fcfm) ? fmtPct(m.fcfm) : el('span', { html: absentMark(r, 'fcfm') }), 'Conversion of the advantage into cash', 'fcfm', false]];
  const tw = el('div', { class: 'tablewrap' });
  const t = el('table', { class: 'dt' });
  t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Measure'), el('th', {}, 'Latest'), el('th', {}, 'Peer pct'), el('th', {}, 'Why it matters')])));
  t.append(el('tbody', {}, rows.map(([label, v, why, key, inv]) => el('tr', {}, [
    el('td', { class: 'ident' }, label), el('td', {}, v),
    el('td', {}, String(metricPct(r, key, 'sector', inv) ?? '—')),
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
  own.append(cardHead('Ownership', c.real
    ? 'Not held for a company loaded from filings — ownership is not among the XBRL facts read here.'
    : 'Substantial holders as recorded in the illustrative set.'));
  const kv = el('dl', { class: 'kv', style: 'margin-bottom:var(--md)' });
  /* `100 - null - null` is 100: a free float of exactly 100.0% was stated for
     every filed company from two inputs shown as dashes on the same rows. */
  [['Directors and insiders', fmtPct(c.own.insider, 2)], ['Institutional', fmtPct(c.own.inst, 1)],
   ['Free float (implied)', isNum(c.own.inst) && isNum(c.own.insider) ? fmtPct(100 - c.own.inst - c.own.insider, 1) : '—']]
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
    yearsOf(c).map((y, i) => [`FY${y}`, fmtNum(d.sh[i], 3), i && isNum(d.sh[i]) && isNum(d.sh[i - 1]) && d.sh[i - 1] ? withSign((d.sh[i] - d.sh[i - 1]) / d.sh[i - 1] * 100, 2) : '—'])));
  const kv2 = el('dl', { class: 'kv', style: 'margin-top:var(--md)' });
  /* An absent figure here says why by the rule the screener uses. Each read
     "n/m" or "n/a" whatever the cause, or a bare dash: Alphabet's and
     Amazon's dividend growth "n/m" — "every input is present" — with the
     dividend line not reported for years the rate reads; Coca-Cola's payout
     ratio "n/m" and its share-count rate a dash, both withheld for a share
     count the shipped file misassembled; Adobe's dividend cover "n/a", the
     mark for a measure that does not apply, beside a dividend line that is
     not reported. The share-count break keeps "see below", where the note
     names the step. */
  const figOr = (k, v, breakNote) => isNum(m[k]) ? v : breakNote ? 'Withheld — see below' : el('span', { html: absentMark(r, k) });
  [['Share count CAGR', figOr('dilution', withSign(m.dilution, 2), m.shareSeriesBreak)],
   ['Net buyback yield', figOr('buyback', withSign(m.buyback, 2), m.shareSeriesBreak)],
   /* Withheld on a break inside the five years it reads, not anywhere in
      the series: Alphabet's, absent because no dividend was paid in FY2021,
      read "Withheld" over a split years before its window. */
   [c.type === 'reit' ? 'Distribution per unit CAGR' : 'Dividend per share CAGR', figOr('dps5', withSign(m.dps5, 1), m.perShareBreak)],
   ['Payout ratio', figOr('payout', fmtPct(m.payout, 0))],
   ['Dividends as % of free cash flow', figOr('cashPayout', fmtPct(m.cashPayout, 0))]]
   .forEach(([k, v]) => { kv2.append(el('dt', {}, k)); kv2.append(el('dd', {}, v)); });
  act.append(kv2);
  /* Share counts arrive from the filings as reported, unadjusted for splits, and
     no corporate-action feed is licensed here to undo one. To a growth rate a
     split is indistinguishable from issuance, which is how this page came to
     report Apple's four-for-one as "share count rising 12.0% a year, which
     dilutes per-share growth" — the reverse of the truth for a company that has
     bought back stock for a decade. Rather than print a number that is wrong in
     its sign, the measure is withheld and the discontinuity is named.

     Named, not diagnosed. This note used to say no issuance could move a count
     that far in a year, and called every break a split — Realty Income's 1.64×
     is the all-stock VEREIT merger and Rivian's 9× is its IPO and conversion,
     both issuance. Nothing here can tell a split from a merger or an offering,
     so the note says the jump is too large to read as a rate and leaves the
     cause open. */
  if (m.shareSeriesBreak) {
    const b = m.shareSeriesBreak;
    act.append(el('div', { class: 'note', style: 'margin-top:var(--md);border-left:3px solid var(--warn)' },
      el('p', { class: 'body', style: 'font-size:13px' },
        `Share count CAGR and net buyback yield are withheld for this company. The series moves from `
        + `${fmtNum(b.from, 3)}bn to ${fmtNum(b.to, 3)}bn between two consecutive years — a factor of ${b.ratio}× — `
        + `a discontinuity too large to read as a growth rate. It may be a split, a merger or an offering: the filings `
        + `are reported unadjusted for splits, and no corporate-action source is licensed here to tell which, so a `
        + `growth rate over this series would measure that one event rather than the company's issuance and buybacks. `
        + `The year-by-year counts above are as filed and remain correct on their own terms.`
        /* The dividend row above says "see below" when a step falls inside
           the five years its rate reads; this is where that is said, and
           which step it is — for Nvidia not the one named first. */
        + (m.perShareBreak
          ? ` The ${c.type === 'reit' ? 'distribution per unit' : 'dividend per share'} CAGR is withheld for the same reason: the count moves from `
            + `${fmtNum(m.perShareBreak.from, 3)}bn to ${fmtNum(m.perShareBreak.to, 3)}bn inside the five years that rate reads.`
          : ''))));
  }
  wrap.append(act);
  columnChart(host, { cats: yearsOf(c).map(y => `FY${y}`), series: [{ key:'sh', label:'Shares in issue', values:d.sh, varName:'--s1' }], fmt: v => fmtNum(v, 2) });
  return wrap;
}

/* ------------------------------------------------------------------ filings */
function tabFilings(r) {
  const { c } = r;
  const docs = documents(c);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  const yrs = yearsOf(c), li = yrs.length - 1;

  /* The change table is computed from the statements and is real for every
     company; only the documents it used to hang off were invented. */
  const changedTable = (changed) => {
    const tw = el('div', { class: 'tablewrap' });
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, [el('th', {}, 'Measure'), el('th', {}, `FY${yrs[li - 1]}`), el('th', {}, `FY${yrs[li]}`), el('th', {}, 'Change')])));
    /* By the row's key, not its words: keyed on the label, a row renamed to
       the statement's own name (a bank's pre-tax line) would have found no
       series and printed both years as absent. */
    t.append(el('tbody', {}, changed.map(x => { const s = r.d[x.key] || []; return el('tr', {}, [
      el('td', { class: 'ident' }, x.label),
      el('td', { html: isNum(s[li - 1]) ? fmtNum(s[li - 1], 2) : NA }),
      el('td', { html: isNum(s[li]) ? fmtNum(s[li], 2) : NA }),
      el('td', { class: signClass(x.v), title: x.withheld || null }, changeCell(x)),
    ]); })));
    tw.append(t);
    return tw;
  };

  /* Statements loaded for personal research — a Bursa company read from the
     reader's own file, real but with no CIK and no EDGAR behind it. Keyed on
     `real` alone this branch printed "SEC filings", "CIK undefined" and three
     links to EDGAR for a Malaysian company. */
  if (c.real && !c.cik) {
    const hd = el('div', { class: 'card' });
    hd.append(cardHead('Statements loaded for personal research',
      'These annual statements were loaded from your own research file. No filing index is held for them and nothing here was retrieved from an exchange — Bursa Malaysia’s announcements are on its own site.'));
    hd.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
      el('span', { class: 'chip chip-brand' }, 'Personal research'),
      c.retrieved ? el('span', { class: 'chip' }, `loaded ${c.retrieved}`) : null,
    ]));
    wrap.append(hd);
    const ch = changeSummary(c) || [];
    if (ch.length) {
      const card = el('div', { class: 'card' });
      card.append(cardHead(`What changed, FY${yrs[li - 1]} to FY${yrs[li]}`, 'From the statement lines you loaded.'));
      card.append(changedTable(ch));
      wrap.append(card);
    }
    return wrap;
  }
  if (c.real) {
    /* A filed company: the real index, and nothing standing in for it. The
       links come from edgarLinks, the builder every source drawer uses. */
    const hd = el('div', { class: 'card' });
    hd.append(cardHead('SEC filings',
      'This build holds no filing index. The statements on this page are XBRL facts from EDGAR’s companyfacts record — the numbers, not the documents — and the documents themselves are one link away on SEC.gov. Nothing here stands in for them.'));
    hd.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
      el('span', { class: 'chip chip-brand' }, 'SEC-filed statements'),
      el('span', { class: 'chip' }, `CIK ${c.cik}`),
      el('span', { class: 'chip' }, `retrieved ${c.retrieved}`),
    ]));
    const links = edgarLinkRow(c);
    if (links) { links.style.marginTop = 'var(--sm)'; hd.append(links); }
    wrap.append(hd);

    const ch = changeSummary(c) || [];
    if (ch.length) {
      const card = el('div', { class: 'card' });
      card.append(cardHead(`What changed, FY${yrs[li - 1]} to FY${yrs[li]}`, 'As reported, from the statement lines held for this company.'));
      card.append(changedTable(ch));
      const drivers = driverImpact(c, r.d, r.inputs).slice(0, 3);
      if (drivers.length) {
        card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Potential thesis impacts'));
        const imp = el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
        drivers.forEach(dr => imp.append(el('div', { class: 'evidence', style: 'font-size:13px' },
          `${dr.label} is the ${drivers.indexOf(dr) === 0 ? 'largest' : 'next largest'} driver of the valuation range — a ${dr.unit === 'pp' ? fmtNum(dr.step, 2) + ' point' : dr.unit} change moves the base-case model estimate about ${fmtNum(dr.span, 1)}%.`)));
        card.append(imp);
        card.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
          'Uncertainty label: these are arithmetic consequences of the reported change, not a claim about what management will do next.'));
      }
      wrap.append(card);
    }
    return wrap;
  }

  const hd = el('div', { class: 'card' });
  hd.append(cardHead(c.mkt === 'US' ? 'SEC filings' : 'Bursa announcements and company reports',
    c.mkt === 'US'
      ? 'In production these would be retrieved from EDGAR with the filing index and the extracted facts linked to each claim.'
      : 'In production these would come from a licensed Bursa feed. Announcement content and redistribution rights are a commercial prerequisite, not a scraping exercise.'));
  /* A chip does not wrap, and the whole sentence in one ran 61px past a 390px
     screen. The chip carries the label; the sentence sits beside it as text,
     which wraps. */
  hd.append(el('div', { class: 'row row-wrap', style: 'gap:6px' }, [
    sevChip('info', 'Illustrative sample'),
    el('span', { class: 'chip' }, `${docs.length} documents`),
    el('span', { class: 'metaline' }, 'A sample document list, not retrieved from any exchange.'),
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
      card.append(changedTable(doc.changed));

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
    /* This went to the alerts page and toasted "Alert rule builder opened",
       with no builder open and nothing about the company carried. The only
       rule editor that exists is the price alert, so the button opens it here,
       on this company, and says that is what it is. */
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { State.ticker = c.id; openPriceAlertEditor(); } }, 'Create a price alert'));
    card.append(acts);
    wrap.append(card);
  });
  return wrap;
}

