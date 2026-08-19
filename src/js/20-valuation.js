/* ==========================================================================
   VALUATION STUDIO — model router
   Unlike businesses are routed to different model packs. Each pack publishes
   its selection reason, its assumptions, and its limitations.
   ========================================================================== */

const MODEL_PACKS = {
  dcf: {
    id:'dcf', name:'FCFF discounted cash flow',
    why:'Mature, profitable non-financial business with positive and reasonably predictable free cash flow.',
    secondary:['EV / EBIT', 'Free cash flow yield', 'Historical multiple range'],
    limits:['Terminal value typically carries more than half of the total — small changes in the terminal assumption move the answer a long way.','Assumes the capital structure and reinvestment rate stay broadly stable.','Enterprise value is not adjusted for leases, minority interests, associates or non-controlling interests — those lines are not carried in this dataset.'] },
  dcfMid: {
    id:'dcfMid', name:'Mid-cycle normalised FCFF',
    why:'Cyclical or commodity-linked business. Free cash flow is normalised to the five-year average so the model is not anchored to a peak or a trough year.',
    secondary:['Cycle-adjusted EV / EBIT', 'Replacement asset value', 'Price / book through the cycle'],
    limits:['A five-year window may not span a full cycle for this industry.','Normalisation deliberately ignores the current spot price environment.'] },
  scenario: {
    id:'scenario', name:'Scenario revenue → margin → FCF',
    why:'High-growth business where current cash flow is small relative to the opportunity. Revenue, operating margin and cash conversion are modelled separately so the margin the business settles at is an explicit assumption rather than something buried inside one cash-flow growth rate.',
    secondary:['EV / revenue against growth and margin peers', 'Base-case EV against terminal-year operating profit', 'Rule-of-40 style checks'],
    limits:['Value is dominated by the terminal margin assumption, which has no observed history at the modelled scale.','Competitive response is not modelled — the revenue path is independent of what rivals do.','Share issuance is modelled as a constant annual rate, not as discrete raises.'] },
  ri: {
    id:'ri', name:'Residual income / justified price-to-book',
    why:'Deposit-taking institution. Free cash flow is not meaningful for a bank balance sheet, so value is built from book equity and the spread of return on equity over the cost of equity.',
    secondary:['Price / earnings against sustainable ROE', 'Dividend capacity at target CET1'],
    limits:['Assumes a sustainable ROE through the credit cycle, not the latest reported ROE.','Ignores the option value and the tail risk in the loan book.'] },
  ddm: {
    id:'ddm', name:'Distribution discount / AFFO',
    why:'Real estate investment trust. Income is contracted and distributed, so the distribution stream discounted at a required return is the primary model.',
    secondary:['Price / net asset value', 'Distribution yield spread over the 10-year government bond', 'Implied capitalisation rate'],
    limits:['Assumes the distribution policy and the gearing level hold.','Asset revaluation gains are excluded — only recurring income is modelled.'] },
  insurer: {
    id:'insurer', name:'Residual income with an underwriting check',
    why:'Insurer. Free cash flow is not meaningful for a balance sheet built on float and reserves, so value is built from book equity and the spread of a sustainable return on equity over the cost of equity — with the combined ratio carried as the underwriting quality check.',
    secondary:['Combined ratio against the peer set', 'Price / book against sustainable ROE', 'Solvency headroom over the required capital ratio'],
    limits:['Reserve adequacy is an estimate made by the company; a valuation built on reported book value inherits that estimate.','Embedded value is not disclosed in this dataset, so a life-style embedded-value model cannot be run.','Investment portfolio risk is not modelled separately from underwriting.'] },
  early: {
    id:'early', name:'Probability-weighted scenario with financing need',
    why:'Loss-making or early-stage business. A single discounted-cash-flow path would imply precision that does not exist, so a success case is modelled explicitly, the financing needed to reach it is priced as dilution, and the result is weighted against a downside floor.',
    secondary:['Cash runway against the burn rate', 'EV / revenue against loss-making peers', 'Liquidation or net-cash floor'],
    limits:['The probability of success is a judgement, not an observable — it is exposed as an input for that reason.','New shares are assumed to be issued at today’s price; a real raise would very likely price lower.','The downside floor assumes an orderly outcome, which a distressed restructuring may not deliver.'] },
  sotp: {
    id:'sotp', name:'Consolidated FCFF with a holding-company discount',
    why:'Holding company with unlike operating segments. A true sum of the parts needs segment-level earnings and capital, which the sample dataset does not carry — so the group is valued on consolidated cash flow and an explicit holding-company discount is applied rather than implied.',
    secondary:['Segment peer multiples once segment financials are available', 'Observed discounts at comparable listed holding companies'],
    limits:['This is not a true sum of the parts. Segment disclosure here is revenue-weighted only, so the parts cannot be valued separately.','The holding-company discount is a judgement, not an observable — it is exposed as an input for exactly that reason.','A single blended discount rate is applied to businesses with different risk profiles.'] },
};

