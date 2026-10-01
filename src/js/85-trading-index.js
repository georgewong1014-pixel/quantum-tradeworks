/* ==========================================================================
   QT TRADING INDEX — specification qt-trading-index-1.0.0, 9 August 2026

   WHY THIS IS A SEPARATE MODULE AND NOT ANOTHER STRATEGY FIT

   The Strategy Lens gates everything on filed company statements: no filings,
   no grade. That is right for a company and useless for the instruments this
   module exists to serve. An index ETF has no return on equity to test and a
   perpetual contract is not an ownership claim at all. Routing either through
   a fundamental gate returns U forever, which reads as "we assessed this and
   found nothing" when the truth is "this tool never had a question that
   applied to it".

   So the fundamental gate is REPLACED, not removed. An ordinary share still
   has to clear its Strategy Lens tier. Everything else has to clear an asset
   thesis gate — mandate, issuer, venue, liquidity, custody — which is the
   equivalent question for a thing that has no earnings.

   THREE NUMBERS, NEVER ONE (§1)

   Trend regime describes the market. Tranche readiness describes whether the
   USER'S OWN pre-declared rules are met. Screenshot confidence describes how
   much of either the image can actually support. Averaging them would let a
   legible screenshot of a poor setup outscore a blurry screenshot of a good
   one, which is the exact failure the three-way split exists to prevent.

   THE MONTHLY WEIGHT IS THE WHOLE POINT

   0.40 monthly / 0.35 weekly / 0.25 daily is arithmetic that encodes a
   discipline. A daily bounce cannot carry a bearish structure into a
   "confirmed uptrend": a perfect daily 100 against a bearish 39 monthly and 39
   weekly reaches 54.25, the top of "transition", never "confirmed". That is
   acceptance test 21.1 and it holds by construction rather than by a guard
   somebody could later delete.

   WHERE THIS DEVIATES FROM THE SPECIFICATION, AND WHY

   §6 defines evidence as a five-state ordinal (0/25/50/75/100) and §16 types
   every group as DirectionState. §14's worked example then scores groups 65,
   45, 30, 20 and 35 — values no ordinal can express. Both cannot be normative.
   Resolved by storing a NUMBER whose input control is the five states: the
   picker writes 0/25/50/75/100 and an analyst may refine within the scale.
   That is a superset of §16 rather than a contradiction of it, it keeps §14
   reproducible to the digit, and any value that is not one of the five states
   is labelled an analyst estimate rather than a state.

   §10 names the seven tranche components and their weights but never says how
   six of them are derived. They are derived here, each derivation is published
   on the page, and all seven reproduce §14.7 exactly. Entry location is the
   exception — a judgement about the plan rather than a reading of the chart —
   so it stays an ordinal the user sets.

   NO VISION, NO OCR, NO AUTOMATIC EXTRACTION — ON THIS PAGE

   §22 puts screenshot extraction in phase 2 and this page is phase 1. The
   screenshot is evidence a person read; the states are what that person
   recorded. The phase-2 script (qtti/extract.mjs) runs off-page, writes a
   draft only, and nothing it produces is scored until a person has confirmed
   it against the image. Nothing HERE claims to have looked at an image, and
   the page says so rather than implying a capability it does not have.
   ========================================================================== */
/* @qtti-engine-start — see the matching end marker. qtti/batch.mjs slices the
   file between these two and evaluates it, so the engine has exactly one
   definition and the weekly batch cannot drift from the page. Keep this region
   free of DOM, localStorage and anything else a browser supplies. */
const QTTI_VERSION = 'qt-trading-index-1.0.0';

/* §19.3 model registry. Every weight, band, floor and threshold lives here and
   nowhere else — "never hard-code a score band in multiple UI components". */
const QTTI_STATES = [
  { id:'strong_bearish', label:'Strong bearish',  v:0 },
  { id:'bearish',        label:'Bearish',         v:25 },
  { id:'neutral',        label:'Neutral / mixed', v:50 },
  { id:'bullish',        label:'Bullish',         v:75 },
  { id:'strong_bullish', label:'Strong bullish',  v:100 },
  { id:'unknown',        label:'Unknown — cannot be read', v:50, unknown:true },
];
const QTTI_GROUPS = [
  { k:'priceStructure',   label:'Price structure',       w:0.25, ask:'Higher highs and higher lows, lower highs and lower lows, a range, or a break?' },
  { k:'trendReferences',  label:'Trend references',      w:0.25, ask:'Where is price against the major averages or cloud, and are they rising or falling?' },
  { k:'momentum',         label:'Momentum',              w:0.15, ask:'Positive or negative, improving or deteriorating, and is there a divergence?' },
  { k:'volume',           label:'Volume and participation', w:0.15, ask:'Does participation confirm the move, or warn of weak conviction?' },
  { k:'relativeStrength', label:'Relative strength',     w:0.10, ask:'Is it outperforming its declared benchmark over the configured horizon?' },
  { k:'confirmation',     label:'Confirmation or conflict', w:0.10, ask:'How many independent evidence groups actually agree?' },
];
const QTTI_TIMEFRAMES = [
  { k:'monthly', tf:'1M', label:'Monthly', w:0.40, minBars:48,  why:'Structural regime. Stops a short-term bounce being read as a trend.' },
  { k:'weekly',  tf:'1W', label:'Weekly',  w:0.35, minBars:104, why:'The intermediate setup and the transition.' },
  { k:'daily',   tf:'1D', label:'Daily',   w:0.25, minBars:250, why:'Times the entry without dominating the regime.' },
];
const QTTI_REGIME_BANDS = [
  { lo:0,  hi:24,  id:'structural_down', label:'Structural downtrend', say:'Downward structure is strongly aligned.' },
  { lo:25, hi:39,  id:'bearish',         label:'Bearish / counter-trend', say:'Higher timeframes remain bearish; any rally may be a rebound.' },
  { lo:40, hi:54,  id:'transition',      label:'Transition / range',   say:'Direction is unresolved or mixed.' },
  { lo:55, hi:69,  id:'emerging',        label:'Emerging uptrend',     say:'Upward evidence is developing but not fully aligned.' },
  { lo:70, hi:84,  id:'confirmed',       label:'Confirmed uptrend',    say:'Daily, weekly and monthly evidence is broadly aligned.' },
  { lo:85, hi:100, id:'strong',          label:'Strong uptrend',       say:'Strong alignment. Check extension separately.' },
];
const QTTI_CONF_PARTS = [
  { k:'metadata',   label:'Symbol, instrument and venue metadata', w:0.25 },
  { k:'panels',     label:'Daily, weekly and monthly panel completeness', w:0.20 },
  { k:'indicators', label:'Indicator identity and settings', w:0.25 },
  { k:'legibility', label:'Price and indicator scale legibility', w:0.15 },
  { k:'recency',    label:'Source, candle time and recency consistency', w:0.15 },
];
const QTTI_CONF_BANDS = [
  { lo:85, label:'High confidence extraction' },
  { lo:70, label:'Usable with named limitations' },
  { lo:65, label:'Confirmation mandatory — no tranche unlock' },
  { lo:0,  label:'Not assessable' },
];
const QTTI_TRANCHE_PARTS = [
  { k:'htf',       label:'Higher-timeframe alignment', w:0.25, from:'The monthly and weekly scores, re-based over their combined weight: (0.40·M + 0.35·W) ÷ 0.75.' },
  { k:'trigger',   label:'Daily trigger',              w:0.20, from:'The daily timeframe score.' },
  { k:'volume',    label:'Volume confirmation',        w:0.10, from:'The mean of the three volume-and-participation states.' },
  { k:'location',  label:'Entry location',             w:0.15, from:'An ordinal you set. This is a judgement about the plan, not a reading of the chart, so the tool does not infer it.' },
  { k:'breadth',   label:'Momentum breadth',           w:0.10, from:'The mean of timeframe-weighted momentum and timeframe-weighted confirmation.' },
  { k:'risk',      label:'Risk definition',            w:0.15, from:'Zero until entry, invalidation and target are all set. Then scaled on net reward-to-risk against your own minimum.' },
  { k:'dataconf',  label:'Data confidence',            w:0.05, from:'The screenshot confidence score.' },
];
const QTTI_TRANCHE_BANDS = [
  { lo:80, id:'strong',  label:'Strongly confirmed', say:'Broad confirmation. Still check extension and concentration.' },
  { lo:65, id:'met',     label:'Criteria met',       say:'Your Stage 1 rules are met, subject to every hard gate.' },
  { lo:50, id:'pending', label:'Criteria pending',   say:'The setup is developing. The unmet conditions are named below.' },
  { lo:0,  id:'blocked', label:'Criteria blocked',   say:'Minimum conditions are not complete.' },
];
/* §11. Each template declares the floors it will not open beneath. */
const QTTI_TEMPLATES = [
  { id:'trend_continuation', label:'Trend continuation',
    note:'For a persistent upward trend. Later stages need a retest and continuation, never a lower price alone.',
    floors:{ monthly:45, weekly:55, daily:60, regime:55, tranche:65 }, needsTrigger:true, needsVolume:true },
  { id:'pullback_in_uptrend', label:'Pullback in a confirmed uptrend',
    note:'Only once the regime is already confirmed. The pullback must hold a structure you named in advance.',
    floors:{ monthly:50, weekly:55, daily:0, regime:70, tranche:65 }, needsTrigger:true, needsVolume:false },
  { id:'early_reversal_scout', label:'Early-reversal scout',
    note:'A distinct, higher-risk template. It is not trend continuation and is never labelled as such. No automatic later tranche.',
    floors:{ monthly:0, weekly:45, daily:65, regime:0, tranche:65 }, needsTrigger:true, needsVolume:true, explicitOptIn:true },
  { id:'short_trend', label:'Short direction',
    note:'Directional rules mirrored, plus borrow, gap and derivative approval. A bearish regime does not itself authorise a short.',
    floors:{ monthly:0, weekly:0, daily:0, regime:0, tranche:65 }, needsTrigger:true, needsVolume:true, short:true },
];
/* Which derivative terms apply is a property of the instrument, not of
   "derivative" as a class. A bought option has no liquidation price and pays
   no funding, so asking it for either made the gate clear only once the reader
   typed in a number that does not exist. `liquidation` marks the margined
   contracts a venue can close out; `funding` is the perpetual's periodic
   payment; `unmodelledTerms` names what this version cannot yet examine. */
const QTTI_INSTRUMENTS = [
  { id:'ordinary_share', label:'Ordinary share', gate:'equity' },
  { id:'etf',            label:'ETF',            gate:'asset' },
  { id:'spot_asset',     label:'Spot asset',     gate:'asset' },
  { id:'option',         label:'Option',         gate:'asset', derivative:true,
    unmodelledTerms:'premium at risk, expiry and the margin on a written option' },
  { id:'future',         label:'Future',         gate:'asset', derivative:true, liquidation:true },
  { id:'perpetual',      label:'Perpetual contract', gate:'asset', derivative:true, liquidation:true, funding:true },
];
/* The select's labels, and the words a gate quotes back. The gate used to
   print the internal id — "unknown" beside a control reading "Not yet
   researched" — so the reason and the control named one state two ways. */
const QTTI_THESIS_STATES = [
  { id:'unknown', label:'Not yet researched' }, { id:'fail', label:'Does not pass' }, { id:'pass', label:'Passes' },
];
const QTTI_LIMITS = { coverageFloor:0.70, confidenceFloor:70, confidenceReject:65, minRewardToRisk:3 };

