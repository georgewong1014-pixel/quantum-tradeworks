/* ==========================================================================
   IPS §6.5, §6.7 AND §6.8 — THE THREE PROPERTY TESTS THAT DID NOT EXIST
   --------------------------------------------------------------------------
   The calculator already did the arithmetic the IPS asks for: full acquisition
   cost, net rental economics after every recurring line, a stress test, a
   grade with hard gates. Three tests in section 6 had no implementation at all,
   and each of them is the kind that changes an answer rather than refining it.
   ========================================================================== */

/* ---- §6.5 THE DEMAND TEST -------------------------------------------------
   "Identify who has a recurring reason to occupy or buy the property."

   The IPS names six sources and then says something sharper than the list:
   CONCENTRATION IS PENALISED, and specifically demand that depends on
   investors, tourists, or infrastructure that has not been built.

   That last clause is the one worth engineering for. Every Malaysian project
   that has gone badly wrong in the last two decades was sold on a demand story
   that had not happened yet — the airport extension, the university campus, the
   industrial park. So a promised source is recorded as promised and never
   counts as demand until it is operating. */
const DEMAND_SOURCES = [
  { id: 'employment', label: 'Employment and industry',
    ask: 'Employers within commuting distance whose staff need to live here.' },
  { id: 'education', label: 'Education and students',
    ask: 'A school, college or university with enrolment that has actually started.' },
  { id: 'healthcare', label: 'Healthcare',
    ask: 'A hospital or clinic drawing staff, patients and their families.' },
  { id: 'family', label: 'Family and owner-occupier',
    ask: 'People buying to live here themselves. The deepest and most durable source, and the hardest to fake.' },
  { id: 'government', label: 'Government or institutional',
    ask: 'Administrative offices, forces or an institution with posted staff.' },
  { id: 'tourism', label: 'Tourism and short-stay',
    ask: 'Visitor demand. Seasonal by nature and the first to disappear.',
    fragile: true },
  { id: 'investor', label: 'Investor and speculative',
    ask: 'Buyers purchasing to resell or to let. Not occupier demand — it is the same units coming back to the market.',
    fragile: true, notDemand: true },
];

const DEMAND_STATES = [
  { id: 'operating', label: 'Operating now', counts: true,
    note: 'Exists and is running today. The only state that counts as demand.' },
  { id: 'declining', label: 'Operating but declining', counts: true,
    note: 'Still here, and shrinking. Counts, with the direction recorded.' },
  { id: 'promised', label: 'Announced or under construction', counts: false,
    note: 'Not yet operating. Records the promise without letting it count — this is the state that has carried the most Malaysian off-plan losses.' },
  { id: 'none', label: 'Not present', counts: false, note: 'Checked, and absent.' },
];
const DEMAND_STATE_BY_ID = Object.fromEntries(DEMAND_STATES.map(s => [s.id, s]));

const demandKey = (city, area) => `${city}|${area}`;
State.demand = store.read('demand', {});
const saveDemand = () => store.write('demand', State.demand);
const demandRecord = (city, area) => State.demand[demandKey(city, area)] || {};

function setDemand(city, area, sourceId, rec) {
  const k = demandKey(city, area);
  const prev = { ...(State.demand[k] || {}) };
  const was = prev[sourceId] || null;
  if (rec) prev[sourceId] = { ...rec, recordedAt: new Date().toISOString().slice(0, 16).replace('T', ' ') };
  else delete prev[sourceId];
  logRegister('demand', rec ? (was ? 'edit' : 'add') : 'delete', k,
    { field: sourceId, from: was, to: rec ? prev[sourceId] : null });
  if (Object.keys(prev).length) State.demand[k] = prev; else delete State.demand[k];
  saveDemand();
}