function routeModel(c) {
  if (c.type === 'bank') return MODEL_PACKS.ri;
  if (c.type === 'insurer') return MODEL_PACKS.insurer;
  if (c.type === 'early') return MODEL_PACKS.early;
  if (c.type === 'reit') return MODEL_PACKS.ddm;
  if (c.type === 'cyclical') return MODEL_PACKS.dcfMid;
  if (c.type === 'growth' || c.type === 'saas') return MODEL_PACKS.scenario;
  if (c.type === 'holding') return MODEL_PACKS.sotp;
  return MODEL_PACKS.dcf;
}

/* Default assumptions are derived from the company's own history, then shown
   to the user as editable inputs. Nothing is hidden. */
function defaultInputs(c, d) {
  const m = d.m, pack = routeModel(c);
  const riskFree = c.mkt === 'US' ? 4.2 : 3.9;
  const erp = c.mkt === 'US' ? 4.6 : 5.0;
  const beta = { mature:0.95, growth:1.45, saas:1.20, cyclical:1.30, bank:0.95, reit:0.85, holding:1.10 }[c.type] || 1;
  const coe = riskFree + beta * erp;

  if (pack.id === 'ri') {
    const sustainableRoe = isNum(m.roe) ? clamp(m.roe * 0.97, 4, 20) : 10;
    const payout = isNum(m.payout) ? +clamp(m.payout, 10, 90).toFixed(0) : 50;
    /* Defaults must not trip the product's own guardrails: long-run growth is
       capped at what retained earnings can fund (ROE × retention). */
    const sustainableG = sustainableRoe * (1 - payout / 100);
    return { model:'ri', bvps:m.bvps, roe:+sustainableRoe.toFixed(2), coe:+coe.toFixed(2),
             g:+clamp(Math.min(c.mkt === 'US' ? 3.5 : 4.0, sustainableG), 0.5, 6).toFixed(2), payout };
  }
  if (pack.id === 'insurer') {
    const sustainableRoe = isNum(m.roe) ? clamp(m.roe * 0.95, 4, 26) : 11;
    const payout = isNum(m.payout) ? +clamp(m.payout, 10, 90).toFixed(0) : 45;
    const icoe = c.ins?.coe ?? coe;
    return { model:'insurer', bvps:m.bvps, roe:+sustainableRoe.toFixed(2), coe:+icoe.toFixed(2),
             g:+clamp(Math.min(c.mkt === 'US' ? 3.5 : 4.0, sustainableRoe * (1 - payout / 100)), 0.5, 6).toFixed(2),
             combined:c.ins?.combined ?? 100, solvency:c.ins?.solvency ?? 1.5, payout };
  }
  if (pack.id === 'early') {
    /* Years to break even, from the current loss and the assumed improvement. */
    const burn = c.early?.burn ?? Math.max(0.05, -last(d.fcf) || 0.2);
    const cashNow = last(d.cash) || 0;
    return { model:'early',
      rev0:+last(d.rev).toFixed(3),
      revCagr:+clamp(isNum(m.rev5) ? m.rev5 * 0.5 : 12, 0, 40).toFixed(2),
      termMargin: 8,
      fcfConv: 70,
      wacc:+clamp(coe + 3, 9, 22).toFixed(2),
      gt: c.mkt === 'US' ? 2.5 : 3.0, years: 8,
      burn:+burn.toFixed(3), cash:+cashNow.toFixed(3),
      pSuccess: c.early?.pSuccess ?? 35,
      shares: last(d.sh), price: c.px.p, netDebt: m.netDebt };
  }
  if (pack.id === 'ddm') {
    /* A perpetual distribution-growth rate has to be a long-run rate, not an
       extrapolation of a strong recovery period — capped well below nominal GDP. */
    const g = isNum(m.dps5) ? clamp(m.dps5 * 0.7, 0, 3.5) : 2;
    /* Capitalisation rate, gearing, occupancy and WALE are analyst-supplied
       property disclosures. SEC XBRL carries none of them, so a REIT loaded
       from filings has no c.reit at all — dereferencing it here crashed the
       entire real-data load on the first REIT in the set, which is why ten
       companies had loaded and a hundred had not. Neither field enters the
       DDM computation; both are context, so null is honest and the assumption
       rows already render a dash for a missing value. */
    return { model:'ddm', dpu:m.dps, g:+g.toFixed(2), req:+(coe + 0.4).toFixed(2), navps:m.bvps,
             cap:c.reit?.cap ?? null, gearing:c.reit?.gearing ?? null };
  }
  const fcfSeries = d.fcf.filter(isNum);
  const baseFcf = pack.id === 'dcfMid' ? sum(fcfSeries) / fcfSeries.length : last(fcfSeries);
  /* A discounted-cash-flow model needs cash flow. Two Bursa filers arrived with
     no operating cash flow line in any year, which left fcfSeries empty and
     last() undefined, and the function threw before any of the engine's own
     error handling could see it — so the company vanished from the universe
     with a console warning instead of appearing with an explanation.

     The engine already has a convention for a model that does not apply: an
     error string, which every caller checks. Using it here means the company
     loads, its statements and scorecard work, and only the valuation reports
     itself unavailable — which is the truthful outcome and the useful one. */
  if (!isNum(baseFcf)) return { model:'unavailable', pack: pack.id,
    reason: `No free cash flow could be computed for ${c.tk || c.code}: the statements carry no operating cash flow line for any year retrieved. A discounted-cash-flow estimate is not available, and no substitute has been assumed.` };
  /* Weighted average cost of capital from the company's own capital structure:
     equity at the cost of equity, debt at the risk-free rate plus a credit
     spread, after tax. Weights come from market value of equity and book debt. */
  /* Without a market price there is no market value of equity, so the weight
     falls back to book equity. Noted rather than silently substituted. */
  const usedBookEquity = !isNum(m.mcap);
  const E = usedBookEquity ? (last(d.eq) || 0) : m.mcap, D = last(d.debt) || 0, V = (E + D) || 1;
  const costDebtAfterTax = (riskFree + 1.2) * (1 - TAX[c.mkt]);
  const wacc = (coe * E + costDebtAfterTax * D) / V;

  if (pack.id === 'scenario') {
    /* Revenue → margin → free cash flow. For a fast-growing business the answer
       is dominated by the margin it eventually settles at, so that is an
       explicit input. The default holds the current margin rather than assuming
       expansion — margin expansion should be the user's claim, not ours. */
    const margin0 = isNum(m.om) ? m.om : 10;
    const conv = isNum(m.fcf) && last(d.ebit) > 0
      ? clamp(m.fcf / last(d.ebit) * 100, 25, 160)
      : 80;
    return { model:'scenario',
      rev0: +last(d.rev).toFixed(3),
      revCagr: +clamp(isNum(m.rev5) ? m.rev5 * 0.6 : 15, 4, 35).toFixed(2),
      margin0: +margin0.toFixed(2),
      /* Hold the current margin — the ceiling must not bind on a genuinely
         high-margin business, or the default would silently assume compression
         while the note claims it assumes nothing. */
      termMargin: +clamp(margin0, 4, 70).toFixed(2),
      fcfConv: +conv.toFixed(1),
      wacc: +wacc.toFixed(2), gt: c.mkt === 'US' ? 2.5 : 3.0, years: 7,
      dilution: +clamp(isNum(m.dilution) ? m.dilution : 0, -4, 8).toFixed(2),
      netDebt: m.netDebt, shares: last(d.sh) };
  }

  const g1 = clamp(isNum(m.rev5) ? m.rev5 * 0.75 : 4, -2, 14);
  return { model:'dcf', waccFromBook: usedBookEquity, fcf0:+baseFcf.toFixed(3), g1:+g1.toFixed(2), gt:c.mkt === 'US' ? 2.5 : 3.0,
           wacc:+wacc.toFixed(2), netDebt:m.netDebt, shares:last(d.sh), years:5,
           /* Only a holding company carries a conglomerate discount, and it is an
              editable input rather than something buried in the model. */
           hold: pack.id === 'sotp' ? 20 : 0 };
}