const qttiBand = (bands, v) => bands.find(b => v >= b.lo) || bands[bands.length - 1];
const qttiRegimeBand = (v) => QTTI_REGIME_BANDS.find(b => v >= b.lo && v <= b.hi) || QTTI_REGIME_BANDS[0];
const qttiStateOf = (id) => QTTI_STATES.find(s => s.id === id) || QTTI_STATES.find(s => s.id === 'unknown');
/* A floor is judged on the score as displayed. Comparing the unrounded 59.5
   against 60 while printing Math.round of it produced "needs at least 60; it is
   60", and the regime floor already compared the rounded value — so two floors
   on one card treated rounding differently. */
const qttiClearsFloor = (score, floor) => !floor || Math.round(score) >= floor;

function qttiBlankPanel() {
  const o = { present:false, latestBarAt:'', openBarIncluded:false };
  QTTI_GROUPS.forEach(g => { o[g.k] = { state:'unknown', value:null }; });
  return o;
}

/* A blank plan. A named function rather than an object literal spliced into a
   State assignment, so the batch runner can build one without a browser and the
   §14 fixture can start from a known-empty plan instead of from whatever the
   reader last touched. */
function qttiDefaultPlan() {
  return {
    symbol:'', instrumentType:'etf', venue:'', quoteCurrency:'USD', priceBasis:'unknown',
    /* Declared HERE, not bolted on at prefill time. qttiWorkedExample() builds
       from qttiDefaultPlan(), so a source field missing from the default would
       let the §14 fixture keep a stale company id — a BTC/USDC perpetual plan
       claiming a company that has nothing to do with it. That is the exact bug
       the note on the fixture already describes. */
    sourceCompanyId:null, sourceTicker:'', sourceLinkedAt:'',
    timezone:'', capturedAt:'', adjustedState:'unknown', screenshotName:'', screenshotHash:'',
    identityConsistent:false, panelsCropped:false, unknownIndicators:'', corrections:[],
    equityThesisStatus:'unknown',
    assetThesis:{ mandate:false, issuer:false, liquidity:false, custody:false },
    tradingStatusClear:false,
    timeframes:{ daily:qttiBlankPanel(), weekly:qttiBlankPanel(), monthly:qttiBlankPanel() },
    confidence:{ metadata:null, panels:null, indicators:null, legibility:null, recency:null },
    template:'trend_continuation', reversalOptIn:false, triggerComplete:false,
    entryLocation:'unknown',
    plan:{ plannedTotal:0, stage1Fraction:0, plannedEntry:0, invalidation:0, target:0,
           minRewardToRisk:3, fees:0, fxCost:0, slippage:0, costsEntered:false },
    /* fundingPerUnit is null until entered. It used to default to 0 beside a
       funding rate that also defaulted to 0, so the gate that asks for funding
       could never fire and an unentered figure was scored as "no funding".
       Maintenance margin, funding rate and funding interval were inputs too,
       and nothing read any of them; the one funding figure the plan needs is
       the amount paid over the holding period, and it now feeds net risk. A
       key under a new name, so a plan saved with the old 0 default reads as
       not entered rather than as an entered zero. */
    perp:{ leverage:0, collateral:0, notional:0, marginMode:'',
           liquidationPrice:0, fundingPerUnit:null,
           maxAccountLoss:0, specVersion:'' },
    extension:{ extendedFromMean:false, momentumExtreme:false, belowResistance:false, volumeDiverges:false },
  };
}

/* One timeframe. §6: unknown evidence contributes a neutral 50 AND reduces
   coverage. It is never reweighted away — silently redistributing its weight
   is what makes a half-read chart look decisive. */
/* One cell of evidence. It is a five-state ordinal, or an analyst refinement
   within the same 0–100 scale. It counts as UNKNOWN only when it carries
   neither — a recorded number is evidence whatever label sits above it, and
   reading the label first is what silently zeroed coverage on the §14 fixture. */
function qttiCell(cell) {
  const c = cell || {};
  if (isNum(c.value)) return { known:true, v: clamp(c.value, 0, 100) };
  const st = QTTI_STATES.find(s => s.id === c.state);
  if (!st || st.unknown) return { known:false, v:50 };
  return { known:true, v: st.v };
}

function qttiTimeframe(panel) {
  let score = 0, coverage = 0;
  const unknown = [];
  QTTI_GROUPS.forEach(g => {
    const { known, v } = qttiCell(panel?.[g.k]);
    score += g.w * v;
    if (known) coverage += g.w; else unknown.push(g.label);
  });
  return { score, coverage, unknown, present: !!panel?.present };
}

/* §12. Costs are added to risk and subtracted from reward on both sides, so a
   3:1 gross case can and often does fail net — which is the point of showing
   it rather than the gross ratio.

   Funding is a cost of holding a perpetual and is counted with the others.
   Only funding PAID counts: a negative figure (funding received) is not added
   back, because the rate flips sign with positioning and a receipt at entry is
   no promise over the holding period. */
function qttiRewardToRisk(plan, isShort, fundingPerUnit) {
  const { plannedEntry:e, invalidation:i, target:t } = plan;
  if (!(e > 0) || !(i > 0) || !(t > 0)) return { defined:false, ratio:null };
  const riskPerUnit   = isShort ? i - e : e - i;
  const rewardPerUnit = isShort ? e - t : t - e;
  const funding = Math.max(0, num0(fundingPerUnit));
  const costs = num0(plan.fees) + num0(plan.fxCost) + num0(plan.slippage) + funding;
  const netRisk   = riskPerUnit + costs;
  const netReward = rewardPerUnit - costs;
  if (!(netRisk > 0)) return { defined:true, ratio:null, netRisk, netReward,
    err:'The invalidation is on the wrong side of the entry, so there is no risk to divide by.' };
  return { defined:true, ratio: netReward / netRisk, netRisk, netReward, costs, funding };
}

/* The whole run. Returns every figure the card needs plus the named reasons —
   §4 is explicit that a score without its conditions is not an output. */