/* The verdict. Concentration is the finding, not the count. */
function demandTest(city, area) {
  const rec = demandRecord(city, area);
  const items = DEMAND_SOURCES.map(s => {
    const r = rec[s.id];
    const st = r ? DEMAND_STATE_BY_ID[r.state] : null;
    return { source: s, recorded: !!r, state: st, note: r?.note || '', asOf: r?.asOf || '',
             counts: !!(st && st.counts && !s.notDemand) };
  });
  const counting = items.filter(i => i.counts);
  const promised = items.filter(i => i.state && i.state.id === 'promised');
  const fragileOnly = counting.length > 0 && counting.every(i => i.source.fragile);
  const investorLed = items.some(i => i.source.id === 'investor' && i.state && i.state.counts);
  const unrecorded = items.filter(i => !i.recorded);

  let verdict, why;
  if (unrecorded.length === items.length) {
    verdict = 'unknown';
    why = 'Nobody has recorded what produces demand here. The IPS makes this a required test, not an optional one — an area with unexamined demand is not an area with adequate demand.';
  } else if (!counting.length) {
    verdict = 'fail';
    why = promised.length
      ? `The only demand recorded here is ${promised.map(p => p.source.label.toLowerCase()).join(' and ')}, and it is announced rather than operating. `
        + 'The IPS rejects dependence on demand that has not started.'
      : 'No operating source of demand has been recorded. This is an auto-reject condition under IPS §6.9.';
  } else if (fragileOnly) {
    verdict = 'partial';
    why = `Demand rests only on ${counting.map(c => c.source.label.toLowerCase()).join(' and ')}, which the IPS treats as concentrated and fragile. `
      + 'One source that can stop is not a demand base.';
  } else if (counting.length === 1) {
    verdict = 'partial';
    why = `A single operating source: ${counting[0].source.label.toLowerCase()}. Concentrated demand is penalised — if it closes, so does the market for this property.`;
  } else {
    verdict = 'pass';
    why = `${counting.length} operating sources of demand recorded: ${counting.map(c => c.source.label.toLowerCase()).join(', ')}.`;
  }

  return { items, counting, promised, unrecorded, investorLed, verdict, why,
    warnings: [
      investorLed ? 'Investor demand is recorded as operating. It is counted separately and never as occupier demand: those units return to the market rather than leaving it.' : null,
      promised.length && counting.length ? `${promised.length} announced source(s) are recorded and deliberately excluded from the count until they operate.` : null,
    ].filter(Boolean) };
}

/* ---- §6.7 ENVIRONMENTAL DEPRECIATION -------------------------------------
   "For coastal, flood-prone, highly humid or otherwise harsh environments,
   include recurring allowances for..."

   This is a genuine hole in the calculator, and a Sarawak-shaped one. Every
   coastal town in the state is humid, salt-laden and monsoon-exposed, and the
   maintenance line in a standard yield model was written for a dry inland
   apartment. A building on the Miri or Mukah coast does not cost the same to
   keep as one in Kuching city centre, and treating them as the same is how a
   6% gross yield becomes a 2% net one over ten years.

   ALLOWANCES ARE DERIVED FROM WHAT WAS RECORDED, NEVER FROM THE TOWN NAME.
   The exposure comes from the coastal and flood attributes on the locality —
   facts somebody recorded — so an unexamined area gets no allowance and says
   so, rather than being quietly charged for a coast nobody has confirmed. */
const ENV_ALLOWANCES = [
  { id: 'corrosion', label: 'Corrosion and salt exposure',
    triggers: { coastal: ['saline', 'erosion', 'tidal'] },
    pctOfValue: 0.15,
    note: 'Railings, grilles, gates, air-conditioner coils and exposed fixings in a salt-laden atmosphere. Replacement rather than repair, on a shorter cycle.' },
  { id: 'waterproofing', label: 'Waterproofing, leakage and mould',
    triggers: { flood: ['occasional', 'recurrent'], coastal: ['tidal'] },
    pctOfValue: 0.20,
    note: 'Roof and wet-area membranes, and the internal damage when they fail. Humidity keeps mould live between events.' },
  { id: 'paint', label: 'Paint and external surfaces',
    triggers: { coastal: ['saline', 'tidal', 'erosion'], flood: ['occasional', 'recurrent'] },
    pctOfValue: 0.12,
    note: 'External repainting on a materially shorter cycle than an inland building.' },
  { id: 'fittings', label: 'Windows, doors, air-conditioners and appliances',
    triggers: { coastal: ['saline', 'tidal'] },
    pctOfValue: 0.18,
    note: 'Mechanisms, seals and compressors fail earlier in humid, salt-laden air.' },
  { id: 'storm', label: 'Storm exposure',
    triggers: { coastal: ['erosion', 'tidal'] },
    pctOfValue: 0.08,
    note: 'Monsoon damage to roofing, glazing and external works.' },
  { id: 'fitout', label: 'Furniture and fit-out replacement',
    triggers: { coastal: ['saline', 'tidal'], flood: ['recurrent'] },
    pctOfValue: 0.15,
    note: 'Furnished lettings in this environment replace fit-out sooner. Applies only where the letting is furnished.' },
  { id: 'settlement', label: 'Ground settlement remediation',
    triggers: { ground: ['peat-deep', 'peat-shallow', 'fill'], coastal: ['settling'] },
    pctOfValue: 0.25,
    note: 'Re-levelling aprons and drives, re-laying drainage falls, and repairing service connections pulled apart as unpiled ground consolidates. The building is piled; nothing around it is.' },
];