/* --- the three model implementations ------------------------------------ */
function valueDCF(inp) {
  const { fcf0, g1, gt, wacc, netDebt, shares, years, hold = 0 } = inp;
  const r = wacc / 100, gT = gt / 100;
  if (gT >= r) return { error: 'Terminal growth must stay below the discount rate — a perpetuity is undefined otherwise.' };
  let f = fcf0, pvExplicit = 0;
  const flows = [];
  for (let t = 1; t <= years; t++) {
    /* growth fades linearly from the year-1 rate to the terminal rate */
    const g = (g1 / 100) + ((gT - g1 / 100) * (t - 1) / Math.max(1, years - 1));
    f = f * (1 + g);
    const pv = f / Math.pow(1 + r, t);
    pvExplicit += pv;
    flows.push({ t, fcf: f, pv, g: g * 100 });
  }
  const terminal = f * (1 + gT) / (r - gT);
  const pvTerminal = terminal / Math.pow(1 + r, years);
  const ev = pvExplicit + pvTerminal;
  const equity = ev - (netDebt || 0);
  const holdDiscount = equity * (hold / 100);
  return { perShare: (equity - holdDiscount) / shares, pvExplicit, pvTerminal, ev, equity,
           netDebt: netDebt || 0, holdDiscount, hold, flows,
           terminalShare: pvTerminal / ev * 100 };
}

function valueRI(inp) {
  const { bvps, roe, coe, g } = inp;
  const r = coe / 100, gr = g / 100, R = roe / 100;
  if (gr >= r) return { error: 'Growth must stay below the cost of equity — the justified multiple is undefined otherwise.' };
  const justifiedPB = (R - gr) / (r - gr);
  const perShare = bvps * justifiedPB;
  /* Residual income cross-check: book value plus the present value of excess returns. */
  const ri = bvps * (R - r) / (r - gr);
  return { perShare, justifiedPB, bvps, riPremium: ri, spread: (roe - coe) };
}