function qttiRun(p) {
  const tfs = {};
  QTTI_TIMEFRAMES.forEach(t => { tfs[t.k] = qttiTimeframe(p.timeframes?.[t.k]); });
  const regimeRaw = QTTI_TIMEFRAMES.reduce((a, t) => a + t.w * tfs[t.k].score, 0);

  const conf = QTTI_CONF_PARTS.reduce((a, c) => a + c.w * (isNum(p.confidence?.[c.k]) ? clamp(p.confidence[c.k], 0, 100) : 0), 0);
  const confKnown = QTTI_CONF_PARTS.every(c => isNum(p.confidence?.[c.k]));
  /* Confidence is judged as it is printed, as the timeframe floors are. The
     unrounded 69.75 printed "Screenshot confidence is 70, below the 70
     required" beside a "70 / 100" banded "Confirmation mandatory", and 64.75
     was rejected as "65, below the floor of 65" — one card holding a number
     and a verdict that contradicted it. */
  const confShown = Math.round(conf);

  const inst = QTTI_INSTRUMENTS.find(x => x.id === p.instrumentType) || QTTI_INSTRUMENTS[0];
  const tpl  = QTTI_TEMPLATES.find(x => x.id === p.template) || QTTI_TEMPLATES[0];
  const rr   = qttiRewardToRisk(p.plan || {}, !!tpl.short, inst.funding ? p.perp?.fundingPerUnit : 0);
  /* Your own minimum. A missing key is the blank plan's published default; an
     entered 0 is not, and is refused below rather than silently replaced by 3
     while the input went on showing 0. */
  const minRR = p.plan?.minRewardToRisk == null ? QTTI_LIMITS.minRewardToRisk : num0(p.plan.minRewardToRisk);
  /* A share of the intended total. 25 typed for 25% printed a Stage 1 amount
     twenty-five times the whole position and raised no gate. */
  const stage1Fraction = num0(p.plan?.stage1Fraction);
  const fractionValid = stage1Fraction > 0 && stage1Fraction <= 1;

  /* --- §5.4 screenshot rejection. These make the run U outright rather than
     scoring it low, because an unreadable chart is not bearish evidence. */
  const reject = [];
  QTTI_TIMEFRAMES.forEach(t => { if (!tfs[t.k].present) reject.push(`The ${t.label.toLowerCase()} panel is missing. All three timeframes are required.`); });
  if (!p.symbol) reject.push('No symbol was recorded, so the panels cannot be tied to an instrument.');
  if (!p.identityConsistent) reject.push('You have not confirmed that all three panels show the same instrument and the same price basis.');
  if (p.panelsCropped) reject.push('A panel is cropped before the latest price or the indicator scale.');
  if (!p.capturedAt) reject.push('No capture time, so recency cannot be established.');
  if (confKnown && confShown < QTTI_LIMITS.confidenceReject) reject.push(`Screenshot confidence is ${confShown}, below the floor of ${QTTI_LIMITS.confidenceReject}.`);
  QTTI_TIMEFRAMES.forEach(t => {
    if (tfs[t.k].present && tfs[t.k].coverage < QTTI_LIMITS.coverageFloor)
      reject.push(`${t.label} evidence coverage is ${Math.round(tfs[t.k].coverage * 100)}%, below the 70% floor.`);
  });

  const assessable = reject.length === 0;
  const regime = assessable ? Math.round(regimeRaw) : null;

  /* --- §10 tranche components. Six derived, one set by the user. Each
     derivation is published on the page beside the number it produces. */
  const wMean = (key) => QTTI_TIMEFRAMES.reduce((a, t) => a + t.w * qttiCell(p.timeframes?.[t.k]?.[key]).v, 0);
  const plainMean = (key) => QTTI_TIMEFRAMES.reduce((a, t) => a + qttiCell(p.timeframes?.[t.k]?.[key]).v, 0) / QTTI_TIMEFRAMES.length;

  const htfW = QTTI_TIMEFRAMES.filter(t => t.k !== 'daily').reduce((a, t) => a + t.w, 0);
  const parts = {
    htf: QTTI_TIMEFRAMES.filter(t => t.k !== 'daily').reduce((a, t) => a + t.w * tfs[t.k].score, 0) / htfW,
    trigger: tfs.daily.score,
    volume: plainMean('volume'),
    location: qttiStateOf(p.entryLocation).unknown ? 50 : qttiStateOf(p.entryLocation).v,
    breadth: (wMean('momentum') + wMean('confirmation')) / 2,
    risk: !rr.defined || !isNum(rr.ratio) || !(minRR > 0) ? 0
        : Math.round(clamp(100 * Math.min(1, rr.ratio / minRR), 0, 100)),
    dataconf: conf,
  };
  const trancheRaw = QTTI_TRANCHE_PARTS.reduce((a, c) => a + c.w * parts[c.k], 0);

  /* --- §10.2 universal hard gates. A gate BLOCKS; it never deducts. §10.1:
     "A hard-gate failure overrides the numeric result." */
  const gates = [];
  if (inst.gate === 'equity') {
    if (p.equityThesisStatus !== 'pass')
      gates.push(`The underlying company thesis reads "${(QTTI_THESIS_STATES.find(x => x.id === p.equityThesisStatus) || QTTI_THESIS_STATES[0]).label}". An ordinary share still has to clear its research gate before a timing tool applies to it.`);
  } else {
    const at = p.assetThesis || {};
    const missing = [['mandate','a declared mandate or index'], ['issuer','the issuer or counterparty'],
                     ['liquidity','liquidity evidence'], ['custody','custody or settlement arrangements']]
      .filter(([k]) => !at[k]).map(([, l]) => l);
    if (missing.length) gates.push(`The asset thesis gate is incomplete: ${missing.join(', ')}. This instrument has no filed statements, so the thesis gate replaces the fundamental one rather than being skipped.`);
  }
  if (!p.tradingStatusClear) gates.push('Trading status and liquidity have not been confirmed — suspension, halt, delisting or a thin book each invalidate a chart read.');
  if (confKnown && confShown < QTTI_LIMITS.confidenceFloor)
    gates.push(`Screenshot confidence is ${confShown}, below the ${QTTI_LIMITS.confidenceFloor} required to unlock a tranche. Extraction reliability is not market predictability, but a tranche cannot rest on evidence this thin.`);
  if (!confKnown) gates.push('Screenshot confidence has not been scored, so the evidence rule cannot be applied.');
  if (!(num0(p.plan?.plannedTotal) > 0) || !(stage1Fraction > 0))
    gates.push('Your intended total position and Stage 1 fraction have not been entered. The platform does not invent either number.');
  else if (!fractionValid)
    gates.push(`Stage 1 fraction is ${stage1Fraction}. It is a share of the intended total, between 0 and 1 — 0.25 is a quarter — so ${stage1Fraction} would be ${stage1Fraction} times the whole position.`);
  if (!p.triggerComplete) gates.push('No completed entry trigger has been confirmed. A trigger that has not completed is a setup, not an entry.');
  if (!rr.defined) gates.push('Entry, invalidation and target are not all defined, so reward-to-risk cannot be computed and risk definition scores zero.');
  else if (rr.err) gates.push(rr.err);
  if (!(minRR > 0))
    gates.push(`Your minimum reward-to-risk reads ${minRR}. A minimum at or below zero would pass any trade, so it is refused rather than replaced — enter the ratio you actually require.`);
  else if (rr.defined && !rr.err && isNum(rr.ratio) && rr.ratio < minRR)
    gates.push(`Net reward-to-risk is ${rr.ratio.toFixed(2)}:1 after costs, below your minimum of ${minRR}:1.`);
  if (!p.plan?.costsEntered) gates.push('Fees, FX and slippage have not been confirmed as included. A gross ratio that clears 3:1 can fail net.');
  if (tpl.explicitOptIn && !p.reversalOptIn)
    gates.push('The early-reversal scout is a higher-risk template and has to be selected deliberately. Tick the opt-in to use it.');

  /* --- §11 template floors. */
  if (assessable) {
    const f = tpl.floors;
    if (!qttiClearsFloor(tfs.monthly.score, f.monthly)) gates.push(`${tpl.label} needs a monthly score of at least ${f.monthly}; it is ${Math.round(tfs.monthly.score)}.`);
    if (!qttiClearsFloor(tfs.weekly.score, f.weekly))   gates.push(`${tpl.label} needs a weekly score of at least ${f.weekly}; it is ${Math.round(tfs.weekly.score)}.`);
    if (!qttiClearsFloor(tfs.daily.score, f.daily))     gates.push(`${tpl.label} needs a daily score of at least ${f.daily}; it is ${Math.round(tfs.daily.score)}.`);
    if (!qttiClearsFloor(regime, f.regime))             gates.push(`${tpl.label} needs a trend regime of at least ${f.regime}; it is ${regime}.`);
    /* On the printed score too: the derivation table showed volume 50 while
       an unrounded 49.7 said it did not confirm. */
    if (tpl.needsVolume && !qttiClearsFloor(plainMean('volume'), 50)) gates.push('Volume does not confirm the move under this template.');
  }

  /* --- §13.2 derivative hard blocks. The trend card may still show; the
     tranche card stays locked. */
  const perpGates = [];
  if (inst.derivative) {
    const d = p.perp || {};
    if (!(num0(d.leverage) > 0) || !(num0(d.notional) > 0) || !(num0(d.collateral) > 0))
      perpGates.push('Leverage, contract notional or collateral is unknown.');
    if (!d.marginMode) perpGates.push('Margin mode has not been stated.');
    if (d.marginMode === 'cross' && !(num0(d.maxAccountLoss) > 0))
      perpGates.push('Cross margin is selected without total-account exposure being modelled.');
    if (inst.liquidation) {
      if (!(num0(d.liquidationPrice) > 0)) perpGates.push('No estimated liquidation price.');
      else if (num0(p.plan?.invalidation) > 0) {
        const liq = num0(d.liquidationPrice), inv = num0(p.plan.invalidation);
        const inside = tpl.short ? liq <= inv : liq >= inv;
        if (inside) perpGates.push(`The estimated liquidation price ${liq} sits inside or at your invalidation ${inv}. The position would be closed by the venue before your own stop.`);
      }
    }
    if (inst.funding && !isNum(d.fundingPerUnit))
      perpGates.push('Funding over the holding period has not been entered, so it cannot be part of the reward-to-risk calculation. Enter 0 if none will be paid.');
    /* Not a request for a figure: this version has no field that could hold
       these terms, so the tranche stays locked and the page says why, rather
       than letting an option clear on the perpetual's checklist. */
    if (inst.unmodelledTerms)
      perpGates.push(`This version does not model an ${inst.label.toLowerCase()}'s own terms — ${inst.unmodelledTerms} — so the derivative gate cannot clear for one.`);
    if (!d.specVersion) perpGates.push('No contract specification version, so the venue terms in force are unknown.');
    /* Units are the Stage 1 amount over the entry price, and the loss is the
       net risk on each. A netRisk exists only once the entry is above zero,
       so there is nothing to guard against — but the divisor was floored at
       1, which for any contract priced below 1 (a DOGE perpetual at 0.12)
       divided by the wrong number: at an entry of 0.5 the loss read half of
       what it is and a budget it broke let the gate clear. */
    if (num0(d.maxAccountLoss) > 0 && isNum(rr.netRisk) && num0(p.plan?.plannedTotal) > 0) {
      const intended = rr.netRisk * num0(p.plan.plannedTotal) * stage1Fraction / num0(p.plan.plannedEntry);
      if (intended > num0(d.maxAccountLoss)) perpGates.push('The intended loss exceeds the risk budget you entered.');
    }
  }
  perpGates.forEach(g => gates.push(`Derivative gate: ${g}`));

  /* §8.2 extension risk — a high regime can sit at a poor entry. Separate flag,
     never folded into the score. */
  const ext = Object.entries({
    extendedFromMean:'Price is materially extended from the selected average or ATR.',
    momentumExtreme:'Momentum is extreme and rolling over.',
    belowResistance:'Price sits directly below major resistance.',
    volumeDiverges:'Volume diverges from the price advance.',
  }).filter(([k]) => p.extension?.[k]).map(([, v]) => v);

  const trancheState = !assessable ? { id:'u', label:'Not assessable', say:'The screenshot evidence does not support a run.' }
    : gates.length ? QTTI_TRANCHE_BANDS.find(b => b.id === 'blocked')
    /* Banded on the printed readiness: an unrounded 64.6 printed "65 / 100 —
       Criteria pending" where the band table says 65 is Criteria met. */
    : qttiBand(QTTI_TRANCHE_BANDS, Math.round(trancheRaw));
  const tranche = assessable ? Math.round(trancheRaw) : null;

  /* §14.8 — what would change the state. Derived from the gates rather than
     written beside them, so the two can never drift apart. */
  const wouldChange = [];
  if (assessable) {
    const f = tpl.floors;
    if (!qttiClearsFloor(tfs.weekly.score, f.weekly)) wouldChange.push(`Weekly structure recovers to at least ${f.weekly}.`);
    if (!qttiClearsFloor(tfs.monthly.score, f.monthly)) wouldChange.push(`Monthly stops deteriorating and reaches ${f.monthly}.`);
    if (!qttiClearsFloor(tfs.daily.score, f.daily)) wouldChange.push(`Daily reaches ${f.daily} on a completed trigger.`);
  }
  if (!p.triggerComplete) wouldChange.push('A breakout and successful retest, a valid pullback trigger, or a confirmed reversal completes.');
  if (!rr.defined) wouldChange.push('You define entry, invalidation and target, and the net ratio clears your minimum.');
  if (inst.derivative && perpGates.length) wouldChange.push(inst.unmodelledTerms
    ? `A version of this model that examines an ${inst.label.toLowerCase()}'s own terms — ${inst.unmodelledTerms}. None does yet.`
    : `The derivative-risk gate is completed: ${['leverage, notional and collateral', 'margin mode',
        inst.liquidation && 'liquidation', inst.funding && 'funding', 'the contract specification'].filter(Boolean).join(', ')}.`);
  QTTI_TIMEFRAMES.forEach(t => { if (tfs[t.k].present && tfs[t.k].unknown.length)
    wouldChange.push(`${t.label} ${tfs[t.k].unknown.map(u => u.toLowerCase()).join(' and ')} becomes readable.`); });

  return {
    version:QTTI_VERSION, assessable, reject, tfs, regime, regimeRaw,
    band: assessable ? qttiRegimeBand(regime) : null,
    confidence: confKnown ? confShown : null,
    confidenceBand: confKnown ? qttiBand(QTTI_CONF_BANDS, confShown) : null,
    parts, tranche, trancheRaw, trancheState, gates, perpGates, ext, rr, tpl, inst,
    stage1: (num0(p.plan?.plannedTotal) > 0 && fractionValid)
      ? num0(p.plan.plannedTotal) * stage1Fraction : null,
    minRewardToRisk: minRR,
    wouldChange,
  };
}

/* §14, loaded as a fixture. Every number below is quoted from the worked
   example so the engine can be checked against the specification in the
   product rather than only in a test file. */
function qttiWorkedExample() {
  const set = (vals) => {
    const o = qttiBlankPanel(); o.present = true;
    QTTI_GROUPS.forEach((g, i) => {
      o[g.k] = vals[i] == null ? { state:'unknown', value:null }
             : { state:'analyst', value:vals[i] };
    });
    return o;
  };
  /* Built from a blank plan, not from State.qtti. Spreading the live plan meant
     the fixture inherited whatever the reader had already ticked — assetThesis,
     tradingStatusClear, the perpetual inputs and the extension flags all
     survived it — so "load the worked example" reproduced §14's three scores
     but not §14's gate list, which is half of what the example demonstrates. */
  return {
    ...qttiDefaultPlan(),
    symbol:'BTC / USDC Perpetual Contract', instrumentType:'perpetual', venue:'Coinbase',
    quoteCurrency:'USDC', priceBasis:'mark', capturedAt:'2026-08-09T08:37',
    screenshotName:'9a871693-82dc-4f69-a67e-8a81e780832b.png',
    identityConsistent:true, panelsCropped:false,
    unknownIndicators:'Several proprietary shapes and coloured markers are unnamed and are not scored.',
    timeframes:{
      /* structure, trend, momentum, volume, relative strength, confirmation */
      daily:   set([65, 50, 70, 45, null, 55]),
      weekly:  set([30, 30, 45, 40, null, 40]),
      monthly: set([25, 20, 30, 35, null, 25]),
    },
    confidence:{ metadata:95, panels:100, indicators:50, legibility:85, recency:55 },
    entryLocation:'bearish',
    template:'trend_continuation', triggerComplete:false,
    plan:{ ...qttiDefaultPlan().plan },
  };
}
/* @qtti-engine-end — everything above this marker is pure: no DOM, no
   localStorage, no browser. qtti/batch.mjs extracts exactly this region and
   runs it in Node, so the weekly batch and the page cannot score differently.
   Anything below is browser-only and must stay below. */

State.qtti = store.read('qttiPlan', null) || qttiDefaultPlan();
const saveQtti = () => store.write('qttiPlan', State.qtti);

/* §17.2 and acceptance test 21.3: a correction is APPENDED, never a silent
   overwrite. The point is not the audit trail for its own sake — it is that a
   reader who sees a blocked score and then walks the evidence upward until it
   unblocks leaves a visible trail of having done so. Overwriting in place is
   what makes that indistinguishable from having read the chart correctly the
   first time.

   Only a change to something ALREADY recorded is a correction. Logging the
   first entry of a group as "unknown → bullish" filled the history with
   transcription rather than revision, and a reader looking for the evidence
   that was walked upward had to find it among entries that were only ever
   typed once. `oldValue` is null for "nothing recorded yet". */