/* Returns the recurring annual allowance this locality's RECORDED exposure
   justifies, itemised, plus what is unexamined. Percentages are of the
   property's value per year and are stated as the rough planning figures they
   are — no survey underlies them and the panel says so. */
function environmentalAllowance(d) {
  const city = d.city, area = d.district;
  const cls = (attrId) => areaAttr(city, area, attrId)?.class || null;
  const recorded = { coastal: cls('coastal'), flood: cls('flood'), ground: cls('ground') };
  const anyRecorded = Object.values(recorded).some(Boolean);

  const items = ENV_ALLOWANCES.map(a => {
    const hit = Object.entries(a.triggers).find(([attr, classes]) =>
      recorded[attr] && classes.includes(recorded[attr]));
    if (!hit) return null;
    /* Fit-out only bites on a furnished letting, and this product has no field
       saying whether it is one — so it is offered rather than applied. */
    const annual = num0(d.price) * (a.pctOfValue / 100);
    return { ...a, triggeredBy: hit[0], triggeredByClass: recorded[hit[0]], annual };
  }).filter(Boolean);

  const annual = items.reduce((s, i) => s + i.annual, 0);
  return {
    items, annual, monthly: annual / 12, recorded, anyRecorded,
    /* What has NOT been established, because an absent allowance because
       nothing was recorded is a different statement from one because the
       locality is dry and inland. */
    unexamined: ['coastal', 'flood', 'ground'].filter(k => !recorded[k]),
    why: !anyRecorded
      ? 'No coastal, flood or ground record exists for this locality, so no environmental allowance is computed. That is an absence of evidence, not an absence of exposure.'
      : items.length
        ? `${items.length} allowance${items.length === 1 ? '' : 's'} triggered by what has been recorded here.`
        : 'The recorded exposure does not trigger any environmental allowance.',
  };
}

/* ---- §6.8 RENT VERSUS BUY ------------------------------------------------
   "For lifestyle, holiday or low-occupancy property, compare price-to-rent and
   the owner's annual carrying cost with the cost of renting only for the
   intended period of use. If renting provides similar use at a fraction of the
   capital commitment, classify the purchase as lifestyle consumption rather
   than an income investment."

   The classification is the output, and it is the most useful sentence this
   product can produce for a certain kind of buyer. Nothing about it is a
   recommendation: it says which of two things the transaction IS, and a
   purchase can be perfectly rational as consumption. It simply must not be
   modelled as income when it is not producing any. */
function rentVersusBuy(d, m, weeksOfOwnUsePerYear) {
  const price = num0(d.price);
  const annualRent = num0(d.rent) * 12;
  if (!(price > 0) || !(annualRent > 0)) {
    return { ok: false, why: 'A price and a market rent are both needed before the two can be compared.' };
  }
  const priceToRent = price / annualRent;

  /* The owner's true annual carrying cost: everything that recurs, plus the
     return the deposit is not earning elsewhere. Leaving out opportunity cost
     is what makes ownership look free. */
  /* opex, not a field called annualOperatingCost — which the model does not
     produce. The first version of this read that name, got zero, and quietly
     compared renting against debt service alone with every maintenance,
     assessment, insurance and management cost missing. It made owning look
     cheaper than it is, on the one test whose whole job is the opposite. */
  const carrying = num0(m.opex) + num0(m.annualDebtService);
  const equity = num0(m.totalInitialCash);
  const opportunity = equity * (num0(d.equityReturnPct) / 100);
  const trueCarrying = carrying + opportunity;

  const weeks = isNum(weeksOfOwnUsePerYear) ? clamp(weeksOfOwnUsePerYear, 0, 52) : null;
  /* Renting the same use, at the same market rent, for only the weeks it is
     actually wanted. A short-stay premium would make renting look worse and is
     not assumed — the comparison uses the rent this property itself commands. */
  const rentInstead = isNum(weeks) ? (annualRent / 52) * weeks : null;
  const ratio = isNum(rentInstead) && trueCarrying > 0 ? rentInstead / trueCarrying : null;

  /* The IPS threshold is qualitative — "a fraction of the capital commitment".
     A quarter is the line used here and it is stated rather than hidden, so a
     reader who disagrees can see exactly what they are disagreeing with. */
  const consumption = isNum(ratio) && ratio < 0.25;

  return {
    ok: true, priceToRent, carrying, opportunity, trueCarrying, rentInstead, ratio, weeks, consumption,
    classification: !isNum(weeks)
      ? 'Not classified — enter the weeks a year you would actually use it.'
      : consumption
        ? 'Lifestyle consumption, not an income investment.'
        : 'Use is high enough that the comparison does not by itself reclassify this as consumption.',
    why: !isNum(weeks)
      ? 'The test needs one number this product cannot infer: how many weeks a year you would use the property yourself.'
      : consumption
        ? `Renting this same property for the ${fmtNum(weeks, 0)} week${weeks === 1 ? '' : 's'} a year you would use it costs about `
          + `${fmtMoney(rentInstead, 'MYR', 0)}, against ${fmtMoney(trueCarrying, 'MYR', 0)} a year to own it — `
          + `${fmtPct(ratio * 100, 0)} of the cost, without the capital committed. `
          + 'That can still be the right purchase. It is not an income investment, and modelling it as one would overstate what it returns.'
        : `Renting for ${fmtNum(weeks, 0)} weeks would cost ${fmtMoney(rentInstead, 'MYR', 0)} against `
          + `${fmtMoney(trueCarrying, 'MYR', 0)} to own — ${fmtPct(ratio * 100, 0)} of the cost. `
          + 'Above the quarter threshold this test uses, so it does not reclassify the purchase on its own.',
  };
}