function valueDDM(inp) {
  const { dpu, g, req, navps, cap } = inp;
  const r = req / 100, gr = g / 100;
  if (gr >= r) return { error: 'Distribution growth must stay below the required return.' };
  const perShare = dpu * (1 + gr) / (r - gr);
  return { perShare, impliedYield: dpu / perShare * 100, navps, pnav: perShare / navps, cap };
}

/* Revenue → operating margin → cash conversion → discounted free cash flow.
   Margin fades linearly from the reported starting margin to the terminal
   margin, and the share count compounds at the assumed issuance rate, so
   dilution reduces value per share rather than being ignored. */
function valueScenario(inp) {
  const { rev0, revCagr, margin0, termMargin, fcfConv, wacc, gt, years, netDebt, shares, dilution } = inp;
  const r = wacc / 100, gT = gt / 100;
  if (gT >= r) return { error: 'Terminal growth must stay below the discount rate — a perpetuity is undefined otherwise.' };
  if (rev0 <= 0) return { error: 'Starting revenue must be positive for a revenue-driven scenario model.' };

  let rev = rev0, pvExplicit = 0;
  const flows = [];
  for (let t = 1; t <= years; t++) {
    /* revenue growth fades from the year-1 rate toward the terminal rate */
    const g = (revCagr / 100) + ((gT - revCagr / 100) * (t - 1) / Math.max(1, years - 1));
    rev = rev * (1 + g);
    const mgn = margin0 + (termMargin - margin0) * (t / years);
    const fcf = rev * (mgn / 100) * (fcfConv / 100);
    const pv = fcf / Math.pow(1 + r, t);
    pvExplicit += pv;
    flows.push({ t, rev, mgn, fcf, pv, g: g * 100 });
  }
  const lastFcf = last(flows).fcf;
  const terminal = lastFcf * (1 + gT) / (r - gT);
  const pvTerminal = terminal / Math.pow(1 + r, years);
  const ev = pvExplicit + pvTerminal;
  const equity = ev - (netDebt || 0);
  const dilutedShares = shares * Math.pow(1 + (dilution || 0) / 100, years);
  return { perShare: equity / dilutedShares, pvExplicit, pvTerminal, ev, equity,
           netDebt: netDebt || 0, flows, shares, dilutedShares,
           undilutedPerShare: equity / shares,
           terminalRevenue: last(flows).rev, terminalShare: pvTerminal / ev * 100 };
}

/* Input consistency: signs, and whether a hand-entered figure is still on the
   same scale as the reported statements. Every input in the studio is in the
   company's reporting currency and in billions, so an input that has drifted
   orders of magnitude away from the line it came from is almost always a unit
   or per-share/whole-company mix-up rather than a real assumption. */
function consistencyWarnings(c, d, inputs) {
  const out = [], m = d.m;
  const flag = (text) => out.push({ sev:'serious', text });

  const positives = { rev0:'Starting revenue', shares:'Share count', bvps:'Book value per share',
                      dpu:'Distribution per unit', fcfConv:'Cash conversion', years:'Forecast years' };
  for (const [k, label] of Object.entries(positives)) {
    if (isNum(inputs[k]) && inputs[k] <= 0) flag(`${label} is zero or negative. Check the sign — this input cannot be non-positive.`);
  }

  const reportedRev = last(d.rev);
  if (isNum(inputs.rev0) && reportedRev > 0) {
    const ratio = inputs.rev0 / reportedRev;
    if (ratio > 8 || ratio < 0.125)
      flag(`Starting revenue of ${fmtNum(inputs.rev0, 2)} is ${fmtX(ratio, 1)} the last reported revenue of ${fmtNum(reportedRev, 2)}${c.ccy === 'MYR' ? ' RM' : ' $'}bn. Inputs are in billions of the reporting currency — this looks like a unit mismatch.`);
  }
  if (isNum(inputs.fcf0) && reportedRev > 0 && Math.abs(inputs.fcf0) > reportedRev)
    flag(`Starting free cash flow of ${fmtNum(inputs.fcf0, 2)} exceeds total revenue of ${fmtNum(reportedRev, 2)}. Free cash flow cannot be larger than revenue — check the scale.`);

  /* Per-share inputs must stay in the same order of magnitude as the price. */
  const perShare = [['bvps', 'Book value per share'], ['dpu', 'Distribution per unit']];
  for (const [k, label] of perShare) {
    if (isNum(inputs[k]) && inputs[k] > c.px.p * 25)
      flag(`${label} of ${fmtMoney(inputs[k], c.ccy)} is far above the share price of ${fmtMoney(c.px.p, c.ccy)}. This is usually a whole-company figure entered on a per-share input.`);
  }
  if (isNum(inputs.shares) && last(d.sh) > 0) {
    const sr = inputs.shares / last(d.sh);
    if (sr > 4 || sr < 0.25)
      flag(`Share count of ${fmtNum(inputs.shares, 3)}bn differs materially from the ${fmtNum(last(d.sh), 3)}bn reported. Share counts are in billions.`);
  }
  return out;
}