function qttiCorrect(field, oldValue, newValue) {
  if (oldValue == null) return;
  if (String(oldValue ?? '') === String(newValue ?? '')) return;
  State.qtti.corrections = State.qtti.corrections || [];
  State.qtti.corrections.push({ field, oldValue: oldValue ?? null, newValue: newValue ?? null,
    correctedAt: new Date().toISOString() });
  /* Bounded so one long session cannot fill the browser's storage quota and
     take the rest of the app's saved state down with it. */
  while (State.qtti.corrections.length > 200) State.qtti.corrections.shift();
}

/* One unit for both sides of a correction. The old side used to be the cell's
   number and the new side the picker's id — "30 → strong_bullish" — so a
   reader had to know the state table to see how far a value moved. */
function qttiCellLabel(cell) {
  if (isNum(cell?.value)) return `Analyst estimate (${cell.value})`;
  const st = qttiStateOf(cell?.state);
  return st.unknown ? 'Unknown' : `${st.label} (${st.v})`;
}

/* CLEARING, AND WHAT SURVIVES IT.
   Both clear paths used to spread the live plan and blank a handful of keys,
   so the company link, the thesis answer, the asset-thesis ticks, the trading
   status, the venue, the hash, the derivative inputs and the extension flags
   all carried over to the next chart — a "Linked to Apple Inc." banner above a
   plan now recording a BTC/USDC perpetual, and an attestation made about one
   instrument quietly standing for another.

   So a clear starts from the blank plan. What is kept is what belongs to the
   reader rather than to the chart: on "Clear evidence", the template and the
   capital rules (intended total, Stage 1 fraction, minimum reward-to-risk);
   on Reset, nothing but the correction history. The history is kept in both,
   with the clear itself appended to it, because it is append-only — clearing
   a plan and re-entering higher readings must leave the same trail as editing
   them in place. */
function qttiClearedPlan(prev, { keepRules, as = null }) {
  const next = qttiDefaultPlan();
  if (keepRules) {
    next.template = prev.template || next.template;
    next.reversalOptIn = !!prev.reversalOptIn;
    ['plannedTotal', 'stage1Fraction', 'minRewardToRisk'].forEach(k => {
      if (prev.plan?.[k] != null) next.plan[k] = prev.plan[k];
    });
  }
  next.corrections = [...(prev.corrections || [])];
  const recorded = !!prev.symbol || QTTI_TIMEFRAMES.some(t => prev.timeframes?.[t.k]?.present
    || QTTI_GROUPS.some(g => qttiCell(prev.timeframes?.[t.k]?.[g.k]).known));
  if (recorded) {
    next.corrections.push({ field: 'All recorded evidence',
      oldValue: prev.symbol || 'unnamed chart', newValue: as || (keepRules ? 'cleared' : 'reset'),
      correctedAt: new Date().toISOString() });
    while (next.corrections.length > 200) next.corrections.shift();
  }
  return next;
}