/* ==========================================================================
   THE PROPERTY ENGINE, ANSWERING THE EIGHT UNIVERSAL GATES
   --------------------------------------------------------------------------
   Nothing here computes anything new. Every answer is read out of the model,
   the grade or a test that already exists, and the only work this does is
   decide which of the four verdicts each gate has earned and say why.

   That is the point of a spine: if the property engine and the equity engine
   both had to invent their own idea of "answered", the two would drift, and a
   reader comparing a shophouse against a bank would be comparing two different
   standards wearing the same words.
   ========================================================================== */
function propertyIpsAnswers(d, m, g) {
  const A = [];
  const gates = g.gates || [];
  const critical = gates.filter(x => x.severity === 'critical');
  const title = TITLE_TYPES.find(t => t.id === d.titleType);

  /* 1 — ELIGIBILITY. Title first: a restricted class is not a price question,
     and the IPS puts lawfulness above everything below it. */
  if (!d.titleType || d.titleType === 'unknown') {
    A.push(ipsAnswer('eligibility', 'unknown',
      'The title class has not been established. Until it is, nothing below is actionable — this is the first gate for that reason.'));
  } else if (title && title.restricted) {
    A.push(ipsAnswer('eligibility', 'fail',
      `${title.label}. ${title.note} Eligibility is a question of status, not of price, and no figure below can answer it.`));
  } else {
    A.push(ipsAnswer('eligibility', 'pass',
      `${title.label}, recorded. Confirm against the title document itself and with the Land and Survey Department before committing.`));
  }

  /* 2 — CAPITAL. The model knows what must be found and whether a reserve
     survives it. */
  const safe = num0(m.safeCashRequired), reserve = num0(m.reserveCash);
  A.push(safe > 0
    ? ipsAnswer('capital', reserve > 0 ? 'pass' : 'partial',
        `${fmtMoney(safe, 'MYR', 0)} to complete and be safe, of which ${fmtMoney(reserve, 'MYR', 0)} is the reserve. `
        + (reserve > 0
          ? 'The IPS requires at least six months of instalments, maintenance, repairs and vacancy exposure held back.'
          : 'No liquidity reserve is carried. The IPS requires at least six months of obligations held back before this gate is answered.'))
    : ipsAnswer('capital', 'unknown', 'Not computed — the purchase figures are incomplete.'));

  /* 3 — DEMAND. §6.5, and the one gate this product could not answer at all
     until the demand test existed. */
  const dem = demandTest(d.city, d.district);
  A.push(ipsAnswer('demand', dem.verdict, dem.why));

  /* 4 — RETURN ENGINE. Named rather than scored: rent, value-add or
     appreciation, and the IPS is explicit that unsupported appreciation is an
     auto-reject rather than an engine. */
  const noi = num0(m.noi), reno = num0(d.renovation);
  const apprecOnly = noi <= 0 && reno <= 0;
  A.push(apprecOnly
    ? ipsAnswer('engine', 'fail',
        'Net operating income is not positive and no value-add is planned, which leaves appreciation as the only return engine. '
        + 'IPS §6.9 treats dependence on unsupported appreciation as an auto-reject condition.')
    : ipsAnswer('engine', 'pass',
        [noi > 0 ? `Net rent of ${fmtMoney(noi, 'MYR', 0)} a year` : null,
         reno > 0 ? `value-add of ${fmtMoney(reno, 'MYR', 0)}` : null].filter(Boolean).join(' and ')
        + `. Appreciation is assumed at ${fmtPct(num0(d.apprecPct), 1)} a year and is not counted as an engine.`));

  /* 5 — NET ECONOMICS. Positive or not, and the environmental allowance the
     IPS requires in a harsh environment is applied here rather than left to a
     footnote. */
  const env = environmentalAllowance(d);
  const monthly = num0(m.cashflowMonthly);
  const afterEnv = monthly - env.monthly;
  A.push(monthly < 0
    ? ipsAnswer('net', 'fail',
        `Monthly position is ${fmtMoney(monthly, 'MYR', 0)} before any environmental allowance. `
        + 'Severe or persistent negative cash flow is an auto-reject condition under IPS §6.9.')
    : ipsAnswer('net', env.annual > 0 && afterEnv < 0 ? 'fail' : 'pass',
        `Monthly position ${fmtMoney(monthly, 'MYR', 0)}`
        + (env.annual > 0
          ? `, and ${fmtMoney(afterEnv, 'MYR', 0)} once the ${fmtMoney(env.annual, 'MYR', 0)} a year of environmental allowance this locality's recorded exposure justifies is taken out.`
          : `. ${env.why}`)));

  /* 6 — MARGIN OF SAFETY. This product publishes no valuation of a property
     and will not invent one, so the honest answer is that the gate is
     unanswered unless a bank valuation was entered. */
  const bv = num0(d.bankValuation);
  A.push(bv > 0
    ? ipsAnswer('margin', bv >= num0(d.price) ? 'pass' : 'fail',
        bv >= num0(d.price)
          ? `Bank valuation ${fmtMoney(bv, 'MYR', 0)} against a price of ${fmtMoney(d.price, 'MYR', 0)} — the valuation supports the price.`
          : `Bank valuation ${fmtMoney(bv, 'MYR', 0)} is below the price of ${fmtMoney(d.price, 'MYR', 0)}. `
            + `The shortfall of ${fmtMoney(num0(d.price) - bv, 'MYR', 0)} is cash you must find, and IPS §6.9 treats insufficient valuation as an auto-reject.`)
    : ipsAnswer('margin', 'unknown',
        'No bank valuation entered. This product publishes no valuation of a property and will not estimate one — '
        + 'the margin of safety cannot be established from a price alone.'));

  /* 7 — EXECUTION. A property is a single indivisible purchase, so the IPS's
     tranche language does not apply; what does is whether the borrower can
     carry it under stress. */
  /* borrowerAffordability, taking the stored borrower profile — there is no
     borrowerReadiness(). The engine keeps the borrower separate from the
     property on purpose: a strong borrower can face an unfinanceable property
     and the reverse, and this gate is about the borrower's half. */
  const b = borrowerAffordability(State.borrower, m);
  A.push(isNum(b?.stressedDSR)
    ? ipsAnswer('execution', b.stressedDSR <= 70 ? 'pass' : 'fail',
        `Debt service ratio ${fmtPct(b.baseDSR, 0)} at the entered rate and ${fmtPct(b.stressedDSR, 0)} stressed. `
        + 'A property cannot be bought in tranches, so the execution question here is whether the instalment survives a rate move.')
    : ipsAnswer('execution', 'unknown',
        'Income and existing commitments have not been entered, so the instalment cannot be tested against what carries it.'));

  /* 8 — EXIT. Recorded transactions are the only evidence of a resale market
     this product holds, and their absence is the finding. */
  const mx = areaMetrics(d.city, d.district);
  const sales = (mx.soldN || 0) + (mx.lastLand ? 1 : 0);
  A.push(sales >= 3
    ? ipsAnswer('exit', 'pass',
        `${sales} transactions recorded in ${d.district}. The most recent is ${mx.lastSold ? mx.lastSold.date : mx.lastLand.date}.`)
    : sales > 0
      ? ipsAnswer('exit', 'partial',
          `${sales} transaction${sales === 1 ? '' : 's'} recorded in ${d.district}. `
          + 'One or two sales is not a resale market; it is an anecdote about a resale market.')
      : ipsAnswer('exit', 'unknown',
          `No transactions recorded in ${d.district}. `
          + 'IPS §6.9 makes the absence of a credible exit market an auto-reject, and this product holds no licensed transaction source that could answer it for you.'));

  return A;
}

/* The full property assessment against the IPS, in one call. */
const propertyIps = (d, m, g) => ipsAssess(propertyIpsAnswers(d, m, g));