/* Insurer: the same residual-income arithmetic as a bank, with the combined
   ratio carried through as an underwriting-quality check rather than folded
   into the number. */
function valueInsurer(inp) {
  const base = valueRI(inp);
  if (base.error) return base;
  return { ...base, combined: inp.combined, solvency: inp.solvency,
           underwritingProfitable: inp.combined < 100 };
}

/* Loss-making / early stage: a success case, the dilution required to fund the
   path to it, and a downside floor — weighted by an explicit probability. */
function valueEarly(inp) {
  const { rev0, revCagr, termMargin, fcfConv, wacc, gt, years, burn, cash, pSuccess, shares, price, netDebt } = inp;
  const r = wacc / 100, gT = gt / 100;
  if (gT >= r) return { error: 'Terminal growth must stay below the discount rate.' };
  if (rev0 <= 0) return { error: 'Starting revenue must be positive.' };
  if (price <= 0) return { error: 'A financing need cannot be priced from a zero share price.' };

  /* Success case: revenue compounds, margin arrives linearly at the terminal
     level, cash flow follows. */
  let rev = rev0, pv = 0;
  const flows = [];
  for (let t = 1; t <= years; t++) {
    const g = (revCagr / 100) + ((gT - revCagr / 100) * (t - 1) / Math.max(1, years - 1));
    rev = rev * (1 + g);
    const mgn = (termMargin) * (t / years);              /* margin ramps from zero */
    const f = rev * (mgn / 100) * (fcfConv / 100);
    pv += f / Math.pow(1 + r, t);
    flows.push({ t, rev, mgn, fcf: f, pv: f / Math.pow(1 + r, t), g: g * 100 });
  }
  const terminal = last(flows).fcf * (1 + gT) / (r - gT);
  const pvTerminal = terminal / Math.pow(1 + r, years);
  const ev = pv + pvTerminal;
  const equity = ev - (netDebt || 0);

  /* Financing: burn continues until the margin ramp turns cash flow positive.
     Whatever cash does not cover has to be raised, and is priced as dilution
     at today's share price. */
  const yearsToBreakeven = Math.max(0, flows.findIndex(f => f.fcf > burn) + 1) || Math.ceil(years / 2);
  const need = Math.max(0, burn * yearsToBreakeven - cash);
  const newShares = need / price;
  /* Equity is a limited-liability claim: it cannot be worth less than nothing.
     When the enterprise value does not cover the debt the honest answer is nil,
     not a negative price per share — and the caller is told which case it is,
     because "worth zero" is a materially different finding from "worth little". */
  const rawSuccessPerShare = equity / (shares + newShares);
  const equityWipedOut = rawSuccessPerShare <= 0;
  const successPerShare = Math.max(0, rawSuccessPerShare);

  /* Downside floor: net cash per share, never below zero. netDebt is debt less
     cash, so net cash is simply its negative — and a company with more debt
     than cash has no floor left for equity holders. */
  const floor = Math.max(0, -(netDebt || 0) / shares);
  const p = clamp(pSuccess, 0, 100) / 100;
  const perShare = Math.max(0, p * successPerShare + (1 - p) * floor);

  return { perShare, successPerShare, rawSuccessPerShare, equityWipedOut, floor, need, newShares, yearsToBreakeven,
           pvExplicit: pv, pvTerminal, ev, equity, netDebt: netDebt || 0, shares,
           dilution: newShares / shares * 100, flows,
           terminalShare: ev ? pvTerminal / ev * 100 : 0, p };
}

function runModel(inputs) {
  /* A model the inputs cannot support. Reported, never approximated. */
  if (inputs.model === 'unavailable') return { error: inputs.reason };
  if (inputs.model === 'insurer') return valueInsurer(inputs);
  if (inputs.model === 'early') return valueEarly(inputs);
  if (inputs.model === 'ri') return valueRI(inputs);
  if (inputs.model === 'ddm') return valueDDM(inputs);
  if (inputs.model === 'scenario') return valueScenario(inputs);
  return valueDCF(inputs);
}

/* ==========================================================================
   THE NINE METHODS
   The router picks one primary pack. All nine are computed anyway, because a
   valuation that only agrees with itself has not been checked. Each returns a
   value per share or an explicit reason it does not apply — never a number
   produced by a method that does not fit the business.
   ========================================================================== */