VIEWS.tradingIndex = () => {
  const p = State.qtti;
  const r = qttiRun(p);
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  /* Every control on this form redraws the page, and render() replaced the
     control under the keyboard: focus fell to <body> on each select, tick and
     field. So each control carries an id built from its own label, and the
     redraw hands focus back to it (redrawKeepFocus, 50-views-studio.js). */
  const save = () => { saveQtti(); redrawKeepFocus(); };
  const qid = (label) => `q-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

  /* Under the Scanner's header, whose Trading Index tab is current (Release
     B, B5): the one head every product page wears (pageHead,
     36-layouts.js). Its eyebrow said "Timing and risk control". */
  wrap.append(pageHead({ title: 'QT Trading Index', lede: 'Timing and risk control, from chart evidence you record.',
    note: 'A multi-timeframe trend reading and a test of your own first-tranche rules. It carries no weight in the research composite and does not replace the Strategy Lens — fundamentals first, technicals second.' }));

  /* "Fill in the identity" is gone once it has been used — the banner comes
     back as "Linked to …" — so focus fell to <body>. It goes to that
     heading, which says what the press did. */
  const qLink = workspaceLinkBanner('qtti', p, () => { saveQtti(); render(); focusAfterRedraw('#qtti-link h3'); });
  if (qLink) { qLink.id = 'qtti-link'; wrap.append(qLink); }

  /* Reset here means a blank plan, which for this tool IS the useful starting
     point — every panel is the reader's own transcription and there is no
     default reading to fall back to. See qttiClearedPlan for what survives. */
  wrap.append(workBar('trading', () => {
    State.qtti = qttiClearedPlan(State.qtti, { keepRules: false });
    saveQtti();
  }));

  /* THE STEPPER.
     Six things have to be recorded and they were a vertical stack of cards a
     reader had to scroll to audit. This says how far in they are and what is
     outstanding, without moving anything — the form stays one page, because a
     wizard would hide the fact that a later step can invalidate an earlier one. */
  const groupsDone = (tf) => QTTI_GROUPS.filter(g => qttiCell(p.timeframes?.[tf]?.[g.k]).known).length;
  const steps = [
    { label:'Instrument', done: !!p.symbol && p.identityConsistent && !!p.capturedAt,
      note: p.symbol ? p.symbol : 'not named' },
    ...QTTI_TIMEFRAMES.map(t => ({ label:t.tf,
      done: !!p.timeframes?.[t.k]?.present && groupsDone(t.k) >= QTTI_GROUPS.length - 1,
      note: `${groupsDone(t.k)}/${QTTI_GROUPS.length}` })),
    { label:'Risk plan', done: r.rr.defined && !!p.plan?.costsEntered,
      note: r.rr.defined ? 'set' : 'not set' },
    { label:'Result', done: r.assessable && !r.gates.length,
      note: r.assessable ? (r.gates.length ? `${r.gates.length} blocking` : 'clear') : 'not assessable' },
  ];
  const stepRow = el('div', { class: 'row row-wrap', style: 'gap:6px;margin-bottom:var(--md)' });
  steps.forEach((s, i) => {
    stepRow.append(el('span', { class: s.done ? 'chip chip-ok' : 'chip',
      title: s.done ? 'Complete' : 'Outstanding' }, `${s.done ? '✓ ' : ''}${s.label} · ${s.note}`));
    if (i < steps.length - 1) stepRow.append(el('span', { class: 'metaline', style: 'opacity:.4' }, '→'));
  });
  wrap.append(stepRow);

  /* ---------- the three numbers, §4 hierarchy ---------- */
  const card = el('div', { class: 'card' });
  card.append(cardHead('Three outputs, kept apart',
    `Model ${QTTI_VERSION}. A single blended number would let a legible screenshot of a poor setup outscore a blurry screenshot of a good one.`));

  /* A null reads in the neutral ink whatever the measure. Colouring an absent
     value by the tone its band would have had implies a reading that was never
     taken — the first pass painted an unscored tranche red, which looks like a
     verdict rather than an absence. */
  const big = (label, val, suffix, tone, sub) => el('div', {}, [
    el('p', { class: 'eyebrow', style: 'margin-bottom:2px' }, label),
    el('div', { class: 'row', style: 'gap:8px;align-items:baseline' }, [
      el('span', { class: 'num', style: `font-size:32px;font-weight:700;color:var(${val == null ? '--ink-2' : tone})` },
        val == null ? '—' : String(val)),
      el('span', { class: 'metaline' }, val == null ? 'not assessable' : suffix),
    ]),
    sub ? el('p', { class: 'caption', style: 'margin-top:4px' }, sub) : null,
  ]);

  const regimeTone = !r.assessable ? '--ink-2'
    : r.band.id === 'confirmed' || r.band.id === 'strong' ? '--ok-text'
    : r.band.id === 'transition' ? '--bronze' : '--dn-text';
  const trancheTone = r.trancheState.id === 'met' || r.trancheState.id === 'strong' ? '--ok-text'
    : r.trancheState.id === 'pending' ? '--bronze' : '--dn-text';

  card.append(el('div', { class: 'grid g-3', style: 'margin-top:var(--md)' }, [
    big('Trend regime', r.regime, '/ 100', regimeTone, r.assessable ? `${r.band.label} — ${r.band.say}` : null),
    big('First-tranche readiness', r.tranche, '/ 100', trancheTone, r.tranche == null ? null : r.trancheState.label),
    big('Screenshot confidence', r.confidence, '/ 100', '--ink-1', r.confidenceBand ? r.confidenceBand.label : 'Score the five components below.'),
  ]));

  /* Acceptance test 21.3 — a run has to say where it came from, on the card
     rather than in a footnote, so it can never be mistaken for licensed data.
     No price source is licensed in this build, so screenshot-derived is the
     only class this module can currently produce. */
  card.append(el('p', { class: 'metaline', style: 'margin-top:var(--md)' },
    `Screenshot-derived · ${p.symbol || 'no symbol recorded'}`
    + (p.venue ? ` · ${p.venue}` : '') + (p.priceBasis && p.priceBasis !== 'unknown' ? ` · ${p.priceBasis} price` : '')
    + (p.capturedAt ? ` · captured ${p.capturedAt.replace('T', ' ')}` : ' · no capture time')
    + (p.screenshotHash ? ` · ${p.screenshotHash.slice(0, 12)}` : '')
    + '. Read and recorded by you from your own chart. This is not licensed market data and no price here is observed by this product.'));

  /* Per-timeframe, with coverage beside each — a score at 70% coverage is not
     the same claim as the same score at 100%. */
  if (r.assessable) {
    /* Drawn first, itemised underneath. The table stays exactly as it was and
       is now also this chart's accessible equivalent. */
    const tfBlock = el('div', { class: 'render-block', style: 'margin-top:var(--md)' });
    const tfHost = el('div');
    tfBlock.append(tfHost);
    timeframeScoreBars(tfHost, r.tfs, r.tpl?.floors);
    tfBlock.append(el('p', { class: 'metaline', style: 'margin-top:var(--xs)' },
      `Each floor is the minimum this template — ${r.tpl?.label || 'the selected template'} — requires of that `
      + 'timeframe. A floor is a condition to be met, not a target and not a forecast.'));
    card.append(tfBlock);

    const t = el('table', { class: 'dt', style: 'margin-top:var(--md)' });
    t.append(el('thead', {}, el('tr', {}, ['Timeframe', 'Weight', 'Score', 'Coverage'].map((h, i) =>
      el('th', { style: i ? null : 'text-align:left' }, h)))));
    const tb = el('tbody');
    QTTI_TIMEFRAMES.forEach(tf => {
      const x = r.tfs[tf.k];
      tb.append(el('tr', {}, [
        el('td', { style: 'text-align:left' }, tf.label),
        el('td', {}, fmtPct(tf.w * 100, 0)),
        el('td', { class: 'num' }, String(Math.round(x.score))),
        el('td', { class: 'num' }, fmtPct(x.coverage * 100, 0)),
      ]));
    });
    t.append(tb);
    card.append(el('div', { class: 'tablewrap' }, t));
  }
  wrap.append(card);

  /* ---------- refusal, then gates, then what would change ---------- */
  if (!r.assessable) {
    /* An empty form and an unreadable chart both fail to produce a run, but
       they are not the same message. Opening a blank page on "Not assessable"
       reads as a verdict on work the reader has not started yet. */
    const untouched = !p.symbol && !QTTI_TIMEFRAMES.some(t => p.timeframes?.[t.k]?.present);
    const g = el('div', { class: 'card', style: `border-left:3px solid var(${untouched ? '--bronze' : '--dn-text'})` });
    g.append(untouched
      ? cardHead('Start here', 'Nothing is recorded yet. Read your own daily, weekly and monthly charts and record what you see below — this list is what a run needs before it will produce a number.')
      : cardHead('Not assessable', 'The screenshot evidence does not support a run. §5.4 — an unreadable chart is not bearish evidence, so nothing is scored from it.'));
    const ul = el('ul', { class: 'ticklist blocklist' });
    r.reject.forEach(x => ul.append(el('li', {}, x)));
    g.append(ul);
    wrap.append(g);
  } else if (r.gates.length) {
    const g = el('div', { class: 'card', style: 'border-left:3px solid var(--dn-text)' });
    g.append(cardHead(`Why first-tranche criteria are ${r.trancheState.label.replace('Criteria ', '')}`,
      `${r.gates.length} condition${r.gates.length === 1 ? '' : 's'} not met. A hard gate overrides the numeric result — ${r.tranche}/100 does not unlock anything while any of these stands.`));
    const ul = el('ul', { class: 'ticklist blocklist' });
    r.gates.forEach(x => ul.append(el('li', {}, x)));
    g.append(ul);
    wrap.append(g);
  }

  if (r.wouldChange.length) {
    const w = el('div', { class: 'card' });
    w.append(cardHead('What would change the state', 'Conditions to watch. This is not a prediction that any of them will happen, and none of them is an instruction.'));
    const ul = el('ul', { class: 'ticklist' });
    r.wouldChange.forEach(x => ul.append(el('li', {}, x)));
    w.append(ul);
    wrap.append(w);
  }

  if (r.ext.length) {
    const e = el('div', { class: 'note', style: 'border-left:3px solid var(--warn)' });
    e.append(el('p', { class: 'body', style: 'font-size:13px' },
      `Extension risk: ${r.ext.join(' ')} A high trend score can sit at a poor entry, so this is flagged separately rather than deducted from the score.`));
    wrap.append(e);
  }

  /* ---------- tranche component breakdown ---------- */
  if (r.assessable) {
    const d = el('details', { class: 'card' });
    d.append(el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'How first-tranche readiness was derived'));
    const t = el('table', { class: 'dt', style: 'margin-top:8px' });
    t.append(el('thead', {}, el('tr', {}, ['Component', 'Weight', 'Score', 'Where it comes from'].map((h, i) =>
      el('th', { style: i === 1 || i === 2 ? null : 'text-align:left' }, h)))));
    const tb = el('tbody');
    QTTI_TRANCHE_PARTS.forEach(c => tb.append(el('tr', {}, [
      el('td', { style: 'text-align:left' }, c.label),
      el('td', {}, fmtPct(c.w * 100, 0)),
      el('td', { class: 'num' }, String(Math.round(r.parts[c.k]))),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, c.from),
    ])));
    t.append(tb);
    d.append(el('div', { class: 'tablewrap' }, t));
    d.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'The specification names these seven weights but does not define six of the derivations. These are version 1.0.0’s, published here so a run can be reproduced and disputed.'));
    wrap.append(d);
  }

  /* ---------- inputs: identity ---------- */
  const idc = el('div', { class: 'card' });
  idc.append(cardHead('The chart you are reading', 'Recorded by you from your own screenshot. No image is uploaded, read or extracted on this page; the phase-2 extraction script runs off-page, writes a draft, and nothing it produces is scored until a person has confirmed it against the image.'));
  /* `lines` makes it a textarea. A single-line input scrolls its own content,
     which is fine for a ticker and wrong for a sentence: at 390px the
     unidentified-indicators note showed 55% of itself even at full width, and
     the rest was reachable only by dragging inside the field. Prose wraps. */
  const txt = (k, label, ph, lines) => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', { for: `q-${k}` }, label));
    const common = { class: 'input a-text', id: `q-${k}`, placeholder: ph || '',
      onchange: e => {
        p[k] = e.target.value;
        /* A symbol typed over the linked one is a different instrument. The
           link used to survive it, so the banner went on reading "Linked to
           Apple Inc." above a plan for something else. */
        if (k === 'symbol' && p.sourceCompanyId && e.target.value.trim() !== (p.sourceTicker || '')) {
          p.sourceCompanyId = null; p.sourceTicker = ''; p.sourceLinkedAt = '';
          toast('Company link removed — the symbol no longer matches it');
        }
        save();
      } };
    if (lines) {
      const ta = el('textarea', { ...common, rows: String(lines), style: 'min-height:0' });
      ta.value = p[k] ?? '';
      f.append(ta);
    } else {
      f.append(el('input', { ...common, type: 'text', value: p[k] ?? '' }));
    }
    return f;
  };
  /* The <label> and the <select> were siblings with nothing joining them — no
     `for`, no id, no aria-label — so five of these read out as an unnamed
     combobox. Chrome's own accessibility tree reported name:"" with
     nameFrom:[] on every one of them: sighted readers saw a label, screen
     reader users heard "combobox" and nothing else, on the controls that set
     the entry template and the margin mode.
     aria-label rather than for/id, because these are built in a loop with no
     stable identifier to hang an id on and a generated one would only be
     unique by luck. */
  const sel = (label, cur, opts, on) => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', {}, label));
    const s = el('select', { class: 'input input-inline', 'aria-label': label, id: qid(label),
      onchange: e => { on(e.target.value); save(); } });
    opts.forEach(o => s.append(el('option', { value: o.id, selected: cur === o.id ? '' : null }, o.label)));
    f.append(s);
    return f;
  };
  const cb = (label, val, on) => {
    const l = el('label', { class: 'checkline', style: 'gap:8px;display:flex;margin-top:6px' });
    l.append(el('input', { type: 'checkbox', id: qid(label), checked: val ? '' : null, onchange: e => { on(e.target.checked); save(); } }));
    l.append(el('span', {}, label));
    return l;
  };
  idc.append(txt('symbol', 'Symbol as shown on the chart', 'e.g. BTC / USDC Perpetual Contract'));
  idc.append(sel('Instrument type', p.instrumentType, QTTI_INSTRUMENTS, v => { p.instrumentType = v; }));
  idc.append(txt('venue', 'Venue or exchange'));
  idc.append(txt('quoteCurrency', 'Quote currency'));
  idc.append(sel('Price basis', p.priceBasis, [
    { id:'close', label:'Close' }, { id:'last', label:'Last' }, { id:'mark', label:'Mark' },
    { id:'index', label:'Index' }, { id:'unknown', label:'Unknown' }], v => { p.priceBasis = v; }));
  const capf = el('div', { class: 'assumption' });
  capf.append(el('label', { for: 'q-cap' }, 'Screenshot capture time'));
  capf.append(el('input', { class: 'input input-inline', id: 'q-cap', type: 'datetime-local', value: p.capturedAt || '',
    onchange: e => { p.capturedAt = e.target.value; save(); } }));
  idc.append(capf);
  idc.append(txt('screenshotName', 'Screenshot file name'));
  /* §14.1 records a SHA-256 beside the image. Nothing is uploaded here, so the
     hash is one you paste — it ties a saved run to a specific file rather than
     to "a chart I looked at once", which is the difference between a record and
     a memory. */
  idc.append(txt('screenshotHash', 'Screenshot SHA-256 (optional)', 'ties this run to one exact image'));
  idc.append(cb('All three panels show the same instrument and the same price basis', p.identityConsistent, v => { p.identityConsistent = v; }));
  idc.append(cb('A panel is cropped before the latest price or the indicator scale', p.panelsCropped, v => { p.panelsCropped = v; }));
  idc.append(cb('Trading status and liquidity are confirmed — no suspension, halt or thin book', p.tradingStatusClear, v => { p.tradingStatusClear = v; }));
  wrap.append(idc);

  /* ---------- the gate that replaces fundamentals ---------- */
  const gate = el('div', { class: 'card' });
  const isEquity = r.inst.gate === 'equity';
  gate.append(cardHead(isEquity ? 'Company research gate' : 'Asset thesis gate',
    isEquity
      ? 'An ordinary share clears its Strategy Lens tier first. A timing tool does not substitute for researching the business.'
      : 'This instrument has no filed statements, so the fundamental gate is replaced rather than skipped. Trend evidence alone does not authorise a position in something whose mandate, issuer, liquidity and custody are unexamined.'));
  if (isEquity) {
    gate.append(sel('Underlying company thesis', p.equityThesisStatus, QTTI_THESIS_STATES,
      v => { p.equityThesisStatus = v; }));
  } else {
    gate.append(cb('The mandate or index it tracks is declared and understood', p.assetThesis.mandate, v => { p.assetThesis.mandate = v; }));
    gate.append(cb('The issuer or counterparty is identified', p.assetThesis.issuer, v => { p.assetThesis.issuer = v; }));
    gate.append(cb('Liquidity evidence has been checked — spread, depth and traded volume', p.assetThesis.liquidity, v => { p.assetThesis.liquidity = v; }));
    gate.append(cb('Custody, settlement or contract-delivery arrangements are understood', p.assetThesis.custody, v => { p.assetThesis.custody = v; }));
  }
  wrap.append(gate);

  /* ---------- evidence, three panels × six groups ---------- */
  QTTI_TIMEFRAMES.forEach(tf => {
    const c = el('div', { class: 'card' });
    const x = r.tfs[tf.k];
    const done = QTTI_GROUPS.filter(g => qttiCell(p.timeframes?.[tf.k]?.[g.k]).known).length;
    c.append(cardHead(`${tf.label} panel (${tf.tf})`,
      `${tf.why} Needs about ${tf.minBars} completed bars visible. Score: ${Math.round(x.score)}, coverage ${fmtPct(x.coverage * 100, 0)}.`,
      /* The count belongs in the header, where a reader deciding whether to open
         this card can see whether it is worth opening. */
      el('span', { class: done === QTTI_GROUPS.length ? 'chip chip-ok' : 'chip',
        title: `${done} of the ${QTTI_GROUPS.length} evidence groups are recorded. Unknown ones contribute a neutral 50 and reduce coverage.` },
        `${done}/${QTTI_GROUPS.length} recorded`)));
    c.append(cb(`The ${tf.label.toLowerCase()} panel is present and readable`, p.timeframes[tf.k].present,
      v => { p.timeframes[tf.k].present = v; }));
    QTTI_GROUPS.forEach(g => {
      const cell = p.timeframes[tf.k][g.k] || { state:'unknown' };
      const f = el('div', { class: 'assumption' });
      f.append(el('label', { title: g.ask }, `${g.label} · ${fmtPct(g.w * 100, 0)}`));
      const s = el('select', { class: 'input input-inline', 'aria-label': `${tf.label} ${g.label}`, id: `q-${tf.k}-${g.k}`,
        onchange: e => {
          const before = p.timeframes[tf.k][g.k];
          const next = { state: e.target.value, value: null };
          qttiCorrect(`${tf.label} · ${g.label}`, qttiCell(before).known ? qttiCellLabel(before) : null, qttiCellLabel(next));
          p.timeframes[tf.k][g.k] = next; save();
        } });
      QTTI_STATES.forEach(o => s.append(el('option', { value: o.id,
        selected: cell.state === o.id ? '' : null }, `${o.label}${o.unknown ? '' : ` (${o.v})`}`)));
      if (cell.state === 'analyst') s.append(el('option', { value: 'analyst', selected: '' }, `Analyst estimate (${cell.value})`));
      f.append(s);
      c.append(f);
    });
    if (x.unknown.length) c.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      `Unknown: ${x.unknown.join(', ')}. Each contributes a neutral 50 and reduces coverage — it is never reweighted away, because that would make a half-read chart look decisive.`));
    wrap.append(c);
  });

  /* ---------- screenshot confidence ---------- */
  const cc = el('div', { class: 'card' });
  cc.append(cardHead('Screenshot confidence', 'How much of the result the image can support. This describes extraction reliability, not market predictability.'));
  QTTI_CONF_PARTS.forEach(c => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', { for: `qc-${c.k}` }, `${c.label} · ${fmtPct(c.w * 100, 0)}`));
    f.append(el('input', { class: 'input input-inline', id: `qc-${c.k}`, type: 'number', min: 0, max: 100, step: 5,
      value: isNum(p.confidence[c.k]) ? String(p.confidence[c.k]) : '', placeholder: '0–100', style: 'text-align:right',
      onchange: e => {
        const next = e.target.value === '' ? null : clamp(num0(e.target.value), 0, 100);
        qttiCorrect(`Confidence · ${c.label}`, p.confidence[c.k], next);
        p.confidence[c.k] = next; save();
      } }));
    cc.append(f);
  });
  cc.append(txt('unknownIndicators', 'Indicators you could not identify', '', 2));
  cc.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'An unidentified indicator is listed and ignored. Its identity and settings are not inferred from colour, and a proprietary signal is never scored.'));
  wrap.append(cc);

  /* ---------- template and Stage 1 plan ---------- */
  const pl = el('div', { class: 'card' });
  pl.append(cardHead('Your first-tranche rules', 'You select the template, the capital and the fraction. The platform calculates against them and does not set any of them.'));
  pl.append(sel('Entry template', p.template, QTTI_TEMPLATES, v => { p.template = v; }));
  pl.append(el('p', { class: 'metaline', style: 'margin:2px 0 8px' }, r.tpl.note));
  if (r.tpl.explicitOptIn) pl.append(cb('I am deliberately selecting the higher-risk early-reversal scout', p.reversalOptIn, v => { p.reversalOptIn = v; }));
  pl.append(sel('Entry location — how much room to the next target', p.entryLocation,
    QTTI_STATES.map(s => ({ id:s.id, label: s.unknown ? 'Not judged' : `${s.label} (${s.v})` })), v => { p.entryLocation = v; }));
  pl.append(cb('A completed entry trigger has occurred — breakout and retest, valid pullback, or confirmed reversal', p.triggerComplete, v => { p.triggerComplete = v; }));

  const pf = (k, label, step, range) => {
    const f = el('div', { class: 'assumption' });
    f.append(el('label', { for: `qp-${k}` }, label));
    f.append(el('input', { class: 'input input-inline', id: `qp-${k}`, type: 'number', step: step || 1,
      ...(range || {}), value: String(p.plan[k] ?? 0), style: 'text-align:right',
      onchange: e => { p.plan[k] = num0(e.target.value); save(); } }));
    return f;
  };
  pl.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Capital'));
  pl.append(pf('plannedTotal', 'Intended total position', 100));
  /* The range is a hint to the spinner, not the check — a typed 25 still
     lands, and the engine refuses it with a named gate. */
  pl.append(pf('stage1Fraction', 'Stage 1 fraction (0.25 = a quarter)', 0.05, { min: 0, max: 1 }));
  if (isNum(r.stage1)) pl.append(el('p', { class: 'metaline', style: 'margin-top:4px' },
    `Stage 1 amount: ${fmtNum(r.stage1, 2)} — your intended total multiplied by your fraction, and nothing else.`));
  pl.append(el('p', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Risk'));
  [['plannedEntry', 'Planned entry price', 0.01], ['invalidation', 'Invalidation price', 0.01],
   ['target', 'Target price', 0.01], ['minRewardToRisk', 'Your minimum reward-to-risk', 0.5],
   ['fees', 'Entry and exit fees per unit', 0.01], ['fxCost', 'FX cost per unit', 0.01],
   ['slippage', 'Estimated slippage per unit', 0.01]].forEach(([k, l, s]) => pl.append(pf(k, l, s, k === 'minRewardToRisk' ? { min: 0 } : null)));
  pl.append(cb('Fees, FX and slippage above are complete', p.plan.costsEntered, v => { p.plan.costsEntered = v; }));
  if (r.rr.defined && isNum(r.rr.ratio)) pl.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    `Net reward-to-risk ${r.rr.ratio.toFixed(2)}:1 — net reward ${fmtNum(r.rr.netReward, 2)} over net risk ${fmtNum(r.rr.netRisk, 2)}, costs added to the risk and taken off the reward on both sides${r.rr.funding > 0 ? `, funding of ${fmtNum(r.rr.funding, 2)} per unit among them` : ''}. A gross ratio that clears your minimum can still fail net, and a gap can exit worse than the stop.`));
  wrap.append(pl);

  /* ---------- derivative gate ---------- */
  if (r.inst.derivative) {
    const dv = el('div', { class: 'card', style: r.perpGates.length ? 'border-left:3px solid var(--dn-text)' : null });
    const inst = r.inst;
    dv.append(cardHead('Derivative risk gate',
      'Screenshot trend evidence is not sufficient to authorise a leveraged position. The trend card still shows; the tranche card stays locked until this is complete.'
      + (inst.unmodelledTerms ? ` For an ${inst.label.toLowerCase()} it cannot complete in this version: its own terms — ${inst.unmodelledTerms} — are not modelled, and a liquidation price and funding do not apply to it.` : '')));
    /* A blank field is stored as null, not 0. For funding that is the
       difference between "not entered", which blocks, and "none paid". */
    const df = (k, label, step) => {
      const f = el('div', { class: 'assumption' });
      f.append(el('label', { for: `qd-${k}` }, label));
      f.append(el('input', { class: 'input input-inline', id: `qd-${k}`, type: 'number', step: step || 1,
        value: isNum(p.perp[k]) ? String(p.perp[k]) : '', placeholder: 'not entered', style: 'text-align:right',
        onchange: e => { p.perp[k] = e.target.value === '' ? null : num0(e.target.value); save(); } }));
      return f;
    };
    dv.append(sel('Margin mode', p.perp.marginMode, [{ id:'', label:'Not stated' },
      { id:'isolated', label:'Isolated' }, { id:'cross', label:'Cross' }], v => { p.perp.marginMode = v; }));
    [['leverage', 'Leverage', 0.5], ['notional', 'Contract notional', 1], ['collateral', 'Collateral posted', 1],
     inst.liquidation && ['liquidationPrice', 'Estimated liquidation price', 0.01],
     inst.funding && ['fundingPerUnit', 'Funding you expect to pay over the holding period, per unit (0 if none)', 0.01],
     ['maxAccountLoss', 'Maximum account loss you accept', 1]].filter(Boolean).forEach(([k, l, s]) => dv.append(df(k, l, s)));
    const sv = el('div', { class: 'assumption' });
    sv.append(el('label', { for: 'qd-spec' }, 'Contract specification version'));
    sv.append(el('input', { class: 'input input-inline', id: 'qd-spec', type: 'text', value: p.perp.specVersion || '',
      onchange: e => { p.perp.specVersion = e.target.value; save(); } }));
    dv.append(sv);
    wrap.append(dv);
  }

  /* ---------- §8.2 extension risk ---------- */
  const ex = el('div', { class: 'card' });
  ex.append(cardHead('Extension risk', 'Recorded separately and never deducted from the score. A confirmed uptrend and a poor place to enter it are two different findings, and averaging them loses both.'));
  ex.append(cb('Price is materially extended from the average or ATR you selected', p.extension.extendedFromMean, v => { p.extension.extendedFromMean = v; }));
  ex.append(cb('Momentum is extreme and rolling over', p.extension.momentumExtreme, v => { p.extension.momentumExtreme = v; }));
  ex.append(cb('Price sits directly below major resistance', p.extension.belowResistance, v => { p.extension.belowResistance = v; }));
  ex.append(cb('Volume diverges from the price advance', p.extension.volumeDiverges, v => { p.extension.volumeDiverges = v; }));
  wrap.append(ex);

  /* ---------- §17.2 correction history ---------- */
  if ((p.corrections || []).length) {
    const ch = el('details', { class: 'card' });
    ch.append(el('summary', { class: 'metaline', style: 'cursor:pointer' },
      `Correction history — ${p.corrections.length} change${p.corrections.length === 1 ? '' : 's'} to recorded evidence`));
    const t = el('table', { class: 'dt', style: 'margin-top:8px' });
    t.append(el('thead', {}, el('tr', {}, ['When', 'Field', 'From', 'To'].map(h =>
      el('th', { style: 'text-align:left' }, h)))));
    const tb = el('tbody');
    [...p.corrections].reverse().forEach(c => tb.append(el('tr', {}, [
      el('td', { class: 'caption', style: 'text-align:left' }, String(c.correctedAt || '').replace('T', ' ').slice(0, 16)),
      el('td', { class: 'caption', style: 'text-align:left;white-space:normal' }, c.field),
      el('td', { class: 'caption', style: 'text-align:left' }, String(c.oldValue ?? '—')),
      el('td', { class: 'caption', style: 'text-align:left' }, String(c.newValue ?? '—')),
    ])));
    t.append(tb);
    ch.append(el('div', { class: 'tablewrap' }, t));
    ch.append(el('p', { class: 'metaline', style: 'margin-top:8px' },
      'Appended, never overwritten. Walking the evidence upward until a blocked score unblocks is a legitimate thing to do after re-reading a chart — it just should not be invisible afterwards.'));
    wrap.append(ch);
  }

  /* ---------- fixture + boundary ---------- */
  const tools = el('div', { class: 'card' });
  tools.append(cardHead('Check this against the specification',
    'Loads §14 — the worked BTC/USDC perpetual example — with its published evidence. It should return 38, 35 and 77.'));
  tools.append(el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:8px' }, [
    /* The fixture replaces the evidence, not the history. Assigning it
       outright emptied the append-only correction log — a reader who had
       walked a reading upward could load the example and leave no trail —
       so it keeps the log, and the replacement is appended to it like a
       clear. */
    el('button', { class: 'btn btn-ghost btn-sm', id: 'q-load-worked', onclick: () => {
      const next = qttiWorkedExample();
      next.corrections = qttiClearedPlan(State.qtti, { keepRules: false, as: 'replaced by the §14 worked example' }).corrections;
      State.qtti = next; save(); toast('Worked example loaded');
    } }, 'Load the §14 worked example'),
    el('button', { class: 'btn btn-ghost btn-sm', id: 'q-clear-evidence', onclick: () => {
      State.qtti = qttiClearedPlan(State.qtti, { keepRules: true });
      save(); toast('Evidence cleared — your template and capital rules are kept');
    } }, 'Clear evidence'),
  ]));
  wrap.append(tools);

  const bd = el('div', { class: 'card' });
  bd.append(cardHead('What this will not do', 'Named rather than implied.'));
  bd.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'It does not read your screenshot. Every state above is one you recorded. A phase-2 extraction script exists off-page (qtti/extract.mjs); it writes a draft, and nothing it produces is scored until a person has confirmed it against the image.'),
    el('li', {}, 'It does not predict the next candle, and it does not claim any indicator here is effective. That needs the point-in-time backtesting of §20, which this build cannot run without licensed history.'),
    el('li', {}, 'It carries 0% weight in the research composite. A trend reading never moves business quality or valuation.'),
    el('li', {}, 'It does not say buy, sell or hold, and it does not size a position from your income, wealth or risk tolerance. It reports whether the rules you declared are met.'),
    el('li', {}, 'A low regime score is not a short signal. A short needs its own borrow, derivative, liquidity and approval gate.'),
    el('li', {}, 'Oversold is not bullish here. It becomes reversal evidence only once momentum turns and structure confirms.'),
  ]));
  wrap.append(bd);
  return wrap;
};

/* Which records have their edit panel open, so a redraw after an edit does
   not close it under the reader. */
const OPP_EDIT_OPEN = new Set();
/* A record's id no longer counts the list. Counting repeated an id after a
   removal — record two, remove one, add the same name and two records shared
   "opp-2-…" — and OPP_EDIT_OPEN, keyed by id, then opened and closed both
   edit panels together. The saved-run and comparison ids made the same move. */
let OPP_SEQ = 0;
/* What "Record a property" holds before Add — see the form. */
let oppDraft = null;
VIEWS.opportunities = () => {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:var(--md)' });
  /* The one head every product page wears (pageHead, 36-layouts.js). */
  wrap.append(pageHead({ title: 'Opportunity register', lede: 'Real properties, each with what is known about it and what is not.',
    note: 'Ordered by when it was recorded, never by how good it looks.' }));

  const list = State.opportunities || [];

  const rules = el('div', { class: 'card' });
  rules.append(cardHead('How this register behaves', 'The constraints matter more than the fields.'));
  rules.append(el('ul', { class: 'ticklist' }, [
    el('li', {}, 'Nothing is ordered by merit. A hidden merit rank is a recommendation wearing a sort order, and this product does not make recommendations.'),
    el('li', {}, '“Available” appears only where availability was checked, with the date beside it. A stale flag sends someone to a property that sold weeks ago.'),
    el('li', {}, 'Asking price, your negotiated price, the bank valuation and a registered valuer’s figure are four different numbers and are kept apart.'),
    el('li', {}, 'A candidate with no verified rent, title or condition evidence stays U however good its yield looks — yield on an unverified rent is arithmetic on a guess.'),
    el('li', {}, 'Nothing is scraped or republished. Each record holds a reference you entered, not content taken from a listing site.'),
    el('li', {}, 'Records stay in this browser. There is no server holding them and no one else can see them.'),
  ]));
  wrap.append(rules);

  if (!list.length) {
    const empty = el('div', { class: 'card', id: 'opp-empty' });
    empty.append(cardHead('No properties recorded yet', 'This is a register, not a feed — it holds what you put in it.'));
    empty.append(el('p', { class: 'body', style: 'font-size:13px' },
      'Quantum Tradeworks holds no property listings and does not source them. There is no permitted feed of Sarawak listings this product can republish, and inventing candidates would be worse than an empty page. Add a property you are actually looking at, and the underwriting engine will model it and grade it on whatever evidence you have.'));
    wrap.append(empty);
  }

  /* Add a candidate. Deliberately few fields — the point is to get a property
     into the register and let evidence accumulate against it, not to demand a
     complete file before anything can be recorded. */
  const add = el('div', { class: 'card' });
  add.append(cardHead('Record a property', 'Enough to identify it. Evidence is added afterwards.'));
  /* WHAT IS ENTERED HERE BEFORE ADD IS KEPT THROUGH A REDRAW. The draft was
     drawn with the page, and the page is drawn again when the filings land a
     moment after it opens: a city, a price and an area given by then came
     back as Kuching and two empty fields, and a name typed into the first
     field went to a draft the new page no longer read — so the field, with
     focus and the typing handed back to it (render(), 35-ui.js), showed a
     name Add then said was missing. It is held here from the first
     keystroke until Add takes it. */
  const draft = oppDraft ||= { name:'', city:'kuching', district:'', type:'Condominium', source:'', askingPrice:0, sqft:0 };
  /* Each control carries its own label: the labels had no `for` and the
     inputs no id, so all seven fields were unnamed to a screen reader. */
  /* The district is chosen from the city's own list, which follows the city.
     It was free text, so a record could name a district no locality, select
     or link in the calculator could match — and a blank one opened there as
     "Demand — null" (dealDistrict, 70-property.js). */
  let fillDistricts = null;
  const f = (label, key, kind) => {
    const fl = el('div', { class: 'field', style: 'margin-top:8px' });
    const id = `opp-new-${key}`;
    fl.append(el('label', { for: id }, label));
    let input;
    if (kind === 'city') {
      input = el('select', { class: 'select', id });
      SARAWAK_CITIES.forEach(c => input.append(el('option', { value: c.id }, c.name)));
    } else if (kind === 'district') {
      const box = input = el('select', { class: 'select', id });
      fillDistricts = () => {
        const listed = (SARAWAK_CITIES.find(c => c.id === draft.city) || SARAWAK_CITIES[0]).districts;
        if (!listed.includes(draft.district)) draft.district = '';
        box.replaceChildren(el('option', { value: '' }, 'Not recorded'), ...listed.map(x => el('option', { value: x }, x)));
        box.value = draft.district;
      };
      fillDistricts();
    } else if (kind === 'type') {
      input = el('select', { class: 'select', id });
      PROPERTY_TYPES.forEach(t => input.append(el('option', { value: t }, t)));
    } else {
      input = el('input', { class: 'input', id, type: kind === 'num' ? 'number' : 'text' });
    }
    /* A figure not given is 0 in the draft, and an empty field on the page. */
    input.value = kind === 'num' ? (draft[key] || '') : draft[key];
    const keep = e => { draft[key] = kind === 'num' ? num0(e.target.value) : e.target.value; if (kind === 'city') fillDistricts?.(); };
    input.addEventListener('input', keep);
    input.addEventListener('change', keep);
    fl.append(input);
    return fl;
  };
  add.append(f('Project or address', 'name'));
  add.append(f('City', 'city', 'city'));
  add.append(f('Area or district', 'district', 'district'));
  add.append(f('Property type', 'type', 'type'));
  add.append(f('Asking price (RM)', 'askingPrice', 'num'));
  add.append(f('Built-up area (sq ft)', 'sqft', 'num'));
  add.append(f('Where you found it — listing reference, agent, or how you heard', 'source'));
  add.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
    'A reference, not a copy. Record enough to find it again; do not paste listing content you have no right to store.'));
  /* Add and Remove redraw the page, and both dropped focus on <body>. Add
     keeps it on Add, with the form emptied for the next one; Remove hands it
     to the record that took the removed one's place, or the one before it,
     or the empty register's heading when none is left. */
  add.append(el('button', { class: 'btn btn-primary', style: 'margin-top:10px', id: 'opp-add', onclick: () => {
    if (!draft.name.trim()) { toast('Give the property a name or address first'); return; }
    State.opportunities = [{
      id: `opp-${Date.now().toString(36)}${(OPP_SEQ++).toString(36)}-${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
      name: draft.name, source: draft.source,
      state: 'captured',
      capturedAt: new Date().toISOString().slice(0, 10),
      availabilityCheckedAt: null, available: null,
      deal: { city: draft.city, district: draft.district || null, propertyType: draft.type,
              price: draft.askingPrice, sqft: draft.sqft, projectId: customProjectId(draft.city),
              bankValuation: 0, titleType: 'unknown' },
      /* Each figure is marked as the reader's only if the reader gave it. A
         price alone marked the floor area as entered too, so a record with
         no area was graded as if its area were known, and the calculator's
         1,050 sq ft stood in unannounced. */
      touched: { ...(draft.askingPrice > 0 && { price: true }), ...(draft.sqft > 0 && { sqft: true }) },
      evidence: { ...(draft.askingPrice > 0 && { price: 'user' }), ...(draft.sqft > 0 && { sqft: 'user' }) },
      negotiatedPrice: null, valuerEstimate: null,
      nextAction: '', nextActionOwner: '', nextActionDue: '',
    }, ...State.opportunities];
    oppDraft = null;
    saveOpportunities(); toast(`${draft.name} recorded`); render(); focusAfterRedraw('#opp-add');
  } }, 'Add to register'));
  wrap.append(add);

  /* Run every candidate once; the cards and the comparison both read it. */
  const modelled = list.map(o => ({ o, ...candidateModel(o) }));

  /* SIDE BY SIDE. The same engine, the same assumptions — whatever the
     calculator holds today for anything a record does not state — and the
     candidates as columns in the order they were recorded. Not sorted by any
     figure: a table sorted by rate of return is a pick list with a header. */
  if (modelled.length >= 2) {
    const cmp = el('div', { class: 'card' });
    cmp.append(cardHead('Side by side',
      `${modelled.length} candidates under one set of assumptions. Where a record states a figure the model uses it; where it does not, the calculator’s current inputs stand in — so a difference between two columns can be a difference between two properties or between what is known about them.`));
    const t = el('table', { class: 'dt' });
    t.append(el('thead', {}, el('tr', {}, [el('th', { class: 'pin' }, ''), ...modelled.map(x => el('th', { class: 'num', style: 'white-space:normal;max-width:160px' }, x.o.name))])));
    const rows = [
      ['Asking price', x => isNum(x.o.deal?.price) && x.o.deal.price > 0 ? fmtAmount(x.o.deal.price, 'MYR') : `not recorded — the calculator’s ${fmtAmount(x.d.price, 'MYR')} stands in`],
      ['Safe cash required', x => isNum(x.m.safeCashRequired) ? fmtAmount(x.m.safeCashRequired, 'MYR') : '—'],
      ['Monthly position', x => isNum(x.m.cashflowMonthly) ? fmtAmount(x.m.cashflowMonthly, 'MYR') : '—'],
      ['Gross yield', x => isNum(x.m.grossYield) ? fmtPct(x.m.grossYield, 2) : 'n/a'],
      ['Net yield', x => isNum(x.m.netYield) ? fmtPct(x.m.netYield, 2) : 'n/a'],
      ['Debt-service cover', x => isNum(x.m.dscr) ? fmtX(x.m.dscr, 2) : 'n/a'],
      ['Break-even rent', x => isNum(x.m.breakEvenRent) ? fmtAmount(x.m.breakEvenRent, 'MYR') : 'n/a'],
      ['Rate of return', x => isNum(x.m.irrPct) ? fmtPct(x.m.irrPct, 2) : 'no rate'],
      ['Grade', x => `${x.grade.grade} — ${x.grade.verdict}`],
      ['Financeability', x => isNum(x.finance.score) ? `${x.finance.score}/100` : `unscored — ${x.finance.gates.length} to verify`],
    ];
    const tb = el('tbody');
    rows.forEach(([label, get]) => tb.append(el('tr', {}, [el('td', { class: 'pin ident' }, label), ...modelled.map(x => el('td', { class: 'num', style: 'white-space:normal' }, get(x)))])));
    t.append(tb);
    cmp.append(el('div', { class: 'tablewrap' }, t));
    cmp.append(el('p', { class: 'metaline', style: 'margin-top:var(--sm)' },
      'Columns are in register order. A grade of U means the evidence is not there yet, not that the property is poor; a yield on an unverified rent is arithmetic on a guess, and the grade says so.'));
    wrap.append(cmp);
  }

  /* The register itself. Newest first — an explicit, stated order. */
  list.forEach((o, i) => {
    const { d: md, m, grade, finance } = modelled[i];
    /* Where it is modelled, said where it differs from what was recorded: a
       district left blank, or typed and not on the city's list, stands in as
       the calculator's (candidateModel) and the card says which. */
    const cityName = (SARAWAK_CITIES.find(c => c.id === o.deal.city) || {}).name || '—';
    const listedAt = listedDistrict(o.deal.city, o.deal.district);
    const place = listedAt ? ` · ${listedAt}`
      : o.deal.district ? ` · ${o.deal.district} (not one of ${cityName}'s districts — modelled in ${md.district})`
      : ` · district not recorded — ${md.district} stands in`;
    const card = el('div', { class: 'card' });
    const gradeTone = { A:'--ok-text', B:'--bronze', C:'--bronze', D:'--dn-text', U:'--ink-2' }[grade.grade];
    card.append(el('div', { class: 'row row-wrap', style: 'gap:10px;align-items:baseline' }, [
      el('div', {}, [
        el('h3', { class: 'h-card', id: `opp-${i}-name`, style: 'margin:0' }, o.name),
        el('p', { class: 'metaline', style: 'margin-top:2px' },
          `${cityName}${place} · ${o.deal.propertyType}`),
      ]),
      el('div', { style: 'margin-left:auto;text-align:right' }, [
        el('div', { class: 'num', style: `font-size:24px;font-weight:700;color:var(${gradeTone})` }, grade.grade),
        el('div', { class: 'metaline' }, grade.verdict),
      ]),
    ]));

    /* Availability, only where it was actually checked. */
    const age = daysSince(o.availabilityCheckedAt);
    card.append(el('div', { class: 'row row-wrap', style: 'gap:6px;margin-top:10px' }, [
      el('span', { class: 'chip' }, (CANDIDATE_STATES.find(s => s.id === o.state) || {}).label || o.state),
      o.availabilityCheckedAt && o.available && age != null && age <= 14
        ? el('span', { class: 'chip chip-ok' }, `Available, checked ${age === 0 ? 'today' : age + 'd ago'}`)
        : o.availabilityCheckedAt
          ? el('span', { class: 'chip chip-bronze' }, `Availability last checked ${age}d ago — treat as unknown`)
          : el('span', { class: 'chip chip-bronze' }, 'Availability never checked'),
      el('span', { class: 'chip' }, `Recorded ${o.capturedAt}`),
    ]));

    /* Four prices, kept apart. */
    const pk = el('dl', { class: 'kv', style: 'margin-top:10px' });
    [['Asking price', isNum(o.deal.price) && o.deal.price > 0 ? fmtAmount(o.deal.price, 'MYR') : 'not recorded'],
     ['Your negotiated price', isNum(o.negotiatedPrice) ? fmtAmount(o.negotiatedPrice, 'MYR') : 'none'],
     ['Bank valuation', isNum(o.deal.bankValuation) && o.deal.bankValuation > 0 ? fmtAmount(o.deal.bankValuation, 'MYR') : 'not obtained'],
     ['Registered valuer', isNum(o.valuerEstimate) ? fmtAmount(o.valuerEstimate, 'MYR') : 'not obtained'],
     ['Safe cash required', isNum(m.safeCashRequired) ? fmtAmount(m.safeCashRequired, 'MYR') : '—'],
     ['Monthly position', isNum(m.cashflowMonthly) ? fmtAmount(m.cashflowMonthly, 'MYR') : '—'],
     ['Property Financeability', isNum(finance.score) ? `${finance.score}/100` : `unscored — ${finance.gates.length} to verify`]]
      .forEach(([k, v]) => { pk.append(el('dt', {}, k)); pk.append(el('dd', {}, v)); });
    card.append(pk);

    if (grade.gates.length) {
      card.append(el('h4', { class: 'eyebrow', style: 'margin:var(--md) 0 6px' }, 'Blocking or capping this'));
      const gl = el('ul', { class: 'ticklist' });
      grade.gates.slice(0, 4).forEach(g => gl.append(el('li', {}, g.text)));
      /* Four are shown; the rest are counted rather than silently dropped. */
      if (grade.gates.length > 4) gl.append(el('li', { class: 'metaline' },
        `…and ${grade.gates.length - 4} more — open it in the calculator to see every one.`));
      card.append(gl);
    }

    /* THE FOUR PRICES, AND THE CAPTURE, CAN BE RECORDED HERE.
       The card listed four prices "kept apart", and nothing on the page could
       set three of them — the negotiated price, the bank valuation and a
       registered valuer's figure always read "none" or "not obtained" — and a
       mistyped name, price or area could not be corrected after capture. The
       model reads the asking price and the bank valuation, as the calculator
       does; the negotiated and valuer figures are recorded beside them and do
       not move it. The calculator works on a copy: what is changed there is
       not written back to this record. */
    const ed = el('details', { style: 'margin-top:var(--md)', open: OPP_EDIT_OPEN.has(o.id) ? '' : null });
    ed.addEventListener('toggle', () => { if (ed.open) OPP_EDIT_OPEN.add(o.id); else OPP_EDIT_OPEN.delete(o.id); });
    ed.append(el('summary', { class: 'metaline', style: 'cursor:pointer' }, 'Record prices or correct this record'));
    const eg = el('div', { class: 'grid g-2', style: 'margin-top:8px' });
    const edField = (label, get, set, kind = 'num') => {
      const id = `opp-${i}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const w = el('div', { class: 'field' });
      w.append(el('label', { for: id }, label));
      const v = get();
      const inp = el('input', { class: 'input', id, type: kind === 'num' ? 'number' : 'text',
        ...(kind === 'num' ? { min: '0', step: '1000', placeholder: 'not recorded' } : {}),
        value: kind === 'num' ? (isNum(v) && v > 0 ? String(v) : '') : (v || '') });
      inp.addEventListener('change', e => {
        const raw = e.target.value.trim();
        if (kind === 'num') {
          /* Empty clears the figure to "not recorded"; it is never a nought. */
          const n = raw === '' ? null : Number(raw);
          if (raw !== '' && !(Number.isFinite(n) && n >= 0)) { toast('Enter an amount of nought or more, or leave it empty'); return; }
          set(isNum(n) && n > 0 ? n : null);
        } else {
          if (!raw && label === 'Name or address') { toast('A record needs a name or an address'); e.target.value = get() || ''; return; }
          set(raw);
        }
        saveOpportunities();
        /* Redrawn once focus has moved, and returned to wherever it went, so
           filling the fields in order does not lose the place. */
        setTimeout(() => {
          const at = document.activeElement?.id;
          render();
          if (at) document.getElementById(at)?.focus();
        }, 0);
      });
      w.append(inp);
      return w;
    };
    const setDeal = (k, v) => { o.deal = { ...o.deal, [k]: v ?? 0 }; };
    const mark = (k, on, ev = 'user') => {
      o.touched = { ...(o.touched || {}) }; o.evidence = { ...(o.evidence || {}) };
      if (on) { o.touched[k] = true; o.evidence[k] = ev; } else { delete o.touched[k]; delete o.evidence[k]; }
    };
    eg.append(edField('Asking price (RM)', () => o.deal.price, v => { setDeal('price', v); mark('price', v > 0); }));
    eg.append(edField('Your negotiated price (RM)', () => o.negotiatedPrice, v => { o.negotiatedPrice = v; }));
    eg.append(edField('Bank valuation (RM)', () => o.deal.bankValuation, v => { setDeal('bankValuation', v); }));
    eg.append(edField('Registered valuer (RM)', () => o.valuerEstimate, v => { o.valuerEstimate = v; }));
    eg.append(edField('Name or address', () => o.name, v => { o.name = v; }, 'text'));
    /* From the city's list, as the form above. A district typed before the
       list stays offered, marked, until it is changed. */
    {
      const w = el('div', { class: 'field' });
      const id = `opp-${i}-area-or-district`;
      w.append(el('label', { for: id }, 'Area or district'));
      const s = el('select', { class: 'select', id });
      const listed = (SARAWAK_CITIES.find(c => c.id === o.deal.city) || {}).districts || [];
      s.append(el('option', { value: '' }, 'Not recorded'));
      if (o.deal.district && !listedAt) s.append(el('option', { value: o.deal.district }, `${o.deal.district} — not one of ${cityName}'s districts`));
      listed.forEach(x => s.append(el('option', { value: x }, x)));
      s.value = listedAt || o.deal.district || '';
      s.addEventListener('change', e => { o.deal = { ...o.deal, district: e.target.value || null }; saveOpportunities(); redrawKeepFocus(); });
      w.append(s);
      eg.append(w);
    }
    eg.append(edField('Built-up area (sq ft)', () => o.deal.sqft, v => { setDeal('sqft', v); mark('sqft', v > 0); }));
    ed.append(eg);
    ed.append(el('p', { class: 'metaline', style: 'margin-top:6px' },
      'The asking price and the bank valuation feed the model, as they do on the calculator. Your negotiated price and a registered valuer’s figure are kept beside them and change nothing modelled. Changes made after “Open in the calculator” stay in the calculator.'));
    card.append(ed);

    /* Next verification action, with an owner and a date — 27.5 requires all
       three, because a task with no owner is a wish. */
    const na = el('div', { class: 'row row-wrap', style: 'gap:8px;align-items:end;margin-top:var(--md)' });
    /* Named for assistive technology; a placeholder is not a label. */
    /* These three, the stage and the availability button redraw the page as
       the edit panel above does, and like it they hand focus back: a
       synchronous render() here dropped it to <body>, so Tab from the action
       to "Who" landed on the skip link. */
    const naIn = el('input', { class: 'input', style: 'flex:2 1 220px', placeholder: 'Next verification action', id: `opp-${i}-next-action`,
      'aria-label': `Next verification action for ${o.name}`, value: o.nextAction || '' });
    const naWho = el('input', { class: 'input', style: 'flex:1 1 140px', placeholder: 'Who', id: `opp-${i}-next-owner`,
      'aria-label': `Who owns the next action for ${o.name}`, value: o.nextActionOwner || '' });
    const naDue = el('input', { class: 'input', style: 'flex:0 1 150px', type: 'date', id: `opp-${i}-next-due`,
      'aria-label': `Date the next action for ${o.name} is due`, value: o.nextActionDue || '' });
    [naIn, naWho, naDue].forEach((inp, j) => inp.addEventListener('change', e => {
      o[['nextAction', 'nextActionOwner', 'nextActionDue'][j]] = e.target.value; saveOpportunities(); redrawKeepFocus();
    }));
    na.append(naIn); na.append(naWho); na.append(naDue);
    card.append(na);
    if (o.nextAction && (!o.nextActionOwner || !o.nextActionDue))
      card.append(el('p', { class: 'metaline', style: 'margin-top:6px;color:var(--bronze)' },
        'An action with no owner and no date is a wish. Name both.'));

    const acts = el('div', { class: 'row row-wrap', style: 'gap:8px;margin-top:var(--md)' });
    const stSel = el('select', { class: 'select select-sm', style: 'width:auto', 'aria-label': `Stage of ${o.name}`, id: `opp-${i}-stage`,
      onchange: e => { o.state = e.target.value; saveOpportunities(); redrawKeepFocus(); } });
    CANDIDATE_STATES.forEach(s => stSel.append(el('option', { value: s.id, selected: o.state === s.id ? '' : null }, s.label)));
    acts.append(stSel);
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', id: `opp-${i}-checked`, onclick: () => {
      o.availabilityCheckedAt = new Date().toISOString().slice(0, 10); o.available = true;
      saveOpportunities(); toast('Availability confirmed today'); redrawKeepFocus();
    } }, 'I checked — still available'));
    /* The deal the register models, not a second assembly of it. This laid
       the raw record over the calculator's deal, so an unpriced record opened
       at a price of 0 — a free property — where the register had modelled it
       on the calculator's price, and the calculator's checklist answers were
       kept as though they were the record's.
       And it opens as the record's own property (openOpportunityProperty,
       71-property-models.js). It replaced the calculator's deal outright, so
       a deal being worked on was gone with no way back, and the next Open
       started again from the register: whatever had been changed in the
       calculator since — a rent confirmed, a rate quoted — had to be typed a
       second time. The first Open saves it as a property tied to the record;
       every Open after reopens that property as it was left. */
    const tied = pmAll().find(r => r.source?.kind === 'opportunity' && r.source.id === o.id);
    acts.append(el('button', { class: 'btn btn-ghost btn-sm', id: `opp-${i}-calc`,
      title: tied ? `Opens “${tied.name}”, saved from this record` : 'Saves this record as a property and opens it',
      onclick: () => openOpportunityProperty(o, modelled[i].d) }, 'Open in the calculator'));
    acts.append(el('button', { class: 'btn btn-quiet btn-sm', onclick: () => {
      if (!confirm(`Remove ${o.name} from the register?`)) return;
      State.opportunities = list.filter((_, j) => j !== i); saveOpportunities(); render();
      focusAfterRedraw(`#opp-${i}-name`, `#opp-${i - 1}-name`, '#opp-empty h3');
    } }, 'Remove'));
    card.append(acts);
    if (o.source) card.append(el('p', { class: 'metaline', style: 'margin-top:8px' }, `Source: ${o.source}`));
    wrap.append(card);
  });

  if (list.length) wrap.append(el('p', { class: 'metaline' },
    `${list.length} propert${list.length === 1 ? 'y' : 'ies'}, newest first. This order is recency, not merit — nothing on this page is ranked by how attractive it looks.`));
  return wrap;
};