function nineMethods(r) {
  const { c, d, m } = r;
  const inputs = studioInputs(r);
  const coeOf = () => {
    const riskFree = c.mkt === 'US' ? 4.2 : 3.9, erp = c.mkt === 'US' ? 4.6 : 5.0;
    const beta = { mature:0.95, growth:1.45, saas:1.20, cyclical:1.30, bank:0.95, reit:0.85, holding:1.10 }[c.type] || 1;
    return riskFree + beta * erp;
  };
  const wacc = isNum(inputs.wacc) ? inputs.wacc : coeOf();
  const shares = last(d.sh);
  const na = (why) => ({ value: null, why });

  /* 4 — FCFE. Equity cash flow: operating cash flow, less capex, plus net new
     borrowing, discounted at the cost of equity. Net debt is NOT subtracted
     again; the flow is already an equity flow. */
  const fcfe = (() => {
    if (c.type === 'bank') return na('Free cash flow is not meaningful for a deposit-taking balance sheet.');
    const ocf = last(d.ocf), capex = last(d.capex);
    if (!isNum(ocf)) return na('Operating cash flow is not carried for this company.');
    const netBorrow = last(d.debt) - d.debt[d.debt.length - 2];
    const f0 = ocf - capex + netBorrow;
    if (f0 <= 0) return na('Equity free cash flow is negative in the latest year.');
    const rr = coeOf() / 100, g = clamp(isNum(m.rev5) ? m.rev5 * 0.5 : 2, 0, 4) / 100;
    if (g >= rr) return na('Growth assumption is not below the cost of equity.');
    return { value: (f0 * (1 + g) / (rr - g)) / shares,
             why: `Equity flow of ${fmtCap(f0, c.ccy)} capitalised at ${fmtPct(coeOf())} with ${fmtPct(g * 100)} growth.` };
  })();

  /* 7 — Earnings power value. Normalised operating profit after tax,
     capitalised with no growth at all, then adjusted for net debt. It answers
     "what is this worth if it never grows again". */
  const epv = (() => {
    if (c.type === 'bank' || c.type === 'reit') return na('Not applied to financials or REITs, where operating profit is not the right base.');
    const norm = sum(d.ebit.slice(-5)) / 5;
    if (norm <= 0) return na('Normalised operating profit is not positive.');
    const ev = norm * (1 - TAX[c.mkt]) / (wacc / 100);
    return { value: (ev - (m.netDebt || 0)) / shares,
             why: `Five-year average operating profit of ${fmtCap(norm, c.ccy)} after tax, capitalised at ${fmtPct(wacc)} with no growth.` };
  })();

  /* 8 — Peer multiple, chosen by business model rather than applied blindly. */
  const peer = (() => {
    const peers = U.filter(x => x.c.type === c.type && x.c.id !== c.id);
    if (peers.length < 2) return na(`Only ${peers.length} comparable ${c.type} peer in the sample universe.`);
    if (c.type === 'bank') {
      const pb = median(peers.map(p => p.m.pb));
      return isNum(pb) && isNum(m.bvps)
        ? { value: pb * m.bvps, why: `Peer median price-to-book of ${fmtX(pb, 2)} on book value per share of ${fmtMoney(m.bvps, c.ccy)}.` }
        : na('Peer price-to-book could not be computed.');
    }
    if (c.type === 'reit') {
      const pn = median(peers.map(p => p.m.pnav));
      return isNum(pn) && isNum(m.bvps)
        ? { value: pn * m.bvps, why: `Peer median price-to-NAV of ${fmtX(pn, 2)} on NAV per unit of ${fmtMoney(m.bvps, c.ccy)}.` }
        : na('Peer price-to-NAV could not be computed.');
    }
    const ee = median(peers.map(p => p.m.evebit));
    if (!isNum(ee) || last(d.ebit) <= 0) return na('Peer EV/EBIT or the company’s own operating profit is not usable.');
    return { value: (ee * last(d.ebit) - (m.netDebt || 0)) / shares,
             why: `Peer median EV/EBIT of ${fmtX(ee)} on operating profit of ${fmtCap(last(d.ebit), c.ccy)}.` };
  })();

  /* 9 — Asset floor. Book value per share. Deliberately labelled a floor: for
     most going concerns it understates value, and for a loss-maker it is often
     the only defensible anchor. */
  const asset = isNum(m.bvps) && m.bvps > 0
    ? { value: m.bvps, why: 'Reported book value per share. A floor, not a target — it ignores every future cash flow.' }
    : na('Book value per share is not positive.');

  const primary = r.val;
  const packValue = (packId) => primary.pack.id === packId && primary.vals ? primary.vals.base : null;

  return [
    { n:1, name:'FCFF discounted cash flow', value: packValue('dcf'),
      why: primary.pack.id === 'dcf' ? 'Primary model for this company.' : 'Routed away from this pack for this business model.' },
    { n:2, name:'Mid-cycle normalised FCFF', value: packValue('dcfMid'),
      why: primary.pack.id === 'dcfMid' ? 'Primary model for this company.' : 'Applied only to cyclical and commodity-linked businesses.' },
    { n:3, name:'Scenario: revenue → margin → FCF', value: packValue('scenario'),
      why: primary.pack.id === 'scenario' ? 'Primary model for this company.' : 'Applied only where current cash flow is small relative to the opportunity.' },
    { n:4, name:'FCFE (free cash flow to equity)', value: fcfe.value, why: fcfe.why },
    { n:5, name:'Residual income / justified price-to-book', value: packValue('ri'),
      why: primary.pack.id === 'ri' ? 'Primary model for this company.' : 'Applied to deposit-taking institutions.' },
    { n:6, name:'Distribution discount (DDM / AFFO)', value: packValue('ddm'),
      why: primary.pack.id === 'ddm' ? 'Primary model for this company.' : 'Applied to real estate investment trusts.' },
    { n:7, name:'Earnings power value (no growth)', value: epv.value, why: epv.why },
    { n:8, name:'Peer multiple', value: peer.value, why: peer.why },
    { n:9, name:'Net asset / book value floor', value: asset.value, why: asset.why },
  ];
}

/* Bear / base / bull are produced by shifting the drivers that matter for the
   selected pack — the shift sizes are published, not hidden. */
const SCENARIO_SHIFT = {
  dcf:      { bear:{ g1:-4, wacc:+1.2, gt:-0.5 },   bull:{ g1:+4, wacc:-1.0, gt:+0.4 } },
  ri:       { bear:{ roe:-2.5, coe:+1.2, g:-0.8 },  bull:{ roe:+2.0, coe:-0.9, g:+0.6 } },
  ddm:      { bear:{ g:-1.5, req:+1.2 },            bull:{ g:+1.5, req:-0.9 } },
  insurer:  { bear:{ roe:-2.5, coe:+1.2, g:-0.8 },  bull:{ roe:+2.0, coe:-0.9, g:+0.6 } },
  early:    { bear:{ revCagr:-10, termMargin:-4, pSuccess:-15 },
              bull:{ revCagr:+10, termMargin:+4, pSuccess:+15 } },
  scenario: { bear:{ revCagr:-8, termMargin:-5, wacc:+1.5 },
              bull:{ revCagr:+8, termMargin:+5, wacc:-1.2 } },
};

function valuationRun(c, d, inputs) {
  const pack = routeModel(c);
  const key = inputs.model;
  const shift = SCENARIO_SHIFT[key];
  const apply = (delta) => { const o = { ...inputs }; for (const [k, v] of Object.entries(delta)) o[k] = o[k] + v; return o; };

  const base = runModel(inputs);
  /* A model that does not apply has no bear and bull to shift. There is no
     entry in SCENARIO_SHIFT for it and there should not be one — shifting the
     assumptions of a model that could not be built is a scenario around
     nothing. The base error carries through to every caller unchanged. */
  if (!shift || base.error) {
    return { pack, inputs, base, bear: base, bull: base,
             err: base.error || `No scenario band is defined for the ${key} model.`,
             vals: null, mos: null, conf: 0, confBand: 'Low',
             price: isNum(c.px?.p) ? c.px.p : null, shift: null };
  }
  const bear = runModel(apply(shift.bear));
  const bull = runModel(apply(shift.bull));
  const err = base.error || bear.error || bull.error;

  const price = isNum(c.px?.p) ? c.px.p : null;
  const vals = err ? null : { bear: bear.perShare, base: base.perShare, bull: bull.perShare };
  const mos = (err || price == null) ? null : {
    bear: (bear.perShare - price) / price * 100,
    base: (base.perShare - price) / price * 100,
    bull: (bull.perShare - price) / price * 100,
  };

  /* Confidence: data coverage, model fit for the company type, and how wide
     the bear-bull band is relative to the base case. */
  let conf = 0;
  conf += d.m.coverage >= 90 ? 40 : d.m.coverage >= 75 ? 28 : 16;
  conf += ({ mature:30, bank:26, insurer:24, reit:28, cyclical:18, holding:14, growth:12, saas:16, early:6 })[c.type] || 20;
  if (!err) {
    const width = (bull.perShare - bear.perShare) / base.perShare * 100;
    conf += width < 45 ? 30 : width < 80 ? 20 : 8;
  }
  let confBand = conf >= 78 ? 'High' : conf >= 58 ? 'Medium' : 'Low';
  /* Model applicability caps confidence. A tight bear-bull band on a cyclical or
     an early-growth business is a property of the model, not evidence that the
     answer is reliable — so those packs cannot reach a High grade. */
  const CAP = { cyclical:'Medium', growth:'Medium', saas:'Medium', holding:'Medium', insurer:'Medium' };
  if (CAP[c.type] === 'Medium' && confBand === 'High') confBand = 'Medium';
  /* An early-stage valuation is never more than low confidence. The spread
     between the success case and the floor is the whole point. */
  if (c.type === 'early') confBand = 'Low';

  return { pack, inputs, base, bear, bull, vals, mos, err, conf, confBand, price, shift };
}

/* Driver sensitivity: how much does the base-case model estimate move per unit of each
   assumption? Computed by re-running the model, never estimated. */
function driverImpact(c, d, inputs) {
  const probes = {
    dcf: [ ['g1', 2, 'Year-1 growth', 'pp'], ['wacc', 1, 'Discount rate', 'pp'], ['gt', 0.5, 'Terminal growth', 'pp'], ['fcf0', inputs.fcf0 * 0.1, 'Starting free cash flow', '10%'],
           ...(inputs.hold ? [['hold', 5, 'Holding-company discount', 'pp']] : []) ],
    ri:  [ ['roe', 2, 'Sustainable ROE', 'pp'], ['coe', 1, 'Cost of equity', 'pp'], ['g', 0.5, 'Long-run growth', 'pp'], ['bvps', inputs.bvps * 0.05, 'Book value per share', '5%'] ],
    ddm: [ ['g', 1, 'Distribution growth', 'pp'], ['req', 1, 'Required return', 'pp'], ['dpu', inputs.dpu * 0.05, 'Distribution per unit', '5%'] ],
    insurer: [ ['roe', 2, 'Sustainable ROE', 'pp'], ['coe', 1, 'Cost of equity', 'pp'], ['g', 0.5, 'Long-run growth', 'pp'], ['bvps', inputs.bvps * 0.05, 'Book value per share', '5%'] ],
    early: [ ['pSuccess', 10, 'Probability of success', 'pp'], ['termMargin', 4, 'Terminal operating margin', 'pp'], ['revCagr', 6, 'Revenue CAGR', 'pp'], ['wacc', 1.5, 'Discount rate', 'pp'], ['burn', Math.max(0.01, inputs.burn * 0.2), 'Annual cash burn', '20%'] ],
    scenario: [ ['termMargin', 5, 'Terminal operating margin', 'pp'], ['revCagr', 5, 'Revenue CAGR', 'pp'],
                ['wacc', 1, 'Discount rate', 'pp'], ['fcfConv', 10, 'Cash conversion', 'pp'],
                ['dilution', 1, 'Annual share issuance', 'pp'] ],
  }[inputs.model];
  /* No probe list for a model that could not be built, and nothing to probe. */
  if (!probes) return [];

  const baseVal = runModel(inputs).perShare;
  return probes.map(([k, step, label, unit]) => {
    const up = runModel({ ...inputs, [k]: inputs[k] + step });
    const dn = runModel({ ...inputs, [k]: inputs[k] - step });
    const hi = up.error ? null : (up.perShare - baseVal) / baseVal * 100;
    const lo = dn.error ? null : (dn.perShare - baseVal) / baseVal * 100;
    return { k, label, unit, step, hi, lo, span: Math.max(Math.abs(hi ?? 0), Math.abs(lo ?? 0)) };
  }).sort((a, b) => b.span - a.span);
}

/* Two-driver sensitivity grid, recomputed from the model on every change. */
const SENS_AXES = {
  dcf: { x:{ k:'wacc', label:'Discount rate', steps:[-1.5,-0.75,0,0.75,1.5], fmt:v=>fmtPct(v,2) },
         y:{ k:'gt',   label:'Terminal growth', steps:[1,0.5,0,-0.5,-1], fmt:v=>fmtPct(v,2) } },
  ri:  { x:{ k:'coe',  label:'Cost of equity', steps:[-1.5,-0.75,0,0.75,1.5], fmt:v=>fmtPct(v,2) },
         y:{ k:'roe',  label:'Sustainable ROE', steps:[3,1.5,0,-1.5,-3], fmt:v=>fmtPct(v,2) } },
  ddm: { x:{ k:'req',  label:'Required return', steps:[-1.5,-0.75,0,0.75,1.5], fmt:v=>fmtPct(v,2) },
         y:{ k:'g',    label:'Distribution growth', steps:[1.5,0.75,0,-0.75,-1.5], fmt:v=>fmtPct(v,2) } },
  insurer: { x:{ k:'coe', label:'Cost of equity', steps:[-1.5,-0.75,0,0.75,1.5], fmt:v=>fmtPct(v,2) },
            y:{ k:'roe', label:'Sustainable ROE', steps:[3,1.5,0,-1.5,-3], fmt:v=>fmtPct(v,2) } },
  early:   { x:{ k:'pSuccess', label:'Probability of success', steps:[-20,-10,0,10,20], fmt:v=>fmtPct(v,0) },
            y:{ k:'termMargin', label:'Terminal operating margin', steps:[6,3,0,-3,-6], fmt:v=>fmtPct(v,1) } },
  scenario: { x:{ k:'wacc', label:'Discount rate', steps:[-1.5,-0.75,0,0.75,1.5], fmt:v=>fmtPct(v,2) },
              y:{ k:'termMargin', label:'Terminal operating margin', steps:[8,4,0,-4,-8], fmt:v=>fmtPct(v,1) } },
};

function sensitivityGrid(inputs) {
  const ax = SENS_AXES[inputs.model];
  return ax.y.steps.map(dy => ax.x.steps.map(dx => {
    const r = runModel({ ...inputs, [ax.x.k]: inputs[ax.x.k] + dx, [ax.y.k]: inputs[ax.y.k] + dy });
    return r.error ? null : r.perShare;
  }));
}

